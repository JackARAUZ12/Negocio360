const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openDash } = require('./open.js');
const fs = require('fs');
const O = __dirname + '/vshots/';
const HIDE = '#sidebar,#header,header,.topbar{visibility:hidden!important}';
const meta = {};
async function top(pg, n) { await pg.screenshot({ path: O + n + '_top.jpg', type: 'jpeg', quality: 93 }); console.log('top', n); }
async function rect(pg, sel, name) { meta[name] = await pg.evaluate(s => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); }, sel); }
const clickText = (pg, txt, scope = 'body') => pg.evaluate(([t, sc]) => { const els = [...document.querySelectorAll(sc + ' *')].filter(e => e.offsetParent && e.children.length < 4 && e.textContent.trim().startsWith(t)); const e = els[els.length - 1]; if (e) { (e.closest('[onclick],button,label') || e).click(); return true; } return false; }, [txt, scope]);
const rectText = (pg, txt, name, scope = 'body', up = '') => pg.evaluate(([t, sc, up]) => { const els = [...document.querySelectorAll(sc + ' *')].filter(e => e.offsetParent && e.children.length < 4 && e.textContent.trim().startsWith(t)); let e = els[els.length - 1]; if (!e) return null; if (up) e = e.closest(up) || e; const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); }, [txt, scope, up]).then(r => meta[name] = r);
const W = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  let pg = await openDash(b, { file: 'ventas.html', clean: true, wait: 6000 });
  meta.H = await pg.evaluate(() => document.documentElement.scrollHeight);
  // ---- base rects
  for (const [t, n, up] of [['Ventas del día', 'kpi1', '.kpi-card,.stat-card,[class*=card]'], ['Ventas del mes', 'kpi2', '[class*=card]'], ['Cantidad de ventas', 'kpi3', '[class*=card]'], ['Ticket promedio', 'kpi4', '[class*=card]'], ['Ganancia estimada', 'kpi5', '[class*=card]'],
    ['Venta rápida', 'btnVR', 'button'], ['Nueva Venta', 'btnNV', 'button'], ['Vender sin stock', 'sinstock', 'label,div'], ['Clientes con pago recurrente', 'recHead', 'div'], ['Historial de ventas', 'histHead', 'div']])
    await rectText(pg, t, n, '#main, #content, body', up);
  await rect(pg, '#recurrentes-tbody', 'recBody'); await rect(pg, '.filter-btn', 'filt0');
  meta.filters = await pg.evaluate(() => [...document.querySelectorAll('.filter-btn')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)]; }));
  meta.histRows = await pg.evaluate(() => { const t = document.querySelector('#ventas-tbody') || [...document.querySelectorAll('tbody')].pop(); const r = t.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  meta.recRows = await pg.evaluate(() => { const t = document.getElementById('recurrentes-tbody'); const r = t.closest('table').getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  await top(pg, 'base');
  { const h = await pg.addStyleTag({ content: HIDE }); await pg.screenshot({ path: O + 'base_full.jpg', type: 'jpeg', quality: 93, fullPage: true }); await h.evaluate(e => e.remove()); console.log('full base'); }
  // sin stock on
  try { await pg.evaluate(() => { const c = document.getElementById('chk-vender-sin-stock'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await W(800); await top(pg, 'sinstock');
    await pg.evaluate(() => { const c = document.getElementById('chk-vender-sin-stock'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); await W(500); } catch (e) { console.log('sinstock err', e.message); }
  // ---- wizard
  await pg.evaluate(() => abrirNuevaVenta()); await W(1300); await top(pg, 'm1');
  await rect(pg, '#modal-venta .modal-box, #modal-venta > div', 'modal');
  meta.steps = await pg.evaluate(() => { const e = document.querySelector('.steps-nav, [class*=steps]'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  for (const [t, n] of [['Cliente existente', 'optEx'], ['Consumidor final', 'optCF'], ['Cliente rápido', 'optQ']]) await rectText(pg, t, n, '#modal-venta', '[onclick],label,div');
  await clickText(pg, 'Cliente existente', '#modal-venta'); await W(700);
  const ci = await pg.evaluate(() => { const i = [...document.querySelectorAll('#modal-venta input')].find(e => e.offsetParent && /cliente/i.test(e.placeholder + e.id)); return i ? '#' + i.id : null; });
  if (ci) { await pg.click(ci); await pg.keyboard.type('Pul', { delay: 70 }); await W(900); await rect(pg, ci, 'cliSearch'); }
  await top(pg, 'm1ex');
  await clickText(pg, 'Cliente rápido', '#modal-venta'); await W(600);
  try { await pg.fill('#cq-nombre', 'María López'); } catch (e) {}
  await rect(pg, '#cq-nombre', 'cqNombre'); await top(pg, 'm1q');
  await clickText(pg, 'Consumidor final', '#modal-venta'); await W(500);
  await pg.evaluate(() => pasoSiguiente()); await W(1300); await top(pg, 'm2');
  const ps = await pg.evaluate(() => { const i = [...document.querySelectorAll('#modal-venta input')].find(e => e.offsetParent && /producto|SKU/i.test(e.placeholder)); return i ? '#' + i.id : null; });
  meta.prodSearchSel = ps;
  if (ps) { await rect(pg, ps, 'prodSearch'); await pg.click(ps); await pg.keyboard.type('Arr', { delay: 80 }); await W(1000); await top(pg, 'm2s');
    meta.prodDrop = await pg.evaluate(() => { const c = [...document.querySelectorAll('#modal-venta [onclick*="agregarAlCarrito"]')].filter(e => e.offsetParent); if (!c.length) return null; const r = c[0].getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
    await pg.fill(ps, ''); await pg.dispatchEvent(ps, 'input'); }
  await pg.evaluate(() => agregarAlCarrito(2, 'producto')); await W(700); await top(pg, 'm2c1');
  await pg.evaluate(() => { agregarAlCarrito(1, 'producto'); agregarAlCarrito(9, 'producto'); }); await W(1200); await top(pg, 'm2c3');
  meta.cartTable = await pg.evaluate(() => { const t = [...document.querySelectorAll('#modal-venta table')].filter(e => e.offsetParent)[0]; if (!t) return null; const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  meta.cartInputs = await pg.evaluate(() => [...document.querySelectorAll('#modal-venta table input')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.className || e.type, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }));
  // edit qty of Leche to 2 + fraction on Arroz
  const qIns = await pg.$$('#modal-venta table input');
  await pg.evaluate(() => cambiarCantidad(2, 0.25)); await W(900);
  meta.fracCtl = await pg.evaluate(() => { const b = [...document.querySelectorAll('#modal-venta button')].find(x => x.offsetParent && x.textContent.trim() === '¼'); const row = b && b.closest('td'); if (!row) return null; const r = row.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  meta.cartTable2 = await pg.evaluate(() => { const t = [...document.querySelectorAll('#modal-venta table')].filter(e => e.offsetParent)[0]; const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await top(pg, 'm2frac');
  await pg.evaluate(() => agregarAlCarrito(5, 'producto')); await W(900); await top(pg, 'm2esc');
  meta.escModal = await pg.evaluate(() => { const e = document.querySelector('#modal-escala-precio .modal-box, #modal-escala-precio > div'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => { try { confirmarSeleccionEscala(); } catch (e) {} }); await W(900); await top(pg, 'm2esc2');
  await pg.evaluate(() => goToPaso(3)); await W(900);
  await pg.evaluate(() => agregarAlCarrito(200, 'servicio')); await W(900); await top(pg, 'm3');
  meta.svcTable = await pg.evaluate(() => { const t = [...document.querySelectorAll('#modal-venta table')].filter(e => e.offsetParent)[0]; if (!t) return null; const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => goToPaso(4)); await W(1000); await top(pg, 'm4');
  for (const [t, n] of [['Subtotal', 'rSub'], ['Descuento total', 'rDesc'], ['TOTAL', 'rTot'], ['Ganancia estimada', 'rGan'], ['Cobrar impuesto', 'rIva'], ['Fecha de esta venta', 'rFecha']]) await rectText(pg, t, n, '#modal-venta', '');
  await pg.evaluate(() => { const c = [...document.querySelectorAll('#modal-venta input[type=checkbox]')].find(e => e.offsetParent); if (c) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } try { if (!S.ivaActivo) toggleIva(); } catch (e) {} }); await W(900); await top(pg, 'm4iva');
  meta.m4scroll = await pg.evaluate(() => { const b = document.querySelector('#modal-venta .modal-body'); return b ? b.scrollHeight - b.clientHeight : 0; });
  await pg.evaluate(() => { const b = document.querySelector('#modal-venta .modal-body'); if (b) b.scrollTop = 9999; }); await W(500); await top(pg, 'm4b');
  for (const [t, n] of [['Ganancia estimada', 'rGan2'], ['Fecha de esta venta', 'rFecha2'], ['TOTAL', 'rTot2']]) await rectText(pg, t, n, '#modal-venta', '');
  await pg.evaluate(() => goToPaso(5)); await W(1200); await top(pg, 'm5');
  meta.metodos = await pg.evaluate(() => { const g = document.getElementById('metodos-grid'); if (!g) return null; const r = g.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => seleccionarMetodoPago('efectivo', 'Efectivo')); await W(700); await top(pg, 'm5ef');
  await pg.evaluate(() => seleccionarPagoSeparado()); await W(1000);
  await pg.evaluate(() => { const ins = [...document.querySelectorAll('#pago-separado-wrap input[type=number], #pago-separado-wrap input')].filter(e => e.offsetParent); const tot = S.carrito.reduce((s, x) => s + (x.subtotal || 0), 0); if (ins[0]) { ins[0].value = '2000'; ins[0].dispatchEvent(new Event('input', { bubbles: true })); } if (ins[2]) { ins[2].value = '100'; ins[2].dispatchEvent(new Event('input', { bubbles: true })); } }); await W(600);
  await pg.evaluate(() => { const txt = document.getElementById('pago-separado-wrap').innerText; const m = txt.match(/de NIO ([\d,\.]+)/); const ins = [...document.querySelectorAll('#pago-separado-wrap input')].filter(e => e.offsetParent); if (m && ins[2]) { const tot = parseFloat(m[1].replace(/,/g, '')); ins[2].value = (tot - 2000).toFixed(2); ins[2].dispatchEvent(new Event('input', { bubbles: true })); } }); await W(800); await top(pg, 'm5split');
  meta.split = await pg.evaluate(() => { const g = document.getElementById('pago-separado-wrap'); if (!g) return null; const r = g.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => { try { cancelarPagoSeparado(); } catch (e) {} }); await W(500);
  await pg.evaluate(() => seleccionarMetodoPago('tarjeta', 'Tarjeta')); await W(1300); await top(pg, 'm5bank');
  meta.bankWrap = await pg.evaluate(() => { const g = document.getElementById('banco-elegir-wrap'); if (!g || !g.offsetParent) return null; const r = g.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(async () => { try { elegirBancoVenta('b1', 'BANPRO', 'NIO'); } catch (e) {} }); await W(1200); await top(pg, 'm5com');
  meta.comWrap = await pg.evaluate(() => { const e = [...document.querySelectorAll('#modal-venta *')].find(x => x.offsetParent && /comisión/i.test(x.textContent) && x.children.length < 3); if (!e) return null; const c = e.closest('div[id]') || e; const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => goToPaso(6)); await W(900);
  const ta = await pg.evaluate(() => { const t = [...document.querySelectorAll('#modal-venta textarea')].find(e => e.offsetParent); return t ? '#' + t.id : null; });
  if (ta) { await pg.click(ta); await pg.keyboard.type('Entregar el lunes antes de las 10 a. m.', { delay: 20 }); await rect(pg, ta, 'obs'); }
  await W(400); await top(pg, 'm6');
  for (const [t, n] of [['Cerrar venta e imprimir', 'btnCerrarImp'], ['Cerrar venta', 'btnCerrar']]) await rectText(pg, t, n, '#modal-venta', 'button');
  await pg.evaluate(() => cerrarModalVenta()); await W(700);
  // ---- venta rápida
  await pg.evaluate(() => abrirConfigVentaRapida(true)); await W(1000); await top(pg, 'vrcfg');
  meta.vrcfg = await pg.evaluate(() => { const e = [...document.querySelectorAll('.modal-overlay')].find(m => m.getClientRects().length && /Configurar Venta rápida/.test(m.textContent)); const b = e && e.querySelector('.modal-box, .modal-content, div'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  for (const [t, n] of [['Impuesto (IVA)', 'cIva'], ['Ancho del papel', 'cPapel'], ['Nombre del negocio en el ticket', 'cDatos'], ['Imprimir el ticket automáticamente', 'cAuto']]) await rectText(pg, t, n, '.modal-overlay', '');
  await pg.evaluate(() => { try { cerrarConfigVentaRapida(); } catch (e) {} }); await W(500);
  await pg.evaluate(() => { try { abrirPantallaVentaRapida(); } catch (e) { console.log(e) } }); await W(1400); await top(pg, 'vr0');
  await pg.evaluate(() => { for (const id of [2, 1, 9]) { const p = S.productosCache.find(x => x.id === id); try { agregarAlCarritoVR(p); } catch (e) {} } }); await W(1000); await top(pg, 'vr1');
  meta.vrModal = await pg.evaluate(() => { const e = [...document.querySelectorAll('.modal-overlay')].find(m => m.getClientRects().length && /Escanea el producto/.test(m.textContent)); const b = e && e.firstElementChild; if (!b) return null; const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  for (const [t, n] of [['Escanea el producto', 'vrScan'], ['Método de pago', 'vrMet'], ['Cobrar y cerrar venta', 'vrCobrar']]) await rectText(pg, t, n, '.modal-overlay', '');
  await pg.evaluate(() => { try { seleccionarMetodoPagoVR('efectivo', 'Efectivo'); } catch (e) {} }); await W(800); await top(pg, 'vr2');
  await pg.close();
  // ---- detalle / anular / recurrente
  pg = await openDash(b, { file: 'ventas.html', clean: true, wait: 6000 });
  const last = await pg.evaluate(() => S.ventas[0].id);
  await pg.evaluate(id => abrirDetalle(id), last); await W(1800); await top(pg, 'det');
  meta.detBox = await pg.evaluate(() => { const b = document.querySelector('#modal-detalle .modal-box'); const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  for (const [t, n] of [['CLIENTE', 'dCli'], ['PRODUCTOS Y SERVICIOS', 'dProd'], ['MÉTODO DE PAGO', 'dMet'], ['TOTAL', 'dTot'], ['GANANCIA', 'dGan'], ['🧾 Descargar recibo', 'dRec'], ['📄 Comprobante tamaño carta', 'dComp'], ['✏️ Corregir venta', 'dCorr'], ['Anular venta', 'dAnu']]) await rectText(pg, t, n, '#modal-detalle', '');
  meta.detTable = await pg.evaluate(() => { const t = document.querySelector('#modal-detalle table'); if (!t) return null; const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await clickText(pg, 'Anular venta', '#modal-detalle .modal-footer'); await W(900); await top(pg, 'anular');
  meta.anuBox = await pg.evaluate(() => { const e = [...document.querySelectorAll('.modal-overlay')].filter(m => m.getClientRects().length && /¿Anular esta venta\?/.test(m.textContent)).pop(); const b = e && e.querySelector('.modal-box'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.close();
  pg = await openDash(b, { file: 'ventas.html', clean: true, wait: 6000 });
  const rc = await pg.evaluate(() => S.clientesRecurrentes[0] && S.clientesRecurrentes[0].id); console.log('rec', rc);
  if (rc) { await pg.evaluate(id => abrirModalPagoRecurrente(id), rc); await W(1200); await top(pg, 'recpay');
    meta.recBox = await pg.evaluate(() => { const e = [...document.querySelectorAll('.modal-overlay')].find(m => m.getClientRects().length && /Registrar pago/.test(m.textContent)); const b = e && e.querySelector('.modal-box'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
    for (const [t, n] of [['Pago completo', 'rpComp'], ['Pago parcial', 'rpPar']]) await rectText(pg, t, n, '.modal-overlay', '');
    await pg.evaluate(() => { const r = document.querySelector('input[name="pr-tipo"][value="parcial"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); try { onCambioTipoPagoRecurrente(); } catch (e) {} const m = document.getElementById('pr-monto-parcial'); if (m) { m.value = '1000'; m.dispatchEvent(new Event('input', { bubbles: true })); } }); await W(800); await top(pg, 'recpay2'); }
  await pg.close(); pg = await openDash(b, { file: 'ventas.html', clean: true, wait: 6000 });
  meta.sinstock = await pg.evaluate(() => { const c = document.getElementById('chk-vender-sin-stock'); const e = c.closest('label') || c.parentElement; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(id => abrirDetalle(id), await pg.evaluate(() => S.ventas[0].id)); await W(1500);
  meta.det2 = await pg.evaluate(() => { const box = document.querySelector('#modal-detalle .modal-box'); const R = e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }; const f = t => { const e = [...box.querySelectorAll('*')].find(x => x.offsetParent && x.children.length === 0 && x.textContent.trim().toLowerCase() === t); return e ? R(e) : null; };
    return { cli: f('cliente'), met: f('método de pago'), prod: f('productos y servicios'), tot: f('total'), gan: f('ganancia'), table: R(box.querySelector('table')), footer: R(box.querySelector('.modal-footer')) }; });
  await pg.evaluate(() => closeModal('modal-detalle')); await W(400);
  await pg.evaluate(() => abrirConfigVentaRapida(true)); await W(900);
  meta.vrcfg2 = await pg.evaluate(() => { const ov = [...document.querySelectorAll('.modal-overlay,[id*=config]')].filter(m => m.getClientRects().length && /Configurar Venta rápida/.test(m.textContent)); const e = ov[ov.length - 1]; const box = e.querySelector('.modal-box') || e.firstElementChild; const r = box.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => { try { cerrarConfigVentaRapida(); } catch (e) {} }); await W(400);
  await pg.evaluate(() => { try { abrirPantallaVentaRapida(); } catch (e) {} }); await W(1200);
  meta.vr2 = await pg.evaluate(() => { const ov = [...document.querySelectorAll('.modal-overlay')].filter(m => m.getClientRects().length && /Escanea el producto/.test(m.textContent)); const e = ov[ov.length - 1]; const box = e.querySelector('.modal-box') || e.firstElementChild; const r = box.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
  fs.writeFileSync(O + 'meta.json', JSON.stringify(meta, null, 0));
  await b.close();
})();
