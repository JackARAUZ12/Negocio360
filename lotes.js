/* =====================================================
   HOTEL-HUESPEDES.JS — NEGOCIO360
   Historial de estadias por cliente -- lee de hotel_reservaciones
   (filtrando las que tienen cliente_id vinculado) y de clientes,
   sin crear ni duplicar ninguna tabla nueva.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  huespedes: [], filtrados: [],
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = (typeof monedaParaMostrar === 'function') ? monedaParaMostrar(STATE.empresaConfig?.moneda) : (STATE.empresaConfig?.moneda || 'C$');
  const n = (typeof convertirParaMostrar === 'function') ? convertirParaMostrar(amount, STATE.empresaConfig?.moneda) : Number(amount || 0);
  return `${sym} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function noches(entrada, salida) {
  return Math.round((new Date(salida) - new Date(entrada)) / 86400000);
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
function openModal(id) { const el = document.getElementById(id); if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; } }
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
    if (STATE.empresaConfig?.usa_modulo_farmacia !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarLotes();
  } catch (e) {
    console.error('init lotes:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});
/* =====================================================
   LOTES -- todos los lotes de todos los productos, en un
   solo lugar, con busqueda y edicion inline.
===================================================== */
async function cargarLotes() {
  const tbody = document.getElementById('lt-tbody');
  try {
    const { data, error } = await sb.from('producto_lotes')
      .select('*, productos(nombre)')
      .eq('auth_user_id', STATE.userId).eq('activo', true).gt('cantidad_actual', 0)
      .order('fecha_vencimiento', { ascending: true });
    if (error) throw error;
    STATE.lotes = data || [];
    STATE.filtrados = STATE.lotes;
    renderLotes();
  } catch (e) {
    console.error('cargarLotes:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudieron cargar los lotes.</td></tr>';
  }
}

function filtrarLotes() {
  const q = (document.getElementById('lt-buscar')?.value || '').trim().toLowerCase();
  STATE.filtrados = !q ? STATE.lotes : STATE.lotes.filter(l =>
    (l.productos?.nombre || '').toLowerCase().includes(q) || (l.numero_lote || '').toLowerCase().includes(q)
  );
  renderLotes();
}

function renderLotes() {
  const tbody = document.getElementById('lt-tbody');
  const pie = document.getElementById('lt-pie');
  const lista = STATE.filtrados || [];
  if (pie) pie.textContent = `${lista.length} lote${lista.length === 1 ? '' : 's'}`;
  actualizarKpisLotes();
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Sin lotes registrados todavía -- se agregan al comprar un producto desde Compras, o desde el detalle de un producto en Productos/Servicios.</td></tr>';
    return;
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  tbody.innerHTML = lista.map(l => {
    const venc = new Date(l.fecha_vencimiento + 'T00:00:00');
    const dias = Math.round((venc - hoy) / 86400000);
    let color = 'var(--text-primary)', etiqueta = '';
    if (dias < 0) { color = 'var(--danger,#dc2626)'; etiqueta = ' — ¡vencido!'; }
    else if (dias <= 30) { color = '#f59e0b'; etiqueta = ` — vence en ${dias} día${dias===1?'':'s'}`; }
    return `
      <tr data-lote-id="${l.id}">
        <td class="lt-celda-numero"><strong>${l.numero_lote ? esc(l.numero_lote) : '<span style="color:var(--text-muted);font-weight:400">Sin número</span>'}</strong></td>
        <td>${esc(l.productos?.nombre || 'Producto eliminado')}</td>
        <td>${fmtNumLote(l.cantidad_actual)}</td>
        <td class="lt-celda-venc" style="color:${color};font-weight:600">${l.fecha_vencimiento}${etiqueta}</td>
        <td><button class="btn-icon btn-ghost" onclick="abrirEdicionLoteInline('${l.id}')">✏️ Editar</button></td>
      </tr>`;
  }).join('');
}

function actualizarKpisLotes() {
  const lista = STATE.lotes || [];
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  let vencidos = 0, porVencer = 0, vigentes = 0;
  lista.forEach(l => {
    const dias = Math.round((new Date(l.fecha_vencimiento + 'T00:00:00') - hoy) / 86400000);
    if (dias < 0) vencidos++;
    else if (dias <= 30) porVencer++;
    else vigentes++;
  });
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('lt-kpi-total', lista.length);
  set('lt-kpi-vencidos', vencidos);
  set('lt-kpi-porvencer', porVencer);
  set('lt-kpi-vigentes', vigentes);
}

function fmtNumLote(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }

function abrirEdicionLoteInline(loteId) {
  const l = STATE.lotes.find(x => x.id === loteId);
  if (!l) return;
  const fila = document.querySelector(`tr[data-lote-id="${loteId}"]`);
  if (!fila) return;
  fila.querySelector('.lt-celda-numero').innerHTML = `<input type="text" id="editNum_${loteId}" value="${esc(l.numero_lote || '')}" style="width:100%;padding:4px 6px;border-radius:6px;border:1px solid var(--border,#e5e7eb)"/>`;
  fila.querySelector('.lt-celda-venc').innerHTML = `<input type="date" id="editVenc_${loteId}" value="${l.fecha_vencimiento}" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border,#e5e7eb)"/>`;
  const celdaAcciones = fila.children[4];
  celdaAcciones.innerHTML = `
    <button class="btn-icon btn-primary" onclick="guardarEdicionLoteInline('${loteId}')">Guardar</button>
    <button class="btn-icon btn-ghost" onclick="renderLotes()">Cancelar</button>`;
}

async function guardarEdicionLoteInline(loteId) {
  const numero = (document.getElementById(`editNum_${loteId}`)?.value || '').trim();
  const vencimiento = document.getElementById(`editVenc_${loteId}`)?.value || '';
  if (!vencimiento) { showToast('La fecha de vencimiento es obligatoria.', 'error'); return; }
  try {
    const { error } = await sb.from('producto_lotes')
      .update({ numero_lote: numero || null, fecha_vencimiento: vencimiento, updated_at: new Date().toISOString() })
      .eq('id', loteId);
    if (error) throw error;
    showToast('Lote actualizado correctamente.', 'success');
    await cargarLotes();
  } catch (e) {
    console.error('guardarEdicionLoteInline:', e);
    showToast('No se pudo guardar. Intenta de nuevo.', 'error');
  }
}
