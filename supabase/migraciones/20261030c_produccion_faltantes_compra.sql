-- =====================================================================
-- Ciclo opcional (Fase 2): materia prima que falta para producir -> orden de compra
-- (SOLO AGREGA: una tabla de vínculos y tres funciones. No cambia ninguna función, tabla ni dato existente.)
--
-- * produccion_faltantes(orden_ids): SOLO LEE. Calcula, con la misma fórmula que usa "Completar producción"
--   (receta x cantidad / rendimiento, con conversión de unidades, sin insumos de uso continuo), cuánta materia
--   prima necesitan las órdenes juntas, cuánta hay y cuánta falta (el stock se cuenta una sola vez).
-- * produccion_crear_ordenes_compra(orden_ids): con la opción "Pedidos con producción" activa, crea
--   ÓRDENES DE COMPRA (una por proveedor) con lo que falta. Una orden de compra es solo una solicitud al
--   proveedor: NO toca Caja ni Inventario; después se convierte en compra real desde Compras.
--   Candados: bloquea si alguna de las órdenes ya tiene una orden de compra pendiente (no se compra dos veces);
--   solo órdenes propias, pendientes o en proceso, de receta normal.
-- =====================================================================

create table if not exists public.orden_compra_origen (
  id                  uuid primary key default gen_random_uuid(),
  auth_user_id        uuid not null references auth.users(id) on delete cascade,
  orden_compra_id     uuid not null references public.ordenes_compra(id) on delete cascade,
  orden_produccion_id uuid not null references public.ordenes_produccion(id) on delete cascade,
  created_at          timestamptz not null default now(),
  unique (orden_compra_id, orden_produccion_id)
);
create index if not exists orden_compra_origen_prod_idx on public.orden_compra_origen(orden_produccion_id);
create index if not exists orden_compra_origen_user_idx on public.orden_compra_origen(auth_user_id);
alter table public.orden_compra_origen enable row level security;
drop policy if exists orden_compra_origen_ver on public.orden_compra_origen;
create policy orden_compra_origen_ver on public.orden_compra_origen
  for select using (auth_user_id = (select auth.uid()));

-- Cálculo interno (solo lo llaman las dos funciones de abajo).
create or replace function public._produccion_faltantes_calc(p_uid uuid, p_orden_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  o record; r record; c record; p record; v_factor numeric; v_nec numeric; k text; v_falta numeric;
  v_need jsonb := '{}'::jsonb; v_ord jsonb := '[]'::jsonb; v_ign jsonb := '[]'::jsonb; v_items jsonb := '[]'::jsonb;
begin
  for o in select * from public.ordenes_produccion where id = any(coalesce(p_orden_ids, '{}')) and auth_user_id = p_uid order by numero loop
    if o.estado not in ('pendiente', 'en_proceso') or coalesce(o.tipo, 'normal') <> 'normal' then
      v_ign := v_ign || jsonb_build_object('numero', o.numero, 'motivo', 'no_aplica'); continue;
    end if;
    select * into r from public.recetas_produccion where id = o.receta_id and auth_user_id = p_uid;
    if not found then v_ign := v_ign || jsonb_build_object('numero', o.numero, 'motivo', 'sin_receta'); continue; end if;
    v_factor := o.cantidad_planificada / nullif(coalesce(r.cantidad_producida, 1), 0);
    if v_factor is null then v_ign := v_ign || jsonb_build_object('numero', o.numero, 'motivo', 'receta'); continue; end if;

    for c in select rc.producto_id,
                    sum(rc.cantidad * public._unidad_factor(rc.unidad_codigo, pr.unidad_codigo, pr.unidad_compra_codigo, pr.factor_compra)) cant,
                    bool_or(rc.unidad_codigo is not null and rc.unidad_codigo <> '') con_unidad,
                    bool_or(pr.id is not null and public._unidad_factor(rc.unidad_codigo, pr.unidad_codigo, pr.unidad_compra_codigo, pr.factor_compra) is null) sin_factor
               from public.receta_componentes rc
               left join public.productos pr on pr.id = rc.producto_id and pr.auth_user_id = p_uid
              where rc.receta_id = r.id and rc.auth_user_id = p_uid and not coalesce(rc.uso_continuo, false)
              group by rc.producto_id order by rc.producto_id loop
      if c.sin_factor then return jsonb_build_object('ok', false, 'motivo', 'unidad', 'orden', o.numero); end if;
      v_nec := round(c.cant * v_factor, case when c.con_unidad then 3 else 2 end);
      v_need := jsonb_set(v_need, array[c.producto_id::text],
                          to_jsonb(coalesce((v_need ->> c.producto_id::text)::numeric, 0) + v_nec), true);
    end loop;
    v_ord := v_ord || jsonb_build_object('id', o.id, 'numero', o.numero);
  end loop;

  for k in select jsonb_object_keys(v_need) loop
    select id, nombre, sku, stock_actual, costo, proveedor_id, proveedor_nombre, unidad_codigo into p
      from public.productos where id = k::uuid and auth_user_id = p_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'materia_no_existe'); end if;
    v_falta := greatest(0, round((v_need ->> k)::numeric - coalesce(p.stock_actual, 0), 3));
    v_items := v_items || jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'sku', p.sku,
      'necesario', round((v_need ->> k)::numeric, 3), 'disponible', coalesce(p.stock_actual, 0), 'falta', v_falta,
      'costo', coalesce(p.costo, 0), 'proveedor_id', p.proveedor_id, 'proveedor_nombre', p.proveedor_nombre, 'unidad', p.unidad_codigo);
  end loop;

  return jsonb_build_object('ok', true, 'items', v_items, 'ordenes', v_ord, 'ignoradas', v_ign);
