/* Supabase simulado SOLO para grabar el tutorial: devuelve datos de demostración. */
(function () {
  const UID = 'demo-user-0001';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const now = new Date();

  const PRODUCTOS = [
    ['Aceite Clover 1L', 78], ['Arroz Faisán 1 qq', 2650], ['Azúcar Montelimar fardo', 1150], ['Frijol rojo 1 qq', 3100],
    ['Café Presto 200g', 145], ['Harina Maseca 1kg', 42], ['Jabón Xedex 1kg', 68], ['Gaseosa Rojita 3L', 65],
    ['Leche Parmalat caja 12', 420], ['Pasta Roma 400g', 28], ['Sardina Pacífico', 38], ['Papel higiénico 12 rollos', 165],
  ];
  // ---- ventas (últimos 75 días)
  const ventas = [], detalles = [];
  let vid = 1;
  for (let i = 74; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const base = 8 + Math.round(rnd() * 5) + (d.getDay() === 6 ? 4 : 0) + Math.round((74 - i) / 8) + (i < 7 ? Math.round((7 - i) * 1.6) : 0);
    const nVentas = i === 0 ? 22 : base;
    for (let k = 0; k < nVentas; k++) {
      const h = 7 + Math.floor(rnd() * 11), m = Math.floor(rnd() * 60);
      const hh = i === 0 ? 7 + Math.floor(rnd() * 3) : h;
      let total = 0; const items = [];
      const nItems = 1 + Math.floor(rnd() * 2);
      for (let j = 0; j < nItems; j++) {
        const pi = Math.floor(Math.pow(rnd(), 1.6) * PRODUCTOS.length);
        const [nombre, precio] = PRODUCTOS[pi];
        const cant = precio > 1000 ? 1 : 1 + Math.floor(rnd() * 5);
        const sub = cant * precio; total += sub;
        items.push({ venta_id: vid, auth_user_id: UID, producto_nombre: nombre, cantidad: cant, subtotal: sub, tipo_item: 'producto' });
      }
      if (rnd() < .3) { const sv = rnd() < .5 ? ['Flete', 1800] : ['Entrega a domicilio', 350]; items.push({ venta_id: vid, auth_user_id: UID, producto_nombre: sv[0], cantidad: 1, subtotal: sv[1], tipo_item: 'servicio' }); total += sv[1]; }
      const impuesto = Math.round(total * 0.15 * (rnd() < .5 ? 1 : 0) * 100) / 100;
      ventas.push({ id: vid, auth_user_id: UID, fecha: `${ymd(d)}T${pad(hh)}:${pad(m)}:00`, total: total + impuesto, impuesto,
        costo_total: Math.round(total * (0.66 + rnd() * 0.08)), estado: 'completada',
        estado_pago: (i < 20 && rnd() < .02) ? 'pendiente' : 'pagado', creado_por_nombre: 'Admin' });
      detalles.push(...items); vid++;
    }
  }
  // Tendencia suave al alza en los últimos 7 días (para que la gráfica se vea clara en el tutorial)
  const TARGET = [16800, 18100, 17600, 19300, 20400, 21900, 23650];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); const day = ymd(d);
    const vs = ventas.filter(v => v.fecha.startsWith(day)); const sum = vs.reduce((s, v) => s + v.total, 0);
    const k = TARGET[6 - i] / sum;
    vs.forEach(v => { v.total = Math.round(v.total * k); v.impuesto = Math.round(v.impuesto * k * 100) / 100; v.costo_total = Math.round(v.costo_total * k);
      detalles.filter(x => x.venta_id === v.id).forEach(x => x.subtotal = Math.round(x.subtotal * k)); });
  }
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const productos = [];
  const CATS = ['Abarrotes', 'Granos', 'Abarrotes', 'Granos', 'Bebidas', 'Abarrotes', 'Limpieza', 'Bebidas', 'Lácteos', 'Abarrotes', 'Enlatados', 'Higiene'];
  PRODUCTOS.forEach(([n, pr], i) => productos.push({ id: i + 1, auth_user_id: UID, nombre: n, sku: 'DT-' + (1001 + i), categoria: CATS[i], precio: pr, costo: Math.round(pr * .72), tipo_precio: 'fijo', activo: true, unidad_medida: 'unidad', created_at: '2026-0' + (1 + i % 9) + '-10T10:00:00', tipo: 'producto', stock_actual: [4, 120, 85, 3, 240, 310, 160, 2, 95, 400, 5, 130][i], stock_minimo: [10, 20, 15, 10, 30, 40, 20, 12, 15, 50, 12, 20][i] }));
  for (let i = 0; i < 26; i++) productos.push({ id: 100 + i, auth_user_id: UID, nombre: ['Galletas Pozuelo','Atún Sardimar','Salsa de tomate','Detergente Ace','Cloro Magia Blanca','Mantequilla','Huevos cartón 30','Queso seco lb','Pan molde','Café molido 400g','Avena Quaker','Margarina','Fideos Maggi','Sopa Knorr','Leche en polvo','Jugo Del Valle','Agua 600ml','Refresco 12oz','Toallas cocina','Desinfectante','Shampoo','Pasta dental','Jabón tocador','Cereal','Chocolate','Harina trigo'][i], sku: 'DT-' + (2001 + i), categoria: 'Abarrotes', precio: 25 + Math.floor(rnd() * 200), costo: 0, tipo_precio: 'fijo', activo: true, unidad_medida: 'unidad', created_at: '2026-01-01T00:00:00', tipo: 'producto', stock_actual: 40 + Math.floor(rnd() * 300), stock_minimo: 10 });
  ['Entrega a domicilio', 'Instalación', 'Flete'].forEach((n, i) => productos.push({ id: 200 + i, auth_user_id: UID, nombre: n, tipo: 'servicio', activo: true, precio: [350, 500, 1800][i], created_at: '2026-01-01T00:00:00' }));
  const BIZ = ['Pulpería Doña Rosa', 'Abarrotes El Sol', 'Mini Súper Jireh', 'Tienda Don Carlos', 'Pulpería La Bendición', 'Comedor Mary', 'Ferretería Ruiz', 'Farmacia Central', 'Distribuidora Masaya', 'Panadería Lupita', 'Cafetería El Buen Sabor', 'Taller Hermanos López', 'Hotel Las Brisas', 'Restaurante La Terraza', 'Librería Escolar', 'Bodega San Judas', 'Súper Express León', 'Pulpería El Carmen', 'Abarrotería Ortiz', 'Tienda La Económica'];
  const FN = ['María', 'José', 'Ana', 'Luis', 'Carmen', 'Jorge', 'Rosa', 'Pedro', 'Martha', 'Juan', 'Elena', 'Carlos'], LN = ['López', 'Martínez', 'García', 'Rodríguez', 'Pérez', 'Hernández', 'Gutiérrez', 'Castillo', 'Rivas', 'Mendoza', 'Ortega', 'Sánchez'];
  const ymd0 = k => { const d = new Date(now); d.setDate(d.getDate() - k); return ymd(d); };
  const clientes = Array.from({ length: 148 }, (_, i) => { const nombre = i < BIZ.length ? BIZ[i] : FN[i % 12] + ' ' + LN[Math.floor(i / 12) % 12];
    const nc = i < 20 ? 6 + ((i * 7) % 18) : 1 + ((i * 5) % 9); const ago = i % 9 === 4 ? 35 + (i % 70) : (i * 3) % 25;
    return { id: i + 1, auth_user_id: UID, nombre, telefono: '8' + String(2200000 + i * 4129).slice(0, 7), correo: i < 20 ? nombre.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/ /g, '') + '@gmail.com' : null,
      empresa: i < 20 ? nombre : null, activo: true, tipo_cliente: 'normal', estado: nc >= 5 ? 'frecuente' : 'activo', num_compras: nc, total_compras: Math.round(nc * (900 + (i * 37) % 2600)),
      ultima_compra: ymd0(ago), primera_compra: ymd0(i >= 140 ? 2 + i % 7 : 120 + i), created_at: ymd0(i >= 140 ? 2 + i % 7 : 130 + i) + 'T10:00:00', ...(i >= 140 ? { estado: 'nuevo', num_compras: 1 } : {}) }; });
  Object.assign(clientes[3], { empresa: 'Mini Súper Jireh', correo: 'compras@minisuperjireh.com', ruc: 'J0310000123456', direccion: 'Barrio San José, de la iglesia 2 c. al sur, Managua', direccion_factura: 'Km 7 Carretera Norte, Bodega 3', fecha_aniversario: '2019-03-15', observaciones: 'Prefiere entregas por la mañana.', contactos: [{ nombre: 'Rosa Pérez', cargo: 'Dueña', contacto: '8888-1234' }, { nombre: 'Luis Pérez', cargo: 'Compras', contacto: '8777-5678' }] });
  const gastos = [['Salarios', 32000], ['Combustible', 9800], ['Energía', 4200], ['Alquiler', 12000], ['Internet', 1200]]
    .map(([c, m], i) => ({ id: i, auth_user_id: UID, concepto: c, categoria: c, monto: Math.round(m * .45), fecha: monthStart, estado: 'activo', tipo: 'operativo' }));
  const d20 = new Date(now); d20.setDate(d20.getDate() + 18);

  const PROV = ['Distribuidora La Fe', 'Molinos de Nicaragua', 'Lácteos Centroamericanos', 'Café Soluble S.A.', 'Productos de Limpieza Xedex', 'Comercial El Granero'];
  const proveedores = PROV.map((n, i) => ({ id: 'pv' + (i + 1), auth_user_id: UID, nombre: n, activo: i !== 5, telefono: '8' + (1234567 + i * 1111), email: ['ventas@lafe.com.ni', 'pedidos@molinosnic.com', 'ventas@lacteosca.com', 'distribucion@cafesoluble.com.ni', 'ventas@xedex.com.ni', 'elgranero@gmail.com'][i], direccion: ['Managua, Carretera Norte km 6', 'Managua, Pista Suburbana', 'Matagalpa', 'Managua, Km 9 Carretera a Masaya', 'Managua, Zona Franca Las Mercedes', 'Masaya'][i], contacto: ['Luis', 'Ana', 'Pedro', 'María', 'José', 'Mario'][i], created_at: '2026-01-0' + (i + 1) + 'T00:00:00' }));
  const ymdB = k => { const d = new Date(now); d.setDate(d.getDate() - k); return ymd(d); };
  // [diasAtrás, proveedor, estado, método, [[productoId, cantidad, costo], ...], directa]
  const CMP = [[0, 0, 'completada', 'Efectivo', [[1, 48, 56], [10, 120, 20]]], [0, 3, 'completada', 'Transferencia', [[5, 60, 104]]],
    [1, 1, 'completada', 'Transferencia', [[2, 8, 1908], [6, 100, 30]]], [2, 2, 'pendiente', 'Transferencia', [[9, 20, 302]]],
    [3, 4, 'completada', 'Efectivo', [[7, 80, 49], [12, 30, 119]]], [4, 0, 'completada', 'Tarjeta', [[11, 144, 27], [8, 48, 47]]],
    [5, 1, 'anulada', 'Efectivo', [[4, 2, 2232]]], [6, 0, 'completada', 'Efectivo', [], 'Reparación de estantería de bodega', 3500],
    [7, 2, 'completada', 'Transferencia', [[9, 15, 302]]], [8, 4, 'completada', 'Efectivo', [[7, 60, 49]]], [9, 1, 'completada', 'Transferencia', [[3, 6, 828], [2, 4, 1908]]],
    [12, 0, 'completada', 'Efectivo', [[1, 36, 56]]], [16, 3, 'completada', 'Transferencia', [[5, 48, 104]]], [21, 2, 'completada', 'Tarjeta', [[9, 24, 302]]], [27, 1, 'completada', 'Transferencia', [[2, 10, 1908]]]];
  const detalle_compras = [];
  const compras = CMP.map(([k, pv, estado, mp, items, concepto, montoDir], i) => {
    const id = 'cmp' + (i + 1); let sub = 0;
    items.forEach(([pid, q, c], j) => { const P = PRODUCTOS[pid - 1]; sub += q * c; detalle_compras.push({ id: id + '-' + j, auth_user_id: UID, compra_id: id, producto_id: pid, producto_nombre: P[0], producto_sku: 'DT-' + (1000 + pid), cantidad: q, costo_unitario: c, descuento: 0, iva_porcentaje: 0, subtotal: q * c }); });
    if (montoDir) sub = montoDir;
    return { id, auth_user_id: UID, numero: 'C-' + String(240 - i).padStart(5, '0'), fecha: ymdB(k), created_at: ymdB(k) + 'T' + pad(15 - (i % 7)) + ':15:00', proveedor_id: proveedores[pv].id, proveedor_nombre: PROV[pv], subtotal: sub, descuento_total: 0, iva_monto: 0, iva_porcentaje: 0, total: sub, estado, metodo_pago_nombre: mp, usuario_nombre: 'Carlos Torres', es_directa: !!montoDir, concepto: concepto || null };
  });
  proveedores.forEach(p => { const cs = compras.filter(c => c.proveedor_id === p.id && c.estado !== 'anulada'); p.ultima_compra = cs.length ? cs[0].fecha : (p.id === 'pv6' ? '2026-05-14' : null); p.monto_acumulado = cs.reduce((s, c) => s + c.total, 0) + [212400, 386900, 148300, 96750, 74200, 18600][+p.id.slice(2) - 1]; });
  const OC = [['oc1', 'OC-0012', 0, 0, 'pendiente', [[1, 60, 56], [3, 10, 828], [10, 200, 20]]], ['oc2', 'OC-0011', 2, 2, 'pendiente', [[9, 30, 302]]], ['oc3', 'OC-0010', 5, 1, 'convertida', [[2, 8, 1908]]], ['oc4', 'OC-0009', 11, 3, 'cancelada', [[5, 24, 104]]]];
  const orden_compra_detalles = [];
  const ordenes_compra = OC.map(([id, numero, k, pv, estado, items]) => { const det = items.map(([pid, q, c], j) => ({ id: id + '-' + j, orden_compra_id: id, producto_id: pid, producto_nombre: PRODUCTOS[pid - 1][0], cantidad: q, costo_unitario: c, subtotal: q * c })); orden_compra_detalles.push(...det);
    return { id, auth_user_id: UID, numero, fecha: ymdB(k), created_at: ymdB(k) + 'T08:30:00', proveedor_id: proveedores[pv].id, proveedor_nombre: PROV[pv], total: det.reduce((s, d) => s + d.subtotal, 0), subtotal: det.reduce((s, d) => s + d.subtotal, 0), estado, orden_compra_detalles: det.map(d => ({ id: d.id })) }; });
  const caja_chica_sesiones = [{ id: 'cc1', auth_user_id: UID, fecha: ymd(now), estado: 'abierta', monto_inicial: 3000 }];
  ventas.forEach((v, i) => { v.numero_venta = 'V-' + String(v.id).padStart(5, '0'); v.cliente_nombre = i % 4 ? ['Pulpería Doña Rosa', 'Abarrotes El Sol', 'Mini Súper Jireh', 'Tienda Don Carlos'][i % 4] : 'Consumidor Final'; v.metodo_pago = ['Efectivo', 'Tarjeta', 'Transferencia'][i % 3]; v.created_at = v.fecha; v.subtotal = v.total - v.impuesto; v.descuento = 0; });
  detalles.forEach(x => { x.precio = Math.round(x.subtotal / x.cantidad * 100) / 100; x.ganancia = Math.round(x.subtotal * .28); x.descuento = 0; });
  ventas.forEach(v => { v.metodo_pago_nombre = v.metodo_pago; v.ganancia = v.total - v.impuesto - v.costo_total; });
  const metodos_pago = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta']].map(([id, n], i) => ({ id, auth_user_id: UID, nombre: n, activo: true, orden: i, es_default: i === 0 }));
  const bancos = [['b1', 'BANPRO'], ['b2', 'LAFISE Bancentro'], ['b3', 'BAC Credomatic']].map(([id, n], i) => ({ id, auth_user_id: UID, nombre: n, activo: true, moneda: 'NIO', created_at: '2026-01-0' + (i + 1) }));
  const precios_escala = [['e1', 'Detalle', 145], ['e2', 'Mayorista', 132], ['e3', 'Distribuidor', 125]].map(([id, n, pr], i) => ({ id, auth_user_id: UID, producto_id: 5, nombre: n, precio: pr, orden: i }));
  productos.find(x => x.id === 5).tipo_precio = 'escala';
  productos.find(x => x.id === 2).permite_fraccion = true;
  const ymdOff = k => { const d = new Date(now); d.setDate(d.getDate() + k); return ymd(d); };
  [[0, 'Comedor Mary', 2500, -3], [1, 'Ferretería Ruiz', 1800, 4], [2, 'Farmacia Central', 3200, 9], [3, 'Mini Súper Jireh', 1500, 15]].forEach(([i, n, m, k]) => Object.assign(clientes[i], { nombre: n, tipo_cliente: 'recurrente', frecuencia_pago: 'mensual', monto_recurrente: m, dia_pago: 5, fecha_proxima_pago: ymdOff(k), fecha_ultimo_pago: ymdOff(k - 30), saldo_pendiente: 0, telefono: '8' + (5550000 + i * 1234) }));
  productos.forEach(x => { if (x.tipo === 'producto' && !x.costo) x.costo = Math.round(x.precio * (.68 + rnd() * .1)); });
  const PRD = id => productos.find(x => x.id === id);
  const combos = [['cb1', 'Combo Desayuno', 'CB-001', 560], ['cb2', 'Paquete Limpieza Hogar', 'CB-002', 290], ['cb3', 'Canasta Básica', 'CB-003', 5690]].map(([id, n, sku, pr], i) => ({ id, auth_user_id: UID, nombre: n, sku, codigo_barras: '75012345' + (6780 + i), precio: pr, tipo_precio: 'fijo', activo: true, created_at: '2026-09-0' + (i + 1) + 'T10:00:00' }));
  const combo_items = [['cb1', 5, 1], ['cb1', 9, 1], ['cb1', 6, 1], ['cb2', 7, 2], ['cb2', 12, 1], ['cb3', 2, 1], ['cb3', 4, 1], ['cb3', 1, 2]].map(([c, pid, q], i) => ({ id: 'ci' + i, auth_user_id: UID, combo_id: c, producto_id: pid, cantidad: q, precio_unitario: PRD(pid).precio, productos: { nombre: PRD(pid).nombre, costo: PRD(pid).costo, activo: true } }));
  const promociones = [
    { id: 'pr1', auth_user_id: UID, nombre: '2x1 Gaseosa Rojita 3L', tipo: 'nxm_mismo', producto_id: 8, n_compra: 2, m_paga: 1, activo: true, fecha_inicio: ymd(now), fecha_fin: ymdOff(20), created_at: '2026-10-01' },
    { id: 'pr2', auth_user_id: UID, nombre: '3x2 Jabón Xedex', tipo: 'nxm_mismo', producto_id: 7, n_compra: 3, m_paga: 2, activo: true, fecha_inicio: null, fecha_fin: null, created_at: '2026-09-20' },
    { id: 'pr3', auth_user_id: UID, nombre: 'Arroz: 5% llevando 5 qq', tipo: 'descuento_cantidad', producto_id: 2, cantidad_minima: 5, descuento_porcentaje: 5, activo: true, fecha_inicio: ymd(now), fecha_fin: ymdOff(45), created_at: '2026-09-15' }];
  const producto_lotes = [[9, 'L-0815', 12, 18], [6, 'M-2290', 26, 40], [5, 'CP-551', 48, 22], [11, 'S-1011', 75, 60], [9, 'L-0902', 140, 30]].map(([pid, nl, d, q], i) => ({ id: 'lt' + i, auth_user_id: UID, producto_id: pid, numero_lote: nl, fecha_vencimiento: ymdOff(d), cantidad_actual: q, cantidad_inicial: q, activo: true, created_at: '2026-09-01', productos: { nombre: PRD(pid).nombre, sku: PRD(pid).sku } }));
  ventas.forEach(v => { v.id = String(v.id); }); detalles.forEach(d => { d.venta_id = String(d.venta_id); });
  const cliByName = {}; clientes.forEach(c => { if (!cliByName[c.nombre]) cliByName[c.nombre] = c.id; });
  ventas.forEach(v => { v.cliente_id = cliByName[v.cliente_nombre] || null; });
  const cliente_interacciones = [['mensaje', 'Pedido semanal confirmado', 'Confirmó 10 qq de arroz para el lunes.', 1], ['llamada', 'Consulta de precios mayoristas', 'Pidió lista de precios de aceite y azúcar.', 4], ['visita', 'Visita de ruta', 'Se cobró la factura V-01188.', 9], ['cotizacion', 'Cotización enviada', 'Proforma P-0045 por C$ 18,400.', 15]].map(([tipo, titulo, descripcion, k], i) => ({ id: 'in' + i, auth_user_id: UID, cliente_id: 4, tipo, titulo, descripcion, fecha: ymd0(k) + 'T10:30:00', registrado_por: 'Carlos Torres', created_at: ymd0(k) }));
  const puntos_saldos = [{ auth_user_id: UID, cliente_id: 4, saldo: 340 }];

  // ================= TRANSPORTE (mock para el video del módulo)
  const dOff = k => { const d = new Date(now); d.setDate(d.getDate() + k); return ymd(d); };
  const tsOff = (k, h) => { const d = new Date(now); d.setDate(d.getDate() + k); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const UN = [['u1', 'Cabezal 01', 'cabezal', 'motriz', 'C 123-456', 'Freightliner', 'Cascadia', 2021, 'disponible', 412300, 3],
    ['u2', 'Cabezal 02', 'cabezal', 'motriz', 'C 123-789', 'Volvo', 'FH 500', 2022, 'en_viaje', 298750, 3], ['u3', 'Cabezal 03', 'cabezal', 'motriz', 'C 124-110', 'Kenworth', 'T680', 2019, 'taller', 588400, 3],
    ['u4', 'Camión 04', 'rigido', 'motriz', 'M 456-221', 'Hino', '500', 2020, 'en_viaje', 176200, 2], ['u5', 'Camión 05', 'rigido', 'motriz', 'M 456-778', 'Isuzu', 'FVR', 2023, 'disponible', 64800, 2],
    ['u6', 'Furgón 01', 'furgon', 'arrastre', 'R 789-001', 'Great Dane', '53 pies', 2020, 'en_viaje', null, 2], ['u7', 'Plataforma 02', 'plataforma', 'arrastre', 'R 789-002', 'Utility', 'Cama baja', 2018, 'disponible', null, 3]];
  const transporte_unidades = UN.map(([id, nombre, tipo, rol, placa, marca, modelo, anio, estado, odo, ejes], i) => ({ id, auth_user_id: UID, codigo: 'U-00' + (i + 1), nombre, tipo, rol, placa, marca, modelo, anio, estado, odometro_km: odo, ejes, capacidad_ton: rol === 'arrastre' ? 30 : (tipo === 'cabezal' ? 40 : 12), combustible: rol === 'motriz' ? 'Diésel' : null, propiedad: 'propia', fotos: [], created_at: '2026-0' + (i + 1) + '-01T10:00:00' }));
  const CO = [['c1', 'José Martínez', 'conductor', 'empleado', 'en_viaje', 'u2', 'viaje', 3500], ['c2', 'Luis Gutiérrez', 'conductor', 'empleado', 'en_viaje', 'u4', 'km', 9], ['c3', 'Pedro Hernández', 'conductor', 'empleado', 'disponible', 'u1', 'viaje', 3200],
    ['c4', 'Carlos Rivas', 'conductor', 'subcontratado', 'disponible', 'u5', 'porcentaje', 12], ['c5', 'Mario López', 'conductor', 'empleado', 'descanso', null, 'viaje', 3000], ['c6', 'Ana Castillo', 'ayudante', 'empleado', 'en_viaje', null, 'viaje', 900], ['c7', 'Jorge Mendoza', 'ayudante', 'empleado', 'disponible', null, 'viaje', 800]];
  const transporte_conductores = CO.map(([id, nombre, rol, vinculo, estado, u, pm, pt], i) => ({ id, auth_user_id: UID, nombre, rol, vinculo, estado, unidad_asignada_id: u, telefono: '8' + (7712000 + i * 1313), licencia_tipo: rol === 'conductor' ? 'Categoría 5' : null, nacionalidad: 'Nicaragüense', pago_modalidad: pm, pago_tarifa: pt, created_at: '2026-01-1' + i }));
  const DC = [['unidad', 'u1', 'seguro', 'POL-88123', 210], ['unidad', 'u1', 'revision_tecnica', 'RT-5521', 95], ['unidad', 'u2', 'seguro', 'POL-88124', 18], ['unidad', 'u2', 'permiso_frontera', 'PF-2231', 140], ['unidad', 'u3', 'revision_tecnica', 'RT-4410', -6],
    ['unidad', 'u4', 'seguro', 'POL-77610', 300], ['unidad', 'u5', 'tarjeta_circulacion', 'TC-9912', 260], ['unidad', 'u6', 'poliza_carga', 'PC-1120', 25], ['unidad', 'u7', 'revision_tecnica', 'RT-3301', 180],
    ['conductor', 'c1', 'licencia', 'LIC-001245', 400], ['conductor', 'c1', 'pasaporte', 'C0112233', 620], ['conductor', 'c2', 'licencia', 'LIC-002877', 12], ['conductor', 'c3', 'licencia', 'LIC-003104', 520], ['conductor', 'c4', 'licencia', 'LIC-004418', -3], ['conductor', 'c5', 'licencia', 'LIC-005561', 300], ['conductor', 'c2', 'certificado_medico', 'CM-221', 75]];
  const transporte_documentos = DC.map(([et, eid, tipo, numero, k], i) => ({ id: 'd' + i, auth_user_id: UID, entidad_tipo: et, entidad_id: eid, tipo, numero, vencimiento: dOff(k), emision: dOff(k - 365) }));
  const RU = [['r1', 'Managua – Corinto', 'Managua', 'Puerto de Corinto', 152, 3, false, null, 'Nicaragua', 'Nicaragua', 380], ['r2', 'Managua – San Pedro Sula', 'Managua', 'San Pedro Sula', 620, 14, true, 'El Guasaule', 'Nicaragua', 'Honduras', 1250],
    ['r3', 'Managua – San José', 'Managua', 'San José', 430, 11, true, 'Peñas Blancas', 'Nicaragua', 'Costa Rica', 900], ['r4', 'Managua – Matagalpa', 'Managua', 'Matagalpa', 130, 2.5, false, null, 'Nicaragua', 'Nicaragua', 120], ['r5', 'Managua – Chinandega', 'Managua', 'Chinandega', 135, 2.5, false, null, 'Nicaragua', 'Nicaragua', 150], ['r6', 'Managua – Guatemala', 'Managua', 'Ciudad de Guatemala', 960, 26, true, 'El Guasaule, El Amatillo, San Cristóbal', 'Nicaragua', 'Guatemala', 2100]];
  const transporte_rutas = RU.map(([id, nombre, origen, destino, km, h, fr, frs, po, pd, pe]) => ({ id, auth_user_id: UID, nombre, origen, destino, distancia_km: km, tiempo_horas: h, cruza_frontera: fr, fronteras: frs, pais_origen: po, pais_destino: pd, peajes_estimados: pe, activa: true }));
  const transporte_tarifas = [['r1', 'viaje', 18500], ['r2', 'viaje', 68000], ['r3', 'viaje', 52000], ['r4', 'tonelada', 520], ['r5', 'viaje', 15800], ['r6', 'km', 98]].map(([ruta_id, tipo_cobro, precio], i) => ({ id: 'tf' + i, auth_user_id: UID, ruta_id, cliente_id: null, tipo_cobro, precio, activa: true, created_at: '2026-02-01' }));
  const CLT = ['Café Soluble S.A.', 'Molinos de Nicaragua', 'Lácteos Centroamericanos', 'Distribuidora La Fe', 'Agroexportadora del Norte', 'Ingenio San Antonio', 'Cervecería Nacional'];
  // [num, cliente, ruta, estado, dias, unidad, remolque, conductor, carga, ton]
  const OR = [['OT-0141', 0, 'r1', 'pendiente', 1, null, null, null, 'Café en sacos — contenedor 40 pies', 24], ['OT-0140', 4, 'r2', 'pendiente', 2, null, null, null, 'Ajonjolí descortezado', 26], ['OT-0139', 1, 'r4', 'pendiente', -1, null, null, null, 'Harina de trigo', 18],
    ['OT-0138', 2, 'r3', 'asignada', 0, 'u1', 'u6', 'c3', 'Leche UHT — 1,800 cajas', 22], ['OT-0137', 5, 'r5', 'asignada', 1, 'u5', null, 'c4', 'Azúcar refinada', 12],
    ['OT-0136', 0, 'r2', 'en_ruta', -1, 'u2', 'u6', 'c1', 'Café oro exportación', 25], ['OT-0135', 3, 'r4', 'en_ruta', 0, 'u4', null, 'c2', 'Abarrotes surtidos', 10],
    ['OT-0134', 6, 'r1', 'entregada', -2, 'u1', 'u7', 'c3', 'Malta en sacos', 28], ['OT-0133', 2, 'r3', 'entregada', -4, 'u2', 'u6', 'c1', 'Queso y lácteos refrigerados', 20], ['OT-0132', 1, 'r5', 'entregada', -5, 'u4', null, 'c2', 'Harina y pastas', 11],
    ['OT-0131', 4, 'r2', 'entregada', -7, 'u1', 'u6', 'c3', 'Maní en grano', 26], ['OT-0130', 0, 'r1', 'entregada', -8, 'u5', null, 'c4', 'Café en sacos', 12], ['OT-0129', 5, 'r6', 'entregada', -9, 'u2', 'u6', 'c1', 'Azúcar exportación', 27]];
  const transporte_ordenes = OR.map(([numero, ci, rid, estado, k, u, rm, c, carga, ton], i) => {
    const r = RU.find(x => x[0] === rid), tf = transporte_tarifas.find(t => t.ruta_id === rid);
    const cant = tf.tipo_cobro === 'viaje' ? 1 : tf.tipo_cobro === 'km' ? r[4] : ton; const flete = tf.precio * cant; const rec = i % 4 === 0 ? [{ nombre: 'Seguro de carga', monto: 1500 }] : [];
    const tot = flete + rec.reduce((s, x) => s + x.monto, 0); const odo0 = 300000 + i * 2100;
    return { id: 'o' + i, auth_user_id: UID, numero, cliente_id: null, cliente_nombre: CLT[ci], ruta_id: rid, origen: r[2], destino: r[3], fecha_programada: dOff(k), estado, unidad_id: u, remolque_id: rm, conductor_id: c, ayudante_id: estado === 'en_ruta' && i === 5 ? 'c6' : null,
      carga_descripcion: carga, peso_ton: ton, bultos: 400 + i * 20, tarifa_tipo: tf.tipo_cobro, tarifa_precio: tf.precio, cantidad_base: cant, flete, recargos: rec, total: tot,
      salida_real: ['en_ruta', 'entregada'].includes(estado) ? tsOff(k - (r[5] > 10 ? 1 : 0), 6) : null, entrega_real: estado === 'entregada' ? tsOff(k, 6 + Math.round(r[5] % 12)) : null,
      odometro_salida: ['en_ruta', 'entregada'].includes(estado) ? odo0 : null, odometro_llegada: estado === 'entregada' ? odo0 + r[4] : null, receptor: estado === 'entregada' ? ['Ramón Pérez', 'Lucía Gómez', 'Bodega central', 'Martín Ruiz', 'Karla Díaz', 'Óscar Vega'][i % 6] : null,
      venta_id: (estado === 'entregada' && i >= 10) ? 'vt' + i : null, subcontratada: false, created_at: tsOff(k - 3, 9) };
  });
  const CC = { o5: [['combustible', 9800], ['peaje', 1250], ['viatico', 1200], ['anticipo', 2000], ['frontera', 1850]], o6: [['combustible', 2100], ['viatico', 350]],
    o7: [['combustible', 3200], ['peaje', 380], ['viatico', 450]], o8: [['combustible', 7600], ['peaje', 900], ['frontera', 1650], ['hospedaje', 900], ['viatico', 1100]], o9: [['combustible', 3100], ['peaje', 150], ['viatico', 400]],
    o10: [['combustible', 10200], ['peaje', 1250], ['frontera', 1850], ['viatico', 1300], ['anticipo', 2500]], o11: [['combustible', 3000], ['peaje', 380]], o12: [['combustible', 15800], ['peaje', 2100], ['frontera', 4200], ['hospedaje', 2400], ['viatico', 2600], ['reparacion', 3500]] };
  const transporte_costos = []; Object.entries(CC).forEach(([oid, arr]) => arr.forEach(([categoria, monto], j) => transporte_costos.push({ id: oid + 'k' + j, auth_user_id: UID, orden_id: oid, categoria, monto, fecha: dOff(-2), descripcion: categoria === 'combustible' ? 'Diésel' : null })));
  const transporte_cruces = [{ id: 'x1', auth_user_id: UID, orden_id: 'o5', frontera: 'El Guasaule', sentido: 'ida', estado: 'en_tramite', referencia: 'DUA 2026-118734', agente_aduanal: 'Aduanas Express', costo_tramite: 1850, llegada_en: tsOff(0, 7), created_at: tsOff(-1, 6) },
    { id: 'x2', auth_user_id: UID, orden_id: 'o8', frontera: 'Peñas Blancas', sentido: 'ida', estado: 'cruzado', referencia: 'DUA 2026-117902', agente_aduanal: 'Aduanas Express', costo_tramite: 1650, llegada_en: tsOff(-5, 14), cruce_en: tsOff(-5, 18), created_at: tsOff(-6, 6) },
    { id: 'x3', auth_user_id: UID, orden_id: 'o12', frontera: 'El Amatillo', sentido: 'ida', estado: 'cruzado', referencia: 'DUA 2026-117450', costo_tramite: 1400, llegada_en: tsOff(-10, 9), cruce_en: tsOff(-10, 12), created_at: tsOff(-11, 6) },
    { id: 'x4', auth_user_id: UID, orden_id: 'o12', frontera: 'San Cristóbal', sentido: 'ida', estado: 'retenido', referencia: 'DUA 2026-117451', costo_tramite: 0, llegada_en: tsOff(-10, 20), created_at: tsOff(-11, 6) }];
  const firma = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="#fff"/><path d="M40 140 C 80 40, 120 40, 140 120 S 200 170, 230 90 S 290 30, 310 120 C 330 170, 370 60, 400 100 S 470 150, 520 80" stroke="#111" stroke-width="5" fill="none" stroke-linecap="round"/></svg>');
  const transporte_entregas = [['o7', 'Ramón Pérez', true], ['o8', 'Lucía Gómez', true], ['o9', 'Bodega central', false], ['o10', 'Martín Ruiz', true]].map(([orden_id, receptor, conforme], i) => ({ id: 'en' + i, auth_user_id: UID, orden_id, receptor, receptor_documento: '001-' + (120394 + i) + '-0003K', recibido_en: tsOff(-2 - i * 2, 14), conforme, bultos_recibidos: conforme ? 520 : 512, observaciones: conforme ? null : 'Llegaron 8 bultos dañados por humedad.', firma_url: firma }));
  const transporte_incidencias = [['INC-0007', 'o9', 'dano_carga', 'media', 'en_gestion', 'Llegaron 8 bultos dañados por humedad.', -5, 4800, 6200], ['INC-0006', 'o12', 'multa', 'alta', 'abierta', 'Retención en San Cristóbal por documento de origen incompleto.', -10, 3500, 0], ['INC-0005', 'o6', 'retraso', 'baja', 'abierta', 'Tráfico en la Carretera Norte: 2 horas de retraso.', 0, 0, 0], ['INC-0004', 'o10', 'averia', 'media', 'resuelta', 'Cambio de manguera de aire en ruta.', -7, 1800, 0]]
    .map(([numero, orden_id, tipo, gravedad, estado, descripcion, k, ce, mr], i) => ({ id: 'in' + i, auth_user_id: UID, numero, orden_id, tipo, gravedad, estado, descripcion, fecha: dOff(k), costo_estimado: ce, monto_reclamado: mr, unidad_id: null, conductor_id: null, resolucion: estado === 'resuelta' ? 'Reparado en ruta, sin afectar la entrega.' : null, resuelta_en: estado === 'resuelta' ? tsOff(k, 18) : null, created_at: tsOff(k, 10) }));
  const transporte_mant_planes = [['u1', 'Cambio de aceite y filtros', 15000, 180, 399000, -120, 1500, 15], ['u2', 'Cambio de aceite y filtros', 15000, 180, 286000, -40, 1500, 15], ['u3', 'Servicio mayor de frenos', 60000, 365, 525000, -300, 3000, 30], ['u4', 'Cambio de aceite', 10000, 120, 167500, -90, 1000, 10], ['u5', 'Revisión general', 20000, 180, 50000, -30, 2000, 15], ['u2', 'Alineación y balanceo', 25000, 0, 280000, null, 2000, 0]]
    .map(([unidad_id, nombre, cada_km, cada_dias, ultimo_km, kd, aviso_km, aviso_dias], i) => ({ id: 'mp' + i, auth_user_id: UID, unidad_id, nombre, cada_km, cada_dias, ultimo_km, ultima_fecha: kd != null ? dOff(kd) : null, aviso_km, aviso_dias, activo: true, created_at: '2026-03-01' }));
  const transporte_mant_ordenes = [['MT-0018', 'u3', 'correctivo', 'Reparación de caja de cambios', 'Taller Hermanos López', 0, 'abierta', 12000, 26500], ['MT-0017', 'u1', 'preventivo', 'Cambio de aceite y filtros', 'Taller Hermanos López', -8, 'cerrada', 1800, 6400], ['MT-0016', 'u4', 'preventivo', 'Cambio de aceite', 'Lubricentro Central', -20, 'cerrada', 900, 3900], ['MT-0015', 'u2', 'correctivo', 'Cambio de llantas de tracción', 'Llantera El Rodeo', -25, 'cerrada', 1200, 38000]]
    .map(([numero, unidad_id, tipo, descripcion, taller, k, estado, mano_obra, repuestos], i) => ({ id: 'mo' + i, auth_user_id: UID, numero, unidad_id, tipo, descripcion, taller, fecha: dOff(k), estado, mano_obra, repuestos, total: mano_obra + repuestos, odometro_km: null, created_at: tsOff(k, 9) }));
  const LL = [['LL-001', 'Michelin', '295/80R22.5', 'en_uso', 'u1', 'Eje 1 izquierda', 340000, 120000], ['LL-002', 'Michelin', '295/80R22.5', 'en_uso', 'u1', 'Eje 1 derecha', 340000, 120000], ['LL-003', 'Bridgestone', '11R22.5', 'en_uso', 'u2', 'Tracción 1', 196000, 110000], ['LL-004', 'Bridgestone', '11R22.5', 'en_uso', 'u2', 'Tracción 2', 196000, 110000],
    ['LL-005', 'Goodyear', '11R22.5', 'en_uso', 'u4', 'Trasera izquierda', 72000, 110000], ['LL-006', 'Goodyear', '295/80R22.5', 'almacen', null, null, null, 100000], ['LL-007', 'Michelin', '295/80R22.5', 'nueva', null, null, null, 120000], ['LL-008', 'Firestone', '11R22.5', 'recapada', null, null, null, 80000]];
  const transporte_llantas = LL.map(([codigo, marca, medida, estado, unidad_id, posicion, km_montaje, vida], i) => ({ id: 'll' + i, auth_user_id: UID, codigo, marca, medida, estado, unidad_id, posicion, km_montaje, km_previos: estado === 'almacen' ? 64000 : 0, vida_util_km: vida, costo: 14500 }));
  const transporte_liquidaciones = [{ id: 'lq1', auth_user_id: UID, numero: 'LQ-0021', conductor_id: 'c3', conductor_nombre: 'Pedro Hernández', fecha: dOff(-3), modalidad: 'viaje', bruto: 6400, anticipos: 0, neto: 6400, estado: 'pagada', metodo_pago_nombre: 'Efectivo', created_at: tsOff(-3, 16) }, { id: 'lq2', auth_user_id: UID, numero: 'LQ-0020', conductor_id: 'c4', conductor_nombre: 'Carlos Rivas', fecha: dOff(-6), modalidad: 'porcentaje', bruto: 2220, anticipos: 0, neto: 2220, estado: 'pagada', metodo_pago_nombre: 'Transferencia', created_at: tsOff(-6, 16) }];
  const transporte_liquidacion_ordenes = [{ id: 'lo1', auth_user_id: UID, liquidacion_id: 'lq1', orden_id: 'o7', bruto: 3200, anticipo: 0, costo_neto: 3200 }, { id: 'lo2', auth_user_id: UID, liquidacion_id: 'lq1', orden_id: 'o10', bruto: 3200, anticipo: 0, costo_neto: 3200 }, { id: 'lo3', auth_user_id: UID, liquidacion_id: 'lq2', orden_id: 'o11', bruto: 2220, anticipo: 0, costo_neto: 2220 }];
  const transporte_subcontratistas = [{ id: 's1', auth_user_id: UID, nombre: 'Transportes Hermanos Ruiz', ruc: 'J0310000555123', telefono: '8855-1200', placa_habitual: 'C 998-221', dias_credito: 30, retencion_ir_pct: 2, activo: true }, { id: 's2', auth_user_id: UID, nombre: 'Fletes del Norte', telefono: '8833-4410', dias_credito: 0, retencion_ir_pct: 2, activo: true }];
  const transporte_subcontrataciones = [];
  const creditos = [{ id: 'cr1', auth_user_id: UID, venta_id: 'vt10', saldo_pendiente: 34000, estado: 'activo' }];
  const ventasTx = [{ id: 'vt10', auth_user_id: UID, numero_venta: 'V-04512', total: 69500, estado: 'completada', fecha_venta: dOff(-7), created_at: dOff(-7) }, { id: 'vt11', auth_user_id: UID, numero_venta: 'V-04519', total: 18500, estado: 'completada', fecha_venta: dOff(-8), created_at: dOff(-8) }, { id: 'vt12', auth_user_id: UID, numero_venta: 'V-04527', total: 94080, estado: 'completada', fecha_venta: dOff(-9), created_at: dOff(-9) }];
  const creditos_cuotas = [];
  const DB = {
    transporte_unidades, transporte_conductores, transporte_documentos, transporte_rutas, transporte_tarifas, transporte_ordenes, transporte_costos, transporte_cruces, transporte_entregas, transporte_incidencias, transporte_mant_planes, transporte_mant_ordenes, transporte_llantas, transporte_llantas_movs: [], transporte_liquidaciones, transporte_liquidacion_ordenes, transporte_subcontratistas, transporte_subcontrataciones, creditos, creditos_cuotas, transporte_estados_historial: [],
    cliente_interacciones, puntos_saldos,
    combos, combo_items, promociones, producto_lotes,
    metodos_pago, bancos, precios_escala,
    proveedores, compras, detalle_compras, ordenes_compra, orden_compra_detalles, caja_chica_sesiones,
    configuracion_empresa: [{ auth_user_id: UID, nombre_negocio: 'Transportes Torres', nombre_comercial: 'Transportes Torres', moneda: 'NIO',
      onboarding_completado: true, catalogo360_regalo_mostrado: true, maneja_lotes_vencimiento: true, usa_puntos: true, maneja_presentaciones: true, usa_numero_serie: true, tipo_negocio: 'transporte', usa_modulo_transporte: true, metadata: { transporte: { operacion: 'ambas', alcance: 'internacional', paises: ['Honduras', 'Costa Rica', 'El Salvador', 'Guatemala'] } } }],
    usuarios: [{ auth_user_id: UID, nombre: 'Carlos', apellido: 'Torres', plan: 'premium', estado_cuenta: 'activa' }],
    ventas: ventas.concat(ventasTx), venta_detalles: detalles, productos, clientes, gastos,
    movimientos_impuestos: [{ auth_user_id: UID, saldo_resultante: 4180.5, created_at: now.toISOString() }],
    movimientos_financieros: [
      { auth_user_id: UID, saldo_resultante: 48650.75, estado: 'completado', referencia_tipo: 'venta', tipo_flujo: 'INGRESO', monto: 2300, fecha: ymd(now), created_at: now.toISOString() },
      { auth_user_id: UID, estado: 'completado', referencia_tipo: null, tipo_flujo: 'INGRESO', monto: 3500, fecha: monthStart, created_at: '2000-01-01' },
      { auth_user_id: UID, estado: 'completado', referencia_tipo: null, tipo_flujo: 'EGRESO', monto: 1250, fecha: monthStart, created_at: '2000-01-01' }],
    activos_fijos: [{ id: 1, auth_user_id: UID, estado: 'activo', nombre: 'Camión Hino 2019', fecha_adquisicion: '2023-01-15', costo_adquisicion: 900000, valor_residual: 100000, vida_util_anos: 8, garantia_vencimiento: ymd(d20) }],
    tutoriales_vistos: [{ auth_user_id: UID, modulo_key: 'dashboard' }],
    notificaciones: [{ id: 1, created_at: now.toISOString() }, { id: 2, created_at: now.toISOString() }],
  };

  function Q(table) { this.t = table; this.f = []; this.opts = {}; this.single = 0; this.lim = null; this.ord = null; this.write = false; }
  const P = Q.prototype;
  const add = op => function (col, val) { this.f.push([op, col, val]); return this; };
  ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'like', 'ilike'].forEach(op => P[op] = add(op));
  P.select = function (_c, o) { if (o) this.opts = o; return this; };
  P.order = function (c, o) { this.ord = [c, o && o.ascending === false]; return this; };
  P.limit = function (n) { this.lim = n; return this; };
  P.range = function () { return this; };
  P.not = P.or = P.filter = P.match = P.contains = P.textSearch = function () { return this; };
  P.maybeSingle = function () { this.single = 1; return this; };
  P.single = function () { this.single = 2; return this; };
  P.insert = P.upsert = P.update = P.delete = function () { this.write = true; return this; };
  P.then = function (res, rej) { return Promise.resolve(this.run()).then(res, rej); };
  P.run = function () {
    if (this.write) return { data: null, error: null };
    if (this.t === 'tutoriales_vistos') return { data: this.single ? { modulo_key: 'visto' } : [{ modulo_key: 'visto' }], error: null };
    let rows = (DB[this.t] || []).filter(r => this.f.every(([op, c, v]) => {
      const x = r[c];
      if (x === undefined && c !== 'auth_user_id') return true;
      switch (op) {
        case 'eq': return x === undefined ? (c === 'auth_user_id') : (x === v || (x != null && v != null && String(x) === String(v)));
        case 'neq': return x !== v; case 'gte': return x >= v; case 'lte': return x <= v;
        case 'gt': return x > v; case 'lt': return x < v; case 'in': return v.includes(x);
        case 'is': return (x ?? null) === v; default: return true;
      }
    }));
    if (this.ord) { const [c, desc] = this.ord; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : -1) * (desc ? -1 : 1)); }
    if (this.lim) rows = rows.slice(0, this.lim);
    const count = rows.length;
    if (this.opts.head) return { data: null, count, error: null };
    if (this.single) return { data: rows[0] || null, error: null, count };
    return { data: rows, error: null, count };
  };
  const user = { id: UID, email: 'demo@negocio360oficial.com' };
  const session = { user, access_token: 'demo', expires_at: 9999999999 };
  const client = {
    from: t => new Q(t),
    rpc: name => Promise.resolve({ data: name === 'listar_perfiles_del_grupo' ? [{ id: 'p1', nombre: 'Admin', tipo: 'admin', modulos: [], codigo_configurado: false }] : null, error: null }),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }), signInWithPassword: async () => ({ data: { user, session }, error: null }),
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({}) }) },
  };
  window.supabase = { createClient: () => client };
  try {
    sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ authUserId: UID, id: 'p1', nombre: 'Admin', tipo: 'admin', modulos: [] }));
    sessionStorage.setItem('n360_welcome_visto', '1');
    localStorage.setItem('n360_theme', 'light');
  } catch (_) {}
})();
