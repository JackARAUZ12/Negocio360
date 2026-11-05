-- =====================================================================
-- PANEL MICROFINANCIERA · NIVEL 2: TRABAJO EN EQUIPO (4-nov-2026)
-- Opcional: se enciende dentro del Panel con el PIN de un administrador.
-- Roles: Dueño (cualquier perfil administrador), Supervisor y Cobrador (perfiles con PIN del sistema).
-- CANDADOS:
--   * Cada persona entra al Panel con SU PIN; el servidor lo verifica (5 intentos y se bloquea) y le da
--     una llave de sesión del día. Vender, cobrar, anular, asignar y recibir entregas exigen esa llave.
--   * Un cobrador solo cobra (y anota visitas de) los créditos de SU cartera; no anula cobros;
--     solo vende si el dueño se lo permite (y lo que vende queda en su cartera).
--   * Cada cobro queda a nombre de quien cobró. Entrega del día: el sistema calcula lo cobrado en
--     efectivo y lo compara con lo entregado; faltante o sobrante se registra en Caja (así Caja = dinero real).
--   * Un cobro ya entregado y cuadrado no se puede anular. Si llegaron cobros nuevos mientras se
--     contaba, la entrega no se guarda (hay que volver a contar).
--   * Los campos de equipo (encendido, cartera asignada, quién cobró, entrega) solo se cambian por
--     estas funciones: un candado en la base rechaza cambios directos.
--   * Si "trabajo en equipo" está apagado, el Panel funciona exactamente igual que el Nivel 1.
-- =====================================================================

alter table public.configuracion_empresa add column if not exists mf_con_equipo boolean not null default false;
alter table public.creditos add column if not exists mf_cobrador_id uuid;
alter table public.creditos add column if not exists mf_cobrador_nombre text;
alter table public.creditos_pagos add column if not exists mf_cobrador_id uuid;
alter table public.creditos_pagos add column if not exists mf_cobrador_nombre text;
alter table public.creditos_pagos add column if not exists mf_entrega_id uuid;
create index if not exists creditos_mf_cobrador_idx on public.creditos (auth_user_id, mf_cobrador_id) where mf_cobrador_id is not null;
create index if not exists creditos_pagos_mf_pend_idx on public.creditos_pagos (auth_user_id, mf_cobrador_id) where mf_cobrador_id is not null and mf_entrega_id is null;

