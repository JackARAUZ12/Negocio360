// Capturas del video "Primeros pasos": REPO=<copia de main> FAKE=fake-nuevo.js XLSX=<excel demo> LOGO=<png> node capnew.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/nshots/'; fs.mkdirSync(O, { recursive: true });
const meta = {};
const W = ms => new Promise(r => setTimeout(r, ms));
const find = (sels) => { const o = {}; for (const [k, s] of Object.entries(sels)) { let e = null;
  if (s.startsWith('text:')) { const [t, sc] = s.slice(5).split('@'); e = [...document.querySelectorAll((sc || 'body') + ' *')].filter(x => x.getClientRects().length && x.children.length < 4 && x.textContent.trim().startsWith(t)).pop(); }
  else if (s.startsWith('uptext:')) { const [a, up] = s.slice(7).split('||'); const [t, sc] = a.split('@'); const x = [...document.querySelectorAll((sc || 'body') + ' *')].filter(x => x.getClientRects().length && x.children.length < 4 && x.textContent.trim().startsWith(t)).pop(); e = x && (x.closest(up) || x); }
  else if (s.startsWith('up:')) { const [sel, up] = s.slice(3).split('||'); const x = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length); e = x && (x.closest(up) || x); }
  else e = [...document.querySelectorAll(s)].find(x => x.getClientRects().length) || null;
  if (e) { const r = e.getBoundingClientRect(); o[k] = [r.x, r.y, r.width, r.height].map(Math.round); } else o[k] = null; } return o; };
async function shot(pg, n, sels = {}, fields = []) {
  await W(350); await pg.screenshot({ path: O + n + '_top.jpg', type: 'jpeg', quality: 93 });
  meta[n] = await pg.evaluate(`(${find.toString()})(${JSON.stringify(sels)})`);
  if (fields.length) meta[n].F = await pg.evaluate(ids => Object.fromEntries(ids.map(id => { const e = document.getElementById(id); if (!e || !e.getClientRects().length) return [id, null]; const r = e.getBoundingClientRect(), c = getComputedStyle(e);
    return [id, { r: [r.x, r.y, r.width, r.height].map(Math.round), fs: c.fontSize, ff: c.fontFamily, fw: c.fontWeight, pl: c.paddingLeft, col: c.color, bg: c.backgroundColor, br: c.borderRadius, ta: c.textAlign }]; })), fields);
  console.log('shot', n, JSON.stringify(meta[n]).slice(0, 300));
}
const ev = (pg, f, a) => pg.evaluate(f, a);
const fill = (pg, id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); if (!e) return; if (e.type === 'checkbox') { if (e.checked !== v) e.click(); return; } e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const openList = (pg, id, hi) => pg.evaluate(([id, hi]) => { document.querySelectorAll('.fake-dd').forEach(x => x.remove()); const s = document.getElementById(id); const r = s.getBoundingClientRect(); const d = document.createElement('div'); d.className = 'fake-dd';
  d.style.cssText = `position:fixed;left:${r.x}px;top:${r.bottom + 4}px;width:${Math.max(r.width, 260)}px;max-height:300px;overflow:hidden;background:#fff;border:1px solid #d6d9e0;border-radius:10px;box-shadow:0 14px 34px rgba(20,24,40,.25);z-index:99999;padding:5px;font:14px 'Plus Jakarta Sans',Inter,sans-serif;color:#1d2433`;
  [...s.options].slice(0, 9).forEach(o => { const it = document.createElement('div'); it.textContent = o.textContent; const on = hi ? o.value === hi : o.selected; it.style.cssText = `padding:7px 11px;border-radius:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${on ? 'background:#5B5BF0;color:#fff;font-weight:600' : ''}`; d.appendChild(it); });
  document.body.appendChild(d); }, [id, hi || null]);
