-- =====================================================================
-- MISCELÁNEA · Cuenta de demostración "Miscelánea La Bendición" (10-nov-2026)
-- SOLO AGREGA: una cuenta demo (como las demás demos) con abarrotes, granos, bebidas, snacks, higiene, limpieza y papelería,
-- clientes y 14 días de ventas de ejemplo. Las ventas se registran con la MISMA función del sistema
-- (venta_registrar_atomica): stock, caja, bancos y reportes cuadran igual que en una cuenta real.
-- No toca ninguna otra cuenta.
-- =====================================================================
create or replace function public._miscelanea_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-miscelanea@negocio360oficial.com';
  bco uuid; prov uuid; r record; p record; n integer; d integer; i integer; j integer; k integer := 0; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; v_cli_id uuid; v_cli_nom text; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric; v_idx integer; v_stk numeric;
  prods uuid[]; res jsonb;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Miscelánea ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoMiscelanea#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'La Bendición', 'email_verified', true, 'nombre_negocio', 'Miscelánea La Bendición', 'phone_verified', false),
    now() - interval '15 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Miscelánea La Bendición', 'demo_publica', 'miscelanea', 'Demo de miscelánea / pulpería: granos básicos, abarrotes, bebidas, snacks, higiene, limpieza y papelería, con clientes y 14 días de ventas de ejemplo. Sin multiusuario.', 23);
  update public.usuarios set nombre = 'Demo', apellido = 'La Bendición', nombre_negocio = 'Miscelánea La Bendición', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Miscelánea La Bendición', 'retail', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Barrio Monseñor Lezcano, de la iglesia 1 c. al sur, Managua', '2266-4040', '88004040',
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
  values (u, 'Distribuidora El Mayoreo', '2249-3030', 'ventas@elmayoreo.example', 'Mercado Oriental, Managua', true) returning id into prov;

  -- Catálogo: nombre, categoría, sku, modelo (presentación), costo, precio, stock inicial, stock mínimo
  insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, modelo, costo, precio, stock_actual, stock_minimo, activo, proveedor_id, proveedor_nombre)
  select u, 'producto', t.nombre, t.cat, t.sku, t.modelo, t.costo, t.precio, t.stock, t.minimo, true, prov, 'Distribuidora El Mayoreo'
  from (values
    ('Arroz 1 lb', 'Granos básicos', 'GRA-001', '1 lb', 15, 20, 200, 40),
    ('Frijol rojo 1 lb', 'Granos básicos', 'GRA-002', '1 lb', 28, 35, 150, 30),
    ('Azúcar 1 lb', 'Granos básicos', 'GRA-003', '1 lb', 15, 20, 150, 30),
    ('Aceite vegetal 750 ml', 'Abarrotes', 'ABA-001', '750 ml', 62, 75, 60, 12),
    ('Café molido 115 g', 'Abarrotes', 'ABA-002', '115 g', 38, 48, 50, 10),
    ('Sal 1 lb', 'Abarrotes', 'ABA-003', '1 lb', 7, 10, 80, 15),
    ('Pasta espagueti 200 g', 'Abarrotes', 'ABA-004', '200 g', 14, 20, 80, 15),
    ('Sopa instantánea', 'Abarrotes', 'ABA-005', 'Vaso', 13, 18, 100, 20),
    ('Huevos (unidad)', 'Abarrotes', 'ABA-006', 'Unidad', 5.5, 7, 180, 30),
    ('Pan simple bolsa', 'Abarrotes', 'ABA-007', 'Bolsa', 30, 40, 30, 8),
    ('Leche entera 1 L', 'Lácteos', 'LAC-001', '1 litro', 34, 42, 40, 10),
    ('Queso seco 1/2 lb', 'Lácteos', 'LAC-002', '1/2 lb', 38, 50, 25, 6),
    ('Gaseosa 500 ml', 'Bebidas', 'BEB-001', '500 ml', 16, 22, 120, 24),
    ('Gaseosa 3 L', 'Bebidas', 'BEB-002', '3 litros', 58, 72, 40, 10),
    ('Agua purificada 600 ml', 'Bebidas', 'BEB-003', '600 ml', 10, 15, 120, 24),
    ('Jugo en caja 200 ml', 'Bebidas', 'BEB-004', '200 ml', 11, 15, 100, 20),
    ('Bolsa de hielo', 'Bebidas', 'BEB-005', 'Bolsa', 12, 20, 40, 10),
    ('Churritos (bolsita)', 'Snacks y dulces', 'SNA-001', 'Bolsita', 6, 10, 200, 40),
    ('Galletas soda paquete', 'Snacks y dulces', 'SNA-002', 'Paquete', 12, 17, 100, 20),
    ('Chocolate barra', 'Snacks y dulces', 'SNA-003', 'Unidad', 14, 20, 80, 15),
    ('Caramelos (unidad)', 'Snacks y dulces', 'SNA-004', 'Unidad', 0.7, 1, 500, 100),
    ('Chicle (unidad)', 'Snacks y dulces', 'SNA-005', 'Unidad', 1.5, 2, 300, 60),
    ('Jabón de baño', 'Higiene personal', 'HIG-001', 'Barra', 15, 22, 60, 12),
    ('Pasta dental 75 ml', 'Higiene personal', 'HIG-002', '75 ml', 32, 45, 40, 8),
    ('Papel higiénico 4 rollos', 'Higiene personal', 'HIG-003', '4 rollos', 42, 55, 40, 8),
    ('Champú sobre', 'Higiene personal', 'HIG-004', 'Sobre', 4, 6, 150, 30),
    ('Toalla sanitaria paquete', 'Higiene personal', 'HIG-005', 'Paquete', 38, 50, 30, 6),
    ('Detergente en polvo 500 g', 'Limpieza', 'LIM-001', '500 g', 36, 48, 50, 10),
    ('Cloro 1 L', 'Limpieza', 'LIM-002', '1 litro', 22, 30, 40, 8),
    ('Jabón de lavar barra', 'Limpieza', 'LIM-003', 'Barra', 14, 20, 60, 12),
    ('Cuaderno 100 hojas', 'Papelería', 'PAP-001', 'Unidad', 30, 45, 40, 8),
    ('Lapicero azul', 'Papelería', 'PAP-002', 'Unidad', 5, 10, 100, 20),
    ('Lápiz de grafito', 'Papelería', 'PAP-003', 'Unidad', 3, 6, 100, 20),
    ('Pilas AA par', 'Varios', 'VAR-001', 'Par', 22, 35, 40, 8),
    ('Fósforos caja', 'Varios', 'VAR-002', 'Caja', 2, 4, 100, 20),
    ('Bolsas plásticas paquete', 'Varios', 'VAR-003', 'Paquete', 15, 25, 40, 8)
  ) t(nombre, cat, sku, modelo, costo, precio, stock, minimo);
  insert into public.productos(auth_user_id, tipo, nombre, categoria, costo, precio, activo)
  values (u, 'servicio', 'Recarga telefónica', 'Servicios', 0, 50, true),
         (u, 'servicio', 'Fotocopia', 'Servicios', 0, 2, true),
         (u, 'servicio', 'Impresión de documento', 'Servicios', 0, 5, true);

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
    ns := case when d = 0 then 4 else 5 + (d % 4) + case when extract(dow from v_hoy - d) in (0, 6) then 4 else 0 end end;
    for i in 1 .. ns loop
      k := k + 1;
      select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = case when k % 5 = 0 then 'Transferencia' when k % 4 = 0 then 'Tarjeta' else 'Efectivo' end;
      v_cli_id := null; v_cli_nom := null;
      if k % 3 <> 0 then select id, nombre into v_cli_id, v_cli_nom from public.clientes where id = clis[1 + (k % 8)]; end if;
      v_det := '[]'::jsonb; v_stock := '[]'::jsonb; v_sub := 0; v_costo := 0;
      -- Cada venta: de 1 a 4 artículos de todo el surtido (como en una pulpería)
      ni := 1 + (k % 4);
      for j in 1 .. ni loop
        select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio, stock_actual into p from public.productos
         where auth_user_id = u and tipo = 'producto'
         order by sku offset ((k * 7 + j * 11) % n) limit 1;
        v_cant := case when p.precio <= 2 then 2 + ((k + j) % 5) when p.precio <= 20 then 1 + ((k + j) % 3) else 1 end;
        continue when p.id is null;
        select stock_actual into v_stk from public.productos where id = p.id;
        if v_stk < v_cant + coalesce((select sum((x ->> 'cantidad')::numeric) from jsonb_array_elements(v_stock) x where (x ->> 'producto_id')::uuid = p.id), 0) then continue; end if;
        v_det := v_det || jsonb_build_array(jsonb_build_object('auth_user_id', u, 'venta_id', null, 'producto_id', p.id, 'combo_id', null, 'promocion_id', null,
          'producto_nombre', p.nombre, 'producto_sku', p.sku, 'tipo_item', p.tipo, 'cantidad', v_cant, 'precio', p.precio, 'costo', p.costo, 'descuento', 0,
          'subtotal', round(v_cant * p.precio, 2), 'ganancia', round(v_cant * p.precio - v_cant * p.costo, 2), 'escala_id', null, 'escala_nombre', null,
          'vendido_sin_stock', false, 'es_regalia', false, 'presentacion_id', null, 'presentacion_nombre', null, 'presentacion_factor', null, 'lote_id', null,
          'cantidad_pedida', null, 'unidad_pedida', null));
        v_stock := v_stock || jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant));
        v_sub := v_sub + round(v_cant * p.precio, 2); v_costo := v_costo + v_cant * p.costo;
      end loop;
      continue when jsonb_array_length(v_det) = 0 or v_sub <= 0;
      v_num := public.generar_numero_venta(u);
      res := public.venta_registrar_atomica(
        jsonb_build_object('auth_user_id', u, 'numero_venta', v_num, 'cliente_id', v_cli_id, 'cliente_nombre', v_cli_nom, 'fecha', v_hoy - d,
          'subtotal', round(v_sub, 2), 'descuento', 0, 'impuesto', 0, 'total', round(v_sub, 2), 'costo_total', round(v_costo, 2),
          'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre, 'creado_por_nombre', 'Caja', 'estado', 'completada',
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
revoke all on function public._miscelanea_demo_crear() from public, anon, authenticated;

select public._miscelanea_demo_crear();
