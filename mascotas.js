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

    await cargarMascotas();
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
   MASCOTAS -- fichas, historia clinica y carnet de vacunacion
   (las utilidades puras estan en vet-comun.js)
===================================================== */
const MV = { mascotas: [], filtradas: [], pend: [], proxPor: {}, ultima: {}, dueno: null, editId: null, volverAFicha: false, ficha: null, consultas: [], vacunas: [],
  equipo: [], citaActiva: null, cargos: {}, recetas: {}, consultaCtx: null, prodCargo: null, urlHecha: false };
const $m = id => document.getElementById(id);
const fechaCorta = ymd => { if (!ymd) return '—'; const p = vetPartes(ymd); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`; };

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

function duenoDe(m) {
  const c = m.clientes;
  if (!c) return { nombre: '(sin dueño)', tel: '' };
  return { nombre: `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Sin nombre', tel: c.telefono || c.whatsapp || '' };
}

/* ---------- Lista ---------- */
async function cargarMascotas() {
  try {
    const sel = $m('mv-especie');
    if (sel && sel.options.length <= 1) Object.entries(VET_ESPECIES).forEach(([k, v]) => sel.add(new Option(`${v.e} ${v.n}`, k)));

    const [ms, vacs, cons, eq] = await Promise.all([
      traerTodo(() => sb.from('vet_mascotas').select('*, clientes(nombre, apellido, telefono, whatsapp)').eq('auth_user_id', STATE.userId).order('id')),
      traerTodo(() => sb.from('vet_vacunas').select('id, mascota_id, nombre, tipo, fecha_aplicacion, proxima_dosis, created_at').eq('auth_user_id', STATE.userId).order('id')),
      traerTodo(() => sb.from('vet_consultas').select('mascota_id, fecha').eq('auth_user_id', STATE.userId).order('id')),
      traerTodo(() => sb.from('vet_veterinarios').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('id')),
    ]);
    MV.mascotas = ms; MV.equipo = eq;
    const activas = new Set(ms.filter(m => m.activo).map(m => m.id));
    MV.pend = vetPendientesRefuerzo(vacs.filter(v => activas.has(v.mascota_id)));
    MV.proxPor = {}; MV.pend.forEach(p => { if (!MV.proxPor[p.mascota_id]) MV.proxPor[p.mascota_id] = p; });   // ya vienen ordenados por fecha
    MV.ultima = {}; cons.forEach(c => { if (!MV.ultima[c.mascota_id] || c.fecha > MV.ultima[c.mascota_id]) MV.ultima[c.mascota_id] = c.fecha; });

    const hoy = vetHoy(), inicioMes = hoy.slice(0, 8) + '01';
    let prox = 0, venc = 0;
    MV.pend.forEach(p => { const d = vetDiasEntre(hoy, p.proxima_dosis); if (d < 0) venc++; else if (d <= 30) prox++; });
    $m('mv-kpi-activas').textContent = activas.size;
    $m('mv-kpi-consultas').textContent = cons.filter(c => c.fecha >= inicioMes).length;
    $m('mv-kpi-proximos').textContent = prox;
    $m('mv-kpi-vencidos').textContent = venc;
    filtrarMascotas();
    if (!MV.urlHecha) { MV.urlHecha = true; await procesarParametrosURL(); }   // viene de la Agenda (?cita=) o de un enlace (?ficha=)
  } catch (e) {
    console.error('cargarMascotas:', e);
    $m('mv-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudieron cargar las mascotas.</td></tr>';
  }
}

function filtrarMascotas() {
  const q = ($m('mv-buscar')?.value || '').trim().toLowerCase();
  const esp = $m('mv-especie')?.value || '';
  const est = $m('mv-estado')?.value || 'activas';
  MV.filtradas = MV.mascotas.filter(m => {
    if (est === 'activas' && !m.activo) return false;
    if (est === 'archivadas' && m.activo) return false;
    if (esp && m.especie !== esp) return false;
    if (!q) return true;
    const d = duenoDe(m);
    return [m.nombre, m.microchip, d.nombre, d.tel].some(t => String(t || '').toLowerCase().includes(q));
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  renderMascotas();
}

function etiquetaRefuerzo(mid) {
  const p = MV.proxPor[mid];
  if (!p) return '<span class="vt-badge vt-badge-gris">Sin refuerzos</span>';
  const e = vetEstadoRefuerzo(p.proxima_dosis);
  return `<span class="vt-badge vt-badge-${e.clase}" title="${esc(p.nombre)} — ${fechaCorta(p.proxima_dosis)}">${esc(p.nombre.length > 22 ? p.nombre.slice(0, 21) + '…' : p.nombre)} · ${esc(e.texto)}</span>`;
}

function renderMascotas() {
  const tbody = $m('mv-tbody'), LIMITE = 200, lista = MV.filtradas;
  $m('mv-pie').textContent = lista.length > LIMITE ? `Mostrando ${LIMITE} de ${lista.length} -- usa el buscador.` : `${lista.length} mascota${lista.length === 1 ? '' : 's'}`;
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:22px;color:var(--text-muted)">${MV.mascotas.length ? 'No hay mascotas con ese filtro.' : 'Todavía no has registrado mascotas. Crea la primera con "+ Nueva mascota".'}</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.slice(0, LIMITE).map(m => {
    const esp = VET_ESPECIES[m.especie] || VET_ESPECIES.otro, d = duenoDe(m);
    const sexo = m.sexo === 'macho' ? 'Macho' : m.sexo === 'hembra' ? 'Hembra' : '';
    return `<tr onclick="abrirFicha('${m.id}')" style="cursor:pointer">
      <td><div class="vt-mascota"><span class="vt-emoji">${esp.e}</span><div>
        <div class="vt-nombre">${esc(m.nombre)}${m.activo ? '' : ' <span class="vt-badge vt-badge-gris">Archivada</span>'}</div>
        <div class="vt-sub">${esc([m.raza || esp.n, sexo].filter(Boolean).join(' · '))}</div></div></div></td>
      <td>${esc(d.nombre)}<div class="vt-sub">${d.tel ? esc(d.tel) : 'sin teléfono'}</div></td>
      <td class="vt-hide-m">${esc(vetEdad(m.fecha_nacimiento))}</td>
      <td class="vt-hide-m">${fechaCorta(MV.ultima[m.id])}</td>
      <td>${m.activo ? etiquetaRefuerzo(m.id) : '—'}</td>
      <td style="white-space:nowrap"><button class="btn-accion-tabla btn-ghost" onclick="abrirFicha('${m.id}')">📋 Ficha</button></td>
    </tr>`;
  }).join('');
}

/* ---------- Dueño (buscar / crear al vuelo) ---------- */
function elegirDueno(id, nombre, tel) {
  MV.dueno = { id, nombre, tel };
  $m('ms-dueno-resultados').style.display = 'none';
  $m('ms-dueno-buscar').value = '';
  const el = $m('ms-dueno-elegido');
  el.textContent = `👤 ${nombre}${tel ? ' · ' + tel : ''}`; el.style.display = '';
}
let _timerDueno = null;
function buscarDueno(q) {
  clearTimeout(_timerDueno);
  const cont = $m('ms-dueno-resultados');
  q = (q || '').replace(/[,()%*\\]/g, ' ').trim();     // caracteres que romperian el filtro
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _timerDueno = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('clientes').select('id, nombre, apellido, telefono, whatsapp')
        .eq('auth_user_id', STATE.userId).or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%`).order('nombre').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length)
        ? data.map(c => { const n = `${c.nombre || ''} ${c.apellido || ''}`.trim(), t = c.telefono || c.whatsapp || '';
            return `<div class="vt-resultado" data-id="${c.id}" data-n="${esc(n)}" data-t="${esc(t)}">${esc(n)}${t ? ` <span style="color:var(--text-muted)">· ${esc(t)}</span>` : ''}</div>`; }).join('')
        : '<div class="vt-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados — puedes crearlo abajo</div>';
      cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => elegirDueno(el.dataset.id, el.dataset.n, el.dataset.t)));
      cont.style.display = '';
    } catch (e) { console.error('buscarDueno:', e); }
  }, 250);
}
function mostrarNuevoDueno() { const w = $m('ms-nuevo-dueno'); w.style.display = w.style.display === 'none' ? '' : 'none'; $m('ms-nd-nombre').focus(); }
async function crearDuenoRapido() {
  const err = $m('ms-error'); err.textContent = '';
  const nombre = $m('ms-nd-nombre').value.trim(), tel = $m('ms-nd-tel').value.trim();
  if (!nombre) { err.textContent = 'Escribe el nombre del dueño.'; return; }
  try {
    const { data, error } = await sb.from('clientes').insert({ auth_user_id: STATE.userId, nombre, telefono: tel || null }).select('id, nombre, telefono').single();
    if (error) throw error;
    elegirDueno(data.id, data.nombre, data.telefono || '');
    $m('ms-nuevo-dueno').style.display = 'none'; $m('ms-nd-nombre').value = ''; $m('ms-nd-tel').value = '';
    showToast('Dueño creado.');
  } catch (e) { console.error('crearDuenoRapido:', e); err.textContent = 'No se pudo crear el dueño. Intenta de nuevo.'; }
}

/* ---------- Mascota: crear / editar ---------- */
function abrirMascota(id) {
  const m = id ? MV.mascotas.find(x => x.id === id) : null;
  MV.editId = m ? m.id : null;
  const sel = $m('ms-especie');
  if (!sel.options.length) Object.entries(VET_ESPECIES).forEach(([k, v]) => sel.add(new Option(`${v.e} ${v.n}`, k)));
  $m('ms-titulo').textContent = m ? '✏️ Editar mascota' : '🐾 Nueva mascota';
  $m('ms-nombre').value = m ? m.nombre : ''; sel.value = m ? m.especie : 'perro';
  $m('ms-raza').value = m?.raza || ''; $m('ms-sexo').value = m ? m.sexo : 'desconocido'; $m('ms-color').value = m?.color || '';
  $m('ms-nacimiento').value = m?.fecha_nacimiento || ''; $m('ms-peso').value = m?.peso_actual ?? '';
  $m('ms-microchip').value = m?.microchip || ''; $m('ms-esterilizado').checked = !!m?.esterilizado;
  $m('ms-alergias').value = m?.alergias || ''; $m('ms-notas').value = m?.notas || '';
  $m('ms-error').textContent = ''; $m('ms-dueno-buscar').value = ''; $m('ms-dueno-resultados').style.display = 'none'; $m('ms-nuevo-dueno').style.display = 'none';
  MV.dueno = null; $m('ms-dueno-elegido').style.display = 'none';
  if (m && m.cliente_id) { const d = duenoDe(m); elegirDueno(m.cliente_id, d.nombre, d.tel); }
  openModal('modal-mascota');
}
function cerrarMascota() { closeModal('modal-mascota'); if (MV.volverAFicha && MV.ficha) { MV.volverAFicha = false; abrirFicha(MV.ficha.id); } MV.volverAFicha = false; }

async function guardarMascota() {
  const err = $m('ms-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const nombre = $m('ms-nombre').value.trim();
  const nac = $m('ms-nacimiento').value || null;
  const pesoRaw = $m('ms-peso').value.trim();
  if (!MV.dueno) return fallo('Elige el dueño (o créalo con el enlace de abajo).');
  if (!nombre) return fallo('Escribe el nombre de la mascota.');
  if (nac && nac > vetHoy()) return fallo('La fecha de nacimiento no puede ser futura.');
  if (pesoRaw !== '' && !(Number(pesoRaw) > 0)) return fallo('El peso debe ser mayor que 0.');
  const payload = {
    cliente_id: MV.dueno.id, nombre, especie: $m('ms-especie').value, raza: $m('ms-raza').value.trim() || null,
    sexo: $m('ms-sexo').value, color: $m('ms-color').value.trim() || null, fecha_nacimiento: nac,
    peso_actual: pesoRaw === '' ? null : Number(pesoRaw), microchip: $m('ms-microchip').value.trim() || null,
    esterilizado: $m('ms-esterilizado').checked, alergias: $m('ms-alergias').value.trim() || null, notas: $m('ms-notas').value.trim() || null,
  };
  const btn = $m('ms-btn-guardar'); btn.disabled = true;
  try {
    const q = MV.editId
      ? sb.from('vet_mascotas').update(payload).eq('id', MV.editId).eq('auth_user_id', STATE.userId)
      : sb.from('vet_mascotas').insert({ ...payload, auth_user_id: STATE.userId });
    const { error } = await q;
    if (error) throw error;
    showToast(MV.editId ? 'Mascota actualizada.' : 'Mascota registrada.');
    const volver = MV.volverAFicha; MV.volverAFicha = false;
    closeModal('modal-mascota');
    await cargarMascotas();
    if (volver && MV.ficha) { MV.ficha = MV.mascotas.find(m => m.id === MV.ficha.id) || MV.ficha; abrirFicha(MV.ficha.id); }
  } catch (e) { console.error('guardarMascota:', e); fallo('No se pudo guardar la mascota. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}

/* ---------- Ficha ---------- */
async function abrirFicha(id) {
  const m = MV.mascotas.find(x => x.id === id);
  if (!m) return;
  MV.ficha = m; MV.consultas = []; MV.vacunas = [];
  pintarCabeceraFicha();
  cambiarTabFicha('hist');
  $m('fi-lista-hist').innerHTML = '<p style="color:var(--text-muted)">Cargando…</p>';
  $m('fi-lista-vac').innerHTML = '';
  openModal('modal-ficha');
  await cargarDetalleFicha();
}
function cerrarFicha() { closeModal('modal-ficha'); MV.ficha = null; MV.citaActiva = null; }

function pintarCabeceraFicha() {
  const m = MV.ficha, esp = VET_ESPECIES[m.especie] || VET_ESPECIES.otro, d = duenoDe(m);
  $m('fi-titulo').textContent = `📋 ${m.nombre}`;
  const dato = (t, v) => `<div class="vt-dato"><b>${t}</b><span>${esc(v)}</span></div>`;
  $m('fi-cabecera').innerHTML = `
    <div class="vt-ficha-cab">
      <div class="vt-ficha-emoji">${esp.e}</div>
      <div style="flex:1;min-width:180px">
        <div class="vt-nombre" style="font-size:18px">${esc(m.nombre)}${m.activo ? '' : ' <span class="vt-badge vt-badge-gris">Archivada</span>'}</div>
        <div class="vt-sub">${esc([m.raza || esp.n, m.sexo !== 'desconocido' ? (m.sexo === 'macho' ? 'Macho' : 'Hembra') : '', m.esterilizado ? 'Esterilizado' : ''].filter(Boolean).join(' · '))}</div>
        <div class="vt-sub">👤 ${esc(d.nombre)}${d.tel ? ' · ' + esc(d.tel) : ''}</div>
      </div>
      <div class="vt-acciones" style="margin:0">
        <button class="btn-accion-tabla btn-ghost" onclick="editarDesdeFicha()">✏️ Editar</button>
        <button class="btn-accion-tabla btn-ghost" onclick="alternarArchivada()">${m.activo ? '📦 Archivar' : '♻️ Reactivar'}</button>
        <button class="btn-accion-tabla btn-ghost" onclick="eliminarMascota()">🗑️</button>
      </div>
    </div>
    <div class="vt-datos">
      ${dato('Edad', vetEdad(m.fecha_nacimiento))}${dato('Peso', m.peso_actual ? m.peso_actual + ' kg' : '—')}${dato('Color', m.color || '—')}${dato('Microchip', m.microchip || '—')}
    </div>
    ${m.alergias ? `<div class="vt-aviso">⚠️ <b>Alergias / condiciones:</b> ${esc(m.alergias)}</div>` : ''}
    ${m.notas ? `<p class="vt-sub" style="margin:8px 0 0">📝 ${esc(m.notas)}</p>` : ''}`;
}
function editarDesdeFicha() { const id = MV.ficha.id; MV.volverAFicha = true; closeModal('modal-ficha'); abrirMascota(id); }

function cambiarTabFicha(tab) {
  $m('fi-tab-hist').classList.toggle('activa', tab === 'hist'); $m('fi-tab-vac').classList.toggle('activa', tab === 'vac');
  $m('fi-panel-hist').style.display = tab === 'hist' ? '' : 'none'; $m('fi-panel-vac').style.display = tab === 'vac' ? '' : 'none';
}

async function cargarDetalleFicha() {
  const id = MV.ficha.id;
  try {
    const [c, v] = await Promise.all([
      sb.from('vet_consultas').select('*, ventas(numero_venta, estado)').eq('mascota_id', id).eq('auth_user_id', STATE.userId).order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('vet_vacunas').select('*').eq('mascota_id', id).eq('auth_user_id', STATE.userId).order('fecha_aplicacion', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    if (c.error) throw c.error; if (v.error) throw v.error;
    MV.consultas = c.data || []; MV.vacunas = v.data || []; MV.cargos = {}; MV.recetas = {};
    const ids = MV.consultas.map(x => x.id);
    if (ids.length) {
      const [cg, rx] = await Promise.all([
        sb.from('vet_cargos').select('*, productos(precio)').eq('auth_user_id', STATE.userId).in('consulta_id', ids).order('created_at'),
        sb.from('vet_recetas_items').select('*').eq('auth_user_id', STATE.userId).in('consulta_id', ids).order('created_at'),
      ]);
      (cg.data || []).forEach(x => { (MV.cargos[x.consulta_id] = MV.cargos[x.consulta_id] || []).push(x); });
      (rx.data || []).forEach(x => { (MV.recetas[x.consulta_id] = MV.recetas[x.consulta_id] || []).push(x); });
    }
    renderHistoria(); renderVacunas();
  } catch (e) { console.error('cargarDetalleFicha:', e); $m('fi-lista-hist').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar el historial.</p>'; }
}

function renderHistoria() {
  const cont = $m('fi-lista-hist');
  if (!MV.consultas.length) { cont.innerHTML = '<p class="vt-sub" style="padding:8px 0">Todavía no hay consultas registradas para esta mascota.</p>'; return; }
  const linea = (t, v) => v ? `<p><b>${t}:</b> ${esc(v)}</p>` : '';
  cont.innerHTML = MV.consultas.map(c => {
    const cargos = MV.cargos[c.id] || [], rec = MV.recetas[c.id] || [];
    const cobrada = c.ventas && c.ventas.estado === 'completada', anulada = c.ventas && c.ventas.estado === 'anulada';
    const total = cargos.reduce((t, x) => t + Number(x.cantidad) * Number(x.productos?.precio || 0), 0);
    const bloqueRec = rec.length ? `<div class="vt-bloque"><b>📝 Receta</b>${rec.map(r => `<p>• <b>${esc(r.medicamento)}</b> — ${esc(vetTextoPosologia(r))}</p>`).join('')}</div>` : '';
    const bloqueCuenta = cargos.length ? `<div class="vt-bloque"><b>💳 Cuenta de la visita</b>${cargos.map(x => `<p>• ${esc(vetFormatoNumero(x.cantidad))} × ${esc(x.descripcion)}${x.productos?.precio ? ` — ${esc(fmt(x.cantidad * x.productos.precio))}` : ''}${cobrada ? '' : ` <button class="vt-link" onclick="eliminarCargo('${x.id}')">quitar</button>`}</p>`).join('')}
        <p><b>Total estimado: ${esc(fmt(total))}</b> ${cobrada ? `<span class="vt-cobrada">✅ Cobrada · ${esc(c.ventas.numero_venta)}</span>` : ''}${anulada ? `<span class="vt-badge vt-badge-ambar">Venta ${esc(c.ventas.numero_venta)} anulada: puedes cobrar de nuevo</span>` : ''}</p></div>` : '';
    return `<div class="vt-item">
      <div class="vt-item-cab">
        <div><div class="vt-item-tit">${esc(c.motivo)}</div><div class="vt-item-fecha">${fechaCorta(c.fecha)}${c.veterinario ? ' · ' + esc(c.veterinario) : ''}</div></div>
        <div>${c.peso ? `<span class="vt-badge vt-badge-gris">${c.peso} kg</span> ` : ''}${c.temperatura ? `<span class="vt-badge vt-badge-gris">${c.temperatura} °C</span>` : ''}</div>
      </div>
      ${linea('Síntomas', c.sintomas)}${linea('Diagnóstico', c.diagnostico)}${linea('Tratamiento', c.tratamiento)}${linea('Observaciones', c.observaciones)}
      ${c.proximo_control ? `<p><b>Próximo control:</b> ${fechaCorta(c.proximo_control)}</p>` : ''}
      ${bloqueRec}${bloqueCuenta}
      <div class="vt-acciones">
        <button class="btn-accion-tabla btn-ghost" onclick="abrirReceta('${c.id}')">📝 Receta</button>
        ${cobrada ? '' : `<button class="btn-accion-tabla btn-ghost" onclick="abrirCargo('${c.id}')">➕ Cuenta</button>`}
        ${cargos.length && !cobrada ? `<button class="btn-accion-tabla btn-primary" onclick="cobrarConsulta('${c.id}')">💳 Cobrar</button>` : ''}
        <button class="btn-accion-tabla btn-ghost" onclick="eliminarConsulta('${c.id}')">🗑️ Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

function renderVacunas() {
  const cont = $m('fi-lista-vac');
  if (!MV.vacunas.length) { cont.innerHTML = '<p class="vt-sub" style="padding:8px 0">Todavía no hay vacunas ni desparasitaciones registradas.</p>'; return; }
  const pendIds = new Set(vetPendientesRefuerzo(MV.vacunas).map(p => p.id));
  cont.innerHTML = MV.vacunas.map(v => {
    const t = VET_TIPOS_REGISTRO[v.tipo] || VET_TIPOS_REGISTRO.otro;
    let refuerzo = '';
    if (v.proxima_dosis) {
      if (pendIds.has(v.id)) { const e = vetEstadoRefuerzo(v.proxima_dosis); refuerzo = `<span class="vt-badge vt-badge-${e.clase}">Refuerzo ${fechaCorta(v.proxima_dosis)} · ${esc(e.texto)}</span>`; }
      else refuerzo = `<span class="vt-badge vt-badge-verde">Refuerzo aplicado</span>`;
    }
    const aviso = v.recordatorio_enviado_en ? `<span class="vt-sub"> · aviso enviado el ${fechaCorta(String(v.recordatorio_enviado_en).slice(0, 10))}</span>` : '';
    const puedeAvisar = v.proxima_dosis && pendIds.has(v.id);
    return `<div class="vt-item">
      <div class="vt-item-cab">
        <div><div class="vt-item-tit">${t.e} ${esc(v.nombre)}</div><div class="vt-item-fecha">${esc(t.n)} · aplicada el ${fechaCorta(v.fecha_aplicacion)}${v.lote ? ' · lote ' + esc(v.lote) : ''}${v.veterinario ? ' · ' + esc(v.veterinario) : ''}</div></div>
        <div>${refuerzo}</div>
      </div>
      ${v.observaciones ? `<p>${esc(v.observaciones)}</p>` : ''}${aviso ? `<p>${aviso}</p>` : ''}
      <div class="vt-acciones">
        ${puedeAvisar ? `<button class="btn-accion-tabla btn-primary" onclick="enviarRecordatorio('${v.id}')">📲 Enviar recordatorio</button>` : ''}
        <button class="btn-accion-tabla btn-ghost" onclick="eliminarVacuna('${v.id}')">🗑️ Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

/* ---------- Recordatorio por WhatsApp (con boton: abre el chat con el mensaje listo) ---------- */
async function enviarRecordatorio(vacunaId) {
  const v = MV.vacunas.find(x => x.id === vacunaId), m = MV.ficha;
  if (!v || !m || !v.proxima_dosis) return;
  const d = duenoDe(m);
  const tel = vetTelefonoWhatsApp(d.tel, STATE.empresaConfig?.pais);
  if (!tel) { showToast('El dueño no tiene un teléfono válido. Edita la mascota y agrega su teléfono.', 'error'); return; }
  const texto = vetMensajeRecordatorio({ dueno: d.nombre, mascota: m.nombre, vacuna: v.nombre, proxima: v.proxima_dosis, negocio: STATE.empresaConfig?.nombre_comercial });
  window.open(vetEnlaceWhatsApp(tel, texto), '_blank', 'noopener');        // primero (el navegador exige que sea directo al hacer clic)
  try {
    const ahora = new Date().toISOString();
    const { error } = await sb.from('vet_vacunas').update({ recordatorio_enviado_en: ahora }).eq('id', v.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    v.recordatorio_enviado_en = ahora; renderVacunas();
  } catch (e) { console.warn('enviarRecordatorio (marcar):', e); }
}

/* ---------- Consulta ---------- */
function abrirConsulta() {
  ['co-motivo', 'co-sintomas', 'co-diagnostico', 'co-tratamiento', 'co-peso', 'co-temp', 'co-obs', 'co-proximo'].forEach(i => { $m(i).value = ''; });
  $m('co-fecha').value = vetHoy(); $m('co-error').textContent = '';
  pintarVetCampoM('co', MV.citaActiva?.veterinario_id, MV.citaActiva?.veterinario);
  if (MV.citaActiva && MV.citaActiva.motivo) $m('co-motivo').value = MV.citaActiva.motivo;
  openModal('modal-consulta');
}
function cerrarConsulta() { closeModal('modal-consulta'); }
async function guardarConsulta() {
  const err = $m('co-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const fecha = $m('co-fecha').value, motivo = $m('co-motivo').value.trim();
  const pesoRaw = $m('co-peso').value.trim(), tempRaw = $m('co-temp').value.trim(), prox = $m('co-proximo').value || null;
  if (!fecha) return fallo('Indica la fecha.');
  if (fecha > vetHoy()) return fallo('La fecha de la consulta no puede ser futura.');
  if (!motivo) return fallo('Escribe el motivo de la consulta.');
  if (pesoRaw !== '' && !(Number(pesoRaw) > 0)) return fallo('El peso debe ser mayor que 0.');
  if (tempRaw !== '' && !(Number(tempRaw) >= 30 && Number(tempRaw) <= 45)) return fallo('La temperatura debe estar entre 30 y 45 °C.');
  if (prox && prox < fecha) return fallo('El próximo control no puede ser anterior a la consulta.');
  const v = id => $m(id).value.trim() || null;
  const vetC = leerVetCampoM('co');
  const payload = { auth_user_id: STATE.userId, mascota_id: MV.ficha.id, fecha, motivo, sintomas: v('co-sintomas'), diagnostico: v('co-diagnostico'), tratamiento: v('co-tratamiento'),
    peso: pesoRaw === '' ? null : Number(pesoRaw), temperatura: tempRaw === '' ? null : Number(tempRaw), observaciones: v('co-obs'), veterinario: vetC.nombre, veterinario_id: vetC.id, proximo_control: prox };
  const btn = $m('co-btn-guardar'); btn.disabled = true;
  try {
    const { data: nueva, error } = await sb.from('vet_consultas').insert(payload).select('id').single();
    if (error) throw error;
    if (MV.citaActiva && nueva?.id) {   // la cita queda atendida y ligada a esta consulta
      const { error: eCita } = await sb.from('vet_citas').update({ estado: 'atendida', consulta_id: nueva.id }).eq('id', MV.citaActiva.id).eq('auth_user_id', STATE.userId);
      if (!eCita) MV.citaActiva = null;
    }
    if (payload.peso) {   // el peso de la consulta pasa a ser el peso actual de la mascota
      const { error: e2 } = await sb.from('vet_mascotas').update({ peso_actual: payload.peso }).eq('id', MV.ficha.id).eq('auth_user_id', STATE.userId);
      if (!e2) { MV.ficha.peso_actual = payload.peso; pintarCabeceraFicha(); }
    }
    showToast('Consulta guardada.'); closeModal('modal-consulta');
    await cargarDetalleFicha(); cargarMascotas();
  } catch (e) { console.error('guardarConsulta:', e); fallo('No se pudo guardar la consulta. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}
async function eliminarConsulta(id) {
  if (!confirm('¿Eliminar esta consulta del historial? No se puede deshacer.')) return;
  try {
    const { error } = await sb.from('vet_consultas').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Consulta eliminada.'); await cargarDetalleFicha(); cargarMascotas();
  } catch (e) { console.error('eliminarConsulta:', e); showToast('No se pudo eliminar.', 'error'); }
}

/* ---------- Vacuna / desparasitacion ---------- */
function abrirVacuna() {
  const m = MV.ficha, protos = vetProtocolosDe(m.especie);
  const selP = $m('va-protocolo');
  selP.innerHTML = '<option value="">— Escribir otra —</option>' + protos.map((p, i) => `<option value="${i}">${esc(p.nombre)} (cada ${p.dias >= 365 ? Math.round(p.dias / 365) + ' año' : p.dias + ' días'})</option>`).join('');
  const selT = $m('va-tipo');
  if (!selT.options.length) Object.entries(VET_TIPOS_REGISTRO).forEach(([k, v]) => selT.add(new Option(`${v.e} ${v.n}`, k)));
  selT.value = 'vacuna'; $m('va-nombre').value = ''; $m('va-fecha').value = vetHoy();
  const pr = $m('va-proxima'); pr.value = ''; pr.dataset.manual = '';
  $m('va-lote').value = ''; $m('va-obs').value = ''; $m('va-error').textContent = '';
  pintarVetCampoM('va', null, '');
  openModal('modal-vacuna');
}
function cerrarVacuna() { closeModal('modal-vacuna'); }
function aplicarProtocolo() {
  const i = $m('va-protocolo').value;
  if (i === '') return;
  const p = vetProtocolosDe(MV.ficha.especie)[Number(i)];
  if (!p) return;
  $m('va-tipo').value = p.tipo; $m('va-nombre').value = p.nombre;
  $m('va-proxima').dataset.manual = ''; recalcularProxima();
}
// El refuerzo se calcula solo (fecha + intervalo del protocolo) mientras no se haya escrito a mano.
function recalcularProxima() {
  const i = $m('va-protocolo').value, pr = $m('va-proxima'), fecha = $m('va-fecha').value;
  if (i === '' || !fecha || pr.dataset.manual === '1') return;
  const p = vetProtocolosDe(MV.ficha.especie)[Number(i)];
  if (p) pr.value = vetSumarDias(fecha, p.dias);
}
async function guardarVacuna() {
  const err = $m('va-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const nombre = $m('va-nombre').value.trim(), fecha = $m('va-fecha').value, prox = $m('va-proxima').value || null;
  if (!nombre) return fallo('Escribe el nombre de la vacuna o desparasitación.');
  if (!fecha) return fallo('Indica la fecha de aplicación.');
  if (fecha > vetHoy()) return fallo('La fecha de aplicación no puede ser futura.');
  if (prox && prox < fecha) return fallo('El refuerzo no puede ser anterior a la aplicación.');
  const v = id => $m(id).value.trim() || null;
  const vetV = leerVetCampoM('va');
  const payload = { auth_user_id: STATE.userId, mascota_id: MV.ficha.id, tipo: $m('va-tipo').value, nombre, fecha_aplicacion: fecha, proxima_dosis: prox, lote: v('va-lote'), veterinario: vetV.nombre, veterinario_id: vetV.id, observaciones: v('va-obs') };
  const btn = $m('va-btn-guardar'); btn.disabled = true;
  try {
    const { error } = await sb.from('vet_vacunas').insert(payload);
    if (error) throw error;
    showToast('Registro guardado.'); closeModal('modal-vacuna');
    await cargarDetalleFicha(); cargarMascotas();
  } catch (e) { console.error('guardarVacuna:', e); fallo('No se pudo guardar. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}
async function eliminarVacuna(id) {
  if (!confirm('¿Eliminar este registro del carnet? No se puede deshacer.')) return;
  try {
    const { error } = await sb.from('vet_vacunas').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Registro eliminado.'); await cargarDetalleFicha(); cargarMascotas();
  } catch (e) { console.error('eliminarVacuna:', e); showToast('No se pudo eliminar.', 'error'); }
}

/* ---------- Archivar / eliminar mascota ---------- */
async function alternarArchivada() {
  const m = MV.ficha; if (!m) return;
  try {
    const { error } = await sb.from('vet_mascotas').update({ activo: !m.activo }).eq('id', m.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast(m.activo ? 'Mascota archivada: ya no genera recordatorios.' : 'Mascota reactivada.');
    await cargarMascotas(); MV.ficha = MV.mascotas.find(x => x.id === m.id) || m; pintarCabeceraFicha();
  } catch (e) { console.error('alternarArchivada:', e); showToast('No se pudo cambiar el estado.', 'error'); }
}
async function eliminarMascota() {
  const m = MV.ficha; if (!m) return;
  if (MV.consultas.length || MV.vacunas.length) { showToast('Esta mascota tiene historial: archívala en vez de eliminarla, así se conserva.', 'error'); return; }
  if (!confirm(`¿Eliminar a ${m.nombre}? No se puede deshacer.`)) return;
  try {
    const { error } = await sb.from('vet_mascotas').delete().eq('id', m.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Mascota eliminada.'); cerrarFicha(); await cargarMascotas();
  } catch (e) { console.error('eliminarMascota:', e); showToast('No se pudo eliminar.', 'error'); }
}


/* =====================================================
   FASE 2 -- equipo veterinario, cuenta de la visita (cobro) y recetas
===================================================== */
// Campo de veterinario: texto libre (sin equipo) / fijo (1 veterinario) / selector (varios).
function pintarVetCampoM(pref, idPref, textoPrevio) {
  const modo = vetModoEquipo(MV.equipo), txt = $m(pref + '-vet'), sel = $m(pref + '-vet-sel'), fijo = $m(pref + '-vet-fijo');
  txt.style.display = modo === 'libre' ? '' : 'none'; sel.style.display = modo === 'varios' ? '' : 'none'; fijo.style.display = modo === 'unico' ? '' : 'none';
  if (modo === 'libre') txt.value = textoPrevio || '';
  if (modo === 'unico') fijo.textContent = '👨‍⚕️ ' + MV.equipo[0].nombre + ' (asignado automáticamente)';
  if (modo === 'varios') {
    sel.innerHTML = '<option value="">— Sin asignar —</option>' + MV.equipo.map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join('');
    sel.value = idPref || '';
  }
}
function leerVetCampoM(pref) { return vetResolverVeterinario(MV.equipo, $m(pref + '-vet-sel').value, $m(pref + '-vet').value); }

/* ---------- Venir desde la Agenda o desde un enlace ---------- */
async function procesarParametrosURL() {
  try {
    const q = new URLSearchParams(window.location.search);
    const citaId = q.get('cita'), fichaId = q.get('ficha');
    if (citaId) {
      const { data: cita } = await sb.from('vet_citas').select('*').eq('id', citaId).eq('auth_user_id', STATE.userId).maybeSingle();
      if (cita && cita.estado !== 'atendida' && cita.estado !== 'cancelada' && MV.mascotas.some(m => m.id === cita.mascota_id)) {
        MV.citaActiva = cita;
        await abrirFicha(cita.mascota_id);
        MV.citaActiva = cita;                       // (abrirFicha no la borra, pero se asegura)
        abrirConsulta();
        return;
      }
      showToast('Esa cita ya no está disponible para atender.', 'warning');
    }
    if (fichaId && MV.mascotas.some(m => m.id === fichaId)) await abrirFicha(fichaId);
  } catch (e) { console.warn('procesarParametrosURL:', e); }
}

/* ---------- Cuenta de la visita (cargos) ---------- */
function abrirCargo(consultaId) {
  MV.consultaCtx = consultaId; MV.prodCargo = null;
  $m('cg-buscar').value = ''; $m('cg-resultados').style.display = 'none'; $m('cg-elegido').style.display = 'none';
  $m('cg-cantidad').value = '1'; $m('cg-error').textContent = '';
  openModal('modal-cargo');
}
function cerrarCargo() { closeModal('modal-cargo'); }
function elegirProductoCargo(id, nombre) {
  MV.prodCargo = { id, nombre };
  $m('cg-resultados').style.display = 'none'; $m('cg-buscar').value = '';
  const el = $m('cg-elegido'); el.textContent = '✔ ' + nombre; el.style.display = '';
}
let _timerCargo = null;
function buscarProductoCargo(q) {
  clearTimeout(_timerCargo);
  const cont = $m('cg-resultados'); q = (q || '').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _timerCargo = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('productos').select('id, nombre, precio, tipo')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .or('es_sustancia_controlada.is.null,es_sustancia_controlada.eq.false')   // las controladas se venden desde su propio modulo
        .ilike('nombre', `%${q}%`).order('nombre').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length)
        ? data.map(p => `<div class="vt-resultado" data-id="${p.id}" data-n="${esc(p.nombre)}">${p.tipo === 'servicio' ? '🛎️' : '📦'} ${esc(p.nombre)} <span style="color:var(--text-muted)">· ${esc(fmt(p.precio || 0))}</span></div>`).join('')
        : '<div class="vt-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados</div>';
      cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => elegirProductoCargo(el.dataset.id, el.dataset.n)));
      cont.style.display = '';
    } catch (e) { console.error('buscarProductoCargo:', e); }
  }, 250);
}
async function guardarCargo() {
  const err = $m('cg-error'); err.textContent = '';
  const cant = Number($m('cg-cantidad').value);
  if (!MV.prodCargo) { err.textContent = 'Elige el servicio o producto.'; return; }
  if (!(cant > 0)) { err.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  const btn = $m('cg-btn-guardar'); btn.disabled = true;
  try {
    const { error } = await sb.from('vet_cargos').insert({ auth_user_id: STATE.userId, consulta_id: MV.consultaCtx, producto_id: MV.prodCargo.id, descripcion: MV.prodCargo.nombre, cantidad: cant });
    if (error) throw error;
    showToast('Agregado a la cuenta.'); closeModal('modal-cargo'); await cargarDetalleFicha();
  } catch (e) { console.error('guardarCargo:', e); err.textContent = 'No se pudo agregar. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}
async function eliminarCargo(id) {
  try {
    const { error } = await sb.from('vet_cargos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    await cargarDetalleFicha();
  } catch (e) { console.error('eliminarCargo:', e); showToast('No se pudo quitar.', 'error'); }
}
// Cobrar = abrir Ventas con el dueno y los articulos ya cargados. La venta queda ligada a la consulta.
function cobrarConsulta(consultaId) {
  const m = MV.ficha, cargos = (MV.cargos[consultaId] || []).filter(x => x.producto_id);
  if (!m || !m.cliente_id) { showToast('Esta mascota no tiene dueño registrado: edítala y elige su dueño.', 'error'); return; }
  if (!cargos.length) { showToast('La cuenta está vacía.', 'error'); return; }
  sessionStorage.setItem('n360_vet_cobro', JSON.stringify({ consultaId, clienteId: m.cliente_id, mascota: m.nombre, items: cargos.map(x => ({ producto_id: x.producto_id, cantidad: Number(x.cantidad) })) }));
  window.location.href = 'ventas.html';
}

/* ---------- Receta con dosis por peso ---------- */
function abrirReceta(consultaId) {
  MV.consultaCtx = consultaId;
  const c = MV.consultas.find(x => x.id === consultaId);
  ['rx-med', 'rx-dosis', 'rx-conc', 'rx-cant', 'rx-dias', 'rx-indic'].forEach(i => { $m(i).value = ''; });
  $m('rx-cant').dataset.manual = ''; $m('rx-unidad').value = 'mg/ml'; $m('rx-frec').value = '12'; $m('rx-via').value = '';
  $m('rx-peso').value = c?.peso || MV.ficha.peso_actual || '';
  $m('rx-error').textContent = ''; $m('rx-calc').style.display = 'none';
  $m('rx-titulo').textContent = `📝 Receta — ${MV.ficha.nombre}`;
  renderRecetaLista(); openModal('modal-receta');
}
function cerrarReceta() { closeModal('modal-receta'); cargarDetalleFicha(); }
function renderRecetaLista() {
  const items = MV.recetas[MV.consultaCtx] || [];
  $m('rx-lista').innerHTML = items.length
    ? items.map(r => { const t = vetTotalADispensar(r.cantidad_por_toma, r.frecuencia_horas, r.duracion_dias);
        return `<div class="vt-item"><div class="vt-item-cab"><div><div class="vt-item-tit">${esc(r.medicamento)}</div><div class="vt-item-fecha">${esc(vetTextoPosologia(r))}</div></div>
          <button class="btn-accion-tabla btn-ghost" onclick="eliminarRecetaItem('${r.id}')">🗑️</button></div>
          ${t ? `<p><b>Total a dispensar:</b> ${esc(vetFormatoNumero(t))} ${esc(r.unidad_toma || '')}</p>` : ''}${r.indicaciones ? `<p>${esc(r.indicaciones)}</p>` : ''}</div>`; }).join('')
    : '<p class="vt-sub">Todavía no hay medicamentos en esta receta.</p>';
}
// Calcula en vivo: mg totales = peso x dosis, y cuanto dar segun la concentracion.
function recalcularDosis() {
  const r = vetCalcularDosis({ pesoKg: $m('rx-peso').value, dosisMgKg: $m('rx-dosis').value, concentracion: $m('rx-conc').value, unidad: $m('rx-unidad').value });
  const box = $m('rx-calc');
  if (!r) { box.style.display = 'none'; return; }
  box.style.display = '';
  box.textContent = `${vetFormatoNumero(r.mgTotal)} mg en total → dar ${vetFormatoNumero(r.cantidad)} ${r.unidadTexto} por toma${r.redondeada ? ` (exacto: ${vetFormatoNumero(r.exacta)}, redondeado a cuartos)` : ''}`;
  const cant = $m('rx-cant');
  if (cant.dataset.manual !== '1') cant.value = r.cantidad;     // se rellena solo mientras no se haya escrito a mano
}
async function guardarRecetaItem() {
  const err = $m('rx-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const med = $m('rx-med').value.trim(), cantRaw = $m('rx-cant').value.trim(), indic = $m('rx-indic').value.trim();
  if (!med) return fallo('Escribe el nombre del medicamento.');
  if (cantRaw === '' && !indic) return fallo('Indica la cantidad por toma o escribe las indicaciones.');
  if (cantRaw !== '' && !(Number(cantRaw) > 0)) return fallo('La cantidad por toma debe ser mayor que 0.');
  const num = id => { const x = $m(id).value.trim(); return x === '' ? null : Number(x); };
  const peso = num('rx-peso'), dosis = num('rx-dosis'), conc = num('rx-conc'), dias = num('rx-dias');
  if (peso !== null && !(peso > 0)) return fallo('El peso debe ser mayor que 0.');
  if (dosis !== null && !(dosis > 0)) return fallo('La dosis debe ser mayor que 0.');
  if (conc !== null && !(conc > 0)) return fallo('La concentración debe ser mayor que 0.');
  if (dias !== null && (!Number.isInteger(dias) || dias < 1 || dias > 365)) return fallo('Los días deben ser un número entero entre 1 y 365.');
  const unidadConc = $m('rx-unidad').value;
  const payload = { auth_user_id: STATE.userId, consulta_id: MV.consultaCtx, medicamento: med, peso_kg: peso, dosis_mg_kg: dosis, concentracion: conc, unidad_conc: conc !== null ? unidadConc : null,
    cantidad_por_toma: cantRaw === '' ? null : Number(cantRaw), unidad_toma: cantRaw === '' ? null : (unidadConc === 'mg/tableta' ? (Number(cantRaw) === 1 ? 'tableta' : 'tabletas') : 'ml'),
    frecuencia_horas: num('rx-frec'), duracion_dias: dias, via: $m('rx-via').value || null, indicaciones: indic || null };
  const btn = $m('rx-btn-guardar'); btn.disabled = true;
  try {
    const { error } = await sb.from('vet_recetas_items').insert(payload);
    if (error) throw error;
    showToast('Medicamento agregado a la receta.');
    const { data } = await sb.from('vet_recetas_items').select('*').eq('auth_user_id', STATE.userId).eq('consulta_id', MV.consultaCtx).order('created_at');
    MV.recetas[MV.consultaCtx] = data || []; renderRecetaLista();
    ['rx-med', 'rx-dosis', 'rx-conc', 'rx-cant', 'rx-dias', 'rx-indic'].forEach(i => { $m(i).value = ''; }); $m('rx-cant').dataset.manual = ''; $m('rx-calc').style.display = 'none';
  } catch (e) { console.error('guardarRecetaItem:', e); fallo('No se pudo guardar. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}
async function eliminarRecetaItem(id) {
  try {
    const { error } = await sb.from('vet_recetas_items').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    MV.recetas[MV.consultaCtx] = (MV.recetas[MV.consultaCtx] || []).filter(x => x.id !== id); renderRecetaLista();
  } catch (e) { console.error('eliminarRecetaItem:', e); showToast('No se pudo quitar.', 'error'); }
}
function imprimirReceta() {
  const items = MV.recetas[MV.consultaCtx] || [], c = MV.consultas.find(x => x.id === MV.consultaCtx), m = MV.ficha;
  if (!items.length) { showToast('Agrega al menos un medicamento para imprimir.', 'error'); return; }
  const esp = VET_ESPECIES[m.especie] || VET_ESPECIES.otro, d = duenoDe(m);
  const html = vetHtmlReceta({ negocio: STATE.empresaConfig?.nombre_comercial, fecha: c?.fecha || vetHoy(), mascota: m.nombre, especie: esp.n, raza: m.raza, edad: vetEdad(m.fecha_nacimiento), peso: c?.peso || m.peso_actual, dueno: d.nombre, veterinario: c?.veterinario, items });
  const w = window.open('', '_blank');
  if (!w) { showToast('Tu navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.', 'error'); return; }
  w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}


/* ---------- Certificados (se imprimen; "Guardar como PDF" desde el dialogo de impresion) ---------- */
function datosCertificado() {
  const m = MV.ficha, esp = VET_ESPECIES[m.especie] || VET_ESPECIES.otro, d = duenoDe(m);
  // Firma: con UN veterinario, el suyo; con varios, quien atendio la consulta mas reciente (o el de la ultima vacuna).
  const vet = vetModoEquipo(MV.equipo) === 'unico' ? MV.equipo[0].nombre : (MV.consultas.find(c => c.veterinario)?.veterinario || MV.vacunas.find(v => v.veterinario)?.veterinario || '');
  return { negocio: STATE.empresaConfig?.nombre_comercial, fecha: vetHoy(), mascota: m.nombre, especie: esp.n, raza: m.raza, sexo: m.sexo === 'macho' ? 'Macho' : m.sexo === 'hembra' ? 'Hembra' : '', edad: vetEdad(m.fecha_nacimiento), peso: m.peso_actual, microchip: m.microchip, dueno: d.nombre, veterinario: vet };
}
function imprimirCertificadoVacunas() {
  if (!MV.ficha) return;
  if (!MV.vacunas.length) { showToast('Esta mascota todavía no tiene vacunas registradas.', 'error'); return; }
  if (!vetImprimirHtml(vetHtmlCertificadoVacunas({ ...datosCertificado(), vacunas: MV.vacunas }))) showToast('Tu navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.', 'error');
}
function imprimirCertificadoSalud() {
  if (!MV.ficha) return;
  if (!vetImprimirHtml(vetHtmlCertificadoSalud(datosCertificado()))) showToast('Tu navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.', 'error');
}
