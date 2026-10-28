-- =====================================================================
-- Producción · Fase 4: comida que se prepara al vender + insumos que se van gastando
-- (SOLO AGREGA: columnas nuevas con valor por defecto, una tabla, funciones y reglas nuevas;
--  no se cambia venta_registrar_atomica ni venta_anular_atomica.)
--
-- 1) recetas_produccion.al_vender: la receta se descuenta al VENDER el plato (hamburguesa).
--    Regla nueva en venta_detalles (antes de guardar la línea): si el producto tiene receta
--    "al vender" y la venta se está guardando en ESTA misma operación (Ventas, Restaurante y
--    Clínica la guardan así, en venta_registrar_atomica), se descuentan sus ingredientes y se
--    anota lo descontado en venta_receta_consumos. Otras pantallas que agregan líneas a una
--    venta ya existente (créditos, proformas…) no se tocan.
-- 2) Promociones: la línea guarda los productos elegidos (venta_detalles.componentes_promo)
--    y se anotan, para poder devolverlos al anular (antes no regresaban al inventario).
-- 3) Regla nueva al ANULAR una venta: devuelve lo anotado (una sola vez) y, en los platos
--    "al vender", resta lo que la anulación sumó al plato (el plato no lleva inventario propio).
-- 4) receta_componentes.uso_continuo: ingredientes que se van gastando (aceite, gas, sal):
--    no se descuentan por plato ni por tanda; se descuentan al "abrir uno nuevo"
--    (produccion_insumo_abrir), como ajuste de existencia con su costo. Nada toca Caja.
-- =====================================================================

alter table public.recetas_produccion add column if not exists al_vender boolean not null default false;
alter table public.receta_componentes add column if not exists uso_continuo boolean not null default false;
alter table public.venta_detalles add column if not exists componentes_promo jsonb;
comment on column public.recetas_produccion.al_vender is 'Se prepara al vender: sus ingredientes se descuentan en cada venta del producto.';
comment on column public.receta_componentes.uso_continuo is 'Se va gastando con el tiempo (aceite, gas…): se descuenta al abrir uno nuevo, no por plato.';
comment on column public.venta_detalles.componentes_promo is 'Productos elegidos en una promoción [{producto_id, cantidad}], para devolverlos al anular.';

create table if not exists public.venta_receta_consumos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  venta_id uuid not null,
  venta_detalle_id uuid,
  plato_id uuid,
  producto_id uuid not null,
  cantidad numeric not null check (cantidad >= 0),
  costo_unitario numeric not null default 0,
  origen text not null check (origen in ('receta', 'promocion')),
  devuelto boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists venta_receta_consumos_venta_idx on public.venta_receta_consumos(venta_id);
alter table public.venta_receta_consumos enable row level security;
create policy venta_receta_consumos_ver on public.venta_receta_consumos for select using (auth_user_id = auth.uid());

create table if not exists public.insumo_aperturas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  producto_id uuid not null,
  cantidad numeric not null check (cantidad > 0),
  costo_total numeric not null default 0,
  nota text,
  created_at timestamptz not null default now()
);
create index if not exists insumo_aperturas_prod_idx on public.insumo_aperturas(auth_user_id, producto_id, created_at);
alter table public.insumo_aperturas enable row level security;
create policy insumo_aperturas_ver on public.insumo_aperturas for select using (auth_user_id = auth.uid());

