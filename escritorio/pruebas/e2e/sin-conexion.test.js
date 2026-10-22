// Programa real (Electron) + servidor de Supabase simulado: vender con
// internet, cortar internet a mitad del día, vender, reiniciar el programa
// sin internet, y al volver la conexión ver que todo sube una sola vez.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { crearServidorFalso } = require('./servidor-falso');
const F = require('../referencia-web/fixtures');
const { escenarios } = require('../referencia-web/escenarios');

const RAIZ = path.join(__dirname, '..', '..');
const ELECTRON = require('electron');
const URL_REAL = 'https://zvlincmqmmoclqhykejv.supabase.co';

let srv; let puerto; let app; let ventana; let datosDir; let webDir; let ticketsDir;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const usuario = { id: F.U, email: 'prueba-offline@negocio360.test', aud: 'authenticated', role: 'authenticated' };
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: F.U, email: usuario.email, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.firma`;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-web-so-'));
  fs.cpSync(path.join(RAIZ, 'build', 'web'), dir, { recursive: true });
  const local = `http://127.0.0.1:${puerto}`;
  for (const n of fs.readdirSync(dir, { recursive: true })) {
    const ruta = path.join(dir, n);
    if (!/\.(html|js)$/.test(n) || !fs.statSync(ruta).isFile()) continue;
    const t = fs.readFileSync(ruta, 'utf8');
    if (t.includes(URL_REAL)) fs.writeFileSync(ruta, t.split(URL_REAL).join(local));
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
  if (process.env.N360_DEPURAR) ventana.on('console', (m) => { if (/N360|error|Error|warn/i.test(m.text())) console.log('[pág]', m.type(), m.text().slice(0, 300)); });
  if (process.env.N360_DEPURAR) app.process().stdout.on('data', (d) => console.log('[main]', String(d).slice(0, 300)));
  await ventana.waitForLoadState('load');
}

async function irAVentas() {
  await ventana.goto('app://negocio360/ventas.html');
  await ventana.waitForFunction(() => typeof S !== 'undefined' && S.userId && S.productosCache && S.productosCache.length > 0 && S.metodosPago && S.metodosPago.length > 0, null, { timeout: 30000 });
  await ventana.waitForTimeout(500);
}

const estadoSC = () => ventana.evaluate(() => window.negocio360SinConexion.estado());
const estadoCx = () => ventana.evaluate(() => window.negocio360Escritorio.estadoConexion());
const pildora = () => ventana.evaluate(() => document.querySelector('[data-n360-escritorio]').shadowRoot.getElementById('texto').textContent);

async function vender(nombre, conImpresion = false) {
  const esc = escenarios.find((e) => e.nombre === nombre);
  await ventana.evaluate(`(${esc.pasos.toString()})(${JSON.stringify(F.IDS)})`);
  await ventana.evaluate(() => { window.validarPasoActual = () => true; });
  await ventana.evaluate(([tipo, imp]) => (tipo === 'rapida' ? confirmarVentaRapida() : confirmarVenta(imp)), [esc.tipo, conImpresion]);
}

test.before(async () => {
  const tablas = JSON.parse(JSON.stringify(F.tablas));
  tablas.configuracion_venta_rapida[0].imprimir_automatico = true; // ticket automático en Venta rápida
  srv = crearServidorFalso({ tablas, usuario });
  puerto = await srv.escuchar();
  datosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-datos-so-'));
  ticketsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-tickets-so-'));
  webDir = copiarWeb();
  await abrir();
  // Sesión iniciada (como si hubiera entrado con su correo) e impresora elegida.
  await ventana.evaluate(({ s }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify(s));
    localStorage.setItem('n360_impresora_nativa', 'EPSON TM-U220 (simulada)');
  }, { s: { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: usuario } });
});

test.after(async () => {
  if (app) await app.close().catch(() => {});
  if (srv) await srv.cerrar();
});

test('con internet: registra el equipo, aparta números y copia el catálogo', async () => {
  await irAVentas();
  const e = await esperar(async () => { const x = await estadoSC(); return x.habilitado && x.numeros_libres >= 50 && x; });
  assert.strictEqual(e.cuenta, F.U);
  assert.ok(srv.estado.llamadas.some((l) => l.ruta === '/rest/v1/rpc/offline_registrar_dispositivo'));
  await esperar(async () => (await ventana.evaluate(() => window.negocio360SinConexion.catalogoInfo())).some((t) => t.tabla === 'productos' && t.filas === 6));
});

