/* Supabase simulado SOLO para grabar el video "Primeros pasos": una cuenta NUEVA, sin datos. Guarda lo que se escribe. */
(function () {
  const UID = 'demo-nuevo-0001';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const page = (location.pathname.split('/').pop() || '').toLowerCase();
  const antes = page.startsWith('register') || page.startsWith('personalizacion');
  const CFG = { auth_user_id: UID, nombre_negocio: 'Minisúper La Esperanza', nombre_comercial: 'Minisúper La Esperanza', moneda: 'NIO', tipo_negocio: 'minisuper',
    onboarding_completado: true, onboarding_step: 6, catalogo360_regalo_mostrado: true, color_principal: '#2E7D5B', color_secundario: '#F4A93B', color_acento: '#1F6FEB', tema: 'light', logo_principal_url: 'logo_demo_esperanza.png', tasa_cambio_usd: 36.62, metadata: {}, pais: 'NI', zona_horaria: 'America/Managua' };
  const metodos_pago = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta']].map(([id, n], i) => ({ id, auth_user_id: UID, nombre: n, activo: true, orden: i, es_default: i === 0 }));
  const DB = {
    configuracion_empresa: antes ? [] : [CFG],
    usuarios: [{ auth_user_id: UID, nombre: 'Ana', apellido: 'López', plan: 'premium', estado_cuenta: 'activa', onboarding_completado: !antes, created_at: ymd(now) }],
    metodos_pago, productos: [], ventas: [], venta_detalles: [], clientes: [], gastos: [], gastos_programados: [], compras: [], detalle_compras: [], proveedores: [],
    movimientos_financieros: [], movimientos_impuestos: [], caja_chica_sesiones: [], cierres_caja: [], bancos: [], categorias_gasto_personalizadas: [], retenciones_ir: [],
    capital_negocio: [], notificaciones: [], tutoriales_vistos: [], sucursales: [], costos_escala: [], precios_escala: [], combos: [], combo_items: [], promociones: [], producto_lotes: [],
  };
  function Q(table) { this.t = table; this.f = []; this.opts = {}; this._one = 0; this.lim = null; this.ord = null; this.write = false; }
  const P = Q.prototype;
  const add = op => function (col, val) { this.f.push([op, col, val]); return this; };
  ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'like', 'ilike'].forEach(op => P[op] = add(op));
  P.select = function (_c, o) { if (o) this.opts = o; return this; };
  P.order = function (c, o) { this.ord = [c, o && o.ascending === false]; return this; };
  P.limit = function (n) { this.lim = n; return this; };
  P.range = function () { return this; };
  P.not = P.or = P.filter = P.match = P.contains = P.textSearch = function () { return this; };
  P.maybeSingle = function () { this._one = 1; return this; };
  P.single = function () { this._one = 2; return this; };
  P.insert = P.upsert = function (rows) { this.write = 'insert'; this.payload = rows; return this; };
  P.update = function (obj) { this.write = 'update'; this.payload = obj; return this; };
  P.delete = function () { this.write = 'delete'; return this; };
  let nid = 1;
  P.then = function (res, rej) { return Promise.resolve(this.run()).then(res, rej); };
  P.run = function () {
    if (this.write === 'insert') {
      const arr = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(r => ({ id: this.t.slice(0, 3) + 'n' + (nid++), created_at: new Date().toISOString(), ...r }));
      (DB[this.t] = DB[this.t] || []).push(...arr);
      return { data: this._one ? arr[0] : arr, error: null };
    }
    if (this.write) {
      const tbl = DB[this.t] || [];
      const hit = tbl.filter(r => this.f.every(([op, c, v]) => { const x = r[c];
        switch (op) { case 'eq': return x === v || (x != null && v != null && String(x) === String(v)); case 'neq': return x !== v; case 'in': return v.includes(x); case 'lt': return x < v; case 'gt': return x > v; case 'gte': return x >= v; case 'lte': return x <= v; default: return true; } }));
      if (this.write === 'update') hit.forEach(r => Object.assign(r, this.payload));
      else DB[this.t] = tbl.filter(r => !hit.includes(r));
      return { data: this.write === 'update' ? hit.map(r => ({ ...r })) : null, error: null };
    }
    if (this.t === 'tutoriales_vistos') return { data: this._one ? { modulo_key: 'visto' } : [{ modulo_key: 'visto' }], error: null };
    let rows = (DB[this.t] || []).filter(r => this.f.every(([op, c, v]) => {
      const x = r[c];
      if (x === undefined && c !== 'auth_user_id') return true;
      switch (op) {
        case 'eq': return x === undefined ? (c === 'auth_user_id') : (x === v || (x != null && v != null && String(x) === String(v)));
        case 'neq': return x !== v; case 'gte': return x >= v; case 'lte': return x <= v;
        case 'gt': return x > v; case 'lt': return x < v; case 'in': return v.includes(x);
        case 'is': return (x ?? null) === v; case 'ilike': return String(x ?? '').toLowerCase().includes(String(v).replace(/%/g,'').toLowerCase()); default: return true;
      }
    }));
    if (this.ord) { const [c, desc] = this.ord; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : -1) * (desc ? -1 : 1)); }
    if (this.lim) rows = rows.slice(0, this.lim);
    const count = rows.length;
    if (this.opts.head) return { data: null, count, error: null };
    if (this._one) return { data: rows[0] || null, error: null, count };
    return { data: rows, error: null, count };
  };
  const user = { id: UID, email: 'ana@minisuperlaesperanza.com' };
  const session = { user, access_token: 'demo', expires_at: 9999999999 };
  // Imitación de la función de la base anular_cuenta_por_pagar (solo para el demo)
  function anularCxPDemo(id) {
    const c = DB.cuentas_por_pagar.find(x => x.id === id); if (!c) return { data: null, error: { message: 'La cuenta no existe' } };
    const lin = DB.detalle_compras.filter(l => l.compra_id === c.compra_id);
    if (lin.some(l => { const p = DB.productos.find(x => x.id === l.producto_id); return p && p.stock_actual < l.cantidad; }))
      return { data: null, error: { message: 'No se puede anular: parte de lo comprado ya se vendió o salió del inventario (existencia actual menor a lo comprado)' } };
    if (c.compra_id) { DB.detalle_compras.filter(l => l.compra_id === c.compra_id).forEach(l => { const p = DB.productos.find(x => x.id === l.producto_id); if (p) p.stock_actual -= l.cantidad; });
      const cp = DB.compras.find(x => x.id === c.compra_id); if (cp) cp.estado = 'anulada'; }
    Object.assign(c, { estado: 'anulado', saldo_pendiente: 0 }); DB.cuentas_por_pagar_cuotas.filter(q => q.cuenta_id === id).forEach(q => q.saldo = 0);
    return { data: { ok: true, numero: c.numero }, error: null };
  }
  const client = {
    from: t => new Q(t),
    rpc: (name, args) => name === 'importar_productos_masivo' ? Promise.resolve((() => { const regs = args.p_registros || [];
        regs.forEach((r, i) => DB.productos.push({ id: 'imp' + i, auth_user_id: UID, activo: true, tipo_precio: 'fijo', unidad_medida: 'unidad', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r, escalas: undefined }));
        return { data: { ok: true, productos: regs.filter(r => r.tipo === 'producto').length, servicios: regs.filter(r => r.tipo === 'servicio').length, marcas_creadas: 1, actualizados: 0, omitidos: 0 }, error: null }; })())
      : Promise.resolve({ data: name === 'validar_codigo_acceso' ? { ok: true, plan: 'premium' } : name === 'listar_perfiles_del_grupo' ? [{ id: 'p1', nombre: 'Admin', tipo: 'admin', modulos: [], codigo_configurado: false }] : null, error: null }),
    _db: DB,
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }), signUp: async () => ({ data: { user, session }, error: null }), refreshSession: async () => ({ data: { user, session }, error: null }), signInWithPassword: async () => ({ data: { user, session }, error: null }),
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
  };
  window.supabase = { createClient: () => client };
  try {
    sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ authUserId: UID, id: 'p1', nombre: 'Admin', tipo: 'admin', modulos: [] }));
    sessionStorage.setItem('n360_welcome_visto', '1');
    localStorage.setItem('n360_theme', 'light');
  } catch (_) {}
})();
