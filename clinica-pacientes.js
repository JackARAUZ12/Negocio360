/* =====================================================
   CLINICA-PACIENTES.JS — NEGOCIO360 · Módulo Clínica
   Pacientes (datos generales: los maneja recepción) y su
   EXPEDIENTE CLÍNICO (antecedentes, alergias, consultas),
   que solo entrega el servidor con la sesión médica (PIN).
   Notas: borrador -> "Cerrar y firmar" (ya no se modifica);
   después solo adendas fechadas o anulación con motivo.
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
const CP = { pacientes: [], filtrados: [], ficha: null, tab: 'exp', exp: null, citaActiva: null, editId: null, cliente: null,
  notaId: null, notaCtx: null, especialidades: [], medicos: [] };
const $p = id => document.getElementById(id);
const fechaCorta = ymd => { if (!ymd) return '—'; const p = vetPartes(ymd); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`; };
const fechaHora = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('es-NI', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };

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

    CP.especialidades = clinicaEspecialidadesActivas(STATE.empresaConfig.clinica_especialidades);
    ClinicaSesion.iniciar(user.id, { onCambio: alCambiarSesion });
    await ClinicaSesion.comprobar();
    await cargarPacientes();
    await procesarURL();
    mostrarTutorial(false);
  } catch (e) {
    console.error('init clinica-pacientes:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

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

/* ---------- Lista ---------- */
async function cargarPacientes() {
  try {
    const hoy = vetHoy();
    const [ps, citasHoy] = await Promise.all([
      traerTodo(() => sb.from('clinica_pacientes').select('*').eq('auth_user_id', STATE.userId).order('id')),
      sb.from('clinica_citas').select('id', { count: 'exact', head: true }).eq('auth_user_id', STATE.userId).eq('fecha', hoy).neq('estado', 'cancelada'),
    ]);
    CP.pacientes = ps;
    $p('cp-kpi-activos').textContent = ps.filter(p => p.activo).length;
    $p('cp-kpi-nuevos').textContent = ps.filter(p => String(p.created_at || '').slice(0, 7) === hoy.slice(0, 7)).length;
    $p('cp-kpi-citas').textContent = citasHoy.count ?? '—';
    filtrar();
  } catch (e) {
    console.error('cargarPacientes:', e);
    $p('cp-lista').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudieron cargar los pacientes.</p>';
  }
}
function filtrar() {
  const q = ($p('cp-buscar').value || '').trim().toLowerCase();
  const est = $p('cp-estado').value;
  CP.filtrados = CP.pacientes.filter(p => {
    if (est === 'activos' && !p.activo) return false;
    if (est === 'archivados' && p.activo) return false;
    if (!q) return true;
    return [clinicaNombrePaciente(p), p.cedula, p.telefono, p.numero_expediente].some(t => String(t || '').toLowerCase().includes(q));
  }).sort((a, b) => clinicaNombrePaciente(a).localeCompare(clinicaNombrePaciente(b), 'es'));
  render();
}
function render() {
  const cont = $p('cp-lista'), LIMITE = 200, lista = CP.filtrados;
  $p('cp-pie').textContent = lista.length > LIMITE ? `Mostrando ${LIMITE} de ${lista.length}: usa el buscador.` : `${lista.length} paciente${lista.length === 1 ? '' : 's'}`;
  if (!lista.length) {
    cont.innerHTML = `<div class="cl-info" style="grid-column:1/-1">${CP.pacientes.length ? 'No hay pacientes con ese filtro.' : 'Todavía no hay pacientes. Registra el primero con "+ Nuevo paciente".'}</div>`;
    return;
  }
  cont.innerHTML = lista.slice(0, LIMITE).map(p => `<div class="cl-card" tabindex="0" role="button" onclick="abrirFicha('${p.id}')" onkeydown="if(event.key==='Enter')abrirFicha('${p.id}')">
      <div class="cl-fila"><div class="cl-avatar">${esc((p.nombres || '?').trim().charAt(0).toUpperCase())}</div>
        <div style="min-width:0"><div class="cl-nombre">${esc(clinicaNombrePaciente(p))}${p.activo ? '' : ' <span class="cl-badge cl-badge-gris">Archivado</span>'}</div>
        <div class="cl-sub">${esc(p.numero_expediente || '')}${p.fecha_nacimiento ? ' · ' + esc(clinicaEdad(p.fecha_nacimiento)) : ''}${p.sexo ? ' · ' + (p.sexo === 'femenino' ? 'F' : 'M') : ''}</div>
        <div class="cl-sub">${p.telefono ? '📞 ' + esc(p.telefono) : 'Sin teléfono'}${p.cedula ? ' · 🪪 ' + esc(p.cedula) : ''}</div></div></div>
    </div>`).join('');
}

