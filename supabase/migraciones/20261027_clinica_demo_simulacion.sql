-- =====================================================================
-- MÓDULO CLÍNICA — Nueva cuenta DEMO con datos de simulación (pedido de Jack, 27-oct-2026)
-- ---------------------------------------------------------------------
-- "Centro Médico San Rafael" (demo-clinica-sanrafael@negocio360oficial.com): 5 médicos, enfermería,
-- 4 consultorios, servicios y medicamentos, 3 aseguradoras/convenios, 45 pacientes, un mes de visitas
-- atendidas y cobradas, hoy (en espera, en consulta, por llegar, un urgente sin cita), los próximos días,
-- internados y una factura a la aseguradora.
-- Las ventas se registran con la MISMA función que Ventas (venta_registrar_atomica) y el mismo formato
-- que manda ventas.js (sin IVA en esta demo), así Caja, inventario, clientes y reportes cuadran.
-- La demo se mantiene viva: clinica_demo_preparar() (solo cuentas demo con "clinica_demo_simulacion")
-- arma el día cuando alguien la abre. Las funciones internas exigen que la cuenta sea demo.
-- Solo agrega: funciones nuevas con prefijo clinica_ / _clinica_ y datos de UNA cuenta nueva.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) Venta de la demo: el MISMO formato que manda Ventas (ventas.js → venta_registrar_atomica):
--    misma función del servidor, así Caja, inventario, clientes y reportes cuadran. Solo demo.
-- ---------------------------------------------------------------------
create or replace function public._clinica_demo_vender(p_uid uuid, p_fecha date, p_cliente uuid, p_items jsonb, p_metodo text, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $f$
declare v_num text; v_det jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb; v_sub numeric := 0; v_costo numeric := 0; it jsonb; p record;
  v_mp record; v_cli record; r jsonb; v_cant numeric; v_precio numeric;
begin
  if auth.uid() is null or auth.uid() <> p_uid or not public._es_cuenta_demo(p_uid) then raise exception 'clinica_demo_solo_demo'; end if;
  select id, nombre into v_cli from public.clientes where id = p_cliente and auth_user_id = p_uid;
  select id, nombre into v_mp from public.metodos_pago where auth_user_id = p_uid and nombre = p_metodo and activo order by orden limit 1;
  if v_mp.id is null then select id, nombre into v_mp from public.metodos_pago where auth_user_id = p_uid and activo order by orden limit 1; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select id, nombre, tipo, coalesce(costo, 0) as costo into p from public.productos where id = (it->>'producto_id')::uuid and auth_user_id = p_uid;
    if p.id is null then continue; end if;
    v_cant := (it->>'cantidad')::numeric; v_precio := round((it->>'precio')::numeric, 2);
    if v_cant is null or v_cant <= 0 or v_precio <= 0 then continue; end if;
    v_det := v_det || jsonb_build_array(jsonb_build_object('auth_user_id', p_uid, 'venta_id', null, 'producto_id', p.id, 'combo_id', null, 'promocion_id', null,
      'producto_nombre', p.nombre, 'producto_sku', null, 'tipo_item', p.tipo, 'cantidad', v_cant, 'precio', v_precio, 'costo', p.costo, 'descuento', 0,
      'subtotal', round(v_cant * v_precio, 2), 'ganancia', round(v_cant * v_precio - v_cant * p.costo, 2), 'escala_id', null, 'escala_nombre', null,
      'vendido_sin_stock', false, 'es_regalia', false, 'presentacion_id', null, 'presentacion_nombre', null, 'presentacion_factor', null, 'lote_id', null,
      'cantidad_pedida', null, 'unidad_pedida', null));
    if p.tipo = 'producto' then v_stock := v_stock || jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant)); end if;
    v_sub := v_sub + round(v_cant * v_precio, 2); v_costo := v_costo + v_cant * p.costo;
  end loop;
  if jsonb_array_length(v_det) = 0 or v_sub <= 0 then return null; end if;
  v_num := public.generar_numero_venta(p_uid);
  r := public.venta_registrar_atomica(
    jsonb_build_object('auth_user_id', p_uid, 'numero_venta', v_num, 'cliente_id', v_cli.id, 'cliente_nombre', v_cli.nombre, 'fecha', p_fecha,
      'subtotal', round(v_sub, 2), 'descuento', 0, 'impuesto', 0, 'total', round(v_sub, 2), 'costo_total', round(v_costo, 2),
      'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre, 'creado_por_nombre', 'Recepción', 'estado', 'completada',
      'observaciones', p_obs, 'iva_activo', false, 'iva_porcentaje', 0),
    v_det, v_stock,
    jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num, 'monto', round(v_sub, 2), 'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre,
      'banco_id', null, 'monto_moneda_banco', null, 'observaciones', null, 'fecha', p_fecha)),
    case when v_cli.id is not null then round(v_sub, 2) end, null);
  return (r->>'venta_id')::uuid;
end $f$;

-- Número "al azar" pero siempre igual para el mismo día y la misma semilla (la demo es reproducible).
create or replace function public._clinica_demo_rnd(p_txt text, p_n int) returns int
language sql immutable set search_path = public as $f$ select (abs(hashtext(p_txt)) % greatest(p_n, 1))::int $f$;

-- ---------------------------------------------------------------------
-- B) Terminar una visita de la demo como en la vida real: el médico firma la nota y se cobra
--    (con el seguro del paciente si tiene uno vigente, igual que la Sala de espera).
-- ---------------------------------------------------------------------
create or replace function public._clinica_demo_completar(p_uid uuid, p_cita uuid, p_cobrar boolean default true)
returns uuid language plpgsql security definer set search_path = public, extensions as $f$
declare c record; l record; v_med record; v_pac record; v_k_id uuid; v_k_pct numeric; v_info record; v_esp text; v_dx jsonb; v_mot text; v_plan text; v_sem text;
  v_items jsonb := '[]'::jsonb; v_items_pac jsonb := '[]'::jsonb; v_cub numeric := 0; v_cub_serv numeric := 0; v_pct numeric; it jsonb; v_tot numeric; v_pag numeric;
  v_cant numeric; v_med_prod record; v_venta uuid; v_nota uuid; v_hora time; v_ts timestamptz; v_metodo text; v_r int;
