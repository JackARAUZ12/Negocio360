-- ============================================================
-- Negocio360 Escritorio — modo sin conexión — FASE 0
-- (rama escritorio-sin-conexion; ver escritorio/PLAN.md)
--
-- SOLO AGREGA. No modifica ni borra nada existente.
--  * offline_cuentas_habilitadas: interruptor por cuenta. Sin fila (o con
--    habilitado=false) la cuenta NO tiene modo sin conexión: es el caso de
--    todas las cuentas salvo la piloto.
--  * offline_dispositivos: cada equipo con el programa de escritorio.
--  * offline_estado(): el programa pregunta si su cuenta lo tiene activo.
--  * offline_registrar_dispositivo(): da de alta / actualiza el equipo.
-- Tablas con RLS (cada usuario solo ve lo suyo; nadie escribe directo: solo
-- permiso de lectura, las escrituras pasan por las funciones);
-- funciones security definer con search_path fijo, verifican auth.uid(),
-- el interruptor y que no sea cuenta demo. Nada ejecutable por anon.
-- ============================================================

create table if not exists public.offline_cuentas_habilitadas (
  auth_user_id  uuid primary key,
  habilitado    boolean not null default false,
  tamano_bloque integer not null default 50 check (tamano_bloque between 5 and 500),
  max_dispositivos integer not null default 5 check (max_dispositivos between 1 and 50),
  nota          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.offline_cuentas_habilitadas enable row level security;
create policy offline_cuentas_hab_select_propia on public.offline_cuentas_habilitadas
  for select to authenticated using (auth_user_id = auth.uid());
revoke all on public.offline_cuentas_habilitadas from public, anon, authenticated;
grant select on public.offline_cuentas_habilitadas to authenticated;

create table if not exists public.offline_dispositivos (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null,
  dispositivo_uid  text not null check (dispositivo_uid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  nombre           text check (char_length(nombre) <= 80),
  version_app      text check (char_length(version_app) <= 30),
  plataforma       text check (char_length(plataforma) <= 30),
  activo           boolean not null default true,
  ultimo_contacto  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (auth_user_id, dispositivo_uid)
);
alter table public.offline_dispositivos enable row level security;
create policy offline_dispositivos_select_propios on public.offline_dispositivos
  for select to authenticated using (auth_user_id = auth.uid());
revoke all on public.offline_dispositivos from public, anon, authenticated;
grant select on public.offline_dispositivos to authenticated;

-- ¿Esta cuenta tiene el modo sin conexión? Para cualquier otra cuenta
-- responde {habilitado:false} sin error ni efecto alguno.
create or replace function public.offline_estado()
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); v_cfg public.offline_cuentas_habilitadas%rowtype;
begin
  if v_uid is null then raise exception 'No autorizado'; end if;
  if public._es_cuenta_demo(v_uid) then return jsonb_build_object('habilitado', false, 'motivo', 'demo'); end if;
  select * into v_cfg from public.offline_cuentas_habilitadas where auth_user_id = v_uid;
  if not found or not v_cfg.habilitado then return jsonb_build_object('habilitado', false); end if;
  return jsonb_build_object('habilitado', true, 'tamano_bloque', v_cfg.tamano_bloque,
                            'hora_servidor', now());
end $f$;

-- Alta / actualización del equipo. Solo con el interruptor encendido.
create or replace function public.offline_registrar_dispositivo(
  p_dispositivo_uid text, p_nombre text default null, p_version text default null, p_plataforma text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); v_cfg public.offline_cuentas_habilitadas%rowtype;
        v_id uuid; v_activo boolean; v_n integer;
begin
  if v_uid is null then raise exception 'No autorizado'; end if;
  if public._es_cuenta_demo(v_uid) then raise exception 'Las cuentas de demostración no usan el modo sin conexión'; end if;
  select * into v_cfg from public.offline_cuentas_habilitadas where auth_user_id = v_uid and habilitado;
  if not found then raise exception 'El modo sin conexión no está activo para esta cuenta'; end if;
  if p_dispositivo_uid is null or lower(p_dispositivo_uid) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Identificador de equipo inválido';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('offline_disp:' || v_uid::text, 0));
  select id, activo into v_id, v_activo from public.offline_dispositivos
    where auth_user_id = v_uid and dispositivo_uid = lower(p_dispositivo_uid);
  if v_id is null then
    select count(*) into v_n from public.offline_dispositivos where auth_user_id = v_uid and activo;
    if v_n >= v_cfg.max_dispositivos then
      raise exception 'Se alcanzó el máximo de % equipos para esta cuenta', v_cfg.max_dispositivos;
    end if;
    insert into public.offline_dispositivos (auth_user_id, dispositivo_uid, nombre, version_app, plataforma)
    values (v_uid, lower(p_dispositivo_uid), left(p_nombre, 80), left(p_version, 30), left(p_plataforma, 30))
    returning id, activo into v_id, v_activo;
  else
    update public.offline_dispositivos
       set nombre = coalesce(left(p_nombre, 80), nombre), version_app = coalesce(left(p_version, 30), version_app),
           plataforma = coalesce(left(p_plataforma, 30), plataforma), ultimo_contacto = now()
     where id = v_id;
  end if;
  return jsonb_build_object('dispositivo_id', v_id, 'activo', v_activo,
                            'tamano_bloque', v_cfg.tamano_bloque, 'hora_servidor', now());
end $f$;

revoke all on function public.offline_estado() from public, anon;
revoke all on function public.offline_registrar_dispositivo(text, text, text, text) from public, anon;
grant execute on function public.offline_estado() to authenticated;
grant execute on function public.offline_registrar_dispositivo(text, text, text, text) to authenticated;

-- Interruptor: SOLO la cuenta piloto (jackarauz2008@gmail.com).
insert into public.offline_cuentas_habilitadas (auth_user_id, habilitado, nota)
values ('b699660c-b808-4f0a-9b24-d0df60a92e83', true, 'Piloto Negocio360 Escritorio sin conexión')
on conflict (auth_user_id) do nothing;
