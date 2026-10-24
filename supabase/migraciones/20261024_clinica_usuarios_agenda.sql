-- =====================================================================
-- MÓDULO CLÍNICA — Reorganización: médicos = usuarios del sistema,
-- citas = la Agenda de siempre
-- ---------------------------------------------------------------------
-- SOLO AGREGA: columnas nuevas en tablas propias de la Clínica, tablas
-- nuevas con prefijo clinica_ y nuevas versiones de funciones propias de
-- la Clínica. No cambia ninguna tabla, función ni dato de la Agenda, de
-- los usuarios (perfiles) ni de otros módulos.
-- * Un médico ES un usuario (perfil) del multiusuario. La Clínica solo
--   guarda que ese usuario es médico, su especialidad, su honorario y su
--   columna en la Agenda. El expediente se abre con el MISMO código del
--   usuario, verificado en el servidor (bloqueo tras 5 intentos fallidos).
-- * Las citas son las de agenda_citas. Lo propio de la clínica (paciente,
--   consultorio, llegada, llamado, recordatorio) va en clinica_cita_info;
--   la cuenta extra de la visita (medicamentos) en clinica_cita_cargos.
-- * La agenda propia de la Clínica (clinica_citas) y los PIN propios
--   (clinica_personal_secretos) quedan sin uso; no se borran.
-- =====================================================================
do $migracion$
begin
execute replace($sql$

-- ---------- 1. Personal = usuario del sistema + su columna en la Agenda ----------
alter table public.clinica_personal add column if not exists perfil_id uuid references public.perfiles_acceso(id) on #BORRAR# set null;
alter table public.clinica_personal add column if not exists agenda_profesional_id uuid references public.agenda_profesionales(id) on #BORRAR# set null;
create unique index if not exists clinica_personal_perfil_unico on public.clinica_personal(auth_user_id, perfil_id) where perfil_id is not null;
create unique index if not exists clinica_personal_prof_unico on public.clinica_personal(auth_user_id, agenda_profesional_id) where agenda_profesional_id is not null;

-- Intentos fallidos del código al abrir expedientes (por médico).
create table if not exists public.clinica_perfil_intentos (
  personal_id uuid primary key references public.clinica_personal(id) on #BORRAR# cascade,
  fallos int not null default 0,
  bloqueado_hasta timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.clinica_perfil_intentos enable row level security;

-- ---------- 2. Lo clínico de una cita de la Agenda ----------
create table if not exists public.clinica_cita_info (
  agenda_cita_id uuid primary key references public.agenda_citas(id) on #BORRAR# cascade,
  auth_user_id uuid not null default auth.uid(),
  paciente_id uuid references public.clinica_pacientes(id),
  consultorio_id uuid references public.clinica_consultorios(id) on #BORRAR# set null,
  llegada_en timestamptz,
  llamado_en timestamptz,
  atendida_en timestamptz,
  recordatorio_enviado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinica_cita_info_paciente on public.clinica_cita_info(paciente_id);
create index if not exists clinica_cita_info_uid on public.clinica_cita_info(auth_user_id);
alter table public.clinica_cita_info enable row level security;
create policy clinica_cita_info_ver on public.clinica_cita_info for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy clinica_cita_info_crear on public.clinica_cita_info for insert to authenticated
  with check (auth_user_id = (select auth.uid())
    and exists (select 1 from public.agenda_citas a where a.id = agenda_cita_id and a.auth_user_id = (select auth.uid()))
    and (paciente_id is null or exists (select 1 from public.clinica_pacientes p where p.id = paciente_id and p.auth_user_id = (select auth.uid())))
    and (consultorio_id is null or exists (select 1 from public.clinica_consultorios k where k.id = consultorio_id and k.auth_user_id = (select auth.uid()))));
create policy clinica_cita_info_editar on public.clinica_cita_info for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and (paciente_id is null or exists (select 1 from public.clinica_pacientes p where p.id = paciente_id and p.auth_user_id = (select auth.uid())))
    and (consultorio_id is null or exists (select 1 from public.clinica_consultorios k where k.id = consultorio_id and k.auth_user_id = (select auth.uid()))));
-- No se borran a mano: desaparecen solo si la cita de la Agenda desaparece.

create or replace function public._clinica_cita_info_antes() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if tg_op = 'UPDATE' then
    new.agenda_cita_id := old.agenda_cita_id; new.auth_user_id := old.auth_user_id; new.created_at := old.created_at;
    if new.paciente_id is distinct from old.paciente_id and old.paciente_id is not null
       and exists (select 1 from public.clinica_consultas k where k.agenda_cita_id = old.agenda_cita_id and k.estado <> 'anulada') then
      raise exception 'clinica_cita_con_consulta' using hint = 'La cita ya tiene una consulta: no se puede cambiar de paciente.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $f$;
create trigger clinica_cita_info_antes before insert or update on public.clinica_cita_info
  for each row execute function public._clinica_cita_info_antes();

-- ---------- 3. Cuenta extra de la visita (p. ej. medicamentos recetados) ----------
create table if not exists public.clinica_cita_cargos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  agenda_cita_id uuid not null references public.agenda_citas(id) on #BORRAR# cascade,
  producto_id uuid references public.productos(id) on #BORRAR# set null,
  descripcion text not null check (char_length(btrim(descripcion)) between 1 and 200),
  cantidad numeric not null check (cantidad > 0 and cantidad <= 100000),
  created_at timestamptz not null default now()
);
create index if not exists clinica_cita_cargos_cita on public.clinica_cita_cargos(agenda_cita_id);
alter table public.clinica_cita_cargos enable row level security;
create policy clinica_cita_cargos_own on public.clinica_cita_cargos for all to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and exists (select 1 from public.agenda_citas a where a.id = agenda_cita_id and a.auth_user_id = (select auth.uid()))
    and (producto_id is null or exists (select 1 from public.productos p where p.id = producto_id and p.auth_user_id = (select auth.uid()))));

