-- =====================================================================
-- FARMACIA · Control de Sustancias (12-nov-2026)
-- Antes la pantalla guardaba la venta en 5 pasos separados desde el navegador
-- (venta, detalle, Caja, inventario, registro): si se cortaba el internet a la
-- mitad podía quedar una venta sin Caja o sin descontar inventario, no tocaba el
-- lote y el registro se podía borrar.
-- Ahora: UNA función del servidor hace todo o nada (venta + detalle + inventario +
-- lote que vence primero, nunca vencido + Caja + registro + receta vinculada),
-- con clave por clic (un doble clic no vende dos veces).
-- Candado: un registro ligado a una venta ya no se puede borrar ni editar (si la
-- venta fue un error, se anula en Ventas y el registro queda marcado).
-- Solo AGREGA. Las ventas y registros que ya existen no se tocan.
-- =====================================================================

create or replace function public._rsc_candado_venta() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if old.venta_id is not null then
    raise exception 'Este registro está ligado a una venta y no se puede borrar ni modificar. Si la venta fue un error, anúlala en Ventas: el registro quedará marcado como anulado.'
      using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_rsc_candado_venta on public.registro_sustancias_controladas;
create trigger trg_rsc_candado_venta before update or delete on public.registro_sustancias_controladas
  for each row execute function public._rsc_candado_venta();

