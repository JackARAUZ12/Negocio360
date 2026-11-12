-- =====================================================================
-- AGROSERVICIO · Fase 1b (12-nov-2026)
-- Solo AGREGA (todo apagado fuera de las cuentas con Agroservicio activo):
--  1. Área de bodega y marca de refrigerado por producto.
--  2. Candado de precio mínimo: en cuentas Agro no se vende por debajo del costo
--     (por unidad o por presentación: saco, galón…), salvo que el dueño lo permita.
--     Se revisa en el SERVIDOR al guardar cada línea de venta: si no cumple,
--     la venta completa no se guarda (todo o nada).
--  3. Recomendación técnica con dosis por manzana (historial por productor).
--  4. Venta de restringidos con IVA opcional (atómico: venta + Caja neto + IVA).
-- =====================================================================

alter table public.productos add column if not exists agro_area text;
alter table public.productos add column if not exists agro_refrigerado boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'productos_agro_area_chk') then
    alter table public.productos add constraint productos_agro_area_chk
      check (agro_area is null or agro_area in ('agroquimicos','fertilizantes','semillas','veterinarios','alimento','herramientas','otros')) not valid;
  end if;
end $$;
alter table public.configuracion_empresa add column if not exists agro_permitir_bajo_costo boolean not null default false;

-- 🔒 Precio mínimo (solo cuentas Agro)
create or replace function public._agro_precio_minimo() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_permitir boolean; v_agro boolean; v_unidad text;
begin
  if new.producto_id is null or coalesce(new.es_regalia, false) or coalesce(new.costo, 0) <= 0 or coalesce(new.cantidad, 0) <= 0 then
    return new;
  end if;
  select usa_modulo_agro, agro_permitir_bajo_costo into v_agro, v_permitir from public.configuracion_empresa where auth_user_id = new.auth_user_id limit 1;
  if coalesce(v_agro, false) is not true or coalesce(v_permitir, false) then return new; end if;
  if coalesce(new.subtotal, new.cantidad * new.precio) < round(new.cantidad * new.costo, 2) - 0.01 then
    v_unidad := coalesce(nullif(new.presentacion_nombre, ''), 'unidad');
    raise exception 'No se puede vender "%" por debajo del costo: se cobra C$ % por % y cuesta C$ %. Sube el precio (o quita el descuento). Si de verdad quieres rematar, el dueño puede permitirlo en Configuración → Agroservicio.',
      new.producto_nombre, to_char(coalesce(new.subtotal, new.cantidad * new.precio) / new.cantidad, 'FM999G999G990D00'), v_unidad, to_char(new.costo, 'FM999G999G990D00')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_agro_precio_minimo on public.venta_detalles;
create trigger trg_agro_precio_minimo before insert on public.venta_detalles
  for each row execute function public._agro_precio_minimo();

