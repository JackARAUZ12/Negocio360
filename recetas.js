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

    await cargarRecetas();
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
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
function fmtCantidad(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }

/* =====================================================
   RECETAS -- paciente, medico y medicamentos recetados.
===================================================== */
async function cargarRecetas() {
  const tbody = document.getElementById('rc-tbody');
  try {
    const { data, error } = await sb.from('farmacia_recetas')
      .select('*, farmacia_receta_items(producto_id, producto_nombre, cantidad, productos(es_sustancia_controlada))')
      .eq('auth_user_id', STATE.userId).order('fecha', { ascending: false });
    if (error) throw error;
    STATE.registros = data || [];
    STATE.filtrados = STATE.registros;
    renderRecetas();
    cargarListasAutocompletado();
  } catch (e) {
    console.error('cargarRecetas:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudieron cargar las recetas.</td></tr>';
  }
}

async function cargarListasAutocompletado() {
  try {
    const [{ data: pacientes }, { data: medicos }] = await Promise.all([
      sb.from('farmacia_pacientes').select('nombre').eq('auth_user_id', STATE.userId).order('nombre'),
      sb.from('farmacia_medicos').select('nombre').eq('auth_user_id', STATE.userId).order('nombre'),
    ]);
    document.getElementById('rc-pacientes-list').innerHTML = (pacientes||[]).map(p => `<option value="${esc(p.nombre)}">`).join('');
    document.getElementById('rc-medicos-list').innerHTML = (medicos||[]).map(m => `<option value="${esc(m.nombre)}">`).join('');
  } catch (e) { console.warn('cargarListasAutocompletado:', e); }
}

function filtrarRecetas() {
  const q = (document.getElementById('rc-buscar')?.value || '').trim().toLowerCase();
  STATE.filtrados = !q ? STATE.registros : STATE.registros.filter(r =>
    (r.paciente_nombre || '').toLowerCase().includes(q) || (r.medico_nombre || '').toLowerCase().includes(q)
  );
  renderRecetas();
}

function renderRecetas() {
  const tbody = document.getElementById('rc-tbody');
  const pie = document.getElementById('rc-pie');
  const lista = STATE.filtrados || [];
  if (pie) pie.textContent = `${lista.length} receta${lista.length === 1 ? '' : 's'}`;
  actualizarKpisRC();
  if (!tbody) return;
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Sin recetas todavía -- usa "+ Nueva receta" para la primera.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(r => {
    const meds = (r.farmacia_receta_items || []).map(i => `${esc(i.producto_nombre)} (${fmtCantidad(i.cantidad)})`).join(', ');
    return `
      <tr>
        <td>${r.fecha}</td>
        <td>${esc(r.paciente_nombre)}</td>
        <td>${r.medico_nombre ? esc(r.medico_nombre) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${r.numero_receta ? esc(r.numero_receta) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="max-width:220px">${meds || '<span style="color:var(--text-muted)">Sin medicamentos</span>'}</td>
        <td>
          ${r.venta_id
            ? '<span style="font-size:11.5px;color:var(--text-muted)">✅ Ya vendida</span>'
            : `<button class="btn-accion-tabla btn-primary" onclick="venderDesdeReceta('${r.id}')">🛒 Vender</button>`}
          <button class="btn-accion-tabla btn-ghost" onclick="eliminarRecetaRC('${r.id}')">🗑️ Eliminar</button>
        </td>
      </tr>`;
  }).join('');
}

function actualizarKpisRC() {
  const lista = STATE.registros || [];
  const hoy = todayISO();
  const inicioMes = hoy.slice(0, 7);
  const esteMes = lista.filter(r => (r.fecha || '').startsWith(inicioMes)).length;
  const hoyCount = lista.filter(r => r.fecha === hoy).length;
  const pacientes = new Set(lista.map(r => (r.paciente_nombre || '').trim().toLowerCase()).filter(Boolean));
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('rc-kpi-total', lista.length);
  set('rc-kpi-mes', esteMes);
  set('rc-kpi-hoy', hoyCount);
  set('rc-kpi-pacientes', pacientes.size);
}

// Vender directo desde la receta -- deja los medicamentos listos
// en el carrito de Ventas y la receta pre-seleccionada para
// vincular, sin tener que buscar producto por producto de nuevo.
function venderDesdeReceta(recetaId) {
  const receta = (STATE.registros || []).find(r => r.id === recetaId);
  if (!receta) { showToast('No se encontró la receta.', 'error'); return; }
  const todos = (receta.farmacia_receta_items || []).filter(i => i.producto_id);
  if (!todos.length) { showToast('Esta receta no tiene medicamentos con producto válido.', 'error'); return; }

  // Las sustancias controladas NUNCA pueden venderse desde el
  // carrito normal (regla de negocio ya existente) -- se separan y
  // se avisa que esas se venden aparte, desde Control de Sustancias.
  const controlados = todos.filter(i => i.productos?.es_sustancia_controlada === true);
  const normales = todos.filter(i => i.productos?.es_sustancia_controlada !== true);

  if (controlados.length) {
    const nombres = controlados.map(i => i.producto_nombre).join(', ');
    showToast(`${nombres} ${controlados.length > 1 ? 'son sustancias controladas' : 'es sustancia controlada'} -- véndelos aparte desde Farmacia · Control de Sustancias.`, 'error');
  }

  if (!normales.length) return; // todo era controlado, nada que mandar al carrito normal

  const datosAGuardar = { recetaId: receta.id, items: normales.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad })) };
  sessionStorage.setItem('n360_receta_a_vender', JSON.stringify(datosAGuardar));
  window.location.href = 'ventas.html';
}

