-- ============================================================
-- Cuenta de DEMOSTRACIÓN "Clínica" (mismo criterio que las demos por rubro de 20261013):
-- auth.users + auth.identities (el trigger on_auth_user_created crea usuarios y
-- metodos_pago), registrada en public.cuentas_prueba (tipo 'demo_publica') para que
-- aparezca en "Pruebas" y no como cliente. Datos de ejemplo, sin datos reales:
-- médicos (usuarios del multiusuario con código 1234), columnas en la Agenda, servicios
-- y medicamentos, pacientes, antecedentes, un seguro, citas y notas firmadas de ejemplo.
-- NO se cargan ventas ni movimientos de caja (nada contable).
-- Correo: demo-clinica@negocio360oficial.com · contraseña en el selector de login.html.
-- ============================================================
do $demo$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-clinica@negocio360oficial.com';
  pf_ruiz uuid := gen_random_uuid(); pf_mendez uuid := gen_random_uuid(); pf_odo uuid := gen_random_uuid();
  pr_ruiz uuid; pr_mendez uuid; pr_odo uuid; emp_ruiz uuid; m_ruiz uuid; m_mendez uuid; m_odo uuid; k1 uuid; kons1 uuid; kons2 uuid;
  s_cons uuid; s_ped uuid; s_pren uuid; s_dent uuid; s_dia uuid; s_obs uuid; s_cob uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; a uuid; n1 uuid; n2 uuid;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Clínica ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoClinica#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Clínica', 'email_verified', true, 'nombre_negocio', 'Clínica Santa Fe', 'phone_verified', false),
    now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Clínica Santa Fe', 'demo_publica', 'clinica', 'Demo pública por rubro (selector del login). Código de los médicos: 1234.', 17);
  update public.usuarios set nombre = 'Demo', apellido = 'Clínica', nombre_negocio = 'Clínica Santa Fe', plan = 'premium', estado_cuenta = 'activa', onboarding_completado = true, multiusuario_activo = false
   where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, usa_modulo_clinica, clinica_especialidades, maneja_lotes_vencimiento, fefo_activo)
  values (u, 'Clínica Santa Fe', 'clinica', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb, '{"modulosOpcionales":{"catalogo360":false}}'::jsonb,
    false, true, true, array['medicina_general','pediatria','ginecologia','odontologia'], true, true)
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, usa_modulo_clinica = true, clinica_especialidades = excluded.clinica_especialidades;

  -- Médicos = usuarios del multiusuario (código 1234)
  insert into public.perfiles_acceso(id, auth_user_id, nombre, tipo, codigo_hash, codigo_configurado, activo) values
    (pf_ruiz, u, 'Dra. Ana Ruiz', 'restringido', encode(extensions.digest(convert_to('n360:' || pf_ruiz || ':1234', 'UTF8'), 'sha256'), 'hex'), true, true),
    (pf_mendez, u, 'Dr. Carlos Méndez', 'restringido', encode(extensions.digest(convert_to('n360:' || pf_mendez || ':1234', 'UTF8'), 'sha256'), 'hex'), true, true),
    (pf_odo, u, 'Dra. Lucía Torres', 'restringido', encode(extensions.digest(convert_to('n360:' || pf_odo || ':1234', 'UTF8'), 'sha256'), 'hex'), true, true);
  insert into public.empleados(auth_user_id, nombre, cargo, salario) values (u, 'Dra. Ana Ruiz', 'Médico general', 0) returning id into emp_ruiz;
  insert into public.agenda_profesionales(auth_user_id, nombre, color, orden, activo, empleado_id) values (u, 'Dra. Ana Ruiz', '#3b82f6', 0, true, emp_ruiz) returning id into pr_ruiz;
  insert into public.agenda_profesionales(auth_user_id, nombre, color, orden, activo) values (u, 'Dr. Carlos Méndez', '#10b981', 1, true) returning id into pr_mendez;
  insert into public.agenda_profesionales(auth_user_id, nombre, color, orden, activo) values (u, 'Dra. Lucía Torres', '#a855f7', 2, true) returning id into pr_odo;
  insert into public.clinica_consultorios(auth_user_id, nombre, descripcion) values (u, 'Consultorio 1', 'Planta baja') returning id into kons1;
  insert into public.clinica_consultorios(auth_user_id, nombre, descripcion) values (u, 'Consultorio dental', 'Planta alta') returning id into kons2;
  insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, consultorio_id, perfil_id, agenda_profesional_id, honorario_tipo, honorario_valor, empleado_id)
    values (u, 'Dra. Ana Ruiz', 'medico', true, 'Medicina general', 'MINSA-10234', kons1, pf_ruiz, pr_ruiz, 'porcentaje', 30, emp_ruiz) returning id into m_ruiz;
  insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, consultorio_id, perfil_id, agenda_profesional_id)
    values (u, 'Dr. Carlos Méndez', 'medico', true, 'Pediatría', 'MINSA-20871', kons1, pf_mendez, pr_mendez) returning id into m_mendez;
  insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, consultorio_id, perfil_id, agenda_profesional_id)
    values (u, 'Dra. Lucía Torres', 'medico', true, 'Odontología', 'MINSA-33410', kons2, pf_odo, pr_odo) returning id into m_odo;

  -- Servicios y medicamentos
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values (u, 'Consulta general', 'servicio', 600, 0, true) returning id into s_cons;
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values (u, 'Consulta pediátrica', 'servicio', 700, 0, true) returning id into s_ped;
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values (u, 'Control prenatal', 'servicio', 800, 0, true) returning id into s_pren;
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values (u, 'Limpieza dental', 'servicio', 900, 0, true) returning id into s_dent;
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values (u, 'Día de hospitalización', 'servicio', 2500, 0, true) returning id into s_dia;
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values (u, 'Observación (hasta 8 horas)', 'servicio', 1200, 0, true) returning id into s_obs;
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values (u, 'Cobertura de seguro médico', 'servicio', 0, 0, true) returning id into s_cob;
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, stock_actual, activo) values
    (u, 'Acetaminofén 500 mg (tableta)', 'producto', 5, 1.5, 500, true), (u, 'Amoxicilina 500 mg (cápsula)', 'producto', 12, 4, 300, true),
    (u, 'Ibuprofeno 400 mg (tableta)', 'producto', 6, 2, 400, true), (u, 'Sales de rehidratación oral', 'producto', 25, 10, 120, true),
    (u, 'Suero fisiológico 1 L', 'producto', 120, 55, 60, true), (u, 'Jeringa 5 ml', 'producto', 10, 3, 200, true);

  -- Seguro
  insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, 'Seguros América', '2255-1000', true) returning id into c6;
  insert into public.clinica_convenios(auth_user_id, nombre, tipo, cobertura_pct, cliente_id, telefono, notas) values (u, 'Seguros América', 'aseguradora', 80, c6, '2255-1000', 'Requiere carné vigente.') returning id into k1;

  -- Pacientes (también clientes, para cobrarles)
  insert into public.clientes(auth_user_id, nombre, apellido, telefono, activo) values (u, 'María José', 'López', '8888-1001', true) returning id into c1;
  insert into public.clientes(auth_user_id, nombre, apellido, telefono, activo) values (u, 'Juan Carlos', 'Pérez', '8888-1002', true) returning id into c2;
  insert into public.clientes(auth_user_id, nombre, apellido, telefono, activo) values (u, 'Sofía', 'Martínez', '8888-1003', true) returning id into c3;
  insert into public.clientes(auth_user_id, nombre, apellido, telefono, activo) values (u, 'Andrés', 'Gómez', '8888-1004', true) returning id into c4;
  insert into public.clientes(auth_user_id, nombre, apellido, telefono, activo) values (u, 'Carmen', 'Rivas', '8888-1005', true) returning id into c5;
  insert into public.clinica_pacientes(auth_user_id, nombres, apellidos, cedula, fecha_nacimiento, sexo, telefono, ocupacion, cliente_id, convenio_id, poliza, poliza_vence)
    values (u, 'María José', 'López', '001-150390-0001A', '1990-03-15', 'femenino', '8888-1001', 'Contadora', c1, k1, 'SA-445566', '2027-12-31') returning id into p1;
  insert into public.clinica_pacientes(auth_user_id, nombres, apellidos, cedula, fecha_nacimiento, sexo, telefono, ocupacion, cliente_id)
    values (u, 'Juan Carlos', 'Pérez', '001-220875-0002B', '1975-08-22', 'masculino', '8888-1002', 'Comerciante', c2) returning id into p2;
  insert into public.clinica_pacientes(auth_user_id, nombres, apellidos, fecha_nacimiento, sexo, telefono, cliente_id, contacto_emergencia_nombre, contacto_emergencia_telefono, contacto_emergencia_parentesco)
    values (u, 'Sofía', 'Martínez', '2023-05-10', 'femenino', '8888-1003', c3, 'Laura Martínez', '8888-1013', 'madre') returning id into p3;
  insert into public.clinica_pacientes(auth_user_id, nombres, apellidos, fecha_nacimiento, sexo, telefono, cliente_id)
    values (u, 'Andrés', 'Gómez', '1988-11-02', 'masculino', '8888-1004', c4) returning id into p4;
  insert into public.clinica_pacientes(auth_user_id, nombres, apellidos, fecha_nacimiento, sexo, telefono, cliente_id)
    values (u, 'Carmen', 'Rivas', '1996-01-28', 'femenino', '8888-1005', c5) returning id into p5;
  insert into public.clinica_antecedentes(paciente_id, auth_user_id, tipo_sangre, alergias, personales, habitos, actualizado_por_nombre)
    values (p1, u, 'O+', 'Penicilina', 'Migraña desde los 20 años', 'No fuma', 'Dra. Ana Ruiz'),
           (p2, u, 'A+', null, 'Hipertensión arterial (2018), diabetes tipo 2 (2020)', 'Exfumador', 'Dra. Ana Ruiz');
  update public.clinica_antecedentes set sin_alergias = true where paciente_id = p2;

  -- Notas firmadas de ejemplo
  insert into public.clinica_consultas(auth_user_id, paciente_id, medico_id, medico_nombre, fecha, especialidad, motivo, enfermedad_actual, pa_sistolica, pa_diastolica, fc, temperatura, peso_kg, talla_cm,
    examen_fisico, diagnostico, plan, indicaciones, diagnosticos)
  values (u, p2, m_ruiz, 'Dra. Ana Ruiz', now() - interval '20 days', 'medicina_general', 'Control de presión y azúcar', 'Refiere cefalea ocasional. Toma su tratamiento.', 145, 92, 78, 36.8, 84, 172,
    'Sin hallazgos de importancia.', 'I10 Hipertensión esencial; E11 Diabetes tipo 2', 'Ajustar dosis de losartán. Dieta baja en sal.', 'Control en 1 mes con glucosa en ayunas.',
    '[{"codigo":"I10","nombre":"Hipertensión esencial (primaria)","principal":true},{"codigo":"E11","nombre":"Diabetes mellitus tipo 2","principal":false}]'::jsonb)
  returning id into n1;
  insert into public.clinica_consultas(auth_user_id, paciente_id, medico_id, medico_nombre, fecha, especialidad, motivo, diagnostico, plan, datos)
  values (u, p4, m_odo, 'Dra. Lucía Torres', now() - interval '10 days', 'odontologia', 'Dolor en muela superior derecha', 'Caries en 16; 36 ausente', 'Resina en 16 la próxima cita',
    '{"denticion":"Permanente","higiene":"Regular","odontograma":{"16":{"e":"caries","s":["O","M"]},"26":{"e":"obturado","s":["O"]},"36":{"e":"ausente"},"46":{"e":"endodoncia"}}}'::jsonb)
  returning id into n2;
  -- Se firman como en la vida real (las notas nacen en borrador)
  update public.clinica_consultas set estado = 'cerrada', cerrada_en = fecha, firma_hash = encode(extensions.digest(convert_to(id::text || '|' || medico_id::text || '|' || fecha::text, 'UTF8'), 'sha256'), 'hex')
   where id in (n1, n2);

  -- Citas de hoy y de mañana en la Agenda
  insert into public.agenda_citas(auth_user_id, fecha, cliente_id, cliente_nombre, cliente_telefono, estado, notas, creado_por) values (u, current_date, c1, 'María José López', '8888-1001', 'confirmada', 'Dolor de cabeza intenso', 'Recepción') returning id into a;
  insert into public.agenda_citas_servicios(auth_user_id, cita_id, profesional_id, producto_id, servicio_nombre, precio, hora_inicio, duracion_min, orden) values (u, a, pr_ruiz, s_cons, 'Consulta general', 600, '08:30', 30, 0);
  insert into public.clinica_cita_info(agenda_cita_id, auth_user_id, paciente_id, consultorio_id, llegada_en) values (a, u, p1, kons1, now() - interval '15 minutes');
  insert into public.agenda_citas(auth_user_id, fecha, cliente_id, cliente_nombre, cliente_telefono, estado, notas, creado_por) values (u, current_date, c3, 'Sofía Martínez', '8888-1003', 'reservada', 'Fiebre desde ayer', 'Recepción') returning id into a;
  insert into public.agenda_citas_servicios(auth_user_id, cita_id, profesional_id, producto_id, servicio_nombre, precio, hora_inicio, duracion_min, orden) values (u, a, pr_mendez, s_ped, 'Consulta pediátrica', 700, '09:30', 30, 0);
  insert into public.agenda_citas(auth_user_id, fecha, cliente_id, cliente_nombre, cliente_telefono, estado, notas, creado_por) values (u, current_date, c5, 'Carmen Rivas', '8888-1005', 'confirmada', 'Control prenatal', 'Recepción') returning id into a;
  insert into public.agenda_citas_servicios(auth_user_id, cita_id, profesional_id, producto_id, servicio_nombre, precio, hora_inicio, duracion_min, orden) values (u, a, pr_ruiz, s_pren, 'Control prenatal', 800, '10:30', 30, 0);
  insert into public.agenda_citas(auth_user_id, fecha, cliente_id, cliente_nombre, cliente_telefono, estado, notas, creado_por) values (u, current_date + 1, c4, 'Andrés Gómez', '8888-1004', 'confirmada', 'Resina en 16', 'Recepción') returning id into a;
  insert into public.agenda_citas_servicios(auth_user_id, cita_id, profesional_id, producto_id, servicio_nombre, precio, hora_inicio, duracion_min, orden) values (u, a, pr_odo, s_dent, 'Limpieza dental', 900, '14:00', 45, 0);
  insert into public.agenda_citas(auth_user_id, fecha, cliente_id, cliente_nombre, cliente_telefono, estado, creado_por) values (u, current_date + 1, c2, 'Juan Carlos Pérez', '8888-1002', 'reservada', 'Recepción') returning id into a;
  insert into public.agenda_citas_servicios(auth_user_id, cita_id, profesional_id, producto_id, servicio_nombre, precio, hora_inicio, duracion_min, orden) values (u, a, pr_ruiz, s_cons, 'Consulta general', 600, '08:00', 30, 0);

  -- Un paciente en observación
  insert into public.clinica_estancias(auth_user_id, paciente_id, tipo, cama, medico_id, servicio_id, ingreso_en) values (u, p2, 'observacion', 'Cama 1', m_ruiz, s_obs, now() - interval '2 hours');

  raise notice 'Demo Clínica creada: %', u;
end $demo$;
