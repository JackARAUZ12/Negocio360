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
    if (STATE.empresaConfig?.usa_modulo_veterinaria !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarRecordatorios();
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
   RECORDATORIOS DE VACUNAS -- refuerzos pendientes + aviso por WhatsApp
   (las utilidades puras estan en vet-comun.js)
===================================================== */
const RC = { items: [], filtro: 'todos' };
const $r = id => document.getElementById(id);
const fechaCortaRC = ymd => { if (!ymd) return '—'; const p = vetPartes(ymd); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`; };

async function traerTodo(construir) {
  const tam = 1000; let desde = 0, todo = [];
  while (true) {
    const { data, error } = await construir().range(desde, desde + tam - 1);
    if (error) throw error;
    todo = todo.concat(data || []);
    if (!data || data.length < tam) break;
    desde += tam;
    if (desde > 50000) break;
  }
  return todo;
}

async function cargarRecordatorios() {
  try {
    const [vacs, ms] = await Promise.all([
      // TODAS las aplicaciones (no solo las que tienen refuerzo): una aplicacion posterior reemplaza al aviso viejo.
      traerTodo(() => sb.from('vet_vacunas').select('id, mascota_id, nombre, tipo, fecha_aplicacion, proxima_dosis, created_at, recordatorio_enviado_en').eq('auth_user_id', STATE.userId).order('id')),
      traerTodo(() => sb.from('vet_mascotas').select('id, nombre, especie, activo, clientes(nombre, apellido, telefono, whatsapp)').eq('auth_user_id', STATE.userId).order('id')),
    ]);
    const mapa = {}; ms.forEach(m => { mapa[m.id] = m; });
    const deActivas = vacs.filter(v => mapa[v.mascota_id] && mapa[v.mascota_id].activo);
    RC.items = vetPendientesRefuerzo(deActivas).map(v => ({ v, m: mapa[v.mascota_id], dias: vetDiasEntre(vetHoy(), v.proxima_dosis) }));
    $r('rc-kpi-vencidos').textContent = RC.items.filter(i => i.dias < 0).length;
    $r('rc-kpi-semana').textContent = RC.items.filter(i => i.dias >= 0 && i.dias <= 7).length;
    $r('rc-kpi-mes').textContent = RC.items.filter(i => i.dias >= 0 && i.dias <= 30).length;
    $r('rc-kpi-total').textContent = RC.items.length;
    renderRC();
  } catch (e) {
    console.error('cargarRecordatorios:', e);
    $r('rc-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudieron cargar los recordatorios.</td></tr>';
  }
}

function filtrarRC(f) {
  RC.filtro = f;
  document.querySelectorAll('#rc-chips .vt-chip').forEach(b => b.classList.toggle('activa', b.dataset.f === f));
  renderRC();
}
function itemsFiltradosRC() {
  switch (RC.filtro) {
    case 'vencidos': return RC.items.filter(i => i.dias < 0);
    case 'semana':   return RC.items.filter(i => i.dias >= 0 && i.dias <= 7);
    case 'mes':      return RC.items.filter(i => i.dias >= 0 && i.dias <= 30);
    case 'sinaviso': return RC.items.filter(i => !i.v.recordatorio_enviado_en && i.dias <= 30);
    default:         return RC.items;
  }
}
function duenoRC(m) {
  const c = m.clientes;
  if (!c) return { nombre: '(sin dueño)', tel: '' };
  return { nombre: `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Sin nombre', tel: c.telefono || c.whatsapp || '' };
}

function renderRC() {
  const tbody = $r('rc-tbody'), lista = itemsFiltradosRC(), LIMITE = 300;
  $r('rc-pie').textContent = lista.length > LIMITE ? `Mostrando ${LIMITE} de ${lista.length}.` : `${lista.length} recordatorio${lista.length === 1 ? '' : 's'}`;
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:22px;color:var(--text-muted)">${RC.items.length ? 'No hay recordatorios en este filtro. 🎉' : 'No hay refuerzos pendientes. Cuando registres una vacuna con su próxima dosis, aparecerá aquí.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.slice(0, LIMITE).map(({ v, m }) => {
    const esp = VET_ESPECIES[m.especie] || VET_ESPECIES.otro, d = duenoRC(m), est = vetEstadoRefuerzo(v.proxima_dosis);
    const tel = vetTelefonoWhatsApp(d.tel, STATE.empresaConfig?.pais);
    const aviso = v.recordatorio_enviado_en ? fechaCortaRC(String(v.recordatorio_enviado_en).slice(0, 10)) : '—';
    return `<tr>
      <td><div class="vt-mascota"><span class="vt-emoji">${esp.e}</span><div class="vt-nombre">${esc(m.nombre)}</div></div></td>
      <td>${esc(d.nombre)}<div class="vt-sub">${d.tel ? esc(d.tel) : 'sin teléfono'}</div></td>
      <td>${esc(v.nombre)}</td>
      <td><span class="vt-badge vt-badge-${est.clase}">${esc(est.texto)}</span><div class="vt-sub">${fechaCortaRC(v.proxima_dosis)}</div></td>
      <td class="vt-hide-m">${aviso}</td>
      <td><button class="vt-wa" ${tel ? '' : 'disabled title="El dueño no tiene un teléfono válido"'} onclick="enviarRecordatorioRC('${v.id}')">📲 ${v.recordatorio_enviado_en ? 'Reenviar' : 'Enviar'}</button></td>
    </tr>`;
  }).join('');
}

// Abre WhatsApp con el mensaje YA escrito (el envio lo confirma la persona) y deja marcado el aviso.
async function enviarRecordatorioRC(vacunaId) {
  const it = RC.items.find(i => i.v.id === vacunaId);
  if (!it) return;
  const d = duenoRC(it.m);
  const tel = vetTelefonoWhatsApp(d.tel, STATE.empresaConfig?.pais);
  if (!tel) { showToast('El dueño no tiene un teléfono válido. Agrégalo en la ficha de la mascota.', 'error'); return; }
  const texto = vetMensajeRecordatorio({ dueno: d.nombre, mascota: it.m.nombre, vacuna: it.v.nombre, proxima: it.v.proxima_dosis, negocio: STATE.empresaConfig?.nombre_comercial });
  window.open(vetEnlaceWhatsApp(tel, texto), '_blank', 'noopener');   // primero: el navegador exige que sea directo al hacer clic
  try {
    const ahora = new Date().toISOString();
    const { error } = await sb.from('vet_vacunas').update({ recordatorio_enviado_en: ahora }).eq('id', it.v.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    it.v.recordatorio_enviado_en = ahora; renderRC();
  } catch (e) { console.warn('enviarRecordatorioRC (marcar):', e); }
}
