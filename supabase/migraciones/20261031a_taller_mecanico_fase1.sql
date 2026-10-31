-- =====================================================================
-- TALLER MECÁNICO · Fase 1 (vehículos terrestres: autos, camionetas, motos, camiones, buses, pesados)
-- SOLO AGREGA: una opción apagada por defecto, cinco tablas y las funciones del taller.
-- No cambia ninguna tabla ni función existente.
--
-- SEGURIDAD
--  * Las tablas del taller se pueden LEER solo por su dueño (RLS). Nadie puede escribir directo: ni insert,
--    ni update, ni delete desde el navegador. TODO cambio pasa por funciones que validan sesión, dueño,
--    opción encendida, estados permitidos y tamaños; los totales los calcula SIEMPRE el servidor.
--  * Un cliente, vehículo o producto de otra cuenta nunca se puede enlazar (se valida el dueño).
-- ANTI-DUPLICADO
--  * Placa única por negocio. Un solo vehículo no puede tener dos órdenes abiertas. Número de orden único.
--    Entregar es idempotente (repetirlo no crea otra venta) y una orden solo genera UNA venta.
-- CUADRE
--  * El inventario y el dinero se mueven SOLO al entregar, dentro de una sola operación (todo o nada):
--    venta + detalle + inventario + Caja (neto de IVA) + IVA a Impuestos + total del cliente.
--  * Lo que el cliente rechaza o no ha decidido NUNCA se cobra. No se entrega con líneas sin decidir.
-- =====================================================================

alter table public.configuracion_empresa
  add column if not exists usa_modulo_taller boolean not null default false;

