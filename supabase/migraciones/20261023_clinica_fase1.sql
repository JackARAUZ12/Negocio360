-- =====================================================================
-- MÓDULO CLÍNICA — FASE 1 (base para atender y cobrar)
-- ---------------------------------------------------------------------
-- SOLO AGREGA: dos columnas nuevas en configuracion_empresa (apagadas por
-- defecto) y tablas/funciones nuevas con prefijo clinica_. No modifica ni
-- borra nada existente.
--
-- CANDADO EN EL SERVIDOR PARA EL CONTENIDO CLÍNICO (decisión de diseño)
--   Todo el personal de un negocio entra con el MISMO usuario de Supabase
--   (los perfiles multiusuario se eligen después, en pantalla). Por eso un
--   permiso de RLS "auth_user_id = auth.uid()" NO alcanza para proteger el
--   expediente: la recepcionista o el cajero tienen ese mismo auth.uid().
--   Solución:
--   * Las tablas con contenido clínico (antecedentes, consultas, adendas,
--     bitácora) tienen RLS activado y NINGUNA política: nadie las puede leer
--     ni escribir directo desde el navegador.
--   * Solo se accede con funciones SECURITY DEFINER que exigen una "sesión
--     clínica": un token aleatorio que el servidor entrega tras verificar el
--     PIN personal del médico/administrador clínico (guardado con bcrypt en
--     una tabla sin acceso), con bloqueo tras intentos fallidos, vencimiento
--     por inactividad (30 min) y vencimiento absoluto (12 h). En la base solo
--     se guarda el hash SHA-256 del token.
--   * Cada apertura de expediente y cada acción clínica queda en la
--     bitácora (quién, qué, cuándo), que no se puede editar ni borrar.
--   * Nota cerrada = firmada (hash del contenido) e inmutable por trigger;
--     solo admite adendas fechadas o la anulación con motivo. Nada clínico se
--     borra.
--   * Agenda, pacientes (datos generales), consultorios y cuenta de la visita
--     son datos administrativos: RLS normal del negocio (recepción los usa).
--   * Administrar al personal clínico exige el código de administrador de
--     la cuenta (verificado en el servidor, con su bloqueo de siempre) o una
--     sesión clínica de rol "admin".
--
-- La herramienta SQL se cuelga con ciertas palabras literales, por eso el
-- script se ejecuta dentro de EXECUTE con el marcador #BORRAR#.
-- =====================================================================
do $migracion$
begin
execute replace($sql$

-- ---------- 1. Interruptor y especialidades (apagado para todos) ----------
alter table public.configuracion_empresa add column if not exists usa_modulo_clinica boolean not null default false;
alter table public.configuracion_empresa add column if not exists clinica_especialidades text[] not null default '{}'::text[];

-- ---------- 2. Consultorios ----------
create table if not exists public.clinica_consultorios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 60),
  descripcion text check (descripcion is null or char_length(descripcion) <= 200),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists clinica_consultorios_uid on public.clinica_consultorios(auth_user_id);
alter table public.clinica_consultorios enable row level security;
create policy clinica_consultorios_own on public.clinica_consultorios for all to authenticated
  using (auth_user_id = (select auth.uid())) with check (auth_user_id = (select auth.uid()));

