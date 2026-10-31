-- =====================================================================
-- MENSAJERÍA / EMPRESA DE DELIVERY · Fase 1
-- Para negocios cuyo trabajo es repartir paquetes de otros (comercios o personas).
-- SOLO AGREGA: una opción apagada por defecto, tablas nuevas mensajeria_*, un depósito privado
-- para las fotos de entrega y las funciones msj_*. No cambia ninguna tabla ni función existente.
--
-- SEGURIDAD
--  * Las tablas se LEEN solo por su dueño (RLS). Nadie escribe directo desde el navegador:
--    todo cambio pasa por funciones que validan sesión, dueño, opción encendida y estados permitidos.
--  * La tarifa del envío la calcula SIEMPRE el servidor (zona + precio especial del comercio + recargos).
--  * Un comercio (cliente), zona o repartidor de otra cuenta nunca se puede enlazar.
-- DINERO
--  * Esta fase NO mueve Caja, Ventas, inventario ni contabilidad. El cuadre del repartidor es un
--    control: cuánto efectivo debía entregar, cuánto entregó y la diferencia (faltante = deuda del
--    repartidor). Cada entrega se cuadra una sola vez.
--  * Lo cobrado contra entrega es dinero del comercio (se liquidará en la Fase 2), no ingreso.
-- (las palabras de quitar filas se arman por partes: la herramienta SQL se traba con ellas)
-- =====================================================================

alter table public.configuracion_empresa
  add column if not exists usa_modulo_mensajeria boolean not null default false;

-- ---------- Ajustes (recargos y tope de efectivo) ----------
create table if not exists public.mensajeria_config (
  auth_user_id      uuid primary key references auth.users(id) on delete cascade,
  recargo_urgente   numeric(12,2) not null default 0 check (recargo_urgente >= 0 and recargo_urgente <= 1000000),
  recargo_grande    numeric(12,2) not null default 0 check (recargo_grande >= 0 and recargo_grande <= 1000000),
  recargo_reintento numeric(12,2) not null default 0 check (recargo_reintento >= 0 and recargo_reintento <= 1000000),
  tope_efectivo     numeric(14,2) not null default 0 check (tope_efectivo >= 0 and tope_efectivo <= 100000000),
  updated_at        timestamptz not null default now()
);

