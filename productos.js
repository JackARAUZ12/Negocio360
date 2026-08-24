/* ============================================================
   PRODUCTOS.JS — Módulo Productos/Servicios
   Supabase Auth + RLS + Vanilla JS
   ============================================================ */

'use strict';

// FIX CRÍTICO DE ZONA HORARIA: toISOString() da la fecha en UTC; en
// Nicaragua (UTC-6) eso adelanta el "día" a las 6 PM hora local, y los
// movimientos de caja por compra de inventario quedaban con fecha de
// mañana. Se usa la fecha calendario LOCAL del dispositivo.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

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
  filtroMarca:  '',      // proveedor_id seleccionado en el filtro secundario "Marca / Proveedor"
  proveedores:  [],       // catálogo de marcas/proveedores (tabla "proveedores", ya existente para Compras)
  escalasPorProducto: {}, // { producto_id: [{id,nombre,precio,orden}, ...] } — solo productos tipo_precio='escala'
  formEscalas:  [],       // filas en edición dentro del modal de producto (antes de guardar)
  busqueda:     '',
  ordenActivo:  'reciente',
  comboBusqueda: '',
  comboOrden:    'reciente',
  combosFiltrados: [],
  cargando:     false,
  modalMode:    null,   // 'crear' | 'editar' | 'ver' | 'duplicar'
  editTarget:   null,
  movTarget:    null,

  // ---- COMBOS ----
  combos:            [],  // filas de la tabla combos
  comboItemsPorCombo:  {}, // { combo_id: [{id, producto_id, cantidad, producto:{nombre,costo,...}}, ...] }
  comboEscalasPorCombo: {}, // { combo_id: [{id,nombre,precio,orden}, ...] } — solo tipo_precio='escala'
  comboFormItems:    [],  // filas en edición dentro del modal de combo (antes de guardar)
  comboFormEscalas:  [],
  comboEditId:       null,
};

// ============================================================
// DOM HELPERS
// ============================================================
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ============================================================
// FORMATO MONEDA
// ============================================================
// Aritmética de punto flotante en JS puede producir basura de decimales
// (ej. 3.5 * 28.60 = 100.10000000000001) — se usa antes de guardar
// cualquier costo/precio calculado, para que quede exacto a los centavos.
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* ============================================================
   MODAL DE MONEDA DE VISUALIZACIÓN
   ============================================================ */
function abrirModalMonedaVis() {
  $('mv-moneda-oficial').textContent = MONEDA_CODIGO;
  $('mv-select-moneda').value = monedaVisualizacionActiva() || '';
  $('mv-tasa').value = tasaVisualizacionActiva() || '';
  $('mv-error').textContent = '';
  onCambiarSelectMonedaVis();
  $('modalMonedaVis').classList.add('open');
}

function onCambiarSelectMonedaVis() {
  const elegida = $('mv-select-moneda').value;
  $('mv-wrap-tasa').style.display = (elegida && elegida !== MONEDA_CODIGO) ? '' : 'none';
}

function guardarMonedaVis() {
  const elegida = $('mv-select-moneda').value;
  const errEl = $('mv-error');
  errEl.textContent = '';

  if (!elegida || elegida === MONEDA_CODIGO) {
    desactivarMonedaVisualizacion();
  } else {
    const tasa = parseFloat($('mv-tasa').value);
    if (!tasa || tasa <= 0) {
      errEl.textContent = 'Escribe tu tasa de cambio (cuántos córdobas por un dólar).';
      return;
    }
    activarMonedaVisualizacion(elegida, tasa);
  }

  $('modalMonedaVis').classList.remove('open');
  const codigoAMostrar = monedaParaMostrar(MONEDA_CODIGO);
  $('monedaIndicador').textContent = `${CURRENCY_SYMBOLS[codigoAMostrar]||''} (${codigoAMostrar})`;
  if (typeof renderTabla === 'function') renderTabla();      // re-pinta la tabla principal con los montos ya convertidos
  if (typeof renderTablaCombos === 'function') renderTablaCombos();
  if (typeof renderPromociones === 'function') renderPromociones();
  showToast('success', 'Listo', 'Moneda de visualización actualizada');
}

function fmtMoney(val) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  const montoAMostrar = convertirParaMostrar(n, MONEDA_CODIGO);
  const codigoAMostrar = monedaParaMostrar(MONEDA_CODIGO);
  const simboloAMostrar = CURRENCY_SYMBOLS[codigoAMostrar] || MONEDA_SIMBOLO;
  return simboloAMostrar + montoAMostrar.toLocaleString('es-NI', {
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

// Versión corta (sin hora) para las columnas de la tabla — el detalle del
// producto sigue mostrando fecha+hora completa con fmtFecha().
function fmtFechaCorta(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-NI', {
    year: 'numeric', month: 'short', day: 'numeric'
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
// FIX: nombre del negocio también se refleja en el logo del
//      sidebar (antes decía "BizFlow" fijo)
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

    const btnVencer = $('btnProximosVencer');
    if (btnVencer) btnVencer.style.display = empresa?.maneja_lotes_vencimiento === true ? '' : 'none';

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

    const nombreNegocio = empresa.nombre || empresa.nombre_comercial || perfil.nombre_negocio || 'Mi Negocio';

    const nombreEl = $('nombreEmpresa');
    if (nombreEl) nombreEl.textContent = nombreNegocio;

    // FIX: nombre del negocio también en el logo del sidebar (antes "BizFlow" fijo)
    const logoTextEl = $('sidebarLogoText');
    if (logoTextEl) logoTextEl.textContent = nombreNegocio;

    // Marca personalizada (Personalización → Editar Perfil): color de acento y logo
    if (empresa.color_principal || empresa.color_primario) {
      const col = empresa.color_principal || empresa.color_primario;
      document.documentElement.style.setProperty('--accent', col);
      document.documentElement.style.setProperty('--accent-soft', col + '22');
      document.documentElement.style.setProperty('--border-focus', col);
    }
    if (empresa.logo_principal_url || empresa.logo_url) {
      const li = document.querySelector('.sidebar-logo-icon');
      if (li) li.innerHTML = `<img src="${empresa.logo_principal_url || empresa.logo_url}" style="width:26px;height:26px;object-fit:contain;border-radius:6px" alt="logo">`;
    }

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
    aplicarFiltros(); // ya llama a actualizarStats() al final

  } catch (e) {
    console.error('cargarProductos:', e);
    showToast('error', 'Error al cargar', e.message);
    mostrarErrorTabla();
  }
}

// ============================================================
// MARCAS / PROVEEDORES (feature secundaria/opcional)
// Reutiliza la tabla "proveedores" ya existente para el módulo de
// Compras. Un proveedor = una "marca" dentro del colectivo.
// No es obligatorio: un producto puede no tener marca asignada.
// ============================================================
async function cargarProveedores() {
  try {
    const { data, error } = await supabaseClient
      .from('proveedores')
      .select('id,nombre')
      .eq('auth_user_id', STATE.user.id)
      .eq('activo', true)
      .order('nombre');

    if (error) throw error;
    STATE.proveedores = data || [];

    // Select del formulario (crear/editar producto)
    const selForm = $('inputMarca');
    if (selForm) {
      selForm.innerHTML = '<option value="">Sin marca / proveedor</option>' +
        STATE.proveedores.map(pr => `<option value="${pr.id}">${escHtml(pr.nombre)}</option>`).join('');
    }

    // Filtro secundario de la tabla
    const selFiltro = $('filtroMarca');
    if (selFiltro) {
      selFiltro.innerHTML = '<option value="">Todas las marcas</option>' +
        STATE.proveedores.map(pr => `<option value="${pr.id}">${escHtml(pr.nombre)}</option>`).join('');
    }
  } catch (e) {
    console.error('cargarProveedores:', e);
    // Falla silenciosa: la marca es una función opcional, no debe
    // bloquear la carga normal del módulo de productos.
  }
}

// ============================================================
// ESCALA DE PRECIOS (feature opcional por producto)
// Un producto sigue siendo de precio fijo por defecto. Solo si
// STATE.formEscalas / producto.tipo_precio = 'escala' se usa esta tabla.
// ============================================================
async function cargarEscalas() {
  try {
    const { data, error } = await supabaseClient
      .from('precios_escala')
      .select('id,producto_id,nombre,precio,orden')
      .eq('auth_user_id', STATE.user.id)
      .order('orden');
    if (error) throw error;
    const map = {};
    (data || []).forEach(e => {
      if (!map[e.producto_id]) map[e.producto_id] = [];
      map[e.producto_id].push(e);
    });
    STATE.escalasPorProducto = map;
  } catch (e) {
    console.error('cargarEscalas:', e);
    // Falla silenciosa: no debe bloquear la carga normal de productos.
  }
}

function setTipoPrecio(tipo) {
  $('inputTipoPrecio').value = tipo;
  $('toggleTipoFijo')?.classList.toggle('active', tipo === 'fijo');
  $('toggleTipoEscala')?.classList.toggle('active', tipo === 'escala');
  const wrapFijo   = $('wrapPrecioFijo');
  const wrapEscala = $('wrapEscalaPrecios');
  if (wrapFijo)   wrapFijo.style.display   = tipo === 'fijo'   ? '' : 'none';
  if (wrapEscala) wrapEscala.style.display = tipo === 'escala' ? '' : 'none';
  if (tipo === 'escala') {
    const wrapMargen = $('margenPreviewWrap');
    if (wrapMargen) wrapMargen.style.display = 'none';
    if (!STATE.formEscalas.length) {
      // Si el producto ya tenía un precio fijo cargado, se usa como primera
      // fila ("Precio base") en vez de partir de una fila vacía — así no se
      // pierde el precio que ya existía al cambiar de modo.
      const precioFijoActual = parseFloat($('inputPrecio')?.value);
      if (!isNaN(precioFijoActual) && precioFijoActual > 0) {
        STATE.formEscalas.push({ nombre: 'Precio base', precio: precioFijoActual });
        renderEscalasEditor();
      } else {
        agregarFilaEscala();
      }
    }
  }
}

function renderEscalasEditor() {
  const cont = $('escalasEditorBody');
  if (!cont) return;
  cont.innerHTML = STATE.formEscalas.map((fila, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input type="text" class="form-input" style="flex:2" placeholder="Ej: Mayorista"
             value="${escHtml(fila.nombre || '')}"
             oninput="actualizarFilaEscala(${i}, 'nombre', this.value)" />
      <input type="number" class="form-input" style="flex:1" placeholder="0.00" min="0" step="0.01"
             value="${fila.precio ?? ''}"
             oninput="actualizarFilaEscala(${i}, 'precio', this.value)" />
      <button type="button" class="row-action-btn" title="Eliminar precio"
              onclick="eliminarFilaEscala(${i})" style="opacity:1;color:var(--danger)">🗑️</button>
    </div>
  `).join('') || '<p style="color:var(--text-muted);font-size:12.5px;margin:4px 0 8px">Aún no has agregado ningún precio.</p>';
}

function agregarFilaEscala() {
  STATE.formEscalas.push({ nombre: '', precio: '' });
  renderEscalasEditor();
}
function actualizarFilaEscala(i, campo, valor) {
  if (!STATE.formEscalas[i]) return;
  STATE.formEscalas[i][campo] = valor;
}
function eliminarFilaEscala(i) {
  STATE.formEscalas.splice(i, 1);
  renderEscalasEditor();
}

async function sincronizarEscalas(productoId, filas) {
  const limpias = (filas || [])
    .filter(f => (f.nombre || '').trim())
    .map((f, i) => ({
      auth_user_id: STATE.user.id,
      producto_id:  productoId,
      nombre:       f.nombre.trim(),
      precio:       isNaN(parseFloat(f.precio)) ? 0 : parseFloat(f.precio),
      orden:        i,
    }));

  // Reemplaza el set completo de escalas de este producto (simple y seguro
  // para listas pequeñas/medianas; evita lógica de diff propensa a errores).
  const { error: errDel } = await supabaseClient
    .from('precios_escala').delete()
    .eq('producto_id', productoId).eq('auth_user_id', STATE.user.id);
  if (errDel) throw errDel;

  if (limpias.length) {
    const { error: errIns } = await supabaseClient.from('precios_escala').insert(limpias);
    if (errIns) throw errIns;
  }
}

/* ============================================================
   COMBOS / KITS
   ------------------------------------------------------------
   Un combo agrupa productos existentes bajo un nombre, SKU y
   código de barras propios. Vive en su propio cuadro, separado
   de la tabla de Productos/Servicios — no la modifica ni la toca.
   ============================================================ */
async function cargarCombos() {
  const tbody = $('combosTbody');
  try {
    const { data: combos, error } = await supabaseClient
      .from('combos').select('*').eq('auth_user_id', STATE.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    STATE.combos = combos || [];

    const ids = STATE.combos.map(c => c.id);
    STATE.comboItemsPorCombo  = {};
    STATE.comboEscalasPorCombo = {};

    if (ids.length) {
      const [{ data: items }, { data: escalas }] = await Promise.all([
        supabaseClient.from('combo_items')
          .select('id, combo_id, producto_id, cantidad, precio_unitario, escala_id, escala_nombre, productos(nombre, costo, activo)')
          .eq('auth_user_id', STATE.user.id).in('combo_id', ids),
        supabaseClient.from('combo_precios_escala')
          .select('id, combo_id, nombre, precio, orden')
          .eq('auth_user_id', STATE.user.id).in('combo_id', ids).order('orden'),
      ]);
      (items || []).forEach(it => {
        if (!STATE.comboItemsPorCombo[it.combo_id]) STATE.comboItemsPorCombo[it.combo_id] = [];
        STATE.comboItemsPorCombo[it.combo_id].push(it);
      });
      (escalas || []).forEach(e => {
        if (!STATE.comboEscalasPorCombo[e.combo_id]) STATE.comboEscalasPorCombo[e.combo_id] = [];
        STATE.comboEscalasPorCombo[e.combo_id].push(e);
      });
    }

    aplicarFiltrosCombos();
  } catch (e) {
    console.error('cargarCombos:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--danger)">No se pudieron cargar los combos.</td></tr>`;
  }
}

function costoTotalCombo(comboId) {
  const items = STATE.comboItemsPorCombo[comboId] || [];
  return items.reduce((s, it) => s + (Number(it.cantidad) || 0) * Number(it.productos?.costo || 0), 0);
}

function precioLabelCombo(combo) {
  if (combo.tipo_precio === 'escala') {
    const escalas = STATE.comboEscalasPorCombo[combo.id] || [];
    return fmtRangoEscala(escalas);
  }
  return fmtMoney(combo.precio);
}

function aplicarFiltrosCombos() {
  let lista = [...STATE.combos];
  const q = STATE.comboBusqueda.toLowerCase().trim();

  if (q) {
    lista = lista.filter(c =>
      (c.nombre        || '').toLowerCase().includes(q) ||
      (c.sku           || '').toLowerCase().includes(q) ||
      (c.codigo_barras || '').toLowerCase().includes(q)
    );
  }

  lista = ordenarLista(lista, STATE.comboOrden);
  STATE.combosFiltrados = lista;
  renderTablaCombos();
}

function renderTablaCombos() {
  const tbody = $('combosTbody');
  const countEl = $('combosCount');
  const lista = STATE.combosFiltrados;
  if (countEl) countEl.textContent = `${lista.length} combo${lista.length === 1 ? '' : 's'}`;
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">${STATE.comboBusqueda ? 'Sin resultados para tu búsqueda.' : 'Aún no has creado ningún combo.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(c => {
    const items = STATE.comboItemsPorCombo[c.id] || [];
    const costo = costoTotalCombo(c.id);
    return `
      <tr>
        <td style="font-weight:600">📦 ${escHtml(c.nombre)}</td>
        <td style="font-size:12.5px;color:var(--text-muted)">${escHtml(c.sku || c.codigo_barras || '—')}</td>
        <td>${items.length} producto${items.length === 1 ? '' : 's'}</td>
        <td>${fmtMoney(costo)}</td>
        <td>${escHtml(precioLabelCombo(c))}${c.tipo_precio === 'escala' ? ' <span class="tipo-badge tipo-servicio" style="font-size:10px">📊 escala</span>' : ''}</td>
        <td><span class="status-badge ${c.activo ? 'status-activo' : 'status-inactivo'}">${c.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <button class="row-action-btn" title="Ver detalle" onclick="verDetalleCombo('${c.id}')">👁️</button>
          <button class="row-action-btn" title="Editar" onclick="abrirEditarCombo('${c.id}')">✏️</button>
          <button class="row-action-btn" title="Eliminar" onclick="confirmarEliminarCombo('${c.id}')" style="color:var(--danger)">🗑️</button>
        </td>
      </tr>`;
  }).join('');
}

