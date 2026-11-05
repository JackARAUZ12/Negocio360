-- Panel Microfinanciera — Blindaje A1 a A4 (2026-11-04)
-- A1: PIN propio del Panel para cada persona del equipo (guardado con bcrypt en una tabla que nadie puede leer).
-- A2: los cobros hechos en el Panel solo se anulan desde el Panel (Créditos y Caja ya no pueden anularlos por fuera).
-- A3: antiduplicación: autorizaciones (doble toque), gestiones (código único) y código único obligatorio en cobrar / prestar.
-- A4: el dueño marca qué métodos de pago cuentan como efectivo (si no marca nada, sigue como antes: el nombre dice "efectivo").
-- Todo es aditivo. Ningún negocio tiene el Panel encendido hoy: nada cambia para los demás módulos salvo el candado A2,
-- que solo toca cobros hechos en el Panel.

-- ═════════════ A1: PIN propio del Panel ═════════════
create table if not exists public.mf_pines (
  perfil_id uuid primary key,
  auth_user_id uuid not null,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.mf_pines enable row level security;
revoke all on public.mf_pines from anon, authenticated;

alter table public.mf_equipo add column if not exists pin_puesto boolean not null default false;

create or replace function public._mf_pin_debil(p text)
returns boolean language sql immutable as $$
  select p !~ '^[0-9]{4,8}$' or p ~ '^(.)\1+$' or position(p in '0123456789') > 0 or position(p in '9876543210') > 0
$$;

create or replace function public.mf_sesion_abrir(p_perfil_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_central uuid; pf record; e record; r jsonb; v_rol text; v_vender boolean := true; v_tok text; v_f integer; v_b timestamptz; v_h text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_pin is null or length(p_pin) < 4 or length(p_pin) > 32 then return jsonb_build_object('ok', false, 'motivo', 'formato'); end if;
  v_central := public._auth_id_central_del_grupo();
  select * into pf from perfiles_acceso where id = p_perfil_id and auth_user_id = v_central and activo;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if pf.tipo = 'admin' then
    r := public._admin_verificar(v_central, p_pin, pf.id, 'panel microfinanciera');
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
    v_rol := 'dueno';
  else
    select rol, puede_vender, activo into e from mf_equipo where perfil_id = pf.id and auth_user_id = v_uid;
    if not found or not e.activo then return jsonb_build_object('ok', false, 'motivo', 'sin_acceso'); end if;
    select pin_hash into v_h from mf_pines where perfil_id = pf.id and auth_user_id = v_uid;
    if v_h is null then return jsonb_build_object('ok', false, 'motivo', 'sin_pin'); end if;
    insert into mf_intentos (perfil_id) values (pf.id) on conflict do nothing;
    select fallos, bloqueado_hasta into v_f, v_b from mf_intentos where perfil_id = pf.id for update;
    if v_b is not null and v_b > now() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'bloqueado_seg', ceil(extract(epoch from (v_b - now())))::int); end if;
    if extensions.crypt(p_pin, v_h) <> v_h then
      v_f := v_f + 1;
      if v_f >= 5 then
        update mf_intentos set fallos = v_f, bloqueado_hasta = now() + interval '15 minutes' where perfil_id = pf.id;
        return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'bloqueado_seg', 900);
      end if;
      update mf_intentos set fallos = v_f where perfil_id = pf.id;
      return jsonb_build_object('ok', false, 'motivo', 'incorrecto', 'restantes', 5 - v_f);
    end if;
    update mf_intentos set fallos = 0, bloqueado_hasta = null where perfil_id = pf.id;
    v_rol := e.rol; v_vender := e.puede_vender;
  end if;
  delete from mf_sesiones where expira < now() - interval '1 day';
  v_tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into mf_sesiones (token_hash, auth_user_id, perfil_id, nombre, rol, expira)
  values (encode(extensions.digest(v_tok, 'sha256'), 'hex'), v_uid, pf.id, pf.nombre, v_rol, now() + interval '14 hours');
  return jsonb_build_object('ok', true, 'token', v_tok, 'rol', v_rol, 'nombre', pf.nombre, 'perfil_id', pf.id, 'puede_vender', v_vender, 'expira', now() + interval '14 hours');
end $$;

