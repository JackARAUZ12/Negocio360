const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage } = require('./mob.js');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/tut/'; const meta = {};
const W = ms => new Promise(r => setTimeout(r, ms));
const b64 = f => 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64');
const TH = {}; for (const k of ['dashboard', 'ventas', 'productos', 'clientes', 'compras', 'gastos', 'caja']) TH['yt' + 'v' + (['dashboard', 'ventas', 'productos', 'clientes', 'compras', 'gastos', 'caja'].indexOf(k) + 1)] = b64(O + 'th_' + k + '.jpg');
const PLAYER = b64(O + 'player.jpg');
const fixImgs = (pg) => pg.evaluate(([TH, PL]) => {
  document.querySelectorAll('img.tut-thumb').forEach(im => { const m = (im.getAttribute('src') || '').match(/vi\/([^/]+)\//); if (m && TH[m[1]]) { im.src = TH[m[1]]; im.style.visibility = 'visible'; } });
  const p = document.getElementById('tut-player'); if (p && p.querySelector('iframe')) p.innerHTML = `<img src="${PL}" style="width:100%;height:100%;object-fit:cover;display:block">`;
}, [TH, PLAYER]);
const rect = (pg, s) => pg.evaluate(s => { const e = [...document.querySelectorAll(s)].find(x => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); }, s);
(async () => {
  const b = await chromium.launch();
  // ---- móvil: tutoriales
  let pg = await openPage(b, 'tutoriales.html', { wait: 6000 });
  await fixImgs(pg); await W(400);
  await pg.screenshot({ path: O + 'm_grid.jpg', type: 'jpeg', quality: 92, fullPage: true });
  meta.m_grid = { grid: await rect(pg, '#tut-grid'), prog: await rect(pg, '#tut-progreso-global'), search: await rect(pg, '#tut-buscar'), sub: await rect(pg, '#tut-subtitulo'), card0: await rect(pg, '.tut-card'), cards: await pg.evaluate(() => [...document.querySelectorAll('.tut-card')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); })) };
  await pg.evaluate(() => { const i = document.getElementById('tut-buscar'); i.value = 'caja'; TUT.buscar('caja'); }); await W(500); await fixImgs(pg); await W(300);
  await pg.screenshot({ path: O + 'm_search.jpg', type: 'jpeg', quality: 92, fullPage: true });
  meta.m_search = { search: await rect(pg, '#tut-buscar'), res: await rect(pg, '#tut-resultados') };
  await pg.evaluate(() => { const i = document.getElementById('tut-buscar'); i.value = ''; TUT.buscar(''); TUT.abrirModulo('caja'); }); await W(700); await fixImgs(pg); await W(300);
  await pg.screenshot({ path: O + 'm_video.jpg', type: 'jpeg', quality: 92, fullPage: true });
  meta.m_video = { player: await rect(pg, '#tut-player'), info: await rect(pg, '#tut-player-info'), acc: await rect(pg, '#tut-acciones'), lista: await rect(pg, '#tut-lista') };
  await pg.evaluate(() => TUT.volver()); await W(300);
  // menú lateral en móvil
  await pg.evaluate(() => { try { openMobileSidebar(); } catch (e) { try { toggleSidebar(); } catch (e2) {} } }); await W(800);
  await pg.evaluate(() => { const it = document.querySelector('[data-mg-tutoriales]'); it && it.scrollIntoView({ block: 'center' }); }); await W(400);
  await pg.screenshot({ path: O + 'm_menu.jpg', type: 'jpeg', quality: 92 });
  meta.m_menu = { item: await pg.evaluate(() => { const e = document.querySelector('[data-mg-tutoriales]'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }) };
  await pg.context().close();
  // ---- escritorio
  let d = await openDash(b, { file: 'tutoriales.html', clean: true, wait: 6500, dpr: 1.5 });
  await fixImgs(d); await W(400);
  await d.screenshot({ path: O + 'd_grid.jpg', type: 'jpeg', quality: 92 });
  meta.d_grid = { grid: await rect(d, '#tut-grid'), prog: await rect(d, '#tut-progreso-global'), menu: await d.evaluate(() => { const e = document.querySelector('[data-mg-tutoriales]'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }) };
  await d.evaluate(() => TUT.abrirModulo('caja')); await W(700); await fixImgs(d); await W(300);
  await d.screenshot({ path: O + 'd_video.jpg', type: 'jpeg', quality: 92 });
  meta.d_video = { player: await rect(d, '#tut-player'), lista: await rect(d, '#tut-lista'), info: await rect(d, '#tut-player-info'), acc: await rect(d, '#tut-acciones') };
  await d.context().close();
  d = await openDash(b, { file: 'caja.html', clean: true, wait: 7500, dpr: 1.5 });
  await d.screenshot({ path: O + 'd_caja.jpg', type: 'jpeg', quality: 92 });
  meta.d_caja = { btn: await d.evaluate(() => { const e = document.querySelector('[data-mg-tut-btn]'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }) };
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta)); console.log(JSON.stringify(meta));
  await b.close();
})();
