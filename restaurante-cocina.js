/* =====================================================
   RESTAURANTE-COCINA.JS — NEGOCIO360
   Tercera pieza del sistema de Restaurante -- pantalla de cocina
   (KDS). Muestra los platillos enviados desde Comandas, en
   preparacion, y permite marcarlos listos uno por uno. Cuando
   TODOS los platillos de una comanda quedan listos, la comanda
   misma pasa automaticamente a 'lista' -- visible de vuelta en
   Comandas para que el mesero sepa que ya puede servir, sin tener
   que venir a preguntar a cocina.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = { userId: null, empresaConfig: {}, currentUser: {}, comandas: [] };
let _intervaloAutoRefresh = null;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Texto legible de cuanto lleva un platillo esperando, con alerta
// visual si ya se paso de un tiempo razonable -- mismo patron ya
// probado en Housekeeping.
function tiempoTranscurrido(desdeISO) {
  if (!desdeISO) return { texto: '—', minutos: 0 };
  const ms = Date.now() - new Date(desdeISO).getTime();
  const minutos = Math.floor(ms / 60000);
  let texto;
  if (minutos < 1) texto = 'Recién';
  else if (minutos < 60) texto = `${minutos} min`;
  else texto = `${Math.floor(minutos/60)}h ${minutos%60}min`;
  return { texto, minutos };
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
    if (STATE.empresaConfig?.usa_modulo_restaurante !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarCocina();
    // Auto-refresh cada 20s -- una pantalla de cocina se deja
    // abierta todo el turno, necesita actualizarse sola.
    _intervaloAutoRefresh = setInterval(cargarCocina, 20000);
  } catch (e) {
    console.error('init restaurante-cocina:', e);
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
async function cargarCocina() {
  try {
    const { data, error } = await sb.from('restaurante_comandas')
      .select('*, restaurante_mesas(numero), restaurante_comanda_items(*)')
      .eq('auth_user_id', STATE.userId).eq('estado', 'enviada')
      .order('created_at', { ascending: true });
    if (error) throw error;
    // Solo interesan los platillos que TODAVIA estan en preparacion --
    // uno ya marcado listo/entregado desaparece de esta pantalla.
    STATE.comandas = (data || []).map(c => ({
      ...c,
      items: (c.restaurante_comanda_items || []).filter(i => i.estado === 'en_preparacion'),
    })).filter(c => c.items.length > 0);
    actualizarKpisCocina();
    renderCocina();
  } catch (e) {
    console.error('cargarCocina:', e);
    showToast('No se pudo actualizar cocina', 'error');
  }
}

function actualizarKpisCocina() {
  document.getElementById('kpi-cocina-comandas').textContent = STATE.comandas.length;
  const totalPlatillos = STATE.comandas.reduce((s, c) => s + c.items.length, 0);
  document.getElementById('kpi-cocina-platillos').textContent = totalPlatillos;
}

function renderCocina() {
  const cont = document.getElementById('cocina-grid');
  const vacio = document.getElementById('cocina-vacio');
  if (!STATE.comandas.length) {
    cont.style.display = 'none'; vacio.style.display = '';
    return;
  }
  cont.style.display = ''; vacio.style.display = 'none';

  cont.innerHTML = STATE.comandas.map(c => {
    // El "reloj" de la tarjeta se basa en el platillo mas antiguo
    // pendiente -- el que mas tiempo lleva esperando en esa mesa.
    const masAntiguo = c.items.reduce((min, i) => (!min || i.created_at < min) ? i.created_at : min, null);
    const t = tiempoTranscurrido(masAntiguo);
    const alerta = t.minutos >= 15 ? 'kd-tiempo-alerta' : 'kd-tiempo-normal';
    return `
    <div class="hab-card">
      <div class="hab-card-head">
        <div class="hab-card-titulo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/></svg>
          Mesa ${esc(c.restaurante_mesas?.numero || '—')}
        </div>
        <span class="kd-tiempo ${alerta}">${t.texto}</span>
      </div>
      ${c.items.map(i => `
        <div class="kd-platillo">
          <div class="kd-platillo-info">
            <div class="kd-platillo-nombre"><span class="kd-platillo-cant">${i.cantidad}×</span>${esc(i.nombre_producto)}</div>
            ${i.modificadores ? `<div class="kd-platillo-mod">${esc(i.modificadores)}</div>` : ''}
          </div>
          <button class="kd-btn-listo" onclick="marcarPlatilloListo('${i.id}', '${c.id}')">✅ Listo</button>
        </div>`).join('')}
    </div>`;
  }).join('');
}

/* =====================================================
   MARCAR PLATILLO LISTO -- y, si era el ultimo pendiente de su
   comanda, la comanda completa pasa a 'lista'.
===================================================== */
async function marcarPlatilloListo(itemId, comandaId) {
  try {
    const { error: e1 } = await sb.from('restaurante_comanda_items')
      .update({ estado: 'listo', updated_at: new Date().toISOString() }).eq('id', itemId);
    if (e1) throw e1;

    // Se revisa el estado REAL en la base de datos (no solo el
    // STATE local en memoria) para decidir si ya no queda nada
    // pendiente en esa comanda -- mas confiable si hay varias
    // pantallas de cocina abiertas a la vez marcando cosas.
    const { data: pendientes, error: e2 } = await sb.from('restaurante_comanda_items')
      .select('id').eq('comanda_id', comandaId).eq('estado', 'en_preparacion');
    if (e2) throw e2;

    if (!pendientes || pendientes.length === 0) {
      await sb.from('restaurante_comandas')
        .update({ estado: 'lista', updated_at: new Date().toISOString() })
        .eq('id', comandaId).eq('auth_user_id', STATE.userId);
      showToast('¡Comanda completa! El mesero ya puede servir.');
    }

    await cargarCocina();
  } catch (e) {
    console.error('marcarPlatilloListo:', e);
    showToast('No se pudo marcar el platillo', 'error');
  }
}

window.addEventListener('beforeunload', () => { if (_intervaloAutoRefresh) clearInterval(_intervaloAutoRefresh); });