create table if not exists public.mf_equipo (
  perfil_id uuid primary key references public.perfiles_acceso(id) on delete cascade,
  auth_user_id uuid not null,
  rol text not null check (rol in ('supervisor', 'cobrador')),
  puede_vender boolean not null default true,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mf_equipo enable row level security;
drop policy if exists mf_equipo_ver on public.mf_equipo;
create policy mf_equipo_ver on public.mf_equipo for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.mf_equipo from anon, authenticated;
grant select on public.mf_equipo to authenticated;

create table if not exists public.mf_sesiones (
  token_hash text primary key,
  auth_user_id uuid not null,
  perfil_id uuid not null,
  nombre text,
  rol text not null,
  expira timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.mf_sesiones enable row level security;
revoke all on public.mf_sesiones from anon, authenticated;

create table if not exists public.mf_intentos (
  perfil_id uuid primary key,
  fallos integer not null default 0,
  bloqueado_hasta timestamptz
);
alter table public.mf_intentos enable row level security;
revoke all on public.mf_intentos from anon, authenticated;

create table if not exists public.mf_entregas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  cobrador_id uuid not null,
  cobrador_nombre text,
  cobros integer not null default 0,
  esperado numeric(14,2) not null default 0,
  otros numeric(14,2) not null default 0,
  entregado numeric(14,2) not null default 0,
  diferencia numeric(14,2) not null default 0,
  movimiento_id uuid,
  nota text,
  recibido_por text,
  created_at timestamptz not null default now()
);
create index if not exists mf_entregas_idx on public.mf_entregas (auth_user_id, created_at desc);
alter table public.mf_entregas enable row level security;
drop policy if exists mf_entregas_ver on public.mf_entregas;
create policy mf_entregas_ver on public.mf_entregas for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.mf_entregas from anon, authenticated;
grant select on public.mf_entregas to authenticated;

-- Candado: los campos de equipo solo los cambian las funciones del Panel
create or replace function public._mf_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('n360.mf_ok', true) is not distinct from '1' then return new; end if;
  -- (cada tabla por separado: plpgsql no permite leer columnas que la tabla no tiene)
  if tg_table_name = 'configuracion_empresa' then
    if new.mf_con_equipo is distinct from old.mf_con_equipo then
      raise exception 'El trabajo en equipo se enciende o apaga desde el Panel Microfinanciera (con PIN de administrador).' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos' then
    if new.mf_cobrador_id is distinct from old.mf_cobrador_id or new.mf_cobrador_nombre is distinct from old.mf_cobrador_nombre then
      raise exception 'La cartera del cobrador se asigna desde el Panel Microfinanciera.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos_pagos' then
    if new.mf_cobrador_id is distinct from old.mf_cobrador_id or new.mf_cobrador_nombre is distinct from old.mf_cobrador_nombre or new.mf_entrega_id is distinct from old.mf_entrega_id then
      raise exception 'Quién cobró y la entrega del cobrador no se pueden cambiar a mano.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_mf_guard on public.configuracion_empresa;
create trigger trg_mf_guard before update of mf_con_equipo on public.configuracion_empresa for each row execute function public._mf_guard();
drop trigger if exists trg_mf_guard on public.creditos;
create trigger trg_mf_guard before update of mf_cobrador_id, mf_cobrador_nombre on public.creditos for each row execute function public._mf_guard();
drop trigger if exists trg_mf_guard on public.creditos_pagos;
create trigger trg_mf_guard before update of mf_cobrador_id, mf_cobrador_nombre, mf_entrega_id on public.creditos_pagos for each row execute function public._mf_guard();

-- ¿Quién está trabajando? Sin equipo: el dueño (como el Nivel 1). Con equipo: la llave de sesión del día.
create or replace function public._mf_actor(p_uid uuid, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare s record; e record;
begin
  if not coalesce((select mf_con_equipo from configuracion_empresa where auth_user_id = p_uid limit 1), false) then
    return jsonb_build_object('rol', 'dueno', 'perfil_id', null, 'nombre', null, 'puede_vender', true, 'equipo', false);
  end if;
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into s from mf_sesiones where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and auth_user_id = p_uid and expira > now();
  if not found then return null; end if;
  if s.rol = 'dueno' then
    return jsonb_build_object('rol', 'dueno', 'perfil_id', s.perfil_id, 'nombre', s.nombre, 'puede_vender', true, 'equipo', true);
  end if;
  -- Si al miembro lo desactivan o le cambian el rol, pierde la llave de inmediato
  select rol, puede_vender, activo into e from mf_equipo where perfil_id = s.perfil_id and auth_user_id = p_uid;
  if not found or not e.activo or e.rol <> s.rol then return null; end if;
  return jsonb_build_object('rol', s.rol, 'perfil_id', s.perfil_id, 'nombre', s.nombre, 'puede_vender', e.puede_vender, 'equipo', true);
end $$;

-- Entrar al Panel con el PIN (perfil administrador = Dueño; perfil del equipo = su rol)
create or replace function public.mf_sesion_abrir(p_perfil_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_central uuid; pf record; e record; r jsonb; v_rol text; v_vender boolean := true; v_tok text; v_f integer; v_b timestamptz;
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
    insert into mf_intentos (perfil_id) values (pf.id) on conflict do nothing;
    select fallos, bloqueado_hasta into v_f, v_b from mf_intentos where perfil_id = pf.id for update;
    if v_b is not null and v_b > now() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'bloqueado_seg', ceil(extract(epoch from (v_b - now())))::int); end if;
    if pf.codigo_hash is null or pf.codigo_hash <> encode(extensions.digest('n360:' || pf.id::text || ':' || p_pin, 'sha256'), 'hex') then
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

create or replace function public.mf_sesion_cerrar(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sin sesión activa'; end if;
  delete from mf_sesiones where auth_user_id = auth.uid() and token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- Encender / apagar el trabajo en equipo: SIEMPRE con PIN de un administrador
create or replace function public.mf_equipo_config(p_activo boolean, p_perfil_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_central uuid; r jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_central := public._auth_id_central_del_grupo();
  if not exists (select 1 from perfiles_acceso where id = p_perfil_id and auth_user_id = v_central and tipo = 'admin' and activo) then
    return jsonb_build_object('ok', false, 'motivo', 'admin'); end if;
  r := public._admin_verificar(v_central, p_pin, p_perfil_id, 'equipo microfinanciera');
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  perform set_config('n360.mf_ok', '1', true);
  update configuracion_empresa set mf_con_equipo = coalesce(p_activo, false) where auth_user_id = v_uid;
  perform set_config('n360.mf_ok', '', true);
  if not coalesce(p_activo, false) then delete from mf_sesiones where auth_user_id = v_uid; end if;
  return jsonb_build_object('ok', true, 'activo', coalesce(p_activo, false));
end $$;

-- Equipo: agregar / cambiar rol / permitir vender / desactivar (solo el dueño)
create or replace function public.mf_equipo_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_central uuid; v_pid uuid; v_rol text := p ->> 'rol';
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
  insert into mf_equipo (perfil_id, auth_user_id, rol, puede_vender, activo)
  values (v_pid, v_uid, v_rol, coalesce((p ->> 'puede_vender')::boolean, true), coalesce((p ->> 'activo')::boolean, true))
  on conflict (perfil_id) do update set rol = excluded.rol, puede_vender = excluded.puede_vender, activo = excluded.activo, updated_at = now()
  where mf_equipo.auth_user_id = v_uid;
  if not coalesce((p ->> 'activo')::boolean, true) then delete from mf_sesiones where perfil_id = v_pid and auth_user_id = v_uid; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Asignar créditos a un cobrador (o dejarlos sin asignar). Solo cambia ese dato: nada de dinero.
create or replace function public.mf_asignar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_cob uuid; v_nom text; v_n integer;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  if jsonb_typeof(p -> 'credito_ids') is distinct from 'array' or jsonb_array_length(p -> 'credito_ids') = 0 or jsonb_array_length(p -> 'credito_ids') > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  begin v_cob := nullif(p ->> 'cobrador_id', '')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_cob is not null then
    select pa.nombre into v_nom from mf_equipo e join perfiles_acceso pa on pa.id = e.perfil_id where e.perfil_id = v_cob and e.auth_user_id = v_uid and e.activo;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'cobrador'); end if;
  end if;
  perform set_config('n360.mf_ok', '1', true);
  begin
    update creditos set mf_cobrador_id = v_cob, mf_cobrador_nombre = v_nom, updated_at = now()
     where auth_user_id = v_uid and id in (select (x)::uuid from jsonb_array_elements_text(p -> 'credito_ids') x);
    get diagnostics v_n = row_count;
  exception when invalid_text_representation then perform set_config('n360.mf_ok', '', true); return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  perform set_config('n360.mf_ok', '', true);
  return jsonb_build_object('ok', true, 'asignados', v_n);
end $$;

-- Lo que cada persona del equipo tiene cobrado y aún no ha entregado
create or replace function public.mf_caja_pendiente(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_res jsonb; v_solo uuid;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then v_solo := (v_act ->> 'perfil_id')::uuid; end if;
  select coalesce(jsonb_agg(x order by x ->> 'nombre'), '[]'::jsonb) into v_res from (
    select jsonb_build_object('cobrador_id', cp.mf_cobrador_id, 'nombre', max(cp.mf_cobrador_nombre), 'cobros', count(*),
           'efectivo', round(sum(cp.monto) filter (where lower(coalesce(cp.metodo_pago_nombre, 'efectivo')) like '%efectivo%'), 2),
           'otros', round(sum(cp.monto) filter (where lower(coalesce(cp.metodo_pago_nombre, 'efectivo')) not like '%efectivo%'), 2),
           'desde', min(cp.created_at), 'hasta', max(cp.created_at),
           'detalle', jsonb_agg(jsonb_build_object('recibo', cp.comprobante_numero, 'monto', cp.monto, 'metodo', cp.metodo_pago_nombre, 'hora', cp.created_at, 'credito_id', cp.credito_id) order by cp.created_at)) x
      from creditos_pagos cp
     where cp.auth_user_id = v_uid and cp.estado = 'completado' and cp.mf_cobrador_id is not null and cp.mf_entrega_id is null
       and (v_solo is null or cp.mf_cobrador_id = v_solo)
       and exists (select 1 from mf_equipo e where e.perfil_id = cp.mf_cobrador_id and e.auth_user_id = v_uid)
     group by cp.mf_cobrador_id) t;
  return jsonb_build_object('ok', true, 'pendiente', v_res);
end $$;

-- Recibir la entrega del día de un cobrador (dueño o supervisor). Cuadra efectivo cobrado vs entregado.
create or replace function public.mf_entrega_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date; v_act jsonb; v_cob uuid; v_nom text;
  v_ent numeric; v_visto numeric; v_esp numeric; v_otros numeric; v_n integer; v_dif numeric; v_id uuid; v_mov uuid;
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
  select count(*), coalesce(round(sum(monto) filter (where lower(coalesce(metodo_pago_nombre, 'efectivo')) like '%efectivo%'), 2), 0),
         coalesce(round(sum(monto) filter (where lower(coalesce(metodo_pago_nombre, 'efectivo')) not like '%efectivo%'), 2), 0)
    into v_n, v_esp, v_otros
    from creditos_pagos where auth_user_id = v_uid and mf_cobrador_id = v_cob and mf_entrega_id is null and estado = 'completado';
  if v_n = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada'); end if;
  if v_visto is null or v_visto <> v_esp then return jsonb_build_object('ok', false, 'motivo', 'cambio', 'esperado', v_esp); end if;
  v_dif := round(v_ent - v_esp, 2);
  insert into mf_entregas (auth_user_id, cobrador_id, cobrador_nombre, cobros, esperado, otros, entregado, diferencia, nota, recibido_por)
  values (v_uid, v_cob, v_nom, v_n, v_esp, v_otros, v_ent, v_dif, v_nota, coalesce(v_act ->> 'nombre', 'Dueño'))
  returning id into v_id;
  perform set_config('n360.mf_ok', '1', true);
  update creditos_pagos set mf_entrega_id = v_id where auth_user_id = v_uid and mf_cobrador_id = v_cob and mf_entrega_id is null and estado = 'completado';
  perform set_config('n360.mf_ok', '', true);
  -- Faltante o sobrante: Caja se ajusta para quedar igual al dinero real recibido
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

-- Las 4 funciones del Nivel 1, ahora con "quién está trabajando" (sin equipo funcionan igual que antes)
drop function if exists public.mf_anular_pago(uuid, text);

create or replace function public.mf_credito_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date;
  v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'productos');
  v_cli uuid; v_cnom text; v_frec text := coalesce(nullif(p ->> 'frecuencia', ''), 'semanal');
  v_n integer; v_inicio date; v_sindom boolean := coalesce(nullif(p ->> 'sin_domingos', '')::boolean, true);
  v_ref text := left(nullif(btrim(coalesce(p ->> 'ref', '')), ''), 80);
  v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120);
  v_nota text := left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300);
  v_rpct numeric; v_ipct numeric; v_prima numeric; v_capital numeric := 0; v_interes numeric := 0;
  v_subtotal numeric := 0; v_costo numeric := 0; v_recargo numeric := 0; v_total numeric; v_fin numeric;
  v_cap_tot numeric; v_ncu integer; v_cap_c numeric; v_int_c numeric; v_acum_cap numeric := 0; v_acum_int numeric := 0;
  v_acum numeric := 0; v_mon numeric; v_fecha date; v_off integer;
  it record; pr record; v_venta uuid; v_numv text; v_cred uuid; v_numc text; v_prodfin uuid; v_caja numeric;
  v_mov uuid; v_recibo text; v_met uuid; v_metn text; v_banco uuid; v_bmon text; v_emon text; i integer;
  v_act jsonb; v_rol text; v_yo uuid; v_yon text;
  v_cob uuid; v_cobn text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  v_rol := v_act ->> 'rol'; v_yo := nullif(v_act ->> 'perfil_id', '')::uuid; v_yon := v_act ->> 'nombre';
  if v_rol = 'cobrador' and coalesce((v_act ->> 'puede_vender')::boolean, false) = false then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  -- Cartera: lo que vende un cobrador/supervisor queda en SU cartera; el dueño puede asignarlo a alguien del equipo.
  if v_rol in ('cobrador', 'supervisor') then v_cob := v_yo; v_cobn := v_yon;
  else
    begin v_cob := nullif(p ->> 'cobrador_id', '')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    if v_cob is not null then
      select pa.nombre into v_cobn from mf_equipo e join perfiles_acceso pa on pa.id = e.perfil_id where e.perfil_id = v_cob and e.auth_user_id = v_uid and e.activo;
      if not found then return jsonb_build_object('ok', false, 'motivo', 'cobrador'); end if;
    end if;
  end if;
  if v_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended('n360_mf_ref:' || v_uid::text || ':' || v_ref, 0));
    select id, numero_credito into v_cred, v_numc from creditos where auth_user_id = v_uid and mf_ref = v_ref;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'credito_id', v_cred, 'numero_credito', v_numc); end if;
  end if;
  begin
    v_cli := nullif(p ->> 'cliente_id', '')::uuid;
    v_n := nullif(p ->> 'num_cuotas', '')::integer;
    v_inicio := coalesce(nullif(p ->> 'primera_fecha', '')::date, v_hoy);
    v_rpct := coalesce(nullif(p ->> 'recargo_pct', '')::numeric, 0);
    v_ipct := coalesce(nullif(p ->> 'interes_pct', '')::numeric, 0);
    v_prima := round(coalesce(nullif(p ->> 'prima', '')::numeric, 0), 2);
    v_met := nullif(p ->> 'prima_metodo_id', '')::uuid; v_banco := nullif(p ->> 'prima_banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  v_metn := left(coalesce(nullif(btrim(coalesce(p ->> 'prima_metodo_nombre', '')), ''), 'Efectivo'), 120);

  if v_tipo not in ('productos', 'efectivo') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  select btrim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_cnom from clientes where id = v_cli and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  if v_frec not in ('diaria', 'semanal', 'quincenal', 'mensual') then return jsonb_build_object('ok', false, 'motivo', 'frecuencia'); end if;
  if v_n is null or v_n < 1 or v_n > 365 then return jsonb_build_object('ok', false, 'motivo', 'cuotas'); end if;
  if v_inicio < v_hoy - 31 or v_inicio > v_hoy + 366 then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end if;
  if v_rpct < 0 or v_rpct > 300 or v_ipct < 0 or v_ipct > 300 then return jsonb_build_object('ok', false, 'motivo', 'porcentaje'); end if;
  if v_prima < 0 then return jsonb_build_object('ok', false, 'motivo', 'prima'); end if;

  if v_tipo = 'productos' then
    if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 or jsonb_array_length(p -> 'items') > 100 then
      return jsonb_build_object('ok', false, 'motivo', 'sin_items'); end if;
    begin
      -- Existencias por producto (sumando si se repite), con el producto bloqueado
      for it in select x.producto_id, sum(x.cantidad) q from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric)
                 group by x.producto_id order by x.producto_id loop
        select id, nombre, tipo, stock_actual, activo into pr from productos where id = it.producto_id and auth_user_id = v_uid for update;
        if not found or pr.activo is false or pr.tipo not in ('producto', 'servicio') then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
        if pr.tipo = 'producto' and coalesce(pr.stock_actual, 0) < it.q then
          return jsonb_build_object('ok', false, 'motivo', 'sin_stock', 'producto', pr.nombre, 'hay', coalesce(pr.stock_actual, 0), 'necesita', it.q);
        end if;
      end loop;
      for it in select x.* from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric) loop
        if it.cantidad is null or it.cantidad <= 0 or it.cantidad > 1000000 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
        if it.precio is null or it.precio < 0 or it.precio > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'precio'); end if;
        select costo into pr from productos where id = it.producto_id and auth_user_id = v_uid;
        v_subtotal := v_subtotal + round(it.cantidad * it.precio, 2);
        v_costo := v_costo + it.cantidad * coalesce(pr.costo, 0);
      end loop;
    exception when invalid_text_representation or datatype_mismatch then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    v_subtotal := round(v_subtotal, 2);
    if v_subtotal <= 0 then return jsonb_build_object('ok', false, 'motivo', 'total_cero'); end if;
    v_recargo := round(v_subtotal * v_rpct / 100, 2);
    v_total := v_subtotal + v_recargo;
    if v_prima >= v_total then return jsonb_build_object('ok', false, 'motivo', 'prima'); end if;
    v_cap_tot := v_total - v_prima;       -- lo que se reparte en cuotas
    v_fin := v_total;                     -- el crédito completo (la prima es la cuota #1 ya pagada)
  else
    begin v_capital := round(coalesce(nullif(p ->> 'monto', '')::numeric, 0), 2); exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    if v_capital <= 0 or v_capital > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;
    if v_prima > 0 then return jsonb_build_object('ok', false, 'motivo', 'prima_prestamo'); end if;
    select saldo_resultante into v_caja from movimientos_financieros where auth_user_id = v_uid and estado = 'completado' order by created_at desc limit 1;
    if v_capital > coalesce(v_caja, 0) + 0.01 then return jsonb_build_object('ok', false, 'motivo', 'fondos', 'caja', coalesce(v_caja, 0)); end if;
    v_interes := round(v_capital * v_ipct / 100, 2);
    v_total := v_capital + v_interes;
    v_cap_tot := v_capital; v_fin := v_total;
  end if;

  if v_prima > 0 then
    if v_met is not null and not exists (select 1 from metodos_pago where id = v_met and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
    if v_banco is not null then
      select moneda into v_bmon from bancos where id = v_banco and auth_user_id = v_uid;
      if not found then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
      select moneda into v_emon from configuracion_empresa where auth_user_id = v_uid limit 1;
      if coalesce(v_bmon, 'NIO') <> coalesce(v_emon, 'NIO') then return jsonb_build_object('ok', false, 'motivo', 'banco_moneda'); end if;
    end if;
  end if;

  -- 1) Venta a crédito (solo productos): queda en Ventas y en Contabilidad como "Crédito otorgado"
  if v_tipo = 'productos' then
    v_numv := public.generar_numero_venta(v_uid);
    insert into ventas (auth_user_id, numero_venta, cliente_id, cliente_nombre, fecha, subtotal, descuento, impuesto, total, costo_total,
                        metodo_pago, estado_pago, estado, categoria, iva_activo, iva_porcentaje, observaciones, creado_por_nombre)
    values (v_uid, v_numv, v_cli, coalesce(nullif(v_cnom, ''), 'Cliente'), (v_hoy::timestamp at time zone 'UTC'), v_total, 0, 0, v_total, round(v_costo, 2),
            'credito', 'credito', 'completada', 'credito', false, 0, left('Panel Microfinanciera · venta al crédito' || coalesce(' · ' || v_nota, ''), 1000), v_por)
    returning id into v_venta;
    for it in select x.* from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric) loop
      select id, nombre, tipo, sku, costo into pr from productos where id = it.producto_id and auth_user_id = v_uid;
      insert into venta_detalles (venta_id, auth_user_id, producto_id, producto_nombre, producto_sku, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia, es_regalia, vendido_sin_stock)
      values (v_venta, v_uid, pr.id, pr.nombre, pr.sku, pr.tipo, it.cantidad, it.precio, coalesce(pr.costo, 0), 0,
              round(it.cantidad * it.precio, 2), round(it.cantidad * it.precio - it.cantidad * coalesce(pr.costo, 0), 2), false, false);
    end loop;
    if v_recargo > 0 then
      insert into venta_detalles (venta_id, auth_user_id, producto_id, producto_nombre, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia, es_regalia, vendido_sin_stock)
      values (v_venta, v_uid, null, 'Recargo por venta al crédito (' || trim(to_char(v_rpct, 'FM999990.##')) || '%)', 'servicio', 1, v_recargo, 0, 0, v_recargo, v_recargo, false, false);
    end if;
    for it in select x.producto_id, sum(x.cantidad) q from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric) group by x.producto_id loop
      update productos set stock_actual = round(coalesce(stock_actual, 0) - it.q, 3) where id = it.producto_id and auth_user_id = v_uid and tipo = 'producto';
    end loop;
    update clientes set total_compras = coalesce(total_compras, 0) + v_total, num_compras = coalesce(num_compras, 0) + 1 where id = v_cli and auth_user_id = v_uid;
  else
    select id into v_prodfin from productos where auth_user_id = v_uid and tipo = 'financiero' and lower(btrim(nombre)) = 'préstamo en efectivo' limit 1;
    if v_prodfin is null then
      insert into productos (auth_user_id, tipo, nombre, activo) values (v_uid, 'financiero', 'Préstamo en efectivo', true) returning id into v_prodfin;
    end if;
  end if;

  -- 2) Crédito y cuotas (si hay prima, es la cuota #1 y queda pagada abajo)
  v_numc := public.generar_numero_credito(v_uid);
  v_ncu := v_n + case when v_prima > 0 then 1 else 0 end;
  insert into creditos (auth_user_id, numero_credito, tipo, cliente_id, venta_id, producto_financiero_id, monto_original, prima_tipo, prima_valor, prima_monto,
                        capital_financiado, tipo_financiamiento, tasa_interes, tipo_interes, metodo_amortizacion, frecuencia, num_cuotas, fecha_inicio,
                        total_intereses, total_financiado, valor_cuota_aprox, saldo_pendiente, estado, observaciones, modalidad_pago, mf_ref, mf_cobrador_id, mf_cobrador_nombre)
  values (v_uid, v_numc, case when v_tipo = 'productos' then 'venta' else 'financiero' end, v_cli, v_venta, v_prodfin,
          case when v_tipo = 'productos' then v_total else v_capital end, 'ninguna', 0, 0,
          case when v_tipo = 'productos' then v_total else v_capital end,
          case when v_interes > 0 then 'con_interes' else 'sin_interes' end, case when v_interes > 0 then v_ipct end, case when v_interes > 0 then 'simple' end,
          'simple', v_frec, v_ncu, v_inicio, v_interes, v_fin, round((v_cap_tot + v_interes) / v_n, 2), v_fin, 'activo',
          left('Panel Microfinanciera' || case when v_prima > 0 then ' · prima ' || v_prima || ' (cuota 1)' else '' end || coalesce(' · ' || v_nota, ''), 1000), 'cuotas', v_ref, v_cob, v_cobn)
  returning id into v_cred;

  v_off := 0;
  if v_prima > 0 then
    insert into creditos_cuotas (auth_user_id, credito_id, numero, fecha_vencimiento, capital, interes, impuesto, impuestos_detalle, monto_total, monto_pagado, saldo, estado, impuesto_acreditado)
    values (v_uid, v_cred, 1, v_hoy, v_prima, 0, 0, '[]'::jsonb, v_prima, 0, round(v_fin - v_prima, 2), 'pendiente', 0);
    v_acum := v_prima; v_off := 1;
  end if;
  for i in 1 .. v_n loop
    if i = v_n then v_cap_c := round(v_cap_tot - v_acum_cap, 2); v_int_c := round(v_interes - v_acum_int, 2);
    else v_cap_c := round(v_cap_tot / v_n, 2); v_int_c := round(v_interes / v_n, 2); end if;
    v_acum_cap := v_acum_cap + v_cap_c; v_acum_int := v_acum_int + v_int_c;
    v_mon := v_cap_c + v_int_c; v_acum := v_acum + v_mon;
    v_fecha := public._mf_fecha_cuota(v_inicio, v_frec, i - 1, v_sindom);
    insert into creditos_cuotas (auth_user_id, credito_id, numero, fecha_vencimiento, capital, interes, impuesto, impuestos_detalle, monto_total, monto_pagado, saldo, estado, impuesto_acreditado)
    values (v_uid, v_cred, i + v_off, v_fecha, v_cap_c, v_int_c, 0, '[]'::jsonb, v_mon, 0, round(v_fin - v_acum, 2), 'pendiente', 0);
  end loop;
  if round(v_acum, 2) <> round(v_fin, 2) then raise exception 'Las cuotas no suman el total del crédito. No se guardó nada.'; end if;

  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (v_cred, v_uid, 'creado', 'Crédito ' || v_numc || ' creado desde el Panel Microfinanciera por ' || v_fin,
          jsonb_build_object('numeroCredito', v_numc, 'tipo', v_tipo, 'totalFinanciado', v_fin, 'por', v_por));

  -- 3) Caja: el préstamo sale de Caja; la prima entra a Caja (como pago de la cuota #1)
  if v_tipo = 'efectivo' then
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_nombre, referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, 'EGRESO', 'CREDITO_OTORGADO', 'Préstamo otorgado — crédito ' || v_numc, v_capital, 0, 0, 'Efectivo', 'credito', v_cred, v_nota, v_hoy, 'completado');
    insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
    values (v_cred, v_uid, 'desembolso', 'Se entregaron ' || v_capital || ' de Caja por el préstamo', '{}'::jsonb);
  end if;
  if v_prima > 0 then
    v_recibo := public._mf_recibo(v_uid);
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, 'INGRESO', 'PAGO_CREDITO', 'Prima crédito ' || v_numc || ' · recibo ' || v_recibo, v_prima, 0, 0, v_met, v_metn, v_banco, 'credito', v_cred, null, v_hoy, 'completado')
    returning id into v_mov;
    update creditos_cuotas set monto_pagado = v_prima, estado = 'pagada', updated_at = now() where credito_id = v_cred and numero = 1;
    update creditos set saldo_pendiente = round(v_fin - v_prima, 2), updated_at = now() where id = v_cred;
    insert into creditos_pagos (auth_user_id, credito_id, cliente_id, fecha, monto, metodo_pago_id, metodo_pago_nombre, observaciones,
                                saldo_anterior, saldo_nuevo, movimiento_financiero_id, comprobante_numero, estado, mf_cobrador_id, mf_cobrador_nombre)
    values (v_uid, v_cred, v_cli, v_hoy, v_prima, v_met, v_metn, 'Prima (pago inicial)', v_fin, round(v_fin - v_prima, 2), v_mov, v_recibo, 'completado', v_yo, coalesce(v_yon, v_por));
  end if;

  return jsonb_build_object('ok', true, 'credito_id', v_cred, 'numero_credito', v_numc, 'venta_id', v_venta, 'numero_venta', v_numv,
    'total', v_fin, 'prima', v_prima, 'saldo', round(v_fin - v_prima, 2), 'cuotas', v_n, 'cuota', round((v_cap_tot + v_interes) / v_n, 2),
    'recargo', v_recargo, 'interes', v_interes, 'recibo_prima', v_recibo);
