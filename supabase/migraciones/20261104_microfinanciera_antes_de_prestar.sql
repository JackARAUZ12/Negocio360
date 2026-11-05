-- =====================================================================
-- PANEL MICROFINANCIERA · ANTES DE PRESTAR (4-nov-2026)
-- Ficha de crédito del cliente (límite, fiador, garantía) y revisión automática al vender/prestar.
-- Apagado por defecto: sin límite ni bloqueo configurados, nada cambia.
-- CANDADOS:
--   * La revisión la hace la BASE al guardar el crédito (al final de la operación, con la deuda real
--     ya descontada la prima): si pasa el límite o el cliente tiene atrasos de más de N días, NO se guarda.
--   * Excepción: solo dueño/supervisor la autorizan (con motivo), vale 15 minutos y para UN crédito;
--     queda anotado quién autorizó. El cobrador no puede autorizarse a sí mismo.
--   * Solo aplica a créditos del Panel; el módulo Créditos no cambia.
-- =====================================================================
alter table public.configuracion_empresa add column if not exists mf_limite_defecto numeric(14,2);
alter table public.configuracion_empresa add column if not exists mf_bloq_atraso_dias integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cfg_mf_prestar_chk') then
    alter table public.configuracion_empresa add constraint cfg_mf_prestar_chk check ((mf_limite_defecto is null or mf_limite_defecto >= 0)
      and (mf_bloq_atraso_dias is null or mf_bloq_atraso_dias between 1 and 365));
  end if;
end $$;

create table if not exists public.mf_clientes_ficha (
  cliente_id uuid primary key references public.clientes(id) on delete cascade,
  auth_user_id uuid not null,
  limite numeric(14,2) check (limite is null or limite >= 0),
  fiador_nombre text, fiador_cedula text, fiador_telefono text, fiador_direccion text,
  garantia text, garantia_valor numeric(14,2) check (garantia_valor is null or garantia_valor >= 0),
  notas text,
  actualizado_por text,
  updated_at timestamptz not null default now()
);
alter table public.mf_clientes_ficha enable row level security;
drop policy if exists mf_clientes_ficha_ver on public.mf_clientes_ficha;
create policy mf_clientes_ficha_ver on public.mf_clientes_ficha for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.mf_clientes_ficha from anon, authenticated;
grant select on public.mf_clientes_ficha to authenticated;

create table if not exists public.mf_autorizaciones (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  cliente_id uuid not null,
  motivo text not null,
  autorizado_por text,
  expira timestamptz not null,
  usado_en_credito uuid,
  created_at timestamptz not null default now()
);
create index if not exists mf_autorizaciones_idx on public.mf_autorizaciones (auth_user_id, cliente_id) where usado_en_credito is null;
alter table public.mf_autorizaciones enable row level security;
drop policy if exists mf_autorizaciones_ver on public.mf_autorizaciones;
create policy mf_autorizaciones_ver on public.mf_autorizaciones for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.mf_autorizaciones from anon, authenticated;
grant select on public.mf_autorizaciones to authenticated;

-- Candado de configuración (agrega las reglas nuevas)
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
       or new.mf_limite_defecto is distinct from old.mf_limite_defecto or new.mf_bloq_atraso_dias is distinct from old.mf_bloq_atraso_dias then
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
drop trigger if exists trg_mf_guard on public.configuracion_empresa;
create trigger trg_mf_guard before update of mf_con_equipo, mf_mora_tipo, mf_mora_valor, mf_mora_gracia, mf_mora_tope_pct, mf_mora_perdona_cobrador, mf_limite_defecto, mf_bloq_atraso_dias
  on public.configuracion_empresa for each row execute function public._mf_guard();

