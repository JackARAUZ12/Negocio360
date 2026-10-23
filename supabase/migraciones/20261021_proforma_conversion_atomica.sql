-- =====================================================================
-- PROFORMAS → VENTA: terminar la conversión en UNA sola operación
-- Fecha: 21-oct-2026 · Solo AGREGA dos funciones nuevas.
--
-- PROBLEMA (V-000848, 21-oct): el navegador hacía uno por uno, por
-- separado: descontar inventario producto por producto, registrar Caja,
-- IVA, historial del cliente y marcar la proforma. Si la página se
-- cerraba o se caía el internet a la mitad, quedaba la venta con parte
-- del inventario sin descontar, sin Caja y la proforma en borrador
-- (lista para convertirse otra vez).
--
-- AHORA: la venta y sus productos se guardan igual que antes, y TODO lo
-- demás lo hace proforma_finalizar_conversion() en una sola transacción:
-- o se hace completo o no se hace nada. Es repetible sin duplicar: si la
-- proforma ya quedó convertida con esa venta, no vuelve a hacer nada.
-- Mismas reglas que tenía la página (inventario nunca baja de 0, Caja
-- neta de IVA, stock compartido de otra cuenta del grupo, combos).
-- proforma_conversiones_incompletas(): ventas de proformas que quedaron
-- a medias (para que la página las termine sola al abrir Proformas).
-- =====================================================================

create or replace function public.proforma_finalizar_conversion(
  p_venta_id uuid, p_proforma_id uuid, p_metodo_id uuid default null, p_metodo_nombre text default null,
  p_banco_id uuid default null, p_convertido_por text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v record; pf record; d record; ci record; s record; p record;
  v_monto_caja numeric; v_iva numeric; v_mov uuid; v_avisos text[] := '{}'; v_saldo_imp numeric;
  n_stock integer := 0;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  perform pg_advisory_xact_lock(hashtext('n360_conv_proforma:' || p_proforma_id::text));

  select * into v from ventas where id = p_venta_id and auth_user_id = v_uid for update;
  select * into pf from proformas where id = p_proforma_id and auth_user_id = v_uid for update;
  if v.id is null or pf.id is null then raise exception 'No se encontró la venta o la proforma'; end if;
  if v.proforma_id is distinct from pf.id then raise exception 'Esa venta no es de esa proforma'; end if;
  if pf.estado = 'convertida' then
    if pf.venta_id = v.id then return jsonb_build_object('ok', true, 'ya_estaba', true); end if;
    raise exception 'Esta proforma ya se convirtió en otra venta';
  end if;
  if v.estado <> 'completada' then raise exception 'La venta no está activa'; end if;
  if not exists (select 1 from venta_detalles where venta_id = v.id) then raise exception 'La venta no tiene productos guardados'; end if;

  -- E: inventario (productos de esta cuenta y stock compartido de otra cuenta del grupo)
  for d in select * from proforma_detalles where proforma_id = pf.id and tipo_item = 'producto' and producto_id is not null loop
    if d.origen_stock_id is not null then
      begin
        perform public.descontar_stock_remoto(d.origen_stock_id, d.producto_nombre, d.cantidad);
      exception when others then
        v_avisos := v_avisos || ('Stock compartido de ' || d.producto_nombre || ': ' || sqlerrm);
      end;
    else
      update productos set stock_actual = greatest(0, coalesce(stock_actual, 0) - d.cantidad)
       where id = d.producto_id and auth_user_id = v_uid;
      n_stock := n_stock + 1;
    end if;
  end loop;
  -- E-2: combos (cada producto que lo compone)
  for d in select * from proforma_detalles where proforma_id = pf.id and tipo_item = 'combo' and combo_id is not null loop
    for ci in select * from combo_items where combo_id = d.combo_id and auth_user_id = v_uid loop
      update productos set stock_actual = greatest(0, coalesce(stock_actual, 0) - ci.cantidad * d.cantidad)
       where id = ci.producto_id and auth_user_id = v_uid;
    end loop;
  end loop;

  -- F: Caja (neto de IVA), solo si la venta todavía no tiene su movimiento
  v_iva := coalesce(pf.impuesto, 0);
  v_monto_caja := coalesce(pf.total, 0) - v_iva;
  select m.id into v_mov from movimientos_financieros m
   where m.auth_user_id = v_uid and m.referencia_tipo = 'venta' and m.referencia_id = v.id and m.tipo_flujo = 'INGRESO' and m.estado = 'completado' limit 1;
  if v_mov is null and v_monto_caja > 0 then
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, fecha, estado)
    values (v_uid, 'INGRESO', 'VENTA',
            case when v_iva > 0 then 'Venta ' || v.numero_venta || ' (neto de IVA, desde proforma ' || pf.numero_proforma || ')'
                 else 'Venta ' || v.numero_venta || ' (desde proforma ' || pf.numero_proforma || ')' end,
            v_monto_caja, 0, 0, p_metodo_id, coalesce(p_metodo_nombre, v.metodo_pago_nombre, 'Efectivo'), p_banco_id,
            'venta', v.id, (now() at time zone 'America/Managua')::date, 'completado')
    returning id into v_mov;
  end if;
  if v_mov is not null then update ventas set referencia_caja = v_mov where id = v.id; end if;

  -- F-2: IVA en Impuestos
  if v_iva > 0 and not exists (select 1 from movimientos_impuestos where referencia_venta_id = v.id and auth_user_id = v_uid) then
    select saldo_resultante into v_saldo_imp from movimientos_impuestos where auth_user_id = v_uid order by created_at desc limit 1;
    insert into movimientos_impuestos (auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, referencia_venta_id, fecha)
    values (v_uid, 'IVA_VENTA', 'IVA de venta ' || v.numero_venta || ' (desde proforma ' || pf.numero_proforma || ')',
            v_iva, coalesce(v_saldo_imp, 0), coalesce(v_saldo_imp, 0) + v_iva, v.id, (now() at time zone 'America/Managua')::date);
  end if;

  -- G: historial del cliente
  if pf.cliente_id is not null then
    update clientes set total_compras = coalesce(total_compras, 0) + coalesce(pf.total, 0), num_compras = coalesce(num_compras, 0) + 1
     where id = pf.cliente_id and auth_user_id = v_uid;
  end if;

  -- Proforma convertida (lo último: marca que todo lo anterior ya se hizo)
  update proformas set estado = 'convertida', estado_antes_convertir = pf.estado, venta_id = v.id,
         fecha_conversion = coalesce(v.created_at, now()), convertido_por = coalesce(p_convertido_por, v.creado_por_nombre, 'Usuario'),
         updated_at = now()
   where id = pf.id;

  return jsonb_build_object('ok', true, 'ya_estaba', false, 'productos', n_stock, 'caja', v_mov, 'avisos', to_jsonb(v_avisos));
