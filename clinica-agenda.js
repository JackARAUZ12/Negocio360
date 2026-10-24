/* =====================================================
   CLINICA-AGENDA.JS — NEGOCIO360 · Módulo Clínica
   Citas por día o semana y por médico, estados (programada,
   confirmada, en sala de espera, en consulta, atendida, no
   asistió, cancelada), recordatorio por WhatsApp, cuenta de
   la visita y cobro por Ventas (igual que Veterinaria).
   La agenda es información administrativa: la usa recepción.
   Las alergias solo se ven con la sesión médica abierta.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = { userId: null, empresaConfig: {}, currentUser: {} };

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
   ESTADO DE LA AGENDA
===================================================== */
const AG = { fecha: null, vista: 'dia', medicos: [], consultorios: [], especialidades: [], citas: [], cargos: {}, alergias: {},
  editId: null, paciente: null, citaCancelar: null, citaCuenta: null, prodCargo: null };
const $a = id => document.getElementById(id);

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

    AG.especialidades = clinicaEspecialidadesActivas(STATE.empresaConfig.clinica_especialidades);
    ClinicaSesion.iniciar(user.id, { onCambio: () => { cargarAlergias().then(renderAgenda); } });
    const q = new URLSearchParams(window.location.search);
    AG.fecha = /^\d{4}-\d{2}-\d{2}$/.test(q.get('fecha') || '') ? q.get('fecha') : vetHoy();
    await cargarBase();
    await cargarCitas();
    await ClinicaSesion.comprobar();
    if (q.get('nueva') === '1') {          // viene de "Agendar control" en la consulta
      const pid = q.get('paciente');
      let pac = null;
      if (pid) { const { data } = await sb.from('clinica_pacientes').select('id, nombres, apellidos, telefono').eq('id', pid).eq('auth_user_id', STATE.userId).maybeSingle(); pac = data; }
      abrirCita(null, { paciente: pac, fecha: AG.fecha, tipo: 'control' });
    }
    mostrarTutorial(false);
  } catch (e) {
    console.error('init clinica-agenda:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

async function cargarBase() {
  const [p, k] = await Promise.all([
    sb.from('clinica_personal').select('id, nombre, rol, atiende, especialidad, consultorio_id').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre'),
    sb.from('clinica_consultorios').select('id, nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre'),
  ]);
  AG.medicos = (p.data || []).filter(x => x.atiende);
  AG.consultorios = k.data || [];
  const sel = $a('ag-medico');
  sel.innerHTML = '<option value="">👥 Todos los médicos</option>' + AG.medicos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
  sel.style.display = AG.medicos.length > 1 ? '' : 'none';
  $a('ag-sin-medicos').style.display = AG.medicos.length ? 'none' : '';
}

function rango() { return AG.vista === 'dia' ? [AG.fecha, AG.fecha] : (s => [s[0], s[6]])(clinicaSemana(AG.fecha)); }

async function cargarCitas() {
  $a('ag-fecha').value = AG.fecha;
  const [desde, hasta] = rango();
  $a('ag-titulo').textContent = AG.vista === 'dia'
    ? `${vetDiaSemana(AG.fecha)[0].toUpperCase()}${vetDiaSemana(AG.fecha).slice(1)} ${vetFechaLarga(AG.fecha)}${AG.fecha === vetHoy() ? ' · Hoy' : ''}`
    : `Semana del ${vetFechaLarga(desde)} al ${vetFechaLarga(hasta)}`;
  try {
    const { data, error } = await sb.from('clinica_citas')
      .select('*, clinica_pacientes(id, nombres, apellidos, telefono, cliente_id, numero_expediente), ventas(numero_venta, estado)')
      .eq('auth_user_id', STATE.userId).gte('fecha', desde).lte('fecha', hasta).order('fecha').order('hora').limit(1000);
    if (error) throw error;
    AG.citas = data || [];
    AG.cargos = {};
    const ids = AG.citas.map(c => c.id);
    if (ids.length) {
      const { data: cg } = await sb.from('clinica_cargos').select('cita_id, cantidad, productos(precio)').eq('auth_user_id', STATE.userId).in('cita_id', ids);
      (cg || []).forEach(x => { AG.cargos[x.cita_id] = (AG.cargos[x.cita_id] || 0) + Number(x.cantidad) * Number(x.productos?.precio || 0); });
    }
    await cargarAlergias();
    renderAgenda();
  } catch (e) {
    console.error('cargarCitas:', e);
    $a('ag-lista').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la agenda. Revisa tu conexión.</p>';
  }
}
// Alergias de los pacientes de la agenda: SOLO con la sesión médica abierta (las entrega el servidor).
async function cargarAlergias() {
  AG.alergias = {};
  const s = ClinicaSesion.leer();
  if (!s || !AG.citas.length) return;
  try {
    const ids = [...new Set(AG.citas.map(c => c.paciente_id))];
    const { data, error } = await sb.rpc('clinica_alergias', { p_token: s.token, p_ids: ids });
    if (!error && data) AG.alergias = data;
  } catch (_) {}
}

function citasFiltradas() { const m = $a('ag-medico').value; return AG.citas.filter(c => !m || c.medico_id === m); }
function filtrar() { renderAgenda(); }
function cambiarFecha(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return; AG.fecha = v; cargarCitas(); }
function mover(n) { AG.fecha = vetSumarDias(AG.fecha, AG.vista === 'dia' ? n : 7 * n); cargarCitas(); }
function irHoy() { AG.fecha = vetHoy(); cargarCitas(); }
function cambiarVista(v) {
  AG.vista = v;
  $a('ag-v-dia').classList.toggle('activa', v === 'dia'); $a('ag-v-semana').classList.toggle('activa', v === 'semana');
  cargarCitas();
}
function verDia(ymd) { AG.fecha = ymd; cambiarVista('dia'); }

const nombreMedico = id => AG.medicos.find(m => m.id === id)?.nombre || '';
const nombreConsultorio = id => AG.consultorios.find(k => k.id === id)?.nombre || '';
const pacienteDe = c => c.clinica_pacientes || {};
const cobrada = c => c.ventas && c.ventas.estado === 'completada';

function renderAgenda() {
  const lista = citasFiltradas();
  const delDia = lista.filter(c => c.fecha === AG.fecha);
  const base = AG.vista === 'dia' ? delDia : lista;
  $a('ag-kpi-total').textContent = base.filter(c => c.estado !== 'cancelada').length;
  $a('ag-kpi-espera').textContent = base.filter(c => c.estado === 'en_espera' || c.estado === 'en_consulta').length;
  $a('ag-kpi-aten').textContent = base.filter(c => c.estado === 'atendida').length;
  $a('ag-kpi-falta').textContent = base.filter(c => c.estado === 'no_asistio' || c.estado === 'cancelada').length;
  $a('ag-kpi-label').textContent = AG.vista === 'dia' ? 'Citas del día' : 'Citas de la semana';
  if (AG.vista === 'semana') return renderSemana(lista);
  const cont = $a('ag-lista');
  cont.className = 'cl-lista';
  if (!delDia.length) {
    cont.innerHTML = `<div class="cl-info" style="grid-column:1/-1">No hay citas este día. Agenda una con "+ Nueva cita".</div>`;
    return;
  }
  cont.innerHTML = delDia.map(tarjetaCita).join('');
}

function botonEstado(c, est) {
  const t = { confirmada: '✔ Confirmar', en_espera: '🪑 Llegó', no_asistio: '🚫 No asistió', cancelada: '✖ Cancelar', programada: '↩ Reactivar' }[est];
  return `<button class="btn-accion-tabla btn-ghost" onclick="cambiarEstado('${c.id}','${est}')">${t}</button>`;
}
function tarjetaCita(c) {
  const p = pacienteDe(c), est = CLINICA_ESTADOS_CITA[c.estado] || CLINICA_ESTADOS_CITA.programada;
  const tipo = CLINICA_TIPOS_CITA[c.tipo] || CLINICA_TIPOS_CITA.consulta;
  const alergia = AG.alergias[c.paciente_id];
  const activa = !['cancelada', 'no_asistio'].includes(c.estado);
  const btns = [];
  if (['programada', 'confirmada', 'en_espera'].includes(c.estado)) btns.push(`<button class="btn-accion-tabla btn-primary" onclick="atender('${c.id}')">🩺 Atender</button>`);
  if (c.estado === 'en_consulta') btns.push(`<button class="btn-accion-tabla btn-primary" onclick="atender('${c.id}')">🩺 Continuar consulta</button>`);
  clinicaSiguientesEstados(c.estado).forEach(e => btns.push(botonEstado(c, e)));
  if (activa) {
    if (cobrada(c)) btns.push(`<span class="cl-badge cl-badge-verde">✅ Cobrada · ${esc(c.ventas.numero_venta || '')}</span>`);
    else btns.push(`<button class="btn-accion-tabla ${c.estado === 'atendida' ? 'btn-primary' : 'btn-ghost'}" onclick="abrirCuenta('${c.id}')">💳 Cuenta${AG.cargos[c.id] ? ' · ' + esc(fmt(AG.cargos[c.id])) : ''}</button>`);
  }
  if (['programada', 'confirmada'].includes(c.estado)) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="recordar('${c.id}')">📲 Recordar</button>`);
  if (!['atendida', 'en_consulta'].includes(c.estado)) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirCita('${c.id}')">✏️ Editar</button>`);
  return `<div class="ag-card est-${esc(c.estado)}">
    <div class="ag-fila"><span class="ag-hora">${esc(vetRangoCita(c.hora, c.duracion_min))}</span><span class="cl-badge cl-badge-${est.clase}">${esc(est.n)}</span></div>
    <div class="cl-nombre">${esc(clinicaNombrePaciente(p))} <span class="cl-sub">${esc(p.numero_expediente || '')}</span></div>
    <div class="cl-sub">${tipo.e} ${esc(tipo.n)}${c.motivo ? ' · ' + esc(c.motivo) : ''}</div>
    <div class="cl-sub">${c.medico_id ? '👨‍⚕️ ' + esc(nombreMedico(c.medico_id) || 'Médico') : '👨‍⚕️ Sin asignar'}${c.consultorio_id ? ' · 🚪 ' + esc(nombreConsultorio(c.consultorio_id)) : ''}${c.recordatorio_enviado_en ? ' · 📲 avisado' : ''}</div>
    ${c.estado === 'cancelada' && c.motivo_cancelacion ? `<div class="cl-sub">Motivo: ${esc(c.motivo_cancelacion)}</div>` : ''}
    ${alergia ? `<div class="cl-alerta">⚠️ Alergias: ${esc(alergia)}</div>` : ''}
    <div class="ag-btns">${btns.join('')}</div>
  </div>`;
}
function renderSemana(lista) {
  const dias = clinicaSemana(AG.fecha), hoy = vetHoy();
  const cont = $a('ag-lista');
  cont.className = 'ag-semana';
  cont.innerHTML = dias.map(d => {
    const del = lista.filter(c => c.fecha === d);
    return `<div class="ag-dia"><div class="ag-dia-cab ${d === hoy ? 'hoy' : ''}" onclick="verDia('${d}')" title="Ver este día">${esc(vetDiaSemana(d).slice(0, 3))} ${Number(d.slice(8, 10))} <span class="cl-sub">· ${del.filter(c => c.estado !== 'cancelada').length}</span></div>
      ${del.map(c => `<div class="ag-mini est-${esc(c.estado)}" onclick="verDia('${d}')"><b>${esc(vetFormatoHora(c.hora))}</b> ${esc(clinicaNombrePaciente(pacienteDe(c)))}${AG.alergias[c.paciente_id] ? ' ⚠️' : ''}</div>`).join('') || '<div class="cl-sub" style="padding:8px 10px">—</div>'}</div>`;
  }).join('');
}

/* ---------- Atender / estados ---------- */
function atender(id) { window.location.href = 'clinica-pacientes.html?cita=' + encodeURIComponent(id); }
async function cambiarEstado(id, estado) {
  if (estado === 'cancelada') { AG.citaCancelar = id; $a('cn-motivo').value = ''; $a('cn-error').textContent = ''; openModal('modal-cancelar'); return; }
  const cambios = { estado };
  if (estado === 'en_espera') cambios.llegada_en = new Date().toISOString();
  if (estado === 'programada') cambios.motivo_cancelacion = null;
  try {
    const { error } = await sb.from('clinica_citas').update(cambios).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast(estado === 'en_espera' ? 'Paciente en sala de espera.' : 'Cita actualizada.');
    await cargarCitas();
  } catch (e) { console.error('cambiarEstado:', e); showToast(clinicaTextoError(e, 'No se pudo cambiar el estado.'), 'error'); }
}
async function confirmarCancelacion() {
  const motivo = $a('cn-motivo').value.trim();
  if (motivo.length < 3) { $a('cn-error').textContent = 'Escribe brevemente por qué se cancela.'; return; }
  try {
    const { error } = await sb.from('clinica_citas').update({ estado: 'cancelada', motivo_cancelacion: motivo.slice(0, 200) }).eq('id', AG.citaCancelar).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    closeModal('modal-cancelar'); showToast('Cita cancelada.'); await cargarCitas();
  } catch (e) { console.error('cancelar:', e); $a('cn-error').textContent = clinicaTextoError(e, 'No se pudo cancelar.'); }
}
async function recordar(id) {
  const c = AG.citas.find(x => x.id === id); if (!c) return;
  const p = pacienteDe(c);
  const tel = vetTelefonoWhatsApp(p.telefono, STATE.empresaConfig?.pais);
  if (!tel) { showToast('El paciente no tiene un teléfono válido. Agrégalo en su ficha.', 'error'); return; }
  const texto = clinicaMensajeCita({ paciente: p.nombres, negocio: STATE.empresaConfig?.nombre_comercial, fecha: c.fecha, hora: c.hora, medico: nombreMedico(c.medico_id) });
  window.open(vetEnlaceWhatsApp(tel, texto), '_blank', 'noopener');
  try {
    const ahora = new Date().toISOString();
    const { error } = await sb.from('clinica_citas').update({ recordatorio_enviado_en: ahora }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (!error) { c.recordatorio_enviado_en = ahora; renderAgenda(); }
  } catch (e) { console.warn('recordar:', e); }
}

/* ---------- Nueva cita / editar ---------- */
function pintarSelectores(c) {
  const selM = $a('ci-medico'), selK = $a('ci-consultorio'), selE = $a('ci-especialidad');
  selM.innerHTML = (AG.medicos.length > 1 ? '<option value="">— Sin asignar —</option>' : '') + AG.medicos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}${m.especialidad ? ' · ' + esc(m.especialidad) : ''}</option>`).join('');
  $a('ci-medico-wrap').style.display = AG.medicos.length ? '' : 'none';
  selM.value = c?.medico_id || ($a('ag-medico').value || (AG.medicos.length === 1 ? AG.medicos[0].id : ''));
  selK.innerHTML = '<option value="">— Ninguno —</option>' + AG.consultorios.map(k => `<option value="${esc(k.id)}">${esc(k.nombre)}</option>`).join('');
  $a('ci-consultorio-wrap').style.display = AG.consultorios.length ? '' : 'none';
  selK.value = c?.consultorio_id || (AG.medicos.find(m => m.id === selM.value)?.consultorio_id || '');
  selE.innerHTML = AG.especialidades.map(k => `<option value="${esc(k)}">${esc(clinicaNombreEspecialidad(k))}</option>`).join('');
  $a('ci-especialidad-wrap').style.display = AG.especialidades.length > 1 ? '' : 'none';
  selE.value = c?.especialidad && AG.especialidades.includes(c.especialidad) ? c.especialidad : AG.especialidades[0];
  const selT = $a('ci-tipo');
  if (!selT.options.length) Object.entries(CLINICA_TIPOS_CITA).forEach(([k, v]) => selT.add(new Option(`${v.e} ${v.n}`, k)));
}
function alCambiarMedico() { const m = AG.medicos.find(x => x.id === $a('ci-medico').value); if (m?.consultorio_id) $a('ci-consultorio').value = m.consultorio_id; }
function abrirCita(id, pre) {
  const c = id ? AG.citas.find(x => x.id === id) : null;
  AG.editId = c ? c.id : null;
  $a('ci-titulo').textContent = c ? '✏️ Editar cita' : '📅 Nueva cita';
  pintarSelectores(c);
  $a('ci-tipo').value = c?.tipo || pre?.tipo || 'consulta';
  $a('ci-duracion').value = String(c?.duracion_min || 30);
  $a('ci-fecha').value = c?.fecha || pre?.fecha || AG.fecha;
  $a('ci-hora').value = c ? String(c.hora).slice(0, 5) : '';
  $a('ci-motivo').value = c?.motivo || ''; $a('ci-notas').value = c?.notas || '';
  $a('ci-error').textContent = '';
  AG.paciente = null; $a('ci-p-elegido').style.display = 'none'; $a('ci-p-buscar').value = ''; $a('ci-p-resultados').style.display = 'none';
  $a('ci-p-nuevo').style.display = 'none'; ['ci-np-nombres', 'ci-np-apellidos', 'ci-np-tel', 'ci-np-cedula'].forEach(i => { $a(i).value = ''; });
  $a('ci-p-buscar-wrap').style.display = '';
  const p = c ? pacienteDe(c) : pre?.paciente;
  if (p && p.id) elegirPaciente(p.id, clinicaNombrePaciente(p), p.telefono || '');
  openModal('modal-cita');
}
function cerrarCita() { closeModal('modal-cita'); }
function elegirPaciente(id, nombre, tel) {
  AG.paciente = { id, nombre, tel };
  $a('ci-p-resultados').style.display = 'none'; $a('ci-p-buscar').value = ''; $a('ci-p-buscar-wrap').style.display = 'none'; $a('ci-p-nuevo').style.display = 'none';
  const el = $a('ci-p-elegido');
  el.innerHTML = `<span>👤 ${esc(nombre)}${tel ? ' · ' + esc(tel) : ''}</span><button class="cl-link" type="button" onclick="quitarPaciente()">Cambiar</button>`;
  el.style.display = '';
}
function quitarPaciente() { AG.paciente = null; $a('ci-p-elegido').style.display = 'none'; $a('ci-p-buscar-wrap').style.display = ''; $a('ci-p-buscar').focus(); }
let _tBusca = null;
function buscarPaciente(q) {
  clearTimeout(_tBusca);
  const cont = $a('ci-p-resultados');
  q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _tBusca = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('clinica_pacientes').select('id, nombres, apellidos, telefono, cedula, numero_expediente')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .or(`nombres.ilike.%${q}%,apellidos.ilike.%${q}%,cedula.ilike.%${q}%,telefono.ilike.%${q}%,numero_expediente.ilike.%${q}%`).order('nombres').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length)
        ? data.map(p => `<div class="cl-resultado" tabindex="0" data-id="${esc(p.id)}" data-n="${esc(clinicaNombrePaciente(p))}" data-t="${esc(p.telefono || '')}">${esc(clinicaNombrePaciente(p))} <span class="cl-sub">· ${esc(p.numero_expediente || '')}${p.cedula ? ' · ' + esc(p.cedula) : ''}</span></div>`).join('')
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados — regístralo abajo</div>';
      cont.querySelectorAll('[data-id]').forEach(el => { const f = () => elegirPaciente(el.dataset.id, el.dataset.n, el.dataset.t); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
      cont.style.display = '';
    } catch (e) { console.error('buscarPaciente:', e); }
  }, 250);
}
function mostrarNuevoPaciente() { const w = $a('ci-p-nuevo'); w.style.display = w.style.display === 'none' ? '' : 'none'; if (w.style.display === '') $a('ci-np-nombres').focus(); }
async function crearPacienteRapido() {
  const err = $a('ci-error'); err.textContent = '';
  const nombres = $a('ci-np-nombres').value.trim();
  if (!nombres) { err.textContent = 'Escribe el nombre del paciente.'; return; }
  try {
    const { data, error } = await sb.from('clinica_pacientes').insert({ auth_user_id: STATE.userId, nombres, apellidos: $a('ci-np-apellidos').value.trim() || null,
      telefono: $a('ci-np-tel').value.trim() || null, cedula: $a('ci-np-cedula').value.trim() || null }).select('id, nombres, apellidos, telefono').single();
    if (error) throw error;
    elegirPaciente(data.id, clinicaNombrePaciente(data), data.telefono || '');
    showToast('Paciente registrado. Completa su ficha luego en Pacientes.');
  } catch (e) { console.error('crearPacienteRapido:', e); err.textContent = clinicaTextoError(e, 'No se pudo registrar el paciente.'); }
}
async function guardarCita() {
  const err = $a('ci-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const fecha = $a('ci-fecha').value, hora = $a('ci-hora').value, dur = Number($a('ci-duracion').value);
  if (!AG.paciente) return fallo('Elige el paciente (o regístralo).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fallo('Indica la fecha.');
  if (!/^\d{2}:\d{2}/.test(hora)) return fallo('Indica la hora.');
  if (!AG.editId && fecha < vetHoy()) return fallo('No se pueden agendar citas en días que ya pasaron.');
  if (vetHoraMin(hora) + dur > 1440) return fallo('La cita debe terminar antes de la medianoche.');
  const medico = AG.medicos.length ? ($a('ci-medico').value || null) : null;
  const nueva = { fecha, hora, duracion_min: dur, medico_id: medico };
  try {
    const { data: delDia } = await sb.from('clinica_citas').select('id, fecha, hora, duracion_min, medico_id, estado').eq('auth_user_id', STATE.userId).eq('fecha', fecha);
    const choque = clinicaChoqueCita(nueva, delDia || [], AG.editId);
    if (choque) return fallo(`${nombreMedico(medico) || 'Ese médico'} ya tiene una cita de ${vetRangoCita(choque.hora, choque.duracion_min)}. Elige otra hora.`);
  } catch (_) { /* el servidor igual lo verifica */ }
  const payload = { paciente_id: AG.paciente.id, medico_id: medico, consultorio_id: $a('ci-consultorio').value || null, fecha, hora, duracion_min: dur,
    tipo: $a('ci-tipo').value, especialidad: $a('ci-especialidad').value || null, motivo: $a('ci-motivo').value.trim().slice(0, 200) || null,
    notas: $a('ci-notas').value.trim().slice(0, 500) || null };
  const btn = $a('ci-btn-guardar'); btn.disabled = true;
  try {
    const q = AG.editId
      ? sb.from('clinica_citas').update(payload).eq('id', AG.editId).eq('auth_user_id', STATE.userId)
      : sb.from('clinica_citas').insert({ ...payload, auth_user_id: STATE.userId });
    const { error } = await q;
    if (error) throw error;
    showToast(AG.editId ? 'Cita actualizada.' : 'Cita agendada.');
    closeModal('modal-cita');
    if (fecha !== AG.fecha && AG.vista === 'dia') AG.fecha = fecha;
    await cargarCitas();
  } catch (e) { console.error('guardarCita:', e); fallo(clinicaTextoError(e, 'No se pudo guardar la cita.')); }
  finally { btn.disabled = false; }
}

/* ---------- Cuenta de la visita y cobro (por Ventas, como Veterinaria) ---------- */
async function abrirCuenta(citaId) {
  AG.citaCuenta = citaId; AG.prodCargo = null;
  $a('cu-buscar').value = ''; $a('cu-resultados').style.display = 'none'; $a('cu-elegido').style.display = 'none';
  $a('cu-cantidad').value = '1'; $a('cu-error').textContent = '';
  const c = AG.citas.find(x => x.id === citaId);
  $a('cu-titulo').textContent = `💳 Cuenta — ${clinicaNombrePaciente(pacienteDe(c))}`;
  openModal('modal-cuenta');
  await pintarCuenta();
}
async function pintarCuenta() {
  const cont = $a('cu-lista');
  try {
    const { data, error } = await sb.from('clinica_cargos').select('id, producto_id, descripcion, cantidad, productos(precio, nombre)')
      .eq('auth_user_id', STATE.userId).eq('cita_id', AG.citaCuenta).order('created_at');
    if (error) throw error;
    AG.cuenta = data || [];
    const total = AG.cuenta.reduce((t, x) => t + Number(x.cantidad) * Number(x.productos?.precio || 0), 0);
    cont.innerHTML = AG.cuenta.length
      ? `<table class="cl-tabla-cuenta">${AG.cuenta.map(x => `<tr><td>${esc(vetFormatoNumero(x.cantidad))} ×</td><td>${esc(x.descripcion)}${x.producto_id ? '' : ' <span class="cl-badge cl-badge-rojo">ya no existe</span>'}</td>
          <td style="text-align:right;white-space:nowrap">${x.productos?.precio != null ? esc(fmt(Number(x.cantidad) * Number(x.productos.precio))) : '—'}</td>
          <td style="text-align:right"><button class="cl-link" onclick="quitarCargo('${x.id}')" aria-label="Quitar">quitar</button></td></tr>`).join('')}</table>
         <div class="cl-total">Total estimado: ${esc(fmt(total))}</div><p class="cl-sub" style="text-align:right;margin:2px 0 0">El total final (impuestos, descuentos) lo calcula Ventas.</p>`
      : '<p class="cl-sub">La cuenta está vacía. Agrega la consulta y lo que se usó o vendió.</p>';
    $a('cu-btn-cobrar').disabled = !AG.cuenta.some(x => x.producto_id);
  } catch (e) { console.error('pintarCuenta:', e); cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la cuenta.</p>'; }
}
function elegirProducto(id, nombre) {
  AG.prodCargo = { id, nombre };
  $a('cu-resultados').style.display = 'none'; $a('cu-buscar').value = '';
  const el = $a('cu-elegido'); el.innerHTML = `<span>✔ ${esc(nombre)}</span>`; el.style.display = '';
}
let _tProd = null;
function buscarProducto(q) {
  clearTimeout(_tProd);
  const cont = $a('cu-resultados'); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _tProd = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('productos').select('id, nombre, precio, tipo')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .or('es_sustancia_controlada.is.null,es_sustancia_controlada.eq.false')   // las controladas se venden desde su propio módulo
        .ilike('nombre', `%${q}%`).order('nombre').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length)
        ? data.map(p => `<div class="cl-resultado" tabindex="0" data-id="${esc(p.id)}" data-n="${esc(p.nombre)}">${p.tipo === 'servicio' ? '🛎️' : '📦'} ${esc(p.nombre)} <span class="cl-sub">· ${esc(fmt(p.precio || 0))}</span></div>`).join('')
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados. Crea el servicio (ej. "Consulta general") en Productos/Servicios.</div>';
      cont.querySelectorAll('[data-id]').forEach(el => { const f = () => elegirProducto(el.dataset.id, el.dataset.n); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
      cont.style.display = '';
    } catch (e) { console.error('buscarProducto:', e); }
  }, 250);
}
async function agregarCargo() {
  const err = $a('cu-error'); err.textContent = '';
  const cant = Number($a('cu-cantidad').value);
  if (!AG.prodCargo) { err.textContent = 'Busca y elige el servicio o producto.'; return; }
  if (!(cant > 0) || cant > 100000) { err.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  const btn = $a('cu-btn-agregar'); btn.disabled = true;
  try {
    const { error } = await sb.from('clinica_cargos').insert({ auth_user_id: STATE.userId, cita_id: AG.citaCuenta, producto_id: AG.prodCargo.id, descripcion: AG.prodCargo.nombre.slice(0, 200), cantidad: cant });
    if (error) throw error;
    AG.prodCargo = null; $a('cu-elegido').style.display = 'none'; $a('cu-cantidad').value = '1';
    await pintarCuenta(); cargarCitas();
  } catch (e) { console.error('agregarCargo:', e); err.textContent = clinicaTextoError(e, 'No se pudo agregar.'); }
  finally { btn.disabled = false; }
}
async function quitarCargo(id) {
  try {
    const { error } = await sb.from('clinica_cargos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    await pintarCuenta(); cargarCitas();
  } catch (e) { console.error('quitarCargo:', e); showToast(clinicaTextoError(e, 'No se pudo quitar.'), 'error'); }
}
// Cobrar = abrir Ventas con el paciente (como cliente) y la cuenta ya cargada. La venta queda ligada a la cita.
async function cobrarCita() {
  const c = AG.citas.find(x => x.id === AG.citaCuenta);
  const items = (AG.cuenta || []).filter(x => x.producto_id);
  if (!c) return;
  if (!items.length) { $a('cu-error').textContent = 'La cuenta está vacía.'; return; }
  const btn = $a('cu-btn-cobrar'); btn.disabled = true;
  try {
    // ¿Ya se cobró? (por si otra persona la cobró mientras tanto)
    const { data: actual } = await sb.from('clinica_citas').select('venta_id, ventas(estado, numero_venta)').eq('id', c.id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (actual?.ventas?.estado === 'completada') { showToast(`Esta visita ya fue cobrada (${actual.ventas.numero_venta}).`, 'error'); closeModal('modal-cuenta'); await cargarCitas(); return; }
    // El paciente se cobra como cliente: si todavía no está en Clientes, se crea y se liga.
    const p = pacienteDe(c);
    let clienteId = p.cliente_id;
    if (clienteId) {
      const { data: cli } = await sb.from('clientes').select('id').eq('id', clienteId).eq('auth_user_id', STATE.userId).maybeSingle();
      if (!cli) clienteId = null;
    }
    if (!clienteId) {
      const { data: nuevo, error } = await sb.from('clientes').insert({ auth_user_id: STATE.userId, nombre: p.nombres || 'Paciente', apellido: p.apellidos || null, telefono: p.telefono || null }).select('id').single();
      if (error) throw error;
      clienteId = nuevo.id;
      const { error: e2 } = await sb.from('clinica_pacientes').update({ cliente_id: clienteId }).eq('id', p.id).eq('auth_user_id', STATE.userId);
      if (e2) throw e2;
    }
    sessionStorage.setItem('n360_clinica_cobro', JSON.stringify({ citaId: c.id, clienteId, paciente: clinicaNombrePaciente(p),
      items: items.map(x => ({ producto_id: x.producto_id, cantidad: Number(x.cantidad) })) }));
    window.location.href = 'ventas.html';
  } catch (e) { console.error('cobrarCita:', e); $a('cu-error').textContent = 'No se pudo preparar el cobro. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}

/* ---------- Tutorial ---------- */
const PASOS_TUTORIAL = [
  { icono: '📅', titulo: 'Agenda de la clínica', texto: 'Aquí ves las citas del día o de la semana. Con "+ Nueva cita" agendas a un paciente (si es nuevo, lo registras ahí mismo).' },
  { icono: '🪑', titulo: 'Cuando el paciente llega', texto: 'Toca "Llegó" y queda en sala de espera. El médico toca "Atender" para abrir su expediente y escribir la consulta.' },
  { icono: '🔒', titulo: 'Expediente protegido', texto: 'Las notas médicas solo las ve el personal médico con su PIN personal. Recepción maneja la agenda y el cobro, pero no ve el expediente.' },
  { icono: '💳', titulo: 'Cobrar la visita', texto: 'En "Cuenta" agregas la consulta y lo que se usó. "Cobrar en Ventas" abre la venta lista: caja, inventario e impuestos quedan exactos, como cualquier venta.' },
];
function mostrarTutorial(forzar) {
  try {
    if (!window.Negocio360Tutorial) return;
    if (forzar) Negocio360Tutorial.mostrar('clinica_agenda', PASOS_TUTORIAL);
    else Negocio360Tutorial.verificarYMostrar('clinica_agenda', PASOS_TUTORIAL);
  } catch (e) { console.warn('tutorial:', e); }
}
