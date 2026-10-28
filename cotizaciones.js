/* =====================================================
   COTIZACIONES.JS — NEGOCIO360
   Cotizaciones que se pueden convertir en una Venta real.

   ARQUITECTURA:
     - Crear una cotización NUNCA toca inventario, Caja ni Impuestos
       (solo guarda cotizaciones + proforma_detalles).
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

  cotizaciones: [],
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
// convirtio esta cotización en venta.
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


async function loadClientes() {
  try {
    const { data } = await N360Leer.todo(() => sbClient.from('clientes').select('id,nombre,apellido,telefono,correo,total_compras,num_compras,contactos')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre'), 'clientes');
    STATE.clientes = data || [];
    llenarSelectClientes();
  } catch (e) { console.warn('loadClientes:', e); }
}
function llenarSelectClientes() {
  const opciones = `<option value="">— Cliente final (sin registrar) —</option>` +
    STATE.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}${c.telefono?' — '+esc(c.telefono):''}</option>`).join('');
  const sel = document.getElementById('np-cliente-select');
  if (sel) {
    sel.innerHTML = opciones;
    // Buscador: se escribe el nombre (o teléfono) y la lista se va filtrando. El <select> sigue guardando el valor.
    if (window.N360SelectBuscable) N360SelectBuscable.mejorar(sel, { placeholder: 'Escribe el nombre o teléfono… (vacío = cliente final)', incluirVacio: true, anchoCompleto: true });
  }
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
    // Mientras se escribe el nombre, se muestran los clientes que ya existen con ese nombre.
    if (window.N360ClienteRepetido) {
      if (!STATE._crHint) STATE._crHint = window.N360ClienteRepetido.conectar(document.getElementById('cq-nombre'),
        { lista: () => STATE.clientes || [], alUsar: usarClienteExistenteProf });
      if (STATE._crHint) STATE._crHint.refrescar();
    }
  }
}
// "Usar este" (o Aceptar en la pregunta): se elige el cliente que ya existe en vez de crear otro.
function usarClienteExistenteProf(c) {
  if (!c) return;
  if (!STATE.clientes.find(x => x.id === c.id)) { STATE.clientes.push(c); llenarSelectClientes(); }
  STATE.clienteSeleccionado = STATE.clientes.find(x => x.id === c.id) || c;
  const sel = document.getElementById('np-cliente-select'); if (sel) sel.value = c.id;
  toggleNuevoClienteProf(false);
  showToast(`Se usará el cliente existente "${c.nombre}"`);
}
// Crea el cliente YA (no hasta guardar la cotización) — así aparece de
// inmediato en el módulo Clientes, tal como lo pediste.
async function guardarNuevoClienteProf() {
  const errEl = document.getElementById('cq-error');
  errEl.textContent = '';
  const nombre = document.getElementById('cq-nombre')?.value.trim();
  if (!nombre) { errEl.textContent = 'El nombre del cliente es requerido.'; return; }
  // Si ya existe un cliente con ese mismo nombre (en pantalla o en la base), se pregunta antes de crear otro.
  const CR = window.N360ClienteRepetido;
  if (CR) {
    let ex = CR.buscar(STATE.clientes, nombre).exactos;
    if (!ex.length) ex = await CR.exactosEnBase(sbClient, STATE.userId, nombre);
    if (ex.length && CR.preguntar(ex[0]) === 'usar') { usarClienteExistenteProf(ex[0]); return; }
  }
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

/* =====================================================
   PROVEEDOR POR LINEA (opcional) -- cada linea puede indicar a que
   proveedor se le comprara. Modo por cotización: 'no' (no se usa),
   'interno' (solo lo ve el negocio) o 'visible' (tambien sale en el PDF).
   Usa el mismo catalogo "proveedores" de Compras.
===================================================== */
STATE.proveedoresCat = [];
STATE.provModo = 'no';
async function loadProveedoresProf() {
  try {
    const { data } = await sbClient.from('proveedores').select('id,nombre,activo')
      .eq('auth_user_id', STATE.userId).order('nombre');
    STATE.proveedoresCat = (data || []).filter(p => p.activo !== false);
  } catch (e) { console.warn('loadProveedoresProf:', e); STATE.proveedoresCat = []; }
}
function aplicarModoProveedorProf() {
  const mostrar = STATE.provModo !== 'no';
  document.querySelectorAll('.col-prov-prof').forEach(el => { el.style.display = mostrar ? '' : 'none'; });
  const sel = document.getElementById('np-prov-modo'); if (sel) sel.value = STATE.provModo;
  const ayuda = document.getElementById('np-prov-ayuda');
  if (ayuda) ayuda.textContent = STATE.provModo === 'visible'
    ? 'El proveedor de cada línea saldrá en el PDF de la cotización, debajo del nombre del producto o servicio.'
    : STATE.provModo === 'interno'
      ? 'Solo tú ves el proveedor. No aparece en el PDF ni se le muestra al cliente.'
      : 'No se indica proveedor en esta cotización.';
}
function cambiarModoProveedorProf(v) {
  STATE.provModo = ['interno', 'visible'].includes(v) ? v : 'no';
  aplicarModoProveedorProf();
}
function opcionesProveedorProf(l) {
  const cat = STATE.proveedoresCat || [];
  let valorSel = '';
  if (l.proveedorId && cat.some(p => p.id === l.proveedorId)) valorSel = l.proveedorId;
  else if (l.proveedorNombre) valorSel = 'txt:' + l.proveedorNombre;   // nombre sin proveedor del catalogo (o ya eliminado)
  const ops = ['<option value="">— Sin proveedor —</option>']
    .concat(cat.map(p => `<option value="${esc(p.id)}" ${p.id === valorSel ? 'selected' : ''}>${esc(p.nombre)}</option>`));
  if (valorSel.startsWith('txt:')) ops.push(`<option value="${esc(valorSel)}" selected>${esc(l.proveedorNombre)}</option>`);
  return ops.join('');
}
function actualizarProveedorLineaProf(idx, valor) {
  const l = STATE.carrito[idx]; if (!l) return;
  if (!valor) { l.proveedorId = null; l.proveedorNombre = null; return; }
  if (valor.startsWith('txt:')) { l.proveedorId = null; l.proveedorNombre = valor.slice(4); return; }
  const p = (STATE.proveedoresCat || []).find(x => x.id === valor);
  l.proveedorId = p ? p.id : null; l.proveedorNombre = p ? p.nombre : null;
}