begin
  if not public._es_cuenta_demo(p_uid) then raise exception 'clinica_demo_solo_demo'; end if;
  select * into c from public.agenda_citas where id = p_cita and auth_user_id = p_uid;
  if c.id is null or c.venta_id is not null then return null; end if;
  select * into l from public.agenda_citas_servicios where cita_id = c.id order by hora_inicio, orden limit 1;
  v_hora := coalesce(l.hora_inicio, time '09:00');
  v_ts := ((c.fecha + v_hora) at time zone 'America/Managua');
  select * into v_med from public.clinica_personal where auth_user_id = p_uid and agenda_profesional_id = l.profesional_id limit 1;
  if v_med.id is null then select * into v_med from public.clinica_personal where auth_user_id = p_uid and rol = 'medico' order by created_at limit 1; end if;
  select * into v_info from public.clinica_cita_info where agenda_cita_id = c.id;
  select * into v_pac from public.clinica_pacientes where auth_user_id = p_uid and (id = v_info.paciente_id or (v_info.paciente_id is null and cliente_id = c.cliente_id)) limit 1;
  v_sem := c.id::text;
  v_esp := case v_med.especialidad when 'Pediatría' then 'pediatria' when 'Ginecología' then 'ginecologia' when 'Odontología' then 'odontologia' else 'medicina_general' end;
  v_r := public._clinica_demo_rnd(v_sem || 'dx', 6);
  if v_esp = 'pediatria' then
    v_dx := (array['[{"codigo":"J00","nombre":"Rinofaringitis aguda (resfriado común)","principal":true}]','[{"codigo":"A09","nombre":"Diarrea y gastroenteritis de presunto origen infeccioso","principal":true}]',
      '[{"codigo":"H66.9","nombre":"Otitis media, no especificada","principal":true}]','[{"codigo":"J06.9","nombre":"Infección aguda de las vías respiratorias superiores","principal":true}]',
      '[{"codigo":"L20.9","nombre":"Dermatitis atópica, no especificada","principal":true}]','[{"codigo":"Z00.1","nombre":"Control de salud de rutina del niño","principal":true}]'])[v_r + 1]::jsonb;
    v_plan := 'Hidratación, antipirético si hay fiebre. Control en 7 días o antes si empeora.';
  elsif v_esp = 'ginecologia' then
    v_dx := (array['[{"codigo":"Z34.9","nombre":"Supervisión de embarazo normal, no especificado","principal":true}]','[{"codigo":"N76.0","nombre":"Vaginitis aguda","principal":true}]',
      '[{"codigo":"N94.6","nombre":"Dismenorrea, no especificada","principal":true}]','[{"codigo":"Z01.4","nombre":"Examen ginecológico (general) (de rutina)","principal":true}]',
      '[{"codigo":"Z34.9","nombre":"Supervisión de embarazo normal, no especificado","principal":true}]','[{"codigo":"N39.0","nombre":"Infección de vías urinarias, sitio no especificado","principal":true}]'])[v_r + 1]::jsonb;
    v_plan := 'Ácido fólico y hierro según indicación. Ultrasonido y exámenes de control.';
  elsif v_esp = 'odontologia' then
    v_dx := (array['[{"codigo":"K02.1","nombre":"Caries de la dentina","principal":true}]','[{"codigo":"K05.1","nombre":"Gingivitis crónica","principal":true}]',
      '[{"codigo":"Z01.2","nombre":"Examen odontológico","principal":true}]','[{"codigo":"K02.1","nombre":"Caries de la dentina","principal":true}]',
      '[{"codigo":"K08.8","nombre":"Otras afecciones especificadas de los dientes","principal":true}]','[{"codigo":"K05.1","nombre":"Gingivitis crónica","principal":true}]'])[v_r + 1]::jsonb;
    v_plan := 'Profilaxis y técnica de cepillado. Próxima cita para tratamiento restaurador.';
  else
    v_dx := (array['[{"codigo":"I10","nombre":"Hipertensión esencial (primaria)","principal":true}]','[{"codigo":"J02.9","nombre":"Faringitis aguda, no especificada","principal":true}]',
      '[{"codigo":"E11.9","nombre":"Diabetes mellitus tipo 2 sin complicaciones","principal":true}]','[{"codigo":"K29.7","nombre":"Gastritis, no especificada","principal":true}]',
      '[{"codigo":"M54.5","nombre":"Lumbago no especificado","principal":true}]','[{"codigo":"R51","nombre":"Cefalea","principal":true}]'])[v_r + 1]::jsonb;
    v_plan := 'Tratamiento indicado, dieta y control. Regresar si persisten los síntomas.';
  end if;
  v_mot := coalesce(nullif(c.notas, ''), v_dx->0->>'nombre');
  -- Llegó, lo llamaron y lo atendieron
  insert into public.clinica_cita_info(agenda_cita_id, auth_user_id, paciente_id, consultorio_id, llegada_en, llamado_en, atendida_en)
  values (c.id, p_uid, v_pac.id, v_med.consultorio_id, v_ts - interval '12 minutes', v_ts + interval '3 minutes', v_ts + interval '28 minutes')
  on conflict (agenda_cita_id) do update set paciente_id = coalesce(clinica_cita_info.paciente_id, excluded.paciente_id),
    llegada_en = coalesce(clinica_cita_info.llegada_en, excluded.llegada_en), llamado_en = coalesce(clinica_cita_info.llamado_en, excluded.llamado_en),
    atendida_en = coalesce(clinica_cita_info.atendida_en, excluded.atendida_en), consultorio_id = coalesce(clinica_cita_info.consultorio_id, excluded.consultorio_id);
  -- La nota del médico (nace en borrador y se firma)
  if v_pac.id is not null and v_med.id is not null and not exists (select 1 from public.clinica_consultas where agenda_cita_id = c.id) then
    insert into public.clinica_consultas(auth_user_id, paciente_id, medico_id, medico_nombre, fecha, especialidad, motivo, enfermedad_actual, pa_sistolica, pa_diastolica, fc, temperatura, spo2,
      peso_kg, talla_cm, examen_fisico, diagnostico, plan, indicaciones, diagnosticos, agenda_cita_id)
    values (p_uid, v_pac.id, v_med.id, v_med.nombre, v_ts + interval '5 minutes', v_esp, left(v_mot, 300), 'Refiere el cuadro desde hace ' || (1 + public._clinica_demo_rnd(v_sem || 'd', 5)) || ' días.',
      case when v_esp = 'pediatria' then null else 110 + public._clinica_demo_rnd(v_sem || 'ps', 40) end, case when v_esp = 'pediatria' then null else 70 + public._clinica_demo_rnd(v_sem || 'pd', 20) end,
      68 + public._clinica_demo_rnd(v_sem || 'fc', 30), 36.4 + public._clinica_demo_rnd(v_sem || 't', 18) / 10.0, 95 + public._clinica_demo_rnd(v_sem || 's', 5),
      case when v_esp = 'pediatria' then 12 + public._clinica_demo_rnd(v_sem || 'pk', 25) else 55 + public._clinica_demo_rnd(v_sem || 'pk', 40) end,
      case when v_esp = 'pediatria' then 85 + public._clinica_demo_rnd(v_sem || 'tc', 55) else 152 + public._clinica_demo_rnd(v_sem || 'tc', 30) end,
      'Paciente consciente, orientado, hidratado. Sin otros hallazgos de importancia.', (v_dx->0->>'codigo') || ' ' || (v_dx->0->>'nombre'), v_plan,
      'Tomar el medicamento con alimentos. Volver a consulta si hay fiebre persistente o empeora.', v_dx, c.id)
    returning id into v_nota;
    update public.clinica_consultas set estado = 'cerrada', cerrada_en = fecha + interval '20 minutes',
      firma_hash = encode(extensions.digest(convert_to(id::text || '|' || medico_id::text || '|' || fecha::text, 'UTF8'), 'sha256'), 'hex')
     where id = v_nota;
  end if;
  if not p_cobrar then
    update public.agenda_citas set estado = 'completada', updated_at = now() where id = c.id;
    return null;
  end if;
  -- La cuenta: los servicios de la cita y, a veces, un medicamento
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', s.producto_id, 'cantidad', 1, 'total', s.precio, 'tipo', 'servicio')), '[]'::jsonb) into v_items
    from public.agenda_citas_servicios s where s.cita_id = c.id and s.producto_id is not null and s.precio > 0;
  if public._clinica_demo_rnd(v_sem || 'med', 100) < 35 then
    select id, precio into v_med_prod from public.productos where auth_user_id = p_uid and tipo = 'producto' and activo and stock_actual > 20
      order by md5(id::text || v_sem) limit 1;
    if v_med_prod.id is not null then
      v_cant := (array[10, 6, 1, 2, 20])[1 + public._clinica_demo_rnd(v_sem || 'q', 5)];
      v_items := v_items || jsonb_build_array(jsonb_build_object('producto_id', v_med_prod.id, 'cantidad', v_cant, 'total', round(v_cant * v_med_prod.precio, 2), 'tipo', 'producto'));
    end if;
  end if;
  -- Seguro vigente del paciente (como en la Sala: el paciente paga su parte; lo demás se factura a la aseguradora)
  if v_pac.convenio_id is not null and (v_pac.poliza_vence is null or v_pac.poliza_vence >= c.fecha) and public._clinica_demo_rnd(v_sem || 'seg', 100) < 80 then
    select id, cobertura_pct into v_k_id, v_k_pct from public.clinica_convenios where id = v_pac.convenio_id and activo;
  end if;
  v_pct := coalesce(v_k_pct, 0);
  for it in select * from jsonb_array_elements(v_items) loop
    v_tot := (it->>'total')::numeric; v_pag := round(v_tot * (100 - v_pct) / 100, 2);
    v_cub := v_cub + (v_tot - v_pag); if it->>'tipo' = 'servicio' then v_cub_serv := v_cub_serv + (v_tot - v_pag); end if;
    v_cant := (it->>'cantidad')::numeric;
    -- Mismo criterio que Ventas al cargar la cita: si el monto no se reparte exacto por unidad, va como una línea.
    if round(v_pag / v_cant * 100) * v_cant = round(v_pag * 100) then
      v_items_pac := v_items_pac || jsonb_build_array(jsonb_build_object('producto_id', it->>'producto_id', 'cantidad', v_cant, 'precio', round(v_pag / v_cant, 2)));
    else
      v_items_pac := v_items_pac || jsonb_build_array(jsonb_build_object('producto_id', it->>'producto_id', 'cantidad', 1, 'precio', v_pag));
    end if;
  end loop;
  if v_k_id is not null then
    update public.clinica_cita_info set convenio_id = v_k_id, cobertura_pct = v_k_pct, monto_cubierto = round(v_cub, 2), cubierto_servicios = round(v_cub_serv, 2) where agenda_cita_id = c.id;
  end if;
  v_metodo := (array['Efectivo','Efectivo','Efectivo','Efectivo','Efectivo','Efectivo','Tarjeta','Tarjeta','Tarjeta','Transferencia'])[1 + public._clinica_demo_rnd(v_sem || 'mp', 10)];
  v_venta := public._clinica_demo_vender(p_uid, c.fecha, c.cliente_id, v_items_pac, v_metodo, null);
  -- Igual que Ventas al confirmar: la cita queda ligada a su venta y completada
  update public.agenda_citas set venta_id = v_venta, estado = 'completada', updated_at = now() where id = c.id;
  return v_venta;