-- ---------- 3. Personal clínico (solo lectura directa; se escribe por función) ----------
create table if not exists public.clinica_personal (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  rol text not null check (rol in ('medico','recepcion','admin')),
  atiende boolean not null default false,
  especialidad text check (especialidad is null or char_length(especialidad) <= 60),
  registro_profesional text check (registro_profesional is null or char_length(registro_profesional) <= 40),
  telefono text check (telefono is null or char_length(telefono) <= 30),
  consultorio_id uuid references public.clinica_consultorios(id) on #BORRAR# set null,
  pin_configurado boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinica_personal_uid on public.clinica_personal(auth_user_id);
alter table public.clinica_personal enable row level security;
create policy clinica_personal_ver on public.clinica_personal for select to authenticated
  using (auth_user_id = (select auth.uid()));

create table if not exists public.clinica_personal_secretos (
  personal_id uuid primary key references public.clinica_personal(id) on #BORRAR# cascade,
  pin_hash text not null,
  fallos int not null default 0,
  bloqueado_hasta timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.clinica_personal_secretos enable row level security;

create table if not exists public.clinica_sesiones (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  personal_id uuid not null references public.clinica_personal(id) on #BORRAR# cascade,
  token_hash text not null unique,
  creada_en timestamptz not null default now(),
  expira_en timestamptz not null,
  ultimo_uso timestamptz not null default now(),
  cerrada_en timestamptz
);
create index if not exists clinica_sesiones_personal on public.clinica_sesiones(personal_id);
alter table public.clinica_sesiones enable row level security;

-- ---------- 4. Pacientes (datos generales: administrativos) ----------
create table if not exists public.clinica_pacientes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  numero_expediente text,
  cliente_id uuid references public.clientes(id) on #BORRAR# set null,
  nombres text not null check (char_length(btrim(nombres)) between 1 and 80),
  apellidos text check (apellidos is null or char_length(apellidos) <= 80),
  cedula text check (cedula is null or char_length(cedula) <= 30),
  fecha_nacimiento date,
  sexo text check (sexo is null or sexo in ('femenino','masculino')),
  telefono text check (telefono is null or char_length(telefono) <= 30),
  email text check (email is null or char_length(email) <= 120),
  direccion text check (direccion is null or char_length(direccion) <= 200),
  ocupacion text check (ocupacion is null or char_length(ocupacion) <= 80),
  contacto_emergencia_nombre text check (contacto_emergencia_nombre is null or char_length(contacto_emergencia_nombre) <= 80),
  contacto_emergencia_telefono text check (contacto_emergencia_telefono is null or char_length(contacto_emergencia_telefono) <= 30),
  contacto_emergencia_parentesco text check (contacto_emergencia_parentesco is null or char_length(contacto_emergencia_parentesco) <= 40),
  notas text check (notas is null or char_length(notas) <= 500),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinica_pacientes_uid on public.clinica_pacientes(auth_user_id);
create unique index if not exists clinica_pacientes_expediente on public.clinica_pacientes(auth_user_id, numero_expediente);
create unique index if not exists clinica_pacientes_cedula on public.clinica_pacientes(auth_user_id, upper(regexp_replace(cedula, '[^0-9A-Za-z]', '', 'g')))
  where cedula is not null and btrim(cedula) <> '';
alter table public.clinica_pacientes enable row level security;
create policy clinica_pacientes_ver on public.clinica_pacientes for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy clinica_pacientes_crear on public.clinica_pacientes for insert to authenticated
  with check (auth_user_id = (select auth.uid())
    and (cliente_id is null or exists (select 1 from public.clientes c where c.id = cliente_id and c.auth_user_id = (select auth.uid()))));
create policy clinica_pacientes_editar on public.clinica_pacientes for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and (cliente_id is null or exists (select 1 from public.clientes c where c.id = cliente_id and c.auth_user_id = (select auth.uid()))));
-- Borrar solo se logra si el paciente NO tiene citas ni historia (las llaves lo impiden).
create policy clinica_pacientes_borrar on public.clinica_pacientes for #BORRAR# to authenticated
  using (auth_user_id = (select auth.uid()));

create or replace function public._clinica_pacientes_antes() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_n int;
begin
  if new.fecha_nacimiento is not null and (new.fecha_nacimiento > current_date or new.fecha_nacimiento < date '1900-01-01') then
    raise exception 'clinica_fecha_nacimiento_invalida' using hint = 'La fecha de nacimiento no puede ser futura ni anterior a 1900.';
  end if;
  new.nombres := btrim(new.nombres);
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('clinica_exp:' || new.auth_user_id::text));
    select coalesce(max(substring(numero_expediente from '^EXP-([0-9]+)$')::int), 0) + 1 into v_n
      from public.clinica_pacientes where auth_user_id = new.auth_user_id;
    new.numero_expediente := 'EXP-' || lpad(v_n::text, 6, '0');
  else
    new.numero_expediente := old.numero_expediente;      -- el número de expediente no cambia nunca
    new.auth_user_id := old.auth_user_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $f$;
create trigger clinica_pacientes_antes before insert or update on public.clinica_pacientes
  for each row execute function public._clinica_pacientes_antes();

-- ---------- 5. Antecedentes / datos clínicos fijos (SIN acceso directo) ----------
create table if not exists public.clinica_antecedentes (
  paciente_id uuid primary key references public.clinica_pacientes(id),
  auth_user_id uuid not null,
  tipo_sangre text check (tipo_sangre is null or tipo_sangre in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  alergias text check (alergias is null or char_length(alergias) <= 1000),
  sin_alergias boolean not null default false,
  personales text check (personales is null or char_length(personales) <= 4000),
  quirurgicos text check (quirurgicos is null or char_length(quirurgicos) <= 4000),
  familiares text check (familiares is null or char_length(familiares) <= 4000),
  gineco_obstetricos text check (gineco_obstetricos is null or char_length(gineco_obstetricos) <= 4000),
  habitos text check (habitos is null or char_length(habitos) <= 4000),
  medicamentos_actuales text check (medicamentos_actuales is null or char_length(medicamentos_actuales) <= 4000),
  inmunizaciones text check (inmunizaciones is null or char_length(inmunizaciones) <= 4000),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  actualizado_por_nombre text
);
alter table public.clinica_antecedentes enable row level security;

create table if not exists public.clinica_antecedentes_historial (
  id bigint generated always as identity primary key,
  paciente_id uuid not null,
  auth_user_id uuid not null,
  datos jsonb not null,
  reemplazado_en timestamptz not null default now()
);
create index if not exists clinica_antecedentes_historial_pac on public.clinica_antecedentes_historial(paciente_id);
alter table public.clinica_antecedentes_historial enable row level security;

-- ---------- 6. Agenda (administrativa) ----------
create table if not exists public.clinica_citas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  paciente_id uuid not null references public.clinica_pacientes(id),
  medico_id uuid references public.clinica_personal(id) on #BORRAR# set null,
  consultorio_id uuid references public.clinica_consultorios(id) on #BORRAR# set null,
  fecha date not null,
  hora time not null,
  duracion_min int not null default 30 check (duracion_min between 5 and 480),
  tipo text not null default 'consulta' check (tipo in ('primera_vez','consulta','control','procedimiento','urgencia','otro')),
  especialidad text check (especialidad is null or char_length(especialidad) <= 40),
  motivo text check (motivo is null or char_length(motivo) <= 200),
  notas text check (notas is null or char_length(notas) <= 500),
  estado text not null default 'programada' check (estado in ('programada','confirmada','en_espera','en_consulta','atendida','no_asistio','cancelada')),
  llegada_en timestamptz,
  atendida_en timestamptz,
  motivo_cancelacion text check (motivo_cancelacion is null or char_length(motivo_cancelacion) <= 200),
  venta_id uuid references public.ventas(id) on #BORRAR# set null,
  recordatorio_enviado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinica_citas_fecha on public.clinica_citas(auth_user_id, fecha);
create index if not exists clinica_citas_paciente on public.clinica_citas(paciente_id);
alter table public.clinica_citas enable row level security;
create policy clinica_citas_ver on public.clinica_citas for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy clinica_citas_crear on public.clinica_citas for insert to authenticated
  with check (auth_user_id = (select auth.uid())
    and exists (select 1 from public.clinica_pacientes p where p.id = paciente_id and p.auth_user_id = (select auth.uid()))
    and (medico_id is null or exists (select 1 from public.clinica_personal m where m.id = medico_id and m.auth_user_id = (select auth.uid())))
    and (consultorio_id is null or exists (select 1 from public.clinica_consultorios k where k.id = consultorio_id and k.auth_user_id = (select auth.uid())))
    and (venta_id is null or exists (select 1 from public.ventas v where v.id = venta_id and v.auth_user_id = (select auth.uid()))));
create policy clinica_citas_editar on public.clinica_citas for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and exists (select 1 from public.clinica_pacientes p where p.id = paciente_id and p.auth_user_id = (select auth.uid()))
    and (medico_id is null or exists (select 1 from public.clinica_personal m where m.id = medico_id and m.auth_user_id = (select auth.uid())))
    and (consultorio_id is null or exists (select 1 from public.clinica_consultorios k where k.id = consultorio_id and k.auth_user_id = (select auth.uid())))
    and (venta_id is null or exists (select 1 from public.ventas v where v.id = venta_id and v.auth_user_id = (select auth.uid()))));
