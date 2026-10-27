/* =====================================================
   CLINICA-SALA.JS — NEGOCIO360 · Módulo Clínica
   Sala de espera del día sobre las citas de la AGENDA del
   sistema: quién llegó (turno por orden de llegada y tiempo
   esperando), quién está en consulta y quién falta por
   llegar. "Llamar" avisa en la pantalla de la sala (modo
   pantalla), que solo muestra el nombre y la inicial del
   apellido. También: recordatorios por WhatsApp, cuenta de
   la visita y cobro (por el mismo camino de la Agenda).
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = { userId: null, empresaConfig: {}, currentUser: {} };

function fmt(amount) {
  const sym = typeof monedaParaMostrar === 'function' ? monedaParaMostrar(STATE.empresaConfig?.moneda) : 'C$';
  const n = typeof convertirParaMostrar === 'function' ? convertirParaMostrar(amount, STATE.empresaConfig?.moneda) : Number(amount || 0);
  return `${sym} ${Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
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
const SA = { citas: [], personal: [], consultorios: [], ultimoLlamado: null, pantalla: false, timer: null, canal: null, enVivo: false, audio: null, cargando: null, otraVez: false, recordar: [], citaCuenta: null, cuenta: [], prodCargo: null, vincular: null };
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
    const { data: k } = await sb.from('clinica_consultorios').select('id, nombre').eq('auth_user_id', STATE.userId);
    SA.consultorios = k || [];
    await cargar();
    if (new URLSearchParams(location.search).get('pantalla') === '1') abrirPantalla();
    conectarEnVivo();
    SA.timer = setInterval(() => { cargar(true); }, 15000);           // respaldo: por si se pierde un aviso o cambian algo desde la Agenda
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(true); });
  } catch (e) {
    console.error('init clinica-sala:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

const medico = id => SA.personal.find(p => p.id === id)?.nombre || '';
const consultorio = id => SA.consultorios.find(k => k.id === id)?.nombre || '';
const citaPorId = id => SA.citas.find(c => c.id === id) || SA.recordar.find(c => c.id === id) || null;
// Evita cargas encimadas: si llega otro aviso mientras se carga, se vuelve a cargar al terminar.
async function cargar(silencioso) {
  if (SA.cargando) { SA.otraVez = true; return SA.cargando; }
  SA.cargando = cargarYa(silencioso);
  try { await SA.cargando; } finally { SA.cargando = null; }
  if (SA.otraVez) { SA.otraVez = false; return cargar(true); }
}
async function cargarYa(silencioso) {
  try {
    const r = await ClinicaCitas.cargar(vetHoy(), vetHoy());
    SA.personal = r.medicos;
    SA.citas = r.citas.sort((a, b) => a.hora.localeCompare(b.hora));
    render();
  } catch (e) { console.error('cargar sala:', e); if (!silencioso) $s('sa-espera').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la sala.</p>'; }
}
function render() {
  const turnos = clinicaTurnos(SA.citas);
  const turnoDe = id => turnos.find(t => t.id === id)?.turno;
  const espera = clinicaOrdenEspera(turnos);                  // urgentes primero, luego por turno
  const enConsulta = SA.citas.filter(c => c.estado === 'en_consulta');
  const porLlegar = SA.citas.filter(c => ['programada', 'confirmada'].includes(c.estado));
  const atendidos = SA.citas.filter(c => c.estado === 'atendida');
  $s('sa-kpi-espera').textContent = espera.length; $s('sa-kpi-consulta').textContent = enConsulta.length;
  $s('sa-kpi-llegar').textContent = porLlegar.length; $s('sa-kpi-atendidos').textContent = atendidos.length;
  const nombre = c => clinicaNombrePaciente(c.clinica_pacientes || {});
  const donde = c => [medico(c.medico_id) && '👨‍⚕️ ' + medico(c.medico_id), consultorio(c.consultorio_id) && '🚪 ' + consultorio(c.consultorio_id)].filter(Boolean).map(esc).join(' · ');
  const sinExp = c => c.paciente_id ? '' : '<div class="cl-sub" style="color:var(--warning,#b45309)">⚠️ Sin expediente: al atender se elige o se crea.</div>';
  const cobrada = c => c.venta_id ? '<span class="cl-badge cl-badge-verde">Cobrada</span>' : '';
  const btnCuenta = c => c.venta_id ? '' : `<button class="btn-accion-tabla btn-ghost" onclick="abrirCuenta('${c.id}')">💳 Cuenta y cobro</button>`;
  const llamando = c => c.llamado_en && Date.now() - new Date(c.llamado_en).getTime() < 2 * 60000;
  const marcas = c => (c.prioridad === 'urgente' ? ' <span class="cl-badge cl-badge-rojo">🚨 Urgente</span>' : '') + (c.sin_cita ? ' <span class="cl-badge cl-badge-azul">🚶 Sin cita</span>' : '');
  $s('sa-espera').innerHTML = espera.length ? espera.map(c => `<div class="ag-card est-en_espera${llamando(c) ? ' sa-llamando' : ''}${c.prioridad === 'urgente' ? ' sa-urgente' : ''}">
      <div class="ag-fila"><span class="ag-hora">Turno ${c.turno}${marcas(c)}</span><span class="cl-badge ${c.espera_min >= 30 ? 'cl-badge-rojo' : 'cl-badge-ambar'}">⏱️ ${esc(clinicaTextoEspera(c.espera_min))}</span></div>
      <div class="cl-nombre">${esc(nombre(c))}</div><div class="cl-sub">${c.sin_cita ? 'Llegó ' + esc(vetFormatoHora(c.hora)) : 'Cita ' + esc(vetFormatoHora(c.hora))}${c.motivo ? ' · ' + esc(c.motivo) : ''}</div>${c.sin_cita && c.notas ? `<div class="cl-sub">📝 ${esc(c.notas)}</div>` : ''}<div class="cl-sub">${donde(c) || 'Sin médico asignado'}</div>${sinExp(c)}
      ${c.llamado_en ? `<div class="cl-sub">📢 Llamado a las ${esc(new Date(c.llamado_en).toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit' }))}</div>` : ''}
      <div class="ag-btns"><button class="btn-accion-tabla btn-primary" onclick="pasarAConsulta('${c.id}')">▶️ Pasar a consulta</button>
        <button class="btn-accion-tabla btn-ghost" onclick="llamar('${c.id}')">📢 Llamar</button>
        <button class="btn-accion-tabla btn-ghost" onclick="atender('${c.id}')">🩺 Atender</button>
        <button class="btn-accion-tabla btn-ghost" onclick="aunNoLlega('${c.id}')">↩ Aún no llega</button></div></div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">Nadie esperando en este momento.</div>';
  $s('sa-consulta').innerHTML = enConsulta.length ? enConsulta.map(c => `<div class="ag-card est-en_consulta"><div class="ag-fila"><span class="ag-hora">${turnoDe(c.id) ? 'Turno ' + turnoDe(c.id) : 'En consulta'}</span><span class="cl-badge cl-badge-morado">En consulta</span></div>
      <div class="cl-nombre">${esc(nombre(c))}</div><div class="cl-sub">${donde(c)}</div>
      ${c.llamado_en ? `<div class="cl-sub">▶️ Entró a las ${esc(new Date(c.llamado_en).toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit' }))}</div>` : ''}
      <div class="ag-btns"><button class="btn-accion-tabla btn-primary" onclick="terminarConsulta('${c.id}')">✅ Terminó la consulta</button>
        <button class="btn-accion-tabla btn-ghost" onclick="atender('${c.id}')">🩺 Expediente</button>${btnCuenta(c)}
        <button class="btn-accion-tabla btn-ghost" onclick="regresarAFila('${c.id}')">↩ Regresar a la fila</button></div></div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">Ningún paciente en consulta. Para que alguien entre, toca <b>▶️ Pasar a consulta</b> en su tarjeta de "Esperando".</div>';
  $s('sa-llegar').innerHTML = porLlegar.length ? porLlegar.map(c => `<div class="ag-card est-${esc(c.estado)}"><div class="ag-fila"><span class="ag-hora">${esc(vetFormatoHora(c.hora))}</span><span class="cl-badge cl-badge-${CLINICA_ESTADOS_CITA[c.estado].clase}">${esc(CLINICA_ESTADOS_CITA[c.estado].n)}</span></div>
      <div class="cl-nombre">${esc(nombre(c))}</div><div class="cl-sub">${c.motivo ? esc(c.motivo) : ''}</div><div class="cl-sub">${donde(c)}</div>
      <div class="ag-btns"><button class="btn-accion-tabla btn-primary" onclick="llego('${c.id}')">🪑 Llegó</button><button class="btn-accion-tabla btn-ghost" onclick="noAsistio('${c.id}')">🚫 No asistió</button></div></div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">No falta nadie por llegar hoy.</div>';
  $s('sa-atendidos').innerHTML = atendidos.length ? atendidos.map(c => `<div class="ag-card est-atendida"><div class="ag-fila"><span class="ag-hora">${esc(vetFormatoHora(c.hora))}</span>${cobrada(c) || '<span class="cl-badge cl-badge-ambar">Falta cobrar</span>'}</div>
      <div class="cl-nombre">${esc(nombre(c))}</div><div class="cl-sub">${donde(c)}</div>
      <div class="ag-btns">${c.paciente_id ? `<button class="btn-accion-tabla btn-ghost" onclick="atender('${c.id}')">🩺 Expediente</button>` : ''}${btnCuenta(c)}</div></div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">Todavía nadie atendido hoy.</div>';
  if (SA.pantalla) renderPantalla(turnos);
}

/* ---------- En vivo: cuando alguien llama o cambia la sala, los demás equipos (otra computadora, la TV,
   un teléfono) recargan al instante. El aviso NO lleva datos del paciente: solo dice "hubo un cambio" y
   cada equipo vuelve a leer la sala con su propia sesión. ---------- */
