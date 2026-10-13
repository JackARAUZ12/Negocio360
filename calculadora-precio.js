/* ============================================================
   CALCULADORA-PRECIO.JS — NEGOCIO360
   Calculadora aislada Costo → Precio (y Precio → Ganancia).
   NO guarda nada, NO escribe en ninguna tabla y NO toca otros
   módulos. Solo lee el nombre/color del negocio y la moneda para
   que la pantalla se vea igual que el resto del sistema.
   Los cálculos viven en CP.calc* (funciones puras, sin DOM).
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const esc = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

const CP = {
  moneda: 'NIO',
  modo: 'costo',          // 'costo' = Costo → Precio · 'precio' = Precio → Ganancia
};

/* ---------- cálculos puros (sin DOM) ---------- */
// Niveles de margen sobre la VENTA (de cada C$100 que cobras, cuánto es ganancia).
const NIVELES = [
  { id: 'competitivo', nombre: 'Competitivo', margen: 0.20, nota: 'Precio bajo para atraer clientes y vender rápido.' },
  { id: 'recomendado', nombre: 'Recomendado', margen: 0.30, nota: 'Equilibrio entre ganar bien y ser accesible.' },
  { id: 'premium',     nombre: 'Premium',     margen: 0.40, nota: 'Para productos únicos, de marca o con poca competencia.' },
];

// Sube el precio al múltiplo más cercano hacia arriba (paso 0 = sin redondear).
function redondearArriba(precio, paso) {
  paso = Number(paso) || 0;
  if (paso <= 0) return r2(precio);
  return r2(Math.ceil(precio / paso - 1e-9) * paso);
}

// Datos: costo, extra (flete/empaque por unidad), impuestoPct (0 si no aplica),
// paso de redondeo, competencia (precio final de otro vendedor, opcional).
function calcPrecio({ costo, extra = 0, impuestoPct = 0, paso = 1, margen }) {
  const costoReal = r2((Number(costo) || 0) + (Number(extra) || 0));
  if (!(costoReal > 0) || !(margen > 0) || margen >= 1) return null;
  const t = (Number(impuestoPct) || 0) / 100;
  const baseIdeal = costoReal / (1 - margen);                // precio sin impuesto
  const precio = redondearArriba(baseIdeal * (1 + t), paso); // lo que paga el cliente
  const base = precio / (1 + t);                             // lo que realmente te queda sin impuesto
  const ganancia = base - costoReal;
  return {
    costoReal,
    precio,
    impuesto: r2(precio - base),
    ganancia: r2(ganancia),
    margen: base > 0 ? ganancia / base : 0,      // sobre la venta
    markup: ganancia / costoReal,                // sobre el costo
  };
}

// Precio → ganancia: el usuario ya tiene (o piensa poner) un precio.
function calcGanancia({ costo, extra = 0, impuestoPct = 0, precio }) {
  const costoReal = r2((Number(costo) || 0) + (Number(extra) || 0));
  precio = Number(precio) || 0;
  if (!(costoReal > 0) || !(precio > 0)) return null;
  const t = (Number(impuestoPct) || 0) / 100;
  const base = precio / (1 + t);
  const ganancia = base - costoReal;
  return {
    costoReal, precio, impuesto: r2(precio - base), base: r2(base),
    ganancia: r2(ganancia), margen: base > 0 ? ganancia / base : 0, markup: ganancia / costoReal,
  };
}

// Compara un precio contra la competencia.
function vsCompetencia(precio, competencia) {
  competencia = Number(competencia) || 0;
  if (!(competencia > 0)) return null;
  const dif = (precio - competencia) / competencia;
  if (Math.abs(dif) < 0.005) return { clase: 'igual', texto: 'Igual que la competencia' };
  if (dif < 0) return { clase: 'bajo', texto: `${(Math.abs(dif) * 100).toFixed(0)}% más barato que la competencia` };
  return { clase: 'alto', texto: `${(dif * 100).toFixed(0)}% más caro que la competencia` };
}

