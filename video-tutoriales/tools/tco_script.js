const $ = id => document.getElementById(id);
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = x => 1 - Math.pow(1 - cl(x), 3);
const eio = x => { x = cl(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const p = (t, a, b) => cl((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const DUR = 172.51;

const STATES = ['base','f_hoy','f_semana','f_ano','f_custom','search','nc0','p1','p1sel','p1new','p2','p2res','p3a','p3b','p3reg','p3iva','p3lote','p4','p5','p5b','p5c','p6','p6gen','p7','saved','pn1','cd','ord','ordConv','prov','provEdit','anular'];
const SRC = {};
const V = {};
STATES.forEach(s => { const d = document.createElement('div'); d.className = 'view'; d.style.opacity = 0; d.innerHTML = `<img class="topimg" src="${SRC[s] || 'coshots/' + s + '_top.jpg'}">`; $('views').appendChild(d); V[s] = d; });
const CAM = [{ t: 0, x: 960, y: 540, z: 1 }];
let curCam = { x: 960, y: 540, z: 1 };
const ST = [{ t: 0, s: 'base' }], SPOTS = [], LABELS = [], CAPS = [], CLICKS = [], CHAP = [], CARDS = [];
const CURK = [{ t: 0, x: 1500, y: 800 }]; let curPos = { x: 1500, y: 800 };
function cam(t, c, dur = 1.0) { const n = Object.assign({}, curCam, c); CAM.push({ t, ...curCam }); CAM.push({ t: t + dur, ...n }); curCam = n; }
function focus(t, r, zmax = 2, pad = 1.25, dur = 1.0) { const z = Math.max(1, Math.min(zmax, 1920 / (r[2] * pad), 1080 / (r[3] * pad))); cam(t, { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2, z }, dur); }
function st(t, s) { ST.push({ t, s }); }
function cur(t, x, y, dur = .7) { CURK.push({ t, x: curPos.x, y: curPos.y }); CURK.push({ t: t + dur, x, y }); curPos = { x, y }; }
function curTo(t, r, dur = .7) { cur(t, r[0] + r[2] * .55, r[1] + r[3] * .55, dur); }
function click(t) { CLICKS.push(t); }
function spot(a, b, r) { SPOTS.push({ a, b, r }); }
function label(a, b, r, title, text = '', n) { LABELS.push({ a, b, r, title, text, n }); }
function sl(a, b, r, title, text, n) { if (r[0] >= 600 && r[0] + r[2] <= 1330 && r[3] < 380) focus(a - .35, [600, r[1] + r[3] / 2 - 250, 720, 500], 1.75, 1.0, .55); spot(a, b, r); label(a + .12, b, r, title, text, n); }
function cap(a, b, text) { CAPS.push({ a, b, text }); }
function chap(t, n, title) { CHAP.push({ t, n, title }); }
const g = (r, p = 6) => [r[0] - p, r[1] - p, r[2] + 2 * p, r[3] + 2 * p];

const R = {
  kpiRow: [308, 176, 1544, 96], kpis: [[308, 176, 246, 96], [568, 176, 246, 96], [827, 176, 246, 96], [1087, 176, 246, 96], [1347, 176, 246, 96], [1606, 176, 246, 96]],
  hist: [309, 380, 1542, 700], cols: [[312, 534, 132, 546], [446, 534, 130, 546], [578, 534, 270, 546], [852, 534, 150, 546], [1090, 534, 172, 546], [1268, 534, 150, 546], [1422, 534, 147, 546]],
  filtros: [[329, 449, 50, 30], [387, 449, 75, 30], [470, 449, 51, 30], [529, 449, 50, 30], [587, 449, 111, 30]], custom: [706, 448, 303, 32], search: [1576, 447, 254, 33],
  hdr: [1210, 80, 660, 60], bNueva: [1707, 93, 145, 32], bOrd: [1360, 92, 178, 34], bDir: [1547, 92, 150, 34], tabProv: [498, 305, 133, 32], anul0: [1744, 545, 28, 28], row0: [309, 534, 1542, 51],
  mSmall: [510, 330, 900, 420], ex: [531, 496, 422, 137], nu: [967, 496, 422, 137], steps: [511, 406, 898, 57], provSel: [535, 543, 850, 37], bNew: [535, 453, 850, 34], provForm: [535, 501, 850, 334], bNew0: [535, 626, 850, 34],
  m3: [510, 330, 900, 470], pSearch: [535, 524, 850, 37], pItem: [536, 570, 848, 59],
  cCant: [705, 476, 90, 248], cCosto: [823, 476, 140, 248], cDesc: [997, 476, 96, 248], regRow: [535, 664, 850, 59], ivaRow: [535, 351, 850, 46], ivaP: [535, 411, 850, 37], lotes: [535, 548, 850, 145],
  resCard: [535, 469, 850, 182], aviso: [535, 664, 850, 45], pagoSel: [535, 509, 850, 37], bancos: [535, 556, 850, 92], elegido: [535, 577, 850, 50],
  estado: [535, 504, 850, 37], origen: [535, 541, 850, 81], p6info: [535, 634, 850, 64], p7info: [535, 632, 850, 105], save: [1141, 773, 244, 32], toast: [790, 1012, 340, 44],
  pnBox: [510, 77, 900, 926], pnNombre: [531, 338, 858, 37], pnCosto: [531, 581, 858, 37], pnPrecio: [531, 642, 858, 98], pnBtn: [1138, 956, 247, 32], pnTotal: [531, 869, 858, 44],
  cdBox: [720, 65, 480, 950], cdConc: [741, 400, 438, 134], cdMonto: [741, 588, 438, 60],
  ordTable: [308, 297, 1544, 243], pdf: [1606, 341, 38, 38], conv: [1645, 346, 159, 29], ordConv: [510, 197, 900, 686],
  pUlt: [1251, 472, 158, 306], pMonto: [1409, 472, 192, 306], pAcc: [1709, 472, 142, 306], anular: [770, 390, 380, 300],
};
const NC = [960, 540, 1];
const fm = (t, r, z = 1.6) => focus(t, r, z, 1.06, .8);
CARDS.push({ type: 'intro', a: 0, b: 3.7 });
cap(3.9, 9.6, 'Abastecé tu inventario · Controlá todo lo que le comprás a tus proveedores');

chap(10.0, 1, 'Indicadores');
focus(10.0, R.kpiRow, 1.3, 1.04);
sl(10.1, 11.9, R.kpiRow, 'Tus indicadores', '');
[['Compras hoy', 12.13, 13.05], ['Compras del mes', 13.16, 14.25], ['Cantidad de compras', 14.34, 15.6], ['Productos ingresados', 15.73, 17.1], ['Inversión en inventario', 17.21, 18.55], ['Proveedores activos', 18.6, 20.1]].forEach(([n, a, b], i) => { curTo(a - .3, R.kpis[i], .3); sl(a, b, g(R.kpis[i], 4), n, '', i + 1); });
sl(20.49, 23.6, R.kpiRow, 'Cuánto estás invirtiendo', 'Sin hacer cuentas a mano.');

chap(24.1, 2, 'Historial y filtros');
cam(24.1, { x: 960, y: 640, z: 1.12 }, .9);
sl(24.3, 26.2, R.hist, 'Historial de compras', '');
[['N° de compra', 26.55, 28.05], ['Fecha', 28.19, 28.9], ['Proveedor', 29.02, 29.95], ['Productos', 30.12, 31.05], ['Total', 31.21, 32.0], ['Método de pago', 32.16, 33.25], ['Estado', 33.35, 34.2]].forEach(([n, a, b], i) => { curTo(a - .25, [R.cols[i][0], 560, R.cols[i][2], 30], .25); sl(a, b, R.cols[i], n, ''); });
focus(34.3, [309, 420, 1000, 90], 1.8, 1.1);
[[34.49, 35.8, 0, 'f_hoy', 'Hoy'], [35.92, 36.6, 1, 'f_semana', 'Semana'], [36.7, 37.3, 2, 'base', 'Mes'], [37.44, 37.9, 3, 'f_ano', 'Año']].forEach(([a, b, i, s, n]) => { curTo(a - .25, R.filtros[i], .25); click(a + .05); st(a + .25, s); sl(a, b, g(R.filtros[i], 4), n, ''); });
curTo(37.75, R.filtros[4], .25); click(38.0); st(38.2, 'f_custom'); sl(37.97, 39.5, [R.filtros[4][0] - 4, 444, 430, 40], 'Rango personalizado', '');
st(39.6, 'base'); focus(39.6, [1300, 400, 560, 120], 2.0, 1.1); curTo(39.7, R.search, .4); click(40.2); st(40.5, 'search'); sl(39.75, 42.2, g(R.search, 5), 'Buscá por proveedor', '');

chap(42.46, 3, 'Nueva compra');
st(42.5, 'base'); focus(42.5, R.hdr, 2.2, 1.1); curTo(42.7, R.bNueva, .8); sl(43.0, 45.4, g(R.bNueva, 5), 'Nueva Compra', ''); click(44.6); st(44.9, 'nc0'); fm(44.9, R.mSmall);
curTo(45.6, R.ex, .4); sl(45.84, 48.5, R.ex, 'Producto existente', 'Ya está registrado.', 1);
curTo(48.4, R.nu, .3); sl(48.6, 49.6, R.nu, 'Producto nuevo', 'Lo creás al comprar.', 2);
curTo(49.5, R.ex, .3); click(49.9); st(50.2, 'p1');
sl(50.8, 52.9, g(R.steps, 2), 'Asistente de 7 pasos', 'Te guía paso a paso.');
curTo(53.0, R.provSel, .4); sl(53.13, 55.5, g(R.provSel, 5), 'Paso 1 · Proveedor', '', 1); st(54.0, 'p1sel');
curTo(55.5, R.bNew0, .3); click(56.2); st(56.45, 'p1new'); fm(56.45, [510, 300, 900, 600], 1.6);
sl(56.5, 59.2, g(R.provForm, 4), 'Crear nuevo proveedor', 'Ahí mismo, sin salir.');

chap(59.55, 4, 'Productos y carrito');
st(59.6, 'p2'); fm(59.6, R.m3);
curTo(59.8, R.pSearch, .4); sl(59.9, 61.3, g(R.pSearch, 5), 'Paso 2 · Buscá productos', '', 2);
st(61.4, 'p2res'); sl(61.5, 63.3, g(R.pSearch, 5), 'Nombre · código · categoría', '');
curTo(63.0, R.pItem, .35); sl(63.4, 64.9, R.pItem, 'Agregalo al carrito', ''); click(64.0);
st(65.0, 'p3b'); fm(65.0, [510, 330, 900, 450], 1.6);
[['Cantidad', 65.38, 67.2, 'cCant'], ['Costo unitario', 67.37, 68.4, 'cCosto'], ['Descuento', 68.45, 69.5, 'cDesc']].forEach(([n, a, b, k], i) => { curTo(a - .25, R[k], .25); sl(a, b, R[k], n, '', i + 1); });
curTo(69.6, [939, 681, 26, 26], .4); click(70.4); st(70.6, 'p3reg'); sl(69.9, 74.5, R.regRow, '🎀 Regalía', 'Entra al inventario con costo C$0.');
st(74.8, 'p3iva'); curTo(74.7, R.ivaRow, .4); click(75.0); sl(74.95, 77.2, g(R.ivaRow, 3), 'IVA a la compra', '15 %');
st(77.4, 'p3lote'); curTo(77.6, R.lotes, .4); sl(77.5, 81.5, g(R.lotes, 3), 'Lote y vencimiento', 'Si manejás lotes.');

chap(81.94, 5, 'Resumen y pago');
st(82.0, 'p4'); fm(82.0, R.m3);
sl(82.1, 84.45, R.resCard, 'Paso 4 · Resumen', 'Subtotal'); sl(84.55, 85.5, R.resCard, 'Paso 4 · Resumen', 'Descuentos'); sl(85.6, 86.9, R.resCard, 'Paso 4 · Resumen', 'IVA y total');
st(87.2, 'p5'); curTo(87.3, R.pagoSel, .4); sl(87.3, 88.8, g([535, 560, 850, 37], 5), 'Paso 5 · Método de pago', '', 5);
click(88.8); st(89.0, 'p5b'); sl(89.0, 89.95, g(R.bancos, 4), 'El banco, si aplica', 'BANPRO · LAFISE · BAC');
st(90.1, 'p6'); curTo(90.0, R.origen, .4); sl(90.25, 91.75, g(R.origen, 4), 'Paso 6 · ¿De dónde sale el dinero?', '', 6);
sl(91.84, 92.7, g(R.origen, 4), 'Caja Chica', 'El efectivo del cajón.'); st(92.75, 'p6gen'); sl(92.79, 94.1, g(R.origen, 4), 'Caja General', 'Banco o cuenta principal.');
st(94.2, 'p6'); curTo(94.1, R.estado, .3); sl(94.28, 98.4, g(R.estado, 4), '✅ Completada', 'Sale de caja al instante.');
sl(98.7, 102.9, g(R.p6info, 3), '⏳ Pendiente', 'Sube el stock; el pago lo completás después.');

chap(103.28, 6, 'Guardar');
st(103.35, 'p7'); sl(103.5, 110.4, g(R.p7info, 3), 'Al guardar', '📦 Sube el stock · 💸 EGRESO en Caja · 📊 Dashboard al día');
curTo(108.6, R.save, .6); click(110.0); st(110.3, 'saved'); cam(110.3, { x: 960, y: 540, z: 1 }, .7);
cap(110.86, 115.7, 'Una compra convierte <b>Dinero → Inventario</b>. No es una ganancia.');

chap(116.2, 7, 'Producto nuevo');
st(116.25, 'nc0'); fm(116.25, R.mSmall); curTo(116.4, R.nu, .5); sl(116.4, 119.7, R.nu, 'Producto nuevo', 'Todavía no existe.'); click(119.2);
st(119.75, 'pn1'); focus(119.75, R.pnBox, 1.15, 1.04, .8);
[['Nombre', 120.11, 121.1, 'pnNombre'], ['Costo', 121.2, 121.95, 'pnCosto'], ['Precio de venta y cantidad', 122.02, 123.9, 'pnPrecio']].forEach(([n, a, b, k], i) => { curTo(a - .25, R[k], .25); sl(a, b, g(R[k], 4), n, '', i + 1); });
curTo(124.0, R.pnBtn, .4); sl(124.18, 126.4, g(R.pnBtn, 5), 'Un solo clic', 'Crea el producto.'); click(125.6);
sl(126.53, 129.1, g(R.pnTotal, 4), 'Compra + descuento de caja', 'Todo en un solo paso.');

chap(129.48, 8, 'Compra directa');
st(129.5, 'base'); focus(129.5, R.hdr, 2.2, 1.1); curTo(129.8, R.bDir, .8); sl(129.9, 133.5, g(R.bDir, 5), 'Compra Directa', 'Servicio · mantenimiento · insumo menor');
click(133.6); st(133.9, 'cd'); focus(133.9, R.cdBox, 1.2, 1.04, .8);
sl(134.88, 137.7, g(R.cdConc, 4), 'Gasto de contado', 'No toca tu inventario.');

chap(138.03, 9, 'Órdenes de compra');
st(138.1, 'base'); focus(138.1, R.hdr, 2.2, 1.1); curTo(138.2, R.bOrd, .5); click(138.9); st(139.2, 'ord'); focus(139.2, [1000, 280, 860, 260], 1.9, 1.1);
curTo(139.6, R.pdf, .4); sl(139.6, 143.4, g(R.pdf, 4), 'Cotización en PDF', 'Para tu proveedor.');
curTo(143.5, R.conv, .4); sl(143.68, 146.0, g(R.conv, 5), 'Convertir en Compra', 'Recién ahí mueve caja e inventario.'); click(145.6);
st(146.0, 'ordConv'); focus(146.0, R.ordConv, 1.4, 1.04, .7); sl(146.2, 147.6, [511, 265, 898, 57], 'El carrito ya lleno', '');

chap(147.92, 10, 'Proveedores y anular');
st(148.0, 'base'); cam(148.0, { x: 960, y: 540, z: 1 }, .6); curTo(148.0, R.tabProv, .5); click(148.6); st(148.9, 'prov'); focus(148.9, [1100, 440, 760, 360], 1.9, 1.05);
sl(149.63, 151.2, R.pUlt, 'Última compra', '', 1); sl(151.3, 153.0, R.pMonto, 'Monto acumulado', '', 2);
curTo(153.1, [1723, 483, 28, 28], .3); sl(153.2, 156.1, R.pAcc, 'Editar · Activar / Desactivar', '', 3);
st(156.25, 'base'); focus(156.25, [1300, 480, 560, 140], 2.0, 1.1); curTo(156.4, R.anul0, .6); sl(156.4, 158.9, g(R.anul0, 6), 'Anular compra', ''); click(158.5);
st(158.8, 'anular'); focus(158.8, R.anular, 1.9, 1.15); sl(159.12, 163.7, R.anular, 'Se revierte todo', 'Stock y caja. Queda en el historial como Anulada.');
CARDS.push({ type: 'outro', a: 164.0, b: DUR });
window.EVENTS = { DUR, clicks: CLICKS, chapters: CHAP.map(c => c.t), spots: SPOTS.map(s => s.a), states: ST.map(s => s.t), cards: CARDS.map(c => c.a) };
CHAP.forEach(c => { const b = document.createElement('b'); b.style.left = (c.t / DUR * 100) + '%'; $('prog').appendChild(b); });

// ---------------- engine
CAM.sort((a, b) => a.t - b.t);
function camAt(t) { let a = CAM[0], ia = 0; for (let i = 0; i < CAM.length; i++) if (CAM[i].t <= t) { a = CAM[i]; ia = i; } const b = CAM[ia + 1] || a; if (b.t === a.t) return b; const k = eio(p(t, a.t, b.t)); return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)) }; }
function clampCam(c) { const hw = 960 / c.z, hh = 540 / c.z; return { x: cl(c.x, hw, 1920 - hw), y: cl(c.y, hh, 1080 - hh), z: c.z }; }
function curAt(t) { let a = CURK[0], ia = 0; for (let i = 0; i < CURK.length; i++) if (CURK[i].t <= t) { a = CURK[i]; ia = i; } const b = CURK[ia + 1] || a; if (b.t === a.t) return { x: b.x, y: b.y }; const k = eio(p(t, a.t, b.t)); const arc = Math.sin(Math.PI * k) * Math.min(50, Math.hypot(b.x - a.x, b.y - a.y) * .1); return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - arc }; }
const toS = (c, x, y) => ({ x: (x - c.x) * c.z + 960, y: (y - c.y) * c.z + 540 });
function pick(list, t, fi = .3, fo = .25) { let best = null, bo = 0; for (const L of list) if (t >= L.a && t <= L.b + fo) { const o = Math.min(ease(p(t, L.a, L.a + fi)), 1 - ease(p(t, L.b, L.b + fo))); if (o >= bo) { best = L; bo = o; } } return [best, bo]; }

