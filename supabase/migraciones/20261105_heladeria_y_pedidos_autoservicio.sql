-- =====================================================================
-- HELADERÍA + PEDIDOS DE AUTOSERVICIO (05-nov-2026) — SOLO AGREGA
-- * usa_modulo_heladeria: el mismo motor del Restaurante (mesas, comandas, cobro), con nombres de heladería
--   ("Cocina" pasa a llamarse "Barra"). Apagado por defecto: nadie ve cambios.
-- * Pedidos de autoservicio: una pantalla para que los clientes pidan solos desde un dispositivo del local.
--   - Solo funciona en un dispositivo AUTORIZADO con el PIN de un administrador (queda un "pase" en ese equipo).
--   - Los precios los pone el servidor (nunca el dispositivo), con límites y sin pedidos repetidos.
--   - El pedido llega directo a Cocina/Barra como una comanda normal (se cobra igual que siempre).
-- =====================================================================
alter table public.configuracion_empresa add column if not exists usa_modulo_heladeria boolean not null default false;

create table if not exists public.restaurante_kioskos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  nombre text not null check (length(nombre) between 1 and 60),
  mesa_id uuid not null references public.restaurante_mesas(id) on delete cascade,
  token_hash text not null unique,
  activo boolean not null default true,
  autorizado_por text,
  ultimo_uso timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists restaurante_kioskos_idx on public.restaurante_kioskos (auth_user_id) where activo;
alter table public.restaurante_kioskos enable row level security;
revoke all on public.restaurante_kioskos from anon, authenticated;

alter table public.restaurante_comandas add column if not exists kiosko_id uuid;
alter table public.restaurante_comandas add column if not exists kiosko_ref text;
alter table public.restaurante_comandas add column if not exists kiosko_numero integer;
create unique index if not exists restaurante_comandas_kiosko_ref_uq on public.restaurante_comandas (auth_user_id, kiosko_ref) where kiosko_ref is not null;

-- Dispositivo dueño del pase (o nada)
create or replace function public._kiosko_de(p_token text)
returns public.restaurante_kioskos language sql stable security definer set search_path = public, extensions as $$
  select k.* from restaurante_kioskos k
   where k.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and k.activo and k.auth_user_id = auth.uid()
   limit 1
$$;
revoke all on function public._kiosko_de(text) from public, anon, authenticated;

-- Autorizar ESTE dispositivo (PIN de administrador). Si no se elige mesa, se usa/crea "Autoservicio".
create or replace function public.kiosko_autorizar(p_perfil_id uuid, p_pin text, p_nombre text, p_mesa_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_central uuid; r jsonb; v_mesa uuid; v_tok text; v_nom text := left(btrim(coalesce(p_nombre, '')), 60); v_quien text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not exists (select 1 from configuracion_empresa where auth_user_id = v_uid and usa_modulo_restaurante) then
    return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_central := public._auth_id_central_del_grupo();
  select nombre into v_quien from perfiles_acceso where id = p_perfil_id and auth_user_id = v_central and tipo = 'admin' and activo;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'admin'); end if;
  r := public._admin_verificar(v_central, p_pin, p_perfil_id, 'autorizar pedidos de autoservicio');
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  if v_nom = '' then v_nom := 'Autoservicio'; end if;
  if p_mesa_id is not null then
    select id into v_mesa from restaurante_mesas where id = p_mesa_id and auth_user_id = v_uid and activo;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'mesa'); end if;
  else
    select id into v_mesa from restaurante_mesas where auth_user_id = v_uid and numero = 'Autoservicio';
    if v_mesa is null then
      insert into restaurante_mesas (auth_user_id, numero, zona, zona_personalizada, capacidad, notas)
      values (v_uid, 'Autoservicio', 'personalizado', 'Autoservicio', 1, 'Pedidos que hacen los clientes desde la pantalla de autoservicio')
      returning id into v_mesa;
    end if;
  end if;
  v_tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into restaurante_kioskos (auth_user_id, nombre, mesa_id, token_hash, autorizado_por)
  values (v_uid, v_nom, v_mesa, encode(extensions.digest(v_tok, 'sha256'), 'hex'), left(v_quien, 120));
  return jsonb_build_object('ok', true, 'token', v_tok, 'nombre', v_nom);
