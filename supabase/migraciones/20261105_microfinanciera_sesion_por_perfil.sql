-- Panel Microfinanciera conectado al sistema multiusuario (05-nov-2026)
-- Cobradores y supervisores entran con el usuario elegido en el sistema, sin un segundo PIN.
-- El dueño/administrador sigue entrando con su PIN de administrador de siempre (el mismo del sistema).
-- Nota: el servidor confía en el usuario elegido en el sistema (igual que el resto de módulos). Se reforzará con usuarios propios (punto D).
create or replace function public.mf_sesion_perfil(p_perfil_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_central uuid; pf record; e record; v_tok text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_central := public._auth_id_central_del_grupo();
  select * into pf from perfiles_acceso where id = p_perfil_id and auth_user_id = v_central and activo;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if pf.tipo = 'admin' then return jsonb_build_object('ok', false, 'motivo', 'admin_pin'); end if;
  select rol, puede_vender, activo into e from mf_equipo where perfil_id = pf.id and auth_user_id = v_uid;
  if not found or not e.activo then return jsonb_build_object('ok', false, 'motivo', 'sin_acceso'); end if;
  delete from mf_sesiones where expira < now() - interval '1 day';
  v_tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into mf_sesiones (token_hash, auth_user_id, perfil_id, nombre, rol, expira)
  values (encode(extensions.digest(v_tok, 'sha256'), 'hex'), v_uid, pf.id, pf.nombre, e.rol, now() + interval '14 hours');
  return jsonb_build_object('ok', true, 'token', v_tok, 'rol', e.rol, 'nombre', pf.nombre, 'perfil_id', pf.id, 'puede_vender', e.puede_vender, 'expira', now() + interval '14 hours');
end $$;
revoke all on function public.mf_sesion_perfil(uuid) from public, anon;
grant execute on function public.mf_sesion_perfil(uuid) to authenticated;

-- El PIN propio del Panel pasa a ser opcional (ya no se exige al agregar a alguien al equipo)
do $$
declare d text := pg_get_functiondef('public.mf_equipo_guardar(jsonb)'::regprocedure);
  v_viejo text := $q$  if v_pin is null and coalesce((p ->> 'activo')::boolean, true)
     and not exists (select 1 from mf_pines where perfil_id = v_pid and auth_user_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'pin_falta'); end if;
$q$;
begin
  if position('pin_falta' in d) = 0 then return; end if;
  if position(v_viejo in d) = 0 then raise exception 'texto no encontrado; no se cambió nada'; end if;
  execute replace(d, v_viejo, '');
end $$;
