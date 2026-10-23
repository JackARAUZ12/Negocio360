// ===== Video "Primeros pasos" (sin voz): composición =====
const fm = (t, r, z = 1.6, dur = .8) => focus(t, r, z, 1.08, dur);
const u = (a, b) => { const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]); return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]; };
const TYPES = [];   // escritura: {a,b,before,after,r,len,fs,fw,center,txt}
const KEYS = [];    // instantes de cada tecla (para el sonido)
function typ(a, b, before, after, id, txt, ms) {
  const F = (M[ms || before].F || {})[id]; if (!F) { console.warn('sin campo', id); return; }
  st(a - .05, before); TYPES.push({ a, b, after, r: F.r, fs: parseFloat(F.fs), fw: F.fw, pl: parseFloat(F.pl), center: F.ta === 'center', txt });
  const n = txt.length; for (let i = 0; i < n; i++) KEYS.push(a + (b - a) * (i + .5) / n);
  st(b, after);
}
const SCENES = [];  // escenas propias a pantalla completa: {type,a,b}
function scene(type, a, b) { SCENES.push({ type, a, b }); CARDS.push({ type: 'scene', a, b }); }

// ---------- 0. Intro
CARDS.push({ type: 'intro', a: 0, b: 5.2 });

// ---------- 1. WhatsApp
chap(5.0, 1, 'Recibí tu código');
scene('wa', 5.0, 18.6);
const WA_T = { m1: 6.9, m2: 8.7, m3: 10.7, glow: 12.2, tap: 15.6, zoom: 16.6 };
const WA_POP = [WA_T.m1, WA_T.m2, WA_T.m3];

// ---------- 2. Crear la cuenta
chap(18.6, 2, 'Creá tu cuenta');
st(18.0, 'r1'); fm(18.0, M.r1.card, 1.25, .01);
sl(19.4, 21.5, M.r1.code, 'Pegá tu código', 'El que te llegó por WhatsApp.');
curTo(19.6, M.r1.code, .6); click(21.4);
typ(21.6, 23.2, 'r1', 'r1b', 'codigoAcceso', 'NEGOCIO360-7K4P');
curTo(23.3, M.r1.btn, .5); sl(23.4, 24.6, M.r1.btn, 'Continuar', ''); click(24.3);
const RF = M.r2_0.F, CARD2 = M.r2_0.card;
st(24.7, 'r2_0'); fm(24.7, [CARD2[0], 300, CARD2[2], 330], 1.55, .8);
sl(25.2, 29.9, u(RF.nombre.r, RF.negocio.r), 'Tus datos', 'Nombre, apellido y tu negocio.', 1);
curTo(25.3, RF.nombre.r, .4); click(25.6); typ(25.7, 26.5, 'r2_0', 'r2_1', 'nombre', 'Ana');
curTo(26.6, RF.apellido.r, .3); click(26.8); typ(26.9, 27.8, 'r2_1', 'r2_2', 'apellido', 'López');
curTo(27.9, RF.negocio.r, .3); click(28.1); typ(28.2, 29.8, 'r2_2', 'r2_3', 'negocio', 'Minisúper La Esperanza');
cam(30.0, { x: CARD2[0] + CARD2[2] / 2, y: 560, z: 1.5 }, .7);
sl(30.2, 34.2, u(RF.email.r, RF.whatsapp.r), 'Correo y WhatsApp', '', 2);
curTo(30.2, RF.email.r, .3); click(30.4); typ(30.5, 32.4, 'r2_3', 'r2_4', 'email', 'ana@minisuperlaesperanza.com');
curTo(32.5, RF.whatsapp.r, .3); click(32.7); typ(32.8, 34.1, 'r2_4', 'r2_5', 'whatsapp', '+505 8765 4321');
cam(34.3, { x: CARD2[0] + CARD2[2] / 2, y: 760, z: 1.5 }, .7);
sl(34.5, 37.0, u(RF.password.r, RF.passwordConfirm.r), 'Tu contraseña', 'Mínimo 8 caracteres.', 3);
curTo(34.5, RF.password.r, .3); click(34.7); typ(34.8, 35.7, 'r2_5', 'r2_6', 'password', '•••••••••••••');
curTo(35.8, RF.passwordConfirm.r, .3); click(36.0); typ(36.1, 37.0, 'r2_6', 'r2_7', 'passwordConfirm', '•••••••••••••');
curTo(37.1, M.r2_t.terms, .4); click(37.6); st(37.7, 'r2_t');
sl(37.6, 40.0, g(u(M.r2_t.terms, M.r2_t.btn), 6), 'Aceptá y creá tu cuenta', '', 4);
curTo(38.4, M.r2_t.btn, .4); click(39.6);

