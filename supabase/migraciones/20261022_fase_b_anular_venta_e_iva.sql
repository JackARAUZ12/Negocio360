-- =====================================================================
-- FASE B (auditoría 21-oct-2026) · Fecha: 22-oct-2026 · Solo AGREGA.
--
-- B2) IVA encadenado por la base. Antes cada página leía "el último
--     saldo" y calculaba el nuevo; si dos ventas con IVA se guardaban a
--     la vez, el saldo del IVA (el que muestra Dashboard e Impuestos)
--     quedaba mal. Ahora la base lo calcula al guardar, con las MISMAS
--     reglas que ya usaban las páginas:
--        IVA_VENTA      saldo = anterior + monto   (el reverso trae monto negativo)
--        IVA_COMPRA     saldo = anterior - monto
--        PAGO_IMPUESTO  saldo = máx(0, anterior - monto)
--     No cambia ningún movimiento ya guardado.
--
-- B1) Anular una venta en UNA sola operación (todo o nada):
--     inventario (incluye presentaciones y combos), estado de la venta,
--     fiado, historial del cliente, IVA, retención de IR, proforma,
--     crédito y el reverso en Caja. Si algo falla, no se cambia nada.
--     Si ya estaba anulada, no hace nada (no devuelve inventario dos veces).
--     CORRIGE: antes, una venta en presentaciones (ej. "caja x12")
--     devolvía 1 unidad por caja al anular, en vez de 12.
-- =====================================================================

-- ---------- B2 ----------
create or replace function public.fn_encadenar_saldo_impuesto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prev numeric;
begin
  if new.auth_user_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('mov_imp:' || new.auth_user_id::text, 0));
  if new.created_at is null or new.created_at = now() then new.created_at := clock_timestamp(); end if;
  select saldo_resultante into v_prev from public.movimientos_impuestos
   where auth_user_id = new.auth_user_id order by created_at desc, id desc limit 1;
  v_prev := coalesce(v_prev, 0);
  new.saldo_anterior := v_prev;
  new.saldo_resultante := case new.tipo_movimiento
      when 'IVA_COMPRA'    then round(v_prev - new.monto, 2)
      when 'PAGO_IMPUESTO' then greatest(0, round(v_prev - new.monto, 2))
      else round(v_prev + new.monto, 2) end;
  return new;
end $$;

create trigger trg_00_encadenar_saldo_impuesto before insert on public.movimientos_impuestos
  for each row execute function public.fn_encadenar_saldo_impuesto();

