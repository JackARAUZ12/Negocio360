/* ============================================================
   COMPRAS.JS — NEGOCIO360
   Registro de compras a proveedores. Al confirmar una compra:
     1. Inserta en "compras" y "detalle_compras".
     2. Aumenta el stock_actual de cada producto comprado.
     3. Si el usuario elige "Descontar de caja", registra un
        egreso en movimientos_financieros (misma estructura que
        usa el módulo de Caja — saldo_anterior/saldo_resultante).
   RLS + Supabase Auth.
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
const CO = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  moneda:        'C$',

  compras:       [],
  comprasTotal:  0,
  page:          1,
  perPage:       20,
  filtro:        'todos',
  busqueda:      '',

  productos:     [],   // catálogo cacheado para el selector de ítems
  itemsCompra:   [],   // ítems de la compra en edición { producto_id, nombre, cantidad, costo }
  compraDetalleActiva: null,

  anularId:      null,
  anularNumero:  '',
};

/* ============================================================
   HELPERS
   ============================================================ */
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function sym() { return CO.moneda || 'C$'; }
function fmt(n) {
  const v = parseFloat(n || 0);
  return `${sym()} ${v.toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
}
function fmtNum(n) {
  const v = parseFloat(n || 0);
  return v.toLocaleString('es-NI', { minimumFractionDigits:0, maximumFractionDigits:2 });
}
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (String(iso).includes('T') ? '' : 'T12:00:00'));
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function todayISO() { return new Date().toISOString().split('T')[0]; }
function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function uid() { return 'itm_' + Math.random().toString(36).slice(2, 10); }

/* ============================================================
   TEMA
   ============================================================ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('n360_theme', t);
  const sun  = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = t === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

/* ============================================================
   SIDEBAR
   FIX: antes toggleSidebar() solo alternaba el modo "colapsado"
   (ícono-solo) de escritorio. En pantallas móviles (≤768px) el
   sidebar quedaba oculto por CSS y nada lo mostraba — el menú
   era inaccesible en celular. Ahora se detecta el viewport: en
   móvil abre/cierra un drawer con overlay; en escritorio
   conserva el comportamiento original de colapsar/expandir.
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
   MODALES
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
function showToast(msg, type = 'success') {
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
   FIX: el nombre del negocio se guarda en personalizacion.html
   dentro de configuracion_empresa.nombre_comercial. Aquí se
   buscaba primero "nombre_negocio" (campo que no existe en esa
   tabla), por lo que casi siempre caía al valor genérico por
   defecto. Ahora se prioriza nombre_comercial.
   ============================================================ */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*')
      .eq('auth_user_id', userId).maybeSingle();
    if (data) {
      CO.empresaConfig = data;
      CO.moneda = data.moneda || 'C$';
      const bizName = data.nombre_comercial || data.nombre_negocio || data.nombre || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      if (data.color_primario) {
        document.documentElement.style.setProperty('--accent', data.color_primario);
        document.documentElement.style.setProperty('--accent-soft', data.color_primario + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_primario);
      }
      if (data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
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
  const nombre   = user.nombre   || email?.split('@')[0] || 'Usuario';
  const apellido = user.apellido || '';
  // FIX: priorizar nombre_comercial de configuracion_empresa (el campo real
  // guardado por personalizacion.html) en vez de "Mi negocio" fijo.
  const biz      = CO.empresaConfig?.nombre_comercial || CO.empresaConfig?.nombre_negocio || user.nombre_negocio || 'Mi negocio';
  const plan     = user.plan || 'Gratuito';
  const initials = ((nombre[0]||'') + (apellido[0]||'')).toUpperCase();

  document.getElementById('header-name').textContent   = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent    = biz;
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent     = plan.charAt(0).toUpperCase() + plan.slice(1);
}

/* ============================================================
   KPIs
   ============================================================ */
async function loadKPIs() {
  try {
    const { data: compras } = await sb.from('compras')
      .select('total,proveedor_nombre,fecha')
      .eq('auth_user_id', CO.userId)
      .neq('estado', 'anulada');

    const arr = compras || [];
    const totalInv = arr.reduce((s,c) => s + Number(c.total), 0);
    const count    = arr.length;
    const promedio = count > 0 ? totalInv / count : 0;

    const provMap = {};
    arr.forEach(c => {
      const prov = c.proveedor_nombre || 'Sin proveedor';
      provMap[prov] = (provMap[prov] || 0) + Number(c.total);
    });
    const provSorted = Object.entries(provMap).sort((a,b) => b[1]-a[1]);
    const provPrincipal = provSorted[0] || ['—', 0];

    const { data: detalles } = await sb.from('detalle_compras')
      .select('cantidad')
      .eq('auth_user_id', CO.userId);
    const unidades = (detalles || []).reduce((s,d) => s + Number(d.cantidad), 0);

    setEl('kpi-monto',           fmt(totalInv));
    setEl('kpi-count',           `${count} compra${count !== 1 ? 's' : ''}`);
    setEl('kpi-promedio',        fmt(promedio));
    setEl('kpi-proveedor',       provPrincipal[0]);
    setEl('kpi-proveedor-monto', fmt(provPrincipal[1]));
    setEl('kpi-unidades',        fmtNum(unidades));

  } catch(e) { console.warn('loadKPIs:', e); }
}

function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

/* ============================================================
   CARGAR COMPRAS (tabla principal)
   ============================================================ */
async function loadCompras() {
  const tbody = document.getElementById('compras-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="7">Cargando compras…</td></tr>';

  try {
    let q = sb.from('compras')
      .select('*', { count: 'exact' })
      .eq('auth_user_id', CO.userId)
      .order('fecha', { ascending: false });

    const b = CO.busqueda.trim();
    if (b) q = q.or(`numero.ilike.%${b}%,proveedor_nombre.ilike.%${b}%`);

    switch (CO.filtro) {
      case 'completada': q = q.eq('estado', 'completada'); break;
      case 'anulada':     q = q.eq('estado', 'anulada');    break;
      case 'mes':         q = q.gte('fecha', startOfMonthISO()); break;
    }

    const fromR = (CO.page - 1) * CO.perPage;
    q = q.range(fromR, fromR + CO.perPage - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    CO.compras      = data || [];
    CO.comprasTotal = count || 0;

    renderTablaCompras();
    renderPaginacion();
    updateCountLabel();

  } catch(e) {
    console.error('loadCompras:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Error al cargar compras.</td></tr>`;
  }
}

