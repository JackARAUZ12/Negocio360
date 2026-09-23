/* =====================================================
   RESTAURANTE-COMANDAS.JS — NEGOCIO360
   Segunda pieza del sistema de Restaurante -- toma pedidos por
   mesa y los envia a cocina. Reutiliza productos ya existente
   como el menu (sin duplicar catalogo), y hotel_habitaciones ->
   restaurante_mesas para saber que mesa esta libre.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  mesas: [], comandas: [], itemsComandaActual: [], metodosPago: [], bancosCache: null,
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = (typeof monedaParaMostrar === 'function') ? monedaParaMostrar(STATE.empresaConfig?.moneda) : (STATE.empresaConfig?.moneda || 'C$');
  const n = (typeof convertirParaMostrar === 'function') ? convertirParaMostrar(amount, STATE.empresaConfig?.moneda) : Number(amount || 0);
  return `${sym} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

/* =====================================================
   MÉTODOS DE PAGO / BANCOS -- el selector de cobro usaba opciones
   de TEXTO fijo (Efectivo/Tarjeta/Transferencia), sin conectar con
   la tabla real metodos_pago ni con ningun banco especifico.
===================================================== */
async function loadMetodosPagoComanda() {
  try {
    const { data } = await sb.from('metodos_pago').select('id, nombre, es_default')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('orden');
    STATE.metodosPago = data && data.length ? data : [{ id: null, nombre: 'Efectivo', es_default: true }];
  } catch (e) {
    console.warn('loadMetodosPagoComanda:', e);
    STATE.metodosPago = [{ id: null, nombre: 'Efectivo', es_default: true }];
  }
}

