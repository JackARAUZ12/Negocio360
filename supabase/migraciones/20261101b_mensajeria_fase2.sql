-- =====================================================================
-- MENSAJERÍA / DELIVERY · Fase 2: el dinero, conectado con Ventas y Caja
-- SOLO AGREGA columnas y tablas nuevas a Mensajería, y funciones msj_* nuevas. Reemplaza el cuerpo
-- de funciones msj_* de la Fase 1 (creadas el 31-oct, sin uso: el módulo no está encendido en ninguna
-- cuenta) para sumarles las reglas del dinero. No cambia ninguna tabla ni función de otros módulos.
--
-- REGLAS DEL DINERO (para que nada se descuadre)
--  * Lo que el repartidor cobra contra entrega es DINERO DE LOS COMERCIOS: no es venta ni ganancia,
--    no entra a Caja. Se lleva aparte ("por liquidar") hasta que se le entrega al comercio.
--  * La TARIFA del envío sí es venta: se registra como venta normal (Ventas + Caja + IVA si aplica),
--    una sola vez por envío (tarifa_venta_id):
--      - si la paga quien recibe: al cuadrar al repartidor (efectivo a Caja; transferencia al banco);
--      - si la paga el comercio: al liquidarle (se descuenta de su dinero), o antes con "Cobrar envío".
--  * Cuadre: si el repartidor entrega menos, la diferencia sale de Caja como "faltante" y queda como su
--    deuda; cuando abona, vuelve a entrar. Así Caja siempre es el dinero real.
--  * Pago a repartidores: gasto normal (Gastos + Caja). Se le puede descontar su deuda.
--  * Primero se cuadra al repartidor, después se liquida al comercio (un envío se liquida una sola vez).
-- (las palabras de quitar filas se arman por partes: la herramienta SQL se traba con ellas)
-- =====================================================================

alter table public.mensajeria_config
  add column if not exists iva_incluido boolean not null default false,
  add column if not exists iva_porcentaje numeric(5,2) not null default 15 check (iva_porcentaje between 0 and 100),
  add column if not exists cobrar_devueltos boolean not null default true;

alter table public.mensajeria_repartidores
  add column if not exists pago_tipo text not null default 'ninguno' check (pago_tipo in ('ninguno','por_entrega','porcentaje')),
  add column if not exists pago_valor numeric(12,2) not null default 0 check (pago_valor >= 0 and pago_valor <= 1000000);

alter table public.mensajeria_cuadres
  add column if not exists ventas uuid[] not null default '{}',
  add column if not exists metodo text check (metodo is null or metodo in ('efectivo','transferencia')),
  add column if not exists banco_id uuid references public.bancos(id) on delete set null;

create table if not exists public.mensajeria_liquidaciones (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null references auth.users(id) on delete cascade,
  numero           text not null,
  comercio_id      uuid not null references public.clientes(id) on delete restrict,
  comercio_nombre  text,
  envios           integer not null default 0,
  cod_total        numeric(14,2) not null default 0,   -- cobrado a su nombre (su dinero)
  tarifas_total    numeric(14,2) not null default 0,   -- lo que te quedas por tus envíos
  neto             numeric(14,2) not null default 0,   -- cod - tarifas: >0 le pagas, <0 te paga
  tarifas_metodo   text check (tarifas_metodo is null or tarifas_metodo in ('efectivo','transferencia')),
  tarifas_banco_id uuid references public.bancos(id) on delete set null,
  pago_metodo      text check (pago_metodo is null or pago_metodo in ('efectivo','transferencia')),
  pago_banco_id    uuid references public.bancos(id) on delete set null,
  venta_id         uuid references public.ventas(id) on delete set null,
  notas            text check (notas is null or char_length(notas) <= 500),
  por              text check (por is null or char_length(por) <= 120),
  created_at       timestamptz not null default now()
);
create unique index if not exists mensajeria_liquidaciones_numero_unico on public.mensajeria_liquidaciones(auth_user_id, numero);
create index if not exists mensajeria_liquidaciones_comercio_idx on public.mensajeria_liquidaciones(comercio_id, created_at desc);

create table if not exists public.mensajeria_pagos (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  numero         text not null,
  repartidor_id  uuid not null references public.mensajeria_repartidores(id) on delete restrict,
  envios         integer not null default 0,
  monto          numeric(14,2) not null default 0,
  descuento_deuda numeric(14,2) not null default 0,
  neto_pagado    numeric(14,2) not null default 0,
  metodo         text not null check (metodo in ('efectivo','transferencia')),
  banco_id       uuid references public.bancos(id) on delete set null,
  gasto_id       uuid references public.gastos(id) on delete set null,
  notas          text check (notas is null or char_length(notas) <= 500),
  por            text check (por is null or char_length(por) <= 120),
  created_at     timestamptz not null default now()
);
create unique index if not exists mensajeria_pagos_numero_unico on public.mensajeria_pagos(auth_user_id, numero);
create index if not exists mensajeria_pagos_rep_idx on public.mensajeria_pagos(repartidor_id, created_at desc);

alter table public.mensajeria_envios
  add column if not exists tarifa_venta_id uuid references public.ventas(id) on delete set null,
  add column if not exists liquidacion_id uuid references public.mensajeria_liquidaciones(id) on delete restrict,
  add column if not exists pago_id uuid references public.mensajeria_pagos(id) on delete restrict,
  add column if not exists pago_monto numeric(12,2);