function conectarEnVivo() {
  try {
    SA.canal = sb.channel('clinica-sala-' + STATE.userId, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'cambio' }, () => cargar(true))
      .subscribe(estado => {
        const antes = SA.enVivo; SA.enVivo = estado === 'SUBSCRIBED';
        $s('sp-envivo')?.classList.toggle('on', SA.enVivo);
        if (SA.enVivo && !antes) cargar(true);                      // al (re)conectarse, ponerse al día
      });
  } catch (e) { console.warn('sala en vivo:', e); }
}
function avisarCambio() {
  try { Promise.resolve(SA.canal?.send({ type: 'broadcast', event: 'cambio', payload: {} })).catch(e => console.warn('avisar cambio:', e)); } catch (e) { console.warn('avisar cambio:', e); }
}
async function accion(fn, msgError) {
  try { await fn(); avisarCambio(); await cargar(); }
  catch (e) { console.error(msgError, e); showToast(clinicaTextoError(e, msgError), 'error'); }
}
function llego(id) {
  const c = citaPorId(id); if (!c) return;
  // Si la cita es de un cliente que ya tiene expediente, queda ligado de una vez.
  return accion(() => ClinicaCitas.guardarInfo(id, { llegada_en: new Date().toISOString(), ...(c.paciente_id ? { paciente_id: c.paciente_id } : {}) }), 'No se pudo marcar la llegada.');
}
function aunNoLlega(id) { return accion(() => ClinicaCitas.guardarInfo(id, { llegada_en: null, llamado_en: null }), 'No se pudo cambiar.'); }
// Recepción hace pasar al paciente: si no lo han llamado hace poco, se llama ahora (la pantalla de la sala
// le dice a dónde pasar) y la cita queda "En atención" en la Agenda (lo mismo que hace el expediente al
// empezar la nota). No mueve dinero.
async function pasarAConsulta(id) {
  const c = citaPorId(id); if (!c || SA.pasando) return;
  SA.pasando = true;
  try {
    if (!c.llamado_en || Date.now() - new Date(c.llamado_en).getTime() > 10 * 60000) await ClinicaCitas.guardarInfo(id, { llamado_en: new Date().toISOString() });
    await ClinicaCitas.cambiarEstado(id, 'en_atencion');
    avisarCambio(); await cargar();
    const donde = [consultorio(c.consultorio_id), medico(c.medico_id)].filter(Boolean).join(' · ');
    showToast(`▶️ ${clinicaNombrePaciente(c.clinica_pacientes || {})} pasó a consulta${donde ? ' (' + donde + ')' : ''}.`);
  } catch (e) { console.error('pasarAConsulta:', e); showToast(clinicaTextoError(e, 'No se pudo pasar a consulta.'), 'error'); }
  finally { SA.pasando = false; }
}
// Terminó la consulta: pasa a "Atendidos" (falta cobrar). Al firmar la nota pasa solo; esto es para cuando
// el médico no escribe nota en el sistema o para adelantar a recepción.
function terminarConsulta(id) {
  return accion(async () => { await ClinicaCitas.guardarInfo(id, { atendida_en: new Date().toISOString() }); showToast('✅ Consulta terminada. Ya puedes cobrarle en "Atendidos hoy".'); }, 'No se pudo terminar la consulta.');
}
function regresarAFila(id) { return accion(() => ClinicaCitas.cambiarEstado(id, 'confirmada'), 'No se pudo regresar a la fila.'); }
function noAsistio(id) { return accion(() => ClinicaCitas.cambiarEstado(id, 'no_asistio'), 'No se pudo cambiar.'); }
async function llamar(id) {
  try {
    await ClinicaCitas.guardarInfo(id, { llamado_en: new Date().toISOString() });
    avisarCambio();
    showToast('Paciente llamado: aparece al instante en la pantalla de la sala.');
    await cargar();
  } catch (e) { console.error('llamar:', e); showToast('No se pudo llamar.', 'error'); }
}

