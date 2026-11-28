-- PANEL AGUA (venta de agua de pozo por mensualidad) — Fase 1
-- Aditiva: interruptor propio (apagado por defecto), tablas nuevas y funciones nuevas.
-- Abonados con CÓDIGO (aparte de Clientes, que no cambia), cargos mensuales, cobros, arreglos de pago,
-- mora, cortes y reconexión. El dinero entra por el MOTOR DE VENTAS de siempre (Ventas + Caja + ticket):
-- aquí solo se registra a qué meses se aplicó cada venta. Todo lo que mueve saldos pasa por funciones
-- del servidor (todo o nada). La app no escribe directo en estas tablas.

alter table public.configuracion_empresa add column if not exists usa_modulo_agua boolean not null default false;
alter table public.configuracion_empresa add column if not exists agua_config jsonb not null default '{}'::jsonb;

create table if not exists public.agua_abonados (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  codigo text not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  nombre text not null, apellido text, cedula text, telefono text, whatsapp text, correo text,
  direccion text, referencia text, sector text,
  cuota numeric not null default 0 check (cuota >= 0),
  dia_cobro int not null default 5 check (dia_cobro between 1 and 28),
  cobra_iva boolean not null default false,
  estado text not null default 'activo' check (estado in ('activo','pausado','suspendido','cortado')),
  fecha_inicio date not null default current_date,
  saldo_favor numeric not null default 0 check (saldo_favor >= 0),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists agua_abonados_codigo_uk on public.agua_abonados(auth_user_id, upper(codigo));
create index if not exists agua_abonados_user_idx on public.agua_abonados(auth_user_id, estado);

create table if not exists public.agua_arreglos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  abonado_id uuid not null references public.agua_abonados(id) on delete cascade,
  monto numeric not null check (monto > 0),
  cuotas jsonb not null default '[]'::jsonb,           -- [{fecha, monto}]
  estado text not null default 'vigente' check (estado in ('vigente','cumplido','anulado')),
  notas text, usuario text,
  anulado_motivo text,
  created_at timestamptz not null default now()
);
create index if not exists agua_arreglos_ab_idx on public.agua_arreglos(abonado_id, estado);

create table if not exists public.agua_cargos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  abonado_id uuid not null references public.agua_abonados(id) on delete cascade,
  tipo text not null check (tipo in ('mensualidad','deuda_inicial','mora','reconexion','otro')),
  periodo date,
  concepto text not null,
  base numeric not null default 0,
  iva numeric not null default 0,
  monto numeric not null check (monto > 0),
  pagado numeric not null default 0 check (pagado >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','parcial','pagado','anulado')),
  vence date not null default current_date,
  arreglo_id uuid references public.agua_arreglos(id) on delete set null,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  check (pagado <= monto + 0.01)
);
create unique index if not exists agua_cargos_mes_uk on public.agua_cargos(abonado_id, tipo, periodo)
  where tipo in ('mensualidad','mora') and estado <> 'anulado';
create index if not exists agua_cargos_user_idx on public.agua_cargos(auth_user_id, estado);
create index if not exists agua_cargos_ab_idx on public.agua_cargos(abonado_id);

create table if not exists public.agua_cobros (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  abonado_id uuid not null references public.agua_abonados(id) on delete cascade,
  monto numeric not null check (monto > 0),
  aplicaciones jsonb not null default '[]'::jsonb,     -- [{cargo_id, monto}]
  a_favor numeric not null default 0,                 -- lo que no se pudo aplicar (quedó como saldo a favor)
  estado text not null default 'pendiente' check (estado in ('pendiente','aplicado','anulado','abandonado')),
  venta_id uuid unique,
  usuario text,
  created_at timestamptz not null default now(),
  aplicado_en timestamptz, anulado_en timestamptz
);
create index if not exists agua_cobros_ab_idx on public.agua_cobros(abonado_id, estado);

