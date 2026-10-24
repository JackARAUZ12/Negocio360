/* =====================================================
   CLINICA-EQUIPO.JS — NEGOCIO360 · Módulo Clínica
   Equipo y seguridad: personal (médicos, recepción,
   administración) con su PIN, consultorios, especialidades
   de la clínica y bitácora de accesos al expediente.
   Administrar personal y ver la bitácora exige el código de
   administrador de la cuenta (o una sesión médica de rol
   administración): lo verifica el servidor.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = { userId: null, empresaConfig: {}, currentUser: {} };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
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
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display='none'; el.classList.remove('modal-open'); if (!document.querySelector('.modal-overlay.modal-open')) document.body.style.overflow=''; } }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.remove('show'), 3500);
}
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) { const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = data.nombre_comercial || data.nombre_negocio || 'Mi negocio'; }
    return data;
  } catch (e) { return null; }
}
async function loadUserProfile(userId) {
  try { const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle(); STATE.currentUser = data || {}; return data; }
  catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hAv = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name || 'U')[0].toUpperCase();
}

/* =====================================================
   ESTADO
===================================================== */
const EQ = { personal: [], consultorios: [], editId: null, editConsultorio: null, codigoAdmin: null, codigoHasta: 0, pidiendo: null };
const $e = id => document.getElementById(id);
const ROLES = { medico: { n: 'Médico', clase: 'azul' }, recepcion: { n: 'Recepción', clase: 'gris' }, admin: { n: 'Administración clínica', clase: 'morado' } };