/* ---------- Paciente: crear / editar ---------- */
function abrirPaciente(id) {
  const p = id ? CP.pacientes.find(x => x.id === id) : null;
  CP.editId = p ? p.id : null;
  $p('pa-titulo').textContent = p ? '✏️ Editar paciente' : '👤 Nuevo paciente';
  const campos = ['nombres', 'apellidos', 'cedula', 'fecha_nacimiento', 'telefono', 'email', 'direccion', 'ocupacion', 'contacto_emergencia_nombre', 'contacto_emergencia_telefono', 'contacto_emergencia_parentesco', 'notas'];
  campos.forEach(k => { $p('pa-' + k).value = p?.[k] || ''; });
  $p('pa-sexo').value = p?.sexo || '';
  $p('pa-error').textContent = '';
  CP.cliente = p?.cliente_id ? { id: p.cliente_id } : null;
  pintarClienteVinculado();
  actualizarEdad();
  openModal('modal-paciente');
}
function actualizarEdad() { const v = $p('pa-fecha_nacimiento').value; $p('pa-edad').textContent = v ? 'Edad: ' + clinicaEdad(v) : ''; }
async function pintarClienteVinculado() {
  const el = $p('pa-cliente');
  if (!CP.cliente) { el.innerHTML = '<span class="cl-sub">Sin vincular: se crea solo en Clientes la primera vez que se cobra.</span>'; return; }
  if (!CP.cliente.nombre) {
    const { data } = await sb.from('clientes').select('id, nombre, apellido').eq('id', CP.cliente.id).eq('auth_user_id', STATE.userId).maybeSingle();
    CP.cliente.nombre = data ? `${data.nombre || ''} ${data.apellido || ''}`.trim() : '(cliente ya no existe)';
  }
  el.innerHTML = `<span>👥 ${esc(CP.cliente.nombre)}</span><button class="cl-link" type="button" onclick="desvincularCliente()">Quitar</button>`;
}
function desvincularCliente() { CP.cliente = null; pintarClienteVinculado(); }
let _tCli = null;
function buscarCliente(q) {
  clearTimeout(_tCli);
  const cont = $p('pa-cli-resultados'); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _tCli = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('clientes').select('id, nombre, apellido, telefono').eq('auth_user_id', STATE.userId)
        .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%`).order('nombre').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length)
        ? data.map(c => `<div class="cl-resultado" tabindex="0" data-id="${esc(c.id)}" data-n="${esc(`${c.nombre || ''} ${c.apellido || ''}`.trim())}">${esc(`${c.nombre || ''} ${c.apellido || ''}`.trim())}${c.telefono ? ` <span class="cl-sub">· ${esc(c.telefono)}</span>` : ''}</div>`).join('')
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados</div>';
      cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => { CP.cliente = { id: el.dataset.id, nombre: el.dataset.n }; cont.style.display = 'none'; $p('pa-cli-buscar').value = ''; pintarClienteVinculado(); }));
      cont.style.display = '';
    } catch (e) { console.error('buscarCliente:', e); }
  }, 250);
}
async function guardarPaciente() {
  const err = $p('pa-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const v = id => $p('pa-' + id).value.trim() || null;
  const nombres = v('nombres'), nac = v('fecha_nacimiento'), email = v('email');
  if (!nombres) return fallo('Escribe el nombre del paciente.');
  if (nac && nac > vetHoy()) return fallo('La fecha de nacimiento no puede ser futura.');
  if (nac && nac < '1900-01-01') return fallo('Revisa la fecha de nacimiento.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fallo('Revisa el correo electrónico.');
  const payload = { nombres, apellidos: v('apellidos'), cedula: v('cedula'), fecha_nacimiento: nac, sexo: $p('pa-sexo').value || null,
    telefono: v('telefono'), email, direccion: v('direccion'), ocupacion: v('ocupacion'),
    contacto_emergencia_nombre: v('contacto_emergencia_nombre'), contacto_emergencia_telefono: v('contacto_emergencia_telefono'),
    contacto_emergencia_parentesco: v('contacto_emergencia_parentesco'), notas: v('notas'), cliente_id: CP.cliente?.id || null };
  const btn = $p('pa-btn-guardar'); btn.disabled = true;
  try {
    const q = CP.editId
      ? sb.from('clinica_pacientes').update(payload).eq('id', CP.editId).eq('auth_user_id', STATE.userId).select('id').single()
      : sb.from('clinica_pacientes').insert({ ...payload, auth_user_id: STATE.userId }).select('id').single();
    const { data, error } = await q;
    if (error) throw error;
    showToast(CP.editId ? 'Paciente actualizado.' : 'Paciente registrado.');
    closeModal('modal-paciente');
    await cargarPacientes();
    abrirFicha(data.id);
  } catch (e) { console.error('guardarPaciente:', e); fallo(clinicaTextoError(e, 'No se pudo guardar el paciente.')); }
  finally { btn.disabled = false; }
}

/* ---------- Ficha ---------- */
async function abrirFicha(id, tab) {
  const p = CP.pacientes.find(x => x.id === id);
  if (!p) return;
  CP.ficha = p; CP.exp = null;
  pintarCabecera();
  openModal('modal-ficha');
  await cambiarTab(tab || 'exp');
}
function cerrarFicha() { closeModal('modal-ficha'); CP.ficha = null; CP.exp = null; CP.citaActiva = null; $p('fi-panel-exp').innerHTML = ''; }
function pintarCabecera() {
  const p = CP.ficha;
  $p('fi-titulo').textContent = `📋 ${clinicaNombrePaciente(p)}`;
  $p('fi-cabecera').innerHTML = `<div class="cl-fila" style="flex-wrap:wrap">
      <div class="cl-avatar" style="width:52px;height:52px;font-size:22px">${esc((p.nombres || '?').trim().charAt(0).toUpperCase())}</div>
      <div style="flex:1;min-width:180px"><div class="cl-nombre" style="font-size:17px">${esc(clinicaNombrePaciente(p))}${p.activo ? '' : ' <span class="cl-badge cl-badge-gris">Archivado</span>'}</div>
        <div class="cl-sub">${esc(p.numero_expediente || '')} · ${esc(clinicaEdad(p.fecha_nacimiento))}${p.sexo ? ' · ' + (p.sexo === 'femenino' ? 'Femenino' : 'Masculino') : ''}</div>
        <div class="cl-sub">${p.telefono ? '📞 ' + esc(p.telefono) : 'Sin teléfono'}${p.cedula ? ' · 🪪 ' + esc(p.cedula) : ''}</div></div>
      <div class="cl-acciones" style="margin:0">
        <button class="btn-accion-tabla btn-ghost" onclick="editarDesdeFicha()">✏️ Editar</button>
        <button class="btn-accion-tabla btn-ghost" onclick="agendarCita()">📅 Agendar cita</button>
      </div></div>`;
}
function editarDesdeFicha() { const id = CP.ficha.id; cerrarFicha(); abrirPaciente(id); }
function agendarCita(fecha) {
  const q = new URLSearchParams({ nueva: '1', paciente: CP.ficha.id }); if (fecha) q.set('fecha', fecha);
  window.location.href = 'clinica-agenda.html?' + q.toString();
}
async function cambiarTab(tab) {
  CP.tab = tab;
  ['exp', 'datos', 'citas'].forEach(t => { $p('fi-tab-' + t).classList.toggle('activa', t === tab); $p('fi-panel-' + t).style.display = t === tab ? '' : 'none'; });
  if (tab === 'datos') pintarDatos();
  if (tab === 'citas') await pintarCitas();
  if (tab === 'exp') await pintarExpediente();
}
function pintarDatos() {
  const p = CP.ficha, dato = (t, v) => `<div class="cl-dato"><b>${t}</b><span>${esc(v || '—')}</span></div>`;
  $p('fi-panel-datos').innerHTML = `<div class="cl-datos">
      ${dato('N.º de expediente', p.numero_expediente)}${dato('Cédula', p.cedula)}${dato('Fecha de nacimiento', p.fecha_nacimiento ? fechaCorta(p.fecha_nacimiento) : '')}
      ${dato('Edad', clinicaEdad(p.fecha_nacimiento))}${dato('Sexo', p.sexo === 'femenino' ? 'Femenino' : p.sexo === 'masculino' ? 'Masculino' : '')}
      ${dato('Teléfono', p.telefono)}${dato('Correo', p.email)}${dato('Ocupación', p.ocupacion)}${dato('Dirección', p.direccion)}
    </div>
    <div class="cl-seccion">Contacto de emergencia</div>
    <div class="cl-datos">${dato('Nombre', p.contacto_emergencia_nombre)}${dato('Teléfono', p.contacto_emergencia_telefono)}${dato('Parentesco', p.contacto_emergencia_parentesco)}</div>
    ${p.notas ? `<div class="cl-info">📝 ${esc(p.notas)}</div>` : ''}
    <div class="cl-acciones"><button class="btn-accion-tabla btn-ghost" onclick="alternarArchivado()">${p.activo ? '📦 Archivar paciente' : '♻️ Reactivar paciente'}</button></div>`;
}
async function pintarCitas() {
  const cont = $p('fi-panel-citas');
  cont.innerHTML = '<p class="cl-sub">Cargando…</p>';
  try {
    const [{ data, error }, { data: pers }] = await Promise.all([
      sb.from('clinica_citas').select('id, fecha, hora, estado, tipo, motivo, medico_id, ventas(numero_venta, estado)').eq('auth_user_id', STATE.userId).eq('paciente_id', CP.ficha.id).order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(60),
      sb.from('clinica_personal').select('id, nombre').eq('auth_user_id', STATE.userId),
    ]);
    if (error) throw error;
    const nom = id => (pers || []).find(x => x.id === id)?.nombre || '';
    cont.innerHTML = (data || []).length ? data.map(c => { const e = CLINICA_ESTADOS_CITA[c.estado] || CLINICA_ESTADOS_CITA.programada, t = CLINICA_TIPOS_CITA[c.tipo] || CLINICA_TIPOS_CITA.consulta;
      return `<div class="cl-item"><div class="cl-item-cab"><div><div class="cl-item-tit">${esc(fechaCorta(c.fecha))} · ${esc(vetFormatoHora(c.hora))}</div>
        <div class="cl-item-fecha">${t.e} ${esc(t.n)}${c.motivo ? ' · ' + esc(c.motivo) : ''}${c.medico_id ? ' · ' + esc(nom(c.medico_id)) : ''}</div></div>
        <div><span class="cl-badge cl-badge-${e.clase}">${esc(e.n)}</span>${c.ventas?.estado === 'completada' ? ` <span class="cl-badge cl-badge-verde">Cobrada · ${esc(c.ventas.numero_venta || '')}</span>` : ''}</div></div></div>`; }).join('')
      : '<p class="cl-sub">Este paciente no tiene citas.</p>';
  } catch (e) { console.error('pintarCitas:', e); cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudieron cargar las citas.</p>'; }
}
async function alternarArchivado() {
  const p = CP.ficha; if (!p) return;
  try {
    const { error } = await sb.from('clinica_pacientes').update({ activo: !p.activo }).eq('id', p.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast(p.activo ? 'Paciente archivado (su historia se conserva).' : 'Paciente reactivado.');
    await cargarPacientes(); CP.ficha = CP.pacientes.find(x => x.id === p.id) || p; pintarCabecera(); pintarDatos();
  } catch (e) { console.error('alternarArchivado:', e); showToast('No se pudo cambiar el estado.', 'error'); }
}

/* ---------- Expediente clínico (solo con sesión médica) ---------- */
function alCambiarSesion(s) {
  if (!s) { CP.exp = null; }                       // al bloquear, se borra de la memoria y de la pantalla
  if (CP.ficha && CP.tab === 'exp') pintarExpediente();
}
async function pintarExpediente() {
  const cont = $p('fi-panel-exp');
  const s = ClinicaSesion.leer();
  if (!s) {
    CP.exp = null;
    cont.innerHTML = `<div class="cl-candado"><div class="cl-candado-icono">🔒</div>
      <p class="cl-nombre" style="margin:6px 0 4px">Expediente clínico confidencial</p>
      <p class="cl-sub" style="margin:0 0 14px">Solo el personal médico puede verlo, con su PIN personal. Cada acceso queda registrado.</p>
      <button class="btn-accion-tabla btn-primary" onclick="entrarExpediente()">🔓 Entrar con mi PIN</button></div>`;
    return;
  }
  cont.innerHTML = '<p class="cl-sub">Cargando expediente…</p>';
  try {
    CP.exp = await ClinicaSesion.rpc('clinica_expediente_abrir', { p_paciente_id: CP.ficha.id });
    renderExpediente();
  } catch (e) {
    if (e.cancelado) { cont.innerHTML = ''; pintarExpediente(); return; }
    console.error('expediente:', e); cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo abrir el expediente.</p>';
  }
}
async function entrarExpediente() { const s = await ClinicaSesion.pedir(); if (s) pintarExpediente(); }

function renderExpediente() {
  const ex = CP.exp, a = ex.antecedentes || {}, yo = ex.yo || {}, p = CP.ficha;
  const linea = (t, v) => v ? `<p><b>${t}:</b> ${esc(v)}</p>` : '';
  const alergias = a.alergias
    ? `<div class="cl-alerta">⚠️ ALERGIAS: ${esc(a.alergias)}</div>`
    : a.sin_alergias ? '<div class="cl-info">✅ Sin alergias conocidas</div>' : '<div class="cl-aviso">⚠️ Alergias no registradas: pregúntale al paciente y anótalas en Antecedentes.</div>';
  const ant = [linea('Tipo de sangre', a.tipo_sangre), linea('Personales patológicos', a.personales), linea('Quirúrgicos', a.quirurgicos),
    linea('Familiares', a.familiares), linea('Gineco-obstétricos', a.gineco_obstetricos), linea('Hábitos', a.habitos),
    linea('Medicamentos que toma', a.medicamentos_actuales), linea('Vacunas', a.inmunizaciones)].join('');
  const consultas = ex.consultas || [];
  $p('fi-panel-exp').innerHTML = `${alergias}
    <div class="cl-acciones" style="margin-top:12px">
      <button class="btn-accion-tabla btn-primary" onclick="abrirConsulta()">📝 Nueva consulta</button>
      <button class="btn-accion-tabla btn-ghost" onclick="abrirAntecedentes()">✏️ Antecedentes</button>
      <button class="btn-accion-tabla btn-ghost" onclick="abrirDocumento()">📄 Documento</button>
      <button class="btn-accion-tabla btn-ghost" onclick="abrirAdjunto()">📎 Subir archivo</button>
    </div>
    <div class="cl-seccion">Antecedentes</div>
    <div class="cl-item">${ant || '<p class="cl-sub" style="margin:0">Sin antecedentes registrados.</p>'}
      ${a.actualizado_en ? `<p class="cl-sub">Actualizado por ${esc(a.actualizado_por_nombre || '—')} · ${esc(fechaHora(a.actualizado_en))}</p>` : ''}</div>
    <div class="cl-seccion">Consultas (${consultas.length})</div>
    ${consultas.length ? consultas.map(c => tarjetaConsulta(c, yo)).join('') : '<p class="cl-sub">Todavía no hay consultas.</p>'}
    ${seccionDocumentos(ex.documentos || [], yo)}${seccionAdjuntos(ex.adjuntos || [], yo)}
    <p class="cl-sub" style="margin-top:10px">🔓 Viendo como ${esc(yo.nombre || '')}. Este acceso quedó registrado en la bitácora.</p>`;
}
function tarjetaConsulta(c, yo) {
  const est = CLINICA_ESTADOS_NOTA[c.estado] || CLINICA_ESTADOS_NOTA.borrador;
  const linea = (t, v) => v ? `<p><b>${t}:</b> ${esc(v)}</p>` : '';
  const signos = [clinicaTextoPA(c) && `PA ${clinicaTextoPA(c)} mmHg`, c.fc && `FC ${c.fc} lpm`, c.fr && `FR ${c.fr} rpm`, c.temperatura && `T ${c.temperatura} °C`,
    c.spo2 && `SpO₂ ${c.spo2}%`, c.peso_kg && `Peso ${vetFormatoNumero(c.peso_kg)} kg`, c.talla_cm && `Talla ${vetFormatoNumero(c.talla_cm)} cm`,
    c.imc && `IMC ${c.imc}`, c.glucosa_mg_dl && `Glucosa ${vetFormatoNumero(c.glucosa_mg_dl)} mg/dl`].filter(Boolean);
  const soyAutor = c.medico_id === yo.id;
  const btns = [];
  if (c.estado === 'borrador' && soyAutor) { btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirConsulta('${c.id}')">✏️ Continuar</button>`); btns.push(`<button class="btn-accion-tabla btn-primary" onclick="cerrarNota('${c.id}')">✅ Cerrar y firmar</button>`); }
  if (c.estado === 'cerrada') btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirAdenda('${c.id}')">➕ Adenda</button>`);
  if (c.estado === 'cerrada' && c.proximo_control && c.proximo_control >= vetHoy()) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="agendarCita('${c.proximo_control}')">📅 Agendar control</button>`);
  if (c.estado !== 'anulada') btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirDocumento(null, '${c.id}')">📄 Documento</button>`);
  if (c.estado !== 'anulada' && (soyAutor || yo.rol === 'admin')) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirAnular('${c.id}')">🚫 Anular</button>`);
  return `<div class="cl-item ${c.estado === 'anulada' ? 'anulada' : ''}">
    <div class="cl-item-cab"><div><div class="cl-item-tit">${esc(c.motivo)}</div>
      <div class="cl-item-fecha">${esc(fechaHora(c.fecha))} · ${esc(c.medico_nombre)} · ${esc(clinicaNombreEspecialidad(c.especialidad))}</div></div>
      <span class="cl-badge cl-badge-${est.clase}">${esc(est.n)}</span></div>
    ${signos.length ? `<p><b>Signos vitales:</b> ${esc(signos.join(' · '))}</p>` : ''}
    ${linea('Enfermedad actual', c.enfermedad_actual)}${linea('Examen físico', c.examen_fisico)}${htmlDiagnosticos(c.diagnosticos)}${linea('Diagnóstico', c.diagnostico)}
    ${linea('Plan', c.plan)}${linea('Indicaciones', c.indicaciones)}${c.proximo_control ? `<p><b>Próximo control:</b> ${esc(fechaCorta(c.proximo_control))}</p>` : ''}
    ${(c.adendas || []).map(d => `<div class="cl-info"><b>Adenda · ${esc(d.autor_nombre)} · ${esc(fechaHora(d.created_at))}</b><br>${esc(d.texto)}</div>`).join('')}
    ${c.estado === 'cerrada' ? `<p class="cl-sub">🔏 Firmada el ${esc(fechaHora(c.cerrada_en))} · código ${esc(String(c.firma_hash || '').slice(0, 12))}</p>` : ''}
    ${c.estado === 'anulada' ? `<p class="cl-sub">🚫 Anulada por ${esc(c.anulada_por_nombre || '—')} el ${esc(fechaHora(c.anulada_en))}: ${esc(c.motivo_anulacion || '')}</p>` : ''}
    ${btns.length ? `<div class="cl-acciones">${btns.join('')}</div>` : ''}
  </div>`;
}

