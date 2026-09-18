/* =====================================================
   HOTEL-HABITACIONES.JS — NEGOCIO360
   Modulo de Habitaciones -- parte del sistema de Hotel, en
   construccion por fases. Disponible para cualquier cuenta,
   apagado por defecto -- se activa desde Configuracion. La
   tabla tiene RLS real, asi que cada cuenta solo ve sus propias
   habitaciones sin importar quien mas use el modulo.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  habitaciones: [], filtradas: [],
  busqueda: '', filtroEstado: '', filtroTipo: '',
  vista: 'grid', paginaActual: 1, porPagina: 6,
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = (typeof monedaParaMostrar === 'function') ? monedaParaMostrar(STATE.empresaConfig?.moneda) : (STATE.empresaConfig?.moneda || 'C$');
  const n = (typeof convertirParaMostrar === 'function') ? convertirParaMostrar(amount, STATE.empresaConfig?.moneda) : Number(amount || 0);
  return `${sym} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const TIPO_LABEL = { individual:'Individual', doble:'Doble', triple:'Triple', suite:'Suite', familiar:'Familiar', personalizado:'Personalizado' };
const ESTADO_LABEL = { disponible:'Disponible', ocupada:'Ocupada', limpieza:'Limpieza', mantenimiento:'Mantenimiento', bloqueada:'Bloqueada' };

/* =====================================================
   INICIALIZACIÓN — con el doble guard de cuenta + modulo activo
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);

    // Guard: si el interruptor de Configuracion esta apagado, no se
    // entra -- el modulo queda inactivo hasta que se active
    // explicitamente, para CUALQUIER cuenta.
    if (STATE.empresaConfig?.usa_modulo_hotel !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarHabitaciones();
  } catch (e) {
    console.error('init hotel-habitaciones:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   CARGAR Y CALCULAR KPIs
===================================================== */
async function cargarHabitaciones() {
  try {
    const { data, error } = await sb.from('hotel_habitaciones')
      .select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('numero');
    if (error) throw error;
    STATE.habitaciones = data || [];
    actualizarKpis();
    aplicarFiltrosHabitaciones();
  } catch (e) {
    console.error('cargarHabitaciones:', e);
    showToast('No se pudieron cargar las habitaciones', 'error');
  }
}

function actualizarKpis() {
  const lista = STATE.habitaciones;
  const contar = (estado) => lista.filter(h => h.estado === estado).length;
  document.getElementById('kpi-hab-total').textContent = lista.length;
  document.getElementById('kpi-hab-disponibles').textContent = contar('disponible');
  document.getElementById('kpi-hab-ocupadas').textContent = contar('ocupada');
  document.getElementById('kpi-hab-limpieza').textContent = contar('limpieza');
  document.getElementById('kpi-hab-mantenimiento').textContent = contar('mantenimiento');
}

/* =====================================================
   FILTROS + VISTA + PAGINACIÓN
===================================================== */
function aplicarFiltrosHabitaciones() {
  STATE.busqueda = document.getElementById('hab-buscar')?.value.toLowerCase().trim() || '';
  STATE.filtroEstado = document.getElementById('hab-filtro-estado')?.value || '';
  STATE.filtroTipo = document.getElementById('hab-filtro-tipo')?.value || '';

  let lista = [...STATE.habitaciones];
  if (STATE.busqueda) {
    lista = lista.filter(h =>
      (h.numero||'').toLowerCase().includes(STATE.busqueda) ||
      (h.piso||'').toLowerCase().includes(STATE.busqueda) ||
      (TIPO_LABEL[h.tipo]||h.tipo_personalizado||'').toLowerCase().includes(STATE.busqueda)
    );
  }
  if (STATE.filtroEstado) lista = lista.filter(h => h.estado === STATE.filtroEstado);
  if (STATE.filtroTipo) lista = lista.filter(h => h.tipo === STATE.filtroTipo);

  STATE.filtradas = lista;
  STATE.paginaActual = 1;
  renderHabitaciones();
}

function cambiarVistaHabitaciones(vista) {
  STATE.vista = vista;
  document.getElementById('hab-vista-grid').classList.toggle('active', vista === 'grid');
  document.getElementById('hab-vista-lista').classList.toggle('active', vista === 'lista');
  document.getElementById('hab-grid-cont').style.display = vista === 'grid' ? '' : 'none';
  document.getElementById('hab-lista-cont').style.display = vista === 'lista' ? '' : 'none';
  renderHabitaciones();
}

function irAPaginaHabitaciones(n) {
  const totalPaginas = Math.max(1, Math.ceil(STATE.filtradas.length / STATE.porPagina));
  STATE.paginaActual = Math.min(Math.max(1, n), totalPaginas);
  renderHabitaciones();
}