/* ---------- Paciente que llega SIN cita: se registra su visita de hoy en la Agenda (la misma función de
   siempre, agenda_cita_guardar) y pasa directo a la fila. No se mueve dinero: se cobra igual que cualquier
   visita, al final. ---------- */
const SC = { paciente: null, nuevo: false, servicios: [], forzar: false, guardando: false };
async function abrirSinCita() {
  Object.assign(SC, { paciente: null, nuevo: false, forzar: false });
  ['sc-buscar', 'sc-nombres', 'sc-apellidos', 'sc-telefono', 'sc-cedula', 'sc-nacimiento', 'sc-motivo'].forEach(k => { $s(k).value = ''; });
  $s('sc-sexo').value = ''; $s('sc-resultados').style.display = 'none'; $s('sc-error').textContent = ''; $s('sc-aviso').innerHTML = '';
  document.querySelector('input[name="sc-prioridad"][value="normal"]').checked = true;
  sinCitaNuevo(false);
  const meds = SA.personal.filter(m => m.activo !== false && m.rol !== 'enfermeria');
  $s('sc-medico').innerHTML = '<option value="">— El primero que esté libre —</option>'
    + meds.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}${m.especialidad ? ' · ' + esc(m.especialidad) : ''}</option>`).join('');
  $s('sc-consultorio').innerHTML = '<option value="">— Sin consultorio —</option>' + SA.consultorios.map(k => `<option value="${esc(k.id)}">${esc(k.nombre)}</option>`).join('');
  try {
    const { data, error } = await sb.from('productos').select('id, nombre, precio').eq('auth_user_id', STATE.userId).eq('tipo', 'servicio').eq('activo', true).order('nombre');
    if (error) throw error;
    SC.servicios = (data || []).filter(x => !/cobertura de seguro/i.test(x.nombre));
  } catch (e) { console.error('servicios:', e); SC.servicios = []; }
  $s('sc-servicio').innerHTML = SC.servicios.length ? SC.servicios.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('')
    : '<option value="">No hay servicios: créalos en Productos/Servicios</option>';
  const consulta = SC.servicios.find(x => /consulta/i.test(x.nombre)); if (consulta) $s('sc-servicio').value = consulta.id;
  sinCitaServicio();
  openModal('modal-sincita');
  setTimeout(() => $s('sc-buscar').focus(), 50);
}
function sinCitaNuevo(si) {
  SC.nuevo = !!si; if (si) SC.paciente = null;
  $s('sc-quien').style.display = si || SC.paciente ? 'none' : '';
  $s('sc-nuevo').style.display = si ? '' : 'none';
  $s('sc-elegido').style.display = !si && SC.paciente ? '' : 'none';
  $s('sc-aviso').innerHTML = ''; SC.forzar = false;
  if (si) setTimeout(() => $s('sc-nombres').focus(), 50);
}
function sinCitaMedico() {
  const m = SA.personal.find(x => x.id === $s('sc-medico').value);
  if (m && m.consultorio_id) $s('sc-consultorio').value = m.consultorio_id;
}
function sinCitaServicio() {
  const x = SC.servicios.find(v => v.id === $s('sc-servicio').value);
  $s('sc-precio').textContent = x ? `Precio: ${fmt(x.precio)} (del catálogo). Se cobra al final de la visita, como siempre.` : '';
}
let _tSc = null;
function buscarSinCita(q) {
  clearTimeout(_tSc);
  const cont = $s('sc-resultados'); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _tSc = setTimeout(async () => {
    try {
      const [p, c] = await Promise.all([
        sb.from('clinica_pacientes').select('id, nombres, apellidos, cedula, telefono, numero_expediente, cliente_id').eq('auth_user_id', STATE.userId).eq('activo', true)
          .or(`nombres.ilike.%${q}%,apellidos.ilike.%${q}%,cedula.ilike.%${q}%,telefono.ilike.%${q}%,numero_expediente.ilike.%${q}%`).order('nombres').limit(8),
        sb.from('clientes').select('id, nombre, apellido, telefono').eq('auth_user_id', STATE.userId)
          .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%`).order('nombre').limit(8),
      ]);
      if (p.error) throw p.error;
      const pacs = p.data || [], yaPac = new Set(pacs.map(x => x.cliente_id).filter(Boolean));
      const clis = (c.data || []).filter(x => !yaPac.has(x.id)).slice(0, 5);
      SC.resultados = { pacs, clis };
      cont.innerHTML = (pacs.length || clis.length)
        ? pacs.map(x => `<div class="cl-resultado" tabindex="0" data-tipo="p" data-id="${esc(x.id)}">🩺 ${esc(clinicaNombrePaciente(x))} <span class="cl-sub">· ${esc(x.numero_expediente || '')}${x.telefono ? ' · ' + esc(x.telefono) : ''}</span></div>`).join('')
          + clis.map(x => `<div class="cl-resultado" tabindex="0" data-tipo="c" data-id="${esc(x.id)}">👤 ${esc([x.nombre, x.apellido].filter(Boolean).join(' '))} <span class="cl-sub">· cliente${x.telefono ? ' · ' + esc(x.telefono) : ''} (se le abre expediente)</span></div>`).join('')
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados. Si es la primera vez, regístralo como paciente nuevo.</div>';
      cont.querySelectorAll('[data-id]').forEach(el => { const f = () => elegirSinCita(el.dataset.tipo, el.dataset.id); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
      cont.style.display = '';
    } catch (e) { console.error('buscarSinCita:', e); }
  }, 250);
}
function elegirSinCita(tipo, id) {
  const r = SC.resultados || { pacs: [], clis: [] };
  const x = tipo === 'p' ? r.pacs.find(v => v.id === id) : r.clis.find(v => v.id === id); if (!x) return;
  SC.paciente = tipo === 'p' ? { tipo: 'paciente', ...x } : { tipo: 'cliente', id: null, cliente_id: x.id, nombres: x.nombre, apellidos: x.apellido || '', telefono: x.telefono || '' };
  $s('sc-elegido').innerHTML = `<div class="cl-item-cab"><div><div class="cl-item-tit">${tipo === 'p' ? '🩺' : '👤'} ${esc(clinicaNombrePaciente(SC.paciente))}</div>
      <div class="cl-item-fecha">${tipo === 'p' ? esc(x.numero_expediente || '') : 'Cliente (se le abre su expediente)'}${SC.paciente.telefono ? ' · ' + esc(SC.paciente.telefono) : ''}</div></div>
      <button type="button" class="btn-accion-tabla btn-ghost" onclick="SC.paciente = null; sinCitaNuevo(false); \$s('sc-buscar').focus()">Cambiar</button></div>`;
  $s('sc-resultados').style.display = 'none';
  sinCitaNuevo(false);
  avisoCitaDeHoy();
}
// ¿Ya tiene una cita hoy? Entonces lo correcto es marcar que llegó a ESA cita (no crear otra visita).
function citaDeHoyDe(p) {
  if (!p) return null;
  return SA.citas.find(c => !['cancelada', 'no_asistio', 'atendida'].includes(c.estado)
    && ((p.id && c.paciente_id === p.id) || (p.cliente_id && c.cliente_id === p.cliente_id))) || null;
}
function avisoCitaDeHoy() {
  const c = citaDeHoyDe(SC.paciente); SC.forzar = false;
  if (!c) { $s('sc-aviso').innerHTML = ''; return null; }
  const yaEsta = c.estado === 'en_espera' || c.estado === 'en_consulta';
  $s('sc-aviso').innerHTML = `<div class="cl-aviso">${yaEsta ? `Ya está en la sala (${c.estado === 'en_consulta' ? 'en consulta' : 'esperando'}).`
      : `Tiene cita hoy a las ${esc(vetFormatoHora(c.hora))}${medico(c.medico_id) ? ' con ' + esc(medico(c.medico_id)) : ''}.`}
    <div class="cl-acciones" style="margin-top:8px">${yaEsta ? '' : `<button type="button" class="btn-accion-tabla btn-primary" onclick="llegoASuCita('${c.id}')">🪑 Marcar que llegó a su cita</button>`}
    <button type="button" class="btn-accion-tabla btn-ghost" onclick="SC.forzar = true; this.closest('.cl-aviso').remove()">Registrar otra visita</button></div></div>`;
  return c;
}
async function llegoASuCita(id) { closeModal('modal-sincita'); await llego(id); }
async function guardarSinCita() {
  if (SC.guardando) return;
  const err = $s('sc-error'); err.textContent = '';
  if (!SC.paciente && !SC.nuevo) { err.textContent = 'Busca al paciente o regístralo como nuevo.'; return; }
  if (SC.nuevo && !$s('sc-nombres').value.trim()) { err.textContent = 'Escribe el nombre del paciente.'; $s('sc-nombres').focus(); return; }
  const serv = SC.servicios.find(v => v.id === $s('sc-servicio').value);
  if (!serv) { err.textContent = 'Elige el servicio.'; return; }
  if (!SC.nuevo && !SC.forzar && citaDeHoyDe(SC.paciente)) { avisoCitaDeHoy(); err.textContent = 'Revisa el aviso: ya tiene una visita hoy.'; return; }
  const med = SA.personal.find(x => x.id === $s('sc-medico').value) || null;
  const prioridad = document.querySelector('input[name="sc-prioridad"]:checked')?.value === 'urgente' ? 'urgente' : 'normal';
  const motivo = $s('sc-motivo').value.trim().slice(0, 500);
  SC.guardando = true; const btn = $s('sc-btn'); btn.disabled = true; btn.textContent = 'Registrando…';
  try {
    // 1) El paciente (nuevo, o un cliente que aún no tenía expediente)
    let pac = SC.paciente;
    if (SC.nuevo || !pac.id) {
      const datos = SC.nuevo ? { nombres: $s('sc-nombres').value.trim().slice(0, 80), apellidos: $s('sc-apellidos').value.trim().slice(0, 80) || null,
          telefono: $s('sc-telefono').value.trim().slice(0, 30) || null, cedula: $s('sc-cedula').value.trim().slice(0, 30) || null,
          fecha_nacimiento: $s('sc-nacimiento').value || null, sexo: $s('sc-sexo').value || null }
        : { nombres: String(pac.nombres || 'Paciente').slice(0, 80), apellidos: String(pac.apellidos || '').slice(0, 80) || null, telefono: pac.telefono || null, cliente_id: pac.cliente_id };
      const { data, error } = await sb.from('clinica_pacientes').insert({ auth_user_id: STATE.userId, ...datos }).select('id, nombres, apellidos, telefono, cliente_id, numero_expediente').single();
      if (error) throw error;
      pac = data;
    }
    // 2) Su cliente (para cobrarle al final, igual que siempre)
    if (!pac.cliente_id) {
      const { data: cli, error } = await sb.from('clientes').insert({ auth_user_id: STATE.userId, nombre: clinicaNombrePaciente(pac).slice(0, 100), telefono: pac.telefono || null }).select('id').single();
      if (error) throw error;
      await sb.from('clinica_pacientes').update({ cliente_id: cli.id }).eq('id', pac.id).eq('auth_user_id', STATE.userId).is('cliente_id', null);
      pac.cliente_id = cli.id;
    }
    // 3) La visita de hoy en la Agenda (misma función que la Agenda), a esta hora, con el médico elegido
    let quien = 'Recepción'; try { quien = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null')?.nombre || quien; } catch (_) {}
    const { data: r, error: eC } = await sb.rpc('agenda_cita_guardar', { p_cita_id: null, p_permitir_cruce: true,
      p_datos: { fecha: vetHoy(), cliente_id: pac.cliente_id, cliente_nombre: clinicaNombrePaciente(pac).slice(0, 120), cliente_telefono: pac.telefono || '', estado: 'confirmada',
        notas: motivo || null, creado_por: quien },
      p_servicios: [{ producto_id: serv.id, servicio_nombre: serv.nombre, profesional_id: med?.agenda_profesional_id || null, hora_inicio: clinicaHoraAhora(), duracion_min: 30, precio: Number(serv.precio) || 0 }] });
    if (eC) throw eC;
    if (!r || !r.ok || !r.cita_id) throw new Error('No se pudo crear la visita en la Agenda.');
    // 4) Llegó ahora: entra a la fila (con su prioridad)
    await ClinicaCitas.guardarInfo(r.cita_id, { paciente_id: pac.id, llegada_en: new Date().toISOString(), consultorio_id: $s('sc-consultorio').value || (med && med.consultorio_id) || null, prioridad, sin_cita: true });
    closeModal('modal-sincita');
    avisarCambio();
    await cargar();
    const t = clinicaTurnos(SA.citas).find(x => x.id === r.cita_id);
    showToast(`✅ ${clinicaNombrePaciente(pac)} está en la fila${t ? ' · Turno ' + t.turno : ''}${prioridad === 'urgente' ? ' (urgente)' : ''}.${r.cruces_aceptados ? ' Ojo: el médico tenía otra cita a esta hora.' : ''}`);
  } catch (e) {
    console.error('guardarSinCita:', e);
    err.textContent = clinicaTextoError(e, 'No se pudo registrar. Intenta de nuevo.');
  } finally { SC.guardando = false; btn.disabled = false; btn.textContent = '🪑 Registrar llegada'; }
}

/* ---------- Atender: abrir el expediente (si la cita no tiene expediente, se elige o se crea) ---------- */
function atender(id) {
  const c = citaPorId(id); if (!c) return;
  if (c.paciente_id && c.estado === 'atendida') { window.location.href = 'clinica-pacientes.html?paciente=' + encodeURIComponent(c.paciente_id); return; }
  if (c.paciente_id) { window.location.href = 'clinica-pacientes.html?cita=' + encodeURIComponent(id); return; }
  SA.vincular = c;
  $s('vi-ayuda').textContent = `La cita de "${c.cliente_nombre}" todavía no está ligada a un expediente.`;
  $s('vi-buscar').value = ''; $s('vi-resultados').style.display = 'none'; $s('vi-error').textContent = '';
  openModal('modal-vincular');
  setTimeout(() => $s('vi-buscar').focus(), 50);
}
let _tPac = null;
function buscarPacienteVincular(q) {
  clearTimeout(_tPac);
  const cont = $s('vi-resultados'); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _tPac = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('clinica_pacientes').select('id, nombres, apellidos, cedula, telefono, numero_expediente')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .or(`nombres.ilike.%${q}%,apellidos.ilike.%${q}%,cedula.ilike.%${q}%,telefono.ilike.%${q}%,numero_expediente.ilike.%${q}%`).order('nombres').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length)
        ? data.map(p => `<div class="cl-resultado" tabindex="0" data-id="${esc(p.id)}">${esc(clinicaNombrePaciente(p))} <span class="cl-sub">· ${esc(p.numero_expediente || '')}${p.telefono ? ' · ' + esc(p.telefono) : ''}</span></div>`).join('')
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados. Si es nuevo, créalo con el botón de abajo.</div>';
      cont.querySelectorAll('[data-id]').forEach(el => { const f = () => vincular(el.dataset.id); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
      cont.style.display = '';
    } catch (e) { console.error('buscarPacienteVincular:', e); }
  }, 250);
}
async function vincular(pacienteId) {
  const c = SA.vincular; if (!c) return;
  try {
    await ClinicaCitas.guardarInfo(c.id, { paciente_id: pacienteId });
    closeModal('modal-vincular');
    window.location.href = 'clinica-pacientes.html?cita=' + encodeURIComponent(c.id);
  } catch (e) { console.error('vincular:', e); $s('vi-error').textContent = clinicaTextoError(e, 'No se pudo ligar el expediente.'); }
}
// Expediente nuevo con los datos de la cita (y ligado al mismo cliente, para cobrarle igual que siempre).
async function crearPacienteDeCita() {
  const c = SA.vincular; if (!c) return;
  const partes = String(c.cliente_nombre || '').trim().split(/\s+/);
  const nombres = partes.length > 2 ? partes.slice(0, partes.length - 2).join(' ') : (partes[0] || 'Paciente');
  const apellidos = partes.length > 2 ? partes.slice(-2).join(' ') : (partes[1] || '');
  try {
    const { data, error } = await sb.from('clinica_pacientes').insert({ auth_user_id: STATE.userId, nombres: nombres.slice(0, 80), apellidos: apellidos.slice(0, 80) || null,
      telefono: (c.telefono || '').slice(0, 30) || null, cliente_id: c.cliente_id || null }).select('id').single();
    if (error) throw error;
    showToast('Expediente creado. Completa sus datos en la ficha cuando puedas.');
    await vincular(data.id);
  } catch (e) { console.error('crearPacienteDeCita:', e); $s('vi-error').textContent = clinicaTextoError(e, 'No se pudo crear el expediente.'); }
}

