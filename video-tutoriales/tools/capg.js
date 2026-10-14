const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/gshots/';
const meta = {};
const W = ms => new Promise(r => setTimeout(r, ms));
async function shot(pg, n, sels = {}) {
  await W(250); await pg.screenshot({ path: O + n + '_top.jpg', type: 'jpeg', quality: 93 });
  meta[n] = await pg.evaluate(sels => { const o = {}; for (const [k, s] of Object.entries(sels)) { let e = null;
    if (s.startsWith('text:')) { const [t, sc] = s.slice(5).split('@'); e = [...document.querySelectorAll((sc || 'body') + ' *')].filter(x => x.getClientRects().length && x.children.length < 3 && x.textContent.trim().startsWith(t))[0]; }
    else if (s.startsWith('up:')) { const [sel, up] = s.slice(3).split('||'); const x = document.querySelector(sel); e = x && (x.closest(up) || x); }
    else e = [...document.querySelectorAll(s)].find(x => x.getClientRects().length) || null;
    if (e) { const r = e.getBoundingClientRect(); o[k] = [r.x, r.y, r.width, r.height].map(Math.round); } else o[k] = null; } return o; }, sels);
  console.log('shot', n, JSON.stringify(meta[n]));
}
const ev = (pg, f, a) => pg.evaluate(f, a);
const fill = (pg, id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); if (!e) return; if (e.type === 'checkbox') { if (e.checked !== v) e.click(); return; } e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const rects = (pg, s) => pg.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }), s);
// dropdown abierto (los <select> nativos no salen en capturas): lista con las opciones reales
const openList = (pg, id, hi) => pg.evaluate(([id, hi]) => { document.querySelectorAll('.fake-dd').forEach(x => x.remove()); const s = document.getElementById(id); const r = s.getBoundingClientRect(); const d = document.createElement('div'); d.className = 'fake-dd';
  d.style.cssText = `position:fixed;left:${r.x}px;top:${r.bottom + 4}px;width:${r.width}px;background:#fff;border:1px solid #d6d9e0;border-radius:10px;box-shadow:0 14px 34px rgba(20,24,40,.18);z-index:99999;padding:5px;font:14px 'Plus Jakarta Sans',Inter,sans-serif;color:#1d2433`;
  [...s.options].forEach(o => { const it = document.createElement('div'); it.textContent = o.textContent; const on = hi ? o.value === hi || o.textContent === hi : o.selected; it.style.cssText = `padding:7px 11px;border-radius:7px;${on ? 'background:#5B5BF0;color:#fff;font-weight:600' : ''}`; d.appendChild(it); });
  document.body.appendChild(d); }, [id, hi || null]);
