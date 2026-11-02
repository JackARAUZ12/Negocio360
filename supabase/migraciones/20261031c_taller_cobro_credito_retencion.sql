-- Taller: el cobro ahora admite CRÉDITO (fiado, igual que Ventas) y RETENCIÓN DE IR (igual que Ventas).
-- Crédito: no entra a Caja; se anota en Fiados enlazado a la venta (IVA se registra igual). Retención: no entra a Caja, queda en retenciones_ir a favor.
create or replace function public.taller_orden_entregar(p_orden_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); o record; li record; r record; prod record; v_venta uuid; v_num text; v_hoy date := (now() at time zone 'America/Managua')::date;
  v_pend integer; v_apr integer; v_metodo text := nullif(btrim(coalesce(p ->> 'metodo_pago_nombre', '')), ''); v_metodo_id uuid := nullif(p ->> 'metodo_pago_id', '')::uuid;
  v_banco uuid := nullif(p ->> 'banco_id', '')::uuid; v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120);
  v_km numeric := nullif(p ->> 'km_salida', '')::numeric; v_caja numeric; v_mov uuid; v_saldo_imp numeric;
  v_cnom text; v_cred boolean := coalesce(nullif(p ->> 'credito', '')::boolean, false); v_irp numeric := coalesce(nullif(p ->> 'retencion_ir_porcentaje', '')::numeric, 0); v_ir numeric := 0;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  if v_cred then v_metodo := 'Fiado'; v_metodo_id := null; v_banco := null; v_irp := 0; end if;
  if v_irp < 0 or v_irp > 100 then return jsonb_build_object('ok', false, 'motivo', 'retencion'); end if;
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.venta_id is not null then return jsonb_build_object('ok', true, 'ya_entregada', true, 'venta_id', o.venta_id); end if;
  if o.estado <> 'listo' then return jsonb_build_object('ok', false, 'motivo', 'estado', 'estado', o.estado); end if;
  if v_metodo is null then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  if v_metodo_id is not null and not exists (select 1 from public.metodos_pago where id = v_metodo_id and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  if v_banco is not null and not exists (select 1 from public.bancos where id = v_banco and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
  if v_km is not null and v_km < 0 then return jsonb_build_object('ok', false, 'motivo', 'km'); end if;
  select count(*) filter (where aprobacion = 'pendiente'), count(*) filter (where aprobacion = 'aprobada') into v_pend, v_apr from public.taller_orden_lineas where orden_id = o.id;
  if v_pend > 0 then return jsonb_build_object('ok', false, 'motivo', 'lineas_pendientes', 'pendientes', v_pend); end if;
  if v_apr = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_lineas'); end if;

  -- Inventario: se revisa TODO antes de mover nada (con los productos bloqueados).
  for r in select producto_id, sum(cantidad) q from public.taller_orden_lineas
            where orden_id = o.id and aprobacion = 'aprobada' and tipo = 'repuesto' and producto_id is not null group by producto_id order by producto_id loop
    select id, nombre, stock_actual, costo into prod from public.productos where id = r.producto_id and auth_user_id = v_uid for update;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'producto_no_existe'); end if;
    if coalesce(prod.stock_actual, 0) < r.q then
      return jsonb_build_object('ok', false, 'motivo', 'sin_stock', 'producto', prod.nombre, 'hay', coalesce(prod.stock_actual, 0), 'necesita', r.q);
    end if;
  end loop;

  -- El costo de los repuestos se fija al costo de inventario de HOY (así la ganancia queda real).
  update public.taller_orden_lineas l set costo_unitario = coalesce((select pr.costo from public.productos pr where pr.id = l.producto_id and pr.auth_user_id = v_uid), l.costo_unitario), updated_at = now()
   where l.orden_id = o.id and l.aprobacion = 'aprobada' and l.tipo = 'repuesto' and l.producto_id is not null;
  perform public._taller_recalcular(v_uid, o.id);
  select * into o from public.taller_ordenes where id = o.id;
  if o.total <= 0 then return jsonb_build_object('ok', false, 'motivo', 'total_cero'); end if;
  v_caja := round(o.total - o.impuesto, 2);
  if v_caja <= 0 then return jsonb_build_object('ok', false, 'motivo', 'total_cero'); end if;
  if v_cred and o.cliente_id is null then return jsonb_build_object('ok', false, 'motivo', 'credito_sin_cliente'); end if;
  if v_irp > 0 then
    v_ir := round((o.subtotal - o.descuento) * v_irp / 100, 2);
    if v_ir <= 0 or v_caja - v_ir <= 0 then return jsonb_build_object('ok', false, 'motivo', 'retencion'); end if;
    v_caja := round(v_caja - v_ir, 2);
  end if;
  select nombre into v_cnom from public.clientes where id = o.cliente_id and auth_user_id = v_uid;

  v_num := public.generar_numero_venta(v_uid);
  insert into public.ventas(auth_user_id, numero_venta, cliente_id, cliente_nombre, fecha, subtotal, descuento, impuesto, total, costo_total,
                            metodo_pago_id, metodo_pago_nombre, estado, observaciones, iva_activo, iva_porcentaje, creado_por_nombre)
  values (v_uid, v_num, o.cliente_id, coalesce(v_cnom, o.cliente_nombre, 'Cliente final'), now(), o.subtotal, o.descuento, o.impuesto, o.total, o.costo_total,
          v_metodo_id, v_metodo, 'completada', 'Taller · Orden ' || o.numero, o.iva_activo, case when o.iva_activo then o.iva_porcentaje else 0 end, v_por)
  returning id into v_venta;
  if v_cred then update public.ventas set metodo_pago = 'fiado', estado_pago = 'credito', categoria = 'fiado' where id = v_venta; end if;
  if v_ir > 0 then update public.ventas set retencion_ir_monto = v_ir, retencion_ir_porcentaje = v_irp where id = v_venta; end if;

  for li in select * from public.taller_orden_lineas where orden_id = o.id and aprobacion = 'aprobada' order by created_at, id loop
    insert into public.venta_detalles(venta_id, auth_user_id, producto_id, producto_nombre, producto_sku, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia, es_regalia, vendido_sin_stock)
    values (v_venta, v_uid, li.producto_id, li.descripcion, (select sku from public.productos where id = li.producto_id), case when li.tipo = 'repuesto' and li.producto_id is not null then 'producto' else 'servicio' end,
            li.cantidad, li.precio_unitario, li.costo_unitario, li.descuento, li.subtotal, round(li.subtotal - li.cantidad * li.costo_unitario, 2), false, false);
  end loop;

  for r in select producto_id, sum(cantidad) q from public.taller_orden_lineas
            where orden_id = o.id and aprobacion = 'aprobada' and tipo = 'repuesto' and producto_id is not null group by producto_id loop
    update public.productos set stock_actual = stock_actual - r.q where id = r.producto_id and auth_user_id = v_uid;
  end loop;

  if not v_cred then
  insert into public.movimientos_financieros(auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                             metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
  values (v_uid, 'INGRESO', 'VENTA', case when o.impuesto > 0 or v_ir > 0 then 'Venta ' || v_num || ' (neto de ' || concat_ws(' y ', case when o.impuesto > 0 then 'IVA' end, case when v_ir > 0 then 'retención IR' end) || ', taller ' || o.numero || ')' else 'Venta ' || v_num || ' (taller ' || o.numero || ')' end,
          v_caja, 0, 0, v_metodo_id, v_metodo, v_banco, 'venta', v_venta, null, v_hoy, 'completado')
  returning id into v_mov;
  update public.ventas set referencia_caja = v_mov where id = v_venta;
  end if;

  if o.impuesto > 0 then
    select saldo_resultante into v_saldo_imp from public.movimientos_impuestos where auth_user_id = v_uid order by created_at desc limit 1;
    insert into public.movimientos_impuestos(auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, referencia_venta_id, fecha)
    values (v_uid, 'IVA_VENTA', 'IVA de venta ' || v_num || ' (taller ' || o.numero || ')', o.impuesto, coalesce(v_saldo_imp, 0), coalesce(v_saldo_imp, 0) + o.impuesto, v_venta, v_hoy);
  end if;

  if v_cred then
    insert into public.fiados(auth_user_id, cliente_id, cliente_nombre, tipo, descripcion, monto_total, monto_pagado, saldo, estado, fecha, venta_id, creado_por_nombre)
    values (v_uid, o.cliente_id, coalesce(v_cnom, o.cliente_nombre, 'Cliente'), 'productos', left('Taller · Orden ' || o.numero, 200), o.total, 0, o.total, 'pendiente', v_hoy, v_venta, v_por);
  end if;
  if v_ir > 0 then
    insert into public.retenciones_ir(auth_user_id, lado, origen, venta_id, estado, contraparte_nombre, fecha, base, porcentaje, monto)
    values (v_uid, 'a_favor', 'venta', v_venta, 'pendiente', coalesce(v_cnom, o.cliente_nombre, 'Cliente'), v_hoy, round(o.subtotal - o.descuento, 2), v_irp, v_ir);
  end if;
  if o.cliente_id is not null then
    update public.clientes set total_compras = coalesce(total_compras, 0) + o.total, num_compras = coalesce(num_compras, 0) + 1 where id = o.cliente_id and auth_user_id = v_uid;
  end if;

  update public.taller_vehiculos set km_actual = greatest(coalesce(km_actual, 0), coalesce(v_km, o.km_ingreso, 0)), updated_at = now() where id = o.vehiculo_id and auth_user_id = v_uid;
  update public.taller_ordenes set estado = 'entregado', venta_id = v_venta, fecha_entrega = now(), km_salida = coalesce(v_km, km_salida), updated_at = now() where id = o.id;
  perform public._taller_log(v_uid, o.id, 'Entregado y cobrado', 'Venta ' || v_num || ' · ' || v_metodo, v_por);
  return jsonb_build_object('ok', true, 'venta_id', v_venta, 'numero_venta', v_num, 'total', o.total, 'credito', v_cred, 'retencion_ir', v_ir);
end;
$f$;
revoke all on function public.taller_orden_entregar(uuid, jsonb) from public, anon;
grant execute on function public.taller_orden_entregar(uuid, jsonb) to authenticated;