-- ---------- B1 ----------
create or replace function public.venta_anular_atomica(p_venta_id uuid, p_descontar_caja boolean default true, p_fecha date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v record; d record; ci record; m record; f record; k record; pf record; imp record;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Managua')::date);
  v_cant numeric; v_n integer;
  v_stock integer := 0; v_caja integer := 0; v_iva numeric := 0;
  v_proforma boolean := false; v_credito boolean := false; v_caja_motivo text := null;
  v_base text; v_lineas integer;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;

  -- La venta queda bloqueada mientras se anula (dos clics o dos pestañas no la anulan dos veces)
  select * into v from ventas where id = p_venta_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.estado = 'anulada' then return jsonb_build_object('ya_anulada', true); end if;

  -- 1) Fiado ligado: si ya tiene abonos no se anula
  if v.metodo_pago = 'fiado' then
    for f in select * from fiados where venta_id = v.id and auth_user_id = v_uid and estado <> 'eliminado' for update loop
      select count(*) into v_n from fiado_pagos where fiado_id = f.id;
      if v_n > 0 then
        raise exception 'Este fiado ya tiene abonos o pagos registrados, no se puede anular la venta.' using errcode = 'P0001';
      end if;
      update fiados set estado = 'eliminado', eliminado_at = now(), updated_at = now() where id = f.id;
    end loop;
  end if;

  -- 2) Inventario: se suma sobre la existencia REAL (presentaciones y combos incluidos)
  for d in select * from venta_detalles where venta_id = v.id and auth_user_id = v_uid loop
    if coalesce(d.cantidad, 0) <= 0 then continue; end if;
    if d.tipo_item = 'producto' and d.producto_id is not null then
      v_cant := d.cantidad * case when coalesce(d.presentacion_factor, 0) > 0 then d.presentacion_factor else 1 end;
      update productos set stock_actual = round(coalesce(stock_actual, 0) + v_cant, 3)
       where id = d.producto_id and auth_user_id = v_uid and tipo = 'producto';
      if found then v_stock := v_stock + 1; end if;
    elsif d.combo_id is not null then
      for ci in select * from combo_items where combo_id = d.combo_id and auth_user_id = v_uid loop
        update productos set stock_actual = round(coalesce(stock_actual, 0) + ci.cantidad * d.cantidad, 3)
         where id = ci.producto_id and auth_user_id = v_uid and tipo = 'producto';
        if found then v_stock := v_stock + 1; end if;
      end loop;
    end if;
  end loop;

  -- 3) Estado (aquí la base revisa: devoluciones y crédito con abonos -> rechaza y no se cambia nada)
  update ventas set estado = 'anulada', updated_at = now() where id = v.id;

  -- 4) Historial del cliente
  if v.cliente_id is not null then
    update clientes set total_compras = greatest(0, round(coalesce(total_compras, 0) - coalesce(v.total, 0), 2)),
                        num_compras   = greatest(0, coalesce(num_compras, 0) - 1)
     where id = v.cliente_id and auth_user_id = v_uid;
  end if;

  -- 5) IVA: un registro nuevo que resta (el original nunca se borra)
  for imp in select * from movimientos_impuestos
              where referencia_venta_id = v.id and auth_user_id = v_uid and tipo_movimiento = 'IVA_VENTA' and monto > 0
              order by created_at loop
    insert into movimientos_impuestos (auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                       referencia_venta_id, impuesto_id, impuesto_nombre, fecha)
    values (v_uid, 'IVA_VENTA',
            trim('Reverso de ' || coalesce(imp.impuesto_nombre, 'IVA') || ' por anulación de venta ' || coalesce(v.numero_venta, '')),
            -round(imp.monto, 2), 0, 0, v.id, imp.impuesto_id, imp.impuesto_nombre, v_fecha);
    v_iva := v_iva + round(imp.monto, 2);
  end loop;

  -- 6) Retención de IR que el cliente había hecho: ya no aplica
  update retenciones_ir set estado = 'anulada' where venta_id = v.id and auth_user_id = v_uid and estado = 'pendiente';

  -- 7) Proforma de origen vuelve a como estaba antes de convertirse
  for pf in select * from proformas where venta_id = v.id and auth_user_id = v_uid loop
    update proformas set estado = coalesce(pf.estado_antes_convertir, 'aprobada'), venta_id = null,
                         fecha_conversion = null, convertido_por = null, updated_at = now()
     where id = pf.id;
    v_proforma := true;
  end loop;

  -- 8) Crédito de la venta: se cancela (ya se verificó que no tiene abonos)
  if v.metodo_pago = 'credito' then
    for k in select * from creditos where venta_id = v.id and auth_user_id = v_uid and estado <> 'cancelado' loop
      update creditos set estado = 'cancelado', saldo_pendiente = 0, updated_at = now() where id = k.id;
      insert into creditos_historial (auth_user_id, credito_id, tipo_evento, descripcion, data)
      values (v_uid, k.id, 'cancelado', 'Crédito cancelado automáticamente — la venta que lo originó fue anulada', '{}'::jsonb);
      v_credito := true;
    end loop;
  end if;

  -- 9) Caja: egreso que compensa cada ingreso vigente de la venta (nunca se borra el ingreso)
  if p_descontar_caja then
    if exists (select 1 from movimientos_financieros
                where auth_user_id = v_uid and referencia_tipo = 'venta' and referencia_id = v.id
                  and tipo_flujo = 'EGRESO' and estado = 'completado' and concepto like 'Reverso por anulación%') then
      v_caja_motivo := 'ya_reversada';
    else
      select count(*) into v_lineas from movimientos_financieros
       where auth_user_id = v_uid and referencia_tipo = 'venta' and referencia_id = v.id
         and tipo_flujo = 'INGRESO' and estado = 'completado' and monto > 0;
      if v_lineas = 0 then v_caja_motivo := 'sin_ingreso'; end if;
      v_base := trim('Reverso por anulación de venta ' || coalesce(v.numero_venta, ''));
      v_n := 0;
      for m in select * from movimientos_financieros
                where auth_user_id = v_uid and referencia_tipo = 'venta' and referencia_id = v.id
                  and tipo_flujo = 'INGRESO' and estado = 'completado' and monto > 0
                order by created_at, id loop
        v_n := v_n + 1;
        insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                             metodo_pago_id, metodo_pago_nombre, banco_id, monto_moneda_banco,
                                             referencia_tipo, referencia_id, fecha, estado)
        values (v_uid, 'EGRESO', 'OTRO_EGRESO',
                case when v_lineas > 1 then v_base || ' — ' || coalesce(m.metodo_pago_nombre, 'línea ' || v_n) else v_base end,
                round(m.monto, 2), 0, 0, m.metodo_pago_id, m.metodo_pago_nombre, m.banco_id, m.monto_moneda_banco,
                'venta', v.id, v_fecha, 'completado');
        v_caja := v_caja + 1;
      end loop;
    end if;
  end if;

  return jsonb_build_object('ya_anulada', false, 'stock_lineas', v_stock, 'caja_lineas', v_caja, 'caja_motivo', v_caja_motivo,
                            'iva_reversado', v_iva, 'proforma_revertida', v_proforma, 'credito_cancelado', v_credito);
end $$;
revoke all on function public.venta_anular_atomica(uuid, boolean, date) from public, anon;
grant execute on function public.venta_anular_atomica(uuid, boolean, date) to authenticated;
