/* =====================================================
   CLINICA-EQUIPO.JS — NEGOCIO360 · Módulo Clínica
   Médicos y seguridad: qué USUARIOS del sistema
   (multiusuario) son médicos — entran al expediente con su
   mismo código de usuario —, su columna en la Agenda y sus
   honorarios; consultorios, especialidades de la clínica y
   bitácora de accesos al expediente.
   Marcar médicos y ver la bitácora exige el código de
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
const EQ = { personal: [], consultorios: [], usuarios: [], profesionales: [], empleados: [], editId: null, editConsultorio: null, codigoAdmin: null, codigoHasta: 0, pidiendo: null };
const $e = id => document.getElementById(id);
const ROLES = { medico: { n: 'Médico', clase: 'azul' }, admin: { n: 'Administración clínica', clase: 'morado' }, enfermeria: { n: 'Enfermería', clase: 'verde' }, recepcion: { n: 'Recepción (ya no se usa)', clase: 'gris' } };

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
  ['personal', 'consultorios', 'especialidades', 'bitacora'].forEach(t => { $e('eq-tab-' + t).classList.toggle('activa', t === tab); $e('eq-panel-' + t).style.display = t === tab ? '' : 'none'; });
  if (tab === 'especialidades') pintarEspecialidades();
}

// Usuarios del sistema (multiusuario): la misma lista que el menú de usuarios.
async function cargarUsuarios() {
  let { data, error } = await sb.rpc('listar_perfiles_del_grupo_v2');
  if (error) ({ data, error } = await sb.rpc('listar_perfiles_del_grupo'));
  if (error) throw error;
  return (data || []).filter(u => u.activo !== false).map(u => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, es_principal: !!u.es_principal }));
}
async function cargar() {
  EQ.demo = await ClinicaSesion.esDemo();
  let qp = sb.from('clinica_personal').select('*').eq('auth_user_id', STATE.userId);
  if (!EQ.demo) qp = qp.not('perfil_id', 'is', null);
  const [p, k, u, pr, em] = await Promise.all([
    qp.order('activo', { ascending: false }).order('nombre'),
    sb.from('clinica_consultorios').select('*').eq('auth_user_id', STATE.userId).order('activo', { ascending: false }).order('nombre'),
    cargarUsuarios().catch(e => { console.error('usuarios:', e); return []; }),
    sb.from('agenda_profesionales').select('id, nombre, activo, empleado_id').eq('auth_user_id', STATE.userId).order('orden').order('nombre'),
    sb.from('empleados').select('id, nombre, estado').eq('auth_user_id', STATE.userId).order('nombre'),
  ]);
  EQ.personal = p.data || []; EQ.consultorios = k.data || []; EQ.usuarios = u; EQ.profesionales = pr.data || []; EQ.empleados = em.data || [];
  pintarPersonal(); pintarConsultorios();
  const aviso = document.getElementById('eq-demo');
  if (aviso) aviso.style.display = EQ.demo ? '' : 'none';
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

/* ---------- Médicos (usuarios del sistema marcados como médicos) ---------- */
function pintarPersonal() {
  const cont = $e('eq-personal-lista');
  if (!EQ.personal.length) { cont.innerHTML = '<div class="cl-info" style="grid-column:1/-1">Todavía no hay médicos. Toca "➕ Nuevo médico" (o "Usar un usuario que ya existe" si ya tiene su usuario en el sistema).</div>'; return; }
  const cons = id => EQ.consultorios.find(k => k.id === id)?.nombre;
  const prof = id => EQ.profesionales.find(x => x.id === id)?.nombre;
  cont.innerHTML = EQ.personal.map(p => { const r = ROLES[p.rol] || ROLES.medico; const u = EQ.usuarios.find(x => x.id === p.perfil_id);
    return `<div class="cl-card" tabindex="0" role="button" onclick="abrirPersona('${p.id}')" onkeydown="if(event.key==='Enter')abrirPersona('${p.id}')" style="${p.activo ? '' : 'opacity:.6'}">
      <div class="cl-fila"><div class="cl-avatar">${esc(((u?.nombre || p.nombre) || '?').trim().charAt(0).toUpperCase())}</div>
        <div style="min-width:0"><div class="cl-nombre">${esc(u?.nombre || p.nombre)}</div>
          <div><span class="cl-badge cl-badge-${r.clase}">${esc(r.n)}</span>${p.activo ? '' : ' <span class="cl-badge cl-badge-gris">Sin acceso clínico</span>'}${u ? '' : EQ.demo && !p.perfil_id ? ' <span class="cl-badge cl-badge-azul">Médico de ejemplo (demo)</span>' : ' <span class="cl-badge cl-badge-rojo">El usuario ya no existe</span>'}</div>
          <div class="cl-sub">${[p.especialidad, p.registro_profesional && 'Cód. ' + p.registro_profesional,
            prof(p.agenda_profesional_id) ? '📅 Agenda: ' + prof(p.agenda_profesional_id) : 'Sin columna en la Agenda',
            p.honorario_tipo === 'porcentaje' && `Honorario ${Number(p.honorario_valor)}%`, p.honorario_tipo === 'monto' && `Honorario fijo ${Number(p.honorario_valor)}`, cons(p.consultorio_id) && '🚪 ' + cons(p.consultorio_id)].filter(Boolean).map(esc).join(' · ')}</div></div></div></div>`; }).join('');
}
function abrirPersona(id) {
  const p = id ? EQ.personal.find(x => x.id === id) : null;
  EQ.modoNuevo = false;
  $e('pe-nuevo-wrap').style.display = 'none'; $e('pe-usuario-wrap').style.display = ''; $e('pe-profesional-wrap').style.display = '';
  EQ.editId = p ? p.id : null;
  $e('pe-titulo').textContent = p ? '✏️ Editar médico' : '🩺 Marcar un usuario como médico';
  const libres = EQ.usuarios.filter(u => !EQ.personal.some(x => x.perfil_id === u.id));
  $e('pe-usuario').innerHTML = p ? `<option value="${esc(p.perfil_id)}">${esc(EQ.usuarios.find(u => u.id === p.perfil_id)?.nombre || p.nombre)}</option>`
    : (libres.length ? '<option value="">— Elige el usuario —</option>' : '<option value="">No hay usuarios libres</option>') + libres.map(u => `<option value="${esc(u.id)}">${esc(u.nombre)}${u.tipo === 'admin' ? ' (administrador)' : ''}</option>`).join('');
  $e('pe-usuario').disabled = !!p;
  $e('pe-usuario-ayuda').style.display = p ? 'none' : '';
  $e('pe-rol').value = ['admin', 'enfermeria'].includes(p?.rol) ? p.rol : 'medico';
  const selE = $e('pe-especialidad');
  if (selE.options.length <= 1) Object.entries(CLINICA_ESPECIALIDADES).forEach(([k, v]) => selE.add(new Option(`${v.e} ${v.n}`, v.n)));
  selE.value = p?.especialidad && [...selE.options].some(o => o.value === p.especialidad) ? p.especialidad : '';
  $e('pe-registro').value = p?.registro_profesional || '';
  const usados = new Set(EQ.personal.filter(x => x.id !== p?.id).map(x => x.agenda_profesional_id).filter(Boolean));
  $e('pe-profesional').innerHTML = '<option value="">— Ninguna —</option>' + EQ.profesionales.filter(x => !usados.has(x.id) && (x.activo || x.id === p?.agenda_profesional_id))
    .map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('');
  $e('pe-profesional').value = p?.agenda_profesional_id || '';
  $e('pe-consultorio').innerHTML = '<option value="">— Ninguno —</option>' + EQ.consultorios.filter(k => k.activo || k.id === p?.consultorio_id).map(k => `<option value="${esc(k.id)}">${esc(k.nombre)}</option>`).join('');
  $e('pe-consultorio').value = p?.consultorio_id || '';
  $e('pe-activo').checked = p ? !!p.activo : true; $e('pe-activo-wrap').style.display = p ? '' : 'none';
  $e('pe-hon-tipo').value = p?.honorario_tipo || 'ninguno'; $e('pe-hon-valor').value = p && p.honorario_tipo !== 'ninguno' ? Number(p.honorario_valor || 0) : '';
  $e('pe-empleado').innerHTML = '<option value="">— El del profesional de la Agenda —</option>' + EQ.empleados.filter(x => x.estado !== 'inactivo' || x.id === p?.empleado_id).map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('');
  $e('pe-empleado').value = p?.empleado_id || '';
  alCambiarHonorario(); alCambiarRol();
  $e('pe-error').textContent = '';
  openModal('modal-persona');
}
function alCambiarHonorario() {
  const t = $e('pe-hon-tipo').value;
  $e('pe-hon-valor-wrap').style.display = t === 'ninguno' ? 'none' : '';
  $e('pe-hon-valor-label').textContent = t === 'porcentaje' ? 'Porcentaje (%)' : 'Monto por consulta';
  $e('pe-hon-valor').max = t === 'porcentaje' ? '100' : '';
}
function alCambiarRol() {
  const rol = $e('pe-rol').value;
  $e('pe-rol-ayuda').textContent = rol === 'medico' ? 'Ve y escribe expedientes con su código de usuario.'
    : rol === 'enfermeria' ? 'Con su código escribe notas de enfermería y signos de los pacientes en observación u hospitalización, y ve sus alergias. No abre expedientes ni consultas.'
    : 'Todo lo del médico, más anular notas de otros, administrar médicos y ver la bitácora.';
  // Enfermería no tiene columna en la Agenda ni honorarios por consulta.
  document.querySelectorAll('.pe-solo-medico').forEach(el => { el.style.display = rol === 'enfermeria' ? 'none' : ''; });
  if (EQ.modoNuevo) $e('pe-profesional-wrap').style.display = 'none';      // en "Nuevo médico" la columna se crea sola
  if (rol === 'enfermeria') { $e('pe-profesional').value = ''; $e('pe-hon-tipo').value = 'ninguno'; alCambiarHonorario(); }
}
/* ---------- ➕ Nuevo médico: crea su usuario, su columna en la Agenda y su ficha, en una sola operación ----------
   (clinica_personal_nuevo: todo o nada). En una cuenta demo no se crea usuario ni se pide código. */
