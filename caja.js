/* =====================================================
   CAJA.JS — NEGOCIO360
   Centro financiero del sistema.
   Versión: 2.0 — Reescrito desde cero:
     - Menú móvil (drawer) simple y confiable, con botón
       de cierre (✕) siempre visible dentro del panel,
       así nunca te quedas "atrapado" sin poder cerrarlo.
     - Nombre del negocio tomado de configuracion_empresa
       .nombre_comercial (campo real usado por
       personalizacion.html).

   LÓGICA DE SALDO (fuente de verdad única):
   - STATE.caja = saldo_resultante del último movimiento completado
   - Al poner dinero inicial → se inserta movimiento CAPITAL_AGREGADO
     con saldo_anterior=0 y saldo_resultante=monto
   - NO se suma capital_negocio + movimientos (eso causaba el doble)
   - capital_negocio se usa solo como registro histórico
===================================================== */

'use strict';

/* =====================================================
   SUPABASE CLIENT
===================================================== */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient = window.__cajaSB || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.__cajaSB = sbClient;

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  currentUser:   {},
  caja:          0,   // saldo actual de caja (antes "capital")
  metodosPago:   [],
  bancos:        [],

  // Movimientos
  movimientos:   [],
  movPage:       1,
  movPerPage:    15,
  movFilter:     'mes',
  movSearch:     '',
  movDateFrom:   '',
  movDateTo:     '',
  movTotal:      0,

  // Cierres
  cierres:       [],

  // UI
  activeSection: 'movimientos',
};

/* =====================================================
   HELPERS: FECHA
   FIX CRÍTICO DE ZONA HORARIA: se usaba toISOString() (UTC).
   En Nicaragua (UTC-6) eso hacía que la fecha cambiara a las
   6:00 PM hora local en vez de medianoche, archivando movimientos
   de caja nocturnos con la fecha de mañana. Ahora se usa la
   fecha calendario LOCAL del dispositivo.
===================================================== */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayISO()        { return ymd(new Date()); }
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfWeekISO() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return ymd(d);
}
function startOfYearISO() {
  return `${new Date().getFullYear()}-01-01`;
}

function getFilterDates(filter, from, to) {
  const today = todayISO();
  switch (filter) {
    case 'hoy':    return { from: today,             to: today };
    case 'semana': return { from: startOfWeekISO(),  to: today };
    case 'mes':    return { from: startOfMonthISO(), to: today };
    case 'año':    return { from: startOfYearISO(),  to: today };
    case 'custom': return { from: from || today,     to: to || today };
    default:       return { from: startOfMonthISO(), to: today };
  }
}

/* =====================================================
   HELPERS: FORMATO
===================================================== */
function sym() { return STATE.empresaConfig?.moneda || 'C$'; }

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function fmt(amount) {
  if (amount === null || amount === undefined) return `${sym()} —`;
  return `${sym()} ${Number(amount).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}

/* =====================================================
   NOMBRE DEL NEGOCIO
   El onboarding (personalizacion.html) guarda el nombre
   comercial que escribe el cliente en el input
   #nombre_comercial, y lo sube a Supabase en la columna
   `nombre_comercial` de la tabla `configuracion_empresa`
   (ver función collectStep()/finalizarOnboarding() de
   personalizacion.html). Por eso esa es la prioridad #1.
===================================================== */
function nombreNegocio() {
  const cfg  = STATE.empresaConfig || {};
  const user = STATE.currentUser   || {};
  return (
    cfg.nombre_comercial ||   // ← campo real de personalizacion.html
    cfg.nombre_negocio   ||
    cfg.nombre_empresa   ||
    cfg.razon_social     ||
    cfg.nombre           ||
    user.nombre_negocio  ||
    'Mi negocio'
  );
}

/* =====================================================
   THEME
===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('n360_theme', theme);
  const sun  = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}

function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme');
  applyTheme(curr === 'dark' ? 'light' : 'dark');
}

/* =====================================================
   SIDEBAR — menú de módulos (Ventas, Compras, etc.)

   Comportamiento simple y explícito, sin trucos de estilo
   inline: usa únicamente clases CSS que ya vienen
   definidas en caja.html (#sidebar.mobile-open y
   #sidebar-overlay.show). Además, el propio panel trae un
   botón "✕" (sidebar-close-btn) siempre alcanzable, así
   el usuario NUNCA se queda sin forma de cerrarlo.
===================================================== */
let sidebarCollapsed = false;

function isMobileViewport() {
  return window.innerWidth <= 768;
}

// Abre/cierra el menú. En escritorio colapsa/expande
// (icono only vs texto); en móvil abre/cierra el drawer.
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;

  if (isMobileViewport()) {
    if (sb.classList.contains('mobile-open')) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    sb.classList.toggle('collapsed', sidebarCollapsed);
    const main = document.getElementById('main');
    if (main) main.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}

function openMobileSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.add('mobile-open');
  if (ov) ov.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeMobileSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.remove('mobile-open');
  if (ov) ov.classList.remove('show');
  document.body.style.overflow = '';
}

function navigate(url) {
  closeMobileSidebar();
  window.location.href = url;
}

// Si la pantalla deja de ser móvil (por ejemplo al rotar
// el teléfono a horizontal en una tablet, o redimensionar
// la ventana en una PC), limpiamos el estado del drawer
// para que no quede "medio abierto".
window.addEventListener('resize', () => {
  if (!isMobileViewport()) closeMobileSidebar();
});

// Cerrar el menú con la tecla Escape (accesibilidad / respaldo extra)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileSidebar();
});

/* =====================================================
   EMPRESA CONFIG
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbClient
      .from('configuracion_empresa')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (data) {
      STATE.empresaConfig = data;
      const logoText = document.getElementById('sidebar-logo-text');
      if (logoText) logoText.textContent = nombreNegocio();
      if (data.color_principal) {
        document.documentElement.style.setProperty('--accent', data.color_principal);
        document.documentElement.style.setProperty('--accent-soft', data.color_principal + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_principal);
      } else if (data.color_primario) {
        document.documentElement.style.setProperty('--accent', data.color_primario);
        document.documentElement.style.setProperty('--accent-soft', data.color_primario + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_primario);
      }
      if (data.logo_principal_url || data.logo_url) {
        const logoIcon = document.querySelector('.logo-icon');
        if (logoIcon) logoIcon.innerHTML = `<img src="${data.logo_principal_url || data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch(e) { console.warn('loadEmpresaConfig:', e); }
}

async function loadUserProfile(userId) {
  try {
    const { data } = await sbClient
      .from('usuarios')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();
    return data;
  } catch(e) { return null; }
}

function renderUserInfo(user, email) {
  if (!user) return;
  STATE.currentUser = user;
  const nombre   = user.nombre   || email?.split('@')[0] || 'Usuario';
  const apellido = user.apellido || '';
  const plan     = user.plan || 'Gratuito';
  const initials = ((nombre[0]||'') + (apellido[0]||'')).toUpperCase();

  document.getElementById('header-name').textContent = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent  = nombreNegocio();
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent   = plan.charAt(0).toUpperCase() + plan.slice(1);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('greeting-text').textContent = `${greet}, ${nombre}`;
}

/* =====================================================
   ADMIN ACCESS
===================================================== */
async function checkAdminAccess(email) {
  try {
    const { data } = await sbClient
      .from('administradores')
      .select('email, activo')
      .eq('email', email)
      .eq('activo', true)
      .maybeSingle();
    if (data) {
      const el = document.getElementById('nav-admin');
      if (el) el.style.display = 'flex';
    }
  } catch(e) { console.debug('Admin check done.'); }
}

/* =====================================================
   SALDO DE CAJA (fuente de verdad única)
===================================================== */
async function loadCaja() {
  try {
    const { data } = await sbClient
      .from('movimientos_financieros')
      .select('saldo_resultante')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    STATE.caja = data ? Number(data.saldo_resultante) : 0;
    return STATE.caja;
  } catch(e) {
    console.warn('loadCaja:', e);
    STATE.caja = 0;
    return 0;
  }
}

/* =====================================================
   VERIFICAR SI ES PRIMERA VEZ (sin movimientos)
===================================================== */
async function tieneMovimientos() {
  try {
    const { count } = await sbClient
      .from('movimientos_financieros')
      .select('id', { count: 'exact', head: true })
      .eq('auth_user_id', STATE.userId);
    return (count || 0) > 0;
  } catch(e) { return false; }
}

/* =====================================================
   GUARDAR DINERO INICIAL
===================================================== */
async function guardarDineroInicial(monto) {
  const montoNum = Number(monto);

  const { error: errUpdate } = await sbClient
    .from('capital_negocio')
    .update({ is_current: false })
    .eq('auth_user_id', STATE.userId)
    .eq('is_current', true);
  if (errUpdate) throw errUpdate;

  const { error: errCapital } = await sbClient
    .from('capital_negocio')
    .insert({
      auth_user_id: STATE.userId,
      monto:        montoNum,
      concepto:     'Dinero inicial de caja',
      is_current:   true,
    });
  if (errCapital) throw errCapital;

  const { error } = await sbClient
    .from('movimientos_financieros')
    .insert({
      auth_user_id:       STATE.userId,
      tipo_flujo:         'INGRESO',
      tipo_movimiento:    'CAPITAL_AGREGADO',
      concepto:           'Dinero inicial de caja',
      monto:              montoNum,
      saldo_anterior:     0,
      saldo_resultante:   montoNum,
      metodo_pago_nombre: 'Efectivo',
      fecha:              todayISO(),
      estado:             'completado',
    });

  if (error) throw error;
}