async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;
    await loadEmpresaConfig(user.id);
    if (STATE.empresaConfig?.usa_modulo_clinica !== true) { window.location.href = 'dashboard.html'; return; }
    const profile = await loadUserProfile(user.id);
    renderUserInfo(profile, user.email);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    ClinicaSesion.iniciar(user.id, {});
    await ClinicaSesion.comprobar();
    const hoy = vetHoy();
    $e('bi-desde').value = vetSumarDias(hoy, -7); $e('bi-hasta').value = hoy;
    await cargar();
    cambiarTab('personal');
  } catch (e) {
    console.error('init clinica-equipo:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

function cambiarTab(tab) {
  ['personal', 'consultorios', 'especialidades', 'bitacora', 'pin'].forEach(t => { $e('eq-tab-' + t).classList.toggle('activa', t === tab); $e('eq-panel-' + t).style.display = t === tab ? '' : 'none'; });
  if (tab === 'especialidades') pintarEspecialidades();
  if (tab === 'pin') pintarMiPin();
}

async function cargar() {
  const [p, k] = await Promise.all([
    sb.from('clinica_personal').select('*').eq('auth_user_id', STATE.userId).order('activo', { ascending: false }).order('nombre'),
    sb.from('clinica_consultorios').select('*').eq('auth_user_id', STATE.userId).order('activo', { ascending: false }).order('nombre'),
  ]);
  EQ.personal = p.data || []; EQ.consultorios = k.data || [];
  pintarPersonal(); pintarConsultorios();
}

/* ---------- Autorización de administrador ---------- */
// Con sesión médica de administración se usa esa; si no, se pide el código de administrador
// (se recuerda solo en esta pantalla y solo 10 minutos; el servidor lo verifica cada vez).
async function autorizacion() {
  const s = ClinicaSesion.leer();
  if (s && s.rol === 'admin') return { token: s.token };
  if (EQ.codigoAdmin && Date.now() < EQ.codigoHasta) return { admin_pin: EQ.codigoAdmin };
  $e('ac-codigo').value = ''; $e('ac-error').textContent = '';
  openModal('modal-admin'); setTimeout(() => $e('ac-codigo').focus(), 50);
  return new Promise(res => { EQ.pidiendo = res; });
}
function respuestaAdmin(ok) {
  const res = EQ.pidiendo; EQ.pidiendo = null;
  if (!ok) { closeModal('modal-admin'); res && res(null); return; }
  const c = $e('ac-codigo').value.trim();
  if (!/^[0-9]{4,12}$/.test(c)) { $e('ac-error').textContent = 'El código tiene de 4 a 12 números.'; EQ.pidiendo = res; return; }
  EQ.codigoAdmin = c; EQ.codigoHasta = Date.now() + 10 * 60 * 1000;
  closeModal('modal-admin'); res && res({ admin_pin: c });
}
// Si el servidor rechazó el código, se olvida para volver a pedirlo.
function revisarRechazo(r) { if (r && (r.motivo === 'incorrecto' || r.motivo === 'bloqueado' || r.motivo === 'formato' || r.motivo === 'sin_permiso')) { EQ.codigoAdmin = null; } }

/* ---------- Personal ---------- */
function pintarPersonal() {
  const cont = $e('eq-personal-lista');
  if (!EQ.personal.length) { cont.innerHTML = '<div class="cl-info" style="grid-column:1/-1">Todavía no hay personal. Agrega a los médicos con "+ Agregar persona". Cada médico tendrá su PIN para abrir expedientes.</div>'; return; }
  const cons = id => EQ.consultorios.find(k => k.id === id)?.nombre;
  cont.innerHTML = EQ.personal.map(p => { const r = ROLES[p.rol] || ROLES.recepcion;
    return `<div class="cl-card" tabindex="0" role="button" onclick="abrirPersona('${p.id}')" onkeydown="if(event.key==='Enter')abrirPersona('${p.id}')" style="${p.activo ? '' : 'opacity:.6'}">
      <div class="cl-fila"><div class="cl-avatar">${esc((p.nombre || '?').trim().charAt(0).toUpperCase())}</div>
        <div style="min-width:0"><div class="cl-nombre">${esc(p.nombre)}</div>
          <div><span class="cl-badge cl-badge-${r.clase}">${esc(r.n)}</span>${p.activo ? '' : ' <span class="cl-badge cl-badge-gris">Inactivo</span>'}${p.rol !== 'recepcion' ? (p.pin_configurado ? ' <span class="cl-badge cl-badge-verde">🔑 PIN</span>' : ' <span class="cl-badge cl-badge-rojo">Sin PIN</span>') : ''}</div>
          <div class="cl-sub">${[p.especialidad, p.registro_profesional && 'Cód. ' + p.registro_profesional, cons(p.consultorio_id) && '🚪 ' + cons(p.consultorio_id), p.atiende ? 'Atiende pacientes' : ''].filter(Boolean).map(esc).join(' · ')}</div></div></div></div>`; }).join('');
}
function abrirPersona(id) {
  const p = id ? EQ.personal.find(x => x.id === id) : null;
  EQ.editId = p ? p.id : null;
  $e('pe-titulo').textContent = p ? '✏️ Editar persona' : '👤 Agregar persona';
  $e('pe-nombre').value = p?.nombre || ''; $e('pe-rol').value = p?.rol || 'medico';
  $e('pe-atiende').checked = p ? !!p.atiende : true;
  const selE = $e('pe-especialidad');
  if (selE.options.length <= 1) Object.entries(CLINICA_ESPECIALIDADES).forEach(([k, v]) => selE.add(new Option(`${v.e} ${v.n}`, v.n)));
  selE.value = p?.especialidad && [...selE.options].some(o => o.value === p.especialidad) ? p.especialidad : '';
  $e('pe-registro').value = p?.registro_profesional || ''; $e('pe-telefono').value = p?.telefono || '';
  $e('pe-consultorio').innerHTML = '<option value="">— Ninguno —</option>' + EQ.consultorios.filter(k => k.activo || k.id === p?.consultorio_id).map(k => `<option value="${esc(k.id)}">${esc(k.nombre)}</option>`).join('');
  $e('pe-consultorio').value = p?.consultorio_id || '';
  $e('pe-pin').value = ''; $e('pe-pin2').value = '';
  $e('pe-pin-ayuda').textContent = p?.pin_configurado ? 'Déjalo vacío para no cambiarlo. Si lo cambias, se cierran sus sesiones abiertas.' : 'De 4 a 8 números. Solo esta persona debe conocerlo.';
  $e('pe-activo').checked = p ? !!p.activo : true; $e('pe-activo-wrap').style.display = p ? '' : 'none';
  $e('pe-error').textContent = '';
  alCambiarRol();
  openModal('modal-persona');
}
function alCambiarRol() {
  const rol = $e('pe-rol').value;
  $e('pe-pin-wrap').style.display = rol === 'recepcion' ? 'none' : '';
  $e('pe-rol-ayuda').textContent = rol === 'medico' ? 'Ve y escribe expedientes con su PIN.'
    : rol === 'admin' ? 'Todo lo del médico, más anular notas de otros, administrar el equipo y ver la bitácora.'
    : 'Agenda, sala de espera y cobro. No puede ver expedientes ni notas clínicas.';
  if (!EQ.editId) $e('pe-atiende').checked = rol === 'medico';
}
async function guardarPersona() {
  const err = $e('pe-error'); err.textContent = '';
  const rol = $e('pe-rol').value, pin = $e('pe-pin').value.trim(), pin2 = $e('pe-pin2').value.trim();
  const nombre = $e('pe-nombre').value.trim();
  const previo = EQ.editId ? EQ.personal.find(x => x.id === EQ.editId) : null;
  if (!nombre) return (err.textContent = 'Escribe el nombre.');
  if (rol !== 'recepcion') {
    if (pin || !previo?.pin_configurado) {
      if (!/^[0-9]{4,8}$/.test(pin)) return (err.textContent = 'El PIN debe tener de 4 a 8 números.');
      if (pin !== pin2) return (err.textContent = 'Los dos PIN no coinciden.');
      if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return (err.textContent = 'Ese PIN es muy fácil de adivinar. Elige otro.');
    }
  }
  const datos = { nombre, rol, atiende: $e('pe-atiende').checked, especialidad: $e('pe-especialidad').value || null, registro_profesional: $e('pe-registro').value.trim() || null,
    telefono: $e('pe-telefono').value.trim() || null, consultorio_id: $e('pe-consultorio').value || null, pin: rol !== 'recepcion' && pin ? pin : null };
  if (EQ.editId) datos.activo = $e('pe-activo').checked;
  const auth = await autorizacion();
  if (!auth) return;
  const btn = $e('pe-btn-guardar'); btn.disabled = true;
  try {
    const { data: r, error } = await sb.rpc('clinica_personal_guardar', { p_auth: auth, p_id: EQ.editId, p_datos: datos });
    if (error) throw error;
    if (!r || !r.ok) { revisarRechazo(r); err.textContent = clinicaTextoMotivo(r); return; }
    showToast(EQ.editId ? 'Datos actualizados.' : 'Persona agregada.'); closeModal('modal-persona'); await cargar();
  } catch (e) { console.error('guardarPersona:', e); err.textContent = 'No se pudo guardar. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}

/* ---------- Consultorios ---------- */
function pintarConsultorios() {
  const cont = $e('eq-consultorios-lista');
  cont.innerHTML = EQ.consultorios.length ? EQ.consultorios.map(k => `<div class="cl-item" style="${k.activo ? '' : 'opacity:.6'}"><div class="cl-item-cab">
      <div><div class="cl-item-tit">🚪 ${esc(k.nombre)}${k.activo ? '' : ' <span class="cl-badge cl-badge-gris">Inactivo</span>'}</div>${k.descripcion ? `<div class="cl-item-fecha">${esc(k.descripcion)}</div>` : ''}</div>
      <div class="cl-acciones" style="margin:0"><button class="btn-accion-tabla btn-ghost" onclick="abrirConsultorio('${k.id}')">✏️ Editar</button>
      <button class="btn-accion-tabla btn-ghost" onclick="alternarConsultorio('${k.id}')">${k.activo ? 'Desactivar' : 'Activar'}</button></div></div></div>`).join('')
    : '<div class="cl-info">Sin consultorios. Son opcionales: sirven para saber en qué sala atiende cada médico.</div>';
}
function abrirConsultorio(id) {
  const k = id ? EQ.consultorios.find(x => x.id === id) : null;
  EQ.editConsultorio = k ? k.id : null;
  $e('ko-titulo').textContent = k ? '✏️ Editar consultorio' : '🚪 Nuevo consultorio';
  $e('ko-nombre').value = k?.nombre || ''; $e('ko-descripcion').value = k?.descripcion || ''; $e('ko-error').textContent = '';
  openModal('modal-consultorio');
}
async function guardarConsultorio() {
  const nombre = $e('ko-nombre').value.trim();
  if (!nombre) { $e('ko-error').textContent = 'Escribe el nombre.'; return; }
  const payload = { nombre: nombre.slice(0, 60), descripcion: $e('ko-descripcion').value.trim().slice(0, 200) || null };
  try {
    const q = EQ.editConsultorio
      ? sb.from('clinica_consultorios').update(payload).eq('id', EQ.editConsultorio).eq('auth_user_id', STATE.userId)
      : sb.from('clinica_consultorios').insert({ ...payload, auth_user_id: STATE.userId });
    const { error } = await q; if (error) throw error;
    closeModal('modal-consultorio'); showToast('Consultorio guardado.'); await cargar();
  } catch (e) { console.error('guardarConsultorio:', e); $e('ko-error').textContent = 'No se pudo guardar.'; }
}
async function alternarConsultorio(id) {
  const k = EQ.consultorios.find(x => x.id === id); if (!k) return;
  try { const { error } = await sb.from('clinica_consultorios').update({ activo: !k.activo }).eq('id', id).eq('auth_user_id', STATE.userId); if (error) throw error; await cargar(); }
  catch (e) { console.error('alternarConsultorio:', e); showToast('No se pudo cambiar.', 'error'); }
}

/* ---------- Especialidades de la clínica ---------- */
function pintarEspecialidades() {
  const cfg = Array.isArray(STATE.empresaConfig.clinica_especialidades) ? STATE.empresaConfig.clinica_especialidades : [];
  const todas = !cfg.length || cfg.includes('multiespecialidad');
  $e('es-todas').checked = todas;
  $e('es-lista').innerHTML = Object.entries(CLINICA_ESPECIALIDADES).map(([k, v]) =>
    `<label class="cl-check"><input type="checkbox" data-esp="${esc(k)}" ${todas || cfg.includes(k) ? 'checked' : ''} ${todas ? 'disabled' : ''}/> ${v.e} ${esc(v.n)}</label>`).join('');
  $e('es-error').textContent = '';
}
function alMarcarTodas() {
  const t = $e('es-todas').checked;
  document.querySelectorAll('#es-lista [data-esp]').forEach(el => { el.disabled = t; if (t) el.checked = true; });
}
async function guardarEspecialidades() {
  const todas = $e('es-todas').checked;
  const elegidas = [...document.querySelectorAll('#es-lista [data-esp]')].filter(el => el.checked).map(el => el.dataset.esp);
  if (!todas && !elegidas.length) { $e('es-error').textContent = 'Elige al menos una especialidad (o marca "Todas").'; return; }
  const valor = todas ? ['multiespecialidad'] : elegidas;
  try {
    const { error } = await sb.from('configuracion_empresa').update({ clinica_especialidades: valor }).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    STATE.empresaConfig.clinica_especialidades = valor;
    showToast('Especialidades guardadas.');
  } catch (e) { console.error('guardarEspecialidades:', e); $e('es-error').textContent = 'No se pudo guardar.'; }
}

/* ---------- Bitácora de accesos ---------- */
async function verBitacora() {
  const cont = $e('bi-lista');
  const desde = $e('bi-desde').value || null, hasta = $e('bi-hasta').value || null;
  if (desde && hasta && desde > hasta) { cont.innerHTML = '<p style="color:var(--danger,#dc2626)">La fecha "desde" no puede ser posterior a "hasta".</p>'; return; }
  const auth = await autorizacion();
  if (!auth) return;
  cont.innerHTML = '<p class="cl-sub">Cargando…</p>';
  try {
    const { data: r, error } = await sb.rpc('clinica_bitacora_ver', { p_auth: auth, p_desde: desde, p_hasta: hasta, p_paciente_id: null });
    if (error) throw error;
    if (!r || !r.ok) { revisarRechazo(r); cont.innerHTML = `<p style="color:var(--danger,#dc2626)">${esc(clinicaTextoMotivo(r))}</p>`; return; }
    const filas = r.filas || [];
    cont.innerHTML = filas.length ? filas.map(f => `<div class="cl-item"><div class="cl-item-cab"><div>
        <div class="cl-item-tit">${esc(CLINICA_ACCIONES_BITACORA[f.accion] || f.accion)}</div>
        <div class="cl-item-fecha">${esc(new Date(f.fecha).toLocaleString('es-NI', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(f.quien || '—')}</div></div>
        ${f.paciente ? `<span class="cl-sub">👤 ${esc(f.paciente)} · ${esc(f.expediente || '')}</span>` : ''}</div>
        ${f.detalle && !['abrir_expediente', 'cerrar_nota'].includes(f.accion) ? `<p class="cl-sub">${esc(f.detalle)}</p>` : ''}</div>`).join('')
      + (filas.length >= 500 ? '<p class="cl-sub">Se muestran los 500 más recientes: acorta las fechas para ver el resto.</p>' : '')
      : '<p class="cl-sub">No hay movimientos en esas fechas.</p>';
  } catch (e) { console.error('verBitacora:', e); cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la bitácora.</p>'; }
}

/* ---------- Mi PIN ---------- */
function pintarMiPin() {
  const sel = $e('mp-persona');
  const conPin = EQ.personal.filter(p => p.activo && p.rol !== 'recepcion' && p.pin_configurado);
  sel.innerHTML = '<option value="">— Elige tu nombre —</option>' + conPin.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('');
  const s = ClinicaSesion.leer(); if (s && conPin.some(p => p.id === s.personal_id)) sel.value = s.personal_id;
  ['mp-actual', 'mp-nuevo', 'mp-nuevo2'].forEach(i => { $e(i).value = ''; }); $e('mp-error').textContent = '';
}
async function cambiarMiPin() {
  const err = $e('mp-error'); err.textContent = '';
  const pid = $e('mp-persona').value, a = $e('mp-actual').value.trim(), n = $e('mp-nuevo').value.trim(), n2 = $e('mp-nuevo2').value.trim();
  if (!pid) return (err.textContent = 'Elige tu nombre.');
  if (!/^[0-9]{4,8}$/.test(n)) return (err.textContent = 'El PIN nuevo debe tener de 4 a 8 números.');
  if (n !== n2) return (err.textContent = 'Los dos PIN nuevos no coinciden.');
  if (/^(\d)\1+$/.test(n) || '0123456789'.includes(n) || '9876543210'.includes(n)) return (err.textContent = 'Ese PIN es muy fácil de adivinar. Elige otro.');
  try {
    const { data: r, error } = await sb.rpc('clinica_cambiar_pin', { p_personal_id: pid, p_pin_actual: a, p_pin_nuevo: n });
    if (error) throw error;
    if (!r || !r.ok) { err.textContent = clinicaTextoMotivo(r); return; }
    if (ClinicaSesion.leer()?.personal_id === pid) await ClinicaSesion.bloquear();
    showToast('PIN cambiado. Úsalo la próxima vez que entres.'); pintarMiPin();
  } catch (e) { console.error('cambiarMiPin:', e); err.textContent = 'No se pudo cambiar. Intenta de nuevo.'; }
}
