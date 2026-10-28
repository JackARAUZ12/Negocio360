-- =====================================================================
-- Producción · Fase 1 (SOLO AGREGA funciones; no cambia tablas ni datos)
-- Completar una producción en UNA sola operación, todo o nada:
--   * bloquea la orden: una orden completada no se puede completar otra vez
--     (doble clic, dos pestañas o dos equipos ya no descuentan dos veces);
--   * calcula en el servidor la materia prima necesaria (receta x cantidad) y
--     revisa que alcance antes de tocar nada;
--   * descuenta la materia prima y deja el registro de consumo (mismo formato de siempre);
--   * suma el producto terminado y ACTUALIZA SU COSTO con costo promedio:
--       (existencia anterior x costo anterior + unidades buenas x costo de esta producción)
--       / (existencia anterior + unidades buenas)
--     — antes el costo calculado nunca llegaba al producto y las ventas usaban un costo viejo;
--   * despiece: cada corte (no merma) recibe su existencia y su costo promedio;
--   * cierra la orden (costos, merma, fecha, actualizo_costo_producto = true).
-- Producir NO toca Caja: solo mueve valor de materia prima a producto terminado.
-- =====================================================================

create or replace function public._produccion_completar(p_uid uuid, p_orden_id uuid, p_cantidad_buena numeric, p_merma_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  o public.ordenes_produccion%rowtype; r public.recetas_produccion%rowtype;
  v_factor numeric; c record; p record; v_nec numeric; v_falt jsonb := '[]'::jsonb;
  v_mat numeric := 0; v_total numeric; v_buena numeric; v_merma numeric; v_unit numeric;
  v_ant_stock numeric; v_ant_costo numeric; v_nuevo_costo numeric;
  s record; v_cant numeric; v_valor numeric; v_suma numeric := 0; v_asig numeric; v_cu numeric;
begin
  select * into o from public.ordenes_produccion where id = p_orden_id and auth_user_id = p_uid for update;
  if not found then raise exception 'produccion:no_existe'; end if;
  if o.estado = 'completada' then raise exception 'produccion:ya_completada'; end if;
  if o.estado = 'cancelada' then raise exception 'produccion:cancelada'; end if;
  select * into r from public.recetas_produccion where id = o.receta_id and auth_user_id = p_uid;
  if not found then raise exception 'produccion:sin_receta'; end if;
  if coalesce(o.cantidad_planificada, 0) <= 0 then raise exception 'produccion:cantidad'; end if;
  v_factor := o.cantidad_planificada / nullif(coalesce(r.cantidad_producida, 1), 0);
  if v_factor is null then raise exception 'produccion:receta'; end if;

  -- 1) Revisar que alcance la materia prima (bloqueando cada producto, en orden fijo)
  for c in select rc.producto_id, sum(rc.cantidad) cant from public.receta_componentes rc
           where rc.receta_id = r.id and rc.auth_user_id = p_uid group by rc.producto_id order by rc.producto_id loop
    v_nec := round(c.cant * v_factor, 2);
    select id, nombre, stock_actual, costo into p from public.productos where id = c.producto_id and auth_user_id = p_uid for update;
    if not found then raise exception 'produccion:materia_no_existe'; end if;
    if coalesce(p.stock_actual, 0) < v_nec then
      v_falt := v_falt || jsonb_build_object('nombre', p.nombre, 'necesario', v_nec, 'disponible', coalesce(p.stock_actual, 0));
    end if;
  end loop;
  if jsonb_array_length(v_falt) > 0 then
    raise exception using message = 'produccion:falta_materia', detail = v_falt::text;
  end if;

  -- 2) Descontar materia prima + registro de consumo
  for c in select rc.producto_id, sum(rc.cantidad) cant from public.receta_componentes rc
           where rc.receta_id = r.id and rc.auth_user_id = p_uid group by rc.producto_id order by rc.producto_id loop
    v_nec := round(c.cant * v_factor, 2);
    update public.productos set stock_actual = stock_actual - v_nec, updated_at = now()
      where id = c.producto_id and auth_user_id = p_uid
      returning id, nombre, sku, stock_actual, costo into p;
    insert into public.orden_produccion_consumos(auth_user_id, orden_id, producto_id, producto_nombre, producto_sku, cantidad_consumida, costo_unitario, subtotal, stock_antes, stock_despues)
    values (p_uid, o.id, p.id, p.nombre, p.sku, v_nec, coalesce(p.costo, 0), round(v_nec * coalesce(p.costo, 0), 2), p.stock_actual + v_nec, p.stock_actual);
    v_mat := v_mat + round(v_nec * coalesce(p.costo, 0), 2);
  end loop;
  v_total := round(v_mat + coalesce(o.costo_mano_obra, 0) + coalesce(o.costo_indirecto, 0), 2);

  if coalesce(o.tipo, 'normal') = 'despiece' then
    -- 3a) Despiece: el costo total se reparte por el valor (precio) de cada corte
    select coalesce(sum(case when ds.es_merma then 0 else round(round(ds.cantidad_rendimiento * o.cantidad_planificada, 2) * coalesce(pr.precio, 0), 2) end), 0)
      into v_suma from public.receta_despiece_salidas ds left join public.productos pr on pr.id = ds.producto_id and pr.auth_user_id = p_uid
      where ds.receta_id = r.id and ds.auth_user_id = p_uid;
    for s in select ds.producto_id, ds.cantidad_rendimiento, ds.es_merma from public.receta_despiece_salidas ds
             where ds.receta_id = r.id and ds.auth_user_id = p_uid order by ds.producto_id loop
      v_cant := round(s.cantidad_rendimiento * o.cantidad_planificada, 2);
      if v_cant <= 0 then continue; end if;
      select id, nombre, precio, stock_actual, costo into p from public.productos where id = s.producto_id and auth_user_id = p_uid for update;
      if not found then raise exception 'produccion:salida_no_existe'; end if;
      v_valor := case when s.es_merma then 0 else round(v_cant * coalesce(p.precio, 0), 2) end;
      v_asig := case when v_suma > 0 then round(v_valor / v_suma * v_total, 2) else 0 end;
      v_cu := case when v_cant > 0 then round(v_asig / v_cant, 2) else 0 end;
      if not s.es_merma then
        v_ant_stock := coalesce(p.stock_actual, 0); v_ant_costo := coalesce(p.costo, 0);
        v_nuevo_costo := case when v_ant_stock > 0 then round((v_ant_stock * v_ant_costo + v_cant * v_cu) / (v_ant_stock + v_cant), 2) else v_cu end;
        update public.productos set stock_actual = stock_actual + v_cant, costo = v_nuevo_costo, updated_at = now() where id = p.id and auth_user_id = p_uid;
      end if;
      insert into public.orden_despiece_resultados(auth_user_id, orden_id, producto_id, producto_nombre, cantidad_obtenida, valor_relativo, costo_asignado, costo_unitario)
      values (p_uid, o.id, p.id, p.nombre, v_cant, v_valor, v_asig, v_cu);
    end loop;
    update public.ordenes_produccion set estado = 'completada', costo_materiales = v_mat, costo_total = v_total,
      porcentaje_avance = 100, actualizo_costo_producto = true, fecha_completada = now(), updated_at = now()
      where id = o.id;
    return jsonb_build_object('ok', true, 'tipo', 'despiece', 'costo_materiales', v_mat, 'costo_total', v_total);
  end if;

  -- 3b) Normal: unidades buenas (lo planificado menos la merma) entran con su costo
  v_buena := coalesce(p_cantidad_buena, o.cantidad_planificada - coalesce(o.merma_cantidad, 0));
  v_buena := round(v_buena, 2);
  if v_buena <= 0 or v_buena > o.cantidad_planificada then raise exception 'produccion:cantidad_buena'; end if;
  v_merma := round(o.cantidad_planificada - v_buena, 2);
  v_unit := round(v_total / v_buena, 2);
  select id, stock_actual, costo into p from public.productos where id = o.producto_terminado_id and auth_user_id = p_uid for update;
  if not found then raise exception 'produccion:terminado_no_existe'; end if;
  v_ant_stock := coalesce(p.stock_actual, 0); v_ant_costo := coalesce(p.costo, 0);
  v_nuevo_costo := case when v_ant_stock > 0 then round((v_ant_stock * v_ant_costo + v_buena * v_unit) / (v_ant_stock + v_buena), 2) else v_unit end;
  update public.productos set stock_actual = stock_actual + v_buena, costo = v_nuevo_costo, updated_at = now() where id = p.id and auth_user_id = p_uid;
  update public.ordenes_produccion set estado = 'completada', cantidad_producida = v_buena, costo_materiales = v_mat, costo_total = v_total,
    costo_unitario = v_unit, merma_cantidad = v_merma,
    merma_motivo = case when v_merma > 0 then coalesce(nullif(btrim(coalesce(p_merma_motivo, '')), ''), o.merma_motivo) else null end,
    porcentaje_avance = 100, actualizo_costo_producto = true, fecha_completada = now(), updated_at = now()
    where id = o.id;
  return jsonb_build_object('ok', true, 'tipo', 'normal', 'cantidad_producida', v_buena, 'costo_materiales', v_mat, 'costo_total', v_total,
    'costo_unitario', v_unit, 'costo_anterior', v_ant_costo, 'costo_nuevo', v_nuevo_costo);
