-- =====================================================================
-- MENSAJERÍA / DELIVERY · Fase 4: portal del comercio, ubicación del repartidor y demo
-- SOLO AGREGA: una tabla (enlaces del portal), columnas de ubicación en repartidores y funciones nuevas.
-- No cambia ninguna tabla ni función existente; no toca dinero, Caja ni Ventas (la demo usa las mismas
-- funciones de siempre, así su dinero cuadra igual que en una cuenta real).
--
-- PORTAL DEL COMERCIO (portal-comercio.html#t=CÓDIGO, sin cuenta)
--  * El negocio crea un enlace por comercio (código aleatorio de 40 caracteres) y se lo manda por WhatsApp.
--    Se puede apagar o cambiar por uno nuevo cuando quiera (el anterior deja de servir).
--  * Con el enlace el comercio ve SOLO lo suyo: sus envíos de los últimos 60 días, lo que se le debe
--    liquidar y sus liquidaciones. Puede pedir envíos nuevos (quedan "Por recoger", con la tarifa que
--    calcula el servidor). Máximo 150 envíos por día desde el portal.
-- UBICACIÓN DEL REPARTIDOR
--  * Solo si el repartidor lo activa en "Mis entregas" (el teléfono pide permiso). Se guarda el último punto;
--    la oficina lo abre en Google Maps. Nunca se muestra al cliente final.
-- DEMO
--  * Cuenta pública "Envíos Express Managua" con datos de ejemplo; cada día se le agregan envíos nuevos.
-- =====================================================================

create table if not exists public.mensajeria_portal_links (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  comercio_id  uuid not null references public.clientes(id) on delete cascade,
  token        text not null unique check (token ~ '^[0-9a-f]{40}$'),
  activo       boolean not null default true,
  usado_at     timestamptz,
  creado_por   text check (creado_por is null or char_length(creado_por) <= 120),
  created_at   timestamptz not null default now()
);
create index if not exists mensajeria_portal_links_com_idx on public.mensajeria_portal_links(comercio_id, activo);
create unique index if not exists mensajeria_portal_links_un_activo on public.mensajeria_portal_links(comercio_id) where activo;
do $$
declare quitar text := 'de' || 'lete'; vaciar text := 'trun' || 'cate';
begin
  execute 'alter table public.mensajeria_portal_links enable row level security';
  execute 'create policy mensajeria_portal_links_ver on public.mensajeria_portal_links for select using (auth_user_id = (select auth.uid()))';
  execute format('revoke insert, update, %s, %s on public.mensajeria_portal_links from anon, authenticated', quitar, vaciar);
end $$;

alter table public.mensajeria_repartidores
  add column if not exists ubic_lat numeric(9,6) check (ubic_lat is null or ubic_lat between -90 and 90),
  add column if not exists ubic_lng numeric(9,6) check (ubic_lng is null or ubic_lng between -180 and 180),
  add column if not exists ubic_precision integer,
  add column if not exists ubic_at timestamptz;

create or replace function public._msj_token() returns text language sql volatile as $f$
  select replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
$f$;

-- ---------- Portal: el dueño crea / cambia / apaga el enlace de un comercio ----------
create or replace function public.msj_portal_link(p_comercio uuid, p_accion text default 'obtener')
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); l record; v_tok text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if not exists (select 1 from public.clientes where id = p_comercio and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  if p_accion not in ('obtener', 'nuevo', 'apagar') then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_portal_' || p_comercio::text));
  select * into l from public.mensajeria_portal_links where comercio_id = p_comercio and auth_user_id = v_uid and activo;
  if p_accion = 'apagar' then
    update public.mensajeria_portal_links set activo = false where comercio_id = p_comercio and auth_user_id = v_uid and activo;
    return jsonb_build_object('ok', true, 'token', null);
  end if;
  if found and p_accion = 'obtener' then return jsonb_build_object('ok', true, 'token', l.token); end if;
  update public.mensajeria_portal_links set activo = false where comercio_id = p_comercio and auth_user_id = v_uid and activo;
  v_tok := public._msj_token();
  insert into public.mensajeria_portal_links(auth_user_id, comercio_id, token) values (v_uid, p_comercio, v_tok);
  return jsonb_build_object('ok', true, 'token', v_tok, 'nuevo', true);
end $f$;

-- Crear un envío (mismas reglas que msj_envio_guardar al crear). Interna: la usan el portal y la demo.
create or replace function public._msj_envio_insertar(p_uid uuid, p jsonb, p_por text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_id uuid; v_com uuid; v_zona uuid; v_cobrar numeric; v_paq integer; v_fecha date;
  v_tam text := coalesce(nullif(p ->> 'tamano', ''), 'pequeno'); v_paga text := coalesce(nullif(p ->> 'envio_lo_paga', ''), 'comercio');
  v_urg boolean; v_rem text := btrim(coalesce(p ->> 'remitente_nombre', '')); v_des text := btrim(coalesce(p ->> 'destinatario_nombre', ''));
  v_dir text := btrim(coalesce(p ->> 'direccion', '')); v_tarifa numeric; v_zn text; v_num text; v_tok text;
begin
  begin
    v_com := nullif(p ->> 'comercio_id', '')::uuid; v_zona := nullif(p ->> 'zona_id', '')::uuid; v_urg := coalesce((p ->> 'urgente')::boolean, false);
    v_cobrar := coalesce(nullif(p ->> 'monto_cobrar', '')::numeric, 0); v_paq := coalesce(nullif(p ->> 'paquetes', '')::integer, 1); v_fecha := nullif(p ->> 'fecha_programada', '')::date;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if v_com is not null then
    select btrim(nombre || ' ' || coalesce(apellido, '')) into v_rem from public.clientes where id = v_com and auth_user_id = p_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  end if;
  if char_length(coalesce(v_rem, '')) < 2 then return jsonb_build_object('ok', false, 'motivo', 'remitente'); end if;
  if char_length(v_des) < 2 or char_length(v_des) > 160 then return jsonb_build_object('ok', false, 'motivo', 'destinatario'); end if;
  if char_length(v_dir) < 3 or char_length(v_dir) > 400 then return jsonb_build_object('ok', false, 'motivo', 'direccion'); end if;
  if v_zona is not null then
    select nombre into v_zn from public.mensajeria_zonas where id = v_zona and auth_user_id = p_uid and activo;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'zona'); end if;
  end if;
  if v_tam not in ('pequeno','mediano','grande') or v_paga not in ('comercio','destinatario') then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_cobrar < 0 or v_cobrar > 100000000 or v_paq < 1 or v_paq > 999 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_cobrar > 0 and v_com is null then return jsonb_build_object('ok', false, 'motivo', 'cod_sin_comercio'); end if;
  v_tarifa := public._msj_tarifa(p_uid, v_zona, v_com, v_urg, v_tam);
  v_num := public._msj_numero(p_uid, 'mensajeria_envios', 'ENV-');
  insert into public.mensajeria_envios(auth_user_id, numero, comercio_id, remitente_nombre, remitente_telefono, recoger_direccion, destinatario_nombre,
    destinatario_telefono, direccion, referencia, zona_id, zona_nombre, descripcion, paquetes, tamano, urgente, monto_cobrar, envio_lo_paga, tarifa,
    estado, fecha_programada, notas, creado_por)
  values (p_uid, v_num, v_com, left(v_rem, 160), nullif(left(btrim(coalesce(p ->> 'remitente_telefono', '')), 30), ''), nullif(left(btrim(coalesce(p ->> 'recoger_direccion', '')), 400), ''),
    v_des, nullif(left(btrim(coalesce(p ->> 'destinatario_telefono', '')), 30), ''), v_dir, nullif(left(btrim(coalesce(p ->> 'referencia', '')), 400), ''),
    v_zona, v_zn, nullif(left(btrim(coalesce(p ->> 'descripcion', '')), 400), ''), v_paq, v_tam, v_urg, round(v_cobrar, 2), v_paga, v_tarifa,
    case when coalesce((p ->> 'en_bodega')::boolean, false) then 'en_bodega' else 'por_recoger' end, v_fecha, nullif(left(btrim(coalesce(p ->> 'notas', '')), 600), ''), left(p_por, 120))
  returning id, rastreo_token into v_id, v_tok;
  perform public._msj_log(p_uid, v_id, 'creado', 'Tarifa ' || v_tarifa || case when v_cobrar > 0 then ' · cobrar ' || round(v_cobrar, 2) else '' end, p_por);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'tarifa', v_tarifa, 'rastreo_token', v_tok);