-- Las citas no se borran: se cancelan (con motivo) para que quede el historial.

-- ---------- 7. Notas clínicas (SIN acceso directo) ----------
create table if not exists public.clinica_consultas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  paciente_id uuid not null references public.clinica_pacientes(id),
  cita_id uuid references public.clinica_citas(id),
  medico_id uuid not null references public.clinica_personal(id),
  medico_nombre text not null,
  fecha timestamptz not null default now(),
  especialidad text not null default 'medicina_general' check (char_length(especialidad) <= 40),
  motivo text not null check (char_length(btrim(motivo)) between 1 and 500),
  enfermedad_actual text check (enfermedad_actual is null or char_length(enfermedad_actual) <= 8000),
  pa_sistolica int check (pa_sistolica is null or pa_sistolica between 40 and 300),
  pa_diastolica int check (pa_diastolica is null or pa_diastolica between 20 and 200),
  fc int check (fc is null or fc between 20 and 300),
  fr int check (fr is null or fr between 4 and 80),
  temperatura numeric(4,1) check (temperatura is null or temperatura between 30 and 45),
  spo2 int check (spo2 is null or spo2 between 40 and 100),
  peso_kg numeric(6,2) check (peso_kg is null or peso_kg between 0.2 and 400),
  talla_cm numeric(5,1) check (talla_cm is null or talla_cm between 20 and 250),
  imc numeric(5,2),
  glucosa_mg_dl numeric(6,1) check (glucosa_mg_dl is null or glucosa_mg_dl between 10 and 1500),
  examen_fisico text check (examen_fisico is null or char_length(examen_fisico) <= 8000),
  diagnostico text check (diagnostico is null or char_length(diagnostico) <= 4000),
  plan text check (plan is null or char_length(plan) <= 8000),
  indicaciones text check (indicaciones is null or char_length(indicaciones) <= 4000),
  proximo_control date,
  datos jsonb not null default '{}'::jsonb check (jsonb_typeof(datos) = 'object' and octet_length(datos::text) <= 50000),
  estado text not null default 'borrador' check (estado in ('borrador','cerrada','anulada')),
  cerrada_en timestamptz,
  firma_hash text,
  anulada_en timestamptz,
  anulada_por_nombre text,
  motivo_anulacion text check (motivo_anulacion is null or char_length(motivo_anulacion) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinica_consultas_paciente on public.clinica_consultas(paciente_id, fecha desc);
create unique index if not exists clinica_consultas_una_por_cita on public.clinica_consultas(cita_id)
  where cita_id is not null and estado <> 'anulada';
alter table public.clinica_consultas enable row level security;

create table if not exists public.clinica_adendas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  consulta_id uuid not null references public.clinica_consultas(id),
  autor_id uuid not null references public.clinica_personal(id),
  autor_nombre text not null,
  texto text not null check (char_length(btrim(texto)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists clinica_adendas_consulta on public.clinica_adendas(consulta_id);
alter table public.clinica_adendas enable row level security;

create table if not exists public.clinica_bitacora (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null,
  personal_id uuid,
  personal_nombre text,
  rol text,
  accion text not null,
  paciente_id uuid,
  consulta_id uuid,
  detalle text,
  created_at timestamptz not null default now()
);
create index if not exists clinica_bitacora_uid on public.clinica_bitacora(auth_user_id, created_at desc);
alter table public.clinica_bitacora enable row level security;

-- ---------- 8. Cuenta de la visita (cargos que se cobran en Ventas) ----------
create table if not exists public.clinica_cargos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  cita_id uuid not null references public.clinica_citas(id),
  producto_id uuid references public.productos(id) on #BORRAR# set null,
  descripcion text not null check (char_length(btrim(descripcion)) between 1 and 200),
  cantidad numeric not null check (cantidad > 0 and cantidad <= 100000),
  created_at timestamptz not null default now()
);
create index if not exists clinica_cargos_cita on public.clinica_cargos(cita_id);
alter table public.clinica_cargos enable row level security;
create policy clinica_cargos_own on public.clinica_cargos for all to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and exists (select 1 from public.clinica_citas c where c.id = cita_id and c.auth_user_id = (select auth.uid()))
    and (producto_id is null or exists (select 1 from public.productos p where p.id = producto_id and p.auth_user_id = (select auth.uid()))));

-- Una visita ya cobrada (venta completada) no cambia su cuenta: evita descuadres.
create or replace function public._clinica_cargos_guardia() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_cita uuid := case when tg_op = upper('#BORRAR#') then old.cita_id else new.cita_id end;
begin
  if exists (select 1 from public.clinica_citas c join public.ventas v on v.id = c.venta_id
             where c.id = v_cita and v.estado = 'completada') then
    raise exception 'clinica_cita_cobrada' using hint = 'Esta visita ya fue cobrada: su cuenta no se puede cambiar.';
  end if;
  if tg_op = 'UPDATE' and new.cita_id <> old.cita_id then raise exception 'clinica_cita_inmutable'; end if;
  if tg_op = upper('#BORRAR#') then return old; end if;
  return new;
end $f$;
create trigger clinica_cargos_guardia before insert or update or #BORRAR# on public.clinica_cargos
  for each row execute function public._clinica_cargos_guardia();

-- Choques de horario del mismo médico (también en el servidor: dos recepcionistas a la vez).
create or replace function public._clinica_citas_antes() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_choque record; v_ini int;
begin
  if tg_op = 'UPDATE' then
    new.auth_user_id := old.auth_user_id; new.created_at := old.created_at; new.updated_at := now();
    if new.paciente_id <> old.paciente_id and exists (select 1 from public.clinica_consultas k where k.cita_id = old.id) then
      raise exception 'clinica_cita_con_consulta' using hint = 'La cita ya tiene una consulta: no se puede cambiar de paciente.';
    end if;
  end if;
  v_ini := (extract(epoch from new.hora) / 60)::int;
  if v_ini + new.duracion_min > 1440 then
    raise exception 'clinica_cita_pasa_medianoche' using hint = 'La cita debe terminar antes de la medianoche.';
  end if;
  if new.medico_id is not null and new.estado not in ('cancelada','no_asistio') then
    perform pg_advisory_xact_lock(hashtext('clinica_cita:' || new.medico_id::text || ':' || new.fecha::text));
    select c.hora, c.duracion_min into v_choque from public.clinica_citas c
     where c.medico_id = new.medico_id and c.fecha = new.fecha and c.id <> new.id
       and c.estado not in ('cancelada','no_asistio')
       and (extract(epoch from c.hora) / 60)::int < v_ini + new.duracion_min
       and v_ini < (extract(epoch from c.hora) / 60)::int + c.duracion_min
     limit 1;
    if found then
      raise exception 'clinica_choque_horario' using hint = 'Ese médico ya tiene una cita a las ' || to_char(v_choque.hora, 'HH24:MI') || '.';
    end if;
  end if;
  return new;
end $f$;
create trigger clinica_citas_antes before insert or update on public.clinica_citas
  for each row execute function public._clinica_citas_antes();

-- ---------- 9. Inmutabilidad (nada clínico se edita al cerrarse ni se borra) ----------
create or replace function public._clinica_mantenimiento() returns boolean
language sql stable set search_path = public as $f$
  select auth.uid() is null and coalesce(current_setting('n360.clinica_mantenimiento', true), '') = 'on'
$f$;

create or replace function public._clinica_consultas_inmutable() returns trigger
language plpgsql set search_path = public as $f$
declare v_libres text[] := array['estado','anulada_en','anulada_por_nombre','motivo_anulacion','updated_at'];
begin
  if tg_op = upper('#BORRAR#') then
    if public._clinica_mantenimiento() then return old; end if;
    raise exception 'clinica_no_se_borra' using hint = 'Las notas clínicas no se borran: anúlalas con un motivo.';
  end if;
  new.id := old.id; new.auth_user_id := old.auth_user_id; new.paciente_id := old.paciente_id;
  new.medico_id := old.medico_id; new.medico_nombre := old.medico_nombre; new.created_at := old.created_at;
  if old.estado = 'anulada' then raise exception 'clinica_nota_anulada'; end if;
  if old.estado = 'cerrada' then
    if new.estado <> 'anulada' or (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
      raise exception 'clinica_nota_cerrada' using hint = 'Una nota cerrada no se modifica: agrega una adenda.';
    end if;
  end if;
  if new.peso_kg is not null and new.talla_cm is not null and old.estado = 'borrador' then
    new.imc := round(new.peso_kg / ((new.talla_cm / 100.0) ^ 2), 2);
  elsif old.estado = 'borrador' then
    new.imc := null;
  end if;
  new.updated_at := now();
  return new;
end $f$;
create trigger clinica_consultas_inmutable before update or #BORRAR# on public.clinica_consultas
  for each row execute function public._clinica_consultas_inmutable();

create or replace function public._clinica_consultas_imc() returns trigger
language plpgsql set search_path = public as $f$
begin
  new.imc := case when new.peso_kg is not null and new.talla_cm is not null
                  then round(new.peso_kg / ((new.talla_cm / 100.0) ^ 2), 2) end;
  if new.estado <> 'borrador' then raise exception 'clinica_nota_nueva_borrador'; end if;
  return new;
end $f$;
create trigger clinica_consultas_imc before insert on public.clinica_consultas
  for each row execute function public._clinica_consultas_imc();

create or replace function public._clinica_solo_agregar() returns trigger
language plpgsql set search_path = public as $f$
begin
  if tg_op = upper('#BORRAR#') and public._clinica_mantenimiento() then return old; end if;
  raise exception 'clinica_solo_agregar' using hint = 'Este registro clínico no se puede cambiar ni borrar.';
end $f$;
create trigger clinica_adendas_fijas before update or #BORRAR# on public.clinica_adendas
  for each row execute function public._clinica_solo_agregar();
create trigger clinica_bitacora_fija before update or #BORRAR# on public.clinica_bitacora
  for each row execute function public._clinica_solo_agregar();
create trigger clinica_ant_hist_fijo before update or #BORRAR# on public.clinica_antecedentes_historial
  for each row execute function public._clinica_solo_agregar();

create or replace function public._clinica_antecedentes_historia() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if tg_op = upper('#BORRAR#') then
    if public._clinica_mantenimiento() then return old; end if;
    raise exception 'clinica_no_se_borra';
  end if;
  new.paciente_id := old.paciente_id; new.auth_user_id := old.auth_user_id;
  insert into public.clinica_antecedentes_historial(paciente_id, auth_user_id, datos) values (old.paciente_id, old.auth_user_id, to_jsonb(old));
  return new;
end $f$;
create trigger clinica_antecedentes_historia before update or #BORRAR# on public.clinica_antecedentes
  for each row execute function public._clinica_antecedentes_historia();

-- ---------- 10. Funciones internas (no ejecutables desde el navegador) ----------
create or replace function public._clinica_hash_token(p text) returns text
language sql immutable set search_path = public, extensions as $f$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$f$;

create or replace function public._clinica_log(p_uid uuid, p_personal uuid, p_nombre text, p_rol text, p_accion text,
  p_paciente uuid, p_consulta uuid, p_detalle text) returns void
language sql security definer set search_path = public as $f$
  insert into public.clinica_bitacora(auth_user_id, personal_id, personal_nombre, rol, accion, paciente_id, consulta_id, detalle)
  values (p_uid, p_personal, p_nombre, p_rol, p_accion, p_paciente, p_consulta, left(p_detalle, 500));
$f$;

-- Valida el token de la sesión clínica y devuelve a la persona. Sin sesión válida: error.
create or replace function public._clinica_sesion(p_token text) returns public.clinica_personal
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
   where id = v_s.personal_id and auth_user_id = auth.uid() and activo and rol in ('medico','admin');
  if v_p.id is null then raise exception 'clinica_sesion_invalida'; end if;
  update public.clinica_sesiones set ultimo_uso = now() where id = v_s.id;
  return v_p;
end $f$;

-- Autoriza tareas de administración clínica: sesión clínica de rol admin, o el código de
-- administrador de la cuenta (verificado en el servidor con su bloqueo por intentos).
create or replace function public._clinica_autorizar_admin(p_auth jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_r jsonb;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if coalesce(p_auth->>'token', '') <> '' then
    begin
      v_p := public._clinica_sesion(p_auth->>'token');
      if v_p.rol = 'admin' then
        return jsonb_build_object('ok', true, 'personal_id', v_p.id, 'nombre', v_p.nombre, 'rol', 'admin');
      end if;
    exception when others then null;
    end;
  end if;
  if coalesce(p_auth->>'admin_pin', '') <> '' then
    v_r := public._admin_verificar(public._auth_id_central_del_grupo(), p_auth->>'admin_pin', null, 'clinica');
    if coalesce((v_r->>'ok')::boolean, false) then
      return jsonb_build_object('ok', true, 'personal_id', null, 'nombre', coalesce(v_r->>'nombre', 'Administrador') || ' (código de administrador)', 'rol', 'admin');
    end if;
    return v_r;
  end if;
  return jsonb_build_object('ok', false, 'motivo', 'sin_permiso');
end $f$;

create or replace function public._clinica_txt(p jsonb, k text, maxlen int) returns text
language sql immutable as $f$
  select left(nullif(btrim(p->>k), ''), maxlen)
$f$;

-- ---------- 11. Funciones públicas (solo usuarios autenticados) ----------

-- Crear / editar personal clínico (y su PIN). Exige autorización de administrador.
create or replace function public.clinica_personal_guardar(p_auth jsonb, p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_a jsonb; v_id uuid; v_rol text; v_pin text; v_cons uuid; v_old public.clinica_personal; v_nombre text;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  v_a := public._clinica_autorizar_admin(p_auth);
  if not coalesce((v_a->>'ok')::boolean, false) then return v_a; end if;
  v_nombre := public._clinica_txt(p_datos, 'nombre', 80);
  v_rol := p_datos->>'rol';
  v_pin := nullif(btrim(coalesce(p_datos->>'pin', '')), '');
  v_cons := nullif(p_datos->>'consultorio_id', '')::uuid;
  if v_nombre is null then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_rol is null or v_rol not in ('medico','recepcion','admin') then return jsonb_build_object('ok', false, 'motivo', 'rol'); end if;
  if v_pin is not null and v_pin !~ '^[0-9]{4,8}$' then return jsonb_build_object('ok', false, 'motivo', 'pin_formato'); end if;
  if v_cons is not null and not exists (select 1 from public.clinica_consultorios where id = v_cons and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'consultorio');
  end if;
  if p_id is null then
    if v_rol in ('medico','admin') and v_pin is null then return jsonb_build_object('ok', false, 'motivo', 'pin_requerido'); end if;
    insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, telefono, consultorio_id)
    values (auth.uid(), v_nombre, v_rol, coalesce((p_datos->>'atiende')::boolean, v_rol = 'medico'),
            public._clinica_txt(p_datos, 'especialidad', 60), public._clinica_txt(p_datos, 'registro_profesional', 40),
            public._clinica_txt(p_datos, 'telefono', 30), v_cons)
    returning id into v_id;
    perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'personal_creado', null, null, v_nombre || ' (' || v_rol || ')');
  else
    select * into v_old from public.clinica_personal where id = p_id and auth_user_id = auth.uid() for update;
    if v_old.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
    if v_rol in ('medico','admin') and v_pin is null and not v_old.pin_configurado then
      return jsonb_build_object('ok', false, 'motivo', 'pin_requerido');
    end if;
    update public.clinica_personal set nombre = v_nombre, rol = v_rol,
      atiende = coalesce((p_datos->>'atiende')::boolean, atiende),
      especialidad = public._clinica_txt(p_datos, 'especialidad', 60),
      registro_profesional = public._clinica_txt(p_datos, 'registro_profesional', 40),
      telefono = public._clinica_txt(p_datos, 'telefono', 30), consultorio_id = v_cons,
      activo = coalesce((p_datos->>'activo')::boolean, activo), updated_at = now()
    where id = p_id;
    v_id := p_id;
    -- Al desactivar, cambiar el rol o el PIN, se cierran sus sesiones abiertas.
    if v_rol <> v_old.rol or v_pin is not null or coalesce((p_datos->>'activo')::boolean, v_old.activo) = false then
      update public.clinica_sesiones set cerrada_en = now() where personal_id = p_id and cerrada_en is null;
    end if;
    perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'personal_editado', null, null,
      v_nombre || ' (' || v_rol || ')' || case when coalesce((p_datos->>'activo')::boolean, v_old.activo) then '' else ' — desactivado' end);
  end if;
  if v_pin is not null then
    insert into public.clinica_personal_secretos(personal_id, pin_hash) values (v_id, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)))
    on conflict (personal_id) do update set pin_hash = excluded.pin_hash, fallos = 0, bloqueado_hasta = null, updated_at = now();
    update public.clinica_personal set pin_configurado = true where id = v_id;
    perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'pin_definido', null, null, v_nombre);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;

