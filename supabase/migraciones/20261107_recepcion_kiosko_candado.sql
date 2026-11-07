-- Recepción: candado contra turnos repetidos desde el kiosko (aplicado como recepcion_kiosko_candado)
alter table public.recepcion_turnos add column if not exists dispositivo_id uuid;
create index if not exists idx_rec_turnos_disp on public.recepcion_turnos(dispositivo_id, created_at desc) where dispositivo_id is not null;

create or replace function public.recepcion_kiosko_turno(p_secreto text, p_servicio uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_disp uuid; v_ult timestamptz; v_min int; r jsonb; v_seg int;
begin
  v_uid := _rec_disp(p_secreto, 'kiosko');
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'equipo'); end if;
  select id into v_disp from recepcion_dispositivos where secreto_hash = _rec_hash(p_secreto);
  perform pg_advisory_xact_lock(hashtextextended('rec_kiosko:' || v_disp::text, 0));
  -- Candado 1: un turno cada 10 segundos por kiosko
  select max(created_at) into v_ult from recepcion_turnos where dispositivo_id = v_disp and created_at > now() - interval '1 minute';
  if v_ult is not null and v_ult > now() - interval '10 seconds' then
    v_seg := greatest(1, ceil(extract(epoch from (v_ult + interval '10 seconds' - now())))::int);
    return jsonb_build_object('ok', false, 'motivo', 'rapido', 'espera_seg', v_seg);
  end if;
  -- Candado 2: máximo 4 turnos por minuto por kiosko
  select count(*) into v_min from recepcion_turnos where dispositivo_id = v_disp and created_at > now() - interval '1 minute';
  if v_min >= 4 then return jsonb_build_object('ok', false, 'motivo', 'rapido', 'espera_seg', 30); end if;
  -- Candado 3: máximo 20 por minuto entre todos los kioskos del negocio
  if (select count(*) from recepcion_turnos where auth_user_id = v_uid and origen = 'kiosko' and created_at > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('ok', false, 'motivo', 'rapido', 'espera_seg', 30);
  end if;
  r := _rec_crear(v_uid, p_servicio, null, null, null, 'kiosko', 'Kiosko');
  if (r->>'ok')::boolean then
    update recepcion_turnos set dispositivo_id = v_disp where id = (r->>'id')::uuid;
    r := r || jsonb_build_object('min_por_persona', round(_rec_min_por_persona(v_uid), 1));
  end if;
  return r;
end $$;
grant execute on function public.recepcion_kiosko_turno(text, uuid) to anon, authenticated;
