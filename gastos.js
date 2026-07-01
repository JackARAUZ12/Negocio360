/* =====================================================
   GASTOS.JS — NEGOCIO360
   Centro financiero de EGRESOS del negocio.
   Se integra con Caja a través de window.CajaAPI
   definido en cajaAPI.js (archivo independiente).
   Versión: 1.3 — Fix: renombra sbClient a _sb para evitar conflicto con cajaAPI.js
   (eso causaba un SyntaxError que rompía TODO el script
   y dejaba todos los botones sin funcionar)
===================================================== */

'use strict';

/* =====================================================
   SUPABASE CLIENT
   (reutiliza el cliente ya creado por cajaAPI.js para
   evitar redeclarar SUPABASE_URL/KEY y romper el script)
===================================================== */
const _sb = window.__cajaSB || window.supabase.createClient(
  'https://zvlincmqmmoclqhykejv.supabase.co',
  'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t'
);

/* =====================================================
   CATEGORÍAS DISPONIBLES
===================================================== */
const CATEGORIAS_GASTO = [
  'Publicidad', 'Salarios', 'Internet', 'Electricidad', 'Agua', 'Alquiler',
  'Combustible', 'Impuestos', 'Activos Fijos', 'Licencias', 'Hosting',
  'Dominio', 'Servicios', 'Mantenimiento', 'Otros',
];

const FRECUENCIAS = [
  { v: 'semanal',    l: 'Semanal' },
  { v: 'quincenal',  l: 'Quincenal' },
  { v: 'mensual',    l: 'Mensual' },
  { v: 'trimestral', l: 'Trimestral' },
  { v: 'semestral',  l: 'Semestral' },
  { v: 'anual',      l: 'Anual' },
];

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  currentUser:   {},
  metodosPago:   [],

  gastos:          [],
  gastosPage:      1,
  gastosPerPage:   15,
  gastosTotal:     0,
  gastosFiltro:    'todos',
  gastosSearch:    '',
  gastosCategoria: '',

  gastosProgramados: [],

  kpis: {
    hoy: 0, mes: 0, anio: 0, pendientes: 0,
    recurrentesActivos: 0, salariosPendientes: 0,
  },

  activeSection: 'gastos',
};

/* =====================================================
   HELPERS: FECHA
===================================================== */
function todayISO()        { return new Date().toISOString().split('T')[0]; }
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfYearISO()  { return `${new Date().getFullYear()}-01-01`; }