window.render = function (t) {
  const c = clampCam(camAt(t));
  let curS = ST[0], prev = null; for (const s of ST) if (s.t <= t) { prev = curS; curS = s; }
  const k = ease(p(t, curS.t, curS.t + .3));
  for (const s in V) { V[s].style.opacity = 0; V[s].style.zIndex = 0; }
  const setV = (s, o, z) => { const v = V[s]; v.style.opacity = o; v.style.zIndex = z; v.style.transform = `translate(${960 - c.x * c.z}px,${540 - c.y * c.z}px) scale(${c.z})`; };
  if (prev && prev.s !== curS.s && k < 1) { setV(prev.s, 1, 1); setV(curS.s, k, 2); } else setV(curS.s, 1, 2);
  // spotlight
  const [sp, so] = pick(SPOTS, t, .3, .25);
  if (sp) { const a = toS(c, sp.r[0], sp.r[1]), b = toS(c, sp.r[0] + sp.r[2], sp.r[1] + sp.r[3]); const pad = 6;
    [$('spot'), $('ring')].forEach(e => { e.style.left = (a.x - pad) + 'px'; e.style.top = (a.y - pad) + 'px'; e.style.width = (b.x - a.x + 2 * pad) + 'px'; e.style.height = (b.y - a.y + 2 * pad) + 'px'; });
    $('spot').style.opacity = so * .9; $('ring').style.opacity = so * (.75 + .25 * Math.sin(t * 5)); } else { $('spot').style.opacity = 0; $('ring').style.opacity = 0; }
  // label
  const [lb, lo] = pick(LABELS, t, .3, .2); const LE = $('label');
  if (lb) { const key = lb.title + lb.a; if (LE.dataset.k !== key) { $('lt').innerHTML = (lb.n ? `<i>${lb.n}</i>` : '') + lb.title; $('lx').innerHTML = lb.text; $('lx').style.display = lb.text ? '' : 'none'; LE.dataset.k = key; }
    const a = toS(c, lb.r[0], lb.r[1]), b = toS(c, lb.r[0] + lb.r[2], lb.r[1] + lb.r[3]); const Wd = LE.offsetWidth || 520, Hh = LE.offsetHeight || 140, m = 30; let x, y;
    if (1920 - b.x > Wd + m + 30) { x = b.x + m; y = (a.y + b.y) / 2 - Hh / 2; } else if (a.x > Wd + m + 30) { x = a.x - m - Wd; y = (a.y + b.y) / 2 - Hh / 2; }
    else if (1080 - b.y > Hh + m + 60) { x = (a.x + b.x) / 2 - Wd / 2; y = b.y + m; } else { x = (a.x + b.x) / 2 - Wd / 2; y = a.y - m - Hh; }
    x = cl(x, 30, 1920 - Wd - 30); y = cl(y, 110, 1080 - Hh - 50);
    LE.style.left = x + 'px'; LE.style.top = y + 'px'; LE.style.opacity = lo; LE.style.transform = `translateY(${(1 - lo) * 18}px)`; } else LE.style.opacity = 0;
  // caption
  const [cp, co] = pick(CAPS, t, .35, .3);
  if (cp) { if ($('cap').dataset.k !== cp.text) { $('cap').innerHTML = cp.text; $('cap').dataset.k = cp.text; } $('cap').style.opacity = co; $('cap').style.transform = `translateX(-50%) translateY(${(1 - co) * 20}px)`; } else $('cap').style.opacity = 0;
  $('formula').style.opacity = 0;
  // cursor
  const cu = curAt(t), cs = toS(c, cu.x, cu.y); let press = 0, rip = null;
  for (const ck of CLICKS) { if (t >= ck - .12 && t <= ck + .12) press = 1 - Math.abs(t - ck) / .12; if (t >= ck && t < ck + .55) rip = ck; }
  const inCard = CARDS.some(C => t >= C.a - .2 && t <= C.b + .2);
  $('cursor').style.opacity = inCard || t < 3.6 ? 0 : 1; $('cursor').style.transform = `translate(${cs.x - 6}px,${cs.y - 3}px) scale(${1 - .18 * press})`;
  if (rip != null) { const k2 = p(t, rip, rip + .55), Rr = 14 + 46 * ease(k2); const RP = $('ripple'); RP.style.opacity = 1 - k2; RP.style.left = (cs.x - Rr) + 'px'; RP.style.top = (cs.y - Rr) + 'px'; RP.style.width = RP.style.height = 2 * Rr + 'px'; } else $('ripple').style.opacity = 0;
  // chapter chip + banner + progress
  let ch = null; for (const C of CHAP) if (C.t <= t) ch = C;
  if (ch) $('chip').innerHTML = `<img src="isotipo.png" style="width:26px"><span>${String(ch.n).padStart(2, '0')}</span>${ch.title}`;
  $('chip').style.opacity = !inCard && ch && t > ch.t + 2.6 ? 1 : 0; $('wm').style.opacity = 0;
  const BN = $('banner');
  if (ch && t < ch.t + 2.6) { const o = Math.min(ease(p(t, ch.t, ch.t + .35)), 1 - ease(p(t, ch.t + 2.2, ch.t + 2.6))); BN.style.opacity = o; BN.style.transform = `translateX(${(1 - ease(p(t, ch.t, ch.t + .4))) * -60}px)`;
    $('bn').textContent = String(ch.n).padStart(2, '0'); $('bt').textContent = ch.title; } else BN.style.opacity = 0;
  $('prog').style.opacity = t > 3.5 && t < 163.9 ? 1 : 0; $('progi').style.width = (t / DUR * 100) + '%';
  // cards
  let cd = null; for (const C of CARDS) if (t >= C.a && t <= C.b) cd = C; const CE = $('card');
  if (cd) { const o = Math.min(ease(p(t, cd.a, cd.a + .45)), cd.type === 'intro' ? 1 - ease(p(t, cd.b - .4, cd.b)) : 1);
    if (CE.dataset.k !== String(cd.a)) { CE.dataset.k = String(cd.a);
      if (cd.type === 'intro') CE.innerHTML = `<img src="isotipo.png"><div class="su" style="margin:0;font-size:32px;letter-spacing:6px;font-weight:700;color:#7FB2FF">TUTORIAL · NEGOCIO360</div><div class="ti" style="font-size:130px;margin-top:16px">Compras</div><div class="list">${CHAP.map(c => `<div><span>${String(c.n).padStart(2, '0')}</span>${c.title}</div>`).join('')}</div>`;
      else CE.innerHTML = `<img src="isotipo.png"><div class="ti" style="font-size:96px">¡Listo! Ya sabés registrar tus compras</div><div class="su" style="margin-top:30px">Registrá · Abastecé · Controlá tu inventario</div><div class="su" style="margin-top:40px">Próximo tutorial: <b style="color:#fff">Gastos</b></div><div class="su" style="margin-top:40px;color:#7FB2FF;font-weight:700">negocio360oficial.com</div>`; }
    CE.style.opacity = o; const inner = CE.children; for (let i = 0; i < inner.length; i++) { const kk = ease(p(t, cd.a + .15 + i * .12, cd.a + .65 + i * .12)); inner[i].style.opacity = kk; inner[i].style.transform = `translateY(${(1 - kk) * 30}px)`; }
    $('views').style.filter = `blur(${8 * o}px)`; } else { CE.style.opacity = 0; $('views').style.filter = 'none'; }
};
render(0);