end $$;

-- Menú y datos para la pantalla (solo con pase válido)
create or replace function public.kiosko_menu(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k restaurante_kioskos; v_cfg record;
begin
  k := public._kiosko_de(p_token);
  if k.id is null then return jsonb_build_object('ok', false, 'motivo', 'pase'); end if;
  select nombre_comercial, logo_principal_url, moneda, coalesce(usa_modulo_heladeria, false) heladeria into v_cfg from configuracion_empresa where auth_user_id = k.auth_user_id;
  return jsonb_build_object('ok', true, 'kiosko', k.nombre, 'negocio', v_cfg.nombre_comercial, 'logo', v_cfg.logo_principal_url, 'moneda', v_cfg.moneda,
    'heladeria', v_cfg.heladeria,
    'productos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', left(p.descripcion, 200), 'categoria', coalesce(nullif(btrim(p.categoria), ''), 'Otros'),
                                  'precio', p.precio, 'imagen', p.imagen_url) order by coalesce(nullif(btrim(p.categoria), ''), 'Otros'), p.nombre)
                             from productos p where p.auth_user_id = k.auth_user_id and p.activo and coalesce(p.es_materia_prima, false) = false
                              and p.tipo in ('producto', 'servicio') and coalesce(p.precio, 0) > 0), '[]'::jsonb));
end $$;

-- Hacer el pedido: precios del servidor, límites, sin duplicar (ref), directo a Cocina/Barra
create or replace function public.kiosko_pedido(p_token text, p_cliente text, p_nota text, p_items jsonb, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k restaurante_kioskos; v_ref text := left(nullif(btrim(coalesce(p_ref, '')), ''), 80); v_cli text := left(nullif(btrim(coalesce(p_cliente, '')), ''), 60);
  v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 200); x jsonb; p record; v_cant integer; v_com uuid; v_num integer; v_total numeric := 0; v_n integer := 0; v_rec integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
begin
  k := public._kiosko_de(p_token);
  if k.id is null then return jsonb_build_object('ok', false, 'motivo', 'pase'); end if;
  if v_ref is null then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_kiosko:' || k.id::text, 0));
  select id, kiosko_numero into v_com, v_num from restaurante_comandas where auth_user_id = k.auth_user_id and kiosko_ref = v_ref;
  if found then return jsonb_build_object('ok', true, 'repetido', true, 'numero', v_num); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 40 then
    return jsonb_build_object('ok', false, 'motivo', 'vacio'); end if;
  select count(*) into v_rec from restaurante_comandas where kiosko_id = k.id and created_at > now() - interval '10 minutes';
  if v_rec >= 40 then return jsonb_build_object('ok', false, 'motivo', 'muchos'); end if;
  -- Revisar todo ANTES de guardar nada
  for x in select * from jsonb_array_elements(p_items) loop
    begin v_cant := (x ->> 'cantidad')::integer; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    if v_cant is null or v_cant < 1 or v_cant > 30 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
    begin
      select id, nombre, precio into p from productos where id = (x ->> 'producto_id')::uuid and auth_user_id = k.auth_user_id and activo
         and coalesce(es_materia_prima, false) = false and tipo in ('producto', 'servicio') and coalesce(precio, 0) > 0;
    exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
    v_total := v_total + v_cant * p.precio; v_n := v_n + v_cant;
  end loop;
  if v_n > 100 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
  select coalesce(max(kiosko_numero), 0) + 1 into v_num from restaurante_comandas
   where auth_user_id = k.auth_user_id and kiosko_id is not null and (created_at at time zone 'America/Managua')::date = v_hoy;
  insert into restaurante_comandas (auth_user_id, mesa_id, mesero_nombre, numero_comensales, estado, notas, ronda_actual, kiosko_id, kiosko_ref, kiosko_numero)
  values (k.auth_user_id, k.mesa_id, left('Autoservicio · ' || k.nombre, 120), 1, 'enviada',
          left('Pedido #' || v_num || coalesce(' de ' || v_cli, '') || coalesce(' — ' || v_nota, ''), 300), 1, k.id, v_ref, v_num)
  returning id into v_com;
  for x in select * from jsonb_array_elements(p_items) loop
    select id, nombre, precio into p from productos where id = (x ->> 'producto_id')::uuid;
    insert into restaurante_comanda_items (auth_user_id, comanda_id, producto_id, nombre_producto, cantidad, precio_unitario, modificadores, estado, ronda)
    values (k.auth_user_id, v_com, p.id, p.nombre, (x ->> 'cantidad')::integer, p.precio, left(nullif(btrim(coalesce(x ->> 'nota', '')), ''), 120), 'en_preparacion', 1);
  end loop;
  update restaurante_kioskos set ultimo_uso = now() where id = k.id;
  return jsonb_build_object('ok', true, 'numero', v_num, 'total', round(v_total, 2));
