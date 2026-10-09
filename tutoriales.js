/* ============================================================
   TUTORIALES.JS — NEGOCIO360
   Videos de YouTube con tutoriales por módulo. Los administra el
   panel Admin (tabla public.tutoriales_videos). Lectura para todos
   los usuarios; la vista solo muestra los módulos que cada cuenta
   (y cada perfil) tiene activos.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TUT = {
  userId: null,
  empresaConfig: {},
  videos: [],          // todos los videos visibles
  modulos: [],         // [{key,label,icon,videos:[...]}] solo los activos
  moduloActual: null,
  videoActual: null,
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
      TUT.empresaConfig = data;
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
  const biz = TUT.empresaConfig?.nombre_comercial || 'Mi negocio';
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
   MÓDULOS ACTIVOS PARA ESTA CUENTA / PERFIL
   ============================================================ */
const MODULO_GENERAL = { key: 'general', label: 'Primeros pasos', icon: '🚀' };

async function modulosVisibles() {
  const registro = window.NEGOCIO360_MODULOS || {};
  let cfg = { _flagsPropios: {} };
  try {
    if (window.ModulosGuard) cfg = await ModulosGuard.cargarConfigModulos(sb, TUT.userId);
  } catch (e) { console.warn('tutoriales cfg modulos:', e); }

  // Perfil restringido (no admin): solo los módulos que su perfil permite.
  let permitidos = null;
  try {
    const raw = sessionStorage.getItem('n360_perfil_activo');
    const p = raw ? JSON.parse(raw) : null;
    if (p && p.tipo !== 'admin') permitidos = new Set(p.modulos || []);
  } catch (_) { /* sin perfil: se muestra todo lo activo */ }

  const lista = [{ ...MODULO_GENERAL }];
  const vistos = new Set();
  Object.entries(registro).forEach(([, m]) => {
    if (vistos.has(m.key)) return;
    vistos.add(m.key);
    let activo = true;
    try {
      if (!m.obligatorio && window.ModulosGuard) activo = ModulosGuard.estaActivo(cfg, m.key, m.flagPropio, m.flagsAlternos);
      else if (window.ModulosGuard) activo = ModulosGuard.estaActivo({ _flagsPropios: {} }, m.key, null, null);
    } catch (_) { activo = true; }
    if (!activo) return;
    if (permitidos && !permitidos.has(m.key)) return;
    lista.push({ key: m.key, label: m.label, icon: m.icon });
  });
  return lista;
}

/* ============================================================
   CARGA Y RENDER
   ============================================================ */
const NIVELES = { basico: 'Básico', intermedio: 'Intermedio', avanzado: 'Avanzado' };