/* =====================================================
   RESUMEN FINANCIERO (KPIs del mes)
===================================================== */
async function loadResumen() {
  const monthStart = startOfMonthISO();
  const today      = todayISO();

  try {
    const { data } = await sbClient
      .from('movimientos_financieros')
      .select('tipo_flujo, monto, fecha, referencia_tipo, tipo_movimiento')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .gte('fecha', monthStart)
      .lte('fecha', today);

    const movs = data || [];

    // "Ingresos del mes" / "Egresos del mes" reflejan solo movimientos
    // LIGADOS a otra parte del sistema (venta, compra de producto, etc.
    // — tienen referencia_tipo). Los movimientos manuales de Caja
    // (referencia_tipo null) ya NO se cuentan aquí: esos van
    // exclusivamente en "Otros ingresos" / "Otros egresos" más abajo,
    // para no duplicarlos entre las dos tarjetas.
    const movsIngresoRef = movs.filter(r => r.tipo_flujo === 'INGRESO' && r.referencia_tipo);
    const movsEgresoRef  = movs.filter(r => r.tipo_flujo === 'EGRESO'  && r.referencia_tipo);

    const ingresos = movsIngresoRef.reduce((s,r) => s + Number(r.monto), 0);
    const egresos  = movsEgresoRef.reduce((s,r)  => s + Number(r.monto), 0);
    const totalMov = movs.length;

    setEl('kpi-caja', fmt(STATE.caja));
    setDelta('kpi-caja-delta',
      STATE.caja >= 0 ? 'Saldo positivo' : 'Saldo negativo',
      STATE.caja >= 0);

    setEl('kpi-ingresos', fmt(ingresos));
    setDelta('kpi-ingresos-delta',
      ingresos > 0 ? `${movsIngresoRef.length} entradas` : 'Sin ingresos este mes',
      ingresos > 0);

    setEl('kpi-egresos', fmt(egresos));
    setDelta('kpi-egresos-delta',
      egresos > 0 ? `${movsEgresoRef.length} salidas` : 'Sin egresos este mes',
      false);

    setEl('kpi-movimientos', totalMov.toString());
    setDelta('kpi-movimientos-delta',
      totalMov > 0 ? 'este mes' : 'Sin movimientos',
      totalMov > 0);

    const cajaEl = document.getElementById('kpi-caja');
    if (cajaEl) cajaEl.style.color = STATE.caja >= 0 ? '' : 'var(--danger)';

    // ── NUEVO: "Otros ingresos" / "Otros egresos" ─────────────────
    // Movimientos registrados manualmente desde Caja ("Nuevo movimiento")
    // que NO están ligados a una venta, compra de producto ni gasto
    // (referencia_tipo es null). Esos son los que hoy no se ven ni en
    // Ventas ni en Gastos, así que se muestran aparte aquí y también
    // se reflejan en el resumen financiero del Dashboard.
    // Cuentan TODAS las categorías manuales (venta, cobro, ingreso a
    // caja, otro ingreso, etc.) — lo que define si algo es "otro
    // ingreso/egreso" es que no tenga referencia_tipo, no la categoría
    // elegida en el formulario.
    const otrosIngresos = movs
      .filter(r => r.tipo_flujo === 'INGRESO' && !r.referencia_tipo)
      .reduce((s, r) => s + Number(r.monto || 0), 0);

    const otrosEgresos = movs
      .filter(r => r.tipo_flujo === 'EGRESO' && !r.referencia_tipo)
      .reduce((s, r) => s + Number(r.monto || 0), 0);

    setEl('kpi-otros-ingresos', fmt(otrosIngresos));
    setDelta('kpi-otros-ingresos-delta',
      otrosIngresos > 0 ? 'Movimientos manuales de Caja' : 'Sin otros ingresos',
      otrosIngresos > 0);

    setEl('kpi-otros-egresos', fmt(otrosEgresos));
    setDelta('kpi-otros-egresos-delta',
      otrosEgresos > 0 ? 'Movimientos manuales de Caja' : 'Sin otros egresos',
      false);
    // ────────────────────────────────────────────────────────────

  } catch(e) { console.warn('loadResumen:', e); }
}

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setDelta(id, text, positive) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `kpi-delta ${positive ? 'positive' : (text.includes('negativo') ? 'negative' : 'neutral')}`;
}

/* =====================================================
   MÉTODOS DE PAGO
===================================================== */
async function loadMetodosPago() {
  try {
    const { data } = await sbClient
      .from('metodos_pago')
      .select('*')
      .eq('auth_user_id', STATE.userId)
      .order('orden');
    STATE.metodosPago = data || [];
    renderMetodosPago();
    populateMetodoSelect();
  } catch(e) { console.warn('loadMetodosPago:', e); }
}

function renderMetodosPago() {
  const tbody = document.getElementById('metodos-tbody');
  if (!tbody) return;

  if (!STATE.metodosPago.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Sin métodos de pago registrados</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.metodosPago.map(m => `
    <tr>
      <td>
        <div class="metodo-name-cell">
          <div class="metodo-dot" style="background:${m.activo ? 'var(--success)' : 'var(--text-muted)'}"></div>
          ${escHtml(m.nombre)}
          ${m.es_default ? '<span class="badge-default">default</span>' : ''}
        </div>
      </td>
      <td>${escHtml(m.descripcion || '—')}</td>
      <td>
        <span class="status-badge ${m.activo ? 'badge-active' : 'badge-inactive'}">
          ${m.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td>
        <div class="action-cell">
          <button class="btn-icon" onclick="editMetodo('${m.id}')" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon ${m.activo ? 'btn-icon-danger' : 'btn-icon-success'}"
            onclick="toggleMetodo('${m.id}', ${!m.activo})" title="${m.activo ? 'Desactivar' : 'Activar'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${m.activo
                ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
                : '<polyline points="20 6 9 17 4 12"/>'}
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function populateMetodoSelect() {
  const sel = document.getElementById('mov-metodo');
  if (!sel) return;
  const activos = STATE.metodosPago.filter(m => m.activo);
  sel.innerHTML = `<option value="">Seleccionar método</option>` +
    activos.map(m => `<option value="${m.id}" data-nombre="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`).join('');
}

async function toggleMetodo(id, nuevoEstado) {
  try {
    await sbClient.from('metodos_pago').update({ activo: nuevoEstado }).eq('id', id).eq('auth_user_id', STATE.userId);
    await loadMetodosPago();
    showToast(nuevoEstado ? 'Método activado' : 'Método desactivado');
  } catch(e) { showToast('Error al actualizar método', 'error'); }
}

function editMetodo(id) {
  const m = STATE.metodosPago.find(x => x.id === id);
  if (!m) return;
  document.getElementById('metodo-modal-title').textContent = 'Editar método de pago';
  document.getElementById('metodo-id').value          = m.id;
  document.getElementById('metodo-nombre').value      = m.nombre;
  document.getElementById('metodo-descripcion').value = m.descripcion || '';
  document.getElementById('metodo-default').checked   = m.es_default;
  openModal('modal-metodo');
}

function newMetodo() {
  document.getElementById('metodo-modal-title').textContent = 'Nuevo método de pago';
  document.getElementById('metodo-id').value          = '';
  document.getElementById('metodo-nombre').value      = '';
  document.getElementById('metodo-descripcion').value = '';
  document.getElementById('metodo-default').checked   = false;
  openModal('modal-metodo');
}

async function saveMetodo() {
  const id          = document.getElementById('metodo-id').value.trim();
  const nombre      = document.getElementById('metodo-nombre').value.trim();
  const descripcion = document.getElementById('metodo-descripcion').value.trim();
  const esDefault   = document.getElementById('metodo-default').checked;

  if (!nombre) { showToast('El nombre es requerido', 'error'); return; }

  try {
    setBtnLoading('btn-save-metodo', true);

    if (esDefault) {
      await sbClient.from('metodos_pago')
        .update({ es_default: false })
        .eq('auth_user_id', STATE.userId);
    }

    if (id) {
      await sbClient.from('metodos_pago')
        .update({ nombre, descripcion, es_default: esDefault })
        .eq('id', id)
        .eq('auth_user_id', STATE.userId);
    } else {
      const orden = STATE.metodosPago.length + 1;
      await sbClient.from('metodos_pago')
        .insert({ auth_user_id: STATE.userId, nombre, descripcion, es_default: esDefault, orden });
    }

    closeModal('modal-metodo');
    await loadMetodosPago();
    showToast(id ? 'Método actualizado' : 'Método creado');
  } catch(e) {
    showToast('Error al guardar método', 'error');
  } finally {
    setBtnLoading('btn-save-metodo', false);
  }
}

/* =====================================================
   MOVIMIENTOS
===================================================== */
async function loadMovimientos() {
  const { from, to } = getFilterDates(STATE.movFilter, STATE.movDateFrom, STATE.movDateTo);

  try {
    let query = sbClient
      .from('movimientos_financieros')
      .select('*', { count: 'exact' })
      .eq('auth_user_id', STATE.userId)
      .gte('fecha', from)
      .lte('fecha', to)
      .neq('estado', 'anulado')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });

    if (STATE.movSearch.trim()) {
      query = query.ilike('concepto', `%${STATE.movSearch.trim()}%`);
    }

    const from_range = (STATE.movPage - 1) * STATE.movPerPage;
    const to_range   = from_range + STATE.movPerPage - 1;
    query = query.range(from_range, to_range);

    const { data, count } = await query;
    STATE.movimientos = data || [];
    STATE.movTotal    = count || 0;

    renderMovimientos();
    renderPaginacion();
  } catch(e) {
    console.warn('loadMovimientos:', e);
    renderMovimientosError();
  }
}

