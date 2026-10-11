const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage } = require('./mob.js');
const O = __dirname + '/ad/';
const shot = (pg, n, full) => pg.screenshot({ path: O + n + '.png', fullPage: !!full }).then(() => console.log('shot', n));
(async () => {
  const b = await chromium.launch();
  let pg = await openPage(b, 'dashboard.html');
  await shot(pg, 'dash'); await shot(pg, 'dash_full', true); await pg.context().close();
  pg = await openPage(b, 'ventas.html');
  await shot(pg, 'ventas');
  await pg.evaluate(() => abrirNuevaVenta()); await pg.waitForTimeout(1200); await shot(pg, 'v1');
  await pg.evaluate(() => pasoSiguiente()); await pg.waitForTimeout(1500); await shot(pg, 'v2');
  for (const id of [2, 1, 9]) { await pg.evaluate(id => agregarAlCarrito(id, 'producto'), id); await pg.waitForTimeout(500); }
  await pg.waitForTimeout(800); await shot(pg, 'v2cart');
  await pg.evaluate(() => goToPaso(4)); await pg.waitForTimeout(1200); await shot(pg, 'v4');
  await pg.context().close();
  pg = await openPage(b, 'consulta-inventario.html');
  const sel = 'main input[placeholder*="SKU"], #content input[placeholder*="SKU"], input[placeholder*="nombre o SKU"]';
  await pg.locator(sel).first().click(); await pg.keyboard.type('Arroz', { delay: 90 }); await pg.waitForTimeout(1500); await shot(pg, 'ci1');
  const opts = await pg.evaluate(() => [...document.querySelectorAll('[onclick]')].filter(e => e.offsetParent && /Arroz/.test(e.textContent)).map(e => e.getAttribute('onclick')).slice(0, 3));
  console.log(opts);
  if (opts.length) { await pg.evaluate(o => eval(o), opts[0]); await pg.waitForTimeout(1500); await shot(pg, 'ci2'); await shot(pg, 'ci2_full', true); }
  await pg.context().close();
  pg = await openPage(b, 'productos.html'); await shot(pg, 'prod'); await shot(pg, 'prod_full', true); await pg.context().close();
  pg = await openPage(b, 'reportes.html', { wait: 7000 }); await shot(pg, 'rep'); await shot(pg, 'rep_full', true); await pg.context().close();
  await b.close();
})();
