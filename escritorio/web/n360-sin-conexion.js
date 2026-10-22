/* Negocio360 Escritorio — modo sin conexión (solo dentro del programa).
 *
 * Se carga justo después de la librería de Supabase en todas las páginas
 * empaquetadas. Cambia window.supabase.createClient para que cada página
 * reciba un cliente "doble":
 *   - con internet: todo va al servidor exactamente como en la web;
 *   - sin internet (solo cuentas con el modo activado): las LECTURAS se
 *     responden con la copia del catálogo guardada en el equipo;
 *   - mientras se "graba" una venta (n360-ventas-sin-conexion.js): nada va al
 *     servidor; cada escritura se anota y se aplica en la copia local, para
 *     luego guardarla completa en la bandeja del equipo.
 * Además: la sesión guardada sirve sin internet, el número de venta sale del
 * bloque apartado por el equipo y los códigos de perfil se verifican en el
 * equipo cuando no hay conexión.
 */
(function () {
  'use strict';
  const API = window.negocio360SinConexion;
  const ESC = window.negocio360Escritorio;
  if (!API || !ESC || !window.supabase || typeof window.supabase.createClient !== 'function' || window.N360SinConexion) return;
  if (!window.N360MotorLocal) { console.warn('N360: falta el motor local'); return; }

  const CLAVE_SESION_PREFIJO = 'sb-';
  const crearOriginal = window.supabase.createClient.bind(window.supabase);
  const OPS = new Set(['insert', 'upsert', 'update', 'delete']);
  const METODOS = ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf', 'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt',
    'rangeLte', 'rangeAdjacent', 'overlaps', 'textSearch', 'match', 'not', 'or', 'filter', 'order', 'limit', 'range', 'abortSignal',
    'single', 'maybeSingle', 'csv', 'geojson', 'explain', 'rollback', 'returns', 'throwOnError', 'setHeader', 'overrideTypes'];

  // Tablas que se copian al equipo: lo que leen Ventas y el guardia de perfiles.
  // reciente: solo los últimos días (por tamaño); ultimos: solo las N más nuevas.
  const TABLAS = {
    productos: {}, clientes: {}, metodos_pago: {}, bancos: {}, impuestos: {}, combos: {}, combo_items: {},
    combo_precios_escala: {}, precios_escala: {}, promociones: {}, promocion_productos: {}, producto_lotes: {},
    producto_presentaciones: {}, unidades_medida: {}, configuracion_empresa: {}, configuracion_venta_rapida: {},
    usuarios: {}, administradores: {}, sucursales: {}, stock_compartido_usuario: {}, catalogo_suscripciones: {},
    tutoriales_videos: {}, tutoriales_vistos: {},
    ventas: { reciente: 62, col: 'fecha', max: 6000 },
    venta_detalles: { reciente: 62, col: 'created_at', max: 20000 },
    devoluciones_venta: { reciente: 62, col: 'created_at', max: 2000 },
    movimientos_financieros: { ultimos: 300 },
    movimientos_impuestos: { ultimos: 300 },
  };
  const MAX_FILAS = 20000;
  const PAGINA = 1000;
  // Mientras se graba una venta, estas escrituras no son parte de la venta
  // (latido de presencia, tutoriales vistos): siguen su camino normal.
  const LIBRES_AL_GRABAR = new Set(['usuarios', 'tutoriales_vistos', 'notificaciones_leidas']);
  // Escrituras que una venta sin conexión no puede hacer.
  const BLOQUEADAS_AL_GRABAR = new Set(['fiados', 'creditos', 'farmacia_recetas', 'vet_consultas', 'vet_estancias',
    'transporte_ordenes', 'numeros_serie', 'proformas', 'pagos_clientes_recurrentes', 'impuestos', 'bancos']);
  // Funciones del servidor que, sin conexión, simplemente no hacen nada.
  const RPC_SILENCIOSAS = { actualizar_ultima_conexion: null, asegurar_impuestos_base: null, ventas_sin_movimiento_caja: [], admin_asegurar_principal: null };
  const RPC_GUARDADAS = new Set(['listar_perfiles_del_grupo_v2', 'listar_perfiles_del_grupo', 'obtener_stock_compartido_config']);

  let conexion = 'verificando';
  let estado = { habilitado: false, cuenta: null };
  let motorPromesa = null;
  let urlServidor = null;
  let interno = null;
  const oyentes = new Set();
  const grab = { activa: false, registro: [], bloqueos: [], actividad: 0, ultima: 0, insertadas: [], deltas: [] };

  const copia = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const enLinea = () => conexion !== 'sin_conexion';
  const usarLocal = () => !!(estado.habilitado && estado.cuenta);
  const respuesta = (data, extra) => Object.assign({ data, error: null, count: null, status: 200, statusText: 'OK' }, extra || {});
  const sinConexion = (msg) => ({ data: null, error: { message: msg || 'Sin conexión a internet', code: 'N360_SIN_CONEXION', details: null, hint: null }, count: null, status: 0, statusText: '' });
  const esFallaDeRed = (r) => r && r.status === 0;

  // ---------- sesión ----------
  function claveSesion() {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CLAVE_SESION_PREFIJO) && k.endsWith('-auth-token')) return k;
    }
    return null;
  }
  function sesionGuardada() {
    try {
      const k = claveSesion();
      const s = k ? JSON.parse(localStorage.getItem(k)) : null;
      const sesion = s && (s.currentSession || s);
      return sesion && sesion.access_token && sesion.user ? sesion : null;
    } catch (_) { return null; }
  }
  let ultimoToken = null;
  async function enviarSesion() {
    const s = sesionGuardada();
    const token = s ? s.access_token : null;
    if (token === ultimoToken) return;
    ultimoToken = token;
    try {
      await API.fijarSesion(s ? { access_token: s.access_token, user_id: s.user.id, email: s.user.email || null } : null);
      await refrescarEstado();
    } catch (e) { console.warn('N360 sesión:', e); }
  }
  async function refrescarEstado() {
    try { estado = (await API.estado()) || estado; } catch (_) { /* nada */ }
    return estado;
  }

  const listo = (async () => {
    try { const c = await ESC.estadoConexion(); if (c) conexion = c.conexion; } catch (_) { /* nada */ }
    await enviarSesion();
    if (!ultimoToken) await refrescarEstado();
  })();

  ESC.alCambiarConexion((c) => {
    const antes = conexion;
    conexion = c.conexion;
    if (antes !== conexion) for (const fn of oyentes) { try { fn({ tipo: 'conexion', conexion }); } catch (_) { /* nada */ } }
  });
  API.alCambiar((ev) => {
    if (ev && ev.tipo === 'estado' && ev.estado) estado = ev.estado;
    if (ev && ev.tipo === 'subidas') sincronizarCatalogo({ forzar: true, tablas: ['productos', 'producto_lotes', 'clientes', 'ventas', 'venta_detalles', 'movimientos_financieros', 'movimientos_impuestos'] }).catch(() => {});
    for (const fn of oyentes) { try { fn(ev); } catch (_) { /* nada */ } }
  });
  setInterval(enviarSesion, 20000);
  window.addEventListener('storage', (e) => { if (e.key && e.key.endsWith('-auth-token')) enviarSesion(); });

  // ---------- copia local en memoria ----------
  function motor() {
    if (!motorPromesa) {
      motorPromesa = (async () => {
        await listo;
        const tablas = usarLocal() ? await API.catalogoLeer(Object.keys(TABLAS)) : {};
        return window.N360MotorLocal.crearMotor(tablas || {}, { nuevoId: uuid });
      })();
      motorPromesa.catch(() => { motorPromesa = null; });
    }
    return motorPromesa;
  }
  function olvidarMotor() { if (!grab.activa) motorPromesa = null; }

  // Descarga del servidor las tablas que se usan sin conexión.
  let sincronizando = null;
  async function sincronizarCatalogo({ forzar = false, tablas = null } = {}) {
    await listo;
    if (!usarLocal() || !enLinea() || !interno) return { hecho: false };
    if (sincronizando) return sincronizando;
    sincronizando = (async () => {
      const info = await API.catalogoInfo();
      const viejas = new Map((info || []).map((t) => [t.tabla, t.actualizado]));
      const lista = (tablas || Object.keys(TABLAS)).filter((t) => forzar || !viejas.has(t) || Date.now() - viejas.get(t) > 120000);
      const resultado = {};
      for (const t of lista) {
        const cfg = TABLAS[t];
        if (!cfg) continue;
        try {
          const filas = [];
          const max = cfg.ultimos || cfg.max || MAX_FILAS;
          for (let desde = 0; desde < max; desde += PAGINA) {
            let q = interno.from(t).select('*');
            if (cfg.reciente) {
              const d = new Date(Date.now() - cfg.reciente * 864e5);
              q = q.gte(cfg.col, d.toISOString().slice(0, 10)).order(cfg.col, { ascending: false });
            } else if (cfg.ultimos) q = q.order('created_at', { ascending: false });
            const { data, error } = await q.range(desde, Math.min(desde + PAGINA, max) - 1);
            if (error) throw error;
            filas.push(...(data || []));
            if (!data || data.length < PAGINA) break;
          }
          await API.catalogoReemplazar(t, filas);
          resultado[t] = filas.length;
        } catch (e) { resultado[t] = 'error'; console.warn('N360 copia de', t, e && e.message); }
      }
      olvidarMotor();
      return { hecho: true, tablas: resultado };
    })();
    try { return await sincronizando; } finally { sincronizando = null; }
  }

  // ---------- consultas ----------
  function reproducir(base, pasos) {
    let q = base;
    for (const [m, a] of pasos) q = q[m](...a);
    return q;
  }
  function crearConsulta(ejecutar) {
    const pasos = [];
    let promesa = null;
    const qb = {};
    for (const m of METODOS) qb[m] = function (...a) { pasos.push([m, a]); return qb; };
    qb.then = (ok, mal) => (promesa || (promesa = Promise.resolve().then(() => ejecutar(pasos)))).then(ok, mal);
    qb.catch = (mal) => qb.then(undefined, mal);
    qb.finally = (f) => qb.then((v) => { f(); return v; }, (e) => { f(); throw e; });
    // Cualquier método nuevo de la librería: se anota igual.
    return new Proxy(qb, {
      get(t, k) {
        if (k in t || typeof k === 'symbol') return t[k];
        return function (...a) { pasos.push([k, a]); return t; };
      },
    });
  }

  async function local(tabla, pasos) {
    const m = await motor();
    return m.ejecutar(tabla, pasos);
  }

  async function consultaNormal(real, tabla, pasos) {
    await listo;
    const op = (pasos.find(([m]) => OPS.has(m)) || ['select'])[0];
    if (grab.activa) return consultaGrabada(real, tabla, pasos, op);
    if (op !== 'select') return reproducir(real.from(tabla), pasos);
    if (!enLinea() && usarLocal()) return local(tabla, pasos);
    let r;
    try { r = await reproducir(real.from(tabla), pasos); } catch (e) {
      if (usarLocal() && /fetch|network|tiempo|abort/i.test(String(e && (e.message || e.name)))) return local(tabla, pasos);
      throw e;
    }
    if (esFallaDeRed(r) && usarLocal()) return local(tabla, pasos);
    return r;
  }

  // ---------- grabación de una venta ----------
  function registrarActividad(fn) {
    grab.actividad++;
    return Promise.resolve().then(fn).finally(() => { grab.actividad--; grab.ultima = Date.now(); });
  }

  function consultaGrabada(real, tabla, pasos, op) {
    return registrarActividad(async () => {
      const m = await motor();
      if (op === 'select') return m.ejecutar(tabla, pasos);
      if (LIBRES_AL_GRABAR.has(tabla)) return enLinea() ? reproducir(real.from(tabla), pasos) : respuesta(null);
      const valores = (pasos.find(([x]) => x === op) || [, []])[1][0];
      if (BLOQUEADAS_AL_GRABAR.has(tabla) || (tabla === 'clientes' && op !== 'update') || op === 'delete') {
        grab.bloqueos.push(`${op} ${tabla}`);
        return { data: null, error: { message: 'Esto necesita conexión a internet.', code: 'N360_SIN_CONEXION' }, count: null, status: 400, statusText: '' };
      }
      const antes = new Map(m.filas(tabla).map((f) => [String(f.id), Object.assign({}, f)]));
      const r = m.ejecutar(tabla, pasos);
      const despues = m.filas(tabla);
      const nuevas = despues.filter((f) => !antes.has(String(f.id)));
      for (const f of nuevas) grab.insertadas.push({ tabla, id: String(f.id) });
      if (op === 'update' && valores && typeof valores === 'object') {
        for (const f of despues) {
          const previo = antes.get(String(f.id));
          if (!previo || grab.insertadas.some((x) => x.tabla === tabla && x.id === String(f.id))) continue;
          for (const campo of Object.keys(valores)) {
            const a = Number(previo[campo]); const b = Number(f[campo]);
            if (previo[campo] != null && Number.isFinite(a) && Number.isFinite(b) && a !== b && typeof previo[campo] !== 'boolean') {
              grab.deltas.push({ tabla, id: String(f.id), campo, delta: Math.round((b - a) * 1e6) / 1e6 });
            }
          }
        }
      }
      grab.registro.push({ op, tabla, payload: copia(valores), ids: nuevas.map((f) => String(f.id)) });
      return r;
    });
  }

  async function rpcGrabada(real, nombre, args) {
    return registrarActividad(async () => {
      if (nombre === 'generar_numero_venta') {
        const n = await API.numeroTomar();
        grab.registro.push({ op: 'rpc', nombre, args: copia(args || {}) });
        return respuesta(n || `V-TMP-${Date.now()}`);
      }
      if (nombre === 'generar_numero_garantia') { grab.registro.push({ op: 'rpc', nombre, args: copia(args || {}) }); return respuesta('GT-PENDIENTE'); }
      if (nombre === 'descontar_stock_remoto') {
        grab.bloqueos.push('stock de otra sucursal');
        return { data: null, error: { message: 'El stock de otras sucursales necesita conexión.', code: 'N360_SIN_CONEXION' }, count: null, status: 400, statusText: '' };
      }
      if (RPC_GUARDADAS.has(nombre) || nombre === 'admin_verificar_codigo') return rpcNormalSinGrabar(real, nombre, args);
      grab.registro.push({ op: 'rpc', nombre, args: copia(args || {}) });
      return respuesta(null);
    });
  }

  // fn: la confirmación real de ventas.js. Devuelve lo que intentó escribir.
  async function grabar(fn) {
    await listo;
    if (grab.activa) throw new Error('Ya se está guardando otra venta.');
    await motor();
    Object.assign(grab, { activa: true, registro: [], bloqueos: [], insertadas: [], deltas: [], actividad: 0, ultima: Date.now() });
    let error = null;
    try { await fn(); } catch (e) { error = e; }
    // Esperar a que terminen las escrituras "de fondo" (bitácora, garantías…).
    const limite = Date.now() + 8000;
    while ((grab.actividad > 0 || Date.now() - grab.ultima < 400) && Date.now() < limite) await dormir(50);
    const m = await motor();
    const tablasCopiadas = new Set(Object.keys(TABLAS));
    const filasLocales = grab.insertadas.filter((x) => tablasCopiadas.has(x.tabla))
      .map((x) => ({ tabla: x.tabla, fila: copia(m.buscar(x.tabla, x.id)) })).filter((x) => x.fila);
    const salida = { registro: grab.registro, bloqueos: [...new Set(grab.bloqueos)], filasLocales, deltas: grab.deltas, error };
    grab.activa = false;
    return salida;
  }
  // Una grabación que no se guardó: la copia en memoria vuelve a leerse del equipo.
  function descartarGrabacion() { motorPromesa = null; }

  // ---------- funciones del servidor ----------
  async function rpcNormalSinGrabar(real, nombre, args, opciones, pasos = []) {
    const llamarReal = () => reproducir(real.rpc(nombre, args, opciones), pasos);
    const offline = async () => {
      if (RPC_GUARDADAS.has(nombre)) {
        if (nombre === 'obtener_stock_compartido_config') return respuesta(null); // sin conexión: desactivado
        const g = await API.rpcLeer(nombre);
        return g ? respuesta(g.datos) : sinConexion();
      }
      if (nombre === 'admin_verificar_codigo') return respuesta(await API.pinVerificar((args || {}).p_pin, (args || {}).p_perfil_id || null));
      if (nombre === 'generar_numero_venta') return respuesta((await API.numeroTomar()) || `V-TMP-${Date.now()}`);
      if (Object.prototype.hasOwnProperty.call(RPC_SILENCIOSAS, nombre)) return respuesta(copia(RPC_SILENCIOSAS[nombre]));
      return sinConexion();
    };
    if (!usarLocal()) return llamarReal();
    if (nombre === 'generar_numero_venta') {
      const n = await API.numeroTomar();
      if (n) return respuesta(n);
    }
    if (!enLinea()) return offline();
    let r;
    try { r = await llamarReal(); } catch (e) { return offline(); }
    if (esFallaDeRed(r)) return offline();
    if (!r.error && RPC_GUARDADAS.has(nombre)) API.rpcGuardar(nombre, r.data).catch(() => {});
    if (!r.error && nombre === 'admin_verificar_codigo' && r.data && r.data.ok && r.data.perfil_id) {
      API.pinGuardar({ perfil_id: r.data.perfil_id, pin: (args || {}).p_pin, nombre: r.data.nombre || null, principal: !!r.data.principal }).catch(() => {});
    }
    return r;
  }

  // ---------- autenticación ----------
  function envolverAuth(real) {
    const auth = real.auth;
    async function getSession() {
      await listo;
      const s = sesionGuardada();
      const puede = s && usarLocal() && estado.cuenta === s.user.id;
      if (!puede) return auth.getSession();
      const vigente = s.expires_at && s.expires_at * 1000 > Date.now() + 60000;
      if (vigente) return auth.getSession();
      if (!enLinea()) return { data: { session: s }, error: null };
      // Vencida y con internet dudoso: no esperar los reintentos largos de la librería.
      const r = await Promise.race([auth.getSession().catch((e) => ({ data: { session: null }, error: e })), dormir(5000).then(() => null)]);
      if (r && r.data && r.data.session) return r;
      if (!r || (r.error && /fetch|network|retry/i.test(String(r.error.name || r.error.message)))) return { data: { session: sesionGuardada() || s }, error: null };
      return r;
    }
    async function getUser(jwt) {
      await listo;
      const s = sesionGuardada();
      const puede = s && usarLocal() && estado.cuenta === s.user.id;
      if (puede && !enLinea()) return { data: { user: s.user }, error: null };
      const r = await auth.getUser(jwt).catch((e) => ({ data: { user: null }, error: e }));
      if (puede && r.error && /fetch|network|retry/i.test(String(r.error.name || r.error.message))) return { data: { user: s.user }, error: null };
      return r;
    }
    try {
      auth.onAuthStateChange((evento) => { if (/SIGNED_IN|TOKEN_REFRESHED|SIGNED_OUT|USER_UPDATED/.test(evento)) setTimeout(enviarSesion, 0); });
    } catch (_) { /* nada */ }
    return new Proxy(auth, {
      get(t, k) {
        if (k === 'getSession') return getSession;
        if (k === 'getUser') return getUser;
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  // fetch con tiempo máximo para las LECTURAS (sin internet real no se queda colgado).
  function fetchConLimite(fetchBase) {
    const f = fetchBase || window.fetch.bind(window);
    return (entrada, init = {}) => {
      const metodo = String(init.method || 'GET').toUpperCase();
      const url = String(entrada && entrada.url ? entrada.url : entrada);
      if (metodo !== 'GET' || !/\/rest\/v1\//.test(url) || init.signal) return f(entrada, init);
      return f(entrada, Object.assign({}, init, { signal: AbortSignal.timeout(15000) }));
    };
  }

  function crearDoble(url, clave, opciones) {
    const opts = Object.assign({}, opciones || {});
    opts.global = Object.assign({}, opts.global || {}, { fetch: fetchConLimite(opts.global && opts.global.fetch) });
    const real = crearOriginal(url, clave, opts);
    if (!interno) {
      urlServidor = url;
      interno = crearOriginal(url, clave, { auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false }, global: { fetch: fetchConLimite() } });
    }
    const auth = envolverAuth(real);
    const doble = {
      from: (tabla) => crearConsulta((pasos) => consultaNormal(real, tabla, pasos)),
      rpc: (nombre, args, opciones2) => crearConsulta(async (pasos) => {
        await listo;
        if (grab.activa) return rpcGrabada(real, nombre, args);
        return rpcNormalSinGrabar(real, nombre, args, opciones2, pasos);
      }),
      auth,
    };
    return new Proxy(doble, {
      get(t, k) {
        if (k in t) return t[k];
        const v = real[k];
        return typeof v === 'function' ? v.bind(real) : v;
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  }

  window.supabase.createClient = function (url, clave, opciones) {
    try { return crearDoble(url, clave, opciones); } catch (e) {
      console.warn('N360: cliente normal', e);
      return crearOriginal(url, clave, opciones);
    }
  };

  window.N360SinConexion = {
    listo,
    enLinea,
    disponible: usarLocal,
    estado: () => estado,
    refrescarEstado,
    conexion: () => conexion,
    grabar,
    descartarGrabacion,
    uuid,
    sincronizarCatalogo,
    alCambiar(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
    api: API,
    get servidor() { return urlServidor; },
  };

  // Copia del catálogo al abrir una página que funciona sin conexión.
  window.addEventListener('load', () => {
    if (document.documentElement.getAttribute('data-n360-sin-conexion') !== 'permitido') return;
    setTimeout(() => { sincronizarCatalogo().catch(() => {}); }, 2500);
  });
})();
