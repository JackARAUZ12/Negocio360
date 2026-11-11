-- =====================================================================
-- PANADERÍA · Cuenta de demostración "Panadería Pan de Casa" (10-nov-2026)
-- SOLO AGREGA: una cuenta demo con el Panel de Panadería encendido: insumos, 7 productos con su
-- receta por tanda, vitrina por día de la semana, 14 días de ventas, el cierre de ayer (sobró,
-- se botó, faltó) y la horneada de hoy. Todo con las funciones del sistema (panaderia_*,
-- produccion_*, venta_registrar_atomica): caja, stock y costos cuadran. No toca otra cuenta.
-- =====================================================================
create or replace function public._panaderia_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-panaderia@negocio360oficial.com';
  bco uuid; prov uuid; r record; p record; n integer; d integer; i integer; j integer; k integer := 0; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; v_cli_id uuid; v_cli_nom text; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric; v_idx integer; v_stk numeric;
  prods uuid[]; res jsonb; v_rec uuid; v_hornear jsonb := '[]'::jsonb; v_plan jsonb := '[]'::jsonb; v_x jsonb; v_it jsonb;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Panadería Pan de Casa ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoPanaderia#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Pan de Casa', 'email_verified', true, 'nombre_negocio', 'Panadería Pan de Casa', 'phone_verified', false),
    now() - interval '20 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Panadería Pan de Casa', 'demo_publica', 'panaderia', 'Demo de panadería: Panel de Panadería con recetas por tanda, insumos, vitrina por día, horneada de hoy, cierre de ayer con lo que sobró y se botó, y 14 días de ventas. Sin multiusuario.', 27);
  update public.usuarios set nombre = 'Demo', apellido = 'Pan de Casa', nombre_negocio = 'Panadería Pan de Casa', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Panadería Pan de Casa', 'panaderia', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Barrio San Judas, de la cruz 1c. abajo, Managua', '2265-1212', '88001212',
    true, true, true, true, false)
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, direccion = excluded.direccion, telefono = excluded.telefono,
    whatsapp = excluded.whatsapp, control_inventario = true, alerta_stock_bajo = true, gestiona_clientes = true, historial_compras = true, usa_modelo_producto = false;

  -- Todo lo que sigue se registra como lo haría la persona que usa la demo (auth.uid() = la demo)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into public.metodos_pago(auth_user_id, nombre, activo, es_default, orden)
  select u, m.n, true, m.o = 1, m.o from (values ('Efectivo', 1), ('Transferencia', 2), ('Tarjeta', 3)) m(n, o)
   where not exists (select 1 from public.metodos_pago x where x.auth_user_id = u and lower(x.nombre) = lower(m.n));
  insert into public.bancos(auth_user_id, nombre, activo, saldo_inicial, moneda) values (u, 'BAC Credomatic', true, 0, 'NIO') returning id into bco;
  insert into public.proveedores(auth_user_id, nombre, telefono, email, direccion, activo)
  values (u, 'Molinos de Nicaragua', '2233-5050', 'ventas@molinos.example', 'Carretera Norte km 10, Managua', true) returning id into prov;


  update public.configuracion_empresa set usa_modulo_panaderia = true where auth_user_id = u;

  -- Insumos (materia prima): nombre, sku, unidad, costo, stock
  insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, unidad_codigo, costo, precio, stock_actual, stock_minimo, activo, es_materia_prima, proveedor_id, proveedor_nombre)
  select u, 'producto', t.nombre, 'Insumos', t.sku, t.uni, t.costo, 0, t.stock, t.minimo, true, true, prov, 'Molinos de Nicaragua'
  from (values
    ('Harina de trigo', 'INS-001', 'libra', 14, 500, 100),
    ('Azúcar', 'INS-002', 'libra', 15, 150, 30),
    ('Sal', 'INS-003', 'libra', 8, 40, 8),
    ('Levadura', 'INS-004', 'libra', 120, 15, 3),
    ('Manteca vegetal', 'INS-005', 'libra', 40, 80, 15),
    ('Mantequilla', 'INS-006', 'libra', 90, 40, 8),
    ('Huevos', 'INS-007', 'unidad', 5.5, 300, 60),
    ('Leche', 'INS-008', 'litro', 34, 40, 8),
    ('Masa de maíz', 'INS-009', 'libra', 10, 120, 25),
    ('Queso seco', 'INS-010', 'libra', 85, 40, 8),
    ('Mermelada de piña', 'INS-011', 'libra', 60, 40, 8)
  ) t(nombre, sku, uni, costo, stock, minimo);

  -- Pan y repostería (producto terminado): nombre, sku, presentación, precio, costo aprox.
  insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, modelo, unidad_codigo, costo, precio, stock_actual, stock_minimo, activo)
  select u, 'producto', t.nombre, t.cat, t.sku, t.modelo, 'unidad', t.costo, t.precio, 0, 0, true
  from (values
    ('Pan simple', 'Pan', 'PAN-001', 'Unidad', 1.9, 3),
    ('Semita', 'Pan dulce', 'PAN-002', 'Unidad', 6.5, 15),
    ('Cachito', 'Pan dulce', 'PAN-003', 'Unidad', 5.5, 12),
    ('Polvorón', 'Repostería', 'PAN-004', 'Unidad', 2.8, 8),
    ('Pan de molde', 'Pan', 'PAN-005', 'Bolsa', 28, 55),
    ('Rosquillas (bolsa de 12)', 'Repostería', 'PAN-006', 'Bolsa', 22, 45),
    ('Empanada de piña', 'Repostería', 'PAN-007', 'Unidad', 4.2, 10)
  ) t(nombre, cat, sku, modelo, costo, precio);

  -- Recetas de Producción (tanda) con sus ingredientes
  for r in select * from jsonb_array_elements('[
    {"sku":"PAN-001","tanda":100,"ing":[["INS-001",10],["INS-004",0.25],["INS-002",1],["INS-003",0.2],["INS-005",1]],"hoy":100},
    {"sku":"PAN-002","tanda":40,"ing":[["INS-001",6],["INS-002",2],["INS-005",1.5],["INS-007",6],["INS-004",0.15]],"hoy":40},
    {"sku":"PAN-003","tanda":50,"ing":[["INS-001",5],["INS-006",2],["INS-007",4],["INS-002",0.5],["INS-004",0.15]],"hoy":50},
    {"sku":"PAN-004","tanda":60,"ing":[["INS-001",4],["INS-002",2],["INS-005",2]],"hoy":60},
    {"sku":"PAN-005","tanda":10,"ing":[["INS-001",8],["INS-008",2],["INS-002",0.8],["INS-006",0.6],["INS-004",0.2],["INS-003",0.15]],"hoy":10},
    {"sku":"PAN-006","tanda":20,"ing":[["INS-009",8],["INS-010",3],["INS-005",1],["INS-007",6]],"hoy":20},
    {"sku":"PAN-007","tanda":40,"ing":[["INS-001",4],["INS-011",3],["INS-006",1],["INS-002",0.5]],"hoy":40}
  ]'::jsonb) loop
    select id, nombre into p from public.productos where auth_user_id = u and sku = r.value ->> 'sku';
    insert into public.recetas_produccion(auth_user_id, producto_terminado_id, nombre, cantidad_producida, activa, tipo, al_vender)
    values (u, p.id, 'Tanda de ' || p.nombre, (r.value ->> 'tanda')::numeric, true, 'normal', false) returning id into v_rec;
    for j in 0 .. jsonb_array_length(r.value -> 'ing') - 1 loop
      insert into public.receta_componentes(auth_user_id, receta_id, producto_id, cantidad)
      values (u, v_rec, (select id from public.productos where auth_user_id = u and sku = r.value -> 'ing' -> j ->> 0), (r.value -> 'ing' -> j ->> 1)::numeric);
    end loop;
    v_hornear := v_hornear || jsonb_build_array(jsonb_build_object('receta_id', v_rec, 'cantidad', (r.value ->> 'hoy')::numeric));
    -- Vitrina: cuánto se quiere tener cada día de la semana (más el fin de semana)
    insert into public.panaderia_vitrina(auth_user_id, producto_id, dia_semana, cantidad)
    select u, p.id, ds, round((r.value ->> 'hoy')::numeric * case when ds in (0, 6) then 1.3 else 1 end) from generate_series(0, 6) ds;
  end loop;

  insert into public.clientes(auth_user_id, nombre, apellido, telefono, direccion, ciudad, activo) values
    (u, 'Comedor', 'Doña Juana', '88135792', 'Mercado San Judas', 'Managua', true),
    (u, 'Cafetería', 'El Portal', '87246813', 'Bello Horizonte, rotonda', 'Managua', true),
    (u, 'Colegio', 'San Martín (merienda)', '22701234', 'Barrio San Judas', 'Managua', true),
    (u, 'Marta', 'Gómez', '86357924', 'Barrio Santa Ana', 'Managua', true),
    (u, 'Pedro', 'Úbeda', '85468035', 'Colonia Máximo Jerez', 'Managua', true);
  select array_agg(id order by apellido) into clis from public.clientes where auth_user_id = u;
  select array_agg(id order by sku) into prods from public.productos where auth_user_id = u and tipo = 'producto' and not coalesce(es_materia_prima, false);
  n := cardinality(prods);

  -- 1ª pasada: se arman las ventas de los últimos 13 días (sin registrar) para saber cuánto pan hubo
  for d in reverse 13 .. 1 loop
    ns := 6 + (d % 3) + case when extract(dow from v_hoy - d) in (0, 6) then 3 else 0 end;
    for i in 1 .. ns loop
      k := k + 1;
      v_det := '[]'::jsonb;
      for j in 1 .. 1 + (k % 3) loop
        select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio into p from public.productos where id = prods[1 + ((k * 3 + j * 2) % n)];
        v_cant := case when p.sku = 'PAN-001' then 5 + (k % 4) * 5 when p.precio >= 40 then 1 else 1 + ((k + j) % 6) end;
        continue when v_det @> jsonb_build_array(jsonb_build_object('producto_id', p.id));
        v_det := v_det || jsonb_build_array(jsonb_build_object('producto_id', p.id, 'cantidad', v_cant));
      end loop;
      v_plan := v_plan || jsonb_build_array(jsonb_build_object('d', d, 'k', k, 'items', v_det));
    end loop;
  end loop;
  -- Existencia que había hace 2 semanas = lo que se vendió desde entonces + lo que sobró ayer
  update public.productos pr set stock_actual = coalesce((select sum((it ->> 'cantidad')::numeric)
      from jsonb_array_elements(v_plan) v, jsonb_array_elements(v -> 'items') it where (it ->> 'producto_id')::uuid = pr.id), 0) + 8
   where pr.auth_user_id = u and pr.id = any(prods);

  -- 2ª pasada: se registran las ventas con la función de ventas del sistema
  for v_x in select value from jsonb_array_elements(v_plan) loop
    d := (v_x ->> 'd')::int; k := (v_x ->> 'k')::int;
    select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = case when k % 6 = 0 then 'Transferencia' else 'Efectivo' end;
    v_cli_id := null; v_cli_nom := null;
    if k % 5 = 0 then select id, nombre || ' ' || apellido into v_cli_id, v_cli_nom from public.clientes where id = clis[1 + (k % 5)]; end if;
    v_det := '[]'::jsonb; v_stock := '[]'::jsonb; v_sub := 0; v_costo := 0;
    for v_it in select value from jsonb_array_elements(v_x -> 'items') loop
      select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio into p from public.productos where id = (v_it ->> 'producto_id')::uuid;
      v_cant := (v_it ->> 'cantidad')::numeric;
      v_det := v_det || jsonb_build_array(jsonb_build_object('auth_user_id', u, 'venta_id', null, 'producto_id', p.id, 'combo_id', null, 'promocion_id', null,
        'producto_nombre', p.nombre, 'producto_sku', p.sku, 'tipo_item', p.tipo, 'cantidad', v_cant, 'precio', p.precio, 'costo', p.costo, 'descuento', 0,
        'subtotal', round(v_cant * p.precio, 2), 'ganancia', round(v_cant * (p.precio - p.costo), 2), 'escala_id', null, 'escala_nombre', null,
        'vendido_sin_stock', false, 'es_regalia', false, 'presentacion_id', null, 'presentacion_nombre', null, 'presentacion_factor', null, 'lote_id', null,
        'cantidad_pedida', null, 'unidad_pedida', null));
      v_stock := v_stock || jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant));
      v_sub := v_sub + round(v_cant * p.precio, 2); v_costo := v_costo + v_cant * p.costo;
    end loop;
    continue when jsonb_array_length(v_det) = 0;
    v_num := public.generar_numero_venta(u);
    res := public.venta_registrar_atomica(
      jsonb_build_object('auth_user_id', u, 'numero_venta', v_num, 'cliente_id', v_cli_id, 'cliente_nombre', v_cli_nom, 'fecha', v_hoy - d,
        'subtotal', round(v_sub, 2), 'descuento', 0, 'impuesto', 0, 'total', round(v_sub, 2), 'costo_total', round(v_costo, 2),
        'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre, 'creado_por_nombre', 'Mostrador', 'estado', 'completada',
        'observaciones', null, 'iva_activo', false, 'iva_porcentaje', 0),
      v_det, v_stock,
      jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num, 'monto', round(v_sub, 2), 'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre,
        'banco_id', case when v_mp.nombre = 'Transferencia' then bco end, 'monto_moneda_banco', case when v_mp.nombre = 'Transferencia' then round(v_sub, 2) end,
        'observaciones', null, 'fecha', v_hoy - d)),
      case when v_cli_id is not null then round(v_sub, 2) end, null);
  end loop;

  -- Cierre de ayer con la función del Panel: lo que sobró, lo que se botó y lo que faltó
  select jsonb_agg(jsonb_build_object('producto_id', pr.id,
           'sobro', pr.stock_actual - case pr.sku when 'PAN-003' then 1 else 0 end,
           'desecho', case pr.sku when 'PAN-001' then 5 when 'PAN-002' then 2 else 0 end,
           'motivo', case pr.sku when 'PAN-002' then 'danado' else 'no_vendido' end))
    into v_x from public.productos pr where pr.id = any(prods);
  res := public.panaderia_cerrar_dia(v_hoy - 1, v_x, 'Cierre de ejemplo', 'Encargada');
  if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Cierre demo: %', res; end if;

  -- Horneada de hoy con la función del Panel (usa las recetas y descuenta los ingredientes)
  res := public.panaderia_hornear(gen_random_uuid(), v_hornear, 'Panadero');
  if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Horneada demo: %', res; end if;

  -- Primeras ventas de hoy
  for i in 1 .. 5 loop
    k := k + 1;
    select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio into p from public.productos where id = prods[1 + (k % n)];
    v_cant := case when p.sku = 'PAN-001' then 10 when p.precio >= 40 then 1 else 3 end;
    v_num := public.generar_numero_venta(u);
    select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = 'Efectivo';
    res := public.venta_registrar_atomica(
      jsonb_build_object('auth_user_id', u, 'numero_venta', v_num, 'cliente_id', null, 'cliente_nombre', null, 'fecha', v_hoy,
        'subtotal', round(v_cant * p.precio, 2), 'descuento', 0, 'impuesto', 0, 'total', round(v_cant * p.precio, 2), 'costo_total', round(v_cant * p.costo, 2),
        'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre, 'creado_por_nombre', 'Mostrador', 'estado', 'completada',
        'observaciones', null, 'iva_activo', false, 'iva_porcentaje', 0),
      jsonb_build_array(jsonb_build_object('auth_user_id', u, 'venta_id', null, 'producto_id', p.id, 'combo_id', null, 'promocion_id', null,
        'producto_nombre', p.nombre, 'producto_sku', p.sku, 'tipo_item', p.tipo, 'cantidad', v_cant, 'precio', p.precio, 'costo', p.costo, 'descuento', 0,
        'subtotal', round(v_cant * p.precio, 2), 'ganancia', round(v_cant * (p.precio - p.costo), 2), 'escala_id', null, 'escala_nombre', null,
        'vendido_sin_stock', false, 'es_regalia', false, 'presentacion_id', null, 'presentacion_nombre', null, 'presentacion_factor', null, 'lote_id', null,
        'cantidad_pedida', null, 'unidad_pedida', null)),
      jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant)),
      jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num, 'monto', round(v_cant * p.precio, 2), 'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre,
        'banco_id', null, 'monto_moneda_banco', null, 'observaciones', null, 'fecha', v_hoy)),
      null, null);
  end loop;
  return u;
end $f$;
revoke all on function public._panaderia_demo_crear() from public, anon, authenticated;

select public._panaderia_demo_crear();
