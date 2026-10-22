// Fase 4 — pruebas de fuego con el programa real (Electron) y un Supabase
// simulado: corte justo después de que el servidor guardó, apagón (se mata el
// proceso), sesión vencida sin internet, y 500 ventas sin internet con cuadre.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { _electron: electron } = require('playwright');
const { crearServidorFalso, tokenPara } = require('./servidor-falso');
const F = require('../referencia-web/fixtures');
const { escenarios } = require('../referencia-web/escenarios');

const RAIZ = path.join(__dirname, '..', '..');
const ELECTRON = require('electron');
const URL_REAL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const usuario = { id: F.U, email: 'prueba-offline@negocio360.test', aud: 'authenticated', role: 'authenticated' };

let srv; let puerto; let app; let ventana; let datosDir; let webDir; let ticketsDir;

async function esperar(fn, ms = 20000, cada = 150) {
  const fin = Date.now() + ms;
  let ultimo;
  for (;;) {
    try { ultimo = await fn(); if (ultimo) return ultimo; } catch (e) { ultimo = e; }
    if (Date.now() > fin) throw new Error('Tiempo agotado esperando condición: ' + (ultimo && ultimo.message ? ultimo.message : JSON.stringify(ultimo)));
    await new Promise((r) => setTimeout(r, cada));
  }
}

function copiarWeb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-web-fuego-'));
  fs.cpSync(path.join(RAIZ, 'build', 'web'), dir, { recursive: true });
  for (const n of fs.readdirSync(dir, { recursive: true })) {
    const ruta = path.join(dir, n);
    if (!/\.(html|js)$/.test(n) || !fs.statSync(ruta).isFile()) continue;
    const t = fs.readFileSync(ruta, 'utf8');
    if (t.includes(URL_REAL)) fs.writeFileSync(ruta, t.split(URL_REAL).join(`http://127.0.0.1:${puerto}`));
  }
  return dir;
}

async function abrir() {
  app = await electron.launch({
    executablePath: ELECTRON, args: [RAIZ, '--no-sandbox'],
    env: {
      ...process.env, N360_PRUEBA: '1', N360_SIN_SPLASH: '1', N360_DATOS_DIR: datosDir, N360_WEB_DIR: webDir,
      N360_IMPRESION_SIMULADA: ticketsDir, N360_SUPABASE_URL: `http://127.0.0.1:${puerto}`,
      N360_URL_SALUD: `http://127.0.0.1:${puerto}/auth/v1/health`, N360_INTERVALO_CONEXION_MS: '700',
    },
  });
  ventana = await app.firstWindow();
  await ventana.waitForLoadState('load');
}

function sesion(segundos) {
  return { access_token: tokenPara(usuario, segundos), token_type: 'bearer', expires_in: segundos, expires_at: Math.floor(Date.now() / 1000) + segundos, refresh_token: 'r', user: usuario };
}

async function irAVentas() {
  await ventana.goto('app://negocio360/ventas.html');
  await ventana.waitForFunction(() => typeof S !== 'undefined' && S.userId && S.productosCache && S.productosCache.length > 0 && S.metodosPago && S.metodosPago.length > 0, null, { timeout: 30000 });
  await ventana.waitForTimeout(500);
}

const estadoSC = () => ventana.evaluate(() => window.negocio360SinConexion.estado());
const estadoCx = () => ventana.evaluate(() => window.negocio360Escritorio.estadoConexion());

async function vender(nombre = 'rapida-efectivo-iva') {
  const esc = escenarios.find((e) => e.nombre === nombre);
  await ventana.evaluate(`(${esc.pasos.toString()})(${JSON.stringify(F.IDS)})`);
  await ventana.evaluate(() => { window.validarPasoActual = () => true; });
  await ventana.evaluate((tipo) => (tipo === 'rapida' ? confirmarVentaRapida() : confirmarVenta(false)), esc.tipo);
}

async function cortar() {
  srv.cortar();
  await esperar(async () => (await estadoCx()).conexion === 'sin_conexion');
}

test.before(async () => {
  srv = crearServidorFalso({ tablas: JSON.parse(JSON.stringify(F.tablas)), usuario });
  puerto = await srv.escuchar();
  datosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-datos-fuego-'));
  ticketsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-tickets-fuego-'));
  webDir = copiarWeb();
  await abrir();
  await ventana.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)), sesion(3600));
  await irAVentas();
  await esperar(async () => { const e = await estadoSC(); return e.habilitado && e.numeros_libres >= 50; });
  await esperar(async () => (await ventana.evaluate(() => window.negocio360SinConexion.catalogoInfo())).some((t) => t.tabla === 'productos'));
});

test.after(async () => {
  if (app) await app.close().catch(() => {});
  if (srv) await srv.cerrar();
});

test('corte justo después de que el servidor guardó: se reintenta y queda UNA sola venta', async () => {
  srv.estado.cortarDespuesDeGuardar = true;
  await vender();
  await esperar(() => srv.estado.ventas.size === 1);
  await esperar(async () => (await estadoSC()).pendientes === 0, 30000);
  assert.strictEqual(srv.estado.ventas.size, 1);
  const subidas = await ventana.evaluate(() => window.negocio360SinConexion.ventasListar({ estados: ['subida'] }));
  assert.strictEqual(subidas.length, 1);
  assert.strictEqual(subidas[0].resultado.repetida, true);
  assert.ok(srv.estado.llamadas.filter((l) => l.ruta === '/rest/v1/rpc/offline_registrar_venta').length >= 2);
});

