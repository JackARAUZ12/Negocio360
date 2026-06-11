/* =====================================================
   CAJA.JS — NEGOCIO360
   Centro financiero del sistema.
   Versión: 1.0 — Producción
===================================================== */

'use strict';

/* =====================================================
   SUPABASE CLIENT
===================================================== */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  currentUser:   {},
  capital:       0,
  metodosPago:   [],

  // Movimientos
  movimientos:   [],
  movPage:       1,
  movPerPage:    15,
  movFilter:     'mes',     // hoy | semana | mes | año | custom
  movSearch:     '',
  movDateFrom:   '',
  movDateTo:     '',
  movTotal:      0,

  // Cierres
  cierres:       [],

  // UI
  activeSection: 'resumen',  // resumen | movimientos | metodos | cierres
};

/* =====================================================
   HELPERS: FECHA
===================================================== */
function todayISO()       { return new Date().toISOString().split('T')[0]; }
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

function fmtShort(amount) {
  const n = Number(amount || 0);
  const s = sym();
  if (n >= 1_000_000) return `${s}${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${s}${(n/1_000).toFixed(1)}k`;
  return `${s}${n.toLocaleString('es-NI', { minimumFractionDigits: 0 })}`;
}

function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtDateFull(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('es-NI', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
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
   SIDEBAR
===================================================== */
let sidebarCollapsed = false;
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
  document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
}

function navigate(url) { window.location.href = url; }

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
      const bizName = data.nombre_negocio || data.nombre || 'Mi negocio';
      const logoText = document.getElementById('sidebar-logo-text');
      if (logoText) logoText.textContent = bizName;
      if (data.color_primario) {
        document.documentElement.style.setProperty('--accent', data.color_primario);
        document.documentElement.style.setProperty('--accent-soft', data.color_primario + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_primario);
      }
      if (data.logo_url) {
        const logoIcon = document.querySelector('.logo-icon');
        if (logoIcon) logoIcon.innerHTML = `<img src="${data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
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
  const bizName  = STATE.empresaConfig?.nombre_negocio || user.nombre_negocio || 'Mi negocio';
  const plan     = user.plan || 'Gratuito';
  const initials = ((nombre[0]||'') + (apellido[0]||'')).toUpperCase();

  document.getElementById('header-name').textContent = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent  = bizName;
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent   = plan.charAt(0).toUpperCase() + plan.slice(1);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('greeting-text').textContent = `${greet}, ${nombre}`;

  if (plan === 'pro' || plan === 'enterprise') {
    const box = document.getElementById('upgrade-box');
    if (box) box.style.display = 'none';
  }
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
   CAPITAL INICIAL
===================================================== */
async function loadCapital() {
  try {
    const { data } = await sbClient
      .from('capital_negocio')
      .select('monto')
      .eq('auth_user_id', STATE.userId)
      .eq('is_current', true)
      .maybeSingle();

    if (data) {
      STATE.capital = Number(data.monto) || 0;
      return true;
    }
    return false;
  } catch(e) {
    console.warn('loadCapital:', e);
    return false;
  }
}

async function calcCapitalDisponible() {
  // Capital = capital_inicial + suma de todos los ingresos - suma de todos los egresos
  try {
    const { data } = await sbClient
      .from('movimientos_financieros')
      .select('tipo_flujo, monto')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado');

    if (data) {
      const totalIng = data.filter(r => r.tipo_flujo === 'INGRESO').reduce((s,r) => s + Number(r.monto), 0);
      const totalEgr = data.filter(r => r.tipo_flujo === 'EGRESO').reduce((s,r) => s + Number(r.monto), 0);
      STATE.capital = STATE.capital + totalIng - totalEgr;
    }
  } catch(e) { console.warn('calcCapital:', e); }
}

async function guardarCapitalInicial(monto) {
  // Desactivar capital anterior
  await sbClient
    .from('capital_negocio')
    .update({ is_current: false })
    .eq('auth_user_id', STATE.userId)
    .eq('is_current', true);

  // Insertar nuevo
  const { error } = await sbClient
    .from('capital_negocio')
    .insert({
      auth_user_id: STATE.userId,
      monto:        Number(monto),
      concepto:     'Capital inicial',
      is_current:   true,
    });

  if (error) throw error;

  // Insertar movimiento de tipo CAPITAL_AGREGADO si no existe aún
  const { count } = await sbClient
    .from('movimientos_financieros')
    .select('id', { count: 'exact', head: true })
    .eq('auth_user_id', STATE.userId)
    .eq('tipo_movimiento', 'CAPITAL_AGREGADO');

  if (!count || count === 0) {
    await sbClient.from('movimientos_financieros').insert({
      auth_user_id:      STATE.userId,
      tipo_flujo:        'INGRESO',
      tipo_movimiento:   'CAPITAL_AGREGADO',
      concepto:          'Capital inicial del negocio',
      monto:             Number(monto),
      saldo_anterior:    0,
      saldo_resultante:  Number(monto),
      metodo_pago_nombre: 'Efectivo',
      fecha:             todayISO(),
    });
  }
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
      .select('tipo_flujo, monto, fecha')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .gte('fecha', monthStart)
      .lte('fecha', today);

    const ingresos  = (data||[]).filter(r => r.tipo_flujo === 'INGRESO').reduce((s,r) => s + Number(r.monto), 0);
    const egresos   = (data||[]).filter(r => r.tipo_flujo === 'EGRESO').reduce((s,r)  => s + Number(r.monto), 0);
    const flujoNeto = ingresos - egresos;
    const totalMov  = (data||[]).length;

    // KPI: Capital disponible
    setEl('kpi-capital', fmtShort(STATE.capital));
    setEl('kpi-capital-label', STATE.capital >= 0 ? 'positivo' : 'negativo', 'kpi-delta');

    // KPI: Ingresos del mes
    setEl('kpi-ingresos', fmtShort(ingresos));

    // KPI: Egresos del mes
    setEl('kpi-egresos', fmtShort(egresos));

    // KPI: Flujo neto
    setEl('kpi-flujo', fmtShort(flujoNeto));
    const flujoEl = document.getElementById('kpi-flujo');
    if (flujoEl) flujoEl.style.color = flujoNeto >= 0 ? 'var(--success)' : 'var(--danger)';

    // KPI: Movimientos
    setEl('kpi-movimientos', totalMov.toString());

    // Deltas
    setDelta('kpi-capital-delta',    STATE.capital >= 0 ? 'Saldo positivo' : 'Saldo negativo',       STATE.capital >= 0);
    setDelta('kpi-ingresos-delta',   ingresos > 0 ? `${(data||[]).filter(r=>r.tipo_flujo==='INGRESO').length} entradas` : 'Sin ingresos este mes', ingresos > 0);
    setDelta('kpi-egresos-delta',    egresos > 0  ? `${(data||[]).filter(r=>r.tipo_flujo==='EGRESO').length} salidas`   : 'Sin egresos este mes',  false);
    setDelta('kpi-flujo-delta',      flujoNeto >= 0 ? 'Flujo positivo' : 'Flujo negativo',            flujoNeto >= 0);
    setDelta('kpi-movimientos-delta', totalMov > 0 ? 'este mes' : 'Sin movimientos', totalMov > 0);

  } catch(e) { console.warn('loadResumen:', e); }
}

function setEl(id, value, colorClass) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  if (colorClass) el.className = colorClass;
}

function setDelta(id, text, positive) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `kpi-delta ${positive ? 'positive' : positive === false && text.includes('negativo') ? 'negative' : 'neutral'}`;
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

    // Paginación
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
  const el = document.getElementById('paginacion');
  if (!el) return;
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
    VENTA:          'Venta',
    COBRO:          'Cobro',
    CAPITAL_AGREGADO: 'Capital',
    OTRO_INGRESO:   'Otro ingreso',
    COMPRA:         'Compra',
    GASTO:          'Gasto',
    RETIRO:         'Retiro',
    PAGO:           'Pago',
    OTRO_EGRESO:    'Otro egreso',
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
      { v: 'VENTA',           l: 'Venta' },
      { v: 'COBRO',           l: 'Cobro a cliente' },
      { v: 'CAPITAL_AGREGADO',l: 'Capital agregado' },
      { v: 'OTRO_INGRESO',    l: 'Otro ingreso' },
    ],
    EGRESO: [
      { v: 'COMPRA',       l: 'Compra de mercancía' },
      { v: 'GASTO',        l: 'Gasto operativo' },
      { v: 'RETIRO',       l: 'Retiro de caja' },
      { v: 'PAGO',         l: 'Pago a proveedor' },
      { v: 'OTRO_EGRESO',  l: 'Otro egreso' },
    ],
  };

  const list = opciones[flujo] || opciones.INGRESO;
  selTipo.innerHTML = list.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
}

async function saveMovimiento() {
  const flujo       = document.getElementById('mov-flujo').value;
  const tipo        = document.getElementById('mov-tipo').value;
  const concepto    = document.getElementById('mov-concepto').value.trim();
  const monto       = parseFloat(document.getElementById('mov-monto').value);
  const metodoPagoId = document.getElementById('mov-metodo').value;
  const observaciones = document.getElementById('mov-obs').value.trim();
  const fecha       = document.getElementById('mov-fecha').value || todayISO();

  // Validaciones
  if (!concepto)        { showToast('El concepto es requerido', 'error'); return; }
  if (!monto || monto <= 0) { showToast('El monto debe ser mayor a 0', 'error'); return; }

  // Nombre del método de pago
  const metodoPago = STATE.metodosPago.find(m => m.id === metodoPagoId);
  const metodoPagoNombre = metodoPago?.nombre || 'Efectivo';

  try {
    setBtnLoading('btn-save-mov', true);

    // Calcular saldo anterior (último movimiento del usuario)
    const { data: ultMov } = await sbClient
      .from('movimientos_financieros')
      .select('saldo_resultante')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const saldoAnterior   = ultMov ? Number(ultMov.saldo_resultante) : STATE.capital;
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
    });

    // Actualizar capital en estado
    STATE.capital = saldoResultante;
    closeModal('modal-movimiento');
    showToast('Movimiento registrado correctamente');

    // Refrescar
    await Promise.all([loadResumen(), loadMovimientos()]);
    actualizarDashboardStorage();

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
        estado:        'anulado',
        anulado_en:    new Date().toISOString(),
        anulado_motivo: 'Anulado manualmente',
      })
      .eq('id', movToAnular)
      .eq('auth_user_id', STATE.userId);

    closeModal('modal-confirmar');
    movToAnular = null;
    showToast('Movimiento anulado');
    await Promise.all([loadResumen(), loadMovimientos()]);
    actualizarDashboardStorage();
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

  // Verificar si ya existe cierre hoy
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

    // Obtener movimientos de hoy
    const { data: movHoy } = await sbClient
      .from('movimientos_financieros')
      .select('tipo_flujo, monto, saldo_anterior')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .eq('fecha', hoy)
      .order('created_at');

    const movs = movHoy || [];
    const saldoInicial  = movs.length > 0 ? Number(movs[0].saldo_anterior) : STATE.capital;
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
   CAPITAL: MODAL EDITAR
===================================================== */
function openEditCapital() {
  document.getElementById('capital-monto-edit').value = STATE.capital;
  openModal('modal-capital');
}

async function saveCapital() {
  const monto = parseFloat(document.getElementById('capital-monto-edit').value);
  if (isNaN(monto) || monto < 0) { showToast('Monto inválido', 'error'); return; }

  try {
    setBtnLoading('btn-save-capital', true);
    await guardarCapitalInicial(monto);
    STATE.capital = monto;
    closeModal('modal-capital');
    showToast('Capital actualizado');
    await loadResumen();
    actualizarDashboardStorage();
  } catch(e) {
    showToast('Error al actualizar capital', 'error');
  } finally {
    setBtnLoading('btn-save-capital', false);
  }
}

/* =====================================================
   MODAL CAPITAL INICIAL (primera vez)
===================================================== */
async function checkCapitalInicial() {
  const existe = await loadCapital();
  if (!existe) {
    // Calcular saldo desde movimientos igualmente (por si acaso)
    await calcCapitalDisponible();
    // Mostrar modal obligatorio
    openModal('modal-capital-inicial');
  } else {
    await calcCapitalDisponible();
  }
}

async function guardarCapitalInicialModal() {
  const monto = parseFloat(document.getElementById('capital-inicial-monto').value);
  if (isNaN(monto) || monto < 0) { showToast('Ingresa un monto válido', 'error'); return; }

  try {
    setBtnLoading('btn-guardar-capital-inicial', true);
    await guardarCapitalInicial(monto);
    STATE.capital = monto;
    closeModal('modal-capital-inicial');
    showToast('Capital inicial guardado');
    await Promise.all([loadResumen(), loadMovimientos(), loadMetodosPago()]);
    actualizarDashboardStorage();
  } catch(e) {
    showToast('Error al guardar capital', 'error');
  } finally {
    setBtnLoading('btn-guardar-capital-inicial', false);
  }
}

/* =====================================================
   INTEGRACIÓN CON DASHBOARD
   Esta función actualiza localStorage para que el
   dashboard pueda leer datos de caja en tiempo real.
   Cuando el dashboard use loadCaja(), leerá de Supabase
   directamente, pero esto sirve como caché rápida.
===================================================== */
function actualizarDashboardStorage() {
  try {
    localStorage.setItem('n360_capital', STATE.capital.toString());
    localStorage.setItem('n360_caja_updated', new Date().toISOString());
  } catch(e) { /* silencioso */ }
}

/* =====================================================
   API PÚBLICA: para uso desde otros módulos
   Ejemplo de uso desde ventas.js:
     await CajaAPI.registrarMovimiento({
       tipo_flujo: 'INGRESO',
       tipo_movimiento: 'VENTA',
       concepto: `Venta #${ventaId}`,
       monto: totalVenta,
       referencia_tipo: 'venta',
       referencia_id: ventaId,
       metodo_pago_nombre: 'Efectivo',
       fecha: todayISO(),
     });
