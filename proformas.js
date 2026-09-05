/* =====================================================
   PROFORMAS.JS — NEGOCIO360
   Cotizaciones que se pueden convertir en una Venta real.

   ARQUITECTURA:
     - Crear una proforma NUNCA toca inventario, Caja ni Impuestos
       (solo guarda proformas + proforma_detalles).
     - "Convertir a Venta" reutiliza EXACTAMENTE la misma secuencia
       que usa confirmarVenta() en ventas.js: inserta en la tabla
       "ventas" (las mismas columnas), inserta venta_detalles,
       descuenta stock, registra el movimiento en Caja, registra el
       IVA en Impuestos, y actualiza el historial del cliente — el
       resultado es indistinguible de una venta creada a mano.
     - El cliente nuevo que se registre aquí se guarda directo en
       la tabla "clientes" (la misma que usa el módulo Clientes),
       así que aparece ahí de inmediato.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},

  proformas: [],
  clientes: [],
  productos: [],
  metodosPago: [],

  filtro: 'todos',
  search: '',
  page: 1,
  perPage: 15,

  carrito: [],
  escalasPorProducto: {}, // { producto_id: [{id,nombre,precio}, ...] }
  escalaPendiente: null,  // { productoId } mientras el selector está abierto
  clienteSeleccionado: null,
  ivaActivo: false,

  // Stock Compartido — grupo (Sucursales/Bodegas), mismo mecanismo de Ventas
  stockCompartidoActivo: false,
  miSucursalId:          null,
  stockOrigenPendiente:  null,
  origenStockElegido:    null,
  productosCacheGrupo:   [],

  // Vender sin stock — apagado por defecto, mismo interruptor que Ventas
  // (se lee de configuracion_empresa, no se guarda aparte por módulo).
  venderSinStockActivo: false,
  ivaPorcentaje: 15,

  proformaActual: null,
};

/* =====================================================
   HELPERS
===================================================== */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO() { return ymd(new Date()); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function sym() { return monedaParaMostrar(STATE.empresaConfig?.moneda); }
function fmt(amount) {
  const n = convertirParaMostrar(amount, STATE.empresaConfig?.moneda);
  return `${sym()} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFecha(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtNum(v) { return Number(v || 0).toLocaleString('es-NI'); }
// Mismo dato que ya usa auditoria-guard.js -- que perfil de personal
// convirtio esta proforma en venta.
function obtenerNombrePerfilActivo() {
  try {
    const raw = sessionStorage.getItem('n360_perfil_activo');
    const perfil = raw ? JSON.parse(raw) : null;
    return perfil?.nombre || 'Admin';
  } catch (_) { return 'Admin'; }
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =====================================================
   THEME / SIDEBAR / NAV (idéntico al resto del sistema)
===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('n360_theme', theme);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}
function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme');
  applyTheme(curr === 'dark' ? 'light' : 'dark');
}
function isMobileViewport() { return window.innerWidth <= 860; }
function toggleSidebar() {
  if (isMobileViewport()) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
  } else {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('main').classList.toggle('sidebar-collapsed');
  }
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}
function navigate(url) { closeMobileSidebar(); window.location.href = url; }

/* =====================================================
   CONFIG EMPRESA / PERFIL / ADMIN (idéntico al resto del sistema)
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbClient.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    STATE.venderSinStockActivo = !!data?.vender_sin_stock;
    const chkVSS = document.getElementById('chk-vender-sin-stock');
    if (chkVSS) chkVSS.checked = STATE.venderSinStockActivo;
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || data.nombre || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      if (data.color_principal || data.color_primario) {
        const col = data.color_principal || data.color_primario;
        document.documentElement.style.setProperty('--accent', col);
        document.documentElement.style.setProperty('--accent-soft', col + '22');
        document.documentElement.style.setProperty('--border-focus', col);
      }
      if (data.logo_principal_url || data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_principal_url || data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sbClient.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { console.warn('loadUserProfile:', e); return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const biz  = STATE.empresaConfig?.nombre_comercial || 'Mi negocio';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hBiz  = document.getElementById('header-biz');  if (hBiz)  hBiz.textContent  = biz;
  const hAv   = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name || 'U')[0].toUpperCase();
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sbClient.from('administradores').select('email, activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const nav = document.getElementById('nav-admin'); if (nav) nav.style.display = 'flex'; }
  } catch (e) { /* silencioso */ }
}

/* =====================================================
   MÉTODOS DE PAGO / CLIENTES / PRODUCTOS
===================================================== */
async function loadMetodosPago() {
  try {
    const { data } = await sbClient.from('metodos_pago').select('id, nombre, activo, es_default')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('orden');
    STATE.metodosPago = data || [];
  } catch (e) { STATE.metodosPago = [{ id: null, nombre: 'Efectivo', es_default: true }]; }
  const opciones = (STATE.metodosPago.length?STATE.metodosPago:[{id:null,nombre:'Efectivo',es_default:true}])
    .map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  const def = STATE.metodosPago.find(m => m.es_default);
  const sel = document.getElementById('cv-metodo-pago');
  if (sel) { sel.innerHTML = opciones; if (def) sel.value = def.id || ''; }
}

async function loadClientes() {
  try {
    const { data } = await sbClient.from('clientes').select('id,nombre,telefono,correo,total_compras,num_compras')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.clientes = data || [];
    llenarSelectClientes();
  } catch (e) { console.warn('loadClientes:', e); }
}
function llenarSelectClientes() {
  const opciones = `<option value="">— Cliente final (sin registrar) —</option>` +
    STATE.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}${c.telefono?' — '+esc(c.telefono):''}</option>`).join('');
  const sel = document.getElementById('np-cliente-select');
  if (sel) sel.innerHTML = opciones;
}
function onSelectClienteProf() {
  const id = document.getElementById('np-cliente-select')?.value;
  STATE.clienteSeleccionado = id ? (STATE.clientes.find(c => c.id === id) || null) : null;
  if (id) toggleNuevoClienteProf(false);
}
function toggleNuevoClienteProf(mostrar) {
  const form = document.getElementById('np-nuevo-cliente-form');
  const m = mostrar !== undefined ? mostrar : form.style.display === 'none';
  if (form) form.style.display = m ? 'block' : 'none';
  if (m) {
    const sel = document.getElementById('np-cliente-select'); if (sel) sel.value = '';
    STATE.clienteSeleccionado = null;
    ['cq-nombre','cq-telefono','cq-correo'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    const err = document.getElementById('cq-error'); if (err) err.textContent = '';
  }
}
// Crea el cliente YA (no hasta guardar la proforma) — así aparece de
// inmediato en el módulo Clientes, tal como lo pediste.
async function guardarNuevoClienteProf() {
  const errEl = document.getElementById('cq-error');
  errEl.textContent = '';
  const nombre = document.getElementById('cq-nombre')?.value.trim();
  if (!nombre) { errEl.textContent = 'El nombre del cliente es requerido.'; return; }
  const payload = {
    auth_user_id: STATE.userId, nombre,
    telefono: document.getElementById('cq-telefono')?.value.trim() || null,
    correo:   document.getElementById('cq-correo')?.value.trim()   || null,
    activo: true,
  };
  setBtnLoading('btn-guardar-cliente-prof', true);
  try {
    const { data, error } = await sbClient.from('clientes').insert(payload).select().single();
    if (error) throw error;
    STATE.clientes.push(data);
    STATE.clienteSeleccionado = data;
    llenarSelectClientes();
    const sel = document.getElementById('np-cliente-select'); if (sel) sel.value = data.id;
    toggleNuevoClienteProf(false);
    showToast('Cliente guardado — ya aparece en el módulo Clientes');
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-cliente-prof', false);
  }
}

async function loadProductos() {
  try {
    const { data } = await sbClient.from('productos')
      .select('id,nombre,sku,tipo,categoria,stock_actual,precio,costo,activo,tipo_precio')
      .eq('auth_user_id', STATE.userId).eq('activo', true).eq('es_materia_prima', false).order('nombre');
    const productos = data || [];

    // Combos: se agregan al mismo catálogo de búsqueda/carrito que los
    // productos (mismo patrón que en ventas.js) — tipo:'producto' para
    // que las validaciones de stock ya existentes se apliquen igual,
    // marcados con esCombo:true para tratarlos distinto solo al
    // convertir la proforma en venta.
    let combosCache = [];
    try {
      const { data: combos } = await sbClient.from('combos')
        .select('id,nombre,sku,codigo_barras,precio,costo,tipo_precio,activo')
        .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
      if (combos && combos.length) {
        const comboIds = combos.map(c => c.id);
        const { data: items } = await sbClient.from('combo_items')
          .select('combo_id, cantidad, productos(stock_actual, costo)').in('combo_id', comboIds);
        const itemsPorCombo = {};
        (items||[]).forEach(it => {
          if (!itemsPorCombo[it.combo_id]) itemsPorCombo[it.combo_id] = [];
          itemsPorCombo[it.combo_id].push(it);
        });
        combosCache = combos.map(c => {
          const suyos = itemsPorCombo[c.id] || [];
          const stockDisponible = suyos.length
            ? Math.min(...suyos.map(it => Math.floor(Number(it.productos?.stock_actual || 0) / (Number(it.cantidad) || 1))))
            : 0;
          const costoActual = suyos.reduce((s, it) => s + Number(it.cantidad||0) * Number(it.productos?.costo || 0), 0);
          return {
            id: c.id, nombre: c.nombre, sku: c.sku || c.codigo_barras || '',
            tipo: 'producto', precio: c.precio, costo: costoActual, tipo_precio: c.tipo_precio,
            stock_actual: stockDisponible, activo: c.activo, esCombo: true,
          };
        });
      }
    } catch (eCombo) { console.warn('No se pudieron cargar los combos para Proformas:', eCombo); }

    STATE.productos = [...productos, ...combosCache];
  } catch (e) { console.warn('loadProductos:', e); }
  await loadEscalasCache();
}

// Mismo patrón que ventas.js: un producto con tipo_precio='escala' no
// tiene un precio único, sino varios (mayoreo, detalle, etc.) guardados
// en precios_escala. Se cargan todos de una vez para no consultar por
// producto cada vez que se agrega al carrito.
async function loadEscalasCache() {
  try {
    const { data } = await sbClient.from('precios_escala').select('id,producto_id,nombre,precio,orden')
      .eq('auth_user_id', STATE.userId).order('orden');
    const map = {};
    (data||[]).forEach(e => {
      if (!map[e.producto_id]) map[e.producto_id] = [];
      map[e.producto_id].push(e);
    });
    // Escalas de precio de COMBOS: mismo mapa (llaves de combo nunca
    // chocan con llaves de producto).
    try {
      const { data: comboEscalas } = await sbClient.from('combo_precios_escala')
        .select('id,combo_id,nombre,precio,orden').eq('auth_user_id', STATE.userId).order('orden');
      (comboEscalas||[]).forEach(e => {
        if (!map[e.combo_id]) map[e.combo_id] = [];
        map[e.combo_id].push(e);
      });
    } catch (eCombo) { /* si falla, los combos con escala solo no muestran precios */ }
    STATE.escalasPorProducto = map;
  } catch (e) { STATE.escalasPorProducto = {}; }
}

/* =====================================================
   CARRITO DE PRODUCTOS (mismos campos/fórmulas que Ventas)
===================================================== */
function buscarProductoProf() {
  const q = (document.getElementById('np-producto-search')?.value || '').toLowerCase().trim();
  const res = document.getElementById('np-search-results');
  if (!res) return;
  if (!q) { res.innerHTML = ''; return; }
  const filtrados = STATE.productos.filter(p =>
    p.nombre.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.categoria||'').toLowerCase().includes(q)
  ).slice(0, 10);

  let filtradosGrupo = [];
  if (STATE.stockCompartidoActivo) {
    const nombresLocales = new Set(STATE.productos.map(p => (p.nombre||'').trim().toLowerCase()));
    const vistos = new Set();
    filtradosGrupo = STATE.productosCacheGrupo.filter(p => {
      const clave = (p.nombre||'').trim().toLowerCase();
      if (p.tipo !== 'producto' || !clave || p.es_materia_prima || nombresLocales.has(clave) || vistos.has(clave)) return false;
      const coincide = clave.includes(q) || (p.sku||'').toLowerCase().includes(q);
      if (coincide) vistos.add(clave);
      return coincide;
    }).slice(0, 10 - filtrados.length);
  }

  if (!filtrados.length && !filtradosGrupo.length) { res.innerHTML = `<div class="search-no-results">Sin resultados para "${esc(q)}"</div>`; return; }
  const htmlLocal = filtrados.map(p => {
    const esEscala = p.tipo_precio === 'escala';
    let precioLabel;
    if (esEscala) {
      const escalas = STATE.escalasPorProducto[p.id] || [];
      if (!escalas.length) precioLabel = 'Sin precios';
      else {
        const precios = escalas.map(e => Number(e.precio)||0);
        const min = Math.min(...precios), max = Math.max(...precios);
        precioLabel = min===max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
      }
    } else {
      precioLabel = fmt(p.precio);
    }
    return `
    <div class="search-result-item" onclick="agregarAlCarritoProf('${p.id}')">
      <div class="sri-info">
        <span class="sri-nombre">${esc(p.nombre)}${p.esCombo?' <span style="font-size:10px;color:var(--accent-4,var(--accent))">📦 combo</span>':''}${esEscala?' <span style="font-size:10px;color:var(--accent)">📊 escala</span>':''}</span>
        <span class="sri-meta">${p.esCombo?'Combo':(p.tipo==='servicio'?'Servicio':'Producto')}${p.sku?' · SKU: '+esc(p.sku):''}${p.tipo==='producto'?' · Stock: '+fmtNum(p.stock_actual):''}</span>
      </div>
      <span class="sri-costo">${precioLabel}</span>
    </div>`;
  }).join('');

  const htmlGrupo = filtradosGrupo.map(p => `
    <div class="search-result-item" onclick="agregarProductoSoloEnGrupoProf('${esc(p.nombre).replace(/'/g,"\\'")}')">
      <div class="sri-info">
        <span class="sri-nombre">${esc(p.nombre)} <span style="font-size:10px;color:var(--accent-3,#e08e0b)">📦 en otra cuenta</span></span>
        <span class="sri-meta">Producto · Solo en otra sucursal/bodega</span>
      </div>
      <span class="sri-costo">${fmt(p.precio)}</span>
    </div>`).join('');

  res.innerHTML = htmlLocal + htmlGrupo;
}
/* ===================================================
   STOCK COMPARTIDO — mismo mecanismo ya construido en Ventas. Si
   está desactivado, ninguna de estas funciones se dispara y el
   módulo funciona exactamente como antes.
=================================================== */
async function cargarEstadoStockCompartido() {
  try {
    const { data: activo, error } = await sbClient.rpc('obtener_stock_compartido');
    if (error) throw error;
    STATE.stockCompartidoActivo = !!activo;

    const { data: miFila } = await sbClient.from('sucursales')
      .select('id').eq('auth_user_id_sucursal', STATE.userId).maybeSingle();
    STATE.miSucursalId = miFila?.id || null;

    const wrap = document.getElementById('stock-compartido-wrap');
    const chk  = document.getElementById('chk-stock-compartido');
    if (wrap && STATE.miSucursalId) wrap.style.display = 'flex';
    if (chk) chk.checked = STATE.stockCompartidoActivo;

    if (STATE.stockCompartidoActivo) await cargarProductosGrupoProf();
  } catch (e) {
    console.warn('cargarEstadoStockCompartido (proformas):', e);
    STATE.stockCompartidoActivo = false;
  }
}

