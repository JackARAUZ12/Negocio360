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

    await cargarAgenda();
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
   AGENDA VETERINARIA -- citas por dia y por veterinario
   (utilidades puras en vet-comun.js)
===================================================== */
const AG = { fecha: null, citas: [], equipo: [], mascotas: [], mapaMasc: {}, filtroVet: '', editId: null, mascota: null, eqEdit: null };
const $a = id => document.getElementById(id);
const fechaCortaAG = ymd => { if (!ymd) return '—'; const p = vetPartes(ymd); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`; };

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
function duenoAG(m) {
  const c = m && m.clientes;
  if (!c) return { nombre: '(sin dueño)', tel: '' };
  return { nombre: `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Sin nombre', tel: c.telefono || c.whatsapp || '' };
}

/* ---------- Carga ---------- */
async function cargarAgenda() {
  try {
    AG.fecha = AG.fecha || vetHoy();
    const [eq, ms] = await Promise.all([
      sb.from('vet_veterinarios').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre'),
      traerTodo(() => sb.from('vet_mascotas').select('id, nombre, especie, activo, clientes(nombre, apellido, telefono, whatsapp)').eq('auth_user_id', STATE.userId).order('id')),
    ]);
    if (eq.error) throw eq.error;
    AG.equipo = eq.data || [];
    AG.mascotas = ms; AG.mapaMasc = {}; ms.forEach(m => { AG.mapaMasc[m.id] = m; });
    pintarFiltroVet();
    await cargarCitasDia();
  } catch (e) {
    console.error('cargarAgenda:', e);
    $a('ag-lista').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la agenda.</p>';
  }
}
async function cargarCitasDia() {
  $a('ag-fecha').value = AG.fecha;
  const { data, error } = await sb.from('vet_citas').select('*').eq('auth_user_id', STATE.userId).eq('fecha', AG.fecha).order('hora').order('created_at');
  if (error) throw error;
  AG.citas = data || [];
  renderAgenda();
}

/* ---------- Un veterinario o varios ---------- */
function pintarFiltroVet() {
  const modo = vetModoEquipo(AG.equipo), sel = $a('ag-vet'), sub = $a('ag-subtitulo');
  if (modo === 'varios') {
    sel.innerHTML = '<option value="">👨‍⚕️ Todos los veterinarios</option>' + AG.equipo.map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join('') + '<option value="sin">Sin asignar</option>';
    sel.value = AG.filtroVet; sel.style.display = '';
    sub.textContent = `Las citas de tu veterinaria — ${AG.equipo.length} veterinarios.`;
  } else {
    sel.style.display = 'none'; AG.filtroVet = '';
    sub.textContent = modo === 'unico' ? `Las citas de ${AG.equipo[0].nombre}, día por día.` : 'Las citas de tu veterinaria, día por día.';
  }
}
function filtrarAgenda() { AG.filtroVet = $a('ag-vet').value; renderAgenda(); }
function citasFiltradas() {
  if (!AG.filtroVet) return AG.citas;
  if (AG.filtroVet === 'sin') return AG.citas.filter(c => !c.veterinario_id);
  return AG.citas.filter(c => c.veterinario_id === AG.filtroVet);
}
// Campo de veterinario de un formulario: texto libre / fijo / selector segun el equipo.
function pintarVetCampo(pref, idPref, textoPrevio) {
  const modo = vetModoEquipo(AG.equipo), txt = $a(pref + '-vet'), sel = $a(pref + '-vet-sel'), fijo = $a(pref + '-vet-fijo');
  txt.style.display = modo === 'libre' ? '' : 'none';
  sel.style.display = modo === 'varios' ? '' : 'none';
  fijo.style.display = modo === 'unico' ? '' : 'none';
  if (modo === 'libre') txt.value = textoPrevio || '';
  if (modo === 'unico') fijo.textContent = '👨‍⚕️ ' + AG.equipo[0].nombre + ' (asignado automáticamente)';
  if (modo === 'varios') {
    sel.innerHTML = '<option value="">— Sin asignar —</option>' + AG.equipo.map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join('');
    sel.value = idPref || '';
  }
}
function leerVetCampo(pref) { return vetResolverVeterinario(AG.equipo, $a(pref + '-vet-sel').value, $a(pref + '-vet').value); }

