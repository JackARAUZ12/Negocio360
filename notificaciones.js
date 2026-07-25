/* ============================================================
   NOTIFICACIONES.JS — NEGOCIO360
   Muestra las actualizaciones publicadas por el administrador
   (tabla public.notificaciones) y controla qué ha leído cada
   usuario (tabla public.notificaciones_leidas).
   Limpieza automática: al cargar, borra (best-effort) las
   notificaciones con más de 30 días — permitido por la política
   RLS de DELETE, sin necesidad de un cron en el servidor.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const NOTIF = {
  userId: null,
  empresaConfig: {},
  items: [],
  leidas: new Set(),
};

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
      NOTIF.empresaConfig = data;
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
  const biz = NOTIF.empresaConfig?.nombre_comercial || 'Mi negocio';
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

/* ============================================================
   CONFIGURACIÓN DE TIPOS
   ============================================================ */
const TIPO_INFO = {
  actualizacion:   { icon: '🆕', bg: 'var(--accent-soft)',  color: 'var(--accent)',  label: 'Actualización' },
  nueva_funcion:   { icon: '✨', bg: 'var(--success-soft)', color: 'var(--success)', label: 'Nueva función' },
  mantenimiento:   { icon: '🛠️', bg: 'var(--warning-soft)', color: 'var(--warning)', label: 'Mantenimiento' },
  aviso:           { icon: 'ℹ️', bg: 'var(--accent-4-soft)', color: 'var(--accent-4)', label: 'Aviso' },
  urgente:         { icon: '🚨', bg: 'var(--danger-soft)',  color: 'var(--danger)',  label: 'Urgente' },
};
function tipoInfo(tipo) { return TIPO_INFO[tipo] || TIPO_INFO.aviso; }

/* ============================================================
   LIMPIEZA AUTOMÁTICA (best-effort, permitida por RLS)
   ============================================================ */
async function limpiarNotificacionesViejas() {
  try {
    const limite = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await sb.from('notificaciones').delete().lt('created_at', limite);
  } catch (e) {
    // Best-effort: si el usuario no tiene permiso (no debería pasar) o falla
    // la red, simplemente no se limpia en este momento; no es crítico.
    console.warn('limpiarNotificacionesViejas:', e);
  }
}

/* ============================================================
   CARGA Y RENDER
   ============================================================ */
function fmtFechaNotif(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const ahora = new Date();
  const diffMs = ahora - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) return 'Justo ahora';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffH < 24) return `Hace ${diffH} h`;
  if (diffD < 7) return `Hace ${diffD} d`;
  return d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function cargarNotificaciones() {
  const { data: notifs, error } = await sb
    .from('notificaciones')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  NOTIF.items = notifs || [];

  const { data: leidas } = await sb
    .from('notificaciones_leidas')
    .select('notificacion_id')
    .eq('auth_user_id', NOTIF.userId);
  NOTIF.leidas = new Set((leidas || []).map(l => l.notificacion_id));
}

function renderNotificaciones() {
  const el = document.getElementById('notif-list');
  if (!NOTIF.items.length) {
    el.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-icon">🔔</div>
        <p>No hay notificaciones por ahora. Aquí verás los próximos avisos y actualizaciones de Negocio360.</p>
      </div>`;
    actualizarBadgeSidebar();
    return;
  }

  el.innerHTML = NOTIF.items.map(n => {
    const info = tipoInfo(n.tipo);
    const noLeida = !NOTIF.leidas.has(n.id);
    return `
      <div class="notif-item ${noLeida ? 'no-leida' : ''}" data-id="${n.id}" onclick="NOTIF.marcarLeida('${n.id}')">
        <div class="notif-icon" style="background:${info.bg}">${info.icon}</div>
        <div class="notif-body">
          <div class="notif-top">
            ${noLeida ? '<span class="notif-dot-nueva"></span>' : ''}
            <span class="notif-titulo">${esc(n.titulo)}</span>
            <span class="notif-tipo-badge" style="background:${info.bg};color:${info.color}">${info.label}</span>
            <span class="notif-fecha">${fmtFechaNotif(n.created_at)}</span>
          </div>
          <div class="notif-mensaje">${esc(n.mensaje)}</div>
        </div>
      </div>
    `;
  }).join('');

  actualizarBadgeSidebar();
}

function actualizarBadgeSidebar() {
  const noLeidas = NOTIF.items.filter(n => !NOTIF.leidas.has(n.id)).length;
  const badge = document.getElementById('nav-notif-count');
  if (!badge) return;
  if (noLeidas > 0) {
    badge.textContent = noLeidas > 99 ? '99+' : String(noLeidas);
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

async function marcarLeida(id) {
  if (NOTIF.leidas.has(id)) return; // ya estaba leída
  try {
    NOTIF.leidas.add(id); // optimista
    renderNotificaciones();
    await sb.from('notificaciones_leidas').insert([{ notificacion_id: id, auth_user_id: NOTIF.userId }]);
  } catch (e) {
    console.warn('marcarLeida:', e);
  }
}

async function marcarTodasLeidas() {
  const pendientes = NOTIF.items.filter(n => !NOTIF.leidas.has(n.id)).map(n => n.id);
  if (!pendientes.length) { showToast('Ya tienes todo leído', 'info'); return; }
  try {
    pendientes.forEach(id => NOTIF.leidas.add(id)); // optimista
    renderNotificaciones();
    const filas = pendientes.map(id => ({ notificacion_id: id, auth_user_id: NOTIF.userId }));
    await sb.from('notificaciones_leidas').upsert(filas, { onConflict: 'notificacion_id,auth_user_id' });
    showToast('Notificaciones marcadas como leídas');
  } catch (e) {
    console.warn('marcarTodasLeidas:', e);
    showToast('No se pudo actualizar. Intenta de nuevo.', 'error');
  }
}

NOTIF.marcarLeida = marcarLeida;
NOTIF.marcarTodasLeidas = marcarTodasLeidas;

/* ============================================================
   ARRANQUE
   ============================================================ */
async function initNotificaciones() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');

  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    NOTIF.userId = user.id;
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

    limpiarNotificacionesViejas(); // best-effort, no bloquea la carga
    await cargarNotificaciones();
    renderNotificaciones();
  } catch (err) {
    console.error('initNotificaciones:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando las notificaciones.', 'error');
  }
}

sb.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

document.addEventListener('DOMContentLoaded', () => {
  initNotificaciones();
  if (window.lucide) lucide.createIcons();
});