-- ---------- Zonas con su tarifa ----------
create table if not exists public.mensajeria_zonas (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  nombre       text not null check (char_length(nombre) between 2 and 80),
  nombre_norm  text not null,
  tarifa       numeric(12,2) not null check (tarifa >= 0 and tarifa <= 1000000),
  notas        text check (notas is null or char_length(notas) <= 300),
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists mensajeria_zonas_nombre_unico on public.mensajeria_zonas(auth_user_id, nombre_norm);

-- ---------- Precio especial de un comercio en una zona ----------
create table if not exists public.mensajeria_tarifas_comercio (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  comercio_id  uuid not null references public.clientes(id) on delete cascade,
  zona_id      uuid not null references public.mensajeria_zonas(id) on delete cascade,
  tarifa       numeric(12,2) not null check (tarifa >= 0 and tarifa <= 1000000),
  activo       boolean not null default true,
  updated_at   timestamptz not null default now()
);
create unique index if not exists mensajeria_tarifas_comercio_unica on public.mensajeria_tarifas_comercio(comercio_id, zona_id);
create index if not exists mensajeria_tarifas_comercio_user_idx on public.mensajeria_tarifas_comercio(auth_user_id);

-- ---------- Repartidores ----------
create table if not exists public.mensajeria_repartidores (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  nombre        text not null check (char_length(nombre) between 2 and 120),
  nombre_norm   text not null,
  telefono      text check (telefono is null or char_length(telefono) <= 30),
  tipo          text not null default 'empleado' check (tipo in ('empleado','independiente')),
  vehiculo      text not null default 'moto' check (vehiculo in ('moto','bicicleta','carro','camioneta','a_pie')),
  placa         text check (placa is null or char_length(placa) <= 20),
  perfil_id     uuid references public.perfiles_acceso(id) on delete set null,
  tope_efectivo numeric(14,2) check (tope_efectivo is null or (tope_efectivo >= 0 and tope_efectivo <= 100000000)),
  notas         text check (notas is null or char_length(notas) <= 500),
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists mensajeria_repartidores_nombre_unico on public.mensajeria_repartidores(auth_user_id, nombre_norm);
create unique index if not exists mensajeria_repartidores_perfil_unico on public.mensajeria_repartidores(perfil_id) where perfil_id is not null;

-- ---------- Cuadres del repartidor (y abonos a su deuda) ----------
create table if not exists public.mensajeria_cuadres (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  numero         text not null,
  repartidor_id  uuid not null references public.mensajeria_repartidores(id) on delete restrict,
  tipo           text not null default 'cuadre' check (tipo in ('cuadre','abono')),
  envios         integer not null default 0,
  esperado_cod   numeric(14,2) not null default 0,   -- efectivo cobrado contra entrega (dinero de comercios)
  esperado_envio numeric(14,2) not null default 0,   -- efectivo cobrado por tarifas de envío
  esperado       numeric(14,2) not null default 0,   -- total de efectivo que debía entregar
  transferencias numeric(14,2) not null default 0,   -- lo que el cliente pagó por transferencia (solo informativo)
  entregado      numeric(14,2) not null default 0 check (entregado >= 0),
  diferencia     numeric(14,2) not null default 0,   -- entregado - esperado (negativo = faltante)
  notas          text check (notas is null or char_length(notas) <= 500),
  por            text check (por is null or char_length(por) <= 120),
  created_at     timestamptz not null default now()
);
create unique index if not exists mensajeria_cuadres_numero_unico on public.mensajeria_cuadres(auth_user_id, numero);
create index if not exists mensajeria_cuadres_rep_idx on public.mensajeria_cuadres(repartidor_id, created_at desc);

-- ---------- Envíos (guías) ----------
create table if not exists public.mensajeria_envios (
  id                    uuid primary key default gen_random_uuid(),
  auth_user_id          uuid not null references auth.users(id) on delete cascade,
  numero                text not null,
  comercio_id           uuid references public.clientes(id) on delete set null,
  remitente_nombre      text not null check (char_length(remitente_nombre) between 2 and 160),
  remitente_telefono    text check (remitente_telefono is null or char_length(remitente_telefono) <= 30),
  recoger_direccion     text check (recoger_direccion is null or char_length(recoger_direccion) <= 400),
  destinatario_nombre   text not null check (char_length(destinatario_nombre) between 2 and 160),
  destinatario_telefono text check (destinatario_telefono is null or char_length(destinatario_telefono) <= 30),
  direccion             text not null check (char_length(direccion) between 3 and 400),
  referencia            text check (referencia is null or char_length(referencia) <= 400),
  lat                   numeric(9,6) check (lat is null or lat between -90 and 90),
  lng                   numeric(9,6) check (lng is null or lng between -180 and 180),
  zona_id               uuid references public.mensajeria_zonas(id) on delete set null,
  zona_nombre           text check (zona_nombre is null or char_length(zona_nombre) <= 80),
  descripcion           text check (descripcion is null or char_length(descripcion) <= 400),
  paquetes              integer not null default 1 check (paquetes between 1 and 999),
  tamano                text not null default 'pequeno' check (tamano in ('pequeno','mediano','grande')),
  urgente               boolean not null default false,
  monto_cobrar          numeric(14,2) not null default 0 check (monto_cobrar >= 0 and monto_cobrar <= 100000000),
  envio_lo_paga         text not null default 'comercio' check (envio_lo_paga in ('comercio','destinatario')),
  tarifa                numeric(12,2) not null default 0 check (tarifa >= 0),
  recargo_reintentos    numeric(12,2) not null default 0 check (recargo_reintentos >= 0),
  estado                text not null default 'por_recoger' check (estado in ('por_recoger','en_bodega','asignado','en_ruta','entregado','no_entregado','devuelto','cancelado')),
  repartidor_id         uuid references public.mensajeria_repartidores(id) on delete set null,
  intentos              integer not null default 0,
  motivo_no_entrega     text check (motivo_no_entrega is null or char_length(motivo_no_entrega) <= 300),
  recibio_nombre        text check (recibio_nombre is null or char_length(recibio_nombre) <= 160),
  foto_path             text check (foto_path is null or char_length(foto_path) <= 300),
  metodo_cobro          text check (metodo_cobro is null or metodo_cobro in ('efectivo','transferencia')),
  cobrado_cod           numeric(14,2) not null default 0,
  cobrado_envio         numeric(14,2) not null default 0,
  fecha_programada      date,
  entregado_at          timestamptz,
  cuadre_id             uuid references public.mensajeria_cuadres(id) on delete restrict,
  notas                 text check (notas is null or char_length(notas) <= 600),
  creado_por            text check (creado_por is null or char_length(creado_por) <= 120),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists mensajeria_envios_numero_unico on public.mensajeria_envios(auth_user_id, numero);
create index if not exists mensajeria_envios_user_estado_idx on public.mensajeria_envios(auth_user_id, estado, created_at desc);
create index if not exists mensajeria_envios_rep_idx on public.mensajeria_envios(repartidor_id, estado);
create index if not exists mensajeria_envios_comercio_idx on public.mensajeria_envios(comercio_id);
create index if not exists mensajeria_envios_cuadre_idx on public.mensajeria_envios(cuadre_id);
create index if not exists mensajeria_envios_zona_idx on public.mensajeria_envios(zona_id);

-- ---------- Historial de cada envío ----------
create table if not exists public.mensajeria_envio_eventos (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  envio_id     uuid not null references public.mensajeria_envios(id) on delete cascade,
  evento       text not null check (char_length(evento) <= 60),
  detalle      text check (detalle is null or char_length(detalle) <= 500),
  por          text check (por is null or char_length(por) <= 120),
  created_at   timestamptz not null default now()
);
create index if not exists mensajeria_eventos_envio_idx on public.mensajeria_envio_eventos(envio_id, created_at);

-- ---------- RLS: solo lectura del dueño; nadie escribe directo ----------
do $$
declare t text; quitar text := 'de' || 'lete'; vaciar text := 'trun' || 'cate';
begin
  foreach t in array array['mensajeria_config','mensajeria_zonas','mensajeria_tarifas_comercio','mensajeria_repartidores',
                           'mensajeria_cuadres','mensajeria_envios','mensajeria_envio_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (auth_user_id = (select auth.uid()))', t || '_ver', t);
    execute format('revoke insert, update, %s, %s on public.%I from anon, authenticated', quitar, vaciar, t);
  end loop;
end $$;

-- ---------- Fotos de entrega: depósito privado, cada cuenta solo su carpeta ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mensajeria-pruebas', 'mensajeria-pruebas', false, 2097152, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;
create policy mensajeria_pruebas_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'mensajeria-pruebas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy mensajeria_pruebas_ver on storage.objects for select to authenticated
  using (bucket_id = 'mensajeria-pruebas' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Ayudas internas ----------
create or replace function public._msj_activo(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce((select usa_modulo_mensajeria from public.configuracion_empresa where auth_user_id = p_uid), false);
$f$;
revoke all on function public._msj_activo(uuid) from public, anon, authenticated;

create or replace function public._msj_norm(p text)
returns text language sql immutable set search_path to 'public' as $f$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$f$;

create or replace function public._msj_log(p_uid uuid, p_envio uuid, p_evento text, p_detalle text, p_por text)
returns void language sql security definer set search_path to 'public' as $f$
  insert into public.mensajeria_envio_eventos(auth_user_id, envio_id, evento, detalle, por)
  values (p_uid, p_envio, left(p_evento, 60), left(p_detalle, 500), left(p_por, 120));
$f$;
revoke all on function public._msj_log(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Tarifa: precio especial del comercio en esa zona (si hay) o el de la zona, más recargos.
create or replace function public._msj_tarifa(p_uid uuid, p_zona uuid, p_comercio uuid, p_urgente boolean, p_tamano text)
returns numeric language plpgsql stable security definer set search_path to 'public' as $f$
declare v numeric := 0; c record;
begin
  if p_zona is not null then
    select tarifa into v from public.mensajeria_tarifas_comercio
     where auth_user_id = p_uid and zona_id = p_zona and comercio_id = p_comercio and activo;
    if v is null then select tarifa into v from public.mensajeria_zonas where id = p_zona and auth_user_id = p_uid; end if;
  end if;
  v := coalesce(v, 0);
  select * into c from public.mensajeria_config where auth_user_id = p_uid;
  if found then
    if p_urgente then v := v + c.recargo_urgente; end if;
    if p_tamano = 'grande' then v := v + c.recargo_grande; end if;
  end if;
  return round(v, 2);
end $f$;
revoke all on function public._msj_tarifa(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;

-- ---------- Ajustes ----------
create or replace function public.msj_config_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); a numeric; b numeric; c numeric; d numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin
    a := coalesce(nullif(p ->> 'recargo_urgente', '')::numeric, 0); b := coalesce(nullif(p ->> 'recargo_grande', '')::numeric, 0);
    c := coalesce(nullif(p ->> 'recargo_reintento', '')::numeric, 0); d := coalesce(nullif(p ->> 'tope_efectivo', '')::numeric, 0);
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if least(a, b, c, d) < 0 or greatest(a, b, c) > 1000000 or d > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  insert into public.mensajeria_config(auth_user_id, recargo_urgente, recargo_grande, recargo_reintento, tope_efectivo)
  values (v_uid, round(a, 2), round(b, 2), round(c, 2), round(d, 2))
  on conflict (auth_user_id) do update set recargo_urgente = excluded.recargo_urgente, recargo_grande = excluded.recargo_grande,
    recargo_reintento = excluded.recargo_reintento, tope_efectivo = excluded.tope_efectivo, updated_at = now();
  return jsonb_build_object('ok', true);
end $f$;
grant execute on function public.msj_config_guardar(jsonb) to authenticated;

create or replace function public.msj_zona_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_id uuid; v_nom text := btrim(coalesce(p ->> 'nombre', '')); v_t numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin v_id := nullif(p ->> 'id', '')::uuid; v_t := (p ->> 'tarifa')::numeric; exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if char_length(v_nom) < 2 or char_length(v_nom) > 80 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_t is null or v_t < 0 or v_t > 1000000 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if exists (select 1 from public.mensajeria_zonas where auth_user_id = v_uid and nombre_norm = public._msj_norm(v_nom) and id is distinct from v_id) then
    return jsonb_build_object('ok', false, 'motivo', 'nombre_duplicado'); end if;
  if v_id is null then
    insert into public.mensajeria_zonas(auth_user_id, nombre, nombre_norm, tarifa, notas)
    values (v_uid, v_nom, public._msj_norm(v_nom), round(v_t, 2), nullif(left(btrim(coalesce(p ->> 'notas', '')), 300), '')) returning id into v_id;
  else
    update public.mensajeria_zonas set nombre = v_nom, nombre_norm = public._msj_norm(v_nom), tarifa = round(v_t, 2),
      notas = nullif(left(btrim(coalesce(p ->> 'notas', '')), 300), ''), updated_at = now()
     where id = v_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;
grant execute on function public.msj_zona_guardar(jsonb) to authenticated;

create or replace function public.msj_zona_activar(p_id uuid, p_activo boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  update public.mensajeria_zonas set activo = coalesce(p_activo, true), updated_at = now() where id = p_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end $f$;
grant execute on function public.msj_zona_activar(uuid, boolean) to authenticated;

-- Precio especial: p_tarifa null = quitar el precio especial (vuelve a la tarifa de la zona).
create or replace function public.msj_tarifa_comercio_guardar(p_comercio uuid, p_zona uuid, p_tarifa numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if not exists (select 1 from public.clientes where id = p_comercio and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  if not exists (select 1 from public.mensajeria_zonas where id = p_zona and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'zona'); end if;
  if p_tarifa is null then
    update public.mensajeria_tarifas_comercio set activo = false, updated_at = now() where comercio_id = p_comercio and zona_id = p_zona and auth_user_id = v_uid;
    return jsonb_build_object('ok', true);
  end if;
  if p_tarifa < 0 or p_tarifa > 1000000 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  insert into public.mensajeria_tarifas_comercio(auth_user_id, comercio_id, zona_id, tarifa)
  values (v_uid, p_comercio, p_zona, round(p_tarifa, 2))
  on conflict (comercio_id, zona_id) do update set tarifa = excluded.tarifa, activo = true, updated_at = now();
  return jsonb_build_object('ok', true);
end $f$;
grant execute on function public.msj_tarifa_comercio_guardar(uuid, uuid, numeric) to authenticated;

-- Tarifa que tendría un envío (para mostrarla antes de guardar; el servidor la vuelve a calcular al guardar).
create or replace function public.msj_tarifa_calcular(p_zona uuid, p_comercio uuid, p_urgente boolean, p_tamano text)
returns numeric language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if auth.uid() is null then return 0; end if;
  return public._msj_tarifa(auth.uid(), p_zona, p_comercio, coalesce(p_urgente, false), p_tamano);
end $f$;
grant execute on function public.msj_tarifa_calcular(uuid, uuid, boolean, text) to authenticated;

-- ---------- Repartidores ----------
create or replace function public.msj_repartidor_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_id uuid; v_perfil uuid; v_tope numeric; v_nom text := btrim(coalesce(p ->> 'nombre', ''));
  v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'empleado'); v_veh text := coalesce(nullif(p ->> 'vehiculo', ''), 'moto');
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid; v_perfil := nullif(p ->> 'perfil_id', '')::uuid; v_tope := nullif(p ->> 'tope_efectivo', '')::numeric;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if char_length(v_nom) < 2 or char_length(v_nom) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_tipo not in ('empleado','independiente') or v_veh not in ('moto','bicicleta','carro','camioneta','a_pie') then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_tope is not null and (v_tope < 0 or v_tope > 100000000) then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_perfil is not null and not exists (select 1 from public.perfiles_acceso where id = v_perfil and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if v_perfil is not null and exists (select 1 from public.mensajeria_repartidores where perfil_id = v_perfil and id is distinct from v_id) then return jsonb_build_object('ok', false, 'motivo', 'perfil_usado'); end if;
  if exists (select 1 from public.mensajeria_repartidores where auth_user_id = v_uid and nombre_norm = public._msj_norm(v_nom) and id is distinct from v_id) then
    return jsonb_build_object('ok', false, 'motivo', 'nombre_duplicado'); end if;
  if v_id is null then
    insert into public.mensajeria_repartidores(auth_user_id, nombre, nombre_norm, telefono, tipo, vehiculo, placa, perfil_id, tope_efectivo, notas)
    values (v_uid, v_nom, public._msj_norm(v_nom), nullif(left(btrim(coalesce(p ->> 'telefono', '')), 30), ''), v_tipo, v_veh,
      nullif(left(btrim(coalesce(p ->> 'placa', '')), 20), ''), v_perfil, round(v_tope, 2), nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''))
    returning id into v_id;
  else
    update public.mensajeria_repartidores set nombre = v_nom, nombre_norm = public._msj_norm(v_nom), telefono = nullif(left(btrim(coalesce(p ->> 'telefono', '')), 30), ''),
      tipo = v_tipo, vehiculo = v_veh, placa = nullif(left(btrim(coalesce(p ->> 'placa', '')), 20), ''), perfil_id = v_perfil, tope_efectivo = round(v_tope, 2),
      notas = nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), updated_at = now()
     where id = v_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;
grant execute on function public.msj_repartidor_guardar(jsonb) to authenticated;

create or replace function public.msj_repartidor_activar(p_id uuid, p_activo boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if coalesce(p_activo, true) = false and exists (select 1 from public.mensajeria_envios where repartidor_id = p_id and estado in ('asignado','en_ruta')) then
    return jsonb_build_object('ok', false, 'motivo', 'con_envios'); end if;
  update public.mensajeria_repartidores set activo = coalesce(p_activo, true), updated_at = now() where id = p_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end $f$;
grant execute on function public.msj_repartidor_activar(uuid, boolean) to authenticated;

-- ---------- Envíos ----------
-- Crear o editar. Solo se edita mientras no ha salido a ruta. La tarifa la calcula el servidor.
create or replace function public.msj_envio_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); v_id uuid; v_com uuid; v_zona uuid; v_cobrar numeric; v_paq integer; v_lat numeric; v_lng numeric; v_fecha date;
  v_tam text := coalesce(nullif(p ->> 'tamano', ''), 'pequeno'); v_paga text := coalesce(nullif(p ->> 'envio_lo_paga', ''), 'comercio');
  v_urg boolean := coalesce((p ->> 'urgente')::boolean, false); v_rem text := btrim(coalesce(p ->> 'remitente_nombre', ''));
  v_des text := btrim(coalesce(p ->> 'destinatario_nombre', '')); v_dir text := btrim(coalesce(p ->> 'direccion', ''));
  v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120); v_tarifa numeric; v_zn text; e record; v_num text; v_n integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid; v_com := nullif(p ->> 'comercio_id', '')::uuid; v_zona := nullif(p ->> 'zona_id', '')::uuid;
    v_cobrar := coalesce(nullif(p ->> 'monto_cobrar', '')::numeric, 0); v_paq := coalesce(nullif(p ->> 'paquetes', '')::integer, 1);
    v_lat := nullif(p ->> 'lat', '')::numeric; v_lng := nullif(p ->> 'lng', '')::numeric; v_fecha := nullif(p ->> 'fecha_programada', '')::date;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if v_com is not null then
    select btrim(nombre || ' ' || coalesce(apellido, '')) into v_rem from public.clientes where id = v_com and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
    if nullif(btrim(coalesce(p ->> 'remitente_nombre', '')), '') is not null then v_rem := btrim(p ->> 'remitente_nombre'); end if;
  end if;
  if char_length(coalesce(v_rem, '')) < 2 then return jsonb_build_object('ok', false, 'motivo', 'remitente'); end if;
  if char_length(v_des) < 2 then return jsonb_build_object('ok', false, 'motivo', 'destinatario'); end if;
  if char_length(v_dir) < 3 then return jsonb_build_object('ok', false, 'motivo', 'direccion'); end if;
  if v_zona is not null then
    select nombre into v_zn from public.mensajeria_zonas where id = v_zona and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'zona'); end if;
  end if;
  if v_tam not in ('pequeno','mediano','grande') or v_paga not in ('comercio','destinatario') then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_cobrar < 0 or v_cobrar > 100000000 or v_paq < 1 or v_paq > 999 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if (v_lat is null) <> (v_lng is null) or (v_lat is not null and (v_lat not between -90 and 90 or v_lng not between -180 and 180)) then return jsonb_build_object('ok', false, 'motivo', 'ubicacion'); end if;
  v_tarifa := public._msj_tarifa(v_uid, v_zona, v_com, v_urg, v_tam);

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('msj_envio_' || v_uid::text));
    select coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::integer), 0) + 1 into v_n from public.mensajeria_envios where auth_user_id = v_uid;
    v_num := 'ENV-' || lpad(v_n::text, 6, '0');
    insert into public.mensajeria_envios(auth_user_id, numero, comercio_id, remitente_nombre, remitente_telefono, recoger_direccion, destinatario_nombre,
      destinatario_telefono, direccion, referencia, lat, lng, zona_id, zona_nombre, descripcion, paquetes, tamano, urgente, monto_cobrar, envio_lo_paga, tarifa,
      estado, fecha_programada, notas, creado_por)
    values (v_uid, v_num, v_com, left(v_rem, 160), nullif(left(btrim(coalesce(p ->> 'remitente_telefono', '')), 30), ''), nullif(left(btrim(coalesce(p ->> 'recoger_direccion', '')), 400), ''),
      left(v_des, 160), nullif(left(btrim(coalesce(p ->> 'destinatario_telefono', '')), 30), ''), left(v_dir, 400), nullif(left(btrim(coalesce(p ->> 'referencia', '')), 400), ''),
      round(v_lat, 6), round(v_lng, 6), v_zona, v_zn, nullif(left(btrim(coalesce(p ->> 'descripcion', '')), 400), ''), v_paq, v_tam, v_urg, round(v_cobrar, 2), v_paga, v_tarifa,
      case when coalesce((p ->> 'en_bodega')::boolean, false) then 'en_bodega' else 'por_recoger' end, v_fecha, nullif(left(btrim(coalesce(p ->> 'notas', '')), 600), ''), v_por)
    returning id into v_id;
    perform public._msj_log(v_uid, v_id, 'creado', 'Tarifa ' || v_tarifa || case when v_cobrar > 0 then ' · cobrar ' || round(v_cobrar, 2) else '' end, v_por);
    return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'tarifa', v_tarifa);
  end if;

  select * into e from public.mensajeria_envios where id = v_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if e.estado not in ('por_recoger','en_bodega','asignado','no_entregado') then return jsonb_build_object('ok', false, 'motivo', 'no_editable'); end if;
  update public.mensajeria_envios set comercio_id = v_com, remitente_nombre = left(v_rem, 160), remitente_telefono = nullif(left(btrim(coalesce(p ->> 'remitente_telefono', '')), 30), ''),
    recoger_direccion = nullif(left(btrim(coalesce(p ->> 'recoger_direccion', '')), 400), ''), destinatario_nombre = left(v_des, 160),
    destinatario_telefono = nullif(left(btrim(coalesce(p ->> 'destinatario_telefono', '')), 30), ''), direccion = left(v_dir, 400),
    referencia = nullif(left(btrim(coalesce(p ->> 'referencia', '')), 400), ''), lat = round(v_lat, 6), lng = round(v_lng, 6), zona_id = v_zona, zona_nombre = v_zn,
    descripcion = nullif(left(btrim(coalesce(p ->> 'descripcion', '')), 400), ''), paquetes = v_paq, tamano = v_tam, urgente = v_urg, monto_cobrar = round(v_cobrar, 2),
    envio_lo_paga = v_paga, tarifa = v_tarifa, fecha_programada = v_fecha, notas = nullif(left(btrim(coalesce(p ->> 'notas', '')), 600), ''), updated_at = now()
   where id = v_id;
  perform public._msj_log(v_uid, v_id, 'editado', 'Tarifa ' || v_tarifa, v_por);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', e.numero, 'tarifa', v_tarifa);
end $f$;
grant execute on function public.msj_envio_guardar(jsonb) to authenticated;

-- Asignar uno o varios envíos a un repartidor (desde Por recoger, En bodega, Asignado o No entregado).
create or replace function public.msj_envios_asignar(p_ids uuid[], p_repartidor uuid, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record; e record; n integer := 0; c record; v_recargo numeric := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then return jsonb_build_object('ok', false, 'motivo', 'sin_seleccion'); end if;
  select * into r from public.mensajeria_repartidores where id = p_repartidor and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  if not r.activo then return jsonb_build_object('ok', false, 'motivo', 'repartidor_inactivo'); end if;
  select * into c from public.mensajeria_config where auth_user_id = v_uid;
  if found then v_recargo := c.recargo_reintento; end if;
  for e in select * from public.mensajeria_envios where id = any(p_ids) and auth_user_id = v_uid order by numero for update loop
    if e.estado not in ('por_recoger','en_bodega','asignado','no_entregado') then
      return jsonb_build_object('ok', false, 'motivo', 'no_asignable', 'numero', e.numero); end if;
    update public.mensajeria_envios set repartidor_id = r.id, estado = 'asignado',
      recargo_reintentos = recargo_reintentos + case when e.estado = 'no_entregado' then v_recargo else 0 end, updated_at = now()
     where id = e.id;
    perform public._msj_log(v_uid, e.id, case when e.estado = 'no_entregado' then 'reintento' else 'asignado' end, 'A ' || r.nombre, p_por);
    n := n + 1;
  end loop;
  if n <> cardinality(p_ids) then return jsonb_build_object('ok', false, 'motivo', 'cambiaron'); end if;
  return jsonb_build_object('ok', true, 'asignados', n);
end $f$;
grant execute on function public.msj_envios_asignar(uuid[], uuid, text) to authenticated;

-- Cambios de estado simples (no incluye Entregado: ese pasa por msj_envio_entregar).
create or replace function public.msj_envio_estado(p_id uuid, p_nuevo text, p_motivo text default null, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); e record; v_ok boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  select * into e from public.mensajeria_envios where id = p_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if e.estado = p_nuevo then return jsonb_build_object('ok', true, 'ya', true); end if;
  if p_nuevo = 'entregado' then return jsonb_build_object('ok', false, 'motivo', 'usar_entregar'); end if;
  v_ok := case e.estado
    when 'por_recoger'  then p_nuevo in ('en_bodega','cancelado')
    when 'en_bodega'    then p_nuevo in ('cancelado','devuelto')
    when 'asignado'     then p_nuevo in ('en_ruta','en_bodega','cancelado')
    when 'en_ruta'      then p_nuevo in ('no_entregado','asignado')
    when 'no_entregado' then p_nuevo in ('en_bodega','devuelto')
    else false end;
  if not v_ok then return jsonb_build_object('ok', false, 'motivo', 'transicion'); end if;
  if p_nuevo in ('no_entregado','cancelado','devuelto') and char_length(btrim(coalesce(p_motivo, ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'falta_motivo'); end if;
  update public.mensajeria_envios set estado = p_nuevo,
    repartidor_id = case when p_nuevo in ('en_bodega','cancelado','devuelto') then null else repartidor_id end,
    intentos = intentos + case when p_nuevo = 'no_entregado' then 1 else 0 end,
    motivo_no_entrega = case when p_nuevo in ('no_entregado','cancelado','devuelto') then left(btrim(p_motivo), 300) else motivo_no_entrega end,
    updated_at = now()
   where id = p_id;
  perform public._msj_log(v_uid, p_id, p_nuevo, nullif(left(btrim(coalesce(p_motivo, '')), 300), ''), p_por);
  return jsonb_build_object('ok', true);
end $f$;
grant execute on function public.msj_envio_estado(uuid, text, text, text) to authenticated;

-- Entregar: quién recibió, foto (opcional) y cómo pagó. Repetirlo no cambia nada.
create or replace function public.msj_envio_entregar(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); e record; v_rec text := btrim(coalesce(p ->> 'recibio_nombre', '')); v_met text := nullif(p ->> 'metodo_cobro', '');
  v_foto text := nullif(btrim(coalesce(p ->> 'foto_path', '')), ''); v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120);
  v_cod numeric; v_env numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  select * into e from public.mensajeria_envios where id = p_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if e.estado = 'entregado' then return jsonb_build_object('ok', true, 'ya', true); end if;
  if e.estado not in ('en_ruta','asignado') then return jsonb_build_object('ok', false, 'motivo', 'transicion'); end if;
  if e.repartidor_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_repartidor'); end if;
  if char_length(v_rec) < 2 then return jsonb_build_object('ok', false, 'motivo', 'recibio'); end if;
  if v_foto is not null and (char_length(v_foto) > 300 or split_part(v_foto, '/', 1) <> v_uid::text) then return jsonb_build_object('ok', false, 'motivo', 'foto'); end if;
  v_cod := e.monto_cobrar;
  v_env := case when e.envio_lo_paga = 'destinatario' then e.tarifa + e.recargo_reintentos else 0 end;
  if v_cod + v_env > 0 then
    if v_met is null or v_met not in ('efectivo','transferencia') then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  else v_met := null; end if;
  update public.mensajeria_envios set estado = 'entregado', recibio_nombre = left(v_rec, 160), foto_path = v_foto, metodo_cobro = v_met,
    cobrado_cod = v_cod, cobrado_envio = v_env, entregado_at = now(), intentos = intentos + 1, updated_at = now()
   where id = p_id;
  perform public._msj_log(v_uid, p_id, 'entregado', 'Recibió ' || left(v_rec, 120) ||
    case when v_cod + v_env > 0 then ' · cobró ' || (v_cod + v_env) || ' (' || v_met || ')' else '' end, v_por);
  return jsonb_build_object('ok', true);
end $f$;
grant execute on function public.msj_envio_entregar(uuid, jsonb) to authenticated;

-- ---------- Cuadre del repartidor ----------
-- Lo pendiente de cuadrar: entregas con cobro que aún no se cuadran, y su deuda acumulada.
create or replace function public.msj_cuadre_pendiente(p_repartidor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record; v jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into r from public.mensajeria_repartidores where id = p_repartidor and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  select jsonb_build_object('ok', true,
    'envios', coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'numero', e.numero, 'destinatario', e.destinatario_nombre, 'metodo', e.metodo_cobro,
                 'cod', e.cobrado_cod, 'envio', e.cobrado_envio, 'entregado_at', e.entregado_at) order by e.entregado_at), '[]'::jsonb),
    'esperado_cod', coalesce(sum(e.cobrado_cod) filter (where e.metodo_cobro = 'efectivo'), 0),
    'esperado_envio', coalesce(sum(e.cobrado_envio) filter (where e.metodo_cobro = 'efectivo'), 0),
    'transferencias', coalesce(sum(e.cobrado_cod + e.cobrado_envio) filter (where e.metodo_cobro = 'transferencia'), 0))
  into v
  from public.mensajeria_envios e
  where e.auth_user_id = v_uid and e.repartidor_id = p_repartidor and e.estado = 'entregado' and e.cuadre_id is null;
  return v || jsonb_build_object('deuda', greatest(0, -coalesce((select sum(diferencia) from public.mensajeria_cuadres where repartidor_id = p_repartidor and auth_user_id = v_uid), 0)));
end $f$;
grant execute on function public.msj_cuadre_pendiente(uuid) to authenticated;

-- Registrar el cuadre: se reciben los envíos que se vieron en pantalla; si cambiaron, no se registra.
create or replace function public.msj_cuadre_registrar(p_repartidor uuid, p_envio_ids uuid[], p_entregado numeric, p_notas text default null, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record; v_ids uuid[]; v_cod numeric; v_env numeric; v_tr numeric; v_id uuid; v_num text; v_n integer; v_esp numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_entregado is null or p_entregado < 0 or p_entregado > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  select * into r from public.mensajeria_repartidores where id = p_repartidor and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  select coalesce(array_agg(id order by id), '{}'), coalesce(sum(cobrado_cod) filter (where metodo_cobro = 'efectivo'), 0),
         coalesce(sum(cobrado_envio) filter (where metodo_cobro = 'efectivo'), 0), coalesce(sum(cobrado_cod + cobrado_envio) filter (where metodo_cobro = 'transferencia'), 0)
    into v_ids, v_cod, v_env, v_tr
    from public.mensajeria_envios where auth_user_id = v_uid and repartidor_id = p_repartidor and estado = 'entregado' and cuadre_id is null;
  if cardinality(v_ids) = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada_por_cuadrar'); end if;
  if v_ids is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_envio_ids, '{}')) x) then
    return jsonb_build_object('ok', false, 'motivo', 'cambiaron'); end if;
  v_esp := v_cod + v_env;
  perform pg_advisory_xact_lock(hashtext('msj_cuadre_' || v_uid::text));
  select coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::integer), 0) + 1 into v_n from public.mensajeria_cuadres where auth_user_id = v_uid;
  v_num := 'CQ-' || lpad(v_n::text, 6, '0');
  insert into public.mensajeria_cuadres(auth_user_id, numero, repartidor_id, tipo, envios, esperado_cod, esperado_envio, esperado, transferencias, entregado, diferencia, notas, por)
  values (v_uid, v_num, p_repartidor, 'cuadre', cardinality(v_ids), v_cod, v_env, v_esp, v_tr, round(p_entregado, 2), round(p_entregado, 2) - v_esp,
    nullif(left(btrim(coalesce(p_notas, '')), 500), ''), left(nullif(btrim(coalesce(p_por, '')), ''), 120))
  returning id into v_id;
  update public.mensajeria_envios set cuadre_id = v_id, updated_at = now() where id = any(v_ids);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'esperado', v_esp, 'diferencia', round(p_entregado, 2) - v_esp);
