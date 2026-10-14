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

const MM = '#modal-movimiento .modal-box';
const SEC = s => `.section-panel[data-section="${s}"]`;
(async () => {
  const b = await chromium.launch();
  const pg = await openDash(b, { file: 'caja.html', clean: true, wait: 7500 });
  meta.kpis = await rects(pg, '.kpi-card');
  meta.filtros = await rects(pg, SEC('movimientos') + ' .filter-btn');
  meta.ths = await rects(pg, SEC('movimientos') + ' thead th');
  meta.refs = await rects(pg, '#mov-tbody .concepto-ref, #mov-tbody [class*=ref]');
  meta.rows = await rects(pg, '#mov-tbody tr');
  await shot(pg, 'base', { kpiRow: '.kpi-grid', tabs: '.section-tabs', bNuevo: '.greeting-actions .btn-primary', table: SEC('movimientos') + ' .table-wrap', search: '#mov-search', tabCC: '[data-section="cajachica"].section-tab', tabB: '[data-section="bancos"].section-tab', tabT: '[data-section="transferencias"].section-tab', tabC: '[data-section="cierres"].section-tab', anul0: '#mov-tbody tr button' });
  for (const f of ['hoy', 'semana', 'anio', 'año', 'custom', 'personalizado']) { const ok = await pg.evaluate(f => { const bt = [...document.querySelectorAll('.section-panel[data-section="movimientos"] .filter-btn')].find(x => (x.getAttribute('onclick') || '').includes("'" + f + "'")); if (bt) { bt.click(); return true; } return false; }, f); if (ok) { await W(900); await shot(pg, 'f_' + f, { custom: '[id*=custom], [id*=fecha-desde]' }); } }
  await pg.evaluate(() => { const bt = [...document.querySelectorAll('.section-panel[data-section="movimientos"] .filter-btn')].find(x => (x.getAttribute('onclick') || '').includes("'mes'")); bt && bt.click(); }); await W(800);
  await fill(pg, 'mov-search', 'Venta'); await W(1000); await shot(pg, 'search', {}); await fill(pg, 'mov-search', ''); await W(900);
  // primera vez
  await ev(pg, () => openModal('modal-capital-inicial')); await W(500); await fill(pg, 'capital-inicial-monto', '120000');
  await shot(pg, 'capini', { box: '#modal-capital-inicial .modal-box, #modal-capital-inicial > div', inp: '#capital-inicial-monto' });
  await ev(pg, () => closeModal('modal-capital-inicial')); await W(400);
  // movimiento manual
  await ev(pg, () => loadBancos()); await W(800);
  await ev(pg, () => openNuevoMovimiento()); await W(900);
  const SM = { box: MM, flujo: '#mov-flujo', tipo: '#mov-tipo', conc: '#mov-concepto', monto: '#mov-monto', metodo: '#mov-metodo', banco: '#mov-wrap-banco', fecha: '#mov-fecha', obs: '#mov-obs' };
  await shot(pg, 'mm0', SM);
  await openList(pg, 'mov-flujo'); await shot(pg, 'mm_flujo', { ...SM, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { const s = document.getElementById('mov-flujo'); s.value = 'EGRESO'; toggleTipoMovimiento(); }); await W(300);
  await openList(pg, 'mov-tipo'); await shot(pg, 'mm_tipo', { ...SM, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { const s = document.getElementById('mov-tipo'); const o = [...s.options].find(o => /Pago a proveedor/i.test(o.textContent)); if (o) s.value = o.value; });
  await fill(pg, 'mov-concepto', 'Pago de flete a transportista'); await fill(pg, 'mov-monto', '2500'); await W(200);
  await shot(pg, 'mm_fill', SM);
  await ev(pg, () => { const s = document.getElementById('mov-metodo'); const o = [...s.options].find(o => /transfer/i.test(o.textContent)); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } try { actualizarBancoMovimiento(); } catch (e) {} }); await W(700);
  await ev(pg, () => { const s = document.getElementById('mov-banco'); if (s && s.options.length > 1) { s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  await shot(pg, 'mm_banco', SM);
  await ev(pg, () => closeModal('modal-movimiento')); await W(400);
  await ev(pg, () => confirmarAnular('mf30')); await W(700);
  await shot(pg, 'anular', { box: '#modal-confirmar .modal-box' });
  await ev(pg, () => closeModal('modal-confirmar')); await W(400);
  // ---- Caja Chica
  await ev(pg, () => setSection('cajachica')); await W(1500);
  const open0 = await ev(pg, () => JSON.stringify(CC.sesionHoy));
  await shot(pg, 'cc_open', { card: '#cc-estado-card', vivo: '#cc-resumen-vivo', bCerrar: '[onclick="abrirModalConteo(\'cierre\')"]', hist: '#cc-historial-tbody', histT: SEC('cajachica') + ' .panel-card:last-child, ' + SEC('cajachica') + ' table' });
  meta.ccHistCols = await rects(pg, SEC('cajachica') + ' thead th');
  meta.ccHistRows = await rects(pg, '#cc-historial-tbody tr');
  await ev(pg, () => { CC.sesionHoy = null; renderEstadoCajaChica(); try { actualizarBotonMontoAnterior(); } catch (e) {} }); await W(700);
  await shot(pg, 'cc_sin', { card: '#cc-estado-card', bNuevo: '[onclick="abrirModalConteo(\'apertura\')"]', bAyer: '#btn-abrir-monto-anterior' });
  await ev(pg, () => abrirModalConteo('apertura')); await W(800);
  await shot(pg, 'cc_cont0', { box: '#modal-conteo-billetes .modal-box', grid: '#cc-denominaciones-grid', total: '#cc-total-contado' });
  await ev(pg, () => { const v = { NIO: { '1000': 1, '500': 2, '200': 3, '100': 3, '50': 2, '20': 5 }, USD: { '20': 1, '5': 1 } }; document.querySelectorAll('.cc-denom-input').forEach(i => { const x = (v[i.dataset.moneda] || {})[String(Number(i.dataset.valor))]; if (x) i.value = x; }); actualizarTotalContado(); }); await W(400);
  await shot(pg, 'cc_cont1', { box: '#modal-conteo-billetes .modal-box', grid: '#cc-denominaciones-grid', total: '#cc-total-contado', usd: '#cc-sub-USD', nio: '#cc-sub-NIO' });
  meta.ccDenom = await rects(pg, '.cc-denom-input');
  await ev(pg, () => { document.querySelectorAll('#modal-conteo-billetes *').forEach(e => { if (e.scrollHeight > e.clientHeight + 5 && getComputedStyle(e).overflowY !== 'visible') e.scrollTop = 99999; }); const t = document.getElementById('cc-total-contado'); t && t.scrollIntoView({ block: 'end' }); }); await W(300);
  await shot(pg, 'cc_cont1b', { box: '#modal-conteo-billetes .modal-box', total: '#cc-total-contado', usd: '#cc-sub-USD' });
  await ev(pg, () => closeModal('modal-conteo-billetes')); await W(400);
  await ev(pg, (s) => { CC.sesionHoy = JSON.parse(s); renderEstadoCajaChica(); }, open0); await W(900);
  await ev(pg, () => abrirModalConteo('cierre')); await W(800);
  await ev(pg, () => { const v = { NIO: { '1000': 2, '500': 2, '200': 4, '100': 3, '50': 2 } }; document.querySelectorAll('.cc-denom-input').forEach(i => { const x = (v[i.dataset.moneda] || {})[String(Number(i.dataset.valor))]; if (x) i.value = x; }); actualizarTotalContado(); }); await W(400);
  await ev(pg, () => { document.querySelectorAll('#modal-conteo-billetes *').forEach(e => { if (e.scrollHeight > e.clientHeight + 5 && getComputedStyle(e).overflowY !== 'visible') e.scrollTop = 99999; }); const t = document.getElementById('cc-total-contado'); t && t.scrollIntoView({ block: 'end' }); }); await W(300);
  await shot(pg, 'cc_cierre', { box: '#modal-conteo-billetes .modal-box', total: '#cc-total-contado', titulo: '#cc-conteo-titulo' });
  await ev(pg, () => closeModal('modal-conteo-billetes')); await W(400);
  await ev(pg, (s) => { const o = JSON.parse(s); Object.assign(o, { estado: 'cerrada', monto_cierre_teorico: 4200, monto_cierre_real: 4200, diferencia: 0, cerrada_en: '2026-10-10T18:30:00-06:00', cerrada_por: 'Carlos Torres' }); CC.sesionHoy = o; renderEstadoCajaChica(); }, open0); await W(900);
  await shot(pg, 'cc_cerrada', { card: '#cc-estado-card', hist: '#cc-historial-tbody' });
  await ev(pg, () => verReporteCC('cch0')); await W(1500);
  await shot(pg, 'cc_rep', { box: '#modal-reporte-cc .modal-box', body: '#cc-reporte-body', btns: '#modal-reporte-cc .modal-footer' });
  await ev(pg, () => closeModal('modal-reporte-cc')); await W(400);
  // ---- Bancos
  await ev(pg, () => setSection('bancos')); await W(1500);
  meta.bcards = await rects(pg, '#bancos-grid > *');
  await shot(pg, 'bancos', { grid: '#bancos-grid', tasa: '#tasa-cambio-wrap', bNuevo: '[onclick="abrirNuevoBanco()"]', conc: '#bancos-grid [onclick^="abrirConciliarBanco"]' });
  await ev(pg, () => abrirNuevoBanco()); await W(700);
  for (const [id, v] of [['nb-nombre', 'Ficohsa'], ['nb-numero-cuenta', '4410-2231-0087'], ['nb-saldo-inicial', '25000'], ['nb-comision', '2.5']]) await fill(pg, id, v);
  await ev(pg, () => { const s = document.getElementById('nb-moneda'); s.value = 'USD'; s.dispatchEvent(new Event('change', { bubbles: true })); try { actualizarAvisoMonedaBanco(); } catch (e) {} }); await W(300);
  await shot(pg, 'nb', { box: '#modal-nuevo-banco .modal-box', nombre: '#nb-nombre', cuenta: '#nb-numero-cuenta', moneda: '#nb-moneda', aviso: '#nb-moneda-aviso', saldo: '#nb-saldo-inicial', com: '#nb-comision' });
  await ev(pg, () => closeModal('modal-nuevo-banco')); await W(400);
  // conciliación
  await ev(pg, () => abrirConciliarBanco('b1', 'BANPRO')); await W(1500);
  await shot(pg, 'conc0', { box: '#modal-conciliar-banco .modal-box', saldo: '#cb-saldo-banco', dif: '#cb-diferencia', tbody: '#cb-movimientos-tbody' });
  await ev(pg, () => { CONC.movimientos.forEach(m => CONC.marcados.add(m.id)); renderMovimientosConciliacion(); });
  await ev(pg, () => { const i = document.getElementById('cb-saldo-banco'); i.value = String(Math.round((CONC.saldoReconciliadoPrevio + CONC.movimientos.reduce((s, m) => s + (m.tipo_flujo === 'INGRESO' ? 1 : -1) * Number(m.monto), 0) - 35) * 100) / 100); i.dispatchEvent(new Event('input', { bubbles: true })); recalcularDiferenciaConciliacion(); }); await W(400);
  await shot(pg, 'conc1', { box: '#modal-conciliar-banco .modal-box', saldo: '#cb-saldo-banco', calc: '#cb-saldo-calculado', dif: '#cb-diferencia', tbody: '#cb-movimientos-tbody' });
  await ev(pg, () => { abrirAgregarAjusteConciliacion(); }); await W(300);
  await fill(pg, 'cb-ajuste-concepto', 'Comisión bancaria'); await fill(pg, 'cb-ajuste-monto', '35');
  await shot(pg, 'conc2', { box: '#modal-conciliar-banco .modal-box', form: '#cb-ajuste-form', dif: '#cb-diferencia' });
  await ev(pg, () => { document.getElementById('cb-ajuste-form').style.display = 'none'; const i = document.getElementById('cb-saldo-banco'); i.value = String(Number(i.value) + 35); recalcularDiferenciaConciliacion(); }); await W(300);
  await shot(pg, 'conc3', { box: '#modal-conciliar-banco .modal-box', dif: '#cb-diferencia', btn: '[onclick="cerrarConciliacion()"]' });
  await ev(pg, () => closeModal('modal-conciliar-banco')); await W(400);
  // ---- Transferencias
  await ev(pg, () => setSection('transferencias')); await W(1300);
  await shot(pg, 'trans', { table: '#transferencias-tbody', bNueva: '[onclick="abrirNuevaTransferencia()"]', rev: '#transferencias-tbody [onclick^="revertirTransferencia"]' });
  await ev(pg, () => abrirNuevaTransferencia()); await W(1500);
  await ev(pg, () => { const o = document.getElementById('tr-origen'), d = document.getElementById('tr-destino'); const fo = [...o.options].find(x => /Caja Chica/.test(x.textContent)); const fd = [...d.options].find(x => /BANPRO/.test(x.textContent)); if (fo) o.value = fo.value; if (fd) d.value = fd.value; });
  await fill(pg, 'tr-monto', '3000'); await fill(pg, 'tr-nota', 'Depósito de efectivo del día');
  await shot(pg, 'tr_m', { box: '#modal-transferencia .modal-box', o: '#tr-origen', d: '#tr-destino', monto: '#tr-monto' });
  await ev(pg, () => closeModal('modal-transferencia')); await W(400);
  // ---- Cierres
  await ev(pg, () => setSection('cierres')); await W(1300);
  meta.czCols = await rects(pg, SEC('cierres') + ' thead th');
  await shot(pg, 'cierres', { table: '#cierres-tbody', bHoy: '[onclick="crearCierreDiario()"]', bMes: '[onclick="crearCierreMensual()"]', link: '#cierres-tbody a, #cierres-tbody [onclick^="verDetalleCierre"]' });
  await ev(pg, () => { const e = document.querySelector('#cierres-tbody [onclick^="verDetalleCierre"]'); e && e.click(); }); await W(1500);
  await shot(pg, 'cz_det', { box: '#modal-detalle-cierre .modal-box', pdf: '#dc-btn-pdf', res: '#dc-resumen' });
  await ev(pg, () => closeModal('modal-detalle-cierre')); await W(400);
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  // ---- Configuración: cierres automáticos
  const p2 = await openDash(b, { file: 'configuracion.html', clean: true, wait: 7000 });
  await p2.evaluate(() => { const t = [...document.querySelectorAll('.cfg-card-title')].find(x => /Cierres de caja autom/.test(x.textContent)); const c = t.closest('.cfg-card') || t.parentElement.parentElement; c.scrollIntoView({ block: 'center' }); });
  await W(800);
  meta.cfg = await p2.evaluate(() => { const t = [...document.querySelectorAll('.cfg-card-title')].find(x => /Cierres de caja autom/.test(x.textContent)); const c = t.closest('.cfg-card') || t.parentElement.parentElement; const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await p2.screenshot({ path: O + 'cfg_top.jpg', type: 'jpeg', quality: 93 }); console.log('cfg', meta.cfg);
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
