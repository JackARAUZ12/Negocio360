/* =====================================================
   HOTEL-RESERVACIONES.JS — NEGOCIO360
   Reservaciones de habitaciones -- parte del sistema de Hotel.
   Disponible para cualquier cuenta, apagado por defecto (mismo
   interruptor usa_modulo_hotel que Habitaciones).
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  habitaciones: [], reservaciones: [], filtradas: [],
  busqueda: '', filtroEstado: '',
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = (typeof monedaParaMostrar === 'function') ? monedaParaMostrar(STATE.empresaConfig?.moneda) : (STATE.empresaConfig?.moneda || 'C$');
  const n = (typeof convertirParaMostrar === 'function') ? convertirParaMostrar(amount, STATE.empresaConfig?.moneda) : Number(amount || 0);
  return `${sym} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// Desglosa un monto YA cobrado (IVA incluido) en su parte neta y su
// IVA, y registra el IVA en Impuestos -- mismo patron real que ya usa
// Ventas (registrarMovimientoImpuesto): a Caja entra el neto, porque
// el IVA no es ingreso del negocio, es dinero recaudado para el
// fisco. Devuelve el monto neto, que es lo que se debe registrar en
// Caja en vez del monto completo.
async function registrarIvaHotel(montoConIva, concepto, referenciaId) {
  const ivaPct = STATE.empresaConfig?.iva_porcentaje_default ? Number(STATE.empresaConfig.iva_porcentaje_default) : 15;
  if (STATE.empresaConfig?.iva_activo === false || ivaPct <= 0) return montoConIva; // negocio sin IVA activo: no se desglosa nada
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
    console.warn('registrarIvaHotel:', e);
  }
  return neto;
}

function fmtFechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function noches(entrada, salida) {
  const a = new Date(entrada + 'T00:00:00'), b = new Date(salida + 'T00:00:00');
  return Math.round((b - a) / 86400000);
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

const ESTADO_LABEL = { confirmada:'Confirmada', pendiente:'Pendiente', cancelada:'Cancelada', completada:'Completada' };

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
    if (STATE.empresaConfig?.usa_modulo_hotel !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.all([cargarHabitacionesParaSelect(), cargarReservaciones()]);
  } catch (e) {
    console.error('init hotel-reservaciones:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   CARGAR DATOS
===================================================== */
async function cargarHabitacionesParaSelect() {
  const { data } = await sb.from('hotel_habitaciones').select('id,numero,tarifa_base').eq('auth_user_id', STATE.userId).eq('activo', true).order('numero');
  STATE.habitaciones = data || [];
  const sel = document.getElementById('res-habitacion');
  sel.innerHTML = STATE.habitaciones.length
    ? STATE.habitaciones.map(h => `<option value="${h.id}" data-tarifa="${h.tarifa_base}">Habitación ${esc(h.numero)}</option>`).join('')
    : '<option value="">No hay habitaciones registradas</option>';
}

async function cargarReservaciones() {
  try {
    const { data, error } = await sb.from('hotel_reservaciones')
      .select('*, hotel_habitaciones(numero)').eq('auth_user_id', STATE.userId).order('fecha_entrada', { ascending: false });
    if (error) throw error;
    STATE.reservaciones = data || [];
    actualizarKpisReservaciones();
    aplicarFiltrosReservaciones();
  } catch (e) {
    console.error('cargarReservaciones:', e);
    showToast('No se pudieron cargar las reservaciones', 'error');
  }
}

function actualizarKpisReservaciones() {
  const lista = STATE.reservaciones;
  document.getElementById('kpi-res-total').textContent = lista.length;
  document.getElementById('kpi-res-confirmadas').textContent = lista.filter(r => r.estado === 'confirmada').length;
  document.getElementById('kpi-res-pendientes').textContent = lista.filter(r => r.estado === 'pendiente').length;
  document.getElementById('kpi-res-completadas').textContent = lista.filter(r => r.estado === 'completada').length;
}