-- ---------- Vehículos ----------
create table if not exists public.taller_vehiculos (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  cliente_id   uuid references public.clientes(id) on delete set null,
  tipo         text not null default 'auto' check (tipo in ('auto','camioneta','moto','camion','bus','pesado','otro')),
  placa        text check (placa is null or char_length(placa) <= 20),
  placa_norm   text not null default '' check (char_length(placa_norm) <= 20),
  vin          text check (vin is null or char_length(vin) <= 30),
  marca        text check (marca is null or char_length(marca) <= 60),
  modelo       text check (modelo is null or char_length(modelo) <= 60),
  anio         integer check (anio is null or (anio between 1900 and 2100)),
  color        text check (color is null or char_length(color) <= 40),
  km_actual    numeric(12,1) check (km_actual is null or km_actual >= 0),
  notas        text check (notas is null or char_length(notas) <= 1000),
  activo       boolean not null default true,
  creado_por   text check (creado_por is null or char_length(creado_por) <= 120),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists taller_vehiculos_placa_unica on public.taller_vehiculos(auth_user_id, placa_norm) where placa_norm <> '';
create index if not exists taller_vehiculos_user_idx on public.taller_vehiculos(auth_user_id, activo);
create index if not exists taller_vehiculos_cliente_idx on public.taller_vehiculos(cliente_id);

-- ---------- Órdenes ----------
create table if not exists public.taller_ordenes (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null references auth.users(id) on delete cascade,
  numero           text not null,
  vehiculo_id      uuid not null references public.taller_vehiculos(id) on delete restrict,
  cliente_id       uuid references public.clientes(id) on delete set null,
  cliente_nombre   text check (cliente_nombre is null or char_length(cliente_nombre) <= 200),
  estado           text not null default 'recibido' check (estado in ('recibido','diagnostico','esperando_aprobacion','en_reparacion','listo','entregado','cancelado')),
  prioridad        text not null default 'normal' check (prioridad in ('normal','urgente')),
  falla_reportada  text not null check (char_length(falla_reportada) between 3 and 2000),
  diagnostico      text check (diagnostico is null or char_length(diagnostico) <= 4000),
  observaciones    text check (observaciones is null or char_length(observaciones) <= 2000),
  mecanico_nombre  text check (mecanico_nombre is null or char_length(mecanico_nombre) <= 120),
  km_ingreso       numeric(12,1) check (km_ingreso is null or km_ingreso >= 0),
  km_salida        numeric(12,1) check (km_salida is null or km_salida >= 0),
  fecha_ingreso    timestamptz not null default now(),
  fecha_prometida  date,
  fecha_entrega    timestamptz,
  iva_activo       boolean not null default false,
  iva_porcentaje   numeric(5,2) not null default 15 check (iva_porcentaje between 0 and 100),
  subtotal         numeric(14,2) not null default 0,   -- solo líneas aprobadas
  descuento        numeric(14,2) not null default 0,
  impuesto         numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  costo_total      numeric(14,2) not null default 0,
  total_estimado   numeric(14,2) not null default 0,   -- aprobadas + sin decidir (con IVA)
  venta_id         uuid references public.ventas(id) on delete set null,
  creado_por       text check (creado_por is null or char_length(creado_por) <= 120),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists taller_ordenes_numero_unico on public.taller_ordenes(auth_user_id, numero);
create unique index if not exists taller_ordenes_una_abierta_por_vehiculo on public.taller_ordenes(vehiculo_id) where estado not in ('entregado','cancelado');
create unique index if not exists taller_ordenes_una_venta on public.taller_ordenes(venta_id) where venta_id is not null;
create index if not exists taller_ordenes_user_estado_idx on public.taller_ordenes(auth_user_id, estado);
create index if not exists taller_ordenes_vehiculo_idx on public.taller_ordenes(vehiculo_id);

-- ---------- Líneas del presupuesto ----------
create table if not exists public.taller_orden_lineas (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null references auth.users(id) on delete cascade,
  orden_id        uuid not null references public.taller_ordenes(id) on delete cascade,
  tipo            text not null check (tipo in ('mano_obra','repuesto','externo','otro')),
  producto_id     uuid references public.productos(id) on delete set null,
  descripcion     text not null check (char_length(descripcion) between 1 and 300),
  cantidad        numeric(14,3) not null check (cantidad > 0 and cantidad <= 1000000),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0 and precio_unitario <= 100000000),
  costo_unitario  numeric(14,2) not null default 0 check (costo_unitario >= 0 and costo_unitario <= 100000000),
  descuento       numeric(14,2) not null default 0 check (descuento >= 0),
  subtotal        numeric(14,2) not null default 0,
  aprobacion      text not null default 'pendiente' check (aprobacion in ('pendiente','aprobada','rechazada')),
  adicional       boolean not null default false,
  decidido_por    text check (decidido_por is null or char_length(decidido_por) <= 120),
  decidido_at     timestamptz,
  nota_decision   text check (nota_decision is null or char_length(nota_decision) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists taller_lineas_orden_idx on public.taller_orden_lineas(orden_id);
create index if not exists taller_lineas_user_idx on public.taller_orden_lineas(auth_user_id);

-- ---------- Bitácora de la orden ----------
create table if not exists public.taller_orden_historial (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  orden_id     uuid not null references public.taller_ordenes(id) on delete cascade,
  evento       text not null check (char_length(evento) <= 60),
  detalle      text check (detalle is null or char_length(detalle) <= 500),
  por          text check (por is null or char_length(por) <= 120),
  created_at   timestamptz not null default now()
);
create index if not exists taller_hist_orden_idx on public.taller_orden_historial(orden_id, created_at);

-- ---------- RLS: solo lectura del dueño; nadie escribe directo ----------
do $$
declare t text;
begin
  foreach t in array array['taller_vehiculos','taller_ordenes','taller_orden_lineas','taller_orden_historial'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select using (auth_user_id = (select auth.uid()))', t || '_ver', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- Ayudas internas (nadie las llama desde fuera) ----------
create or replace function public._taller_activo(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce((select usa_modulo_taller from public.configuracion_empresa where auth_user_id = p_uid), false);
$f$;
revoke all on function public._taller_activo(uuid) from public, anon, authenticated;

create or replace function public._taller_log(p_uid uuid, p_orden uuid, p_evento text, p_detalle text, p_por text)
returns void language sql security definer set search_path to 'public' as $f$
  insert into public.taller_orden_historial(auth_user_id, orden_id, evento, detalle, por)
  values (p_uid, p_orden, left(p_evento, 60), left(p_detalle, 500), left(nullif(btrim(p_por), ''), 120));
$f$;
revoke all on function public._taller_log(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Recalcula los totales de la orden. Solo cuentan las líneas APROBADAS (y, aparte, el estimado con las sin decidir).
create or replace function public._taller_recalcular(p_uid uuid, p_orden uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare o record; s numeric; d numeric; c numeric; se numeric; de numeric; imp numeric; impe numeric;
begin
  select * into o from public.taller_ordenes where id = p_orden and auth_user_id = p_uid;
  if not found then return; end if;
  update public.taller_orden_lineas set subtotal = round(cantidad * precio_unitario - descuento, 2), updated_at = now()
   where orden_id = p_orden and auth_user_id = p_uid and subtotal <> round(cantidad * precio_unitario - descuento, 2);
  select coalesce(sum(round(cantidad * precio_unitario, 2)), 0), coalesce(sum(descuento), 0), coalesce(sum(round(cantidad * costo_unitario, 2)), 0)
    into s, d, c from public.taller_orden_lineas where orden_id = p_orden and auth_user_id = p_uid and aprobacion = 'aprobada';
  select coalesce(sum(round(cantidad * precio_unitario, 2)), 0), coalesce(sum(descuento), 0)
    into se, de from public.taller_orden_lineas where orden_id = p_orden and auth_user_id = p_uid and aprobacion in ('aprobada', 'pendiente');
  imp := case when o.iva_activo then round(greatest(s - d, 0) * o.iva_porcentaje / 100, 2) else 0 end;
  impe := case when o.iva_activo then round(greatest(se - de, 0) * o.iva_porcentaje / 100, 2) else 0 end;
  update public.taller_ordenes set subtotal = s, descuento = d, impuesto = imp, total = round(greatest(s - d, 0) + imp, 2),
         costo_total = c, total_estimado = round(greatest(se - de, 0) + impe, 2), updated_at = now()
   where id = p_orden and auth_user_id = p_uid;
end;
$f$;
revoke all on function public._taller_recalcular(uuid, uuid) from public, anon, authenticated;

-- =====================================================================
-- VEHÍCULOS
-- =====================================================================
create or replace function public.taller_vehiculo_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); v_id uuid := nullif(p ->> 'id', '')::uuid; v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid;
  v_placa text := nullif(btrim(coalesce(p ->> 'placa', '')), ''); v_norm text; v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'auto');
  v_dup uuid; v_km numeric := nullif(p ->> 'km_actual', '')::numeric; v_anio integer := nullif(p ->> 'anio', '')::integer;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if v_tipo not in ('auto','camioneta','moto','camion','bus','pesado','otro') then return jsonb_build_object('ok', false, 'motivo', 'tipo'); end if;
  if v_placa is null and nullif(btrim(coalesce(p ->> 'vin', '')), '') is null then return jsonb_build_object('ok', false, 'motivo', 'sin_identificacion'); end if;
  if v_cli is not null and not exists (select 1 from public.clientes where id = v_cli and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  v_norm := coalesce(upper(regexp_replace(coalesce(v_placa, ''), '[^A-Za-z0-9]', '', 'g')), '');
  perform pg_advisory_xact_lock(hashtextextended('n360_taller_veh:' || v_uid::text, 0));
  if v_norm <> '' then
    select id into v_dup from public.taller_vehiculos where auth_user_id = v_uid and placa_norm = v_norm and id is distinct from v_id limit 1;
    if v_dup is not null then return jsonb_build_object('ok', false, 'motivo', 'placa_duplicada', 'existente_id', v_dup); end if;
  end if;
  if v_id is null then
    insert into public.taller_vehiculos(auth_user_id, cliente_id, tipo, placa, placa_norm, vin, marca, modelo, anio, color, km_actual, notas, creado_por)
    values (v_uid, v_cli, v_tipo, left(v_placa, 20), left(v_norm, 20), left(nullif(btrim(coalesce(p ->> 'vin', '')), ''), 30), left(nullif(btrim(coalesce(p ->> 'marca', '')), ''), 60),
            left(nullif(btrim(coalesce(p ->> 'modelo', '')), ''), 60), v_anio, left(nullif(btrim(coalesce(p ->> 'color', '')), ''), 40), v_km,
            left(nullif(btrim(coalesce(p ->> 'notas', '')), ''), 1000), left(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 120))
    returning id into v_id;
  else
    update public.taller_vehiculos set cliente_id = v_cli, tipo = v_tipo, placa = left(v_placa, 20), placa_norm = left(v_norm, 20),
           vin = left(nullif(btrim(coalesce(p ->> 'vin', '')), ''), 30), marca = left(nullif(btrim(coalesce(p ->> 'marca', '')), ''), 60),
           modelo = left(nullif(btrim(coalesce(p ->> 'modelo', '')), ''), 60), anio = v_anio, color = left(nullif(btrim(coalesce(p ->> 'color', '')), ''), 40),
           km_actual = v_km, notas = left(nullif(btrim(coalesce(p ->> 'notas', '')), ''), 1000), updated_at = now()
     where id = v_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$f$;
revoke all on function public.taller_vehiculo_guardar(jsonb) from public, anon;
grant execute on function public.taller_vehiculo_guardar(jsonb) to authenticated;

create or replace function public.taller_vehiculo_archivar(p_id uuid, p_activo boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); n text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if not coalesce(p_activo, false) then
    select numero into n from public.taller_ordenes where vehiculo_id = p_id and auth_user_id = v_uid and estado not in ('entregado', 'cancelado') limit 1;
    if n is not null then return jsonb_build_object('ok', false, 'motivo', 'orden_abierta', 'numero', n); end if;
  end if;
  update public.taller_vehiculos set activo = coalesce(p_activo, false), updated_at = now() where id = p_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end;
$f$;
revoke all on function public.taller_vehiculo_archivar(uuid, boolean) from public, anon;
grant execute on function public.taller_vehiculo_archivar(uuid, boolean) to authenticated;

-- =====================================================================
-- ÓRDENES
-- =====================================================================
create or replace function public.taller_orden_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); veh record; v_num text; v_n integer; v_id uuid; ab text; v_falla text := btrim(coalesce(p ->> 'falla_reportada', ''));
  v_cfg record; v_iva boolean; v_pct numeric; v_cli uuid; v_cnom text; v_km numeric := nullif(p ->> 'km_ingreso', '')::numeric;
  v_prom date := nullif(p ->> 'fecha_prometida', '')::date; v_prio text := coalesce(nullif(p ->> 'prioridad', ''), 'normal');
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if char_length(v_falla) < 3 then return jsonb_build_object('ok', false, 'motivo', 'falla'); end if;
  if v_prio not in ('normal', 'urgente') then return jsonb_build_object('ok', false, 'motivo', 'prioridad'); end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_taller_ord:' || v_uid::text, 0));
  select * into veh from public.taller_vehiculos where id = nullif(p ->> 'vehiculo_id', '')::uuid and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'vehiculo'); end if;
  if not veh.activo then return jsonb_build_object('ok', false, 'motivo', 'vehiculo_archivado'); end if;
  select numero into ab from public.taller_ordenes where vehiculo_id = veh.id and auth_user_id = v_uid and estado not in ('entregado', 'cancelado') limit 1;
  if ab is not null then return jsonb_build_object('ok', false, 'motivo', 'ya_abierta', 'numero', ab); end if;
  v_cli := veh.cliente_id;
  select nombre into v_cnom from public.clientes where id = v_cli and auth_user_id = v_uid;
  select coalesce(iva_activo, false) a, coalesce(iva_porcentaje_default, 15) b into v_cfg from public.configuracion_empresa where auth_user_id = v_uid;
  v_iva := coalesce(case when p ? 'iva_activo' then (p ->> 'iva_activo')::boolean end, v_cfg.a, false);
  v_pct := coalesce(nullif(p ->> 'iva_porcentaje', '')::numeric, v_cfg.b, 15);
  if v_pct < 0 or v_pct > 100 then v_pct := 15; end if;
  select coalesce(max(nullif(substring(numero from '(\d+)$'), '')::int), 0) + 1 into v_n from public.taller_ordenes where auth_user_id = v_uid;
  v_num := 'OT-' || lpad(v_n::text, 6, '0');
  insert into public.taller_ordenes(auth_user_id, numero, vehiculo_id, cliente_id, cliente_nombre, prioridad, falla_reportada, observaciones, mecanico_nombre,
                                    km_ingreso, fecha_prometida, iva_activo, iva_porcentaje, creado_por)
  values (v_uid, v_num, veh.id, v_cli, v_cnom, v_prio, left(v_falla, 2000), left(nullif(btrim(coalesce(p ->> 'observaciones', '')), ''), 2000),
          left(nullif(btrim(coalesce(p ->> 'mecanico_nombre', '')), ''), 120), v_km, v_prom, v_iva, v_pct, left(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 120))
  returning id into v_id;
  perform public._taller_log(v_uid, v_id, 'Orden creada', 'Recibido: ' || left(v_falla, 120), p ->> 'creado_por');
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num);
end;
$f$;
revoke all on function public.taller_orden_crear(jsonb) from public, anon;
grant execute on function public.taller_orden_crear(jsonb) to authenticated;

create or replace function public.taller_orden_actualizar(p_orden_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); o record; v_pct numeric; v_iva boolean; v_prio text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  v_iva := coalesce(case when p ? 'iva_activo' then (p ->> 'iva_activo')::boolean end, o.iva_activo);
  v_pct := coalesce(nullif(p ->> 'iva_porcentaje', '')::numeric, o.iva_porcentaje);
  if v_pct < 0 or v_pct > 100 then return jsonb_build_object('ok', false, 'motivo', 'iva'); end if;
  v_prio := coalesce(nullif(p ->> 'prioridad', ''), o.prioridad);
  if v_prio not in ('normal', 'urgente') then return jsonb_build_object('ok', false, 'motivo', 'prioridad'); end if;
  if p ? 'falla_reportada' and char_length(btrim(coalesce(p ->> 'falla_reportada', ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'falla'); end if;
  update public.taller_ordenes set
    falla_reportada = case when p ? 'falla_reportada' then left(btrim(p ->> 'falla_reportada'), 2000) else falla_reportada end,
    diagnostico = case when p ? 'diagnostico' then left(nullif(btrim(coalesce(p ->> 'diagnostico', '')), ''), 4000) else diagnostico end,
    observaciones = case when p ? 'observaciones' then left(nullif(btrim(coalesce(p ->> 'observaciones', '')), ''), 2000) else observaciones end,
    mecanico_nombre = case when p ? 'mecanico_nombre' then left(nullif(btrim(coalesce(p ->> 'mecanico_nombre', '')), ''), 120) else mecanico_nombre end,
    km_ingreso = case when p ? 'km_ingreso' then nullif(p ->> 'km_ingreso', '')::numeric else km_ingreso end,
    fecha_prometida = case when p ? 'fecha_prometida' then nullif(p ->> 'fecha_prometida', '')::date else fecha_prometida end,
    prioridad = v_prio, iva_activo = v_iva, iva_porcentaje = v_pct, updated_at = now()
   where id = o.id;
  perform public._taller_recalcular(v_uid, o.id);
  perform public._taller_log(v_uid, o.id, 'Datos actualizados', null, p ->> 'por');
  return jsonb_build_object('ok', true);
end;
$f$;
revoke all on function public.taller_orden_actualizar(uuid, jsonb) from public, anon;
grant execute on function public.taller_orden_actualizar(uuid, jsonb) to authenticated;

-- ---------- Líneas del presupuesto ----------
create or replace function public.taller_linea_guardar(p_orden_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); o record; v_id uuid := nullif(p ->> 'id', '')::uuid; v_tipo text := coalesce(p ->> 'tipo', ''); prod record; li record;
  v_cant numeric := nullif(p ->> 'cantidad', '')::numeric; v_pre numeric := nullif(p ->> 'precio_unitario', '')::numeric;
  v_costo numeric := coalesce(nullif(p ->> 'costo_unitario', '')::numeric, 0); v_desc numeric := coalesce(nullif(p ->> 'descuento', '')::numeric, 0);
  v_prod uuid := nullif(p ->> 'producto_id', '')::uuid; v_txt text := btrim(coalesce(p ->> 'descripcion', '')); v_adic boolean := false; v_hay_apr boolean;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  if v_tipo not in ('mano_obra', 'repuesto', 'externo', 'otro') then return jsonb_build_object('ok', false, 'motivo', 'tipo'); end if;
  if v_cant is null or v_cant <= 0 or v_cant > 1000000 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  if v_pre is null or v_pre < 0 or v_pre > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'precio'); end if;
  if v_costo < 0 or v_costo > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'costo'); end if;
  v_desc := round(v_desc, 2);
  if v_desc < 0 or v_desc > round(v_cant * v_pre, 2) then return jsonb_build_object('ok', false, 'motivo', 'descuento'); end if;
  if v_tipo = 'repuesto' and v_prod is not null then
    select id, nombre, sku, costo, tipo, stock_actual into prod from public.productos where id = v_prod and auth_user_id = v_uid;
    if not found or prod.tipo <> 'producto' then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
    v_costo := coalesce(prod.costo, 0);
    if v_txt = '' then v_txt := prod.nombre; end if;
  else
    v_prod := null;
  end if;
  if char_length(v_txt) < 1 then return jsonb_build_object('ok', false, 'motivo', 'descripcion'); end if;
  if v_tipo = 'mano_obra' then v_costo := 0; end if;
  select exists (select 1 from public.taller_orden_lineas where orden_id = o.id and aprobacion = 'aprobada') into v_hay_apr;
  if v_id is null then
    -- Una línea nueva en una orden que ya tenía lo aprobado es un TRABAJO ADICIONAL: pide su propia aprobación.
    v_adic := v_hay_apr;
    insert into public.taller_orden_lineas(auth_user_id, orden_id, tipo, producto_id, descripcion, cantidad, precio_unitario, costo_unitario, descuento, adicional)
    values (v_uid, o.id, v_tipo, v_prod, left(v_txt, 300), v_cant, round(v_pre, 2), round(v_costo, 2), v_desc, v_adic)
    returning id into v_id;
    perform public._taller_log(v_uid, o.id, case when v_adic then 'Trabajo adicional agregado' else 'Línea agregada' end, left(v_txt, 120), p ->> 'por');
  else
    select * into li from public.taller_orden_lineas where id = v_id and orden_id = o.id and auth_user_id = v_uid for update;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'linea'); end if;
    -- Cambiar una línea ya decidida obliga a que el cliente la apruebe de nuevo.
    update public.taller_orden_lineas set tipo = v_tipo, producto_id = v_prod, descripcion = left(v_txt, 300), cantidad = v_cant, precio_unitario = round(v_pre, 2),
           costo_unitario = round(v_costo, 2), descuento = v_desc, aprobacion = 'pendiente', decidido_por = null, decidido_at = null, nota_decision = null,
           adicional = li.adicional or (li.aprobacion = 'aprobada'), updated_at = now()
     where id = v_id;
    perform public._taller_log(v_uid, o.id, 'Línea modificada', left(v_txt, 120), p ->> 'por');
  end if;
  perform public._taller_recalcular(v_uid, o.id);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$f$;
revoke all on function public.taller_linea_guardar(uuid, jsonb) from public, anon;
grant execute on function public.taller_linea_guardar(uuid, jsonb) to authenticated;

create or replace function public.taller_linea_eliminar(p_linea_id uuid, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); li record; o record;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  select * into li from public.taller_orden_lineas where id = p_linea_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'linea'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || li.orden_id::text));
  select * into o from public.taller_ordenes where id = li.orden_id and auth_user_id = v_uid for update;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  delete from public.taller_orden_lineas where id = li.id;
  perform public._taller_recalcular(v_uid, o.id);
  perform public._taller_log(v_uid, o.id, 'Línea eliminada', left(li.descripcion, 120), p_por);
  return jsonb_build_object('ok', true);
