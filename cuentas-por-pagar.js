/* =====================================================
   CUENTAS-POR-PAGAR.JS — NEGOCIO360
   Deudas con proveedores originadas por compras a crédito.

   ARQUITECTURA:
     Cuentas por Pagar → Productos (aumenta stock_actual, igual que Compras)
     Cuentas por Pagar → Compras   (crea la fila en "compras": esta es la
                                     única puerta de entrada para compras
                                     a crédito; Compras solo la muestra
                                     como historial, nunca la duplica)
     Cuentas por Pagar → Caja      (NUNCA al crear la compra — este módulo
                                     es 100% a crédito, por eso se llama
                                     "Cuentas por Pagar". Caja solo se
                                     toca al registrar un pago, vía
                                     window.CajaAPI, igual que Créditos)
     Por ahora este módulo solo se abre desde el Dashboard (no tiene
     ítem propio en el sidebar todavía).
===================================================== */

'use strict';

/* =====================================================
   SUPABASE CLIENT — misma URL/KEY que el resto del sistema
===================================================== */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},

  cuentas: [],        // todas las cuentas por pagar cargadas (con proximaFecha calculada)
  proveedores: [],
  productos: [],      // solo tipo=producto y activo=true
  metodosPago: [],

  filtro: 'todos',
  search: '',
  page: 1,
  perPage: 15,

  // Nueva compra
  carrito: [],
  proveedorSeleccionado: null,
  ivaActivo: false,
  ivaPorcentaje: 15,
  tipoCredito: 'fecha_fija',// fecha_fija | cuotas

  // Pagar / detalle
  cuentaActual: null,
  cuotaSugeridaId: null,

  ultimoComprobante: null,
};

/* =====================================================
   HELPERS: FECHA (fix de zona horaria: todo en UTC manual,
   igual que en caja.js / compras.js / creditos.js)
===================================================== */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO() { return ymd(new Date()); }

function ymdUTC(dt) { return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`; }

// Suma n periodos (semanal/quincenal/mensual) a una fecha ISO, en UTC puro
// para no arrastrar bugs de huso horario. Mensual respeta fin de mes
// (ej. 31 de enero + 1 mes → 28/29 de febrero, no "3 de marzo").
function sumarFrecuenciaCxP(fechaISO, frecuencia, n) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  if (frecuencia === 'semanal' || frecuencia === 'quincenal') {
    const paso = frecuencia === 'semanal' ? 7 : 15;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + paso * n);
    return ymdUTC(dt);
  }
  // mensual
  let mm = (m - 1) + n;
  const yy = y + Math.floor(mm / 12);
  mm = ((mm % 12) + 12) % 12;
  const ultimoDiaMes = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const dd = Math.min(d, ultimoDiaMes);
  return ymdUTC(new Date(Date.UTC(yy, mm, dd)));
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* =====================================================
   HELPERS: FORMATO
===================================================== */
function sym() { return monedaParaMostrar(STATE.empresaConfig?.moneda); }
function fmt(amount) {
  const n = convertirParaMostrar(amount, STATE.empresaConfig?.moneda);
  return `${sym()} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso) {
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
   CONFIG EMPRESA / PERFIL / ADMIN (copiado del resto del sistema)
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbClient.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
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
   MÉTODOS DE PAGO
===================================================== */
async function loadMetodosPago() {
  try {
    const { data } = await sbClient.from('metodos_pago').select('id, nombre, activo, es_default')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('orden');
    STATE.metodosPago = data || [];
  } catch (e) {
    console.warn('loadMetodosPago:', e);
    STATE.metodosPago = [{ id: null, nombre: 'Efectivo', es_default: true }];
  }
  populateMetodosSelect();
}
function populateMetodosSelect() {
  const metodos = STATE.metodosPago.length ? STATE.metodosPago : [{ id: null, nombre: 'Efectivo', es_default: true }];
  const opciones = metodos.map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  const def = metodos.find(m => m.es_default);
  ['pg-metodo', 'ncd-metodo-prima'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = opciones;
    if (def) sel.value = def.id || '';
  });
}

/* =====================================================
   PRODUCTOS (solo tipo=producto, para el carrito)
===================================================== */
async function loadProductosDisponibles() {
  try {
    const { data } = await sbClient.from('productos')
      .select('id, nombre, sku, categoria, stock_actual, costo, activo')
      .eq('auth_user_id', STATE.userId).eq('tipo', 'producto').eq('activo', true).order('nombre');
    STATE.productos = data || [];
  } catch (e) { console.warn('loadProductosDisponibles:', e); }
}

/* =====================================================
   PROVEEDORES
===================================================== */
async function loadProveedores() {
  try {
    const { data } = await sbClient.from('proveedores').select('*').eq('auth_user_id', STATE.userId).order('nombre');
    STATE.proveedores = data || [];
    llenarSelectProveedores();
  } catch (e) { console.warn('loadProveedores:', e); }
}
function llenarSelectProveedores() {
  const opciones = `<option value="">— Selecciona un proveedor —</option>` +
    STATE.proveedores.filter(p => p.activo).map(p =>
      `<option value="${p.id}">${esc(p.nombre)}${p.telefono ? ' — '+esc(p.telefono) : ''}</option>`
    ).join('');
  const sel = document.getElementById('np-proveedor-select');
  if (sel) sel.innerHTML = opciones;
}
function onSelectProveedorCxP() {
  const sel = document.getElementById('np-proveedor-select');
  const id = sel?.value;
  STATE.proveedorSeleccionado = id ? (STATE.proveedores.find(p => p.id === id) || null) : null;
  if (id) toggleNuevoProveedorCxP(false);
}
function toggleNuevoProveedorCxP(mostrar) {
  const form = document.getElementById('np-nuevo-proveedor-form');
  if (form) form.style.display = mostrar ? 'block' : 'none';
  if (mostrar) {
    const sel = document.getElementById('np-proveedor-select');
    if (sel) sel.value = '';
    STATE.proveedorSeleccionado = null;
  }
}
async function guardarNuevoProveedorCxP() {
  const nombre = document.getElementById('np-prov-nombre')?.value.trim();
  if (!nombre) { showToast('El nombre del proveedor es requerido', 'error'); return; }
  const payload = {
    auth_user_id: STATE.userId, nombre,
    telefono: document.getElementById('np-prov-telefono')?.value.trim() || null,
    email: document.getElementById('np-prov-email')?.value.trim() || null,
    direccion: document.getElementById('np-prov-direccion')?.value.trim() || null,
    observaciones: document.getElementById('np-prov-obs')?.value.trim() || null,
    activo: true,
  };
  try {
    setBtnLoading('btn-guardar-proveedor-cxp', true);
    const { data, error } = await sbClient.from('proveedores').insert(payload).select().single();
    if (error) throw error;
    STATE.proveedores.push(data);
    STATE.proveedorSeleccionado = data;
    llenarSelectProveedores();
    const sel = document.getElementById('np-proveedor-select');
    if (sel) sel.value = data.id;
    toggleNuevoProveedorCxP(false);
    showToast('Proveedor guardado');
  } catch (e) {
    showToast('Error al guardar proveedor: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-guardar-proveedor-cxp', false);
  }
}

/* =====================================================
   CARRITO DE PRODUCTOS
===================================================== */
function buscarProductoCxP() {
  const q = (document.getElementById('np-producto-search')?.value || '').toLowerCase().trim();
  const res = document.getElementById('np-search-results');
  if (!res) return;
  if (!q) { res.innerHTML = ''; return; }
  const filtrados = STATE.productos.filter(p =>
    p.nombre.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.categoria||'').toLowerCase().includes(q)
  ).slice(0, 10);
  if (!filtrados.length) {
    res.innerHTML = `<div class="search-no-results">Sin resultados para "${esc(q)}"</div>`;
    return;
  }
  res.innerHTML = filtrados.map(p => `
    <div class="search-result-item" onclick="agregarProductoAlCarritoCxP('${p.id}')">
      <div class="sri-info">
        <span class="sri-nombre">${esc(p.nombre)}</span>
        <span class="sri-meta">${p.sku?'SKU: '+esc(p.sku)+' · ':''}${p.categoria?esc(p.categoria)+' · ':''}Stock: ${fmtNum(p.stock_actual)}</span>
      </div>
      <span class="sri-costo">${fmt(p.costo)}</span>
    </div>`).join('');
}
function agregarProductoAlCarritoCxP(productoId) {
  const p = STATE.productos.find(x => x.id === productoId);
  if (!p) return;
  const existente = STATE.carrito.find(l => l.producto.id === productoId);
  if (existente) { existente.cantidad++; recalcularLineaCxP(existente); }
  else {
    const linea = { producto: p, cantidad: 1, precioUnitario: Number(p.costo||0), descuento: 0, ivaPorc: STATE.ivaActivo?STATE.ivaPorcentaje:0 };
    recalcularLineaCxP(linea);
    STATE.carrito.push(linea);
  }
  renderCarritoCxP();
  const sp = document.getElementById('np-producto-search'); if (sp) sp.value = '';
  const sr = document.getElementById('np-search-results');  if (sr) sr.innerHTML = '';
}

/* ------------------------------------------------------------
   PRODUCTO NUEVO — misma idea que "Comprar y agregar al inventario"
   de Compras: crea el producto sin salir del flujo de compra. Aquí
   se agrega como una línea más del carrito (stock_actual arranca en
   0 y la cantidad de esta compra se suma al guardar, igual que con
   cualquier otro producto — incluyendo el costo promedio ponderado).
   ------------------------------------------------------------ */
