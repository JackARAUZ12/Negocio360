/* =====================================================
   RESTAURANTE-MESAS.JS — NEGOCIO360
   Primera pieza del sistema de Restaurante -- disponible para
   cualquier cuenta, apagado por defecto (usa_modulo_restaurante).
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  mesas: [], filtradas: [], vista: 'grid', pagina: 1, porPagina: 12,
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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

const ZONA_LABEL = { interior:'Interior', terraza:'Terraza', barra:'Barra', personalizado:'Personalizado' };
const ESTADO_LABEL = { disponible:'Disponible', ocupada:'Ocupada', reservada:'Reservada', limpieza:'Limpieza', bloqueada:'Bloqueada' };
const ESTADO_CLASE = { disponible:'disponible', ocupada:'ocupada', reservada:'bloqueada', limpieza:'limpieza', bloqueada:'mantenimiento' };

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

    await cargarMesas();
  } catch (e) {
    console.error('init restaurante-mesas:', e);
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
async function cargarMesas() {
  try {
    const { data, error } = await sb.from('restaurante_mesas')
      .select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('numero');
    if (error) throw error;
    STATE.mesas = data || [];
    actualizarKpisMesas();
    aplicarFiltrosMesas();
  } catch (e) {
    console.error('cargarMesas:', e);
    showToast('No se pudieron cargar las mesas', 'error');
  }
}

function actualizarKpisMesas() {
  const lista = STATE.mesas;
  document.getElementById('kpi-mesa-total').textContent = lista.length;
  document.getElementById('kpi-mesa-disponibles').textContent = lista.filter(m => m.estado === 'disponible').length;
  document.getElementById('kpi-mesa-ocupadas').textContent = lista.filter(m => m.estado === 'ocupada').length;
  document.getElementById('kpi-mesa-reservadas').textContent = lista.filter(m => m.estado === 'reservada').length;
  document.getElementById('kpi-mesa-limpieza').textContent = lista.filter(m => m.estado === 'limpieza').length;
}

/* =====================================================
   FILTROS + PAGINACIÓN
===================================================== */
function aplicarFiltrosMesas() {
  const q = document.getElementById('mesa-buscar')?.value.toLowerCase().trim() || '';
  const estadoF = document.getElementById('mesa-filtro-estado')?.value || '';
  const zonaF = document.getElementById('mesa-filtro-zona')?.value || '';

  let lista = [...STATE.mesas];
  if (q) {
    lista = lista.filter(m =>
      (m.numero||'').toLowerCase().includes(q) ||
      (m.zona_personalizada||'').toLowerCase().includes(q) ||
      (ZONA_LABEL[m.zona]||'').toLowerCase().includes(q)
    );
  }
  if (estadoF) lista = lista.filter(m => m.estado === estadoF);
  if (zonaF) lista = lista.filter(m => m.zona === zonaF);

  STATE.filtradas = lista;
  STATE.pagina = 1;
  renderMesas();
}

function irAPaginaMesas(n) {
  STATE.pagina = n;
  renderMesas();
}

function renderMesas() {
  const cont = document.getElementById('mesa-grid');
  const total = STATE.filtradas.length;
  const inicio = (STATE.pagina - 1) * STATE.porPagina;
  const pagina = STATE.filtradas.slice(inicio, inicio + STATE.porPagina);

  if (!total) {
    cont.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:32px 0">No hay mesas que coincidan con el filtro.</p>`;
    document.getElementById('mesa-paginacion').innerHTML = '';
    return;
  }

  cont.innerHTML = pagina.map(m => tarjetaMesaHtml(m)).join('');
  renderPaginacionMesas(total, inicio, pagina.length);
}

function tarjetaMesaHtml(m) {
  const zonaTexto = m.zona === 'personalizado' ? (m.zona_personalizada || 'Personalizado') : (ZONA_LABEL[m.zona] || m.zona);
  return `
  <div class="hab-card">
    <div class="hab-card-head">
      <div class="hab-card-titulo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        Mesa ${esc(m.numero)}
      </div>
      <span class="hab-estado-badge hab-estado-${ESTADO_CLASE[m.estado] || 'disponible'}">${ESTADO_LABEL[m.estado] || m.estado}</span>
    </div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px">📍 ${esc(zonaTexto)}</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">👥 Capacidad: ${esc(String(m.capacidad))} persona${m.capacidad==1?'':'s'}</div>
    <div style="display:flex;gap:8px">
      <button class="btn-secondary" style="flex:1" onclick="verDetalleMesa('${m.id}')">👁️ Ver</button>
      <button class="btn-primary" style="flex:1" onclick="abrirModalMesa('${m.id}')">✏️ Editar</button>
    </div>
  </div>`;
}

function renderPaginacionMesas(total, inicio, cantidadEnPagina) {
  const totalPaginas = Math.ceil(total / STATE.porPagina);
  const cont = document.getElementById('mesa-paginacion');
  if (totalPaginas <= 1) { cont.innerHTML = `<span>Mostrando ${total} de ${total} mesas</span>`; return; }
  let botones = '';
  for (let i = 1; i <= totalPaginas; i++) {
    botones += `<button class="hab-pag-nav ${i===STATE.pagina?'active':''}" onclick="irAPaginaMesas(${i})">${i}</button>`;
  }
  cont.innerHTML = `
    <span>Mostrando ${inicio+1}-${inicio+cantidadEnPagina} de ${total} mesas</span>
    <div style="display:flex;gap:6px">${botones}</div>`;
}