end $f$;

-- ---------------------------------------------------------------------
-- C) Un día de la Clínica de demostración.
--    'pasado': visitas atendidas y cobradas, algunas no asistieron o se cancelaron.
--    'hoy':    según la hora: ya atendidos y cobrados, uno en consulta, en espera (uno urgente sin cita)
--              y los que faltan por llegar.
--    'futuro': citas reservadas y confirmadas (algunas con recordatorio enviado).
-- ---------------------------------------------------------------------
create or replace function public._clinica_demo_dia(p_uid uuid, p_dia date, p_modo text) returns int
language plpgsql security definer set search_path = public, extensions as $f$
declare v_meds uuid[]; v_ninos uuid[]; v_mujeres uuid[]; v_todos uuid[]; n int; i int; v_med record; v_pac record; v_serv record; v_cita uuid;
  v_hora time; v_base time; v_ahora timestamp := (now() at time zone 'America/Managua'); v_estado text; v_lista uuid[]; v_dow int; v_k text; v_mot text;
  v_r int; v_urg boolean; v_ts timestamptz; v_creadas int := 0; v_dur int;
begin
  if not public._es_cuenta_demo(p_uid) then raise exception 'clinica_demo_solo_demo'; end if;
  v_dow := extract(dow from p_dia);
  if v_dow = 0 then return 0; end if;
  select array_agg(id order by nombre) into v_meds from public.clinica_personal where auth_user_id = p_uid and rol = 'medico' and activo and agenda_profesional_id is not null;
  select array_agg(id order by id) into v_ninos from public.clinica_pacientes where auth_user_id = p_uid and activo and fecha_nacimiento > p_dia - interval '14 years';
  select array_agg(id order by id) into v_mujeres from public.clinica_pacientes where auth_user_id = p_uid and activo and sexo = 'femenino' and fecha_nacimiento between p_dia - interval '45 years' and p_dia - interval '17 years';
  select array_agg(id order by id) into v_todos from public.clinica_pacientes where auth_user_id = p_uid and activo and fecha_nacimiento <= p_dia - interval '14 years';
  if v_meds is null or v_todos is null then return 0; end if;
  n := case p_modo when 'hoy' then 12 when 'futuro' then 6 + public._clinica_demo_rnd(p_dia::text || 'n', 3) else case when v_dow = 6 then 3 else 6 + public._clinica_demo_rnd(p_dia::text || 'n', 4) end end;
  if p_modo = 'hoy' then
    v_base := time '00:00' + make_interval(mins => greatest(420, least(870, (extract(hour from v_ahora) * 60 + extract(minute from v_ahora))::int - 150)));
    v_base := make_time(extract(hour from v_base)::int, (extract(minute from v_base)::int / 10) * 10, 0);
  end if;
  for i in 0 .. n - 1 loop
    select * into v_med from public.clinica_personal where id = v_meds[1 + public._clinica_demo_rnd(p_dia::text || ':m:' || i, array_length(v_meds, 1))];
    v_lista := case v_med.especialidad when 'Pediatría' then v_ninos when 'Ginecología' then v_mujeres else v_todos end;
    if v_lista is null then v_lista := v_todos; end if;
    select * into v_pac from public.clinica_pacientes where id = v_lista[1 + public._clinica_demo_rnd(p_dia::text || ':p:' || i, array_length(v_lista, 1))];
    if exists (select 1 from public.agenda_citas a where a.auth_user_id = p_uid and a.fecha = p_dia and a.cliente_id = v_pac.cliente_id) then continue; end if;
    v_r := public._clinica_demo_rnd(p_dia::text || ':s:' || i, 100);
    v_k := case v_med.especialidad
      when 'Pediatría' then case when v_r < 85 then 'Consulta pediátrica' else 'Nebulización' end
      when 'Ginecología' then case when v_r < 55 then 'Control prenatal' else 'Consulta ginecológica' end
      when 'Odontología' then case when v_r < 50 then 'Limpieza dental' when v_r < 85 then 'Resina dental' else 'Extracción dental' end
      else case when v_r < 85 then 'Consulta general' when v_r < 93 then 'Curación' else 'Inyección (aplicación)' end end;
    select id, nombre, precio into v_serv from public.productos where auth_user_id = p_uid and tipo = 'servicio' and nombre = v_k limit 1;
    v_mot := (case v_med.especialidad
      when 'Pediatría' then array['Fiebre desde ayer','Tos y mocos','Diarrea','Dolor de oído','Control de niño sano','Ronchas en la piel']
      when 'Ginecología' then array['Control prenatal','Dolor pélvico','Control anual','Flujo vaginal','Control prenatal','Ardor al orinar']
      when 'Odontología' then array['Dolor de muela','Limpieza','Sangrado de encías','Revisión','Muela picada','Sensibilidad dental']
      else array['Control de presión','Dolor de garganta','Control de azúcar','Dolor de estómago','Dolor de espalda','Dolor de cabeza'] end)[1 + public._clinica_demo_rnd(p_dia::text || ':mo:' || i, 6)];
    v_dur := case when v_k in ('Resina dental','Extracción dental','Limpieza dental') then 45 else 30 end;
    if p_modo = 'hoy' then v_hora := v_base + make_interval(mins => i * 30);
    elsif p_modo = 'futuro' then v_hora := time '08:00' + make_interval(mins => i * 45);
    else v_hora := time '07:30' + make_interval(mins => i * 40); end if;
    -- Estado de la cita
    if p_modo = 'pasado' then
      v_estado := case when v_r < 82 then 'completada' when v_r < 92 then 'no_asistio' else 'cancelada' end;
    elsif p_modo = 'futuro' then v_estado := case when i % 2 = 0 then 'confirmada' else 'reservada' end;
    else
      v_estado := case when i <= 2 then 'completada' when i = 3 then 'en_atencion' when i in (4, 5, 6) then 'espera' else case when i % 2 = 0 then 'confirmada' else 'reservada' end end;
      -- El urgente que llegó sin cita solo aparece en horario de atención.
      v_urg := i = 6 and v_ahora::time between time '07:15' and time '20:00';
      if v_urg then v_mot := 'Dolor abdominal intenso'; v_hora := (v_ahora - interval '8 minutes')::time;
        select * into v_med from public.clinica_personal where id = v_meds[1]; 
        select id, nombre, precio into v_serv from public.productos where auth_user_id = p_uid and tipo = 'servicio' and nombre = 'Consulta general' limit 1;
        if v_med.especialidad <> 'Medicina general' then select * into v_med from public.clinica_personal where auth_user_id = p_uid and rol = 'medico' and especialidad = 'Medicina general' limit 1; end if;
      end if;
      -- Si la demo se abre muy temprano, lo que "ya pasó" todavía no pudo pasar: queda en espera o por llegar.
      if v_estado = 'completada' and (p_dia + v_hora) > v_ahora - interval '40 minutes' then v_estado := 'espera'; end if;
      if v_estado in ('espera', 'en_atencion') and not v_urg and (p_dia + v_hora) > v_ahora + interval '20 minutes' then v_estado := 'confirmada'; end if;
    end if;
    insert into public.agenda_citas(auth_user_id, fecha, cliente_id, cliente_nombre, cliente_telefono, estado, notas, creado_por)
    values (p_uid, p_dia, v_pac.cliente_id, trim(v_pac.nombres || ' ' || coalesce(v_pac.apellidos, '')), v_pac.telefono,
            case when v_estado in ('espera','completada') then 'confirmada' else v_estado end, v_mot, 'Recepción')
    returning id into v_cita;
    insert into public.agenda_citas_servicios(auth_user_id, cita_id, profesional_id, producto_id, servicio_nombre, precio, hora_inicio, duracion_min, orden)
    values (p_uid, v_cita, v_med.agenda_profesional_id, v_serv.id, v_serv.nombre, v_serv.precio, v_hora, v_dur, 0);
    v_creadas := v_creadas + 1;
    v_ts := ((p_dia + v_hora) at time zone 'America/Managua');
    if v_estado = 'completada' then
      perform public._clinica_demo_completar(p_uid, v_cita, true);
    elsif v_estado = 'en_atencion' then
      insert into public.clinica_cita_info(agenda_cita_id, auth_user_id, paciente_id, consultorio_id, llegada_en, llamado_en)
      values (v_cita, p_uid, v_pac.id, v_med.consultorio_id, v_ts - interval '14 minutes', v_ts + interval '2 minutes');
    elsif v_estado = 'espera' then
      insert into public.clinica_cita_info(agenda_cita_id, auth_user_id, paciente_id, consultorio_id, llegada_en, prioridad, sin_cita)
      values (v_cita, p_uid, v_pac.id, v_med.consultorio_id, case when v_urg then now() - interval '6 minutes' else least(now() - interval '5 minutes', v_ts - interval '10 minutes') end,
              case when v_urg then 'urgente' else 'normal' end, coalesce(v_urg, false));
    elsif p_modo = 'futuro' and p_dia = (v_ahora::date + 1) and i % 3 = 0 then
      insert into public.clinica_cita_info(agenda_cita_id, auth_user_id, paciente_id, recordatorio_enviado_en) values (v_cita, p_uid, v_pac.id, now() - interval '2 hours');
    end if;
  end loop;
  return v_creadas;
