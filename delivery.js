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
};

// Estado de banco elegido, por separado para costo y cobro (pueden
// ser bancos distintos, o uno de los dos ni siquiera usar banco).
let _bancosCacheDelivery = null;
let _bancoElegido = { costo: null, cobro: null };
let _montoBancoConvertido = { costo: null, cobro: null };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$';
  return `${sym} ${Number(amount||0).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

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
    const hoy = new Date().toISOString().slice(0,10);
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
  const hoy = new Date().toISOString().slice(0,10);
  const contar = (estado) => STATE.pedidos.filter(p => p.estado === estado).length;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('kpi-pendiente', contar('pendiente'));
  set('kpi-asignado', contar('asignado'));
  set('kpi-en_camino', contar('en_camino'));
  set('kpi-entregado-hoy', STATE.pedidos.filter(p => p.estado === 'entregado' && (p.fecha_entregado||'').slice(0,10) === hoy).length);
}

const ESTADO_LABEL = { pendiente:'Pendiente', asignado:'Asignado', en_camino:'En camino', entregado:'Entregado', no_entregado:'No entregado', cancelado:'Cancelado' };
const ESTADO_COLOR = { pendiente:'#f59e0b', asignado:'var(--accent)', en_camino:'#3b82f6', entregado:'var(--success)', no_entregado:'var(--danger)', cancelado:'var(--text-muted)' };

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
    const color = ESTADO_COLOR[p.estado] || 'var(--text-muted)';
    const repartidorTexto = p.tipo_repartidor === 'interno'
      ? `🏍️ ${esc(p.repartidor_nombre || 'Repartidor propio')}`
      : p.tipo_repartidor === 'externo'
        ? `🚚 ${esc(p.repartidor_nombre || 'Servicio externo')}`
        : '';
    return `
    <div class="panel-card" style="margin:0 0 10px;border-left:3px solid ${color}">
      <div class="panel-body" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-weight:700;font-size:13.5px">${esc(p.numero)}</span>
            <span style="font-size:10.5px;font-weight:700;color:${color};background:${color}22;padding:2px 8px;border-radius:20px">${ESTADO_LABEL[p.estado]}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-secondary)">${esc(p.cliente_nombre || 'Sin nombre')} ${p.cliente_telefono ? '· '+esc(p.cliente_telefono) : ''}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">📍 ${esc(p.direccion)}${p.referencia ? ' — '+esc(p.referencia) : ''}</div>
          ${repartidorTexto ? `<div style="font-size:12px;margin-top:4px">${repartidorTexto}${p.repartidor_telefono ? ' · '+esc(p.repartidor_telefono) : ''}</div>` : ''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Creado: ${fmtFechaHora(p.fecha_pedido)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${(Number(p.costo_envio)>0 || Number(p.cobro_envio)>0) ? `<div style="font-size:11.5px;color:var(--text-muted)">${Number(p.costo_envio)>0?'Costo: '+fmt(p.costo_envio)+' ':''}${Number(p.cobro_envio)>0?'· Cobro: '+fmt(p.cobro_envio):''}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            ${p.estado === 'pendiente' ? `<button class="btn-secondary btn-sm" onclick="abrirAsignarRepartidor('${p.id}')">Asignar</button>` : ''}
            ${p.estado === 'asignado' ? `<button class="btn-secondary btn-sm" onclick="avanzarEstado('${p.id}','en_camino')">🛵 En camino</button>` : ''}
            ${p.estado === 'en_camino' ? `<button class="btn-primary btn-sm" onclick="avanzarEstado('${p.id}','entregado')">✅ Entregado</button>` : ''}
            ${(p.estado === 'en_camino' || p.estado === 'asignado') ? `<button class="btn-ghost btn-sm" onclick="avanzarEstado('${p.id}','no_entregado')">No entregado</button>` : ''}
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
  openModal('modal-nuevo-pedido');
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

    // Registrar en Caja lo que corresponda ANTES de crear el pedido,
    // para poder vincular el pedido a esos movimientos reales.
    let movimientoCostoId = null, movimientoCobroId = null;
    if (costoEnvio > 0) movimientoCostoId = await registrarMovimientoDelivery('costo', costoEnvio, numero);
    if (cobroEnvio > 0) movimientoCobroId = await registrarMovimientoDelivery('cobro', cobroEnvio, numero);

    const { error } = await sb.from('delivery_pedidos').insert({
      auth_user_id: STATE.userId, venta_id: ventaId, numero: numero || `D-${Date.now()}`,
      cliente_nombre: cliente || null, cliente_telefono: telefono || null,
      direccion, referencia: referencia || null,
      costo_envio: costoEnvio, cobro_envio: cobroEnvio,
      movimiento_costo_id: movimientoCostoId, movimiento_cobro_id: movimientoCobroId,
      observaciones: observaciones || null, estado: 'pendiente',
    });
    if (error) throw error;
    showToast('Pedido de delivery creado');
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
    origen_caja: origenCaja, fecha: new Date().toISOString().slice(0,10), estado: 'completado',
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
