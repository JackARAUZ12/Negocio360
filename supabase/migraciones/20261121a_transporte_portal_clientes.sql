-- ============================================================================
-- Transporte · Portal de clientes (seguimiento de viajes con enlace + PIN + QR)
-- SOLO AGREGA: una tabla nueva, dos columnas opcionales y funciones nuevas.
-- No cambia ningún dato existente (órdenes, tracking, cobros, Caja).
-- ============================================================================

-- 1) Columnas nuevas (opcionales)
alter table public.transporte_ordenes  add column if not exists ref_cliente text;
-- Las notas del tracking quedan INTERNAS por defecto (ninguna nota vieja se muestra al cliente).
alter table public.transporte_tracking add column if not exists visible_cliente boolean not null default false;

-- 2) Accesos al portal (uno por cliente)
create table if not exists public.transporte_portal_accesos (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid not null,
  cliente_id        uuid not null references public.clientes(id) on delete cascade,
  token             text not null unique,
  pin_hash          text not null,
  activo            boolean not null default true,
  mostrar_placa     boolean not null default false,
  mostrar_conductor boolean not null default false,
  ultimo_ingreso    timestamptz,
  ingresos          integer not null default 0,
  intentos_fallidos integer not null default 0,
  bloqueado_hasta   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (auth_user_id, cliente_id)
);
alter table public.transporte_portal_accesos enable row level security;
-- Sin políticas: nadie lee ni escribe directo. Todo pasa por las funciones de abajo.
revoke all on public.transporte_portal_accesos from anon, authenticated;

-- Token de 40 caracteres hex (imposible de adivinar) y PIN de 6 dígitos al azar
create or replace function public._tx_portal_token() returns text language sql volatile
set search_path = public, extensions as $$ select encode(extensions.gen_random_bytes(20), 'hex') $$;
create or replace function public._tx_portal_pin() returns text language sql volatile
set search_path = public, extensions as $$
  select lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0') $$;
revoke all on function public._tx_portal_token() from public, anon, authenticated;
revoke all on function public._tx_portal_pin() from public, anon, authenticated;

-- 3) Dueño de la cuenta: lista de sus accesos (sin el PIN cifrado)
create or replace function public.tx_portal_lista()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'accesos', coalesce((
    select jsonb_agg(jsonb_build_object('cliente_id', a.cliente_id, 'token', a.token, 'activo', a.activo,
             'mostrar_placa', a.mostrar_placa, 'mostrar_conductor', a.mostrar_conductor,
             'ultimo_ingreso', a.ultimo_ingreso, 'ingresos', a.ingresos,
             'bloqueado', a.bloqueado_hasta is not null and a.bloqueado_hasta > now(), 'creado', a.created_at))
      from public.transporte_portal_accesos a where a.auth_user_id = v_uid), '[]'::jsonb));
end $$;

-- 4) Dueño de la cuenta: crear / nuevo PIN / nuevo enlace / apagar / encender / opciones
create or replace function public.tx_portal_gestionar(p_cliente uuid, p_accion text, p_pin text default null, p_opciones jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); a record; v_pin text; v_tok text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not coalesce((select usa_modulo_transporte from public.configuracion_empresa where auth_user_id = v_uid), false) then
    return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if not exists (select 1 from public.clientes where id = p_cliente and auth_user_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  if p_accion not in ('crear', 'nuevo_pin', 'nuevo_enlace', 'apagar', 'encender', 'opciones') then
    return jsonb_build_object('ok', false, 'motivo', 'accion'); end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'motivo', 'pin_formato'); end if;

  perform pg_advisory_xact_lock(hashtext('tx_portal_' || p_cliente::text));
  select * into a from public.transporte_portal_accesos where auth_user_id = v_uid and cliente_id = p_cliente;

  if p_accion = 'crear' then
    if found then  -- ya existe: lo enciende y entrega un PIN nuevo (el anterior no se puede leer)
      v_pin := coalesce(p_pin, public._tx_portal_pin());
      update public.transporte_portal_accesos set activo = true, pin_hash = crypt(v_pin, gen_salt('bf', 8)),
             intentos_fallidos = 0, bloqueado_hasta = null, updated_at = now() where id = a.id;
      return jsonb_build_object('ok', true, 'token', a.token, 'pin', v_pin);
    end if;
    v_pin := coalesce(p_pin, public._tx_portal_pin()); v_tok := public._tx_portal_token();
    insert into public.transporte_portal_accesos(auth_user_id, cliente_id, token, pin_hash)
      values (v_uid, p_cliente, v_tok, crypt(v_pin, gen_salt('bf', 8)));
    return jsonb_build_object('ok', true, 'token', v_tok, 'pin', v_pin, 'nuevo', true);
  end if;

  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_acceso'); end if;

  if p_accion = 'nuevo_pin' then
    v_pin := coalesce(p_pin, public._tx_portal_pin());
    update public.transporte_portal_accesos set pin_hash = crypt(v_pin, gen_salt('bf', 8)), intentos_fallidos = 0,
           bloqueado_hasta = null, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', a.token, 'pin', v_pin);
  elsif p_accion = 'nuevo_enlace' then
    v_tok := public._tx_portal_token();
    update public.transporte_portal_accesos set token = v_tok, intentos_fallidos = 0, bloqueado_hasta = null, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', v_tok);
  elsif p_accion = 'apagar' then
    update public.transporte_portal_accesos set activo = false, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true);
  elsif p_accion = 'encender' then
    update public.transporte_portal_accesos set activo = true, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', a.token);
  else -- opciones
    update public.transporte_portal_accesos set
      mostrar_placa = coalesce((p_opciones->>'mostrar_placa')::boolean, mostrar_placa),
      mostrar_conductor = coalesce((p_opciones->>'mostrar_conductor')::boolean, mostrar_conductor),
      updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true);
  end if;
