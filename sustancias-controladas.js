/* =====================================================
   HOTEL-HUESPEDES.JS — NEGOCIO360
   Historial de estadias por cliente -- lee de hotel_reservaciones
   (filtrando las que tienen cliente_id vinculado) y de clientes,
   sin crear ni duplicar ninguna tabla nueva.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  huespedes: [], filtrados: [],
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = (typeof monedaParaMostrar === 'function') ? monedaParaMostrar(STATE.empresaConfig?.moneda) : (STATE.empresaConfig?.moneda || 'C$');
  const n = (typeof convertirParaMostrar === 'function') ? convertirParaMostrar(amount, STATE.empresaConfig?.moneda) : Number(amount || 0);
  return `${sym} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function noches(entrada, salida) {
  return Math.round((new Date(salida) - new Date(entrada)) / 86400000);
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
    if (STATE.empresaConfig?.usa_modulo_farmacia !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarRegistros();
  } catch (e) {
    console.error('init lotes:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});
/* =====================================================
   CONTROL DE SUSTANCIAS -- registro de venta de
   medicamentos controlados: quien compro que, y cuando.
===================================================== */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
// Cantidad de unidades (no dinero) -- para eso ya existe fmt(), la
// funcion real de moneda que trae este mismo shell.
function fmtCantidad(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }

async function cargarRegistros() {
  const tbody = document.getElementById('rsc-tbody');
  try {
    const { data, error } = await sb.from('registro_sustancias_controladas')
      .select('*').eq('auth_user_id', STATE.userId).order('fecha', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    STATE.registros = data || [];
    STATE.filtrados = STATE.registros;
    renderRegistros();
  } catch (e) {
    console.error('cargarRegistros:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudieron cargar los registros.</td></tr>';
  }
}

function filtrarRegistros() {
  const q = (document.getElementById('rsc-buscar')?.value || '').trim().toLowerCase();
  STATE.filtrados = !q ? STATE.registros : STATE.registros.filter(r =>
    (r.producto_nombre || '').toLowerCase().includes(q) || (r.comprador_nombre || '').toLowerCase().includes(q)
  );
  renderRegistros();
}

function renderRegistros() {
  const tbody = document.getElementById('rsc-tbody');
  const pie = document.getElementById('rsc-pie');
  const lista = STATE.filtrados || [];
  if (pie) pie.textContent = `${lista.length} registro${lista.length === 1 ? '' : 's'}`;
  actualizarKpisRSC();
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Sin registros todavía -- usa "+ Registrar venta" para el primero.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(r => `
    <tr>
      <td>${r.fecha}</td>
      <td>${esc(r.producto_nombre)}</td>
      <td>${fmtCantidad(r.cantidad)}</td>
      <td>${esc(r.comprador_nombre)}</td>
      <td>${r.comprador_documento ? esc(r.comprador_documento) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><button class="btn-accion-tabla btn-ghost" onclick="eliminarRegistroRSC('${r.id}')">🗑️ Eliminar</button></td>
    </tr>`).join('');
}

function actualizarKpisRSC() {
  const lista = STATE.registros || [];
  const hoy = todayISO();
  const inicioMes = hoy.slice(0, 7); // 'YYYY-MM'
  const esteMes = lista.filter(r => (r.fecha || '').startsWith(inicioMes)).length;
  const hoyCount = lista.filter(r => r.fecha === hoy).length;
  const compradores = new Set(lista.map(r => (r.comprador_nombre || '').trim().toLowerCase()).filter(Boolean));
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('rsc-kpi-total', lista.length);
  set('rsc-kpi-mes', esteMes);
  set('rsc-kpi-hoy', hoyCount);
  set('rsc-kpi-compradores', compradores.size);
}

async function eliminarRegistroRSC(id) {
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
  try {
    const { error } = await sb.from('registro_sustancias_controladas').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Registro eliminado.', 'success');
    await cargarRegistros();
  } catch (e) {
    console.error('eliminarRegistroRSC:', e);
    showToast('No se pudo eliminar el registro.', 'error');
  }
}

/* ---- Modal Nuevo Registro ---- */
function abrirModalNuevoRegistro() {
  document.getElementById('rsc-error').textContent = '';
  document.getElementById('rsc-buscar-producto').value = '';
  document.getElementById('rsc-producto-id').value = '';
  document.getElementById('rsc-producto-nombre').value = '';
  document.getElementById('rsc-resultados-producto').style.display = 'none';
  document.getElementById('rsc-cantidad').value = '';
  document.getElementById('rsc-precio-unitario').value = '';
  document.getElementById('rsc-wrap-precio-escala').style.display = 'none';
  document.getElementById('rsc-precio-unitario').style.display = 'block';
  document.getElementById('rsc-fecha').value = todayISO();
  document.getElementById('rsc-comprador-nombre').value = '';
  document.getElementById('rsc-comprador-documento').value = '';
  document.getElementById('rsc-receta-numero').value = '';
  document.getElementById('rsc-resumen-cobro').style.display = 'none';
  cargarMetodosPagoRSC();
  cargarRecetasPendientesParaVincularRSC();
  document.getElementById('modal-nuevo-registro').style.display = 'flex';
}

function cerrarModalNuevoRegistro() {
  document.getElementById('modal-nuevo-registro').style.display = 'none';
}

// Vincular receta (Farmacia fase 2) -- mismo patron ya usado en
// Ventas, necesario para que una receta con SOLO sustancias
// controladas pueda marcarse como vendida (en Ventas nunca entran).
async function cargarRecetasPendientesParaVincularRSC() {
  const wrap = document.getElementById('rsc-wrap-vincular-receta');
  if (!wrap) return;
  try {
    const { data } = await sb.from('farmacia_recetas')
      .select('id, paciente_nombre, numero_receta, fecha').eq('auth_user_id', STATE.userId).is('venta_id', null)
      .order('fecha', { ascending: false }).limit(30);
    const sel = document.getElementById('rsc-sel-receta-vincular');
    const opciones = (data || []).map(r => `<option value="${r.id}">${esc(r.paciente_nombre)}${r.numero_receta ? ' — #' + esc(r.numero_receta) : ''} (${r.fecha})</option>`).join('');
    sel.innerHTML = '<option value="">Ninguna</option>' + opciones;
    wrap.style.display = (data && data.length) ? '' : 'none';
  } catch (e) { console.warn('cargarRecetasPendientesParaVincularRSC:', e); }
}

let _timeoutBuscarRSC = null;
function buscarProductoControlado(q) {
  clearTimeout(_timeoutBuscarRSC);
  const cont = document.getElementById('rsc-resultados-producto');
  document.getElementById('rsc-producto-id').value = '';
  if (q.trim().length < 1) { cont.style.display = 'none'; return; }
  _timeoutBuscarRSC = setTimeout(async () => {
    try {
      const { data } = await sb.from('productos').select('id,nombre,precio,costo,stock_actual,tipo_precio')
        .eq('auth_user_id', STATE.userId).eq('activo', true).eq('es_sustancia_controlada', true)
        .ilike('nombre', `%${q}%`).limit(8);
      const lista = data || [];
      STATE._productosControladosCache = STATE._productosControladosCache || {};
      lista.forEach(p => { STATE._productosControladosCache[p.id] = p; });
      cont.innerHTML = lista.length
        ? lista.map(p => `<div class="search-result-item" style="padding:8px 10px;cursor:pointer" onclick="seleccionarProductoControlado('${p.id}')">${esc(p.nombre)} — ${p.tipo_precio === 'escala' ? 'escala de precios' : fmt(p.precio)}</div>`).join('')
        : '<div style="padding:8px 10px;color:var(--text-muted);font-size:12.5px">Sin resultados -- solo aparecen productos marcados como sustancia controlada.</div>';
      cont.style.display = 'block';
    } catch (e) { console.error('buscarProductoControlado:', e); }
  }, 250);
}

async function seleccionarProductoControlado(id) {
  const prod = STATE._productosControladosCache?.[id];
  if (!prod) return;
  document.getElementById('rsc-producto-id').value = id;
  document.getElementById('rsc-producto-nombre').value = prod.nombre;
  document.getElementById('rsc-buscar-producto').value = prod.nombre;
  document.getElementById('rsc-resultados-producto').style.display = 'none';

  const inputPrecio = document.getElementById('rsc-precio-unitario');
  const wrapEscala = document.getElementById('rsc-wrap-precio-escala');
  if (prod.tipo_precio === 'escala') {
    inputPrecio.style.display = 'none';
    wrapEscala.style.display = 'flex';
    STATE._precioElegidoRSC = null;
    await abrirSelectorEscalaRSC(); // igual que en Ventas: se pregunta de una vez, no se asume ninguna
  } else {
    inputPrecio.value = prod.precio ?? 0;
    inputPrecio.style.display = 'block';
    wrapEscala.style.display = 'none';
    STATE._precioElegidoRSC = null;
  }
  actualizarTotalCobrarRSC();
}

// ---- Selector de escala -- mismo patron/modal que usa Ventas ----
async function abrirSelectorEscalaRSC() {
  const id = document.getElementById('rsc-producto-id').value;
  const prod = STATE._productosControladosCache?.[id];
  if (!prod) return;
  document.getElementById('esc-rsc-title').textContent = prod.nombre;
  const lista = document.getElementById('esc-rsc-lista');
  lista.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted)">Cargando…</p>';
  document.getElementById('modal-escala-rsc').style.display = 'flex';
  try {
    const { data } = await sb.from('precios_escala').select('id,nombre,precio').eq('producto_id', id).order('orden');
    STATE._escalasCacheRSC = data || [];
    lista.innerHTML = STATE._escalasCacheRSC.length
      ? STATE._escalasCacheRSC.map((e,i) => `
        <label class="esc-precio-opcion">
          <input type="radio" name="esc-rsc-radio" value="${e.id}" ${i===0?'checked':''}/>
          <span class="esc-precio-nombre">${esc(e.nombre)}</span>
          <span class="esc-precio-valor">${fmt(e.precio)}</span>
        </label>`).join('')
      : '<p style="font-size:12.5px;color:var(--text-muted)">Este producto no tiene precios de escala configurados.</p>';
  } catch (e) {
    console.error('abrirSelectorEscalaRSC:', e);
    lista.innerHTML = '<p style="font-size:12.5px;color:var(--danger,#dc2626)">No se pudo cargar la escala.</p>';
  }
}

function cerrarSelectorEscalaRSC() {
  document.getElementById('modal-escala-rsc').style.display = 'none';
  // Si nunca eligio nada (cerro sin confirmar la primera vez), no
  // deja el formulario a medias -- se limpia el producto elegido.
  if (!STATE._precioElegidoRSC) {
    document.getElementById('rsc-producto-id').value = '';
    document.getElementById('rsc-wrap-precio-escala').style.display = 'none';
    actualizarTotalCobrarRSC();
  }
}

function confirmarSeleccionEscalaRSC() {
  const radio = document.querySelector('input[name="esc-rsc-radio"]:checked');
  if (!radio) { showToast('Selecciona un precio', 'error'); return; }
  const escala = (STATE._escalasCacheRSC || []).find(e => e.id === radio.value);
  if (!escala) return;
  STATE._precioElegidoRSC = Number(escala.precio);
  document.getElementById('rsc-precio-escala-label').value = `${escala.nombre} — ${fmt(escala.precio)}`;
  document.getElementById('modal-escala-rsc').style.display = 'none';
  actualizarTotalCobrarRSC();
}

function actualizarTotalCobrarRSC() {
  const id = document.getElementById('rsc-producto-id').value;
  const wrap = document.getElementById('rsc-resumen-cobro');
  if (!id) { wrap.style.display = 'none'; return; }
  const cantidad = parseFloat(document.getElementById('rsc-cantidad').value) || 0;
  const wrapEscala = document.getElementById('rsc-wrap-precio-escala');
  const precio = wrapEscala.style.display !== 'none'
    ? (STATE._precioElegidoRSC || 0)
    : parseFloat(document.getElementById('rsc-precio-unitario').value) || 0;
  const total = round2(precio * cantidad);
  document.getElementById('rsc-total-cobrar').textContent = fmt(total);
  wrap.style.display = 'flex';
}

async function cargarMetodosPagoRSC() {
  const sel = document.getElementById('rsc-metodo-pago');
  try {
    const { data } = await sb.from('metodos_pago').select('id,nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    const lista = data || [];
    sel.innerHTML = lista.length
      ? lista.map(m => `<option value="${m.id}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('')
      : '<option value="">Efectivo</option>';
  } catch (e) {
    console.warn('cargarMetodosPagoRSC:', e);
    sel.innerHTML = '<option value="">Efectivo</option>';
  }
  try {
    const { data: bancosData } = await sb.from('bancos').select('id,nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE._bancosRSC = bancosData || [];
  } catch (e) {
    console.warn('cargarMetodosPagoRSC, bancos:', e);
    STATE._bancosRSC = [];
  }
  onCambiarMetodoRSC();
}

// Mismo patron ya usado en Gastos/Compras: solo pide banco si el
// metodo elegido es Tarjeta o Transferencia, y la cuenta ya tiene
// bancos creados -- si no, se comporta igual que siempre (sin banco).
function onCambiarMetodoRSC() {
  const metodoSel = document.getElementById('rsc-metodo-pago');
  const wrap = document.getElementById('rsc-banco-wrap');
  const bancoSel = document.getElementById('rsc-banco');
  if (!metodoSel || !wrap || !bancoSel) return;
  const metodoNombre = (metodoSel.selectedOptions[0]?.textContent || '').toLowerCase();
  const bancos = STATE._bancosRSC || [];
  const necesitaBanco = (metodoNombre.includes('tarjeta') || metodoNombre.includes('transferencia')) && bancos.length > 0;
  if (!necesitaBanco) { wrap.style.display = 'none'; bancoSel.value = ''; return; }
  bancoSel.innerHTML = '<option value="">Selecciona un banco...</option>' +
    bancos.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('');
  wrap.style.display = 'block';
}

async function guardarNuevoRegistro() {
  const errEl = document.getElementById('rsc-error');
  errEl.textContent = '';
  const productoId = document.getElementById('rsc-producto-id').value;
  const productoNombre = document.getElementById('rsc-producto-nombre').value;
  const cantidad = parseFloat(document.getElementById('rsc-cantidad').value);
  const wrapEscalaRSC = document.getElementById('rsc-wrap-precio-escala');
  const precioUnitario = wrapEscalaRSC.style.display !== 'none'
    ? (STATE._precioElegidoRSC || NaN)
    : parseFloat(document.getElementById('rsc-precio-unitario').value);
  const fecha = document.getElementById('rsc-fecha').value;
  const compradorNombre = document.getElementById('rsc-comprador-nombre').value.trim();
  const compradorDocumento = document.getElementById('rsc-comprador-documento').value.trim();
  const recetaNumero = document.getElementById('rsc-receta-numero').value.trim();
  const selMetodo = document.getElementById('rsc-metodo-pago');
  const metodoId = selMetodo?.value || null;
  const metodoNombre = selMetodo?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  const bancoWrap = document.getElementById('rsc-banco-wrap');
  const bancoId = bancoWrap.style.display !== 'none' ? document.getElementById('rsc-banco').value : null;

  if (!productoId) { errEl.textContent = 'Elige un producto de la lista.'; return; }
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  if (isNaN(precioUnitario) || precioUnitario <= 0) { errEl.textContent = 'El precio unitario debe ser mayor que 0.'; return; }
  if (!fecha) { errEl.textContent = 'La fecha es obligatoria.'; return; }
  if (!compradorNombre) { errEl.textContent = 'El nombre del comprador es obligatorio.'; return; }
  if (bancoWrap.style.display !== 'none' && !bancoId) { errEl.textContent = 'Indica de qué banco entra el dinero.'; return; }

  const prod = STATE._productosControladosCache?.[productoId];
  if (!prod) { errEl.textContent = 'Vuelve a elegir el producto de la lista.'; return; }
  if (cantidad > Number(prod.stock_actual || 0)) { errEl.textContent = `Solo hay ${prod.stock_actual} en stock.`; return; }

  const btn = document.getElementById('rsc-btn-guardar');
  btn.disabled = true;
  try {
    const precio = precioUnitario;
    const costo = Number(prod.costo || 0);
    const subtotal = round2(precio * cantidad);
    const costoTotal = round2(costo * cantidad);
    const ganancia = round2(subtotal - costoTotal);

    // 1) La venta real -- este producto NUNCA se vende desde Ventas
    // (se bloquea ahi), asi que el UNICO punto de venta real para
    // sustancias controladas es este modulo. Se crea igual que
    // cualquier venta normal, para que aparezca en el historial de
    // Ventas y Contabilidad la levante igual que cualquier otra.
    const { data: ventaNueva, error: errVenta } = await sb.from('ventas').insert({
      auth_user_id: STATE.userId, fecha, subtotal, descuento: 0, impuesto: 0,
      total: subtotal, costo_total: costoTotal,
      metodo_pago: metodoNombre, metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
      estado_pago: 'pagado', estado: 'completada', categoria: 'Sustancia controlada',
      cliente_nombre: compradorNombre,
      observaciones: `Venta controlada — Farmacia${recetaNumero ? ` — Receta ${recetaNumero}` : ''}`,
    }).select('id').single();
    if (errVenta) throw errVenta;
    const ventaId = ventaNueva.id;

    // 2) El detalle -- una sola linea, el producto controlado
    await sb.from('venta_detalles').insert({
      venta_id: ventaId, auth_user_id: STATE.userId, producto_id: productoId,
      producto_nombre: productoNombre, tipo_item: 'producto',
      cantidad, precio, costo, descuento: 0, subtotal, ganancia,
    });

    // 3) Caja -- mismo mecanismo ya usado en el resto del sistema:
    // se calcula el saldo real (ultimo movimiento + este ingreso).
    const { data: ultMov } = await sb.from('movimientos_financieros')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
    const { data: movNuevo } = await sb.from('movimientos_financieros').insert({
      auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'VENTA',
      concepto: `Venta controlada — ${productoNombre}`, monto: subtotal,
      saldo_anterior: saldoAnt, saldo_resultante: round2(saldoAnt + subtotal),
      metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre, banco_id: bancoId,
      referencia_tipo: 'venta', referencia_id: ventaId, fecha,
    }).select('id').single();
    if (movNuevo?.id) await sb.from('ventas').update({ referencia_caja: movNuevo.id }).eq('id', ventaId);

    // Vincular la receta elegida (Farmacia fase 2) -- aislado: si
    // algo fallara aqui, el registro YA se confirmo, no se revierte nada.
    try {
      const recetaId = document.getElementById('rsc-sel-receta-vincular')?.value;
      if (recetaId) {
        await sb.from('farmacia_recetas').update({ venta_id: ventaId }).eq('id', recetaId).eq('auth_user_id', STATE.userId);
      }
    } catch (eReceta) { console.warn('Vincular receta (RSC):', eReceta); }

    // 4) Descontar stock real del producto
    await sb.from('productos').update({ stock_actual: round2(Number(prod.stock_actual) - cantidad) }).eq('id', productoId);

    // 5) El registro de cumplimiento (quien compro que), ligado a la
    // venta real recien creada.
    const { error } = await sb.from('registro_sustancias_controladas').insert({
      auth_user_id: STATE.userId, producto_id: productoId, producto_nombre: productoNombre,
      cantidad, fecha, comprador_nombre: compradorNombre,
      comprador_documento: compradorDocumento || null, receta_numero: recetaNumero || null,
      venta_id: ventaId,
    });
    if (error) throw error;

    showToast('Venta registrada correctamente.', 'success');
    cerrarModalNuevoRegistro();
    await cargarRegistros();
  } catch (e) {
    console.error('guardarNuevoRegistro:', e);
    errEl.textContent = 'No se pudo guardar el registro. Intenta de nuevo.';
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('click', (e) => {
  const cont = document.getElementById('rsc-resultados-producto');
  const input = document.getElementById('rsc-buscar-producto');
  if (!cont || !input) return;
  if (e.target !== input && !cont.contains(e.target)) cont.style.display = 'none';
});
