-- =====================================================================
-- RECEPCIÓN (TURNOS) — módulo general opcional (7-nov-2026)
-- Tablas PROPIAS: no toca ventas, caja, inventario ni nada existente.
-- Apagado por defecto (configuracion_empresa.usa_modulo_recepcion).
-- Candados:
--   * Cada negocio solo ve lo suyo (RLS por auth_user_id).
--   * Los turnos se crean/mueven SOLO por funciones del servidor
--     (numeración atómica: nunca dos turnos con el mismo número).
--   * Pantalla de TV y kiosko "Tome su turno": equipos vinculados con un
--     código de 6 dígitos que confirma el negocio; el servidor guarda
--     solo el hash del secreto del equipo; se pueden desactivar.
--   * Lo público (TV, kiosko, seguimiento por QR) solo expone número,
--     servicio, puesto y —si el negocio lo activa— nombre + inicial.
-- =====================================================================

alter table public.configuracion_empresa add column if not exists usa_modulo_recepcion boolean not null default false;
alter table public.configuracion_empresa add column if not exists recepcion_cfg jsonb not null default '{}'::jsonb;

create table if not exists public.recepcion_servicios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  letra text not null check (letra ~ '^[A-Z]{1,2}$'),
  preferencial boolean not null default false,
  minutos_estimados int not null default 5 check (minutos_estimados between 1 and 240),
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_rec_serv_user on public.recepcion_servicios(auth_user_id);

create table if not exists public.recepcion_puestos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 40),
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_rec_puesto_user on public.recepcion_puestos(auth_user_id);

create table if not exists public.recepcion_turnos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  servicio_id uuid references public.recepcion_servicios(id) on delete set null,
  servicio_nombre text,
  letra text not null,
  numero int not null,
  codigo text not null,
  nombre text,
  telefono text,
  nota text,
  preferencial boolean not null default false,
  estado text not null default 'espera' check (estado in ('espera','llamado','atendiendo','atendido','no_vino','cancelado')),
  puesto_id uuid references public.recepcion_puestos(id) on delete set null,
  puesto_nombre text,
  llamadas int not null default 0,
  origen text not null default 'recepcion' check (origen in ('recepcion','kiosko')),
  token_publico text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  orden_cola double precision not null default extract(epoch from clock_timestamp()),
  creado_por text,
  atendido_por text,
  created_at timestamptz not null default now(),
  llamado_at timestamptz,
  atencion_at timestamptz,
  fin_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (auth_user_id, fecha, letra, numero)
);
create index if not exists idx_rec_turnos_dia on public.recepcion_turnos(auth_user_id, fecha, estado);
create index if not exists idx_rec_turnos_upd on public.recepcion_turnos(auth_user_id, updated_at desc);

create table if not exists public.recepcion_dispositivos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('pantalla','kiosko')),
  nombre text not null default 'Equipo',
  secreto_hash text not null unique,
  activo boolean not null default true,
  ultimo_uso timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_rec_disp_user on public.recepcion_dispositivos(auth_user_id);

create table if not exists public.recepcion_pares (
  codigo text primary key,
  secreto_hash text not null unique,
  tipo text not null check (tipo in ('pantalla','kiosko')),
  expira timestamptz not null,
  dispositivo_id uuid
);

-- updated_at automático (la TV detecta cambios con esto)
create or replace function public._rec_turno_touch() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists trg_rec_turno_touch on public.recepcion_turnos;
create trigger trg_rec_turno_touch before update on public.recepcion_turnos for each row execute function public._rec_turno_touch();

-- RLS
alter table public.recepcion_servicios enable row level security;
alter table public.recepcion_puestos enable row level security;
alter table public.recepcion_turnos enable row level security;
alter table public.recepcion_dispositivos enable row level security;
alter table public.recepcion_pares enable row level security;   -- sin políticas: solo funciones