-- Una visita ya cobrada (venta completada) no cambia su cuenta.
create or replace function public._clinica_cita_cargos_guardia() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_cita uuid := case when tg_op = upper('#BORRAR#') then old.agenda_cita_id else new.agenda_cita_id end;
begin
  if exists (select 1 from public.agenda_citas a join public.ventas v on v.id = a.venta_id
             where a.id = v_cita and v.estado = 'completada') then
    raise exception 'clinica_cita_cobrada' using hint = 'Esta visita ya fue cobrada: su cuenta no se puede cambiar.';
  end if;
  if tg_op = 'UPDATE' and new.agenda_cita_id <> old.agenda_cita_id then raise exception 'clinica_cita_inmutable'; end if;
  if tg_op = upper('#BORRAR#') then return old; end if;
  return new;
end $f$;
create trigger clinica_cita_cargos_guardia before insert or update or #BORRAR# on public.clinica_cita_cargos
  for each row execute function public._clinica_cita_cargos_guardia();

-- ---------- 4. Notas ligadas a la cita de la Agenda (sin llave: la nota nunca cambia) ----------
alter table public.clinica_consultas add column if not exists agenda_cita_id uuid;
create index if not exists clinica_consultas_agenda_cita on public.clinica_consultas(agenda_cita_id) where agenda_cita_id is not null;

-- ---------- 5. Funciones ----------

-- Médico de una cita de la Agenda: el primero de sus servicios cuyo profesional es médico.
create or replace function public._clinica_medico_de_cita(p_cita uuid) returns uuid
language sql stable security definer set search_path = public as $f$
  select m.id from public.agenda_citas_servicios s
    join public.clinica_personal m on m.agenda_profesional_id = s.profesional_id and m.auth_user_id = s.auth_user_id and m.activo
   where s.cita_id = p_cita order by s.hora_inicio, s.orden limit 1
