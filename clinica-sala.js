/* =====================================================
   CLINICA-SALA.JS — NEGOCIO360 · Módulo Clínica (Fase 3)
   Sala de espera del día: quién llegó (turno por orden de
   llegada y tiempo esperando), quién está en consulta y
   quién falta por llegar. "Llamar" avisa en la pantalla de
   la sala (modo pantalla), que solo muestra el nombre y la
   inicial del apellido. Información administrativa.
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
   SALA DE ESPERA
===================================================== */
const SA = { citas: [], personal: [], consultorios: [], ultimoLlamado: null, pantalla: false, timer: null };
const $s = id => document.getElementById(id);

async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;
    await loadEmpresaConfig(user.id);
    if (STATE.empresaConfig?.usa_modulo_clinica !== true) { window.location.href = 'dashboard.html'; return; }
    renderUserInfo(await loadUserProfile(user.id), user.email);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    const [p, k] = await Promise.all([
      sb.from('clinica_personal').select('id, nombre').eq('auth_user_id', STATE.userId),
      sb.from('clinica_consultorios').select('id, nombre').eq('auth_user_id', STATE.userId),
    ]);
    SA.personal = p.data || []; SA.consultorios = k.data || [];
    await cargar();
    if (new URLSearchParams(location.search).get('pantalla') === '1') abrirPantalla();
    SA.timer = setInterval(() => { cargar(true); }, 20000);           // la sala se actualiza sola
  } catch (e) {
    console.error('init clinica-sala:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

const medico = id => SA.personal.find(p => p.id === id)?.nombre || '';
const consultorio = id => SA.consultorios.find(k => k.id === id)?.nombre || '';
async function cargar(silencioso) {
  try {
    const { data, error } = await sb.from('clinica_citas')
      .select('id, paciente_id, medico_id, consultorio_id, hora, duracion_min, estado, motivo, llegada_en, llamado_en, fecha, clinica_pacientes(nombres, apellidos, telefono, numero_expediente)')
      .eq('auth_user_id', STATE.userId).eq('fecha', vetHoy()).order('hora');
    if (error) throw error;
    SA.citas = data || [];
    render();
  } catch (e) { console.error('cargar sala:', e); if (!silencioso) $s('sa-espera').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la sala.</p>'; }
}
function render() {
  const turnos = clinicaTurnos(SA.citas);
  const turnoDe = id => turnos.find(t => t.id === id)?.turno;
  const espera = turnos.filter(t => t.estado === 'en_espera');
  const enConsulta = SA.citas.filter(c => c.estado === 'en_consulta');
  const porLlegar = SA.citas.filter(c => ['programada', 'confirmada'].includes(c.estado));
  $s('sa-kpi-espera').textContent = espera.length; $s('sa-kpi-consulta').textContent = enConsulta.length;
  $s('sa-kpi-llegar').textContent = porLlegar.length; $s('sa-kpi-atendidos').textContent = SA.citas.filter(c => c.estado === 'atendida').length;
  const nombre = c => clinicaNombrePaciente(c.clinica_pacientes || {});
  const donde = c => [medico(c.medico_id) && '👨‍⚕️ ' + medico(c.medico_id), consultorio(c.consultorio_id) && '🚪 ' + consultorio(c.consultorio_id)].filter(Boolean).map(esc).join(' · ');
  $s('sa-espera').innerHTML = espera.length ? espera.map(c => `<div class="ag-card est-en_espera">
      <div class="ag-fila"><span class="ag-hora">Turno ${c.turno}</span><span class="cl-badge ${c.espera_min >= 30 ? 'cl-badge-rojo' : 'cl-badge-ambar'}">⏱️ ${esc(clinicaTextoEspera(c.espera_min))}</span></div>
      <div class="cl-nombre">${esc(nombre(c))}</div><div class="cl-sub">Cita ${esc(vetFormatoHora(c.hora))}${c.motivo ? ' · ' + esc(c.motivo) : ''}</div><div class="cl-sub">${donde(c) || 'Sin médico asignado'}</div>
      ${c.llamado_en ? `<div class="cl-sub">📢 Llamado a las ${esc(new Date(c.llamado_en).toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit' }))}</div>` : ''}
      <div class="ag-btns"><button class="btn-accion-tabla btn-primary" onclick="llamar('${c.id}')">📢 Llamar</button>
        <button class="btn-accion-tabla btn-ghost" onclick="location.href='clinica-pacientes.html?cita=${c.id}'">🩺 Atender</button>
        <button class="btn-accion-tabla btn-ghost" onclick="cambiar('${c.id}','programada')">↩ Aún no llega</button></div></div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">Nadie esperando en este momento.</div>';
  $s('sa-consulta').innerHTML = enConsulta.length ? enConsulta.map(c => `<div class="ag-card est-en_consulta"><div class="ag-fila"><span class="ag-hora">${turnoDe(c.id) ? 'Turno ' + turnoDe(c.id) : 'En consulta'}</span><span class="cl-badge cl-badge-morado">En consulta</span></div>
      <div class="cl-nombre">${esc(nombre(c))}</div><div class="cl-sub">${donde(c)}</div></div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">Ningún paciente en consulta.</div>';
  $s('sa-llegar').innerHTML = porLlegar.length ? porLlegar.map(c => `<div class="ag-card est-${esc(c.estado)}"><div class="ag-fila"><span class="ag-hora">${esc(vetFormatoHora(c.hora))}</span><span class="cl-badge cl-badge-${CLINICA_ESTADOS_CITA[c.estado].clase}">${esc(CLINICA_ESTADOS_CITA[c.estado].n)}</span></div>
      <div class="cl-nombre">${esc(nombre(c))}</div><div class="cl-sub">${donde(c)}</div>
      <div class="ag-btns"><button class="btn-accion-tabla btn-primary" onclick="cambiar('${c.id}','en_espera')">🪑 Llegó</button><button class="btn-accion-tabla btn-ghost" onclick="cambiar('${c.id}','no_asistio')">🚫 No asistió</button></div></div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">No falta nadie por llegar hoy.</div>';
  if (SA.pantalla) renderPantalla(turnos);
}
async function cambiar(id, estado) {
  const cambios = { estado };
  if (estado === 'en_espera') cambios.llegada_en = new Date().toISOString();
  if (estado === 'programada') { cambios.llegada_en = null; cambios.llamado_en = null; }
  try {
    const { error } = await sb.from('clinica_citas').update(cambios).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    await cargar();
  } catch (e) { console.error('cambiar:', e); showToast(clinicaTextoError(e, 'No se pudo cambiar.'), 'error'); }
}
async function llamar(id) {
  try {
    const { error } = await sb.from('clinica_citas').update({ llamado_en: new Date().toISOString() }).eq('id', id).eq('auth_user_id', STATE.userId).eq('estado', 'en_espera');
    if (error) throw error;
    showToast('Paciente llamado: aparece en la pantalla de la sala.');
    await cargar();
  } catch (e) { console.error('llamar:', e); showToast('No se pudo llamar.', 'error'); }
}

/* ---------- Modo pantalla (televisor de la sala): solo nombre e inicial ---------- */
function abrirPantalla() {
  SA.pantalla = true; $s('sa-pantalla').style.display = 'flex'; document.body.style.overflow = 'hidden';
  try { document.documentElement.requestFullscreen?.(); } catch (_) {}
  renderPantalla(clinicaTurnos(SA.citas));
}
function cerrarPantalla() {
  SA.pantalla = false; $s('sa-pantalla').style.display = 'none'; document.body.style.overflow = '';
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
}
function sonar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35].forEach((t, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = i ? 660 : 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32); });
  } catch (_) {}
}
function renderPantalla(turnos) {
  const recientes = SA.citas.filter(c => c.llamado_en && c.estado === 'en_espera' && Date.now() - new Date(c.llamado_en).getTime() < 10 * 60000)
    .sort((a, b) => String(b.llamado_en).localeCompare(String(a.llamado_en)));
  const ult = recientes[0];
  if (ult && ult.llamado_en !== SA.ultimoLlamado) { SA.ultimoLlamado = ult.llamado_en; sonar(); }
  const t = id => turnos.find(x => x.id === id)?.turno;
  $s('sp-llamado').innerHTML = ult
    ? `<div class="sp-turno">Turno ${esc(t(ult.id) || '')}</div><div class="sp-nombre">${esc(clinicaNombreCorto(ult.clinica_pacientes))}</div>
       <div class="sp-donde">${esc([consultorio(ult.consultorio_id), medico(ult.medico_id)].filter(Boolean).join(' · ') || 'Pase a consulta')}</div>`
    : '<div class="sp-nombre" style="opacity:.6">Bienvenido</div><div class="sp-donde">Espere a ser llamado</div>';
  const espera = turnos.filter(x => x.estado === 'en_espera');
  $s('sp-lista').innerHTML = espera.length ? espera.map(x => `<div class="sp-item"><b>${x.turno}</b> ${esc(clinicaNombreCorto(x.clinica_pacientes))}</div>`).join('') : '<div class="sp-item" style="opacity:.6">—</div>';
  $s('sp-hora').textContent = new Date().toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit' });
  $s('sp-negocio').textContent = STATE.empresaConfig?.nombre_comercial || 'Sala de espera';
}