function renderMovimientos() {
  const tbody = document.getElementById('mov-tbody');
  if (!tbody) return;

  if (!STATE.movimientos.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell">
          <div class="empty-state-mini">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            <p>Sin movimientos en este período</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = STATE.movimientos.map(m => {
    const isIngreso = m.tipo_flujo === 'INGRESO';
    const badgeClass = isIngreso ? 'badge-ingreso' : 'badge-egreso';
    const tipoLabel  = tipoMovLabel(m.tipo_movimiento);

    return `
    <tr class="mov-row ${m.estado === 'anulado' ? 'mov-anulado' : ''}">
      <td class="td-fecha">${fmtDate(m.fecha)}</td>
      <td>
        <span class="tipo-badge ${badgeClass}">${tipoLabel}</span>
      </td>
      <td class="td-concepto">
        <span class="concepto-text">${escHtml(m.concepto)}</span>
        ${m.observaciones ? `<span class="concepto-obs">${escHtml(m.observaciones)}</span>` : ''}
        ${m.referencia_tipo ? `<span class="ref-badge">Ref: ${escHtml(m.referencia_tipo)}</span>` : ''}
      </td>
      <td class="td-metodo">${escHtml(m.metodo_pago_nombre || '—')}</td>
      <td class="td-monto td-entrada">${isIngreso ? fmt(m.monto) : '—'}</td>
      <td class="td-monto td-salida">${!isIngreso ? fmt(m.monto) : '—'}</td>
      <td class="td-monto td-saldo">${fmt(m.saldo_resultante)}</td>
      <td class="td-actions">
        ${m.estado !== 'anulado' ? `
          <button class="btn-icon btn-icon-danger" onclick="confirmarAnular('${m.id}')" title="Anular">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        ` : '<span class="anulado-label">Anulado</span>'}
      </td>
    </tr>`;
  }).join('');
}

function renderMovimientosError() {
  const tbody = document.getElementById('mov-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Error al cargar movimientos. Intenta de nuevo.</td></tr>`;
}

function renderPaginacion() {
  const totalPages = Math.ceil(STATE.movTotal / STATE.movPerPage);
  const info = document.getElementById('paginacion-info');
  if (info) {
    const from = Math.min((STATE.movPage - 1) * STATE.movPerPage + 1, STATE.movTotal);
    const to   = Math.min(STATE.movPage * STATE.movPerPage, STATE.movTotal);
    info.textContent = STATE.movTotal > 0 ? `Mostrando ${from}–${to} de ${STATE.movTotal}` : 'Sin resultados';
  }

  const btnPrev = document.getElementById('btn-pag-prev');
  const btnNext = document.getElementById('btn-pag-next');
  if (btnPrev) btnPrev.disabled = STATE.movPage <= 1;
  if (btnNext) btnNext.disabled = STATE.movPage >= totalPages;
}

function tipoMovLabel(tipo) {
  const map = {
    VENTA:            'Venta',
    COBRO:            'Cobro',
    CAPITAL_AGREGADO: 'Caja',
    OTRO_INGRESO:     'Otro ingreso',
    COMPRA:           'Compra',
    GASTO:            'Gasto',
    RETIRO:           'Retiro',
    PAGO:             'Pago',
    PAGO_SALARIO:     'Pago de salario',
    OTRO_EGRESO:      'Otro egreso',
  };
  return map[tipo] || tipo;
}

/* =====================================================
   NUEVO MOVIMIENTO
===================================================== */
function openNuevoMovimiento() {
  document.getElementById('mov-form').reset();
  document.getElementById('mov-id').value = '';
  document.getElementById('mov-fecha').value = todayISO();
  toggleTipoMovimiento();
  openModal('modal-movimiento');
}

function toggleTipoMovimiento() {
  const flujo = document.getElementById('mov-flujo').value;
  const selTipo = document.getElementById('mov-tipo');
  if (!selTipo) return;

  const opciones = {
    INGRESO: [
      { v: 'VENTA',            l: 'Venta' },
      { v: 'COBRO',            l: 'Cobro a cliente' },
      { v: 'CAPITAL_AGREGADO', l: 'Ingreso a caja' },
      { v: 'OTRO_INGRESO',     l: 'Otro ingreso' },
    ],
    EGRESO: [
      { v: 'COMPRA',       l: 'Compra de mercancía' },
      { v: 'GASTO',        l: 'Gasto operativo' },
      { v: 'RETIRO',       l: 'Retiro de caja' },
      { v: 'PAGO',         l: 'Pago a proveedor' },
      { v: 'PAGO_SALARIO', l: 'Pago de salario' },
      { v: 'OTRO_EGRESO',  l: 'Otro egreso' },
    ],
  };

  const list = opciones[flujo] || opciones.INGRESO;
  selTipo.innerHTML = list.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
}

async function saveMovimiento() {
  const flujo        = document.getElementById('mov-flujo').value;
  const tipo         = document.getElementById('mov-tipo').value;
  const concepto     = document.getElementById('mov-concepto').value.trim();
  const monto        = parseFloat(document.getElementById('mov-monto').value);
  const metodoPagoId = document.getElementById('mov-metodo').value;
  const observaciones= document.getElementById('mov-obs').value.trim();
  const fecha        = document.getElementById('mov-fecha').value || todayISO();

  if (!concepto)        { showToast('El concepto es requerido', 'error'); return; }
  if (!monto || monto <= 0) { showToast('El monto debe ser mayor a 0', 'error'); return; }

  const metodoPago       = STATE.metodosPago.find(m => m.id === metodoPagoId);
  const metodoPagoNombre = metodoPago?.nombre || 'Efectivo';

  try {
    setBtnLoading('btn-save-mov', true);

    const { data: ultMov } = await sbClient
      .from('movimientos_financieros')
      .select('saldo_resultante')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const saldoAnterior   = ultMov ? Number(ultMov.saldo_resultante) : 0;
    const saldoResultante = flujo === 'INGRESO'
      ? saldoAnterior + monto
      : saldoAnterior - monto;

    await sbClient.from('movimientos_financieros').insert({
      auth_user_id:       STATE.userId,
      tipo_flujo:         flujo,
      tipo_movimiento:    tipo,
      concepto,
      monto,
      saldo_anterior:     saldoAnterior,
      saldo_resultante:   saldoResultante,
      metodo_pago_id:     metodoPagoId || null,
      metodo_pago_nombre: metodoPagoNombre,
      observaciones:      observaciones || null,
      fecha,
      estado:             'completado',
    });

    STATE.caja = saldoResultante;

    closeModal('modal-movimiento');
    showToast('Movimiento registrado correctamente');

    await Promise.all([loadResumen(), loadMovimientos()]);
    actualizarCacheLocal();

  } catch(e) {
    console.error('saveMovimiento:', e);
    showToast('Error al guardar el movimiento', 'error');
  } finally {
    setBtnLoading('btn-save-mov', false);
  }
}

/* =====================================================
   ANULAR MOVIMIENTO
===================================================== */
let movToAnular = null;

function confirmarAnular(id) {
  movToAnular = id;
  openModal('modal-confirmar');
}

async function anularMovimiento() {
  if (!movToAnular) return;
  try {
    setBtnLoading('btn-confirmar-anular', true);

    // FIX: antes no se revisaba el resultado de este update — si fallaba
    // (por RLS, conexión, etc.) el sistema igual mostraba "Movimiento
    // anulado" sin haber cambiado nada en la base de datos, y el egreso
    // seguía contando en Caja y en "Otros egresos" como si nada. Ahora se
    // verifica el error Y que realmente se haya actualizado una fila
    // (.select() para confirmarlo) antes de dar el aviso de éxito.
    const { data, error } = await sbClient
      .from('movimientos_financieros')
      .update({
        estado:         'anulado',
        anulado_en:     new Date().toISOString(),
        anulado_motivo: 'Anulado manualmente',
      })
      .eq('id', movToAnular)
      .eq('auth_user_id', STATE.userId)
      .select('id');

    if (error) throw error;
    if (!data || !data.length) throw new Error('No se encontró el movimiento a anular (puede que ya no exista o no te pertenezca).');

    closeModal('modal-confirmar');
    movToAnular = null;
    showToast('Movimiento anulado');

    await loadCaja();
    await Promise.all([loadResumen(), loadMovimientos()]);
    actualizarCacheLocal();
  } catch(e) {
    console.error('anularMovimiento:', e);
    showToast('Error al anular: ' + (e.message || 'intenta de nuevo'), 'error');
  } finally {
    setBtnLoading('btn-confirmar-anular', false);
  }
}

/* =====================================================
   CIERRES DE CAJA
===================================================== */
async function loadCierres() {
  try {
    const { data } = await sbClient
      .from('cierres_caja')
      .select('*')
      .eq('auth_user_id', STATE.userId)
      .order('fecha', { ascending: false })
      .limit(30);
    STATE.cierres = data || [];
    renderCierres();
  } catch(e) { console.warn('loadCierres:', e); }
}

function renderCierres() {
  const tbody = document.getElementById('cierres-tbody');
  if (!tbody) return;

  if (!STATE.cierres.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Sin cierres registrados</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.cierres.map(c => {
    const flujoNeto = c.total_ingresos - c.total_egresos;
    return `
    <tr>
      <td>${fmtDate(c.fecha)}</td>
      <td>${fmt(c.saldo_inicial)}</td>
      <td class="td-entrada">${fmt(c.total_ingresos)}</td>
      <td class="td-salida">${fmt(c.total_egresos)}</td>
      <td style="color:${flujoNeto >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:700">${fmt(c.saldo_final)}</td>
      <td class="td-actions">
        <span class="badge-movs">${c.movimientos_count} mov.</span>
      </td>
    </tr>`;
  }).join('');
}

async function crearCierreDiario() {
  const hoy = todayISO();

  const { data: existing } = await sbClient
    .from('cierres_caja')
    .select('id')
    .eq('auth_user_id', STATE.userId)
    .eq('fecha', hoy)
    .maybeSingle();

  if (existing) {
    showToast('Ya existe un cierre para hoy', 'error');
    return;
  }

  try {
    setBtnLoading('btn-cierre-diario', true);

    const { data: movHoy } = await sbClient
      .from('movimientos_financieros')
      .select('tipo_flujo, monto, saldo_anterior')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .eq('fecha', hoy)
      .order('created_at');

    const movs = movHoy || [];
    const saldoInicial  = movs.length > 0 ? Number(movs[0].saldo_anterior) : STATE.caja;
    const totalIngresos = movs.filter(r => r.tipo_flujo === 'INGRESO').reduce((s,r) => s + Number(r.monto), 0);
    const totalEgresos  = movs.filter(r => r.tipo_flujo === 'EGRESO').reduce((s,r)  => s + Number(r.monto), 0);
    const saldoFinal    = saldoInicial + totalIngresos - totalEgresos;

    await sbClient.from('cierres_caja').insert({
      auth_user_id:     STATE.userId,
      fecha:            hoy,
      saldo_inicial:    saldoInicial,
      total_ingresos:   totalIngresos,
      total_egresos:    totalEgresos,
      saldo_final:      saldoFinal,
      movimientos_count: movs.length,
    });

    showToast('Cierre diario creado correctamente');
    await loadCierres();
  } catch(e) {
    showToast('Error al crear cierre', 'error');
  } finally {
    setBtnLoading('btn-cierre-diario', false);
  }
}

/* =====================================================
   MODAL DINERO INICIAL (primera vez)
===================================================== */
async function checkDineroInicial() {
  const hayMovs = await tieneMovimientos();
  if (!hayMovs) {
    openModal('modal-capital-inicial');
  } else {
    await loadCaja();
  }
}

async function guardarCapitalInicialModal() {
  const monto = parseFloat(document.getElementById('capital-inicial-monto').value);
  if (isNaN(monto) || monto < 0) {
    showToast('Ingresa un monto válido', 'error');
    return;
  }

  setBtnLoading('btn-guardar-capital-inicial', true);
  try {
    await guardarDineroInicial(monto);
  } catch(e) {
    // Esto SÍ es un error real de guardado — nada se guardó.
    console.error('guardarCapitalInicialModal (guardado):', e);
    showToast('No se pudo iniciar caja: ' + (e.message || e.details || 'error desconocido, revisa la consola'), 'error');
    setBtnLoading('btn-guardar-capital-inicial', false);
    return;
  }

  // A partir de aquí, el guardado YA se completó con éxito — lo que
  // sigue es solo refrescar lo que se ve en pantalla. Si algo de esto
  // fallara, nunca debe mostrarse como si el guardado hubiera
  // fallado (antes sí pasaba esto, y confundía).
  STATE.caja = monto;
  closeModal('modal-capital-inicial');
  showToast('Caja iniciada correctamente');
  try {
    await Promise.all([loadResumen(), loadMovimientos(), loadMetodosPago()]);
    actualizarCacheLocal();
  } catch(e) {
    console.warn('guardarCapitalInicialModal (refresco de pantalla, el guardado ya fue exitoso):', e);
    // No se muestra ningún error al usuario — ya se guardó bien. En
    // el peor de los casos, algo en pantalla no se actualizó solo,
    // pero eso se corrige con un simple refresco de la página.
  } finally {
    setBtnLoading('btn-guardar-capital-inicial', false);
  }
}

/* =====================================================
   CACHÉ LOCAL (para dashboard)
===================================================== */
function actualizarCacheLocal() {
  try {
    localStorage.setItem('n360_caja', STATE.caja.toString());
    localStorage.setItem('n360_caja_updated', new Date().toISOString());
    localStorage.setItem('n360_capital', STATE.caja.toString());
  } catch(e) { /* silencioso */ }
}

/* =====================================================
   API PÚBLICA (para ventas.js, gastos.js, compras.js)
===================================================== */
window.CajaAPI = {
  async registrarMovimiento(params) {
    try {
      const userId = params.auth_user_id || STATE.userId;
      if (!userId) throw new Error('userId requerido');

      const { data: ult } = await sbClient
        .from('movimientos_financieros')
        .select('saldo_resultante')
        .eq('auth_user_id', userId)
        .eq('estado', 'completado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const saldoAnt = ult ? Number(ult.saldo_resultante) : 0;
      const monto    = Number(params.monto);
      const saldoRes = params.tipo_flujo === 'INGRESO'
        ? saldoAnt + monto
        : saldoAnt - monto;

      const { error } = await sbClient.from('movimientos_financieros').insert({
        auth_user_id:       userId,
        tipo_flujo:         params.tipo_flujo,
        tipo_movimiento:    params.tipo_movimiento,
        concepto:           params.concepto,
        monto:              monto,
        saldo_anterior:     saldoAnt,
        saldo_resultante:   saldoRes,
        metodo_pago_nombre: params.metodo_pago_nombre || 'Efectivo',
        metodo_pago_id:     params.metodo_pago_id     || null,
        referencia_tipo:    params.referencia_tipo    || null,
        referencia_id:      params.referencia_id      || null,
        origen_caja:        params.origen_caja        || null,
        banco_id:           params.banco_id           || null,
        observaciones:      params.observaciones      || null,
        fecha:              params.fecha               || todayISO(),
        estado:             'completado',
      });

      if (error) throw error;

      try {
        localStorage.setItem('n360_caja', saldoRes.toString());
        localStorage.setItem('n360_capital', saldoRes.toString());
        localStorage.setItem('n360_caja_updated', new Date().toISOString());
      } catch (_) {}

      return { ok: true, saldoResultante: saldoRes };
    } catch(e) {
      console.error('CajaAPI.registrarMovimiento:', e);
      return { ok: false, error: e.message };
    }
  },

  async getCapital(userId) {
    try {
      const { data } = await sbClient
        .from('movimientos_financieros')
        .select('saldo_resultante')
        .eq('auth_user_id', userId || STATE.userId)
        .eq('estado', 'completado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? Number(data.saldo_resultante) : 0;
    } catch(e) { return 0; }
  },

  async getCaja(userId) {
    return this.getCapital(userId);
  },
};

/* =====================================================
   FILTROS DE MOVIMIENTOS
===================================================== */
function setFiltro(filtro) {
  STATE.movFilter = filtro;
  STATE.movPage   = 1;

  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filtro === filtro);
  });

  const customDates = document.getElementById('custom-dates');
  if (customDates) customDates.style.display = filtro === 'custom' ? 'flex' : 'none';

  loadMovimientos();
}

function buscarMovimientos() {
  STATE.movSearch = document.getElementById('mov-search')?.value || '';
  STATE.movPage   = 1;
  loadMovimientos();
}

function paginaAnterior() {
  if (STATE.movPage > 1) { STATE.movPage--; loadMovimientos(); }
}

function paginaSiguiente() {
  const totalPages = Math.ceil(STATE.movTotal / STATE.movPerPage);
  if (STATE.movPage < totalPages) { STATE.movPage++; loadMovimientos(); }
}

/* =====================================================
   SECCIONES (tabs)
===================================================== */
function setSection(section) {
  STATE.activeSection = section;
  document.querySelectorAll('.section-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.section === section);
  });
  document.querySelectorAll('.section-panel').forEach(p => {
    p.style.display = p.dataset.section === section ? 'block' : 'none';
  });

  if (section === 'movimientos') loadMovimientos();
  if (section === 'metodos')     loadMetodosPago();
  if (section === 'cierres')     loadCierres();
  if (section === 'cajachica')   loadCajaChica();
  if (section === 'bancos')      loadBancos();
}

/* =====================================================
   MODALES
===================================================== */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = 'flex';
    el.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = 'none';
    el.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
    document.body.style.overflow = '';
  }
});