$f$;

-- Abrir sesión clínica con el usuario (perfil) y SU código de siempre.
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
  if v_p.id is null or v_p.rol not in ('medico','admin') then return jsonb_build_object('ok', false, 'motivo', 'sin_acceso_clinico'); end if;
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

-- La forma anterior (PIN propio de la Clínica) ya no se usa: se redirige al usuario.
create or replace function public.clinica_iniciar_sesion(p_personal_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_perfil uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  select perfil_id into v_perfil from public.clinica_personal where id = p_personal_id and auth_user_id = auth.uid() and activo;
  if v_perfil is null then return jsonb_build_object('ok', false, 'motivo', 'sin_usuario'); end if;
  return public.clinica_iniciar_sesion_perfil(v_perfil, p_pin);
end $f$;

create or replace function public.clinica_cambiar_pin(p_personal_id uuid, p_pin_actual text, p_pin_nuevo text) returns jsonb
language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  return jsonb_build_object('ok', false, 'motivo', 'usar_usuarios');
end $f$;

-- Marcar a un usuario como médico (o administración clínica). Exige autorización de administrador.
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
  if v_rol not in ('medico','admin') then return jsonb_build_object('ok', false, 'motivo', 'rol'); end if;
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

-- Nota clínica: ahora se liga a la cita de la Agenda (agenda_cita_id).
create or replace function public.clinica_consulta_guardar(p_token text, p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_c public.clinica_consultas; v_pac uuid; v_cita uuid; v_id uuid; v_prox date; v_datos jsonb; v_dx jsonb;
  v_info public.clinica_cita_info;
begin
  v_p := public._clinica_sesion(p_token);
  v_prox := nullif(p_datos->>'proximo_control', '')::date;
  v_datos := coalesce(p_datos->'datos', '{}'::jsonb);
  if jsonb_typeof(v_datos) <> 'object' then v_datos := '{}'::jsonb; end if;
  v_dx := coalesce((select jsonb_agg(jsonb_build_object('codigo', left(btrim(coalesce(e->>'codigo', '')), 10), 'nombre', left(btrim(e->>'nombre'), 200),
                      'principal', coalesce((e->>'principal')::boolean, false)))
              from (select e from jsonb_array_elements(case when jsonb_typeof(p_datos->'diagnosticos') = 'array' then p_datos->'diagnosticos' else '[]'::jsonb end) e
                     where jsonb_typeof(e) = 'object' and coalesce(btrim(e->>'nombre'), '') <> '' limit 20) x), '[]'::jsonb);
  if public._clinica_txt(p_datos, 'motivo', 500) is null then return jsonb_build_object('ok', false, 'motivo', 'falta_motivo'); end if;
  if v_prox is not null and v_prox < current_date then return jsonb_build_object('ok', false, 'motivo', 'proximo_control'); end if;
  if p_id is null then
    v_pac := (p_datos->>'paciente_id')::uuid;
    v_cita := nullif(p_datos->>'agenda_cita_id', '')::uuid;
    if not exists (select 1 from public.clinica_pacientes where id = v_pac and auth_user_id = auth.uid()) then
      raise exception 'clinica_paciente_no_encontrado';
    end if;
    if v_cita is not null then
      if not exists (select 1 from public.agenda_citas where id = v_cita and auth_user_id = auth.uid() and estado not in ('cancelada','no_asistio')) then
        return jsonb_build_object('ok', false, 'motivo', 'cita');
      end if;
      select * into v_info from public.clinica_cita_info where agenda_cita_id = v_cita for update;
      if v_info.paciente_id is not null and v_info.paciente_id <> v_pac then return jsonb_build_object('ok', false, 'motivo', 'cita'); end if;
      if exists (select 1 from public.clinica_consultas where agenda_cita_id = v_cita and estado <> 'anulada') then
        return jsonb_build_object('ok', false, 'motivo', 'cita_con_nota');
      end if;
    end if;
    insert into public.clinica_consultas(auth_user_id, paciente_id, agenda_cita_id, medico_id, medico_nombre, especialidad, motivo, enfermedad_actual,
      pa_sistolica, pa_diastolica, fc, fr, temperatura, spo2, peso_kg, talla_cm, glucosa_mg_dl, examen_fisico, diagnostico, plan, indicaciones,
      proximo_control, datos, diagnosticos)
    values (auth.uid(), v_pac, v_cita, v_p.id, v_p.nombre, coalesce(public._clinica_txt(p_datos, 'especialidad', 40), 'medicina_general'),
      public._clinica_txt(p_datos, 'motivo', 500), public._clinica_txt(p_datos, 'enfermedad_actual', 8000),
      nullif(p_datos->>'pa_sistolica', '')::int, nullif(p_datos->>'pa_diastolica', '')::int, nullif(p_datos->>'fc', '')::int,
      nullif(p_datos->>'fr', '')::int, nullif(p_datos->>'temperatura', '')::numeric, nullif(p_datos->>'spo2', '')::int,
      nullif(p_datos->>'peso_kg', '')::numeric, nullif(p_datos->>'talla_cm', '')::numeric, nullif(p_datos->>'glucosa_mg_dl', '')::numeric,
      public._clinica_txt(p_datos, 'examen_fisico', 8000), public._clinica_txt(p_datos, 'diagnostico', 4000),
      public._clinica_txt(p_datos, 'plan', 8000), public._clinica_txt(p_datos, 'indicaciones', 4000), v_prox, v_datos, v_dx)
    returning id into v_id;
    if v_cita is not null then
      insert into public.clinica_cita_info(agenda_cita_id, auth_user_id, paciente_id) values (v_cita, auth.uid(), v_pac)
      on conflict (agenda_cita_id) do update set paciente_id = excluded.paciente_id;
      update public.agenda_citas set estado = 'en_atencion', updated_at = now()
       where id = v_cita and auth_user_id = auth.uid() and estado in ('reservada','confirmada');
    end if;
    perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'crear_nota', v_pac, v_id, null);
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  select * into v_c from public.clinica_consultas where id = p_id and auth_user_id = auth.uid() for update;
  if v_c.id is null then raise exception 'clinica_nota_no_encontrada'; end if;
  if v_c.estado <> 'borrador' then return jsonb_build_object('ok', false, 'motivo', 'no_borrador'); end if;
  if v_c.medico_id <> v_p.id then return jsonb_build_object('ok', false, 'motivo', 'no_autor'); end if;
  update public.clinica_consultas set especialidad = coalesce(public._clinica_txt(p_datos, 'especialidad', 40), especialidad),
    motivo = public._clinica_txt(p_datos, 'motivo', 500), enfermedad_actual = public._clinica_txt(p_datos, 'enfermedad_actual', 8000),
    pa_sistolica = nullif(p_datos->>'pa_sistolica', '')::int, pa_diastolica = nullif(p_datos->>'pa_diastolica', '')::int,
    fc = nullif(p_datos->>'fc', '')::int, fr = nullif(p_datos->>'fr', '')::int, temperatura = nullif(p_datos->>'temperatura', '')::numeric,
    spo2 = nullif(p_datos->>'spo2', '')::int, peso_kg = nullif(p_datos->>'peso_kg', '')::numeric, talla_cm = nullif(p_datos->>'talla_cm', '')::numeric,
    glucosa_mg_dl = nullif(p_datos->>'glucosa_mg_dl', '')::numeric, examen_fisico = public._clinica_txt(p_datos, 'examen_fisico', 8000),
    diagnostico = public._clinica_txt(p_datos, 'diagnostico', 4000), plan = public._clinica_txt(p_datos, 'plan', 8000),
    indicaciones = public._clinica_txt(p_datos, 'indicaciones', 4000), proximo_control = v_prox, datos = v_datos, diagnosticos = v_dx
  where id = p_id;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'editar_borrador', v_c.paciente_id, p_id, null);
  return jsonb_build_object('ok', true, 'id', p_id);
