'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { abrirBase } = require('../../src/main/base-local');
const { crearSincronizador, leerToken } = require('../../src/main/sincronizador');

const U = 'b699660c-b808-4f0a-9b24-d0df60a92e83';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (sub, exp = 9999999999) => `${b64({ alg: 'HS256' })}.${b64({ sub, exp, email: 'x@y.z' })}.firma`;

// Servidor falso: responde como PostgREST.
function servidor(opciones = {}) {
  const llamadas = [];
  const recibidas = new Map();
  let siguiente = 458;
  const s = {
    llamadas, recibidas, caido: false, habilitado: true,
    fallarVenta: null, // código N360_OFFLINE a devolver
    async fetch(url, init) {
      const funcion = url.split('/rpc/')[1];
      const cuerpo = JSON.parse(init.body);
      llamadas.push({ funcion, cuerpo, auth: init.headers.Authorization });
      if (s.caido) throw new TypeError('fetch failed');
      const resp = (status, obj) => ({ status, text: async () => JSON.stringify(obj) });
      if (init.headers.Authorization.includes('vencido')) return resp(401, { message: 'JWT expired' });
      if (funcion === 'offline_estado') return resp(200, s.habilitado ? { habilitado: true, tamano_bloque: 50 } : { habilitado: false });
      if (funcion === 'offline_registrar_dispositivo') return resp(200, { dispositivo_id: 'd1', activo: true });
      if (funcion === 'offline_reservar_numeros') { const d = siguiente; siguiente += 50; return resp(200, { desde: d, hasta: d + 49, prefijo: 'V-', digitos: 6 }); }
      if (funcion === 'offline_registrar_venta') {
        if (s.fallarVenta) return resp(400, { code: 'P0001', message: `N360_OFFLINE:${s.fallarVenta}` });
        if (opciones.cortarDespuesDeGuardar && !recibidas.has(cuerpo.p.uuid)) { recibidas.set(cuerpo.p.uuid, cuerpo.p); throw new TypeError('se cortó'); }
        const repetida = recibidas.has(cuerpo.p.uuid);
        recibidas.set(cuerpo.p.uuid, cuerpo.p);
        return resp(200, { ok: true, venta_id: 'srv-' + cuerpo.p.uuid.slice(0, 4), numero_venta: cuerpo.p.venta.numero_venta, repetida, alertas: [] });
      }
      return resp(404, { message: 'no existe' });
    },
  };
  return s;
}

function preparar(opciones) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-sinc-'));
  const base = abrirBase(path.join(dir, 'local.db'));
  const srv = servidor(opciones);
  const eventos = [];
  let pendientes = null;
  const sinc = crearSincronizador({
    base, fetch: srv.fetch, url: 'https://srv', clave: 'k', dispositivo: { nombre: 'Caja 1' },
    avisar: (e) => eventos.push(e), fijarPendientes: (n) => { pendientes = n; },
    reloj: { setTimeout: () => null, clearTimeout: () => {}, ahora: () => Date.now() },
  });
  const venta = () => {
    const uuid = crypto.randomUUID();
    base.ventaGuardar(U, { uuid, numero: 'V-000458', total: 10, payload: { version: 1, uuid, venta: { numero_venta: 'V-000458' } } });
    return uuid;
  };
  return { base, srv, sinc, eventos, venta, pendientes: () => pendientes };
}

test('leerToken lee la cuenta del token', () => {
  assert.strictEqual(leerToken(token(U)).sub, U);
  assert.strictEqual(leerToken('basura'), null);
});

test('no acepta una sesión cuyo token es de otra cuenta', () => {
  const { sinc } = preparar();
  assert.strictEqual(sinc.fijarSesion({ access_token: token('otra'), user_id: U }).ok, false);
  assert.strictEqual(sinc.cuenta(), null);
});