end $$;

create or replace function public.mf_cobrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date;
  v_cid uuid; v_monto numeric; v_met uuid; v_banco uuid; v_bmon text; v_emon text;
  v_metn text := left(coalesce(nullif(btrim(coalesce(p ->> 'metodo_pago_nombre', '')), ''), 'Efectivo'), 120);
  v_ref text := left(nullif(btrim(coalesce(p ->> 'ref', '')), ''), 80);
  v_nota text := left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300);
  v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120);
  c record; q record; v_rest numeric; v_apl numeric; v_debe numeric; v_saldo_nuevo numeric; v_estado text;
  v_mov uuid; v_recibo text; v_pago uuid; v_pf date; v_pm numeric;
  v_act jsonb; v_rol text; v_yo uuid; v_yon text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  v_rol := v_act ->> 'rol'; v_yo := nullif(v_act ->> 'perfil_id', '')::uuid; v_yon := v_act ->> 'nombre';
  begin
    v_cid := (p ->> 'credito_id')::uuid; v_monto := round((p ->> 'monto')::numeric, 2);
    v_met := nullif(p ->> 'metodo_pago_id', '')::uuid; v_banco := nullif(p ->> 'banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended('n360_mf_pago:' || v_uid::text || ':' || v_ref, 0));
    select id, comprobante_numero, saldo_nuevo into q from creditos_pagos where auth_user_id = v_uid and mf_ref = v_ref;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'pago_id', q.id, 'recibo', q.comprobante_numero, 'saldo', q.saldo_nuevo); end if;
  end if;
  select * into c from creditos where id = v_cid and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_rol = 'cobrador' and c.mf_cobrador_id is distinct from v_yo then return jsonb_build_object('ok', false, 'motivo', 'no_es_tuyo'); end if;
  if c.estado in ('cancelado', 'refinanciado') or coalesce(c.saldo_pendiente, 0) <= 0.005 then return jsonb_build_object('ok', false, 'motivo', 'pagado'); end if;
  if v_monto is null or v_monto <= 0 then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;
  if v_monto > c.saldo_pendiente + 0.005 then return jsonb_build_object('ok', false, 'motivo', 'excede', 'saldo', c.saldo_pendiente); end if;
  if exists (select 1 from creditos_cuotas where credito_id = c.id and estado <> 'pagada' and coalesce(impuesto, 0) - coalesce(impuesto_acreditado, 0) > 0.005) then
    return jsonb_build_object('ok', false, 'motivo', 'con_impuestos'); end if;
  if v_met is not null and not exists (select 1 from metodos_pago where id = v_met and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  if v_banco is not null then
    select moneda into v_bmon from bancos where id = v_banco and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
    select moneda into v_emon from configuracion_empresa where auth_user_id = v_uid limit 1;
    if coalesce(v_bmon, 'NIO') <> coalesce(v_emon, 'NIO') then return jsonb_build_object('ok', false, 'motivo', 'banco_moneda'); end if;
  end if;

  -- Se aplica a las cuotas en orden (la más antigua primero), igual que Créditos
  v_rest := v_monto;
  for q in select * from creditos_cuotas where credito_id = c.id and estado <> 'pagada' order by numero for update loop
    exit when v_rest <= 0.005;
    v_debe := round(q.monto_total - coalesce(q.monto_pagado, 0), 2);
    continue when v_debe <= 0;
    v_apl := least(v_rest, v_debe);
    update creditos_cuotas set monto_pagado = round(coalesce(monto_pagado, 0) + v_apl, 2),
           estado = case when round(coalesce(monto_pagado, 0) + v_apl, 2) >= monto_total - 0.01 then 'pagada' else 'parcial' end, updated_at = now()
     where id = q.id;
    v_rest := round(v_rest - v_apl, 2);
  end loop;
  if v_rest > 0.01 then raise exception 'El cobro no cupo en las cuotas del crédito. No se guardó nada.'; end if;

  v_saldo_nuevo := round(greatest(0, c.saldo_pendiente - v_monto), 2);
  v_estado := case when v_saldo_nuevo <= 0.01 then 'cancelado' when c.estado = 'en_proceso' then 'activo' else c.estado end;
  update creditos set saldo_pendiente = v_saldo_nuevo, estado = v_estado, updated_at = now() where id = c.id;

  v_recibo := public._mf_recibo(v_uid);
  insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                       metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
  values (v_uid, 'INGRESO', 'PAGO_CREDITO', 'Pago crédito ' || c.numero_credito || ' · recibo ' || v_recibo, v_monto, 0, 0, v_met, v_metn, v_banco, 'credito', c.id, v_nota, v_hoy, 'completado')
  returning id into v_mov;
  insert into creditos_pagos (auth_user_id, credito_id, cliente_id, fecha, monto, metodo_pago_id, metodo_pago_nombre, observaciones,
                              saldo_anterior, saldo_nuevo, movimiento_financiero_id, comprobante_numero, estado, mf_ref, mf_cobrador_id, mf_cobrador_nombre)
  values (v_uid, c.id, c.cliente_id, v_hoy, v_monto, v_met, v_metn, v_nota, c.saldo_pendiente, v_saldo_nuevo, v_mov, v_recibo, 'completado', v_ref, v_yo, coalesce(v_yon, v_por))
  returning id into v_pago;
  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (c.id, v_uid, 'pago', 'Pago de ' || v_monto || ' registrado (recibo ' || v_recibo || ', Panel Microfinanciera)', jsonb_build_object('monto', v_monto, 'saldoNuevo', v_saldo_nuevo, 'por', v_por));
  if v_estado = 'cancelado' then
    insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data) values (c.id, v_uid, 'cancelado', 'Crédito cancelado — saldo en cero', '{}'::jsonb);
  end if;
  select fecha_vencimiento, round(monto_total - coalesce(monto_pagado, 0), 2) into v_pf, v_pm
    from creditos_cuotas where credito_id = c.id and estado <> 'pagada' order by numero limit 1;
  return jsonb_build_object('ok', true, 'pago_id', v_pago, 'recibo', v_recibo, 'monto', v_monto, 'saldo_anterior', c.saldo_pendiente, 'saldo', v_saldo_nuevo,
    'cancelado', v_estado = 'cancelado', 'numero_credito', c.numero_credito, 'cobrador', coalesce(v_yon, v_por),
    'proxima_fecha', v_pf, 'proxima_monto', v_pm);