/* =====================================================
   FILTROS + TABLA
===================================================== */
function aplicarFiltrosReservaciones() {
  STATE.busqueda = document.getElementById('res-buscar')?.value.toLowerCase().trim() || '';
  STATE.filtroEstado = document.getElementById('res-filtro-estado')?.value || '';

  let lista = [...STATE.reservaciones];
  if (STATE.busqueda) {
    lista = lista.filter(r =>
      (r.cliente_nombre||'').toLowerCase().includes(STATE.busqueda) ||
      (r.hotel_habitaciones?.numero||'').toLowerCase().includes(STATE.busqueda)
    );
  }
  if (STATE.filtroEstado) lista = lista.filter(r => r.estado === STATE.filtroEstado);
  STATE.filtradas = lista;
  renderTablaReservaciones();
}

function renderTablaReservaciones() {
  const tbody = document.getElementById('res-tbody');
  if (!STATE.filtradas.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">No hay reservaciones que coincidan con el filtro.</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.filtradas.map(r => `
    <tr>
      <td style="font-weight:700">${esc(r.cliente_nombre)}${r.cliente_telefono ? `<div style="font-size:11.5px;color:var(--text-muted);font-weight:400">${esc(r.cliente_telefono)}</div>` : ''}</td>
      <td>Habitación ${esc(r.hotel_habitaciones?.numero || '—')}</td>
      <td>${fmtFechaCorta(r.fecha_entrada)}</td>
      <td>${fmtFechaCorta(r.fecha_salida)}</td>
      <td>${noches(r.fecha_entrada, r.fecha_salida)}</td>
      <td>${fmt(r.tarifa_acordada)}</td>
      <td>${r.tipo_pago === 'anticipo'
        ? `<span style="color:var(--success);font-weight:600">Anticipo ${fmt(r.monto_anticipo)}</span>`
        : `<span style="color:var(--text-muted)">Al check-in</span>`}</td>
      <td><span class="hab-estado-badge hab-estado-${r.estado === 'confirmada' ? 'disponible' : r.estado === 'pendiente' ? 'limpieza' : r.estado === 'cancelada' ? 'bloqueada' : 'mantenimiento'}">${ESTADO_LABEL[r.estado] || r.estado}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${!r.check_in_at && r.estado === 'confirmada' ? `<button class="btn-primary btn-sm" onclick="hacerCheckIn('${r.id}')">🔑 Check-in</button>` : ''}
        ${r.check_in_at && !r.check_out_at ? `<button class="btn-primary btn-sm" onclick="abrirModalEstadia('${r.id}')">🧾 Estadía</button>` : ''}
        <button class="btn-secondary btn-sm" onclick="abrirModalReservacion('${r.id}')">Editar</button>
        ${r.estado !== 'cancelada' && r.estado !== 'completada' && !r.check_in_at ? `<button class="btn-ghost btn-sm" onclick="cancelarReservacion('${r.id}')">Cancelar</button>` : ''}
      </td>
    </tr>`).join('');
}

/* =====================================================
   DETECCION DE SOLAPAMIENTO -- el corazon del modulo. Dos
   reservas se cruzan si el rango de fechas se superpone en
   algun punto, solo contra reservas de la MISMA habitacion que
   siguen "vivas" (confirmada o pendiente -- una cancelada o ya
   completada no bloquea nada).
===================================================== */
function hayCruceDeFechas(habitacionId, entrada, salida, ignorarReservacionId) {
  return STATE.reservaciones.some(r => {
    if (r.id === ignorarReservacionId) return false;
    if (r.habitacion_id !== habitacionId) return false;
    if (r.estado !== 'confirmada' && r.estado !== 'pendiente') return false;
    // Se cruzan si el inicio de una es antes del fin de la otra, en ambas direcciones.
    return entrada < r.fecha_salida && salida > r.fecha_entrada;
  });
}

function onCambiarTipoPagoReservacion() {
  const esAnticipo = document.getElementById('res-tipo-pago').value === 'anticipo';
  document.getElementById('res-wrap-anticipo').style.display = esAnticipo ? '' : 'none';
}

function onCambiarDatosReservacion() {
  const habId = document.getElementById('res-habitacion').value;
  const entrada = document.getElementById('res-entrada').value;
  const salida = document.getElementById('res-salida').value;
  const avisoEl = document.getElementById('res-disponibilidad');
  const idActual = document.getElementById('res-id').value || null;

  // Autocompleta la tarifa con la de la habitación, solo si el
  // campo de tarifa sigue vacio (para no pisar un valor ya escrito).
  const opt = document.querySelector(`#res-habitacion option[value="${habId}"]`);
  const tarifaInput = document.getElementById('res-tarifa');
  if (opt && !tarifaInput.value) tarifaInput.value = opt.dataset.tarifa || '';

  if (!habId || !entrada || !salida) { avisoEl.textContent = ''; return; }
  if (salida <= entrada) { avisoEl.textContent = '⚠️ La fecha de salida debe ser después de la entrada.'; avisoEl.style.color = 'var(--danger)'; return; }

  if (hayCruceDeFechas(habId, entrada, salida, idActual)) {
    avisoEl.textContent = '⚠️ Esta habitación ya tiene una reservación en esas fechas.';
    avisoEl.style.color = 'var(--danger)';
  } else {
    avisoEl.textContent = '✅ Disponible en esas fechas.';
    avisoEl.style.color = 'var(--success)';
  }
}

/* =====================================================
   CREAR / EDITAR
===================================================== */
function abrirModalReservacion(id) {
  document.getElementById('res-error').textContent = '';
  document.getElementById('res-disponibilidad').textContent = '';
  document.getElementById('res-id').value = id || '';

  if (id) {
    const r = STATE.reservaciones.find(x => x.id === id);
    if (!r) return;
    document.getElementById('res-modal-title').textContent = 'Editar reservación';
    document.getElementById('res-habitacion').value = r.habitacion_id;
    document.getElementById('res-entrada').value = r.fecha_entrada;
    document.getElementById('res-salida').value = r.fecha_salida;
    document.getElementById('res-huesped').value = r.cliente_nombre || '';
    document.getElementById('res-telefono').value = r.cliente_telefono || '';
    document.getElementById('res-personas').value = r.num_personas || 1;
    document.getElementById('res-tarifa').value = r.tarifa_acordada || '';
    document.getElementById('res-estado').value = (r.estado === 'confirmada' || r.estado === 'pendiente') ? r.estado : 'confirmada';
    document.getElementById('res-notas').value = r.notas || '';
    document.getElementById('res-tipo-pago').value = r.tipo_pago || 'sin_pago';
    document.getElementById('res-monto-anticipo').value = r.monto_anticipo || '';
    document.getElementById('res-metodo-anticipo').value = r.metodo_pago_anticipo || 'Efectivo';
    // Si el anticipo ya se registro en Caja, no se puede editar el
    // monto desde aqui (evita que el numero en Caja y en la reserva
    // queden desincronizados) -- solo se ve, ya fijo.
    document.getElementById('res-monto-anticipo').disabled = !!r.anticipo_registrado_caja;
  } else {
    document.getElementById('res-modal-title').textContent = 'Nueva reservación';
    document.getElementById('res-habitacion').selectedIndex = 0;
    document.getElementById('res-entrada').value = '';
    document.getElementById('res-salida').value = '';
    document.getElementById('res-huesped').value = '';
    document.getElementById('res-telefono').value = '';
    document.getElementById('res-personas').value = 1;
    document.getElementById('res-tarifa').value = '';
    document.getElementById('res-estado').value = 'confirmada';
    document.getElementById('res-notas').value = '';
    document.getElementById('res-tipo-pago').value = 'sin_pago';
    document.getElementById('res-monto-anticipo').value = '';
    document.getElementById('res-monto-anticipo').disabled = false;
    document.getElementById('res-metodo-anticipo').value = 'Efectivo';
  }
  onCambiarTipoPagoReservacion();
  openModal('modal-reservacion');
}

async function guardarReservacion() {
  const errEl = document.getElementById('res-error');
  errEl.textContent = '';

  const habitacionId = document.getElementById('res-habitacion').value;
  if (!habitacionId) { errEl.textContent = 'Selecciona una habitación.'; return; }

  const entrada = document.getElementById('res-entrada').value;
  const salida = document.getElementById('res-salida').value;
  if (!entrada || !salida) { errEl.textContent = 'Completa las fechas de entrada y salida.'; return; }
  if (salida <= entrada) { errEl.textContent = 'La fecha de salida debe ser después de la entrada.'; return; }

  const huesped = document.getElementById('res-huesped').value.trim();
  if (!huesped) { errEl.textContent = 'El nombre del huésped es obligatorio.'; return; }

  const tarifa = Math.max(0, parseFloat(document.getElementById('res-tarifa').value) || 0);
  if (tarifa <= 0) { errEl.textContent = 'La tarifa acordada debe ser mayor a cero.'; return; }

  const tipoPago = document.getElementById('res-tipo-pago').value;
  const montoAnticipo = Math.max(0, parseFloat(document.getElementById('res-monto-anticipo').value) || 0);
  if (tipoPago === 'anticipo' && montoAnticipo <= 0) { errEl.textContent = 'Escribe el monto del anticipo.'; return; }

  const id = document.getElementById('res-id').value || null;

  // Verificacion final de cruce de fechas, justo antes de guardar --
  // la misma logica que ya avisaba en tiempo real, pero repetida aqui
  // como ultima barrera (por si el usuario cambio algo sin disparar
  // el aviso, o abrio 2 pestañas a la vez).
  if (hayCruceDeFechas(habitacionId, entrada, salida, id)) {
    errEl.textContent = 'Esta habitación ya tiene una reservación en esas fechas.';
    return;
  }

  // El anticipo se registra en Caja como dinero real que YA entro --
  // pero solo la PRIMERA vez (la reserva existente que edito el campo
  // esta deshabilitado, asi que este caso solo aplica al crear una
  // reserva nueva marcada con anticipo desde el inicio).
  // Se registra en Caja siempre que se marque anticipo con monto > 0
  // Y todavia no se haya registrado antes -- cubre tanto crear una
  // reserva nueva CON anticipo desde el inicio, como editar una
  // reserva ya existente para agregarle el anticipo despues (el caso
  // real mas comun: se crea la reserva primero, y el anticipo se
  // marca cuando el cliente de verdad paga, no siempre en el mismo
  // instante). anticipo_registrado_caja es la bandera que evita que
  // se registre dos veces si se vuelve a editar despues.
  const reservaExistente = id ? STATE.reservaciones.find(x => x.id === id) : null;
  const yaRegistrado = reservaExistente?.anticipo_registrado_caja === true;
  const registrarAnticipoEnCaja = tipoPago === 'anticipo' && montoAnticipo > 0 && !yaRegistrado;

  const payload = {
    auth_user_id: STATE.userId, habitacion_id: habitacionId,
    cliente_nombre: huesped, cliente_telefono: document.getElementById('res-telefono').value.trim() || null,
    fecha_entrada: entrada, fecha_salida: salida,
    num_personas: Math.max(1, parseInt(document.getElementById('res-personas').value) || 1),
    tarifa_acordada: tarifa, estado: document.getElementById('res-estado').value,
    notas: document.getElementById('res-notas').value.trim() || null,
    tipo_pago: tipoPago,
    monto_anticipo: tipoPago === 'anticipo' ? montoAnticipo : null,
    metodo_pago_anticipo: tipoPago === 'anticipo' ? document.getElementById('res-metodo-anticipo').value : null,
    updated_at: new Date().toISOString(),
  };

  setBtnLoading('res-btn-guardar', true);
  try {
    let reservaId = id;
    if (id) {
      const { error } = await sb.from('hotel_reservaciones').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('hotel_reservaciones').insert(payload).select('id').single();
      if (error) throw error;
      reservaId = data.id;
    }

    if (registrarAnticipoEnCaja && window.CajaAPI) {
      const conceptoAnticipo = `Anticipo de reservación — ${huesped}`;
      const montoNeto = await registrarIvaHotel(montoAnticipo, conceptoAnticipo, reservaId);
      const cajaRes = await window.CajaAPI.registrarMovimiento({
        auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'OTRO_INGRESO',
        concepto: conceptoAnticipo,
        monto: montoNeto, referencia_tipo: 'hotel_reservacion', referencia_id: reservaId,
        metodo_pago_nombre: document.getElementById('res-metodo-anticipo').value,
      });
      if (cajaRes.ok) {
        await sb.from('hotel_reservaciones').update({ anticipo_registrado_caja: true }).eq('id', reservaId);
      } else {
        showToast('La reservación se guardó, pero el anticipo no se pudo registrar en Caja: ' + cajaRes.error, 'error');
      }
    }

    showToast(id ? 'Reservación actualizada' : 'Reservación creada');
    closeModal('modal-reservacion');
    await cargarReservaciones();
  } catch (e) {
    console.error('guardarReservacion:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  } finally {
    setBtnLoading('res-btn-guardar', false);
  }
}

async function cancelarReservacion(id) {
  if (!confirm('¿Cancelar esta reservación? La habitación quedará libre para esas fechas.')) return;
  try {
    const { error } = await sb.from('hotel_reservaciones').update({ estado: 'cancelada', updated_at: new Date().toISOString() }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Reservación cancelada');
    await cargarReservaciones();
  } catch (e) {
    console.error('cancelarReservacion:', e);
    showToast('No se pudo cancelar. Intenta de nuevo.', 'error');
  }
}

/* =====================================================
   CHECK-IN / CHECK-OUT -- el huesped llega, la habitacion pasa a
   ocupada; durante la estadia se le puede sumar cargos a su cuenta
   (folio); al salir, se cobra el total real (habitacion + cargos -
   anticipo ya pagado) y la habitacion pasa a limpieza, nunca
   directo a disponible -- asi funciona un hotel de verdad.
===================================================== */
async function hacerCheckIn(id) {
  const r = STATE.reservaciones.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`¿Registrar el check-in de ${r.cliente_nombre} en la Habitación ${r.hotel_habitaciones?.numero || ''}?`)) return;
  try {
    const { error: e1 } = await sb.from('hotel_reservaciones')
      .update({ check_in_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).eq('auth_user_id', STATE.userId);
    if (e1) throw e1;
    const { error: e2 } = await sb.from('hotel_habitaciones')
      .update({ estado: 'ocupada' }).eq('id', r.habitacion_id).eq('auth_user_id', STATE.userId);
    if (e2) throw e2;
    showToast('Check-in registrado — la habitación ya aparece ocupada');
    await cargarReservaciones();
  } catch (e) {
    console.error('hacerCheckIn:', e);
    showToast('No se pudo registrar el check-in. Intenta de nuevo.', 'error');
  }
}

STATE.cargosEstadia = [];

async function abrirModalEstadia(id) {
  const r = STATE.reservaciones.find(x => x.id === id);
  if (!r) return;
  document.getElementById('est-reservacion-id').value = id;
  document.getElementById('est-error').textContent = '';
  document.getElementById('est-cargo-desc').value = '';
  document.getElementById('est-cargo-monto').value = '';
  document.getElementById('est-huesped-info').textContent =
    `${r.cliente_nombre} — Habitación ${r.hotel_habitaciones?.numero || ''} · Entrada ${fmtFechaCorta(r.fecha_entrada)}`;

  const { data } = await sb.from('hotel_cargos_estadia').select('*').eq('reservacion_id', id).order('created_at');
  STATE.cargosEstadia = data || [];
  renderEstadia(r);
  openModal('modal-estadia');
}

function renderEstadia(r) {
  const nNoches = noches(r.fecha_entrada, r.fecha_salida);
  const montoHabitacion = nNoches * Number(r.tarifa_acordada || 0);
  const totalCargos = STATE.cargosEstadia.reduce((s, c) => s + Number(c.monto || 0), 0);
  const anticipo = r.tipo_pago === 'anticipo' ? Number(r.monto_anticipo || 0) : 0;
  const total = montoHabitacion + totalCargos - anticipo;

  document.getElementById('est-noches').textContent = nNoches;
  document.getElementById('est-monto-habitacion').textContent = fmt(montoHabitacion);
  document.getElementById('est-lista-cargos').innerHTML = STATE.cargosEstadia.map(c => `
    <div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0">
      <span>${esc(c.descripcion)}</span><span>${fmt(c.monto)}</span>
    </div>`).join('');

  const filaAnticipo = document.getElementById('est-fila-anticipo');
  if (anticipo > 0) {
    filaAnticipo.style.display = 'flex';
    document.getElementById('est-monto-anticipo').textContent = `- ${fmt(anticipo)}`;
  } else {
    filaAnticipo.style.display = 'none';
  }
  document.getElementById('est-total').textContent = fmt(Math.max(0, total));
}

async function agregarCargoEstadia() {
  const id = document.getElementById('est-reservacion-id').value;
  const desc = document.getElementById('est-cargo-desc').value.trim();
  const monto = Math.max(0, parseFloat(document.getElementById('est-cargo-monto').value) || 0);
  if (!desc || monto <= 0) { document.getElementById('est-error').textContent = 'Escribe una descripción y un monto mayor a cero.'; return; }

  try {
    const { error } = await sb.from('hotel_cargos_estadia').insert({
      auth_user_id: STATE.userId, reservacion_id: id, descripcion: desc, monto,
    });
    if (error) throw error;
    document.getElementById('est-cargo-desc').value = '';
    document.getElementById('est-cargo-monto').value = '';
    document.getElementById('est-error').textContent = '';
    const r = STATE.reservaciones.find(x => x.id === id);
    const { data } = await sb.from('hotel_cargos_estadia').select('*').eq('reservacion_id', id).order('created_at');
    STATE.cargosEstadia = data || [];
    renderEstadia(r);
  } catch (e) {
    console.error('agregarCargoEstadia:', e);
    document.getElementById('est-error').textContent = 'No se pudo agregar el cargo. Intenta de nuevo.';
  }
}

async function hacerCheckOut() {
  const id = document.getElementById('est-reservacion-id').value;
  const r = STATE.reservaciones.find(x => x.id === id);
  if (!r) return;
  const errEl = document.getElementById('est-error');
  errEl.textContent = '';

  const nNoches = noches(r.fecha_entrada, r.fecha_salida);
  const montoHabitacion = nNoches * Number(r.tarifa_acordada || 0);
  const totalCargos = STATE.cargosEstadia.reduce((s, c) => s + Number(c.monto || 0), 0);
  const anticipo = r.tipo_pago === 'anticipo' ? Number(r.monto_anticipo || 0) : 0;
  const totalCobrar = Math.max(0, montoHabitacion + totalCargos - anticipo);

  setBtnLoading('est-btn-checkout', true);
  try {
    // El cobro final SIEMPRE se registra en Caja, incluso si es
    // C$0.00 (ej. un anticipo que ya cubrio todo) -- para dejar
    // rastro del cierre; un movimiento de C$0 es simplemente
    // ignorado por CajaAPI si el monto no cambia nada relevante.
    if (totalCobrar > 0 && window.CajaAPI) {
      const conceptoCheckout = `Check-out — ${r.cliente_nombre} (Habitación ${r.hotel_habitaciones?.numero || ''})`;
      const montoNeto = await registrarIvaHotel(totalCobrar, conceptoCheckout, id);
      const cajaRes = await window.CajaAPI.registrarMovimiento({
        auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'COBRO',
        concepto: conceptoCheckout,
        monto: montoNeto, referencia_tipo: 'hotel_reservacion', referencia_id: id,
        metodo_pago_nombre: document.getElementById('est-metodo-pago').value,
      });
      if (!cajaRes.ok) {
        errEl.textContent = 'No se pudo registrar el cobro en Caja: ' + cajaRes.error;
        setBtnLoading('est-btn-checkout', false);
        return;
      }
    }

    const { error: e1 } = await sb.from('hotel_reservaciones').update({
      check_out_at: new Date().toISOString(), estado: 'completada',
      cobro_final_registrado_caja: true, updated_at: new Date().toISOString(),
    }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (e1) throw e1;

    const { error: e2 } = await sb.from('hotel_habitaciones')
      .update({ estado: 'limpieza' }).eq('id', r.habitacion_id).eq('auth_user_id', STATE.userId);
    if (e2) throw e2;

    showToast('Check-out completado — la habitación pasó a limpieza');
    closeModal('modal-estadia');
    await cargarReservaciones();
  } catch (e) {
    console.error('hacerCheckOut:', e);
    errEl.textContent = 'No se pudo completar el check-out. Intenta de nuevo.';
  } finally {
    setBtnLoading('est-btn-checkout', false);
  }
}