drop policy if exists rec_serv_own on public.recepcion_servicios;
create policy rec_serv_own on public.recepcion_servicios for all to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
drop policy if exists rec_puesto_own on public.recepcion_puestos;
create policy rec_puesto_own on public.recepcion_puestos for all to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
-- Turnos: solo LECTURA directa; crear/mover es por funciones.
drop policy if exists rec_turnos_sel on public.recepcion_turnos;
create policy rec_turnos_sel on public.recepcion_turnos for select to authenticated using (auth_user_id = auth.uid());
-- Equipos: ver y desactivar/renombrar los propios (vincular es por función).
drop policy if exists rec_disp_sel on public.recepcion_dispositivos;
create policy rec_disp_sel on public.recepcion_dispositivos for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists rec_disp_upd on public.recepcion_dispositivos;
create policy rec_disp_upd on public.recepcion_dispositivos for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

revoke all on public.recepcion_servicios, public.recepcion_puestos, public.recepcion_turnos, public.recepcion_dispositivos, public.recepcion_pares from anon;
grant select, insert, update, delete on public.recepcion_servicios, public.recepcion_puestos to authenticated;
revoke insert, update, delete on public.recepcion_turnos from authenticated;
grant select on public.recepcion_turnos to authenticated;
revoke insert, delete, update on public.recepcion_dispositivos from authenticated;
grant select on public.recepcion_dispositivos to authenticated;
grant update (nombre, activo) on public.recepcion_dispositivos to authenticated;
revoke all on public.recepcion_pares from authenticated;

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------
create or replace function public._rec_hoy() returns date language sql stable as $$
  select (now() at time zone 'America/Managua')::date $$;

create or replace function public._rec_hash(p text) returns text language sql immutable as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex') $$;