-- Equipo: agregar / cambiar rol / permitir vender / desactivar / poner PIN (solo el dueño)
create or replace function public.mf_equipo_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_central uuid; v_pid uuid; v_rol text := p ->> 'rol';
  v_pin text := nullif(btrim(coalesce(p ->> 'pin', '')), ''); v_existe boolean;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' <> 'dueno' then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  begin v_pid := (p ->> 'perfil_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_rol not in ('supervisor', 'cobrador') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  v_central := public._auth_id_central_del_grupo();
  if not exists (select 1 from perfiles_acceso where id = v_pid and auth_user_id = v_central and tipo <> 'admin') then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if v_pin is not null and public._mf_pin_debil(v_pin) then return jsonb_build_object('ok', false, 'motivo', 'pin_debil'); end if;
  select true into v_existe from mf_equipo where perfil_id = v_pid and auth_user_id = v_uid;
  if v_existe is null and exists (select 1 from mf_equipo where perfil_id = v_pid) then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if v_pin is null and coalesce((p ->> 'activo')::boolean, true)
     and not exists (select 1 from mf_pines where perfil_id = v_pid and auth_user_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'pin_falta'); end if;
  insert into mf_equipo (perfil_id, auth_user_id, rol, puede_vender, activo)
  values (v_pid, v_uid, v_rol, coalesce((p ->> 'puede_vender')::boolean, true), coalesce((p ->> 'activo')::boolean, true))
  on conflict (perfil_id) do update set rol = excluded.rol, puede_vender = excluded.puede_vender, activo = excluded.activo, updated_at = now()
  where mf_equipo.auth_user_id = v_uid;
  if v_pin is not null then
    insert into mf_pines (perfil_id, auth_user_id, pin_hash) values (v_pid, v_uid, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)))
    on conflict (perfil_id) do update set pin_hash = excluded.pin_hash, updated_at = now() where mf_pines.auth_user_id = v_uid;
    update mf_equipo set pin_puesto = true where perfil_id = v_pid and auth_user_id = v_uid;
    delete from mf_intentos where perfil_id = v_pid;
    delete from mf_sesiones where perfil_id = v_pid and auth_user_id = v_uid;   -- PIN nuevo: se cierran sus sesiones abiertas
  end if;
  if not coalesce((p ->> 'activo')::boolean, true) then delete from mf_sesiones where perfil_id = v_pid and auth_user_id = v_uid; end if;
  return jsonb_build_object('ok', true, 'pin_cambiado', v_pin is not null);
end $$;

-- ═════════════ A2: cobros del Panel solo se anulan desde el Panel ═════════════
-- Se permite cuando lo hace una función del Panel (mf_...), o una tarea interna sin usuario (soporte).
create or replace function public._mf_es_pago_panel(cp public.creditos_pagos)
returns boolean language sql stable set search_path = public as $$
  select cp.mf_ref is not null or cp.mf_cobrador_id is not null or cp.mf_entrega_id is not null
      or coalesce(cp.comprobante_numero, '') ~ '^R-[0-9]{6}$'
$$;

create or replace function public._mf_candado_anular()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ctx text; pg record;
begin
  if auth.uid() is null then return new; end if;
  get diagnostics v_ctx = pg_context;
  if v_ctx ~ 'function (public\.)?mf_[a-z_]+\(' then return new; end if;
  if tg_table_name = 'creditos_pagos' then
    if public._mf_es_pago_panel(old) and (
         new.estado is distinct from old.estado or new.monto is distinct from old.monto or new.mf_ref is distinct from old.mf_ref
      or new.comprobante_numero is distinct from old.comprobante_numero or new.movimiento_financiero_id is distinct from old.movimiento_financiero_id
      or new.credito_id is distinct from old.credito_id) then
      if old.mf_entrega_id is not null then
        raise exception 'MF_CANDADO: el cobro % ya fue entregado por el cobrador; no se puede anular.', coalesce(old.comprobante_numero, '') using errcode = 'P0001';
      end if;
      raise exception 'MF_CANDADO: el cobro % se hizo en el Panel Microfinanciera; anúlalo desde el Panel (así se devuelve bien la mora y la caja del cobrador).', coalesce(old.comprobante_numero, '') using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'movimientos_financieros' then
    if new.estado is distinct from old.estado or new.referencia_tipo is distinct from old.referencia_tipo or new.referencia_id is distinct from old.referencia_id then
      if old.referencia_tipo in ('mf_mora', 'mf_entrega') then
        raise exception 'MF_CANDADO: este movimiento es del Panel Microfinanciera (mora o entrega del cobrador); solo se anula desde el Panel.' using errcode = 'P0001';
      end if;
      if old.tipo_movimiento = 'PAGO_CREDITO' then
        select cp.comprobante_numero, cp.mf_entrega_id into pg from creditos_pagos cp
         where cp.movimiento_financiero_id = old.id and cp.auth_user_id = old.auth_user_id and cp.estado = 'completado' and public._mf_es_pago_panel(cp) limit 1;
        if found then
          if pg.mf_entrega_id is not null then
            raise exception 'MF_CANDADO: el cobro % ya fue entregado por el cobrador; no se puede anular.', coalesce(pg.comprobante_numero, '') using errcode = 'P0001';
          end if;
          raise exception 'MF_CANDADO: el cobro % se hizo en el Panel Microfinanciera; anúlalo desde el Panel.', coalesce(pg.comprobante_numero, '') using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_mf_candado_anular on public.creditos_pagos;
