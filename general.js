/* ============================================================
   REPORTES.JS — NEGOCIO360
   Motor analítico central. Dashboard y todos los módulos
   consultan este motor. NO duplica lógica ni tablas.
   ============================================================ */

'use strict';

/* ============================================================
   SUPABASE
   ============================================================ */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbReal = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// Envuelto con el adaptador de grupo (reporte-grupo-shim.js): TODO el
// resto de este archivo sigue exactamente igual que reportes.js —
// solo que las consultas a tablas de reportes ahora traen los datos
// combinados de la Central + todas sus sucursales/bodegas.
const sb = crearClienteGrupo(sbReal);

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const R = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  exportConfig:  {}, // NUEVO: qué columnas mostrar en PDF/Excel por tipo de reporte (elegido por el cliente)
  currentUser:   {},
  moneda:        'C$',

  // Período activo
  periodo:       'mes',
  fechaDesde:    '',
  fechaHasta:    '',

  // Tab activo
  tabActivo:     'ejecutivo',

  // Cache de datos por módulo (para exportaciones y re-renders sin consultar de nuevo)
  cache: {
    ventas:         [],
    ventasDetalles: [], // NUEVO: detalles (líneas) de venta, para saber cuántos productos se vendieron por venta
    compras:        [],
    gastos:         [],
    clientes:       [],
    productos:      [],
    movimientos:    [],
    resumen:        {},
    // NUEVO: historial de pagos de créditos (una fila por cuota, con
    // datos del cliente) — se filtra siempre a UN cliente elegido por el
    // usuario, tanto en pantalla como al exportar.
    creditosPagos:  [],
    // Resumen por crédito (todos los clientes) — solo para el Reporte
    // General, como sección de resumen del negocio (no es "historial").
    creditosResumen: [],
  },

  // Cliente actualmente elegido en la pestaña Créditos (pantalla). null =
  // ningún cliente elegido todavía → no se muestra ningún historial.
  creditoClienteSeleccionado: null,

  // Referencias a instancias de Chart.js (para destruir antes de re-crear)
  charts: {},
};

// Estado del modal "Exportar historial de crédito" (independiente de R
// para no interferir con nada del resto del sistema).
const MX = { formato: null, clienteId: null, clienteNombre: null };

/* ============================================================
   HELPERS FECHA
   FIX: parseFechaSegura() ahora acepta tanto fechas simples
   "YYYY-MM-DD" (columnas tipo date) como timestamps completos
   con hora/zona horaria (columnas tipo timestamptz). Antes se
   concatenaba siempre "T12:00:00" a lo que viniera, y si el
   valor ya traía hora/zona (ej. "2026-07-01T00:00:00+00:00")
   el resultado quedaba mal formado y Date() devolvía
   "Invalid Date" — eso es lo que se veía en la sección de
   Ventas.
   ============================================================ */
function parseFechaSegura(input) {
  if (!input) return null;
  const str = String(input);
  // Si ya trae información de hora (timestamp completo), la usamos tal cual
  if (str.includes('T')) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fecha simple "YYYY-MM-DD" → forzamos mediodía para evitar
  // desfaces de zona horaria al mostrarla
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

// FIX CRÍTICO DE ZONA HORARIA: `new Date().toISOString()` da la fecha
// en UTC. Nicaragua es UTC-6, así que desde las 6:00 PM hora local la
// fecha en UTC ya es el día siguiente, lo que hacía que reportes y
// filtros de "hoy"/"esta semana" no encontraran ventas registradas por
// la noche. Ahora se usa la fecha calendario LOCAL del dispositivo.
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayISO() { return ymd(new Date()); }
function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate()-1);
  return ymd(d);
}
function startOfWeekISO() {
  const d = new Date(), day = d.getDay();
  d.setDate(d.getDate() - day + (day===0 ? -6 : 1));
  return ymd(d);
}
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfYearISO() { return `${new Date().getFullYear()}-01-01`; }

function getDateRange() {
  const today = todayISO();
  switch (R.periodo) {
    case 'hoy':    return { from: today,             to: today };
    case 'ayer':   return { from: yesterdayISO(),    to: yesterdayISO() };
    case 'semana': return { from: startOfWeekISO(),  to: today };
    case 'mes':    return { from: startOfMonthISO(), to: today };
    case 'anio':   return { from: startOfYearISO(),  to: today };
    case 'custom': return { from: R.fechaDesde||today, to: R.fechaHasta||today };
    default:       return { from: startOfMonthISO(), to: today };
  }
}

function fmtFecha(iso) {
  const d = parseFechaSegura(iso);
  if (!d) return '—';
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtFechaCorta(iso) {
  const d = parseFechaSegura(iso);
  if (!d) return '—';
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short' });
}

function periodLabel() {
  switch (R.periodo) {
    case 'hoy':    return 'Hoy';
    case 'ayer':   return 'Ayer';
    case 'semana': return 'Esta semana';
    case 'mes':    return 'Este mes';
    case 'anio':   return 'Este año';
    case 'custom': return `${R.fechaDesde} — ${R.fechaHasta}`;
    default:       return 'Este mes';
  }
}

/* ============================================================
   HELPERS MONEDA
   ============================================================ */
function sym() { return R.moneda || 'C$'; }

function fmt(n) {
  const v = parseFloat(n||0);
  return `${sym()} ${v.toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
}

function fmtShort(n) {
  const v = parseFloat(n||0), s = sym();
  if (v >= 1_000_000) return `${s}${(v/1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${s}${(v/1_000).toFixed(1)}k`;
  return `${s}${v.toLocaleString('es-NI', { minimumFractionDigits:0, maximumFractionDigits:0 })}`;
}

function fmtNum(n) {
  const v = parseFloat(n||0);
  return v.toLocaleString('es-NI', { minimumFractionDigits:0, maximumFractionDigits:2 });
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============================================================
   TEMA
   ============================================================ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('n360_theme', t);
  const sun  = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = t==='dark'  ? 'block' : 'none';
  if (moon) moon.style.display = t==='light' ? 'block' : 'none';
  // Actualizar colores de charts si existen
  Object.values(R.charts).forEach(ch => { if (ch) updateChartTheme(ch); });
}

function toggleTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark');
}

function updateChartTheme(chart) {
  const isDark = document.documentElement.getAttribute('data-theme')==='dark';
  const grid   = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const ticks  = isDark ? '#9090b0' : '#9999b3';
  if (chart.options?.scales) {
    Object.values(chart.options.scales).forEach(sc => {
      if (sc.grid) sc.grid.color = grid;
      if (sc.ticks) sc.ticks.color = ticks;
    });
    chart.update();
  }
}

/* ============================================================
   SIDEBAR / NAVEGACIÓN
   FIX: antes toggleSidebar() solo alternaba el modo "colapsado"
   (ícono-solo) de escritorio. En pantallas móviles (≤768px) el
   sidebar queda oculto por CSS (transform:translateX(-100%)) y
   nada lo mostraba nunca — el menú era inaccesible en celular.
   Ahora se detecta el viewport: en móvil abre/cierra un drawer
   con overlay; en escritorio conserva el comportamiento
   original de colapsar/expandir.
   ============================================================ */
let sidebarCollapsed = false;
const MOBILE_BREAKPOINT = 768;

function isMobileView() { return window.innerWidth <= MOBILE_BREAKPOINT; }

function toggleSidebar() {
  if (isMobileView()) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('active', isOpen);
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
}

window.addEventListener('resize', () => {
  if (!isMobileView()) closeMobileSidebar();
});

function navigate(url) {
  closeMobileSidebar();
  window.location.href = url;
}

/* ============================================================
   TOAST
   ============================================================ */
let _toastTimer = null;
function showToast(msg, type='success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ============================================================
   EMPRESA CONFIG
   FIX: el nombre del negocio se guarda en personalizacion.html
   dentro de configuracion_empresa.nombre_comercial. Aquí se
   estaba buscando primero "nombre_negocio" (campo que no existe
   en esa tabla), por lo que casi siempre caía al valor por
   defecto genérico. Ahora se prioriza nombre_comercial.
   ============================================================ */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*')
      .eq('auth_user_id', userId).maybeSingle();
    if (data) {
      R.empresaConfig = data;
      R.moneda = data.moneda || 'C$';
      // NUEVO: configuración de columnas de exportación guardada por el cliente.
      // Si nunca configuró nada (o metadata viene vacío/null), queda {} y
      // todas las columnas se consideran activas por defecto (ver colActiva()).
      R.exportConfig = (data.metadata && typeof data.metadata === 'object' && data.metadata.exportConfig) || {};
      const biz = data.nombre_comercial || data.nombre_negocio || data.nombre || 'Mi negocio';
      const lt  = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = biz;
      if (data.color_principal || data.color_primario) {
        const col = data.color_principal || data.color_primario;
        document.documentElement.style.setProperty('--accent', col);
        document.documentElement.style.setProperty('--accent-soft', col+'22');
        document.documentElement.style.setProperty('--border-focus', col);
      }
      if (data.logo_principal_url || data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_principal_url || data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch(e) { console.warn('loadEmpresaConfig:', e); }
}

async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*')
      .eq('auth_user_id', userId).maybeSingle();
    return data;
  } catch { return null; }
}

function renderUserInfo(user, email) {
  if (!user) return;
  R.currentUser = user;
  const nombre   = user.nombre   || email?.split('@')[0] || 'Usuario';
  const apellido = user.apellido || '';
  // FIX: priorizar nombre_comercial de configuracion_empresa (el campo real
  // guardado por personalizacion.html) en vez de "Mi negocio" fijo.
  const biz      = R.empresaConfig?.nombre_comercial || R.empresaConfig?.nombre_negocio || user.nombre_negocio || 'Mi negocio';
  const plan     = user.plan || 'Gratuito';
  const initials = ((nombre[0]||'')+(apellido[0]||'')).toUpperCase();

  document.getElementById('header-name').textContent   = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent    = biz;
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent     = plan.charAt(0).toUpperCase()+plan.slice(1);
}

async function checkAdminAccess(email) {
  try {
    const { data } = await sb.from('administradores').select('email,activo')
      .eq('email', email).eq('activo', true).maybeSingle();
    if (data) {
      const el = document.getElementById('nav-admin');
      if (el) el.style.display = 'flex';
    }
  } catch { /* silencioso */ }
}

/* ============================================================
   PERÍODO
   ============================================================ */
function setPeriodo(p) {
  R.periodo = p;
  document.querySelectorAll('.periodo-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.periodo===p));
  const cr = document.getElementById('custom-range');
  if (cr) cr.classList.toggle('visible', p==='custom');
  actualizarPeriodoInfo();
  refreshAll();
}

function onCustomDate() {
  R.fechaDesde = document.getElementById('custom-from')?.value || '';
  R.fechaHasta = document.getElementById('custom-to')?.value   || '';
  if (R.fechaDesde && R.fechaHasta) {
    actualizarPeriodoInfo();
    refreshAll();
  }
}

function actualizarPeriodoInfo() {
  const { from, to } = getDateRange();
  const el = document.getElementById('periodo-info-label');
  if (el) el.textContent = from===to ? fmtFecha(from) : `${fmtFecha(from)} — ${fmtFecha(to)}`;
  const exEl = document.getElementById('exec-period-label');
  if (exEl) exEl.textContent = periodLabel();
}

/* ============================================================
   TABS
   ============================================================ */
function switchTab(tab) {
  R.tabActivo = tab;
  document.querySelectorAll('.main-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab===tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id===`panel-${tab}`));
  loadTab(tab);
}

async function loadTab(tab) {
  switch(tab) {
    case 'ejecutivo':   await loadEjecutivo();  break;
    case 'financiero':  await loadFinanciero();  break;
    case 'ventas':      await loadVentasTab();   break;
    case 'compras':     await loadComprasTab();  break;
    case 'inventario':  await loadInventario();  break;
    case 'clientes':    await loadClientesTab(); break;
    case 'creditos':    await loadCreditosTab(); break;
    case 'gastos':      await loadGastosTab();   break;
    case 'alertas':     await loadAlertas();     break;
    case 'exportar':    renderConfigExportar();  break;
  }
}

/* ============================================================
   REFRESH ALL
   ============================================================ */
async function refreshAll() {
  actualizarPeriodoInfo();
  await loadTab(R.tabActivo);
}

/* ============================================================
   HELPER: CHART.JS DEFAULTS
   ============================================================ */
function chartDefaults() {
  const isDark = document.documentElement.getAttribute('data-theme')==='dark';
  return {
    grid:  isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    ticks: isDark ? '#9090b0' : '#9999b3',
    font:  "'Plus Jakarta Sans', sans-serif",
  };
}

const CHART_COLORS = [
  '#5a5af4','#22c55e','#f97316','#8b5cf6','#06b6d4',
  '#f59e0b','#ef4444','#ec4899','#10b981','#3b82f6',
];

function destroyChart(key) {
  if (R.charts[key]) { R.charts[key].destroy(); R.charts[key] = null; }
}

function createLineChart(canvasId, labels, datasets, key) {
  destroyChart(key);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const d = chartDefaults();
  R.charts[key] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: datasets.map(ds => ({
      ...ds,
      fill: ds.fill !== undefined ? ds.fill : false,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
    }))},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: d.ticks, font:{ family:d.font, size:11 } } },
        tooltip: { backgroundColor:'#1e1e30', titleColor:'#f0f0fa', bodyColor:'#9090b0',
          padding:12, cornerRadius:8,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${sym()} ${ctx.parsed.y.toLocaleString('es-NI',{minimumFractionDigits:2})}` }
        },
      },
      scales: {
        x: { grid:{color:d.grid}, ticks:{color:d.ticks,font:{family:d.font,size:11}} },
        y: { grid:{color:d.grid}, ticks:{color:d.ticks,font:{family:d.font,size:11},
          callback: v => fmtShort(v) } },
      },
    },
  });
}

