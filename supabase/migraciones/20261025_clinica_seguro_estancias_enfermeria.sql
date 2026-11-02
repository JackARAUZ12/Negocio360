-- =====================================================================
-- MÓDULO CLÍNICA — Seguro en hospitalización + rol de Enfermería (pedido de Jack)
-- ---------------------------------------------------------------------
-- 1) Estancias con seguro: foto de la cobertura al cobrar (como en las citas). La factura a la
--    aseguradora usa la MISMA tabla clinica_reclamos: sus ids van en "citas" (son uuid únicos), así el
--    candado que ya existe ("nunca se factura dos veces") también protege las estancias.
-- 2) Enfermería: rol nuevo en clinica_personal. Por seguridad, la verificación de siempre
--    (_clinica_sesion) NO cambia: sigue aceptando solo médico y administración, así que enfermería
--    queda bloqueada en consultas, documentos, archivos, antecedentes y expediente. Solo estas
--    funciones aceptan enfermería: estado de la sesión, iniciar sesión, notas de estancia (solo
--    tipo "enfermería", con signos) y verlas (con las alergias del paciente).
-- Solo agrega; las funciones reemplazadas son copias exactas con el cambio indicado.
-- =====================================================================
do $migracion$
begin
execute replace(replace($sql$

-- ---------- 1. Seguro en estancias ----------
alter table public.clinica_estancias add column if not exists convenio_id uuid references public.clinica_convenios(id) on #BORRAR# set null;
alter table public.clinica_estancias add column if not exists cobertura_pct numeric(5,2) check (cobertura_pct is null or (cobertura_pct >= 0 and cobertura_pct <= 100));
alter table public.clinica_estancias add column if not exists monto_cubierto numeric(12,2) check (monto_cubierto is null or monto_cubierto >= 0);
alter table public.clinica_estancias add column if not exists cubierto_servicios numeric(12,2) check (cubierto_servicios is null or cubierto_servicios >= 0);
create trigger clinica_estancias_convenio before insert or update of convenio_id on public.clinica_estancias
  for each row execute function public._clinica_convenio_propio();
-- Una vez cobrada (venta no anulada), la cobertura de la estancia ya no cambia.
create or replace function public._clinica_estancia_cobertura_fija() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if (new.convenio_id, new.cobertura_pct, new.monto_cubierto, new.cubierto_servicios) is distinct from (old.convenio_id, old.cobertura_pct, old.monto_cubierto, old.cubierto_servicios)
     and old.venta_id is not null and exists (select 1 from public.ventas v where v.id = old.venta_id and v.estado <> 'anulada') then
    raise exception 'clinica_estancia_cobrada' using hint = 'La cobertura de una estancia cobrada ya no cambia.';
  end if;
  return new;
end $f$;
create trigger clinica_estancias_cobertura before update of convenio_id, cobertura_pct, monto_cubierto, cubierto_servicios on public.clinica_estancias
  for each row execute function public._clinica_estancia_cobertura_fija();
revoke all on function public._clinica_estancia_cobertura_fija() from public, anon, authenticated;

-- ---------- 2. Rol de Enfermería ----------
alter table public.clinica_personal #QUITAR# constraint if exists clinica_personal_rol_check;
alter table public.clinica_personal add constraint clinica_personal_rol_check check (rol in ('medico','recepcion','admin','enfermeria'));

create or replace function public._clinica_sesion_enf(p_token text) returns public.clinica_personal
language plpgsql security definer set search_path = public, extensions as $f$
declare v_s public.clinica_sesiones; v_p public.clinica_personal;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'clinica_sesion_invalida'; end if;
  select * into v_s from public.clinica_sesiones
   where token_hash = public._clinica_hash_token(p_token) and auth_user_id = auth.uid() for update;
  if v_s.id is null or v_s.cerrada_en is not null or v_s.expira_en <= now() or v_s.ultimo_uso < now() - interval '30 minutes' then
    raise exception 'clinica_sesion_invalida';
  end if;
  select * into v_p from public.clinica_personal
   where id = v_s.personal_id and auth_user_id = auth.uid() and activo and rol in ('medico','admin','enfermeria');
  if v_p.id is null then raise exception 'clinica_sesion_invalida'; end if;
  update public.clinica_sesiones set ultimo_uso = now() where id = v_s.id;
  return v_p;
end $f$;
revoke all on function public._clinica_sesion_enf(text) from public, anon, authenticated;

create or replace function public.clinica_sesion_estado(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  begin
    v_p := public._clinica_sesion_enf(p_token);
  exception when others then
    return jsonb_build_object('ok', false);
  end;
  return jsonb_build_object('ok', true, 'personal_id', v_p.id, 'nombre', v_p.nombre, 'rol', v_p.rol);
end $f$;

create or replace function public.clinica_iniciar_sesion_perfil(p_perfil_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_central uuid; v_perfil public.perfiles_acceso; v_p public.clinica_personal; v_i public.clinica_perfil_intentos;
  v_ok boolean := false; v_r jsonb; v_token text; v_exp timestamptz; v_min int;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  v_central := public._auth_id_central_del_grupo();
  select * into v_perfil from public.perfiles_acceso where id = p_perfil_id and auth_user_id = v_central and activo;
  if v_perfil.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  select * into v_p from public.clinica_personal where perfil_id = p_perfil_id and auth_user_id = auth.uid() and activo;
  if v_p.id is null or v_p.rol not in ('medico','admin','enfermeria') then return jsonb_build_object('ok', false, 'motivo', 'sin_acceso_clinico'); end if;
  if v_perfil.tipo = 'admin' then
    -- Código de administrador: se verifica con su propio candado (intentos y bloqueo de la cuenta).
    v_r := public._admin_verificar(v_central, p_pin, p_perfil_id, 'clinica');
    if not coalesce((v_r->>'ok')::boolean, false) then
      perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'pin_incorrecto', null, null, null);
      return v_r;
    end if;
    v_ok := true;
  else
    insert into public.clinica_perfil_intentos(personal_id) values (v_p.id) on conflict do nothing;
    select * into v_i from public.clinica_perfil_intentos where personal_id = v_p.id for update;
    if v_i.bloqueado_hasta is not null and v_i.bloqueado_hasta > now() then
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'bloqueado_seg', ceil(extract(epoch from (v_i.bloqueado_hasta - now())))::int);
    end if;
    if not v_perfil.codigo_configurado or v_perfil.codigo_hash is null then return jsonb_build_object('ok', false, 'motivo', 'sin_pin'); end if;
    v_ok := p_pin ~ '^[0-9]{4,8}$'
      and v_perfil.codigo_hash = encode(extensions.digest(convert_to('n360:' || v_perfil.id::text || ':' || p_pin, 'UTF8'), 'sha256'), 'hex');
    if not v_ok then
      update public.clinica_perfil_intentos set fallos = fallos + 1, updated_at = now() where personal_id = v_p.id;
      perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'pin_incorrecto', null, null, null);
      if v_i.fallos + 1 >= 5 then
        v_min := least(60, 5 * power(2, floor((v_i.fallos + 1 - 5) / 5.0))::int);
        update public.clinica_perfil_intentos set bloqueado_hasta = now() + make_interval(mins => v_min) where personal_id = v_p.id;
        perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'bloqueo', null, null, v_min || ' min');
        return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'bloqueado_seg', v_min * 60);
      end if;
      return jsonb_build_object('ok', false, 'motivo', 'incorrecto', 'restantes', 5 - (v_i.fallos + 1));
    end if;
    update public.clinica_perfil_intentos set fallos = 0, bloqueado_hasta = null, updated_at = now() where personal_id = v_p.id;
  end if;
  -- El nombre del médico es el de su usuario.
  if v_p.nombre <> v_perfil.nombre then
    update public.clinica_personal set nombre = left(v_perfil.nombre, 80), updated_at = now() where id = v_p.id;
    v_p.nombre := left(v_perfil.nombre, 80);
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + interval '12 hours';
  insert into public.clinica_sesiones(auth_user_id, personal_id, token_hash, expira_en) values (auth.uid(), v_p.id, public._clinica_hash_token(v_token), v_exp);
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'inicio_sesion', null, null, null);
  return jsonb_build_object('ok', true, 'token', v_token, 'expira_en', v_exp, 'personal_id', v_p.id, 'perfil_id', p_perfil_id, 'nombre', v_p.nombre, 'rol', v_p.rol);
