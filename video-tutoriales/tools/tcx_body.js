const fm = (t, r, z = 1.6) => focus(t, r, z, 1.06, .8);
const u = (a, b) => { const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]); return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]; };
const B = M.base, K = M.kpis, HDR = [1180, 80, 720, 60];
const row = i => M.rows[i], col = i => M.ths[i];
const TBL = [269, 352, 1622, 574];
const colR = i => [col(i)[0], 352, col(i)[2], 574];

CARDS.push({ type: 'intro', a: 0, b: 8.0 });
cap(8.09, 16.38, 'Compras al crédito · Deudas que no son mercadería · <b>Cada pago</b>');
st(16.6, 'base'); cam(16.6, { x: 700, y: 520, z: 1.25 }, .8);
curTo(16.8, B.nav, .6); sl(16.9, 18.9, g(B.nav, 4), 'En el menú', 'Cuentas por Pagar');
st(19.0, 'dash'); cam(19.0, { x: 900, y: 560, z: 1.3 }, .7); curTo(19.2, M.dash.card, .6); sl(19.2, 21.3, g(M.dash.card, 6), 'Accesos rápidos del Dashboard', '');

chap(22.17, 1, 'Los indicadores');
st(22.3, 'base'); focus(22.3, B.kpiRow, 1.15, 1.04);
sl(23.72, 25.4, B.kpiRow, 'Seis indicadores', '');
[['Total pendiente', 25.69, 28.2, 'Todo lo que todavía debés.'], ['Total vencido', 28.3, 30.9, 'Ya pasó de su fecha.'], ['Vence hoy', 31.16, 33.3, ''], ['Vence esta semana', 33.4, 35.6, ''], ['Pagado este mes', 35.84, 38.5, 'A tus proveedores.'], ['Cuentas pendientes', 38.6, 41.0, '']]
  .forEach(([n, a, b, tx], i) => { curTo(a - .3, K[i], .3); sl(a, b, g(K[i], 4), n, tx, i + 1); });

chap(42.03, 2, 'La lista de cuentas');
cam(42.2, { x: 1080, y: 640, z: 1.12 }, .9);
sl(43.7, 45.0, TBL, 'Cada cuenta por pagar', '');
sl(45.05, 47.0, colR(1), 'N° de cuenta y de compra', 'CXP-… · Compra C-…');
[['Total', 47.05, 47.95, 4], ['Pagado', 48.0, 48.75, 5], ['Pendiente', 48.8, 49.6, 6], ['Próximo vencimiento', 49.65, 51.0, 7]].forEach(([n, a, b, i]) => sl(a, b, colR(i), n, ''));
sl(51.2, 54.4, colR(8), 'El estado se calcula solo', 'Pendiente · Vencido · Pagado');
sl(54.5, 56.8, u(row(4), row(6)), 'Las vencidas, en rojo', '');
focus(56.9, [269, 280, 1622, 90], 1.15, 1.05);
curTo(57.0, M.filtros[3], .3); click(57.4); st(57.6, 'f_vencido'); sl(57.0, 59.0, g(M.filtros[3], 4), 'Por estado', 'Pendientes · Pagadas · Vencidas');
curTo(59.0, M.filtros[5], .3); click(59.3); st(59.5, 'f_cuotas'); sl(59.1, 60.5, g(u(M.filtros[4], M.filtros[5]), 4), 'Por tipo de crédito', '');
curTo(60.4, B.search, .3); click(60.7); st(60.9, 'search'); sl(60.6, 62.8, g(B.search, 5), 'Buscá', 'Proveedor · N° de compra · factura');