function renderHabitaciones() {
  const lista = STATE.filtradas;
  const inicio = (STATE.paginaActual - 1) * STATE.porPagina;
  const pagina = lista.slice(inicio, inicio + STATE.porPagina);

  if (STATE.vista === 'grid') {
    const cont = document.getElementById('hab-grid-cont');
    cont.innerHTML = pagina.length ? pagina.map(h => tarjetaHabitacionHtml(h)).join('') :
      `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">No hay habitaciones que coincidan con el filtro.</div>`;
  } else {
    const tbody = document.getElementById('hab-lista-tbody');
    tbody.innerHTML = pagina.length ? pagina.map(h => filaHabitacionHtml(h)).join('') :
      `<tr><td colspan="7" class="empty-cell">No hay habitaciones que coincidan con el filtro.</td></tr>`;
  }
  renderPaginacionHabitaciones(lista.length, inicio, pagina.length);
}

function tarjetaHabitacionHtml(h) {
  const tipoTexto = h.tipo === 'personalizado' ? (h.tipo_personalizado || 'Personalizado') : (TIPO_LABEL[h.tipo] || h.tipo);
  return `
  <div class="hab-card">
    <div class="hab-card-head">
      <div class="hab-card-titulo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
        Habitación ${esc(h.numero)}
      </div>
      <span class="hab-estado-badge hab-estado-${h.estado}">${ESTADO_LABEL[h.estado] || h.estado}</span>
    </div>
    <div class="hab-card-datos">
      ${h.piso ? `<div class="hab-card-dato">📍 Piso ${esc(h.piso)}</div>` : ''}
      <div class="hab-card-dato">🛏️ ${esc(tipoTexto)}</div>
      <div class="hab-card-dato">👥 Capacidad: ${esc(String(h.capacidad))} persona${h.capacidad==1?'':'s'}</div>
      <div class="hab-card-dato hab-card-tarifa">${fmt(h.tarifa_base)} / noche</div>
    </div>
    <div class="hab-card-btns">
      <button class="btn-secondary" onclick="verDetalleHabitacion('${h.id}')">👁️ Ver detalles</button>
      <button class="btn-primary" onclick="abrirModalHabitacion('${h.id}')">✏️ Editar</button>
    </div>
  </div>`;
}

function filaHabitacionHtml(h) {
  const tipoTexto = h.tipo === 'personalizado' ? (h.tipo_personalizado || 'Personalizado') : (TIPO_LABEL[h.tipo] || h.tipo);
  return `
  <tr>
    <td style="font-weight:700">Habitación ${esc(h.numero)}</td>
    <td>${h.piso ? esc(h.piso) : '—'}</td>
    <td>${esc(tipoTexto)}</td>
    <td>${esc(String(h.capacidad))}</td>
    <td>${fmt(h.tarifa_base)}</td>
    <td><span class="hab-estado-badge hab-estado-${h.estado}">${ESTADO_LABEL[h.estado] || h.estado}</span></td>
    <td style="display:flex;gap:6px">
      <button class="btn-secondary btn-sm" onclick="verDetalleHabitacion('${h.id}')">Ver</button>
      <button class="btn-primary btn-sm" onclick="abrirModalHabitacion('${h.id}')">Editar</button>
    </td>
  </tr>`;
}

function renderPaginacionHabitaciones(total, inicio, cantidadEnPagina) {
  const cont = document.getElementById('hab-paginacion');
  if (!total) { cont.innerHTML = ''; return; }
  const totalPaginas = Math.max(1, Math.ceil(total / STATE.porPagina));
  const desde = total ? inicio + 1 : 0;
  const hasta = inicio + cantidadEnPagina;

  let numeros = '';
  for (let i = 1; i <= totalPaginas; i++) {
    numeros += `<button class="hab-pag-num ${i===STATE.paginaActual?'active':''}" onclick="irAPaginaHabitaciones(${i})">${i}</button>`;
  }

  cont.innerHTML = `
    <span>Mostrando ${desde}-${hasta} de ${total} habitaciones</span>
    <div class="hab-pag-btns">
      <button class="hab-pag-nav" ${STATE.paginaActual<=1?'disabled':''} onclick="irAPaginaHabitaciones(${STATE.paginaActual-1})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      ${numeros}
      <button class="hab-pag-nav" ${STATE.paginaActual>=totalPaginas?'disabled':''} onclick="irAPaginaHabitaciones(${STATE.paginaActual+1})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>`;
}

/* =====================================================
   CREAR / EDITAR
===================================================== */
function onCambiarTipoHabitacion() {
  const tipo = document.getElementById('hab-tipo').value;
  document.getElementById('hab-wrap-tipo-personalizado').style.display = tipo === 'personalizado' ? '' : 'none';
}