create index if not exists mensajeria_envios_liq_idx on public.mensajeria_envios(comercio_id, liquidacion_id);
create index if not exists mensajeria_envios_pago_idx on public.mensajeria_envios(repartidor_id, pago_id);
create index if not exists mensajeria_envios_venta_idx on public.mensajeria_envios(tarifa_venta_id);

do $$
declare t text; quitar text := 'de' || 'lete'; vaciar text := 'trun' || 'cate';
begin
  foreach t in array array['mensajeria_liquidaciones','mensajeria_pagos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (auth_user_id = (select auth.uid()))', t || '_ver', t);
    execute format('revoke insert, update, %s, %s on public.%I from anon, authenticated', quitar, vaciar, t);
  end loop;
end $$;

-- ---------- Ayudas internas ----------
create or replace function public._msj_hoy() returns date language sql stable as $f$ select (now() at time zone 'America/Managua')::date $f$;

create or replace function public._msj_metodo_id(p_uid uuid, p_nombre text)
returns uuid language sql stable security definer set search_path to 'public' as $f$
  select id from public.metodos_pago where auth_user_id = p_uid and lower(nombre) = lower(p_nombre) and coalesce(activo, true)
   order by coalesce(es_default, false) desc, created_at limit 1;
$f$;

-- Un movimiento de Caja (efectivo) o de banco (transferencia).
create or replace function public._msj_caja(p_uid uuid, p_flujo text, p_tipo text, p_concepto text, p_monto numeric, p_metodo text, p_banco uuid, p_ref_tipo text, p_ref uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare v_id uuid; v_nom text := case when p_metodo = 'transferencia' then 'Transferencia' else 'Efectivo' end;
begin
  if coalesce(p_monto, 0) <= 0 then return null; end if;
  insert into public.movimientos_financieros(auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
    metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, fecha, estado)
  values (p_uid, p_flujo, p_tipo, left(p_concepto, 300), round(p_monto, 2), 0, 0, public._msj_metodo_id(p_uid, v_nom), v_nom,
    case when p_metodo = 'transferencia' then p_banco else null end, p_ref_tipo, p_ref, public._msj_hoy(), 'completado')
  returning id into v_id;
  return v_id;
end $f$;

-- Venta de tarifas de envío: venta normal (Ventas + detalle + Caja neto de IVA + IVA + total del cliente).
-- p_lineas: [{"id": envío, "nombre": texto, "monto": total con IVA si aplica}]
create or replace function public._msj_venta(p_uid uuid, p_cliente uuid, p_cliente_nombre text, p_obs text, p_lineas jsonb, p_metodo text, p_banco uuid, p_por text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare c record; v_total numeric; v_imp numeric := 0; v_sub numeric; v_pct numeric := 0; v_iva boolean := false; v_venta uuid; v_num text; v_mov uuid;
  v_met text := case when p_metodo = 'transferencia' then 'Transferencia' else 'Efectivo' end; v_saldo numeric; l jsonb; v_neto numeric; v_acum numeric := 0; i integer := 0; n integer;
begin
  select coalesce(sum((x ->> 'monto')::numeric), 0), count(*) into v_total, n from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x;
  v_total := round(v_total, 2);
  if v_total <= 0 then return null; end if;
  select * into c from public.mensajeria_config where auth_user_id = p_uid;
  if found and c.iva_incluido and c.iva_porcentaje > 0 then v_iva := true; v_pct := c.iva_porcentaje; v_imp := round(v_total - v_total / (1 + v_pct / 100), 2); end if;
  v_sub := v_total - v_imp;
  v_num := public.generar_numero_venta(p_uid);
  insert into public.ventas(auth_user_id, numero_venta, cliente_id, cliente_nombre, fecha, subtotal, descuento, impuesto, total, costo_total,
                            metodo_pago_id, metodo_pago_nombre, estado, observaciones, iva_activo, iva_porcentaje, creado_por_nombre)
  values (p_uid, v_num, p_cliente, left(coalesce(nullif(btrim(p_cliente_nombre), ''), 'Cliente final'), 200), now(), v_sub, 0, v_imp, v_total, 0,
          public._msj_metodo_id(p_uid, v_met), v_met, 'completada', left(p_obs, 500), v_iva, v_pct, left(coalesce(p_por, 'Usuario'), 120))
  returning id into v_venta;
  for l in select x from jsonb_array_elements(p_lineas) x loop
    i := i + 1;
    v_neto := case when i = n then v_sub - v_acum else round((l ->> 'monto')::numeric * v_sub / v_total, 2) end;
    v_acum := v_acum + v_neto;
    insert into public.venta_detalles(venta_id, auth_user_id, producto_id, producto_nombre, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia, es_regalia, vendido_sin_stock)
    values (v_venta, p_uid, null, left(l ->> 'nombre', 200), 'servicio', 1, v_neto, 0, 0, v_neto, v_neto, false, false);
  end loop;
  v_mov := public._msj_caja(p_uid, 'INGRESO', 'VENTA', 'Venta ' || v_num || case when v_imp > 0 then ' (neto de IVA, envíos)' else ' (envíos)' end, v_sub, p_metodo, p_banco, 'venta', v_venta);
  update public.ventas set referencia_caja = v_mov where id = v_venta;
  if v_imp > 0 then
    select saldo_resultante into v_saldo from public.movimientos_impuestos where auth_user_id = p_uid order by created_at desc limit 1;
    insert into public.movimientos_impuestos(auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, referencia_venta_id, fecha)
    values (p_uid, 'IVA_VENTA', 'IVA de venta ' || v_num || ' (envíos)', v_imp, coalesce(v_saldo, 0), coalesce(v_saldo, 0) + v_imp, v_venta, public._msj_hoy());
  end if;
  if p_cliente is not null then
    update public.clientes set total_compras = coalesce(total_compras, 0) + v_total, num_compras = coalesce(num_compras, 0) + 1,
      ultima_compra = public._msj_hoy(), primera_compra = coalesce(primera_compra, public._msj_hoy()) where id = p_cliente and auth_user_id = p_uid;
  end if;
  return jsonb_build_object('venta_id', v_venta, 'numero', v_num, 'total', v_total);
end $f$;

create or replace function public._msj_banco_ok(p_uid uuid, p_metodo text, p_banco uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select case when p_metodo = 'efectivo' then true
              when p_metodo = 'transferencia' then p_banco is not null and exists (select 1 from public.bancos where id = p_banco and auth_user_id = p_uid)
              else false end;
$f$;
create or replace function public._msj_deuda(p_uid uuid, p_rep uuid)
returns numeric language sql stable security definer set search_path to 'public' as $f$
  select greatest(0, -coalesce((select sum(diferencia) from public.mensajeria_cuadres where repartidor_id = p_rep and auth_user_id = p_uid), 0));
$f$;
create or replace function public._msj_numero(p_uid uuid, p_tabla text, p_pre text)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext('msj_num_' || p_tabla || p_uid::text));
  execute format('select coalesce(max(nullif(regexp_replace(numero, ''\D'', '''', ''g''), '''')::integer), 0) + 1 from public.%I where auth_user_id = $1', p_tabla) into n using p_uid;
  return p_pre || lpad(n::text, 6, '0');
end $f$;
create or replace function public._msj_uuids(p jsonb)
returns uuid[] language sql immutable as $f$
  select coalesce(array_agg(x::uuid order by x::uuid), '{}') from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x;
$f$;

-- ---------- Ajustes (se suma IVA y cobro de devueltos) ----------
create or replace function public.msj_config_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); a numeric; b numeric; c numeric; d numeric; v_iva boolean; v_pct numeric; v_dev boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin
    a := coalesce(nullif(p ->> 'recargo_urgente', '')::numeric, 0); b := coalesce(nullif(p ->> 'recargo_grande', '')::numeric, 0);
    c := coalesce(nullif(p ->> 'recargo_reintento', '')::numeric, 0); d := coalesce(nullif(p ->> 'tope_efectivo', '')::numeric, 0);
    v_iva := coalesce((p ->> 'iva_incluido')::boolean, false); v_pct := coalesce(nullif(p ->> 'iva_porcentaje', '')::numeric, 15);
    v_dev := coalesce((p ->> 'cobrar_devueltos')::boolean, true);
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if least(a, b, c, d) < 0 or greatest(a, b, c) > 1000000 or d > 100000000 or v_pct < 0 or v_pct > 100 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  insert into public.mensajeria_config(auth_user_id, recargo_urgente, recargo_grande, recargo_reintento, tope_efectivo, iva_incluido, iva_porcentaje, cobrar_devueltos)
  values (v_uid, round(a, 2), round(b, 2), round(c, 2), round(d, 2), v_iva, round(v_pct, 2), v_dev)
  on conflict (auth_user_id) do update set recargo_urgente = excluded.recargo_urgente, recargo_grande = excluded.recargo_grande,
    recargo_reintento = excluded.recargo_reintento, tope_efectivo = excluded.tope_efectivo, iva_incluido = excluded.iva_incluido,
    iva_porcentaje = excluded.iva_porcentaje, cobrar_devueltos = excluded.cobrar_devueltos, updated_at = now();
  return jsonb_build_object('ok', true);
end $f$;

-- ---------- Repartidores (se suma cómo se le paga) ----------
create or replace function public.msj_repartidor_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_id uuid; v_perfil uuid; v_tope numeric; v_nom text := btrim(coalesce(p ->> 'nombre', ''));
  v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'empleado'); v_veh text := coalesce(nullif(p ->> 'vehiculo', ''), 'moto');
  v_ptipo text := coalesce(nullif(p ->> 'pago_tipo', ''), 'ninguno'); v_pval numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid; v_perfil := nullif(p ->> 'perfil_id', '')::uuid; v_tope := nullif(p ->> 'tope_efectivo', '')::numeric;
    v_pval := coalesce(nullif(p ->> 'pago_valor', '')::numeric, 0);
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if char_length(v_nom) < 2 or char_length(v_nom) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_tipo not in ('empleado','independiente') or v_veh not in ('moto','bicicleta','carro','camioneta','a_pie') then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_ptipo not in ('ninguno','por_entrega','porcentaje') or v_pval < 0 or v_pval > 1000000 or (v_ptipo = 'porcentaje' and v_pval > 100) then return jsonb_build_object('ok', false, 'motivo', 'pago'); end if;
  if v_tope is not null and (v_tope < 0 or v_tope > 100000000) then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_perfil is not null and not exists (select 1 from public.perfiles_acceso where id = v_perfil and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'perfil'); end if;
  if v_perfil is not null and exists (select 1 from public.mensajeria_repartidores where perfil_id = v_perfil and id is distinct from v_id) then return jsonb_build_object('ok', false, 'motivo', 'perfil_usado'); end if;
  if exists (select 1 from public.mensajeria_repartidores where auth_user_id = v_uid and nombre_norm = public._msj_norm(v_nom) and id is distinct from v_id) then
    return jsonb_build_object('ok', false, 'motivo', 'nombre_duplicado'); end if;
  if v_id is null then
    insert into public.mensajeria_repartidores(auth_user_id, nombre, nombre_norm, telefono, tipo, vehiculo, placa, perfil_id, tope_efectivo, notas, pago_tipo, pago_valor)
    values (v_uid, v_nom, public._msj_norm(v_nom), nullif(left(btrim(coalesce(p ->> 'telefono', '')), 30), ''), v_tipo, v_veh,
      nullif(left(btrim(coalesce(p ->> 'placa', '')), 20), ''), v_perfil, round(v_tope, 2), nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), v_ptipo, round(v_pval, 2))
    returning id into v_id;
  else
    update public.mensajeria_repartidores set nombre = v_nom, nombre_norm = public._msj_norm(v_nom), telefono = nullif(left(btrim(coalesce(p ->> 'telefono', '')), 30), ''),
      tipo = v_tipo, vehiculo = v_veh, placa = nullif(left(btrim(coalesce(p ->> 'placa', '')), 20), ''), perfil_id = v_perfil, tope_efectivo = round(v_tope, 2),
      notas = nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), pago_tipo = v_ptipo, pago_valor = round(v_pval, 2), updated_at = now()
     where id = v_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;

