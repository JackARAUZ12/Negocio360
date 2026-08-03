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

// Las sucursales y bodegas son cuentas internas (creadas automáticamente
// por el módulo Sucursales) — nunca son clientes que pagan, así que se
// excluyen de la lista y las estadísticas de usuarios/clientes. Se pide
// una sola vez y se reutiliza el mismo resultado durante la sesión.
let _idsSucursalesShadowCache = null;
async function obtenerIdsSucursalesShadow() {
  if (_idsSucursalesShadowCache) return _idsSucursalesShadowCache;
  try {
    const { data, error } = await sb.rpc('listar_auth_ids_sucursales_shadow');
    if (error) throw error;
    _idsSucursalesShadowCache = new Set((data || []).map(r => r.auth_user_id));
  } catch (e) {
    console.warn('obtenerIdsSucursalesShadow:', e);
    _idsSucursalesShadowCache = new Set(); // ante cualquier falla, no se excluye nada (no se rompe el panel)
  }
  return _idsSucursalesShadowCache;
}

// ── CONFIGURACIÓN DE COBRO ─────────────────────────────────
// Precio mensual del plan Premium usado en el comprobante de pago.
// Cambia este valor si el precio de la suscripción cambia.
const PRECIO_PREMIUM_USD = 10.00;

// Precio a cobrar a un cliente puntual: su precio personalizado si el
// admin le asignó uno, o el precio por defecto del plan si no.
function precioDe(u) {
  return (u.precio_personalizado !== null && u.precio_personalizado !== undefined && u.precio_personalizado !== '')
    ? Number(u.precio_personalizado)
    : PRECIO_PREMIUM_USD;
}

// Etiqueta legible del ciclo de facturación de un cliente.
function cicloLabel(u) {
  if (u.ciclo_facturacion === 'anual') return 'Anual';
  if (u.ciclo_facturacion === 'unico') return 'Pago único';
  return 'Mensual';
}

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
  if (section === 'anuncios')  loadAnunciosSection();
  if (section === 'encuestas') cargarResultadosEncuesta();
  if (section === 'notificaciones') loadNotificacionesSection();
  if (section === 'chats-grupales') loadChatsGrupales();
  if (section === 'auditoria-global') loadAuditoriaGlobal();
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
    const { data: usuariosCrudo, error } = await sb
      .from('usuarios')
      .select('id, auth_user_id, nombre, apellido, email, estado_cuenta, plan, created_at, fecha_ultimo_pago');

    if (error) throw error;

    // Las sucursales/bodegas de los clientes no son cuentas que pagan
    // — se excluyen antes de calcular cualquier estadística.
    const idsShadow = await obtenerIdsSucursalesShadow();
    const usuarios = usuariosCrudo.filter(u => !idsShadow.has(u.auth_user_id));

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
// (created_at). Esa misma fecha es el "día de pago" desde el primer mes
// (SIN período de gracia: el cobro corre desde el día del registro).
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

// Igual que calcDueDateForMonth pero para ciclo ANUAL: conserva el mismo
// día/mes de registro, repitiéndolo una vez al año en el "year" dado.
function calcDueDateForYear(regDate, year) {
  const month = regDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dueDay = Math.min(regDate.getDate(), daysInMonth);
  return new Date(year, month, dueDay);
}

// Índice absoluto de mes (año*12 + mes), útil para comparar "cuál ciclo
// es más reciente" sin preocuparse por el día exacto.
function monthIndex(d) {
  return d.getFullYear() * 12 + d.getMonth();
}

// Índice de ciclo comparable, según el ciclo de facturación del cliente:
// mensual → índice de mes; anual → año. "unico" no tiene ciclo (se maneja
// aparte en getCicloAPagar/getPaymentInfo).
function cicloIndexOf(u, date) {
  return u.ciclo_facturacion === 'anual' ? date.getFullYear() : monthIndex(date);
}

// Fecha de vencimiento del ciclo correspondiente a "today", según el
// ciclo de facturación del cliente (mensual por defecto, o anual).
function getCurrentCycleDueDate(u, today) {
  if (!u.created_at) return null;
  const reg = new Date(u.created_at);
  const t = new Date(today);
  if (u.ciclo_facturacion === 'anual') {
    return calcDueDateForYear(reg, t.getFullYear());
  }
  return calcDueDateForMonth(reg, t.getFullYear(), t.getMonth());
}

// Ciclo inmediatamente siguiente a una fecha de vencimiento dada, según el
// ciclo de facturación del cliente. A diferencia de getNextCycleDueDate,
// no parte de "hoy" sino de cualquier fecha de vencimiento que le pases,
// así se puede encadenar para calcular varios ciclos hacia adelante
// (pagos adelantados).
function getNextCycleAfter(u, dueDate) {
  if (!dueDate) return null;
  const reg = new Date(u.created_at);
  if (u.ciclo_facturacion === 'anual') {
    return calcDueDateForYear(reg, dueDate.getFullYear() + 1);
  }
  const nextMonthIndex = dueDate.getMonth() + 1;
  const year  = dueDate.getFullYear() + Math.floor(nextMonthIndex / 12);
  const month = ((nextMonthIndex % 12) + 12) % 12;
  return calcDueDateForMonth(reg, year, month);
}