function daysDiff(dateISO) {
  const today  = new Date(todayISO() + 'T00:00:00');
  const target = new Date(dateISO   + 'T00:00:00');
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function calcularProximaFecha(fechaBaseISO, frecuencia) {
  const d = new Date(fechaBaseISO + 'T12:00:00');
  switch (frecuencia) {
    case 'semanal':    d.setDate(d.getDate() + 7);        break;
    case 'quincenal':  d.setDate(d.getDate() + 15);       break;
    case 'mensual':    d.setMonth(d.getMonth() + 1);      break;
    case 'trimestral': d.setMonth(d.getMonth() + 3);      break;
    case 'semestral':  d.setMonth(d.getMonth() + 6);      break;
    case 'anual':      d.setFullYear(d.getFullYear() + 1); break;
    default:           d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split('T')[0];
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

/* =====================================================
   HELPER: registrar en Caja de forma segura
   No lanza excepción si CajaAPI no está disponible;
   registra el error en consola y retorna {ok:false}.
===================================================== */
async function _registrarEnCaja(params) {
  if (!window.CajaAPI || typeof window.CajaAPI.registrarMovimiento !== 'function') {
    console.error('CajaAPI no está disponible. ¿Olvidaste incluir cajaAPI.js?');
    return { ok: false, error: 'CajaAPI no disponible' };
  }
  return window.CajaAPI.registrarMovimiento(params);
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
   EMPRESA CONFIG / PERFIL
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await _sb
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
    const { data } = await _sb
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

  document.getElementById('header-name').textContent    = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent     = bizName;
  document.getElementById('header-avatar').textContent  = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent      = plan.charAt(0).toUpperCase() + plan.slice(1);

  const hour  = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('greeting-text').textContent  = `${greet}, ${nombre}`;

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
    const { data } = await _sb
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
   MÉTODOS DE PAGO
===================================================== */
async function loadMetodosPago() {
  try {
    const { data } = await _sb
      .from('metodos_pago')
      .select('*')
      .eq('auth_user_id', STATE.userId)
      .eq('activo', true)
      .order('orden');
    STATE.metodosPago = data || [];
    populateMetodoSelects();
  } catch(e) { console.warn('loadMetodosPago:', e); }
}

function populateMetodoSelects() {
  const selects = [
    document.getElementById('gasto-metodo'),
    document.getElementById('pago-metodo'),
  ];
  selects.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = `<option value="">Efectivo (predeterminado)</option>` +
      STATE.metodosPago.map(m =>
        `<option value="${m.id}" data-nombre="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`
      ).join('');
  });
}

/* =====================================================
   KPIs SUPERIORES
===================================================== */
async function loadKpis() {
  try {
    const [hoyRes, mesRes, anioRes, pendRes, progActRes] = await Promise.all([
      _sb.from('gastos').select('monto').eq('auth_user_id', STATE.userId).eq('estado','activo').eq('fecha', todayISO()),
      _sb.from('gastos').select('monto').eq('auth_user_id', STATE.userId).eq('estado','activo').gte('fecha', startOfMonthISO()),
      _sb.from('gastos').select('monto').eq('auth_user_id', STATE.userId).eq('estado','activo').gte('fecha', startOfYearISO()),
      _sb.from('gastos_programados').select('id, monto, fecha_proxima').eq('auth_user_id', STATE.userId).eq('activo', true),
      _sb.from('gastos_programados').select('id', { count: 'exact', head: true }).eq('auth_user_id', STATE.userId).eq('activo', true),
    ]);

    const sum = (rows) => (rows || []).reduce((s, r) => s + Number(r.monto || 0), 0);

    STATE.kpis.hoy  = sum(hoyRes.data);
    STATE.kpis.mes  = sum(mesRes.data);
    STATE.kpis.anio = sum(anioRes.data);

    const hoyDate = todayISO();
    const pendList = pendRes.data || [];
    STATE.kpis.pendientes         = sum(pendList.filter(p => p.fecha_proxima <= hoyDate));
    STATE.kpis.recurrentesActivos = progActRes.count || 0;

    const { data: salariosData } = await _sb
      .from('gastos_programados')
      .select('monto, fecha_proxima, categoria')
      .eq('auth_user_id', STATE.userId)
      .eq('activo', true)
      .eq('categoria', 'Salarios');

    STATE.kpis.salariosPendientes = sum((salariosData || []).filter(s => s.fecha_proxima <= hoyDate));

    renderKpis();
  } catch(e) { console.warn('loadKpis:', e); }
}

function renderKpis() {
  setEl('kpi-gastos-hoy',  fmt(STATE.kpis.hoy));
  setEl('kpi-gastos-mes',  fmt(STATE.kpis.mes));
  setEl('kpi-gastos-anio', fmt(STATE.kpis.anio));
  setEl('kpi-pendientes',  fmt(STATE.kpis.pendientes));
  setEl('kpi-recurrentes', STATE.kpis.recurrentesActivos.toString());
  setEl('kpi-salarios',    fmt(STATE.kpis.salariosPendientes));
}

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* =====================================================
   TABLA PRINCIPAL: GASTOS
===================================================== */
async function loadGastos() {
  try {
    let query = _sb
      .from('gastos')
      .select('*', { count: 'exact' })
      .eq('auth_user_id', STATE.userId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });

    if (STATE.gastosFiltro === 'inmediatos') {
      query = query.eq('tipo', 'inmediato').eq('estado', 'activo');
    } else if (STATE.gastosFiltro === 'programados') {
      query = query.eq('tipo', 'programado').eq('estado', 'activo');
    } else if (STATE.gastosFiltro === 'pagados') {
      query = query.eq('estado', 'activo');
    }

    if (STATE.gastosCategoria) query = query.eq('categoria', STATE.gastosCategoria);
    if (STATE.gastosSearch.trim()) query = query.ilike('concepto', `%${STATE.gastosSearch.trim()}%`);

    const from_range = (STATE.gastosPage - 1) * STATE.gastosPerPage;
    const to_range   = from_range + STATE.gastosPerPage - 1;
    query = query.range(from_range, to_range);

    const { data, count } = await query;
    STATE.gastos      = data || [];
    STATE.gastosTotal = count || 0;

    renderGastosTable();
    renderPaginacion();
  } catch(e) {
    console.warn('loadGastos:', e);
    const tbody = document.getElementById('gastos-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Error al cargar gastos. Intenta de nuevo.</td></tr>`;
  }
}

function renderGastosTable() {
  const tbody = document.getElementById('gastos-tbody');
  if (!tbody) return;

  if (!STATE.gastos.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">
          <div class="empty-state-mini">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <p>Sin gastos registrados</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = STATE.gastos.map(g => {
    const tipoLabel  = g.tipo === 'inmediato' ? 'Inmediato' : 'Programado';
    const tipoClass  = g.tipo === 'inmediato' ? 'badge-inmediato' : 'badge-programado';
    const estadoBadge = g.estado === 'cancelado'
      ? `<span class="status-badge badge-inactive">Cancelado</span>`
      : `<span class="status-badge badge-active">Pagado</span>`;

    const prog    = g.gasto_programado_id
      ? STATE.gastosProgramados.find(p => p.id === g.gasto_programado_id)
      : null;
    const proximo = prog ? fmtDate(prog.fecha_proxima) : '—';

    return `
    <tr class="mov-row ${g.estado === 'cancelado' ? 'mov-anulado' : ''}">
      <td class="td-fecha">${fmtDate(g.fecha)}</td>
      <td class="td-concepto">
        <span class="concepto-text">${escHtml(g.concepto)}</span>
        ${g.empleado     ? `<span class="concepto-obs">Empleado: ${escHtml(g.empleado)}</span>`    : ''}
        ${g.observaciones? `<span class="concepto-obs">${escHtml(g.observaciones)}</span>`         : ''}
      </td>
      <td><span class="cat-badge">${escHtml(g.categoria)}</span></td>
      <td><span class="tipo-badge ${tipoClass}">${tipoLabel}</span></td>
      <td class="td-monto td-salida">${fmt(g.monto)}</td>
      <td>${estadoBadge}</td>
      <td class="td-fecha">${proximo}</td>
      <td class="td-actions">
        <div class="action-cell">
          <button class="btn-icon" onclick="verDetalleGasto('${g.id}')" title="Ver detalle">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          ${g.estado !== 'cancelado' ? `
          <button class="btn-icon btn-icon-danger" onclick="confirmarCancelarGasto('${g.id}')" title="Cancelar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderPaginacion() {
  const totalPages = Math.ceil(STATE.gastosTotal / STATE.gastosPerPage) || 1;
  const info = document.getElementById('paginacion-info');
  if (info) {
    const from = Math.min((STATE.gastosPage - 1) * STATE.gastosPerPage + 1, STATE.gastosTotal);
    const to   = Math.min(STATE.gastosPage * STATE.gastosPerPage, STATE.gastosTotal);
    info.textContent = STATE.gastosTotal > 0
      ? `Mostrando ${from}–${to} de ${STATE.gastosTotal}`
      : 'Sin resultados';
  }
  const btnPrev = document.getElementById('btn-pag-prev');
  const btnNext = document.getElementById('btn-pag-next');
  if (btnPrev) btnPrev.disabled = STATE.gastosPage <= 1;
  if (btnNext) btnNext.disabled = STATE.gastosPage >= totalPages;
}

function paginaAnterior()  { if (STATE.gastosPage > 1) { STATE.gastosPage--; loadGastos(); } }
function paginaSiguiente() {
  const totalPages = Math.ceil(STATE.gastosTotal / STATE.gastosPerPage);
  if (STATE.gastosPage < totalPages) { STATE.gastosPage++; loadGastos(); }
}

function setFiltroGastos(filtro) {
  STATE.gastosFiltro = filtro;
  STATE.gastosPage   = 1;
  document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => {
    b.classList.toggle('active', b.dataset.filtro === filtro);
  });
  loadGastos();
}

function setCategoriaFiltro() {
  STATE.gastosCategoria = document.getElementById('filtro-categoria')?.value || '';
  STATE.gastosPage = 1;
  loadGastos();
}

function buscarGastos() {
  STATE.gastosSearch = document.getElementById('gastos-search')?.value || '';
  STATE.gastosPage   = 1;
  loadGastos();
}

/* =====================================================
   GASTOS PROGRAMADOS
===================================================== */
async function loadGastosProgramados() {
  try {
    const { data } = await _sb
      .from('gastos_programados')
      .select('*')
      .eq('auth_user_id', STATE.userId)
      .order('fecha_proxima', { ascending: true });
    STATE.gastosProgramados = data || [];
    renderGastosProgramados();
  } catch(e) { console.warn('loadGastosProgramados:', e); }
}

function vencimientoBadge(fechaISO, activo) {
  if (!activo) return `<span class="status-badge badge-inactive">Pausado</span>`;
  const diff = daysDiff(fechaISO);
  if (diff < 0)   return `<span class="venc-badge venc-vencido">⚠ Vencido</span>`;
  if (diff === 0) return `<span class="venc-badge venc-hoy">⚠ Vence hoy</span>`;
  if (diff === 1) return `<span class="venc-badge venc-pronto">⚠ Vence mañana</span>`;
  if (diff <= 3)  return `<span class="venc-badge venc-pronto">⚠ Vence en ${diff} días</span>`;
  return `<span class="venc-badge venc-ok">${fmtDate(fechaISO)}</span>`;
}

function renderGastosProgramados() {
  const tbody = document.getElementById('programados-tbody');
  if (!tbody) return;

  if (!STATE.gastosProgramados.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Sin gastos programados. Crea uno para automatizar tus pagos recurrentes.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.gastosProgramados.map(p => {
    const freqLabel = (FRECUENCIAS.find(f => f.v === p.frecuencia) || {}).l || p.frecuencia;
    return `
    <tr class="mov-row ${!p.activo ? 'mov-anulado' : ''}">
      <td>
        <span class="concepto-text">${escHtml(p.nombre)}</span>
        ${p.empleado ? `<span class="concepto-obs">Empleado: ${escHtml(p.empleado)}</span>` : ''}
      </td>
      <td><span class="cat-badge">${escHtml(p.categoria)}</span></td>
      <td class="td-monto td-salida">${fmt(p.monto)}</td>
      <td>${freqLabel}</td>
      <td>${vencimientoBadge(p.fecha_proxima, p.activo)}</td>
      <td>
        <span class="status-badge ${p.activo ? 'badge-active' : 'badge-inactive'}">
          ${p.activo ? 'Activo' : 'Pausado'}
        </span>
      </td>
      <td class="td-actions">
        <div class="action-cell">
          ${p.activo ? `
          <button class="btn-primary" style="padding:6px 12px;font-size:12px" onclick="abrirRegistrarPago('${p.id}')">
            Registrar pago
          </button>
          <button class="btn-icon" onclick="editarProgramado('${p.id}')" title="Editar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon btn-icon-danger" onclick="togglePausarProgramado('${p.id}', false)" title="Pausar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="4" width="4" height="16"/>
              <rect x="14" y="4" width="4" height="16"/>
            </svg>
          </button>` : `
          <button class="btn-icon btn-icon-success" onclick="togglePausarProgramado('${p.id}', true)" title="Reactivar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>`}
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* =====================================================
   MODAL: NUEVO GASTO
===================================================== */
function openNuevoGasto() {
  document.getElementById('gasto-form').reset();
  document.getElementById('gasto-tipo-flujo').value = 'inmediato';
  document.getElementById('gasto-fecha').value = todayISO();
  document.getElementById('gasto-frecuencia-wrap').style.display = 'none';
  document.getElementById('gasto-checkbox-wrap').style.display   = 'none';
  toggleCategoriaEspecial();
  openModal('modal-gasto');
}

function toggleTipoGasto() {
  const tipo       = document.getElementById('gasto-tipo-flujo').value;
  const freqWrap   = document.getElementById('gasto-frecuencia-wrap');
  const checkWrap  = document.getElementById('gasto-checkbox-wrap');
  const fechaLabel = document.getElementById('gasto-fecha-label');

  if (tipo === 'programado') {
    freqWrap.style.display  = 'block';
    checkWrap.style.display = 'flex';
    fechaLabel.textContent  = 'Fecha de inicio / próximo vencimiento';
  } else {
    freqWrap.style.display  = 'none';
    checkWrap.style.display = 'none';
    fechaLabel.textContent  = 'Fecha del gasto';
  }
}

function toggleCategoriaEspecial() {
  const cat         = document.getElementById('gasto-categoria').value;
  const empleadoWrap = document.getElementById('gasto-empleado-wrap');
  if (empleadoWrap) empleadoWrap.style.display = cat === 'Salarios' ? 'block' : 'none';
}

async function saveGasto() {
  const tipo          = document.getElementById('gasto-tipo-flujo').value;
  const categoria     = document.getElementById('gasto-categoria').value;
  const concepto      = document.getElementById('gasto-concepto').value.trim();
  const monto         = parseFloat(document.getElementById('gasto-monto').value);
  const fecha         = document.getElementById('gasto-fecha').value || todayISO();
  const metodoId      = document.getElementById('gasto-metodo').value;
  const observaciones = document.getElementById('gasto-obs').value.trim();
  const empleado      = document.getElementById('gasto-empleado')?.value.trim() || null;

  if (!concepto)           { showToast('El concepto es requerido', 'error'); return; }
  if (!monto || monto <= 0){ showToast('El monto debe ser mayor a 0', 'error'); return; }
  if (categoria === 'Salarios' && !empleado) { showToast('Indica el nombre del empleado', 'error'); return; }

  const metodoPago   = STATE.metodosPago.find(m => m.id === metodoId);
  const metodoNombre = metodoPago?.nombre || 'Efectivo';

  try {
    setBtnLoading('btn-save-gasto', true);

    if (tipo === 'inmediato') {
      await registrarGastoInmediato({ categoria, concepto, monto, fecha, metodoId, metodoNombre, observaciones, empleado });
    } else {
      const frecuencia = document.getElementById('gasto-frecuencia').value;
      const pagarYa    = document.getElementById('gasto-pagar-ya').checked;
      await crearGastoProgramado({ categoria, nombre: concepto, monto, fecha, frecuencia, metodoId, metodoNombre, observaciones, empleado, pagarYa });
    }

    closeModal('modal-gasto');
    showToast('Gasto registrado correctamente');
    await refrescarTodo();
  } catch(e) {
    console.error('saveGasto:', e);
    showToast('Error al guardar el gasto: ' + (e.message || e), 'error');
  } finally {
    setBtnLoading('btn-save-gasto', false);
  }
}

/* =====================================================
   GASTO INMEDIATO
   -> Inserta en `gastos`
   -> Registra movimiento en Caja vía CajaAPI
   -> Vincula movimiento al gasto
===================================================== */
async function registrarGastoInmediato({ categoria, concepto, monto, fecha, metodoId, metodoNombre, observaciones, empleado }) {
  // 1. Insertar en `gastos`
  const { data: gastoRow, error: errGasto } = await _sb
    .from('gastos')
    .insert({
      auth_user_id:       STATE.userId,
      tipo:               'inmediato',
      concepto,
      categoria,
      monto,
      fecha,
      metodo_pago_id:     metodoId || null,
      metodo_pago_nombre: metodoNombre,
      observaciones:      observaciones || null,
      empleado:           empleado || null,
      estado:             'activo',
    })
    .select()
    .single();

  if (errGasto) throw errGasto;

  // 2. Registrar en Caja (no detiene el flujo si falla, solo alerta)
  const mov = await _registrarEnCaja({
    auth_user_id:       STATE.userId,
    tipo_flujo:         'EGRESO',
    tipo_movimiento:    'GASTO',
    concepto:           `${categoria}: ${concepto}`,
    monto,
    metodo_pago_id:     metodoId || null,
    metodo_pago_nombre: metodoNombre,
    referencia_tipo:    'gasto',
    referencia_id:      gastoRow.id,
    observaciones,
    fecha,
  });

  if (!mov.ok) {
    // El gasto ya quedó guardado; solo notificamos en consola.
    // No lanzamos excepción para no mostrar falso error al usuario.
    console.error('No se pudo registrar en Caja:', mov.error);
    return;
  }

  // 3. Vincular movimiento al gasto
  const movId = await getUltimoMovimientoId();
  if (movId) {
    await _sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', gastoRow.id);
  }
}

async function getUltimoMovimientoId() {
  try {
    const { data } = await _sb
      .from('movimientos_financieros')
      .select('id')
      .eq('auth_user_id', STATE.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id || null;
  } catch(e) { return null; }
}

/* =====================================================
   GASTO PROGRAMADO
===================================================== */
async function crearGastoProgramado({ categoria, nombre, monto, fecha, frecuencia, metodoId, metodoNombre, observaciones, empleado, pagarYa }) {
  const { data: progRow, error: errProg } = await _sb
    .from('gastos_programados')
    .insert({
      auth_user_id:  STATE.userId,
      nombre,
      categoria,
      monto,
      frecuencia,
      fecha_proxima: fecha,
      empleado:      empleado || null,
      observaciones: observaciones || null,
      activo:        true,
    })
    .select()
    .single();

  if (errProg) throw errProg;
  if (!pagarYa) return;

  await ejecutarPagoProgramado(progRow, { fecha, metodoId, metodoNombre, observaciones });
}

async function ejecutarPagoProgramado(programado, { fecha, metodoId, metodoNombre, observaciones }) {
  const fechaPago   = fecha || todayISO();
  const metodoFinal = metodoNombre || 'Efectivo';

  // 1. Insertar en `gastos`
  const { data: gastoRow, error: errGasto } = await _sb
    .from('gastos')
    .insert({
      auth_user_id:       STATE.userId,
      tipo:               'programado',
      concepto:           programado.nombre,
      categoria:          programado.categoria,
      monto:              programado.monto,
      fecha:              fechaPago,
      metodo_pago_id:     metodoId || null,
      metodo_pago_nombre: metodoFinal,
      observaciones:      observaciones || programado.observaciones || null,
      empleado:           programado.empleado || null,
      gasto_programado_id: programado.id,
      estado:             'activo',
    })
    .select()
    .single();

  if (errGasto) throw errGasto;

  // 2. Registrar en Caja
  const mov = await _registrarEnCaja({
    auth_user_id:       STATE.userId,
    tipo_flujo:         'EGRESO',
    tipo_movimiento:    'GASTO',
    concepto:           `${programado.categoria}: ${programado.nombre}`,
    monto:              programado.monto,
    metodo_pago_id:     metodoId || null,
    metodo_pago_nombre: metodoFinal,
    referencia_tipo:    'gasto',
    referencia_id:      gastoRow.id,
    observaciones,
    fecha:              fechaPago,
  });

  if (!mov.ok) {
    console.error('No se pudo registrar pago programado en Caja:', mov.error);
    // Continuamos para no interrumpir el flujo
  } else {
    const movId = await getUltimoMovimientoId();
    if (movId) {
      await _sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', gastoRow.id);
    }
  }

  // 3. Historial de gastos
  await _sb.from('historial_gastos').insert({
    auth_user_id:       STATE.userId,
    gasto_programado_id: programado.id,
    gasto_id:            gastoRow.id,
    monto:               programado.monto,
    fecha_pago:          fechaPago,
  });

  // 4. Siguiente vencimiento
  const proxima = calcularProximaFecha(fechaPago, programado.frecuencia);
  await _sb.from('gastos_programados').update({ fecha_proxima: proxima }).eq('id', programado.id);
}

/* =====================================================
   MODAL: REGISTRAR PAGO (de programado existente)
===================================================== */
let programadoEnPago = null;

function abrirRegistrarPago(programadoId) {
  const prog = STATE.gastosProgramados.find(p => p.id === programadoId);
  if (!prog) return;
  programadoEnPago = prog;

  document.getElementById('pago-prog-nombre').textContent = prog.nombre;
  document.getElementById('pago-prog-monto').textContent  = fmt(prog.monto);
  document.getElementById('pago-prog-vencimiento').innerHTML = vencimientoBadge(prog.fecha_proxima, prog.activo);
  document.getElementById('pago-fecha').value  = todayISO();
  document.getElementById('pago-metodo').innerHTML = document.getElementById('gasto-metodo').innerHTML;
  document.getElementById('pago-metodo').value = '';
  document.getElementById('pago-obs').value    = '';

  openModal('modal-registrar-pago');
}

async function confirmarRegistrarPago() {
  if (!programadoEnPago) return;
  const fecha        = document.getElementById('pago-fecha').value || todayISO();
  const metodoId     = document.getElementById('pago-metodo').value;
  const metodoPago   = STATE.metodosPago.find(m => m.id === metodoId);
  const metodoNombre = metodoPago?.nombre || 'Efectivo';
  const observaciones = document.getElementById('pago-obs').value.trim();

  try {
    setBtnLoading('btn-confirmar-pago', true);
    await ejecutarPagoProgramado(programadoEnPago, { fecha, metodoId, metodoNombre, observaciones });
    closeModal('modal-registrar-pago');
    programadoEnPago = null;
    showToast('Pago registrado correctamente');
    await refrescarTodo();
  } catch(e) {
    console.error('confirmarRegistrarPago:', e);
    showToast('Error al registrar el pago', 'error');
  } finally {
    setBtnLoading('btn-confirmar-pago', false);
  }
}

/* =====================================================
   EDITAR / PAUSAR PROGRAMADO
===================================================== */
function editarProgramado(id) {
  const p = STATE.gastosProgramados.find(x => x.id === id);
  if (!p) return;

  document.getElementById('edit-prog-id').value        = p.id;
  document.getElementById('edit-prog-nombre').value    = p.nombre;
  document.getElementById('edit-prog-categoria').value = p.categoria;
  document.getElementById('edit-prog-monto').value     = p.monto;
  document.getElementById('edit-prog-frecuencia').value = p.frecuencia;
  document.getElementById('edit-prog-fecha').value     = p.fecha_proxima;
  document.getElementById('edit-prog-obs').value       = p.observaciones || '';

  const empWrap = document.getElementById('edit-prog-empleado-wrap');
  if (empWrap) {
    empWrap.style.display = p.categoria === 'Salarios' ? 'block' : 'none';
    document.getElementById('edit-prog-empleado').value = p.empleado || '';
  }

  openModal('modal-editar-programado');
}

function toggleCategoriaEspecialEdit() {
  const cat  = document.getElementById('edit-prog-categoria').value;
  const wrap = document.getElementById('edit-prog-empleado-wrap');
  if (wrap) wrap.style.display = cat === 'Salarios' ? 'block' : 'none';
}

async function guardarEdicionProgramado() {
  const id           = document.getElementById('edit-prog-id').value;
  const nombre       = document.getElementById('edit-prog-nombre').value.trim();
  const categoria    = document.getElementById('edit-prog-categoria').value;
  const monto        = parseFloat(document.getElementById('edit-prog-monto').value);
  const frecuencia   = document.getElementById('edit-prog-frecuencia').value;
  const fechaProxima = document.getElementById('edit-prog-fecha').value;
  const observaciones = document.getElementById('edit-prog-obs').value.trim();
  const empleado     = document.getElementById('edit-prog-empleado')?.value.trim() || null;

  if (!nombre)           { showToast('El nombre es requerido', 'error'); return; }
  if (!monto || monto <= 0) { showToast('El monto debe ser mayor a 0', 'error'); return; }

  try {
    setBtnLoading('btn-guardar-edicion-prog', true);
    await _sb.from('gastos_programados').update({
      nombre, categoria, monto, frecuencia,
      fecha_proxima: fechaProxima,
      observaciones: observaciones || null,
      empleado:      empleado || null,
    }).eq('id', id).eq('auth_user_id', STATE.userId);

    closeModal('modal-editar-programado');
    showToast('Programación actualizada');
    await refrescarTodo();
  } catch(e) {
    showToast('Error al actualizar la programación', 'error');
  } finally {
    setBtnLoading('btn-guardar-edicion-prog', false);
  }
}

async function togglePausarProgramado(id, activar) {
  try {
    await _sb.from('gastos_programados')
      .update({ activo: activar })
      .eq('id', id)
      .eq('auth_user_id', STATE.userId);
    showToast(activar ? 'Programación reactivada' : 'Programación pausada');
    await refrescarTodo();
  } catch(e) { showToast('Error al actualizar', 'error'); }
}

/* =====================================================
   CANCELAR GASTO
===================================================== */
let gastoToCancelar = null;

function confirmarCancelarGasto(id) {
  gastoToCancelar = id;
  openModal('modal-confirmar-cancelar');
}

async function cancelarGasto() {
  if (!gastoToCancelar) return;
  try {
    setBtnLoading('btn-confirmar-cancelar', true);
    await _sb.from('gastos').update({
      estado:            'cancelado',
      cancelado_en:      new Date().toISOString(),
      cancelado_motivo:  'Cancelado manualmente',
    }).eq('id', gastoToCancelar).eq('auth_user_id', STATE.userId);

    closeModal('modal-confirmar-cancelar');
    gastoToCancelar = null;
    showToast('Gasto cancelado. El movimiento en Caja no se modifica automáticamente.');
    await refrescarTodo();
  } catch(e) {
    showToast('Error al cancelar', 'error');
  } finally {
    setBtnLoading('btn-confirmar-cancelar', false);
  }
}

/* =====================================================
   DETALLE DE GASTO
===================================================== */
async function verDetalleGasto(id) {
  const g = STATE.gastos.find(x => x.id === id);
  if (!g) return;

  let historialHtml = '<p style="color:var(--text-muted);font-size:12.5px">Sin historial de pagos asociado.</p>';
  let progInfo      = '';

  if (g.gasto_programado_id) {
    const prog = STATE.gastosProgramados.find(p => p.id === g.gasto_programado_id);
    if (prog) {
      const freqLabel = (FRECUENCIAS.find(f => f.v === prog.frecuencia) || {}).l || prog.frecuencia;
      progInfo = `
        <div class="detalle-row"><span>Frecuencia</span><strong>${freqLabel}</strong></div>
        <div class="detalle-row"><span>Próximo vencimiento</span><strong>${fmtDate(prog.fecha_proxima)}</strong></div>
      `;
    }

    try {
      const { data: hist } = await _sb
        .from('historial_gastos')
        .select('monto, fecha_pago')
        .eq('gasto_programado_id', g.gasto_programado_id)
        .eq('auth_user_id', STATE.userId)
        .order('fecha_pago', { ascending: false })
        .limit(10);

      if (hist && hist.length) {
        historialHtml = hist.map(h => `
          <div class="detalle-row">
            <span>${fmtDate(h.fecha_pago)}</span>
            <strong>${fmt(h.monto)}</strong>
          </div>
        `).join('');
      }
    } catch(e) { /* silencioso */ }
  }

  document.getElementById('detalle-gasto-body').innerHTML = `
    <div class="detalle-row"><span>Concepto</span><strong>${escHtml(g.concepto)}</strong></div>
    <div class="detalle-row"><span>Categoría</span><strong>${escHtml(g.categoria)}</strong></div>
    <div class="detalle-row"><span>Tipo</span><strong>${g.tipo === 'inmediato' ? 'Inmediato' : 'Programado'}</strong></div>
    <div class="detalle-row"><span>Monto</span><strong>${fmt(g.monto)}</strong></div>
    <div class="detalle-row"><span>Fecha</span><strong>${fmtDate(g.fecha)}</strong></div>
    <div class="detalle-row"><span>Método de pago</span><strong>${escHtml(g.metodo_pago_nombre || 'Efectivo')}</strong></div>
    ${g.empleado ? `<div class="detalle-row"><span>Empleado</span><strong>${escHtml(g.empleado)}</strong></div>` : ''}
    <div class="detalle-row"><span>Estado</span><strong>${g.estado === 'activo' ? 'Pagado' : 'Cancelado'}</strong></div>
    ${g.observaciones ? `<div class="detalle-row"><span>Observaciones</span><strong>${escHtml(g.observaciones)}</strong></div>` : ''}
    ${g.movimiento_financiero_id ? `<div class="detalle-row"><span>Movimiento en Caja</span><strong style="color:var(--accent)">Generado ✓</strong></div>` : ''}
    ${progInfo}
    <div class="detalle-divider"></div>
    <p style="font-size:11.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">
      Historial de pagos
    </p>
    ${historialHtml}
  `;

  openModal('modal-detalle-gasto');
}

/* =====================================================
   REFRESCAR TODO
===================================================== */
async function refrescarTodo() {
  await Promise.allSettled([
    loadKpis(),
    loadGastos(),
    loadGastosProgramados(),
  ]);
}

/* =====================================================
   SECCIONES
===================================================== */
function setSection(section) {
  STATE.activeSection = section;
  document.querySelectorAll('.section-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.section === section);
  });
  document.querySelectorAll('.section-panel').forEach(p => {
    p.style.display = p.dataset.section === section ? 'block' : 'none';
  });

  if (section === 'gastos')      loadGastos();
  if (section === 'programados') loadGastosProgramados();
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
  el.className   = `toast toast-${type} toast-show`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('toast-show'), 3500);
}

/* =====================================================
   HELPERS UI
===================================================== */
function setBtnLoading(id, loading) {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled      = loading;
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

function populateCategoriaSelects() {
  const selects = [
    document.getElementById('gasto-categoria'),
    document.getElementById('edit-prog-categoria'),
    document.getElementById('filtro-categoria'),
  ];
  selects.forEach(sel => {
    if (!sel) return;
    const isFiltro = sel.id === 'filtro-categoria';
    sel.innerHTML = (isFiltro ? '<option value="">Todas las categorías</option>' : '') +
      CATEGORIAS_GASTO.map(c => `<option value="${c}">${c}</option>`).join('');
  });

  const freqSelects = [
    document.getElementById('gasto-frecuencia'),
    document.getElementById('edit-prog-frecuencia'),
  ];
  freqSelects.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = FRECUENCIAS.map(f => `<option value="${f.v}">${f.l}</option>`).join('');
  });
}

/* =====================================================
   INIT PRINCIPAL
===================================================== */
async function initGastos() {
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);

  const now     = new Date();
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = now.toLocaleDateString('es-NI', {
    day:'numeric', month:'long', year:'numeric'
  });

  populateCategoriaSelects();

  try {
    const { data: { user }, error } = await _sb.auth.getUser();
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
    }

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await loadMetodosPago();
    await refrescarTodo();

    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'new') openNuevoGasto();

  } catch(err) {
    console.error('initGastos:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

/* =====================================================
   AUTH LISTENER
===================================================== */
_sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

/* =====================================================
   ARRANQUE
===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initGastos();
  if (window.lucide) lucide.createIcons();
});