end $f$;

-- ---------------------------------------------------------------------
-- D) Pacientes internados de la demo (observación u hospitalización) con notas, signos y cuenta.
-- ---------------------------------------------------------------------
create or replace function public._clinica_demo_estancia(p_uid uuid, p_tipo text, p_ingreso timestamptz) returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare v_pac record; v_med record; v_enf record; v_serv uuid; v_e uuid; v_cama text;
begin
  if not public._es_cuenta_demo(p_uid) then raise exception 'clinica_demo_solo_demo'; end if;
  select p.* into v_pac from public.clinica_pacientes p where p.auth_user_id = p_uid and p.activo and p.fecha_nacimiento <= current_date - interval '18 years'
     and not exists (select 1 from public.clinica_estancias e where e.paciente_id = p.id and e.estado = 'activa')
   order by md5(p.id::text || p_ingreso::text) limit 1;
  select * into v_med from public.clinica_personal where auth_user_id = p_uid and rol = 'medico' and especialidad = 'Medicina general' order by md5(id::text || p_ingreso::text) limit 1;
  select * into v_enf from public.clinica_personal where auth_user_id = p_uid and rol = 'enfermeria' limit 1;
  select id into v_serv from public.productos where auth_user_id = p_uid and tipo = 'servicio' and nombre = case when p_tipo = 'hospitalizacion' then 'Día de hospitalización' else 'Observación (hasta 8 horas)' end limit 1;
  v_cama := case when p_tipo = 'hospitalizacion' then 'Habitación ' || (2 + public._clinica_demo_rnd(p_ingreso::text, 4)) else 'Cama ' || (1 + public._clinica_demo_rnd(p_ingreso::text, 3)) end;
  if v_pac.id is null or v_med.id is null then return null; end if;
  insert into public.clinica_estancias(auth_user_id, paciente_id, tipo, cama, medico_id, servicio_id, ingreso_en)
  values (p_uid, v_pac.id, p_tipo, v_cama, v_med.id, v_serv, p_ingreso) returning id into v_e;
  insert into public.clinica_estancia_notas(auth_user_id, estancia_id, paciente_id, tipo, texto, pa_sistolica, pa_diastolica, fc, temperatura, spo2, autor_id, autor_nombre, created_at) values
    (p_uid, v_e, v_pac.id, 'ingreso', case when p_tipo = 'hospitalizacion' then 'Ingresa por neumonía adquirida en la comunidad. Inicia antibiótico IV y líquidos.' else 'Ingresa a observación por deshidratación leve. Hidratación IV y vigilancia.' end,
      128, 82, 96, 38.4, 93, v_med.id, v_med.nombre, p_ingreso + interval '10 minutes'),
    (p_uid, v_e, v_pac.id, 'enfermeria', 'Se canaliza vena periférica, inicia suero. Paciente tranquilo.', 124, 80, 92, 38.1, 94, coalesce(v_enf.id, v_med.id), coalesce(v_enf.nombre, v_med.nombre), p_ingreso + interval '40 minutes'),
    (p_uid, v_e, v_pac.id, 'enfermeria', 'Signos estables. Tolera la vía oral. Se administra medicamento según indicación.', 118, 76, 84, 37.4, 96, coalesce(v_enf.id, v_med.id), coalesce(v_enf.nombre, v_med.nombre), p_ingreso + interval '3 hours');
  if p_tipo = 'hospitalizacion' then
    insert into public.clinica_estancia_notas(auth_user_id, estancia_id, paciente_id, tipo, texto, autor_id, autor_nombre, created_at)
    values (p_uid, v_e, v_pac.id, 'evolucion', 'Evoluciona favorablemente. Afebril. Continúa antibiótico.', v_med.id, v_med.nombre, p_ingreso + interval '22 hours');
  end if;
  insert into public.clinica_estancia_cargos(auth_user_id, estancia_id, producto_id, descripcion, cantidad)
  select p_uid, v_e, x.id, x.nombre, q from (values ('Suero fisiológico 1 L', case when p_tipo = 'hospitalizacion' then 4 else 2 end), ('Jeringa 5 ml', 4), ('Ceftriaxona 1 g (vial)', case when p_tipo = 'hospitalizacion' then 3 else 0 end)) as v(nom, q)
  join public.productos x on x.auth_user_id = p_uid and x.nombre = v.nom where q > 0;
  return v_e;