end $$;

-- 5) Público (el cliente): ver sus viajes con enlace + PIN. Solo lectura y solo campos permitidos.
create or replace function public.tx_portal_ver(p_token text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; e record; c record; v_ok boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{40}$' then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select * into a from public.transporte_portal_accesos where token = p_token for update;
  if not found or not a.activo then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select nombre_comercial, whatsapp, telefono, logo_principal_url, color_principal, usa_modulo_transporte
    into e from public.configuracion_empresa where auth_user_id = a.auth_user_id;
  if not coalesce(e.usa_modulo_transporte, false)
     or exists (select 1 from public.usuarios u where u.auth_user_id = a.auth_user_id and u.estado_cuenta in ('suspendida', 'cancelada')) then
    return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;

  -- datos públicos de la empresa (para la pantalla del PIN)
  if p_pin is null then
    return jsonb_build_object('ok', false, 'motivo', 'pin', 'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'),
      'logo', e.logo_principal_url, 'color', e.color_principal);
  end if;

  if a.bloqueado_hasta is not null and a.bloqueado_hasta > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'minutos', ceil(extract(epoch from (a.bloqueado_hasta - now())) / 60),
      'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal);
  end if;
  v_ok := p_pin ~ '^[0-9]{4,6}$' and crypt(p_pin, a.pin_hash) = a.pin_hash;
  if not v_ok then
    if a.intentos_fallidos + 1 >= 5 then
      update public.transporte_portal_accesos set intentos_fallidos = 0, bloqueado_hasta = now() + interval '15 minutes' where id = a.id;
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'minutos', 15,
        'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal);
    end if;
    update public.transporte_portal_accesos set intentos_fallidos = intentos_fallidos + 1 where id = a.id;
    return jsonb_build_object('ok', false, 'motivo', 'pin_malo', 'restantes', 4 - a.intentos_fallidos,
      'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal);
  end if;

  update public.transporte_portal_accesos set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_ingreso = now(),
         ingresos = ingresos + case when ultimo_ingreso is null or ultimo_ingreso < now() - interval '30 minutes' then 1 else 0 end
   where id = a.id;
  select nombre, apellido into c from public.clientes where id = a.cliente_id;

  return jsonb_build_object('ok', true,
    'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal,
    'whatsapp', coalesce(nullif(e.whatsapp, ''), nullif(e.telefono, '')),
    'cliente', btrim(coalesce(c.nombre, '') || ' ' || coalesce(c.apellido, '')),
    'ahora', now(),
    'viajes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', o.numero, 'ref', o.ref_cliente, 'origen', o.origen, 'destino', o.destino, 'estado', o.estado,
        'programada', o.fecha_programada, 'salida', o.salida_real, 'entrega', o.entrega_real, 'recibio', o.receptor,
        'carga', o.carga_descripcion, 'bultos', o.bultos, 'peso', o.peso_ton, 'creada', o.created_at,
        'placa', case when a.mostrar_placa then (select u.placa from public.transporte_unidades u where u.id = o.unidad_id) end,
        'remolque', case when a.mostrar_placa then (select u.placa from public.transporte_unidades u where u.id = o.remolque_id) end,
        'conductor', case when a.mostrar_conductor then (select d.nombre from public.transporte_conductores d where d.id = o.conductor_id) end,
        'eventos', coalesce((select jsonb_agg(ev order by ev->>'t') from (
            select jsonb_build_object('t', t.fecha_hora, 'estatus', t.estatus, 'hito', t.hito, 'pais', t.pais,
                     'nota', case when t.visible_cliente then t.nota end) ev
              from public.transporte_tracking t where t.orden_id = o.id and t.auth_user_id = a.auth_user_id
            union all
            select jsonb_build_object('t', x.llegada_en, 'estatus', 'Llegó a frontera ' || coalesce(x.frontera, ''), 'auto', 'frontera')
              from public.transporte_cruces x where x.orden_id = o.id and x.auth_user_id = a.auth_user_id and x.llegada_en is not null
            union all
            select jsonb_build_object('t', x.cruce_en, 'estatus', 'Cruzó frontera ' || coalesce(x.frontera, ''), 'auto', 'cruce')
              from public.transporte_cruces x where x.orden_id = o.id and x.auth_user_id = a.auth_user_id and x.cruce_en is not null
          ) q), '[]'::jsonb)
      ) order by coalesce(o.salida_real, o.fecha_programada::timestamptz, o.created_at) desc)
      from (select * from public.transporte_ordenes
             where auth_user_id = a.auth_user_id and cliente_id = a.cliente_id and coalesce(estado, '') <> 'cancelada'
               and (estado in ('pendiente', 'asignada', 'en_ruta') or coalesce(entrega_real, created_at) > now() - interval '365 days')
             order by created_at desc limit 300) o), '[]'::jsonb));
end $$;

revoke all on function public.tx_portal_lista() from public, anon;
revoke all on function public.tx_portal_gestionar(uuid, text, text, jsonb) from public, anon;
grant execute on function public.tx_portal_lista() to authenticated;
grant execute on function public.tx_portal_gestionar(uuid, text, text, jsonb) to authenticated;
revoke all on function public.tx_portal_ver(text, text) from public;
grant execute on function public.tx_portal_ver(text, text) to anon, authenticated;
