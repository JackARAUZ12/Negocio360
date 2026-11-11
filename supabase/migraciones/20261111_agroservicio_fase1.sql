-- =====================================================================
-- AGROSERVICIO · Fase 1 (11-nov-2026) — Panel único de Agroservicio
-- Solo AGREGA: una columna apagada por defecto, una tabla nueva, columnas
-- nuevas (opcionales) en la bitácora y funciones nuevas.
-- Candados:
--   * Todo funciona SOLO si el negocio activó el Agroservicio (usa_modulo_agro).
--     Las demás cuentas (farmacias incluidas) siguen exactamente igual.
--   * Venta de producto restringido = la MISMA venta atómica de siempre
--     (venta_registrar_atomica: venta + detalle + inventario + Caja/fiado en
--     un solo paso) + lote + bitácora EN LA MISMA operación: todo o nada.
--     Clave única por clic: aunque se toque dos veces no se vende dos veces.
--   * Nunca se vende de un lote vencido ni más de lo que hay.
--   * Límite de crédito del productor revisado en el SERVIDOR al crear un
--     fiado (desde Ventas, Fiados o el panel). Si tiene saldo y su fecha de
--     cosecha ya pasó, no se le fía más hasta que abone.
--   * Bitácora de restringidos: en cuentas Agro no se puede editar ni borrar.
-- =====================================================================

alter table public.configuracion_empresa add column if not exists usa_modulo_agro boolean not null default false;
alter table public.configuracion_empresa add column if not exists agro_receta_obligatoria boolean not null default true;

-- Ficha agrícola del productor (1 por cliente). La pantalla solo LEE; se guarda por función.
create table if not exists public.agro_productores (
  cliente_id uuid primary key references public.clientes(id) on delete cascade,
  auth_user_id uuid not null,
  finca text,
  comunidad text,
  municipio text,
  cultivos jsonb not null default '[]'::jsonb,   -- [{cultivo, manzanas}]
  ganado jsonb not null default '[]'::jsonb,     -- [{tipo, cantidad}]
  fecha_cosecha date,
  notas text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists agro_productores_usr on public.agro_productores(auth_user_id);
alter table public.agro_productores enable row level security;
drop policy if exists agro_productores_ver on public.agro_productores;
create policy agro_productores_ver on public.agro_productores for select using (auth_user_id = auth.uid());

-- Claves de clic de la venta restringida (no se repite)
create table if not exists public.agro_ventas_claves (
  clave uuid primary key,
  auth_user_id uuid not null,
  venta_id uuid,
  created_at timestamptz not null default now()
);
alter table public.agro_ventas_claves enable row level security;
drop policy if exists agro_ventas_claves_ver on public.agro_ventas_claves;
create policy agro_ventas_claves_ver on public.agro_ventas_claves for select using (auth_user_id = auth.uid());

-- Bitácora: columnas nuevas, todas opcionales (las filas de farmacia no cambian)
alter table public.registro_sustancias_controladas add column if not exists comprador_direccion text;
alter table public.registro_sustancias_controladas add column if not exists uso_destino text;
alter table public.registro_sustancias_controladas add column if not exists receta_profesional text;
alter table public.registro_sustancias_controladas add column if not exists lote_numero text;
alter table public.registro_sustancias_controladas add column if not exists lote_vencimiento date;
alter table public.registro_sustancias_controladas add column if not exists origen text;

create or replace function public._agro_activo(p_uid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select usa_modulo_agro from public.configuracion_empresa where auth_user_id = p_uid limit 1), false);
$$;

-- 🔒 Bitácora inmutable en cuentas Agro
create or replace function public._agro_bitacora_candado() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if public._agro_activo(old.auth_user_id) then
    raise exception 'La bitácora de productos restringidos no se puede modificar ni borrar.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_agro_bitacora_candado on public.registro_sustancias_controladas;
create trigger trg_agro_bitacora_candado before update or delete on public.registro_sustancias_controladas
  for each row execute function public._agro_bitacora_candado();

