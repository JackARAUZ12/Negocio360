/* ============================================================
   PRODUCTOS.JS — Módulo Productos/Servicios
   Supabase Auth + RLS + Vanilla JS
   ============================================================ */

'use strict';

// ============================================================
// CONFIG SUPABASE
// ============================================================
const SUPABASE_URL      = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

let supabaseClient = null;

function initSupabase() {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

// ============================================================
// MONEDAS — Símbolo dinámico según configuración de empresa
// ============================================================
const CURRENCY_SYMBOLS = {
  NIO: 'C$', USD: '$',  GTQ: 'Q',   HNL: 'L',
  CRC: '₡',  PAB: 'B/', MXN: '$',   COP: '$',
  PEN: 'S/', CLP: '$',  ARS: '$',   EUR: '€',
};

// Se cargará desde Supabase en cargarDatosEmpresa()
let MONEDA_CODIGO  = 'USD';
let MONEDA_SIMBOLO = '$';

// ============================================================
// ESTADO GLOBAL
// ============================================================
const STATE = {
  user:         null,
  empresa:      null,
  productos:    [],
  filtrados:    [],
  filtroActivo: 'todos',
  busqueda:     '',
  cargando:     false,
  modalMode:    null,   // 'crear' | 'editar' | 'ver' | 'duplicar'
  editTarget:   null,
  movTarget:    null,
};

// ============================================================
// DOM HELPERS
// ============================================================
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ============================================================
// FORMATO MONEDA
// ============================================================
function fmtMoney(val) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return MONEDA_SIMBOLO + n.toLocaleString('es-NI', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNum(val) {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('es-NI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ============================================================
// CALCULAR MARGEN
// ============================================================
function calcMargen(precio, costo) {
  const p = parseFloat(precio);
  const c = parseFloat(costo);
  if (!p || p === 0) return null;
  return ((p - (isNaN(c) ? 0 : c)) / p) * 100;
}

function renderMargen(precio, costo) {
  const m = calcMargen(precio, costo);
  if (m === null) return '<span class="td-money" style="color:var(--text-muted)">—</span>';
  const cls = m >= 40 ? 'margin-good' : m >= 20 ? 'margin-mid' : 'margin-low';
  return `<span class="td-margin ${cls}">${m.toFixed(1)}%</span>`;
}

// ============================================================
// FECHA ACTUAL
// ============================================================
function fechaActual() {
  return new Date().toLocaleDateString('es-NI', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function fmtFecha(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-NI', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// ============================================================
// MODO OSCURO
// ============================================================
function initTema() {
  const saved = localStorage.getItem('tema') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  actualizarIconoTema(saved);
  const btn = $('btnTema');
  if (btn) btn.addEventListener('click', toggleTema);
}

function toggleTema() {
  const actual = document.documentElement.getAttribute('data-theme');
  const nuevo  = actual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nuevo);
  localStorage.setItem('tema', nuevo);
  actualizarIconoTema(nuevo);
}

function actualizarIconoTema(tema) {
  const btn = $('btnTema');
  if (btn) btn.textContent = tema === 'dark' ? '☀️' : '🌙';
}

// ============================================================
// SIDEBAR MÓVIL
// ============================================================
function initSidebar() {
  const btn     = $('menuToggle');
  const overlay = $('sidebarOverlay');
  const sidebar = $('sidebar');
  if (btn) {
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    });
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }
}

// ============================================================
// TOASTS
// ============================================================
function showToast(tipo, titulo, mensaje, duracion = 3500) {
  const container = $('toastContainer');
  if (!container) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[tipo] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${titulo}</div>
      ${mensaje ? `<div class="toast-msg">${mensaje}</div>` : ''}
    </div>
    <button class="toast-close" onclick="removeToast(this.parentElement)">✕</button>
  `;
  container.appendChild(toast);
  setTimeout(() => removeToast(toast), duracion);
}

function removeToast(toast) {
  if (!toast) return;
  toast.classList.add('removing');
  setTimeout(() => toast.remove(), 300);
}

// ============================================================
// AUTENTICACIÓN
// ============================================================
async function checkAuth() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'index.html'; return false; }
    STATE.user = session.user;
    return true;
  } catch (e) {
    console.error('checkAuth error:', e);
    window.location.href = 'index.html';
    return false;
  }
}

// ============================================================
// CARGAR DATOS EMPRESA
// FIX: Búsqueda robusta de moneda en múltiples fuentes,
//      incluyendo preferencias jsonb de la tabla usuarios
// ============================================================
async function cargarDatosEmpresa() {
  try {
    const [resUsuario, resEmpresa] = await Promise.all([
      supabaseClient
        .from('usuarios')
        .select('*')
        .eq('auth_user_id', STATE.user.id)
        .maybeSingle(),
      supabaseClient
        .from('configuracion_empresa')
        .select('*')
        .eq('auth_user_id', STATE.user.id)
        .maybeSingle(),
    ]);

    const perfil  = resUsuario.data  || {};
    const empresa = resEmpresa.data  || {};

    STATE.perfil  = perfil;
    STATE.empresa = empresa;

    // ── FIX MONEDA ────────────────────────────────────────────
    // Orden de prioridad:
    // 1. configuracion_empresa.moneda  (fuente principal del onboarding)
    // 2. usuarios.preferencias.moneda  (jsonb — el schema NO tiene columna moneda directa)
    // 3. Fallback a 'USD'
    // NOTA: usuarios NO tiene columna 'moneda', tiene 'preferencias' jsonb
    const monedaDeEmpresa      = (empresa.moneda || '').trim();
    const monedaDePreferencias = (perfil.preferencias?.moneda || '').trim();

    const monedaCodigo =
      monedaDeEmpresa      !== '' ? monedaDeEmpresa      :
      monedaDePreferencias !== '' ? monedaDePreferencias :
      'USD';

    MONEDA_CODIGO  = monedaCodigo;
    MONEDA_SIMBOLO = CURRENCY_SYMBOLS[monedaCodigo] || monedaCodigo;

    // Actualizar indicador de moneda en header
    const monedaEl = $('monedaIndicador');
    if (monedaEl) monedaEl.textContent = `${MONEDA_SIMBOLO} (${MONEDA_CODIGO})`;

    console.log('[Moneda]', {
      monedaCodigo,
      MONEDA_SIMBOLO,
      empresa_raw:      empresa.moneda,
      preferencias_raw: perfil.preferencias,
    });
    // ─────────────────────────────────────────────────────────

    const nombreEl = $('nombreEmpresa');
    if (nombreEl) nombreEl.textContent =
      empresa.nombre || empresa.nombre_comercial || perfil.nombre_negocio || 'Mi Negocio';

    const planEl = $('planBadge');
    if (planEl) planEl.textContent = empresa.plan || perfil.plan || 'Free';

    const avatarEls = $$('.header-avatar, .sidebar-user-avatar');
    const inicial = (perfil.nombre || STATE.user.email || 'U').charAt(0).toUpperCase();
    avatarEls.forEach(el => { el.textContent = inicial; });

    const sidebarName = $('sidebarUserName');
    if (sidebarName) sidebarName.textContent = perfil.nombre || STATE.user.email;

  } catch (e) {
    console.warn('cargarDatosEmpresa:', e.message);
  }
}

// ============================================================
// CARGAR PRODUCTOS
// ============================================================
async function cargarProductos() {
  try {
    mostrarSkeletons();
    const { data, error } = await supabaseClient
      .from('productos')
      .select('*')
      .eq('auth_user_id', STATE.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    STATE.productos = data || [];
    aplicarFiltros();
    actualizarStats();

  } catch (e) {
    console.error('cargarProductos:', e);
    showToast('error', 'Error al cargar', e.message);
    mostrarErrorTabla();
  }
}

// ============================================================
// HELPER: determinar si un producto tiene stock bajo real
// FIX: solo aplica cuando stock_minimo > 0 para evitar
//      falsos positivos cuando ambos valores son 0
// ============================================================
function esStockBajo(p) {
  return (
    p.tipo === 'producto' &&
    p.activo === true &&
    parseFloat(p.stock_minimo ?? 0) > 0 &&
    parseFloat(p.stock_actual  ?? 0) <= parseFloat(p.stock_minimo ?? 0)
  );
}

// ============================================================
// STATS
// FIX: usa helper esStockBajo() para evitar falsos positivos
// ============================================================
function actualizarStats() {
  const todos   = STATE.productos;
  const activos = todos.filter(p => p.activo === true);
  const prods   = activos.filter(p => p.tipo === 'producto');
  const servs   = activos.filter(p => p.tipo === 'servicio');

  // FIX: solo productos de ESTE usuario (ya filtrado por cargarProductos)
  // y solo cuando stock_minimo está configurado > 0
  const stockBajoList = todos.filter(esStockBajo);

  const valorInventario = todos
    .filter(p => p.tipo === 'producto')
    .reduce((acc, p) => acc + (parseFloat(p.stock_actual || 0) * parseFloat(p.costo || 0)), 0);

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };

  set('statProductos',  prods.length);
  set('statServicios',  servs.length);
  set('statInventario', fmtMoney(valorInventario));
  set('statStockBajo',  stockBajoList.length);

  // Badge sidebar — siempre actualizar (mostrar/ocultar)
  const badge = $('badgeStockBajo');
  if (badge) {
    badge.textContent   = stockBajoList.length;
    badge.style.display = stockBajoList.length > 0 ? 'inline-flex' : 'none';
  }

  // Card stat-red — cambiar TODA la apariencia según si hay stock bajo o no
  const cardStockBajo = document.querySelector('.stat-card.stat-red');
  if (cardStockBajo) {
    const iconEl     = cardStockBajo.querySelector('.stat-card-icon');
    const subEl      = cardStockBajo.querySelector('.stat-card-sub');
    const valueEl    = cardStockBajo.querySelector('.stat-card-value');
    const labelEl    = cardStockBajo.querySelector('.stat-card-label');

    if (stockBajoList.length > 0) {
      // HAY stock bajo → apariencia de alerta roja
      cardStockBajo.style.opacity        = '1';
      cardStockBajo.style.setProperty('--stat-accent',   'var(--danger)');
      cardStockBajo.style.setProperty('--stat-icon-bg',  'var(--danger-light)');
      if (labelEl) labelEl.textContent   = 'Stock bajo';
      if (iconEl)  iconEl.textContent    = '⚠️';
      if (subEl)   subEl.textContent     = 'Requieren atención';
      if (valueEl) valueEl.style.color   = 'var(--danger)';
    } else {
      // SIN stock bajo → apariencia neutra/verde
      cardStockBajo.style.opacity        = '1';
      cardStockBajo.style.setProperty('--stat-accent',   'var(--success)');
      cardStockBajo.style.setProperty('--stat-icon-bg',  'var(--success-light)');
      if (labelEl) labelEl.textContent   = 'Inventario OK';
      if (iconEl)  iconEl.textContent    = '✅';
      if (subEl)   subEl.textContent     = 'Todo en orden';
      if (valueEl) valueEl.style.color   = 'var(--success)';
    }
  }
}

// ============================================================
// FILTROS Y BÚSQUEDA
// FIX: caso stock_bajo usa helper esStockBajo()
// ============================================================
function aplicarFiltros() {
  let lista = [...STATE.productos];
  const q   = STATE.busqueda.toLowerCase().trim();

  if (q) {
    lista = lista.filter(p =>
      (p.nombre      || '').toLowerCase().includes(q) ||
      (p.sku         || '').toLowerCase().includes(q) ||
      (p.categoria   || '').toLowerCase().includes(q) ||
      (p.descripcion || '').toLowerCase().includes(q)
    );
  }

  switch (STATE.filtroActivo) {
    case 'productos':  lista = lista.filter(p => p.tipo === 'producto');  break;
    case 'servicios':  lista = lista.filter(p => p.tipo === 'servicio');  break;
    case 'activos':    lista = lista.filter(p => p.activo === true);      break;
    case 'inactivos':  lista = lista.filter(p => p.activo === false);     break;
    // FIX: usa helper para evitar falsos positivos (0 <= 0)
    case 'stock_bajo': lista = lista.filter(esStockBajo);                 break;
    default: break;
  }

  STATE.filtrados = lista;
  renderTabla();

  const pieEl = $('tablePie');
  if (pieEl) pieEl.textContent =
    `${lista.length} registro${lista.length !== 1 ? 's' : ''} encontrado${lista.length !== 1 ? 's' : ''}`;
}

// ============================================================
// RENDER TABLA
// FIX: usa helper esStockBajo() para bandera por fila
// ============================================================
function renderTabla() {
  const tbody = $('productosTbody');
  if (!tbody) return;

  const countEl = $('resultadosCount');
  if (countEl) countEl.textContent =
    `${STATE.filtrados.length} resultado${STATE.filtrados.length !== 1 ? 's' : ''}`;

  if (STATE.filtrados.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h3>${STATE.busqueda ? 'Sin resultados' : 'Sin productos aún'}</h3>
          <p>${STATE.busqueda
            ? `No se encontró "${escHtml(STATE.busqueda)}". Intenta con otro término.`
            : 'Agrega tu primer producto o servicio para comenzar.'}</p>
          ${!STATE.busqueda
            ? `<button class="btn btn-primary" onclick="abrirModalNuevo('producto')">+ Nuevo Producto</button>`
            : ''}
        </div>
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = STATE.filtrados.map(p => {
    // FIX: helper centralizado, evita 0 <= 0 falso positivo
    const stockBajo = esStockBajo(p);

    const stockHtml = p.tipo === 'servicio'
      ? '<span style="color:var(--text-muted);font-size:12px">N/A</span>'
      : `<div class="td-stock">
           <span>${fmtNum(p.stock_actual)}</span>
           ${stockBajo ? '<span class="stock-warn">⚠ Bajo</span>' : ''}
         </div>`;

    // Botón 📉 siempre visible para productos
    const movBtn = p.tipo === 'producto'
      ? `<button class="row-action-btn mov-btn-especial"
            title="Movimiento especial (merma)"
            onclick="abrirMovimiento('${p.id}')"
            style="opacity:1;color:var(--warning);">📉</button>`
      : '<span style="width:30px;display:inline-block"></span>';

    return `
      <tr data-id="${p.id}">
        <td>
          <span class="tipo-badge ${p.tipo === 'producto' ? 'tipo-producto' : 'tipo-servicio'}">
            ${p.tipo === 'producto' ? '📦' : '🔧'} ${p.tipo}
          </span>
        </td>
        <td>
          <div class="td-nombre">${escHtml(p.nombre)}</div>
          ${p.sku ? `<div class="td-sku">${escHtml(p.sku)}</div>` : ''}
        </td>
        <td>${p.categoria ? escHtml(p.categoria) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td class="td-money">${fmtMoney(p.precio)}</td>
        <td class="td-money">${fmtMoney(p.costo)}</td>
        <td>${renderMargen(p.precio, p.costo)}</td>
        <td>${stockHtml}</td>
        <td>
          <span class="status-badge ${p.activo ? 'status-activo' : 'status-inactivo'}">
            ${p.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:4px;">
            <div class="row-actions" style="opacity:0;transition:opacity 0.18s ease;">
              <button class="row-action-btn view" title="Ver detalle"   onclick="abrirDetalle('${p.id}')">👁</button>
              <button class="row-action-btn edit" title="Editar"        onclick="abrirEditar('${p.id}')">✏️</button>
              <button class="row-action-btn dup"  title="Duplicar"      onclick="duplicarProducto('${p.id}')">📋</button>
            </div>
            ${movBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Hover para row-actions (el movBtn queda siempre visible separado)
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    const actions = row.querySelector('.row-actions');
    if (!actions) return;
    row.addEventListener('mouseenter', () => actions.style.opacity = '1');
    row.addEventListener('mouseleave', () => actions.style.opacity = '0');
  });
}

// ============================================================
// SKELETONS
// ============================================================
function mostrarSkeletons() {
  const tbody = $('productosTbody');
  if (!tbody) return;
  tbody.innerHTML = Array(6).fill('').map(() => `
    <tr class="skeleton-row">
      <td><div class="skeleton skel-badge"></div></td>
      <td><div class="skeleton skel-line" style="width:140px"></div></td>
      <td><div class="skeleton skel-line" style="width:80px"></div></td>
      <td><div class="skeleton skel-line" style="width:70px"></div></td>
      <td><div class="skeleton skel-line" style="width:70px"></div></td>
      <td><div class="skeleton skel-line" style="width:50px"></div></td>
      <td><div class="skeleton skel-line" style="width:50px"></div></td>
      <td><div class="skeleton skel-badge"></div></td>
      <td></td>
    </tr>
  `).join('');
}

function mostrarErrorTabla() {
  const tbody = $('productosTbody');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr><td colspan="9">
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <h3>Error al cargar datos</h3>
        <p>No se pudieron obtener los productos. Verifica tu conexión.</p>
        <button class="btn btn-secondary" onclick="cargarProductos()">🔄 Reintentar</button>
      </div>
    </td></tr>
  `;
}

// ============================================================
// MODAL NUEVO / EDITAR
// ============================================================
function abrirModalNuevo(tipo = 'producto') {
  STATE.modalMode  = 'crear';
  STATE.editTarget = null;

  resetFormulario();
  setTipoModal(tipo, true);
  configurarCamposSegunModo('crear');

  $('modalProductoTitle').textContent = tipo === 'producto' ? '+ Nuevo Producto' : '+ Nuevo Servicio';
  $('btnGuardarProducto').textContent = 'Crear';
  $('modalProducto').classList.add('open');

  setTimeout(() => $('inputNombre')?.focus(), 100);
}

function abrirEditar(id) {
  const p = STATE.productos.find(x => x.id === id);
  if (!p) return;

  STATE.modalMode  = 'editar';
  STATE.editTarget = p;

  resetFormulario();
  cargarFormulario(p);
  setTipoModal(p.tipo, false);
  configurarCamposSegunModo('editar');

  $('modalProductoTitle').textContent = `Editar: ${p.nombre}`;
  $('btnGuardarProducto').textContent = 'Guardar cambios';
  $('modalProducto').classList.add('open');
}

function cerrarModalProducto() {
  $('modalProducto').classList.remove('open');
  STATE.editTarget = null;
  STATE.modalMode  = null;
}

// En modo editar → ocultar stockSection completo, mostrar aviso con solo stock_minimo
function configurarCamposSegunModo(modo) {
  const esEdicion  = modo === 'editar';
  const stockWrap  = $('stockSection');
  const avisoStock = $('avisoStockBloqueado');

  if (esEdicion) {
    if (stockWrap)  stockWrap.style.display  = 'none';
    if (avisoStock) {
      avisoStock.classList.add('visible');
      avisoStock.style.display = 'flex';
    }
  } else {
    if (stockWrap)  stockWrap.style.display  = '';
    if (avisoStock) {
      avisoStock.classList.remove('visible');
      avisoStock.style.display = 'none';
    }
  }
}

function setTipoModal(tipo, habilitarToggle = true) {
  const btnProd      = $('toggleProducto');
  const btnServ      = $('toggleServicio');
  const inputTipo    = $('inputTipo');
  const stockSection = $('stockSection');

  if (inputTipo)    inputTipo.value = tipo;
  if (btnProd)      btnProd.classList.toggle('active', tipo === 'producto');
  if (btnServ)      btnServ.classList.toggle('active', tipo === 'servicio');

  // Solo mostrar stock si es producto Y estamos en modo creación/duplicación
  if (stockSection) {
    const mostrar = tipo === 'producto' && STATE.modalMode !== 'editar';
    stockSection.style.display = mostrar ? '' : 'none';
  }

  if (btnProd) btnProd.disabled = !habilitarToggle;
  if (btnServ) btnServ.disabled = !habilitarToggle;
}

function resetFormulario() {
  const form = $('formProducto');
  if (form) form.reset();
  $$('.form-error').forEach(el => el.textContent = '');
  const wrap = $('margenPreviewWrap');
  if (wrap) wrap.style.display = 'none';
  const avisoStock = $('avisoStockBloqueado');
  if (avisoStock) {
    avisoStock.classList.remove('visible');
    avisoStock.style.display = 'none';
  }
}

function cargarFormulario(p) {
  const campos = [
    ['inputNombre',          p.nombre        || ''],
    ['inputDescripcion',     p.descripcion   || ''],
    ['inputCategoria',       p.categoria     || ''],
    ['inputSku',             p.sku           || ''],
    ['inputCodBarras',       p.codigo_barras || ''],
    ['inputCosto',           p.costo         ?? ''],
    ['inputPrecio',          p.precio        ?? ''],
    ['inputStockMinimo',     p.stock_minimo  ?? ''],
    ['inputStockMinimoEdit', p.stock_minimo  ?? ''],
    ['inputActivo',          p.activo ? 'true' : 'false'],
  ];
  // NUNCA cargar stock_actual en edición — solo en creación
  campos.forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
  });
}

// ============================================================
// GUARDAR PRODUCTO
// ============================================================
async function guardarProducto() {
  const btn   = $('btnGuardarProducto');
  const errEl = $('errNombre');
  if (errEl) errEl.textContent = '';

  const tipo        = $('inputTipo')?.value || 'producto';
  const nombre      = ($('inputNombre')?.value || '').trim();
  const descripcion = ($('inputDescripcion')?.value || '').trim();
  const categoria   = ($('inputCategoria')?.value || '').trim();
  const sku         = ($('inputSku')?.value || '').trim();
  const codBarras   = ($('inputCodBarras')?.value || '').trim();
  const costoRaw    = $('inputCosto')?.value;
  const precioRaw   = $('inputPrecio')?.value;
  const costo       = costoRaw  !== '' ? parseFloat(costoRaw)  : 0;
  const precio      = precioRaw !== '' ? parseFloat(precioRaw) : 0;
  const activoVal   = $('inputActivo')?.value;
  const activo      = activoVal === 'true';

  // Stock mínimo: usar el campo visible según el modo
  const stockMinimoEl  = STATE.modalMode === 'editar' ? $('inputStockMinimoEdit') : $('inputStockMinimo');
  const stockMinimoRaw = stockMinimoEl?.value;
  const stockMinimo    = stockMinimoRaw !== '' && stockMinimoRaw !== undefined
    ? parseFloat(stockMinimoRaw)
    : 0;

  if (!nombre) {
    if (errEl) errEl.textContent = 'El nombre es obligatorio';
    $('inputNombre')?.focus();
    return;
  }
  if (!btn) return;

  const textoOriginal = btn.textContent;
  btn.classList.add('btn-loading');
  btn.disabled = true;

  try {
    let error = null;

    if (STATE.modalMode === 'crear' || STATE.modalMode === 'duplicar') {
      const stockActualRaw = $('inputStockActual')?.value;
      const stockActual    = stockActualRaw !== '' && stockActualRaw !== undefined
        ? parseFloat(stockActualRaw)
        : 0;

      const payload = {
        auth_user_id:  STATE.user.id,
        tipo,
        nombre,
        descripcion:   descripcion || null,
        categoria:     categoria   || null,
        sku:           sku         || null,
        codigo_barras: codBarras   || null,
        costo:         isNaN(costo)       ? 0 : costo,
        precio:        isNaN(precio)      ? 0 : precio,
        stock_actual:  tipo === 'producto' ? (isNaN(stockActual) ? 0 : stockActual) : 0,
        stock_minimo:  tipo === 'producto' ? (isNaN(stockMinimo) ? 0 : stockMinimo) : 0,
        activo,
      };
      const res = await supabaseClient.from('productos').insert([payload]);
      error = res.error;

    } else if (STATE.modalMode === 'editar' && STATE.editTarget) {
      // En edición: NUNCA actualizar stock_actual — solo desde movimientos especiales
      const updatePayload = {
        tipo,
        nombre,
        descripcion:   descripcion || null,
        categoria:     categoria   || null,
        sku:           sku         || null,
        codigo_barras: codBarras   || null,
        costo:         isNaN(costo)  ? 0 : costo,
        precio:        isNaN(precio) ? 0 : precio,
        stock_minimo:  tipo === 'producto' ? (isNaN(stockMinimo) ? 0 : stockMinimo) : null,
        activo,
      };
      const res = await supabaseClient
        .from('productos')
        .update(updatePayload)
        .eq('id', STATE.editTarget.id)
        .eq('auth_user_id', STATE.user.id);
      error = res.error;
    }

    if (error) throw error;

    cerrarModalProducto();
    showToast(
      'success',
      STATE.modalMode === 'editar' ? 'Producto actualizado' : 'Producto creado',
      nombre
    );
    await cargarProductos();

  } catch (e) {
    console.error('guardarProducto:', e);
    showToast('error', 'Error al guardar', e.message || 'Verifica los datos e intenta de nuevo.');
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ============================================================
// VER DETALLE
// FIX: usa helper esStockBajo()
// ============================================================
function abrirDetalle(id) {
  const p = STATE.productos.find(x => x.id === id);
  if (!p) return;

  const m = calcMargen(p.precio, p.costo);
  const margenHtml = m !== null
    ? `<span class="td-margin ${m >= 40 ? 'margin-good' : m >= 20 ? 'margin-mid' : 'margin-low'}">${m.toFixed(2)}%</span>`
    : '—';

  // FIX: usar helper centralizado
  const stockBajo = esStockBajo(p);

  $('detalleContent').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item full">
        <div class="detail-label">Nombre</div>
        <div class="detail-value" style="font-size:18px;font-weight:700">${escHtml(p.nombre)}</div>
      </div>
      ${p.descripcion ? `
      <div class="detail-item full">
        <div class="detail-label">Descripción</div>
        <div class="detail-value">${escHtml(p.descripcion)}</div>
      </div>` : ''}
      <div class="detail-divider"></div>
      <div class="detail-item">
        <div class="detail-label">Tipo</div>
        <div class="detail-value">
          <span class="tipo-badge ${p.tipo === 'producto' ? 'tipo-producto' : 'tipo-servicio'}">
            ${p.tipo === 'producto' ? '📦' : '🔧'} ${p.tipo}
          </span>
        </div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Categoría</div>
        <div class="detail-value">${p.categoria ? escHtml(p.categoria) : '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">SKU</div>
        <div class="detail-value" style="font-family:var(--font-mono)">${p.sku || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Código de Barras</div>
        <div class="detail-value" style="font-family:var(--font-mono)">${p.codigo_barras || '—'}</div>
      </div>
      <div class="detail-divider"></div>
      <div class="detail-item">
        <div class="detail-label">Costo</div>
        <div class="detail-value detail-money" style="color:var(--text-secondary)">${fmtMoney(p.costo)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Precio de Venta</div>
        <div class="detail-value detail-money" style="color:var(--accent)">${fmtMoney(p.precio)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Margen</div>
        <div class="detail-value">${margenHtml}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Estado</div>
        <div class="detail-value">
          <span class="status-badge ${p.activo ? 'status-activo' : 'status-inactivo'}">
            ${p.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </div>
      ${p.tipo === 'producto' ? `
      <div class="detail-divider"></div>
      <div class="detail-item">
        <div class="detail-label">Stock Actual</div>
        <div class="detail-value" style="font-size:18px;font-weight:700">
          ${fmtNum(p.stock_actual)}
          ${stockBajo ? '<span class="stock-warn" style="font-size:12px">⚠ Stock bajo</span>' : ''}
        </div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Stock Mínimo</div>
        <div class="detail-value">${fmtNum(p.stock_minimo)}</div>
      </div>` : ''}
      <div class="detail-divider"></div>
      <div class="detail-item">
        <div class="detail-label">Creado</div>
        <div class="detail-value" style="font-size:12px">${fmtFecha(p.created_at)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Última actualización</div>
        <div class="detail-value" style="font-size:12px">${fmtFecha(p.updated_at)}</div>
      </div>
    </div>
  `;

  $('btnEditarDesdeDetalle').onclick = () => {
    cerrarDetalle();
    abrirEditar(id);
  };

  $('modalDetalle').classList.add('open');
}

function cerrarDetalle() {
  $('modalDetalle').classList.remove('open');
}

// ============================================================
// DUPLICAR
// ============================================================
async function duplicarProducto(id) {
  const p = STATE.productos.find(x => x.id === id);
  if (!p) return;

  STATE.modalMode  = 'duplicar';
  STATE.editTarget = null;

  resetFormulario();
  cargarFormulario({ ...p, nombre: p.nombre + ' — Copia' });

  const stockField = $('inputStockActual');
  if (stockField) { stockField.disabled = false; stockField.value = p.stock_actual ?? 0; }

  setTipoModal(p.tipo, false);
  configurarCamposSegunModo('crear'); // duplicar actúa como crear

  $('modalProductoTitle').textContent = `Duplicar: ${p.nombre}`;
  $('btnGuardarProducto').textContent = 'Crear copia';
  $('modalProducto').classList.add('open');
}

// ============================================================
// MOVIMIENTOS ESPECIALES — Modal completo
// ============================================================
const RAZONES_MERMA = [
  { id: 'robo',           label: 'Robo',           icon: '🔓' },
  { id: 'dano',           label: 'Daño',           icon: '💥' },
  { id: 'vencimiento',    label: 'Vencimiento',    icon: '🗓️' },
  { id: 'uso_interno',    label: 'Uso interno',    icon: '🏭' },
  { id: 'conteo_fisico',  label: 'Conteo físico',  icon: '🔢' },
  { id: 'error_anterior', label: 'Error anterior', icon: '↩️' },
];

function abrirMovimiento(id) {
  const p = STATE.productos.find(x => x.id === id);
  if (!p) return;
  STATE.movTarget = p;

  const nombreEl = $('movProductoNombre');
  if (nombreEl) nombreEl.textContent = p.nombre;

  const stockEl = $('movStockActual');
  if (stockEl) stockEl.textContent = `Stock actual: ${fmtNum(p.stock_actual)}`;

  const cantEl = $('movCantidad');
  const notaEl = $('movNota');
  const cajaCh = $('movDescontarCaja');
  if (cantEl) cantEl.value = '';
  if (notaEl) notaEl.value = '';
  if (cajaCh) cajaCh.checked = false;

  $$('.razon-card').forEach(c => c.classList.remove('selected'));
  $('movRazonSeleccionada').value = '';

  const errEl = $('movError');
  if (errEl) errEl.textContent = '';

  const prevEl = $('movCajaPreview');
  if (prevEl) prevEl.textContent = '';

  actualizarAvisoCaja();

  $('modalMovimiento').classList.add('open');
}

function cerrarMovimiento() {
  $('modalMovimiento').classList.remove('open');
  STATE.movTarget = null;
}

function seleccionarRazon(el, razonId) {
  $$('.razon-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  $('movRazonSeleccionada').value = razonId;

  const errEl = $('movError');
  if (errEl) errEl.textContent = '';

  actualizarAvisoCaja();
}

function actualizarAvisoCaja() {
  const razon    = $('movRazonSeleccionada')?.value;
  const cajaRow  = $('movCajaRow');
  const cajaInfo = $('movCajaRowInfo');
  if (!cajaRow) return;

  const requiereCaja = ['robo', 'dano', 'vencimiento', 'uso_interno'];
  const esSoloAjuste = ['conteo_fisico', 'error_anterior'];

  cajaRow.style.display  = requiereCaja.includes(razon) ? '' : 'none';
  if (cajaInfo) cajaInfo.style.display = esSoloAjuste.includes(razon) ? '' : 'none';

  const cajaCh = $('movDescontarCaja');
  if (cajaCh && !requiereCaja.includes(razon)) cajaCh.checked = false;
}

async function confirmarMovimiento() {
  const p = STATE.movTarget;
  if (!p) return;

  const razon   = $('movRazonSeleccionada')?.value;
  const cantRaw = $('movCantidad')?.value;
  const nota    = ($('movNota')?.value || '').trim();
  const desCaja = $('movDescontarCaja')?.checked ?? false;
  const errEl   = $('movError');

  if (!razon) {
    if (errEl) errEl.textContent = 'Selecciona la razón del movimiento.';
    return;
  }

  const cantidad = parseFloat(cantRaw);
  if (!cantRaw || isNaN(cantidad) || cantidad <= 0) {
    if (errEl) errEl.textContent = 'Ingresa una cantidad válida mayor a 0.';
    $('movCantidad')?.focus();
    return;
  }

  const stockActual = parseFloat(p.stock_actual ?? 0);
  if (cantidad > stockActual) {
    if (errEl) errEl.textContent =
      `No puedes descontar ${fmtNum(cantidad)} — stock disponible: ${fmtNum(stockActual)}.`;
    return;
  }

  const btn = $('btnConfirmarMovimiento');
  const textoOriginal = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.classList.add('btn-loading'); }

  try {
    const nuevoStock = stockActual - cantidad;

    const { error: stockErr } = await supabaseClient
      .from('productos')
      .update({ stock_actual: nuevoStock })
      .eq('id', p.id)
      .eq('auth_user_id', STATE.user.id);

    if (stockErr) throw stockErr;

    // Registrar en tabla de movimientos (si existe)
    try {
      await supabaseClient.from('movimientos_inventario').insert([{
        auth_user_id:   STATE.user.id,
        producto_id:    p.id,
        tipo:           'merma',
        razon,
        cantidad:       -cantidad,
        stock_antes:    stockActual,
        stock_despues:  nuevoStock,
        nota:           nota || null,
        descuenta_caja: desCaja,
        costo_unitario: desCaja ? parseFloat(p.costo || 0) : null,
        costo_total:    desCaja ? (parseFloat(p.costo || 0) * cantidad) : null,
      }]);
    } catch (_) {
      console.warn('Tabla movimientos_inventario no disponible aún');
    }

    // Descontar de caja si aplica
    if (desCaja && p.costo) {
      const costoTotal  = parseFloat(p.costo) * cantidad;
      const razonLabel  = RAZONES_MERMA.find(r => r.id === razon)?.label || razon;
      try {
        await supabaseClient.from('gastos').insert([{
          auth_user_id: STATE.user.id,
          descripcion:  `Merma de inventario — ${razonLabel}: ${p.nombre} (${fmtNum(cantidad)} u.)`,
          monto:        costoTotal,
          categoria:    'Merma de inventario',
          tipo:         'merma',
          notas:        nota || null,
          fecha:        new Date().toISOString().split('T')[0],
        }]);
      } catch (_) {
        console.warn('No se pudo registrar en gastos');
      }
    }

    cerrarMovimiento();

    const razonLabel = RAZONES_MERMA.find(r => r.id === razon)?.label || razon;
    const cajaMsg    = desCaja ? ` · ${fmtMoney((p.costo || 0) * cantidad)} descontados de caja` : '';
    showToast('warning', 'Movimiento registrado',
      `${razonLabel}: −${fmtNum(cantidad)} u. de ${p.nombre}${cajaMsg}`);

    await cargarProductos();

  } catch (e) {
    console.error('confirmarMovimiento:', e);
    if (errEl) errEl.textContent = 'Error al guardar: ' + (e.message || 'inténtalo de nuevo');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      btn.textContent = textoOriginal;
    }
  }
}

// ============================================================
// NOTIFICACIONES
// FIX: usa helper esStockBajo()
// ============================================================
function initNotificaciones() {
  const btnNotif = document.querySelector('.header-icon-btn[title="Notificaciones"]');
  if (!btnNotif) return;
  btnNotif.addEventListener('click', () => {
    const stockBajo = STATE.productos.filter(esStockBajo);
    if (stockBajo.length > 0) {
      showToast('warning',
        `${stockBajo.length} producto${stockBajo.length !== 1 ? 's' : ''} con stock bajo`,
        stockBajo.slice(0, 3).map(p => `• ${p.nombre}`).join('<br>'));
    } else {
      showToast('info', 'Sin notificaciones', 'Todo tu inventario está en orden.');
    }
  });
}

// ============================================================
// ESCAPE HTML
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// EVENTOS
// ============================================================
function initEventos() {
  const searchInput = $('searchInput');
  const searchClear = $('searchClear');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      STATE.busqueda = e.target.value;
      if (searchClear) searchClear.classList.toggle('visible', STATE.busqueda.length > 0);
      aplicarFiltros();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      STATE.busqueda = '';
      searchClear.classList.remove('visible');
      aplicarFiltros();
    });
  }

  const filtersGroup = document.querySelector('.filters-group');
  if (filtersGroup) {
    filtersGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.filtroActivo = btn.dataset.filtro;
      aplicarFiltros();
    });
  }

  const btnProd = $('toggleProducto');
  const btnServ = $('toggleServicio');
  if (btnProd) btnProd.addEventListener('click', () => setTipoModal('producto', true));
  if (btnServ) btnServ.addEventListener('click', () => setTipoModal('servicio', true));

  const btnGuardar = $('btnGuardarProducto');
  if (btnGuardar) btnGuardar.addEventListener('click', guardarProducto);

  const formProducto = $('formProducto');
  if (formProducto) {
    formProducto.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        guardarProducto();
      }
    });
  }

  // Movimiento: cantidad cambia → actualizar preview de caja
  const movCantidad = $('movCantidad');
  if (movCantidad) {
    movCantidad.addEventListener('input', () => {
      const p      = STATE.movTarget;
      const cant   = parseFloat(movCantidad.value) || 0;
      const prevEl = $('movCajaPreview');
      if (prevEl && p && p.costo && cant > 0) {
        prevEl.textContent = `Se registrará ${fmtMoney(parseFloat(p.costo) * cant)} como gasto de merma`;
      } else if (prevEl) {
        prevEl.textContent = '';
      }
    });
  }

  const cajaCh = $('movDescontarCaja');
  if (cajaCh) {
    cajaCh.addEventListener('change', () => {
      const prevEl = $('movCajaPreview');
      const p      = STATE.movTarget;
      const cant   = parseFloat($('movCantidad')?.value) || 0;
      if (prevEl) {
        prevEl.textContent = (cajaCh.checked && p && p.costo && cant > 0)
          ? `Se registrará ${fmtMoney(parseFloat(p.costo) * cant)} como gasto de merma`
          : '';
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cerrarModalProducto();
      cerrarDetalle();
      cerrarMovimiento();
    }
  });

  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        STATE.editTarget = null;
        STATE.modalMode  = null;
        STATE.movTarget  = null;
      }
    });
  });

  const inputNombre = $('inputNombre');
  if (inputNombre) {
    inputNombre.addEventListener('input', () => {
      const errEl = $('errNombre');
      if (errEl) errEl.textContent = '';
    });
  }
}

// ============================================================
// FECHA EN HEADER
// ============================================================
function actualizarFecha() {
  const el = $('fechaActual');
  if (el) el.textContent = fechaActual();
}

// ============================================================
// INIT PRINCIPAL
// ============================================================
async function init() {
  initSupabase();
  initTema();
  initSidebar();
  actualizarFecha();
  initEventos();

  const autenticado = await checkAuth();
  if (!autenticado) return;

  await Promise.all([
    cargarDatosEmpresa(),
    cargarProductos(),
  ]);

  initNotificaciones();
}

document.addEventListener('DOMContentLoaded', init);
