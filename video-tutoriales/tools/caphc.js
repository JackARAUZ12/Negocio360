const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage } = require('./mob.js');
const W = ms => new Promise(r => setTimeout(r, ms));
(async () => { const b = await chromium.launch(); const pg = await openPage(b, 'configuracion.html', { wait: 6000 });
  await pg.evaluate(() => { const c = document.getElementById('hotel-card'); c.querySelector('.cfg-card-title').innerHTML = 'Módulo de Hotel'; c.querySelector('.cfg-card-desc').textContent = 'Gestión hotelera completa: habitaciones, reservaciones, mapa de ocupación, check-in/check-out, housekeeping y huéspedes, conectado con Caja.'; c.scrollIntoView(); });
  await W(1500);
  for (const [on, n] of [[false, 'm_cfg_off'], [true, 'm_cfg_on']]) { await pg.evaluate(on => { document.getElementById('hotel-toggle').checked = on; document.getElementById('hotel-row-sub').textContent = on ? 'Activado — el menú de Hotel aparece en el sidebar.' : 'Desactivado — el módulo de hotel no aparece en ningún lado.'; }, on); await W(400); await pg.screenshot({ path: 'htx/' + n + '.jpg', type: 'jpeg', quality: 90 }); console.log(n, await pg.evaluate(() => JSON.stringify(document.getElementById('hotel-card').getBoundingClientRect()))); }
  await b.close(); })();