/* ---------- Antecedentes ---------- */
const CAMPOS_ANT = ['alergias', 'personales', 'quirurgicos', 'familiares', 'gineco_obstetricos', 'habitos', 'medicamentos_actuales', 'inmunizaciones'];
function abrirAntecedentes() {
  const a = CP.exp?.antecedentes || {};
  const sel = $p('an-tipo_sangre');
  if (sel.options.length <= 1) CLINICA_TIPOS_SANGRE.forEach(t => sel.add(new Option(t, t)));
  sel.value = a.tipo_sangre || '';
  CAMPOS_ANT.forEach(k => { $p('an-' + k).value = a[k] || ''; });
  $p('an-sin_alergias').checked = !!a.sin_alergias;
  $p('an-gineco-wrap').style.display = CP.ficha.sexo === 'masculino' ? 'none' : '';
  $p('an-error').textContent = '';
  openModal('modal-antecedentes');
}
function alMarcarSinAlergias() { if ($p('an-sin_alergias').checked) $p('an-alergias').value = ''; }
async function guardarAntecedentes() {
  const err = $p('an-error'); err.textContent = '';
  const datos = { tipo_sangre: $p('an-tipo_sangre').value || null, sin_alergias: $p('an-sin_alergias').checked };
  CAMPOS_ANT.forEach(k => { datos[k] = $p('an-' + k).value.trim() || null; });
  if (datos.sin_alergias && datos.alergias) return (err.textContent = 'Marcaste "sin alergias" pero escribiste alergias: deja solo una opción.');
  const btn = $p('an-btn-guardar'); btn.disabled = true;
  try {
    await ClinicaSesion.rpc('clinica_antecedentes_guardar', { p_paciente_id: CP.ficha.id, p_datos: datos });
    showToast('Antecedentes guardados.'); closeModal('modal-antecedentes'); await pintarExpediente();
  } catch (e) { if (!e.cancelado) { console.error('antecedentes:', e); err.textContent = clinicaTextoError(e, 'No se pudieron guardar.'); } }
  finally { btn.disabled = false; }
}

