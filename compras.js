/* =====================================================
   COMPRAS.JS — NEGOCIO360
   Módulo de abastecimiento de inventario.
   Versión: 1.1 — Producción

   ARQUITECTURA:
     Compras → Productos (actualiza stock_actual)
     Compras → Caja     (registra movimiento EGRESO tipo COMPRA)
     Productos → Dashboard  (Dashboard lee de Productos)
     Caja      → Dashboard  (Dashboard lee de Caja)
     Compras NUNCA modifica Dashboard directamente.
===================================================== */

'use strict';

/* =====================================================
   SUPABASE CLIENT
   Reutiliza la misma URL/KEY que caja.js y productos.js
===================================================== */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Se declaran aquí arriba (no donde se usan más abajo) para que
// nunca queden en "zona muerta temporal" si algo fallara antes.
let _bancosCacheCompra = null;
let _bancoElegidoIdCompra = null;
let _montoBancoConvertidoCompra = null;
let compraToCompletar = null;
let _bancoElegidoIdCompletar = null;
let _montoBancoConvertidoCompletar = null;

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  currentUser:   {},

  // Órdenes de Compra
  modoOrden:            false, // true = se está armando una Orden, no una Compra real
  ordenConvirtiendoId:  null,  // id de la orden que se está convirtiendo en compra real
  cajaChicaAbiertaHoy:  false,
  ordenesCompra:        [],

  // Datos
  compras:       [],
  proveedores:   [],
  productos:     [],       // solo tipo=producto y activo=true
  metodosPago:   [],

  // Filtros tabla
  comprasPage:    1,
  comprasPerPage: 15,
  comprasFiltro:  'mes',   // hoy | semana | mes | año | custom
  comprasSearch:  '',
  comprasDateFrom:'',
  comprasDateTo:  '',
  comprasTotal:   0,
  filtroProveedor:'',
  filtroEstado:   '',

  // Nueva compra — carrito
  carrito:       [],       // [{producto, cantidad, costoUnitario, descuento, ivaPorc, ivaMonto, subtotal}]
  proveedorSeleccionado: null,
  ivaActivo:     false,
  ivaPorcentaje: 15,
  metodoPagoSeleccionado: null,
  estadoCompra:  'completada',
  observacionesCompra: '',
  pasoActual:    1,        // 1-7

  // Sección activa (tab)
  seccionActiva: 'compras', // compras | proveedores

  // Vista proveedor
  proveedoresPage:    1,
  proveedoresPerPage: 20,
  proveedoresSearch:  '',
};

/* =====================================================
   HELPERS: FECHA
   FIX CRÍTICO DE ZONA HORARIA: toISOString() da la fecha en UTC;
   en Nicaragua (UTC-6) eso adelanta el "día" a las 6 PM hora local.
===================================================== */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayISO() { return ymd(new Date()); }
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfWeekISO() {
  const d   = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return ymd(d);
}
function startOfYearISO() { return `${new Date().getFullYear()}-01-01`; }

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

function fmt(amount) {
  if (amount === null || amount === undefined) return `${sym()} —`;
  return `${sym()} ${convertirParaMostrar(amount, STATE.empresaConfig?.moneda).toLocaleString('es-NI', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
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

function fmtNum(val) {
  if (val === null || val === undefined) return '—';
  return Number(val).toLocaleString('es-NI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
   SIDEBAR — Escritorio (colapsar) y Móvil (overlay deslizante)
===================================================== */
let sidebarCollapsed = false;

function isMobileViewport() {
  return window.innerWidth <= 768;
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');

  if (isMobileViewport()) {
    // En móvil: el sidebar se desliza encima del contenido con overlay
    const abrir = !sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', abrir);
    if (overlay) overlay.classList.toggle('show', abrir);
    document.body.style.overflow = abrir ? 'hidden' : '';
  } else {
    // En escritorio: colapsar/expandir sidebar
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

// Cierra el sidebar móvil automáticamente al navegar o al redimensionar a escritorio
window.addEventListener('resize', () => {
  if (!isMobileViewport()) closeMobileSidebar();
});

function navigate(url) {
  closeMobileSidebar();
  window.location.href = url;
}

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
      // El nombre del negocio se define en personalizacion.html como "nombre_comercial"
      const bizName = data.nombre_comercial || data.nombre_negocio || data.nombre || 'Mi negocio';
      const logoText = document.getElementById('sidebar-logo-text');
      if (logoText) logoText.textContent = bizName;
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
  // Prioridad: nombre elegido en personalizacion.html (nombre_comercial)
  const bizName  = STATE.empresaConfig?.nombre_comercial || STATE.empresaConfig?.nombre_negocio || user.nombre_negocio || 'Mi negocio';
  const plan     = user.plan || 'Gratuito';
  const initials = ((nombre[0]||'') + (apellido[0]||'')).toUpperCase();

  const hName   = document.getElementById('header-name');
  const hBiz    = document.getElementById('header-biz');
  const hAvatar = document.getElementById('header-avatar');
  const hPlan   = document.getElementById('plan-text');
  const greet   = document.getElementById('greeting-text');
  const sideLogoText = document.getElementById('sidebar-logo-text');

  if (hName)   hName.textContent   = `${nombre} ${apellido}`.trim();
  if (hBiz)    hBiz.textContent    = bizName;
  if (hAvatar) hAvatar.textContent = initials || nombre[0]?.toUpperCase() || 'U';
  if (hPlan)   hPlan.textContent   = plan.charAt(0).toUpperCase() + plan.slice(1);
  if (sideLogoText) sideLogoText.textContent = bizName;

  const hour = new Date().getHours();
  const g = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  if (greet) greet.textContent = `${g}, ${nombre}`;
}

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
  } catch(e) {}
}

/* =====================================================
   CARGAR MÉTODOS DE PAGO (desde tabla caja)
===================================================== */
async function loadMetodosPago() {
  try {
    const { data } = await sbClient
      .from('metodos_pago')
      .select('id, nombre, activo, es_default')
      .eq('auth_user_id', STATE.userId)
      .eq('activo', true)
      .order('orden');
    STATE.metodosPago = data || [];
    populateMetodosSelect();
  } catch(e) {
    console.warn('loadMetodosPago:', e);
    STATE.metodosPago = [{ id: null, nombre: 'Efectivo', es_default: true }];
    populateMetodosSelect();
  }
}

function populateMetodosSelect() {
  const metodos = STATE.metodosPago.length
    ? STATE.metodosPago
    : [{ id: null, nombre: 'Efectivo', es_default: true }];
  const opciones = metodos.map(m =>
    `<option value="${m.id || ''}" data-nombre="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`
  ).join('');
  const def = metodos.find(m => m.es_default);

  // Se llenan ambos selects (el del wizard normal y el del formulario
  // rápido de "Producto nuevo"); si alguno no existe en el DOM, se ignora.
  ['nc-metodo-pago', 'pn-metodo-pago', 'cd-metodo-pago'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = opciones;
    if (def) sel.value = def.id || '';
  });
}

/* =====================================================
   CARGAR PRODUCTOS (solo tipo=producto para búsqueda)
===================================================== */
async function loadProductosDisponibles() {
  try {
    const { data } = await sbClient
      .from('productos')
      .select('id, nombre, sku, categoria, stock_actual, costo, precio, activo')
      .eq('auth_user_id', STATE.userId)
      .eq('tipo', 'producto')  // ← SOLO productos, nunca servicios
      .eq('activo', true)
      .order('nombre');
    STATE.productos = data || [];
  } catch(e) { console.warn('loadProductosDisponibles:', e); }
}

/* =====================================================
   KPI CARDS — Compras del mes
===================================================== */
async function loadKPIs() {
  const { from, to } = getFilterDates('mes', '', '');
  try {
    const { data } = await sbClient
      .from('compras')
      .select('total, estado, fecha, id')
      .eq('auth_user_id', STATE.userId)
      .gte('fecha', from)
      .lte('fecha', to);

    const todas    = data || [];
    const activas  = todas.filter(c => c.estado !== 'anulada');
    const hoy      = todayISO();
    const deHoy    = activas.filter(c => c.fecha === hoy);

    const totalMes = activas.reduce((s, c) => s + Number(c.total), 0);
    const totalHoy = deHoy.reduce((s, c) => s + Number(c.total), 0);

    // Valor inventario actual
    const { data: prods } = await sbClient
      .from('productos')
      .select('stock_actual, costo')
      .eq('auth_user_id', STATE.userId)
      .eq('tipo', 'producto')
      .eq('activo', true);

    const valorInventario = (prods || []).reduce(
      (s, p) => s + (Number(p.stock_actual || 0) * Number(p.costo || 0)), 0
    );

    // Proveedores activos
    const { count: provCount } = await sbClient
      .from('proveedores')
      .select('id', { count: 'exact', head: true })
      .eq('auth_user_id', STATE.userId)
      .eq('activo', true);

    // Unidades ingresadas este mes
    const { data: detalles } = await sbClient
      .from('detalle_compras')
      .select('cantidad, compra_id')
      .eq('auth_user_id', STATE.userId);

    // Solo los detalles de compras activas del mes
    const compraIdsActivas = new Set(activas.map(c => c.id));
    const unidadesMes = (detalles || [])
      .filter(d => compraIdsActivas.has(d.compra_id))
      .reduce((s, d) => s + Number(d.cantidad), 0);

    setKPI('kpi-hoy',        fmt(totalHoy),         `${deHoy.length} compra${deHoy.length !== 1 ? 's' : ''}`);
    setKPI('kpi-mes',        fmt(totalMes),         `${activas.length} compra${activas.length !== 1 ? 's' : ''}`);
    setKPI('kpi-cantidad',   activas.length.toString(),  `${todas.filter(c=>c.estado==='anulada').length} anuladas`);
    setKPI('kpi-unidades',   fmtNum(unidadesMes),        'unidades ingresadas');
    setKPI('kpi-inventario', fmt(valorInventario),  'valor en stock');
    setKPI('kpi-proveedores', (provCount || 0).toString(), 'activos');

  } catch(e) { console.warn('loadKPIs:', e); }
}

function setKPI(id, valor, delta) {
  const el = document.getElementById(id);
  if (el) el.textContent = valor;
  const del = document.getElementById(id + '-delta');
  if (del) del.textContent = delta;
}

/* =====================================================
   CARGAR COMPRAS (tabla principal)
===================================================== */
async function loadCompras() {
  const { from, to } = getFilterDates(
    STATE.comprasFiltro, STATE.comprasDateFrom, STATE.comprasDateTo
  );

  try {
    let query = sbClient
      .from('compras')
      .select('*', { count: 'exact' })
      .eq('auth_user_id', STATE.userId)
      .gte('fecha', from)
      .lte('fecha', to)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });

    if (STATE.comprasSearch.trim()) {
      query = query.or(
        `numero.ilike.%${STATE.comprasSearch.trim()}%,proveedor_nombre.ilike.%${STATE.comprasSearch.trim()}%`
      );
    }
    if (STATE.filtroProveedor) {
      query = query.eq('proveedor_id', STATE.filtroProveedor);
    }
    if (STATE.filtroEstado) {
      query = query.eq('estado', STATE.filtroEstado);
    }

    const fromRange = (STATE.comprasPage - 1) * STATE.comprasPerPage;
    const toRange   = fromRange + STATE.comprasPerPage - 1;
    query = query.range(fromRange, toRange);

    const { data, count, error } = await query;
    if (error) throw error;

    STATE.compras      = data || [];
    STATE.comprasTotal = count || 0;

    renderCompras();
    renderPaginacionCompras();
  } catch(e) {
    console.warn('loadCompras:', e);
    const tbody = document.getElementById('compras-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">Error al cargar compras. Intenta de nuevo.</td></tr>`;
  }
}

