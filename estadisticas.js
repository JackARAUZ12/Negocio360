/* ============================================================
   ESTADISTICAS.JS — NEGOCIO360
   Motor de estadísticas e interpretación. Lee los módulos
   financieros ya existentes (ventas, compras, gastos, créditos,
   caja/movimientos_financieros, impuestos, productos, clientes)
   y traduce los números a explicaciones en lenguaje simple.
   NO escribe en ninguna tabla financiera: es 100% de lectura.
   ============================================================ */
'use strict';

/* ============================================================
   SUPABASE
   ============================================================ */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============================================================
   HELPERS COMPARTIDOS (mismos criterios que reportes.js, para
   que "Estadísticas" y "Reportes" nunca muestren números distintos)
   ============================================================ */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO() { return ymd(new Date()); }
function parseFechaSegura(input) {
  if (!input) return null;
  const str = String(input);
  if (str.includes('T')) { const d = new Date(str); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const EST = {
  userId: null,
  moneda: 'C$',
  empresaConfig: {},
  periodo: 'mes',
  charts: {},
  data: {}, // cache cruda de la última carga
};

function sym() { return EST.moneda || 'C$'; }
function fmt(n) {
  const v = parseFloat(n || 0);
  return `${sym()} ${v.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtShort(n) {
  const v = parseFloat(n || 0), s = sym();
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${s}${(v/1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${s}${(v/1_000).toFixed(1)}k`;
  return `${s}${v.toLocaleString('es-NI', { minimumFractionDigits:0, maximumFractionDigits:0 })}`;
}
function fmtPct(n) {
  const v = parseFloat(n || 0);
  return `${v >= 0 ? '' : ''}${v.toFixed(1)}%`;
}

/* ============================================================
   TEMA (idéntico a los demás módulos)
   ============================================================ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('n360_theme', t);
  const sun = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = t === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
  Object.values(EST.charts).forEach(ch => { if (ch) updateChartTheme(ch); });
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
function updateChartTheme(chart) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const ticks = isDark ? '#9090b0' : '#9999b3';
  if (chart.options?.scales) {
    Object.values(chart.options.scales).forEach(s => {
      if (s.grid) s.grid.color = grid;
      if (s.ticks) s.ticks.color = ticks;
    });
    chart.update();
  }
}

/* ============================================================
   SIDEBAR / NAVEGACIÓN (idéntico a los demás módulos)
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
window.addEventListener('resize', () => { if (!isMobileView()) closeMobileSidebar(); });
function navigate(url) { closeMobileSidebar(); window.location.href = url; }

/* ============================================================
   TOAST
   ============================================================ */
let _toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ============================================================
   EMPRESA / PERFIL (igual criterio que reportes.js)
   ============================================================ */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    if (data) {
      EST.empresaConfig = data;
      EST.moneda = data.moneda || 'C$';
      const biz = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = biz;
      if (data.color_principal) {
        document.documentElement.style.setProperty('--accent', data.color_principal);
        document.documentElement.style.setProperty('--accent-soft', data.color_principal + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_principal);
      }
      if (data.logo_principal_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_principal_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    return data;
  } catch { return null; }
}
function renderUserInfo(user, email) {
  if (!user) return;
  const nombre = user.nombre || email?.split('@')[0] || 'Usuario';
  const apellido = user.apellido || '';
  const biz = EST.empresaConfig?.nombre_comercial || 'Mi negocio';
  const plan = user.plan || 'Gratuito';
  const initials = ((nombre[0] || '') + (apellido[0] || '')).toUpperCase();
  document.getElementById('header-name').textContent = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent = biz;
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sb.from('administradores').select('email,activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const el = document.getElementById('nav-admin'); if (el) el.style.display = 'flex'; }
  } catch { /* silencioso */ }
}

/* ============================================================
   PERÍODO DE ANÁLISIS
   ============================================================ */
function rangoPeriodo() {
  const hoy = new Date();
  const to = todayISO();
  let desde;
  if (EST.periodo === 'mes') {
    desde = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
  } else if (EST.periodo === 'trimestre') {
    const d = new Date(hoy); d.setMonth(d.getMonth() - 3);
    desde = ymd(d);
  } else { // anio
    desde = `${hoy.getFullYear()}-01-01`;
  }
  return { from: desde, to };
}
function rangoPeriodoAnterior() {
  const hoy = new Date();

  // FIX RAREZA: "mes" y "año" son períodos anclados al calendario (van del
  // día 1 hasta hoy), así que su "período anterior" debe ser el mes/año
  // calendario anterior COMPLETO — no una ventana de la misma cantidad de
  // días. Antes, el día 1 de cada mes, rangoPeriodo() daba un rango de un
  // solo día (ej: 1 ago – 1 ago), y esta función restaba esa misma cantidad
  // de días (1) hacia atrás, comparando "hoy" contra "ayer" en vez de
  // "este mes" contra "el mes pasado completo". Esto hacía que las
  // variaciones (%) mostradas en Estadísticas el día 1 de cada mes fueran
  // erráticas y engañosas.
  if (EST.periodo === 'mes') {
    const y = hoy.getFullYear(), m = hoy.getMonth(); // m es 0-indexado
    const desdeAnt = new Date(y, m - 1, 1);
    const hastaAnt = new Date(y, m, 0); // día 0 del mes actual = último día del mes anterior
    return { from: ymd(desdeAnt), to: ymd(hastaAnt) };
  }
  if (EST.periodo === 'anio') {
    const y = hoy.getFullYear();
    return { from: `${y-1}-01-01`, to: `${y-1}-12-31` };
  }

  // "Trimestre" es una ventana móvil (últimos 3 meses hasta hoy), no un
  // período anclado al calendario — ahí sí tiene sentido comparar contra
  // la misma cantidad de días inmediatamente anteriores.
  const { from, to } = rangoPeriodo();
  const dFrom = new Date(from + 'T12:00:00'), dTo = new Date(to + 'T12:00:00');
  const diasMs = dTo - dFrom;
  const nuevoTo = new Date(dFrom.getTime() - 24*60*60*1000);
  const nuevoFrom = new Date(nuevoTo.getTime() - diasMs);
  return { from: ymd(nuevoFrom), to: ymd(nuevoTo) };
}
function actualizarPeriodoInfo() {
  const { from, to } = rangoPeriodo();
  const el = document.getElementById('periodo-info');
  if (el) el.textContent = `${from} — ${to}`;
  document.querySelectorAll('.periodo-btn').forEach(b => b.classList.toggle('active', b.dataset.periodo === EST.periodo));
}

/* ============================================================
   CARGA DE DATOS (lectura de todos los módulos financieros)
   ============================================================ */
async function cargarTodo() {
  const { from, to } = rangoPeriodo();
  const anterior = rangoPeriodoAnterior();
  const uid = EST.userId;

  const [
    ventas, ventasAnt,
    compras, gastos, gastosAnt,
    creditos, creditosCuotas,
    movFin, movFinAnt,
    capital, saldoReciente, productos, clientes,
    movImpuestos,
  ] = await Promise.all([
    sb.from('ventas').select('*').eq('auth_user_id', uid).eq('estado', 'completada').gte('fecha', from).lte('fecha', to + 'T23:59:59'),
    // FIX: se agregan impuesto y costo_total del período anterior — antes
    // solo se traía "total" (con IVA incluido), así que la comparación de
    // tendencia de ingresos no era manzanas-con-manzanas frente al período
    // actual (que sí descuenta el IVA más abajo).
    sb.from('ventas').select('total,impuesto,costo_total').eq('auth_user_id', uid).eq('estado', 'completada').gte('fecha', anterior.from).lte('fecha', anterior.to + 'T23:59:59'),
    sb.from('compras').select('*').eq('auth_user_id', uid).eq('estado', 'completada').gte('fecha', from).lte('fecha', to),
    sb.from('gastos').select('*').eq('auth_user_id', uid).eq('estado', 'activo').gte('fecha', from).lte('fecha', to),
    sb.from('gastos').select('monto').eq('auth_user_id', uid).eq('estado', 'activo').gte('fecha', anterior.from).lte('fecha', anterior.to),
    sb.from('creditos').select('*').eq('auth_user_id', uid),
    sb.from('creditos_cuotas').select('*, creditos!inner(cliente_id, tipo, numero_credito)').eq('auth_user_id', uid).in('estado', ['vencida', 'pendiente', 'parcial']),
    sb.from('movimientos_financieros').select('*').eq('auth_user_id', uid).eq('estado', 'completado').gte('fecha', from).lte('fecha', to).order('fecha', { ascending: true }),
    sb.from('movimientos_financieros').select('tipo_flujo, monto').eq('auth_user_id', uid).eq('estado', 'completado').gte('fecha', anterior.from).lte('fecha', anterior.to),
    sb.from('capital_negocio').select('*').eq('auth_user_id', uid).eq('is_current', true).maybeSingle(),
    // FIX: saldo de caja REAL más reciente — igual criterio que Reportes y
    // el Dashboard. NO se limita al período de análisis seleccionado arriba,
    // porque el saldo de caja "ahora mismo" no depende de qué rango de
    // fechas estés mirando (antes sí dependía, y podía mostrar un saldo
    // viejo o en 0 si no había movimientos dentro del período elegido).
    sb.from('movimientos_financieros').select('saldo_resultante').eq('auth_user_id', uid).eq('estado', 'completado').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('productos').select('*').eq('auth_user_id', uid).eq('activo', true),
    sb.from('clientes').select('*').eq('auth_user_id', uid).eq('activo', true),
    sb.from('movimientos_impuestos').select('*').eq('auth_user_id', uid).gte('fecha', from).lte('fecha', to),
  ]);

  // FIX: los detalles de venta se traen a partir de los venta_id que ya
  // quedaron filtrados por "fecha" (arriba) — antes se filtraban aparte por
  // "created_at", lo que podía traer un conjunto de líneas distinto al de
  // las ventas del período (ganancia y rankings por producto/categoría
  // quedaban descuadrados). Ahora ambos conjuntos siempre coinciden.
  const ventaIds = (ventas.data || []).map(v => v.id);
  let ventaDetalles = [];
  if (ventaIds.length) {
    const { data } = await sb.from('venta_detalles').select('*').eq('auth_user_id', uid).in('venta_id', ventaIds);
    ventaDetalles = data || [];
  }

  // Nombres de clientes para cruzar con creditos_cuotas.creditos.cliente_id
  const clienteIdsCred = [...new Set((creditosCuotas.data || []).map(c => c.creditos?.cliente_id).filter(Boolean))];
  let clientesMap = {};
  if (clienteIdsCred.length) {
    const { data: cli } = await sb.from('clientes').select('id,nombre,apellido').in('id', clienteIdsCred);
    (cli || []).forEach(c => { clientesMap[c.id] = `${c.nombre || ''} ${c.apellido || ''}`.trim(); });
  }

  // FIX: mapa producto_id → categoria para el ranking por categoría.
  // venta_detalles NO guarda la categoría del producto (nunca la guardó),
  // así que antes ese ranking siempre agrupaba todo en "Sin categoría".
  // Se cruza con el catálogo de productos ya cargado.
  const categoriaPorProducto = {};
  (productos.data || []).forEach(p => { if (p.categoria) categoriaPorProducto[p.id] = p.categoria; });

  EST.data = {
    ventas: ventas.data || [],
    ventasAnt: ventasAnt.data || [],
    ventaDetalles,
    compras: compras.data || [],
    gastos: gastos.data || [],
    gastosAnt: gastosAnt.data || [],
    creditos: creditos.data || [],
    creditosCuotas: creditosCuotas.data || [],
    clientesMap,
    movFin: movFin.data || [],
    movFinAnt: movFinAnt.data || [],
    capital: capital.data || null,
    saldoActualReal: saldoReciente.data ? Number(saldoReciente.data.saldo_resultante) : null,
    productos: productos.data || [],
    categoriaPorProducto,
    clientes: clientes.data || [],
    movImpuestos: movImpuestos.data || [],
  };
}

// Saldo de caja real a mostrar: prioriza el movimiento más reciente de
// movimientos_financieros (sin filtrar por período) y, si no hay ninguno
// aún, cae al registro de capital_negocio — mismo orden de prioridad que
// usan Reportes y el Dashboard, para que los tres módulos siempre muestren
// el mismo número.
function saldoCajaActual(d) {
  if (d.saldoActualReal !== null && d.saldoActualReal !== undefined) return d.saldoActualReal;
  return d.capital?.monto ? parseFloat(d.capital.monto) : 0;
}

/* ============================================================
   CÁLCULOS: SALUD FINANCIERA
   ============================================================ */
function calcularSalud() {
  const d = EST.data;

  // FIX IVA: "total" de una venta incluye el IVA cobrado al cliente, que
  // no es ingreso del negocio (se recauda para el fisco, se contabiliza
  // aparte en Impuestos) — se resta, mismo criterio que ya corrigió
  // Reportes. Antes esta pantalla inflaba los ingresos con el IVA incluido.
  const ingresos = d.ventas.reduce((s, v) => s + (parseFloat(v.total || 0) - parseFloat(v.impuesto || 0)), 0);
  // FIX MARGEN: el costo de lo vendido se toma de ventas.costo_total (el
  // costo real de los productos/servicios efectivamente vendidos en el
  // período). Antes se sumaban los gastos operativos MÁS las compras de
  // inventario — pero una compra no es necesariamente el costo de lo que
  // se vendió en este período (puede ser stock para vender después), así
  // que mezclarla aquí inflaba o desinflaba el margen sin relación real
  // con las ventas del período. Se usa el mismo criterio de "Ganancia
  // Neta" que ya usa Reportes.
  const costoVentas = d.ventas.reduce((s, v) => s + parseFloat(v.costo_total || 0), 0);
  const gastosOp = d.gastos.reduce((s, g) => s + parseFloat(g.monto || 0), 0);

  // FIX MARGEN: se incluyen también "otros ingresos/egresos de caja"
  // (movimientos manuales sin referencia a venta/compra/gasto), igual
  // criterio que usa Dashboard para su margen neto — así ambas pantallas
  // siempre coinciden en el mismo número.
  const otrosIngresos = d.movFin
    .filter(m => m.tipo_flujo === 'INGRESO' && !m.referencia_tipo)
    .reduce((s, m) => s + parseFloat(m.monto || 0), 0);
  const otrosEgresosCaja = d.movFin
    .filter(m => m.tipo_flujo === 'EGRESO' && !m.referencia_tipo)
    .reduce((s, m) => s + parseFloat(m.monto || 0), 0);

  const egresos  = costoVentas + gastosOp + otrosEgresosCaja - otrosIngresos;

  const ingresosAnt   = d.ventasAnt.reduce((s, v) => s + (parseFloat(v.total || 0) - parseFloat(v.impuesto || 0)), 0);
  const costoVentasAnt = d.ventasAnt.reduce((s, v) => s + parseFloat(v.costo_total || 0), 0);
  const egresosAnt    = costoVentasAnt + d.gastosAnt.reduce((s, g) => s + parseFloat(g.monto || 0), 0);

  const margen = ingresos > 0 ? ((ingresos - egresos) / ingresos) * 100 : 0;
  const tendenciaIngresos = ingresosAnt > 0 ? ((ingresos - ingresosAnt) / ingresosAnt) * 100 : (ingresos > 0 ? 100 : 0);
  const tendenciaEgresos  = egresosAnt > 0 ? ((egresos - egresosAnt) / egresosAnt) * 100 : 0;

  const cuotasVencidas = d.creditosCuotas.filter(c => c.estado === 'vencida');
  const cuotasTotal = d.creditosCuotas.length || 1;
  const morosidad = (cuotasVencidas.length / cuotasTotal) * 100;

  // FIX: saldo de caja real, no limitado al período de análisis (ver
  // saldoCajaActual arriba).
  const saldoCaja = saldoCajaActual(d);

  // Puntaje 0-100: 40% margen, 25% tendencia de ingresos, 20% morosidad (invertida), 15% liquidez
  let score = 50;
  score += Math.max(-25, Math.min(25, margen * 0.6));
  score += Math.max(-15, Math.min(15, tendenciaIngresos * 0.3));
  score -= Math.max(0, Math.min(20, morosidad * 0.5));
  score += saldoCaja > 0 ? 10 : (saldoCaja < 0 ? -10 : 0);
  score = Math.max(0, Math.min(100, Math.round(score)));

  let veredicto = 'regular', veredictoTexto = 'Estable, con espacio para mejorar';
  if (score >= 70) { veredicto = 'buena'; veredictoTexto = 'Tu negocio está en buena forma'; }
  else if (score < 40) { veredicto = 'mala'; veredictoTexto = 'Necesita atención pronto'; }

  return { ingresos, egresos, margen, tendenciaIngresos, tendenciaEgresos, morosidad, saldoCaja, score, veredicto, veredictoTexto, cuotasVencidas };
}

/* ============================================================
   RENDER: SALUD FINANCIERA
   ============================================================ */
function renderSalud() {
  const s = calcularSalud();
  const wrap = document.getElementById('salud-score-wrap');
  const circunf = 2 * Math.PI * 56;
  const offset = circunf - (s.score / 100) * circunf;
  const color = s.score >= 70 ? 'var(--success)' : (s.score < 40 ? 'var(--danger)' : 'var(--warning)');

  wrap.innerHTML = `
    <div class="salud-score-ring">
      <svg viewBox="0 0 132 132">
        <circle class="salud-score-track" cx="66" cy="66" r="56"></circle>
        <circle class="salud-score-fill" cx="66" cy="66" r="56"
          stroke="${color}" stroke-dasharray="${circunf}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="salud-score-label">
        <div class="salud-score-num">${s.score}</div>
        <div class="salud-score-txt">/ 100</div>
      </div>
    </div>
    <div class="salud-detalle">
      <div class="salud-veredicto ${s.veredicto}">${esc(s.veredictoTexto)}</div>
      <div class="salud-factores">
        <div class="salud-factor"><span class="dot ${s.margen >= 15 ? 'dot-ok' : (s.margen >= 0 ? 'dot-warn' : 'dot-bad')}"></span>
          Margen neto del período: <strong style="margin-left:4px">${fmtPct(s.margen)}</strong></div>
        <div class="salud-factor"><span class="dot ${s.tendenciaIngresos >= 0 ? 'dot-ok' : 'dot-bad'}"></span>
          Ingresos vs. período anterior: <strong style="margin-left:4px">${s.tendenciaIngresos >= 0 ? '+' : ''}${fmtPct(s.tendenciaIngresos)}</strong></div>
        <div class="salud-factor"><span class="dot ${s.morosidad <= 10 ? 'dot-ok' : (s.morosidad <= 30 ? 'dot-warn' : 'dot-bad')}"></span>
          Cuotas de crédito vencidas: <strong style="margin-left:4px">${s.cuotasVencidas.length}</strong></div>
        <div class="salud-factor"><span class="dot ${s.saldoCaja >= 0 ? 'dot-ok' : 'dot-bad'}"></span>
          Capital / caja actual: <strong style="margin-left:4px">${fmt(s.saldoCaja)}</strong></div>
      </div>
    </div>
  `;

  renderChartIngresosEgresos();
  renderInsightsSalud(s);
}

function renderInsightsSalud(s) {
  const el = document.getElementById('insights-salud');
  const items = [];

  if (s.margen >= 20) {
    items.push({ icon: '💚', bg: 'var(--success-soft)', title: 'Tu margen es saludable', text: `Por cada ${sym()} 100 que entra, te queda cerca de ${sym()} ${s.margen.toFixed(0)} de ganancia después de costos y gastos. Es un buen colchón para invertir o ahorrar.` });
  } else if (s.margen >= 0) {
    items.push({ icon: '🟡', bg: 'var(--warning-soft)', title: 'Margen ajustado', text: `Tu ganancia neta ronda el ${s.margen.toFixed(1)}% de lo que vendes. Cualquier gasto inesperado puede dejarte sin excedente. Vale la pena revisar tus gastos operativos.` });
  } else {
    items.push({ icon: '🔴', bg: 'var(--danger-soft)', title: 'Estás gastando más de lo que ganas', text: `En este período tus egresos superaron tus ingresos por ${fmt(Math.abs(s.ingresos - s.egresos))}. Si esto se repite el próximo período, revisa gastos que puedas reducir o pausar.` });
  }

  if (s.tendenciaIngresos > 5) {
    items.push({ icon: '📈', bg: 'var(--accent-soft)', title: 'Tus ventas están creciendo', text: `Vendiste ${fmtPct(s.tendenciaIngresos)} más que en el período anterior. Si identificas qué producto o canal impulsó esto, puedes repetir la estrategia.` });
  } else if (s.tendenciaIngresos < -5) {
    items.push({ icon: '📉', bg: 'var(--danger-soft)', title: 'Tus ventas bajaron respecto al período anterior', text: `Cayeron ${fmtPct(Math.abs(s.tendenciaIngresos))}. Puede ser estacional, pero conviene revisar si algún cliente frecuente dejó de comprar o si hubo menos tráfico.` });
  }

  if (s.cuotasVencidas.length > 0) {
    items.push({ icon: '⏰', bg: 'var(--warning-soft)', title: `Tienes ${s.cuotasVencidas.length} cuota(s) de crédito vencidas`, text: `Esto representa dinero que ya deberías haber cobrado. Ir a la pestaña "Clientes & Cobranza" te muestra a quién contactar primero.` });
  }

  if (!items.length) items.push({ icon: 'ℹ️', bg: 'var(--accent-soft)', title: 'Aún no hay suficiente información', text: 'Registra más ventas, gastos y compras en este período para obtener interpretaciones más precisas.' });

  el.innerHTML = items.map(i => `
    <div class="insight-item">
      <div class="insight-icon" style="background:${i.bg}">${i.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${esc(i.title)}</div>
        <div class="insight-text">${esc(i.text)}</div>
      </div>
    </div>
  `).join('');
}

function renderChartIngresosEgresos() {
  const d = EST.data;
  const porDia = {};
  d.movFin.forEach(m => {
    const dia = m.fecha;
    if (!porDia[dia]) porDia[dia] = { ingreso: 0, egreso: 0 };
    if (m.tipo_flujo === 'INGRESO') porDia[dia].ingreso += parseFloat(m.monto || 0);
    else porDia[dia].egreso += parseFloat(m.monto || 0);
  });
  const dias = Object.keys(porDia).sort();
  const labels = dias.map(d => { const dt = parseFechaSegura(d); return dt ? dt.toLocaleDateString('es-NI', { day: '2-digit', month: 'short' }) : d; });
  const ingresos = dias.map(d => porDia[d].ingreso);
  const egresos = dias.map(d => porDia[d].egreso);

  const ctx = document.getElementById('chart-ingresos-egresos');
  if (!ctx) return;
  if (EST.charts.ingresosEgresos) EST.charts.ingresosEgresos.destroy();

  if (!dias.length) {
    return; // sin datos: se deja el canvas vacío, no rompe nada
  }

  EST.charts.ingresosEgresos = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: ingresos, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', fill: true, tension: 0.35 },
        { label: 'Egresos', data: egresos, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', fill: true, tension: 0.35 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } },
    },
  });
}