-- (1) y (2): al guardar cada línea de una venta nueva
create or replace function public._venta_detalle_receta()
returns trigger language plpgsql security definer set search_path = public as $f$
declare r public.recetas_produccion%rowtype; c record; v_misma boolean; v_cant numeric; v_nec numeric; v_antes numeric; v_desc numeric; v_costo numeric; e jsonb;
begin
  if coalesce(new.cantidad, 0) <= 0 or new.auth_user_id is null or new.venta_id is null then return new; end if;
  -- Solo si la venta se está guardando en esta misma operación (venta nueva)
  select (v.xmin::text = (txid_current() % 4294967296)::text) into v_misma from public.ventas v where v.id = new.venta_id;
  if not coalesce(v_misma, false) then return new; end if;

  -- Promoción: se anota lo elegido (la venta ya lo descuenta) para devolverlo al anular
  if new.componentes_promo is not null and jsonb_typeof(new.componentes_promo) = 'array' then
    for e in select * from jsonb_array_elements(new.componentes_promo) loop
      if nullif(e->>'producto_id', '') is null or coalesce((e->>'cantidad')::numeric, 0) <= 0 then continue; end if;
      insert into public.venta_receta_consumos(auth_user_id, venta_id, venta_detalle_id, plato_id, producto_id, cantidad, costo_unitario, origen)
      select new.auth_user_id, new.venta_id, new.id, null, pr.id, (e->>'cantidad')::numeric, coalesce(pr.costo, 0), 'promocion'
        from public.productos pr where pr.id = (e->>'producto_id')::uuid and pr.auth_user_id = new.auth_user_id;
    end loop;
    return new;
  end if;

  if new.producto_id is null then return new; end if;
  select * into r from public.recetas_produccion
   where auth_user_id = new.auth_user_id and producto_terminado_id = new.producto_id and al_vender and activa
   order by updated_at desc nulls last limit 1;
  if not found then return new; end if;
  v_cant := new.cantidad * case when coalesce(new.presentacion_factor, 0) > 0 then new.presentacion_factor else 1 end;
  for c in select rc.producto_id,
                  sum(rc.cantidad * public._unidad_factor(rc.unidad_codigo, pr.unidad_codigo, pr.unidad_compra_codigo, pr.factor_compra)) cant
           from public.receta_componentes rc
           join public.productos pr on pr.id = rc.producto_id and pr.auth_user_id = new.auth_user_id
           where rc.receta_id = r.id and rc.auth_user_id = new.auth_user_id and not rc.uso_continuo
           group by rc.producto_id order by rc.producto_id loop
    if c.cant is null then continue; end if;                 -- unidad sin conversión: no se descuenta (no frena la venta)
    v_nec := round(c.cant * v_cant / nullif(coalesce(r.cantidad_producida, 1), 0), 3);
    if v_nec is null or v_nec <= 0 then continue; end if;
    select coalesce(stock_actual, 0), coalesce(costo, 0) into v_antes, v_costo from public.productos
     where id = c.producto_id and auth_user_id = new.auth_user_id and tipo = 'producto' for update;
    if not found then continue; end if;
    v_desc := least(v_nec, greatest(v_antes, 0));             -- como la venta: nunca queda en negativo
    update public.productos set stock_actual = round(v_antes - v_desc, 3), updated_at = now() where id = c.producto_id;
    insert into public.venta_receta_consumos(auth_user_id, venta_id, venta_detalle_id, plato_id, producto_id, cantidad, costo_unitario, origen)
    values (new.auth_user_id, new.venta_id, new.id, new.producto_id, c.producto_id, v_desc, v_costo, 'receta');
  end loop;
  return new;
end $f$;
revoke all on function public._venta_detalle_receta() from public, anon, authenticated;
create trigger trg_venta_detalle_receta before insert on public.venta_detalles
  for each row execute function public._venta_detalle_receta();

-- (3) al anular una venta
create or replace function public._venta_anulada_devolver_receta()
returns trigger language plpgsql security definer set search_path = public as $f$
declare k record; d record;
begin
  for k in select * from public.venta_receta_consumos where venta_id = new.id and auth_user_id = new.auth_user_id and not devuelto for update loop
    update public.productos set stock_actual = round(coalesce(stock_actual, 0) + k.cantidad, 3), updated_at = now()
     where id = k.producto_id and auth_user_id = new.auth_user_id and tipo = 'producto';
    update public.venta_receta_consumos set devuelto = true where id = k.id;
  end loop;
  -- El plato "al vender" no lleva inventario: se resta lo que la anulación le sumó.
  for d in select vd.producto_id, vd.cantidad * case when coalesce(vd.presentacion_factor, 0) > 0 then vd.presentacion_factor else 1 end cant
             from public.venta_detalles vd
            where vd.venta_id = new.id and vd.auth_user_id = new.auth_user_id and vd.tipo_item = 'producto' and vd.producto_id is not null
              and exists (select 1 from public.venta_receta_consumos k2 where k2.venta_detalle_id = vd.id and k2.origen = 'receta') loop
    update public.productos set stock_actual = round(greatest(0, coalesce(stock_actual, 0) - d.cant), 3), updated_at = now()
     where id = d.producto_id and auth_user_id = new.auth_user_id and tipo = 'producto';
  end loop;
  return new;
end $f$;
revoke all on function public._venta_anulada_devolver_receta() from public, anon, authenticated;
create trigger trg_venta_anulada_devolver_receta after update of estado on public.ventas
  for each row when (new.estado = 'anulada' and old.estado is distinct from 'anulada')
  execute function public._venta_anulada_devolver_receta();