function ytThumb(id) { return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`; }

async function cargarTutoriales() {
  const { data, error } = await sb.from('tutoriales_videos').select('*')
    .eq('visible', true).order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  TUT.videos = data || [];
  const mods = await modulosVisibles();
  TUT.modulos = mods.map(m => ({ ...m, videos: TUT.videos.filter(v => v.modulo_key === m.key) }));
}

function renderModulos() {
  const grid = document.getElementById('tut-grid');
  if (!TUT.modulos.length) { grid.innerHTML = '<div class="tut-vacio-msg">No hay módulos disponibles.</div>'; return; }
  const total = TUT.videos.length;
  // Primero los módulos con videos; los vacíos al final, atenuados.
  const orden = [...TUT.modulos].sort((a, b) => (b.videos.length > 0) - (a.videos.length > 0));
  grid.innerHTML = orden.map(m => `
    <div class="tut-card ${m.videos.length ? '' : 'vacio'}" onclick="TUT.abrirModulo('${esc(m.key)}')">
      <div class="tut-card-icono">${esc(m.icon)}</div>
      <div class="tut-card-nombre">${esc(m.label)}</div>
      <div class="tut-card-cuenta">${m.videos.length ? m.videos.length + (m.videos.length === 1 ? ' video' : ' videos') : 'Próximamente'}</div>
    </div>`).join('');
  document.getElementById('tut-subtitulo').textContent = total
    ? `Aprende a usar cada módulo de Negocio360 con videos cortos y claros. Hay ${total} ${total === 1 ? 'video' : 'videos'} disponibles.`
    : 'Aprende a usar cada módulo de Negocio360 con videos cortos y claros. Los videos se irán publicando pronto.';
}

TUT.abrirModulo = function (key) {
  const m = TUT.modulos.find(x => x.key === key);
  if (!m) return;
  TUT.moduloActual = m;
  document.getElementById('tut-vista-modulos').style.display = 'none';
  document.getElementById('tut-vista-videos').style.display = '';
  document.getElementById('tut-modulo-titulo').textContent = `${m.icon} ${m.label}`;
  renderLista();
  if (m.videos.length) TUT.reproducir(m.videos[0].id, false);
  else {
    document.getElementById('tut-player').innerHTML = '<div class="tut-player-vacio">Aún no hay videos para este módulo. ¡Muy pronto!</div>';
    document.getElementById('tut-player-info').innerHTML = '';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

TUT.volver = function () {
  TUT.moduloActual = null; TUT.videoActual = null;
  document.getElementById('tut-player').innerHTML = '<div class="tut-player-vacio">Elige un video de la lista para verlo aquí.</div>'; // corta el video
  document.getElementById('tut-vista-videos').style.display = 'none';
  document.getElementById('tut-vista-modulos').style.display = '';
};

function renderLista() {
  const m = TUT.moduloActual;
  const cont = document.getElementById('tut-lista');
  if (!m || !m.videos.length) { cont.innerHTML = '<div class="tut-vacio-msg">Sin videos todavía.</div>'; return; }
  cont.innerHTML = m.videos.map(v => `
    <div class="tut-item ${TUT.videoActual === v.id ? 'activo' : ''}" onclick="TUT.reproducir('${esc(v.id)}', true)">
      <img class="tut-thumb" loading="lazy" src="${ytThumb(v.youtube_id)}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="tut-item-txt">
        <div class="tut-item-titulo">${esc(v.titulo)}</div>
        <div class="tut-item-meta">
          <span class="tut-badge">${esc(NIVELES[v.nivel] || 'Básico')}</span>
          ${v.duracion ? `<span>⏱ ${esc(v.duracion)}</span>` : ''}
        </div>
      </div>
    </div>`).join('');
}

TUT.reproducir = function (id, autoplay) {
  const v = TUT.videos.find(x => x.id === id);
  if (!v) return;
  TUT.videoActual = id;
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.youtube_id)}?rel=0&modestbranding=1${autoplay ? '&autoplay=1' : ''}`;
  document.getElementById('tut-player').innerHTML =
    `<iframe src="${src}" title="${esc(v.titulo)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  document.getElementById('tut-player-info').innerHTML =
    `<h3>${esc(v.titulo)}</h3>${v.descripcion ? `<p>${esc(v.descripcion)}</p>` : ''}`;
  renderLista();
};

/* ============================================================
   INICIO
   ============================================================ */
async function initTutoriales() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user;
    TUT.userId = user.id;
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

    try {
      await cargarTutoriales();
      renderModulos();
      // Enlace directo: tutoriales.html?modulo=ventas
      const q = new URLSearchParams(location.search).get('modulo');
      if (q && TUT.modulos.some(m => m.key === q)) TUT.abrirModulo(q);
    } catch (e) {
      console.error('cargarTutoriales:', e);
      document.getElementById('tut-grid').innerHTML =
        '<div class="tut-vacio-msg">No se pudieron cargar los tutoriales. Revisa tu conexión e inténtalo de nuevo.</div>';
    }
  } catch (err) {
    console.error('initTutoriales:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando los tutoriales.', 'error');
  }
}

sb.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

document.addEventListener('DOMContentLoaded', () => {
  initTutoriales();
  if (window.lucide) lucide.createIcons();
});