end $$;

create or replace function public.mf_anular_pago(p_pago_id uuid, p_motivo text, p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); pg record; c record; q record; v_rest numeric; v_quitar numeric; v_pag numeric; v_saldo numeric;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 200); v_act jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p_token);
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  if v_motivo is null or length(v_motivo) < 3 then return jsonb_build_object('ok', false, 'motivo', 'motivo'); end if;
  select * into pg from creditos_pagos where id = p_pago_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if pg.estado = 'anulado' then return jsonb_build_object('ok', false, 'motivo', 'ya_anulado'); end if;
  if pg.mf_entrega_id is not null then return jsonb_build_object('ok', false, 'motivo', 'entregado'); end if;
  if pg.movimiento_financiero_id is null or coalesce(pg.comprobante_numero, '') not like 'R-%' then return jsonb_build_object('ok', false, 'motivo', 'de_creditos'); end if;
  select * into c from creditos where id = pg.credito_id and auth_user_id = v_uid for update;
  -- 1) Caja: el movimiento queda anulado (la base recalcula el saldo)
  update movimientos_financieros set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Cobro ' || pg.comprobante_numero || ' anulado: ' || v_motivo
   where id = pg.movimiento_financiero_id and auth_user_id = v_uid and estado = 'completado';
  -- 2) Cuotas: se descuenta de la última hacia atrás (igual que Créditos)
  v_rest := pg.monto;
  for q in select * from creditos_cuotas where credito_id = c.id order by numero desc for update loop
    exit when v_rest <= 0.005;
    v_pag := coalesce(q.monto_pagado, 0);
    continue when v_pag <= 0;
    v_quitar := least(v_pag, v_rest);
    update creditos_cuotas set monto_pagado = round(v_pag - v_quitar, 2),
           estado = case when round(v_pag - v_quitar, 2) <= 0.01 then 'pendiente' when round(v_pag - v_quitar, 2) >= monto_total - 0.01 then 'pagada' else 'parcial' end,
           updated_at = now() where id = q.id;
    v_rest := round(v_rest - v_quitar, 2);
  end loop;
  -- 3) Saldo del crédito (nunca más allá del total)
  v_saldo := round(least(coalesce(c.total_financiado, c.capital_financiado, 0), coalesce(c.saldo_pendiente, 0) + pg.monto), 2);
  update creditos set saldo_pendiente = v_saldo, estado = case when v_saldo > 0.01 and estado = 'cancelado' then 'activo' else estado end, updated_at = now() where id = c.id;
  -- 4) El cobro queda anulado (con rastro)
  update creditos_pagos set estado = 'anulado', anulado_en = now(), anulado_motivo = v_motivo where id = pg.id;
  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (c.id, v_uid, 'pago_anulado', 'Se anuló el cobro ' || pg.comprobante_numero || ' de ' || pg.monto || ': ' || v_motivo, jsonb_build_object('por', coalesce(v_act ->> 'nombre', 'Dueño')));
  return jsonb_build_object('ok', true, 'saldo', v_saldo, 'recibo', pg.comprobante_numero, 'monto', pg.monto);