-- Equipo vinculado activo -> auth_user_id del negocio (o null)
create or replace function public._rec_disp(p_secreto text, p_tipo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_uid uuid; v_uso timestamptz;
begin
  if coalesce(length(p_secreto), 0) < 32 then return null; end if;
  select id, auth_user_id, ultimo_uso into v_id, v_uid, v_uso from recepcion_dispositivos
   where secreto_hash = _rec_hash(p_secreto) and activo and (p_tipo is null or tipo = p_tipo);
  if v_id is null then return null; end if;
  if v_uso is null or v_uso < now() - interval '2 minutes' then
    update recepcion_dispositivos set ultimo_uso = now() where id = v_id;
  end if;
  -- el módulo tiene que seguir encendido en el negocio
  if not exists (select 1 from configuracion_empresa where auth_user_id = v_uid and usa_modulo_recepcion) then return null; end if;
  return v_uid;
end $$;

create or replace function public._rec_crear(p_uid uuid, p_servicio uuid, p_nombre text, p_tel text, p_nota text, p_origen text, p_creado_por text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_fecha date := _rec_hoy(); v_num int; t record;
begin
  select * into s from recepcion_servicios where id = p_servicio and auth_user_id = p_uid and activo;
  if s.id is null then return jsonb_build_object('ok', false, 'motivo', 'servicio'); end if;
  if (select count(*) from recepcion_turnos where auth_user_id = p_uid and fecha = v_fecha) >= 3000 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rec:' || p_uid::text || ':' || v_fecha::text || ':' || s.letra, 0));
  select coalesce(max(numero), 0) + 1 into v_num from recepcion_turnos where auth_user_id = p_uid and fecha = v_fecha and letra = s.letra;
  insert into recepcion_turnos (auth_user_id, fecha, servicio_id, servicio_nombre, letra, numero, codigo, nombre, telefono, nota,
                                preferencial, origen, creado_por)
  values (p_uid, v_fecha, s.id, s.nombre, s.letra, v_num, s.letra || '-' || lpad(v_num::text, 3, '0'),
          nullif(left(btrim(coalesce(p_nombre, '')), 60), ''), nullif(left(btrim(coalesce(p_tel, '')), 25), ''),
          nullif(left(btrim(coalesce(p_nota, '')), 200), ''), s.preferencial, p_origen, nullif(left(coalesce(p_creado_por, ''), 60), ''))
  returning * into t;
  return jsonb_build_object('ok', true, 'id', t.id, 'codigo', t.codigo, 'token', t.token_publico, 'servicio', t.servicio_nombre,
                            'delante', (select count(*) from recepcion_turnos x where x.auth_user_id = p_uid and x.fecha = v_fecha and x.estado = 'espera'
                                         and x.id <> t.id and (x.preferencial > t.preferencial or (x.preferencial = t.preferencial and x.orden_cola < t.orden_cola))));
end $$;

-- Minutos por persona (promedio de hoy; si no hay datos, lo estimado del servicio)
create or replace function public._rec_min_por_persona(p_uid uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select avg(extract(epoch from (fin_at - coalesce(atencion_at, llamado_at))) / 60.0)
       from recepcion_turnos where auth_user_id = p_uid and fecha = _rec_hoy() and estado = 'atendido'
        and fin_at is not null and coalesce(atencion_at, llamado_at) is not null),
    (select avg(minutos_estimados) from recepcion_servicios where auth_user_id = p_uid and activo), 5)
  / greatest(1, (select count(*) from recepcion_puestos where auth_user_id = p_uid and activo))
$$;

-- ---------------------------------------------------------------------
-- Funciones del panel (usuario del negocio)
-- ---------------------------------------------------------------------
create or replace function public.recepcion_iniciar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from recepcion_servicios where auth_user_id = v_uid) then
    insert into recepcion_servicios (auth_user_id, nombre, letra, preferencial, orden) values
      (v_uid, 'Atención general', 'A', false, 1),
      (v_uid, 'Caja y pagos', 'C', false, 2),
      (v_uid, 'Preferencial', 'P', true, 3);
  end if;
  if not exists (select 1 from recepcion_puestos where auth_user_id = v_uid) then
    insert into recepcion_puestos (auth_user_id, nombre, orden) values (v_uid, 'Ventanilla 1', 1), (v_uid, 'Ventanilla 2', 2);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.recepcion_nuevo_turno(p_servicio uuid, p_nombre text default null, p_telefono text default null,
                                                       p_nota text default null, p_creado_por text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  return _rec_crear(auth.uid(), p_servicio, p_nombre, p_telefono, p_nota, 'recepcion', p_creado_por);
end $$;

-- Cambio rápido para que el panel solo recargue cuando algo cambió
create or replace function public.recepcion_version() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(max(updated_at)::text, '0') || ':' || count(*)::text
    from recepcion_turnos where auth_user_id = auth.uid() and fecha = _rec_hoy()
$$;

create or replace function public.recepcion_llamar_siguiente(p_puesto uuid, p_servicios uuid[] default null, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p record; t record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into p from recepcion_puestos where id = p_puesto and auth_user_id = v_uid and activo;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'puesto'); end if;
  perform pg_advisory_xact_lock(hashtextextended('rec_llamar:' || v_uid::text, 0));
  -- El que estaba en este puesto se da por atendido
  update recepcion_turnos set estado = 'atendido', fin_at = now()
   where auth_user_id = v_uid and puesto_id = p.id and estado in ('llamado','atendiendo') and fecha = _rec_hoy();
  select * into t from recepcion_turnos
   where auth_user_id = v_uid and fecha = _rec_hoy() and estado = 'espera'
     and (p_servicios is null or cardinality(p_servicios) = 0 or servicio_id = any(p_servicios))
   order by preferencial desc, orden_cola asc
   limit 1 for update skip locked;
  if t.id is null then return jsonb_build_object('ok', false, 'motivo', 'vacio'); end if;
  update recepcion_turnos set estado = 'llamado', puesto_id = p.id, puesto_nombre = p.nombre, llamado_at = now(),
         llamadas = llamadas + 1, atendido_por = nullif(left(coalesce(p_quien, ''), 60), '')
   where id = t.id;
  return jsonb_build_object('ok', true, 'id', t.id, 'codigo', t.codigo, 'puesto', p.nombre);
end $$;

create or replace function public.recepcion_accion(p_turno uuid, p_accion text, p_puesto uuid default null, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); t record; p record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into t from recepcion_turnos where id = p_turno and auth_user_id = v_uid for update;
  if t.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if p_accion = 'llamar' then
    select * into p from recepcion_puestos where id = p_puesto and auth_user_id = v_uid and activo;
    if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'puesto'); end if;
    if t.estado <> 'espera' then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'atendido', fin_at = now()
     where auth_user_id = v_uid and puesto_id = p.id and estado in ('llamado','atendiendo') and fecha = _rec_hoy() and id <> t.id;
    update recepcion_turnos set estado = 'llamado', puesto_id = p.id, puesto_nombre = p.nombre, llamado_at = now(),
           llamadas = llamadas + 1, atendido_por = coalesce(nullif(left(coalesce(p_quien, ''), 60), ''), atendido_por) where id = t.id;
  elsif p_accion = 'rellamar' then
    if t.estado not in ('llamado','atendiendo') then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'llamado', llamado_at = now(), llamadas = llamadas + 1 where id = t.id;
  elsif p_accion = 'atender' then
    if t.estado <> 'llamado' then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'atendiendo', atencion_at = now() where id = t.id;
  elsif p_accion = 'terminar' then
    if t.estado not in ('llamado','atendiendo') then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'atendido', fin_at = now() where id = t.id;
  elsif p_accion = 'no_vino' then
    if t.estado <> 'llamado' then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'no_vino', fin_at = now() where id = t.id;
  elsif p_accion = 'al_final' then
    if t.estado not in ('espera','llamado') then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'espera', puesto_id = null, puesto_nombre = null,
           orden_cola = extract(epoch from clock_timestamp()) where id = t.id;
  elsif p_accion = 'cancelar' then
    if t.estado <> 'espera' then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'cancelado', fin_at = now() where id = t.id;
  elsif p_accion = 'reabrir' then
    if t.estado not in ('no_vino','cancelado') or t.fecha <> _rec_hoy() then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
    update recepcion_turnos set estado = 'espera', puesto_id = null, puesto_nombre = null, fin_at = null,
           orden_cola = extract(epoch from clock_timestamp()) where id = t.id;
  else
    return jsonb_build_object('ok', false, 'motivo', 'accion');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Vincular un equipo (TV o kiosko) con el código que muestra en pantalla
