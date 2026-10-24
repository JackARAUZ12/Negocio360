-- =====================================================================
-- AGENDA → CITAS POR PROFESIONAL · Fecha: 23-oct-2026 · Solo AGREGA.
-- No modifica ninguna tabla existente. Nada de esto mueve dinero,
-- caja ni inventario: el cobro de una cita se hace en Ventas, por el
-- camino normal (igual que el cobro de la veterinaria).
--
--  * agenda_profesionales   quién atiende (normalmente un empleado),
--                           su color y, opcional, qué servicios hace.
--  * agenda_citas           la cita: cliente, fecha, estado, notas,
--                           y la venta con que se cobró (venta_id).
--  * agenda_citas_servicios cada servicio de la cita, con su profesional,
--                           hora de inicio y duración LIBRE (minutos).
--                           Una cita puede tener uno o varios servicios,
--                           con uno o varios profesionales.
--  * agenda_bloqueos        "no disponible" (almuerzo, permiso...).
--  * agenda_configuracion   horario que se muestra en la vista del día.
--  * agenda_cita_guardar()  guarda la cita y sus servicios en UNA sola
--                           operación y avisa si un profesional ya tiene
--                           otra cita o un bloqueo a esa hora.
-- =====================================================================

create table if not exists public.agenda_profesionales (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null default auth.uid(),
  empleado_id   uuid references public.empleados(id) on delete set null,
  nombre        text not null check (length(trim(nombre)) > 0),
  color         text not null default '#c084fc',
  servicios     uuid[] not null default '{}',     -- vacío = puede hacer todos
  orden         integer not null default 0,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists agenda_profesionales_empleado_uq
  on public.agenda_profesionales(auth_user_id, empleado_id) where empleado_id is not null;
create index if not exists agenda_profesionales_user_idx on public.agenda_profesionales(auth_user_id);

create table if not exists public.agenda_citas (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null default auth.uid(),
  fecha            date not null,
  cliente_id       uuid references public.clientes(id) on delete set null,
  cliente_nombre   text not null check (length(trim(cliente_nombre)) > 0),
  cliente_telefono text,
  estado           text not null default 'reservada'
                   check (estado in ('reservada','confirmada','en_atencion','completada','no_asistio','cancelada')),
  notas            text,
  venta_id         uuid references public.ventas(id) on delete set null,
  creado_por       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists agenda_citas_user_fecha_idx on public.agenda_citas(auth_user_id, fecha);

create table if not exists public.agenda_citas_servicios (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null default auth.uid(),
  cita_id         uuid not null references public.agenda_citas(id) on delete cascade,
  profesional_id  uuid references public.agenda_profesionales(id) on delete set null,
  producto_id     uuid references public.productos(id) on delete set null,
  servicio_nombre text not null check (length(trim(servicio_nombre)) > 0),
  precio          numeric(14,2) not null default 0 check (precio >= 0),
  hora_inicio     time not null,
  duracion_min    integer not null check (duracion_min between 1 and 1440),
  orden           integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists agenda_citas_servicios_cita_idx on public.agenda_citas_servicios(cita_id);
create index if not exists agenda_citas_servicios_user_idx on public.agenda_citas_servicios(auth_user_id, profesional_id);

create table if not exists public.agenda_bloqueos (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid not null default auth.uid(),
  profesional_id uuid references public.agenda_profesionales(id) on delete cascade,  -- null = todos
  fecha          date not null,
  hora_inicio    time not null,
  hora_fin       time not null,
  motivo         text,
  created_at     timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);
create index if not exists agenda_bloqueos_user_fecha_idx on public.agenda_bloqueos(auth_user_id, fecha);

create table if not exists public.agenda_configuracion (
  auth_user_id  uuid primary key default auth.uid(),
  hora_inicio   time not null default '08:00',
  hora_fin      time not null default '18:00',
  intervalo_min integer not null default 15 check (intervalo_min in (5,10,15,20,30,60)),
  updated_at    timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

-- Seguridad: cada negocio solo ve y toca lo suyo.
alter table public.agenda_profesionales   enable row level security;
alter table public.agenda_citas           enable row level security;
alter table public.agenda_citas_servicios enable row level security;
alter table public.agenda_bloqueos        enable row level security;
alter table public.agenda_configuracion   enable row level security;

drop policy if exists agenda_profesionales_own on public.agenda_profesionales;
create policy agenda_profesionales_own on public.agenda_profesionales for all
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid()
    and (empleado_id is null or exists (select 1 from public.empleados e where e.id = empleado_id and e.auth_user_id = auth.uid())));

drop policy if exists agenda_citas_own on public.agenda_citas;
create policy agenda_citas_own on public.agenda_citas for all
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid()
    and (cliente_id is null or exists (select 1 from public.clientes c where c.id = cliente_id and c.auth_user_id = auth.uid()))
    and (venta_id   is null or exists (select 1 from public.ventas v   where v.id = venta_id   and v.auth_user_id = auth.uid())));

drop policy if exists agenda_citas_servicios_own on public.agenda_citas_servicios;
create policy agenda_citas_servicios_own on public.agenda_citas_servicios for all
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid()
    and exists (select 1 from public.agenda_citas c where c.id = cita_id and c.auth_user_id = auth.uid())
    and (profesional_id is null or exists (select 1 from public.agenda_profesionales p where p.id = profesional_id and p.auth_user_id = auth.uid()))
    and (producto_id    is null or exists (select 1 from public.productos x where x.id = producto_id and x.auth_user_id = auth.uid())));

drop policy if exists agenda_bloqueos_own on public.agenda_bloqueos;
create policy agenda_bloqueos_own on public.agenda_bloqueos for all
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid()
    and (profesional_id is null or exists (select 1 from public.agenda_profesionales p where p.id = profesional_id and p.auth_user_id = auth.uid())));