async function loadProductos() {
  try {
    const { data } = await N360Leer.todo(() => sbClient.from('productos')
      .select('id,nombre,sku,tipo,categoria,stock_actual,precio,costo,activo,tipo_precio,unidad_codigo,permite_fraccion,proveedor_id,proveedor_nombre,contenido_cantidad,contenido_unidad_codigo')
      .eq('auth_user_id', STATE.userId).eq('activo', true).eq('es_materia_prima', false).order('nombre'), 'productos');
    const productos = data || [];

    // Combos: se agregan al mismo catálogo de búsqueda/carrito que los
    // productos (mismo patrón que en ventas.js) — tipo:'producto' para
    // que las validaciones de stock ya existentes se apliquen igual,
    // marcados con esCombo:true para tratarlos distinto solo al
    // convertir la cotización en venta.
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
    } catch (eCombo) { console.warn('No se pudieron cargar los combos para Cotizaciones:', eCombo); }

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
    const { data } = await N360Leer.todo(() => sbClient.from('precios_escala').select('id,producto_id,nombre,precio,orden')
      .eq('auth_user_id', STATE.userId).order('orden'), 'escalas de precio');
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












// Un producto que solo existe en OTRA cuenta del grupo — se salta
// directo al selector de origen (no hay fila local que buscar).


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

// Unidad de medida de una linea (lb, kg...). Nada para "unidad" ni sin unidad definida.
function abrevUnidadProf(codigo) {
  if (!codigo || codigo === 'unidad') return '';
  return window.N360Unidades?.porCodigo(codigo)?.abreviatura || '';
}
// Línea pedida en otra unidad ("100 m"): texto de cantidad o '' si la línea no es así.
function cantPedidaProf(it) {
  const p = Number(it && it.cantidad_pedida);
  if (!(p > 0) || !it.unidad_pedida) return '';
  const ab = abrevUnidadProf(it.unidad_pedida);
  return p.toLocaleString('es-NI', { maximumFractionDigits: 3, useGrouping: false }) + (ab ? ' ' + ab : '');
}

function unidadProdProf(id) {
  const pr = (STATE.productos || []).find(x => x.id === id);
  return pr ? { unidadCodigo: pr.unidad_codigo || null, permiteFraccion: pr.permite_fraccion, contenidoCantidad: Number(pr.contenido_cantidad) > 0 ? Number(pr.contenido_cantidad) : null, contenidoUnidadCodigo: pr.contenido_unidad_codigo || null } : { unidadCodigo: null, permiteFraccion: null };
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
    existente.cantidad++; existente.cantidadPedida = null; existente.unidadPedida = null;
    if (p.tipo === 'producto' && existente.cantidad > stockReal) existente.sinStock = true;
    recalcularLineaProf(existente);
  }
  else {
    const linea = { id: p.id, nombre: p.nombre, sku: p.sku, tipo: p.tipo, costo: Number(p.costo||0),
      proveedorId: p.proveedor_id || null, proveedorNombre: p.proveedor_nombre || null,
      cantidad: 1, precio: precioUsar, descuento: 0, esCombo: !!p.esCombo,
      unidadCodigo: p.unidad_codigo || null, permiteFraccion: p.permite_fraccion,
      contenidoCantidad: Number(p.contenido_cantidad) > 0 ? Number(p.contenido_cantidad) : null, contenidoUnidadCodigo: p.contenido_unidad_codigo || null,
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
// Mismo mecanismo exacto ya probado en Ventas -- precio a C$0, sin
// tocar como se descuenta el stock, restaurable, y limpia el
// descuento para nunca dejar un subtotal negativo sin sentido.
function alternarRegaliaProf(idx) {
  const l = STATE.carrito[idx]; if (!l) return;
  if (l.esRegalia) {
    l.esRegalia = false;
    l.precio = l.precioAntesRegalia != null ? l.precioAntesRegalia : l.precio;
    l.precioAntesRegalia = undefined;
  } else {
    l.precioAntesRegalia = l.precio;
    l.esRegalia = true;
    l.precio = 0;
    l.descuento = 0;
  }
  recalcularLineaProf(l);
  renderCarritoProf();
}
function renderCarritoProf() {
  const tbody = document.getElementById('np-carrito-tbody');
  if (!tbody) return;
  if (!STATE.carrito.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Busca y agrega productos arriba</td></tr>`;
    actualizarResumenProf();
    return;
  }
  tbody.innerHTML = STATE.carrito.map((l, idx) => `
    <tr>
      <td style="font-weight:500">${esc(l.nombre)}${l.esCombo ? `<div style="font-size:11px;color:var(--accent-4,var(--accent));font-weight:600">📦 Combo</div>` : ''}${l.escalaNombre ? `<div style="font-size:11px;color:var(--accent);font-weight:600">📊 ${esc(l.escalaNombre)}</div>` : ''}${l.esRegalia ? `<div style="font-size:11px;color:#d6336c;font-weight:600">🎀 Regalía</div>` : ''}${l.precioEditado ? `<div style="font-size:10px;color:var(--text-muted)">✏️ Precio ajustado</div>` : ''}${l.sinStock ? `<div style="font-size:10px;color:#e08e0b;font-weight:600" title="No hay existencias registradas ahora mismo, pero se puede vender igual">⚠️ Sin stock (se puede vender)</div>` : ''}</td>
      <td class="col-prov-prof" style="display:none"><select class="carrito-input" style="width:150px" title="A quién se le comprará esta línea" onchange="actualizarProveedorLineaProf(${idx},this.value)">${opcionesProveedorProf(l)}</select></td>
      <td><input type="number" class="carrito-input" value="${l.cantidad}" min="${l.permiteFraccion === false ? 1 : 0.001}" step="${l.permiteFraccion === false ? 1 : 'any'}" onchange="actualizarLineaProf(${idx},'cantidad',this.value)" style="width:70px"/>${abrevUnidadProf(l.unidadCodigo) ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(abrevUnidadProf(l.unidadCodigo))}</div>` : ''}${controlesCantidadProfHTML(l, idx)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" class="carrito-input" value="${l.precio}" min="0" step="0.01" title="Ajustar el precio solo para esta cotización" onchange="actualizarLineaProf(${idx},'precio',this.value,true)" style="width:90px"/>
          <button type="button" onclick="alternarRegaliaProf(${idx})" title="${l.esRegalia?'Quitar regalía':'Marcar como regalía (precio C$0)'}" style="flex-shrink:0;width:26px;height:26px;border-radius:6px;border:1px solid ${l.esRegalia?'#d6336c':'var(--border)'};background:${l.esRegalia?'#d6336c22':'var(--bg-hover,#f0f0f5)'};cursor:pointer;font-size:13px">🎀</button>
        </div>
      </td>
      <td class="col-costo-prof" style="display:none"><input type="number" class="carrito-input" value="${l.costo||0}" min="0" step="0.01" title="Ajustar el costo solo para esta cotización" onchange="actualizarLineaProf(${idx},'costo',this.value)" style="width:90px"/></td>
      <td><input type="number" class="carrito-input" value="${l.descuento}" min="0" step="0.01" onchange="actualizarLineaProf(${idx},'descuento',this.value)" style="width:80px"/></td>
      <td class="td-right td-money">${fmt(l.subtotal)}</td>
      <td><button class="btn-icon btn-icon-danger" onclick="eliminarLineaProf(${idx})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    </tr>`).join('');
  actualizarResumenProf();
  aplicarVisibilidadCostoProf();
  aplicarModoProveedorProf();
}
// Fracción escrita (1/4, 3/4, 1 1/2, 1/2/2…) y "pedir en otra unidad" (100 m de un rollo de 300 m).
function cantidadPorFraccionProf(idx, texto) {
  if (!String(texto || '').trim()) return;
  const n = window.N360Cant ? window.N360Cant.parse(texto) : null;
  if (n == null) { showToast('No entendí esa cantidad. Prueba con 1/4, 3/4, 1 1/2 o un decimal.', 'error'); return; }
  actualizarLineaProf(idx, 'cantidad', n);
}
function cantidadPorPedidoProf(idx, val) {
  const l = STATE.carrito[idx];
  const pedido = parseFloat(String(val).replace(',', '.'));
  if (!l || !(pedido > 0) || !(l.contenidoCantidad > 0)) return;
  const n = window.N360Cant ? window.N360Cant.desdePedido(pedido, l.contenidoCantidad) : null;
  if (n == null) return;
  l.cantidadPedida = pedido; l.unidadPedida = l.contenidoUnidadCodigo;
  actualizarLineaProf(idx, 'cantidad', n, false, { pedida: pedido });
}
function controlesCantidadProfHTML(l, idx) {
  if (l.permiteFraccion !== true) return '';
  const st = 'font-size:11px;padding:2px 5px;border:1px solid var(--border);border-radius:5px;background:var(--bg-surface,#fff);color:var(--text-primary,#111)';
  const ab = abrevUnidadProf(l.contenidoUnidadCodigo);
  const ped = (l.cantidadPedida > 0 && l.unidadPedida) ? `<div style="font-size:10.5px;color:var(--accent);margin-top:3px">✔ ${fmtNum(l.cantidadPedida)} ${esc(abrevUnidadProf(l.unidadPedida))} = ${window.N360Cant ? window.N360Cant.bonito(l.cantidad) : l.cantidad}</div>` : '';
  return `<div style="display:flex;gap:3px;margin-top:4px;flex-wrap:wrap">
      ${[0.25, 0.5, 0.75].map(v => `<button type="button" onclick="actualizarLineaProf(${idx},'cantidad',${v})" style="padding:1px 6px;font-size:11px;border:1px solid var(--border);border-radius:5px;background:var(--bg-hover,#f0f0f5);color:var(--text-secondary);cursor:pointer">${window.N360Cant ? window.N360Cant.bonito(v) : v}</button>`).join('')}
    </div>
    <input type="text" placeholder="Fracción: 1/4" title="1/4, 3/4, 1 1/2, 1/2/2…" onchange="cantidadPorFraccionProf(${idx}, this.value); this.value=''" style="margin-top:4px;width:84px;${st}"/>
    ${l.contenidoCantidad > 0 ? `<input type="number" min="0" step="any" placeholder="Pedir en ${esc(ab || 'unidad menor')}" onchange="cantidadPorPedidoProf(${idx}, this.value); this.value=''" style="margin-top:4px;width:96px;${st}"/>` : ''}
    ${ped}`;
}

function actualizarLineaProf(idx, campo, valor, esPrecioManual, opcionesPedida) {
  const l = STATE.carrito[idx]; if (!l) return;
  if (campo === 'cantidad') {
    let n = Math.round((parseFloat(valor) || 0) * 1000000) / 1000000;   // hasta 6 decimales (el cobro se redondea a centavos)
    if (n > 0 && l.permiteFraccion === false && !Number.isInteger(n)) {
      showToast(`"${l.nombre}" se vende en unidades enteras. Escribe un número entero.`, 'error');
      renderCarritoProf();
      return;
    }
    valor = n;
    if (!(opcionesPedida && opcionesPedida.pedida > 0)) { l.cantidadPedida = null; l.unidadPedida = null; }
  }
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
   ABRIR / RESET MODAL NUEVA COTIZACIÓN
===================================================== */
/* =====================================================
   PERSONALIZAR COTIZACIÓN — propio de este módulo, guardado en su
   propia tabla (configuracion_proforma), independiente de Perfil.
===================================================== */
STATE.configProforma = null;

async function cargarConfigProforma() {
  try {
    const { data } = await sbClient.from('configuracion_proforma').select('*').eq('auth_user_id', STATE.userId).maybeSingle();
    STATE.configProforma = data || { color_principal:'#6C63FF', color_tabla_usa_mismo:true, color_tabla:'#6C63FF', mostrar_ruc:true, mostrar_direccion:true, mostrar_telefono:true, mensaje_pie:null, logo_tamano:'mediano' };
  } catch (e) { STATE.configProforma = { color_principal:'#6C63FF', color_tabla_usa_mismo:true, color_tabla:'#6C63FF', mostrar_ruc:true, mostrar_direccion:true, mostrar_telefono:true, mensaje_pie:null, logo_tamano:'mediano' }; }
}










function abrirNuevaProforma() {
  STATE.proformaActual = null;
  document.getElementById('np-modal-title').textContent = 'Nueva Cotización';
  document.getElementById('np-id').value = '';
  STATE.carrito = [];
  STATE.clienteSeleccionado = null;
  STATE.ivaActivo = false; STATE.ivaPorcentaje = 15;
  cargarPreferenciaCostoProf();
  STATE.provModo = 'no'; aplicarModoProveedorProf();

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
  openModal('modal-nueva-cotizacion');
}

function abrirEditarProforma(id) {
  const p = STATE.cotizaciones.find(x => x.id === id);
  if (!p) return;
  if (['convertida','pago_parcial'].includes(p.estado)) { showToast('Esta cotización ya no se puede editar', 'error'); return; }
  abrirNuevaProforma();
  STATE.proformaActual = p;
  document.getElementById('np-modal-title').textContent = `Editar Cotización ${p.numero_cotizacion}`;
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
    const { data: detalles } = await sbClient.from('cotizacion_detalles').select('*').eq('cotizacion_id', p.id);
    STATE.carrito = (detalles||[]).map(d => ({
      id: d.combo_id || d.producto_id, nombre: d.producto_nombre, sku: d.producto_sku,
      tipo: d.tipo_item === 'combo' ? 'producto' : d.tipo_item, esCombo: d.tipo_item === 'combo' || !!d.combo_id,
      costo: Number(d.costo||0), cantidad: Number(d.cantidad), precio: Number(d.precio), descuento: Number(d.descuento||0),
      escalaId: d.escala_id || null, escalaNombre: d.escala_nombre || null,
      proveedorId: d.proveedor_id || null, proveedorNombre: d.proveedor_nombre || null,
      cantidadPedida: Number(d.cantidad_pedida) > 0 ? Number(d.cantidad_pedida) : null, unidadPedida: d.cantidad_pedida ? (d.unidad_pedida || null) : null,
      ...(d.combo_id ? {} : unidadProdProf(d.producto_id)),
    }));
    STATE.carrito.forEach(recalcularLineaProf);
    STATE.provModo = p.mostrar_proveedor === true ? 'visible' : (STATE.carrito.some(l => l.proveedorId || l.proveedorNombre) ? 'interno' : 'no');
    renderCarritoProf();
  })();
}

/* =====================================================
   NUMERACIÓN
===================================================== */
async function generarNumeroProforma() {
  try {
    const { data, error } = await sbClient.rpc('generar_numero_cotizacion', { p_user_id: STATE.userId });
    if (error) throw error;
    return data;
  } catch (e) { return 'PR-' + String(Date.now()).slice(-6); }
}

/* =====================================================
   GUARDAR COTIZACIÓN (NO toca inventario/caja/impuestos)
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
  if (fechaVenc && fechaVenc < fecha) { errEl.textContent = 'La fecha de vencimiento no puede ser anterior a la fecha de la cotización.'; return; }
  const estado = document.getElementById('np-estado')?.value || 'borrador';
  const observaciones = document.getElementById('np-observaciones')?.value.trim() || null;
  const r = calcularResumenProf();
  if (r.total <= 0) { errEl.textContent = 'El total debe ser mayor a cero.'; return; }
  const errVarios = window.N360ProfVarios?.validar?.(); // solo si es "dirigida a varios"
  if (errVarios) { errEl.textContent = errVarios; return; }

  // Embudo de ventas: si se marca como rechazada, preguntar el motivo (opcional)
  let motivoPerdida;
  if (estado === 'rechazada' && (!document.getElementById('np-id').value || STATE.proformaActual?.estado !== 'rechazada')) {
    motivoPerdida = await pedirMotivoPerdida();
  }

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
    Object.assign(payload, window.N360ProfVarios?.payloadExtra?.() || {}); // {} si es individual y nunca fue de varios
    if (motivoPerdida !== undefined) payload.motivo_perdida = motivoPerdida;
    if (estado === 'enviada' && !STATE.proformaActual?.enviada_at) payload.enviada_at = new Date().toISOString();
    // Solo se toca esta columna si la cotización usa proveedor (o si lo usaba antes y ahora se apaga),
    // asi las cotizaciones normales se guardan exactamente igual que siempre.
    if (STATE.provModo !== 'no' || STATE.proformaActual?.mostrar_proveedor === true) payload.mostrar_proveedor = STATE.provModo === 'visible';

    let proformaId = editandoId;
    let numero;
    if (editandoId) {
      let { error } = await sbClient.from('cotizaciones').update(payload).eq('id', editandoId);
      if (error && ('motivo_perdida' in payload || 'enviada_at' in payload || 'dirigida_a_varios' in payload)) {
        const { motivo_perdida, enviada_at, dirigida_a_varios, ...sinNuevas } = payload;
        ({ error } = await sbClient.from('cotizaciones').update(sinNuevas).eq('id', editandoId));
      }
      if (error) throw error;
      await sbClient.from('cotizacion_detalles').delete().eq('cotizacion_id', editandoId);
      numero = STATE.proformaActual?.numero_cotizacion;
    } else {
      numero = await generarNumeroProforma();
      const { data: nueva, error } = await sbClient.from('cotizaciones').insert({
        auth_user_id: STATE.userId, numero_cotizacion: numero,
        usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
        ...payload,
      }).select().single();
      if (error) throw error;
      proformaId = nueva.id;
    }

    const detallesPayload = STATE.carrito.map(l => ({
      auth_user_id: STATE.userId, cotizacion_id: proformaId,
      producto_id: l.esCombo ? null : l.id, combo_id: l.esCombo ? l.id : null,
      producto_nombre: l.nombre, producto_sku: l.sku || null, tipo_item: l.esCombo ? 'combo' : l.tipo,
      cantidad: l.cantidad, precio: l.precio, costo: l.costo, descuento: l.descuento || 0,
      subtotal: l.subtotal, ganancia: l.ganancia || 0,
      escala_id: l.escalaId || null, escala_nombre: l.escalaNombre || null,
      origen_stock_id: l.origenStockId || null, origen_stock_nombre: l.origenStockNombre || null,
      es_regalia: !!l.esRegalia,
      ...(l.cantidadPedida > 0 && l.unidadPedida ? { cantidad_pedida: l.cantidadPedida, unidad_pedida: l.unidadPedida } : {}),
      ...(STATE.provModo !== 'no' ? { proveedor_id: l.proveedorId || null, proveedor_nombre: l.proveedorNombre || null } : {}),
    }));
    let { error: errDet } = await sbClient.from('cotizacion_detalles').insert(detallesPayload);
    if (errDet) {
      // Reintentar sin combo_id por si la migración aún no llegó a este entorno
      ({ error: errDet } = await sbClient.from('cotizacion_detalles').insert(
        detallesPayload.map(({ combo_id, cantidad_pedida, unidad_pedida, ...resto }) => resto)
      ));
    }
    if (errDet) throw errDet;

    await window.N360ProfVarios?.guardarDestinatarios?.(proformaId);

    closeModal('modal-nueva-cotizacion');
    showToast(`Cotización ${numero} guardada correctamente`);
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
  // Una cotización solo informa precios: nunca se convierte en venta ni crédito.
  // Pasada su fecha de validez queda "Vencida" (salvo si ya fue rechazada).
  if (['rechazada'].includes(p.estado)) return p.estado;
  if (p.fecha_vencimiento && p.fecha_vencimiento < todayISO()) return 'vencida';
  return p.estado;
}

async function loadProformas() {
  const tbody = document.getElementById('prof-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Cargando cotizaciones…</td></tr>`;
  try {
    const { data, error } = await sbClient.from('cotizaciones').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending:false });
    if (error) throw error;

    const lista = data || [];
    const actualizaciones = [];
    lista.forEach(p => {
      const nuevo = calcularEstadoProforma(p);
      if (nuevo !== p.estado) { p.estado = nuevo; actualizaciones.push(p.id); }
    });
    await Promise.allSettled(actualizaciones.map(id => sbClient.from('cotizaciones').update({ estado:'vencida' }).eq('id', id)));

    STATE.cotizaciones = lista;
    STATE.page = 1;
    renderTablaProf();
  } catch (e) {
    console.error('loadProformas:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No se pudieron cargar las cotizaciones</td></tr>`;
  }
}

const ESTADO_PROF_INFO = {
  borrador:   { label:'Borrador',   badge:'badge-borrador' },
  pendiente:  { label:'Pendiente',  badge:'badge-pendiente' },
  enviada:    { label:'Enviada',    badge:'badge-enviada' },
  aprobada:   { label:'Aprobada',   badge:'badge-aprobada' },
  rechazada:  { label:'Rechazada',  badge:'badge-rechazada' },
  vencida:    { label:'Vencida',    badge:'badge-vencido' },
};

function proformasFiltradas() {
  const q = STATE.search.toLowerCase().trim();
  return STATE.cotizaciones.filter(p => {
    if (STATE.filtro !== 'todos' && p.estado !== STATE.filtro) return false;
    if (!q) return true;
    return (p.numero_cotizacion||'').toLowerCase().includes(q) || (p.cliente_nombre||'').toLowerCase().includes(q);
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
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No hay cotizaciones con estos filtros</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(p => {
      const ei = ESTADO_PROF_INFO[p.estado] || ESTADO_PROF_INFO.borrador;
      const puedeEditar = true;   // una cotización nunca queda "convertida": siempre se puede editar
      return `
      <tr>
        <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(p.numero_cotizacion)}</span></td>
        <td style="font-weight:500">${esc(p.cliente_nombre||'Cliente final')}</td>
        <td>${fmtFecha(p.fecha)}</td>
        <td>${p.fecha_vencimiento?fmtFecha(p.fecha_vencimiento):'—'}</td>
        <td class="td-right td-money">${fmt(p.total)}</td>
        <td><span class="status-badge ${ei.badge}">${ei.label}</span></td>
        <td class="td-actions" style="white-space:nowrap">
          <button class="btn-primary" style="padding:5px 10px;font-size:11.5px;gap:5px" title="Exportar Cotización" onclick="exportarProformaDesdeTabla('${p.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
            Exportar Cotización
          </button>
          <button class="btn-icon" title="Ver" onclick="verDetalleProf('${p.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
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
  const p = STATE.cotizaciones.find(x => x.id === id);
  if (!p) return;
  try {
    const { data: detalles } = await sbClient.from('cotizacion_detalles').select('*').eq('cotizacion_id', id);
    const numero = await generarNumeroProforma();
    const { data: nueva, error } = await sbClient.from('cotizaciones').insert({
      auth_user_id: STATE.userId, numero_cotizacion: numero,
      cliente_id: p.cliente_id, cliente_nombre: p.cliente_nombre,
      fecha: todayISO(), fecha_vencimiento: null,
      subtotal: p.subtotal, descuento: p.descuento, impuesto: p.impuesto,
      iva_activo: p.iva_activo, iva_porcentaje: p.iva_porcentaje,
      total: p.total, costo_total: p.costo_total, estado: 'borrador',
      observaciones: p.observaciones,
      ...(p.dirigida_a_varios ? { dirigida_a_varios: true } : {}),
      ...(p.mostrar_proveedor === true ? { mostrar_proveedor: true } : {}),
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (error) throw error;

    const nuevosDetalles = (detalles||[]).map(({ id, cotizacion_id, ...resto }) => ({ ...resto, auth_user_id: STATE.userId, cotizacion_id: nueva.id }));
    if (nuevosDetalles.length) await sbClient.from('cotizacion_detalles').insert(nuevosDetalles);

    await window.N360ProfVarios?.copiarDestinatarios?.(id, nueva.id);
    showToast(`Cotización duplicada como ${numero}`);
    await Promise.allSettled([loadProformas(), loadKPIsProf()]);
  } catch (e) {
    console.error('duplicarProforma:', e);
    showToast('Error al duplicar: ' + (e.message||''), 'error');
  }
}
function confirmarEliminarProf(id) {
  const p = STATE.cotizaciones.find(x => x.id === id);
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
    const { error } = await sbClient.from('cotizaciones').delete().eq('id', p.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Cotización eliminada');
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
  const p = STATE.cotizaciones;
  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('kpi-total', fmtNum(p.length));
  set('kpi-pendientes', fmtNum(p.filter(x=>['pendiente','enviada','borrador'].includes(x.estado)).length));
  set('kpi-aprobadas', fmtNum(p.filter(x=>x.estado==='aprobada').length));
  set('kpi-rechazadas', fmtNum(p.filter(x=>x.estado==='rechazada').length));
  set('kpi-vencidas', fmtNum(p.filter(x=>x.estado==='vencida').length));
  set('kpi-monto-aprobado', fmt(p.filter(x=>x.estado==='aprobada').reduce((s,x)=>s+Number(x.total||0),0)));
  set('kpi-monto-total', fmt(p.reduce((s,x)=>s+Number(x.total||0),0)));
}

/* =====================================================
   VER DETALLE
===================================================== */
// Exporta el PDF directo desde el botón de la tabla, sin necesidad de
// abrir el modal de detalle primero.
function exportarProformaDesdeTabla(id) {
  const p = STATE.cotizaciones.find(x => x.id === id);
  if (!p) return;
  STATE.proformaActual = p;
  showToast(`Generando PDF de ${p.numero_cotizacion}…`);
  descargarPdfProformaActual();
}

function editarFechaProforma(proformaId) {
  const p = STATE.cotizaciones.find(x => x.id === proformaId);
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
    await sbClient.from('cotizaciones').update({ fecha: nuevaFecha }).eq('id', proformaId).eq('auth_user_id', STATE.userId);
    const p = STATE.cotizaciones.find(x => x.id === proformaId);
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
  const p = STATE.cotizaciones.find(x => x.id === id);
  if (!p) return;
  STATE.proformaActual = p;
  document.getElementById('det-prof-title').textContent = `Cotización ${p.numero_cotizacion}`;
  const body = document.getElementById('detalle-prof-body');
  body.innerHTML = 'Cargando…';
  openModal('modal-detalle-cotizacion');

  try {
    const { data: detalles } = await sbClient.from('cotizacion_detalles').select('*').eq('cotizacion_id', id);
    STATE.detalleActual = detalles || [];
    const ei = ESTADO_PROF_INFO[p.estado] || ESTADO_PROF_INFO.borrador;
    const hayProv = STATE.detalleActual.some(d => d.proveedor_nombre);

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
      ${hayProv ? `<p style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)">🏷️ Proveedor por línea: ${p.mostrar_proveedor === true ? '<strong>visible para el cliente</strong> (sale en el PDF)' : '<strong>solo interno</strong> (no sale en el PDF)'}</p>` : ''}
      ${p.observaciones ? `<p style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)"><strong>Notas:</strong> ${esc(p.observaciones)}</p>` : ''}
      <div class="table-wrap" style="margin-top:14px">
        <table><thead><tr><th>Ítem</th>${hayProv ? '<th>Proveedor</th>' : ''}<th class="th-right">Cant.</th><th class="th-right">Precio</th><th class="th-right">Subtotal</th></tr></thead>
        <tbody>${STATE.detalleActual.map(d => `<tr>
          <td>${esc(d.producto_nombre)}</td>${hayProv ? `<td>${d.proveedor_nombre ? esc(d.proveedor_nombre) : '—'}</td>` : ''}<td class="td-right">${cantPedidaProf(d) ? esc(cantPedidaProf(d)) : `${fmtNum(d.cantidad)}${abrevUnidadProf(unidadProdProf(d.producto_id).unidadCodigo) ? ' ' + esc(abrevUnidadProf(unidadProdProf(d.producto_id).unidadCodigo)) : ''}`}</td>
          <td class="td-right td-money">${fmt(cantPedidaProf(d) ? round2(Number(d.precio) * Number(d.cantidad) / Number(d.cantidad_pedida)) : d.precio)}</td><td class="td-right td-money">${fmt(d.subtotal)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty-cell">Sin ítems</td></tr>'}</tbody></table>
      </div>`;
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = 'No se pudo cargar el detalle.';
  }
}

/* =====================================================
   CONVERTIR A VENTA — misma secuencia que confirmarVenta() en ventas.js
===================================================== */


/* Si el método es transferencia/tarjeta, ofrece elegir el banco (opcional).
   Solo bancos de la misma moneda del negocio, para no mezclar monedas. */

/* =====================================================
   PAGO PARCIAL / A CRÉDITO — abre Créditos incrustado, con el
   cliente y los productos de la cotización ya cargados. Nunca se
   calcula el crédito aquí: se crea con el mismo formulario real de
   Créditos, y esta pantalla solo reacciona cuando ya se creó de verdad.
===================================================== */



// Créditos avisa aquí cuando el crédito ya se creó de verdad — recién
// ahí se marca la cotización como "Pago Parcial" y queda bloqueada para
// cobrar desde aquí.




/* ===================================================
   CONFIGURAR TICKET DE IMPRESIÓN — misma tabla que usa Ventas
   (configuracion_venta_rapida), compartida por todo el sistema.
=================================================== */
STATE.configTicket = null;




async function enriquecerItemsConCombo(items) {
  const combosIds = [...new Set((items||[]).filter(it => !!it.combo_id).map(it => it.combo_id))];
  if (!combosIds.length) return items;
  try {
    const { data: cis } = await sbClient.from('combo_items')
      .select('combo_id, producto_id, cantidad').eq('auth_user_id', STATE.userId).in('combo_id', combosIds);
    const prodIds = [...new Set((cis||[]).map(ci => ci.producto_id))];
    const { data: prods } = await sbClient.from('productos').select('id,nombre').eq('auth_user_id', STATE.userId).in('id', prodIds);
    const nombreProd = {}; (prods||[]).forEach(p => { nombreProd[p.id] = p.nombre; });
    const porCombo = {};
    (cis||[]).forEach(ci => {
      if (!porCombo[ci.combo_id]) porCombo[ci.combo_id] = [];
      porCombo[ci.combo_id].push(`${nombreProd[ci.producto_id]||'Producto'} x${Number(ci.cantidad)}`);
    });
    return (items||[]).map(it => {
      if (it.combo_id && porCombo[it.combo_id]?.length && !(it.nombre||'').includes('\n  •')) {
        const detalle = '\n' + porCombo[it.combo_id].map(x => `  • ${x}`).join('\n');
        return { ...it, nombre: `${it.nombre}${detalle}`, producto_nombre: `${it.producto_nombre||it.nombre}${detalle}` };
      }
      return it;
    });
  } catch (e) { console.warn('enriquecerItemsConCombo:', e); return items; }
}

/* ===================================================
   COMPROBANTE DE LA VENTA (al convertir una cotización) — mismo
   formato tipo ticket que usa Créditos, respetando el tamaño de
   papel configurado.
=================================================== */



// Si una venta se crea pero sus productos no se pudieron guardar, la venta
// queda vacía y activa (suma en reportes sin productos). En ese punto aún
// no se ha tocado caja ni inventario, así que se ANULA (nunca se borra)
// con una nota, y el usuario puede volver a intentarlo.




/* =====================================================
   PDF — hoja completa tamaño carta/A4, con toda la información
   de la cotización (mismo estilo de marca que usa el sistema:
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

  // Mismo mecanismo ya usado en el comprobante de Ventas: el codigo de
  // barras no se guarda en proforma_detalles (solo producto_sku), asi
  // que si esta opcion esta activa, se busca en vivo contra productos.
  // Si esta apagada (el default), no se hace ninguna consulta de mas.
  if (cfg.mostrar_codigo_barras === true && Array.isArray(items) && items.length) {
    try {
      const idsProd = [...new Set(items.map(it => it.producto_id).filter(Boolean))];
      if (idsProd.length) {
        const { data: prods } = await sbClient.from('productos').select('id, codigo_barras').in('id', idsProd);
        const mapa = {};
        (prods || []).forEach(pr => { mapa[pr.id] = pr.codigo_barras; });
        items = items.map(it => ({ ...it, codigo_barras: it.codigo_barras || mapa[it.producto_id] || '' }));
      }
    } catch (e) { console.warn('generarPDFProforma, lookup codigo de barras:', e); }
  }

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
  // Texto del encabezado con contraste: oscuro si el color elegido es claro (p. ej. blanco), blanco si es oscuro.
  const luminosidadEnc = (rC * 299 + gC * 587 + bC * 114) / 1000;
  doc.setTextColor(...(luminosidadEnc > 150 ? [20, 20, 30] : [255, 255, 255]));
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
  doc.text('Cotización', textoX, 29);
  doc.setFontSize(9);
  doc.text(`N.º ${p.numero_cotizacion || '—'}`, W - M, 18, { align: 'right' });
  doc.text(`Fecha: ${fmtFecha(p.fecha)}`, W - M, 24, { align: 'right' });
  if (p.fecha_vencimiento) doc.text(`Válida hasta: ${fmtFecha(p.fecha_vencimiento)}`, W - M, 30, { align: 'right' });

  let y = 50;
  doc.setTextColor(20, 20, 30);

  // ---- Datos del negocio (dirección/teléfono/RUC) y del cliente, lado a lado ----
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
  const infoNegocio = [biz.direccion, biz.telefono ? `Tel: ${biz.telefono}` : '', biz.ruc ? `RUC: ${biz.ruc}` : ''].filter(Boolean);
  infoNegocio.forEach((linea, i) => doc.text(linea, M, y + i*5));

  doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(20,20,30);
  const _dests = Array.isArray(p._destinatarios) && p._destinatarios.length ? p._destinatarios : null;
  const _empresa = !!(_dests && p._empresa); // contactos de UN cliente: se muestra la empresa y debajo "Dirigida a"
  doc.text(_dests && !_empresa ? 'Dirigida a' : 'Cliente', W - M - 70, y);
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
  // Direccion del cliente (facturacion o normal, + ciudad). Los textos largos se parten en varias
  // lineas (la columna mide ~70 mm) con un tope, para que nada se salga de la hoja.
  const direccionCliente = typeof _cc_armarDireccionCliente === 'function' ? _cc_armarDireccionCliente(cliente) : String(cliente?.direccion || '').trim();
  const envolverCliente = (texto, maxLineas) => {
    const lineas = doc.splitTextToSize(String(texto), 68);
    if (lineas.length > maxLineas) { lineas.length = maxLineas; lineas[maxLineas - 1] = lineas[maxLineas - 1].replace(/.{0,2}$/, '') + '…'; }
    return lineas;
  };
  const _lineasDests = _dests ? [
    ..._dests.slice(0, 6).flatMap((d, k) => [
      ...(k > 0 ? ['\u0001SEP'] : []),   // línea fina entre un cliente y otro
      ...envolverCliente(d.nombre + (d.cargo ? ` (${String(d.cargo).trim()})` : ''), 1),
      ...((d.telefono || d.correo) ? envolverCliente([d.telefono, d.correo].filter(Boolean).join(' · '), 1) : []),
    ]),
    ...(_dests.length > 6 ? [`… y ${_dests.length - 6} más`] : []),
  ] : [];
  const infoCliente = (_dests && !_empresa) ? _lineasDests : [
    ...envolverCliente(p.cliente_nombre || 'Cliente final', 2),
    ...(cliente?.telefono ? [`Tel: ${cliente.telefono}`] : []),
    ...(cliente?.correo ? envolverCliente(cliente.correo, 1) : []),
    ...(direccionCliente ? envolverCliente(direccionCliente, 3) : []),
    ...(_empresa ? ['\u0001SEP', 'Dirigida a:', ..._lineasDests] : []),
  ];
  infoCliente.forEach((linea, i) => {
    if (linea === '\u0001SEP') {
      doc.setDrawColor(215,215,225); doc.line(W - M - 70, y + 5 + i*5 - 1.5, W - M, y + 5 + i*5 - 1.5);
      doc.setDrawColor(230,230,235);
      return;
    }
    doc.text(linea, W - M - 70, y + 5 + i*5);
  });

  y += Math.max(infoNegocio.length, infoCliente.length + 1) * 5 + 10;
  doc.setDrawColor(230,230,235);
  doc.line(M, y, W - M, y);
  y += 8;

  // ---- Estado ----
  const ei = ESTADO_PROF_INFO[p.estado] || ESTADO_PROF_INFO.borrador;
  doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...(luminosidadEnc > 150 ? [20, 20, 30] : [rC, gC, bC]));      // sobre fondo blanco: nunca un acento claro
  doc.text(`Estado: ${ei.label}`, M, y);
  y += 10;

  // ---- Tabla de ítems ----
  // Mismas 2 columnas opcionales del comprobante de Ventas, controladas
  // desde la misma configuracion (mostrar_sku, mostrar_codigo_barras) --
  // apagadas por defecto, sin cambiar nada para quien nunca las activa.
  const colSku = cfg.mostrar_sku === true;
  const colBarras = cfg.mostrar_codigo_barras === true;

  const encabezadoTabla = ['Descripción'];
  if (colSku) encabezadoTabla.push('SKU');
  if (colBarras) encabezadoTabla.push('Código de barras');
  encabezadoTabla.push('Cant.', 'Precio unit.', 'Descuento', 'Subtotal');

  const filas = (items||[]).map(it => {
    const fila = [(it.producto_nombre || 'Ítem') + (p && p.mostrar_proveedor === true && it.proveedor_nombre ? `\nProveedor: ${it.proveedor_nombre}` : '')];
    if (colSku) fila.push(it.producto_sku || it.sku || '—');
    if (colBarras) fila.push(it.codigo_barras || '—');
    fila.push(
      cantPedidaProf(it) || (Number(it.cantidad).toLocaleString('es-NI', { maximumFractionDigits: 3 }) + (abrevUnidadProf(unidadProdProf(it.producto_id).unidadCodigo) ? ' ' + abrevUnidadProf(unidadProdProf(it.producto_id).unidadCodigo) : '')),
      fmt(cantPedidaProf(it) ? round2(Number(it.precio) * Number(it.cantidad) / Number(it.cantidad_pedida)) : it.precio),
      Number(it.descuento) > 0 ? fmt(it.descuento) : '—',
      fmt(it.subtotal),
    );
    return fila;
  });

  const totalColumnasTabla = encabezadoTabla.length;
  const columnStylesTabla = {};
  for (let i = totalColumnasTabla - 4; i < totalColumnasTabla; i++) columnStylesTabla[i] = { halign: 'right' };

  doc.autoTable({
    startY: y,
    head: [encabezadoTabla],
    body: filas,
    theme: 'striped',
    headStyles: (() => {
      const fondo = hexARgb(cfg.color_tabla_usa_mismo !== false ? cfg.color_principal : cfg.color_tabla) || [108, 99, 255];
      const lum = (fondo[0] * 299 + fondo[1] * 587 + fondo[2] * 114) / 1000;
      return { fillColor: fondo, textColor: lum > 150 ? [20, 20, 30] : [255, 255, 255] };
    })(),
    styles: { fontSize: colSku || colBarras ? 8.5 : 9.5, cellPadding: 3.5 },
    columnStyles: columnStylesTabla,
    margin: { left: M, right: M },
  });

  let finalY = doc.lastAutoTable.finalY + 10;

  // ---- Totales (alineados a la derecha) ----
  const anchoTotales = 75;
  const xEtiqueta = W - M - anchoTotales, xValor = W - M;
  const filaTotal = (label, val, big) => {
    doc.setFontSize(big ? 13 : 10);
    doc.setFont(undefined, big ? 'bold' : 'normal');
    doc.setTextColor(big ? 20 : 90, big ? 20 : 90, big ? 30 : 110);
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
    const altoHojaObs = doc.internal.pageSize.getHeight();
    doc.splitTextToSize(p.observaciones, W - M*2).forEach(ln => {
      // Observaciones largas: continúan en otra página en vez de salirse de la hoja
      if (finalY > altoHojaObs - 14) { doc.addPage(); finalY = 20; doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110); }
      doc.text(ln, M, finalY); finalY += 5;
    });
    finalY += 4;
  }

  // ---- Pie de página (condiciones fijas) ----
  // Si caben debajo del contenido, van al pie como siempre. Si no caben
  // (observaciones largas), se escriben a continuación del contenido
  // y pasan a otra página cuando hace falta, para que nunca se encimen.
  const alturaPagina = doc.internal.pageSize.getHeight();
  let yPie = alturaPagina - 16;
  const mensajePie = cfg.mensaje_pie;
  if (mensajePie) {
    doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
    const lineasPie = doc.splitTextToSize(mensajePie, W - M*2);
    const inicioAlPie = yPie - (lineasPie.length - 1) * 4.5;
    if (inicioAlPie - 4 >= finalY) {
      yPie = inicioAlPie;
      lineasPie.forEach(ln => { doc.text(ln, M, yPie); yPie += 4.5; });
    } else {
      yPie = finalY + 2;
      // Las condiciones se mantienen juntas: si no caben enteras aquí pero
      // sí en una hoja nueva, pasan completas a la siguiente página.
      const altoBloque = lineasPie.length * 4.5 + 5;
      if (yPie + altoBloque > alturaPagina - 6 && 20 + altoBloque <= alturaPagina - 6) {
        doc.addPage(); yPie = 20; doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
      }
      lineasPie.forEach(ln => {
        if (yPie > alturaPagina - 14) { doc.addPage(); yPie = 20; doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110); }
        doc.text(ln, M, yPie); yPie += 4.5;
      });
      if (yPie + 5 > alturaPagina - 6) { doc.addPage(); yPie = 15; }
    }
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
    // Siempre se pide fresco por cotizacion_id — nunca se reutiliza
    // STATE.detalleActual (podría ser el de OTRA cotización vista antes).
    const { data: itemsFrescos } = await sbClient.from('cotizacion_detalles').select('*').eq('cotizacion_id', p.id);
    const items = await enriquecerItemsConCombo(itemsFrescos || []);
    await window.N360ProfVarios?.cargarDestinatarios?.(p);
    let cliente = null;
    if (p.cliente_id) {
      const { data } = await sbClient.from('clientes').select('telefono,correo,direccion,direccion_factura,ciudad').eq('id', p.cliente_id).maybeSingle();
      cliente = data || null;
    }
    const doc = await generarPDFProforma(p, items, cliente);
    doc.save(`Cotizacion_${(p.numero_cotizacion||'cotizacion').replace(/[^\w\-]/g,'')}.pdf`);
  } catch (e) {
    console.error('descargarPdfProformaActual:', e);
    showToast('No se pudo generar el PDF', 'error');
  }
}
async function compartirProformaActual() {
  const p = STATE.proformaActual;
  if (!p) return;
  const texto = `Cotización ${p.numero_cotizacion} — ${p.cliente_nombre||'Cliente'} — Total: ${fmt(p.total)}`;
  let compartida = false;
  try {
    if (navigator.share) { await navigator.share({ title: `Cotización ${p.numero_cotizacion}`, text: texto }); compartida = true; }
    else { await navigator.clipboard.writeText(texto); showToast('Copiado al portapapeles'); compartida = true; }
  } catch (e) { /* el usuario canceló el share, no es error */ }
  if (compartida) await marcarProformaEnviada(p);
}

/* Embudo: al compartir una cotización se registra cuándo salió hacia el cliente */
async function marcarProformaEnviada(p) {
  try {
    if (!p || !p.id || p.enviada_at) return;
    const cambios = { enviada_at: new Date().toISOString() };
    if (['borrador','pendiente'].includes(p.estado)) cambios.estado = 'enviada';
    const { error } = await sbClient.from('cotizaciones').update(cambios).eq('id', p.id).eq('auth_user_id', STATE.userId);
    if (error) return;
    Object.assign(p, cambios);
    loadProformas?.();
  } catch (e) { /* no bloquea el envío */ }
}

/* Embudo: pregunta (opcional) por qué se perdió la cotización */
function pedirMotivoPerdida() {
  return new Promise(resolve => {
    const M = (window.N360Embudo && N360Embudo.MOTIVOS) || {};
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px';
    ov.innerHTML = `<div style="background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border);border-radius:16px;padding:20px;max-width:380px;width:100%">
      <h3 style="margin:0 0 6px;font-size:16px">¿Por qué se perdió?</h3>
      <p style="margin:0 0 12px;font-size:13px;color:var(--text-secondary)">Opcional. Sirve para el embudo de ventas.</p>
      <select id="mp-sel" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--bg-surface);color:var(--text-primary);font-family:inherit">
        <option value="">Prefiero no decirlo</option>${Object.entries(M).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button type="button" id="mp-ok" class="btn btn-primary" style="padding:9px 16px">Continuar</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#mp-ok').onclick = () => { const v = ov.querySelector('#mp-sel').value; ov.remove(); resolve(v || null); };
  });
}

/* Embudo: alternar entre la lista y el embudo de ventas */


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
    try { window.N360Unidades?.cargarPersonalizadas(sbClient, user.id); } catch (_) {}
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.allSettled([loadClientes(), loadProductos(), loadProveedoresProf()]);
    await loadProformas();
    await loadKPIsProf();

    if (window.Negocio360Tutorial) {
      const pasosProformas = [
        { icono: '📝', titulo: 'Bienvenido a Cotizaciones', texto: 'Aquí armas cotizaciones para tus clientes: solo muestran productos y precios. No descuentan inventario, no tocan Caja y no crean ventas ni créditos.' },
        { icono: '🛒', titulo: 'Arma la cotización', texto: 'Agrega los productos o servicios que tu cliente pidió, con el precio que le vas a ofrecer.' },
        { icono: '📤', titulo: 'Compártela', texto: 'Descárgala en PDF o compártela por WhatsApp. Si el cliente acepta, la venta se hace aparte en Ventas (o en Proformas).' },
      ];
      Negocio360Tutorial.verificarYMostrar('cotizaciones', pasosProformas);
      Negocio360Tutorial.agregarBotonAyuda('cotizaciones', pasosProformas);
    }
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
  let intentos = 0;
  const intervalo = setInterval(() => {
    intentos++;
    if (STATE.empresaConfig || intentos >= 30) {
      clearInterval(intervalo);
      const btn = document.getElementById('btn-moneda-vis-texto');
      if (btn) btn.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda);
    }
  }, 100);
});