function renderCompras() {
  const tbody = document.getElementById('compras-tbody');
  if (!tbody) return;

  if (!STATE.compras.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-cell">
          <div class="empty-state-mini">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            <p>Sin compras en este período</p>
            <button class="btn-primary" onclick="abrirNuevaCompra()" style="margin-top:8px">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nueva Compra
            </button>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = STATE.compras.map(c => {
    const estadoBadge = {
      completada: '<span class="status-badge badge-completada">Completada</span>',
      pendiente:  '<span class="status-badge badge-pendiente">Pendiente</span>',
      anulada:    '<span class="status-badge badge-anulada">Anulada</span>',
    }[c.estado] || c.estado;

    return `
    <tr class="compra-row ${c.estado === 'anulada' ? 'row-anulada' : ''}">
      <td><span class="numero-badge">${escHtml(c.numero)}</span></td>
      <td class="td-fecha">${fmtDate(c.fecha)}</td>
      <td>${escHtml(c.proveedor_nombre || '—')}</td>
      <td>
        <button class="btn-ghost btn-sm" onclick="verDetalleCompra('${c.id}')"
          style="font-size:12px;padding:4px 8px;color:var(--accent)">
          Ver detalle
        </button>
      </td>
      <td class="td-right">—</td>
      <td class="td-right td-money">${fmt(c.total)}</td>
      <td>${escHtml(c.metodo_pago_nombre || '—')}</td>
      <td>${estadoBadge}</td>
      <td style="font-size:12px;color:var(--text-muted)">${escHtml(c.usuario_nombre || '—')}</td>
      <td class="td-actions">
        <button class="btn-icon" onclick="verDetalleCompra('${c.id}')" title="Ver detalle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        ${c.estado === 'pendiente' ? `
        <button class="btn-icon" style="color:var(--success)" onclick="abrirCompletarCompra('${c.id}')" title="Completar — ya se pagó, descontar de Caja">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
        ${c.estado !== 'anulada' ? `
        <button class="btn-icon btn-icon-danger" onclick="confirmarAnularCompra('${c.id}')" title="Anular">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>` : '<span class="anulado-label">Anulada</span>'}
      </td>
    </tr>`;
  }).join('');

  // Cargar unidades en cada fila de forma asíncrona
  STATE.compras.forEach(c => cargarUnidadesCompra(c.id));
}

async function cargarUnidadesCompra(compraId) {
  try {
    const { data } = await sbClient
      .from('detalle_compras')
      .select('cantidad')
      .eq('compra_id', compraId);
    const unidades = (data || []).reduce((s, d) => s + Number(d.cantidad), 0);
    // Buscar la fila y actualizar la celda de unidades
    const rows = document.querySelectorAll('#compras-tbody tr.compra-row');
    rows.forEach(row => {
      const btn = row.querySelector(`button[onclick*="${compraId}"]`);
      if (btn) {
        const td = row.cells[4];
        if (td) td.textContent = fmtNum(unidades);
      }
    });
  } catch(e) {}
}

function renderPaginacionCompras() {
  const totalPages = Math.ceil(STATE.comprasTotal / STATE.comprasPerPage);
  const info       = document.getElementById('paginacion-info');
  if (info) {
    const from = Math.min((STATE.comprasPage - 1) * STATE.comprasPerPage + 1, STATE.comprasTotal);
    const to   = Math.min(STATE.comprasPage * STATE.comprasPerPage, STATE.comprasTotal);
    info.textContent = STATE.comprasTotal > 0 ? `Mostrando ${from}–${to} de ${STATE.comprasTotal}` : 'Sin resultados';
  }
  const prev = document.getElementById('btn-pag-prev');
  const next = document.getElementById('btn-pag-next');
  if (prev) prev.disabled = STATE.comprasPage <= 1;
  if (next) next.disabled = STATE.comprasPage >= totalPages;
}

/* =====================================================
   FILTROS
===================================================== */
function setFiltro(filtro) {
  STATE.comprasFiltro = filtro;
  STATE.comprasPage   = 1;
  document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => {
    b.classList.toggle('active', b.dataset.filtro === filtro);
  });
  const cd = document.getElementById('custom-dates');
  if (cd) cd.style.display = filtro === 'custom' ? 'flex' : 'none';
  loadCompras();
}

function buscarCompras() {
  STATE.comprasSearch = document.getElementById('compras-search')?.value || '';
  STATE.comprasPage   = 1;
  loadCompras();
}

function paginaAnterior() {
  if (STATE.comprasPage > 1) { STATE.comprasPage--; loadCompras(); }
}

function paginaSiguiente() {
  const total = Math.ceil(STATE.comprasTotal / STATE.comprasPerPage);
  if (STATE.comprasPage < total) { STATE.comprasPage++; loadCompras(); }
}

/* =====================================================
   DETALLE DE COMPRA
===================================================== */
async function verDetalleCompra(compraId) {
  try {
    const compra = STATE.compras.find(c => c.id === compraId);
    if (!compra) return;

    const { data: lineas } = await sbClient
      .from('detalle_compras')
      .select('*')
      .eq('compra_id', compraId);

    const estadoColor = {
      completada: 'var(--success)', pendiente: 'var(--warning)', anulada: 'var(--danger)',
    }[compra.estado] || 'var(--text-muted)';

    const lineasHtml = (lineas || []).map(l => `
      <tr>
        <td>${escHtml(l.producto_nombre)}</td>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${escHtml(l.producto_sku||'—')}</td>
        <td class="td-right">${fmtNum(l.cantidad)}</td>
        <td class="td-right">${fmt(l.costo_unitario)}</td>
        <td class="td-right">${l.descuento > 0 ? fmt(l.descuento) : '—'}</td>
        <td class="td-right">${l.iva_porcentaje > 0 ? l.iva_porcentaje+'%' : '—'}</td>
        <td class="td-right td-money">${fmt(l.subtotal)}</td>
      </tr>
    `).join('');

    document.getElementById('detalle-content').innerHTML = `
      <div class="detalle-grid">
        <div class="detalle-fila">
          <span class="detalle-label">Número</span>
          <span class="detalle-valor numero-badge">${escHtml(compra.numero)}</span>
        </div>
        <div class="detalle-fila">
          <span class="detalle-label">Fecha</span>
          <span class="detalle-valor">${fmtDate(compra.fecha)}</span>
        </div>
        <div class="detalle-fila">
          <span class="detalle-label">Proveedor</span>
          <span class="detalle-valor">${escHtml(compra.proveedor_nombre || '—')}</span>
        </div>
        <div class="detalle-fila">
          <span class="detalle-label">Método de pago</span>
          <span class="detalle-valor">${escHtml(compra.metodo_pago_nombre)}</span>
        </div>
        <div class="detalle-fila">
          <span class="detalle-label">Estado</span>
          <span class="detalle-valor" style="color:${estadoColor};font-weight:700">${compra.estado.charAt(0).toUpperCase()+compra.estado.slice(1)}</span>
        </div>
        <div class="detalle-fila">
          <span class="detalle-label">Usuario</span>
          <span class="detalle-valor">${escHtml(compra.usuario_nombre || '—')}</span>
        </div>
        ${compra.observaciones ? `
        <div class="detalle-fila full">
          <span class="detalle-label">Observaciones</span>
          <span class="detalle-valor">${escHtml(compra.observaciones)}</span>
        </div>` : ''}
      </div>

      ${compra.es_directa ? `
      <div class="detalle-grid" style="margin-top:4px">
        <div class="detalle-fila full">
          <span class="detalle-label">📄 Compra directa — ¿de qué es?</span>
          <span class="detalle-valor">${escHtml(compra.concepto || '—')}</span>
        </div>
      </div>
      ` : `
      <div style="margin:16px 0 8px;font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Productos</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr>
              ${['Producto','SKU','Cantidad','Costo unit.','Descuento','IVA','Subtotal'].map(h =>
                `<th style="padding:8px 10px;text-align:${h==='Producto'||h==='SKU'?'left':'right'};font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border);font-weight:700;text-transform:uppercase;letter-spacing:.06em">${h}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>
            ${lineasHtml || '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text-muted)">Sin líneas</td></tr>'}
          </tbody>
        </table>
      </div>
      `}

      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="display:flex;flex-direction:column;gap:6px;max-width:280px;margin-left:auto">
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text-secondary)">Subtotal</span>
            <span>${fmt(compra.subtotal)}</span>
          </div>
          ${Number(compra.descuento_total) > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text-secondary)">Descuento</span>
            <span style="color:var(--danger)">-${fmt(compra.descuento_total)}</span>
          </div>` : ''}
          ${Number(compra.iva_monto) > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text-secondary)">IVA (${compra.iva_porcentaje}%)</span>
            <span>${fmt(compra.iva_monto)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
            <span>Total</span>
            <span style="color:var(--accent)">${fmt(compra.total)}</span>
          </div>
        </div>
      </div>
    `;

    openModal('modal-detalle');
  } catch(e) {
    showToast('Error al cargar detalle', 'error');
  }
}

/* =====================================================
   NUEVA COMPRA — MODAL MULTI-PASO
===================================================== */
function mostrarSeccionOrdenes() {
  document.getElementById('seccion-compras').style.display = 'none';
  document.getElementById('seccion-ordenes').style.display = '';
  cargarOrdenesCompra();
}
function mostrarSeccionCompras() {
  document.getElementById('seccion-ordenes').style.display = 'none';
  document.getElementById('seccion-compras').style.display = '';
}

/* =====================================================
   PERSONALIZAR DOCUMENTOS — compartido con Reportes, propio de su
   tabla (configuracion_documentos), independiente de Perfil.
===================================================== */
STATE.configDocumentos = null;

async function cargarConfigDocumentos() {
  try {
    const { data } = await sbClient.from('configuracion_documentos').select('*').eq('auth_user_id', STATE.userId).maybeSingle();
    STATE.configDocumentos = data || { color_principal:'#6C63FF', color_tabla_usa_mismo:true, color_tabla:'#6C63FF', mostrar_ruc:true, mostrar_direccion:true, mostrar_telefono:true, mensaje_pie:null, logo_tamano:'mediano' };
  } catch (e) { STATE.configDocumentos = { color_principal:'#6C63FF', color_tabla_usa_mismo:true, color_tabla:'#6C63FF', mostrar_ruc:true, mostrar_direccion:true, mostrar_telefono:true, mensaje_pie:null, logo_tamano:'mediano' }; }
}

async function abrirPersonalizarDocumentos() {
  await cargarConfigDocumentos();
  const c = STATE.configDocumentos;
  document.getElementById('pd-color-principal').value = c.color_principal || '#6C63FF';
  document.getElementById('pd-hex-principal').value = c.color_principal || '#6C63FF';
  document.getElementById('pd-mismo-color').checked = c.color_tabla_usa_mismo !== false;
  document.getElementById('pd-color-tabla').value = c.color_tabla || c.color_principal || '#6C63FF';
  document.getElementById('pd-hex-tabla').value = c.color_tabla || c.color_principal || '#6C63FF';
  document.getElementById('pd-mensaje-pie').value = c.mensaje_pie || '';
  document.getElementById('pd-logo-tamano').value = c.logo_tamano || 'mediano';
  document.getElementById('pd-mostrar-ruc').checked = c.mostrar_ruc !== false;
  document.getElementById('pd-mostrar-direccion').checked = c.mostrar_direccion !== false;
  document.getElementById('pd-mostrar-telefono').checked = c.mostrar_telefono !== false;
  document.getElementById('pd-error').textContent = '';
  pdToggleMismoColor();
  pdActualizarVista();
  openModal('modal-personalizar-documentos');
}

function pdSyncColor(colorId, hexId) { document.getElementById(hexId).value = document.getElementById(colorId).value; }
function pdSyncHex(hexId, colorId) {
  const v = document.getElementById(hexId).value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) document.getElementById(colorId).value = v;
}
function pdToggleMismoColor() {
  document.getElementById('pd-color-tabla-wrap').style.display = document.getElementById('pd-mismo-color').checked ? 'none' : '';
}
function pdActualizarVista() {
  const bizName = STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio';
  const colorPrincipal = document.getElementById('pd-color-principal').value;
  const usaMismo = document.getElementById('pd-mismo-color').checked;
  const colorTabla = usaMismo ? colorPrincipal : document.getElementById('pd-color-tabla').value;
  document.getElementById('pd-preview-header').style.background = colorPrincipal;
  document.getElementById('pd-preview-nombre').textContent = bizName;
  document.getElementById('pd-preview-tabla-head').style.background = colorTabla;
  const datos = [];
  if (document.getElementById('pd-mostrar-ruc').checked) datos.push('RUC');
  if (document.getElementById('pd-mostrar-direccion').checked) datos.push('Dirección');
  if (document.getElementById('pd-mostrar-telefono').checked) datos.push('Tel');
  document.getElementById('pd-preview-datos').textContent = datos.join(' · ') || '(sin datos de contacto mostrados)';
  const mensaje = document.getElementById('pd-mensaje-pie').value.trim();
  document.getElementById('pd-preview-pie').textContent = (mensaje ? mensaje + ' · ' : '') + 'Generado por Negocio360';
}

async function guardarPersonalizarDocumentos() {
  const errEl = document.getElementById('pd-error');
  errEl.textContent = '';
  const colorPrincipal = document.getElementById('pd-hex-principal').value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(colorPrincipal)) { errEl.textContent = 'El color del encabezado no es válido.'; return; }
  const usaMismo = document.getElementById('pd-mismo-color').checked;
  const colorTabla = usaMismo ? colorPrincipal : document.getElementById('pd-hex-tabla').value.trim();
  if (!usaMismo && !/^#[0-9a-fA-F]{6}$/.test(colorTabla)) { errEl.textContent = 'El color de la tabla no es válido.'; return; }

  setBtnLoading('btn-guardar-personalizar-documentos', true);
  try {
    await sbClient.from('configuracion_documentos').upsert({
      auth_user_id: STATE.userId, color_principal: colorPrincipal, color_tabla_usa_mismo: usaMismo, color_tabla: colorTabla,
      mensaje_pie: document.getElementById('pd-mensaje-pie').value.trim() || null,
      logo_tamano: document.getElementById('pd-logo-tamano').value,
      mostrar_ruc: document.getElementById('pd-mostrar-ruc').checked,
      mostrar_direccion: document.getElementById('pd-mostrar-direccion').checked,
      mostrar_telefono: document.getElementById('pd-mostrar-telefono').checked,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    STATE.configDocumentos = null;
    showToast('Personalización guardada');
    closeModal('modal-personalizar-documentos');
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-personalizar-documentos', false);
  }
}

function hexARgbDocumentos(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const num = parseInt(m[1], 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function abrirNuevaCompra() {
  // Reset estado
  STATE.carrito = [];
  STATE.proveedorSeleccionado = null;
  STATE.ivaActivo   = false;
  STATE.ivaPorcentaje = 15;
  STATE.metodoPagoSeleccionado = null;
  STATE.estadoCompra = 'completada';
  STATE.observacionesCompra = '';
  STATE.pasoActual  = 1;
  STATE.modoOrden = false;
  STATE.ordenConvirtiendoId = null;
  STATE.cajaChicaAbiertaHoy = false;
  _bancoElegidoIdCompra = null; _montoBancoConvertidoCompra = null;
  const ncbew = document.getElementById('nc-banco-elegir-wrap'); if (ncbew) ncbew.style.display = 'none';
  const ncbdw = document.getElementById('nc-banco-elegido-wrap'); if (ncbdw) ncbdw.style.display = 'none';
  actualizarTextosModoOrden();

  // Reset UI
  resetNuevaCompraUI();
  resetFormProductoNuevo();
  mostrarPasoSeleccion();
  openModal('modal-nueva-compra');

  hayCajaChicaAbiertaHoy().then(abierta => {
    STATE.cajaChicaAbiertaHoy = abierta;
    toggleOrigenCajaCompra();
  });
}

// ¿Hay una sesión de Caja Chica abierta hoy? Si sí, es obligatorio
// indicar de dónde sale el dinero de esta compra antes de guardar.
// Si no hay ninguna abierta, todo sigue exactamente como siempre.
async function hayCajaChicaAbiertaHoy() {
  try {
    const hoy = todayISO();
    const { data } = await sbClient.from('caja_chica_sesiones')
      .select('id').eq('auth_user_id', STATE.userId).eq('fecha', hoy).eq('estado', 'abierta').maybeSingle();
    return !!data;
  } catch (e) { return false; }
}
function toggleOrigenCajaCompra() {
  const estado = document.getElementById('nc-estado')?.value || 'completada';
  const wrap = document.getElementById('nc-origen-caja-wrap');
  if (!wrap) return;
  const mostrar = !!STATE.cajaChicaAbiertaHoy && estado === 'completada';
  wrap.style.display = mostrar ? '' : 'none';
  if (mostrar) document.getElementById('nc-origen-caja').value = 'chica';
}

// Misma ventana/asistente que "Nueva Compra" — solo que se guarda como
// una Orden pendiente (nunca toca Caja ni Inventario) en vez de una
// compra real.
function abrirNuevaOrdenCompra() {
  STATE.carrito = [];
  STATE.proveedorSeleccionado = null;
  STATE.ivaActivo   = false;
  STATE.ivaPorcentaje = 15;
  STATE.metodoPagoSeleccionado = null;
  STATE.estadoCompra = 'completada';
  STATE.observacionesCompra = '';
  STATE.pasoActual  = 1;
  STATE.modoOrden = true;
  STATE.ordenConvirtiendoId = null;
  actualizarTextosModoOrden();

  resetNuevaCompraUI();
  resetFormProductoNuevo();
  mostrarPasoSeleccion();
  openModal('modal-nueva-compra');
}

// Ajusta los textos del asistente según si se está armando una Orden
// o una Compra real (mismo formulario, distinto destino al guardar).
function actualizarTextosModoOrden() {
  const titulo = document.getElementById('nc-modal-titulo-texto');
  const btnTexto = document.getElementById('nc-btn-save-texto');
  if (titulo)   titulo.textContent   = STATE.modoOrden ? (STATE.ordenConvirtiendoId ? 'Convertir orden en Compra' : 'Nueva Orden de Compra') : 'Nueva Compra';
  if (btnTexto) btnTexto.textContent = STATE.modoOrden ? 'Guardar orden' : (STATE.ordenConvirtiendoId ? 'Registrar compra' : 'Guardar compra');
}

// ── PASO 0: elegir "producto existente" vs "producto nuevo" ──────────────
function mostrarPasoSeleccion() {
  document.getElementById('nc-paso-0').style.display = '';
  document.getElementById('nc-form-producto-nuevo').style.display = 'none';
  document.getElementById('nc-wizard-body').style.display = 'none';
  document.getElementById('nc-steps').style.display = 'none';
  document.getElementById('nc-mobile-step-info').style.display = 'none';
  document.getElementById('nc-btn-prev').style.display = 'none';
  document.getElementById('nc-btn-next').style.display = 'none';
  document.getElementById('nc-btn-save').style.display = 'none';
  document.getElementById('nc-btn-comprar-nuevo').style.display = 'none';
}

function elegirTipoNuevaCompra(tipo) {
  document.getElementById('nc-paso-0').style.display = 'none';

  if (tipo === 'existente') {
    // Comportamiento de siempre, sin ningún cambio.
    document.getElementById('nc-wizard-body').style.display = '';
    document.getElementById('nc-steps').style.display = '';
    document.getElementById('nc-mobile-step-info').style.display = ''; // deja que la media query original decida (solo se ve en móvil)
    irAPaso(1);
  } else {
    // Formulario rápido de producto nuevo.
    document.getElementById('nc-form-producto-nuevo').style.display = '';
    document.getElementById('nc-btn-comprar-nuevo').style.display = 'inline-flex';
    document.getElementById('pn-lote-wrap').style.display = STATE.empresaConfig?.maneja_lotes_vencimiento === true ? '' : 'none';
    llenarSelectProveedores();
    populateMetodosSelect();
    document.getElementById('pn-nombre')?.focus();
  }
}

// ── FORMULARIO "PRODUCTO NUEVO" ───────────────────────────────────────────
function resetFormProductoNuevo() {
  ['pn-nombre','pn-categoria','pn-sku','pn-costo','pn-precio','pn-stock'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const err = document.getElementById('pn-error');
  if (err) err.textContent = '';
  _bancoElegidoIdCompra = null; _montoBancoConvertidoCompra = null;
  STATE.esperandoBancoParaProductoNuevo = false;
  const pnbew = document.getElementById('pn-banco-elegir-wrap'); if (pnbew) pnbew.style.display = 'none';
  const pnbanner = document.getElementById('pn-banco-espera-banner'); if (pnbanner) pnbanner.style.display = 'none';
  actualizarPreviewProductoNuevo();
}

function actualizarPreviewProductoNuevo() {
  const costo = parseFloat(document.getElementById('pn-costo')?.value) || 0;
  const stock = parseFloat(document.getElementById('pn-stock')?.value) || 0;
  const total = costo * stock;
  const el = document.getElementById('pn-total-preview');
  if (el) el.textContent = `Total a descontar de caja: ${fmt(total)}`;
}

async function crearProductoYComprar() {
  const errEl = document.getElementById('pn-error');
  if (errEl) errEl.textContent = '';

  const nombre    = (document.getElementById('pn-nombre')?.value || '').trim();
  const categoria = (document.getElementById('pn-categoria')?.value || '').trim();
  const sku       = (document.getElementById('pn-sku')?.value || '').trim();
  const costo     = parseFloat(document.getElementById('pn-costo')?.value);
  const precio    = parseFloat(document.getElementById('pn-precio')?.value);
  const stock     = parseFloat(document.getElementById('pn-stock')?.value);
  const provSel   = document.getElementById('pn-proveedor-select');
  const proveedorId     = provSel?.value || null;
  const proveedorNombre = proveedorId
    ? (STATE.proveedores.find(p => p.id === proveedorId)?.nombre || null)
    : null;
  const metodoSel = document.getElementById('pn-metodo-pago');
  const metodoPagoId     = metodoSel?.value || null;
  const metodoPagoNombre = metodoSel?.options[metodoSel.selectedIndex]?.getAttribute('data-nombre') || 'Efectivo';

  if (!nombre) { if (errEl) errEl.textContent = 'El nombre del producto es obligatorio'; return; }
  if (isNaN(costo) || costo <= 0) { if (errEl) errEl.textContent = 'El costo debe ser mayor a 0'; return; }
  if (isNaN(precio) || precio < 0) { if (errEl) errEl.textContent = 'El precio de venta no es válido'; return; }
  if (isNaN(stock) || stock <= 0) { if (errEl) errEl.textContent = 'La cantidad/stock inicial debe ser mayor a 0'; return; }

  // Si el método necesita banco (Tarjeta/Transferencia) y el negocio
  // sí tiene bancos creados, se PAUSA aquí — se muestran las tarjetas
  // de banco (reutilizando el mismo selector de "Nueva Compra") y esta
  // misma función se vuelve a llamar sola en cuanto se elija uno. Para
  // Efectivo, PayPal, o cualquier otro método que no dependa de un
  // banco propio, esto se salta por completo y guarda directo, igual
  // que siempre.
  const metodoLower = (metodoPagoNombre || '').toLowerCase();
  const necesitaBanco = metodoLower.includes('tarjeta') || metodoLower.includes('transferencia');
  if (necesitaBanco && !_bancoElegidoIdCompra) {
    const bancos = await cargarBancosDisponiblesCompra();
    if (bancos.length) {
      STATE.esperandoBancoParaProductoNuevo = true;
      await mostrarSelectorBancoCompra(metodoPagoNombre);
      document.getElementById('pn-error').textContent = '';
      const banner = document.getElementById('pn-banco-espera-banner');
      if (banner) banner.style.display = '';
      return;
    }
  }
  STATE.esperandoBancoParaProductoNuevo = false;
  const bancoAnteriorBanner = document.getElementById('pn-banco-espera-banner');
  if (bancoAnteriorBanner) bancoAnteriorBanner.style.display = 'none';
  // _bancoElegidoIdCompra / _montoBancoConvertidoCompra se dejan tal
  // cual — guardarCompra() los lee directamente más abajo, en el
  // mismo insert que ya usa para "Nueva Compra".

  // Mismo límite que ya existe en Productos/Servicios para el monto que
  // puede registrarse en Caja (columna numeric(14,2)).
  const montoCompra = costo * stock;
  const LIMITE_MONTO_CAJA = 999999999999.99;
  if (montoCompra > LIMITE_MONTO_CAJA) {
    if (errEl) errEl.textContent = `El total (${fmt(montoCompra)}) es demasiado grande para registrarse en Caja. Ajusta el costo o la cantidad.`;
    return;
  }

  const btn = document.getElementById('nc-btn-comprar-nuevo');
  btn.disabled = true;
  const textoOriginal = btn.innerHTML;
  btn.innerHTML = '<span class="btn-spinner"></span> Comprando...';

  try {
    // 1. Crear el producto (mismo esquema que usa Productos/Servicios),
    // con stock_actual en 0: la cantidad comprada la asigna guardarCompra()
    // más abajo, igual que con cualquier otra compra de producto existente,
    // para no duplicar la lógica de actualización de stock.
    const { data: nuevoProd, error: errProd } = await sbClient
      .from('productos')
      .insert({
        auth_user_id:     STATE.userId,
        tipo:             'producto',
        nombre,
        descripcion:      null,
        categoria:        categoria || null,
        proveedor_id:     proveedorId,
        proveedor_nombre: proveedorNombre,
        sku:              sku || null,
        codigo_barras:    null,
        costo,
        precio,
        tipo_precio:      'fijo',
        stock_actual:     0,
        stock_minimo:     0,
        activo:           true,
      })
      .select()
      .single();

    if (errProd) throw errProd;

    // 2. Seleccionar este mismo proveedor para la compra (si se eligió uno)
    if (proveedorId) {
      STATE.proveedorSeleccionado = STATE.proveedores.find(p => p.id === proveedorId) || null;
    }

    // 3. Armar el carrito con esta única línea y reutilizar EXACTAMENTE la
    // misma lógica de guardado que ya usa el resto del módulo de Compras
    // (crea la cabecera de compra, el detalle, actualiza el stock del
    // producto, y registra el egreso en Caja) — así se garantiza que quede
    // igual de consistente que cualquier otra compra.
    STATE.carrito = [{
      producto: { id: nuevoProd.id, nombre: nuevoProd.nombre, sku: nuevoProd.sku, stock_actual: 0 },
      cantidad: stock,
      costoUnitario: costo,
      descuento: 0,
      ivaPorc: 0,
      ivaMonto: 0,
      subtotal: montoCompra,
      numeroLote: document.getElementById('pn-lote')?.value.trim() || '',
      fechaVencimiento: document.getElementById('pn-vencimiento')?.value || '',
    }];
    STATE.ivaActivo = false;
    STATE.ivaPorcentaje = 0;

    // Método de pago / estado / fecha que guardarCompra() lee del wizard
    // normal — se fuerzan aquí ya que este formulario los pide directamente.
    const selWizardMetodo = document.getElementById('nc-metodo-pago');
    if (selWizardMetodo) selWizardMetodo.value = metodoPagoId || '';
    // Nota: este formulario rápido guarda de inmediato, sin pausa para
    // elegir banco — si el negocio necesita elegir a qué banco entra
    // este pago específico, debe usar "Nueva Compra" (el flujo normal,
    // con pasos), que sí lo permite.
    const estadoEl = document.getElementById('nc-estado');
    if (estadoEl) estadoEl.value = 'completada'; // siempre descuenta de caja, sin excepción
    const fechaEl = document.getElementById('nc-fecha');
    if (fechaEl && !fechaEl.value) fechaEl.value = todayISO();
    const obsEl = document.getElementById('nc-observaciones');
    if (obsEl) obsEl.value = 'Producto nuevo creado directamente desde Compras';

    await guardarCompra(); // ya cierra el modal y refresca todo por su cuenta
  } catch (e) {
    console.error('crearProductoYComprar:', e);
    if (errEl) errEl.textContent = 'Error al crear el producto: ' + (e.message || 'intenta de nuevo');
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

function resetNuevaCompraUI() {
  // Paso 1 — Proveedor
  const selProv = document.getElementById('nc-proveedor-select');
  if (selProv) selProv.value = '';
  ['nc-prov-nombre','nc-prov-telefono','nc-prov-email','nc-prov-direccion','nc-prov-obs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  toggleNuevoProveedor(false);

  // Paso 2 — Búsqueda de producto
  const sp = document.getElementById('nc-producto-search');
  if (sp) sp.value = '';
  const sr = document.getElementById('nc-search-results');
  if (sr) sr.innerHTML = '';

  // Paso 3 — Carrito
  renderCarrito();

  // IVA
  const ivaCheck = document.getElementById('nc-iva-activo');
  if (ivaCheck) ivaCheck.checked = false;
  const ivaPorcEl = document.getElementById('nc-iva-porcentaje');
  if (ivaPorcEl) ivaPorcEl.value = '15';
  toggleIVA(false);

  // Paso 5 — Método pago
  populateMetodosSelect();

  // Paso 6 — Estado
  const estadoSel = document.getElementById('nc-estado');
  if (estadoSel) estadoSel.value = 'completada';

  // Paso 7 — Obs
  const obs = document.getElementById('nc-observaciones');
  if (obs) obs.value = '';

  actualizarResumen();
}

function irAPaso(paso) {
  STATE.pasoActual = paso;
  // Mostrar/ocultar pasos
  document.querySelectorAll('.nc-paso').forEach(p => {
    p.style.display = parseInt(p.dataset.paso) === paso ? 'block' : 'none';
  });
  // Actualizar indicadores
  document.querySelectorAll('.paso-indicator').forEach(ind => {
    const n = parseInt(ind.dataset.paso);
    ind.classList.toggle('active',    n === paso);
    ind.classList.toggle('completado', n < paso);
  });
  // Botones nav
  const btnPrev = document.getElementById('nc-btn-prev');
  const btnNext = document.getElementById('nc-btn-next');
  const btnSave = document.getElementById('nc-btn-save');
  if (btnPrev) btnPrev.style.display = paso > 1 ? 'inline-flex' : 'none';
  if (btnNext) btnNext.style.display = paso < 7 ? 'inline-flex' : 'none';
  if (btnSave) btnSave.style.display = paso === 7 ? 'inline-flex' : 'none';

  // Al llegar al resumen (paso 4) actualizar
  if (paso === 4) actualizarResumen();
  // Al llegar al paso 1, cargar proveedores en select
  if (paso === 1) llenarSelectProveedores();
}

function pasoAnterior() {
  if (STATE.pasoActual > 1) irAPaso(STATE.pasoActual - 1);
}

function pasoSiguiente() {
  if (!validarPaso(STATE.pasoActual)) return;
  if (STATE.pasoActual < 7) irAPaso(STATE.pasoActual + 1);
}

function validarPaso(paso) {
  if (paso === 3 && STATE.carrito.length === 0) {
    showToast('Agrega al menos un producto al carrito', 'error');
    return false;
  }
  return true;
}

/* =====================================================
   PASO 1 — PROVEEDORES
===================================================== */
async function loadProveedores() {
  try {
    const { data } = await sbClient
      .from('proveedores')
      .select('*')
      .eq('auth_user_id', STATE.userId)
      .order('nombre');
    STATE.proveedores = data || [];
    llenarSelectProveedores();
    renderProveedoresList();
  } catch(e) { console.warn('loadProveedores:', e); }
}

function llenarSelectProveedores() {
  const opciones = `<option value="">— Sin proveedor / Seleccionar —</option>` +
    (STATE.proveedores.filter(p => p.activo).map(p =>
      `<option value="${p.id}">${escHtml(p.nombre)}${p.telefono ? ' — '+escHtml(p.telefono) : ''}</option>`
    ).join(''));

  // Se llenan ambos selects (wizard normal + formulario rápido de
  // "Producto nuevo"); si alguno no existe en el DOM, se ignora.
  ['nc-proveedor-select', 'pn-proveedor-select'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = opciones;
  });
}

function onSelectProveedor() {
  const sel = document.getElementById('nc-proveedor-select');
  if (!sel) return;
  const id = sel.value;
  if (id) {
    STATE.proveedorSeleccionado = STATE.proveedores.find(p => p.id === id) || null;
    toggleNuevoProveedor(false);
  } else {
    STATE.proveedorSeleccionado = null;
  }
}

function toggleNuevoProveedor(mostrar) {
  const form = document.getElementById('nc-nuevo-proveedor-form');
  if (form) form.style.display = mostrar ? 'block' : 'none';
  if (mostrar) {
    const sel = document.getElementById('nc-proveedor-select');
    if (sel) sel.value = '';
    STATE.proveedorSeleccionado = null;
  }
}

async function guardarNuevoProveedorRapido() {
  const nombre = document.getElementById('nc-prov-nombre')?.value.trim();
  if (!nombre) { showToast('El nombre del proveedor es requerido', 'error'); return; }

  const payload = {
    auth_user_id: STATE.userId,
    nombre,
    telefono:     document.getElementById('nc-prov-telefono')?.value.trim() || null,
    email:        document.getElementById('nc-prov-email')?.value.trim()    || null,
    direccion:    document.getElementById('nc-prov-direccion')?.value.trim()|| null,
    observaciones:document.getElementById('nc-prov-obs')?.value.trim()      || null,
    activo: true,
  };

  try {
    setBtnLoading('btn-guardar-proveedor-rapido', true);
    const { data, error } = await sbClient.from('proveedores').insert(payload).select().single();
    if (error) throw error;
    STATE.proveedores.push(data);
    STATE.proveedorSeleccionado = data;
    llenarSelectProveedores();
    const sel = document.getElementById('nc-proveedor-select');
    if (sel) sel.value = data.id;
    toggleNuevoProveedor(false);
    showToast('Proveedor guardado');
  } catch(e) {
    showToast('Error al guardar proveedor: ' + (e.message || ''), 'error');
  } finally {
    setBtnLoading('btn-guardar-proveedor-rapido', false);
  }
}

/* =====================================================
   PASO 2 — BÚSQUEDA DE PRODUCTOS
===================================================== */
function buscarProductoNuevaCompra() {
  const q   = (document.getElementById('nc-producto-search')?.value || '').toLowerCase().trim();
  const res = document.getElementById('nc-search-results');
  if (!res) return;

  if (!q) { res.innerHTML = ''; return; }

  // Solo tipo PRODUCTO (nunca servicios) — ya filtrado en STATE.productos
  const filtrados = STATE.productos.filter(p =>
    p.nombre.toLowerCase().includes(q) ||
    (p.sku || '').toLowerCase().includes(q) ||
    (p.categoria || '').toLowerCase().includes(q)
  ).slice(0, 10);

  if (!filtrados.length) {
    res.innerHTML = `<div class="search-no-results">Sin resultados para "${escHtml(q)}"</div>`;
    return;
  }

  res.innerHTML = filtrados.map(p => `
    <div class="search-result-item" onclick="agregarProductoAlCarrito('${p.id}')">
      <div class="sri-info">
        <span class="sri-nombre">${escHtml(p.nombre)}</span>
        <span class="sri-meta">${p.sku ? 'SKU: '+escHtml(p.sku)+' · ' : ''}${p.categoria ? escHtml(p.categoria)+' · ' : ''}Stock: ${fmtNum(p.stock_actual)}</span>
      </div>
      <span class="sri-costo">${fmt(p.costo)}</span>
    </div>
  `).join('');
}

function agregarProductoAlCarrito(productoId) {
  const p = STATE.productos.find(x => x.id === productoId);
  if (!p) return;

  // Si ya está en el carrito, aumentar cantidad
  const existente = STATE.carrito.find(l => l.producto.id === productoId);
  if (existente) {
    existente.cantidad++;
    recalcularLinea(existente);
  } else {
    const linea = {
      producto:       p,
      cantidad:       1,
      costoUnitario:  Number(p.costo || 0),
      descuento:      0,
      ivaPorc:        STATE.ivaActivo ? STATE.ivaPorcentaje : 0,
      numeroLote:     '',
      fechaVencimiento: '',
    };
    recalcularLinea(linea);
    STATE.carrito.push(linea);
  }

  renderCarrito();
  actualizarResumen();

  // Limpiar búsqueda
  const sp = document.getElementById('nc-producto-search');
  const sr = document.getElementById('nc-search-results');
  if (sp) sp.value = '';
  if (sr) sr.innerHTML = '';
}

function recalcularLinea(linea) {
  const base      = linea.cantidad * linea.costoUnitario;
  const baseDesc  = base - (linea.descuento || 0);
  linea.ivaPorc   = STATE.ivaActivo ? STATE.ivaPorcentaje : 0;
  linea.ivaMonto  = baseDesc * (linea.ivaPorc / 100);
  linea.subtotal  = baseDesc + linea.ivaMonto;
}

/* =====================================================
   PASO 3 — CARRITO
===================================================== */
function renderCarrito() {
  const tbody = document.getElementById('carrito-tbody');
  if (!tbody) return;

  if (!STATE.carrito.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell" style="padding:24px">
          Busca y agrega productos en el paso anterior
        </td>
      </tr>`;
    return;
  }

  const manejaLotes = STATE.empresaConfig?.maneja_lotes_vencimiento === true;

  tbody.innerHTML = STATE.carrito.map((linea, idx) => `
    <tr>
      <td style="font-weight:500">${escHtml(linea.producto.nombre)}</td>
      <td>
        <input type="number" class="carrito-input" value="${linea.cantidad}"
          min="0.01" step="0.01"
          onchange="actualizarLineaCarrito(${idx},'cantidad',this.value)"
          style="width:70px"/>
      </td>
      <td>
        <input type="number" class="carrito-input" value="${linea.costoUnitario}"
          min="0" step="0.01"
          onchange="actualizarLineaCarrito(${idx},'costoUnitario',this.value)"
          style="width:90px"/>
      </td>
      <td>
        <input type="number" class="carrito-input" value="${linea.descuento}"
          min="0" step="0.01"
          onchange="actualizarLineaCarrito(${idx},'descuento',this.value)"
          style="width:80px"/>
      </td>
      <td class="td-right" style="font-size:12px;color:var(--text-muted)">
        ${linea.ivaPorc > 0 ? linea.ivaPorc+'%' : '—'}
      </td>
      <td class="td-right td-money">${fmt(linea.subtotal)}</td>
      <td>
        <button class="btn-icon btn-icon-danger" onclick="eliminarLineaCarrito(${idx})" title="Eliminar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>
    ${manejaLotes ? `
    <tr class="fila-lote">
      <td colspan="7" style="padding:4px 8px 10px;background:var(--bg-app)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px">
          <span style="color:var(--text-muted)">🏷️ Lote:</span>
          <input type="text" class="carrito-input" placeholder="Número de lote (opcional)" value="${escHtml(linea.numeroLote||'')}"
            onchange="actualizarLineaCarrito(${idx},'numeroLote',this.value)" style="width:150px"/>
          <span style="color:var(--text-muted)">Vence:</span>
          <input type="date" class="carrito-input" value="${linea.fechaVencimiento||''}"
            onchange="actualizarLineaCarrito(${idx},'fechaVencimiento',this.value)" style="width:150px"/>
        </div>
      </td>
    </tr>` : ''}
  `).join('');

  actualizarResumen();
}

function actualizarLineaCarrito(idx, campo, valor) {
  const linea = STATE.carrito[idx];
  if (!linea) return;
  // Antes esto convertía TODO a número con parseFloat — incluyendo la
  // fecha de vencimiento y el número de lote, que son texto. Una
  // fecha como "2026-08-20" se volvía "2026" a secas, y un lote como
  // "L-2026-08" se volvía 0. Ahora solo los campos numéricos de
  // verdad pasan por parseFloat.
  const camposNumericos = ['cantidad', 'costoUnitario', 'descuento'];
  linea[campo] = camposNumericos.includes(campo) ? (parseFloat(valor) || 0) : valor;
  if (camposNumericos.includes(campo)) recalcularLinea(linea);
  renderCarrito();
}

function eliminarLineaCarrito(idx) {
  STATE.carrito.splice(idx, 1);
  renderCarrito();
  actualizarResumen();
}

/* =====================================================
   IVA
===================================================== */
function toggleIVA(activo) {
  STATE.ivaActivo = activo;
  const wrap = document.getElementById('nc-iva-porcentaje-wrap');
  if (wrap) wrap.style.display = activo ? 'flex' : 'none';
  // Recalcular todas las líneas
  STATE.carrito.forEach(l => recalcularLinea(l));
  renderCarrito();
  actualizarResumen();
}

function actualizarIVAPorcentaje() {
  const val = parseFloat(document.getElementById('nc-iva-porcentaje')?.value || 15);
  STATE.ivaPorcentaje = isNaN(val) ? 15 : val;
  STATE.carrito.forEach(l => recalcularLinea(l));
  renderCarrito();
  actualizarResumen();
}

/* =====================================================
   PASO 4 — RESUMEN
===================================================== */
function calcularTotales() {
  let subtotal    = 0;
  let descTotal   = 0;
  let ivaTotal    = 0;
  STATE.carrito.forEach(l => {
    subtotal  += l.cantidad * l.costoUnitario;
    descTotal += l.descuento || 0;
    ivaTotal  += l.ivaMonto  || 0;
  });
  const total = subtotal - descTotal + ivaTotal;
  return { subtotal, descTotal, ivaTotal, total };
}

function actualizarResumen() {
  const { subtotal, descTotal, ivaTotal, total } = calcularTotales();
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  set('resumen-subtotal', fmt(subtotal));
  set('resumen-descuento', descTotal > 0 ? `-${fmt(descTotal)}` : '—');
  set('resumen-iva', ivaTotal > 0 ? fmt(ivaTotal) : '—');
  set('resumen-total', fmt(total));
  // Mini resumen en botón de guardar
  const totalBtn = document.getElementById('nc-total-preview');
  if (totalBtn) totalBtn.textContent = fmt(total);
}

/* =====================================================
   GUARDAR COMPRA — TRANSACCIÓN COMPLETA
===================================================== */
async function cargarBancosDisponiblesCompra() {
  if (_bancosCacheCompra) return _bancosCacheCompra;
  try {
    const { data } = await sbClient.from('bancos').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('created_at');
    _bancosCacheCompra = data || [];
  } catch (e) { _bancosCacheCompra = []; }
  return _bancosCacheCompra;
}

async function saldoActualBanco(bancoId) {
  const { data: movs } = await sbClient.from('movimientos_financieros')
    .select('tipo_flujo, monto, monto_moneda_banco').eq('auth_user_id', STATE.userId).eq('banco_id', bancoId).eq('estado', 'completado');
  const { data: banco } = await sbClient.from('bancos').select('saldo_inicial, moneda').eq('id', bancoId).single();
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (banco?.moneda||'NIO') !== monedaBase;
  const montoDe = (m) => esOtraMoneda ? Number(m.monto_moneda_banco ?? m.monto) : Number(m.monto);
  const suma = (movs||[]).reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? montoDe(m) : -montoDe(m)), 0);
  return Number(banco?.saldo_inicial||0) + suma;
}

async function mostrarSelectorBancoCompra(metodoPagoNombre) {
  // Detecta si está activo el formulario rápido de "producto nuevo"
  // o el asistente normal de "Nueva Compra" — cada uno tiene su
  // propio bloque de tarjetas de banco en el HTML, ya que viven en
  // secciones que se ocultan entre sí.
  const enProductoNuevo = document.getElementById('nc-form-producto-nuevo')?.style.display !== 'none';
  const prefijo = enProductoNuevo ? 'pn' : 'nc';

  const metodo = (metodoPagoNombre || '').toLowerCase();
  const elWrapElegir = document.getElementById(`${prefijo}-banco-elegir-wrap`);
  const elWrapElegido = document.getElementById(`nc-banco-elegido-wrap`); // solo existe en el asistente normal
  if (elWrapElegir) elWrapElegir.style.display = 'none';
  if (!enProductoNuevo && elWrapElegido) elWrapElegido.style.display = 'none';
  _bancoElegidoIdCompra = null; _montoBancoConvertidoCompra = null;
  if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;

  const bancos = await cargarBancosDisponiblesCompra();
  if (!bancos.length) return; // sin bancos creados, sigue todo normal

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const elMetodoTexto = document.getElementById(`${prefijo}-banco-elegir-metodo`);
  if (elMetodoTexto) elMetodoTexto.textContent = metodoPagoNombre;
  const elGrid = document.getElementById(`${prefijo}-banco-elegir-grid`);
  if (elGrid) elGrid.innerHTML = bancos.map(b => `
    <div class="metodo-card" onclick="elegirBancoCompra('${b.id}','${esc(b.nombre)}','${b.moneda||'NIO'}')">
      <span class="mc-icon">🏦</span>
      <span class="mc-name">${esc(b.nombre)}${(b.moneda||'NIO')!==monedaBase ? ` <b style="color:var(--accent)">(${b.moneda})</b>` : ''}</span>
    </div>`).join('');
  if (elWrapElegir) elWrapElegir.style.display = '';
}

async function elegirBancoCompra(bancoId, bancoNombre, monedaBanco) {
  const enProductoNuevo = document.getElementById('nc-form-producto-nuevo')?.style.display !== 'none';
  _bancoElegidoIdCompra = bancoId;

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (monedaBanco||'NIO') !== monedaBase;

  if (enProductoNuevo) {
    // En "producto nuevo" no hay una tarjeta de "banco elegido" aparte
    // — se oculta el selector y se continúa directo con el guardado,
    // ya con el banco (y su conversión, si aplica) ya calculados.
    document.getElementById('pn-banco-elegir-wrap').style.display = 'none';
    if (esOtraMoneda) {
      const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
      const costo = parseFloat(document.getElementById('pn-costo')?.value) || 0;
      const stock = parseFloat(document.getElementById('pn-stock')?.value) || 0;
      const total = costo * stock;
      if (tasa) _montoBancoConvertidoCompra = monedaBase === 'NIO' ? round2(total / tasa) : round2(total * tasa);
    }
    if (STATE.esperandoBancoParaProductoNuevo) await crearProductoYComprar();
    return;
  }

  document.getElementById('nc-banco-elegir-wrap').style.display = 'none';
  const { total } = calcularTotales();
  const elNombre = document.getElementById('nc-banco-elegido-nombre');

  if (esOtraMoneda) {
    const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) {
      elNombre.innerHTML = `${esc(bancoNombre)} <span style="color:var(--danger)">— falta configurar tu tasa de cambio en Caja › Bancos</span>`;
    } else {
      const montoConvertido = monedaBase === 'NIO' ? round2(total / tasa) : round2(total * tasa);
      _montoBancoConvertidoCompra = montoConvertido;
      elNombre.innerHTML = `${esc(bancoNombre)} — se descontará ${monedaBanco==='USD'?'$':'C$'} ${montoConvertido.toLocaleString('es-NI',{minimumFractionDigits:2})}`;
    }
  } else {
    elNombre.textContent = bancoNombre;
  }
  document.getElementById('nc-banco-elegido-wrap').style.display = 'flex';
}