/* ---------- Dia ---------- */
function cambiarFecha(v) { if (!v) return; AG.fecha = v; cargarCitasDia().catch(e => console.error(e)); }
function moverDia(n) { AG.fecha = vetSumarDias(AG.fecha || vetHoy(), n); cargarCitasDia().catch(e => console.error(e)); }
function irHoy() { AG.fecha = vetHoy(); cargarCitasDia().catch(e => console.error(e)); }

function renderAgenda() {
  const lista = citasFiltradas();
  const esHoy = AG.fecha === vetHoy();
  const titulo = `${vetDiaSemana(AG.fecha)} ${vetFechaLarga(AG.fecha)}${esHoy ? ' · hoy' : ''}`;
  $a('ag-titulo').textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);   // solo la primera letra
  $a('ag-kpi-total').textContent = lista.length;
  $a('ag-kpi-pend').textContent = lista.filter(c => c.estado === 'programada' || c.estado === 'confirmada').length;
  $a('ag-kpi-aten').textContent = lista.filter(c => c.estado === 'atendida').length;
  $a('ag-kpi-canc').textContent = lista.filter(c => c.estado === 'cancelada' || c.estado === 'no_asistio').length;
  const cont = $a('ag-lista');
  if (!lista.length) { cont.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;padding:14px 0">No hay citas ${AG.filtroVet ? 'para este veterinario ' : ''}en este día. Agenda una con "+ Nueva cita".</p>`; return; }
  cont.innerHTML = lista.map(c => {
    const m = AG.mapaMasc[c.mascota_id], esp = VET_ESPECIES[m?.especie] || VET_ESPECIES.otro, d = duenoAG(m);
    const tipo = VET_TIPOS_CITA[c.tipo] || VET_TIPOS_CITA.otro, est = VET_ESTADOS_CITA[c.estado] || VET_ESTADOS_CITA.programada;
    const pendiente = c.estado === 'programada' || c.estado === 'confirmada';
    const btns = [];
    if (c.estado === 'programada') btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="cambiarEstadoCita('${c.id}','confirmada')">✅ Confirmar</button>`);
    if (pendiente) {
      btns.push(`<button class="btn-accion-tabla btn-primary" onclick="atenderCita('${c.id}')">🩺 Atender</button>`);
      btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="recordarCita('${c.id}')">📲 Recordar</button>`);
      btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirCita('${c.id}')">✏️</button>`);
      btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="cambiarEstadoCita('${c.id}','no_asistio')">🚫 No asistió</button>`);
      btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="cambiarEstadoCita('${c.id}','cancelada')">❌</button>`);
    } else if (c.estado === 'atendida') {
      btns.push(`<a class="btn-accion-tabla btn-ghost" style="text-decoration:none" href="mascotas.html?ficha=${c.mascota_id}">📋 Ver ficha</a>`);
    } else {
      btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirCita('${c.id}')">↩️ Reprogramar</button>`);
    }
    return `<div class="ag-card est-${c.estado}">
      <div class="ag-fila"><div><span class="ag-hora">${esc(vetFormatoHora(c.hora))}</span> <span class="ag-dur">· ${c.duracion_min} min</span></div><span class="vt-badge vt-badge-${est.clase}">${esc(est.n)}</span></div>
      <div class="vt-mascota"><span class="vt-emoji">${esp.e}</span><div><div class="vt-nombre">${esc(m?.nombre || '(mascota eliminada)')}</div><div class="vt-sub">👤 ${esc(d.nombre)}${d.tel ? ' · ' + esc(d.tel) : ''}</div></div></div>
      <div class="ag-motivo">${tipo.e} ${esc(tipo.n)}${c.motivo ? ' — ' + esc(c.motivo) : ''}</div>
      ${c.veterinario ? `<div class="vt-sub">👨‍⚕️ ${esc(c.veterinario)}</div>` : ''}${c.notas ? `<div class="vt-sub">📝 ${esc(c.notas)}</div>` : ''}
      <div class="ag-btns">${btns.join('')}</div>
    </div>`;
  }).join('');
}