test('sube en orden, registra el equipo y aparta números', async () => {
  const { sinc, srv, venta, base, eventos, pendientes } = preparar();
  const a = venta(); const b = venta();
  sinc.fijarSesion({ access_token: token(U), user_id: U });
  const r = await sinc.subirAhora();
  assert.deepStrictEqual(r.subidas.map((x) => x.uuid), [a, b]);
  assert.deepStrictEqual(srv.llamadas.map((l) => l.funcion), ['offline_estado', 'offline_registrar_dispositivo', 'offline_registrar_venta', 'offline_registrar_venta', 'offline_reservar_numeros']);
  assert.ok(srv.llamadas[2].cuerpo.p.reloj_envio);
  assert.strictEqual(base.numerosLibres(U), 50);
  assert.strictEqual(base.contar(U).subidas, 2);
  assert.strictEqual(pendientes(), 0);
  assert.ok(eventos.some((e) => e.tipo === 'subidas' && e.subidas.length === 2));
  // segunda vuelta: ya no repite comprobaciones ni pide más números
  srv.llamadas.length = 0;
  await sinc.subirAhora();
  assert.deepStrictEqual(srv.llamadas, []);
});

test('sin red: la venta queda pendiente; al volver se sube', async () => {
  const { sinc, srv, venta, base } = preparar();
  venta();
  sinc.fijarSesion({ access_token: token(U), user_id: U });
  srv.caido = true;
  const r = await sinc.subirAhora();
  assert.strictEqual(r.hecho, false);
  assert.strictEqual(base.contar(U).pendientes, 1);
  assert.match(sinc.obtener().ultimo_error, /conexión/);
  srv.caido = false;
  await sinc.subirAhora();
  assert.strictEqual(base.contar(U).pendientes, 0);
});

test('corte justo después de que el servidor guardó: reintentar no duplica', async () => {
  const { sinc, srv, venta, base } = preparar({ cortarDespuesDeGuardar: true });
  const a = venta();
  sinc.fijarSesion({ access_token: token(U), user_id: U });
  await sinc.subirAhora();
  assert.strictEqual(base.contar(U).pendientes, 1);
  await sinc.subirAhora();
  assert.strictEqual(base.contar(U).subidas, 1);
  assert.strictEqual(srv.recibidas.size, 1);
  assert.strictEqual(base.ventasListar(U, { estados: ['subida'] })[0].resultado.repetida, true);
  assert.strictEqual(base.ventasListar(U)[0].uuid, a);
});

test('error de contenido: esa venta queda con error y las demás siguen', async () => {
  const { sinc, srv, venta, base } = preparar();
  venta();
  sinc.fijarSesion({ access_token: token(U), user_id: U });
  srv.fallarVenta = 'linea_invalida';
  await sinc.subirAhora();
  assert.strictEqual(base.contar(U).errores, 1);
  srv.fallarVenta = null;
  venta();
  await sinc.subirAhora();
  assert.deepStrictEqual([base.contar(U).errores, base.contar(U).subidas], [1, 1]);
});

test('sesión vencida: no sube y espera un token nuevo', async () => {
  const { sinc, srv, venta, base } = preparar();
  venta();
  sinc.fijarSesion({ access_token: token(U, 1), user_id: U }); // ya expiró
  await sinc.subirAhora();
  assert.strictEqual(srv.llamadas.length, 0);
  sinc.fijarSesion({ access_token: token(U) + 'vencido', user_id: U }); // el servidor lo rechaza
  await sinc.subirAhora();
  assert.strictEqual(sinc.obtener().sesion_valida, false);
  assert.strictEqual(base.contar(U).pendientes, 1);
  sinc.fijarSesion({ access_token: token(U), user_id: U });
  await sinc.subirAhora();
  assert.strictEqual(base.contar(U).subidas, 1);
});

test('cuenta sin el modo: no sube nada ni registra el equipo', async () => {
  const { sinc, srv, venta, base } = preparar();
  venta();
  srv.habilitado = false;
  sinc.fijarSesion({ access_token: token(U), user_id: U });
  await sinc.subirAhora();
  assert.deepStrictEqual(srv.llamadas.map((l) => l.funcion), ['offline_estado']);
  assert.strictEqual(base.contar(U).pendientes, 1);
  assert.strictEqual(sinc.obtener().habilitado, false);
});

test('cerrar sesión: deja de subir; lo pendiente se queda en el equipo', async () => {
  const { sinc, srv, venta, base } = preparar();
  venta();
  sinc.fijarSesion(null);
  await sinc.subirAhora();
  assert.strictEqual(srv.llamadas.length, 0);
  assert.strictEqual(base.totalSinSubir(), 1);
});