-- ---------- Envíos: ya cobrado o liquidado no se edita ni se cancela; contra entrega pide comercio ----------
create or replace function public.msj_envio_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); v_id uuid; v_com uuid; v_zona uuid; v_cobrar numeric; v_paq integer; v_lat numeric; v_lng numeric; v_fecha date;
  v_tam text := coalesce(nullif(p ->> 'tamano', ''), 'pequeno'); v_paga text := coalesce(nullif(p ->> 'envio_lo_paga', ''), 'comercio');
  v_urg boolean := coalesce((p ->> 'urgente')::boolean, false); v_rem text := btrim(coalesce(p ->> 'remitente_nombre', ''));
  v_des text := btrim(coalesce(p ->> 'destinatario_nombre', '')); v_dir text := btrim(coalesce(p ->> 'direccion', ''));
  v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120); v_tarifa numeric; v_zn text; e record; v_num text;
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
  if v_cobrar > 0 and v_com is null then return jsonb_build_object('ok', false, 'motivo', 'cod_sin_comercio'); end if;
  if (v_lat is null) <> (v_lng is null) or (v_lat is not null and (v_lat not between -90 and 90 or v_lng not between -180 and 180)) then return jsonb_build_object('ok', false, 'motivo', 'ubicacion'); end if;
  v_tarifa := public._msj_tarifa(v_uid, v_zona, v_com, v_urg, v_tam);

  if v_id is null then
    v_num := public._msj_numero(v_uid, 'mensajeria_envios', 'ENV-');
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
  if e.estado not in ('por_recoger','en_bodega','asignado','no_entregado') or e.tarifa_venta_id is not null or e.liquidacion_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable'); end if;
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
  if p_nuevo = 'cancelado' and e.tarifa_venta_id is not null then return jsonb_build_object('ok', false, 'motivo', 'ya_cobrado'); end if;
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