// ---------- 3. Personalización
chap(40.3, 3, 'Personalizá tu negocio');
st(40.3, 'p1a'); cam(40.3, { x: 960, y: 540, z: 1 }, .01);
sl(41.2, 43.6, g(M.p1a.track, 10), '6 pasos rápidos', 'Empresa · Ubicación · Contacto · Finanzas · Visual · Módulos');
fm(43.6, [M.p1a.grid[0], 230, M.p1a.grid[2], 520], 1.45, .9);
sl(43.9, 47.4, g(M.p1a.tipo, 5), '¿Qué tipo de negocio tenés?', 'Elegí tu rubro.', 1);
curTo(45.6, M.p1a.tipo, .6); click(46.9); st(47.0, 'p1b');
const P1 = M.p1c.F;
st(48.0, 'p1c'); fm(48.0, [531, 480, 858, 520], 1.4, .01);
sl(48.4, 54.6, u(P1.nombre_comercial.r, P1.descripcion.r), 'Tu empresa', 'Nombre comercial y una breve descripción.', 1);
curTo(48.6, P1.nombre_comercial.r, .4); click(48.9); typ(49.0, 50.8, 'p1c', 'p1d', 'nombre_comercial', 'Minisúper La Esperanza');
curTo(50.9, P1.anio_fundacion.r, .3); click(51.1); typ(51.2, 51.9, 'p1d', 'p1e', 'anio_fundacion', '2019');
curTo(52.0, P1.descripcion.r, .3); click(52.2); typ(52.3, 54.5, 'p1e', 'p1f', 'descripcion', 'Abarrotes, granos, lácteos y productos de limpieza para el barrio.');
curTo(54.6, M.p1c.next, .4); click(55.2);
const P2 = M.p2a.F;
st(55.4, 'p2a'); fm(55.4, M.p2a.box, 1.45, .01);
sl(55.7, 61.0, g(M.p2a.box, -2), 'Ubicación', 'Nicaragua y tu zona horaria ya vienen listas.', 2);
curTo(56.0, P2.departamento.r, .4); click(56.4); typ(56.5, 57.3, 'p2a', 'p2b', 'departamento', 'Managua');
curTo(57.4, P2.ciudad.r, .3); click(57.6); typ(57.7, 58.5, 'p2b', 'p2c', 'ciudad', 'Managua');
curTo(58.6, P2.direccion.r, .3); click(58.8); typ(58.9, 60.6, 'p2c', 'p2d', 'direccion', 'Barrio Altagracia, de la iglesia 2 c. al sur');
curTo(60.7, M.p2a.next, .4); click(61.2);
const P3 = M.p3a.F;
st(61.4, 'p3a'); fm(61.4, M.p3a.box, 1.4, .01);
sl(61.7, 68.0, g(M.p3a.box, -2), 'Contacto', 'WhatsApp, correo y redes sociales.', 3);
curTo(61.9, P3.whatsapp.r, .4); click(62.4); typ(62.5, 63.5, 'p3a', 'p3b', 'whatsapp', '8765-4321');
curTo(63.6, P3.email_empresa.r, .3); click(63.8); typ(63.9, 65.6, 'p3b', 'p3c', 'email_empresa', 'ventas@minisuperlaesperanza.com');
curTo(65.7, P3.facebook.r, .3); click(65.9); typ(66.0, 67.8, 'p3c', 'p3d', 'facebook', 'https://facebook.com/minisuperlaesperanza');
curTo(67.9, M.p3a.next, .4); click(68.5);
st(68.7, 'p4a'); fm(68.7, M.p4a.box, 1.6, .01);
sl(69.0, 72.4, u(M.p4a.moneda, M.p4dd.dd), 'Tu moneda', 'Córdobas, dólares y más.', 4);
curTo(69.1, M.p4a.moneda, .5); click(69.8); st(70.0, 'p4dd');
curTo(70.4, [M.p4dd.dd[0], M.p4dd.dd[1] + 30, 200, 22], .5); click(71.2); st(71.4, 'p4b');
curTo(71.6, M.p4a.next, .5); click(72.6);
st(72.8, 'p5a'); fm(72.8, [531, 400, 858, 620], 1.35, .01);
sl(73.2, 76.0, g(M.p5b.logoArea, 4), 'Subí tu logo', '', 5);
curTo(73.3, M.p5a.logoArea, .5); click(74.0); st(74.3, 'p5b');
sl(76.1, 78.9, g(u(M.p5b.colors, M.p5b.presets), 4), 'Tus colores', 'Elegí una paleta o tus propios colores.');
curTo(76.2, M.p5b.chipE, .5); click(77.0); st(77.2, 'p5c');
curTo(79.0, M.p5c.claro, .5); click(79.6); st(79.8, 'p5d'); cam(79.8, { x: 960, y: 560, z: 1.3 }, .7);
sl(80.0, 82.5, g(M.p5d.claro, 4), 'Modo claro u oscuro', 'Todo el sistema se ve así.');
curTo(82.0, M.p5d.next, .4); click(82.7);
st(82.9, 'p6a'); fm(82.9, M.p6a.box, 1.35, .01);
sl(83.2, 87.0, g(M.p6a.grid, 4), 'Tus módulos', 'Activá solo lo que tu negocio necesita.', 6);
const G6 = M.p6a.grid; [0, 1, 2].forEach(i => { curTo(84.0 + i * .6, [G6[0] + 10 + i * 195, G6[1] + 10, 120, 30], .3); click(84.3 + i * .6); });
st(84.4, 'p6b');
curTo(86.6, M.p6a.fin, .5); click(87.4);
st(87.6, 'p_ok'); fm(87.6, M.p_ok.ok, 1.5, .01);
sl(87.9, 90.2, M.p_ok.ok, '¡Todo listo!', 'Tu espacio ya está configurado.');
st(90.4, 'd0'); cam(90.4, { x: 960, y: 540, z: 1 }, .01);
sl(91.0, 94.8, g(M.d0.saludo, 8), 'Tu panel, con tu nombre', 'Y con tu logo y tus colores.');

