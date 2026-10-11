const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const OUT = __dirname + '/shots/';
const HIDE = '#sidebar,#header,#tm-ayuda-flotante,#pg-switch-btn{visibility:hidden!important}';
async function top(pg, name) { await pg.screenshot({ path: OUT + name + '_top.jpg', type: 'jpeg', quality: 93 }); console.log('top', name); }
async function full(pg, name) {
  const h = await pg.addStyleTag({ content: HIDE });
  await pg.screenshot({ path: OUT + name + '_full.jpg', type: 'jpeg', quality: 93, fullPage: true });
  await h.evaluate(e => e.remove()); console.log('full', name);
}
(async () => {
  const b = await chromium.launch();
  let pg = await openDash(b);
  const meta = {};
  meta.H = await pg.evaluate(() => document.documentElement.scrollHeight);
  meta.pts = await pg.evaluate(() => { const c = document.getElementById('chart-ventas-line').getBoundingClientRect();
    return lineChart.getDatasetMeta(0).data.map(p => [Math.round(c.x + p.x), Math.round(c.y + p.y)]); });
  meta.donut = await pg.evaluate(() => { const c = document.getElementById('chart-categorias-donut').getBoundingClientRect(); const a = donutChart.getDatasetMeta(0).data[0];
    const ang = (a.startAngle + a.endAngle) / 2, r = (a.innerRadius + a.outerRadius) / 2; return [Math.round(c.x + a.x + Math.cos(ang) * r), Math.round(c.y + a.y + Math.sin(ang) * r)]; });
  await top(pg, 'base'); await full(pg, 'base');
  // search
  await pg.click('#mg-sidebar-search'); await pg.keyboard.type('rut', { delay: 60 }); await pg.waitForTimeout(400); await top(pg, 'search');
  await pg.fill('#mg-sidebar-search', ''); await pg.dispatchEvent('#mg-sidebar-search', 'input'); await pg.mouse.move(1000, 400);
  // collapsed
  await pg.click('#sidebar-toggle'); await pg.waitForTimeout(700); await pg.mouse.move(1000, 400); await top(pg, 'collapsed');
  await pg.click('#sidebar-toggle'); await pg.waitForTimeout(700);
  // dark
  await pg.click('[onclick="toggleTheme()"]'); await pg.waitForTimeout(900); await pg.mouse.move(1000, 400); await top(pg, 'dark'); await full(pg, 'dark');
  await pg.click('[onclick="toggleTheme()"]'); await pg.waitForTimeout(900);
  // chart tooltip
  await pg.mouse.move(meta.pts[6][0], meta.pts[6][1]); await pg.waitForTimeout(700); await top(pg, 'tipline');
  await pg.mouse.move(meta.pts[3][0], meta.pts[3][1]); await pg.waitForTimeout(700); await top(pg, 'tipline3');
  await pg.mouse.move(1000, 300);
  // period
  await pg.click('#period-btn'); await pg.waitForTimeout(3500); await pg.mouse.move(1000, 300); await top(pg, 'mes');
  await pg.click('#period-btn'); await pg.waitForTimeout(9000); await pg.mouse.move(1000, 300); await top(pg, 'anio');
  await pg.click('#period-btn'); await pg.waitForTimeout(2500);
  // donut
  await pg.mouse.move(meta.donut[0], meta.donut[1]); await pg.waitForTimeout(700); await top(pg, 'donut');
  // quick action hover
  meta.qa = await pg.evaluate(() => { const e = document.querySelector('.quick-actions-grid > *'); const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.mouse.move(meta.qa[0] + meta.qa[2] / 2, meta.qa[1] + meta.qa[3] / 2); await pg.waitForTimeout(600); await top(pg, 'qa');
  await pg.mouse.move(1000, 300);
  // KPI hover
  await pg.mouse.move(400, 240); await pg.waitForTimeout(500); await top(pg, 'kpihover'); await pg.mouse.move(1000, 400);
  // help
  await pg.click('#tm-ayuda-flotante'); await pg.waitForTimeout(1200); await top(pg, 'help');
  await pg.close(); pg = await openDash(b);
  // perfiles
  await pg.click('#pg-switch-btn'); await pg.waitForTimeout(1200); await top(pg, 'perfil');
  await pg.close(); pg = await openDash(b);
  // moneda
  meta.monModal = null;
  await pg.click('#btn-moneda-vis'); await pg.waitForTimeout(700); await top(pg, 'mon1');
  meta.monSel = await pg.evaluate(() => { const r = document.getElementById('mv-select-moneda').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.selectOption('#mv-select-moneda', 'USD'); await pg.dispatchEvent('#mv-select-moneda', 'change'); await pg.waitForTimeout(400);
  meta.monTasa = await pg.evaluate(() => { const r = document.getElementById('mv-tasa').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await top(pg, 'mon2');
  await pg.fill('#mv-tasa', '36.62'); await pg.waitForTimeout(200); await top(pg, 'mon3');
  meta.monApply = await pg.evaluate(() => { const e = [...document.querySelectorAll('#modal-moneda-vis button')].find(x => x.textContent.includes('Aplicar')); const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.click('text=Aplicar'); await pg.waitForTimeout(3000); await pg.mouse.move(1000, 400); await top(pg, 'usd');
  fs.writeFileSync(OUT + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
