/* ============================================================
   TRANSPORTE.JS — NEGOCIO360 (Fase 1: base y panel principal)
   Panel del módulo de Transporte de carga. Lee datos de los demás
   módulos (Ventas, Créditos, Gastos) sin modificarlos y guarda la
   configuración de la operación en configuracion_empresa.metadata.transporte.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TP = {
  userId: null,
  empresaConfig: {},
  cfgModulos: { _flagsPropios: {} },
  conf: { operacion: 'ambas', alcance: 'nacional_regional', paises: [] },
};

const PAISES = ['Honduras', 'Costa Rica', 'El Salvador', 'Guatemala', 'Panamá', 'México'];
const ETQ_OPERACION = { ambas: 'Flota propia y subcontratada', propia: 'Flota propia', subcontratada: 'Flota subcontratada' };
const ETQ_ALCANCE = { nacional: 'Nacional', nacional_regional: 'Nacional y fronteras', internacional: 'Internacional' };

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============================================================
   TEMA / SIDEBAR / NAVEGACIÓN (idéntico a los demás módulos)
   ============================================================ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('n360_theme', t);
  const sun = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = t === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }

let sidebarCollapsed = false;
const MOBILE_BREAKPOINT = 768;
function isMobileView() { return window.innerWidth <= MOBILE_BREAKPOINT; }
function toggleSidebar() {
  if (isMobileView()) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('active', isOpen);
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}
function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
}
window.addEventListener('resize', () => { if (!isMobileView()) closeMobileSidebar(); });
function navigate(url) { closeMobileSidebar(); window.location.href = url; }

let _toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ============================================================
   EMPRESA / PERFIL
   ============================================================ */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    if (data) {
      TP.empresaConfig = data;
      const biz = data.nombre_comercial || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = biz;
      if (data.color_principal) {
        document.documentElement.style.setProperty('--accent', data.color_principal);
        document.documentElement.style.setProperty('--accent-soft', data.color_principal + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_principal);
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    return data;
  } catch { return null; }
}
function renderUserInfo(user, email) {
  if (!user) return;
  const nombre = user.nombre || email?.split('@')[0] || 'Usuario';
  const apellido = user.apellido || '';
  const biz = TP.empresaConfig?.nombre_comercial || 'Mi negocio';
  const plan = user.plan || 'Gratuito';
  const initials = ((nombre[0] || '') + (apellido[0] || '')).toUpperCase();
  document.getElementById('header-name').textContent = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent = biz;
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sb.from('administradores').select('email,activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const el = document.getElementById('nav-admin'); if (el) el.style.display = 'flex'; }
  } catch { /* silencioso */ }
}