create table if not exists public.agua_eventos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  abonado_id uuid references public.agua_abonados(id) on delete cascade,
  tipo text not null, descripcion text not null, data jsonb not null default '{}'::jsonb,
  usuario text,
  created_at timestamptz not null default now()
);
create index if not exists agua_eventos_ab_idx on public.agua_eventos(abonado_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['agua_abonados','agua_arreglos','agua_cargos','agua_cobros','agua_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (auth_user_id = auth.uid())', t || '_leer', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.agua_cobros add column if not exists cargos_creados uuid[] not null default '{}'::uuid[];

-- ---------- utilidades ----------
create or replace function public._agua_cfg(p_uid uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('dias_gracia', 5, 'mora_tipo', 'ninguno', 'mora_valor', 0, 'meses_corte', 2, 'reconexion', 0,
                            'iva_pct', 15, 'prefijo', 'AB-', 'dia_cobro', 5, 'menu_exclusivo', false)
         || coalesce((select agua_config from public.configuracion_empresa where auth_user_id = p_uid limit 1), '{}'::jsonb);
$$;
create or replace function public._agua_check()
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'no autenticado'; end if;
  if not coalesce((select usa_modulo_agua from public.configuracion_empresa where auth_user_id = v limit 1), false) then
    raise exception 'El Panel Agua está apagado. Actívalo en Configuración.';
  end if;
  return v;
end $$;
create or replace function public._agua_evento(p_uid uuid, p_ab uuid, p_tipo text, p_desc text, p_data jsonb, p_usuario text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.agua_eventos (auth_user_id, abonado_id, tipo, descripcion, data, usuario)
  values (p_uid, p_ab, p_tipo, p_desc, coalesce(p_data, '{}'::jsonb), nullif(trim(coalesce(p_usuario, '')), ''));
$$;
create or replace function public._agua_mes_txt(p date)
returns text language sql immutable as $$
  select (array['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])[extract(month from p)::int] || ' ' || extract(year from p)::int;
$$;
create or replace function public._agua_estado_cargo(p_monto numeric, p_pagado numeric)
returns text language sql immutable as $$
  select case when p_pagado >= p_monto - 0.005 then 'pagado' when p_pagado > 0.005 then 'parcial' else 'pendiente' end;
$$;

-- Un cobro que no se terminó: queda "abandonado" y las mensualidades por adelantado que creó (sin pagos) se anulan.
create or replace function public._agua_abandonar(p_cobro_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare k record;
begin
  select * into k from agua_cobros where id = p_cobro_id for update;
  if k.id is null or k.estado <> 'pendiente' then return; end if;
  update agua_cobros set estado = 'abandonado' where id = k.id;
  update agua_cargos set estado = 'anulado', anulado_motivo = 'Cobro por adelantado no terminado'
   where id = any(k.cargos_creados) and pagado = 0 and estado = 'pendiente';
end $$;
create or replace function public.agua_cancelar_cobro(p_cobro_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not exists (select 1 from agua_cobros where id = p_cobro_id and auth_user_id = v_uid) then return jsonb_build_object('ok', false); end if;
  perform public._agua_abandonar(p_cobro_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Guardar abonado (nuevo o editar). Crea/actualiza su cliente normal (sin código). ----------
create or replace function public.agua_guardar_abonado(p jsonb, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); a public.agua_abonados%rowtype; v_aid uuid; v_id uuid; v_cli uuid;
  v_cod text := upper(regexp_replace(trim(coalesce(p->>'codigo', '')), '\s+', '', 'g'));
  v_nom text := trim(coalesce(p->>'nombre', '')); v_cuota numeric; v_dia int; v_n int;
begin
  if v_nom = '' then raise exception 'Escribe el nombre del abonado'; end if;
  v_cuota := round(coalesce(nullif(p->>'cuota', '')::numeric, -1), 2);
  if v_cuota < 0 then raise exception 'Escribe la cuota mensual (0 o más)'; end if;
  v_dia := coalesce(nullif(p->>'dia_cobro', '')::int, (cfg->>'dia_cobro')::int, 5);
  if v_dia < 1 or v_dia > 28 then raise exception 'El día de cobro va del 1 al 28'; end if;
  if coalesce(p->>'estado', 'activo') not in ('activo','pausado','suspendido','cortado') then raise exception 'Estado no válido'; end if;
  if nullif(p->>'id', '') is not null then
    select * into a from agua_abonados where id = (p->>'id')::uuid and auth_user_id = v_uid for update;
    if not found then raise exception 'Abonado no encontrado'; end if;
    v_aid := a.id;
  end if;
  if v_cod = '' then
    if v_aid is not null then v_cod := a.codigo;
    else
      select coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::bigint), 0) + 1 into v_n
        from agua_abonados where auth_user_id = v_uid and upper(codigo) like upper(cfg->>'prefijo') || '%';
      v_cod := upper(cfg->>'prefijo') || lpad(v_n::text, 4, '0');
    end if;
  end if;
  if exists (select 1 from agua_abonados where auth_user_id = v_uid and upper(codigo) = v_cod and id is distinct from v_aid) then
    raise exception 'El código % ya lo tiene otro abonado', v_cod;
  end if;

  if v_aid is null then
    insert into clientes (auth_user_id, nombre, apellido, telefono, whatsapp, direccion, ruc, email, zona, notas, activo, tipo_cliente)
    values (v_uid, v_nom, nullif(trim(p->>'apellido'), ''), nullif(trim(p->>'telefono'), ''), nullif(trim(coalesce(p->>'whatsapp', p->>'telefono')), ''),
            nullif(trim(p->>'direccion'), ''), nullif(trim(p->>'cedula'), ''), nullif(trim(p->>'correo'), ''), left(nullif(trim(p->>'sector'), ''), 60),
            'Abonado de agua ' || v_cod, true, 'general')
    returning id into v_cli;
    insert into agua_abonados (auth_user_id, codigo, cliente_id, nombre, apellido, cedula, telefono, whatsapp, correo, direccion, referencia, sector,
                               cuota, dia_cobro, cobra_iva, estado, fecha_inicio, notas)
    values (v_uid, v_cod, v_cli, v_nom, nullif(trim(p->>'apellido'), ''), nullif(trim(p->>'cedula'), ''), nullif(trim(p->>'telefono'), ''),
            nullif(trim(p->>'whatsapp'), ''), nullif(trim(p->>'correo'), ''), nullif(trim(p->>'direccion'), ''), nullif(trim(p->>'referencia'), ''),
            nullif(trim(p->>'sector'), ''), v_cuota, v_dia, coalesce((p->>'cobra_iva')::boolean, false), coalesce(p->>'estado', 'activo'),
            coalesce(nullif(p->>'fecha_inicio', '')::date, current_date), nullif(trim(p->>'notas'), ''))
    returning id into v_id;
    perform _agua_evento(v_uid, v_id, 'alta', 'Abonado ' || v_cod || ' registrado', jsonb_build_object('cuota', v_cuota), p_usuario);
  else
    update agua_abonados set codigo = v_cod, nombre = v_nom, apellido = nullif(trim(p->>'apellido'), ''), cedula = nullif(trim(p->>'cedula'), ''),
           telefono = nullif(trim(p->>'telefono'), ''), whatsapp = nullif(trim(p->>'whatsapp'), ''), correo = nullif(trim(p->>'correo'), ''),
           direccion = nullif(trim(p->>'direccion'), ''), referencia = nullif(trim(p->>'referencia'), ''), sector = nullif(trim(p->>'sector'), ''),
           cuota = v_cuota, dia_cobro = v_dia, cobra_iva = coalesce((p->>'cobra_iva')::boolean, a.cobra_iva),
           fecha_inicio = coalesce(nullif(p->>'fecha_inicio', '')::date, a.fecha_inicio), notas = nullif(trim(p->>'notas'), ''), updated_at = now()
     where id = a.id;
    v_id := a.id;
    if a.cliente_id is not null then
      update clientes set nombre = v_nom, apellido = nullif(trim(p->>'apellido'), ''), telefono = nullif(trim(p->>'telefono'), ''),
             direccion = nullif(trim(p->>'direccion'), ''), updated_at = now()
       where id = a.cliente_id and auth_user_id = v_uid;
    end if;
    if a.cuota is distinct from v_cuota or a.codigo is distinct from v_cod then
      perform _agua_evento(v_uid, v_id, 'edicion', 'Datos actualizados'
        || case when a.cuota is distinct from v_cuota then ' · cuota ' || a.cuota || ' → ' || v_cuota else '' end
        || case when a.codigo is distinct from v_cod then ' · código ' || a.codigo || ' → ' || v_cod else '' end, '{}'::jsonb, p_usuario);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_cod);
end $$;

-- ---------- Importar abonados (desde la plantilla de Excel). Todo o nada: si una fila falla, no se guarda ninguna. ----------
create or replace function public.agua_importar(p_filas jsonb, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); v_ivad numeric; f jsonb; i int := 0; errores jsonb := '[]'::jsonb; r jsonb; v_id uuid; v_deuda numeric; v_favor numeric;
  vistos text[] := array[]::text[]; v_cod text; n_ok int := 0;
begin
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'No hay filas para importar'; end if;
  if jsonb_array_length(p_filas) > 5000 then raise exception 'Máximo 5000 abonados por archivo'; end if;
  -- 1) revisar todo
  for f in select * from jsonb_array_elements(p_filas) loop
    i := i + 1;
    v_cod := upper(regexp_replace(trim(coalesce(f->>'codigo', '')), '\s+', '', 'g'));
    if v_cod = '' then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Falta el código'));
    elsif v_cod = any(vistos) then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Código repetido en el archivo: ' || v_cod));
    elsif exists (select 1 from agua_abonados where auth_user_id = v_uid and upper(codigo) = v_cod) then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'El código ya existe en el sistema: ' || v_cod));
    end if;
    vistos := vistos || v_cod;
    if trim(coalesce(f->>'nombre', '')) = '' then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Falta el nombre')); end if;
    begin
      if coalesce(nullif(f->>'cuota', '')::numeric, -1) < 0 then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Falta la cuota mensual')); end if;
      if nullif(f->>'dia_cobro', '') is not null and (f->>'dia_cobro')::int not between 1 and 28 then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Día de cobro fuera de 1-28')); end if;
      if coalesce(nullif(f->>'deuda', '')::numeric, 0) < 0 or coalesce(nullif(f->>'saldo_favor', '')::numeric, 0) < 0 then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Montos negativos')); end if;
    exception when others then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Número no válido en cuota, día o montos'));
    end;
    if coalesce(nullif(f->>'estado', ''), 'activo') not in ('activo','pausado','suspendido','cortado') then
      errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Estado no válido (Activo, Pausado, Suspendido o Cortado)'));
    end if;
  end loop;
  if jsonb_array_length(errores) > 0 then return jsonb_build_object('ok', false, 'errores', errores); end if;
  -- 2) guardar
  for f in select * from jsonb_array_elements(p_filas) loop
    r := public.agua_guardar_abonado(f - 'id', p_usuario);
    v_id := (r->>'id')::uuid; n_ok := n_ok + 1;
    v_deuda := round(coalesce(nullif(f->>'deuda', '')::numeric, 0), 2);
    v_favor := round(coalesce(nullif(f->>'saldo_favor', '')::numeric, 0), 2);
    if v_deuda > 0 then
      v_ivad := case when coalesce((f->>'cobra_iva')::boolean, false) then round(v_deuda - v_deuda / (1 + (cfg->>'iva_pct')::numeric / 100), 2) else 0 end;
      insert into agua_cargos (auth_user_id, abonado_id, tipo, concepto, base, iva, monto, vence)
      values (v_uid, v_id, 'deuda_inicial', 'Deuda anterior' || coalesce(' (' || nullif(f->>'meses_atrasados', '') || ' meses)', ''), v_deuda - v_ivad, v_ivad, v_deuda, current_date - 1);
    end if;
    if v_favor > 0 then update agua_abonados set saldo_favor = v_favor where id = v_id; end if;
  end loop;
  perform _agua_evento(v_uid, null, 'importacion', n_ok || ' abonados importados', '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true, 'importados', n_ok);
end $$;

-- ---------- Generar el cobro del mes (idempotente) + mora + saldo a favor ----------
create or replace function public.agua_generar_mes(p_periodo date, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); v_per date := date_trunc('month', p_periodo)::date;
  a record; v_base numeric; v_iva numeric; v_id uuid; n_new int := 0; n_ya int := 0; n_mora int := 0; n_favor int := 0; v_total numeric := 0;
  v_mora numeric; v_aplic numeric; v_fin date;
begin
  if v_per > (date_trunc('month', current_date) + interval '1 month')::date then raise exception 'Solo se puede generar hasta el mes que viene'; end if;
  v_fin := (v_per + interval '1 month - 1 day')::date;
  for a in select * from agua_abonados where auth_user_id = v_uid and estado = 'activo' and fecha_inicio <= v_fin and cuota > 0 order by codigo for update loop
    if exists (select 1 from agua_cargos where abonado_id = a.id and tipo = 'mensualidad' and periodo = v_per and estado <> 'anulado') then n_ya := n_ya + 1; continue; end if;
    v_base := round(a.cuota, 2);
    v_iva := case when a.cobra_iva then round(v_base * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
    insert into agua_cargos (auth_user_id, abonado_id, tipo, periodo, concepto, base, iva, monto, vence)
    values (v_uid, a.id, 'mensualidad', v_per, 'Agua ' || _agua_mes_txt(v_per), v_base, v_iva, v_base + v_iva, v_per + (a.dia_cobro - 1))
    returning id into v_id;
    n_new := n_new + 1; v_total := v_total + v_base + v_iva;
    if a.saldo_favor > 0 then
      v_aplic := least(a.saldo_favor, v_base + v_iva);
      update agua_cargos set pagado = v_aplic, estado = _agua_estado_cargo(monto, v_aplic) where id = v_id;
      update agua_abonados set saldo_favor = round(saldo_favor - v_aplic, 2), updated_at = now() where id = a.id;
      perform _agua_evento(v_uid, a.id, 'saldo_favor', 'Saldo a favor aplicado a ' || _agua_mes_txt(v_per) || ': ' || v_aplic, '{}'::jsonb, p_usuario);
      n_favor := n_favor + 1;
    end if;
  end loop;
  -- Mora: una vez por mes a quien tenga algo vencido (pasados los días de gracia) y sin arreglo de pago vigente
  if coalesce(cfg->>'mora_tipo', 'ninguno') in ('fijo','porcentaje') and coalesce((cfg->>'mora_valor')::numeric, 0) > 0 then
    for a in select ab.* from agua_abonados ab where ab.auth_user_id = v_uid and ab.estado in ('activo','suspendido','cortado')
               and exists (select 1 from agua_cargos c where c.abonado_id = ab.id and c.estado in ('pendiente','parcial') and c.arreglo_id is null
                             and c.tipo in ('mensualidad','deuda_inicial') and (c.tipo = 'deuda_inicial' or c.periodo < v_per)
                             and c.vence + coalesce((cfg->>'dias_gracia')::int, 0) < current_date)
               and not exists (select 1 from agua_cargos c where c.abonado_id = ab.id and c.tipo = 'mora' and c.periodo = v_per and c.estado <> 'anulado') loop
      v_mora := case when cfg->>'mora_tipo' = 'fijo' then round((cfg->>'mora_valor')::numeric, 2)
                     else round(a.cuota * (cfg->>'mora_valor')::numeric / 100, 2) end;
      if v_mora > 0 then
        v_iva := case when a.cobra_iva then round(v_mora * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
        insert into agua_cargos (auth_user_id, abonado_id, tipo, periodo, concepto, base, iva, monto, vence)
        values (v_uid, a.id, 'mora', v_per, 'Recargo por mora ' || _agua_mes_txt(v_per), v_mora, v_iva, v_mora + v_iva, current_date);
        n_mora := n_mora + 1;
      end if;
    end loop;
  end if;
  perform _agua_evento(v_uid, null, 'generar_mes', 'Cobro de ' || _agua_mes_txt(v_per) || ': ' || n_new || ' nuevos, ' || n_ya || ' ya estaban, ' || n_mora || ' con mora',
                       jsonb_build_object('periodo', v_per, 'nuevos', n_new, 'total', v_total), p_usuario);
  return jsonb_build_object('ok', true, 'periodo', v_per, 'nuevos', n_new, 'ya_estaban', n_ya, 'mora', n_mora, 'saldo_favor', n_favor, 'total', v_total);
end $$;

-- ---------- Preparar un cobro: reparte el monto en los cargos elegidos (lo más viejo primero) ----------
create or replace function public.agua_preparar_cobro(p_abonado_id uuid, p_cargo_ids uuid[], p_monto numeric, p_meses_adelanto int default 0, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); a record; c record; v_rest numeric; v_apl numeric; v_aplic jsonb := '[]'::jsonb;
  v_base numeric := 0; v_iva numeric := 0; v_pend numeric; v_ids uuid[] := coalesce(p_cargo_ids, array[]::uuid[]); v_per date; v_k int; v_id uuid;
  v_conceptos text[] := array[]::text[]; v_cobro uuid; v_iva_pct numeric; v_creados uuid[] := array[]::uuid[]; k record; v_con int; v_sin int;
begin
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Abonado no encontrado'; end if;
  -- Un cobro anterior que quedó a medias se cancela primero (y sus meses por adelantado sin pagar se anulan)
  for k in select id from agua_cobros where abonado_id = a.id and estado = 'pendiente' loop perform public._agua_abandonar(k.id); end loop;
  if coalesce(p_meses_adelanto, 0) < 0 or coalesce(p_meses_adelanto, 0) > 24 then raise exception 'Meses por adelantado: de 0 a 24'; end if;
  -- Meses por adelantado: se crean las mensualidades que siguen a la última que ya existe
  if coalesce(p_meses_adelanto, 0) > 0 then
    if a.cuota <= 0 then raise exception 'El abonado no tiene cuota para cobrar meses por adelantado'; end if;
    select coalesce(max(periodo), (date_trunc('month', current_date) - interval '1 month')::date) into v_per
      from agua_cargos where abonado_id = a.id and tipo = 'mensualidad' and estado <> 'anulado';
    for v_k in 1..p_meses_adelanto loop
      v_per := (v_per + interval '1 month')::date;
      v_iva := case when a.cobra_iva then round(a.cuota * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
      insert into agua_cargos (auth_user_id, abonado_id, tipo, periodo, concepto, base, iva, monto, vence)
      values (v_uid, a.id, 'mensualidad', v_per, 'Agua ' || _agua_mes_txt(v_per), a.cuota, v_iva, a.cuota + v_iva, v_per + (a.dia_cobro - 1))
      returning id into v_id;
      v_ids := v_ids || v_id; v_creados := v_creados || v_id;
    end loop;
    v_iva := 0;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Elige qué meses o cargos se pagan'; end if;
  select count(*) filter (where iva > 0), count(*) filter (where iva = 0) into v_con, v_sin
    from agua_cargos where id = any(v_ids) and abonado_id = a.id and estado in ('pendiente','parcial');
  if v_con > 0 and v_sin > 0 then raise exception 'Cobra por separado lo que lleva IVA y lo que no lleva IVA'; end if;
  select coalesce(sum(monto - pagado), 0) into v_pend from agua_cargos where id = any(v_ids) and abonado_id = a.id and estado in ('pendiente','parcial');
  if round(coalesce(p_monto, 0), 2) <= 0 then raise exception 'El monto a cobrar debe ser mayor que 0'; end if;
  if round(p_monto, 2) > round(v_pend, 2) + 0.01 then raise exception 'El monto (%) es más de lo que se debe en lo elegido (%)', round(p_monto, 2), round(v_pend, 2); end if;
  v_rest := round(p_monto, 2);
  for c in select * from agua_cargos where id = any(v_ids) and abonado_id = a.id and estado in ('pendiente','parcial')
             order by case tipo when 'deuda_inicial' then 0 else 1 end, vence, periodo nulls first, created_at for update loop
    exit when v_rest <= 0;
    v_apl := least(v_rest, round(c.monto - c.pagado, 2));
    continue when v_apl <= 0;
    v_aplic := v_aplic || jsonb_build_array(jsonb_build_object('cargo_id', c.id, 'monto', v_apl));
    v_conceptos := v_conceptos || (c.concepto || case when v_apl < round(c.monto - c.pagado, 2) then ' (abono)' else '' end);
    v_iva := v_iva + round(v_apl * c.iva / c.monto, 2);
    v_rest := round(v_rest - v_apl, 2);
  end loop;
  v_base := round(p_monto - v_iva, 2);
  v_iva_pct := case when v_iva > 0 then (cfg->>'iva_pct')::numeric else 0 end;
  insert into agua_cobros (auth_user_id, abonado_id, monto, aplicaciones, usuario, cargos_creados)
  values (v_uid, a.id, round(p_monto, 2), v_aplic, nullif(trim(coalesce(p_usuario, '')), ''), v_creados) returning id into v_cobro;
  return jsonb_build_object('ok', true, 'cobro_id', v_cobro, 'monto', round(p_monto, 2), 'base', v_base, 'iva', round(v_iva, 2), 'iva_pct', v_iva_pct,
                            'cliente_id', a.cliente_id, 'codigo', a.codigo,
                            'concepto', 'Agua ' || a.codigo || ': ' || array_to_string(v_conceptos, ', '));
end $$;

-- ---------- Confirmar el cobro con la venta ya registrada (lo llama Ventas al confirmar; se puede repetir) ----------
create or replace function public.agua_confirmar_cobro(p_cobro_id uuid, p_venta_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); k record; v record; ap jsonb; c record; v_apl numeric; v_sobra numeric := 0; v_nuevo numeric; v_txt text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  select * into k from agua_cobros where id = p_cobro_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if k.estado = 'aplicado' then return jsonb_build_object('ok', k.venta_id = p_venta_id, 'ya', true); end if;
  if k.estado not in ('pendiente','abandonado') then return jsonb_build_object('ok', false, 'motivo', 'cobro_' || k.estado); end if;
  select id, total, estado, numero_venta into v from ventas where id = p_venta_id and auth_user_id = v_uid;
  if v.id is null or v.estado = 'anulada' then return jsonb_build_object('ok', false, 'motivo', 'venta_invalida'); end if;
  if abs(coalesce(v.total, 0) - k.monto) > 0.05 then return jsonb_build_object('ok', false, 'motivo', 'monto_distinto'); end if;
  if exists (select 1 from agua_cobros where venta_id = p_venta_id and id <> k.id) then return jsonb_build_object('ok', false, 'motivo', 'otra_venta'); end if;
  for ap in select * from jsonb_array_elements(k.aplicaciones) loop
    select * into c from agua_cargos where id = (ap->>'cargo_id')::uuid and abonado_id = k.abonado_id for update;
    v_apl := round((ap->>'monto')::numeric, 2);
    if c.id is null or c.estado = 'anulado' then v_sobra := v_sobra + v_apl; continue; end if;
    v_apl := least(v_apl, round(c.monto - c.pagado, 2));               -- si otro cobro ya lo pagó, lo que sobra queda a favor
    v_sobra := v_sobra + round((ap->>'monto')::numeric, 2) - greatest(v_apl, 0);
    if v_apl > 0 then
      v_nuevo := round(c.pagado + v_apl, 2);
      update agua_cargos set pagado = v_nuevo, estado = _agua_estado_cargo(monto, v_nuevo) where id = c.id;
    end if;
  end loop;
  v_sobra := round(greatest(v_sobra, 0), 2);
  if v_sobra > 0 then update agua_abonados set saldo_favor = round(saldo_favor + v_sobra, 2), updated_at = now() where id = k.abonado_id; end if;
  update agua_cobros set estado = 'aplicado', venta_id = p_venta_id, aplicado_en = now(), a_favor = v_sobra where id = k.id;
  -- Arreglo cumplido si ya no le queda nada pendiente
  update agua_arreglos r set estado = 'cumplido'
   where r.abonado_id = k.abonado_id and r.estado = 'vigente'
     and not exists (select 1 from agua_cargos x where x.arreglo_id = r.id and x.estado in ('pendiente','parcial'));
  v_txt := 'Pago de ' || to_char(k.monto, 'FM999,999,990.00') || ' (venta ' || coalesce(v.numero_venta, '') || ')'
           || case when v_sobra > 0 then ' · ' || to_char(v_sobra, 'FM999,999,990.00') || ' quedó a favor' else '' end;
  perform _agua_evento(v_uid, k.abonado_id, 'pago', v_txt, jsonb_build_object('cobro_id', k.id, 'venta_id', p_venta_id), k.usuario);
  return jsonb_build_object('ok', true, 'a_favor', v_sobra);
end $$;

-- ---------- Si se anula la venta en Ventas, el pago se revierte solo ----------
create or replace function public.agua_revertir_por_venta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare k record; ap jsonb; c record; v_nuevo numeric;
begin
  for k in select * from agua_cobros where venta_id = new.id and estado = 'aplicado' for update loop
    for ap in select * from jsonb_array_elements(k.aplicaciones) loop
      select * into c from agua_cargos where id = (ap->>'cargo_id')::uuid for update;
      continue when c.id is null;
      v_nuevo := round(greatest(0, c.pagado - (ap->>'monto')::numeric), 2);
      update agua_cargos set pagado = v_nuevo, estado = case when c.estado = 'anulado' then 'anulado' else _agua_estado_cargo(monto, v_nuevo) end where id = c.id;
    end loop;
    if k.a_favor > 0 then
      update agua_abonados set saldo_favor = round(greatest(0, saldo_favor - k.a_favor), 2), updated_at = now() where id = k.abonado_id;
    end if;
    update agua_cobros set estado = 'anulado', anulado_en = now() where id = k.id;
    update agua_arreglos r set estado = 'vigente' where r.abonado_id = k.abonado_id and r.estado = 'cumplido'
       and exists (select 1 from agua_cargos x where x.arreglo_id = r.id and x.estado in ('pendiente','parcial'));
    perform _agua_evento(k.auth_user_id, k.abonado_id, 'pago_anulado', 'Se anuló la venta ' || coalesce(new.numero_venta, '') || ': el pago de '
                         || to_char(k.monto, 'FM999,999,990.00') || ' se revirtió', jsonb_build_object('venta_id', new.id), null);
  end loop;
  return new;
end $$;
drop trigger if exists trg_agua_revertir_por_venta on public.ventas;
create trigger trg_agua_revertir_por_venta after update of estado on public.ventas
  for each row when (new.estado = 'anulada' and old.estado is distinct from 'anulada')
  execute function public.agua_revertir_por_venta();

-- ---------- Cargo extra (reconexión u otro) y anular cargo sin pagos ----------
create or replace function public.agua_cargo_extra(p_abonado_id uuid, p_tipo text, p_concepto text, p_monto numeric, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); a record; v_id uuid; v_m numeric := round(coalesce(p_monto, 0), 2); v_iva numeric;
begin
  if p_tipo not in ('reconexion','otro') then raise exception 'Tipo de cargo no válido'; end if;
  if round(coalesce(p_monto, 0), 2) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;
  if trim(coalesce(p_concepto, '')) = '' then raise exception 'Escribe el concepto'; end if;
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid;
  if not found then raise exception 'Abonado no encontrado'; end if;
  v_iva := case when a.cobra_iva then round(v_m * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
  insert into agua_cargos (auth_user_id, abonado_id, tipo, concepto, base, iva, monto, vence)
  values (v_uid, a.id, p_tipo, trim(p_concepto), v_m, v_iva, v_m + v_iva, current_date) returning id into v_id;
  perform _agua_evento(v_uid, a.id, 'cargo', 'Cargo: ' || trim(p_concepto) || ' ' || to_char(round(p_monto, 2), 'FM999,999,990.00'), '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.agua_anular_cargo(p_cargo_id uuid, p_motivo text, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); c record;
begin
  select * into c from agua_cargos where id = p_cargo_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Cargo no encontrado'; end if;
  if c.estado = 'anulado' then return jsonb_build_object('ok', true, 'ya', true); end if;
  if c.pagado > 0 then raise exception 'Este cargo ya tiene pagos. Primero anula la venta del pago en Ventas.'; end if;
  if trim(coalesce(p_motivo, '')) = '' then raise exception 'Escribe por qué se anula'; end if;
  update agua_cargos set estado = 'anulado', anulado_motivo = trim(p_motivo), arreglo_id = null where id = c.id;
  perform _agua_evento(v_uid, c.abonado_id, 'cargo_anulado', 'Cargo anulado: ' || c.concepto || ' — ' || trim(p_motivo), '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Estado del servicio: pausar, suspender, cortar, reconectar ----------
create or replace function public.agua_cambiar_estado(p_abonado_id uuid, p_estado text, p_motivo text default null, p_cobrar_reconexion boolean default false, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); a record; v_rec numeric := 0; v_iva numeric := 0;
begin
  if p_estado not in ('activo','pausado','suspendido','cortado') then raise exception 'Estado no válido'; end if;
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Abonado no encontrado'; end if;
  if a.estado = p_estado then return jsonb_build_object('ok', true, 'ya', true); end if;
  update agua_abonados set estado = p_estado, updated_at = now() where id = a.id;
  if a.estado = 'cortado' and p_estado = 'activo' and coalesce(p_cobrar_reconexion, false) then
    v_rec := round(coalesce((cfg->>'reconexion')::numeric, 0), 2);
    if v_rec > 0 then
      v_iva := case when a.cobra_iva then round(v_rec * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
      insert into agua_cargos (auth_user_id, abonado_id, tipo, concepto, base, iva, monto, vence)
      values (v_uid, a.id, 'reconexion', 'Reconexión del servicio', v_rec, v_iva, v_rec + v_iva, current_date);
    end if;
  end if;
  perform _agua_evento(v_uid, a.id, 'estado', initcap(a.estado) || ' → ' || initcap(p_estado)
                       || case when v_rec > 0 then ' · cargo de reconexión ' || to_char(v_rec, 'FM999,999,990.00') else '' end
                       || coalesce(' — ' || nullif(trim(p_motivo), ''), ''), '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true, 'reconexion', v_rec);
end $$;

-- ---------- Arreglo de pago: toma la deuda vencida y la divide en cuotas con fecha ----------
create or replace function public.agua_crear_arreglo(p_abonado_id uuid, p_cuotas jsonb, p_notas text default null, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); a record; v_deuda numeric; v_suma numeric := 0; q jsonb; v_id uuid; n int := 0; v_ult date;
begin
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Abonado no encontrado'; end if;
  if exists (select 1 from agua_arreglos where abonado_id = a.id and estado = 'vigente') then raise exception 'Este abonado ya tiene un arreglo vigente'; end if;
  select coalesce(sum(monto - pagado), 0) into v_deuda from agua_cargos
   where abonado_id = a.id and estado in ('pendiente','parcial') and arreglo_id is null and vence <= current_date;
  v_deuda := round(v_deuda, 2);
  if v_deuda <= 0 then raise exception 'No tiene deuda vencida para hacer un arreglo'; end if;
  if jsonb_typeof(p_cuotas) <> 'array' or jsonb_array_length(p_cuotas) = 0 then raise exception 'Agrega al menos una cuota'; end if;
  if jsonb_array_length(p_cuotas) > 24 then raise exception 'Máximo 24 cuotas'; end if;
  for q in select * from jsonb_array_elements(p_cuotas) loop
    n := n + 1;
    if nullif(q->>'fecha', '') is null or (q->>'fecha')::date < current_date then raise exception 'La cuota % necesita una fecha de hoy en adelante', n; end if;
    if v_ult is not null and (q->>'fecha')::date < v_ult then raise exception 'Las fechas de las cuotas deben ir en orden'; end if;
    v_ult := (q->>'fecha')::date;
    if round(coalesce((q->>'monto')::numeric, 0), 2) <= 0 then raise exception 'La cuota % debe tener monto', n; end if;
    v_suma := v_suma + round((q->>'monto')::numeric, 2);
  end loop;
  if abs(v_suma - v_deuda) > 0.01 then raise exception 'Las cuotas suman % y la deuda vencida es %', v_suma, v_deuda; end if;
  insert into agua_arreglos (auth_user_id, abonado_id, monto, cuotas, notas, usuario)
  values (v_uid, a.id, v_deuda, p_cuotas, nullif(trim(p_notas), ''), nullif(trim(coalesce(p_usuario, '')), '')) returning id into v_id;
  update agua_cargos set arreglo_id = v_id where abonado_id = a.id and estado in ('pendiente','parcial') and arreglo_id is null and vence <= current_date;
  perform _agua_evento(v_uid, a.id, 'arreglo', 'Arreglo de pago: ' || to_char(v_deuda, 'FM999,999,990.00') || ' en ' || n || ' cuota(s)', jsonb_build_object('arreglo_id', v_id), p_usuario);
  return jsonb_build_object('ok', true, 'id', v_id, 'monto', v_deuda);
end $$;

create or replace function public.agua_anular_arreglo(p_arreglo_id uuid, p_motivo text, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); r record;
begin
  select * into r from agua_arreglos where id = p_arreglo_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Arreglo no encontrado'; end if;
  if r.estado <> 'vigente' then raise exception 'Solo se anula un arreglo vigente'; end if;
  if trim(coalesce(p_motivo, '')) = '' then raise exception 'Escribe por qué se anula'; end if;
  update agua_cargos set arreglo_id = null where arreglo_id = r.id;
  update agua_arreglos set estado = 'anulado', anulado_motivo = trim(p_motivo) where id = r.id;
  perform _agua_evento(v_uid, r.abonado_id, 'arreglo_anulado', 'Arreglo anulado — ' || trim(p_motivo), '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Reglas del panel (mora, cortes, reconexión, IVA, código, menú) ----------
create or replace function public.agua_guardar_config(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); c jsonb;
begin
  if coalesce(p->>'mora_tipo', 'ninguno') not in ('ninguno','fijo','porcentaje') then raise exception 'Tipo de mora no válido'; end if;
  c := jsonb_build_object(
    'dias_gracia', greatest(0, least(60, coalesce((p->>'dias_gracia')::int, 5))),
    'mora_tipo', coalesce(p->>'mora_tipo', 'ninguno'),
    'mora_valor', greatest(0, round(coalesce((p->>'mora_valor')::numeric, 0), 2)),
    'meses_corte', greatest(1, least(24, coalesce((p->>'meses_corte')::int, 2))),
    'reconexion', greatest(0, round(coalesce((p->>'reconexion')::numeric, 0), 2)),
    'iva_pct', greatest(0, least(100, coalesce((p->>'iva_pct')::numeric, 15))),
    'prefijo', upper(left(regexp_replace(coalesce(nullif(trim(p->>'prefijo'), ''), 'AB-'), '\s+', '', 'g'), 8)),
    'dia_cobro', greatest(1, least(28, coalesce((p->>'dia_cobro')::int, 5))),
    'menu_exclusivo', coalesce((p->>'menu_exclusivo')::boolean, false));
  if (c->>'mora_tipo') = 'porcentaje' and (c->>'mora_valor')::numeric > 100 then raise exception 'El porcentaje de mora no puede pasar de 100'; end if;
  update configuracion_empresa set agua_config = c where auth_user_id = v_uid;
  return jsonb_build_object('ok', true, 'config', c);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'agua_guardar_abonado(jsonb, text)', 'agua_importar(jsonb, text)', 'agua_generar_mes(date, text)',
    'agua_preparar_cobro(uuid, uuid[], numeric, integer, text)', 'agua_confirmar_cobro(uuid, uuid)',
    'agua_cargo_extra(uuid, text, text, numeric, text)', 'agua_anular_cargo(uuid, text, text)',
    'agua_cambiar_estado(uuid, text, text, boolean, text)', 'agua_crear_arreglo(uuid, jsonb, text, text)',
    'agua_anular_arreglo(uuid, text, text)', 'agua_guardar_config(jsonb)', 'agua_cancelar_cobro(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['_agua_cfg(uuid)', '_agua_check()', '_agua_evento(uuid, uuid, text, text, jsonb, text)', '_agua_abandonar(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
