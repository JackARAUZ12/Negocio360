// Captures REAL Negocio360 clinic screens (repo pages + simulated Supabase from clinica/pruebas) for the TikTok video.
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const HERE = __dirname, OUT = path.join(HERE, 'shots');
const UID = 'u-prueba-0000-0000-000000000001';
const MOCK = fs.readFileSync(path.join(RAIZ, 'clinica/pruebas/supabase-simulado.js'), 'utf8');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOY = ymd(new Date());
const MANANA = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); })();
const hace = min => new Date(Date.now() - min * 60000).toISOString();


const H_CARLOS = '8cb1f88d9416598ca7feef4dac992a61f5db4539dafe4234bd182d6797bdbcc7', H_MARIA = '763e81452a89a36a887e3f46a7fa7a72a2fd02cd818707b1fb838299d6dcf70f';
function semilla() {
  const prods = [['Arroz 1 lb', 22, 140], ['Frijoles rojos 1 lb', 30, 96], ['Aceite 1 L', 85, 40], ['Azúcar 2 lb', 38, 75], ['Café molido 400 g', 120, 32], ['Leche 1 L', 34, 60], ['Huevos (cajilla)', 135, 18], ['Jabón de baño', 25, 88], ['Pasta dental', 48, 36], ['Gaseosa 2 L', 55, 50]];
  const db = {
    configuracion_empresa: [{ id: 'cfg1', auth_user_id: UID, nombre_comercial: 'Tienda La Esperanza', moneda: 'C$', pais: 'NI', onboarding_completado: true, tipo_negocio: 'tienda' }],
    usuarios: [{ id: 'us1', auth_user_id: UID, nombre: 'Rosa Martínez', email: 'tienda@laesperanza.com', multiusuario_activo: true, estado_cuenta: 'activa' }],
    tutoriales_vistos: ['dashboard', 'ventas', 'caja', 'clientes', 'productos', 'configuracion', 'gastos'].map(k => ({ auth_user_id: UID, modulo_key: k })),
    perfiles_acceso: [
      { id: 'perf-rosa', auth_user_id: UID, nombre: 'Rosa', tipo: 'admin', activo: true, es_principal: true, codigo_configurado: true },
      { id: 'perf-carlos', auth_user_id: UID, nombre: 'Carlos', tipo: 'restringido', activo: true, codigo_hash: H_CARLOS, codigo_configurado: true, modulos: ['dashboard', 'ventas', 'clientes', 'productos'] },
      { id: 'perf-maria', auth_user_id: UID, nombre: 'María', tipo: 'restringido', activo: true, codigo_hash: H_MARIA, codigo_configurado: true, modulos: ['dashboard', 'ventas', 'caja'] },
    ],
    productos: prods.map(([nombre, precio, stock], i) => ({ id: 'p' + i, auth_user_id: UID, nombre, tipo: 'producto', precio, costo: Math.round(precio * .7), stock_actual: stock, stock_minimo: 10, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false, codigo: '7501' + (1000 + i) })),
    clientes: [['Ana', 'López'], ['Luis', 'Pérez'], ['Carmen', 'Ortega'], ['Jorge', 'Herrera'], ['Valeria', 'Cruz']].map(([n, a], i) => ({ id: 'c' + i, auth_user_id: UID, nombre: n, apellido: a, telefono: '8800-11' + (10 + i), activo: true })),
    metodos_pago: [{ id: 'mp1', auth_user_id: UID, nombre: 'Efectivo', activo: true, tipo: 'efectivo' }, { id: 'mp2', auth_user_id: UID, nombre: 'Tarjeta', activo: true, tipo: 'tarjeta' }],
    ventas: [], venta_detalles: [],
  };
  const hoy = new Date(); const CAT = ['Granos', 'Granos', 'Abarrotes', 'Abarrotes', 'Bebidas', 'Lácteos', 'Lácteos', 'Higiene', 'Higiene', 'Bebidas'];
  db.productos.forEach((p, i) => p.categoria = CAT[i]);
  let n = 0;
  for (let dia = 6; dia >= 0; dia--) for (let j = 0; j < (dia === 0 ? 6 : 3 + (dia % 3)); j++) {
    const d = new Date(hoy); d.setDate(d.getDate() - dia); d.setHours(8 + j, (j * 23) % 60);
    const items = [0, 1, 2].slice(0, 1 + ((n + dia) % 3)).map(k => { const p = db.productos[(n * 3 + k * 4) % 10]; const cant = 1 + ((n + k) % 4); return { venta_id: 'v' + n, auth_user_id: UID, producto_id: p.id, producto_nombre: p.nombre, cantidad: cant, precio_unitario: p.precio, subtotal: cant * p.precio, tipo_item: 'producto', id: 'd' + n + k }; });
    const total = items.reduce((a, x) => a + x.subtotal, 0); db.venta_detalles.push(...items);
    db.ventas.push({ id: 'v' + n, auth_user_id: UID, numero_venta: 'V-' + String(1001 + n).padStart(5, '0'), estado: 'completada', total, subtotal: total, fecha: d.toISOString(), created_at: d.toISOString(), metodo_pago: n % 3 ? 'Efectivo' : 'Tarjeta', cliente_nombre: ['Ana López', 'Luis Pérez', 'Público general'][n % 3], cliente_id: n % 3 < 2 ? 'c' + (n % 3) : null, vendedor: n % 2 ? 'Carlos' : 'María' }); n++;
  }
  return db;
}
function servidor() {
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  return http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    const f = u.startsWith('/__v/') ? path.join(HERE, 'vendor', u.slice(5)) : path.join(RAIZ, u);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(8792);
}
const BASE = 'http://localhost:8792';
async function pagina(browser, w, h, db, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.dpr || 2, isMobile: w < 500, hasTouch: w < 900 });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (u.includes('chart.js@') || u.includes('chart.umd')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(HERE, 'vendor/chart.js')) });
    if (u.includes('lucide')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(HERE, 'vendor/lucide.js')) });
    if (u.includes('fonts.googleapis.com')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(HERE, 'vendor/fonts.css')) });
    if (u.endsWith('.js')) return r.fulfill({ contentType: 'application/javascript', body: '' });
    return r.fulfill({ contentType: 'text/css', body: '' });
  });
  await ctx.addInitScript(s => { window.__SEED = s; window.__RPC = { admin_verificar_codigo: a => a.p_pin === '2468' ? { ok: true, perfil_id: 'perf-rosa', nombre: 'Rosa', principal: true } : { ok: false } }; try { if (!localStorage.getItem('n360_init')) { localStorage.setItem('n360_theme', 'light'); localStorage.setItem('n360_init', '1'); } } catch (_) {} }, db);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  pageerror', String(e).slice(0, 160)));
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const listo = page => page.waitForFunction(() => document.getElementById('app')?.style.display === 'flex', null, { timeout: 20000 });
const RECTS = fs.existsSync(path.join(HERE, 'rects.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'rects.json'))) : {};
const shot = async (page, name, o = {}) => { await page.waitForTimeout(o.wait ?? 700); await page.screenshot({ path: path.join(OUT, name + '.png'), ...o.opts });
  if (o.rects) { RECTS[name] = {}; for (const [k, sel] of Object.entries(o.rects)) { const bb = await page.locator(sel).first().boundingBox({ timeout: 1500 }).catch(() => null); RECTS[name][k] = bb; } fs.writeFileSync(path.join(HERE, 'rects.json'), JSON.stringify(RECTS, null, 1)); }
  console.log('  ✓', name, o.rects ? JSON.stringify(RECTS[name]) : ''); };
async function abrir(browser, w, h, url, o = {}) {
  const r = await pagina(browser, w, h, o.db || semilla(), o);
  await r.page.goto(BASE + url); if (o.listo !== false) await listo(r.page).catch(() => console.log('  (no #app flex)', url));
  await r.page.waitForTimeout(1200);
  return r;
}


const HDR = { toggle: '#sidebar-toggle', titulo: '.header-title', fecha: '#date-display', moneda: '#btn-moneda-vis', tema: 'button[onclick="toggleTheme()"]', config: 'button[onclick="navigate(\'configuracion.html\')"]', saludo: '#greeting-text', kpi: '.kpi-card', buscar: '#mg-sidebar-search', ventas: '#sidebar .nav-item:has-text("Ventas")', nueva: '#sidebar .nav-item:has-text("Nueva venta")', cambiar: '#pg-switch-btn', sidebar: '#sidebar', dashboard: '#sidebar .nav-item:has-text("Dashboard")', tutoriales: '#sidebar .nav-item:has-text("Tutoriales")', chat: '#sidebar .nav-item:has-text("Chat con Negocio360")' };
async function flujo(b, w, h, tag) {
  const r = await pagina(b, w, h, semilla());
  const page = r.page;
  await page.goto(BASE + '/terminos.html'); await page.evaluate(() => sessionStorage.setItem('__SALIO', '1'));
  await page.goto(BASE + '/login.html'); await page.waitForTimeout(1500);
  await page.addStyleTag({ content: '#session-overlay{display:none!important}' });
  const LR = { email: '#email', pass: '#password', ojo: '#eyeBtn', btn: '#loginBtn', olvide: 'text=¿Olvidaste tu contraseña?' };
  await shot(page, 'login_0_' + tag, { rects: LR });
  await page.fill('#email', 'tienda@laesperanza.com'); await shot(page, 'login_1_' + tag, { rects: LR });
  await page.fill('#password', 'Esperanza2026'); await shot(page, 'login_2_' + tag, { rects: LR });
  await page.click('#eyeBtn'); await shot(page, 'login_3_' + tag, { rects: LR });
  await page.click('#eyeBtn');
  await page.evaluate(() => sessionStorage.removeItem('__SALIO'));
  await page.goto(BASE + '/dashboard.html'); await listo(page).catch(() => {});
  await page.waitForSelector('#hwSkip', { timeout: 6000 }).then(async () => { await page.waitForTimeout(1600); await shot(page, 'welcome_' + tag, { wait: 0 }); await page.click('#hwSkip'); }).catch(() => console.log('no welcome'));
  await page.waitForSelector('.pg-profile', { timeout: 15000 }).catch(() => console.log('no selector'));
  await page.waitForTimeout(4000);
  await shot(page, 'who_' + tag, { wait: 1200, rects: { rosa: '.pg-profile[data-id="perf-rosa"]', carlos: '.pg-profile[data-id="perf-carlos"]', card: '#pg-card' } });
  await page.click('.pg-profile[data-id="perf-rosa"]'); await page.waitForSelector('.pg-pin-input');
  for (let i = 0; i <= 4; i++) { await page.fill('.pg-pin-input', '2468'.slice(0, i)); await shot(page, `pin_${i}_${tag}`, { wait: 250, rects: { input: '.pg-pin-input', ok: '.pg-btn-primary', card: '#pg-card' } }); }
  await page.click('.pg-btn-primary'); await page.waitForTimeout(2500);
  await page.mouse.move(5, 5);
  await shot(page, 'dash_' + tag, { wait: 1500, rects: HDR });
  if (tag === 'm') {
    await page.click('#sidebar-toggle'); await shot(page, 'drawer_m', { wait: 700, rects: HDR });
    await page.fill('#mg-sidebar-search', 'ven'); await page.dispatchEvent('#mg-sidebar-search', 'input'); await shot(page, 'drawer_search_m', { wait: 500, rects: HDR });
    await page.click('#sidebar .nav-item:has-text("Ventas")'); await page.waitForTimeout(2500); await shot(page, 'ventas_m', { wait: 1200, rects: { toggle: '#sidebar-toggle' } });
    await page.goto(BASE + '/dashboard.html'); await page.waitForTimeout(2500);
    await page.click('button[onclick="toggleTheme()"]'); await shot(page, 'dark_m', { wait: 900, rects: HDR });
    await page.click('button[onclick="toggleTheme()"]'); await page.waitForTimeout(300);
    await page.goto(BASE + '/configuracion.html'); await page.waitForTimeout(2500);
    if (await page.locator('.pg-pin-input').count()) { await page.fill('.pg-pin-input', '2468'); await page.click('.pg-btn-primary'); await page.waitForTimeout(2000); }
    await shot(page, 'cfg_m', { wait: 800 });
  } else {
    await page.fill('#mg-sidebar-search', 'caja'); await page.dispatchEvent('#mg-sidebar-search', 'input'); await shot(page, 'search_d', { wait: 500, rects: { ...HDR, caja: '#sidebar .nav-item:has-text("Caja")' } });
    await page.fill('#mg-sidebar-search', ''); await page.dispatchEvent('#mg-sidebar-search', 'input');
    await page.click('#sidebar-toggle'); await shot(page, 'collapsed_d', { wait: 700, rects: HDR }); await page.click('#sidebar-toggle'); await page.waitForTimeout(400);
    await page.click('button[onclick="toggleTheme()"]'); await shot(page, 'dark_d', { wait: 900, rects: HDR });
    await page.click('button[onclick="toggleTheme()"]'); await page.waitForTimeout(300);
    for (const p of ['ventas', 'productos', 'clientes']) { await page.goto(BASE + '/' + p + '.html'); await page.waitForTimeout(2800); await page.mouse.move(5, 5); await shot(page, p + '_d', { wait: 800, rects: { ...HDR, ayuda: '#tm-ayuda-flotante', productos: '#sidebar .nav-item:has-text("Productos")', clientes: '#sidebar .nav-item:has-text("Clientes")' } });
      if (p === 'ventas') { await page.click('#tm-ayuda-flotante', { timeout: 4000 }).then(() => shot(page, 'help_d', { wait: 1500 })).catch(() => console.log('no ayuda')); await page.keyboard.press('Escape'); } }
    await page.goto(BASE + '/configuracion.html'); await page.waitForTimeout(2800);
    if (await page.locator('.pg-pin-input').count()) {
      for (let i = 0; i <= 4; i += 2) { await page.fill('.pg-pin-input', '2468'.slice(0, i)); await shot(page, `cfgpin_${i}_d`, { wait: 250, rects: { input: '.pg-pin-input', ok: '.pg-btn-primary', card: '#pg-card' } }); }
      await page.fill('.pg-pin-input', '2468'); await shot(page, 'cfgpin_4_d', { wait: 250, rects: { input: '.pg-pin-input', ok: '.pg-btn-primary', card: '#pg-card' } });
      await page.click('.pg-btn-primary'); await page.waitForTimeout(2000);
    } else console.log('no cfg code');
    const CR = { perfil: '.cfg-card-title:has-text("Editar Perfil")', modulos: '.cfg-card-title:has-text("Editar módulos")', multi: '.cfg-card-title:has-text("Sistema multiusuario")', pass: '.cfg-card-title:has-text("Cambiar contraseña")', salir: '#btn-cerrar-sesion' };
    await shot(page, 'cfg_d', { wait: 800, rects: CR });
    await page.locator('.cfg-card-title:has-text("Editar Perfil")').scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); await page.evaluate(() => scrollBy(0, 200)); await shot(page, 'cfg2_d', { wait: 600, rects: CR });
    await page.goto(BASE + '/dashboard.html'); await page.waitForTimeout(2500);
    await page.click('#pg-switch-btn', { timeout: 5000 }).catch(() => console.log('no switch')); await page.waitForTimeout(1500); await shot(page, 'who_again_d', { wait: 800, rects: { card: '#pg-card' } });
  }
  await r.ctx.close();
}
if (process.env.KPITEST) (async () => {
  const srv = servidor(); const b = await chromium.launch();
  for (const w of [1600, 1700, 1800, 1920]) {
    const db = semilla(); db.usuarios[0].multiusuario_activo = false;
    const r = await pagina(b, w, 1000, db); await r.page.goto(BASE + '/dashboard.html'); await r.page.waitForTimeout(4000);
    await r.page.click('#hwSkip', { timeout: 3000 }).catch(() => {}); await r.page.waitForTimeout(800);
    console.log(w, await r.page.$$eval('.kpi-value', es => es.map(e => Math.round(e.getBoundingClientRect().height)).join(',')));
    await r.ctx.close();
  }
  await b.close(); srv.close();
})(); else (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = servidor(); const b = await chromium.launch();
  const which = process.argv[2] || 'dm';
  if (which.includes('d')) await flujo(b, 1700, 1000, 'd').catch(e => console.log('ERR d', e.message.split('\n')[0]));
  if (which.includes('m')) await flujo(b, 390, 844, 'm').catch(e => console.log('ERR m', e.message.split('\n')[0]));
  await b.close(); srv.close();
})();
