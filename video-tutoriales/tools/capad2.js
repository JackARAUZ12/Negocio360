const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage } = require('./mob.js');
const O = __dirname + '/ad2/';
require('fs').mkdirSync(O, { recursive: true });
const shot = (pg, n, full) => pg.screenshot({ path: O + n + '.png', fullPage: !!full }).then(() => console.log('shot', n));
(async () => {
  const b = await chromium.launch();
  let pg = await openPage(b, 'dashboard.html'); await shot(pg, 'dash_full', true); await pg.context().close();
  pg = await openPage(b, 'ventas.html');
  const last = await pg.evaluate(() => S.ventas[0].id);
  await pg.evaluate(() => abrirNuevaVenta()); await pg.waitForTimeout(1200); await pg.evaluate(() => pasoSiguiente()); await pg.waitForTimeout(1500);
  for (const id of [2, 1, 9]) { await pg.evaluate(id => agregarAlCarrito(id, 'producto'), id); await pg.waitForTimeout(500); }
  await pg.waitForTimeout(900); await shot(pg, 'v2cart');
  await pg.evaluate(() => goToPaso(4)); await pg.waitForTimeout(1200); await shot(pg, 'v4');
  await pg.evaluate(() => cerrarModalVenta && cerrarModalVenta()); await pg.waitForTimeout(800);
  await pg.evaluate(id => abrirDetalle(id), last); await pg.waitForTimeout(1800); await shot(pg, 'vdet');
  await pg.context().close();
  pg = await openPage(b, 'productos.html'); await shot(pg, 'prod'); await shot(pg, 'prod_full', true); await pg.context().close();
  pg = await openPage(b, 'compras.html'); await shot(pg, 'compras');
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button')].find(x => x.offsetParent && x.textContent.trim() === 'Proveedores'); e && e.click(); }); await pg.waitForTimeout(1500); await shot(pg, 'prov'); await pg.context().close();
  pg = await openPage(b, 'clientes.html'); await shot(pg, 'clientes'); await pg.context().close();
  pg = await openPage(b, 'reportes.html', { wait: 7000 }); await shot(pg, 'rep'); await shot(pg, 'rep_full', true); await pg.context().close();
  await b.close();
})();
