-- =====================================================================
-- Ciclo opcional (Fase 3a): Stock mínimo -> sugerir y crear órdenes de producción
-- (SOLO AGREGA: una columna con valor falso y dos funciones. No cambia nada existente.)
--
-- * Opción propia "usa_stock_minimo_produccion" (apagada por defecto). Requiere además
--   "Pedidos con producción" activo.
-- * produccion_sugerencias_stock_minimo(): SOLO LEE. Para cada producto con stock mínimo y UNA sola
--   receta normal activa, calcula: faltante = mínimo - existencia - lo que ya está en órdenes
--   pendientes/en proceso; y propone producir ese faltante redondeado hacia arriba a tandas completas.
-- * produccion_crear_ordenes_stock_minimo(productos): recalcula en el servidor (no confía en cantidades
--   del navegador) y crea órdenes PENDIENTES. Nunca mueve inventario ni Caja.
--   Candados: un clic repetido no duplica (lo ya en cola se descuenta); lock por negocio.
-- =====================================================================

alter table public.configuracion_empresa
  add column if not exists usa_stock_minimo_produccion boolean not null default false;

create or replace function public._produccion_sugerencias_calc(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  p record; v_recs uuid[]; r record; v_cola numeric; v_def numeric; v_sug numeric;
  v_items jsonb := '[]'::jsonb; v_omit jsonb := '[]'::jsonb;
begin
  for p in select id, nombre, sku, stock_actual, stock_minimo from public.productos
            where auth_user_id = p_uid and tipo = 'producto' and coalesce(stock_minimo, 0) > 0
              and coalesce(stock_actual, 0) < stock_minimo
            order by nombre loop
    select array_agg(id) into v_recs from public.recetas_produccion
     where auth_user_id = p_uid and producto_terminado_id = p.id
       and coalesce(activa, true) and coalesce(tipo, 'normal') = 'normal' and coalesce(al_vender, false) = false;
    if v_recs is null or array_length(v_recs, 1) = 0 then
      v_omit := v_omit || jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'motivo', 'sin_receta'); continue;
    end if;
    if array_length(v_recs, 1) > 1 then
      v_omit := v_omit || jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'motivo', 'varias_recetas'); continue;
    end if;
    select * into r from public.recetas_produccion where id = v_recs[1];
    select coalesce(sum(cantidad_planificada), 0) into v_cola from public.ordenes_produccion
     where auth_user_id = p_uid and producto_terminado_id = p.id and estado in ('pendiente', 'en_proceso')
       and coalesce(tipo, 'normal') = 'normal';
    v_def := p.stock_minimo - coalesce(p.stock_actual, 0) - v_cola;
    if v_def <= 0 then continue; end if;
    if coalesce(r.cantidad_producida, 0) <= 0 then
      v_omit := v_omit || jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'motivo', 'receta'); continue;
    end if;
    v_sug := ceil(v_def / r.cantidad_producida) * r.cantidad_producida;
    v_items := v_items || jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'sku', p.sku,
      'stock_actual', coalesce(p.stock_actual, 0), 'stock_minimo', p.stock_minimo, 'en_cola', v_cola,
      'faltante', v_def, 'tanda', r.cantidad_producida, 'sugerida', v_sug, 'receta_id', r.id, 'receta', r.nombre);
  end loop;
  return jsonb_build_object('ok', true, 'items', v_items, 'omitidos', v_omit);
end;
$f$;
revoke all on function public._produccion_sugerencias_calc(uuid) from public, anon, authenticated;

create or replace function public.produccion_sugerencias_stock_minimo()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_uid uuid := auth.uid(); v_a boolean; v_b boolean;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  select coalesce(usa_ciclo_produccion_pedidos, false), coalesce(usa_stock_minimo_produccion, false)
    into v_a, v_b from public.configuracion_empresa where auth_user_id = v_uid;
  if not (coalesce(v_a, false) and coalesce(v_b, false)) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  return public._produccion_sugerencias_calc(v_uid);
end;
$f$;
revoke all on function public.produccion_sugerencias_stock_minimo() from public, anon;
grant execute on function public.produccion_sugerencias_stock_minimo() to authenticated;

create or replace function public.produccion_crear_ordenes_stock_minimo(p_producto_ids uuid[], p_usuario text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_uid uuid := auth.uid(); v_a boolean; v_b boolean; v_calc jsonb; it jsonb; r record;
  v_hoy date := (now() at time zone 'America/Managua')::date; v_num text; v_n int; v_id uuid; v_mo numeric;
  v_creadas jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_prod_sm:' || v_uid::text, 0));
  select coalesce(usa_ciclo_produccion_pedidos, false), coalesce(usa_stock_minimo_produccion, false)
    into v_a, v_b from public.configuracion_empresa where auth_user_id = v_uid;
  if not (coalesce(v_a, false) and coalesce(v_b, false)) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then return jsonb_build_object('ok', false, 'motivo', 'sin_productos'); end if;

  v_calc := public._produccion_sugerencias_calc(v_uid);
  for it in select x from jsonb_array_elements(v_calc -> 'items') x
             where (x ->> 'producto_id')::uuid = any(p_producto_ids) loop
    select * into r from public.recetas_produccion where id = (it ->> 'receta_id')::uuid;
    v_mo := round(coalesce(r.costo_extra_tanda, 0) * (it ->> 'sugerida')::numeric / nullif(coalesce(r.cantidad_producida, 1), 0), 2);
    v_num := public.generar_numero_orden_produccion(v_uid);
    v_n := coalesce(nullif(substring(v_num from '(\d+)$'), '')::int, 0);
    while exists (select 1 from public.ordenes_produccion where auth_user_id = v_uid and numero = v_num) loop
      v_n := v_n + 1; v_num := 'OP-' || lpad(v_n::text, 6, '0');
    end loop;
    insert into public.ordenes_produccion(auth_user_id, numero, tipo, receta_id, producto_terminado_id,
      cantidad_planificada, fecha_planificada, costo_mano_obra, costo_indirecto, merma_cantidad, usuario_nombre, estado, observaciones)
    values (v_uid, v_num, 'normal', r.id, r.producto_terminado_id, (it ->> 'sugerida')::numeric, v_hoy,
      coalesce(v_mo, 0), 0, 0, left(coalesce(nullif(btrim(p_usuario), ''), 'Usuario'), 120), 'pendiente',
      left('Stock mínimo: hay ' || (it ->> 'stock_actual') || ', mínimo ' || (it ->> 'stock_minimo'), 300))
    returning id into v_id;
    v_creadas := v_creadas || jsonb_build_object('orden_id', v_id, 'numero', v_num, 'producto', it ->> 'nombre', 'cantidad', (it ->> 'sugerida')::numeric);
  end loop;
  return jsonb_build_object('ok', true, 'creadas', v_creadas);
end;
$f$;
revoke all on function public.produccion_crear_ordenes_stock_minimo(uuid[], text) from public, anon;
grant execute on function public.produccion_crear_ordenes_stock_minimo(uuid[], text) to authenticated;
