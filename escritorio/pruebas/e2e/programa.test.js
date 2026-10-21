// Pruebas del programa real (Electron) con Playwright.
// No hay internet hacia Supabase en este entorno: la "salud" del servidor se
// simula con un servidor local que se puede apagar y prender.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { _electron: electron } = require('playwright');

const RAIZ = path.join(__dirname, '..', '..');
const ELECTRON = require('electron');

let servidor; let puerto; let saludOk = true;
let app; let ventana; let datosDir; let webDir; let ticketsDir;
const pedidosExternos = [];

async function esperar(fn, ms = 15000, cada = 100) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fin) throw new Error('Tiempo agotado esperando condición');
    await new Promise((r) => setTimeout(r, cada));
  }
}

function envPrueba() {
  return {
    ...process.env,
    N360_PRUEBA: '1',
    N360_SIN_SPLASH: '1',
    N360_URL_SALUD: `http://127.0.0.1:${puerto}/salud`,
    N360_DATOS_DIR: datosDir,
    N360_WEB_DIR: webDir,
    N360_IMPRESION_SIMULADA: ticketsDir,
  };
}

test.before(async () => {
  servidor = http.createServer((req, res) => {
    res.writeHead(saludOk ? 200 : 503, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  puerto = servidor.address().port;
  datosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-datos-'));
  ticketsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-tickets-'));
  // Copia de las páginas empaquetadas + una página de prueba para el ticket
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-web-'));
  fs.cpSync(path.join(RAIZ, 'build', 'web'), webDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, 'prueba-librerias.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Librerías</title>
<link rel="stylesheet" href="vendor/fuentes/fuentes.css"><link rel="stylesheet" href="vendor/leaflet/leaflet.css">
${['supabase.js', 'lucide.js', 'jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js', 'xlsx.full.min.js', 'chart.umd.js', 'JsBarcode.all.min.js', 'html2canvas.min.js', 'leaflet/leaflet.js', 'zxing-browser.min.js'].map((f) => `<script src="vendor/${f}"></script>`).join('')}
</head><body><span style="font-family:'JetBrains Mono';font-weight:500">x</span></body></html>`);
  fs.writeFileSync(path.join(webDir, 'prueba-ticket.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Prueba ticket</title>
<script src="escpos-usb.js"></script></head><body><script>
window.armarTicket = () => Array.from(construirReciboESCPOS({
  nombreNegocio: 'Ferretería Ñandú', encabezadoLineas: ['RECIBO DE VENTA', 'No. Venta: V-000123'],
  items: ['2x Martillo C$ 300.00', '1x Clavos ½" C$ 45.50'], totalTexto: 'TOTAL: C$ 345.50', piePagina: '¡Gracias por su compra!' }));
</script></body></html>`);
  app = await electron.launch({ executablePath: ELECTRON, args: [RAIZ, '--no-sandbox'], env: envPrueba() });
  ventana = await app.firstWindow();
  ventana.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u)) pedidosExternos.push(u); });
  await ventana.waitForLoadState('load');
  await app.evaluate(({ shell }) => { globalThis.__abiertos = []; shell.openExternal = async (u) => { globalThis.__abiertos.push(u); }; });
});

test.after(async () => {
  if (app) await app.close().catch(() => {});
  if (servidor) servidor.close();
});

test('abre el login empaquetado, con librerías y fuentes locales', async () => {
  assert.strictEqual(ventana.url(), 'app://negocio360/login.html');
  assert.strictEqual(await ventana.evaluate(() => typeof window.supabase?.createClient), 'function');
  const hojas = await ventana.evaluate(async () => { await document.fonts.ready; return [...document.styleSheets].map((s) => s.href).filter(Boolean); });
  assert.ok(hojas.includes('app://negocio360/vendor/fuentes/fuentes.css'), hojas.join(','));
  assert.ok(await ventana.evaluate(async () => { await document.fonts.load('700 16px Sora'); return document.fonts.check('700 16px Sora'); }));
  assert.deepStrictEqual(pedidosExternos.filter((u) => /cdn\.jsdelivr|unpkg\.com|fonts\.g/.test(u)), []);
});

test('cada librería fijada carga y funciona sin internet', async () => {
  await ventana.goto('app://negocio360/prueba-librerias.html');
  const r = await ventana.evaluate(async () => {
    await document.fonts.ready;
    const out = {
      supabase: typeof window.supabase?.createClient,
      lucide: typeof window.lucide?.createIcons,
      jspdf: typeof window.jspdf?.jsPDF,
      autotable: typeof new window.jspdf.jsPDF().autoTable,
      xlsx: typeof window.XLSX?.utils?.book_new,
      chart: typeof window.Chart,
      jsbarcode: typeof window.JsBarcode,
      html2canvas: typeof window.html2canvas,
      leaflet: typeof window.L?.map,
      zxing: typeof window.ZXingBrowser?.BrowserMultiFormatReader,
      jetbrains: document.fonts.check('500 12px "JetBrains Mono"'),
      inter: (await document.fonts.load('600 12px Inter'), document.fonts.check('600 12px Inter')),
    };
    const doc = new window.jspdf.jsPDF(); doc.autoTable({ head: [['a']], body: [['1']] }); out.pdfBytes = doc.output('arraybuffer').byteLength > 500;
    return out;
  });
  assert.deepStrictEqual(r, { supabase: 'function', lucide: 'function', jspdf: 'function', autotable: 'function', xlsx: 'function', chart: 'function', jsbarcode: 'function', html2canvas: 'function', leaflet: 'function', zxing: 'function', jetbrains: true, inter: true, pdfBytes: true });
  assert.deepStrictEqual(pedidosExternos.filter((u) => /cdn\.jsdelivr|unpkg\.com|fonts\.g/.test(u)), []);
});