async function eliminarRecetaRC(id) {
  if (!confirm('¿Eliminar esta receta? Esta acción no se puede deshacer.')) return;
  try {
    const { error } = await sb.from('farmacia_recetas').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Receta eliminada.', 'success');
    await cargarRecetas();
  } catch (e) {
    console.error('eliminarRecetaRC:', e);
    showToast('No se pudo eliminar la receta.', 'error');
  }
}

/* ---- Modal Nueva Receta ---- */
let _medicamentosRecetaActual = [];

function abrirModalNuevaReceta() {
  document.getElementById('rc-error').textContent = '';
  document.getElementById('rc-paciente').value = '';
  document.getElementById('rc-medico').value = '';
  document.getElementById('rc-numero').value = '';
  document.getElementById('rc-fecha').value = todayISO();
  document.getElementById('rc-observaciones').value = '';
  document.getElementById('rc-buscar-medicamento').value = '';
  document.getElementById('rc-resultados-medicamento').style.display = 'none';
  _medicamentosRecetaActual = [];
  renderListaMedicamentosReceta();
  document.getElementById('modal-nueva-receta').style.display = 'flex';
}

function cerrarModalNuevaReceta() {
  document.getElementById('modal-nueva-receta').style.display = 'none';
}

let _timeoutBuscarMedRC = null;
function buscarMedicamentoReceta(q) {
  clearTimeout(_timeoutBuscarMedRC);
  const cont = document.getElementById('rc-resultados-medicamento');
  if (q.trim().length < 1) { cont.style.display = 'none'; return; }
  _timeoutBuscarMedRC = setTimeout(async () => {
    try {
      const { data } = await sb.from('productos').select('id,nombre')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .ilike('nombre', `%${q}%`).limit(8);
      const lista = data || [];
      cont.innerHTML = lista.length
        ? lista.map(p => `<div class="search-result-item" style="padding:8px 10px;cursor:pointer" onclick="agregarMedicamentoALista('${p.id}','${esc(p.nombre).replace(/'/g,"\\'")}')">${esc(p.nombre)}</div>`).join('')
        : '<div style="padding:8px 10px;color:var(--text-muted);font-size:12.5px">Sin resultados</div>';
      cont.style.display = 'block';
    } catch (e) { console.error('buscarMedicamentoReceta:', e); }
  }, 250);
}

function agregarMedicamentoALista(id, nombre) {
  if (_medicamentosRecetaActual.find(m => m.producto_id === id)) { showToast('Ese medicamento ya está en la lista.', 'error'); return; }
  _medicamentosRecetaActual.push({ producto_id: id, producto_nombre: nombre, cantidad: 1 });
  document.getElementById('rc-buscar-medicamento').value = '';
  document.getElementById('rc-resultados-medicamento').style.display = 'none';
  renderListaMedicamentosReceta();
}

function quitarMedicamentoDeLista(id) {
  _medicamentosRecetaActual = _medicamentosRecetaActual.filter(m => m.producto_id !== id);
  renderListaMedicamentosReceta();
}

function actualizarCantidadMedicamento(id, valor) {
  const m = _medicamentosRecetaActual.find(x => x.producto_id === id);
  if (m) m.cantidad = Math.max(0.01, parseFloat(valor) || 1);
}