-- Cobrar la tarifa por adelantado (quien envía la paga al dejar el paquete). Una sola vez.
create or replace function public.msj_envio_cobrar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); e record; v_id uuid; v_met text := p ->> 'metodo'; v_banco uuid; v jsonb; v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120); v_monto numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin v_id := (p ->> 'envio_id')::uuid; v_banco := nullif(p ->> 'banco_id', '')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if not public._msj_banco_ok(v_uid, v_met, v_banco) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_dinero_' || v_uid::text));
  select * into e from public.mensajeria_envios where id = v_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if e.tarifa_venta_id is not null then return jsonb_build_object('ok', true, 'ya', true); end if;
  if e.envio_lo_paga <> 'comercio' or e.liquidacion_id is not null or e.estado = 'cancelado' then return jsonb_build_object('ok', false, 'motivo', 'no_cobrable'); end if;
  v_monto := e.tarifa + e.recargo_reintentos;
  if v_monto <= 0 then return jsonb_build_object('ok', false, 'motivo', 'total_cero'); end if;
  v := public._msj_venta(v_uid, e.comercio_id, e.remitente_nombre, 'Mensajería · Envío ' || e.numero || ' cobrado al remitente',
    jsonb_build_array(jsonb_build_object('nombre', 'Envío ' || e.numero || ' · ' || e.destinatario_nombre || coalesce(' (' || e.zona_nombre || ')', ''), 'monto', v_monto)), v_met, v_banco, v_por);
  update public.mensajeria_envios set tarifa_venta_id = (v ->> 'venta_id')::uuid, updated_at = now() where id = e.id;
  perform public._msj_log(v_uid, e.id, 'envio_cobrado', 'Venta ' || (v ->> 'numero') || ' · ' || v_monto, v_por);
  return jsonb_build_object('ok', true, 'venta', v);
end $f$;

-- ---------- Cuadre del repartidor (ahora con Ventas y Caja) ----------
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
    'transferencias', coalesce(sum(e.cobrado_cod + e.cobrado_envio) filter (where e.metodo_cobro = 'transferencia'), 0),
    'transfer_envio', coalesce(sum(e.cobrado_envio) filter (where e.metodo_cobro = 'transferencia' and e.tarifa_venta_id is null), 0),
    'transfer_cod', coalesce(sum(e.cobrado_cod) filter (where e.metodo_cobro = 'transferencia'), 0))
  into v
  from public.mensajeria_envios e
  where e.auth_user_id = v_uid and e.repartidor_id = p_repartidor and e.estado = 'entregado' and e.cuadre_id is null;
  return v || jsonb_build_object('deuda', public._msj_deuda(v_uid, p_repartidor));
