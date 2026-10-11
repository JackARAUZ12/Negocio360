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
      const nItems = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < nItems; j++) {
        const pi = Math.floor(Math.pow(rnd(), 1.6) * PRODUCTOS.length);
        const [nombre, precio] = PRODUCTOS[pi];
        const cant = precio > 1000 ? 1 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 20);
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
  const TARGET = [86000, 93000, 90500, 99000, 104000, 112000, 121000];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); const day = ymd(d);
    const vs = ventas.filter(v => v.fecha.startsWith(day)); const sum = vs.reduce((s, v) => s + v.total, 0);
    const k = TARGET[6 - i] / sum;
    vs.forEach(v => { v.total = Math.round(v.total * k); v.impuesto = Math.round(v.impuesto * k * 100) / 100; v.costo_total = Math.round(v.costo_total * k);
      detalles.filter(x => x.venta_id === v.id).forEach(x => x.subtotal = Math.round(x.subtotal * k)); });
  }
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const productos = [];
  PRODUCTOS.forEach(([n], i) => productos.push({ id: i + 1, auth_user_id: UID, nombre: n, tipo: 'producto', stock_actual: [4, 120, 85, 3, 240, 310, 160, 2, 95, 400, 5, 130][i], stock_minimo: [10, 20, 15, 10, 30, 40, 20, 12, 15, 50, 12, 20][i] }));
  for (let i = 0; i < 26; i++) productos.push({ id: 100 + i, auth_user_id: UID, nombre: 'Producto ' + i, tipo: 'producto', stock_actual: 40 + Math.floor(rnd() * 300), stock_minimo: 10 });
  ['Entrega a domicilio', 'Instalación', 'Flete'].forEach((n, i) => productos.push({ id: 200 + i, auth_user_id: UID, nombre: n, tipo: 'servicio' }));
  const clientes = Array.from({ length: 148 }, (_, i) => ({ id: i + 1, auth_user_id: UID }));
  const gastos = [['Salarios', 32000], ['Combustible', 9800], ['Energía', 4200], ['Alquiler', 12000], ['Internet', 1200]]
    .map(([c, m], i) => ({ id: i, auth_user_id: UID, concepto: c, monto: m, fecha: monthStart }));
  const d20 = new Date(now); d20.setDate(d20.getDate() + 18);

  const DB = {
    configuracion_empresa: [{ auth_user_id: UID, nombre_negocio: 'Distribuidora Torres', nombre_comercial: 'Distribuidora Torres', moneda: 'NIO',
      onboarding_completado: true, catalogo360_regalo_mostrado: true, tipo_negocio: 'distribuidora', metadata: {} }],
    usuarios: [{ auth_user_id: UID, nombre: 'Carlos', apellido: 'Torres', plan: 'premium', estado_cuenta: 'activa' }],
    ventas, venta_detalles: detalles, productos, clientes, gastos,
    movimientos_impuestos: [{ auth_user_id: UID, saldo_resultante: 18640.5, created_at: now.toISOString() }],
    movimientos_financieros: [
      { auth_user_id: UID, saldo_resultante: 186540.75, estado: 'completado', referencia_tipo: 'venta', tipo_flujo: 'INGRESO', monto: 2300, fecha: ymd(now), created_at: now.toISOString() },
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
      if (x === undefined && op === 'eq' && c !== 'auth_user_id' && c !== 'tipo' && c !== 'estado' && c !== 'tipo_item') return true;
      switch (op) {
        case 'eq': return x === undefined ? (c === 'auth_user_id') : x === v;
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