-- Situación del cliente: cuánto debe, su límite y su peor atraso (solo lee)
create or replace function public._mf_revision_cliente(p_uid uuid, p_cli uuid, p_excluir uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Managua')::date; v_deuda numeric; v_lim numeric; v_dias integer; v_bloq integer; v_n integer;
begin
  select coalesce(sum(saldo_pendiente), 0), count(*) into v_deuda, v_n from creditos
   where auth_user_id = p_uid and cliente_id = p_cli and estado not in ('cancelado', 'refinanciado') and coalesce(saldo_pendiente, 0) > 0.005;
  select coalesce(max(v_hoy - q.fecha_vencimiento), 0) into v_dias
    from creditos_cuotas q join creditos c on c.id = q.credito_id
   where c.auth_user_id = p_uid and c.cliente_id = p_cli and c.estado not in ('cancelado', 'refinanciado')
     and (p_excluir is null or c.id <> p_excluir) and q.estado <> 'pagada'
     and q.monto_total - coalesce(q.monto_pagado, 0) > 0.005 and q.fecha_vencimiento < v_hoy;
  select coalesce(f.limite, ce.mf_limite_defecto), ce.mf_bloq_atraso_dias into v_lim, v_bloq
    from configuracion_empresa ce left join mf_clientes_ficha f on f.cliente_id = p_cli and f.auth_user_id = p_uid
   where ce.auth_user_id = p_uid limit 1;
  return jsonb_build_object('deuda', round(v_deuda, 2), 'creditos', v_n, 'limite', v_lim, 'atraso_dias', v_dias, 'bloq_dias', v_bloq,
    'disponible', case when v_lim is null then null else round(v_lim - v_deuda, 2) end);
end $$;

-- Revisión al guardar un crédito del Panel (al final de la operación: deuda real, ya con la prima)
create or replace function public._mf_revision_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb; v_mot text; v_aut uuid;
begin
  if not exists (select 1 from creditos where id = new.id) then return null; end if;
  r := public._mf_revision_cliente(new.auth_user_id, new.cliente_id, new.id);
  if (r ->> 'limite') is not null and (r ->> 'deuda')::numeric > (r ->> 'limite')::numeric + 0.005 then v_mot := 'limite';
  elsif (r ->> 'bloq_dias') is not null and (r ->> 'atraso_dias')::int > (r ->> 'bloq_dias')::int then v_mot := 'atrasado';
  end if;
  if v_mot is null then return null; end if;
  select id into v_aut from mf_autorizaciones where auth_user_id = new.auth_user_id and cliente_id = new.cliente_id
     and usado_en_credito is null and expira > now() order by created_at desc limit 1 for update;
  if v_aut is not null then
    update mf_autorizaciones set usado_en_credito = new.id where id = v_aut;
    insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
    select new.id, new.auth_user_id, 'excepcion', 'Crédito autorizado como excepción (' || case v_mot when 'limite' then 'pasa el límite' else 'cliente con atraso' end || ') por ' || coalesce(a.autorizado_por, 'Dueño') || ': ' || a.motivo, r
      from mf_autorizaciones a where a.id = v_aut;
    return null;
  end if;
  raise exception 'MF_REVISION:%:%:%:%', v_mot, r ->> 'deuda', coalesce(r ->> 'limite', ''), r ->> 'atraso_dias' using errcode = 'P0001';
end $$;
drop trigger if exists trg_mf_revision on public.creditos;
create constraint trigger trg_mf_revision after insert on public.creditos deferrable initially deferred
  for each row when (new.mf_ref is not null or new.observaciones like 'Panel Microfinanciera%') execute function public._mf_revision_trg();

-- Ver la situación (para la pantalla, antes de vender)
create or replace function public.mf_revision_ver(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_cli uuid; r jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  begin v_cli := (p ->> 'cliente_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if not exists (select 1 from clientes where id = v_cli and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  r := public._mf_revision_cliente(v_uid, v_cli, null);
  return r || jsonb_build_object('ok', true, 'autorizado', exists (select 1 from mf_autorizaciones where auth_user_id = v_uid and cliente_id = v_cli and usado_en_credito is null and expira > now()));
end $$;

-- Ficha de crédito del cliente (dueño/supervisor; sin equipo, el dueño)
create or replace function public.mf_ficha_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_cli uuid; v_lim numeric; v_gv numeric;
  t text; c text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  begin
    v_cli := (p ->> 'cliente_id')::uuid; v_lim := round(nullif(p ->> 'limite', '')::numeric, 2); v_gv := round(nullif(p ->> 'garantia_valor', '')::numeric, 2);
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if (v_lim is not null and (v_lim < 0 or v_lim > 100000000)) or (v_gv is not null and (v_gv < 0 or v_gv > 100000000)) then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;
  if not exists (select 1 from clientes where id = v_cli and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  insert into mf_clientes_ficha (cliente_id, auth_user_id, limite, fiador_nombre, fiador_cedula, fiador_telefono, fiador_direccion, garantia, garantia_valor, notas, actualizado_por, updated_at)
  values (v_cli, v_uid, v_lim, left(nullif(btrim(p ->> 'fiador_nombre'), ''), 120), left(nullif(btrim(p ->> 'fiador_cedula'), ''), 30), left(nullif(btrim(p ->> 'fiador_telefono'), ''), 30),
          left(nullif(btrim(p ->> 'fiador_direccion'), ''), 250), left(nullif(btrim(p ->> 'garantia'), ''), 300), v_gv, left(nullif(btrim(p ->> 'notas'), ''), 300),
          coalesce(v_act ->> 'nombre', left(nullif(btrim(p ->> 'por'), ''), 120), 'Dueño'), now())
  on conflict (cliente_id) do update set limite = excluded.limite, fiador_nombre = excluded.fiador_nombre, fiador_cedula = excluded.fiador_cedula,
    fiador_telefono = excluded.fiador_telefono, fiador_direccion = excluded.fiador_direccion, garantia = excluded.garantia, garantia_valor = excluded.garantia_valor,
    notas = excluded.notas, actualizado_por = excluded.actualizado_por, updated_at = now()
  where mf_clientes_ficha.auth_user_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- Autorizar UNA excepción (pasa el límite o cliente atrasado): dueño/supervisor, con motivo, 15 minutos
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
  insert into mf_autorizaciones (auth_user_id, cliente_id, motivo, autorizado_por, expira)
  values (v_uid, v_cli, v_mot, coalesce(v_act ->> 'nombre', left(nullif(btrim(p ->> 'por'), ''), 120), 'Dueño'), now() + interval '15 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Reglas: límite por defecto y bloqueo por atraso (solo el dueño)
create or replace function public.mf_prestar_config(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_lim numeric; v_d integer;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' <> 'dueno' then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  begin v_lim := round(nullif(p ->> 'limite_defecto', '')::numeric, 2); v_d := nullif(p ->> 'bloq_atraso_dias', '')::integer;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if (v_lim is not null and (v_lim < 0 or v_lim > 100000000)) or (v_d is not null and (v_d < 1 or v_d > 365)) then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  perform set_config('n360.mf_ok', '1', true);
  update configuracion_empresa set mf_limite_defecto = v_lim, mf_bloq_atraso_dias = v_d where auth_user_id = v_uid;
  perform set_config('n360.mf_ok', '', true);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public._mf_revision_cliente(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._mf_revision_trg() from public, anon, authenticated;
revoke all on function public.mf_revision_ver(jsonb) from public, anon;
revoke all on function public.mf_ficha_guardar(jsonb) from public, anon;
revoke all on function public.mf_autorizar(jsonb) from public, anon;
revoke all on function public.mf_prestar_config(jsonb) from public, anon;
grant execute on function public.mf_revision_ver(jsonb) to authenticated;
grant execute on function public.mf_ficha_guardar(jsonb) to authenticated;
grant execute on function public.mf_autorizar(jsonb) to authenticated;
grant execute on function public.mf_prestar_config(jsonb) to authenticated;