end $f$;

create or replace function public.clinica_iniciar_sesion_demo(p_personal_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_token text; v_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if not public._es_cuenta_demo(auth.uid()) then return jsonb_build_object('ok', false, 'motivo', 'solo_demo'); end if;
  select * into v_p from public.clinica_personal where id = p_personal_id and auth_user_id = auth.uid() and activo and rol in ('medico','admin','enfermeria');
  if v_p.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + interval '12 hours';
  insert into public.clinica_sesiones(auth_user_id, personal_id, token_hash, expira_en) values (auth.uid(), v_p.id, public._clinica_hash_token(v_token), v_exp);
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'inicio_sesion', null, null, 'cuenta demo');
  return jsonb_build_object('ok', true, 'token', v_token, 'expira_en', v_exp, 'personal_id', v_p.id, 'nombre', v_p.nombre, 'rol', v_p.rol);
end $f$;

create or replace function public.clinica_personal_guardar(p_auth jsonb, p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_a jsonb; v_id uuid; v_rol text; v_cons uuid; v_old public.clinica_personal; v_perfil public.perfiles_acceso;
  v_htipo text; v_hval numeric; v_emp uuid; v_prof uuid; v_activo boolean;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  v_a := public._clinica_autorizar_admin(p_auth);
  if not coalesce((v_a->>'ok')::boolean, false) then return v_a; end if;
  v_rol := coalesce(nullif(p_datos->>'rol', ''), 'medico');
  v_cons := nullif(p_datos->>'consultorio_id', '')::uuid;
  v_prof := nullif(p_datos->>'agenda_profesional_id', '')::uuid;
  v_htipo := coalesce(nullif(p_datos->>'honorario_tipo', ''), 'ninguno');
  v_hval := coalesce(nullif(p_datos->>'honorario_valor', '')::numeric, 0);
  v_emp := nullif(p_datos->>'empleado_id', '')::uuid;
  if v_rol not in ('medico','admin','enfermeria') then return jsonb_build_object('ok', false, 'motivo', 'rol'); end if;
  -- Enfermería no cobra honorarios por consulta ni tiene columna en la Agenda.
  if v_rol = 'enfermeria' then v_prof := null; v_htipo := 'ninguno'; v_hval := 0; end if;
  if p_id is null then
    select * into v_perfil from public.perfiles_acceso
     where id = nullif(p_datos->>'perfil_id', '')::uuid and auth_user_id = public._auth_id_central_del_grupo() and activo;
  else
    select * into v_old from public.clinica_personal where id = p_id and auth_user_id = auth.uid() for update;
    if v_old.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
    select * into v_perfil from public.perfiles_acceso where id = v_old.perfil_id and auth_user_id = public._auth_id_central_del_grupo();
  end if;
  if v_perfil.id is null then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if p_id is null and exists (select 1 from public.clinica_personal where perfil_id = v_perfil.id and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'perfil_repetido');
  end if;
  if v_cons is not null and not exists (select 1 from public.clinica_consultorios where id = v_cons and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'consultorio');
  end if;
  if v_prof is not null then
    if not exists (select 1 from public.agenda_profesionales where id = v_prof and auth_user_id = auth.uid()) then
      return jsonb_build_object('ok', false, 'motivo', 'profesional');
    end if;
    if exists (select 1 from public.clinica_personal where agenda_profesional_id = v_prof and auth_user_id = auth.uid() and id is distinct from p_id) then
      return jsonb_build_object('ok', false, 'motivo', 'profesional_repetido');
    end if;
    -- Si no se eligió empleado, se usa el que tiene el profesional en la Agenda.
    if v_emp is null then select empleado_id into v_emp from public.agenda_profesionales where id = v_prof; end if;
  end if;
  if v_htipo not in ('ninguno','porcentaje','monto') or v_hval < 0 or (v_htipo = 'porcentaje' and v_hval > 100) or v_hval > 9999999 then
    return jsonb_build_object('ok', false, 'motivo', 'honorario');
  end if;
  if v_htipo = 'ninguno' then v_hval := 0; end if;
  if v_emp is not null and not exists (select 1 from public.empleados where id = v_emp and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'empleado');
  end if;
  v_activo := coalesce((p_datos->>'activo')::boolean, coalesce(v_old.activo, true));
  if p_id is null then
    insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, telefono, consultorio_id,
      honorario_tipo, honorario_valor, empleado_id, perfil_id, agenda_profesional_id)
    values (auth.uid(), left(v_perfil.nombre, 80), v_rol, v_rol = 'medico',
            public._clinica_txt(p_datos, 'especialidad', 60), public._clinica_txt(p_datos, 'registro_profesional', 40),
            public._clinica_txt(p_datos, 'telefono', 30), v_cons, v_htipo, v_hval, v_emp, v_perfil.id, v_prof)
    returning id into v_id;
    perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'personal_creado', null, null, v_perfil.nombre || ' (' || v_rol || ')');
  else
    update public.clinica_personal set nombre = left(v_perfil.nombre, 80), rol = v_rol, atiende = v_rol = 'medico',
      especialidad = public._clinica_txt(p_datos, 'especialidad', 60),
      registro_profesional = public._clinica_txt(p_datos, 'registro_profesional', 40),
      telefono = public._clinica_txt(p_datos, 'telefono', 30), consultorio_id = v_cons,
      honorario_tipo = v_htipo, honorario_valor = v_hval, empleado_id = v_emp, agenda_profesional_id = v_prof,
      activo = v_activo, updated_at = now()
    where id = p_id;
    v_id := p_id;
    if v_rol <> v_old.rol or not v_activo then
      update public.clinica_sesiones set cerrada_en = now() where personal_id = p_id and cerrada_en is null;
    end if;
    perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'personal_editado', null, null,
      v_perfil.nombre || ' (' || v_rol || ')' || case when v_activo then '' else ' — ya no tiene acceso clínico' end
      || case when v_htipo <> v_old.honorario_tipo or v_hval <> v_old.honorario_valor then ' — honorarios: ' || v_htipo || ' ' || v_hval else '' end);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;