function cancelarSeleccionBancoCompra() {
  const enProductoNuevo = document.getElementById('nc-form-producto-nuevo')?.style.display !== 'none';
  _bancoElegidoIdCompra = null; _montoBancoConvertidoCompra = null;
  STATE.esperandoBancoParaProductoNuevo = false;
  const prefijo = enProductoNuevo ? 'pn' : 'nc';
  document.getElementById(`${prefijo}-metodo-pago`).value = '';
  const elWrap = document.getElementById(`${prefijo}-banco-elegir-wrap`); if (elWrap) elWrap.style.display = 'none';
  if (!enProductoNuevo) document.getElementById('nc-banco-elegido-wrap').style.display = 'none';
  const banner = document.getElementById('pn-banco-espera-banner'); if (banner) banner.style.display = 'none';
}

function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }

/* =====================================================
   COMPRA DIRECTA — gasto de contado con un proveedor que NO es
   compra de mercancia. Nunca toca detalle_compras/productos --
   crea la cabecera de compra directo (es_directa=true) y el
   EGRESO en Caja, igual que una compra normal completada.
===================================================== */
function abrirCompraDirecta() {
  document.getElementById('cd-proveedor-select').innerHTML =
    `<option value="">— Sin proveedor —</option>` +
    (STATE.proveedores||[]).filter(p => p.activo !== false).map(p =>
      `<option value="${p.id}">${escHtml(p.nombre)}</option>`
    ).join('');
  document.getElementById('cd-nuevo-proveedor-form').style.display = 'none';
  document.getElementById('cd-prov-nombre').value = '';
  document.getElementById('cd-concepto').value = '';
  document.getElementById('cd-monto').value = '';
  document.getElementById('cd-fecha').value = todayISO();
  document.getElementById('cd-observaciones').value = '';
  document.getElementById('cd-error').textContent = '';
  document.getElementById('cd-origen-caja-wrap').style.display = 'none';
  STATE.proveedorSeleccionadoDirectaCompra = null;
  populateMetodosSelect();
  openModal('modal-compra-directa');

  hayCajaChicaAbiertaHoy().then(abierta => {
    document.getElementById('cd-origen-caja-wrap').style.display = abierta ? '' : 'none';
    if (abierta) document.getElementById('cd-origen-caja').value = 'chica';
  });
}