async function cargarProductosGrupoProf() {
  try {
    const sbGrupo = crearClienteGrupo(sbClient);
    const { data, error } = await sbGrupo.from('productos').select('*');
    if (error) throw error;
    STATE.productosCacheGrupo = data || [];
  } catch (e) {
    console.warn('cargarProductosGrupoProf:', e);
    STATE.productosCacheGrupo = [];
  }
}

async function toggleStockCompartido(activo) {
  try {
    const { error } = await sbClient.rpc('establecer_stock_compartido', { p_activo: activo });
    if (error) throw error;
    STATE.stockCompartidoActivo = activo;
    if (activo) await cargarProductosGrupoProf();
    showToast(activo ? 'Stock Compartido activado para todo el grupo' : 'Stock Compartido desactivado', 'success');
  } catch (e) {
    console.error('toggleStockCompartido (proformas):', e);
    showToast('No se pudo cambiar Stock Compartido', 'error');
    const chk = document.getElementById('chk-stock-compartido');
    if (chk) chk.checked = !activo;
  }
}

async function toggleVenderSinStock(activo) {
  try {
    const { error } = await sbClient.from('configuracion_empresa')
      .update({ vender_sin_stock: activo }).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    STATE.venderSinStockActivo = activo;
    if (STATE.empresaConfig) STATE.empresaConfig.vender_sin_stock = activo;
    showToast(activo ? 'Ahora puedes cotizar sin stock disponible' : 'Vender sin stock desactivado', 'success');
  } catch (e) {
    console.error('toggleVenderSinStock (proformas):', e);
    showToast('No se pudo cambiar esta opción', 'error');
    const chk = document.getElementById('chk-vender-sin-stock');
    if (chk) chk.checked = !activo;
  }
}

async function abrirSelectorStockOrigen(nombreProducto, callbackContinuar) {
  try {
    const { data, error } = await sbClient.rpc('stock_grupo_por_nombre', { p_nombre: nombreProducto });
    if (error) throw error;
    const opciones = data || [];
    if (!opciones.length) { callbackContinuar(null); return; }

    STATE.stockOrigenPendiente = { callback: callbackContinuar };
    document.getElementById('stock-origen-title').textContent = nombreProducto;
    document.getElementById('stock-origen-lista').innerHTML = opciones.map((o, i) => `
      <label class="esc-precio-opcion" style="${o.stock_actual<=0 ? 'opacity:.5' : ''}">
        <input type="radio" name="stock-origen-radio" value="${o.sucursal_id}"
               data-stock="${o.stock_actual}" data-nombre="${esc(o.nombre_cuenta)}"
               ${i===0 ? 'checked' : ''} ${o.stock_actual<=0 ? 'disabled' : ''}/>
        <span class="esc-precio-nombre">${o.tipo_cuenta==='bodega'?'📦':(o.es_central?'🏠':'🏬')} ${esc(o.nombre_cuenta)}</span>
        <span class="esc-precio-valor">${Number(o.stock_actual||0).toLocaleString('es-NI',{maximumFractionDigits:2})} disp.</span>
      </label>
    `).join('');
    openModal('modal-stock-origen');
  } catch (e) {
    console.error('abrirSelectorStockOrigen (proformas):', e);
    showToast('No se pudo consultar el stock del grupo', 'error');
    callbackContinuar(null);
  }
}
function confirmarSeleccionStockOrigen() {
  const pend = STATE.stockOrigenPendiente;
  if (!pend) return;
  const radio = document.querySelector('input[name="stock-origen-radio"]:checked');
  if (!radio) { showToast('Elige de dónde sacar el stock', 'error'); return; }
  const stockDisp = parseFloat(radio.dataset.stock || 0);
  if (stockDisp <= 0) { showToast('Esa cuenta no tiene stock disponible de este producto', 'error'); return; }

  const origen = {
    sucursalId: radio.value, stockDisponible: stockDisp,
    nombreCuenta: radio.dataset.nombre, esLocal: radio.value === STATE.miSucursalId,
  };
  closeModal('modal-stock-origen');
  STATE.stockOrigenPendiente = null;
  pend.callback(origen);
}
function cerrarSelectorStockOrigen() {
  const pend = STATE.stockOrigenPendiente;
  closeModal('modal-stock-origen');
  STATE.stockOrigenPendiente = null;
  if (pend) pend.callback(null);
}

// Un producto que solo existe en OTRA cuenta del grupo — se salta
// directo al selector de origen (no hay fila local que buscar).
function agregarProductoSoloEnGrupoProf(nombreProducto) {
  abrirSelectorStockOrigen(nombreProducto, async (origen) => {
    if (!origen || origen.esLocal) return;
    const refGrupo = STATE.productosCacheGrupo.find(p => (p.nombre||'').trim().toLowerCase() === nombreProducto.trim().toLowerCase());
    if (!refGrupo) { showToast('No se pudo encontrar ese producto', 'error'); return; }

    STATE.origenStockElegido = origen;
    const prodTemporal = {
      id: refGrupo.id, nombre: refGrupo.nombre, sku: refGrupo.sku,
      tipo: 'producto', tipo_precio: refGrupo.tipo_precio || 'fijo',
      precio: refGrupo.precio, costo: refGrupo.costo, stock_actual: origen.stockDisponible,
    };
    const yaEstaEnCache = STATE.productos.some(p => p.id === prodTemporal.id);
    if (!yaEstaEnCache) STATE.productos.push(prodTemporal);

    if (prodTemporal.tipo_precio === 'escala') {
      // Traer las escalas del producto remoto — antes se quedaban
      // vacías porque solo se cacheaban las de esta misma cuenta.
      if (!STATE.escalasPorProducto[refGrupo.id]) {
        try {
          const sbGrupo = crearClienteGrupo(sbClient);
          const { data } = await sbGrupo.from('precios_escala').select('*');
          STATE.escalasPorProducto[refGrupo.id] = (data || []).filter(e => e.producto_id === refGrupo.id);
        } catch (e) {
          console.warn('No se pudieron cargar las escalas remotas:', e);
          STATE.escalasPorProducto[refGrupo.id] = [];
        }
      }
      abrirSelectorEscalaProf(prodTemporal.id);
    } else {
      agregarAlCarritoConPrecioProf(prodTemporal.id, null);
    }
  });
}

function agregarAlCarritoProf(productoId) {
  const p = STATE.productos.find(x => x.id === productoId);
  if (!p) return;

  const continuarNormal = () => {
    // Si es escala de precios, SIEMPRE se pregunta qué precio usar —
    // nunca se asume el que se eligió antes (igual que en Ventas).
    if (p.tipo_precio === 'escala') {
      abrirSelectorEscalaProf(productoId);
      return;
    }
    agregarAlCarritoConPrecioProf(productoId, null);
  };

  // Stock Compartido activo: se pregunta primero de cuál sucursal/
  // bodega del grupo se va a descontar — si está desactivado, nunca
  // se ejecuta este bloque.
  if (STATE.stockCompartidoActivo && p.tipo === 'producto') {
    abrirSelectorStockOrigen(p.nombre, (origen) => {
      if (!origen) return;
      STATE.origenStockElegido = origen;
      continuarNormal();
    });
    return;
  }

  STATE.origenStockElegido = null;
  continuarNormal();
}

/* ============================================================
   SELECTOR DE ESCALA DE PRECIOS — igual que en Ventas: solo se
   muestra para productos con tipo_precio='escala'. Los de precio
   fijo nunca pasan por aquí, su flujo no cambia en nada.
   ============================================================ */
function abrirSelectorEscalaProf(productoId) {
  const prod = STATE.productos.find(p => p.id === productoId);
  const escalas = STATE.escalasPorProducto[productoId] || [];
  if (!prod || !escalas.length) { showToast('Este producto no tiene precios de escala configurados', 'error'); return; }

  STATE.escalaPendiente = { productoId };
  document.getElementById('esc-precio-title-prof').textContent = prod.nombre;
  document.getElementById('esc-precio-lista-prof').innerHTML = escalas.map((e,i) => `
    <label class="esc-precio-opcion">
      <input type="radio" name="esc-precio-radio-prof" value="${e.id}" ${i===0?'checked':''}/>
      <span class="esc-precio-nombre">${esc(e.nombre)}</span>
      <span class="esc-precio-valor">${fmt(e.precio)}</span>
    </label>`).join('');
  openModal('modal-escala-precio-prof');
}
function confirmarSeleccionEscalaProf() {
  const pend = STATE.escalaPendiente;
  if (!pend) return;
  const radio = document.querySelector('input[name="esc-precio-radio-prof"]:checked');
  if (!radio) { showToast('Selecciona un precio', 'error'); return; }
  const escalas = STATE.escalasPorProducto[pend.productoId] || [];
  const escalaElegida = escalas.find(e => e.id === radio.value);
  if (!escalaElegida) return;
  agregarAlCarritoConPrecioProf(pend.productoId, escalaElegida);
  closeModal('modal-escala-precio-prof');
  STATE.escalaPendiente = null;
}
function cerrarSelectorEscalaProf() {
  closeModal('modal-escala-precio-prof');
  STATE.escalaPendiente = null;
}