-- Iniciar sesión clínica con el PIN personal. Bloqueo progresivo tras 5 intentos fallidos.
create or replace function public.clinica_iniciar_sesion(p_personal_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_s public.clinica_personal_secretos; v_token text; v_exp timestamptz; v_min int;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  select * into v_p from public.clinica_personal where id = p_personal_id and auth_user_id = auth.uid() and activo;
  if v_p.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if v_p.rol not in ('medico','admin') then return jsonb_build_object('ok', false, 'motivo', 'sin_acceso_clinico'); end if;
  select * into v_s from public.clinica_personal_secretos where personal_id = v_p.id for update;
  if v_s.personal_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_pin'); end if;
  if v_s.bloqueado_hasta is not null and v_s.bloqueado_hasta > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'bloqueado_seg', ceil(extract(epoch from (v_s.bloqueado_hasta - now())))::int);
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' or extensions.crypt(p_pin, v_s.pin_hash) <> v_s.pin_hash then
    update public.clinica_personal_secretos set fallos = fallos + 1, updated_at = now() where personal_id = v_p.id;
    perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'pin_incorrecto', null, null, null);
    if v_s.fallos + 1 >= 5 then
      v_min := least(60, 5 * power(2, floor((v_s.fallos + 1 - 5) / 5.0))::int);
      update public.clinica_personal_secretos set bloqueado_hasta = now() + make_interval(mins => v_min) where personal_id = v_p.id;
      perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'bloqueo', null, null, v_min || ' min');
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'bloqueado_seg', v_min * 60);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'incorrecto', 'restantes', 5 - (v_s.fallos + 1));
  end if;
  update public.clinica_personal_secretos set fallos = 0, bloqueado_hasta = null, updated_at = now() where personal_id = v_p.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + interval '12 hours';
  insert into public.clinica_sesiones(auth_user_id, personal_id, token_hash, expira_en) values (auth.uid(), v_p.id, public._clinica_hash_token(v_token), v_exp);
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'inicio_sesion', null, null, null);
  return jsonb_build_object('ok', true, 'token', v_token, 'expira_en', v_exp, 'personal_id', v_p.id, 'nombre', v_p.nombre, 'rol', v_p.rol);
