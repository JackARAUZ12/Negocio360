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
  const _pm = window.N360PeriodoMes && N360PeriodoMes.inicioISO(); if (_pm) return _pm;   // día de cierre del negocio (opcional)
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
function sym() { return monedaParaMostrar(STATE.empresaConfig?.moneda); }

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function fmt(amount) {
  if (amount === null || amount === undefined) return `${sym()} —`;
  return `${sym()} ${convertirParaMostrar(amount, STATE.empresaConfig?.moneda).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
// Trae TODAS las filas de una consulta, en páginas de 1,000 (la base no
// entrega más por consulta: en negocios grandes los totales salían incompletos).
// construir() debe devolver la consulta con un orden fijo.
async function traerTodasLasFilas(construir) {
  const todas = [];
  for (let desde = 0; desde < 200000; desde += 1000) {
    const { data, error } = await construir().range(desde, desde + 999);
    if (error) throw error;
    todas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}

async function loadResumen() {
  const monthStart = startOfMonthISO();
  const today      = todayISO();

  try {
    const data = await traerTodasLasFilas(() => sbClient
      .from('movimientos_financieros')
      .select('tipo_flujo, monto, fecha, referencia_tipo, tipo_movimiento')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .gte('fecha', monthStart)
      .lte('fecha', today)
      .order('created_at').order('id'));

    const movsTodos = data || [];
    // Las transferencias entre cuentas propias no son ingresos ni egresos del negocio.
    const movs = movsTodos.filter(r => !esTransferenciaInterna(r));

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
    const totalMov = movsTodos.length;

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
    const { error } = await sbClient.from('metodos_pago').update({ activo: nuevoEstado }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    await loadMetodosPago();
    showToast(nuevoEstado ? 'Método activado' : 'Método desactivado');
  } catch(e) { console.error('toggleMetodo:', e); showToast('Error al actualizar método', 'error'); }
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
      const { error: errDefault } = await sbClient.from('metodos_pago')
        .update({ es_default: false })
        .eq('auth_user_id', STATE.userId);
      if (errDefault) throw errDefault;
    }

    // BUG REAL CORREGIDO: ni el insert ni el update revisaban si
    // Supabase devolvía un error -- si el guardado fallaba por
    // cualquier motivo (ej. nombre repetido, un problema de red), el
    // sistema igual mostraba "Método creado/actualizado" como si
    // hubiera funcionado, sin que el método realmente quedara
    // guardado -- exactamente el sintoma de "no aparecen mis
    // métodos de pago" reportado por un cliente.
    if (id) {
      const { error: errUpd } = await sbClient.from('metodos_pago')
        .update({ nombre, descripcion, es_default: esDefault })
        .eq('id', id)
        .eq('auth_user_id', STATE.userId);
      if (errUpd) throw errUpd;
    } else {
      const orden = STATE.metodosPago.length + 1;
      const { error: errIns } = await sbClient.from('metodos_pago')
        .insert({ auth_user_id: STATE.userId, nombre, descripcion, es_default: esDefault, orden });
      if (errIns) throw errIns;
    }

    closeModal('modal-metodo');
    await loadMetodosPago();
    showToast(id ? 'Método actualizado' : 'Método creado');
  } catch(e) {
    console.error('saveMetodo:', e);
    const mensaje = e?.code === '23505'
      ? 'Ya tienes un método de pago con ese nombre'
      : (e?.message || 'No se pudo guardar, intenta de nuevo');
    showToast(mensaje, 'error');
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
        ${m.estado === 'anulado' ? '<span class="anulado-label">Anulado</span>' : m.transferencia_id ? '<span class="anulado-label" style="cursor:help" title="Una transferencia se revierte desde la pestaña Transferencias">🔁 Transferencia</span>' : moduloQueAnula(m) ? `<span class="anulado-label" style="cursor:help" title="Este movimiento pertenece a un documento de ${moduloQueAnula(m)}. Para que todo quede cuadrado, anula el documento desde ${moduloQueAnula(m)}: ahí se anula también este movimiento.">🔒 ${moduloQueAnula(m)}</span>` : `
          <button class="btn-icon btn-icon-danger" onclick="confirmarAnular('${m.id}')" title="Anular">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        `}
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
  // 💱 Ingresar el monto en la otra moneda (solo ayuda a escribir el monto).
  if (window.N360MonedaAlterna) {
    N360MonedaAlterna.adjuntar('mov-monto', () => ({ moneda: STATE.empresaConfig?.moneda, tasa: STATE.empresaConfig?.tasa_cambio_usd }));
    N360MonedaAlterna.reset('mov-monto');
  }
  document.getElementById('mov-id').value = '';
  document.getElementById('mov-fecha').value = todayISO();
  toggleTipoMovimiento();
  actualizarBancoMovimiento();
  openModal('modal-movimiento');
}

// Si el metodo elegido es Tarjeta o Transferencia y la cuenta ya tiene bancos, se pide de/hacia cual
// banco va el dinero (igual que en Ventas, Compras y Gastos). Con Efectivo no se muestra nada.
function actualizarBancoMovimiento() {
  const wrap = document.getElementById('mov-wrap-banco');
  const sel = document.getElementById('mov-banco');
  const hint = document.getElementById('mov-banco-hint');
  if (!wrap || !sel) return;
  const opt = document.getElementById('mov-metodo')?.selectedOptions?.[0];
  const nombre = (opt?.dataset?.nombre || '').toLowerCase();
  const necesita = (nombre.includes('tarjeta') || nombre.includes('transferencia')) && (STATE.bancos || []).length > 0;
  if (!necesita) { wrap.style.display = 'none'; sel.value = ''; if (hint) hint.textContent = ''; return; }
  const previo = sel.value;
  const flujo = document.getElementById('mov-flujo')?.value;
  document.getElementById('mov-banco-label').textContent = flujo === 'EGRESO' ? 'Banco del que sale el dinero *' : 'Banco al que entra el dinero *';
  sel.innerHTML = '<option value="">Selecciona un banco…</option>' +
    STATE.bancos.map(b => `<option value="${b.id}">${escHtml(b.nombre)}${(b.moneda || 'NIO') !== monedaBaseNegocio() ? ' (' + b.moneda + ')' : ''}</option>`).join('');
  if (previo && STATE.bancos.some(b => b.id === previo)) sel.value = previo;
  wrap.style.display = '';
  actualizarHintBancoMovimiento();
}

// Monto convertido a la moneda del banco elegido (null si es la misma moneda o falta la tasa).
function calcularMontoBancoMov(bancoId, monto) {
  const b = (STATE.bancos || []).find(x => x.id === bancoId);
  if (!b) return { banco: null, convertido: null, sinTasa: false };
  const base = monedaBaseNegocio();
  if ((b.moneda || 'NIO') === base) return { banco: b, convertido: null, sinTasa: false };
  const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
  if (!tasa) return { banco: b, convertido: null, sinTasa: true };
  // Si el monto se escribió con 💱 en la moneda de este banco, el banco usa ese monto exacto.
  const ma = window.N360MonedaAlterna ? N360MonedaAlterna.estado('mov-monto') : null;
  if (ma && ma.moneda === (b.moneda || 'NIO') && Math.abs(ma.base - monto) < 0.005) return { banco: b, convertido: ma.monto, sinTasa: false };
  return { banco: b, convertido: round2(base === 'NIO' ? monto / tasa : monto * tasa), sinTasa: false };
}

function actualizarHintBancoMovimiento() {
  const hint = document.getElementById('mov-banco-hint');
  if (!hint) return;
  const bancoId = document.getElementById('mov-banco')?.value;
  const monto = parseFloat(document.getElementById('mov-monto')?.value) || 0;
  const r = calcularMontoBancoMov(bancoId, monto);
  if (!r.banco) { hint.textContent = ''; return; }
  if (r.sinTasa) { hint.style.color = 'var(--danger)'; hint.textContent = 'Falta configurar tu tasa de cambio en Caja › Bancos para usar este banco.'; return; }
  hint.style.color = 'var(--text-muted)';
  hint.textContent = r.convertido != null ? `Se registrará en el banco como ${simboloMoneda(r.banco.moneda)} ${r.convertido.toLocaleString('es-NI', { minimumFractionDigits: 2 })}` : '';
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
  const notaOtra     = window.N360MonedaAlterna ? N360MonedaAlterna.nota('mov-monto', document.getElementById('mov-flujo')?.value === 'EGRESO' ? 'Salió en' : 'Entró en') : '';
  const observaciones= [document.getElementById('mov-obs').value.trim(), notaOtra].filter(Boolean).join(' · ');
  const fecha        = document.getElementById('mov-fecha').value || todayISO();

  if (!concepto)        { showToast('El concepto es requerido', 'error'); return; }
  if (!monto || monto <= 0) { showToast('El monto debe ser mayor a 0', 'error'); return; }

  const metodoPago       = STATE.metodosPago.find(m => m.id === metodoPagoId);
  const metodoPagoNombre = metodoPago?.nombre || 'Efectivo';

  // Banco (solo si el selector esta visible: Tarjeta/Transferencia con bancos creados)
  let bancoId = null, montoMonedaBanco = null;
  if (document.getElementById('mov-wrap-banco')?.style.display !== 'none') {
    bancoId = document.getElementById('mov-banco').value || null;
    if (!bancoId) { showToast('Selecciona el banco', 'error'); return; }
    const r = calcularMontoBancoMov(bancoId, monto);
    if (r.sinTasa) { showToast('Falta configurar tu tasa de cambio en Caja › Bancos', 'error'); return; }
    montoMonedaBanco = r.convertido;
  }

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

    const { error: errMov } = await sbClient.from('movimientos_financieros').insert({
      auth_user_id:       STATE.userId,
      tipo_flujo:         flujo,
      tipo_movimiento:    tipo,
      concepto,
      monto,
      saldo_anterior:     saldoAnterior,
      saldo_resultante:   saldoResultante,
      metodo_pago_id:     metodoPagoId || null,
      metodo_pago_nombre: metodoPagoNombre,
      banco_id:           bancoId,
      monto_moneda_banco: montoMonedaBanco,
      observaciones:      observaciones || null,
      fecha,
      estado:             'completado',
    });
    if (errMov) throw errMov;

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

// Movimientos que pertenecen a un documento con su propio "Anular"
// (Ventas, Gastos, Compras, pagos de Créditos) no se anulan sueltos
// desde Caja: así se anulaba el dinero y el documento seguía activo
// (venta que suma en reportes y descuenta inventario, pero sin su
// dinero en caja). Esos módulos ya anulan su movimiento de caja al
// anular el documento. Los demás tipos (pagos a proveedor, salarios,
// fiados, producción, movimientos manuales) siguen anulándose aquí,
// porque Caja es su única forma de anularlos.
const CAJA_ANULA_DESDE_MODULO = { venta: 'Ventas', gasto: 'Gastos', compra: 'Compras', credito: 'Créditos', devolucion_venta: 'Ventas (devolución)' };
function moduloQueAnula(m) {
  if (!m || !m.referencia_id) return null;
  return CAJA_ANULA_DESDE_MODULO[m.referencia_tipo] || null;
}

function confirmarAnular(id) {
  const m = (STATE.movimientos || []).find(x => x.id === id);
  const modulo = moduloQueAnula(m);
  if (modulo) {
    showToast(`Este movimiento se anula desde ${modulo}, anulando el documento.`, 'error');
    return;
  }
  movToAnular = id;
  openModal('modal-confirmar');
}

async function anularMovimiento() {
  if (!movToAnular) return;
  try {
    setBtnLoading('btn-confirmar-anular', true);

    // La anulacion la hace la base de datos: marca el movimiento Y corrige por su monto exacto
    // los saldos de los movimientos posteriores (antes el saldo en pantalla no se movia).
    // Las patas de una transferencia no se anulan sueltas: se revierten desde Transferencias.
    const { data, error } = await sbClient.rpc('anular_movimiento_caja', { p_id: movToAnular, p_motivo: 'Anulado manualmente' });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.mensaje || 'No se pudo anular el movimiento.');

    closeModal('modal-confirmar');
    movToAnular = null;
    showToast('Movimiento anulado');

    await refrescarTrasMovimiento();
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
      <td>
        ${fmtDate(c.fecha)}
        ${c.tipo === 'mensual' ? `<div style="font-size:10.5px;font-weight:700;color:var(--accent);margin-top:2px">📅 MENSUAL${c.periodo_inicio ? ` · ${fmtDate(c.periodo_inicio)} al ${fmtDate(c.periodo_fin)}` : ''}</div>` : ''}
        ${c.automatico ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">generado automáticamente</div>` : ''}
        ${c.monto_retirado ? `<div style="font-size:10.5px;color:var(--text-secondary);margin-top:1px">💼 Retiro ${fmt(c.monto_retirado)} · empezó de cero</div>` : ''}
        ${c.diferencia_arqueo ? `<div style="font-size:10.5px;color:${Number(c.diferencia_arqueo) < 0 ? 'var(--danger)' : 'var(--success)'};margin-top:1px">Arqueo: ${Number(c.diferencia_arqueo) < 0 ? 'faltante' : 'sobrante'} ${fmt(Math.abs(c.diferencia_arqueo))}</div>` : ''}
      </td>
      <td>${fmt(c.saldo_inicial)}</td>
      <td class="td-entrada">${fmt(c.total_ingresos)}</td>
      <td class="td-salida">${fmt(c.total_egresos)}</td>
      <td style="color:${flujoNeto >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:700">${fmt(c.saldo_final)}</td>
      <td class="td-actions" style="display:flex;align-items:center;gap:8px">
        <span class="badge-movs" style="cursor:pointer;text-decoration:underline" title="Ver detalle" onclick="verDetalleCierre('${c.fecha}'${c.tipo === 'mensual' && c.periodo_inicio ? `,'${c.periodo_inicio}',${Number(c.saldo_inicial) || 0}` : ''})">${c.movimientos_count} mov.</span>
        <button class="btn-icon" title="Deshacer este cierre — no borra ningún movimiento real, solo el recibo del cierre" onclick="confirmarDeshacerCierre('${c.id}','${fmtDate(c.fecha)}')" style="color:var(--danger)">↩️</button>
      </td>
    </tr>`;
  }).join('');
}

// Guarda el ultimo detalle cargado para poder exportarlo a PDF sin
// tener que volver a consultar la base de datos.
let DETALLE_CIERRE_ACTUAL = { fecha: null, movimientos: [], resumen: null };

// Reconstruye el detalle de un cierre (nuevo o viejo) consultando los
// movimientos reales de esa fecha -- mismo filtro exacto que ya usa
// crearCierreDiario() para calcular los totales, asi que el detalle
// siempre cuadra con los 4 numeros ya guardados. No se guarda nada
// nuevo en la base de datos -- funciona igual para cierres de hace
// meses que para uno recien hecho.
async function verDetalleCierre(fecha, desdeMensual, saldoInicialMensual) {
  openModal('modal-detalle-cierre');
  document.getElementById('dc-titulo').textContent = desdeMensual ? `Detalle del cierre — ${fmtDate(desdeMensual)} al ${fmtDate(fecha)}` : `Detalle del cierre — ${fmtDate(fecha)}`;
  document.getElementById('dc-resumen').innerHTML = '';
  document.getElementById('dc-tbody').innerHTML = `<tr><td colspan="4" class="empty-cell">Cargando…</td></tr>`;

  try {
    const { data: movs, error } = await sbClient
      .from('movimientos_financieros')
      .select('tipo_flujo, monto, concepto, tipo_movimiento, created_at, saldo_anterior')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .gte('fecha', desdeMensual || fecha).lte('fecha', fecha)
      .order('created_at').range(0, 4999);
    if (error) throw error;

    const lista = movs || [];
    const saldoInicial  = desdeMensual ? Number(saldoInicialMensual) || 0 : (lista.length > 0 ? Number(lista[0].saldo_anterior) : 0);
    const totalIngresos = lista.filter(r => r.tipo_flujo === 'INGRESO' && !esTransferenciaInterna(r)).reduce((s,r) => s + Number(r.monto), 0);
    const totalEgresos  = lista.filter(r => r.tipo_flujo === 'EGRESO' && !esTransferenciaInterna(r)).reduce((s,r)  => s + Number(r.monto), 0);
    const saldoFinal    = saldoInicial + totalIngresos - totalEgresos;

    DETALLE_CIERRE_ACTUAL = { fecha, movimientos: lista, resumen: { saldoInicial, totalIngresos, totalEgresos, saldoFinal } };

    document.getElementById('dc-resumen').innerHTML = `
      <div style="background:var(--bg-app,var(--bg-surface-2,#f5f5f7));border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:11px;color:var(--text-muted,#888);margin-bottom:4px">Saldo inicial</div>
        <div style="font-size:15px;font-weight:700">${fmt(saldoInicial)}</div>
      </div>
      <div style="background:var(--bg-app,var(--bg-surface-2,#f5f5f7));border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:11px;color:var(--text-muted,#888);margin-bottom:4px">Ingresos</div>
        <div style="font-size:15px;font-weight:700;color:var(--success,#22c55e)">${fmt(totalIngresos)}</div>
      </div>
      <div style="background:var(--bg-app,var(--bg-surface-2,#f5f5f7));border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:11px;color:var(--text-muted,#888);margin-bottom:4px">Egresos</div>
        <div style="font-size:15px;font-weight:700;color:var(--danger,#ef4444)">${fmt(totalEgresos)}</div>
      </div>
      <div style="background:var(--bg-app,var(--bg-surface-2,#f5f5f7));border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:11px;color:var(--text-muted,#888);margin-bottom:4px">Saldo final</div>
        <div style="font-size:15px;font-weight:700">${fmt(saldoFinal)}</div>
      </div>
    `;

    if (!lista.length) {
      document.getElementById('dc-tbody').innerHTML = `<tr><td colspan="4" class="empty-cell">Sin movimientos ese día</td></tr>`;
      return;
    }

    document.getElementById('dc-tbody').innerHTML = lista.map(m => `
      <tr>
        <td>${new Date(m.created_at).toLocaleTimeString('es-NI', { hour:'2-digit', minute:'2-digit' })}</td>
        <td>${tipoMovLabel(m.tipo_movimiento) || m.tipo_movimiento || '—'}</td>
        <td>${escHtml(m.concepto || '—')}</td>
        <td style="text-align:right;color:${m.tipo_flujo==='INGRESO'?'var(--success)':'var(--danger)'}">${m.tipo_flujo==='INGRESO'?'+':'-'}${fmt(m.monto)}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('verDetalleCierre:', e);
    document.getElementById('dc-tbody').innerHTML = `<tr><td colspan="4" class="empty-cell">No se pudo cargar el detalle</td></tr>`;
  }
}

