/* ============================================================
   VENTAS.JS — NEGOCIO360
   Módulo central de ventas. Integra: Productos, Caja,
   Dashboard, Clientes, Impuestos. RLS + Supabase Auth.
   ============================================================ */

'use strict';

/* ============================================================
   SUPABASE
   ============================================================ */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const S = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  currentUser:   {},
  moneda:        'C$',

  // Lista de ventas
  ventas:        [],
  ventasTotal:   0,
  page:          1,
  perPage:       15,
  filtro:        'mes',
  busqueda:      '',
  dateFrom:      '',
  dateTo:        '',

  // Estado wizard nueva venta
  paso:          1,
  totalPasos:    6,
  clienteOpcion: 'final',    // final | existente | nuevo
  clienteId:     null,
  clienteNombre: 'Consumidor Final',
  clienteObjeto: null,
  carrito:       [],          // { id, nombre, sku, tipo, cantidad, precio, costo, descuento }
  metodosPago:   [],
  metodoPagoId:  null,
  metodoPagoNombre: 'Efectivo',
  observaciones: '',
  numeroVenta:   '',

  // IVA / Impuestos
  ivaActivo:      false,
  ivaPorcentaje:  15,

  // Venta activa en detalle/anular
  ventaDetalleId: null,

  // Productos/Clientes cargados
  productosCache: [],
  clientesCache:  [],

  // Clientes con pago recurrente
  clientesRecurrentes: [],
  pagoRecurrenteActivo: null, // cliente completo (objeto) que se está cobrando
  pagoRecurrenteMontoDebido: 0,
};

/* ============================================================
   HELPERS FECHA
   ============================================================ */
function todayISO()        { return new Date().toISOString().split('T')[0]; }
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function startOfWeekISO() {
  const d = new Date(), day = d.getDay();
  d.setDate(d.getDate() - day + (day===0 ? -6 : 1));
  return d.toISOString().split('T')[0];
}
function startOfYearISO() { return `${new Date().getFullYear()}-01-01`; }

function getFilterDates() {
  const today = todayISO();
  switch (S.filtro) {
    case 'hoy':    return { from: today, to: today };
    case 'semana': return { from: startOfWeekISO(), to: today };
    case 'mes':    return { from: startOfMonthISO(), to: today };
    case 'año':    return { from: startOfYearISO(), to: today };
    case 'custom': return { from: S.dateFrom||today, to: S.dateTo||today };
    default:       return { from: startOfMonthISO(), to: today };
  }
}

function fmtFecha(iso) {
  if (!iso) return '—';
   const dateOnly = iso.split('T')[0];
  const d = new Date(dateOnly+'T12:00:00');
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}

/* ============================================================
   HELPERS MONEDA
   ============================================================ */
function sym() { return S.moneda || 'C$'; }

function fmt(n) {
  const v = parseFloat(n || 0);
  return `${sym()} ${v.toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
}

function fmtShort(n) {
  const v = parseFloat(n || 0), s = sym();
  if (v >= 1_000_000) return `${s}${(v/1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${s}${(v/1_000).toFixed(1)}k`;
  return `${s}${v.toLocaleString('es-NI', { minimumFractionDigits:0 })}`;
}

/* ============================================================
   ESCAPE HTML
   ============================================================ */
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
}
function toggleTheme() {
  const c = document.documentElement.getAttribute('data-theme');
  applyTheme(c==='dark' ? 'light' : 'dark');
}

/* ============================================================
   SIDEBAR — Escritorio (colapsar) y Móvil (overlay deslizante)
   ============================================================ */
let sidebarCollapsed = false;

function isMobileViewport() {
  return window.innerWidth <= 768;
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (!sidebar) return;

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
    document.getElementById('main')?.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

// Cierra el sidebar móvil automáticamente al redimensionar a escritorio
window.addEventListener('resize', () => {
  if (!isMobileViewport()) closeMobileSidebar();
});

function navigate(url) {
  closeMobileSidebar();
  window.location.href = url;
}

/* ============================================================
   MODALES (genéricos)
   ============================================================ */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('modal-open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('modal-open'); document.body.style.overflow = ''; }
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function showToast(msg, type='success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

/* ============================================================
   ADMIN ACCESS
   ============================================================ */
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
   EMPRESA CONFIG
   ============================================================ */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*')
      .eq('auth_user_id', userId).maybeSingle();
    if (data) {
      S.empresaConfig = data;
      S.moneda = data.moneda || 'C$';
      const bizName = data.nombre_negocio || data.nombre || 'Negocio360';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      if (data.color_primario) {
        document.documentElement.style.setProperty('--accent', data.color_primario);
        document.documentElement.style.setProperty('--accent-soft', data.color_primario+'22');
        document.documentElement.style.setProperty('--border-focus', data.color_primario);
      }
      if (data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
      // Actualizar símbolos de moneda en KPIs
      document.querySelectorAll('[id^="sym-"]').forEach(el => el.textContent = S.moneda);
    }
  } catch(e) { console.warn('loadEmpresaConfig:', e); }
}

async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    return data;
  } catch { return null; }
}

function renderUserInfo(user, email) {
  if (!user) return;
  S.currentUser = user;
  const nombre   = user.nombre   || email?.split('@')[0] || 'Usuario';
  const apellido = user.apellido || '';
  const biz      = S.empresaConfig?.nombre_negocio || user.nombre_negocio || 'Mi negocio';
  const plan     = user.plan || 'Gratuito';
  const initials = ((nombre[0]||'')+(apellido[0]||'')).toUpperCase();

  document.getElementById('header-name').textContent   = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent    = biz;
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent     = plan.charAt(0).toUpperCase()+plan.slice(1);

  const h = new Date().getHours();
  const g = h<12 ? 'Buenos días' : h<19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('greeting-text').textContent = `${g}, ${nombre}`;
}

/* ============================================================
   KPIs
   ============================================================ */
async function loadKPIs() {
  const today     = todayISO();
  const mesStart  = startOfMonthISO();

  try {
    // Ventas del día
    // FIX: se pide también "impuesto" para poder mostrar el ingreso NETO
    // (sin IVA). El IVA no es ingreso del negocio, es dinero recaudado
    // para el fisco y ya se contabiliza aparte en el módulo de Impuestos.
    const { data: dia } = await sb.from('ventas').select('total,ganancia,impuesto')
      .eq('auth_user_id', S.userId).eq('estado','completada')
      .gte('fecha', today).lte('fecha', today);

    const totalDia = (dia||[]).reduce((s,r) => s + (Number(r.total) - Number(r.impuesto||0)), 0);
    setKPI('kpi-dia', fmt(totalDia), dia?.length > 0 ? 'positive' : 'neutral',
      dia?.length > 0 ? `${dia.length} venta${dia.length!==1?'s':''} hoy` : 'Sin ventas hoy', 'sym-dia');

    // Ventas del mes
    // FIX: mismo criterio — ingreso NETO de IVA
    const { data: mes } = await sb.from('ventas').select('total,ganancia,fecha,impuesto')
      .eq('auth_user_id', S.userId).eq('estado','completada')
      .gte('fecha', mesStart).lte('fecha', today);

    const totalMes = (mes||[]).reduce((s,r) => s + (Number(r.total) - Number(r.impuesto||0)), 0);
    const ganMes   = (mes||[]).reduce((s,r) => s+Number(r.ganancia),0);
    const cnt      = mes?.length || 0;
    const ticket   = cnt > 0 ? totalMes/cnt : 0;

    setKPI('kpi-mes',     fmt(totalMes), totalMes>0?'positive':'neutral',
      cnt>0?`${cnt} venta${cnt!==1?'s':''} este mes`:'Sin ventas este mes', 'sym-mes');
    setKPI('kpi-count',   cnt.toString(), cnt>0?'positive':'neutral', 'este mes');
    setKPI('kpi-ticket',  fmt(ticket), ticket>0?'positive':'neutral', 'promedio por venta', 'sym-ticket');
    setKPI('kpi-ganancia',fmt(ganMes), ganMes>0?'positive':'neutral', 'este mes', 'sym-gan');

  } catch(e) { console.warn('loadKPIs:', e); }
}

function setKPI(id, value, cls, delta, symId) {
  const el = document.getElementById(id);
  if (el) {
    if (symId) {
      el.innerHTML = `<span class="currency-symbol" id="${symId}">${S.moneda}</span>${value.replace(/^[^0-9]*/,'')}`;
    } else {
      el.textContent = value;
    }
  }
  const dd = document.getElementById(id+'-d');
  if (dd) { dd.textContent = delta; dd.className = `kpi-delta ${cls}`; }
}

/* ============================================================
   CARGAR VENTAS (tabla principal)
   ============================================================ */
async function loadVentas() {
  const tbody = document.getElementById('ventas-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="9">Cargando…</td></tr>';

  const { from, to } = getFilterDates();

  try {
    let q = sb.from('ventas').select('*', { count:'exact' })
      .eq('auth_user_id', S.userId)
      .gte('fecha', from).lte('fecha', to)
      .order('fecha', { ascending:false })
      .order('created_at', { ascending:false });

    if (S.busqueda.trim()) {
      q = q.or(`numero_venta.ilike.%${S.busqueda}%,cliente_nombre.ilike.%${S.busqueda}%`);
    }

    const fromR = (S.page-1)*S.perPage;
    q = q.range(fromR, fromR+S.perPage-1);

    const { data, count } = await q;
    S.ventas = data || [];
    S.ventasTotal = count || 0;

    renderTablaVentas();
    renderPaginacion();
    updateVentasCountLabel();
  } catch(e) {
    console.error('loadVentas:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">Error al cargar ventas.</td></tr>`;
  }
}

function renderTablaVentas() {
  const tbody = document.getElementById('ventas-tbody');
  if (!tbody) return;

  if (!S.ventas.length) {
    tbody.innerHTML = `
      <tr><td colspan="9" class="empty-cell">
        <div class="empty-icon">🛒</div>
        <p>Sin ventas en este período</p>
        <button class="btn-primary" style="margin-top:12px" onclick="abrirNuevaVenta()">+ Nueva venta</button>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = S.ventas.map(v => {
    const estadoCls = {completada:'estado-completada',anulada:'estado-anulada',devuelta:'estado-devuelta'}[v.estado]||'estado-completada';
    return `
    <tr class="${v.estado==='anulada'?'venta-anulada':''}">
      <td><span class="td-num">${esc(v.numero_venta)}</span></td>
      <td class="td-fecha">${fmtFecha(v.fecha)}</td>
      <td>
        <div class="td-cliente">${esc(v.cliente_nombre||'Consumidor Final')}</div>
      </td>
      <td class="td-metodo">${esc(v.metodo_pago_nombre||'—')}</td>
      <td class="td-productos" id="prod-preview-${v.id}">
        <span style="color:var(--text-muted);font-size:12px">Cargando…</span>
      </td>
      <td class="td-total">${fmt(v.total)}</td>
      <td class="td-ganancia">${fmt(v.ganancia)}</td>
      <td><span class="estado-badge ${estadoCls}">${v.estado}</span></td>
      <td class="td-actions">
        <button class="btn-icon-sm" title="Ver detalle" onclick="abrirDetalle('${v.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  // Cargar preview de productos (en paralelo, sin bloquear render)
  S.ventas.forEach(v => loadProductosPreview(v.id));
}

async function loadProductosPreview(ventaId) {
  try {
    const { data } = await sb.from('venta_detalles').select('producto_nombre,cantidad,tipo_item')
      .eq('venta_id', ventaId).eq('auth_user_id', S.userId).limit(3);
    const el = document.getElementById(`prod-preview-${ventaId}`);
    if (!el) return;
    if (!data || !data.length) { el.innerHTML = '<span style="color:var(--text-muted)">—</span>'; return; }
    const txt = data.map(d => `${d.producto_nombre} ×${Number(d.cantidad).toFixed(0)}`).join(', ');
    el.textContent = txt;
    el.title = txt;
  } catch { /* silencioso */ }
}

function renderPaginacion() {
  const total = Math.ceil(S.ventasTotal/S.perPage);
  const info  = document.getElementById('pag-info');
  const prev  = document.getElementById('btn-prev');
  const next  = document.getElementById('btn-next');

  if (info) {
    const f = Math.min((S.page-1)*S.perPage+1, S.ventasTotal);
    const t = Math.min(S.page*S.perPage, S.ventasTotal);
    info.textContent = S.ventasTotal>0 ? `Mostrando ${f}–${t} de ${S.ventasTotal}` : 'Sin resultados';
  }
  if (prev) prev.disabled = S.page<=1;
  if (next) next.disabled = S.page>=total;
}

function updateVentasCountLabel() {
  const el = document.getElementById('ventas-count-label');
  if (el) el.textContent = `${S.ventasTotal} venta${S.ventasTotal!==1?'s':''}`;
}

function paginaAnterior() { if(S.page>1) { S.page--; loadVentas(); } }
function paginaSiguiente() {
  if (S.page < Math.ceil(S.ventasTotal/S.perPage)) { S.page++; loadVentas(); }
}

function setFiltro(f) {
  S.filtro = f; S.page = 1;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.f===f));
  const cd = document.getElementById('custom-dates');
  if (cd) cd.style.display = f==='custom' ? 'flex' : 'none';
  loadVentas();
}

