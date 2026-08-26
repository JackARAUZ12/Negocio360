/* =====================================================
   DELIVERY.JS — NEGOCIO360
   Pedidos de entrega individuales — a diferencia de Rutas (una
   ronda planificada con varias paradas), cada pedido aquí es su
   propio caso, con su propio repartidor (propio o servicio externo),
   sin necesidad de agruparlo con otros pedidos.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  pedidos: [], perfiles: [], ventasDisponibles: [],
  filtroEstado: '', metodosPago: [], cajaChicaAbiertaHoy: false,
  modoVentaPedido: 'ninguna', // 'ninguna' | 'existente' | 'nueva'
  tipoPagoVentaPedido: 'completo', // 'completo' | 'parcial'
  carritoVentaDelivery: [], // [{producto_id, nombre, precio, costo, cantidad}]
  productosCacheDelivery: null,
  escalasCacheDelivery: {},
};

// Estado de banco elegido para la VENTA creada desde Delivery
// (aparte del banco de costo/cobro de envío, que es otro dinero).
let _bancoElegidoVenta = null;
let _montoBancoConvertidoVenta = null;

// Estado de banco elegido, por separado para costo y cobro (pueden
// ser bancos distintos, o uno de los dos ni siquiera usar banco).
let _bancosCacheDelivery = null;
let _bancoElegido = { costo: null, cobro: null };
let _montoBancoConvertido = { costo: null, cobro: null };

// Mismo dato que ya usa auditoria-guard.js -- que perfil de personal
// creo esta venta desde Delivery.
function obtenerNombrePerfilActivo() {
  try {
    const raw = sessionStorage.getItem('n360_perfil_activo');
    const perfil = raw ? JSON.parse(raw) : null;
    return perfil?.nombre || 'Admin';
  } catch (_) { return 'Admin'; }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = monedaParaMostrar(STATE.empresaConfig?.moneda);
  return `${sym} ${convertirParaMostrar(amount, STATE.empresaConfig?.moneda).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function fmtNum(n) { return Number(n||0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }

/* FIX ZONA HORARIA (mismo que ya existe en Ventas/Compras): usar
   new Date().toISOString() da la fecha en UTC. Nicaragua es UTC-6,
   así que después de las 6:00 PM hora local, la fecha en UTC YA ES
   EL DÍA SIGUIENTE — cualquier venta/movimiento creado de noche
   quedaba con la fecha de mañana, y no aparecía en Ventas ni en
   Caja al revisar el mismo día. Se usa la fecha calendario LOCAL.  */
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayLocalISO() { return ymdLocal(new Date()); }

/* =====================================================
   SHELL: TEMA, SIDEBAR, NAVEGACIÓN (idéntico al resto del sistema)
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
   HELPERS DE MODAL Y TOAST
===================================================== */
function openModal(id) { const el = document.getElementById(id); if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; } }
function setBtnLoading(id, loading) { const btn = document.getElementById(id); if (btn) { btn.disabled = loading; btn.style.opacity = loading ? '.6' : ''; } }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function fmtFechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-NI', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
  } catch (e) {}
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hAv = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name||'U')[0].toUpperCase();
}

/* =====================================================
   CARGA DE DATOS
===================================================== */
/* =====================================================
   MÉTODOS DE PAGO, CAJA CHICA Y BANCOS — el dinero del envío
   (costo y cobro) ahora sí toca Caja de verdad, con el mismo
   sistema de bancos ya usado en Ventas/Compras/Créditos.
===================================================== */
async function loadMetodosPago() {
  try {
    const { data } = await sb.from('metodos_pago').select('id, nombre, activo, es_default')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('orden');
    STATE.metodosPago = data && data.length ? data : [{ id: null, nombre: 'Efectivo', es_default: true }];
  } catch (e) { STATE.metodosPago = [{ id: null, nombre: 'Efectivo', es_default: true }]; }
  const opciones = STATE.metodosPago.map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  const def = STATE.metodosPago.find(m => m.es_default);
  ['np-costo-metodo', 'np-cobro-metodo'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = opciones;
    if (def) sel.value = def.id || '';
  });
}

async function hayCajaChicaAbiertaHoy() {
  try {
    const hoy = todayLocalISO();
    const { data } = await sb.from('caja_chica_sesiones')
      .select('id').eq('auth_user_id', STATE.userId).eq('fecha', hoy).eq('estado', 'abierta').maybeSingle();
    return !!data;
  } catch (e) { return false; }
}

async function cargarBancosDisponiblesDelivery() {
  if (_bancosCacheDelivery) return _bancosCacheDelivery;
  try {
    const { data } = await sb.from('bancos').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('created_at');
    _bancosCacheDelivery = data || [];
  } catch (e) { _bancosCacheDelivery = []; }
  return _bancosCacheDelivery;
}

// Se activa/oculta el bloque de método de pago según si el monto de
// costo o cobro pasó de 0 a un valor real (o viceversa).
function onCambioMontoEnvio(tipo) {
  const monto = parseFloat(document.getElementById(`np-${tipo}-envio`).value) || 0;
  const wrap = document.getElementById(`np-${tipo}-metodo-wrap`);
  wrap.style.display = monto > 0 ? '' : 'none';
  if (monto > 0) {
    const origenWrap = document.getElementById(`np-${tipo}-origen-caja-wrap`);
    if (origenWrap) origenWrap.style.display = STATE.cajaChicaAbiertaHoy ? '' : 'none';
  } else {
    _bancoElegido[tipo] = null; _montoBancoConvertido[tipo] = null;
    document.getElementById(`np-${tipo}-banco-elegir-wrap`).style.display = 'none';
    document.getElementById(`np-${tipo}-banco-elegido-wrap`).style.display = 'none';
  }
}

async function mostrarSelectorBancoDelivery(tipo, metodoNombre) {
  const metodo = (metodoNombre || '').toLowerCase();
  document.getElementById(`np-${tipo}-banco-elegir-wrap`).style.display = 'none';
  document.getElementById(`np-${tipo}-banco-elegido-wrap`).style.display = 'none';
  _bancoElegido[tipo] = null; _montoBancoConvertido[tipo] = null;
  if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;

  const bancos = await cargarBancosDisponiblesDelivery();
  if (!bancos.length) return; // sin bancos creados, sigue todo normal

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  document.getElementById(`np-${tipo}-banco-elegir-grid`).innerHTML = bancos.map(b => `
    <div class="metodo-card" onclick="elegirBancoDelivery('${tipo}','${b.id}','${esc(b.nombre)}','${b.moneda||'NIO'}')">
      <span class="mc-icon">🏦</span>
      <span class="mc-name">${esc(b.nombre)}${(b.moneda||'NIO')!==monedaBase ? ` <b style="color:var(--accent)">(${b.moneda})</b>` : ''}</span>
    </div>`).join('');
  document.getElementById(`np-${tipo}-banco-elegir-wrap`).style.display = '';
}