// Exporta el detalle ya cargado en pantalla a un PDF -- mismo patron
// exacto (jsPDF + autoTable) que ya usan Ventas y Reportes.
function exportarDetalleCierrePDF() {
  const { fecha, movimientos, resumen } = DETALLE_CIERRE_ACTUAL;
  if (!fecha) { showToast('Primero abre el detalle de un cierre', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFontSize(14); doc.setFont(undefined, 'bold');
  doc.text(`Cierre de caja — ${fmtDate(fecha)}`, 10, 15);
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-NI')}`, 10, 21);

  let startY = 28;
  doc.autoTable({
    startY,
    head: [['Concepto', 'Monto']],
    body: [
      ['Saldo inicial', fmt(resumen.saldoInicial)],
      ['Total ingresos', fmt(resumen.totalIngresos)],
      ['Total egresos', fmt(resumen.totalEgresos)],
      ['Saldo final', fmt(resumen.saldoFinal)],
    ],
    theme: 'striped', headStyles: { fillColor: [90, 90, 244] }, margin: { left: 10, right: 10 }, styles: { fontSize: 9 },
  });
  startY = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(30);
  doc.text('Detalle de movimientos', 10, startY);
  startY += 4;

  doc.autoTable({
    startY,
    head: [['Hora', 'Tipo', 'Concepto', 'Monto']],
    body: movimientos.map(m => [
      new Date(m.created_at).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }),
      tipoMovLabel(m.tipo_movimiento) || m.tipo_movimiento || '—',
      m.concepto || '—',
      `${m.tipo_flujo === 'INGRESO' ? '+' : '-'}${fmt(m.monto)}`,
    ]),
    theme: 'grid', headStyles: { fillColor: [90, 90, 244] }, margin: { left: 10, right: 10 }, styles: { fontSize: 8 },
  });

  doc.save(`negocio360_cierre_caja_${fecha}.pdf`);
}

