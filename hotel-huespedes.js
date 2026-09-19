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
    if (STATE.empresaConfig?.usa_modulo_hotel !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarHuespedes();
  } catch (e) {
    console.error('init hotel-huespedes:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   CARGAR Y AGRUPAR -- toma las reservas vinculadas a un cliente
   real (cliente_id no nulo), y las agrupa por cliente para armar
   el historial: cuantas estadias, la ultima fecha, y el total
   generado (tarifa x noches de cada reserva no cancelada).
===================================================== */
async function cargarHuespedes() {
  try {
    const { data, error } = await sb.from('hotel_reservaciones')
      .select('*, clientes(id,nombre,apellido,telefono,whatsapp), hotel_habitaciones(numero)')
      .eq('auth_user_id', STATE.userId).not('cliente_id', 'is', null)
      .neq('estado', 'cancelada').order('fecha_entrada', { ascending: false });
    if (error) throw error;

    const porCliente = {};
    (data || []).forEach(r => {
      const cid = r.cliente_id;
      if (!porCliente[cid]) {
        const c = r.clientes;
        porCliente[cid] = {
          id: cid,
          nombre: c ? `${c.nombre}${c.apellido ? ' ' + c.apellido : ''}` : r.cliente_nombre,
          telefono: c?.telefono || c?.whatsapp || r.cliente_telefono || '',
          reservas: [], estadias: 0, ultimaVisita: null, totalGenerado: 0,
        };
      }
      const g = porCliente[cid];
      const n = noches(r.fecha_entrada, r.fecha_salida);
      g.reservas.push({ ...r, noches: n });
      g.estadias++;
      g.totalGenerado += n * Number(r.tarifa_acordada || 0);
      if (!g.ultimaVisita || r.fecha_entrada > g.ultimaVisita) g.ultimaVisita = r.fecha_entrada;
    });

    STATE.huespedes = Object.values(porCliente).sort((a, b) => (b.ultimaVisita || '').localeCompare(a.ultimaVisita || ''));
    actualizarKpisHuespedes();
    aplicarFiltrosHuespedes();
  } catch (e) {
    console.error('cargarHuespedes:', e);
    showToast('No se pudieron cargar los huéspedes', 'error');
  }
}

function actualizarKpisHuespedes() {
  const lista = STATE.huespedes;
  document.getElementById('hu-kpi-total').textContent = lista.length;
  document.getElementById('hu-kpi-recurrentes').textContent = lista.filter(h => h.estadias >= 2).length;
  const total = lista.reduce((s, h) => s + h.totalGenerado, 0);
  document.getElementById('hu-kpi-total-gastado').textContent = fmt(total);
}

/* =====================================================
   FILTROS + TABLA
===================================================== */
function aplicarFiltrosHuespedes() {
  const q = document.getElementById('hu-buscar')?.value.toLowerCase().trim() || '';
  STATE.filtrados = q
    ? STATE.huespedes.filter(h => (h.nombre || '').toLowerCase().includes(q) || (h.telefono || '').includes(q))
    : [...STATE.huespedes];
  renderTablaHuespedes();
}

function renderTablaHuespedes() {
  const tbody = document.getElementById('hu-tbody');
  if (!STATE.filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No hay huéspedes registrados todavía — se agregan automáticamente cuando vinculas un cliente al crear una reservación.</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.filtrados.map(h => `
    <tr>
      <td style="font-weight:700">${esc(h.nombre)}${h.estadias >= 2 ? ' <span class="hab-estado-badge hab-estado-disponible" style="font-size:10px;padding:1px 7px">Recurrente</span>' : ''}</td>
      <td>${esc(h.telefono) || '—'}</td>
      <td>${h.estadias}</td>
      <td>${fmtFechaCorta(h.ultimaVisita)}</td>
      <td>${fmt(h.totalGenerado)}</td>
      <td><button class="btn-secondary btn-sm" onclick="verHistorialHuesped('${h.id}')">Ver historial</button></td>
    </tr>`).join('');
}

/* =====================================================
   HISTORIAL DETALLADO
===================================================== */
function verHistorialHuesped(clienteId) {
  const h = STATE.huespedes.find(x => x.id === clienteId);
  if (!h) return;
  document.getElementById('hu-hist-titulo').textContent = h.nombre;
  const reservasOrdenadas = [...h.reservas].sort((a, b) => b.fecha_entrada.localeCompare(a.fecha_entrada));
  document.getElementById('hu-hist-body').innerHTML = `
    <div style="display:flex;gap:20px;margin-bottom:16px;font-size:13px">
      <div><b>${h.estadias}</b> estadía${h.estadias===1?'':'s'}</div>
      <div><b>${fmt(h.totalGenerado)}</b> generado</div>
    </div>
    ${reservasOrdenadas.map(r => `
      <div style="border-top:1px solid var(--border);padding:10px 0;font-size:13px">
        <div style="display:flex;justify-content:space-between">
          <span><b>Habitación ${esc(r.hotel_habitaciones?.numero || '—')}</b></span>
          <span>${fmt(r.tarifa_acordada * r.noches)}</span>
        </div>
        <div style="color:var(--text-secondary);font-size:12px;margin-top:3px">
          ${fmtFechaCorta(r.fecha_entrada)} → ${fmtFechaCorta(r.fecha_salida)} · ${r.noches} noche${r.noches===1?'':'s'}
        </div>
      </div>`).join('')}
  `;
  openModal('modal-historial-huesped');
}
