-- =====================================================================
-- TALLER · PAGO SEPARADO (2-nov-2026) — Fase 4.2
-- Misma función de siempre (taller_orden_entregar) + un pago separado OPCIONAL:
--   p.pagos = [{metodo_pago_id, metodo_pago_nombre, banco_id, monto}, ...]  (2 a 10 líneas)
-- Candados:
--   * las líneas deben sumar EXACTO lo que se cobra (total − retención IR); si no, no se guarda nada;
--   * cada línea entra a Caja como su propio movimiento (igual que Ventas), ligado a la venta,
--     así "Anular venta" las revierte todas;
--   * todo en UNA operación: si algo falla, no queda venta, ni stock descontado, ni Caja.
-- Si NO se manda "pagos", la función hace exactamente lo mismo que antes (línea por línea).
-- Respaldo de la versión anterior: respaldo_correcciones_20261015/pago_separado_taller_20261102/
-- =====================================================================
CREATE OR REPLACE FUNCTION public.taller_orden_entregar(p_orden_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); o record; li record; r record; prod record; v_venta uuid; v_num text; v_hoy date := (now() at time zone 'America/Managua')::date;
  v_pend integer; v_apr integer; v_metodo text := nullif(btrim(coalesce(p ->> 'metodo_pago_nombre', '')), ''); v_metodo_id uuid := nullif(p ->> 'metodo_pago_id', '')::uuid;
  v_banco uuid := nullif(p ->> 'banco_id', '')::uuid; v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120);
  v_km numeric := nullif(p ->> 'km_salida', '')::numeric; v_caja numeric; v_mov uuid; v_saldo_imp numeric;
  v_cnom text; v_cred boolean := coalesce(nullif(p ->> 'credito', '')::boolean, false); v_irp numeric := coalesce(nullif(p ->> 'retencion_ir_porcentaje', '')::numeric, 0); v_ir numeric := 0;
  -- Pago separado (opcional): p.pagos = [{metodo_pago_id, metodo_pago_nombre, banco_id, monto}, ...]
  v_pagos jsonb := case when jsonb_typeof(p -> 'pagos') = 'array' and jsonb_array_length(p -> 'pagos') > 0 then p -> 'pagos' end;
  pl jsonb; v_cobrar numeric; v_suma numeric := 0; v_asig numeric := 0; v_i integer := 0; v_n integer := 0; v_linea numeric; v_primero uuid; v_nombres text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  if v_cred then v_metodo := 'Fiado'; v_metodo_id := null; v_banco := null; v_irp := 0; v_pagos := null; end if;
  -- Pago separado: cada línea con método válido (y banco válido si trae) y monto > 0; mínimo 2 líneas.
  if v_pagos is not null then
    v_n := jsonb_array_length(v_pagos);
    if v_n < 2 or v_n > 10 then return jsonb_build_object('ok', false, 'motivo', 'separado_lineas'); end if;
    for pl in select value from jsonb_array_elements(v_pagos) loop
      if nullif(btrim(coalesce(pl ->> 'metodo_pago_nombre', '')), '') is null then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
      if coalesce(nullif(pl ->> 'monto', '')::numeric, 0) <= 0 then return jsonb_build_object('ok', false, 'motivo', 'separado_monto'); end if;
      if nullif(pl ->> 'metodo_pago_id', '') is not null and not exists (select 1 from public.metodos_pago where id = (pl ->> 'metodo_pago_id')::uuid and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
      if nullif(pl ->> 'banco_id', '') is not null and not exists (select 1 from public.bancos where id = (pl ->> 'banco_id')::uuid and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
      v_suma := round(v_suma + (pl ->> 'monto')::numeric, 2);
    end loop;
    select string_agg(btrim(value ->> 'metodo_pago_nombre'), ' + ') into v_nombres from jsonb_array_elements(v_pagos);
    v_metodo := left('Pago separado (' || v_nombres || ')', 200); v_metodo_id := null; v_banco := null;
  end if;
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

  for r in select producto_id, sum(cantidad) q from public.taller_orden_lineas
            where orden_id = o.id and aprobacion = 'aprobada' and tipo = 'repuesto' and producto_id is not null group by producto_id order by producto_id loop
    select id, nombre, stock_actual, costo into prod from public.productos where id = r.producto_id and auth_user_id = v_uid for update;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'producto_no_existe'); end if;
    if coalesce(prod.stock_actual, 0) < r.q then
      return jsonb_build_object('ok', false, 'motivo', 'sin_stock', 'producto', prod.nombre, 'hay', coalesce(prod.stock_actual, 0), 'necesita', r.q);
    end if;
  end loop;

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
  -- Pago separado: las líneas deben sumar EXACTO lo que se cobra (total menos retención IR).
  if v_pagos is not null then
    v_cobrar := round(o.total - v_ir, 2);
    if abs(v_suma - v_cobrar) > 0.01 then return jsonb_build_object('ok', false, 'motivo', 'separado_suma', 'cobrar', v_cobrar, 'suma', v_suma); end if;
  end if;
  select nombre into v_cnom from public.clientes where id = o.cliente_id and auth_user_id = v_uid;

  v_num := public.generar_numero_venta(v_uid);
  insert into public.ventas(auth_user_id, numero_venta, cliente_id, cliente_nombre, fecha, subtotal, descuento, impuesto, total, costo_total,
                            metodo_pago_id, metodo_pago_nombre, estado, observaciones, iva_activo, iva_porcentaje, creado_por_nombre)
  values (v_uid, v_num, o.cliente_id, coalesce(v_cnom, o.cliente_nombre, 'Cliente final'), (v_hoy::timestamp at time zone 'UTC'), o.subtotal, o.descuento, o.impuesto, o.total, o.costo_total,
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

  if not v_cred and v_pagos is not null then
    -- Un movimiento de Caja POR CADA método (igual que Ventas). Se reparte lo que entra a Caja
    -- (total sin IVA ni retención) en proporción; la última línea se lleva el resto para cuadrar exacto.
    for pl in select value from jsonb_array_elements(v_pagos) loop
      v_i := v_i + 1;
      v_linea := case when v_i = v_n then round(v_caja - v_asig, 2) else round((pl ->> 'monto')::numeric * v_caja / v_cobrar, 2) end;
      if v_linea <= 0 then raise exception 'Pago separado: una línea quedó en cero al repartir. No se guardó nada.'; end if;
      v_asig := round(v_asig + v_linea, 2);
      insert into public.movimientos_financieros(auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                                 metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
      values (v_uid, 'INGRESO', 'VENTA', 'Venta ' || v_num || ' — ' || btrim(pl ->> 'metodo_pago_nombre') || ' (pago separado, taller ' || o.numero || ')',
              v_linea, 0, 0, nullif(pl ->> 'metodo_pago_id', '')::uuid, left(btrim(pl ->> 'metodo_pago_nombre'), 120), nullif(pl ->> 'banco_id', '')::uuid, 'venta', v_venta, null, v_hoy, 'completado')
      returning id into v_mov;
      if v_primero is null then v_primero := v_mov; end if;
    end loop;
    if v_asig <> v_caja then raise exception 'Pago separado: el reparto no cuadra con Caja. No se guardó nada.'; end if;
    update public.ventas set referencia_caja = v_primero where id = v_venta;
  elsif not v_cred then
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
$function$;