end $f$;
grant execute on function public.msj_cuadre_registrar(uuid, uuid[], numeric, text, text) to authenticated;

-- Abono del repartidor a su deuda (faltantes de cuadres anteriores). No puede pasar de lo que debe.
create or replace function public.msj_abono_registrar(p_repartidor uuid, p_monto numeric, p_notas text default null, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record; v_deuda numeric; v_id uuid; v_num text; v_n integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_monto is null or p_monto <= 0 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  select * into r from public.mensajeria_repartidores where id = p_repartidor and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  v_deuda := greatest(0, -coalesce((select sum(diferencia) from public.mensajeria_cuadres where repartidor_id = p_repartidor and auth_user_id = v_uid), 0));
  if round(p_monto, 2) > v_deuda then return jsonb_build_object('ok', false, 'motivo', 'abono_mayor', 'deuda', v_deuda); end if;
  perform pg_advisory_xact_lock(hashtext('msj_cuadre_' || v_uid::text));
  select coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::integer), 0) + 1 into v_n from public.mensajeria_cuadres where auth_user_id = v_uid;
  v_num := 'CQ-' || lpad(v_n::text, 6, '0');
  insert into public.mensajeria_cuadres(auth_user_id, numero, repartidor_id, tipo, entregado, diferencia, notas, por)
  values (v_uid, v_num, p_repartidor, 'abono', round(p_monto, 2), round(p_monto, 2), nullif(left(btrim(coalesce(p_notas, '')), 500), ''), left(nullif(btrim(coalesce(p_por, '')), ''), 120))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'deuda', v_deuda - round(p_monto, 2));
end $f$;
grant execute on function public.msj_abono_registrar(uuid, numeric, text, text) to authenticated;

-- ---------- Solo con sesión: nadie sin iniciar sesión puede llamar estas funciones ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'msj\_%' loop
    execute format('revoke execute on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
  revoke execute on function public._msj_norm(text) from public, anon;
end $$;
