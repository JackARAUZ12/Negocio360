// Capturas del tutorial de Cuentas por Pagar: REPO=<copia con los arreglos> FAKE=fake-cxp.js node capcx.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/xshots/'; fs.mkdirSync(O, { recursive: true });
const meta = {};
const W = ms => new Promise(r => setTimeout(r, ms));
async function shot(pg, n, sels = {}) {
  await W(300); await pg.screenshot({ path: O + n + '_top.jpg', type: 'jpeg', quality: 93 });
  meta[n] = await pg.evaluate(sels => { const o = {}; for (const [k, s] of Object.entries(sels)) { let e = null;
    if (s.startsWith('text:')) { const [t, sc] = s.slice(5).split('@'); e = [...document.querySelectorAll((sc || 'body') + ' *')].filter(x => x.getClientRects().length && x.children.length < 3 && x.textContent.trim().startsWith(t)).pop(); }
    else if (s.startsWith('up:')) { const [sel, up] = s.slice(3).split('||'); const x = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length); e = x && (x.closest(up) || x); }
    else e = [...document.querySelectorAll(s)].find(x => x.getClientRects().length) || null;
    if (e) { const r = e.getBoundingClientRect(); o[k] = [r.x, r.y, r.width, r.height].map(Math.round); } else o[k] = null; } return o; }, sels);
  console.log('shot', n, JSON.stringify(meta[n]));
}
const ev = (pg, f, a) => pg.evaluate(f, a);
const fill = (pg, id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); if (!e) return; if (e.type === 'checkbox') { if (e.checked !== v) e.click(); return; } e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const rects = (pg, s) => pg.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }), s);
const openList = (pg, id, hi) => pg.evaluate(([id, hi]) => { document.querySelectorAll('.fake-dd').forEach(x => x.remove()); const s = document.getElementById(id); const r = s.getBoundingClientRect(); const d = document.createElement('div'); d.className = 'fake-dd';
  d.style.cssText = `position:fixed;left:${r.x}px;top:${r.bottom + 4}px;width:${Math.max(r.width, 260)}px;background:#fff;border:1px solid #d6d9e0;border-radius:10px;box-shadow:0 14px 34px rgba(20,24,40,.18);z-index:99999;padding:5px;font:14px 'Plus Jakarta Sans',Inter,sans-serif;color:#1d2433`;
  [...s.options].forEach(o => { const it = document.createElement('div'); it.textContent = o.textContent; const on = hi ? o.value === hi || o.textContent.includes(hi) : o.selected; it.style.cssText = `padding:7px 11px;border-radius:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${on ? 'background:#5B5BF0;color:#fff;font-weight:600' : ''}`; d.appendChild(it); });
  document.body.appendChild(d); }, [id, hi || null]);
const closeList = pg => pg.evaluate(() => document.querySelectorAll('.fake-dd').forEach(x => x.remove()));
const scrollBody = (pg, modal, to) => pg.evaluate(([m, to]) => { const e = typeof to === 'string' ? document.querySelector(to) : document.querySelector(`#${m} .modal-body`); let b = e; while (b && !(b.scrollHeight > b.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(b).overflowY))) b = b.parentElement; if (!b) return; if (typeof to === 'string') b.scrollTop += e.getBoundingClientRect().top - b.getBoundingClientRect().top - 20; else b.scrollTop = to; }, [modal, to]);
const hideToast = pg => ev(pg, () => { const t = document.getElementById('toast'); if (t) t.classList.remove('toast-show'); });
const open = (b, file = 'cuentas-por-pagar.html') => openDash(b, { file, clean: true, wait: 7000 });

