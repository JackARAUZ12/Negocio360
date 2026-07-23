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

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  currentUser:   {},

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
===================================================== */
function todayISO() { return new Date().toISOString().split('T')[0]; }
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfWeekISO() {
  const d   = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
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
function sym() { return STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$'; }

function fmt(amount) {
  if (amount === null || amount === undefined) return `${sym()} —`;
  return `${sym()} ${Number(amount).toLocaleString('es-NI', {
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
  const sel = document.getElementById('nc-metodo-pago');
  if (!sel) return;
  const metodos = STATE.metodosPago.length
    ? STATE.metodosPago
    : [{ id: null, nombre: 'Efectivo', es_default: true }];
  sel.innerHTML = metodos.map(m =>
    `<option value="${m.id || ''}" data-nombre="${escHtml(m.nombre)}">${escHtml(m.nombre)}</option>`
  ).join('');
  // Seleccionar el default
  const def = metodos.find(m => m.es_default);
  if (def) sel.value = def.id || '';
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

  // Reset UI
  resetNuevaCompraUI();
  irAPaso(1);
  openModal('modal-nueva-compra');
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
  const sel = document.getElementById('nc-proveedor-select');
  if (!sel) return;
  sel.innerHTML = `<option value="">— Sin proveedor / Seleccionar —</option>` +
    (STATE.proveedores.filter(p => p.activo).map(p =>
      `<option value="${p.id}">${escHtml(p.nombre)}${p.telefono ? ' — '+escHtml(p.telefono) : ''}</option>`
    ).join(''));
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
  `).join('');

  actualizarResumen();
}

function actualizarLineaCarrito(idx, campo, valor) {
  const linea = STATE.carrito[idx];
  if (!linea) return;
  linea[campo] = parseFloat(valor) || 0;
  recalcularLinea(linea);
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
async function guardarCompra() {
  if (STATE.carrito.length === 0) {
    showToast('El carrito está vacío', 'error');
    return;
  }

  const { subtotal, descTotal, ivaTotal, total } = calcularTotales();
  const metodoPagoSel = document.getElementById('nc-metodo-pago');
  const metodoPagoId  = metodoPagoSel?.value || null;
  const metodoPagoNombre = metodoPagoSel?.options[metodoPagoSel.selectedIndex]?.getAttribute('data-nombre') || 'Efectivo';
  const estado        = document.getElementById('nc-estado')?.value || 'completada';
  const observaciones = document.getElementById('nc-observaciones')?.value.trim() || null;
  const fecha         = document.getElementById('nc-fecha')?.value || todayISO();

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
      const stockAntes = Number(linea.producto.stock_actual || 0);
      const stockDespues = stockAntes + Number(linea.cantidad);

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

      // b. Actualizar stock del producto
      // Compras → Productos (la arquitectura correcta)
      // Se marca updated_at explícitamente: una compra SÍ cuenta como una
      // actualización del producto, aunque no se haya tocado desde Productos.
      const { error: errStock } = await sbClient
        .from('productos')
        .update({ stock_actual: stockDespues, updated_at: new Date().toISOString() })
        .eq('id', linea.producto.id)
        .eq('auth_user_id', STATE.userId);
      if (errStock) throw errStock;
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

    // 6. Cerrar modal y recargar
    closeModal('modal-nueva-compra');
    showToast(`Compra ${numero} registrada correctamente`);

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

/* =====================================================
   ANULAR COMPRA
===================================================== */
let compraToAnular = null;

function confirmarAnularCompra(id) {
  compraToAnular = id;
  openModal('modal-confirmar-anular');
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