chap(63.78, 3, 'Nueva compra al crédito');
st(63.9, 'base'); focus(63.9, HDR, 2.0, 1.1); curTo(65.6, B.bNueva, .7);
sl(65.93, 68.7, g(B.bNueva, 5), 'Nueva compra', 'Al crédito.'); click(68.5);
st(68.8, 'nc0'); fm(68.8, M.nc0.box, 1.1);
const N0 = M.nc0;
curTo(69.4, N0.prov, .3); click(69.6); st(69.8, 'nc_prov'); sl(69.6, 71.2, u(N0.prov, M.nc_prov.dd), 'Elegí el proveedor', '', 1);
curTo(71.0, N0.bNewProv, .3); click(71.2); st(71.4, 'nc_newprov'); sl(71.3, 72.9, M.nc_newprov.form, 'O registrá uno nuevo', 'Ahí mismo.');
st(73.0, 'nc_fill'); curTo(73.2, N0.factura, .4); sl(73.06, 76.0, g(u(N0.fecha, N0.factura), 5), 'Fecha y N° de factura', '', 2);
curTo(76.1, N0.psearch, .3); st(76.4, 'nc_search'); sl(76.31, 79.0, [531, 403, 858, 104], 'Buscá productos', 'Por nombre, código o categoría.', 3);
st(79.2, 'nc_cart'); click(78.9); sl(79.2, 81.2, M.nc_cart.table, 'Al carrito', '');
const CI = M.cartIn; curTo(81.2, CI[0], .3); sl(81.33, 85.4, g(u(CI[0], CI[CI.length - 1]), 6), 'Cantidad · precio de compra · descuento', 'En cada línea.', 4);
st(85.8, 'nc_pn'); curTo(85.7, M.nc_pn.bPN, .4); click(86.1); sl(85.69, 89.5, g(M.nc_pn.bPN, 5), 'Producto nuevo', 'Si todavía no existe.');
sl(89.6, 91.5, M.nc_pn.form, 'Con su costo y su precio de venta', '');
curTo(90.9, M.nc_pn.bCrear, .4); click(91.4); st(91.6, 'nc_pn2'); sl(91.6, 93.2, g(M.nc_pn2.line2, 4), 'Directo al carrito ✅', '');
st(93.5, 'nc_iva'); curTo(93.4, [M.nc_iva.iva[0], M.nc_iva.iva[1], 30, 30], .4); click(93.9); sl(93.41, 98.6, g(M.nc_iva.iva, 4), 'Aplicar impuesto', '15 % de IVA por defecto.', 5);
st(99.0, 'nc_res'); sl(98.93, 102.8, M.nc_res.resumen, 'Subtotal · descuento · impuestos · total', '');

chap(103.83, 4, 'A fecha fija o en cuotas');
const NR = M.nc_res;
sl(105.95, 108.1, g(u(NR.ff, NR.cu), 5), '¿Cómo le vas a pagar?', '');
st(108.4, 'nc_ff'); curTo(108.4, M.nc_ff.fv, .4); sl(108.35, 112.3, g(u(M.nc_ff.ff, M.nc_ff.fv), 5), 'A fecha fija', 'Un solo vencimiento.', 1);
curTo(112.4, NR.cu, .3); click(112.6); st(112.8, 'nc_cuotas'); const NCU = M.nc_cuotas;
sl(112.62, 115.4, g(u(NCU.num, NCU.f1), 5), 'En cuotas', 'Cuántas y la fecha de la primera.', 2);
curTo(115.2, NCU.freq, .3); click(115.4); st(115.6, 'nc_freq'); sl(115.5, 118.0, u(NCU.freq, M.nc_freq.dd), 'Mensual · quincenal · semanal', '');
st(118.2, 'nc_cuotas'); sl(118.28, 122.3, g(NCU.prev, 8), 'De cuánto sale cada cuota', 'Y cuándo vence la última.');

chap(123.32, 5, 'Guardar la compra');
curTo(124.4, NCU.bGuardar, .6); sl(125.0, 127.0, g(NCU.bGuardar, 5), 'Guardar compra', ''); click(126.9);
st(127.2, 'saved'); cam(127.2, { x: 1080, y: 560, z: 1.12 }, .7);
sl(127.62, 131.3, M.saved.row0, 'Nueva cuenta por pagar', 'El stock sube y el costo promedio se actualiza.');
st(131.5, 'compras'); cam(131.5, { x: 1080, y: 700, z: 1.12 }, .7);
sl(131.59, 135.0, [280, M.compras.cell[1] - 16, 1600, 52], 'En Compras: Pendiente', 'Método: Crédito.');
st(135.2, 'saved'); cam(135.2, { x: 960, y: 540, z: 1 }, .7);
cap(135.26, 138.4, '🧮 El IVA queda anotado en <b>Impuestos</b>');
cap(138.73, 144.1, '💰 De tu Caja sale <b>C$ 0</b> — el dinero sale hasta que pagás');

