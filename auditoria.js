/* =====================================================
   AUDITORIA.JS — NEGOCIO360
   Visor de la bitácora de movimientos (llenada automáticamente
   por auditoria-guard.js en TODOS los módulos). Este archivo solo
   LEE de auditoria_log — nunca inserta nada aquí.

   Acceso: requiere el código de administrador (mismo candado que
   Configuración), sin importar qué perfil haya iniciado sesión.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},

  logs: [],
  filtro: 'todos',      // todos | INSERT | UPDATE | DELETE
  filtroUsuario: '',
  filtroModulo: '',
  search: '',
  page: 1,
  perPage: 20,
};

/* =====================================================
   HELPERS
===================================================== */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-NI', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function fmtNum(v) { return Number(v || 0).toLocaleString('es-NI'); }
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Nombre legible de un módulo (usa el registro central si está disponible).
function labelModulo(archivo) {
  const m = window.NEGOCIO360_MODULOS?.[archivo];
  return m ? `${m.icon} ${m.label}` : archivo;
}

/* =====================================================
   THEME / SIDEBAR / NAV (idéntico al resto del sistema)
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

/* =====================================================
   CONFIG EMPRESA / PERFIL / ADMIN (idéntico al resto del sistema)
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbClient.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sbClient.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { console.warn('loadUserProfile:', e); return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const biz  = STATE.empresaConfig?.nombre_comercial || 'Mi negocio';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hBiz  = document.getElementById('header-biz');  if (hBiz)  hBiz.textContent  = biz;
  const hAv   = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name || 'U')[0].toUpperCase();
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sbClient.from('administradores').select('email, activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const nav = document.getElementById('nav-admin'); if (nav) nav.style.display = 'flex'; }
  } catch (e) { /* silencioso */ }
}

/* =====================================================
   CARGA DE LA BITÁCORA
===================================================== */
function rangoFechasPorDefecto() {
  const desdeEl = document.getElementById('aud-fecha-desde');
  const hastaEl = document.getElementById('aud-fecha-hasta');
  if (desdeEl && !desdeEl.value) {
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    desdeEl.value = `${hace30.getFullYear()}-${String(hace30.getMonth()+1).padStart(2,'0')}-${String(hace30.getDate()).padStart(2,'0')}`;
  }
  if (hastaEl && !hastaEl.value) hastaEl.value = todayISO();
}

