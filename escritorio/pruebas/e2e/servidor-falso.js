// Servidor de Supabase simulado para las pruebas del programa real:
// autenticación mínima, tablas (PostgREST) sobre el motor local con los datos
// de prueba, y las funciones del modo sin conexión (con idempotencia por UUID).
// Se puede "cortar" (cierra cada conexión, como si no hubiera internet).
'use strict';
const http = require('http');
const { crearMotor } = require('../../src/compartido/motor-local');

const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs']);

function valor(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

// ?select=*&activo=eq.true&order=nombre.asc&limit=10  ->  pasos del motor
function pasosDeConsulta(params, cabeceras) {
  const pasos = [];
  for (const [k, v] of params) {
    if (k === 'select') pasos.push(['select', [v]]);
    else if (k === 'order') for (const o of v.split(',')) { const [col, dir] = o.split('.'); pasos.push(['order', [col, { ascending: dir !== 'desc' }]]); }
    else if (k === 'limit') pasos.push(['limit', [Number(v)]]);
    else if (k === 'offset') pasos.push(['range', [Number(v), Number(v) + Number(params.get('limit') || 1e9) - 1]]);
    else if (k === 'or') pasos.push(['or', [v.replace(/^\(|\)$/g, '')]]);
    else if (k === 'columns' || k === 'on_conflict') continue;
    else {
      let op = v.slice(0, v.indexOf('.')); let resto = v.slice(v.indexOf('.') + 1);
      let negar = false;
      if (op === 'not') { negar = true; op = resto.slice(0, resto.indexOf('.')); resto = resto.slice(resto.indexOf('.') + 1); }
      if (!OPS.has(op)) continue;
      const arg = op === 'in' ? resto.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')) : valor(resto);
      pasos.push(negar ? ['not', [k, op, arg]] : [op === 'cs' ? 'contains' : op, [k, arg]]);
    }
  }
  const rango = cabeceras.range && cabeceras.range.match(/(\d+)-(\d+)/);
  if (rango) pasos.push(['range', [Number(rango[1]), Number(rango[2])]]);
  return pasos;
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Token con la forma real (el programa lee la cuenta del token).
function tokenPara(usuario, segundos = 3600) {
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: usuario.id, email: usuario.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + segundos })}.firma`;
}

function crearServidorFalso({ tablas, usuario }) {
  const motor = crearMotor(tablas);
  const estado = {
    cortado: false, habilitado: true, cortarDespuesDeGuardar: false, renovaciones: 0, siguienteBloque: 1000, siguienteNumero: 900,
    ventas: new Map(), llamadas: [], escriturasDirectas: [],
  };
  const sockets = new Set();

  function sesion() {
    estado.renovaciones++;
    return { access_token: tokenPara(usuario), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: usuario };
  }

  const rpc = {
    generar_numero_venta: () => `V-${String(estado.siguienteNumero++).padStart(6, '0')}`,
    generar_numero_garantia: () => 'GT-000001',
    offline_estado: () => (estado.habilitado ? { habilitado: true, tamano_bloque: 50 } : { habilitado: false }),
    offline_registrar_dispositivo: (a) => ({ dispositivo_id: 'disp-1', activo: true, uid: a.p_dispositivo_uid }),
    offline_reservar_numeros: () => { const d = estado.siguienteBloque; estado.siguienteBloque += 50; return { desde: d, hasta: d + 49, prefijo: 'V-', digitos: 6 }; },
    offline_registrar_venta: (a) => {
      const p = a.p;
      if (estado.ventas.has(p.uuid)) return { ...estado.ventas.get(p.uuid).respuesta, repetida: true };
      if (estado.cortarDespuesDeGuardar) { estado.cortarDespuesDeGuardar = false; estado.cortarRespuesta = true; }
      const respuesta = { ok: true, venta_id: `srv-${estado.ventas.size + 1}`, numero_venta: p.venta.numero_venta, numero_reemplazado: false, alertas: [], repetida: false };
      estado.ventas.set(p.uuid, { payload: p, respuesta });
      // Como el servidor real: resta el stock vendido.
      for (const d of p.detalles || []) {
        const prod = d.producto_id && motor.buscar('productos', d.producto_id);
        if (prod && prod.tipo !== 'servicio') prod.stock_actual = Number(prod.stock_actual) - Number(d.cantidad);
      }
      return respuesta;
    },
    listar_perfiles_del_grupo_v2: () => [],
    obtener_stock_compartido_config: () => null,
    ventas_sin_movimiento_caja: () => [],
  };

  function responder(res, status, cuerpo, extra = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...extra });
    res.end(cuerpo === undefined ? '' : JSON.stringify(cuerpo));
  }

  const servidor = http.createServer((req, res) => {
    if (estado.cortado) { req.socket.destroy(); return; }
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'apikey, authorization, content-type, prefer, range, x-client-info, accept-profile, content-profile, x-supabase-api-version, accept',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'access-control-expose-headers': 'content-range',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const datos = cuerpo ? JSON.parse(cuerpo) : null;
      estado.llamadas.push({ metodo: req.method, ruta: u.pathname, datos });
      if (u.pathname === '/auth/v1/health') return responder(res, 200, { ok: true }, cors);
      if (u.pathname === '/auth/v1/user') return responder(res, 200, usuario, cors);
      if (u.pathname === '/auth/v1/token') return responder(res, 200, sesion(), cors);
      if (u.pathname === '/auth/v1/logout') return responder(res, 204, undefined, cors);
      const mRpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      if (mRpc) {
        const fn = rpc[mRpc[1]];
        const salida = fn ? fn(datos || {}) : null;
        // Corte justo después de que el servidor guardó: la respuesta nunca llega.
        if (estado.cortarRespuesta) { estado.cortarRespuesta = false; req.socket.destroy(); return undefined; }
        return responder(res, 200, salida, cors);
      }
      const mTabla = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
      if (mTabla) {
        const tabla = mTabla[1];
        const pasos = pasosDeConsulta(u.searchParams, req.headers);
        const prefer = String(req.headers.prefer || '');
        const unaFila = /vnd\.pgrst\.object/.test(String(req.headers.accept || ''));
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          estado.escriturasDirectas.push({ metodo: req.method, tabla, datos });
          const op = req.method === 'POST' ? (/resolution=merge/.test(prefer) ? 'upsert' : 'insert') : req.method === 'PATCH' ? 'update' : 'delete';
          const filtros = pasos.filter(([m]) => m !== 'select');
          const r = motor.ejecutar(tabla, [[op, [datos]], ...filtros, ...(/return=representation/.test(prefer) ? [['select', ['*']]] : [])]);
          if (!/return=representation/.test(prefer)) return responder(res, op === 'insert' ? 201 : 204, undefined, cors);
          return responder(res, 201, unaFila ? (r.data || [])[0] : r.data, cors);
        }
        const r = motor.ejecutar(tabla, [...pasos, ...(/count=exact/.test(prefer) ? [['select', ['*', { count: 'exact' }]]] : [])]);
        const total = r.count != null ? r.count : (r.data || []).length;
        const rango = { 'content-range': `0-${Math.max(0, (r.data || []).length - 1)}/${total}` };
        if (unaFila) {
          if (!r.data || r.data.length !== 1) return responder(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, cors);
          return responder(res, 200, r.data[0], { ...cors, ...rango });
        }
        return responder(res, 200, r.data, { ...cors, ...rango });
      }
      return responder(res, 404, { message: 'no existe' }, cors);
    });
  });
  servidor.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  return {
    estado, motor, servidor,
    escuchar: () => new Promise((r) => servidor.listen(0, '127.0.0.1', () => r(servidor.address().port))),
    cortar() { estado.cortado = true; for (const s of sockets) s.destroy(); },
    restablecer() { estado.cortado = false; },
    cerrar: () => new Promise((r) => { for (const s of sockets) s.destroy(); servidor.close(() => r()); }),
  };
}

module.exports = { crearServidorFalso, pasosDeConsulta, tokenPara };
