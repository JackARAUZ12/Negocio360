-- =====================================================================
-- FERRETERÍA · reconversión de la cuenta DEMO pública (17-nov-2026)
-- La demo de ferretería tenía un inventario casi todo de farmacia y se llamaba igual que un cliente real
-- ("Ferreteria Trujillo"). Se convierte en "Ferretería El Constructor", con inventario, clientes, ventas,
-- créditos y proformas propios de una ferretería. SOLO toca la cuenta demo 64b4804b-… (tipo demo_publica,
-- rubro ferreteria); se valida antes de borrar. Ninguna cuenta de cliente real se modifica.
-- Las ventas y créditos se crean con las funciones del sistema (venta_registrar_atomica, mf_credito_crear,
-- mf_cobrar, comision_generar), así caja, stock y reportes cuadran.
-- =====================================================================
create or replace function public._ferreteria_demo_reconvertir() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := '64b4804b-7b2b-44d8-a365-bc04ec5950ec';
  t text; bco uuid; prov1 uuid; prov2 uuid; r record; p record; v_pid uuid; k integer := 0; d integer; i integer; j integer; ns integer; ni integer;
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; prods uuid[]; n integer; v_mp record; v_num text; v_det jsonb; v_stock jsonb; v_sub numeric; v_costo numeric; v_cant numeric;
  v_esc record; v_pr numeric; res jsonb; vends uuid[]; vnoms text[]; v_vend integer; v_cli_id uuid; v_cli_nom text; v_items jsonb; v_prof uuid; v_tot numeric; v_cos numeric;
  tablas_borrar text[] := array[
    'asientos_detalle','asientos_contables','creditos_historial','creditos_cuotas','creditos_pagos','creditos',
    'venta_detalles','ventas_fecha_respaldo','ventas_numeros_reservados','movimientos_impuestos','ventas',
    'detalle_compras','compras','cuentas_por_pagar_pagos','cuentas_por_pagar_cuotas','cuentas_por_pagar',
    'gastos','historial_gastos','gastos_programados','cierres_caja','caja_chica_sesiones','capital_negocio',
    'movimientos_financieros','movimientos_inventario','dashboard_alertas','proforma_detalles','proformas','garantias_clientes',
    'producto_lotes','precios_escala','producto_presentaciones','codigos_barras','orden_produccion_consumos','ordenes_produccion',
    'receta_componentes','recetas_produccion','ruta_clientes','rutas','delivery_pedidos','encuestas_respuestas','agenda_eventos',
    'mensajes_chat','conversaciones_chat','productos','clientes','proveedores'];