chap(145.21, 6, 'Cuenta directa');
st(145.3, 'base'); focus(145.3, HDR, 2.0, 1.1);
cap(146.62, 153.3, '¿La renta del local? ¿La reparación del camión? <b>No es mercadería</b>');
curTo(152.6, B.bDirecta, .7); sl(153.66, 155.6, g(B.bDirecta, 5), 'Cuenta directa', ''); click(155.4);
st(155.7, 'cd0'); fm(155.7, M.cd0.box, 1.1); const C0 = M.cd0;
sl(155.8, 158.2, C0.nota, 'No toca tu inventario', '');
sl(158.46, 161.5, g(u(C0.concepto, C0.fecha), 5), '¿De qué es? · monto · fecha', '', 1);
st(161.8, 'cd_primadd'); const CPD = M.cd_primadd; curTo(161.7, CPD.prima, .3); click(161.9); sl(161.77, 165.3, u(CPD.prima, CPD.dd), 'Prima', 'Monto fijo o porcentaje.', 2);
st(165.4, 'cd_prima'); const CP = M.cd_prima; sl(165.4, 167.8, g(CP.resumen, 5), 'Sale al guardar', '');
curTo(167.6, CP.origen, .3); click(167.8); st(168.0, 'cd_origen'); sl(167.9, 171.3, u(CP.origen, M.cd_origen.dd), '¿De dónde sale?', 'Caja Chica · Caja General · banco', 3);
st(171.5, 'cd_tipo'); curTo(171.5, M.cd_tipo.tipo, .4); sl(171.51, 174.3, g(M.cd_tipo.tipo, 4), 'Una sola fecha o en cuotas', '', 4);
st(174.6, 'cd_int'); const CI2 = M.cd_int; sl(174.59, 176.9, g(CI2.interes, 4), '¿Tiene interés?', '', 5);
st(177.0, 'cd_metdd'); click(176.9); sl(177.0, 179.7, u(CI2.detalle, M.cd_metdd.dd), 'Tasa de interés', 'Cuota fija o interés simple.');
st(179.9, 'cd_amort'); sl(179.91, 183.0, g(u(CI2.modo, CI2.num), 4), 'Por número de cuotas', '', 6);
st(183.1, 'cd_manual'); curTo(183.0, M.cd_manual.fijo, .4); sl(183.1, 186.6, g(M.cd_manual.fijo, 4), 'O por monto fijo por cuota', 'Calcula cuántas hacen falta.');
st(186.8, 'cd_amort'); sl(186.89, 192.3, g(u(CI2.tot, CI2.tabla), 4), 'Tabla de cuotas', 'Vencimiento · capital · interés · saldo');

chap(193.38, 7, 'Registrar un pago');
st(193.5, 'base'); cam(193.5, { x: 1500, y: 420, z: 1.6 }, .8);
const PAYB = M.r2btns[1]; curTo(194.9, PAYB, .5); sl(195.08, 197.8, g(PAYB, 8), 'Pagar esta cuenta', '');
cam(197.8, { x: 1500, y: 240, z: 1.6 }, .6); curTo(197.9, B.bPagar, .5); sl(197.95, 199.3, g(B.bPagar, 5), 'O Registrar pago', ''); click(199.1);
st(199.3, 'pg_gen'); fm(199.3, M.pg_gen.box, 1.35); sl(199.4, 201.0, u(M.pg_gen.sel, M.pg_gen.dd), 'Elegí la cuenta', '');
const P0 = M.pg0;
st(201.3, 'pg0'); fm(201.3, P0.box, 1.3); sl(201.27, 203.9, P0.resumen, 'Total · pagado · pendiente', '');
st(204.0, 'pg_parcial'); curTo(203.8, P0.monto, .3); sl(204.0, 207.8, g(P0.monto, 5), 'Todo o solo una parte', 'Nunca más de lo que debés.');
curTo(207.9, P0.metodo, .3); click(208.1); st(208.3, 'pg_metdd'); sl(208.09, 209.8, u(P0.metodo, M.pg_metdd.dd), 'Método de pago', '');
st(210.0, 'pg_banco'); sl(209.96, 213.7, u(M.pg_banco.banco, M.pg_banco.dd), 'Tarjeta o transferencia', '¿De qué banco sale?');
st(214.0, 'pg_origen'); sl(213.95, 219.0, u(P0.origen, M.pg_origen.dd), 'Efectivo con Caja Chica abierta', 'Caja Chica o Caja General');
curTo(218.8, P0.bOk, .4); click(219.1); st(219.3, 'pg_aviso'); fm(219.3, M.pg_aviso.box, 1.6); sl(219.4, 223.5, M.pg_aviso.box, '⚠️ ¿No alcanza el efectivo?', 'Te avisa y te ofrece transferir desde un banco.');
st(223.8, 'det'); fm(223.8, M.det.box, 1.05); const DQ = M.detCuotas;
sl(223.9, 228.2, g(u(DQ[1], DQ[2]), 3), 'Primero la cuota más vieja', 'El pago se aplica en orden.');
st(228.6, 'comp'); fm(228.6, M.comp.box, 1.5); const CB = M.comp;
sl(228.5, 231.5, CB.body, 'Sale de Caja y te da un comprobante', '');
sl(231.6, 233.8, [CB.saldos[0], CB.saldos[1] - 4, 350, 48], 'Saldo anterior y nuevo', '');
curTo(233.6, CB.bPrint, .4); sl(233.9, 235.8, g(CB.bPrint, 5), 'Imprimir', '');

