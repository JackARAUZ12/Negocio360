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
===================================================== */
function todayISO()        { return new Date().toISOString().split('T')[0]; }
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfWeekISO() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
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

  await sbClient
    .from('capital_negocio')
    .update({ is_current: false })
    .eq('auth_user_id', STATE.userId)
    .eq('is_current', true);

  await sbClient
    .from('capital_negocio')
    .insert({
      auth_user_id: STATE.userId,
      monto:        montoNum,
      concepto:     'Dinero inicial de caja',
      is_current:   true,
    });

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

    const ingresos = movs.filter(r => r.tipo_flujo === 'INGRESO').reduce((s,r) => s + Number(r.monto), 0);
    const egresos  = movs.filter(r => r.tipo_flujo === 'EGRESO').reduce((s,r)  => s + Number(r.monto), 0);
    const totalMov = movs.length;

    setEl('kpi-caja', fmt(STATE.caja));
    setDelta('kpi-caja-delta',
      STATE.caja >= 0 ? 'Saldo positivo' : 'Saldo negativo',
      STATE.caja >= 0);

    setEl('kpi-ingresos', fmt(ingresos));
    setDelta('kpi-ingresos-delta',
      ingresos > 0 ? `${movs.filter(r=>r.tipo_flujo==='INGRESO').length} entradas` : 'Sin ingresos este mes',
      ingresos > 0);

    setEl('kpi-egresos', fmt(egresos));
    setDelta('kpi-egresos-delta',
      egresos > 0 ? `${movs.filter(r=>r.tipo_flujo==='EGRESO').length} salidas` : 'Sin egresos este mes',
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
    // Se excluye CAPITAL_AGREGADO del lado ingreso porque es capital
    // aportado, no ingreso operativo del mes.
    const otrosIngresos = movs
      .filter(r => r.tipo_flujo === 'INGRESO' && !r.referencia_tipo && r.tipo_movimiento !== 'CAPITAL_AGREGADO')
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
      { v: 'COMPRA',      l: 'Compra de mercancía' },
      { v: 'GASTO',       l: 'Gasto operativo' },
      { v: 'RETIRO',      l: 'Retiro de caja' },
      { v: 'PAGO',        l: 'Pago a proveedor' },
      { v: 'OTRO_EGRESO', l: 'Otro egreso' },
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
    await sbClient
      .from('movimientos_financieros')
      .update({
        estado:         'anulado',
        anulado_en:     new Date().toISOString(),
        anulado_motivo: 'Anulado manualmente',
      })
      .eq('id', movToAnular)
      .eq('auth_user_id', STATE.userId);

    closeModal('modal-confirmar');
    movToAnular = null;
    showToast('Movimiento anulado');

    await loadCaja();
    await Promise.all([loadResumen(), loadMovimientos()]);
    actualizarCacheLocal();
  } catch(e) {
    showToast('Error al anular', 'error');
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

  try {
    setBtnLoading('btn-guardar-capital-inicial', true);
    await guardarDineroInicial(monto);
    STATE.caja = monto;
    closeModal('modal-capital-inicial');
    showToast('Caja iniciada correctamente');
    await Promise.all([loadResumen(), loadMovimientos(), loadMetodosPago()]);
    actualizarCacheLocal();
  } catch(e) {
    showToast('Error al iniciar caja', 'error');
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
   ARRANQUE
===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initCaja();
  if (window.lucide) lucide.createIcons();
});