begin
  if not exists (select 1 from public.cuentas_prueba where auth_user_id = u and tipo = 'demo_publica' and rubro = 'ferreteria') then
    raise exception 'La cuenta no es la demo pública de ferretería: no se hace nada.';
  end if;

  -- 1) Limpiar los datos de la demo (farmacia + movimientos viejos)
  foreach t in array tablas_borrar loop
    execute format('delete from public.%I where auth_user_id = %L', t, u);
  end loop;
  update public.ventas_numeracion set ultimo_numero = 0 where auth_user_id = u;
  update public.creditos_numeracion set ultimo_numero = 0 where auth_user_id = u;
  update public.proformas_numeracion set ultimo_numero = 0 where auth_user_id = u;
  update public.asientos_numeracion set ultimo_numero = 0 where auth_user_id = u;
  update public.cuentas_por_pagar_numeracion set ultimo_numero = 0 where auth_user_id = u;
  update public.codigos_barras_numeracion set ultimo_numero = 0 where auth_user_id = u;

  -- 2) Identidad del negocio (nombre genérico, sin parecido a un cliente real)
  update public.cuentas_prueba set etiqueta = 'Demo Ferretería El Constructor',
         nota = 'Demo de ferretería: materiales de construcción, hierro, plomería, eléctrico, pintura y herramientas. Venta por metro, libra y galón, precios por mayor para contratistas, créditos a obras, proformas de obra y 2 vendedores con comisión.'
   where auth_user_id = u;
  update public.usuarios set nombre = 'Demo', apellido = 'El Constructor', nombre_negocio = 'Ferretería El Constructor' where auth_user_id = u;
  update public.configuracion_empresa set nombre_comercial = 'Ferretería El Constructor', direccion = 'Carretera a Masaya km 9.5, Managua', ciudad = 'Managua',
         telefono = '2279-4400', whatsapp = '88774400', usa_vendedores = true, usa_modulo_comisiones = true, control_inventario = true, alerta_stock_bajo = true
   where auth_user_id = u;
  update public.catalogos set nombre = 'Ferretería El Constructor' where auth_user_id = u;

  -- Todo lo que sigue se registra como lo haría la persona que usa la demo (auth.uid() = la demo)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select id into bco from public.bancos where auth_user_id = u order by created_at limit 1;
  insert into public.proveedores(auth_user_id, nombre, telefono, email, direccion, activo) values
    (u, 'Distribuidora de Materiales Centroamericana', '2250-3030', 'pedidos@materialescentro.example', 'Zona Industrial, Managua', true),
    (u, 'Importadora de Herramientas del Norte', '2713-5050', 'ventas@herramientasnorte.example', 'Carretera Panamericana, Estelí', true);
  select id into prov1 from public.proveedores where auth_user_id = u and nombre like 'Distribuidora%';
  select id into prov2 from public.proveedores where auth_user_id = u and nombre like 'Importadora%';

  -- 3) Inventario: nombre, categoría, sku, unidad, costo, precio, stock, mínimo, proveedor (1/2)
  for r in select * from (values
    ('Cemento Canal 42.5 kg', 'Construcción', 'CON-001', 'saco', 330, 385, 320, 60, 1),
    ('Bloque de concreto 6"', 'Construcción', 'CON-002', 'unidad', 17, 22, 1500, 300, 1),
    ('Cal hidratada 25 lb', 'Construcción', 'CON-003', 'bolsa', 95, 125, 90, 20, 1),
    ('Alambre de amarre', 'Construcción', 'CON-004', 'libra', 22, 30, 400, 80, 1),
    ('Varilla corrugada 3/8" x 6 m', 'Hierro y acero', 'HIE-001', 'unidad', 95, 125, 400, 80, 1),
    ('Varilla corrugada 1/2" x 6 m', 'Hierro y acero', 'HIE-002', 'unidad', 165, 210, 250, 50, 1),
    ('Varilla lisa 1/4" x 6 m', 'Hierro y acero', 'HIE-003', 'unidad', 45, 62, 300, 60, 1),
    ('Ángulo 1" x 1/8" x 6 m', 'Hierro y acero', 'HIE-004', 'unidad', 480, 620, 60, 15, 1),
    ('Tubo cuadrado 1" x 6 m', 'Hierro y acero', 'HIE-005', 'unidad', 520, 680, 45, 12, 1),
    ('Lámina de zinc ondulada 8 pies', 'Techos', 'TEC-001', 'unidad', 270, 345, 180, 40, 1),
    ('Clavo de techo con arandela', 'Fijación', 'FIJ-001', 'libra', 36, 50, 250, 50, 1),
    ('Clavo corriente 2"', 'Fijación', 'FIJ-002', 'libra', 20, 28, 500, 100, 1),
    ('Clavo corriente 3"', 'Fijación', 'FIJ-003', 'libra', 20, 28, 450, 100, 1),
    ('Tornillo para tablayeso 1" (caja 100)', 'Fijación', 'FIJ-004', 'caja', 95, 135, 60, 15, 2),
    ('Perno 3/8" x 3" con tuerca', 'Fijación', 'FIJ-005', 'unidad', 6, 9, 600, 100, 2),
    ('Tubo PVC 1/2" x 6 m', 'Plomería', 'PLO-001', 'unidad', 78, 105, 200, 40, 1),
    ('Tubo PVC 2" drenaje x 6 m', 'Plomería', 'PLO-002', 'unidad', 195, 260, 70, 15, 1),
    ('Codo PVC 1/2" 90°', 'Plomería', 'PLO-003', 'unidad', 3, 6, 600, 100, 1),
    ('Pegamento PVC 1/4 galón', 'Plomería', 'PLO-004', 'unidad', 145, 195, 40, 10, 1),
    ('Cinta teflón', 'Plomería', 'PLO-005', 'unidad', 6, 10, 300, 60, 2),
    ('Llave de chorro 1/2"', 'Plomería', 'PLO-006', 'unidad', 85, 125, 80, 15, 2),
    ('Cable THHN #12', 'Eléctrico', 'ELE-001', 'metro', 11, 16, 900, 200, 1),
    ('Cable THHN #14', 'Eléctrico', 'ELE-002', 'metro', 7.5, 11, 1100, 250, 1),
    ('Tomacorriente doble', 'Eléctrico', 'ELE-003', 'unidad', 38, 58, 120, 25, 2),
    ('Interruptor sencillo', 'Eléctrico', 'ELE-004', 'unidad', 28, 45, 110, 25, 2),
    ('Breaker 1 polo 20 A', 'Eléctrico', 'ELE-005', 'unidad', 120, 175, 40, 10, 2),
    ('Cinta aislante', 'Eléctrico', 'ELE-006', 'unidad', 22, 35, 8, 30, 2),
    ('Foco LED 9 W', 'Eléctrico', 'ELE-007', 'unidad', 30, 48, 150, 30, 2),
    ('Tubo conduit PVC 1/2" x 3 m', 'Eléctrico', 'ELE-008', 'unidad', 38, 58, 140, 30, 1),
    ('Pintura látex blanco', 'Pintura', 'PIN-001', 'galon', 650, 820, 70, 15, 1),
    ('Pintura anticorrosiva gris', 'Pintura', 'PIN-002', 'galon', 610, 790, 40, 10, 1),
    ('Thinner', 'Pintura', 'PIN-003', 'galon', 280, 370, 35, 10, 1),
    ('Brocha 3"', 'Pintura', 'PIN-004', 'unidad', 40, 65, 70, 15, 2),
    ('Rodillo 9" con bandeja', 'Pintura', 'PIN-005', 'unidad', 95, 140, 45, 10, 2),
    ('Lija de agua', 'Pintura', 'PIN-006', 'unidad', 6, 10, 400, 80, 2),
    ('Martillo de uña 16 oz', 'Herramientas', 'HER-001', 'unidad', 140, 210, 40, 8, 2),
    ('Alicate universal 8"', 'Herramientas', 'HER-002', 'unidad', 120, 185, 35, 8, 2),
    ('Juego de destornilladores 6 pzs', 'Herramientas', 'HER-003', 'unidad', 150, 230, 30, 6, 2),
    ('Cinta métrica 5 m', 'Herramientas', 'HER-004', 'unidad', 70, 110, 60, 12, 2),
    ('Nivel de burbuja 24"', 'Herramientas', 'HER-005', 'unidad', 130, 195, 25, 5, 2),
    ('Serrucho 20"', 'Herramientas', 'HER-006', 'unidad', 150, 225, 25, 5, 2),
    ('Pala redonda con mango', 'Herramientas', 'HER-007', 'unidad', 220, 320, 30, 6, 2),
    ('Carretilla de construcción', 'Herramientas', 'HER-008', 'unidad', 2400, 3100, 8, 3, 2),
    ('Taladro percutor 1/2" 700 W', 'Herramientas', 'HER-009', 'unidad', 1650, 2300, 3, 4, 2),
    ('Disco de corte 4 1/2"', 'Herramientas', 'HER-010', 'unidad', 28, 45, 200, 40, 2),
    ('Candado 40 mm', 'Cerrajería', 'CER-001', 'unidad', 110, 170, 50, 10, 2),
    ('Cerradura de pomo', 'Cerrajería', 'CER-002', 'unidad', 340, 480, 25, 6, 2),
    ('Bisagra 3" (par)', 'Cerrajería', 'CER-003', 'par', 40, 65, 120, 25, 2)
  ) t(nombre, cat, sku, uni, costo, precio, stock, minimo, pv) loop
    insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, unidad_codigo, permite_fraccion, costo, precio, stock_actual, stock_minimo, activo, proveedor_id, proveedor_nombre,
                                 garantia_meses)
    values (u, 'producto', r.nombre, r.cat, r.sku, r.uni, r.uni in ('libra', 'metro', 'galon'), r.costo, r.precio, r.stock, r.minimo, true,
            case r.pv when 1 then prov1 else prov2 end, case r.pv when 1 then 'Distribuidora de Materiales Centroamericana' else 'Importadora de Herramientas del Norte' end,
            case when r.sku in ('HER-009') then 12 when r.sku in ('HER-008') then 3 else null end);
  end loop;
  insert into public.productos(auth_user_id, tipo, nombre, categoria, sku, precio, activo)
  values (u, 'servicio', 'Flete a obra (Managua)', 'Servicios', 'SRV-001', 350, true),
         (u, 'servicio', 'Corte de varilla / tubo', 'Servicios', 'SRV-002', 25, true);

  -- Precios por mayor (escala): nombre, cantidad mínima, precio
  insert into public.precios_escala(auth_user_id, producto_id, nombre, precio, cantidad_minima, orden)
  select u, pr.id, e.nom, e.precio, e.minimo, 1 from public.productos pr
  join (values ('CON-001', 'Mayoreo (10+ sacos)', 10, 375), ('CON-002', 'Mayoreo (100+)', 100, 20), ('HIE-001', 'Contratista (20+)', 20, 118),
               ('HIE-002', 'Contratista (20+)', 20, 198), ('TEC-001', 'Contratista (20+)', 20, 325), ('FIJ-002', 'Mayoreo (25 lb)', 25, 25),
               ('FIJ-003', 'Mayoreo (25 lb)', 25, 25), ('ELE-001', 'Mayoreo (50+ m)', 50, 14), ('ELE-002', 'Mayoreo (50+ m)', 50, 9.5),
               ('PIN-001', 'Mayoreo (4+ galones)', 4, 780), ('PLO-001', 'Mayoreo (10+)', 10, 98)) e(sku, nom, minimo, precio) on e.sku = pr.sku
   where pr.auth_user_id = u;
  -- Presentaciones: el cable se vende por metro o rollo; la pintura por galón, cuarto o cubeta
  insert into public.producto_presentaciones(auth_user_id, producto_id, nombre, factor, precio, orden, activo)
  select u, pr.id, e.nom, e.factor, e.precio, e.orden, true from public.productos pr
  join (values ('ELE-001', 'Rollo 100 m', 100, 1450, 1), ('ELE-002', 'Rollo 100 m', 100, 950, 1), ('PIN-001', 'Cubeta 5 galones', 5, 3900, 1),
               ('PIN-001', 'Cuarto de galón', 0.25, 235, 2), ('PIN-002', 'Cuarto de galón', 0.25, 225, 1), ('FIJ-002', 'Caja 25 lb', 25, 650, 1),
               ('FIJ-003', 'Caja 25 lb', 25, 650, 1)) e(sku, nom, factor, precio, orden) on e.sku = pr.sku
   where pr.auth_user_id = u;

  -- 4) Vendedores con comisión del 2 %
  for r in select * from (values ('Rosa Gutiérrez · Mostrador', '88301122', 1), ('Mauricio Téllez · Ventas a obras', '88403344', 2)) t(n, tel, o) order by o loop
    insert into public.vendedores(auth_user_id, nombre, telefono, activo) values (u, r.n, r.tel, true) returning id into v_pid;
    vends := array_append(vends, v_pid); vnoms := array_append(vnoms, r.n::text);
    insert into public.comision_beneficiarios(auth_user_id, nombre, vendedor_nombre, base, valor, fecha_inicio, telefono, notas)
    values (u, split_part(r.n, ' · ', 1), r.n, 'venta', 2, v_hoy - 30, r.tel, 'Comisión 2% sobre lo vendido');
  end loop;

  -- 5) Clientes: contratistas, maestros de obra y público
  insert into public.clientes(auth_user_id, nombre, apellido, telefono, direccion, ciudad, activo) values
    (u, 'Constructora', 'Los Álamos S.A.', '22554010', 'Residencial Los Álamos, Managua', 'Managua', true),
    (u, 'Juan Carlos', 'Medina (maestro de obra)', '88112233', 'Barrio Camilo Ortega', 'Managua', true),
    (u, 'Carpintería', 'Hermanos Silva', '87223344', 'Ciudad Sandino, zona 4', 'Ciudad Sandino', true),
    (u, 'Familia', 'Rivas (remodelación)', '86334455', 'Reparto Schick, Managua', 'Managua', true),
    (u, 'Taller de soldadura', 'El Chele', '85445566', 'Carretera a Masaya km 11', 'Managua', true),
    (u, 'Ing. Marvin', 'Calero', '84556677', 'Altamira D''Este, Managua', 'Managua', true),
    (u, 'Doña Lidia', 'Sequeira', '88667788', 'Barrio Larreynaga, Managua', 'Managua', true),
    (u, 'Residencial', 'Villa Hermosa (obra)', '87778899', 'Villa Hermosa, Tipitapa', 'Tipitapa', true),
    (u, 'Electricista', 'Don Fermín Ruiz', '86889900', 'Barrio Monseñor Lezcano', 'Managua', true),
    (u, 'Fontanero', 'Octavio Lanzas', '85990011', 'Ciudad Jardín, Managua', 'Managua', true);
  select array_agg(id order by apellido) into clis from public.clientes where auth_user_id = u;
  select array_agg(id order by sku) into prods from public.productos where auth_user_id = u and tipo = 'producto';
  n := cardinality(prods);

  -- 6) 21 días de ventas (mostrador y obras), con el precio de escala que corresponda
  for d in reverse 20 .. 0 loop
    continue when extract(dow from v_hoy - d) = 0;
    ns := case when d = 0 then 3 else 4 + (d % 4) end;
    for i in 1 .. ns loop
      k := k + 1;
      v_vend := 1 + (k % 2);
      select * into v_mp from public.metodos_pago where auth_user_id = u and nombre = case when k % 4 = 0 then 'Transferencia' when k % 5 = 0 then 'Tarjeta' else 'Efectivo' end;
      if k % 3 = 0 then
        select id, nombre || ' ' || apellido as nom into r from public.clientes where id = clis[1 + (k % 10)];
        v_cli_id := r.id; v_cli_nom := r.nom;
      else
        v_cli_id := null; v_cli_nom := 'Cliente de mostrador';
      end if;
      v_det := '[]'::jsonb; v_stock := '[]'::jsonb; v_sub := 0; v_costo := 0;
      ni := 1 + (k % 4);
      for j in 1 .. ni loop
        select id, nombre, sku, tipo, coalesce(costo, 0) as costo, precio, stock_actual, permite_fraccion into p from public.productos
         where auth_user_id = u and tipo = 'producto' order by sku offset ((k * 7 + j * 5) % n) limit 1;
        v_cant := case when p.costo >= 1000 then 1
                       when p.permite_fraccion then (case (k + j) % 4 when 0 then 2.5 when 1 then 12 when 2 then 30 else 60 end)
                       else (case (k + j) % 6 when 0 then 1 when 1 then 2 when 2 then 4 when 3 then 10 when 4 then 25 else 3 end) end;
        if v_cli_id is null and v_cant > 12 then v_cant := 3; end if;
        select id, nombre, precio into v_esc from public.precios_escala where producto_id = p.id and cantidad_minima <= v_cant order by cantidad_minima desc limit 1;
        v_pr := coalesce(v_esc.precio, p.precio);
        if p.stock_actual < v_cant + coalesce((select sum((x ->> 'cantidad')::numeric) from jsonb_array_elements(v_stock) x where (x ->> 'producto_id')::uuid = p.id), 0) then continue; end if;
        if exists (select 1 from jsonb_array_elements(v_det) x where (x ->> 'producto_id')::uuid = p.id) then continue; end if;
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

  -- 7) Créditos a contratistas (2 pagos quincenales, sin recargo). El panel Microfinanciera se enciende solo mientras se crean.
  perform set_config('n360.mf_ok', '1', true);
  update public.configuracion_empresa set usa_modulo_microfinanciera = true where auth_user_id = u;
  perform set_config('n360.mf_ok', '', true);
  for r in select * from (values (1, -14, true, 'CON-001', 30, 'HIE-001', 40), (8, -8, false, 'CON-002', 400, 'CON-001', 20), (3, -3, false, 'PIN-001', 6, 'PIN-003', 3), (2, 4, false, 'TEC-001', 25, 'FIJ-001', 20)) t(cli, ini, abona, sku1, c1, sku2, c2) loop
    k := k + 1;
    select jsonb_agg(jsonb_build_object('producto_id', x.id, 'cantidad', x.c,
             'precio', coalesce((select pe.precio from public.precios_escala pe where pe.producto_id = x.id and pe.cantidad_minima <= x.c order by pe.cantidad_minima desc limit 1), x.precio)))
      into v_items from (select pr.id, pr.precio, case when pr.sku = r.sku1 then r.c1 else r.c2 end as c from public.productos pr where pr.auth_user_id = u and pr.sku in (r.sku1, r.sku2)) x;
    res := public.mf_credito_crear(jsonb_build_object('tipo', 'productos', 'cliente_id', clis[r.cli], 'items', v_items, 'recargo_pct', 0,
      'frecuencia', 'quincenal', 'num_cuotas', 2, 'primera_fecha', v_hoy + r.ini, 'dias_cobro', 'lun_sab', 'ref', 'demo-fer-cr-' || k,
      'creado_por', vnoms[2], 'nota', 'Crédito a contratista, 30 días'));
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Crédito demo no se creó: %', res; end if;
    if r.abona then
      select monto_total into v_pr from public.creditos_cuotas where credito_id = (res ->> 'credito_id')::uuid order by numero limit 1;
      res := public.mf_cobrar(jsonb_build_object('credito_id', (res ->> 'credito_id')::uuid, 'monto', v_pr, 'metodo_pago_nombre', 'Efectivo', 'ref', 'demo-fer-ab-' || k, 'creado_por', 'Caja'));
      if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Abono demo no se registró: %', res; end if;
    end if;
  end loop;
  perform set_config('n360.mf_ok', '1', true);
  update public.configuracion_empresa set usa_modulo_microfinanciera = false where auth_user_id = u;
  perform set_config('n360.mf_ok', '', true);

  -- 8) Comisiones de las ventas (quedan "por pagar" a cada vendedor)
  res := public.comision_generar(v_hoy - 30, v_hoy);

  -- 9) Proformas de obra (cotizaciones con vencimiento a 15 días)
  for r in select * from (values
    (1, 8, 'Obra Villa Hermosa · casa modelo', 'enviada'),
    (2, 4, 'Remodelación de baño y pintura', 'pendiente'),
    (3, 5, 'Instalación eléctrica de taller', 'pendiente'),
    (4, 1, 'Techo de bodega · lámina y clavos', 'borrador')) t(num, cli, obs, est) loop
    select id, nombre || ' ' || apellido as nom into p from public.clientes where id = clis[r.cli];
    insert into public.proformas(auth_user_id, numero_proforma, cliente_id, cliente_nombre, fecha, fecha_vencimiento, subtotal, descuento, impuesto, iva_activo, iva_porcentaje, total, costo_total,
                                 estado, observaciones, usuario_nombre)
    values (u, 'PR-' || lpad(r.num::text, 6, '0'), p.id, p.nom, v_hoy - r.num, v_hoy + 15 - r.num, 0, 0, 0, false, 0, 0, 0, r.est, r.obs, vnoms[2]) returning id into v_prof;
    insert into public.proforma_detalles(auth_user_id, proforma_id, producto_id, producto_nombre, producto_sku, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia)
    select u, v_prof, pr.id, pr.nombre, pr.sku, 'producto', e.cant, coalesce(pe.precio, pr.precio), coalesce(pr.costo, 0), 0,
           round(e.cant * coalesce(pe.precio, pr.precio), 2), round(e.cant * (coalesce(pe.precio, pr.precio) - coalesce(pr.costo, 0)), 2)
      from (values
        (1, 'CON-001', 80), (1, 'CON-002', 800), (1, 'HIE-001', 120), (1, 'HIE-003', 90), (1, 'FIJ-002', 40),
        (2, 'PLO-001', 12), (2, 'PLO-003', 30), (2, 'PLO-006', 4), (2, 'PLO-004', 2), (2, 'PIN-001', 6), (2, 'PIN-004', 4), (2, 'PIN-006', 10),
        (3, 'ELE-001', 150), (3, 'ELE-002', 200), (3, 'ELE-003', 12), (3, 'ELE-004', 10), (3, 'ELE-005', 6), (3, 'ELE-008', 20),
        (4, 'TEC-001', 40), (4, 'FIJ-001', 30), (4, 'HIE-004', 8)) e(num, sku, cant)
      join public.productos pr on pr.auth_user_id = u and pr.sku = e.sku
      left join lateral (select s.precio from public.precios_escala s where s.producto_id = pr.id and s.cantidad_minima <= e.cant order by s.cantidad_minima desc limit 1) pe on true
     where e.num = r.num;
    select coalesce(sum(subtotal), 0), coalesce(sum(cantidad * costo), 0) into v_tot, v_cos from public.proforma_detalles where proforma_id = v_prof;
    update public.proformas set subtotal = v_tot, total = v_tot, costo_total = v_cos where id = v_prof;
  end loop;
  insert into public.proformas_numeracion(auth_user_id, ultimo_numero) values (u, 4)
  on conflict (auth_user_id) do update set ultimo_numero = 4;

  return u;
end $f$;
revoke all on function public._ferreteria_demo_reconvertir() from public, anon, authenticated;

select public._ferreteria_demo_reconvertir();

drop function public._ferreteria_demo_reconvertir();