// ---------- 4. Caja inicial
chap(95.2, 4, 'Tu caja inicial');
curTo(95.4, M.d0.nav, .7); sl(95.6, 97.0, g(M.d0.nav, 4), 'Caja / Pagos', ''); click(96.8);
st(97.1, 'c0'); fm(97.1, M.c0.box, 1.7, .01);
sl(97.5, 100.4, g(M.c0.box, -4), '¡Bienvenida a Caja!', 'La primera vez te pide tu caja inicial.');
curTo(98.6, M.c0.inp, .5); click(100.3);
sl(100.5, 102.6, g(M.c0.inp, 6), '¿Con cuánto dinero arrancás?', 'Lo que tenés hoy en tu negocio.');
typ(100.6, 101.8, 'c0', 'c1', 'capital-inicial-monto', '15000');
curTo(101.9, M.c0.btn, .4); click(102.7);
st(103.0, 'c2'); cam(103.0, { x: 960, y: 420, z: 1.25 }, .01);
sl(103.4, 106.8, g(M.c2.k0, 4), 'Tu caja arranca con C$ 15,000', '');
cam(106.9, { x: 1080, y: 640, z: 1.2 }, .7);
sl(107.2, 110.6, M.c2.mov, 'Queda registrado', 'Desde aquí se mueve todo tu dinero.');

