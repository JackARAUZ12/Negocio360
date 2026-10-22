// Abre la pantalla real de Ventas (build/web/ventas.html) en Chromium con el
// Supabase simulado, para ejecutar el código real de ventas.js.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// N360_REF_WEB: probar otra copia empaquetada de las páginas (p. ej. la versión de main).
const WEB = process.env.N360_REF_WEB || path.join(__dirname, '..', '..', 'build', 'web');
const FALSO = fs.readFileSync(path.join(__dirname, 'supabase-falso.js'), 'utf8');
const BASE = 'http://n360.prueba/';

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

async function abrirVentas(fixtures, { pagina = 'ventas.html', extra = null, extraArg = null } = {}) {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: 'America/Managua', locale: 'es-NI' });
  const errores = [];
  await ctx.route('**/*', async (ruta) => {
    const u = new URL(ruta.request().url());
    if (u.origin + '/' !== BASE) return ruta.abort();
    let rel = decodeURIComponent(u.pathname.slice(1)) || pagina;
    if (rel === 'vendor/supabase.js') return ruta.fulfill({ body: FALSO, contentType: 'text/javascript' });
    const archivo = path.join(WEB, rel);
    if (!archivo.startsWith(WEB) || !fs.existsSync(archivo)) return ruta.fulfill({ status: 404, body: '' });
    return ruta.fulfill({ body: fs.readFileSync(archivo), contentType: TIPOS[path.extname(archivo)] || 'application/octet-stream' });
  });
  await ctx.addInitScript((fx) => {
    window.__N360_FIXTURES = fx;
    try { localStorage.clear(); } catch (_) {}
    window.open = () => null; // sin ventanas emergentes de ticket
  }, fixtures);
  if (extra) await ctx.addInitScript(extra, extraArg);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(String(e && e.message)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(BASE + pagina);
  return { navegador, page, errores };
}

module.exports = { abrirVentas };
