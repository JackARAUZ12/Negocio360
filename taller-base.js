/* ============================================================
   TALLER-BASE.JS — NEGOCIO360 · Taller mecánico (base compartida)
   Lo común de las pantallas del taller: conexión, tema, menú, avisos,
   datos del negocio y arranque. Cada pantalla define window.tallerListo().
   Todo cambio de datos pasa por funciones del servidor (taller_*).
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TL = { userId: null, empresaConfig: {}, cfgModulos: { _flagsPropios: {} }, nombre: 'Usuario' };

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
      TL.empresaConfig = data;
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
  const biz = TL.empresaConfig?.nombre_comercial || 'Mi negocio';
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
  const m = TL.empresaConfig?.moneda;
  if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} }
  return m === 'USD' ? '$' : 'C$';
}
function fmt(n) {
  // Convierte también el número (no solo la etiqueta) si hay moneda de visualización activa.
  let v = Number(n || 0);
  if (typeof convertirParaMostrar === 'function') { try { v = convertirParaMostrar(v, TL.empresaConfig?.moneda); } catch (_) {} }
  return sym() + ' ' + v.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/* ---------- Llamadas al servidor ---------- */
const TL_MOTIVOS = {
  desactivado: 'El Taller mecánico está apagado. Actívalo en Configuración.',
  tipo: 'Tipo de vehículo no válido.', sin_identificacion: 'Escribe la placa o el número de chasis (VIN).',
  cliente: 'Ese cliente no existe en tu negocio.', placa_duplicada: 'Ya tienes un vehículo con esa placa.',
  no_existe: 'No se encontró el registro. Recarga la pantalla.', orden_abierta: 'Ese vehículo tiene una orden abierta.',
  falla: 'Describe la falla (mínimo 3 letras).', prioridad: 'Prioridad no válida.', vehiculo: 'Elige un vehículo.',
  vehiculo_archivado: 'Ese vehículo está archivado. Reactívalo primero.', ya_abierta: 'Ese vehículo ya tiene una orden abierta.',
  cerrada: 'La orden ya está cerrada: no se puede cambiar.', iva: 'El porcentaje de IVA no es válido.',
  precio: 'El precio no es válido.', cantidad: 'La cantidad no es válida.', costo: 'El costo no es válido.', descuento: 'El descuento no puede ser mayor al total de la línea.',
  producto: 'Ese repuesto no existe en tu inventario.', descripcion: 'Escribe la descripción.', linea: 'No se encontró esa línea.',
  decision: 'Decisión no válida.', sin_lineas: 'No hay líneas para esa acción.',
  transicion: 'Ese cambio de estado no está permitido desde el estado actual.', nada_por_aprobar: 'No hay líneas pendientes de aprobación.',
  sin_aprobadas: 'Aún no hay trabajos aprobados por el cliente.', lineas_pendientes: 'Hay líneas sin decidir: el cliente debe aprobarlas o rechazarlas.',
  usar_entregar: 'Para entregar usa el botón “Entregar y cobrar”.', estado: 'La orden debe estar en estado Listo para entregarla.',
  metodo: 'Elige el método de pago.', banco: 'Ese banco no existe en tu negocio.', km: 'El kilometraje no es válido.',
  producto_no_existe: 'Un repuesto de la orden ya no existe en el inventario.', sin_stock: 'No hay suficiente inventario de un repuesto.',
  total_cero: 'El total a cobrar debe ser mayor que cero.',
};
function tlMensaje(r) {
  if (!r) return 'No se pudo completar la acción.';
  if (r.motivo === 'sin_stock') return `No hay suficiente inventario de “${r.producto}”: hay ${r.hay} y la orden necesita ${r.necesita}.`;
  if (r.motivo === 'ya_abierta' || r.motivo === 'orden_abierta') return `Ese vehículo ya tiene la orden abierta ${r.numero}.`;
  if (r.motivo === 'lineas_pendientes') return `Hay ${r.pendientes} línea(s) sin decidir: el cliente debe aprobarlas o rechazarlas.`;
  return TL_MOTIVOS[r.motivo] || 'No se pudo completar la acción.';
}
// Llama una función del servidor. Devuelve {ok:true,...} o {ok:false,msg}. Nunca lanza.
async function tlRpc(nombre, args) {
  try {
    const { data, error } = await sb.rpc(nombre, args);
    if (error) { console.warn(nombre, error); return { ok: false, msg: 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.' }; }
    if (!data || data.ok !== true) return { ...(data || {}), ok: false, msg: tlMensaje(data) };
    return data;
  } catch (e) { console.warn(nombre, e); return { ok: false, msg: 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.' }; }
}
const tlFecha = d => d ? new Date(d).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const tlFechaHora = d => d ? new Date(d).toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/* ---------- Arranque ---------- */
async function initTaller() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user;
    TL.userId = user.id;
    if (user.email) checkAdminAccess(user.email);
    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) { renderUserInfo(profile, user.email); TL.nombre = `${profile.nombre || ''} ${profile.apellido || ''}`.trim() || user.email?.split('@')[0] || 'Usuario'; }
    else {
      TL.nombre = user.email?.split('@')[0] || 'Usuario';
      const hn = document.getElementById('header-name'); if (hn) hn.textContent = TL.nombre;
      const ha = document.getElementById('header-avatar'); if (ha) ha.textContent = (user.email || 'U')[0].toUpperCase();
    }
    try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.nombre) TL.nombre = String(pf.nombre).slice(0, 100); } catch (_) {}
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    try { if (window.ModulosGuard) TL.cfgModulos = await ModulosGuard.cargarConfigModulos(sb, user.id); } catch (_) {}
    if (TL.empresaConfig.usa_modulo_taller !== true) {
      const c = document.getElementById('content');
      if (c) c.innerHTML = '<div class="tl-apagado"><div style="font-size:42px">🔧</div><h2>El Taller mecánico está apagado</h2><p>Actívalo en <b>Configuración → Taller mecánico</b> para empezar a recibir vehículos.</p><button class="btn-primary" onclick="(window.top||window).location.href=\'configuracion.html\'">Ir a Configuración</button></div>';
      return;
    }
    if (typeof window.tallerListo === 'function') await window.tallerListo();
  } catch (err) {
    console.error('initTaller:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando el Taller mecánico.', 'error');
  }
}
window.TL = TL;
sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', () => { initTaller(); if (window.lucide) lucide.createIcons(); });
