const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/coshots/';
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
const rect = (pg, s) => pg.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }, s);
const rects = (pg, s) => pg.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }), s);
const hideCxP = pg => pg.evaluate(() => { [...document.querySelectorAll('#modal-nueva-compra span')].forEach(s => { if (/Cuentas por pagar disponibles/.test(s.textContent)) s.style.display = 'none'; }); });
const sp = '#modal-nueva-compra .modal-box';
(async () => {
  const b = await chromium.launch();
  let pg = await openDash(b, { file: 'compras.html', clean: true, wait: 6500 });
  meta.kpis = await rects(pg, '.kpi-card');
  meta.filtros = await rects(pg, '.filter-btn[data-filtro]');
  await shot(pg, 'base', { kpiRow: 'up:#kpi-hoy||.kpi-grid, .kpis-grid, [class*=kpi-row], [class*=kpis]', tabs: '.section-tab', tabProv: '[data-section="proveedores"]', search: '#compras-search', estadoSel: '#filtro-estado, select', bNueva: '.greeting-actions [onclick="abrirNuevaCompra()"]', bOrd: '[onclick="mostrarSeccionOrdenes()"]', bDir: '[onclick="abrirCompraDirecta()"]', bPers: '[onclick="abrirPersonalizarDocumentos()"]', thead: '#seccion-compras thead', row0: '#compras-tbody tr', eye0: '#compras-tbody tr [title="Ver detalle"]', anul0: '#compras-tbody tr [title="Anular"]', pend: 'text:Pendiente@#compras-tbody', estados: 'up:#compras-tbody tr td:nth-child(8)||td' });
  meta.estadoCol = await pg.evaluate(() => { const r = [...document.querySelectorAll('#compras-tbody tr td:nth-child(8)')].map(e => e.getBoundingClientRect()); const a = r[0], z = r[r.length - 1]; return [a.x, a.y, a.width, z.bottom - a.y].map(Math.round); });
  for (const f of ['hoy', 'semana', 'año', 'custom']) { await ev(pg, f => setFiltro(f), f); await W(800); await shot(pg, 'f_' + (f === 'año' ? 'ano' : f), { custom: '#custom-dates' }); }
  await ev(pg, () => setFiltro('mes')); await W(700);
  await fill(pg, 'compras-search', 'Molinos'); await W(900); await shot(pg, 'search', { search: '#compras-search' });
  await fill(pg, 'compras-search', ''); await W(800);
  // ---- detalle
  await ev(pg, () => verDetalleCompra('cmp3')); await W(1200); await shot(pg, 'detalle', { box: '#modal-detalle .modal-box' }); await ev(pg, () => closeModal('modal-detalle')); await W(400);
  // ---- Nueva compra
  await ev(pg, () => abrirNuevaCompra()); await W(1000);
  await shot(pg, 'nc0', { box: sp, ex: '[onclick="elegirTipoNuevaCompra(\'existente\')"]', nu: '[onclick="elegirTipoNuevaCompra(\'nuevo\')"]' });
  await ev(pg, () => elegirTipoNuevaCompra('existente')); await W(800);
  await shot(pg, 'p1', { box: sp, steps: '#nc-steps', sel: '#nc-proveedor-select', bNew: '[onclick="toggleNuevoProveedor(true)"]', next: '#nc-btn-next' });
  meta.stepInd = await rects(pg, '.paso-indicator');
  await ev(pg, () => { const s = document.getElementById('nc-proveedor-select'); s.value = 'pv1'; onSelectProveedor(); }); await W(400);
  await shot(pg, 'p1sel', { sel: '#nc-proveedor-select' });
  await ev(pg, () => toggleNuevoProveedor(true)); await W(300);
  for (const [id, v] of [['nc-prov-nombre', 'Avícola La Estrella'], ['nc-prov-telefono', '+505 8890-4412'], ['nc-prov-email', 'ventas@laestrella.com.ni'], ['nc-prov-direccion', 'Granada, Nicaragua']]) await fill(pg, id, v);
  await shot(pg, 'p1new', { form: '#nc-nuevo-proveedor-form', bNew: '[onclick="toggleNuevoProveedor(true)"]' });
  await ev(pg, () => { toggleNuevoProveedor(false); const s = document.getElementById('nc-proveedor-select'); s.value = 'pv1'; onSelectProveedor(); });
  await ev(pg, () => irAPaso(2)); await W(400);
  await shot(pg, 'p2', { search: '#nc-producto-search' });
  await fill(pg, 'nc-producto-search', 'a'); await W(300); await ev(pg, () => { document.getElementById('nc-producto-search').value = 'aceite'; buscarProductoNuevaCompra(); }); await W(400);
  await shot(pg, 'p2res', { search: '#nc-producto-search', res: '#nc-search-results', item: '.search-result-item' });
  await ev(pg, () => { agregarProductoAlCarrito(1); agregarProductoAlCarrito(10); agregarProductoAlCarrito(6); }); await W(300);
  await ev(pg, () => irAPaso(3)); await W(500);
  await shot(pg, 'p3a', { table: '#carrito-tbody' });
  await ev(pg, () => { actualizarLineaCarrito(0, 'cantidad', '48'); actualizarLineaCarrito(1, 'cantidad', '120'); actualizarLineaCarrito(2, 'cantidad', '12'); actualizarLineaCarrito(0, 'descuento', '150'); }); await W(400);
  meta.carRows = await pg.evaluate(() => [...document.querySelectorAll('#carrito-tbody > tr')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  meta.carInputs = await pg.evaluate(() => { const tr = document.querySelector('#carrito-tbody > tr'); return [...tr.querySelectorAll('input')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }); });
  await shot(pg, 'p3b', { table: '#carrito-tbody', iva: '.iva-row', regalia2: '#carrito-tbody > tr:nth-child(5) button[onclick^="alternarRegaliaCompra"]', thead: '#modal-nueva-compra thead' });
  await ev(pg, () => alternarRegaliaCompra(2)); await W(400);
  await shot(pg, 'p3reg', { row: '#carrito-tbody > tr:nth-child(5)', regalia2: '#carrito-tbody > tr:nth-child(5) button[onclick^="alternarRegaliaCompra"]' });
  await ev(pg, () => { document.getElementById('nc-iva-activo').checked = true; toggleIVA(true); }); await W(400);
  await shot(pg, 'p3iva', { iva: '.iva-row', ivaP: '#nc-iva-porcentaje-wrap', table: '#carrito-tbody' });
  await ev(pg, () => { actualizarLineaCarrito(0, 'numeroLote', 'AC-2610'); actualizarLineaCarrito(0, 'fechaVencimiento', '2027-06-30'); actualizarLineaCarrito(1, 'numeroLote', 'PR-0931'); actualizarLineaCarrito(1, 'fechaVencimiento', '2027-09-15'); }); await W(400);
  await shot(pg, 'p3lote', { lote: '#carrito-tbody .fila-lote', lote2: '#carrito-tbody > tr:nth-child(4)' });
  await ev(pg, () => irAPaso(4)); await W(400);
  await shot(pg, 'p4', { card: '#nc-wizard-body .nc-paso[data-paso="4"] .resumen-card', aviso: 'text:⚡@#modal-nueva-compra' });
  await ev(pg, () => irAPaso(5)); await W(400);
  await shot(pg, 'p5', { sel: '#nc-metodo-pago', fecha: '#nc-fecha' });
  await ev(pg, () => { const s = document.getElementById('nc-metodo-pago'); s.value = 'transferencia'; s.dispatchEvent(new Event('change')); }); await W(900);
  await shot(pg, 'p5b', { sel: '#nc-metodo-pago', grid: '#nc-banco-elegir-wrap' });
  await ev(pg, () => elegirBancoCompra('b1', 'BANPRO', 'NIO')); await W(900);
  await shot(pg, 'p5c', { elegido: '#nc-banco-elegido-wrap', sel: '#nc-metodo-pago' });
  await ev(pg, () => irAPaso(6)); await W(400); await hideCxP(pg);
  await shot(pg, 'p6', { estado: '#nc-estado', origen: '#nc-origen-caja-wrap', info: 'text:Completada:@#modal-nueva-compra' });
  meta.p6info = await pg.evaluate(() => { const e = [...document.querySelectorAll('.nc-paso[data-paso="6"] > div')].pop(); const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await ev(pg, () => { const s = document.getElementById('nc-origen-caja'); s.value = 'general'; }); await W(200);
  await shot(pg, 'p6gen', { origen: '#nc-origen-caja-wrap' });
  await ev(pg, () => { const s = document.getElementById('nc-origen-caja'); s.value = 'chica'; });
  await ev(pg, () => irAPaso(7)); await W(400); await ev(pg, () => { const t = document.getElementById('resumen-total-final'); const r = document.getElementById('resumen-total'); if (t && r) t.textContent = r.textContent; });
  await fill(pg, 'nc-observaciones', 'Pedido semanal. Entregado en bodega.'); await W(300);
  await shot(pg, 'p7', { obs: '#nc-observaciones', info: 'text:✅ Al guardar@#modal-nueva-compra', save: '#nc-btn-save', total: '#resumen-total-final' });
  meta.p7info = await pg.evaluate(() => { const e = [...document.querySelectorAll('.nc-paso[data-paso="7"] > div')].pop(); const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await ev(pg, () => closeModal('modal-nueva-compra')); await W(500);
  await ev(pg, () => showToast('Compra C-00241 registrada correctamente')); await W(600);
  await shot(pg, 'saved', { toast: '#toast, .toast, [class*=toast]' });
  await W(3500);
  // ---- Producto nuevo
  await ev(pg, () => abrirNuevaCompra()); await W(900); await ev(pg, () => elegirTipoNuevaCompra('nuevo')); await W(600);
  await shot(pg, 'pn0', { box: sp });
  await ev(pg, () => { const s = document.getElementById('pn-proveedor-select'); s.value = 'pv2'; });
  for (const [id, v] of [['pn-nombre', 'Avena Quaker 400g'], ['pn-categoria', 'Abarrotes'], ['pn-sku', 'DT-1013'], ['pn-costo', '38'], ['pn-precio', '52'], ['pn-stock', '96'], ['pn-lote', 'AQ-2610'], ['pn-vencimiento', '2027-08-31']]) await fill(pg, id, v);
  await ev(pg, () => { try { actualizarPreviewProductoNuevo(); } catch (e) {} }); await W(400);
  await shot(pg, 'pn1', { box: sp, nombre: '#pn-nombre', costo: '#pn-costo', stock: '#pn-stock', total: '#pn-total-preview', btn: '#nc-btn-comprar-nuevo' });
  await ev(pg, () => closeModal('modal-nueva-compra')); await W(500);
  // ---- Compra directa
  await ev(pg, () => abrirCompraDirecta()); await W(900);
  await ev(pg, () => { const s = document.getElementById('cd-proveedor-select'); s.value = 'pv1'; });
  await fill(pg, 'cd-concepto', 'Flete de mercadería desde Managua'); await ev(pg, () => { document.getElementById('cd-clase').value = 'servicio'; }); await fill(pg, 'cd-monto', '1800'); await W(400);
  await shot(pg, 'cd', { box: '#modal-compra-directa .modal-box', concepto: '#cd-concepto', clase: '#cd-clase', monto: '#cd-monto', btn: '#cd-btn-guardar' });
  await ev(pg, () => closeModal('modal-compra-directa')); await W(500);
  // ---- Órdenes
  await ev(pg, () => mostrarSeccionOrdenes()); await W(1200);
  await shot(pg, 'ord', { table: '#seccion-ordenes .table-wrap', tip: '#seccion-ordenes .panel-card', pdf: '#ordenes-tbody [title="Descargar PDF"]', conv: '#ordenes-tbody [onclick^="convertirOrdenACompra"]', bNueva: '[onclick="abrirNuevaOrdenCompra()"]', hdr: '#seccion-ordenes .greeting-row' });
  await ev(pg, () => abrirNuevaOrdenCompra()); await W(900); await shot(pg, 'ordNew', { box: sp });
  await ev(pg, () => closeModal('modal-nueva-compra')); await W(500);
  await ev(pg, () => convertirOrdenACompra('oc1')); await W(1200); await ev(pg, () => { document.getElementById('nc-paso-0').style.display = 'none'; document.getElementById('nc-wizard-body').style.display = ''; document.getElementById('nc-steps').style.display = ''; irAPaso(3); }); await W(500);
  await shot(pg, 'ordConv', { box: sp, steps: '#nc-steps' });
  await ev(pg, () => closeModal('modal-nueva-compra')); await W(500);
  await ev(pg, () => mostrarSeccionCompras()); await W(600);
  // ---- Proveedores
  await ev(pg, () => setSeccion('proveedores')); await W(1200);
  await shot(pg, 'prov', { table: '#proveedores-tbody', tab: '[data-section="proveedores"]', edit: '#proveedores-tbody [title="Editar"]', tog: '#proveedores-tbody [title="Desactivar"]', act: '#proveedores-tbody [title="Activar"]' });
  meta.provCols = await pg.evaluate(() => { const col = n => { const c = [...document.querySelectorAll('#proveedores-tbody tr td:nth-child(' + n + ')')].map(e => e.getBoundingClientRect()); const a = c[0], z = c[c.length - 1]; return [a.x, a.y, a.width, z.bottom - a.y].map(Math.round); }; return { ult: col(5), monto: col(6), estado: col(7), acc: col(8) }; });
  await ev(pg, () => abrirEditarProveedor('pv1')); await W(800); await shot(pg, 'provEdit', { box: '#modal-proveedor .modal-box' });
  await ev(pg, () => closeModal('modal-proveedor')); await W(400);
  await ev(pg, () => setSeccion('compras')); await W(1200);
  await ev(pg, () => confirmarAnularCompra('cmp3')); await W(800);
  await shot(pg, 'anular', { box: '#modal-confirmar-anular .modal-box' });
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