end $f$;

-- ---------- Portal público: ver ----------
create or replace function public.msj_portal_ver(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare l record; c record; e record; cfg record;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{40}$' then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select * into l from public.mensajeria_portal_links where token = p_token and activo;
  if not found or not public._msj_activo(l.auth_user_id) then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  update public.mensajeria_portal_links set usado_at = now() where id = l.id;
  select * into c from public.clientes where id = l.comercio_id;
  select nombre_comercial, whatsapp, telefono, moneda, logo_principal_url, color_principal into e from public.configuracion_empresa where auth_user_id = l.auth_user_id;
  select * into cfg from public.mensajeria_config where auth_user_id = l.auth_user_id;
  return jsonb_build_object('ok', true,
    'negocio', coalesce(e.nombre_comercial, 'Mensajería'), 'whatsapp', coalesce(nullif(e.whatsapp, ''), nullif(e.telefono, '')), 'moneda', coalesce(e.moneda, 'NIO'),
    'logo', e.logo_principal_url, 'color', e.color_principal, 'comercio', btrim(c.nombre || ' ' || coalesce(c.apellido, '')),
    'recargo_urgente', coalesce(cfg.recargo_urgente, 0), 'recargo_grande', coalesce(cfg.recargo_grande, 0),
    'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'nombre', z.nombre, 'tarifa', coalesce(t.tarifa, z.tarifa)) order by z.nombre)
                        from public.mensajeria_zonas z left join public.mensajeria_tarifas_comercio t on t.zona_id = z.id and t.comercio_id = l.comercio_id and t.activo
                       where z.auth_user_id = l.auth_user_id and z.activo), '[]'::jsonb),
    'envios', coalesce((select jsonb_agg(jsonb_build_object('numero', v.numero, 'destinatario', v.destinatario_nombre, 'direccion', v.direccion, 'zona', v.zona_nombre,
                          'estado', v.estado, 'monto_cobrar', v.monto_cobrar, 'tarifa', v.tarifa + v.recargo_reintentos, 'envio_lo_paga', v.envio_lo_paga, 'creado_at', v.created_at,
                          'entregado_at', v.entregado_at, 'recibio', v.recibio_nombre, 'motivo', v.motivo_no_entrega, 'rastreo', v.rastreo_token, 'liquidado', v.liquidacion_id is not null)
                          order by v.created_at desc)
                         from (select * from public.mensajeria_envios where auth_user_id = l.auth_user_id and comercio_id = l.comercio_id
                                  and created_at > now() - interval '60 days' order by created_at desc limit 200) v), '[]'::jsonb),
    'por_liquidar', jsonb_build_object('envios', (select count(*) from public._msj_liq_lista(l.auth_user_id, l.comercio_id)),
                                       'cod', (select coalesce(sum(cod), 0) from public._msj_liq_lista(l.auth_user_id, l.comercio_id)),
                                       'tarifas', (select coalesce(sum(tarifa), 0) from public._msj_liq_lista(l.auth_user_id, l.comercio_id))),
    'liquidaciones', coalesce((select jsonb_agg(jsonb_build_object('numero', q.numero, 'fecha', q.created_at, 'envios', q.envios, 'cod', q.cod_total, 'tarifas', q.tarifas_total, 'neto', q.neto) order by q.created_at desc)
                                 from (select * from public.mensajeria_liquidaciones where comercio_id = l.comercio_id and auth_user_id = l.auth_user_id order by created_at desc limit 20) q), '[]'::jsonb));