end $f$;

-- Cambiar el PIN propio sabiendo el actual.
create or replace function public.clinica_cambiar_pin(p_personal_id uuid, p_pin_actual text, p_pin_nuevo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_r jsonb;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if p_pin_nuevo is null or p_pin_nuevo !~ '^[0-9]{4,8}$' then return jsonb_build_object('ok', false, 'motivo', 'pin_formato'); end if;
  v_r := public.clinica_iniciar_sesion(p_personal_id, p_pin_actual);
  if not coalesce((v_r->>'ok')::boolean, false) then return v_r; end if;
  update public.clinica_personal_secretos set pin_hash = extensions.crypt(p_pin_nuevo, extensions.gen_salt('bf', 8)), updated_at = now() where personal_id = p_personal_id;
  update public.clinica_sesiones set cerrada_en = now() where personal_id = p_personal_id and cerrada_en is null;
  perform public._clinica_log(auth.uid(), p_personal_id, v_r->>'nombre', v_r->>'rol', 'pin_cambiado', null, null, null);
  return jsonb_build_object('ok', true);
end $f$;

create or replace function public.clinica_cerrar_sesion(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $f$
declare v_s public.clinica_sesiones; v_n text;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return; end if;
  update public.clinica_sesiones set cerrada_en = now()
   where token_hash = public._clinica_hash_token(p_token) and auth_user_id = auth.uid() and cerrada_en is null
  returning * into v_s;
  if v_s.id is not null then
    select nombre into v_n from public.clinica_personal where id = v_s.personal_id;
    perform public._clinica_log(auth.uid(), v_s.personal_id, v_n, null, 'cierre_sesion', null, null, null);
  end if;
end $f$;

create or replace function public.clinica_sesion_estado(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  begin
    v_p := public._clinica_sesion(p_token);
  exception when others then
    return jsonb_build_object('ok', false);
  end;
  return jsonb_build_object('ok', true, 'personal_id', v_p.id, 'nombre', v_p.nombre, 'rol', v_p.rol);
end $f$;

-- Abrir el expediente clínico completo (queda en la bitácora).
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
      from public.clinica_consultas c where c.paciente_id = v_pac.id and c.auth_user_id = auth.uid()), '[]'::jsonb));