end $$;

create or replace function public.mf_gestion(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cid uuid; v_tipo text := p ->> 'tipo'; v_fecha date; c record; v_id uuid;
  v_act jsonb; v_rol text; v_yo uuid; v_yon text;

begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  v_rol := v_act ->> 'rol'; v_yo := nullif(v_act ->> 'perfil_id', '')::uuid; v_yon := v_act ->> 'nombre';
  begin v_cid := (p ->> 'credito_id')::uuid; v_fecha := nullif(p ->> 'fecha_promesa', '')::date;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_tipo not in ('no_estaba', 'promesa', 'nota') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  if v_tipo = 'promesa' and (v_fecha is null or v_fecha < (now() at time zone 'America/Managua')::date) then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end if;
  if v_tipo = 'nota' and length(btrim(coalesce(p ->> 'nota', ''))) < 2 then return jsonb_build_object('ok', false, 'motivo', 'nota'); end if;
  select id, cliente_id, mf_cobrador_id into c from creditos where id = v_cid and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_rol = 'cobrador' and c.mf_cobrador_id is distinct from v_yo then return jsonb_build_object('ok', false, 'motivo', 'no_es_tuyo'); end if;
  insert into mf_gestiones (auth_user_id, credito_id, cliente_id, tipo, fecha_promesa, nota, creado_por)
  values (v_uid, c.id, c.cliente_id, v_tipo, case when v_tipo = 'promesa' then v_fecha end, left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300),
          left(coalesce(v_yon, nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public._mf_actor(uuid, text) from public, anon, authenticated;
revoke all on function public._mf_guard() from public, anon, authenticated;
revoke all on function public.mf_sesion_abrir(uuid, text) from public, anon;
revoke all on function public.mf_sesion_cerrar(text) from public, anon;
revoke all on function public.mf_equipo_config(boolean, uuid, text) from public, anon;
revoke all on function public.mf_equipo_guardar(jsonb) from public, anon;
revoke all on function public.mf_asignar(jsonb) from public, anon;
revoke all on function public.mf_caja_pendiente(jsonb) from public, anon;
revoke all on function public.mf_entrega_registrar(jsonb) from public, anon;
revoke all on function public.mf_credito_crear(jsonb) from public, anon;
revoke all on function public.mf_cobrar(jsonb) from public, anon;
revoke all on function public.mf_anular_pago(uuid, text, text) from public, anon;
revoke all on function public.mf_gestion(jsonb) from public, anon;
grant execute on function public.mf_sesion_abrir(uuid, text) to authenticated;
grant execute on function public.mf_sesion_cerrar(text) to authenticated;
grant execute on function public.mf_equipo_config(boolean, uuid, text) to authenticated;
grant execute on function public.mf_equipo_guardar(jsonb) to authenticated;
grant execute on function public.mf_asignar(jsonb) to authenticated;
grant execute on function public.mf_caja_pendiente(jsonb) to authenticated;
grant execute on function public.mf_entrega_registrar(jsonb) to authenticated;
grant execute on function public.mf_credito_crear(jsonb) to authenticated;
grant execute on function public.mf_cobrar(jsonb) to authenticated;
grant execute on function public.mf_anular_pago(uuid, text, text) to authenticated;
grant execute on function public.mf_gestion(jsonb) to authenticated;
