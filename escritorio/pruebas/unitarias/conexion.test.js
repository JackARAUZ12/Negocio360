'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { crearMonitor, crearComprobador } = require('../../src/main/conexion');

function relojFalso() {
  let t = 0; const tareas = [];
  return {
    setTimeout: (fn, ms) => { const x = { fn, en: t + ms }; tareas.push(x); return x; },
    clearTimeout: (x) => { const i = tareas.indexOf(x); if (i >= 0) tareas.splice(i, 1); },
    ahora: () => t,
    tareas,
  };
}

test('🟢 cuando el servidor responde rápido', async () => {
  const cambios = [];
  const m = crearMonitor({ comprobar: async () => ({ ok: true, ms: 100 }), alCambiar: (e) => cambios.push(e.visible), reloj: relojFalso() });
  await m.iniciar();
  assert.strictEqual(m.obtener().visible, 'en_linea');
  assert.deepStrictEqual(cambios, ['en_linea']);
});

test('una falla = 🟠, dos seguidas = 🔴, y vuelve a 🟢', async () => {
  const respuestas = [{ ok: false }, { ok: false }, { ok: true, ms: 50 }];
  const vistos = [];
  const m = crearMonitor({ comprobar: async () => respuestas.shift(), alCambiar: (e) => vistos.push(e.visible), reloj: relojFalso() });
  await m.iniciar();
  assert.strictEqual(m.obtener().visible, 'inestable');
  await m.revisarAhora();
  assert.strictEqual(m.obtener().visible, 'sin_conexion');
  await m.revisarAhora();
  assert.strictEqual(m.obtener().visible, 'en_linea');
  assert.deepStrictEqual(vistos, ['inestable', 'sin_conexion', 'en_linea']);
});

test('sin red en el equipo = 🔴 de inmediato, sin preguntar al servidor', async () => {
  let preguntas = 0;
  const m = crearMonitor({ comprobar: async () => { preguntas++; return { ok: true, ms: 1 }; }, hayRed: () => false, reloj: relojFalso() });
  await m.iniciar();
  assert.strictEqual(m.obtener().conexion, 'sin_conexion');
  assert.strictEqual(preguntas, 0);
});

test('lento = 🟠; error lanzado = falla', async () => {
  const m = crearMonitor({ comprobar: async () => ({ ok: true, ms: 5000 }), reloj: relojFalso() });
  await m.iniciar();
  assert.strictEqual(m.obtener().visible, 'inestable');
  const m2 = crearMonitor({ comprobar: async () => { throw new Error('x'); }, reloj: relojFalso() });
  await m2.iniciar();
  assert.strictEqual(m2.obtener().visible, 'inestable');
});

test('ventas pendientes ponen 🟠 aunque haya conexión', async () => {
  const m = crearMonitor({ comprobar: async () => ({ ok: true, ms: 10 }), reloj: relojFalso() });
  await m.iniciar();
  m.fijarPendientes(3);
  assert.strictEqual(m.obtener().visible, 'inestable');
  assert.strictEqual(m.obtener().pendientes, 3);
  m.fijarPendientes(0);
  assert.strictEqual(m.obtener().visible, 'en_linea');
});

test('revisa más seguido sin conexión, y no revisa dos veces a la vez', async () => {
  const reloj = relojFalso();
  let preguntas = 0; let soltar;
  const m = crearMonitor({ comprobar: () => { preguntas++; return new Promise((r) => { soltar = r; }); }, reloj, intervaloEnLinea: 15000, intervaloSinConexion: 5000 });
  const a = m.iniciar(); const b = m.revisarAhora();
  soltar({ ok: true, ms: 1 }); await a; await b;
  assert.strictEqual(preguntas, 1);
  assert.strictEqual(reloj.tareas.at(-1).en, 15000);
  m.detener();
  assert.strictEqual(reloj.tareas.length, 0);
});

test('comprobador: respuesta HTTP < 500 cuenta como conectado', async () => {
  const c401 = crearComprobador({ fetch: async () => ({ status: 401 }), url: 'u', clave: 'k' });
  assert.strictEqual((await c401()).ok, true);
  const c503 = crearComprobador({ fetch: async () => ({ status: 503 }), url: 'u', clave: 'k' });
  assert.strictEqual((await c503()).ok, false);
  const cErr = crearComprobador({ fetch: async () => { throw new Error('red'); }, url: 'u', clave: 'k' });
  assert.strictEqual((await cErr()).ok, false);
  let cab;
  await crearComprobador({ fetch: async (_u, o) => { cab = o.headers; return { status: 200 }; }, url: 'u', clave: 'clave-publica' })();
  assert.strictEqual(cab.apikey, 'clave-publica');
});