function renderTablaCompras() {
  const tbody = document.getElementById('compras-tbody');
  if (!tbody) return;

  if (!CO.compras.length) {
    tbody.innerHTML = `
      <tr><td colspan="7" class="empty-cell">
        <div class="empty-icon">🛒</div>
        <p>${CO.busqueda ? 'Sin resultados para "' + esc(CO.busqueda) + '"' : 'Sin compras registradas'}</p>
        <button class="btn-primary" style="margin-top:12px" onclick="abrirModalNuevaCompra()">+ Nueva compra</button>
      </td></tr>`;
    return;
  }

  const estadoCls = { completada:'estado-completada', anulada:'estado-anulada', pendiente:'estado-pendiente' };

  tbody.innerHTML = CO.compras.map(c => `
    <tr style="cursor:pointer" onclick="abrirDetalle('${c.id}')">
      <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--accent);font-weight:700">${esc(c.numero)}</span></td>
      <td style="color:var(--text-secondary);font-size:12.5px">${fmtFecha(c.fecha)}</td>
      <td style="font-weight:500">${esc(c.proveedor_nombre || '—')}</td>
      <td style="color:var(--text-secondary);font-size:13px">${esc(c.metodo_pago_nombre || '—')}</td>
      <td class="td-money" style="color:var(--accent-3)">${fmt(c.total)}</td>
      <td><span class="estado-badge ${estadoCls[c.estado] || 'estado-completada'}">${c.estado}</span></td>
      <td class="td-actions" onclick="event.stopPropagation()">
        <button class="btn-icon-sm" title="Ver detalle" onclick="abrirDetalle('${c.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        ${c.estado !== 'anulada' ? `
        <button class="btn-icon-sm del" title="Anular" onclick="confirmarAnular('${c.id}','${esc(c.numero)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        </button>` : ''}
      </td>
    </tr>`).join('');
}

function renderPaginacion() {
  const total = Math.ceil(CO.comprasTotal / CO.perPage);
  const info  = document.getElementById('pag-info');
  const prev  = document.getElementById('btn-prev');
  const next  = document.getElementById('btn-next');

  if (info) {
    const f = Math.min((CO.page-1)*CO.perPage+1, CO.comprasTotal);
    const t = Math.min(CO.page*CO.perPage, CO.comprasTotal);
    info.textContent = CO.comprasTotal > 0 ? `Mostrando ${f}–${t} de ${CO.comprasTotal}` : 'Sin resultados';
  }
  if (prev) prev.disabled = CO.page <= 1;
  if (next) next.disabled = CO.page >= total;
}

function updateCountLabel() {
  const el = document.getElementById('compras-count-label');
  if (el) el.textContent = `${CO.comprasTotal} compra${CO.comprasTotal !== 1 ? 's' : ''}`;
}

function paginaAnterior() { if (CO.page > 1) { CO.page--; loadCompras(); } }
function paginaSiguiente() {
  if (CO.page < Math.ceil(CO.comprasTotal / CO.perPage)) { CO.page++; loadCompras(); }
}

function setFiltro(f) {
  CO.filtro = f;
  CO.page   = 1;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  loadCompras();
}

let busquedaTimer = null;
function buscarCompras() {
  CO.busqueda = document.getElementById('compra-search')?.value || '';
  CO.page = 1;
  clearTimeout(busquedaTimer);
  busquedaTimer = setTimeout(loadCompras, 320);
}

/* ============================================================
   CATÁLOGO DE PRODUCTOS (para selector de ítems)
   ============================================================ */
async function cargarCatalogoProductos() {
  try {
    const { data } = await sb.from('productos')
      .select('id,nombre,costo,tipo,activo')
      .eq('auth_user_id', CO.userId)
      .eq('tipo', 'producto')
      .eq('activo', true)
      .order('nombre');
    CO.productos = data || [];
  } catch(e) { console.warn('cargarCatalogoProductos:', e); CO.productos = []; }
}

/* ============================================================
   IMPACTO EN CAJA (toggle igual al de Productos)
   ============================================================ */
function setCajaImpacto(descontar) {
  const input = document.getElementById('inputDescontarCaja');
  if (input) input.value = descontar ? 'true' : 'false';
  const btnSi = document.getElementById('toggleDescontarCaja');
  const btnNo = document.getElementById('toggleNoDescontarCaja');
  if (btnSi) btnSi.classList.toggle('active', descontar);
  if (btnNo) btnNo.classList.toggle('active', !descontar);

  const hint = document.getElementById('cajaImpactoHint');
  if (!hint) return;
  hint.textContent = descontar
    ? 'Se registrará un egreso en Caja por el total de esta compra. Úsalo cuando estés comprando este inventario ahora.'
    : 'No se afectará tu caja. Úsalo para inventario que ya tenías físicamente antes de empezar a usar el sistema.';
}

/* ============================================================
   MODAL NUEVA COMPRA — manejo de ítems dinámicos
   ============================================================ */
async function abrirModalNuevaCompra() {
  document.getElementById('fc-proveedor').value = '';
  document.getElementById('fc-metodo-pago').value = 'Efectivo';
  document.getElementById('fc-notas').value = '';
  CO.itemsCompra = [];
  setCajaImpacto(true);

  await cargarCatalogoProductos();
  renderItemsCompra();
  actualizarTotales();

  openModal('modal-compra');
}

function agregarItemCompra() {
  if (!CO.productos.length) {
    showToast('No tienes productos activos. Crea uno primero en Productos.', 'warning');
    return;
  }
  CO.itemsCompra.push({
    _id: uid(),
    producto_id: CO.productos[0].id,
    nombre: CO.productos[0].nombre,
    cantidad: 1,
    costo: Number(CO.productos[0].costo || 0),
  });
  renderItemsCompra();
  actualizarTotales();
}

function quitarItemCompra(itemId) {
  CO.itemsCompra = CO.itemsCompra.filter(i => i._id !== itemId);
  renderItemsCompra();
  actualizarTotales();
}

function actualizarItemCompra(itemId, campo, valor) {
  const item = CO.itemsCompra.find(i => i._id === itemId);
  if (!item) return;
  if (campo === 'producto_id') {
    const p = CO.productos.find(x => x.id === valor);
    item.producto_id = valor;
    item.nombre = p ? p.nombre : item.nombre;
    if (p) item.costo = Number(p.costo || 0);
  } else if (campo === 'cantidad') {
    item.cantidad = Math.max(0, parseFloat(valor) || 0);
  } else if (campo === 'costo') {
    item.costo = Math.max(0, parseFloat(valor) || 0);
  }
  renderItemsCompra(true);
  actualizarTotales();
}

function renderItemsCompra(preservarFoco) {
  const tbody = document.getElementById('items-compra-tbody');
  if (!tbody) return;

  if (!CO.itemsCompra.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="items-empty">Agrega al menos un producto</td></tr>`;
    return;
  }

  tbody.innerHTML = CO.itemsCompra.map(item => {
    const subtotal = item.cantidad * item.costo;
    const opciones = CO.productos.map(p =>
      `<option value="${p.id}" ${p.id === item.producto_id ? 'selected' : ''}>${esc(p.nombre)}</option>`
    ).join('');
    return `
      <tr>
        <td>
          <select onchange="actualizarItemCompra('${item._id}','producto_id',this.value)">${opciones}</select>
        </td>
        <td>
          <input type="number" min="0" step="0.01" value="${item.cantidad}"
            oninput="actualizarItemCompra('${item._id}','cantidad',this.value)"/>
        </td>
        <td>
          <input type="number" min="0" step="0.01" value="${item.costo}"
            oninput="actualizarItemCompra('${item._id}','costo',this.value)"/>
        </td>
        <td style="font-weight:700;font-family:var(--font-mono)">${fmt(subtotal)}</td>
        <td>
          <button type="button" class="item-remove-btn" onclick="quitarItemCompra('${item._id}')" title="Quitar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </td>
      </tr>`;
  }).join('');
}

