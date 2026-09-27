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
      <td>${fmtNumLote(r.cantidad)}</td>
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
  document.getElementById('rsc-precio-hint').style.display = 'none';
  document.getElementById('rsc-fecha').value = todayISO();
  document.getElementById('rsc-comprador-nombre').value = '';
  document.getElementById('rsc-comprador-documento').value = '';
  document.getElementById('rsc-receta-numero').value = '';
  document.getElementById('rsc-resumen-cobro').style.display = 'none';
  cargarMetodosPagoRSC();
  document.getElementById('modal-nuevo-registro').style.display = 'flex';
}

function cerrarModalNuevoRegistro() {
  document.getElementById('modal-nuevo-registro').style.display = 'none';
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
        ? lista.map(p => `<div class="search-result-item" style="padding:8px 10px;cursor:pointer" onclick="seleccionarProductoControlado('${p.id}')">${esc(p.nombre)} — ${p.tipo_precio === 'escala' ? 'escala de precios' : fmtNumLote(p.precio)}</div>`).join('')
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

  const hint = document.getElementById('rsc-precio-hint');
  const inputPrecio = document.getElementById('rsc-precio-unitario');
  if (prod.tipo_precio === 'escala') {
    // Sin precio fijo -- se trae la primera escala (la de menor
    // "orden", normalmente la unidad individual) como sugerencia,
    // pero el campo queda editable por si aplica otra.
    try {
      const { data } = await sb.from('precios_escala').select('precio').eq('producto_id', id).order('orden').limit(1).maybeSingle();
      inputPrecio.value = data?.precio ?? '';
    } catch (e) { console.warn('seleccionarProductoControlado, escala:', e); inputPrecio.value = ''; }
    hint.style.display = 'block';
  } else {
    inputPrecio.value = prod.precio ?? 0;
    hint.style.display = 'none';
  }
  actualizarTotalCobrarRSC();
}

function actualizarTotalCobrarRSC() {
  const id = document.getElementById('rsc-producto-id').value;
  const wrap = document.getElementById('rsc-resumen-cobro');
  if (!id) { wrap.style.display = 'none'; return; }
  const cantidad = parseFloat(document.getElementById('rsc-cantidad').value) || 0;
  const precio = parseFloat(document.getElementById('rsc-precio-unitario').value) || 0;
  const total = round2(precio * cantidad);
  document.getElementById('rsc-total-cobrar').textContent = fmtNumLote(total);
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
}

async function guardarNuevoRegistro() {
  const errEl = document.getElementById('rsc-error');
  errEl.textContent = '';
  const productoId = document.getElementById('rsc-producto-id').value;
  const productoNombre = document.getElementById('rsc-producto-nombre').value;
  const cantidad = parseFloat(document.getElementById('rsc-cantidad').value);
  const precioUnitario = parseFloat(document.getElementById('rsc-precio-unitario').value);
  const fecha = document.getElementById('rsc-fecha').value;
  const compradorNombre = document.getElementById('rsc-comprador-nombre').value.trim();
  const compradorDocumento = document.getElementById('rsc-comprador-documento').value.trim();
  const recetaNumero = document.getElementById('rsc-receta-numero').value.trim();
  const selMetodo = document.getElementById('rsc-metodo-pago');
  const metodoId = selMetodo?.value || null;
  const metodoNombre = selMetodo?.selectedOptions[0]?.dataset.nombre || 'Efectivo';

  if (!productoId) { errEl.textContent = 'Elige un producto de la lista.'; return; }
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  if (isNaN(precioUnitario) || precioUnitario <= 0) { errEl.textContent = 'El precio unitario debe ser mayor que 0.'; return; }
  if (!fecha) { errEl.textContent = 'La fecha es obligatoria.'; return; }
  if (!compradorNombre) { errEl.textContent = 'El nombre del comprador es obligatorio.'; return; }

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
      total: subtotal, costo_total: costoTotal, ganancia,
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
      metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
      referencia_tipo: 'venta', referencia_id: ventaId, fecha,
    }).select('id').single();
    if (movNuevo?.id) await sb.from('ventas').update({ referencia_caja: movNuevo.id }).eq('id', ventaId);

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
