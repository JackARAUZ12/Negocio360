-- =====================================================================
-- PANADERÍA · Fase 1 (2-nov-2026) — Panel: Hoy · Plan de horneado · Cierre del día
-- Solo AGREGA (una columna apagada por defecto, tablas nuevas y funciones nuevas).
-- Candados:
--   * Todo cambio pasa por funciones del servidor; las tablas nuevas son de SOLO LECTURA
--     para la pantalla (RLS sin permisos de escritura).
--   * Nada de esto toca Caja ni dinero.
--   * Hornear = la MISMA función de Producción ya probada (produccion_crear_y_completar):
--     descuenta ingredientes, suma el pan, actualiza su costo; nunca deja stock negativo.
--     Varias recetas a la vez van en TODO O NADA: si falta harina para una, no se produce ninguna.
--     Cada clic lleva una clave única: el mismo clic dos veces no produce dos veces.
--   * Cierre del día: uno solo por fecha (ni doble clic ni dos personas lo repiten).
--     Las bajas usan la MISMA función de merma ya existente (produccion_merma_registrar):
--     nunca más de lo que hay, con su costo, y llegan a Contabilidad como ajuste que baja.
--   * Todo funciona solo si el negocio activó la Panadería (usa_modulo_panaderia).
-- =====================================================================

alter table public.configuracion_empresa add column if not exists usa_modulo_panaderia boolean not null default false;

-- Lo que debe haber en vitrina de cada pan, por día de la semana (0 = domingo … 6 = sábado)
create table if not exists public.panaderia_vitrina (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  producto_id uuid not null references public.productos(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  cantidad numeric(12,2) not null default 0 check (cantidad >= 0 and cantidad <= 100000),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, producto_id, dia_semana)
);

-- Cada clic de "Hornear" (clave única = no se repite)
create table if not exists public.panaderia_horneadas (
  id uuid primary key,
  auth_user_id uuid not null,
  fecha date not null,
  lineas jsonb not null,
  resultado jsonb,
  usuario_nombre text,
  created_at timestamptz not null default now()
);

-- Cierre del día (uno por fecha) y su detalle
create table if not exists public.panaderia_cierres (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  fecha date not null,
  total_desecho numeric(14,3) not null default 0,
  total_faltante numeric(14,3) not null default 0,
  total_costo numeric(14,2) not null default 0,
  nota text,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  unique (auth_user_id, fecha)
);
create table if not exists public.panaderia_cierre_lineas (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.panaderia_cierres(id) on delete cascade,
  auth_user_id uuid not null,
  producto_id uuid,
  producto_nombre text,
  stock_sistema numeric(14,3) not null,
  sobro numeric(14,3) not null,
  faltante numeric(14,3) not null default 0,
  desecho numeric(14,3) not null default 0,
  motivo text,
  costo_unitario numeric(14,4) not null default 0,
  costo_total numeric(14,2) not null default 0,
  nota text
);
create index if not exists panaderia_cierre_lineas_cierre on public.panaderia_cierre_lineas(cierre_id);
create index if not exists panaderia_cierre_lineas_prod on public.panaderia_cierre_lineas(auth_user_id, producto_id);

-- Solo lectura desde la pantalla (cada negocio ve lo suyo). Escribir: solo las funciones de abajo.
alter table public.panaderia_vitrina enable row level security;
alter table public.panaderia_horneadas enable row level security;
alter table public.panaderia_cierres enable row level security;
alter table public.panaderia_cierre_lineas enable row level security;
drop policy if exists panaderia_vitrina_ver on public.panaderia_vitrina;
create policy panaderia_vitrina_ver on public.panaderia_vitrina for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists panaderia_horneadas_ver on public.panaderia_horneadas;
create policy panaderia_horneadas_ver on public.panaderia_horneadas for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists panaderia_cierres_ver on public.panaderia_cierres;
create policy panaderia_cierres_ver on public.panaderia_cierres for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists panaderia_cierre_lineas_ver on public.panaderia_cierre_lineas;
create policy panaderia_cierre_lineas_ver on public.panaderia_cierre_lineas for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.panaderia_vitrina, public.panaderia_horneadas, public.panaderia_cierres, public.panaderia_cierre_lineas from anon, authenticated;
grant select on public.panaderia_vitrina, public.panaderia_horneadas, public.panaderia_cierres, public.panaderia_cierre_lineas to authenticated;