chap(236.86, 8, 'Retención de IR');
st(237.0, 'pg_ret'); fm(237.0, M.pg_ret.box, 1.2); const PR = M.pg_ret;
curTo(238.3, [PR.ret[0], PR.ret[1], 24, 22], .4); sl(238.6, 241.5, g([PR.ret[0], PR.ret[1], PR.ret[2], 22], 6), 'Aplicar retención de IR', '');
sl(241.6, 244.4, g([PR.retC[0], PR.retC[1], 259, 62], 4), '2 % por defecto', '');
sl(244.69, 248.4, g([PR.retC[0] + 271, PR.retC[1], 259, 62], 4), 'La deuda baja completa', 'Solo sale el neto.');
st(248.6, 'comp'); fm(248.6, CB.box, 1.5); sl(248.67, 252.2, [CB.ret[0], CB.ret[1] - 4, 350, 48], 'La retención va a Impuestos', 'Lista para pagarla a la DGI.');

chap(253.29, 9, 'El detalle de la cuenta');
st(253.4, 'base'); cam(253.4, { x: 1500, y: 700, z: 1.5 }, .8);
const EYE = [1728, row(6)[1] + 18, 24, 24]; curTo(254.3, EYE, .5); click(254.9);
st(255.2, 'det'); fm(255.2, M.det.box, 1.05);
sl(255.6, 260.8, M.det.head, 'Todo de un vistazo', 'Proveedor · fechas · total · pagado · saldo');
st(261.0, 'det2'); const D2 = M.det2; sl(261.07, 266.3, [1195, D2.cuotas[1] + 38, 150, 197], 'Estado de cada cuota', 'Pendiente · Pago parcial · Vencida · Pagada');
st(266.5, 'det'); curTo(266.4, M.det.payQ, .4); sl(266.64, 269.3, g(M.det.payQ, 8), 'Pagar una cuota en específico', '');
st(269.6, 'det2'); sl(269.64, 274.8, g(u(D2.hist, D2.histT), 4), 'Historial de pagos', 'Fecha · monto · método · quién lo registró');

chap(275.93, 10, 'Editar y anular');
st(276.1, 'base'); cam(276.1, { x: 1500, y: 420, z: 1.6 }, .8);
const R0 = M.r0btns; curTo(277.2, R0[2], .4); sl(277.59, 279.4, g(R0[2], 7), 'Editar', 'Solo sin pagos.'); click(279.2);
st(279.5, 'edit'); fm(279.5, M.edit.box, 1.6); sl(279.6, 284.3, g(u(M.edit.venc, M.edit.obs), 5), 'Vencimiento y observaciones', 'El vencimiento, si es a fecha fija.');
st(284.5, 'base'); cam(284.5, { x: 1500, y: 420, z: 1.6 }, .6); curTo(284.6, R0[3], .4); sl(284.62, 286.0, g(R0[3], 7), 'Anular', ''); click(285.9);
st(286.2, 'anular'); fm(286.2, M.anular.box, 1.6); sl(286.3, 287.6, M.anular.box, 'No se borra', '');
st(287.7, 'anulada'); cam(287.7, { x: 1500, y: 420, z: 1.5 }, .6); sl(287.75, 288.8, g(M.anulada.badge, 6), 'Queda como Anulada', '');
st(288.9, 'anular'); fm(288.9, M.anular.box, 1.6); sl(288.92, 294.6, M.anular.box, 'Compra anulada · inventario de vuelta', 'Se reversan su IVA y su asiento contable.');
st(294.8, 'anular_err'); cam(294.8, { x: 1500, y: 800, z: 1.4 }, .7); sl(294.92, 300.6, g(M.anular_err.toast, 5), '¿Ya vendiste parte?', 'No te deja anular y te explica por qué.');

