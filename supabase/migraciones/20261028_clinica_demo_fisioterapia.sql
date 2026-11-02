-- =====================================================================
-- Clínica · demo de FISIOTERAPIA (solo cuentas demo; no toca cuentas reales ni datos existentes)
--   1) La simulación diaria (_clinica_demo_dia / _clinica_demo_completar) aprende las terapias:
--      fisioterapia, quiropraxia y masoterapia (servicios, motivos, duración, diagnóstico CIE-10,
--      ficha de la especialidad con "sesión N de M" y dolor antes/después). Lo médico sigue igual.
--   2) _clinica_demo_crear_fisio(): cuenta "Centro de Fisioterapia y Rehabilitación Movimiento".
-- =====================================================================

-- 1) Simulación del día: ramas nuevas para las terapias (reemplazos exactos; si el texto no está, se detiene)
do $do$
declare def text;
begin
  def := pg_get_functiondef('public._clinica_demo_dia(uuid,date,text)'::regprocedure);
  if position($q$v_r int; v_urg boolean;$q$ in def) = 0 then raise exception 'dia 1'; end if;
  def := replace(def, $q$v_r int; v_urg boolean;$q$, $q$v_r int; v_urg boolean; v_med2 record;$q$);
  if position($q$      else case when v_r < 85 then 'Consulta general'$q$ in def) = 0 then raise exception 'dia 2'; end if;
  def := replace(def, $q$      else case when v_r < 85 then 'Consulta general'$q$, $q$      when 'Fisioterapia' then case when v_r < 12 then 'Evaluación inicial de fisioterapia' when v_r < 62 then 'Sesión de fisioterapia' when v_r < 82 then 'Sesión con electroterapia y ultrasonido' when v_r < 92 then 'Rehabilitación postoperatoria' else 'Fisioterapia deportiva' end
      when 'Quiropraxia' then case when v_r < 15 then 'Evaluación quiropráctica' when v_r < 80 then 'Ajuste quiropráctico' else 'Ajuste con terapia de tejido blando' end
      when 'Masoterapia' then case when v_r < 35 then 'Masaje terapéutico 60 min' when v_r < 60 then 'Masaje descontracturante 60 min' when v_r < 80 then 'Masaje relajante 60 min' when v_r < 90 then 'Drenaje linfático' else 'Masaje deportivo' end
      else case when v_r < 85 then 'Consulta general'$q$);
  if position($q$      else array['Control de presión'$q$ in def) = 0 then raise exception 'dia 3'; end if;
  def := replace(def, $q$      else array['Control de presión'$q$, $q$      when 'Fisioterapia' then array['Dolor lumbar','Dolor de cuello','Esguince de tobillo','Rehabilitación de rodilla (cirugía)','Hombro doloroso','Dolor de codo (tendinitis)']
      when 'Quiropraxia' then array['Dolor de espalda baja','Dolor de cuello y cabeza','Mala postura','Ciática','Rigidez de espalda','Control de columna']
      when 'Masoterapia' then array['Contractura de espalda','Estrés y tensión','Piernas cansadas','Recuperación deportiva','Dolor de cuello','Relajación']
      else array['Control de presión'$q$);
  if position($q$v_dur := case when v_k in ('Resina dental','Extracción dental','Limpieza dental') then 45 else 30 end;$q$ in def) = 0 then raise exception 'dia 4'; end if;
  def := replace(def, $q$v_dur := case when v_k in ('Resina dental','Extracción dental','Limpieza dental') then 45 else 30 end;$q$,
    $q$v_dur := case when v_k in ('Resina dental','Extracción dental','Limpieza dental') then 45
      when v_k like 'Masaje%' or v_k like 'Evaluación%' or v_k in ('Drenaje linfático', 'Rehabilitación postoperatoria', 'Fisioterapia deportiva') then 60
      when v_med.especialidad in ('Fisioterapia', 'Quiropraxia') then 45 else 30 end;$q$);
  if position($q$        select * into v_med from public.clinica_personal where id = v_meds[1]; $q$ in def) = 0 then raise exception 'dia 5'; end if;
  def := replace(def, $q$        select * into v_med from public.clinica_personal where id = v_meds[1]; 
        select id, nombre, precio into v_serv from public.productos where auth_user_id = p_uid and tipo = 'servicio' and nombre = 'Consulta general' limit 1;
        if v_med.especialidad <> 'Medicina general' then select * into v_med from public.clinica_personal where auth_user_id = p_uid and rol = 'medico' and especialidad = 'Medicina general' limit 1; end if;$q$,
    $q$        -- Lo atiende medicina general si la hay; en un centro de terapias, el mismo terapeuta (dolor agudo).
        select * into v_med2 from public.clinica_personal where auth_user_id = p_uid and rol = 'medico' and activo and especialidad = 'Medicina general' and agenda_profesional_id is not null order by nombre limit 1;
        if v_med2.id is not null then v_med := v_med2;
          select id, nombre, precio into v_serv from public.productos where auth_user_id = p_uid and tipo = 'servicio' and nombre = 'Consulta general' limit 1;
        else v_mot := 'Dolor agudo de espalda: no puede agacharse'; end if;$q$);
  if position('v_med2.id is not null' in def) = 0 then raise exception 'dia 5b'; end if;
  execute def;

  def := pg_get_functiondef('public._clinica_demo_completar(uuid,uuid,boolean)'::regprocedure);
  if position($q$v_metodo text; v_r int;$q$ in def) = 0 then raise exception 'comp 1'; end if;
  def := replace(def, $q$v_metodo text; v_r int;$q$, $q$v_metodo text; v_r int; v_datos jsonb := '{}'::jsonb; v_ses int; v_plan_n int; v_eva int; v_eva2 int; v_zona text; v_terapia boolean;$q$);
  if position($q$when 'Odontología' then 'odontologia' else 'medicina_general' end;$q$ in def) = 0 then raise exception 'comp 2'; end if;
  def := replace(def, $q$when 'Odontología' then 'odontologia' else 'medicina_general' end;$q$,
    $q$when 'Odontología' then 'odontologia' when 'Fisioterapia' then 'fisioterapia' when 'Quiropraxia' then 'quiropraxia' when 'Masoterapia' then 'masoterapia' else 'medicina_general' end;
  v_terapia := v_esp in ('fisioterapia', 'quiropraxia', 'masoterapia');$q$);
  if position($q$  elsif v_esp = 'odontologia' then$q$ in def) = 0 then raise exception 'comp 3'; end if;
  def := replace(def, $q$  elsif v_esp = 'odontologia' then$q$, $q$  elsif v_terapia then
    -- Terapias: zona según el motivo, "sesión N de M" (sus sesiones firmadas antes + 1) y el dolor que baja con el plan.
    v_zona := case when c.notas ilike '%cuello%' then 'Cervical (cuello)' when c.notas ilike '%tobillo%' then 'Tobillo y pie' when c.notas ilike '%rodilla%' then 'Rodilla'
                   when c.notas ilike '%hombro%' then 'Hombro' when c.notas ilike '%codo%' then 'Codo' when c.notas ilike '%pierna%' then 'Varias zonas' else 'Lumbar (espalda baja)' end;
    select count(*) + 1 into v_ses from public.clinica_consultas where paciente_id = v_pac.id and especialidad = v_esp and estado = 'cerrada';
    v_plan_n := case v_esp when 'fisioterapia' then 10 when 'quiropraxia' then 8 else 6 end;
    v_plan_n := ((v_ses - 1) / v_plan_n + 1) * v_plan_n;
    v_eva := least(10, greatest(2, 8 - (v_ses % (case v_esp when 'fisioterapia' then 10 when 'quiropraxia' then 8 else 6 end)) * 5 / 10 + public._clinica_demo_rnd(v_sem || 'ev', 3)));
    v_eva2 := greatest(0, v_eva - 1 - public._clinica_demo_rnd(v_sem || 'ev2', 3));
    v_dx := case
      when v_esp = 'masoterapia' and (c.notas ilike '%estrés%' or c.notas ilike '%relaj%') then '[{"codigo":"Z73.3","nombre":"Problemas relacionados con el estrés","principal":true}]'
      when v_esp = 'masoterapia' then '[{"codigo":"M62.8","nombre":"Contractura muscular (otros trastornos especificados de los músculos)","principal":true}]'
      when c.notas ilike '%ciática%' then '[{"codigo":"M54.3","nombre":"Ciática","principal":true}]'
      when v_zona = 'Cervical (cuello)' then '[{"codigo":"M54.2","nombre":"Cervicalgia","principal":true}]'
      when v_zona = 'Tobillo y pie' then '[{"codigo":"S93.4","nombre":"Esguince y torcedura del tobillo","principal":true}]'
      when v_zona = 'Rodilla' then '[{"codigo":"M17.9","nombre":"Gonartrosis, no especificada","principal":true}]'
      when v_zona = 'Hombro' then '[{"codigo":"M75.1","nombre":"Síndrome del manguito rotatorio","principal":true}]'
      when v_zona = 'Codo' then '[{"codigo":"M77.1","nombre":"Epicondilitis lateral","principal":true}]'
      else '[{"codigo":"M54.5","nombre":"Lumbago no especificado","principal":true}]' end::jsonb;
    if v_esp = 'fisioterapia' then
      v_datos := jsonb_build_object('tipo_sesion', case when v_ses = 1 then 'Evaluación inicial' when v_ses % 10 = 0 then 'Alta' when v_ses % 5 = 0 then 'Reevaluación' else 'Sesión de tratamiento' end,
        'zona', v_zona, 'lado', (array['Derecho','Izquierdo','Ambos'])[1 + public._clinica_demo_rnd(v_sem || 'la', 3)],
        'diagnostico_funcional', 'Dolor y limitación de movimiento en ' || lower(v_zona) || '; dificultad para actividades diarias.',
        'sesion', v_ses, 'sesiones_plan', v_plan_n, 'eva_antes', v_eva, 'eva_despues', v_eva2,
        'movilidad', 'Limitación leve a moderada al final del movimiento; mejora respecto a la sesión anterior.',
        'fuerza', (array['4/5 buena','4/5 buena','5/5 normal','3/5 regular'])[1 + public._clinica_demo_rnd(v_sem || 'fu', 4)],
        'agentes', (array['Compresa caliente, TENS 15 min','Ultrasonido terapéutico, compresa fría','Láser, TENS','Compresa caliente, ultrasonido'])[1 + public._clinica_demo_rnd(v_sem || 'ag', 4)],
        'tecnicas', 'Movilización articular, liberación miofascial y estiramientos asistidos.',
        'ejercicios', 'Estiramientos suaves 3 veces al día (10 repeticiones). Hielo 15 minutos si hay molestia.',
        'evolucion', case when v_eva2 < v_eva then 'Mejoría' else 'Igual' end);
      v_plan := 'Continuar plan de fisioterapia: ' || v_plan_n || ' sesiones, 2 a 3 por semana. Ejercicios en casa.';
    elsif v_esp = 'quiropraxia' then
      v_datos := jsonb_build_object('zona', case when v_zona = 'Cervical (cuello)' then 'Cervical (cuello)' else 'Lumbar (espalda baja)' end,
        'segmentos', (array['C5, T4, L5','C1, C6','T6, L4, sacro','L3, L5'])[1 + public._clinica_demo_rnd(v_sem || 'sg', 4)],
        'tecnica', (array['Diversificada','Activador','Thompson (drop)','Flexión-distracción'])[1 + public._clinica_demo_rnd(v_sem || 'tc2', 4)],
        'postura', (array['Hombros desnivelados','Cabeza adelantada','Pelvis desnivelada','Adecuada'])[1 + public._clinica_demo_rnd(v_sem || 'po', 4)],
        'eva_antes', v_eva, 'eva_despues', v_eva2, 'sesion', v_ses, 'sesiones_plan', v_plan_n,
        'recomendaciones', 'Evitar cargar peso los próximos 2 días. Pausas activas cada hora si trabaja sentado.');
      v_plan := 'Ajustes semanales hasta completar ' || v_plan_n || ' sesiones; luego mantenimiento mensual.';
    else
      v_datos := jsonb_build_object('tipo_masaje', case when c.notas ilike '%relaj%' or c.notas ilike '%estrés%' then 'Relajante' when c.notas ilike '%deport%' then 'Deportivo'
          when c.notas ilike '%piernas%' then 'Drenaje linfático' else 'Descontracturante' end,
        'duracion', '60 minutos', 'zonas', case when c.notas ilike '%piernas%' then 'Piernas y pies' else 'Espalda, cuello y hombros' end,
        'presion', (array['Media','Fuerte','Suave'])[1 + public._clinica_demo_rnd(v_sem || 'pr', 3)], 'productos', 'Aceite de almendras con árnica',
        'contraindicaciones', 'Sí, ninguna', 'eva_antes', v_eva, 'eva_despues', v_eva2,
        'observaciones', 'Puntos de tensión en trapecio. Tolera bien la presión.');
      v_plan := 'Masaje cada semana durante ' || v_plan_n || ' sesiones. Hidratación y estiramientos.';
    end if;
  elsif v_esp = 'odontologia' then$q$);
  if position($q$diagnosticos, agenda_cita_id)$q$ in def) = 0 then raise exception 'comp 4'; end if;
  def := replace(def, $q$diagnosticos, agenda_cita_id)$q$, $q$diagnosticos, agenda_cita_id, datos)$q$);
  if position($q$v_dx, c.id)$q$ in def) = 0 then raise exception 'comp 5'; end if;
  def := replace(def, $q$v_dx, c.id)$q$, $q$v_dx, c.id, v_datos)$q$);
  if position($q$'Paciente consciente, orientado, hidratado. Sin otros hallazgos de importancia.'$q$ in def) = 0 then raise exception 'comp 6'; end if;
  def := replace(def, $q$'Paciente consciente, orientado, hidratado. Sin otros hallazgos de importancia.'$q$,
    $q$case when v_terapia then 'Dolor a la palpación en ' || lower(coalesce(v_zona, 'la zona')) || '. Sin signos de alarma neurológica.' else 'Paciente consciente, orientado, hidratado. Sin otros hallazgos de importancia.' end$q$);
  if position($q$'Tomar el medicamento con alimentos. Volver a consulta si hay fiebre persistente o empeora.'$q$ in def) = 0 then raise exception 'comp 7'; end if;
  def := replace(def, $q$'Tomar el medicamento con alimentos. Volver a consulta si hay fiebre persistente o empeora.'$q$,
    $q$case when v_terapia then coalesce(v_datos->>'ejercicios', v_datos->>'recomendaciones', 'Hidratarse y descansar. Calor local 15 minutos si hay molestia.') else 'Tomar el medicamento con alimentos. Volver a consulta si hay fiebre persistente o empeora.' end$q$);
  if position($q$v_cant := (array[10, 6, 1, 2, 20])[1 + public._clinica_demo_rnd(v_sem || 'q', 5)];$q$ in def) = 0 then raise exception 'comp 8'; end if;
  def := replace(def, $q$v_cant := (array[10, 6, 1, 2, 20])[1 + public._clinica_demo_rnd(v_sem || 'q', 5)];$q$,
    $q$v_cant := case when v_terapia then 1 else (array[10, 6, 1, 2, 20])[1 + public._clinica_demo_rnd(v_sem || 'q', 5)] end;$q$);
  execute def;
