// Reemplazo de la librería de Supabase SOLO para pruebas: no se conecta a
// nada. Anota cada operación que haría la página (insertar, actualizar,
// funciones del servidor) y responde con datos de prueba (window.__N360_FIXTURES).
// Sirve para obtener EXACTAMENTE lo que el código real de ventas.js guardaría.
(function () {
  'use strict';
  const registro = [];
  window.__N360_REGISTRO = registro;
  let contador = 0;
  let reloj = 0;
  const nuevoId = () => {
    contador++;
    return 'ffffffff-0000-4000-8000-' + String(contador).padStart(12, '0');
  };
  const F = () => window.__N360_FIXTURES || {};
  const copia = (x) => JSON.parse(JSON.stringify(x));

  function filtrar(filas, filtros) {
    return filas.filter((f) => filtros.every(([op, col, val]) => {
      if (op === 'eq') return String(f[col]) === String(val);
      if (op === 'neq') return String(f[col]) !== String(val);
      if (op === 'in') return (val || []).map(String).includes(String(f[col]));
      if (op === 'gt') return Number(f[col]) > Number(val);
      if (op === 'is') return val === null ? f[col] == null : f[col] === val;
      return true;
    }));
  }

  function responder(q) {
    const fx = F();
    if (q.op === 'insert' || q.op === 'upsert') {
      const filas = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({ id: nuevoId(), ...p }));
      registro.push({ op: q.op, tabla: q.tabla, payload: copia(q.payload), ids: filas.map((f) => f.id) });
      // Como la base real: lo insertado se ve en lecturas siguientes (con hora de creación creciente).
      if (fx.tablas) {
        fx.tablas[q.tabla] = fx.tablas[q.tabla] || [];
        // Valores por defecto de la base real que importan para las lecturas siguientes.
        const porDefecto = q.tabla === 'movimientos_financieros' ? { estado: 'completado' } : {};
        for (const f of filas) fx.tablas[q.tabla].push(Object.assign({ created_at: new Date(Date.now() + (++reloj)).toISOString() }, porDefecto, copia(f)));
      }
      if (q.single || q.maybeSingle) return { data: filas[0], error: null };
      return { data: q.select ? filas : null, error: null };
    }
    if (q.op === 'update' || q.op === 'delete') {
      registro.push({ op: q.op, tabla: q.tabla, payload: copia(q.payload || null), filtros: copia(q.filtros) });
      // Como la base real: las lecturas siguientes ven el cambio.
      let tocadas = [];
      if (q.op === 'update' && fx.tablas && fx.tablas[q.tabla]) {
        tocadas = filtrar(fx.tablas[q.tabla], q.filtros);
        for (const fila of tocadas) Object.assign(fila, copia(q.payload));
      }
      // .update(...).select(): como la base real, devuelve las filas cambiadas.
      if (q.select) {
        if (q.single || q.maybeSingle) return { data: copia(tocadas[0] || null), error: null };
        return { data: copia(tocadas), error: null };
      }
      return { data: null, error: null };
    }
    // select
    (window.__N360_LECTURAS = window.__N360_LECTURAS || []).push({ tabla: q.tabla, cols: q.cols || '*', filtros: copia(q.filtros), orden: q.orden || null });
    let filas = filtrar(copia((fx.tablas && fx.tablas[q.tabla]) || []), q.filtros);
    // Relación anidada "productos(...)" (p. ej. combo_items con el stock y costo del producto)
    if (q.cols && /productos\(/.test(q.cols) && fx.tablas && fx.tablas.productos) {
      filas = filas.map((f) => (f.producto_id ? Object.assign(f, { productos: copia(fx.tablas.productos.find((p) => p.id === f.producto_id) || null) }) : f));
    }
    if (q.tabla === 'movimientos_financieros' || q.tabla === 'movimientos_impuestos') {
      filas = filas.length ? filas : [];
    }
    if (q.orden) {
      const [col, asc] = q.orden;
      filas.sort((a, b) => { const x = a[col] == null ? '' : a[col]; const y = b[col] == null ? '' : b[col]; return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
    }
    if (q.limit != null) filas = filas.slice(0, q.limit);
    if (q.count && q.head) return { data: null, count: filas.length, error: null };
    if (q.single || q.maybeSingle) return { data: filas[0] || null, error: null };
    return { data: filas, count: filas.length, error: null };
  }

  function consulta(tabla) {
    const q = { tabla, op: 'select', filtros: [], payload: null };
    let proxy = null;
    const b = {
      select(cols, opts) { if (q.op === 'select') q.cols = cols; else q.select = true; if (opts && opts.count) { q.count = true; q.head = !!opts.head; } return proxy; },
      insert(p) { q.op = 'insert'; q.payload = p; return proxy; },
      upsert(p) { q.op = 'upsert'; q.payload = p; return proxy; },
      update(p) { q.op = 'update'; q.payload = p; return proxy; },
      delete() { q.op = 'delete'; return proxy; },
      eq(c, v) { q.filtros.push(['eq', c, v]); return proxy; },
      neq(c, v) { q.filtros.push(['neq', c, v]); return proxy; },
      in(c, v) { q.filtros.push(['in', c, v]); return proxy; },
      gt(c, v) { q.filtros.push(['gt', c, v]); return proxy; },
      is(c, v) { q.filtros.push(['is', c, v]); return proxy; },
      limit(n) { q.limit = n; return proxy; },
      order(col, opts) { if (!q.orden) q.orden = [col, !(opts && opts.ascending === false)]; return proxy; },
      single() { q.single = true; return proxy; },
      maybeSingle() { q.maybeSingle = true; return proxy; },
      then(ok, mal) { return Promise.resolve(responder(q)).then(ok, mal); },
    };
    // Cualquier otro filtro/modificador (order, gte, lte, like, or, not, range…) se acepta sin efecto.
    proxy = new Proxy(b, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return () => proxy; } });
    return proxy;
  }

  // Funciones del servidor que la web nueva usa para guardar todo junto
  // (como la base real: lo guardado se ve en las lecturas siguientes).
  const INTERNAS = {
    venta_registrar_atomica(a) {
      const t = F().tablas;
      const ahora = () => new Date(Date.now() + (++reloj)).toISOString();
      const vid = nuevoId();
      const uid = F().userId;
      (t.ventas = t.ventas || []).push(Object.assign({ created_at: ahora() }, copia(a.p_venta), { id: vid, auth_user_id: uid }));
      for (const d of a.p_detalles || []) (t.venta_detalles = t.venta_detalles || []).push(Object.assign({ created_at: ahora() }, copia(d), { id: nuevoId(), venta_id: vid, auth_user_id: uid }));
      const caja = [];
      for (const c of a.p_caja || []) {
        if (!(Number(c.monto) > 0)) continue;
        const mid = nuevoId(); caja.push(mid);
        (t.movimientos_financieros = t.movimientos_financieros || []).push(Object.assign({ created_at: ahora() }, copia(c),
          { id: mid, auth_user_id: uid, tipo_flujo: 'INGRESO', tipo_movimiento: 'VENTA', referencia_tipo: 'venta', referencia_id: vid, estado: 'completado',
            monto: Math.round(Number(c.monto) * 100) / 100 }));
      }
      return { venta_id: vid, ya_existia: false, caja_ids: caja, avisos: [] };
    },
    ajustar_stock_relativo(a) { return (a.p_items || []).length; },
  };

  function rpc(nombre, args) {
    const fx = F();
    const entrada = { op: 'rpc', nombre, args: copia(args || {}) };
    registro.push(entrada);
    (window.__N360_LECTURAS = window.__N360_LECTURAS || []).push({ rpc: nombre });
    const r = fx.rpc && fx.rpc[nombre];
    const data = typeof r === 'function' ? r(args) : (r === undefined ? (INTERNAS[nombre] ? INTERNAS[nombre](args) : null) : r);
    if (nombre in INTERNAS) entrada.resultado = copia(data);
    let proxy = null;
    const b = { then(ok, mal) { return Promise.resolve({ data, error: null }).then(ok, mal); } };
    proxy = new Proxy(b, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return () => proxy; } });
    return proxy;
  }

  const sesion = () => ({ user: { id: F().userId, email: F().email || 'prueba@negocio360.test' }, access_token: 'falso' });
  const auth = {
    getSession: async () => ({ data: { session: sesion() }, error: null }),
    getUser: async () => ({ data: { user: sesion().user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    refreshSession: async () => ({ data: { session: sesion() }, error: null }),
  };

  function createClient() {
    const cliente = {
      from: consulta,
      rpc, auth,
      channel() { const ch = { on: () => ch, subscribe: () => ch, unsubscribe() {} }; return ch; },
      removeChannel() {},
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    };
    return cliente;
  }
  window.supabase = { createClient };
})();