function actualizarTotales() {
  const subtotal = CO.itemsCompra.reduce((s,i) => s + (i.cantidad * i.costo), 0);
  setEl('fc-subtotal', fmt(subtotal));
  setEl('fc-total',    fmt(subtotal));

  const descontar = document.getElementById('inputDescontarCaja')?.value !== 'false';
  const hint = document.getElementById('cajaImpactoHint');
  if (hint && descontar) {
    hint.textContent = subtotal > 0
      ? `Se descontarán ${fmt(subtotal)} de tu caja al guardar. Úsalo cuando estés comprando este inventario ahora.`
      : 'Se registrará un egreso en Caja por el total de esta compra. Úsalo cuando estés comprando este inventario ahora.';
  }
}

/* ============================================================
   GUARDAR COMPRA
   1. Inserta compras + detalle_compras
   2. Aumenta stock_actual de cada producto
   3. Si aplica, registra egreso en movimientos_financieros
   ============================================================ */
async function guardarCompra() {
  const proveedor = document.getElementById('fc-proveedor')?.value.trim();
  if (!proveedor) { showToast('El proveedor es obligatorio', 'error'); return; }
  if (!CO.itemsCompra.length) { showToast('Agrega al menos un producto', 'error'); return; }

  const itemsValidos = CO.itemsCompra.filter(i => i.cantidad > 0 && i.producto_id);
  if (!itemsValidos.length) { showToast('Revisa las cantidades de los productos', 'error'); return; }

  const metodoPago = document.getElementById('fc-metodo-pago')?.value || 'Efectivo';
  const notas      = document.getElementById('fc-notas')?.value.trim() || null;
  const subtotal   = itemsValidos.reduce((s,i) => s + (i.cantidad * i.costo), 0);
  const total      = subtotal;
  const descontarCaja = document.getElementById('inputDescontarCaja')?.value !== 'false';

  const btn = document.getElementById('btn-guardar-compra');
  if (btn) { btn.disabled = true; }

  try {
    const numero = `COMP-${Date.now().toString().slice(-8)}`;

    // 1. Insertar compra
    const { data: compraInsertada, error: errCompra } = await sb.from('compras').insert({
      auth_user_id:       CO.userId,
      numero,
      fecha:              todayISO(),
      proveedor_nombre:   proveedor,
      subtotal,
      total,
      metodo_pago_nombre: metodoPago,
      notas,
      estado:             'completada',
    }).select().single();

    if (errCompra) throw errCompra;
    const compraId = compraInsertada.id;

    // 2. Insertar detalle_compras + aumentar stock de cada producto
    for (const item of itemsValidos) {
      await sb.from('detalle_compras').insert({
        auth_user_id:    CO.userId,
        compra_id:       compraId,
        producto_id:     item.producto_id,
        producto_nombre: item.nombre,
        cantidad:        item.cantidad,
        costo_unitario:  item.costo,
        subtotal:        item.cantidad * item.costo,
      });

      const { data: prod } = await sb.from('productos')
        .select('stock_actual').eq('id', item.producto_id).eq('auth_user_id', CO.userId).maybeSingle();
      const nuevoStock = Number(prod?.stock_actual || 0) + Number(item.cantidad);
      await sb.from('productos')
        .update({ stock_actual: nuevoStock, costo: item.costo })
        .eq('id', item.producto_id).eq('auth_user_id', CO.userId);
    }

    // 3. Impacto en caja (egreso), autocontenido — misma estructura que usa Caja
    if (descontarCaja && total > 0) {
      await registrarEgresoEnCaja(`Compra a proveedor: ${proveedor}`, total, compraId);
    }

    closeModal('modal-compra');
    showToast(
      descontarCaja
        ? `Compra registrada · Se descontó ${fmt(total)} de caja`
        : 'Compra registrada',
      'success'
    );
    await Promise.allSettled([loadCompras(), loadKPIs()]);

  } catch(e) {
    console.error('guardarCompra:', e);
    showToast('Error al guardar: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================
   REGISTRAR EGRESO EN CAJA
   Autocontenido — no depende de caja.js/cajaAPI.js. Usa la
   misma tabla y campos (movimientos_financieros con
   saldo_anterior/saldo_resultante) para que el movimiento se
   vea correctamente reflejado en el módulo de Caja.
   ============================================================ */
async function registrarEgresoEnCaja(concepto, monto, referenciaId) {
  try {
    const { data: ultMov } = await sb.from('movimientos_financieros')
      .select('saldo_resultante')
      .eq('auth_user_id', CO.userId)
      .eq('estado', 'completado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const saldoAnterior   = ultMov ? Number(ultMov.saldo_resultante) : 0;
    const saldoResultante = saldoAnterior - monto;

    const { error } = await sb.from('movimientos_financieros').insert({
      auth_user_id:       CO.userId,
      tipo_flujo:         'EGRESO',
      tipo_movimiento:    'COMPRA',
      concepto,
      monto,
      saldo_anterior:      saldoAnterior,
      saldo_resultante:    saldoResultante,
      metodo_pago_nombre: 'Efectivo',
      referencia_tipo:    'compra',
      referencia_id:       referenciaId || null,
      fecha:               todayISO(),
      estado:              'completado',
    });

    if (error) throw error;

    try {
      localStorage.setItem('n360_caja', saldoResultante.toString());
      localStorage.setItem('n360_capital', saldoResultante.toString());
      localStorage.setItem('n360_caja_updated', new Date().toISOString());
    } catch(_) { /* silencioso */ }

    return { ok: true, saldoResultante };
  } catch(e) {
    console.warn('registrarEgresoEnCaja:', e);
    return { ok: false, error: e.message };
  }
}

async function revertirEgresoEnCaja(concepto, monto, referenciaId) {
  // Revertir es lo opuesto: un ingreso por el mismo monto
  try {
    const { data: ultMov } = await sb.from('movimientos_financieros')
      .select('saldo_resultante')
      .eq('auth_user_id', CO.userId)
      .eq('estado', 'completado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const saldoAnterior   = ultMov ? Number(ultMov.saldo_resultante) : 0;
    const saldoResultante = saldoAnterior + monto;

    await sb.from('movimientos_financieros').insert({
      auth_user_id:       CO.userId,
      tipo_flujo:         'INGRESO',
      tipo_movimiento:    'AJUSTE',
      concepto:           `Reverso — ${concepto}`,
      monto,
      saldo_anterior:      saldoAnterior,
      saldo_resultante:    saldoResultante,
      metodo_pago_nombre: 'Efectivo',
      referencia_tipo:    'compra',
      referencia_id:       referenciaId || null,
      fecha:               todayISO(),
      estado:              'completado',
    });
  } catch(e) { console.warn('revertirEgresoEnCaja:', e); }
}

/* ============================================================
   DETALLE DE COMPRA
   ============================================================ */
async function abrirDetalle(compraId) {
  const c = CO.compras.find(x => x.id === compraId);
  if (!c) return;
  CO.compraDetalleActiva = c;

  document.getElementById('det-title').textContent    = `Compra ${c.numero}`;
  document.getElementById('det-subtitle').textContent = fmtFecha(c.fecha);

  const btnAnular = document.getElementById('btn-anular-desde-detalle');
  if (btnAnular) btnAnular.style.display = c.estado === 'anulada' ? 'none' : '';

  const body = document.getElementById('det-body');
  body.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted)">Cargando…</p>';
  openModal('modal-detalle');

  try {
    const { data: items } = await sb.from('detalle_compras')
      .select('*').eq('compra_id', compraId).eq('auth_user_id', CO.userId);

    const its = items || [];
    const estadoCls = { completada:'estado-completada', anulada:'estado-anulada', pendiente:'estado-pendiente' };

    body.innerHTML = `
      <div class="detalle-grid">
        <div class="detalle-item">
          <div class="detalle-label">Número</div>
          <div class="detalle-value" style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(c.numero)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Estado</div>
          <div class="detalle-value"><span class="estado-badge ${estadoCls[c.estado]||'estado-completada'}">${c.estado}</span></div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Proveedor</div>
          <div class="detalle-value">${esc(c.proveedor_nombre || '—')}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Método de pago</div>
          <div class="detalle-value">${esc(c.metodo_pago_nombre || '—')}</div>
        </div>
        ${c.notas ? `
        <div class="detalle-item full">
          <div class="detalle-label">Notas</div>
          <div class="detalle-value">${esc(c.notas)}</div>
        </div>` : ''}
        <div class="detalle-divider"></div>
        <div class="detalle-item full">
          <div class="detalle-label">Productos comprados</div>
          <div class="items-table-wrap">
            <table class="items-table">
              <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unit.</th><th>Subtotal</th></tr></thead>
              <tbody>
                ${its.map(it => `
                <tr>
                  <td style="font-weight:500">${esc(it.producto_nombre)}</td>
                  <td>${fmtNum(it.cantidad)}</td>
                  <td>${fmt(it.costo_unitario)}</td>
                  <td style="font-weight:700">${fmt(it.subtotal)}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="items-empty">Sin ítems registrados</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="detalle-divider"></div>
        <div class="detalle-item">
          <div class="detalle-label">Subtotal</div>
          <div class="detalle-value">${fmt(c.subtotal)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">TOTAL</div>
          <div class="detalle-value" style="font-size:20px;font-weight:800;color:var(--accent-3)">${fmt(c.total)}</div>
        </div>
      </div>`;
  } catch(e) {
    body.innerHTML = `<p style="color:var(--danger);padding:20px">Error: ${e.message}</p>`;
  }
}

/* ============================================================
   ANULAR COMPRA
   Revierte stock y, si aplicó, revierte el egreso de caja.
   ============================================================ */
function confirmarAnular(id, numero) {
  CO.anularId     = id;
  CO.anularNumero = numero;
  document.getElementById('confirm-anular-numero').textContent = numero;
  openModal('modal-anular');
}

function confirmarAnularDesdeDetalle() {
  const c = CO.compraDetalleActiva;
  if (!c || c.estado === 'anulada') return;
  closeModal('modal-detalle');
  confirmarAnular(c.id, c.numero);
}

async function ejecutarAnular() {
  if (!CO.anularId) return;
  const btn = document.getElementById('btn-confirmar-anular');
  if (btn) btn.disabled = true;

  try {
    const { data: compra } = await sb.from('compras')
      .select('*').eq('id', CO.anularId).eq('auth_user_id', CO.userId).maybeSingle();
    if (!compra) throw new Error('Compra no encontrada');

    const { data: items } = await sb.from('detalle_compras')
      .select('*').eq('compra_id', CO.anularId).eq('auth_user_id', CO.userId);

    // Revertir stock de cada producto
    for (const it of (items || [])) {
      const { data: prod } = await sb.from('productos')
        .select('stock_actual').eq('id', it.producto_id).eq('auth_user_id', CO.userId).maybeSingle();
      if (prod) {
        const nuevoStock = Math.max(0, Number(prod.stock_actual || 0) - Number(it.cantidad));
        await sb.from('productos')
          .update({ stock_actual: nuevoStock })
          .eq('id', it.producto_id).eq('auth_user_id', CO.userId);
      }
    }

    // Marcar como anulada
    const { error } = await sb.from('compras')
      .update({ estado: 'anulada' })
      .eq('id', CO.anularId).eq('auth_user_id', CO.userId);
    if (error) throw error;

    // Revertir el egreso de caja si existía uno asociado
    try {
      const { data: mov } = await sb.from('movimientos_financieros')
        .select('id,monto').eq('referencia_tipo','compra').eq('referencia_id', CO.anularId)
        .eq('auth_user_id', CO.userId).eq('tipo_flujo','EGRESO').maybeSingle();
      if (mov) {
        await revertirEgresoEnCaja(`Compra a proveedor: ${compra.proveedor_nombre}`, Number(mov.monto), CO.anularId);
      }
    } catch(_) { /* silencioso */ }

    showToast(`Compra ${CO.anularNumero} anulada`, 'warning');
    closeModal('modal-anular');
    CO.anularId = null;
    await Promise.allSettled([loadCompras(), loadKPIs()]);

  } catch(e) {
    showToast('Error al anular: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================
   EVENTOS DE TOGGLE (caja) — enlazados en init
   ============================================================ */
function initEventosModal() {
  const btnSi = document.getElementById('toggleDescontarCaja');
  const btnNo = document.getElementById('toggleNoDescontarCaja');
  if (btnSi) btnSi.addEventListener('click', () => { setCajaImpacto(true); actualizarTotales(); });
  if (btnNo) btnNo.addEventListener('click', () => { setCajaImpacto(false); actualizarTotales(); });
}

/* ============================================================
   EXPORTS GLOBALES
   ============================================================ */
window.toggleTheme              = toggleTheme;
window.toggleSidebar            = toggleSidebar;
window.closeMobileSidebar       = closeMobileSidebar;
window.navigate                 = navigate;
window.openModal                = openModal;
window.closeModal               = closeModal;
window.setFiltro                = setFiltro;
window.buscarCompras            = buscarCompras;
window.paginaAnterior           = paginaAnterior;
window.paginaSiguiente          = paginaSiguiente;
window.abrirModalNuevaCompra    = abrirModalNuevaCompra;
window.agregarItemCompra        = agregarItemCompra;
window.quitarItemCompra         = quitarItemCompra;
window.actualizarItemCompra     = actualizarItemCompra;
window.guardarCompra            = guardarCompra;
window.abrirDetalle             = abrirDetalle;
window.confirmarAnular          = confirmarAnular;
window.confirmarAnularDesdeDetalle = confirmarAnularDesdeDetalle;
window.ejecutarAnular           = ejecutarAnular;
window.loadCompras              = loadCompras;

/* ============================================================
   KEYBOARD
   ============================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['modal-compra','modal-detalle','modal-anular'].forEach(closeModal);
  }
});

/* ============================================================
   INIT
   ============================================================ */
async function initCompras() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  initEventosModal();

  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI',
    { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data:{ user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    CO.userId    = user.id;
    CO.userEmail = user.email;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent   = user.email?.split('@')[0] || 'Usuario';
      document.getElementById('header-avatar').textContent = (user.email||'U')[0].toUpperCase();
    }

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.allSettled([loadKPIs(), loadCompras()]);

  } catch(err) {
    console.error('initCompras:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

document.addEventListener('DOMContentLoaded', () => {
  initCompras();
  if (window.lucide) lucide.createIcons();
});
