-- =====================================================================
-- AGROSERVICIO · Cuenta de demostración "Agroservicio El Productor" (11-nov-2026)
-- SOLO AGREGA: una cuenta demo con el Panel de Agroservicio encendido: agroquímicos, fertilizantes
-- (con saco de 100 lb), semillas, veterinarios, alimento y herramientas; lotes (uno vencido y otros por
-- vencer), 5 productores con ficha y límite, 12 días de ventas de contado y fiadas, y ventas de
-- restringidos con su bitácora. Todo con las funciones del sistema: caja, stock, lotes y fiados cuadran.
-- =====================================================================
create or replace function public._agroservicio_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-agroservicio@negocio360oficial.com';
  bco uuid; prov uuid; r record; p record; n integer; d integer; i integer; j integer; k integer := 0; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; v_cli_id uuid; v_cli_nom text; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric; v_idx integer; v_stk numeric;
  prods uuid[]; res jsonb; v_pid uuid; v_lote uuid; v_lotes jsonb; v_fiado jsonb; v_x jsonb; v_ced text; v_dir text;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Agroservicio El Productor ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoAgro#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'El Productor', 'email_verified', true, 'nombre_negocio', 'Agroservicio El Productor', 'phone_verified', false),
    now() - interval '20 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Agroservicio El Productor', 'demo_publica', 'agroservicio', 'Demo de agroservicio / agroveterinaria: panel único con productores (finca, cultivos, límite y fecha de cosecha), fiado a cosecha, productos restringidos vendidos con cédula y receta (bitácora IPSA), lotes con vencimientos y 12 días de ventas. Sin multiusuario.', 28);
  update public.usuarios set nombre = 'Demo', apellido = 'El Productor', nombre_negocio = 'Agroservicio El Productor', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Agroservicio El Productor', 'agroservicio', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Del Banco Lafise 2 c. al norte, Estelí', '2713-5050', '88005050',
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
  values (u, 'Agroinsumos del Norte', '2713-2020', 'ventas@agroinsumosnorte.example', 'Carretera Panamericana km 148, Estelí', true) returning id into prov;

  update public.configuracion_empresa set usa_modulo_agro = true, agro_receta_obligatoria = true, maneja_lotes_vencimiento = true, usa_modulo_fiados = true where auth_user_id = u;

  -- Productos: nombre, categoría, sku, unidad, costo, precio, mínimo, restringido, ¿con lote?, vence (días) lote 1, cant 1, vence lote 2, cant 2
  for r in select * from (values
    ('Gramoxone (Paraquat) 1 L', 'Agroquímicos', 'AGQ-001', 'litro', 210, 290, 10, true, true, 240, 18, 520, 24),
    ('Glifosato 41% 1 L', 'Agroquímicos', 'AGQ-002', 'litro', 160, 230, 10, true, true, 25, 12, 400, 30),
    ('Cipermetrina 25 EC 250 ml', 'Agroquímicos', 'AGQ-003', 'unidad', 85, 130, 8, true, true, 300, 30, 0, 0),
    ('Mancozeb 80% 1 kg', 'Agroquímicos', 'AGQ-004', 'unidad', 150, 215, 6, false, true, 45, 10, 380, 20),
    ('Fertilizante 15-15-15 (libra)', 'Fertilizantes', 'FER-001', 'libra', 13.5, 18, 400, false, false, 0, 1500, 0, 0),
    ('Urea 46% (libra)', 'Fertilizantes', 'FER-002', 'libra', 12, 16, 300, false, false, 0, 1200, 0, 0),
    ('Semilla maíz NB-6 (libra)', 'Semillas', 'SEM-001', 'libra', 38, 55, 50, false, true, 150, 300, 0, 0),
    ('Semilla frijol INTA Rojo (libra)', 'Semillas', 'SEM-002', 'libra', 45, 65, 50, false, true, 120, 200, 0, 0),
    ('Ivermectina 1% 50 ml', 'Veterinarios', 'VET-001', 'unidad', 95, 150, 6, true, true, -10, 3, 330, 15),
    ('Vacuna triple bovina 10 dosis', 'Veterinarios', 'VET-002', 'unidad', 180, 260, 4, false, true, 20, 8, 0, 0),
    ('Vitaminas ADE 100 ml', 'Veterinarios', 'VET-003', 'unidad', 120, 175, 4, false, true, 200, 12, 0, 0),
    ('Concentrado ganado lechero (quintal)', 'Alimento animal', 'ALI-001', 'unidad', 780, 950, 5, false, false, 0, 25, 0, 0),
    ('Alimento pollo engorde (quintal)', 'Alimento animal', 'ALI-002', 'unidad', 920, 1100, 5, false, false, 0, 20, 0, 0),
    ('Bomba de mochila 20 L', 'Herramientas', 'HER-001', 'unidad', 1450, 1950, 2, false, false, 0, 6, 0, 0),
    ('Machete 22"', 'Herramientas', 'HER-002', 'unidad', 140, 210, 5, false, false, 0, 24, 0, 0)
  ) t(nombre, cat, sku, uni, costo, precio, minimo, restr, conlote, v1, c1, v2, c2) loop
    insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, unidad_codigo, costo, precio, stock_actual, stock_minimo, activo, es_sustancia_controlada, proveedor_id, proveedor_nombre)
    values (u, 'producto', r.nombre, r.cat, r.sku, r.uni, r.costo, r.precio, r.c1 + r.c2, r.minimo, true, r.restr, prov, 'Agroinsumos del Norte')
    returning id into v_pid;
    if r.conlote then
      insert into public.producto_lotes(auth_user_id, producto_id, numero_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, costo_unitario, activo)
      values (u, v_pid, 'L-' || r.sku || '-A', v_hoy + r.v1, r.c1, r.c1, r.costo, true);
      if r.c2 > 0 then
        insert into public.producto_lotes(auth_user_id, producto_id, numero_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, costo_unitario, activo)
        values (u, v_pid, 'L-' || r.sku || '-B', v_hoy + r.v2, r.c2, r.c2, r.costo, true);
      end if;
    end if;
  end loop;
  -- Presentaciones: el fertilizante y la urea se venden por libra o por saco de 100 lb
  insert into public.producto_presentaciones(auth_user_id, producto_id, nombre, factor, precio, orden, activo)
  select u, id, 'Saco 100 lb', 100, case sku when 'FER-001' then 1700 else 1500 end, 1, true from public.productos where auth_user_id = u and sku in ('FER-001', 'FER-002');

  -- Productores con su ficha (función del panel)
  for r in select * from (values
    ('Juan Ramón', 'Martínez', '001-150378-0003K', '84561230', 'Finca El Roble', 'Comarca Las Mercedes', 'Estelí', '[{"cultivo":"Maíz","manzanas":6},{"cultivo":"Frijol","manzanas":3}]', '[{"tipo":"Vacas","cantidad":8}]', 45, 15000),
    ('María Elena', 'Rizo', '161-220985-0001P', '86234517', 'Finca Santa Rosa', 'Comarca La Montañita', 'Condega', '[{"cultivo":"Café","manzanas":4}]', '[{"tipo":"Gallinas","cantidad":40}]', 20, 10000),
    ('Pedro', 'Castillo', '001-030770-0012L', '85779012', 'Finca Los Pinos', 'Comarca San Pedro', 'Estelí', '[{"cultivo":"Frijol","manzanas":5}]', '[]', 75, 8000),
    ('Cooperativa', 'Agrícola El Progreso', 'J0310000012345', '27136655', 'Varias fincas', 'Comarca El Regadío', 'Estelí', '[{"cultivo":"Maíz","manzanas":40},{"cultivo":"Sorgo","manzanas":15}]', '[{"tipo":"Vacas","cantidad":60}]', 110, 60000),
    ('Francisco', 'Úbeda', '161-091190-0004C', '87451239', 'Finca La Esperanza', 'Comarca Santa Cruz', 'Condega', '[{"cultivo":"Tomate","manzanas":2}]', '[{"tipo":"Cerdos","cantidad":6}]', 30, 6000)
  ) t(nom, ape, ced, tel, finca, com, mun, cul, gan, dias, lim) loop
    res := public.agro_productor_guardar(null, jsonb_build_object('nombre', r.nom || ' ' || r.ape, 'cedula', r.ced, 'telefono', r.tel,
      'direccion', r.finca || ', ' || r.com || ', ' || r.mun, 'finca', r.finca, 'comunidad', r.com, 'municipio', r.mun,
      'cultivos', r.cul::jsonb, 'ganado', r.gan::jsonb, 'fecha_cosecha', (v_hoy + r.dias)::text, 'limite_credito', r.lim));
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Productor demo: %', res; end if;
  end loop;
  insert into public.clientes(auth_user_id, nombre, apellido, telefono, direccion, ciudad, activo)
  values (u, 'Cliente', 'de mostrador', null, null, 'Estelí', true);

  select array_agg(id order by sku) into prods from public.productos where auth_user_id = u and not coalesce(es_sustancia_controlada, false);
  n := cardinality(prods);

  -- Ventas de contado y fiadas de los últimos 12 días (venta + inventario + lote + Caja o fiado, con la función de ventas)
  for d in reverse 12 .. 1 loop
    ns := 4 + (d % 3);
    for i in 1 .. ns loop
      k := k + 1;
      v_det := '[]'::jsonb; v_stock := '[]'::jsonb; v_sub := 0; v_costo := 0; v_lotes := '[]'::jsonb;
      for j in 1 .. 1 + (k % 2) loop
        select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio, stock_actual into p from public.productos where id = prods[1 + ((k * 3 + j * 5) % n)];
        v_cant := case when p.sku like 'FER%' then 25 + (k % 4) * 25 when p.sku like 'SEM%' then 10 + (k % 3) * 5 else 1 + (k % 2) end;
        continue when v_det @> jsonb_build_array(jsonb_build_object('producto_id', p.id)) or p.stock_actual < v_cant + 2;
        select id into v_lote from public.producto_lotes where auth_user_id = u and producto_id = p.id and activo and cantidad_actual >= v_cant and fecha_vencimiento >= v_hoy
          order by fecha_vencimiento limit 1;
        if exists (select 1 from public.producto_lotes where auth_user_id = u and producto_id = p.id) and v_lote is null then continue; end if;
        v_det := v_det || jsonb_build_array(jsonb_build_object('producto_id', p.id, 'producto_nombre', p.nombre, 'producto_sku', p.sku, 'tipo_item', p.tipo,
          'cantidad', v_cant, 'precio', p.precio, 'costo', p.costo, 'descuento', 0, 'subtotal', round(v_cant * p.precio, 2),
          'ganancia', round(v_cant * (p.precio - p.costo), 2), 'lote_id', v_lote));
        v_stock := v_stock || jsonb_build_array(jsonb_build_object('tipo', 'producto', 'producto_id', p.id, 'cantidad', v_cant));
        if v_lote is not null then v_lotes := v_lotes || jsonb_build_array(jsonb_build_object('lote', v_lote, 'p', p.id, 'c', v_cant)); end if;
        v_sub := v_sub + round(v_cant * p.precio, 2); v_costo := v_costo + v_cant * p.costo;
      end loop;
      continue when jsonb_array_length(v_det) = 0;
      v_num := public.generar_numero_venta(u);
      v_cli_id := null; v_cli_nom := null; v_fiado := null;
      if k % 4 = 0 then
        select c.id, trim(c.nombre || ' ' || coalesce(c.apellido, '')) into v_cli_id, v_cli_nom from public.clientes c
          join public.agro_productores ap on ap.cliente_id = c.id where c.auth_user_id = u order by c.nombre offset (k / 4) % 5 limit 1;
        -- Respeta el límite del productor (si no cabe, se vende de contado)
        if (select coalesce(sum(saldo), 0) from public.fiados where cliente_id = v_cli_id and estado = 'pendiente') + v_sub
           > (select coalesce(nullif(limite_credito, 0), 1e12) from public.clientes where id = v_cli_id) then
          v_cli_id := null; v_cli_nom := null;
        else
        v_fiado := jsonb_build_object('cliente_id', v_cli_id, 'cliente_nombre', v_cli_nom, 'tipo', 'productos', 'descripcion', 'Compra a crédito de cosecha',
          'monto_total', round(v_sub, 2), 'monto_pagado', 0, 'saldo', round(v_sub, 2), 'estado', 'pendiente', 'fecha', v_hoy - d, 'creado_por_nombre', 'Mostrador');
        end if;
      end if;
      select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = case when k % 7 = 0 then 'Transferencia' else 'Efectivo' end;
      res := public.venta_registrar_atomica(
        jsonb_build_object('numero_venta', v_num, 'cliente_id', v_cli_id, 'cliente_nombre', v_cli_nom, 'fecha', v_hoy - d,
          'subtotal', round(v_sub, 2), 'descuento', 0, 'impuesto', 0, 'total', round(v_sub, 2), 'costo_total', round(v_costo, 2),
          'metodo_pago_id', case when v_fiado is null then v_mp.id end, 'metodo_pago_nombre', case when v_fiado is null then v_mp.nombre else 'Fiado' end,
          'creado_por_nombre', 'Mostrador', 'estado', 'completada', 'iva_activo', false, 'iva_porcentaje', 0)
          || case when v_fiado is not null then jsonb_build_object('metodo_pago', 'fiado', 'estado_pago', 'credito', 'categoria', 'fiado') else '{}'::jsonb end,
        v_det, v_stock,
        case when v_fiado is null then jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num, 'monto', round(v_sub, 2), 'metodo_pago_id', v_mp.id,
          'metodo_pago_nombre', v_mp.nombre, 'banco_id', case when v_mp.nombre = 'Transferencia' then bco end,
          'monto_moneda_banco', case when v_mp.nombre = 'Transferencia' then round(v_sub, 2) end, 'fecha', v_hoy - d)) else '[]'::jsonb end,
        case when v_cli_id is not null then round(v_sub, 2) end, v_fiado);
      for v_x in select value from jsonb_array_elements(v_lotes) loop
        perform public.descontar_lote_venta((v_x ->> 'lote')::uuid, (v_x ->> 'p')::uuid, (v_x ->> 'c')::numeric);
      end loop;
    end loop;
  end loop;

  -- Ventas de productos restringidos con la función del panel (cédula, receta, lote, bitácora)
  for i in 1 .. 4 loop
    select c.id, trim(c.nombre || ' ' || coalesce(c.apellido, '')), c.ruc, c.direccion into v_cli_id, v_cli_nom, v_ced, v_dir
      from public.clientes c join public.agro_productores ap on ap.cliente_id = c.id where c.auth_user_id = u order by c.nombre offset i - 1 limit 1;
    select id, precio into p from public.productos where auth_user_id = u and sku = (array['AGQ-001', 'AGQ-002', 'AGQ-003', 'VET-001'])[i];
    res := public.agro_venta_restringida(gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('producto_id', p.id, 'cantidad', case when i = 3 then 4 else 2 end, 'precio', p.precio)),
      jsonb_build_object('nombre', v_cli_nom, 'cedula', v_ced, 'direccion', v_dir, 'uso', (array['Maleza en maíz, 6 mz', 'Limpieza de cafetal', 'Gusano cogollero en frijol', 'Desparasitar ganado'])[i],
        'receta_numero', 'RA-' || lpad((120 + i)::text, 4, '0'), 'receta_profesional', case when i = 4 then 'Dr. Luis Herrera (Méd. Veterinario)' else 'Ing. Ana Talavera (Agrónoma)' end, 'mayor_edad', true),
      case when i = 2 then jsonb_build_object('forma', 'fiado', 'usuario', 'Mostrador')
           else jsonb_build_object('forma', 'contado', 'metodo_pago_id', (select id from public.metodos_pago where auth_user_id = u and nombre = 'Efectivo'), 'metodo_pago_nombre', 'Efectivo', 'usuario', 'Mostrador') end,
      v_cli_id);
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Venta restringida demo: %', res; end if;
  end loop;

  -- Un productor con la cosecha ya pasada y saldo pendiente (para ver el candado y la alerta)
  select c.id into v_cli_id from public.clientes c join public.agro_productores ap on ap.cliente_id = c.id
   where c.auth_user_id = u and exists (select 1 from public.fiados f where f.cliente_id = c.id and f.estado = 'pendiente') and c.nombre like 'Pedro%' limit 1;
  if v_cli_id is null then
    select c.id into v_cli_id from public.clientes c join public.agro_productores ap on ap.cliente_id = c.id
     where c.auth_user_id = u and exists (select 1 from public.fiados f where f.cliente_id = c.id and f.estado = 'pendiente') order by c.nombre limit 1;
  end if;
  update public.agro_productores set fecha_cosecha = v_hoy - 6, updated_at = now() where cliente_id = v_cli_id and auth_user_id = u;
  return u;
end $f$;
revoke all on function public._agroservicio_demo_crear() from public, anon, authenticated;

select public._agroservicio_demo_crear();
