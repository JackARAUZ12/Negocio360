/* ============================================================
   NEGOCIO360 - admin.js
   Panel de Administración — lógica completa
   ============================================================ */

// ── SUPABASE INIT ──────────────────────────────────────────
// REEMPLAZA CON TUS CREDENCIALES
const SUPABASE_URL      = 'https://zvlincmqmmoclqhykejv.supabase.co';      // ← reemplazar
const SUPABASE_ANON_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t'; // ← reemplazar

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── CONFIGURACIÓN DE COBRO ─────────────────────────────────
// Precio mensual del plan Premium usado en el comprobante de pago.
// Cambia este valor si el precio de la suscripción cambia.
const PRECIO_PREMIUM_USD = 10.00;

// ── ESTADO GLOBAL ──────────────────────────────────────────
let currentUser   = null;
let adminRecord   = null;
let allUsers      = [];
let allCodes      = [];
let userFilter    = 'all';
let pendingAction = null;  // función pendiente de confirmación

// Estado del chat / atención al cliente
let allConversaciones   = [];
let chatFilter          = 'activas';
let currentConvId       = null;
let currentConvUsuario  = null;
let soporteMsgChannel   = null;
let soporteConvChannel  = null;
let soporteGlobalChannel = null;
let soporteSeenIds      = new Set();

// ── HELPERS DOM ────────────────────────────────────────────
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── LOADER ─────────────────────────────────────────────────
function showLoader()  { document.getElementById('page-loader').classList.remove('hidden'); }
function hideLoader()  { document.getElementById('page-loader').classList.add('hidden'); }

// ── TOAST ──────────────────────────────────────────────────
function toast(title, msg = '', type = 'success') {
  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ',
  };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <div class="toast-icon ${type}">${icons[type] || icons.info}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('transitionend', () => el.remove());
  }, 3800);
}

// ── MODAL HELPERS ──────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
function closeAllModals() {
  $$('.modal-overlay').forEach(m => m.classList.remove('open'));
}

// ── NAVEGACIÓN ─────────────────────────────────────────────
function navigate(section) {
  $$('.page-content').forEach(p => p.classList.remove('active'));
  $$('.nav-item[data-section]').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${section}`);
  const nav  = $(`.nav-item[data-section="${section}"]`);

  if (page) page.classList.add('active');
  if (nav)  nav.classList.add('active');

  // Cerrar sidebar en móvil
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');

  // Cargar datos según sección
  if (section === 'dashboard') loadDashboardStats();
  if (section === 'users')     loadUsers();
  if (section === 'codes')     loadCodes();
  if (section === 'soporte')   loadConversaciones();
}

// ── AUTENTICACIÓN & VERIFICACIÓN ADMIN ────────────────────
async function verifyAdmin() {
  try {
    const { data: { user }, error } = await sb.auth.getUser();

    if (error || !user) {
      window.location.href = 'login.html';
      return false;
    }

    // Verificar en tabla administradores
    const { data: admin, error: adminError } = await sb
      .from('administradores')
      .select('*')
      .eq('email', user.email)
      .eq('activo', true)
      .single();

    if (adminError || !admin) {
      window.location.href = 'dashboard.html';
      return false;
    }

    currentUser = user;
    adminRecord = admin;
    return true;

  } catch (e) {
    window.location.href = 'login.html';
    return false;
  }
}

// ── POBLAR HEADER ──────────────────────────────────────────
function populateHeader() {
  const nombreCompleto = adminRecord.nombre || currentUser.email;
  const initials = nombreCompleto.charAt(0).toUpperCase();

  document.getElementById('header-admin-name').textContent = nombreCompleto;
  document.getElementById('header-admin-email').textContent = currentUser.email;
  document.getElementById('admin-avatar').textContent = initials;

  // Fecha actual
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('header-date').textContent =
    now.toLocaleDateString('es-ES', opts);
}

// ── DARK MODE ──────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('n360_admin_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('n360_admin_theme', next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  document.getElementById('theme-icon').innerHTML =
    theme === 'dark'
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
           <line x1="12" y1="21" x2="12" y2="23"/>
           <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
           <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
           <line x1="1" y1="12" x2="3" y2="12"/>
           <line x1="21" y1="12" x2="23" y2="12"/>
           <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
           <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
         </svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
         </svg>`;
}

// ── CERRAR SESIÓN ──────────────────────────────────────────
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

// ============================================================
// SECCIÓN 1 — DASHBOARD STATS
// ============================================================
async function loadDashboardStats() {
  // Re-verificar sesión antes de cargar
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  showSkeletons();
  showPaymentListsLoading();

  try {
    const { data: usuarios, error } = await sb
      .from('usuarios')
      .select('id, nombre, apellido, email, estado_cuenta, plan, created_at, fecha_ultimo_pago');

    if (error) throw error;

    const total     = usuarios.length;
    const activos   = usuarios.filter(u => u.estado_cuenta === 'activa').length;
    const suspendidos = usuarios.filter(u => u.estado_cuenta === 'suspendida').length;
    const cancelados  = usuarios.filter(u => u.estado_cuenta === 'cancelada').length;
    const prueba    = usuarios.filter(u => u.plan === 'prueba').length;
    const premium   = usuarios.filter(u => u.plan === 'premium').length;

    document.getElementById('stat-total').textContent       = total;
    document.getElementById('stat-activos').textContent     = activos;
    document.getElementById('stat-suspendidos').textContent = suspendidos;
    document.getElementById('stat-cancelados').textContent  = cancelados;
    document.getElementById('stat-prueba').textContent      = prueba;
    document.getElementById('stat-premium').textContent     = premium;

    // Construir las listas informativas de pagos (próximos / pendientes / atrasados)
    buildPaymentLists(usuarios);

  } catch (e) {
    toast('Error al cargar estadísticas', e.message, 'error');
  }
}

function showSkeletons() {
  ['stat-total','stat-activos','stat-suspendidos','stat-cancelados','stat-prueba','stat-premium']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; }
    });
}

function showPaymentListsLoading() {
  ['list-proximos', 'list-pendientes', 'list-atrasados'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="payment-empty">Cargando...</div>';
  });
}