chap(301.65, 11, 'Las conexiones');
CARDS.push({ type: 'hub', a: 301.65, b: 337.3 });
CARDS.push({ type: 'outro', a: 337.58, b: DUR });
const HUB = [
  ['inv', '📦 Inventario: entra el producto', 'in', 304.6], ['caja0', '💰 Caja: C$ 0 al comprar', 'in', 306.6],
  ['cc', '👛 Caja Chica', 'out', 309.3], ['cg', '🏛️ Caja General', 'out', 310.4], ['bk', '🏦 Bancos', 'out', 311.6],
  ['imp', '🧮 Impuestos: IVA y retenciones', 'mid', 313.3], ['cont', '📒 Contabilidad: la deuda y cada pago', 'mid', 316.0],
  ['comp', '🛒 Compras: queda Completada', 'low', 319.1], ['anu', '↩️ Anular en Compras → anula la cuenta', 'low', 323.0],
  ['ag', '📅 Agenda: cuotas por vencer', 'low2', 328.6], ['dash', '📊 Dashboard: pagar no es un gasto', 'low2', 331.2]];
const HEAD = [[301.65, 'Las conexiones'], [303.18, 'Comprás hoy, pagás después'], [313.26, 'Todo conectado'], [331.18, 'Todo en tiempo real ⚡']];
function hubHTML() {
  const chip = (c) => `<div class="hc hc-${c[2]}" id="hc-${c[0]}">${c[1]}${c[2] === 'in' ? '<em>al comprar</em>' : c[2] === 'out' ? '<em>al pagar</em>' : ''}</div>`;
  const grp = k => HUB.filter(c => c[2] === k).map(chip).join('');
  return `<div id="hubh" style="font-size:64px;font-weight:800;letter-spacing:-1px;margin-bottom:36px"></div>
  <div style="display:flex;align-items:center;gap:56px">
    <div style="display:flex;flex-direction:column;gap:22px;align-items:flex-end">${grp('in')}</div>
    <div id="hubc" style="width:290px;height:290px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(circle at 35% 30%,#5B8CFF,#2B3FD6);box-shadow:0 0 0 14px rgba(91,140,255,.18),0 0 80px rgba(91,140,255,.55)"><img src="isotipo.png" style="width:64px;filter:brightness(10)"><div style="font-size:40px;font-weight:800;margin-top:6px;line-height:1.05">Cuentas<br>por Pagar</div></div>
    <div style="display:flex;flex-direction:column;gap:22px;align-items:flex-start">${grp('out')}</div>
  </div>
  <div style="display:flex;gap:22px;margin-top:38px">${grp('mid')}</div>
  <div style="display:flex;gap:22px;margin-top:20px">${grp('low')}</div>
  <div style="display:flex;gap:22px;margin-top:20px">${grp('low2')}</div>
  <style>.hc{font-size:29px;font-weight:700;padding:15px 24px;border-radius:18px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.18);display:flex;gap:16px;align-items:center;white-space:nowrap}
  .hc em{font-style:normal;font-size:21px;font-weight:800;padding:4px 10px;border-radius:9px}.hc-in em{background:#16C784;color:#04261a}.hc-out em{background:#FF5D73;color:#3a0610}
  .hc-in{border-color:rgba(22,199,132,.6)}.hc-out{border-color:rgba(255,93,115,.6)}.hc-mid{border-color:rgba(255,196,77,.6)}.hc-low,.hc-low2{border-color:rgba(127,178,255,.6)}</style>`;
}
function hubFrame(t) {
  let h = ''; for (const [a, tx] of HEAD) if (t >= a) h = tx; const he = $('hubh'); if (he && he.textContent !== h) he.textContent = h;
  for (const c of HUB) { const e = $('hc-' + c[0]); if (!e) continue; const k = ease(p(t, c[3], c[3] + .45)); const pulse = t > c[3] && t < c[3] + 1.2 ? 1 + .06 * Math.sin(p(t, c[3], c[3] + 1.2) * Math.PI) : 1; e.style.opacity = .12 + .88 * k; e.style.transform = `scale(${(.92 + .08 * k) * pulse})`; e.style.background = t > c[3] && t < c[3] + 1.6 ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.08)'; }
  const hc = $('hubc'); if (hc) hc.style.transform = `scale(${1 + .03 * Math.sin(t * 3)})`;
}