/* =====================================================
   TOAST
===================================================== */
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} toast-show`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('toast-show'), 3500);
}

/* =====================================================
   HELPERS UI
===================================================== */
function setBtnLoading(id, loading) {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = loading;
  el.style.opacity = loading ? '0.6' : '1';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* =====================================================
   INIT PRINCIPAL
===================================================== */
async function initCaja() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');

  const now = new Date();
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = now.toLocaleDateString('es-NI', {
    day:'numeric', month:'long', year:'numeric'
  });

  try {
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    STATE.userId    = user.id;
    STATE.userEmail = user.email;

    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent   = user.email?.split('@')[0] || 'Usuario';
      document.getElementById('header-avatar').textContent = (user.email || 'U')[0].toUpperCase();
      document.getElementById('header-biz').textContent    = nombreNegocio();
    }

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await checkDineroInicial();

    await Promise.all([
      loadResumen(),
      loadMovimientos(),
      loadMetodosPago(),
    ]);

    actualizarCacheLocal();

  } catch(err) {
    console.error('initCaja:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

/* =====================================================
   AUTH LISTENER
===================================================== */
sbClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

/* =====================================================
   CAJA CHICA — apertura y cierre con conteo físico de billetes.
   NUNCA escribe en movimientos_financieros (eso sigue siendo
   exclusivo de Caja general) — solo LEE de ahí para armar el
   resumen del día y comparar contra lo contado en la mano.
===================================================== */
const CC_DENOMINACIONES = [
  { valor: 1000, tipo: 'Billete' }, { valor: 500, tipo: 'Billete' },
  { valor: 200,  tipo: 'Billete' }, { valor: 100, tipo: 'Billete' },
  { valor: 50,   tipo: 'Billete' }, { valor: 20,  tipo: 'Billete' },
  { valor: 10,   tipo: 'Billete' },
  { valor: 5,    tipo: 'Moneda' },  { valor: 1,   tipo: 'Moneda' },
  { valor: 0.50, tipo: 'Moneda' },  { valor: 0.25,tipo: 'Moneda' },
];
let CC = { sesionHoy: null, modoConteo: null, historial: [] };

/* =====================================================
   BANCOS — dinero de tarjeta/transferencia, separado por cada banco.
   Caja General sigue sumando todo junto, sin importar el método.
===================================================== */
function esTarjetaOTransferencia(m) {
  const metodo = (m.metodo_pago_nombre || '').toLowerCase();
  return metodo.includes('tarjeta') || metodo.includes('transferencia');
}

async function loadBancos() {
  try {
    const { data: bancos } = await sbClient.from('bancos').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('created_at');
    STATE.bancos = bancos || [];

    const { data: movs } = await sbClient.from('movimientos_financieros')
      .select('tipo_flujo, monto, metodo_pago_nombre, banco_id, concepto, fecha')
      .eq('auth_user_id', STATE.userId).eq('estado', 'completado');
    const lista = (movs || []).filter(esTarjetaOTransferencia);

    renderBancosGrid(lista);
    renderSinAsignar(lista);
  } catch (e) {
    console.error('loadBancos:', e);
  }
}

function simboloMoneda(moneda) { return moneda === 'USD' ? '$' : 'C$'; }
function fmtMoneda(n, moneda) { return `${simboloMoneda(moneda)} ${Number(n||0).toLocaleString('es-NI',{minimumFractionDigits:2})}`; }

function renderBancosGrid(lista) {
  const grid = document.getElementById('bancos-grid');
  if (!STATE.bancos.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:24px">
      Todavía no has creado ningún banco — cuando lo hagas, el dinero de tarjeta/transferencia empezará a separarse aquí.
    </div>`;
    document.getElementById('tasa-cambio-wrap').style.display = 'none';
    return;
  }

  // El campo de tasa de cambio solo se muestra si hay al menos un
  // banco en una moneda distinta a la moneda base del negocio — si
  // todo está en la misma moneda, nunca hace falta convertir nada.
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const hayMonedaDistinta = STATE.bancos.some(b => (b.moneda||'NIO') !== monedaBase);
  document.getElementById('tasa-cambio-wrap').style.display = hayMonedaDistinta ? '' : 'none';
  if (hayMonedaDistinta) {
    const inputTasa = document.getElementById('input-tasa-cambio');
    if (document.activeElement !== inputTasa) inputTasa.value = STATE.empresaConfig?.tasa_cambio_usd || '';
  }

  grid.innerHTML = STATE.bancos.map(b => {
    const monedaBanco = b.moneda || 'NIO';
    const delBanco = lista.filter(m => m.banco_id === b.id);
    // Si el banco es en una moneda distinta a la base, se suma el
    // monto YA CONVERTIDO a la moneda del banco (monto_moneda_banco)
    // — nunca el monto en moneda base, para que cuadre contra el
    // estado de cuenta real del banco en SU propia moneda.
    const montoDe = (m) => monedaBanco !== monedaBase ? Number(m.monto_moneda_banco ?? m.monto) : Number(m.monto);
    const saldo = round2(Number(b.saldo_inicial||0) + delBanco.reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? montoDe(m) : -montoDe(m)), 0));
    return `
      <div class="panel-card" style="margin:0">
        <div class="panel-body" style="cursor:pointer" onclick="verBanco('${b.id}')">
          <div style="font-size:12px;color:var(--text-muted)">${esc(b.nombre)} ${monedaBanco !== monedaBase ? `<span style="background:var(--accent-soft);color:var(--accent);border-radius:6px;padding:1px 6px;font-size:10px;font-weight:700">${monedaBanco}</span>` : ''}</div>
          ${b.numero_cuenta ? `<div style="font-size:11px;color:var(--text-muted)">${esc(b.numero_cuenta)}</div>` : ''}
          <div style="font-size:22px;font-weight:800;margin-top:6px">${fmtMoneda(saldo, monedaBanco)}</div>
        </div>
        <div style="padding:0 16px 14px;display:flex;gap:8px">
          <button class="btn-secondary btn-sm" style="flex:1" onclick="event.stopPropagation();abrirConciliarBanco('${b.id}','${esc(b.nombre)}')">🧾 Conciliar</button>
          <button class="btn-icon" title="Editar banco" onclick="event.stopPropagation();abrirEditarBanco('${b.id}')">✏️</button>
        </div>
      </div>`;
  }).join('');
}