function createBarChart(canvasId, labels, datasets, key, stacked=false) {
  destroyChart(key);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const d = chartDefaults();
  R.charts[key] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: datasets.map(ds => ({ ...ds, borderRadius:4, borderSkipped:false })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: datasets.length > 1, labels:{ color:d.ticks, font:{family:d.font,size:11} } },
        tooltip: { backgroundColor:'#1e1e30', titleColor:'#f0f0fa', bodyColor:'#9090b0',
          padding:12, cornerRadius:8,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${sym()} ${ctx.parsed.y.toLocaleString('es-NI',{minimumFractionDigits:2})}` }
        },
      },
      scales: {
        x: { stacked, grid:{color:'transparent'}, ticks:{color:d.ticks,font:{family:d.font,size:11}} },
        y: { stacked, grid:{color:d.grid}, ticks:{color:d.ticks,font:{family:d.font,size:11},
          callback: v => fmtShort(v) } },
      },
    },
  });
}

function createDoughnutChart(canvasId, labels, data, key) {
  destroyChart(key);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const d = chartDefaults();
  R.charts[key] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: CHART_COLORS.slice(0,labels.length), borderWidth:0, hoverOffset:6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout:'65%',
      plugins: {
        legend: { display:false },
        tooltip: { backgroundColor:'#1e1e30', titleColor:'#f0f0fa', bodyColor:'#9090b0',
          padding:10, cornerRadius:8,
          callbacks: { label: ctx => `${ctx.label}: ${sym()} ${ctx.parsed.toLocaleString('es-NI',{minimumFractionDigits:2})}` }
        },
      },
    },
  });
}

function renderDonutLegend(containerId, labels, values, total) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = labels.map((l,i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-secondary)">
        <div style="width:10px;height:10px;border-radius:50%;background:${CHART_COLORS[i]};flex-shrink:0"></div>
        <span>${esc(l)}</span>
      </div>
      <div style="text-align:right">
        <span style="font-size:12.5px;font-weight:700;color:var(--text-primary)">${fmtShort(values[i])}</span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:4px">${total>0?((values[i]/total)*100).toFixed(0):'0'}%</span>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   RANK MEDAL HTML
   ============================================================ */
function rankIcon(i) {
  if (i===0) return '<span class="medal-gold">🥇</span>';
  if (i===1) return '<span class="medal-silver">🥈</span>';
  if (i===2) return '<span class="medal-bronze">🥉</span>';
  return `<span style="font-size:12px;font-weight:700;color:var(--text-muted)">${i+1}</span>`;
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px">${msg}</td></tr>`;
}

/* ============================================================
   ======================================================
   MOTOR ANALÍTICO — CÁLCULOS CENTRALIZADOS
   Este es el único lugar donde se calculan los KPIs.
   Dashboard DEBE consumir estas funciones.
   ======================================================
   ============================================================ */

/* ---- VENTAS ---- */
async function fetchVentas() {
  const { from, to } = getDateRange();
  const { data } = await sb.from('ventas')
    .select('id,numero_venta,fecha,cliente_id,cliente_nombre,total,ganancia,costo_total,subtotal,descuento,impuesto,metodo_pago_nombre,estado')
    .eq('auth_user_id', R.userId)
    .eq('estado', 'completada')
    .gte('fecha', from).lte('fecha', to)
    .order('fecha', { ascending:false });
  R.cache.ventas = data || [];
  return R.cache.ventas;
}

async function fetchVentasDetalles() {
  if (!R.cache.ventas.length) return [];
  const ventaIds = R.cache.ventas.map(v => v.id);
  const { data } = await sb.from('venta_detalles')
    .select('venta_id,producto_id,producto_nombre,tipo_item,cantidad,precio,costo,subtotal,ganancia')
    .eq('auth_user_id', R.userId)
    .in('venta_id', ventaIds);
  return data || [];
}

/* FIX IVA: "total" NO debe usarse tal cual — incluye el IVA cobrado al
   cliente, que no es ingreso del negocio (se recauda para el fisco y se
   contabiliza aparte en Impuestos). Se resta "impuesto" para obtener el
   ingreso neto real, igual que en dashboard.html y caja.js.
   FIX GANANCIA: la "ganancia bruta" ahora se calcula SIEMPRE como
   ingreso neto - costo (no se suma el campo "ganancia" guardado por cada
   venta), para que cuadre exacto con Ingresos - Costos, igual que se
   corrigió en el Dashboard. */
function calcVentasResumen(ventas) {
  const total    = ventas.reduce((s,v) => s + (Number(v.total) - Number(v.impuesto||0)), 0);
  const costo    = ventas.reduce((s,v) => s+Number(v.costo_total),0);
  const ganancia = total - costo;
  const count    = ventas.length;
  const ticket   = count>0 ? total/count : 0;
  // "Venta mayor" usa el total real cobrado al cliente (con IVA incluido),
  // igual que la columna "Total" del historial de Ventas — es el monto
  // real de una transacción individual, no un agregado de ingresos.
  const mayor    = ventas.reduce((m,v) => Number(v.total)>Number(m.total) ? v : m, ventas[0]||{total:0});
  return { total, ganancia, costo, count, ticket, mayor };
}

/* FIX: no basta con saber CUÁNTOS productos se vendieron — hay que saber
   CUÁLES. Se agrupan las líneas de venta_detalles por venta_id y se
   separan en dos listas:
     - productos: nombre + cantidad (sí se cuentan como unidades, porque
       son artículos físicos: 2 camisas son 2 camisas).
     - servicios: solo el nombre, SIN sumar cantidades — un servicio no
       se "cuenta" como 20 unidades de producto; cada servicio es una
       prestación individual, así que solo se listan los nombres.
   Se usa en los reportes de Ventas (PDF y Excel) y en el Reporte
   General. */
function detalleVentaPorVenta(detalles) {
  // NUEVO: mapa producto_id -> proveedor_nombre (a partir del catálogo de
  // productos ya cacheado por ensureCaches/fetchProductos) para poder
  // indicar de qué proveedor(es) vinieron los productos de cada venta.
  const proveedorPorProducto = {};
  (R.cache.productos || []).forEach(p => {
    if (p.proveedor_nombre) proveedorPorProducto[p.id] = p.proveedor_nombre;
  });

  const map = {};
  (detalles || []).forEach(d => {
    const vid = d.venta_id;
    if (!map[vid]) map[vid] = { productos: [], servicios: new Set(), proveedores: new Set() };
    const nombre = d.producto_nombre || (d.tipo_item==='servicio' ? 'Servicio' : 'Producto');
    if (d.tipo_item === 'producto') {
      map[vid].productos.push({ nombre, cantidad: Number(d.cantidad || 0) });
      const prov = proveedorPorProducto[d.producto_id];
      if (prov) map[vid].proveedores.add(prov);
    } else {
      map[vid].servicios.add(nombre);
    }
  });
  return map;
}

// Texto para la casilla "Productos" de una venta puntual.
// Si la venta NO tuvo productos (solo servicios), se indica "No producto"
// en lugar de dejar la casilla vacía o en 0.
function fmtProductosVenta(info) {
  if (!info || !info.productos.length) return 'No producto';
  return info.productos.map(p => `${p.nombre} x${fmtNum(p.cantidad)}`).join(', ');
}

// Texto para la casilla "Servicios" de una venta puntual. Solo nombres,
// sin cantidades sumadas (cada servicio es individual).
function fmtServiciosVenta(info) {
  if (!info || !info.servicios.size) return '—';
  return Array.from(info.servicios).join(', ');
}

// Texto para la casilla "Proveedor" de una venta puntual. Si los
// productos de la venta vienen de varios proveedores distintos, se
// indica "Varios"; si ninguno tiene proveedor asignado, se deja "—".
function fmtProveedorVenta(info) {
  if (!info || !info.proveedores.size) return '—';
  if (info.proveedores.size === 1) return Array.from(info.proveedores)[0];
  return 'Varios';
}

// Total de UNIDADES de producto (no de servicios) vendidas en el
// período, para la fila de totales del reporte de Ventas.
function totalUnidadesProducto(detalleMap) {
  return Object.values(detalleMap).reduce((s, info) =>
    s + info.productos.reduce((s2,p) => s2 + p.cantidad, 0), 0);
}

/* ---- COMPRAS ---- */
async function fetchCompras() {
  const { from, to } = getDateRange();
  const { data } = await sb.from('compras')
    .select('id,numero,fecha,proveedor_id,proveedor_nombre,total,subtotal,estado,metodo_pago_nombre')
    .eq('auth_user_id', R.userId)
    .neq('estado','anulada')
    .gte('fecha', from).lte('fecha', to)
    .order('fecha', { ascending:false });
  R.cache.compras = data || [];
  return R.cache.compras;
}

async function fetchComprasDetalles() {
  if (!R.cache.compras.length) return [];
  const ids = R.cache.compras.map(c => c.id);
  const { data } = await sb.from('detalle_compras')
    .select('compra_id,producto_id,producto_nombre,cantidad,costo_unitario,subtotal')
    .eq('auth_user_id', R.userId)
    .in('compra_id', ids);
  return data || [];
}

/* ---- GASTOS ---- */
async function fetchGastos() {
  const { from, to } = getDateRange();
  const { data } = await sb.from('gastos')
    .select('id,concepto,categoria,monto,fecha,tipo,estado,empleado')
    .eq('auth_user_id', R.userId)
    .eq('estado','activo')
    .gte('fecha', from).lte('fecha', to)
    .order('fecha', { ascending:false });
  R.cache.gastos = data || [];
  return R.cache.gastos;
}

/* ---- SALARIOS (pagos ya realizados) ----
   Se suman a los gastos operativos para que la ganancia neta refleje
   la nómina, igual que ya pasa con la tabla "gastos". Solo LEE de
   empleados_pagos — el módulo Salarios es quien crea esos registros
   (y su propio egreso en Caja); aquí no se duplica ni se modifica nada. */
async function fetchSalariosPagados() {
  const { from, to } = getDateRange();
  try {
    const { data } = await sb.from('empleados_pagos')
      .select('total_pagado, fecha')
      .eq('auth_user_id', R.userId)
      .gte('fecha', from).lte('fecha', to);
    return (data || []).reduce((s,p) => s+Number(p.total_pagado||0), 0);
  } catch (e) {
    console.warn('fetchSalariosPagados:', e);
    return 0;
  }
}

/* ---- CLIENTES ---- */
async function fetchClientes() {
  const { data } = await sb.from('clientes')
    .select('id,nombre,telefono,correo,empresa,num_compras,total_compras,ultima_compra,primera_compra,estado,created_at')
    .eq('auth_user_id', R.userId)
    .eq('activo', true)
    .order('total_compras', { ascending:false });
  R.cache.clientes = data || [];
  return R.cache.clientes;
}

/* ---- PRODUCTOS ---- */
async function fetchProductos() {
  const { data } = await sb.from('productos')
    .select('id,nombre,sku,tipo,categoria,proveedor_id,proveedor_nombre,precio,costo,stock_actual,stock_minimo,activo')
    .eq('auth_user_id', R.userId)
    .order('nombre');
  R.cache.productos = data || [];
  return R.cache.productos;
}

/**
 * Un producto está en "stock bajo" si:
 *  - tiene stock_minimo definido (no null/undefined) → stock_actual <= stock_minimo
 *  - NO tiene stock_minimo definido → se usa el mismo respaldo que Dashboard: stock_actual < 5
 * (antes, Reportes exigía stock_minimo > 0, así que un producto sin mínimo
 * configurado NUNCA contaba como stock bajo, aunque estuviera en 0 unidades)
 */
function esStockBajo(p) {
  const actual = Number(p.stock_actual || 0);
  return (p.stock_minimo !== null && p.stock_minimo !== undefined)
    ? actual <= Number(p.stock_minimo || 0)
    : actual < 5;
}

/* ---- CAJA (desde movimientos_financieros — misma lógica que caja.js) ---- */
async function fetchCapital() {
  const { data } = await sb.from('movimientos_financieros')
    .select('saldo_resultante')
    .eq('auth_user_id', R.userId)
    .eq('estado','completado')
    .order('created_at', { ascending:false })
    .limit(1)
    .maybeSingle();
  if (data) return Number(data.saldo_resultante);
  // fallback: capital_negocio
  const { data: cap } = await sb.from('capital_negocio')
    .select('monto').eq('auth_user_id', R.userId).eq('is_current',true).maybeSingle();
  return cap ? Number(cap.monto) : 0;
}

/* ---- OTROS INGRESOS / OTROS EGRESOS (Caja) ----
   Misma lógica que caja.js y dashboard.html: movimientos
   registrados manualmente desde Caja ("Nuevo movimiento") que
   NO están ligados a una venta, compra ni gasto (referencia_tipo
   es null). No se recalculan aparte — se leen de la misma
   fuente y con el mismo criterio para que los tres módulos
   siempre muestren el mismo número. */
async function fetchOtrosMovimientos() {
  const { from, to } = getDateRange();
  try {
    const { data } = await sb.from('movimientos_financieros')
      .select('tipo_flujo, monto, referencia_tipo')
      .eq('auth_user_id', R.userId)
      .eq('estado', 'completado')
      .is('referencia_tipo', null)
      .gte('fecha', from).lte('fecha', to);

    const movs = data || [];
    const otrosIngresos = movs.filter(m => m.tipo_flujo === 'INGRESO').reduce((s,m) => s+Number(m.monto||0), 0);
    const otrosEgresos  = movs.filter(m => m.tipo_flujo === 'EGRESO').reduce((s,m) => s+Number(m.monto||0), 0);
    return { otrosIngresos, otrosEgresos };
  } catch(e) {
    console.warn('fetchOtrosMovimientos:', e);
    return { otrosIngresos: 0, otrosEgresos: 0 };
  }
}

/* ---- IVA / IMPUESTOS (desde movimientos_impuestos — misma
   lógica que impuestos.html) ----
   Reportes solo LEE esta tabla, nunca calcula ni escribe IVA
   por su cuenta: el IVA se genera en ventas.js al confirmar una
   venta y se paga desde impuestos.html. Aquí solo se muestra. */
async function fetchImpuestos() {
  try {
    const { data } = await sb.from('movimientos_impuestos')
      .select('tipo_movimiento, monto, fecha, saldo_resultante, created_at')
      .eq('auth_user_id', R.userId)
      .order('created_at', { ascending:false })
      .limit(300);
    return data || [];
  } catch(e) {
    console.warn('fetchImpuestos:', e);
    return [];
  }
}

function calcImpuestosResumen(movs) {
  const { from, to } = getDateRange();
  const saldoActual = movs.length ? Number(movs[0].saldo_resultante) || 0 : 0;
  const generadoPeriodo = movs
    .filter(m => m.tipo_movimiento==='IVA_VENTA' && (m.fecha||'')>=from && (m.fecha||'')<=to)
    .reduce((s,m) => s+Number(m.monto||0), 0);
  const pagadoTotal = movs
    .filter(m => m.tipo_movimiento==='PAGO_IMPUESTO')
    .reduce((s,m) => s+Number(m.monto||0), 0);
  const ultimoPago = movs.find(m => m.tipo_movimiento==='PAGO_IMPUESTO');
  return { saldoActual, generadoPeriodo, pagadoTotal, ultimoPago };
}

/* ---- MOVIMIENTOS (para flujo de caja) ---- */
async function fetchMovimientos() {
  const { from, to } = getDateRange();
  const { data } = await sb.from('movimientos_financieros')
    .select('tipo_flujo,monto,fecha,tipo_movimiento,metodo_pago_nombre')
    .eq('auth_user_id', R.userId)
    .eq('estado','completado')
    .gte('fecha', from).lte('fecha', to)
    .order('fecha');
  R.cache.movimientos = data || [];
  return R.cache.movimientos;
}

/* ---- GASTOS PROGRAMADOS ---- */
async function fetchGastosProgramados() {
  const { data } = await sb.from('gastos_programados')
    .select('id,nombre,categoria,monto,frecuencia,fecha_proxima,activo')
    .eq('auth_user_id', R.userId)
    .eq('activo', true)
    .order('fecha_proxima');
  return data || [];
}

/* ============================================================
   GENERAR DATOS PARA 12 MESES (para gráfica "Comparación
   mensual" — SIEMPRE por mes del año en curso, sin importar
   el período seleccionado arriba. Esto es intencional.)
   ============================================================ */
async function fetchDatosMensuales() {
  const year = new Date().getFullYear();
  const start = `${year}-01-01`;
  const end   = todayISO();

  const [resV, resC, resG] = await Promise.all([
    sb.from('ventas').select('fecha,total,ganancia,impuesto')
      .eq('auth_user_id', R.userId).eq('estado','completada')
      .gte('fecha', start).lte('fecha', end),
    sb.from('compras').select('fecha,total')
      .eq('auth_user_id', R.userId).neq('estado','anulada')
      .gte('fecha', start).lte('fecha', end),
    sb.from('gastos').select('fecha,monto')
      .eq('auth_user_id', R.userId).eq('estado','activo')
      .gte('fecha', start).lte('fecha', end),
  ]);

  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const ventas   = new Array(12).fill(0);
  const compras  = new Array(12).fill(0);
  const gastos   = new Array(12).fill(0);
  const ganancias= new Array(12).fill(0);

  (resV.data||[]).forEach(r => {
    const d = parseFechaSegura(r.fecha);
    if (!d) return;
    const m = d.getMonth();
    // FIX: netear IVA también en la serie mensual (ventas[] alimenta la
    // gráfica "Comparación mensual de ingresos y gastos")
    const totalNeto = Number(r.total) - Number(r.impuesto||0);
    ventas[m]    += totalNeto;
    ganancias[m] += Number(r.ganancia);
  });
  (resC.data||[]).forEach(r => {
    const d = parseFechaSegura(r.fecha);
    if (!d) return;
    const m = d.getMonth();
    compras[m] += Number(r.total);
  });
  (resG.data||[]).forEach(r => {
    const d = parseFechaSegura(r.fecha);
    if (!d) return;
    const m = d.getMonth();
    gastos[m] += Number(r.monto);
  });

  return { meses, ventas, compras, gastos, ganancias };
}

/* ============================================================
   TAB: RESUMEN EJECUTIVO
   FIX: en vez de repetir las mismas tarjetas de KPIs que ya
   aparecen en la pestaña Financiero (y en Ventas/Inventario/
   Clientes), este apartado ahora presenta un análisis narrativo
   (texto) de cómo va el negocio, calculado con los mismos datos
   y fórmulas que usa la pestaña Financiero (mismas fuentes,
   nada se recalcula distinto). Esto no afecta a los reportes
   PDF: la exportación sigue usando R.cache y sus propias
   consultas, independientemente de lo que se muestre aquí.
   ============================================================ */
async function loadEjecutivo() {
  try {
    const [ventas, compras, gastos, clientes, productos, capital, movs, detalles, otros, salariosPagados] = await Promise.all([
      fetchVentas(), fetchCompras(), fetchGastos(), fetchClientes(),
      fetchProductos(), fetchCapital(), fetchMovimientos(), fetchVentasDetalles(),
      fetchOtrosMovimientos(), fetchSalariosPagados(),
    ]);

    const vRes = calcVentasResumen(ventas);
    const totalCompras  = compras.reduce((s,c)  => s+Number(c.total),0);
    const totalGastos   = gastos.reduce((s,g)   => s+Number(g.monto),0) + salariosPagados;
    const otrosIngresos = otros.otrosIngresos;
    const otrosEgresos  = otros.otrosEgresos;
    // Ganancia neta incluye Otros ingresos/egresos de Caja, igual que
    // en la pestaña Financiero y en el Dashboard.
    const gananciaNeta  = vRes.ganancia - totalGastos + otrosIngresos - otrosEgresos;
    const margenBruto   = vRes.total>0 ? ((vRes.ganancia/vRes.total)*100).toFixed(1) : 0;
    const margenNeto    = vRes.total>0 ? ((gananciaNeta/vRes.total)*100).toFixed(1) : 0;

    const prods = (productos||[]).filter(p => p.tipo==='producto');
    const valorInventario = prods.reduce((s,p) => s+(Number(p.stock_actual||0)*Number(p.costo||0)),0);
    const stockBajo = prods.filter(esStockBajo);

    const { from } = getDateRange();
    const clientesNuevos = (clientes||[]).filter(c => c.created_at?.slice(0,10) >= from).length;

    // Unidades vendidas
    const unidsVendidas = detalles.filter(d=>d.tipo_item==='producto').reduce((s,d) => s+Number(d.cantidad),0);

    // Guardar en resumen global (para que dashboard/exportación puedan leer)
    R.cache.resumen = {
      ventas: vRes.total, compras: totalCompras, gastos: totalGastos,
      gananciaBruta: vRes.ganancia, gananciaNeta, capital,
      otrosIngresos, otrosEgresos,
      margenBruto, margenNeto, valorInventario, clientesNuevos,
      ticketPromedio: vRes.ticket, ventasCount: vRes.count,
      stockBajoCount: stockBajo.length, unidsVendidas,
    };

    // HERO
    setEl('eh-ventas',   fmt(vRes.total));
    setEl('eh-gastos',   fmt(totalGastos));
    setEl('eh-ganancia', fmt(gananciaNeta));
    setEl('eh-capital',  fmt(capital));
    setEl('eh-clientes', clientesNuevos.toString());

    // NUEVO: análisis narrativo del negocio (basado en los datos financieros)
    renderAnalisisNegocio({
      ventasTotal: vRes.total, ventasCount: vRes.count, ticket: vRes.ticket,
      gananciaBruta: vRes.ganancia, margenBruto,
      gananciaNeta, margenNeto,
      totalGastos, capital, otrosIngresos, otrosEgresos,
      stockBajoCount: stockBajo.length, clientesNuevos,
      valorInventario,
    });

    // Gráfica: evolución ventas por día
    await renderGraficaEvolucion(ventas);

    // Gráfica: financiero ejecutivo
    await renderGraficaFinancieroExec(movs);

    // Top productos
    await renderTopProductosExec(detalles);

    // Top clientes
    await renderTopClientesExec(clientes);

  } catch(e) { console.error('loadEjecutivo:', e); }
}

/* Genera el texto de análisis del negocio para el Resumen Ejecutivo.
   Usa exactamente los mismos números que ya se calcularon con los
   datos de Financiero (no se recalcula nada aparte). Solo afecta al
   texto mostrado en pantalla — no toca R.cache ni la exportación PDF. */
function renderAnalisisNegocio(d) {
  const el = document.getElementById('analisis-negocio-contenido');
  if (!el) return;

  const parrafos = [];
  const periodo = periodLabel().toLowerCase();

  // ---- Ventas ----
  if (d.ventasCount === 0) {
    parrafos.push(`<p>No se registraron ventas durante <strong>${periodo}</strong>. Podría ser un buen momento para revisar tu estrategia comercial, lanzar una promoción o contactar a clientes frecuentes.</p>`);
  } else {
    parrafos.push(`<p>Durante <strong>${periodo}</strong> tu negocio generó <strong>${fmt(d.ventasTotal)}</strong> en ventas, a través de <strong>${d.ventasCount}</strong> transacción${d.ventasCount!==1?'es':''}, con un ticket promedio de <strong>${fmt(d.ticket)}</strong>.</p>`);
  }

  // ---- Margen y ganancia neta ----
  const margenNum = parseFloat(d.margenNeto);
  let margenTxt, margenColor;
  if (d.ventasCount === 0) {
    margenTxt = null;
  } else if (margenNum >= 30) {
    margenTxt = 'lo cual refleja una salud financiera muy sólida';
    margenColor = 'var(--success)';
  } else if (margenNum >= 15) {
    margenTxt = 'lo cual indica una operación financieramente saludable';
    margenColor = 'var(--success)';
  } else if (margenNum >= 0) {
    margenTxt = 'un margen ajustado — conviene vigilar de cerca los gastos operativos';
    margenColor = 'var(--warning)';
  } else {
    margenTxt = 'el negocio cerró el período con pérdidas: los gastos superaron a los ingresos';
    margenColor = 'var(--danger)';
  }

  if (margenTxt) {
    parrafos.push(`<p>Tu margen neto es de <strong style="color:${margenColor}">${d.margenNeto}%</strong>, ${margenTxt}. La ganancia neta del período es de <strong style="color:${d.gananciaNeta>=0?'var(--success)':'var(--danger)'}">${fmt(d.gananciaNeta)}</strong>, luego de restar <strong>${fmt(d.totalGastos)}</strong> en gastos operativos${d.otrosEgresos>0?` y ${fmt(d.otrosEgresos)} en otros egresos de caja`:''}${d.otrosIngresos>0?`, y sumar ${fmt(d.otrosIngresos)} de otros ingresos de caja`:''}.</p>`);
  }

  // ---- Caja disponible ----
  if (d.capital <= 0) {
    parrafos.push(`<p>⚠️ Tu caja disponible es de <strong style="color:var(--danger)">${fmt(d.capital)}</strong>. Es recomendable actuar pronto para evitar problemas de liquidez.</p>`);
  } else if (d.capital < d.totalGastos) {
    parrafos.push(`<p>Tu caja disponible (<strong>${fmt(d.capital)}</strong>) es menor que tus gastos del período. Vale la pena monitorear de cerca el flujo de efectivo en los próximos días.</p>`);
  } else {
    parrafos.push(`<p>Tu caja disponible es de <strong style="color:var(--accent)">${fmt(d.capital)}</strong>, un nivel saludable frente a los gastos del período.</p>`);
  }

  // ---- Inventario ----
  if (d.stockBajoCount > 0) {
    parrafos.push(`<p>📦 Tienes <strong>${d.stockBajoCount}</strong> producto${d.stockBajoCount!==1?'s':''} con stock bajo. Revisa la pestaña de Inventario para reabastecer a tiempo y no perder ventas.</p>`);
  }

  // ---- Clientes ----
  if (d.clientesNuevos > 0) {
    parrafos.push(`<p>👥 Sumaste <strong>${d.clientesNuevos}</strong> cliente${d.clientesNuevos!==1?'s':''} nuevo${d.clientesNuevos!==1?'s':''} durante este período. Sigue cultivando esas relaciones para convertirlos en clientes frecuentes.</p>`);
  }

  el.innerHTML = parrafos.join('');
}

async function renderGraficaEvolucion(ventas) {
  // Agrupar ventas por día
  const map = {};
  ventas.forEach(v => {
    const d = v.fecha;
    map[d] = (map[d]||0) + Number(v.total);
  });
  const sorted = Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0]));
  const labels = sorted.map(([d]) => fmtFechaCorta(d));
  const data   = sorted.map(([,v]) => v);

  createLineChart('chart-ventas-evolucion', labels,
    [{ label:'Ventas', data, borderColor:'#5a5af4', backgroundColor:'rgba(90,90,244,0.08)', fill:true }],
    'ventas-evolucion');
}

