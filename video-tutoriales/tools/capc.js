const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/cshots/';
const meta = {};
const W = ms => new Promise(r => setTimeout(r, ms));
async function shot(pg, n, sels = {}) {
  await W(250); await pg.screenshot({ path: O + n + '_top.jpg', type: 'jpeg', quality: 93 });
  meta[n] = await pg.evaluate(sels => { const o = {}; for (const [k, s] of Object.entries(sels)) { let e = null;
    if (s.startsWith('text:')) { const [t, sc] = s.slice(5).split('@'); e = [...document.querySelectorAll((sc || 'body') + ' *')].filter(x => x.getClientRects().length && x.children.length < 3 && x.textContent.trim().startsWith(t))[0]; }
    else if (s.startsWith('up:')) { const [sel, up] = s.slice(3).split('||'); const x = document.querySelector(sel); e = x && (x.closest(up) || x); }
    else e = document.querySelector(s);
    if (e) { const r = e.getBoundingClientRect(); o[k] = [r.x, r.y, r.width, r.height].map(Math.round); } else o[k] = null; } return o; }, sels);
  console.log('shot', n, JSON.stringify(meta[n]));
}
const ev = (pg, f, a) => pg.evaluate(f, a);
const fill = (pg, id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); if (!e) return; if (e.type === 'checkbox') { if (e.checked !== v) e.click(); return; } e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const into = (pg, sel, off = 20) => pg.evaluate(([s, off]) => { const e = document.querySelector(s); if (!e) return; e.scrollIntoView({ block: 'start' }); const mb = e.closest('.modal-body') || e.closest('.modal-box') || e.closest('.modal'); if (mb) mb.scrollTop -= off; }, [sel, off]);
(async () => {
  const b = await chromium.launch();
  let pg = await openDash(b, { file: 'clientes.html', clean: true, wait: 6500 });
  meta.kpis = await ev(pg, () => [...document.querySelectorAll('.kpi-card, .stat-card, [class*=kpi]')].filter(e => { const h = e.getBoundingClientRect().height; return h > 80 && h < 140 && e.getBoundingClientRect().width < 260; }).slice(0, 6).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  meta.tabs = await ev(pg, () => [...document.querySelectorAll('[onclick*="cambiarTab"]')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  meta.filtros = await ev(pg, () => [...document.querySelectorAll('.filter-btn')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  meta.row1 = await ev(pg, () => { const tr = document.querySelector('tbody tr'); const r = tr.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  meta.eye = await ev(pg, () => { const tr = [...document.querySelectorAll('tbody tr')].find(t => /Abarrotes El Sol/.test(t.textContent)); if (!tr) return null; const b = tr.querySelector('button, [onclick]'); const r = (b || tr).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await shot(pg, 'base', { bNuevo: 'up:[onclick="abrirModalNuevoCliente()"]||button', bImp: '[onclick="abrirModalImportarClientes()"]', bSync: '[onclick="sincronizarStats()"]', table: 'table', thead: 'thead' });
  for (const t of ['top', 'frecuentes', 'inactivos']) { await ev(pg, t => cambiarTab(t), t); await W(900); await shot(pg, 'tab_' + t, { table: '.tab-panel.active table, table' }); }
  meta.inactBtns = await ev(pg, () => [...document.querySelectorAll('[onclick*="cambiarDiasInactividad"]')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  await ev(pg, () => cambiarDiasInactividad(60)); await W(800); await shot(pg, 'tab_inact60', {});
  await ev(pg, () => cambiarTab('lista')); await W(700);
  for (const f of ['activos', 'frecuentes', 'nuevos']) { await ev(pg, f => setFiltro(f), f); await W(800); await shot(pg, 'f_' + f, {}); }
  await ev(pg, () => setFiltro('todos')); await W(700);
  // ---- new client form
  await ev(pg, () => abrirModalNuevoCliente()); await W(900);
  await shot(pg, 'nc0', { box: '#modal-cliente .modal-box, #modal-cliente > div' });
  for (const [id, v] of [['fc-nombre', 'Súper Las Américas'], ['fc-telefono', '8845-2210'], ['fc-correo', 'compras@superlasamericas.com'], ['fc-empresa', 'Súper Las Américas S.A.'], ['fc-ruc', 'J0310000987654']]) await fill(pg, id, v);
  await shot(pg, 'nc1', { nombre: '#fc-nombre', tel: '#fc-telefono', correo: '#fc-correo', empresa: '#fc-empresa', ruc: '#fc-ruc', estado: '#fc-estado' });
  await fill(pg, 'fc-direccion', 'Rotonda Bello Horizonte 3 c. al este, Managua'); await fill(pg, 'fc-direccion-factura', 'Oficinas centrales, Km 5 Carretera a Masaya'); await fill(pg, 'fc-fecha-aniversario', '2015-08-20');
  await into(pg, '#fc-direccion', 60); await W(400);
  await shot(pg, 'nc2', { dir: '#fc-direccion', ruc: '#fc-ruc', aniv: '#fc-fecha-aniversario', fact: '#fc-direccion-factura' });
  await ev(pg, () => { agregarContactoCliente(); agregarContactoCliente(); }); await W(400);
  await ev(pg, () => { const rows = [...document.querySelectorAll('#fc-contactos-lista > *')]; const v = [['Gabriela Ruiz', 'Gerente de compras', '8812-3344'], ['Mario Torres', 'Contador', 'mario@superlasamericas.com']]; rows.forEach((r, i) => { const ins = r.querySelectorAll('input'); if (v[i]) ins.forEach((x, j) => { if (v[i][j]) { x.value = v[i][j]; x.dispatchEvent(new Event('input', { bubbles: true })); } }); }); });
  await into(pg, '#fc-contactos-lista', 90); await W(400);
  await shot(pg, 'nc3', { cont: '#fc-contactos-lista', tipo: '#fc-tipo-cliente' });
  await into(pg, '#fc-tipo-cliente', 120); await W(400);
  await shot(pg, 'nc4', { tipo: '#fc-tipo-cliente', help: 'text:Recurrente:@#modal-cliente' });
  await ev(pg, () => { const s = document.getElementById('fc-tipo-cliente'); s.value = 'recurrente'; s.dispatchEvent(new Event('change', { bubbles: true })); try { toggleTipoClienteUI(); } catch (e) {} }); await W(500);
  await ev(pg, () => { const s = document.getElementById('fc-frecuencia-pago'); s.value = 'mensual'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await fill(pg, 'fc-monto-recurrente', '2500'); await fill(pg, 'fc-dia-mes', '5'); await W(300);
  await into(pg, '#fc-frecuencia-pago', 80); await W(400);
  await shot(pg, 'nc5', { frec: '#fc-frecuencia-pago', monto: '#fc-monto-recurrente', dia: '#fc-dia-mes' });
  await fill(pg, 'fc-ya-pago-actual', true); await W(500); await fill(pg, 'fc-ya-pago-iva-activo', true); await W(400);
  await into(pg, '#fc-ya-pago-actual', 60); await W(400);
  await shot(pg, 'nc6', { ya: 'up:#fc-ya-pago-actual||label', caja: 'text:Agregar el dinero a Caja@#modal-cliente', yaest: 'text:El dinero ya está agregado@#modal-cliente', iva: 'up:#fc-ya-pago-iva-activo||label', nota: 'text:La próxima fecha de pago@#modal-cliente' });
  await ev(pg, () => closeModal('modal-cliente')); await W(500);
  // ---- profile
  await ev(pg, () => abrirPerfil(4)); await W(1800);
  await shot(pg, 'perfil', { box: '#modal-perfil .modal-box, #modal-perfil > div', stats: 'up:#perfil-stat-compras||.perfil-stats, [class*=stats]', s1: 'up:#perfil-stat-compras||div', s2: 'up:#perfil-stat-total||div', s3: 'up:#perfil-stat-ticket||div', s4: 'up:#perfil-stat-primera||div', s5: 'up:#perfil-stat-ultima||div', s7: 'up:#perfil-stat-puntos-card||div', info: '#perfil-telefono' });
  meta.statCards = await ev(pg, () => ['perfil-stat-compras', 'perfil-stat-total', 'perfil-stat-ticket', 'perfil-stat-primera', 'perfil-stat-ultima', 'perfil-stat-num-ventas', 'perfil-stat-puntos-card'].map(id => { let e = document.getElementById(id); for (let i = 0; i < 3 && e; i++) { if (e.getBoundingClientRect().height > 50) break; e = e.parentElement; } const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  await into(pg, '[onclick="abrirModalInteraccion()"]', 80); await W(500);
  await shot(pg, 'perfil2', { bInt: '[onclick="abrirModalInteraccion()"]', intHead: 'text:Interacciones@#modal-perfil' });
  meta.intList = await ev(pg, () => { const b = document.querySelector('[onclick="abrirModalInteraccion()"]'); let c = b.closest('div'); for (let i = 0; i < 4 && c && c.getBoundingClientRect().height < 150; i++) c = c.parentElement; const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await ev(pg, () => abrirModalInteraccion()); await W(800);
  await shot(pg, 'inter', { box: '#modal-interaccion .modal-box, #modal-interaccion > div', tipo: '#modal-interaccion select' });
  await ev(pg, () => closeModal('modal-interaccion')); await W(400);
  await into(pg, '[onclick^="verDetalleVentaPerfil"]', 160); await W(500);
  await shot(pg, 'perfil3', { hist: 'up:[onclick^="verDetalleVentaPerfil"]||table', row: '[onclick^="verDetalleVentaPerfil"]' });
  await ev(pg, () => { const tr = document.querySelector('[onclick^="verDetalleVentaPerfil"]'); tr && tr.click(); }); await W(1500);
  await shot(pg, 'vdet', { box: '#modal-venta-detalle .modal-box, #modal-venta-detalle > div' });
  await ev(pg, () => closeModal('modal-venta-detalle')); await W(400);
  await shot(pg, 'perfil4', { bEdit: 'text:Editar cliente@#modal-perfil', bDel: 'text:Eliminar cliente@#modal-perfil', footer: '#modal-perfil .modal-footer' });
  await ev(pg, () => confirmarEliminar(4, 'Mini Súper Jireh')); await W(800);
  await shot(pg, 'eliminar', { box: '#modal-eliminar .modal-box, #modal-eliminar > div' });
  await ev(pg, () => { closeModal('modal-eliminar'); closeModal('modal-perfil'); }); await W(500);
  await ev(pg, () => abrirModalImportarClientes()); await W(900); await shot(pg, 'importar', { box: '.modal-overlay.open .modal-box, [id*=importar] .modal-box' });
  await ev(pg, () => cerrarModalImportarClientes()); await W(400);
  await ev(pg, () => sincronizarStats()); await W(450); await shot(pg, 'sync', { bSync: '[onclick="sincronizarStats()"]' });
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