drop policy if exists agenda_configuracion_own on public.agenda_configuracion;
create policy agenda_configuracion_own on public.agenda_configuracion for all
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

grant select, insert, update, delete on public.agenda_profesionales, public.agenda_citas,
  public.agenda_citas_servicios, public.agenda_bloqueos, public.agenda_configuracion to authenticated;

-- ---------------------------------------------------------------------
-- Guardar una cita (nueva o editada) con todos sus servicios, de una vez.
-- p_datos:     {fecha, cliente_id, cliente_nombre, cliente_telefono, estado, notas, creado_por}
-- p_servicios: [{profesional_id, producto_id, servicio_nombre, precio, hora_inicio 'HH:MM', duracion_min}]
-- p_permitir_cruce: si es false y un profesional ya está ocupado a esa
--   hora (otra cita activa o un bloqueo), NO guarda y devuelve la lista
--   de cruces para que la persona decida. Si es true, guarda igual.
-- Una cita ya cobrada (con venta) no deja cambiar servicios ni precios.
-- ---------------------------------------------------------------------
create or replace function public.agenda_cita_guardar(p_cita_id uuid, p_datos jsonb, p_servicios jsonb, p_permitir_cruce boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_id uuid := p_cita_id; v_fecha date; v_nombre text; v_estado text;
  v_cita record; s jsonb; v_cruces jsonb := '[]'::jsonb; v_n integer := 0; i integer := 0;
  v_ini time; v_dur integer; v_prof uuid; v_prod uuid;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  v_fecha  := nullif(p_datos->>'fecha', '')::date;
  v_nombre := trim(coalesce(p_datos->>'cliente_nombre', ''));
  v_estado := coalesce(nullif(p_datos->>'estado', ''), 'reservada');
  if v_fecha is null then raise exception 'Elige la fecha de la cita.' using errcode = 'P0001'; end if;
  if v_nombre = '' then raise exception 'Escribe o elige el cliente.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_servicios) is distinct from 'array' or jsonb_array_length(p_servicios) = 0 then
    raise exception 'Agrega al menos un servicio.' using errcode = 'P0001';
  end if;

  if v_id is not null then
    select * into v_cita from agenda_citas where id = v_id and auth_user_id = v_uid for update;
    if not found then raise exception 'La cita ya no existe.' using errcode = 'P0001'; end if;
  end if;

  -- Validar cada servicio y buscar cruces
  for s in select * from jsonb_array_elements(p_servicios) loop
    i := i + 1;
    if trim(coalesce(s->>'servicio_nombre', '')) = '' then raise exception 'El servicio % no tiene nombre.', i using errcode = 'P0001'; end if;
    v_ini := nullif(s->>'hora_inicio', '')::time;
    v_dur := nullif(s->>'duracion_min', '')::integer;
    if v_ini is null then raise exception 'Falta la hora del servicio "%".', s->>'servicio_nombre' using errcode = 'P0001'; end if;
    if v_dur is null or v_dur < 1 or v_dur > 1440 then raise exception 'La duración de "%" debe ser de 1 a 1440 minutos.', s->>'servicio_nombre' using errcode = 'P0001'; end if;
    if v_ini + make_interval(mins => v_dur) < v_ini then raise exception 'El servicio "%" pasa de la medianoche.', s->>'servicio_nombre' using errcode = 'P0001'; end if;
    if coalesce((s->>'precio')::numeric, 0) < 0 then raise exception 'El precio no puede ser negativo.' using errcode = 'P0001'; end if;
    v_prof := nullif(s->>'profesional_id', '')::uuid;
    v_prod := nullif(s->>'producto_id', '')::uuid;
    if v_prof is not null and not exists (select 1 from agenda_profesionales where id = v_prof and auth_user_id = v_uid) then
      raise exception 'Profesional no encontrado.' using errcode = 'P0001'; end if;
    if v_prod is not null and not exists (select 1 from productos where id = v_prod and auth_user_id = v_uid) then
      raise exception 'Servicio no encontrado.' using errcode = 'P0001'; end if;

    if v_prof is not null and v_estado not in ('cancelada','no_asistio') then
      -- otras citas activas del mismo profesional ese día
      v_cruces := v_cruces || coalesce((
        select jsonb_agg(jsonb_build_object('tipo','cita','profesional', p.nombre, 'cliente', c.cliente_nombre,
               'servicio', x.servicio_nombre, 'hora', to_char(x.hora_inicio,'HH24:MI'),
               'hasta', to_char(x.hora_inicio + make_interval(mins => x.duracion_min),'HH24:MI')))
          from agenda_citas_servicios x join agenda_citas c on c.id = x.cita_id
          join agenda_profesionales p on p.id = x.profesional_id
         where x.auth_user_id = v_uid and c.fecha = v_fecha and x.profesional_id = v_prof
           and c.estado not in ('cancelada','no_asistio')
           and (v_id is null or c.id <> v_id)
           and x.hora_inicio < v_ini + make_interval(mins => v_dur)
           and v_ini < x.hora_inicio + make_interval(mins => x.duracion_min)), '[]'::jsonb);
      -- bloqueos de ese profesional (o de todos)
      v_cruces := v_cruces || coalesce((
        select jsonb_agg(jsonb_build_object('tipo','bloqueo','profesional', coalesce(p.nombre,'Todos'),
               'motivo', coalesce(b.motivo,'No disponible'), 'hora', to_char(b.hora_inicio,'HH24:MI'), 'hasta', to_char(b.hora_fin,'HH24:MI')))
          from agenda_bloqueos b left join agenda_profesionales p on p.id = b.profesional_id
         where b.auth_user_id = v_uid and b.fecha = v_fecha and (b.profesional_id is null or b.profesional_id = v_prof)
           and b.hora_inicio < v_ini + make_interval(mins => v_dur) and v_ini < b.hora_fin), '[]'::jsonb);
      -- dos servicios de esta misma cita con el mismo profesional a la vez
      v_cruces := v_cruces || coalesce((
        select jsonb_agg(jsonb_build_object('tipo','misma_cita','servicio', y->>'servicio_nombre', 'hora', y->>'hora_inicio'))
          from jsonb_array_elements(p_servicios) with ordinality as t(y, n)
         where t.n > i and nullif(y->>'profesional_id','')::uuid = v_prof
           and (y->>'hora_inicio')::time < v_ini + make_interval(mins => v_dur)
           and v_ini < (y->>'hora_inicio')::time + make_interval(mins => (y->>'duracion_min')::integer)), '[]'::jsonb);
    end if;
  end loop;

  if jsonb_array_length(v_cruces) > 0 and not coalesce(p_permitir_cruce, false) then
    return jsonb_build_object('ok', false, 'cruces', v_cruces);
  end if;

  if v_id is null then
    insert into agenda_citas (auth_user_id, fecha, cliente_id, cliente_nombre, cliente_telefono, estado, notas, creado_por)
    values (v_uid, v_fecha, nullif(p_datos->>'cliente_id','')::uuid, v_nombre, nullif(trim(coalesce(p_datos->>'cliente_telefono','')),''),
            v_estado, nullif(trim(coalesce(p_datos->>'notas','')),''), nullif(p_datos->>'creado_por',''))
    returning id into v_id;
  else
    if v_cita.venta_id is not null then
      -- Ya cobrada: solo cambian notas y estado; los servicios quedan como se cobraron.
      update agenda_citas set notas = nullif(trim(coalesce(p_datos->>'notas','')),''), estado = v_estado, updated_at = now()
       where id = v_id;
      return jsonb_build_object('ok', true, 'cita_id', v_id, 'solo_notas', true);
    end if;
    update agenda_citas set fecha = v_fecha, cliente_id = nullif(p_datos->>'cliente_id','')::uuid, cliente_nombre = v_nombre,
           cliente_telefono = nullif(trim(coalesce(p_datos->>'cliente_telefono','')),''), estado = v_estado,
           notas = nullif(trim(coalesce(p_datos->>'notas','')),''), updated_at = now()
     where id = v_id;
    delete from agenda_citas_servicios where cita_id = v_id and auth_user_id = v_uid;
  end if;

  insert into agenda_citas_servicios (auth_user_id, cita_id, profesional_id, producto_id, servicio_nombre, precio, hora_inicio, duracion_min, orden)
  select v_uid, v_id, nullif(y->>'profesional_id','')::uuid, nullif(y->>'producto_id','')::uuid, trim(y->>'servicio_nombre'),
         round(coalesce((y->>'precio')::numeric, 0), 2), (y->>'hora_inicio')::time, (y->>'duracion_min')::integer, n::integer
    from jsonb_array_elements(p_servicios) with ordinality as t(y, n);
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'cita_id', v_id, 'servicios', v_n, 'cruces_aceptados', jsonb_array_length(v_cruces));
end $$;
revoke all on function public.agenda_cita_guardar(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.agenda_cita_guardar(uuid, jsonb, jsonb, boolean) to authenticated;