function sym() {
  const m = TP.empresaConfig?.moneda;
  if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} }
  return m === 'USD' ? '$' : 'C$';
}
function fmt(n) { return sym() + ' ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/* ============================================================
   CONFIGURACIÓN DE LA OPERACIÓN
   ============================================================ */
function leerConfig() {
  const c = TP.empresaConfig?.metadata?.transporte;
  if (c && typeof c === 'object') {
    TP.conf = {
      operacion: ETQ_OPERACION[c.operacion] ? c.operacion : 'ambas',
      alcance: ETQ_ALCANCE[c.alcance] ? c.alcance : 'nacional_regional',
      paises: Array.isArray(c.paises) ? c.paises.filter(p => typeof p === 'string') : [],
    };
  }
}

function renderConfig() {
  document.getElementById('tp-operacion').value = TP.conf.operacion;
  document.getElementById('tp-alcance').value = TP.conf.alcance;
  const wrap = document.getElementById('tp-paises');
  wrap.innerHTML = PAISES.map(p =>
    `<button type="button" class="tp-pais${TP.conf.paises.includes(p) ? ' on' : ''}" data-pais="${esc(p)}">${esc(p)}</button>`).join('');
  wrap.querySelectorAll('.tp-pais').forEach(b => b.addEventListener('click', () => b.classList.toggle('on')));
  renderChips();
}

function renderChips() {
  const chips = [`🚚 ${ETQ_OPERACION[TP.conf.operacion]}`, `🧭 ${ETQ_ALCANCE[TP.conf.alcance]}`];
  if (TP.conf.alcance !== 'nacional' && TP.conf.paises.length) chips.push(`🌎 ${TP.conf.paises.join(' · ')}`);
  document.getElementById('tp-chips').innerHTML = chips.map(c => `<span class="tp-chip">${esc(c)}</span>`).join('');
}

async function guardarConfig() {
  const btn = document.getElementById('tp-guardar');
  btn.disabled = true;
  try {
    const nueva = {
      operacion: document.getElementById('tp-operacion').value,
      alcance: document.getElementById('tp-alcance').value,
      paises: [...document.querySelectorAll('#tp-paises .tp-pais.on')].map(b => b.dataset.pais),
    };
    // Se relee el metadata más reciente y se mezcla: nunca se pisa nada que otros módulos guarden ahí.
    const { data: actual, error: e1 } = await sb.from('configuracion_empresa').select('metadata').eq('auth_user_id', TP.userId).maybeSingle();
    if (e1) throw e1;
    const base = (actual?.metadata && typeof actual.metadata === 'object') ? actual.metadata : {};
    const metadata = { ...base, transporte: { ...(base.transporte || {}), ...nueva } };
    const { error } = await sb.from('configuracion_empresa').update({ metadata }).eq('auth_user_id', TP.userId);
    if (error) throw error;
    TP.empresaConfig.metadata = metadata;
    TP.conf = nueva;
    renderChips();
    showToast('Configuración guardada', 'success');
  } catch (e) {
    console.error('guardarConfig transporte:', e);
    showToast('No se pudo guardar. Intenta de nuevo.', 'error');
  } finally { btn.disabled = false; }
}

/* ============================================================
   INDICADORES CONECTADOS (solo lectura de otros módulos)
   ============================================================ */
async function cargarKpis() {
  const hoy = new Date();
  const hoyISO = ymd(hoy);
  const mesISO = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const en7 = new Date(hoy); en7.setDate(en7.getDate() + 7);
  const kpis = [];
  const intentar = async (fn) => { try { return await fn(); } catch (e) { console.warn('kpi transporte:', e); return null; } };

  const ventas = await intentar(async () => {
    const { data, error } = await sb.from('ventas').select('total,estado').eq('auth_user_id', TP.userId).gte('fecha', mesISO);
    if (error) throw error;
    return (data || []).filter(v => v.estado !== 'anulada').reduce((s, v) => s + Number(v.total || 0), 0);
  });
  const gastos = await intentar(async () => {
    const { data, error } = await sb.from('gastos').select('monto,estado').eq('auth_user_id', TP.userId).gte('fecha', mesISO);
    if (error) throw error;
    return (data || []).filter(g => g.estado !== 'anulado' && g.estado !== 'anulada').reduce((s, g) => s + Number(g.monto || 0), 0);
  });
  const porCobrar = await intentar(async () => {
    const { data, error } = await sb.from('creditos').select('saldo_pendiente,estado').eq('auth_user_id', TP.userId);
    if (error) throw error;
    return (data || []).filter(c => ['activo', 'en_proceso', 'vencido'].includes(c.estado)).reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0);
  });
  const cuotas = await intentar(async () => {
    const { data, error } = await sb.from('creditos_cuotas').select('fecha_vencimiento,estado').eq('auth_user_id', TP.userId).neq('estado', 'pagada').neq('estado', 'anulada').lte('fecha_vencimiento', ymd(en7));
    if (error) throw error;
    const l = data || [];
    return { vencidas: l.filter(c => c.fecha_vencimiento < hoyISO).length, proximas: l.filter(c => c.fecha_vencimiento >= hoyISO).length };
  });

  const card = (ico, bg, label, valor, sub, href) => `
    <div class="kpi-card tp-kpi-link" onclick="navigate('${href}')">
      <div class="kpi-icon" style="background:${bg}">${ico}</div>
      <div class="kpi-body"><div class="kpi-label">${label}</div><div class="kpi-value">${valor}</div><div class="kpi-sub">${sub}</div></div>
    </div>`;
  const nd = '—';
  kpis.push(card('💰', 'var(--success-soft)', 'Ventas del mes', ventas == null ? nd : fmt(ventas), 'Módulo Ventas', 'ventas.html'));
  kpis.push(card('🧾', 'var(--accent-soft)', 'Por cobrar', porCobrar == null ? nd : fmt(porCobrar), 'Créditos activos', 'creditos.html'));
  kpis.push(card('⏰', 'var(--warning-soft)', 'Cuotas a vigilar', cuotas == null ? nd : `${cuotas.vencidas} vencidas`, cuotas == null ? 'Créditos' : `${cuotas.proximas} vencen en 7 días`, 'creditos.html'));
  kpis.push(card('💸', 'var(--danger-soft)', 'Gastos del mes', gastos == null ? nd : fmt(gastos), 'Módulo Gastos', 'gastos.html'));
  document.getElementById('tp-kpis').innerHTML = kpis.join('');
}