async function guardarTasaCambio() {
  const valor = parseFloat(document.getElementById('input-tasa-cambio').value);
  if (isNaN(valor) || valor <= 0) { showToast('Ingresa una tasa de cambio válida', 'error'); return; }
  try {
    await sbClient.from('configuracion_empresa').update({ tasa_cambio_usd: valor }).eq('auth_user_id', STATE.userId);
    STATE.empresaConfig.tasa_cambio_usd = valor;
    showToast('Tasa de cambio actualizada');
  } catch (e) {
    showToast('No se pudo guardar la tasa de cambio', 'error');
  }
}
window.guardarTasaCambio = guardarTasaCambio;

function renderSinAsignar(lista) {
  const sinAsignar = lista.filter(m => !m.banco_id).sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  const tbody = document.getElementById('bancos-sin-asignar-tbody');
  if (!sinAsignar.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Todo el dinero de tarjeta/transferencia ya tiene banco asignado 🎉</td></tr>'; return; }
  tbody.innerHTML = sinAsignar.map(m => `
    <tr>
      <td>${fmtDate(m.fecha)}</td>
      <td>${esc(m.concepto || '—')}</td>
      <td>${esc(m.metodo_pago_nombre || '—')}</td>
      <td style="color:${m.tipo_flujo==='INGRESO'?'var(--success)':'var(--danger)'}">${m.tipo_flujo==='INGRESO'?'+':'-'}${fmt(m.monto)}</td>
      <td></td>
    </tr>`).join('');
}

function abrirNuevoBanco() {
  document.getElementById('nb-titulo').textContent = 'Nuevo banco';
  document.getElementById('nb-id').value = '';
  document.getElementById('nb-nombre').value = '';
  document.getElementById('nb-numero-cuenta').value = '';
  document.getElementById('nb-saldo-inicial').value = '0';
  document.getElementById('nb-error').textContent = '';
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  document.getElementById('nb-moneda').value = monedaBase;
  actualizarAvisoMonedaBanco();
  openModal('modal-nuevo-banco');
}

function abrirEditarBanco(bancoId) {
  const banco = STATE.bancos.find(b => b.id === bancoId);
  if (!banco) return;
  document.getElementById('nb-titulo').textContent = 'Editar banco';
  document.getElementById('nb-id').value = banco.id;
  document.getElementById('nb-nombre').value = banco.nombre || '';
  document.getElementById('nb-numero-cuenta').value = banco.numero_cuenta || '';
  document.getElementById('nb-saldo-inicial').value = banco.saldo_inicial || 0;
  document.getElementById('nb-moneda').value = banco.moneda || 'NIO';
  document.getElementById('nb-error').textContent = '';
  actualizarAvisoMonedaBanco();
  openModal('modal-nuevo-banco');
}

function actualizarAvisoMonedaBanco() {
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const monedaElegida = document.getElementById('nb-moneda').value;
  const aviso = document.getElementById('nb-moneda-aviso');
  aviso.textContent = monedaElegida !== monedaBase
    ? `Tu negocio opera en ${monedaBase} — los pagos a este banco se convertirán automáticamente usando tu tasa de cambio.`
    : '';
}
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('nb-moneda');
  if (sel) sel.addEventListener('change', actualizarAvisoMonedaBanco);
});

async function guardarNuevoBanco() {
  const errEl = document.getElementById('nb-error');
  errEl.textContent = '';
  const id = document.getElementById('nb-id').value || null;
  const nombre = document.getElementById('nb-nombre').value.trim();
  if (!nombre) { errEl.textContent = 'El nombre del banco es requerido.'; return; }

  const payload = {
    nombre, numero_cuenta: document.getElementById('nb-numero-cuenta').value.trim() || null,
    saldo_inicial: round2(parseFloat(document.getElementById('nb-saldo-inicial').value) || 0),
    moneda: document.getElementById('nb-moneda').value === 'USD' ? 'USD' : 'NIO',
  };

  setBtnLoading('btn-guardar-banco', true);
  try {
    if (id) {
      const { error } = await sbClient.from('bancos').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
      if (error) throw error;
      showToast('Banco actualizado');
    } else {
      const { error } = await sbClient.from('bancos').insert({ auth_user_id: STATE.userId, ...payload });
      if (error) throw error;
      showToast('Banco creado');
    }
    closeModal('modal-nuevo-banco');
    await loadBancos();
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-banco', false);
  }
}