end $$;

-- Quitar el permiso a ESTE dispositivo (PIN de administrador)
create or replace function public.kiosko_salir(p_token text, p_perfil_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k restaurante_kioskos; v_central uuid; r jsonb;
begin
  k := public._kiosko_de(p_token);
  v_central := public._auth_id_central_del_grupo();
  if not exists (select 1 from perfiles_acceso where id = p_perfil_id and auth_user_id = v_central and tipo = 'admin' and activo) then
    return jsonb_build_object('ok', false, 'motivo', 'admin'); end if;
  r := public._admin_verificar(v_central, p_pin, p_perfil_id, 'salir de pedidos de autoservicio');
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  if k.id is not null then update restaurante_kioskos set activo = false where id = k.id; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Lista de dispositivos autorizados y quitar uno (para el administrador desde Comandas)
create or replace function public.kiosko_listar()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'nombre', k.nombre, 'autorizado_por', k.autorizado_por, 'desde', k.created_at, 'ultimo_uso', k.ultimo_uso) order by k.created_at), '[]'::jsonb)
    from restaurante_kioskos k where k.auth_user_id = auth.uid() and k.activo
$$;
create or replace function public.kiosko_revocar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update restaurante_kioskos set activo = false where id = p_id and auth_user_id = auth.uid();
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.kiosko_autorizar(uuid, text, text, uuid) from public, anon;
revoke all on function public.kiosko_menu(text) from public, anon;
revoke all on function public.kiosko_pedido(text, text, text, jsonb, text) from public, anon;
revoke all on function public.kiosko_salir(text, uuid, text) from public, anon;
revoke all on function public.kiosko_listar() from public, anon;
revoke all on function public.kiosko_revocar(uuid) from public, anon;
grant execute on function public.kiosko_autorizar(uuid, text, text, uuid) to authenticated;
grant execute on function public.kiosko_menu(text) to authenticated;
grant execute on function public.kiosko_pedido(text, text, text, jsonb, text) to authenticated;
grant execute on function public.kiosko_salir(text, uuid, text) to authenticated;
grant execute on function public.kiosko_listar() to authenticated;
grant execute on function public.kiosko_revocar(uuid) to authenticated;

-- Demo Heladería Polo Norte: se enciende el módulo de Heladería con 6 mesas de ejemplo
update public.configuracion_empresa c set usa_modulo_restaurante = true, usa_modulo_heladeria = true
  from auth.users a where a.id = c.auth_user_id and a.email = 'demo-heladeria@negocio360oficial.com';
insert into public.restaurante_mesas (auth_user_id, numero, zona, capacidad)
select a.id, m.n, m.z, m.c from auth.users a, (values ('1','interior',4),('2','interior',4),('3','interior',2),('4','terraza',4),('5','terraza',6),('6','barra',2)) m(n, z, c)
 where a.email = 'demo-heladeria@negocio360oficial.com'
on conflict (auth_user_id, numero) do nothing;

-- (aplicado aparte, mismo día) Demo pública: autorizar/salir sin PIN para poder probarlo; kiosko_es_demo().
-- Ver kiosko_autorizar / kiosko_salir con la condición cuentas_prueba.tipo = 'demo_publica'.