const closeList = pg => pg.evaluate(() => document.querySelectorAll('.fake-dd').forEach(x => x.remove()));
const MB = '#modal-gasto .modal-box';
(async () => {
  const b = await chromium.launch();
  const pg = await openDash(b, { file: 'gastos.html', clean: true, wait: 7000 });
  meta.kpis = await rects(pg, '.kpi-card');
  meta.filtros = await rects(pg, '.filtros-row .filter-btn');
  meta.ths = await rects(pg, '.section-panel[data-section="gastos"] thead th');
  await shot(pg, 'base', { kpiRow: '.kpi-grid', tabs: '.section-tabs', tabProg: '.section-tab[data-section="programados"]', panel: '.section-panel[data-section="gastos"] .panel-card', cat: '#filtro-categoria', search: '#gastos-search', bNueva: '.greeting-actions .btn-primary', table: '.section-panel[data-section="gastos"] .table-wrap', row0: '#gastos-tbody tr', eye0: '#gastos-tbody tr [title="Ver detalle"]', edit0: '#gastos-tbody tr [title="Editar"]', can0: '#gastos-tbody tr [title="Cancelar"]' });
  for (const f of ['inmediatos', 'programados', 'pagados']) { await ev(pg, f => setFiltroGastos(f), f); await W(700); await shot(pg, 'f_' + f, {}); }
  await ev(pg, () => setFiltroGastos('todos')); await W(600);
  await openList(pg, 'filtro-categoria', 'Combustible'); await shot(pg, 'f_catlist', { dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { const s = document.getElementById('filtro-categoria'); s.value = 'Combustible'; setCategoriaFiltro(); }); await W(700); await shot(pg, 'f_cat', { cat: '#filtro-categoria' });
  await ev(pg, () => { const s = document.getElementById('filtro-categoria'); s.value = ''; setCategoriaFiltro(); }); await W(500);
  await fill(pg, 'gastos-search', 'luz'); await W(900); await shot(pg, 'search', { search: '#gastos-search' });
  await fill(pg, 'gastos-search', ''); await W(800);
  // ---- Nuevo gasto
  await ev(pg, () => openNuevoGasto()); await W(1200); await ev(pg, () => { document.getElementById('gasto-categoria').value = 'Electricidad'; toggleCategoriaEspecial(); });
  const SM = { box: MB, tipo: '#gasto-tipo-flujo', cat: '#gasto-categoria', bNew: '[onclick="abrirModalNuevaCategoria()"]', conc: '#gasto-concepto', monto: '#gasto-monto', metodo: '#gasto-metodo', iva: '#gasto-tiene-iva', ivaW: '#gasto-wrap-iva', ret: '#gasto-ret-wrap', banco: '#gasto-banco-wrap', origen: '#gasto-origen-caja-wrap', fecha: '#gasto-fecha', frec: '#gasto-frecuencia-wrap', pagar: '#gasto-checkbox-wrap', emp: '#gasto-empleado-wrap', save: '#btn-save-gasto' };
  await shot(pg, 'm0', SM);
  await openList(pg, 'gasto-tipo-flujo', 'inmediato'); await shot(pg, 'm_tipo', { ...SM, dd: '.fake-dd' }); await closeList(pg);
  await openList(pg, 'gasto-categoria', 'Electricidad'); await shot(pg, 'm_cat', { ...SM, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => abrirModalNuevaCategoria()); await W(700);
  await ev(pg, () => { const i = document.querySelector('#modal-nueva-categoria input'); if (i) { i.value = 'Fumigación'; i.dispatchEvent(new Event('input')); } });
  await shot(pg, 'm_newcat', { box: '#modal-nueva-categoria .modal-box', inp: '#modal-nueva-categoria input', btn: '#btn-guardar-categoria' });
  await ev(pg, () => closeModal('modal-nueva-categoria')); await W(500);
  await fill(pg, 'gasto-concepto', 'Recibo de luz de octubre'); await shot(pg, 'm_conc', SM);
  await fill(pg, 'gasto-monto', '4850'); await shot(pg, 'm_monto', SM);
  await openList(pg, 'gasto-metodo', 'transferencia'); await shot(pg, 'm_met', { ...SM, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { const s = document.getElementById('gasto-metodo'); s.value = 'transferencia'; onCambiarMetodoGasto('gasto'); }); await W(900);
  await ev(pg, () => { const s = document.getElementById('gasto-banco'); if (s && s.options.length > 1) s.selectedIndex = 1; });
  await shot(pg, 'm_banco', SM);
  await ev(pg, () => { const s = document.getElementById('gasto-metodo'); s.value = s.options[0].value; onCambiarMetodoGasto('gasto'); }); await W(600);
  await shot(pg, 'm_origen', SM);
  await openList(pg, 'gasto-origen-caja', 'general'); await shot(pg, 'm_origen_dd', { ...SM, dd: '.fake-dd' }); await closeList(pg);
  await fill(pg, 'gasto-tiene-iva', true); await ev(pg, () => onToggleIvaGasto('gasto')); await W(300); await fill(pg, 'gasto-iva', '632.61'); await shot(pg, 'm_iva', SM);
  await ev(pg, () => { document.getElementById('gasto-ret-wrap').open = true; document.getElementById('gasto-ret-chk').checked = true; }); await W(300);
  await shot(pg, 'm_ret', SM);
  await ev(pg, () => { document.getElementById('gasto-ret-wrap').open = false; document.getElementById('gasto-ret-chk').checked = false; });
  await shot(pg, 'm_full', SM);
  // salarios
  await ev(pg, () => { document.getElementById('gasto-categoria').value = 'Salarios'; toggleCategoriaEspecial(); document.getElementById('gasto-tiene-iva').checked = false; onToggleIvaGasto('gasto'); });
  await fill(pg, 'gasto-empleado', 'Luis Hernández'); await fill(pg, 'gasto-concepto', 'Salario quincena'); await fill(pg, 'gasto-monto', '9500'); await W(300);
  await shot(pg, 'm_sal', SM);
  await ev(pg, () => closeModal('modal-gasto')); await W(500);
  // guardado: fila nueva arriba + KPIs actualizados + toast
  await ev(pg, () => { const tb = document.getElementById('gastos-tbody'); const r = tb.rows[1].cloneNode(true); r.querySelector('.concepto-text').textContent = 'Recibo de luz de octubre'; const o = r.querySelector('.concepto-obs'); if (o) o.remove(); tb.insertBefore(r, tb.rows[0]); r.style.background = 'rgba(91,91,240,.07)';
    const set = (id, v) => document.getElementById(id).textContent = v; set('kpi-gastos-hoy', 'NIO 12,000.00'); set('kpi-gastos-mes', 'NIO 31,280.00'); set('kpi-gastos-anio', 'NIO 564,930.00'); const T = document.getElementById('toast'); T.textContent = 'Gasto registrado correctamente'; T.className = 'toast toast-success toast-show'; });
  await W(600); await shot(pg, 'saved', { row0: '#gastos-tbody tr', toast: '#toast, .toast, [class*=toast]' });
  await ev(pg, () => document.getElementById('toast').classList.remove('toast-show')); await W(600);
  // ---- programado
  await ev(pg, () => { openNuevoGasto(); }); await W(1000);
  await ev(pg, () => { document.getElementById('gasto-tipo-flujo').value = 'programado'; toggleTipoGasto(); document.getElementById('gasto-categoria').value = 'Alquiler'; toggleCategoriaEspecial(); document.getElementById('gasto-fecha').value = '2026-11-05'; });
  await fill(pg, 'gasto-concepto', 'Alquiler de local de ventas'); await fill(pg, 'gasto-monto', '8500'); await W(300);
  await ev(pg, () => { const s = document.getElementById('gasto-frecuencia'); s.value = 'mensual'; });
  await shot(pg, 'p_m', SM);
  await openList(pg, 'gasto-frecuencia', 'mensual'); await shot(pg, 'p_frec', { ...SM, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => closeModal('modal-gasto')); await W(500);
  // ---- pestaña programados
  await ev(pg, () => setSection('programados')); await W(1000);
  const PR = '#programados-tbody';
  meta.prows = await rects(pg, PR + ' tr');
  meta.pvenc = await rects(pg, PR + ' tr td:nth-child(5)');
  await shot(pg, 'prog', { tab: '.section-tab[data-section="programados"]', table: '.section-panel[data-section="programados"] .table-wrap', bNew: '.section-panel[data-section="programados"] .panel-actions .btn-primary', reg: PR + ' tr:nth-child(3) .btn-primary', edit: PR + ' tr:nth-child(1) [title="Editar"]', pause: PR + ' tr:nth-child(1) [title="Pausar"]', paused: PR + ' tr:nth-child(6)', react: PR + ' [title="Reactivar"]' });
  await ev(pg, () => abrirRegistrarPago('gp3')); await W(1000);
  await shot(pg, 'rp', { box: '#modal-registrar-pago .modal-box', btn: '#btn-confirmar-pago' });
  await ev(pg, () => closeModal('modal-registrar-pago')); await W(500);
  await ev(pg, () => editarProgramado('gp1')); await W(900);
  await shot(pg, 'ep', { box: '#modal-editar-programado .modal-box', monto: '#edit-prog-monto', frec: '#edit-prog-frecuencia' });
  await ev(pg, () => closeModal('modal-editar-programado')); await W(500);
  // ---- ver / editar / cancelar
  await ev(pg, () => setSection('gastos')); await W(1000);
  await ev(pg, () => verDetalleGasto('g02')); await W(1000);
  await shot(pg, 'det', { box: '#modal-detalle-gasto .modal-box' });
  await ev(pg, () => closeModal('modal-detalle-gasto')); await W(500);
  await ev(pg, () => abrirEditarGastoInmediato('g02')); await W(900);
  await shot(pg, 'eg', { box: '#modal-editar-gasto .modal-box', cat: '#edit-gasto-categoria', conc: '#edit-gasto-concepto', obs: '#edit-gasto-obs' });
  await ev(pg, () => closeModal('modal-editar-gasto')); await W(500);
  await ev(pg, () => confirmarCancelarGasto('g05')); await W(800);
  await ev(pg, () => { const p = document.querySelector('#modal-confirmar-cancelar p'); if (p) p.textContent = '¿Confirmas que deseas cancelar este gasto? Quedará registrado en el historial pero marcado como cancelado.'; });
  await shot(pg, 'can', { box: '#modal-confirmar-cancelar .modal-box', btn: '#btn-confirmar-cancelar' });
  await ev(pg, () => closeModal('modal-confirmar-cancelar')); await W(500);
  await fill(pg, 'gastos-search', 'Papelería'); await W(900);
  await shot(pg, 'cancelado', { row0: '#gastos-tbody tr', badge: '#gastos-tbody .badge-inactive' });
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