function elegirBancoDelivery(tipo, bancoId, bancoNombre, monedaBanco) {
  _bancoElegido[tipo] = bancoId;
  document.getElementById(`np-${tipo}-banco-elegir-wrap`).style.display = 'none';

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (monedaBanco||'NIO') !== monedaBase;
  const monto = parseFloat(document.getElementById(`np-${tipo}-envio`).value) || 0;
  const elNombre = document.getElementById(`np-${tipo}-banco-elegido-nombre`);

  if (esOtraMoneda) {
    const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) {
      elNombre.innerHTML = `${esc(bancoNombre)} <span style="color:var(--danger)">— falta configurar tu tasa de cambio en Caja › Bancos</span>`;
    } else {
      const convertido = monedaBase === 'NIO' ? round2(monto / tasa) : round2(monto * tasa);
      _montoBancoConvertido[tipo] = convertido;
      elNombre.innerHTML = `${esc(bancoNombre)} — ${monedaBanco==='USD'?'$':'C$'} ${convertido.toLocaleString('es-NI',{minimumFractionDigits:2})}`;
    }
  } else {
    elNombre.textContent = bancoNombre;
  }
  document.getElementById(`np-${tipo}-banco-elegido-wrap`).style.display = 'flex';
}

function cancelarSeleccionBancoDelivery(tipo) {
  _bancoElegido[tipo] = null; _montoBancoConvertido[tipo] = null;
  document.getElementById(`np-${tipo}-metodo`).value = '';
  document.getElementById(`np-${tipo}-banco-elegir-wrap`).style.display = 'none';
  document.getElementById(`np-${tipo}-banco-elegido-wrap`).style.display = 'none';
}

async function saldoActualBancoDelivery(bancoId) {
  const { data: movs } = await sb.from('movimientos_financieros')
    .select('tipo_flujo, monto, monto_moneda_banco').eq('auth_user_id', STATE.userId).eq('banco_id', bancoId).eq('estado', 'completado');
  const { data: banco } = await sb.from('bancos').select('saldo_inicial, moneda').eq('id', bancoId).single();
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (banco?.moneda||'NIO') !== monedaBase;
  const montoDe = (m) => esOtraMoneda ? Number(m.monto_moneda_banco ?? m.monto) : Number(m.monto);
  const suma = (movs||[]).reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? montoDe(m) : -montoDe(m)), 0);
  return Number(banco?.saldo_inicial||0) + suma;
}