create or replace function public.farmacia_venta_controlada(p_clave uuid, p_producto_id uuid, p_cantidad numeric, p_precio numeric, p_fecha date,
  p_comprador jsonb, p_pago jsonb, p_receta_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date; v_fecha date;
  v_ya uuid; p record; l record; v_cant numeric; v_prec numeric; v_rest numeric; v_tomar numeric; v_lt jsonb := '[]'::jsonb;
  v_nom text; v_doc text; v_rec text; v_num text; v_res jsonb; v_vid uuid; v_sub numeric; v_mp text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if p_clave is null then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  perform pg_advisory_xact_lock(hashtextextended('farm_vc:' || v_uid::text, 0));
  select venta_id into v_ya from public.agro_ventas_claves where clave = p_clave and auth_user_id = v_uid;
  if found then return jsonb_build_object('ok', true, 'venta_id', v_ya, 'ya_existia', true); end if;

  v_nom := nullif(trim(coalesce(p_comprador->>'nombre', '')), '');
  v_doc := nullif(trim(coalesce(p_comprador->>'documento', '')), '');
  v_rec := nullif(trim(coalesce(p_comprador->>'receta', '')), '');
  if v_nom is null then return jsonb_build_object('ok', false, 'motivo', 'comprador'); end if;
  v_fecha := coalesce(p_fecha, v_hoy);
  if v_fecha > v_hoy then return jsonb_build_object('ok', false, 'motivo', 'fecha_futura'); end if;
  v_mp := nullif(trim(coalesce(p_pago->>'metodo_pago_nombre', '')), '');
  if v_mp is null then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  v_cant := round(coalesce(p_cantidad, 0), 3); v_prec := round(coalesce(p_precio, 0), 2);
  if v_cant <= 0 or v_cant > 1000000 or v_prec <= 0 or v_prec > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;

  select id, nombre, sku, coalesce(costo, 0) costo, coalesce(stock_actual, 0) stock, tipo, es_sustancia_controlada into p
    from public.productos where id = p_producto_id and auth_user_id = v_uid and coalesce(activo, true) for update;
  if not found or p.tipo is distinct from 'producto' then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
  if p.es_sustancia_controlada is not true then return jsonb_build_object('ok', false, 'motivo', 'no_controlado'); end if;
  if p.stock + 0.0005 < v_cant then return jsonb_build_object('ok', false, 'motivo', 'sin_stock', 'hay', p.stock); end if;

  -- Lotes: solo NO vencidos, el que vence primero sale primero
  if exists (select 1 from public.producto_lotes where auth_user_id = v_uid and producto_id = p.id and activo = true and cantidad_actual > 0) then
    v_rest := v_cant;
    for l in select id, numero_lote, fecha_vencimiento, cantidad_actual from public.producto_lotes
              where auth_user_id = v_uid and producto_id = p.id and activo = true and cantidad_actual > 0
                and (fecha_vencimiento is null or fecha_vencimiento >= v_hoy)
              order by fecha_vencimiento asc nulls last, created_at asc for update loop
      exit when v_rest <= 0;
      v_tomar := least(v_rest, l.cantidad_actual);
      v_lt := v_lt || jsonb_build_object('lote_id', l.id, 'numero', l.numero_lote, 'vence', l.fecha_vencimiento, 'cantidad', v_tomar);
      v_rest := v_rest - v_tomar;
    end loop;
    if v_rest > 0.0005 then return jsonb_build_object('ok', false, 'motivo', 'lote_vencido', 'disponible', round(v_cant - v_rest, 3)); end if;
  end if;

  v_sub := round(v_cant * v_prec, 2);
  v_num := public.generar_numero_venta(v_uid);
  v_res := public.venta_registrar_atomica(
    jsonb_build_object('numero_venta', v_num, 'cliente_nombre', v_nom,
      'fecha', case when v_fecha = v_hoy then now() else ((v_fecha + time '12:00') at time zone 'America/Managua') end,
      'subtotal', v_sub, 'descuento', 0, 'impuesto', 0, 'total', v_sub, 'costo_total', round(v_cant * p.costo, 2),
      'metodo_pago', v_mp, 'metodo_pago_id', nullif(p_pago->>'metodo_pago_id', ''), 'metodo_pago_nombre', v_mp,
      'estado_pago', 'pagado', 'estado', 'completada', 'categoria', 'Sustancia controlada',
      'creado_por_nombre', left(coalesce(p_pago->>'usuario', ''), 100),
      'observaciones', 'Venta controlada — Farmacia' || coalesce(' — Receta ' || v_rec, '')),
    jsonb_build_array(jsonb_build_object('producto_id', p.id, 'producto_nombre', p.nombre, 'producto_sku', p.sku, 'tipo_item', 'producto',
      'cantidad', v_cant, 'precio', v_prec, 'costo', p.costo, 'descuento', 0, 'subtotal', v_sub, 'ganancia', round(v_sub - v_cant * p.costo, 2),
      'lote_id', case when jsonb_array_length(v_lt) > 0 then (v_lt->0->>'lote_id') end)),
    jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant)),
    jsonb_build_array(jsonb_build_object('concepto', 'Venta controlada ' || v_num || ' — ' || p.nombre, 'monto', v_sub,
      'metodo_pago_id', nullif(p_pago->>'metodo_pago_id', ''), 'metodo_pago_nombre', v_mp, 'banco_id', nullif(p_pago->>'banco_id', ''), 'fecha', v_fecha)),
    null, null);
  v_vid := (v_res->>'venta_id')::uuid;
  if v_vid is null then raise exception 'No se pudo guardar la venta'; end if;

  if jsonb_array_length(v_lt) = 0 then
    insert into public.registro_sustancias_controladas (auth_user_id, producto_id, producto_nombre, cantidad, fecha, comprador_nombre, comprador_documento, receta_numero, venta_id, origen)
    values (v_uid, p.id, p.nombre, v_cant, v_fecha, v_nom, v_doc, v_rec, v_vid, 'farmacia');
  else
    for l in select (x->>'lote_id')::uuid lote_id, x->>'numero' numero, (x->>'vence')::date vence, (x->>'cantidad')::numeric cantidad from jsonb_array_elements(v_lt) x loop
      update public.producto_lotes set cantidad_actual = cantidad_actual - l.cantidad, updated_at = now()
       where id = l.lote_id and auth_user_id = v_uid and cantidad_actual >= l.cantidad - 0.0005;
      if not found then raise exception 'El lote cambió mientras se vendía. Intenta de nuevo.'; end if;
      insert into public.registro_sustancias_controladas (auth_user_id, producto_id, producto_nombre, cantidad, fecha, comprador_nombre, comprador_documento, receta_numero,
        lote_numero, lote_vencimiento, venta_id, origen)
      values (v_uid, p.id, p.nombre, l.cantidad, v_fecha, v_nom, v_doc, v_rec, l.numero, l.vence, v_vid, 'farmacia');
    end loop;
  end if;

  if p_receta_id is not null then
    update public.farmacia_recetas set venta_id = v_vid where id = p_receta_id and auth_user_id = v_uid and venta_id is null;
  end if;
  insert into public.agro_ventas_claves (clave, auth_user_id, venta_id) values (p_clave, v_uid, v_vid);
  return jsonb_build_object('ok', true, 'venta_id', v_vid, 'numero_venta', v_num, 'total', v_sub);
end $$;
revoke all on function public.farmacia_venta_controlada(uuid, uuid, numeric, numeric, date, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.farmacia_venta_controlada(uuid, uuid, numeric, numeric, date, jsonb, jsonb, uuid) to authenticated;