end $f$;

create or replace function public.clinica_antecedentes_guardar(p_token text, p_paciente_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_ts text;
begin
  v_p := public._clinica_sesion(p_token);
  if not exists (select 1 from public.clinica_pacientes where id = p_paciente_id and auth_user_id = auth.uid()) then
    raise exception 'clinica_paciente_no_encontrado';
  end if;
  v_ts := nullif(p_datos->>'tipo_sangre', '');
  insert into public.clinica_antecedentes as a (paciente_id, auth_user_id, tipo_sangre, alergias, sin_alergias, personales, quirurgicos, familiares,
      gineco_obstetricos, habitos, medicamentos_actuales, inmunizaciones, actualizado_en, actualizado_por, actualizado_por_nombre)
  values (p_paciente_id, auth.uid(), v_ts, public._clinica_txt(p_datos, 'alergias', 1000), coalesce((p_datos->>'sin_alergias')::boolean, false),
      public._clinica_txt(p_datos, 'personales', 4000), public._clinica_txt(p_datos, 'quirurgicos', 4000), public._clinica_txt(p_datos, 'familiares', 4000),
      public._clinica_txt(p_datos, 'gineco_obstetricos', 4000), public._clinica_txt(p_datos, 'habitos', 4000),
      public._clinica_txt(p_datos, 'medicamentos_actuales', 4000), public._clinica_txt(p_datos, 'inmunizaciones', 4000), now(), v_p.id, v_p.nombre)
  on conflict (paciente_id) do update set tipo_sangre = excluded.tipo_sangre, alergias = excluded.alergias, sin_alergias = excluded.sin_alergias,
      personales = excluded.personales, quirurgicos = excluded.quirurgicos, familiares = excluded.familiares,
      gineco_obstetricos = excluded.gineco_obstetricos, habitos = excluded.habitos, medicamentos_actuales = excluded.medicamentos_actuales,
      inmunizaciones = excluded.inmunizaciones, actualizado_en = now(), actualizado_por = excluded.actualizado_por,
      actualizado_por_nombre = excluded.actualizado_por_nombre
    where a.auth_user_id = auth.uid();
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'editar_antecedentes', p_paciente_id, null, null);
  return jsonb_build_object('ok', true);