async function renderGraficaFinancieroExec(movs) {
  const mapIng = {}, mapEgr = {};
  movs.forEach(m => {
    const d = m.fecha;
    if (m.tipo_flujo==='INGRESO') mapIng[d] = (mapIng[d]||0)+Number(m.monto);
    else                           mapEgr[d] = (mapEgr[d]||0)+Number(m.monto);
  });
  const allDates = [...new Set([...Object.keys(mapIng),...Object.keys(mapEgr)])].sort();
  const labels   = allDates.map(d => fmtFechaCorta(d));
  const ingresos = allDates.map(d => mapIng[d]||0);
  const egresos  = allDates.map(d => mapEgr[d]||0);
  const ganancia = allDates.map((_,i) => ingresos[i]-egresos[i]);

  createBarChart('chart-financiero-exec', labels, [
    { label:'Ingresos', data:ingresos, backgroundColor:'rgba(90,90,244,0.7)' },
    { label:'Egresos',  data:egresos,  backgroundColor:'rgba(239,68,68,0.6)' },
    { label:'Ganancia', data:ganancia, backgroundColor:'rgba(34,197,94,0.7)' },
  ], 'financiero-exec');
}

async function renderTopProductosExec(detalles) {
  const tbody = document.getElementById('top-productos-exec');
  if (!tbody) return;
  const map = {};
  (detalles||[]).forEach(d => {
    if (!map[d.producto_nombre]) map[d.producto_nombre] = { qty:0, total:0 };
    map[d.producto_nombre].qty   += Number(d.cantidad);
    map[d.producto_nombre].total += Number(d.subtotal);
  });
  const sorted = Object.entries(map).sort((a,b)=>b[1].total-a[1].total).slice(0,5);
  if (!sorted.length) { tbody.innerHTML = emptyRow(4,'Sin datos en este período'); return; }
  tbody.innerHTML = sorted.map(([name,v],i) => `
    <tr>
      <td class="td-rank">${rankIcon(i)}</td>
      <td style="font-weight:500">${esc(name)}</td>
      <td class="td-right td-mono">${fmtNum(v.qty)}</td>
      <td class="td-right td-mono" style="color:var(--accent)">${fmt(v.total)}</td>
    </tr>`).join('');
}

async function renderTopClientesExec(clientes) {
  const tbody = document.getElementById('top-clientes-exec');
  if (!tbody) return;
  const top = (clientes||[]).filter(c=>Number(c.num_compras)>0)
    .sort((a,b)=>Number(b.total_compras)-Number(a.total_compras)).slice(0,5);
  if (!top.length) { tbody.innerHTML = emptyRow(4,'Sin clientes con compras'); return; }
  tbody.innerHTML = top.map((c,i) => `
    <tr>
      <td class="td-rank">${rankIcon(i)}</td>
      <td style="font-weight:500">${esc(c.nombre)}</td>
      <td class="td-right td-mono">${c.num_compras}</td>
      <td class="td-right td-mono" style="color:var(--accent)">${fmt(c.total_compras)}</td>
    </tr>`).join('');
}

/* ============================================================
   TAB: FINANCIERO
   FIX: Otros ingresos/egresos incluidos en ganancia neta y en
   la grilla financiera; nueva sección de IVA/Impuestos que solo
   LEE de movimientos_impuestos (misma tabla que impuestos.html).
   ============================================================ */
async function loadFinanciero() {
  try {
    const [ventas, compras, gastos, capital, productos, movs, mensual, otros, impMovs, salariosPagados] = await Promise.all([
      fetchVentas(), fetchCompras(), fetchGastos(), fetchCapital(),
      fetchProductos(), fetchMovimientos(), fetchDatosMensuales(),
      fetchOtrosMovimientos(), fetchImpuestos(), fetchSalariosPagados(),
    ]);

    const vRes = calcVentasResumen(ventas);
    const totalCompras = compras.reduce((s,c)=>s+Number(c.total),0);
    const totalGastos  = gastos.reduce((s,g)=>s+Number(g.monto),0) + salariosPagados;
    const otrosIngresos = otros.otrosIngresos;
    const otrosEgresos  = otros.otrosEgresos;
    const gananciaNeta = vRes.ganancia - totalGastos + otrosIngresos - otrosEgresos;
    const margenBruto  = vRes.total>0 ? ((vRes.ganancia/vRes.total)*100).toFixed(1) : 0;
    const margenNeto   = vRes.total>0 ? ((gananciaNeta/vRes.total)*100).toFixed(1) : 0;
    const valorInv     = (productos||[]).filter(p=>p.tipo==='producto')
      .reduce((s,p)=>s+(Number(p.stock_actual||0)*Number(p.costo||0)),0);

    // Tabla financiera
    setEl('fin-ingresos',       fmt(vRes.total));
    setEl('fin-costo-ventas',   fmt(vRes.costo));
    setEl('fin-ganancia-bruta', fmt(vRes.ganancia));
    setEl('fin-margen-bruto',   `${margenBruto}% margen bruto`);
    setEl('fin-compras',        fmt(totalCompras));
    setEl('fin-gastos',         fmt(totalGastos));
    setEl('fin-ganancia-neta',  fmt(gananciaNeta));
    setEl('fin-margen-neto',    `${margenNeto}% margen neto`);
    setEl('fin-capital',        fmt(capital));
    setEl('fin-inventario',     fmt(valorInv));
    // Otros ingresos / egresos en la grilla financiera
    setEl('fin-otros-ingresos', fmt(otrosIngresos));
    setEl('fin-otros-egresos',  fmt(otrosEgresos));

    const gnEl = document.getElementById('fin-ganancia-neta');
    if (gnEl) gnEl.style.color = gananciaNeta>=0 ? 'var(--success)' : 'var(--danger)';

    // ── Sección IVA / Impuestos (solo lectura) ──
    const iva = calcImpuestosResumen(impMovs);
    setEl('fin-iva-saldo',    fmt(iva.saldoActual));
    setEl('fin-iva-generado', fmt(iva.generadoPeriodo));
    setEl('fin-iva-pagado',   fmt(iva.pagadoTotal));
    setEl('fin-iva-ultimo',   iva.ultimoPago ? fmtFecha(iva.ultimoPago.created_at || iva.ultimoPago.fecha) : 'Sin pagos aún');
    // ─────────────────────────────────────────────────

    // Gráfica comparación mensual — SIEMPRE por mes del año en curso,
    // independiente del período seleccionado arriba (comportamiento
    // intencional, no cambia con día/semana/año).
    createBarChart('chart-comparacion-mensual', mensual.meses, [
      { label:'Ingresos', data:mensual.ventas,   backgroundColor:'rgba(90,90,244,0.7)' },
      { label:'Compras',  data:mensual.compras,  backgroundColor:'rgba(249,115,22,0.6)' },
      { label:'Gastos',   data:mensual.gastos,   backgroundColor:'rgba(239,68,68,0.6)' },
    ], 'comparacion-mensual');

    // FIX: Gráfica "Evolución de ganancia neta"
    // Antes usaba siempre 12 meses fijos del año en curso (no
    // respetaba el filtro de período) y el cálculo, al depender de
    // un arreglo de ganancias que en la práctica quedaba en 0,
    // terminaba mostrando visualmente la curva de gastos invertida.
    // Ahora se calcula la verdadera ganancia neta día por día
    // (ganancia bruta de ventas − gastos) usando los datos YA
    // filtrados por el período seleccionado (día/semana/mes/año/
    // personalizado), igual que el resto de gráficas de esta pestaña.
    renderGraficaGananciaNeta(ventas, gastos);

    // Gráfica métodos de pago
    const metodosMap = {};
    ventas.forEach(v => {
      const m = v.metodo_pago_nombre || 'Efectivo';
      metodosMap[m] = (metodosMap[m]||0) + Number(v.total);
    });
    const mLabels = Object.keys(metodosMap);
    const mValues = Object.values(metodosMap);
    if (mLabels.length) {
      createDoughnutChart('chart-metodos-pago', mLabels, mValues, 'metodos-pago');
      renderDonutLegend('metodos-pago-legend', mLabels, mValues, mValues.reduce((a,b)=>a+b,0));
    }

    // Gráfica flujo de caja
    const flujoDias = {};
    movs.forEach(m => {
      flujoDias[m.fecha] = flujoDias[m.fecha] || { ing:0, egr:0 };
      if (m.tipo_flujo==='INGRESO') flujoDias[m.fecha].ing += Number(m.monto);
      else                           flujoDias[m.fecha].egr += Number(m.monto);
    });
    const fKeys = Object.keys(flujoDias).sort();
    createBarChart('chart-flujo-caja', fKeys.map(d=>fmtFechaCorta(d)), [
      { label:'Ingresos', data:fKeys.map(d=>flujoDias[d].ing), backgroundColor:'rgba(34,197,94,0.7)' },
      { label:'Egresos',  data:fKeys.map(d=>flujoDias[d].egr), backgroundColor:'rgba(239,68,68,0.6)' },
    ], 'flujo-caja');

  } catch(e) { console.error('loadFinanciero:', e); }
}

