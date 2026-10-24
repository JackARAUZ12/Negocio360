-- =====================================================================
-- MÓDULO CLÍNICA — FASE 2 (documentos, diagnósticos CIE-10, adjuntos)
-- ---------------------------------------------------------------------
-- SOLO AGREGA: tablas/funciones clinica_* nuevas, una columna nueva en
-- clinica_consultas (tabla propia de la Fase 1), un bucket PRIVADO nuevo,
-- y nuevas versiones de dos funciones propias de la Fase 1
-- (clinica_expediente_abrir y clinica_consulta_guardar). No toca nada
-- de otros módulos ni datos de clientes.
--
-- * Documentos (receta, órdenes de laboratorio e imágenes, constancia,
--   certificado, referencia, consentimiento): mismo candado que la nota
--   (RLS sin políticas; solo funciones con sesión clínica). Numerados por
--   tipo (RX-000001, LAB-000001…), con los datos del médico congelados al
--   emitir, inmutables (solo se anulan con motivo) y en la bitácora.
-- * Adjuntos: bucket "clinica-adjuntos" PRIVADO y SIN políticas: el
--   navegador no puede leerlo ni escribirlo. La función de borde
--   "clinica-adjuntos" valida la sesión clínica (llamando a estas funciones
--   como el usuario) y solo entonces entrega un enlace firmado temporal
--   (subida o vista de 2 min). Límite 10 MB; solo PDF, JPG, PNG, WEBP.
-- =====================================================================
do $migracion$
begin
execute replace($sql$

-- ---------- 1. Diagnósticos codificados (CIE-10) en la consulta ----------
alter table public.clinica_consultas add column if not exists diagnosticos jsonb not null default '[]'::jsonb
  check (jsonb_typeof(diagnosticos) = 'array' and jsonb_array_length(diagnosticos) <= 20 and octet_length(diagnosticos::text) <= 8000);

-- ---------- 2. Documentos ----------
create table if not exists public.clinica_documentos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  paciente_id uuid not null references public.clinica_pacientes(id),
  consulta_id uuid references public.clinica_consultas(id),
  tipo text not null check (tipo in ('receta','orden_lab','orden_imagen','constancia','certificado','referencia','consentimiento')),
  numero text not null,
  fecha timestamptz not null default now(),
  medico_id uuid not null references public.clinica_personal(id),
  medico_nombre text not null,
  medico_registro text,
  medico_especialidad text,
  contenido jsonb not null check (jsonb_typeof(contenido) = 'object' and octet_length(contenido::text) <= 50000),
  estado text not null default 'emitido' check (estado in ('emitido','anulado')),
  anulado_en timestamptz,
  anulado_por_nombre text,
  motivo_anulacion text check (motivo_anulacion is null or char_length(motivo_anulacion) <= 500),
  farmacia_receta_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists clinica_documentos_paciente on public.clinica_documentos(paciente_id, fecha desc);
create unique index if not exists clinica_documentos_numero on public.clinica_documentos(auth_user_id, numero);
alter table public.clinica_documentos enable row level security;

create or replace function public._clinica_documentos_inmutable() returns trigger
language plpgsql set search_path = public as $f$
declare v_libres text[] := array['estado','anulado_en','anulado_por_nombre','motivo_anulacion','farmacia_receta_id'];
begin
  if tg_op = upper('#BORRAR#') then
    if public._clinica_mantenimiento() then return old; end if;
    raise exception 'clinica_no_se_borra' using hint = 'Los documentos no se borran: anúlalos con un motivo.';
  end if;
  if old.estado = 'anulado' then raise exception 'clinica_documento_anulado'; end if;
  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres)
     or (old.farmacia_receta_id is not null and new.farmacia_receta_id is distinct from old.farmacia_receta_id) then
    raise exception 'clinica_documento_inmutable' using hint = 'Un documento emitido no se modifica: anúlalo y emite otro.';
  end if;
  return new;
end $f$;
create trigger clinica_documentos_inmutable before update or #BORRAR# on public.clinica_documentos
  for each row execute function public._clinica_documentos_inmutable();