/* =====================================================
   CREAR / EDITAR
===================================================== */
function onCambiarZonaMesa() {
  const esPersonalizado = document.getElementById('mesa-zona').value === 'personalizado';
  document.getElementById('mesa-wrap-zona-personalizada').style.display = esPersonalizado ? '' : 'none';
}

function abrirModalMesa(id) {
  document.getElementById('mesa-error').textContent = '';
  document.getElementById('mesa-id').value = id || '';

  if (id) {
    const m = STATE.mesas.find(x => x.id === id);
    if (!m) return;
    document.getElementById('mesa-modal-title').textContent = 'Editar mesa';
    document.getElementById('mesa-numero').value = m.numero;
    document.getElementById('mesa-capacidad').value = m.capacidad;
    document.getElementById('mesa-zona').value = m.zona;
    document.getElementById('mesa-zona-personalizada').value = m.zona_personalizada || '';
    document.getElementById('mesa-estado').value = ['disponible','limpieza','bloqueada'].includes(m.estado) ? m.estado : 'disponible';
    document.getElementById('mesa-notas').value = m.notas || '';
  } else {
    document.getElementById('mesa-modal-title').textContent = 'Nueva mesa';
    document.getElementById('mesa-numero').value = '';
    document.getElementById('mesa-capacidad').value = 2;
    document.getElementById('mesa-zona').value = 'interior';
    document.getElementById('mesa-zona-personalizada').value = '';
    document.getElementById('mesa-estado').value = 'disponible';
    document.getElementById('mesa-notas').value = '';
  }
  onCambiarZonaMesa();
  openModal('modal-mesa');
}

async function guardarMesa() {
  const errEl = document.getElementById('mesa-error');
  errEl.textContent = '';

  const numero = document.getElementById('mesa-numero').value.trim();
  if (!numero) { errEl.textContent = 'El número o nombre de la mesa es obligatorio.'; return; }

  const capacidad = Math.max(1, parseInt(document.getElementById('mesa-capacidad').value) || 1);
  const zona = document.getElementById('mesa-zona').value;
  const zonaPersonalizada = document.getElementById('mesa-zona-personalizada').value.trim();
  if (zona === 'personalizado' && !zonaPersonalizada) { errEl.textContent = 'Escribe el nombre de la zona personalizada.'; return; }

  const id = document.getElementById('mesa-id').value || null;

  // Numero unico por cuenta -- deteccion previa, con mensaje claro
  // (la base de datos tambien lo protege con una restriccion real,
  // esto es solo para no depender unicamente del error crudo de la BD).
  const yaExiste = STATE.mesas.some(m => m.numero.toLowerCase() === numero.toLowerCase() && m.id !== id);
  if (yaExiste) { errEl.textContent = `Ya existe una mesa con el número "${numero}".`; return; }

  const idActual = id ? STATE.mesas.find(m => m.id === id) : null;
  const estadoNuevo = document.getElementById('mesa-estado').value;
  const cambioDeEstado = !idActual || idActual.estado !== estadoNuevo;

  const payload = {
    auth_user_id: STATE.userId, numero, capacidad,
    zona, zona_personalizada: zona === 'personalizado' ? zonaPersonalizada : null,
    estado: estadoNuevo,
    notas: document.getElementById('mesa-notas').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (cambioDeEstado) payload.en_este_estado_desde = new Date().toISOString();

  setBtnLoading('mesa-btn-guardar', true);
  try {
    const { error } = id
      ? await sb.from('restaurante_mesas').update(payload).eq('id', id).eq('auth_user_id', STATE.userId)
      : await sb.from('restaurante_mesas').insert(payload);
    if (error) throw error;
    showToast(id ? 'Mesa actualizada' : 'Mesa creada');
    closeModal('modal-mesa');
    await cargarMesas();
  } catch (e) {
    console.error('guardarMesa:', e);
    errEl.textContent = e.message?.includes('duplicate') || e.code === '23505'
      ? `Ya existe una mesa con el número "${numero}".`
      : 'No se pudo guardar. Intenta de nuevo.';
  } finally {
    setBtnLoading('mesa-btn-guardar', false);
  }
}

function verDetalleMesa(id) {
  const m = STATE.mesas.find(x => x.id === id);
  if (!m) return;
  const zonaTexto = m.zona === 'personalizado' ? (m.zona_personalizada || 'Personalizado') : (ZONA_LABEL[m.zona] || m.zona);

  document.getElementById('mesa-detalle-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="font-weight:800;font-size:17px">Mesa ${esc(m.numero)}</span>
      <span class="hab-estado-badge hab-estado-${ESTADO_CLASE[m.estado] || 'disponible'}" style="font-size:12.5px;padding:5px 14px">${ESTADO_LABEL[m.estado] || m.estado}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:12px">
      <div><b>Zona:</b> ${esc(zonaTexto)}</div>
      <div><b>Capacidad:</b> ${esc(String(m.capacidad))} persona${m.capacidad==1?'':'s'}</div>
    </div>
    ${m.notas ? `<div><b style="font-size:13px">Notas:</b><p style="font-size:13px;color:var(--text-secondary);margin-top:4px">${esc(m.notas)}</p></div>` : ''}
  `;
  openModal('modal-mesa-detalle');
}