// ============================================================
// SECCIÓN 1B — CONTROL DE PAGOS (Próximos / Pendientes / Atrasados)
// ============================================================
// La lógica se basa en el día del mes en que el usuario se registró
// (created_at). Cada mes esa misma fecha se considera el "día de pago".
//
// - 3 días antes del día de pago  → aparece en "Próximos a Pagar"
// - El día de pago (o 1 día después) → aparece en "Pendientes de Pago"
// - 2 días o más después del día de pago → aparece en "Pago Atrasado"
//
// Un usuario deja de aparecer en cualquiera de las 3 listas apenas se le
// marca "Pagado" (desde la sección Usuarios) para el ciclo correspondiente,
// y no vuelve a aparecer hasta que se acerque su próxima fecha de pago.
//
// "fecha_ultimo_pago" representa el CICLO cubierto (hasta qué vencimiento
// está al día el usuario), no necesariamente la fecha exacta en que se dio
// clic en "Marcar Pagado". Esto permite pagos adelantados: si el cliente
// paga julio y luego, ese mismo día, adelanta agosto, "fecha_ultimo_pago"
// pasa a ser el vencimiento de agosto y julio queda cubierto igual.
//
// NOTA: por defecto solo se controla el pago de usuarios con plan
// "premium" (los usuarios en "prueba" no pagan). Si tu negocio cobra
// también el plan de prueba, quita la condición `u.plan !== 'premium'`.

// Calcula la fecha de vencimiento ("día de pago") para un año/mes dados,
// a partir del día de registro del usuario. Se reutiliza tanto para el
// ciclo actual como para calcular el próximo ciclo, así ambos cálculos
// quedan siempre alineados con la misma lógica.
function calcDueDateForMonth(regDate, year, month) {
  const regDay = regDate.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dueDay = Math.min(regDay, daysInMonth);
  return new Date(year, month, dueDay);
}

// Índice absoluto de mes (año*12 + mes), útil para comparar "cuál ciclo
// es más reciente" sin preocuparse por el día exacto.
function monthIndex(d) {
  return d.getFullYear() * 12 + d.getMonth();
}

// Fecha de vencimiento del ciclo correspondiente al mes de "today".
function getCurrentCycleDueDate(u, today) {
  if (!u.created_at) return null;
  const reg = new Date(u.created_at);
  const t = new Date(today);
  return calcDueDateForMonth(reg, t.getFullYear(), t.getMonth());
}

// Ciclo inmediatamente siguiente a una fecha de vencimiento dada.
// A diferencia de getNextCycleDueDate, no parte de "hoy" sino de
// cualquier fecha de vencimiento que le pases, así se puede encadenar
// para calcular varios meses hacia adelante (pagos adelantados).
function getNextCycleAfter(u, dueDate) {
  if (!dueDate) return null;
  const reg = new Date(u.created_at);
  const nextMonthIndex = dueDate.getMonth() + 1;
  const year  = dueDate.getFullYear() + Math.floor(nextMonthIndex / 12);
  const month = ((nextMonthIndex % 12) + 12) % 12;
  return calcDueDateForMonth(reg, year, month);
}

// Fecha de vencimiento del ciclo siguiente al ciclo actual (un mes
// después de "hoy"). Se usa para mostrarle al administrador cuándo
// tocará el próximo pago justo antes/después de marcar el pago actual
// como recibido.
function getNextCycleDueDate(u, today) {
  const current = getCurrentCycleDueDate(u, today);
  if (!current) return null;
  return getNextCycleAfter(u, current);
}

// Encuentra el próximo ciclo que TODAVÍA no ha sido cubierto por
// fecha_ultimo_pago. Si el usuario ya pagó julio y el admin quiere
// adelantar el pago de agosto, esta función devuelve agosto (no julio
// de nuevo), permitiendo pagos adelantados ilimitados.
function getCicloAPagar(u, today) {
  if (!u.created_at) return null;
  let candidate = getCurrentCycleDueDate(u, today);
  if (!candidate) return null;

  if (u.fecha_ultimo_pago) {
    const pago = new Date(u.fecha_ultimo_pago + 'T00:00:00');
    while (monthIndex(pago) >= monthIndex(candidate)) {
      candidate = getNextCycleAfter(u, candidate);
    }
  }
  return candidate;
}

// Nombre de mes + año, con la primera letra en mayúscula (ej. "Julio 2026")
function formatMesAnio(date) {
  if (!date) return '—';
  const txt = date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function getPaymentInfo(u, today) {
  if (!u.created_at) return null;
  if (u.plan !== 'premium') return null;
  if (u.estado_cuenta === 'cancelada') return null;

  const reg = new Date(u.created_at);
  reg.setHours(0, 0, 0, 0);

  const t = new Date(today);
  t.setHours(0, 0, 0, 0);

  // Meses completos transcurridos desde el registro.
  const monthsSinceReg = (t.getFullYear() - reg.getFullYear()) * 12 + (t.getMonth() - reg.getMonth());
  if (monthsSinceReg <= 0) return null; // Aún dentro del primer mes (se "pagó" al registrarse)

  // Fecha de vencimiento de este mes (ajustada si el mes tiene menos días)
  const dueDate = calcDueDateForMonth(reg, t.getFullYear(), t.getMonth());

  // ¿Ya se marcó como pagado (o adelantado) el ciclo que corresponde a
  // este vencimiento? Se compara por mes/año, no por igualdad exacta,
  // para que un pago adelantado (ej. agosto) cubra también julio.
  if (u.fecha_ultimo_pago) {
    const pago = new Date(u.fecha_ultimo_pago + 'T00:00:00');
    if (monthIndex(pago) >= monthIndex(dueDate)) {
      return null; // este ciclo (o uno posterior) ya está cubierto
    }
  }

  const diffDays = Math.round((t - dueDate) / 86400000);

  if (diffDays < -3) return null;                                    // todavía falta más de 3 días
  if (diffDays < 0)   return { status: 'proximo',   dueDate, diffDays };
  if (diffDays <= 1)  return { status: 'pendiente', dueDate, diffDays };
  return { status: 'atrasado', dueDate, diffDays };
}

function buildPaymentLists(usuarios) {
  const today = new Date();
  const proximos = [], pendientes = [], atrasados = [];

  usuarios.forEach(u => {
    const info = getPaymentInfo(u, today);
    if (!info) return;
    const entry = Object.assign({}, u, info);
    if (info.status === 'proximo')   proximos.push(entry);
    if (info.status === 'pendiente') pendientes.push(entry);
    if (info.status === 'atrasado')  atrasados.push(entry);
  });

  proximos.sort((a, b) => a.dueDate - b.dueDate);
  pendientes.sort((a, b) => a.dueDate - b.dueDate);
  atrasados.sort((a, b) => b.diffDays - a.diffDays);

  renderPaymentList('list-proximos', proximos, 'Nadie está próximo a pagar', (e) => {
    const dias = Math.abs(e.diffDays);
    return {
      sub:   `Vence en ${dias} día${dias === 1 ? '' : 's'} · ${formatDate(e.dueDate)}`,
      badge: 'info',
      label: `${dias}d`,
    };
  });

  renderPaymentList('list-pendientes', pendientes, 'No hay pagos pendientes hoy', (e) => {
    const label = e.diffDays === 0 ? 'Hoy' : 'Ayer';
    return {
      sub:   `Vence ${label.toLowerCase()} · ${formatDate(e.dueDate)}`,
      badge: 'warning',
      label,
    };
  });

  renderPaymentList('list-atrasados', atrasados, 'No hay pagos atrasados', (e) => {
    return {
      sub:   `Venció el ${formatDate(e.dueDate)}`,
      badge: 'danger',
      label: `${e.diffDays}d atraso`,
    };
  });
}

function renderPaymentList(containerId, items, emptyMsg, describe) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!items.length) {
    el.innerHTML = `<div class="payment-empty">${emptyMsg}</div>`;
    return;
  }

  el.innerHTML = items.map(u => {
    const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || 'Sin nombre';
    const initial = nombreCompleto.charAt(0).toUpperCase();
    const { sub, badge, label } = describe(u);
    return `
      <div class="payment-item">
        <div class="payment-item-avatar">${escHtml(initial)}</div>
        <div class="payment-item-info">
          <div class="payment-item-name">${escHtml(nombreCompleto)}</div>
          <div class="payment-item-sub">${escHtml(sub)}</div>
        </div>
        <span class="pago-badge ${badge}">${escHtml(label)}</span>
      </div>
    `;
  }).join('');
}