/* ---------- Modal crear/editar combo ---------- */
function abrirModalCombo() {
  STATE.comboEditId = null;
  STATE.comboFormItems = [];
  STATE.comboFormEscalas = [];
  $('modalComboTitle').textContent = '+ Nuevo Combo';
  $('comboEditId').value = '';
  $('comboNombre').value = '';
  $('comboSku').value = '';
  $('comboCodigoBarras').value = '';
  $('comboGarantiaMeses').value = '';
  $('comboInputPrecio').value = '';
  $('comboActivo').checked = true;
  $('comboProductoSearch').value = '';
  $('comboProductoResultados').innerHTML = '';
  $('errComboNombre').textContent = '';
  $('errComboEscalas').textContent = '';
  setComboTipoPrecio('fijo');
  renderComboItemsBody();
  $('modalCombo').classList.add('open');
}

function abrirEditarCombo(id) {
  const c = STATE.combos.find(x => x.id === id);
  if (!c) return;
  STATE.comboEditId = id;
  const items = STATE.comboItemsPorCombo[id] || [];
  STATE.comboFormItems = items.map(it => ({
    producto_id: it.producto_id,
    nombre: it.productos?.nombre || 'Producto eliminado',
    costo: Number(it.productos?.costo || 0),
    cantidad: Number(it.cantidad) || 1,
    precio: Number(it.precio_unitario || 0),
    escalaId: it.escala_id || null,
    escalaNombre: it.escala_nombre || null,
  }));
  const escalas = STATE.comboEscalasPorCombo[id] || [];
  STATE.comboFormEscalas = escalas.map(e => ({ nombre: e.nombre, precio: e.precio }));

  $('modalComboTitle').textContent = `Editar Combo — ${c.nombre}`;
  $('comboEditId').value = id;
  $('comboNombre').value = c.nombre || '';
  $('comboSku').value = c.sku || '';
  $('comboCodigoBarras').value = c.codigo_barras || '';
  $('comboGarantiaMeses').value = c.garantia_meses ?? '';
  $('comboInputPrecio').value = c.tipo_precio === 'fijo' ? (c.precio ?? '') : '';
  $('comboActivo').checked = c.activo !== false;
  $('comboProductoSearch').value = '';
  $('comboProductoResultados').innerHTML = '';
  $('errComboNombre').textContent = '';
  $('errComboEscalas').textContent = '';
  setComboTipoPrecio(c.tipo_precio === 'escala' ? 'escala' : 'fijo');
  renderComboItemsBody();
  $('modalCombo').classList.add('open');
}

function cerrarModalCombo() {
  $('modalCombo').classList.remove('open');
}