async function cargarPerfilesInternos() {
  try {
    const { data } = await sb.from('perfiles_acceso').select('id,nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.perfiles = data || [];
    const sel = document.getElementById('ar-perfil-interno');
    if (sel) sel.innerHTML = STATE.perfiles.length
      ? STATE.perfiles.map(p => `<option value="${p.id}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('')
      : '<option value="">No tienes perfiles/empleados creados todavía</option>';
  } catch (e) { STATE.perfiles = []; }
}

async function cargarVentasParaVincular() {
  try {
    const { data } = await sb.from('ventas').select('id, numero_venta, cliente_nombre, total')
      .eq('auth_user_id', STATE.userId).eq('estado', 'completada')
      .order('created_at', { ascending: false }).limit(40);
    STATE.ventasDisponibles = data || [];
    const sel = document.getElementById('np-venta');
    if (sel) {
      sel.innerHTML = '<option value="">— Ninguna, es un pedido suelto —</option>' +
        STATE.ventasDisponibles.map(v => `<option value="${v.id}">${esc(v.numero_venta)} — ${esc(v.cliente_nombre||'Consumidor Final')} (${fmt(v.total)})</option>`).join('');
    }
  } catch (e) { STATE.ventasDisponibles = []; }
}

async function cargarPedidos() {
  const cont = document.getElementById('lista-pedidos');
  if (cont) cont.innerHTML = 'Cargando…';
  try {
    const { data, error } = await sb.from('delivery_pedidos').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    if (error) throw error;
    STATE.pedidos = data || [];
    renderKPIs();
    renderPedidos();
  } catch (e) {
    console.error('cargarPedidos:', e);
    if (cont) cont.innerHTML = '<p style="color:var(--danger);font-size:13px">No se pudieron cargar los pedidos.</p>';
  }
}

function renderKPIs() {
  const hoy = todayLocalISO();
  const contar = (estado) => STATE.pedidos.filter(p => p.estado === estado).length;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('kpi-pendiente', contar('pendiente'));
  set('kpi-asignado', contar('asignado'));
  set('kpi-en_camino', contar('en_camino'));
  set('kpi-entregado-hoy', STATE.pedidos.filter(p => p.estado === 'entregado' && (p.fecha_entregado||'').slice(0,10) === hoy).length);
}

const ESTADO_LABEL = { pendiente:'Pendiente', asignado:'Asignado', en_camino:'En camino', entregado:'Entregado', no_entregado:'No entregado', cancelado:'Cancelado', robado_perdido:'Robo/pérdida' };
const ESTADO_COLOR = { pendiente:'#f59e0b', asignado:'var(--accent)', en_camino:'#3b82f6', entregado:'var(--success)', no_entregado:'var(--danger)', cancelado:'var(--text-muted)', robado_perdido:'var(--danger)' };

function filtrarPorEstado(estado) {
  STATE.filtroEstado = estado;
  document.querySelectorAll('.filtro-estado-btn').forEach(b => b.classList.toggle('active', b.dataset.estado === estado));
  renderPedidos();
}

function renderPedidos() {
  const cont = document.getElementById('lista-pedidos');
  if (!cont) return;
  const lista = STATE.filtroEstado ? STATE.pedidos.filter(p => p.estado === STATE.filtroEstado) : STATE.pedidos;

  if (!lista.length) {
    cont.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">
      ${STATE.pedidos.length ? 'No hay pedidos con este filtro.' : 'Todavía no has creado ningún pedido de delivery.'}
    </div>`;
    return;
  }

  cont.innerHTML = lista.map(p => {
    const color = p.estado === 'entregado' && p.tipo_pago === 'parcial' && !p.saldo_pagado ? '#f59e0b' : (ESTADO_COLOR[p.estado] || 'var(--text-muted)');
    const repartidorTexto = p.tipo_repartidor === 'interno'
      ? `🏍️ ${esc(p.repartidor_nombre || 'Repartidor propio')}`
      : p.tipo_repartidor === 'externo'
        ? `🚚 ${esc(p.repartidor_nombre || 'Servicio externo')}`
        : '';
    const faltaSaldo = p.tipo_pago === 'parcial' && !p.saldo_pagado;
    const etiquetaEstado = p.estado === 'entregado' && faltaSaldo ? 'Entregado — falta cobrar saldo' : ESTADO_LABEL[p.estado];
    const puedeReportarRobo = p.estado === 'asignado' || p.estado === 'en_camino';
    return `
    <div class="panel-card" style="margin:0 0 10px;border-left:3px solid ${color}">
      <div class="panel-body" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-weight:700;font-size:13.5px">${esc(p.numero)}</span>
            <span style="font-size:10.5px;font-weight:700;color:${color};background:${color}22;padding:2px 8px;border-radius:20px">${etiquetaEstado}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-secondary)">${esc(p.cliente_nombre || 'Sin nombre')} ${p.cliente_telefono ? '· '+esc(p.cliente_telefono) : ''}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">📍 ${esc(p.direccion)}${p.referencia ? ' — '+esc(p.referencia) : ''}</div>
          ${repartidorTexto ? `<div style="font-size:12px;margin-top:4px">${repartidorTexto}${p.repartidor_telefono ? ' · '+esc(p.repartidor_telefono) : ''}</div>` : ''}
          ${p.tipo_pago === 'parcial' ? `<div style="font-size:12px;margin-top:4px;color:${faltaSaldo?'#f59e0b':'var(--success)'};font-weight:600">💰 Anticipo: ${fmt(p.monto_anticipo)} — ${faltaSaldo ? `Falta: ${fmt(p.saldo_pendiente)}` : 'Saldo ya cobrado'}</div>` : ''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Creado: ${fmtFechaHora(p.fecha_pedido)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${(Number(p.costo_envio)>0 || Number(p.cobro_envio)>0) ? `<div style="font-size:11.5px;color:var(--text-muted)">${Number(p.costo_envio)>0?'Costo: '+fmt(p.costo_envio)+' ':''}${Number(p.cobro_envio)>0?'· Cobro: '+fmt(p.cobro_envio):''}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            ${p.estado === 'pendiente' ? `<button class="btn-secondary btn-sm" onclick="abrirAsignarRepartidor('${p.id}')">Asignar</button>` : ''}
            ${p.estado === 'asignado' ? `<button class="btn-secondary btn-sm" onclick="avanzarEstado('${p.id}','en_camino')">🛵 En camino</button>` : ''}
            ${p.estado === 'en_camino' ? `<button class="btn-primary btn-sm" onclick="avanzarEstado('${p.id}','entregado')">✅ Entregado</button>` : ''}
            ${p.estado === 'entregado' && faltaSaldo ? `<button class="btn-primary btn-sm" style="background:#f59e0b" onclick="abrirConfirmarSaldo('${p.id}')">💰 Confirmar pago del saldo</button>` : ''}
            ${(p.estado === 'en_camino' || p.estado === 'asignado') ? `<button class="btn-ghost btn-sm" onclick="avanzarEstado('${p.id}','no_entregado')">No entregado</button>` : ''}
            ${puedeReportarRobo ? `<button class="btn-ghost btn-sm" style="color:var(--danger)" onclick="abrirReportarRobo('${p.id}')">🚨 Robo/pérdida</button>` : ''}
            ${(p.estado === 'pendiente') ? `<button class="btn-ghost btn-sm" onclick="avanzarEstado('${p.id}','cancelado')">Cancelar</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* =====================================================
   NUEVO PEDIDO
===================================================== */
function abrirNuevoPedido() {
  document.getElementById('np-venta').value = '';
  document.getElementById('np-cliente').value = '';
  document.getElementById('np-telefono').value = '';
  document.getElementById('np-direccion').value = '';
  document.getElementById('np-referencia').value = '';
  document.getElementById('np-costo-envio').value = '0';
  document.getElementById('np-cobro-envio').value = '0';
  document.getElementById('np-observaciones').value = '';
  document.getElementById('np-error').textContent = '';
  _bancoElegido = { costo: null, cobro: null };
  _montoBancoConvertido = { costo: null, cobro: null };
  ['costo','cobro'].forEach(tipo => {
    document.getElementById(`np-${tipo}-metodo-wrap`).style.display = 'none';
    document.getElementById(`np-${tipo}-banco-elegir-wrap`).style.display = 'none';
    document.getElementById(`np-${tipo}-banco-elegido-wrap`).style.display = 'none';
  });

  // Reiniciar también el modo de venta (venta existente / nueva / ninguna)
  STATE.carritoVentaDelivery = [];
  document.getElementById('np-producto-buscar').value = '';
  document.getElementById('np-producto-resultados').innerHTML = '';
  document.getElementById('np-monto-anticipo').value = '';
  _bancoElegidoVenta = null; _montoBancoConvertidoVenta = null;
  document.getElementById('np-venta-banco-elegir-wrap').style.display = 'none';
  document.getElementById('np-venta-banco-elegido-wrap').style.display = 'none';
  cambiarModoVentaPedido('ninguna');
  cambiarTipoPagoVenta('completo');
  if (STATE.metodosPago.length) {
    const opciones = STATE.metodosPago.map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
    document.getElementById('np-venta-metodo').innerHTML = opciones;
  }

  openModal('modal-nuevo-pedido');
}

/* =====================================================
   CREAR VENTA DESDE DELIVERY — carrito propio, pago completo o
   parcial. La venta se crea real en la tabla ventas, con su stock
   descontado, visible en el modulo de Ventas como cualquier otra.
===================================================== */
function cambiarModoVentaPedido(modo) {
  STATE.modoVentaPedido = modo;
  document.querySelectorAll('.modo-venta-btn').forEach(b => b.classList.toggle('active', b.dataset.modo === modo));
  document.getElementById('np-venta-existente-wrap').style.display = modo === 'existente' ? '' : 'none';
  document.getElementById('np-venta-nueva-wrap').style.display = modo === 'nueva' ? '' : 'none';
}

function cambiarTipoPagoVenta(tipo) {
  STATE.tipoPagoVentaPedido = tipo;
  document.querySelectorAll('.tipo-pago-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
  document.getElementById('np-monto-anticipo-wrap').style.display = tipo === 'parcial' ? '' : 'none';
  document.getElementById('np-venta-metodo-label').textContent = tipo === 'parcial' ? 'Método de pago del anticipo' : 'Método de pago';
  actualizarSaldoRestanteTexto();
}

async function cargarProductosCacheDelivery() {
  if (STATE.productosCacheDelivery) return STATE.productosCacheDelivery;
  try {
    const { data } = await sb.from('productos').select('id, nombre, sku, precio, tipo_precio, costo, stock_actual, tipo')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.productosCacheDelivery = data || [];
    await cargarEscalasCacheDelivery();
  } catch (e) { STATE.productosCacheDelivery = []; }
  return STATE.productosCacheDelivery;
}

// Mapa producto_id -> [{id, nombre, precio}] para productos con
// tipo_precio='escala' (ej. precio distinto por mayoreo/cantidad).
// Mismo patrón que ya usa Ventas.
async function cargarEscalasCacheDelivery() {
  try {
    const { data } = await sb.from('precios_escala').select('id, producto_id, nombre, precio, orden')
      .eq('auth_user_id', STATE.userId).order('orden');
    const map = {};
    (data || []).forEach(e => {
      if (!map[e.producto_id]) map[e.producto_id] = [];
      map[e.producto_id].push(e);
    });
    STATE.escalasCacheDelivery = map;
  } catch (e) { STATE.escalasCacheDelivery = {}; }
}

// Búsqueda simple mientras se escribe, igual de espíritu que el
// buscador de Venta Rápida — sin duplicar toda esa lógica aquí.
document.addEventListener('DOMContentLoaded', () => {
  const buscador = document.getElementById('np-producto-buscar');
  if (buscador) buscador.addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    const cont = document.getElementById('np-producto-resultados');
    if (!q) { cont.innerHTML = ''; return; }
    const productos = await cargarProductosCacheDelivery();
    const resultados = productos.filter(p =>
      (p.nombre||'').toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q)
    ).slice(0, 8);
    cont.innerHTML = resultados.map(p => {
      const tieneEscala = p.tipo_precio === 'escala' && (STATE.escalasCacheDelivery[p.id]||[]).length > 0;
      const textoPrecio = tieneEscala ? '📊 Elige un precio' : fmt(p.precio);
      return `
      <div class="metodo-card" style="margin-bottom:4px" onclick="${tieneEscala ? `abrirSelectorEscalaDelivery('${p.id}')` : `agregarProductoCarritoDelivery('${p.id}')`}">
        <span class="mc-icon">${p.tipo==='servicio'?'🔧':'📦'}</span>
        <span class="mc-name">${esc(p.nombre)} — ${textoPrecio}${p.tipo==='producto' ? ` (stock: ${fmtNum(p.stock_actual)})` : ''}</span>
      </div>`;
    }).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
  });
});

// Muestra las opciones de precio (escala) de un producto, reutilizando
// el mismo contenedor de resultados de búsqueda — mismo espíritu que
// el selector de escala que ya usa Ventas/Venta Rápida.
function abrirSelectorEscalaDelivery(productoId) {
  const cont = document.getElementById('np-producto-resultados');
  const escalas = STATE.escalasCacheDelivery[productoId] || [];
  if (!escalas.length) { agregarProductoCarritoDelivery(productoId); return; }
  cont.innerHTML = `
    <p style="font-size:11.5px;color:var(--text-muted);margin:4px 0">Elige el precio para este producto:</p>
    ${escalas.map(e => `
      <div class="metodo-card" style="margin-bottom:4px" onclick="agregarProductoCarritoDelivery('${productoId}','${e.id}','${esc(e.nombre)}',${e.precio})">
        <span class="mc-icon">📊</span>
        <span class="mc-name">${esc(e.nombre)} — ${fmt(e.precio)}</span>
      </div>`).join('')}
    <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('np-producto-resultados').innerHTML=''">Cancelar</button>
  `;
}

async function agregarProductoCarritoDelivery(productoId, escalaId, escalaNombre, precioEscala) {
  const productos = await cargarProductosCacheDelivery();
  const p = productos.find(x => x.id === productoId);
  if (!p) return;
  const precioFinal = precioEscala != null ? Number(precioEscala) : Number(p.precio||0);
  // Un mismo producto con distinta escala se trata como línea aparte
  // en el carrito (mismo espíritu que Ventas: el precio es distinto,
  // no tiene sentido sumarlo a una línea con otro precio).
  const existente = STATE.carritoVentaDelivery.find(i => i.producto_id === productoId && i.escala_id === (escalaId || null));
  if (existente) { existente.cantidad += 1; }
  else {
    STATE.carritoVentaDelivery.push({
      producto_id: p.id, nombre: escalaNombre ? `${p.nombre} (${escalaNombre})` : p.nombre,
      precio: precioFinal, costo: Number(p.costo||0), tipo: p.tipo, cantidad: 1,
      escala_id: escalaId || null, escala_nombre: escalaNombre || null,
    });
  }
  document.getElementById('np-producto-buscar').value = '';
  document.getElementById('np-producto-resultados').innerHTML = '';
  renderCarritoDelivery();
}

function actualizarCantidadCarritoDelivery(idx, valor) {
  const cantidad = parseFloat(valor) || 0;
  if (cantidad <= 0) { STATE.carritoVentaDelivery.splice(idx, 1); }
  else { STATE.carritoVentaDelivery[idx].cantidad = cantidad; }
  renderCarritoDelivery();
}

function quitarDelCarritoDelivery(idx) {
  STATE.carritoVentaDelivery.splice(idx, 1);
  renderCarritoDelivery();
}

function totalCarritoDelivery() {
  return round2(STATE.carritoVentaDelivery.reduce((s, i) => s + i.precio * i.cantidad, 0));
}

function renderCarritoDelivery() {
  const cont = document.getElementById('np-carrito-lista');
  const totalEl = document.getElementById('np-carrito-total');
  if (!STATE.carritoVentaDelivery.length) {
    cont.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Agrega productos con el buscador de arriba.</p>';
    totalEl.textContent = 'Total: —';
    actualizarSaldoRestanteTexto();
    return;
  }
  cont.innerHTML = STATE.carritoVentaDelivery.map((it, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);gap:8px">
      <span style="font-size:12.5px;flex:1">${esc(it.nombre)}</span>
      <input type="number" value="${it.cantidad}" min="0" step="1" style="width:55px;padding:3px 6px;font-size:12px" onchange="actualizarCantidadCarritoDelivery(${idx},this.value)"/>
      <span style="font-size:12.5px;width:80px;text-align:right">${fmt(it.precio * it.cantidad)}</span>
      <button type="button" class="btn-icon" onclick="quitarDelCarritoDelivery(${idx})">✕</button>
    </div>`).join('');
  totalEl.textContent = `Total: ${fmt(totalCarritoDelivery())}`;
  actualizarSaldoRestanteTexto();
}

function actualizarSaldoRestanteTexto() {
  const el = document.getElementById('np-saldo-restante-texto');
  if (!el) return;
  if (STATE.tipoPagoVentaPedido !== 'parcial') { el.textContent = ''; return; }
  const total = totalCarritoDelivery();
  const anticipo = parseFloat(document.getElementById('np-monto-anticipo')?.value) || 0;
  const saldo = round2(total - anticipo);
  el.textContent = total > 0 ? `Total: ${fmt(total)} — Saldo que falta después del anticipo: ${fmt(Math.max(0,saldo))}` : '';
}
document.addEventListener('DOMContentLoaded', () => {
  const inputAnticipo = document.getElementById('np-monto-anticipo');
  if (inputAnticipo) inputAnticipo.addEventListener('input', actualizarSaldoRestanteTexto);
});

async function mostrarSelectorBancoDeliveryVenta(metodoNombre) {
  const metodo = (metodoNombre || '').toLowerCase();
  document.getElementById('np-venta-banco-elegir-wrap').style.display = 'none';
  document.getElementById('np-venta-banco-elegido-wrap').style.display = 'none';
  _bancoElegidoVenta = null; _montoBancoConvertidoVenta = null;
  if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;

  const bancos = await cargarBancosDisponiblesDelivery();
  if (!bancos.length) return;

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  document.getElementById('np-venta-banco-elegir-grid').innerHTML = bancos.map(b => `
    <div class="metodo-card" onclick="elegirBancoDeliveryVenta('${b.id}','${esc(b.nombre)}','${b.moneda||'NIO'}')">
      <span class="mc-icon">🏦</span>
      <span class="mc-name">${esc(b.nombre)}${(b.moneda||'NIO')!==monedaBase ? ` <b style="color:var(--accent)">(${b.moneda})</b>` : ''}</span>
    </div>`).join('');
  document.getElementById('np-venta-banco-elegir-wrap').style.display = '';
}

function elegirBancoDeliveryVenta(bancoId, bancoNombre, monedaBanco) {
  _bancoElegidoVenta = bancoId;
  document.getElementById('np-venta-banco-elegir-wrap').style.display = 'none';

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (monedaBanco||'NIO') !== monedaBase;
  const monto = STATE.tipoPagoVentaPedido === 'parcial' ? (parseFloat(document.getElementById('np-monto-anticipo').value)||0) : totalCarritoDelivery();
  const elNombre = document.getElementById('np-venta-banco-elegido-nombre');

  if (esOtraMoneda) {
    const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) {
      elNombre.innerHTML = `${esc(bancoNombre)} <span style="color:var(--danger)">— falta configurar tu tasa de cambio en Caja › Bancos</span>`;
    } else {
      const convertido = monedaBase === 'NIO' ? round2(monto / tasa) : round2(monto * tasa);
      _montoBancoConvertidoVenta = convertido;
      elNombre.innerHTML = `${esc(bancoNombre)} — ${monedaBanco==='USD'?'$':'C$'} ${convertido.toLocaleString('es-NI',{minimumFractionDigits:2})}`;
    }
  } else {
    elNombre.textContent = bancoNombre;
  }
  document.getElementById('np-venta-banco-elegido-wrap').style.display = 'flex';
}

function cancelarSeleccionBancoDeliveryVenta() {
  _bancoElegidoVenta = null; _montoBancoConvertidoVenta = null;
  document.getElementById('np-venta-metodo').value = '';
  document.getElementById('np-venta-banco-elegir-wrap').style.display = 'none';
  document.getElementById('np-venta-banco-elegido-wrap').style.display = 'none';
}

// Si eligen una venta, se rellena el nombre del cliente solo — el
// usuario puede corregirlo si el destino de entrega es otra persona.
document.addEventListener('DOMContentLoaded', () => {
  const selVenta = document.getElementById('np-venta');
  if (selVenta) selVenta.addEventListener('change', () => {
    const venta = STATE.ventasDisponibles.find(v => v.id === selVenta.value);
    if (venta) document.getElementById('np-cliente').value = venta.cliente_nombre || '';
  });
});

/* Crea la venta real (visible en Ventas, con su stock descontado)
   desde el carrito armado aqui en Delivery. Devuelve los datos que
   guardarNuevoPedido() necesita para completar el pedido. Si algo
   falla a medio camino, se detiene y reporta el error -- nunca deja
   una venta a medias sin que el usuario se entere. */
async function crearVentaDesdeDelivery(numeroPedido) {
  const items = STATE.carritoVentaDelivery;
  const total = totalCarritoDelivery();
  const esParcial = STATE.tipoPagoVentaPedido === 'parcial';
  const metodoSel = document.getElementById('np-venta-metodo');
  const metodoId = metodoSel?.value || null;
  const metodoNombre = metodoSel?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  const montoAnticipo = esParcial ? round2(parseFloat(document.getElementById('np-monto-anticipo').value) || 0) : total;
  const saldoPendiente = esParcial ? round2(total - montoAnticipo) : 0;

  const { data: numeroVenta } = await sb.rpc('generar_numero_venta', { p_user_id: STATE.userId });

  const costoTotal = round2(items.reduce((s,i) => s + i.costo*i.cantidad, 0));

  const { data: venta, error: errVenta } = await sb.from('ventas').insert({
    auth_user_id: STATE.userId, numero_venta: numeroVenta || `V-${Date.now()}`,
    cliente_nombre: document.getElementById('np-cliente').value.trim() || 'Consumidor Final',
    subtotal: total, total, costo_total: costoTotal, fecha: todayLocalISO(),
    metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
    estado: 'completada', estado_pago: esParcial ? 'pendiente' : 'pagado',
    estado_entrega: 'pendiente', observaciones: `Creada desde Delivery ${numeroPedido}`,
    creado_por_nombre: obtenerNombrePerfilActivo(),
  }).select('id').single();
  if (errVenta) throw errVenta;

  const detallesPayload = items.map(i => ({
    auth_user_id: STATE.userId, venta_id: venta.id, producto_id: i.producto_id,
    producto_nombre: i.nombre, tipo_item: i.tipo || 'producto', cantidad: i.cantidad,
    precio: i.precio, costo: i.costo, descuento: 0,
    subtotal: round2(i.precio*i.cantidad), ganancia: round2((i.precio-i.costo)*i.cantidad),
    escala_id: i.escala_id || null, escala_nombre: i.escala_nombre || null,
  }));
  const { error: errDet } = await sb.from('venta_detalles').insert(detallesPayload);
  if (errDet) throw errDet;

  // Descontar stock (solo productos, no servicios) — mismo espiritu
  // que ya usa Ventas/Venta Rapida.
  for (const item of items) {
    if (item.tipo === 'servicio') continue;
    const prod = STATE.productosCacheDelivery.find(p => p.id === item.producto_id);
    if (!prod) continue;
    const nuevoStock = Math.max(0, Number(prod.stock_actual||0) - item.cantidad);
    await sb.from('productos').update({ stock_actual: nuevoStock }).eq('id', item.producto_id).eq('auth_user_id', STATE.userId);
    prod.stock_actual = nuevoStock;
  }

  // Registrar en Caja el anticipo (si es parcial) o el total (si es
  // pago completo) -- nunca los dos juntos, es un solo movimiento.
  const { data: ultMov } = await sb.from('movimientos_financieros')
    .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
    .order('created_at', { ascending:false }).limit(1).maybeSingle();
  const saldoAnterior = ultMov?.saldo_resultante || 0;
  const montoARegistrar = esParcial ? montoAnticipo : total;
  const saldoResultante = saldoAnterior + montoARegistrar;

  const { data: mov, error: errMov } = await sb.from('movimientos_financieros').insert({
    auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'VENTA',
    concepto: esParcial ? `Anticipo venta ${numeroVenta} — Delivery ${numeroPedido}` : `Venta ${numeroVenta} — Delivery ${numeroPedido}`,
    monto: montoARegistrar, saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
    metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
    banco_id: _bancoElegidoVenta || null, monto_moneda_banco: _bancoElegidoVenta ? (_montoBancoConvertidoVenta ?? null) : null,
    referencia_tipo: 'venta', referencia_id: venta.id,
    fecha: todayLocalISO(), estado: 'completado',
  }).select('id').single();
  if (errMov) throw errMov;

  return {
    ventaId: venta.id, tipoPago: esParcial ? 'parcial' : 'completo',
    montoAnticipo: esParcial ? montoAnticipo : total, saldoPendiente,
    movimientoAnticipoId: mov.id,
  };
}

async function guardarNuevoPedido() {
  const errEl = document.getElementById('np-error');
  errEl.textContent = '';

  const ventaId = document.getElementById('np-venta').value || null;
  const cliente = document.getElementById('np-cliente').value.trim();
  const telefono = document.getElementById('np-telefono').value.trim();
  const direccion = document.getElementById('np-direccion').value.trim();
  const referencia = document.getElementById('np-referencia').value.trim();
  const costoEnvio = round2(parseFloat(document.getElementById('np-costo-envio').value) || 0);
  const cobroEnvio = round2(parseFloat(document.getElementById('np-cobro-envio').value) || 0);
  const observaciones = document.getElementById('np-observaciones').value.trim();

  if (!direccion) { errEl.textContent = 'La dirección de entrega es obligatoria.'; return; }

  // Validaciones propias de "crear venta aquí"
  if (STATE.modoVentaPedido === 'nueva') {
    if (!STATE.carritoVentaDelivery.length) { errEl.textContent = 'Agrega al menos un producto a la venta.'; return; }
    if (STATE.tipoPagoVentaPedido === 'parcial') {
      const anticipo = parseFloat(document.getElementById('np-monto-anticipo').value) || 0;
      const total = totalCarritoDelivery();
      if (anticipo <= 0) { errEl.textContent = 'Indica cuánto paga el cliente ahora.'; return; }
      if (anticipo >= total) { errEl.textContent = 'El anticipo no puede ser igual o mayor al total — si paga todo, elige "Pago completo".'; return; }
    }
    if (_bancoElegidoVenta) {
      const bancoInfoVenta = (await cargarBancosDisponiblesDelivery()).find(b => b.id === _bancoElegidoVenta);
      const monedaBaseVenta = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
      if (bancoInfoVenta && (bancoInfoVenta.moneda||'NIO') !== monedaBaseVenta && !STATE.empresaConfig?.tasa_cambio_usd) {
        errEl.textContent = 'Falta configurar tu tasa de cambio en Caja › Bancos antes de continuar.';
        return;
      }
    }
  }

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const bancos = await cargarBancosDisponiblesDelivery();

  // Validar cada transacción (costo y cobro) por separado: si el
  // banco elegido es en otra moneda, hace falta la tasa; si es un
  // egreso (costo), el banco elegido debe tener saldo suficiente.
  for (const tipo of ['costo', 'cobro']) {
    const monto = tipo === 'costo' ? costoEnvio : cobroEnvio;
    if (monto <= 0) continue;
    const bancoId = _bancoElegido[tipo];
    if (!bancoId) continue;
    const bancoInfo = bancos.find(b => b.id === bancoId);
    const esOtraMoneda = bancoInfo && (bancoInfo.moneda||'NIO') !== monedaBase;
    if (esOtraMoneda && !STATE.empresaConfig?.tasa_cambio_usd) {
      errEl.textContent = 'Falta configurar tu tasa de cambio en Caja › Bancos antes de continuar.';
      return;
    }
    if (tipo === 'costo') {
      const montoADescontar = esOtraMoneda ? _montoBancoConvertido.costo : monto;
      const saldoBanco = await saldoActualBancoDelivery(bancoId);
      if (montoADescontar > saldoBanco + 0.01) {
        errEl.textContent = `Saldo insuficiente en ${bancoInfo?.nombre || 'ese banco'} — tiene ${saldoBanco.toLocaleString('es-NI',{minimumFractionDigits:2})} disponible.`;
        return;
      }
    }
  }

  setBtnLoading('btn-guardar-pedido', true);
  try {
    const { data: numero } = await sb.rpc('siguiente_numero_delivery', { p_user_id: STATE.userId });

    // Si se eligió "Crear venta aquí", primero se crea la venta real
    // (con su stock y su Caja) antes de armar el pedido.
    let ventaIdFinal = ventaId;
    let tipoPago = 'completo', montoAnticipo = 0, saldoPendiente = 0, movimientoAnticipoId = null;
    if (STATE.modoVentaPedido === 'nueva') {
      const resultado = await crearVentaDesdeDelivery(numero || `D-${Date.now()}`);
      ventaIdFinal = resultado.ventaId;
      tipoPago = resultado.tipoPago;
      montoAnticipo = resultado.montoAnticipo;
      saldoPendiente = resultado.saldoPendiente;
      movimientoAnticipoId = resultado.movimientoAnticipoId;
    }

    // Registrar en Caja lo que corresponda ANTES de crear el pedido,
    // para poder vincular el pedido a esos movimientos reales.
    let movimientoCostoId = null, movimientoCobroId = null;
    if (costoEnvio > 0) movimientoCostoId = await registrarMovimientoDelivery('costo', costoEnvio, numero);
    if (cobroEnvio > 0) movimientoCobroId = await registrarMovimientoDelivery('cobro', cobroEnvio, numero);

    const { error } = await sb.from('delivery_pedidos').insert({
      auth_user_id: STATE.userId, venta_id: ventaIdFinal, numero: numero || `D-${Date.now()}`,
      cliente_nombre: cliente || null, cliente_telefono: telefono || null,
      direccion, referencia: referencia || null,
      costo_envio: costoEnvio, cobro_envio: cobroEnvio,
      movimiento_costo_id: movimientoCostoId, movimiento_cobro_id: movimientoCobroId,
      tipo_pago: tipoPago, monto_anticipo: montoAnticipo, saldo_pendiente: saldoPendiente,
      movimiento_anticipo_id: movimientoAnticipoId,
      observaciones: observaciones || null, estado: 'pendiente',
    });
    if (error) throw error;
    showToast(STATE.modoVentaPedido === 'nueva' ? 'Venta y pedido de delivery creados' : 'Pedido de delivery creado');
    closeModal('modal-nuevo-pedido');
    await cargarPedidos();
  } catch (e) {
    console.error('guardarNuevoPedido:', e);
    errEl.textContent = 'No se pudo crear el pedido. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-guardar-pedido', false);
  }
}

/* Registra el costo o el cobro del envío como un movimiento REAL de
   Caja — EGRESO para lo que pagas, INGRESO para lo que cobras.
   Respeta banco elegido (con conversión de moneda si aplica) y
   origen de caja (chica/general) si ese día hay Caja Chica abierta. */
async function registrarMovimientoDelivery(tipo, monto, numeroPedido) {
  const metodoSel = document.getElementById(`np-${tipo}-metodo`);
  const metodoId = metodoSel?.value || null;
  const metodoNombre = metodoSel?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  const bancoId = _bancoElegido[tipo] || null;
  const montoBanco = bancoId ? (_montoBancoConvertido[tipo] ?? null) : null;
  const origenSel = document.getElementById(`np-${tipo}-origen-caja`);
  const origenCaja = (STATE.cajaChicaAbiertaHoy && origenSel) ? origenSel.value : null;

  const { data: ultMov } = await sb.from('movimientos_financieros')
    .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
    .order('created_at', { ascending:false }).limit(1).maybeSingle();
  const saldoAnterior = ultMov?.saldo_resultante || 0;
  const tipoFlujo = tipo === 'costo' ? 'EGRESO' : 'INGRESO';
  const saldoResultante = tipoFlujo === 'INGRESO' ? saldoAnterior + monto : saldoAnterior - monto;

  const { data, error } = await sb.from('movimientos_financieros').insert({
    auth_user_id: STATE.userId, tipo_flujo: tipoFlujo,
    tipo_movimiento: tipo === 'costo' ? 'OTRO_EGRESO' : 'OTRO_INGRESO',
    concepto: tipo === 'costo' ? `Costo de envío — Delivery ${numeroPedido}` : `Cobro de envío — Delivery ${numeroPedido}`,
    monto, saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
    metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
    banco_id: bancoId, monto_moneda_banco: montoBanco,
    origen_caja: origenCaja, fecha: todayLocalISO(), estado: 'completado',
  }).select('id').single();
  if (error) { console.warn('registrarMovimientoDelivery:', error); return null; }
  return data?.id || null;
}

/* =====================================================
   ASIGNAR REPARTIDOR — propio o servicio externo
===================================================== */
function abrirAsignarRepartidor(pedidoId) {
  document.getElementById('ar-pedido-id').value = pedidoId;
  document.getElementById('ar-perfil-interno').value = '';
  document.getElementById('ar-nombre-externo').value = '';
  document.getElementById('ar-telefono-externo').value = '';
  document.getElementById('ar-error').textContent = '';
  cambiarTipoRepartidor('interno');
  openModal('modal-asignar-repartidor');
}

function cambiarTipoRepartidor(tipo) {
  document.querySelectorAll('.tipo-repartidor-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
  document.getElementById('ar-interno-wrap').style.display = tipo === 'interno' ? '' : 'none';
  document.getElementById('ar-externo-wrap').style.display = tipo === 'externo' ? '' : 'none';
}

async function guardarAsignacion() {
  const errEl = document.getElementById('ar-error');
  errEl.textContent = '';
  const pedidoId = document.getElementById('ar-pedido-id').value;
  const tipo = document.querySelector('.tipo-repartidor-btn.active')?.dataset.tipo || 'interno';

  let payload = { estado: 'asignado', tipo_repartidor: tipo, fecha_asignado: new Date().toISOString(), updated_at: new Date().toISOString() };

  if (tipo === 'interno') {
    const sel = document.getElementById('ar-perfil-interno');
    if (!sel.value) { errEl.textContent = 'Elige a cuál de tus empleados asignarle este pedido.'; return; }
    payload.repartidor_perfil_id = sel.value;
    payload.repartidor_nombre = sel.selectedOptions[0]?.dataset.nombre || '';
    payload.repartidor_telefono = null;
  } else {
    const nombre = document.getElementById('ar-nombre-externo').value.trim();
    if (!nombre) { errEl.textContent = 'Escribe el nombre del repartidor o servicio externo.'; return; }
    payload.repartidor_perfil_id = null;
    payload.repartidor_nombre = nombre;
    payload.repartidor_telefono = document.getElementById('ar-telefono-externo').value.trim() || null;
  }

  try {
    const { error } = await sb.from('delivery_pedidos').update(payload).eq('id', pedidoId).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Repartidor asignado');
    closeModal('modal-asignar-repartidor');
    await cargarPedidos();
  } catch (e) {
    console.error('guardarAsignacion:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  }
}

/* =====================================================
   AVANZAR ESTADO — en_camino, entregado, no_entregado, cancelado
===================================================== */
async function avanzarEstado(pedidoId, nuevoEstado) {
  const campoFecha = { en_camino: 'fecha_en_camino', entregado: 'fecha_entregado' }[nuevoEstado];
  const payload = { estado: nuevoEstado, updated_at: new Date().toISOString() };
  if (campoFecha) payload[campoFecha] = new Date().toISOString();

  try {
    const { error } = await sb.from('delivery_pedidos').update(payload).eq('id', pedidoId).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast(`Pedido marcado como "${ESTADO_LABEL[nuevoEstado]}"`);
    await cargarPedidos();
  } catch (e) {
    console.error('avanzarEstado:', e);
    showToast('No se pudo actualizar el pedido', 'error');
  }
}

function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }

/* =====================================================
   CONFIRMAR PAGO DEL SALDO — para pedidos con pago parcial, ya
   entregados, donde falta cobrar el resto.
===================================================== */
let _bancoElegidoSaldo = null;
let _montoBancoConvertidoSaldo = null;

function abrirConfirmarSaldo(pedidoId) {
  const p = STATE.pedidos.find(x => x.id === pedidoId);
  if (!p) return;
  document.getElementById('cs-pedido-id').value = pedidoId;
  document.getElementById('cs-resumen').textContent = `Pedido ${p.numero} — saldo pendiente: ${fmt(p.saldo_pendiente)}`;
  document.getElementById('cs-error').textContent = '';
  _bancoElegidoSaldo = null; _montoBancoConvertidoSaldo = null;
  document.getElementById('cs-banco-elegir-wrap').style.display = 'none';
  document.getElementById('cs-banco-elegido-wrap').style.display = 'none';

  const opciones = STATE.metodosPago.length
    ? STATE.metodosPago.map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('')
    : '<option value="" data-nombre="Efectivo">Efectivo</option>';
  document.getElementById('cs-metodo').innerHTML = opciones;

  openModal('modal-confirmar-saldo');
}

async function mostrarSelectorBancoConfirmarSaldo(metodoNombre) {
  const metodo = (metodoNombre || '').toLowerCase();
  document.getElementById('cs-banco-elegir-wrap').style.display = 'none';
  document.getElementById('cs-banco-elegido-wrap').style.display = 'none';
  _bancoElegidoSaldo = null; _montoBancoConvertidoSaldo = null;
  if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;

  const bancos = await cargarBancosDisponiblesDelivery();
  if (!bancos.length) return;

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  document.getElementById('cs-banco-elegir-grid').innerHTML = bancos.map(b => `
    <div class="metodo-card" onclick="elegirBancoConfirmarSaldo('${b.id}','${esc(b.nombre)}','${b.moneda||'NIO'}')">
      <span class="mc-icon">🏦</span>
      <span class="mc-name">${esc(b.nombre)}${(b.moneda||'NIO')!==monedaBase ? ` <b style="color:var(--accent)">(${b.moneda})</b>` : ''}</span>
    </div>`).join('');
  document.getElementById('cs-banco-elegir-wrap').style.display = '';
}

function elegirBancoConfirmarSaldo(bancoId, bancoNombre, monedaBanco) {
  _bancoElegidoSaldo = bancoId;
  document.getElementById('cs-banco-elegir-wrap').style.display = 'none';
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (monedaBanco||'NIO') !== monedaBase;
  const p = STATE.pedidos.find(x => x.id === document.getElementById('cs-pedido-id').value);
  const monto = p ? Number(p.saldo_pendiente) : 0;
  const elNombre = document.getElementById('cs-banco-elegido-nombre');

  if (esOtraMoneda) {
    const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) {
      elNombre.innerHTML = `${esc(bancoNombre)} <span style="color:var(--danger)">— falta configurar tu tasa de cambio en Caja › Bancos</span>`;
    } else {
      const convertido = monedaBase === 'NIO' ? round2(monto / tasa) : round2(monto * tasa);
      _montoBancoConvertidoSaldo = convertido;
      elNombre.innerHTML = `${esc(bancoNombre)} — ${monedaBanco==='USD'?'$':'C$'} ${convertido.toLocaleString('es-NI',{minimumFractionDigits:2})}`;
    }
  } else {
    elNombre.textContent = bancoNombre;
  }
  document.getElementById('cs-banco-elegido-wrap').style.display = 'flex';
}

function cancelarSeleccionBancoConfirmarSaldo() {
  _bancoElegidoSaldo = null; _montoBancoConvertidoSaldo = null;
  document.getElementById('cs-metodo').value = '';
  document.getElementById('cs-banco-elegir-wrap').style.display = 'none';
  document.getElementById('cs-banco-elegido-wrap').style.display = 'none';
}

async function confirmarSaldo() {
  const errEl = document.getElementById('cs-error');
  errEl.textContent = '';
  const pedidoId = document.getElementById('cs-pedido-id').value;
  const p = STATE.pedidos.find(x => x.id === pedidoId);
  if (!p) return;

  const metodoSel = document.getElementById('cs-metodo');
  const metodoId = metodoSel.value || null;
  const metodoNombre = metodoSel.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  const monto = Number(p.saldo_pendiente);

  if (_bancoElegidoSaldo) {
    const bancoInfo = (await cargarBancosDisponiblesDelivery()).find(b => b.id === _bancoElegidoSaldo);
    const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    if (bancoInfo && (bancoInfo.moneda||'NIO') !== monedaBase && !STATE.empresaConfig?.tasa_cambio_usd) {
      errEl.textContent = 'Falta configurar tu tasa de cambio en Caja › Bancos antes de continuar.';
      return;
    }
  }

  try {
    const { data: ultMov } = await sb.from('movimientos_financieros')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
      .order('created_at', { ascending:false }).limit(1).maybeSingle();
    const saldoAnterior = ultMov?.saldo_resultante || 0;
    const saldoResultante = saldoAnterior + monto;

    const { data: mov, error: errMov } = await sb.from('movimientos_financieros').insert({
      auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'VENTA',
      concepto: `Saldo final venta — Delivery ${p.numero}`,
      monto, saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
      metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
      banco_id: _bancoElegidoSaldo || null, monto_moneda_banco: _bancoElegidoSaldo ? (_montoBancoConvertidoSaldo ?? null) : null,
      referencia_tipo: 'venta', referencia_id: p.venta_id,
      fecha: todayLocalISO(), estado: 'completado',
    }).select('id').single();
    if (errMov) throw errMov;

    const { error: errPedido } = await sb.from('delivery_pedidos').update({
      saldo_pagado: true, saldo_pagado_en: new Date().toISOString(), movimiento_saldo_id: mov.id,
    }).eq('id', pedidoId).eq('auth_user_id', STATE.userId);
    if (errPedido) throw errPedido;

    // La venta ya quedó totalmente pagada — se actualiza su estado_pago
    // para que tambien desaparezca de la alerta de "facturas pendientes"
    // del Dashboard.
    if (p.venta_id) {
      await sb.from('ventas').update({ estado_pago: 'pagado' }).eq('id', p.venta_id).eq('auth_user_id', STATE.userId);
    }

    showToast('Saldo confirmado — venta completamente pagada');
    closeModal('modal-confirmar-saldo');
    await cargarPedidos();
  } catch (e) {
    console.error('confirmarSaldo:', e);
    errEl.textContent = 'No se pudo confirmar el saldo. Intenta de nuevo.';
  }
}

/* =====================================================
   REPORTAR ROBO/PÉRDIDA — el stock NO se devuelve (la mercancía se
   perdió de verdad), y si ya había un anticipo cobrado, la venta se
   anula por completo (como si nunca hubiera pasado).
===================================================== */
function abrirReportarRobo(pedidoId) {
  document.getElementById('rr-pedido-id').value = pedidoId;
  document.getElementById('rr-observaciones').value = '';
  document.getElementById('rr-error').textContent = '';
  openModal('modal-reportar-robo');
}

async function reportarRobo() {
  const errEl = document.getElementById('rr-error');
  errEl.textContent = '';
  const pedidoId = document.getElementById('rr-pedido-id').value;
  const p = STATE.pedidos.find(x => x.id === pedidoId);
  if (!p) return;
  const obs = document.getElementById('rr-observaciones').value.trim();

  try {
    // Si había una venta con anticipo ya cobrado, se anula por
    // completo: la venta y el movimiento de Caja del anticipo. El
    // stock NUNCA se devuelve aquí -- es la unica diferencia real
    // frente a una anulación normal.
    if (p.venta_id) {
      await sb.from('ventas').update({
        estado: 'anulada', observaciones: `Anulada por robo/pérdida en Delivery ${p.numero}. ${obs}`,
      }).eq('id', p.venta_id).eq('auth_user_id', STATE.userId);

      if (p.movimiento_anticipo_id) {
        await sb.from('movimientos_financieros').update({
          estado: 'anulado', anulado_en: new Date().toISOString(),
          anulado_motivo: `Venta anulada por robo/pérdida — Delivery ${p.numero}`,
        }).eq('id', p.movimiento_anticipo_id).eq('auth_user_id', STATE.userId);
      }
    }

    const { error } = await sb.from('delivery_pedidos').update({
      estado: 'robado_perdido', observaciones: obs || p.observaciones, updated_at: new Date().toISOString(),
    }).eq('id', pedidoId).eq('auth_user_id', STATE.userId);
    if (error) throw error;

    showToast('Pedido marcado como robo/pérdida');
    closeModal('modal-reportar-robo');
    await cargarPedidos();
  } catch (e) {
    console.error('reportarRobo:', e);
    errEl.textContent = 'No se pudo reportar. Intenta de nuevo.';
  }
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.all([cargarPerfilesInternos(), cargarVentasParaVincular(), loadMetodosPago()]);
    STATE.cajaChicaAbiertaHoy = await hayCajaChicaAbiertaHoy();
    await cargarPedidos();
  } catch (e) {
    console.error('init delivery:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
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