create or replace function public.recepcion_par_vincular(p_codigo text, p_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r record; v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not exists (select 1 from configuracion_empresa where auth_user_id = v_uid and usa_modulo_recepcion) then
    return jsonb_build_object('ok', false, 'motivo', 'modulo');
  end if;
  if (select count(*) from recepcion_dispositivos where auth_user_id = v_uid and activo) >= 30 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  select * into r from recepcion_pares where codigo = regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g') for update;
  if r.codigo is null or r.expira < now() or r.dispositivo_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'codigo');
  end if;
  insert into recepcion_dispositivos (auth_user_id, tipo, nombre, secreto_hash)
  values (v_uid, r.tipo, coalesce(nullif(left(btrim(coalesce(p_nombre, '')), 40), ''),
                                  case when r.tipo = 'pantalla' then 'Pantalla de turnos' else 'Kiosko de turnos' end), r.secreto_hash)
  returning id into v_id;
  update recepcion_pares set dispositivo_id = v_id where codigo = r.codigo;
  return jsonb_build_object('ok', true, 'tipo', r.tipo);
end $$;

-- ---------------------------------------------------------------------
-- Funciones públicas (equipos sin sesión): solo datos mínimos
-- ---------------------------------------------------------------------
create or replace function public.recepcion_par_crear(p_tipo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cod text; v_sec text; i int := 0;
begin
  if p_tipo not in ('pantalla','kiosko') then return jsonb_build_object('ok', false); end if;
  delete from recepcion_pares where expira < now() - interval '1 hour';
  if (select count(*) from recepcion_pares where expira > now() and dispositivo_id is null) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;
  loop
    i := i + 1;
    v_cod := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from recepcion_pares where codigo = v_cod) or i > 20;
  end loop;
  v_sec := encode(extensions.gen_random_bytes(32), 'hex');
  insert into recepcion_pares (codigo, secreto_hash, tipo, expira) values (v_cod, _rec_hash(v_sec), p_tipo, now() + interval '15 minutes');
  return jsonb_build_object('ok', true, 'codigo', v_cod, 'secreto', v_sec, 'expira_seg', 900);