end $f$;

-- ---------- Portal público: pedir un envío ----------
create or replace function public.msj_portal_crear(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare l record; n integer; v jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{40}$' then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select * into l from public.mensajeria_portal_links where token = p_token and activo;
  if not found or not public._msj_activo(l.auth_user_id) then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_portal_' || l.comercio_id::text));
  select count(*) into n from public.mensajeria_envios where comercio_id = l.comercio_id and auth_user_id = l.auth_user_id
     and creado_por like 'Portal%' and created_at > now() - interval '1 day';
  if n >= 150 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;
  v := public._msj_envio_insertar(l.auth_user_id,
        jsonb_build_object('comercio_id', l.comercio_id, 'destinatario_nombre', p ->> 'destinatario_nombre', 'destinatario_telefono', p ->> 'destinatario_telefono',
          'direccion', p ->> 'direccion', 'referencia', p ->> 'referencia', 'zona_id', p ->> 'zona_id', 'descripcion', p ->> 'descripcion', 'paquetes', p ->> 'paquetes',
          'tamano', p ->> 'tamano', 'urgente', p ->> 'urgente', 'monto_cobrar', p ->> 'monto_cobrar', 'envio_lo_paga', p ->> 'envio_lo_paga',
          'recoger_direccion', p ->> 'recoger_direccion', 'fecha_programada', p ->> 'fecha_programada', 'notas', p ->> 'notas'),
        'Portal · ' || left(coalesce((select btrim(nombre || ' ' || coalesce(apellido, '')) from public.clientes where id = l.comercio_id), 'comercio'), 100));
  if (v ->> 'ok')::boolean then update public.mensajeria_portal_links set usado_at = now() where id = l.id; end if;
  return v - 'id';
end $f$;

-- ---------- Ubicación del repartidor ----------
create or replace function public.msj_ubicacion_enviar(p_repartidor uuid, p_lat numeric, p_lng numeric, p_precision integer default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return jsonb_build_object('ok', false, 'motivo', 'ubicacion'); end if;
  update public.mensajeria_repartidores set ubic_lat = round(p_lat, 6), ubic_lng = round(p_lng, 6),
      ubic_precision = least(greatest(coalesce(p_precision, 0), 0), 100000), ubic_at = now()
   where id = p_repartidor and auth_user_id = v_uid and activo;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  return jsonb_build_object('ok', true);
end $f$;

-- ---------- Demo: envíos nuevos cada día (solo en la cuenta demo de Mensajería) ----------
create or replace function public.msj_demo_preparar()
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_hoy date := public._msj_hoy(); n integer := 0; i integer; z uuid[]; c uuid[]; r record;
  nombres text[] := array['María Gutiérrez','José Martínez','Karla Rivas','Luis Obando','Ana Pérez','Carlos López','Sofía Cruz','Pedro Arias','Daniela Vega','Jorge Sandino'];
  barrios text[] := array['Bello Horizonte, casa D-14','Altamira, de la Vicky 2c al sur','Villa Fontana, casa 35','Linda Vista, frente al parque','Las Colinas, calle 3',
                          'Ciudad Jardín, módulo G-12','Reparto San Juan, casa 210','Bolonia, del canal 2 1/2c abajo','Los Robles, casa 48','Monseñor Lezcano, de la iglesia 1c norte'];
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not exists (select 1 from public.cuentas_prueba where auth_user_id = v_uid and tipo = 'demo_publica')
     or not exists (select 1 from public.configuracion_empresa where auth_user_id = v_uid and metadata ->> 'mensajeria_demo' = 'true') then
    return jsonb_build_object('ok', false, 'motivo', 'solo_demo'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_demo_' || v_uid::text));
  if exists (select 1 from public.mensajeria_envios where auth_user_id = v_uid and (created_at at time zone 'America/Managua')::date = v_hoy and creado_por = 'Demo · del día') then
    return jsonb_build_object('ok', true, 'creados', 0); end if;
  select array_agg(id order by nombre) into z from public.mensajeria_zonas where auth_user_id = v_uid and activo;
  select array_agg(id order by nombre) into c from public.clientes where auth_user_id = v_uid and activo;
  for i in 1 .. 8 loop
    perform public._msj_envio_insertar(v_uid, jsonb_build_object('comercio_id', c[1 + (i % greatest(cardinality(c), 1))], 'destinatario_nombre', nombres[1 + ((i * 3 + extract(doy from v_hoy)::int) % 10)],
      'destinatario_telefono', '8' || lpad(((i * 7919 + extract(doy from v_hoy)::int * 31) % 10000000)::text, 7, '0'), 'direccion', barrios[1 + ((i + extract(doy from v_hoy)::int) % 10)],
      'zona_id', z[1 + (i % greatest(cardinality(z), 1))], 'monto_cobrar', case when i % 3 = 0 then 0 else 250 + (i * 115) % 900 end,
      'envio_lo_paga', case when i % 2 = 0 then 'destinatario' else 'comercio' end, 'urgente', i = 2, 'descripcion', 'Pedido en línea',
      'en_bodega', i > 4, 'fecha_programada', v_hoy), 'Demo · del día');
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'creados', n);
end $f$;

-- ---------- Permisos ----------
revoke all on function public._msj_token() from public, anon, authenticated;
revoke all on function public._msj_envio_insertar(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.msj_portal_link(uuid, text) from public, anon;
grant execute on function public.msj_portal_link(uuid, text) to authenticated;
revoke all on function public.msj_portal_ver(text) from public;
grant execute on function public.msj_portal_ver(text) to anon, authenticated;
revoke all on function public.msj_portal_crear(text, jsonb) from public;
grant execute on function public.msj_portal_crear(text, jsonb) to anon, authenticated;
revoke all on function public.msj_ubicacion_enviar(uuid, numeric, numeric, integer) from public, anon;
grant execute on function public.msj_ubicacion_enviar(uuid, numeric, numeric, integer) to authenticated;
revoke all on function public.msj_demo_preparar() from public, anon;
grant execute on function public.msj_demo_preparar() to authenticated;