function setComboTipoPrecio(tipo) {
  $('comboInputTipoPrecio').value = tipo;
  $('comboToggleTipoFijo')?.classList.toggle('active', tipo === 'fijo');
  $('comboToggleTipoEscala')?.classList.toggle('active', tipo === 'escala');
  const wrapFijo = $('comboWrapPrecioFijo');
  const wrapEscala = $('comboWrapEscalaPrecios');
  if (wrapFijo) wrapFijo.style.display = tipo === 'fijo' ? '' : 'none';
  if (wrapEscala) wrapEscala.style.display = tipo === 'escala' ? '' : 'none';
  if (tipo === 'escala' && !STATE.comboFormEscalas.length) {
    const precioFijoActual = parseFloat($('comboInputPrecio')?.value);
    if (!isNaN(precioFijoActual) && precioFijoActual > 0) {
      STATE.comboFormEscalas.push({ nombre: 'Precio base', precio: precioFijoActual });
    } else {
      STATE.comboFormEscalas.push({ nombre: '', precio: '' });
    }
  }
  renderEscalasEditorCombo();
}
function renderEscalasEditorCombo() {
  const cont = $('comboEscalasEditorBody');
  if (!cont) return;
  cont.innerHTML = STATE.comboFormEscalas.map((fila, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input type="text" class="form-input" style="flex:2" placeholder="Ej: Mayorista"
             value="${escHtml(fila.nombre || '')}"
             oninput="actualizarFilaEscalaCombo(${i}, 'nombre', this.value)" />
      <input type="number" class="form-input" style="flex:1" placeholder="0.00" min="0" step="0.01"
             value="${fila.precio ?? ''}"
             oninput="actualizarFilaEscalaCombo(${i}, 'precio', this.value)" />
      <button type="button" class="row-action-btn" title="Eliminar precio"
              onclick="eliminarFilaEscalaCombo(${i})" style="opacity:1;color:var(--danger)">🗑️</button>
    </div>
  `).join('') || '<p style="color:var(--text-muted);font-size:12.5px;margin:4px 0 8px">Aún no has agregado ningún precio.</p>';
}
function agregarFilaEscalaCombo() { STATE.comboFormEscalas.push({ nombre: '', precio: '' }); renderEscalasEditorCombo(); }
function actualizarFilaEscalaCombo(i, campo, valor) { if (STATE.comboFormEscalas[i]) STATE.comboFormEscalas[i][campo] = valor; }
function eliminarFilaEscalaCombo(i) { STATE.comboFormEscalas.splice(i, 1); renderEscalasEditorCombo(); }

/* ---------- Buscar y agregar productos dentro del combo ---------- */
function buscarProductoParaCombo(q) {
  const cont = $('comboProductoResultados');
  if (!cont) return;
  const texto = (q || '').trim().toLowerCase();
  if (!texto) { cont.innerHTML = ''; return; }

  const yaAgregados = new Set(STATE.comboFormItems.map(i => i.producto_id));
  const resultados = STATE.productos.filter(p =>
    p.activo !== false && !yaAgregados.has(p.id) &&
    ((p.nombre || '').toLowerCase().includes(texto) || (p.sku || '').toLowerCase().includes(texto))
  ).slice(0, 8);

  if (!resultados.length) { cont.innerHTML = `<p style="color:var(--text-muted);font-size:12.5px;padding:6px 0">Sin resultados</p>`; return; }

  cont.innerHTML = `<div style="position:absolute;z-index:20;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);width:100%;max-height:220px;overflow-y:auto;box-shadow:var(--shadow-md)">
    ${resultados.map(p => `
      <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="agregarProductoACombo('${p.id}')" onmouseover="this.style.background='var(--bg-app)'" onmouseout="this.style.background=''">
        <div style="font-weight:600;font-size:13px">${escHtml(p.nombre)}</div>
        <div style="font-size:11.5px;color:var(--text-muted)">${p.sku ? 'SKU: ' + escHtml(p.sku) + ' · ' : ''}Costo: ${fmtMoney(p.costo)} · Stock: ${fmtNum(p.stock_actual)}</div>
      </div>`).join('')}
  </div>`;
}
let _comboEscalaPendiente = null; // producto mientras el selector de precio está abierto

function agregarProductoACombo(productoId) {
  const p = STATE.productos.find(x => x.id === productoId);
  if (!p) return;
  $('comboProductoSearch').value = '';
  $('comboProductoResultados').innerHTML = '';

  // Si el producto tiene escala de precios, se pregunta con cuál se
  // agrega al combo (es solo de referencia — el combo sigue teniendo
  // su propio precio de venta, fijo o de escala).
  if (p.tipo_precio === 'escala') {
    abrirSelectorEscalaComponenteCombo(p);
    return;
  }
  agregarItemComboConPrecio(p, { precio: Number(p.precio || 0), escalaId: null, escalaNombre: null });
}

function abrirSelectorEscalaComponenteCombo(producto) {
  const escalas = STATE.escalasPorProducto[producto.id] || [];
  if (!escalas.length) {
    // Tiene el modo "escala" activado pero sin ningún precio cargado
    // todavía: se agrega igual, sin precio individual definido.
    agregarItemComboConPrecio(producto, { precio: 0, escalaId: null, escalaNombre: null });
    return;
  }
  _comboEscalaPendiente = producto;
  $('escalaComponenteNombreProducto').textContent = producto.nombre;
  $('escalaComponenteOpciones').innerHTML = escalas.map((e, i) => `
    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--border);border-radius:var(--radius-md);cursor:pointer;margin-bottom:8px">
      <input type="radio" name="escalaComponenteRadio" value="${e.id}" ${i===0?'checked':''} style="accent-color:var(--accent);width:16px;height:16px"/>
      <span style="flex:1;font-size:13.5px;font-weight:500">${escHtml(e.nombre)}</span>
      <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${fmtMoney(e.precio)}</span>
    </label>`).join('');
  $('modalEscalaComponenteCombo').classList.add('open');
}
function cerrarModalEscalaComponenteCombo() {
  $('modalEscalaComponenteCombo').classList.remove('open');
  _comboEscalaPendiente = null;
}
function confirmarEscalaComponenteCombo() {
  const producto = _comboEscalaPendiente;
  if (!producto) return;
  const radio = document.querySelector('input[name="escalaComponenteRadio"]:checked');
  if (!radio) { showToast('warning', 'Falta elegir', 'Selecciona un precio para continuar.'); return; }
  const escalas = STATE.escalasPorProducto[producto.id] || [];
  const elegida = escalas.find(e => e.id === radio.value);
  if (!elegida) return;
  agregarItemComboConPrecio(producto, { precio: Number(elegida.precio || 0), escalaId: elegida.id, escalaNombre: elegida.nombre });
  cerrarModalEscalaComponenteCombo();
}
function agregarItemComboConPrecio(p, precioInfo) {
  STATE.comboFormItems.push({
    producto_id: p.id, nombre: p.nombre, costo: Number(p.costo || 0), cantidad: 1,
    precio: precioInfo.precio, escalaId: precioInfo.escalaId, escalaNombre: precioInfo.escalaNombre,
  });
  renderComboItemsBody();
}
function actualizarCantidadComboItem(i, valor) {
  const n = parseFloat(valor);
  if (!STATE.comboFormItems[i]) return;
  STATE.comboFormItems[i].cantidad = isNaN(n) || n <= 0 ? 1 : n;
  renderComboItemsBody();
}
function eliminarComboItem(i) {
  STATE.comboFormItems.splice(i, 1);
  renderComboItemsBody();
}
function renderComboItemsBody() {
  const cont = $('comboItemsBody');
  if (!cont) return;
  if (!STATE.comboFormItems.length) {
    cont.innerHTML = `<p style="color:var(--text-muted);font-size:12.5px;margin:4px 0">Aún no has agregado ningún producto a este combo.</p>`;
  } else {
    cont.innerHTML = STATE.comboFormItems.map((it, i) => `
      <div style="display:flex;gap:8px;align-items:center;padding:8px 10px;background:var(--bg-app);border-radius:var(--radius-sm);margin-bottom:6px">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${escHtml(it.nombre)}</div>
          <div style="font-size:11px;color:var(--text-muted)">Costo: ${fmtMoney(it.costo)} c/u · Precio: ${fmtMoney(it.precio)} c/u${it.escalaNombre ? ` <span style="color:var(--accent)">(${escHtml(it.escalaNombre)})</span>` : ''}</div>
        </div>
        <input type="number" class="form-input" style="width:70px" min="1" step="1" value="${it.cantidad}"
               oninput="actualizarCantidadComboItem(${i}, this.value)" />
        <div style="font-size:12.5px;font-weight:600;min-width:70px;text-align:right">${fmtMoney(it.costo * it.cantidad)}</div>
        <button type="button" class="row-action-btn" title="Quitar" onclick="eliminarComboItem(${i})" style="opacity:1;color:var(--danger)">✕</button>
      </div>`).join('');
  }
  const total = STATE.comboFormItems.reduce((s, it) => s + it.costo * it.cantidad, 0);
  const previewEl = $('comboCostoTotalPreview');
  if (previewEl) previewEl.textContent = fmtMoney(total);
}

/* ---------- Guardar combo ---------- */
async function guardarCombo() {
  $('errComboNombre').textContent = '';
  $('errComboEscalas').textContent = '';

  const nombre = $('comboNombre').value.trim();
  if (!nombre) { $('errComboNombre').textContent = 'El nombre del combo es obligatorio.'; return; }
  if (!STATE.comboFormItems.length) { showToast('warning', 'Faltan productos', 'Agrega al menos un producto al combo.'); return; }

  const tipoPrecio = $('comboInputTipoPrecio').value;
  let precioFijo = 0;
  let escalasValidas = [];
  if (tipoPrecio === 'fijo') {
    precioFijo = parseFloat($('comboInputPrecio').value);
    if (isNaN(precioFijo) || precioFijo <= 0) { showToast('warning', 'Precio inválido', 'Ingresa un precio de venta válido para el combo.'); return; }
  } else {
    escalasValidas = STATE.comboFormEscalas.filter(f => (f.nombre || '').trim() && parseFloat(f.precio) > 0);
    if (!escalasValidas.length) { $('errComboEscalas').textContent = 'Agrega al menos un precio con nombre y valor válidos.'; return; }
  }

  const costoTotal = round2(STATE.comboFormItems.reduce((s, it) => s + it.costo * it.cantidad, 0));
  const btn = $('btnGuardarCombo');
  if (btn) btn.disabled = true;

  try {
    const payload = {
      auth_user_id: STATE.user.id,
      nombre,
      sku: $('comboSku').value.trim() || null,
      codigo_barras: $('comboCodigoBarras').value.trim() || null,
      garantia_meses: (() => { const v = $('comboGarantiaMeses').value; return v !== '' ? parseFloat(v) : null; })(),
      tipo_precio: tipoPrecio,
      precio: tipoPrecio === 'fijo' ? precioFijo : 0,
      costo: costoTotal,
      activo: $('comboActivo').checked,
      updated_at: new Date().toISOString(),
    };

    let comboId = STATE.comboEditId;
    if (comboId) {
      const { error } = await supabaseClient.from('combos').update(payload).eq('id', comboId).eq('auth_user_id', STATE.user.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient.from('combos').insert(payload).select('id').single();
      if (error) throw error;
      comboId = data.id;
    }

    // Reemplaza el set completo de productos del combo (igual patrón que
    // sincronizarEscalas: simple y seguro para listas pequeñas).
    await supabaseClient.from('combo_items').delete().eq('combo_id', comboId).eq('auth_user_id', STATE.user.id);
    await supabaseClient.from('combo_items').insert(
      STATE.comboFormItems.map(it => ({
        auth_user_id: STATE.user.id, combo_id: comboId, producto_id: it.producto_id, cantidad: it.cantidad,
        precio_unitario: it.precio || 0, escala_id: it.escalaId || null, escala_nombre: it.escalaNombre || null,
      }))
    );

    await supabaseClient.from('combo_precios_escala').delete().eq('combo_id', comboId).eq('auth_user_id', STATE.user.id);
    if (tipoPrecio === 'escala' && escalasValidas.length) {
      await supabaseClient.from('combo_precios_escala').insert(
        escalasValidas.map((f, i) => ({
          auth_user_id: STATE.user.id, combo_id: comboId, nombre: f.nombre.trim(), precio: parseFloat(f.precio) || 0, orden: i,
        }))
      );
    }

    showToast('success', 'Combo guardado', `"${nombre}" se guardó correctamente.`);
    cerrarModalCombo();
    await cargarCombos();
  } catch (e) {
    console.error('guardarCombo:', e);
    showToast('error', 'Error al guardar', e.message || 'Intenta de nuevo.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------- Ver detalle / eliminar ---------- */
function verDetalleCombo(id) {
  const c = STATE.combos.find(x => x.id === id);
  if (!c) return;
  const items = STATE.comboItemsPorCombo[id] || [];
  const costo = costoTotalCombo(id);
  const escalas = STATE.comboEscalasPorCombo[id] || [];

  $('detalleComboBody').innerHTML = `
    <div class="form-grid" style="margin-bottom:16px">
      <div><strong>Nombre:</strong> ${escHtml(c.nombre)}</div>
      <div><strong>SKU:</strong> ${escHtml(c.sku || '—')}</div>
      <div><strong>Código de barras:</strong> ${escHtml(c.codigo_barras || '—')}</div>
      <div><strong>Estado:</strong> ${c.activo ? 'Activo' : 'Inactivo'}</div>
    </div>
    <div class="form-section-title">Productos incluidos</div>
    <table class="data-table" style="width:100%;margin-bottom:16px">
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th>Precio venta individual</th><th>Subtotal costo</th></tr></thead>
      <tbody>
        ${items.map(it => `<tr>
          <td>${escHtml(it.productos?.nombre || 'Producto eliminado')}</td>
          <td>${fmtNum(it.cantidad)}</td>
          <td>${fmtMoney(it.productos?.costo)}</td>
          <td>${fmtMoney(it.precio_unitario)}${it.escala_nombre ? ` <span style="font-size:11px;color:var(--accent)">(${escHtml(it.escala_nombre)})</span>` : ''}</td>
          <td>${fmtMoney((Number(it.cantidad)||0) * Number(it.productos?.costo || 0))}</td>
        </tr>`).join('') || '<tr><td colspan="5">Sin productos</td></tr>'}
      </tbody>
    </table>
    <div style="background:var(--bg-app);border-radius:var(--radius-md);padding:10px 14px;font-size:13px;margin-bottom:12px">
      Costo total del combo: <strong>${fmtMoney(costo)}</strong>
    </div>
    <div class="form-section-title">Precio de venta</div>
    ${c.tipo_precio === 'escala'
      ? `<table class="data-table" style="width:100%"><thead><tr><th>Nombre</th><th>Precio</th></tr></thead>
         <tbody>${escalas.map(e => `<tr><td>${escHtml(e.nombre)}</td><td>${fmtMoney(e.precio)}</td></tr>`).join('') || '<tr><td colspan="2">Sin precios configurados</td></tr>'}</tbody></table>`
      : `<div>Precio fijo: <strong>${fmtMoney(c.precio)}</strong></div>`
    }
  `;
  $('modalDetalleCombo').classList.add('open');
}
function cerrarModalDetalleCombo() { $('modalDetalleCombo').classList.remove('open'); }

let comboAEliminar = null;
function confirmarEliminarCombo(id) {
  comboAEliminar = id;
  const c = STATE.combos.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`¿Eliminar el combo "${c.nombre}"? Esta acción no se puede deshacer (no afecta a los productos que lo componen).`)) return;
  eliminarComboConfirmado(id);
}
async function eliminarComboConfirmado(id) {
  try {
    const { error } = await supabaseClient.from('combos').delete().eq('id', id).eq('auth_user_id', STATE.user.id);
    if (error) throw error;
    showToast('success', 'Combo eliminado', '');
    await cargarCombos();
  } catch (e) {
    console.error('eliminarComboConfirmado:', e);
    showToast('error', 'Error al eliminar', e.message || 'Intenta de nuevo.');
  }
}

function fmtRangoEscala(lista) {
  if (!lista || !lista.length) return 'Sin precios configurados';
  const precios = lista.map(e => Number(e.precio) || 0);
  const min = Math.min(...precios), max = Math.max(...precios);
  return min === max ? fmtMoney(min) : `${fmtMoney(min)} – ${fmtMoney(max)}`;
}

function fmtRangoEscala(lista) {
  if (!lista || !lista.length) return 'Sin precios configurados';
  const precios = lista.map(e => Number(e.precio) || 0);
  const min = Math.min(...precios), max = Math.max(...precios);
  return min === max ? fmtMoney(min) : `${fmtMoney(min)} – ${fmtMoney(max)}`;
}

/* ============================================================
   EXPORTAR INVENTARIO — PDF y Excel
   Se exporta la lista ya filtrada (STATE.filtrados), respetando
   cualquier búsqueda/filtro que el usuario tenga activo.

   Regla de precio fijo vs. escala (pedida explícitamente):
     - tipo_precio === 'escala'  -> "Precio fijo" queda en "-",
       y se llenan hasta 5 columnas de escala (nombre + precio);
       las que el producto no tenga quedan en blanco.
     - cualquier otro caso (precio fijo) -> las 5 columnas de
       escala quedan en "-", y "Precio fijo" muestra su precio.
   ============================================================ */
function filaExportInventario(p) {
  const esEscala = p.tipo_precio === 'escala';
  const escalas  = esEscala ? (STATE.escalasPorProducto[p.id] || []).slice(0, 5) : [];

  const fila = {
    producto: p.nombre || '—',
    tipo: p.tipo === 'servicio' ? 'Servicio' : 'Producto',
    sku: p.sku || '—',
    categoria: p.categoria || '—',
    stock: p.tipo === 'servicio' ? '—' : Number(p.stock_actual || 0),
    costo: Number(p.costo || 0),
    precioFijo: esEscala ? '-' : Number(p.precio || 0),
    escala1: '', escala2: '', escala3: '', escala4: '', escala5: '',
    estado: p.activo === false ? 'Inactivo' : 'Activo',
  };

  if (esEscala) {
    for (let i = 0; i < 5; i++) {
      const e = escalas[i];
      // Escalas que el producto SÍ tiene: "Nombre — Precio". Las que
      // no tiene (si solo configuró 2 o 3) quedan en blanco, tal como
      // se pidió — nunca con "-", eso es solo para precio fijo.
      fila[`escala${i+1}`] = e ? `${e.nombre} — ${fmtMoney(e.precio)}` : '';
    }
  } else {
    // Precio fijo: las 5 columnas de escala se marcan con "-"
    for (let i = 1; i <= 5; i++) fila[`escala${i}`] = '-';
  }

  return fila;
}

function abrirModalExportarInventario() {
  const cant = $('exp-inv-cantidad');
  if (cant) cant.textContent = (STATE.filtrados || STATE.productos || []).length;
  $('modalExportarInventario').classList.add('open');
}
function cerrarModalExportarInventario() {
  $('modalExportarInventario').classList.remove('open');
}

/* ============================================================
   MOVER PRODUCTOS A OTRA SUCURSAL / BODEGA
   Reutiliza el mismo mecanismo de "grupo" que ya tiene Sucursales
   (RPC listar_sucursales_grupo / mover_stock_producto) — nunca toca
   directo la tabla de otra cuenta, todo pasa por esas funciones ya
   protegidas en la base de datos.
   ============================================================ */
let MP = { productoSel: null, destinos: [] };

async function abrirModalMoverProducto() {
  MP.productoSel = null;
  $('mp-buscar-producto').value = '';
  $('mp-resultados').style.display = 'none';
  $('mp-seleccionado').style.display = 'none';
  $('mp-cantidad').value = '';
  $('mp-error').textContent = '';
  $('mp-destino').innerHTML = '<option value="">Cargando sucursales y bodegas…</option>';
  $('modalMoverProducto').classList.add('open');

  try {
    // ¿Cuál de las filas del grupo soy YO? — para no ofrecerme a mí
    // mismo como destino. Se determina igual que en Sucursales: si
    // tengo una fila donde figuro como sucursal/bodega de otra Central,
    // esa es la mía; si no, soy yo mismo la Central.
    const { data: miFila } = await supabaseClient.from('sucursales')
      .select('id').eq('auth_user_id_sucursal', STATE.user.id).eq('es_central', false).maybeSingle();
    const miPropioId = miFila?.id || null; // null si soy la Central

    const { data, error } = await supabaseClient.rpc('listar_sucursales_grupo');
    if (error) throw error;

    MP.destinos = (data || []).filter(d => miPropioId ? d.id !== miPropioId : !d.es_central);
    if (!MP.destinos.length) {
      $('mp-destino').innerHTML = '<option value="">No tienes otras sucursales o bodegas creadas todavía</option>';
      return;
    }
    $('mp-destino').innerHTML = MP.destinos.map(d =>
      `<option value="${d.id}">${d.tipo === 'bodega' ? '📦' : (d.es_central ? '🏠' : '🏬')} ${escHtml(d.nombre)}${d.es_central ? ' (Central)' : ''}</option>`
    ).join('');
  } catch (e) {
    console.error('abrirModalMoverProducto:', e);
    $('mp-destino').innerHTML = '<option value="">No se pudieron cargar — revisa el módulo Sucursales</option>';
  }
}

function cerrarModalMoverProducto() {
  $('modalMoverProducto').classList.remove('open');
}

function buscarProductoParaMover(q) {
  const cont = $('mp-resultados');
  q = (q || '').trim().toLowerCase();
  if (!q) { cont.style.display = 'none'; cont.innerHTML = ''; return; }

  const coincidencias = (STATE.productos || [])
    .filter(p => p.tipo === 'producto' && p.activo !== false && Number(p.stock_actual) > 0)
    .filter(p => (p.nombre || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
    .slice(0, 8);

  if (!coincidencias.length) {
    cont.style.display = 'block';
    cont.innerHTML = `<div style="padding:10px 12px;font-size:12.5px;color:var(--text-muted)">Sin resultados (solo productos físicos con stock disponible)</div>`;
    return;
  }
  cont.style.display = 'block';
  cont.innerHTML = coincidencias.map(p => `
    <div class="sri-item" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px" onclick="seleccionarProductoParaMover('${p.id}')">
      <strong>${escHtml(p.nombre)}</strong>
      <div style="font-size:11.5px;color:var(--text-muted)">${p.sku ? 'SKU: '+escHtml(p.sku)+' · ' : ''}Stock: ${fmtNumeroSimple(p.stock_actual)}</div>
    </div>`).join('');
}

function seleccionarProductoParaMover(productoId) {
  const p = (STATE.productos || []).find(x => x.id === productoId);
  if (!p) return;
  MP.productoSel = p;
  $('mp-buscar-producto').value = '';
  $('mp-resultados').style.display = 'none';
  $('mp-seleccionado').style.display = 'block';
  $('mp-sel-nombre').textContent = p.nombre;
  $('mp-sel-stock').textContent = fmtNumeroSimple(p.stock_actual);
  $('mp-cantidad').max = p.stock_actual;
}

async function confirmarMoverProducto() {
  const errEl = $('mp-error');
  errEl.textContent = '';

  if (!MP.productoSel) { errEl.textContent = 'Busca y elige un producto primero.'; return; }
  const destinoId = $('mp-destino').value;
  if (!destinoId) { errEl.textContent = 'Elige a dónde enviarlo.'; return; }
  const cantidad = parseFloat($('mp-cantidad').value);
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'Escribe una cantidad válida.'; return; }
  if (cantidad > Number(MP.productoSel.stock_actual)) {
    errEl.textContent = `No tienes suficiente stock (disponible: ${fmtNumeroSimple(MP.productoSel.stock_actual)}).`; return;
  }

  const btnMover = $('btnConfirmarMover');
  if (btnMover) { btnMover.disabled = true; btnMover.classList.add('btn-loading'); }
  try {
    const { error } = await supabaseClient.rpc('mover_stock_producto', {
      p_producto_id: MP.productoSel.id,
      p_sucursal_destino_id: destinoId,
      p_cantidad: cantidad,
    });
    if (error) throw error;

    const destino = MP.destinos.find(d => d.id === destinoId);
    showToast('success', 'Producto movido', `${cantidad} de "${MP.productoSel.nombre}" enviado a ${destino?.nombre || 'destino'}`);
    cerrarModalMoverProducto();
    await cargarProductos();
  } catch (e) {
    console.error('confirmarMoverProducto:', e);
    errEl.textContent = 'Error al mover: ' + (e.message || 'intenta de nuevo');
  } finally {
    if (btnMover) { btnMover.disabled = false; btnMover.classList.remove('btn-loading'); }
  }
}

function fmtNumeroSimple(n) {
  return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 });
}

function datosParaExportarInventario() {
  const lista = (STATE.filtrados && STATE.filtrados.length) ? STATE.filtrados : STATE.productos;
  return (lista || []).map(filaExportInventario);
}

async function exportarInventarioExcel() {
  try {
    const filas = datosParaExportarInventario();
    if (!filas.length) { showToast('warning', 'Sin productos', 'No hay productos para exportar'); return; }

    const headers = ['Producto', 'Tipo', 'SKU', 'Categoría', 'Stock', `Costo (${MONEDA_SIMBOLO})`,
      `Precio fijo (${MONEDA_SIMBOLO})`, 'Escala 1', 'Escala 2', 'Escala 3', 'Escala 4', 'Escala 5', 'Estado'];
    const filasArr = filas.map(f => [
      f.producto, f.tipo, f.sku, f.categoria, f.stock, f.costo, f.precioFijo,
      f.escala1, f.escala2, f.escala3, f.escala4, f.escala5, f.estado,
    ]);

    const wb = XLSX.utils.book_new();
    const aoa = [headers, ...filasArr];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Formato numérico en columnas de costo/precio fijo/stock (cuando son
    // números reales; "-" o texto se dejan tal cual, sin forzar formato).
    filasArr.forEach((row, ri) => {
      [4, 5, 6].forEach(ci => {
        const ref = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
        if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '#,##0.00';
      });
    });

    // Ancho de columna autoajustado según el contenido real
    ws['!cols'] = headers.map((h, ci) => {
      const maxLen = filasArr.reduce((m, r) => Math.max(m, String(r[ci] ?? '').length), h.length);
      return { wch: Math.min(Math.max(maxLen + 2, 10), 34) };
    });
    // Encabezado congelado + autofiltro, para que se vea profesional y
    // se pueda ordenar/filtrar directo en Excel.
    ws['!freeze'] = { xSplit: '0', ySplit: '1', topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:filasArr.length,c:headers.length-1} }) };

    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const fecha = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `Inventario_Negocio360_${fecha}.xlsx`);

    cerrarModalExportarInventario();
    showToast('success', 'Listo', 'Inventario exportado a Excel');
  } catch (e) {
    console.error('exportarInventarioExcel:', e);
    showToast('error', 'Error', 'No se pudo exportar a Excel');
  }
}

async function exportarInventarioPDF() {
  try {
    if (!window.jspdf) throw new Error('jsPDF no está disponible');
    const filas = datosParaExportarInventario();
    if (!filas.length) { showToast('warning', 'Sin productos', 'No hay productos para exportar'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const nombreNegocio = ($('nombreEmpresa') && $('nombreEmpresa').textContent.trim()) || 'Negocio360';

    // Encabezado con franja de color (mismo estilo que el resto de los
    // comprobantes/PDF del sistema)
    doc.setFillColor(108, 99, 255);
    doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(15); doc.setFont(undefined, 'bold');
    doc.text(nombreNegocio, 12, 13);
    doc.setFontSize(10); doc.setFont(undefined, 'normal');
    doc.text('Inventario de Productos y Servicios', 12, 19);
    doc.setFontSize(8.5);
    doc.text(`Generado: ${new Date().toLocaleDateString('es-NI',{day:'2-digit',month:'short',year:'numeric'})}`, W-12, 13, {align:'right'});
    doc.text(`${filas.length} ítem${filas.length===1?'':'s'}`, W-12, 19, {align:'right'});

    const cm = CURRENCY_SYMBOLS[monedaParaMostrar(MONEDA_CODIGO)] || MONEDA_SIMBOLO;
    const head = [['Producto','Tipo','SKU','Categoría','Stock',`Costo (${cm})`,`Precio fijo (${cm})`,'Escala 1','Escala 2','Escala 3','Escala 4','Escala 5','Estado']];
    const body = filas.map(f => [
      f.producto, f.tipo, f.sku, f.categoria, f.stock,
      typeof f.costo === 'number' ? fmtMoney(f.costo).replace(cm,'') : f.costo,
      typeof f.precioFijo === 'number' ? fmtMoney(f.precioFijo).replace(cm,'') : f.precioFijo,
      f.escala1||'', f.escala2||'', f.escala3||'', f.escala4||'', f.escala5||'', f.estado,
    ]);

    doc.autoTable({
      startY: 28,
      head, body,
      theme: 'striped',
      headStyles: { fillColor: [108,99,255], fontSize: 8 },
      styles: { fontSize: 7.3, cellPadding: 2.2, overflow: 'linebreak' },
      columnStyles: {
        4: { halign:'right' }, 5: { halign:'right' }, 6: { halign:'right' },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: () => {
        const pageH = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5); doc.setTextColor(150,150,170);
        doc.text('Generado por Negocio360', 10, pageH - 6);
      },
    });

    const pages = doc.internal.getNumberOfPages();
    for (let i=1;i<=pages;i++) {
      doc.setPage(i);
      doc.setFontSize(7.5); doc.setTextColor(150,150,170);
      doc.text(`Página ${i} de ${pages}`, W-10, doc.internal.pageSize.getHeight()-6, {align:'right'});
    }

    const fecha = new Date().toISOString().slice(0,10);
    doc.save(`Inventario_Negocio360_${fecha}.pdf`);

    cerrarModalExportarInventario();
    showToast('success', 'Listo', 'Inventario exportado a PDF');
  } catch (e) {
    console.error('exportarInventarioPDF:', e);
    showToast('error', 'Error', 'No se pudo exportar a PDF');
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
  // Los KPIs siguen el filtro de Marca/Proveedor específicamente
  // (no la búsqueda de texto ni el tipo) — si está en "Todas las
  // marcas", se comportan exactamente igual que siempre.
  const base = STATE.filtroMarca
    ? STATE.productos.filter(p => p.proveedor_id === STATE.filtroMarca)
    : STATE.productos;

  const todos   = base;
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
// Reutilizable tanto para Productos/Servicios como para Combos — las
// 2 tablas comparten los mismos nombres de campo (precio, created_at,
// codigo_barras), así que una sola función sirve para ambas listas.
function ordenarLista(lista, criterio) {
  const copia = [...lista];
  switch (criterio) {
    case 'antiguo':
      return copia.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    case 'precio_asc':
      return copia.sort((a, b) => Number(a.precio || 0) - Number(b.precio || 0));
    case 'precio_desc':
      return copia.sort((a, b) => Number(b.precio || 0) - Number(a.precio || 0));
    case 'codigo_barras':
      // Los que no tienen código quedan al final, no se pierden de la lista.
      return copia.sort((a, b) => {
        const ca = (a.codigo_barras || '').trim(), cb = (b.codigo_barras || '').trim();
        if (!ca && !cb) return 0;
        if (!ca) return 1;
        if (!cb) return -1;
        return ca.localeCompare(cb, 'es', { numeric: true });
      });
    case 'reciente':
    default:
      return copia.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
}

function aplicarFiltros() {
  let lista = [...STATE.productos];
  const q   = STATE.busqueda.toLowerCase().trim();

  if (q) {
    lista = lista.filter(p =>
      (p.nombre           || '').toLowerCase().includes(q) ||
      (p.sku              || '').toLowerCase().includes(q) ||
      (p.codigo_barras    || '').toLowerCase().includes(q) ||
      (p.categoria        || '').toLowerCase().includes(q) ||
      (p.proveedor_nombre || '').toLowerCase().includes(q) ||
      (p.descripcion      || '').toLowerCase().includes(q)
    );
  }

  switch (STATE.filtroActivo) {
    case 'productos':  lista = lista.filter(p => p.tipo === 'producto' && !p.es_materia_prima);  break;
    case 'servicios':  lista = lista.filter(p => p.tipo === 'servicio');  break;
    case 'materia_prima': lista = lista.filter(p => p.es_materia_prima === true); break;
    case 'activos':    lista = lista.filter(p => p.activo === true && !p.es_materia_prima);      break;
    case 'inactivos':  lista = lista.filter(p => p.activo === false && !p.es_materia_prima);     break;
    // FIX: usa helper para evitar falsos positivos (0 <= 0)
    case 'stock_bajo': lista = lista.filter(p => esStockBajo(p) && !p.es_materia_prima); break;
    // "Todos" (default): la materia prima queda fuera de la vista
    // general -- vive en su propio filtro dedicado, para que de
    // verdad se sienta separada de lo que sí se vende.
    default: lista = lista.filter(p => !p.es_materia_prima); break;
  }

  // Filtro secundario: Marca / Proveedor (opcional, independiente de filtroActivo)
  if (STATE.filtroMarca) {
    lista = lista.filter(p => p.proveedor_id === STATE.filtroMarca);
  }

  // Orden — no reemplaza el filtrado de arriba, solo reordena lo que
  // ya quedó después de buscar/filtrar.
  lista = ordenarLista(lista, STATE.ordenActivo);

  STATE.filtrados = lista;
  renderTabla();
  actualizarStats();

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
      <tr><td colspan="11">
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
        <td style="font-size:12px;color:var(--text-muted);white-space:nowrap">${fmtFechaCorta(p.created_at)}</td>
        <td style="font-size:12px;color:var(--text-muted);white-space:nowrap">${fmtFechaCorta(p.updated_at)}</td>
        <td>
          <div class="td-nombre">${escHtml(p.nombre)}</div>
          ${p.sku ? `<div class="td-sku">${escHtml(p.sku)}</div>` : ''}
        </td>
        <td>
          ${p.categoria ? escHtml(p.categoria) : '<span style="color:var(--text-muted)">—</span>'}
          ${p.proveedor_nombre ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">🏷️ ${escHtml(p.proveedor_nombre)}</div>` : ''}
        </td>
        <td class="td-money">
          ${p.tipo_precio === 'escala'
            ? `<span class="tipo-badge tipo-servicio" title="Escala de precios">📊 ${escHtml(fmtRangoEscala(STATE.escalasPorProducto[p.id]))}</span>`
            : fmtMoney(p.precio)}
        </td>
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
              <button class="row-action-btn del"  title="Eliminar"      onclick="confirmarEliminarProducto('${p.id}')">🗑️</button>
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
      <td><div class="skeleton skel-line" style="width:70px"></div></td>
      <td><div class="skeleton skel-line" style="width:70px"></div></td>
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
    <tr><td colspan="11">
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
// IMPACTO EN CAJA (nuevo producto)
// Toggle: "Descontar de caja" (compra nueva) vs "Ya lo tenía"
// (inventario físico previo, útil al iniciar con el sistema)
// ============================================================
function setCajaImpacto(descontar) {
  const input = $('inputDescontarCaja');
  if (input) input.value = descontar ? 'true' : 'false';

  const btnSi = $('toggleDescontarCaja');
  const btnNo = $('toggleNoDescontarCaja');
  if (btnSi) btnSi.classList.toggle('active', descontar);
  if (btnNo) btnNo.classList.toggle('active', !descontar);

  actualizarCajaImpactoPreview();
}

function actualizarCajaImpactoPreview() {
  const hint = $('cajaImpactoHint');
  if (!hint) return;

  const descontar   = $('inputDescontarCaja')?.value !== 'false';
  const costo       = parseFloat($('inputCosto')?.value) || 0;
  const stockActual = parseFloat($('inputStockActual')?.value) || 0;
  const monto       = costo * stockActual;

  if (!descontar) {
    hint.textContent = 'No se afectará tu caja. Úsalo para productos que ya tenías en tu inventario físico antes de empezar a usar el sistema.';
    return;
  }

  hint.textContent = monto > 0
    ? `Se descontará ${fmtMoney(monto)} de tu caja al guardar (costo × cantidad). Úsalo cuando estés comprando este producto ahora.`
    : 'Se registrará un gasto en Caja por el costo total del stock inicial. Úsalo cuando estés comprando este producto ahora.';
}

// ============================================================
// REGISTRAR COMPRA EN CAJA
// Inserta un movimiento EGRESO en movimientos_financieros,
// con la misma lógica/estructura que usa el módulo de Caja
// (saldo_anterior / saldo_resultante como fuente de verdad).
// No depende de caja.js/cajaAPI.js — autocontenido para no
// arriesgar nada del módulo de Caja.
// ============================================================
async function registrarCompraEnCaja(nombreProducto, monto, productoId, cantidad, costoUnitario, sku) {
  try {
    const { data: ultMov } = await supabaseClient
      .from('movimientos_financieros')
      .select('saldo_resultante')
      .eq('auth_user_id', STATE.user.id)
      .eq('estado', 'completado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const saldoAnterior   = ultMov ? Number(ultMov.saldo_resultante) : 0;
    const saldoResultante = saldoAnterior - monto;

    const { data: movInsertado, error } = await supabaseClient.from('movimientos_financieros').insert({
      auth_user_id:       STATE.user.id,
      tipo_flujo:         'EGRESO',
      tipo_movimiento:    'COMPRA',
      concepto:           `Compra de inventario: ${nombreProducto}`,
      monto:               monto,
      saldo_anterior:      saldoAnterior,
      saldo_resultante:    saldoResultante,
      metodo_pago_nombre: 'Efectivo',
      referencia_tipo:    'producto',
      referencia_id:       productoId || null,
      fecha:               ymdLocal(new Date()),
      estado:              'completado',
    }).select('id').single();

    if (error) throw error;

    // También se deja el registro FORMAL en Compras — antes esta
    // compra solo se veía como un movimiento suelto de Caja, y nunca
    // aparecía en el historial ni en los reportes de Compras. Esto es
    // aparte del descuento de Caja de arriba (que ya funcionaba bien)
    // — si esta parte fallara por cualquier motivo, el dinero ya
    // descontado de Caja no se ve afectado, solo faltaría este
    // registro adicional.
    try {
      const { data: numero } = await supabaseClient.rpc('siguiente_numero_compra', { p_user_id: STATE.user.id });
      const { data: compraInsertada, error: errCompra } = await supabaseClient.from('compras').insert({
        auth_user_id:  STATE.user.id,
        numero:        numero || `C-${Date.now()}`,
        fecha:         ymdLocal(new Date()),
        subtotal:      monto,
        total:         monto,
        metodo_pago_nombre: 'Efectivo',
        estado:        'completada',
        observaciones: 'Generada automáticamente al registrar stock inicial de un producto',
        movimiento_caja_id: movInsertado?.id || null,
      }).select('id').single();
      if (errCompra) throw errCompra;

      if (compraInsertada && productoId) {
        await supabaseClient.from('detalle_compras').insert({
          auth_user_id:    STATE.user.id,
          compra_id:       compraInsertada.id,
          producto_id:     productoId,
          producto_nombre: nombreProducto,
          producto_sku:    sku || null,
          cantidad:        cantidad || 1,
          costo_unitario:  costoUnitario != null ? costoUnitario : monto,
          descuento:       0,
          iva_porcentaje:  0,
          iva_monto:       0,
          subtotal:        monto,
          stock_despues:   cantidad || null,
        });
      }
    } catch (eCompra) {
      console.warn('No se pudo crear el registro formal en Compras (el dinero de Caja ya se descontó bien):', eCompra);
    }

    // Mantener sincronizado el caché local que usan dashboard/caja
    try {
      localStorage.setItem('n360_caja', saldoResultante.toString());
      localStorage.setItem('n360_capital', saldoResultante.toString());
      localStorage.setItem('n360_caja_updated', new Date().toISOString());
    } catch (_) { /* silencioso */ }

    return { ok: true, saldoResultante };
  } catch (e) {
    console.warn('registrarCompraEnCaja:', e);
    return { ok: false, error: e.message };
  }
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
  cargarLotesDelProducto(p);

  $('modalProductoTitle').textContent = `Editar: ${p.nombre}`;
  $('btnGuardarProducto').textContent = 'Guardar cambios';
  $('modalProducto').classList.add('open');
}

/* =====================================================
   PRÓXIMOS A VENCER — junta los lotes de TODOS los productos del
   negocio, ordenados por el que vence más pronto primero.
===================================================== */
async function abrirModalProximosVencer() {
  $('modalProximosVencer').classList.add('open');
  cambiarTabLotes('proximos');
  await filtrarProximosVencer(30);
}
function cerrarModalProximosVencer() {
  $('modalProximosVencer').classList.remove('open');
}
function cambiarTabLotes(tab) {
  document.getElementById('tabPróximos').classList.toggle('active', tab === 'proximos');
  document.getElementById('tabTodos').classList.toggle('active', tab === 'todos');
  document.getElementById('panelProximosVencer').style.display = tab === 'proximos' ? '' : 'none';
  document.getElementById('panelTodosLotes').style.display = tab === 'todos' ? '' : 'none';
  if (tab === 'todos') cargarTodosLotes();
}

async function cargarTodosLotes() {
  const cont = document.getElementById('listaTodosLotes');
  cont.innerHTML = 'Cargando…';
  try {
    const { data: lotes } = await supabaseClient.from('producto_lotes')
      .select('*, productos(nombre, sku)')
      .eq('auth_user_id', STATE.user.id).eq('activo', true).gt('cantidad_actual', 0)
      .order('fecha_vencimiento', { ascending: true });

    if (!lotes || !lotes.length) {
      cont.innerHTML = `<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px">Todavía no hay ningún lote registrado. Se agregan al comprar productos desde Compras, o asignándolos a stock que ya tenías desde la ficha de cada producto.</p>`;
      return;
    }

    // Agrupados por producto, para responder justo lo que preguntaste:
    // "qué productos están metidos en esos lotes".
    const porProducto = new Map();
    lotes.forEach(l => {
      const nombre = l.productos?.nombre || 'Producto';
      if (!porProducto.has(nombre)) porProducto.set(nombre, []);
      porProducto.get(nombre).push(l);
    });

    const hoy = new Date(); hoy.setHours(0,0,0,0);
    cont.innerHTML = Array.from(porProducto.entries()).map(([nombre, lotesProd]) => `
      <div style="margin-bottom:14px">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px">${escHtml(nombre)}</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${lotesProd.map(l => {
            const venc = new Date(l.fecha_vencimiento + 'T00:00:00');
            const dias = Math.round((venc - hoy) / 86400000);
            const color = dias < 0 ? 'var(--danger,#dc2626)' : (dias <= 15 ? '#f59e0b' : 'var(--text-primary)');
            return `
              <div style="display:flex;justify-content:space-between;padding:7px 12px;background:var(--bg-app);border-radius:8px;font-size:12.5px">
                <span>${l.numero_lote ? `Lote ${escHtml(l.numero_lote)}` : 'Sin número'} · ${fmtNum(l.cantidad_actual)} unidades</span>
                <span style="color:${color};font-weight:600">${l.fecha_vencimiento}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`).join('');
  } catch (e) {
    console.warn('cargarTodosLotes:', e);
    cont.innerHTML = `<p style="font-size:12.5px;color:var(--danger)">No se pudo cargar la lista.</p>`;
  }
}

async function filtrarProximosVencer(dias) {
  const cont = $('listaProximosVencer');
  cont.innerHTML = 'Cargando…';
  try {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const limite = new Date(hoy); limite.setDate(limite.getDate() + dias);
    const limiteISO = limite.toISOString().slice(0,10);

    const { data: lotes } = await supabaseClient.from('producto_lotes')
      .select('*, productos(nombre, sku)')
      .eq('auth_user_id', STATE.user.id).eq('activo', true).gt('cantidad_actual', 0)
      .lte('fecha_vencimiento', limiteISO)
      .order('fecha_vencimiento', { ascending: true });

    if (!lotes || !lotes.length) {
      cont.innerHTML = `<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px">
        Nada vence en los próximos ${dias >= 9999 ? '' : dias + ' días'} ${dias >= 9999 ? '— sin lotes registrados aún' : ''} 🎉</p>`;
      return;
    }

    cont.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        ${lotes.map(l => {
          const venc = new Date(l.fecha_vencimiento + 'T00:00:00');
          const diasRestantes = Math.round((venc - hoy) / 86400000);
          const vencido = diasRestantes < 0;
          const color = vencido ? 'var(--danger, #dc2626)' : (diasRestantes <= 15 ? '#f59e0b' : 'var(--text-primary)');
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-app);border-left:3px solid ${color};border-radius:8px;font-size:12.5px">
              <div>
                <div style="font-weight:600">${escHtml(l.productos?.nombre || 'Producto')}</div>
                <div style="color:var(--text-muted);font-size:11.5px">${l.numero_lote ? `Lote ${escHtml(l.numero_lote)} · ` : ''}${fmtNum(l.cantidad_actual)} unidades</div>
              </div>
              <span style="color:${color};font-weight:700;white-space:nowrap">${vencido ? 'Vencido' : `${diasRestantes}d`}</span>
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    console.warn('filtrarProximosVencer:', e);
    cont.innerHTML = `<p style="font-size:12.5px;color:var(--danger)">No se pudo cargar la lista.</p>`;
  }
}

/* =====================================================
   LOTES Y VENCIMIENTOS — solo se muestra esta sección si el negocio
   activó la función en Configuración. Es de solo lectura aquí: los
   lotes se crean desde Compras, no se editan desde Productos.
===================================================== */
async function cargarLotesDelProducto(producto) {
  const seccion = $('seccionLotesProducto');
  const lista = $('listaLotesProducto');
  if (!seccion || !lista) return;

  if (STATE.empresa?.maneja_lotes_vencimiento !== true || producto.tipo !== 'producto') {
    seccion.style.display = 'none';
    return;
  }
  seccion.style.display = '';
  lista.innerHTML = 'Cargando…';
  STATE.productoLotesActual = producto;

  try {
    const { data: lotes } = await supabaseClient.from('producto_lotes')
      .select('*').eq('producto_id', producto.id).eq('activo', true).gt('cantidad_actual', 0)
      .order('fecha_vencimiento', { ascending: true });

    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const stockTotal = Number(producto.stock_actual || 0);
    const stockEnLotes = (lotes || []).reduce((s, l) => s + Number(l.cantidad_actual), 0);
    // Stock que ya existía en el sistema antes de activar esta
    // función (o que se agregó por otro lado que no pasa por
    // Compras) — nunca tuvo un lote asignado, así que no aparece en
    // "Próximos a vencer" hasta que alguien le ponga una fecha aquí.
    const stockSinAsignar = Math.max(0, round2(stockTotal - stockEnLotes));

    let htmlLotes = '';
    if (lotes && lotes.length) {
      htmlLotes = `
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:${stockSinAsignar>0?'10px':'0'}">
          ${lotes.map(l => {
            const venc = new Date(l.fecha_vencimiento + 'T00:00:00');
            const diasRestantes = Math.round((venc - hoy) / 86400000);
            let color = 'var(--text-primary)', etiqueta = '';
            if (diasRestantes < 0) { color = 'var(--danger, #dc2626)'; etiqueta = ' — ¡vencido!'; }
            else if (diasRestantes <= 30) { color = '#f59e0b'; etiqueta = ` — vence en ${diasRestantes} día${diasRestantes===1?'':'s'}`; }
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-app);border-radius:8px;font-size:12.5px">
                <span>${l.numero_lote ? `Lote ${escHtml(l.numero_lote)}` : 'Sin número de lote'} · ${fmtNum(l.cantidad_actual)} unidades</span>
                <span style="color:${color};font-weight:600">${l.fecha_vencimiento}${etiqueta}</span>
              </div>`;
          }).join('')}
        </div>`;
    } else if (stockSinAsignar <= 0) {
      htmlLotes = `<p style="font-size:12.5px;color:var(--text-muted)">Sin lotes registrados todavía — se agregan al comprar este producto desde Compras.</p>`;
    }

    // Aviso + formulario para el stock que ya existía antes de tener
    // lotes — mismo espíritu que el "saldo inicial" de Bancos. Ahora
    // con 2 caminos: sumarlo a un lote que ya existe, o crear uno
    // nuevo — igual que se elige en Compras.
    let htmlSinAsignar = '';
    if (stockSinAsignar > 0) {
      const hayLotesExistentes = lotes && lotes.length > 0;
      htmlSinAsignar = `
        <div style="padding:10px 12px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;font-size:12.5px;color:#92400E">
          <div style="margin-bottom:8px">⚠️ ${fmtNum(stockSinAsignar)} unidades de este producto no tienen lote asignado (probablemente ya existían antes de activar esta función) — no van a aparecer en "Próximos a vencer" hasta que las asignes a un lote.</div>

          <div id="formAsignarLoteExistente" style="display:none;margin-top:8px">
            ${hayLotesExistentes ? `
            <div style="display:flex;gap:14px;margin-bottom:10px">
              <label style="cursor:pointer;font-weight:600"><input type="radio" name="modoAsignarLote" value="existente" checked onchange="cambiarModoAsignarLote()"> Agregar a un lote existente</label>
              <label style="cursor:pointer;font-weight:600"><input type="radio" name="modoAsignarLote" value="nuevo" onchange="cambiarModoAsignarLote()"> Crear lote nuevo</label>
            </div>` : ''}

            <div id="subformLoteExistente" style="${hayLotesExistentes ? '' : 'display:none'}">
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
                <div>
                  <label style="font-size:11px;display:block;margin-bottom:3px">¿A cuál lote?</label>
                  <select id="selectLoteExistente" style="padding:5px 8px;border-radius:6px;border:1px solid #F59E0B">
                    ${(lotes||[]).map(l => `<option value="${l.id}">${l.numero_lote ? escHtml(l.numero_lote) : 'Sin número'} · vence ${l.fecha_vencimiento}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;display:block;margin-bottom:3px">Cantidad a sumar</label>
                  <input type="number" id="inputCantidadAgregarExistente" value="${stockSinAsignar}" min="0.01" step="0.01" style="width:90px;padding:5px 8px;border-radius:6px;border:1px solid #F59E0B"/>
                </div>
                <button type="button" class="btn btn-primary btn-sm" onclick="guardarAgregarALoteExistente(${stockSinAsignar})">Guardar</button>
              </div>
            </div>

            <div id="subformLoteNuevo" style="${hayLotesExistentes ? 'display:none' : ''}">
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
                <div>
                  <label style="font-size:11px;display:block;margin-bottom:3px">Cantidad</label>
                  <input type="number" id="inputCantidadLoteExistente" value="${stockSinAsignar}" min="0.01" step="0.01" style="width:90px;padding:5px 8px;border-radius:6px;border:1px solid #F59E0B"/>
                </div>
                <div>
                  <label style="font-size:11px;display:block;margin-bottom:3px">Número de lote (opcional)</label>
                  <input type="text" id="inputNumeroLoteExistente" style="width:130px;padding:5px 8px;border-radius:6px;border:1px solid #F59E0B"/>
                </div>
                <div>
                  <label style="font-size:11px;display:block;margin-bottom:3px">Fecha de vencimiento *</label>
                  <input type="date" id="inputVencimientoLoteExistente" style="padding:5px 8px;border-radius:6px;border:1px solid #F59E0B"/>
                </div>
                <button type="button" class="btn btn-primary btn-sm" onclick="guardarLoteStockExistente(${stockSinAsignar})">Guardar</button>
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btnMostrarFormLoteExistente" onclick="document.getElementById('formAsignarLoteExistente').style.display='';this.style.display='none'">+ Asignar este stock a un lote</button>
        </div>`;
    }

    lista.innerHTML = htmlLotes + htmlSinAsignar;
  } catch (e) {
    console.warn('cargarLotesDelProducto:', e);
    lista.innerHTML = `<p style="font-size:12.5px;color:var(--danger)">No se pudieron cargar los lotes.</p>`;
  }
}

function cambiarModoAsignarLote() {
  const modo = document.querySelector('input[name="modoAsignarLote"]:checked')?.value;
  document.getElementById('subformLoteExistente').style.display = modo === 'existente' ? '' : 'none';
  document.getElementById('subformLoteNuevo').style.display = modo === 'nuevo' ? '' : 'none';
}

/* Suma la cantidad indicada a un lote que YA existe (no crea uno
   nuevo). Nunca deja pasar más de lo que realmente hay sin asignar
   — antes esto no se validaba y se podía "inventar" stock que no
   existía de verdad. */
async function guardarAgregarALoteExistente(stockSinAsignarMax) {
  const loteId = $('selectLoteExistente')?.value;
  const cantidad = parseFloat($('inputCantidadAgregarExistente')?.value);

  if (!loteId) { showToast('error', 'Falta elegir', 'Elige a cuál lote agregar.'); return; }
  if (!cantidad || cantidad <= 0) { showToast('error', 'Cantidad inválida', 'Indica una cantidad mayor a cero.'); return; }
  if (cantidad > stockSinAsignarMax + 0.001) {
    showToast('error', 'Cantidad demasiado alta', `Solo hay ${fmtNum(stockSinAsignarMax)} unidades sin asignar — no se puede inventar más stock del que realmente existe.`);
    return;
  }

  try {
    const { data: loteActual, error: errGet } = await supabaseClient.from('producto_lotes')
      .select('cantidad_actual, cantidad_inicial').eq('id', loteId).single();
    if (errGet) throw errGet;

    const { error } = await supabaseClient.from('producto_lotes').update({
      cantidad_actual: Number(loteActual.cantidad_actual) + cantidad,
      cantidad_inicial: Number(loteActual.cantidad_inicial) + cantidad,
      updated_at: new Date().toISOString(),
    }).eq('id', loteId);
    if (error) throw error;

    showToast('success', 'Stock agregado', 'Se sumó correctamente al lote elegido.');
    await cargarLotesDelProducto(STATE.productoLotesActual);
  } catch (e) {
    console.warn('guardarAgregarALoteExistente:', e);
    showToast('error', 'No se pudo guardar', 'Intenta de nuevo.');
  }
}

/* Asigna un lote/vencimiento a stock que YA existía en el producto
   antes de tener control de lotes — a diferencia de Compras, esto
   NUNCA suma al stock_actual (esas unidades ya estaban contadas),
   solo les pone la etiqueta de fecha que les faltaba. */
async function guardarLoteStockExistente(stockSinAsignarMax) {
  const producto = STATE.productoLotesActual;
  if (!producto) return;

  const cantidad = parseFloat($('inputCantidadLoteExistente')?.value);
  const numeroLote = $('inputNumeroLoteExistente')?.value.trim() || null;
  const fechaVencimiento = $('inputVencimientoLoteExistente')?.value;

  if (!fechaVencimiento) { showToast('error', 'Falta la fecha', 'Indica la fecha de vencimiento.'); return; }
  if (!cantidad || cantidad <= 0) { showToast('error', 'Cantidad inválida', 'Indica una cantidad mayor a cero.'); return; }
  if (cantidad > stockSinAsignarMax + 0.001) {
    showToast('error', 'Cantidad demasiado alta', `Solo hay ${fmtNum(stockSinAsignarMax)} unidades sin asignar — no se puede inventar más stock del que realmente existe.`);
    return;
  }

  try {
    const { error } = await supabaseClient.from('producto_lotes').insert({
      auth_user_id: STATE.user.id,
      producto_id: producto.id,
      numero_lote: numeroLote,
      fecha_vencimiento: fechaVencimiento,
      cantidad_inicial: cantidad,
      cantidad_actual: cantidad,
      costo_unitario: producto.costo || null,
    });
    if (error) throw error;
    showToast('success', 'Lote asignado', 'Se asignó correctamente al stock existente.');
    await cargarLotesDelProducto(producto);
  } catch (e) {
    console.warn('guardarLoteStockExistente:', e);
    showToast('error', 'No se pudo guardar', 'Intenta de nuevo.');
  }
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

  // Solo mostrar stock (y el toggle de impacto en caja, que vive dentro)
  // si es producto Y estamos en modo creación/duplicación
  if (stockSection) {
    const mostrar = tipo === 'producto' && STATE.modalMode !== 'editar';
    stockSection.style.display = mostrar ? '' : 'none';
  }

  // Materia prima solo tiene sentido para productos (los servicios no
  // manejan stock) -- se oculta en ambos modos, crear y editar.
  const wrapMP = $('wrapMateriaPrima');
  const wrapMPEdit = $('wrapMateriaPrimaEdit');
  if (wrapMP) wrapMP.style.display = tipo === 'producto' ? '' : 'none';
  if (wrapMPEdit) wrapMPEdit.style.display = tipo === 'producto' ? '' : 'none';

  if (btnProd) btnProd.disabled = !habilitarToggle;
  if (btnServ) btnServ.disabled = !habilitarToggle;
}

/* ============================================================
   CÓDIGO DE BARRAS — modo "Escanear"
   El input ya admite escritura manual normalmente. Este modo solo
   agrega una ayuda visual + evita que el Enter del lector dispare
   el guardado accidental del formulario completo.
   ============================================================ */
let cbModoEscaneo = false;

function toggleModoEscaneoCB() {
  const input = $('inputCodBarras');
  const btn   = $('btnEscanearCB');
  const label = $('btnEscanearCBLabel');
  const hint  = $('cbScanHint');
  if (!input) return;

  cbModoEscaneo = !cbModoEscaneo;

  if (cbModoEscaneo) {
    btn?.classList.add('scanning');
    if (label) label.textContent = 'Cancelar';
    if (hint) hint.style.display = 'block';
    input.value = '';
    input.focus();
  } else {
    btn?.classList.remove('scanning');
    if (label) label.textContent = 'Escanear';
    if (hint) hint.style.display = 'none';
  }
}

function initEscaneoCodigoBarras() {
  const input = $('inputCodBarras');
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // Nunca dejar que el Enter del lector (o del teclado) llegue al
    // listener del <form> y dispare guardarProducto() sin querer.
    e.preventDefault();
    e.stopPropagation();
    if (cbModoEscaneo) {
      if (input.value.trim()) {
        showToast?.('✅ Código capturado', 'success');
        toggleModoEscaneoCB();
        // Pasar el foco al siguiente campo lógico del formulario
        $('inputCosto')?.focus();
      }
    } else {
      // Modo manual: Enter simplemente confirma el campo, no guarda todo el form
      input.blur();
    }
  });
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
  // Tipo de precio: por defecto siempre "Precio fijo" (comportamiento actual)
  STATE.formEscalas = [];
  setTipoPrecio('fijo');
  renderEscalasEditor();
  // Por defecto: "Descontar de caja" (caso más común — compra nueva)
  setCajaImpacto(true);
  // Fecha de creación: hoy por defecto, pero editable — útil cuando el
  // producto ya existía antes de usar el sistema (inventario histórico).
  const inputFecha = $('inputFechaCreacion');
  if (inputFecha) inputFecha.value = ymdLocal(new Date());
}

function cargarFormulario(p) {
  const campos = [
    ['inputNombre',          p.nombre        || ''],
    ['inputDescripcion',     p.descripcion   || ''],
    ['inputCategoria',       p.categoria     || ''],
    ['inputMarca',           p.proveedor_id  || ''],
    ['inputSku',             p.sku           || ''],
    ['inputCodBarras',       p.codigo_barras || ''],
    ['inputCosto',           p.costo         ?? ''],
    ['inputPrecio',          p.precio        ?? ''],
    ['inputStockMinimo',     p.stock_minimo  ?? ''],
    ['inputStockMinimoEdit', p.stock_minimo  ?? ''],
    ['inputStockActualEdit', p.stock_actual  ?? ''],
    ['inputGarantiaMeses',     p.garantia_meses ?? ''],
    ['inputGarantiaMesesEdit', p.garantia_meses ?? ''],
    ['inputActivo',          p.activo ? 'true' : 'false'],
  ];
  campos.forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
  });

  // Materia prima: checkbox real, se maneja aparte (.checked, no .value)
  const esMP = p.es_materia_prima === true;
  if ($('inputEsMateriaPrima')) $('inputEsMateriaPrima').checked = esMP;
  if ($('inputEsMateriaPrimaEdit')) $('inputEsMateriaPrimaEdit').checked = esMP;

  // Tipo de precio + escalas (si el producto ya tiene alguna configurada)
  const escalasExistentes = STATE.escalasPorProducto[p.id] || [];
  STATE.formEscalas = escalasExistentes.map(e => ({ nombre: e.nombre, precio: e.precio }));
  setTipoPrecio(p.tipo_precio === 'escala' ? 'escala' : 'fijo');
  renderEscalasEditor();

  // Fecha de creación: editable, para poder corregirla cuando el producto
  // ya existía antes de usar el sistema (no siempre coincide con "hoy").
  // Al duplicar, se trata como producto nuevo: por defecto hoy, no la
  // fecha del original (igual se puede corregir a mano si hace falta).
  const inputFecha = $('inputFechaCreacion');
  if (inputFecha) {
    inputFecha.value = (p.created_at && STATE.modalMode !== 'duplicar')
      ? new Date(p.created_at).toISOString().slice(0, 10)
      : ymdLocal(new Date());
  }
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
  const proveedorId = ($('inputMarca')?.value || '').trim() || null;
  const proveedorNombre = proveedorId
    ? (STATE.proveedores.find(pr => pr.id === proveedorId)?.nombre || null)
    : null;
  const sku         = ($('inputSku')?.value || '').trim();
  const codBarras   = ($('inputCodBarras')?.value || '').trim();
  const costoRaw    = $('inputCosto')?.value;
  const precioRaw   = $('inputPrecio')?.value;
  const costo       = costoRaw  !== '' ? parseFloat(costoRaw)  : 0;
  const precio      = precioRaw !== '' ? parseFloat(precioRaw) : 0;
  const tipoPrecio  = $('inputTipoPrecio')?.value === 'escala' ? 'escala' : 'fijo';
  const activoVal   = $('inputActivo')?.value;
  const activo      = activoVal === 'true';
  const fechaCreacionRaw = ($('inputFechaCreacion')?.value || '').trim(); // yyyy-mm-dd

  const errEscalas = $('errEscalas');
  if (errEscalas) errEscalas.textContent = '';
  if (tipoPrecio === 'escala') {
    const escalasValidas = STATE.formEscalas.filter(f => (f.nombre || '').trim());
    if (!escalasValidas.length) {
      if (errEscalas) errEscalas.textContent = 'Agrega al menos un precio en la escala';
      return;
    }
  }

  // Stock mínimo: usar el campo visible según el modo
  const stockMinimoEl  = STATE.modalMode === 'editar' ? $('inputStockMinimoEdit') : $('inputStockMinimo');
  const stockMinimoRaw = stockMinimoEl?.value;
  const stockMinimo    = stockMinimoRaw !== '' && stockMinimoRaw !== undefined
    ? parseFloat(stockMinimoRaw)
    : 0;

  // Garantía en meses (opcional) — igual criterio: campo visible según el modo
  const garantiaEl  = STATE.modalMode === 'editar' ? $('inputGarantiaMesesEdit') : $('inputGarantiaMeses');
  const garantiaRaw = garantiaEl?.value;
  const garantiaMeses = (garantiaRaw !== '' && garantiaRaw !== undefined) ? parseFloat(garantiaRaw) : null;

  // Materia prima: checkbox visible según el modo
  const esMateriaPrimaEl = STATE.modalMode === 'editar' ? $('inputEsMateriaPrimaEdit') : $('inputEsMateriaPrima');
  const esMateriaPrima = esMateriaPrimaEl?.checked === true;

  // Stock actual: usar el campo visible según el modo. En edición ahora
  // también es editable directamente (antes solo se podía desde
  // Movimientos especiales); ese botón se mantiene igual para bajas
  // con motivo registrado y descuento de caja.
  const stockActualEl  = STATE.modalMode === 'editar' ? $('inputStockActualEdit') : $('inputStockActual');
  const stockActualRaw = stockActualEl?.value;
  const stockActual     = stockActualRaw !== '' && stockActualRaw !== undefined
    ? parseFloat(stockActualRaw)
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
    let cajaInfo = null; // { montoDescontado } si se registró movimiento de caja
    let productoIdGuardado = null;

    if (STATE.modalMode === 'crear' || STATE.modalMode === 'duplicar') {
      const payload = {
        auth_user_id:  STATE.user.id,
        tipo,
        nombre,
        descripcion:   descripcion || null,
        categoria:     categoria   || null,
        proveedor_id:      proveedorId,
        proveedor_nombre:  proveedorNombre,
        sku:           sku         || null,
        codigo_barras: codBarras   || null,
        costo:         isNaN(costo)       ? 0 : costo,
        precio:        tipoPrecio === 'escala' ? 0 : (isNaN(precio) ? 0 : precio),
        tipo_precio:   tipoPrecio,
        stock_actual:  tipo === 'producto' ? (isNaN(stockActual) ? 0 : stockActual) : 0,
        stock_minimo:  tipo === 'producto' ? (isNaN(stockMinimo) ? 0 : stockMinimo) : 0,
        garantia_meses: garantiaMeses,
        es_materia_prima: esMateriaPrima,
        activo,
      };
      // Fecha de creación manual (producto que ya existía antes del sistema).
      // Si el usuario no la tocó, queda con el default de la base de datos.
      // FIX: antes se guardaba la fecha "pelada" (ej. "2026-07-08"), y
      // Postgres la interpreta como medianoche UTC. En Nicaragua (UTC-6)
      // esa medianoche cae en las 6:00 PM del día ANTERIOR hora local, así
      // que al mostrarla se veía un día atrás (8 de julio → aparecía 7).
      // Anclando a las 12:00 del mediodía UTC, la fecha elegida se mantiene
      // igual sin importar la zona horaria de quien la vea.
      if (fechaCreacionRaw) payload.created_at = fechaCreacionRaw + 'T12:00:00Z';

      let res = await supabaseClient.from('productos').insert([payload]).select();
      if (res.error && fechaCreacionRaw) {
        // Reintentar sin la fecha manual, por si la columna no la acepta en este entorno
        const { created_at, ...payloadSinFecha } = payload;
        res = await supabaseClient.from('productos').insert([payloadSinFecha]).select();
      }
      error = res.error;
      productoIdGuardado = Array.isArray(res.data) && res.data[0] ? res.data[0].id : null;

      // Impacto en caja: solo para productos con costo × cantidad > 0,
      // y solo si el usuario eligió "Descontar de caja"
      if (!error && tipo === 'producto') {
        const descontarCaja = $('inputDescontarCaja')?.value !== 'false';
        const montoCompra   = (isNaN(costo) ? 0 : costo) * (isNaN(stockActual) ? 0 : stockActual);

        if (descontarCaja && montoCompra > 0) {
          const insertedId = Array.isArray(res.data) && res.data[0] ? res.data[0].id : null;
          const resultCaja = await registrarCompraEnCaja(nombre, montoCompra, insertedId, stockActual, costo, payload.sku);
          if (resultCaja.ok) cajaInfo = { montoDescontado: montoCompra };
        }
      }

    } else if (STATE.modalMode === 'editar' && STATE.editTarget) {
      // En edición: el stock actual ahora SÍ se puede ajustar directamente
      // desde aquí. "Movimientos especiales" se mantiene intacto para bajas
      // con motivo (robo, daño, merma, etc.) que además pueden descontar
      // de caja automáticamente — ese flujo no cambia.
      const stockAntes = parseFloat(STATE.editTarget.stock_actual ?? 0);

      const updatePayload = {
        tipo,
        nombre,
        descripcion:   descripcion || null,
        categoria:     categoria   || null,
        proveedor_id:      proveedorId,
        proveedor_nombre:  proveedorNombre,
        sku:           sku         || null,
        codigo_barras: codBarras   || null,
        costo:         isNaN(costo)  ? 0 : costo,
        precio:        tipoPrecio === 'escala' ? 0 : (isNaN(precio) ? 0 : precio),
        tipo_precio:   tipoPrecio,
        stock_minimo:  tipo === 'producto' ? (isNaN(stockMinimo) ? 0 : stockMinimo) : null,
        garantia_meses: garantiaMeses,
        es_materia_prima: esMateriaPrima,
        activo,
      };
      // Solo tocar stock_actual para productos (los servicios no manejan stock)
      if (tipo === 'producto') {
        updatePayload.stock_actual = isNaN(stockActual) ? 0 : stockActual;
      }
      // Fecha de creación corregible a mano (ej: producto que ya existía
      // antes del sistema y quedó registrado con la fecha de "hoy").
      // FIX: mismo anclaje a mediodía UTC que en creación, ver nota arriba.
      if (fechaCreacionRaw) updatePayload.created_at = fechaCreacionRaw + 'T12:00:00Z';

      let res = await supabaseClient
        .from('productos')
        .update(updatePayload)
        .eq('id', STATE.editTarget.id)
        .eq('auth_user_id', STATE.user.id);
      if (res.error && fechaCreacionRaw) {
        // Reintentar sin la fecha manual, por si la columna no la acepta en este entorno
        const { created_at, ...updateSinFecha } = updatePayload;
        res = await supabaseClient
          .from('productos')
          .update(updateSinFecha)
          .eq('id', STATE.editTarget.id)
          .eq('auth_user_id', STATE.user.id);
      }
      error = res.error;
      productoIdGuardado = STATE.editTarget.id;

      // Dejar rastro del ajuste manual de stock (auditoría), igual que hacen
      // los Movimientos especiales. Si la tabla no existe o falla, no se
      // interrumpe el guardado del producto — solo se registra en consola.
      if (!error && tipo === 'producto' && updatePayload.stock_actual !== undefined
          && updatePayload.stock_actual !== stockAntes) {
        try {
          await supabaseClient.from('movimientos_inventario').insert([{
            auth_user_id:   STATE.user.id,
            producto_id:    STATE.editTarget.id,
            tipo:           'ajuste_manual',
            razon:          'edicion_producto',
            cantidad:       updatePayload.stock_actual - stockAntes,
            stock_antes:    stockAntes,
            stock_despues:  updatePayload.stock_actual,
            nota:           'Editado directamente desde el formulario de producto',
            descuenta_caja: false,
          }]);
        } catch (_) {
          console.warn('Tabla movimientos_inventario no disponible aún');
        }
      }
    }

    if (error) throw error;

    // Sincronizar escalas de precio (crea/actualiza/elimina filas según corresponda).
    // Si falla, el producto YA quedó guardado — solo se avisa, no se revierte nada.
    if (productoIdGuardado) {
      try {
        await sincronizarEscalas(productoIdGuardado, tipoPrecio === 'escala' ? STATE.formEscalas : []);
      } catch (eEscalas) {
        console.error('sincronizarEscalas:', eEscalas);
        showToast('warning', 'Producto guardado', 'No se pudieron guardar los precios de la escala, intenta editarlo de nuevo.');
      }
    }

    cerrarModalProducto();
    showToast(
      'success',
      STATE.modalMode === 'editar' ? 'Producto actualizado' : 'Producto creado',
      cajaInfo ? `${nombre} · Se descontó ${fmtMoney(cajaInfo.montoDescontado)} de caja` : nombre
    );
    // Importante: primero las escalas y DESPUÉS los productos —
    // cargarProductos() dibuja la tabla de inmediato, así que si corriera
    // en paralelo con cargarEscalas() podría pintar la tabla con el mapa
    // de escalas todavía viejo (por eso aparecía "Sin precios configurados"
    // hasta editar y volver a guardar).
    await cargarEscalas();
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
        <div class="detail-label">Marca / Proveedor</div>
        <div class="detail-value">${p.proveedor_nombre ? `🏷️ ${escHtml(p.proveedor_nombre)}` : '—'}</div>
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
      ${p.tipo_precio === 'escala' ? `
      <div class="detail-item full">
        <div class="detail-label">Escala de precios</div>
        <div class="detail-value">
          ${(STATE.escalasPorProducto[p.id] || []).map(e => `
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
              <span>${escHtml(e.nombre)}</span>
              <span style="font-weight:700;color:var(--accent)">${fmtMoney(e.precio)}</span>
            </div>`).join('') || '<span style="color:var(--text-muted)">Sin precios configurados</span>'}
        </div>
      </div>
      ` : `
      <div class="detail-item">
        <div class="detail-label">Precio de Venta</div>
        <div class="detail-value detail-money" style="color:var(--accent)">${fmtMoney(p.precio)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Margen</div>
        <div class="detail-value">${margenHtml}</div>
      </div>
      `}
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
/* ---------- Eliminar producto (individual, con confirmación) ---------- */
async function confirmarEliminarProducto(id) {
  const p = STATE.productos.find(x => x.id === id);
  if (!p) return;

  // Aviso extra si el producto está metido dentro de algún combo — borrarlo
  // rompería ese combo en silencio (la relación se elimina en cascada).
  let advertenciaCombo = '';
  try {
    const { data: enCombos } = await supabaseClient
      .from('combo_items').select('combos(nombre)').eq('producto_id', id);
    const nombresCombos = [...new Set((enCombos || []).map(it => it.combos?.nombre).filter(Boolean))];
    if (nombresCombos.length) {
      advertenciaCombo = `\n\n⚠️ Este producto forma parte de: ${nombresCombos.join(', ')}. Si lo eliminas, se quitará también de ese/esos combo(s).`;
    }
  } catch (e) { /* si falla esta verificación, se sigue con la confirmación normal */ }

  const confirmado = confirm(
    `¿Eliminar "${p.nombre}" definitivamente?\n\nRestará su valor del inventario. Su historial en Compras y Créditos se conserva (con su nombre y datos tal como quedaron), esta acción solo no se puede deshacer para el producto en sí.${advertenciaCombo}`
  );
  if (!confirmado) return;

  try {
    const { error } = await supabaseClient.from('productos').delete()
      .eq('id', id).eq('auth_user_id', STATE.user.id);
    if (error) throw error;
    showToast('success', 'Producto eliminado', `"${p.nombre}" se eliminó correctamente.`);
    await cargarProductos(); // recarga la lista y recalcula el valor de inventario
  } catch (e) {
    console.error('confirmarEliminarProducto:', e);
    showToast('error', 'Error al eliminar', e.message || 'Intenta de nuevo.');
  }
}

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
  actualizarCajaImpactoPreview();

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
          fecha:        ymdLocal(new Date()),
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
  initBusquedaGrupoPromocion();

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

  const ordenSelect = $('ordenProductos');
  if (ordenSelect) {
    ordenSelect.addEventListener('change', (e) => {
      STATE.ordenActivo = e.target.value;
      aplicarFiltros();
    });
  }

  const comboSearchInput = $('comboSearchInput');
  const comboSearchClear = $('comboSearchClear');
  if (comboSearchInput) {
    comboSearchInput.addEventListener('input', (e) => {
      STATE.comboBusqueda = e.target.value;
      if (comboSearchClear) comboSearchClear.classList.toggle('visible', STATE.comboBusqueda.length > 0);
      aplicarFiltrosCombos();
    });
  }
  if (comboSearchClear) {
    comboSearchClear.addEventListener('click', () => {
      if (comboSearchInput) comboSearchInput.value = '';
      STATE.comboBusqueda = '';
      comboSearchClear.classList.remove('visible');
      aplicarFiltrosCombos();
    });
  }
  const ordenCombosSelect = $('ordenCombos');
  if (ordenCombosSelect) {
    ordenCombosSelect.addEventListener('change', (e) => {
      STATE.comboOrden = e.target.value;
      aplicarFiltrosCombos();
    });
  }

  // Buscador de ESCANEO: exclusivo para el lector de código de barras
  // (o escribiéndolo a mano + Enter). Busca coincidencia exacta y filtra
  // la tabla a ese producto — nunca toca ni interfiere con el buscador
  // de nombre/SKU de arriba.
  const scanInput = $('scanInput');
  const scanClear = $('scanClear');
  if (scanInput) {
    scanInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const codigo = scanInput.value.trim();
      if (!codigo) return;

      const encontrado = STATE.productos.find(p => (p.codigo_barras || '').trim() === codigo);
      if (!encontrado) {
        showToast('warning', 'No encontrado', `Ningún producto tiene el código "${codigo}"`);
        scanInput.select();
        return;
      }

      // Reutiliza el mismo buscador de nombre/SKU de arriba para filtrar
      // la tabla — así no se duplica lógica de filtrado.
      if (searchInput) searchInput.value = encontrado.nombre;
      STATE.busqueda = encontrado.nombre;
      if (searchClear) searchClear.classList.add('visible');
      aplicarFiltros();

      showToast('success', 'Encontrado', encontrado.nombre);
      scanInput.value = '';
      scanClear?.classList.remove('visible');
    });
    scanInput.addEventListener('input', () => {
      scanClear?.classList.toggle('visible', scanInput.value.length > 0);
    });
  }
  if (scanClear) {
    scanClear.addEventListener('click', () => {
      if (scanInput) scanInput.value = '';
      scanClear.classList.remove('visible');
      scanInput?.focus();
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

  const filtroMarca = $('filtroMarca');
  if (filtroMarca) {
    filtroMarca.addEventListener('change', (e) => {
      STATE.filtroMarca = e.target.value;
      aplicarFiltros();
    });
  }

  const btnProd = $('toggleProducto');
  const btnServ = $('toggleServicio');
  if (btnProd) btnProd.addEventListener('click', () => setTipoModal('producto', true));
  if (btnServ) btnServ.addEventListener('click', () => setTipoModal('servicio', true));

  // Toggle de impacto en caja (nuevo producto)
  const btnDescontarCaja   = $('toggleDescontarCaja');
  const btnNoDescontarCaja = $('toggleNoDescontarCaja');
  if (btnDescontarCaja)   btnDescontarCaja.addEventListener('click', () => setCajaImpacto(true));
  if (btnNoDescontarCaja) btnNoDescontarCaja.addEventListener('click', () => setCajaImpacto(false));

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

  // Código de barras: modo escaneo (ver initEscaneoCodigoBarras)
  initEscaneoCodigoBarras();

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

  // Actualizar preview de caja cuando cambia el costo (el stock ya
  // dispara actualizarCajaImpactoPreview() vía oninput en el HTML)
  const inputCostoEl = $('inputCosto');
  if (inputCostoEl) inputCostoEl.addEventListener('input', actualizarCajaImpactoPreview);
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
// FIX: cargar moneda/empresa ANTES de cargar productos.
//      Antes ambas corrían en Promise.all (en paralelo), lo que
//      generaba una condición de carrera: si cargarProductos()
//      terminaba primero, actualizarStats() -> fmtMoney() usaba
//      el símbolo por defecto ('$' / USD) en vez de la moneda
//      configurada (ej. 'C$' / NIO), provocando el bug aleatorio
//      al recargar la página.
// ============================================================
/* ============================================================
   PROMOCIONES — reglas que Ventas aplica solas, distinto de un
   Combo (que es un producto fijo con un solo precio). Aquí solo se
   define/administra la regla; la lógica de APLICARLA vive en
   Ventas, en su propio archivo, para no arriesgar nada de aquí.
   ============================================================ */
STATE.promociones = STATE.promociones || [];
STATE.grupoPromocionActual = STATE.grupoPromocionActual || []; // [{id, nombre}]

async function cargarPromociones() {
  const tbody = $('promosTbody');
  try {
    const { data, error } = await supabaseClient
      .from('promociones')
      .select('*, promocion_productos(producto_id)')
      .eq('auth_user_id', STATE.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    STATE.promociones = data || [];
    renderPromociones();
  } catch (e) {
    console.error('cargarPromociones:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--danger)">No se pudieron cargar las promociones.</td></tr>`;
  }
}

const TIPO_PROMO_LABEL = {
  nxm_mismo: '2x1 — mismo producto',
  nxm_grupo: '2x1 — varios productos',
  regalo: 'Compra 1, lleva otro gratis',
  descuento_cantidad: 'Descuento por cantidad',
};

function detallePromocion(p) {
  const prod = (id) => STATE.productos.find(x => x.id === id)?.nombre || '—';
  switch (p.tipo) {
    case 'nxm_mismo':
      return `${prod(p.producto_id)} — compra ${p.n_compra}, paga ${p.m_paga}`;
    case 'nxm_grupo': {
      const n = (p.promocion_productos || []).length;
      return `${n} producto${n===1?'':'s'} en el grupo — compra ${p.n_compra}, paga ${p.m_paga}`;
    }
    case 'regalo':
      return `Compra ${p.cantidad_disparador} de "${prod(p.producto_disparador_id)}" → gratis "${prod(p.producto_regalo_id)}"${Number(p.precio_regalo)>0?` (${fmtMoney(p.precio_regalo)})`:''}`;
    case 'descuento_cantidad':
      return `${prod(p.producto_id)} — ${p.descuento_porcentaje}% desde ${p.cantidad_minima} unidades`;
    default: return '—';
  }
}

function vigenciaPromocion(p) {
  if (!p.fecha_inicio && !p.fecha_fin) return 'Sin vencimiento';
  const ini = p.fecha_inicio ? new Date(p.fecha_inicio+'T00:00:00').toLocaleDateString('es-NI',{day:'2-digit',month:'short'}) : '—';
  const fin = p.fecha_fin ? new Date(p.fecha_fin+'T00:00:00').toLocaleDateString('es-NI',{day:'2-digit',month:'short'}) : '—';
  return `${ini} → ${fin}`;
}

// Mismo cálculo ya usado en Ventas — para nxm_grupo no hay un precio
// único (depende de qué elija el cajero al vender), así que ahí se
// muestra un guión en vez de un número.
function precioVitrinaPromo(p) {
  // Si el negocio puso un precio fijo, ese manda siempre — el cálculo
  // automático de abajo solo sirve como respaldo cuando no se definió.
  if (p.precio_promocion !== null && p.precio_promocion !== undefined) {
    return fmtMoney(Number(p.precio_promocion));
  }
  const precioDe = (prod) => {
    if (!prod) return null;
    if (prod.tipo_precio === 'escala') {
      const escalas = STATE.escalasPorProducto?.[prod.id] || [];
      return escalas.length ? Number(escalas[0].precio || 0) : null;
    }
    return Number(prod.precio || 0);
  };
  if (p.tipo === 'nxm_mismo') {
    const prod = STATE.productos.find(x => x.id === p.producto_id);
    const precio = precioDe(prod);
    return precio === null ? '—' : fmtMoney(precio * p.m_paga);
  }
  if (p.tipo === 'descuento_cantidad') {
    const prod = STATE.productos.find(x => x.id === p.producto_id);
    const precio = precioDe(prod);
    return precio === null ? '—' : fmtMoney(round2(precio * p.cantidad_minima * (1 - Number(p.descuento_porcentaje||0)/100)));
  }
  if (p.tipo === 'regalo') {
    const disparador = STATE.productos.find(x => x.id === p.producto_disparador_id);
    const precio = precioDe(disparador);
    return precio === null ? '—' : fmtMoney(precio * p.cantidad_disparador + Number(p.precio_regalo || 0));
  }
  return '<span style="color:var(--text-muted)">según lo elegido</span>';
}

function renderPromociones() {
  const tbody = $('promosTbody');
  const countEl = $('promosCount');
  if (countEl) countEl.textContent = `${STATE.promociones.length} promoción${STATE.promociones.length===1?'':'es'}`;
  if (!tbody) return;

  if (!STATE.promociones.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">Aún no has creado ninguna promoción.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.promociones.map(p => `
    <tr>
      <td><strong>${escHtml(p.nombre)}</strong></td>
      <td>${escHtml(TIPO_PROMO_LABEL[p.tipo] || p.tipo)}</td>
      <td style="font-size:12.5px;color:var(--text-muted)">${escHtml(detallePromocion(p))}</td>
      <td style="font-weight:700;color:var(--accent)">${precioVitrinaPromo(p)}</td>
      <td style="font-size:12.5px">${escHtml(vigenciaPromocion(p))}</td>
      <td><span class="status-badge ${p.activo?'status-activo':'status-inactivo'}" style="cursor:pointer" onclick="togglePromocionActiva('${p.id}', ${!p.activo})">${p.activo?'Activa':'Pausada'}</span></td>
      <td>
        <button class="row-action-btn" title="Editar" onclick="abrirModalPromocion('${p.id}')">✏️</button>
        <button class="row-action-btn" title="Eliminar" onclick="eliminarPromocion('${p.id}')" style="color:var(--danger)">🗑️</button>
      </td>
    </tr>
  `).join('');
}

async function togglePromocionActiva(id, nuevoValor) {
  try {
    const { error } = await supabaseClient.from('promociones').update({ activo: nuevoValor, updated_at: new Date().toISOString() })
      .eq('id', id).eq('auth_user_id', STATE.user.id);
    if (error) throw error;
    showToast('success', nuevoValor ? 'Promoción activada' : 'Promoción pausada', '');
    await cargarPromociones();
  } catch (e) {
    console.error('togglePromocionActiva:', e);
    showToast('error', 'No se pudo actualizar', '');
  }
}

async function eliminarPromocion(id) {
  if (!confirm('¿Eliminar esta promoción? Esta acción no se puede deshacer.')) return;
  try {
    const { error } = await supabaseClient.from('promociones').delete().eq('id', id).eq('auth_user_id', STATE.user.id);
    if (error) throw error;
    showToast('success', 'Promoción eliminada', '');
    await cargarPromociones();
  } catch (e) {
    console.error('eliminarPromocion:', e);
    showToast('error', 'No se pudo eliminar', '');
  }
}

function llenarSelectsProductosPromocion() {
  const opciones = STATE.productos.filter(p => p.activo).map(p => {
    const esEscala = p.tipo_precio === 'escala';
    const precioTexto = esEscala
      ? `📊 ${fmtRangoEscala(STATE.escalasPorProducto[p.id])}`
      : fmtMoney(p.precio);
    return `<option value="${p.id}">${escHtml(p.nombre)} — ${precioTexto}</option>`;
  }).join('');
  ['pm-producto-nxm','pm-producto-disparador','pm-producto-regalo','pm-producto-descuento'].forEach(id => {
    const sel = $(id);
    if (sel) sel.innerHTML = opciones;
  });
}

function onCambioProductoRegalo() {
  const id = $('pm-producto-regalo').value;
  const prod = STATE.productos.find(p => p.id === id);
  const nota = $('pm-nota-escala-regalo');
  if (nota) nota.style.display = (prod && prod.tipo_precio === 'escala') ? '' : 'none';
}

function onCambioTipoPromocion() {
  const tipo = $('pm-tipo').value;
  $('pm-bloque-nxm-mismo').style.display   = tipo === 'nxm_mismo' ? '' : 'none';
  $('pm-bloque-nxm-grupo').style.display   = tipo === 'nxm_grupo' ? '' : 'none';
  $('pm-bloque-regalo').style.display      = tipo === 'regalo' ? '' : 'none';
  $('pm-bloque-descuento').style.display   = tipo === 'descuento_cantidad' ? '' : 'none';
}

function abrirModalPromocion(id) {
  $('pm-error').textContent = '';
  $('pm-id').value = id || '';
  llenarSelectsProductosPromocion();
  STATE.grupoPromocionActual = [];
  $('pm-grupo-resultados').innerHTML = '';
  $('pm-buscar-grupo').value = '';

  if (id) {
    const p = STATE.promociones.find(x => x.id === id);
    if (!p) return;
    $('modalPromocionTitle').textContent = '✏️ Editar promoción';
    $('pm-nombre').value = p.nombre;
    $('pm-tipo').value = p.tipo;
    $('pm-fecha-inicio').value = p.fecha_inicio || '';
    $('pm-fecha-fin').value = p.fecha_fin || '';
    $('pm-precio-promocion').value = (p.precio_promocion !== null && p.precio_promocion !== undefined) ? p.precio_promocion : '';
    $('pm-garantia-meses').value = (p.garantia_meses !== null && p.garantia_meses !== undefined) ? p.garantia_meses : '';

    if (p.tipo === 'nxm_mismo') {
      $('pm-producto-nxm').value = p.producto_id || '';
      $('pm-n-compra').value = p.n_compra || 2;
      $('pm-m-paga').value = p.m_paga || 1;
    } else if (p.tipo === 'nxm_grupo') {
      $('pm-n-compra-grupo').value = p.n_compra || 2;
      $('pm-m-paga-grupo').value = p.m_paga || 1;
      STATE.grupoPromocionActual = (p.promocion_productos || []).map(pp => {
        const prod = STATE.productos.find(x => x.id === pp.producto_id);
        return { id: pp.producto_id, nombre: prod?.nombre || '—' };
      });
      renderGrupoPromocionLista();
    } else if (p.tipo === 'regalo') {
      $('pm-producto-disparador').value = p.producto_disparador_id || '';
      $('pm-cantidad-disparador').value = p.cantidad_disparador || 1;
      $('pm-producto-regalo').value = p.producto_regalo_id || '';
      $('pm-precio-regalo').value = p.precio_regalo || 0;
    } else if (p.tipo === 'descuento_cantidad') {
      $('pm-producto-descuento').value = p.producto_id || '';
      $('pm-cantidad-minima').value = p.cantidad_minima || 3;
      $('pm-descuento-porcentaje').value = p.descuento_porcentaje || 10;
    }
  } else {
    $('modalPromocionTitle').textContent = '🎉 Nueva promoción';
    $('pm-nombre').value = '';
    $('pm-tipo').value = 'nxm_mismo';
    $('pm-n-compra').value = 2; $('pm-m-paga').value = 1;
    $('pm-n-compra-grupo').value = 2; $('pm-m-paga-grupo').value = 1;
    $('pm-cantidad-disparador').value = 1; $('pm-precio-regalo').value = 0;
    $('pm-cantidad-minima').value = 3; $('pm-descuento-porcentaje').value = 10;
    $('pm-fecha-inicio').value = ''; $('pm-fecha-fin').value = '';
    $('pm-precio-promocion').value = '';
    $('pm-garantia-meses').value = '';
    renderGrupoPromocionLista();
  }
  onCambioTipoPromocion();
  onCambioProductoRegalo();
  $('modalPromocion').classList.add('open');
}

function cerrarModalPromocion() {
  $('modalPromocion').classList.remove('open');
}

function renderGrupoPromocionLista() {
  const cont = $('pm-grupo-lista');
  if (!cont) return;
  if (!STATE.grupoPromocionActual.length) {
    cont.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Todavía no has agregado productos al grupo.</p>';
    return;
  }
  cont.innerHTML = STATE.grupoPromocionActual.map((p, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--bg-hover,#f4f4f5);border-radius:8px;margin-bottom:4px">
      <span style="font-size:12.5px">${escHtml(p.nombre)}</span>
      <button type="button" class="btn-icon" onclick="quitarDelGrupoPromocion(${i})" title="Quitar">✕</button>
    </div>
  `).join('');
}

function quitarDelGrupoPromocion(idx) {
  STATE.grupoPromocionActual.splice(idx, 1);
  renderGrupoPromocionLista();
}

function agregarAlGrupoPromocion(id, nombre) {
  if (STATE.grupoPromocionActual.some(p => p.id === id)) return;
  STATE.grupoPromocionActual.push({ id, nombre });
  $('pm-buscar-grupo').value = '';
  $('pm-grupo-resultados').innerHTML = '';
  renderGrupoPromocionLista();
}

function initBusquedaGrupoPromocion() {
  const input = $('pm-buscar-grupo');
  if (!input) return;
  input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const cont = $('pm-grupo-resultados');
    if (!q) { cont.innerHTML = ''; return; }
    const yaAgregados = new Set(STATE.grupoPromocionActual.map(p => p.id));
    const resultados = STATE.productos
      .filter(p => p.activo && !yaAgregados.has(p.id) && p.nombre.toLowerCase().includes(q))
      .slice(0, 6);
    cont.innerHTML = resultados.map(p => `
      <div style="padding:6px 10px;background:var(--bg-hover,#f4f4f5);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
           onclick="agregarAlGrupoPromocion('${p.id}','${escHtml(p.nombre)}')">
        ${escHtml(p.nombre)}
      </div>
    `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
  });
}

async function guardarPromocion() {
  const errEl = $('pm-error');
  errEl.textContent = '';
  const id = $('pm-id').value;
  const nombre = $('pm-nombre').value.trim();
  const tipo = $('pm-tipo').value;
  const fechaInicio = $('pm-fecha-inicio').value || null;
  const fechaFin = $('pm-fecha-fin').value || null;
  const precioPromocionRaw = $('pm-precio-promocion').value;
  const precioPromocion = precioPromocionRaw === '' ? null : parseFloat(precioPromocionRaw);
  const garantiaPromocionRaw = $('pm-garantia-meses').value;
  const garantiaPromocion = garantiaPromocionRaw === '' ? null : parseFloat(garantiaPromocionRaw);

  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; return; }
  if (fechaInicio && fechaFin && fechaFin < fechaInicio) { errEl.textContent = 'La fecha de vigencia final no puede ser antes que la inicial.'; return; }
  if (precioPromocionRaw !== '' && (isNaN(precioPromocion) || precioPromocion < 0)) { errEl.textContent = 'El precio de la promoción no es válido.'; return; }

  const payload = { auth_user_id: STATE.user.id, nombre, tipo, fecha_inicio: fechaInicio, fecha_fin: fechaFin, precio_promocion: precioPromocion, garantia_meses: garantiaPromocion };
  let productosGrupo = null;

  if (tipo === 'nxm_mismo') {
    const productoId = $('pm-producto-nxm').value;
    const nCompra = parseInt($('pm-n-compra').value, 10);
    const mPaga = parseInt($('pm-m-paga').value, 10);
    if (!productoId) { errEl.textContent = 'Elige el producto.'; return; }
    if (!nCompra || !mPaga || mPaga >= nCompra) { errEl.textContent = 'La cantidad a pagar debe ser menor a la cantidad a comprar.'; return; }
    Object.assign(payload, { producto_id: productoId, n_compra: nCompra, m_paga: mPaga });
  } else if (tipo === 'nxm_grupo') {
    const nCompra = parseInt($('pm-n-compra-grupo').value, 10);
    const mPaga = parseInt($('pm-m-paga-grupo').value, 10);
    if (STATE.grupoPromocionActual.length < 2) { errEl.textContent = 'Agrega al menos 2 productos al grupo.'; return; }
    if (!nCompra || !mPaga || mPaga >= nCompra) { errEl.textContent = 'La cantidad a pagar debe ser menor a la cantidad a comprar.'; return; }
    Object.assign(payload, { n_compra: nCompra, m_paga: mPaga });
    productosGrupo = STATE.grupoPromocionActual.map(p => p.id);
  } else if (tipo === 'regalo') {
    const disparadorId = $('pm-producto-disparador').value;
    const regaloId = $('pm-producto-regalo').value;
    const cantidadDisparador = parseInt($('pm-cantidad-disparador').value, 10);
    const precioRegalo = parseFloat($('pm-precio-regalo').value) || 0;
    if (!disparadorId || !regaloId) { errEl.textContent = 'Elige ambos productos.'; return; }
    if (disparadorId === regaloId) { errEl.textContent = 'El producto que activa la promoción y el regalo deben ser distintos.'; return; }
    if (!cantidadDisparador || cantidadDisparador < 1) { errEl.textContent = 'La cantidad necesaria debe ser al menos 1.'; return; }
    Object.assign(payload, { producto_disparador_id: disparadorId, cantidad_disparador: cantidadDisparador, producto_regalo_id: regaloId, precio_regalo: precioRegalo });
  } else if (tipo === 'descuento_cantidad') {
    const productoId = $('pm-producto-descuento').value;
    const cantidadMinima = parseInt($('pm-cantidad-minima').value, 10);
    const descuentoPorcentaje = parseFloat($('pm-descuento-porcentaje').value);
    if (!productoId) { errEl.textContent = 'Elige el producto.'; return; }
    if (!cantidadMinima || cantidadMinima < 2) { errEl.textContent = 'La cantidad mínima debe ser al menos 2.'; return; }
    if (!descuentoPorcentaje || descuentoPorcentaje <= 0 || descuentoPorcentaje > 100) { errEl.textContent = 'El descuento debe ser entre 1% y 100%.'; return; }
    Object.assign(payload, { producto_id: productoId, cantidad_minima: cantidadMinima, descuento_porcentaje: descuentoPorcentaje });
  }

  const btn = $('btnGuardarPromocion');
  btn.disabled = true;
  try {
    let promocionId = id;
    if (id) {
      const { error } = await supabaseClient.from('promociones').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).eq('auth_user_id', STATE.user.id);
      if (error) throw error;
      // Limpiar el grupo anterior antes de re-insertar (si es nxm_grupo)
      await supabaseClient.from('promocion_productos').delete().eq('promocion_id', id).eq('auth_user_id', STATE.user.id);
    } else {
      const { data, error } = await supabaseClient.from('promociones').insert(payload).select('id').single();
      if (error) throw error;
      promocionId = data.id;
    }

    if (productosGrupo && productosGrupo.length) {
      const filas = productosGrupo.map(pid => ({ auth_user_id: STATE.user.id, promocion_id: promocionId, producto_id: pid }));
      const { error: errGrupo } = await supabaseClient.from('promocion_productos').insert(filas);
      if (errGrupo) throw errGrupo;
    }

    showToast('success', id ? 'Promoción actualizada' : 'Promoción creada', '');
    cerrarModalPromocion();
    await cargarPromociones();
  } catch (e) {
    console.error('guardarPromocion:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  initSupabase();
  initTema();
  initSidebar();
  actualizarFecha();
  initEventos();

  const autenticado = await checkAuth();
  if (!autenticado) return;

  // 1) Primero la moneda/configuración de empresa (asigna MONEDA_SIMBOLO)
  await cargarDatosEmpresa();

  // 2) Escalas de precio ANTES que productos: cargarProductos() dibuja la
  // tabla de inmediato usando STATE.escalasPorProducto, así que si se
  // cargara después, la tabla se pintaría con el mapa todavía vacío.
  await cargarEscalas();

  // 3) Luego los productos, que ya usarán MONEDA_SIMBOLO y escalas correctas
  await cargarProductos();

  // 3.5) Combos (independientes de productos, pero necesitan su lista ya cargada)
  await cargarCombos();

  // 3.6) Promociones — mismo espíritu, tampoco bloquea si falla
  await cargarPromociones();

  // 4) Catálogo de marcas/proveedores (opcional, no bloquea la carga)
  cargarProveedores();

  initNotificaciones();
}

document.addEventListener('DOMContentLoaded', init);
te