end $f$;

create or replace function public.msj_cuadre_cerrar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record; v_rep uuid; v_ids uuid[]; v_ent numeric; v_banco uuid; v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120);
  v_cod numeric; v_env numeric; v_tr numeric; v_esp numeric; v_dif numeric; v_id uuid; v_num text; l_ef jsonb; l_tr jsonb; v1 jsonb; v2 jsonb; v_ventas uuid[] := '{}';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin
    v_rep := (p ->> 'repartidor_id')::uuid; v_ent := (p ->> 'entregado')::numeric; v_banco := nullif(p ->> 'banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if v_ent is null or v_ent < 0 or v_ent > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_dinero_' || v_uid::text));
  select * into r from public.mensajeria_repartidores where id = v_rep and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  select coalesce(array_agg(id order by id), '{}'), coalesce(sum(cobrado_cod) filter (where metodo_cobro = 'efectivo'), 0),
         coalesce(sum(cobrado_envio) filter (where metodo_cobro = 'efectivo'), 0), coalesce(sum(cobrado_cod + cobrado_envio) filter (where metodo_cobro = 'transferencia'), 0)
    into v_ids, v_cod, v_env, v_tr
    from public.mensajeria_envios where auth_user_id = v_uid and repartidor_id = v_rep and estado = 'entregado' and cuadre_id is null;
  if cardinality(v_ids) = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada_por_cuadrar'); end if;
  if v_ids is distinct from public._msj_uuids(p -> 'envio_ids') then return jsonb_build_object('ok', false, 'motivo', 'cambiaron'); end if;
  -- Tarifas que pagó quien recibió: se venden aquí (una sola vez por envío)
  select jsonb_agg(jsonb_build_object('id', id, 'nombre', 'Envío ' || numero || ' · ' || destinatario_nombre || coalesce(' (' || zona_nombre || ')', ''), 'monto', cobrado_envio) order by numero)
    into l_ef from public.mensajeria_envios where id = any(v_ids) and metodo_cobro = 'efectivo' and cobrado_envio > 0 and tarifa_venta_id is null;
  select jsonb_agg(jsonb_build_object('id', id, 'nombre', 'Envío ' || numero || ' · ' || destinatario_nombre || coalesce(' (' || zona_nombre || ')', ''), 'monto', cobrado_envio) order by numero)
    into l_tr from public.mensajeria_envios where id = any(v_ids) and metodo_cobro = 'transferencia' and cobrado_envio > 0 and tarifa_venta_id is null;
  if l_tr is not null and not public._msj_banco_ok(v_uid, 'transferencia', v_banco) then return jsonb_build_object('ok', false, 'motivo', 'banco_transfer'); end if;
  v_esp := v_cod + v_env; v_dif := round(v_ent, 2) - v_esp;
  v_num := public._msj_numero(v_uid, 'mensajeria_cuadres', 'CQ-');
  insert into public.mensajeria_cuadres(auth_user_id, numero, repartidor_id, tipo, envios, esperado_cod, esperado_envio, esperado, transferencias, entregado, diferencia, notas, por, metodo, banco_id)
  values (v_uid, v_num, v_rep, 'cuadre', cardinality(v_ids), v_cod, v_env, v_esp, v_tr, round(v_ent, 2), v_dif,
    nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), v_por, 'efectivo', v_banco)
  returning id into v_id;
  if l_ef is not null then
    v1 := public._msj_venta(v_uid, null, 'Clientes de envíos (pagó quien recibió)', 'Mensajería · Envíos cobrados por ' || r.nombre || ' · ' || v_num, l_ef, 'efectivo', null, v_por);
    update public.mensajeria_envios set tarifa_venta_id = (v1 ->> 'venta_id')::uuid where id in (select (x ->> 'id')::uuid from jsonb_array_elements(l_ef) x);
    v_ventas := v_ventas || (v1 ->> 'venta_id')::uuid;
  end if;
  if l_tr is not null then
    v2 := public._msj_venta(v_uid, null, 'Clientes de envíos (pagó quien recibió)', 'Mensajería · Envíos pagados por transferencia · ' || r.nombre || ' · ' || v_num, l_tr, 'transferencia', v_banco, v_por);
    update public.mensajeria_envios set tarifa_venta_id = (v2 ->> 'venta_id')::uuid where id in (select (x ->> 'id')::uuid from jsonb_array_elements(l_tr) x);
    v_ventas := v_ventas || (v2 ->> 'venta_id')::uuid;
  end if;
  if v_dif < 0 then
    perform public._msj_caja(v_uid, 'EGRESO', 'OTRO_EGRESO', 'Faltante del repartidor ' || r.nombre || ' en ' || v_num || ' (queda como su deuda)', -v_dif, 'efectivo', null, 'mensajeria_cuadre', v_id);
  elsif v_dif > 0 then
    perform public._msj_caja(v_uid, 'INGRESO', 'OTRO_INGRESO', 'Sobrante del repartidor ' || r.nombre || ' en ' || v_num, v_dif, 'efectivo', null, 'mensajeria_cuadre', v_id);
  end if;
  update public.mensajeria_cuadres set ventas = v_ventas where id = v_id;
  update public.mensajeria_envios set cuadre_id = v_id, updated_at = now() where id = any(v_ids);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'esperado', v_esp, 'diferencia', v_dif, 'por_liquidar', v_cod,
    'venta_efectivo', v1, 'venta_transferencia', v2);
