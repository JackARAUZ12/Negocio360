const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage } = require('./mob.js');
const fs = require('fs');
const O = __dirname + '/pov/'; const meta = {};
const W = ms => new Promise(r => setTimeout(r, ms));
const R = (pg, sel) => pg.evaluate(s => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }, sel);
async function shot(pg, n, sels = {}, full) { await W(200); await pg.screenshot({ path: O + n + '.jpg', type: 'jpeg', quality: 90, fullPage: !!full }); const m = {}; for (const [k, s] of Object.entries(sels)) m[k] = await R(pg, s); m.h = await pg.evaluate(() => document.documentElement.scrollHeight); meta[n] = m; console.log('shot', n, JSON.stringify(m)); }
const typeIn = async (pg, sel, txt, pre, fn) => { for (let i = 1; i <= txt.length; i++) { await pg.evaluate(([s, v, f]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); if (f) eval(f); }, [sel, txt.slice(0, i), fn]); await W(250); await shot(pg, pre + i, {}); } };
(async () => {
  process.env.MW = 430; process.env.MH = 720;
  const b = await chromium.launch();
  // dashboard
  let pg = await openPage(b, 'dashboard.html'); await shot(pg, 'dash', {}, true); await pg.context().close();
  // ventas
  pg = await openPage(b, 'ventas.html'); await shot(pg, 'v0', { nueva: '.btn-primary[onclick="abrirNuevaVenta()"]' });
  await pg.evaluate(() => abrirNuevaVenta()); await W(1200); await shot(pg, 'v1', { sig: '[onclick="pasoSiguiente()"]' });
  await pg.evaluate(() => pasoSiguiente()); await W(1200); await shot(pg, 'v2', { inp: '#prod-search-input' });
  await typeIn(pg, '#prod-search-input', 'arroz', 'va', "buscarProductosParaVenta(v,'producto')");
  meta.va5.res = await R(pg, '#prod-results .prod-result-item');
  await pg.evaluate(() => { document.getElementById('prod-search-input').value = ''; buscarProductosParaVenta('', 'producto'); agregarAlCarrito(2, 'producto'); }); await W(900);
  await shot(pg, 'v3', { half: 'button[onclick="cambiarCantidad(\'2\',0.5)"]', inp: '#prod-search-input' });
  await pg.evaluate(() => cambiarCantidad(2, 0.5)); await W(700); await shot(pg, 'v4', { inp: '#prod-search-input' });
  await typeIn(pg, '#prod-search-input', 'queso', 'vq', "buscarProductosParaVenta(v,'producto')");
  meta.vq5.res = await R(pg, '#prod-results .prod-result-item');
  await pg.evaluate(() => { document.getElementById('prod-search-input').value = ''; buscarProductosParaVenta('', 'producto'); agregarAlCarrito(5, 'producto'); }); await W(900);
  await shot(pg, 'v5', { q: 'button[onclick="cambiarCantidad(\'5\',0.25)"]' });
  await pg.evaluate(() => cambiarCantidad(5, 0.25)); await W(700); await shot(pg, 'v6', {});
  await pg.context().close();
  // fiados
  pg = await openPage(b, 'fiados.html', { wait: 6000 }); await shot(pg, 'f0', { maria: '[data-fd-toggle="903"]', nuevo: '[onclick="FD.abrirNuevo()"]' }, true);
  await pg.evaluate(() => { FD.abiertos.add(903); renderLista(); }); await W(600);
  await shot(pg, 'f1', { wa: '[data-fd-wa="903"]', abono: '.fd-abonos', saldo: '[data-clave="903"] .fd-cliente-saldo', maria: '[data-fd-toggle="903"]' }, true);
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.evaluate(() => FD.abrirNuevo()); await W(700); await shot(pg, 'f2', { cli: '#nf-cliente' });
  await typeIn(pg, '#nf-cliente', 'María Castillo', 'fc', null); await W(400); await shot(pg, 'f3', { monto: '#nf-monto' });
  await typeIn(pg, '#nf-monto', '400', 'fm', null); meta.fm3.aviso = await R(pg, '#nf-aviso');
  await pg.context().close();
  // productos
  pg = await openPage(b, 'productos.html'); await shot(pg, 'p0', {}, true);
  meta.p0.stock = await pg.evaluate(() => { const e = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && /STOCK BAJO/i.test(x.textContent)); let c = e; for (let i = 0; i < 4 && c && c.getBoundingClientRect().height < 100; i++) c = c.parentElement; const r = c.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  await pg.context().close();
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta)); await b.close();
})();