// Fecha de vencimiento del ciclo siguiente al ciclo actual (un ciclo
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
//
// Si el cliente es de "pago único" (ciclo_facturacion = 'unico'), no hay
// ciclos que se repitan: una vez que fecha_ultimo_pago tiene algún valor,
// ya no hay nada más que cobrar (se devuelve null para siempre). Si nunca
// se ha pagado, el "ciclo a pagar" es la fecha de registro (vence de
// inmediato, como un pago pendiente desde el día 1).
function getCicloAPagar(u, today) {
  if (!u.created_at) return null;

  if (u.ciclo_facturacion === 'unico') {
    if (u.fecha_ultimo_pago) return null; // ya se pagó una vez: nunca más
    const reg = new Date(u.created_at);
    reg.setHours(0, 0, 0, 0);
    return reg;
  }

  let candidate = getCurrentCycleDueDate(u, today);
  if (!candidate) return null;

  if (u.fecha_ultimo_pago) {
    const pago = new Date(u.fecha_ultimo_pago + 'T00:00:00');
    while (cicloIndexOf(u, pago) >= cicloIndexOf(u, candidate)) {
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

  const t = new Date(today);
  t.setHours(0, 0, 0, 0);

  // "Pago único" (de por vida): si ya se pagó alguna vez, esta cuenta
  // nunca vuelve a aparecer como pendiente. Si nunca se ha pagado, se
  // trata como vencido desde el día de registro (sin ciclos que se
  // repitan cada mes/año).
  if (u.ciclo_facturacion === 'unico') {
    if (u.fecha_ultimo_pago) return null;
    const dueDate = new Date(u.created_at);
    dueDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((t - dueDate) / 86400000);
    if (u.estado_cuenta === 'suspendida') {
      return { status: 'atrasado', dueDate, diffDays: Math.max(diffDays, 0) };
    }
    if (diffDays < -3) return null;
    if (diffDays < 0)   return { status: 'proximo',   dueDate, diffDays };
    if (diffDays <= 1)  return { status: 'pendiente', dueDate, diffDays };
    return { status: 'atrasado', dueDate, diffDays };
  }

  // Sin período de gracia para nadie: el primer "día de pago" es el mismo
  // día del registro (esa fecha se repite cada ciclo en adelante). Antes se
  // ignoraba por completo el primer mes asumiendo "se pagó al registrarse",
  // pero el negocio cobra desde el inicio, así que ese descuento se quita.
  const dueDate = getCurrentCycleDueDate(u, t);
  if (!dueDate) return null;

  // ¿Ya se marcó como pagado (o adelantado) el ciclo que corresponde a
  // este vencimiento? Se compara por ciclo (mes o año, según corresponda),
  // no por igualdad exacta, para que un pago adelantado cubra también el
  // ciclo anterior.
  if (u.fecha_ultimo_pago) {
    const pago = new Date(u.fecha_ultimo_pago + 'T00:00:00');
    if (cicloIndexOf(u, pago) >= cicloIndexOf(u, dueDate)) {
      return null; // este ciclo (o uno posterior) ya está cubierto
    }
  }

  const diffDays = Math.round((t - dueDate) / 86400000);

  // Una cuenta SUSPENDIDA ya es, por definición, un pago sin resolver
  // (se suspende justamente por falta de pago) — se muestra siempre en
  // "Atrasados", sin importar cuántos días exactos han pasado.
  if (u.estado_cuenta === 'suspendida') {
    return { status: 'atrasado', dueDate, diffDays: Math.max(diffDays, 0) };
  }

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
      label: e.diffDays > 0 ? `${e.diffDays}d atraso` : 'Atrasado',
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
      .select('id, auth_user_id, nombre, apellido, nombre_negocio, email, telefono, estado_cuenta, plan, fecha_vencimiento, fecha_ultimo_pago, onboarding_completado, created_at, ultima_conexion, ciclo_facturacion, precio_personalizado')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Igual que en las estadísticas: las sucursales/bodegas internas
    // nunca aparecen en esta lista, no son clientes que pagan.
    const idsShadow = await obtenerIdsSucursalesShadow();
    allUsers = (data || []).filter(u => !idsShadow.has(u.auth_user_id));
    renderUsersTable(allUsers);

  } catch (e) {
    toast('Error al cargar usuarios', e.message, 'error');
    renderUsersEmpty();
  }
}

function showUsersLoader() {
  document.getElementById('users-tbody').innerHTML = `
    <tr><td colspan="12" style="text-align:center; padding:48px; color:var(--text-muted)">
      <div class="loader-spinner" style="margin:0 auto 12px"></div>
      <div>Cargando usuarios...</div>
    </td></tr>`;
}

function renderUsersEmpty() {
  document.getElementById('users-tbody').innerHTML = `
    <tr><td colspan="12">
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
      <td>${u.plan === 'premium'
            ? `<span class="badge badge-info">${escHtml(cicloLabel(u))}</span><br><span style="font-size:11px;color:var(--text-muted)">$${precioDe(u).toFixed(2)}</span>`
            : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${estadoBadge(u.estado_cuenta)}</td>
      <td>${conexionBadge(u.ultima_conexion)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td>${u.fecha_ultimo_pago ? formatDate(u.fecha_ultimo_pago) : '<span style="color:var(--text-muted)">Sin registro</span>'}</td>
      <td>
        <div class="td-actions">
          <button class="btn-icon btn-ghost btn-sm" onclick="viewUser('${u.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Ver
          </button>
          ${u.plan === 'premium'
            ? `<button class="btn-icon btn-ghost btn-sm" onclick="openEditBilling('${u.id}')" title="Editar ciclo de facturación y precio de este cliente">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Editar
              </button>`
            : ''}
          ${u.plan === 'premium'
            ? `<div class="marcar-pagado-wrap">
                <button class="btn-icon btn-primary btn-sm" onclick="openConfirmMarkPaid('${u.id}')" title="Marcar que ya pagó (o adelantó) su próximo mes y enviarle el comprobante">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  Marcar Pagado
                </button>
                ${u.created_at ? `<span class="next-pago-hint">Próx. pago: ${getCicloAPagar(u, today) ? formatDate(getCicloAPagar(u, today)) : 'N/A (pago único ya cubierto)'}</span>` : ''}
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
// EDITAR FACTURACIÓN DE UN CLIENTE (ciclo + precio personalizado)
// ============================================================
function actualizarPreviewBilling() {
  const u = window._editingBillingUser;
  if (!u) return;
  const cicloSel = document.getElementById('eb-ciclo').value;
  const uPreview = { ...u, ciclo_facturacion: cicloSel };
  const previewEl = document.getElementById('eb-preview');

  if (cicloSel === 'unico') {
    if (u.fecha_ultimo_pago) {
      previewEl.textContent = 'Ya se pagó — no habrá más pagos para este cliente';
    } else {
      previewEl.textContent = `Pendiente desde ${formatDate(u.created_at)} (pago único)`;
    }
    return;
  }

  const today = new Date();
  const ciclo = getCicloAPagar(uPreview, today);
  previewEl.textContent = ciclo ? formatDate(ciclo) : '—';
}

function openEditBilling(userId) {
  const u = allUsers.find(x => x.id === userId);
  if (!u) return;

  window._editingBillingUser = u;
  document.getElementById('eb-nombre-cliente').textContent =
    [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || 'Cliente';
  document.getElementById('eb-ciclo').value = u.ciclo_facturacion || 'mensual';
  document.getElementById('eb-precio').value = (u.precio_personalizado !== null && u.precio_personalizado !== undefined)
    ? Number(u.precio_personalizado) : '';
  document.getElementById('eb-precio').placeholder = `Precio por defecto ($${PRECIO_PREMIUM_USD.toFixed(2)})`;

  actualizarPreviewBilling();
  openModal('modal-edit-billing');
}

async function guardarEditBilling() {
  const u = window._editingBillingUser;
  if (!u) return;

  const ciclo = document.getElementById('eb-ciclo').value;
  const precioRaw = document.getElementById('eb-precio').value.trim();
  const precio = precioRaw === '' ? null : Number(precioRaw);

  if (precio !== null && (isNaN(precio) || precio < 0)) {
    toast('Precio inválido', 'Ingresa un número mayor o igual a cero, o deja el campo vacío.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-guardar-billing');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span>';

  try {
    const { error } = await sb
      .from('usuarios')
      .update({ ciclo_facturacion: ciclo, precio_personalizado: precio })
      .eq('id', u.id);
    if (error) throw error;

    // Actualizar copia local sin recargar toda la tabla
    const idx = allUsers.findIndex(x => x.id === u.id);
    if (idx !== -1) {
      allUsers[idx].ciclo_facturacion = ciclo;
      allUsers[idx].precio_personalizado = precio;
    }

    closeModal('modal-edit-billing');
    toast('Facturación actualizada', `Se guardaron los cambios de ${u.nombre || u.email}`, 'success');
    filterAndSearch();
  } catch (e) {
    console.error('guardarEditBilling:', e);
    toast('Error al guardar', e.message || 'Intenta de nuevo', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
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
  const mesPagadoTexto = u.ciclo_facturacion === 'unico'
    ? 'pago único'
    : (cicloAPagar ? formatMesAnio(cicloAPagar) : formatMesAnio(today));
  const esUnico        = u.ciclo_facturacion === 'unico';
  const nextDue        = (!esUnico && cicloAPagar) ? getNextCycleAfter(u, cicloAPagar) : null;

  document.getElementById('confirm-icon').className = 'confirm-icon success';
  document.getElementById('confirm-icon').textContent = '✓';
  document.getElementById('confirm-title').textContent = '¿Confirmar pago recibido?';
  document.getElementById('confirm-sub').innerHTML =
    `Se registrará el pago de <strong>${escHtml(nombreCompleto)}</strong> correspondiente a <strong>${escHtml(mesPagadoTexto)}</strong> por <strong>$${precioDe(u).toFixed(2)} USD</strong>.<br><br>` +
    `Se le enviará automáticamente un comprobante en su chat de soporte.` +
    (esUnico ? `<br>Al ser un <strong>pago único</strong>, este cliente no volverá a aparecer como pendiente de pago.`
             : (nextDue ? `<br>Su próximo pago será el <strong>${escHtml(formatDate(nextDue))}</strong>.` : ''));

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
    const mesPagadoTexto = u.ciclo_facturacion === 'unico' ? 'pago único' : formatMesAnio(cicloDueDate);
    const nextDue        = u.ciclo_facturacion === 'unico' ? null : getNextCycleAfter(u, cicloDueDate);
    const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || 'Cliente';

    const { blob, filename } = generarComprobantePDF({
      nombreCompleto,
      email: u.email,
      negocio: u.nombre_negocio,
      mesPagadoTexto,
      fechaPago: today,
      monto: precioDe(u),
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
/* ══════════════════════════════════════════
   ANUNCIOS DEL SISTEMA
   Permite lanzar un aviso de novedades a todos los usuarios
   desde el Panel de Administración, sin tocar código. Cada
   usuario lo ve una sola vez (tabla anuncios_vistos, que llena
   dashboard.html). Al lanzar uno nuevo, se desactivan los
   anteriores para que solo exista un anuncio activo a la vez.
   ══════════════════════════════════════════ */
let anuncioItemsCount = 0;

function renderAnuncioItemRow(valor = '') {
  anuncioItemsCount++;
  const id = `anuncio-item-${anuncioItemsCount}`;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
  wrap.innerHTML = `
    <input type="text" class="form-control anuncio-item-input" id="${id}" value="${valor.replace(/"/g,'&quot;')}" placeholder="Ej: Ya puedes importar clientes masivamente desde Excel" />
    <button type="button" class="btn-icon btn-ghost" onclick="this.parentElement.remove()">✕</button>
  `;
  document.getElementById('anuncio-form-items').appendChild(wrap);
}
function agregarItemAnuncio() { renderAnuncioItemRow(); }

function limpiarFormAnuncio() {
  document.getElementById('anuncio-form-titulo').value = '';
  document.getElementById('anuncio-form-items').innerHTML = '';
  anuncioItemsCount = 0;
  renderAnuncioItemRow();
  renderAnuncioItemRow();
}

async function loadAnunciosSection() {
  limpiarFormAnuncio();
  await renderAnuncioActivoPreview();
}

let anuncioActivoActual = null;

async function renderAnuncioActivoPreview() {
  const el = document.getElementById('anuncio-activo-preview');
  const btnVerLectores = document.getElementById('btn-ver-lectores-anuncio');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--text-muted)">Cargando…</p>';
  if (btnVerLectores) btnVerLectores.style.display = 'none';
  try {
    const { data, error } = await sb.from('anuncios_sistema')
      .select('*').eq('activo', true).order('created_at', { ascending:false }).limit(1).maybeSingle();
    if (error) throw error;
    anuncioActivoActual = data || null;
    if (!data) { el.innerHTML = '<p style="color:var(--text-muted)">No hay ningún anuncio activo en este momento.</p>'; return; }

    if (btnVerLectores) btnVerLectores.style.display = 'inline-flex';

    const items = Array.isArray(data.items) ? data.items : [];
    el.innerHTML = `
      <div style="font-weight:700;font-size:15px;margin-bottom:10px">${escAnuncio(data.titulo)}</div>
      <ul style="margin:0;padding-left:18px;color:var(--text-secondary)">
        ${items.map(i => `<li style="margin-bottom:6px">${escAnuncio(i)}</li>`).join('')}
      </ul>
      <div style="margin-top:14px;font-size:12px;color:var(--text-muted)">
        Lanzado el ${new Date(data.created_at).toLocaleString('es-NI')}${data.created_by ? ' · por ' + escAnuncio(data.created_by) : ''}
      </div>`;
  } catch (e) {
    el.innerHTML = '<p style="color:var(--text-muted)">No se pudo cargar el anuncio activo.</p>';
    console.error('renderAnuncioActivoPreview:', e);
  }
}

function escAnuncio(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function lanzarAnuncio() {
  const titulo = document.getElementById('anuncio-form-titulo').value.trim();
  const items = Array.from(document.querySelectorAll('.anuncio-item-input'))
    .map(i => i.value.trim()).filter(Boolean);

  if (!titulo) { toast('Falta el título', 'Escribe un título para el anuncio', 'warning'); return; }
  if (!items.length) { toast('Falta al menos un punto', 'Agrega al menos un punto al anuncio', 'warning'); return; }

  const btn = event?.target?.closest('button');
  if (btn) btn.disabled = true;

  try {
    const { data: { user } } = await sb.auth.getUser();

    // Solo puede existir un anuncio activo a la vez: se desactivan los anteriores.
    await sb.from('anuncios_sistema').update({ activo: false }).eq('activo', true);

    const { error } = await sb.from('anuncios_sistema').insert({
      titulo, items, activo: true, created_by: user?.email || null,
    });
    if (error) throw error;

    toast('Anuncio lanzado', 'Todos los usuarios lo verán la próxima vez que entren al Dashboard', 'success');
    limpiarFormAnuncio();
    await renderAnuncioActivoPreview();
  } catch (e) {
    console.error('lanzarAnuncio:', e);
    toast('Error al lanzar el anuncio', e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── ENCUESTAS (satisfacción del usuario, 1-5 estrellas) ────────────
async function publicarEncuesta() {
  const pregunta = document.getElementById('encuesta-form-pregunta').value.trim();
  if (!pregunta) { toast('Falta la pregunta', 'Escribe la pregunta de la encuesta', 'warning'); return; }

  const btn = event?.target?.closest('button');
  if (btn) btn.disabled = true;

  try {
    const { data: { user } } = await sb.auth.getUser();

    // Solo puede existir una encuesta activa a la vez.
    await sb.from('encuestas_sistema').update({ activa: false }).eq('activa', true);

    const { error } = await sb.from('encuestas_sistema').insert({
      pregunta, activa: true, created_by: user?.email || null,
    });
    if (error) throw error;

    toast('Encuesta publicada', 'Los usuarios la verán la próxima vez que entren al Dashboard', 'success');
    document.getElementById('encuesta-form-pregunta').value = '';
    await cargarResultadosEncuesta();
  } catch (e) {
    console.error('publicarEncuesta:', e);
    toast('Error al publicar la encuesta', e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function cargarResultadosEncuesta() {
  const cont = document.getElementById('encuesta-resultados');
  if (!cont) return;
  cont.innerHTML = '<p style="color:var(--text-muted)">Cargando…</p>';
  try {
    const { data: encuesta, error } = await sb.from('encuestas_sistema')
      .select('id,pregunta,created_at').eq('activa', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!encuesta) { cont.innerHTML = '<p style="color:var(--text-muted)">No hay ninguna encuesta activa en este momento.</p>'; return; }

    const { data: respuestas, error: errR } = await sb.from('encuestas_respuestas')
      .select('estrellas, comentario, created_at').eq('encuesta_id', encuesta.id)
      .order('created_at', { ascending: false });
    if (errR) throw errR;

    const lista = respuestas || [];
    const calificadas = lista.filter(r => r.estrellas != null);
    const soloAceptaron = lista.length - calificadas.length;
    const promedio = calificadas.length
      ? (calificadas.reduce((s, r) => s + r.estrellas, 0) / calificadas.length)
      : 0;
    const distribucion = [5, 4, 3, 2, 1].map(n => calificadas.filter(r => r.estrellas === n).length);
    const maxDist = Math.max(1, ...distribucion);

    const comentarios = calificadas.filter(r => r.comentario && r.comentario.trim());

    cont.innerHTML = `
      <div style="margin-bottom:18px">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${escHtml(encuesta.pregunta)}</div>
        <div style="font-size:12px;color:var(--text-muted)">Publicada el ${formatDate(encuesta.created_at)}</div>
      </div>

      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;margin-bottom:20px">
        <div style="text-align:center">
          <div style="font-size:36px;font-weight:800;color:#F5A623">${promedio.toFixed(1)}<span style="font-size:18px;color:var(--text-muted)">/5</span></div>
          <div style="font-size:11px;color:var(--text-muted)">${calificadas.length} calificación${calificadas.length===1?'':'es'}</div>
        </div>
        <div style="flex:1;min-width:200px">
          ${[5,4,3,2,1].map((n,i) => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:11.5px;color:var(--text-muted);width:34px">${n} ★</span>
              <div style="flex:1;height:8px;background:var(--bg-hover,#eee);border-radius:100px;overflow:hidden">
                <div style="width:${(distribucion[i]/maxDist*100)}%;height:100%;background:#F5A623"></div>
              </div>
              <span style="font-size:11.5px;color:var(--text-muted);width:20px;text-align:right">${distribucion[i]}</span>
            </div>`).join('')}
        </div>
      </div>

      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">
        ${soloAceptaron} usuario${soloAceptaron===1?'':'s'} presionó "Aceptar" sin calificar.
      </div>

      <div style="font-weight:700;font-size:13px;margin-bottom:8px">Comentarios (${comentarios.length})</div>
      <div style="display:flex;flex-direction:column;gap:10px;max-height:320px;overflow-y:auto">
        ${comentarios.length ? comentarios.map(r => `
          <div style="padding:10px 12px;background:var(--bg-hover,#f7f7fa);border-radius:8px">
            <div style="color:#F5A623;font-size:13px;margin-bottom:4px">${'★'.repeat(r.estrellas)}${'☆'.repeat(5-r.estrellas)}</div>
            <div style="font-size:13px;color:var(--text-secondary)">${escHtml(r.comentario)}</div>
          </div>`).join('') : '<p style="color:var(--text-muted);font-size:12.5px">Todavía no hay comentarios.</p>'}
      </div>
    `;
  } catch (e) {
    console.error('cargarResultadosEncuesta:', e);
    cont.innerHTML = '<p style="color:var(--text-muted)">No se pudieron cargar los resultados.</p>';
  }
}

// ── NOTIFICACIONES (feed de actualizaciones para los clientes) ─────
const NOTIF_TIPO_LABEL = {
  actualizacion:  { label: 'Actualización',  cls: 'badge-info' },
  nueva_funcion:  { label: 'Nueva función',  cls: 'badge-success' },
  mantenimiento:  { label: 'Mantenimiento',  cls: 'badge-warning' },
  aviso:          { label: 'Aviso',          cls: 'badge-purple' },
  urgente:        { label: 'Urgente',        cls: 'badge-danger' },
};

async function loadNotificacionesSection() {
  const tbody = document.getElementById('notificaciones-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted)">
    <div class="loader-spinner" style="margin:0 auto 10px"></div>Cargando…</td></tr>`;
  try {
    const { data, error } = await sb.from('notificaciones')
      .select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    renderNotificacionesTabla(data || []);
  } catch (e) {
    console.error('loadNotificacionesSection:', e);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted)">
      No se pudo cargar el historial de notificaciones.</td></tr>`;
  }
}

function renderNotificacionesTabla(items) {
  const tbody = document.getElementById('notificaciones-tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted)">
      Aún no has publicado ninguna notificación.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(n => {
    const tipo = NOTIF_TIPO_LABEL[n.tipo] || { label: n.tipo, cls: 'badge' };
    return `
      <tr>
        <td>
          <div style="font-weight:600">${escHtml(n.titulo)}</div>
          <div style="font-size:12px;color:var(--text-muted);max-width:420px;white-space:normal">${escHtml(n.mensaje)}</div>
        </td>
        <td><span class="badge ${tipo.cls}">${escHtml(tipo.label)}</span></td>
        <td>${formatDateTimeShort(n.created_at)}<div style="font-size:11px;color:var(--text-muted)">${escHtml(n.creado_por || '')}</div></td>
        <td>
          <button class="btn-icon btn-ghost btn-sm" onclick="abrirVerLectoresNotificacion('${n.id}', '${escHtml(n.titulo).replace(/'/g,"\\'")}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Ver lectores
          </button>
          <button class="btn-icon btn-danger btn-sm" onclick="eliminarNotificacion('${n.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Eliminar
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function publicarNotificacion() {
  const titulo  = document.getElementById('notif-form-titulo').value.trim();
  const mensaje = document.getElementById('notif-form-mensaje').value.trim();
  const tipo    = document.getElementById('notif-form-tipo').value;

  if (!titulo)  { toast('Falta el título', 'Escribe un título para la notificación', 'warning'); return; }
  if (!mensaje) { toast('Falta el mensaje', 'Escribe el contenido de la notificación', 'warning'); return; }

  const btn = event?.target?.closest('button');
  if (btn) btn.disabled = true;

  try {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('notificaciones').insert({
      titulo, mensaje, tipo, creado_por: user?.email || null,
    });
    if (error) throw error;

    toast('Notificación publicada', 'Todos los usuarios la verán en su módulo de Notificaciones', 'success');
    document.getElementById('notif-form-titulo').value = '';
    document.getElementById('notif-form-mensaje').value = '';
    document.getElementById('notif-form-tipo').value = 'actualizacion';
    await loadNotificacionesSection();
  } catch (e) {
    console.error('publicarNotificacion:', e);
    toast('Error al publicar', e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ══════════════════════════════════════════
   AUDITORÍA GLOBAL — movimientos de TODAS las cuentas del
   sistema, con retención de 24 horas (se borran solos via
   pg_cron; aquí solo se lee, nunca se inserta ni se borra
   manualmente).
   ══════════════════════════════════════════ */
let AG_STATE = { registros: [] };
const AG_ACCION_LABEL = { INSERT: 'Creó', UPDATE: 'Editó', DELETE: 'Eliminó' };

async function loadAuditoriaGlobal() {
  const tbody = document.getElementById('auditoria-global-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">Cargando…</td></tr>`;
  try {
    const { data, error } = await sb.from('auditoria_log').select('*')
      .order('created_at', { ascending: false }).limit(2000);
    if (error) throw error;
    // Las sucursales/bodegas internas nunca deben aparecer aquí — no
    // son clientes, son cuentas técnicas creadas por el propio cliente.
    const idsShadow = await obtenerIdsSucursalesShadow();
    const registros = (data || []).filter(r => !idsShadow.has(r.auth_user_id));

    // Un solo query para traer el nombre de negocio/correo de cada
    // cuenta involucrada (evita N consultas, una por registro).
    const ids = [...new Set(registros.map(r => r.auth_user_id).filter(Boolean))];
    let usuariosMap = new Map();
    if (ids.length) {
      const { data: usuarios } = await sb.from('usuarios')
        .select('auth_user_id, nombre_negocio, email, nombre').in('auth_user_id', ids);
      usuariosMap = new Map((usuarios || []).map(u => [u.auth_user_id, u]));
    }

    AG_STATE.registros = registros.map(r => {
      const u = usuariosMap.get(r.auth_user_id);
      return { ...r, negocio: u?.nombre_negocio || u?.email || 'Cuenta eliminada' };
    });

    poblarFiltroCuentasGlobal();
    renderTablaAuditoriaGlobal();
    renderStatsAuditoriaGlobal();
  } catch (e) {
    console.error('loadAuditoriaGlobal:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">No se pudo cargar la auditoría</td></tr>`;
  }
}

function poblarFiltroCuentasGlobal() {
  const sel = document.getElementById('ag-filtro-cuenta');
  if (!sel) return;
  const cuentas = [...new Set(AG_STATE.registros.map(r => r.negocio))].sort();
  const actual = sel.value;
  sel.innerHTML = `<option value="">Todas las cuentas</option>` +
    cuentas.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  if (cuentas.includes(actual)) sel.value = actual;
}

function renderTablaAuditoriaGlobal() {
  const tbody = document.getElementById('auditoria-global-tbody');
  if (!tbody) return;
  const filtroCuenta = document.getElementById('ag-filtro-cuenta')?.value || '';
  const filtroAccion = document.getElementById('ag-filtro-accion')?.value || '';
  const q = (document.getElementById('ag-search')?.value || '').toLowerCase().trim();

  const filtrados = AG_STATE.registros.filter(r => {
    if (filtroCuenta && r.negocio !== filtroCuenta) return false;
    if (filtroAccion && r.accion !== filtroAccion) return false;
    if (q && !`${r.negocio} ${r.modulo} ${r.resumen||''}`.toLowerCase().includes(q)) return false;
    return true;
  }).slice(0, 300); // límite razonable para no saturar la tabla en pantalla

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">Sin movimientos con estos filtros</td></tr>`;
    return;
  }
  tbody.innerHTML = filtrados.map(r => `
    <tr>
      <td>${formatDate(r.created_at)}</td>
      <td>${formatTime(r.created_at)}</td>
      <td style="font-weight:600">${escHtml(r.negocio)}</td>
      <td>${escHtml(r.perfil_nombre)}${r.perfil_tipo==='admin' ? ' <span style="font-size:10px;color:var(--text-muted)">(admin)</span>' : ''}</td>
      <td>${escHtml(r.modulo)}</td>
      <td>${AG_ACCION_LABEL[r.accion] || escHtml(r.accion)}</td>
      <td style="font-size:12.5px;color:var(--text-secondary)">${escHtml(r.resumen || '—')}</td>
    </tr>`).join('');
}

function renderStatsAuditoriaGlobal() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('ag-stat-total', AG_STATE.registros.length.toLocaleString('es-NI'));
  set('ag-stat-cuentas', new Set(AG_STATE.registros.map(r => r.auth_user_id)).size.toLocaleString('es-NI'));
  const ultimo = AG_STATE.registros[0];
  set('ag-stat-ultimo', ultimo ? `${ultimo.negocio} · ${formatTime(ultimo.created_at)}` : '—');
}

async function eliminarNotificacion(id) {
  if (!confirm('¿Eliminar esta notificación? Los usuarios ya no la verán.')) return;
  try {
    const { error } = await sb.from('notificaciones').delete().eq('id', id);
    if (error) throw error;
    toast('Notificación eliminada', '', 'success');
    await loadNotificacionesSection();
  } catch (e) {
    console.error('eliminarNotificacion:', e);
    toast('Error al eliminar', e.message, 'error');
  }
}

/* ══════════════════════════════════════════
   VER QUIÉN VIO UN ANUNCIO / NOTIFICACIÓN
   Reutiliza la misma tabla usuarios (auth_user_id → nombre/negocio/
   correo) para mostrar quién, y a qué hora, vio cada envío global.
   Solo LEE de anuncios_vistos / notificaciones_leidas — ambas ya
   las llena el propio dashboard.html / notificaciones.js del
   cliente; aquí no se inserta ni modifica nada.
   ══════════════════════════════════════════ */
async function abrirVerLectoresAnuncio() {
  if (!anuncioActivoActual) return;
  await abrirVerLectores({
    titulo: `¿Quién vio? — ${anuncioActivoActual.titulo}`,
    tabla: 'anuncios_vistos',
    columnaId: 'anuncio_id',
    valorId: anuncioActivoActual.id,
    columnaFecha: 'visto_at',
  });
}

async function abrirVerLectoresNotificacion(notificacionId, titulo) {
  await abrirVerLectores({
    titulo: `¿Quién la leyó? — ${titulo}`,
    tabla: 'notificaciones_leidas',
    columnaId: 'notificacion_id',
    valorId: notificacionId,
    columnaFecha: 'leida_at',
  });
}

async function abrirVerLectores({ titulo, tabla, columnaId, valorId, columnaFecha }) {
  document.getElementById('lectores-modal-title').textContent = titulo;
  document.getElementById('lectores-modal-resumen').textContent = 'Cargando…';
  document.getElementById('lectores-tbody').innerHTML =
    `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-muted)">Cargando…</td></tr>`;
  openModal('modal-ver-lectores');

  try {
    const idsShadow = await obtenerIdsSucursalesShadow();
    const [{ data: vistos, error: errVistos }, { data: activos }] = await Promise.all([
      sb.from(tabla).select(`auth_user_id, ${columnaFecha}`).eq(columnaId, valorId).order(columnaFecha, { ascending: false }),
      sb.from('usuarios').select('auth_user_id').eq('estado_cuenta', 'activa'),
    ]);
    if (errVistos) throw errVistos;

    // Las sucursales/bodegas internas nunca cuentan como clientes que
    // vieron el anuncio/encuesta, ni como parte del total de activos.
    const lista = (vistos || []).filter(v => !idsShadow.has(v.auth_user_id));
    const totalUsuarios = (activos || []).filter(u => !idsShadow.has(u.auth_user_id)).length;
    document.getElementById('lectores-modal-resumen').textContent =
      `${lista.length} de ${totalUsuarios ?? '—'} clientes activos lo han visto.`;

    if (!lista.length) {
      document.getElementById('lectores-tbody').innerHTML =
        `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-muted)">Todavía nadie lo ha visto.</td></tr>`;
      return;
    }

    // Trae nombre/negocio/correo de cada usuario que lo vio, en un solo query.
    const ids = [...new Set(lista.map(v => v.auth_user_id))];
    const { data: usuarios } = await sb.from('usuarios')
      .select('auth_user_id, nombre, apellido, nombre_negocio, email').in('auth_user_id', ids);
    const porId = new Map((usuarios || []).map(u => [u.auth_user_id, u]));

    document.getElementById('lectores-tbody').innerHTML = lista.map(v => {
      const u = porId.get(v.auth_user_id);
      const nombre = u ? ([u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || 'Cliente') : 'Cliente eliminado';
      const negocio = u ? (u.nombre_negocio || u.email || '—') : '—';
      const fecha = v[columnaFecha] ? new Date(v[columnaFecha]).toLocaleString('es-NI') : '—';
      return `<tr><td>${escHtml(nombre)}</td><td>${escHtml(negocio)}</td><td>${fecha}</td></tr>`;
    }).join('');
  } catch (e) {
    console.error('abrirVerLectores:', e);
    document.getElementById('lectores-modal-resumen').textContent = '';
    document.getElementById('lectores-tbody').innerHTML =
      `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-muted)">No se pudo cargar la lista.</td></tr>`;
  }
}

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
    const { data: convsCrudo, error } = await sb
      .from('conversaciones_chat')
      .select('*')
      .order('ultimo_mensaje_at', { ascending: false });

    if (error) throw error;

    // Las sucursales/bodegas internas nunca deben aparecer en la lista
    // de conversaciones de soporte — no son clientes independientes.
    const idsShadow = await obtenerIdsSucursalesShadow();
    const convs = (convsCrudo || []).filter(c => !idsShadow.has(c.auth_user_id));

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

// ============================================================
// CHATS GRUPALES — el admin crea chats grupales y agrega a los
// clientes que quiera. Los mensajes se eliminan automáticamente
// 72 horas después de enviados (limpieza perezosa, mismo patrón
// que public.notificaciones / notificaciones.js).
// ============================================================
let allChatsGrupales           = [];
let currentChatGrupalId        = null;
let currentChatGrupalMiembros  = []; // filas de chats_grupales_miembros + nombre resuelto
let gcMsgChannel                = null;
let gcSeenIds                   = new Set();
let gcSelectedNewChat           = new Set(); // auth_user_id seleccionados al crear un chat
let gcSelectedAdd               = new Set(); // auth_user_id seleccionados al agregar miembro

// ── LIMPIEZA AUTOMÁTICA (best-effort, permitida por RLS) ───
async function limpiarMensajesGrupalesViejos() {
  try {
    const limite = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    await sb.from('mensajes_chat_grupal').delete().lt('created_at', limite);
  } catch (e) {
    // Best-effort: si falla, simplemente no se limpia en este momento.
    console.warn('limpiarMensajesGrupalesViejos:', e);
  }
}

// ── LISTA DE CHATS GRUPALES ─────────────────────────────────
async function loadChatsGrupales() {
  limpiarMensajesGrupalesViejos(); // no bloquea la carga de la lista

  const list = document.getElementById('gc-list');
  if (list) list.innerHTML = '<div class="payment-empty">Cargando...</div>';

  try {
    // FIX: si esta sección se abre sin haber visitado antes "Usuarios",
    // allUsers estaba vacío — eso hacía que el selector de "Agregar
    // miembro"/"Nuevo chat" pareciera no tener clientes disponibles, y que
    // los nombres de los miembros no se resolvieran. Se carga en paralelo.
    const [_, { data: chats, error }, { data: miembros, error: errM }] = await Promise.all([
      loadUsers(),
      sb.from('chats_grupales').select('*').order('created_at', { ascending: false }),
      sb.from('chats_grupales_miembros').select('chat_id, auth_user_id'),
    ]);
    if (error) throw error;
    if (errM) throw errM;

    const conteo = {};
    (miembros || []).forEach(m => { conteo[m.chat_id] = (conteo[m.chat_id] || 0) + 1; });

    allChatsGrupales = (chats || []).map(c => ({ ...c, _numMiembros: conteo[c.id] || 0 }));
    renderChatsGrupalesList();
  } catch (e) {
    console.error('loadChatsGrupales:', e);
    if (list) list.innerHTML = '<div class="payment-empty">No se pudieron cargar los chats</div>';
  }
}

function renderChatsGrupalesList() {
  const list = document.getElementById('gc-list');
  if (!list) return;

  if (!allChatsGrupales.length) {
    list.innerHTML = '<div class="payment-empty">Aún no has creado ningún chat grupal</div>';
    return;
  }

  list.innerHTML = allChatsGrupales.map(c => `
    <div class="conv-item ${c.id === currentChatGrupalId ? 'selected' : ''}" onclick="abrirChatGrupal('${c.id}')">
      <div class="conv-item-avatar">${escHtml((c.nombre || '?').charAt(0).toUpperCase())}</div>
      <div class="conv-item-info">
        <div class="conv-item-name">${escHtml(c.nombre)}</div>
        <div class="conv-item-preview">${c._numMiembros} miembro${c._numMiembros === 1 ? '' : 's'}</div>
      </div>
    </div>
  `).join('');
}

// ── ABRIR UN CHAT GRUPAL ─────────────────────────────────────
async function abrirChatGrupal(chatId) {
  currentChatGrupalId = chatId;
  const chat = allChatsGrupales.find(c => c.id === chatId);
  if (!chat) return;

  renderChatsGrupalesList(); // refresca cuál queda marcado como "selected"

  document.getElementById('gc-empty').style.display = 'none';
  document.getElementById('gc-active').style.display = 'flex';
  document.getElementById('gc-nombre').textContent = chat.nombre;
  document.getElementById('gc-sub').textContent = 'Cargando miembros...';
  document.getElementById('gc-messages').innerHTML = '';
  gcSeenIds = new Set();

  await Promise.all([cargarMiembrosChatGrupal(chatId), cargarMensajesChatGrupal(chatId)]);
  subscribeChatGrupal(chatId);
}

async function cargarMiembrosChatGrupal(chatId) {
  try {
    const { data, error } = await sb
      .from('chats_grupales_miembros')
      .select('id, auth_user_id, agregado_at')
      .eq('chat_id', chatId)
      .order('agregado_at', { ascending: true });
    if (error) throw error;

    // Etiqueta anónima "Usuario N" según el orden en que cada quien fue
    // agregado al chat (mismo criterio que usa la función de Supabase
    // para el lado del cliente). El nombre real solo se guarda para
    // mostrarlo como tooltip al admin, nunca como texto visible del chat.
    currentChatGrupalMiembros = (data || []).map((m, idx) => {
      const u = allUsers.find(x => x.auth_user_id === m.auth_user_id);
      const nombreReal = u ? ([u.nombre, u.apellido].filter(Boolean).join(' ') || u.email) : 'Cliente';
      return { ...m, etiqueta: `Usuario ${idx + 1}`, nombreReal };
    });

    document.getElementById('gc-sub').textContent =
      `${currentChatGrupalMiembros.length} miembro${currentChatGrupalMiembros.length === 1 ? '' : 's'}`;
    renderMiembrosBar();
  } catch (e) {
    console.error('cargarMiembrosChatGrupal:', e);
  }
}

function renderMiembrosBar() {
  const bar = document.getElementById('gc-members-bar');
  if (!bar) return;
  if (!currentChatGrupalMiembros.length) {
    bar.innerHTML = '<span style="font-size:11.5px;color:var(--text-muted)">Sin miembros todavía — usa "Agregar miembro"</span>';
    return;
  }
  bar.innerHTML = currentChatGrupalMiembros.map(m => `
    <span class="gc-member-chip" title="${escHtml(m.nombreReal)}">
      ${escHtml(m.etiqueta)}
      <button onclick="quitarMiembroChatGrupal('${m.id}')" title="Quitar del chat">&times;</button>
    </span>
  `).join('');
}

async function quitarMiembroChatGrupal(miembroId) {
  if (!confirm('¿Quitar a este cliente del chat grupal?')) return;
  try {
    const { error } = await sb.from('chats_grupales_miembros').delete().eq('id', miembroId);
    if (error) throw error;
    currentChatGrupalMiembros = currentChatGrupalMiembros.filter(m => m.id !== miembroId);
    document.getElementById('gc-sub').textContent =
      `${currentChatGrupalMiembros.length} miembro${currentChatGrupalMiembros.length === 1 ? '' : 's'}`;
    renderMiembrosBar();
    loadChatsGrupales(); // refresca el conteo en la lista de la izquierda
  } catch (e) {
    toast('No se pudo quitar al miembro', e.message, 'error');
  }
}

// ── MENSAJES DEL CHAT GRUPAL ─────────────────────────────────
async function cargarMensajesChatGrupal(chatId) {
  try {
    const { data, error } = await sb
      .from('mensajes_chat_grupal')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    (data || []).forEach(renderMensajeGrupal);
  } catch (e) {
    console.error('cargarMensajesChatGrupal:', e);
  }
}

function renderMensajeGrupal(m) {
  if (gcSeenIds.has(m.id)) return;
  gcSeenIds.add(m.id);

  const esAdmin = m.auth_user_id === currentUser?.id;
  const row = document.createElement('div');
  row.className = 'chat-msg-row ' + (esAdmin ? 'admin' : 'cliente');

  let nombreRemitente = 'Tú (admin)';
  if (!esAdmin) {
    const miembro = currentChatGrupalMiembros.find(x => x.auth_user_id === m.auth_user_id);
    nombreRemitente = miembro ? miembro.etiqueta : 'Usuario';
  }

  row.innerHTML = `<div>
    <div class="chat-msg-sender">${escHtml(nombreRemitente)}</div>
    <div class="chat-msg-bubble">${escHtml(m.contenido).replace(/\n/g, '<br>')}</div>
    <div class="chat-msg-time">${formatTime(m.created_at)}</div>
  </div>`;
  const container = document.getElementById('gc-messages');
  if (!container) return;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

async function enviarMensajeGrupal() {
  const input = document.getElementById('gc-input');
  const text = input.value.trim();
  if (!text || !currentChatGrupalId) return;
  input.value = '';

  try {
    const { data, error } = await sb.from('mensajes_chat_grupal').insert({
      chat_id: currentChatGrupalId,
      auth_user_id: currentUser.id,
      contenido: text,
    }).select().single();
    if (error) throw error;
    renderMensajeGrupal(data);
  } catch (e) {
    toast('No se pudo enviar el mensaje', e.message, 'error');
  }
}

// Tiempo real: nuevos mensajes en el chat grupal abierto
function subscribeChatGrupal(chatId) {
  if (gcMsgChannel) { sb.removeChannel(gcMsgChannel); gcMsgChannel = null; }
  gcMsgChannel = sb.channel(`admin-chat-grupal-${chatId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes_chat_grupal', filter: `chat_id=eq.${chatId}` },
      (payload) => renderMensajeGrupal(payload.new))
    .subscribe();
}

// ── SELECTOR DE CLIENTES (crear chat / agregar miembro) ─────
// Muestra solo clientes con auth_user_id (requisito para ser miembro),
// excluyendo los que ya están en "excluirIds" — así, quien ya está
// unido a un chat NO vuelve a aparecer en la lista de personas a unir.
function renderPickerClientes(containerId, selectedSet, excluirIds) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  const excluir = new Set(excluirIds);
  const disponibles = allUsers.filter(u => u.auth_user_id && !excluir.has(u.auth_user_id));

  if (!disponibles.length) {
    cont.innerHTML = '<div class="payment-empty">No hay clientes disponibles para agregar</div>';
    return;
  }

  cont.innerHTML = disponibles.map(u => {
    const nombre = [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || 'Cliente';
    const checked = selectedSet.has(u.auth_user_id) ? 'checked' : '';
    return `
      <label class="gc-picker-item">
        <input type="checkbox" ${checked} onchange="togglePickerSeleccion('${containerId}','${u.auth_user_id}', this.checked)">
        <div>
          <div class="gc-picker-name">${escHtml(nombre)}</div>
          <div class="gc-picker-sub">${escHtml(u.nombre_negocio || u.email || '')}</div>
        </div>
      </label>`;
  }).join('');
}

function togglePickerSeleccion(containerId, authUserId, checked) {
  const set = containerId === 'ncg-picker' ? gcSelectedNewChat : gcSelectedAdd;
  if (checked) set.add(authUserId); else set.delete(authUserId);
}

// ── CREAR CHAT GRUPAL ─────────────────────────────────────
async function abrirNuevoChatGrupal() {
  document.getElementById('ncg-nombre').value = '';
  gcSelectedNewChat = new Set();

  // FIX: si el admin entra directo a "Chats Grupales" sin haber visitado
  // antes la sección "Usuarios", allUsers estaba vacío y el selector
  // mostraba "no hay clientes" aunque sí existieran. Se asegura tener la
  // lista cargada (o refrescada, por si hay clientes nuevos) antes de
  // abrir el selector.
  document.getElementById('ncg-picker').innerHTML = '<div class="payment-empty">Cargando clientes...</div>';
  openModal('modal-nuevo-chat-grupal');
  await loadUsers();
  renderPickerClientes('ncg-picker', gcSelectedNewChat, []);
}

async function crearChatGrupal() {
  const nombre = document.getElementById('ncg-nombre').value.trim();
  if (!nombre) { toast('Falta el nombre', 'Escribe un nombre para el chat grupal', 'warning'); return; }

  const btn = document.getElementById('btn-crear-chat-grupal');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span>';

  try {
    const { data: chat, error } = await sb.from('chats_grupales')
      .insert({ nombre, creado_por: currentUser?.email || null })
      .select().single();
    if (error) throw error;

    const miembrosSeleccionados = [...gcSelectedNewChat];
    if (miembrosSeleccionados.length) {
      const rows = miembrosSeleccionados.map(authUserId => ({ chat_id: chat.id, auth_user_id: authUserId }));
      const { error: errM } = await sb.from('chats_grupales_miembros').insert(rows);
      if (errM) throw errM;
    }

    closeModal('modal-nuevo-chat-grupal');
    toast('Chat grupal creado', `"${nombre}" está listo`, 'success');
    await loadChatsGrupales();
    abrirChatGrupal(chat.id);
  } catch (e) {
    console.error('crearChatGrupal:', e);
    toast('Error al crear el chat', e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear chat';
  }
}

// ── AGREGAR MIEMBRO A UN CHAT EXISTENTE ───────────────────
async function abrirAgregarMiembro() {
  if (!currentChatGrupalId) return;
  gcSelectedAdd = new Set();

  // Mismo fix que abrirNuevoChatGrupal: refrescar allUsers antes de armar
  // el selector, para no depender de haber visitado antes "Usuarios".
  document.getElementById('am-picker').innerHTML = '<div class="payment-empty">Cargando clientes...</div>';
  openModal('modal-agregar-miembro');
  await loadUsers();
  const yaMiembros = currentChatGrupalMiembros.map(m => m.auth_user_id);
  renderPickerClientes('am-picker', gcSelectedAdd, yaMiembros);
}

async function agregarMiembroSeleccionado() {
  if (!currentChatGrupalId) return;
  const seleccionados = [...gcSelectedAdd];
  if (!seleccionados.length) { toast('Selecciona al menos un cliente', '', 'warning'); return; }

  const btn = document.getElementById('btn-agregar-miembro');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span>';

  try {
    const rows = seleccionados.map(authUserId => ({ chat_id: currentChatGrupalId, auth_user_id: authUserId }));
    const { error } = await sb.from('chats_grupales_miembros').insert(rows);
    if (error) throw error;

    closeModal('modal-agregar-miembro');
    toast('Miembros agregados', '', 'success');
    await cargarMiembrosChatGrupal(currentChatGrupalId);
    loadChatsGrupales();
  } catch (e) {
    console.error('agregarMiembroSeleccionado:', e);
    toast('Error al agregar miembros', e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Agregar seleccionados';
  }
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

// Estado de conexión de un usuario a partir de usuarios.ultima_conexion
// (actualizado por el heartbeat de perfiles-guard.js cada ~45s mientras
// el usuario tiene la app abierta). Se considera "en línea" si el último
// latido llegó hace menos de 2 minutos.
const CONEXION_ONLINE_MS = 2 * 60 * 1000;

function conexionBadge(ultimaConexionIso) {
  if (!ultimaConexionIso) {
    return '<span class="badge" style="color:var(--text-muted)">Sin registro</span>';
  }
  const ultima = new Date(ultimaConexionIso);
  if (isNaN(ultima.getTime())) {
    return '<span class="badge" style="color:var(--text-muted)">Sin registro</span>';
  }
  const diffMs = Date.now() - ultima.getTime();

  if (diffMs <= CONEXION_ONLINE_MS) {
    return `<span class="badge badge-success badge-dot" title="Última actividad: ${escHtml(ultima.toLocaleString('es-NI'))}">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:4px"></span>En línea
    </span>`;
  }

  return `<span class="badge" style="color:var(--text-muted)" title="${escHtml(ultima.toLocaleString('es-NI'))}">
    Hace ${tiempoRelativo(diffMs)}
  </span>`;
}

function tiempoRelativo(diffMs) {
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d`;
  const mo = Math.floor(d / 30);
  return `${mo} mes${mo === 1 ? '' : 'es'}`;
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

  // Evento: enviar mensaje en chat grupal
  document.getElementById('btn-send-grupal').addEventListener('click', enviarMensajeGrupal);
  document.getElementById('gc-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); enviarMensajeGrupal(); }
  });

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

  // Refrescar la columna "Conexión" (en línea / última conexión) cada 30s
  // mientras el admin tenga abierta la sección de Usuarios. No vuelve a
  // consultar la base de datos: solo recalcula el tiempo transcurrido
  // sobre los datos ya cargados en memoria (allUsers).
  setInterval(() => {
    const pageUsers = document.getElementById('page-users');
    if (pageUsers && pageUsers.classList.contains('active')) {
      filterAndSearch();
    }
  }, 30000);
});
