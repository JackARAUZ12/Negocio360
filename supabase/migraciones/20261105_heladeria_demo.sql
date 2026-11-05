-- =====================================================================
-- HELADERÍA · Cuenta de demostración "Heladería Polo Norte" (05-nov-2026)
-- SOLO AGREGA: una cuenta demo (como las demás demos) con helados, toppings, malteadas y postres,
-- clientes y 14 días de ventas de ejemplo. Las ventas se registran con la MISMA función del sistema
-- (venta_registrar_atomica): stock, caja, bancos y reportes cuadran igual que en una cuenta real.
-- No toca ninguna otra cuenta.
-- =====================================================================
create or replace function public._heladeria_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-heladeria@negocio360oficial.com';
  bco uuid; prov uuid; r record; p record; n integer; d integer; i integer; j integer; k integer := 0; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; v_cli_id uuid; v_cli_nom text; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric; v_idx integer; v_stk numeric;
  prods uuid[]; res jsonb;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Heladería ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoHeladeria#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Polo Norte', 'email_verified', true, 'nombre_negocio', 'Heladería Polo Norte', 'phone_verified', false),
    now() - interval '15 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Heladería Polo Norte', 'demo_publica', 'heladeria', 'Demo de heladería: helados por bola, conos, vasos, toppings, malteadas y postres, con clientes y 14 días de ventas de ejemplo. Sin multiusuario.', 22);
  update public.usuarios set nombre = 'Demo', apellido = 'Polo Norte', nombre_negocio = 'Heladería Polo Norte', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Heladería Polo Norte', 'heladeria', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Carretera a Masaya km 5, frente a Galerías, Managua', '2278-5050', '88005050',
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
  values (u, 'Distribuidora Lácteos del Norte', '2255-7070', 'ventas@lacteosnorte.example', 'Carretera Norte km 8, Managua', true) returning id into prov;

  -- Catálogo: nombre, categoría, sku, modelo (presentación), costo, precio, stock inicial, stock mínimo
  insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, modelo, costo, precio, stock_actual, stock_minimo, activo, proveedor_id, proveedor_nombre)
  select u, 'producto', t.nombre, t.cat, t.sku, t.modelo, t.costo, t.precio, t.stock, t.minimo, true, prov, 'Distribuidora Lácteos del Norte'
  from (values
    ('Helado 1 bola en vaso', 'Helados', 'HEL-001', 'Vaso 1 bola', 18, 45, 150, 30),
    ('Helado 2 bolas en vaso', 'Helados', 'HEL-002', 'Vaso 2 bolas', 32, 80, 150, 30),
    ('Helado 3 bolas en vaso', 'Helados', 'HEL-003', 'Vaso 3 bolas', 45, 110, 120, 25),
    ('Cono sencillo 1 bola', 'Helados', 'HEL-004', 'Cono', 20, 50, 150, 30),
    ('Cono doble 2 bolas', 'Helados', 'HEL-005', 'Cono', 35, 85, 120, 25),
    ('Cono bañado en chocolate', 'Helados', 'HEL-006', 'Cono', 30, 75, 80, 20),
    ('Litro de helado (2 sabores)', 'Para llevar', 'LLE-001', '1 litro', 110, 260, 40, 8),
    ('Medio galón de helado (3 sabores)', 'Para llevar', 'LLE-002', '1/2 galón', 230, 520, 20, 5),
    ('Topping chispas de chocolate', 'Toppings', 'TOP-001', 'Porción', 4, 15, 300, 50),
    ('Topping chispas de colores', 'Toppings', 'TOP-002', 'Porción', 3, 15, 300, 50),
    ('Topping M&M', 'Toppings', 'TOP-003', 'Porción', 7, 20, 200, 40),
    ('Topping galleta Oreo triturada', 'Toppings', 'TOP-004', 'Porción', 6, 20, 200, 40),
    ('Topping fresas frescas', 'Toppings', 'TOP-005', 'Porción', 8, 25, 120, 30),
    ('Topping banano en rodajas', 'Toppings', 'TOP-006', 'Porción', 4, 15, 120, 30),
    ('Topping maní tostado', 'Toppings', 'TOP-007', 'Porción', 3, 15, 200, 40),
    ('Topping gomitas', 'Toppings', 'TOP-008', 'Porción', 5, 15, 200, 40),
    ('Sirope de chocolate', 'Siropes y cremas', 'SIR-001', 'Porción', 3, 10, 300, 50),
    ('Sirope de caramelo', 'Siropes y cremas', 'SIR-002', 'Porción', 3, 10, 300, 50),
    ('Sirope de fresa', 'Siropes y cremas', 'SIR-003', 'Porción', 3, 10, 300, 50),
    ('Crema batida', 'Siropes y cremas', 'SIR-004', 'Porción', 4, 15, 250, 40),
    ('Cereza en almíbar', 'Siropes y cremas', 'SIR-005', 'Unidad', 2, 8, 300, 50),
    ('Malteada de vainilla', 'Malteadas', 'MAL-001', '16 oz', 40, 110, 80, 15),
    ('Malteada de chocolate', 'Malteadas', 'MAL-002', '16 oz', 42, 110, 80, 15),
    ('Malteada de fresa', 'Malteadas', 'MAL-003', '16 oz', 42, 110, 80, 15),
    ('Malteada Oreo', 'Malteadas', 'MAL-004', '16 oz', 50, 130, 60, 12),
    ('Banana split', 'Postres', 'POS-001', '3 bolas', 65, 160, 50, 10),
    ('Sundae de chocolate', 'Postres', 'POS-002', 'Copa', 40, 95, 60, 12),
    ('Brownie con helado', 'Postres', 'POS-003', 'Plato', 50, 120, 40, 10),
    ('Paleta de agua (frutas)', 'Paletas', 'PAL-001', 'Unidad', 12, 30, 120, 25),
    ('Paleta de leche cubierta', 'Paletas', 'PAL-002', 'Unidad', 20, 45, 100, 20),
    ('Botella de agua 600 ml', 'Bebidas', 'BEB-001', '600 ml', 10, 25, 100, 20)
  ) t(nombre, cat, sku, modelo, costo, precio, stock, minimo);
  insert into public.productos(auth_user_id, tipo, nombre, categoria, costo, precio, activo)
  values (u, 'servicio', 'Pastel de helado por encargo', 'Encargos', 0, 650, true),
         (u, 'servicio', 'Servicio de carrito de helados para eventos', 'Encargos', 0, 2500, true);

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
      -- Cada venta: 1 o 2 helados/postres/malteadas y casi siempre 1 o 2 toppings o siropes
      ni := 1 + (k % 2);
      for j in 1 .. ni + 1 + (k % 2) loop
        if j <= ni then
          select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio, stock_actual into p from public.productos
           where auth_user_id = u and tipo = 'producto' and categoria in ('Helados','Malteadas','Postres','Paletas','Para llevar','Bebidas')
           order by sku offset ((k * 7 + j * 5) % 20) limit 1;
          v_cant := case when p.precio <= 50 then 1 + ((k + j) % 3) else 1 end;
        else
          select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio, stock_actual into p from public.productos
           where auth_user_id = u and tipo = 'producto' and categoria in ('Toppings','Siropes y cremas')
           order by sku offset ((k * 3 + j * 7) % 13) limit 1;
          v_cant := 1;
        end if;
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
revoke all on function public._heladeria_demo_crear() from public, anon, authenticated;

select public._heladeria_demo_crear();
