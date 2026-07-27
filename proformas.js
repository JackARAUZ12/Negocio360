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
  clienteSeleccionado: null,
  ivaActivo: false,
  ivaPorcentaje: 15,

  proformaActual: null,
};

/* =====================================================
   HELPERS
===================================================== */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO() { return ymd(new Date()); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function sym() { return STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$'; }
function fmt(amount) {
  const n = Number(amount) || 0;
  return `${sym()} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFecha(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtNum(v) { return Number(v || 0).toLocaleString('es-NI'); }
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
      .select('id,nombre,sku,tipo,categoria,stock_actual,precio,costo,activo')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.productos = data || [];
  } catch (e) { console.warn('loadProductos:', e); }
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
  if (!filtrados.length) { res.innerHTML = `<div class="search-no-results">Sin resultados para "${esc(q)}"</div>`; return; }
  res.innerHTML = filtrados.map(p => `
    <div class="search-result-item" onclick="agregarAlCarritoProf('${p.id}')">
      <div class="sri-info">
        <span class="sri-nombre">${esc(p.nombre)}</span>
        <span class="sri-meta">${p.tipo==='servicio'?'Servicio':'Producto'}${p.sku?' · SKU: '+esc(p.sku):''}${p.tipo==='producto'?' · Stock: '+fmtNum(p.stock_actual):''}</span>
      </div>
      <span class="sri-costo">${fmt(p.precio)}</span>
    </div>`).join('');
}
function agregarAlCarritoProf(productoId) {
  const p = STATE.productos.find(x => x.id === productoId);
  if (!p) return;
  const existente = STATE.carrito.find(l => l.id === productoId);
  if (existente) { existente.cantidad++; recalcularLineaProf(existente); }
  else {
    const linea = { id: p.id, nombre: p.nombre, sku: p.sku, tipo: p.tipo, costo: Number(p.costo||0),
      cantidad: 1, precio: Number(p.precio||0), descuento: 0 };
    recalcularLineaProf(linea);
    STATE.carrito.push(linea);
  }
  renderCarritoProf();
  const sp = document.getElementById('np-producto-search'); if (sp) sp.value = '';
  const sr = document.getElementById('np-search-results');  if (sr) sr.innerHTML = '';
}
function recalcularLineaProf(l) {
  l.subtotal = l.cantidad * l.precio - (l.descuento || 0);
  l.ganancia = l.cantidad * (l.precio - l.costo) - (l.descuento || 0);
}
function renderCarritoProf() {
  const tbody = document.getElementById('np-carrito-tbody');
  if (!tbody) return;
  if (!STATE.carrito.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Busca y agrega productos arriba</td></tr>`;
    actualizarResumenProf();
    return;
  }
  tbody.innerHTML = STATE.carrito.map((l, idx) => `
    <tr>
      <td style="font-weight:500">${esc(l.nombre)}</td>
      <td><input type="number" class="carrito-input" value="${l.cantidad}" min="0.01" step="0.01" onchange="actualizarLineaProf(${idx},'cantidad',this.value)" style="width:70px"/></td>
      <td><input type="number" class="carrito-input" value="${l.precio}" min="0" step="0.01" onchange="actualizarLineaProf(${idx},'precio',this.value)" style="width:90px"/></td>
      <td><input type="number" class="carrito-input" value="${l.descuento}" min="0" step="0.01" onchange="actualizarLineaProf(${idx},'descuento',this.value)" style="width:80px"/></td>
      <td class="td-right td-money">${fmt(l.subtotal)}</td>
      <td><button class="btn-icon btn-icon-danger" onclick="eliminarLineaProf(${idx})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    </tr>`).join('');
  actualizarResumenProf();
}
function actualizarLineaProf(idx, campo, valor) {
  const l = STATE.carrito[idx]; if (!l) return;
  l[campo] = parseFloat(valor) || 0;
  recalcularLineaProf(l);
  renderCarritoProf();
}
function eliminarLineaProf(idx) { STATE.carrito.splice(idx,1); renderCarritoProf(); }

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
  const subtotal  = STATE.carrito.reduce((s,l) => s + l.cantidad*l.precio, 0);
  const descuento = STATE.carrito.reduce((s,l) => s + (l.descuento||0), 0);
  const baseImponible = Math.max(subtotal - descuento, 0);
  const impuesto  = STATE.ivaActivo ? round2(baseImponible * (STATE.ivaPorcentaje/100)) : 0;
  const total     = subtotal - descuento + impuesto;
  const costoTotal= STATE.carrito.reduce((s,l) => s + l.cantidad*l.costo, 0);
  const ganancia  = STATE.carrito.reduce((s,l) => s + l.ganancia, 0);
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
function abrirNuevaProforma() {
  STATE.proformaActual = null;
  document.getElementById('np-modal-title').textContent = 'Nueva Proforma';
  document.getElementById('np-id').value = '';
  STATE.carrito = [];
  STATE.clienteSeleccionado = null;
  STATE.ivaActivo = false; STATE.ivaPorcentaje = 15;

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
  if (p.estado === 'convertida') { showToast('Esta proforma ya fue convertida a venta y no se puede editar', 'error'); return; }
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
      id: d.producto_id, nombre: d.producto_nombre, sku: d.producto_sku, tipo: d.tipo_item,
      costo: Number(d.costo||0), cantidad: Number(d.cantidad), precio: Number(d.precio), descuento: Number(d.descuento||0),
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
      producto_id: l.id, producto_nombre: l.nombre, producto_sku: l.sku || null, tipo_item: l.tipo,
      cantidad: l.cantidad, precio: l.precio, costo: l.costo, descuento: l.descuento || 0,
      subtotal: l.subtotal, ganancia: l.ganancia,
    }));
    const { error: errDet } = await sbClient.from('proforma_detalles').insert(detallesPayload);
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
      const puedeEditar = p.estado !== 'convertida';
      const puedeConvertir = !['convertida','rechazada'].includes(p.estado);
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
  if (p.estado === 'convertida') { showToast('No se puede eliminar: ya fue convertida a venta', 'error'); return; }
  STATE.proformaActual = p;
  openModal('modal-confirmar-eliminar-prof');
}
async function eliminarProforma() {
  const p = STATE.proformaActual;
  if (!p) return;
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

async function verDetalleProf(id) {
  const p = STATE.proformas.find(x => x.id === id);
  if (!p) return;
  STATE.proformaActual = p;
  document.getElementById('det-prof-title').textContent = `Proforma ${p.numero_proforma}`;
  const btnConvertir = document.getElementById('det-prof-btn-convertir');
  btnConvertir.style.display = ['convertida','rechazada'].includes(p.estado) ? 'none' : 'inline-flex';
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
        <div><label>Fecha</label><div class="stat-readonly">${fmtFecha(p.fecha)}</div></div>
        <div><label>Válida hasta</label><div class="stat-readonly">${p.fecha_vencimiento?fmtFecha(p.fecha_vencimiento):'—'}</div></div>
        <div><label>Estado</label><div class="stat-readonly"><span class="status-badge ${ei.badge}">${ei.label}</span></div></div>
        <div><label>Total</label><div class="stat-readonly" style="font-weight:800;color:var(--accent)">${fmt(p.total)}</div></div>
      </div>
      ${p.estado==='convertida' ? `<p style="margin-top:10px;font-size:12.5px;color:var(--success)">✅ Convertida a venta el ${fmtFecha((p.fecha_conversion||'').slice(0,10))} por ${esc(p.convertido_por||'—')}.</p>` : ''}
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
function abrirConvertirDesdeDetalle() {
  const p = STATE.proformaActual;
  closeModal('modal-detalle-proforma');
  if (p) abrirConvertirAVenta(p.id);
}

async function confirmarConvertirAVenta() {
  const errEl = document.getElementById('cv-error');
  errEl.textContent = '';
  const p = STATE.proformaActual;
  if (!p) return;

  setBtnLoading('btn-confirmar-convertir', true);
  try {
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
    };
    const { data: ventaNueva, error: errVenta } = await sbClient.from('ventas').insert(ventaPayload).select('id').single();
    if (errVenta) throw errVenta;
    const ventaId = ventaNueva.id;

    // ---- D: detalles de venta ----
    const detallesVenta = detalles.map(d => ({
      auth_user_id: STATE.userId, venta_id: ventaId, producto_id: d.producto_id,
      producto_nombre: d.producto_nombre, producto_sku: d.producto_sku, tipo_item: d.tipo_item,
      cantidad: d.cantidad, precio: d.precio, costo: d.costo, descuento: d.descuento,
      subtotal: d.subtotal, ganancia: d.ganancia, escala_id: d.escala_id, escala_nombre: d.escala_nombre,
    }));
    const { error: errDetV } = await sbClient.from('venta_detalles').insert(detallesVenta);
    if (errDetV) throw errDetV;

    // ---- E: descontar stock (solo productos) ----
    for (const d of detalles.filter(x => x.tipo_item === 'producto' && x.producto_id)) {
      const { data: prod } = await sbClient.from('productos').select('stock_actual').eq('id', d.producto_id).maybeSingle();
      if (prod) {
        const nuevoStock = Math.max(0, Number(prod.stock_actual||0) - Number(d.cantidad));
        await sbClient.from('productos').update({ stock_actual: nuevoStock }).eq('id', d.producto_id).eq('auth_user_id', STATE.userId);
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
    await sbClient.from('proformas').update({
      estado: 'convertida', venta_id: ventaId, fecha_conversion: new Date().toISOString(),
      convertido_por: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);

    try { localStorage.setItem('n360_venta_nueva', JSON.stringify({ ventaId, numero: ventaPayload.numero_venta, total: p.total, ts: Date.now() })); } catch(e) {}

    showToast(`✅ Convertida a Venta ${ventaPayload.numero_venta} — ${fmt(p.total)}`);
    closeModal('modal-convertir-venta');
    await Promise.allSettled([loadProformas(), loadKPIsProf()]);
  } catch (e) {
    console.error('confirmarConvertirAVenta:', e);
    errEl.textContent = 'Error al convertir: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-confirmar-convertir', false);
  }
}

/* =====================================================
   PDF — hoja completa tamaño carta/A4, con toda la información
   de la proforma (mismo estilo de marca que usa el sistema:
   franja de color con el nombre del negocio + tabla de ítems).
===================================================== */
function generarPDFProforma(p, items, cliente) {
  if (!window.jspdf) throw new Error('jsPDF no está disponible');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;

  const biz = {
    nombre:    STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio',
    direccion: STATE.empresaConfig?.direccion || '',
    telefono:  STATE.empresaConfig?.telefono || STATE.empresaConfig?.whatsapp || '',
    ruc:       STATE.empresaConfig?.ruc || '',
  };

  // ---- Encabezado (franja de color, igual que el resto de comprobantes del sistema) ----
  doc.setFillColor(108, 99, 255);
  doc.rect(0, 0, W, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20); doc.setFont(undefined, 'bold');
  doc.text(biz.nombre, M, 20);
  doc.setFontSize(11); doc.setFont(undefined, 'normal');
  doc.text('Proforma / Cotización', M, 29);
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
  doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(108,99,255);
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
    headStyles: { fillColor: [108, 99, 255] },
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
  doc.setFontSize(8.5); doc.setTextColor(150,150,170);
  doc.text('Cotización sujeta a disponibilidad. Precios expresados en ' + sym() + '.', M, alturaPagina - 16);
  doc.text('Generado por Negocio360', M, alturaPagina - 10);

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
    const doc = generarPDFProforma(p, items, cliente);
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