/* Verdadera ganancia neta por día, dentro del período seleccionado */
function renderGraficaGananciaNeta(ventas, gastos) {
  const mapGan = {}, mapGas = {};
  (ventas||[]).forEach(v => {
    // FIX: ganancia por venta neta de IVA (total - impuesto - costo),
    // no el campo "ganancia" guardado (podía desincuadrar).
    const netoDia = (Number(v.total) - Number(v.impuesto||0)) - Number(v.costo_total||0);
    mapGan[v.fecha] = (mapGan[v.fecha]||0) + netoDia;
  });
  (gastos||[]).forEach(g => { mapGas[g.fecha] = (mapGas[g.fecha]||0) + Number(g.monto); });

  const allDates = [...new Set([...Object.keys(mapGan), ...Object.keys(mapGas)])].sort();
  const labels = allDates.map(d => fmtFechaCorta(d));
  const data   = allDates.map(d => (mapGan[d]||0) - (mapGas[d]||0));

  createLineChart('chart-ganancia-evolucion', labels,
    [{ label:'Ganancia neta', data, borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,0.08)', fill:true }],
    'ganancia-evolucion');
}

/* ============================================================
   TAB: VENTAS
   ============================================================ */
async function loadVentasTab() {
  try {
    const [ventas, detalles] = await Promise.all([fetchVentas(), fetchVentasDetalles()]);
    const vRes = calcVentasResumen(ventas);

    const unidades = detalles.filter(d=>d.tipo_item==='producto').reduce((s,d)=>s+Number(d.cantidad),0);

    setEl('v-monto',    fmt(vRes.total));
    setEl('v-count',    `${vRes.count} venta${vRes.count!==1?'s':''}`);
    setEl('v-ticket',   fmt(vRes.ticket));
    setEl('v-mayor',    fmt(vRes.mayor?.total||0));
    setEl('v-unidades', fmtNum(unidades));

    // Gráfica por día
    const mapDia = {};
    ventas.forEach(v => { mapDia[v.fecha] = (mapDia[v.fecha]||0)+Number(v.total); });
    const dias   = Object.entries(mapDia).sort((a,b)=>a[0].localeCompare(b[0]));
    createLineChart('chart-ventas-dia', dias.map(([d])=>fmtFechaCorta(d)),
      [{ label:'Ventas diarias', data:dias.map(([,v])=>v),
        borderColor:'#5a5af4', backgroundColor:'rgba(90,90,244,0.08)', fill:true }],
      'ventas-dia');

    // Top productos
    const prodMap = {};
    detalles.forEach(d => {
      if (!prodMap[d.producto_nombre]) prodMap[d.producto_nombre] = { qty:0, total:0 };
      prodMap[d.producto_nombre].qty   += Number(d.cantidad);
      prodMap[d.producto_nombre].total += Number(d.subtotal);
    });
    const topProds = Object.entries(prodMap).sort((a,b)=>b[1].total-a[1].total).slice(0,10);
    const tbody = document.getElementById('top-productos-ventas');
    if (tbody) {
      tbody.innerHTML = topProds.length
        ? topProds.map(([name,v],i) => `
          <tr><td class="td-rank">${rankIcon(i)}</td>
          <td style="font-weight:500;font-size:12.5px">${esc(name)}</td>
          <td class="td-right td-mono">${fmtNum(v.qty)}</td>
          <td class="td-right td-mono" style="color:var(--accent)">${fmt(v.total)}</td></tr>`).join('')
        : emptyRow(4,'Sin detalles de venta');
    }

    // Categorías
    const catEl = document.getElementById('categorias-ventas-list');
    if (catEl) {
      // Obtener categorías desde productos vendidos
      const catMap = {};
      detalles.forEach(d => {
        const prod = (R.cache.productos||[]).find(p=>p.id===d.producto_id);
        const cat  = prod?.categoria || 'Sin categoría';
        catMap[cat] = (catMap[cat]||0) + Number(d.subtotal);
      });
      const catTotal = Object.values(catMap).reduce((a,b)=>a+b,0);
      const catSorted = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
      catEl.innerHTML = catSorted.length ? catSorted.map(([cat,val],i) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:12.5px;font-weight:600;color:var(--text-primary)">${esc(cat)}</span>
            <span style="font-size:12.5px;font-weight:700;font-family:var(--font-mono)">${fmt(val)}</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width:${catTotal>0?(val/catTotal*100).toFixed(0):0}%;background:${CHART_COLORS[i%10]}"></div>
            </div>
            <span class="progress-label">${catTotal>0?((val/catTotal)*100).toFixed(0):0}%</span>
          </div>
        </div>`).join('')
        : '<p style="color:var(--text-muted);font-size:13px">Sin datos</p>';
    }

    // Marcas / Proveedores (opcional — solo aparece si hay productos con marca asignada)
    const marcaEl = document.getElementById('marcas-ventas-list');
    if (marcaEl) {
      const marcaMap = {};
      detalles.forEach(d => {
        const prod  = (R.cache.productos||[]).find(p=>p.id===d.producto_id);
        if (!prod?.proveedor_nombre) return; // sin marca asignada: no se cuenta como grupo
        const marca = prod.proveedor_nombre;
        marcaMap[marca] = (marcaMap[marca]||0) + Number(d.subtotal);
      });
      const marcaEntries = Object.entries(marcaMap);
      const wrap = document.getElementById('marcas-ventas-wrap');
      if (!marcaEntries.length) {
        // No hay marcas configuradas todavía: ocultar el panel en vez de mostrarlo vacío
        if (wrap) wrap.style.display = 'none';
      } else {
        if (wrap) wrap.style.display = '';
        const marcaTotal  = marcaEntries.reduce((a,[,v])=>a+v,0);
        const marcaSorted = marcaEntries.sort((a,b)=>b[1]-a[1]);
        marcaEl.innerHTML = marcaSorted.map(([marca,val],i) => `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:12.5px;font-weight:600;color:var(--text-primary)">🏷️ ${esc(marca)}</span>
              <span style="font-size:12.5px;font-weight:700;font-family:var(--font-mono)">${fmt(val)}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar">
                <div class="progress-bar-fill" style="width:${marcaTotal>0?(val/marcaTotal*100).toFixed(0):0}%;background:${CHART_COLORS[i%10]}"></div>
              </div>
              <span class="progress-label">${marcaTotal>0?((val/marcaTotal)*100).toFixed(0):0}%</span>
            </div>
          </div>`).join('');
      }
    }

    // Métodos de pago
    const metEl = document.getElementById('metodos-ventas-list');
    if (metEl) {
      const metMap = {};
      ventas.forEach(v => {
        const m = v.metodo_pago_nombre || 'Efectivo';
        metMap[m] = (metMap[m]||0) + Number(v.total);
      });
      const metTotal = Object.values(metMap).reduce((a,b)=>a+b,0);
      const metSorted = Object.entries(metMap).sort((a,b)=>b[1]-a[1]);
      metEl.innerHTML = metSorted.length ? metSorted.map(([met,val],i) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:12.5px;font-weight:600;color:var(--text-primary)">${esc(met)}</span>
            <span style="font-size:12.5px;font-weight:700;font-family:var(--font-mono)">${fmt(val)}</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width:${metTotal>0?(val/metTotal*100).toFixed(0):0}%;background:${CHART_COLORS[(i+3)%10]}"></div>
            </div>
            <span class="progress-label">${metTotal>0?((val/metTotal)*100).toFixed(0):0}%</span>
          </div>
        </div>`).join('')
        : '<p style="color:var(--text-muted);font-size:13px">Sin datos</p>';
    }

  } catch(e) { console.error('loadVentasTab:', e); }
}

/* ============================================================
   TAB: COMPRAS
   ============================================================ */
async function loadComprasTab() {
  try {
    const [compras, detalles] = await Promise.all([fetchCompras(), fetchComprasDetalles()]);
    const totalInv = compras.reduce((s,c)=>s+Number(c.total),0);
    const count    = compras.length;
    const promedio = count>0 ? totalInv/count : 0;
    const unidades = detalles.reduce((s,d)=>s+Number(d.cantidad),0);

    // Proveedor principal
    const provMap = {};
    compras.forEach(c => {
      const prov = c.proveedor_nombre || 'Sin proveedor';
      provMap[prov] = (provMap[prov]||0) + Number(c.total);
    });
    const provSorted = Object.entries(provMap).sort((a,b)=>b[1]-a[1]);
    const provPrincipal = provSorted[0] || ['—', 0];

    setEl('c-monto',         fmt(totalInv));
    setEl('c-count',         `${count} compra${count!==1?'s':''}`);
    setEl('c-promedio',      fmt(promedio));
    setEl('c-proveedor',     provPrincipal[0]);
    setEl('c-proveedor-monto', fmt(provPrincipal[1]));
    setEl('c-unidades',      fmtNum(unidades));

    // Gráfica compras por mes (últimos 12 meses)
    const mensual = await fetchDatosMensuales();
    createBarChart('chart-compras-mes', mensual.meses,
      [{ label:'Compras', data:mensual.compras, backgroundColor:'rgba(249,115,22,0.7)' }],
      'compras-mes');

    // Gráfica por proveedor
    if (provSorted.length) {
      const top6prov = provSorted.slice(0,6);
      createDoughnutChart('chart-compras-proveedor', top6prov.map(([l])=>l), top6prov.map(([,v])=>v), 'compras-proveedor');
      const provTotal = top6prov.reduce((s,[,v])=>s+v,0);
      renderDonutLegend('proveedores-legend', top6prov.map(([l])=>l), top6prov.map(([,v])=>v), provTotal);
    }

    // Compras recientes
    const tbody = document.getElementById('compras-recientes-tbody');
    if (tbody) {
      tbody.innerHTML = compras.slice(0,10).map(c => `
        <tr>
          <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--accent);font-weight:700">${esc(c.numero)}</span></td>
          <td class="td-muted">${fmtFecha(c.fecha)}</td>
          <td style="font-weight:500">${esc(c.proveedor_nombre||'—')}</td>
          <td class="td-right td-mono" style="color:var(--accent-3)">${fmt(c.total)}</td>
          <td><span class="badge badge-success">Completada</span></td>
        </tr>`).join('') || emptyRow(5,'Sin compras en este período');
    }

  } catch(e) { console.error('loadComprasTab:', e); }
}

/* ============================================================
   TAB: INVENTARIO
   ============================================================ */
async function loadInventario() {
  try {
    const [productos, detalles] = await Promise.all([fetchProductos(), fetchVentasDetalles()]);
    const prods    = (productos||[]).filter(p=>p.tipo==='producto');
    const servicios= (productos||[]).filter(p=>p.tipo==='servicio');
    const activos  = prods.filter(p=>p.activo);
    const valorInv = activos.reduce((s,p)=>s+(Number(p.stock_actual||0)*Number(p.costo||0)),0);
    const stockBajo= activos.filter(esStockBajo);

    // Productos sin movimiento (sin ventas en este período)
    const prodsConVentas = new Set((detalles||[]).map(d=>d.producto_id));
    const sinMovimiento  = activos.filter(p=>!prodsConVentas.has(p.id));

    setEl('inv-valor',   fmt(valorInv));
    setEl('inv-total',   activos.length.toString());
    setEl('inv-servicios', `${servicios.length} servicios`);
    // "Stock bajo" en 0 es algo BUENO (nada requiere atención), pero un "0"
    // solo puede leerse como "tu stock está en cero" — se aclara con texto
    // y color en vez de dejar solo el número.
    const bajoEl    = document.getElementById('inv-bajo');
    const bajoSubEl = document.getElementById('inv-bajo-sub');
    const bajoIconWrap = document.getElementById('inv-bajo-icon-wrap');
    if (bajoEl) {
      if (stockBajo.length === 0) {
        bajoEl.textContent = '✅';
        bajoEl.style.color = 'var(--success)';
        if (bajoSubEl) bajoSubEl.textContent = 'Todo en orden, ningún producto bajo';
        if (bajoIconWrap) {
          bajoIconWrap.style.background = 'var(--success-soft)';
          const svgStroke = bajoIconWrap.querySelector('svg');
          if (svgStroke) svgStroke.setAttribute('stroke', 'var(--success)');
        }
      } else {
        bajoEl.textContent = stockBajo.length.toString();
        bajoEl.style.color = 'var(--danger)';
        if (bajoSubEl) bajoSubEl.textContent = 'requieren atención';
        if (bajoIconWrap) {
          bajoIconWrap.style.background = 'var(--danger-soft)';
          const svgStroke = bajoIconWrap.querySelector('svg');
          if (svgStroke) svgStroke.setAttribute('stroke', 'var(--danger)');
        }
      }
    }
    setEl('inv-sin-mov', sinMovimiento.length.toString());

    // Mayor valor en inventario
    const tbodyValor = document.getElementById('inv-mayor-valor');
    if (tbodyValor) {
      const top = activos.filter(p=>Number(p.stock_actual)>0)
        .map(p=>({...p, valor:Number(p.stock_actual||0)*Number(p.costo||0)}))
        .sort((a,b)=>b.valor-a.valor).slice(0,8);
      tbodyValor.innerHTML = top.length ? top.map((p,i) => `
        <tr>
          <td class="td-rank">${rankIcon(i)}</td>
          <td style="font-weight:500">${esc(p.nombre)}</td>
          <td class="td-right td-mono">${fmtNum(p.stock_actual)}</td>
          <td class="td-right td-mono" style="color:var(--accent)">${fmt(p.valor)}</td>
        </tr>`).join('') : emptyRow(4,'Sin productos con stock');
    }

    // Stock bajo
    const tbodyBajo = document.getElementById('inv-stock-bajo');
    if (tbodyBajo) {
      tbodyBajo.innerHTML = stockBajo.length ? stockBajo.slice(0,10).map(p => {
        const pct = Number(p.stock_minimo)>0 ? ((Number(p.stock_actual)/Number(p.stock_minimo))*100).toFixed(0) : 0;
        const badgeCls = Number(p.stock_actual)===0 ? 'badge-danger' : 'badge-warning';
        const badgeTxt = Number(p.stock_actual)===0 ? 'Sin stock' : 'Stock bajo';
        return `<tr>
          <td style="font-weight:500">${esc(p.nombre)}</td>
          <td class="td-right td-mono" style="color:var(--danger)">${fmtNum(p.stock_actual)}</td>
          <td class="td-right td-mono">${fmtNum(p.stock_minimo)}</td>
          <td><span class="badge ${badgeCls}">${badgeTxt}</span></td>
        </tr>`;
      }).join('') : emptyRow(4,'Sin productos con stock bajo ✅');
    }

    // Filtro secundario "Marca / Proveedor" — solo se muestra si hay marcas configuradas
    const marcasUnicas = [...new Map(
      activos.filter(p=>p.proveedor_id).map(p=>[p.proveedor_id, p.proveedor_nombre])
    ).entries()];
    const filtroMarcaWrap = document.getElementById('inv-filtro-marca-wrap');
    const filtroMarcaSel  = document.getElementById('inv-filtro-marca');
    if (filtroMarcaWrap && filtroMarcaSel) {
      if (!marcasUnicas.length) {
        filtroMarcaWrap.style.display = 'none';
      } else {
        filtroMarcaWrap.style.display = '';
        if (!filtroMarcaSel.dataset.bound) {
          filtroMarcaSel.innerHTML = '<option value="">Todas las marcas</option>' +
            marcasUnicas.map(([id,nombre]) => `<option value="${id}">${esc(nombre)}</option>`).join('');
          filtroMarcaSel.addEventListener('change', () => renderInventarioTablaCompleta(activos, filtroMarcaSel.value));
          filtroMarcaSel.dataset.bound = '1';
        }
      }
    }

    // Valor de inventario por marca / proveedor (panel opcional)
    const marcaValorEl  = document.getElementById('inv-marcas-list');
    const marcaValorWrap = document.getElementById('inv-marcas-wrap');
    if (marcaValorEl && marcaValorWrap) {
      const marcaMap = {};
      activos.forEach(p => {
        if (!p.proveedor_nombre) return;
        marcaMap[p.proveedor_nombre] = (marcaMap[p.proveedor_nombre]||0) + (Number(p.stock_actual||0)*Number(p.costo||0));
      });
      const entries = Object.entries(marcaMap);
      if (!entries.length) {
        marcaValorWrap.style.display = 'none';
      } else {
        marcaValorWrap.style.display = '';
        const total  = entries.reduce((a,[,v])=>a+v,0);
        const sorted = entries.sort((a,b)=>b[1]-a[1]);
        marcaValorEl.innerHTML = sorted.map(([marca,val],i) => `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:12.5px;font-weight:600;color:var(--text-primary)">🏷️ ${esc(marca)}</span>
              <span style="font-size:12.5px;font-weight:700;font-family:var(--font-mono)">${fmt(val)}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar">
                <div class="progress-bar-fill" style="width:${total>0?(val/total*100).toFixed(0):0}%;background:${CHART_COLORS[i%10]}"></div>
              </div>
              <span class="progress-label">${total>0?((val/total)*100).toFixed(0):0}%</span>
            </div>
          </div>`).join('');
      }
    }

    // Tabla completa
    renderInventarioTablaCompleta(activos, '');

  } catch(e) { console.error('loadInventario:', e); }
}

// Tabla completa de inventario — separada para poder re-renderizar al
// cambiar el filtro secundario de Marca/Proveedor sin duplicar lógica.
function renderInventarioTablaCompleta(activos, filtroProveedorId) {
  const tbodyFull = document.getElementById('inv-tabla-completa');
  if (!tbodyFull) return;
  const lista = filtroProveedorId
    ? activos.filter(p => p.proveedor_id === filtroProveedorId)
    : activos;
  const sorted = [...lista].sort((a,b)=>a.nombre.localeCompare(b.nombre));
  tbodyFull.innerHTML = sorted.length ? sorted.map(p => {
    const precio = Number(p.precio||0), costo = Number(p.costo||0);
    const margen = precio>0 ? ((precio-costo)/precio*100).toFixed(1) : 0;
    const margenCls = margen>=40?'style="color:var(--success);font-weight:700"' : margen>=20?'style="color:var(--warning);font-weight:700"' : 'style="color:var(--danger);font-weight:700"';
    const valor = Number(p.stock_actual||0)*costo;
    return `<tr>
      <td style="font-weight:500">${esc(p.nombre)}</td>
      <td class="td-muted" style="font-family:var(--font-mono);font-size:12px">${esc(p.sku||'—')}</td>
      <td class="td-muted">
        ${esc(p.categoria||'—')}
        ${p.proveedor_nombre ? `<div style="font-size:11px;color:var(--text-muted)">🏷️ ${esc(p.proveedor_nombre)}</div>` : ''}
      </td>
      <td class="td-right td-mono">${fmtNum(p.stock_actual)}</td>
      <td class="td-right td-mono">${fmt(costo)}</td>
      <td class="td-right td-mono">${fmt(precio)}</td>
      <td class="td-right" ${margenCls}>${margen}%</td>
      <td class="td-right td-mono" style="color:var(--accent)">${fmt(valor)}</td>
    </tr>`;
  }).join('') : emptyRow(8,'Sin productos registrados');
}

/* ============================================================
   TAB: CLIENTES
   ============================================================ */
async function loadClientesTab() {
  try {
    const [clientes] = await Promise.all([fetchClientes()]);
    const { from } = getDateRange();
    const hace60   = ymd(new Date(Date.now()-60*86400000));

    const nuevos    = (clientes||[]).filter(c=>c.created_at?.slice(0,10)>=from).length;
    const activos   = (clientes||[]).filter(c=>c.ultima_compra && c.ultima_compra>=hace60).length;
    const frecuentes= (clientes||[]).filter(c=>Number(c.num_compras)>=5).length;
    const inactivos = (clientes||[]).filter(c=>c.ultima_compra && c.ultima_compra<hace60).length;

    setEl('cli-nuevos',     nuevos.toString());
    setEl('cli-activos',    activos.toString());
    setEl('cli-frecuentes', frecuentes.toString());
    setEl('cli-inactivos',  inactivos.toString());

    // Top por facturación
    const topFac = (clientes||[]).filter(c=>Number(c.num_compras)>0)
      .sort((a,b)=>Number(b.total_compras)-Number(a.total_compras)).slice(0,10);
    const tbodyFac = document.getElementById('top-clientes-tabla');
    if (tbodyFac) {
      tbodyFac.innerHTML = topFac.length ? topFac.map((c,i) => `
        <tr>
          <td class="td-rank">${rankIcon(i)}</td>
          <td style="font-weight:500">${esc(c.nombre)}</td>
          <td class="td-right td-mono">${c.num_compras}</td>
          <td class="td-right td-mono" style="color:var(--accent)">${fmt(c.total_compras)}</td>
          <td class="td-muted">${fmtFecha(c.ultima_compra)}</td>
        </tr>`).join('') : emptyRow(5,'Sin clientes con compras registradas');
    }

    // Top por frecuencia
    const topFrec = (clientes||[]).filter(c=>Number(c.num_compras)>0)
      .sort((a,b)=>Number(b.num_compras)-Number(a.num_compras)).slice(0,10);
    const tbodyFrec = document.getElementById('top-clientes-frecuencia');
    if (tbodyFrec) {
      tbodyFrec.innerHTML = topFrec.length ? topFrec.map((c,i) => `
        <tr>
          <td class="td-rank">${rankIcon(i)}</td>
          <td style="font-weight:500">${esc(c.nombre)}</td>
          <td class="td-right td-mono" style="color:var(--accent-4)">${c.num_compras}</td>
          <td class="td-right td-mono">${fmt(c.total_compras)}</td>
        </tr>`).join('') : emptyRow(4,'Sin datos');
    }

  } catch(e) { console.error('loadClientesTab:', e); }
}

/* ============================================================
   TAB: CRÉDITOS
   - "Monto producto/capital": lo que vale el producto/servicio (venta)
     o el capital financiado (préstamo), SIN intereses ni impuestos.
   - "Total con impuestos e intereses": suma de todas las cuotas del
     crédito (capital + interés + impuesto de cada cuota).
   - "Ganancia estimada": solo el interés generado, menos el impuesto
     que se cobró sobre ese interés (nunca incluye el valor del
     producto ni los impuestos sobre el capital).
   ============================================================ */
async function fetchCreditosReporte() {
  const { data: creditos } = await sb.from('creditos').select('*')
    .eq('auth_user_id', R.userId)
    .gte('fecha_inicio', R.fechaDesde || '1970-01-01')
    .lte('fecha_inicio', R.fechaHasta || todayISO());

  const lista = creditos || [];
  if (!lista.length) return [];

  const ids = lista.map(c => c.id);
  const { data: cuotas } = await sb.from('creditos_cuotas')
    .select('credito_id,monto_total,impuesto')
    .in('credito_id', ids);

  const clienteIds = [...new Set(lista.map(c => c.cliente_id))];
  const { data: clientesData } = await sb.from('clientes').select('id,nombre,apellido')
    .in('id', clienteIds.length ? clienteIds : ['00000000-0000-0000-0000-000000000000']);
  const clienteMap = new Map((clientesData||[]).map(c => [c.id, c]));

  const sumaPorCredito = new Map(); // credito_id -> { totalCuotas, totalImpuesto }
  (cuotas||[]).forEach(c => {
    const acc = sumaPorCredito.get(c.credito_id) || { totalCuotas: 0, totalImpuesto: 0 };
    acc.totalCuotas += Number(c.monto_total||0);
    acc.totalImpuesto += Number(c.impuesto||0);
    sumaPorCredito.set(c.credito_id, acc);
  });

  return lista.map(c => {
    const sum = sumaPorCredito.get(c.id) || { totalCuotas: Number(c.total_financiado||0), totalImpuesto: 0 };
    const cliente = clienteMap.get(c.cliente_id);
    // El impuesto de un crédito por venta se cobra sobre el capital (no es parte de la
    // ganancia por interés); el de un crédito financiero se cobra sobre el interés.
    const impuestoSobreInteres = c.tipo === 'financiero' ? sum.totalImpuesto : 0;
    const gananciaEstimada = Math.max(0, Number(c.total_intereses||0) - impuestoSobreInteres);
    return {
      id: c.id,
      numero_credito: c.numero_credito,
      cliente: cliente ? `${cliente.nombre} ${cliente.apellido||''}`.trim() : '—',
      tipo: c.tipo,
      fecha_inicio: c.fecha_inicio,
      montoProducto: Number(c.capital_financiado||0),
      totalCuotas: sum.totalCuotas,
      gananciaEstimada,
      estado: c.estado,
    };
  });
}

/* ------------------------------------------------------------
   HISTORIAL DE PAGOS — una fila por cuota, con datos del cliente.
   Solo incluye créditos del cliente (nunca clientes sin crédito).
   Cubre tanto cuotas ya pagadas como las que faltan (pendiente,
   vencida, parcial), que es justo el "historial de pagos" que se
   muestra en pantalla y se usa para exportar (individual y en el
   Reporte General).
   ------------------------------------------------------------ */
async function fetchCreditosHistorialPagos() {
  const { data: creditos } = await sb.from('creditos').select('id,numero_credito,tipo,cliente_id,num_cuotas')
    .eq('auth_user_id', R.userId)
    .gte('fecha_inicio', R.fechaDesde || '1970-01-01')
    .lte('fecha_inicio', R.fechaHasta || todayISO());

  const lista = creditos || [];
  if (!lista.length) return [];

  const creditoMap = new Map(lista.map(c => [c.id, c]));
  const ids = lista.map(c => c.id);

  const { data: cuotas } = await sb.from('creditos_cuotas')
    .select('credito_id,numero,fecha_vencimiento,monto_total,monto_pagado,saldo,estado,updated_at')
    .in('credito_id', ids)
    .order('numero');

  const clienteIds = [...new Set(lista.map(c => c.cliente_id))];
  const { data: clientesData } = await sb.from('clientes').select('id,nombre,apellido,telefono,correo')
    .in('id', clienteIds.length ? clienteIds : ['00000000-0000-0000-0000-000000000000']);
  const clienteMap = new Map((clientesData||[]).map(c => [c.id, c]));

  return (cuotas||[]).map(cu => {
    const credito = creditoMap.get(cu.credito_id) || {};
    const cliente  = clienteMap.get(credito.cliente_id);
    return {
      cliente_id:     credito.cliente_id || null,
      cliente:        cliente ? `${cliente.nombre} ${cliente.apellido||''}`.trim() : '—',
      telefono:       cliente?.telefono || '—',
      email:          cliente?.correo || '—',
      numero_credito: credito.numero_credito || '—',
      cuota:          `${cu.numero}/${credito.num_cuotas||'?'}`,
      fecha_venc:     cu.fecha_vencimiento,
      monto_cuota:    Number(cu.monto_total||0),
      pagado:         Number(cu.monto_pagado||0),
      saldo:          Number(cu.saldo||0),
      estado:         cu.estado,
      fecha_estado:   cu.updated_at,
    };
  });
}

// Etiqueta legible + clase de badge para el estado de una cuota.
function estadoCuotaInfo(estado) {
  const map = {
    pagada:    { label:'Pagada',        badge:'badge-success' },
    pendiente: { label:'Pendiente',     badge:'badge-neutral' },
    vencida:   { label:'Vencida',       badge:'badge-danger'  },
    parcial:   { label:'Pago parcial',  badge:'badge-warning' },
  };
  return map[estado] || { label: estado || '—', badge:'badge-neutral' };
}

// Etiqueta legible + clase de badge para el estado de una cuota.
function estadoCuotaInfo(estado) {
  const map = {
    pagada:    { label:'Pagada',        badge:'badge-success' },
    pendiente: { label:'Pendiente',     badge:'badge-neutral' },
    vencida:   { label:'Vencida',       badge:'badge-danger'  },
    parcial:   { label:'Pago parcial',  badge:'badge-warning' },
  };
  return map[estado] || { label: estado || '—', badge:'badge-neutral' };
}

/* ------------------------------------------------------------
   SELECTOR DE CLIENTE — el historial de pagos SIEMPRE es de UN
   cliente a la vez, elegido por el usuario con un buscador (para
   no mostrar una lista mezclada de todos los clientes). Se usa
   tanto en la pestaña Créditos (pantalla) como en el modal de
   exportación de Créditos.
   ------------------------------------------------------------ */
function clientesConCredito() {
  const map = new Map();
  (R.cache.creditosPagos||[]).forEach(f => {
    if (f.cliente_id && !map.has(f.cliente_id)) {
      map.set(f.cliente_id, { id: f.cliente_id, nombre: f.cliente, telefono: f.telefono });
    }
  });
  return [...map.values()].sort((a,b) => a.nombre.localeCompare(b.nombre));
}

function filtrarClientesCredito(q) {
  const query = (q||'').trim().toLowerCase();
  const todos = clientesConCredito();
  if (!query) return todos;
  return todos.filter(c => c.nombre.toLowerCase().includes(query));
}

// Pinta la lista desplegable de resultados del buscador (reutilizado por
// la pantalla de Créditos y por el modal de exportación).
function pintarListaClientesCredito(contEl, clientes, onSelect) {
  if (!contEl) return;
  if (!clientes.length) {
    contEl.innerHTML = `<div class="buscador-cliente-vacio">Sin clientes con crédito que coincidan</div>`;
    contEl.classList.add('show');
    return;
  }
  contEl.innerHTML = clientes.map(c => `
    <div class="buscador-cliente-item" data-id="${esc(c.id)}">
      <span>${esc(c.nombre)}</span>
      <span class="buscador-cliente-tel">${esc(c.telefono||'')}</span>
    </div>`).join('');
  contEl.classList.add('show');
  contEl.querySelectorAll('.buscador-cliente-item').forEach(el => {
    el.addEventListener('click', () => {
      const c = clientes.find(x => x.id === el.dataset.id);
      if (c) onSelect(c);
    });
  });
}

/* ---- Uso en pantalla (pestaña Créditos) ---- */
function buscarClienteCredito(q) {
  const cont = document.getElementById('cr-lista-clientes');
  pintarListaClientesCredito(cont, filtrarClientesCredito(q), seleccionarClienteCredito);
}

function seleccionarClienteCredito(c) {
  R.creditoClienteSeleccionado = c.id;
  const buscar = document.getElementById('cr-buscar-cliente');
  const lista  = document.getElementById('cr-lista-clientes');
  const activo = document.getElementById('cr-cliente-activo');
  const nombreEl = document.getElementById('cr-cliente-activo-nombre');
  if (buscar) buscar.value = '';
  if (lista) { lista.classList.remove('show'); lista.innerHTML = ''; }
  if (nombreEl) nombreEl.textContent = c.nombre;
  if (activo) activo.style.display = 'flex';
  const wrap = document.getElementById('cr-buscador-wrap');
  if (wrap) wrap.style.display = 'none';
  renderHistorialPagosCreditos();
}

function limpiarClienteCredito() {
  R.creditoClienteSeleccionado = null;
  const activo = document.getElementById('cr-cliente-activo');
  const wrap   = document.getElementById('cr-buscador-wrap');
  if (activo) activo.style.display = 'none';
  if (wrap) wrap.style.display = '';
  renderHistorialPagosCreditos();
}

// Pinta la tabla de historial SOLO del cliente elegido (nunca de todos a
// la vez). Si aún no se eligió cliente, invita a buscarlo.
function renderHistorialPagosCreditos() {
  const tbody = document.getElementById('creditos-historial-pagos-tbody');
  if (!tbody) return;

  const clienteId = R.creditoClienteSeleccionado;
  if (!clienteId) {
    tbody.innerHTML = emptyRow(7, 'Busca y elige un cliente arriba para ver su historial de pagos');
    return;
  }

  const selEstado    = document.getElementById('cr-filtro-estado');
  const filtroEstado = selEstado ? selEstado.value : '';
  const filas = (R.cache.creditosPagos||[])
    .filter(f => f.cliente_id === clienteId && (!filtroEstado || f.estado === filtroEstado))
    .sort((a,b) => (a.fecha_venc||'').localeCompare(b.fecha_venc||''));

  tbody.innerHTML = filas.length ? filas.map(f => {
    const info = estadoCuotaInfo(f.estado);
    return `
    <tr>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(f.numero_credito)}</span></td>
      <td class="td-mono">${esc(f.cuota)}</td>
      <td>${fmtFecha(f.fecha_venc)}</td>
      <td class="td-mono">${fmt(f.monto_cuota)}</td>
      <td class="td-mono">${fmt(f.pagado)}</td>
      <td class="td-mono">${fmt(f.saldo)}</td>
      <td><span class="badge ${info.badge}">${info.label}</span></td>
    </tr>`;
  }).join('') : emptyRow(7, 'Este cliente no tiene cuotas de crédito en este período');
}

async function loadCreditosTab() {
  const tbody = document.getElementById('creditos-reporte-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Cargando créditos…</td></tr>';

  try {
    const filas = await fetchCreditosReporte();

    // Historial de pagos (cuotas pagadas y faltantes) para la tabla de abajo
    // y para que quede en caché disponible al exportar (individual/general).
    R.cache.creditosPagos = await fetchCreditosHistorialPagos();
    renderHistorialPagosCreditos();

    const capitalTotal   = filas.reduce((s,f)=>s+f.montoProducto, 0);
    const cuotasTotal    = filas.reduce((s,f)=>s+f.totalCuotas, 0);
    const gananciaTotal  = filas.reduce((s,f)=>s+f.gananciaEstimada, 0);
    const activos        = filas.filter(f => ['activo','al_dia','con_atraso','en_proceso'].includes(f.estado)).length;
    const conAtraso      = filas.filter(f => f.estado === 'con_atraso').length;

    setEl('cr-capital',      fmt(capitalTotal));
    setEl('cr-total-cuotas', fmt(cuotasTotal));
    setEl('cr-ganancia',     fmt(gananciaTotal));
    setEl('cr-activos',      activos.toString());
    setEl('cr-atraso',       conAtraso.toString());

    // Ventas a crédito por mes (solo tipo='venta', este año, monto del producto sin intereses/impuestos)
    const year = new Date().getFullYear();
    const { data: creditosAnio } = await sb.from('creditos').select('tipo,capital_financiado,fecha_inicio')
      .eq('auth_user_id', R.userId).eq('tipo','venta')
      .gte('fecha_inicio', `${year}-01-01`).lte('fecha_inicio', `${year}-12-31`);
    const mesesLabel = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const porMes = new Array(12).fill(0);
    (creditosAnio||[]).forEach(c => {
      const d = parseFechaSegura(c.fecha_inicio);
      if (!d) return;
      porMes[d.getMonth()] += Number(c.capital_financiado||0);
    });
    createBarChart('chart-creditos-mes', mesesLabel,
      [{ label:'Ventas a crédito', data:porMes, backgroundColor:'rgba(90,90,244,0.6)' }],
      'creditos-mes');

    if (tbody) {
      tbody.innerHTML = filas.length ? filas
        .sort((a,b) => (b.fecha_inicio||'').localeCompare(a.fecha_inicio||''))
        .map(f => `
        <tr>
          <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(f.numero_credito)}</span></td>
          <td>${esc(f.cliente)}</td>
          <td><span class="badge ${f.tipo==='venta'?'badge-success':'badge-accent'}">${f.tipo==='venta'?'Por venta':'Financiero'}</span></td>
          <td class="td-mono">${fmt(f.montoProducto)}</td>
          <td class="td-mono">${fmt(f.totalCuotas)}</td>
          <td class="td-mono" style="color:var(--success);font-weight:700">${fmt(f.gananciaEstimada)}</td>
          <td>${esc(f.estado)}</td>
        </tr>`).join('') : emptyRow(7,'No hay créditos en este período');
    }
  } catch(e) {
    console.error('loadCreditosTab:', e);
    if (tbody) tbody.innerHTML = emptyRow(7,'No se pudo cargar el reporte de créditos');
    const tbodyHist = document.getElementById('creditos-historial-pagos-tbody');
    if (tbodyHist) tbodyHist.innerHTML = emptyRow(7,'No se pudo cargar el historial de pagos');
  }
}

/* ============================================================
   TAB: GASTOS
   ============================================================ */
async function loadGastosTab() {
  try {
    const [gastos, programados, mensual] = await Promise.all([
      fetchGastos(), fetchGastosProgramados(), fetchDatosMensuales(),
    ]);

    const total    = gastos.reduce((s,g)=>s+Number(g.monto),0);
    const mayor    = gastos.length ? gastos.reduce((m,g)=>Number(g.monto)>Number(m.monto)?g:m) : null;

    // Categoría con mayor gasto
    const catMap = {};
    gastos.forEach(g => { catMap[g.categoria||'Sin categoría'] = (catMap[g.categoria||'Sin categoría']||0)+Number(g.monto); });
    const catSorted = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
    const catMayor  = catSorted[0] || ['—', 0];

    setEl('g-total',       fmt(total));
    setEl('g-count',       `${gastos.length} gasto${gastos.length!==1?'s':''}`);
    setEl('g-mayor',       mayor ? fmt(mayor.monto) : '—');
    setEl('g-mayor-concepto', mayor ? esc(mayor.concepto) : '—');
    setEl('g-cat-mayor',   catMayor[0]);
    setEl('g-cat-monto',   fmt(catMayor[1]));
    setEl('g-recurrentes', programados.length.toString());

    // Donut categorías
    if (catSorted.length) {
      createDoughnutChart('chart-gastos-cat', catSorted.map(([l])=>l), catSorted.map(([,v])=>v), 'gastos-cat');
      renderDonutLegend('gastos-cat-legend', catSorted.map(([l])=>l), catSorted.map(([,v])=>v), total);
    }

    // Barras gastos por mes
    createBarChart('chart-gastos-mes', mensual.meses,
      [{ label:'Gastos', data:mensual.gastos, backgroundColor:'rgba(239,68,68,0.6)' }],
      'gastos-mes');

    // Detalle por categoría
    const detEl = document.getElementById('gastos-cat-detalle');
    if (detEl) {
      detEl.innerHTML = catSorted.length ? catSorted.map(([cat, val], i) => {
        const items = gastos.filter(g=>(g.categoria||'Sin categoría')===cat);
        const pct   = total>0 ? ((val/total)*100).toFixed(0) : 0;
        return `
          <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:12px;height:12px;border-radius:3px;background:${CHART_COLORS[i%10]};flex-shrink:0"></div>
                <span style="font-size:13.5px;font-weight:700;color:var(--text-primary)">${esc(cat)}</span>
                <span class="badge badge-neutral">${items.length} gasto${items.length!==1?'s':''}</span>
              </div>
              <div style="text-align:right">
                <span style="font-size:14px;font-weight:800;font-family:var(--font-mono);color:var(--danger)">${fmt(val)}</span>
                <span style="font-size:11.5px;color:var(--text-muted);margin-left:6px">${pct}%</span>
              </div>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar" style="height:8px">
                <div class="progress-bar-fill" style="width:${pct}%;background:${CHART_COLORS[i%10]}"></div>
              </div>
            </div>
          </div>`;
      }).join('') : '<p style="color:var(--text-muted);text-align:center;padding:20px">Sin gastos en este período</p>';
    }

  } catch(e) { console.error('loadGastosTab:', e); }
}

/* ============================================================
   TAB: ALERTAS
   ============================================================ */
async function loadAlertas() {
  const grid = document.getElementById('alertas-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="section-loading"><div class="mini-spinner"></div><br>Analizando tu negocio…</div>';

  try {
    const [productos, clientes, gastosProg, ventas] = await Promise.all([
      fetchProductos(), fetchClientes(), fetchGastosProgramados(), fetchVentas(),
    ]);

    const alertas = [];
    const today = todayISO();
    const hace60 = ymd(new Date(Date.now()-60*86400000));
    const hace3  = ymd(new Date(Date.now()-3*86400000));

    // STOCK BAJO
    const prods = (productos||[]).filter(p=>p.tipo==='producto'&&p.activo);
    const stockBajo = prods.filter(esStockBajo);
    if (stockBajo.length) {
      alertas.push({
        tipo:'danger', icon:'📦',
        titulo: `${stockBajo.length} producto${stockBajo.length!==1?'s':''} con stock bajo`,
        desc: stockBajo.slice(0,3).map(p=>`${p.nombre} (stock: ${p.stock_actual})`).join(', '),
        tag: '⚠️ Urgente', tagCls:'',
        accion: () => navigate('inventario.html'),
      });
    }

    // SIN STOCK
    const sinStock = prods.filter(p=>Number(p.stock_actual||0)===0 && p.activo);
    if (sinStock.length) {
      alertas.push({
        tipo:'danger', icon:'🚨',
        titulo: `${sinStock.length} producto${sinStock.length!==1?'s':''} sin stock`,
        desc: sinStock.slice(0,3).map(p=>p.nombre).join(', '),
        tag: '🔴 Sin stock', tagCls:'',
        accion: () => navigate('compras.html'),
      });
    }

    // CLIENTES INACTIVOS
    const inactivos = (clientes||[]).filter(c=>c.ultima_compra && c.ultima_compra<hace60 && Number(c.num_compras)>0);
    if (inactivos.length) {
      alertas.push({
        tipo:'warning', icon:'😴',
        titulo: `${inactivos.length} cliente${inactivos.length!==1?'s':''} inactivo${inactivos.length!==1?'s':''}`,
        desc: `Sin comprar en los últimos 60 días. Últ: ${fmtFecha(inactivos[0]?.ultima_compra)}`,
        tag: '💤 Atención', tagCls:'warn',
        accion: () => navigate('clientes.html?filter=inactivos'),
      });
    }

    // GASTOS PROGRAMADOS PRÓXIMOS A VENCER
    const proxGastos = (gastosProg||[]).filter(g=>g.fecha_proxima && g.fecha_proxima<=hace3);
    if (proxGastos.length) {
      alertas.push({
        tipo:'warning', icon:'⏰',
        titulo: `${proxGastos.length} gasto${proxGastos.length!==1?'s':''} programado${proxGastos.length!==1?'s':''} vencido${proxGastos.length!==1?'s':''}`,
        desc: proxGastos.slice(0,2).map(g=>`${g.nombre} — ${fmt(g.monto)}`).join('; '),
        tag: '⏳ Vencido', tagCls:'warn',
        accion: () => navigate('gastos.html?section=programados'),
      });
    }

    // DÍAS SIN VENTAS
    const ultimaVenta = (ventas||[]).sort((a,b)=>b.fecha.localeCompare(a.fecha))[0];
    if (ultimaVenta) {
      const fechaUlt = parseFechaSegura(ultimaVenta.fecha);
      const diffDias = fechaUlt ? Math.floor((new Date()-fechaUlt)/86400000) : 0;
      if (diffDias >= 3) {
        alertas.push({
          tipo:'info', icon:'📉',
          titulo: `${diffDias} día${diffDias!==1?'s':''} sin registrar ventas`,
          desc: `La última venta fue el ${fmtFecha(ultimaVenta.fecha)}`,
          tag: '📊 Info', tagCls:'info',
          accion: () => navigate('ventas.html?action=new'),
        });
      }
    }

    // CAJA BAJA
    const capital = await fetchCapital();
    if (capital < 500) {
      alertas.push({
        tipo:'danger', icon:'💰',
        titulo: 'Caja disponible baja',
        desc: `Saldo actual: ${fmt(capital)}. Considera revisar gastos o aumentar ventas.`,
        tag: '⚠️ Urgente', tagCls:'',
        accion: () => navigate('caja.html'),
      });
    }

    if (!alertas.length) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:40px">
          <div style="font-size:40px;margin-bottom:12px">✅</div>
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px">¡Todo en orden!</div>
          <div style="font-size:13.5px;color:var(--text-muted)">No hay alertas activas. Tu negocio está funcionando bien.</div>
        </div>`;
      return;
    }

    const iconoColorMap = { danger:'var(--danger-soft)', warning:'var(--warning-soft)', info:'var(--accent-soft)' };
    const iconoCMap     = { danger:'var(--danger)', warning:'var(--warning)', info:'var(--accent)' };

    grid.innerHTML = alertas.map(a => `
      <div class="alerta-item" onclick="${a.accion ? `navigate('${window.location.href}')` : ''}" style="cursor:${a.accion?'pointer':'default'}">
        <div class="alerta-icon" style="background:${iconoColorMap[a.tipo]};color:${iconoCMap[a.tipo]}">
          <span style="font-size:18px">${a.icon}</span>
        </div>
        <div class="alerta-body">
          <div class="alerta-title">${a.titulo}</div>
          <div class="alerta-desc">${a.desc}</div>
          <span class="alerta-tag ${a.tagCls}">${a.tag}</span>
        </div>
      </div>`).join('');

  } catch(e) { console.error('loadAlertas:', e); grid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Error al cargar alertas.</div>'; }
}

/* ============================================================
   HELPER setEl
   ============================================================ */
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

/* ============================================================
   ======================================================
   EXPORTACIONES
   NO guarda en Supabase. Genera dinámicamente en el browser.
   Se exporta en formato PDF o Excel (.xlsx).
   Esta sección sigue usando sus propias consultas y R.cache,
   tal como estaba antes; el soporte de Excel reutiliza
   exactamente las mismas cachés que ya llenaba ensureCaches(),
   así que no se agregan nuevas consultas a Supabase para esto.
   ======================================================
   ============================================================ */

// El módulo de Créditos exporta el HISTORIAL DE PAGOS de UN cliente a la
// vez (nunca una lista mezclada de todos), así que en vez de exportar de
// una, se abre un modal para que el usuario elija a quién.
async function exportar(tipo, formato) {
  if (tipo === 'creditos') { await abrirModalExportarCredito(formato); return; }
  await ejecutarExportacion(tipo, formato);
}

async function ejecutarExportacion(tipo, formato, clienteId, clienteNombre) {
  const ext = formato === 'xlsx' ? 'xlsx' : 'pdf';
  showToast(`Generando ${tipo}.${ext}…`, 'info');
  try {
    await ensureCaches();
    if (ext === 'xlsx') await exportarExcel(tipo, clienteId, clienteNombre);
    else                await exportarPDF(tipo, clienteId, clienteNombre);
    showToast(`✅ ${tipo}.${ext} descargado`, 'success');
  } catch(e) {
    console.error('exportar:', e);
    showToast('Error al generar el archivo', 'error');
  }
}

async function ensureCaches() {
  if (!R.cache.ventas.length)    await fetchVentas();
  // NUEVO: detalles de venta (para el conteo de "Productos vendidos" en Ventas/General)
  if (!R.cache.ventasDetalles || !R.cache.ventasDetalles.length) {
    R.cache.ventasDetalles = await fetchVentasDetalles();
  }
  if (!R.cache.compras.length)   await fetchCompras();
  if (!R.cache.gastos.length)    await fetchGastos();
  if (!R.cache.clientes.length)  await fetchClientes();
  if (!R.cache.productos.length) await fetchProductos();
  // Historial de pagos de créditos (cuotas pagadas/pendientes con datos
  // del cliente) — se usa para el reporte individual de Créditos, filtrado
  // siempre a UN cliente elegido por el usuario en el modal de exportación.
  if (!R.cache.creditosPagos || !R.cache.creditosPagos.length) {
    R.cache.creditosPagos = await fetchCreditosHistorialPagos();
  }
  // Resumen por crédito (todos los clientes, una fila por crédito) — SOLO
  // se usa dentro del Reporte General, como una sección más de resumen del
  // negocio (igual que Ventas/Compras/Gastos ahí), nunca como "historial".
  if (!R.cache.creditosResumen || !R.cache.creditosResumen.length) {
    R.cache.creditosResumen = await fetchCreditosReporte();
  }
  // El "Reporte General" necesita el resumen financiero calculado —
  // si el usuario exporta sin haber visitado antes la pestaña
  // Ejecutivo/Financiero, R.cache.resumen puede estar vacío.
  if (!R.cache.resumen || Object.keys(R.cache.resumen).length === 0) {
    const vRes = calcVentasResumen(R.cache.ventas);
    const totalComp = R.cache.compras.reduce((s,c)=>s+Number(c.total),0);
    const totalGast = R.cache.gastos.reduce((s,g)=>s+Number(g.monto),0) + await fetchSalariosPagados();
    const capital   = await fetchCapital();
    const otros     = await fetchOtrosMovimientos();
    R.cache.resumen = {
      ventas: vRes.total, compras: totalComp, gastos: totalGast,
      gananciaBruta: vRes.ganancia,
      gananciaNeta: vRes.ganancia - totalGast + otros.otrosIngresos - otros.otrosEgresos,
      capital, otrosIngresos: otros.otrosIngresos, otrosEgresos: otros.otrosEgresos,
    };
  }
}

/* ============================================================
   MODAL "EXPORTAR HISTORIAL DE CRÉDITO" — al exportar Créditos en
   PDF/Excel, se pregunta primero de qué cliente (con buscador, para
   listas grandes), en vez de mezclar a todos los clientes en un solo
   archivo.
   ============================================================ */
async function abrirModalExportarCredito(formato) {
  MX.formato = formato; MX.clienteId = null; MX.clienteNombre = null;

  const overlay = document.getElementById('modal-exportar-credito');
  const buscar  = document.getElementById('modal-cr-buscar');
  const lista   = document.getElementById('modal-cr-lista');
  const sel     = document.getElementById('modal-cr-seleccionado');
  const btn     = document.getElementById('modal-cr-btn-exportar');

  if (btn) btn.disabled = true;
  if (sel) sel.style.display = 'none';
  if (buscar) buscar.value = '';
  if (lista) { lista.innerHTML = '<div class="buscador-cliente-vacio">Cargando clientes…</div>'; lista.classList.add('show'); }
  if (overlay) overlay.classList.add('modal-open');

  if (!R.cache.creditosPagos || !R.cache.creditosPagos.length) {
    try { R.cache.creditosPagos = await fetchCreditosHistorialPagos(); }
    catch(e) { console.error('abrirModalExportarCredito:', e); }
  }
  buscarClienteExportModal('');
}

function buscarClienteExportModal(q) {
  const cont = document.getElementById('modal-cr-lista');
  pintarListaClientesCredito(cont, filtrarClientesCredito(q), seleccionarClienteExportModal);
}

function seleccionarClienteExportModal(c) {
  MX.clienteId = c.id; MX.clienteNombre = c.nombre;
  const buscar = document.getElementById('modal-cr-buscar');
  const lista  = document.getElementById('modal-cr-lista');
  const sel    = document.getElementById('modal-cr-seleccionado');
  const nombreEl = document.getElementById('modal-cr-seleccionado-nombre');
  const btn    = document.getElementById('modal-cr-btn-exportar');
  if (buscar) buscar.value = c.nombre;
  if (lista) { lista.classList.remove('show'); lista.innerHTML = ''; }
  if (nombreEl) nombreEl.textContent = c.nombre;
  if (sel) sel.style.display = 'inline-flex';
  if (btn) btn.disabled = false;
}

function cerrarModalExportarCredito() {
  const overlay = document.getElementById('modal-exportar-credito');
  if (overlay) overlay.classList.remove('modal-open');
}

/* ============================================================
   COMPARACIÓN DE SUCURSALES
   Usa el mismo período ya seleccionado en la página. Trae las ventas
   de todo el grupo (ya vienen combinadas gracias al adaptador) y las
   separa de nuevo por cuenta, para comparar una contra otra.
   ============================================================ */
async function abrirComparacionSucursales() {
  const overlay = document.getElementById('modalComparacionSuc');
  const body = document.getElementById('rg-comp-body');
  if (overlay) overlay.classList.add('modal-open');
  body.innerHTML = '<p style="text-align:center;padding:30px;color:var(--text-muted)">Calculando…</p>';

  try {
    const { data: grupo, error: errGrupo } = await sb.rpc('listar_sucursales_grupo');
    if (errGrupo) throw errGrupo;
    // Las bodegas no venden — no aplican a esta comparación.
    const cuentas = (grupo || []).filter(g => g.tipo !== 'bodega');

    const { from, to } = getDateRange();
    const { data: ventas, error: errVentas } = await sb.from('ventas')
      .select('auth_user_id,total,ganancia,fecha')
      .gte('fecha', from).lte('fecha', to);
    if (errVentas) throw errVentas;

    const idsCuentas = await mapearCuentasGrupo();

    // Días transcurridos del período, para proyectar cómo cerraría si
    // sigue al mismo ritmo (solo tiene sentido si el período incluye
    // el día de hoy, ej. "Este mes").
    const hoy = new Date(todayISO());
    const inicio = new Date(from);
    const fin = new Date(to);
    const diasTranscurridos = Math.max(1, Math.round((hoy - inicio) / 86400000) + 1);
    const diasTotalesPeriodo = Math.max(diasTranscurridos, Math.round((fin - inicio) / 86400000) + 1);
    const sePuedeProyectar = fin.getTime() === hoy.getTime() && diasTotalesPeriodo > diasTranscurridos;

    const filas = cuentas.map(c => {
      const authId = idsCuentas[c.id];
      const propias = (ventas || []).filter(v => v.auth_user_id === authId);
      const totalVentas = propias.reduce((s, v) => s + Number(v.total || 0), 0);
      const totalGanancia = propias.reduce((s, v) => s + Number(v.ganancia || 0), 0);
      const numVentas = propias.length;
      const ticket = numVentas ? totalVentas / numVentas : 0;
      const margen = totalVentas ? (totalGanancia / totalVentas * 100) : 0;
      const proyeccion = sePuedeProyectar ? (totalVentas / diasTranscurridos) * diasTotalesPeriodo : null;
      return { nombre: c.nombre, esCentral: c.es_central, totalVentas, totalGanancia, numVentas, ticket, margen, proyeccion };
    });

    renderComparacionSucursales(filas, { sePuedeProyectar, diasTranscurridos, diasTotalesPeriodo });
  } catch (e) {
    console.error('abrirComparacionSucursales:', e);
    body.innerHTML = `<p style="text-align:center;padding:30px;color:var(--danger)">No se pudo calcular la comparación. Intenta de nuevo.</p>`;
  }
}

// Pequeño mapa "id de la fila en sucursales" -> "auth_user_id real" —
// se obtiene una sola vez, en solo lectura, para poder separar los
// datos ya combinados de vuelta por cuenta.
async function mapearCuentasGrupo() {
  const { data } = await sbReal.from('sucursales')
    .select('id, auth_user_id_central, auth_user_id_sucursal, es_central')
    .or(`auth_user_id_central.eq.${R.userId},auth_user_id_sucursal.eq.${R.userId}`);
  const mapa = {};
  (data || []).forEach(s => { mapa[s.id] = s.auth_user_id_sucursal; });
  return mapa;
}

function renderComparacionSucursales(filas, proy) {
  const body = document.getElementById('rg-comp-body');
  if (!filas.length) {
    body.innerHTML = '<p style="text-align:center;padding:30px;color:var(--text-muted)">No hay sucursales para comparar todavía.</p>';
    return;
  }

  const totalGrupo = filas.reduce((s, f) => s + f.totalVentas, 0);
  const promedio = totalGrupo / filas.length;
  const ordenadas = [...filas].sort((a, b) => b.totalVentas - a.totalVentas);
  const mejor = ordenadas[0];
  const peor = ordenadas[ordenadas.length - 1];

  let consejos = '';
  if (filas.length > 1) {
    if (mejor.totalVentas > 0) {
      const participacionMejor = totalGrupo ? (mejor.totalVentas / totalGrupo * 100).toFixed(0) : 0;
      consejos += `<div class="rg-consejo bien">🏆 <strong>${esc(mejor.nombre)}</strong> es la que más vende en este período: ${fmt(mejor.totalVentas)}, que representa el <strong>${participacionMejor}%</strong> de todo lo que vendió el grupo. Vale la pena revisar qué está haciendo bien esta sucursal (horario, ubicación, atención al cliente, variedad de productos) para intentar replicarlo en las demás.</div>`;
    }
    if (peor.nombre !== mejor.nombre) {
      if (peor.totalVentas === 0) {
        consejos += `<div class="rg-consejo alerta">⚠️ <strong>${esc(peor.nombre)}</strong> no registra ninguna venta en este período. Esto puede significar que está cerrada, sin inventario para vender, o que necesita más atención. Te recomendamos revisarla cuanto antes.</div>`;
      } else if (peor.totalVentas < promedio * 0.5) {
        consejos += `<div class="rg-consejo alerta">⚠️ <strong>${esc(peor.nombre)}</strong> vende bastante menos que el promedio del grupo (${fmt(peor.totalVentas)} contra un promedio de ${fmt(promedio)}). Podría necesitar más inventario, más promoción local, o simplemente más tiempo si es una sucursal nueva.</div>`;
      }
    }
    const margenBajo = filas.filter(f => f.numVentas > 0 && f.margen < 15);
    margenBajo.forEach(f => {
      consejos += `<div class="rg-consejo alerta">📉 <strong>${esc(f.nombre)}</strong> tiene un margen de ganancia bajo (${f.margen.toFixed(1)}% de lo que vende se queda como ganancia). Esto puede pasar si los precios están muy ajustados o si los costos subieron — vale la pena revisar sus precios de venta.</div>`;
    });
    const margenAlto = filas.filter(f => f.numVentas > 0 && f.margen > 40);
    margenAlto.forEach(f => {
      consejos += `<div class="rg-consejo bien">💰 <strong>${esc(f.nombre)}</strong> tiene un margen de ganancia saludable (${f.margen.toFixed(1)}%) — sigue así.</div>`;
    });
  } else {
    consejos = `<div class="rg-consejo">Todavía solo tienes una sucursal con ventas registradas — crea otra desde el módulo Sucursales para poder comparar el rendimiento entre varias.</div>`;
  }

  const filasHtml = filas.map(f => {
    const participacion = totalGrupo ? (f.totalVentas / totalGrupo * 100).toFixed(1) : '0.0';
    return `
    <tr>
      <td style="font-weight:600">${f.esCentral ? '🏠 ' : '🏬 '}${esc(f.nombre)}</td>
      <td>${fmt(f.totalVentas)}</td>
      <td>${fmt(f.totalGanancia)}</td>
      <td>${f.numVentas}</td>
      <td>${fmt(f.ticket)}</td>
      <td>${f.numVentas ? f.margen.toFixed(1) + '%' : '—'}</td>
      <td>${participacion}%</td>
      <td>${f.proyeccion != null ? fmt(f.proyeccion) : '—'}</td>
    </tr>`;
  }).join('');

  const notaProyeccion = proy.sePuedeProyectar
    ? `<p style="font-size:12px;color:var(--text-muted);margin-top:6px">📈 La columna "Si sigue así" proyecta cómo cerraría cada sucursal el período completo, calculado con el ritmo de venta de los últimos ${proy.diasTranscurridos} día(s) — es un estimado, no una garantía.</p>`
    : '';

  document.getElementById('rg-comp-body').innerHTML = `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;line-height:1.5">
      Esta comparación te muestra, lado a lado, cómo le fue a cada sucursal durante <strong>${periodLabel()}</strong> —
      cuánto vendió, cuánta ganancia dejó, y qué tan seguido la visitan tus clientes (número de ventas y ticket promedio).
      Úsala para detectar rápido cuál sucursal necesita ayuda y cuál va bien.
    </p>
    <div class="table-wrap" style="margin-bottom:10px">
      <table class="rg-tabla-comp">
        <thead><tr><th>Sucursal</th><th>Ventas</th><th>Ganancia</th><th># Ventas</th><th>Ticket prom.</th><th>Margen</th><th>% del grupo</th><th>Si sigue así</th></tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>
    ${notaProyeccion}
    <h3 style="font-size:14.5px;margin:18px 0 8px">💬 Comentarios y consejos</h3>
    ${consejos}
  `;
}

function cerrarComparacionSucursales() {
  document.getElementById('modalComparacionSuc')?.classList.remove('modal-open');
}

/* ============================================================
   DETALLE DE BODEGAS
   Inventario, valor, movimientos y proyecciones de cada bodega,
   explicado en lenguaje simple — para que el cliente entienda qué
   está pasando y qué le conviene hacer.
   ============================================================ */
async function abrirDetalleBodegas() {
  const overlay = document.getElementById('modalDetalleBodegas');
  const body = document.getElementById('rg-bod-body');
  if (overlay) overlay.classList.add('modal-open');
  body.innerHTML = '<p style="text-align:center;padding:30px;color:var(--text-muted)">Calculando…</p>';

  try {
    const { data: grupo, error: errGrupo } = await sb.rpc('listar_sucursales_grupo');
    if (errGrupo) throw errGrupo;
    const bodegas = (grupo || []).filter(g => g.tipo === 'bodega');
    const sucursalesVenta = (grupo || []).filter(g => g.tipo !== 'bodega');

    if (!bodegas.length) {
      body.innerHTML = `
        <p style="text-align:center;padding:30px;color:var(--text-muted)">
          Todavía no tienes ninguna bodega creada.<br>
          <span style="font-size:12.5px">Puedes crear una desde el módulo Sucursales → apartado Bodegas — sirve para centralizar tu inventario y repartirlo desde ahí a cualquier sucursal.</span>
        </p>`;
      return;
    }

    const idsCuentas = await mapearCuentasGrupo();
    const { data: productos, error: errProd } = await sb.from('productos').select('*');
    if (errProd) throw errProd;
    // Se trae bastante historial (hasta 2000 filas) para calcular bien
    // el ritmo de salidas de cada producto en los últimos 30 días.
    const { data: movimientos } = await sb.from('movimientos_inventario')
      .select('auth_user_id,producto_id,tipo,cantidad,razon,created_at')
      .order('created_at', { ascending: false }).limit(2000);

    // Valor total de inventario de TODO el grupo (bodegas + sucursales)
    // para poder decir "esta bodega representa el X% de tu inventario".
    const valorTotalGrupo = (productos || [])
      .filter(p => p.tipo === 'producto')
      .reduce((s, p) => s + (Number(p.stock_actual || 0) * Number(p.costo || 0)), 0);

    const hace30dias = new Date(); hace30dias.setDate(hace30dias.getDate() - 30);

    const tarjetas = bodegas.map(b => {
      const authId = idsCuentas[b.id];
      const propios = (productos || []).filter(p => p.auth_user_id === authId && p.tipo === 'producto');
      const valorInventario = propios.reduce((s, p) => s + (Number(p.stock_actual || 0) * Number(p.costo || 0)), 0);
      const participacionInv = valorTotalGrupo ? (valorInventario / valorTotalGrupo * 100).toFixed(0) : 0;
      const stockBajo = propios.filter(p => p.stock_minimo > 0 && Number(p.stock_actual || 0) <= Number(p.stock_minimo));

      const movsBodega = (movimientos || []).filter(m => m.auth_user_id === authId);
      const movsRecientes = movsBodega.slice(0, 8);
      const entradas30 = movsBodega.filter(m => m.tipo === 'entrada' && new Date(m.created_at) >= hace30dias).length;
      const salidas30 = movsBodega.filter(m => m.tipo === 'salida' && new Date(m.created_at) >= hace30dias).length;

      // Proyección: para cada producto con stock bajo, calcula cuántas
      // unidades han salido en los últimos 30 días y estima en cuántos
      // días se agotaría si sigue saliendo al mismo ritmo.
      const proyeccionesAgotamiento = stockBajo.map(p => {
        const salidasProducto = movsBodega
          .filter(m => m.producto_id === p.id && m.tipo === 'salida' && new Date(m.created_at) >= hace30dias)
          .reduce((s, m) => s + Math.abs(Number(m.cantidad || 0)), 0);
        const ritmoDiario = salidasProducto / 30;
        const diasRestantes = ritmoDiario > 0 ? Math.round(Number(p.stock_actual || 0) / ritmoDiario) : null;
        return { nombre: p.nombre, stock: p.stock_actual, diasRestantes };
      });

      const listaStockBajo = stockBajo.length
        ? `<ul style="margin:8px 0 0 18px;font-size:12.5px;line-height:1.7">
            ${proyeccionesAgotamiento.map(p => `<li><strong>${esc(p.nombre)}</strong> — quedan ${fmtNum(p.stock)} u.${
              p.diasRestantes != null ? ` · a este ritmo se agotaría en <strong>~${p.diasRestantes} día(s)</strong>` : ' · sin salidas recientes para estimar cuándo se agota'
            }</li>`).join('')}
          </ul>`
        : '';

      // Sugerencia concreta: si hay sucursales con más movimiento, se
      // sugiere considerar enviarles stock desde aquí (solo si esta
      // bodega SÍ tiene inventario disponible que mover).
      let sugerenciaTraslado = '';
      if (propios.length > 0 && valorInventario > 0 && sucursalesVenta.length) {
        sugerenciaTraslado = `<div class="rg-consejo" style="margin-top:10px">💡 Si alguna de tus sucursales necesita reabastecerse, recuerda que puedes enviarle stock de esta bodega directamente desde <strong>Productos/Servicios → Mover productos</strong>.</div>`;
      }

      const movsHtml = movsRecientes.length
        ? movsRecientes.map(m => {
            const icono = m.tipo === 'entrada' ? '⬇️' : m.tipo === 'salida' ? '⬆️' : '✏️';
            const texto = m.tipo === 'entrada' ? 'Entrada' : m.tipo === 'salida' ? 'Salida' : 'Ajuste';
            return `<div style="font-size:12px;color:var(--text-muted);padding:3px 0">${icono} ${texto} de ${fmtNum(Math.abs(m.cantidad))} u. — ${fmtFecha(m.created_at?.slice(0,10))}</div>`;
          }).join('')
        : '<div style="font-size:12px;color:var(--text-muted)">Sin movimientos registrados todavía.</div>';

      const explicacion = propios.length === 0
        ? 'Esta bodega todavía no tiene productos registrados — puedes agregarlos directamente desde su propia página, o recibir stock desde una sucursal con "Mover productos".'
        : `Tiene <strong>${propios.length}</strong> producto(s) registrados, con un valor total de inventario de <strong>${fmt(valorInventario)}</strong> — esto representa aproximadamente el <strong>${participacionInv}%</strong> del valor total de inventario de todo tu grupo (sumando todas las sucursales y bodegas).`;

      return `
        <div class="rg-bod-card">
          <h3>📦 ${esc(b.nombre)}</h3>
          <p style="font-size:13px;color:var(--text-secondary);line-height:1.5">${explicacion}</p>
          <div class="rg-bod-kpis">
            <div class="rg-bod-kpi"><div class="lbl">Productos</div><div class="val">${propios.length}</div></div>
            <div class="rg-bod-kpi"><div class="lbl">Valor inventario</div><div class="val">${fmt(valorInventario)}</div></div>
            <div class="rg-bod-kpi"><div class="lbl">Stock bajo</div><div class="val">${stockBajo.length}</div></div>
            <div class="rg-bod-kpi"><div class="lbl">Entradas / Salidas (30 días)</div><div class="val">${entradas30} / ${salidas30}</div></div>
          </div>
          ${stockBajo.length ? `<div class="rg-consejo alerta" style="margin-top:12px">⚠️ <strong>${stockBajo.length} producto(s)</strong> están en o por debajo de su stock mínimo:${listaStockBajo}</div>` : `<div class="rg-consejo bien" style="margin-top:12px">✅ Ningún producto está con stock bajo por ahora.</div>`}
          ${sugerenciaTraslado}
          <div style="margin-top:14px"><strong style="font-size:12.5px">Últimos movimientos:</strong>${movsHtml}</div>
        </div>`;
    }).join('');

    let comparacionBodegas = '';
    if (bodegas.length > 1) {
      comparacionBodegas = `<div class="rg-consejo" style="margin-bottom:16px">📊 Tienes <strong>${bodegas.length} bodegas</strong> activas. Revisa cuál concentra más valor de inventario — si una está casi vacía y otra muy llena, puede ser buen momento para repartir mejor el stock entre ellas.</div>`;
    }

    document.getElementById('rg-bod-body').innerHTML = `
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;line-height:1.5">
        Aquí ves el estado real de cada una de tus bodegas: cuánto inventario tienen guardado, qué productos están por agotarse
        (con una estimación de en cuántos días, según qué tan rápido han estado saliendo), y su actividad reciente de entradas y salidas.
      </p>
      ${comparacionBodegas}
      ${tarjetas}
    `;
  } catch (e) {
    console.error('abrirDetalleBodegas:', e);
    body.innerHTML = `<p style="text-align:center;padding:30px;color:var(--danger)">No se pudo cargar el detalle de bodegas. Intenta de nuevo.</p>`;
  }
}

function cerrarDetalleBodegas() {
  document.getElementById('modalDetalleBodegas')?.classList.remove('modal-open');
}

function confirmarExportarCredito() {
  if (!MX.clienteId) return;
  const { formato, clienteId, clienteNombre } = MX;
  cerrarModalExportarCredito();
  ejecutarExportacion('creditos', formato, clienteId, clienteNombre);
}

// Nombre de archivo seguro a partir del nombre del cliente.
function slugify(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'cliente';
}

/* ============================================================
   CONFIGURAR EXPORTACIONES — columnas elegibles por el cliente
   El cliente decide, por cada tipo de reporte, qué columnas
   quiere ver en el PDF y en el Excel. La selección se guarda en
   configuracion_empresa.metadata.exportConfig (columna jsonb que
   ya existía y no se usaba en ningún otro módulo del sistema),
   así que no hace falta ninguna migración ni tabla nueva.
   Si el cliente nunca configuró nada, TODAS las columnas quedan
   activas por defecto — el comportamiento es idéntico al de
   antes de este cambio.
   ============================================================ */

// Definición de columnas disponibles por reporte. El orden aquí
// define el orden en el PDF/Excel. `tipo` sirve para dar formato:
// 'texto' (tal cual), 'moneda' (símbolo + 2 decimales), 'entero'
// (sin decimales) o 'cantidad' (hasta 2 decimales, sin símbolo).
const COLUMNAS_REPORTES = {
  ventas: [
    { key:'numero',    label:'#Venta',            tipo:'texto' },
    { key:'fecha',     label:'Fecha',              tipo:'texto' },
    { key:'cliente',   label:'Cliente',            tipo:'texto' },
    { key:'metodo',    label:'Método de pago',     tipo:'texto' },
    { key:'productos', label:'Productos vendidos', tipo:'texto' },
    { key:'servicios', label:'Servicios vendidos', tipo:'texto' },
    { key:'proveedor', label:'Proveedor',           tipo:'texto' },
    { key:'total',     label:'Total',              tipo:'moneda' },
    { key:'ganancia',  label:'Ganancia',           tipo:'moneda' },
  ],
  compras: [
    { key:'numero',    label:'#Compra',   tipo:'texto' },
    { key:'fecha',     label:'Fecha',     tipo:'texto' },
    { key:'proveedor', label:'Proveedor', tipo:'texto' },
    { key:'total',     label:'Total',     tipo:'moneda' },
    { key:'estado',    label:'Estado',    tipo:'texto' },
  ],
  clientes: [
    { key:'nombre',       label:'Nombre',        tipo:'texto' },
    { key:'telefono',     label:'Teléfono',      tipo:'texto' },
    { key:'email',        label:'Email',         tipo:'texto' },
    { key:'compras',      label:'Compras',       tipo:'entero' },
    { key:'totalGastado', label:'Total gastado', tipo:'moneda' },
    { key:'ultimaCompra', label:'Última compra', tipo:'texto' },
  ],
  inventario: [
    { key:'producto',   label:'Producto',        tipo:'texto' },
    { key:'sku',        label:'SKU',             tipo:'texto' },
    { key:'categoria',  label:'Categoría',       tipo:'texto' },
    { key:'marca',      label:'Marca/Proveedor', tipo:'texto' },
    { key:'stock',      label:'Stock',           tipo:'cantidad' },
    { key:'costo',      label:'Costo',           tipo:'moneda' },
    { key:'precio',     label:'Precio',          tipo:'moneda' },
    { key:'valorTotal', label:'Valor total',     tipo:'moneda' },
  ],
  gastos: [
    { key:'concepto',  label:'Concepto',  tipo:'texto' },
    { key:'categoria', label:'Categoría', tipo:'texto' },
    { key:'fecha',     label:'Fecha',     tipo:'texto' },
    { key:'monto',     label:'Monto',     tipo:'moneda' },
    { key:'tipo',      label:'Tipo',      tipo:'texto' },
  ],
  // Historial de pagos de créditos: una fila por cuota. Solo aparecen
  // clientes que adquirieron un crédito, con su información y el
  // detalle de cuotas ya pagadas y las que faltan (pendiente/vencida/parcial).
  creditos: [
    { key:'cliente',        label:'Cliente',         tipo:'texto' },
    { key:'telefono',       label:'Teléfono',        tipo:'texto' },
    { key:'numero_credito', label:'N° crédito',      tipo:'texto' },
    { key:'cuota',          label:'Cuota',           tipo:'texto' },
    { key:'fecha_venc',     label:'Vencimiento',     tipo:'texto' },
    { key:'monto_cuota',    label:'Monto cuota',     tipo:'moneda' },
    { key:'pagado',         label:'Pagado',          tipo:'moneda' },
    { key:'saldo',          label:'Saldo',           tipo:'moneda' },
    { key:'estado',         label:'Estado',          tipo:'texto' },
  ],
};

const ICONO_MODULO = { ventas:'🛒', compras:'📦', clientes:'👥', inventario:'🏭', gastos:'💸', creditos:'💳' };
const NOMBRE_MODULO = { ventas:'Ventas', compras:'Compras', clientes:'Clientes', inventario:'Inventario', gastos:'Gastos', creditos:'Créditos' };

// ¿Está activa la columna `key` del reporte `tipoReporte`? Por defecto
// (si el cliente no ha guardado configuración, o esta columna es nueva
// y no existía cuando guardó) la columna está ACTIVA.
function colActiva(tipoReporte, key) {
  const cfg = R.exportConfig?.[tipoReporte];
  if (!cfg) return true;
  return cfg[key] !== false;
}

function columnasActivas(tipoReporte) {
  return (COLUMNAS_REPORTES[tipoReporte]||[]).filter(c => colActiva(tipoReporte, c.key));
}

// ---- Construcción de filas (independiente del formato de salida) ----
function filaVenta(v, detMap) {
  const info = detMap[v.id];
  return {
    numero: v.numero_venta, fecha: fmtFecha(v.fecha),
    cliente: v.cliente_nombre||'Consumidor Final', metodo: v.metodo_pago_nombre||'—',
    productos: fmtProductosVenta(info), servicios: fmtServiciosVenta(info),
    proveedor: fmtProveedorVenta(info),
    total: Number(v.total||0), ganancia: Number(v.ganancia||0),
  };
}
function filaCompra(c) {
  return { numero:c.numero, fecha:fmtFecha(c.fecha), proveedor:c.proveedor_nombre||'—', total:Number(c.total||0), estado:c.estado||'' };
}
function filaCliente(c) {
  return { nombre:c.nombre||'', telefono:c.telefono||'—', email:c.correo||'—', compras:Number(c.num_compras||0), totalGastado:Number(c.total_compras||0), ultimaCompra:fmtFecha(c.ultima_compra) };
}
function filaProducto(p) {
  return { producto:p.nombre||'', sku:p.sku||'—', categoria:p.categoria||'—', marca:p.proveedor_nombre||'—',
    stock:Number(p.stock_actual||0), costo:Number(p.costo||0), precio:Number(p.precio||0),
    valorTotal:Number(p.stock_actual||0)*Number(p.costo||0) };
}
function filaGasto(g) {
  return { concepto:g.concepto||'', categoria:g.categoria||'—', fecha:fmtFecha(g.fecha), monto:Number(g.monto||0), tipo:g.tipo||'' };
}
function filaCreditoPago(f) {
  return {
    cliente: f.cliente||'', telefono: f.telefono||'—', numero_credito: f.numero_credito||'',
    cuota: f.cuota||'', fecha_venc: fmtFecha(f.fecha_venc),
    monto_cuota: Number(f.monto_cuota||0), pagado: Number(f.pagado||0), saldo: Number(f.saldo||0),
    estado: estadoCuotaInfo(f.estado).label,
  };
}

// Fila de "Totales" del reporte de Ventas, respetando solo las columnas
// activas. La etiqueta "TOTALES" se coloca en la primera columna de
// texto disponible que no sea numérica.
function filaTotalesVentas(cols, totUnidadesProd, totMonto, totGanancia, paraExcel) {
  let etiquetaPuesta = false;
  return cols.map(c => {
    if (c.key === 'productos') return `Uds. producto: ${fmtNum(totUnidadesProd)}`;
    if (c.key === 'total')     return paraExcel ? totMonto : fmt(totMonto);
    if (c.key === 'ganancia')  return paraExcel ? totGanancia : fmt(totGanancia);
    if (!etiquetaPuesta) { etiquetaPuesta = true; return 'TOTALES'; }
    return '';
  });
}

// ---- Formateo de celdas según destino (PDF = texto, Excel = número) ----
function celdaPDF(valor, tipoCol) {
  if (tipoCol === 'moneda') return fmt(valor);
  if (tipoCol === 'entero' || tipoCol === 'cantidad') return fmtNum(valor);
  return valor ?? '';
}
function celdaXLSX(valor, tipoCol) {
  if (tipoCol === 'moneda' || tipoCol === 'entero' || tipoCol === 'cantidad') return Number(valor||0);
  return valor ?? '';
}
function filaAPDF(fila, cols)  { return cols.map(c => celdaPDF(fila[c.key], c.tipo)); }
function filaAXLSX(fila, cols) { return cols.map(c => celdaXLSX(fila[c.key], c.tipo)); }
function headersPDF(cols)  { return cols.map(c => c.label); }
function headersXLSX(cols) { return cols.map(c => c.tipo==='moneda' ? `${c.label} (${sym()})` : c.label); }
function formatosXLSX(cols) {
  return cols.map(c => c.tipo==='moneda' ? NUM_MONEDA : c.tipo==='entero' ? NUM_ENTERO : c.tipo==='cantidad' ? NUM_CANT : null);
}

/* ---- UI: pintar los checkboxes de configuración en la pestaña Exportar ---- */
function renderConfigExportar() {
  const cont = document.getElementById('config-exportar-grid');
  if (!cont) return;
  cont.innerHTML = Object.keys(COLUMNAS_REPORTES).map(tipoReporte => {
    const cols = COLUMNAS_REPORTES[tipoReporte];
    const items = cols.map(c => {
      const activa = colActiva(tipoReporte, c.key);
      return `<label class="config-col-item${activa?'':' disabled'}">
        <input type="checkbox" ${activa?'checked':''}
          onchange="toggleColumnaExportar('${tipoReporte}','${c.key}',this.checked,this)">
        ${c.label}
      </label>`;
    }).join('');
    return `<div class="config-exportar-modulo">
      <div class="config-exportar-modulo-title"><span class="icon">${ICONO_MODULO[tipoReporte]}</span> ${NOMBRE_MODULO[tipoReporte]}</div>
      <div class="config-col-list">${items}</div>
    </div>`;
  }).join('');
}

// Marca/desmarca en memoria (aún no guarda en Supabase — eso ocurre al
// presionar "Guardar configuración", para poder cambiar varias casillas
// sin disparar una escritura por cada clic).
function toggleColumnaExportar(tipoReporte, key, activa, checkboxEl) {
  if (!R.exportConfig[tipoReporte]) R.exportConfig[tipoReporte] = {};
  R.exportConfig[tipoReporte][key] = !!activa;
  const label = checkboxEl?.closest('.config-col-item');
  if (label) label.classList.toggle('disabled', !activa);
}

// Guarda R.exportConfig dentro de configuracion_empresa.metadata, sin
// tocar ninguna otra clave que ya exista en ese campo jsonb.
async function guardarConfigExportar() {
  try {
    const metadataActual = (R.empresaConfig && typeof R.empresaConfig.metadata === 'object' && R.empresaConfig.metadata) || {};
    const nuevaMetadata  = { ...metadataActual, exportConfig: R.exportConfig };
    const { error } = await sb.from('configuracion_empresa')
      .update({ metadata: nuevaMetadata })
      .eq('auth_user_id', R.userId);
    if (error) throw error;
    R.empresaConfig.metadata = nuevaMetadata;
    showToast('✅ Configuración de exportaciones guardada', 'success');
    const badge = document.getElementById('config-exportar-guardado');
    if (badge) { badge.classList.add('show'); setTimeout(()=>badge.classList.remove('show'), 2500); }
  } catch(e) {
    console.error('guardarConfigExportar:', e);
    showToast('Error al guardar la configuración', 'error');
  }
}

// Restaura todas las columnas de todos los reportes a "activas" (el
// comportamiento por defecto) y guarda ese estado.
async function restaurarConfigExportar() {
  R.exportConfig = {};
  renderConfigExportar();
  await guardarConfigExportar();
}

/* ---- LOGO EN PDF ----
   Descarga el logo del negocio (guardado en Personalización/Editar
   Perfil) y lo convierte a base64 para poder dibujarlo con
   doc.addImage(). Si falla por cualquier motivo (sin logo, formato
   no soportado como SVG, error de red), se devuelve null y el PDF
   se sigue generando normal, solo sin la imagen — nunca rompe la
   exportación por esto. */
// Calcula el tamaño real que debe dibujarse el logo dentro de un
// espacio máximo (maxAncho x maxAlto), respetando su proporción
// original — nunca lo estira ni lo aplasta.
function ajustarLogoSinDeformar(anchoNatural, altoNatural, maxAncho, maxAlto) {
  const escala = Math.min(maxAncho / (anchoNatural || 1), maxAlto / (altoNatural || 1));
  return { w: Math.round((anchoNatural || 1) * escala * 100) / 100, h: Math.round((altoNatural || 1) * escala * 100) / 100 };
}

async function cargarLogoParaPDF() {
  const url = R.empresaConfig?.logo_principal_url || R.empresaConfig?.logo_url;
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const m = /^data:image\/(\w+);base64,/.exec(dataUrl || '');
    const tipo = m ? m[1].toLowerCase() : '';
    const formato = tipo === 'png' ? 'PNG' : (tipo === 'jpeg' || tipo === 'jpg') ? 'JPEG' : tipo === 'webp' ? 'WEBP' : null;
    if (!formato) return null; // SVG u otro formato que jsPDF no puede dibujar directo
    // Se mide el tamaño REAL de la imagen — sin esto, el logo se
    // estira o se aplasta para encajar en un cuadro fijo si no es
    // cuadrado (la mayoría de logos no lo son).
    const { anchoNatural, altoNatural } = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ anchoNatural: img.naturalWidth || 1, altoNatural: img.naturalHeight || 1 });
      img.onerror = () => resolve({ anchoNatural: 1, altoNatural: 1 });
      img.src = dataUrl;
    });
    return { dataUrl, formato, anchoNatural, altoNatural };
  } catch (e) {
    console.warn('No se pudo cargar el logo para el PDF:', e);
    return null;
  }
}

function docHeader(tipo) {
  // FIX: priorizar nombre_comercial (campo real guardado por personalizacion.html)
  const biz    = R.empresaConfig?.nombre_comercial || R.empresaConfig?.nombre_negocio || 'Mi Negocio';
  const moneda = sym();
  const { from, to } = getDateRange();
  const periodo = from===to ? fmtFecha(from) : `${fmtFecha(from)} — ${fmtFecha(to)}`;
  const ahora  = new Date().toLocaleString('es-NI');
  return { biz, moneda, periodo, ahora, tipo };
}

/* ---- PDF ---- */
/* FIX: el "Reporte General" solo mostraba el resumen financiero y
   ventas — al llegar a la sección de ventas se reasignaba la
   variable `tipo` a 'ventas-section', y como los bloques de
   compras/clientes/inventario/gastos comparaban contra el `tipo`
   original ('general'), esa comparación ya nunca coincidía y esas
   secciones se saltaban por completo. Ahora se usa una bandera
   `esGeneral` separada que nunca se sobreescribe, y cada sección
   se agrega en una página nueva para que todo quede legible.
   Los reportes individuales (ventas, compras, etc. por separado)
   se comportan exactamente igual que antes. */
async function exportarPDF(tipo, clienteId, clienteNombre) {
  const { jsPDF } = window.jspdf;
  const doc  = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
  const h    = docHeader(tipo);
  const W    = doc.internal.pageSize.getWidth();
  const esGeneral = tipo === 'general';
  const logo = await cargarLogoParaPDF();

  function pintarCabecera() {
    doc.setFillColor(90, 90, 244);
    doc.rect(0,0,W,20,'F');
    let textoX = 10;
    if (logo) {
      try {
        const { w, h } = ajustarLogoSinDeformar(logo.anchoNatural, logo.altoNatural, 14, 14);
        doc.addImage(logo.dataUrl, logo.formato, 8 + (14-w)/2, 3 + (14-h)/2, w, h);
        textoX = 26;
      } catch (e) { /* si falla, se sigue sin logo */ }
    }
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont(undefined,'bold');
    doc.text(`${h.biz} — Reporte ${esGeneral ? 'General (Completo)' : `de ${tituloTipo(tipo)}`}`, textoX, 13);
    doc.setFontSize(9); doc.setFont(undefined,'normal');
    doc.text(`Período: ${h.periodo} | Moneda: ${h.moneda} | Generado: ${h.ahora}`, W-10, 13, { align:'right' });
  }

  pintarCabecera();
  let startY = 28;

  function tituloSeccion(txt) {
    doc.setTextColor(30,30,40);
    doc.setFontSize(11); doc.setFont(undefined,'bold');
    doc.text(txt, 10, startY);
    startY += 6;
  }

  // ---- RESUMEN FINANCIERO (solo en reporte general) ----
  if (esGeneral) {
    const r = R.cache.resumen || {};
    tituloSeccion('Resumen Financiero');
    const finRows = [
      ['Ventas totales', fmt(r.ventas)], ['Compras totales', fmt(r.compras)],
      ['Total gastos', fmt(r.gastos)], ['Ganancia bruta', fmt(r.gananciaBruta)],
      ['Otros ingresos', fmt(r.otrosIngresos)], ['Otros egresos', fmt(r.otrosEgresos)],
      ['Ganancia neta', fmt(r.gananciaNeta)], ['Caja disponible', fmt(r.capital)],
    ];
    doc.autoTable({ startY, head:[['Concepto','Monto']], body:finRows, theme:'striped',
      headStyles:{fillColor:[90,90,244]}, margin:{left:10,right:10}, styles:{fontSize:9} });
    startY = doc.lastAutoTable.finalY + 10;
  }

  // ---- VENTAS ----
  if (tipo==='ventas' || esGeneral) {
    if (esGeneral) tituloSeccion('Ventas');
    const cols = columnasActivas('ventas');
    if (!cols.length) {
      doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text('No hay columnas seleccionadas para Ventas (revisa "Configurar exportaciones").', 10, startY);
      startY += 10;
    } else {
      const detMap = detalleVentaPorVenta(R.cache.ventasDetalles);
      const filas  = R.cache.ventas.map(v => filaVenta(v, detMap));
      const rows   = filas.map(f => filaAPDF(f, cols));
      const totUnidadesProd = totalUnidadesProducto(detMap);
      const totMonto        = R.cache.ventas.reduce((s,v)=>s+Number(v.total||0),0);
      const totGanancia     = R.cache.ventas.reduce((s,v)=>s+Number(v.ganancia||0),0);
      doc.autoTable({ startY, head:[headersPDF(cols)],
        body:rows.length?rows:[['Sin datos en este período', ...Array(cols.length-1).fill('')]],
        foot:rows.length?[filaTotalesVentas(cols, totUnidadesProd, totMonto, totGanancia, false)]:[],
        theme:'striped', headStyles:{fillColor:[90,90,244]},
        footStyles:{fillColor:[230,230,250], textColor:[30,30,40], fontStyle:'bold'},
        margin:{left:10,right:10}, styles:{fontSize:8, overflow:'linebreak'} });
      startY = doc.lastAutoTable.finalY + 10;
    }
  }

  // ---- COMPRAS ----
  if (tipo==='compras' || esGeneral) {
    if (esGeneral) {
      doc.addPage();
      pintarCabecera();
      startY = 28;
      tituloSeccion('Compras');
    }
    const cols = columnasActivas('compras');
    if (!cols.length) {
      doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text('No hay columnas seleccionadas para Compras (revisa "Configurar exportaciones").', 10, startY);
      startY += 10;
    } else {
      const rows = R.cache.compras.map(c => filaAPDF(filaCompra(c), cols));
      doc.autoTable({ startY, head:[headersPDF(cols)],
        body:rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], theme:'striped',
        headStyles:{fillColor:[249,115,22]}, margin:{left:10,right:10}, styles:{fontSize:8} });
      startY = doc.lastAutoTable.finalY + 10;
    }
  }

  // ---- CLIENTES ----
  if (tipo==='clientes' || esGeneral) {
    if (esGeneral) {
      doc.addPage();
      pintarCabecera();
      startY = 28;
      tituloSeccion('Clientes');
    }
    const cols = columnasActivas('clientes');
    if (!cols.length) {
      doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text('No hay columnas seleccionadas para Clientes (revisa "Configurar exportaciones").', 10, startY);
      startY += 10;
    } else {
      const rows = R.cache.clientes.map(c => filaAPDF(filaCliente(c), cols));
      doc.autoTable({ startY, head:[headersPDF(cols)],
        body:rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], theme:'striped',
        headStyles:{fillColor:[34,197,94]}, margin:{left:10,right:10}, styles:{fontSize:8} });
      startY = doc.lastAutoTable.finalY + 10;
    }
  }

  // ---- INVENTARIO ----
  if (tipo==='inventario' || esGeneral) {
    if (esGeneral) {
      doc.addPage();
      pintarCabecera();
      startY = 28;
      tituloSeccion('Inventario');
    }
    const prods = (R.cache.productos||[]).filter(p=>p.tipo==='producto'&&p.activo);
    const cols = columnasActivas('inventario');
    if (!cols.length) {
      doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text('No hay columnas seleccionadas para Inventario (revisa "Configurar exportaciones").', 10, startY);
      startY += 10;
    } else {
      const rows = prods.map(p => filaAPDF(filaProducto(p), cols));
      doc.autoTable({ startY, head:[headersPDF(cols)],
        body:rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], theme:'striped',
        headStyles:{fillColor:[8,182,212]}, margin:{left:10,right:10}, styles:{fontSize:8} });
      startY = doc.lastAutoTable.finalY + 10;
    }
  }

  // ---- GASTOS ----
  if (tipo==='gastos' || esGeneral) {
    if (esGeneral) {
      doc.addPage();
      pintarCabecera();
      startY = 28;
      tituloSeccion('Gastos');
    }
    const cols = columnasActivas('gastos');
    if (!cols.length) {
      doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text('No hay columnas seleccionadas para Gastos (revisa "Configurar exportaciones").', 10, startY);
    } else {
      const rows = R.cache.gastos.map(g => filaAPDF(filaGasto(g), cols));
      doc.autoTable({ startY, head:[headersPDF(cols)],
        body:rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], theme:'striped',
        headStyles:{fillColor:[239,68,68]}, margin:{left:10,right:10}, styles:{fontSize:8} });
    }
  }

  // ---- CRÉDITOS — historial de pagos de UN cliente (exportación individual) ----
  // Nunca mezcla clientes: siempre viene filtrado al que se elige en el modal.
  if (tipo === 'creditos') {
    const filasCliente = (R.cache.creditosPagos||[]).filter(f => !clienteId || f.cliente_id === clienteId);
    const nombreCliente = clienteNombre || filasCliente[0]?.cliente || 'cliente seleccionado';
    tituloSeccion(`Historial de pagos — ${nombreCliente}`);
    const cols = columnasActivas('creditos');
    if (!cols.length) {
      doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text('No hay columnas seleccionadas para Créditos (revisa "Configurar exportaciones").', 10, startY);
      startY += 10;
    } else {
      const rows = filasCliente.map(f => filaAPDF(filaCreditoPago(f), cols));
      doc.autoTable({ startY, head:[headersPDF(cols)],
        body:rows.length?rows:[[`Sin cuotas para ${nombreCliente}`, ...Array(cols.length-1).fill('')]], theme:'striped',
        headStyles:{fillColor:[168,85,247]}, margin:{left:10,right:10}, styles:{fontSize:8} });
      startY = doc.lastAutoTable.finalY + 10;
    }
  }

  // ---- CRÉDITOS — resumen (SOLO en Reporte General, todos los clientes) ----
  // Es un resumen del negocio (como Ventas/Compras/Gastos ahí), no un
  // "historial de pagos" — ese sigue siendo siempre por cliente elegido.
  if (esGeneral) {
    doc.addPage();
    pintarCabecera();
    startY = 28;
    tituloSeccion('Créditos (resumen)');
    const filas = R.cache.creditosResumen || [];
    const rows = filas.map(f => [
      f.numero_credito, f.cliente, f.tipo==='venta'?'Por venta':'Financiero',
      fmt(f.montoProducto), fmt(f.totalCuotas), fmt(f.gananciaEstimada), f.estado,
    ]);
    doc.autoTable({
      startY,
      head:[['N° crédito','Cliente','Tipo','Monto producto/capital','Total con impuestos e intereses','Ganancia estimada','Estado']],
      body: rows.length ? rows : [['Sin créditos en este período','','','','','','']],
      theme:'striped', headStyles:{fillColor:[168,85,247]}, margin:{left:10,right:10}, styles:{fontSize:8},
    });
    startY = doc.lastAutoTable.finalY + 10;
  }

  // Pie de página
  const pages = doc.internal.getNumberOfPages();
  for (let i=1;i<=pages;i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(150,150,180);
    doc.text(`Generado por Negocio360 — Página ${i} de ${pages}`, W/2, doc.internal.pageSize.getHeight()-5, {align:'center'});
  }

  const sufijoCliente = tipo === 'creditos' ? `_${slugify(clienteNombre)}` : '';
  doc.save(`negocio360_${tipo}${sufijoCliente}_${todayISO()}.pdf`);
}

/* ---- EXCEL (.xlsx) ---- */
/* Usa la librería SheetJS (window.XLSX), que ya se carga en reportes.html.
   Genera un libro bien estructurado: encabezados claros, columnas de
   moneda/cantidad como NÚMEROS reales (no texto) con formato numérico
   aplicado, ancho de columna autoajustado ("escalado") según el
   contenido, fila de encabezado congelada y autofiltro activado.
   No reemplaza ni modifica la exportación en PDF: es un camino
   totalmente independiente que reutiliza las mismas cachés. */

/* Crea y agrega una hoja a partir de encabezados + filas, aplicando
   formato numérico por columna, ancho autoajustado, fila fija y
   autofiltro. `formatos` es un array paralelo a `headers`: null para
   texto, o un formato numérico de Excel (ej. '#,##0.00') para números. */
function appendSheetXLSX(wb, nombreHoja, headers, rows, formatos) {
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Formato numérico por celda de datos (no toca el encabezado)
  rows.forEach((row, ri) => {
    formatos.forEach((f, ci) => {
      if (!f) return;
      const ref = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = f;
    });
  });

  // Ancho de columna autoajustado ("escalado") según el contenido real
  ws['!cols'] = headers.map((h, ci) => {
    const maxLen = rows.reduce((m, r) => Math.max(m, String(r[ci] ?? '').length), h.length);
    return { wch: Math.min(Math.max(maxLen + 2, 10), 42) };
  });

  // Fila de encabezado congelada, para desplazarse sin perderla de vista
  ws['!freeze'] = { xSplit: '0', ySplit: '1', topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

  // Autofiltro en la fila de encabezado (permite ordenar/filtrar en Excel)
  if (headers.length && rows.length) {
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rows.length,c:headers.length-1} }) };
  }

  XLSX.utils.book_append_sheet(wb, ws, nombreHoja.slice(0, 31));
  return ws;
}

const NUM_MONEDA = '#,##0.00';
const NUM_ENTERO = '#,##0';
const NUM_CANT   = '#,##0.##';

function hojaVentasXLSX(wb) {
  const cols = columnasActivas('ventas');
  if (!cols.length) {
    appendSheetXLSX(wb, 'Ventas', ['Aviso'], [['No hay columnas seleccionadas para Ventas (revisa "Configurar exportaciones").']], [null]);
    return;
  }
  const detMap = detalleVentaPorVenta(R.cache.ventasDetalles);
  const filas  = R.cache.ventas.map(v => filaVenta(v, detMap));
  const rows   = filas.map(f => filaAXLSX(f, cols));
  if (rows.length) {
    const totUnidadesProd = totalUnidadesProducto(detMap);
    const totMonto        = R.cache.ventas.reduce((s,v)=>s+Number(v.total||0),0);
    const totGanancia     = R.cache.ventas.reduce((s,v)=>s+Number(v.ganancia||0),0);
    rows.push(filaTotalesVentas(cols, totUnidadesProd, totMonto, totGanancia, true));
  }
  appendSheetXLSX(wb, 'Ventas', headersXLSX(cols),
    rows.length?rows:[['Sin datos en este período', ...Array(cols.length-1).fill('')]], formatosXLSX(cols));
}

function hojaComprasXLSX(wb) {
  const cols = columnasActivas('compras');
  if (!cols.length) {
    appendSheetXLSX(wb, 'Compras', ['Aviso'], [['No hay columnas seleccionadas para Compras (revisa "Configurar exportaciones").']], [null]);
    return;
  }
  const rows = R.cache.compras.map(c => filaAXLSX(filaCompra(c), cols));
  appendSheetXLSX(wb, 'Compras', headersXLSX(cols),
    rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], formatosXLSX(cols));
}

function hojaClientesXLSX(wb) {
  const cols = columnasActivas('clientes');
  if (!cols.length) {
    appendSheetXLSX(wb, 'Clientes', ['Aviso'], [['No hay columnas seleccionadas para Clientes (revisa "Configurar exportaciones").']], [null]);
    return;
  }
  const rows = R.cache.clientes.map(c => filaAXLSX(filaCliente(c), cols));
  appendSheetXLSX(wb, 'Clientes', headersXLSX(cols),
    rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], formatosXLSX(cols));
}

function hojaInventarioXLSX(wb) {
  const cols = columnasActivas('inventario');
  if (!cols.length) {
    appendSheetXLSX(wb, 'Inventario', ['Aviso'], [['No hay columnas seleccionadas para Inventario (revisa "Configurar exportaciones").']], [null]);
    return;
  }
  const prods = (R.cache.productos||[]).filter(p=>p.tipo==='producto'&&p.activo);
  const rows = prods.map(p => filaAXLSX(filaProducto(p), cols));
  appendSheetXLSX(wb, 'Inventario', headersXLSX(cols),
    rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], formatosXLSX(cols));
}

function hojaGastosXLSX(wb) {
  const cols = columnasActivas('gastos');
  if (!cols.length) {
    appendSheetXLSX(wb, 'Gastos', ['Aviso'], [['No hay columnas seleccionadas para Gastos (revisa "Configurar exportaciones").']], [null]);
    return;
  }
  const rows = R.cache.gastos.map(g => filaAXLSX(filaGasto(g), cols));
  appendSheetXLSX(wb, 'Gastos', headersXLSX(cols),
    rows.length?rows:[['Sin datos', ...Array(cols.length-1).fill('')]], formatosXLSX(cols));
}

// Historial de pagos de UN cliente (nunca mezcla clientes). `clienteId`
// siempre llega desde el modal de exportación en el caso individual.
function hojaCreditosXLSX(wb, clienteId, clienteNombre) {
  const cols = columnasActivas('creditos');
  const filasCliente = (R.cache.creditosPagos||[]).filter(f => !clienteId || f.cliente_id === clienteId);
  const nombreCliente = clienteNombre || filasCliente[0]?.cliente || 'cliente seleccionado';
  if (!cols.length) {
    appendSheetXLSX(wb, 'Créditos', ['Aviso'], [['No hay columnas seleccionadas para Créditos (revisa "Configurar exportaciones").']], [null]);
    return;
  }
  const rows = filasCliente.map(f => filaAXLSX(filaCreditoPago(f), cols));
  appendSheetXLSX(wb, 'Créditos', headersXLSX(cols),
    rows.length?rows:[[`Sin cuotas para ${nombreCliente}`, ...Array(cols.length-1).fill('')]], formatosXLSX(cols));
}

// Resumen por crédito (todos los clientes) — SOLO para el Reporte
// General, igual que las demás hojas de resumen del negocio.
function hojaCreditosResumenXLSX(wb) {
  const filas = R.cache.creditosResumen || [];
  const headers = ['N° crédito','Cliente','Tipo', `Monto producto/capital (${sym()})`,
    `Total con impuestos e intereses (${sym()})`, `Ganancia estimada (${sym()})`, 'Estado'];
  const rows = filas.map(f => [
    f.numero_credito, f.cliente, f.tipo==='venta'?'Por venta':'Financiero',
    Number(f.montoProducto||0), Number(f.totalCuotas||0), Number(f.gananciaEstimada||0), f.estado,
  ]);
  appendSheetXLSX(wb, 'Créditos (resumen)', headers,
    rows.length?rows:[['Sin créditos en este período','','','','','','']],
    [null, null, null, NUM_MONEDA, NUM_MONEDA, NUM_MONEDA, null]);
}

function hojaResumenXLSX(wb) {
  const r = R.cache.resumen || {};
  const headers = ['Concepto', `Monto (${sym()})`];
  const rows = [
    ['Ventas totales', Number(r.ventas||0)], ['Compras totales', Number(r.compras||0)],
    ['Total gastos', Number(r.gastos||0)], ['Ganancia bruta', Number(r.gananciaBruta||0)],
    ['Otros ingresos', Number(r.otrosIngresos||0)], ['Otros egresos', Number(r.otrosEgresos||0)],
    ['Ganancia neta', Number(r.gananciaNeta||0)], ['Caja disponible', Number(r.capital||0)],
  ];
  appendSheetXLSX(wb, 'Resumen', headers, rows, [null, NUM_MONEDA]);
}

async function exportarExcel(tipo, clienteId, clienteNombre) {
  if (!window.XLSX) throw new Error('Librería XLSX no disponible');
  const wb = XLSX.utils.book_new();
  const esGeneral = tipo === 'general';

  if (esGeneral) hojaResumenXLSX(wb);
  if (tipo==='ventas'     || esGeneral) hojaVentasXLSX(wb);
  if (tipo==='compras'    || esGeneral) hojaComprasXLSX(wb);
  if (tipo==='clientes'   || esGeneral) hojaClientesXLSX(wb);
  if (tipo==='inventario' || esGeneral) hojaInventarioXLSX(wb);
  if (tipo==='gastos'     || esGeneral) hojaGastosXLSX(wb);
  if (tipo==='creditos')  hojaCreditosXLSX(wb, clienteId, clienteNombre);
  if (esGeneral)          hojaCreditosResumenXLSX(wb);

  const sufijoCliente = tipo === 'creditos' ? `_${slugify(clienteNombre)}` : '';
  XLSX.writeFile(wb, `negocio360_${tipo}${sufijoCliente}_${todayISO()}.xlsx`);
}

function tituloTipo(tipo) {
  const m = { ventas:'Ventas', compras:'Compras', clientes:'Clientes',
    inventario:'Inventario', gastos:'Gastos', creditos:'Créditos', general:'General (Completo)',
    financiero:'Finanzas' };
  return m[tipo] || tipo;
}

/* ============================================================
   API PÚBLICA — para que Dashboard consuma sin recalcular
   ============================================================ */
window.ReportesAPI = {

  async getResumenEjecutivo(userId) {
    // Devuelve los datos ya calculados para el dashboard
    if (!R.userId) R.userId = userId;
    try {
      await Promise.all([fetchVentas(), fetchCompras(), fetchGastos(), fetchClientes(), fetchProductos()]);
      const ventas  = R.cache.ventas;
      const compras = R.cache.compras;
      const gastos  = R.cache.gastos;
      const vRes    = calcVentasResumen(ventas);
      const totalComp = compras.reduce((s,c)=>s+Number(c.total),0);
      const totalGast = gastos.reduce((s,g)=>s+Number(g.monto),0);
      const capital = await fetchCapital();
      const otros   = await fetchOtrosMovimientos();
      const prods   = (R.cache.productos||[]).filter(p=>p.tipo==='producto'&&p.activo);
      const valorInv= prods.reduce((s,p)=>s+(Number(p.stock_actual||0)*Number(p.costo||0)),0);
      return {
        ventas: vRes.total, ventasCount: vRes.count, gananciaEstimada: vRes.ganancia,
        compras: totalComp, gastos: totalGast, capital, valorInventario: valorInv,
        otrosIngresos: otros.otrosIngresos, otrosEgresos: otros.otrosEgresos,
        gananciaNeta: vRes.ganancia - totalGast + otros.otrosIngresos - otros.otrosEgresos,
        ticketPromedio: vRes.ticket,
      };
    } catch(e) { console.error('ReportesAPI.getResumenEjecutivo:', e); return {}; }
  },

  async getCapital() { return fetchCapital(); },

  // Para que el dashboard llame una sola función
  async getKPIsDashboard(userId) {
    return this.getResumenEjecutivo(userId);
  },
};

/* ============================================================
   INIT PRINCIPAL
   ============================================================ */
async function initReportes() {
  // Tema
  applyTheme(localStorage.getItem('n360_theme')||'light');

  // Fecha header
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI',{day:'numeric',month:'long',year:'numeric'});

  // Período info inicial
  actualizarPeriodoInfo();

  try {
    const { data:{user}, error } = await sb.auth.getUser();
    if (error||!user) { window.location.href = 'login.html'; return; }

    R.userId    = user.id;
    R.userEmail = user.email;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent   = user.email?.split('@')[0]||'Usuario';
      document.getElementById('header-avatar').textContent = (user.email||'U')[0].toUpperCase();
    }

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    // Cargar tab inicial (Resumen Ejecutivo)
    await loadEjecutivo();

    // Verificar si hay parámetro en URL para abrir tab específico
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('type');
    if (tabParam) {
      const tabMap = { diario:'ejecutivo', mensual:'ejecutivo', anual:'ejecutivo', comparativo:'financiero' };
      switchTab(tabMap[tabParam]||'ejecutivo');
    }

  } catch(err) {
    console.error('initReportes:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

/* ============================================================
   AUTH LISTENER
   ============================================================ */
sb.auth.onAuthStateChange(event => {
  if (event==='SIGNED_OUT') window.location.href = 'login.html';
});

/* ============================================================
   ARRANQUE
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initReportes();
  if (window.lucide) lucide.createIcons();
});
