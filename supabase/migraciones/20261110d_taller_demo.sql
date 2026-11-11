-- =====================================================================
-- TALLER MECÁNICO · Cuenta de demostración "Auto Servicio Los Robles" (10-nov-2026)
-- SOLO AGREGA: una cuenta demo con el Panel de Taller encendido: 8 vehículos y una orden de
-- trabajo en cada paso del flujo (recibido → diagnóstico → esperando aprobación → en reparación
-- → listo → entregado y cobrado), repuestos con stock y ventas de mostrador. Todo con las
-- funciones del sistema (taller_* y venta_registrar_atomica): caja, stock y reportes cuadran.
-- No toca ninguna otra cuenta.
-- =====================================================================
create or replace function public._taller_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-taller@negocio360oficial.com';
  bco uuid; prov uuid; r record; p record; n integer; d integer; i integer; j integer; k integer := 0; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; v_cli_id uuid; v_cli_nom text; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric; v_idx integer; v_stk numeric;
  prods uuid[]; res jsonb; v_ord uuid; v_lin jsonb;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Auto Servicio Los Robles ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoTaller#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Auto Servicio', 'email_verified', true, 'nombre_negocio', 'Auto Servicio Los Robles', 'phone_verified', false),
    now() - interval '20 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Taller Auto Servicio Los Robles', 'demo_publica', 'taller', 'Demo de taller mecánico: 8 vehículos con órdenes de trabajo en cada paso (recibido, diagnóstico, esperando aprobación, en reparación, listo y entregado), repuestos con stock y ventas de mostrador. Sin multiusuario.', 26);
  update public.usuarios set nombre = 'Demo', apellido = 'Auto Servicio', nombre_negocio = 'Auto Servicio Los Robles', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Auto Servicio Los Robles', 'reparacion', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Carretera a Masaya km 7, frente a la gasolinera, Managua', '2276-9090', '88009090',
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
  values (u, 'Repuestos Casa Pellas Mayoreo', '2255-4400', 'repuestos@mayoreo.example', 'Km 4 Carretera Norte, Managua', true) returning id into prov;


  update public.configuracion_empresa set usa_modulo_taller = true where auth_user_id = u;

  -- Repuestos e insumos: nombre, categoría, sku, presentación, costo, precio, stock, mínimo
  insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, modelo, costo, precio, stock_actual, stock_minimo, activo, proveedor_id, proveedor_nombre)
  select u, 'producto', t.nombre, t.cat, t.sku, t.modelo, t.costo, t.precio, t.stock, t.minimo, true, prov, 'Repuestos Casa Pellas Mayoreo'
  from (values
    ('Aceite de motor 20W-50 (litro)', 'Lubricantes', 'REP-001', 'Litro', 150, 230, 80, 15),
    ('Aceite sintético 5W-30 (litro)', 'Lubricantes', 'REP-002', 'Litro', 260, 380, 40, 10),
    ('Aceite para moto 4T (litro)', 'Lubricantes', 'REP-003', 'Litro', 140, 210, 40, 10),
    ('Filtro de aceite (Toyota/Nissan)', 'Filtros', 'REP-004', 'Unidad', 180, 290, 25, 6),
    ('Filtro de aire (sedán)', 'Filtros', 'REP-005', 'Unidad', 260, 420, 15, 4),
    ('Filtro de combustible', 'Filtros', 'REP-006', 'Unidad', 220, 360, 15, 4),
    ('Pastillas de freno delanteras', 'Frenos', 'REP-007', 'Juego', 750, 1250, 12, 3),
    ('Líquido de frenos DOT 4', 'Frenos', 'REP-008', 'Botella', 160, 260, 20, 5),
    ('Bujía de iridio', 'Encendido', 'REP-009', 'Unidad', 230, 380, 32, 8),
    ('Batería 12V 60Ah', 'Eléctrico', 'REP-010', 'Unidad', 3200, 4500, 6, 2),
    ('Bombillo H4', 'Eléctrico', 'REP-011', 'Unidad', 120, 220, 20, 5),
    ('Amortiguador delantero (pick-up)', 'Suspensión', 'REP-012', 'Unidad', 1900, 2900, 8, 2),
    ('Terminal de dirección', 'Suspensión', 'REP-013', 'Unidad', 520, 850, 10, 2),
    ('Refrigerante (galón)', 'Lubricantes', 'REP-014', 'Galón', 380, 560, 15, 4),
    ('Kit de cadena para moto', 'Motos', 'REP-015', 'Kit', 900, 1450, 8, 2),
    ('Gas refrigerante R134a', 'Aire acondicionado', 'REP-016', 'Lata', 450, 750, 10, 3)
  ) t(nombre, cat, sku, modelo, costo, precio, stock, minimo);

  insert into public.clientes(auth_user_id, nombre, apellido, telefono, direccion, ciudad, activo) values
    (u, 'Ernesto', 'Vargas', '88124578', 'Altamira, Managua', 'Managua', true),
    (u, 'Claudia', 'Morales', '87235689', 'Las Colinas, Managua', 'Managua', true),
    (u, 'Ramón', 'Saballos', '86346790', 'Barrio Riguero', 'Managua', true),
    (u, 'Transportes', 'El Rápido', '22661234', 'Carretera Norte km 9', 'Managua', true),
    (u, 'Silvia', 'Chamorro', '85457801', 'Villa Fontana', 'Managua', true),
    (u, 'Mauricio', 'Pineda', '84568912', 'Bello Horizonte', 'Managua', true),
    (u, 'Gloria', 'Rivera', '88679023', 'Ciudad Jardín', 'Managua', true),
    (u, 'Kevin', 'Martínez', '87780134', 'Barrio Larreynaga', 'Managua', true);
  select array_agg(id order by apellido) into clis from public.clientes where auth_user_id = u;

  -- Vehículos y órdenes de trabajo, cada una dejada en un paso distinto del flujo del taller
  for r in select * from jsonb_array_elements('[
    {"cli":8,"tipo":"camioneta","placa":"M 123-456","marca":"Toyota","modelo":"Hilux","anio":2019,"color":"Blanco","km":98500,"mec":"Don Chepe","prio":"normal","fin":"entregar","pago":"Efectivo",
     "falla":"Mantenimiento de los 100,000 km","lineas":[["mano_obra",null,"Mantenimiento preventivo completo",1,1200],["repuesto","REP-001","",6,230],["repuesto","REP-004","",1,290],["repuesto","REP-005","",1,420],["repuesto","REP-009","",4,380]]},
    {"cli":4,"tipo":"auto","placa":"M 234-567","marca":"Honda","modelo":"Civic","anio":2016,"color":"Gris","km":121300,"mec":"Wilber","prio":"normal","fin":"entregar","pago":"Transferencia",
     "falla":"Chillan los frenos al frenar","lineas":[["mano_obra",null,"Cambio de pastillas y rectificado de discos",1,900],["repuesto","REP-007","",1,1250],["repuesto","REP-008","",1,260]]},
    {"cli":1,"tipo":"moto","placa":"M 345-678","marca":"Yamaha","modelo":"YBR 125","anio":2021,"color":"Negro","km":18700,"mec":"Wilber","prio":"normal","fin":"entregar","pago":"Efectivo",
     "falla":"Cambio de aceite y la cadena suena","lineas":[["mano_obra",null,"Cambio de aceite y kit de arrastre",1,350],["repuesto","REP-003","",1,210],["repuesto","REP-015","",1,1450]]},
    {"cli":5,"tipo":"camioneta","placa":"M 456-789","marca":"Nissan","modelo":"Frontier","anio":2018,"color":"Rojo","km":143200,"mec":"Don Chepe","prio":"urgente","fin":"listo",
     "falla":"Golpe en la suspensión delantera","lineas":[["mano_obra",null,"Cambio de amortiguadores y terminales",1,1500],["repuesto","REP-012","",2,2900],["repuesto","REP-013","",2,850],["externo",null,"Alineación y balanceo (taller externo)",1,600]]},
    {"cli":6,"tipo":"auto","placa":"M 567-890","marca":"Hyundai","modelo":"Accent","anio":2015,"color":"Azul","km":156000,"mec":"Juan Pablo","prio":"normal","fin":"en_reparacion",
     "falla":"No enciende en las mañanas","lineas":[["mano_obra",null,"Revisión del sistema eléctrico y de carga",1,700],["repuesto","REP-010","",1,4500]]},
    {"cli":2,"tipo":"auto","placa":"M 678-901","marca":"Kia","modelo":"Rio","anio":2020,"color":"Blanco","km":64300,"mec":"Juan Pablo","prio":"normal","fin":"esperando_aprobacion",
     "falla":"El aire acondicionado no enfría","lineas":[["mano_obra",null,"Diagnóstico y recarga de aire acondicionado",1,800],["repuesto","REP-016","",2,750],["externo",null,"Cambio de compresor (si hace falta)",1,9500]]},
    {"cli":7,"tipo":"auto","placa":"M 789-012","marca":"Toyota","modelo":"Corolla","anio":2017,"color":"Plateado","km":110900,"mec":"Don Chepe","prio":"normal","fin":"diagnostico",
     "falla":"Ruido en el motor al acelerar","lineas":[["mano_obra",null,"Diagnóstico con escáner",1,500]]},
    {"cli":3,"tipo":"moto","placa":"M 890-123","marca":"Honda","modelo":"XR 150","anio":2022,"color":"Rojo","km":9200,"mec":null,"prio":"normal","fin":"recibido",
     "falla":"Revisión general antes de viaje","lineas":[]}
  ]'::jsonb) loop
    res := public.taller_vehiculo_guardar(jsonb_build_object('cliente_id', clis[(r.value ->> 'cli')::int], 'tipo', r.value ->> 'tipo', 'placa', r.value ->> 'placa',
      'marca', r.value ->> 'marca', 'modelo', r.value ->> 'modelo', 'anio', r.value ->> 'anio', 'color', r.value ->> 'color', 'km_actual', r.value ->> 'km', 'creado_por', 'Recepción'));
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Vehículo demo: %', res; end if;
    res := public.taller_orden_crear(jsonb_build_object('vehiculo_id', res ->> 'id', 'falla_reportada', r.value ->> 'falla', 'mecanico_nombre', r.value ->> 'mec',
      'km_ingreso', r.value ->> 'km', 'prioridad', r.value ->> 'prio', 'fecha_prometida', v_hoy + 2, 'iva_activo', false, 'creado_por', 'Recepción'));
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Orden demo: %', res; end if;
    v_ord := (res ->> 'id')::uuid;
    for j in 0 .. jsonb_array_length(r.value -> 'lineas') - 1 loop
      v_lin := r.value -> 'lineas' -> j;
      res := public.taller_linea_guardar(v_ord, jsonb_build_object('tipo', v_lin ->> 0,
        'producto_id', (select id from public.productos where auth_user_id = u and sku = v_lin ->> 1),
        'descripcion', v_lin ->> 2, 'cantidad', v_lin ->> 3, 'precio_unitario', v_lin ->> 4,
        'costo_unitario', case when v_lin ->> 0 = 'externo' then round((v_lin ->> 4)::numeric * 0.7, 2) else 0 end, 'por', 'Mecánico'));
      if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Línea demo: %', res; end if;
    end loop;
    continue when r.value ->> 'fin' = 'recibido';
    perform public.taller_orden_estado(v_ord, 'diagnostico', 'Mecánico');
    continue when r.value ->> 'fin' = 'diagnostico';
    perform public.taller_orden_estado(v_ord, 'esperando_aprobacion', 'Recepción');
    continue when r.value ->> 'fin' = 'esperando_aprobacion';
    perform public.taller_decidir_lineas(v_ord, (select array_agg(id) from public.taller_orden_lineas where orden_id = v_ord), 'aprobada', 'Cliente (por WhatsApp)', null);
    res := public.taller_orden_estado(v_ord, 'en_reparacion', 'Mecánico');
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Estado demo: %', res; end if;
    continue when r.value ->> 'fin' = 'en_reparacion';
    res := public.taller_orden_estado(v_ord, 'listo', 'Mecánico');
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Listo demo: %', res; end if;
    continue when r.value ->> 'fin' = 'listo';
    select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = r.value ->> 'pago';
    res := public.taller_orden_entregar(v_ord, jsonb_build_object('metodo_pago_id', v_mp.id, 'metodo_pago_nombre', v_mp.nombre,
      'banco_id', case when v_mp.nombre = 'Transferencia' then bco end, 'km_salida', r.value ->> 'km', 'creado_por', 'Caja'));
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Entrega demo: %', res; end if;
  end loop;

  -- Ventas de mostrador de repuestos (últimos 14 días), con la función de ventas del sistema
  select array_agg(id order by sku) into prods from public.productos where auth_user_id = u and tipo = 'producto';
  n := cardinality(prods);
  for d in reverse 13 .. 1 loop
    continue when extract(dow from v_hoy - d) = 0;
    for i in 1 .. 1 + (d % 3) loop
      k := k + 1;
      select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = case when k % 3 = 0 then 'Transferencia' else 'Efectivo' end;
      select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio, stock_actual into p from public.productos
       where auth_user_id = u and tipo = 'producto' and categoria in ('Lubricantes', 'Filtros', 'Encendido', 'Eléctrico', 'Frenos') and precio < 1500
       order by sku offset (k * 3 % 9) limit 1;
      v_cant := case when p.precio < 400 then 1 + (k % 4) else 1 end;
      continue when p.id is null or p.stock_actual < v_cant + 2;
      v_num := public.generar_numero_venta(u);
      res := public.venta_registrar_atomica(
        jsonb_build_object('auth_user_id', u, 'numero_venta', v_num, 'cliente_id', null, 'cliente_nombre', null, 'fecha', v_hoy - d,
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
          'banco_id', case when v_mp.nombre = 'Transferencia' then bco end, 'monto_moneda_banco', case when v_mp.nombre = 'Transferencia' then round(v_cant * p.precio, 2) end,
          'observaciones', null, 'fecha', v_hoy - d)),
        null, null);
    end loop;
  end loop;
  return u;
end $f$;
revoke all on function public._taller_demo_crear() from public, anon, authenticated;

select public._taller_demo_crear();