function agregarAlCarritoConPrecioProf(productoId, escalaElegida) {
  const p = STATE.productos.find(x => x.id === productoId);
  if (!p) return;
  const origen = STATE.origenStockElegido; STATE.origenStockElegido = null;
  const esRemoto = !!(origen && !origen.esLocal);
  const precioUsar = escalaElegida ? parseFloat(escalaElegida.precio||0) : parseFloat(p.precio||0);
  const stockReal = esRemoto ? (origen.stockDisponible ?? Infinity) : Number(p.stock_actual || 0);

  const existente = STATE.carrito.find(l => l.id === productoId && (l.escalaId || null) === (escalaElegida?.id || null) && (l.origenStockId || null) === (esRemoto ? origen.sucursalId : null));
  if (existente) {
    existente.cantidad++;
    if (p.tipo === 'producto' && existente.cantidad > stockReal) existente.sinStock = true;
    recalcularLineaProf(existente);
  }
  else {
    const linea = { id: p.id, nombre: p.nombre, sku: p.sku, tipo: p.tipo, costo: Number(p.costo||0),
      cantidad: 1, precio: precioUsar, descuento: 0, esCombo: !!p.esCombo,
      escalaId: escalaElegida ? escalaElegida.id : null,
      escalaNombre: escalaElegida ? escalaElegida.nombre : null,
      sinStock: p.tipo === 'producto' && 1 > stockReal,
      origenStockId:     esRemoto ? origen.sucursalId   : null,
      origenStockNombre: esRemoto ? origen.nombreCuenta : null };
    recalcularLineaProf(linea);
    STATE.carrito.push(linea);
  }
  renderCarritoProf();
  showToast(`${p.nombre}${escalaElegida ? ' · '+escalaElegida.nombre : ''}${esRemoto ? ' · desde '+origen.nombreCuenta : ''} agregado`);
  const sp = document.getElementById('np-producto-search'); if (sp) sp.value = '';
  const sr = document.getElementById('np-search-results');  if (sr) sr.innerHTML = '';
}
function recalcularLineaProf(l) {
  l.subtotal = round2(l.cantidad * l.precio - (l.descuento || 0));
  l.ganancia = round2(l.cantidad * (l.precio - l.costo) - (l.descuento || 0));
}
function renderCarritoProf() {
  const tbody = document.getElementById('np-carrito-tbody');
  if (!tbody) return;
  if (!STATE.carrito.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Busca y agrega productos arriba</td></tr>`;
    actualizarResumenProf();
    return;
  }
  tbody.innerHTML = STATE.carrito.map((l, idx) => `
    <tr>
      <td style="font-weight:500">${esc(l.nombre)}${l.esCombo ? `<div style="font-size:11px;color:var(--accent-4,var(--accent));font-weight:600">📦 Combo</div>` : ''}${l.escalaNombre ? `<div style="font-size:11px;color:var(--accent);font-weight:600">📊 ${esc(l.escalaNombre)}</div>` : ''}${l.precioEditado ? `<div style="font-size:10px;color:var(--text-muted)">✏️ Precio ajustado</div>` : ''}${l.sinStock ? `<div style="font-size:10px;color:#e08e0b;font-weight:600" title="No hay existencias registradas ahora mismo, pero se puede vender igual">⚠️ Sin stock (se puede vender)</div>` : ''}</td>
      <td><input type="number" class="carrito-input" value="${l.cantidad}" min="0.01" step="0.01" onchange="actualizarLineaProf(${idx},'cantidad',this.value)" style="width:70px"/></td>
      <td><input type="number" class="carrito-input" value="${l.precio}" min="0" step="0.01" title="Ajustar el precio solo para esta proforma" onchange="actualizarLineaProf(${idx},'precio',this.value,true)" style="width:90px"/></td>
      <td class="col-costo-prof" style="display:none"><input type="number" class="carrito-input" value="${l.costo||0}" min="0" step="0.01" title="Ajustar el costo solo para esta proforma" onchange="actualizarLineaProf(${idx},'costo',this.value)" style="width:90px"/></td>
      <td><input type="number" class="carrito-input" value="${l.descuento}" min="0" step="0.01" onchange="actualizarLineaProf(${idx},'descuento',this.value)" style="width:80px"/></td>
      <td class="td-right td-money">${fmt(l.subtotal)}</td>
      <td><button class="btn-icon btn-icon-danger" onclick="eliminarLineaProf(${idx})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    </tr>`).join('');
  actualizarResumenProf();
  aplicarVisibilidadCostoProf();
}
function actualizarLineaProf(idx, campo, valor, esPrecioManual) {
  const l = STATE.carrito[idx]; if (!l) return;
  l[campo] = parseFloat(valor) || 0;
  if (esPrecioManual) l.precioEditado = true;
  if (campo === 'cantidad' && l.tipo === 'producto' && !l.origenStockId) {
    const p = STATE.productos.find(x => x.id === l.id);
    if (p && l.cantidad > Number(p.stock_actual || 0)) l.sinStock = true;
  }
  recalcularLineaProf(l);
  renderCarritoProf();
}
function eliminarLineaProf(idx) { STATE.carrito.splice(idx,1); renderCarritoProf(); }

// Muestra u oculta la columna de Costo en la tabla de items, segun la
// preferencia guardada en Configurar Venta rapida (compartida con
// Ventas) -- desactivada por defecto, ya que el costo suele ser
// informacion sensible que no todo el personal debe ver al vender.
function aplicarVisibilidadCostoProf() {
  const mostrar = !!STATE.mostrarCostoVenta;
  document.querySelectorAll('.col-costo-prof').forEach(el => { el.style.display = mostrar ? '' : 'none'; });
}
async function cargarPreferenciaCostoProf() {
  try {
    const { data } = await sbClient.from('configuracion_venta_rapida')
      .select('mostrar_costo_venta').eq('auth_user_id', STATE.userId).maybeSingle();
    STATE.mostrarCostoVenta = !!data?.mostrar_costo_venta;
  } catch (e) { STATE.mostrarCostoVenta = false; }
  aplicarVisibilidadCostoProf();
}

function toggleIVAProf(activo) {
  STATE.ivaActivo = activo;
  const wrap = document.getElementById('np-iva-porcentaje-wrap');
  if (wrap) wrap.style.display = activo ? 'flex' : 'none';
  actualizarResumenProf();
}
function actualizarIVAPorcentajeProf() {
  const val = parseFloat(document.getElementById('np-iva-porcentaje')?.value || 15);
  STATE.ivaPorcentaje = isNaN(val) ? 15 : val;
  actualizarResumenProf();
}

// MISMA fórmula exacta que calcularResumen() en ventas.js.
function calcularResumenProf() {
  const subtotal  = round2(STATE.carrito.reduce((s,l) => s + l.cantidad*l.precio, 0));
  const descuento = round2(STATE.carrito.reduce((s,l) => s + (l.descuento||0), 0));
  const baseImponible = Math.max(subtotal - descuento, 0);
  const impuesto  = STATE.ivaActivo ? round2(baseImponible * (STATE.ivaPorcentaje/100)) : 0;
  const total     = round2(subtotal - descuento + impuesto);
  const costoTotal= round2(STATE.carrito.reduce((s,l) => s + l.cantidad*l.costo, 0));
  const ganancia  = round2(STATE.carrito.reduce((s,l) => s + l.ganancia, 0));
  return { subtotal, descuento, impuesto, total, costoTotal, ganancia };
}
function actualizarResumenProf() {
  const r = calcularResumenProf();
  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('np-resumen-subtotal', fmt(r.subtotal));
  set('np-resumen-descuento', r.descuento>0?`-${fmt(r.descuento)}`:'—');
  set('np-resumen-iva', r.impuesto>0?fmt(r.impuesto):'—');
  set('np-resumen-total', fmt(r.total));
  const prev = document.getElementById('np-total-preview'); if (prev) prev.textContent = fmt(r.total);
}

/* =====================================================
   ABRIR / RESET MODAL NUEVA PROFORMA
===================================================== */
/* =====================================================
   PERSONALIZAR PROFORMA — propio de este módulo, guardado en su
   propia tabla (configuracion_proforma), independiente de Perfil.
===================================================== */
STATE.configProforma = null;

async function cargarConfigProforma() {
  try {
    const { data } = await sbClient.from('configuracion_proforma').select('*').eq('auth_user_id', STATE.userId).maybeSingle();
    STATE.configProforma = data || { color_principal:'#6C63FF', color_tabla_usa_mismo:true, color_tabla:'#6C63FF', mostrar_ruc:true, mostrar_direccion:true, mostrar_telefono:true, mensaje_pie:null, logo_tamano:'mediano' };
  } catch (e) { STATE.configProforma = { color_principal:'#6C63FF', color_tabla_usa_mismo:true, color_tabla:'#6C63FF', mostrar_ruc:true, mostrar_direccion:true, mostrar_telefono:true, mensaje_pie:null, logo_tamano:'mediano' }; }
}

async function abrirPersonalizarProforma() {
  await cargarConfigProforma();
  const c = STATE.configProforma;
  document.getElementById('pp-color-principal').value = c.color_principal || '#6C63FF';
  document.getElementById('pp-hex-principal').value = c.color_principal || '#6C63FF';
  document.getElementById('pp-mismo-color').checked = c.color_tabla_usa_mismo !== false;
  document.getElementById('pp-color-tabla').value = c.color_tabla || c.color_principal || '#6C63FF';
  document.getElementById('pp-hex-tabla').value = c.color_tabla || c.color_principal || '#6C63FF';
  document.getElementById('pp-mensaje-pie').value = c.mensaje_pie || '';
  document.getElementById('pp-logo-tamano').value = c.logo_tamano || 'mediano';
  document.getElementById('pp-mostrar-ruc').checked = c.mostrar_ruc !== false;
  document.getElementById('pp-mostrar-direccion').checked = c.mostrar_direccion !== false;
  document.getElementById('pp-mostrar-telefono').checked = c.mostrar_telefono !== false;
  document.getElementById('pp-error').textContent = '';
  ppToggleMismoColor();
  ppActualizarVista();
  openModal('modal-personalizar-proforma');
}

function ppSyncColor(colorId, hexId) { document.getElementById(hexId).value = document.getElementById(colorId).value; }
function ppSyncHex(hexId, colorId) {
  const v = document.getElementById(hexId).value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) document.getElementById(colorId).value = v;
}
function ppToggleMismoColor() {
  const usaMismo = document.getElementById('pp-mismo-color').checked;
  document.getElementById('pp-color-tabla-wrap').style.display = usaMismo ? 'none' : '';
}
function ppActualizarVista() {
  const bizName = STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio';
  const colorPrincipal = document.getElementById('pp-color-principal').value;
  const usaMismo = document.getElementById('pp-mismo-color').checked;
  const colorTabla = usaMismo ? colorPrincipal : document.getElementById('pp-color-tabla').value;

  document.getElementById('pp-preview-header').style.background = colorPrincipal;
  document.getElementById('pp-preview-nombre').textContent = bizName;
  document.getElementById('pp-preview-tabla-head').style.background = colorTabla;

  const datos = [];
  if (document.getElementById('pp-mostrar-ruc').checked) datos.push('RUC');
  if (document.getElementById('pp-mostrar-direccion').checked) datos.push('Dirección');
  if (document.getElementById('pp-mostrar-telefono').checked) datos.push('Tel');
  document.getElementById('pp-preview-datos').textContent = datos.join(' · ') || '(sin datos de contacto mostrados)';

  const mensaje = document.getElementById('pp-mensaje-pie').value.trim();
  document.getElementById('pp-preview-pie').textContent = (mensaje ? mensaje + ' · ' : '') + 'Generado por Negocio360';
}