function toggleProductoNuevoCxP(mostrar) {
  const form = document.getElementById('np-producto-nuevo-form');
  if (!form) return;
  const mostrarForm = mostrar !== undefined ? mostrar : form.style.display === 'none';
  form.style.display = mostrarForm ? 'block' : 'none';
  if (mostrarForm) {
    ['pn-nombre','pn-categoria','pn-sku','pn-costo','pn-precio'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    const cant = document.getElementById('pn-cantidad'); if (cant) cant.value = '1';
    const err = document.getElementById('pn-error'); if (err) err.textContent = '';
  }
}

async function crearProductoNuevoCxP() {
  const errEl = document.getElementById('pn-error');
  errEl.textContent = '';

  const nombre = document.getElementById('pn-nombre')?.value.trim();
  const categoria = document.getElementById('pn-categoria')?.value.trim() || null;
  const sku = document.getElementById('pn-sku')?.value.trim() || null;
  const costo = parseFloat(document.getElementById('pn-costo')?.value);
  const precio = parseFloat(document.getElementById('pn-precio')?.value);
  const cantidad = parseFloat(document.getElementById('pn-cantidad')?.value);

  if (!nombre) { errEl.textContent = 'El nombre del producto es requerido.'; return; }
  if (isNaN(costo) || costo < 0) { errEl.textContent = 'Indica un costo unitario válido.'; return; }
  if (isNaN(precio) || precio < 0) { errEl.textContent = 'Indica un precio de venta válido.'; return; }
  if (!(cantidad > 0)) { errEl.textContent = 'La cantidad debe ser mayor a cero.'; return; }

  setBtnLoading('btn-crear-producto-cxp', true);
  try {
    const { data: nuevoProd, error } = await sbClient.from('productos').insert({
      auth_user_id: STATE.userId, tipo: 'producto', nombre, categoria, sku,
      costo, precio, stock_actual: 0, activo: true,
    }).select().single();
    if (error) throw error;

    STATE.productos.push(nuevoProd);
    const linea = { producto: nuevoProd, cantidad, precioUnitario: costo, descuento: 0, ivaPorc: STATE.ivaActivo?STATE.ivaPorcentaje:0 };
    recalcularLineaCxP(linea);
    STATE.carrito.push(linea);
    renderCarritoCxP();

    toggleProductoNuevoCxP(false);
    showToast(`Producto "${nombre}" creado y agregado al carrito`);
  } catch (e) {
    console.error('crearProductoNuevoCxP:', e);
    errEl.textContent = 'Error al crear el producto: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-crear-producto-cxp', false);
  }
}
function recalcularLineaCxP(linea) {
  const base = linea.cantidad * linea.precioUnitario;
  const baseDesc = base - (linea.descuento||0);
  linea.ivaPorc = STATE.ivaActivo ? STATE.ivaPorcentaje : 0;
  linea.ivaMonto = baseDesc * (linea.ivaPorc/100);
  linea.subtotal = baseDesc + linea.ivaMonto;
}
function renderCarritoCxP() {
  const tbody = document.getElementById('np-carrito-tbody');
  if (!tbody) return;
  if (!STATE.carrito.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Busca y agrega productos arriba</td></tr>`;
    actualizarResumenCxP();
    return;
  }
  tbody.innerHTML = STATE.carrito.map((l, idx) => `
    <tr>
      <td style="font-weight:500">${esc(l.producto.nombre)}</td>
      <td><input type="number" class="carrito-input" value="${l.cantidad}" min="0.01" step="0.01" onchange="actualizarLineaCarritoCxP(${idx},'cantidad',this.value)" style="width:70px"/></td>
      <td><input type="number" class="carrito-input" value="${l.precioUnitario}" min="0" step="0.01" onchange="actualizarLineaCarritoCxP(${idx},'precioUnitario',this.value)" style="width:90px"/></td>
      <td><input type="number" class="carrito-input" value="${l.descuento}" min="0" step="0.01" onchange="actualizarLineaCarritoCxP(${idx},'descuento',this.value)" style="width:80px"/></td>
      <td class="td-right" style="font-size:12px;color:var(--text-muted)">${l.ivaPorc>0?l.ivaPorc+'%':'—'}</td>
      <td class="td-right td-money">${fmt(l.subtotal)}</td>
      <td><button class="btn-icon btn-icon-danger" onclick="eliminarLineaCarritoCxP(${idx})" title="Eliminar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    </tr>`).join('');
  actualizarResumenCxP();
}
function actualizarLineaCarritoCxP(idx, campo, valor) {
  const l = STATE.carrito[idx]; if (!l) return;
  l[campo] = parseFloat(valor) || 0;
  recalcularLineaCxP(l);
  renderCarritoCxP();
}
function eliminarLineaCarritoCxP(idx) { STATE.carrito.splice(idx,1); renderCarritoCxP(); }

function toggleIVACxP(activo) {
  STATE.ivaActivo = activo;
  const wrap = document.getElementById('np-iva-porcentaje-wrap');
  if (wrap) wrap.style.display = activo ? 'flex' : 'none';
  STATE.carrito.forEach(recalcularLineaCxP);
  renderCarritoCxP();
}
function actualizarIVAPorcentajeCxP() {
  const val = parseFloat(document.getElementById('np-iva-porcentaje')?.value || 15);
  STATE.ivaPorcentaje = isNaN(val) ? 15 : val;
  STATE.carrito.forEach(recalcularLineaCxP);
  renderCarritoCxP();
}
function calcularTotalesCxP() {
  let subtotal=0, descTotal=0, ivaTotal=0;
  STATE.carrito.forEach(l => { subtotal += l.cantidad*l.precioUnitario; descTotal += l.descuento||0; ivaTotal += l.ivaMonto||0; });
  const total = subtotal - descTotal + ivaTotal;
  return { subtotal, descTotal, ivaTotal, total };
}
function actualizarResumenCxP() {
  const { subtotal, descTotal, ivaTotal, total } = calcularTotalesCxP();
  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('np-resumen-subtotal', fmt(subtotal));
  set('np-resumen-descuento', descTotal>0?`-${fmt(descTotal)}`:'—');
  set('np-resumen-iva', ivaTotal>0?fmt(ivaTotal):'—');
  set('np-resumen-total', fmt(total));
  const btnPreview = document.getElementById('np-total-preview');
  if (btnPreview) btnPreview.textContent = fmt(total);
  previewCuotasCxP();
}

/* =====================================================
   TIPO DE PAGO / TIPO DE CRÉDITO
===================================================== */
function seleccionarTipoCreditoCxP(tipo) {
  STATE.tipoCredito = tipo;
  document.getElementById('tc-opt-fecha_fija').classList.toggle('activo', tipo==='fecha_fija');
  document.getElementById('tc-opt-cuotas').classList.toggle('activo', tipo==='cuotas');
  document.getElementById('np-form-fecha-fija').style.display = tipo==='fecha_fija' ? 'block' : 'none';
  document.getElementById('np-form-cuotas').style.display     = tipo==='cuotas'    ? 'block' : 'none';
  previewCuotasCxP();
}
function generarCuotasCxP(total, numCuotas, fechaInicio, frecuencia) {
  numCuotas = Math.max(1, parseInt(numCuotas)||1);
  const base = Math.floor((total/numCuotas)*100)/100;
  let acumulado = 0;
  const cuotas = [];
  for (let i=0; i<numCuotas; i++) {
    let monto = base;
    if (i === numCuotas-1) monto = round2(total - acumulado); // la última absorbe el redondeo
    acumulado = round2(acumulado + monto);
    cuotas.push({
      numero: i+1,
      fecha_vencimiento: sumarFrecuenciaCxP(fechaInicio, frecuencia, i),
      monto_total: monto, monto_pagado: 0, saldo: monto, estado: 'pendiente',
    });
  }
  return cuotas;
}
function previewCuotasCxP() {
  const el = document.getElementById('np-cuotas-preview');
  if (!el || STATE.tipoCredito!=='cuotas') { if(el) el.textContent=''; return; }
  const { total } = calcularTotalesCxP();
  const numCuotas = parseInt(document.getElementById('np-num-cuotas')?.value)||0;
  const fechaInicio = document.getElementById('np-fecha-primera-cuota')?.value;
  const frecuencia = document.getElementById('np-frecuencia')?.value || 'mensual';
  if (!total || !numCuotas || !fechaInicio) { el.textContent = 'Completa el total, número de cuotas y fecha para ver el detalle.'; return; }
  const cuotas = generarCuotasCxP(total, numCuotas, fechaInicio, frecuencia);
  el.innerHTML = `${numCuotas} cuotas de ${fmt(cuotas[0].monto_total)} c/u (última: ${fmt(cuotas[cuotas.length-1].monto_total)}). Última fecha: ${fmtDate(cuotas[cuotas.length-1].fecha_vencimiento)}.`;
}

/* =====================================================
   ABRIR / RESET MODAL NUEVA CUENTA
===================================================== */
/* =====================================================
   CUENTA DIRECTA — gasto o deuda con un proveedor que NO es compra
   de mercancia. Nunca toca productos/detalle_compras/compras --
   crea la fila en cuentas_por_pagar directo, con compra_id en null
   (la tabla y el resto del modulo ya soportan esto desde antes:
   pagos, edicion y eliminacion ya revisan "if (cuenta.compra_id)"
   antes de tocar la parte de inventario, asi que una cuenta sin
   compra_id se comporta exactamente igual en todo lo demas).
===================================================== */
/* =====================================================
   AMORTIZACION CON PRIMA E INTERES (Cuenta Directa)
   Misma matematica ya probada en Creditos, sin impuestos (no
   aplica para un gasto/deuda que no es venta de productos).
===================================================== */
function calcularPrimaDirecta(monto, tipo, valor) {
  monto = Number(monto)||0; valor = Number(valor)||0;
  if (tipo === 'fija') return Math.min(round2(valor), monto);
  if (tipo === 'porcentual') return round2(monto * valor / 100);
  return 0;
}

function generarAmortizacionDirecta({ capitalFinanciado, tasaInteres, metodo, frecuencia, numCuotas, fechaInicio }) {
  capitalFinanciado = Number(capitalFinanciado)||0;
  numCuotas = Math.max(1, parseInt(numCuotas)||1);
  tasaInteres = Number(tasaInteres)||0;
  const cuotas = [];
  let totalIntereses = 0;

  if (tasaInteres <= 0) {
    const capitalCuota = round2(capitalFinanciado / numCuotas);
    let saldo = capitalFinanciado;
    for (let i = 1; i <= numCuotas; i++) {
      const esUltima = i === numCuotas;
      const cap = esUltima ? round2(saldo) : capitalCuota;
      saldo = round2(saldo - cap);
      cuotas.push({ numero: i, fecha_vencimiento: sumarFrecuenciaCxP(fechaInicio, frecuencia, i), capital: cap, interes: 0, monto_total: cap, saldo });
    }
  } else if (metodo === 'frances') {
    const r = tasaInteres / 100;
    const cuotaFija = capitalFinanciado * (r * Math.pow(1+r, numCuotas)) / (Math.pow(1+r, numCuotas) - 1);
    let saldo = capitalFinanciado;
    for (let i = 1; i <= numCuotas; i++) {
      const interes = round2(saldo * r);
      let cap = round2(cuotaFija - interes);
      const esUltima = i === numCuotas;
      if (esUltima) cap = round2(saldo);
      saldo = round2(saldo - cap);
      totalIntereses = round2(totalIntereses + interes);
      cuotas.push({ numero: i, fecha_vencimiento: sumarFrecuenciaCxP(fechaInicio, frecuencia, i), capital: cap, interes, monto_total: round2(cap+interes), saldo });
    }
  } else {
    // "simple": interes total = capital*tasa (un solo cargo), prorrateado en partes iguales
    totalIntereses = round2(capitalFinanciado * tasaInteres / 100);
    const interesCuota = round2(totalIntereses / numCuotas);
    const capitalCuota = round2(capitalFinanciado / numCuotas);
    let saldo = capitalFinanciado;
    for (let i = 1; i <= numCuotas; i++) {
      const esUltima = i === numCuotas;
      const cap = esUltima ? round2(saldo) : capitalCuota;
      const interes = esUltima ? round2(totalIntereses - interesCuota*(numCuotas-1)) : interesCuota;
      saldo = round2(saldo - cap);
      cuotas.push({ numero: i, fecha_vencimiento: sumarFrecuenciaCxP(fechaInicio, frecuencia, i), capital: cap, interes, monto_total: round2(cap+interes), saldo });
    }
  }
  return { cuotas, totalIntereses, totalFinanciado: round2(capitalFinanciado + totalIntereses) };
}

// Calculo INVERSO para el modo "manual": dado un monto fijo mensual
// que el usuario ya sabe que puede pagar, calcula cuantas cuotas
// hacen falta -- en vez de elegir el numero de cuotas y que el
// sistema calcule cuanto sale cada una (el modo normal).
function calcularCuotasNecesarias(capitalFinanciado, tasaInteres, metodo, montoFijo) {
  capitalFinanciado = Number(capitalFinanciado)||0;
  tasaInteres = Number(tasaInteres)||0;
  montoFijo = Number(montoFijo)||0;
  if (montoFijo <= 0) return null;

  if (tasaInteres <= 0) return Math.max(1, Math.ceil(capitalFinanciado / montoFijo));

  if (metodo === 'frances') {
    const r = tasaInteres / 100;
    // El pago fijo debe cubrir al menos el interes del primer periodo
    // -- si no, la deuda nunca terminaria de pagarse.
    if (montoFijo <= capitalFinanciado * r) return null;
    return Math.max(1, Math.ceil(Math.log(montoFijo / (montoFijo - capitalFinanciado*r)) / Math.log(1+r)));
  }
  // "simple": el interes total es fijo (un solo cargo), no depende de N
  const totalIntereses = round2(capitalFinanciado * tasaInteres / 100);
  return Math.max(1, Math.ceil(round2(capitalFinanciado + totalIntereses) / montoFijo));
}

function abrirNuevaCuentaDirecta() {
  document.getElementById('ncd-proveedor-select').innerHTML =
    `<option value="">— Selecciona un proveedor —</option>` +
    STATE.proveedores.filter(p => p.activo).map(p =>
      `<option value="${p.id}">${esc(p.nombre)}${p.telefono ? ' — '+esc(p.telefono) : ''}</option>`
    ).join('');
  document.getElementById('ncd-nuevo-proveedor-form').style.display = 'none';
  document.getElementById('ncd-prov-nombre').value = '';
  document.getElementById('ncd-concepto').value = '';
  document.getElementById('ncd-monto').value = '';
  document.getElementById('ncd-fecha').value = todayISO();
  document.getElementById('ncd-prima-tipo').value = 'ninguna';
  document.getElementById('ncd-prima-valor').value = '';
  document.getElementById('ncd-prima-valor').disabled = true;
  document.getElementById('ncd-wrap-metodo-prima').style.display = 'none';
  document.getElementById('ncd-tasa-interes').value = 0;
  document.getElementById('ncd-metodo-amortizacion').value = 'frances';
  document.getElementById('ncd-fecha-vencimiento').value = '';
  document.getElementById('ncd-num-cuotas').value = 2;
  document.getElementById('ncd-monto-fijo').value = '';
  document.getElementById('ncd-fecha-primera-cuota').value = '';
  document.getElementById('ncd-frecuencia').value = 'mensual';
  document.getElementById('ncd-observaciones').value = '';
  document.getElementById('ncd-error').textContent = '';
  STATE.proveedorSeleccionadoDirecto = null;
  STATE.tipoCreditoDirecto = null;
  STATE.modoCalculoDirecto = 'auto';
  STATE.tieneInteresDirecto = false;
  setTipoCreditoDirecto('fecha_fija');
  setModoCalculoDirecto('auto');
  setTieneInteresDirecto(false);
  openModal('modal-nueva-cuenta-directa');
}

function onSelectProveedorDirecto() {
  const id = document.getElementById('ncd-proveedor-select')?.value;
  STATE.proveedorSeleccionadoDirecto = id ? (STATE.proveedores.find(p => p.id === id) || null) : null;
  if (id) toggleNuevoProveedorDirecto(false);
}

function toggleNuevoProveedorDirecto(mostrar) {
  document.getElementById('ncd-nuevo-proveedor-form').style.display = mostrar ? 'block' : 'none';
  if (mostrar) {
    document.getElementById('ncd-proveedor-select').value = '';
    STATE.proveedorSeleccionadoDirecto = null;
  }
}

async function guardarNuevoProveedorDirecto() {
  const nombre = document.getElementById('ncd-prov-nombre')?.value.trim();
  if (!nombre) { showToast('El nombre del proveedor es requerido', 'error'); return; }
  try {
    setBtnLoading('btn-guardar-proveedor-directo', true);
    const { data, error } = await sbClient.from('proveedores')
      .insert({ auth_user_id: STATE.userId, nombre, activo: true }).select().single();
    if (error) throw error;
    STATE.proveedores.push(data);
    STATE.proveedorSeleccionadoDirecto = data;
    document.getElementById('ncd-proveedor-select').innerHTML =
      `<option value="">— Selecciona un proveedor —</option>` +
      STATE.proveedores.filter(p => p.activo).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    document.getElementById('ncd-proveedor-select').value = data.id;
    toggleNuevoProveedorDirecto(false);
    showToast('Proveedor guardado');
  } catch (e) {
    showToast('Error al guardar proveedor: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-guardar-proveedor-directo', false);
  }
}

function setTipoCreditoDirecto(tipo) {
  STATE.tipoCreditoDirecto = tipo;
  const btnFija = document.getElementById('ncd-tipo-fecha-fija');
  const btnCuotas = document.getElementById('ncd-tipo-cuotas');
  // Cambio visual directo (sin depender de una clase CSS compartida
  // con otro tipo de boton) -- autonomo, no puede afectar nada mas.
  btnFija.style.borderColor   = tipo === 'fecha_fija' ? 'var(--accent)' : '';
  btnFija.style.background    = tipo === 'fecha_fija' ? 'var(--accent-soft)' : '';
  btnCuotas.style.borderColor = tipo === 'cuotas' ? 'var(--accent)' : '';
  btnCuotas.style.background  = tipo === 'cuotas' ? 'var(--accent-soft)' : '';
  document.getElementById('ncd-wrap-fecha-fija').style.display = tipo === 'fecha_fija' ? 'block' : 'none';
  document.getElementById('ncd-wrap-cuotas').style.display     = tipo === 'cuotas'     ? 'block' : 'none';
  onCambioMontoODatosDirecto();
}

// Apagado (por defecto) deja el formulario simple: solo cuotas o
// monto fijo, sin mas opciones. Encendido muestra tasa+metodo.
function setTieneInteresDirecto(tiene) {
  STATE.tieneInteresDirecto = tiene;
  const btnNo = document.getElementById('ncd-interes-no');
  const btnSi = document.getElementById('ncd-interes-si');
  btnNo.style.borderColor = !tiene ? 'var(--accent)' : '';
  btnNo.style.background  = !tiene ? 'var(--accent-soft)' : '';
  btnSi.style.borderColor = tiene ? 'var(--accent)' : '';
  btnSi.style.background  = tiene ? 'var(--accent-soft)' : '';
  document.getElementById('ncd-wrap-interes-detalle').style.display = tiene ? 'block' : 'none';
  if (!tiene) document.getElementById('ncd-tasa-interes').value = 0;
  onCambioMontoODatosDirecto();
}

function setModoCalculoDirecto(modo) {
  STATE.modoCalculoDirecto = modo;
  const btnAuto = document.getElementById('ncd-modo-auto');
  const btnManual = document.getElementById('ncd-modo-manual');
  btnAuto.style.borderColor   = modo === 'auto' ? 'var(--accent)' : '';
  btnAuto.style.background    = modo === 'auto' ? 'var(--accent-soft)' : '';
  btnManual.style.borderColor = modo === 'manual' ? 'var(--accent)' : '';
  btnManual.style.background  = modo === 'manual' ? 'var(--accent-soft)' : '';
  document.getElementById('ncd-wrap-num-cuotas').style.display  = modo === 'auto'   ? 'block' : 'none';
  document.getElementById('ncd-wrap-monto-fijo').style.display  = modo === 'manual' ? 'block' : 'none';
  onCambioMontoODatosDirecto();
}

// Funcion "maestra" -- se llama cada vez que cambia cualquier campo
// relevante (monto, prima, tasa, metodo, modo, num_cuotas o monto
// fijo). Recalcula todo en cadena: prima -> capital financiado ->
// (modo manual: cuantas cuotas hacen falta) -> tabla de amortizacion.
function onCambioMontoODatosDirecto() {
  const monto = Number(document.getElementById('ncd-monto')?.value) || 0;
  const primaTipo = document.getElementById('ncd-prima-tipo')?.value || 'ninguna';
  const primaValorInput = document.getElementById('ncd-prima-valor');
  primaValorInput.disabled = (primaTipo === 'ninguna');
  const primaValor = Number(primaValorInput.value) || 0;
  const primaMonto = calcularPrimaDirecta(monto, primaTipo, primaValor);

  document.getElementById('ncd-wrap-metodo-prima').style.display = primaMonto > 0 ? 'block' : 'none';
  const resumenPrima = document.getElementById('ncd-prima-resumen');
  if (resumenPrima) resumenPrima.textContent = primaMonto > 0 ? `Se pagan ${fmt(primaMonto)} de inmediato (sale de Caja al guardar) — el resto (${fmt(round2(monto-primaMonto))}) queda como deuda.` : '';

  const capitalFinanciado = round2(monto - primaMonto);
  const tasaInteres = STATE.tieneInteresDirecto ? (Number(document.getElementById('ncd-tasa-interes')?.value) || 0) : 0;
  const metodo = document.getElementById('ncd-metodo-amortizacion')?.value || 'frances';

  const wrapTabla = document.getElementById('ncd-amortizacion-wrap');
  const tbody = document.getElementById('ncd-amortizacion-tbody');
  const resumenIntereses = document.getElementById('ncd-total-intereses-resumen');
  if (STATE.tipoCreditoDirecto !== 'cuotas') { wrapTabla.style.display = 'none'; resumenIntereses.style.display = 'none'; return; }

  const fechaInicio = document.getElementById('ncd-fecha-primera-cuota')?.value;
  const frecuencia = document.getElementById('ncd-frecuencia')?.value || 'mensual';
  const calcCuotasEl = document.getElementById('ncd-num-cuotas-calculado');

  let numCuotas;
  if (STATE.modoCalculoDirecto === 'manual') {
    const montoFijo = Number(document.getElementById('ncd-monto-fijo')?.value) || 0;
    numCuotas = calcularCuotasNecesarias(capitalFinanciado, tasaInteres, metodo, montoFijo);
    if (numCuotas === null) {
      if (calcCuotasEl) calcCuotasEl.innerHTML = `<span style="color:var(--danger)">Ese monto no alcanza ni para cubrir el interés — sube el monto mensual.</span>`;
      wrapTabla.style.display = 'none'; resumenIntereses.style.display = 'none';
      return;
    }
    if (calcCuotasEl) calcCuotasEl.textContent = montoFijo > 0 ? `Con ${fmt(montoFijo)} al mes, hacen falta ${numCuotas} cuota${numCuotas===1?'':'s'}.` : '';
  } else {
    numCuotas = parseInt(document.getElementById('ncd-num-cuotas')?.value) || 0;
  }

  if (!capitalFinanciado || !numCuotas || !fechaInicio) { wrapTabla.style.display = 'none'; resumenIntereses.style.display = 'none'; return; }

  const { cuotas, totalIntereses, totalFinanciado } = generarAmortizacionDirecta({ capitalFinanciado, tasaInteres, metodo, frecuencia, numCuotas, fechaInicio });

  tbody.innerHTML = cuotas.map(c => `
    <tr>
      <td>${c.numero}</td><td>${fmtDate(c.fecha_vencimiento)}</td>
      <td>${fmt(c.capital)}</td><td>${fmt(c.interes)}</td>
      <td>${fmt(c.monto_total)}</td><td>${fmt(c.saldo)}</td>
    </tr>`).join('');
  wrapTabla.style.display = 'block';

  if (totalIntereses > 0) {
    resumenIntereses.textContent = `Total de intereses: ${fmt(totalIntereses)} — total a pagar en cuotas: ${fmt(totalFinanciado)}`;
    resumenIntereses.style.display = 'block';
  } else {
    resumenIntereses.style.display = 'none';
  }
}

async function guardarCuentaDirecta() {
  const errEl = document.getElementById('ncd-error');
  errEl.textContent = '';

  // ---- Validaciones ----
  if (!STATE.proveedorSeleccionadoDirecto?.id) { errEl.textContent = 'Selecciona un proveedor.'; return; }
  const concepto = document.getElementById('ncd-concepto')?.value.trim();
  if (!concepto) { errEl.textContent = 'Escribe de qué es esta cuenta.'; return; }
  const montoOriginal = Number(document.getElementById('ncd-monto')?.value);
  if (!montoOriginal || montoOriginal <= 0) { errEl.textContent = 'Escribe un monto válido.'; return; }
  const fecha = document.getElementById('ncd-fecha')?.value;
  if (!fecha) { errEl.textContent = 'Elige la fecha de la deuda.'; return; }

  // ---- Prima ----
  const primaTipo = document.getElementById('ncd-prima-tipo')?.value || 'ninguna';
  const primaValor = Number(document.getElementById('ncd-prima-valor')?.value) || 0;
  const primaMonto = calcularPrimaDirecta(montoOriginal, primaTipo, primaValor);
  let metodoPrimaId = null, metodoPrimaNombre = null;
  if (primaMonto > 0) {
    const selMetodo = document.getElementById('ncd-metodo-prima');
    metodoPrimaId = selMetodo?.value || null;
    metodoPrimaNombre = selMetodo?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  }
  const capitalFinanciado = round2(montoOriginal - primaMonto);
  if (capitalFinanciado < 0) { errEl.textContent = 'La prima no puede ser mayor que el monto total.'; return; }

  // ---- Tipo de credito / interes / cuotas ----
  const tasaInteres = STATE.tieneInteresDirecto ? (Number(document.getElementById('ncd-tasa-interes')?.value) || 0) : 0;
  const metodoAmortizacion = tasaInteres > 0 ? (document.getElementById('ncd-metodo-amortizacion')?.value || 'frances') : null;

  let fechaVencimiento = null, numCuotas = null, frecuencia = null, cuotasGeneradas = [], totalIntereses = 0, totalFinanciado = capitalFinanciado;

  if (STATE.tipoCreditoDirecto === 'fecha_fija') {
    fechaVencimiento = document.getElementById('ncd-fecha-vencimiento')?.value;
    if (!fechaVencimiento) { errEl.textContent = 'Elige la fecha de vencimiento.'; return; }
    // Sin cuotas, pero si hay tasa de interes tambien se aplica al monto financiado.
    totalIntereses = tasaInteres > 0 ? round2(capitalFinanciado * tasaInteres / 100) : 0;
    totalFinanciado = round2(capitalFinanciado + totalIntereses);
  } else {
    const fechaPrimeraCuota = document.getElementById('ncd-fecha-primera-cuota')?.value;
    frecuencia = document.getElementById('ncd-frecuencia')?.value || 'mensual';
    if (!fechaPrimeraCuota) { errEl.textContent = 'Elige la fecha de la primera cuota.'; return; }

    if (STATE.modoCalculoDirecto === 'manual') {
      const montoFijo = Number(document.getElementById('ncd-monto-fijo')?.value) || 0;
      if (!montoFijo || montoFijo <= 0) { errEl.textContent = 'Escribe cuánto puedes pagar fijo cada mes.'; return; }
      numCuotas = calcularCuotasNecesarias(capitalFinanciado, tasaInteres, metodoAmortizacion, montoFijo);
      if (numCuotas === null) { errEl.textContent = 'Ese monto fijo no alcanza ni para cubrir el interés — sube el monto.'; return; }
    } else {
      numCuotas = parseInt(document.getElementById('ncd-num-cuotas')?.value) || 0;
      if (numCuotas < 1) { errEl.textContent = 'El número de cuotas debe ser al menos 1.'; return; }
    }

    const resultado = generarAmortizacionDirecta({ capitalFinanciado, tasaInteres, metodo: metodoAmortizacion, frecuencia, numCuotas, fechaInicio: fechaPrimeraCuota });
    cuotasGeneradas = resultado.cuotas;
    totalIntereses = resultado.totalIntereses;
    totalFinanciado = resultado.totalFinanciado;
    fechaVencimiento = cuotasGeneradas[cuotasGeneradas.length-1].fecha_vencimiento;
  }

  const observaciones = document.getElementById('ncd-observaciones')?.value.trim() || null;

  setBtnLoading('ncd-btn-guardar', true);
  try {
    const numero = await generarNumeroCxP();

    // monto_total/saldo_pendiente SIGUEN significando lo mismo que en
    // todo el resto del modulo (saldo_pendiente = monto_total -
    // monto_pagado) -- monto_total ahora incluye el monto ORIGINAL
    // mas los intereses que se generen; monto_pagado arranca en la
    // prima (si la hay), asi el saldo pendiente refleja exacto lo que
    // falta por pagar (el capital financiado + su interes).
    const montoTotalConIntereses = round2(montoOriginal + totalIntereses);
    const { data: cuenta, error: errCuenta } = await sbClient.from('cuentas_por_pagar').insert({
      auth_user_id: STATE.userId, numero,
      proveedor_id: STATE.proveedorSeleccionadoDirecto.id, proveedor_nombre: STATE.proveedorSeleccionadoDirecto.nombre,
      compra_id: null, tipo_credito: STATE.tipoCreditoDirecto, fecha_compra: fecha,
      fecha_vencimiento: fechaVencimiento, num_cuotas: STATE.tipoCreditoDirecto==='cuotas'?numCuotas:null,
      frecuencia: STATE.tipoCreditoDirecto==='cuotas'?frecuencia:null,
      monto_original: montoOriginal, prima_tipo: primaTipo, prima_valor: primaValor, prima_monto: primaMonto,
      tasa_interes: tasaInteres, metodo_amortizacion: metodoAmortizacion,
      monto_total: montoTotalConIntereses, monto_pagado: primaMonto, saldo_pendiente: round2(montoTotalConIntereses - primaMonto),
      estado: 'pendiente',
      observaciones: concepto + (observaciones ? ' — '+observaciones : ''),
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (errCuenta) throw errCuenta;

    if (STATE.tipoCreditoDirecto === 'cuotas') {
      const cuotasInsert = cuotasGeneradas.map(c => ({
        auth_user_id: STATE.userId, cuenta_id: cuenta.id, numero: c.numero,
        fecha_vencimiento: c.fecha_vencimiento, monto_total: c.monto_total, monto_pagado: 0, saldo: c.monto_total, estado: 'pendiente',
      }));
      const { error: errCuotas } = await sbClient.from('cuentas_por_pagar_cuotas').insert(cuotasInsert);
      if (errCuotas) throw errCuotas;
    }

    // La prima se paga DE INMEDIATO -- sale de Caja ahora mismo, y
    // queda registrada igual que cualquier otro pago a este proveedor
    // (mismo mecanismo ya usado en "Registrar pago", referencia_tipo
    // 'cuenta_por_pagar' apuntando a esta misma cuenta).
    if (primaMonto > 0) {
      const cajaRes = await window.CajaAPI.registrarMovimiento({
        auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'PAGO',
        concepto: `Prima — ${cuenta.numero} (${concepto})`, monto: primaMonto,
        metodo_pago_id: metodoPrimaId, metodo_pago_nombre: metodoPrimaNombre,
        referencia_tipo: 'cuenta_por_pagar', referencia_id: cuenta.id, observaciones: 'Prima / pago inicial',
      });
      if (!cajaRes.ok) showToast('La cuenta se guardó, pero la prima no se pudo registrar en Caja: ' + cajaRes.error, 'error');
      else {
        await sbClient.from('cuentas_por_pagar_pagos').insert({
          auth_user_id: STATE.userId, cuenta_id: cuenta.id, proveedor_id: STATE.proveedorSeleccionadoDirecto.id,
          monto: primaMonto, metodo_pago_id: metodoPrimaId, metodo_pago_nombre: metodoPrimaNombre,
          observaciones: 'Prima / pago inicial', saldo_anterior: montoTotalConIntereses, saldo_nuevo: round2(montoTotalConIntereses-primaMonto),
          comprobante_numero: `PAG-${cuenta.numero}-PRIMA`,
          usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
        });
      }
    }

    // Métricas del proveedor -- igual que en la compra normal
    await sbClient.from('proveedores').update({
      ultima_compra: fecha,
      monto_acumulado: Number(STATE.proveedorSeleccionadoDirecto.monto_acumulado||0) + montoTotalConIntereses,
      total_compras: Number(STATE.proveedorSeleccionadoDirecto.total_compras||0) + 1,
    }).eq('id', STATE.proveedorSeleccionadoDirecto.id).eq('auth_user_id', STATE.userId);

    closeModal('modal-nueva-cuenta-directa');
    showToast(`Cuenta directa ${cuenta.numero} creada`);
    await Promise.allSettled([loadKPIsCxP(), loadCuentasCxP(), loadProveedores()]);
  } catch (e) {
    console.error('guardarCuentaDirecta:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('ncd-btn-guardar', false);
  }
}

function abrirNuevaCuenta() {
  resetFormNuevaCuentaCxP();
  openModal('modal-nueva-cuenta');
}
function resetFormNuevaCuentaCxP() {
  STATE.carrito = [];
  STATE.proveedorSeleccionado = null;
  STATE.ivaActivo = false; STATE.ivaPorcentaje = 15;
  STATE.tipoCredito = 'fecha_fija';

  const sel = document.getElementById('np-proveedor-select'); if (sel) sel.value = '';
  toggleNuevoProveedorCxP(false);
  ['np-prov-nombre','np-prov-telefono','np-prov-email','np-prov-direccion','np-prov-obs'].forEach(id=>{const e=document.getElementById(id); if(e) e.value='';});

  const fecha = document.getElementById('np-fecha'); if (fecha) fecha.value = todayISO();
  const factura = document.getElementById('np-factura'); if (factura) factura.value = '';

  const sp = document.getElementById('np-producto-search'); if (sp) sp.value='';
  const sr = document.getElementById('np-search-results');  if (sr) sr.innerHTML='';
  toggleProductoNuevoCxP(false);
  renderCarritoCxP();

  const ivaCheck = document.getElementById('np-iva-activo'); if (ivaCheck) ivaCheck.checked=false;
  const ivaPorc  = document.getElementById('np-iva-porcentaje'); if (ivaPorc) ivaPorc.value='15';
  toggleIVACxP(false);

  document.querySelector('input[name="np-tipo-credito"][value="fecha_fija"]').checked = true;
  seleccionarTipoCreditoCxP('fecha_fija');

  const fechaVenc = document.getElementById('np-fecha-vencimiento'); if (fechaVenc) fechaVenc.value='';
  const numCuotas = document.getElementById('np-num-cuotas'); if (numCuotas) numCuotas.value='2';
  const fechaPrimeraCuota = document.getElementById('np-fecha-primera-cuota'); if (fechaPrimeraCuota) fechaPrimeraCuota.value='';
  const frecuencia = document.getElementById('np-frecuencia'); if (frecuencia) frecuencia.value='mensual';
  const preview = document.getElementById('np-cuotas-preview'); if (preview) preview.textContent='';

  const obs = document.getElementById('np-observaciones'); if (obs) obs.value='';
  const err = document.getElementById('np-error'); if (err) err.textContent='';
}

/* =====================================================
   NUMERACIÓN
===================================================== */
async function generarNumeroCompraCxP() {
  try {
    const { data } = await sbClient.rpc('siguiente_numero_compra', { p_user_id: STATE.userId });
    return data || ('C-' + String(Date.now()).slice(-6));
  } catch (e) { return 'C-' + String(Date.now()).slice(-6); }
}
async function generarNumeroCxP() {
  try {
    const { data, error } = await sbClient.rpc('generar_numero_cxp', { p_user_id: STATE.userId });
    if (error) throw error;
    return data;
  } catch (e) { return 'CXP-' + String(Date.now()).slice(-6); }
}

/* =====================================================
   GUARDAR NUEVA CUENTA — TRANSACCIÓN COMPLETA
===================================================== */
async function guardarNuevaCuentaCxP() {
  const errEl = document.getElementById('np-error');
  errEl.textContent = '';

  // ---- Validaciones ----
  if (!STATE.proveedorSeleccionado?.id) { errEl.textContent = 'Selecciona un proveedor.'; return; }
  if (!STATE.carrito.length) { errEl.textContent = 'Agrega al menos un producto.'; return; }
  for (const l of STATE.carrito) {
    if (!(l.cantidad > 0)) { errEl.textContent = `Cantidad inválida en "${l.producto.nombre}".`; return; }
    if (l.precioUnitario < 0) { errEl.textContent = `Precio inválido en "${l.producto.nombre}".`; return; }
  }
  const fecha = document.getElementById('np-fecha')?.value || todayISO();
  const factura = document.getElementById('np-factura')?.value.trim() || null;
  const observaciones = document.getElementById('np-observaciones')?.value.trim() || null;

  let fechaVencimiento = null, numCuotas = null, frecuencia = null, cuotasGeneradas = [];
  if (STATE.tipoCredito === 'fecha_fija') {
    fechaVencimiento = document.getElementById('np-fecha-vencimiento')?.value;
    if (!fechaVencimiento) { errEl.textContent = 'Indica la fecha de vencimiento.'; return; }
    if (fechaVencimiento < fecha) { errEl.textContent = 'La fecha de vencimiento no puede ser anterior a la fecha de compra.'; return; }
  } else {
    numCuotas = parseInt(document.getElementById('np-num-cuotas')?.value) || 0;
    const fechaPrimeraCuota = document.getElementById('np-fecha-primera-cuota')?.value;
    frecuencia = document.getElementById('np-frecuencia')?.value || 'mensual';
    if (numCuotas < 1) { errEl.textContent = 'El número de cuotas debe ser al menos 1.'; return; }
    if (!fechaPrimeraCuota) { errEl.textContent = 'Indica la fecha de la primera cuota.'; return; }
    if (fechaPrimeraCuota < fecha) { errEl.textContent = 'La fecha de la primera cuota no puede ser anterior a la fecha de compra.'; return; }
  }

  const { subtotal, descTotal, ivaTotal, total } = calcularTotalesCxP();
  if (total <= 0) { errEl.textContent = 'El total debe ser mayor a cero.'; return; }

  if (STATE.tipoCredito === 'cuotas') {
    const fechaPrimeraCuota = document.getElementById('np-fecha-primera-cuota').value;
    cuotasGeneradas = generarCuotasCxP(total, numCuotas, fechaPrimeraCuota, frecuencia);
    fechaVencimiento = cuotasGeneradas[cuotasGeneradas.length-1].fecha_vencimiento; // informativo
  }

  setBtnLoading('np-btn-guardar', true);
  try {
    const numero = await generarNumeroCompraCxP();

    // 1) Cabecera de compra (misma tabla que usa el módulo Compras).
    //    Cuentas por Pagar SIEMPRE es a crédito, así que la compra
    //    siempre queda "pendiente" (nunca descuenta Caja al crearla).
    const { data: compra, error: errCompra } = await sbClient.from('compras').insert({
      auth_user_id: STATE.userId, numero,
      proveedor_id: STATE.proveedorSeleccionado.id, proveedor_nombre: STATE.proveedorSeleccionado.nombre,
      fecha, subtotal, descuento_total: descTotal, iva_porcentaje: STATE.ivaActivo?STATE.ivaPorcentaje:0, iva_monto: ivaTotal, total,
      metodo_pago_nombre: 'Crédito', estado: 'pendiente',
      observaciones: factura ? `Factura ${factura}${observaciones?' — '+observaciones:''}` : observaciones,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (errCompra) throw errCompra;

    // 2) Detalle + stock + COSTO PROMEDIO PONDERADO.
    //    Aunque una compra a crédito no descuenta Caja de inmediato, el
    //    inventario que entra sí tiene un valor — si no se actualizara el
    //    costo, "Productos/Servicios" seguiría mostrando el valor de
    //    inventario con el costo viejo, subestimando lo que en realidad
    //    vale el stock después de esta compra.
    //    Fórmula: nuevo_costo = (stock_antes×costo_antes + cantidad×precio_compra) / stock_después
    for (const l of STATE.carrito) {
      const stockAntes = Number(l.producto.stock_actual||0);
      const costoAntes = Number(l.producto.costo||0);
      const cantidadComprada = Number(l.cantidad);
      const stockDespues = stockAntes + cantidadComprada;
      const nuevoCosto = stockDespues > 0
        ? round2((stockAntes*costoAntes + cantidadComprada*l.precioUnitario) / stockDespues)
        : l.precioUnitario;

      const { error: errDet } = await sbClient.from('detalle_compras').insert({
        auth_user_id: STATE.userId, compra_id: compra.id, producto_id: l.producto.id,
        producto_nombre: l.producto.nombre, producto_sku: l.producto.sku||null,
        cantidad: l.cantidad, costo_unitario: l.precioUnitario, descuento: l.descuento||0,
        iva_porcentaje: l.ivaPorc||0, iva_monto: l.ivaMonto||0, subtotal: l.subtotal,
        stock_antes: stockAntes, stock_despues: stockDespues,
      });
      if (errDet) throw errDet;
      const { error: errStock } = await sbClient.from('productos')
        .update({ stock_actual: stockDespues, costo: nuevoCosto, updated_at: new Date().toISOString() })
        .eq('id', l.producto.id).eq('auth_user_id', STATE.userId);
      if (errStock) throw errStock;
    }

    // 3) Crea la cuenta por pagar — NUNCA descuenta Caja al crearla
    //    (eso solo pasa cuando se registra un pago, en confirmarPagoCxP).
    const numeroCxP = await generarNumeroCxP();
    const { data: cuenta, error: errCuenta } = await sbClient.from('cuentas_por_pagar').insert({
      auth_user_id: STATE.userId, numero: numeroCxP,
      proveedor_id: STATE.proveedorSeleccionado.id, proveedor_nombre: STATE.proveedorSeleccionado.nombre,
      compra_id: compra.id, tipo_credito: STATE.tipoCredito, fecha_compra: fecha,
      fecha_vencimiento: fechaVencimiento, num_cuotas: STATE.tipoCredito==='cuotas'?numCuotas:null,
      frecuencia: STATE.tipoCredito==='cuotas'?frecuencia:null,
      monto_total: total, monto_pagado: 0, saldo_pendiente: total, estado: 'pendiente',
      observaciones, usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (errCuenta) throw errCuenta;

    if (STATE.tipoCredito === 'cuotas') {
      const cuotasInsert = cuotasGeneradas.map(c => ({ auth_user_id: STATE.userId, cuenta_id: cuenta.id, ...c }));
      const { error: errCuotas } = await sbClient.from('cuentas_por_pagar_cuotas').insert(cuotasInsert);
      if (errCuotas) throw errCuotas;
    }

    // 4) El IVA de la compra se registra en Impuestos como crédito fiscal
    //    (IVA_COMPRA): reduce el IVA neto a pagar, igual que Créditos ya
    //    hace con el IVA_VENTA para las ventas a crédito.
    if (ivaTotal > 0) await registrarImpuestoCompra(ivaTotal, compra, numeroCxP);

    // 5) Métricas del proveedor (igual que Compras)
    await sbClient.from('proveedores').update({
      ultima_compra: fecha,
      monto_acumulado: Number(STATE.proveedorSeleccionado.monto_acumulado||0) + total,
      total_compras: Number(STATE.proveedorSeleccionado.total_compras||0) + 1,
    }).eq('id', STATE.proveedorSeleccionado.id).eq('auth_user_id', STATE.userId);

    closeModal('modal-nueva-cuenta');
    showToast(`Compra ${numero} registrada — Cuenta ${cuenta.numero} creada`);
    await Promise.allSettled([loadKPIsCxP(), loadCuentasCxP(), loadProveedores(), loadProductosDisponibles()]);
  } catch (e) {
    console.error('guardarNuevaCuentaCxP:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('np-btn-guardar', false);
  }
}

// Registra el IVA de una compra a crédito como crédito fiscal (IVA_COMPRA)
// en el mismo libro que usa Impuestos, encadenando el saldo igual que
// Créditos hace con registrarImpuestoCredito — pero restando, porque el
// IVA pagado a un proveedor reduce el IVA neto que se debe, no lo aumenta.
async function registrarImpuestoCompra(montoImpuesto, compra, numeroCxP) {
  if (!montoImpuesto || montoImpuesto <= 0) return;
  try {
    const { data: ultMov } = await sbClient.from('movimientos_impuestos')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId)
      .order('created_at', { ascending:false }).limit(1).maybeSingle();
    const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
    const saldoRes = round2(saldoAnt - montoImpuesto);
    await sbClient.from('movimientos_impuestos').insert({
      auth_user_id: STATE.userId, tipo_movimiento: 'IVA_COMPRA',
      concepto: `IVA pagado en compra ${compra.numero} (cuenta ${numeroCxP})`,
      monto: montoImpuesto, saldo_anterior: saldoAnt, saldo_resultante: saldoRes,
      fecha: todayISO(),
    });
  } catch (e) { console.warn('registrarImpuestoCompra:', e); }
}

/* =====================================================
   CARGA DE CUENTAS + ESTADOS AUTOMÁTICOS
===================================================== */

// Recalcula (en memoria) el estado de una cuenta a partir de su saldo y
// fechas — el estado NUNCA se edita a mano, siempre se deriva.
function calcularEstadoCuenta(cuenta, proximaFecha) {
  if (Number(cuenta.saldo_pendiente) <= 0.01) return 'pagado';
  const ref = proximaFecha || cuenta.fecha_vencimiento;
  if (ref && ref < todayISO()) return 'vencido';
  return 'pendiente';
}

async function loadCuentasCxP() {
  const tbody = document.getElementById('cxp-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">Cargando cuentas por pagar…</td></tr>`;
  try {
    const { data: cuentas, error } = await sbClient.from('cuentas_por_pagar').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    if (error) throw error;

    const lista = cuentas || [];
    const idsCuotas = lista.filter(c => c.tipo_credito === 'cuotas').map(c => c.id);
    let proximaPorCuenta = {};
    if (idsCuotas.length) {
      const { data: cuotas } = await sbClient.from('cuentas_por_pagar_cuotas')
        .select('cuenta_id, fecha_vencimiento, estado').in('cuenta_id', idsCuotas).neq('estado', 'pagada').order('fecha_vencimiento');
      (cuotas||[]).forEach(cu => {
        if (!proximaPorCuenta[cu.cuenta_id]) proximaPorCuenta[cu.cuenta_id] = cu.fecha_vencimiento;
      });
    }

    // Recalcula y sincroniza estados vencidos (igual que marcarCuotasVencidas de Créditos)
    const actualizaciones = [];
    lista.forEach(c => {
      const proxima = proximaPorCuenta[c.id];
      const nuevoEstado = calcularEstadoCuenta(c, proxima);
      c._proximaFecha = proxima || c.fecha_vencimiento;
      if (nuevoEstado !== c.estado) { c.estado = nuevoEstado; actualizaciones.push({ id: c.id, estado: nuevoEstado }); }
    });
    await Promise.allSettled(actualizaciones.map(a => sbClient.from('cuentas_por_pagar').update({ estado: a.estado }).eq('id', a.id)));

    // Marca cuotas vencidas individualmente (visual, en el detalle)
    if (idsCuotas.length) {
      await sbClient.from('cuentas_por_pagar_cuotas')
        .update({ estado: 'vencida' }).eq('estado','pendiente').lt('fecha_vencimiento', todayISO()).in('cuenta_id', idsCuotas);
    }

    STATE.cuentas = lista;
    STATE.page = 1;
    renderTablaCxP();
  } catch (e) {
    console.error('loadCuentasCxP:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">No se pudieron cargar las cuentas por pagar</td></tr>`;
  }
}

function cuentasFiltradas() {
  const q = STATE.search.toLowerCase().trim();
  return STATE.cuentas.filter(c => {
    if (STATE.filtro === 'pendiente' && c.estado !== 'pendiente') return false;
    if (STATE.filtro === 'pagado'    && c.estado !== 'pagado')    return false;
    if (STATE.filtro === 'vencido'   && c.estado !== 'vencido')   return false;
    if (STATE.filtro === 'fecha_fija'&& c.tipo_credito !== 'fecha_fija') return false;
    if (STATE.filtro === 'cuotas'    && c.tipo_credito !== 'cuotas')     return false;
    if (!q) return true;
    return (c.proveedor_nombre||'').toLowerCase().includes(q) ||
           (c.numero||'').toLowerCase().includes(q) ||
           (c.observaciones||'').toLowerCase().includes(q);
  });
}

const ESTADO_INFO = {
  pendiente: { label: 'Pendiente', badge: 'badge-pendiente' },
  vencido:   { label: 'Vencido',   badge: 'badge-vencido' },
  pagado:    { label: 'Pagado',    badge: 'badge-pagado' },
};
const TIPO_CREDITO_INFO = {
  fecha_fija: { label: 'A fecha fija', badge: 'badge-fecha_fija' },
  cuotas:     { label: 'En cuotas',    badge: 'badge-cuotas' },
};

function renderTablaCxP() {
  const tbody = document.getElementById('cxp-tbody');
  if (!tbody) return;
  const filtradas = cuentasFiltradas();
  const totalPag = Math.max(1, Math.ceil(filtradas.length / STATE.perPage));
  STATE.page = Math.min(STATE.page, totalPag);
  const inicio = (STATE.page-1)*STATE.perPage;
  const pagina = filtradas.slice(inicio, inicio+STATE.perPage);

  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">No hay cuentas por pagar con estos filtros</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(c => {
      const ei = ESTADO_INFO[c.estado] || ESTADO_INFO.pendiente;
      const ti = TIPO_CREDITO_INFO[c.tipo_credito] || TIPO_CREDITO_INFO.fecha_fija;
      const sinPagos = Number(c.monto_pagado||0) <= 0;
      return `
      <tr class="${c.estado==='vencido'?'cxp-row-vencida':''}">
        <td style="font-weight:500">${esc(c.proveedor_nombre||'—')}</td>
        <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(c.numero)}</span></td>
        <td>${fmtDate(c.fecha_compra)}</td>
        <td><span class="status-badge ${ti.badge}">${ti.label}</span></td>
        <td class="td-right td-money">${fmt(c.monto_total)}</td>
        <td class="td-right td-money">${fmt(c.monto_pagado)}</td>
        <td class="td-right td-money">${fmt(c.saldo_pendiente)}</td>
        <td>${fmtDate(c._proximaFecha || c.fecha_vencimiento)}</td>
        <td><span class="status-badge ${ei.badge}">${ei.label}</span></td>
        <td class="td-actions">
          <button class="btn-icon" title="Ver" onclick="verDetalleCxP('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          ${c.estado!=='pagado' ? `<button class="btn-icon" title="Pagar" onclick="abrirPagarDesdeTabla('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>` : ''}
          ${sinPagos ? `<button class="btn-icon" title="Editar" onclick="abrirEditarCxP('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>
          <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="confirmarEliminarCxP('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  const info = document.getElementById('paginacion-info');
  if (info) info.textContent = filtradas.length ? `${inicio+1}–${Math.min(inicio+STATE.perPage,filtradas.length)} de ${filtradas.length}` : '—';
  const prev = document.getElementById('btn-pag-prev'); if (prev) prev.disabled = STATE.page<=1;
  const next = document.getElementById('btn-pag-next'); if (next) next.disabled = STATE.page>=totalPag;
}
function setFiltroCxP(f) {
  STATE.filtro = f; STATE.page = 1;
  document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => b.classList.toggle('active', b.dataset.filtro===f));
  renderTablaCxP();
}
function buscarCxP() { STATE.search = document.getElementById('cxp-search')?.value || ''; STATE.page = 1; renderTablaCxP(); }
function paginaAnterior() { if (STATE.page>1) { STATE.page--; renderTablaCxP(); } }
function paginaSiguiente() { STATE.page++; renderTablaCxP(); }

/* =====================================================
   KPIs
===================================================== */
async function loadKPIsCxP() {
  try {
    const cuentas = STATE.cuentas.length ? STATE.cuentas : (await sbClient.from('cuentas_por_pagar').select('*').eq('auth_user_id', STATE.userId)).data || [];
    const hoy = todayISO();
    const enUnaSemana = sumarFrecuenciaCxP(hoy, 'semanal', 1);

    const pendientesYVencidas = cuentas.filter(c => c.estado !== 'pagado');
    const totalPendiente = pendientesYVencidas.reduce((s,c)=>s+Number(c.saldo_pendiente||0),0);
    const totalVencido = cuentas.filter(c=>c.estado==='vencido').reduce((s,c)=>s+Number(c.saldo_pendiente||0),0);
    const venceHoy = pendientesYVencidas.filter(c => (c._proximaFecha||c.fecha_vencimiento) === hoy).length;
    const venceSemana = pendientesYVencidas.filter(c => {
      const f = c._proximaFecha||c.fecha_vencimiento;
      return f && f >= hoy && f <= enUnaSemana;
    }).length;
    const cantidadPendientes = pendientesYVencidas.length;

    const inicioMes = hoy.slice(0,7)+'-01';
    const { data: pagosMes } = await sbClient.from('cuentas_por_pagar_pagos').select('monto')
      .eq('auth_user_id', STATE.userId).gte('created_at', inicioMes);
    const pagadoMes = (pagosMes||[]).reduce((s,p)=>s+Number(p.monto||0),0);

    const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    set('kpi-total-pendiente', fmt(totalPendiente));
    set('kpi-total-vencido', fmt(totalVencido));
    set('kpi-vence-hoy', fmtNum(venceHoy));
    set('kpi-vence-semana', fmtNum(venceSemana));
    set('kpi-pagado-mes', fmt(pagadoMes));
    set('kpi-cantidad-pendientes', fmtNum(cantidadPendientes));
  } catch (e) { console.warn('loadKPIsCxP:', e); }
}

/* =====================================================
   PAGAR — modal genérico + distribución oldest-first en cuotas
===================================================== */
function poblarSelectCuentasPagables(preseleccionar) {
  const sel = document.getElementById('pg-cuenta-select');
  if (!sel) return;
  const pagables = STATE.cuentas.filter(c => c.estado !== 'pagado');
  sel.innerHTML = `<option value="">Selecciona una cuenta…</option>` + pagables.map(c =>
    `<option value="${c.id}">${esc(c.proveedor_nombre||'—')} — ${esc(c.numero)} — Pendiente: ${fmt(c.saldo_pendiente)}</option>`
  ).join('');
  if (preseleccionar) sel.value = preseleccionar;
}
function abrirPagarGenerico() {
  document.getElementById('pg-error').textContent = '';
  document.getElementById('pg-resumen').style.display = 'none';
  document.getElementById('pg-select-cuenta-row').style.display = '';
  document.getElementById('pg-monto').value = '';
  document.getElementById('pg-observaciones').value = '';
  populateMetodosSelect();
  poblarSelectCuentasPagables(null);
  STATE.cuentaActual = null;
  openModal('modal-pagar-cxp');
}
function abrirPagarDesdeTabla(id) {
  document.getElementById('pg-error').textContent = '';
  document.getElementById('pg-observaciones').value = '';
  populateMetodosSelect();
  poblarSelectCuentasPagables(id);
  onSelectCuentaPagarCxP();
  openModal('modal-pagar-cxp');
}
function onSelectCuentaPagarCxP() {
  const id = document.getElementById('pg-cuenta-select')?.value;
  const cuenta = STATE.cuentas.find(c => c.id === id);
  STATE.cuentaActual = cuenta || null;
  const resumen = document.getElementById('pg-resumen');
  if (!cuenta) { resumen.style.display = 'none'; return; }
  resumen.style.display = 'grid';
  document.getElementById('pg-proveedor').textContent = cuenta.proveedor_nombre || '—';
  document.getElementById('pg-total').textContent = fmt(cuenta.monto_total);
  document.getElementById('pg-pagado').textContent = fmt(cuenta.monto_pagado);
  document.getElementById('pg-pendiente').textContent = fmt(cuenta.saldo_pendiente);
  document.getElementById('pg-vencimiento').textContent = fmtDate(cuenta._proximaFecha || cuenta.fecha_vencimiento);
  const montoEl = document.getElementById('pg-monto');
  if (!montoEl.value) montoEl.value = round2(cuenta.saldo_pendiente);
}
// Atajo: pagar exactamente una cuota (siempre se paga en orden, oldest-first;
// si la cuota elegida no es la más antigua pendiente, el pago igual se
// aplicará primero a la más antigua — así se evita dejar "huecos" de cuotas
// atrasadas sin pagar mientras se paga una futura).
function pagarCuotaIndividual(cuentaId, montoSugerido) {
  abrirPagarDesdeTabla(cuentaId);
  setTimeout(() => { const m = document.getElementById('pg-monto'); if (m) m.value = round2(montoSugerido); }, 0);
}

async function confirmarPagoCxP() {
  const errEl = document.getElementById('pg-error');
  errEl.textContent = '';
  const cuenta = STATE.cuentaActual;
  if (!cuenta) { errEl.textContent = 'Selecciona una cuenta.'; return; }
  const monto = round2(parseFloat(document.getElementById('pg-monto')?.value) || 0);
  if (monto <= 0) { errEl.textContent = 'El monto debe ser mayor a cero.'; return; }

  const metodoSel = document.getElementById('pg-metodo');
  const metodoId = metodoSel?.value || null;
  const metodoNombre = metodoSel?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  const observaciones = document.getElementById('pg-observaciones')?.value.trim() || null;

  setBtnLoading('btn-confirmar-pago-cxp', true);
  try {
    // Releer la cuenta fresca (evita pisar cambios de otra pestaña)
    const { data: cuentaFresca, error: errC } = await sbClient.from('cuentas_por_pagar').select('*').eq('id', cuenta.id).single();
    if (errC) throw errC;

    if (monto > Number(cuentaFresca.saldo_pendiente) + 0.01) {
      errEl.textContent = `El monto excede el saldo pendiente (${fmt(cuentaFresca.saldo_pendiente)}).`;
      setBtnLoading('btn-confirmar-pago-cxp', false);
      return;
    }

    // Si es en cuotas: distribuye el pago entre las cuotas pendientes, de la más antigua a la más nueva
    if (cuentaFresca.tipo_credito === 'cuotas') {
      const { data: cuotasPendientes } = await sbClient.from('cuentas_por_pagar_cuotas').select('*')
        .eq('cuenta_id', cuentaFresca.id).neq('estado','pagada').order('numero');
      let restante = monto;
      for (const cu of (cuotasPendientes||[])) {
        if (restante <= 0) break;
        const debe = round2(cu.monto_total - cu.monto_pagado);
        if (debe <= 0) continue;
        const aplicar = Math.min(restante, debe);
        const nuevoPagado = round2(cu.monto_pagado + aplicar);
        const nuevoSaldo = round2(cu.monto_total - nuevoPagado);
        const nuevoEstadoCuota = nuevoSaldo <= 0.01 ? 'pagada' : 'parcial';
        await sbClient.from('cuentas_por_pagar_cuotas').update({
          monto_pagado: nuevoPagado, saldo: nuevoSaldo, estado: nuevoEstadoCuota, updated_at: new Date().toISOString(),
        }).eq('id', cu.id);
        restante = round2(restante - aplicar);
      }
    }

    const saldoAnterior = Number(cuentaFresca.saldo_pendiente);
    const saldoNuevo = round2(Math.max(0, saldoAnterior - monto));
    const montoPagadoNuevo = round2(Number(cuentaFresca.monto_pagado) + monto);
    const nuevoEstado = calcularEstadoCuenta({ ...cuentaFresca, saldo_pendiente: saldoNuevo }, null);

    await sbClient.from('cuentas_por_pagar').update({
      monto_pagado: montoPagadoNuevo, saldo_pendiente: saldoNuevo, estado: nuevoEstado, updated_at: new Date().toISOString(),
    }).eq('id', cuentaFresca.id);

    // Si queda totalmente pagada, refleja "completada" en el historial de Compras
    if (nuevoEstado === 'pagado' && cuentaFresca.compra_id) {
      await sbClient.from('compras').update({ estado: 'completada' }).eq('id', cuentaFresca.compra_id);
    }

    // Egreso en Caja: pagar a un proveedor es SALIDA de dinero
    const cajaRes = await window.CajaAPI.registrarMovimiento({
      auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'PAGO',
      concepto: `Pago a proveedor — ${cuentaFresca.numero}`, monto,
      metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
      referencia_tipo: 'cuenta_por_pagar', referencia_id: cuentaFresca.id, observaciones,
    });
    if (!cajaRes.ok) showToast('El pago se guardó, pero no se pudo registrar en Caja: ' + cajaRes.error, 'error');

    const comprobanteNumero = `PAG-${cuentaFresca.numero}-${Date.now().toString().slice(-5)}`;
    await sbClient.from('cuentas_por_pagar_pagos').insert({
      auth_user_id: STATE.userId, cuenta_id: cuentaFresca.id, proveedor_id: cuentaFresca.proveedor_id,
      monto, metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre, observaciones,
      saldo_anterior: saldoAnterior, saldo_nuevo: saldoNuevo, comprobante_numero: comprobanteNumero,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    });

    showToast('Pago registrado correctamente');
    closeModal('modal-pagar-cxp');
    mostrarComprobanteCxP({
      titulo: 'Pago a proveedor', numero: comprobanteNumero, cuenta: cuentaFresca.numero,
      proveedor: cuentaFresca.proveedor_nombre || '—', fecha: todayISO(),
      usuario: STATE.currentUser?.nombre || STATE.userEmail, monto, metodo: metodoNombre,
      saldoAnterior, saldoNuevo, estado: ESTADO_INFO[nuevoEstado]?.label || nuevoEstado,
    });
    await Promise.allSettled([loadKPIsCxP(), loadCuentasCxP()]);
  } catch (e) {
    console.error('confirmarPagoCxP:', e);
    errEl.textContent = 'Error al registrar el pago: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-confirmar-pago-cxp', false);
  }
}

/* =====================================================
   DETALLE (cuotas + historial de pagos)
===================================================== */
async function verDetalleCxP(id) {
  const cuenta = STATE.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  STATE.cuentaActual = cuenta;
  document.getElementById('det-cxp-title').textContent = `Cuenta ${cuenta.numero} — ${cuenta.proveedor_nombre||'—'}`;
  const btnPagar = document.getElementById('det-cxp-btn-pagar');
  btnPagar.style.display = cuenta.estado === 'pagado' ? 'none' : 'inline-flex';
  const body = document.getElementById('detalle-cxp-body');
  body.innerHTML = 'Cargando…';
  openModal('modal-detalle-cxp');

  try {
    const [{ data: cuotas }, { data: pagos }] = await Promise.all([
      cuenta.tipo_credito === 'cuotas'
        ? sbClient.from('cuentas_por_pagar_cuotas').select('*').eq('cuenta_id', id).order('numero')
        : Promise.resolve({ data: [] }),
      sbClient.from('cuentas_por_pagar_pagos').select('*').eq('cuenta_id', id).order('created_at', { ascending: false }),
    ]);

    const ei = ESTADO_INFO[cuenta.estado] || ESTADO_INFO.pendiente;
    const ti = TIPO_CREDITO_INFO[cuenta.tipo_credito] || TIPO_CREDITO_INFO.fecha_fija;

    let html = `
      <div class="form-row">
        <div><label>Proveedor</label><div class="stat-readonly">${esc(cuenta.proveedor_nombre||'—')}</div></div>
        <div><label>N° compra</label><div class="stat-readonly">${esc(cuenta.numero)}</div></div>
        <div><label>Tipo de crédito</label><div class="stat-readonly"><span class="status-badge ${ti.badge}">${ti.label}</span></div></div>
        <div><label>Estado</label><div class="stat-readonly"><span class="status-badge ${ei.badge}">${ei.label}</span></div></div>
        <div><label>Fecha de compra</label><div class="stat-readonly">${fmtDate(cuenta.fecha_compra)}</div></div>
        <div><label>Vencimiento</label><div class="stat-readonly">${fmtDate(cuenta._proximaFecha||cuenta.fecha_vencimiento)}</div></div>
        <div><label>Total</label><div class="stat-readonly">${fmt(cuenta.monto_total)}</div></div>
        <div><label>Pagado</label><div class="stat-readonly">${fmt(cuenta.monto_pagado)}</div></div>
        <div><label>Saldo pendiente</label><div class="stat-readonly" style="font-weight:800;color:var(--accent)">${fmt(cuenta.saldo_pendiente)}</div></div>
      </div>
      ${cuenta.observaciones ? `<p style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)"><strong>Observaciones:</strong> ${esc(cuenta.observaciones)}</p>` : ''}
    `;

    if (cuenta.tipo_credito === 'cuotas') {
      html += `<div class="nc-paso-title" style="margin-top:16px">Cuotas</div>
        <div class="table-wrap"><table><thead><tr><th>Cuota</th><th>Vencimiento</th><th class="th-right">Monto</th><th class="th-right">Pagado</th><th class="th-right">Saldo</th><th>Estado</th><th></th></tr></thead><tbody>
        ${(cuotas||[]).map(cu => {
          const ci = { pendiente:'badge-pendiente', vencida:'badge-vencido', pagada:'badge-pagado', parcial:'badge-parcial' }[cu.estado] || 'badge-pendiente';
          const labelCu = { pendiente:'Pendiente', vencida:'Vencida', pagada:'Pagada', parcial:'Pago parcial' }[cu.estado] || cu.estado;
          return `<tr>
            <td>${cu.numero}/${cuenta.num_cuotas}</td><td>${fmtDate(cu.fecha_vencimiento)}</td>
            <td class="td-right td-money">${fmt(cu.monto_total)}</td><td class="td-right td-money">${fmt(cu.monto_pagado)}</td><td class="td-right td-money">${fmt(cu.saldo)}</td>
            <td><span class="status-badge ${ci}">${labelCu}</span></td>
            <td>${cu.estado!=='pagada' ? `<button class="btn-icon" title="Pagar esta cuota" onclick="closeModal('modal-detalle-cxp');pagarCuotaIndividual('${cuenta.id}', ${cu.saldo})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>` : ''}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="7" class="empty-cell">Sin cuotas</td></tr>'}
        </tbody></table></div>`;
    }

    html += `<div class="nc-paso-title" style="margin-top:16px">Historial de pagos</div>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th class="th-right">Monto</th><th>Método</th><th>Usuario</th><th>Observaciones</th></tr></thead><tbody>
      ${(pagos||[]).map(p => `<tr>
        <td>${fmtDate((p.created_at||'').slice(0,10))}</td>
        <td class="td-right td-money">${fmt(p.monto)}</td>
        <td>${esc(p.metodo_pago_nombre||'—')}</td>
        <td>${esc(p.usuario_nombre||'—')}</td>
        <td>${esc(p.observaciones||'—')}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty-cell">Sin pagos registrados todavía</td></tr>'}
      </tbody></table></div>`;

    body.innerHTML = html;
  } catch (e) {
    console.error('verDetalleCxP:', e);
    body.innerHTML = 'No se pudo cargar el detalle.';
  }
}
function abrirPagarDesdeDetalle() {
  const cuenta = STATE.cuentaActual;
  closeModal('modal-detalle-cxp');
  if (cuenta) abrirPagarDesdeTabla(cuenta.id);
}

/* =====================================================
   EDITAR (solo observaciones / vencimiento, sin pagos)
===================================================== */
function abrirEditarCxP(id) {
  const cuenta = STATE.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  if (Number(cuenta.monto_pagado) > 0) { showToast('No se puede editar: ya tiene pagos registrados', 'error'); return; }
  STATE.cuentaActual = cuenta;
  const wrap = document.getElementById('ed-venc-wrap');
  wrap.style.display = cuenta.tipo_credito === 'fecha_fija' ? 'block' : 'none';
  document.getElementById('ed-fecha-vencimiento').value = cuenta.fecha_vencimiento || '';
  document.getElementById('ed-observaciones').value = cuenta.observaciones || '';
  openModal('modal-editar-cxp');
}
async function guardarEdicionCxP() {
  const cuenta = STATE.cuentaActual;
  if (!cuenta) return;
  setBtnLoading('btn-guardar-edicion-cxp', true);
  try {
    const payload = { observaciones: document.getElementById('ed-observaciones').value.trim() || null, updated_at: new Date().toISOString() };
    if (cuenta.tipo_credito === 'fecha_fija') {
      const nuevaFecha = document.getElementById('ed-fecha-vencimiento').value;
      if (nuevaFecha && nuevaFecha < cuenta.fecha_compra) { showToast('La fecha de vencimiento no puede ser anterior a la de compra', 'error'); return; }
      payload.fecha_vencimiento = nuevaFecha || null;
    }
    const { error } = await sbClient.from('cuentas_por_pagar').update(payload).eq('id', cuenta.id);
    if (error) throw error;
    showToast('Cambios guardados');
    closeModal('modal-editar-cxp');
    await loadCuentasCxP();
  } catch (e) {
    console.error('guardarEdicionCxP:', e);
    showToast('Error al guardar: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-guardar-edicion-cxp', false);
  }
}

/* =====================================================
   ELIMINAR (solo si no tiene pagos, revierte stock)
===================================================== */
function confirmarEliminarCxP(id) {
  const cuenta = STATE.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  if (Number(cuenta.monto_pagado) > 0) { showToast('No se puede eliminar: ya tiene pagos registrados', 'error'); return; }
  STATE.cuentaActual = cuenta;
  openModal('modal-confirmar-eliminar-cxp');
}
async function eliminarCuentaCxP() {
  const cuenta = STATE.cuentaActual;
  if (!cuenta) return;
  setBtnLoading('btn-confirmar-eliminar-cxp', true);
  try {
    if (Number(cuenta.monto_pagado) > 0) throw new Error('Esta cuenta ya tiene pagos registrados');

    if (cuenta.compra_id) {
      const { data: lineas } = await sbClient.from('detalle_compras').select('*').eq('compra_id', cuenta.compra_id);
      for (const l of (lineas||[])) {
        const { data: prod } = await sbClient.from('productos').select('stock_actual').eq('id', l.producto_id).maybeSingle();
        if (prod) {
          const nuevoStock = Math.max(0, Number(prod.stock_actual||0) - Number(l.cantidad||0));
          await sbClient.from('productos').update({ stock_actual: nuevoStock }).eq('id', l.producto_id);
        }
      }
      await sbClient.from('detalle_compras').delete().eq('compra_id', cuenta.compra_id);
      await sbClient.from('compras').delete().eq('id', cuenta.compra_id);
    }

    // Las cuotas se eliminan solas (ON DELETE CASCADE)
    await sbClient.from('cuentas_por_pagar').delete().eq('id', cuenta.id);

    showToast('Cuenta por pagar eliminada');
    closeModal('modal-confirmar-eliminar-cxp');
    await Promise.allSettled([loadKPIsCxP(), loadCuentasCxP(), loadProductosDisponibles()]);
  } catch (e) {
    console.error('eliminarCuentaCxP:', e);
    showToast('Error al eliminar: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-confirmar-eliminar-cxp', false);
  }
}

/* =====================================================
   COMPROBANTE
===================================================== */
function mostrarComprobanteCxP(c) {
  STATE.ultimoComprobante = c;
  document.getElementById('comprobante-cxp-body').innerHTML = `
    <div class="ticket-print">
      <div style="text-align:center;font-weight:800;margin-bottom:4px">${esc(STATE.empresaConfig?.nombre_comercial || 'Negocio360')}</div>
      <div style="text-align:center;color:var(--text-muted);margin-bottom:8px">${esc(c.titulo)}</div>
      <hr/>
      <div class="tp-row"><span>N° comprobante:</span><b>${esc(c.numero)}</b></div>
      <div class="tp-row"><span>Cuenta:</span><b>${esc(c.cuenta)}</b></div>
      <div class="tp-row"><span>Proveedor:</span><b>${esc(c.proveedor)}</b></div>
      <div class="tp-row"><span>Fecha:</span><b>${fmtDate(c.fecha)}</b></div>
      <div class="tp-row"><span>Usuario:</span><b>${esc(c.usuario)}</b></div>
      <hr/>
      <div class="tp-row"><span>Monto pagado:</span><b>${fmt(c.monto)}</b></div>
      <div class="tp-row"><span>Método de pago:</span><b>${esc(c.metodo)}</b></div>
      <div class="tp-row"><span>Saldo anterior:</span><b>${fmt(c.saldoAnterior)}</b></div>
      <div class="tp-row"><span>Saldo nuevo:</span><b>${fmt(c.saldoNuevo)}</b></div>
      <hr/>
      <div class="tp-row"><span>Estado de la cuenta:</span><b>${esc(c.estado)}</b></div>
    </div>`;
  openModal('modal-comprobante-cxp');
}
function imprimirComprobanteCxP() {
  const html = document.getElementById('comprobante-cxp-body').innerHTML;
  const w = window.open('', '_blank', 'width=380,height=600');
  w.document.write(`<html><head><meta charset="UTF-8"><title>Comprobante</title>
    <style>body{font-family:'JetBrains Mono',monospace;font-size:12.5px;padding:16px}.tp-row{display:flex;justify-content:space-between;gap:10px}hr{border:none;border-top:1px dashed #999;margin:8px 0}</style>
    </head><body>${html}<script>window.print();</script></body></html>`);
  w.document.close();
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
async function initCuentasPorPagar() {
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

    await Promise.allSettled([loadMetodosPago(), loadProductosDisponibles(), loadProveedores()]);
    await loadCuentasCxP();
    await loadKPIsCxP();
  } catch (err) {
    console.error('initCuentasPorPagar:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initCuentasPorPagar();
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
