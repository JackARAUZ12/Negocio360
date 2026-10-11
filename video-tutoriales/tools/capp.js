const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/pshots/';
const meta = {};
const W = ms => new Promise(r => setTimeout(r, ms));
async function shot(pg, n, sels = {}) {
  await W(250);
  await pg.screenshot({ path: O + n + '_top.jpg', type: 'jpeg', quality: 93 });
  meta[n] = await pg.evaluate(sels => { const o = {}; for (const [k, s] of Object.entries(sels)) { let e = null;
      if (s.startsWith('text:')) { const [t, sc] = s.slice(5).split('@'); const els = [...document.querySelectorAll((sc || 'body') + ' *')].filter(x => x.getClientRects().length && x.children.length < 3 && x.textContent.trim().startsWith(t)); e = els[0]; }
      else e = document.querySelector(s);
      if (e) { const r = e.getBoundingClientRect(); o[k] = [r.x, r.y, r.width, r.height].map(Math.round); } else o[k] = null; } return o; }, sels);
  console.log('shot', n, JSON.stringify(meta[n]));
}
const ev = (pg, f, a) => pg.evaluate(f, a);
const fill = (pg, id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const into = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); const mb = e && e.closest('.modal-body'); if (mb) mb.scrollTop -= 20; }, sel);
(async () => {
  const b = await chromium.launch();
  let pg = await openDash(b, { file: 'productos.html', clean: true, wait: 6500 });
  await shot(pg, 'base', { stats: '.stats-grid, #statProductos', s1: '#statProductos', catTabs: '#catTabs', search: '#searchInput', scan: '#scanWrapper', filtros: '#filtrosSecundarios', stock: '#btnFiltroStockBajo', marca: '#filtroMarca', orden: '#ordenProductos', table: '#tableCardProductos', bConfig: '#btnConfigInventario', bPlant: '#plantillaDropdown', bVencer: '#btnProximosVencer', bNuevo: '#btnNuevoProducto', bImport: 'text:📤 Importar Excel', bExport: 'text:📤 Exportar inventario', bMover: 'text:🚚 Mover productos' });
  meta.statCards = await ev(pg, () => ['statProductos', 'statServicios', 'statInventario', 'statStockBajo'].map(id => { let e = document.getElementById(id); for (let i = 0; i < 4 && e; i++) { if (e.getBoundingClientRect().height > 100) break; e = e.parentElement; } const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  meta.tabs = await ev(pg, () => [...document.querySelectorAll('#catTabs > *')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  meta.rowIcons = await ev(pg, () => { const tr = document.querySelector('#productosTbody tr'); return [...tr.querySelectorAll('button,[onclick]')].map(e => { const r = e.getBoundingClientRect(); return [e.getAttribute('title') || e.textContent.trim(), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }); });
  await ev(pg, () => cambiarCategoriaProductos('servicios')); await W(800); await shot(pg, 'tabServ', { bNS: '#btnNuevoServicio', table: '#tableCardProductos' });
  await ev(pg, () => cambiarCategoriaProductos('materia_prima')); await W(800); await shot(pg, 'tabMP', {});
  await ev(pg, () => cambiarCategoriaProductos('productos')); await W(800);
  await pg.click('#searchInput'); await pg.keyboard.type('Arr', { delay: 80 }); await W(700); await shot(pg, 'search', { search: '#searchInput', table: '#tableCardProductos' });
  await pg.fill('#searchInput', ''); await pg.dispatchEvent('#searchInput', 'input'); await W(500);
  await pg.click('#btnFiltroStockBajo'); await W(700); await shot(pg, 'fstock', { stock: '#btnFiltroStockBajo', table: '#tableCardProductos' });
  await ev(pg, () => { const b = [...document.querySelectorAll('#filtrosSecundarios button, #filtrosSecundarios *')].find(x => /Todos/.test(x.textContent) && x.tagName === 'BUTTON'); b && b.click(); }); await W(500);
  await ev(pg, () => { const s = document.getElementById('ordenProductos'); const o = [...s.options].find(o => /mayor a menor/.test(o.text)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }); await W(700); await shot(pg, 'orden', { orden: '#ordenProductos', table: '#tableCardProductos' });
  await ev(pg, () => { const s = document.getElementById('ordenProductos'); s.selectedIndex = 0; s.dispatchEvent(new Event('change', { bubbles: true })); }); await W(500);
  // ---- new product form
  await ev(pg, () => abrirModalNuevo('producto')); await W(900);
  await shot(pg, 'np0', { modal: '#modalProducto .modal, #modalProducto .modal-box, #modalProducto > div', bNuevo: '#btnNuevoProducto' });
  for (const [id, v] of [['inputNombre', 'Cable eléctrico #12 (rollo 300 m)'], ['inputDescripcion', 'Cable THHN calibre 12, color negro'], ['inputCategoria', 'Ferretería'], ['inputSku', 'FE-3001'], ['inputCodBarras', '7501234567893']]) await fill(pg, id, v);
  await ev(pg, () => { const s = document.getElementById('inputMarca'); s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await W(400); await shot(pg, 'npBasic', { nombre: '#inputNombre', desc: '#inputDescripcion', cat: '#inputCategoria', sku: '#inputSku', marca: '#inputMarca', cb: '#cbInputGroup', bCel: '#btnEscanearCelular', bScan: '#btnEscanearCB' });
  await fill(pg, 'inputCosto', '3900'); await fill(pg, 'inputPrecio', '5400');
  await ev(pg, () => { const s = document.getElementById('selUnidadVenta'); s.value = 'unidad'; s.dispatchEvent(new Event('change', { bubbles: true })); const c = document.getElementById('chkPermiteFraccion'); if (c && !c.checked) { c.click(); } });
  await fill(pg, 'inputContenidoCantidad', '300'); await ev(pg, () => { const s = document.getElementById('selContenidoUnidad'); s.value = 'metro'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await into(pg, '#inputCosto'); await W(500);
  await shot(pg, 'npCost', { costo: '#inputCosto', precio: '#inputPrecio', margen: '#margenPreviewWrap', unidad: '#wrapUnidadVenta', frac: '#chkPermiteFraccion', contenido: '#wrapContenido', tipoP: '#toggleTipoFijo' });
  await ev(pg, () => setTipoPrecio('escala')); await W(400);
  await ev(pg, () => { agregarFilaEscala(); agregarFilaEscala(); agregarFilaEscala(); }); await W(400);
  await ev(pg, () => { const rows = [...document.querySelectorAll('#escalasEditorBody tr, #escalasEditorBody > *')]; const vals = [['Detalle', 5400], ['Mayorista', 5100], ['Contratista', 4950]]; rows.forEach((r, i) => { const ins = r.querySelectorAll('input'); if (vals[i] && ins.length >= 2) { ins[0].value = vals[i][0]; ins[1].value = vals[i][1]; ins.forEach(x => x.dispatchEvent(new Event('input', { bubbles: true }))); } }); });
  await into(pg, '#toggleTipoFijo'); await W(400);
  await shot(pg, 'npEscala', { tipo: '#toggleTipoEscala', escalas: '#wrapEscalaPrecios', bAdd: 'text:+ Agregar precio@#wrapEscalaPrecios' });
  await ev(pg, () => cerrarModalProducto()); await W(600);
  // presentaciones product
  await ev(pg, () => abrirModalNuevo('producto')); await W(800);
  await fill(pg, 'inputNombre', 'Acetaminofén 500 mg'); await fill(pg, 'inputCosto', '0.9'); await fill(pg, 'inputPrecio', '1.5'); await fill(pg, 'inputUnidadMedida', 'tableta');
  await ev(pg, () => { agregarFilaPresentacion(); agregarFilaPresentacion(); agregarFilaPresentacion(); }); await W(400);
  await ev(pg, () => { const rows = [...document.querySelectorAll('#presentacionesEditorBody tr, #presentacionesEditorBody > *')]; const vals = [['Tableta', 1, 1.5], ['Blíster', 10, 14], ['Caja', 100, 130]]; rows.forEach((r, i) => { const ins = r.querySelectorAll('input'); if (vals[i]) { ins.forEach((x, j) => { if (j < 3) { x.value = vals[i][j]; x.dispatchEvent(new Event('input', { bubbles: true })); } }); } }); });
  await into(pg, '#wrapPresentaciones'); await W(500);
  await shot(pg, 'npPres', { pres: '#wrapPresentaciones', body: '#presentacionesEditorBody' });
  // inventory section (fill on this product)
  await fill(pg, 'inputStockActual', '1200'); await fill(pg, 'inputNumeroLoteInicial', 'AC-2611'); await fill(pg, 'inputVencimientoLoteInicial', '2027-11-30');
  await fill(pg, 'inputStockMinimo', '200'); await fill(pg, 'inputStockMaximo', '3000'); await fill(pg, 'inputGarantiaMeses', '');
  await into(pg, '#stockSection'); await W(500);
  await shot(pg, 'npInv', { stock: '#inputStockActual', lote: '#grupoLoteInicial', min: '#inputStockMinimo', max: '#inputStockMaximo', gar: '#inputGarantiaMeses', serie: '#wrapNumeroSerie', mp: '#wrapMateriaPrima', ubic: '#inputUbicacionFisica', section: '#stockSection' });
  await into(pg, '#inputGarantiaMeses'); await fill(pg, 'inputGarantiaMeses', '12'); await ev(pg, () => { const c = document.getElementById('inputRequiereSerie'); if (c && !c.checked) c.click(); }); await W(400);
  await shot(pg, 'npInv2', { gar: '#inputGarantiaMeses', serie: '#wrapNumeroSerie', mp: '#wrapMateriaPrima', ubic: '#inputUbicacionFisica' });
  await ev(pg, () => cerrarModalProducto()); await W(500);
  // ---- service
  await ev(pg, () => cambiarCategoriaProductos('servicios')); await W(600);
  await ev(pg, () => abrirModalNuevo('servicio')); await W(800);
  await fill(pg, 'inputNombre', 'Instalación eléctrica'); await fill(pg, 'inputDescripcion', 'Mano de obra por punto instalado'); await fill(pg, 'inputCategoria', 'Servicios'); await fill(pg, 'inputPrecio', '500'); await fill(pg, 'inputCosto', '200'); await W(400);
  await shot(pg, 'ns', { tog: '#toggleServicio', nombre: '#inputNombre', precio: '#inputPrecio', costo: '#inputCosto' });
  await into(pg, '#inputCosto'); await W(400); await shot(pg, 'ns2', { precio: '#inputPrecio', costo: '#inputCosto', margen: '#margenPreviewWrap' });
  await ev(pg, () => cerrarModalProducto()); await ev(pg, () => cambiarCategoriaProductos('productos')); await W(700);
  // ---- detail / edit / movement
  await ev(pg, () => abrirDetalle(1)); await W(900); await shot(pg, 'det', { box: '#modalDetalle .modal, #modalDetalle > div', bEdit: '#btnEditarDesdeDetalle' });
  await ev(pg, () => cerrarDetalle()); await W(400);
  await ev(pg, () => abrirEditar(1)); await W(900); await shot(pg, 'edit', { title: '#modalProductoTitle', nombre: '#inputNombre' });
  await ev(pg, () => cerrarModalProducto()); await W(400);
  await ev(pg, () => abrirMovimiento(1)); await W(800); await shot(pg, 'mov', { box: '#modalMovimiento .modal, #modalMovimiento > div', razones: 'text:Razón del descuento@#modalMovimiento' });
  meta.movRazones = await ev(pg, () => [...document.querySelectorAll('#modalMovimiento [onclick*="seleccionarRazon"]')].map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }));
  await ev(pg, () => { const b = [...document.querySelectorAll('#modalMovimiento [onclick*="seleccionarRazon"]')].find(x => /Daño/.test(x.textContent)); seleccionarRazon(b, 'dano'); }); await fill(pg, 'movCantidad', '2'); await fill(pg, 'movNota', 'Botellas rotas al descargar el camión');
  await ev(pg, () => { const c = document.getElementById('movDescontarCaja'); if (c && !c.checked) c.click(); }); await W(600);
  await shot(pg, 'mov2', { cant: '#movCantidad', nota: '#movNota', caja: '#movCajaRow', bOk: '#btnConfirmarMovimiento' });
  await ev(pg, () => cerrarMovimiento()); await W(400);
  // ---- combos & promos (scrolled)
  await ev(pg, () => { const e = document.getElementById('tableCardCombos'); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 260); }); await W(700);
  await shot(pg, 'combos', { card: '#tableCardCombos', bCrear: 'text:+ Crear combo' });
  await ev(pg, () => abrirEditarCombo('cb1')); await W(1000); await shot(pg, 'combo1', { items: '#comboItemsBody', nombre: '#comboNombre', costo: '#comboCostoTotalPreview', precio: '#comboInputPrecio' });
  await ev(pg, () => cerrarModalCombo()); await W(400);
  await ev(pg, () => { const e = document.getElementById('tableCardPromos'); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 260); }); await W(700);
  await shot(pg, 'promos', { card: '#tableCardPromos', bNueva: 'text:+ Nueva promoción' });
  await ev(pg, () => abrirModalPromocion()); await W(900); await shot(pg, 'promo1', { box: '#modalPromocion .modal, #modalPromocion > div' });
  meta.promoTipos = await ev(pg, () => [...document.querySelectorAll('#modalPromocion [onclick*="elegirTipoPromocion"]')].map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 30), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }));
  await ev(pg, () => elegirTipoPromocion('nxm_mismo')); await W(600); await fill(pg, 'pm-nombre', '2x1 Gaseosa Rojita 3L'); await fill(pg, 'pm-n-compra', '2'); await fill(pg, 'pm-m-paga', '1'); await fill(pg, 'pm-fecha-inicio', '2026-10-10'); await fill(pg, 'pm-fecha-fin', '2026-10-31');
  await into(pg, '#pm-fecha-inicio'); await W(500); await shot(pg, 'promo2', { ini: '#pm-fecha-inicio', fin: '#pm-fecha-fin', nombre: '#pm-nombre' });
  await ev(pg, () => cerrarModalPromocion()); await W(400);
  await ev(pg, () => window.scrollTo(0, 0)); await W(500);
  // ---- import / export / move / config / expiries
  await pg.click('#plantillaDropdown button, #plantillaDropdown'); await W(500); await shot(pg, 'plantilla', { menu: '#plantillaDropdownMenu', btn: '#plantillaDropdown' });
  await pg.mouse.click(700, 160); await W(300);
  await ev(pg, () => abrirModalImportar()); await W(900); await shot(pg, 'importar', { box: '#modalImportar .modal, #modalImportar > div' });
  await ev(pg, () => cerrarModalImportar()); await W(400);
  await ev(pg, () => abrirModalExportarInventario()); await W(700); await shot(pg, 'exportar', { box: '#modalExportarInventario .modal, #modalExportarInventario > div' });
  await ev(pg, () => cerrarModalExportarInventario()); await W(400);
  await ev(pg, () => abrirModalMoverProducto()); await W(1000); await shot(pg, 'mover', { box: '#modalMoverProducto .modal, #modalMoverProducto > div' });
  await ev(pg, () => cerrarModalMoverProducto()); await W(400);
  await ev(pg, () => abrirModalConfigInventario()); await W(1000); await shot(pg, 'config', { box: '#modalConfigInventario .modal, #modalConfigInventario > div', img: 'text:🖼️@#modalConfigInventario', cols: '#listaColumnasProductos' });
  await ev(pg, () => elegirTipoInventario('imagenes')); await W(500); await shot(pg, 'config2', { cols: '#listaColumnasProductos' });
  await ev(pg, () => cerrarModalConfigInventario()); await W(400);
  await ev(pg, () => abrirModalProximosVencer()); await W(1300); await shot(pg, 'vencer', { box: '#modalProximosVencer .modal, #modalProximosVencer > div', lista: '#listaProximosVencer' });
  meta.vencerBtns = await ev(pg, () => [...document.querySelectorAll('#modalProximosVencer [onclick*="filtrarProximosVencer"]')].map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }));
  await ev(pg, () => filtrarProximosVencer(90)); await W(1000); await shot(pg, 'vencer90', { lista: '#listaProximosVencer' });
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta));
  await b.close();
})();