test('con internet: la venta rápida va por la bandeja, sube enseguida e imprime después de guardarse', async () => {
  await vender('rapida-efectivo-iva');
  if (process.env.N360_DEPURAR) { await ventana.waitForTimeout(3000); console.log('EST', JSON.stringify(await estadoSC()), await ventana.evaluate(() => document.getElementById('toast').textContent), srv.estado.llamadas.slice(-8).map((l) => l.metodo + ' ' + l.ruta).join(' | ')); }
  const subida = await esperar(() => srv.estado.ventas.size === 1 && [...srv.estado.ventas.values()][0]);
  assert.strictEqual(subida.payload.venta.numero_venta, 'V-001000'); // primer número del bloque del equipo
  assert.ok(subida.payload.reloj_envio);
  assert.strictEqual(srv.estado.escriturasDirectas.filter((w) => w.tabla === 'ventas').length, 0, 'ninguna escritura suelta de la venta');
  await esperar(() => fs.readdirSync(ticketsDir).some((n) => n.endsWith('.bin')));
  await esperar(async () => (await estadoSC()).pendientes === 0);
});

test('sin internet: la venta se guarda en el equipo y el indicador lo muestra', async () => {
  srv.cortar();
  await esperar(async () => (await estadoCx()).conexion === 'sin_conexion');
  const antes = fs.readdirSync(ticketsDir).length;
  await vender('nueva-efectivo-cliente-iva-descuento', true);
  await esperar(async () => (await estadoSC()).pendientes === 1);
  assert.strictEqual(srv.estado.ventas.size, 1);
  await esperar(async () => /1 venta\(s\) por subir/.test(await pildora()));
  assert.match(await ventana.evaluate(() => document.getElementById('toast').textContent), /Guardada en este equipo/);
  // el ticket sale igual (después de guardarse)
  await esperar(() => fs.readdirSync(ticketsDir).length > antes);
  // la pantalla de Ventas no muestra el aviso "Requiere conexión"
  assert.strictEqual(await ventana.evaluate(() => document.querySelector('[data-n360-escritorio]').shadowRoot.getElementById('velo').classList.contains('visible')), false);
});

test('sin internet: recargar Ventas funciona con la copia local y el stock ya descontado', async () => {
  await irAVentas();
  const martillo = await ventana.evaluate((id) => S.productosCache.find((p) => p.id === id).stock_actual, F.IDS.martillo);
  assert.strictEqual(Number(martillo), 8); // 10 - 2 vendidos sin internet
  const cable = await ventana.evaluate((id) => S.productosCache.find((p) => p.id === id).stock_actual, F.IDS.cable);
  assert.strictEqual(Number(cable), 197); // 200 - 3 de la venta con internet (copia del servidor después de subir)
});

test('sin internet: otras pantallas piden conexión, el cierre de caja se bloquea', async () => {
  await ventana.goto('app://negocio360/caja.html');
  await esperar(() => ventana.evaluate(() => document.querySelector('[data-n360-escritorio]')?.shadowRoot.getElementById('velo').classList.contains('visible')));
  await ventana.waitForFunction(() => typeof crearCierreDiario === 'function');
  const cierresAntes = srv.estado.escriturasDirectas.filter((w) => w.tabla === 'cierres_caja').length;
  const msg = await ventana.evaluate(async () => {
    let visto = '';
    const t = window.showToast; window.showToast = (m) => { visto = m; };
    await crearCierreDiario();
    window.showToast = t;
    return visto;
  });
  assert.match(msg, /todavía no suben/);
  assert.strictEqual(srv.estado.escriturasDirectas.filter((w) => w.tabla === 'cierres_caja').length, cierresAntes);
});

test('apagón: cerrar y abrir el programa sin internet conserva la venta pendiente', async () => {
  await app.close();
  await abrir();
  await irAVentas();
  const e = await estadoSC();
  assert.strictEqual(e.pendientes, 1);
  assert.strictEqual((await estadoCx()).conexion, 'sin_conexion');
});

test('vuelve internet: la venta sube una sola vez y la pantalla Sincronización lo muestra', async () => {
  srv.restablecer();
  await esperar(() => srv.estado.ventas.size === 2, 30000);
  await esperar(async () => (await estadoSC()).pendientes === 0);
  const offline = [...srv.estado.ventas.values()][1].payload;
  assert.match(offline.venta.numero_venta, /^V-0010\d\d$/); // del bloque del equipo
  assert.notStrictEqual(offline.venta.numero_venta, [...srv.estado.ventas.values()][0].payload.venta.numero_venta);
  assert.strictEqual(offline.tipo, 'nueva');
  const llamadasVenta = srv.estado.llamadas.filter((l) => l.ruta === '/rest/v1/rpc/offline_registrar_venta').length;
  assert.ok(llamadasVenta >= 2);
  await ventana.goto('app://negocio360/sincronizacion.html');
  await esperar(async () => (await ventana.evaluate(() => [...document.querySelectorAll('#t-ventas .chip')].map((c) => c.textContent))).filter((t) => t === 'Subida').length === 2);
  assert.strictEqual(await ventana.evaluate(() => document.getElementById('d-pendientes').textContent), '0');
});