create or replace function public._panaderia_activa(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select usa_modulo_panaderia from configuracion_empresa where auth_user_id = p_uid limit 1), false)
$$;

create or replace function public._panaderia_hoy()
returns date language sql stable as $$ select (now() at time zone 'America/Managua')::date $$;

-- ---------------------------------------------------------------------
-- Plan del día (solo LEE): qué pan hornear, cuánto, y los números del día
-- ---------------------------------------------------------------------
create or replace function public.panaderia_plan(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_f date := coalesce(p_fecha, public._panaderia_hoy()); v_dow int; v_prod jsonb; v_cierre jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._panaderia_activa(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_dow := extract(dow from v_f)::int;
  with rec as (
    select distinct on (r.producto_terminado_id) r.id receta_id, r.nombre receta_nombre, coalesce(r.cantidad_producida, 1) rinde, r.producto_terminado_id producto_id
      from recetas_produccion r
     where r.auth_user_id = v_uid and coalesce(r.activa, true) and coalesce(r.tipo, 'normal') = 'normal'
       and not coalesce(r.al_vender, false) and r.producto_terminado_id is not null
     order by r.producto_terminado_id, r.updated_at desc nulls last, r.created_at desc
  ),
  vend as (
    select d.producto_id, (v.fecha at time zone 'America/Managua')::date dia,
           sum(d.cantidad * coalesce(nullif(d.presentacion_factor, 0), 1)) cant
      from venta_detalles d join ventas v on v.id = d.venta_id
     where d.auth_user_id = v_uid and v.auth_user_id = v_uid and coalesce(v.estado, '') not in ('anulada', 'anulado')
       and v.fecha >= ((v_f - 28)::timestamp at time zone 'America/Managua')
       and v.fecha < ((v_f + 1)::timestamp at time zone 'America/Managua')
       and d.producto_id in (select producto_id from rec)
     group by 1, 2
  ),
  horn as (
    select o.producto_terminado_id producto_id, (o.fecha_completada at time zone 'America/Managua')::date dia, sum(coalesce(o.cantidad_producida, 0)) cant
      from ordenes_produccion o
     where o.auth_user_id = v_uid and o.estado = 'completada' and o.producto_terminado_id in (select producto_id from rec)
       and o.fecha_completada >= ((v_f - 7)::timestamp at time zone 'America/Managua')
       and o.fecha_completada < ((v_f + 1)::timestamp at time zone 'America/Managua')
     group by 1, 2
  ),
  merma as (
    select l.producto_id, sum(l.desecho) desecho, sum(l.faltante) faltante
      from panaderia_cierre_lineas l join panaderia_cierres c on c.id = l.cierre_id
     where c.auth_user_id = v_uid and c.fecha between v_f - 7 and v_f - 1
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'receta_id', rec.receta_id, 'receta_nombre', rec.receta_nombre, 'rinde', rec.rinde,
      'producto_id', p.id, 'nombre', p.nombre, 'stock', coalesce(p.stock_actual, 0), 'costo', coalesce(p.costo, 0), 'precio', coalesce(p.precio, 0),
      'objetivo', coalesce(vt.cantidad, 0),
      'sugerido', ceil(coalesce((select sum(cant) from vend where vend.producto_id = p.id and vend.dia in (v_f - 7, v_f - 14, v_f - 21, v_f - 28)), 0) / 4.0),
      'vendido_hoy', coalesce((select sum(cant) from vend where vend.producto_id = p.id and vend.dia = v_f), 0),
      'horneado_hoy', coalesce((select sum(cant) from horn where horn.producto_id = p.id and horn.dia = v_f), 0),
      'horneado_7d', coalesce((select sum(cant) from horn where horn.producto_id = p.id and horn.dia between v_f - 7 and v_f - 1), 0),
      'desecho_7d', coalesce(m.desecho, 0), 'faltante_7d', coalesce(m.faltante, 0),
      'a_hornear', greatest(0, ceil(coalesce(vt.cantidad, 0) - coalesce(p.stock_actual, 0)))
    ) order by p.nombre), '[]'::jsonb)
    into v_prod
    from rec join productos p on p.id = rec.producto_id and p.auth_user_id = v_uid and coalesce(p.activo, true)
    left join panaderia_vitrina vt on vt.auth_user_id = v_uid and vt.producto_id = p.id and vt.dia_semana = v_dow
    left join merma m on m.producto_id = p.id;
  select jsonb_build_object('fecha', c.fecha, 'total_desecho', c.total_desecho, 'total_faltante', c.total_faltante, 'total_costo', c.total_costo, 'usuario', c.usuario_nombre)
    into v_cierre from panaderia_cierres c where c.auth_user_id = v_uid and c.fecha < v_f order by c.fecha desc limit 1;
  return jsonb_build_object('ok', true, 'fecha', v_f, 'dia_semana', v_dow, 'productos', v_prod,
    'cierre_hoy', exists (select 1 from panaderia_cierres where auth_user_id = v_uid and fecha = v_f),
    'ultimo_cierre', v_cierre);