// ---------- 5. Inventario a mano
chap(111.0, 5, 'Tu inventario a mano');
st(111.0, 'pr0'); cam(111.0, { x: 960, y: 540, z: 1 }, .01);
sl(111.8, 114.6, [700, 740, 780, 120], 'Tu inventario está vacío', 'Vamos a llenarlo.');
cam(114.6, { x: 1500, y: 300, z: 1.6 }, .8); curTo(114.8, M.pr0.bNuevo, .6);
sl(115.4, 117.4, g(M.pr0.bNuevo, 5), '+ Nuevo Producto', ''); click(117.2);
const PM = M.pm0.F;
st(117.5, 'pm0'); fm(117.5, [620, 120, 680, 420], 1.5, .01);
sl(117.9, 122.0, u(PM.inputNombre.r, PM.inputCategoria.r), 'Nombre y categoría', '', 1);
curTo(118.2, PM.inputNombre.r, .4); click(118.6); typ(118.7, 120.4, 'pm0', 'pm1', 'inputNombre', 'Queso seco (libra)');
curTo(120.5, PM.inputCategoria.r, .3); click(120.7); typ(120.8, 121.8, 'pm1', 'pm2', 'inputCategoria', 'Lácteos');
const PM3 = M.pm3.F;
st(122.2, 'pm3'); fm(122.2, [620, 380, 680, 260], 1.5, .01);
sl(122.5, 127.2, u(PM3.inputCosto.r, PM3.inputPrecio.r), 'Costo y precio de venta', '', 2);
curTo(122.6, PM3.inputCosto.r, .4); click(122.9); typ(123.0, 123.6, 'pm3', 'pm4', 'inputCosto', '90');
curTo(123.7, PM3.inputPrecio.r, .3); click(123.9); typ(124.0, 124.7, 'pm4', 'pm5', 'inputPrecio', '120');
cam(125.0, { x: 960, y: 860, z: 1.5 }, .6);
sl(125.3, 127.2, g(M.pm5.margen, 4), 'El margen se calcula solo', '');
const PM6 = M.pm6.F;
st(127.4, 'pm6'); fm(127.4, [620, 420, 680, 200], 1.6, .01);
sl(127.7, 130.0, u(PM6.inputStockActual.r, PM6.inputStockMinimo.r), 'Cuánto tenés y el mínimo', 'Te avisa cuando se esté acabando.', 3);
curTo(127.8, PM6.inputStockActual.r, .4); click(128.1); typ(128.2, 128.7, 'pm6', 'pm7', 'inputStockActual', '20');
curTo(128.8, PM6.inputStockMinimo.r, .3); click(129.0); typ(129.1, 129.5, 'pm7', 'pm8', 'inputStockMinimo', '5');
cam(130.0, { x: 1100, y: 840, z: 1.5 }, .6); curTo(130.1, M.pm8.save, .5);
sl(130.3, 131.6, g(M.pm8.save, 5), 'Crear', ''); click(131.4);
st(131.7, 'pr1'); cam(131.7, { x: 960, y: 560, z: 1.1 }, .01);
sl(132.0, 135.6, M.pr1.row0, '¡Tu primer producto!', 'Con su precio, costo, margen y stock.');

// ---------- 6. Inventario desde Excel
chap(136.0, 6, 'Tu inventario desde Excel');
cap(136.4, 139.0, '¿Tenés muchos productos? <b>Subilos todos de una vez con Excel</b>');
cam(137.2, { x: 1400, y: 260, z: 1.5 }, .8); curTo(137.4, M.pr1.bPlant, .6); click(139.1); st(139.3, 'px_dd');
sl(139.4, 141.6, g(u(M.pr1.bPlant, M.px_dd.menu), 4), 'Descargá la plantilla', 'Precio fijo o escala de precios.', 1);
scene('xls', 141.9, 152.2);
const XLS_T = { a: 141.9, rows0: 143.4, rowDt: .55, save: 149.6 };
st(152.0, 'pr1'); cam(152.0, { x: 1400, y: 260, z: 1.5 }, .01);
curTo(152.4, M.pr1.bImp, .5); sl(152.6, 154.0, g(M.pr1.bImp, 5), 'Importar Excel', '', 2); click(153.8);
st(154.1, 'pi0'); fm(154.1, M.pi0.box, 1.6, .01);
curTo(154.6, M.pi0.btnSel, .5); sl(154.7, 156.4, g(M.pi0.btnSel, 5), 'Elegí tu archivo', 'mis_productos_minisuper.xlsx'); click(156.2);
st(156.5, 'pi1'); fm(156.5, M.pi1.box, 1.6, .01);
sl(156.8, 160.6, M.pi1.body, 'Revisá el resumen', '10 productos nuevos, sin errores.', 3);
curTo(160.0, M.pi1.ok, .5); sl(160.7, 162.3, g(M.pi1.ok, 5), 'Confirmar importación', ''); click(162.1);
st(162.4, 'pi2'); fm(162.4, M.pi2.box, 1.6, .01);
sl(162.7, 165.4, M.pi2.body, '¡Importación completada! 🎉', '');
st(165.6, 'pr2'); cam(165.6, { x: 1080, y: 640, z: 1.08 }, .01);
sl(166.0, 170.4, [M.pr2.table[0], M.pr2.table[1], M.pr2.table[2], 1080 - M.pr2.table[1] - 4], 'Todo tu inventario, listo', '11 productos con precio, costo y stock.');
CARDS.push({ type: 'outro', a: 170.8, b: DUR });

