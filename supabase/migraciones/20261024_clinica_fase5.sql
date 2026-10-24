-- =====================================================================
-- MÓDULO CLÍNICA — FASE 5 (observación/hospitalización, seguros y convenios)
-- ---------------------------------------------------------------------
-- SOLO AGREGA: tablas nuevas con prefijo clinica_, columnas nuevas en tablas
-- propias de la Clínica y funciones nuevas o nuevas versiones de funciones
-- propias de la Clínica. No cambia nada de otros módulos.
-- * Observación / hospitalización (modelo vet-estancias): la estancia es dato
--   administrativo (cama, fechas, cargos, cobro); lo clínico (ingreso,
--   evolución, enfermería, alta y signos) va en clinica_estancia_notas, SIN
--   acceso directo: solo con sesión médica, solo agregar y en la bitácora.
-- * Seguros y convenios: catálogo de aseguradoras/empresas (cada una ligada
--   a un cliente para cobrarle a crédito por el camino de siempre), convenio
--   del paciente, foto de la cobertura al cobrar cada cita y reclamos
--   (facturas a la aseguradora) que no permiten cobrar dos veces una cita.
-- =====================================================================
do $migracion$
begin
execute replace($sql$

-- ---------- 1. Convenios / aseguradoras ----------
create table if not exists public.clinica_convenios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 120),
  tipo text not null default 'aseguradora' check (tipo in ('aseguradora','empresa','otro')),
  cobertura_pct numeric(5,2) not null default 0 check (cobertura_pct >= 0 and cobertura_pct <= 100),
  cliente_id uuid references public.clientes(id) on #BORRAR# set null,
  telefono text check (telefono is null or char_length(telefono) <= 30),
  notas text check (notas is null or char_length(notas) <= 500),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinica_convenios_uid on public.clinica_convenios(auth_user_id);
alter table public.clinica_convenios enable row level security;
create policy clinica_convenios_ver on public.clinica_convenios for select to authenticated using (auth_user_id = (select auth.uid()));
create policy clinica_convenios_crear on public.clinica_convenios for insert to authenticated
  with check (auth_user_id = (select auth.uid())
    and (cliente_id is null or exists (select 1 from public.clientes c where c.id = cliente_id and c.auth_user_id = (select auth.uid()))));
create policy clinica_convenios_editar on public.clinica_convenios for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and (cliente_id is null or exists (select 1 from public.clientes c where c.id = cliente_id and c.auth_user_id = (select auth.uid()))));
-- No se borran: se desactivan.

-- Convenio del paciente
alter table public.clinica_pacientes add column if not exists convenio_id uuid references public.clinica_convenios(id) on #BORRAR# set null;
alter table public.clinica_pacientes add column if not exists poliza text check (poliza is null or char_length(poliza) <= 60);
alter table public.clinica_pacientes add column if not exists poliza_vence date;
create or replace function public._clinica_convenio_propio() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if new.convenio_id is not null and not exists (select 1 from public.clinica_convenios k where k.id = new.convenio_id and k.auth_user_id = new.auth_user_id) then
    raise exception 'clinica_convenio_ajeno' using hint = 'Ese convenio no existe.';
  end if;
  return new;
end $f$;
create trigger clinica_pacientes_convenio before insert or update of convenio_id on public.clinica_pacientes
  for each row execute function public._clinica_convenio_propio();

-- Foto de la cobertura al cobrar la cita (lo que pagó el seguro no se recalcula después)
alter table public.clinica_cita_info add column if not exists convenio_id uuid references public.clinica_convenios(id) on #BORRAR# set null;
alter table public.clinica_cita_info add column if not exists cobertura_pct numeric(5,2) check (cobertura_pct is null or (cobertura_pct >= 0 and cobertura_pct <= 100));
alter table public.clinica_cita_info add column if not exists monto_cubierto numeric(12,2) check (monto_cubierto is null or monto_cubierto >= 0);
alter table public.clinica_cita_info add column if not exists cubierto_servicios numeric(12,2) check (cubierto_servicios is null or cubierto_servicios >= 0);
create trigger clinica_cita_info_convenio before insert or update of convenio_id on public.clinica_cita_info
  for each row execute function public._clinica_convenio_propio();

