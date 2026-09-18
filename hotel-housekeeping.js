/* =====================================================
   HOTEL-HOUSEKEEPING.JS — NEGOCIO360
   Flujo de trabajo real alrededor de los estados "limpieza" y
   "mantenimiento" de una habitacion -- sin esto, una habitacion se
   quedaba en limpieza para siempre hasta editarla a mano. Solo LEE
   y actualiza hotel_habitaciones, ninguna tabla nueva.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  habitaciones: [],
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Texto legible de cuanto tiempo lleva una habitacion en su estado
// actual -- y si ya lleva mucho (mas de 3 horas para limpieza), se
// marca como alerta visual para que el personal lo priorice.
function tiempoTranscurrido(desdeISO) {
  if (!desdeISO) return { texto: '—', horas: 0 };
  const ms = Date.now() - new Date(desdeISO).getTime();
  const minutos = Math.floor(ms / 60000);
  const horas = Math.floor(minutos / 60);
  const dias = Math.floor(horas / 24);
  let texto;
  if (dias >= 1) texto = `Hace ${dias} día${dias===1?'':'s'}`;
  else if (horas >= 1) texto = `Hace ${horas} hora${horas===1?'':'s'}`;
  else if (minutos >= 1) texto = `Hace ${minutos} min`;
  else texto = 'Recién';
  return { texto, horas: ms / 3600000 };
}

/* =====================================================
   SHELL: TEMA, SIDEBAR, NAVEGACIÓN (idéntico al resto del sistema)
===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('n360_theme', theme);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}
function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme');
  applyTheme(curr === 'dark' ? 'light' : 'dark');
}
function isMobileViewport() { return window.innerWidth <= 860; }
function toggleSidebar() {
  if (isMobileViewport()) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
  } else {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('main').classList.toggle('sidebar-collapsed');
  }
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
    return data;
  } catch (e) { return null; }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hAv = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name||'U')[0].toUpperCase();
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    if (STATE.empresaConfig?.usa_modulo_hotel !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarHousekeeping();
  } catch (e) {
    console.error('init hotel-housekeeping:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   CARGAR Y RENDERIZAR
===================================================== */
async function cargarHousekeeping() {
  try {
    const { data, error } = await sb.from('hotel_habitaciones')
      .select('*').eq('auth_user_id', STATE.userId).eq('activo', true)
      .in('estado', ['limpieza', 'mantenimiento']).order('en_este_estado_desde');
    if (error) throw error;
    STATE.habitaciones = data || [];
    renderHousekeeping();
  } catch (e) {
    console.error('cargarHousekeeping:', e);
    showToast('No se pudo cargar Housekeeping', 'error');
  }
}

function renderHousekeeping() {
  const limpieza = STATE.habitaciones.filter(h => h.estado === 'limpieza');
  const mantenimiento = STATE.habitaciones.filter(h => h.estado === 'mantenimiento');

  document.getElementById('hk-kpi-limpieza').textContent = limpieza.length;
  document.getElementById('hk-kpi-mantenimiento').textContent = mantenimiento.length;

  const contLimp = document.getElementById('hk-grid-limpieza');
  const vacioLimp = document.getElementById('hk-vacio-limpieza');
  if (limpieza.length) {
    contLimp.style.display = ''; vacioLimp.style.display = 'none';
    contLimp.innerHTML = limpieza.map(h => tarjetaHousekeeping(h)).join('');
  } else {
    contLimp.style.display = 'none'; vacioLimp.style.display = '';
  }

  const contMant = document.getElementById('hk-grid-mantenimiento');
  const vacioMant = document.getElementById('hk-vacio-mantenimiento');
  if (mantenimiento.length) {
    contMant.style.display = ''; vacioMant.style.display = 'none';
    contMant.innerHTML = mantenimiento.map(h => tarjetaHousekeeping(h)).join('');
  } else {
    contMant.style.display = 'none'; vacioMant.style.display = '';
  }
}

function tarjetaHousekeeping(h) {
  const t = tiempoTranscurrido(h.en_este_estado_desde);
  // Mas de 3 horas en limpieza, o mas de 24 horas en mantenimiento,
  // se resalta en rojo -- son los umbrales donde un hotel real
  // esperaria que alguien ya lo hubiera resuelto.
  const umbralAlerta = h.estado === 'limpieza' ? 3 : 24;
  const claseAlerta = t.horas >= umbralAlerta ? 'hk-tiempo-alerta' : 'hk-tiempo-normal';
  return `
  <div class="hab-card">
    <div class="hab-card-head">
      <div class="hab-card-titulo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
        Habitación ${esc(h.numero)}
      </div>
      <span class="hk-tiempo ${claseAlerta}">${t.texto}</span>
    </div>
    <div class="form-group full" style="margin-bottom:10px">
      <input type="text" placeholder="Nota (opcional) — ej: faltan toallas" value="${esc(h.notas_limpieza || '')}"
        onblur="guardarNotaLimpieza('${h.id}', this.value)" style="font-size:12.5px"/>
    </div>
    <button class="btn-primary" style="width:100%" onclick="marcarComoDisponible('${h.id}')">✅ Marcar como disponible</button>
  </div>`;
}

async function guardarNotaLimpieza(id, texto) {
  try {
    await sb.from('hotel_habitaciones').update({ notas_limpieza: texto.trim() || null }).eq('id', id).eq('auth_user_id', STATE.userId);
    const h = STATE.habitaciones.find(x => x.id === id);
    if (h) h.notas_limpieza = texto.trim() || null;
  } catch (e) {
    console.error('guardarNotaLimpieza:', e);
  }
}

async function marcarComoDisponible(id) {
  try {
    const { error } = await sb.from('hotel_habitaciones').update({
      estado: 'disponible', notas_limpieza: null,
      en_este_estado_desde: new Date().toISOString(),
    }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Habitación lista — ya aparece disponible');
    await cargarHousekeeping();
  } catch (e) {
    console.error('marcarComoDisponible:', e);
    showToast('No se pudo actualizar. Intenta de nuevo.', 'error');
  }
}