function buscarVentas() {
  S.busqueda = document.getElementById('ventas-search')?.value || '';
  S.page = 1;
  loadVentas();
}

/* ============================================================
   DETALLE DE VENTA
   ============================================================ */
async function abrirDetalle(ventaId) {
  S.ventaDetalleId = ventaId;
  const venta = S.ventas.find(v => v.id === ventaId);
  if (!venta) return;

  openModal('modal-detalle');
  document.getElementById('det-title').textContent    = `Venta ${venta.numero_venta}`;
  document.getElementById('det-subtitle').textContent = fmtFecha(venta.fecha);

  const body = document.getElementById('det-body');
  body.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted)">Cargando detalle…</p>';

  // Mostrar/ocultar botón anular
  const btnAnular = document.getElementById('btn-anular-venta');
  if (btnAnular) btnAnular.style.display = venta.estado==='completada' ? '' : 'none';

  try {
    const { data: items } = await sb.from('venta_detalles').select('*')
      .eq('venta_id', ventaId).eq('auth_user_id', S.userId);

    const estadoCls = {completada:'estado-completada',anulada:'estado-anulada',devuelta:'estado-devuelta'}[venta.estado]||'estado-completada';

    body.innerHTML = `
      <div class="detalle-grid">
        <div class="detalle-item">
          <div class="detalle-label">Número</div>
          <div class="detalle-value" style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(venta.numero_venta)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Estado</div>
          <div class="detalle-value"><span class="estado-badge ${estadoCls}">${venta.estado}</span></div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Fecha</div>
          <div class="detalle-value">${fmtFecha(venta.fecha)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Método de pago</div>
          <div class="detalle-value">${esc(venta.metodo_pago_nombre||'—')}</div>
        </div>
        <div class="detalle-item full">
          <div class="detalle-label">Cliente</div>
          <div class="detalle-value" style="font-weight:600">${esc(venta.cliente_nombre||'Consumidor Final')}</div>
        </div>
        ${venta.observaciones ? `
        <div class="detalle-item full">
          <div class="detalle-label">Observaciones</div>
          <div class="detalle-value">${esc(venta.observaciones)}</div>
        </div>` : ''}
        <div class="detalle-divider"></div>
        <div class="detalle-item full">
          <div class="detalle-label">Productos y servicios</div>
          <table class="detalle-items-table">
            <thead>
              <tr>
                <th>Ítem</th><th>Tipo</th><th>Qty</th><th>Precio</th><th>Desc.</th><th>Subtotal</th><th>Ganancia</th>
              </tr>
            </thead>
            <tbody>
              ${(items||[]).map(it => `
              <tr>
                <td style="font-weight:500">${esc(it.producto_nombre)}</td>
                <td><span class="tipo-item-badge ${it.tipo_item==='producto'?'badge-prod':'badge-serv'}">${it.tipo_item}</span></td>
                <td>${Number(it.cantidad).toLocaleString('es-NI',{maximumFractionDigits:2})}</td>
                <td>${fmt(it.precio)}</td>
                <td>${Number(it.descuento)>0 ? fmt(it.descuento) : '—'}</td>
                <td style="font-weight:600">${fmt(it.subtotal)}</td>
                <td style="color:var(--success);font-weight:600">${fmt(it.ganancia)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="detalle-divider"></div>
        <div class="detalle-item">
          <div class="detalle-label">Subtotal</div>
          <div class="detalle-value">${fmt(venta.subtotal)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Descuento</div>
          <div class="detalle-value">${fmt(venta.descuento)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Impuestos${venta.iva_porcentaje ? ` (${Number(venta.iva_porcentaje)}%)` : ''}</div>
          <div class="detalle-value">${fmt(venta.impuesto)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">TOTAL</div>
          <div class="detalle-value" style="font-size:20px;font-weight:800;color:var(--accent)">${fmt(venta.total)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Ganancia</div>
          <div class="detalle-value" style="color:var(--success);font-weight:700">${fmt(venta.ganancia)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Costo total</div>
          <div class="detalle-value" style="color:var(--text-secondary)">${fmt(venta.costo_total)}</div>
        </div>
      </div>
    `;
  } catch(e) {
    body.innerHTML = `<p style="color:var(--danger);padding:20px">Error al cargar detalle: ${e.message}</p>`;
  }
}

/* ============================================================
   ANULAR VENTA
   ============================================================ */
function abrirConfirmarAnular() {
  openModal('modal-anular');
}

async function anularVenta() {
  const id = S.ventaDetalleId;
  if (!id) return;

  const btn = document.getElementById('btn-confirmar-anular');
  if (btn) btn.disabled = true;

  try {
    const { error } = await sb.from('ventas')
      .update({ estado:'anulada', updated_at: new Date().toISOString() })
      .eq('id', id).eq('auth_user_id', S.userId);

    if (error) throw error;

    closeModal('modal-anular');
    closeModal('modal-detalle');
    showToast('Venta anulada correctamente', 'warning');
    await Promise.allSettled([loadVentas(), loadKPIs()]);
  } catch(e) {
    showToast('Error al anular: '+e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================
   MÉTODOS DE PAGO (para el modal de venta)
   ============================================================ */
async function loadMetodosPago() {
  try {
    const { data } = await sb.from('metodos_pago').select('*')
      .eq('auth_user_id', S.userId).eq('activo', true).order('orden');
    S.metodosPago = data || [];
  } catch(e) {
    // Fallback con métodos comunes si la tabla no existe aún
    S.metodosPago = [
      { id:'efectivo',     nombre:'Efectivo',      es_default:true },
      { id:'transferencia',nombre:'Transferencia', es_default:false },
      { id:'tarjeta',      nombre:'Tarjeta',       es_default:false },
    ];
  }
}

/* ============================================================
   CARGAR PRODUCTOS Y CLIENTES (caché)
   ============================================================ */
async function loadProductosCache() {
  try {
    const { data } = await sb.from('productos').select('id,nombre,sku,tipo,precio,costo,stock_actual,activo')
      .eq('auth_user_id', S.userId).eq('activo', true)
      .order('nombre');
    S.productosCache = data || [];
  } catch(e) { S.productosCache = []; }
}

async function loadClientesCache() {
  try {
    const { data } = await sb.from('clientes').select('id,nombre,telefono,correo')
      .eq('auth_user_id', S.userId).eq('activo', true).order('nombre');
    S.clientesCache = data || [];
  } catch(e) { S.clientesCache = []; }
}

/* ============================================================
   CLIENTES CON PAGO RECURRENTE
   (mensualidad / semanal / quincenal / anual)
   ============================================================ */
const FRECUENCIA_LABEL = { mensual:'Mensual', semanal:'Semanal', quincenal:'Quincenal', anual:'Anual' };
const DIAS_SEMANA_LABEL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function clampDia(anio, mes /*0-based*/, dia) {
  const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();
  return Math.min(Math.max(1, dia || 1), ultimoDiaMes);
}

/**
 * Calcula la SIGUIENTE fecha de pago a partir de la fecha ancla actual
 * (la fecha que ya vencía), NO desde la fecha en que se pagó.
 * Así, si el ciclo es "siempre el día 20", la próxima fecha sigue
 * siendo el 20 del mes siguiente, sin importar si el cliente completó
 * su pago el 20, el 25 o el 28.
 */
function calcularSiguienteFecha(fechaAnclaISO, frecuencia, diaPago) {
  const [y, m, d] = fechaAnclaISO.split('-').map(Number);
  const ancla = new Date(y, m - 1, d);

  if (frecuencia === 'semanal') {
    const next = new Date(ancla);
    next.setDate(next.getDate() + 7);
    return next.toISOString().split('T')[0];
  }
  if (frecuencia === 'quincenal') {
    const next = new Date(ancla);
    next.setDate(next.getDate() + 15);
    return next.toISOString().split('T')[0];
  }
  if (frecuencia === 'anual') {
    const anio = ancla.getFullYear() + 1;
    const dia  = clampDia(anio, ancla.getMonth(), diaPago ?? ancla.getDate());
    return new Date(anio, ancla.getMonth(), dia).toISOString().split('T')[0];
  }
  // mensual (default)
  const anio = ancla.getFullYear();
  const mesSig = ancla.getMonth() + 1;
  const anioSig = anio + Math.floor(mesSig / 12);
  const mesSigNorm = mesSig % 12;
  const dia = clampDia(anioSig, mesSigNorm, diaPago ?? ancla.getDate());
  return new Date(anioSig, mesSigNorm, dia).toISOString().split('T')[0];
}

/** Devuelve { montoDebido, atrasado, diasAtraso, alDia, esParcial } para un cliente recurrente */
function calcularEstadoPagoCliente(c) {
  const montoRecurrente = Number(c.monto_recurrente || 0);
  const saldoPendiente  = Number(c.saldo_pendiente  || 0);
  const montoDebido     = saldoPendiente > 0 ? saldoPendiente : montoRecurrente;
  const esParcial       = saldoPendiente > 0 && saldoPendiente < montoRecurrente;

  let atrasado = false, diasAtraso = 0;
  if (c.fecha_proxima_pago) {
    const hoy = new Date(todayISO() + 'T00:00:00');
    const prox = new Date(c.fecha_proxima_pago + 'T00:00:00');
    if (prox < hoy) {
      atrasado = true;
      diasAtraso = Math.floor((hoy - prox) / 86400000);
    }
  }
  return { montoDebido, atrasado, diasAtraso, esParcial };
}

async function loadClientesRecurrentes() {
  const tbody = document.getElementById('recurrentes-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="7">Cargando clientes recurrentes…</td></tr>';
  try {
    const { data, error } = await sb.from('clientes')
      .select('id,nombre,telefono,correo,tipo_cliente,frecuencia_pago,monto_recurrente,dia_pago,fecha_ultimo_pago,fecha_proxima_pago,saldo_pendiente')
      .eq('auth_user_id', S.userId)
      .eq('tipo_cliente', 'recurrente')
      .eq('activo', true)
      .order('fecha_proxima_pago', { ascending: true, nullsFirst: false });
    if (error) throw error;
    S.clientesRecurrentes = data || [];
    renderClientesRecurrentes();
  } catch(e) {
    console.warn('loadClientesRecurrentes:', e);
    S.clientesRecurrentes = [];
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No se pudo cargar la lista de clientes recurrentes.</td></tr>`;
  }
}

function renderClientesRecurrentes() {
  const tbody = document.getElementById('recurrentes-tbody');
  const label = document.getElementById('recurrentes-count-label');
  if (label) label.textContent = `${S.clientesRecurrentes.length} cliente${S.clientesRecurrentes.length===1?'':'s'}`;
  if (!tbody) return;

  if (!S.clientesRecurrentes.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">
      <div class="empty-icon">🔁</div>
      <p>Aún no tienes clientes marcados como "Recurrente". Configúralos desde el módulo de Clientes.</p>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = S.clientesRecurrentes.map(c => {
    const est = calcularEstadoPagoCliente(c);
    const freqLabel = FRECUENCIA_LABEL[c.frecuencia_pago] || '—';
    let estadoHtml;
    if (est.atrasado) {
      estadoHtml = `<span class="estado-badge estado-atrasado">Atrasado (${est.diasAtraso}d)</span>`;
    } else if (est.esParcial) {
      estadoHtml = `<span class="estado-badge estado-parcial">Pago parcial</span>`;
    } else {
      estadoHtml = `<span class="estado-badge estado-aldia">Al día</span>`;
    }
    return `
    <tr>
      <td>
        <div style="font-weight:600;color:var(--text-primary)">${esc(c.nombre)}</div>
        <div class="td-cliente-sub">${esc(c.telefono || c.correo || '')}</div>
      </td>
      <td style="color:var(--text-secondary);font-size:13px">${freqLabel}</td>
      <td style="color:var(--text-secondary);font-size:12.5px">${fmtFecha(c.fecha_ultimo_pago)}</td>
      <td style="color:var(--text-secondary);font-size:12.5px">${fmtFecha(c.fecha_proxima_pago)}</td>
      <td class="td-total">${fmt(est.montoDebido)}</td>
      <td>${estadoHtml}</td>
      <td class="td-actions">
        <button class="btn-primary" style="padding:6px 12px;font-size:12.5px" onclick="abrirModalPagoRecurrente('${c.id}')">
          Crear pago
        </button>
      </td>
    </tr>`;
  }).join('');
}

/* ------------------------------------------------------------
   MODAL: REGISTRAR PAGO
------------------------------------------------------------ */
function abrirModalPagoRecurrente(clienteId) {
  const c = S.clientesRecurrentes.find(x => x.id === clienteId);
  if (!c) return;
  S.pagoRecurrenteActivo = c;

  const est = calcularEstadoPagoCliente(c);
  S.pagoRecurrenteMontoDebido = est.montoDebido;

  document.getElementById('pr-cliente-nombre').textContent = c.nombre;
  document.getElementById('pr-frecuencia').textContent = FRECUENCIA_LABEL[c.frecuencia_pago] || '—';
  document.getElementById('pr-fecha-proxima').textContent = fmtFecha(c.fecha_proxima_pago);
  document.getElementById('pr-ultimo-pago').textContent = fmtFecha(c.fecha_ultimo_pago);
  document.getElementById('pr-estado-badge').innerHTML = est.atrasado
    ? `<span class="estado-badge estado-atrasado">Atrasado (${est.diasAtraso}d)</span>`
    : (est.esParcial ? `<span class="estado-badge estado-parcial">Pago parcial</span>` : `<span class="estado-badge estado-aldia">Al día</span>`);
  document.getElementById('pr-monto-debido').textContent = fmt(est.montoDebido);

  // Reset formulario
  document.querySelector('input[name="pr-tipo"][value="completo"]').checked = true;
  document.getElementById('pr-wrap-monto-parcial').style.display = 'none';
  document.getElementById('pr-monto-parcial').value = '';
  document.getElementById('pr-observaciones').value = '';
  document.getElementById('pr-iva-activo').checked = true;
  document.getElementById('pr-iva-porcentaje').value = S.empresaConfig?.porcentaje_iva ? Number(S.empresaConfig.porcentaje_iva) : 15;

  // Métodos de pago
  const sel = document.getElementById('pr-metodo-pago');
  if (sel) {
    sel.innerHTML = S.metodosPago.map(m => `<option value="${m.id}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  }

  actualizarResumenPagoRecurrente();
  openModal('modal-pago-recurrente');
}

function cerrarModalPagoRecurrente() {
  closeModal('modal-pago-recurrente');
  S.pagoRecurrenteActivo = null;
}

function onCambioTipoPagoRecurrente() {
  const tipo = document.querySelector('input[name="pr-tipo"]:checked')?.value;
  const wrap = document.getElementById('pr-wrap-monto-parcial');
  wrap.style.display = (tipo === 'parcial') ? '' : 'none';
  actualizarResumenPagoRecurrente();
}

/**
 * Calcula lo que va a suceder con este pago SIN tocar el estado global:
 * cuánto se abona ahora, si con eso el periodo queda liquidado, y — solo
 * si queda liquidado — cuánto IVA se suma (sobre la cuota completa del
 * periodo, no solo sobre el remanente que se esté cobrando ahora mismo).
 *
 * REGLA DE NEGOCIO: el IVA nunca se cobra en un pago parcial. Solo se
 * habilita cuando el pago que se está registrando deja el periodo en
 * C$0 pendiente — ya sea porque el cliente pagó todo de una vez, o
 * porque este pago es el que completa un saldo que venía de un abono
 * parcial anterior. En ese caso se detecta automáticamente y se suma.
 */
function calcularPagoRecurrente() {
  const c = S.pagoRecurrenteActivo;
  const tipo = document.querySelector('input[name="pr-tipo"]:checked')?.value || 'completo';
  const montoDebido = S.pagoRecurrenteMontoDebido || 0;

  let montoBase; // lo que se abona ahora a la deuda, SIN impuesto
  if (tipo === 'completo') {
    montoBase = montoDebido;
  } else {
    montoBase = parseFloat(document.getElementById('pr-monto-parcial')?.value || 0) || 0;
    if (montoBase > montoDebido) montoBase = montoDebido;
  }

  const restante  = Math.max(0, montoDebido - montoBase);
  const esCompleto = restante <= 0.01; // este pago deja el periodo en cero

  const ivaActivo = esCompleto && (document.getElementById('pr-iva-activo')?.checked || false);
  const ivaPct    = parseFloat(document.getElementById('pr-iva-porcentaje')?.value || 0) || 0;

  // El IVA se calcula sobre la CUOTA COMPLETA del periodo (monto_recurrente),
  // no solo sobre el remanente — así, si hubo un abono parcial sin IVA antes,
  // el IVA de todo el periodo se suma completo en el pago que lo liquida.
  const baseIva = Number(c?.monto_recurrente || montoDebido);
  const montoIva = ivaActivo && ivaPct > 0 ? baseIva * (ivaPct / 100) : 0;

  const totalACobrar = montoBase + montoIva; // el IVA SE SUMA al total, no se resta
  const montoCaja    = montoBase;            // a Caja entra el neto (sin IVA)

  return { tipo, montoBase, restante, esCompleto, ivaActivo, ivaPct, montoIva, totalACobrar, montoCaja };
}

function actualizarResumenPagoRecurrente() {
  const r = calcularPagoRecurrente();

  const wrapIva  = document.getElementById('pr-wrap-iva');
  const hintSin  = document.getElementById('pr-hint-sin-iva');
  const filaIva  = document.getElementById('pr-r-iva-row');

  if (r.esCompleto) {
    // El pago liquida el periodo: se habilita la opción de IVA.
    if (wrapIva)  wrapIva.style.display  = '';
    if (hintSin)  hintSin.style.display  = 'none';
  } else {
    // Pago parcial que NO liquida el periodo: sin opción de IVA.
    if (wrapIva)  wrapIva.style.display  = 'none';
    if (hintSin)  hintSin.style.display  = '';
  }

  document.getElementById('pr-r-base').textContent  = fmt(r.montoBase);
  filaIva.style.display = r.ivaActivo ? 'flex' : 'none';
  document.getElementById('pr-r-iva').textContent   = fmt(r.montoIva);
  document.getElementById('pr-r-total').textContent = fmt(r.totalACobrar);
  document.getElementById('pr-r-caja').textContent  = fmt(r.montoCaja);
  document.getElementById('pr-r-restante').textContent = fmt(r.restante);
}

/* ------------------------------------------------------------
   CONFIRMAR PAGO — crea la venta (viaja a Caja, Reportes,
   Dashboard e Impuestos, igual que confirmarVenta())
------------------------------------------------------------ */
async function confirmarPagoRecurrente() {
  const c = S.pagoRecurrenteActivo;
  if (!c) return;

  const r = calcularPagoRecurrente();
  const { montoBase, restante, esCompleto, ivaActivo, ivaPct, montoIva, totalACobrar, montoCaja } = r;
  const montoDebido = S.pagoRecurrenteMontoDebido || 0;

  if (!montoBase || montoBase <= 0) { showToast('Ingresa un monto válido', 'error'); return; }
  if (montoBase > montoDebido + 0.01) { showToast('El monto no puede ser mayor a lo que debe', 'error'); return; }

  const observaciones = document.getElementById('pr-observaciones')?.value.trim() || null;
  const metodoSel = document.getElementById('pr-metodo-pago');
  const metodoPagoId = metodoSel?.value || null;
  const metodoPagoNombre = metodoSel?.selectedOptions?.[0]?.dataset?.nombre || 'Efectivo';

  const btn = document.getElementById('btn-confirmar-pago-recurrente');
  const btnHtmlOriginal = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    /* ----------------------------------------------------------
       PASO A: Número de venta
    ---------------------------------------------------------- */
    let numeroVenta;
    try {
      const { data: nv } = await sb.rpc('generar_numero_venta', { p_user_id: S.userId });
      numeroVenta = nv || `V-${Date.now()}`;
    } catch { numeroVenta = `V-${Date.now()}`; }

    /* ----------------------------------------------------------
       PASO B: Insertar la venta (el pago SIEMPRE se registra
       como venta para que viaje a Caja, Reportes, Dashboard e
       Impuestos automáticamente)
    ---------------------------------------------------------- */
    const concepto = esCompleto
      ? `Pago recurrente completo — ${c.nombre}`
      : `Pago recurrente parcial — ${c.nombre}`;

    const ventaPayload = {
      auth_user_id:       S.userId,
      numero_venta:       numeroVenta,
      cliente_id:         c.id,
      cliente_nombre:     c.nombre,
      fecha:              todayISO(),
      subtotal:           montoBase,
      descuento:          0,
      impuesto:           montoIva,
      total:              totalACobrar,
      costo_total:        0,
      metodo_pago_id:      metodoPagoId,
      metodo_pago_nombre:  metodoPagoNombre,
      categoria:          'Pago recurrente',
      estado:             'completada',
      observaciones:      observaciones,
    };
    const ventaPayloadConIva = { ...ventaPayload, iva_activo: ivaActivo, iva_porcentaje: ivaActivo ? ivaPct : 0 };

    let ventaNueva, errVenta;
    ({ data: ventaNueva, error: errVenta } = await sb.from('ventas').insert(ventaPayloadConIva).select('id').single());
    if (errVenta) {
      ({ data: ventaNueva, error: errVenta } = await sb.from('ventas').insert(ventaPayload).select('id').single());
    }
    if (errVenta) throw errVenta;
    const ventaId = ventaNueva.id;

    /* ----------------------------------------------------------
       PASO C: Detalle de venta (un ítem tipo servicio)
    ---------------------------------------------------------- */
    await sb.from('venta_detalles').insert({
      auth_user_id:    S.userId,
      venta_id:        ventaId,
      producto_nombre: concepto,
      tipo_item:       'servicio',
      cantidad:        1,
      precio:          montoBase,
      costo:           0,
      descuento:       0,
      subtotal:        montoBase,
      ganancia:        montoBase,
    });

    /* ----------------------------------------------------------
       PASO D: Caja — igual que una venta normal: entra el monto
       neto de IVA (el IVA se registra aparte en Impuestos)
    ---------------------------------------------------------- */
    try {
      const { data: ultMov } = await sb.from('movimientos_financieros')
        .select('saldo_resultante')
        .eq('auth_user_id', S.userId).eq('estado', 'completado')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();

      const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
      const saldoRes = saldoAnt + montoCaja;

      const { data: movNuevo } = await sb.from('movimientos_financieros').insert({
        auth_user_id:       S.userId,
        tipo_flujo:         'INGRESO',
        tipo_movimiento:    'COBRO',
        concepto:           `${concepto} (${numeroVenta})`,
        monto:              montoCaja,
        saldo_anterior:     saldoAnt,
        saldo_resultante:   saldoRes,
        metodo_pago_id:     metodoPagoId,
        metodo_pago_nombre: metodoPagoNombre,
        referencia_tipo:    'venta',
        referencia_id:      ventaId,
        observaciones:      observaciones,
        fecha:              todayISO(),
      }).select('id').single();

      if (movNuevo?.id) {
        await sb.from('ventas').update({ referencia_caja: movNuevo.id }).eq('id', ventaId);
      }
    } catch(eCaja) {
      console.warn('No se pudo registrar en caja:', eCaja);
    }

    /* ----------------------------------------------------------
       PASO E: IVA — aparte, a Impuestos, NO se suma a Caja
    ---------------------------------------------------------- */
    if (montoIva > 0) {
      await registrarMovimientoImpuesto(S.userId, montoIva, ventaId, numeroVenta);
    }

    /* ----------------------------------------------------------
       PASO F: Actualizar cliente — saldo, fechas y contador
    ---------------------------------------------------------- */
    const updateCliente = {
      fecha_ultimo_pago: todayISO(),
      total_compras:     Number(c.total_compras || 0) + totalACobrar,
      num_compras:       Number(c.num_compras   || 0) + (esCompleto ? 1 : 0),
    };

    if (esCompleto) {
      // Se cerró el periodo: el saldo vuelve a 0 y la próxima fecha
      // avanza SIEMPRE desde la fecha ancla (nunca desde hoy), para
      // que el día de pago (ej. el 20) nunca se mueva.
      updateCliente.saldo_pendiente = 0;
      updateCliente.fecha_proxima_pago = calcularSiguienteFecha(
        c.fecha_proxima_pago || todayISO(), c.frecuencia_pago, c.dia_pago
      );
    } else {
      // Pago parcial: la fecha de pago NO se mueve, solo baja el saldo.
      updateCliente.saldo_pendiente = restante;
    }

    await sb.from('clientes').update(updateCliente).eq('id', c.id).eq('auth_user_id', S.userId);

    /* ----------------------------------------------------------
       PASO G: Historial de auditoría del pago
    ---------------------------------------------------------- */
    await sb.from('pagos_clientes_recurrentes').insert({
      auth_user_id:       S.userId,
      cliente_id:         c.id,
      venta_id:           ventaId,
      periodo_fecha:       c.fecha_proxima_pago || todayISO(),
      monto_periodo:       montoDebido,
      monto_pagado:        montoBase,
      saldo_restante:      restante,
      tipo_pago:           esCompleto ? 'completo' : 'parcial',
      iva_activo:          ivaActivo,
      iva_porcentaje:      ivaActivo ? ivaPct : 0,
      iva_monto:           montoIva,
      metodo_pago_nombre:  metodoPagoNombre,
      fecha_pago:          todayISO(),
    });

    /* ----------------------------------------------------------
       ÉXITO
    ---------------------------------------------------------- */
    cerrarModalPagoRecurrente();
    showToast(`✅ Pago registrado — ${fmt(totalACobrar)}`, 'success');

    await Promise.allSettled([
      loadClientesRecurrentes(),
      loadVentas(),
      loadKPIs(),
    ]);

    try {
      localStorage.setItem('n360_caja_updated', new Date().toISOString());
    } catch(_) {}

  } catch(e) {
    console.error('confirmarPagoRecurrente:', e);
    showToast('Error al registrar el pago: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnHtmlOriginal; }
  }
}

/* ============================================================
   WIZARD — ABRIR / CERRAR
   ============================================================ */
async function abrirNuevaVenta() {
  // Reset wizard
  S.paso          = 1;
  S.clienteOpcion = 'final';
  S.clienteId     = null;
  S.clienteNombre = 'Consumidor Final';
  S.clienteObjeto = null;
  S.carrito       = [];
  S.metodoPagoId  = null;
  S.metodoPagoNombre = 'Efectivo';
  S.observaciones = '';
  S.numeroVenta   = '';
  S.ivaActivo     = false;
  S.ivaPorcentaje = S.empresaConfig?.iva_porcentaje_default ? Number(S.empresaConfig.iva_porcentaje_default) : 15;

  // Limpiar campos
  const qi = document.getElementById('cliente-search-input');  if(qi) qi.value='';
  const ci = document.getElementById('cq-nombre');             if(ci) ci.value='';
  const ct = document.getElementById('cq-telefono');           if(ct) ct.value='';
  const cc = document.getElementById('cq-correo');             if(cc) cc.value='';
  const ob = document.getElementById('venta-observaciones');   if(ob) ob.value='';
  const ps = document.getElementById('prod-search-input');     if(ps) ps.value='';
  const ss = document.getElementById('serv-search-input');     if(ss) ss.value='';

  // Reset UI de IVA
  const ivaSwitch = document.getElementById('iva-switch');
  const ivaInput  = document.getElementById('iva-porcentaje');
  if (ivaSwitch) ivaSwitch.classList.remove('on');
  if (ivaInput)  { ivaInput.value = S.ivaPorcentaje; ivaInput.disabled = true; }

  // Selección inicial cliente
  selectClienteOpcion('final');

  // Número provisional
  document.getElementById('mv-num').textContent = 'Generando número…';

  openModal('modal-venta');
  goToPaso(1);

  // Generar número en paralelo
  generarNumeroVenta();
}

function cerrarModalVenta() {
  closeModal('modal-venta');
}

async function generarNumeroVenta() {
  try {
    // Llamar función PL/pgSQL para número único por usuario
    const { data, error } = await sb.rpc('generar_numero_venta', { p_user_id: S.userId });
    if (error) throw error;
    S.numeroVenta = data || `V-${Date.now()}`;
    document.getElementById('mv-num').textContent = S.numeroVenta;
  } catch(e) {
    // Fallback local (no definitivo, se asigna al guardar)
    S.numeroVenta = `V-TMP-${Date.now()}`;
    document.getElementById('mv-num').textContent = S.numeroVenta;
  }
}

/* ============================================================
   WIZARD — NAVEGACIÓN ENTRE PASOS
   ============================================================ */
function goToPaso(n) {
  // Ocultar todos los paneles
  for (let i=1; i<=S.totalPasos; i++) {
    const el = document.getElementById(`step-${i}`);
    if (el) el.style.display = 'none';
  }
  // Mostrar el paso activo
  const active = document.getElementById(`step-${n}`);
  if (active) active.style.display = '';

  S.paso = n;
  actualizarStepsNav();
  actualizarBotones();

  // Acciones específicas por paso
  if (n===4) calcularResumen();
  if (n===5) renderMetodosPagoModal();
  if (n===6) renderResumenFinal();
}

function actualizarStepsNav() {
  document.querySelectorAll('.step-btn').forEach(btn => {
    const s = parseInt(btn.dataset.step);
    btn.classList.remove('active','done');
    if (s === S.paso)      btn.classList.add('active');
    else if (s < S.paso)   btn.classList.add('done');
  });
}

function actualizarBotones() {
  const btnAnt = document.getElementById('btn-anterior');
  const btnSig = document.getElementById('btn-siguiente');
  const btnCon = document.getElementById('btn-confirmar-venta');

  if (btnAnt) btnAnt.style.display = S.paso > 1 ? '' : 'none';
  if (btnSig) btnSig.style.display = S.paso < S.totalPasos ? '' : 'none';
  if (btnCon) btnCon.style.display = S.paso === S.totalPasos ? '' : 'none';
}

function pasoSiguiente() {
  if (!validarPasoActual()) return;
  if (S.paso < S.totalPasos) goToPaso(S.paso+1);
}

function pasoAnterior() {
  if (S.paso > 1) goToPaso(S.paso-1);
}

function validarPasoActual() {
  if (S.paso===1) {
    if (S.clienteOpcion==='existente' && !S.clienteId) {
      showToast('Selecciona un cliente de la lista', 'error'); return false;
    }
    if (S.clienteOpcion==='nuevo') {
      const nombre = document.getElementById('cq-nombre')?.value.trim();
      if (!nombre) { showToast('El nombre del cliente es requerido', 'error'); return false; }
    }
    // Guardar datos del cliente rápido
    if (S.clienteOpcion==='nuevo') {
      S.clienteNombre = document.getElementById('cq-nombre')?.value.trim() || '';
    }
  }
  if (S.paso===2) {
    // Productos son opcionales si hay servicios
  }
  if (S.paso===3) {
    // Validar que haya al menos un ítem
    if (S.carrito.length===0) {
      showToast('Agrega al menos un producto o servicio', 'error'); return false;
    }
  }
  if (S.paso===5) {
    if (!S.metodoPagoId && S.metodosPago.length>0) {
      showToast('Selecciona un método de pago', 'error');
      const err = document.getElementById('metodo-error');
      if (err) err.style.display = '';
      return false;
    }
  }
  return true;
}

/* ============================================================
   PASO 1 — CLIENTE
   ============================================================ */
function selectClienteOpcion(opcion) {
  S.clienteOpcion = opcion;

  ['existente','final','nuevo'].forEach(o => {
    document.getElementById(`co-${o}`)?.classList.remove('selected');
  });
  document.getElementById(`co-${opcion}`)?.classList.add('selected');

  const bBuscar = document.getElementById('bloque-buscar-cliente');
  const bRapido = document.getElementById('bloque-cliente-rapido');

  if (bBuscar) bBuscar.style.display = opcion==='existente' ? '' : 'none';
  if (bRapido) bRapido.style.display = opcion==='nuevo'     ? '' : 'none';

  if (opcion==='final') {
    S.clienteId     = null;
    S.clienteNombre = 'Consumidor Final';
    S.clienteObjeto = null;
  }
}

function buscarClientes(q) {
  const results = document.getElementById('clientes-results');
  if (!results) return;
  if (!q.trim()) { results.classList.remove('open'); return; }

  const lista = S.clientesCache.filter(c =>
    c.nombre.toLowerCase().includes(q.toLowerCase()) ||
    (c.telefono||'').includes(q) ||
    (c.correo||'').toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);

  if (!lista.length) {
    results.innerHTML = `<div class="prod-result-item" style="cursor:default;color:var(--text-muted)">Sin resultados</div>`;
    results.classList.add('open');
    return;
  }

  results.innerHTML = lista.map(c => `
    <div class="prod-result-item" onclick="seleccionarCliente('${c.id}')">
      <div style="flex:1">
        <div class="pri-name">${esc(c.nombre)}</div>
        <div class="pri-sku">${esc(c.telefono||'')} ${esc(c.correo||'')}</div>
      </div>
    </div>`).join('');
  results.classList.add('open');
}

function seleccionarCliente(id) {
  const c = S.clientesCache.find(x => x.id===id);
  if (!c) return;
  S.clienteId     = c.id;
  S.clienteNombre = c.nombre;
  S.clienteObjeto = c;

  const input = document.getElementById('cliente-search-input');
  if (input) input.value = c.nombre;

  const results = document.getElementById('clientes-results');
  if (results) results.classList.remove('open');

  const info = document.getElementById('cliente-seleccionado-info');
  if (info) {
    info.style.display = '';
    info.innerHTML = `
      <strong>${esc(c.nombre)}</strong><br>
      <span style="color:var(--text-secondary);font-size:12px">
        ${c.telefono ? `📞 ${esc(c.telefono)}` : ''}
        ${c.correo   ? ` ✉️ ${esc(c.correo)}`  : ''}
      </span>`;
  }
}

/* ============================================================
   PASO 2 / 3 — BÚSQUEDA DE PRODUCTOS / SERVICIOS
   ============================================================ */
function buscarProductosParaVenta(q, tipo) {
  const resultsId = tipo==='producto' ? 'prod-results' : 'serv-results';
  const results   = document.getElementById(resultsId);
  if (!results) return;

  if (!q.trim()) { results.classList.remove('open'); return; }

  const lista = S.productosCache.filter(p =>
    p.tipo === tipo &&
    (p.nombre.toLowerCase().includes(q.toLowerCase()) || (p.sku||'').toLowerCase().includes(q.toLowerCase()))
  ).slice(0, 10);

  if (!lista.length) {
    results.innerHTML = `<div class="prod-result-item" style="cursor:default;color:var(--text-muted)">Sin resultados</div>`;
    results.classList.add('open');
    return;
  }

  results.innerHTML = lista.map(p => {
    const stockNum  = parseFloat(p.stock_actual||0);
    let stockLabel, stockCls;
    if (tipo==='servicio') {
      stockLabel = 'Sin límite'; stockCls = 'stock-ok';
    } else if (stockNum <= 0) {
      stockLabel = 'Sin stock'; stockCls = 'stock-out';
    } else if (stockNum <= 5) {
      stockLabel = `Stock: ${stockNum}`; stockCls = 'stock-low';
    } else {
      stockLabel = `Stock: ${stockNum}`; stockCls = 'stock-ok';
    }
    const disabled = tipo==='producto' && stockNum<=0;
    return `
    <div class="prod-result-item" onclick="${disabled ? '' : `agregarAlCarrito('${p.id}','${tipo}')`}"
      style="${disabled ? 'opacity:.45;cursor:not-allowed;' : ''}">
      <div style="flex:1">
        <div class="pri-name">${esc(p.nombre)}</div>
        <div class="pri-sku">${p.sku ? esc(p.sku) : ''}</div>
      </div>
      <span class="pri-stock ${stockCls}">${stockLabel}</span>
      <span class="pri-precio">${fmt(p.precio)}</span>
    </div>`;
  }).join('');
  results.classList.add('open');
}

function agregarAlCarrito(productoId, tipo) {
  const prod = S.productosCache.find(p => p.id===productoId);
  if (!prod) return;

  // Ver si ya está en carrito
  const existente = S.carrito.find(c => c.id===productoId);
  if (existente) {
    // Aumentar cantidad (validando stock si es producto)
    if (tipo==='producto') {
      const stockDisp = parseFloat(prod.stock_actual||0);
      if (existente.cantidad >= stockDisp) {
        showToast(`Stock insuficiente. Máximo: ${stockDisp}`, 'error'); return;
      }
    }
    existente.cantidad++;
    recalcItem(existente);
  } else {
    const item = {
      id:       prod.id,
      nombre:   prod.nombre,
      sku:      prod.sku || '',
      tipo:     prod.tipo,
      cantidad: 1,
      precio:   parseFloat(prod.precio||0),
      costo:    parseFloat(prod.costo||0),
      descuento:0,
      subtotal: parseFloat(prod.precio||0),
      ganancia: parseFloat(prod.precio||0) - parseFloat(prod.costo||0),
      stockMax: tipo==='producto' ? parseFloat(prod.stock_actual||0) : Infinity,
    };
    S.carrito.push(item);
  }

  // Cerrar resultados
  const rId = tipo==='producto' ? 'prod-results' : 'serv-results';
  const iId = tipo==='producto' ? 'prod-search-input' : 'serv-search-input';
  const r = document.getElementById(rId);
  const i = document.getElementById(iId);
  if (r) r.classList.remove('open');
  if (i) { i.value=''; }

  renderCarrito(tipo);
  showToast(`${prod.nombre} agregado`, 'success');
}

function recalcItem(item) {
  item.subtotal = item.cantidad * item.precio - item.descuento;
  item.ganancia = item.cantidad * (item.precio - item.costo) - item.descuento;
}

function cambiarCantidad(productoId, val) {
  const item = S.carrito.find(c => c.id===productoId);
  if (!item) return;
  const n = parseFloat(val) || 0;
  if (n <= 0) { removeFromCarrito(productoId); return; }
  if (item.tipo==='producto' && n > item.stockMax) {
    showToast(`Stock máximo disponible: ${item.stockMax}`, 'error');
    return;
  }
  item.cantidad = n;
  recalcItem(item);
  renderCarrito(item.tipo);
}

function cambiarDescuento(productoId, val) {
  const item = S.carrito.find(c => c.id===productoId);
  if (!item) return;
  item.descuento = parseFloat(val) || 0;
  recalcItem(item);
  renderCarrito(item.tipo);
}

function removeFromCarrito(productoId) {
  const idx = S.carrito.findIndex(c => c.id===productoId);
  if (idx!==-1) S.carrito.splice(idx,1);
  const tipo = S.carrito.find(c => c.id===productoId)?.tipo || 'producto';
  renderCarritoAmbos();
}

function renderCarritoAmbos() {
  renderCarrito('producto');
  renderCarrito('servicio');
}

function renderCarrito(tipo) {
  const tbodyId = tipo==='producto' ? 'carrito-productos-tbody' : 'carrito-servicios-tbody';
  const tbody   = document.getElementById(tbodyId);
  if (!tbody) return;

  const items = S.carrito.filter(c => c.tipo===tipo);

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">
      Sin ${tipo==='producto' ? 'productos' : 'servicios'} agregados
    </td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr>
      <td>
        <div style="font-weight:600;font-size:13px">${esc(item.nombre)}</div>
        ${item.sku ? `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${esc(item.sku)}</div>` : ''}
      </td>
      <td>
        <input type="number" class="cart-qty-input" value="${item.cantidad}"
          min="0.01" step="0.01" max="${item.stockMax!==Infinity ? item.stockMax : ''}"
          onchange="cambiarCantidad('${item.id}',this.value)"/>
      </td>
      <td style="font-family:var(--font-mono);font-weight:600">${fmt(item.precio)}</td>
      <td>
        <input type="number" class="cart-desc-input" value="${item.descuento}"
          min="0" step="0.01" placeholder="0.00"
          onchange="cambiarDescuento('${item.id}',this.value)"/>
      </td>
      <td style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${fmt(item.subtotal)}</td>
      <td>
        <button class="cart-remove" onclick="removeFromCarrito('${item.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>`).join('');
}

/* ============================================================
   PASO 4 — RESUMEN + IVA
   ============================================================ */
function toggleIva() {
  S.ivaActivo = !S.ivaActivo;
  const sw    = document.getElementById('iva-switch');
  const input = document.getElementById('iva-porcentaje');
  if (sw)    sw.classList.toggle('on', S.ivaActivo);
  if (input) input.disabled = !S.ivaActivo;
  calcularResumen();
}

function cambiarIvaPorcentaje(val) {
  let n = parseFloat(val);
  if (isNaN(n) || n < 0) n = 0;
  if (n > 100) n = 100;
  S.ivaPorcentaje = n;
  const input = document.getElementById('iva-porcentaje');
  if (input) input.value = n;
  calcularResumen();
}

function calcularResumen() {
  const subtotal  = S.carrito.reduce((s,i) => s+i.cantidad*i.precio, 0);
  const descuento = S.carrito.reduce((s,i) => s+i.descuento, 0);
  const baseImponible = Math.max(subtotal - descuento, 0);
  const impuestos = S.ivaActivo ? +(baseImponible * (S.ivaPorcentaje/100)).toFixed(2) : 0;
  const total     = subtotal - descuento + impuestos;
  const ganancia  = S.carrito.reduce((s,i) => s+i.ganancia, 0);
  const costoTotal= S.carrito.reduce((s,i) => s+i.cantidad*i.costo, 0);

  // Guardar en estado para confirmar
  S._resumen = { subtotal, descuento, impuestos, total, ganancia, costoTotal };

  // Preview de items
  const preview = document.getElementById('resumen-items-preview');
  if (preview && S.carrito.length) {
    preview.innerHTML = `
      <table class="carrito-tabla" style="font-size:12.5px">
        <thead><tr><th>Ítem</th><th>Tipo</th><th>Qty</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${S.carrito.map(i => `
          <tr>
            <td style="font-weight:500">${esc(i.nombre)}</td>
            <td><span class="tipo-item-badge ${i.tipo==='producto'?'badge-prod':'badge-serv'}">${i.tipo}</span></td>
            <td>${i.cantidad}</td>
            <td>${fmt(i.precio)}</td>
            <td style="font-weight:700">${fmt(i.subtotal)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  const lbl = document.getElementById('res-impuestos-label');
  if (lbl) lbl.textContent = S.ivaActivo ? `Impuestos (IVA ${S.ivaPorcentaje}%)` : 'Impuestos';

  setEl2('res-subtotal',  fmt(subtotal));
  setEl2('res-descuento', descuento>0 ? `-${fmt(descuento)}` : fmt(0));
  setEl2('res-impuestos', fmt(impuestos));
  setEl2('res-total',     fmt(total));
  setEl2('res-ganancia',  fmt(ganancia));
}

function setEl2(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}

/* ============================================================
   PASO 5 — MÉTODO DE PAGO
   ============================================================ */
function renderMetodosPagoModal() {
  const grid = document.getElementById('metodos-grid');
  if (!grid) return;

  const iconos = {
    'Efectivo':'💵', 'Transferencia':'🏦', 'Tarjeta':'💳',
    'PayPal':'🅿️', 'Cheque':'📄', 'Débito':'💳'
  };

  if (!S.metodosPago.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">
      Sin métodos de pago configurados. Configúralos en Caja.
    </div>`;
    return;
  }

  grid.innerHTML = S.metodosPago.map(m => {
    const icon = iconos[m.nombre] || '💰';
    return `
    <div class="metodo-card ${S.metodoPagoId===m.id ? 'selected' : ''}"
      onclick="seleccionarMetodoPago('${m.id}','${esc(m.nombre)}')">
      <span class="mc-icon">${icon}</span>
      <span class="mc-name">${esc(m.nombre)}</span>
    </div>`;
  }).join('');
}

function seleccionarMetodoPago(id, nombre) {
  S.metodoPagoId   = id;
  S.metodoPagoNombre = nombre;
  document.getElementById('metodo-pago-id-selected').value   = id;
  document.getElementById('metodo-pago-nombre-selected').value = nombre;
  const err = document.getElementById('metodo-error');
  if (err) err.style.display = 'none';
  renderMetodosPagoModal();
}

/* ============================================================
   PASO 6 — RESUMEN FINAL
   ============================================================ */
function renderResumenFinal() {
  S.observaciones = document.getElementById('venta-observaciones')?.value || '';
  const r = S._resumen || {};
  const el = document.getElementById('resumen-final-contenido');
  if (!el) return;
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div><strong>Cliente:</strong> ${esc(S.clienteNombre)}</div>
      <div><strong>Método:</strong> ${esc(S.metodoPagoNombre)}</div>
      <div><strong>Ítems:</strong> ${S.carrito.length}</div>
      <div><strong>Número:</strong> ${esc(S.numeroVenta)}</div>
    </div>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>Subtotal</span><strong>${fmt(r.subtotal||0)}</strong>
      </div>
      ${(r.descuento||0)>0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>Descuento</span><strong style="color:var(--warning)">-${fmt(r.descuento)}</strong>
      </div>` : ''}
      ${S.ivaActivo ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>IVA (${S.ivaPorcentaje}%)</span><strong>${fmt(r.impuestos||0)}</strong>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;margin-top:8px">
        <span>TOTAL</span><strong style="color:var(--accent)">${fmt(r.total||0)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="color:var(--success)">Ganancia estimada</span>
        <strong style="color:var(--success)">${fmt(r.ganancia||0)}</strong>
      </div>
    </div>`;
}

/* ============================================================
   REGISTRAR MOVIMIENTO DE IMPUESTOS (IVA acumulado)
   ============================================================ */
async function registrarMovimientoImpuesto(userId, montoIva, ventaId, numeroVenta) {
  if (!montoIva || montoIva <= 0) return;
  try {
    const { data: ultMov } = await sb.from('movimientos_impuestos')
      .select('saldo_resultante')
      .eq('auth_user_id', userId)
      .order('created_at', { ascending:false }).limit(1).maybeSingle();

    const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
    const saldoRes = saldoAnt + montoIva;

    await sb.from('movimientos_impuestos').insert({
      auth_user_id:     userId,
      tipo_movimiento:  'IVA_VENTA',
      concepto:         `IVA de venta ${numeroVenta}`,
      monto:            montoIva,
      saldo_anterior:   saldoAnt,
      saldo_resultante: saldoRes,
      referencia_venta_id: ventaId,
      fecha:            todayISO(),
    });
  } catch(e) {
    console.warn('No se pudo registrar el movimiento de impuestos:', e);
  }
}

/* ============================================================
   RECIBO PDF — se genera automáticamente por cada venta
   Formato tipo "ticket" (80mm), profesional y ligero.
   No participa en el guardado de la venta: si falla, la venta
   ya quedó registrada igual (solo se avisa por toast).
   ============================================================ */
function dibujarRecibo(doc, venta, items) {
  const W = 80;               // ancho del ticket (mm)
  const M = 5;                 // margen lateral (mm)
  const CX = W / 2;
  let y = 8;

  const linea = (h = 4.6) => { y += h; };
  const centrado = (txt, size = 9, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.text(String(txt), CX, y, { align: 'center' });
  };
  const filaTexto = (izq, der, size = 8, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.text(String(izq), M, y);
    if (der !== undefined && der !== null && der !== '') {
      doc.text(String(der), W - M, y, { align: 'right' });
    }
  };
  const divisor = () => {
    doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(M, y, W - M, y);
    doc.setLineDashPattern([], 0);
    linea(4.5);
  };

  const biz = venta._negocio;

  // ---- Encabezado ----
  centrado(biz.nombre || 'Mi Negocio', 11.5, true);
  linea(5.2);
  if (biz.direccion) { centrado(biz.direccion, 7.5); linea(4); }
  if (biz.telefono)  { centrado(`Tel: ${biz.telefono}`, 7.5); linea(4); }
  if (biz.ruc)       { centrado(`RUC: ${biz.ruc}`, 7.5); linea(4); }
  linea(1.5);
  divisor();

  centrado('RECIBO DE VENTA', 9.5, true);
  linea(5.5);
  filaTexto('No. Venta:', venta.numero_venta || '—', 8, true);
  linea();
  filaTexto('Fecha:', fmtFecha(venta.fecha) + '  ' + (venta._hora || ''), 7.5);
  linea();
  filaTexto('Método de pago:', venta.metodo_pago_nombre || '—', 7.5);
  linea(5);
  divisor();

  // ---- Cliente ----
  // Si no hay cliente específico seleccionado en la venta, se usa el
  // texto genérico "Cliente" y se identifica con el número de venta.
  const tieneClienteEspecifico = !!venta.cliente_id;
  filaTexto('Cliente:', tieneClienteEspecifico ? (venta.cliente_nombre || 'Cliente') : 'Cliente', 8, true);
  linea();
  if (tieneClienteEspecifico && venta._clienteTelefono) {
    filaTexto('Teléfono:', venta._clienteTelefono, 7.5);
    linea();
  }
  filaTexto('N° Cliente:', tieneClienteEspecifico ? (venta._clienteNumero || '—') : (venta.numero_venta || '—'), 7.5);
  linea(5);
  divisor();

  // ---- Items ----
  filaTexto('Descripción', 'Subtotal', 7.5, true);
  linea(4.2);
  doc.setLineDashPattern([0.8, 0.8], 0);
  doc.line(M, y, W - M, y);
  doc.setLineDashPattern([], 0);
  linea(4.5);

  (items || []).forEach(it => {
    const nombreLineas = doc.splitTextToSize(it.producto_nombre || 'Ítem', W - M*2 - 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    nombreLineas.forEach((ln, i) => {
      doc.text(ln, M, y);
      if (i === nombreLineas.length - 1) {
        doc.text(fmt(it.subtotal), W - M, y, { align: 'right' });
      }
      linea(3.9);
    });
    const cant = Number(it.cantidad).toLocaleString('es-NI', { maximumFractionDigits: 2 });
    doc.setFontSize(7.3);
    doc.setTextColor(110, 110, 110);
    doc.text(`${cant} x ${fmt(it.precio)}${Number(it.descuento) > 0 ? `  (desc. ${fmt(it.descuento)})` : ''}`, M, y);
    doc.setTextColor(0, 0, 0);
    linea(4.6);
  });

  linea(1);
  divisor();

  // ---- Totales ----
  filaTexto('Subtotal:', fmt(venta.subtotal), 8); linea();
  if (Number(venta.descuento) > 0) { filaTexto('Descuento:', '-' + fmt(venta.descuento), 8); linea(); }
  if (Number(venta.impuesto) > 0) {
    filaTexto(`Impuesto${venta.iva_porcentaje ? ` (${Number(venta.iva_porcentaje)}%)` : ''}:`, fmt(venta.impuesto), 8);
    linea();
  }
  linea(1.2);
  filaTexto('TOTAL:', fmt(venta.total), 12, true);
  linea(7);
  divisor();

  if (venta.observaciones) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.3);
    const obsLineas = doc.splitTextToSize(`Nota: ${venta.observaciones}`, W - M*2);
    obsLineas.forEach(ln => { doc.text(ln, M, y); linea(3.8); });
    linea(1.5);
  }

  linea(2);
  centrado('¡Gracias por su compra!', 8.5, true);
  linea(4.5);
  centrado('Generado por Negocio360', 6.5);
  linea(5);

  return y; // alto total usado (mm)
}

function generarPDFRecibo(venta, items) {
  if (!window.jspdf) throw new Error('jsPDF no está disponible');
  const { jsPDF } = window.jspdf;

  // Datos del negocio, tomados de la config ya cargada en el módulo
  venta._negocio = {
    nombre:    S.empresaConfig?.nombre_comercial || S.currentUser?.nombre_negocio || 'Mi Negocio',
    direccion: S.empresaConfig?.direccion || '',
    telefono:  S.empresaConfig?.telefono || S.empresaConfig?.whatsapp || '',
    ruc:       S.empresaConfig?.ruc || '',
  };
  venta._hora = new Date().toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });

  // 1ª pasada (documento "borrador") solo para medir el alto necesario
  const draft = new jsPDF({ unit: 'mm', format: [80, 1000] });
  const altoUsado = dibujarRecibo(draft, venta, items);

  // 2ª pasada: documento final con el alto exacto (ticket compacto, sin espacio sobrante)
  const doc = new jsPDF({ unit: 'mm', format: [80, altoUsado + 6] });
  dibujarRecibo(doc, venta, items);
  return doc;
}

/* Descarga el recibo justo después de registrar la venta. Nunca
   interrumpe el flujo de guardado: cualquier error aquí solo se
   registra en consola y se avisa con un toast, la venta ya está guardada. */
function descargarReciboDeVenta(venta, items) {
  try {
    const doc = generarPDFRecibo(venta, items);
    doc.save(`Recibo_${(venta.numero_venta || 'venta').replace(/[^\w\-]/g, '')}.pdf`);
  } catch (e) {
    console.error('generar recibo PDF:', e);
    showToast('Venta guardada, pero no se pudo generar el recibo PDF', 'warning');
  }
}

/* Botón "🧾 Descargar recibo" del modal de detalle — reimprime el
   recibo de cualquier venta pasada, no solo la recién creada. */
async function descargarReciboActual() {
  const venta = S.ventas.find(v => v.id === S.ventaDetalleId);
  if (!venta) return;
  try {
    const { data: items } = await sb.from('venta_detalles').select('*')
      .eq('venta_id', S.ventaDetalleId).eq('auth_user_id', S.userId);
    descargarReciboDeVenta(venta, items || []);
  } catch (e) {
    console.error('descargarReciboActual:', e);
    showToast('No se pudo generar el recibo', 'error');
  }
}
window.descargarReciboActual = descargarReciboActual;

/* ============================================================
   CONFIRMAR VENTA — TRANSACCIÓN COMPLETA
   ============================================================ */
async function confirmarVenta() {
  if (!validarPasoActual()) return;
  if (!S.carrito.length) { showToast('El carrito está vacío', 'error'); return; }

  const btn = document.getElementById('btn-confirmar-venta');
  if (btn) { btn.disabled=true; btn.textContent='Guardando…'; }

  try {
    S.observaciones = document.getElementById('venta-observaciones')?.value.trim() || '';
    const r = S._resumen;

    /* ----------------------------------------------------------
       PASO A: Crear cliente rápido si aplica
    ---------------------------------------------------------- */
    if (S.clienteOpcion==='nuevo') {
      const nombre   = document.getElementById('cq-nombre')?.value.trim();
      const telefono = document.getElementById('cq-telefono')?.value.trim();
      const correo   = document.getElementById('cq-correo')?.value.trim();
      if (nombre) {
        const { data: nc, error: ce } = await sb.from('clientes').insert({
          auth_user_id: S.userId,
          nombre, telefono:telefono||null, correo:correo||null,
        }).select('id,nombre').single();
        if (!ce && nc) { S.clienteId = nc.id; S.clienteNombre = nc.nombre; }
      }
    }

    /* ----------------------------------------------------------
       PASO B: Asegurar número de venta definitivo
    ---------------------------------------------------------- */
    if (!S.numeroVenta || S.numeroVenta.startsWith('V-TMP')) {
      try {
        const { data: nv } = await sb.rpc('generar_numero_venta', { p_user_id: S.userId });
        if (nv) S.numeroVenta = nv;
      } catch { S.numeroVenta = `V-${Date.now()}`; }
    }

    /* ----------------------------------------------------------
       PASO C: Insertar venta principal
    ---------------------------------------------------------- */
    const ventaPayload = {
      auth_user_id:       S.userId,
      numero_venta:       S.numeroVenta,
      cliente_id:         S.clienteId || null,
      cliente_nombre:     S.clienteNombre,
      fecha:              todayISO(),
      subtotal:           r.subtotal,
      descuento:          r.descuento,
      impuesto:           r.impuestos,
      total:              r.total,
      costo_total:        r.costoTotal,
      metodo_pago_id:     S.metodoPagoId || null,
      metodo_pago_nombre: S.metodoPagoNombre,
      estado:             'completada',
      observaciones:      S.observaciones || null,
    };

    // Campos opcionales de IVA (si la columna no existe en la tabla, Supabase
    // devolverá error de columna desconocida; en ese caso reintentamos sin ellos)
    const ventaPayloadConIva = {
      ...ventaPayload,
      iva_activo:      S.ivaActivo,
      iva_porcentaje:  S.ivaActivo ? S.ivaPorcentaje : 0,
    };

    let ventaNueva, errVenta;
    ({ data: ventaNueva, error: errVenta } = await sb
      .from('ventas').insert(ventaPayloadConIva).select('id').single());

    if (errVenta) {
      // Reintentar sin columnas iva_* por si no existen en el esquema
      ({ data: ventaNueva, error: errVenta } = await sb
        .from('ventas').insert(ventaPayload).select('id').single());
    }
    if (errVenta) throw errVenta;

    const ventaId = ventaNueva.id;

    /* ----------------------------------------------------------
       PASO D: Insertar detalles de venta
    ---------------------------------------------------------- */
    const detallesPayload = S.carrito.map(item => ({
      auth_user_id:   S.userId,
      venta_id:       ventaId,
      producto_id:    item.id,
      producto_nombre:item.nombre,
      producto_sku:   item.sku || null,
      tipo_item:      item.tipo,
      cantidad:       item.cantidad,
      precio:         item.precio,
      costo:          item.costo,
      descuento:      item.descuento,
      subtotal:       item.subtotal,
      ganancia:       item.ganancia,
    }));

    const { error: errDetalles } = await sb.from('venta_detalles').insert(detallesPayload);
    if (errDetalles) throw errDetalles;

    /* ----------------------------------------------------------
       PASO E: Actualizar stock de PRODUCTOS (no servicios)
    ---------------------------------------------------------- */
    const productosVendidos = S.carrito.filter(i => i.tipo==='producto');
    for (const item of productosVendidos) {
      const prod = S.productosCache.find(p => p.id===item.id);
      if (!prod) continue;
      const nuevoStock = parseFloat(prod.stock_actual||0) - item.cantidad;
      const { error: errStock } = await sb.from('productos')
        .update({ stock_actual: Math.max(0, nuevoStock) })
        .eq('id', item.id).eq('auth_user_id', S.userId);
      if (errStock) console.warn('Error actualizando stock:', item.nombre, errStock);
      // Actualizar caché local
      prod.stock_actual = Math.max(0, nuevoStock);
    }

    /* ----------------------------------------------------------
       PASO F: Registrar movimiento en Caja
       (El monto que entra a caja es el TOTAL menos el IVA — el IVA
       se acumula aparte en el módulo de Impuestos, no en caja)
    ---------------------------------------------------------- */
    const montoIva  = Number(r.impuestos) || 0;
    const montoCaja = Number(r.total) - montoIva;

    try {
      // Obtener saldo actual de caja
      const { data: ultMov } = await sb.from('movimientos_financieros')
        .select('saldo_resultante')
        .eq('auth_user_id', S.userId).eq('estado','completado')
        .order('created_at',{ ascending:false }).limit(1).maybeSingle();

      const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
      const saldoRes = saldoAnt + montoCaja;

      const { data: movNuevo } = await sb.from('movimientos_financieros').insert({
        auth_user_id:       S.userId,
        tipo_flujo:         'INGRESO',
        tipo_movimiento:    'VENTA',
        concepto:           montoIva>0 ? `Venta ${S.numeroVenta} (neto de IVA)` : `Venta ${S.numeroVenta}`,
        monto:              montoCaja,
        saldo_anterior:     saldoAnt,
        saldo_resultante:   saldoRes,
        metodo_pago_id:     S.metodoPagoId || null,
        metodo_pago_nombre: S.metodoPagoNombre,
        referencia_tipo:    'venta',
        referencia_id:      ventaId,
        observaciones:      S.observaciones || null,
        fecha:              todayISO(),
      }).select('id').single();

      // Guardar referencia en la venta
      if (movNuevo?.id) {
        await sb.from('ventas').update({ referencia_caja: movNuevo.id }).eq('id', ventaId);
      }
    } catch(eCaja) {
      console.warn('No se pudo registrar en caja (caja.js lo manejará):', eCaja);
    }

    /* ----------------------------------------------------------
       PASO F-2: Registrar el IVA en el módulo de Impuestos
    ---------------------------------------------------------- */
    if (montoIva > 0) {
      await registrarMovimientoImpuesto(S.userId, montoIva, ventaId, S.numeroVenta);
    }

    /* ----------------------------------------------------------
       PASO G: Actualizar cliente (historial de compras)
    ---------------------------------------------------------- */
    if (S.clienteId) {
      try {
        // Incrementar total y número de compras del cliente
        const { data: cliente } = await sb.from('clientes')
          .select('total_compras,num_compras').eq('id',S.clienteId).maybeSingle();
        if (cliente) {
          await sb.from('clientes').update({
            total_compras: (Number(cliente.total_compras)||0) + r.total,
            num_compras:   (Number(cliente.num_compras)||0)   + 1,
          }).eq('id', S.clienteId).eq('auth_user_id', S.userId);
        }
      } catch(eCliente) { console.warn('Error actualizando cliente:', eCliente); }
    }

    /* ----------------------------------------------------------
       ÉXITO
    ---------------------------------------------------------- */
    cerrarModalVenta();
    showToast(`✅ Venta ${S.numeroVenta} registrada — ${fmt(r.total)}`, 'success');

    // Recibo PDF automático de esta venta (no bloquea ni afecta lo ya guardado)
    descargarReciboDeVenta(
      { ...ventaPayloadConIva, cliente_telefono: null, _clienteTelefono: S.clienteObjeto?.telefono || null },
      detallesPayload
    );

    // Refrescar todo
    await Promise.allSettled([
      loadVentas(),
      loadKPIs(),
      loadProductosCache(),
    ]);

    // Notificar al localStorage para que el dashboard se entere
    localStorage.setItem('n360_venta_nueva', JSON.stringify({
      ventaId, numero: S.numeroVenta, total: r.total, ganancia: r.ganancia, iva: montoIva, ts: Date.now()
    }));

  } catch(e) {
    console.error('confirmarVenta:', e);
    showToast('Error al registrar la venta: ' + (e.message||'intenta de nuevo'), 'error');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Confirmar venta'; }
  }
}

/* ============================================================
   FILTROS Y BÚSQUEDA
   ============================================================ */
window.setFiltro      = setFiltro;
window.buscarVentas   = buscarVentas;
window.paginaAnterior = paginaAnterior;
window.paginaSiguiente= paginaSiguiente;
window.abrirDetalle   = abrirDetalle;
window.abrirNuevaVenta= abrirNuevaVenta;
window.cerrarModalVenta=cerrarModalVenta;
window.closeModal     = closeModal;
window.loadVentas     = loadVentas;
window.selectClienteOpcion = selectClienteOpcion;
window.buscarClientes = buscarClientes;
window.seleccionarCliente = seleccionarCliente;
window.buscarProductosParaVenta = buscarProductosParaVenta;
window.agregarAlCarrito = agregarAlCarrito;
window.cambiarCantidad  = cambiarCantidad;
window.cambiarDescuento = cambiarDescuento;
window.removeFromCarrito= removeFromCarrito;
window.pasoSiguiente  = pasoSiguiente;
window.pasoAnterior   = pasoAnterior;
window.seleccionarMetodoPago = seleccionarMetodoPago;
window.confirmarVenta = confirmarVenta;
window.anularVenta    = anularVenta;
window.abrirConfirmarAnular = abrirConfirmarAnular;
window.toggleTheme    = toggleTheme;
window.toggleSidebar  = toggleSidebar;
window.navigate       = navigate;
window.toggleIva       = toggleIva;
window.cambiarIvaPorcentaje = cambiarIvaPorcentaje;

/* ============================================================
   CERRAR DROPDOWNS AL HACER CLICK FUERA
   ============================================================ */
document.addEventListener('click', e => {
  const dropdowns = [
    { input:'cliente-search-input', results:'clientes-results' },
    { input:'prod-search-input',    results:'prod-results' },
    { input:'serv-search-input',    results:'serv-results' },
  ];
  dropdowns.forEach(({ input, results }) => {
    const inp = document.getElementById(input);
    const res = document.getElementById(results);
    if (res && inp && !inp.contains(e.target) && !res.contains(e.target)) {
      res.classList.remove('open');
    }
  });
});

/* ============================================================
   KEYBOARD SHORTCUT
   ============================================================ */
document.addEventListener('keydown', e => {
  if (e.key==='Escape') {
    closeModal('modal-venta');
    closeModal('modal-detalle');
    closeModal('modal-anular');
  }
});

/* ============================================================
   INIT PRINCIPAL
   ============================================================ */
async function initVentas() {
  // Tema
  applyTheme(localStorage.getItem('n360_theme') || 'light');

  // Fecha en header
  const now = new Date();
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = now.toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    // 1. Sesión
    const { data:{ user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    S.userId    = user.id;
    S.userEmail = user.email;

    if (user.email) checkAdminAccess(user.email);

    // 2. Config empresa
    await loadEmpresaConfig(user.id);

    // 3. Perfil usuario
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent   = user.email?.split('@')[0] || 'Usuario';
      document.getElementById('header-avatar').textContent = (user.email||'U')[0].toUpperCase();
    }

    // 4. Mostrar app
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    // 5. Cargar datos en paralelo
    await Promise.allSettled([
      loadMetodosPago(),
      loadProductosCache(),
      loadClientesCache(),
    ]);

    // 6. Cargar KPIs y tabla
    await Promise.allSettled([
      loadKPIs(),
      loadVentas(),
      loadClientesRecurrentes(),
    ]);

    // 7. Si vienen de otro módulo con ?action=new, abrir modal
    const params = new URLSearchParams(window.location.search);
    if (params.get('action')==='new') {
      setTimeout(abrirNuevaVenta, 400);
    }

  } catch(err) {
    console.error('initVentas:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

/* ============================================================
   AUTH LISTENER
   ============================================================ */
sb.auth.onAuthStateChange((event) => {
  if (event==='SIGNED_OUT') window.location.href = 'login.html';
});

/* ============================================================
   ARRANQUE
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initVentas();
  if (window.lucide) lucide.createIcons();
});