-- ---------- 2. Reclamos (facturas a la aseguradora) ----------
create table if not exists public.clinica_reclamos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  convenio_id uuid not null references public.clinica_convenios(id),
  citas uuid[] not null check (cardinality(citas) between 1 and 5000),
  monto numeric(12,2) not null check (monto > 0),
  detalle jsonb not null default '{}'::jsonb check (jsonb_typeof(detalle) = 'object' and octet_length(detalle::text) <= 200000),
  estado text not null default 'enviado' check (estado in ('enviado','facturado','anulado')),
  venta_id uuid references public.ventas(id) on #BORRAR# set null,
  facturado_en timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clinica_reclamos_uid on public.clinica_reclamos(auth_user_id, created_at desc);
alter table public.clinica_reclamos enable row level security;
create policy clinica_reclamos_ver on public.clinica_reclamos for select to authenticated using (auth_user_id = (select auth.uid()));
create policy clinica_reclamos_crear on public.clinica_reclamos for insert to authenticated
  with check (auth_user_id = (select auth.uid()) and estado = 'enviado' and venta_id is null
    and exists (select 1 from public.clinica_convenios k where k.id = convenio_id and k.auth_user_id = (select auth.uid())));
create policy clinica_reclamos_editar on public.clinica_reclamos for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and (venta_id is null or exists (select 1 from public.ventas v where v.id = venta_id and v.auth_user_id = (select auth.uid()))));
create or replace function public._clinica_reclamos_antes() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if tg_op = 'UPDATE' then
    if old.estado = 'anulado' then raise exception 'clinica_reclamo_anulado'; end if;
    if (to_jsonb(new) - array['estado','venta_id','facturado_en']) is distinct from (to_jsonb(old) - array['estado','venta_id','facturado_en']) then
      raise exception 'clinica_reclamo_inmutable';
    end if;
    if new.estado = 'facturado' and new.venta_id is null then raise exception 'clinica_reclamo_sin_venta'; end if;
  end if;
  -- Una cita nunca se factura dos veces a la aseguradora.
  if new.estado = 'facturado' and exists (select 1 from public.clinica_reclamos r
       where r.auth_user_id = new.auth_user_id and r.id <> new.id and r.estado = 'facturado' and r.citas && new.citas) then
    raise exception 'clinica_reclamo_duplicado' using hint = 'Alguna de estas citas ya se facturó a la aseguradora.';
  end if;
  if new.estado = 'facturado' and new.facturado_en is null then new.facturado_en := now(); end if;
  return new;
end $f$;
create trigger clinica_reclamos_antes before insert or update on public.clinica_reclamos
  for each row execute function public._clinica_reclamos_antes();
create trigger clinica_reclamos_fijos before #BORRAR# on public.clinica_reclamos
  for each row execute function public._clinica_solo_agregar();

-- ---------- 3. Observación / hospitalización ----------
create table if not exists public.clinica_estancias (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  numero text,
  paciente_id uuid not null references public.clinica_pacientes(id),
  tipo text not null default 'observacion' check (tipo in ('observacion','hospitalizacion')),
  cama text check (cama is null or char_length(cama) <= 40),
  medico_id uuid references public.clinica_personal(id) on #BORRAR# set null,
  servicio_id uuid references public.productos(id) on #BORRAR# set null,
  ingreso_en timestamptz not null default now(),
  alta_en timestamptz,
  estado text not null default 'activa' check (estado in ('activa','alta','anulada')),
  motivo_anulacion text check (motivo_anulacion is null or char_length(motivo_anulacion) <= 300),
  venta_id uuid references public.ventas(id) on #BORRAR# set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (alta_en is null or alta_en >= ingreso_en)
);
create unique index if not exists clinica_estancias_una_activa on public.clinica_estancias(paciente_id) where estado = 'activa';
create unique index if not exists clinica_estancias_numero on public.clinica_estancias(auth_user_id, numero);
create index if not exists clinica_estancias_uid on public.clinica_estancias(auth_user_id, estado, ingreso_en desc);
alter table public.clinica_estancias enable row level security;
create policy clinica_estancias_ver on public.clinica_estancias for select to authenticated using (auth_user_id = (select auth.uid()));
create policy clinica_estancias_crear on public.clinica_estancias for insert to authenticated
  with check (auth_user_id = (select auth.uid()) and estado = 'activa' and venta_id is null
    and exists (select 1 from public.clinica_pacientes p where p.id = paciente_id and p.auth_user_id = (select auth.uid()))
    and (medico_id is null or exists (select 1 from public.clinica_personal m where m.id = medico_id and m.auth_user_id = (select auth.uid())))
    and (servicio_id is null or exists (select 1 from public.productos x where x.id = servicio_id and x.auth_user_id = (select auth.uid()))));