async function verBanco(bancoId) {
  const banco = STATE.bancos.find(b => b.id === bancoId);
  if (!banco) return;
  document.getElementById('vb-titulo').textContent = banco.nombre;
  document.getElementById('vb-tbody').innerHTML = '<tr><td colspan="3" class="empty-cell">Cargando…</td></tr>';
  openModal('modal-ver-banco');

  const { data: movs } = await sbClient.from('movimientos_financieros')
    .select('fecha, concepto, monto, tipo_flujo').eq('auth_user_id', STATE.userId).eq('banco_id', bancoId).eq('estado','completado')
    .order('fecha', { ascending:false }).limit(100);
  const tbody = document.getElementById('vb-tbody');
  tbody.innerHTML = (movs||[]).length ? movs.map(m => `
    <tr><td>${fmtDate(m.fecha)}</td><td>${esc(m.concepto||'—')}</td>
    <td style="color:${m.tipo_flujo==='INGRESO'?'var(--success)':'var(--danger)'}">${m.tipo_flujo==='INGRESO'?'+':'-'}${fmt(m.monto)}</td></tr>
  `).join('') : '<tr><td colspan="3" class="empty-cell">Sin movimientos todavía</td></tr>';
}

/* =====================================================
   CONCILIACIÓN BANCARIA — comparar lo que registró el sistema
   contra el estado de cuenta real del banco. Solo se muestran los
   movimientos que TODAVÍA no se han conciliado antes — lo ya
   confirmado en conciliaciones anteriores no se vuelve a preguntar.
===================================================== */
let CONC = { bancoId: null, bancoNombre: null, movimientos: [], marcados: new Set(), saldoReconciliadoPrevio: 0 };

async function abrirConciliarBanco(bancoId, bancoNombre) {
  const banco = STATE.bancos.find(b => b.id === bancoId);
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const monedaBanco = banco?.moneda || 'NIO';
  CONC = { bancoId, bancoNombre, movimientos: [], marcados: new Set(), saldoReconciliadoPrevio: 0, moneda: monedaBanco, esOtraMoneda: monedaBanco !== monedaBase };
  document.getElementById('cb-banco-nombre').textContent = bancoNombre;
  document.getElementById('cb-saldo-banco').value = '';
  document.getElementById('cb-error').textContent = '';
  document.getElementById('cb-ajuste-form').style.display = 'none';
  document.getElementById('cb-movimientos-tbody').innerHTML = '<tr><td colspan="4" class="empty-cell">Cargando…</td></tr>';
  openModal('modal-conciliar-banco');

  // El punto de partida es el saldo inicial del banco (si ya tenía
  // dinero antes de empezar a usar el sistema) + todo lo ya
  // conciliado antes — sin el saldo inicial, la conciliación nunca
  // podría cuadrar si el banco no arrancó en cero. Todo esto en la
  // MONEDA REAL del banco, nunca en la moneda base del negocio.
  const saldoInicial = Number(banco?.saldo_inicial || 0);
  const { data: previos } = await sbClient.from('movimientos_financieros')
    .select('tipo_flujo, monto, monto_moneda_banco').eq('auth_user_id', STATE.userId).eq('banco_id', bancoId).eq('conciliado', true).eq('estado','completado');
  const montoDe = (m) => CONC.esOtraMoneda ? Number(m.monto_moneda_banco ?? m.monto) : Number(m.monto);
  const sumaConciliadoPrevio = (previos||[]).reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? montoDe(m) : -montoDe(m)), 0);
  CONC.saldoReconciliadoPrevio = round2(saldoInicial + sumaConciliadoPrevio);

  await cargarMovimientosConciliacion();
  await cargarHistorialConciliaciones();
  recalcularDiferenciaConciliacion();
}

async function cargarMovimientosConciliacion() {
  const { data } = await sbClient.from('movimientos_financieros')
    .select('id, fecha, concepto, monto, monto_moneda_banco, tipo_flujo').eq('auth_user_id', STATE.userId).eq('banco_id', CONC.bancoId)
    .eq('conciliado', false).eq('estado','completado').order('fecha');
  CONC.movimientos = data || [];
  renderMovimientosConciliacion();
}

function _montoConcMov(m) { return CONC.esOtraMoneda ? Number(m.monto_moneda_banco ?? m.monto) : Number(m.monto); }

function renderMovimientosConciliacion() {
  const tbody = document.getElementById('cb-movimientos-tbody');
  if (!CONC.movimientos.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No hay movimientos pendientes de conciliar — todo al día 🎉</td></tr>';
    return;
  }
  tbody.innerHTML = CONC.movimientos.map(m => `
    <tr>
      <td><input type="checkbox" ${CONC.marcados.has(m.id)?'checked':''} onchange="toggleMovConciliado('${m.id}', this.checked)"/></td>
      <td>${fmtDate(m.fecha)}</td>
      <td>${esc(m.concepto||'—')}</td>
      <td style="color:${m.tipo_flujo==='INGRESO'?'var(--success)':'var(--danger)'}">${m.tipo_flujo==='INGRESO'?'+':'-'}${fmtMoneda(_montoConcMov(m), CONC.moneda)}</td>
    </tr>`).join('');
}
function toggleMovConciliado(id, checked) {
  if (checked) CONC.marcados.add(id); else CONC.marcados.delete(id);
  recalcularDiferenciaConciliacion();
}

function recalcularDiferenciaConciliacion() {
  const sumaMarcados = CONC.movimientos.filter(m => CONC.marcados.has(m.id))
    .reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? _montoConcMov(m) : -_montoConcMov(m)), 0);
  const saldoCalculado = round2(CONC.saldoReconciliadoPrevio + sumaMarcados);
  const saldoBanco = round2(parseFloat(document.getElementById('cb-saldo-banco').value) || 0);
  const diferencia = round2(saldoBanco - saldoCalculado);

  document.getElementById('cb-saldo-calculado').textContent = fmtMoneda(saldoCalculado, CONC.moneda);
  const elDif = document.getElementById('cb-diferencia');
  elDif.textContent = fmtMoneda(diferencia, CONC.moneda);
  elDif.style.color = diferencia === 0 ? 'var(--success)' : 'var(--danger)';
  CONC._saldoCalculado = saldoCalculado;
  CONC._diferencia = diferencia;
}

function abrirAgregarAjusteConciliacion() {
  document.getElementById('cb-ajuste-monto-label').textContent = `Monto (en ${simboloMoneda(CONC.moneda)})`;
  document.getElementById('cb-ajuste-concepto').value = '';
  document.getElementById('cb-ajuste-monto').value = '';
  document.getElementById('cb-ajuste-tipo').value = 'EGRESO';
  document.getElementById('cb-ajuste-form').style.display = 'block';
}

async function guardarAjusteConciliacion() {
  const errEl = document.getElementById('cb-error');
  errEl.textContent = '';
  const concepto = document.getElementById('cb-ajuste-concepto').value.trim();
  const tipo = document.getElementById('cb-ajuste-tipo').value;
  const montoBanco = round2(parseFloat(document.getElementById('cb-ajuste-monto').value) || 0);
  if (!concepto) { errEl.textContent = 'Escribe un concepto para el ajuste.'; return; }
  if (montoBanco <= 0) { errEl.textContent = 'El monto debe ser mayor a cero.'; return; }

  // El monto que se escribe es en la MONEDA DEL BANCO (para que
  // cuadre contra su estado de cuenta real) — si el banco es en otra
  // moneda distinta a la base del negocio, se convierte para que
  // Caja General/Dashboard sigan sumando correcto en su propia moneda.
  let montoBase = montoBanco;
  if (CONC.esOtraMoneda) {
    const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) { errEl.textContent = 'Primero configura tu tasa de cambio arriba, antes de agregar un ajuste en esta moneda.'; return; }
    const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    montoBase = monedaBase === 'NIO' ? round2(montoBanco * tasa) : round2(montoBanco / tasa);
  }

  try {
    const { data: ultMov } = await sbClient.from('movimientos_financieros')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
      .order('created_at', { ascending:false }).limit(1).maybeSingle();
    const saldoAnterior = ultMov?.saldo_resultante || 0;
    const saldoResultante = tipo === 'INGRESO' ? saldoAnterior + montoBase : saldoAnterior - montoBase;

    const { data: nuevo, error } = await sbClient.from('movimientos_financieros').insert({
      auth_user_id: STATE.userId, tipo_flujo: tipo, tipo_movimiento: tipo === 'INGRESO' ? 'OTRO_INGRESO' : 'OTRO_EGRESO', concepto,
      monto: montoBase, monto_moneda_banco: CONC.esOtraMoneda ? montoBanco : null,
      saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
      metodo_pago_nombre: tipo === 'INGRESO' ? 'Transferencia' : 'Transferencia',
      banco_id: CONC.bancoId, fecha: todayISO(), estado: 'completado',
    }).select('id, fecha, concepto, monto, monto_moneda_banco, tipo_flujo').single();
    if (error) throw error;

    CONC.movimientos.push(nuevo);
    CONC.marcados.add(nuevo.id); // un ajuste que tú mismo agregas ya se da por conciliado de una vez
    renderMovimientosConciliacion();
    recalcularDiferenciaConciliacion();
    document.getElementById('cb-ajuste-form').style.display = 'none';
    showToast('Ajuste agregado');
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  }
}