const closeList = pg => pg.evaluate(() => document.querySelectorAll('.fake-dd').forEach(x => x.remove()));
const center = async (pg, sel) => { await pg.evaluate(s => { const e = document.querySelector(s); e && e.scrollIntoView({ block: 'center', behavior: 'instant' }); }, sel); await W(1200); };
const top0 = pg => pg.evaluate(() => window.scrollTo(0, 0));
const open = (b, file) => openDash(b, { file, clean: true, wait: 6000 });

(async () => {
  const b = await chromium.launch();
  // ---------------- REGISTRO
  let pg = await open(b, 'register.html');
  const R1 = { card: '.card', code: '#codigoAcceso', btn: '#btnContinuar', wa: 'text:Solicitar código por WhatsApp' };
  await shot(pg, 'r1', R1, ['codigoAcceso']);
  await fill(pg, 'codigoAcceso', 'NEGOCIO360-7K4P'); await shot(pg, 'r1b', R1);
  await ev(pg, () => document.getElementById('btnContinuar').click()); await W(1200);
  const RF = ['nombre', 'apellido', 'negocio', 'email', 'whatsapp', 'password', 'passwordConfirm'];
  const R2 = { card: '.card', steps: '#stepsIndicator', terms: 'up:#terminos||label', btn: '#btnRegistrar' };
  await shot(pg, 'r2_0', R2, RF);
  const VALS = { nombre: 'Ana', apellido: 'López', negocio: 'Minisúper La Esperanza', email: 'ana@minisuperlaesperanza.com', whatsapp: '+505 8765 4321', password: 'Esperanza2026', passwordConfirm: 'Esperanza2026' };
  for (const [i, id] of RF.entries()) { await fill(pg, id, VALS[id]); await shot(pg, 'r2_' + (i + 1), R2, RF); }
  await fill(pg, 'terminos', true); await shot(pg, 'r2_t', R2, RF);
  await pg.context().close();

  // ---------------- PERSONALIZACIÓN
  pg = await open(b, 'personalizacion.html');
  const card = 'uptext:Supermercado@#step-1||[onclick]';
  await shot(pg, 'p1a', { prog: '.progress-count', track: '#stepTrack', head: '#step-1 .step-icon', tipo: card, grid: '#step-1' });
  await ev(pg, () => { const e = [...document.querySelectorAll('#step-1 *')].filter(x => x.children.length < 4 && x.textContent.trim().startsWith('Supermercado')).pop(); (e.closest('[onclick]') || e).click(); }); await W(500);
  await top0(pg); await shot(pg, 'p1b', { tipo: card, track: '#stepTrack' });
  await center(pg, '#descripcion');
  const P1F = ['nombre_comercial', 'razon_social', 'anio_fundacion', 'descripcion', 'cantidad_empleados'];
  const P1 = { next: '#step-1 .btn-primary, #step-1 button[onclick="nextStep()"]', form: 'up:#nombre_comercial||.form-grid' };
  await shot(pg, 'p1c', P1, P1F);
  await fill(pg, 'nombre_comercial', 'Minisúper La Esperanza'); await shot(pg, 'p1d', P1, P1F);
  await fill(pg, 'anio_fundacion', '2019'); await shot(pg, 'p1e', P1, P1F);
  await fill(pg, 'descripcion', 'Abarrotes, granos, lácteos y productos de limpieza para el barrio.'); await shot(pg, 'p1f', P1, P1F);
  await ev(pg, () => nextStep()); await W(800); await top0(pg);
  const P2F = ['pais', 'zona_horaria', 'departamento', 'ciudad', 'direccion'];
  const P2 = { box: '#step-2', track: '#stepTrack', next: '#step-2 button[onclick="nextStep()"]' };
  await shot(pg, 'p2a', P2, P2F);
  await fill(pg, 'departamento', 'Managua'); await shot(pg, 'p2b', P2, P2F);
  await fill(pg, 'ciudad', 'Managua'); await shot(pg, 'p2c', P2, P2F);
  await fill(pg, 'direccion', 'Barrio Altagracia, de la iglesia 2 c. al sur'); await shot(pg, 'p2d', P2, P2F);
  await ev(pg, () => nextStep()); await W(800); await top0(pg);
  const P3F = ['whatsapp', 'telefono', 'email_empresa', 'sitio_web', 'facebook', 'instagram', 'tiktok'];
  const P3 = { box: '#step-3', track: '#stepTrack', next: '#step-3 button[onclick="nextStep()"]' };
  await shot(pg, 'p3a', P3, P3F);
  await fill(pg, 'whatsapp', '8765-4321'); await shot(pg, 'p3b', P3, P3F);
  await fill(pg, 'email_empresa', 'ventas@minisuperlaesperanza.com'); await shot(pg, 'p3c', P3, P3F);
  await fill(pg, 'facebook', 'https://facebook.com/minisuperlaesperanza'); await shot(pg, 'p3d', P3, P3F);
  await ev(pg, () => nextStep()); await W(800); await top0(pg);
  const P4 = { box: '#step-4', track: '#stepTrack', moneda: '#moneda', next: '#step-4 button[onclick="nextStep()"]' };
  await shot(pg, 'p4a', P4);
  await openList(pg, 'moneda', 'NIO'); await shot(pg, 'p4dd', { ...P4, dd: '.fake-dd' }); await closeList(pg);
  await fill(pg, 'moneda', 'NIO'); await shot(pg, 'p4b', P4);
  await ev(pg, () => nextStep()); await W(800); await top0(pg);
  const P5 = { box: '#step-5', track: '#stepTrack', logoArea: '#step-5 .upload-zone, #step-5 .logo-upload', colors: 'up:#color_principal||.fields-grid', presets: '#step-5 .chips', chipE: '#step-5 .chips .chip:nth-child(5)', temas: '.theme-cards', claro: '#theme_light', next: '#step-5 button[onclick="nextStep()"]' };
  await shot(pg, 'p5a', P5);
  const fileInput = await pg.$('#step-5 input[type=file]'); if (fileInput) await fileInput.setInputFiles(process.env.LOGO); await W(800);
  await shot(pg, 'p5b', P5);
  await ev(pg, () => document.querySelector('#step-5 .chips .chip:nth-child(5)').click()); await W(500); await shot(pg, 'p5c', P5);
  await ev(pg, () => document.getElementById('theme_light').click()); await W(700);
  await center(pg, '#step-5 button[onclick="nextStep()"]'); await shot(pg, 'p5d', P5);
  await ev(pg, () => nextStep()); await W(900); await top0(pg);
  const P6 = { box: '#step-6', track: '#stepTrack', fin: '#btnFinish', grid: '#modulosSecundariosWrap', esp: '#moduloEspecialWrap' };
  await shot(pg, 'p6a', P6);
  await ev(pg, () => { const cs = [...document.querySelectorAll('#modulosSecundariosWrap [onclick]')]; cs.slice(0, 3).forEach(c => { if (!c.classList.contains('selected') && !c.classList.contains('active')) c.click(); }); }); await W(500);
  await shot(pg, 'p6b', P6);
  await ev(pg, () => { document.querySelectorAll('.card-step').forEach(el => el.classList.remove('active')); document.getElementById('successScreen').classList.add('active'); }); await W(600); await top0(pg);
  await shot(pg, 'p_ok', { ok: '#successScreen' });
  await pg.context().close();

  // ---------------- DASHBOARD Y CAJA
  pg = await open(b, 'dashboard.html');
  await shot(pg, 'd0', { saludo: '.greeting-text, h1', kpis: '.kpi-grid', nav: '.nav-item[onclick*="caja.html"]', navP: '.nav-item[onclick*="productos.html"]' });
  await pg.context().close();
  pg = await open(b, 'caja.html');
  const C = { box: '#modal-capital-inicial .modal-box', inp: '#capital-inicial-monto', btn: '#btn-guardar-capital-inicial' };
  await shot(pg, 'c0', C, ['capital-inicial-monto']);
  await fill(pg, 'capital-inicial-monto', '15000'); await shot(pg, 'c1', C, ['capital-inicial-monto']);
  await ev(pg, () => guardarCapitalInicialModal()); await W(1800);
  await shot(pg, 'c2', { kpis: '.kpi-grid', k0: '.kpi-card', toast: '#toast', mov: '#mov-tbody tr' });
  await pg.context().close();

  // ---------------- PRODUCTOS
  pg = await open(b, 'productos.html');
  const PR = { bNuevo: '#btnNuevoProducto', bImp: '[onclick="abrirModalImportar()"]', bPlant: '#plantillaDropdown', empty: 'text:Sin productos aún', kpis: '.kpi-grid, .stats-grid', table: '.table-wrap, table' };
  await shot(pg, 'pr0', PR);
  await ev(pg, () => abrirModalNuevo('producto')); await W(900);
  const MF = ['inputNombre', 'inputCategoria', 'inputSku', 'inputCosto', 'inputPrecio', 'inputStockActual', 'inputStockMinimo'];
  const MB = { box: '#modalProducto .modal-box, #modalProducto .modal', tipo: 'text:Tipo de registro@#modalProducto', basic: 'text:Información básica@#modalProducto', precios: 'text:Costos & Precios@#modalProducto', inv: 'text:Inventario@#modalProducto', save: '#modalProducto .modal-footer .btn-primary', margen: '#margenPreview, [id*=margen]' };
  await shot(pg, 'pm0', MB, MF);
  await fill(pg, 'inputNombre', 'Queso seco (libra)'); await shot(pg, 'pm1', MB, MF);
  await fill(pg, 'inputCategoria', 'Lácteos'); await shot(pg, 'pm2', MB, MF);
  await pg.evaluate(() => document.getElementById('inputCosto').scrollIntoView({ block: 'center' })); await W(300);
  await shot(pg, 'pm3', MB, MF);
  await fill(pg, 'inputCosto', '90'); await shot(pg, 'pm4', MB, MF);
  await fill(pg, 'inputPrecio', '120'); await ev(pg, () => { try { actualizarMargenPreview(); } catch (e) {} }); await shot(pg, 'pm5', MB, MF);
  await pg.evaluate(() => document.getElementById('inputStockActual').scrollIntoView({ block: 'center' })); await W(300);
  await shot(pg, 'pm6', MB, MF);
  await fill(pg, 'inputStockActual', '20'); await shot(pg, 'pm7', MB, MF);
  await fill(pg, 'inputStockMinimo', '5'); await shot(pg, 'pm8', MB, MF);
  await ev(pg, () => guardarProducto()); await W(2000);
  await shot(pg, 'pr1', { ...PR, row0: 'tbody tr', toast: '#toast, .toast' });
  await ev(pg, () => togglePlantillaDropdown({ stopPropagation() {} })); await W(400);
  await shot(pg, 'px_dd', { ...PR, menu: '#plantillaDropdownMenu' });
  await ev(pg, () => document.getElementById('plantillaDropdownMenu').classList.remove('open'));
  await ev(pg, () => abrirModalImportar()); await W(700);
  const MI = { box: '#modalImportar .modal-box, #modalImportar .modal', body: '#importarBody', foot: '#importarFooter', btnSel: '#importarBody .btn-primary', ok: '#btnConfirmarImportacion' };
  await shot(pg, 'pi0', MI);
  await (await pg.$('#inputImportarExcel')).setInputFiles(process.env.XLSX); await W(2500);
  await shot(pg, 'pi1', MI);
  await ev(pg, () => confirmarImportacionFinal()); await W(3000);
  await shot(pg, 'pi2', MI);
  await ev(pg, () => { try { cerrarModalImportar(); } catch (e) {} }); await W(1500);
  await shot(pg, 'pr2', { ...PR, rows: 'tbody', toast: '#toast, .toast' });
  meta.pr2rows = await pg.evaluate(() => [...document.querySelectorAll('tbody tr')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