create policy clinica_estancias_editar on public.clinica_estancias for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and (medico_id is null or exists (select 1 from public.clinica_personal m where m.id = medico_id and m.auth_user_id = (select auth.uid())))
    and (servicio_id is null or exists (select 1 from public.productos x where x.id = servicio_id and x.auth_user_id = (select auth.uid())))
    and (venta_id is null or exists (select 1 from public.ventas v where v.id = venta_id and v.auth_user_id = (select auth.uid()))));
-- No se borran: se anulan con motivo.

create or replace function public._clinica_estancias_antes() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_pref text; v_n int;
begin
  if tg_op = 'INSERT' then
    v_pref := case new.tipo when 'hospitalizacion' then 'HOS' else 'OBS' end;
    perform pg_advisory_xact_lock(hashtext('clinica_estancia:' || new.auth_user_id::text || ':' || v_pref));
    select coalesce(max(substring(numero from '^' || v_pref || '-([0-9]+)$')::int), 0) + 1 into v_n
      from public.clinica_estancias where auth_user_id = new.auth_user_id and numero like v_pref || '-%';
    new.numero := v_pref || '-' || lpad(v_n::text, 6, '0');
    new.alta_en := null;
    return new;
  end if;
  new.id := old.id; new.auth_user_id := old.auth_user_id; new.numero := old.numero; new.paciente_id := old.paciente_id;
  new.tipo := old.tipo; new.created_at := old.created_at; new.updated_at := now();
  if old.estado = 'anulada' then raise exception 'clinica_estancia_anulada'; end if;
  if old.estado = 'alta' and new.estado <> 'alta' then raise exception 'clinica_estancia_con_alta' using hint = 'Una estancia con alta no se reabre: registra un ingreso nuevo.'; end if;
  if old.estado = 'alta' and (new.ingreso_en is distinct from old.ingreso_en or new.alta_en is distinct from old.alta_en or new.servicio_id is distinct from old.servicio_id) then
    raise exception 'clinica_estancia_con_alta' using hint = 'Después del alta solo se registra el cobro.';
  end if;
  if new.estado = 'alta' and old.estado = 'activa' and new.alta_en is null then new.alta_en := now(); end if;
  if new.estado = 'activa' then new.alta_en := null; end if;
  if new.estado = 'anulada' then
    if coalesce(btrim(new.motivo_anulacion), '') = '' then raise exception 'clinica_falta_motivo'; end if;
    if exists (select 1 from public.ventas v where v.id = old.venta_id and v.estado = 'completada') then raise exception 'clinica_estancia_cobrada'; end if;
  end if;
  return new;
end $f$;
create trigger clinica_estancias_antes before insert or update on public.clinica_estancias
  for each row execute function public._clinica_estancias_antes();

create table if not exists public.clinica_estancia_cargos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  estancia_id uuid not null references public.clinica_estancias(id),
  producto_id uuid references public.productos(id) on #BORRAR# set null,
  descripcion text not null check (char_length(btrim(descripcion)) between 1 and 200),
  cantidad numeric not null check (cantidad > 0 and cantidad <= 100000),
  created_at timestamptz not null default now()
);
create index if not exists clinica_estancia_cargos_est on public.clinica_estancia_cargos(estancia_id);
alter table public.clinica_estancia_cargos enable row level security;
create policy clinica_estancia_cargos_own on public.clinica_estancia_cargos for all to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and exists (select 1 from public.clinica_estancias e where e.id = estancia_id and e.auth_user_id = (select auth.uid()))
    and (producto_id is null or exists (select 1 from public.productos p where p.id = producto_id and p.auth_user_id = (select auth.uid()))));
-- La cuenta de una estancia cobrada o anulada no cambia.
create or replace function public._clinica_estancia_cargos_guardia() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_e uuid := case when tg_op = upper('#BORRAR#') then old.estancia_id else new.estancia_id end;
begin
  if exists (select 1 from public.clinica_estancias e left join public.ventas v on v.id = e.venta_id
             where e.id = v_e and (e.estado = 'anulada' or v.estado = 'completada')) then
    raise exception 'clinica_estancia_cerrada' using hint = 'Esta estancia ya se cobró o se anuló: su cuenta no se puede cambiar.';
  end if;
  if tg_op = 'UPDATE' and new.estancia_id <> old.estancia_id then raise exception 'clinica_estancia_inmutable'; end if;
  if tg_op = upper('#BORRAR#') then return old; end if;
  return new;