const NC = 'modal-nueva-cuenta', NCB = '#modal-nueva-cuenta .modal-box', CD = 'modal-nueva-cuenta-directa', CDB = '#modal-nueva-cuenta-directa .modal-box', PGB = '#modal-pagar-cxp .modal-box';
(async () => {
  const b = await chromium.launch();
  // ---------- vista principal
  let pg = await open(b);
  meta.kpis = await rects(pg, '.kpi-card');
  meta.filtros = await rects(pg, '.filter-btn[data-filtro]');
  meta.ths = await rects(pg, 'thead th');
  meta.rows = await rects(pg, '#cxp-tbody tr');
  meta.estados = await rects(pg, '#cxp-tbody td:nth-child(9) .status-badge');
  meta.r0btns = await rects(pg, '#cxp-tbody tr:nth-child(1) .td-actions button');
  meta.r2btns = await rects(pg, '#cxp-tbody tr:nth-child(3) .td-actions button');
  await shot(pg, 'base', { kpiRow: '.kpi-grid', search: '.search-wrap', bPagar: '.greeting-actions .btn-ghost', bDirecta: '.greeting-actions .btn-ghost:nth-child(2)', bNueva: '.greeting-actions .btn-primary', table: '.panel-card .table-wrap', nav: '.nav-item.active', filtrosRow: '.filtros-row', title: '.greeting-text' });
  await ev(pg, () => setFiltroCxP('vencido')); await shot(pg, 'f_vencido', { table: '.panel-card .table-wrap' });
  await ev(pg, () => setFiltroCxP('cuotas')); await shot(pg, 'f_cuotas', { table: '.panel-card .table-wrap' });
  await ev(pg, () => setFiltroCxP('todos'));
  await fill(pg, 'cxp-search', 'FAC-20871'); await shot(pg, 'search', { search: '.search-wrap', row0: '#cxp-tbody tr' });
  await fill(pg, 'cxp-search', '');
  // ---------- nueva compra
  await ev(pg, () => abrirNuevaCuenta()); await W(500);
  const SNC = { box: NCB, prov: '#np-proveedor-select', bNewProv: '[onclick="toggleNuevoProveedorCxP(true)"]', fecha: '#np-fecha', factura: '#np-factura', psearch: '#np-producto-search', bPN: '[onclick="toggleProductoNuevoCxP()"]', iva: '.iva-row', cart: '#np-carrito-tbody' };
  await shot(pg, 'nc0', SNC);
  await openList(pg, 'np-proveedor-select', 'Molinos'); await shot(pg, 'nc_prov', { ...SNC, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => toggleNuevoProveedorCxP(true)); await shot(pg, 'nc_newprov', { ...SNC, form: '#np-nuevo-proveedor-form' }); await ev(pg, () => toggleNuevoProveedorCxP(false));
  await ev(pg, () => { const s = document.getElementById('np-proveedor-select'); s.value = 'pv2'; onSelectProveedorCxP(); });
  await fill(pg, 'np-factura', 'FAC-20915');
  await shot(pg, 'nc_fill', SNC);
  await fill(pg, 'np-producto-search', 'arroz'); await shot(pg, 'nc_search', { ...SNC, res: '#np-search-results' });
  await ev(pg, () => agregarProductoAlCarritoCxP('p2')); await fill(pg, 'np-producto-search', 'aceite'); await ev(pg, () => agregarProductoAlCarritoCxP('p1'));
  await ev(pg, () => { actualizarLineaCarritoCxP(0, 'cantidad', 10); actualizarLineaCarritoCxP(1, 'cantidad', 48); actualizarLineaCarritoCxP(1, 'descuento', 100); });
  await scrollBody(pg, NC, '.nc-paso-title');
  meta.cartIn = await rects(pg, '#np-carrito-tbody tr:nth-child(2) input');
  await shot(pg, 'nc_cart', { ...SNC, line0: '#np-carrito-tbody tr', table: 'up:#np-carrito-tbody||table' });
  await ev(pg, () => toggleProductoNuevoCxP(true));
  await ev(pg, () => { const v = { 'pn-nombre': 'Maní salado 1 lb', 'pn-categoria': 'Abarrotes', 'pn-sku': 'DT-3001', 'pn-costo': '38', 'pn-precio': '55', 'pn-cantidad': '50' }; for (const k in v) document.getElementById(k).value = v[k]; });
  await scrollBody(pg, NC, '.nc-paso-title');
  await shot(pg, 'nc_pn', { ...SNC, form: '#np-producto-nuevo-form', bCrear: '#btn-crear-producto-cxp' });
  await ev(pg, () => crearProductoNuevoCxP()); await W(700); await scrollBody(pg, NC, '.nc-paso-title');
  await shot(pg, 'nc_pn2', { ...SNC, line2: '#np-carrito-tbody tr:nth-child(3)', toast: '#toast' }); await hideToast(pg);
  await fill(pg, 'np-iva-activo', true); await W(200); await scrollBody(pg, NC, '.iva-row');
  await shot(pg, 'nc_iva', { ...SNC, pct: '#np-iva-porcentaje-wrap', resumen: '.resumen-card', imp: 'up:#np-resumen-iva||.resumen-fila' });
  await scrollBody(pg, NC, '.resumen-card');
  await shot(pg, 'nc_res', { box: NCB, resumen: '.resumen-card', bloque: '#np-bloque-credito', ff: '#tc-opt-fecha_fija', cu: '#tc-opt-cuotas' });
  await fill(pg, 'np-fecha-vencimiento', '2026-11-09'); await scrollBody(pg, NC, '#np-bloque-credito');
  await shot(pg, 'nc_ff', { box: NCB, bloque: '#np-bloque-credito', ff: '#tc-opt-fecha_fija', cu: '#tc-opt-cuotas', fv: '#np-form-fecha-fija', bGuardar: '#np-btn-guardar' });
  await ev(pg, () => { document.querySelector('input[name="np-tipo-credito"][value="cuotas"]').checked = true; seleccionarTipoCreditoCxP('cuotas'); });
  await fill(pg, 'np-num-cuotas', '3'); await fill(pg, 'np-fecha-primera-cuota', '2026-11-09'); await scrollBody(pg, NC, '#np-bloque-credito');
  const SCU = { box: NCB, bloque: '#np-bloque-credito', cu: '#tc-opt-cuotas', num: '#np-num-cuotas', f1: '#np-fecha-primera-cuota', freq: '#np-frecuencia', prev: '#np-cuotas-preview', bGuardar: '#np-btn-guardar' };
  await shot(pg, 'nc_cuotas', SCU);
  await openList(pg, 'np-frecuencia'); await shot(pg, 'nc_freq', { ...SCU, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => guardarNuevaCuentaCxP()); await W(1800);
  await shot(pg, 'saved', { toast: '#toast', row0: '#cxp-tbody tr', kpiRow: '.kpi-grid' }); await hideToast(pg);
  // ---------- cuenta directa
  await ev(pg, () => abrirNuevaCuentaDirecta()); await W(500);
  await ev(pg, () => { const s = document.getElementById('ncd-proveedor-select'); s.value = 'pv7'; onSelectProveedorDirecto(); document.getElementById('ncd-clase').value = 'servicio'; });
  await fill(pg, 'ncd-concepto', 'Reparación del camión Hino'); await fill(pg, 'ncd-monto', '30000');
  const SCD = { box: CDB, nota: `#${CD} .modal-body > p`, prov: '#ncd-proveedor-select', concepto: '#ncd-concepto', clase: '#ncd-clase', monto: '#ncd-monto', fecha: '#ncd-fecha', prima: '#ncd-prima-tipo', primaV: '#ncd-prima-valor' };
  await shot(pg, 'cd0', SCD);
  await scrollBody(pg, CD, '#ncd-concepto');
  await openList(pg, 'ncd-prima-tipo', 'fija'); await shot(pg, 'cd_primadd', { ...SCD, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { document.getElementById('ncd-prima-tipo').value = 'fija'; onCambioMontoODatosDirecto(); }); await fill(pg, 'ncd-prima-valor', '6000'); await W(500);
  await scrollBody(pg, CD, '#ncd-concepto');
  const SPR = { box: CDB, primaRow: 'up:#ncd-prima-tipo||.form-group', metodo: '#ncd-metodo-prima', origen: '#ncd-wrap-origen', resumen: '#ncd-prima-resumen', tipo: 'up:#ncd-tipo-fecha-fija||.form-group' };
  await shot(pg, 'cd_prima', SPR);
  await openList(pg, 'ncd-origen-caja'); await shot(pg, 'cd_origen', { ...SPR, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => setTipoCreditoDirecto('cuotas')); await W(200); await scrollBody(pg, CD, '#ncd-wrap-origen');
  await shot(pg, 'cd_tipo', { box: CDB, tipo: 'up:#ncd-tipo-fecha-fija||.form-group', interes: 'up:#ncd-interes-no||.form-group' });
  await ev(pg, () => setTieneInteresDirecto(true)); await fill(pg, 'ncd-tasa-interes', '2'); await fill(pg, 'ncd-num-cuotas', '4'); await fill(pg, 'ncd-fecha-primera-cuota', '2026-11-15'); await W(300);
  await scrollBody(pg, CD, 'up:x' && '#ncd-wrap-cuotas');
  const SAM = { box: CDB, interes: 'up:#ncd-interes-no||.form-group', detalle: '#ncd-wrap-interes-detalle', metodo: '#ncd-metodo-amortizacion', modo: 'up:#ncd-modo-auto||.form-group', num: '#ncd-wrap-num-cuotas', tabla: '#ncd-amortizacion-wrap', tot: '#ncd-total-intereses-resumen' };
  await shot(pg, 'cd_int', SAM);
  await openList(pg, 'ncd-metodo-amortizacion'); await shot(pg, 'cd_metdd', { ...SAM, dd: '.fake-dd' }); await closeList(pg);
  await scrollBody(pg, CD, 'up:x' && '#ncd-wrap-num-cuotas');
  await shot(pg, 'cd_amort', SAM);
  await ev(pg, () => setModoCalculoDirecto('manual')); await fill(pg, 'ncd-monto-fijo', '7000'); await W(300); await scrollBody(pg, CD, '#ncd-wrap-interes-detalle');
  await shot(pg, 'cd_manual', { ...SAM, fijo: '#ncd-wrap-monto-fijo', calc: '#ncd-num-cuotas-calculado' });
  await ev(pg, () => closeModal('modal-nueva-cuenta-directa'));
  await pg.context().close();

  // ---------- pagos
  pg = await open(b);
  const SPG = { box: PGB, sel: '#pg-select-cuenta-row', resumen: '#pg-resumen', monto: '#pg-monto', metodo: '#pg-metodo', origen: '#pg-wrap-origen', banco: '#pg-wrap-banco', ret: '#pg-wrap-ret', retC: '#pg-ret-campos', bOk: '#btn-confirmar-pago-cxp' };
  await ev(pg, () => abrirPagarGenerico()); await W(600);
  await openList(pg, 'pg-cuenta-select', 'CXP-000030'); await shot(pg, 'pg_gen', { ...SPG, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => closeModal('modal-pagar-cxp'));
  await ev(pg, () => abrirPagarDesdeTabla('cxp30')); await W(700);
  await shot(pg, 'pg0', SPG);
  await fill(pg, 'pg-monto', '5000'); await shot(pg, 'pg_parcial', SPG); await fill(pg, 'pg-monto', '13440');
  await openList(pg, 'pg-metodo'); await shot(pg, 'pg_metdd', { ...SPG, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { const s = document.getElementById('pg-metodo'); s.value = 'transferencia'; s.dispatchEvent(new Event('change')); }); await W(500);
  await openList(pg, 'pg-banco', 'BANPRO'); await shot(pg, 'pg_banco', { ...SPG, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { const s = document.getElementById('pg-metodo'); s.value = 'efectivo'; s.dispatchEvent(new Event('change')); }); await W(500);
  await openList(pg, 'pg-origen-caja'); await shot(pg, 'pg_origen', { ...SPG, dd: '.fake-dd' }); await closeList(pg);
  await ev(pg, () => { confirmarPagoCxP(); }); await W(1200);
  await shot(pg, 'pg_aviso', { box: '#aviso-efectivo-overlay [role=dialog]' });
  await ev(pg, () => document.querySelector('#aviso-efectivo-overlay [data-ae="cambiar"]').click()); await W(300); await hideToast(pg);
  await ev(pg, () => { const s = document.getElementById('pg-metodo'); s.value = 'transferencia'; s.dispatchEvent(new Event('change')); }); await W(500);
  await ev(pg, () => { document.getElementById('pg-banco').value = 'b1'; }); await fill(pg, 'pg-ret-chk', true); await W(300);
  await shot(pg, 'pg_ret', SPG);
  await ev(pg, () => confirmarPagoCxP()); await W(1800);
  await shot(pg, 'comp', { box: '#modal-comprobante-cxp .modal-box', body: '#comprobante-cxp-body', saldos: 'text:Saldo anterior@#comprobante-cxp-body', bPrint: '#modal-comprobante-cxp .btn-primary', ret: 'text:Retención IR@#comprobante-cxp-body' });
  await ev(pg, () => closeModal('modal-comprobante-cxp')); await hideToast(pg);
  await pg.context().close();

  // ---------- detalle, editar y anular
  pg = await open(b);
  await ev(pg, () => verDetalleCxP('cxp28')); await W(900);
  const DB_ = '#modal-detalle-cxp .modal-box';
  meta.detCuotas = await rects(pg, '#detalle-cxp-body table:first-of-type tbody tr');
  await shot(pg, 'det', { box: DB_, head: '#detalle-cxp-body .form-row', cuotas: 'up:#detalle-cxp-body .table-wrap||.table-wrap', payQ: '#detalle-cxp-body button[title="Pagar esta cuota"]', bPagar: '#det-cxp-btn-pagar' });
  await pg.evaluate(() => { let b = document.querySelector('#detalle-cxp-body'); while (b && !(b.scrollHeight > b.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(b).overflowY))) b = b.parentElement; if (b) b.scrollTop = 9999; });
  meta.detEstados = await rects(pg, '#detalle-cxp-body .table-wrap:first-of-type .status-badge');
  await shot(pg, 'det2', { box: DB_, hist: 'text:Historial de pagos@#detalle-cxp-body', histT: '#detalle-cxp-body .table-wrap:last-of-type', cuotas: '#detalle-cxp-body .table-wrap' });
  await ev(pg, () => closeModal('modal-detalle-cxp'));
  await ev(pg, () => abrirEditarCxP('cxp32')); await W(400);
  await shot(pg, 'edit', { box: '#modal-editar-cxp .modal-box', venc: '#ed-venc-wrap', obs: '#ed-observaciones' });
  await ev(pg, () => closeModal('modal-editar-cxp'));
  await ev(pg, () => confirmarEliminarCxP('cxp32')); await W(400);
  await shot(pg, 'anular', { box: '#modal-confirmar-eliminar-cxp .modal-box', bOk: '#btn-confirmar-eliminar-cxp' });
  await ev(pg, () => eliminarCuentaCxP()); await W(1600);
  await shot(pg, 'anulada', { row0: '#cxp-tbody tr', badge: '#cxp-tbody tr .badge-cancelado', toast: '#toast' }); await hideToast(pg);
  await ev(pg, () => confirmarEliminarCxP('cxp30')); await W(300); await ev(pg, () => eliminarCuentaCxP()); await W(1200);
  await shot(pg, 'anular_err', { toast: '#toast', box: '#modal-confirmar-eliminar-cxp .modal-box' });
  await pg.context().close();

  // ---------- otros módulos
  pg = await open(b, 'dashboard.html');
  await ev(pg, () => { const e = document.querySelector('.action-btn[onclick*="cuentas-por-pagar"]'); e && e.scrollIntoView({ block: 'center' }); }); await W(800);
  await shot(pg, 'dash', { card: '.action-btn[onclick*="cuentas-por-pagar"]' });
  await pg.context().close();
  pg = await open(b, 'compras.html'); await W(800);
  await shot(pg, 'compras', { cell: 'text:C-000151' });
  await pg.context().close();
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