end;
$f$;
revoke all on function public._produccion_faltantes_calc(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.produccion_faltantes(p_orden_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  return public._produccion_faltantes_calc(v_uid, p_orden_ids);
end;
$f$;
revoke all on function public.produccion_faltantes(uuid[]) from public, anon;
grant execute on function public.produccion_faltantes(uuid[]) to authenticated;

create or replace function public.produccion_crear_ordenes_compra(p_orden_ids uuid[], p_usuario text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_uid uuid := auth.uid(); v_activo boolean; v_res jsonb; v_ocs text; g record; it jsonb;
  v_hoy date := (now() at time zone 'America/Managua')::date; v_oc uuid; v_num text; v_sub numeric; v_lin numeric;
  v_creadas jsonb := '[]'::jsonb; v_nums text; o jsonb;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_prod_oc:' || v_uid::text, 0));

  select coalesce(usa_ciclo_produccion_pedidos, false) into v_activo from public.configuracion_empresa where auth_user_id = v_uid;
  if not coalesce(v_activo, false) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_orden_ids is null or array_length(p_orden_ids, 1) is null then return jsonb_build_object('ok', false, 'motivo', 'sin_ordenes'); end if;

  -- No se compra dos veces lo mismo: si alguna orden ya tiene una orden de compra pendiente, se avisa.
  select string_agg(distinct oc.numero, ', ') into v_ocs
    from public.orden_compra_origen x join public.ordenes_compra oc on oc.id = x.orden_compra_id
   where x.auth_user_id = v_uid and x.orden_produccion_id = any(p_orden_ids) and oc.estado = 'pendiente';
  if v_ocs is not null then return jsonb_build_object('ok', false, 'motivo', 'ya_tiene_oc', 'ocs', v_ocs); end if;

  v_res := public._produccion_faltantes_calc(v_uid, p_orden_ids);
  if not (v_res ->> 'ok')::boolean then return v_res; end if;
  if jsonb_array_length(v_res -> 'ordenes') = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_ordenes'); end if;

  select string_agg(x ->> 'numero', ', ') into v_nums from jsonb_array_elements(v_res -> 'ordenes') x;

  -- Una orden de compra por proveedor (los productos sin proveedor van juntos en una).
  for g in
    select (i ->> 'proveedor_id') as prov_id, max(i ->> 'proveedor_nombre') as prov_nombre
      from jsonb_array_elements(v_res -> 'items') i
     where (i ->> 'falta')::numeric > 0
     group by (i ->> 'proveedor_id')
     order by (i ->> 'proveedor_id') nulls first
  loop
    v_num := public.siguiente_numero_orden_compra(v_uid);
    v_sub := 0;
    for it in select i from jsonb_array_elements(v_res -> 'items') i
               where (i ->> 'falta')::numeric > 0 and (i ->> 'proveedor_id') is not distinct from g.prov_id loop
      v_sub := v_sub + round((it ->> 'falta')::numeric * (it ->> 'costo')::numeric, 2);
    end loop;

    insert into public.ordenes_compra(auth_user_id, numero, proveedor_id, proveedor_nombre, fecha, subtotal, descuento_total,
      iva_porcentaje, iva_monto, total, estado, observaciones, usuario_nombre)
    values (v_uid, v_num, g.prov_id::uuid, g.prov_nombre, v_hoy, v_sub, 0, 0, 0, v_sub, 'pendiente',
      left('Materia prima faltante para producción: ' || v_nums, 500),
      left(coalesce(nullif(btrim(p_usuario), ''), 'Usuario'), 120))
    returning id into v_oc;

    for it in select i from jsonb_array_elements(v_res -> 'items') i
               where (i ->> 'falta')::numeric > 0 and (i ->> 'proveedor_id') is not distinct from g.prov_id loop
      v_lin := round((it ->> 'falta')::numeric * (it ->> 'costo')::numeric, 2);
      insert into public.orden_compra_detalles(auth_user_id, orden_compra_id, producto_id, producto_nombre, producto_sku,
        cantidad, costo_unitario, descuento, iva_porcentaje, iva_monto, subtotal)
      values (v_uid, v_oc, (it ->> 'producto_id')::uuid, it ->> 'nombre', it ->> 'sku',
        (it ->> 'falta')::numeric, (it ->> 'costo')::numeric, 0, 0, 0, v_lin);
    end loop;

    for o in select x from jsonb_array_elements(v_res -> 'ordenes') x loop
      insert into public.orden_compra_origen(auth_user_id, orden_compra_id, orden_produccion_id)
      values (v_uid, v_oc, (o ->> 'id')::uuid);
    end loop;

    v_creadas := v_creadas || jsonb_build_object('id', v_oc, 'numero', v_num, 'proveedor', g.prov_nombre, 'total', v_sub);
  end loop;

  return jsonb_build_object('ok', true, 'creadas', v_creadas, 'nada_falta', jsonb_array_length(v_creadas) = 0);
end;
$f$;
revoke all on function public.produccion_crear_ordenes_compra(uuid[], text) from public, anon;
grant execute on function public.produccion_crear_ordenes_compra(uuid[], text) to authenticated;
