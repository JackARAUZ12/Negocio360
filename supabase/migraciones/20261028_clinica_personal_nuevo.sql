-- =====================================================================
-- Clínica · "➕ Nuevo médico" en Médicos y seguridad (SOLO AGREGA una función)
-- Crea, en UNA sola operación (todo o nada):
--   1) su usuario del sistema (perfiles_acceso, restringido) con su código y las pantallas de Clínica
--      que le tocan según el rol, como lo hace el menú de usuarios (mismo límite de usuarios del plan
--      y mismo formato del código: sha256 de 'n360:<id>:<código>');
--   2) su columna en la Agenda (si se pide; enfermería no lleva), ligada a su usuario;
--   3) su ficha de Clínica, por la misma función de siempre (clinica_personal_guardar), que vuelve a
--      revisar el código de administrador, el consultorio y los honorarios.
-- En una cuenta DEMO (sin multiusuario) no se crea usuario: queda como los médicos de ejemplo
-- (se elige en la lista para abrir expedientes, sin código) y no pide el código de administrador.
-- =====================================================================
create or replace function public.clinica_personal_nuevo(p_auth jsonb, p_nombre text, p_codigo text, p_datos jsonb, p_columna_agenda boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $f$
declare v_uid uuid := auth.uid(); v_demo boolean; v_a jsonb; v_nombre text := btrim(coalesce(p_nombre, '')); v_rol text; v_central uuid; v_lim int; v_act int;
  v_perfil uuid; v_prof uuid; v_mods text[]; v_r jsonb; v_cons uuid; v_htipo text; v_hval numeric; v_id uuid; v_color text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  v_demo := public._es_cuenta_demo(v_uid);
  v_rol := coalesce(nullif(p_datos->>'rol', ''), 'medico');
  if v_rol not in ('medico', 'admin', 'enfermeria') then return jsonb_build_object('ok', false, 'motivo', 'rol'); end if;
  if char_length(v_nombre) < 3 or char_length(v_nombre) > 80 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if not v_demo then
    v_a := public._clinica_autorizar_admin(p_auth);
    if not coalesce((v_a->>'ok')::boolean, false) then return v_a; end if;
    if coalesce(p_codigo, '') !~ '^[0-9]{4,12}$' then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  end if;
  v_color := (array['#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#0ea5e9','#ef4444','#14b8a6'])[1 + (select count(*) from public.agenda_profesionales where auth_user_id = v_uid)::int % 8];
  begin   -- todo o nada
    if not v_demo then
      v_central := public._auth_id_central_del_grupo();
      if exists (select 1 from public.perfiles_acceso where auth_user_id = v_central and lower(btrim(nombre)) = lower(v_nombre)) then
        raise exception 'clinica_nuevo:nombre_repetido';
      end if;
      select coalesce(limite_perfiles, 5) into v_lim from public.usuarios where auth_user_id = v_central;
      select count(*) into v_act from public.perfiles_acceso where auth_user_id = v_central and activo = true;
      if v_act >= coalesce(v_lim, 5) then raise exception 'clinica_nuevo:limite_perfiles'; end if;
      v_mods := case v_rol
        when 'enfermeria' then array['clinica_panel', 'clinica_sala', 'clinica_hospital']
        when 'admin' then array['clinica_panel', 'clinica_sala', 'clinica_pacientes', 'clinica_hospital', 'clinica_seguros', 'clinica_reportes', 'clinica_equipo', 'agenda']
        else array['clinica_panel', 'clinica_sala', 'clinica_pacientes', 'clinica_hospital', 'agenda'] end;
      insert into public.perfiles_acceso(auth_user_id, nombre, tipo, modulos, codigo_configurado)
      values (v_central, v_nombre, 'restringido', to_jsonb(v_mods), true) returning id into v_perfil;
      update public.perfiles_acceso set codigo_hash = encode(extensions.digest(convert_to('n360:' || v_perfil::text || ':' || p_codigo, 'UTF8'), 'sha256'), 'hex') where id = v_perfil;
    end if;
    if coalesce(p_columna_agenda, true) and v_rol <> 'enfermeria' then
      insert into public.agenda_profesionales(auth_user_id, nombre, color, orden, activo, perfil_id)
      values (v_uid, v_nombre, v_color, (select coalesce(max(orden), -1) + 1 from public.agenda_profesionales where auth_user_id = v_uid), true, v_perfil)
      returning id into v_prof;
    end if;
    if not v_demo then
      v_r := public.clinica_personal_guardar(p_auth, null, coalesce(p_datos, '{}'::jsonb) || jsonb_build_object('perfil_id', v_perfil, 'agenda_profesional_id', v_prof, 'rol', v_rol));
      if not coalesce((v_r->>'ok')::boolean, false) then raise exception 'clinica_nuevo:%', coalesce(v_r->>'motivo', 'error'); end if;
      v_id := (v_r->>'id')::uuid;
    else
      -- Demo: médico de ejemplo (sin usuario), con las mismas reglas de consultorio y honorarios.
      v_cons := nullif(p_datos->>'consultorio_id', '')::uuid;
      if v_cons is not null and not exists (select 1 from public.clinica_consultorios where id = v_cons and auth_user_id = v_uid) then raise exception 'clinica_nuevo:consultorio'; end if;
      v_htipo := coalesce(nullif(p_datos->>'honorario_tipo', ''), 'ninguno'); v_hval := coalesce(nullif(p_datos->>'honorario_valor', '')::numeric, 0);
      if v_rol = 'enfermeria' then v_htipo := 'ninguno'; v_hval := 0; end if;
      if v_htipo not in ('ninguno', 'porcentaje', 'monto') or v_hval < 0 or (v_htipo = 'porcentaje' and v_hval > 100) or v_hval > 9999999 then raise exception 'clinica_nuevo:honorario'; end if;
      insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, consultorio_id, honorario_tipo, honorario_valor, agenda_profesional_id)
      values (v_uid, v_nombre, v_rol, v_rol = 'medico', public._clinica_txt(p_datos, 'especialidad', 60), public._clinica_txt(p_datos, 'registro_profesional', 40),
              v_cons, v_htipo, case when v_htipo = 'ninguno' then 0 else v_hval end, v_prof)
      returning id into v_id;
      perform public._clinica_log(v_uid, null, 'Cuenta demo', 'admin', 'personal_creado', null, null, v_nombre || ' (' || v_rol || ')');
    end if;
  exception when others then
    if sqlerrm like 'clinica_nuevo:%' then return jsonb_build_object('ok', false, 'motivo', substr(sqlerrm, 15)); end if;
    raise;
  end;
  return jsonb_build_object('ok', true, 'id', v_id, 'perfil_id', v_perfil, 'agenda_profesional_id', v_prof, 'demo', v_demo);
end $f$;
revoke all on function public.clinica_personal_nuevo(jsonb, text, text, jsonb, boolean) from public, anon;
grant execute on function public.clinica_personal_nuevo(jsonb, text, text, jsonb, boolean) to authenticated;