end $$;

-- ---------------------------------------------------------------------
-- Ingredientes que necesita un plan (solo LEE): misma fórmula que Producción
-- ---------------------------------------------------------------------
create or replace function public.panaderia_ingredientes(p_lineas jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_res jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._panaderia_activa(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if jsonb_typeof(p_lineas) is distinct from 'array' then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  with l as (
    select (x->>'receta_id')::uuid receta_id, sum((x->>'cantidad')::numeric) cant
      from jsonb_array_elements(p_lineas) x
     where coalesce((x->>'cantidad')::numeric, 0) > 0 group by 1
  ),
  nec as (
    select rc.producto_id,
           sum(rc.cantidad * public._unidad_factor(rc.unidad_codigo, pr.unidad_codigo, pr.unidad_compra_codigo, pr.factor_compra) * l.cant / nullif(coalesce(r.cantidad_producida, 1), 0)) necesario,
           bool_or(public._unidad_factor(rc.unidad_codigo, pr.unidad_codigo, pr.unidad_compra_codigo, pr.factor_compra) is null) sin_factor
      from l join recetas_produccion r on r.id = l.receta_id and r.auth_user_id = v_uid
      join receta_componentes rc on rc.receta_id = r.id and rc.auth_user_id = v_uid and not rc.uso_continuo
      left join productos pr on pr.id = rc.producto_id and pr.auth_user_id = v_uid
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', p.id, 'nombre', coalesce(p.nombre, '—'), 'unidad', p.unidad_codigo,
           'necesario', round(coalesce(nec.necesario, 0), 3), 'disponible', coalesce(p.stock_actual, 0),
           'falta', greatest(0, round(coalesce(nec.necesario, 0) - coalesce(p.stock_actual, 0), 3)),
           'costo', round(coalesce(nec.necesario, 0) * coalesce(p.costo, 0), 2), 'unidad_mala', nec.sin_factor)
         order by (coalesce(nec.necesario, 0) > coalesce(p.stock_actual, 0)) desc, p.nombre), '[]'::jsonb)
    into v_res from nec left join productos p on p.id = nec.producto_id and p.auth_user_id = v_uid;
  return jsonb_build_object('ok', true, 'ingredientes', v_res);
end $$;