// Elige el mejor nivel considerando la competencia: el de mayor margen que NO
// supere el precio de la competencia. Sin competencia, el "recomendado".
function elegirSugerido(resultados, competencia) {
  competencia = Number(competencia) || 0;
  if (!(competencia > 0)) return { id: 'recomendado', aviso: null };
  const validos = resultados.filter(r => r.calc && r.calc.precio <= competencia + 0.005);
  if (validos.length) {
    const mejor = validos.reduce((a, b) => (b.calc.margen > a.calc.margen ? b : a));
    return { id: mejor.id, aviso: null };
  }
  return { id: null, aviso: 'Incluso el precio Competitivo queda por encima de la competencia. Revisa si puedes bajar tu costo, o diferénciate con servicio, calidad o garantía.' };
}

/* ---------- formato ---------- */
function sym() { return CP.moneda === 'USD' ? '$' : 'C$'; }
function fmt(n) { return sym() + ' ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(n) { return (Number(n || 0) * 100).toLocaleString('es-NI', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + '%'; }
function num(id) { const el = document.getElementById(id); const v = el ? parseFloat(String(el.value).replace(',', '.')) : NaN; return isFinite(v) ? v : 0; }
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

/* ---------- lectura de entradas ---------- */
function leerBase() {
  const impuestoOn = document.getElementById('cp-iva-on')?.checked;
  return {
    costo: num('cp-costo'),
    extra: num('cp-extra'),
    impuestoPct: impuestoOn ? num('cp-iva-pct') : 0,
    paso: parseFloat(val('cp-redondeo')) || 0,
    competencia: num('cp-competencia'),
    cantidad: Math.max(0, Math.floor(num('cp-cantidad'))),
    margenPropio: num('cp-margen-propio') / 100,
  };
}

/* ---------- render ---------- */
function tarjetaPrecio(r, entrada, sugerido) {
  const c = r.calc;
  if (!c) return '';
  const vs = vsCompetencia(c.precio, entrada.competencia);
  const total = entrada.cantidad > 0 ? `<div class="cp-fila"><span>Ganancia por ${entrada.cantidad} unid.</span><b>${fmt(c.ganancia * entrada.cantidad)}</b></div>` : '';
  return `
    <div class="cp-card${sugerido ? ' sugerido' : ''}">
      ${sugerido ? '<div class="cp-chip">Sugerido para ti</div>' : ''}
      <div class="cp-card-nombre">${esc(r.nombre)}</div>
      <div class="cp-card-precio">${fmt(c.precio)}</div>
      ${entrada.impuestoPct > 0 ? `<div class="cp-card-sub">incluye ${fmt(c.impuesto)} de impuesto</div>` : '<div class="cp-card-sub">precio de venta</div>'}
      <div class="cp-fila"><span>Ganas por unidad</span><b class="cp-ok">${fmt(c.ganancia)}</b></div>
      <div class="cp-fila"><span>Margen (sobre la venta)</span><b>${pct(c.margen)}</b></div>
      <div class="cp-fila"><span>Recargo sobre el costo</span><b>${pct(c.markup)}</b></div>
      ${total}
      ${vs ? `<div class="cp-vs ${vs.clase}">${esc(vs.texto)}</div>` : ''}
      <p class="cp-card-nota">${esc(r.nota)}</p>
    </div>`;
}

function renderCostoPrecio() {
  const out = document.getElementById('cp-resultado');
  const e = leerBase();
  if (!(e.costo > 0)) {
    out.innerHTML = `<div class="cp-vacio"><div class="cp-vacio-i">🧮</div><b>Escribe el costo del producto</b><p>Te mostraré tres precios posibles y cuánto ganarías con cada uno.</p></div>`;
    return;
  }
  const niveles = NIVELES.map(n => ({ ...n, calc: calcPrecio({ ...e, margen: n.margen }) }));
  if (e.margenPropio > 0 && e.margenPropio < 1) {
    niveles.push({ id: 'propio', nombre: `Mi margen (${pct(e.margenPropio)})`, margen: e.margenPropio,
      nota: 'Calculado con el margen que tú escribiste.', calc: calcPrecio({ ...e, margen: e.margenPropio }) });
  }
  const sug = elegirSugerido(niveles, e.competencia);
  const costoReal = r2(e.costo + e.extra);
  out.innerHTML = `
    <div class="cp-resumen">Tu costo real por unidad es <b>${fmt(costoReal)}</b>${e.extra > 0 ? ` (${fmt(e.costo)} + ${fmt(e.extra)} de gastos extra)` : ''}.</div>
    ${sug.aviso ? `<div class="cp-aviso">⚠️ ${esc(sug.aviso)}</div>` : ''}
    <div class="cp-cards">${niveles.map(n => tarjetaPrecio(n, e, n.id === sug.id)).join('')}</div>
    <p class="cp-pie">Margen = qué parte del precio es ganancia. Recargo = cuánto le subes al costo. Son estimaciones: revisa el precio de tu zona antes de decidir.</p>`;
}

function renderPrecioGanancia() {
  const out = document.getElementById('cp-resultado');
  const e = leerBase();
  const precio = num('cp-precio');
  if (!(e.costo > 0) || !(precio > 0)) {
    out.innerHTML = `<div class="cp-vacio"><div class="cp-vacio-i">💰</div><b>Escribe el costo y el precio al que piensas vender</b><p>Te digo cuánto ganas y si es un buen margen.</p></div>`;
    return;
  }
  const g = calcGanancia({ ...e, precio });
  const vs = vsCompetencia(precio, e.competencia);
  let veredicto, clase;
  if (g.ganancia <= 0) { veredicto = 'Con este precio pierdes dinero: no cubre tu costo.'; clase = 'mal'; }
  else if (g.margen < 0.10) { veredicto = 'Ganancia muy baja: cualquier descuento o merma te deja sin utilidad.'; clase = 'mal'; }
  else if (g.margen < 0.20) { veredicto = 'Ganancia ajustada: sirve para atraer clientes, pero deja poco colchón.'; clase = 'medio'; }
  else if (g.margen < 0.45) { veredicto = 'Buen margen para la mayoría de negocios.'; clase = 'bien'; }
  else { veredicto = 'Margen alto: revisa que el precio siga siendo competitivo.'; clase = 'bien'; }
  const precioMin = calcPrecio({ ...e, margen: 0.20 });
  out.innerHTML = `
    <div class="cp-veredicto ${clase}">${esc(veredicto)}</div>
    <div class="cp-cards uno">
      <div class="cp-card">
        <div class="cp-card-nombre">Con tu precio</div>
        <div class="cp-card-precio">${fmt(g.precio)}</div>
        <div class="cp-card-sub">tu costo real es ${fmt(g.costoReal)}</div>
        <div class="cp-fila"><span>Ganas por unidad</span><b class="${g.ganancia > 0 ? 'cp-ok' : 'cp-mal'}">${fmt(g.ganancia)}</b></div>
        <div class="cp-fila"><span>Margen (sobre la venta)</span><b>${pct(g.margen)}</b></div>
        <div class="cp-fila"><span>Recargo sobre el costo</span><b>${pct(g.markup)}</b></div>
        ${e.impuestoPct > 0 ? `<div class="cp-fila"><span>Impuesto incluido</span><b>${fmt(g.impuesto)}</b></div>` : ''}
        ${e.cantidad > 0 ? `<div class="cp-fila"><span>Ganancia por ${e.cantidad} unid.</span><b>${fmt(g.ganancia * e.cantidad)}</b></div>` : ''}
        ${vs ? `<div class="cp-vs ${vs.clase}">${esc(vs.texto)}</div>` : ''}
        ${precioMin ? `<p class="cp-card-nota">Para ganar al menos 20% de margen, tu precio debería ser ${fmt(precioMin.precio)} o más.</p>` : ''}
      </div>
    </div>`;
}

function render() { if (CP.modo === 'costo') renderCostoPrecio(); else renderPrecioGanancia(); }

function setModo(m) {
  CP.modo = m;
  document.querySelectorAll('[data-cp-modo]').forEach(b => b.classList.toggle('on', b.dataset.cpModo === m));
  document.getElementById('cp-campo-precio').style.display = m === 'precio' ? '' : 'none';
  document.getElementById('cp-campo-margen').style.display = m === 'costo' ? '' : 'none';
  render();
}
function limpiar() {
  ['cp-costo', 'cp-extra', 'cp-precio', 'cp-competencia', 'cp-cantidad', 'cp-margen-propio'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  render();
  document.getElementById('cp-costo')?.focus();
}

/* ---------- tema / sidebar / toast (idéntico al resto) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('n360_theme', t); } catch (_) {}
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = t === 'dark' ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
let sidebarCollapsed = false;
function isMobileView() { return window.innerWidth <= 768; }
function toggleSidebar() {
  if (isMobileView()) {
    const s = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
    if (!s) return;
    const open = s.classList.toggle('mobile-open');
    if (ov) ov.classList.toggle('active', open);
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}
function closeMobileSidebar() {
  const s = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
  if (s) s.classList.remove('mobile-open');
  if (ov) ov.classList.remove('active');
}
window.addEventListener('resize', () => { if (!isMobileView()) closeMobileSidebar(); });
function navigate(url) { closeMobileSidebar(); window.location.href = url; }

/* ---------- empresa / perfil (solo lectura, para el encabezado) ---------- */
async function cargarEmpresa(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('nombre_comercial, moneda, color_principal').eq('auth_user_id', userId).maybeSingle();
    if (data) {
      CP.moneda = data.moneda || 'NIO';
      CP.negocio = data.nombre_comercial || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = CP.negocio;
      if (data.color_principal) {
        document.documentElement.style.setProperty('--accent', data.color_principal);
        document.documentElement.style.setProperty('--accent-soft', data.color_principal + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_principal);
      }
    }
  } catch (e) { console.warn('cargarEmpresa:', e); }
}
async function cargarUsuario(userId, email) {
  try {
    const { data: u } = await sb.from('usuarios').select('nombre, apellido, plan').eq('auth_user_id', userId).maybeSingle();
    if (!u) return;
    const nombre = u.nombre || (email || '').split('@')[0] || 'Usuario', apellido = u.apellido || '';
    document.getElementById('header-name').textContent = `${nombre} ${apellido}`.trim();
    document.getElementById('header-biz').textContent = CP.negocio || 'Mi negocio';
    document.getElementById('header-avatar').textContent = ((nombre[0] || '') + (apellido[0] || '')).toUpperCase() || 'U';
    const pt = document.getElementById('plan-text'); if (pt) { const p = u.plan || 'Gratuito'; pt.textContent = p.charAt(0).toUpperCase() + p.slice(1); }
  } catch (_) { /* solo estético */ }
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sb.from('administradores').select('email,activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const el = document.getElementById('nav-admin'); if (el) el.style.display = 'flex'; }
  } catch { /* silencioso */ }
}

function enlazar() {
  ['cp-costo', 'cp-extra', 'cp-precio', 'cp-competencia', 'cp-cantidad', 'cp-margen-propio', 'cp-iva-pct'].forEach(id => document.getElementById(id)?.addEventListener('input', render));
  ['cp-iva-on', 'cp-redondeo'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
    if (id === 'cp-iva-on') document.getElementById('cp-iva-pct').disabled = !document.getElementById('cp-iva-on').checked;
    render();
  }));
  document.querySelectorAll('[data-cp-modo]').forEach(b => b.addEventListener('click', () => setModo(b.dataset.cpModo)));
  document.getElementById('cp-limpiar')?.addEventListener('click', limpiar);
}

async function initCalculadora() {
  applyTheme((() => { try { return localStorage.getItem('n360_theme') || 'light'; } catch (_) { return 'light'; } })());
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user;
    if (user.email) checkAdminAccess(user.email);
    await cargarEmpresa(user.id);
    await cargarUsuario(user.id, user.email);
  } catch (err) { console.error('initCalculadora:', err); }
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('app').style.display = 'flex';
  enlazar();
  setModo('costo');
  document.getElementById('cp-costo')?.focus();
}

// Expuesto para pruebas
window.CP = Object.assign(CP, { calcPrecio, calcGanancia, vsCompetencia, elegirSugerido, redondearArriba });
document.addEventListener('DOMContentLoaded', initCalculadora);
