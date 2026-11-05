-- PANEL MICROFINANCIERA · "Solo el Panel" para cobradores (4-nov-2026)
-- El dueño puede dejar a un cobrador/supervisor con acceso SOLO al Panel Microfinanciera:
-- así no abre Caja, Créditos, Reportes ni otros módulos (no ve lo ajeno ni mueve dinero fuera del Panel).
-- Solo cambia la lista de módulos de ESE perfil (lo mismo que se hace a mano en el menú de perfiles).
create or replace function public.mf_solo_panel(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_central uuid; v_pid uuid; v_antes jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' <> 'dueno' then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  begin v_pid := (p ->> 'perfil_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  v_central := public._auth_id_central_del_grupo();
  if not exists (select 1 from mf_equipo where perfil_id = v_pid and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cobrador'); end if;
  select modulos into v_antes from perfiles_acceso where id = v_pid and auth_user_id = v_central and tipo <> 'admin' for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  update perfiles_acceso set modulos = '["microfinanciera"]'::jsonb, updated_at = now() where id = v_pid;
  return jsonb_build_object('ok', true, 'antes', v_antes);
end $$;
revoke all on function public.mf_solo_panel(jsonb) from public, anon;
grant execute on function public.mf_solo_panel(jsonb) to authenticated;
