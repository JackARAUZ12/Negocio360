-- ============================================================
-- Negocio360 Escritorio — modo sin conexión — FASE 3
-- Numeración por bloques: cada equipo aparta por adelantado un bloque de
-- números de venta (p. ej. 50) del MISMO contador que usa la web
-- (ventas_numeracion), así puede numerar sin internet sin chocar con nadie.
-- SOLO AGREGA. Activo solo para cuentas con el interruptor encendido.
-- ============================================================

create table if not exists public.offline_bloques_numeracion (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid not null,
  dispositivo_id uuid not null,
  desde          integer not null,
  hasta          integer not null check (hasta >= desde),
  created_at     timestamptz not null default now()
);
create index if not exists offline_bloques_numeracion_usuario on public.offline_bloques_numeracion (auth_user_id, created_at desc);
alter table public.offline_bloques_numeracion enable row level security;
create policy offline_bloques_select_propios on public.offline_bloques_numeracion
  for select to authenticated using (auth_user_id = auth.uid());
revoke all on public.offline_bloques_numeracion from public, anon, authenticated;
grant select on public.offline_bloques_numeracion to authenticated;

-- Aparta un bloque para el equipo. Devuelve {desde, hasta, prefijo, digitos}.
-- El número de venta es prefijo || lpad(n, digitos, '0'), igual que
-- generar_numero_venta ('V-000123').
create or replace function public.offline_reservar_numeros(p_dispositivo_uid text, p_cantidad integer default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); v_cfg public.offline_cuentas_habilitadas%rowtype; v_disp public.offline_dispositivos%rowtype;
        v_n integer; v_hasta integer; v_pend integer;
begin
  if v_uid is null then raise exception 'N360_OFFLINE:no_autorizado'; end if;
  if public._es_cuenta_demo(v_uid) then raise exception 'N360_OFFLINE:cuenta_demo'; end if;
  select * into v_cfg from public.offline_cuentas_habilitadas where auth_user_id = v_uid and habilitado;
  if not found then raise exception 'N360_OFFLINE:no_habilitado'; end if;
  select * into v_disp from public.offline_dispositivos where auth_user_id = v_uid and dispositivo_uid = lower(coalesce(p_dispositivo_uid, ''));
  if not found or not v_disp.activo then raise exception 'N360_OFFLINE:dispositivo_no_autorizado'; end if;
  v_n := least(greatest(coalesce(p_cantidad, v_cfg.tamano_bloque), 1), 500);
  -- Freno: no más de 20 bloques por equipo en un día (evita agotar el contador por error)
  select count(*) into v_pend from public.offline_bloques_numeracion
   where dispositivo_id = v_disp.id and created_at > now() - interval '1 day';
  if v_pend >= 20 then raise exception 'N360_OFFLINE:demasiados_bloques'; end if;
  insert into public.ventas_numeracion (auth_user_id, ultimo_numero) values (v_uid, v_n)
    on conflict (auth_user_id) do update set ultimo_numero = ventas_numeracion.ultimo_numero + v_n
    returning ultimo_numero into v_hasta;
  insert into public.offline_bloques_numeracion (auth_user_id, dispositivo_id, desde, hasta)
  values (v_uid, v_disp.id, v_hasta - v_n + 1, v_hasta);
  update public.offline_dispositivos set ultimo_contacto = now() where id = v_disp.id;
  return jsonb_build_object('desde', v_hasta - v_n + 1, 'hasta', v_hasta, 'prefijo', 'V-', 'digitos', 6);
end $f$;
revoke all on function public.offline_reservar_numeros(text, integer) from public, anon;
grant execute on function public.offline_reservar_numeros(text, integer) to authenticated;