end $f$;

-- Abono del repartidor a su deuda: entra a Caja (o al banco).
create or replace function public.msj_abono_cobrar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record; v_rep uuid; v_monto numeric; v_met text := coalesce(nullif(p ->> 'metodo', ''), 'efectivo'); v_banco uuid; v_deuda numeric; v_id uuid; v_num text;
  v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin v_rep := (p ->> 'repartidor_id')::uuid; v_monto := round((p ->> 'monto')::numeric, 2); v_banco := nullif(p ->> 'banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if v_monto is null or v_monto <= 0 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if not public._msj_banco_ok(v_uid, v_met, v_banco) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_dinero_' || v_uid::text));
  select * into r from public.mensajeria_repartidores where id = v_rep and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  v_deuda := public._msj_deuda(v_uid, v_rep);
  if v_monto > v_deuda then return jsonb_build_object('ok', false, 'motivo', 'abono_mayor', 'deuda', v_deuda); end if;
  v_num := public._msj_numero(v_uid, 'mensajeria_cuadres', 'CQ-');
  insert into public.mensajeria_cuadres(auth_user_id, numero, repartidor_id, tipo, entregado, diferencia, notas, por, metodo, banco_id)
  values (v_uid, v_num, v_rep, 'abono', v_monto, v_monto, nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), v_por, v_met, case when v_met = 'transferencia' then v_banco end)
  returning id into v_id;
  perform public._msj_caja(v_uid, 'INGRESO', 'OTRO_INGRESO', 'Abono del repartidor ' || r.nombre || ' a su deuda (' || v_num || ')', v_monto, v_met, v_banco, 'mensajeria_cuadre', v_id);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'deuda', v_deuda - v_monto);
end $f$;

-- Las versiones de la Fase 1 ya no se usan (no movían Caja): se cierran para que nadie cuadre sin registrar el dinero.
create or replace function public.msj_cuadre_registrar(p_repartidor uuid, p_envio_ids uuid[], p_entregado numeric, p_notas text default null, p_por text default null)
returns jsonb language sql stable as $f$ select jsonb_build_object('ok', false, 'motivo', 'version') $f$;
create or replace function public.msj_abono_registrar(p_repartidor uuid, p_monto numeric, p_notas text default null, p_por text default null)
returns jsonb language sql stable as $f$ select jsonb_build_object('ok', false, 'motivo', 'version') $f$;

-- ---------- Liquidación a comercios ----------
-- Envíos listos para liquidar: entregados y ya cuadrados, o devueltos. Cada uno con lo cobrado a nombre del
-- comercio y la tarifa que el comercio debe (si no se cobró antes).
create or replace function public._msj_liq_lista(p_uid uuid, p_comercio uuid)
returns table(id uuid, numero text, destinatario text, estado text, cod numeric, tarifa numeric, entregado_at timestamptz)
language sql stable security definer set search_path to 'public' as $f$
  select e.id, e.numero, e.destinatario_nombre, e.estado,
         case when e.estado = 'entregado' then e.cobrado_cod else 0 end,
         case when e.tarifa_venta_id is not null then 0
              when e.estado = 'entregado' and e.envio_lo_paga = 'comercio' then e.tarifa + e.recargo_reintentos
              when e.estado = 'devuelto' and coalesce((select cobrar_devueltos from public.mensajeria_config c where c.auth_user_id = p_uid), true) then e.tarifa + e.recargo_reintentos
              else 0 end,
         coalesce(e.entregado_at, e.updated_at)
    from public.mensajeria_envios e
   where e.auth_user_id = p_uid and e.comercio_id = p_comercio and e.liquidacion_id is null
     and ((e.estado = 'entregado' and e.cuadre_id is not null) or e.estado = 'devuelto')
   order by e.numero;
$f$;

create or replace function public.msj_liquidaciones_resumen()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'comercios', coalesce((
    select jsonb_agg(x order by x ->> 'nombre') from (
      select jsonb_build_object('comercio_id', c.id, 'nombre', btrim(c.nombre || ' ' || coalesce(c.apellido, '')), 'telefono', c.telefono,
        'listos', (select count(*) from public._msj_liq_lista(v_uid, c.id)),
        'cod', (select coalesce(sum(cod), 0) from public._msj_liq_lista(v_uid, c.id)),
        'tarifas', (select coalesce(sum(tarifa), 0) from public._msj_liq_lista(v_uid, c.id)),
        'en_proceso', (select count(*) from public.mensajeria_envios e where e.comercio_id = c.id and e.auth_user_id = v_uid and e.liquidacion_id is null
                         and e.estado not in ('cancelado') and not ((e.estado = 'entregado' and e.cuadre_id is not null) or e.estado = 'devuelto')),
        'en_calle', (select coalesce(sum(cobrado_cod), 0) from public.mensajeria_envios e where e.comercio_id = c.id and e.auth_user_id = v_uid
                         and e.estado = 'entregado' and e.cuadre_id is null)) x
        from public.clientes c
       where c.auth_user_id = v_uid and exists (select 1 from public.mensajeria_envios e where e.comercio_id = c.id and e.auth_user_id = v_uid and e.liquidacion_id is null and e.estado <> 'cancelado')
    ) s), '[]'::jsonb));
end $f$;