function abrirModalHabitacion(id) {
  document.getElementById('hab-error').textContent = '';
  document.getElementById('hab-id').value = id || '';

  if (id) {
    const h = STATE.habitaciones.find(x => x.id === id);
    if (!h) return;
    document.getElementById('hab-modal-title').textContent = `Editar habitación ${h.numero}`;
    document.getElementById('hab-numero').value = h.numero || '';
    document.getElementById('hab-piso').value = h.piso || '';
    document.getElementById('hab-tipo').value = h.tipo || 'individual';
    document.getElementById('hab-tipo-personalizado').value = h.tipo_personalizado || '';
    document.getElementById('hab-capacidad').value = h.capacidad || 2;
    document.getElementById('hab-tarifa').value = h.tarifa_base || '';
    document.getElementById('hab-estado').value = h.estado || 'disponible';
    document.getElementById('hab-comodidades').value = h.comodidades || '';
    document.getElementById('hab-notas').value = h.notas || '';
  } else {
    document.getElementById('hab-modal-title').textContent = 'Nueva habitación';
    document.getElementById('hab-numero').value = '';
    document.getElementById('hab-piso').value = '';
    document.getElementById('hab-tipo').value = 'individual';
    document.getElementById('hab-tipo-personalizado').value = '';
    document.getElementById('hab-capacidad').value = 2;
    document.getElementById('hab-tarifa').value = '';
    document.getElementById('hab-estado').value = 'disponible';
    document.getElementById('hab-comodidades').value = '';
    document.getElementById('hab-notas').value = '';
  }
  onCambiarTipoHabitacion();
  openModal('modal-habitacion');
}

async function guardarHabitacion() {
  const errEl = document.getElementById('hab-error');
  errEl.textContent = '';

  const numero = document.getElementById('hab-numero').value.trim();
  if (!numero) { errEl.textContent = 'El número de habitación es obligatorio.'; return; }

  const tipo = document.getElementById('hab-tipo').value;
  const tipoPersonalizado = document.getElementById('hab-tipo-personalizado').value.trim();
  if (tipo === 'personalizado' && !tipoPersonalizado) { errEl.textContent = 'Escribe el nombre del tipo personalizado.'; return; }

  const capacidad = Math.max(1, parseInt(document.getElementById('hab-capacidad').value) || 1);
  const tarifa = Math.max(0, parseFloat(document.getElementById('hab-tarifa').value) || 0);
  if (tarifa <= 0) { errEl.textContent = 'La tarifa base debe ser mayor a cero.'; return; }

  const id = document.getElementById('hab-id').value || null;
  const payload = {
    auth_user_id: STATE.userId, numero,
    piso: document.getElementById('hab-piso').value.trim() || null,
    tipo, tipo_personalizado: tipo === 'personalizado' ? tipoPersonalizado : null,
    capacidad, tarifa_base: tarifa,
    estado: document.getElementById('hab-estado').value,
    comodidades: document.getElementById('hab-comodidades').value.trim() || null,
    notas: document.getElementById('hab-notas').value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  setBtnLoading('hab-btn-guardar', true);
  try {
    const { error } = id
      ? await sb.from('hotel_habitaciones').update(payload).eq('id', id).eq('auth_user_id', STATE.userId)
      : await sb.from('hotel_habitaciones').insert(payload);
    if (error) {
      if (error.code === '23505') throw new Error('Ya existe una habitación con ese número.');
      throw error;
    }
    showToast(id ? 'Habitación actualizada' : 'Habitación agregada');
    closeModal('modal-habitacion');
    await cargarHabitaciones();
  } catch (e) {
    console.error('guardarHabitacion:', e);
    errEl.textContent = e.message || 'No se pudo guardar. Intenta de nuevo.';
  } finally {
    setBtnLoading('hab-btn-guardar', false);
  }
}

/* =====================================================
   VER DETALLES
===================================================== */
function verDetalleHabitacion(id) {
  const h = STATE.habitaciones.find(x => x.id === id);
  if (!h) return;
  const tipoTexto = h.tipo === 'personalizado' ? (h.tipo_personalizado || 'Personalizado') : (TIPO_LABEL[h.tipo] || h.tipo);

  document.getElementById('hd-titulo').textContent = `Habitación ${h.numero}`;
  document.getElementById('hd-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span class="hab-estado-badge hab-estado-${h.estado}" style="font-size:12.5px;padding:5px 14px">${ESTADO_LABEL[h.estado] || h.estado}</span>
      <span class="hab-card-tarifa" style="font-size:16px">${fmt(h.tarifa_base)} / noche</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:12px">
      <div><b>Piso:</b> ${h.piso ? esc(h.piso) : '—'}</div>
      <div><b>Tipo:</b> ${esc(tipoTexto)}</div>
      <div><b>Capacidad:</b> ${esc(String(h.capacidad))} persona${h.capacidad==1?'':'s'}</div>
    </div>
    ${h.comodidades ? `<div style="margin-bottom:10px"><b style="font-size:13px">Comodidades:</b><p style="font-size:13px;color:var(--text-secondary);margin-top:4px">${esc(h.comodidades)}</p></div>` : ''}
    ${h.notas ? `<div><b style="font-size:13px">Notas:</b><p style="font-size:13px;color:var(--text-secondary);margin-top:4px">${esc(h.notas)}</p></div>` : ''}
  `;
  openModal('modal-detalle-habitacion');
}
