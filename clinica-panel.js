/* =====================================================
   CLINICA-PANEL.JS — NEGOCIO360 · Módulo Clínica
   El Panel de Clínica: todo el módulo en un solo lugar.
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
   PANEL DE CLÍNICA
   Un solo lugar para toda la clínica: el inicio (preparar la
   clínica, el ciclo del paciente de hoy y pendientes) y cada
   submódulo (Agenda, Sala, Pacientes, Observación, Seguros,
   Reportes, Médicos) se abre DENTRO del panel, sin salir de él.
   Las pantallas internas son las mismas de siempre: solo se
   les oculta su menú y su encabezado (los del panel quedan).
   Si una pantalla interna lleva a otra (p. ej. cobrar en
   Ventas), también se queda dentro del panel.
===================================================== */
// En orden: el ciclo del día, el cierre y los ajustes.
const CPN_SUBS = [
  { id: 'agenda', archivo: 'agenda.html', key: 'agenda', icono: '📅', nombre: 'Agenda', grupo: 'dia', desc: 'Aparta la cita en la columna del médico. Puedes elegir un paciente, un cliente o una persona nueva.' },
  { id: 'sala', archivo: 'clinica-sala.html', key: 'clinica_sala', icono: '🪑', nombre: 'Sala de espera', grupo: 'dia', desc: 'Llegó → turno, llamar (sale en la pantalla de la TV), atender y cobrar.' },
  { id: 'pacientes', archivo: 'clinica-pacientes.html', key: 'clinica_pacientes', icono: '🩺', nombre: 'Pacientes y expediente', grupo: 'dia', desc: 'Fichas de pacientes y el expediente: consultas, recetas, órdenes y archivos. Solo médicos, con su código.' },
  { id: 'hospital', archivo: 'clinica-hospital.html', key: 'clinica_hospital', icono: '🛏️', nombre: 'Observación', grupo: 'dia', desc: 'Si el paciente se queda: cama, notas y signos, lo que se usa, alta y cobro.' },
  { id: 'seguros', archivo: 'clinica-seguros.html', key: 'clinica_seguros', icono: '🛡️', nombre: 'Seguros', grupo: 'cierre', desc: 'Aseguradoras y convenios. Factura a cada aseguradora lo que cubrió.' },
  { id: 'reportes', archivo: 'clinica-reportes.html', key: 'clinica_reportes', icono: '📊', nombre: 'Reportes y honorarios', grupo: 'cierre', desc: 'Atendidos, ingresos, diagnósticos y el pago de honorarios a cada médico.' },
  { id: 'equipo', archivo: 'clinica-equipo.html', key: 'clinica_equipo', icono: '👩‍⚕️', nombre: 'Médicos y seguridad', grupo: 'ajustes', desc: 'Qué usuarios son médicos, su columna en la Agenda, consultorios, honorarios y la bitácora.' },
];
const CPN_GRUPOS = { dia: '☀️ Día a día', cierre: '📆 Cierre (semana o mes)', ajustes: '⚙️ Ajustes' };
// El ciclo de cada paciente. "ancla" = parte de la pantalla a la que se lleva.
const CPN_CICLO = [
  { n: 1, sub: 'agenda', icono: '📅', nombre: 'Agendar', ayuda: 'Cita en la Agenda' },
  { n: 2, sub: 'sala', icono: '🪑', nombre: 'Llega y espera', ayuda: 'Turno y llamado', ancla: 'sa-espera' },
  { n: 3, sub: 'sala', icono: '🩺', nombre: 'Consulta', ayuda: 'Atender: el expediente', ancla: 'sa-consulta' },
  { n: 4, sub: 'sala', icono: '💳', nombre: 'Cobrar', ayuda: 'Cuenta y cobro', ancla: 'sa-atendidos' },
  { n: 5, sub: 'agenda', icono: '🔁', nombre: 'Control', ayuda: 'Próxima cita', vuelta: true },
];
// Páginas del sistema a las que una pantalla interna puede llevar (se quedan dentro del panel).
const CPN_OTRAS = { 'ventas.html': '💰 Ventas', 'salarios.html': '🧑‍💼 Salarios', 'productos.html': '📦 Productos/Servicios', 'clientes.html': '👥 Clientes', 'configuracion.html': '⚙️ Configuración', 'creditos.html': '💳 Créditos', 'farmacia.html': '💊 Farmacia' };