/* ============================================================
   CÁLCULOS + RENDER: RENTABILIDAD
   ============================================================ */
function renderRentabilidad() {
  const d = EST.data;
  // FIX: ingresos y costo se calculan a partir de la tabla "ventas" (igual
  // que Reportes): "total" incluye IVA, así que se resta "impuesto" para
  // el ingreso real.
  const ingresos = d.ventas.reduce((s, v) => s + (parseFloat(v.total || 0) - parseFloat(v.impuesto || 0)), 0);
  const costoTotal = d.ventas.reduce((s, v) => s + parseFloat(v.costo_total || 0), 0);
  const gananciaBruta = ingresos - costoTotal;

  // FIX MARGEN: "Margen promedio" mostraba margen BRUTO (ingresos - costo
  // de lo vendido), sin restar nunca los gastos operativos — por eso daba
  // 100% siempre que costo_total de las ventas fuera 0 (por ejemplo, si
  // los productos no tienen costo registrado). Ahora se calcula como
  // margen NETO con el mismo criterio que ya usan Dashboard y Reportes:
  // ganancia bruta − gastos operativos + otros ingresos de caja − otros
  // egresos de caja, todo sobre los ingresos del período.
  const gastosOp = d.gastos.reduce((s, g) => s + parseFloat(g.monto || 0), 0);
  const otrosIngresos = d.movFin
    .filter(m => m.tipo_flujo === 'INGRESO' && !m.referencia_tipo)
    .reduce((s, m) => s + parseFloat(m.monto || 0), 0);
  const otrosEgresos = d.movFin
    .filter(m => m.tipo_flujo === 'EGRESO' && !m.referencia_tipo)
    .reduce((s, m) => s + parseFloat(m.monto || 0), 0);

  const gananciaNeta  = gananciaBruta - gastosOp + otrosIngresos - otrosEgresos;
  const margenGlobal  = ingresos > 0 ? (gananciaNeta / ingresos) * 100 : 0;
  const ticketPromedio = d.ventas.length ? ingresos / d.ventas.length : 0;

  document.getElementById('kpis-rentabilidad').innerHTML = `
    ${kpiCard('💰', 'var(--success-soft)', 'var(--success)', 'Ganancia neta del período', fmt(gananciaNeta))}
    ${kpiCard('📊', 'var(--accent-soft)', 'var(--accent)', 'Margen neto', fmtPct(margenGlobal))}
    ${kpiCard('🧾', 'var(--warning-soft)', 'var(--warning)', 'Ticket promedio', fmt(ticketPromedio))}
    ${kpiCard('📦', 'var(--accent-4-soft)', 'var(--accent-4)', 'Costo de lo vendido', fmt(costoTotal))}
  `;

  // Ranking por producto
  const porProducto = {};
  d.ventaDetalles.forEach(i => {
    const key = i.producto_nombre || 'Sin nombre';
    if (!porProducto[key]) porProducto[key] = { ganancia: 0, subtotal: 0 };
    porProducto[key].ganancia += parseFloat(i.ganancia || 0);
    porProducto[key].subtotal += parseFloat(i.subtotal || 0);
  });
  const rankingProductos = Object.entries(porProducto)
    .map(([nombre, v]) => ({ nombre, ...v }))
    .sort((a, b) => b.ganancia - a.ganancia)
    .slice(0, 8);
  renderRankingBars('ranking-productos', rankingProductos, 'ganancia');

  // Ranking por categoría (margen %)
  // FIX: venta_detalles no guarda la categoría del producto — se cruza con
  // d.categoriaPorProducto (armado en cargarTodo desde el catálogo). Antes
  // se leía "i.categoria", un campo que nunca existió en esta tabla, así
  // que todo caía siempre en "Sin categoría".
  const porCategoria = {};
  d.ventaDetalles.forEach(i => {
    const key = d.categoriaPorProducto[i.producto_id] || 'Sin categoría';
    if (!porCategoria[key]) porCategoria[key] = { ganancia: 0, subtotal: 0 };
    porCategoria[key].ganancia += parseFloat(i.ganancia || 0);
    porCategoria[key].subtotal += parseFloat(i.subtotal || 0);
  });
  const rankingCategorias = Object.entries(porCategoria)
    .map(([nombre, v]) => ({ nombre, ...v, margen: v.subtotal > 0 ? (v.ganancia / v.subtotal) * 100 : 0 }))
    .sort((a, b) => b.margen - a.margen)
    .slice(0, 8);
  renderRankingBars('ranking-categorias', rankingCategorias, 'margen', true);

  renderInsightsRentabilidad(rankingProductos, rankingCategorias, margenGlobal);
}