function abrirNuevoMedico() {
  abrirPersona(null);
  EQ.modoNuevo = true;
  $e('pe-titulo').textContent = '➕ Nuevo médico';
  $e('pe-nuevo-wrap').style.display = ''; $e('pe-usuario-wrap').style.display = 'none'; $e('pe-profesional-wrap').style.display = 'none';
  $e('pe-nombre').value = ''; $e('pe-codigo').value = ''; $e('pe-codigo2').value = ''; $e('pe-crear-col').checked = true;
  $e('pe-codigo-wrap').style.display = EQ.demo ? 'none' : ''; $e('pe-codigo-ayuda').textContent = EQ.demo
    ? 'Cuenta demo: queda como médico de ejemplo (para abrir expedientes se elige de la lista, sin código).'
    : 'Se crea su usuario del sistema: con este código abre expedientes y entra a sus pantallas de Clínica y la Agenda (si el multiusuario está activo).';
  alCambiarRol();
  setTimeout(() => $e('pe-nombre').focus(), 50);
}
const MOTIVOS_NUEVO = {
  nombre: 'Escribe el nombre completo (de 3 a 80 letras).', codigo: 'El código debe tener de 4 a 12 números.',
  nombre_repetido: 'Ya existe un usuario del sistema con ese nombre. Usa "Usar un usuario que ya existe" o cambia el nombre.',
  limite_perfiles: 'Llegaste al límite de usuarios de tu plan. Desactiva uno que ya no use o amplía tu plan.',
  honorario: 'Revisa los honorarios (el porcentaje no puede pasar de 100).', consultorio: 'Ese consultorio ya no existe.',
};
async function guardarNuevoMedico() {
  const err = $e('pe-error'); err.textContent = '';
  const nombre = $e('pe-nombre').value.trim(), rol = $e('pe-rol').value, c1 = $e('pe-codigo').value.trim(), c2 = $e('pe-codigo2').value.trim();
  if (nombre.length < 3) { err.textContent = MOTIVOS_NUEVO.nombre; $e('pe-nombre').focus(); return; }
  if (!EQ.demo) {
    if (!/^[0-9]{4,12}$/.test(c1)) { err.textContent = MOTIVOS_NUEVO.codigo; $e('pe-codigo').focus(); return; }
    if (c1 !== c2) { err.textContent = 'Los dos códigos no son iguales.'; $e('pe-codigo2').focus(); return; }
  }
  const htipo = $e('pe-hon-tipo').value, hval = Number($e('pe-hon-valor').value || 0);
  if (rol !== 'enfermeria' && htipo !== 'ninguno' && !(hval > 0)) return (err.textContent = 'Escribe el valor del honorario (mayor que 0).');
  if (htipo === 'porcentaje' && hval > 100) return (err.textContent = 'El porcentaje no puede pasar de 100.');
  const datos = { rol, especialidad: $e('pe-especialidad').value || null, registro_profesional: $e('pe-registro').value.trim() || null,
    consultorio_id: $e('pe-consultorio').value || null, honorario_tipo: htipo, honorario_valor: htipo === 'ninguno' ? 0 : hval, empleado_id: $e('pe-empleado').value || null };
  const auth = EQ.demo ? {} : await autorizacion();
  if (!auth) return;
  const btn = $e('pe-btn-guardar'); btn.disabled = true;
  try {
    const { data: r, error } = await sb.rpc('clinica_personal_nuevo', { p_auth: auth, p_nombre: nombre, p_codigo: EQ.demo ? null : c1, p_datos: datos, p_columna_agenda: rol !== 'enfermeria' && $e('pe-crear-col').checked });
    if (error) throw error;
    if (!r || !r.ok) { revisarRechazo(r); err.textContent = MOTIVOS_NUEVO[r && r.motivo] || clinicaTextoMotivo(r); return; }
    showToast(r.agenda_profesional_id ? `Listo: ${nombre} ya está en el equipo y tiene su columna en la Agenda.` : `Listo: ${nombre} ya está en el equipo.`);
    closeModal('modal-persona'); await cargar();
  } catch (e) { console.error('guardarNuevoMedico:', e); err.textContent = 'No se pudo crear. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}
async function guardarPersona() {
  if (EQ.modoNuevo) return guardarNuevoMedico();
  const err = $e('pe-error'); err.textContent = '';
  const perfil = $e('pe-usuario').value, rol = $e('pe-rol').value;
  if (!EQ.editId && !perfil) return (err.textContent = 'Elige el usuario del sistema.');
  const datos = { rol, especialidad: $e('pe-especialidad').value || null, registro_profesional: $e('pe-registro').value.trim() || null,
    consultorio_id: $e('pe-consultorio').value || null, agenda_profesional_id: $e('pe-profesional').value || null };
  if (!EQ.editId) datos.perfil_id = perfil;
  if (EQ.editId) datos.activo = $e('pe-activo').checked;
  const htipo = $e('pe-hon-tipo').value, hval = Number($e('pe-hon-valor').value || 0);
  if (htipo !== 'ninguno' && !(hval > 0)) return (err.textContent = 'Escribe el valor del honorario (mayor que 0).');
  if (htipo === 'porcentaje' && hval > 100) return (err.textContent = 'El porcentaje no puede pasar de 100.');
  Object.assign(datos, { honorario_tipo: htipo, honorario_valor: htipo === 'ninguno' ? 0 : hval, empleado_id: $e('pe-empleado').value || null });
  const auth = await autorizacion();
  if (!auth) return;
  const btn = $e('pe-btn-guardar'); btn.disabled = true;
  try {
    const { data: r, error } = await sb.rpc('clinica_personal_guardar', { p_auth: auth, p_id: EQ.editId, p_datos: datos });
    if (error) throw error;
    if (!r || !r.ok) { revisarRechazo(r); err.textContent = clinicaTextoMotivo(r); return; }
    showToast(EQ.editId ? 'Datos actualizados.' : 'Listo: ese usuario ya es médico.'); closeModal('modal-persona'); await cargar();
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
  document.querySelectorAll('#es-lista [data-esp]').forEach(el => el.addEventListener('change', pintarServiciosSugeridos));
  pintarServiciosSugeridos();
}
function alMarcarTodas() {
  const t = $e('es-todas').checked;
  document.querySelectorAll('#es-lista [data-esp]').forEach(el => { el.disabled = t; if (t) el.checked = true; });
  pintarServiciosSugeridos();
}

/* ---------- Servicios sugeridos por especialidad ----------
   Agrega al catálogo (productos, tipo servicio) los servicios típicos de las especialidades marcadas, con
   el precio que se escriba. Nunca cambia ni duplica lo que ya existe (se compara el nombre). */
const _sinAcentoEq = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function pintarServiciosSugeridos() {
  const cont = $e('es-servicios'); if (!cont) return;
  const marcadas = $e('es-todas').checked ? Object.keys(CLINICA_ESPECIALIDADES)
    : [...document.querySelectorAll('#es-lista [data-esp]')].filter(el => el.checked).map(el => el.dataset.esp);
  const grupos = marcadas.map(k => ({ k, lista: clinicaServiciosSugeridos(k) })).filter(g => g.lista.length);
  if (!grupos.length) { cont.innerHTML = '<p class="cl-sub">Marca una especialidad para ver sus servicios típicos.</p>'; $e('es-serv-btn').style.display = 'none'; return; }
  try {
    if (!EQ.catalogoServicios) {
      const { data, error } = await sb.from('productos').select('id, nombre').eq('auth_user_id', STATE.userId).eq('tipo', 'servicio');
      if (error) throw error;
      EQ.catalogoServicios = new Set((data || []).map(x => _sinAcentoEq(x.nombre)));
    }
  } catch (e) { console.error('servicios del catálogo:', e); cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo revisar tu catálogo.</p>'; return; }
  const vistos = new Set(); let nuevos = 0;
  cont.innerHTML = grupos.map(g => {
    const esp = CLINICA_ESPECIALIDADES[g.k];
    const filas = g.lista.filter(x => !vistos.has(_sinAcentoEq(x.n)) && vistos.add(_sinAcentoEq(x.n))).map(x => {
      const ya = EQ.catalogoServicios.has(_sinAcentoEq(x.n)); if (!ya) nuevos++;
      return `<div class="es-serv" style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed var(--border,#e5e7eb)">
        <label class="cl-check" style="flex:1;min-width:0;margin:0"><input type="checkbox" data-serv="${esc(x.n)}" ${ya ? 'disabled' : 'checked'}/> <span style="overflow-wrap:anywhere">${esc(x.n)}</span></label>
        ${ya ? '<span class="cl-badge cl-badge-verde" style="flex-shrink:0">✔ Ya está</span>'
          : `<input type="number" class="cl-in" data-precio="${esc(x.n)}" min="0" step="any" value="${esc(String(x.p))}" aria-label="Precio de ${esc(x.n)}" style="width:96px;flex-shrink:0"/>`}</div>`;
    }).join('');
    return filas ? `<div style="margin-bottom:10px"><div style="font-weight:800;font-size:13px;margin:6px 0">${esp.e} ${esc(esp.n)}</div>${filas}</div>` : '';
  }).join('');
  $e('es-serv-btn').style.display = nuevos ? '' : 'none';
  $e('es-serv-error').textContent = '';
}
async function agregarServiciosSugeridos() {
  const err = $e('es-serv-error'); err.textContent = '';
  const elegidos = [...document.querySelectorAll('#es-servicios [data-serv]')].filter(el => el.checked && !el.disabled).map(el => {
    const nombre = el.dataset.serv, inp = [...document.querySelectorAll('#es-servicios [data-precio]')].find(x => x.dataset.precio === nombre);
    return { nombre, precio: Number(inp && inp.value) };
  });
  if (!elegidos.length) { err.textContent = 'Marca al menos un servicio.'; return; }
  const malo = elegidos.find(x => !(x.precio >= 0) || x.precio > 10000000);
  if (malo) { err.textContent = `Revisa el precio de "${malo.nombre}".`; return; }
  const btn = $e('es-serv-btn'); btn.disabled = true;
  try {
    EQ.catalogoServicios = null;
    const { data, error: e1 } = await sb.from('productos').select('nombre').eq('auth_user_id', STATE.userId).eq('tipo', 'servicio');
    if (e1) throw e1;
    const ya = new Set((data || []).map(x => _sinAcentoEq(x.nombre)));
    const filas = elegidos.filter(x => !ya.has(_sinAcentoEq(x.nombre)))
      .map(x => ({ auth_user_id: STATE.userId, nombre: x.nombre.slice(0, 150), tipo: 'servicio', precio: Math.round(x.precio * 100) / 100, costo: 0, activo: true }));
    if (filas.length) { const { error } = await sb.from('productos').insert(filas); if (error) throw error; }
    showToast(filas.length ? `${filas.length} servicio${filas.length === 1 ? '' : 's'} agregado${filas.length === 1 ? '' : 's'} al catálogo.` : 'Esos servicios ya estaban en tu catálogo.');
    await pintarServiciosSugeridos();
  } catch (e) { console.error('agregarServiciosSugeridos:', e); err.textContent = 'No se pudieron agregar. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
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