function onSelectProveedorDirectaCompra() {
  const id = document.getElementById('cd-proveedor-select')?.value;
  STATE.proveedorSeleccionadoDirectaCompra = id ? (STATE.proveedores.find(p => p.id === id) || null) : null;
  if (id) toggleNuevoProveedorDirectaCompra(false);
}

function toggleNuevoProveedorDirectaCompra(mostrar) {
  document.getElementById('cd-nuevo-proveedor-form').style.display = mostrar ? 'block' : 'none';
  if (mostrar) {
    document.getElementById('cd-proveedor-select').value = '';
    STATE.proveedorSeleccionadoDirectaCompra = null;
  }
}

async function guardarNuevoProveedorDirectaCompra() {
  const nombre = document.getElementById('cd-prov-nombre')?.value.trim();
  if (!nombre) { showToast('El nombre del proveedor es requerido', 'error'); return; }
  try {
    setBtnLoading('btn-guardar-proveedor-directa-compra', true);
    const { data, error } = await sbClient.from('proveedores')
      .insert({ auth_user_id: STATE.userId, nombre, activo: true }).select().single();
    if (error) throw error;
    STATE.proveedores.push(data);
    STATE.proveedorSeleccionadoDirectaCompra = data;
    document.getElementById('cd-proveedor-select').innerHTML =
      `<option value="">— Sin proveedor —</option>` +
      STATE.proveedores.filter(p => p.activo !== false).map(p => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('');
    document.getElementById('cd-proveedor-select').value = data.id;
    toggleNuevoProveedorDirectaCompra(false);
    showToast('Proveedor guardado');
  } catch (e) {
    showToast('Error al guardar proveedor: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-guardar-proveedor-directa-compra', false);
  }
}

async function guardarCompraDirecta() {
  const errEl = document.getElementById('cd-error');
  errEl.textContent = '';

  const concepto = document.getElementById('cd-concepto')?.value.trim();
  if (!concepto) { errEl.textContent = 'Escribe de qué es esta compra.'; return; }
  const monto = Number(document.getElementById('cd-monto')?.value);
  if (!monto || monto <= 0) { errEl.textContent = 'Escribe un monto válido.'; return; }
  const fecha = document.getElementById('cd-fecha')?.value;
  if (!fecha) { errEl.textContent = 'Elige la fecha.'; return; }

  let origenCaja = null;
  if (document.getElementById('cd-origen-caja-wrap').style.display !== 'none') {
    origenCaja = document.getElementById('cd-origen-caja').value;
    if (!origenCaja) { errEl.textContent = 'Indica de dónde sale este dinero.'; return; }
  }

  const metodoSel = document.getElementById('cd-metodo-pago');
  const metodoPagoId = metodoSel?.value || null;
  const metodoPagoNombre = metodoSel?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  const observaciones = document.getElementById('cd-observaciones')?.value.trim() || null;
  const proveedor = STATE.proveedorSeleccionadoDirectaCompra;

  setBtnLoading('cd-btn-guardar', true);
  try {
    const { data: numData } = await sbClient.rpc('siguiente_numero_compra', { p_user_id: STATE.userId });
    const numero = numData || ('C-' + String(Date.now()).slice(-6));

    // Cabecera de compra -- SIN detalle_compras, SIN tocar productos.
    // es_directa=true marca claramente que esta compra no tiene
    // lineas de producto, para que el detalle la muestre bien.
    const { data: compra, error: errCompra } = await sbClient.from('compras').insert({
      auth_user_id: STATE.userId, numero,
      proveedor_id: proveedor?.id || null, proveedor_nombre: proveedor?.nombre || null,
      fecha, subtotal: monto, descuento_total: 0, iva_porcentaje: 0, iva_monto: 0, total: monto,
      metodo_pago_id: metodoPagoId, metodo_pago_nombre: metodoPagoNombre,
      estado: 'completada', es_directa: true, concepto, observaciones,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (errCompra) throw errCompra;

    // Registrar el EGRESO en Caja -- mismo mecanismo exacto que una
    // compra normal completada (saldo encadenado real, no solo un
    // monto suelto).
    const { data: movResult } = await sbClient.from('movimientos_financieros')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado', 'completado')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const saldoAnt = movResult ? Number(movResult.saldo_resultante) : 0;
    const saldoRes = saldoAnt - monto;

    const { data: mov, error: errMov } = await sbClient.from('movimientos_financieros').insert({
      auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'COMPRA',
      concepto: `Compra directa ${numero} — ${concepto}`, monto,
      saldo_anterior: saldoAnt, saldo_resultante: saldoRes,
      metodo_pago_id: metodoPagoId, metodo_pago_nombre: metodoPagoNombre,
      origen_caja: origenCaja || null, referencia_tipo: 'compra', referencia_id: compra.id,
      observaciones: `Proveedor: ${proveedor?.nombre || 'Sin proveedor'}`, fecha,
    }).select().single();
    if (errMov) showToast('La compra se guardó, pero no se pudo registrar en Caja: ' + errMov.message, 'error');
    else await sbClient.from('compras').update({ movimiento_caja_id: mov.id }).eq('id', compra.id);

    // Métricas del proveedor -- igual que en una compra normal
    if (proveedor?.id) {
      await sbClient.from('proveedores').update({
        ultima_compra: fecha,
        monto_acumulado: Number(proveedor.monto_acumulado||0) + monto,
        total_compras: Number(proveedor.total_compras||0) + 1,
      }).eq('id', proveedor.id).eq('auth_user_id', STATE.userId);
    }

    closeModal('modal-compra-directa');
    showToast(`Compra directa ${compra.numero} registrada`);
    await Promise.allSettled([loadCompras(), loadProveedores()]);
  } catch (e) {
    console.error('guardarCompraDirecta:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('cd-btn-guardar', false);
  }
}

async function guardarCompra() {
  if (STATE.carrito.length === 0) {
    showToast('El carrito está vacío', 'error');
    return;
  }

  // Modo Orden de Compra: nunca toca Caja ni Inventario — se guarda
  // aparte, en su propia tabla, y esta función termina aquí.
  if (STATE.modoOrden) {
    await guardarOrdenCompra();
    return;
  }

  const { subtotal, descTotal, ivaTotal, total } = calcularTotales();
  const metodoPagoSel = document.getElementById('nc-metodo-pago');
  const metodoPagoId  = metodoPagoSel?.value || null;
  const metodoPagoNombre = metodoPagoSel?.options[metodoPagoSel.selectedIndex]?.getAttribute('data-nombre') || 'Efectivo';
  const estado        = document.getElementById('nc-estado')?.value || 'completada';
  const observaciones = document.getElementById('nc-observaciones')?.value.trim() || null;
  const fecha         = document.getElementById('nc-fecha')?.value || todayISO();

  // Obligatorio solo si hay Caja Chica abierta hoy y la compra queda
  // "completada" (afecta Caja de inmediato) — si no hay ninguna
  // abierta, el select ni se muestra y sale de la Caja general sin
  // preguntar nada, igual que siempre.
  let origenCaja = null;
  if (estado === 'completada' && document.getElementById('nc-origen-caja-wrap').style.display !== 'none') {
    origenCaja = document.getElementById('nc-origen-caja').value;
    if (!origenCaja) { showToast('Indica de dónde sale este dinero (Caja Chica o Caja General)', 'error'); return; }
  }

  // Si se eligió un banco para este egreso, se valida que tenga saldo
  // suficiente ANTES de guardar nada — a diferencia de un ingreso, un
  // banco específico nunca debería poder quedar en negativo.
  if (_bancoElegidoIdCompra && estado === 'completada') {
    const bancoInfo = (await cargarBancosDisponiblesCompra()).find(b => b.id === _bancoElegidoIdCompra);
    const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    const esOtraMoneda = bancoInfo && (bancoInfo.moneda||'NIO') !== monedaBase;
    if (esOtraMoneda && !STATE.empresaConfig?.tasa_cambio_usd) {
      showToast('Falta configurar tu tasa de cambio en Caja › Bancos antes de continuar', 'error');
      return;
    }
    const montoADescontar = esOtraMoneda ? _montoBancoConvertidoCompra : total;
    const saldoBanco = await saldoActualBanco(_bancoElegidoIdCompra);
    if (montoADescontar > saldoBanco + 0.01) {
      showToast(`Saldo insuficiente en ${bancoInfo?.nombre || 'ese banco'} — tiene ${saldoBanco.toLocaleString('es-NI',{minimumFractionDigits:2})} disponible`, 'error');
      return;
    }
  }

  setBtnLoading('nc-btn-save', true);

  try {
    // 1. Número de compra
    const { data: numData } = await sbClient
      .rpc('siguiente_numero_compra', { p_user_id: STATE.userId });
    const numero = numData || ('C-' + String(Date.now()).slice(-6));

    // 2. Crear cabecera de compra
    const { data: compra, error: errCompra } = await sbClient
      .from('compras')
      .insert({
        auth_user_id:       STATE.userId,
        numero,
        proveedor_id:       STATE.proveedorSeleccionado?.id || null,
        proveedor_nombre:   STATE.proveedorSeleccionado?.nombre || null,
        fecha,
        subtotal,
        descuento_total:    descTotal,
        iva_porcentaje:     STATE.ivaActivo ? STATE.ivaPorcentaje : 0,
        iva_monto:          ivaTotal,
        total,
        metodo_pago_id:     metodoPagoId  || null,
        metodo_pago_nombre: metodoPagoNombre,
        estado,
        observaciones,
        usuario_nombre:     STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
      })
      .select()
      .single();

    if (errCompra) throw errCompra;

    // 3. Insertar líneas de detalle y actualizar stock de productos
    for (const linea of STATE.carrito) {
      // Suma el stock de forma ATÓMICA, en un solo paso dentro de la
      // propia base de datos -- ya no se lee/calcula/escribe desde
      // aquí, eliminando de raíz el riesgo de basarse en un dato
      // viejo si algo más tocó este mismo producto al mismo tiempo.
      const stockAntesReferencia = Number(linea.producto.stock_actual || 0); // solo de referencia visual
      let stockDespues = stockAntesReferencia + Number(linea.cantidad);
      let stockAntes = stockAntesReferencia;

      const { data: resultadoStock, error: errStock } = await sbClient
        .rpc('incrementar_stock_producto', {
          p_producto_id: linea.producto.id,
          p_auth_user_id: STATE.userId,
          p_cantidad: Number(linea.cantidad),
        });

      if (!errStock && resultadoStock && resultadoStock.length) {
        // Caso normal: usa el valor REAL devuelto por la base de datos
        // (más confiable que cualquier cálculo hecho aquí en JS).
        stockDespues = Number(resultadoStock[0].stock_actual);
        stockAntes = round2(stockDespues - Number(linea.cantidad));
      } else {
        // Caso rarísimo: el producto no se encontró para actualizar.
        // NUNCA se le muestra esto al cliente ni se interrumpe su
        // compra -- queda registrado en silencio para que el dueño
        // del sistema lo revise con calma, sin arriesgar duplicar
        // inventario por una corrección tardía.
        try {
          await sbClient.from('log_stock_fallido').insert({
            auth_user_id: STATE.userId, compra_id: compra.id,
            producto_id: linea.producto.id, producto_nombre: linea.producto.nombre,
            cantidad_no_aplicada: linea.cantidad,
            motivo: errStock ? String(errStock.message || errStock) : 'La actualización no encontró el producto (0 filas afectadas)',
          });
        } catch (eLog) { console.warn('No se pudo registrar en log_stock_fallido:', eLog); }
      }

      // a. Detalle
      const { error: errDet } = await sbClient.from('detalle_compras').insert({
        auth_user_id:   STATE.userId,
        compra_id:      compra.id,
        producto_id:    linea.producto.id,
        producto_nombre:linea.producto.nombre,
        producto_sku:   linea.producto.sku || null,
        cantidad:       linea.cantidad,
        costo_unitario: linea.costoUnitario,
        descuento:      linea.descuento || 0,
        iva_porcentaje: linea.ivaPorc   || 0,
        iva_monto:      linea.ivaMonto  || 0,
        subtotal:       linea.subtotal,
        stock_antes:    stockAntes,
        stock_despues:  stockDespues,
      });
      if (errDet) throw errDet;

      // c. Registrar el lote (si el negocio activó Lotes y Vencimientos,
      // y se indicó una fecha de vencimiento para este producto). Esto
      // es una capa aparte — nunca afecta el stock_actual de arriba,
      // que ya se actualizó igual que siempre.
      if (STATE.empresaConfig?.maneja_lotes_vencimiento === true && linea.fechaVencimiento) {
        const { error: errLote } = await sbClient.from('producto_lotes').insert({
          auth_user_id:      STATE.userId,
          producto_id:       linea.producto.id,
          numero_lote:       linea.numeroLote || null,
          fecha_vencimiento: linea.fechaVencimiento,
          cantidad_inicial:  linea.cantidad,
          cantidad_actual:   linea.cantidad,
          costo_unitario:    linea.costoUnitario,
          compra_id:         compra.id,
        });
        if (errLote) console.warn('No se pudo registrar el lote (la compra y el stock ya quedaron bien):', errLote);
      }
    }

    // 4. Registrar movimiento en Caja (solo si estado = completada)
    // Compras → Caja (la arquitectura correcta)
    // Una compra transforma Dinero → Inventario
    // Resultado: Capital disponible disminuye. Ingresos NO cambian.
    if (estado === 'completada') {
      const { data: movResult } = await sbClient
        .from('movimientos_financieros')
        .select('saldo_resultante')
        .eq('auth_user_id', STATE.userId)
        .eq('estado', 'completado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const saldoAnt = movResult ? Number(movResult.saldo_resultante) : 0;
      const saldoRes = saldoAnt - total; // Compra = EGRESO

      const { data: mov, error: errMov } = await sbClient
        .from('movimientos_financieros')
        .insert({
          auth_user_id:       STATE.userId,
          tipo_flujo:         'EGRESO',
          tipo_movimiento:    'COMPRA',
          concepto:           `Compra ${numero}`,
          monto:              total,
          saldo_anterior:     saldoAnt,
          saldo_resultante:   saldoRes,
          metodo_pago_id:     metodoPagoId  || null,
          metodo_pago_nombre: metodoPagoNombre,
          banco_id:           _bancoElegidoIdCompra || null,
          monto_moneda_banco: _bancoElegidoIdCompra ? (_montoBancoConvertidoCompra ?? null) : null,
          origen_caja:        origenCaja || null,
          referencia_tipo:    'compra',
          referencia_id:      compra.id,
          observaciones:      `Proveedor: ${STATE.proveedorSeleccionado?.nombre || 'Sin proveedor'}`,
          fecha,
        })
        .select()
        .single();

      if (errMov) console.warn('Movimiento caja no registrado:', errMov);

      // Guardar referencia al movimiento en la compra
      if (mov) {
        await sbClient.from('compras')
          .update({ movimiento_caja_id: mov.id })
          .eq('id', compra.id);
      }
    }

    // 5. Actualizar métricas del proveedor
    if (STATE.proveedorSeleccionado?.id) {
      const prov = STATE.proveedorSeleccionado;
      await sbClient.from('proveedores').update({
        ultima_compra:  fecha,
        monto_acumulado: Number(prov.monto_acumulado || 0) + total,
        total_compras:  Number(prov.total_compras || 0) + 1,
      }).eq('id', prov.id).eq('auth_user_id', STATE.userId);
    }

    // 5.5. Si esta compra vino de convertir una Orden de Compra, se
    // marca esa orden como "convertida" y se enlaza a la compra real
    // resultante — así nunca se puede convertir la misma orden dos veces.
    if (STATE.ordenConvirtiendoId) {
      await sbClient.from('ordenes_compra')
        .update({ estado: 'convertida', compra_id: compra.id, updated_at: new Date().toISOString() })
        .eq('id', STATE.ordenConvirtiendoId).eq('auth_user_id', STATE.userId);
    }

    // 6. Cerrar modal y recargar
    closeModal('modal-nueva-compra');
    showToast(STATE.ordenConvirtiendoId ? `Orden convertida — Compra ${numero} registrada` : `Compra ${numero} registrada correctamente`);
    STATE.ordenConvirtiendoId = null;

    // Actualizar cache localStorage para que Dashboard lo lea desde Caja
    try {
      localStorage.setItem('n360_caja_updated', new Date().toISOString());
    } catch(e) {}

    await Promise.allSettled([loadKPIs(), loadCompras(), loadProveedores(), loadProductosDisponibles()]);

  } catch(e) {
    console.error('guardarCompra:', e);
    showToast('Error al guardar la compra: ' + (e.message || ''), 'error');
  } finally {
    setBtnLoading('nc-btn-save', false);
  }
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   ÓRDENES DE COMPRA — solicitud/cotización al proveedor. Nunca toca
   Caja ni Inventario. Se convierte en una Compra real (que sí lo
   hace) reutilizando exactamente guardarCompra().
   ============================================================ */
async function guardarOrdenCompra() {
  const { subtotal, descTotal, ivaTotal, total } = calcularTotales();
  const observaciones = document.getElementById('nc-observaciones')?.value.trim() || null;
  const fecha = document.getElementById('nc-fecha')?.value || todayISO();

  setBtnLoading('nc-btn-save', true);
  try {
    const { data: numData } = await sbClient.rpc('siguiente_numero_orden_compra', { p_user_id: STATE.userId });
    const numero = numData || ('OC-' + String(Date.now()).slice(-6));

    const { data: orden, error: errOrden } = await sbClient.from('ordenes_compra').insert({
      auth_user_id:     STATE.userId,
      numero,
      proveedor_id:      STATE.proveedorSeleccionado?.id || null,
      proveedor_nombre:  STATE.proveedorSeleccionado?.nombre || null,
      fecha,
      subtotal, descuento_total: descTotal, iva_porcentaje: STATE.ivaActivo ? STATE.ivaPorcentaje : 0,
      iva_monto: ivaTotal, total,
      estado: 'pendiente',
      observaciones,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (errOrden) throw errOrden;

    const detallesPayload = STATE.carrito.map(l => ({
      auth_user_id: STATE.userId, orden_compra_id: orden.id,
      producto_id: l.producto.id, producto_nombre: l.producto.nombre, producto_sku: l.producto.sku || null,
      cantidad: l.cantidad, costo_unitario: l.costoUnitario, descuento: l.descuento || 0,
      iva_porcentaje: l.ivaPorc || 0, iva_monto: l.ivaMonto || 0, subtotal: l.subtotal,
    }));
    const { error: errDet } = await sbClient.from('orden_compra_detalles').insert(detallesPayload);
    if (errDet) throw errDet;

    closeModal('modal-nueva-compra');
    showToast(`Orden de compra ${numero} guardada — no afecta Caja ni Inventario`);
    STATE.modoOrden = false;
    await cargarOrdenesCompra();
  } catch (e) {
    console.error('guardarOrdenCompra:', e);
    showToast('Error al guardar la orden: ' + (e.message || ''), 'error');
  } finally {
    setBtnLoading('nc-btn-save', false);
  }
}

async function cargarOrdenesCompra() {
  const tbody = document.getElementById('ordenes-tbody');
  try {
    const { data, error } = await sbClient.from('ordenes_compra')
      .select('*, orden_compra_detalles(id)').eq('auth_user_id', STATE.userId)
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    STATE.ordenesCompra = data || [];
    renderOrdenesCompra();
  } catch (e) {
    console.error('cargarOrdenesCompra:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No se pudieron cargar las órdenes</td></tr>`;
  }
}

function renderOrdenesCompra() {
  const tbody = document.getElementById('ordenes-tbody');
  if (!tbody) return;
  if (!STATE.ordenesCompra.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Todavía no has creado ninguna orden de compra</td></tr>`;
    return;
  }
  const badgeEstado = { pendiente: 'badge-pendiente', convertida: 'badge-activo', cancelada: 'badge-inactivo' };
  const labelEstado  = { pendiente: 'Pendiente', convertida: 'Convertida', cancelada: 'Cancelada' };

  tbody.innerHTML = STATE.ordenesCompra.map(o => `
    <tr>
      <td style="font-weight:600">${esc(o.numero)}</td>
      <td>${fmtDate(o.fecha)}</td>
      <td>${esc(o.proveedor_nombre || 'Sin proveedor')}</td>
      <td>${(o.orden_compra_detalles || []).length} producto(s)</td>
      <td class="th-right">${fmt(o.total)}</td>
      <td><span class="status-badge ${badgeEstado[o.estado] || ''}">${labelEstado[o.estado] || o.estado}</span></td>
      <td class="td-actions">
        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end">
          <button class="btn-icon" title="Descargar PDF" onclick="exportarPDFOrdenCompra('${o.id}')">📄</button>
          ${o.estado === 'pendiente' ? `
            <button class="btn-secondary" style="padding:6px 10px;font-size:12px" onclick="convertirOrdenACompra('${o.id}')">✅ Convertir en Compra</button>
            <button class="btn-icon btn-icon-danger" title="Cancelar orden" onclick="cancelarOrdenCompra('${o.id}')">🗑️</button>
          ` : ''}
        </div>
      </td>
    </tr>`).join('');
}

// Trae la orden + sus productos, y los deja listos en el mismo
// carrito que usa "Nueva Compra" — así el usuario solo revisa y
// confirma, sin volver a escribir nada. Al guardar, se llama a la
// MISMA guardarCompra() de siempre (la que sí toca Caja e Inventario).
async function convertirOrdenACompra(ordenId) {
  try {
    const { data: orden, error: errOrden } = await sbClient.from('ordenes_compra')
      .select('*').eq('id', ordenId).eq('auth_user_id', STATE.userId).maybeSingle();
    if (errOrden) throw errOrden;
    if (!orden) { showToast('Orden no encontrada', 'error'); return; }
    if (orden.estado !== 'pendiente') { showToast('Esta orden ya no está pendiente', 'error'); return; }

    const { data: detalles, error: errDet } = await sbClient.from('orden_compra_detalles')
      .select('*').eq('orden_compra_id', ordenId);
    if (errDet) throw errDet;

    // Se reconstruye cada línea del carrito con el producto ACTUAL
    // (precio/stock de hoy) — si algún producto ya no existe, se avisa
    // y se omite esa línea en vez de romper toda la conversión.
    const productosDisponibles = STATE.productos || [];
    const carritoReconstruido = [];
    const faltantes = [];
    for (const d of (detalles || [])) {
      const prod = productosDisponibles.find(p => p.id === d.producto_id);
      if (!prod) { faltantes.push(d.producto_nombre); continue; }
      const linea = {
        producto: prod, cantidad: Number(d.cantidad), costoUnitario: Number(d.costo_unitario),
        descuento: Number(d.descuento) || 0, ivaPorc: 0, ivaMonto: 0, subtotal: 0,
      };
      recalcularLinea(linea);
      carritoReconstruido.push(linea);
    }
    if (faltantes.length) {
      showToast(`${faltantes.length} producto(s) de la orden ya no existen y se omitieron: ${faltantes.join(', ')}`, 'warning');
    }
    if (!carritoReconstruido.length) {
      showToast('Ningún producto de esta orden sigue disponible para comprar', 'error');
      return;
    }

    STATE.carrito = carritoReconstruido;
    STATE.proveedorSeleccionado = orden.proveedor_id ? { id: orden.proveedor_id, nombre: orden.proveedor_nombre } : null;
    STATE.ivaActivo = Number(orden.iva_porcentaje) > 0;
    STATE.ivaPorcentaje = Number(orden.iva_porcentaje) || 15;
    STATE.metodoPagoSeleccionado = null;
    STATE.estadoCompra = 'completada';
    STATE.observacionesCompra = `Desde orden ${orden.numero}`;
    STATE.modoOrden = false; // ¡ojo! esto YA se guarda como compra real
    STATE.ordenConvirtiendoId = ordenId;
    STATE.pasoActual = 1;

    resetNuevaCompraUI();
    actualizarTextosModoOrden();
    if (typeof llenarSelectProveedores === 'function') llenarSelectProveedores();
    const selProv = document.getElementById('nc-proveedor-select');
    if (selProv && STATE.proveedorSeleccionado?.id) selProv.value = STATE.proveedorSeleccionado.id;
    openModal('modal-nueva-compra');
    // Se salta directo al carrito ya lleno — el usuario revisa/ajusta
    // y avanza normalmente por el resto del asistente (método de pago,
    // observaciones, etc.) hasta confirmar en el último paso.
    irAPaso(3);
    renderCarrito();

    hayCajaChicaAbiertaHoy().then(abierta => {
      STATE.cajaChicaAbiertaHoy = abierta;
      toggleOrigenCajaCompra();
    });
  } catch (e) {
    console.error('convertirOrdenACompra:', e);
    showToast('No se pudo cargar la orden: ' + (e.message || ''), 'error');
  }
}

async function cancelarOrdenCompra(ordenId) {
  if (!confirm('¿Cancelar esta orden de compra? Como nunca tocó Caja ni Inventario, no hay nada financiero que revertir.')) return;
  try {
    const { error } = await sbClient.from('ordenes_compra')
      .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
      .eq('id', ordenId).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Orden cancelada');
    await cargarOrdenesCompra();
  } catch (e) {
    showToast('Error al cancelar: ' + (e.message || ''), 'error');
  }
}

// Calcula el tamaño real que debe dibujarse el logo dentro de un
// espacio máximo (maxAncho x maxAlto), respetando su proporción
// original — nunca lo estira ni lo aplasta.
function ajustarLogoSinDeformar(anchoNatural, altoNatural, maxAncho, maxAlto) {
  const escala = Math.min(maxAncho / (anchoNatural || 1), maxAlto / (altoNatural || 1));
  return { w: Math.round((anchoNatural || 1) * escala * 100) / 100, h: Math.round((altoNatural || 1) * escala * 100) / 100 };
}

// Recorta el espacio transparente sobrante alrededor del logo real
// (muy común en PNG exportados desde herramientas de diseño, que
// dejan mucho margen invisible) — sin esto, agrandar la "caja" no
// sirve de nada porque se agranda TODO el lienzo, relleno incluido,
// y el logo visible se queda igual de chiquito dentro.
function recortarTransparenciaLogo(dataUrl, formato) {
  return new Promise((resolve) => {
    if (formato !== 'PNG' && formato !== 'WEBP') { resolve(null); return; } // JPEG no tiene transparencia que recortar
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

        let minX = width, minY = height, maxX = 0, maxY = 0, encontrado = false;
        const UMBRAL_ALPHA = 10; // ignora píxeles casi invisibles (antialiasing)
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha > UMBRAL_ALPHA) {
              encontrado = true;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        // Si no hay nada transparente que recortar (ya ocupa todo el
        // lienzo), o la imagen resultó vacía, se deja como estaba.
        if (!encontrado || (minX === 0 && minY === 0 && maxX === width-1 && maxY === height-1)) { resolve(null); return; }

        const anchoRecorte = maxX - minX + 1, altoRecorte = maxY - minY + 1;
        const cv2 = document.createElement('canvas');
        cv2.width = anchoRecorte; cv2.height = altoRecorte;
        cv2.getContext('2d').drawImage(canvas, minX, minY, anchoRecorte, altoRecorte, 0, 0, anchoRecorte, altoRecorte);
        resolve({ dataUrl: cv2.toDataURL('image/png'), anchoNatural: anchoRecorte, altoNatural: altoRecorte });
      } catch (e) { resolve(null); } // si algo falla (imagen de otro dominio, etc.), se usa la original sin recortar
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function cargarLogoParaPDF() {
  const url = STATE.empresaConfig?.logo_principal_url || STATE.empresaConfig?.logo_url;
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
    if (!formato) return null;
    // Se mide el tamaño REAL de la imagen — sin esto, el logo se
    // estira o se aplasta para encajar en un cuadro fijo si no es
    // cuadrado (la mayoría de logos no lo son).
    const { anchoNatural, altoNatural } = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ anchoNatural: img.naturalWidth || 1, altoNatural: img.naturalHeight || 1 });
      img.onerror = () => resolve({ anchoNatural: 1, altoNatural: 1 });
      img.src = dataUrl;
    });

    const recortado = await recortarTransparenciaLogo(dataUrl, formato);
    if (recortado) return { dataUrl: recortado.dataUrl, formato: 'PNG', anchoNatural: recortado.anchoNatural, altoNatural: recortado.altoNatural };

    return { dataUrl, formato, anchoNatural, altoNatural };
  } catch (e) {
    console.warn('No se pudo cargar el logo para el PDF:', e);
    return null;
  }
}

async function exportarPDFOrdenCompra(ordenId) {
  try {
    if (!window.jspdf) throw new Error('jsPDF no está disponible');
    const { data: orden } = await sbClient.from('ordenes_compra').select('*').eq('id', ordenId).eq('auth_user_id', STATE.userId).maybeSingle();
    const { data: items } = await sbClient.from('orden_compra_detalles').select('*').eq('orden_compra_id', ordenId);
    if (!orden) { showToast('Orden no encontrada', 'error'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 14;
    const logo = await cargarLogoParaPDF();
    if (!STATE.configDocumentos) await cargarConfigDocumentos();
    const cfg = STATE.configDocumentos;

    const biz = {
      nombre:    STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio',
      direccion: cfg.mostrar_direccion !== false ? (STATE.empresaConfig?.direccion || '') : '',
      telefono:  cfg.mostrar_telefono !== false ? (STATE.empresaConfig?.telefono || STATE.empresaConfig?.whatsapp || '') : '',
      ruc:       cfg.mostrar_ruc !== false ? (STATE.empresaConfig?.ruc || '') : '',
    };

    const [rC, gC, bC] = hexARgbDocumentos(cfg.color_principal) || [108, 99, 255];
    doc.setFillColor(rC, gC, bC);
    doc.rect(0, 0, W, 38, 'F');
    let textoX = M;
    const TAMANOS_LOGO = { pequeno: {ancho:32, alto:22}, mediano: {ancho:45, alto:28}, grande: {ancho:58, alto:34} };
    const cajaLogo = TAMANOS_LOGO[cfg.logo_tamano] || TAMANOS_LOGO.mediano;
    if (logo) {
      try {
        const { w, h } = ajustarLogoSinDeformar(logo.anchoNatural, logo.altoNatural, cajaLogo.ancho, cajaLogo.alto);
        doc.addImage(logo.dataUrl, logo.formato, M, (38-h)/2, w, h);
        textoX = M + w + 6;
      } catch (e) {}
    }
    doc.setTextColor(255,255,255);
    const anchoDisponibleNombre = (W - M - 40) - textoX;
    let tamanoNombre = 20;
    doc.setFont(undefined,'bold');
    while (tamanoNombre > 12) {
      doc.setFontSize(tamanoNombre);
      if (doc.getTextWidth(biz.nombre) <= anchoDisponibleNombre) break;
      tamanoNombre -= 1;
    }
    doc.text(biz.nombre, textoX, 20);
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    doc.text('Orden de Compra', textoX, 29);
    doc.setFontSize(9);
    doc.text(`N.º ${orden.numero}`, W - M, 18, { align:'right' });
    doc.text(`Fecha: ${fmtDate(orden.fecha)}`, W - M, 24, { align:'right' });

    let y = 50;
    doc.setTextColor(20,20,30);
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(90,90,110);
    const infoNegocio = [biz.direccion, biz.telefono ? `Tel: ${biz.telefono}` : '', biz.ruc ? `RUC: ${biz.ruc}` : ''].filter(Boolean);
    infoNegocio.forEach((linea, i) => doc.text(linea, M, y + i*5));

    doc.setFontSize(10); doc.setFont(undefined,'bold'); doc.setTextColor(20,20,30);
    doc.text('Proveedor', W - M - 70, y);
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(90,90,110);
    doc.text(orden.proveedor_nombre || 'Sin proveedor', W - M - 70, y + 5);

    y += Math.max(infoNegocio.length, 2) * 5 + 10;
    doc.setDrawColor(230,230,235);
    doc.line(M, y, W - M, y);
    y += 8;

    doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(rC, gC, bC);
    doc.text(`Estado: ${orden.estado === 'pendiente' ? 'Pendiente' : orden.estado === 'convertida' ? 'Convertida en compra' : 'Cancelada'}`, M, y);
    y += 10;

    const filas = (items||[]).map(it => [
      it.producto_nombre || 'Ítem',
      Number(it.cantidad).toLocaleString('es-NI', { maximumFractionDigits: 2 }),
      fmt(it.costo_unitario),
      Number(it.descuento) > 0 ? fmt(it.descuento) : '—',
      fmt(it.subtotal),
    ]);
    doc.autoTable({
      startY: y,
      head: [['Descripción', 'Cant.', 'Costo unit.', 'Descuento', 'Subtotal']],
      body: filas,
      theme: 'grid',
      headStyles: { fillColor: hexARgbDocumentos(cfg.color_tabla_usa_mismo !== false ? cfg.color_principal : cfg.color_tabla) || [108,99,255], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: M, right: M },
    });

    let yTot = doc.lastAutoTable.finalY + 8;
    const totalesFilas = [
      ['Subtotal', fmt(orden.subtotal)],
      ...(Number(orden.descuento_total) > 0 ? [['Descuento', '-' + fmt(orden.descuento_total)]] : []),
      ...(Number(orden.iva_monto) > 0 ? [[`Impuesto (${Number(orden.iva_porcentaje)}%)`, fmt(orden.iva_monto)]] : []),
    ];
    doc.setFontSize(9.5); doc.setFont(undefined,'normal'); doc.setTextColor(60,60,70);
    totalesFilas.forEach(([label, val], i) => {
      doc.text(label, W - M - 55, yTot + i*6);
      doc.text(val, W - M, yTot + i*6, { align:'right' });
    });
    yTot += totalesFilas.length * 6 + 3;
    doc.setDrawColor(220,220,225);
    doc.line(W - M - 55, yTot, W - M, yTot);
    yTot += 7;
    doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(20,20,30);
    doc.text('TOTAL', W - M - 55, yTot);
    doc.text(fmt(orden.total), W - M, yTot, { align:'right' });

    if (orden.observaciones) {
      yTot += 14;
      doc.setFontSize(8.5); doc.setFont(undefined,'italic'); doc.setTextColor(110,110,110);
      const obsLineas = doc.splitTextToSize(`Nota: ${orden.observaciones}`, W - M*2);
      obsLineas.forEach((ln, i) => doc.text(ln, M, yTot + i*4.5));
      yTot += obsLineas.length * 4.5;
    }

    if (cfg.mensaje_pie) {
      yTot += 10;
      doc.setFontSize(8.5); doc.setFont(undefined,'normal'); doc.setTextColor(90,90,110);
      const lineasPie = doc.splitTextToSize(cfg.mensaje_pie, W - M*2);
      lineasPie.forEach((ln, i) => doc.text(ln, M, yTot + i*4.5));
    }

    doc.save(`Orden_Compra_${orden.numero}.pdf`);
  } catch (e) {
    console.error('exportarPDFOrdenCompra:', e);
    showToast('No se pudo generar el PDF: ' + (e.message || ''), 'error');
  }
}

/* =====================================================
   ANULAR COMPRA
===================================================== */
let compraToAnular = null;

function confirmarAnularCompra(id) {
  compraToAnular = id;
  openModal('modal-confirmar-anular');
}

/* =====================================================
   COMPLETAR COMPRA — pasar de "pendiente" a "completada",
   descontando de Caja recién en este momento. Reutiliza
   cargarBancosDisponiblesCompra() y saldoActualBanco(), ya
   construidas para la creación de una compra nueva.
===================================================== */
function abrirCompletarCompra(id) {
  compraToCompletar = id;
  _bancoElegidoIdCompletar = null; _montoBancoConvertidoCompletar = null;
  document.getElementById('cc-error').textContent = '';
  document.getElementById('cc-banco-elegir-wrap').style.display = 'none';
  document.getElementById('cc-banco-elegido-wrap').style.display = 'none';

  const opciones = STATE.metodosPago && STATE.metodosPago.length
    ? STATE.metodosPago.map(m => `<option value="${m.id||''}" data-nombre="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`).join('')
    : '<option value="" data-nombre="Efectivo">Efectivo</option>';
  document.getElementById('cc-metodo-pago').innerHTML = opciones;

  openModal('modal-completar-compra');
}

async function mostrarSelectorBancoCompletar(metodoPagoNombre) {
  const metodo = (metodoPagoNombre || '').toLowerCase();
  document.getElementById('cc-banco-elegir-wrap').style.display = 'none';
  document.getElementById('cc-banco-elegido-wrap').style.display = 'none';
  _bancoElegidoIdCompletar = null; _montoBancoConvertidoCompletar = null;
  if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;

  const bancos = await cargarBancosDisponiblesCompra();
  if (!bancos.length) return;

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  document.getElementById('cc-banco-elegir-grid').innerHTML = bancos.map(b => `
    <div class="metodo-card" onclick="elegirBancoCompletar('${b.id}','${esc(b.nombre)}','${b.moneda||'NIO'}')">
      <span class="mc-icon">🏦</span>
      <span class="mc-name">${esc(b.nombre)}${(b.moneda||'NIO')!==monedaBase ? ` <b style="color:var(--accent)">(${b.moneda})</b>` : ''}</span>
    </div>`).join('');
  document.getElementById('cc-banco-elegir-wrap').style.display = '';
}

function elegirBancoCompletar(bancoId, bancoNombre, monedaBanco) {
  _bancoElegidoIdCompletar = bancoId;
  document.getElementById('cc-banco-elegir-wrap').style.display = 'none';

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (monedaBanco||'NIO') !== monedaBase;
  const compra = STATE.compras.find(c => c.id === compraToCompletar);
  const total = compra ? Number(compra.total) : 0;
  const elNombre = document.getElementById('cc-banco-elegido-nombre');

  if (esOtraMoneda) {
    const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) {
      elNombre.innerHTML = `${esc(bancoNombre)} <span style="color:var(--danger)">— falta configurar tu tasa de cambio en Caja › Bancos</span>`;
    } else {
      const convertido = monedaBase === 'NIO' ? round2(total / tasa) : round2(total * tasa);
      _montoBancoConvertidoCompletar = convertido;
      elNombre.innerHTML = `${esc(bancoNombre)} — se descontará ${monedaBanco==='USD'?'$':'C$'} ${convertido.toLocaleString('es-NI',{minimumFractionDigits:2})}`;
    }
  } else {
    elNombre.textContent = bancoNombre;
  }
  document.getElementById('cc-banco-elegido-wrap').style.display = 'flex';
}

function cancelarSeleccionBancoCompletar() {
  _bancoElegidoIdCompletar = null; _montoBancoConvertidoCompletar = null;
  document.getElementById('cc-metodo-pago').value = '';
  document.getElementById('cc-banco-elegir-wrap').style.display = 'none';
  document.getElementById('cc-banco-elegido-wrap').style.display = 'none';
}

async function completarCompra() {
  const errEl = document.getElementById('cc-error');
  errEl.textContent = '';
  if (!compraToCompletar) return;

  const compra = STATE.compras.find(c => c.id === compraToCompletar);
  if (!compra) { errEl.textContent = 'No se encontró la compra.'; return; }

  const metodoSel = document.getElementById('cc-metodo-pago');
  const metodoPagoId = metodoSel.value || null;
  const metodoPagoNombre = metodoSel.selectedOptions[0]?.dataset.nombre || 'Efectivo';

  // Mismo candado de saldo insuficiente que ya usa la compra nueva.
  if (_bancoElegidoIdCompletar) {
    const bancoInfo = (await cargarBancosDisponiblesCompra()).find(b => b.id === _bancoElegidoIdCompletar);
    const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    const esOtraMoneda = bancoInfo && (bancoInfo.moneda||'NIO') !== monedaBase;
    if (esOtraMoneda && !STATE.empresaConfig?.tasa_cambio_usd) {
      errEl.textContent = 'Falta configurar tu tasa de cambio en Caja › Bancos antes de continuar.';
      return;
    }
    const montoADescontar = esOtraMoneda ? _montoBancoConvertidoCompletar : Number(compra.total);
    const saldoBanco = await saldoActualBanco(_bancoElegidoIdCompletar);
    if (montoADescontar > saldoBanco + 0.01) {
      errEl.textContent = `Saldo insuficiente en ${bancoInfo?.nombre || 'ese banco'} — tiene ${saldoBanco.toLocaleString('es-NI',{minimumFractionDigits:2})} disponible.`;
      return;
    }
  }

  setBtnLoading('btn-confirmar-completar', true);
  try {
    const { data: movResult } = await sbClient.from('movimientos_financieros')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado', 'completado')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const saldoAnt = movResult ? Number(movResult.saldo_resultante) : 0;
    const saldoRes = saldoAnt - Number(compra.total);

    const { data: mov, error: errMov } = await sbClient.from('movimientos_financieros').insert({
      auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'COMPRA',
      concepto: `Compra ${compra.numero}${compra.proveedor_nombre ? ' — ' + compra.proveedor_nombre : ''}`,
      monto: compra.total, saldo_anterior: saldoAnt, saldo_resultante: saldoRes,
      metodo_pago_id: metodoPagoId, metodo_pago_nombre: metodoPagoNombre,
      banco_id: _bancoElegidoIdCompletar || null,
      monto_moneda_banco: _bancoElegidoIdCompletar ? (_montoBancoConvertidoCompletar ?? null) : null,
      referencia_tipo: 'compra', referencia_id: compra.id,
      fecha: todayISO(), estado: 'completado',
    }).select('id').single();
    if (errMov) throw errMov;

    const { error: errUpdate } = await sbClient.from('compras').update({
      estado: 'completada', movimiento_caja_id: mov.id,
      metodo_pago_id: metodoPagoId, metodo_pago_nombre: metodoPagoNombre,
    }).eq('id', compra.id).eq('auth_user_id', STATE.userId);
    if (errUpdate) throw errUpdate;

    showToast('Compra completada — se descontó de Caja');
    closeModal('modal-completar-compra');
    compraToCompletar = null;
    await Promise.allSettled([loadKPIs(), loadCompras()]);
  } catch (e) {
    console.error('completarCompra:', e);
    errEl.textContent = 'No se pudo completar la compra. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-confirmar-completar', false);
  }
}

async function anularCompra() {
  if (!compraToAnular) return;
  setBtnLoading('btn-confirmar-anular', true);

  try {
    const compra = STATE.compras.find(c => c.id === compraToAnular);
    if (!compra) throw new Error('Compra no encontrada');

    // 1. Obtener líneas de detalle para revertir stock
    const { data: lineas } = await sbClient
      .from('detalle_compras')
      .select('*')
      .eq('compra_id', compraToAnular);

    // 2. Revertir stock de cada producto
    for (const linea of (lineas || [])) {
      const { data: prod } = await sbClient
        .from('productos')
        .select('stock_actual')
        .eq('id', linea.producto_id)
        .maybeSingle();

      if (prod) {
        const stockRevertido = Math.max(0, Number(prod.stock_actual) - Number(linea.cantidad));
        await sbClient.from('productos')
          .update({ stock_actual: stockRevertido, updated_at: new Date().toISOString() })
          .eq('id', linea.producto_id)
          .eq('auth_user_id', STATE.userId);
      }
    }

    // 3. Anular movimiento de caja si existe
    if (compra.movimiento_caja_id) {
      await sbClient.from('movimientos_financieros')
        .update({
          estado:        'anulado',
          anulado_en:    new Date().toISOString(),
          anulado_motivo: `Compra ${compra.numero} anulada`,
        })
        .eq('id', compra.movimiento_caja_id)
        .eq('auth_user_id', STATE.userId);
    }

    // 4. Cambiar estado compra a anulada
    await sbClient.from('compras')
      .update({
        estado:         'anulada',
        anulada_en:     new Date().toISOString(),
        anulada_motivo: 'Anulada manualmente',
      })
      .eq('id', compraToAnular)
      .eq('auth_user_id', STATE.userId);

    closeModal('modal-confirmar-anular');
    closeModal('modal-detalle');
    compraToAnular = null;
    showToast('Compra anulada. Stock revertido.');

    await Promise.allSettled([loadKPIs(), loadCompras(), loadProveedores()]);
  } catch(e) {
    showToast('Error al anular: ' + (e.message || ''), 'error');
  } finally {
    setBtnLoading('btn-confirmar-anular', false);
  }
}

/* =====================================================
   PROVEEDORES — Lista y CRUD
===================================================== */
function renderProveedoresList() {
  const tbody = document.getElementById('proveedores-tbody');
  if (!tbody) return;

  const q = STATE.proveedoresSearch.toLowerCase().trim();
  const filtrados = STATE.proveedores.filter(p =>
    !q ||
    p.nombre.toLowerCase().includes(q) ||
    (p.email || '').toLowerCase().includes(q) ||
    (p.telefono || '').toLowerCase().includes(q)
  );

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Sin proveedores registrados</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(p => `
    <tr>
      <td style="font-weight:600">${escHtml(p.nombre)}</td>
      <td style="color:var(--text-secondary)">${escHtml(p.telefono || '—')}</td>
      <td style="color:var(--text-secondary)">${escHtml(p.email || '—')}</td>
      <td style="color:var(--text-secondary);font-size:12px">${escHtml(p.direccion || '—')}</td>
      <td style="color:var(--text-secondary)">${p.ultima_compra ? fmtDate(p.ultima_compra) : '—'}</td>
      <td class="td-right td-money">${fmt(p.monto_acumulado || 0)}</td>
      <td>
        <span class="status-badge ${p.activo ? 'badge-activo' : 'badge-inactivo'}">
          ${p.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td class="td-actions">
        <button class="btn-icon" onclick="abrirEditarProveedor('${p.id}')" title="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon ${p.activo ? 'btn-icon-danger' : 'btn-icon-success'}"
          onclick="toggleProveedorActivo('${p.id}',${!p.activo})" title="${p.activo ? 'Desactivar' : 'Activar'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${p.activo
              ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
              : '<polyline points="20 6 9 17 4 12"/>'}
          </svg>
        </button>
        <button class="btn-icon btn-icon-danger" onclick="abrirEliminarProveedor('${p.id}')" title="Eliminar proveedor">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function abrirNuevoProveedor() {
  document.getElementById('prov-modal-title').textContent = 'Nuevo proveedor';
  document.getElementById('prov-id').value       = '';
  ['prov-nombre','prov-telefono','prov-email','prov-direccion','prov-obs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  openModal('modal-proveedor');
}

function abrirEditarProveedor(id) {
  const p = STATE.proveedores.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prov-modal-title').textContent = 'Editar proveedor';
  document.getElementById('prov-id').value           = p.id;
  document.getElementById('prov-nombre').value        = p.nombre || '';
  document.getElementById('prov-telefono').value      = p.telefono || '';
  document.getElementById('prov-email').value         = p.email || '';
  document.getElementById('prov-direccion').value     = p.direccion || '';
  document.getElementById('prov-obs').value           = p.observaciones || '';
  openModal('modal-proveedor');
}

async function saveProveedor() {
  const id     = document.getElementById('prov-id')?.value.trim();
  const nombre = document.getElementById('prov-nombre')?.value.trim();
  if (!nombre) { showToast('El nombre es requerido', 'error'); return; }

  const payload = {
    nombre,
    telefono:     document.getElementById('prov-telefono')?.value.trim()  || null,
    email:        document.getElementById('prov-email')?.value.trim()      || null,
    direccion:    document.getElementById('prov-direccion')?.value.trim()  || null,
    observaciones:document.getElementById('prov-obs')?.value.trim()        || null,
  };

  try {
    setBtnLoading('btn-save-proveedor', true);
    if (id) {
      await sbClient.from('proveedores').update(payload)
        .eq('id', id).eq('auth_user_id', STATE.userId);
    } else {
      await sbClient.from('proveedores')
        .insert({ ...payload, auth_user_id: STATE.userId, activo: true });
    }
    closeModal('modal-proveedor');
    showToast(id ? 'Proveedor actualizado' : 'Proveedor creado');
    await loadProveedores();
  } catch(e) {
    showToast('Error al guardar proveedor', 'error');
  } finally {
    setBtnLoading('btn-save-proveedor', false);
  }
}

async function toggleProveedorActivo(id, activo) {
  try {
    await sbClient.from('proveedores').update({ activo })
      .eq('id', id).eq('auth_user_id', STATE.userId);
    await loadProveedores();
    showToast(activo ? 'Proveedor activado' : 'Proveedor desactivado');
  } catch(e) { showToast('Error al actualizar', 'error'); }
}

/* =====================================================
   ELIMINAR PROVEEDOR — pide confirmar mostrando ANTES los productos
   vinculados (si tiene), ya que se eliminan junto con el proveedor.
   Mismo mecanismo ya probado en Productos/Servicios: DELETE real
   sobre productos, nunca toca detalle_compras/venta_detalles (esas
   tablas guardan el nombre/sku por separado, su historial no
   depende de que el producto siga existiendo).
===================================================== */
async function abrirEliminarProveedor(id) {
  const proveedor = STATE.proveedores.find(p => p.id === id);
  if (!proveedor) return;

  STATE.proveedorAEliminar = id;
  document.getElementById('ep-nombre-proveedor').textContent = proveedor.nombre;
  document.getElementById('ep-error').textContent = '';
  document.getElementById('ep-sin-productos').style.display = 'none';
  document.getElementById('ep-con-productos').style.display = 'none';
  document.getElementById('ep-lista-productos').innerHTML = 'Buscando productos vinculados…';
  document.getElementById('ep-sin-productos').style.display = 'block';
  openModal('modal-eliminar-proveedor');

  try {
    const { data: productos } = await sbClient.from('productos')
      .select('id, nombre').eq('auth_user_id', STATE.userId).eq('proveedor_id', id);
    STATE.productosDelProveedorAEliminar = productos || [];
    if (productos && productos.length) {
      document.getElementById('ep-sin-productos').style.display = 'none';
      document.getElementById('ep-con-productos').style.display = 'block';
      document.getElementById('ep-lista-productos').innerHTML = productos.map(p => `• ${escHtml(p.nombre)}`).join('<br>');
    } else {
      document.getElementById('ep-sin-productos').style.display = 'block';
      document.getElementById('ep-con-productos').style.display = 'none';
    }
  } catch (e) {
    console.error('abrirEliminarProveedor:', e);
    document.getElementById('ep-error').textContent = 'No se pudo revisar los productos vinculados, intenta de nuevo.';
  }
}

async function confirmarEliminarProveedor() {
  const id = STATE.proveedorAEliminar;
  if (!id) return;
  const errEl = document.getElementById('ep-error');
  errEl.textContent = '';

  setBtnLoading('btn-confirmar-eliminar-proveedor', true);
  try {
    const productos = STATE.productosDelProveedorAEliminar || [];
    if (productos.length) {
      const { error: errProd } = await sbClient.from('productos').delete()
        .eq('auth_user_id', STATE.userId).eq('proveedor_id', id);
      if (errProd) throw errProd;
    }

    const { error: errProv } = await sbClient.from('proveedores').delete()
      .eq('id', id).eq('auth_user_id', STATE.userId);
    if (errProv) throw errProv;

    closeModal('modal-eliminar-proveedor');
    showToast(productos.length
      ? `Proveedor eliminado, junto con ${productos.length} producto${productos.length===1?'':'s'} vinculado${productos.length===1?'':'s'}`
      : 'Proveedor eliminado');
    await loadProveedores();
  } catch (e) {
    console.error('confirmarEliminarProveedor:', e);
    errEl.textContent = 'Error al eliminar: ' + (e.message || 'intenta de nuevo');
  } finally {
    setBtnLoading('btn-confirmar-eliminar-proveedor', false);
  }
}

/* =====================================================
   SECCIONES (tabs)
===================================================== */
function setSeccion(seccion) {
  STATE.seccionActiva = seccion;
  document.querySelectorAll('.section-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.section === seccion);
  });
  document.querySelectorAll('.section-panel').forEach(p => {
    p.style.display = p.dataset.section === seccion ? 'block' : 'none';
  });
  if (seccion === 'compras')    loadCompras();
  if (seccion === 'proveedores') loadProveedores();
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

document.addEventListener('click', e => {
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
  el.disabled     = loading;
  el.style.opacity = loading ? '0.6' : '1';
}

/* =====================================================
   INIT PRINCIPAL
===================================================== */
async function initCompras() {
  // Tema
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);

  // Fecha en header
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  try {
    // 1. Sesión
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    STATE.userId    = user.id;
    STATE.userEmail = user.email;

    if (user.email) checkAdminAccess(user.email);

    // 2. Config empresa y perfil
    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      const hName   = document.getElementById('header-name');
      const hAvatar = document.getElementById('header-avatar');
      if (hName)   hName.textContent   = user.email?.split('@')[0] || 'Usuario';
      if (hAvatar) hAvatar.textContent = (user.email || 'U')[0].toUpperCase();
    }

    // 3. Mostrar app
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    // 4. Cargar datos en paralelo
    await Promise.allSettled([
      loadMetodosPago(),
      loadProductosDisponibles(),
      loadProveedores(),
    ]);

    // 5. KPIs y tabla principal
    await Promise.allSettled([loadKPIs(), loadCompras()]);

  } catch(err) {
    console.error('initCompras:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

/* Auth listener */
sbClient.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

document.addEventListener('DOMContentLoaded', () => {
  initCompras();
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
  setTimeout(() => {
    const btn = document.getElementById('btn-moneda-vis-texto');
    if (btn) btn.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda);
  }, 800);
});