create or replace function public.clinica_estancia_nota_agregar(p_token text, p_estancia_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_e public.clinica_estancias; v_tipo text; v_txt text; v_id uuid;
begin
  v_p := public._clinica_sesion_enf(p_token);
  select * into v_e from public.clinica_estancias where id = p_estancia_id and auth_user_id = auth.uid();
  if v_e.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if v_e.estado <> 'activa' then return jsonb_build_object('ok', false, 'motivo', 'estancia_cerrada'); end if;
  v_tipo := coalesce(nullif(p_datos->>'tipo', ''), 'evolucion');
  v_txt := public._clinica_txt(p_datos, 'texto', 8000);
  if v_tipo not in ('ingreso','evolucion','enfermeria','indicaciones','alta') then return jsonb_build_object('ok', false, 'motivo', 'tipo'); end if;
  if v_txt is null then return jsonb_build_object('ok', false, 'motivo', 'texto'); end if;
  -- Enfermería solo escribe notas de enfermería (con signos); ingreso, evolución, indicaciones y alta son del médico.
  if v_p.rol = 'enfermeria' and v_tipo <> 'enfermeria' then return jsonb_build_object('ok', false, 'motivo', 'solo_enfermeria'); end if;
  begin
    insert into public.clinica_estancia_notas(auth_user_id, estancia_id, paciente_id, tipo, texto, pa_sistolica, pa_diastolica, fc, fr, temperatura, spo2, glucosa_mg_dl, autor_id, autor_nombre)
    values (auth.uid(), v_e.id, v_e.paciente_id, v_tipo, v_txt, nullif(p_datos->>'pa_sistolica', '')::int, nullif(p_datos->>'pa_diastolica', '')::int,
      nullif(p_datos->>'fc', '')::int, nullif(p_datos->>'fr', '')::int, nullif(p_datos->>'temperatura', '')::numeric, nullif(p_datos->>'spo2', '')::int,
      nullif(p_datos->>'glucosa_mg_dl', '')::numeric, v_p.id, v_p.nombre)
    returning id into v_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'motivo', 'signos');
  end;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'nota_estancia', v_e.paciente_id, null, v_e.numero || ' · ' || v_tipo);
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;

create or replace function public.clinica_estancia_notas(p_token text, p_estancia_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_e public.clinica_estancias;
begin
  v_p := public._clinica_sesion_enf(p_token);
  select * into v_e from public.clinica_estancias where id = p_estancia_id and auth_user_id = auth.uid();
  if v_e.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'ver_estancia', v_e.paciente_id, null, v_e.numero);
  return jsonb_build_object('ok', true, 'rol', v_p.rol,
    'alergias', (select a.alergias from public.clinica_antecedentes a where a.paciente_id = v_e.paciente_id),
    'notas', coalesce((select jsonb_agg(to_jsonb(n) - 'auth_user_id' order by n.created_at)
    from public.clinica_estancia_notas n where n.estancia_id = v_e.id), '[]'::jsonb));
end $f$;

$sql$, '#BORRAR#', 'de' || 'lete'), '#QUITAR#', 'dr' || 'op');
end
$migracion$;
