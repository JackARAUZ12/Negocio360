const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage } = require('./mob.js');
const fs = require('fs'); const O = __dirname + '/trx/'; const meta = JSON.parse(fs.readFileSync(O + 'meta.json'));
const W = ms => new Promise(r => setTimeout(r, ms));
const R = (pg, s) => pg.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); }, s);
async function full(pg, n, sels = {}) { await W(300); await pg.screenshot({ path: O + n + '.jpg', type: 'jpeg', quality: 90, fullPage: true }); const m = { h: await pg.evaluate(() => document.documentElement.scrollHeight) }; for (const [k, s] of Object.entries(sels)) m[k] = await R(pg, s); meta[n] = m; console.log('full', n, JSON.stringify(m)); }
(async () => {
  const b = await chromium.launch(); let pg; const op = f => openPage(b, f, { wait: 5500 });
  pg = await op('transporte.html'); await full(pg, 'f_panel', { kpis: '#tp-kpis', acc: '#tp-accesos' }); await pg.context().close();
  pg = await op('flota.html'); await full(pg, 'f_flota', { kpis: '#fl-kpis', avisos: '#fl-avisos', lista: '#fl-lista' }); await pg.context().close();
  pg = await op('conductores.html'); await full(pg, 'f_cond', { kpis: '#cd-kpis', avisos: '#cd-avisos', lista: '#cd-lista' }); await pg.context().close();
  pg = await op('transporte-rutas.html'); await full(pg, 'f_rutas', { kpis: '#rt-kpis', lista: '#rt-lista' }); await pg.context().close();
  pg = await op('transporte-ordenes.html'); await full(pg, 'f_ord', { kpis: '#ot-kpis', vista: '#ot-vista', avisos: '#ot-avisos' });
  await pg.evaluate(() => { OT.vista = 'rentab'; renderVista(); }); await W(500); await full(pg, 'f_rentab', { vista: '#ot-vista' }); await pg.context().close();
  pg = await op('transporte-fronteras.html'); await full(pg, 'f_front', { kpis: '#fr-kpis', vista: '#fr-vista' }); await pg.context().close();
  pg = await op('transporte-entregas.html'); await pg.evaluate(() => { EN.ordenSel = 'o8'; renderTodo(); }); await W(600); await full(pg, 'f_firma', { firma: '#en-vista img[alt="Firma"]', vista: '#en-vista' });
  await pg.evaluate(() => { EN.vista = 'incidencias'; EN.ordenSel = null; renderTodo(); }); await W(500); await full(pg, 'f_inc', { kpis: '#en-kpis', vista: '#en-vista' }); await pg.context().close();
  pg = await op('transporte-mantenimiento.html'); await full(pg, 'f_mant', { kpis: '#mm-kpis', vista: '#mm-vista' });
  await pg.evaluate(() => { MT.vista = 'llantas'; renderVista(); }); await W(500); await full(pg, 'f_llantas', { vista: '#mm-vista' }); await pg.context().close();
  pg = await op('transporte-liquidaciones.html'); await full(pg, 'f_liq', { kpis: '#lq-kpis', vista: '#lq-vista' }); await pg.context().close();
  pg = await op('transporte-facturacion.html'); await full(pg, 'f_fact', { kpis: '#fc-kpis', vista: '#fc-vista' }); await pg.context().close();
  pg = await op('transporte-reportes.html'); await full(pg, 'f_rep', { kpis: '#rp-kpis', vista: '#rp-vista' }); await pg.context().close();
  pg = await openPage(b, 'configuracion.html', { wait: 6000 });
  await pg.evaluate(() => { const d = document.querySelector('#transporte-card .cfg-card-desc'); if (d) d.textContent = 'Para empresas de transporte de carga: flota, conductores, rutas, órdenes, costos, fronteras, mantenimiento y cobros, conectado con Ventas, Créditos, Gastos y Caja.'; const t = document.getElementById('transporte-toggle'); t.checked = false; document.getElementById('transporte-row-sub').textContent = 'Desactivado — el módulo de Transporte de carga no aparece en ningún lado.'; });
  await full(pg, 'f_cfg_off', { card: '#transporte-card', sw: '#transporte-card .cfg-switch-track' });
  await pg.evaluate(() => { const t = document.getElementById('transporte-toggle'); t.checked = true; document.getElementById('transporte-row-sub').textContent = 'Activado — el panel de Transporte aparece en el menú.'; const s = document.getElementById('transporte-status'); s.textContent = 'Módulo de Transporte de carga activado. Recarga la página para ver el menú.'; s.className = 'cfg-status ok'; s.style.display = 'block'; });
  await full(pg, 'f_cfg_on', { card: '#transporte-card', sw: '#transporte-card .cfg-switch-track' }); await pg.context().close();
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta)); await b.close();
})();