===================================================== */
window.CajaAPI = {

  // Registrar movimiento desde otro módulo
  async registrarMovimiento(params) {
    try {
      const userId = params.auth_user_id || STATE.userId;
      if (!userId) throw new Error('userId requerido');

      // Obtener saldo actual
      const { data: ult } = await sbClient
        .from('movimientos_financieros')
        .select('saldo_resultante')
        .eq('auth_user_id', userId)
        .eq('estado', 'completado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const saldoAnt = ult ? Number(ult.saldo_resultante) : 0;
      const saldoRes = params.tipo_flujo === 'INGRESO'
        ? saldoAnt + Number(params.monto)
        : saldoAnt - Number(params.monto);

      const { error } = await sbClient.from('movimientos_financieros').insert({
        auth_user_id:       userId,
        tipo_flujo:         params.tipo_flujo,
        tipo_movimiento:    params.tipo_movimiento,
        concepto:           params.concepto,
        monto:              Number(params.monto),
        saldo_anterior:     saldoAnt,
        saldo_resultante:   saldoRes,
        metodo_pago_nombre: params.metodo_pago_nombre || 'Efectivo',
        metodo_pago_id:     params.metodo_pago_id || null,
        referencia_tipo:    params.referencia_tipo || null,
        referencia_id:      params.referencia_id || null,
        observaciones:      params.observaciones || null,
        fecha:              params.fecha || todayISO(),
      });

      if (error) throw error;
      return { ok: true, saldoResultante: saldoRes };
    } catch(e) {
      console.error('CajaAPI.registrarMovimiento:', e);
      return { ok: false, error: e.message };
    }
  },

  // Obtener capital actual
  async getCapital(userId) {
    const { data } = await sbClient
      .from('movimientos_financieros')
      .select('saldo_resultante')
      .eq('auth_user_id', userId || STATE.userId)
      .eq('estado', 'completado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? Number(data.saldo_resultante) : 0;
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
   SECCIONES (tabs de la página)
===================================================== */
function setSection(section) {
  STATE.activeSection = section;
  document.querySelectorAll('.section-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.section === section);
  });
  document.querySelectorAll('.section-panel').forEach(p => {
    p.style.display = p.dataset.section === section ? 'block' : 'none';
  });

  // Cargar datos de la sección activa
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

// Cerrar modal al hacer click fuera
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
  // Tema
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);

  // Fecha en header
  const now = new Date();
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = now.toLocaleDateString('es-NI', {
    day:'numeric', month:'long', year:'numeric'
  });

  try {
    // 1. Sesión
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    STATE.userId    = user.id;
    STATE.userEmail = user.email;

    if (user.email) checkAdminAccess(user.email);

    // 2. Config empresa
    await loadEmpresaConfig(user.id);

    // 3. Perfil usuario
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent = user.email?.split('@')[0] || 'Usuario';
      document.getElementById('header-avatar').textContent = (user.email || 'U')[0].toUpperCase();
    }

    // 4. Mostrar app
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    // 5. Capital inicial (puede mostrar modal)
    await checkCapitalInicial();

    // 6. Cargar datos principales
    await Promise.allSettled([
      loadResumen(),
      loadMovimientos(),
      loadMetodosPago(),
    ]);

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