end $$;
revoke all on function public.proforma_finalizar_conversion(uuid, uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.proforma_finalizar_conversion(uuid, uuid, uuid, text, uuid, text) to authenticated;

-- Ventas de proformas que quedaron a medias (venta activa, proforma sin convertir).
create or replace function public.proforma_conversiones_incompletas()
returns table (venta_id uuid, proforma_id uuid, numero_venta text, numero_proforma text, total numeric,
               metodo_pago_id uuid, metodo_pago_nombre text, creado_por_nombre text, tiene_caja boolean)
language sql stable security definer set search_path = public as $$
  select v.id, pf.id, v.numero_venta, pf.numero_proforma, v.total, v.metodo_pago_id, v.metodo_pago_nombre, v.creado_por_nombre,
         exists (select 1 from movimientos_financieros m where m.referencia_id = v.id and m.referencia_tipo = 'venta' and m.estado = 'completado')
    from ventas v join proformas pf on pf.id = v.proforma_id and pf.auth_user_id = v.auth_user_id
   where v.auth_user_id = auth.uid() and v.estado = 'completada' and v.created_at >= '2026-10-22 02:00:00+00'
     and pf.estado <> 'convertida'
     and exists (select 1 from venta_detalles d where d.venta_id = v.id)
$$;
revoke all on function public.proforma_conversiones_incompletas() from public, anon;
grant execute on function public.proforma_conversiones_incompletas() to authenticated;