end $f$;

-- ---------------------------------------------------------------------
-- E) La demo siempre "viva": al abrirla, si hoy todavía no tiene agenda, se arma el día (y se
--    ponen al día los días que nadie la abrió). Solo en la demo de simulación; nunca en cuentas reales.
-- ---------------------------------------------------------------------
create or replace function public.clinica_demo_preparar() returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date; v_n int := 0; d int; v_ult date; c record; v_dia date; v_ts timestamptz;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._es_cuenta_demo(v_uid) or not exists (select 1 from public.configuracion_empresa where auth_user_id = v_uid and metadata->>'clinica_demo_simulacion' = 'true') then
    return jsonb_build_object('ok', false, 'motivo', 'solo_demo');
  end if;
  perform pg_advisory_xact_lock(hashtext('clinica_demo:' || v_uid::text));
  if exists (select 1 from public.agenda_citas where auth_user_id = v_uid and fecha = v_hoy) then
    -- La demo avanza con el reloj: lo que ya pasó se atiende y se cobra; quien va llegando entra a la sala.
    -- Solo toca las citas que la propia demo generó (creado_por 'Recepción') y que nadie ha tocado.
    for c in select a.id, a.cliente_id, s.hora_inicio, s.profesional_id from public.agenda_citas a
               join lateral (select x.hora_inicio, x.profesional_id from public.agenda_citas_servicios x where x.cita_id = a.id order by x.hora_inicio limit 1) s on true
               left join public.clinica_cita_info i on i.agenda_cita_id = a.id
              where a.auth_user_id = v_uid and a.fecha = v_hoy and a.venta_id is null and a.estado in ('reservada', 'confirmada')
                and a.creado_por = 'Recepción' and i.llegada_en is null
              order by s.hora_inicio loop
      v_ts := (v_hoy + c.hora_inicio) at time zone 'America/Managua';
      if v_ts < now() - interval '60 minutes' then
        perform public._clinica_demo_completar(v_uid, c.id, true); v_n := v_n + 1;
      elsif v_ts between now() - interval '30 minutes' and now() + interval '10 minutes' then
        insert into public.clinica_cita_info(agenda_cita_id, auth_user_id, paciente_id, consultorio_id, llegada_en)
        select c.id, v_uid, (select p.id from public.clinica_pacientes p where p.auth_user_id = v_uid and p.cliente_id = c.cliente_id limit 1),
               (select cp.consultorio_id from public.clinica_personal cp where cp.auth_user_id = v_uid and cp.agenda_profesional_id = c.profesional_id limit 1),
               least(now() - interval '2 minutes', v_ts - interval '8 minutes')
        on conflict (agenda_cita_id) do update set llegada_en = coalesce(clinica_cita_info.llegada_en, excluded.llegada_en);
        update public.agenda_citas set estado = 'confirmada', updated_at = now() where id = c.id;
        v_n := v_n + 1;
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'avanzadas', v_n);
  end if;
  for c in select a.id, i.llegada_en from public.agenda_citas a left join public.clinica_cita_info i on i.agenda_cita_id = a.id
            where a.auth_user_id = v_uid and a.fecha < v_hoy and a.venta_id is null and a.estado in ('reservada','confirmada','en_atencion','llegada') loop
    if c.llegada_en is not null then perform public._clinica_demo_completar(v_uid, c.id, true);
    else update public.agenda_citas set estado = 'no_asistio', updated_at = now() where id = c.id; end if;
  end loop;
  select max(fecha) into v_ult from public.agenda_citas where auth_user_id = v_uid and fecha < v_hoy;
  v_dia := greatest(coalesce(v_ult, v_hoy - 15) + 1, v_hoy - 14);
  while v_dia < v_hoy loop
    if not exists (select 1 from public.agenda_citas where auth_user_id = v_uid and fecha = v_dia) then v_n := v_n + public._clinica_demo_dia(v_uid, v_dia, 'pasado'); end if;
    v_dia := v_dia + 1;
  end loop;
  v_n := v_n + public._clinica_demo_dia(v_uid, v_hoy, 'hoy');
  for d in 1 .. 3 loop
    if not exists (select 1 from public.agenda_citas where auth_user_id = v_uid and fecha = v_hoy + d) then v_n := v_n + public._clinica_demo_dia(v_uid, v_hoy + d, 'futuro'); end if;
  end loop;
  update public.clinica_estancias set estado = 'alta' where auth_user_id = v_uid and estado = 'activa' and ingreso_en < now() - interval '3 days';
  if not exists (select 1 from public.clinica_estancias where auth_user_id = v_uid and estado = 'activa' and tipo = 'observacion') then
    perform public._clinica_demo_estancia(v_uid, 'observacion', now() - interval '3 hours'); end if;
  if not exists (select 1 from public.clinica_estancias where auth_user_id = v_uid and estado = 'activa' and tipo = 'hospitalizacion') then
    perform public._clinica_demo_estancia(v_uid, 'hospitalizacion', now() - interval '1 day 4 hours'); end if;
  return jsonb_build_object('ok', true, 'creadas', v_n);