create trigger trg_mf_candado_anular before update on public.creditos_pagos for each row execute function public._mf_candado_anular();
drop trigger if exists trg_mf_candado_anular on public.movimientos_financieros;
create trigger trg_mf_candado_anular before update on public.movimientos_financieros for each row
  when (old.estado = 'completado' and (old.referencia_tipo in ('mf_mora', 'mf_entrega') or old.tipo_movimiento = 'PAGO_CREDITO'))
  execute function public._mf_candado_anular();

-- ═════════════ A3: antiduplicación ═════════════
-- Autorización: si ya hay una vigente sin usar para ese cliente, se devuelve la misma (doble toque = 1 sola).
create or replace function public.mf_autorizar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_cli uuid; v_mot text := left(nullif(btrim(coalesce(p ->> 'motivo', '')), ''), 200); v_id uuid;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  if v_mot is null or length(v_mot) < 3 then return jsonb_build_object('ok', false, 'motivo', 'motivo'); end if;
  begin v_cli := (p ->> 'cliente_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if not exists (select 1 from clientes where id = v_cli and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_mf_aut:' || v_uid::text || ':' || v_cli::text, 0));
  select id into v_id from mf_autorizaciones
   where auth_user_id = v_uid and cliente_id = v_cli and usado_en_credito is null and expira > now() + interval '2 minutes'
   order by created_at desc limit 1;
  if found then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
  insert into mf_autorizaciones (auth_user_id, cliente_id, motivo, autorizado_por, expira)
  values (v_uid, v_cli, v_mot, coalesce(v_act ->> 'nombre', left(nullif(btrim(p ->> 'por'), ''), 120), 'Dueño'), now() + interval '15 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Gestiones: código único por gestión (si llega 2 veces, se guarda 1)
alter table public.mf_gestiones add column if not exists ref text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mf_gestiones_ref_largo') then
    alter table public.mf_gestiones add constraint mf_gestiones_ref_largo check (ref is null or length(ref) <= 80);
  end if;
end $$;
create unique index if not exists mf_gestiones_ref_uq on public.mf_gestiones (auth_user_id, ref) where ref is not null;

create or replace function public.mf_gestion(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cid uuid; v_tipo text := p ->> 'tipo'; v_fecha date; c record; v_id uuid;
  v_act jsonb; v_rol text; v_yo uuid; v_yon text; v_ref text := left(nullif(btrim(coalesce(p ->> 'ref', '')), ''), 80);
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if v_ref is null then return jsonb_build_object('ok', false, 'motivo', 'version'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  v_rol := v_act ->> 'rol'; v_yo := nullif(v_act ->> 'perfil_id', '')::uuid; v_yon := v_act ->> 'nombre';
  perform pg_advisory_xact_lock(hashtextextended('n360_mf_gest:' || v_uid::text || ':' || v_ref, 0));
  select id into v_id from mf_gestiones where auth_user_id = v_uid and ref = v_ref;
  if found then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
  begin v_cid := (p ->> 'credito_id')::uuid; v_fecha := nullif(p ->> 'fecha_promesa', '')::date;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_tipo not in ('no_estaba', 'promesa', 'nota') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  if v_tipo = 'promesa' and (v_fecha is null or v_fecha < (now() at time zone 'America/Managua')::date) then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end if;
  if v_tipo = 'nota' and length(btrim(coalesce(p ->> 'nota', ''))) < 2 then return jsonb_build_object('ok', false, 'motivo', 'nota'); end if;
  select id, cliente_id, mf_cobrador_id into c from creditos where id = v_cid and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_rol = 'cobrador' and c.mf_cobrador_id is distinct from v_yo then return jsonb_build_object('ok', false, 'motivo', 'no_es_tuyo'); end if;
  insert into mf_gestiones (auth_user_id, credito_id, cliente_id, tipo, fecha_promesa, nota, creado_por, ref)
  values (v_uid, c.id, c.cliente_id, v_tipo, case when v_tipo = 'promesa' then v_fecha end, left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300),
          left(coalesce(v_yon, nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120), v_ref)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Cobrar y prestar: el código único pasa a ser obligatorio (sin él, el servidor no puede evitar el doble cobro).
do $$
declare d text; v_viejo text; v_nuevo text;
begin
  d := pg_get_functiondef('public.mf_cobrar(jsonb)'::regprocedure);
  v_viejo := E'  if v_ref is not null then\n    perform pg_advisory_xact_lock(hashtextextended(''n360_mf_pago:''';
  if position(v_viejo in d) = 0 then raise exception 'mf_cobrar no tiene el texto esperado; no se cambió nada'; end if;
  if position('''motivo'', ''version''' in d) = 0 then
    v_nuevo := E'  if v_ref is null then return jsonb_build_object(''ok'', false, ''motivo'', ''version''); end if;\n' || v_viejo;
    execute replace(d, v_viejo, v_nuevo);
  end if;
  d := pg_get_functiondef('public.mf_credito_crear(jsonb)'::regprocedure);
  v_viejo := E'  if v_ref is not null then\n    perform pg_advisory_xact_lock(hashtextextended(''n360_mf_ref:''';
  if position(v_viejo in d) = 0 then raise exception 'mf_credito_crear no tiene el texto esperado; no se cambió nada'; end if;
  if position('''motivo'', ''version''' in d) = 0 then
    v_nuevo := E'  if v_ref is null then return jsonb_build_object(''ok'', false, ''motivo'', ''version''); end if;\n' || v_viejo;
    execute replace(d, v_viejo, v_nuevo);
  end if;
end $$;

-- ═════════════ A4: qué métodos cuentan como efectivo ═════════════
alter table public.configuracion_empresa add column if not exists mf_metodos_efectivo jsonb;

create or replace function public._mf_es_ef(p_cfg jsonb, p_met uuid, p_nom text)
returns boolean language sql immutable as $$
  select case when p_met is not null and jsonb_typeof(p_cfg) = 'array' and jsonb_array_length(p_cfg) > 0 then p_cfg ? p_met::text
              else lower(coalesce(p_nom, 'efectivo')) like '%efectivo%' end
$$;

create or replace function public._mf_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('n360.mf_ok', true) is not distinct from '1' then return new; end if;
  if tg_table_name = 'configuracion_empresa' then
    if new.mf_con_equipo is distinct from old.mf_con_equipo then
      raise exception 'El trabajo en equipo se enciende o apaga desde el Panel Microfinanciera (con PIN de administrador).' using errcode = 'P0001';
    end if;
    if new.mf_mora_tipo is distinct from old.mf_mora_tipo or new.mf_mora_valor is distinct from old.mf_mora_valor or new.mf_mora_gracia is distinct from old.mf_mora_gracia
       or new.mf_mora_tope_pct is distinct from old.mf_mora_tope_pct or new.mf_mora_perdona_cobrador is distinct from old.mf_mora_perdona_cobrador
       or new.mf_limite_defecto is distinct from old.mf_limite_defecto or new.mf_bloq_atraso_dias is distinct from old.mf_bloq_atraso_dias
       or new.mf_metodos_efectivo is distinct from old.mf_metodos_efectivo then
      raise exception 'Las reglas del Panel Microfinanciera se cambian desde el Panel.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos' then
    if new.mf_cobrador_id is distinct from old.mf_cobrador_id or new.mf_cobrador_nombre is distinct from old.mf_cobrador_nombre then
      raise exception 'La cartera del cobrador se asigna desde el Panel Microfinanciera.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos_pagos' then
    if new.mf_cobrador_id is distinct from old.mf_cobrador_id or new.mf_cobrador_nombre is distinct from old.mf_cobrador_nombre or new.mf_entrega_id is distinct from old.mf_entrega_id then
      raise exception 'Quién cobró y la entrega del cobrador no se pueden cambiar a mano.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos_cuotas' then
    if new.mf_mora_hasta is distinct from old.mf_mora_hasta then
      raise exception 'La mora de una cuota solo se cobra o perdona desde el Panel Microfinanciera.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function public.mf_efectivo_config(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_ids jsonb; v_n integer; v_ok integer;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' <> 'dueno' then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  if jsonb_typeof(p -> 'metodos') is distinct from 'array' or jsonb_array_length(p -> 'metodos') > 50 then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  begin
    select coalesce(jsonb_agg(distinct x::uuid::text), '[]'::jsonb), count(distinct x::uuid) into v_ids, v_n from jsonb_array_elements_text(p -> 'metodos') x;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  select count(*) into v_ok from metodos_pago where auth_user_id = v_uid and v_ids ? id::text;
  if v_ok <> v_n then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  perform set_config('n360.mf_ok', '1', true);
  update configuracion_empresa set mf_metodos_efectivo = case when v_n = 0 then null else v_ids end where auth_user_id = v_uid;
  perform set_config('n360.mf_ok', '', true);
  return jsonb_build_object('ok', true, 'metodos', case when v_n = 0 then null else v_ids end);
end $$;

create or replace function public.mf_caja_pendiente(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_res jsonb; v_solo uuid; v_cfg jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then v_solo := (v_act ->> 'perfil_id')::uuid; end if;
  select mf_metodos_efectivo into v_cfg from configuracion_empresa where auth_user_id = v_uid;
  select coalesce(jsonb_agg(x order by x ->> 'nombre'), '[]'::jsonb) into v_res from (
    select jsonb_build_object('cobrador_id', cp.mf_cobrador_id, 'nombre', max(cp.mf_cobrador_nombre), 'cobros', count(*),
           'efectivo', round(sum(cp.monto + coalesce(mo.m, 0)) filter (where public._mf_es_ef(v_cfg, cp.metodo_pago_id, cp.metodo_pago_nombre)), 2),
           'otros', round(sum(cp.monto + coalesce(mo.m, 0)) filter (where not public._mf_es_ef(v_cfg, cp.metodo_pago_id, cp.metodo_pago_nombre)), 2),
           'desde', min(cp.created_at), 'hasta', max(cp.created_at),
           'detalle', jsonb_agg(jsonb_build_object('recibo', cp.comprobante_numero, 'monto', cp.monto + coalesce(mo.m, 0), 'mora', coalesce(mo.m, 0), 'metodo', cp.metodo_pago_nombre,
                                                   'efectivo', public._mf_es_ef(v_cfg, cp.metodo_pago_id, cp.metodo_pago_nombre), 'hora', cp.created_at, 'credito_id', cp.credito_id) order by cp.created_at)) x
      from creditos_pagos cp
      left join (select pago_id, sum(cobrada) m from mf_moras where auth_user_id = v_uid and estado = 'completado' group by pago_id) mo on mo.pago_id = cp.id
     where cp.auth_user_id = v_uid and cp.estado = 'completado' and cp.mf_cobrador_id is not null and cp.mf_entrega_id is null
       and (v_solo is null or cp.mf_cobrador_id = v_solo)
       and exists (select 1 from mf_equipo e where e.perfil_id = cp.mf_cobrador_id and e.auth_user_id = v_uid)
     group by cp.mf_cobrador_id) t;
  return jsonb_build_object('ok', true, 'pendiente', v_res);
end $$;

create or replace function public.mf_entrega_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date; v_act jsonb; v_cob uuid; v_nom text;
  v_ent numeric; v_visto numeric; v_esp numeric; v_otros numeric; v_n integer; v_dif numeric; v_id uuid; v_mov uuid; v_cfg jsonb;
  v_nota text := left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300);
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  begin
    v_cob := (p ->> 'cobrador_id')::uuid; v_ent := round((p ->> 'entregado')::numeric, 2); v_visto := round((p ->> 'esperado_visto')::numeric, 2);
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_ent is null or v_ent < 0 or v_ent > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;
  if v_cob = nullif(v_act ->> 'perfil_id', '')::uuid then return jsonb_build_object('ok', false, 'motivo', 'propia'); end if;
  select pa.nombre into v_nom from mf_equipo e join perfiles_acceso pa on pa.id = e.perfil_id where e.perfil_id = v_cob and e.auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'cobrador'); end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_mf_entrega:' || v_uid::text || ':' || v_cob::text, 0));
  perform 1 from creditos_pagos where auth_user_id = v_uid and mf_cobrador_id = v_cob and mf_entrega_id is null and estado = 'completado' for update;
  select mf_metodos_efectivo into v_cfg from configuracion_empresa where auth_user_id = v_uid;
  select count(*), coalesce(round(sum(cp.monto + coalesce(mo.m, 0)) filter (where public._mf_es_ef(v_cfg, cp.metodo_pago_id, cp.metodo_pago_nombre)), 2), 0),
         coalesce(round(sum(cp.monto + coalesce(mo.m, 0)) filter (where not public._mf_es_ef(v_cfg, cp.metodo_pago_id, cp.metodo_pago_nombre)), 2), 0)
    into v_n, v_esp, v_otros
    from creditos_pagos cp
    left join (select pago_id, sum(cobrada) m from mf_moras where auth_user_id = v_uid and estado = 'completado' group by pago_id) mo on mo.pago_id = cp.id
   where cp.auth_user_id = v_uid and cp.mf_cobrador_id = v_cob and cp.mf_entrega_id is null and cp.estado = 'completado';
  if v_n = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada'); end if;
  if v_visto is null or v_visto <> v_esp then return jsonb_build_object('ok', false, 'motivo', 'cambio', 'esperado', v_esp); end if;
  v_dif := round(v_ent - v_esp, 2);
  insert into mf_entregas (auth_user_id, cobrador_id, cobrador_nombre, cobros, esperado, otros, entregado, diferencia, nota, recibido_por)
  values (v_uid, v_cob, v_nom, v_n, v_esp, v_otros, v_ent, v_dif, v_nota, coalesce(v_act ->> 'nombre', 'Dueño'))
  returning id into v_id;
  perform set_config('n360.mf_ok', '1', true);
  update creditos_pagos set mf_entrega_id = v_id where auth_user_id = v_uid and mf_cobrador_id = v_cob and mf_entrega_id is null and estado = 'completado';
  perform set_config('n360.mf_ok', '', true);
  if v_dif <> 0 then
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_nombre, referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, case when v_dif < 0 then 'EGRESO' else 'INGRESO' end, case when v_dif < 0 then 'OTRO_EGRESO' else 'OTRO_INGRESO' end,
            case when v_dif < 0 then 'Faltante en entrega de cobros — ' else 'Sobrante en entrega de cobros — ' end || coalesce(v_nom, 'cobrador'),
            abs(v_dif), 0, 0, 'Efectivo', 'mf_entrega', v_id, v_nota, v_hoy, 'completado')
    returning id into v_mov;
    update mf_entregas set movimiento_id = v_mov where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'entrega_id', v_id, 'cobros', v_n, 'esperado', v_esp, 'otros', v_otros, 'entregado', v_ent, 'diferencia', v_dif, 'cobrador', v_nom);