-- (4) "Abrí uno nuevo": baja del insumo como ajuste de existencia (gasto de cocina), sin Caja
create or replace function public.produccion_insumo_abrir(p_producto_id uuid, p_cantidad numeric default 1, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); p record; v_cant numeric := round(coalesce(p_cantidad, 0), 3); v_costo numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if v_cant <= 0 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  select id, nombre, stock_actual, costo into p from public.productos
   where id = p_producto_id and auth_user_id = v_uid and tipo = 'producto' for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if coalesce(p.stock_actual, 0) < v_cant then
    return jsonb_build_object('ok', false, 'motivo', 'sin_existencia', 'disponible', coalesce(p.stock_actual, 0));
  end if;
  v_costo := round(v_cant * coalesce(p.costo, 0), 2);
  update public.productos set stock_actual = round(stock_actual - v_cant, 3), updated_at = now() where id = p.id;
  insert into public.movimientos_inventario(auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota, descuenta_caja, costo_unitario, costo_total)
  values (v_uid, p.id, 'ajuste_manual', 'consumo_insumo', -v_cant, p.stock_actual, round(p.stock_actual - v_cant, 3),
          left(coalesce(nullif(btrim(coalesce(p_nota, '')), ''), 'Se abrió uno nuevo'), 300), false, coalesce(p.costo, 0), v_costo);
  insert into public.insumo_aperturas(auth_user_id, producto_id, cantidad, costo_total, nota)
  values (v_uid, p.id, v_cant, v_costo, left(nullif(btrim(coalesce(p_nota, '')), ''), 300));
  return jsonb_build_object('ok', true, 'costo_total', v_costo, 'stock_despues', round(p.stock_actual - v_cant, 3));
end $f$;
revoke all on function public.produccion_insumo_abrir(uuid, numeric, text) from public, anon;
grant execute on function public.produccion_insumo_abrir(uuid, numeric, text) to authenticated;