// ---------- motor de escenas y escritura (se agrega al render del tutorial)
const XROWS = [['PRODUCTO','Arroz Faisán 1 lb','','Granos','ARZ-001','Distribuidora La Fe','',14,18,100,20],['PRODUCTO','Frijol rojo 1 lb','','Granos','FRJ-001','Distribuidora La Fe','',22,28,80,15],
  ['PRODUCTO','Azúcar morena 1 lb','','Abarrotes','AZU-001','Distribuidora La Fe','',13,16,120,20],['PRODUCTO','Aceite Clover 1 L','','Abarrotes','ACE-001','Distribuidora La Fe','',62,78,36,6],
  ['PRODUCTO','Café Presto 200 g','','Abarrotes','CAF-001','Distribuidora La Fe','',115,145,24,5],['PRODUCTO','Leche Parmalat 1 L','','Lácteos','LEC-001','Distribuidora La Fe','',30,38,48,12],
  ['PRODUCTO','Huevos cartón 30','','Lácteos','HUE-030','Distribuidora La Fe','',135,165,15,3],['PRODUCTO','Jabón Xedex 1 kg','','Limpieza','JAB-001','Distribuidora La Fe','',52,68,30,6],
  ['PRODUCTO','Gaseosa Rojita 3 L','','Bebidas','GAS-003','Distribuidora La Fe','',50,65,24,6],['PRODUCTO','Papel higiénico 4 rollos','','Higiene','PAP-004','Distribuidora La Fe','',38,52,40,8]];