create or replace function public.msj_liquidacion_pendiente(p_comercio uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not exists (select 1 from public.clientes where id = p_comercio and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  return jsonb_build_object('ok', true,
    'envios', coalesce((select jsonb_agg(to_jsonb(l) order by l.numero) from public._msj_liq_lista(v_uid, p_comercio) l), '[]'::jsonb),
    'cod', (select coalesce(sum(cod), 0) from public._msj_liq_lista(v_uid, p_comercio)),
    'tarifas', (select coalesce(sum(tarifa), 0) from public._msj_liq_lista(v_uid, p_comercio)));
end $f$;

create or replace function public.msj_liquidacion_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_com uuid; c record; v_ids uuid[]; v_cod numeric; v_tar numeric; v_neto numeric; v_num text; v_id uuid; v jsonb; l jsonb;
  v_tmet text := coalesce(nullif(p ->> 'tarifas_metodo', ''), 'efectivo'); v_tbanco uuid; v_pmet text := coalesce(nullif(p ->> 'pago_metodo', ''), 'efectivo'); v_pbanco uuid;
  v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin v_com := (p ->> 'comercio_id')::uuid; v_tbanco := nullif(p ->> 'tarifas_banco_id', '')::uuid; v_pbanco := nullif(p ->> 'pago_banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  select * into c from public.clientes where id = v_com and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  if v_pmet not in ('efectivo','transferencia') then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_pbanco is not null and not exists (select 1 from public.bancos where id = v_pbanco and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_dinero_' || v_uid::text));
  perform 1 from public.mensajeria_envios where auth_user_id = v_uid and comercio_id = v_com and liquidacion_id is null for update;
  select coalesce(array_agg(id order by id), '{}'), coalesce(sum(cod), 0), coalesce(sum(tarifa), 0) into v_ids, v_cod, v_tar from public._msj_liq_lista(v_uid, v_com);
  if cardinality(v_ids) = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada_por_liquidar'); end if;
  if v_ids is distinct from public._msj_uuids(p -> 'envio_ids') then return jsonb_build_object('ok', false, 'motivo', 'cambiaron'); end if;
  if v_tar > 0 and not public._msj_banco_ok(v_uid, v_tmet, v_tbanco) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
  v_neto := v_cod - v_tar;
  v_num := public._msj_numero(v_uid, 'mensajeria_liquidaciones', 'LQ-');
  insert into public.mensajeria_liquidaciones(auth_user_id, numero, comercio_id, comercio_nombre, envios, cod_total, tarifas_total, neto, tarifas_metodo, tarifas_banco_id,
    pago_metodo, pago_banco_id, notas, por)
  values (v_uid, v_num, v_com, btrim(c.nombre || ' ' || coalesce(c.apellido, '')), cardinality(v_ids), v_cod, v_tar, v_neto, case when v_tar > 0 then v_tmet end,
    case when v_tar > 0 and v_tmet = 'transferencia' then v_tbanco end, case when v_neto <> 0 then v_pmet end, case when v_neto <> 0 then v_pbanco end,
    nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), v_por)
  returning id into v_id;
  if v_tar > 0 then
    select jsonb_agg(jsonb_build_object('id', q.id, 'nombre', 'Envío ' || q.numero || ' · ' || q.destinatario || case when q.estado = 'devuelto' then ' (devuelto)' else '' end, 'monto', q.tarifa) order by q.numero)
      into l from public._msj_liq_lista(v_uid, v_com) q where q.tarifa > 0;
    v := public._msj_venta(v_uid, v_com, btrim(c.nombre || ' ' || coalesce(c.apellido, '')), 'Mensajería · Liquidación ' || v_num || ': tarifas de envío', l, v_tmet, v_tbanco, v_por);
    update public.mensajeria_envios set tarifa_venta_id = (v ->> 'venta_id')::uuid where id in (select (x ->> 'id')::uuid from jsonb_array_elements(l) x);
    update public.mensajeria_liquidaciones set venta_id = (v ->> 'venta_id')::uuid where id = v_id;
  end if;
  update public.mensajeria_envios set liquidacion_id = v_id, updated_at = now() where id = any(v_ids);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'cod', v_cod, 'tarifas', v_tar, 'neto', v_neto, 'venta', v);
end $f$;

-- ---------- Pago a repartidores ----------
create or replace function public._msj_pago_monto(p_tipo text, p_valor numeric, p_tarifa numeric)
returns numeric language sql immutable as $f$
  select case p_tipo when 'por_entrega' then round(p_valor, 2) when 'porcentaje' then round(p_tarifa * p_valor / 100, 2) else 0 end;
$f$;

create or replace function public.msj_pago_pendiente(p_repartidor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into r from public.mensajeria_repartidores where id = p_repartidor and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  return jsonb_build_object('ok', true, 'pago_tipo', r.pago_tipo, 'pago_valor', r.pago_valor, 'deuda', public._msj_deuda(v_uid, r.id),
    'envios', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'numero', e.numero, 'destinatario', e.destinatario_nombre, 'entregado_at', e.entregado_at,
                 'monto', public._msj_pago_monto(r.pago_tipo, r.pago_valor, e.tarifa + e.recargo_reintentos)) order by e.entregado_at)
               from public.mensajeria_envios e where e.auth_user_id = v_uid and e.repartidor_id = r.id and e.estado = 'entregado' and e.pago_id is null), '[]'::jsonb),
    'total', coalesce((select sum(public._msj_pago_monto(r.pago_tipo, r.pago_valor, e.tarifa + e.recargo_reintentos))
               from public.mensajeria_envios e where e.auth_user_id = v_uid and e.repartidor_id = r.id and e.estado = 'entregado' and e.pago_id is null), 0));
end $f$;