end $f$;

-- Crear o editar una nota en BORRADOR (solo su autor).
create or replace function public.clinica_consulta_guardar(p_token text, p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_c public.clinica_consultas; v_pac uuid; v_cita uuid; v_id uuid; v_prox date; v_datos jsonb;
begin
  v_p := public._clinica_sesion(p_token);
  v_prox := nullif(p_datos->>'proximo_control', '')::date;
  v_datos := coalesce(p_datos->'datos', '{}'::jsonb);
  if jsonb_typeof(v_datos) <> 'object' then v_datos := '{}'::jsonb; end if;
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
      proximo_control, datos)
    values (auth.uid(), v_pac, v_cita, v_p.id, v_p.nombre, coalesce(public._clinica_txt(p_datos, 'especialidad', 40), 'medicina_general'),
      public._clinica_txt(p_datos, 'motivo', 500), public._clinica_txt(p_datos, 'enfermedad_actual', 8000),
      nullif(p_datos->>'pa_sistolica', '')::int, nullif(p_datos->>'pa_diastolica', '')::int, nullif(p_datos->>'fc', '')::int,
      nullif(p_datos->>'fr', '')::int, nullif(p_datos->>'temperatura', '')::numeric, nullif(p_datos->>'spo2', '')::int,
      nullif(p_datos->>'peso_kg', '')::numeric, nullif(p_datos->>'talla_cm', '')::numeric, nullif(p_datos->>'glucosa_mg_dl', '')::numeric,
      public._clinica_txt(p_datos, 'examen_fisico', 8000), public._clinica_txt(p_datos, 'diagnostico', 4000),
      public._clinica_txt(p_datos, 'plan', 8000), public._clinica_txt(p_datos, 'indicaciones', 4000), v_prox, v_datos)
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
    indicaciones = public._clinica_txt(p_datos, 'indicaciones', 4000), proximo_control = v_prox, datos = v_datos
  where id = p_id;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'editar_borrador', v_c.paciente_id, p_id, null);
  return jsonb_build_object('ok', true, 'id', p_id);
end $f$;

-- Cerrar y firmar la nota (solo su autor). Después ya no se puede modificar.
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
  if v_c.cita_id is not null then
    update public.clinica_citas set estado = 'atendida', atendida_en = coalesce(atendida_en, v_ahora)
     where id = v_c.cita_id and estado not in ('cancelada','no_asistio');
  end if;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'cerrar_nota', v_c.paciente_id, p_id, left(v_firma, 12));
  return jsonb_build_object('ok', true, 'firma', v_firma);
end $f$;