async function cargarHistorialConciliaciones() {
  const { data } = await sbClient.from('conciliaciones_bancarias')
    .select('*').eq('auth_user_id', STATE.userId).eq('banco_id', CONC.bancoId).order('created_at', { ascending:false }).limit(12);
  const tbody = document.getElementById('cb-historial-tbody');
  tbody.innerHTML = (data||[]).length ? data.map(c => `
    <tr>
      <td>${fmtDate(c.periodo_hasta)}</td>
      <td>${fmt(c.saldo_banco_declarado)}</td>
      <td>${fmt(c.saldo_sistema_calculado)}</td>
      <td style="color:${c.diferencia===0?'var(--success)':'var(--danger)'}">${fmt(c.diferencia)}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty-cell">Sin conciliaciones todavía</td></tr>';
}

async function cerrarConciliacion() {
  const errEl = document.getElementById('cb-error');
  errEl.textContent = '';
  const saldoBanco = round2(parseFloat(document.getElementById('cb-saldo-banco').value) || 0);
  if (!document.getElementById('cb-saldo-banco').value) { errEl.textContent = 'Escribe el saldo que dice tu banco.'; return; }
  if (!CONC.marcados.size) { errEl.textContent = 'Marca al menos un movimiento, o agrega un ajuste.'; return; }

  recalcularDiferenciaConciliacion();
  if (CONC._diferencia !== 0) {
    errEl.textContent = `Todavía no cuadra: hay una diferencia de ${fmt(Math.abs(CONC._diferencia))}. Revisa si falta marcar algo o agregar un ajuste antes de cerrar.`;
    return;
  }

  setBtnLoading('btn-cerrar-conciliacion', true);
  try {
    const idsMarcados = Array.from(CONC.marcados);
    const fechas = CONC.movimientos.filter(m => CONC.marcados.has(m.id)).map(m => m.fecha);
    const periodoDesde = fechas.length ? fechas.reduce((a,b) => a<b?a:b) : todayISO();
    const periodoHasta = fechas.length ? fechas.reduce((a,b) => a>b?a:b) : todayISO();

    const { data: conciliacion, error: errC } = await sbClient.from('conciliaciones_bancarias').insert({
      auth_user_id: STATE.userId, banco_id: CONC.bancoId, periodo_desde: periodoDesde, periodo_hasta: periodoHasta,
      saldo_banco_declarado: saldoBanco, saldo_sistema_calculado: CONC._saldoCalculado, diferencia: CONC._diferencia,
    }).select('id').single();
    if (errC) throw errC;

    const { error: errU } = await sbClient.from('movimientos_financieros')
      .update({ conciliado: true, conciliacion_id: conciliacion.id }).in('id', idsMarcados);
    if (errU) throw errU;

    showToast('Conciliación cerrada — todo cuadra');
    await abrirConciliarBanco(CONC.bancoId, CONC.bancoNombre); // se recarga fresco, ya sin lo que se acaba de conciliar
  } catch (e) {
    errEl.textContent = 'Error al cerrar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-cerrar-conciliacion', false);
  }
}

async function loadCajaChica() {
  try {
    const hoy = todayISO();
    const { data } = await sbClient.from('caja_chica_sesiones')
      .select('*').eq('auth_user_id', STATE.userId).eq('fecha', hoy).maybeSingle();
    CC.sesionHoy = data || null;
    renderEstadoCajaChica();
    await loadHistorialCC();
  } catch (e) {
    console.warn('loadCajaChica:', e);
  }
}

function renderEstadoCajaChica() {
  const cont = document.getElementById('cc-estado-card');
  if (!cont) return;
  const s = CC.sesionHoy;

  if (!s) {
    cont.innerHTML = `
      <div class="panel-body" style="text-align:center;padding:34px 20px">
        <div style="font-size:32px;margin-bottom:8px">🔓</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px">Caja Chica cerrada — todavía no se ha abierto hoy</div>
        <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:16px">Cuenta el dinero con el que arrancas el día antes de empezar a vender.</p>
        <button class="btn-primary" onclick="abrirModalConteo('apertura')">Abrir Caja Chica</button>
      </div>`;
    return;
  }

  if (s.estado === 'abierta') {
    cont.innerHTML = `
      <div class="panel-body">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:12px;color:var(--text-muted)">🟢 Caja Chica abierta desde las ${new Date(s.abierta_en).toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'})}${s.abierta_por ? ' · '+esc(s.abierta_por) : ''}</div>
            <div style="font-size:22px;font-weight:800;margin-top:2px">${fmt(s.monto_apertura)} <span style="font-size:12px;color:var(--text-muted);font-weight:400">de apertura</span></div>
          </div>
          <button class="btn-primary" style="background:var(--danger)" onclick="abrirModalConteo('cierre')">Cerrar Caja Chica</button>
        </div>
        <div id="cc-resumen-vivo" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:12.5px;color:var(--text-muted)">Calculando el resumen de hoy…</div>
      </div>`;
    renderResumenVivoCC(s);
    return;
  }

  // Cerrada hoy
  const dif = Number(s.diferencia || 0);
  cont.innerHTML = `
    <div class="panel-body" style="text-align:center;padding:26px 20px">
      <div style="font-size:32px;margin-bottom:8px">${Math.abs(dif) < 0.5 ? '✅' : '⚠️'}</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">Caja Chica ya se cerró hoy</div>
      <p style="font-size:12.5px;color:var(--text-muted)">
        ${Math.abs(dif) < 0.5 ? 'Cuadró perfecto.' : (dif > 0 ? `Sobraron ${fmt(dif)}.` : `Faltaron ${fmt(Math.abs(dif))}.`)}
      </p>
      <button class="btn-secondary" style="margin-top:10px" onclick="verReporteCC('${s.id}')">Ver reporte de hoy</button>
    </div>`;
}

// Trae los movimientos de HOY (leyendo el mismo libro de Caja
// general, sin tocarlo) para mostrar cómo va el efectivo en vivo.
async function renderResumenVivoCC(sesion) {
  const el = document.getElementById('cc-resumen-vivo');
  if (!el) return;
  try {
    const hoy = todayISO();
    const { data: movs } = await sbClient.from('movimientos_financieros')
      .select('tipo_flujo, monto, metodo_pago_nombre').eq('auth_user_id', STATE.userId)
      .eq('estado','completado').eq('fecha', hoy);

    const lista = movs || [];
    const esEfectivo = m => (m.metodo_pago_nombre || 'Efectivo').toLowerCase().includes('efectivo');
    // Si Gastos/Compras ya dijeron explícitamente de dónde sale ese
    // dinero, se respeta eso — "general" nunca toca el cajón físico,
    // aunque haya sido en efectivo. Sin ese dato (Ventas, Créditos,
    // Salarios, etc.), sigue funcionando como siempre: por método de pago.
    const cuentaComoEgresoChica = m => m.origen_caja === 'general' ? false : (m.origen_caja === 'chica' ? true : esEfectivo(m));
    const ingEfectivo = lista.filter(m => m.tipo_flujo==='INGRESO' && esEfectivo(m)).reduce((s,m)=>s+Number(m.monto||0),0);
    const egrEfectivo = lista.filter(m => m.tipo_flujo==='EGRESO'  && cuentaComoEgresoChica(m)).reduce((s,m)=>s+Number(m.monto||0),0);
    const ingTotal    = lista.filter(m => m.tipo_flujo==='INGRESO').reduce((s,m)=>s+Number(m.monto||0),0);
    const egrTotal    = lista.filter(m => m.tipo_flujo==='EGRESO').reduce((s,m)=>s+Number(m.monto||0),0);
    const teorico = round2(Number(sesion.monto_apertura||0) + ingEfectivo - egrEfectivo);

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
        <div><div style="font-size:11px">Ingresos hoy (efectivo)</div><div style="font-weight:700;color:var(--success)">${fmt(ingEfectivo)}</div></div>
        <div><div style="font-size:11px">Egresos hoy (efectivo)</div><div style="font-weight:700;color:var(--danger)">${fmt(egrEfectivo)}</div></div>
        <div><div style="font-size:11px">Debería haber en efectivo</div><div style="font-weight:700">${fmt(teorico)}</div></div>
      </div>`;
  } catch (e) {
    el.textContent = 'No se pudo calcular el resumen de hoy.';
  }
}

async function loadHistorialCC() {
  try {
    const { data } = await sbClient.from('caja_chica_sesiones')
      .select('*').eq('auth_user_id', STATE.userId).eq('estado','cerrada')
      .order('fecha', { ascending:false }).limit(30);
    CC.historial = data || [];
    renderHistorialCC();
  } catch (e) { console.warn('loadHistorialCC:', e); }
}