end $f$;
revoke all on function public._produccion_completar(uuid, uuid, numeric, text) from public, anon, authenticated;

-- Completar una orden que ya existe (pendiente o en proceso).
create or replace function public.produccion_completar_orden(p_orden_id uuid, p_cantidad_buena numeric default null, p_merma_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); v_r jsonb; v_msg text; v_det text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  begin
    v_r := public._produccion_completar(v_uid, p_orden_id, p_cantidad_buena, p_merma_motivo);
  exception when others then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    if v_msg like 'produccion:%' then
      return jsonb_build_object('ok', false, 'motivo', substr(v_msg, 12), 'faltantes', case when v_det like '[%' then v_det::jsonb else null end);
    end if;
    raise;
  end;
  return v_r;
end $f$;
revoke all on function public.produccion_completar_orden(uuid, numeric, text) from public, anon;
grant execute on function public.produccion_completar_orden(uuid, numeric, text) to authenticated;

-- Crear la orden y completarla de una vez ("Producir ahora"). Si no se puede completar,
-- tampoco queda la orden creada (todo o nada).
create or replace function public.produccion_crear_y_completar(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); r public.recetas_produccion%rowtype; v_id uuid; v_num text; v_r jsonb; v_msg text; v_det text;
  v_cant numeric; v_merma numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  select * into r from public.recetas_produccion where id = nullif(p_datos->>'receta_id', '')::uuid and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_receta'); end if;
  v_cant := nullif(p_datos->>'cantidad_planificada', '')::numeric;
  if v_cant is null or v_cant <= 0 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  v_merma := least(v_cant, greatest(0, coalesce(nullif(p_datos->>'merma_cantidad', '')::numeric, 0)));
  begin
    v_num := public.generar_numero_orden_produccion(v_uid);
    insert into public.ordenes_produccion(auth_user_id, numero, tipo, receta_id, producto_terminado_id, cantidad_planificada, fecha_planificada, fecha_entrega,
      costo_mano_obra, costo_indirecto, merma_cantidad, merma_motivo, usuario_nombre, estado)
    values (v_uid, coalesce(v_num, 'OP-' || extract(epoch from now())::bigint), coalesce(r.tipo, 'normal'), r.id,
      case when coalesce(r.tipo, 'normal') = 'despiece' then null else r.producto_terminado_id end,
      v_cant, current_date, nullif(p_datos->>'fecha_entrega', '')::date,
      greatest(0, coalesce(nullif(p_datos->>'costo_mano_obra', '')::numeric, 0)), greatest(0, coalesce(nullif(p_datos->>'costo_indirecto', '')::numeric, 0)),
      case when coalesce(r.tipo, 'normal') = 'despiece' then 0 else v_merma end,
      left(nullif(btrim(coalesce(p_datos->>'merma_motivo', '')), ''), 300), left(coalesce(p_datos->>'usuario_nombre', 'Usuario'), 120), 'pendiente')
    returning id into v_id;
    v_r := public._produccion_completar(v_uid, v_id, case when coalesce(r.tipo, 'normal') = 'despiece' then null else v_cant - v_merma end, p_datos->>'merma_motivo');
  exception when others then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    if v_msg like 'produccion:%' then
      return jsonb_build_object('ok', false, 'motivo', substr(v_msg, 12), 'faltantes', case when v_det like '[%' then v_det::jsonb else null end);
    end if;
    raise;
  end;
  return v_r || jsonb_build_object('orden_id', v_id, 'numero', v_num);
end $f$;
revoke all on function public.produccion_crear_y_completar(jsonb) from public, anon;
grant execute on function public.produccion_crear_y_completar(jsonb) to authenticated;