end $$;

create or replace function public.recepcion_par_estado(p_secreto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from recepcion_pares where secreto_hash = _rec_hash(p_secreto);
  if r.codigo is null then
    -- ¿ya es un equipo vinculado?
    if exists (select 1 from recepcion_dispositivos where secreto_hash = _rec_hash(p_secreto) and activo) then
      return jsonb_build_object('vinculado', true);
    end if;
    return jsonb_build_object('vinculado', false, 'expirado', true);
  end if;
  return jsonb_build_object('vinculado', r.dispositivo_id is not null, 'expirado', r.expira < now() and r.dispositivo_id is null);
end $$;

-- Marca del negocio para las pantallas públicas
create or replace function public._rec_marca(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre', coalesce(nullif(c.nombre_comercial, ''), 'Bienvenido'), 'logo', c.logo_principal_url,
                            'color', coalesce(nullif(c.color_principal, ''), '#1d4ed8'), 'cfg', c.recepcion_cfg)
    from configuracion_empresa c where c.auth_user_id = p_uid
$$;

create or replace function public._rec_nombre_publico(p_nombre text) returns text language sql immutable as $$
  select case when coalesce(btrim(p_nombre), '') = '' then null
              else initcap(split_part(btrim(p_nombre), ' ', 1)) ||
                   case when split_part(btrim(p_nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(btrim(p_nombre), ' ', 2), 1)) || '.' else '' end
         end $$;

create or replace function public.recepcion_pantalla_estado(p_secreto text, p_version text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_ver text; m jsonb; v_nom boolean;
begin
  v_uid := _rec_disp(p_secreto, 'pantalla');
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'equipo'); end if;
  m := _rec_marca(v_uid);
  select coalesce(max(updated_at)::text, '0') || ':' || count(*)::text || ':' || md5(coalesce(m::text, ''))
    into v_ver from recepcion_turnos where auth_user_id = v_uid and fecha = _rec_hoy();
  if v_ver = p_version then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  v_nom := coalesce((m->'cfg'->>'mostrar_nombre')::boolean, false);
  return jsonb_build_object('ok', true, 'version', v_ver, 'marca', m,
    'llamados', coalesce((select jsonb_agg(to_jsonb(x) order by x.llamado_at desc) from (
        select codigo, puesto_nombre as puesto, servicio_nombre as servicio, llamadas, llamado_at, estado,
               case when v_nom then _rec_nombre_publico(nombre) end as nombre
          from recepcion_turnos where auth_user_id = v_uid and fecha = _rec_hoy() and estado in ('llamado','atendiendo','atendido')
           and llamado_at is not null order by llamado_at desc limit 7) x), '[]'::jsonb),
    'siguientes', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select codigo, servicio_nombre as servicio, preferencial from recepcion_turnos
         where auth_user_id = v_uid and fecha = _rec_hoy() and estado = 'espera'
         order by preferencial desc, orden_cola asc limit 8) x), '[]'::jsonb),
    'en_espera', (select count(*) from recepcion_turnos where auth_user_id = v_uid and fecha = _rec_hoy() and estado = 'espera'),
    'min_por_persona', round(_rec_min_por_persona(v_uid), 1));
