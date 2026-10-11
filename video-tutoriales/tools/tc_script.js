const $ = id => document.getElementById(id);
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = x => 1 - Math.pow(1 - cl(x), 3);
const eio = x => { x = cl(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const p = (t, a, b) => cl((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const DUR = 190.43;



const STATES = ['base','tab_top','tab_frecuentes','tab_inactivos','tab_inact60','f_activos','f_frecuentes','f_nuevos','nc0','nc1','nc2','nc3','nc4','nc5','nc6','ventasRec','perfil','perfil2','inter','perfil3','vdet','perfil4','eliminar','importar','sync'];
const SRC = { ventasRec: 'vshots/base_top.jpg' };
const V = {};
STATES.forEach(s => { const d = document.createElement('div'); d.className = 'view'; d.style.opacity = 0; d.innerHTML = `<img class="topimg" src="${SRC[s] || 'cshots/' + s + '_top.jpg'}">`; $('views').appendChild(d); V[s] = d; });
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
  kpiRow: [400, 180, 1360, 110], kpis: [[404, 184, 214, 102], [632, 184, 214, 102], [859, 184, 214, 102], [1087, 184, 214, 102], [1315, 184, 214, 102], [1542, 184, 214, 102]],
  tabs: [[409, 319, 151, 36], [564, 319, 126, 36], [693, 319, 121, 36], [819, 319, 108, 36]], tabsAll: [404, 314, 528, 46],
  list: [405, 400, 1350, 680], cTel: [700, 517, 125, 450], cUlt: [1092, 517, 150, 450], cComp: [1250, 517, 92, 450], cTot: [1346, 517, 150, 450],
  listTable: [405, 380, 1350, 700], inact: [1525, 398, 217, 37], filtros: [[425, 469, 63, 30], [496, 469, 71, 30], [575, 469, 81, 30], [664, 469, 94, 30], [766, 469, 71, 30], [846, 469, 107, 30], [961, 469, 100, 30]], filtAll: [420, 464, 646, 40],
  hdr: [1300, 80, 470, 70], bImp: [1329, 101, 140, 34], bSync: [1479, 101, 118, 34], bNuevo: [1608, 100, 148, 35],
  modal: [660, 20, 600, 1060],
  nombre: [685, 132, 550, 37], tel: [685, 219, 269, 37], correo: [966, 219, 269, 37], empresa: [685, 305, 269, 37], ruc: [685, 479, 269, 37],
  dir: [685, 347, 550, 37], aniv: [966, 434, 269, 39], fact: [685, 523, 550, 37], cont: [685, 560, 550, 110], tipo: [685, 745, 550, 37], help: [685, 788, 550, 54],
  frec: [700, 426, 254, 37], montoDia: [700, 426, 520, 123], ya: [700, 356, 520, 38], caja: [715, 483, 490, 78], yaest: [715, 569, 490, 78], iva: [715, 688, 490, 39], nota: [700, 793, 520, 35],
  ventasRec: [300, 320, 1560, 345],
  eye: [1621, 570, 134, 30], perfil: [530, 45, 860, 990], stats: [[555, 175, 262, 76], [829, 175, 262, 76], [1103, 175, 262, 76], [555, 263, 262, 76], [829, 263, 262, 76], [1103, 263, 262, 76], [555, 351, 262, 76]],
  intList: [555, 235, 810, 375], bInt: [1183, 235, 182, 35], inter: [660, 259, 600, 562], interTipo: [685, 371, 269, 37],
  hist: [555, 278, 810, 760], row: [555, 315, 810, 46], vdet: [660, 258, 600, 564], bEdit: [1234, 980, 131, 34], elim: [740, 375, 440, 329], importar: [570, 344, 780, 391],
};
CARDS.push({ type: 'intro', a: 0, b: 6.2 });
cap(6.5, 13.4, 'Registrá clientes · Conocé a los que más compran · Dales seguimiento · Pagos recurrentes');

chap(13.79, 1, 'La pantalla de Clientes');
focus(13.8, R.kpiRow, 1.35, 1.04);
sl(14.0, 15.9, R.kpiRow, 'Resumen de tu cartera', '');
[['Total de clientes', 16.16, 17.95], ['Activos', 18.24, 20.6, 'Compraron en los últimos 30 días.'], ['Nuevos este mes', 20.81, 22.2], ['Tu mejor cliente', 22.42, 23.6], ['Total generado', 23.76, 25.3], ['Ticket promedio', 25.43, 27.2, 'Por compra.']].forEach(([n, a, b, tx], i) => { curTo(a - .3, R.kpis[i], .3); sl(a, b, g(R.kpis[i], 4), n, tx || '', i + 1); });

chap(27.6, 2, 'Las pestañas');
focus(27.6, [404, 300, 900, 80], 1.9, 1.15);
sl(27.8, 29.8, R.tabsAll, '4 pestañas', '');
curTo(29.8, R.tabs[0], .3); sl(30.1, 32.9, g(R.tabs[0], 4), 'Lista de clientes', 'Todos tus clientes.', 1);
focus(32.9, [690, 500, 820, 400], 1.6, 1.08);
[['Teléfono', 33.06, 34.0, 'cTel'], ['Última compra', 34.11, 35.3, 'cUlt'], ['Compras', 35.36, 36.9, 'cComp'], ['Total gastado', 36.99, 38.4, 'cTot']].forEach(([n, a, b, k]) => { curTo(a - .25, R[k], .25); sl(a, b, R[k], n, ''); });
focus(38.5, [404, 300, 1360, 560], 1.25, 1.05);
curTo(38.3, R.tabs[1], .3); click(38.6); st(38.85, 'tab_top'); sl(38.7, 41.9, g(R.tabs[1], 4), 'Top clientes', 'Los 10 que más te facturan.', 2);
curTo(41.7, R.tabs[2], .3); click(42.0); st(42.25, 'tab_frecuentes'); sl(42.05, 45.4, g(R.tabs[2], 4), 'Frecuentes', '5 compras o más.', 3);
curTo(45.3, R.tabs[3], .3); click(45.6); st(45.85, 'tab_inactivos'); sl(45.65, 47.0, g(R.tabs[3], 4), 'Inactivos', '', 4);
focus(47.0, [1100, 380, 700, 300], 1.8, 1.15);
curTo(47.2, R.inact); sl(47.0, 52.9, g(R.inact, 4), 'Sin comprar en 30 · 60 · 90 días', 'Volvé a contactarlos. 📞');
click(49.4); st(49.65, 'tab_inact60');

chap(53.3, 3, 'Filtrar');
curTo(53.0, R.tabs[0], .3); click(53.3); st(53.5, 'base'); focus(53.5, [404, 440, 900, 140], 1.75, 1.1);
sl(53.6, 55.7, R.filtAll, 'Filtrá tu lista', '');
[[55.91, 56.75, 1, 'f_activos', 'Activos'], [56.79, 57.75, 2, null, 'Inactivos'], [57.8, 58.7, 3, 'f_frecuentes', 'Frecuentes'], [58.74, 59.55, 4, 'f_nuevos', 'Nuevos']].forEach(([a, b, i, s, n]) => { curTo(a - .25, R.filtros[i], .25); click(a + .05); if (s) st(a + .25, s); sl(a, b, g(R.filtros[i], 4), n, ''); });
st(59.6, 'base'); curTo(59.5, R.filtros[5], .25); sl(59.6, 61.4, [R.filtros[5][0] - 4, 465, 223, 38], 'Con o sin compras', '');

chap(61.79, 4, 'Nuevo cliente');
focus(61.8, R.hdr, 2.2, 1.1); curTo(62.0, R.bNuevo);
sl(62.2, 64.8, g(R.bNuevo), 'Nuevo Cliente', ''); click(64.3); st(64.6, 'nc0'); focus(64.6, R.modal, 1.05, 1.0);
st(65.1, 'nc1');
[['Nombre', 65.22, 66.4, 'nombre'], ['Teléfono', 66.43, 67.35, 'tel'], ['Correo', 67.4, 68.3, 'correo'], ['Empresa', 68.36, 70.4, 'empresa'], ['RUC', 70.5, 71.9, 'ruc']].forEach(([n, a, b, k], i) => { curTo(a - .25, R[k], .25); sl(a, b, g(R[k], 5), n, '', i + 1); });
st(72.0, 'nc2');
[['Dirección', 72.0, 73.9, 'dir'], ['Dirección de entrega de factura', 73.99, 75.75, 'fact'], ['Fecha de aniversario', 75.84, 77.6, 'aniv']].forEach(([n, a, b, k], i) => { curTo(a - .25, R[k], .25); sl(a, b, g(R[k], 5), n, '', i + 1); });
st(77.85, 'nc3'); curTo(78.0, R.cont); sl(78.0, 83.2, g(R.cont, 5), 'Contactos asociados', 'Las personas de contacto dentro de la empresa.');

chap(83.46, 5, 'Tipo de cliente');
st(83.47, 'nc4'); curTo(83.5, R.tipo); sl(83.6, 85.7, g(R.tipo, 5), 'Tipo de cliente', '');
sl(85.9, 90.1, g(R.help, 5), 'Aleatorio', 'Compra de vez en cuando, sin ciclo fijo.', 1);
sl(90.3, 96.6, g(R.help, 5), 'Recurrente', 'Paga cada cierto tiempo: mensualidad, renta o membresía.', 2);

chap(96.9, 6, 'Cliente recurrente');
st(96.95, 'nc5'); curTo(97.0, R.frec); sl(97.0, 104.6, g(R.frec, 5), 'Frecuencia de pago', 'Mensual · Semanal · Quincenal · Anual · Personalizada');
curTo(104.7, R.montoDia, .4); sl(104.9, 108.1, g(R.montoDia, 5), 'Monto y día de pago', '');
st(108.4, 'nc6'); curTo(108.6, R.ya); sl(108.5, 111.3, g(R.ya, 5), '¿Ya pagó este periodo?', '');
sl(111.5, 114.2, g(R.caja, 4), 'Entra a caja ahora', '', 1); sl(114.3, 116.1, g(R.yaest, 4), 'O ya estaba registrado', '', 2);
curTo(116.1, R.iva, .3); sl(116.3, 118.7, g(R.iva, 4), 'IVA a sus pagos', '');
sl(118.9, 121.9, g(R.nota, 5), 'Próxima fecha de cobro', 'Se calcula sola.');
st(122.0, 'ventasRec'); focus(122.0, R.ventasRec, 1.2, 1.03);
sl(122.4, 126.7, R.ventasRec, 'Y aparece en Ventas', 'En «Clientes con pago recurrente».');

chap(127.05, 7, 'Ficha del cliente');
st(127.1, 'base'); cam(127.1, { x: 960, y: 540, z: 1 }, .6); curTo(127.1, R.eye, .5); click(127.7); st(128.0, 'perfil'); focus(128.0, R.perfil, 1.08, 1.0);
sl(128.2, 130.7, [550, 170, 820, 262], 'Todo en un solo lugar', '');
[['Total de compras', 130.87, 132.1, 0], ['Monto gastado', 132.2, 133.4, 1], ['Ticket promedio', 133.45, 134.65, 2], ['Primera y última compra', 134.72, 136.7, 3], ['Puntos acumulados', 136.78, 138.5, 6]].forEach(([n, a, b, i], j) => { curTo(a - .25, R.stats[i], .25); sl(a, b, i === 3 ? [550, 258, 546, 86] : g(R.stats[i], 4), n, '', j + 1); });

chap(138.67, 8, 'Interacciones');
st(138.7, 'perfil2'); sl(138.8, 141.5, g(R.intList, 4), 'Interacciones', 'Tu historial con el cliente.');
curTo(140.6, R.bInt, .5); click(141.4); st(141.65, 'inter'); focus(141.65, R.inter, 1.6, 1.1);
curTo(142.0, R.interTipo); sl(141.8, 148.9, g(R.interTipo, 5), 'Tipo de interacción', 'Llamada · Visita · Reunión · WhatsApp · Correo · Cotización · Reclamo');
st(149.1, 'perfil2'); focus(149.1, R.perfil, 1.08, 1.0); sl(149.2, 152.1, g(R.intList, 4), 'Historial completo', 'De cada relación.');

chap(152.38, 9, 'Historial de compras');
st(152.4, 'perfil3'); sl(152.5, 154.8, g(R.hist, 3), 'Historial de compras', '');
curTo(154.5, R.row, .4); sl(154.96, 155.6, g(R.row, 3), 'Tocá una venta', ''); click(155.4); st(155.7, 'vdet'); focus(155.7, R.vdet, 1.55, 1.08);
sl(155.9, 157.4, R.vdet, 'Detalle de la venta', '');

chap(157.59, 10, 'Editar, importar y sincronizar');
st(157.6, 'perfil4'); focus(157.6, [1000, 900, 400, 160], 2.2, 1.1); curTo(158.0, R.bEdit); sl(158.0, 160.4, g(R.bEdit, 5), 'Editar cliente', '');
st(160.65, 'eliminar'); focus(160.65, R.elim, 1.8, 1.12); sl(160.8, 165.6, R.elim, 'Eliminar = desactivar', 'Su historial de ventas se mantiene intacto.');
st(165.9, 'base'); focus(165.9, R.hdr, 2.2, 1.1); curTo(166.1, R.bImp); sl(166.0, 168.3, g(R.bImp, 5), 'Importar Excel', '');
click(168.2); st(168.5, 'importar'); focus(168.5, R.importar, 1.6, 1.1); sl(168.6, 170.6, R.importar, 'Cargá tu lista completa', '');
st(170.75, 'base'); focus(170.75, R.hdr, 2.2, 1.1); curTo(170.9, R.bSync); sl(170.9, 176.1, g(R.bSync, 5), 'Sincronizar', 'Actualiza las estadísticas desde tus ventas.'); click(172.0); st(172.3, 'sync');
CARDS.push({ type: 'outro', a: 176.36, b: DUR });
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
  $('cursor').style.opacity = inCard || t < 6.4 ? 0 : 1; $('cursor').style.transform = `translate(${cs.x - 6}px,${cs.y - 3}px) scale(${1 - .18 * press})`;
  if (rip != null) { const k2 = p(t, rip, rip + .55), Rr = 14 + 46 * ease(k2); const RP = $('ripple'); RP.style.opacity = 1 - k2; RP.style.left = (cs.x - Rr) + 'px'; RP.style.top = (cs.y - Rr) + 'px'; RP.style.width = RP.style.height = 2 * Rr + 'px'; } else $('ripple').style.opacity = 0;
  // chapter chip + banner + progress
  let ch = null; for (const C of CHAP) if (C.t <= t) ch = C;
  if (ch) $('chip').innerHTML = `<img src="isotipo.png" style="width:26px"><span>${String(ch.n).padStart(2, '0')}</span>${ch.title}`;
  $('chip').style.opacity = !inCard && ch && t > ch.t + 2.6 ? 1 : 0; $('wm').style.opacity = 0;
  const BN = $('banner');
  if (ch && t < ch.t + 2.6) { const o = Math.min(ease(p(t, ch.t, ch.t + .35)), 1 - ease(p(t, ch.t + 2.2, ch.t + 2.6))); BN.style.opacity = o; BN.style.transform = `translateX(${(1 - ease(p(t, ch.t, ch.t + .4))) * -60}px)`;
    $('bn').textContent = String(ch.n).padStart(2, '0'); $('bt').textContent = ch.title; } else BN.style.opacity = 0;
  $('prog').style.opacity = t > 6.2 && t < 176.3 ? 1 : 0; $('progi').style.width = (t / DUR * 100) + '%';
  // cards
  let cd = null; for (const C of CARDS) if (t >= C.a && t <= C.b) cd = C; const CE = $('card');
  if (cd) { const o = Math.min(ease(p(t, cd.a, cd.a + .45)), cd.type === 'intro' ? 1 - ease(p(t, cd.b - .4, cd.b)) : 1);
    if (CE.dataset.k !== String(cd.a)) { CE.dataset.k = String(cd.a);
      if (cd.type === 'intro') CE.innerHTML = `<img src="isotipo.png"><div class="su" style="margin:0;font-size:32px;letter-spacing:6px;font-weight:700;color:#7FB2FF">TUTORIAL · NEGOCIO360</div><div class="ti" style="font-size:130px;margin-top:16px">Clientes</div><div class="list">${CHAP.map(c => `<div><span>${String(c.n).padStart(2, '0')}</span>${c.title}</div>`).join('')}</div>`;
      else CE.innerHTML = `<img src="isotipo.png"><div class="ti" style="font-size:96px">¡Listo! Ya conocés a tus clientes</div><div class="su" style="margin-top:30px">Registrá · Conocé · Dale seguimiento · Cobrá a tiempo</div><div class="su" style="margin-top:40px">Próximo tutorial: <b style="color:#fff">Compras</b></div><div class="su" style="margin-top:40px;color:#7FB2FF;font-weight:700">negocio360oficial.com</div>`; }
    CE.style.opacity = o; const inner = CE.children; for (let i = 0; i < inner.length; i++) { const kk = ease(p(t, cd.a + .15 + i * .12, cd.a + .65 + i * .12)); inner[i].style.opacity = kk; inner[i].style.transform = `translateY(${(1 - kk) * 30}px)`; }
    $('views').style.filter = `blur(${8 * o}px)`; } else { CE.style.opacity = 0; $('views').style.filter = 'none'; }
};
render(0);