// ============================================================
// SECCIÓN 2 — USUARIOS
// ============================================================
async function loadUsers() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  showUsersLoader();

  try {
    const { data, error } = await sb
      .from('usuarios')
      .select('id, auth_user_id, nombre, apellido, nombre_negocio, email, telefono, estado_cuenta, plan, fecha_vencimiento, fecha_ultimo_pago, onboarding_completado, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allUsers = data || [];
    renderUsersTable(allUsers);

  } catch (e) {
    toast('Error al cargar usuarios', e.message, 'error');
    renderUsersEmpty();
  }
}

function showUsersLoader() {
  document.getElementById('users-tbody').innerHTML = `
    <tr><td colspan="10" style="text-align:center; padding:48px; color:var(--text-muted)">
      <div class="loader-spinner" style="margin:0 auto 12px"></div>
      <div>Cargando usuarios...</div>
    </td></tr>`;
}

function renderUsersEmpty() {
  document.getElementById('users-tbody').innerHTML = `
    <tr><td colspan="10">
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <p>No se encontraron usuarios</p>
        <span>Intenta cambiar los filtros de búsqueda</span>
      </div>
    </td></tr>`;
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');

  if (!users.length) { renderUsersEmpty(); return; }

  const today = new Date();

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${escHtml(u.nombre || '—')}</td>
      <td>${escHtml(u.apellido || '—')}</td>
      <td>${escHtml(u.nombre_negocio || '—')}</td>
      <td>${escHtml(u.email || '—')}</td>
      <td>${escHtml(u.telefono || '—')}</td>
      <td>${planBadge(u.plan)}</td>
      <td>${estadoBadge(u.estado_cuenta)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td>${u.fecha_ultimo_pago ? formatDate(u.fecha_ultimo_pago) : '<span style="color:var(--text-muted)">Sin registro</span>'}</td>
      <td>
        <div class="td-actions">
          <button class="btn-icon btn-ghost btn-sm" onclick="viewUser('${u.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Ver
          </button>
          ${u.plan === 'premium'
            ? `<div class="marcar-pagado-wrap">
                <button class="btn-icon btn-primary btn-sm" onclick="openConfirmMarkPaid('${u.id}')" title="Marcar que ya pagó (o adelantó) su próximo mes y enviarle el comprobante">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  Marcar Pagado
                </button>
                ${u.created_at ? `<span class="next-pago-hint">Próx. pago: ${formatDate(getCicloAPagar(u, today))}</span>` : ''}
              </div>`
            : ''}
          ${u.estado_cuenta !== 'activa'
            ? `<button class="btn-icon btn-success btn-sm" onclick="openConfirmAction('activar', '${u.id}', '${escHtml(u.nombre || u.email)}')">Activar</button>`
            : ''}
          ${u.estado_cuenta !== 'suspendida'
            ? `<button class="btn-icon btn-warning btn-sm" onclick="openConfirmAction('suspender', '${u.id}', '${escHtml(u.nombre || u.email)}')">Suspender</button>`
            : ''}
          ${u.estado_cuenta !== 'cancelada'
            ? `<button class="btn-icon btn-danger btn-sm" onclick="openConfirmAction('cancelar', '${u.id}', '${escHtml(u.nombre || u.email)}')">Cancelar</button>`
            : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

// Filtrar tabla usuarios
function applyUserFilter(filter) {
  userFilter = filter;
  $$('#page-users .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === filter));
  filterAndSearch();
}

function filterAndSearch() {
  const query = (document.getElementById('user-search').value || '').toLowerCase().trim();
  let filtered = allUsers;

  if (userFilter !== 'all') {
    if (userFilter === 'prueba' || userFilter === 'premium') {
      filtered = filtered.filter(u => u.plan === userFilter);
    } else {
      const estadoMap = { activos: 'activa', suspendidos: 'suspendida', cancelados: 'cancelada' };
      filtered = filtered.filter(u => u.estado_cuenta === estadoMap[userFilter]);
    }
  }

  if (query) {
    filtered = filtered.filter(u =>
      [u.nombre, u.apellido, u.email, u.nombre_negocio, u.telefono]
        .join(' ').toLowerCase().includes(query));
  }

  renderUsersTable(filtered);
}

// Ver usuario — modal detalle
function viewUser(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;

  document.getElementById('detail-nombre').textContent     = u.nombre || '—';
  document.getElementById('detail-apellido').textContent   = u.apellido || '—';
  document.getElementById('detail-negocio').textContent    = u.nombre_negocio || '—';
  document.getElementById('detail-email').textContent      = u.email || '—';
  document.getElementById('detail-telefono').textContent   = u.telefono || '—';
  document.getElementById('detail-plan').innerHTML         = planBadge(u.plan);
  document.getElementById('detail-estado').innerHTML       = estadoBadge(u.estado_cuenta);
  document.getElementById('detail-registro').textContent   = formatDate(u.created_at);
  document.getElementById('detail-ultimo-pago').textContent = u.fecha_ultimo_pago ? formatDate(u.fecha_ultimo_pago) : 'Sin registro';
  document.getElementById('detail-onboarding').innerHTML   = u.onboarding_completado
    ? '<span class="badge badge-success">Completado</span>'
    : '<span class="badge badge-warning">Pendiente</span>';

  openModal('modal-view-user');
}

// ============================================================
// MARCAR PAGADO → genera comprobante PDF y lo envía por chat
// ============================================================
// Flujo:
//   1. El admin hace clic en "Marcar Pagado" → openConfirmMarkPaid()
//      calcula el PRÓXIMO CICLO AÚN NO CUBIERTO (permite pagos
//      adelantados) y muestra un modal de confirmación con el nombre
//      del cliente, el mes que se está pagando, el monto y la fecha
//      del próximo pago después de este.
//   2. Al confirmar → executeMarkAsPaid():
//        a) Actualiza fecha_ultimo_pago en la tabla "usuarios" con la
//           fecha del CICLO pagado (no la fecha real de hoy), lo que
//           permite adelantar varios meses seguidos.
//        b) Genera un comprobante de pago en PDF (jsPDF).
//        c) Busca (o crea) una conversación activa de soporte para ese
//           cliente y sube el PDF al bucket "chat-archivos".
//        d) Inserta un mensaje de texto + el documento (comprobante)
//           en esa conversación, como si el administrador se los
//           enviara al cliente por el chat de Atención al Cliente.
//
// NOTA IMPORTANTE SOBRE PERMISOS (Supabase):
// Para que el paso (c) funcione, el bucket de Storage "chat-archivos"
// debe permitir que un administrador (no el dueño del archivo) suba
// documentos dentro de la carpeta del cliente. Si tu bucket restringe
// las subidas a "auth.uid() = carpeta raíz del archivo", agrega esta
// política en el SQL Editor de Supabase:
//
//   create policy "Admins pueden subir comprobantes para cualquier usuario"
//   on storage.objects
//   for insert
//   to authenticated
//   with check (
//     bucket_id = 'chat-archivos'
//     and exists (
//       select 1 from public.administradores a
//       where a.email = auth.email() and a.activo = true
//     )
//   );
//
// Si esa política ya existe o el bucket no tiene RLS restrictivo,
// no necesitas hacer nada más.

function openConfirmMarkPaid(userId) {
  const u = allUsers.find(x => x.id === userId);
  if (!u) return;

  if (!u.auth_user_id) {
    toast('No se puede procesar', 'Este usuario no tiene una cuenta de acceso vinculada (auth_user_id), así que no se le puede enviar el comprobante por chat.', 'warning');
    return;
  }

  const today = new Date();
  const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || 'este cliente';
  const cicloAPagar    = getCicloAPagar(u, today);
  const mesPagadoTexto = cicloAPagar ? formatMesAnio(cicloAPagar) : formatMesAnio(today);
  const nextDue        = cicloAPagar ? getNextCycleAfter(u, cicloAPagar) : null;

  document.getElementById('confirm-icon').className = 'confirm-icon success';
  document.getElementById('confirm-icon').textContent = '✓';
  document.getElementById('confirm-title').textContent = '¿Confirmar pago recibido?';
  document.getElementById('confirm-sub').innerHTML =
    `Se registrará el pago de <strong>${escHtml(nombreCompleto)}</strong> correspondiente a <strong>${escHtml(mesPagadoTexto)}</strong> por <strong>$${PRECIO_PREMIUM_USD.toFixed(2)} USD</strong>.<br><br>` +
    `Se le enviará automáticamente un comprobante en su chat de soporte.` +
    (nextDue ? `<br>Su próximo pago será el <strong>${escHtml(formatDate(nextDue))}</strong>.` : '');

  const btn = document.getElementById('btn-confirm-action');
  btn.className = 'btn-icon btn-success';
  btn.textContent = 'Sí, marcar como pagado';

  window._pendingAction = { accion: 'marcar-pagado', userId, cicloAPagar };
  openModal('modal-confirm');
}

// Busca una conversación activa existente para el usuario; si no hay
// ninguna, crea una nueva (igual que startConversation() en chat.html).
async function getOrCreateActiveConversacion(authUserId) {
  const { data: existing, error: errFind } = await sb
    .from('conversaciones_chat')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('estado', 'activa')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errFind) throw errFind;
  if (existing) return existing.id;

  const { data: created, error: errCreate } = await sb
    .from('conversaciones_chat')
    .insert({ auth_user_id: authUserId, estado: 'activa' })
    .select('id')
    .single();

  if (errCreate) throw errCreate;
  return created.id;
}

// Genera el PDF del comprobante de pago. Devuelve { blob, filename }.
function generarComprobantePDF({ nombreCompleto, email, negocio, mesPagadoTexto, fechaPago, monto, proximoPago }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const numero = 'CMP-' + Date.now().toString().slice(-8);

  // Encabezado
  doc.setFillColor(108, 99, 255);
  doc.rect(0, 0, W, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20); doc.setFont(undefined, 'bold');
  doc.text('Negocio360', 14, 20);
  doc.setFontSize(11); doc.setFont(undefined, 'normal');
  doc.text('Comprobante de Pago', 14, 29);
  doc.setFontSize(9);
  doc.text(`N.º ${numero}`, W - 14, 18, { align: 'right' });
  doc.text(`Emitido: ${fechaPago.toLocaleString('es-NI')}`, W - 14, 24, { align: 'right' });

  let y = 52;
  doc.setTextColor(20, 20, 30);
  doc.setFontSize(12); doc.setFont(undefined, 'bold');
  doc.text('Detalle del pago', 14, y);

  const rows = [
    ['Pago del mes',  mesPagadoTexto],
    ['Fecha de pago', fechaPago.toLocaleDateString('es-NI', { day: '2-digit', month: 'long', year: 'numeric' })],
    ['A nombre de',   nombreCompleto],
    ['Correo',        email || '—'],
    ['Negocio',       negocio || '—'],
    ['Recibe',        'Negocio360'],
    ['Monto',         `$${monto.toFixed(2)} USD`],
  ];

  doc.autoTable({
    startY: y + 6,
    body: rows,
    theme: 'plain',
    styles: { fontSize: 11, cellPadding: 4 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [90, 90, 110], cellWidth: 55 },
      1: { textColor: [20, 20, 30] },
    },
    didParseCell: (data) => {
      if (data.row.index === rows.length - 1) {
        data.cell.styles.fontSize = 14;
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [108, 99, 255];
      }
    },
  });

  let finalY = doc.lastAutoTable.finalY + 14;
  doc.setDrawColor(230, 230, 235);
  doc.line(14, finalY, W - 14, finalY);
  finalY += 10;

  doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(90, 90, 110);
  if (proximoPago) {
    doc.text(`Tu próximo pago será el ${proximoPago.toLocaleDateString('es-NI', { day: '2-digit', month: 'long', year: 'numeric' })}.`, 14, finalY);
    finalY += 14;
  }

  doc.setFontSize(8.5); doc.setTextColor(140, 140, 160);
  doc.text('Este comprobante fue generado automáticamente por Negocio360 y no requiere firma.', 14, finalY);

  const filename = `comprobante_${numero}.pdf`;
  const blob = doc.output('blob');
  return { blob, filename };
}

// Ejecuta la acción completa al confirmar "Marcar Pagado".
// cicloAPagar es la fecha de vencimiento del ciclo que se está pagando
// (calculada en openConfirmMarkPaid), permitiendo pagos adelantados.
async function executeMarkAsPaid(userId, cicloAPagar) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const u = allUsers.find(x => x.id === userId);
  if (!u) { toast('Error', 'No se encontró el usuario', 'error'); return; }
  if (!u.auth_user_id) {
    toast('No se pudo enviar el comprobante', 'Este usuario no tiene una cuenta vinculada para chat', 'error');
    return;
  }

  const btn = document.getElementById('btn-confirm-action');
  btn.innerHTML = '<span class="btn-spinner"></span>';
  btn.disabled = true;

  try {
    const today = new Date();

    // El ciclo a registrar es el que se calculó al abrir el modal de
    // confirmación; si por alguna razón no llegó, se recalcula aquí
    // como respaldo (equivalente al comportamiento anterior).
    const cicloDueDate = cicloAPagar || getCicloAPagar(u, today) || getCurrentCycleDueDate(u, today);
    // FIX zona horaria: toISOString() es UTC y puede correr la fecha en
    // Nicaragua (UTC-6); se usa la fecha calendario local del ciclo.
    const hoyISO = `${cicloDueDate.getFullYear()}-${String(cicloDueDate.getMonth()+1).padStart(2,'0')}-${String(cicloDueDate.getDate()).padStart(2,'0')}`; // fecha del CICLO pagado (no la fecha real de hoy)

    // 1) Registrar el pago
    const { error: errPago } = await sb
      .from('usuarios')
      .update({ fecha_ultimo_pago: hoyISO })
      .eq('id', userId);
    if (errPago) throw errPago;

    // 2) Generar el comprobante en PDF
    const mesPagadoTexto = formatMesAnio(cicloDueDate);
    const nextDue        = getNextCycleAfter(u, cicloDueDate);
    const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || 'Cliente';

    const { blob, filename } = generarComprobantePDF({
      nombreCompleto,
      email: u.email,
      negocio: u.nombre_negocio,
      mesPagadoTexto,
      fechaPago: today,
      monto: PRECIO_PREMIUM_USD,
      proximoPago: nextDue,
    });

    // 3) Buscar o crear una conversación activa para este cliente
    const convId = await getOrCreateActiveConversacion(u.auth_user_id);

    // 4) Subir el PDF al bucket de archivos del chat
    const path = `${u.auth_user_id}/${convId}/${Date.now()}-${filename}`;
    const { error: upErr } = await sb.storage
      .from('chat-archivos')
      .upload(path, blob, { contentType: 'application/pdf' });
    if (upErr) throw upErr;

    const { data: pub } = sb.storage.from('chat-archivos').getPublicUrl(path);

    // 5) Enviar el mensaje de texto + el comprobante en el chat
    const { error: errMsgTxt } = await sb.from('mensajes_chat').insert({
      conversacion_id: convId,
      auth_user_id: u.auth_user_id,
      remitente: 'admin',
      tipo: 'texto',
      contenido: `¡Gracias por tu pago! Aquí tienes tu comprobante correspondiente a ${mesPagadoTexto}.`,
    });
    if (errMsgTxt) throw errMsgTxt;

    const { error: errMsgDoc } = await sb.from('mensajes_chat').insert({
      conversacion_id: convId,
      auth_user_id: u.auth_user_id,
      remitente: 'admin',
      tipo: 'documento',
      archivo_url: pub.publicUrl,
      archivo_nombre: filename,
    });
    if (errMsgDoc) throw errMsgDoc;

    // Actualizar copia local
    const idx = allUsers.findIndex(x => x.id === userId);
    if (idx !== -1) allUsers[idx].fecha_ultimo_pago = hoyISO;

    closeModal('modal-confirm');
    toast('Pago registrado y comprobante enviado', `Se envió el comprobante a ${nombreCompleto} por su chat de soporte`, 'success');

    filterAndSearch();
    loadDashboardStats();

  } catch (e) {
    toast('Error al procesar el pago', e.message, 'error');
  } finally {
    btn.innerHTML = 'Confirmar';
    btn.disabled = false;
    window._pendingAction = null;
  }
}

// Confirmar acción sobre usuario (activar / suspender / cancelar)
function openConfirmAction(accion, userId, nombre) {
  const msgs = {
    activar:   { title: '¿Activar esta cuenta?',   sub: `Se activará la cuenta de <strong>${nombre}</strong>.`,   icon: '✓', cls: 'success', btn: 'btn-success', label: 'Sí, activar'    },
    suspender: { title: '¿Suspender esta cuenta?', sub: `Se suspenderá la cuenta de <strong>${nombre}</strong>.`, icon: '⚠', cls: 'warn',    btn: 'btn-warning', label: 'Sí, suspender' },
    cancelar:  { title: '¿Cancelar esta cuenta?',  sub: `Se cancelará la cuenta de <strong>${nombre}</strong>.`,  icon: '✕', cls: 'danger',  btn: 'btn-danger',  label: 'Sí, cancelar'  },
  };
  const m = msgs[accion];
  if (!m) return;

  document.getElementById('confirm-icon').className = `confirm-icon ${m.cls}`;
  document.getElementById('confirm-icon').textContent = m.icon;
  document.getElementById('confirm-title').textContent = m.title;
  document.getElementById('confirm-sub').innerHTML = m.sub;

  const btnConfirm = document.getElementById('btn-confirm-action');
  btnConfirm.className = `btn-icon ${m.btn}`;
  btnConfirm.textContent = m.label;

  // Guardar acción pendiente
  window._pendingAction = { accion, userId };

  openModal('modal-confirm');
}

async function executeConfirmAction() {
  const { accion, userId } = window._pendingAction || {};
  if (!accion || !userId) return;

  const estadoMap = { activar: 'activa', suspender: 'suspendida', cancelar: 'cancelada' };
  const nuevoEstado = estadoMap[accion];
  if (!nuevoEstado) return;

  // Re-verificar sesión
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const btn = document.getElementById('btn-confirm-action');
  btn.innerHTML = '<span class="btn-spinner"></span>';
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('usuarios')
      .update({ estado_cuenta: nuevoEstado, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;

    closeModal('modal-confirm');

    const toastMsgs = {
      activa:     'Cuenta activada correctamente',
      suspendida: 'Cuenta suspendida correctamente',
      cancelada:  'Cuenta cancelada correctamente',
    };
    const toastTypes = { activa: 'success', suspendida: 'warning', cancelada: 'error' };

    toast(toastMsgs[nuevoEstado], '', toastTypes[nuevoEstado]);

    // Actualizar local
    const idx = allUsers.findIndex(u => u.id === userId);
    if (idx !== -1) allUsers[idx].estado_cuenta = nuevoEstado;

    filterAndSearch();
    loadDashboardStats();

  } catch (e) {
    toast('Error al actualizar cuenta', e.message, 'error');
  } finally {
    btn.innerHTML = 'Confirmar';
    btn.disabled = false;
    window._pendingAction = null;
  }
}

// ============================================================
// SECCIÓN 3 — CÓDIGOS DE ACCESO
// ============================================================
async function loadCodes() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  showCodesLoader();

  try {
    const { data, error } = await sb
      .from('codigos_acceso')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allCodes = data || [];
    renderCodesTable(allCodes);

  } catch (e) {
    toast('Error al cargar códigos', e.message, 'error');
    renderCodesEmpty();
  }
}

function showCodesLoader() {
  document.getElementById('codes-tbody').innerHTML = `
    <tr><td colspan="7" style="text-align:center; padding:48px; color:var(--text-muted)">
      <div class="loader-spinner" style="margin:0 auto 12px"></div>
      <div>Cargando códigos...</div>
    </td></tr>`;
}

function renderCodesEmpty() {
  document.getElementById('codes-tbody').innerHTML = `
    <tr><td colspan="7">
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
        <p>No hay códigos de acceso</p>
        <span>Crea el primer código con el botón "Crear Código"</span>
      </div>
    </td></tr>`;
}

function renderCodesTable(codes) {
  const tbody = document.getElementById('codes-tbody');
  if (!codes.length) { renderCodesEmpty(); return; }

  tbody.innerHTML = codes.map(c => `
    <tr>
      <td>
        <span style="font-family:monospace;font-weight:600;letter-spacing:.5px;color:var(--accent)">${escHtml(c.codigo)}</span>
      </td>
      <td>${escHtml(c.descripcion || '—')}</td>
      <td>${planBadge(c.plan)}</td>
      <td>
        ${c.activo
          ? '<span class="badge badge-success badge-dot">Activo</span>'
          : '<span class="badge badge-danger badge-dot">Inactivo</span>'}
      </td>
      <td>
        <span style="font-weight:600">${c.usos_actuales}</span>
        <span style="color:var(--text-muted)"> / ${c.usos_maximos}</span>
      </td>
      <td>${formatDate(c.created_at)}</td>
      <td>
        <div class="td-actions">
          <button class="btn-copy" onclick="copyCode('${escHtml(c.codigo)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copiar
          </button>
          ${c.activo
            ? `<button class="btn-icon btn-warning btn-sm" onclick="toggleCode('${c.id}', false)">Desactivar</button>`
            : `<button class="btn-icon btn-success btn-sm" onclick="toggleCode('${c.id}', true)">Activar</button>`}
          <button class="btn-icon btn-danger btn-sm" onclick="confirmDeleteCode('${c.id}', '${escHtml(c.codigo)}')">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Copiar código
function copyCode(codigo) {
  navigator.clipboard.writeText(codigo).then(() => {
    toast('Código copiado', codigo, 'info');
  }).catch(() => {
    toast('No se pudo copiar', 'Copia manualmente el código', 'warning');
  });
}

// Activar / desactivar código
async function toggleCode(id, nuevoEstado) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  try {
    const { error } = await sb
      .from('codigos_acceso')
      .update({ activo: nuevoEstado })
      .eq('id', id);

    if (error) throw error;

    toast(nuevoEstado ? 'Código activado' : 'Código desactivado', '', nuevoEstado ? 'success' : 'warning');
    loadCodes();

  } catch (e) {
    toast('Error al actualizar código', e.message, 'error');
  }
}

// Confirmar eliminar código
function confirmDeleteCode(id, codigo) {
  document.getElementById('confirm-icon').className = 'confirm-icon danger';
  document.getElementById('confirm-icon').textContent = '✕';
  document.getElementById('confirm-title').textContent = '¿Eliminar este código?';
  document.getElementById('confirm-sub').innerHTML = `Se eliminará el código <strong>${codigo}</strong>. Esta acción no se puede deshacer.`;

  const btn = document.getElementById('btn-confirm-action');
  btn.className = 'btn-icon btn-danger';
  btn.textContent = 'Sí, eliminar';

  window._pendingAction = { accion: 'delete-code', codeId: id };
  openModal('modal-confirm');
}

async function executeConfirmDeleteCode(codeId) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const btn = document.getElementById('btn-confirm-action');
  btn.innerHTML = '<span class="btn-spinner"></span>';
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('codigos_acceso')
      .delete()
      .eq('id', codeId);

    if (error) throw error;

    closeModal('modal-confirm');
    toast('Código eliminado', '', 'error');
    loadCodes();

  } catch (e) {
    toast('Error al eliminar código', e.message, 'error');
  } finally {
    btn.innerHTML = 'Confirmar';
    btn.disabled = false;
    window._pendingAction = null;
  }
}

// Modal crear código
function openCreateCodeModal() {
  document.getElementById('form-create-code').reset();
  document.getElementById('code-preview-text').textContent = '';
  openModal('modal-create-code');
}

// Generador automático de código
function generateCode() {
  const chars   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const plan    = document.getElementById('new-plan').value;
  const code    = plan === 'premium'
    ? `NEG360-PREM-${segment(6)}`
    : `NEG360-${segment(4)}${segment(4)}`;

  document.getElementById('new-codigo').value = code;
  document.getElementById('code-preview-text').textContent = code;
}

// Crear código
async function createCode() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const codigo      = document.getElementById('new-codigo').value.trim();
  const descripcion = document.getElementById('new-descripcion').value.trim();
  const plan        = document.getElementById('new-plan').value;
  const usosMax     = parseInt(document.getElementById('new-usos').value, 10) || 1;

  if (!codigo) { toast('Campo requerido', 'El código no puede estar vacío', 'warning'); return; }

  const btn = document.getElementById('btn-save-code');
  btn.innerHTML = '<span class="btn-spinner"></span> Guardando...';
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('codigos_acceso')
      .insert({
        codigo,
        descripcion: descripcion || null,
        plan,
        activo: true,
        usos_maximos: usosMax,
        usos_actuales: 0,
      });

    if (error) throw error;

    closeModal('modal-create-code');
    toast('Código creado correctamente', codigo, 'success');
    loadCodes();

  } catch (e) {
    if (e.code === '23505') {
      toast('Código duplicado', 'Ya existe un código con ese nombre', 'warning');
    } else {
      toast('Error al crear código', e.message, 'error');
    }
  } finally {
    btn.innerHTML = 'Guardar Código';
    btn.disabled = false;
  }
}

// ============================================================
// SECCIÓN 4 — ATENCIÓN AL CLIENTE (CHAT)
// ============================================================

// Carga la lista de conversaciones y las cruza con los datos del usuario
async function loadConversaciones() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const listEl = document.getElementById('conv-list');
  if (listEl) listEl.innerHTML = '<div class="payment-empty">Cargando...</div>';

  try {
    const { data: convs, error } = await sb
      .from('conversaciones_chat')
      .select('*')
      .order('ultimo_mensaje_at', { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((convs || []).map(c => c.auth_user_id))];
    let usuariosMap = {};
    if (userIds.length) {
      const { data: usuarios } = await sb
        .from('usuarios')
        .select('auth_user_id, nombre, apellido, email, nombre_negocio')
        .in('auth_user_id', userIds);
      (usuarios || []).forEach(u => { usuariosMap[u.auth_user_id] = u; });
    }

    allConversaciones = (convs || []).map(c => ({
      ...c,
      _usuario: usuariosMap[c.auth_user_id] || null
    }));

    renderConvList();
    updateSoporteBadge();
    subscribeSoporteGlobal();

  } catch (e) {
    toast('Error al cargar conversaciones', e.message, 'error');
    if (listEl) listEl.innerHTML = '<div class="payment-empty">No se pudieron cargar las conversaciones</div>';
  }
}

function updateSoporteBadge() {
  const activas = allConversaciones.filter(c => c.estado === 'activa').length;
  const badge = document.getElementById('soporte-nav-badge');
  if (!badge) return;
  if (activas > 0) {
    badge.textContent = activas;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

function applyChatFilter(filter) {
  chatFilter = filter;
  $$('[data-chatfilter]').forEach(b => b.classList.toggle('active', b.dataset.chatfilter === filter));
  renderConvList();
}

function renderConvList() {
  const el = document.getElementById('conv-list');
  if (!el) return;

  const filtered = allConversaciones.filter(c =>
    chatFilter === 'activas' ? c.estado === 'activa' : c.estado === 'finalizada'
  );

  if (!filtered.length) {
    el.innerHTML = `<div class="payment-empty">${chatFilter === 'activas' ? 'No hay conversaciones activas' : 'No hay conversaciones finalizadas'}</div>`;
    return;
  }

  el.innerHTML = filtered.map(c => {
    const u = c._usuario;
    const nombre = u ? ([u.nombre, u.apellido].filter(Boolean).join(' ') || u.email) : 'Cliente';
    const initial = (nombre || 'C').charAt(0).toUpperCase();
    const selected = c.id === currentConvId ? 'selected' : '';
    return `
      <div class="conv-item ${selected}" onclick="selectConversation('${c.id}')">
        <div class="conv-item-avatar">${escHtml(initial)}</div>
        <div class="conv-item-info">
          <div class="conv-item-name">${escHtml(nombre)}</div>
          <div class="conv-item-preview">${u ? escHtml(u.nombre_negocio || u.email) : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span class="conv-item-dot ${c.estado}"></span>
          <span class="conv-item-time">${formatDateTimeShort(c.ultimo_mensaje_at)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Selecciona una conversación y carga sus mensajes
async function selectConversation(convId) {
  currentConvId = convId;
  soporteSeenIds = new Set();
  renderConvList();

  const conv = allConversaciones.find(c => c.id === convId);
  if (!conv) return;
  currentConvUsuario = conv._usuario;

  document.getElementById('soporte-empty').style.display = 'none';
  document.getElementById('soporte-active').style.display = 'flex';

  const nombre = currentConvUsuario
    ? ([currentConvUsuario.nombre, currentConvUsuario.apellido].filter(Boolean).join(' ') || currentConvUsuario.email)
    : 'Cliente';
  document.getElementById('chat-cliente-nombre').textContent = nombre;
  document.getElementById('chat-cliente-sub').textContent = currentConvUsuario
    ? (currentConvUsuario.nombre_negocio || currentConvUsuario.email || '')
    : '';

  document.getElementById('soporte-messages').innerHTML = '';
  setSoporteInputState(conv.estado === 'activa');

  await loadSoporteMessages(convId);
  subscribeSoporteConversacion(convId);
}

async function loadSoporteMessages(convId) {
  try {
    const { data, error } = await sb
      .from('mensajes_chat')
      .select('*')
      .eq('conversacion_id', convId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    (data || []).forEach(renderSoporteMessage);
  } catch (e) {
    toast('Error al cargar mensajes', e.message, 'error');
  }
}

function setSoporteInputState(activa) {
  document.getElementById('soporte-input-bar').style.display = activa ? 'flex' : 'none';
  document.getElementById('soporte-finalizada-banner').style.display = activa ? 'none' : 'block';
  const btnFinalizar = document.getElementById('btn-finalizar-chat');
  if (btnFinalizar) btnFinalizar.style.display = activa ? 'flex' : 'none';
}

function renderSoporteMessage(m) {
  if (soporteSeenIds.has(m.id)) return;
  soporteSeenIds.add(m.id);

  const row = document.createElement('div');
  row.className = 'chat-msg-row ' + m.remitente;

  let inner = '';
  if (m.tipo === 'texto') {
    inner = `<div>${escHtml(m.contenido).replace(/\n/g, '<br>')}</div>`;
  } else if (m.tipo === 'imagen') {
    inner = `<img src="${m.archivo_url}" alt="imagen" onclick="window.open('${m.archivo_url}','_blank')">`;
  } else if (m.tipo === 'documento') {
    inner = `<a class="doc-link" href="${m.archivo_url}" target="_blank" rel="noopener">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${escHtml(m.archivo_nombre || 'Documento')}
    </a>`;
  } else if (m.tipo === 'audio') {
    inner = `<audio controls src="${m.archivo_url}"></audio>`;
  }

  row.innerHTML = `<div><div class="chat-msg-bubble">${inner}</div><div class="chat-msg-time">${formatTime(m.created_at)}</div></div>`;
  const container = document.getElementById('soporte-messages');
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

async function sendAdminMessage() {
  const input = document.getElementById('soporte-input');
  const text = input.value.trim();
  if (!text || !currentConvId) return;

  const conv = allConversaciones.find(c => c.id === currentConvId);
  if (!conv || conv.estado !== 'activa') { toast('Esta conversación ya fue finalizada', '', 'warning'); return; }

  input.value = '';

  try {
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
      .from('mensajes_chat')
      .insert({
        conversacion_id: currentConvId,
        auth_user_id: conv.auth_user_id,
        remitente: 'admin',
        tipo: 'texto',
        contenido: text
      })
      .select()
      .single();
    if (error) throw error;
    renderSoporteMessage(data);
  } catch (e) {
    toast('No se pudo enviar el mensaje', e.message, 'error');
  }
}

// Botón "Finalizar conversación" — solo visible/usable por administradores
// (esta sección completa ya está protegida por verifyAdmin() al cargar la página)
function confirmFinalizarChat() {
  if (!currentConvId) return;

  document.getElementById('confirm-icon').className = 'confirm-icon danger';
  document.getElementById('confirm-icon').textContent = '✕';
  document.getElementById('confirm-title').textContent = '¿Finalizar esta conversación?';
  document.getElementById('confirm-sub').innerHTML = 'El cliente ya no podrá enviar más mensajes en esta conversación. Se eliminará automáticamente 72 horas después de finalizada. Si el cliente quiere hablar de nuevo, deberá iniciar una nueva conversación.';

  const btn = document.getElementById('btn-confirm-action');
  btn.className = 'btn-icon btn-danger';
  btn.textContent = 'Sí, finalizar';

  window._pendingAction = { accion: 'finalizar-chat', convId: currentConvId };
  openModal('modal-confirm');
}

async function executeFinalizarChat(convId) {
  const btn = document.getElementById('btn-confirm-action');
  btn.innerHTML = '<span class="btn-spinner"></span>';
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('conversaciones_chat')
      .update({ estado: 'finalizada', finalizada_at: new Date().toISOString() })
      .eq('id', convId);
    if (error) throw error;

    closeModal('modal-confirm');
    toast('Conversación finalizada', 'El cliente ya no puede enviar mensajes', 'success');

    const idx = allConversaciones.findIndex(c => c.id === convId);
    if (idx !== -1) allConversaciones[idx].estado = 'finalizada';

    if (currentConvId === convId) setSoporteInputState(false);

    renderConvList();
    updateSoporteBadge();

  } catch (e) {
    toast('Error al finalizar la conversación', e.message, 'error');
  } finally {
    btn.innerHTML = 'Confirmar';
    btn.disabled = false;
    window._pendingAction = null;
  }
}

// Realtime: nuevos mensajes en la conversación abierta
function subscribeSoporteConversacion(convId) {
  if (soporteMsgChannel) sb.removeChannel(soporteMsgChannel);
  if (soporteConvChannel) sb.removeChannel(soporteConvChannel);

  soporteMsgChannel = sb.channel('admin-msgs-' + convId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes_chat', filter: `conversacion_id=eq.${convId}` },
      payload => renderSoporteMessage(payload.new))
    .subscribe();

  soporteConvChannel = sb.channel('admin-conv-' + convId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversaciones_chat', filter: `id=eq.${convId}` },
      payload => {
        const idx = allConversaciones.findIndex(c => c.id === convId);
        if (idx !== -1) allConversaciones[idx].estado = payload.new.estado;
        if (currentConvId === convId) setSoporteInputState(payload.new.estado === 'activa');
        renderConvList();
      })
    .subscribe();
}

// Realtime: nuevas conversaciones / cambios generales (para refrescar la lista y el badge)
function subscribeSoporteGlobal() {
  if (soporteGlobalChannel) return; // ya suscrito
  soporteGlobalChannel = sb.channel('admin-conv-global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversaciones_chat' },
      () => loadConversaciones())
    .subscribe();
}

// ── CONFIRM DISPATCHER ─────────────────────────────────────
async function dispatchConfirm() {
  const pending = window._pendingAction;
  if (!pending) return;

  if (pending.accion === 'delete-code') {
    await executeConfirmDeleteCode(pending.codeId);
  } else if (pending.accion === 'finalizar-chat') {
    await executeFinalizarChat(pending.convId);
  } else if (pending.accion === 'marcar-pagado') {
    await executeMarkAsPaid(pending.userId, pending.cicloAPagar);
  } else {
    await executeConfirmAction();
  }
}

// ── UTILIDADES ─────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  } catch { return '—'; }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatDateTimeShort(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch { return ''; }
}

function estadoBadge(estado) {
  const map = {
    activa:     '<span class="badge badge-success badge-dot">Activa</span>',
    suspendida: '<span class="badge badge-warning badge-dot">Suspendida</span>',
    cancelada:  '<span class="badge badge-danger badge-dot">Cancelada</span>',
  };
  return map[estado] || `<span class="badge">${escHtml(estado || '—')}</span>`;
}

function planBadge(plan) {
  const map = {
    prueba:  '<span class="badge badge-info">Prueba</span>',
    premium: '<span class="badge badge-purple">Premium</span>',
  };
  return map[plan] || `<span class="badge">${escHtml(plan || '—')}</span>`;
}

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  const ok = await verifyAdmin();
  if (!ok) return;

  populateHeader();

  // Evento: cerrar sesión
  document.getElementById('btn-logout').addEventListener('click', signOut);

  // Evento: toggle theme
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Evento: toggle sidebar mobile
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  });

  // Evento: navegación
  $$('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.section));
  });

  // Evento: búsqueda usuarios
  document.getElementById('user-search').addEventListener('input', filterAndSearch);

  // Evento: filtros usuarios
  $$('#page-users .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => applyUserFilter(btn.dataset.filter));
  });

  // Evento: filtros de conversaciones (Activas / Finalizadas)
  $$('[data-chatfilter]').forEach(btn => {
    btn.addEventListener('click', () => applyChatFilter(btn.dataset.chatfilter));
  });

  // Evento: enviar mensaje de soporte
  document.getElementById('btn-send-admin').addEventListener('click', sendAdminMessage);
  document.getElementById('soporte-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendAdminMessage(); }
  });

  // Evento: finalizar conversación (solo visible para administradores autenticados)
  document.getElementById('btn-finalizar-chat').addEventListener('click', confirmFinalizarChat);

  // Evento: cerrar modales con X
  $$('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.remove('open'));
  });

  // Evento: cerrar modal al hacer clic fuera
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Evento: confirmar acción
  document.getElementById('btn-confirm-action').addEventListener('click', dispatchConfirm);

  // Evento: cancelar confirmación
  document.getElementById('btn-cancel-confirm').addEventListener('click', () => {
    closeModal('modal-confirm');
    window._pendingAction = null;
  });

  // Evento: botón crear código
  document.getElementById('btn-new-code').addEventListener('click', openCreateCodeModal);

  // Evento: generar código automático
  document.getElementById('btn-generate-code').addEventListener('click', generateCode);

  // Evento: preview de código al escribir
  document.getElementById('new-codigo').addEventListener('input', (e) => {
    document.getElementById('code-preview-text').textContent = e.target.value.trim();
  });

  // Evento: guardar código
  document.getElementById('btn-save-code').addEventListener('click', createCode);

  // Cargar página inicial
  navigate('dashboard');

  // Ocultar loader
  hideLoader();
});
