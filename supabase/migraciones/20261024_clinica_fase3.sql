-- =====================================================================
-- MÓDULO CLÍNICA — FASE 3 (operación diaria)
-- ---------------------------------------------------------------------
-- SOLO AGREGA: columnas nuevas en tablas propias de la Clínica, una tabla
-- nueva (clinica_honorarios) y funciones nuevas o nuevas versiones de
-- funciones propias de la Clínica. No toca nada de otros módulos.
-- * Sala de espera: clinica_citas.llamado_en (cuándo se llamó al paciente).
-- * Honorarios por médico: porcentaje sobre los SERVICIOS cobrados o monto
--   fijo por consulta atendida y cobrada. Se pagan por el camino de siempre
--   de Salarios (bonificación en el pago del empleado); aquí solo se guarda
--   la liquidación y no deja pagar dos veces la misma cita.
-- * Reporte clínico (diagnósticos frecuentes y notas por médico): solo con
--   sesión médica o código de administrador; devuelve cifras agregadas.
-- =====================================================================
do $migracion$
begin
execute replace($sql$

alter table public.clinica_citas add column if not exists llamado_en timestamptz;

alter table public.clinica_personal add column if not exists honorario_tipo text not null default 'ninguno'
  check (honorario_tipo in ('ninguno','porcentaje','monto'));
alter table public.clinica_personal add column if not exists honorario_valor numeric(12,2) not null default 0
  check (honorario_valor >= 0 and (honorario_tipo <> 'porcentaje' or honorario_valor <= 100));
alter table public.clinica_personal add column if not exists empleado_id uuid references public.empleados(id) on #BORRAR# set null;

create table if not exists public.clinica_honorarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  personal_id uuid not null references public.clinica_personal(id),
  empleado_id uuid,
  desde date not null,
  hasta date not null,
  citas uuid[] not null check (cardinality(citas) between 1 and 5000),
  monto numeric(12,2) not null check (monto >= 0),
  detalle jsonb not null default '{}'::jsonb check (jsonb_typeof(detalle) = 'object' and octet_length(detalle::text) <= 200000),
  estado text not null default 'enviada' check (estado in ('enviada','pagada','anulada')),
  empleado_pago_id uuid,
  pagada_en timestamptz,
  created_at timestamptz not null default now(),
  check (hasta >= desde)
);
create index if not exists clinica_honorarios_personal on public.clinica_honorarios(auth_user_id, personal_id, created_at desc);
alter table public.clinica_honorarios enable row level security;
create policy clinica_honorarios_ver on public.clinica_honorarios for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy clinica_honorarios_crear on public.clinica_honorarios for insert to authenticated
  with check (auth_user_id = (select auth.uid()) and estado = 'enviada'
    and exists (select 1 from public.clinica_personal p where p.id = personal_id and p.auth_user_id = (select auth.uid())));
create policy clinica_honorarios_editar on public.clinica_honorarios for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid())
    and (empleado_pago_id is null or exists (select 1 from public.empleados_pagos e where e.id = empleado_pago_id and e.auth_user_id = (select auth.uid()))));
-- No se borran: se anulan.

create or replace function public._clinica_honorarios_antes() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if tg_op = 'UPDATE' then
    if old.estado = 'anulada' then raise exception 'clinica_honorario_anulado'; end if;
    if old.estado = 'pagada' and new.estado <> 'anulada' then raise exception 'clinica_honorario_pagado'; end if;
    -- lo calculado no cambia: solo el estado y el pago que lo liquidó
    if (to_jsonb(new) - array['estado','empleado_pago_id','pagada_en']) is distinct from (to_jsonb(old) - array['estado','empleado_pago_id','pagada_en']) then
      raise exception 'clinica_honorario_inmutable';
    end if;
  end if;
  -- Una misma cita nunca se paga dos veces.
  if new.estado = 'pagada' and exists (select 1 from public.clinica_honorarios h
       where h.auth_user_id = new.auth_user_id and h.id <> new.id and h.estado = 'pagada' and h.citas && new.citas) then
    raise exception 'clinica_honorario_duplicado' using hint = 'Alguna de estas consultas ya se pagó en otra liquidación.';
  end if;
  if new.estado = 'pagada' and new.pagada_en is null then new.pagada_en := now(); end if;
  return new;
end $f$;
create trigger clinica_honorarios_antes before insert or update on public.clinica_honorarios
  for each row execute function public._clinica_honorarios_antes();
create trigger clinica_honorarios_fijos before #BORRAR# on public.clinica_honorarios
  for each row execute function public._clinica_solo_agregar();