/* ============================================================
   ACCESOS A OTROS MÓDULOS (solo los que esta cuenta/perfil tiene)
   ============================================================ */
const ACCESOS = [
  { key: 'ventas',            href: 'ventas.html',            ico: '💰', t: 'Ventas',             d: 'Factura fletes y servicios de transporte.' },
  { key: 'proformas',         href: 'proformas.html',         ico: '📄', t: 'Proformas',          d: 'Cotiza un viaje o una ruta a tu cliente.' },
  { key: 'creditos',          href: 'creditos.html',          ico: '🧾', t: 'Créditos',           d: 'Cobra a cuotas o en una fecha fija.' },
  { key: 'clientes',          href: 'clientes.html',          ico: '👥', t: 'Clientes',           d: 'Tus generadores de carga y su historial.' },
  { key: 'gastos',            href: 'gastos.html',            ico: '💸', t: 'Gastos',             d: 'Combustible, peajes, viáticos y reparaciones.' },
  { key: 'cuentas_por_pagar', href: 'cuentas-por-pagar.html', ico: '📇', t: 'Cuentas por pagar',  d: 'Talleres, combustible y transportistas externos.' },
  { key: 'caja',              href: 'caja.html',              ico: '🏦', t: 'Caja / Pagos',       d: 'Anticipos a conductores y cobros de fletes.' },
  { key: 'activos',           href: 'activos.html',           ico: '🏭', t: 'Activos fijos',      d: 'Camiones y remolques con su depreciación.' },
  { key: 'salarios',          href: 'salarios.html',          ico: '🧑‍💼', t: 'Salarios',           d: 'Planilla de conductores y ayudantes.' },
  { key: 'rutas',             href: 'rutas.html',             ico: '🗺️', t: 'Rutas',              d: 'Mapa y rutas de tus clientes.' },
  { key: 'agenda',            href: 'agenda.html',            ico: '📅', t: 'Agenda',             d: 'Vencimientos, citas y recordatorios.' },
  { key: 'reportes',          href: 'reportes.html',          ico: '📊', t: 'Reportes',           d: 'Resultados y exportaciones del negocio.' },
];

function accesosVisibles() {
  const registro = window.NEGOCIO360_MODULOS || {};
  let permitidos = null;
  try {
    const raw = sessionStorage.getItem('n360_perfil_activo');
    const p = raw ? JSON.parse(raw) : null;
    if (p && p.tipo !== 'admin') permitidos = new Set(p.modulos || []);
  } catch (_) {}
  return ACCESOS.filter(a => {
    const m = registro[a.href];
    let activo = true;
    try {
      if (m && !m.obligatorio && window.ModulosGuard) activo = ModulosGuard.estaActivo(TP.cfgModulos, m.key, m.flagPropio, m.flagsAlternos);
    } catch (_) { activo = true; }
    if (!activo) return false;
    if (permitidos && !permitidos.has(a.key)) return false;
    return true;
  });
}

function renderAccesos() {
  const lista = accesosVisibles();
  document.getElementById('tp-accesos').innerHTML = lista.map(a => `
    <button type="button" class="tp-acceso" onclick="navigate('${a.href}')">
      <div class="tp-acceso-ico">${a.ico}</div><div><b>${esc(a.t)}</b><span>${esc(a.d)}</span></div>
    </button>`).join('') || '<div class="tp-ayuda">No hay módulos conectados disponibles para este perfil.</div>';
}

/* ============================================================
   INICIO
   ============================================================ */
async function initTransporte() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user;
    TP.userId = user.id;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent = user.email?.split('@')[0] || 'Usuario';
      document.getElementById('header-avatar').textContent = (user.email || 'U')[0].toUpperCase();
    }
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    try { if (window.ModulosGuard) TP.cfgModulos = await ModulosGuard.cargarConfigModulos(sb, user.id); } catch (_) {}
    leerConfig();
    renderConfig();
    renderAccesos();
    cargarKpis();
  } catch (err) {
    console.error('initTransporte:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando el panel de Transporte.', 'error');
  }
}

window.TP = TP;
TP.guardarConfig = guardarConfig;

sb.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});
document.addEventListener('DOMContentLoaded', () => {
  initTransporte();
  if (window.lucide) lucide.createIcons();
});