end;
$f$;
revoke all on function public.taller_linea_eliminar(uuid, text) from public, anon;
grant execute on function public.taller_linea_eliminar(uuid, text) to authenticated;

-- ---------- Aprobación del cliente (por línea) ----------
create or replace function public.taller_decidir_lineas(p_orden_id uuid, p_linea_ids uuid[], p_decision text, p_por text default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); o record; n integer;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_decision not in ('aprobada', 'rechazada', 'pendiente') then return jsonb_build_object('ok', false, 'motivo', 'decision'); end if;
  if p_linea_ids is null or array_length(p_linea_ids, 1) is null then return jsonb_build_object('ok', false, 'motivo', 'sin_lineas'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  update public.taller_orden_lineas set aprobacion = p_decision,
         decidido_por = case when p_decision = 'pendiente' then null else left(nullif(btrim(coalesce(p_por, '')), ''), 120) end,
         decidido_at = case when p_decision = 'pendiente' then null else now() end,
         nota_decision = case when p_decision = 'pendiente' then null else left(nullif(btrim(coalesce(p_nota, '')), ''), 300) end, updated_at = now()
   where orden_id = o.id and auth_user_id = v_uid and id = any(p_linea_ids);
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_lineas'); end if;
  perform public._taller_recalcular(v_uid, o.id);
  perform public._taller_log(v_uid, o.id, 'Cliente ' || case p_decision when 'aprobada' then 'aprobó' when 'rechazada' then 'rechazó' else 'dejó pendiente' end,
                             n || ' línea(s)' || coalesce(' · ' || nullif(btrim(coalesce(p_nota, '')), ''), ''), p_por);
  return jsonb_build_object('ok', true, 'lineas', n);
end;
$f$;
revoke all on function public.taller_decidir_lineas(uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.taller_decidir_lineas(uuid, uuid[], text, text, text) to authenticated;

-- ---------- Cambio de estado (máquina de estados del servidor) ----------
create or replace function public.taller_orden_estado(p_orden_id uuid, p_nuevo text, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); o record; v_ok boolean; v_pend integer; v_apr integer;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.estado = p_nuevo then return jsonb_build_object('ok', true, 'sin_cambio', true); end if;
  if p_nuevo = 'entregado' then return jsonb_build_object('ok', false, 'motivo', 'usar_entregar'); end if;
  v_ok := case o.estado
    when 'recibido' then p_nuevo in ('diagnostico', 'cancelado')
    when 'diagnostico' then p_nuevo in ('esperando_aprobacion', 'en_reparacion', 'cancelado')
    when 'esperando_aprobacion' then p_nuevo in ('diagnostico', 'en_reparacion', 'cancelado')
    when 'en_reparacion' then p_nuevo in ('esperando_aprobacion', 'listo', 'cancelado')
    when 'listo' then p_nuevo in ('en_reparacion', 'cancelado')
    else false end;
  if not v_ok then return jsonb_build_object('ok', false, 'motivo', 'transicion', 'desde', o.estado, 'hacia', p_nuevo); end if;
  select count(*) filter (where aprobacion = 'pendiente'), count(*) filter (where aprobacion = 'aprobada')
    into v_pend, v_apr from public.taller_orden_lineas where orden_id = o.id;
  if p_nuevo = 'esperando_aprobacion' and v_pend = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada_por_aprobar'); end if;
  if p_nuevo = 'en_reparacion' and v_apr = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_aprobadas'); end if;
  if p_nuevo = 'listo' and v_pend > 0 then return jsonb_build_object('ok', false, 'motivo', 'lineas_pendientes', 'pendientes', v_pend); end if;
  update public.taller_ordenes set estado = p_nuevo, updated_at = now() where id = o.id;
  perform public._taller_log(v_uid, o.id, 'Estado: ' || p_nuevo, 'Antes: ' || o.estado, p_por);
  return jsonb_build_object('ok', true);
end;
$f$;
revoke all on function public.taller_orden_estado(uuid, text, text) from public, anon;
grant execute on function public.taller_orden_estado(uuid, text, text) to authenticated;

-- ---------- ENTREGA Y COBRO: crea la venta y mueve inventario/Caja/IVA en UNA sola operación ----------
create or replace function public.taller_orden_entregar(p_orden_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); o record; li record; r record; prod record; v_venta uuid; v_num text; v_hoy date := (now() at time zone 'America/Managua')::date;
  v_pend integer; v_apr integer; v_metodo text := nullif(btrim(coalesce(p ->> 'metodo_pago_nombre', '')), ''); v_metodo_id uuid := nullif(p ->> 'metodo_pago_id', '')::uuid;
  v_banco uuid := nullif(p ->> 'banco_id', '')::uuid; v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120);
  v_km numeric := nullif(p ->> 'km_salida', '')::numeric; v_caja numeric; v_mov uuid; v_saldo_imp numeric;
  v_cnom text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
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
  select nombre into v_cnom from public.clientes where id = o.cliente_id and auth_user_id = v_uid;

  v_num := public.generar_numero_venta(v_uid);
  insert into public.ventas(auth_user_id, numero_venta, cliente_id, cliente_nombre, fecha, subtotal, descuento, impuesto, total, costo_total,
                            metodo_pago_id, metodo_pago_nombre, estado, observaciones, iva_activo, iva_porcentaje, creado_por_nombre)
  values (v_uid, v_num, o.cliente_id, coalesce(v_cnom, o.cliente_nombre, 'Cliente final'), now(), o.subtotal, o.descuento, o.impuesto, o.total, o.costo_total,
          v_metodo_id, v_metodo, 'completada', 'Taller · Orden ' || o.numero, o.iva_activo, case when o.iva_activo then o.iva_porcentaje else 0 end, v_por)
  returning id into v_venta;

  for li in select * from public.taller_orden_lineas where orden_id = o.id and aprobacion = 'aprobada' order by created_at, id loop
    insert into public.venta_detalles(venta_id, auth_user_id, producto_id, producto_nombre, producto_sku, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia, es_regalia, vendido_sin_stock)
    values (v_venta, v_uid, li.producto_id, li.descripcion, (select sku from public.productos where id = li.producto_id), case when li.tipo = 'repuesto' and li.producto_id is not null then 'producto' else 'servicio' end,
            li.cantidad, li.precio_unitario, li.costo_unitario, li.descuento, li.subtotal, round(li.subtotal - li.cantidad * li.costo_unitario, 2), false, false);
  end loop;

  for r in select producto_id, sum(cantidad) q from public.taller_orden_lineas
            where orden_id = o.id and aprobacion = 'aprobada' and tipo = 'repuesto' and producto_id is not null group by producto_id loop
    update public.productos set stock_actual = stock_actual - r.q where id = r.producto_id and auth_user_id = v_uid;
  end loop;

  insert into public.movimientos_financieros(auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                             metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
  values (v_uid, 'INGRESO', 'VENTA', case when o.impuesto > 0 then 'Venta ' || v_num || ' (neto de IVA, taller ' || o.numero || ')' else 'Venta ' || v_num || ' (taller ' || o.numero || ')' end,
          v_caja, 0, 0, v_metodo_id, v_metodo, v_banco, 'venta', v_venta, null, v_hoy, 'completado')
  returning id into v_mov;
  update public.ventas set referencia_caja = v_mov where id = v_venta;

  if o.impuesto > 0 then
    select saldo_resultante into v_saldo_imp from public.movimientos_impuestos where auth_user_id = v_uid order by created_at desc limit 1;
    insert into public.movimientos_impuestos(auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, referencia_venta_id, fecha)
    values (v_uid, 'IVA_VENTA', 'IVA de venta ' || v_num || ' (taller ' || o.numero || ')', o.impuesto, coalesce(v_saldo_imp, 0), coalesce(v_saldo_imp, 0) + o.impuesto, v_venta, v_hoy);
  end if;

  if o.cliente_id is not null then
    update public.clientes set total_compras = coalesce(total_compras, 0) + o.total, num_compras = coalesce(num_compras, 0) + 1 where id = o.cliente_id and auth_user_id = v_uid;
  end if;

  update public.taller_vehiculos set km_actual = greatest(coalesce(km_actual, 0), coalesce(v_km, o.km_ingreso, 0)), updated_at = now() where id = o.vehiculo_id and auth_user_id = v_uid;
  update public.taller_ordenes set estado = 'entregado', venta_id = v_venta, fecha_entrega = now(), km_salida = coalesce(v_km, km_salida), updated_at = now() where id = o.id;
  perform public._taller_log(v_uid, o.id, 'Entregado y cobrado', 'Venta ' || v_num || ' · ' || v_metodo, v_por);
  return jsonb_build_object('ok', true, 'venta_id', v_venta, 'numero_venta', v_num, 'total', o.total);
end;
$f$;
revoke all on function public.taller_orden_entregar(uuid, jsonb) from public, anon;
grant execute on function public.taller_orden_entregar(uuid, jsonb) to authenticated;