-- (4b) Producción por tandas: los ingredientes "que se van gastando" tampoco se descuentan por tanda
-- (misma función de la Fase 3, solo con ese filtro).
create or replace function public._produccion_completar_reales(p_uid uuid, p_orden_id uuid, p_cantidad_buena numeric, p_merma_motivo text, p_reales jsonb)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  o public.ordenes_produccion%rowtype; r public.recetas_produccion%rowtype;
  v_factor numeric; c record; p record; v_nec numeric; v_falt jsonb := '[]'::jsonb;
  v_mat numeric := 0; v_total numeric; v_buena numeric; v_merma numeric; v_unit numeric;
  v_ant_stock numeric; v_ant_costo numeric; v_nuevo_costo numeric;
  s record; v_cant numeric; v_valor numeric; v_suma numeric := 0; v_asig numeric; v_cu numeric; v_lista jsonb := '[]'::jsonb; e jsonb;
  v_sal jsonb := '[]'::jsonb; v_consumo jsonb := coalesce(p_reales->'consumo', '{}'::jsonb); v_salidas jsonb := coalesce(p_reales->'salidas', '{}'::jsonb);
  v_entro numeric := 0; v_salio numeric := 0;
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
  if jsonb_typeof(v_consumo) <> 'object' or jsonb_typeof(v_salidas) <> 'object' then raise exception 'produccion:pesos'; end if;

  for c in select rc.producto_id,
                  sum(rc.cantidad * public._unidad_factor(rc.unidad_codigo, pr.unidad_codigo, pr.unidad_compra_codigo, pr.factor_compra)) cant,
                  bool_or(rc.unidad_codigo is not null and rc.unidad_codigo <> '') con_unidad,
                  bool_or(pr.id is not null and public._unidad_factor(rc.unidad_codigo, pr.unidad_codigo, pr.unidad_compra_codigo, pr.factor_compra) is null) sin_factor
           from public.receta_componentes rc
           left join public.productos pr on pr.id = rc.producto_id and pr.auth_user_id = p_uid
           where rc.receta_id = r.id and rc.auth_user_id = p_uid and not rc.uso_continuo group by rc.producto_id order by rc.producto_id loop
    if c.sin_factor then raise exception 'produccion:unidad'; end if;
    if v_consumo ? c.producto_id::text then
      v_nec := round((v_consumo->>c.producto_id::text)::numeric, 3);           -- peso real de lo que entró
      if v_nec is null or v_nec <= 0 then raise exception 'produccion:pesos'; end if;
    else
      v_nec := round(c.cant * v_factor, case when c.con_unidad then 3 else 2 end);
    end if;
    v_entro := v_entro + v_nec;
    select id, nombre, stock_actual, costo into p from public.productos where id = c.producto_id and auth_user_id = p_uid for update;
    if not found then raise exception 'produccion:materia_no_existe'; end if;
    if coalesce(p.stock_actual, 0) < v_nec then
      v_falt := v_falt || jsonb_build_object('nombre', p.nombre, 'necesario', v_nec, 'disponible', coalesce(p.stock_actual, 0));
    end if;
    v_lista := v_lista || jsonb_build_object('id', c.producto_id, 'nec', v_nec);
  end loop;
  if jsonb_array_length(v_falt) > 0 then
    raise exception using message = 'produccion:falta_materia', detail = v_falt::text;
  end if;

  for e in select * from jsonb_array_elements(v_lista) loop
    v_nec := (e->>'nec')::numeric;
    update public.productos set stock_actual = stock_actual - v_nec, updated_at = now()
      where id = (e->>'id')::uuid and auth_user_id = p_uid
      returning id, nombre, sku, stock_actual, costo into p;
    insert into public.orden_produccion_consumos(auth_user_id, orden_id, producto_id, producto_nombre, producto_sku, cantidad_consumida, costo_unitario, subtotal, stock_antes, stock_despues)
    values (p_uid, o.id, p.id, p.nombre, p.sku, v_nec, coalesce(p.costo, 0), round(v_nec * coalesce(p.costo, 0), 2), p.stock_actual + v_nec, p.stock_actual);
    v_mat := v_mat + round(v_nec * coalesce(p.costo, 0), 2);
  end loop;
  v_total := round(v_mat + coalesce(o.costo_mano_obra, 0) + coalesce(o.costo_indirecto, 0), 2);

  if coalesce(o.tipo, 'normal') = 'despiece' then
    -- Cantidades de cada corte (peso real si se mandó) y su valor; luego se reparte el costo.
    for s in select ds.producto_id, ds.cantidad_rendimiento, ds.es_merma, pr.precio
             from public.receta_despiece_salidas ds left join public.productos pr on pr.id = ds.producto_id and pr.auth_user_id = p_uid
             where ds.receta_id = r.id and ds.auth_user_id = p_uid order by ds.producto_id loop
      if v_salidas ? s.producto_id::text then
        v_cant := round((v_salidas->>s.producto_id::text)::numeric, 3);
        if v_cant is null or v_cant < 0 then raise exception 'produccion:pesos'; end if;
      else
        v_cant := round(s.cantidad_rendimiento * o.cantidad_planificada, 2);
      end if;
      v_salio := v_salio + v_cant;
      v_valor := case when s.es_merma then 0 else round(v_cant * coalesce(s.precio, 0), 2) end;
      v_suma := v_suma + v_valor;
      v_sal := v_sal || jsonb_build_object('id', s.producto_id, 'cant', v_cant, 'valor', v_valor, 'merma', s.es_merma);
    end loop;
    for e in select * from jsonb_array_elements(v_sal) loop
      v_cant := (e->>'cant')::numeric;
      if v_cant <= 0 then continue; end if;
      select id, nombre, stock_actual, costo into p from public.productos where id = (e->>'id')::uuid and auth_user_id = p_uid for update;
      if not found then raise exception 'produccion:salida_no_existe'; end if;
      v_valor := (e->>'valor')::numeric;
      v_asig := case when v_suma > 0 then round(v_valor / v_suma * v_total, 2) else 0 end;
      v_cu := round(v_asig / v_cant, 2);
      if not (e->>'merma')::boolean then
        v_ant_stock := coalesce(p.stock_actual, 0); v_ant_costo := coalesce(p.costo, 0);
        v_nuevo_costo := case when v_ant_stock > 0 then round((v_ant_stock * v_ant_costo + v_cant * v_cu) / (v_ant_stock + v_cant), 2) else v_cu end;
        update public.productos set stock_actual = stock_actual + v_cant, costo = v_nuevo_costo, updated_at = now() where id = p.id and auth_user_id = p_uid;
      end if;
      insert into public.orden_despiece_resultados(auth_user_id, orden_id, producto_id, producto_nombre, cantidad_obtenida, valor_relativo, costo_asignado, costo_unitario)
      values (p_uid, o.id, p.id, p.nombre, v_cant, v_valor, v_asig, v_cu);
    end loop;
    update public.ordenes_produccion set estado = 'completada', costo_materiales = v_mat, costo_total = v_total,
      porcentaje_avance = 100, actualizo_costo_producto = true, fecha_completada = now(), updated_at = now(),
      observaciones = case when p_reales is not null and p_reales <> '{}'::jsonb
        then left(coalesce(observaciones || ' · ', '') || 'Pesos reales: entró ' || v_entro || ', salió ' || v_salio, 500) else observaciones end
      where id = o.id;
    return jsonb_build_object('ok', true, 'tipo', 'despiece', 'costo_materiales', v_mat, 'costo_total', v_total, 'entro', v_entro, 'salio', v_salio);
  end if;

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
revoke all on function public._produccion_completar_reales(uuid, uuid, numeric, text, jsonb) from public, anon, authenticated;