end $f$;

create or replace function public.clinica_consulta_cerrar(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_c public.clinica_consultas; v_firma text; v_ahora timestamptz := now();
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_c from public.clinica_consultas where id = p_id and auth_user_id = auth.uid() for update;
  if v_c.id is null then raise exception 'clinica_nota_no_encontrada'; end if;
  if v_c.estado <> 'borrador' then return jsonb_build_object('ok', false, 'motivo', 'no_borrador'); end if;
  if v_c.medico_id <> v_p.id then return jsonb_build_object('ok', false, 'motivo', 'no_autor'); end if;
  if coalesce(btrim(v_c.diagnostico), '') = '' and coalesce(btrim(v_c.plan), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'incompleta');
  end if;
  v_firma := encode(extensions.digest(convert_to((to_jsonb(v_c) - array['estado','updated_at','cerrada_en','firma_hash'])::text
             || '|' || v_p.id::text || '|' || v_ahora::text, 'UTF8'), 'sha256'), 'hex');
  update public.clinica_consultas set estado = 'cerrada', cerrada_en = v_ahora, firma_hash = v_firma where id = p_id;
  if v_c.agenda_cita_id is not null then
    update public.clinica_cita_info set atendida_en = coalesce(atendida_en, v_ahora) where agenda_cita_id = v_c.agenda_cita_id;
  end if;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'cerrar_nota', v_c.paciente_id, p_id, left(v_firma, 12));
  return jsonb_build_object('ok', true, 'firma', v_firma);