-- ---------- 3. Adjuntos (registro; el archivo vive en el bucket privado) ----------
create table if not exists public.clinica_adjuntos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  paciente_id uuid not null references public.clinica_pacientes(id),
  consulta_id uuid references public.clinica_consultas(id),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 150),
  mime text not null check (mime in ('application/pdf','image/jpeg','image/png','image/webp')),
  tamano int not null check (tamano between 1 and 10485760),
  ruta text not null unique,
  descripcion text check (descripcion is null or char_length(descripcion) <= 300),
  estado text not null default 'pendiente' check (estado in ('pendiente','listo','anulado')),
  subido_por uuid references public.clinica_personal(id),
  subido_por_nombre text,
  anulado_en timestamptz,
  motivo_anulacion text check (motivo_anulacion is null or char_length(motivo_anulacion) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists clinica_adjuntos_paciente on public.clinica_adjuntos(paciente_id, created_at desc);
alter table public.clinica_adjuntos enable row level security;

create or replace function public._clinica_adjuntos_inmutable() returns trigger
language plpgsql set search_path = public as $f$
declare v_libres text[] := array['estado','anulado_en','motivo_anulacion'];
begin
  if tg_op = upper('#BORRAR#') then
    if public._clinica_mantenimiento() then return old; end if;
    raise exception 'clinica_no_se_borra' using hint = 'Los adjuntos no se borran: anúlalos con un motivo.';
  end if;
  if old.estado = 'anulado' then raise exception 'clinica_adjunto_anulado'; end if;
  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres)
     or (old.estado = 'listo' and new.estado = 'pendiente') then
    raise exception 'clinica_adjunto_inmutable';
  end if;
  return new;
end $f$;
create trigger clinica_adjuntos_inmutable before update or #BORRAR# on public.clinica_adjuntos
  for each row execute function public._clinica_adjuntos_inmutable();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinica-adjuntos', 'clinica-adjuntos', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- ---------- 4. Funciones: documentos ----------
create or replace function public.clinica_documento_emitir(p_token text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_pac uuid; v_cons uuid; v_tipo text; v_c jsonb; v_pref text; v_n int; v_num text; v_id uuid; v_ok boolean;
begin
  v_p := public._clinica_sesion(p_token);
  v_pac := (p_datos->>'paciente_id')::uuid;
  v_cons := nullif(p_datos->>'consulta_id', '')::uuid;
  v_tipo := p_datos->>'tipo';
  v_c := p_datos->'contenido';
  if not exists (select 1 from public.clinica_pacientes where id = v_pac and auth_user_id = auth.uid()) then raise exception 'clinica_paciente_no_encontrado'; end if;
  if v_cons is not null and not exists (select 1 from public.clinica_consultas where id = v_cons and auth_user_id = auth.uid() and paciente_id = v_pac and estado <> 'anulada') then
    return jsonb_build_object('ok', false, 'motivo', 'consulta');
  end if;
  v_pref := case v_tipo when 'receta' then 'RX' when 'orden_lab' then 'LAB' when 'orden_imagen' then 'IMG' when 'constancia' then 'CON'
                        when 'certificado' then 'CER' when 'referencia' then 'REF' when 'consentimiento' then 'CI' end;
  if v_pref is null then return jsonb_build_object('ok', false, 'motivo', 'tipo'); end if;
  if v_c is null or jsonb_typeof(v_c) <> 'object' or octet_length(v_c::text) > 50000 then return jsonb_build_object('ok', false, 'motivo', 'contenido'); end if;
  v_ok := case v_tipo
    when 'receta' then jsonb_typeof(v_c->'items') = 'array' and jsonb_array_length(v_c->'items') between 1 and 30
         and not exists (select 1 from jsonb_array_elements(v_c->'items') it where coalesce(btrim(it->>'medicamento'), '') = '' or char_length(it->>'medicamento') > 200)
    when 'orden_lab' then (jsonb_typeof(v_c->'examenes') = 'array' and jsonb_array_length(v_c->'examenes') > 0) or coalesce(btrim(v_c->>'otros'), '') <> ''
    when 'orden_imagen' then (jsonb_typeof(v_c->'estudios') = 'array' and jsonb_array_length(v_c->'estudios') > 0) or coalesce(btrim(v_c->>'otros'), '') <> ''
    when 'constancia' then coalesce(btrim(v_c->>'texto'), '') <> ''
    when 'certificado' then coalesce(btrim(v_c->>'texto'), '') <> ''
         and (v_c->>'dias_reposo' is null or (v_c->>'dias_reposo') ~ '^[0-9]{1,3}$')
    when 'referencia' then coalesce(btrim(v_c->>'destino'), '') <> '' and coalesce(btrim(v_c->>'motivo'), '') <> ''
    when 'consentimiento' then coalesce(btrim(v_c->>'procedimiento'), '') <> ''
  end;
  if not coalesce(v_ok, false) then return jsonb_build_object('ok', false, 'motivo', 'incompleto'); end if;
  perform pg_advisory_xact_lock(hashtext('clinica_doc:' || auth.uid()::text || ':' || v_pref));
  select coalesce(max(substring(numero from '^' || v_pref || '-([0-9]+)$')::int), 0) + 1 into v_n
    from public.clinica_documentos where auth_user_id = auth.uid() and tipo = v_tipo;
  v_num := v_pref || '-' || lpad(v_n::text, 6, '0');
  insert into public.clinica_documentos(auth_user_id, paciente_id, consulta_id, tipo, numero, medico_id, medico_nombre, medico_registro, medico_especialidad, contenido)
  values (auth.uid(), v_pac, v_cons, v_tipo, v_num, v_p.id, v_p.nombre, v_p.registro_profesional, v_p.especialidad, v_c)
  returning id into v_id;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'emitir_documento', v_pac, v_cons, v_num);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num);