-- Personal: ahora también guarda honorarios y el empleado de Salarios ligado.
create or replace function public.clinica_personal_guardar(p_auth jsonb, p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_a jsonb; v_id uuid; v_rol text; v_pin text; v_cons uuid; v_old public.clinica_personal; v_nombre text;
  v_htipo text; v_hval numeric; v_emp uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  v_a := public._clinica_autorizar_admin(p_auth);
  if not coalesce((v_a->>'ok')::boolean, false) then return v_a; end if;
  v_nombre := public._clinica_txt(p_datos, 'nombre', 80);
  v_rol := p_datos->>'rol';
  v_pin := nullif(btrim(coalesce(p_datos->>'pin', '')), '');
  v_cons := nullif(p_datos->>'consultorio_id', '')::uuid;
  v_htipo := coalesce(nullif(p_datos->>'honorario_tipo', ''), 'ninguno');
  v_hval := coalesce(nullif(p_datos->>'honorario_valor', '')::numeric, 0);
  v_emp := nullif(p_datos->>'empleado_id', '')::uuid;
  if v_nombre is null then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_rol is null or v_rol not in ('medico','recepcion','admin') then return jsonb_build_object('ok', false, 'motivo', 'rol'); end if;
  if v_pin is not null and v_pin !~ '^[0-9]{4,8}$' then return jsonb_build_object('ok', false, 'motivo', 'pin_formato'); end if;
  if v_cons is not null and not exists (select 1 from public.clinica_consultorios where id = v_cons and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'consultorio');
  end if;
  if v_htipo not in ('ninguno','porcentaje','monto') or v_hval < 0 or (v_htipo = 'porcentaje' and v_hval > 100) or v_hval > 9999999 then
    return jsonb_build_object('ok', false, 'motivo', 'honorario');
  end if;
  if v_htipo = 'ninguno' then v_hval := 0; end if;
  if v_emp is not null and not exists (select 1 from public.empleados where id = v_emp and auth_user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'empleado');
  end if;
  if p_id is null then
    if v_rol in ('medico','admin') and v_pin is null then return jsonb_build_object('ok', false, 'motivo', 'pin_requerido'); end if;
    insert into public.clinica_personal(auth_user_id, nombre, rol, atiende, especialidad, registro_profesional, telefono, consultorio_id, honorario_tipo, honorario_valor, empleado_id)
    values (auth.uid(), v_nombre, v_rol, coalesce((p_datos->>'atiende')::boolean, v_rol = 'medico'),
            public._clinica_txt(p_datos, 'especialidad', 60), public._clinica_txt(p_datos, 'registro_profesional', 40),
            public._clinica_txt(p_datos, 'telefono', 30), v_cons, v_htipo, v_hval, v_emp)
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
      honorario_tipo = v_htipo, honorario_valor = v_hval, empleado_id = v_emp,
      activo = coalesce((p_datos->>'activo')::boolean, activo), updated_at = now()
    where id = p_id;
    v_id := p_id;
    if v_rol <> v_old.rol or v_pin is not null or coalesce((p_datos->>'activo')::boolean, v_old.activo) = false then
      update public.clinica_sesiones set cerrada_en = now() where personal_id = p_id and cerrada_en is null;
    end if;
    perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'personal_editado', null, null,
      v_nombre || ' (' || v_rol || ')' || case when coalesce((p_datos->>'activo')::boolean, v_old.activo) then '' else ' — desactivado' end
      || case when v_htipo <> v_old.honorario_tipo or v_hval <> v_old.honorario_valor then ' — honorarios: ' || v_htipo || ' ' || v_hval else '' end);
  end if;
  if v_pin is not null then
    insert into public.clinica_personal_secretos(personal_id, pin_hash) values (v_id, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)))
    on conflict (personal_id) do update set pin_hash = excluded.pin_hash, fallos = 0, bloqueado_hasta = null, updated_at = now();
    update public.clinica_personal set pin_configurado = true where id = v_id;
    perform public._clinica_log(auth.uid(), (v_a->>'personal_id')::uuid, v_a->>'nombre', 'admin', 'pin_definido', null, null, v_nombre);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;

-- Reporte clínico agregado (no muestra pacientes): diagnósticos frecuentes y notas por médico.
create or replace function public.clinica_reporte_clinico(p_auth jsonb, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_quien text; v_pid uuid; v_rol text; v_a jsonb;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 731 then return jsonb_build_object('ok', false, 'motivo', 'fechas'); end if;
  if coalesce(p_auth->>'token', '') <> '' then
    begin v_p := public._clinica_sesion(p_auth->>'token'); v_quien := v_p.nombre; v_pid := v_p.id; v_rol := v_p.rol;
    exception when others then v_quien := null; end;
  end if;
  if v_quien is null then
    v_a := public._clinica_autorizar_admin(p_auth);
    if not coalesce((v_a->>'ok')::boolean, false) then return v_a; end if;
    v_quien := v_a->>'nombre'; v_pid := (v_a->>'personal_id')::uuid; v_rol := 'admin';
  end if;
  perform public._clinica_log(auth.uid(), v_pid, v_quien, v_rol, 'ver_reporte', null, null, p_desde || ' a ' || p_hasta);
  return jsonb_build_object('ok', true,
    'diagnosticos', coalesce((select jsonb_agg(x order by x.total desc, x.nombre) from (
        select coalesce(nullif(d->>'codigo', ''), '—') as codigo, max(d->>'nombre') as nombre, count(*)::int as total
          from public.clinica_consultas c, jsonb_array_elements(c.diagnosticos) d
         where c.auth_user_id = auth.uid() and c.estado = 'cerrada' and c.fecha >= p_desde and c.fecha < p_hasta + 1
         group by 1, case when coalesce(d->>'codigo', '') = '' then lower(d->>'nombre') else '' end
         order by 3 desc limit 30) x), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(y) from (
        select c.medico_id, max(c.medico_nombre) as medico_nombre, count(*) filter (where c.estado = 'cerrada')::int as cerradas,
               count(*) filter (where c.estado = 'borrador')::int as borradores, count(*) filter (where c.estado = 'anulada')::int as anuladas
          from public.clinica_consultas c
         where c.auth_user_id = auth.uid() and c.fecha >= p_desde and c.fecha < p_hasta + 1
         group by c.medico_id) y), '[]'::jsonb));
end $f$;

revoke all on public.clinica_honorarios from anon;
revoke all on function public._clinica_honorarios_antes() from public, anon, authenticated;
revoke all on function public.clinica_reporte_clinico(jsonb, date, date) from public, anon;
grant execute on function public.clinica_reporte_clinico(jsonb, date, date) to authenticated;

$sql$, '#BORRAR#', 'de' || 'lete');
end
$migracion$;