-- Recomendación técnica (historial)
create table if not exists public.agro_recomendaciones (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nombre text,
  cultivo text not null,
  manzanas numeric not null check (manzanas > 0 and manzanas <= 100000),
  objetivo text,
  tecnico text,
  notas text,
  items jsonb not null default '[]'::jsonb,   -- [{producto_id, nombre, dosis_mz, unidad, total, sugerido}]
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists agro_recomendaciones_usr on public.agro_recomendaciones(auth_user_id, created_at desc);
alter table public.agro_recomendaciones enable row level security;
drop policy if exists agro_recomendaciones_ver on public.agro_recomendaciones;
create policy agro_recomendaciones_ver on public.agro_recomendaciones for select using (auth_user_id = auth.uid());

create or replace function public.agro_recomendacion_guardar(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_mz numeric; v_cli uuid; v_nom text; it jsonb; v_items jsonb := '[]'::jsonb; v_d numeric; v_p record; v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._agro_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if nullif(trim(coalesce(p_datos->>'cultivo', '')), '') is null then return jsonb_build_object('ok', false, 'motivo', 'cultivo'); end if;
  begin v_mz := round((p_datos->>'manzanas')::numeric, 2); exception when others then return jsonb_build_object('ok', false, 'motivo', 'manzanas'); end;
  if v_mz is null or v_mz <= 0 or v_mz > 100000 then return jsonb_build_object('ok', false, 'motivo', 'manzanas'); end if;
  v_cli := nullif(p_datos->>'cliente_id', '')::uuid;
  if v_cli is not null then
    select trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_nom from public.clientes where id = v_cli and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  else
    v_nom := nullif(trim(coalesce(p_datos->>'cliente_nombre', '')), '');
  end if;
  if jsonb_typeof(p_datos->'items') <> 'array' or jsonb_array_length(p_datos->'items') = 0 or jsonb_array_length(p_datos->'items') > 30 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_productos');
  end if;
  for it in select * from jsonb_array_elements(p_datos->'items') loop
    begin v_d := round((it->>'dosis_mz')::numeric, 4); exception when others then return jsonb_build_object('ok', false, 'motivo', 'dosis'); end;
    if v_d is null or v_d <= 0 or v_d > 100000 then return jsonb_build_object('ok', false, 'motivo', 'dosis'); end if;
    select id, nombre, coalesce(unidad_codigo, 'unidad') unidad into v_p from public.productos where id = (it->>'producto_id')::uuid and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
    v_items := v_items || jsonb_build_object('producto_id', v_p.id, 'nombre', v_p.nombre, 'unidad', v_p.unidad, 'dosis_mz', v_d,
      'total', round(v_d * v_mz, 3), 'sugerido', left(coalesce(it->>'sugerido', ''), 200));
  end loop;
  insert into public.agro_recomendaciones (auth_user_id, cliente_id, cliente_nombre, cultivo, manzanas, objetivo, tecnico, notas, items, creado_por)
  values (v_uid, v_cli, left(v_nom, 150), left(trim(p_datos->>'cultivo'), 100), v_mz, left(nullif(trim(p_datos->>'objetivo'), ''), 200),
          left(nullif(trim(p_datos->>'tecnico'), ''), 150), left(nullif(trim(p_datos->>'notas'), ''), 1000), v_items, left(nullif(p_datos->>'usuario', ''), 100))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.agro_recomendacion_guardar(jsonb) from public, anon;
grant execute on function public.agro_recomendacion_guardar(jsonb) to authenticated;

-- Venta de restringidos: ahora con IVA opcional (mismo comportamiento de siempre si no se marca)
create or replace function public.agro_venta_restringida(p_clave uuid, p_items jsonb, p_comprador jsonb, p_pago jsonb, p_cliente_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date;
  v_ya uuid; it jsonb; p record; l record; v_cant numeric; v_prec numeric; v_rest numeric; v_tomar numeric;
  v_total numeric := 0; v_costo numeric := 0; v_det jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb; v_lotes jsonb := '[]'::jsonb;
  v_nom text; v_ced text; v_dir text; v_uso text; v_rec text; v_prof text; v_num text; v_res jsonb; v_venta jsonb; v_fiado jsonb := null; v_caja jsonb := '[]'::jsonb;
  v_forma text; v_cli_nom text; v_cfg record; v_vid uuid; v_lt jsonb; v_desc text := '';
  v_con_iva boolean; v_pct numeric; v_iva numeric := 0; v_total_fact numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select usa_modulo_agro, agro_receta_obligatoria, coalesce(iva_porcentaje_default, 15) iva_pct into v_cfg from public.configuracion_empresa where auth_user_id = v_uid limit 1;
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

  -- IVA opcional (como en Ventas: se suma al subtotal; a Caja entra el neto y el IVA va a Impuestos)
  v_con_iva := coalesce((p_pago->>'iva')::boolean, false);
  v_pct := case when v_con_iva then v_cfg.iva_pct else 0 end;
  if v_con_iva and (v_pct is null or v_pct <= 0 or v_pct > 100) then return jsonb_build_object('ok', false, 'motivo', 'iva'); end if;
  v_iva := case when v_con_iva then round(v_total * v_pct / 100, 2) else 0 end;
  v_total_fact := v_total + v_iva;

  v_num := public.generar_numero_venta(v_uid);
  v_venta := jsonb_build_object('numero_venta', v_num, 'cliente_id', p_cliente_id, 'cliente_nombre', coalesce(v_cli_nom, v_nom),
    'fecha', now(), 'subtotal', v_total, 'descuento', 0, 'impuesto', v_iva, 'total', v_total_fact, 'costo_total', v_costo,
    'iva_activo', v_con_iva, 'iva_porcentaje', v_pct,
    'estado', 'completada', 'categoria', 'Producto restringido', 'creado_por_nombre', left(coalesce(p_pago->>'usuario', ''), 100),
    'observaciones', left('Venta de producto restringido — ' || v_nom || ' (céd. ' || v_ced || ')' || coalesce(' — Receta ' || v_rec, ''), 500));
  if v_forma = 'fiado' then
    v_venta := v_venta || jsonb_build_object('metodo_pago', 'fiado', 'estado_pago', 'credito', 'metodo_pago_nombre', 'Fiado');
    v_fiado := jsonb_build_object('cliente_id', p_cliente_id, 'cliente_nombre', v_cli_nom, 'tipo', 'productos', 'descripcion', left(v_desc, 200),
      'monto_total', v_total_fact, 'monto_pagado', 0, 'saldo', v_total_fact, 'estado', 'pendiente', 'fecha', v_hoy,
      'creado_por_nombre', left(coalesce(p_pago->>'usuario', ''), 100));
  else
    if nullif(p_pago->>'metodo_pago_nombre', '') is null then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
    v_venta := v_venta || jsonb_build_object('metodo_pago', p_pago->>'metodo_pago_nombre', 'estado_pago', 'pagado',
      'metodo_pago_id', nullif(p_pago->>'metodo_pago_id', ''), 'metodo_pago_nombre', p_pago->>'metodo_pago_nombre');
    v_caja := jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num || ' — producto restringido' || case when v_iva > 0 then ' (neto de IVA)' else '' end, 'monto', v_total,
      'metodo_pago_id', nullif(p_pago->>'metodo_pago_id', ''), 'metodo_pago_nombre', p_pago->>'metodo_pago_nombre',
      'banco_id', nullif(p_pago->>'banco_id', ''), 'fecha', v_hoy));
  end if;

  -- La venta de siempre (venta + detalle + inventario + Caja o fiado). Si el fiado pasa el límite, se cancela TODO.
  v_res := public.venta_registrar_atomica(v_venta, v_det, v_stock, v_caja, case when p_cliente_id is not null then v_total_fact end, v_fiado);
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

  if v_iva > 0 then
    insert into public.movimientos_impuestos (auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, referencia_venta_id, fecha)
    values (v_uid, 'IVA_VENTA', 'IVA de venta ' || v_num, v_iva, 0, 0, v_vid, v_hoy);
  end if;
  insert into public.agro_ventas_claves (clave, auth_user_id, venta_id) values (p_clave, v_uid, v_vid);
  return jsonb_build_object('ok', true, 'venta_id', v_vid, 'numero_venta', v_num, 'total', v_total_fact, 'iva', v_iva);
end $$;


-- Demo "Agroservicio El Productor": presentaciones activas (saco 100 lb) y áreas de bodega de ejemplo.
update public.configuracion_empresa set maneja_presentaciones = true
 where auth_user_id = (select id from auth.users where email = 'demo-agroservicio@negocio360oficial.com');
update public.productos set agro_area = case when sku like 'AGQ%' then 'agroquimicos' when sku like 'FER%' then 'fertilizantes' when sku like 'SEM%' then 'semillas'
  when sku like 'VET%' then 'veterinarios' when sku like 'ALI%' then 'alimento' when sku like 'HER%' then 'herramientas' end, agro_refrigerado = (sku = 'VET-002')
 where auth_user_id = (select id from auth.users where email = 'demo-agroservicio@negocio360oficial.com');