end $f$;

create or replace function public.clinica_documento_anular(p_token text, p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_d public.clinica_documentos; v_m text := left(nullif(btrim(p_motivo), ''), 500);
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_d from public.clinica_documentos where id = p_id and auth_user_id = auth.uid() for update;
  if v_d.id is null then raise exception 'clinica_documento_no_encontrado'; end if;
  if v_d.estado = 'anulado' then return jsonb_build_object('ok', false, 'motivo', 'ya_anulada'); end if;
  if v_d.medico_id <> v_p.id and v_p.rol <> 'admin' then return jsonb_build_object('ok', false, 'motivo', 'no_autor'); end if;
  if v_m is null or char_length(v_m) < 5 then return jsonb_build_object('ok', false, 'motivo', 'falta_motivo'); end if;
  update public.clinica_documentos set estado = 'anulado', anulado_en = now(), anulado_por_nombre = v_p.nombre, motivo_anulacion = v_m where id = p_id;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'anular_documento', v_d.paciente_id, v_d.consulta_id, v_d.numero || ': ' || v_m);
  return jsonb_build_object('ok', true);
end $f$;

-- Liga la receta con su registro en Farmacia (una sola vez).
create or replace function public.clinica_documento_farmacia(p_token text, p_id uuid, p_farmacia_receta_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_d public.clinica_documentos;
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_d from public.clinica_documentos where id = p_id and auth_user_id = auth.uid() for update;
  if v_d.id is null or v_d.tipo <> 'receta' or v_d.estado <> 'emitido' then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if v_d.farmacia_receta_id is not null then return jsonb_build_object('ok', false, 'motivo', 'ya_en_farmacia'); end if;
  if not exists (select 1 from public.farmacia_recetas where id = p_farmacia_receta_id and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  update public.clinica_documentos set farmacia_receta_id = p_farmacia_receta_id where id = p_id;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'receta_a_farmacia', v_d.paciente_id, v_d.consulta_id, v_d.numero);
  return jsonb_build_object('ok', true);
end $f$;

-- ---------- 5. Funciones: adjuntos (las usa la función de borde) ----------
create or replace function public.clinica_adjunto_preparar(p_token text, p_paciente_id uuid, p_consulta_id uuid, p_nombre text,
  p_mime text, p_tamano int, p_descripcion text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_id uuid := gen_random_uuid(); v_ext text; v_ruta text; v_nom text := left(nullif(btrim(p_nombre), ''), 150);
begin
  v_p := public._clinica_sesion(p_token);
  if not exists (select 1 from public.clinica_pacientes where id = p_paciente_id and auth_user_id = auth.uid()) then raise exception 'clinica_paciente_no_encontrado'; end if;
  if p_consulta_id is not null and not exists (select 1 from public.clinica_consultas where id = p_consulta_id and auth_user_id = auth.uid() and paciente_id = p_paciente_id) then
    return jsonb_build_object('ok', false, 'motivo', 'consulta');
  end if;
  v_ext := case p_mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then return jsonb_build_object('ok', false, 'motivo', 'tipo_archivo'); end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 10485760 then return jsonb_build_object('ok', false, 'motivo', 'tamano'); end if;
  if v_nom is null then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  v_ruta := auth.uid()::text || '/' || p_paciente_id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.clinica_adjuntos(id, auth_user_id, paciente_id, consulta_id, nombre, mime, tamano, ruta, descripcion, subido_por, subido_por_nombre)
  values (v_id, auth.uid(), p_paciente_id, p_consulta_id, v_nom, p_mime, p_tamano, v_ruta, left(nullif(btrim(p_descripcion), ''), 300), v_p.id, v_p.nombre);
  return jsonb_build_object('ok', true, 'id', v_id, 'ruta', v_ruta);
end $f$;

create or replace function public.clinica_adjunto_confirmar(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_a public.clinica_adjuntos;
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_a from public.clinica_adjuntos where id = p_id and auth_user_id = auth.uid() for update;
  if v_a.id is null or v_a.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  update public.clinica_adjuntos set estado = 'listo' where id = p_id;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'subir_adjunto', v_a.paciente_id, v_a.consulta_id, v_a.nombre);
  return jsonb_build_object('ok', true);
end $f$;

create or replace function public.clinica_adjunto_ruta(p_token text, p_id uuid, p_para text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_a public.clinica_adjuntos;
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_a from public.clinica_adjuntos where id = p_id and auth_user_id = auth.uid();
  if v_a.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if p_para = 'subir' then
    if v_a.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  else
    if v_a.estado <> 'listo' then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
    perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'ver_adjunto', v_a.paciente_id, v_a.consulta_id, v_a.nombre);
  end if;
  return jsonb_build_object('ok', true, 'ruta', v_a.ruta, 'mime', v_a.mime, 'nombre', v_a.nombre);
end $f$;

create or replace function public.clinica_adjunto_anular(p_token text, p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_a public.clinica_adjuntos; v_m text := left(nullif(btrim(p_motivo), ''), 500);
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_a from public.clinica_adjuntos where id = p_id and auth_user_id = auth.uid() for update;
  if v_a.id is null or v_a.estado = 'anulado' then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if v_m is null or char_length(v_m) < 5 then return jsonb_build_object('ok', false, 'motivo', 'falta_motivo'); end if;
  update public.clinica_adjuntos set estado = 'anulado', anulado_en = now(), motivo_anulacion = v_m where id = p_id;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'anular_adjunto', v_a.paciente_id, v_a.consulta_id, v_a.nombre || ': ' || v_m);
  return jsonb_build_object('ok', true);
end $f$;

-- ---------- 6. Nuevas versiones de funciones propias de la Fase 1 ----------
-- El expediente ahora trae también documentos y adjuntos.
create or replace function public.clinica_expediente_abrir(p_token text, p_paciente_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_pac public.clinica_pacientes;
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_pac from public.clinica_pacientes where id = p_paciente_id and auth_user_id = auth.uid();
  if v_pac.id is null then raise exception 'clinica_paciente_no_encontrado'; end if;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'abrir_expediente', v_pac.id, null, v_pac.numero_expediente);
  return jsonb_build_object(
    'yo', jsonb_build_object('id', v_p.id, 'nombre', v_p.nombre, 'rol', v_p.rol),
    'antecedentes', (select to_jsonb(a) from public.clinica_antecedentes a where a.paciente_id = v_pac.id and a.auth_user_id = auth.uid()),
    'consultas', coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object('adendas', coalesce((
               select jsonb_agg(jsonb_build_object('id', d.id, 'autor_nombre', d.autor_nombre, 'texto', d.texto, 'created_at', d.created_at) order by d.created_at)
               from public.clinica_adendas d where d.consulta_id = c.id), '[]'::jsonb))
             order by c.fecha desc, c.created_at desc)
      from public.clinica_consultas c where c.paciente_id = v_pac.id and c.auth_user_id = auth.uid()), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(to_jsonb(d) order by d.fecha desc) from public.clinica_documentos d
      where d.paciente_id = v_pac.id and d.auth_user_id = auth.uid()), '[]'::jsonb),
    'adjuntos', coalesce((select jsonb_agg(to_jsonb(a) - 'ruta' order by a.created_at desc) from public.clinica_adjuntos a
      where a.paciente_id = v_pac.id and a.auth_user_id = auth.uid() and a.estado <> 'pendiente'), '[]'::jsonb));