/* ---------- Cita: crear / editar ---------- */
function elegirMascotaCita(id) {
  AG.mascota = AG.mapaMasc[id]; if (!AG.mascota) return;
  $a('ci-m-resultados').style.display = 'none'; $a('ci-m-buscar').value = '';
  const d = duenoAG(AG.mascota), esp = VET_ESPECIES[AG.mascota.especie] || VET_ESPECIES.otro, el = $a('ci-m-elegida');
  el.textContent = `${esp.e} ${AG.mascota.nombre} · 👤 ${d.nombre}`; el.style.display = '';
}
function buscarMascotaCita(q) {
  const cont = $a('ci-m-resultados'); q = (q || '').trim().toLowerCase();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  const hallados = AG.mascotas.filter(m => m.activo && [m.nombre, duenoAG(m).nombre, duenoAG(m).tel].some(t => String(t || '').toLowerCase().includes(q))).slice(0, 8);
  cont.innerHTML = hallados.length
    ? hallados.map(m => { const esp = VET_ESPECIES[m.especie] || VET_ESPECIES.otro, d = duenoAG(m);
        return `<div class="vt-resultado" data-id="${m.id}">${esp.e} <b>${esc(m.nombre)}</b> <span style="color:var(--text-muted)">· ${esc(d.nombre)}</span></div>`; }).join('')
    : '<div class="vt-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados — regístrala primero en Mascotas</div>';
  cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => elegirMascotaCita(el.dataset.id)));
  cont.style.display = '';
}
function abrirCita(id) {
  const c = id ? AG.citas.find(x => x.id === id) : null;
  AG.editId = c ? c.id : null;
  $a('ci-titulo').textContent = c ? '✏️ Editar cita' : '📅 Nueva cita';
  const selT = $a('ci-tipo');
  if (!selT.options.length) Object.entries(VET_TIPOS_CITA).forEach(([k, v]) => selT.add(new Option(`${v.e} ${v.n}`, k)));
  AG.mascota = c ? AG.mapaMasc[c.mascota_id] || null : null;
  $a('ci-m-buscar').value = ''; $a('ci-m-resultados').style.display = 'none'; $a('ci-m-elegida').style.display = 'none';
  if (AG.mascota) elegirMascotaCita(AG.mascota.id);
  selT.value = c ? c.tipo : 'consulta';
  const dur = String(c ? c.duracion_min : 30), selD = $a('ci-duracion');
  if (![...selD.options].some(o => o.value === dur)) selD.add(new Option(`${dur} min`, dur));
  selD.value = dur;
  $a('ci-fecha').value = c ? c.fecha : AG.fecha; $a('ci-hora').value = c ? String(c.hora).slice(0, 5) : '';
  $a('ci-motivo').value = c?.motivo || ''; $a('ci-notas').value = c?.notas || ''; $a('ci-error').textContent = '';
  pintarVetCampo('ci', c?.veterinario_id, c?.veterinario);
  openModal('modal-cita');
}
function cerrarCita() { closeModal('modal-cita'); }