function renderRankingBars(containerId, items, valueKey, esPorcentaje = false) {
  const el = document.getElementById(containerId);
  if (!items.length) { el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p>Sin ventas registradas en este período.</p></div>`; return; }
  const max = Math.max(...items.map(i => i[valueKey]), 1);
  el.innerHTML = items.map(i => {
    const pct = Math.max(4, Math.min(100, (i[valueKey] / max) * 100));
    const valorTxt = esPorcentaje ? fmtPct(i[valueKey]) : fmtShort(i[valueKey]);
    return `
      <div class="ranking-bar-wrap">
        <div class="ranking-bar-name" title="${esc(i.nombre)}">${esc(i.nombre)}</div>
        <div class="ranking-bar-track"><div class="ranking-bar-fill" style="width:${pct}%"></div></div>
        <div class="ranking-bar-val">${valorTxt}</div>
      </div>
    `;
  }).join('');
}

function renderInsightsRentabilidad(productos, categorias, margenGlobal) {
  const el = document.getElementById('insights-rentabilidad');
  const items = [];

  if (productos.length) {
    const top = productos[0];
    items.push({ icon: '🏆', bg: 'var(--success-soft)', title: `"${top.nombre}" es tu producto más rentable`, text: `Generó ${fmt(top.ganancia)} de ganancia en este período. Mantener buen stock y visibilidad de este producto puede impulsar tus resultados.` });
    if (productos.length > 1) {
      const peor = productos[productos.length - 1];
      if (peor.ganancia < top.ganancia * 0.1) {
        items.push({ icon: '🔎', bg: 'var(--warning-soft)', title: `"${peor.nombre}" casi no está generando ganancia`, text: `Comparado con tus mejores productos, este aporta muy poco. Considera revisar su precio, costo o si vale la pena seguir ofreciéndolo.` });
      }
    }
  }

  if (categorias.length) {
    const mejor = categorias[0];
    items.push({ icon: '📂', bg: 'var(--accent-soft)', title: `La categoría "${mejor.nombre}" tiene el mejor margen`, text: `Un margen de ${fmtPct(mejor.margen)} sobre lo vendido. Si puedes, prioriza compras e inventario hacia esta categoría.` });
  }

  if (margenGlobal < 10 && productos.length) {
    items.push({ icon: '⚠️', bg: 'var(--danger-soft)', title: 'Tu margen general es bajo', text: `En promedio te queda ${fmtPct(margenGlobal)} de cada venta. Revisa si tus precios cubren bien los costos, o si hay descuentos que se están dando de más.` });
  }

  if (!items.length) items.push({ icon: 'ℹ️', bg: 'var(--accent-soft)', title: 'Sin ventas suficientes para interpretar', text: 'Cuando registres ventas con productos, aquí verás cuáles te dejan más ganancia.' });

  el.innerHTML = items.map(i => `
    <div class="insight-item">
      <div class="insight-icon" style="background:${i.bg}">${i.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${esc(i.title)}</div>
        <div class="insight-text">${esc(i.text)}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   CÁLCULOS + RENDER: CLIENTES & COBRANZA
   ============================================================ */
function renderClientes() {
  const d = EST.data;
  const totalClientes = d.clientes.length;
  const clientesRecurrentes = d.clientes.filter(c => c.tipo_cliente === 'recurrente').length;
  const saldoPendienteTotal = d.clientes.reduce((s, c) => s + parseFloat(c.saldo_pendiente || 0), 0);
  const cuotasVencidas = d.creditosCuotas.filter(c => c.estado === 'vencida');

  document.getElementById('kpis-clientes').innerHTML = `
    ${kpiCard('👥', 'var(--accent-soft)', 'var(--accent)', 'Clientes activos', totalClientes)}
    ${kpiCard('🔁', 'var(--accent-4-soft)', 'var(--accent-4)', 'Clientes recurrentes', clientesRecurrentes)}
    ${kpiCard('⏰', 'var(--warning-soft)', 'var(--warning)', 'Cuotas vencidas', cuotasVencidas.length)}
    ${kpiCard('💳', 'var(--danger-soft)', 'var(--danger)', 'Saldo pendiente (recurrentes)', fmt(saldoPendienteTotal))}
  `;

  // Agrupar cuotas vencidas por cliente
  const porCliente = {};
  cuotasVencidas.forEach(c => {
    const clienteId = c.creditos?.cliente_id;
    const nombre = d.clientesMap[clienteId] || 'Cliente sin nombre';
    if (!porCliente[clienteId]) porCliente[clienteId] = { nombre, cuotas: 0, saldo: 0 };
    porCliente[clienteId].cuotas += 1;
    porCliente[clienteId].saldo += parseFloat(c.saldo || 0);
  });
  const filas = Object.values(porCliente).sort((a, b) => b.saldo - a.saldo);

  const tbody = document.querySelector('#tabla-mora tbody');
  if (!filas.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">✅</div><p>No tienes clientes con cuotas vencidas. ¡Buen trabajo cobrando a tiempo!</p></div></td></tr>`;
  } else {
    tbody.innerHTML = filas.map(f => {
      const riesgo = f.cuotas >= 3 ? { label: 'Alto', cls: 'badge-danger' } : (f.cuotas === 2 ? { label: 'Medio', cls: 'badge-warning' } : { label: 'Bajo', cls: 'badge-accent' });
      return `<tr>
        <td>${esc(f.nombre)}</td>
        <td class="th-right td-mono">${f.cuotas}</td>
        <td class="th-right td-mono">${fmt(f.saldo)}</td>
        <td><span class="badge ${riesgo.cls}">${riesgo.label}</span></td>
      </tr>`;
    }).join('');
  }

  renderInsightsClientes(filas, saldoPendienteTotal, totalClientes, clientesRecurrentes);
}

function renderInsightsClientes(filasMora, saldoPendienteTotal, totalClientes, clientesRecurrentes) {
  const el = document.getElementById('insights-clientes');
  const items = [];

  if (filasMora.length > 0) {
    const totalEnRiesgo = filasMora.reduce((s, f) => s + f.saldo, 0);
    items.push({ icon: '📞', bg: 'var(--warning-soft)', title: `Tienes ${fmt(totalEnRiesgo)} en cuotas vencidas por cobrar`, text: `Repartido entre ${filasMora.length} cliente(s). Contactar primero a quienes tengan más cuotas vencidas suele recuperar el dinero más rápido.` });
  } else {
    items.push({ icon: '✅', bg: 'var(--success-soft)', title: 'Tu cobranza está al día', text: 'No tienes cuotas de crédito vencidas en este momento. Sigue dando seguimiento para mantenerlo así.' });
  }

  if (totalClientes > 0 && clientesRecurrentes / totalClientes > 0.4) {
    items.push({ icon: '💡', bg: 'var(--accent-soft)', title: 'Buena parte de tus clientes son recurrentes', text: `El ${((clientesRecurrentes/totalClientes)*100).toFixed(0)}% de tus clientes activos son recurrentes, lo que te da ingresos más predecibles cada período.` });
  }

  if (saldoPendienteTotal > 0) {
    items.push({ icon: '🧾', bg: 'var(--warning-soft)', title: 'Hay saldo pendiente de clientes recurrentes', text: `Suman ${fmt(saldoPendienteTotal)} en pagos parciales sin completar. Revisa el módulo de Clientes para ver el detalle por persona.` });
  }

  el.innerHTML = items.map(i => `
    <div class="insight-item">
      <div class="insight-icon" style="background:${i.bg}">${i.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${esc(i.title)}</div>
        <div class="insight-text">${esc(i.text)}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   CÁLCULOS + RENDER: FLUJO DE CAJA
   ============================================================ */
function renderFlujo() {
  const d = EST.data;
  const ingresos = d.movFin.filter(m => m.tipo_flujo === 'INGRESO').reduce((s, m) => s + parseFloat(m.monto || 0), 0);
  const egresos = d.movFin.filter(m => m.tipo_flujo === 'EGRESO').reduce((s, m) => s + parseFloat(m.monto || 0), 0);
  const neto = ingresos - egresos;

  const dias = Math.max(1, diasEnRango());
  const promedioDiario = neto / dias;
  // FIX: saldo de caja real (ver saldoCajaActual), no limitado al período
  // de análisis seleccionado.
  const saldoActual = saldoCajaActual(d);
  const proyeccion30 = saldoActual + (promedioDiario * 30);

  document.getElementById('kpis-flujo').innerHTML = `
    ${kpiCard('💵', 'var(--success-soft)', 'var(--success)', 'Saldo actual', fmt(saldoActual))}
    ${kpiCard(neto >= 0 ? '📈' : '📉', neto >= 0 ? 'var(--success-soft)' : 'var(--danger-soft)', neto >= 0 ? 'var(--success)' : 'var(--danger)', 'Flujo neto del período', fmt(neto))}
    ${kpiCard('🔮', 'var(--accent-soft)', 'var(--accent)', 'Proyección a 30 días', fmt(proyeccion30))}
  `;

  renderChartProyeccion(saldoActual, promedioDiario);
  renderInsightsFlujo(neto, promedioDiario, proyeccion30, saldoActual);
}

function diasEnRango() {
  const { from, to } = rangoPeriodo();
  const dFrom = new Date(from + 'T12:00:00'), dTo = new Date(to + 'T12:00:00');
  return Math.max(1, Math.round((dTo - dFrom) / (24*60*60*1000)) + 1);
}

function renderChartProyeccion(saldoActual, promedioDiario) {
  const ctx = document.getElementById('chart-proyeccion');
  if (!ctx) return;
  if (EST.charts.proyeccion) EST.charts.proyeccion.destroy();

  const labels = [];
  const valores = [];
  let saldo = saldoActual;
  const hoy = new Date();
  for (let i = 0; i <= 30; i += 5) {
    const d = new Date(hoy); d.setDate(d.getDate() + i);
    labels.push(d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short' }));
    valores.push(saldo + promedioDiario * i);
  }

  EST.charts.proyeccion = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Saldo proyectado', data: valores, borderColor: '#5a5af4', backgroundColor: 'rgba(90,90,244,0.08)', fill: true, tension: 0.3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } },
    },
  });
}

function renderInsightsFlujo(neto, promedioDiario, proyeccion30, saldoActual) {
  const el = document.getElementById('insights-flujo');
  const items = [];

  if (promedioDiario > 0) {
    items.push({ icon: '📈', bg: 'var(--success-soft)', title: 'Tu caja crece día a día', text: `En promedio estás generando ${fmt(promedioDiario)} netos por día. Si se mantiene el ritmo, en 30 días tu saldo rondaría ${fmt(proyeccion30)}.` });
  } else if (promedioDiario < 0) {
    items.push({ icon: '📉', bg: 'var(--danger-soft)', title: 'Tu caja se está reduciendo', text: `Estás perdiendo cerca de ${fmt(Math.abs(promedioDiario))} netos por día. Si continúa así, en 30 días tu saldo proyectado sería ${fmt(proyeccion30)}. Vale la pena revisar gastos o impulsar ventas.` });
  } else {
    items.push({ icon: 'ℹ️', bg: 'var(--accent-soft)', title: 'Tu caja se mantiene estable', text: 'No se detecta un crecimiento ni una caída significativa en el período analizado.' });
  }

  if (proyeccion30 < 0) {
    items.push({ icon: '🚨', bg: 'var(--danger-soft)', title: 'Riesgo de quedarte sin saldo', text: `Con el ritmo actual, tu caja podría volverse negativa en los próximos 30 días. Considera frenar gastos no esenciales o acelerar cobros pendientes.` });
  }

  el.innerHTML = items.map(i => `
    <div class="insight-item">
      <div class="insight-icon" style="background:${i.bg}">${i.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${esc(i.title)}</div>
        <div class="insight-text">${esc(i.text)}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   ALERTAS INTELIGENTES
   ============================================================ */
function renderAlertas() {
  const d = EST.data;
  const alertas = [];

  // Stock bajo
  d.productos.filter(p => p.tipo === 'producto' && parseFloat(p.stock_actual || 0) <= parseFloat(p.stock_minimo || 0) && parseFloat(p.stock_minimo || 0) > 0)
    .forEach(p => alertas.push({ tag: 'warn', tagText: 'STOCK BAJO', icon: '📦', bg: 'var(--warning-soft)', title: p.nombre, text: `Quedan ${p.stock_actual} unidades (mínimo configurado: ${p.stock_minimo}).` }));

  // Cuotas vencidas
  d.creditosCuotas.filter(c => c.estado === 'vencida').forEach(c => {
    const nombre = d.clientesMap[c.creditos?.cliente_id] || 'Cliente';
    alertas.push({ tag: '', tagText: 'CRÉDITO VENCIDO', icon: '⏰', bg: 'var(--danger-soft)', title: `Cuota #${c.numero} vencida — ${nombre}`, text: `Monto pendiente: ${fmt(c.saldo)}. Venció el ${c.fecha_vencimiento}.` });
  });

  // Clientes con saldo pendiente alto
  d.clientes.filter(c => parseFloat(c.saldo_pendiente || 0) > 0)
    .sort((a, b) => parseFloat(b.saldo_pendiente) - parseFloat(a.saldo_pendiente))
    .slice(0, 5)
    .forEach(c => alertas.push({ tag: 'info', tagText: 'SALDO PENDIENTE', icon: '💳', bg: 'var(--accent-soft)', title: `${c.nombre} ${c.apellido || ''}`.trim(), text: `Debe ${fmt(c.saldo_pendiente)} de su período actual.` }));

  const el = document.getElementById('alertas-inteligentes');
  if (!alertas.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎉</div><p>No hay alertas activas. Todo se ve en orden.</p></div>`;
    return;
  }
  el.innerHTML = alertas.map(a => `
    <div class="alerta-item">
      <div class="alerta-icon" style="background:${a.bg}">${a.icon}</div>
      <div class="alerta-body">
        <div class="alerta-title">${esc(a.title)}</div>
        <div class="alerta-desc">${esc(a.text)}</div>
        ${a.tagText ? `<span class="alerta-tag ${a.tag}">${a.tagText}</span>` : ''}
      </div>
    </div>
  `).join('');
}

/* ============================================================
   UI HELPERS
   ============================================================ */
function kpiCard(icon, bg, color, label, value) {
  return `
    <div class="kpi-card">
      <div class="kpi-icon" style="background:${bg};color:${color}">${icon}</div>
      <div class="kpi-body">
        <div class="kpi-label">${esc(label)}</div>
        <div class="kpi-value">${typeof value === 'number' ? value.toLocaleString('es-NI') : value}</div>
      </div>
    </div>
  `;
}

/* ============================================================
   ANÁLISIS A FUTURO — predicción del próximo mes
   ------------------------------------------------------------
   Toma los últimos 6 meses REALES de ventas/compras/gastos y les
   aplica una regresión lineal (mínimos cuadrados) para proyectar
   el mes siguiente — no es una simple extrapolación del período
   seleccionado arriba, sino un cálculo aparte con su propia
   ventana histórica fija, para que la tendencia tenga sentido
   sin importar qué "período" tenga elegido el usuario.
   ============================================================ */
function ymdLocal(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function ultimosNMeses(n) {
  const hoy = new Date();
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0);
    meses.push({
      from: ymdLocal(inicio), to: ymdLocal(fin),
      label: inicio.toLocaleDateString('es-NI', { month: 'short', year: '2-digit' }),
    });
  }
  return meses;
}

// Regresión lineal simple (mínimos cuadrados): y = m·x + b, con x = 0,1,2…
// R² (0 a 1) indica qué tan bien esa recta explica los datos reales — se
// usa como la "confiabilidad" de la proyección.
function regresionLineal(valores) {
  const n = valores.length;
  const xs = valores.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = valores.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * valores[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = (n * sumX2 - sumX * sumX) || 1;
  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;

  const meanY = sumY / n;
  const ssTot = valores.reduce((s, y) => s + Math.pow(y - meanY, 2), 0) || 1;
  const ssRes = valores.reduce((s, y, i) => s + Math.pow(y - (m * i + b), 2), 0);
  const r2 = Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  return { m, b, r2, predict: x => m * x + b };
}

async function cargarYRenderPrediccion() {
  const wrapSinDatos = document.getElementById('prediccion-sin-datos');
  const wrapContenido = document.getElementById('prediccion-contenido');
  if (!wrapSinDatos || !wrapContenido) return; // la pestaña no está en esta página

  try {
    const uid = EST.userId;
    const meses = ultimosNMeses(6);

    const datosPorMes = await Promise.all(meses.map(async m => {
      const [ventasM, comprasM, gastosM] = await Promise.all([
        sb.from('ventas').select('total,impuesto').eq('auth_user_id', uid).eq('estado', 'completada').gte('fecha', m.from).lte('fecha', m.to),
        sb.from('compras').select('total').eq('auth_user_id', uid).eq('estado', 'completada').gte('fecha', m.from).lte('fecha', m.to),
        sb.from('gastos').select('monto').eq('auth_user_id', uid).eq('estado', 'activo').gte('fecha', m.from).lte('fecha', m.to),
      ]);
      const ingresos = (ventasM.data || []).reduce((s, v) => s + parseFloat(v.total || 0) - parseFloat(v.impuesto || 0), 0);
      const compras  = (comprasM.data || []).reduce((s, c) => s + parseFloat(c.total || 0), 0);
      const gastos   = (gastosM.data || []).reduce((s, g) => s + parseFloat(g.monto || 0), 0);
      const egresos  = compras + gastos;
      return { label: m.label, from: m.from, to: m.to, ingresos, egresos, ganancia: ingresos - egresos };
    }));

    // Se ignoran los meses iniciales sin ningún movimiento (negocio nuevo
    // o cuenta recién creada), para que no arrastren ceros que distorsionen
    // la tendencia real.
    let primerConDatos = datosPorMes.findIndex(m => m.ingresos > 0 || m.egresos > 0);
    if (primerConDatos === -1) primerConDatos = 0;
    const serie = datosPorMes.slice(primerConDatos);

    if (serie.length < 2) {
      wrapSinDatos.style.display = '';
      wrapContenido.style.display = 'none';
      return;
    }
    wrapSinDatos.style.display = 'none';
    wrapContenido.style.display = '';

    const regIngresos = regresionLineal(serie.map(s => s.ingresos));
    const regEgresos  = regresionLineal(serie.map(s => s.egresos));
    const regGanancia = regresionLineal(serie.map(s => s.ganancia));

    const siguienteX = serie.length;
    const ingresosProyectados = Math.max(0, regIngresos.predict(siguienteX));
    const egresosProyectados  = Math.max(0, regEgresos.predict(siguienteX));
    const gananciaProyectada  = ingresosProyectados - egresosProyectados;
    const confiabilidad = Math.round(((regIngresos.r2 + regEgresos.r2) / 2) * 100);

    EST.prediccion = { serie, regIngresos, regEgresos, regGanancia, ingresosProyectados, egresosProyectados, gananciaProyectada, confiabilidad };

    renderKpisPrediccion();
    renderChartPrediccion();
    renderRecomendacionesPrediccion();
    await renderProductosTendencia();
  } catch (e) {
    console.error('cargarYRenderPrediccion:', e);
  }
}

function renderKpisPrediccion() {
  const p = EST.prediccion;
  const iconIngresos = p.regIngresos.m >= 0 ? '📈' : '📉';
  const iconGanancia = p.regGanancia.m >= 0 ? '📈' : '📉';
  const confNivel = p.confiabilidad >= 65 ? 'success' : p.confiabilidad >= 40 ? 'warning' : 'danger';

  document.getElementById('kpis-prediccion').innerHTML = `
    ${kpiCard(iconIngresos, 'var(--success-soft)', 'var(--success)', 'Ingresos proyectados (próx. mes)', fmt(p.ingresosProyectados))}
    ${kpiCard('💸', 'var(--danger-soft)', 'var(--danger)', 'Gastos proyectados (próx. mes)', fmt(p.egresosProyectados))}
    ${kpiCard(iconGanancia, p.gananciaProyectada >= 0 ? 'var(--success-soft)' : 'var(--danger-soft)', p.gananciaProyectada >= 0 ? 'var(--success)' : 'var(--danger)', 'Ganancia proyectada', fmt(p.gananciaProyectada))}
    ${kpiCard('🎯', `var(--${confNivel}-soft)`, `var(--${confNivel})`, 'Confiabilidad de la predicción', `${p.confiabilidad}%`)}
  `;
}

function renderChartPrediccion() {
  const ctx = document.getElementById('chart-prediccion');
  if (!ctx) return;
  if (EST.charts.prediccion) EST.charts.prediccion.destroy();
  const p = EST.prediccion;
  const ultimoIndex = p.serie.length; // índice del punto proyectado (el último del arreglo)
  const labels = [...p.serie.map(s => s.label), 'Próx. mes (est.)'];
  const ingresos = [...p.serie.map(s => s.ingresos), p.ingresosProyectados];
  const egresos  = [...p.serie.map(s => s.egresos), p.egresosProyectados];
  const segmentoProyectado = (context) => (context.p1DataIndex === ultimoIndex ? [6, 4] : undefined);

  EST.charts.prediccion = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: ingresos, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', tension: 0.3, segment: { borderDash: segmentoProyectado } },
        { label: 'Gastos', data: egresos, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', tension: 0.3, segment: { borderDash: segmentoProyectado } },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom' } },
      scales: { y: { grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } },
    },
  });
}

function renderRecomendacionesPrediccion() {
  const p = EST.prediccion;
  const el = document.getElementById('prediccion-recomendaciones');
  const items = [];
  const ultimo = p.serie[p.serie.length - 1];

  const cambioIngresos = ultimo.ingresos > 0 ? ((p.ingresosProyectados - ultimo.ingresos) / ultimo.ingresos) * 100 : 0;
  const cambioGastos   = ultimo.egresos  > 0 ? ((p.egresosProyectados  - ultimo.egresos)  / ultimo.egresos)  * 100 : 0;

  if (p.regIngresos.m > 0) {
    items.push({ icon: '📈', bg: 'var(--success-soft)', title: 'Tus ingresos vienen creciendo',
      text: `Con la tendencia de los últimos meses, el próximo mes podrías vender cerca de ${fmt(p.ingresosProyectados)} (${cambioIngresos >= 0 ? '+' : ''}${cambioIngresos.toFixed(1)}% vs. el mes pasado). Aprovecha para asegurar inventario suficiente y no perder ventas por falta de stock.` });
  } else if (p.regIngresos.m < 0) {
    items.push({ icon: '📉', bg: 'var(--danger-soft)', title: 'Tus ingresos vienen bajando',
      text: `La tendencia sugiere una caída hacia ${fmt(p.ingresosProyectados)} el próximo mes. Considera lanzar una promoción, contactar clientes que no compran hace tiempo, o revisar si algún producto clave dejó de venderse.` });
  }

  if (p.regEgresos.m > 0 && cambioGastos > 5) {
    items.push({ icon: '⚠️', bg: 'var(--warning-soft)', title: 'Tus gastos vienen subiendo',
      text: `Se proyectan gastos de ${fmt(p.egresosProyectados)} el próximo mes, un ${cambioGastos.toFixed(1)}% más que el mes pasado. Revisa tus categorías de gasto más grandes en el módulo de Gastos antes de que sigan creciendo.` });
  }

  if (p.gananciaProyectada < 0) {
    items.push({ icon: '🚨', bg: 'var(--danger-soft)', title: 'Riesgo de pérdida el próximo mes',
      text: `Con esta tendencia, tus gastos superarían a tus ingresos en ${fmt(Math.abs(p.gananciaProyectada))}. Conviene actuar ahora: recorta gastos no esenciales o impulsa ventas antes de que empiece el mes.` });
  } else if (p.regGanancia.m > 0) {
    items.push({ icon: '✅', bg: 'var(--success-soft)', title: 'Tu ganancia viene mejorando',
      text: `Si se mantiene esta tendencia, terminarías el próximo mes con una ganancia cercana a ${fmt(p.gananciaProyectada)}.` });
  }

  if (p.confiabilidad < 40) {
    items.push({ icon: '📊', bg: 'var(--accent-soft)', title: 'Predicción con baja confiabilidad',
      text: 'Tus ingresos y gastos han variado bastante mes a mes, así que esta proyección es menos precisa por ahora. Entre más meses de historial acumules, más confiable será.' });
  }

  if (!items.length) {
    items.push({ icon: 'ℹ️', bg: 'var(--accent-soft)', title: 'Comportamiento estable',
      text: 'No se detectan cambios importantes en la tendencia — se espera un mes similar a los últimos.' });
  }

  el.innerHTML = items.map(i => `
    <div class="insight-item">
      <div class="insight-icon" style="background:${i.bg}">${i.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${esc(i.title)}</div>
        <div class="insight-text">${esc(i.text)}</div>
      </div>
    </div>`).join('');
}

// Compara las unidades vendidas del último mes completo contra el
// anterior, producto por producto, para detectar cuáles van subiendo o
// bajando (útil para decidir qué reabastecer o qué promocionar).
async function obtenerCantidadesPorProducto(uid, from, to) {
  const { data: ventas } = await sb.from('ventas').select('id').eq('auth_user_id', uid).eq('estado', 'completada').gte('fecha', from).lte('fecha', to);
  const ids = (ventas || []).map(v => v.id);
  if (!ids.length) return {};
  const { data: detalles } = await sb.from('venta_detalles').select('producto_nombre,cantidad').eq('auth_user_id', uid).in('venta_id', ids);
  const map = {};
  (detalles || []).forEach(d => { map[d.producto_nombre] = (map[d.producto_nombre] || 0) + Number(d.cantidad || 0); });
  return map;
}

async function renderProductosTendencia() {
  const el = document.getElementById('prediccion-productos');
  if (!el) return;
  const serie = EST.prediccion?.serie;
  if (!serie || serie.length < 2) { el.innerHTML = '<p style="color:var(--text-muted);font-size:12.5px">No hay suficiente historial todavía.</p>'; return; }

  try {
    const meses = ultimosNMeses(6);
    const mesActual   = meses[meses.length - 1];
    const mesAnterior = meses[meses.length - 2];
    const uid = EST.userId;

    const [actual, anterior] = await Promise.all([
      obtenerCantidadesPorProducto(uid, mesActual.from, mesActual.to),
      obtenerCantidadesPorProducto(uid, mesAnterior.from, mesAnterior.to),
    ]);

    const nombres = new Set([...Object.keys(actual), ...Object.keys(anterior)]);
    const cambios = [...nombres].map(nombre => {
      const a = actual[nombre] || 0, ant = anterior[nombre] || 0;
      const delta = a - ant;
      const pct = ant > 0 ? (delta / ant) * 100 : (a > 0 ? 100 : 0);
      return { nombre, actual: a, anterior: ant, delta, pct };
    }).filter(c => c.actual > 0 || c.anterior > 0);

    const subiendo = cambios.filter(c => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
    const bajando  = cambios.filter(c => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);

    const items = [];
    subiendo.forEach(c => items.push({ icon: '📈', bg: 'var(--success-soft)', title: `${c.nombre} — en aumento`,
      text: `Vendiste ${fmtCant(c.actual)} unidades este mes vs ${fmtCant(c.anterior)} el mes anterior (${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(0)}%). Asegura tener buen stock disponible.` }));
    bajando.forEach(c => items.push({ icon: '📉', bg: 'var(--danger-soft)', title: `${c.nombre} — en descenso`,
      text: `Vendiste ${fmtCant(c.actual)} unidades este mes vs ${fmtCant(c.anterior)} el mes anterior (${c.pct.toFixed(0)}%). Podría necesitar una promoción o revisar su precio.` }));

    el.innerHTML = items.length ? items.map(i => `
      <div class="insight-item">
        <div class="insight-icon" style="background:${i.bg}">${i.icon}</div>
        <div class="insight-body">
          <div class="insight-title">${esc(i.title)}</div>
          <div class="insight-text">${esc(i.text)}</div>
        </div>
      </div>`).join('') : '<p style="color:var(--text-muted);font-size:12.5px">No hay suficientes ventas de productos en los últimos 2 meses para comparar.</p>';
  } catch (e) {
    console.error('renderProductosTendencia:', e);
    el.innerHTML = '<p style="color:var(--text-muted);font-size:12.5px">No se pudo calcular la tendencia de productos.</p>';
  }
}
function fmtCant(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }

/* ============================================================
   TABS
   ============================================================ */
function switchTab(tab) {
  document.querySelectorAll('.main-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (window.lucide) lucide.createIcons();
}

function setPeriodo(p) {
  EST.periodo = p;
  actualizarPeriodoInfo();
  recargar();
}

/* ============================================================
   CARGA / RECARGA GENERAL
   ============================================================ */
async function recargar() {
  try {
    await cargarTodo();
    renderSalud();
    renderRentabilidad();
    renderClientes();
    renderFlujo();
    renderAlertas();
    await cargarYRenderPrediccion();
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('estadisticas recargar:', err);
    showToast('No se pudieron cargar algunas estadísticas. Intenta de nuevo.', 'error');
  }
}

EST.recargar = recargar;
EST.setPeriodo = setPeriodo;
EST.switchTab = switchTab;

/* ============================================================
   ARRANQUE
   ============================================================ */
async function initEstadisticas() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');

  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });

  actualizarPeriodoInfo();

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    EST.userId = user.id;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent = user.email?.split('@')[0] || 'Usuario';
      document.getElementById('header-avatar').textContent = (user.email || 'U')[0].toUpperCase();
    }

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await recargar();
  } catch (err) {
    console.error('initEstadisticas:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando Estadísticas.', 'error');
  }
}

sb.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

document.addEventListener('DOMContentLoaded', () => {
  initEstadisticas();
  if (window.lucide) lucide.createIcons();
});