function renderListaMedicamentosReceta() {
  const cont = document.getElementById('rc-lista-medicamentos');
  cont.innerHTML = _medicamentosRecetaActual.length
    ? _medicamentosRecetaActual.map(m => `
      <div style="display:flex;align-items:center;gap:6px;background:var(--bg-app);border-radius:8px;padding:6px 10px">
        <span style="flex:1;font-size:12.5px">${esc(m.producto_nombre)}</span>
        <input type="number" value="${m.cantidad}" min="0.01" step="0.01" style="width:60px;padding:4px 6px;border-radius:6px;border:1px solid var(--border,#e5e7eb)" onchange="actualizarCantidadMedicamento('${m.producto_id}', this.value)"/>
        <button type="button" onclick="quitarMedicamentoDeLista('${m.producto_id}')" style="background:none;border:none;cursor:pointer;color:var(--danger,#dc2626)">✕</button>
      </div>`).join('')
    : '<p style="font-size:12px;color:var(--text-muted)">Sin medicamentos agregados todavía.</p>';
}

async function guardarReceta() {
  const errEl = document.getElementById('rc-error');
  errEl.textContent = '';
  const pacienteNombre = document.getElementById('rc-paciente').value.trim();
  const medicoNombre = document.getElementById('rc-medico').value.trim();
  const numero = document.getElementById('rc-numero').value.trim();
  const fecha = document.getElementById('rc-fecha').value;
  const observaciones = document.getElementById('rc-observaciones').value.trim();

  if (!pacienteNombre) { errEl.textContent = 'El nombre del paciente es obligatorio.'; return; }
  if (!fecha) { errEl.textContent = 'La fecha es obligatoria.'; return; }
  if (!_medicamentosRecetaActual.length) { errEl.textContent = 'Agrega al menos un medicamento.'; return; }

  document.getElementById('rc-btn-guardar').disabled = true;
  try {
    // Paciente y medico -- se guardan en su catalogo propio si son
    // nuevos (por nombre), para que el proximo autocompletado los
    // incluya. No se bloquea nada si esto falla -- es secundario.
    let pacienteId = null, medicoId = null;
    try {
      const { data: pExist } = await sb.from('farmacia_pacientes').select('id').eq('auth_user_id', STATE.userId).ilike('nombre', pacienteNombre).maybeSingle();
      if (pExist) pacienteId = pExist.id;
      else { const { data: pNuevo } = await sb.from('farmacia_pacientes').insert({ auth_user_id: STATE.userId, nombre: pacienteNombre }).select('id').single(); pacienteId = pNuevo?.id || null; }
      if (medicoNombre) {
        const { data: mExist } = await sb.from('farmacia_medicos').select('id').eq('auth_user_id', STATE.userId).ilike('nombre', medicoNombre).maybeSingle();
        if (mExist) medicoId = mExist.id;
        else { const { data: mNuevo } = await sb.from('farmacia_medicos').insert({ auth_user_id: STATE.userId, nombre: medicoNombre }).select('id').single(); medicoId = mNuevo?.id || null; }
      }
    } catch (eCat) { console.warn('guardarReceta, catalogo:', eCat); }

    const { data: recetaNueva, error } = await sb.from('farmacia_recetas').insert({
      auth_user_id: STATE.userId, paciente_id: pacienteId, paciente_nombre: pacienteNombre,
      medico_id: medicoId, medico_nombre: medicoNombre || null,
      numero_receta: numero || null, fecha, observaciones: observaciones || null,
    }).select('id').single();
    if (error) throw error;

    const itemsPayload = _medicamentosRecetaActual.map(m => ({
      receta_id: recetaNueva.id, producto_id: m.producto_id, producto_nombre: m.producto_nombre, cantidad: m.cantidad,
    }));
    const { error: errItems } = await sb.from('farmacia_receta_items').insert(itemsPayload);
    if (errItems) throw errItems;

    showToast('Receta guardada correctamente.', 'success');
    cerrarModalNuevaReceta();
    await cargarRecetas();
  } catch (e) {
    console.error('guardarReceta:', e);
    errEl.textContent = 'No se pudo guardar la receta. Intenta de nuevo.';
  } finally {
    document.getElementById('rc-btn-guardar').disabled = false;
  }
}

document.addEventListener('click', (e) => {
  const cont = document.getElementById('rc-resultados-medicamento');
  const input = document.getElementById('rc-buscar-medicamento');
  if (!cont || !input) return;
  if (e.target !== input && !cont.contains(e.target)) cont.style.display = 'none';
});