async function guardarCita() {
  const err = $a('ci-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const fecha = $a('ci-fecha').value, hora = $a('ci-hora').value;
  if (!AG.mascota) return fallo('Elige la mascota.');
  if (!fecha) return fallo('Indica la fecha.');
  if (!hora) return fallo('Indica la hora.');
  if (!AG.editId && fecha < vetHoy()) return fallo('No puedes agendar una cita en una fecha pasada.');
  const vet = leerVetCampo('ci');
  const nueva = { fecha, hora, duracion_min: Number($a('ci-duracion').value), veterinario_id: vet.id };
  const btn = $a('ci-btn-guardar'); btn.disabled = true;
  try {
    // Choque de horario: se consulta el dia COMPLETO (la pantalla solo tiene cargado el dia que se ve).
    const { data: delDia, error: eDia } = await sb.from('vet_citas').select('id, fecha, hora, duracion_min, veterinario_id, estado, mascota_id').eq('auth_user_id', STATE.userId).eq('fecha', fecha);
    if (eDia) throw eDia;
    const choque = vetChoqueCita(nueva, delDia || [], AG.editId);
    if (choque) {
      const otra = AG.mapaMasc[choque.mascota_id];
      if (!confirm(`Ya hay una cita de ${otra?.nombre || 'otra mascota'} a las ${vetFormatoHora(choque.hora)}${vet.nombre ? ' con ' + vet.nombre : ''}.\n\n¿Agendar de todos modos?`)) return;
    }
    const v = id => $a(id).value.trim() || null;
    const payload = { mascota_id: AG.mascota.id, veterinario_id: vet.id, veterinario: vet.nombre, fecha, hora, duracion_min: nueva.duracion_min, tipo: $a('ci-tipo').value, motivo: v('ci-motivo'), notas: v('ci-notas') };
    let q;
    if (AG.editId) {
      const previa = AG.citas.find(x => x.id === AG.editId);
      if (previa && (previa.estado === 'cancelada' || previa.estado === 'no_asistio')) payload.estado = 'programada';   // reprogramar
      q = sb.from('vet_citas').update(payload).eq('id', AG.editId).eq('auth_user_id', STATE.userId);
    } else q = sb.from('vet_citas').insert({ ...payload, auth_user_id: STATE.userId });
    const { error } = await q;
    if (error) throw error;
    showToast(AG.editId ? 'Cita actualizada.' : 'Cita agendada.');
    closeModal('modal-cita');
    AG.fecha = fecha;                      // se va al dia de la cita para verla
    await cargarCitasDia();
  } catch (e) { console.error('guardarCita:', e); fallo('No se pudo guardar la cita. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}

/* ---------- Estados ---------- */
async function cambiarEstadoCita(id, estado) {
  const c = AG.citas.find(x => x.id === id); if (!c) return;
  const m = AG.mapaMasc[c.mascota_id];
  if (estado === 'cancelada' && !confirm(`¿Cancelar la cita de ${m?.nombre || 'la mascota'}?`)) return;
  if (estado === 'no_asistio' && !confirm(`¿Marcar que ${m?.nombre || 'la mascota'} no asistió?`)) return;
  try {
    const { error } = await sb.from('vet_citas').update({ estado }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    c.estado = estado; renderAgenda();
  } catch (e) { console.error('cambiarEstadoCita:', e); showToast('No se pudo cambiar el estado.', 'error'); }
}
function atenderCita(id) { window.location.href = 'mascotas.html?cita=' + encodeURIComponent(id); }

async function recordarCita(id) {
  const c = AG.citas.find(x => x.id === id); if (!c) return;
  const m = AG.mapaMasc[c.mascota_id], d = duenoAG(m);
  const tel = vetTelefonoWhatsApp(d.tel, STATE.empresaConfig?.pais);
  if (!tel) { showToast('El dueño no tiene un teléfono válido. Agrégalo en la ficha de la mascota.', 'error'); return; }
  const texto = vetMensajeCita({ dueno: d.nombre, mascota: m?.nombre || 'su mascota', negocio: STATE.empresaConfig?.nombre_comercial, fecha: c.fecha, hora: c.hora, veterinario: c.veterinario });
  window.open(vetEnlaceWhatsApp(tel, texto), '_blank', 'noopener');      // primero: el navegador exige que sea directo al hacer clic
  try {
    const ahora = new Date().toISOString();
    const { error } = await sb.from('vet_citas').update({ recordatorio_enviado_en: ahora }).eq('id', c.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    c.recordatorio_enviado_en = ahora; showToast('Recordatorio abierto en WhatsApp.');
  } catch (e) { console.warn('recordarCita (marcar):', e); }
}

/* ---------- Equipo veterinario ---------- */
function abrirEquipo() { cancelarEdicionVet(); renderEquipo(); openModal('modal-equipo'); }
function cerrarEquipo() { closeModal('modal-equipo'); }
function renderEquipo() {
  const modo = vetModoEquipo(AG.equipo), n = AG.equipo.length;
  $a('eq-ayuda').textContent = modo === 'libre'
    ? 'Aún no has registrado veterinarios. Si trabajas solo, no necesitas hacerlo. Si tienes un equipo, regístralo para asignar citas y filtrar la agenda.'
    : modo === 'unico' ? 'Tienes 1 veterinario: se asigna automáticamente a todo (no se te preguntará). Agrega otro para repartir las citas.'
    : `Tienes ${n} veterinarios: al agendar eliges quién atiende, y la agenda avisa si dos citas se pisan en el mismo veterinario.`;
  $a('eq-lista').innerHTML = n ? AG.equipo.map(v => `<div class="eq-item"><div><div class="vt-nombre">👨‍⚕️ ${esc(v.nombre)}</div><div class="vt-sub">${esc([v.especialidad, v.telefono].filter(Boolean).join(' · ') || 'Sin más datos')}</div></div>
      <div style="display:flex;gap:6px"><button class="btn-accion-tabla btn-ghost" onclick="editarVeterinario('${v.id}')">✏️</button><button class="btn-accion-tabla btn-ghost" onclick="desactivarVeterinario('${v.id}')">Quitar</button></div></div>`).join('')
    : '<p class="vt-sub">Sin veterinarios registrados.</p>';
}
function editarVeterinario(id) {
  const v = AG.equipo.find(x => x.id === id); if (!v) return;
  AG.eqEdit = id; $a('eq-nombre').value = v.nombre; $a('eq-esp').value = v.especialidad || ''; $a('eq-tel').value = v.telefono || '';
  $a('eq-titulo-form').textContent = 'Editar veterinario'; $a('eq-btn-guardar').textContent = 'Guardar cambios'; $a('eq-btn-cancelar').style.display = ''; $a('eq-error').textContent = '';
}
function cancelarEdicionVet() {
  AG.eqEdit = null; ['eq-nombre', 'eq-esp', 'eq-tel'].forEach(i => { $a(i).value = ''; });
  $a('eq-titulo-form').textContent = 'Agregar veterinario'; $a('eq-btn-guardar').textContent = 'Guardar'; $a('eq-btn-cancelar').style.display = 'none'; $a('eq-error').textContent = '';
}
async function recargarEquipo() {
  const { data, error } = await sb.from('vet_veterinarios').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
  if (error) throw error;
  AG.equipo = data || []; pintarFiltroVet(); renderEquipo(); renderAgenda();
}
async function guardarVeterinario() {
  const err = $a('eq-error'); err.textContent = '';
  const nombre = $a('eq-nombre').value.trim();
  if (!nombre) { err.textContent = 'Escribe el nombre del veterinario.'; return; }
  if (AG.equipo.some(v => v.id !== AG.eqEdit && v.nombre.trim().toLowerCase() === nombre.toLowerCase())) { err.textContent = 'Ya tienes un veterinario con ese nombre.'; return; }
  const payload = { nombre, especialidad: $a('eq-esp').value.trim() || null, telefono: $a('eq-tel').value.trim() || null };
  const btn = $a('eq-btn-guardar'); btn.disabled = true;
  try {
    const q = AG.eqEdit
      ? sb.from('vet_veterinarios').update(payload).eq('id', AG.eqEdit).eq('auth_user_id', STATE.userId)
      : sb.from('vet_veterinarios').insert({ ...payload, auth_user_id: STATE.userId });
    const { error } = await q;
    if (error) throw error;
    showToast(AG.eqEdit ? 'Veterinario actualizado.' : 'Veterinario agregado.');
    cancelarEdicionVet(); await recargarEquipo();
  } catch (e) { console.error('guardarVeterinario:', e); err.textContent = 'No se pudo guardar. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}
async function desactivarVeterinario(id) {
  const v = AG.equipo.find(x => x.id === id); if (!v) return;
  if (!confirm(`¿Quitar a ${v.nombre} del equipo?\n\nSus citas y consultas anteriores se conservan.`)) return;
  try {
    const { error } = await sb.from('vet_veterinarios').update({ activo: false }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    if (AG.filtroVet === id) AG.filtroVet = '';
    showToast('Veterinario quitado del equipo.'); await recargarEquipo();
  } catch (e) { console.error('desactivarVeterinario:', e); showToast('No se pudo quitar.', 'error'); }
}