const CPN = { subs: [], actual: null, paso: null, datos: null, cargandoMarco: false };
const $c = id => document.getElementById(id);
const archivoDe = href => { try { return new URL(href, location.href).pathname.split('/').pop().toLowerCase(); } catch (_) { return ''; } };

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
    CPN.subs = submodulosPermitidos();
    pintarBarra();
    $c('cpn-marco').addEventListener('load', alCargarMarco);
    window.addEventListener('hashchange', segunHash);
    window.addEventListener('popstate', segunHash);
    window.addEventListener('resize', ajustarAlto);
    window.addEventListener('message', ev => {        // una venta hecha dentro del panel (Ventas avisa al terminar)
      if (ev.source === $c('cpn-marco').contentWindow && ev.data?.tipo === 'n360_operacion_completada') showToast('✅ ' + (ev.data.nota || 'Registrado'));
    });
    segunHash();
    mostrarRecorrido(false);
  } catch (e) {
    console.error('init clinica-panel:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

// Un usuario con permisos limitados solo ve en el panel los submódulos que el administrador le dio.
function submodulosPermitidos() {
  let permitidos = null;
  try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.tipo !== 'admin') permitidos = new Set(pf.modulos || []); } catch (_) {}
  return CPN_SUBS.filter(s => !permitidos || permitidos.has(s.key));
}
const subPorId = id => CPN.subs.find(s => s.id === id);

