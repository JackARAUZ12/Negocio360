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

  const PROV = ['Distribuidora La Fe', 'Molinos de Nicaragua', 'Lácteos Centroamericanos', 'Café Soluble S.A.', 'Productos de Limpieza Xedex'];
  const proveedores = PROV.map((n, i) => ({ id: i + 1, auth_user_id: UID, nombre: n, activo: true, telefono: '8' + (1234567 + i * 1111), contacto: ['Luis', 'Ana', 'Pedro', 'María', 'José'][i], created_at: '2026-01-01T00:00:00' }));
  const compras = Array.from({ length: 9 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - i * 3); return { id: i + 1, auth_user_id: UID, numero_compra: 'C-' + String(118 - i).padStart(5, '0'), proveedor_id: i % 5 + 1, proveedor_nombre: PROV[i % 5], total: [18500, 9800, 12650, 4300, 7600, 15200, 6900, 11300, 5400][i], estado: 'completada', estado_pago: i % 3 ? 'pagado' : 'pendiente', metodo_pago: 'Transferencia', fecha: ymd(d), created_at: ymd(d) + 'T09:00:00' }; });
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
  const DB = {
    cliente_interacciones, puntos_saldos,
    combos, combo_items, promociones, producto_lotes,
    metodos_pago, bancos, precios_escala,
    proveedores, compras,
    configuracion_empresa: [{ auth_user_id: UID, nombre_negocio: 'Distribuidora Torres', nombre_comercial: 'Distribuidora Torres', moneda: 'NIO',
      onboarding_completado: true, catalogo360_regalo_mostrado: true, maneja_lotes_vencimiento: true, usa_puntos: true, maneja_presentaciones: true, usa_numero_serie: true, tipo_negocio: 'distribuidora', metadata: {} }],
    usuarios: [{ auth_user_id: UID, nombre: 'Carlos', apellido: 'Torres', plan: 'premium', estado_cuenta: 'activa' }],
    ventas, venta_detalles: detalles, productos, clientes, gastos,
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