end $f$;

revoke all on function public._clinica_demo_vender(uuid, date, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._clinica_demo_rnd(text, int) from public, anon, authenticated;
revoke all on function public._clinica_demo_completar(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public._clinica_demo_dia(uuid, date, text) from public, anon, authenticated;
revoke all on function public._clinica_demo_estancia(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.clinica_demo_preparar() from public, anon;
grant execute on function public.clinica_demo_preparar() to authenticated;

-- ---------------------------------------------------------------------
-- F) La cuenta de demostración "Centro Médico San Rafael"
-- ---------------------------------------------------------------------
create or replace function public._clinica_demo_crear_sanrafael() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-clinica-sanrafael@negocio360oficial.com';
  k_america uuid; k_mapfre uuid; k_textiles uuid; cli_k uuid; kons uuid[]; pr uuid; emp uuid; v_hoy date := (now() at time zone 'America/Managua')::date; d date; n int := 0;
  r record; v_pac uuid; v_cli uuid; i int := 0; e uuid; v_rec uuid; v_venta uuid; v_citas uuid[]; v_monto numeric; v_lineas jsonb;
  v_med record;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo San Rafael ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoSanRafael#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'San Rafael', 'email_verified', true, 'nombre_negocio', 'Centro Médico San Rafael', 'phone_verified', false),
    now() - interval '35 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Centro Médico San Rafael', 'demo_publica', 'clinica', 'Demo pública de Clínica con datos de simulación que se renuevan solos cada día (clinica_demo_preparar). Sin multiusuario.', 18);
  update public.usuarios set nombre = 'Demo', apellido = 'San Rafael', nombre_negocio = 'Centro Médico San Rafael', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, usa_modulo_clinica, clinica_especialidades, direccion, telefono)
  values (u, 'Centro Médico San Rafael', 'clinica', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false},"clinica_demo_simulacion":"true"}'::jsonb,
    false, true, true, array['medicina_general','pediatria','ginecologia','odontologia'], 'De la Rotonda Rubén Darío 2 c. al sur, Managua', '2250-4400')
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, usa_modulo_clinica = true,
    clinica_especialidades = excluded.clinica_especialidades, direccion = excluded.direccion, telefono = excluded.telefono;
  -- Para que las ventas de la demo se registren igual que las de la persona que la usa (auth.uid() = la demo)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- Consultorios
  insert into public.clinica_consultorios(auth_user_id, nombre, descripcion) values (u, 'Consultorio 1', 'Planta baja'), (u, 'Consultorio 2', 'Planta baja'),
    (u, 'Pediatría', 'Planta baja, área infantil'), (u, 'Consultorio dental', 'Planta alta');
  select array_agg(id order by nombre) into kons from public.clinica_consultorios where auth_user_id = u;   -- 1, 2, dental, pediatría

  -- Médicos (sin multiusuario: en la demo se elige el médico y no se pide código), su columna en la Agenda y honorarios
  for r in select * from (values
      ('Dra. Ana Ruiz', 'Medicina general', 'MINSA-10234', 1, '#3b82f6', 'porcentaje', 30::numeric, true),
      ('Dr. Roberto Castillo', 'Medicina general', 'MINSA-18822', 2, '#0ea5e9', 'monto', 150::numeric, true),
      ('Dr. Carlos Méndez', 'Pediatría', 'MINSA-20871', 4, '#10b981', 'porcentaje', 25::numeric, true),
      ('Dra. Patricia Lacayo', 'Ginecología', 'MINSA-27560', 2, '#ec4899', 'ninguno', 0::numeric, false),
      ('Dra. Lucía Torres', 'Odontología', 'MINSA-33410', 3, '#a855f7', 'ninguno', 0::numeric, false)) as m(nombre, esp, reg, kon, color, ht, hv, con_emp) loop
    emp := null;
    if r.con_emp then insert into public.empleados(auth_user_id, nombre, cargo, salario) values (u, r.nombre, 'Médico (' || r.esp || ')', 0) returning id into emp; end if;
    insert into public.agenda_profesionales(auth_user_id, nombre, color, orden, activo, empleado_id) values (u, r.nombre, r.color, i, true, emp) returning id into pr;
    insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, consultorio_id, agenda_profesional_id, honorario_tipo, honorario_valor, empleado_id)
    values (u, r.nombre, 'medico', true, r.esp, r.reg, kons[r.kon], pr, r.ht, r.hv, emp);
    i := i + 1;
  end loop;
  insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, honorario_tipo, honorario_valor) values (u, 'Lic. Marta Sánchez (enfermería)', 'enfermeria', false, 'ninguno', 0);

  -- Servicios y medicamentos / insumos
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, activo) values
    (u, 'Consulta general', 'servicio', 600, 0, true), (u, 'Consulta pediátrica', 'servicio', 700, 0, true), (u, 'Control prenatal', 'servicio', 800, 0, true),
    (u, 'Consulta ginecológica', 'servicio', 850, 0, true), (u, 'Limpieza dental', 'servicio', 900, 0, true), (u, 'Resina dental', 'servicio', 1200, 0, true),
    (u, 'Extracción dental', 'servicio', 1000, 0, true), (u, 'Curación', 'servicio', 350, 0, true), (u, 'Inyección (aplicación)', 'servicio', 150, 0, true),
    (u, 'Nebulización', 'servicio', 300, 0, true), (u, 'Día de hospitalización', 'servicio', 2500, 0, true), (u, 'Observación (hasta 8 horas)', 'servicio', 1200, 0, true),
    (u, 'Cobertura de seguro médico', 'servicio', 0, 0, true);
  insert into public.productos(auth_user_id, nombre, tipo, precio, costo, stock_actual, activo) values
    (u, 'Acetaminofén 500 mg (tableta)', 'producto', 5, 1.5, 900, true), (u, 'Amoxicilina 500 mg (cápsula)', 'producto', 12, 4, 600, true),
    (u, 'Ibuprofeno 400 mg (tableta)', 'producto', 6, 2, 800, true), (u, 'Loratadina 10 mg (tableta)', 'producto', 8, 2.5, 500, true),
    (u, 'Omeprazol 20 mg (cápsula)', 'producto', 9, 3, 500, true), (u, 'Losartán 50 mg (tableta)', 'producto', 10, 3.5, 600, true),
    (u, 'Metformina 850 mg (tableta)', 'producto', 7, 2, 600, true), (u, 'Sales de rehidratación oral', 'producto', 25, 10, 300, true),
    (u, 'Suero fisiológico 1 L', 'producto', 120, 55, 200, true), (u, 'Jeringa 5 ml', 'producto', 10, 3, 600, true),
    (u, 'Ceftriaxona 1 g (vial)', 'producto', 180, 80, 150, true), (u, 'Ácido fólico 5 mg (tableta)', 'producto', 4, 1, 600, true);

  -- Aseguradoras y convenios (su cliente, para facturarles por Ventas)
  insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, 'Seguros América', '2255-1000', true) returning id into cli_k;
  insert into public.clinica_convenios(auth_user_id, nombre, tipo, cobertura_pct, cliente_id, telefono, notas) values (u, 'Seguros América', 'aseguradora', 80, cli_k, '2255-1000', 'Requiere carné vigente y cédula.') returning id into k_america;
  insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, 'MAPFRE Nicaragua', '2276-8890', true) returning id into cli_k;
  insert into public.clinica_convenios(auth_user_id, nombre, tipo, cobertura_pct, cliente_id, telefono) values (u, 'MAPFRE Nicaragua', 'aseguradora', 70, cli_k, '2276-8890') returning id into k_mapfre;
  insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, 'Textiles del Norte S.A.', '2233-4400', true) returning id into cli_k;
  insert into public.clinica_convenios(auth_user_id, nombre, tipo, cobertura_pct, cliente_id, telefono, notas) values (u, 'Textiles del Norte S.A.', 'empresa', 50, cli_k, '2233-4400', 'Convenio empresarial para sus colaboradores.') returning id into k_textiles;

  -- Pacientes (también clientes, para cobrarles); ~1 de cada 4 con seguro
  i := 0;
  for r in select * from (values
    ('Ana Lucía', 'Silva Rivas', 'femenino', 4, 9, 6, null, '8531-4311', null, null),
    ('Paola', 'Gómez Hernández', 'femenino', 1, 6, 10, null, '8907-4218', null, 'k_america'),
    ('Camila', 'Ortega Ortega', 'femenino', 9, 8, 16, null, '8891-2650', null, null),
    ('Carmen', 'Matus Ortega', 'femenino', 4, 3, 15, null, '8750-8422', null, 'k_mapfre'),
    ('Andrés', 'García Sandino', 'masculino', 3, 9, 24, null, '8543-2476', null, null),
    ('Camila', 'Bermúdez Chavarría', 'femenino', 7, 2, 19, null, '8216-3061', null, 'k_america'),
    ('Karla', 'Lacayo Chavarría', 'femenino', 2, 8, 26, null, '8748-2447', null, null),
    ('Sofía', 'Torres Mendoza', 'femenino', 5, 1, 6, null, '8324-8781', null, null),
    ('Santiago', 'Espinoza Úbeda', 'masculino', 11, 3, 14, null, '8276-8078', null, null),
    ('Karla', 'Martínez Rodríguez', 'femenino', 3, 12, 8, null, '8456-6329', null, 'k_america'),
    ('Mariela', 'Bermúdez Sandino', 'femenino', 28, 9, 12, 'Agricultor', '8147-4423', '001-120998-3980U', 'k_mapfre'),
    ('Isabel', 'Rocha Obando', 'femenino', 21, 1, 13, 'Enfermera', '8120-5566', '001-130105-3096R', null),
    ('Jessica', 'Aguilar Rocha', 'femenino', 41, 6, 17, 'Secretaria', '8625-5874', '001-170685-6119P', null),
    ('Andrea', 'Espinoza Bermúdez', 'femenino', 28, 11, 14, 'Jubilado', '8861-8338', '001-141198-3983T', 'k_america'),
    ('Isabel', 'Ortega Espinoza', 'femenino', 27, 12, 20, 'Agricultor', '8605-8594', '001-201299-3024G', null),
    ('Valeria', 'Pérez Hernández', 'femenino', 30, 8, 6, 'Albañil', '8988-1310', '001-060896-1541F', null),
    ('Mariela', 'Silva Chavarría', 'femenino', 27, 8, 19, 'Jubilado', '8118-4597', '001-190899-7654E', null),
    ('Daniela', 'Aguilar Pérez', 'femenino', 34, 3, 12, 'Secretaria', '8306-1297', '001-120392-6845D', 'k_america'),
    ('Mariela', 'Aguilar Pérez', 'femenino', 25, 8, 25, 'Comerciante', '8787-6705', '001-250801-1376Q', null),
    ('Camila', 'Rivas Silva', 'femenino', 35, 1, 10, 'Conductor', '8125-2331', '001-100191-1349Y', null),
    ('Valeria', 'Hernández Rodríguez', 'femenino', 36, 6, 2, 'Estudiante', '8180-7360', '001-020690-5140A', null),
    ('Karla', 'Obando Torres', 'femenino', 25, 9, 13, 'Abogado', '8827-5803', '001-130901-4029M', 'k_america'),
    ('Abril', 'Bermúdez Espinoza', 'femenino', 20, 9, 24, 'Diseñadora', '8563-7191', '001-240906-4125W', null),
    ('Ileana', 'Úbeda Chavarría', 'femenino', 35, 12, 23, 'Ama de casa', '8515-9853', '001-231291-7390K', null),
    ('Josué', 'Rocha Sandino', 'masculino', 69, 10, 23, 'Ama de casa', '8602-5008', '001-231057-9681X', 'k_mapfre'),
    ('Andrea', 'Lacayo Rodríguez', 'femenino', 56, 10, 27, 'Diseñadora', '8990-1675', '001-271070-8629S', 'k_america'),
    ('Carmen', 'Gómez Zeledón', 'femenino', 39, 4, 5, 'Mecánico', '8368-5679', '001-050487-9360M', 'k_textiles'),
    ('Kevin', 'Morales Pérez', 'masculino', 62, 7, 28, 'Docente', '8368-7064', '001-280764-4931G', null),
    ('José Luis', 'Torres Bermúdez', 'masculino', 46, 12, 4, 'Docente', '8925-4191', '001-041280-9510N', null),
    ('Carmen', 'Zeledón Hernández', 'femenino', 39, 2, 6, 'Estudiante', '8446-4806', '001-060287-8659B', 'k_america'),
    ('Diego', 'Matus Rodríguez', 'masculino', 33, 7, 23, 'Secretaria', '8220-1030', '001-230793-7568Y', null),
    ('Kevin', 'Bermúdez Rocha', 'masculino', 37, 12, 5, 'Agricultor', '8293-1559', '001-051289-6855C', 'k_mapfre'),
    ('Mariela', 'García Rivas', 'femenino', 67, 10, 2, 'Ama de casa', '8638-4574', '001-021059-4668L', null),
    ('Jorge', 'Hernández Zeledón', 'masculino', 25, 7, 19, 'Estudiante', '8819-9195', '001-190701-1760P', 'k_america'),
    ('Kevin', 'Martínez Castillo', 'masculino', 51, 2, 15, 'Jubilado', '8194-2983', '001-150275-8305S', null),
    ('Marvin', 'Obando López', 'masculino', 34, 8, 20, 'Secretaria', '8367-7408', '001-200892-4094F', null),
    ('Ileana', 'Espinoza Torres', 'femenino', 78, 3, 11, 'Ama de casa', '8209-5851', '001-110348-9969G', null),
    ('Luis Alberto', 'López Chavarría', 'masculino', 33, 8, 14, 'Diseñadora', '8698-7679', '001-140893-2007V', 'k_america'),
    ('Jorge', 'Hernández Castillo', 'masculino', 66, 8, 16, 'Abogado', '8578-5459', '001-160860-4969T', 'k_mapfre'),
    ('Isabel', 'Silva Pérez', 'femenino', 41, 3, 20, 'Ingeniero', '8526-4304', '001-200385-2187J', null),
    ('Camila', 'Castillo Rivas', 'femenino', 49, 6, 13, 'Agricultor', '8644-2022', '001-130677-8067H', null),
    ('Gabriela', 'Rivas Sandino', 'femenino', 35, 1, 8, 'Docente', '8643-9794', '001-080191-2705J', 'k_america'),
    ('Andrea', 'Matus Téllez', 'femenino', 72, 2, 28, 'Ingeniero', '8360-1329', '001-280254-6960S', null),
    ('María José', 'Gómez Rocha', 'femenino', 45, 12, 18, 'Docente', '8308-9356', '001-181281-5638W', null),
    ('Ximena', 'García Martínez', 'femenino', 31, 10, 14, 'Ama de casa', '8488-2863', '001-141095-9908Q', null)
  ) as p(nombres, apellidos, sexo, edad, mes, dia, ocupacion, telefono, cedula, conv) loop
    insert into public.clientes(auth_user_id, nombre, telefono, activo) values (u, r.nombres || ' ' || r.apellidos, r.telefono, true) returning id into v_cli;
    insert into public.clinica_pacientes(auth_user_id, nombres, apellidos, cedula, fecha_nacimiento, sexo, telefono, ocupacion, cliente_id, convenio_id, poliza, poliza_vence,
      contacto_emergencia_nombre, contacto_emergencia_telefono, contacto_emergencia_parentesco)
    values (u, r.nombres, r.apellidos, r.cedula, make_date(extract(year from v_hoy)::int - r.edad, r.mes, r.dia), r.sexo, r.telefono, r.ocupacion, v_cli,
      case r.conv when 'k_america' then k_america when 'k_mapfre' then k_mapfre when 'k_textiles' then k_textiles end,
      case when r.conv is not null then upper(left(r.conv, 4)) || '-' || (100000 + i * 7919) end,
      case when r.conv is not null then (v_hoy + interval '1 year')::date end,
      case when r.edad < 14 then 'Mamá de ' || r.nombres end, case when r.edad < 14 then r.telefono end, case when r.edad < 14 then 'madre' end)
    returning id into v_pac;
    if i % 2 = 0 or r.edad > 55 then
      insert into public.clinica_antecedentes(paciente_id, auth_user_id, tipo_sangre, alergias, sin_alergias, personales, familiares, habitos, actualizado_por_nombre)
      values (v_pac, u, (array['O+','A+','B+','O+','AB+','O-'])[1 + i % 6],
        case when i % 6 = 0 then 'Penicilina' when i % 10 = 4 then 'Sulfas' end, not (i % 6 = 0 or i % 10 = 4),
        case when r.edad > 55 then 'Hipertensión arterial. Diabetes tipo 2.' when r.edad < 14 then 'Vacunas completas para su edad.' else 'Sin antecedentes de importancia.' end,
        case when i % 3 = 0 then 'Madre hipertensa, padre diabético.' end, case when r.edad >= 18 then 'No fuma. Actividad física ocasional.' end, 'Dra. Ana Ruiz');
    end if;
    i := i + 1;
  end loop;

  -- Un mes de historial (visitas atendidas y cobradas con su venta), hoy y los próximos días
  d := v_hoy - 30;
  while d < v_hoy loop n := n + public._clinica_demo_dia(u, d, 'pasado'); d := d + 1; end loop;
  n := n + public._clinica_demo_dia(u, v_hoy, 'hoy');
  for i in 1 .. 3 loop n := n + public._clinica_demo_dia(u, v_hoy + i, 'futuro'); end loop;

  -- Internados: uno hospitalizado, uno en observación, y dos que ya se fueron (uno con seguro), cobrados
  perform public._clinica_demo_estancia(u, 'hospitalizacion', now() - interval '1 day 4 hours');
  perform public._clinica_demo_estancia(u, 'observacion', now() - interval '3 hours');
  for i in 1 .. 2 loop
    e := public._clinica_demo_estancia(u, case when i = 1 then 'hospitalizacion' else 'observacion' end, now() - make_interval(days => 6 + i * 4));
    update public.clinica_estancias set estado = 'alta', alta_en = ingreso_en + case when i = 1 then interval '2 days 3 hours' else interval '6 hours' end where id = e;
    select p.*, e2.servicio_id, e2.alta_en, e2.ingreso_en into r from public.clinica_estancias e2 join public.clinica_pacientes p on p.id = e2.paciente_id where e2.id = e;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_lineas from (
      select jsonb_build_object('producto_id', e3.servicio_id, 'cantidad', greatest(1, ceil(extract(epoch from (e3.alta_en - e3.ingreso_en)) / 86400.0)), 'precio', s.precio) x
        from public.clinica_estancias e3 join public.productos s on s.id = e3.servicio_id where e3.id = e
      union all
      select jsonb_build_object('producto_id', g.producto_id, 'cantidad', g.cantidad, 'precio', pp.precio) from public.clinica_estancia_cargos g join public.productos pp on pp.id = g.producto_id where g.estancia_id = e) t;
    if i = 1 then   -- con seguro (América 80%): el paciente paga su 20%
      update public.clinica_pacientes set convenio_id = k_america, poliza = coalesce(poliza, 'AMER-55555'), poliza_vence = coalesce(poliza_vence, (v_hoy + interval '1 year')::date) where id = r.id;
      select sum(round((x->>'cantidad')::numeric * (x->>'precio')::numeric, 2)) into v_monto from jsonb_array_elements(v_lineas) x;
      update public.clinica_estancias set convenio_id = k_america, cobertura_pct = 80, monto_cubierto = round(v_monto * 0.8, 2),
        cubierto_servicios = round((select sum(round((x->>'cantidad')::numeric * (x->>'precio')::numeric, 2)) from jsonb_array_elements(v_lineas) x
                                    join public.productos pp on pp.id = (x->>'producto_id')::uuid and pp.tipo = 'servicio') * 0.8, 2) where id = e;
      select coalesce(jsonb_agg(jsonb_build_object('producto_id', x->>'producto_id', 'cantidad', 1, 'precio', round((x->>'cantidad')::numeric * (x->>'precio')::numeric * 0.2, 2))), '[]'::jsonb)
        into v_lineas from jsonb_array_elements(v_lineas) x;
    end if;
    v_venta := public._clinica_demo_vender(u, (r.alta_en at time zone 'America/Managua')::date, r.cliente_id, v_lineas, 'Tarjeta', null);
    update public.clinica_estancias set venta_id = v_venta where id = e;
  end loop;

  -- Factura a Seguros América por las visitas de hace más de 12 días (ya pagada por transferencia); lo más reciente queda por facturar
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
      'Transferencia', 'Cobertura Seguros América · ' || cardinality(v_citas) || ' citas');
    update public.clinica_reclamos set venta_id = v_venta, estado = 'facturado' where id = v_rec;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Demo Centro Médico San Rafael creada: % (% visitas)', u, n;
  return u;
end $f$;
revoke all on function public._clinica_demo_crear_sanrafael() from public, anon, authenticated;

-- Se crea la cuenta (una sola vez: si ya existe, la función se niega).
select public._clinica_demo_crear_sanrafael();