async function cargarAuditoria() {
  const tbody = document.getElementById('aud-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Cargando auditoría…</td></tr>`;
  try {
    const desde = document.getElementById('aud-fecha-desde')?.value;
    const hasta = document.getElementById('aud-fecha-hasta')?.value;

    let q = sbClient.from('auditoria_log').select('*')
      .eq('auth_user_id', STATE.userId)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (desde) q = q.gte('created_at', `${desde}T00:00:00`);
    if (hasta) q = q.lte('created_at', `${hasta}T23:59:59`);

    const { data, error } = await q;
    if (error) throw error;

    STATE.logs = data || [];
    STATE.page = 1;
    poblarFiltrosAud();
    renderTablaAud();
    renderKPIsAud();
  } catch (e) {
    console.error('cargarAuditoria:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No se pudo cargar la auditoría</td></tr>`;
  }
}

// Llena los selects de "Usuario" y "Módulo" con los valores que
// realmente aparecen en el rango cargado (evita listas gigantes con
// opciones que nunca tendrían resultados).
function poblarFiltrosAud() {
  const selUsuario = document.getElementById('aud-filtro-usuario');
  const selModulo  = document.getElementById('aud-filtro-modulo');
  if (!selUsuario || !selModulo) return;

  const usuarios = [...new Set(STATE.logs.map(l => l.perfil_nombre).filter(Boolean))].sort();
  const modulos  = [...new Set(STATE.logs.map(l => l.modulo).filter(Boolean))].sort();

  const valUsuarioActual = selUsuario.value;
  selUsuario.innerHTML = `<option value="">Todos los usuarios</option>` +
    usuarios.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  if (usuarios.includes(valUsuarioActual)) selUsuario.value = valUsuarioActual;

  const valModuloActual = selModulo.value;
  selModulo.innerHTML = `<option value="">Todos los módulos</option>` +
    modulos.map(m => `<option value="${esc(m)}">${esc(labelModulo(m))}</option>`).join('');
  if (modulos.includes(valModuloActual)) selModulo.value = valModuloActual;
}

/* =====================================================
   FILTROS / BÚSQUEDA / TABLA
===================================================== */
function logsFiltrados() {
  const q = STATE.search.toLowerCase().trim();
  return STATE.logs.filter(l => {
    if (STATE.filtro !== 'todos' && l.accion !== STATE.filtro) return false;
    if (STATE.filtroUsuario && l.perfil_nombre !== STATE.filtroUsuario) return false;
    if (STATE.filtroModulo && l.modulo !== STATE.filtroModulo) return false;
    if (!q) return true;
    return (l.resumen || '').toLowerCase().includes(q) || (l.tabla || '').toLowerCase().includes(q);
  });
}

const ACCION_INFO = {
  INSERT: { label: 'Creó',      badge: 'badge-insert' },
  UPDATE: { label: 'Editó',     badge: 'badge-update' },
  DELETE: { label: 'Eliminó',   badge: 'badge-delete' },
};

function renderTablaAud() {
  const tbody = document.getElementById('aud-tbody');
  if (!tbody) return;
  const filtrados = logsFiltrados();
  const totalPag = Math.max(1, Math.ceil(filtrados.length / STATE.perPage));
  STATE.page = Math.min(STATE.page, totalPag);
  const inicio = (STATE.page-1)*STATE.perPage;
  const pagina = filtrados.slice(inicio, inicio+STATE.perPage);

  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No hay movimientos con estos filtros</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(l => {
      const ai = ACCION_INFO[l.accion] || { label: l.accion, badge: 'badge-pendiente' };
      return `
      <tr>
        <td>${fmtFecha(l.created_at)}</td>
        <td style="font-family:var(--font-mono);font-size:12.5px">${fmtHora(l.created_at)}</td>
        <td style="font-weight:500">${esc(l.perfil_nombre)}${l.perfil_tipo==='admin'?' <span style="font-size:10px;color:var(--text-muted)">(admin)</span>':''}</td>
        <td>${esc(labelModulo(l.modulo))}</td>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${esc(l.tabla)}</td>
        <td><span class="status-badge ${ai.badge}">${ai.label}</span></td>
        <td style="font-size:12.5px;color:var(--text-secondary)">${esc(l.resumen || '—')}</td>
      </tr>`;
    }).join('');
  }

  const info = document.getElementById('paginacion-info');
  if (info) info.textContent = filtrados.length ? `${inicio+1}–${Math.min(inicio+STATE.perPage,filtrados.length)} de ${filtrados.length}` : '—';
  const prev = document.getElementById('btn-pag-prev'); if (prev) prev.disabled = STATE.page<=1;
  const next = document.getElementById('btn-pag-next'); if (next) next.disabled = STATE.page>=totalPag;
}

function setFiltroAud(f) {
  STATE.filtro = f; STATE.page = 1;
  document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => b.classList.toggle('active', b.dataset.filtro===f));
  renderTablaAud();
}
function filtrarPorSelectAud() {
  STATE.filtroUsuario = document.getElementById('aud-filtro-usuario')?.value || '';
  STATE.filtroModulo  = document.getElementById('aud-filtro-modulo')?.value || '';
  STATE.page = 1;
  renderTablaAud();
}
function buscarAud() { STATE.search = document.getElementById('aud-search')?.value || ''; STATE.page = 1; renderTablaAud(); }
function paginaAnterior() { if (STATE.page>1) { STATE.page--; renderTablaAud(); } }
function paginaSiguiente() { STATE.page++; renderTablaAud(); }

/* =====================================================
   KPIs
===================================================== */
function renderKPIsAud() {
  const hoy = todayISO();
  const deHoy = STATE.logs.filter(l => (l.created_at||'').slice(0,10) === hoy);
  const usuariosHoy = new Set(deHoy.map(l => l.perfil_nombre)).size;
  const ultimo = STATE.logs[0]; // ya viene ordenado desc

  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('kpi-hoy', fmtNum(deHoy.length));
  set('kpi-mes', fmtNum(STATE.logs.length));
  set('kpi-usuarios', fmtNum(usuariosHoy));
  set('kpi-ultimo', ultimo ? `${esc(ultimo.perfil_nombre)} · ${fmtHora(ultimo.created_at)}` : '—');
}

/* =====================================================
   INIT — requiere el código de administrador para entrar
===================================================== */
async function initAuditoria() {
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);

  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id; STATE.userEmail = user.email;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    const mostrarApp = () => {
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
      rangoFechasPorDefecto();
      cargarAuditoria();
    };

    // Auditoría SIEMPRE exige el código de administrador, sin importar
    // qué perfil haya iniciado sesión (igual que Configuración). Si
    // perfiles-guard.js no cargó por algún motivo, no se bloquea el
    // acceso del dueño por un fallo externo.
    if (window.PerfilesGuardConfig) {
      window.PerfilesGuardConfig.requerirCodigoAdmin(mostrarApp);
    } else {
      mostrarApp();
    }
  } catch (err) {
    console.error('initAuditoria:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initAuditoria();
  if (window.lucide) lucide.createIcons();
});