function renderHistorialCC() {
  const tbody = document.getElementById('cc-historial-tbody');
  if (!tbody) return;
  if (!CC.historial.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Todavía no hay cierres de Caja Chica</td></tr>`;
    return;
  }
  tbody.innerHTML = CC.historial.map(s => {
    const dif = Number(s.diferencia||0);
    const cuadro = Math.abs(dif) < 0.5;
    return `
    <tr>
      <td>${fmtDate(s.fecha)}</td>
      <td>${fmt(s.monto_apertura)}</td>
      <td class="td-entrada">${fmt(s.total_ingresos)}</td>
      <td class="td-salida">${fmt(s.total_egresos)}</td>
      <td>${fmt(s.monto_cierre_real)}</td>
      <td style="color:${cuadro?'var(--success)':'var(--danger)'};font-weight:700">${cuadro ? '✅ Cuadró' : (dif>0?'+':'')+fmt(dif)}</td>
      <td class="td-actions"><button class="btn-icon" title="Ver reporte" onclick="verReporteCC('${s.id}')">📄</button></td>
    </tr>`;
  }).join('');
}

/* ---------- Modal de conteo de billetes ---------- */
function abrirModalConteo(modo) {
  CC.modoConteo = modo;
  document.getElementById('cc-conteo-titulo').textContent = modo === 'apertura' ? 'Contar dinero para abrir Caja Chica' : 'Contar dinero para cerrar Caja Chica';
  document.getElementById('cc-conteo-observaciones').value = '';
  const grid = document.getElementById('cc-denominaciones-grid');
  grid.innerHTML = CC_DENOMINACIONES.map(d => `
    <div>
      <label style="font-size:11.5px;color:var(--text-muted)">${d.tipo} de ${sym()}${d.valor}</label>
      <input type="number" min="0" step="1" value="" placeholder="0" class="cc-denom-input" data-valor="${d.valor}"
        oninput="actualizarTotalContado()" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-app);color:var(--text-primary)"/>
    </div>`).join('');
  actualizarTotalContado();
  openModal('modal-conteo-billetes');
}

function actualizarTotalContado() {
  let total = 0;
  document.querySelectorAll('.cc-denom-input').forEach(inp => {
    const cant = parseFloat(inp.value) || 0;
    total += cant * parseFloat(inp.dataset.valor);
  });
  document.getElementById('cc-total-contado').textContent = fmt(round2(total));
}

function leerDenominacionesContadas() {
  const det = {};
  let total = 0;
  document.querySelectorAll('.cc-denom-input').forEach(inp => {
    const cant = parseFloat(inp.value) || 0;
    if (cant > 0) { det[inp.dataset.valor] = cant; total += cant * parseFloat(inp.dataset.valor); }
  });
  return { detalle: det, total: round2(total) };
}

async function confirmarConteoBilletes() {
  const { detalle, total } = leerDenominacionesContadas();
  const obs = document.getElementById('cc-conteo-observaciones').value.trim() || null;
  const nombreUsuario = STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario';

  setBtnLoading('btn-confirmar-conteo', true);
  try {
    if (CC.modoConteo === 'apertura') {
      const { error } = await sbClient.from('caja_chica_sesiones').insert({
        auth_user_id: STATE.userId, fecha: todayISO(), estado: 'abierta',
        monto_apertura: total, denominacion_apertura: detalle,
        abierta_por: nombreUsuario, observaciones: obs,
      });
      if (error) throw error;
      showToast('Caja Chica abierta con ' + fmt(total));
    } else {
      // Cierre: se calcula lo TEÓRICO (solo efectivo) contra los
      // movimientos de hoy, y se compara con lo contado en la mano.
      const hoy = todayISO();
      const { data: movs } = await sbClient.from('movimientos_financieros')
        .select('tipo_flujo, monto, metodo_pago_nombre').eq('auth_user_id', STATE.userId)
        .eq('estado','completado').eq('fecha', hoy);
      const lista = movs || [];
      const esEfectivo = m => (m.metodo_pago_nombre || 'Efectivo').toLowerCase().includes('efectivo');
      const cuentaComoEgresoChica = m => m.origen_caja === 'general' ? false : (m.origen_caja === 'chica' ? true : esEfectivo(m));
      const ingEfectivo = round2(lista.filter(m => m.tipo_flujo==='INGRESO' && esEfectivo(m)).reduce((s,m)=>s+Number(m.monto||0),0));
      const egrEfectivo = round2(lista.filter(m => m.tipo_flujo==='EGRESO'  && cuentaComoEgresoChica(m)).reduce((s,m)=>s+Number(m.monto||0),0));
      const ingTotal = round2(lista.filter(m => m.tipo_flujo==='INGRESO').reduce((s,m)=>s+Number(m.monto||0),0));
      const egrTotal = round2(lista.filter(m => m.tipo_flujo==='EGRESO').reduce((s,m)=>s+Number(m.monto||0),0));
      const teorico = round2(Number(CC.sesionHoy.monto_apertura||0) + ingEfectivo - egrEfectivo);
      const diferencia = round2(total - teorico);

      const { error } = await sbClient.from('caja_chica_sesiones').update({
        estado: 'cerrada',
        monto_cierre_teorico: teorico, monto_cierre_real: total, denominacion_cierre: detalle,
        diferencia,
        total_ingresos: ingTotal, total_egresos: egrTotal,
        total_ingresos_efectivo: ingEfectivo, total_egresos_efectivo: egrEfectivo,
        movimientos_count: lista.length,
        cerrada_en: new Date().toISOString(), cerrada_por: nombreUsuario,
        observaciones: obs, updated_at: new Date().toISOString(),
      }).eq('id', CC.sesionHoy.id).eq('auth_user_id', STATE.userId);
      if (error) throw error;

      showToast(Math.abs(diferencia) < 0.5 ? 'Caja Chica cerrada — cuadró perfecto ✅' : `Caja Chica cerrada — ${diferencia>0?'sobraron':'faltaron'} ${fmt(Math.abs(diferencia))}`, Math.abs(diferencia)<0.5 ? 'success' : 'warning');
    }
    closeModal('modal-conteo-billetes');
    await loadCajaChica();
  } catch (e) {
    console.error('confirmarConteoBilletes:', e);
    showToast('Error al guardar: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-confirmar-conteo', false);
  }
}

/* ---------- Reporte de cierre ---------- */
CC.reporteActual = null;
async function verReporteCC(sesionId) {
  try {
    const { data: s } = await sbClient.from('caja_chica_sesiones').select('*').eq('id', sesionId).eq('auth_user_id', STATE.userId).maybeSingle();
    if (!s) { showToast('No se encontró ese cierre', 'error'); return; }
    CC.reporteActual = s;

    const filaDenom = (obj, titulo) => {
      const entradas = Object.entries(obj || {}).sort((a,b) => Number(b[0])-Number(a[0]));
      if (!entradas.length) return `<div style="font-size:12px;color:var(--text-muted)">${titulo}: sin desglose</div>`;
      return `<div style="margin-bottom:8px"><strong style="font-size:12.5px">${titulo}</strong>` +
        entradas.map(([val,cant]) => `<div class="tp-row" style="font-size:12px"><span>${sym()}${val} × ${cant}</span><span>${fmt(Number(val)*Number(cant))}</span></div>`).join('') + `</div>`;
    };

    const dif = Number(s.diferencia||0);
    document.getElementById('cc-reporte-body').innerHTML = `
      <div class="ticket-print">
        <div style="text-align:center;font-weight:800;margin-bottom:4px">${esc(STATE.empresaConfig?.nombre_comercial || 'Mi negocio')}</div>
        <div style="text-align:center;color:var(--text-muted);margin-bottom:8px">Reporte de Caja Chica — ${fmtDate(s.fecha)}</div>
        <hr/>
        <div class="tp-row"><span>Apertura:</span><b>${new Date(s.abierta_en).toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'})} — ${esc(s.abierta_por||'—')}</b></div>
        <div class="tp-row"><span>Cierre:</span><b>${s.cerrada_en ? (new Date(s.cerrada_en).toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'}) + ' — ' + esc(s.cerrada_por||'—')) : '—'}</b></div>
        <hr/>
        ${filaDenom(s.denominacion_apertura, 'Billetes/monedas en la apertura')}
        ${filaDenom(s.denominacion_cierre, 'Billetes/monedas en el cierre')}
        <hr/>
        <div class="tp-row"><span>Monto de apertura:</span><b>${fmt(s.monto_apertura)}</b></div>
        <div class="tp-row"><span>Ingresos del día (todos):</span><b>${fmt(s.total_ingresos)}</b></div>
        <div class="tp-row"><span>Egresos del día (todos):</span><b>${fmt(s.total_egresos)}</b></div>
        <div class="tp-row"><span>Debería haber (teórico, efectivo):</span><b>${fmt(s.monto_cierre_teorico)}</b></div>
        <div class="tp-row"><span>Se contó (real):</span><b>${fmt(s.monto_cierre_real)}</b></div>
        <div class="tp-row" style="font-weight:800;color:${Math.abs(dif)<0.5?'var(--success)':'var(--danger)'}"><span>Diferencia:</span><b>${Math.abs(dif)<0.5?'Cuadró ✅':(dif>0?'Sobraron '+fmt(dif):'Faltaron '+fmt(Math.abs(dif)))}</b></div>
        ${s.observaciones ? `<hr/><div style="font-size:11px;color:var(--text-muted)">Nota: ${esc(s.observaciones)}</div>` : ''}
      </div>`;
    openModal('modal-reporte-cc');
  } catch (e) {
    showToast('Error al cargar el reporte', 'error');
  }
}
function imprimirReporteCC() {
  const html = document.getElementById('cc-reporte-body').innerHTML;
  const w = window.open('', '_blank', 'width=380,height=650');
  w.document.write(`<html><head><meta charset="UTF-8"><title>Reporte Caja Chica</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;font-size:12.5px;padding:16px;max-width:320px;margin:0 auto}.tp-row{display:flex;justify-content:space-between;gap:10px}hr{border:none;border-top:1px dashed #999;margin:8px 0}</style>
    </head><body>${html}<script>window.print();</script></body></html>`);
  w.document.close();
}

/* =====================================================
   ARRANQUE
===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initCaja();
  if (window.lucide) lucide.createIcons();
});