end $$;

create or replace function public.recepcion_kiosko_info(p_secreto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  v_uid := _rec_disp(p_secreto, 'kiosko');
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'equipo'); end if;
  return jsonb_build_object('ok', true, 'marca', _rec_marca(v_uid),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'letra', s.letra, 'preferencial', s.preferencial,
                       'en_espera', (select count(*) from recepcion_turnos t where t.auth_user_id = v_uid and t.fecha = _rec_hoy()
                                      and t.estado = 'espera' and t.servicio_id = s.id)) order by s.orden, s.nombre)
                   from recepcion_servicios s where s.auth_user_id = v_uid and s.activo), '[]'::jsonb),
    'min_por_persona', round(_rec_min_por_persona(v_uid), 1));
end $$;

create or replace function public.recepcion_kiosko_turno(p_secreto text, p_servicio uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; r jsonb;
begin
  v_uid := _rec_disp(p_secreto, 'kiosko');
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'equipo'); end if;
  -- freno anti-toques repetidos: máximo 20 turnos por minuto desde kioskos del negocio
  if (select count(*) from recepcion_turnos where auth_user_id = v_uid and origen = 'kiosko' and created_at > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('ok', false, 'motivo', 'rapido');
  end if;
  r := _rec_crear(v_uid, p_servicio, null, null, null, 'kiosko', 'Kiosko');
  if (r->>'ok')::boolean then r := r || jsonb_build_object('min_por_persona', round(_rec_min_por_persona(v_uid), 1)); end if;
  return r;
end $$;

create or replace function public.recepcion_seguimiento(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; v_del int;
begin
  if coalesce(length(p_token), 0) < 16 then return jsonb_build_object('ok', false); end if;
  select * into t from recepcion_turnos where token_publico = p_token;
  if t.id is null then return jsonb_build_object('ok', false); end if;
  select count(*) into v_del from recepcion_turnos x where x.auth_user_id = t.auth_user_id and x.fecha = t.fecha and x.estado = 'espera'
     and x.id <> t.id and (x.preferencial > t.preferencial or (x.preferencial = t.preferencial and x.orden_cola < t.orden_cola));
  return jsonb_build_object('ok', true, 'codigo', t.codigo, 'servicio', t.servicio_nombre, 'estado', t.estado,
    'puesto', t.puesto_nombre, 'llamadas', t.llamadas, 'es_hoy', t.fecha = _rec_hoy(),
    'delante', case when t.estado = 'espera' then v_del else 0 end,
    'min_por_persona', round(_rec_min_por_persona(t.auth_user_id), 1),
    'marca', _rec_marca(t.auth_user_id) - 'cfg');
end $$;

-- Permisos de ejecución
revoke all on function public._rec_disp(text, text), public._rec_crear(uuid, uuid, text, text, text, text, text),
  public._rec_min_por_persona(uuid), public._rec_marca(uuid) from public, anon, authenticated;
revoke all on function public.recepcion_iniciar(), public.recepcion_nuevo_turno(uuid, text, text, text, text), public.recepcion_version(),
  public.recepcion_llamar_siguiente(uuid, uuid[], text), public.recepcion_accion(uuid, text, uuid, text),
  public.recepcion_par_vincular(text, text) from public, anon;
grant execute on function public.recepcion_iniciar(), public.recepcion_nuevo_turno(uuid, text, text, text, text), public.recepcion_version(),
  public.recepcion_llamar_siguiente(uuid, uuid[], text), public.recepcion_accion(uuid, text, uuid, text),
  public.recepcion_par_vincular(text, text) to authenticated;
grant execute on function public.recepcion_par_crear(text), public.recepcion_par_estado(text), public.recepcion_pantalla_estado(text, text),
  public.recepcion_kiosko_info(text), public.recepcion_kiosko_turno(text, uuid), public.recepcion_seguimiento(text) to anon, authenticated;