/* ---------- Cuenta de la visita y cobro (camino de la Agenda) ---------- */
async function abrirCuenta(id) {
  const c = citaPorId(id); if (!c) return;
  SA.citaCuenta = id; SA.prodCargo = null;
  $s('cu-buscar').value = ''; $s('cu-resultados').style.display = 'none'; $s('cu-elegido').style.display = 'none';
  $s('cu-cantidad').value = '1'; $s('cu-error').textContent = '';
  $s('cu-titulo').textContent = `💳 Cuenta — ${clinicaNombrePaciente(c.clinica_pacientes || {})}`;
  SA.convenio = null;
  if (c.paciente?.convenio_id) {
    try { const { data: k } = await sb.from('clinica_convenios').select('id, nombre, cobertura_pct, activo').eq('id', c.paciente.convenio_id).eq('auth_user_id', STATE.userId).maybeSingle();
      if (clinicaConvenioVigente(c.paciente, k)) SA.convenio = k; else if (k) SA.convenioVencido = k; } catch (_) {}
  }
  openModal('modal-cuenta');
  await pintarCuenta();
}
async function pintarCuenta() {
  const cont = $s('cu-lista'), c = citaPorId(SA.citaCuenta);
  try {
    SA.cuenta = await ClinicaCitas.cargos(SA.citaCuenta);
    const { data: lin } = await sb.from('agenda_citas_servicios').select('servicio_nombre, precio, producto_id').eq('auth_user_id', STATE.userId).eq('cita_id', SA.citaCuenta).order('orden');
    const servicios = lin || [];
    const total = servicios.reduce((t, l) => t + Number(l.precio || 0), 0) + SA.cuenta.reduce((t, x) => t + Number(x.cantidad) * Number(x.productos?.precio || 0), 0);
    const k = SA.convenio, aplica = k && $s('cu-seguro')?.checked !== false;
    $s('cu-seguro-box').innerHTML = k ? `<div class="cl-info" style="margin:0 0 10px"><label class="cl-check" style="margin:0"><input type="checkbox" id="cu-seguro" ${aplica ? 'checked' : ''} onchange="pintarCuenta()"/>
        🛡️ <b>${esc(k.nombre)}</b> cubre el ${esc(Number(k.cobertura_pct))}%</label>
        ${aplica ? `<div class="cl-sub" style="margin-top:4px">Paga el paciente: <b>${esc(fmt(total * (100 - Number(k.cobertura_pct)) / 100))}</b> · lo cubre la aseguradora: <b>${esc(fmt(total * Number(k.cobertura_pct) / 100))}</b> (se le factura en Clínica · Seguros)</div>` : '<div class="cl-sub" style="margin-top:4px">Se cobrará todo al paciente.</div>'}</div>`
      : (c?.paciente?.convenio_id ? '<div class="cl-aviso" style="margin:0 0 10px">⚠️ El seguro del paciente está vencido o inactivo: se cobra todo al paciente.</div>' : '');
    cont.innerHTML = `<table class="cl-tabla-cuenta">
        ${servicios.map(l => `<tr><td>1 ×</td><td>${esc(l.servicio_nombre)} <span class="cl-sub">(de la cita)</span>${l.producto_id ? '' : ' <span class="cl-badge cl-badge-rojo">no está en el catálogo</span>'}</td><td style="text-align:right;white-space:nowrap">${esc(fmt(l.precio || 0))}</td><td></td></tr>`).join('')}
        ${SA.cuenta.map(x => `<tr><td>${esc(vetFormatoNumero(x.cantidad))} ×</td><td>${esc(x.descripcion)}${x.producto_id ? '' : ' <span class="cl-badge cl-badge-rojo">ya no existe</span>'}</td>
          <td style="text-align:right;white-space:nowrap">${x.productos?.precio != null ? esc(fmt(Number(x.cantidad) * Number(x.productos.precio))) : '—'}</td>
          <td style="text-align:right"><button class="cl-link" onclick="quitarCargo('${x.id}')" aria-label="Quitar">quitar</button></td></tr>`).join('')}</table>
      <div class="cl-total">Total estimado: ${esc(fmt(total))}</div><p class="cl-sub" style="text-align:right;margin:2px 0 0">El total final (impuestos, descuentos) lo calcula Ventas.</p>`;
    $s('cu-btn-cobrar').disabled = !!(c && c.venta_id);
  } catch (e) { console.error('pintarCuenta:', e); cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la cuenta.</p>'; }
}
function elegirProducto(id, nombre) {
  SA.prodCargo = { id, nombre };
  $s('cu-resultados').style.display = 'none'; $s('cu-buscar').value = '';
  const el = $s('cu-elegido'); el.innerHTML = `<span>✔ ${esc(nombre)}</span>`; el.style.display = '';
}
let _tProd = null;
function buscarProducto(q) {
  clearTimeout(_tProd);
  const cont = $s('cu-resultados'); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
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
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados.</div>';
      cont.querySelectorAll('[data-id]').forEach(el => { const f = () => elegirProducto(el.dataset.id, el.dataset.n); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
      cont.style.display = '';
    } catch (e) { console.error('buscarProducto:', e); }
  }, 250);
}
async function agregarCargo() {
  const err = $s('cu-error'); err.textContent = '';
  const cant = Number($s('cu-cantidad').value);
  if (!SA.prodCargo) { err.textContent = 'Busca y elige el producto o servicio.'; return; }
  if (!(cant > 0) || cant > 100000) { err.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  const btn = $s('cu-btn-agregar'); btn.disabled = true;
  try {
    const { error } = await sb.from('clinica_cita_cargos').insert({ auth_user_id: STATE.userId, agenda_cita_id: SA.citaCuenta, producto_id: SA.prodCargo.id, descripcion: SA.prodCargo.nombre.slice(0, 200), cantidad: cant });
    if (error) throw error;
    SA.prodCargo = null; $s('cu-elegido').style.display = 'none'; $s('cu-cantidad').value = '1';
    await pintarCuenta();
  } catch (e) { console.error('agregarCargo:', e); err.textContent = clinicaTextoError(e, 'No se pudo agregar.'); }
  finally { btn.disabled = false; }
}
async function quitarCargo(id) {
  try {
    const { error } = await sb.from('clinica_cita_cargos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    await pintarCuenta();
  } catch (e) { console.error('quitarCargo:', e); showToast(clinicaTextoError(e, 'No se pudo quitar.'), 'error'); }
}
async function cobrarCita() {
  const c = citaPorId(SA.citaCuenta); if (!c) return;
  const btn = $s('cu-btn-cobrar'); btn.disabled = true;
  try {
    const r = await ClinicaCitas.cobrar(c, { convenio: SA.convenio && $s('cu-seguro')?.checked ? SA.convenio : null, convenioDisponible: SA.convenio,
      alCerrar: async cobrado => { if (cobrado) { avisarCambio(); showToast('✅ Visita cobrada y registrada en Ventas.'); } await cargar(); } });
    if (!r.ok) { $s('cu-error').textContent = r.motivo; await cargar(); }
    else if (r.dentro) closeModal('modal-cuenta');
  } catch (e) { console.error('cobrarCita:', e); $s('cu-error').textContent = 'No se pudo preparar el cobro. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}

/* ---------- Recordatorios de las citas de mañana (o de otra fecha), uno por uno por WhatsApp ---------- */
async function abrirRecordatorios() {
  $s('re-fecha').value = vetSumarDias(vetHoy(), 1);
  openModal('modal-recordatorios');
  await cargarRecordatorios();
}
async function cargarRecordatorios() {
  const fecha = $s('re-fecha').value, cont = $s('re-lista');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
  cont.innerHTML = '<p class="cl-sub">Cargando…</p>';
  try {
    const r = await ClinicaCitas.cargar(fecha, fecha, { soloEstados: ['reservada', 'confirmada'] });
    if (!SA.personal.length) SA.personal = r.medicos;
    SA.recordar = r.citas.sort((a, b) => a.hora.localeCompare(b.hora));
    pintarRecordatorios();
  } catch (e) { console.error('cargarRecordatorios:', e); cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudieron cargar las citas.</p>'; }
}
function pintarRecordatorios() {
  const lista = SA.recordar || [];
  const pend = lista.filter(c => !c.recordatorio_enviado_en).length;
  $s('re-resumen').textContent = lista.length ? `${lista.length} cita${lista.length === 1 ? '' : 's'} · ${pend} sin avisar` : '';
  $s('re-lista').innerHTML = lista.length ? lista.map(c => {
    const tel = vetTelefonoWhatsApp(c.telefono, STATE.empresaConfig?.pais);
    return `<div class="cl-item"><div class="cl-item-cab"><div><div class="cl-item-tit">${esc(vetFormatoHora(c.hora))} · ${esc(clinicaNombrePaciente(c.clinica_pacientes || {}))}</div>
      <div class="cl-item-fecha">${c.medico_id ? esc(medico(c.medico_id)) : (c.motivo ? esc(c.motivo) : '')}${c.telefono ? ' · 📞 ' + esc(c.telefono) : ''}</div></div>
      ${c.recordatorio_enviado_en ? '<span class="cl-badge cl-badge-verde">✓ Avisado</span>' : ''}</div>
      <div class="cl-acciones">${tel ? `<button class="btn-accion-tabla ${c.recordatorio_enviado_en ? 'btn-ghost' : 'btn-primary'}" onclick="recordar('${c.id}')">📲 ${c.recordatorio_enviado_en ? 'Avisar de nuevo' : 'Enviar por WhatsApp'}</button>` : '<span class="cl-badge cl-badge-rojo">Sin teléfono válido</span>'}</div></div>`;
  }).join('') : '<p class="cl-sub">No hay citas pendientes para esa fecha.</p>';
}
async function recordar(id) {
  const c = citaPorId(id); if (!c) return;
  const tel = vetTelefonoWhatsApp(c.telefono, STATE.empresaConfig?.pais);
  if (!tel) { showToast('La cita no tiene un teléfono válido.', 'error'); return; }
  const texto = clinicaMensajeCita({ paciente: (c.clinica_pacientes?.nombres || '').split(/\s+/)[0], negocio: STATE.empresaConfig?.nombre_comercial, fecha: c.fecha, hora: c.hora, medico: medico(c.medico_id) });
  window.open(vetEnlaceWhatsApp(tel, texto), '_blank', 'noopener');
  try {
    const ahora = new Date().toISOString();
    await ClinicaCitas.guardarInfo(id, { recordatorio_enviado_en: ahora });
    c.recordatorio_enviado_en = ahora; pintarRecordatorios();
  } catch (e) { console.warn('recordar:', e); }
}

/* ---------- Modo pantalla (televisor de la sala): solo nombre e inicial ---------- */
function abrirPantalla() {
  SA.pantalla = true; $s('sa-pantalla').style.display = 'flex'; document.body.style.overflow = 'hidden';
  try { document.documentElement.requestFullscreen?.()?.catch?.(() => {}); } catch (_) {}   // sin un toque, el navegador no deja pantalla completa
  // Lo que ya estaba llamado al abrir no suena: solo los llamados nuevos.
  SA.ultimoLlamado = ultimoLlamado()?.llamado_en || null;
  activarSonido(); pintarBotonVoz();
  renderPantalla(clinicaTurnos(SA.citas));
}
function cerrarPantalla() {
  SA.pantalla = false; $s('sa-pantalla').style.display = 'none'; document.body.style.overflow = '';
  try { if (document.fullscreenElement) document.exitFullscreen()?.catch?.(() => {}); } catch (_) {}
}
// El navegador no deja sonar nada hasta que alguien toca la pantalla una vez: si hace falta, se muestra un botón.
function audio() {
  if (!SA.audio) { try { SA.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  return SA.audio;
}
function avisoSonido() { const a = audio(); $s('sp-sonido').style.display = SA.pantalla && a && a.state !== 'running' ? 'block' : 'none'; }
function activarSonido() {
  const a = audio(); if (!a) return;
  Promise.resolve(a.state === 'running' || a.resume()).catch(() => {}).finally(avisoSonido);
  setTimeout(avisoSonido, 400);
}
// "Ding-dong" dos veces.
function sonar() {
  const ctx = audio(); if (!ctx) return;
  try {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    [[0, 988], [0.45, 784], [1.3, 988], [1.75, 784]].forEach(([t, f]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + t; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6); o.start(t0); o.stop(t0 + 0.62); });
  } catch (_) {}
}
// Voz: después del "ding-dong" se anuncia el turno, el nombre corto y a dónde pasar (se puede apagar).
function vozActiva() { try { return localStorage.getItem('n360_sala_voz') !== 'no'; } catch (_) { return true; } }
function pintarBotonVoz() { const b = $s('sp-voz'); if (!b) return; const on = vozActiva(); b.textContent = on ? '🗣️ Voz: sí' : '🔇 Voz: no'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
function alternarVoz() {
  try { localStorage.setItem('n360_sala_voz', vozActiva() ? 'no' : 'si'); } catch (_) {}
  pintarBotonVoz(); activarSonido();
  if (!vozActiva()) { try { window.speechSynthesis?.cancel(); } catch (_) {} }
}
function anunciar(texto) {
  if (!vozActiva() || !texto) return;
  window.__ultimoAnuncio = texto;
  try {
    const sintesis = window.speechSynthesis; if (!sintesis || typeof SpeechSynthesisUtterance === 'undefined') return;
    const u = new SpeechSynthesisUtterance(texto);
    const voces = sintesis.getVoices() || [];
    const voz = voces.find(v => /^es[-_](NI|MX|US|419|CR|HN|SV|GT|PA|CO)/i.test(v.lang)) || voces.find(v => /^es/i.test(v.lang));
    if (voz) u.voice = voz;
    u.lang = voz?.lang || 'es-MX'; u.rate = 0.92; u.volume = 1;
    sintesis.cancel();
    setTimeout(() => { try { sintesis.speak(u); } catch (_) {} }, 2500);   // después del ding-dong
  } catch (_) {}
}
function textoAnuncio(c, turno) {
  const donde = consultorio(c.consultorio_id);
  return `Turno ${turno || ''}. ${clinicaNombreCorto(c.clinica_pacientes) || ''}. ${donde ? 'Pase a ' + donde : 'Pase a consulta'}.`.replace(/\s+/g, ' ').trim();
}
function ultimoLlamado() {
  return SA.citas.filter(c => c.llamado_en && ['en_espera', 'en_consulta'].includes(c.estado) && Date.now() - new Date(c.llamado_en).getTime() < 10 * 60000)
    .sort((a, b) => String(b.llamado_en).localeCompare(String(a.llamado_en)))[0];
}
function renderPantalla(turnos) {
  const ult = ultimoLlamado();
  if (ult && ult.llamado_en !== SA.ultimoLlamado) {         // llamado nuevo: suena y se resalta
    SA.ultimoLlamado = ult.llamado_en; sonar();
    anunciar(textoAnuncio(ult, turnos.find(x => x.id === ult.id)?.turno));
    const caja = $s('sp-llamado'); caja.classList.remove('sp-alerta'); void caja.offsetWidth; caja.classList.add('sp-alerta');
  }
  const t = id => turnos.find(x => x.id === id)?.turno;
  $s('sp-llamado').innerHTML = ult
    ? `<div class="sp-turno">Turno ${esc(t(ult.id) || '')}</div><div class="sp-nombre">${esc(clinicaNombreCorto(ult.clinica_pacientes))}</div>
       <div class="sp-donde">${esc([consultorio(ult.consultorio_id), medico(ult.medico_id)].filter(Boolean).join(' · ') || 'Pase a consulta')}</div>`
    : '<div class="sp-nombre" style="opacity:.6">Bienvenido</div><div class="sp-donde">Espere a ser llamado</div>';
  const espera = clinicaOrdenEspera(turnos);
  $s('sp-lista').innerHTML = espera.length ? espera.map(x => `<div class="sp-item${ult && x.id === ult.id ? ' sp-item-llamado' : ''}"><b>${x.turno}</b> ${esc(clinicaNombreCorto(x.clinica_pacientes))}${x.prioridad === 'urgente' ? '<span class="sp-urg">● Urgente</span>' : ''}</div>`).join('') : '<div class="sp-item" style="opacity:.6">—</div>';
  $s('sp-hora').textContent = new Date().toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit' });
  $s('sp-negocio').textContent = STATE.empresaConfig?.nombre_comercial || 'Sala de espera';
}
