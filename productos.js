/* ============================================================
   PRODUCTOS.JS — Módulo Productos/Servicios
   Supabase Auth + RLS + Vanilla JS
   ============================================================ */

'use strict';

// ============================================================
// CONFIG SUPABASE
// ============================================================
const SUPABASE_URL     = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

let supabaseClient = null;

function initSupabase() {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

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
};

// ============================================================
// DOM HELPERS
// ============================================================
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ============================================================
// FORMATO MONEDA
// ============================================================
function fmtMoney(val) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  return ((p - c) / p) * 100;
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
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return false;
  }
  STATE.user = session.user;
  return true;
}

// ============================================================
// CARGAR DATOS EMPRESA Y USUARIO
// ============================================================
async function cargarDatosEmpresa() {
  try {
    const [{ data: perfil }, { data: empresa }] = await Promise.all([
      supabaseClient.from('usuarios').select('*').eq('auth_user_id', STATE.user.id).maybeSingle(),
      supabaseClient.from('configuracion_empresa').select('*').eq('auth_user_id', STATE.user.id).maybeSingle()
    ]);

    STATE.perfil  = perfil  || {};
    STATE.empresa = empresa || {};

    // Header: nombre empresa
    const nombreEl = $('nombreEmpresa');
    if (nombreEl) {
      nombreEl.textContent = STATE.empresa.nombre || STATE.perfil.nombre_negocio || 'Mi Negocio';
    }

    // Plan badge
    const planEl = $('planBadge');
    if (planEl) {
      planEl.textContent = STATE.empresa.plan || STATE.perfil.plan || 'Free';
    }

    // Avatar
    const avatarEls = $$('.header-avatar, .sidebar-user-avatar');
    const inicial = (STATE.perfil.nombre || STATE.user.email || 'U').charAt(0).toUpperCase();
    avatarEls.forEach(el => { el.textContent = inicial; });

    // Nombre sidebar
    const sidebarName = $('sidebarUserName');
    if (sidebarName) sidebarName.textContent = STATE.perfil.nombre || STATE.user.email;

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
// STATS
// ============================================================
function actualizarStats() {
  const todos    = STATE.productos;
  const activos  = todos.filter(p => p.activo);
  const prods    = activos.filter(p => p.tipo === 'producto');
  const servs    = activos.filter(p => p.tipo === 'servicio');
  const stockBajo = todos.filter(p => p.tipo === 'producto' && parseFloat(p.stock_actual) <= parseFloat(p.stock_minimo));

  const valorInventario = todos
    .filter(p => p.tipo === 'producto')
    .reduce((acc, p) => acc + (parseFloat(p.stock_actual || 0) * parseFloat(p.costo || 0)), 0);

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };

  set('statProductos',   prods.length);
  set('statServicios',   servs.length);
  set('statInventario',  fmtMoney(valorInventario));
  set('statStockBajo',   stockBajo.length);

  // Badge alerta stock bajo en sidebar
  const badge = $('badgeStockBajo');
  if (badge) {
    badge.textContent = stockBajo.length;
    badge.style.display = stockBajo.length > 0 ? 'inline-flex' : 'none';
  }
}

// ============================================================
// FILTROS Y BÚSQUEDA
// ============================================================
function aplicarFiltros() {
  let lista = [...STATE.productos];
  const q = STATE.busqueda.toLowerCase().trim();

  // Filtro de texto
  if (q) {
    lista = lista.filter(p =>
      (p.nombre        || '').toLowerCase().includes(q) ||
      (p.sku           || '').toLowerCase().includes(q) ||
      (p.categoria     || '').toLowerCase().includes(q) ||
      (p.descripcion   || '').toLowerCase().includes(q)
    );
  }

  // Filtro por tipo/estado
  switch (STATE.filtroActivo) {
    case 'productos':
      lista = lista.filter(p => p.tipo === 'producto'); break;
    case 'servicios':
      lista = lista.filter(p => p.tipo === 'servicio'); break;
    case 'activos':
      lista = lista.filter(p => p.activo); break;
    case 'inactivos':
      lista = lista.filter(p => !p.activo); break;
    case 'stock_bajo':
      lista = lista.filter(p =>
        p.tipo === 'producto' &&
        parseFloat(p.stock_actual) <= parseFloat(p.stock_minimo)
      );
      break;
    default: break;
  }

  STATE.filtrados = lista;
  renderTabla();
}

// ============================================================
// RENDER TABLA
// ============================================================
function renderTabla() {
  const tbody = $('productosTbody');
  if (!tbody) return;

  const countEl = $('resultadosCount');
  if (countEl) countEl.textContent = `${STATE.filtrados.length} resultado${STATE.filtrados.length !== 1 ? 's' : ''}`;

  if (STATE.filtrados.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h3>${STATE.busqueda ? 'Sin resultados' : 'Sin productos aún'}</h3>
          <p>${STATE.busqueda
            ? `No se encontró "${STATE.busqueda}". Intenta con otro término.`
            : 'Agrega tu primer producto o servicio para comenzar.'}</p>
          ${!STATE.busqueda ? `<button class="btn btn-primary" onclick="abrirModalNuevo('producto')">+ Nuevo Producto</button>` : ''}
        </div>
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = STATE.filtrados.map(p => {
    const stockBajo = p.tipo === 'producto' && parseFloat(p.stock_actual) <= parseFloat(p.stock_minimo);
    const stockHtml = p.tipo === 'servicio'
      ? '<span style="color:var(--text-muted);font-size:12px">N/A</span>'
      : `<div class="td-stock">
           <span>${fmtNum(p.stock_actual)}</span>
           ${stockBajo ? '<span class="stock-warn">⚠ Bajo</span>' : ''}
         </div>`;

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
          <div class="row-actions">
            <button class="row-action-btn view" title="Ver detalle" onclick="abrirDetalle('${p.id}')">👁</button>
            <button class="row-action-btn edit" title="Editar" onclick="abrirEditar('${p.id}')">✏️</button>
            <button class="row-action-btn dup"  title="Duplicar" onclick="duplicarProducto('${p.id}')">📋</button>
            <button class="row-action-btn del"  title="Eliminar" onclick="confirmarEliminar('${p.id}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
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

  // Stats skeleton
  $$('.stat-card-value[data-loading]').forEach(el => {
    el.innerHTML = '<div class="skeleton" style="width:60px;height:30px;border-radius:6px"></div>';
  });
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
  setTipoModal(tipo);

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

  $('modalProductoTitle').textContent = `Editar: ${p.nombre}`;
  $('btnGuardarProducto').textContent = 'Guardar cambios';
  $('modalProducto').classList.add('open');
}

function cerrarModalProducto() {
  $('modalProducto').classList.remove('open');
  STATE.editTarget = null;
  STATE.modalMode  = null;
}

function setTipoModal(tipo, habilitarToggle = true) {
  const btnProd = $('toggleProducto');
  const btnServ = $('toggleServicio');
  const inputTipo = $('inputTipo');
  const stockSection = $('stockSection');

  if (inputTipo) inputTipo.value = tipo;

  if (btnProd) btnProd.classList.toggle('active', tipo === 'producto');
  if (btnServ) btnServ.classList.toggle('active', tipo === 'servicio');

  if (stockSection) {
    stockSection.style.display = tipo === 'producto' ? '' : 'none';
  }

  if (!habilitarToggle) {
    if (btnProd) btnProd.disabled = true;
    if (btnServ) btnServ.disabled = true;
  } else {
    if (btnProd) btnProd.disabled = false;
    if (btnServ) btnServ.disabled = false;
  }
}

function resetFormulario() {
  const form = $('formProducto');
  if (form) form.reset();
  // Limpiar errores
  $$('.form-error').forEach(el => el.textContent = '');
}

function cargarFormulario(p) {
  const campos = [
    ['inputNombre',       p.nombre        || ''],
    ['inputDescripcion',  p.descripcion   || ''],
    ['inputCategoria',    p.categoria     || ''],
    ['inputSku',          p.sku           || ''],
    ['inputCodBarras',    p.codigo_barras || ''],
    ['inputCosto',        p.costo         ?? ''],
    ['inputPrecio',       p.precio        ?? ''],
    ['inputStockActual',  p.stock_actual  ?? ''],
    ['inputStockMinimo',  p.stock_minimo  ?? ''],
    ['inputActivo',       p.activo ? 'true' : 'false'],
  ];

  campos.forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
  });
}

// ============================================================
// GUARDAR PRODUCTO
// ============================================================
async function guardarProducto() {
  const btn = $('btnGuardarProducto');

  // Recolectar valores
  const tipo        = $('inputTipo')?.value || 'producto';
  const nombre      = ($('inputNombre')?.value || '').trim();
  const descripcion = ($('inputDescripcion')?.value || '').trim();
  const categoria   = ($('inputCategoria')?.value || '').trim();
  const sku         = ($('inputSku')?.value || '').trim();
  const codBarras   = ($('inputCodBarras')?.value || '').trim();
  const costo       = parseFloat($('inputCosto')?.value) || 0;
  const precio      = parseFloat($('inputPrecio')?.value) || 0;
  const stockActual = tipo === 'producto' ? (parseFloat($('inputStockActual')?.value) || 0) : 0;
  const stockMinimo = tipo === 'producto' ? (parseFloat($('inputStockMinimo')?.value) || 0) : 0;
  const activoStr   = $('inputActivo')?.value;
  const activo      = activoStr === 'true' || activoStr === true;

  // Validación
  if (!nombre) {
    const errEl = $('errNombre');
    if (errEl) errEl.textContent = 'El nombre es obligatorio';
    $('inputNombre')?.focus();
    return;
  }

  if (!btn) return;
  btn.classList.add('btn-loading');
  btn.disabled = true;

  const payload = {
    auth_user_id:  STATE.user.id,
    tipo,
    nombre,
    descripcion:   descripcion || null,
    categoria:     categoria   || null,
    sku:           sku         || null,
    codigo_barras: codBarras   || null,
    costo,
    precio,
    stock_actual:  tipo === 'producto' ? stockActual : 0,
    stock_minimo:  tipo === 'producto' ? stockMinimo : 0,
    activo,
  };

  try {
    let error;

    if (STATE.modalMode === 'crear' || STATE.modalMode === 'duplicar') {
      ({ error } = await supabaseClient.from('productos').insert([payload]));
    } else if (STATE.modalMode === 'editar' && STATE.editTarget) {
      delete payload.auth_user_id; // no modificar owner
      const { error: e } = await supabaseClient
        .from('productos')
        .update(payload)
        .eq('id', STATE.editTarget.id)
        .eq('auth_user_id', STATE.user.id);
      error = e;
    }

    if (error) throw error;

    cerrarModalProducto();
    showToast('success',
      STATE.modalMode === 'editar' ? 'Producto actualizado' : 'Producto creado',
      nombre
    );
    await cargarProductos();

  } catch (e) {
    console.error('guardarProducto:', e);
    showToast('error', 'Error al guardar', e.message);
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

// ============================================================
// VER DETALLE
// ============================================================
function abrirDetalle(id) {
  const p = STATE.productos.find(x => x.id === id);
  if (!p) return;

  const m = calcMargen(p.precio, p.costo);
  const margenHtml = m !== null
    ? `<span class="td-margin ${m >= 40 ? 'margin-good' : m >= 20 ? 'margin-mid' : 'margin-low'}">${m.toFixed(2)}%</span>`
    : '—';

  const stockBajo = p.tipo === 'producto' && parseFloat(p.stock_actual) <= parseFloat(p.stock_minimo);

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

  STATE.modalMode = 'duplicar';

  resetFormulario();
  cargarFormulario({ ...p, nombre: p.nombre + ' — Copia' });
  setTipoModal(p.tipo, false);

  $('modalProductoTitle').textContent = `Duplicar: ${p.nombre}`;
  $('btnGuardarProducto').textContent = 'Crear copia';
  $('modalProducto').classList.add('open');
}

// ============================================================
// ELIMINAR
// ============================================================
function confirmarEliminar(id) {
  const p = STATE.productos.find(x => x.id === id);
  if (!p) return;

  $('confirmNombre').textContent = p.nombre;
  $('btnConfirmarEliminar').onclick = () => eliminarProducto(id);
  $('modalConfirmar').classList.add('open');
}

function cerrarConfirmar() {
  $('modalConfirmar').classList.remove('open');
}

async function eliminarProducto(id) {
  const btn = $('btnConfirmarEliminar');
  if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }

  try {
    const { error } = await supabaseClient
      .from('productos')
      .delete()
      .eq('id', id)
      .eq('auth_user_id', STATE.user.id);

    if (error) throw error;

    cerrarConfirmar();
    showToast('success', 'Eliminado', 'El producto fue eliminado correctamente.');
    await cargarProductos();

  } catch (e) {
    showToast('error', 'Error al eliminar', e.message);
  } finally {
    if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
  }
}

// ============================================================
// CERRAR SESIÓN
// ============================================================
async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
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
  // Tema
  const btnTema = $('btnTema');
  if (btnTema) btnTema.addEventListener('click', toggleTema);

  // Búsqueda instantánea
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

  // Filtros
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.filtroActivo = btn.dataset.filtro;
      aplicarFiltros();
    });
  });

  // Toggle tipo en modal
  const btnProd = $('toggleProducto');
  const btnServ = $('toggleServicio');
  if (btnProd) btnProd.addEventListener('click', () => setTipoModal('producto'));
  if (btnServ) btnServ.addEventListener('click', () => setTipoModal('servicio'));

  // Guardar producto
  const btnGuardar = $('btnGuardarProducto');
  if (btnGuardar) btnGuardar.addEventListener('click', guardarProducto);

  // Submit con Enter en modal
  const formProducto = $('formProducto');
  if (formProducto) {
    formProducto.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        guardarProducto();
      }
    });
  }

  // Cerrar modales con Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cerrarModalProducto();
      cerrarDetalle();
      cerrarConfirmar();
    }
  });

  // Cerrar modales al click en overlay
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        STATE.editTarget = null;
        STATE.modalMode  = null;
      }
    });
  });

  // Validación en tiempo real: limpiar error al escribir
  const inputNombre = $('inputNombre');
  if (inputNombre) {
    inputNombre.addEventListener('input', () => {
      const errEl = $('errNombre');
      if (errEl) errEl.textContent = '';
    });
  }

  // Logout
  const btnLogout = $('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', cerrarSesion);
}

// ============================================================
// ACTUALIZAR FECHA EN HEADER
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

  const autenticado = await checkAuth();
  if (!autenticado) return;

  // Cargar datos en paralelo
  await Promise.all([
    cargarDatosEmpresa(),
    cargarProductos(),
  ]);
}

// Arrancar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', init);
