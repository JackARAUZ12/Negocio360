-- =====================================================================
-- DISTRIBUIDORA · Cuenta de demostración "Distribuidora Del Pacífico" (10-nov-2026)
-- SOLO AGREGA: una cuenta demo que vende por mayor a pulperías: 3 vendedores por ruta
-- con comisión del 3%, precios por escala (docena / caja), 14 días de ventas y 4 créditos
-- a tiendas. Todo con las funciones del sistema (venta_registrar_atomica, mf_credito_crear,
-- mf_cobrar, comision_generar): caja, stock y reportes cuadran. No toca ninguna otra cuenta.
-- =====================================================================
create or replace function public._distribuidora_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-distribuidora@negocio360oficial.com';
  bco uuid; prov uuid; r record; p record; n integer; d integer; i integer; j integer; k integer := 0; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; v_cli_id uuid; v_cli_nom text; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric; v_idx integer; v_stk numeric;
  prods uuid[]; res jsonb; vends uuid[]; vnoms text[]; v_vend integer; v_esc record; v_pid uuid; v_pr numeric; v_items jsonb;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Distribuidora Del Pacífico ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoDistribuidora#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Del Pacífico', 'email_verified', true, 'nombre_negocio', 'Distribuidora Del Pacífico', 'phone_verified', false),
    now() - interval '20 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Distribuidora Del Pacífico', 'demo_publica', 'distribuidora', 'Demo de distribuidora: venta por mayor a pulperías con 3 vendedores por ruta (comisión 3%), precios por escala (docena y caja), 14 días de ventas y créditos a tiendas. Sin multiusuario.', 25);
  update public.usuarios set nombre = 'Demo', apellido = 'Del Pacífico', nombre_negocio = 'Distribuidora Del Pacífico', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Distribuidora Del Pacífico', 'distribuidor', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Carretera Norte km 6, bodega 12, Managua', '2233-8080', '88008080',
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
  values (u, 'Importadora Centroamericana S.A.', '2251-1010', 'pedidos@importcentro.example', 'Zona Franca Las Mercedes, Managua', true) returning id into prov;


  -- Flags del rubro: vendedores y comisiones
  update public.configuracion_empresa set usa_vendedores = true, usa_modulo_comisiones = true where auth_user_id = u;

  -- Catálogo por mayor: nombre, categoría, sku, presentación, costo, precio unidad, precio docena (12+), precio caja, cantidad caja, stock
  for r in select * from (values
    ('Aceite vegetal 1 L', 'Aceites', 'DIS-001', 'Botella 1 L', 55, 68, 64, 61, 12, 1500),
    ('Arroz precocido 1 lb', 'Granos', 'DIS-002', 'Bolsa 1 lb', 14, 18, 17, 16, 25, 3000),
    ('Azúcar blanca 1 lb', 'Granos', 'DIS-003', 'Bolsa 1 lb', 13, 17, 16, 15, 25, 3000),
    ('Frijol rojo 1 lb', 'Granos', 'DIS-004', 'Bolsa 1 lb', 25, 32, 30, 29, 25, 2000),
    ('Café molido 115 g', 'Café', 'DIS-005', 'Bolsa 115 g', 33, 42, 40, 38, 24, 1500),
    ('Pasta espagueti 200 g', 'Abarrotes', 'DIS-006', 'Paquete', 11, 16, 15, 14, 24, 2000),
    ('Sopa instantánea', 'Abarrotes', 'DIS-007', 'Vaso', 10, 15, 14, 13, 24, 2500),
    ('Salsa de tomate 106 g', 'Abarrotes', 'DIS-008', 'Sobre', 7, 10, 9.5, 9, 48, 3000),
    ('Galletas soda paquete', 'Snacks', 'DIS-009', 'Paquete', 10, 14, 13, 12.5, 24, 2000),
    ('Gaseosa 500 ml', 'Bebidas', 'DIS-010', 'Botella', 14, 19, 18, 17, 24, 3000),
    ('Agua purificada 600 ml', 'Bebidas', 'DIS-011', 'Botella', 8, 12, 11, 10, 24, 3000),
    ('Jabón de lavar barra', 'Limpieza', 'DIS-012', 'Barra', 12, 17, 16, 15, 25, 2000),
    ('Detergente 500 g', 'Limpieza', 'DIS-013', 'Bolsa', 31, 41, 39, 37, 24, 1500),
    ('Papel higiénico 4 rollos', 'Higiene', 'DIS-014', 'Paquete', 36, 47, 45, 43, 12, 1200)
  ) t(nombre, cat, sku, modelo, costo, precio, p12, pcaja, ncaja, stock) loop
    insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, modelo, costo, precio, stock_actual, stock_minimo, activo, proveedor_id, proveedor_nombre)
    values (u, 'producto', r.nombre, r.cat, r.sku, r.modelo, r.costo, r.precio, r.stock, round(r.stock * 0.15), true, prov, 'Importadora Centroamericana S.A.')
    returning id into v_pid;
    insert into public.precios_escala(auth_user_id, producto_id, nombre, precio, cantidad_minima, orden)
    values (u, v_pid, 'Docena', r.p12, 12, 1);
    if r.ncaja > 12 then
      insert into public.precios_escala(auth_user_id, producto_id, nombre, precio, cantidad_minima, orden)
      values (u, v_pid, 'Caja (' || r.ncaja || ')', r.pcaja, r.ncaja, 2);
    else
      update public.precios_escala set nombre = 'Caja (12)', precio = r.pcaja where producto_id = v_pid;
    end if;
  end loop;

  -- Vendedores por ruta (cada venta queda a nombre del vendedor; la comisión del 3% se calcula sola)
  for r in select * from (values ('Carlos Méndez · Ruta Norte', '88101010', 1), ('Luis Ortega · Ruta Sur', '88202020', 2), ('Karen Vílchez · Ruta Masaya', '88303030', 3)) t(n, tel, o) order by o loop
    insert into public.vendedores(auth_user_id, nombre, telefono, activo) values (u, r.n, r.tel, true) returning id into v_pid;
    vends := array_append(vends, v_pid); vnoms := array_append(vnoms, r.n::text);
    insert into public.comision_beneficiarios(auth_user_id, nombre, vendedor_nombre, base, valor, fecha_inicio, telefono, notas)
    values (u, split_part(r.n, ' · ', 1), r.n, 'venta', 3, v_hoy - 30, r.tel, 'Comisión 3% sobre lo vendido');
  end loop;

  insert into public.clientes(auth_user_id, nombre, apellido, telefono, direccion, ciudad, activo) values
    (u, 'Pulpería', 'La Esperanza', '88112200', 'Barrio Larreynaga, de la farmacia 1c. al lago', 'Managua', true),
    (u, 'Pulpería', 'Doña Tere', '87223300', 'Ciudad Sandino, zona 8', 'Ciudad Sandino', true),
    (u, 'Mini súper', 'El Ahorro', '86334400', 'Tipitapa, frente al parque', 'Tipitapa', true),
    (u, 'Abarrotería', 'San José', '85445500', 'Mercado Oriental, calle 7', 'Managua', true),
    (u, 'Pulpería', 'El Buen Precio', '84556600', 'Masaya, barrio Monimbó', 'Masaya', true),
    (u, 'Tienda', 'La Bendición', '88667700', 'Nindirí, costado sur de la iglesia', 'Nindirí', true),
    (u, 'Pulpería', 'Rosita', '87778800', 'Barrio Jorge Dimitrov', 'Managua', true),
    (u, 'Mini súper', 'La Económica', '86889900', 'Masaya, calle El Calvario', 'Masaya', true),
    (u, 'Pulpería', 'Los Gemelos', '85990000', 'Villa Libertad, de la parada 2c. arriba', 'Managua', true),
    (u, 'Distribuidora', 'Hermanos López', '84001100', 'Granada, mercado municipal', 'Granada', true);
  select array_agg(id order by apellido) into clis from public.clientes where auth_user_id = u;
  select array_agg(id order by sku) into prods from public.productos where auth_user_id = u and tipo = 'producto';
  n := cardinality(prods);

  -- 14 días de ventas por mayor, cada una a nombre de su vendedor y con el precio de escala que corresponde
  for d in reverse 13 .. 0 loop
    continue when extract(dow from v_hoy - d) = 0;   -- domingo no se sale a ruta
    ns := case when d = 0 then 3 else 4 + (d % 3) end;
    for i in 1 .. ns loop
      k := k + 1;
      v_vend := 1 + (k % 3);
      select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = case when k % 3 = 0 then 'Transferencia' else 'Efectivo' end;
      select id, nombre || ' ' || apellido as nom into r from public.clientes where id = clis[1 + (k % 10)];
      v_cli_id := r.id; v_cli_nom := r.nom;
      v_det := '[]'::jsonb; v_stock := '[]'::jsonb; v_sub := 0; v_costo := 0;
      ni := 2 + (k % 3);
      for j in 1 .. ni loop
        select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio, stock_actual into p from public.productos
         where auth_user_id = u and tipo = 'producto' order by sku offset ((k * 5 + j * 3) % n) limit 1;
        v_cant := case (k + j) % 4 when 0 then 6 when 1 then 12 when 2 then 24 else 48 end;
        select id, nombre, precio into v_esc from public.precios_escala where producto_id = p.id and cantidad_minima <= v_cant order by cantidad_minima desc limit 1;
        v_pr := coalesce(v_esc.precio, p.precio);
        if p.stock_actual < v_cant + coalesce((select sum((x ->> 'cantidad')::numeric) from jsonb_array_elements(v_stock) x where (x ->> 'producto_id')::uuid = p.id), 0) then continue; end if;
        v_det := v_det || jsonb_build_array(jsonb_build_object('auth_user_id', u, 'venta_id', null, 'producto_id', p.id, 'combo_id', null, 'promocion_id', null,
          'producto_nombre', p.nombre, 'producto_sku', p.sku, 'tipo_item', p.tipo, 'cantidad', v_cant, 'precio', v_pr, 'costo', p.costo, 'descuento', 0,
          'subtotal', round(v_cant * v_pr, 2), 'ganancia', round(v_cant * v_pr - v_cant * p.costo, 2), 'escala_id', v_esc.id, 'escala_nombre', v_esc.nombre,
          'vendido_sin_stock', false, 'es_regalia', false, 'presentacion_id', null, 'presentacion_nombre', null, 'presentacion_factor', null, 'lote_id', null,
          'cantidad_pedida', null, 'unidad_pedida', null));
        v_stock := v_stock || jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant));
        v_sub := v_sub + round(v_cant * v_pr, 2); v_costo := v_costo + v_cant * p.costo;
      end loop;
      continue when jsonb_array_length(v_det) = 0 or v_sub <= 0;
      v_num := public.generar_numero_venta(u);
      res := public.venta_registrar_atomica(
        jsonb_build_object('auth_user_id', u, 'numero_venta', v_num, 'cliente_id', v_cli_id, 'cliente_nombre', v_cli_nom, 'fecha', v_hoy - d,
          'subtotal', round(v_sub, 2), 'descuento', 0, 'impuesto', 0, 'total', round(v_sub, 2), 'costo_total', round(v_costo, 2),
          'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre, 'creado_por_nombre', vnoms[v_vend], 'vendedor_id', vends[v_vend], 'estado', 'completada',
          'observaciones', null, 'iva_activo', false, 'iva_porcentaje', 0),
        v_det, v_stock,
        jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num, 'monto', round(v_sub, 2), 'metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre,
          'banco_id', case when v_mp.nombre = 'Transferencia' then bco end, 'monto_moneda_banco', case when v_mp.nombre = 'Transferencia' then round(v_sub, 2) end,
          'observaciones', null, 'fecha', v_hoy - d)),
        round(v_sub, 2), null);
    end loop;
  end loop;

  -- Créditos a tiendas (a 30 días, en 2 pagos quincenales, sin recargo), con la función de ventas al crédito
  -- del sistema. El Panel Microfinanciera solo se enciende mientras se crean y se apaga al final.
  perform set_config('n360.mf_ok', '1', true);
  update public.configuracion_empresa set usa_modulo_microfinanciera = true where auth_user_id = u;
  perform set_config('n360.mf_ok', '', true);
  for r in select * from (values (4, -16, true), (6, -9, false), (8, -3, false), (10, 4, false)) t(cli, ini, abona) loop
    k := k + 1;
    select jsonb_agg(jsonb_build_object('producto_id', x.id, 'cantidad', 24, 'precio',
             coalesce((select pe.precio from public.precios_escala pe where pe.producto_id = x.id and pe.cantidad_minima <= 24 order by pe.cantidad_minima desc limit 1), x.precio)))
      into v_items from (select id, precio from public.productos where auth_user_id = u and tipo = 'producto' order by sku offset (r.cli % 10) limit 3) x;
    res := public.mf_credito_crear(jsonb_build_object('tipo', 'productos', 'cliente_id', clis[r.cli], 'items', v_items, 'recargo_pct', 0,
      'frecuencia', 'quincenal', 'num_cuotas', 2, 'primera_fecha', v_hoy + r.ini, 'dias_cobro', 'lun_sab', 'ref', 'demo-dist-cr-' || k,
      'creado_por', vnoms[1 + (r.cli % 3)], 'nota', 'Crédito a 30 días'));
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Crédito demo no se creó: %', res; end if;
    if r.abona then
      select monto_total into v_pr from public.creditos_cuotas where credito_id = (res ->> 'credito_id')::uuid order by numero limit 1;
      res := public.mf_cobrar(jsonb_build_object('credito_id', (res ->> 'credito_id')::uuid, 'monto', v_pr, 'metodo_pago_nombre', 'Efectivo', 'ref', 'demo-dist-ab-' || k, 'creado_por', 'Caja'));
      if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Abono demo no se registró: %', res; end if;
    end if;
  end loop;
  perform set_config('n360.mf_ok', '1', true);
  update public.configuracion_empresa set usa_modulo_microfinanciera = false where auth_user_id = u;
  perform set_config('n360.mf_ok', '', true);

  -- Comisiones de las ventas (quedan "por pagar" a cada vendedor)
  res := public.comision_generar(v_hoy - 30, v_hoy);
  return u;
end $f$;
revoke all on function public._distribuidora_demo_crear() from public, anon, authenticated;

select public._distribuidora_demo_crear();
