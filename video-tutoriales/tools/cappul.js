const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage } = require('./mob.js');
const { openDash } = require('./open.js');
const O = __dirname + '/pul/';
const W = ms => new Promise(r => setTimeout(r, ms));
const shot = (pg, n, full) => pg.screenshot({ path: O + n + '.png', fullPage: !!full }).then(() => console.log('shot', n));
(async () => {
  const b = await chromium.launch();
  let pg = await openPage(b, 'dashboard.html'); await shot(pg, 'dash'); await shot(pg, 'dash_full', true); await pg.context().close();
  /*VSTART
  await pg.evaluate(() => abrirNuevaVenta()); await W(1200); await pg.evaluate(() => pasoSiguiente()); await W(1200);
  await pg.evaluate(() => { const i = document.getElementById('prod-search-input'); i.value = 'arroz'; buscarProductosParaVenta('arroz', 'producto'); }); await W(700); await shot(pg, 'v_search');
  await pg.evaluate(() => { document.getElementById('prod-search-input').value = ''; buscarProductosParaVenta('', 'producto'); agregarAlCarrito(2, 'producto'); }); await W(700);
  await shot(pg, 'v_cart1');
  await pg.evaluate(() => cambiarCantidad(2, 0.5)); await W(500);
  await pg.evaluate(() => agregarAlCarrito(5, 'producto')); await W(700); await pg.evaluate(() => cambiarCantidad(5, 0.25)); await W(600);
  await shot(pg, 'v_frac');
  await pg.context().close();
  VEND*/
  pg = await openPage(b, 'fiados.html', { wait: 6000 }); await shot(pg, 'fiados');
  await pg.evaluate(() => { FD.abiertos.add(903); renderLista(); }); await W(500);
  await pg.evaluate(() => { const e = document.querySelector('[data-clave="903"]'); e && e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); }); await W(400); await shot(pg, 'fiado_open');
  await pg.evaluate(() => { window.scrollTo(0, 0); abrirNuevoFiado(903); }); await W(600);
  await pg.evaluate(() => { const m = document.getElementById('nf-monto'); m.value = '400'; m.dispatchEvent(new Event('input', { bubbles: true })); }); await W(500); await shot(pg, 'fiado_limite');
  await pg.context().close();
  pg = await openPage(b, 'productos.html'); await shot(pg, 'prod'); await pg.context().close();
  process.env.MW = 820; process.env.MH = 1180;
  pg = await openPage(b, 'dashboard.html'); await shot(pg, 'tablet'); await pg.context().close();
  pg = await openDash(b, { file: 'dashboard.html', clean: true, dpr: 1.5, wait: 5000 }); await pg.screenshot({ path: O + 'desktop.png' }); console.log('desk'); await pg.context().close();
  await b.close();
})();
