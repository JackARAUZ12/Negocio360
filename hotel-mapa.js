/* =====================================================
   HOTEL-MAPA.JS — NEGOCIO360
   Mapa visual de habitaciones x fechas -- lee Habitaciones y
   Reservaciones, no crea ni duplica ninguna tabla nueva.
   Disponible para cualquier cuenta, apagado por defecto (mismo
   interruptor usa_modulo_hotel que el resto del sistema de Hotel).
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DIAS_VISIBLES = 14;

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  habitaciones: [], reservaciones: [],
  rangoInicio: todayISO(),
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
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function sumarDias(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

const ESTADO_LABEL = { confirmada:'Confirmada', pendiente:'Pendiente', cancelada:'Cancelada', completada:'Completada' };

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

    await cargarDatosMapa();
  } catch (e) {
    console.error('init hotel-mapa:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   CARGAR DATOS
===================================================== */
async function cargarDatosMapa() {
  try {
    const { data: habs } = await sb.from('hotel_habitaciones').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('numero');
    STATE.habitaciones = habs || [];

    const { data: reservas } = await sb.from('hotel_reservaciones').select('*')
      .eq('auth_user_id', STATE.userId).neq('estado', 'cancelada');
    STATE.reservaciones = reservas || [];

    renderMapa();
  } catch (e) {
    console.error('cargarDatosMapa:', e);
    showToast('No se pudo cargar el mapa de habitaciones', 'error');
  }
}

/* =====================================================
   NAVEGACIÓN DE RANGO DE FECHAS
===================================================== */
function moverRangoMapa(dias) {
  STATE.rangoInicio = sumarDias(STATE.rangoInicio, dias);
  renderMapa();
}
function irAHoyMapa() {
  STATE.rangoInicio = todayISO();
  renderMapa();
}

/* =====================================================
   RENDER DEL MAPA -- el corazon del modulo. Para cada habitacion
   (fila) y cada dia visible (columna), determina que mostrar:
   una reserva activa que cubra ese dia (con el nombre del
   huesped), o el estado libre/mantenimiento/bloqueada de la
   habitacion segun corresponda.
===================================================== */
function reservaEnDia(habitacionId, diaISO) {
  // fecha_entrada <= dia < fecha_salida -- el dia de salida ya NO
  // cuenta como ocupado (el huesped se va esa mañana, la habitacion
  // puede recibir a otro esa misma noche).
  return STATE.reservaciones.find(r =>
    r.habitacion_id === habitacionId && diaISO >= r.fecha_entrada && diaISO < r.fecha_salida
  );
}

function renderMapa() {
  const theadRow = document.getElementById('mapa-thead-row');
  const tbody = document.getElementById('mapa-tbody');
  const vacio = document.getElementById('mapa-vacio');
  const tabla = document.getElementById('mapa-tabla');

  if (!STATE.habitaciones.length) {
    tabla.style.display = 'none';
    vacio.style.display = '';
    document.getElementById('mapa-rango-texto').textContent = '—';
    return;
  }
  tabla.style.display = '';
  vacio.style.display = 'none';

  const dias = [];
  for (let i = 0; i < DIAS_VISIBLES; i++) dias.push(sumarDias(STATE.rangoInicio, i));
  const hoy = todayISO();

  document.getElementById('mapa-rango-texto').textContent =
    `${fmtFechaCorta(dias[0])} — ${fmtFechaCorta(dias[dias.length-1])}`;

  // Encabezado: una columna por dia, con el dia de la semana + numero
  theadRow.innerHTML = '<th class="mapa-col-habitacion">Habitación</th>' + dias.map(d => {
    const dt = new Date(d + 'T00:00:00');
    const diaSemana = dt.toLocaleDateString('es-NI', { weekday: 'short' });
    return `<th class="${d === hoy ? 'mapa-celda-hoy' : ''}">${diaSemana} ${dt.getDate()}</th>`;
  }).join('');

  tbody.innerHTML = STATE.habitaciones.map(h => {
    const celdas = dias.map(d => {
      const r = reservaEnDia(h.id, d);
      const esHoy = d === hoy ? 'mapa-celda-hoy' : '';
      if (r) {
        const claseEstado = r.estado === 'pendiente' ? 'mapa-celda-limpieza' : 'mapa-celda-ocupada';
        return `<td class="mapa-celda ${claseEstado} ${esHoy}" onclick="verDetalleCelda('${h.id}','${d}')">
          <span class="mapa-celda-huesped">${esc(r.cliente_nombre)}</span>
        </td>`;
      }
      // Sin reserva ese dia: refleja el estado ACTUAL de la habitacion
      // solo si es de los que impiden usarla (mantenimiento/bloqueada)
      // -- disponible/ocupada/limpieza son estados del momento actual,
      // no aplican a dias futuros sin reserva.
      const claseLibre = (h.estado === 'mantenimiento' || h.estado === 'bloqueada')
        ? `mapa-celda-${h.estado}` : 'mapa-celda-disponible';
      return `<td class="mapa-celda ${claseLibre} ${esHoy}" onclick="verDetalleCelda('${h.id}','${d}')"></td>`;
    }).join('');
    return `<tr><td class="mapa-col-habitacion">Hab. ${esc(h.numero)}</td>${celdas}</tr>`;
  }).join('');
}

/* =====================================================
   DETALLE AL HACER CLICK EN UNA CELDA
===================================================== */
let _mapaReservaSeleccionada = null;

function verDetalleCelda(habitacionId, diaISO) {
  const h = STATE.habitaciones.find(x => x.id === habitacionId);
  const r = reservaEnDia(habitacionId, diaISO);
  const titulo = document.getElementById('mapa-detalle-titulo');
  const body = document.getElementById('mapa-detalle-body');
  const btnVer = document.getElementById('mapa-detalle-btn-ver');

  titulo.textContent = `Habitación ${h?.numero || ''} — ${fmtFechaCorta(diaISO)}`;

  if (r) {
    _mapaReservaSeleccionada = r.id;
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:700;font-size:15px">${esc(r.cliente_nombre)}</span>
        <span class="hab-estado-badge hab-estado-${r.estado === 'confirmada' ? 'disponible' : 'limpieza'}">${ESTADO_LABEL[r.estado] || r.estado}</span>
      </div>
      <div style="font-size:13px;color:var(--text-secondary);display:flex;flex-direction:column;gap:4px">
        <div><b>Entrada:</b> ${fmtFechaCorta(r.fecha_entrada)}</div>
        <div><b>Salida:</b> ${fmtFechaCorta(r.fecha_salida)}</div>
        ${r.cliente_telefono ? `<div><b>Teléfono:</b> ${esc(r.cliente_telefono)}</div>` : ''}
        <div><b>Tarifa:</b> ${fmt(r.tarifa_acordada)} / noche</div>
        ${r.check_in_at ? `<div style="color:var(--success)">✅ Ya hizo check-in</div>` : ''}
      </div>`;
    btnVer.style.display = '';
  } else {
    _mapaReservaSeleccionada = null;
    const libre = !(h?.estado === 'mantenimiento' || h?.estado === 'bloqueada');
    body.innerHTML = `
      <p style="font-size:13.5px;color:var(--text-secondary)">
        ${libre ? '✅ Sin reservación para este día — disponible.' : `⚠️ La habitación está marcada como <b>${h?.estado}</b> actualmente.`}
      </p>`;
    btnVer.style.display = 'none';
  }
  openModal('modal-mapa-detalle');
}

function irAReservacionDesdeMapa() {
  if (!_mapaReservaSeleccionada) return;
  navigate('hotel-reservaciones.html');
}