async function guardarPersonalizarProforma() {
  const errEl = document.getElementById('pp-error');
  errEl.textContent = '';
  const colorPrincipal = document.getElementById('pp-hex-principal').value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(colorPrincipal)) { errEl.textContent = 'El color del encabezado no es válido.'; return; }
  const usaMismo = document.getElementById('pp-mismo-color').checked;
  const colorTabla = usaMismo ? colorPrincipal : document.getElementById('pp-hex-tabla').value.trim();
  if (!usaMismo && !/^#[0-9a-fA-F]{6}$/.test(colorTabla)) { errEl.textContent = 'El color de la tabla no es válido.'; return; }

  setBtnLoading('btn-guardar-personalizar-proforma', true);
  try {
    await sbClient.from('configuracion_proforma').upsert({
      auth_user_id: STATE.userId, color_principal: colorPrincipal, color_tabla_usa_mismo: usaMismo, color_tabla: colorTabla,
      mensaje_pie: document.getElementById('pp-mensaje-pie').value.trim() || null,
      logo_tamano: document.getElementById('pp-logo-tamano').value,
      mostrar_ruc: document.getElementById('pp-mostrar-ruc').checked,
      mostrar_direccion: document.getElementById('pp-mostrar-direccion').checked,
      mostrar_telefono: document.getElementById('pp-mostrar-telefono').checked,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    STATE.configProforma = null; // se recarga fresco la próxima vez que se genere un PDF
    showToast('Personalización guardada');
    closeModal('modal-personalizar-proforma');
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-personalizar-proforma', false);
  }
}

function abrirNuevaProforma() {
  STATE.proformaActual = null;
  document.getElementById('np-modal-title').textContent = 'Nueva Proforma';
  document.getElementById('np-id').value = '';
  STATE.carrito = [];
  STATE.clienteSeleccionado = null;
  STATE.ivaActivo = false; STATE.ivaPorcentaje = 15;
  cargarPreferenciaCostoProf();

  const sel = document.getElementById('np-cliente-select'); if (sel) sel.value = '';
  toggleNuevoClienteProf(false);
  document.getElementById('np-fecha').value = todayISO();
  document.getElementById('np-fecha-vencimiento').value = '';
  document.getElementById('np-estado').value = 'borrador';
  document.getElementById('np-observaciones').value = '';
  const ivaCheck = document.getElementById('np-iva-activo'); if (ivaCheck) ivaCheck.checked = false;
  const ivaPorc = document.getElementById('np-iva-porcentaje'); if (ivaPorc) ivaPorc.value = '15';
  toggleIVAProf(false);
  const sp = document.getElementById('np-producto-search'); if (sp) sp.value = '';
  const sr = document.getElementById('np-search-results'); if (sr) sr.innerHTML = '';
  renderCarritoProf();
  document.getElementById('np-error').textContent = '';
  openModal('modal-nueva-proforma');
}

function abrirEditarProforma(id) {
  const p = STATE.proformas.find(x => x.id === id);
  if (!p) return;
  if (['convertida','pago_parcial'].includes(p.estado)) { showToast('Esta proforma ya no se puede editar', 'error'); return; }
  abrirNuevaProforma();
  STATE.proformaActual = p;
  document.getElementById('np-modal-title').textContent = `Editar Proforma ${p.numero_proforma}`;
  document.getElementById('np-id').value = p.id;
  document.getElementById('np-fecha').value = p.fecha;
  document.getElementById('np-fecha-vencimiento').value = p.fecha_vencimiento || '';
  document.getElementById('np-estado').value = p.estado === 'vencida' ? 'pendiente' : p.estado;
  document.getElementById('np-observaciones').value = p.observaciones || '';

  if (p.cliente_id) {
    const sel = document.getElementById('np-cliente-select'); if (sel) sel.value = p.cliente_id;
    STATE.clienteSeleccionado = STATE.clientes.find(c => c.id === p.cliente_id) || null;
  }

  STATE.ivaActivo = !!p.iva_activo; STATE.ivaPorcentaje = Number(p.iva_porcentaje) || 15;
  document.getElementById('np-iva-activo').checked = STATE.ivaActivo;
  document.getElementById('np-iva-porcentaje').value = STATE.ivaPorcentaje;
  toggleIVAProf(STATE.ivaActivo);

  (async () => {
    const { data: detalles } = await sbClient.from('proforma_detalles').select('*').eq('proforma_id', p.id);
    STATE.carrito = (detalles||[]).map(d => ({
      id: d.combo_id || d.producto_id, nombre: d.producto_nombre, sku: d.producto_sku,
      tipo: d.tipo_item === 'combo' ? 'producto' : d.tipo_item, esCombo: d.tipo_item === 'combo' || !!d.combo_id,
      costo: Number(d.costo||0), cantidad: Number(d.cantidad), precio: Number(d.precio), descuento: Number(d.descuento||0),
      escalaId: d.escala_id || null, escalaNombre: d.escala_nombre || null,
    }));
    STATE.carrito.forEach(recalcularLineaProf);
    renderCarritoProf();
  })();
}

/* =====================================================
   NUMERACIÓN
===================================================== */
async function generarNumeroProforma() {
  try {
    const { data, error } = await sbClient.rpc('generar_numero_proforma', { p_user_id: STATE.userId });
    if (error) throw error;
    return data;
  } catch (e) { return 'PR-' + String(Date.now()).slice(-6); }
}

/* =====================================================
   GUARDAR PROFORMA (NO toca inventario/caja/impuestos)
===================================================== */
async function guardarProforma() {
  const errEl = document.getElementById('np-error');
  errEl.textContent = '';

  if (!STATE.carrito.length) { errEl.textContent = 'Agrega al menos un producto o servicio.'; return; }
  for (const l of STATE.carrito) {
    if (!(l.cantidad > 0)) { errEl.textContent = `Cantidad inválida en "${l.nombre}".`; return; }
    if (l.precio < 0) { errEl.textContent = `Precio inválido en "${l.nombre}".`; return; }
  }
  const fecha = document.getElementById('np-fecha')?.value || todayISO();
  const fechaVenc = document.getElementById('np-fecha-vencimiento')?.value || null;
  if (fechaVenc && fechaVenc < fecha) { errEl.textContent = 'La fecha de vencimiento no puede ser anterior a la fecha de la proforma.'; return; }
  const estado = document.getElementById('np-estado')?.value || 'borrador';
  const observaciones = document.getElementById('np-observaciones')?.value.trim() || null;
  const r = calcularResumenProf();
  if (r.total <= 0) { errEl.textContent = 'El total debe ser mayor a cero.'; return; }

  setBtnLoading('np-btn-guardar', true);
  try {
    const editandoId = document.getElementById('np-id').value || null;
    const payload = {
      cliente_id: STATE.clienteSeleccionado?.id || null,
      cliente_nombre: STATE.clienteSeleccionado?.nombre || 'Cliente final',
      fecha, fecha_vencimiento: fechaVenc,
      subtotal: r.subtotal, descuento: r.descuento, impuesto: r.impuesto,
      iva_activo: STATE.ivaActivo, iva_porcentaje: STATE.ivaActivo ? STATE.ivaPorcentaje : 0,
      total: r.total, costo_total: r.costoTotal, estado, observaciones,
      updated_at: new Date().toISOString(),
    };

    let proformaId = editandoId;
    let numero;
    if (editandoId) {
      const { error } = await sbClient.from('proformas').update(payload).eq('id', editandoId);
      if (error) throw error;
      await sbClient.from('proforma_detalles').delete().eq('proforma_id', editandoId);
      numero = STATE.proformaActual?.numero_proforma;
    } else {
      numero = await generarNumeroProforma();
      const { data: nueva, error } = await sbClient.from('proformas').insert({
        auth_user_id: STATE.userId, numero_proforma: numero,
        usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
        ...payload,
      }).select().single();
      if (error) throw error;
      proformaId = nueva.id;
    }

    const detallesPayload = STATE.carrito.map(l => ({
      auth_user_id: STATE.userId, proforma_id: proformaId,
      producto_id: l.esCombo ? null : l.id, combo_id: l.esCombo ? l.id : null,
      producto_nombre: l.nombre, producto_sku: l.sku || null, tipo_item: l.esCombo ? 'combo' : l.tipo,
      cantidad: l.cantidad, precio: l.precio, costo: l.costo, descuento: l.descuento || 0,
      subtotal: l.subtotal, ganancia: l.ganancia || 0,
      escala_id: l.escalaId || null, escala_nombre: l.escalaNombre || null,
      origen_stock_id: l.origenStockId || null, origen_stock_nombre: l.origenStockNombre || null,
    }));
    let { error: errDet } = await sbClient.from('proforma_detalles').insert(detallesPayload);
    if (errDet) {
      // Reintentar sin combo_id por si la migración aún no llegó a este entorno
      ({ error: errDet } = await sbClient.from('proforma_detalles').insert(
        detallesPayload.map(({ combo_id, ...resto }) => resto)
      ));
    }
    if (errDet) throw errDet;

    closeModal('modal-nueva-proforma');
    showToast(`Proforma ${numero} guardada correctamente`);
    await Promise.allSettled([loadProformas(), loadKPIsProf()]);
  } catch (e) {
    console.error('guardarProforma:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('np-btn-guardar', false);
  }
}

/* =====================================================
   CARGA / ESTADOS AUTOMÁTICOS / TABLA / FILTROS
===================================================== */
function calcularEstadoProforma(p) {
  if (['convertida','rechazada'].includes(p.estado)) return p.estado;
  if (p.fecha_vencimiento && p.fecha_vencimiento < todayISO()) return 'vencida';
  return p.estado;
}

async function loadProformas() {
  const tbody = document.getElementById('prof-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Cargando proformas…</td></tr>`;
  try {
    const { data, error } = await sbClient.from('proformas').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending:false });
    if (error) throw error;

    const lista = data || [];
    const actualizaciones = [];
    lista.forEach(p => {
      const nuevo = calcularEstadoProforma(p);
      if (nuevo !== p.estado) { p.estado = nuevo; actualizaciones.push(p.id); }
    });
    await Promise.allSettled(actualizaciones.map(id => sbClient.from('proformas').update({ estado:'vencida' }).eq('id', id)));

    STATE.proformas = lista;
    STATE.page = 1;
    renderTablaProf();
  } catch (e) {
    console.error('loadProformas:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No se pudieron cargar las proformas</td></tr>`;
  }
}

const ESTADO_PROF_INFO = {
  borrador:   { label:'Borrador',   badge:'badge-borrador' },
  pendiente:  { label:'Pendiente',  badge:'badge-pendiente' },
  enviada:    { label:'Enviada',    badge:'badge-enviada' },
  aprobada:   { label:'Aprobada',   badge:'badge-aprobada' },
  rechazada:  { label:'Rechazada',  badge:'badge-rechazada' },
  vencida:    { label:'Vencida',    badge:'badge-vencido' },
  convertida: { label:'Convertida', badge:'badge-convertida' },
  pago_parcial: { label:'Pago Parcial', badge:'badge-pago-parcial' },
};

function proformasFiltradas() {
  const q = STATE.search.toLowerCase().trim();
  return STATE.proformas.filter(p => {
    if (STATE.filtro !== 'todos' && p.estado !== STATE.filtro) return false;
    if (!q) return true;
    return (p.numero_proforma||'').toLowerCase().includes(q) || (p.cliente_nombre||'').toLowerCase().includes(q);
  });
}

function renderTablaProf() {
  const tbody = document.getElementById('prof-tbody');
  if (!tbody) return;
  const filtradas = proformasFiltradas();
  const totalPag = Math.max(1, Math.ceil(filtradas.length / STATE.perPage));
  STATE.page = Math.min(STATE.page, totalPag);
  const inicio = (STATE.page-1)*STATE.perPage;
  const pagina = filtradas.slice(inicio, inicio+STATE.perPage);

  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No hay proformas con estos filtros</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(p => {
      const ei = ESTADO_PROF_INFO[p.estado] || ESTADO_PROF_INFO.borrador;
      const puedeEditar = !['convertida','pago_parcial'].includes(p.estado);
      const puedeConvertir = !['convertida','rechazada','pago_parcial'].includes(p.estado);
      return `
      <tr>
        <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(p.numero_proforma)}</span></td>
        <td style="font-weight:500">${esc(p.cliente_nombre||'Cliente final')}</td>
        <td>${fmtFecha(p.fecha)}</td>
        <td>${p.fecha_vencimiento?fmtFecha(p.fecha_vencimiento):'—'}</td>
        <td class="td-right td-money">${fmt(p.total)}</td>
        <td><span class="status-badge ${ei.badge}">${ei.label}</span></td>
        <td class="td-actions" style="white-space:nowrap">
          <button class="btn-primary" style="padding:5px 10px;font-size:11.5px;gap:5px" title="Exportar Proforma" onclick="exportarProformaDesdeTabla('${p.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
            Exportar Proforma
          </button>
          <button class="btn-icon" title="Ver" onclick="verDetalleProf('${p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          ${puedeConvertir ? `<button class="btn-icon" title="Convertir a Venta" onclick="abrirConvertirAVenta('${p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>` : ''}
          ${puedeEditar ? `<button class="btn-icon" title="Editar" onclick="abrirEditarProforma('${p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>
          <button class="btn-icon" title="Duplicar" onclick="duplicarProforma('${p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="confirmarEliminarProf('${p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  const info = document.getElementById('paginacion-info');
  if (info) info.textContent = filtradas.length ? `${inicio+1}–${Math.min(inicio+STATE.perPage,filtradas.length)} de ${filtradas.length}` : '—';
  const prev = document.getElementById('btn-pag-prev'); if (prev) prev.disabled = STATE.page<=1;
  const next = document.getElementById('btn-pag-next'); if (next) next.disabled = STATE.page>=totalPag;
}
function setFiltroProf(f) {
  STATE.filtro = f; STATE.page = 1;
  document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => b.classList.toggle('active', b.dataset.filtro===f));
  renderTablaProf();
}
function buscarProf() { STATE.search = document.getElementById('prof-search')?.value || ''; STATE.page = 1; renderTablaProf(); }
function paginaAnterior() { if (STATE.page>1) { STATE.page--; renderTablaProf(); } }
function paginaSiguiente() { STATE.page++; renderTablaProf(); }

/* =====================================================
   DUPLICAR / ELIMINAR
===================================================== */
async function duplicarProforma(id) {
  const p = STATE.proformas.find(x => x.id === id);
  if (!p) return;
  try {
    const { data: detalles } = await sbClient.from('proforma_detalles').select('*').eq('proforma_id', id);
    const numero = await generarNumeroProforma();
    const { data: nueva, error } = await sbClient.from('proformas').insert({
      auth_user_id: STATE.userId, numero_proforma: numero,
      cliente_id: p.cliente_id, cliente_nombre: p.cliente_nombre,
      fecha: todayISO(), fecha_vencimiento: null,
      subtotal: p.subtotal, descuento: p.descuento, impuesto: p.impuesto,
      iva_activo: p.iva_activo, iva_porcentaje: p.iva_porcentaje,
      total: p.total, costo_total: p.costo_total, estado: 'borrador',
      observaciones: p.observaciones,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (error) throw error;

    const nuevosDetalles = (detalles||[]).map(({ id, proforma_id, ...resto }) => ({ ...resto, auth_user_id: STATE.userId, proforma_id: nueva.id }));
    if (nuevosDetalles.length) await sbClient.from('proforma_detalles').insert(nuevosDetalles);

    showToast(`Proforma duplicada como ${numero}`);
    await Promise.allSettled([loadProformas(), loadKPIsProf()]);
  } catch (e) {
    console.error('duplicarProforma:', e);
    showToast('Error al duplicar: ' + (e.message||''), 'error');
  }
}
function confirmarEliminarProf(id) {
  const p = STATE.proformas.find(x => x.id === id);
  if (!p) return;
  if (['convertida','pago_parcial'].includes(p.estado)) { showToast('No se puede eliminar: ya tiene una venta o crédito vinculado', 'error'); return; }
  STATE.proformaActual = p;
  openModal('modal-confirmar-eliminar-prof');
}
async function eliminarProforma() {
  const p = STATE.proformaActual;
  if (!p) return;
  if (['convertida','pago_parcial'].includes(p.estado)) { showToast('No se puede eliminar: ya tiene una venta o crédito vinculado', 'error'); return; }
  setBtnLoading('btn-confirmar-eliminar-prof', true);
  try {
    const { error } = await sbClient.from('proformas').delete().eq('id', p.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Proforma eliminada');
    closeModal('modal-confirmar-eliminar-prof');
    await Promise.allSettled([loadProformas(), loadKPIsProf()]);
  } catch (e) {
    showToast('Error al eliminar: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-confirmar-eliminar-prof', false);
  }
}

/* =====================================================
   KPIs
===================================================== */
async function loadKPIsProf() {
  const p = STATE.proformas;
  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('kpi-total', fmtNum(p.length));
  set('kpi-pendientes', fmtNum(p.filter(x=>['pendiente','enviada','borrador'].includes(x.estado)).length));
  set('kpi-aprobadas', fmtNum(p.filter(x=>x.estado==='aprobada').length));
  set('kpi-rechazadas', fmtNum(p.filter(x=>x.estado==='rechazada').length));
  set('kpi-vencidas', fmtNum(p.filter(x=>x.estado==='vencida').length));
  set('kpi-convertidas', fmtNum(p.filter(x=>x.estado==='convertida').length));
  set('kpi-monto-total', fmt(p.reduce((s,x)=>s+Number(x.total||0),0)));
}

/* =====================================================
   VER DETALLE
===================================================== */
// Exporta el PDF directo desde el botón de la tabla, sin necesidad de
// abrir el modal de detalle primero.
function exportarProformaDesdeTabla(id) {
  const p = STATE.proformas.find(x => x.id === id);
  if (!p) return;
  STATE.proformaActual = p;
  showToast(`Generando PDF de ${p.numero_proforma}…`);
  descargarPdfProformaActual();
}

function editarFechaProforma(proformaId) {
  const p = STATE.proformas.find(x => x.id === proformaId);
  if (!p) return;
  const cont = document.getElementById('det-prof-fecha-display');
  if (!cont) return;
  cont.innerHTML = `
    <input type="date" id="det-prof-fecha-input" class="form-input" value="${(p.fecha||'').slice(0,10)}" style="width:150px;display:inline-block"/>
    <button class="btn-icon" style="width:22px;height:22px;display:inline-flex" title="Guardar" onclick="guardarFechaProforma('${proformaId}')">✅</button>
    <button class="btn-icon" style="width:22px;height:22px;display:inline-flex" title="Cancelar" onclick="verDetalleProf('${proformaId}')">✕</button>
  `;
}

async function guardarFechaProforma(proformaId) {
  const input = document.getElementById('det-prof-fecha-input');
  const nuevaFecha = input?.value;
  if (!nuevaFecha) { showToast('Elige una fecha', 'error'); return; }

  try {
    await sbClient.from('proformas').update({ fecha: nuevaFecha }).eq('id', proformaId).eq('auth_user_id', STATE.userId);
    const p = STATE.proformas.find(x => x.id === proformaId);
    if (p) p.fecha = nuevaFecha;
    showToast('Fecha actualizada');
    await loadProformas();
    verDetalleProf(proformaId);
  } catch (e) {
    console.error('guardarFechaProforma:', e);
    showToast('No se pudo actualizar la fecha', 'error');
  }
}

async function verDetalleProf(id) {
  const p = STATE.proformas.find(x => x.id === id);
  if (!p) return;
  STATE.proformaActual = p;
  document.getElementById('det-prof-title').textContent = `Proforma ${p.numero_proforma}`;
  const btnConvertir = document.getElementById('det-prof-btn-convertir');
  const btnPagoParcial = document.getElementById('det-prof-btn-pago-parcial');
  const bloqueada = ['convertida','rechazada','pago_parcial'].includes(p.estado);
  btnConvertir.style.display = bloqueada ? 'none' : 'inline-flex';
  if (btnPagoParcial) btnPagoParcial.style.display = bloqueada ? 'none' : 'inline-flex';
  const body = document.getElementById('detalle-prof-body');
  body.innerHTML = 'Cargando…';
  openModal('modal-detalle-proforma');

  try {
    const { data: detalles } = await sbClient.from('proforma_detalles').select('*').eq('proforma_id', id);
    STATE.detalleActual = detalles || [];
    const ei = ESTADO_PROF_INFO[p.estado] || ESTADO_PROF_INFO.borrador;

    let html = `
      <div class="form-row">
        <div><label>Cliente</label><div class="stat-readonly">${esc(p.cliente_nombre||'Cliente final')}</div></div>
        <div><label>Fecha</label><div class="stat-readonly" id="det-prof-fecha-display">
          ${fmtFecha(p.fecha)}
          <button class="btn-icon" style="width:20px;height:20px;display:inline-flex;vertical-align:middle" title="Editar fecha" onclick="editarFechaProforma('${p.id}')">✏️</button>
        </div></div>
        <div><label>Válida hasta</label><div class="stat-readonly">${p.fecha_vencimiento?fmtFecha(p.fecha_vencimiento):'—'}</div></div>
        <div><label>Estado</label><div class="stat-readonly"><span class="status-badge ${ei.badge}">${ei.label}</span></div></div>
        <div><label>Total</label><div class="stat-readonly" style="font-weight:800;color:var(--accent)">${fmt(p.total)}</div></div>
      </div>
      ${p.estado==='convertida' ? `<p style="margin-top:10px;font-size:12.5px;color:var(--success)">✅ Convertida a venta el ${fmtFecha((p.fecha_conversion||'').slice(0,10))} por ${esc(p.convertido_por||'—')}.</p>` : ''}
      ${p.estado==='pago_parcial' ? `<p style="margin-top:10px;font-size:12.5px;color:var(--warning)">💳 Con pago parcial desde el ${fmtFecha((p.fecha_pago_parcial||'').slice(0,10))} — el cobro del resto se hace desde <a href="creditos.html" target="_blank" style="color:var(--accent);text-decoration:underline">Créditos</a>, ya no desde aquí.</p>` : ''}
      ${p.observaciones ? `<p style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)"><strong>Notas:</strong> ${esc(p.observaciones)}</p>` : ''}
      <div class="table-wrap" style="margin-top:14px">
        <table><thead><tr><th>Ítem</th><th class="th-right">Cant.</th><th class="th-right">Precio</th><th class="th-right">Subtotal</th></tr></thead>
        <tbody>${STATE.detalleActual.map(d => `<tr>
          <td>${esc(d.producto_nombre)}</td><td class="td-right">${fmtNum(d.cantidad)}</td>
          <td class="td-right td-money">${fmt(d.precio)}</td><td class="td-right td-money">${fmt(d.subtotal)}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty-cell">Sin ítems</td></tr>'}</tbody></table>
      </div>`;
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = 'No se pudo cargar el detalle.';
  }
}

/* =====================================================
   CONVERTIR A VENTA — misma secuencia que confirmarVenta() en ventas.js
===================================================== */
function abrirConvertirAVenta(id) {
  const p = STATE.proformas.find(x => x.id === id);
  if (!p) return;
  STATE.proformaActual = p;
  document.getElementById('cv-error').textContent = '';
  loadMetodosPago();
  openModal('modal-convertir-venta');
}
/* =====================================================
   PAGO PARCIAL / A CRÉDITO — abre Créditos incrustado, con el
   cliente y los productos de la proforma ya cargados. Nunca se
   calcula el crédito aquí: se crea con el mismo formulario real de
   Créditos, y esta pantalla solo reacciona cuando ya se creó de verdad.
===================================================== */
function abrirPagoParcial() {
  const p = STATE.proformaActual;
  if (!p) return;
  const items = (STATE.detalleActual || []).map(d => ({
    producto_id: d.producto_id, nombre: d.producto_nombre, tipo_item: d.tipo_item,
    precio: d.precio, costo: d.costo, cantidad: d.cantidad,
    escala_id: d.escala_id, escala_nombre: d.escala_nombre, combo_id: d.combo_id,
    origen_stock_id: d.origen_stock_id, origen_stock_nombre: d.origen_stock_nombre,
  }));
  const payload = { proformaId: p.id, numeroProforma: p.numero_proforma, clienteId: p.cliente_id, items };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));

  closeModal('modal-detalle-proforma');
  document.getElementById('pp-iframe-embebido').src = `creditos.html?desde_proforma=${encoded}`;
  document.getElementById('pp-modal-embebido').style.display = 'flex';
}
function cerrarPagoParcialEmbebido() {
  document.getElementById('pp-modal-embebido').style.display = 'none';
  document.getElementById('pp-iframe-embebido').src = 'about:blank';
}

// Créditos avisa aquí cuando el crédito ya se creó de verdad — recién
// ahí se marca la proforma como "Pago Parcial" y queda bloqueada para
// cobrar desde aquí.
window.addEventListener('message', async (ev) => {
  if (!ev.data || ev.data.tipo !== 'n360_credito_desde_proforma') return;
  const { creditoId, proformaId, ventaId } = ev.data;
  cerrarPagoParcialEmbebido();
  try {
    // BUG REAL CORREGIDO: antes solo se guardaba el credito_id -- la
    // proforma nunca quedaba enlazada a la venta real que este mismo
    // flujo crea internamente (confirmado con un caso real: la venta
    // ya existia completa, pero la proforma se quedaba sin saber cual
    // era, mostrando "pago parcial" sin ningun enlace para siempre).
    // Ahora tambien se guarda venta_id, igual que hace la conversion
    // normal a venta -- para que la proforma siempre pueda mostrar y
    // enlazar a su venta real, sin importar por cual camino se creo.
    await sbClient.from('proformas').update({
      estado: 'pago_parcial', credito_id: creditoId, venta_id: ventaId || null, fecha_pago_parcial: new Date().toISOString(),
    }).eq('id', proformaId).eq('auth_user_id', STATE.userId);
    showToast('✅ Proforma con pago parcial — el resto se cobra desde Créditos');
    await Promise.allSettled([loadProformas(), loadKPIsProf()]);
  } catch (e) {
    console.error('Error al marcar proforma como pago_parcial:', e);
    showToast('El crédito se creó, pero no se pudo actualizar la proforma — revísalo manualmente', 'error');
  }
});

function abrirConvertirDesdeDetalle() {
  const p = STATE.proformaActual;
  closeModal('modal-detalle-proforma');
  if (p) abrirConvertirAVenta(p.id);
}

/* ===================================================
   CONFIGURAR TICKET DE IMPRESIÓN — misma tabla que usa Ventas
   (configuracion_venta_rapida), compartida por todo el sistema.
=================================================== */
STATE.configTicket = null;
async function cargarConfigTicket() {
  try {
    const { data } = await sbClient.from('configuracion_venta_rapida').select('*').eq('auth_user_id', STATE.userId).maybeSingle();
    STATE.configTicket = data || null;
  } catch (e) { STATE.configTicket = null; }
}
async function abrirConfigTicket() {
  if (!STATE.configTicket) await cargarConfigTicket();
  const c = STATE.configTicket || {};
  document.querySelectorAll('input[name="ct-ancho"]').forEach(r => { r.checked = (r.value === (c.ancho_ticket || '80mm')); });
  document.getElementById('ct-nombre').value    = c.nombre_ticket    || '';
  document.getElementById('ct-ruc').value       = c.ruc_ticket       || '';
  document.getElementById('ct-telefono').value  = c.telefono_ticket || '';
  document.getElementById('ct-direccion').value = c.direccion_ticket|| '';
  document.getElementById('ct-mensaje').value   = c.mensaje_pie_ticket || 'Gracias por su compra';
  openModal('modal-config-ticket');
}
async function guardarConfigTicket() {
  const ancho = document.querySelector('input[name="ct-ancho"]:checked')?.value || '80mm';
  const payload = {
    auth_user_id: STATE.userId, configurado: true,
    ancho_ticket: ancho,
    nombre_ticket: document.getElementById('ct-nombre').value.trim() || null,
    ruc_ticket: document.getElementById('ct-ruc').value.trim() || null,
    telefono_ticket: document.getElementById('ct-telefono').value.trim() || null,
    direccion_ticket: document.getElementById('ct-direccion').value.trim() || null,
    mensaje_pie_ticket: document.getElementById('ct-mensaje').value.trim() || 'Gracias por su compra',
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await sbClient.from('configuracion_venta_rapida')
      .upsert(payload, { onConflict: 'auth_user_id' }).select('*').single();
    if (error) throw error;
    STATE.configTicket = data;
    closeModal('modal-config-ticket');
    showToast('Configuración del ticket guardada', 'success');
  } catch (e) {
    console.error('guardarConfigTicket:', e);
    showToast('No se pudo guardar la configuración', 'error');
  }
}

/* ===================================================
   COMPROBANTE DE LA VENTA (al convertir una proforma) — mismo
   formato tipo ticket que usa Créditos, respetando el tamaño de
   papel configurado.
=================================================== */
function mostrarComprobanteProforma(v) {
  STATE.ultimoComprobante = v;
  const c = STATE.configTicket;
  const logoUrl = STATE.empresaConfig?.logo_principal_url || STATE.empresaConfig?.logo_url || '';
  const anchoTicket = c?.ancho_ticket || '80mm';
  const logoMaxW = anchoTicket === '58mm' ? 70 : anchoTicket === '76mm' ? 85 : anchoTicket === 'carta' ? 130 : 95;
  const filasItems = (v.items || []).map(it => `
    <div class="tp-row"><span>${esc(it.cantidad)} × ${esc(it.producto_nombre)}</span><b>${fmt(it.subtotal)}</b></div>
  `).join('');
  document.getElementById('comprobante-body').innerHTML = `
    <div class="ticket-print">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" style="display:block;max-width:${logoMaxW}px;max-height:70px;object-fit:contain;margin:0 auto 6px" onerror="this.style.display='none'"/>` : ''}
      <div style="text-align:center;font-weight:800;margin-bottom:4px">${esc(c?.nombre_ticket || STATE.empresaConfig?.nombre_comercial || 'Mi negocio')}</div>
      ${c?.ruc_ticket ? `<div style="text-align:center;font-size:11px;color:var(--text-muted)">RUC: ${esc(c.ruc_ticket)}</div>` : ''}
      ${c?.telefono_ticket ? `<div style="text-align:center;font-size:11px;color:var(--text-muted)">Tel: ${esc(c.telefono_ticket)}</div>` : ''}
      ${c?.direccion_ticket ? `<div style="text-align:center;font-size:11px;color:var(--text-muted)">${esc(c.direccion_ticket)}</div>` : ''}
      <div style="text-align:center;color:var(--text-muted);margin-bottom:8px">Comprobante de venta ${v.origenProforma ? '(desde proforma ' + esc(v.origenProforma) + ')' : ''}</div>
      <hr/>
      <div class="tp-row"><span>N° venta:</span><b>${esc(v.numero)}</b></div>
      <div class="tp-row"><span>Cliente:</span><b>${esc(v.cliente)}</b></div>
      <div class="tp-row"><span>Fecha:</span><b>${esc(fmtFecha(v.fecha))}</b></div>
      <div class="tp-row"><span>Usuario:</span><b>${esc(v.usuario)}</b></div>
      <hr/>
      ${filasItems}
      <hr/>
      <div class="tp-row"><span>Subtotal:</span><b>${fmt(v.subtotal)}</b></div>
      ${v.descuento > 0 ? `<div class="tp-row"><span>Descuento:</span><b>-${fmt(v.descuento)}</b></div>` : ''}
      ${v.impuesto > 0 ? `<div class="tp-row"><span>Impuesto:</span><b>${fmt(v.impuesto)}</b></div>` : ''}
      <div class="tp-row" style="font-weight:800"><span>Total:</span><b>${fmt(v.total)}</b></div>
      <div class="tp-row"><span>Método de pago:</span><b>${esc(v.metodo)}</b></div>
      ${c?.mensaje_pie_ticket ? `<hr/><div style="text-align:center;font-size:11px;color:var(--text-muted)">${esc(c.mensaje_pie_ticket)}</div>` : ''}
    </div>`;
  openModal('modal-comprobante');
}
function imprimirComprobanteProforma() {
  const esEpson = STATE.configTicket?.ancho_ticket === 'epson_tmu220';
  const ancho = esEpson ? '76mm' : (STATE.configTicket?.ancho_ticket || '80mm');
  const fontFamily = esEpson ? "'Courier New', Courier, monospace" : 'Arial,Helvetica,sans-serif';

  // Igual que en Ventas y Créditos: solo si el negocio eligió
  // "Carta / A4" a propósito se genera el comprobante profesional
  // real, nunca para quien tenga 58/76/80mm configurado.
  if (ancho === 'carta') {
    (async () => {
      try {
        const v = STATE.ultimoComprobante;
        if (!v) throw new Error('No hay comprobante para imprimir');
        const doc = await generarComprobanteCartaPDF('venta', {
          userId: STATE.userId, numero: v.numero, fecha: fmtFecha(v.fecha),
          cliente_nombre: v.cliente, subtotal: v.subtotal, descuento: v.descuento,
          impuesto: v.impuesto, total: v.total, metodo_pago: v.metodo,
          observaciones: v.origenProforma ? `Generado a partir de la proforma ${v.origenProforma}` : '',
          empresaNombre: STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio',
          empresaDireccion: STATE.empresaConfig?.direccion || '', empresaTelefono: STATE.empresaConfig?.telefono || STATE.empresaConfig?.whatsapp || '',
          empresaRuc: STATE.empresaConfig?.ruc || '', moneda_simbolo: STATE.empresaConfig?.moneda_simbolo || 'C$',
        }, (v.items||[]).map(it => ({
          nombre: it.producto_nombre, cantidad: it.cantidad,
          precio: it.cantidad > 0 ? round2(it.subtotal / it.cantidad) : it.subtotal,
          descuento: 0, subtotal: it.subtotal,
        })));
        doc.save(`Comprobante_${v.numero}.pdf`);
      } catch (e) {
        console.warn('No se pudo generar el comprobante carta:', e);
        showToast('No se pudo generar el comprobante', 'error');
      }
    })();
    return;
  }

  const html = document.getElementById('comprobante-body').innerHTML;
  const anchoPx = ancho === '58mm' ? '220px' : ancho === '76mm' ? '280px' : '300px';
  const fs = ancho === '58mm' ? 11 : 12.5;
  const w = window.open('', '_blank', 'width=380,height=600');
  w.document.write(`<html><head><meta charset="UTF-8"><title>Comprobante</title>
    <style>body{font-family:${fontFamily};font-size:${fs}px;padding:16px;max-width:${anchoPx};margin:0 auto${esEpson ? ';line-height:1.3' : ''}}.tp-row{display:flex;justify-content:space-between;gap:10px}hr{border:none;border-top:1px dashed #999;margin:8px 0}</style>
    </head><body>${html}<script>window.print();</script></body></html>`);
  w.document.close();
}

async function confirmarConvertirAVenta() {
  // BUG REAL CORREGIDO: convertir la misma proforma dos veces (doble
  // clic, o dos pestañas abiertas) creaba DOS ventas distintas
  // apuntando a la misma proforma, sin que el sistema lo detectara.
  // Candado contra doble clic, mas una verificacion fresca contra la
  // base de datos (no solo lo que ya estaba en memoria) antes de
  // crear nada -- si ya se convirtio por otro lado, se avisa y no se
  // duplica.
  if (STATE.convirtiendoProforma) return;
  STATE.convirtiendoProforma = true;

  const errEl = document.getElementById('cv-error');
  errEl.textContent = '';
  const p = STATE.proformaActual;
  if (!p) { STATE.convirtiendoProforma = false; return; }

  setBtnLoading('btn-confirmar-convertir', true);
  try {
    const { data: pFresca, error: errFresca } = await sbClient.from('proformas')
      .select('estado, venta_id').eq('id', p.id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (errFresca) throw errFresca;
    if (pFresca?.estado === 'convertida') {
      errEl.textContent = 'Esta proforma ya se convirtió a venta (puede que en otra pestaña) — no se creó una venta nueva.';
      closeModal('modal-convertir-venta');
      await loadProformas();
      return;
    }

    const { data: detalles, error: errDet0 } = await sbClient.from('proforma_detalles').select('*').eq('proforma_id', p.id);
    if (errDet0) throw errDet0;
    if (!detalles || !detalles.length) throw new Error('Esta proforma no tiene productos');

    const metodoSel = document.getElementById('cv-metodo-pago');
    const metodoId = metodoSel?.value || null;
    const metodoNombre = metodoSel?.selectedOptions[0]?.dataset.nombre || 'Efectivo';

    // ---- B: número de venta ----
    const { data: numeroVenta } = await sbClient.rpc('generar_numero_venta', { p_user_id: STATE.userId });

    // ---- C: insertar venta (mismas columnas que confirmarVenta) ----
    const ventaPayload = {
      auth_user_id: STATE.userId, numero_venta: numeroVenta || `V-${Date.now()}`,
      cliente_id: p.cliente_id || null, cliente_nombre: p.cliente_nombre,
      fecha: todayISO(), subtotal: p.subtotal, descuento: p.descuento, impuesto: p.impuesto,
      total: p.total, costo_total: p.costo_total,
      metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
      estado: 'completada', observaciones: p.observaciones || null,
      iva_activo: p.iva_activo, iva_porcentaje: p.iva_activo ? p.iva_porcentaje : 0,
      proforma_id: p.id,
      creado_por_nombre: obtenerNombrePerfilActivo(),
    };
    const { data: ventaNueva, error: errVenta } = await sbClient.from('ventas').insert(ventaPayload).select('id').single();
    if (errVenta) throw errVenta;
    const ventaId = ventaNueva.id;

    // ---- D: detalles de venta ----
    // Para marcar qué líneas se están vendiendo por encima de lo
    // disponible (trazabilidad, igual que en Ventas), se consulta el
    // stock real de los productos involucrados ANTES de insertar —
    // esto es solo lectura, no afecta en nada al descuento real que
    // ocurre después en el paso E (ese sigue exactamente igual).
    const idsProductoParaStock = [...new Set(detalles.filter(d => d.tipo_item === 'producto' && d.producto_id && !d.origen_stock_id).map(d => d.producto_id))];
    let stockPorProducto = {};
    if (idsProductoParaStock.length) {
      const { data: prodsStock } = await sbClient.from('productos').select('id,stock_actual')
        .in('id', idsProductoParaStock).eq('auth_user_id', STATE.userId);
      (prodsStock || []).forEach(p => { stockPorProducto[p.id] = Number(p.stock_actual || 0); });
    }

    const detallesVenta = detalles.map(d => ({
      auth_user_id: STATE.userId, venta_id: ventaId, producto_id: d.producto_id, combo_id: d.combo_id || null,
      producto_nombre: d.producto_nombre, producto_sku: d.producto_sku, tipo_item: d.tipo_item,
      cantidad: d.cantidad, precio: d.precio, costo: d.costo, descuento: d.descuento,
      subtotal: d.subtotal, ganancia: d.ganancia, escala_id: d.escala_id, escala_nombre: d.escala_nombre,
      vendido_sin_stock: d.tipo_item === 'producto' && d.producto_id && !d.origen_stock_id
        ? Number(d.cantidad) > (stockPorProducto[d.producto_id] ?? Infinity)
        : false,
    }));
    let { error: errDetV } = await sbClient.from('venta_detalles').insert(detallesVenta);
    if (errDetV) {
      // Reintentar sin combo_id/vendido_sin_stock por si la migración aún no llegó a este entorno
      ({ error: errDetV } = await sbClient.from('venta_detalles').insert(
        detallesVenta.map(({ combo_id, vendido_sin_stock, ...resto }) => resto)
      ));
    }
    if (errDetV) throw errDetV;

    // ---- E: descontar stock (productos normales) ----
    for (const d of detalles.filter(x => x.tipo_item === 'producto' && x.producto_id)) {
      if (d.origen_stock_id) {
        // Stock Compartido: se descuenta de OTRA cuenta del grupo.
        try {
          const { error: errRemoto } = await sbClient.rpc('descontar_stock_remoto', {
            p_sucursal_id: d.origen_stock_id, p_nombre_producto: d.producto_nombre, p_cantidad: d.cantidad,
          });
          if (errRemoto) console.warn('Error descontando stock remoto:', d.producto_nombre, errRemoto);
        } catch (eRemoto) { console.warn('Error descontando stock remoto:', d.producto_nombre, eRemoto); }
        continue;
      }
      const { data: prod } = await sbClient.from('productos').select('stock_actual').eq('id', d.producto_id).maybeSingle();
      if (prod) {
        const nuevoStock = Math.max(0, Number(prod.stock_actual||0) - Number(d.cantidad));
        await sbClient.from('productos').update({ stock_actual: nuevoStock }).eq('id', d.producto_id).eq('auth_user_id', STATE.userId);
      }
    }

    // ---- E-2: combos — descontar el stock de CADA producto que los
    // compone (cantidad del componente × cantidad de combos vendidos).
    for (const d of detalles.filter(x => x.tipo_item === 'combo' && x.combo_id)) {
      try {
        const { data: itemsCombo } = await sbClient.from('combo_items')
          .select('producto_id, cantidad').eq('combo_id', d.combo_id).eq('auth_user_id', STATE.userId);
        for (const compItem of (itemsCombo || [])) {
          const { data: prodActual } = await sbClient.from('productos')
            .select('stock_actual').eq('id', compItem.producto_id).eq('auth_user_id', STATE.userId).maybeSingle();
          if (!prodActual) continue;
          const descuentoTotal = Number(compItem.cantidad) * Number(d.cantidad);
          const nuevoStock = Math.max(0, Number(prodActual.stock_actual || 0) - descuentoTotal);
          await sbClient.from('productos').update({ stock_actual: nuevoStock })
            .eq('id', compItem.producto_id).eq('auth_user_id', STATE.userId);
        }
      } catch (eCombo) {
        console.warn('No se pudo descontar el stock de los componentes del combo:', d.producto_nombre, eCombo);
      }
    }

    // ---- F: movimiento de Caja (mismo criterio que Ventas: neto de IVA) ----
    const montoIva = Number(p.impuesto) || 0;
    const montoCaja = Number(p.total) - montoIva;
    try {
      const { data: ultMov } = await sbClient.from('movimientos_financieros')
        .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
        .order('created_at', { ascending:false }).limit(1).maybeSingle();
      const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
      const saldoRes = saldoAnt + montoCaja;
      const { data: movNuevo } = await sbClient.from('movimientos_financieros').insert({
        auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'VENTA',
        concepto: montoIva>0 ? `Venta ${ventaPayload.numero_venta} (neto de IVA, desde proforma ${p.numero_proforma})` : `Venta ${ventaPayload.numero_venta} (desde proforma ${p.numero_proforma})`,
        monto: montoCaja, saldo_anterior: saldoAnt, saldo_resultante: saldoRes,
        metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
        referencia_tipo: 'venta', referencia_id: ventaId, fecha: todayISO(),
      }).select('id').single();
      if (movNuevo?.id) await sbClient.from('ventas').update({ referencia_caja: movNuevo.id }).eq('id', ventaId);
    } catch (eCaja) { console.warn('No se pudo registrar en caja:', eCaja); }

    // ---- F-2: IVA en Impuestos ----
    if (montoIva > 0) {
      try {
        const { data: ultImp } = await sbClient.from('movimientos_impuestos')
          .select('saldo_resultante').eq('auth_user_id', STATE.userId)
          .order('created_at', { ascending:false }).limit(1).maybeSingle();
        const saldoAnt = ultImp ? Number(ultImp.saldo_resultante) : 0;
        await sbClient.from('movimientos_impuestos').insert({
          auth_user_id: STATE.userId, tipo_movimiento: 'IVA_VENTA',
          concepto: `IVA de venta ${ventaPayload.numero_venta} (desde proforma ${p.numero_proforma})`,
          monto: montoIva, saldo_anterior: saldoAnt, saldo_resultante: saldoAnt + montoIva,
          referencia_venta_id: ventaId, fecha: todayISO(),
        });
      } catch (eImp) { console.warn('No se pudo registrar el IVA:', eImp); }
    }

    // ---- G: actualizar historial del cliente ----
    if (p.cliente_id) {
      try {
        const { data: cliente } = await sbClient.from('clientes').select('total_compras,num_compras').eq('id', p.cliente_id).maybeSingle();
        if (cliente) {
          await sbClient.from('clientes').update({
            total_compras: (Number(cliente.total_compras)||0) + p.total,
            num_compras: (Number(cliente.num_compras)||0) + 1,
          }).eq('id', p.cliente_id).eq('auth_user_id', STATE.userId);
        }
      } catch (eCli) { console.warn('Error actualizando cliente:', eCli); }
    }

    // ---- Actualizar la proforma: convertida, con referencia a la venta ----
    // Se guarda el estado exacto en el que estaba ANTES de convertir
    // (no siempre es el mismo — puede venir de borrador, pendiente,
    // enviada, aprobada, o vencida), para poder devolverla ahí si
    // esta venta se llega a anular más adelante.
    await sbClient.from('proformas').update({
      estado: 'convertida', estado_antes_convertir: p.estado, venta_id: ventaId, fecha_conversion: new Date().toISOString(),
      convertido_por: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);

    try { localStorage.setItem('n360_venta_nueva', JSON.stringify({ ventaId, numero: ventaPayload.numero_venta, total: p.total, ts: Date.now() })); } catch(e) {}

    showToast(`✅ Convertida a Venta ${ventaPayload.numero_venta} — ${fmt(p.total)}`);
    closeModal('modal-convertir-venta');

    // Como esto ya es una venta real (con Caja e inventario afectados),
    // se muestra el mismo tipo de comprobante que usa Ventas — con la
    // opción de imprimir, respetando el tamaño de ticket configurado.
    mostrarComprobanteProforma({
      numero: ventaPayload.numero_venta, cliente: (p.cliente_nombre || 'Consumidor Final'),
      fecha: todayISO(), usuario: STATE.currentUser?.nombre || STATE.userEmail,
      items: detalles, subtotal: p.subtotal, descuento: p.descuento || 0,
      impuesto: p.impuesto || 0, total: p.total, metodo: metodoNombre,
      origenProforma: p.numero_proforma,
    });

    // Como el cliente ya pidió su proforma con la idea de un
    // comprobante formal, al convertirse en venta real se genera de
    // una vez el comprobante tamaño carta correspondiente — mismo
    // estilo que ya usa el sistema, sin que la persona tenga que ir
    // a buscarlo aparte a Ventas.
    try {
      const docCarta = await generarComprobanteCartaPDF('venta', {
        userId: STATE.userId,
        numero: ventaPayload.numero_venta,
        fecha: fmtFecha(todayISO()),
        cliente_nombre: p.cliente_nombre || 'Consumidor Final',
        subtotal: p.subtotal, descuento: p.descuento, impuesto: p.impuesto,
        iva_porcentaje: p.iva_activo ? p.iva_porcentaje : 0, total: p.total,
        metodo_pago: metodoNombre, observaciones: `Generado a partir de la proforma ${p.numero_proforma}`,
        empresaNombre: STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio',
        empresaDireccion: STATE.empresaConfig?.direccion || '',
        empresaTelefono: STATE.empresaConfig?.telefono || STATE.empresaConfig?.whatsapp || '',
        empresaRuc: STATE.empresaConfig?.ruc || '',
        moneda_simbolo: STATE.empresaConfig?.moneda_simbolo || 'C$',
      }, detalles.map(d => ({
        nombre: d.producto_nombre, cantidad: d.cantidad, precio: d.precio,
        descuento: d.descuento, subtotal: d.subtotal,
      })));
      docCarta.save(`Comprobante_${ventaPayload.numero_venta}.pdf`);
    } catch (eCarta) {
      console.warn('No se pudo generar el comprobante tamaño carta automático:', eCarta);
    }

    await Promise.allSettled([loadProformas(), loadKPIsProf()]);
  } catch (e) {
    console.error('confirmarConvertirAVenta:', e);
    errEl.textContent = 'Error al convertir: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-confirmar-convertir', false);
    STATE.convirtiendoProforma = false;
  }
}

/* =====================================================
   PDF — hoja completa tamaño carta/A4, con toda la información
   de la proforma (mismo estilo de marca que usa el sistema:
   franja de color con el nombre del negocio + tabla de ítems).
===================================================== */
/* ---- LOGO EN PDF ----
   Descarga el logo del negocio (Personalización/Editar Perfil) y lo
   convierte a base64 para dibujarlo con doc.addImage(). Si falla por
   cualquier motivo (sin logo, SVG no soportado, error de red), se
   devuelve null y el PDF se genera igual, solo sin la imagen.
===================================================== */
// Convierte un color "#RRGGBB" a [r,g,b] para jsPDF. Si el color no
// es válido o no está configurado, devuelve null y el que llama usa
// su propio color por defecto — nunca rompe el PDF por esto.
function hexARgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const num = parseInt(m[1], 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Calcula el tamaño real que debe dibujarse el logo dentro de un
// espacio máximo (maxAncho x maxAlto), respetando su proporción
// original — nunca lo estira ni lo aplasta.
function ajustarLogoSinDeformar(anchoNatural, altoNatural, maxAncho, maxAlto) {
  const escala = Math.min(maxAncho / (anchoNatural || 1), maxAlto / (altoNatural || 1));
  return { w: round2ForLogo((anchoNatural || 1) * escala), h: round2ForLogo((altoNatural || 1) * escala) };
}
function round2ForLogo(n) { return Math.round(n * 100) / 100; }

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

    // Se intenta recortar el espacio transparente sobrante — si el
    // logo tiene mucho margen invisible (muy común), esto es lo que
    // realmente hace que se vea grande de verdad, no solo la caja.
    const recortado = await recortarTransparenciaLogo(dataUrl, formato);
    if (recortado) return { dataUrl: recortado.dataUrl, formato: 'PNG', anchoNatural: recortado.anchoNatural, altoNatural: recortado.altoNatural };

    return { dataUrl, formato, anchoNatural, altoNatural };
  } catch (e) {
    console.warn('No se pudo cargar el logo para el PDF:', e);
    return null;
  }
}

async function generarPDFProforma(p, items, cliente) {
  if (!window.jspdf) throw new Error('jsPDF no está disponible');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const logo = await cargarLogoParaPDF();
  if (!STATE.configProforma) await cargarConfigProforma();
  const cfg = STATE.configProforma;

  const biz = {
    nombre:    STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio',
    direccion: cfg.mostrar_direccion !== false ? (STATE.empresaConfig?.direccion || '') : '',
    telefono:  cfg.mostrar_telefono !== false ? (STATE.empresaConfig?.telefono || STATE.empresaConfig?.whatsapp || '') : '',
    ruc:       cfg.mostrar_ruc !== false ? (STATE.empresaConfig?.ruc || '') : '',
  };

  // ---- Encabezado (franja con el color de marca del negocio — antes
  // era un morado fijo, ahora usa el mismo color que ya configuran en
  // Perfil, para que el documento se sienta de ellos, no de Negocio360) ----
  const [rC, gC, bC] = hexARgb(cfg.color_principal) || [108, 99, 255];
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
    } catch (e) { /* si falla, se sigue sin logo */ }
  }
  doc.setTextColor(255, 255, 255);
  // El tamaño de letra del nombre se ajusta solo si no cabe en el
  // espacio disponible (entre el logo y la info de la derecha) — así
  // un logo grande + un nombre largo nunca se encima con nada.
  const anchoDisponibleNombre = (W - M - 40) - textoX;
  let tamanoNombre = 20;
  doc.setFont(undefined, 'bold');
  while (tamanoNombre > 12) {
    doc.setFontSize(tamanoNombre);
    if (doc.getTextWidth(biz.nombre) <= anchoDisponibleNombre) break;
    tamanoNombre -= 1;
  }
  doc.text(biz.nombre, textoX, 20);
  doc.setFontSize(11); doc.setFont(undefined, 'normal');
  doc.text('Proforma / Cotización', textoX, 29);
  doc.setFontSize(9);
  doc.text(`N.º ${p.numero_proforma || '—'}`, W - M, 18, { align: 'right' });
  doc.text(`Fecha: ${fmtFecha(p.fecha)}`, W - M, 24, { align: 'right' });
  if (p.fecha_vencimiento) doc.text(`Válida hasta: ${fmtFecha(p.fecha_vencimiento)}`, W - M, 30, { align: 'right' });

  let y = 50;
  doc.setTextColor(20, 20, 30);

  // ---- Datos del negocio (dirección/teléfono/RUC) y del cliente, lado a lado ----
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
  const infoNegocio = [biz.direccion, biz.telefono ? `Tel: ${biz.telefono}` : '', biz.ruc ? `RUC: ${biz.ruc}` : ''].filter(Boolean);
  infoNegocio.forEach((linea, i) => doc.text(linea, M, y + i*5));

  doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(20,20,30);
  doc.text('Cliente', W - M - 70, y);
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
  const infoCliente = [
    p.cliente_nombre || 'Cliente final',
    cliente?.telefono ? `Tel: ${cliente.telefono}` : '',
    cliente?.correo ? cliente.correo : '',
  ].filter(Boolean);
  infoCliente.forEach((linea, i) => doc.text(linea, W - M - 70, y + 5 + i*5));

  y += Math.max(infoNegocio.length, infoCliente.length + 1) * 5 + 10;
  doc.setDrawColor(230,230,235);
  doc.line(M, y, W - M, y);
  y += 8;

  // ---- Estado ----
  const ei = ESTADO_PROF_INFO[p.estado] || ESTADO_PROF_INFO.borrador;
  doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(rC, gC, bC);
  doc.text(`Estado: ${ei.label}`, M, y);
  y += 10;

  // ---- Tabla de ítems ----
  const filas = (items||[]).map(it => [
    it.producto_nombre || 'Ítem',
    Number(it.cantidad).toLocaleString('es-NI', { maximumFractionDigits: 2 }),
    fmt(it.precio),
    Number(it.descuento) > 0 ? fmt(it.descuento) : '—',
    fmt(it.subtotal),
  ]);
  doc.autoTable({
    startY: y,
    head: [['Descripción', 'Cant.', 'Precio unit.', 'Descuento', 'Subtotal']],
    body: filas,
    theme: 'striped',
    headStyles: { fillColor: hexARgb(cfg.color_tabla_usa_mismo !== false ? cfg.color_principal : cfg.color_tabla) || [108, 99, 255] },
    styles: { fontSize: 9.5, cellPadding: 3.5 },
    columnStyles: { 1: { halign:'right' }, 2: { halign:'right' }, 3: { halign:'right' }, 4: { halign:'right' } },
    margin: { left: M, right: M },
  });

  let finalY = doc.lastAutoTable.finalY + 10;

  // ---- Totales (alineados a la derecha) ----
  const anchoTotales = 75;
  const xEtiqueta = W - M - anchoTotales, xValor = W - M;
  const filaTotal = (label, val, big) => {
    doc.setFontSize(big ? 13 : 10);
    doc.setFont(undefined, big ? 'bold' : 'normal');
    doc.setTextColor(big ? 108 : 90, big ? 99 : 90, big ? 255 : 110);
    doc.text(label, xEtiqueta, finalY);
    doc.text(val, xValor, finalY, { align: 'right' });
    finalY += big ? 8 : 6.5;
  };
  filaTotal('Subtotal:', fmt(p.subtotal));
  if (Number(p.descuento) > 0) filaTotal('Descuento:', '-' + fmt(p.descuento));
  if (Number(p.impuesto) > 0) filaTotal(`Impuesto${p.iva_porcentaje?` (${Number(p.iva_porcentaje)}%)`:''}:`, fmt(p.impuesto));
  doc.setDrawColor(230,230,235);
  doc.line(xEtiqueta, finalY - 4, xValor, finalY - 4);
  filaTotal('TOTAL:', fmt(p.total), true);

  finalY += 6;
  doc.setTextColor(20,20,30);

  // ---- Observaciones ----
  if (p.observaciones) {
    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text('Observaciones', M, finalY);
    finalY += 6;
    doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
    doc.splitTextToSize(p.observaciones, W - M*2).forEach(ln => { doc.text(ln, M, finalY); finalY += 5; });
    finalY += 4;
  }

  // ---- Pie de página ----
  const alturaPagina = doc.internal.pageSize.getHeight();
  let yPie = alturaPagina - 16;
  const mensajePie = cfg.mensaje_pie;
  if (mensajePie) {
    doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
    const lineasPie = doc.splitTextToSize(mensajePie, W - M*2);
    yPie -= (lineasPie.length - 1) * 4.5;
    lineasPie.forEach(ln => { doc.text(ln, M, yPie); yPie += 4.5; });
    yPie += 5;
  }
  doc.setFontSize(8.5); doc.setTextColor(150,150,170);
  doc.text(`Cotización sujeta a disponibilidad · Precios en ${sym()} · Generado por Negocio360`, M, yPie);

  return doc;
}
async function descargarPdfProformaActual() {
  const p = STATE.proformaActual;
  if (!p) return;
  try {
    // Siempre se pide fresco por proforma_id — nunca se reutiliza
    // STATE.detalleActual (podría ser el de OTRA proforma vista antes).
    const { data: itemsFrescos } = await sbClient.from('proforma_detalles').select('*').eq('proforma_id', p.id);
    const items = itemsFrescos || [];
    let cliente = null;
    if (p.cliente_id) {
      const { data } = await sbClient.from('clientes').select('telefono,correo').eq('id', p.cliente_id).maybeSingle();
      cliente = data || null;
    }
    const doc = await generarPDFProforma(p, items, cliente);
    doc.save(`Proforma_${(p.numero_proforma||'proforma').replace(/[^\w\-]/g,'')}.pdf`);
  } catch (e) {
    console.error('descargarPdfProformaActual:', e);
    showToast('No se pudo generar el PDF', 'error');
  }
}
async function compartirProformaActual() {
  const p = STATE.proformaActual;
  if (!p) return;
  const texto = `Proforma ${p.numero_proforma} — ${p.cliente_nombre||'Cliente'} — Total: ${fmt(p.total)}`;
  try {
    if (navigator.share) { await navigator.share({ title: `Proforma ${p.numero_proforma}`, text: texto }); }
    else { await navigator.clipboard.writeText(texto); showToast('Copiado al portapapeles'); }
  } catch (e) { /* el usuario canceló el share, no es error */ }
}

/* =====================================================
   MODAL / TOAST / UI HELPERS (idénticos al resto del sistema)
===================================================== */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; }
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) { e.target.style.display='none'; document.body.style.overflow=''; }
});
function showToast(msg, type='success') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type} toast-show`;
  clearTimeout(el._timer); el._timer = setTimeout(()=>el.classList.remove('toast-show'), 3500);
}
function setBtnLoading(id, loading) {
  const el = document.getElementById(id); if (!el) return;
  el.disabled = loading; el.style.opacity = loading ? '0.6' : '1';
}

/* =====================================================
   INIT
===================================================== */
async function initProformas() {
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id; STATE.userEmail = user.email;
    if (user.email) checkAdminAccess(user.email);
    await cargarEstadoStockCompartido();
    await cargarConfigTicket();

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.allSettled([loadMetodosPago(), loadClientes(), loadProductos()]);
    await loadProformas();
    await loadKPIsProf();
  } catch (err) {
    console.error('initProformas:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initProformas();
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