function poblarSelectMetodoPagoComanda() {
  const sel = document.getElementById('cb-metodo-pago');
  if (!sel) return;
  sel.innerHTML = STATE.metodosPago.map(m =>
    `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  const def = STATE.metodosPago.find(m => m.es_default);
  if (def) sel.value = def.id || '';
}

async function cargarBancosDisponiblesComanda() {
  if (STATE.bancosCache) return STATE.bancosCache;
  try {
    const { data } = await sb.from('bancos').select('id, nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.bancosCache = data || [];
  } catch (e) { STATE.bancosCache = []; }
  return STATE.bancosCache;
}

// Mismo mecanismo ya probado en el resto del sistema: si el metodo
// elegido es Tarjeta o Transferencia y ya hay bancos creados, se
// pide elegir de cual banco entra el cobro de la mesa.
async function onCambiarMetodoPagoComanda() {
  const sel = document.getElementById('cb-metodo-pago');
  const nombreMetodo = (sel?.selectedOptions[0]?.dataset.nombre || '').toLowerCase();
  const wrap = document.getElementById('cb-wrap-banco');
  const bancoSel = document.getElementById('cb-banco');
  if (!wrap || !bancoSel) return;
  const necesitaBanco = nombreMetodo.includes('tarjeta') || nombreMetodo.includes('transferencia');

  if (!necesitaBanco) { wrap.style.display = 'none'; bancoSel.value = ''; return; }

  const bancos = await cargarBancosDisponiblesComanda();
  if (!bancos.length) { wrap.style.display = 'none'; bancoSel.value = ''; return; }

  bancoSel.innerHTML = '<option value="">Selecciona un banco…</option>' +
    bancos.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('');
  wrap.style.display = '';
}

// Desglosa un monto YA cobrado (IVA incluido) en su parte neta y su
// IVA, y registra el IVA en Impuestos -- mismo patron real ya
// probado en Hotel (registrarIvaHotel): a Caja entra el neto, porque
// el IVA no es ingreso del negocio, es dinero recaudado para el
// fisco. Devuelve el monto neto, que es lo que se debe registrar en
// Caja en vez del monto completo.
async function registrarIvaRestaurante(montoConIva, concepto, referenciaId) {
  const ivaPct = STATE.empresaConfig?.iva_porcentaje_default ? Number(STATE.empresaConfig.iva_porcentaje_default) : 15;
  if (STATE.empresaConfig?.iva_activo === false || ivaPct <= 0) return montoConIva;
  const neto = round2(montoConIva / (1 + ivaPct/100));
  const iva = round2(montoConIva - neto);
  if (iva <= 0) return montoConIva;
  try {
    const { data: ultMov } = await sb.from('movimientos_impuestos')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId)
      .order('created_at', { ascending:false }).limit(1).maybeSingle();
    const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
    await sb.from('movimientos_impuestos').insert({
      auth_user_id: STATE.userId, tipo_movimiento: 'IVA_VENTA', concepto,
      monto: iva, saldo_anterior: saldoAnt, saldo_resultante: saldoAnt + iva,
      referencia_venta_id: referenciaId, fecha: todayISO(),
    });
  } catch (e) {
    console.warn('registrarIvaRestaurante:', e);
  }
  return neto;
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

async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
    return data;
  } catch (e) { return null; }
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

const ITEM_ESTADO_LABEL = { pendiente:'Pendiente', en_preparacion:'En preparación', listo:'Listo', entregado:'Entregado', cancelado:'Cancelado' };

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    if (STATE.empresaConfig?.usa_modulo_restaurante !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.all([cargarComandas(), loadMetodosPagoComanda()]);
  } catch (e) {
    console.error('init restaurante-comandas:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   CARGAR Y RENDERIZAR
===================================================== */
async function cargarComandas() {
  try {
    const { data, error } = await sb.from('restaurante_comandas')
      .select('*, restaurante_mesas(numero), restaurante_comanda_items(id, cantidad, precio_unitario, estado)')
      .eq('auth_user_id', STATE.userId).in('estado', ['abierta','enviada','lista'])
      .order('created_at', { ascending: true });
    if (error) throw error;
    STATE.comandas = data || [];
    actualizarKpisComandas();
    renderComandas();
  } catch (e) {
    console.error('cargarComandas:', e);
    showToast('No se pudieron cargar las comandas', 'error');
  }
}

function totalComanda(c) {
  return round2((c.restaurante_comanda_items || [])
    .filter(i => i.estado !== 'cancelado')
    .reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0));
}

function actualizarKpisComandas() {
  const lista = STATE.comandas;
  document.getElementById('kpi-com-abiertas').textContent = lista.length;
  document.getElementById('kpi-com-cocina').textContent = lista.filter(c => c.estado === 'enviada').length;
  const total = lista.reduce((s, c) => s + totalComanda(c), 0);
  document.getElementById('kpi-com-total').textContent = fmt(total);
}

function renderComandas() {
  const cont = document.getElementById('com-grid');
  const vacio = document.getElementById('com-vacio');
  if (!STATE.comandas.length) {
    cont.style.display = 'none'; vacio.style.display = '';
    return;
  }
  cont.style.display = ''; vacio.style.display = 'none';

  const ESTADO_BADGE = { abierta:'disponible', enviada:'limpieza', lista:'bloqueada' };
  const ESTADO_TXT = { abierta:'Abierta', enviada:'En cocina', lista:'Lista para servir' };

  cont.innerHTML = STATE.comandas.map(c => {
    const nItems = (c.restaurante_comanda_items || []).filter(i => i.estado !== 'cancelado').length;
    return `
    <div class="hab-card">
      <div class="hab-card-head">
        <div class="hab-card-titulo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/></svg>
          Mesa ${esc(c.restaurante_mesas?.numero || '—')}
        </div>
        <span class="hab-estado-badge hab-estado-${ESTADO_BADGE[c.estado] || 'disponible'}">${ESTADO_TXT[c.estado] || c.estado}</span>
      </div>
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px">🍽️ ${nItems} platillo${nItems===1?'':'s'}</div>
      ${c.mesero_nombre ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">🧑‍🍳 ${esc(c.mesero_nombre)}</div>` : '<div style="margin-bottom:10px"></div>'}
      <div style="font-weight:800;font-size:16px;margin-bottom:10px">${fmt(totalComanda(c))}</div>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary" style="flex:1" onclick="abrirModalComandaDetalle('${c.id}')">Abrir</button>
        <button class="btn-primary" style="flex:1" onclick="abrirModalCobro('${c.id}')">💰 Cobrar</button>
      </div>
    </div>`;
  }).join('');
}

/* =====================================================
   NUEVA COMANDA
===================================================== */
async function abrirModalNuevaComanda() {
  document.getElementById('nc-error').textContent = '';
  document.getElementById('nc-comensales').value = 1;
  document.getElementById('nc-mesero').value = '';

  const { data } = await sb.from('restaurante_mesas').select('id,numero')
    .eq('auth_user_id', STATE.userId).eq('activo', true).eq('estado', 'disponible').order('numero');
  STATE.mesas = data || [];
  const sel = document.getElementById('nc-mesa');
  sel.innerHTML = STATE.mesas.length
    ? STATE.mesas.map(m => `<option value="${m.id}">Mesa ${esc(m.numero)}</option>`).join('')
    : '<option value="">No hay mesas disponibles</option>';

  openModal('modal-nueva-comanda');
}

async function crearComanda() {
  const errEl = document.getElementById('nc-error');
  errEl.textContent = '';

  const mesaId = document.getElementById('nc-mesa').value;
  if (!mesaId) { errEl.textContent = 'No hay una mesa disponible para seleccionar.'; return; }

  const comensales = Math.max(1, parseInt(document.getElementById('nc-comensales').value) || 1);
  const mesero = document.getElementById('nc-mesero').value.trim() || null;

  setBtnLoading('nc-btn-crear', true);
  try {
    const { data: comandaNueva, error: e1 } = await sb.from('restaurante_comandas')
      .insert({ auth_user_id: STATE.userId, mesa_id: mesaId, numero_comensales: comensales, mesero_nombre: mesero })
      .select('id').single();
    if (e1) throw e1;

    // La mesa pasa a "ocupada" automaticamente al abrirle una
    // comanda -- mismo criterio ya usado en Hotel con el check-in.
    const { error: e2 } = await sb.from('restaurante_mesas')
      .update({ estado: 'ocupada', en_este_estado_desde: new Date().toISOString() })
      .eq('id', mesaId).eq('auth_user_id', STATE.userId);
    if (e2) throw e2;

    closeModal('modal-nueva-comanda');
    showToast('Comanda abierta');
    await cargarComandas();
    abrirModalComandaDetalle(comandaNueva.id);
  } catch (e) {
    console.error('crearComanda:', e);
    errEl.textContent = 'No se pudo abrir la comanda. Intenta de nuevo.';
  } finally {
    setBtnLoading('nc-btn-crear', false);
  }
}

/* =====================================================
   DETALLE DE COMANDA -- agregar/quitar platillos
===================================================== */
async function abrirModalComandaDetalle(comandaId) {
  document.getElementById('cd-comanda-id').value = comandaId;
  document.getElementById('cd-buscar-producto').value = '';
  document.getElementById('cd-resultados-producto').style.display = 'none';

  const c = STATE.comandas.find(x => x.id === comandaId);
  document.getElementById('cd-titulo').textContent = `Mesa ${c?.restaurante_mesas?.numero || '—'}`;
  document.getElementById('cd-btn-enviar').style.display = (c && c.estado === 'abierta') ? '' : 'none';

  await cargarItemsComanda(comandaId);
  openModal('modal-comanda');
}

async function cargarItemsComanda(comandaId) {
  const { data } = await sb.from('restaurante_comanda_items').select('*')
    .eq('comanda_id', comandaId).neq('estado', 'cancelado').order('created_at');
  STATE.itemsComandaActual = data || [];
  renderItemsComanda();
}

function renderItemsComanda() {
  const cont = document.getElementById('cd-lista-items');
  if (!STATE.itemsComandaActual.length) {
    cont.innerHTML = `<p style="text-align:center;color:var(--text-muted);font-size:13px;padding:14px 0">Aún no hay platillos agregados.</p>`;
  } else {
    cont.innerHTML = STATE.itemsComandaActual.map(i => `
      <div class="cd-item">
        <div class="cd-item-info">
          <div class="cd-item-nombre">${esc(i.nombre_producto)}</div>
          ${i.modificadores ? `<div class="cd-item-mod">${esc(i.modificadores)}</div>` : ''}
          <span class="cd-item-estado cd-item-estado-${i.estado}">${ITEM_ESTADO_LABEL[i.estado] || i.estado}</span>
        </div>
        <div class="cd-item-cantidad">
          <button onclick="cambiarCantidadItem('${i.id}', -1)">−</button>
          <span>${i.cantidad}</span>
          <button onclick="cambiarCantidadItem('${i.id}', 1)">+</button>
        </div>
        <div class="cd-item-precio">${fmt(i.cantidad * i.precio_unitario)}</div>
        <span class="cd-item-quitar" onclick="quitarItemComanda('${i.id}')">✕</span>
      </div>`).join('');
  }
  const total = round2(STATE.itemsComandaActual.reduce((s,i) => s + i.cantidad*i.precio_unitario, 0));
  document.getElementById('cd-total').textContent = fmt(total);
}

let _timeoutBuscarProducto = null;
function buscarProductoComanda(texto) {
  clearTimeout(_timeoutBuscarProducto);
  const cont = document.getElementById('cd-resultados-producto');
  const q = (texto || '').trim();
  if (q.length < 1) { cont.style.display = 'none'; return; }

  _timeoutBuscarProducto = setTimeout(async () => {
    try {
      const { data } = await sb.from('productos').select('id,nombre,precio')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .ilike('nombre', `%${q}%`).limit(8);
      const resultados = data || [];
      if (!resultados.length) {
        cont.innerHTML = `<div class="res-cliente-opcion" style="color:var(--text-muted)">Sin resultados</div>`;
      } else {
        cont.innerHTML = resultados.map(p => `
          <div class="res-cliente-opcion" onclick='agregarItemComanda(${JSON.stringify(p.id)}, ${JSON.stringify(p.nombre)}, ${Number(p.precio)||0})'>
            <div class="rc-nombre">${esc(p.nombre)}</div>
            <div class="rc-detalle">${fmt(p.precio)}</div>
          </div>`).join('');
      }
      cont.style.display = '';
    } catch (e) {
      console.error('buscarProductoComanda:', e);
    }
  }, 250);
}

document.addEventListener('click', (e) => {
  const cont = document.getElementById('cd-resultados-producto');
  const input = document.getElementById('cd-buscar-producto');
  if (!cont || !input) return;
  if (e.target !== input && !cont.contains(e.target)) cont.style.display = 'none';
});

async function agregarItemComanda(productoId, nombre, precio) {
  const comandaId = document.getElementById('cd-comanda-id').value;
  document.getElementById('cd-buscar-producto').value = '';
  document.getElementById('cd-resultados-producto').style.display = 'none';

  // Si el mismo platillo (sin modificadores) ya esta en la lista,
  // simplemente se le suma 1 en vez de crear una fila duplicada.
  const existente = STATE.itemsComandaActual.find(i => i.producto_id === productoId && !i.modificadores);
  if (existente) { await cambiarCantidadItem(existente.id, 1); return; }

  try {
    const { error } = await sb.from('restaurante_comanda_items').insert({
      auth_user_id: STATE.userId, comanda_id: comandaId, producto_id: productoId,
      nombre_producto: nombre, cantidad: 1, precio_unitario: precio,
    });
    if (error) throw error;
    await cargarItemsComanda(comandaId);
  } catch (e) {
    console.error('agregarItemComanda:', e);
    showToast('No se pudo agregar el platillo', 'error');
  }
}

async function cambiarCantidadItem(itemId, delta) {
  const item = STATE.itemsComandaActual.find(i => i.id === itemId);
  if (!item) return;
  const nuevaCantidad = item.cantidad + delta;
  if (nuevaCantidad <= 0) { await quitarItemComanda(itemId); return; }

  try {
    const { error } = await sb.from('restaurante_comanda_items').update({ cantidad: nuevaCantidad }).eq('id', itemId);
    if (error) throw error;
    item.cantidad = nuevaCantidad;
    renderItemsComanda();
  } catch (e) {
    console.error('cambiarCantidadItem:', e);
    showToast('No se pudo actualizar la cantidad', 'error');
  }
}

async function quitarItemComanda(itemId) {
  try {
    const { error } = await sb.from('restaurante_comanda_items').delete().eq('id', itemId);
    if (error) throw error;
    STATE.itemsComandaActual = STATE.itemsComandaActual.filter(i => i.id !== itemId);
    renderItemsComanda();
  } catch (e) {
    console.error('quitarItemComanda:', e);
    showToast('No se pudo quitar el platillo', 'error');
  }
}

/* =====================================================
   ENVIAR A COCINA / CANCELAR
===================================================== */
async function enviarComandaACocina() {
  const comandaId = document.getElementById('cd-comanda-id').value;
  if (!STATE.itemsComandaActual.length) { showToast('Agrega al menos un platillo antes de enviar', 'error'); return; }

  const btn = document.getElementById('cd-btn-enviar');
  setBtnLoading('cd-btn-enviar', true);
  try {
    const { error: e1 } = await sb.from('restaurante_comandas').update({ estado: 'enviada', updated_at: new Date().toISOString() }).eq('id', comandaId);
    if (e1) throw e1;
    const { error: e2 } = await sb.from('restaurante_comanda_items')
      .update({ estado: 'en_preparacion' }).eq('comanda_id', comandaId).eq('estado', 'pendiente');
    if (e2) throw e2;

    showToast('Comanda enviada a cocina');
    closeModal('modal-comanda');
    await cargarComandas();
  } catch (e) {
    console.error('enviarComandaACocina:', e);
    showToast('No se pudo enviar a cocina', 'error');
  } finally {
    setBtnLoading('cd-btn-enviar', false);
  }
}

async function cancelarComanda() {
  const comandaId = document.getElementById('cd-comanda-id').value;
  const c = STATE.comandas.find(x => x.id === comandaId);
  if (!confirm('¿Cancelar esta comanda? La mesa quedará disponible de nuevo.')) return;

  try {
    const { error: e1 } = await sb.from('restaurante_comandas')
      .update({ estado: 'cancelada', updated_at: new Date().toISOString() }).eq('id', comandaId);
    if (e1) throw e1;
    if (c) {
      const { error: e2 } = await sb.from('restaurante_mesas')
        .update({ estado: 'disponible', en_este_estado_desde: new Date().toISOString() })
        .eq('id', c.mesa_id).eq('auth_user_id', STATE.userId);
      if (e2) throw e2;
    }
    showToast('Comanda cancelada');
    closeModal('modal-comanda');
    await cargarComandas();
  } catch (e) {
    console.error('cancelarComanda:', e);
    showToast('No se pudo cancelar la comanda', 'error');
  }
}

/* =====================================================
   COBRO Y CIERRE DE CUENTA -- equivalente al check-out de Hotel:
   cierra la comanda, cobra el total real (conectado con Caja e
   Impuestos), y la mesa pasa a 'limpieza' -- nunca directo a
   'disponible', misma leccion ya aplicada en Hotel (una mesa
   recien desocupada necesita limpiarse antes de sentar a alguien
   mas ahi).
===================================================== */
STATE.comandaCobroActual = null;

async function abrirModalCobro(comandaId) {
  document.getElementById('cb-error').textContent = '';
  document.getElementById('cb-comanda-id').value = comandaId;
  document.getElementById('cb-propina-pct').value = '15';
  document.getElementById('cb-propina-manual').value = '';
  document.getElementById('cb-dividir-entre').value = 1;
  onCambiarPropinaComanda();
  poblarSelectMetodoPagoComanda();
  document.getElementById('cb-wrap-banco').style.display = 'none';
  document.getElementById('cb-banco').value = '';

  const { data: items } = await sb.from('restaurante_comanda_items').select('*')
    .eq('comanda_id', comandaId).neq('estado', 'cancelado');
  const c = STATE.comandas.find(x => x.id === comandaId);
  STATE.comandaCobroActual = { comandaId, items: items || [], mesaNumero: c?.restaurante_mesas?.numero || '—' };

  document.getElementById('cb-mesa-titulo').textContent = `Mesa ${STATE.comandaCobroActual.mesaNumero}`;
  document.getElementById('cb-lista-items').innerHTML = (items || []).map(i => `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span>${i.cantidad}× ${esc(i.nombre_producto)}</span>
      <span>${fmt(i.cantidad * i.precio_unitario)}</span>
    </div>`).join('');

  renderResumenCobro();
  openModal('modal-cobro');
}

function onCambiarPropinaComanda() {
  const esOtro = document.getElementById('cb-propina-pct').value === 'otro';
  document.getElementById('cb-wrap-propina-manual').style.display = esOtro ? '' : 'none';
  renderResumenCobro();
}

function renderResumenCobro() {
  if (!STATE.comandaCobroActual) return;
  const subtotal = round2(STATE.comandaCobroActual.items.reduce((s,i) => s + i.cantidad*i.precio_unitario, 0));

  const pctSel = document.getElementById('cb-propina-pct').value;
  let propina;
  if (pctSel === 'otro') {
    propina = Math.max(0, parseFloat(document.getElementById('cb-propina-manual').value) || 0);
  } else {
    propina = round2(subtotal * Number(pctSel) / 100);
  }

  const total = round2(subtotal + propina);
  document.getElementById('cb-subtotal').textContent = fmt(subtotal);
  document.getElementById('cb-propina-monto').textContent = fmt(propina);
  document.getElementById('cb-total').textContent = fmt(total);

  const dividirEntre = Math.max(1, parseInt(document.getElementById('cb-dividir-entre').value) || 1);
  document.getElementById('cb-por-persona').textContent = dividirEntre > 1
    ? `${fmt(round2(total / dividirEntre))} por persona (${dividirEntre} personas)`
    : '';
}

async function confirmarCobro() {
  const errEl = document.getElementById('cb-error');
  errEl.textContent = '';

  if (!STATE.comandaCobroActual || !STATE.comandaCobroActual.items.length) {
    errEl.textContent = 'Esta comanda no tiene platillos que cobrar.';
    return;
  }

  const comandaId = STATE.comandaCobroActual.comandaId;
  const subtotal = round2(STATE.comandaCobroActual.items.reduce((s,i) => s + i.cantidad*i.precio_unitario, 0));
  const pctSel = document.getElementById('cb-propina-pct').value;
  const propina = pctSel === 'otro'
    ? Math.max(0, parseFloat(document.getElementById('cb-propina-manual').value) || 0)
    : round2(subtotal * Number(pctSel) / 100);
  const total = round2(subtotal + propina);
  const selMetodo = document.getElementById('cb-metodo-pago');
  const metodoId = selMetodo?.value || null;
  const metodoNombre = selMetodo?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  let bancoId = null;
  if (document.getElementById('cb-wrap-banco').style.display !== 'none') {
    bancoId = document.getElementById('cb-banco').value || null;
    if (!bancoId) { errEl.textContent = 'Indica de qué banco entra el cobro.'; return; }
  }
  const c = STATE.comandas.find(x => x.id === comandaId);

  setBtnLoading('cb-btn-confirmar', true);
  try {
    // La propina no lleva IVA -- solo el consumo (subtotal) se
    // desglosa. El total real que entra a Caja es neto-de-consumo +
    // propina completa.
    const conceptoCobro = `Cobro — Mesa ${STATE.comandaCobroActual.mesaNumero}`;
    const subtotalNeto = await registrarIvaRestaurante(subtotal, conceptoCobro, comandaId);
    const montoParaCaja = round2(subtotalNeto + propina);

    if (window.CajaAPI) {
      const cajaRes = await window.CajaAPI.registrarMovimiento({
        auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'VENTA',
        concepto: conceptoCobro, monto: montoParaCaja,
        referencia_tipo: 'restaurante_comanda', referencia_id: comandaId,
        metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre, banco_id: bancoId,
      });
      if (!cajaRes.ok) {
        errEl.textContent = 'No se pudo registrar el cobro en Caja: ' + cajaRes.error;
        setBtnLoading('cb-btn-confirmar', false);
        return;
      }
    }

    const { error: e1 } = await sb.from('restaurante_comandas').update({
      estado: 'cerrada', cerrada_at: new Date().toISOString(),
      propina_monto: propina, metodo_pago: metodoNombre, total_cobrado: total,
      updated_at: new Date().toISOString(),
    }).eq('id', comandaId).eq('auth_user_id', STATE.userId);
    if (e1) throw e1;

    if (c) {
      const { error: e2 } = await sb.from('restaurante_mesas')
        .update({ estado: 'limpieza', en_este_estado_desde: new Date().toISOString() })
        .eq('id', c.mesa_id).eq('auth_user_id', STATE.userId);
      if (e2) throw e2;
    }

    showToast('Cuenta cobrada — la mesa pasó a limpieza');
    closeModal('modal-cobro');
    await cargarComandas();
  } catch (e) {
    console.error('confirmarCobro:', e);
    errEl.textContent = 'No se pudo completar el cobro. Intenta de nuevo.';
  } finally {
    setBtnLoading('cb-btn-confirmar', false);
  }
}