/* ---------- Barra del panel: botón al inicio + submódulos en orden ---------- */
function pintarBarra() {
  $c('cpn-tabs').innerHTML = CPN.subs.map((s, i) => {
    const sep = i > 0 && CPN.subs[i - 1].grupo !== s.grupo ? '<span class="cpn-sep" aria-hidden="true"></span>' : '';
    return `${sep}<a class="cpn-tab" href="#${s.id}" data-sub="${s.id}" onclick="return irSub('${s.id}')"><span aria-hidden="true">${s.icono}</span> ${esc(s.nombre)}</a>`;
  }).join('');
}
function marcarBarra(id, extra) {
  document.querySelectorAll('.cpn-tab').forEach(a => a.classList.toggle('activa', a.dataset.sub === id));
  $c('cpn-inicio').classList.toggle('activa', !id && !extra);
  $c('cpn-extra').textContent = extra || ''; $c('cpn-extra').style.display = extra ? '' : 'none';
  const act = document.querySelector('.cpn-tab.activa'); if (act) act.scrollIntoView({ block: 'nearest', inline: 'center' });
}
// Pasos del ciclo arriba de la pantalla interna, con "Siguiente paso".
function pintarPasos(subId, pasoN) {
  const enCiclo = CPN_CICLO.filter(p => p.sub === subId);
  if (!enCiclo.length) { $c('cpn-pasos').style.display = 'none'; return; }
  const act = CPN_CICLO.find(p => p.n === pasoN) || enCiclo[0];
  CPN.paso = act.n;
  const sig = CPN_CICLO.find(p => p.n === (act.n % CPN_CICLO.length) + 1);
  $c('cpn-pasos').style.display = '';
  $c('cpn-pasos').innerHTML = `<div class="cpn-pasos-lista">${CPN_CICLO.map(p => `<button type="button" class="cpn-paso${p.n === act.n ? ' activo' : ''}${p.n < act.n ? ' hecho' : ''}" onclick="irPaso(${p.n})" ${subPorId(p.sub) ? '' : 'disabled'}>
      <b>${p.n}</b><span>${esc(p.nombre)}</span></button>`).join('<span class="cpn-flecha" aria-hidden="true">›</span>')}</div>
    ${sig && subPorId(sig.sub) ? `<button type="button" class="btn-accion-tabla btn-primary cpn-sig" onclick="irPaso(${sig.n})">${sig.n === 1 ? '🔁 Nuevo ciclo' : 'Siguiente paso'}: ${esc(sig.nombre)} →</button>` : ''}`;
}
function irPaso(n) {
  const p = CPN_CICLO.find(x => x.n === n); if (!p || !subPorId(p.sub)) return;
  CPN.paso = n;
  if (CPN.actual === p.sub && !CPN.cargandoMarco && archivoDe($c('cpn-marco').contentWindow?.location?.href || '') === subPorId(p.sub).archivo) { pintarPasos(p.sub, n); irAncla(p.ancla); return; }
  CPN.anclaPendiente = p.ancla || null;
  if (location.hash === '#' + p.sub) abrirSub(p.sub, true); else location.hash = p.sub;
}
function irAncla(id) {
  if (!id) return;
  try { const el = $c('cpn-marco').contentDocument?.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
}

/* ---------- Navegación: #sala, #agenda... (el botón Atrás del teléfono también funciona) ---------- */
// Ir a un submódulo (aunque ya sea el de la dirección: p. ej. volver a la Sala desde Ventas).
function irSub(id) { if (location.hash === '#' + id) abrirSub(id, true); else location.hash = id; return false; }
function irInicio() { if (!location.hash || location.hash === '#') mostrarInicio(); else location.hash = ''; return false; }
// "#pacientes?paciente=..." abre esa pantalla con esos datos (sirve para enlaces directos al panel).
function segunHash() {
  const [id, q] = decodeURIComponent(location.hash.replace(/^#/, '')).split('?');
  if (id && subPorId(id)) abrirSub(id, false, q);
  else mostrarInicio();
}
function mostrarInicio() {
  CPN.actual = null; document.querySelector('.page-content')?.classList.remove('cpn-dentro');
  $c('cpn-marco-wrap').style.display = 'none'; $c('cpn-pasos').style.display = 'none';
  $c('cpn-inicio-vista').style.display = '';
  marcarBarra(null);
  cargarInicio();
}
function abrirSub(id, forzar, consulta) {
  const s = subPorId(id); if (!s) return mostrarInicio();
  if (CPN.actual === id && !forzar && !consulta) return;
  CPN.actual = id; document.querySelector('.page-content')?.classList.add('cpn-dentro');
  $c('cpn-inicio-vista').style.display = 'none'; $c('cpn-marco-wrap').style.display = '';
  marcarBarra(id);
  pintarPasos(id, CPN_CICLO.some(p => p.n === CPN.paso && p.sub === id) ? CPN.paso : null);
  cargando(true);
  cargarMarco(s.archivo + (consulta ? '?' + consulta.replace(/^[?]/, '') : ''));
  vigilarMarco();
  ajustarAlto();
}

/* ---------- La pantalla interna: se le quita su menú y su encabezado ---------- */
const CSS_DENTRO = `#sidebar,#sidebar-overlay,#header,.mobile-menu-btn,#n360-asistente-btn,.asis-fab,.chat-fab{display:none!important}
#main{margin-left:0!important;width:100%!important;min-height:0!important}
html,body{overflow-x:hidden}`;
function prepararDentro(doc) {
  if (!doc || !doc.documentElement || doc.documentElement.dataset.cpnDentro === '1') return false;
  doc.documentElement.dataset.cpnDentro = '1';
  const st = doc.createElement('style'); st.id = 'cpn-css-dentro'; st.textContent = CSS_DENTRO;
  (doc.head || doc.documentElement).appendChild(st);
  return true;
}
// Mientras carga, se revisa seguido para ocultar el menú interno lo antes posible (sin parpadeo).
function vigilarMarco() {
  const fr = $c('cpn-marco'); let vueltas = 0;
  clearInterval(CPN.vigia);
  CPN.vigia = setInterval(() => {
    vueltas++;
    try {
      const doc = fr.contentDocument;
      if (doc && doc.location.href !== 'about:blank' && doc.documentElement) { prepararDentro(doc); }
    } catch (_) {}
    if (vueltas > 400) clearInterval(CPN.vigia);
  }, 25);
}
function alCargarMarco() {
  const fr = $c('cpn-marco');
  let win, archivo;
  try { win = fr.contentWindow; archivo = archivoDe(win.location.href); } catch (_) { cargando(false); return; }
  if (!archivo || win.location.href === 'about:blank') return;
  // Si la pantalla interna mandó a iniciar sesión o al inicio del sistema, eso pasa en la ventana completa.
  if (archivo === 'login.html' || archivo === 'index.html' || archivo === 'dashboard.html') { window.location.href = archivo === 'dashboard.html' ? 'dashboard.html' : 'login.html'; return; }
  try { prepararDentro(fr.contentDocument); } catch (_) {}
  clearInterval(CPN.vigia);
  cargando(false);
  // Desde adentro se puede pasar a otra pantalla (Sala → expediente, cobrar en Ventas...): el panel la sigue.
  const s = CPN.subs.find(x => x.archivo === archivo) || CPN_SUBS.find(x => x.archivo === archivo);
  if (s && subPorId(s.id)) {
    if (CPN.actual !== s.id) { CPN.actual = s.id; history.replaceState(null, '', '#' + s.id); pintarPasos(s.id, null); }
    marcarBarra(s.id);
  } else { CPN.actual = '__otra'; marcarBarra(null, CPN_OTRAS[archivo] || ''); }
  if (archivo === 'ventas.html') pintarPasos('sala', 4);      // en Ventas se está cobrando
  if (CPN.anclaPendiente) { const a = CPN.anclaPendiente; CPN.anclaPendiente = null; setTimeout(() => irAncla(a), 900); }
  try {                                                         // al empezar a irse a otra pantalla, se avisa "cargando"
    win.addEventListener('pagehide', () => { cargando(true); vigilarMarco(); });
  } catch (_) {}
  ajustarAlto();
}
// Cambiar la pantalla de adentro SIN agregar un paso al historial (así "Atrás" va de una parte del panel a otra).
function cargarMarco(url) {
  const fr = $c('cpn-marco');
  try { if (fr.contentWindow && fr.contentWindow.location.href !== 'about:blank') { fr.contentWindow.location.replace(url); return; } } catch (_) {}
  fr.src = url;
}
function cargando(si) { CPN.cargandoMarco = si; $c('cpn-cargando').style.display = si ? 'flex' : 'none'; }
function ajustarAlto() {
  const wrap = $c('cpn-marco-wrap'); if (!wrap || wrap.style.display === 'none') return;
  const top = wrap.getBoundingClientRect().top + window.scrollY;
  wrap.style.height = Math.max(420, window.innerHeight - Math.max(0, top - window.scrollY) - 8) + 'px';
}

/* ---------- Inicio del panel ---------- */
async function cargarInicio() {
  pintarSubmodulos();
  try {
    const hoy = vetHoy(), manana = vetSumarDias(hoy, 1);
    const [citas, citasManana, personal, consultorios, servicios, convenios, estancias] = await Promise.all([
      subPorId('sala') || subPorId('agenda') ? ClinicaCitas.cargar(hoy, hoy).then(r => r.citas).catch(() => []) : Promise.resolve([]),
      sb.from('agenda_citas').select('id', { count: 'exact', head: true }).eq('auth_user_id', STATE.userId).eq('fecha', manana).in('estado', ['reservada', 'confirmada']).then(r => r.count || 0).catch(() => 0),
      ClinicaCitas.medicos().catch(() => []),
      sb.from('clinica_consultorios').select('id').eq('auth_user_id', STATE.userId).then(r => r.data || []).catch(() => []),
      sb.from('productos').select('id').eq('auth_user_id', STATE.userId).eq('tipo', 'servicio').eq('activo', true).limit(1).then(r => r.data || []).catch(() => []),
      sb.from('clinica_convenios').select('id').eq('auth_user_id', STATE.userId).eq('activo', true).then(r => r.data || []).catch(() => []),
      sb.from('clinica_estancias').select('id').eq('auth_user_id', STATE.userId).eq('estado', 'activa').then(r => r.data || []).catch(() => []),
    ]);
    CPN.datos = { citas, citasManana, personal, consultorios, servicios, convenios, estancias };
    pintarCiclo(); pintarPreparar(); pintarPendientes();
  } catch (e) { console.error('inicio del panel:', e); $c('cpn-ciclo').innerHTML = '<p class="cl-sub">No se pudo cargar el resumen de hoy.</p>'; }
}
function contarCiclo() {
  const c = CPN.datos?.citas || [];
  return {
    1: c.filter(x => ['programada', 'confirmada'].includes(x.estado)).length,
    2: c.filter(x => x.estado === 'en_espera').length,
    3: c.filter(x => x.estado === 'en_consulta').length,
    4: c.filter(x => x.estado === 'atendida' && !x.venta_id).length,
    5: CPN.datos?.citasManana || 0,
  };
}
function pintarCiclo() {
  const n = contarCiclo();
  const txt = { 1: k => `${k} por llegar hoy`, 2: k => `${k} esperando`, 3: k => `${k} en consulta`, 4: k => `${k} por cobrar`, 5: k => `${k} citas mañana` };
  $c('cpn-ciclo').innerHTML = CPN_CICLO.map(p => `<button type="button" class="cpn-ciclo-paso" onclick="irPaso(${p.n})" ${subPorId(p.sub) ? '' : 'disabled title="No tienes acceso a esta parte"'}>
      <span class="cpn-ciclo-num">${p.n}</span><span class="cpn-ciclo-ico" aria-hidden="true">${p.icono}</span>
      <span class="cpn-ciclo-nom">${esc(p.nombre)}</span><span class="cpn-ciclo-ayuda">${esc(p.ayuda)}</span>
      <span class="cl-badge ${n[p.n] ? 'cl-badge-ambar' : 'cl-badge-gris'}">${esc(txt[p.n](n[p.n]))}</span></button>`).join('<span class="cpn-ciclo-flecha" aria-hidden="true">➜</span>')
    + '<div class="cpn-ciclo-vuelta" aria-hidden="true">🔁 Y vuelve a empezar con la próxima cita</div>';
}
function pintarPreparar() {
  const d = CPN.datos || {};
  const medicos = (d.personal || []).filter(m => m.activo !== false && ['medico', 'admin'].includes(m.rol));
  const conColumna = medicos.filter(m => m.agenda_profesional_id);
  const esp = typeof clinicaEspecialidadesActivas === 'function' ? clinicaEspecialidadesActivas(STATE.empresaConfig.clinica_especialidades) : [];
  const items = [
    { ok: true, t: 'Clínica encendida y especialidades elegidas', d: `${esp.length} especialidad${esp.length === 1 ? '' : 'es'} activa${esp.length === 1 ? '' : 's'}.`, ir: "irOtra('configuracion.html')", btn: 'Cambiar' },
    { ok: medicos.length > 0, t: 'Tus médicos, como usuarios del sistema', d: medicos.length ? `${medicos.length} médico${medicos.length === 1 ? '' : 's'} listo${medicos.length === 1 ? '' : 's'}.` : 'Crea a cada médico como usuario (menú de usuarios, arriba a la derecha) y márcalo como médico.', ir: "irSub('equipo')", btn: 'Médicos' },
    { ok: medicos.length > 0 && conColumna.length === medicos.length, t: 'Cada médico con su columna en la Agenda', d: medicos.length ? `${conColumna.length} de ${medicos.length} con columna.` : 'Primero crea los médicos.', ir: "irSub('equipo')", btn: 'Ligar' },
    { ok: (d.servicios || []).length > 0, t: 'Servicios con precio (consulta, curación...)', d: (d.servicios || []).length ? 'Ya tienes servicios en el catálogo.' : 'Crea tus servicios en Productos/Servicios, tipo "Servicio".', ir: "irOtra('productos.html')", btn: 'Servicios' },
    { ok: (d.consultorios || []).length > 0, opc: true, t: 'Consultorios', d: (d.consultorios || []).length ? `${d.consultorios.length} consultorio${d.consultorios.length === 1 ? '' : 's'}.` : 'Opcional: para que la pantalla de la sala diga a dónde pasar.', ir: "irSub('equipo')", btn: 'Consultorios' },
    { ok: (d.convenios || []).length > 0, opc: true, t: 'Seguros y convenios', d: (d.convenios || []).length ? `${d.convenios.length} convenio${d.convenios.length === 1 ? '' : 's'} activo${d.convenios.length === 1 ? '' : 's'}.` : 'Opcional: solo si trabajas con aseguradoras o empresas.', ir: "irSub('seguros')", btn: 'Seguros' },
  ];
  const obligatorios = items.filter(i => !i.opc), listos = obligatorios.filter(i => i.ok).length;
  const todo = listos === obligatorios.length;
  $c('cpn-preparar-estado').textContent = todo ? '✅ Lista para trabajar' : `${listos} de ${obligatorios.length} pasos listos`;
  $c('cpn-preparar').open = !todo;
  $c('cpn-preparar-lista').innerHTML = items.map((i, k) => `<div class="cpn-prep${i.ok ? ' ok' : ''}">
      <span class="cpn-prep-ico" aria-hidden="true">${i.ok ? '✅' : i.opc ? '➖' : '⬜'}</span>
      <div class="cpn-prep-txt"><b>${k + 1}. ${esc(i.t)}${i.opc ? ' <span class="cl-sub">(opcional)</span>' : ''}</b><span class="cl-sub">${esc(i.d)}</span></div>
      <button type="button" class="btn-accion-tabla ${i.ok ? 'btn-ghost' : 'btn-primary'}" onclick="${i.ir}">${esc(i.btn)}</button></div>`).join('');
}
function pintarPendientes() {
  const d = CPN.datos || {}, n = contarCiclo();
  const items = [];
  if (n[4]) items.push({ t: `💳 ${n[4]} visita${n[4] === 1 ? '' : 's'} de hoy sin cobrar`, ir: 'irPaso(4)' });
  if ((d.estancias || []).length && subPorId('hospital')) items.push({ t: `🛏️ ${d.estancias.length} paciente${d.estancias.length === 1 ? '' : 's'} en observación`, ir: "irSub('hospital')" });
  if (n[2]) items.push({ t: `🪑 ${n[2]} paciente${n[2] === 1 ? '' : 's'} esperando`, ir: 'irPaso(2)' });
  if (subPorId('seguros') && (d.convenios || []).length) items.push({ t: '🛡️ Revisar lo que hay por facturar a seguros', ir: "irSub('seguros')" });
  $c('cpn-pendientes').innerHTML = items.length ? items.map(i => `<button type="button" class="cpn-pend" onclick="${i.ir}">${esc(i.t)} <span aria-hidden="true">→</span></button>`).join('')
    : '<div class="cl-info">Nada pendiente por ahora. 👍</div>';
}
function pintarSubmodulos() {
  $c('cpn-subs').innerHTML = Object.entries(CPN_GRUPOS).map(([g, titulo]) => {
    const lista = CPN.subs.filter(s => s.grupo === g); if (!lista.length) return '';
    return `<div class="cl-seccion">${esc(titulo)}</div><div class="cpn-subs-grid">${lista.map(s => `<a class="cpn-sub" href="#${s.id}" onclick="return irSub('${s.id}')">
      <span class="cpn-sub-ico" aria-hidden="true">${s.icono}</span><span><b>${esc(s.nombre)}</b><span class="cl-sub">${esc(s.desc)}</span></span></a>`).join('')}</div>`;
  }).join('');
}
// Otra pantalla del sistema (Productos, Configuración...) también se abre dentro del panel.
function irOtra(archivo) {
  CPN.actual = '__otra'; document.querySelector('.page-content')?.classList.add('cpn-dentro'); if (location.hash !== '#__otra') history.pushState(null, '', '#__otra');   // "Atrás" regresa
  $c('cpn-inicio-vista').style.display = 'none'; $c('cpn-marco-wrap').style.display = ''; $c('cpn-pasos').style.display = 'none';
  marcarBarra(null, CPN_OTRAS[archivo] || '');
  cargando(true); cargarMarco(archivo); vigilarMarco(); ajustarAlto();
}

/* ---------- Recorrido guiado (la primera vez, y cuando se quiera con "Ver recorrido") ---------- */
const PASOS_RECORRIDO = [
  { icono: '🏥', titulo: 'Panel de Clínica', texto: 'Todo lo de la clínica está aquí. Arriba tienes cada parte en orden y el botón "🏥 Panel" para volver a este inicio cuando quieras. Nunca sales del panel.' },
  { icono: '🧰', titulo: '1. Prepara tu clínica (una sola vez)', texto: 'Sigue la lista "Prepara tu clínica": crea a tus médicos como usuarios, dales su columna en la Agenda y crea tus servicios con precio. Cada paso tiene su botón y se marca ✅ solo.' },
  { icono: '📅', titulo: '2. Agendar', texto: 'En la Agenda apartas la cita en la columna del médico. Puedes elegir un paciente, un cliente o escribir una persona nueva.' },
  { icono: '🪑', titulo: '3. Llega y espera', texto: 'En la Sala de espera tocas "Llegó" y recibe su turno. Con "Llamar" aparece al instante en la pantalla de la TV, con sonido.' },
  { icono: '🩺', titulo: '4. Consulta', texto: '"Atender" abre el expediente. El médico entra con su código, escribe la consulta, la firma y saca recetas u órdenes.' },
  { icono: '💳', titulo: '5. Cobrar', texto: '"Cuenta y cobro" abre Ventas con todo listo (y con el seguro, si tiene). Caja, inventario y reportes quedan exactos.' },
  { icono: '🔁', titulo: '6. Control', texto: 'Se agenda la próxima cita y el ciclo vuelve a empezar. Arriba de cada pantalla ves en qué paso vas y el botón "Siguiente paso".' },
  { icono: '📆', titulo: 'Cierre', texto: 'Cada semana o mes: factura a los seguros lo que cubrieron y paga los honorarios de cada médico en Reportes.' },
];
function mostrarRecorrido(forzar) {
  try {
    if (!window.Negocio360Tutorial) return;
    if (forzar) Negocio360Tutorial.mostrar('clinica_panel', PASOS_RECORRIDO);
    else Negocio360Tutorial.verificarYMostrar('clinica_panel', PASOS_RECORRIDO);
  } catch (e) { console.warn('recorrido:', e); }
}