-- 🔒 Límite de crédito del productor (solo cuentas Agro, solo fiados nuevos con cliente)
create or replace function public._agro_fiado_limite() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_lim numeric; v_deuda numeric; v_cosecha date; v_nom text;
begin
  if new.cliente_id is null or coalesce(new.estado, 'pendiente') <> 'pendiente' or not public._agro_activo(new.auth_user_id) then
    return new;
  end if;
  select coalesce(c.limite_credito, 0), trim(coalesce(c.nombre, '') || ' ' || coalesce(c.apellido, ''))
    into v_lim, v_nom from public.clientes c where c.id = new.cliente_id and c.auth_user_id = new.auth_user_id;
  select coalesce(sum(f.saldo), 0) into v_deuda from public.fiados f
   where f.auth_user_id = new.auth_user_id and f.cliente_id = new.cliente_id and f.estado = 'pendiente';
  select p.fecha_cosecha into v_cosecha from public.agro_productores p
   where p.cliente_id = new.cliente_id and p.auth_user_id = new.auth_user_id;
  if v_deuda > 0.004 and v_cosecha is not null and v_cosecha < (now() at time zone 'America/Managua')::date then
    raise exception 'No se puede fiar a %: tiene C$ % pendiente y su fecha de cosecha (%) ya pasó. Primero debe abonar o actualiza su fecha de cosecha en el panel Agroservicio.',
      v_nom, to_char(v_deuda, 'FM999G999G990D00'), to_char(v_cosecha, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  if v_lim > 0 and v_deuda + coalesce(new.saldo, 0) > v_lim + 0.004 then
    raise exception 'No se puede fiar a %: con esta venta su deuda sería C$ % y su límite es C$ %. Cobra un abono o sube su límite en el panel Agroservicio.',
      v_nom, to_char(v_deuda + coalesce(new.saldo, 0), 'FM999G999G990D00'), to_char(v_lim, 'FM999G999G990D00') using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_agro_fiado_limite on public.fiados;
create trigger trg_agro_fiado_limite before insert on public.fiados
  for each row execute function public._agro_fiado_limite();

-- Guardar ficha del productor (y su límite de crédito). Crea el cliente si es nuevo.
create or replace function public.agro_productor_guardar(p_cliente_id uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid := p_cliente_id; v_nom text; v_lim numeric; v_cos date;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._agro_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_nom := nullif(trim(coalesce(p_datos->>'nombre', '')), '');
  begin v_lim := round(coalesce(nullif(p_datos->>'limite_credito', '')::numeric, 0), 2); exception when others then return jsonb_build_object('ok', false, 'motivo', 'limite'); end;
  if v_lim < 0 or v_lim > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;
  begin v_cos := nullif(p_datos->>'fecha_cosecha', '')::date; exception when others then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end;
  if jsonb_typeof(coalesce(p_datos->'cultivos', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_datos->'ganado', '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  if v_id is null then
    if v_nom is null then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
    insert into public.clientes (auth_user_id, nombre, telefono, whatsapp, ruc, direccion, zona, limite_credito, activo)
    values (v_uid, left(v_nom, 150), nullif(trim(p_datos->>'telefono'), ''), nullif(trim(p_datos->>'telefono'), ''),
            nullif(trim(p_datos->>'cedula'), ''),
            nullif(trim(p_datos->>'direccion'), ''), nullif(trim(p_datos->>'comunidad'), ''), v_lim, true)
    returning id into v_id;
  else
    if not exists (select 1 from public.clientes where id = v_id and auth_user_id = v_uid) then
      return jsonb_build_object('ok', false, 'motivo', 'cliente');
    end if;
    update public.clientes set limite_credito = v_lim,
      telefono = coalesce(nullif(trim(p_datos->>'telefono'), ''), telefono),
      ruc = coalesce(nullif(trim(p_datos->>'cedula'), ''), ruc),
      direccion = coalesce(nullif(trim(p_datos->>'direccion'), ''), direccion),
      updated_at = now()
     where id = v_id and auth_user_id = v_uid;
  end if;
  insert into public.agro_productores (cliente_id, auth_user_id, finca, comunidad, municipio, cultivos, ganado, fecha_cosecha, notas, updated_at)
  values (v_id, v_uid, left(nullif(trim(p_datos->>'finca'), ''), 150), left(nullif(trim(p_datos->>'comunidad'), ''), 150),
          left(nullif(trim(p_datos->>'municipio'), ''), 150), coalesce(p_datos->'cultivos', '[]'::jsonb), coalesce(p_datos->'ganado', '[]'::jsonb),
          v_cos, left(nullif(trim(p_datos->>'notas'), ''), 1000), now())
  on conflict (cliente_id) do update set finca = excluded.finca, comunidad = excluded.comunidad, municipio = excluded.municipio,
    cultivos = excluded.cultivos, ganado = excluded.ganado, fecha_cosecha = excluded.fecha_cosecha, notas = excluded.notas, updated_at = now()
  where agro_productores.auth_user_id = v_uid;
  return jsonb_build_object('ok', true, 'cliente_id', v_id);
end $$;

-- Venta de producto restringido: todo o nada.
-- p_items: [{producto_id, cantidad, precio}]  p_comprador: {nombre, cedula, direccion, uso, receta_numero, receta_profesional, mayor_edad}
-- p_pago: {forma: 'contado'|'fiado', metodo_pago_id, metodo_pago_nombre, banco_id}
create or replace function public.agro_venta_restringida(p_clave uuid, p_items jsonb, p_comprador jsonb, p_pago jsonb, p_cliente_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date;
  v_ya uuid; it jsonb; p record; l record; v_cant numeric; v_prec numeric; v_rest numeric; v_tomar numeric;
  v_total numeric := 0; v_costo numeric := 0; v_det jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb; v_lotes jsonb := '[]'::jsonb;
  v_nom text; v_ced text; v_dir text; v_uso text; v_rec text; v_prof text; v_num text; v_res jsonb; v_venta jsonb; v_fiado jsonb := null; v_caja jsonb := '[]'::jsonb;
  v_forma text; v_cli_nom text; v_cfg record; v_vid uuid; v_lt jsonb; v_desc text := '';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select usa_modulo_agro, agro_receta_obligatoria into v_cfg from public.configuracion_empresa where auth_user_id = v_uid limit 1;
  if coalesce(v_cfg.usa_modulo_agro, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_clave is null then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  perform pg_advisory_xact_lock(hashtextextended('agro_vr:' || v_uid::text, 0));
  select venta_id into v_ya from public.agro_ventas_claves where clave = p_clave and auth_user_id = v_uid;
  if found then return jsonb_build_object('ok', true, 'venta_id', v_ya, 'ya_existia', true); end if;

  v_nom := nullif(trim(coalesce(p_comprador->>'nombre', '')), '');
  v_ced := nullif(trim(coalesce(p_comprador->>'cedula', '')), '');
  v_dir := nullif(trim(coalesce(p_comprador->>'direccion', '')), '');
  v_uso := nullif(trim(coalesce(p_comprador->>'uso', '')), '');
  v_rec := nullif(trim(coalesce(p_comprador->>'receta_numero', '')), '');
  v_prof := nullif(trim(coalesce(p_comprador->>'receta_profesional', '')), '');
  if v_nom is null or v_ced is null or v_dir is null or v_uso is null then return jsonb_build_object('ok', false, 'motivo', 'comprador'); end if;
  if coalesce((p_comprador->>'mayor_edad')::boolean, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'mayor_edad'); end if;
  if coalesce(v_cfg.agro_receta_obligatoria, true) and (v_rec is null or v_prof is null) then return jsonb_build_object('ok', false, 'motivo', 'receta'); end if;

  v_forma := coalesce(p_pago->>'forma', 'contado');
  if v_forma not in ('contado', 'fiado') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  if v_forma = 'fiado' and p_cliente_id is null then return jsonb_build_object('ok', false, 'motivo', 'fiado_cliente'); end if;
  if p_cliente_id is not null then
    select trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_cli_nom from public.clientes where id = p_cliente_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_lineas');
  end if;
  if (select count(distinct x->>'producto_id') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    return jsonb_build_object('ok', false, 'motivo', 'repetido');
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    begin v_cant := round((it->>'cantidad')::numeric, 3); v_prec := round((it->>'precio')::numeric, 2);
    exception when others then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end;
    if v_cant is null or v_cant <= 0 or v_cant > 1000000 or v_prec is null or v_prec <= 0 or v_prec > 100000000 then
      return jsonb_build_object('ok', false, 'motivo', 'cantidad');
    end if;
    select id, nombre, sku, coalesce(costo, 0) costo, coalesce(stock_actual, 0) stock, tipo, es_sustancia_controlada into p
      from public.productos where id = (it->>'producto_id')::uuid and auth_user_id = v_uid and coalesce(activo, true) for update;
    if not found or p.tipo is distinct from 'producto' then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
    if p.es_sustancia_controlada is not true then return jsonb_build_object('ok', false, 'motivo', 'no_restringido', 'producto', p.nombre); end if;
    if p.stock + 0.0005 < v_cant then
      return jsonb_build_object('ok', false, 'motivo', 'sin_stock', 'producto', p.nombre, 'hay', p.stock);
    end if;
    -- Lotes: solo de lotes NO vencidos, el que vence primero sale primero
    v_lt := '[]'::jsonb;
    if exists (select 1 from public.producto_lotes where auth_user_id = v_uid and producto_id = p.id and activo = true and cantidad_actual > 0) then
      v_rest := v_cant;
      for l in select id, numero_lote, fecha_vencimiento, cantidad_actual from public.producto_lotes
                where auth_user_id = v_uid and producto_id = p.id and activo = true and cantidad_actual > 0
                  and (fecha_vencimiento is null or fecha_vencimiento >= v_hoy)
                order by fecha_vencimiento asc nulls last, created_at asc for update loop
        exit when v_rest <= 0;
        v_tomar := least(v_rest, l.cantidad_actual);
        v_lt := v_lt || jsonb_build_object('lote_id', l.id, 'numero', l.numero_lote, 'vence', l.fecha_vencimiento, 'cantidad', v_tomar);
        v_rest := v_rest - v_tomar;
      end loop;
      if v_rest > 0.0005 then
        return jsonb_build_object('ok', false, 'motivo', 'lote_vencido', 'producto', p.nombre,
          'disponible', round(v_cant - v_rest, 3));
      end if;
    end if;
    v_lotes := v_lotes || jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'cantidad', v_cant, 'lotes', v_lt);
    v_det := v_det || jsonb_build_object('producto_id', p.id, 'producto_nombre', p.nombre, 'producto_sku', p.sku, 'tipo_item', 'producto',
      'cantidad', v_cant, 'precio', v_prec, 'costo', p.costo, 'descuento', 0, 'subtotal', round(v_cant * v_prec, 2),
      'ganancia', round(v_cant * v_prec - v_cant * p.costo, 2),
      'lote_id', case when jsonb_array_length(v_lt) > 0 then (v_lt->0->>'lote_id') end);
    v_stock := v_stock || jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant);
    v_total := v_total + round(v_cant * v_prec, 2);
    v_costo := v_costo + round(v_cant * p.costo, 2);
    v_desc := v_desc || case when v_desc = '' then '' else ', ' end || trim(to_char(v_cant, 'FM999999990.###')) || ' ' || p.nombre;
  end loop;

  v_num := public.generar_numero_venta(v_uid);
  v_venta := jsonb_build_object('numero_venta', v_num, 'cliente_id', p_cliente_id, 'cliente_nombre', coalesce(v_cli_nom, v_nom),
    'fecha', now(), 'subtotal', v_total, 'descuento', 0, 'impuesto', 0, 'total', v_total, 'costo_total', v_costo,
    'estado', 'completada', 'categoria', 'Producto restringido', 'creado_por_nombre', left(coalesce(p_pago->>'usuario', ''), 100),
    'observaciones', left('Venta de producto restringido — ' || v_nom || ' (céd. ' || v_ced || ')' || coalesce(' — Receta ' || v_rec, ''), 500));
  if v_forma = 'fiado' then
    v_venta := v_venta || jsonb_build_object('metodo_pago', 'fiado', 'estado_pago', 'credito', 'metodo_pago_nombre', 'Fiado');
    v_fiado := jsonb_build_object('cliente_id', p_cliente_id, 'cliente_nombre', v_cli_nom, 'tipo', 'productos', 'descripcion', left(v_desc, 200),
      'monto_total', v_total, 'monto_pagado', 0, 'saldo', v_total, 'estado', 'pendiente', 'fecha', v_hoy,
      'creado_por_nombre', left(coalesce(p_pago->>'usuario', ''), 100));
  else
    if nullif(p_pago->>'metodo_pago_nombre', '') is null then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
    v_venta := v_venta || jsonb_build_object('metodo_pago', p_pago->>'metodo_pago_nombre', 'estado_pago', 'pagado',
      'metodo_pago_id', nullif(p_pago->>'metodo_pago_id', ''), 'metodo_pago_nombre', p_pago->>'metodo_pago_nombre');
    v_caja := jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num || ' — producto restringido', 'monto', v_total,
      'metodo_pago_id', nullif(p_pago->>'metodo_pago_id', ''), 'metodo_pago_nombre', p_pago->>'metodo_pago_nombre',
      'banco_id', nullif(p_pago->>'banco_id', ''), 'fecha', v_hoy));
  end if;

  -- La venta de siempre (venta + detalle + inventario + Caja o fiado). Si el fiado pasa el límite, se cancela TODO.
  v_res := public.venta_registrar_atomica(v_venta, v_det, v_stock, v_caja, case when p_cliente_id is not null then v_total end, v_fiado);
  v_vid := (v_res->>'venta_id')::uuid;
  if v_vid is null then raise exception 'No se pudo guardar la venta'; end if;

  -- Lotes y bitácora, en la misma operación
  for it in select * from jsonb_array_elements(v_lotes) loop
    if jsonb_array_length(it->'lotes') = 0 then
      insert into public.registro_sustancias_controladas (auth_user_id, producto_id, producto_nombre, cantidad, fecha, comprador_nombre, comprador_documento,
        receta_numero, receta_profesional, comprador_direccion, uso_destino, venta_id, origen)
      values (v_uid, (it->>'producto_id')::uuid, it->>'nombre', (it->>'cantidad')::numeric, v_hoy, v_nom, v_ced, v_rec, v_prof, v_dir, v_uso, v_vid, 'agro');
    else
      for l in select (x->>'lote_id')::uuid lote_id, x->>'numero' numero, (x->>'vence')::date vence, (x->>'cantidad')::numeric cantidad
                 from jsonb_array_elements(it->'lotes') x loop
        update public.producto_lotes set cantidad_actual = cantidad_actual - l.cantidad, updated_at = now()
         where id = l.lote_id and auth_user_id = v_uid and cantidad_actual >= l.cantidad - 0.0005;
        if not found then raise exception 'El lote cambió mientras se vendía. Intenta de nuevo.'; end if;
        insert into public.registro_sustancias_controladas (auth_user_id, producto_id, producto_nombre, cantidad, fecha, comprador_nombre, comprador_documento,
          receta_numero, receta_profesional, comprador_direccion, uso_destino, lote_numero, lote_vencimiento, venta_id, origen)
        values (v_uid, (it->>'producto_id')::uuid, it->>'nombre', l.cantidad, v_hoy, v_nom, v_ced, v_rec, v_prof, v_dir, v_uso, l.numero, l.vence, v_vid, 'agro');
      end loop;
    end if;
  end loop;

  insert into public.agro_ventas_claves (clave, auth_user_id, venta_id) values (p_clave, v_uid, v_vid);
  return jsonb_build_object('ok', true, 'venta_id', v_vid, 'numero_venta', v_num, 'total', v_total);
end $$;

revoke all on function public.agro_venta_restringida(uuid, jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.agro_venta_restringida(uuid, jsonb, jsonb, jsonb, uuid) to authenticated;
revoke all on function public.agro_productor_guardar(uuid, jsonb) from public, anon;
grant execute on function public.agro_productor_guardar(uuid, jsonb) to authenticated;