create or replace function public.clinica_consulta_adenda(p_token text, p_id uuid, p_texto text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_c public.clinica_consultas; v_t text := left(nullif(btrim(p_texto), ''), 4000);
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_c from public.clinica_consultas where id = p_id and auth_user_id = auth.uid();
  if v_c.id is null then raise exception 'clinica_nota_no_encontrada'; end if;
  if v_c.estado <> 'cerrada' then return jsonb_build_object('ok', false, 'motivo', 'no_cerrada'); end if;
  if v_t is null then return jsonb_build_object('ok', false, 'motivo', 'texto'); end if;
  insert into public.clinica_adendas(auth_user_id, consulta_id, autor_id, autor_nombre, texto) values (auth.uid(), p_id, v_p.id, v_p.nombre, v_t);
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'adenda', v_c.paciente_id, p_id, null);
  return jsonb_build_object('ok', true);
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
  if v_c.cita_id is not null then
    update public.clinica_citas set estado = 'en_espera' where id = v_c.cita_id and estado = 'en_consulta';
  end if;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'anular_nota', v_c.paciente_id, p_id, v_m);
  return jsonb_build_object('ok', true);
end $f$;

-- Alergias de varios pacientes a la vez (alerta en la agenda; requiere sesión clínica).
create or replace function public.clinica_alergias(p_token text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal;
begin
  v_p := public._clinica_sesion(p_token);
  return coalesce((select jsonb_object_agg(a.paciente_id, a.alergias) from public.clinica_antecedentes a
     where a.auth_user_id = auth.uid() and a.paciente_id = any(p_ids[1:300]) and coalesce(btrim(a.alergias), '') <> ''), '{}'::jsonb);
end $f$;

-- Bitácora de acceso (solo administración).
create or replace function public.clinica_bitacora_ver(p_auth jsonb, p_desde date, p_hasta date, p_paciente_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_a jsonb;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  v_a := public._clinica_autorizar_admin(p_auth);
  if not coalesce((v_a->>'ok')::boolean, false) then return v_a; end if;
  perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'ver_bitacora', p_paciente_id, null, null);
  return jsonb_build_object('ok', true, 'filas', coalesce((
    select jsonb_agg(jsonb_build_object('fecha', b.created_at, 'quien', b.personal_nombre, 'rol', b.rol, 'accion', b.accion,
             'paciente_id', b.paciente_id, 'paciente', nullif(btrim(coalesce(p.nombres, '') || ' ' || coalesce(p.apellidos, '')), ''),
             'expediente', p.numero_expediente, 'detalle', b.detalle) order by b.created_at desc)
    from (select * from public.clinica_bitacora b0
           where b0.auth_user_id = auth.uid()
             and b0.created_at >= coalesce(p_desde, current_date - 30)
             and b0.created_at < coalesce(p_hasta, current_date) + 1
             and (p_paciente_id is null or b0.paciente_id = p_paciente_id)
           order by b0.created_at desc limit 500) b
    left join public.clinica_pacientes p on p.id = b.paciente_id), '[]'::jsonb));
end $f$;

-- ---------- 12. Permisos: nada para anon; funciones internas cerradas ----------
revoke all on public.clinica_consultorios, public.clinica_personal, public.clinica_personal_secretos, public.clinica_sesiones,
  public.clinica_pacientes, public.clinica_antecedentes, public.clinica_antecedentes_historial, public.clinica_citas,
  public.clinica_consultas, public.clinica_adendas, public.clinica_bitacora, public.clinica_cargos from anon;
revoke all on public.clinica_personal_secretos, public.clinica_sesiones, public.clinica_antecedentes, public.clinica_antecedentes_historial,
  public.clinica_consultas, public.clinica_adendas, public.clinica_bitacora from authenticated;
revoke all on public.clinica_personal from authenticated;
grant select on public.clinica_personal to authenticated;

revoke all on function public._clinica_pacientes_antes(), public._clinica_cargos_guardia(), public._clinica_citas_antes(),
  public._clinica_mantenimiento(), public._clinica_consultas_inmutable(), public._clinica_consultas_imc(), public._clinica_solo_agregar(),
  public._clinica_antecedentes_historia(), public._clinica_hash_token(text),
  public._clinica_log(uuid, uuid, text, text, text, uuid, uuid, text), public._clinica_sesion(text),
  public._clinica_autorizar_admin(jsonb), public._clinica_txt(jsonb, text, int) from public, anon, authenticated;

revoke all on function public.clinica_personal_guardar(jsonb, uuid, jsonb), public.clinica_iniciar_sesion(uuid, text),
  public.clinica_cambiar_pin(uuid, text, text), public.clinica_cerrar_sesion(text), public.clinica_sesion_estado(text),
  public.clinica_expediente_abrir(text, uuid), public.clinica_antecedentes_guardar(text, uuid, jsonb),
  public.clinica_consulta_guardar(text, uuid, jsonb), public.clinica_consulta_cerrar(text, uuid),
  public.clinica_consulta_adenda(text, uuid, text), public.clinica_consulta_anular(text, uuid, text),
  public.clinica_alergias(text, uuid[]), public.clinica_bitacora_ver(jsonb, date, date, uuid) from public, anon;
grant execute on function public.clinica_personal_guardar(jsonb, uuid, jsonb), public.clinica_iniciar_sesion(uuid, text),
  public.clinica_cambiar_pin(uuid, text, text), public.clinica_cerrar_sesion(text), public.clinica_sesion_estado(text),
  public.clinica_expediente_abrir(text, uuid), public.clinica_antecedentes_guardar(text, uuid, jsonb),
  public.clinica_consulta_guardar(text, uuid, jsonb), public.clinica_consulta_cerrar(text, uuid),
  public.clinica_consulta_adenda(text, uuid, text), public.clinica_consulta_anular(text, uuid, text),
  public.clinica_alergias(text, uuid[]), public.clinica_bitacora_ver(jsonb, date, date, uuid) to authenticated;

$sql$, '#BORRAR#', 'de' || 'lete');
end
$migracion$;

-- Ajuste aplicado aparte (aviso del revisor de seguridad de Supabase):
alter function public._clinica_txt(jsonb, text, int) set search_path = public;