/* ---------- Consulta (nota médica) ---------- */
const CAMPOS_TEXTO = ['motivo', 'enfermedad_actual', 'examen_fisico', 'diagnostico', 'plan', 'indicaciones'];
function abrirConsulta(id) {
  const c = id ? (CP.exp?.consultas || []).find(x => x.id === id) : null;
  CP.notaId = c ? c.id : null;
  $p('co-titulo').textContent = c ? '✏️ Continuar consulta' : `📝 Nueva consulta — ${clinicaNombrePaciente(CP.ficha)}`;
  const selE = $p('co-especialidad');
  selE.innerHTML = CP.especialidades.map(k => `<option value="${esc(k)}">${esc(clinicaNombreEspecialidad(k))}</option>`).join('');
  $p('co-especialidad-wrap').style.display = CP.especialidades.length > 1 ? '' : 'none';
  const espDefecto = CP.citaActiva?.especialidad && CP.especialidades.includes(CP.citaActiva.especialidad) ? CP.citaActiva.especialidad
    : (CP.especialidades.includes('medicina_general') ? 'medicina_general' : CP.especialidades[0]);
  selE.value = c?.especialidad && CP.especialidades.includes(c.especialidad) ? c.especialidad : espDefecto;
  CAMPOS_TEXTO.forEach(k => { $p('co-' + k).value = c?.[k] || ''; });
  if (!c && CP.citaActiva?.motivo) $p('co-motivo').value = CP.citaActiva.motivo;
  Object.keys(CLINICA_SIGNOS).forEach(k => { $p('co-' + k).value = c?.[k] ?? ''; });
  $p('co-proximo_control').value = c?.proximo_control || '';
  $p('co-proximo_control').min = vetHoy();
  $p('co-error').textContent = '';
  $p('co-cita-aviso').style.display = (!c && CP.citaActiva) ? '' : 'none';
  pintarCamposEspecialidad(c?.datos || {});
  CP.dx = Array.isArray(c?.diagnosticos) ? c.diagnosticos.map(x => ({ ...x })) : []; $p('co-dx-buscar').value = ''; $p('co-dx-resultados').style.display = 'none'; pintarDx();
  recalcularSignos();
  const alerg = CP.exp?.antecedentes?.alergias;
  $p('co-alergias').innerHTML = alerg ? `<div class="cl-alerta" style="margin:0 0 10px">⚠️ ALERGIAS: ${esc(alerg)}</div>` : '';
  openModal('modal-consulta');
  setTimeout(() => $p('co-motivo').focus(), 50);
}
// Campos propios de la especialidad elegida (catálogo en clinica-comun.js; se guardan en consulta.datos).
function pintarCamposEspecialidad(datos) {
  const esp = CLINICA_ESPECIALIDADES[$p('co-especialidad').value];
  const campos = esp?.campos || [];
  $p('co-extra').innerHTML = campos.length ? `<div class="cl-seccion">${esc(esp.n)}</div><div class="cl-grid2">${campos.map(f => {
    const val = datos?.[f.k] ?? '';
    const ctrl = f.tipo === 'textarea' ? `<textarea class="cl-ta" data-extra="${esc(f.k)}" maxlength="2000">${esc(val)}</textarea>`
      : f.tipo === 'select' ? `<select class="cl-in" data-extra="${esc(f.k)}"><option value=""></option>${(f.opciones || []).map(o => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : `<input class="cl-in" data-extra="${esc(f.k)}" type="${f.tipo === 'number' ? 'number' : f.tipo === 'date' ? 'date' : 'text'}" step="any" value="${esc(val)}" maxlength="300"/>`;
    return `<div class="cl-field"><label>${esc(f.n)}</label>${ctrl}</div>`; }).join('')}</div>` : '';
}
function leerCamposEspecialidad() {
  const d = {};
  document.querySelectorAll('#co-extra [data-extra]').forEach(el => { const v = String(el.value || '').trim(); if (v) d[el.dataset.extra] = v.slice(0, 2000); });
  return d;
}
function recalcularSignos() {
  const v = {}; Object.keys(CLINICA_SIGNOS).forEach(k => { v[k] = $p('co-' + k).value; });
  const imc = clinicaIMC(clinicaNumero(v.peso_kg), clinicaNumero(v.talla_cm));
  const cl = clinicaClasificarIMC(imc, clinicaAnios(CP.ficha?.fecha_nacimiento));
  $p('co-imc').innerHTML = imc != null ? `IMC: <b>${imc}</b> <span class="cl-badge cl-badge-${cl.clase}">${esc(cl.texto)}</span>` : '<span class="cl-sub">El IMC se calcula solo con peso y talla.</span>';
  const al = clinicaAlertasSignos(v);
  $p('co-alertas').innerHTML = al.length ? `<div class="cl-aviso" style="margin:6px 0 0">⚠️ ${al.map(esc).join(' · ')}</div>` : '';
}
function datosConsulta() {
  const d = { especialidad: $p('co-especialidad').value || 'medicina_general', proximo_control: $p('co-proximo_control').value || null, datos: leerCamposEspecialidad(), diagnosticos: CP.dx || [] };
  CAMPOS_TEXTO.forEach(k => { d[k] = $p('co-' + k).value.trim() || null; });
  Object.keys(CLINICA_SIGNOS).forEach(k => { const n = clinicaNumero($p('co-' + k).value); d[k] = n == null ? null : String(n); });
  // Si solo se eligieron diagnósticos CIE-10, también quedan escritos en el texto del diagnóstico.
  if (!d.diagnostico && d.diagnosticos.length) d.diagnostico = d.diagnosticos.map(x => (x.codigo ? x.codigo + ' ' : '') + x.nombre).join('; ').slice(0, 4000);
  return d;
}
function validarConsulta(d) {
  if (!d.motivo) return 'Escribe el motivo de la consulta.';
  const vs = {}; Object.keys(CLINICA_SIGNOS).forEach(k => { vs[k] = $p('co-' + k).value; });
  const e = clinicaValidarSignos(vs); if (e) return e;
  if (d.proximo_control && d.proximo_control < vetHoy()) return 'El próximo control no puede ser una fecha pasada.';
  return '';
}
async function guardarNota({ silencioso } = {}) {
  const err = $p('co-error'); err.textContent = '';
  const d = datosConsulta(), e = validarConsulta(d);
  if (e) { err.textContent = e; return null; }
  if (!CP.notaId) { d.paciente_id = CP.ficha.id; if (CP.citaActiva) d.cita_id = CP.citaActiva.id; }
  const r = await ClinicaSesion.rpc('clinica_consulta_guardar', { p_id: CP.notaId, p_datos: d });
  if (!r || !r.ok) { err.textContent = clinicaTextoMotivo(r); return null; }
  CP.notaId = r.id;
  if (d.cita_id) CP.citaActiva = null;              // la cita ya quedó ligada a esta nota
  if (!silencioso) showToast('Borrador guardado. Recuerda cerrarlo y firmarlo al terminar.');
  return r.id;
}
async function guardarBorrador() {
  const btn = $p('co-btn-guardar'); btn.disabled = true;
  try { const id = await guardarNota(); if (id) { closeModal('modal-consulta'); await pintarExpediente(); } }
  catch (e) { if (!e.cancelado) { console.error('guardarBorrador:', e); $p('co-error').textContent = clinicaTextoError(e, 'No se pudo guardar.'); } }
  finally { btn.disabled = false; }
}
async function guardarYCerrar() {
  const d = datosConsulta();
  if (!d.diagnostico && !d.plan) { $p('co-error').textContent = 'Para cerrar la nota escribe al menos el diagnóstico o el plan.'; return; }
  if (!confirm('¿Cerrar y firmar la consulta?\n\nDespués ya no se podrá modificar (solo agregar adendas).')) return;
  const btn = $p('co-btn-cerrar'); btn.disabled = true;
  try {
    const id = await guardarNota({ silencioso: true });
    if (!id) return;
    const r = await ClinicaSesion.rpc('clinica_consulta_cerrar', { p_id: id });
    if (!r || !r.ok) { $p('co-error').textContent = clinicaTextoMotivo(r); await pintarExpediente(); return; }
    closeModal('modal-consulta');
    showToast('Consulta cerrada y firmada.');
    await pintarExpediente();
    if (d.proximo_control && confirm(`El próximo control es el ${vetFechaLarga(d.proximo_control)}. ¿Agendar la cita ahora?`)) agendarCita(d.proximo_control);
  } catch (e) { if (!e.cancelado) { console.error('guardarYCerrar:', e); $p('co-error').textContent = clinicaTextoError(e, 'No se pudo cerrar la nota.'); } }
  finally { btn.disabled = false; }
}
async function cerrarNota(id) {
  if (!confirm('¿Cerrar y firmar esta consulta?\n\nDespués ya no se podrá modificar (solo agregar adendas).')) return;
  try {
    const r = await ClinicaSesion.rpc('clinica_consulta_cerrar', { p_id: id });
    if (!r || !r.ok) { showToast(clinicaTextoMotivo(r), 'error'); return; }
    showToast('Consulta cerrada y firmada.'); await pintarExpediente();
  } catch (e) { if (!e.cancelado) { console.error('cerrarNota:', e); showToast(clinicaTextoError(e, 'No se pudo cerrar.'), 'error'); } }
}

/* ---------- Adenda y anulación ---------- */
function abrirAdenda(id) { CP.notaCtx = id; $p('ad-texto').value = ''; $p('ad-error').textContent = ''; openModal('modal-adenda'); setTimeout(() => $p('ad-texto').focus(), 50); }
async function guardarAdenda() {
  const t = $p('ad-texto').value.trim();
  if (!t) { $p('ad-error').textContent = 'Escribe la adenda.'; return; }
  try {
    const r = await ClinicaSesion.rpc('clinica_consulta_adenda', { p_id: CP.notaCtx, p_texto: t });
    if (!r || !r.ok) { $p('ad-error').textContent = clinicaTextoMotivo(r); return; }
    closeModal('modal-adenda'); showToast('Adenda agregada.'); await pintarExpediente();
  } catch (e) { if (!e.cancelado) { console.error('adenda:', e); $p('ad-error').textContent = clinicaTextoError(e); } }
}
function abrirAnular(id) { CP.notaCtx = id; $p('nu-motivo').value = ''; $p('nu-error').textContent = ''; openModal('modal-anular'); }
async function confirmarAnular() {
  const m = $p('nu-motivo').value.trim();
  if (m.length < 5) { $p('nu-error').textContent = 'Escribe el motivo (al menos 5 letras).'; return; }
  try {
    const r = await ClinicaSesion.rpc('clinica_consulta_anular', { p_id: CP.notaCtx, p_motivo: m });
    if (!r || !r.ok) { $p('nu-error').textContent = clinicaTextoMotivo(r); return; }
    closeModal('modal-anular'); showToast('Nota anulada (se conserva en el historial).'); await pintarExpediente();
  } catch (e) { if (!e.cancelado) { console.error('anular:', e); $p('nu-error').textContent = clinicaTextoError(e); } }
}

/* ---------- Venir desde la Agenda (?cita=) o con ?paciente= ---------- */
async function procesarURL() {
  try {
    const q = new URLSearchParams(window.location.search);
    const citaId = q.get('cita'), pacId = q.get('paciente');
    if (citaId) {
      const { data: cita } = await sb.from('clinica_citas').select('*').eq('id', citaId).eq('auth_user_id', STATE.userId).maybeSingle();
      if (!cita || ['cancelada', 'no_asistio', 'atendida'].includes(cita.estado) || !CP.pacientes.some(p => p.id === cita.paciente_id)) {
        showToast('Esa cita ya no está disponible para atender.', 'error');
        if (cita && CP.pacientes.some(p => p.id === cita.paciente_id)) await abrirFicha(cita.paciente_id);
        return;
      }
      CP.citaActiva = cita;
      await abrirFicha(cita.paciente_id, 'exp');
      if (!ClinicaSesion.leer()) { const s = await ClinicaSesion.pedir({ ayuda: 'Para atender a este paciente, elige tu nombre y escribe tu PIN.' }); if (!s) return; await pintarExpediente(); }
      if (!CP.exp) return;
      // Si la cita ya tiene un borrador, se continúa ese mismo.
      const yaNota = (CP.exp.consultas || []).find(c => c.cita_id === cita.id && c.estado !== 'anulada');
      if (yaNota) { CP.citaActiva = null; if (yaNota.estado === 'borrador' && yaNota.medico_id === CP.exp.yo?.id) abrirConsulta(yaNota.id); return; }
      abrirConsulta();
      return;
    }
    if (pacId && CP.pacientes.some(p => p.id === pacId)) await abrirFicha(pacId);
  } catch (e) { console.warn('procesarURL:', e); }
}

/* ---------- Tutorial ---------- */
const PASOS_TUTORIAL = [
  { icono: '👤', titulo: 'Pacientes', texto: 'Aquí registras a cada paciente con sus datos generales. Su número de expediente y su edad se calculan solos.' },
  { icono: '🔒', titulo: 'Expediente clínico', texto: 'Antecedentes, alergias y consultas solo los ve el personal médico con su PIN. Cada vez que alguien abre un expediente queda anotado.' },
  { icono: '📝', titulo: 'La consulta', texto: 'Escribe motivo, signos vitales (el IMC sale solo), examen, diagnóstico y plan. Puedes guardar un borrador y terminar después.' },
  { icono: '✅', titulo: 'Cerrar y firmar', texto: 'Al terminar, "Cerrar y firmar". La nota queda fija: si luego hay que corregir algo, se agrega una adenda con fecha.' },
  { icono: '📄', titulo: 'Recetas y documentos', texto: 'Con "📄 Documento" haces recetas, órdenes de laboratorio o imágenes, constancias, certificados, referencias y consentimientos, listos para imprimir en hoja o en ticket. La receta puede pasar a Farmacia o a la cuenta de la visita.' },
  { icono: '📎', titulo: 'Archivos', texto: 'Sube resultados o fotos (PDF o imagen, hasta 10 MB). Se guardan en un lugar privado: solo el personal médico con su PIN los abre.' },
];
function mostrarTutorial(forzar) {
  try {
    if (!window.Negocio360Tutorial) return;
    if (forzar) Negocio360Tutorial.mostrar('clinica_pacientes', PASOS_TUTORIAL);
    else Negocio360Tutorial.verificarYMostrar('clinica_pacientes', PASOS_TUTORIAL);
  } catch (e) { console.warn('tutorial:', e); }
}
