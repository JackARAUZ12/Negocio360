-- =====================================================================
-- Agenda -> Recepción (9-nov-2026)
-- Un evento de Agenda marcado "Enviar a Recepción" entra solo a la fila
-- a su hora (o N minutos antes, configurable). También "Ya llegó" manual.
-- Candados: un solo turno por cita (índice único), solo el mismo día,
-- solo si Recepción y el servicio están activos, cita cancelada/borrada
-- o desvinculada -> su turno en espera se cancela. Nada más se toca.
-- =====================================================================

alter table public.agenda_eventos add column if not exists rec_vincular boolean not null default false;
alter table public.agenda_eventos add column if not exists rec_servicio_id uuid references public.recepcion_servicios(id) on delete set null;
alter table public.agenda_eventos add column if not exists rec_turno_id uuid;
create index if not exists idx_agenda_rec_pend on public.agenda_eventos(fecha) where rec_vincular and rec_turno_id is null;

alter table public.recepcion_turnos add column if not exists agenda_evento_id uuid;
alter table public.recepcion_turnos add column if not exists cita_hora time;
create unique index if not exists ux_rec_turno_agenda on public.recepcion_turnos(agenda_evento_id) where agenda_evento_id is not null;
alter table public.recepcion_turnos drop constraint if exists recepcion_turnos_origen_check;
alter table public.recepcion_turnos add constraint recepcion_turnos_origen_check check (origen in ('recepcion','kiosko','agenda'));

-- Candado: el turno de la cita solo lo escribe el servidor
create or replace function public._agenda_rec_candado() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('n360.rec_agenda', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then new.rec_turno_id := null;
  elsif new.rec_turno_id is distinct from old.rec_turno_id then new.rec_turno_id := old.rec_turno_id; end if;
  return new;
end $$;
drop trigger if exists trg_agenda_rec_candado on public.agenda_eventos;
create trigger trg_agenda_rec_candado before insert or update on public.agenda_eventos
  for each row execute function public._agenda_rec_candado();

-- Si la cita se cancela, se borra o se desvincula: su turno que todavía espera se cancela
create or replace function public._agenda_rec_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.rec_turno_id is not null then
      update recepcion_turnos set estado = 'cancelado', fin_at = now() where id = old.rec_turno_id and estado = 'espera';
    end if;
    return old;
  end if;
  if new.rec_turno_id is not null and (not new.rec_vincular or new.estado in ('cancelado','cancelada')) then
    update recepcion_turnos set estado = 'cancelado', fin_at = now() where id = new.rec_turno_id and estado = 'espera';
  end if;
  return new;
end $$;
drop trigger if exists trg_agenda_rec_sync on public.agenda_eventos;
create trigger trg_agenda_rec_sync after update or delete on public.agenda_eventos
  for each row execute function public._agenda_rec_sync();

-- Crea el turno de UNA cita (p_manual = "Ya llegó": no espera la hora)
create or replace function public._rec_crear_cita(p_evento uuid, p_manual boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e record; cfg jsonb; v_hoy date := _rec_hoy();
  v_min int; r jsonb; v_nom text; v_tel text; v_id uuid;
begin
  select * into e from agenda_eventos where id = p_evento for update skip locked;
  if e.id is null then return jsonb_build_object('ok', false, 'motivo', 'ocupado'); end if;
  if not e.rec_vincular or e.rec_servicio_id is null then return jsonb_build_object('ok', false, 'motivo', 'no_vinculada'); end if;
  if e.rec_turno_id is not null then return jsonb_build_object('ok', false, 'motivo', 'ya_en_fila'); end if;
  if coalesce(e.estado, 'pendiente') in ('cancelado','cancelada','completado','completada') then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
  if e.fecha <> v_hoy then return jsonb_build_object('ok', false, 'motivo', 'no_es_hoy'); end if;
  if e.hora is null then return jsonb_build_object('ok', false, 'motivo', 'sin_hora'); end if;
  select recepcion_cfg into cfg from configuracion_empresa where auth_user_id = e.auth_user_id and usa_modulo_recepcion;
  if cfg is null then return jsonb_build_object('ok', false, 'motivo', 'modulo'); end if;
  if coalesce((cfg ->> 'citas_activas')::boolean, true) = false then return jsonb_build_object('ok', false, 'motivo', 'citas_apagadas'); end if;
  v_min := least(60, greatest(0, coalesce((cfg ->> 'citas_min_antes')::int, 0)));
  if not p_manual and (now() at time zone 'America/Managua') < (e.fecha + e.hora) - make_interval(mins => v_min) then return jsonb_build_object('ok', false, 'motivo', 'temprano'); end if;
  if e.cliente_id is not null then
    select btrim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')), coalesce(nullif(whatsapp, ''), telefono)
      into v_nom, v_tel from clientes where id = e.cliente_id and auth_user_id = e.auth_user_id;
  end if;
  v_nom := coalesce(nullif(v_nom, ''), e.titulo);
  r := _rec_crear(e.auth_user_id, e.rec_servicio_id, v_nom, v_tel,
                  'Cita ' || to_char(e.hora, 'HH24:MI') || ' · ' || left(coalesce(e.titulo, ''), 120), 'agenda', 'Agenda');
  if not (r ->> 'ok')::boolean then return r; end if;
  v_id := (r ->> 'id')::uuid;
  update recepcion_turnos set agenda_evento_id = e.id, cita_hora = e.hora,
         orden_cola = case when coalesce((cfg ->> 'citas_prioridad')::boolean, false)
                           then orden_cola - 10000000000 else orden_cola end   -- con prioridad: antes de los que llegaron sin cita
   where id = v_id;
  perform set_config('n360.rec_agenda', '1', true);
  update agenda_eventos set rec_turno_id = v_id where id = e.id;
  perform set_config('n360.rec_agenda', '', true);
  return r;
end $$;
revoke all on function public._rec_crear_cita(uuid, boolean) from public, anon, authenticated;

-- "Ya llegó": desde Agenda o desde Recepción
create or replace function public.recepcion_cita_llego(p_evento uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not exists (select 1 from agenda_eventos where id = p_evento and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return _rec_crear_cita(p_evento, true);
end $$;
revoke all on function public.recepcion_cita_llego(uuid) from public, anon;
grant execute on function public.recepcion_cita_llego(uuid) to authenticated;

-- El servidor revisa cada minuto las citas de hoy que ya llegaron a su hora
create or replace function public.recepcion_citas_procesar()
returns integer language plpgsql security definer set search_path = public as $$
declare e record; n int := 0; r jsonb;
begin
  for e in select a.id from agenda_eventos a
            where a.rec_vincular and a.rec_turno_id is null and a.fecha = _rec_hoy() and a.hora is not null
              and (a.fecha + a.hora) <= (now() at time zone 'America/Managua') + interval '60 minutes'
            order by a.hora limit 500 loop
    begin
      r := _rec_crear_cita(e.id, false);
      if (r ->> 'ok')::boolean then n := n + 1; end if;
    exception when others then null;   -- una cita con problema nunca frena a las demás
    end;
  end loop;
  return n;
end $$;
revoke all on function public.recepcion_citas_procesar() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('recepcion-citas-agenda');
exception when others then null; end $$;
select cron.schedule('recepcion-citas-agenda', '* * * * *', 'select public.recepcion_citas_procesar()');