// Cierre MENSUAL (24-oct-2026): usa el DÍA DE CIERRE del negocio (Configuración ›
// Cierres; si no eligió, el mes calendario como siempre). Se abre una ventana con el
// resumen del período, el arqueo opcional (contar el dinero real) y, si el negocio lo
// quiere, "empezar de cero": el saldo del cierre se registra como RETIRO. Todo lo hace
// la base en UNA operación (caja_cierre_periodo); deshacer el cierre anula esos movimientos.
const CM = { desde: null, hasta: null, sistema: 0 };
function _isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function _finPeriodoActual(dia, hoy) {
  if (!dia) return _isoLocal(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
  return hoy.getDate() >= dia ? _isoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), dia))
                              : _isoLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 1, dia));
}
function _inicioPeriodo(dia, hasta) {
  const h = new Date(hasta + 'T12:00:00');
  return dia ? _isoLocal(new Date(h.getFullYear(), h.getMonth() - 1, dia + 1)) : _isoLocal(new Date(h.getFullYear(), h.getMonth(), 1));
}
function asegurarModalCierreMes() {
  if (document.getElementById('modal-cierre-mes')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div class="modal-overlay" id="modal-cierre-mes" onclick="if(event.target===this)closeModal('modal-cierre-mes')">
    <div class="modal-box" style="max-width:520px">
      <div class="modal-header"><span class="modal-title">Cierre del mes</span>
        <button class="modal-close" onclick="closeModal('modal-cierre-mes')">✕</button></div>
      <div class="modal-body">
        <div id="cm-periodo" style="font-weight:700;margin-bottom:8px"></div>
        <div id="cm-resumen" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;background:var(--bg-app);border-radius:10px;padding:10px 12px">Calculando…</div>
        <label style="display:flex;gap:8px;align-items:center;margin-top:14px;font-size:13px;font-weight:600">
          <input type="checkbox" id="cm-arqueo" style="width:auto" onchange="cmActualizar()"/> Conté el dinero (arqueo)</label>
        <div id="cm-arqueo-wrap" style="display:none;margin-top:6px">
          <input type="number" id="cm-contado" min="0" step="0.01" placeholder="¿Cuánto dinero había al cierre?" oninput="cmActualizar()"/>
          <div id="cm-dif" style="font-size:12.5px;margin-top:4px"></div>
        </div>
        <div style="margin-top:14px;font-size:13px;font-weight:600">¿Qué se hace con el dinero del cierre?</div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;font-size:13px"><input type="radio" name="cm-destino" value="retiro" style="width:auto;margin-top:3px" onchange="cmActualizar()"/>
          <span><b>Empezar de cero</b><br><span style="color:var(--text-muted);font-size:12px">Se registra un retiro por el saldo del cierre (se lo lleva el dueño o se deposita). La Caja empieza el nuevo período en cero.</span></span></label>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;font-size:13px"><input type="radio" name="cm-destino" value="queda" style="width:auto;margin-top:3px" onchange="cmActualizar()"/>
          <span><b>Se queda en Caja</b><br><span style="color:var(--text-muted);font-size:12px">Solo se guarda el resumen; la Caja sigue con su saldo.</span></span></label>
        <div id="cm-final" style="margin-top:10px;font-size:13px"></div>
        <p id="cm-error" style="color:var(--danger);font-size:12.5px"></p>
      </div>
      <div class="modal-footer"><button class="btn-ghost" onclick="closeModal('modal-cierre-mes')">Cancelar</button>
        <button class="btn-primary" id="cm-btn" onclick="confirmarCierreMensual()">Cerrar el mes</button></div>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);
}
async function crearCierreMensual() {
  asegurarModalCierreMes();
  document.getElementById('cm-error').textContent = '';
  document.getElementById('cm-arqueo').checked = false; document.getElementById('cm-contado').value = '';
  document.getElementById('cm-resumen').textContent = 'Calculando…';
  openModal('modal-cierre-mes');
  try {
    const { data: cfg } = await sbClient.from('configuracion_empresa').select('dia_cierre_mensual, cierre_empezar_cero').eq('auth_user_id', STATE.userId).maybeSingle();
    const dia = cfg?.dia_cierre_mensual || null;
    try { window.N360PeriodoMes?.guardar(STATE.userId, dia, cfg?.cierre_empezar_cero); } catch (_) {}
    CM.hasta = _finPeriodoActual(dia, new Date()); CM.desde = _inicioPeriodo(dia, CM.hasta);
    document.querySelector(`input[name="cm-destino"][value="${cfg?.cierre_empezar_cero ? 'retiro' : 'queda'}"]`).checked = true;
    document.getElementById('cm-periodo').textContent = `Período: ${fmtDate(CM.desde)} al ${fmtDate(CM.hasta)}${dia ? ` (tu día de cierre es el ${dia})` : ''}`;
    const { data: ya } = await sbClient.from('cierres_caja').select('id').eq('auth_user_id', STATE.userId).eq('fecha', CM.hasta).eq('tipo', 'mensual').maybeSingle();
    if (ya) { document.getElementById('cm-resumen').innerHTML = '<div style="grid-column:1/-1">Este período ya está cerrado. Si necesitas rehacerlo, deshaz el cierre en la lista de cierres.</div>'; document.getElementById('cm-btn').disabled = true; return; }
    document.getElementById('cm-btn').disabled = false;
    const movs = await traerTodasLasFilas(() => sbClient.from('movimientos_financieros')
      .select('tipo_flujo, monto, tipo_movimiento, fecha').eq('auth_user_id', STATE.userId).eq('estado', 'completado')
      .lte('fecha', CM.hasta).order('created_at').order('id'));
    let ini = 0, ing = 0, egr = 0;
    (movs || []).forEach(m => {
      const v = Number(m.monto) || 0, signo = m.tipo_flujo === 'INGRESO' ? 1 : -1;
      if (m.fecha < CM.desde) ini += signo * v;
      else if (!esTransferenciaInterna(m)) { if (signo > 0) ing += v; else egr += v; }
    });
    CM.sistema = Math.round((ini + ing - egr) * 100) / 100;
    document.getElementById('cm-resumen').innerHTML = `
      <span>Saldo al empezar el período</span><b style="text-align:right">${fmt(ini)}</b>
      <span>Entradas del período</span><b style="text-align:right;color:var(--success)">${fmt(ing)}</b>
      <span>Salidas del período</span><b style="text-align:right;color:var(--danger)">${fmt(egr)}</b>
      <span style="font-weight:700">Saldo según el sistema</span><b style="text-align:right;font-size:15px">${fmt(CM.sistema)}</b>`;
    cmActualizar();
  } catch (e) {
    console.error('crearCierreMensual:', e);
    document.getElementById('cm-resumen').textContent = 'No se pudo calcular el período. Intenta de nuevo.';
  }
}
function cmActualizar() {
  const arq = document.getElementById('cm-arqueo').checked;
  document.getElementById('cm-arqueo-wrap').style.display = arq ? '' : 'none';
  const contado = parseFloat(document.getElementById('cm-contado').value);
  const difEl = document.getElementById('cm-dif');
  let base = CM.sistema;
  if (arq && !isNaN(contado)) {
    const dif = Math.round((contado - CM.sistema) * 100) / 100;
    difEl.innerHTML = dif === 0 ? '<span style="color:var(--success)">✅ Cuadra exacto con el sistema.</span>'
      : dif < 0 ? `<span style="color:var(--danger)">Faltan ${fmt(-dif)}: se registrará como faltante.</span>`
      : `<span style="color:var(--success)">Sobran ${fmt(dif)}: se registrará como sobrante.</span>`;
    base = contado;
  } else difEl.textContent = '';
  const retiro = document.querySelector('input[name="cm-destino"]:checked')?.value === 'retiro';
  document.getElementById('cm-final').innerHTML = retiro
    ? `Se registrará un <b>retiro de ${fmt(Math.max(0, base))}</b> con fecha ${fmtDate(CM.hasta > todayISO() ? todayISO() : CM.hasta)} y la Caja empezará el nuevo período en cero.`
    : `La Caja sigue con su saldo (${fmt(base)} al cierre).`;
}
async function confirmarCierreMensual() {
  const err = document.getElementById('cm-error'); err.textContent = '';
  const arq = document.getElementById('cm-arqueo').checked;
  const contado = parseFloat(document.getElementById('cm-contado').value);
  if (arq && (isNaN(contado) || contado < 0)) { err.textContent = 'Escribe cuánto dinero contaste.'; return; }
  const retirar = document.querySelector('input[name="cm-destino"]:checked')?.value === 'retiro';
  try {
    setBtnLoading('cm-btn', true);
    const { data, error } = await sbClient.rpc('caja_cierre_periodo', { p_hasta: CM.hasta, p_efectivo_contado: arq ? Math.round(contado * 100) / 100 : null, p_retirar: retirar, p_nota: null });
    if (error) throw error;
    closeModal('modal-cierre-mes');
    showToast(retirar ? `Mes cerrado. Retiro de ${fmt(data?.retirado || 0)} registrado: la Caja empieza de cero.` : 'Cierre mensual creado correctamente');
    try { await refrescarTrasMovimiento(); } catch (_) {}
    await loadCierres();
  } catch (e) {
    console.error('confirmarCierreMensual:', e);
    err.textContent = e?.message && !/fetch/i.test(e.message) ? e.message : 'No se pudo cerrar el mes. Intenta de nuevo.';
  } finally { setBtnLoading('cm-btn', false); }
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
      .select('tipo_flujo, monto, saldo_anterior, tipo_movimiento')
      .eq('auth_user_id', STATE.userId)
      .eq('estado', 'completado')
      .eq('fecha', hoy)
      .order('created_at');

    const movs = movHoy || [];
    const saldoInicial  = movs.length > 0 ? Number(movs[0].saldo_anterior) : STATE.caja;
    const totalIngresos = movs.filter(r => r.tipo_flujo === 'INGRESO' && !esTransferenciaInterna(r)).reduce((s,r) => s + Number(r.monto), 0);
    const totalEgresos  = movs.filter(r => r.tipo_flujo === 'EGRESO' && !esTransferenciaInterna(r)).reduce((s,r)  => s + Number(r.monto), 0);
    const saldoFinal    = saldoInicial + totalIngresos - totalEgresos;

    await sbClient.from('cierres_caja').insert({
      auth_user_id:     STATE.userId,
      fecha:            hoy,
      tipo:             'diario',
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

// Deshacer un cierre — el cierre es solo un "recibo" (resumen guardado
// de ese día), no toca ni bloquea ningún movimiento real de Caja.
// Borrarlo es completamente seguro: tus ventas, compras, gastos, etc.
// de ese día siguen exactamente igual, solo desaparece este resumen,
// y el sistema vuelve a dejar hacer un cierre para esa fecha.
function confirmarDeshacerCierre(cierreId, fechaTexto) {
  const c = (STATE.cierres || []).find(x => x.id === cierreId);
  const extra = (c && c.movimientos_cierre && c.movimientos_cierre.length)
    ? '\n\nEste cierre registró ' + (c.monto_retirado ? 'un retiro de ' + fmt(c.monto_retirado) : '') + (c.monto_retirado && c.diferencia_arqueo ? ' y ' : '') + (c.diferencia_arqueo ? 'un ajuste de arqueo' : '') + ': también se anulará, y la Caja vuelve a como estaba.'
    : '';
  if (!confirm(`¿Deshacer el cierre del ${fechaTexto}?\n\nEsto NO borra ninguna venta, compra ni movimiento real — solo el resumen del cierre, para poder rehacerlo cuando de verdad corresponda.` + extra)) return;
  deshacerCierre(cierreId);
}

async function deshacerCierre(cierreId) {
  try {
    // La base borra el resumen y, si el cierre registró retiro o arqueo, los anula en la misma operación.
    const { data, error } = await sbClient.rpc('caja_cierre_deshacer', { p_id: cierreId });
    if (error) throw error;
    showToast(data?.movimientos_anulados ? `Cierre deshecho — se anularon ${data.movimientos_anulados} movimiento(s) que había creado (retiro/arqueo)` : 'Cierre deshecho — tus movimientos reales siguen intactos');
    await loadCierres();
    try { await refrescarTrasMovimiento(); } catch (_) {}
  } catch(e) {
    console.error('deshacerCierre:', e);
    showToast('No se pudo deshacer el cierre', 'error');
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
// Convierte a la moneda del banco cuando el módulo que llama no lo hizo.
async function _montoParaBancoCaja(userId, params) {
  try {
    if (!params.banco_id || params.monto_moneda_banco != null) return params.monto_moneda_banco != null ? params.monto_moneda_banco : null;
    const [{ data: b }, { data: cfg }] = await Promise.all([
      sbClient.from('bancos').select('moneda').eq('id', params.banco_id).eq('auth_user_id', userId).maybeSingle(),
      sbClient.from('configuracion_empresa').select('moneda, tasa_cambio_usd').eq('auth_user_id', userId).maybeSingle(),
    ]);
    const base = cfg?.moneda === 'USD' ? 'USD' : 'NIO';
    const mb = b?.moneda || 'NIO';
    const tasa = Number(cfg?.tasa_cambio_usd || 0);
    if (mb === base || !tasa) return null;
    const m = Number(params.monto);
    return Math.round((base === 'NIO' ? m / tasa : m * tasa) * 100) / 100;
  } catch (_) { return null; }
}
// Monto de un movimiento en la moneda del banco. Si quedó sin convertir (null),
// se convierte con la tasa actual en vez de tratar los córdobas como dólares.
function _montoMonedaBanco(m) {
  if (m.monto_moneda_banco != null) return Number(m.monto_moneda_banco);
  const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
  if (!tasa) return Number(m.monto);
  return round2(monedaBaseNegocio() === 'NIO' ? Number(m.monto) / tasa : Number(m.monto) * tasa);
}
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
      const montoBanco = await _montoParaBancoCaja(userId, params);
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
        monto_moneda_banco: montoBanco,
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
  if (section === 'transferencias') loadTransferencias();
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
    setTimeout(() => { try { N360CajaSegura.reintentarPendientes(sbClient, user.id); } catch (_) {} }, 3000);

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

    if (window.Negocio360Tutorial) {
      const pasosCaja = [
        { icono: '🏦', titulo: 'Bienvenido a Caja', texto: 'Aquí ves todo el dinero que entra y sale de tu negocio -- ventas, gastos, y movimientos manuales, todo en un solo lugar.' },
        { icono: '💵', titulo: 'Dinero inicial del día', texto: 'Cada día puedes registrar con cuánto efectivo abres, para que el cuadre de caja te salga exacto al cerrar.' },
        { icono: '📋', titulo: 'Movimientos manuales', texto: 'Si necesitas registrar una entrada o salida que no viene de una venta o gasto, aquí también puedes agregarla directo.' },
      ];
      Negocio360Tutorial.verificarYMostrar('caja', pasosCaja);
      Negocio360Tutorial.agregarBotonAyuda('caja', pasosCaja);
    }

    // Desde el aviso de "cierre de mes pendiente" › "Contar el dinero primero"
    if (new URLSearchParams(location.search).get('cierre') === '1') {
      try { history.replaceState(null, '', 'caja.html'); } catch (_) {}
      crearCierreMensual();
    }

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
// Denominaciones por moneda: Córdobas (las de siempre) y Dólares.
const CC_DENOM_POR_MONEDA = {
  NIO: CC_DENOMINACIONES,
  USD: [
    { valor: 100, tipo: 'Billete' }, { valor: 50, tipo: 'Billete' },
    { valor: 20,  tipo: 'Billete' }, { valor: 10, tipo: 'Billete' },
    { valor: 5,   tipo: 'Billete' }, { valor: 2,  tipo: 'Billete' },
    { valor: 1,   tipo: 'Billete' },
    { valor: 0.25, tipo: 'Moneda' }, { valor: 0.10, tipo: 'Moneda' },
    { valor: 0.05, tipo: 'Moneda' }, { valor: 0.01, tipo: 'Moneda' },
  ],
};
// Tasa "córdobas por 1 dólar": la de la empresa, o la del selector de
// moneda de este dispositivo si la empresa no la ha guardado.
function ccTasa() {
  const t = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
  if (t > 0) return t;
  return (typeof tasaVisualizacionActiva === 'function' ? tasaVisualizacionActiva() : null) || 0;
}
// Convierte un monto contado en `moneda` a la moneda OFICIAL del negocio
// (en la que viven todos los datos). Con otra moneda y sin tasa, no convierte.
function ccAOficial(monto, moneda, tasa) {
  const base = monedaBaseNegocio();
  const t = tasa || ccTasa();
  if (moneda === base || !t) return monto;
  if (base === 'NIO' && moneda === 'USD') return monto * t;
  if (base === 'USD' && moneda === 'NIO') return monto / t;
  return monto;
}
let CC = { sesionHoy: null, modoConteo: null, historial: [] };

/* =====================================================
   BANCOS — dinero de tarjeta/transferencia, separado por cada banco.
   Caja General sigue sumando todo junto, sin importar el método.
===================================================== */
function esTarjetaOTransferencia(m) {
  const metodo = (m.metodo_pago_nombre || '').toLowerCase();
  return metodo.includes('tarjeta') || metodo.includes('transferencia');
}

// Un movimiento cuenta para un banco si es un cobro por tarjeta/transferencia
// O una transferencia interna que entra/sale de ese banco (tiene banco_id).
function esMovDeBanco(m) {
  return esTarjetaOTransferencia(m) || (m.tipo_movimiento === 'TRANSFERENCIA' && !!m.banco_id);
}
function monedaBaseNegocio() { return STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO'; }
// UNA sola formula del saldo de un banco: la usan la tarjeta de Banco y el selector de transferencias.
function saldoBancoDe(b, movsDelBanco, monedaBase) {
  const monedaBanco = b.moneda || 'NIO';
  const montoDe = (m) => monedaBanco !== monedaBase ? _montoMonedaBanco(m) : Number(m.monto);
  return round2(Number(b.saldo_inicial || 0) + movsDelBanco.reduce((t, m) => t + (m.tipo_flujo === 'INGRESO' ? montoDe(m) : -montoDe(m)), 0));
}
async function calcularSaldoBanco(bancoId) {
  // Se leen TODOS los movimientos del banco (sin el tope de 1000 filas del
  // servidor): un saldo calculado con filas de menos sería un saldo falso.
  // Si la lectura falla se lanza el error (nunca se devuelve un saldo a medias).
  const [{ data: b }, movs] = await Promise.all([
    sbClient.from('bancos').select('*').eq('id', bancoId).eq('auth_user_id', STATE.userId).maybeSingle(),
    traerTodasLasFilas(() => sbClient.from('movimientos_financieros').select('tipo_flujo, monto, monto_moneda_banco, metodo_pago_nombre, banco_id, tipo_movimiento')
      .eq('auth_user_id', STATE.userId).eq('estado', 'completado').eq('banco_id', bancoId).order('created_at').order('id')),
  ]);
  if (!b) return 0;
  return saldoBancoDe(b, (movs || []).filter(esMovDeBanco), monedaBaseNegocio());
}

/* =====================================================
   TRANSFERENCIAS ENTRE CUENTAS PROPIAS -- mueve dinero
   entre Caja General, Caja Chica y los bancos, sin pasar
   por Movimientos/Conciliacion manualmente. Cada
   transferencia crea 2 movimientos reales ligados entre
   si (egreso en origen, ingreso en destino), usando el
   mismo mecanismo que ya calcula los saldos de Caja y
   Bancos -- no se toca ese calculo, solo se alimenta.
===================================================== */
async function obtenerCuentasTransferencia() {
  const { data: bancos } = await sbClient.from('bancos')
    .select('id, nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
  // "Caja General" NO es una cuenta real propia -- es el TOTAL que
  // suma efectivo + caja chica + todos los bancos, asi que no tiene
  // sentido transferir "hacia/desde" ella misma. Solo Caja Chica y
  // los bancos son cuentas reales que SI se pueden mover entre si.
  return [
    { valor: 'chica', label: '👛 Caja Chica', origen_caja: 'chica', banco_id: null },
    ...(bancos || []).map(b => ({ valor: 'banco:' + b.id, label: '🏦 ' + b.nombre, origen_caja: null, banco_id: b.id })),
  ];
}

async function abrirNuevaTransferencia() {
  document.getElementById('tr-error').textContent = '';
  document.getElementById('tr-monto').value = '';
  document.getElementById('tr-nota').value = '';
  const origenSel = document.getElementById('tr-origen');
  const destinoSel = document.getElementById('tr-destino');
  origenSel.innerHTML = '<option>Cargando saldos…</option>';
  destinoSel.innerHTML = '<option>Cargando saldos…</option>';
  openModal('modal-transferencia');

  const cuentas = await obtenerCuentasTransferencia();
  // Se muestra el saldo actual de cada cuenta junto a su nombre --
  // asi se ve de una vez cuanto hay disponible antes de transferir,
  // sin tener que ir a revisar Bancos o Caja Chica por separado.
  const cuentasConSaldo = await Promise.all(cuentas.map(async c => ({
    ...c, saldo: await obtenerSaldoActualCuenta(c.origen_caja, c.banco_id).catch(e => {
      console.error('saldo de cuenta:', e);
      showToast('No se pudo leer el saldo de una cuenta. Revisa tu conexión y vuelve a abrir.', 'error');
      return 0;
    }),
  })));
  STATE._cuentasTransferenciaCache = cuentasConSaldo;
  const opciones = cuentasConSaldo.map(c => `<option value="${c.valor}">${c.label} — ${fmt(c.saldo)}</option>`).join('');
  origenSel.innerHTML = opciones;
  destinoSel.innerHTML = opciones;
  // Por defecto, destino distinto del origen (si hay mas de 1 opcion)
  if (cuentasConSaldo.length > 1) destinoSel.selectedIndex = 1;
}

async function obtenerSaldoActualCuenta(origenCaja, bancoId) {
  // Cada cuenta se calcula con SU propia formula (la misma que muestra su pantalla):
  // Caja Chica = sesion + efectivo del cajon; Banco = saldo inicial + sus movimientos.
  if (origenCaja === 'chica') return await calcularSaldoTeoricoCajaChica();
  if (bancoId) return await calcularSaldoBanco(bancoId);
  return 0;
}

// Despues de mover dinero entre cuentas, TODAS las pantallas que lo muestran se actualizan.
async function refrescarTrasMovimiento() {
  await loadCaja();
  await Promise.allSettled([loadResumen(), loadMovimientos(), loadBancos(), loadCajaChica(), loadTransferencias()]);
  if (typeof actualizarCacheLocal === 'function') actualizarCacheLocal();
}

async function guardarTransferencia() {
  const errEl = document.getElementById('tr-error');
  errEl.textContent = '';
  const origenVal = document.getElementById('tr-origen').value;
  const destinoVal = document.getElementById('tr-destino').value;
  const monto = round2(parseFloat(document.getElementById('tr-monto').value));
  const nota = document.getElementById('tr-nota').value.trim();

  if (origenVal === destinoVal) { errEl.textContent = 'El origen y el destino deben ser distintos.'; return; }
  if (!monto || monto <= 0) { errEl.textContent = 'El monto debe ser mayor que 0.'; return; }

  const cuentas = STATE._cuentasTransferenciaCache || await obtenerCuentasTransferencia();
  const origen = cuentas.find(c => c.valor === origenVal);
  const destino = cuentas.find(c => c.valor === destinoVal);
  if (!origen || !destino) { errEl.textContent = 'Elige cuentas válidas.'; return; }

  setBtnLoading('btn-guardar-transferencia', true);
  try {
    // Saldo FRESCO del origen (el que se vio al abrir el modal pudo cambiar).
    const saldoOrigen = await obtenerSaldoActualCuenta(origen.origen_caja, origen.banco_id);
    if (monto > saldoOrigen) { errEl.textContent = `No hay suficiente saldo en ${origen.label.replace(/^[^\s]+ /, '')} (disponible: ${fmt(saldoOrigen)}).`; return; }

    const notaTexto = nota ? ` — ${nota}` : '';
    // El servidor registra AMBAS patas juntas (o ninguna), continuando la cadena de saldos.
    const { data, error } = await sbClient.rpc('registrar_transferencia_interna', {
      p_transferencia_id: crypto.randomUUID(), p_monto: monto,
      p_sale_origen_caja: origen.origen_caja, p_sale_banco: origen.banco_id,
      p_entra_origen_caja: destino.origen_caja, p_entra_banco: destino.banco_id,
      p_concepto_sale: `Transferencia hacia ${destino.label}${notaTexto}`,
      p_concepto_entra: `Transferencia desde ${origen.label}${notaTexto}`,
      p_es_reverso: false, p_fecha: todayISO(),
    });
    if (error) throw error;
    if (!data?.ok) { errEl.textContent = data?.mensaje || 'No se pudo completar la transferencia.'; return; }

    showToast('Transferencia realizada correctamente.');
    closeModal('modal-transferencia');
    await refrescarTrasMovimiento();
  } catch (e) {
    console.error('guardarTransferencia:', e);
    errEl.textContent = 'No se pudo completar la transferencia. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-guardar-transferencia', false);
  }
}

function nombreCuentaDeConcepto(concepto, prefijo) { return String(concepto || '').split(' — ')[0].replace(prefijo, '').trim(); }
function notaDeConcepto(concepto) { return String(concepto || '').split(' — ').slice(1).join(' — '); }

async function loadTransferencias() {
  const tbody = document.getElementById('transferencias-tbody');
  try {
    const { data, error } = await sbClient.from('movimientos_financieros')
      .select('fecha, concepto, monto, tipo_flujo, transferencia_id, es_reverso, estado, created_at')
      .eq('auth_user_id', STATE.userId).eq('tipo_movimiento', 'TRANSFERENCIA')
      .order('created_at', { ascending: false }).limit(400);
    if (error) throw error;

    // Cada transferencia son 2 filas (salida + entrada) con el mismo transferencia_id; si se
    // revirtio, hay 2 filas mas marcadas como reverso. Se muestra UNA linea por transferencia.
    const grupos = new Map();
    (data || []).forEach(m => {
      if (!m.transferencia_id) return;
      const g = grupos.get(m.transferencia_id) || { id: m.transferencia_id };
      if (m.es_reverso) g.reversada = true;
      else if (m.tipo_flujo === 'EGRESO') g.egreso = m; else g.ingreso = m;
      grupos.set(m.transferencia_id, g);
    });
    const lista = [...grupos.values()].filter(g => g.egreso && g.ingreso);
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Sin transferencias todavía.</td></tr>'; return; }

    tbody.innerHTML = lista.map(g => {
      const anulada = g.egreso.estado === 'anulado' || g.ingreso.estado === 'anulado';
      const estado = anulada ? '<span style="color:var(--text-muted)">🚫 Anulada</span>'
        : g.reversada ? '<span style="color:var(--text-muted)">↩️ Revertida</span>'
        : '<span style="color:var(--success,#16a34a)">✅ Activa</span>';
      const accion = (!anulada && !g.reversada)
        ? `<button class="btn-secondary btn-sm" onclick="revertirTransferencia('${g.id}')" title="Devuelve el dinero a la cuenta de origen">↩️ Revertir</button>` : '';
      return `<tr><td>${g.egreso.fecha}</td><td>${esc(nombreCuentaDeConcepto(g.ingreso.concepto, 'Transferencia desde '))}</td>`
        + `<td>${esc(nombreCuentaDeConcepto(g.egreso.concepto, 'Transferencia hacia '))}</td><td>${fmt(g.egreso.monto)}</td>`
        + `<td>${esc(notaDeConcepto(g.egreso.concepto))}</td><td>${estado}</td><td>${accion}</td></tr>`;
    }).join('');
  } catch (e) {
    console.error('loadTransferencias:', e);
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No se pudo cargar.</td></tr>';
  }
}

// Revertir = mover el dinero de vuelta con 2 movimientos nuevos (queda todo el historial).
// Solo se puede una vez por transferencia, y solo si el dinero sigue estando en el destino.
async function revertirTransferencia(transferenciaId) {
  try {
    const { data: patas, error } = await sbClient.from('movimientos_financieros')
      .select('tipo_flujo, monto, concepto, origen_caja, banco_id, es_reverso, estado')
      .eq('auth_user_id', STATE.userId).eq('transferencia_id', transferenciaId);
    if (error) throw error;
    const orig = (patas || []).filter(p => !p.es_reverso);
    const egreso = orig.find(p => p.tipo_flujo === 'EGRESO');
    const ingreso = orig.find(p => p.tipo_flujo === 'INGRESO');
    if (!egreso || !ingreso) { showToast('No se encontró la transferencia.', 'error'); return; }
    if ((patas || []).some(p => p.es_reverso)) { showToast('Esta transferencia ya fue revertida.', 'warning'); await loadTransferencias(); return; }
    if (orig.some(p => p.estado !== 'completado')) { showToast('Esta transferencia está anulada y no se puede revertir.', 'error'); return; }

    const monto = Number(egreso.monto);
    const nombreDestino = nombreCuentaDeConcepto(egreso.concepto, 'Transferencia hacia ');
    const nombreOrigen = nombreCuentaDeConcepto(ingreso.concepto, 'Transferencia desde ');
    const saldoDestino = await obtenerSaldoActualCuenta(ingreso.origen_caja, ingreso.banco_id);
    if (monto > saldoDestino) {
      showToast(`No se puede revertir: en ${nombreDestino.replace(/^[^\s]+ /, '')} solo hay ${fmt(saldoDestino)} y se necesitan ${fmt(monto)}.`, 'error');
      return;
    }
    if (!confirm(`¿Revertir esta transferencia?\n\nSe devolverán ${fmt(monto)} de ${nombreDestino} a ${nombreOrigen}.`)) return;

    const { data, error: errRpc } = await sbClient.rpc('registrar_transferencia_interna', {
      p_transferencia_id: transferenciaId, p_monto: monto,
      p_sale_origen_caja: ingreso.origen_caja, p_sale_banco: ingreso.banco_id,
      p_entra_origen_caja: egreso.origen_caja, p_entra_banco: egreso.banco_id,
      p_concepto_sale: `Reversión de transferencia: sale de ${nombreDestino}`,
      p_concepto_entra: `Reversión de transferencia: regresa a ${nombreOrigen}`,
      p_es_reverso: true, p_fecha: todayISO(),
    });
    if (errRpc) throw errRpc;
    if (!data?.ok) { showToast(data?.mensaje || 'No se pudo revertir la transferencia.', 'error'); await loadTransferencias(); return; }
    showToast('Transferencia revertida: el dinero regresó a su cuenta de origen.');
    await refrescarTrasMovimiento();
  } catch (e) {
    console.error('revertirTransferencia:', e);
    showToast('No se pudo revertir la transferencia. Intenta de nuevo.', 'error');
  }
}

async function loadBancos() {
  try {
    const { data: bancos } = await sbClient.from('bancos').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('created_at');
    STATE.bancos = bancos || [];

    // Saldos calculados EN LA BASE (antes se traían todos los movimientos a la
    // página y la base solo entrega 1,000 por consulta: en negocios grandes
    // el saldo salía incompleto). Si la función no respondiera, se usa el
    // cálculo de siempre como respaldo.
    const r = await sbClient.rpc('bancos_saldos');
    await cargarBancosEmpresa();
    if (!r.error && Array.isArray(r.data)) {
      STATE.bancoSaldos = new Map(r.data.map(s => [s.banco_id, s]));
      renderBancosGrid([]);
      renderSinAsignar(await traerSinAsignarBancos());
      return;
    }
    console.warn('bancos_saldos no disponible, se usa el cálculo de respaldo:', r.error);
    STATE.bancoSaldos = null;
    const { data: movs } = await sbClient.from('movimientos_financieros')
      .select('tipo_flujo, monto, monto_moneda_banco, metodo_pago_nombre, banco_id, concepto, fecha, tipo_movimiento')
      .eq('auth_user_id', STATE.userId).eq('estado', 'completado');
    const lista = (movs || []).filter(esMovDeBanco);

    renderBancosGrid(lista);
    renderSinAsignar(lista);
  } catch (e) {
    console.error('loadBancos:', e);
  }
}

// ── BANCOS DE LA EMPRESA (negocios vinculados que comparten el mismo banco real) ──
// Cada negocio sigue con SU banco y SUS movimientos; aquí solo se muestra la suma
// y se concilia el banco completo. Si este negocio no es parte de una empresa, no aparece nada.
async function cargarBancosEmpresa() {
  STATE.empresaBancos = [];
  STATE.empresaBancoPorBanco = new Map();
  const panel = document.getElementById('empresa-bancos-panel');
  try {
    const { data, error } = await sbClient.rpc('empresa_bancos_resumen');
    if (error || !Array.isArray(data) || !data.length) { if (panel) panel.style.display = 'none'; return; }
    STATE.empresaBancos = data;
    data.forEach(eb => (eb.partes || []).forEach(p => { if (p.auth_user_id === STATE.userId) STATE.empresaBancoPorBanco.set(p.banco_id, eb); }));
    renderBancosEmpresa();
  } catch (e) {
    console.warn('cargarBancosEmpresa:', e);
    if (panel) panel.style.display = 'none';
  }
}

function miBancoEnEmpresa(eb) {
  const p = (eb.partes || []).find(x => x.auth_user_id === STATE.userId);
  return p ? p.banco_id : null;
}

function renderBancosEmpresa() {
  const panel = document.getElementById('empresa-bancos-panel');
  const grid = document.getElementById('empresa-bancos-grid');
  if (!panel || !grid) return;
  // Solo los que tienen algo (saldo o movimientos) primero; los vacíos al final
  const lista = STATE.empresaBancos.slice().sort((a, b) => (Math.abs(Number(b.saldo)) > 0) - (Math.abs(Number(a.saldo)) > 0));
  grid.innerHTML = lista.map(eb => {
    const mio = miBancoEnEmpresa(eb);
    const pend = Number(eb.pendientes || 0);
    const partes = (eb.partes || []).map(p => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-muted)"><span>${esc(p.negocio || 'Negocio')}</span><span>${fmtMoneda(p.saldo, eb.moneda)}</span></div>`).join('');
    return `
      <div class="panel-card" style="margin:0">
        <div class="panel-body" style="cursor:pointer" onclick="verBancoEmpresa('${eb.id}')">
          <div style="font-size:12px;color:var(--text-muted)">${esc(eb.nombre)} <span style="background:var(--accent-soft);color:var(--accent);border-radius:6px;padding:1px 6px;font-size:10px;font-weight:700">${esc(eb.moneda)}</span> · ${esc(eb.numero_cuenta || '')}</div>
          <div style="font-size:22px;font-weight:800;margin-top:6px">${fmtMoneda(eb.saldo, eb.moneda)}</div>
          <div style="margin-top:6px;display:flex;flex-direction:column;gap:2px">${partes}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${pend ? `${pend} movimiento${pend === 1 ? '' : 's'} sin conciliar` : 'Todo conciliado ✓'}</div>
        </div>
        <div style="padding:0 16px 14px;display:flex;gap:8px">
          ${mio ? `<button class="btn-secondary btn-sm" style="flex:1" onclick="event.stopPropagation();abrirConciliarBanco('${mio}','${esc(eb.nombre)}')">🧾 Conciliar banco completo</button>` : ''}
        </div>
      </div>`;
  }).join('');
  panel.style.display = '';
}

// Movimientos del banco completo (de los dos negocios), los más recientes primero.
async function verBancoEmpresa(ebId) {
  const eb = (STATE.empresaBancos || []).find(x => x.id === ebId);
  if (!eb) return;
  document.getElementById('vb-titulo').textContent = `${eb.nombre} ${eb.moneda} — banco completo de la empresa`;
  document.getElementById('vb-tbody').innerHTML = '<tr><td colspan="3" class="empty-cell">Cargando…</td></tr>';
  openModal('modal-ver-banco');
  const { data: movs, error } = await sbClient.rpc('empresa_banco_movimientos', { p_empresa_banco_id: ebId, p_pendientes: false })
    .order('fecha', { ascending: false }).limit(200);
  const tbody = document.getElementById('vb-tbody');
  if (error) { tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No se pudieron cargar los movimientos.</td></tr>'; return; }
  tbody.innerHTML = (movs || []).length ? movs.map(m => `
    <tr><td>${fmtDate(m.fecha)}</td><td><span style="font-size:11px;font-weight:700;color:var(--accent)">${esc(m.negocio || '')}</span> ${esc(m.concepto || '—')}</td>
    <td style="color:${m.tipo_flujo==='INGRESO'?'var(--success)':'var(--danger)'}">${m.tipo_flujo==='INGRESO'?'+':'-'}${fmtMoneda(m.monto_banco, eb.moneda)}</td></tr>
  `).join('') : '<tr><td colspan="3" class="empty-cell">Sin movimientos todavía</td></tr>';
}

// Cobros por tarjeta/transferencia sin banco asignado, en páginas de 1,000 (sin límite).
async function traerSinAsignarBancos() {
  const todos = [];
  for (let desde = 0; desde < 100000; desde += 1000) {
    const { data, error } = await sbClient.rpc('bancos_sin_asignar').range(desde, desde + 999);
    if (error) { console.warn('bancos_sin_asignar:', error); break; }
    todos.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return todos;
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
    const montoDe = (m) => monedaBanco !== monedaBase ? _montoMonedaBanco(m) : Number(m.monto);
    const srv = STATE.bancoSaldos ? STATE.bancoSaldos.get(b.id) : null;
    const saldo = srv ? Number(srv.saldo) : saldoBancoDe(b, delBanco, monedaBase);
    const pendientes = srv ? Number(srv.pendientes || 0) : null;
    return `
      <div class="panel-card" style="margin:0">
        <div class="panel-body" style="cursor:pointer" onclick="verBanco('${b.id}')">
          <div style="font-size:12px;color:var(--text-muted)">${esc(b.nombre)} ${monedaBanco !== monedaBase ? `<span style="background:var(--accent-soft);color:var(--accent);border-radius:6px;padding:1px 6px;font-size:10px;font-weight:700">${monedaBanco}</span>` : ''}</div>
          ${b.numero_cuenta ? `<div style="font-size:11px;color:var(--text-muted)">${esc(b.numero_cuenta)}</div>` : ''}
          <div style="font-size:22px;font-weight:800;margin-top:6px">${fmtMoneda(saldo, monedaBanco)}</div>
          ${pendientes !== null ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${pendientes ? `${pendientes} movimiento${pendientes === 1 ? '' : 's'} sin conciliar` : 'Todo conciliado ✓'}</div>` : ''}
          ${STATE.empresaBancoPorBanco && STATE.empresaBancoPorBanco.get(b.id) ? `<div style="font-size:11px;color:var(--accent);margin-top:2px">Compartido en la empresa · total ${fmtMoneda(STATE.empresaBancoPorBanco.get(b.id).saldo, STATE.empresaBancoPorBanco.get(b.id).moneda)}</div>` : ''}
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
  document.getElementById('nb-comision').value = '';
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
  document.getElementById('nb-comision').value = banco.comision_porcentaje ?? '';
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

  const errComision = document.getElementById('nb-comision').value.trim();
  const payload = {
    nombre, numero_cuenta: document.getElementById('nb-numero-cuenta').value.trim() || null,
    saldo_inicial: round2(parseFloat(document.getElementById('nb-saldo-inicial').value) || 0),
    moneda: document.getElementById('nb-moneda').value === 'USD' ? 'USD' : 'NIO',
    // null = "nunca configurada" (se le pedirá la primera vez que se
    // use en una venta). Solo si escribió algo se guarda un número,
    // recortado entre 0 y 100 -- nunca se fuerza a 0 por defecto.
    comision_porcentaje: errComision === '' ? null : Math.min(100, Math.max(0, parseFloat(errComision) || 0)),
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
  const ebC = STATE.empresaBancoPorBanco && STATE.empresaBancoPorBanco.get(bancoId);
  if (ebC) return verBancoEmpresa(ebC.id);
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
   CONCILIACIÓN BANCARIA v2 (31-oct-2026) — como los sistemas especializados:
   1) Tu estado de cuenta: fecha de corte + saldo final. Se marcan solos los
      movimientos hasta esa fecha; lo que no marques queda "en tránsito".
   2) Explicar la diferencia con registros REALES (nunca un ajuste suelto):
      transferencias sin banco → asignarlas a este banco (no mueve dinero);
      retiro del banco a efectivo / depósito de efectivo (Caja total igual);
      comisión o cargo del banco = gasto con su egreso (y su asiento contable).
   3) Cerrar: cuadrada, o con diferencia pendiente + nota (no toca dinero),
      o guardar y seguir después (solo en este navegador).
   Lo ya conciliado no vuelve a aparecer. Banco compartido de la empresa: se
   concilia el banco completo; las herramientas registran en ESTE negocio.
===================================================== */
let CONC = { bancoId: null, bancoNombre: null, movimientos: [], marcados: new Set(), saldoReconciliadoPrevio: 0 };

function _montoMovConc(m) {
  if (m.monto_banco != null) return Number(m.monto_banco);   // banco de la empresa: ya viene en la moneda del banco
  return CONC.esOtraMoneda ? _montoMonedaBanco(m) : Number(m.monto);
}
function _signoMovConc(m) { return m.tipo_flujo === 'INGRESO' ? 1 : -1; }
function _claveBorradorConc() { return `n360_conc_borrador_${STATE.userId}_${CONC.empresa ? 'eb_' + CONC.empresa.id : CONC.bancoId}`; }
function _leerBorradorConc() { try { return JSON.parse(localStorage.getItem(_claveBorradorConc()) || 'null'); } catch (_) { return null; } }
function _borrarBorradorConc() { try { localStorage.removeItem(_claveBorradorConc()); } catch (_) {} }

async function _cargarSaldosConc() {
  const banco = STATE.bancos.find(b => b.id === CONC.bancoId);
  let srv = null;
  if (CONC.empresa) {
    try {
      const r = await sbClient.rpc('empresa_bancos_resumen');
      const eb = !r.error && Array.isArray(r.data) ? r.data.find(x => x.id === CONC.empresa.id) : null;
      if (eb) { CONC.empresa = eb; srv = { saldo: eb.saldo, saldo_conciliado: eb.saldo_conciliado }; }
    } catch (_) {}
    if (!srv) throw new Error('No se pudo cargar el banco de la empresa. Cierra y vuelve a intentar.');
  } else {
    try { const r = await sbClient.rpc('bancos_saldos'); if (!r.error && Array.isArray(r.data)) srv = r.data.find(s => s.banco_id === CONC.bancoId) || null; } catch (_) {}
  }
  if (srv) { CONC.saldoReconciliadoPrevio = round2(Number(srv.saldo_conciliado)); CONC.saldoSistema = round2(Number(srv.saldo)); return; }
  const previos = await traerTodasLasFilas(() => sbClient.from('movimientos_financieros')
    .select('tipo_flujo, monto, monto_moneda_banco').eq('auth_user_id', STATE.userId).eq('banco_id', CONC.bancoId).eq('conciliado', true).eq('estado', 'completado').order('created_at').order('id'));
  CONC.saldoReconciliadoPrevio = round2(Number(banco?.saldo_inicial || 0) + (previos || []).reduce((s, m) => s + _signoMovConc(m) * _montoMovConc(m), 0));
  CONC.saldoSistema = null;
}

async function cargarMovimientosConciliacion() {
  const todos = [];
  if (CONC.empresa) {
    for (let desde = 0; desde < 100000; desde += 1000) {
      const { data, error } = await sbClient.rpc('empresa_banco_movimientos', { p_empresa_banco_id: CONC.empresa.id, p_pendientes: true }).range(desde, desde + 999);
      if (error) { console.warn('empresa_banco_movimientos:', error); break; }
      todos.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  } else {
    for (let desde = 0; desde < 100000; desde += 1000) {
      const { data, error } = await sbClient.from('movimientos_financieros')
        .select('id, fecha, concepto, monto, monto_moneda_banco, tipo_flujo').eq('auth_user_id', STATE.userId).eq('banco_id', CONC.bancoId)
        .eq('conciliado', false).eq('estado', 'completado').order('fecha').order('created_at').order('id').range(desde, desde + 999);
      if (error) { console.warn('cargarMovimientosConciliacion:', error); break; }
      todos.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  CONC.movimientos = todos;
}

async function abrirConciliarBanco(bancoId, bancoNombre) {
  const banco = STATE.bancos.find(b => b.id === bancoId);
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const monedaBanco = banco?.moneda || 'NIO';
  CONC = { bancoId, bancoNombre, movimientos: [], marcados: new Set(), saldoReconciliadoPrevio: 0, saldoSistema: null,
           moneda: monedaBanco, esOtraMoneda: monedaBanco !== monedaBase, herramienta: null, sinBanco: [], sinBancoSel: new Set() };
  const ebConc = STATE.empresaBancoPorBanco && STATE.empresaBancoPorBanco.get(bancoId);
  if (ebConc) CONC.empresa = ebConc;
  const el = id => document.getElementById(id);
  el('cb-banco-nombre').textContent = ebConc ? `${bancoNombre} ${monedaBanco} (banco completo: ${(ebConc.partes || []).map(p => p.negocio).join(' + ')})` : `${bancoNombre} ${monedaBanco}`;
  el('cb-error').textContent = '';
  el('cb-nota-wrap').style.display = 'none';
  el('cb-nota').value = '';
  el('cb-herramienta').innerHTML = '';
  el('cb-movimientos-tbody').innerHTML = '<tr><td colspan="4" class="empty-cell">Cargando…</td></tr>';
  const borrador = _leerBorradorConc();
  el('cb-fecha-corte').value = borrador?.fecha || todayISO();
  el('cb-saldo-banco').value = borrador?.saldo ?? '';
  el('cb-simbolo').textContent = simboloMoneda(monedaBanco);
  openModal('modal-conciliar-banco');
  try { await _cargarSaldosConc(); }
  catch (e) { el('cb-error').textContent = e.message || 'No se pudo cargar el banco.'; return; }
  await cargarMovimientosConciliacion();
  if (borrador && Array.isArray(borrador.marcados)) {
    const vivos = new Set(CONC.movimientos.map(m => m.id));
    CONC.marcados = new Set(borrador.marcados.filter(id => vivos.has(id)));
    el('cb-borrador-nota').style.display = '';
  } else {
    el('cb-borrador-nota').style.display = 'none';
    _marcarHastaCorte();
  }
  renderMovimientosConciliacion();
  recalcularDiferenciaConciliacion();
  await cargarHistorialConciliaciones();
}

// Al cambiar la fecha de corte se marcan solos los movimientos hasta esa fecha.
function _marcarHastaCorte() {
  const corte = document.getElementById('cb-fecha-corte').value || todayISO();
  CONC.marcados = new Set(CONC.movimientos.filter(m => (m.fecha || '') <= corte).map(m => m.id));
}
function concCambioFecha() { _marcarHastaCorte(); renderMovimientosConciliacion(); recalcularDiferenciaConciliacion(); }
function marcarConciliacion(modo) {
  if (modo === 'todos') CONC.marcados = new Set(CONC.movimientos.map(m => m.id));
  else if (modo === 'ninguno') CONC.marcados = new Set();
  else _marcarHastaCorte();
  renderMovimientosConciliacion(); recalcularDiferenciaConciliacion();
}
function toggleMovConciliado(id, checked) {
  if (checked) CONC.marcados.add(id); else CONC.marcados.delete(id);
  const fila = document.getElementById('cbm-' + id);
  if (fila) fila.classList.toggle('cb-transito', !checked);
  recalcularDiferenciaConciliacion();
}

function renderMovimientosConciliacion() {
  const tbody = document.getElementById('cb-movimientos-tbody');
  if (!CONC.movimientos.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No hay movimientos pendientes de conciliar.</td></tr>';
    return;
  }
  tbody.innerHTML = CONC.movimientos.map(m => {
    const marc = CONC.marcados.has(m.id);
    const monto = _montoMovConc(m);
    return `<tr id="cbm-${m.id}" class="${marc ? '' : 'cb-transito'}">
      <td><input type="checkbox" ${marc ? 'checked' : ''} onchange="toggleMovConciliado('${m.id}', this.checked)" aria-label="Aparece en el estado de cuenta"/></td>
      <td style="white-space:nowrap">${fmtDate(m.fecha)}</td>
      <td>${CONC.empresa ? `<span style="font-size:11px;font-weight:700;color:var(--accent)">${esc(m.negocio || 'Este negocio')}</span> ` : ''}${esc(m.concepto || '—')}<span class="cb-tag-transito">en tránsito</span></td>
      <td style="text-align:right;white-space:nowrap;color:${m.tipo_flujo === 'INGRESO' ? 'var(--success)' : 'var(--danger)'}">${m.tipo_flujo === 'INGRESO' ? '+' : '−'}${fmtMoneda(monto, CONC.moneda)}</td>
    </tr>`;
  }).join('');
}

function recalcularDiferenciaConciliacion() {
  const marcados = CONC.movimientos.filter(m => CONC.marcados.has(m.id));
  const transito = CONC.movimientos.filter(m => !CONC.marcados.has(m.id));
  const sumMarc = round2(marcados.reduce((s, m) => s + _signoMovConc(m) * _montoMovConc(m), 0));
  const sumTrans = round2(transito.reduce((s, m) => s + _signoMovConc(m) * _montoMovConc(m), 0));
  const sistemaCorte = round2(CONC.saldoReconciliadoPrevio + sumMarc);
  const txt = document.getElementById('cb-saldo-banco').value;
  const hayBanco = txt !== '' && !isNaN(parseFloat(txt));
  const saldoBanco = hayBanco ? round2(parseFloat(txt)) : null;
  const dif = hayBanco ? round2(saldoBanco - sistemaCorte) : null;
  CONC._sistemaCorte = sistemaCorte; CONC._diferencia = dif; CONC._saldoBanco = saldoBanco;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('cb-v-banco', hayBanco ? fmtMoneda(saldoBanco, CONC.moneda) : '—');
  set('cb-v-sistema', fmtMoneda(sistemaCorte, CONC.moneda));
  set('cb-v-dif', hayBanco ? fmtMoneda(dif, CONC.moneda) : '—');
  set('cb-v-sistema-sub', `${marcados.length} movimiento${marcados.length === 1 ? '' : 's'} marcado${marcados.length === 1 ? '' : 's'}${CONC.saldoReconciliadoPrevio ? ' + lo ya conciliado' : ''}`);
  set('cb-transito-info', transito.length ? `En tránsito (no aparecen todavía en el banco): ${transito.length} movimiento${transito.length === 1 ? '' : 's'}, ${fmtMoneda(sumTrans, CONC.moneda)}` : 'Sin movimientos en tránsito');
  set('cb-marcados-info', CONC.movimientos.length ? `(${marcados.length} de ${CONC.movimientos.length} marcados)` : '');
  const caja = document.getElementById('cb-v-dif-caja');
  const msg = document.getElementById('cb-mensaje');
  const btnCerrar = document.getElementById('btn-cerrar-conciliacion');
  const btnDif = document.getElementById('btn-cerrar-con-diferencia');
  caja.classList.remove('cb-ok', 'cb-mal');
  if (!hayBanco) {
    msg.innerHTML = 'Escribe el <b>saldo final</b> de tu estado de cuenta para comparar.';
    btnCerrar.disabled = true; btnDif.style.display = 'none';
  } else if (Math.abs(dif) < 0.005) {
    caja.classList.add('cb-ok');
    msg.innerHTML = '✅ <b>Cuadra.</b> Ya puedes cerrar la conciliación.';
    btnCerrar.disabled = false; btnDif.style.display = 'none';
    document.getElementById('cb-nota-wrap').style.display = 'none';
  } else {
    caja.classList.add('cb-mal');
    const abs = fmtMoneda(Math.abs(dif), CONC.moneda);
    msg.innerHTML = dif < 0
      ? `Tu banco tiene <b>${abs} menos</b> que el sistema. Suele ser por <b>retiros, pagos hechos desde el banco o comisiones</b> que no se registraron, o por movimientos marcados que el banco todavía no refleja (quítales la marca). Usa las herramientas de abajo.`
      : `Tu banco tiene <b>${abs} más</b> que el sistema. Suele ser por <b>cobros por transferencia o tarjeta que quedaron sin banco</b>, o depósitos de efectivo que no se registraron. Usa las herramientas de abajo.`;
    btnCerrar.disabled = true; btnDif.style.display = '';
  }
}

/* ---------- Herramientas para explicar la diferencia ---------- */
function concHerramienta(cual) {
  CONC.herramienta = CONC.herramienta === cual ? null : cual;
  document.getElementById('cb-error').textContent = '';
  const cont = document.getElementById('cb-herramienta');
  document.querySelectorAll('.cb-tool-btn').forEach(b => b.classList.toggle('activo', b.dataset.tool === CONC.herramienta));
  if (!CONC.herramienta) { cont.innerHTML = ''; return; }
  const corte = document.getElementById('cb-fecha-corte').value || todayISO();
  const negocio = CONC.empresa ? ' <span style="color:var(--text-muted)">(se registra en este negocio)</span>' : '';
  const otraMoneda = CONC.esOtraMoneda;
  if (cual === 'sinbanco') {
    if (otraMoneda) { cont.innerHTML = `<div class="cb-tool-box">Este banco está en ${esc(CONC.moneda)}: los cobros sin banco son en la moneda del negocio y no se pueden asignar aquí.</div>`; return; }
    cont.innerHTML = `<div class="cb-tool-box"><div style="font-weight:700;margin-bottom:4px">🔎 Transferencias y tarjetas que quedaron sin banco${negocio}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Marca las que sí aparecen en el estado de cuenta de este banco. <b>No mueve dinero</b>: solo dice en qué banco está.</div>
      <div id="cb-sb-lista" style="max-height:220px;overflow-y:auto">Cargando…</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
        <span id="cb-sb-total" style="font-size:12.5px"></span>
        <button class="btn-primary btn-sm" id="btn-cb-asignar" onclick="concAsignarSinBanco()">Asignar a ${esc(CONC.bancoNombre)}</button>
      </div></div>`;
    concCargarSinBanco(corte);
  } else if (cual === 'efectivo') {
    if (otraMoneda) { cont.innerHTML = `<div class="cb-tool-box">Para un banco en ${esc(CONC.moneda)} usa <b>Transferencias</b> en Caja.</div>`; return; }
    cont.innerHTML = `<div class="cb-tool-box"><div style="font-weight:700;margin-bottom:4px">🏧 Retiro del banco a efectivo / depósito de efectivo al banco${negocio}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Mueve dinero entre el banco y tu efectivo. <b>La Caja total no cambia</b>, solo dónde está el dinero.</div>
      <div class="form-row">
        <div><label>Tipo</label><select id="cb-ef-tipo" onchange="concPrevisualizar('efectivo')"><option value="retiro"${(CONC._diferencia || 0) > 0 ? '' : ' selected'}>Retiro: banco → efectivo</option><option value="deposito"${(CONC._diferencia || 0) > 0 ? ' selected' : ''}>Depósito: efectivo → banco</option></select></div>
        <div><label>Monto (${simboloMoneda(CONC.moneda)})</label><input type="number" id="cb-ef-monto" step="0.01" min="0.01" oninput="concPrevisualizar('efectivo')"/></div>
        <div><label>Fecha</label><input type="date" id="cb-ef-fecha" value="${corte}"/></div>
      </div>
      <div><label>Nota (opcional)</label><input type="text" id="cb-ef-nota" placeholder="Ej: retiro para pago de planilla"/></div>
      <div id="cb-prev-efectivo" class="cb-prev"></div>
      <div style="text-align:right;margin-top:8px"><button class="btn-primary btn-sm" id="btn-cb-efectivo" onclick="concGuardarEfectivo()">Registrar</button></div></div>`;
    concPrevisualizar('efectivo');
  } else if (cual === 'cargo') {
    cont.innerHTML = `<div class="cb-tool-box"><div style="font-weight:700;margin-bottom:4px">💳 Comisión o cargo del banco${negocio}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Se registra como <b>gasto</b> (categoría Comisiones bancarias) con su salida del banco, igual que cualquier gasto: aparece en Gastos y en Contabilidad.</div>
      <div class="form-row">
        <div><label>Concepto</label><input type="text" id="cb-cg-concepto" placeholder="Ej: Comisión por manejo de cuenta"/></div>
        <div><label>Monto (${simboloMoneda(CONC.moneda)})</label><input type="number" id="cb-cg-monto" step="0.01" min="0.01" oninput="concPrevisualizar('cargo')"/></div>
        <div><label>Fecha</label><input type="date" id="cb-cg-fecha" value="${corte}"/></div>
      </div>
      <div id="cb-prev-cargo" class="cb-prev"></div>
      <div style="text-align:right;margin-top:8px"><button class="btn-primary btn-sm" id="btn-cb-cargo" onclick="concGuardarCargo()">Registrar cargo</button></div></div>`;
    concPrevisualizar('cargo');
  }
}

// Antes de guardar: cómo quedará la diferencia. Retiro y cargo BAJAN el saldo del
// banco en el sistema (la diferencia sube); el depósito lo SUBE (la diferencia baja).
function _difDespuesConc(cual) {
  const dif = CONC._diferencia;
  if (dif === null || dif === undefined) return null;
  const montoEl = document.getElementById(cual === 'cargo' ? 'cb-cg-monto' : 'cb-ef-monto');
  const monto = round2(parseFloat(montoEl?.value) || 0);
  if (monto <= 0) return null;
  const baja = cual === 'cargo' || document.getElementById('cb-ef-tipo')?.value === 'retiro';
  return { antes: dif, despues: round2(dif + (baja ? monto : -monto)), monto };
}
function concPrevisualizar(cual) {
  const el = document.getElementById('cb-prev-' + cual);
  if (!el) return;
  const p = _difDespuesConc(cual);
  el.classList.remove('cb-prev-ok', 'cb-prev-mal');
  if (CONC._diferencia === null || CONC._diferencia === undefined) { el.innerHTML = 'Escribe primero el saldo de tu banco arriba para ver cómo cambia la diferencia.'; return; }
  if (!p) {
    const dif = CONC._diferencia;
    el.innerHTML = Math.abs(dif) < 0.005 ? 'Ya cuadra: no hace falta registrar nada.'
      : dif > 0 ? `💡 Tu banco tiene <b>más</b> que el sistema: normalmente es un <b>depósito</b> (o cobros sin banco), no un retiro.`
                : `💡 Tu banco tiene <b>menos</b> que el sistema: normalmente es un <b>retiro</b> o una <b>comisión</b>.`;
    return;
  }
  const mejora = Math.abs(p.despues) < Math.abs(p.antes) - 0.004;
  el.classList.add(mejora ? 'cb-prev-ok' : 'cb-prev-mal');
  el.innerHTML = `Con esto la diferencia pasa de <b>${fmtMoneda(p.antes, CONC.moneda)}</b> a <b>${fmtMoneda(p.despues, CONC.moneda)}</b>.`
    + (Math.abs(p.despues) < 0.005 ? ' ✅ Quedaría cuadrado.'
      : mejora ? '' : ' ⚠️ <b>La diferencia aumenta.</b> Revisa si elegiste bien: si tu banco tiene más que el sistema, lo normal es un depósito, no un retiro.');
}
function _confirmarSiEmpeoraConc(cual) {
  const p = _difDespuesConc(cual);
  if (!p || Math.abs(p.despues) < Math.abs(p.antes) - 0.004 || Math.abs(p.despues) < 0.005) return true;
  return confirm(`Ojo: con esto la diferencia AUMENTA de ${fmtMoneda(p.antes, CONC.moneda)} a ${fmtMoneda(p.despues, CONC.moneda)}.\n\n¿Seguro que quieres registrarlo así?`);
}

async function concCargarSinBanco(hasta) {
  const lista = document.getElementById('cb-sb-lista');
  const { data, error } = await sbClient.rpc('conciliacion_movs_sin_banco', { p_desde: null, p_hasta: hasta });
  if (error) { lista.textContent = 'No se pudo cargar: ' + (error.message || ''); return; }
  CONC.sinBanco = data || []; CONC.sinBancoSel = new Set();
  if (!CONC.sinBanco.length) { lista.innerHTML = '<div class="empty-cell">No hay transferencias ni tarjetas sin banco hasta esa fecha. 👍</div>'; concTotalSinBanco(); return; }
  lista.innerHTML = `<table><tbody>${CONC.sinBanco.map(m => `<tr>
      <td style="width:30px"><input type="checkbox" onchange="concSelSinBanco('${m.id}', this.checked)"/></td>
      <td style="white-space:nowrap">${fmtDate(m.fecha)}</td><td>${esc(m.concepto || '—')} <span style="color:var(--text-muted);font-size:11px">${esc(m.metodo || '')}</span></td>
      <td style="text-align:right;white-space:nowrap;color:${m.tipo_flujo === 'INGRESO' ? 'var(--success)' : 'var(--danger)'}">${m.tipo_flujo === 'INGRESO' ? '+' : '−'}${fmt(m.monto)}</td></tr>`).join('')}</tbody></table>`;
  concTotalSinBanco();
}
function concSelSinBanco(id, on) { if (on) CONC.sinBancoSel.add(id); else CONC.sinBancoSel.delete(id); concTotalSinBanco(); }
function concTotalSinBanco() {
  const sel = CONC.sinBanco.filter(m => CONC.sinBancoSel.has(m.id));
  const t = round2(sel.reduce((s, m) => s + _signoMovConc(m) * Number(m.monto), 0));
  const el = document.getElementById('cb-sb-total');
  if (el) el.textContent = sel.length ? `${sel.length} seleccionado${sel.length === 1 ? '' : 's'}: ${t >= 0 ? '+' : '−'}${fmt(Math.abs(t))}` : `${CONC.sinBanco.length} sin banco`;
}

// Tras registrar algo desde una herramienta: se recargan saldos y pendientes,
// se conservan las marcas y lo nuevo queda marcado (aparece en el estado de cuenta).
async function _recargarConc(idsNuevosMarcados) {
  const antes = new Set(CONC.movimientos.map(m => m.id));
  const marcas = new Set(CONC.marcados);
  await _cargarSaldosConc();
  await cargarMovimientosConciliacion();
  const vivos = new Set(CONC.movimientos.map(m => m.id));
  CONC.marcados = new Set([...marcas].filter(id => vivos.has(id)));
  CONC.movimientos.forEach(m => { if (!antes.has(m.id) || (idsNuevosMarcados || []).includes(m.id)) CONC.marcados.add(m.id); });
  renderMovimientosConciliacion();
  recalcularDiferenciaConciliacion();
}
function _bancoPropioConc() { return CONC.bancoId; }   // en banco de empresa, la parte de ESTE negocio

async function concAsignarSinBanco() {
  const errEl = document.getElementById('cb-error'); errEl.textContent = '';
  const ids = [...CONC.sinBancoSel];
  if (!ids.length) { errEl.textContent = 'Marca al menos una transferencia que aparezca en este banco.'; return; }
  setBtnLoading('btn-cb-asignar', true);
  try {
    const { data, error } = await sbClient.rpc('conciliacion_asignar_banco', { p_banco_id: _bancoPropioConc(), p_ids: ids });
    if (error) throw error;
    showToast(`${data?.asignados || 0} movimiento(s) asignados a ${CONC.bancoNombre}`);
    await _recargarConc(ids);
    await concCargarSinBanco(document.getElementById('cb-fecha-corte').value || todayISO());
    if (typeof loadBancos === 'function') loadBancos();
  } catch (e) { errEl.textContent = 'No se pudo asignar: ' + (e.message || ''); }
  finally { setBtnLoading('btn-cb-asignar', false); }
}

async function concGuardarEfectivo() {
  const errEl = document.getElementById('cb-error'); errEl.textContent = '';
  const tipo = document.getElementById('cb-ef-tipo').value;
  const monto = round2(parseFloat(document.getElementById('cb-ef-monto').value) || 0);
  const fecha = document.getElementById('cb-ef-fecha').value || todayISO();
  const nota = document.getElementById('cb-ef-nota').value.trim();
  if (monto <= 0) { errEl.textContent = 'El monto debe ser mayor que 0.'; return; }
  const banco = _bancoPropioConc();
  const extra = nota ? ` — ${nota}` : '';
  const retiro = tipo === 'retiro';
  if (!_confirmarSiEmpeoraConc('efectivo')) return;
  setBtnLoading('btn-cb-efectivo', true);
  try {
    const { data, error } = await sbClient.rpc('registrar_transferencia_interna', {
      p_transferencia_id: crypto.randomUUID(), p_monto: monto,
      p_sale_origen_caja: retiro ? null : 'general', p_sale_banco: retiro ? banco : null,
      p_entra_origen_caja: retiro ? 'general' : null, p_entra_banco: retiro ? null : banco,
      p_concepto_sale: retiro ? `Retiro del banco ${CONC.bancoNombre} a efectivo${extra}` : `Depósito de efectivo al banco ${CONC.bancoNombre}${extra}`,
      p_concepto_entra: retiro ? `Retiro del banco ${CONC.bancoNombre} a efectivo${extra}` : `Depósito de efectivo al banco ${CONC.bancoNombre}${extra}`,
      p_es_reverso: false, p_fecha: fecha,
    });
    if (error) throw error;
    if (!data?.ok) { errEl.textContent = data?.mensaje || 'No se pudo registrar.'; return; }
    showToast((retiro ? 'Retiro registrado' : 'Depósito registrado') + ' (la Caja total no cambia). Si te equivocaste: Caja › Transferencias › ↩️ Revertir.');
    concHerramienta(null);
    await _recargarConc();
    if (typeof refrescarTrasMovimiento === 'function') refrescarTrasMovimiento();
  } catch (e) { errEl.textContent = 'No se pudo registrar: ' + (e.message || ''); }
  finally { setBtnLoading('btn-cb-efectivo', false); }
}

async function concGuardarCargo() {
  const errEl = document.getElementById('cb-error'); errEl.textContent = '';
  const concepto = document.getElementById('cb-cg-concepto').value.trim();
  const monto = round2(parseFloat(document.getElementById('cb-cg-monto').value) || 0);
  const fecha = document.getElementById('cb-cg-fecha').value || todayISO();
  if (!concepto) { errEl.textContent = 'Escribe el concepto del cargo (por ejemplo: comisión por manejo de cuenta).'; return; }
  if (monto <= 0) { errEl.textContent = 'El monto debe ser mayor que 0.'; return; }
  if (!_confirmarSiEmpeoraConc('cargo')) return;
  setBtnLoading('btn-cb-cargo', true);
  try {
    const { data, error } = await sbClient.rpc('conciliacion_cargo_bancario', { p_banco_id: _bancoPropioConc(), p_monto_banco: monto, p_fecha: fecha, p_concepto: concepto });
    if (error) throw error;
    showToast('Cargo registrado como gasto');
    concHerramienta(null);
    await _recargarConc(data?.movimiento_id ? [data.movimiento_id] : []);
    if (typeof refrescarTrasMovimiento === 'function') refrescarTrasMovimiento();
  } catch (e) { errEl.textContent = 'No se pudo registrar el cargo: ' + (e.message || ''); }
  finally { setBtnLoading('btn-cb-cargo', false); }
}

/* ---------- Cerrar / guardar ---------- */
function concGuardarBorrador() {
  try {
    localStorage.setItem(_claveBorradorConc(), JSON.stringify({
      fecha: document.getElementById('cb-fecha-corte').value || todayISO(),
      saldo: document.getElementById('cb-saldo-banco').value,
      marcados: [...CONC.marcados], t: Date.now() }));
    showToast('Guardado en este equipo. Cuando vuelvas a abrir la conciliación, sigue donde la dejaste.');
  } catch (_) { showToast('No se pudo guardar en este navegador.', 'error'); return; }
  closeModal('modal-conciliar-banco');
}
function concPrepararCierreConDiferencia() {
  document.getElementById('cb-nota-wrap').style.display = '';
  document.getElementById('cb-nota').focus();
}

async function cerrarConciliacion(conDiferencia) {
  const errEl = document.getElementById('cb-error'); errEl.textContent = '';
  recalcularDiferenciaConciliacion();
  if (CONC._saldoBanco == null) { errEl.textContent = 'Escribe el saldo final de tu estado de cuenta.'; return; }
  const corte = document.getElementById('cb-fecha-corte').value;
  if (!corte) { errEl.textContent = 'Elige la fecha de corte de tu estado de cuenta.'; return; }
  const cuadra = Math.abs(CONC._diferencia) < 0.005;
  const nota = document.getElementById('cb-nota').value.trim();
  if (!cuadra && !conDiferencia) { errEl.textContent = 'Todavía hay diferencia. Explícala con las herramientas, o usa "Cerrar con diferencia pendiente".'; return; }
  if (!cuadra && !nota) { errEl.textContent = 'Escribe una nota que explique la diferencia.'; document.getElementById('cb-nota').focus(); return; }
  if (cuadra && !CONC.marcados.size) { errEl.textContent = 'Marca al menos un movimiento que aparezca en tu estado de cuenta.'; return; }
  const btnId = conDiferencia ? 'btn-cerrar-con-diferencia-ok' : 'btn-cerrar-conciliacion';
  setBtnLoading(btnId, true);
  try {
    const ids = [...CONC.marcados];
    const args = { p_ids: ids, p_saldo_banco: CONC._saldoBanco, p_fecha_corte: corte, p_con_diferencia: !cuadra, p_nota: cuadra ? null : nota };
    const { error } = CONC.empresa
      ? await sbClient.rpc('empresa_conciliacion_cerrar_v2', { p_empresa_banco_id: CONC.empresa.id, ...args })
      : await sbClient.rpc('conciliacion_cerrar_v2', { p_banco_id: CONC.bancoId, ...args });
    if (error) throw error;
    _borrarBorradorConc();
    showToast(cuadra ? 'Conciliación cerrada — todo cuadra' : 'Conciliación cerrada con diferencia pendiente (no se tocó ningún dinero)');
    await abrirConciliarBanco(CONC.bancoId, CONC.bancoNombre);
    if (typeof loadBancos === 'function') loadBancos();
  } catch (e) {
    errEl.textContent = 'No se pudo cerrar: ' + (e.message || '');
  } finally {
    setBtnLoading(btnId, false);
  }
}

async function cargarHistorialConciliaciones() {
  const tbody = document.getElementById('cb-historial-tbody');
  const fila = (fecha, banco, sistema, dif, nota) => {
    const d = Number(dif || 0);
    return `<tr><td>${fmtDate(fecha)}</td><td>${fmtMoneda(banco, CONC.moneda)}</td><td>${fmtMoneda(sistema, CONC.moneda)}</td>
      <td style="color:${Math.abs(d) < 0.005 ? 'var(--success)' : 'var(--danger)'};font-weight:700">${Math.abs(d) < 0.005 ? '✓ Cuadró' : fmtMoneda(d, CONC.moneda)}</td>
      <td style="font-size:12px;color:var(--text-muted)">${esc(nota || '')}</td></tr>`;
  };
  if (CONC.empresa) {
    const { data } = await sbClient.from('empresa_conciliaciones')
      .select('periodo_hasta, fecha_corte, saldo_banco_declarado, saldo_sistema_calculado, diferencia, nota').eq('empresa_banco_id', CONC.empresa.id).order('created_at', { ascending: false }).limit(12);
    tbody.innerHTML = (data || []).length ? data.map(c => fila(c.fecha_corte || c.periodo_hasta, c.saldo_banco_declarado, c.saldo_sistema_calculado, c.diferencia, c.nota)).join('')
      : '<tr><td colspan="5" class="empty-cell">Sin conciliaciones del banco completo todavía</td></tr>';
    return;
  }
  const { data } = await sbClient.from('conciliaciones_bancarias')
    .select('periodo_hasta, fecha_corte, saldo_banco_declarado, saldo_sistema_calculado, diferencia, nota').eq('auth_user_id', STATE.userId).eq('banco_id', CONC.bancoId)
    .order('created_at', { ascending: false }).limit(12);
  tbody.innerHTML = (data || []).length ? data.map(c => fila(c.fecha_corte || c.periodo_hasta, c.saldo_banco_declarado, c.saldo_sistema_calculado, c.diferencia, c.nota)).join('')
    : '<tr><td colspan="5" class="empty-cell">Sin conciliaciones todavía</td></tr>';
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
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn-secondary" id="btn-abrir-monto-anterior" onclick="abrirCajaChicaConMontoAnterior()">Abrir con el monto de ayer</button>
          <button class="btn-primary" onclick="abrirModalConteo('apertura')">Contar y abrir con monto nuevo</button>
        </div>
      </div>`;
    actualizarBotonMontoAnterior();
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
      <div style="display:flex;gap:10px;justify-content:center;margin-top:10px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="verReporteCC('${s.id}')">Ver reporte de hoy</button>
        <button class="btn-secondary" onclick="reabrirCajaDeHoy('${s.id}')" title="Por si la cerraste por accidente">🔓 Reabrir caja de hoy</button>
      </div>
    </div>`;
}

// Si se cerro por accidente (o hace falta seguir registrando algo
// mas del mismo dia), se puede reabrir -- SOLO si el cierre es de
// HOY (nunca de un dia anterior, para no alterar un corte ya
// pasado). Preserva el monto de apertura original tal cual estaba.
async function reabrirCajaDeHoy(sesionId) {
  const ok = confirm('¿Reabrir la Caja Chica de hoy? Se mantendrá el monto de apertura original, y podrás seguir registrando movimientos.');
  if (!ok) return;
  try {
    const { error } = await sbClient.from('caja_chica_sesiones').update({
      estado: 'abierta', monto_cierre_teorico: null, monto_cierre_real: null, denominacion_cierre: null,
      diferencia: null, total_ingresos: null, total_egresos: null,
      total_ingresos_efectivo: null, total_egresos_efectivo: null, movimientos_count: null,
    }).eq('id', sesionId).eq('auth_user_id', STATE.userId).eq('fecha', todayISO());
    if (error) throw error;
    showToast('Caja Chica reabierta.');
    await loadCajaChica();
  } catch (e) {
    console.error('reabrirCajaDeHoy:', e);
    showToast('No se pudo reabrir. Intenta de nuevo.', 'error');
  }
}

// Trae los movimientos de HOY (leyendo el mismo libro de Caja
// general, sin tocarlo) para mostrar cómo va el efectivo en vivo.
// Saldo real disponible en Caja Chica ahora mismo -- reutilizable
// (Transferencias tambien lo necesita). Si no hay sesion abierta
// HOY, no hay caja chica activa de donde sacar dinero, asi que el
// saldo disponible es 0 -- correcto, no es un error.
/* =====================================================
   REGLAS DE EFECTIVO DE CAJA CHICA -- UNA sola fuente de verdad
   (la base de datos aplica las mismas reglas en el disparador de cierres).
   Solo cuenta lo que toca el CAJON FISICO:
    * El capital inicial y la pata "banco" de una transferencia NO son
      efectivo del cajon, salvo que esten marcados expresamente como de 'chica'.
    * Una transferencia solo resta del cajon si SALE de la Caja Chica.
    * Las transferencias internas no son ingresos ni egresos del negocio.
===================================================== */
const COLS_MOV_CHICA = 'tipo_flujo, monto, metodo_pago_nombre, origen_caja, tipo_movimiento';
function movEsEfectivo(m) { return (m.metodo_pago_nombre || 'Efectivo').toLowerCase().includes('efectivo'); }
function esTransferenciaInterna(m) { return m.tipo_movimiento === 'TRANSFERENCIA'; }
function ingresoEsDeCajaChica(m) {
  if (m.tipo_movimiento === 'TRANSFERENCIA' || m.tipo_movimiento === 'CAPITAL_AGREGADO') return m.origen_caja === 'chica';
  return movEsEfectivo(m);
}
function egresoEsDeCajaChica(m) {
  if (m.tipo_movimiento === 'TRANSFERENCIA') return m.origen_caja === 'chica';
  return m.origen_caja === 'general' ? false : (m.origen_caja === 'chica' ? true : movEsEfectivo(m));
}
// Totales del dia de la Caja Chica. 'lista' = movimientos completados de hoy.
function totalesCajaChica(lista, apertura) {
  const suma = arr => round2(arr.reduce((t, m) => t + Number(m.monto || 0), 0));
  const ingEfectivo = suma(lista.filter(m => m.tipo_flujo === 'INGRESO' && ingresoEsDeCajaChica(m)));
  const egrEfectivo = suma(lista.filter(m => m.tipo_flujo === 'EGRESO'  && egresoEsDeCajaChica(m)));
  const ingTotal = suma(lista.filter(m => m.tipo_flujo === 'INGRESO' && !esTransferenciaInterna(m)));
  const egrTotal = suma(lista.filter(m => m.tipo_flujo === 'EGRESO'  && !esTransferenciaInterna(m)));
  return { ingEfectivo, egrEfectivo, ingTotal, egrTotal, teorico: round2(Number(apertura || 0) + ingEfectivo - egrEfectivo) };
}

async function calcularSaldoTeoricoCajaChica() {
  const hoy = todayISO();
  const { data: sesion } = await sbClient.from('caja_chica_sesiones')
    .select('*').eq('auth_user_id', STATE.userId).eq('fecha', hoy).eq('estado', 'abierta').maybeSingle();
  if (!sesion) return 0;
  const { data: movs } = await sbClient.from('movimientos_financieros')
    .select(COLS_MOV_CHICA).eq('auth_user_id', STATE.userId)
    .eq('estado','completado').eq('fecha', hoy);
  return totalesCajaChica(movs || [], sesion.monto_apertura).teorico;
}

async function renderResumenVivoCC(sesion) {
  const el = document.getElementById('cc-resumen-vivo');
  if (!el) return;
  try {
    const hoy = todayISO();
    const { data: movs } = await sbClient.from('movimientos_financieros')
      .select(COLS_MOV_CHICA).eq('auth_user_id', STATE.userId)
      .eq('estado','completado').eq('fecha', hoy);

    const lista = movs || [];
    const { ingEfectivo, egrEfectivo, ingTotal, egrTotal, teorico } = totalesCajaChica(lista, sesion.monto_apertura);

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
// Abrir Caja Chica de una vez con el monto EXACTO con el que cerro
// la ultima vez -- sin tener que volver a contar billete por billete
// si no cambio nada desde entonces.
async function actualizarBotonMontoAnterior() {
  const btn = document.getElementById('btn-abrir-monto-anterior');
  if (!btn) return;
  try {
    const { data: ultima } = await sbClient.from('caja_chica_sesiones')
      .select('monto_cierre_real').eq('auth_user_id', STATE.userId)
      .eq('estado', 'cerrada').order('fecha', { ascending: false }).limit(1).maybeSingle();
    if (ultima) {
      btn.textContent = `Abrir con ${fmt(ultima.monto_cierre_real)} (de ayer)`;
    } else {
      btn.textContent = 'Abrir con el monto de ayer';
      btn.disabled = true;
      btn.title = 'No hay un cierre anterior todavía';
    }
  } catch (e) { console.warn('actualizarBotonMontoAnterior:', e); }
}

async function abrirCajaChicaConMontoAnterior() {
  try {
    const { data: ultima, error } = await sbClient.from('caja_chica_sesiones')
      .select('monto_cierre_real, denominacion_cierre').eq('auth_user_id', STATE.userId)
      .eq('estado', 'cerrada').order('fecha', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!ultima) { showToast('No hay un cierre anterior todavía -- usa "Contar y abrir con monto nuevo".', 'error'); return; }
    const nombreUsuario = STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario';
    const { error: errIns } = await sbClient.from('caja_chica_sesiones').insert({
      auth_user_id: STATE.userId, fecha: todayISO(), estado: 'abierta',
      monto_apertura: ultima.monto_cierre_real, denominacion_apertura: ultima.denominacion_cierre || null,
      abierta_por: nombreUsuario, observaciones: 'Abierta automáticamente con el monto del cierre anterior',
    });
    if (errIns) throw errIns;
    showToast('Caja Chica abierta con ' + fmt(ultima.monto_cierre_real) + ' (el mismo de ayer)');
    await loadCajaChica();
  } catch (e) {
    console.error('abrirCajaChicaConMontoAnterior:', e);
    showToast('No se pudo abrir. Intenta de nuevo.', 'error');
  }
}

function abrirModalConteo(modo) {
  CC.modoConteo = modo;
  document.getElementById('cc-conteo-titulo').textContent = modo === 'apertura' ? 'Contar dinero para abrir Caja Chica' : 'Contar dinero para cerrar Caja Chica';
  document.getElementById('cc-conteo-observaciones').value = '';
  const grid = document.getElementById('cc-denominaciones-grid');
  const base = monedaBaseNegocio();
  const otra = base === 'NIO' ? 'USD' : 'NIO';
  const monedas = ccTasa() > 0 ? [base, otra] : [base];
  const nombreMoneda = { NIO: 'Córdobas', USD: 'Dólares' };
  grid.innerHTML = monedas.map(m => `
    <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:baseline;margin-top:${m===monedas[0]?0:8}px;padding-bottom:4px;border-bottom:1px solid var(--border)">
      <strong style="font-size:13px">${m === 'USD' ? '💵' : '🪙'} ${nombreMoneda[m]}</strong>
      <span style="font-size:12px;color:var(--text-muted)">Subtotal: <b id="cc-sub-${m}">${simboloMoneda(m)} 0.00</b></span>
    </div>` + CC_DENOM_POR_MONEDA[m].map(d => `
    <div>
      <label style="font-size:11.5px;color:var(--text-muted)">${d.tipo} de ${simboloMoneda(m)}${d.valor}</label>
      <input type="number" min="0" step="1" value="" placeholder="0" class="cc-denom-input" data-valor="${d.valor}" data-moneda="${m}"
        oninput="actualizarTotalContado()" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-app);color:var(--text-primary)"/>
    </div>`).join('')).join('')
    + (monedas.length === 1 ? `<div style="grid-column:1/-1;font-size:11.5px;color:var(--text-muted)">Para contar también ${nombreMoneda[otra].toLowerCase()}, guardá la tasa de cambio en Caja.</div>` : '')
    + (monedas.length === 2 ? `<div style="grid-column:1/-1;font-size:11.5px;color:var(--text-muted)">Tasa usada: ${ccTasa()} C$ por US$1. Cada moneda se cuenta por separado y se suman en ${nombreMoneda[base]}.</div>` : '');
  actualizarTotalContado();
  openModal('modal-conteo-billetes');
}

// Suma por moneda y total en la moneda oficial del negocio.
function ccCalcularConteo() {
  const porMoneda = { NIO: 0, USD: 0 };
  const det = {};
  document.querySelectorAll('.cc-denom-input').forEach(inp => {
    const cant = parseFloat(inp.value) || 0;
    const m = inp.dataset.moneda || monedaBaseNegocio();
    if (cant > 0) {
      porMoneda[m] += cant * parseFloat(inp.dataset.valor);
      det[`${m}_${inp.dataset.valor}`] = cant;
    }
  });
  const tasa = ccTasa();
  const total = Object.keys(porMoneda).reduce((t, m) => t + ccAOficial(porMoneda[m], m, tasa), 0);
  return { porMoneda, det, tasa, total: round2(total) };
}

function actualizarTotalContado() {
  const r = ccCalcularConteo();
  ['NIO','USD'].forEach(m => {
    const el = document.getElementById('cc-sub-' + m);
    if (el) el.textContent = fmtMoneda(round2(r.porMoneda[m]), m);
  });
  document.getElementById('cc-total-contado').textContent = fmt(r.total);
}

function leerDenominacionesContadas() {
  const r = ccCalcularConteo();
  const detalle = { ...r.det };
  if (r.tasa > 0 && Object.keys(detalle).some(k => !k.startsWith('' + monedaBaseNegocio() + '_'))) detalle._tasa = r.tasa;
  return { detalle, total: r.total };
}

async function confirmarConteoBilletes() {
  // El cierre es la accion mas delicada (deja la caja inoperable
  // hasta reabrirla) -- se pide confirmacion explicita solo para esa,
  // la apertura no la necesita (no es destructiva).
  if (CC.modoConteo === 'cierre') {
    const ok = confirm('¿Confirmas que quieres CERRAR la caja de hoy? Después de cerrarla no podrás registrar más movimientos hasta que la abras de nuevo.');
    if (!ok) { return; }
  }

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
        .select(COLS_MOV_CHICA).eq('auth_user_id', STATE.userId)
        .eq('estado','completado').eq('fecha', hoy);
      const lista = movs || [];
      const { ingEfectivo, egrEfectivo, ingTotal, egrTotal, teorico } = totalesCajaChica(lista, CC.sesionHoy.monto_apertura);
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

    // Detalle movimiento por movimiento -- mismo filtro exacto que ya
    // usa confirmarConteoBilletes() para calcular los totales, asi
    // que el detalle siempre cuadra con lo ya guardado en la sesion.
    const { data: movs } = await sbClient.from('movimientos_financieros')
      .select('tipo_flujo, monto, concepto, tipo_movimiento, created_at, metodo_pago_nombre')
      .eq('auth_user_id', STATE.userId).eq('estado', 'completado').eq('fecha', s.fecha)
      .order('created_at');
    CC.reporteMovimientos = movs || [];

    const filaDenom = (obj, titulo) => {
      const tasaGuardada = Number((obj || {})._tasa) || 0;
      // Claves nuevas "NIO_100"/"USD_20"; las antiguas (solo el valor) se
      // muestran en la moneda oficial, como siempre.
      const entradas = Object.entries(obj || {}).filter(([k]) => !k.startsWith('_')).map(([k, cant]) => {
        const p = k.includes('_') ? k.split('_') : [monedaBaseNegocio(), k];
        return [p[0], Number(p[1]), cant];
      }).sort((a,b) => (a[0] === b[0] ? b[1]-a[1] : (a[0] === monedaBaseNegocio() ? -1 : 1)));
      if (!entradas.length) return `<div style="font-size:12px;color:var(--text-muted)">${titulo}: sin desglose</div>`;
      return `<div style="margin-bottom:8px"><strong style="font-size:12.5px">${titulo}</strong>` +
        entradas.map(([mon,val,cant]) => `<div class="tp-row" style="font-size:12px"><span>${simboloMoneda(mon)}${val} × ${cant}</span><span>${fmtMoneda(val*Number(cant), mon)}</span></div>`).join('') + `</div>`;
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
      </div>
      <div class="table-wrap" style="max-height:280px;overflow-y:auto;margin-top:12px">
        <table class="data-table" style="width:100%">
          <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th style="text-align:right">Monto</th></tr></thead>
          <tbody>
            ${CC.reporteMovimientos.length ? CC.reporteMovimientos.map(m => `
              <tr>
                <td>${new Date(m.created_at).toLocaleTimeString('es-NI', { hour:'2-digit', minute:'2-digit' })}</td>
                <td>${tipoMovLabel(m.tipo_movimiento) || m.tipo_movimiento || '—'}</td>
                <td>${esc(m.concepto || '—')}</td>
                <td style="text-align:right;color:${m.tipo_flujo==='INGRESO'?'var(--success)':'var(--danger)'}">${m.tipo_flujo==='INGRESO'?'+':'-'}${fmt(m.monto)}</td>
              </tr>`).join('') : `<tr><td colspan="4" class="empty-cell">Sin movimientos ese día</td></tr>`}
          </tbody>
        </table>
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

// Exporta el reporte de Caja Chica ya cargado en pantalla a un PDF
// real -- mismo patron exacto (jsPDF + autoTable) ya usado en Ventas,
// Reportes, y en el detalle de Cierre diario.
function exportarReporteCCPDF() {
  const s = CC.reporteActual;
  if (!s) { showToast('Primero abre un reporte', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFontSize(14); doc.setFont(undefined, 'bold');
  doc.text(`Caja Chica — ${fmtDate(s.fecha)}`, 10, 15);
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-NI')}`, 10, 21);

  const dif = Number(s.diferencia || 0);
  let startY = 28;
  doc.autoTable({
    startY,
    head: [['Concepto', 'Monto']],
    body: [
      ['Apertura', fmt(s.monto_apertura)],
      ['Ingresos del día (todos)', fmt(s.total_ingresos)],
      ['Egresos del día (todos)', fmt(s.total_egresos)],
      ['Debería haber (teórico, efectivo)', fmt(s.monto_cierre_teorico)],
      ['Se contó (real)', fmt(s.monto_cierre_real)],
      ['Diferencia', Math.abs(dif) < 0.5 ? 'Cuadró' : (dif > 0 ? 'Sobraron ' + fmt(dif) : 'Faltaron ' + fmt(Math.abs(dif)))],
    ],
    theme: 'striped', headStyles: { fillColor: [90, 90, 244] }, margin: { left: 10, right: 10 }, styles: { fontSize: 9 },
  });
  startY = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(30);
  doc.text('Detalle de movimientos', 10, startY);
  startY += 4;

  doc.autoTable({
    startY,
    head: [['Hora', 'Tipo', 'Concepto', 'Monto']],
    body: (CC.reporteMovimientos || []).map(m => [
      new Date(m.created_at).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }),
      tipoMovLabel(m.tipo_movimiento) || m.tipo_movimiento || '—',
      m.concepto || '—',
      `${m.tipo_flujo === 'INGRESO' ? '+' : '-'}${fmt(m.monto)}`,
    ]),
    theme: 'grid', headStyles: { fillColor: [90, 90, 244] }, margin: { left: 10, right: 10 }, styles: { fontSize: 8 },
  });

  doc.save(`negocio360_caja_chica_${s.fecha}.pdf`);
}

/* =====================================================
   ARRANQUE
===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initCaja();
  if (window.lucide) lucide.createIcons();
});


/* ============================================================
   MODAL DE MONEDA DE VISUALIZACION -- agregado para que este
   modulo tambien pueda ver todo en otra moneda (nunca toca los
   datos reales, solo como se muestran).
   ============================================================ */
function abrirModalMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  document.getElementById('mv-moneda-oficial').textContent = oficial;
  document.getElementById('mv-select-moneda').value = monedaVisualizacionActiva() || '';
  document.getElementById('mv-tasa').value = tasaVisualizacionActiva() || '';
  document.getElementById('mv-error').textContent = '';
  onCambiarSelectMonedaVis();
  document.getElementById('modal-moneda-vis').style.display = 'flex';
}
function onCambiarSelectMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  document.getElementById('mv-wrap-tasa').style.display = (elegida && elegida !== oficial) ? '' : 'none';
}
function guardarMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  const errEl = document.getElementById('mv-error');
  errEl.textContent = '';
  if (!elegida || elegida === oficial) {
    desactivarMonedaVisualizacion();
  } else {
    const tasa = parseFloat(document.getElementById('mv-tasa').value);
    if (!tasa || tasa <= 0) { errEl.textContent = 'Escribe tu tasa de cambio (cordobas por 1 dolar).'; return; }
    activarMonedaVisualizacion(elegida, tasa);
  }
  location.reload();
}
window.addEventListener('DOMContentLoaded', () => {
  // Antes esperaba 800ms fijos, sin importar si los datos reales ya
  // habian llegado -- en conexiones lentas el texto se quedaba con el
  // valor por defecto. Ahora revisa cada 100ms si ya llego
  // empresaConfig, y actualiza en cuanto este listo (maximo 3s de
  // espera, para nunca quedarse esperando para siempre).
  let intentos = 0;
  const intervalo = setInterval(() => {
    intentos++;
    if (STATE.empresaConfig || intentos >= 30) {
      clearInterval(intervalo);
      const btn = document.getElementById('btn-moneda-vis-texto');
      if (btn) btn.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda);
    }
  }, 100);
});