end $do$;
revoke all on function public._clinica_demo_dia(uuid, date, text) from public, anon, authenticated;
revoke all on function public._clinica_demo_completar(uuid, uuid, boolean) from public, anon, authenticated;

-- 2) La cuenta de demostración "Centro de Fisioterapia y Rehabilitación Movimiento"
create or replace function public._clinica_demo_crear_fisio() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-fisioterapia@negocio360oficial.com';
  k_america uuid; k_club uuid; cli_k uuid; kons uuid[]; pr uuid; emp uuid; v_hoy date := (now() at time zone 'America/Managua')::date; d date; n int := 0;
  r record; v_pac uuid; v_cli uuid; i int := 0; v_rec uuid; v_venta uuid; v_citas uuid[]; v_monto numeric; v_lineas jsonb;
  nom_f text[] := array['María José','Karla','Gabriela','Ana Lucía','Valeria','Sofía','Jessica','Carmen','Ileana','Andrea','Daniela','Mariela','Rosa','Patricia','Fátima','Ximena','Lorena','Yahoska'];
  nom_m text[] := array['José Luis','Kevin','Marvin','Jorge','Carlos','Luis Alberto','Andrés','Diego','Josué','Roberto','Francisco','Mario','Ernesto','Byron','Danilo','Erick','Julio','Óscar'];
  ape text[] := array['García','Rodríguez','López','Martínez','Hernández','Pérez','Gómez','Rocha','Espinoza','Obando','Silva','Mendoza','Lacayo','Zeledón','Úbeda','Sandino','Chavarría','Rivas','Torres','Castillo','Matus','Téllez'];
  ocup text[] := array['Docente','Oficinista','Comerciante','Conductor','Enfermera','Futbolista','Albañil','Ama de casa','Ingeniero','Estudiante','Jubilado','Mecánico','Cajera','Corredor (atletismo)'];
  v_nombres text; v_apellidos text; v_sexo text; v_edad int; v_conv text;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de fisioterapia ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoFisio#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Fisioterapia', 'email_verified', true, 'nombre_negocio', 'Centro de Fisioterapia y Rehabilitación Movimiento', 'phone_verified', false),
    now() - interval '35 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Fisioterapia Movimiento', 'demo_publica', 'fisioterapia', 'Demo pública de Clínica para fisioterapia, quiropraxia y masajes, con simulación que se renueva sola cada día (clinica_demo_preparar). Sin multiusuario.', 19);
  update public.usuarios set nombre = 'Demo', apellido = 'Fisioterapia', nombre_negocio = 'Centro de Fisioterapia y Rehabilitación Movimiento', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, usa_modulo_clinica, clinica_especialidades, direccion, telefono)
  values (u, 'Centro de Fisioterapia y Rehabilitación Movimiento', 'fisioterapia', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false},"clinica_demo_simulacion":"true"}'::jsonb,
    false, true, true, array['fisioterapia','quiropraxia','masoterapia'], 'Del Hospital Militar 3 c. al lago, Managua', '2266-7700')
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, usa_modulo_clinica = true,
    clinica_especialidades = excluded.clinica_especialidades, direccion = excluded.direccion, telefono = excluded.telefono;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- Cubículos y salas (en Clínica se llaman "consultorios")
  insert into public.clinica_consultorios(auth_user_id, nombre, descripcion) values (u, 'Cubículo 1', 'Camilla y equipo de electroterapia'), (u, 'Cubículo 2', 'Camilla y ultrasonido'),
    (u, 'Gimnasio de rehabilitación', 'Barras, bandas, pesas y bicicleta'), (u, 'Sala de masajes', 'Ambiente relajante'), (u, 'Sala de quiropraxia', 'Mesa quiropráctica');
  select array_agg(id order by nombre) into kons from public.clinica_consultorios where auth_user_id = u;   -- Cubículo 1, Cubículo 2, Gimnasio, Masajes, Quiropraxia

  -- Terapeutas (sin multiusuario: en la demo se elige el terapeuta y no se pide código), su columna en la Agenda y comisión
  for r in select * from (values
      ('Lic. Carla Ramírez', 'Fisioterapia', 'FT-1182', 1, '#0ea5e9', 'porcentaje', 35::numeric),
      ('Lic. José Martínez', 'Fisioterapia', 'FT-2047', 3, '#10b981', 'porcentaje', 35::numeric),
      ('Dr. Andrés Solís', 'Quiropraxia', 'QP-0311', 5, '#f59e0b', 'monto', 200::numeric),
      ('Lic. María Fernanda López', 'Masoterapia', 'MS-0590', 4, '#ec4899', 'porcentaje', 40::numeric)) as m(nombre, esp, reg, kon, color, ht, hv) loop
    insert into public.empleados(auth_user_id, nombre, cargo, salario) values (u, r.nombre, 'Terapeuta (' || r.esp || ')', 0) returning id into emp;
    insert into public.agenda_profesionales(auth_user_id, nombre, color, orden, activo, empleado_id) values (u, r.nombre, r.color, i, true, emp) returning id into pr;
    insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, consultorio_id, agenda_profesional_id, honorario_tipo, honorario_valor, empleado_id)
    values (u, r.nombre, 'medico', true, r.esp, r.reg, kons[r.kon], pr, r.ht, r.hv, emp);
    i := i + 1;
  end loop;

  -- Servicios (los sugeridos de cada especialidad) y productos que se venden o se usan
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values
    (u, 'Evaluación inicial de fisioterapia', 'servicio', 600, 0, true), (u, 'Sesión de fisioterapia', 'servicio', 500, 0, true),
    (u, 'Sesión con electroterapia y ultrasonido', 'servicio', 650, 0, true), (u, 'Rehabilitación postoperatoria', 'servicio', 700, 0, true),
    (u, 'Fisioterapia deportiva', 'servicio', 650, 0, true), (u, 'Vendaje neuromuscular (kinesiotape)', 'servicio', 250, 0, true), (u, 'Sesión a domicilio', 'servicio', 900, 0, true),
    (u, 'Evaluación quiropráctica', 'servicio', 800, 0, true), (u, 'Ajuste quiropráctico', 'servicio', 700, 0, true), (u, 'Ajuste con terapia de tejido blando', 'servicio', 900, 0, true),
    (u, 'Masaje terapéutico 60 min', 'servicio', 900, 0, true), (u, 'Masaje descontracturante 60 min', 'servicio', 900, 0, true), (u, 'Masaje relajante 60 min', 'servicio', 800, 0, true),
    (u, 'Masaje relajante 90 min', 'servicio', 1100, 0, true), (u, 'Masaje deportivo', 'servicio', 950, 0, true), (u, 'Drenaje linfático', 'servicio', 950, 0, true),
    (u, 'Cobertura de seguro médico', 'servicio', 0, 0, true);
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, stock_actual, activo) values
    (u, 'Cinta kinesiológica (rollo)', 'producto', 450, 250, 40, true), (u, 'Gel conductor 250 ml', 'producto', 180, 90, 60, true),
    (u, 'Compresa fría/caliente reutilizable', 'producto', 220, 110, 35, true), (u, 'Banda elástica de resistencia', 'producto', 300, 140, 45, true),
    (u, 'Crema antiinflamatoria con árnica', 'producto', 280, 130, 50, true), (u, 'Rodillera ortopédica', 'producto', 650, 350, 25, true),
    (u, 'Faja lumbar', 'producto', 900, 500, 22, true), (u, 'Pelota de ejercicio 65 cm', 'producto', 450, 250, 21, true);

  -- Seguro y convenio con un club deportivo (su cliente, para facturarles por Ventas)
  insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, 'Seguros América', '2255-1000', true) returning id into cli_k;
  insert into public.clinica_convenios(auth_user_id, nombre, tipo, cobertura_pct, cliente_id, telefono, notas) values (u, 'Seguros América', 'aseguradora', 70, cli_k, '2255-1000', 'Cubre fisioterapia con orden médica.') returning id into k_america;
  insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, 'Club Deportivo Los Leones', '2278-3300', true) returning id into cli_k;
  insert into public.clinica_convenios(auth_user_id, nombre, tipo, cobertura_pct, cliente_id, telefono, notas) values (u, 'Club Deportivo Los Leones', 'empresa', 50, cli_k, '2278-3300', 'Paga la mitad de la rehabilitación de sus jugadores.') returning id into k_club;

  -- 36 pacientes adultos (también clientes, para cobrarles); 1 de cada 4 con seguro o convenio
  for i in 0 .. 35 loop
    v_sexo := case when i % 2 = 0 then 'femenino' else 'masculino' end;
    v_nombres := case when v_sexo = 'femenino' then nom_f[1 + (i * 7) % array_length(nom_f, 1)] else nom_m[1 + (i * 5) % array_length(nom_m, 1)] end;
    v_apellidos := ape[1 + (i * 3) % array_length(ape, 1)] || ' ' || ape[1 + (i * 11 + 4) % array_length(ape, 1)];
    v_edad := 18 + (i * 13) % 58;
    v_conv := case when i % 8 = 1 then 'america' when i % 8 = 5 then 'club' end;
    insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, v_nombres || ' ' || v_apellidos, '8' || lpad(((i * 7919 + 1234567) % 10000000)::text, 7, '0'), true) returning id into v_cli;
    insert into public.clinica_pacientes(auth_user_id, nombres, apellidos, cedula, fecha_nacimiento, sexo, telefono, ocupacion, cliente_id, convenio_id, poliza, poliza_vence,
      contacto_emergencia_nombre, contacto_emergencia_telefono, contacto_emergencia_parentesco)
    values (u, v_nombres, v_apellidos, '001-' || lpad((10101 + i * 2731 % 280000)::text, 6, '0') || '-' || lpad((1000 + i * 37)::text, 4, '0') || chr(65 + i % 26),
      make_date(extract(year from v_hoy)::int - v_edad, 1 + (i * 5) % 12, 1 + (i * 7) % 27), v_sexo,
      substr('8' || lpad(((i * 7919 + 1234567) % 10000000)::text, 7, '0'), 1, 4) || '-' || substr('8' || lpad(((i * 7919 + 1234567) % 10000000)::text, 7, '0'), 5, 4),
      ocup[1 + i % array_length(ocup, 1)], v_cli,
      case v_conv when 'america' then k_america when 'club' then k_club end,
      case when v_conv is not null then upper(left(v_conv, 4)) || '-' || (200000 + i * 6131) end,
      case when v_conv is not null then (v_hoy + interval '1 year')::date end,
      case when i % 3 = 0 then 'Familiar de ' || v_nombres end, case when i % 3 = 0 then '8' || lpad(((i * 1013 + 7654321) % 10000000)::text, 7, '0') end, case when i % 3 = 0 then 'familiar' end)
    returning id into v_pac;
    update public.clientes set telefono = (select telefono from public.clinica_pacientes where id = v_pac) where id = v_cli;
    if i % 2 = 0 or v_edad > 55 then
      insert into public.clinica_antecedentes(paciente_id, auth_user_id, tipo_sangre, alergias, sin_alergias, personales, familiares, habitos, actualizado_por_nombre)
      values (v_pac, u, (array['O+','A+','B+','O+','AB+','O-'])[1 + i % 6],
        case when i % 6 = 0 then 'Diclofenaco' when i % 10 = 4 then 'Látex' end, not (i % 6 = 0 or i % 10 = 4),
        case when v_edad > 55 then 'Hipertensión arterial. Artrosis de rodilla.' when i % 5 = 0 then 'Cirugía de rodilla (ligamento cruzado) hace 4 meses.' else 'Sin antecedentes de importancia.' end,
        case when i % 3 = 0 then 'Madre con artritis.' end, case when i % 4 = 1 then 'Hace deporte 3 veces por semana.' else 'Trabajo sentado muchas horas.' end, 'Lic. Carla Ramírez');
    end if;
  end loop;

  -- Un mes de sesiones (atendidas, firmadas y cobradas con su venta), hoy y los próximos días
  d := v_hoy - 30;
  while d < v_hoy loop n := n + public._clinica_demo_dia(u, d, 'pasado'); d := d + 1; end loop;
  n := n + public._clinica_demo_dia(u, v_hoy, 'hoy');
  for i in 1 .. 3 loop n := n + public._clinica_demo_dia(u, v_hoy + i, 'futuro'); end loop;

  -- Factura a Seguros América por las sesiones de hace más de 12 días (ya pagada por transferencia)
  select array_agg(i2.agenda_cita_id), sum(i2.monto_cubierto),
         jsonb_agg(jsonb_build_object('cita_id', i2.agenda_cita_id, 'tipo', 'cita', 'fecha', a.fecha, 'paciente', trim(p.nombres || ' ' || coalesce(p.apellidos, '')), 'monto', i2.monto_cubierto, 'pct', i2.cobertura_pct))
    into v_citas, v_monto, v_lineas
    from public.clinica_cita_info i2 join public.agenda_citas a on a.id = i2.agenda_cita_id join public.clinica_pacientes p on p.id = i2.paciente_id
   where i2.auth_user_id = u and i2.convenio_id = k_america and i2.monto_cubierto > 0 and a.venta_id is not null and a.fecha < v_hoy - 12;
  if v_monto > 0 then
    insert into public.clinica_reclamos(auth_user_id, convenio_id, estado, citas, monto, detalle) values (u, k_america, 'enviado', v_citas, round(v_monto, 2), jsonb_build_object('lineas', v_lineas))
      returning id into v_rec;
    v_venta := public._clinica_demo_vender(u, v_hoy - 5, (select cliente_id from public.clinica_convenios where id = k_america),
      jsonb_build_array(jsonb_build_object('producto_id', (select id from public.productos where auth_user_id = u and nombre = 'Cobertura de seguro médico'), 'cantidad', 1, 'precio', round(v_monto, 2))),
      'Transferencia', 'Cobertura Seguros América · ' || cardinality(v_citas) || ' sesiones');
    update public.clinica_reclamos set venta_id = v_venta, estado = 'facturado' where id = v_rec;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Demo de fisioterapia creada: % (% citas)', u, n;
  return u;
end $f$;
revoke all on function public._clinica_demo_crear_fisio() from public, anon, authenticated;
