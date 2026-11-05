-- =====================================================================
-- ACCESORIOS DE CELULARES · Cuenta de demostración "Cell Accesorios Pro"
-- SOLO AGREGA: una cuenta demo (como las demás demos) con catálogo, clientes y 14 días de ventas de ejemplo.
-- Las ventas se registran con la MISMA función del sistema (venta_registrar_atomica), así el stock, la caja,
-- los bancos y los reportes cuadran igual que en una cuenta real. No toca ninguna otra cuenta.
-- =====================================================================
create or replace function public._accesorios_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-accesorios@negocio360oficial.com';
  bco uuid; prov uuid; r record; p record; n integer; d integer; i integer; j integer; k integer := 0; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; v_cli_id uuid; v_cli_nom text; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric; v_idx integer; v_stk numeric;
  prods uuid[]; res jsonb;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Accesorios ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoAccesorios#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Cell Accesorios', 'email_verified', true, 'nombre_negocio', 'Cell Accesorios Pro', 'phone_verified', false),
    now() - interval '15 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Cell Accesorios Pro', 'demo_publica', 'accesorios', 'Demo de tienda de accesorios de celulares con catálogo, clientes y 14 días de ventas de ejemplo. Sin multiusuario.', 21);
  update public.usuarios set nombre = 'Demo', apellido = 'Cell Accesorios', nombre_negocio = 'Cell Accesorios Pro', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Cell Accesorios Pro', 'tecnologia', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Metrocentro, módulo 118, Managua', '2270-1180', '88001180',
    true, true, true, true, true)
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, direccion = excluded.direccion, telefono = excluded.telefono,
    whatsapp = excluded.whatsapp, control_inventario = true, alerta_stock_bajo = true, gestiona_clientes = true, historial_compras = true, usa_modelo_producto = true;

  -- Todo lo que sigue se registra como lo haría la persona que usa la demo (auth.uid() = la demo)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into public.metodos_pago(auth_user_id, nombre, activo, es_default, orden)
  select u, m.n, true, m.o = 1, m.o from (values ('Efectivo', 1), ('Transferencia', 2), ('Tarjeta', 3)) m(n, o)
   where not exists (select 1 from public.metodos_pago x where x.auth_user_id = u and lower(x.nombre) = lower(m.n));
  insert into public.bancos(auth_user_id, nombre, activo, saldo_inicial, moneda) values (u, 'BAC Credomatic', true, 0, 'NIO') returning id into bco;
  insert into public.proveedores(auth_user_id, nombre, telefono, email, direccion, activo)
  values (u, 'Importadora TechPlus', '2255-9090', 'ventas@techplus.example', 'Zona Franca, Managua', true) returning id into prov;

  -- Catálogo: nombre, categoría, sku, modelo, costo, precio, stock inicial, stock mínimo
  insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, modelo, costo, precio, stock_actual, stock_minimo, activo, proveedor_id, proveedor_nombre)
  select u, 'producto', t.nombre, t.cat, t.sku, t.modelo, t.costo, t.precio, t.stock, t.minimo, true, prov, 'Importadora TechPlus'
  from (values
    ('Cable USB-C a USB-C 1 m', 'Cargadores y cables', 'CAB-001', 'Universal', 45, 120, 60, 10),
    ('Cable Lightning certificado 1 m', 'Cargadores y cables', 'CAB-002', 'iPhone', 95, 220, 40, 10),
    ('Cable Micro USB 1 m', 'Cargadores y cables', 'CAB-003', 'Android', 25, 80, 50, 10),
    ('Cargador de pared 20 W USB-C', 'Cargadores y cables', 'CAR-001', 'Universal', 130, 320, 35, 8),
    ('Cargador de pared 33 W carga rápida', 'Cargadores y cables', 'CAR-002', 'Universal', 190, 450, 25, 6),
    ('Cargador de auto doble USB', 'Cargadores y cables', 'CAR-003', 'Universal', 85, 200, 18, 5),
    ('Cargador inalámbrico 15 W', 'Cargadores y cables', 'CAR-004', 'Universal', 210, 520, 12, 4),
    ('Funda de silicón iPhone 13', 'Fundas', 'FUN-001', 'iPhone 13', 60, 180, 30, 6),
    ('Funda de silicón iPhone 14', 'Fundas', 'FUN-002', 'iPhone 14', 65, 190, 28, 6),
    ('Funda transparente Galaxy A15', 'Fundas', 'FUN-003', 'Galaxy A15', 40, 140, 25, 6),
    ('Funda antigolpes Redmi 12', 'Fundas', 'FUN-004', 'Redmi 12', 55, 170, 20, 5),
    ('Funda con tapa Galaxy A54', 'Fundas', 'FUN-005', 'Galaxy A54', 75, 230, 8, 4),
    ('Vidrio templado iPhone 13', 'Protectores', 'PRO-001', 'iPhone 13', 25, 100, 80, 15),
    ('Vidrio templado iPhone 14', 'Protectores', 'PRO-002', 'iPhone 14', 25, 100, 70, 15),
    ('Vidrio templado Galaxy A15', 'Protectores', 'PRO-003', 'Galaxy A15', 22, 90, 60, 15),
    ('Vidrio templado Redmi 12', 'Protectores', 'PRO-004', 'Redmi 12', 22, 90, 55, 15),
    ('Protector de cámara universal', 'Protectores', 'PRO-005', 'Universal', 15, 60, 40, 10),
    ('Audífonos inalámbricos TWS', 'Audio', 'AUD-001', 'Bluetooth 5.3', 280, 650, 20, 5),
    ('Audífonos con cable tipo C', 'Audio', 'AUD-002', 'USB-C', 70, 190, 30, 8),
    ('Audífonos Bluetooth de diadema', 'Audio', 'AUD-003', 'Bluetooth 5.0', 320, 780, 10, 3),
    ('Parlante Bluetooth mini', 'Audio', 'AUD-004', 'Bluetooth 5.0', 260, 620, 14, 4),
    ('Power bank 10,000 mAh', 'Energía', 'ENE-001', '10,000 mAh', 330, 780, 16, 4),
    ('Power bank 20,000 mAh', 'Energía', 'ENE-002', '20,000 mAh', 520, 1150, 7, 3),
    ('Soporte de auto magnético', 'Soportes', 'SOP-001', 'Universal', 70, 200, 22, 5),
    ('Aro de luz con trípode', 'Soportes', 'SOP-002', '26 cm', 240, 560, 9, 3),
    ('Agarre tipo pop socket', 'Soportes', 'SOP-003', 'Universal', 18, 70, 45, 10),
    ('Memoria microSD 64 GB', 'Memorias', 'MEM-001', '64 GB', 140, 320, 20, 5),
    ('Adaptador OTG USB-C', 'Memorias', 'MEM-002', 'USB-C', 30, 90, 25, 6)
  ) t(nombre, cat, sku, modelo, costo, precio, stock, minimo);
  insert into public.productos(auth_user_id, tipo, nombre, categoria, costo, precio, activo)
  values (u, 'servicio', 'Colocación de vidrio templado', 'Servicios', 0, 50, true),
         (u, 'servicio', 'Configuración inicial de celular', 'Servicios', 0, 120, true);

  insert into public.clientes(auth_user_id, nombre, apellido, telefono, direccion, ciudad, activo) values
    (u, 'María', 'Gutiérrez', '88123456', 'Altamira, Managua', 'Managua', true),
    (u, 'José', 'Martínez', '87654321', 'Bello Horizonte, Managua', 'Managua', true),
    (u, 'Karla', 'Rivas', '89001122', 'Villa Fontana, Managua', 'Managua', true),
    (u, 'Luis', 'Obando', '86557788', 'Ciudad Jardín, Managua', 'Managua', true),
    (u, 'Ana', 'Pérez', '85339911', 'Linda Vista, Managua', 'Managua', true),
    (u, 'Carlos', 'López', '84112299', 'Reparto San Juan, Managua', 'Managua', true),
    (u, 'Sofía', 'Cruz', '88774455', 'Los Robles, Managua', 'Managua', true),
    (u, 'Pedro', 'Arias', '87001234', 'Bolonia, Managua', 'Managua', true);
  select array_agg(id order by nombre) into clis from public.clientes where auth_user_id = u;
  select array_agg(id order by sku) into prods from public.productos where auth_user_id = u and tipo = 'producto';
  n := cardinality(prods);

  -- 14 días de ventas con la función del sistema (la caja, el stock y el banco se actualizan solos)
  for d in reverse 13 .. 0 loop
    ns := case when d = 0 then 3 else 3 + (d % 4) end;
    for i in 1 .. ns loop
      k := k + 1;
      select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = case when k % 5 = 0 then 'Transferencia' when k % 4 = 0 then 'Tarjeta' else 'Efectivo' end;
      v_cli_id := null; v_cli_nom := null;
      if k % 3 <> 0 then select id, nombre into v_cli_id, v_cli_nom from public.clientes where id = clis[1 + (k % 8)]; end if;
      v_det := '[]'::jsonb; v_stock := '[]'::jsonb; v_sub := 0; v_costo := 0;
      ni := 1 + (k % 3);
      for j in 1 .. ni loop
        v_idx := 1 + ((k * 7 + j * 5) % n);
        select id, nombre, tipo, coalesce(costo, 0) as costo, precio, stock_actual into p from public.productos where id = prods[v_idx];
        v_cant := case when p.precio < 120 then 1 + ((k + j) % 3) else 1 end;
        select stock_actual into v_stk from public.productos where id = p.id;
        if v_stk < v_cant + coalesce((select sum((x ->> 'cantidad')::numeric) from jsonb_array_elements(v_stock) x where (x ->> 'producto_id')::uuid = p.id), 0) then continue; end if;
        v_det := v_det || jsonb_build_array(jsonb_build_object('auth_user_id', u, 'venta_id', null, 'producto_id', p.id, 'combo_id', null, 'promocion_id', null,
          'producto_nombre', p.nombre, 'producto_sku', null, 'tipo_item', p.tipo, 'cantidad', v_cant, 'precio', p.precio, 'costo', p.costo, 'descuento', 0,
          'subtotal', round(v_cant * p.precio, 2), 'ganancia', round(v_cant * p.precio - v_cant * p.costo, 2), 'escala_id', null, 'escala_nombre', null,
          'vendido_sin_stock', false, 'es_regalia', false, 'presentacion_id', null, 'presentacion_nombre', null, 'presentacion_factor', null, 'lote_id', null,
          'cantidad_pedida', null, 'unidad_pedida', null));
        v_stock := v_stock || jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant));
        v_sub := v_sub + round(v_cant * p.precio, 2); v_costo := v_costo + v_cant * p.costo;
      end loop;
      -- Un servicio de colocación de vidrio en algunas ventas (no mueve stock)
      if k % 4 = 1 and jsonb_array_length(v_det) > 0 then
        select id, nombre, tipo, precio into p from public.productos where auth_user_id = u and tipo = 'servicio' and nombre like 'Colocación%';
        v_det := v_det || jsonb_build_array(jsonb_build_object('auth_user_id', u, 'venta_id', null, 'producto_id', p.id, 'combo_id', null, 'promocion_id', null,
          'producto_nombre', p.nombre, 'producto_sku', null, 'tipo_item', 'servicio', 'cantidad', 1, 'precio', p.precio, 'costo', 0, 'descuento', 0,
          'subtotal', p.precio, 'ganancia', p.precio, 'escala_id', null, 'escala_nombre', null, 'vendido_sin_stock', false, 'es_regalia', false,
          'presentacion_id', null, 'presentacion_nombre', null, 'presentacion_factor', null, 'lote_id', null, 'cantidad_pedida', null, 'unidad_pedida', null));
        v_sub := v_sub + p.precio;
      end if;
      continue when jsonb_array_length(v_det) = 0 or v_sub <= 0;
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
  end loop;
  return u;
end $f$;
revoke all on function public._accesorios_demo_crear() from public, anon, authenticated;

select public._accesorios_demo_crear();