const XHEAD = ['TipoRegistro','Nombre','Descripcion','Categoria','SKU','MarcaProveedor','CodigoBarras','Costo','PrecioVenta','StockInicial','StockMinimo'];
const XW = [140, 255, 120, 128, 112, 200, 135, 86, 120, 118, 120];
(function buildScenes() {
  const st0 = document.createElement('style'); st0.textContent = `
  #scn{position:absolute;inset:0;z-index:8;opacity:0;overflow:hidden;font-family:'Plus Jakarta Sans','Inter',sans-serif}
  #tview{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;z-index:1;pointer-events:none}
  #tview img{width:1920px;height:1080px}
  #caret{position:absolute;width:3px;background:#2563EB;z-index:3;opacity:0;border-radius:2px}
  .wa-bg{position:absolute;inset:0;background:radial-gradient(900px 700px at 15% 20%,#D7F5E3,transparent 60%),radial-gradient(900px 700px at 90% 85%,#DCE8FF,transparent 60%),#F3F6FB}
  .phone{position:absolute;left:330px;top:70px;width:470px;height:940px;border-radius:64px;background:#111;box-shadow:0 40px 90px rgba(20,30,60,.35),inset 0 0 0 3px #333;padding:16px}
  .screen{position:absolute;inset:16px;border-radius:50px;overflow:hidden;background:#ECE5DD}
  .wa-top{height:120px;background:#075E54;color:#fff;display:flex;align-items:flex-end;gap:14px;padding:0 20px 16px}
  .wa-av{width:52px;height:52px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
  .wa-av img{width:36px}
  .wa-nm{font-size:25px;font-weight:700}.wa-nm small{display:block;font-size:15px;font-weight:500;opacity:.8;margin-top:2px}
  .wa-body{position:absolute;top:120px;left:0;right:0;bottom:80px;padding:22px 18px;display:flex;flex-direction:column;gap:14px;background-image:radial-gradient(rgba(0,0,0,.035) 1.5px,transparent 1.5px);background-size:22px 22px}
  .wa-day{align-self:center;background:#E1F2FB;color:#4A5A66;font-size:17px;padding:5px 12px;border-radius:8px}
  .bub{align-self:flex-start;max-width:410px;background:#fff;border-radius:4px 16px 16px 16px;padding:14px 17px 26px;font-size:25px;line-height:1.38;color:#111;box-shadow:0 1px 1px rgba(0,0,0,.12);position:relative;transform-origin:0 0}
  .bub .tm{position:absolute;right:10px;bottom:5px;font-size:14px;color:#8696A0}
  .code{margin-top:10px;font-family:'JetBrains Mono',monospace;font-size:31px;font-weight:800;letter-spacing:1px;color:#075E54;background:#E7F7EE;border:2px dashed #25D366;border-radius:10px;padding:8px 12px;text-align:center}
  .lnk{color:#027EB5;text-decoration:underline;word-break:break-all}
  .dots{align-self:flex-start;background:#fff;border-radius:4px 16px 16px 16px;padding:14px 18px;display:flex;gap:6px}
  .dots i{width:9px;height:9px;border-radius:50%;background:#9AA5AD;display:block}
  .wa-in{position:absolute;left:0;right:0;bottom:0;height:80px;background:#F0F0F0;display:flex;align-items:center;gap:10px;padding:0 14px}
  .wa-in div{flex:1;height:48px;border-radius:24px;background:#fff;color:#999;font-size:18px;display:flex;align-items:center;padding:0 18px}
  .wa-in b{width:48px;height:48px;border-radius:50%;background:#25D366}
  .wa-txt{position:absolute;left:930px;top:300px;width:820px}
  .wa-k{font-size:26px;font-weight:800;letter-spacing:5px;color:#25A35A}
  .wa-h{font-size:78px;font-weight:900;letter-spacing:-2px;line-height:1.05;color:#0F1B2D;margin-top:14px}
  .wa-s{font-size:34px;font-weight:600;color:#4A5568;margin-top:26px;line-height:1.35}
  .wa-s b{color:#0F1B2D}
  .tap{position:absolute;border-radius:50%;border:5px solid #25D366;opacity:0}
  .xl{position:absolute;left:150px;top:120px;width:1620px;height:840px;background:#fff;border-radius:14px;box-shadow:0 40px 90px rgba(20,30,60,.3);overflow:hidden}
  .xl-top{height:54px;background:#107C41;color:#fff;display:flex;align-items:center;gap:14px;padding:0 20px;font-size:19px;font-weight:600}
  .xl-rib{height:70px;background:#F3F3F3;border-bottom:1px solid #DDD;display:flex;align-items:center;gap:28px;padding:0 24px;font-size:16px;color:#333}
  .xl-rib span{padding:6px 10px;border-radius:6px}
  .xl-fx{height:40px;border-bottom:1px solid #DDD;display:flex;align-items:center;font-size:16px;color:#555;padding-left:14px;gap:14px}
  .xl-g{position:absolute;top:164px;left:0;right:0;bottom:44px;font-family:Calibri,'Inter',sans-serif;font-size:19px;color:#111}
  .xl-r{display:flex;height:50px;border-bottom:1px solid #E2E2E2}
  .xl-r > div{border-right:1px solid #E2E2E2;padding:0 8px;display:flex;align-items:center;white-space:nowrap;overflow:hidden}
  .xl-r .n{width:44px;justify-content:center;background:#F3F3F3;color:#666;font-size:14px}
  .xl-h > div{background:#E8F3EC;font-weight:700;color:#0B5D30}
  .xl-L > div{height:30px;background:#F3F3F3;color:#666;justify-content:center;font-size:14px}
  .xl-tabs{position:absolute;bottom:0;left:0;right:0;height:44px;background:#F3F3F3;border-top:1px solid #DDD;display:flex;align-items:center;gap:6px;padding-left:60px;font-size:15px}
  .xl-tabs span{padding:6px 16px;border-radius:6px 6px 0 0}
  .xl-tabs span.on{background:#fff;color:#107C41;font-weight:700;border-bottom:3px solid #107C41}
  .xl-save{position:absolute;right:40px;top:70px;background:#107C41;color:#fff;font-size:22px;font-weight:700;padding:14px 22px;border-radius:12px;opacity:0;box-shadow:0 12px 30px rgba(16,124,65,.4)}
  .xl-cap{position:absolute;left:50%;top:40px;transform:translateX(-50%);font-size:40px;font-weight:800;color:#0F1B2D;white-space:nowrap}
  .xl-cap b{color:#107C41}`;
  document.head.appendChild(st0);
  const tv = document.createElement('div'); tv.id = 'tview'; tv.innerHTML = '<img>'; $('stage').insertBefore(tv, $('spot'));
  const ca = document.createElement('div'); ca.id = 'caret'; $('stage').insertBefore(ca, $('spot'));
  const sc = document.createElement('div'); sc.id = 'scn'; $('stage').appendChild(sc);
})();
function waHTML() {
  return `<div class="wa-bg"></div>
  <div class="phone"><div class="screen">
    <div class="wa-top"><div class="wa-av"><img src="isotipo.png"></div><div class="wa-nm">Negocio360 ✅<small>en línea</small></div></div>
    <div class="wa-body">
      <div class="wa-day">HOY</div>
      <div class="dots" id="wd1"><i></i><i></i><i></i></div>
      <div class="bub" id="wb1">¡Hola Ana! 👋 Bienvenida a <b>Negocio360</b>.<span class="tm">9:41</span></div>
      <div class="dots" id="wd2"><i></i><i></i><i></i></div>
      <div class="bub" id="wb2">Este es tu código de acceso:<div class="code" id="wcode">NEGOCIO360-7K4P</div><span class="tm">9:41</span></div>
      <div class="dots" id="wd3"><i></i><i></i><i></i></div>
      <div class="bub" id="wb3">Entrá aquí para crear tu cuenta 👇<br><span class="lnk" id="wlink">negocio360oficial.com/register.html</span><span class="tm">9:42</span></div>
    </div>
    <div class="wa-in"><div>Mensaje</div><b></b></div>
  </div></div>
  <div class="tap" id="wtap"></div>
  <div class="wa-txt"><div class="wa-k">PASO 1</div><div class="wa-h" id="wah">Te llega tu código por WhatsApp</div><div class="wa-s" id="was">Nosotros te lo enviamos cuando activás tu cuenta.</div></div>`;
}
function xlsHTML() {
  const cols = 'ABCDEFGHIJK'.split('');
  const row = (n, cells, cls = '') => `<div class="xl-r ${cls}" ${n ? `id="xr${n}"` : ''}><div class="n">${n || ''}</div>${cells.map((c, i) => `<div style="width:${XW[i]}px;${i >= 7 ? 'justify-content:flex-end' : ''}">${c}</div>`).join('')}</div>`;
  return `<div class="wa-bg"></div><div class="xl-cap" id="xcap">Llená la plantilla con <b>tus productos</b></div>
  <div class="xl"><div class="xl-top">🟩 mis_productos_minisuper.xlsx — Excel</div>
  <div class="xl-rib"><span style="background:#fff;font-weight:700;color:#107C41">Inicio</span><span>Insertar</span><span>Diseño</span><span>Fórmulas</span><span>Datos</span><span>Vista</span></div>
  <div class="xl-fx"><b style="color:#107C41">fx</b><span id="xfx"></span></div>
  <div class="xl-g">${row(0, cols, 'xl-L').replace('<div class="n"></div>', '<div class="n" style="height:30px"></div>')}${row(1, XHEAD, 'xl-h')}${XROWS.map((r, i) => row(i + 2, r.map(String))).join('')}</div>
  <div class="xl-tabs"><span class="on">Productos</span><span>Instrucciones</span></div>
  <div class="xl-save" id="xsave">💾 Guardado</div></div>`;
}
function sceneFrame(t) {
  const sc = $('scn'); let S = null; for (const x of SCENES) if (t >= x.a && t <= x.b) S = x;
  if (!S) { sc.style.opacity = 0; sc.dataset.k = ''; return; }
  if (sc.dataset.k !== S.type) { sc.dataset.k = S.type; sc.innerHTML = S.type === 'wa' ? waHTML() : xlsHTML(); }
  const o = Math.min(ease(p(t, S.a, S.a + .45)), 1 - ease(p(t, S.b - .5, S.b))); sc.style.opacity = o;
  if (S.type === 'wa') {
    const show = (id, t0) => { const e = $(id); if (!e) return; const k = ease(p(t, t0, t0 + .3)); e.style.display = t >= t0 ? '' : 'none'; e.style.transform = `scale(${.85 + .15 * k})`; e.style.opacity = k; };
    const dots = (id, t0, t1) => { const e = $(id); if (!e) return; e.style.display = t >= t0 && t < t1 ? 'flex' : 'none'; [...e.children].forEach((d, i) => d.style.transform = `translateY(${-5 * Math.max(0, Math.sin((t * 6 - i * .7)))}px)`); };
    dots('wd1', WA_T.m1 - .9, WA_T.m1); show('wb1', WA_T.m1); dots('wd2', WA_T.m2 - .9, WA_T.m2); show('wb2', WA_T.m2); dots('wd3', WA_T.m3 - .9, WA_T.m3); show('wb3', WA_T.m3);
    const code = $('wcode'); if (code) { const gk = t > WA_T.glow && t < WA_T.tap ? .5 + .5 * Math.sin((t - WA_T.glow) * 6) : 0; code.style.boxShadow = `0 0 0 ${6 * gk}px rgba(37,211,102,.35), 0 0 ${30 * gk}px rgba(37,211,102,.6)`; }
    const H = $('wah'), Sx = $('was');
    const txt = t < WA_T.glow ? ['Te llega tu código por WhatsApp', 'Nosotros te lo enviamos cuando activás tu cuenta.'] : t < WA_T.tap - .4 ? ['Este es tu código', 'Lo vas a pegar en el siguiente paso: <b>NEGOCIO360-7K4P</b>'] : ['Tocá el enlace', 'Se abre la página para <b>crear tu cuenta</b>.'];
    if (H.textContent !== txt[0]) { H.textContent = txt[0]; Sx.innerHTML = txt[1]; }
    const lk = $('wlink'), tp = $('wtap'); if (lk && tp) { const r = lk.getBoundingClientRect(); const k = p(t, WA_T.tap, WA_T.tap + .6); const R = 16 + 50 * ease(k); tp.style.opacity = t > WA_T.tap && k < 1 ? 1 - k : 0; tp.style.left = (r.left + r.width * .45 - R) + 'px'; tp.style.top = (r.top + r.height / 2 - R) + 'px'; tp.style.width = tp.style.height = 2 * R + 'px'; lk.style.background = t > WA_T.tap && t < WA_T.tap + .8 ? 'rgba(2,126,181,.18)' : 'transparent'; }
    const wt = sc.querySelector('.wa-txt'); if (wt) wt.style.opacity = 1 - ease(p(t, WA_T.zoom, WA_T.zoom + .5));
    const z = 1 + 1.6 * eio(p(t, WA_T.zoom, S.b)); const ph = sc.querySelector('.phone'); if (ph) { ph.style.transformOrigin = '235px 700px'; ph.style.transform = `scale(${z})`; }
  } else {
    for (let i = 0; i < XROWS.length; i++) { const e = $('xr' + (i + 2)); if (!e) continue; const t0 = XLS_T.rows0 + i * XLS_T.rowDt; const k = ease(p(t, t0, t0 + .25)); e.style.opacity = t >= t0 ? k : 0; e.style.background = t >= t0 && t < t0 + .5 ? '#E8F3EC' : ''; }
    const cur = Math.min(XROWS.length - 1, Math.floor((t - XLS_T.rows0) / XLS_T.rowDt)); const fx = $('xfx'); if (fx) fx.textContent = cur >= 0 ? XROWS[cur][1] : '';
    const sv = $('xsave'); if (sv) { const k = ease(p(t, XLS_T.save, XLS_T.save + .3)); sv.style.opacity = t > XLS_T.save ? k : 0; sv.style.transform = `translateY(${(1 - k) * -14}px)`; }
    const cp = $('xcap'); if (cp) cp.innerHTML = t < XLS_T.save ? 'Llená la plantilla con <b>tus productos</b>' : 'Guardá el archivo y <b>subilo</b>';
  }
}
const _mctx = document.createElement('canvas').getContext('2d');
function typeFrame(t) {
  const tv = $('tview'), ca = $('caret'); let T = null; for (const x of TYPES) if (t >= x.a && t < x.b + .02) T = x;
  if (!T) { tv.style.opacity = 0; ca.style.opacity = 0; return; }
  const c = clampCam(camAt(t)); const img = tv.firstChild; const src = 'nshots/' + T.after + '_top.jpg'; if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  tv.style.transform = `translate(${960 - c.x * c.z}px,${540 - c.y * c.z}px) scale(${c.z})`; tv.style.opacity = 1;
  _mctx.font = `${T.fw} ${T.fs}px 'Plus Jakarta Sans','Inter',sans-serif`; const fullW = _mctx.measureText(T.txt).width * (T.center ? 1.3 : 1.04);
  const n = T.txt.length, k = Math.min(1, (t - T.a) / (T.b - T.a)), chars = Math.min(n, Math.floor(k * n + .001)), w = fullW * chars / n;
  const [x, y, W, Hh] = T.r; let x0 = T.center ? x + W / 2 - fullW / 2 : x + T.pl; const xe = x0 + w;
  const L = T.center ? x0 : x; tv.style.clipPath = `inset(${y}px ${Math.max(0, 1920 - xe)}px ${1080 - y - Hh}px ${L}px)`;
  const s = toS(c, xe + 1, y + Hh * .22), e2 = toS(c, xe + 1, y + Hh * .78);
  ca.style.left = s.x + 'px'; ca.style.top = s.y + 'px'; ca.style.height = (e2.y - s.y) + 'px'; ca.style.opacity = Math.floor(t * 3.2) % 2 === 0 || t < T.b - .05 ? 1 : 0;
}