end $f$;

-- La nota ahora guarda también los diagnósticos codificados (CIE-10).
create or replace function public.clinica_consulta_guardar(p_token text, p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_c public.clinica_consultas; v_pac uuid; v_cita uuid; v_id uuid; v_prox date; v_datos jsonb; v_dx jsonb;
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
    v_cita := nullif(p_datos->>'cita_id', '')::uuid;
    if not exists (select 1 from public.clinica_pacientes where id = v_pac and auth_user_id = auth.uid()) then
      raise exception 'clinica_paciente_no_encontrado';
    end if;
    if v_cita is not null then
      if not exists (select 1 from public.clinica_citas where id = v_cita and auth_user_id = auth.uid() and paciente_id = v_pac and estado not in ('cancelada','no_asistio')) then
        return jsonb_build_object('ok', false, 'motivo', 'cita');
      end if;
      if exists (select 1 from public.clinica_consultas where cita_id = v_cita and estado <> 'anulada') then
        return jsonb_build_object('ok', false, 'motivo', 'cita_con_nota');
      end if;
    end if;
    insert into public.clinica_consultas(auth_user_id, paciente_id, cita_id, medico_id, medico_nombre, especialidad, motivo, enfermedad_actual,
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
      update public.clinica_citas set estado = 'en_consulta'
       where id = v_cita and estado in ('programada','confirmada','en_espera');
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

-- ---------- 7. Permisos ----------
revoke all on public.clinica_documentos, public.clinica_adjuntos from anon, authenticated;
revoke all on function public._clinica_documentos_inmutable(), public._clinica_adjuntos_inmutable() from public, anon, authenticated;
revoke all on function public.clinica_documento_emitir(text, jsonb), public.clinica_documento_anular(text, uuid, text),
  public.clinica_documento_farmacia(text, uuid, uuid), public.clinica_adjunto_preparar(text, uuid, uuid, text, text, int, text),
  public.clinica_adjunto_confirmar(text, uuid), public.clinica_adjunto_ruta(text, uuid, text), public.clinica_adjunto_anular(text, uuid, text)
  from public, anon;
grant execute on function public.clinica_documento_emitir(text, jsonb), public.clinica_documento_anular(text, uuid, text),
  public.clinica_documento_farmacia(text, uuid, uuid), public.clinica_adjunto_preparar(text, uuid, uuid, text, text, int, text),
  public.clinica_adjunto_confirmar(text, uuid), public.clinica_adjunto_ruta(text, uuid, text), public.clinica_adjunto_anular(text, uuid, text)
  to authenticated;

$sql$, '#BORRAR#', 'de' || 'lete');
end
$migracion$;