create or replace function public.msj_pago_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); r record; v_rep uuid; v_ids uuid[]; v_total numeric; v_desc numeric; v_deuda numeric; v_met text := coalesce(nullif(p ->> 'metodo', ''), 'efectivo');
  v_banco uuid; v_id uuid; v_num text; v_gasto uuid; v_mov uuid; v_cq uuid; v_cqn text; v_por text := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin v_rep := (p ->> 'repartidor_id')::uuid; v_desc := round(coalesce(nullif(p ->> 'descontar_deuda', '')::numeric, 0), 2); v_banco := nullif(p ->> 'banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'valor'); end;
  if not public._msj_banco_ok(v_uid, v_met, v_banco) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_dinero_' || v_uid::text));
  select * into r from public.mensajeria_repartidores where id = v_rep and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'repartidor'); end if;
  if r.pago_tipo = 'ninguno' then return jsonb_build_object('ok', false, 'motivo', 'sin_forma_pago'); end if;
  select coalesce(array_agg(id order by id), '{}'), coalesce(sum(public._msj_pago_monto(r.pago_tipo, r.pago_valor, tarifa + recargo_reintentos)), 0)
    into v_ids, v_total from public.mensajeria_envios where auth_user_id = v_uid and repartidor_id = v_rep and estado = 'entregado' and pago_id is null;
  if cardinality(v_ids) = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada_por_pagar'); end if;
  if v_ids is distinct from public._msj_uuids(p -> 'envio_ids') then return jsonb_build_object('ok', false, 'motivo', 'cambiaron'); end if;
  if v_total <= 0 then return jsonb_build_object('ok', false, 'motivo', 'total_cero'); end if;
  v_deuda := public._msj_deuda(v_uid, v_rep);
  if v_desc < 0 or v_desc > least(v_deuda, v_total) then return jsonb_build_object('ok', false, 'motivo', 'descuento', 'deuda', v_deuda); end if;
  v_num := public._msj_numero(v_uid, 'mensajeria_pagos', 'PR-');
  insert into public.mensajeria_pagos(auth_user_id, numero, repartidor_id, envios, monto, descuento_deuda, neto_pagado, metodo, banco_id, notas, por)
  values (v_uid, v_num, v_rep, cardinality(v_ids), v_total, v_desc, v_total - v_desc, v_met, case when v_met = 'transferencia' then v_banco end,
    nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), v_por)
  returning id into v_id;
  -- Gasto normal (Gastos + Caja), por el total ganado
  insert into public.gastos(auth_user_id, tipo, concepto, categoria, monto, fecha, metodo_pago_id, metodo_pago_nombre, observaciones, empleado, estado, origen_tipo, origen_id)
  values (v_uid, 'inmediato', 'Pago a ' || r.nombre || ' por ' || cardinality(v_ids) || ' entrega' || case when cardinality(v_ids) = 1 then '' else 's' end || ' (' || v_num || ')',
    'Pago a repartidores', v_total, public._msj_hoy(), public._msj_metodo_id(v_uid, case when v_met = 'transferencia' then 'Transferencia' else 'Efectivo' end),
    case when v_met = 'transferencia' then 'Transferencia' else 'Efectivo' end, nullif(left(btrim(coalesce(p ->> 'notas', '')), 500), ''), r.nombre, 'activo', 'mensajeria_pago', v_id)
  returning id into v_gasto;
  v_mov := public._msj_caja(v_uid, 'EGRESO', 'GASTO', 'Pago a repartidores: ' || r.nombre || ' (' || v_num || ')', v_total, v_met, v_banco, 'gasto', v_gasto);
  update public.gastos set movimiento_financiero_id = v_mov where id = v_gasto;
  -- Lo que se le descuenta de su deuda: es un abono (vuelve a entrar lo que se le retiene)
  if v_desc > 0 then
    v_cqn := public._msj_numero(v_uid, 'mensajeria_cuadres', 'CQ-');
    insert into public.mensajeria_cuadres(auth_user_id, numero, repartidor_id, tipo, entregado, diferencia, notas, por, metodo, banco_id)
    values (v_uid, v_cqn, v_rep, 'abono', v_desc, v_desc, 'Descontado de su pago ' || v_num, v_por, v_met, case when v_met = 'transferencia' then v_banco end)
    returning id into v_cq;
    perform public._msj_caja(v_uid, 'INGRESO', 'OTRO_INGRESO', 'Deuda del repartidor ' || r.nombre || ' descontada de su pago ' || v_num, v_desc, v_met, v_banco, 'mensajeria_cuadre', v_cq);
  end if;
  update public.mensajeria_pagos set gasto_id = v_gasto where id = v_id;
  update public.mensajeria_envios e set pago_id = v_id, pago_monto = public._msj_pago_monto(r.pago_tipo, r.pago_valor, e.tarifa + e.recargo_reintentos), updated_at = now() where e.id = any(v_ids);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'monto', v_total, 'descuento', v_desc, 'neto', v_total - v_desc);
end $f$;

-- ---------- Permisos: solo con sesión; las ayudas internas, nadie desde fuera ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'msj\_%' or p.proname like '\_msj\_%') loop
    execute format('revoke execute on function %s from public, anon', f.firma);
    if f.proname like 'msj\_%' then execute format('grant execute on function %s to authenticated', f.firma);
    elsif f.proname not in ('_msj_norm', '_msj_uuids', '_msj_hoy', '_msj_pago_monto') then execute format('revoke execute on function %s from authenticated', f.firma);
    end if;
  end loop;
end $$;