test('las páginas no ven nada del equipo (sin Node)', async () => {
  const r = await ventana.evaluate(() => ({ require: typeof window.require, process: typeof window.process, buffer: typeof window.Buffer }));
  assert.deepStrictEqual(r, { require: 'undefined', process: 'undefined', buffer: 'undefined' });
});

test('no se puede leer fuera de la carpeta de páginas', async () => {
  const r = await ventana.evaluate(async () => {
    const pedir = async (u) => { try { return (await fetch(u)).status; } catch (_) { return 'error'; } };
    return [await pedir('app://negocio360/%2e%2e/%2e%2e/package.json'), await pedir('app://negocio360/..%2fpackage.json'), await pedir('app://negocio360/no-existe.html'), await pedir('app://negocio360/ventas.html')];
  });
  assert.notStrictEqual(r[0], 200);
  assert.notStrictEqual(r[1], 200);
  assert.strictEqual(r[2], 404);
  assert.strictEqual(r[3], 200);
});

test('impresión directa: misma interfaz que la 1.0.1 y bytes exactos', async () => {
  assert.strictEqual(await ventana.evaluate(() => window.negocio360Print.disponible), true);
  const lista = await ventana.evaluate(() => window.negocio360Print.listarImpresoras());
  assert.deepStrictEqual(lista, { ok: true, impresoras: ['EPSON TM-U220 (simulada)'] });
  await ventana.goto('app://negocio360/prueba-ticket.html');
  const bytes = await ventana.evaluate(() => window.armarTicket());
  const r = await ventana.evaluate((b) => window.negocio360Print.imprimir('EPSON TM-U220 (simulada)', new Uint8Array(b)), bytes);
  assert.deepStrictEqual(r, { ok: true });
  const guardado = fs.readFileSync(path.join(ticketsDir, 'ticket-1.bin'));
  assert.deepStrictEqual([...guardado], bytes);
  assert.strictEqual(guardado[0], 0x1b); assert.strictEqual(guardado[1], 0x40); // ESC @
  const otra = await ventana.evaluate(() => window.negocio360Print.imprimir('Impresora inventada', new Uint8Array([1, 2])));
  assert.strictEqual(otra.ok, false);
  assert.ok(!fs.existsSync(path.join(ticketsDir, 'ticket-2.bin')));
});

test('indicador 🟢 → 🔴 con aviso "Requiere conexión" → 🟢 al volver', async () => {
  await ventana.goto('app://negocio360/login.html');
  const texto = () => ventana.locator('[data-n360-escritorio] #texto').textContent();
  const veloVisible = () => ventana.locator('[data-n360-escritorio] #velo').isVisible();
  await esperar(async () => (await texto()) === 'En línea');
  assert.strictEqual(await veloVisible(), false);

  saludOk = false;
  await ventana.evaluate(() => window.negocio360Escritorio.reintentarConexion());
  assert.strictEqual(await texto(), 'Conexión inestable');
  await ventana.evaluate(() => window.negocio360Escritorio.reintentarConexion());
  await esperar(async () => (await texto()) === 'Sin conexión');
  assert.strictEqual(await veloVisible(), true);
  assert.match(await ventana.locator('[data-n360-escritorio] #velo').textContent(), /Requiere conexión/);

  saludOk = true;
  await ventana.locator('[data-n360-escritorio] #velo-reintentar').click();
  await esperar(async () => (await texto()) === 'En línea');
  assert.strictEqual(await veloVisible(), false);
  const estado = await ventana.evaluate(() => window.negocio360Escritorio.estadoConexion());
  assert.strictEqual(estado.conexion, 'en_linea');
});

test('enlaces de internet se abren en el navegador, no en el programa', async () => {
  const antes = app.windows().length;
  await ventana.evaluate(() => window.open('https://wa.me/50512345678', '_blank'));
  await ventana.evaluate(() => { location.href = 'https://example.com/'; });
  await new Promise((r) => setTimeout(r, 500));
  const abiertos = await app.evaluate(() => globalThis.__abiertos);
  assert.ok(abiertos.includes('https://wa.me/50512345678'));
  assert.ok(abiertos.includes('https://example.com/'));
  assert.strictEqual(app.windows().length, antes);
  assert.strictEqual(ventana.url(), 'app://negocio360/login.html');
  await ventana.evaluate(() => window.open('file:///etc/passwd'));
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(app.windows().length, antes);
});

test('ventana de ticket (about:blank) se permite, sin puente ni indicador', async () => {
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    ventana.evaluate(() => { const w = window.open('', '_blank', 'width=380,height=600'); w.document.write('<p>Ticket</p>'); w.document.close(); }),
  ]);
  await popup.waitForLoadState();
  assert.strictEqual(await popup.evaluate(() => typeof window.negocio360Print), 'undefined');
  assert.strictEqual(await popup.locator('[data-n360-escritorio]').count(), 0);
  await popup.close();
});

test('una sola instancia: abrir el programa otra vez no crea otro', async () => {
  const segundo = spawn(ELECTRON, [RAIZ, '--no-sandbox'], { env: envPrueba(), stdio: 'ignore' });
  const codigo = await new Promise((r) => { const t = setTimeout(() => { segundo.kill(); r('sigue-abierto'); }, 15000); segundo.on('exit', (c) => { clearTimeout(t); r(c); }); });
  assert.strictEqual(codigo, 0);
  assert.strictEqual(app.windows().length >= 1, true);
});