test('apagón: se mata el programa justo después de vender sin internet; al abrir, la venta sigue y sube una vez', async () => {
  await cortar();
  await vender('nueva-efectivo-cliente-iva-descuento');
  await esperar(async () => (await estadoSC()).pendientes === 1);
  app.process().kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 800));
  await abrir();
  await irAVentas();
  assert.strictEqual((await estadoSC()).pendientes, 1);
  assert.ok(fs.readdirSync(path.join(datosDir, 'local', 'respaldos')).length >= 1, 'hay respaldo diario');
});

test('sesión vencida sin internet: Ventas abre y vende; al volver internet se renueva y sube todo', async () => {
  // Pasó más de una hora sin internet: el token guardado ya venció.
  await ventana.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)), sesion(-600));
  await irAVentas();
  await vender();
  await esperar(async () => (await estadoSC()).pendientes === 2);
  const antes = srv.estado.ventas.size;
  srv.restablecer();
  await esperar(async () => (await estadoSC()).pendientes === 0, 90000, 500);
  assert.ok(srv.estado.renovaciones > 0, 'la página renovó la sesión');
  assert.strictEqual(srv.estado.ventas.size, antes + 2);
});

test('500 ventas sin internet: se guardan rápido, suben todas una vez y cuadran', async () => {
  await cortar();
  const antes = srv.estado.ventas.size;
  const ventas = Array.from({ length: 500 }, (_, i) => {
    const uuid = crypto.randomUUID();
    const total = Math.round((10 + (i % 37) * 1.25) * 100) / 100;
    return {
      uuid, numero: `V-T${i}`, total, resumen: { cliente: 'Consumidor Final', metodo: 'Efectivo', lineas: 1, tipo: 'rapida' },
      payload: { version: 1, uuid, tipo: 'rapida', venta: { numero_venta: `V-T${i}`, total }, detalles: [{ producto_id: F.IDS.cable, cantidad: 1, precio: total }] },
      filasLocales: [], deltas: [{ tabla: 'productos', id: F.IDS.cable, campo: 'stock_actual', delta: -1 }],
    };
  });
  const t0 = Date.now();
  const ms = await ventana.evaluate(async (lista) => {
    const ini = performance.now();
    for (const v of lista) await window.negocio360SinConexion.ventaGuardar(v);
    return performance.now() - ini;
  }, ventas);
  const e = await esperar(async () => { const x = await estadoSC(); return x.pendientes === 500 && x; });
  assert.ok(ms < 60000, `guardar 500 tardó ${Math.round(ms)} ms`);
  const cable = (await ventana.evaluate(() => window.negocio360SinConexion.catalogoLeer(['productos']))).productos.find((p) => p.id === F.IDS.cable);
  const stockLocal = Number(cable.stock_actual);
  srv.restablecer();
  await esperar(async () => (await estadoSC()).pendientes === 0, 180000, 500);
  const subidas = [...srv.estado.ventas.values()].slice(antes);
  assert.strictEqual(subidas.length, 500);
  assert.strictEqual(new Set(subidas.map((v) => v.payload.uuid)).size, 500);
  const sumaServidor = subidas.reduce((a, v) => a + Number(v.payload.venta.total), 0);
  const sumaEquipo = ventas.reduce((a, v) => a + v.total, 0);
  assert.strictEqual(Math.round(sumaServidor * 100), Math.round(sumaEquipo * 100));
  // El orden de subida es el orden en que se vendió.
  assert.deepStrictEqual(subidas.map((v) => v.payload.uuid), ventas.map((v) => v.uuid));
  // Stock: lo que el equipo descontó coincide con lo que quedó en el servidor.
  await esperar(async () => {
    const p = (await ventana.evaluate(() => window.negocio360SinConexion.catalogoLeer(['productos']))).productos.find((x) => x.id === F.IDS.cable);
    return Number(p.stock_actual) === Number(srv.motor.buscar('productos', F.IDS.cable).stock_actual);
  }, 30000);
  assert.strictEqual(Number(srv.motor.buscar('productos', F.IDS.cable).stock_actual), stockLocal);
  console.log(`# 500 ventas: guardar ${Math.round(ms)} ms; subir ${Math.round((Date.now() - t0 - ms) / 1000)} s aprox.; ${e.sin_subir_equipo} en cola`);
});

test('se corta internet EN MEDIO de una venta con internet: nada queda a medias y sube una vez', async () => {
  srv.restablecer();
  await esperar(async () => (await estadoCx()).conexion !== 'sin_conexion');
  const antes = srv.estado.ventas.size;
  const directasAntes = srv.estado.escriturasDirectas.length;
  const venta = vender('nueva-pago-separado-iva');
  setTimeout(() => srv.cortar(), 150);
  await venta;
  await esperar(async () => { const e = await estadoSC(); return e.pendientes + (srv.estado.ventas.size - antes) === 1; });
  srv.restablecer();
  await esperar(async () => (await estadoSC()).pendientes === 0, 60000, 500);
  assert.strictEqual(srv.estado.ventas.size, antes + 1);
  // ninguna fila suelta de la venta llegó por fuera de la función todo-o-nada
  const sueltas = srv.estado.escriturasDirectas.slice(directasAntes).filter((w) => /^(ventas|venta_detalles|movimientos_financieros|movimientos_impuestos)$/.test(w.tabla));
  assert.deepStrictEqual(sueltas, []);
});