-- ---------------------------------------------------------------------
-- Guardar lo que debe haber en vitrina (por día de la semana)
-- ---------------------------------------------------------------------
create or replace function public.panaderia_vitrina_guardar(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); x jsonb; v_n int := 0; v_pid uuid; v_dia int; v_cant numeric;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._panaderia_activa(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 3000 then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  for x in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid := (x->>'producto_id')::uuid; v_dia := (x->>'dia')::int; v_cant := round((x->>'cantidad')::numeric, 2);
    exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    if v_dia is null or v_dia < 0 or v_dia > 6 or v_cant is null or v_cant < 0 or v_cant > 100000 then
      return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
    if not exists (select 1 from productos where id = v_pid and auth_user_id = v_uid and tipo = 'producto') then
      return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
    insert into panaderia_vitrina (auth_user_id, producto_id, dia_semana, cantidad, updated_at)
    values (v_uid, v_pid, v_dia, v_cant, now())
    on conflict (auth_user_id, producto_id, dia_semana) do update set cantidad = excluded.cantidad, updated_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'guardados', v_n);
end $$;

-- ---------------------------------------------------------------------
-- HORNEAR: varias recetas en una sola operación (todo o nada, sin repetir)
-- ---------------------------------------------------------------------
create or replace function public.panaderia_hornear(p_clave uuid, p_lineas jsonb, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); x jsonb; r record; v_r jsonb; v_res jsonb := '[]'::jsonb; v_fallo jsonb; v_prev jsonb;
  v_rid uuid; v_cant numeric; v_ids uuid[] := '{}'; v_n int := 0; v_costo numeric := 0;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._panaderia_activa(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_clave is null then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_lineas'); end if;
  if jsonb_array_length(p_lineas) > 100 then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  -- Un horneado a la vez por negocio (dos pantallas al mismo tiempo no se cruzan)
  perform pg_advisory_xact_lock(hashtext('n360_panaderia_hornear:' || v_uid::text));
  select resultado into v_prev from panaderia_horneadas where id = p_clave;
  if found then return jsonb_build_object('ok', false, 'motivo', 'ya_procesado', 'resultado', v_prev); end if;
  -- Validar todo ANTES de tocar nada
  for x in select * from jsonb_array_elements(p_lineas) loop
    begin v_rid := (x->>'receta_id')::uuid; v_cant := round((x->>'cantidad')::numeric, 2);
    exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    if v_cant is null or v_cant <= 0 or v_cant > 100000 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
    if v_rid = any(v_ids) then return jsonb_build_object('ok', false, 'motivo', 'repetida'); end if;
    if not exists (select 1 from recetas_produccion where id = v_rid and auth_user_id = v_uid and coalesce(activa, true)
                    and coalesce(tipo, 'normal') = 'normal' and not coalesce(al_vender, false) and producto_terminado_id is not null) then
      return jsonb_build_object('ok', false, 'motivo', 'receta'); end if;
    v_ids := v_ids || v_rid;
  end loop;
  begin
    insert into panaderia_horneadas (id, auth_user_id, fecha, lineas, usuario_nombre)
    values (p_clave, v_uid, public._panaderia_hoy(), p_lineas, left(coalesce(p_usuario, 'Usuario'), 120));
    for x in select * from jsonb_array_elements(p_lineas) loop
      v_rid := (x->>'receta_id')::uuid; v_cant := round((x->>'cantidad')::numeric, 2);
      select r2.id, p.nombre into r from recetas_produccion r2 join productos p on p.id = r2.producto_terminado_id where r2.id = v_rid;
      v_r := public.produccion_crear_y_completar(jsonb_build_object('receta_id', v_rid, 'cantidad_planificada', v_cant,
               'usuario_nombre', left(coalesce(p_usuario, 'Usuario'), 120) || ' (Panadería)'));
      if coalesce((v_r->>'ok')::boolean, false) is not true then
        v_fallo := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('producto', r.nombre);
        raise exception 'panaderia:fallo';
      end if;
      v_n := v_n + 1; v_costo := v_costo + coalesce((v_r->>'costo_total')::numeric, 0);
      v_res := v_res || jsonb_build_object('producto', r.nombre, 'cantidad', v_r->'cantidad_producida', 'numero', v_r->'numero',
                                           'costo_unitario', v_r->'costo_unitario', 'costo_total', v_r->'costo_total');
    end loop;
    update panaderia_horneadas set resultado = jsonb_build_object('ordenes', v_res, 'costo_total', v_costo) where id = p_clave;
  exception when others then
    if sqlerrm = 'panaderia:fallo' then
      return jsonb_build_object('ok', false, 'motivo', coalesce(v_fallo->>'motivo', 'fallo'), 'producto', v_fallo->>'producto', 'faltantes', v_fallo->'faltantes');
    end if;
    raise;
  end;
  return jsonb_build_object('ok', true, 'ordenes', v_res, 'cantidad_recetas', v_n, 'costo_total', round(v_costo, 2));
end $$;

-- ---------------------------------------------------------------------
-- CIERRE DEL DÍA: lo que sobró, lo que se bota/dona y lo que faltó (uno por fecha, todo o nada)
-- ---------------------------------------------------------------------
create or replace function public.panaderia_cerrar_dia(p_fecha date, p_lineas jsonb, p_nota text default null, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := public._panaderia_hoy(); x jsonb; p record; v_cid uuid; v_r jsonb;
  v_sobro numeric; v_des numeric; v_falt numeric; v_mot text; v_motm text; v_nota text; v_costo numeric; v_ids uuid[] := '{}'; v_pid uuid;
  v_tdes numeric := 0; v_tfalt numeric := 0; v_tcosto numeric := 0; v_fallo jsonb; v_extra text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._panaderia_activa(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 3 then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end if;
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_lineas'); end if;
  if jsonb_array_length(p_lineas) > 500 then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_panaderia_cierre:' || v_uid::text));
  if exists (select 1 from panaderia_cierres where auth_user_id = v_uid and fecha = p_fecha) then
    return jsonb_build_object('ok', false, 'motivo', 'ya_cerrado'); end if;
  -- Validar todo ANTES de tocar nada
  for x in select * from jsonb_array_elements(p_lineas) loop
    begin v_pid := (x->>'producto_id')::uuid; v_sobro := round((x->>'sobro')::numeric, 3); v_des := round(coalesce((x->>'desecho')::numeric, 0), 3);
    exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    v_mot := coalesce(nullif(x->>'motivo', ''), 'no_vendido');
    if v_sobro is null or v_sobro < 0 or v_des < 0 or v_des > v_sobro then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
    if v_mot not in ('no_vendido', 'danado', 'vencido', 'donacion', 'consumo_personal') then return jsonb_build_object('ok', false, 'motivo', 'motivo'); end if;
    if v_pid = any(v_ids) then return jsonb_build_object('ok', false, 'motivo', 'repetida'); end if;
    if not exists (select 1 from productos where id = v_pid and auth_user_id = v_uid and tipo = 'producto') then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
    v_ids := v_ids || v_pid;
  end loop;
  begin
    insert into panaderia_cierres (auth_user_id, fecha, nota, usuario_nombre)
    values (v_uid, p_fecha, left(nullif(btrim(coalesce(p_nota, '')), ''), 300), left(coalesce(p_usuario, 'Usuario'), 120))
    returning id into v_cid;
    for x in select * from jsonb_array_elements(p_lineas) loop
      v_pid := (x->>'producto_id')::uuid; v_sobro := round((x->>'sobro')::numeric, 3); v_des := round(coalesce((x->>'desecho')::numeric, 0), 3);
      v_mot := coalesce(nullif(x->>'motivo', ''), 'no_vendido'); v_extra := null;
      select id, nombre, stock_actual, costo into p from productos where id = v_pid and auth_user_id = v_uid for update;
      v_falt := greatest(0, round(coalesce(p.stock_actual, 0) - v_sobro, 3));
      if v_sobro > coalesce(p.stock_actual, 0) then v_extra := 'Se contó más de lo que dice el sistema (' || coalesce(p.stock_actual, 0) || '): no se agregó nada.'; end if;
      if v_des > coalesce(p.stock_actual, 0) - v_falt then
        v_fallo := jsonb_build_object('motivo', 'desecho_mayor', 'producto', p.nombre, 'hay', coalesce(p.stock_actual, 0)); raise exception 'panaderia:fallo';
      end if;
      -- Lo que falta en el conteo (no se vendió por sistema ni quedó): baja como merma "otro"
      if v_falt > 0 then
        v_r := public.produccion_merma_registrar(p.id, v_falt, 'otro', 'Faltante al contar en el cierre de panadería del ' || to_char(p_fecha, 'DD/MM/YYYY'));
        if coalesce((v_r->>'ok')::boolean, false) is not true then v_fallo := coalesce(v_r, '{}') || jsonb_build_object('producto', p.nombre); raise exception 'panaderia:fallo'; end if;
      end if;
      -- Lo que se bota, se dona o consume el personal
      if v_des > 0 then
        v_motm := case v_mot when 'no_vendido' then 'no_vendido' when 'danado' then 'danado' when 'vencido' then 'vencido' else 'otro' end;
        v_nota := 'Cierre de panadería del ' || to_char(p_fecha, 'DD/MM/YYYY') || case v_mot when 'donacion' then ' · Donación' when 'consumo_personal' then ' · Consumo del personal' else '' end
                  || coalesce(' · ' || nullif(btrim(coalesce(x->>'nota', '')), ''), '');
        v_r := public.produccion_merma_registrar(p.id, v_des, v_motm, v_nota);
        if coalesce((v_r->>'ok')::boolean, false) is not true then v_fallo := coalesce(v_r, '{}') || jsonb_build_object('producto', p.nombre); raise exception 'panaderia:fallo'; end if;
      end if;
      v_costo := round((v_falt + v_des) * coalesce(p.costo, 0), 2);
      insert into panaderia_cierre_lineas (cierre_id, auth_user_id, producto_id, producto_nombre, stock_sistema, sobro, faltante, desecho, motivo, costo_unitario, costo_total, nota)
      values (v_cid, v_uid, p.id, p.nombre, coalesce(p.stock_actual, 0), v_sobro, v_falt, v_des, case when v_des > 0 then v_mot end, coalesce(p.costo, 0), v_costo,
              left(concat_ws(' · ', nullif(btrim(coalesce(x->>'nota', '')), ''), v_extra), 300));
      v_tdes := v_tdes + v_des; v_tfalt := v_tfalt + v_falt; v_tcosto := v_tcosto + v_costo;
    end loop;
    update panaderia_cierres set total_desecho = v_tdes, total_faltante = v_tfalt, total_costo = v_tcosto where id = v_cid;
  exception when others then
    if sqlerrm = 'panaderia:fallo' then
      return jsonb_build_object('ok', false, 'motivo', coalesce(v_fallo->>'motivo', 'fallo'), 'producto', v_fallo->>'producto', 'hay', coalesce(v_fallo->'hay', v_fallo->'disponible'));
    end if;
    raise;
  end;
  return jsonb_build_object('ok', true, 'cierre_id', v_cid, 'desecho', v_tdes, 'faltante', v_tfalt, 'costo', round(v_tcosto, 2));
end $$;

revoke all on function public._panaderia_activa(uuid) from public, anon;
revoke all on function public.panaderia_plan(date) from public, anon;
revoke all on function public.panaderia_ingredientes(jsonb) from public, anon;
revoke all on function public.panaderia_vitrina_guardar(jsonb) from public, anon;
revoke all on function public.panaderia_hornear(uuid, jsonb, text) from public, anon;
revoke all on function public.panaderia_cerrar_dia(date, jsonb, text, text) from public, anon;
grant execute on function public.panaderia_plan(date) to authenticated;
grant execute on function public.panaderia_ingredientes(jsonb) to authenticated;
grant execute on function public.panaderia_vitrina_guardar(jsonb) to authenticated;
grant execute on function public.panaderia_hornear(uuid, jsonb, text) to authenticated;
grant execute on function public.panaderia_cerrar_dia(date, jsonb, text, text) to authenticated;