end $f$;
create trigger clinica_estancia_cargos_guardia before insert or update or #BORRAR# on public.clinica_estancia_cargos
  for each row execute function public._clinica_estancia_cargos_guardia();

-- Notas clínicas de la estancia (SIN acceso directo; solo con sesión médica)
create table if not exists public.clinica_estancia_notas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  estancia_id uuid not null references public.clinica_estancias(id),
  paciente_id uuid not null references public.clinica_pacientes(id),
  tipo text not null check (tipo in ('ingreso','evolucion','enfermeria','indicaciones','alta')),
  texto text not null check (char_length(btrim(texto)) between 1 and 8000),
  pa_sistolica int check (pa_sistolica is null or pa_sistolica between 50 and 260),
  pa_diastolica int check (pa_diastolica is null or pa_diastolica between 30 and 160),
  fc int check (fc is null or fc between 20 and 250),
  fr int check (fr is null or fr between 5 and 80),
  temperatura numeric(4,1) check (temperatura is null or temperatura between 30 and 45),
  spo2 int check (spo2 is null or spo2 between 50 and 100),
  glucosa_mg_dl numeric(6,1) check (glucosa_mg_dl is null or glucosa_mg_dl between 10 and 1000),
  autor_id uuid not null references public.clinica_personal(id),
  autor_nombre text not null,
  created_at timestamptz not null default now()
);
create index if not exists clinica_estancia_notas_est on public.clinica_estancia_notas(estancia_id, created_at);
alter table public.clinica_estancia_notas enable row level security;
create trigger clinica_estancia_notas_fijas before update or #BORRAR# on public.clinica_estancia_notas
  for each row execute function public._clinica_solo_agregar();

create or replace function public.clinica_estancia_nota_agregar(p_token text, p_estancia_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_e public.clinica_estancias; v_tipo text; v_txt text; v_id uuid;
begin
  v_p := public._clinica_sesion(p_token);
  select * into v_e from public.clinica_estancias where id = p_estancia_id and auth_user_id = auth.uid();
  if v_e.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if v_e.estado <> 'activa' then return jsonb_build_object('ok', false, 'motivo', 'estancia_cerrada'); end if;
  v_tipo := coalesce(nullif(p_datos->>'tipo', ''), 'evolucion');
  v_txt := public._clinica_txt(p_datos, 'texto', 8000);
  if v_tipo not in ('ingreso','evolucion','enfermeria','indicaciones','alta') then return jsonb_build_object('ok', false, 'motivo', 'tipo'); end if;
  if v_txt is null then return jsonb_build_object('ok', false, 'motivo', 'texto'); end if;
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
  v_p := public._clinica_sesion(p_token);
  select * into v_e from public.clinica_estancias where id = p_estancia_id and auth_user_id = auth.uid();
  if v_e.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'ver_estancia', v_e.paciente_id, null, v_e.numero);
  return jsonb_build_object('ok', true, 'notas', coalesce((select jsonb_agg(to_jsonb(n) - 'auth_user_id' order by n.created_at)
    from public.clinica_estancia_notas n where n.estancia_id = v_e.id), '[]'::jsonb));
end $f$;

-- ---------- 4. Permisos ----------
revoke all on public.clinica_estancia_notas from anon, authenticated;
revoke all on public.clinica_convenios, public.clinica_reclamos, public.clinica_estancias, public.clinica_estancia_cargos from anon;
revoke all on function public._clinica_convenio_propio() from public, anon, authenticated;
revoke all on function public._clinica_reclamos_antes() from public, anon, authenticated;
revoke all on function public._clinica_estancias_antes() from public, anon, authenticated;
revoke all on function public._clinica_estancia_cargos_guardia() from public, anon, authenticated;
revoke all on function public.clinica_estancia_nota_agregar(text, uuid, jsonb) from public, anon;
revoke all on function public.clinica_estancia_notas(text, uuid) from public, anon;
grant execute on function public.clinica_estancia_nota_agregar(text, uuid, jsonb) to authenticated;
grant execute on function public.clinica_estancia_notas(text, uuid) to authenticated;

$sql$, '#BORRAR#', 'de' || 'lete');
end
$migracion$;