end $$;

-- ═════════════ Permisos ═════════════
revoke all on function public._mf_pin_debil(text) from public, anon, authenticated;
revoke all on function public._mf_es_pago_panel(public.creditos_pagos) from public, anon, authenticated;
revoke all on function public._mf_candado_anular() from public, anon, authenticated;
revoke all on function public._mf_es_ef(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public._mf_guard() from public, anon, authenticated;
revoke all on function public.mf_sesion_abrir(uuid, text) from public, anon;
revoke all on function public.mf_equipo_guardar(jsonb) from public, anon;
revoke all on function public.mf_autorizar(jsonb) from public, anon;
revoke all on function public.mf_gestion(jsonb) from public, anon;
revoke all on function public.mf_efectivo_config(jsonb) from public, anon;
revoke all on function public.mf_caja_pendiente(jsonb) from public, anon;
revoke all on function public.mf_entrega_registrar(jsonb) from public, anon;
grant execute on function public.mf_sesion_abrir(uuid, text) to authenticated;
grant execute on function public.mf_equipo_guardar(jsonb) to authenticated;
grant execute on function public.mf_autorizar(jsonb) to authenticated;
grant execute on function public.mf_gestion(jsonb) to authenticated;
grant execute on function public.mf_efectivo_config(jsonb) to authenticated;
grant execute on function public.mf_caja_pendiente(jsonb) to authenticated;
grant execute on function public.mf_entrega_registrar(jsonb) to authenticated;