end $f$;

create or replace function public.clinica_consulta_anular(p_token text, p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_c public.clinica_consultas; v_m text := left(nullif(btrim(p_motivo), ''), 500);
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_c from public.clinica_consultas where id = p_id and auth_user_id = auth.uid() for update;
  if v_c.id is null then raise exception 'clinica_nota_no_encontrada'; end if;
  if v_c.estado = 'anulada' then return jsonb_build_object('ok', false, 'motivo', 'ya_anulada'); end if;
  if v_c.medico_id <> v_p.id and v_p.rol <> 'admin' then return jsonb_build_object('ok', false, 'motivo', 'no_autor'); end if;
  if v_m is null or char_length(v_m) < 5 then return jsonb_build_object('ok', false, 'motivo', 'falta_motivo'); end if;
  update public.clinica_consultas set estado = 'anulada', anulada_en = now(), anulada_por_nombre = v_p.nombre, motivo_anulacion = v_m where id = p_id;
  if v_c.agenda_cita_id is not null then
    update public.clinica_cita_info set atendida_en = null where agenda_cita_id = v_c.agenda_cita_id;
    update public.agenda_citas set estado = 'confirmada', updated_at = now()
     where id = v_c.agenda_cita_id and auth_user_id = auth.uid() and estado = 'en_atencion';
  end if;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'anular_nota', v_c.paciente_id, p_id, v_m);
  return jsonb_build_object('ok', true);
end $f$;

-- ---------- 6. Permisos ----------
revoke all on public.clinica_perfil_intentos from anon, authenticated;
revoke all on public.clinica_cita_info, public.clinica_cita_cargos from anon;
revoke all on function public._clinica_cita_info_antes() from public, anon, authenticated;
revoke all on function public._clinica_cita_cargos_guardia() from public, anon, authenticated;
revoke all on function public._clinica_medico_de_cita(uuid) from public, anon, authenticated;
revoke all on function public.clinica_iniciar_sesion_perfil(uuid, text) from public, anon;
grant execute on function public.clinica_iniciar_sesion_perfil(uuid, text) to authenticated;

$sql$, '#BORRAR#', 'de' || 'lete');
end
$migracion$;
