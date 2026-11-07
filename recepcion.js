/* =====================================================
   RECEPCION.JS — NEGOCIO360 (7-nov-2026)
   Módulo general opcional "Recepción (Turnos)".
   - Atender: dar turnos, llamar al siguiente, volver a llamar,
     atender, terminar, no se presentó, pasar al final.
   - Equipos: vincular la pantalla del televisor y el kiosko
     "Tome su turno" con un código de 6 dígitos.
   - Ajustes: servicios (letra), puestos y opciones de pantalla.
   - Estadísticas con exportación a Excel.
   CANDADOS: esta página nunca escribe turnos directo; todo pasa por
   funciones del servidor (numeración atómica, estados válidos).
   No toca ventas, caja, inventario ni ninguna otra tabla.
===================================================== */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = { userId: null, empresaConfig: {}, currentUser: {} };
const RC = {
  servicios: [], puestos: [], turnos: [], equipos: [], version: null, timer: null,
  tab: 'atender', ultimoTurno: null, cargando: false, stats: null,
};
const ESTADOS = {
  espera:     { t: 'En espera',        c: '#1d4ed8', bg: '#e8efff' },
  llamado:    { t: 'Llamado',          c: '#b45309', bg: '#fff4de' },
  atendiendo: { t: 'Atendiendo',       c: '#047857', bg: '#e3f8ee' },
  atendido:   { t: 'Atendido',         c: '#475569', bg: '#eef2f6' },
  no_vino:    { t: 'No se presentó',   c: '#b91c1c', bg: '#fdecec' },
  cancelado:  { t: 'Cancelado',        c: '#64748b', bg: '#f1f5f9' },
};
const MOTIVOS = {
  servicio: 'Ese servicio ya no está activo.', limite: 'Se alcanzó el máximo de turnos del día.', puesto: 'Elige un puesto activo primero.',
  vacio: 'No hay nadie en espera.', estado: 'Ese turno ya cambió (otra persona lo movió). Se actualizó la lista.', no_existe: 'Ese turno no existe.',
  codigo: 'El código no es válido o ya venció. Revisa el número que muestra el equipo.', modulo: 'Activa el módulo de Recepción primero.',
  sesion: 'Tu sesión venció. Vuelve a entrar.',
};

/* ---------- utilidades ---------- */
const $ = id => document.getElementById(id);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function perfil() { try { return JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); } catch (_) { return null; } }
function quien() { return perfil()?.nombre || STATE.currentUser?.nombre || 'Recepción'; }
function esAdmin() { const p = perfil(); return !p || p.tipo === 'admin'; }
function minutos(desde, hasta) { if (!desde) return 0; return Math.max(0, Math.round(((hasta ? new Date(hasta) : new Date()) - new Date(desde)) / 60000)); }
function durTxt(m) { if (m == null || isNaN(m)) return '—'; m = Math.round(m); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
function hora(iso) { return iso ? new Date(iso).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function baseURL() { return location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, ''); }
function urlSeguimiento(token) { return baseURL() + 'recepcion-mi-turno.html?t=' + encodeURIComponent(token); }
function qrSVG(texto, celda = 4) {
  try { if (typeof qrcode === 'undefined') return ''; const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag(celda, 0); } catch (_) { return ''; }
}
function chip(estado) { const e = ESTADOS[estado] || ESTADOS.espera; return `<span class="rc-chip" style="color:${e.c};background:${e.bg}">${e.t}</span>`; }
function motivo(r) { return MOTIVOS[r?.motivo] || 'No se pudo completar. Intenta de nuevo.'; }

/* ---------- shell (igual al resto del sistema) ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('n360_theme', theme);
  const sun = $('icon-sun'), moon = $('icon-moon');
  if (sun) sun.style.display = theme === 'dark' ? 'block' : 'none'; if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
function isMobileViewport() { return window.innerWidth <= 860; }
function toggleSidebar() {
  if (isMobileViewport()) { $('sidebar').classList.toggle('mobile-open'); $('sidebar-overlay').classList.toggle('active'); }
  else { $('sidebar').classList.toggle('collapsed'); $('main').classList.toggle('sidebar-collapsed'); }
}
function closeMobileSidebar() { $('sidebar').classList.remove('mobile-open'); $('sidebar-overlay').classList.remove('active'); }
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
function openModal(id) { const el = $(id); if (el) { el.style.display = 'flex'; el.classList.add('modal-open'); document.body.style.overflow = 'hidden'; } }
function closeModal(id) { const el = $(id); if (el) { el.style.display = 'none'; el.classList.remove('modal-open'); document.body.style.overflow = ''; } }
function showToast(msg, type = 'success') {
  const t = $('toast'); if (!t) { console.log(msg); return; }
  t.textContent = msg; t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`; setTimeout(() => t.classList.remove('show'), 3500);
}

/* =====================================================
   CARGA
===================================================== */
async function cargarCatalogos() {
  const [s, p] = await Promise.all([
    sb.from('recepcion_servicios').select('*').eq('auth_user_id', STATE.userId).order('orden').order('nombre'),
    sb.from('recepcion_puestos').select('*').eq('auth_user_id', STATE.userId).order('orden').order('nombre'),
  ]);
  RC.servicios = s.data || []; RC.puestos = p.data || [];
}
async function cargarTurnos(forzar) {
  if (RC.cargando) return;
  RC.cargando = true;
  try {
    const { data: ver } = await sb.rpc('recepcion_version');
    if (!forzar && ver && ver === RC.version) return;
    const { data, error } = await sb.from('recepcion_turnos')
      .select('id,codigo,letra,numero,servicio_id,servicio_nombre,nombre,telefono,nota,preferencial,estado,puesto_id,puesto_nombre,llamadas,origen,token_publico,orden_cola,creado_por,atendido_por,created_at,llamado_at,atencion_at,fin_at')
      .eq('auth_user_id', STATE.userId).eq('fecha', hoyISO()).order('orden_cola').range(0, 2999);
    if (error) throw error;
    RC.turnos = data || []; RC.version = ver;
    renderAtender();
  } catch (e) { console.warn('recepcion cargarTurnos:', e); }
  finally { RC.cargando = false; }
}
function arrancarSondeo() {
  clearInterval(RC.timer);
  RC.timer = setInterval(() => { if (!document.hidden && RC.tab === 'atender') cargarTurnos(false); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargarTurnos(false); });
  setInterval(() => { if (RC.tab === 'atender') pintarRelojes(); }, 15000);
}

/* =====================================================
   PUESTO DE ESTE EQUIPO
===================================================== */
function miPuestoId() {
  const g = localStorage.getItem('n360_rec_puesto_' + STATE.userId);
  if (g && RC.puestos.some(p => p.id === g && p.activo)) return g;
  return RC.puestos.find(p => p.activo)?.id || null;
}
function cambiarPuesto(id) { localStorage.setItem('n360_rec_puesto_' + STATE.userId, id); renderAtender(); }
function filtroServicios() { try { return JSON.parse(localStorage.getItem('n360_rec_filtro_' + STATE.userId) || '[]'); } catch (_) { return []; } }
function toggleFiltro(id) {
  let f = filtroServicios(); f = f.includes(id) ? f.filter(x => x !== id) : [...f, id];
  localStorage.setItem('n360_rec_filtro_' + STATE.userId, JSON.stringify(f)); renderAtender();
}

/* =====================================================
   TAB ATENDER
===================================================== */
function enEspera() {
  return RC.turnos.filter(t => t.estado === 'espera').sort((a, b) => (b.preferencial - a.preferencial) || (a.orden_cola - b.orden_cola));
}
function renderAtender() {
  const espera = enEspera();
  const atendidos = RC.turnos.filter(t => t.estado === 'atendido');
  const noVino = RC.turnos.filter(t => t.estado === 'no_vino');
  const esperas = RC.turnos.filter(t => t.llamado_at).map(t => minutos(t.created_at, t.llamado_at));
  $('rc-k-espera').textContent = espera.length;
  $('rc-k-atendidos').textContent = atendidos.length;
  $('rc-k-prom').textContent = esperas.length ? durTxt(esperas.reduce((a, b) => a + b, 0) / esperas.length) : '—';
  $('rc-k-novino').textContent = noVino.length;

  // Puesto
  const pid = miPuestoId();
  const selP = $('rc-puesto');
  selP.innerHTML = RC.puestos.filter(p => p.activo).map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')
    || '<option value="">Sin puestos (créalos en Ajustes)</option>';

  // Filtro de servicios
  const f = filtroServicios();
  $('rc-filtro').innerHTML = RC.servicios.filter(s => s.activo).map(s =>
    `<button type="button" class="rc-fchip ${f.includes(s.id) ? 'on' : ''}" onclick="toggleFiltro('${s.id}')" title="Atender solo este servicio">
       <b>${esc(s.letra)}</b>${esc(s.nombre)}</button>`).join('');
  $('rc-filtro-hint').textContent = f.length ? 'Solo llamas los servicios marcados.' : 'Llamas a todos los servicios (toca para atender solo algunos).';

  // Mi puesto
  const actual = RC.turnos.find(t => t.puesto_id === pid && ['llamado', 'atendiendo'].includes(t.estado));
  const cont = $('rc-actual');
  const cuantos = espera.filter(t => !f.length || f.includes(t.servicio_id)).length;
  if (actual) {
    cont.innerHTML = `
      <div class="rc-act-top">${chip(actual.estado)} ${actual.preferencial ? '<span class="rc-chip rc-pref">Preferencial</span>' : ''}<span class="rc-act-reloj" data-desde="${actual.estado === 'atendiendo' ? actual.atencion_at : actual.llamado_at}"></span></div>
      <div class="rc-act-cod">${esc(actual.codigo)}</div>
      <div class="rc-act-serv">${esc(actual.servicio_nombre || '')}${actual.nombre ? ' · <b>' + esc(actual.nombre) + '</b>' : ''}</div>
      ${actual.nota ? `<div class="rc-act-nota">📝 ${esc(actual.nota)}</div>` : ''}
      <div class="rc-act-btns">
        ${actual.estado === 'llamado' ? `<button class="rc-btn rc-ok" onclick="accion('${actual.id}','atender')">✅ Ya llegó, atender</button>` : `<button class="rc-btn rc-ok" onclick="accion('${actual.id}','terminar')">✔️ Terminar atención</button>`}
        <button class="rc-btn rc-sec" onclick="accion('${actual.id}','rellamar')">🔔 Volver a llamar${actual.llamadas > 1 ? ` (${actual.llamadas})` : ''}</button>
        ${actual.estado === 'llamado' ? `<button class="rc-btn rc-sec" onclick="accion('${actual.id}','al_final')">↩️ Pasar al final</button>
        <button class="rc-btn rc-mal" onclick="accion('${actual.id}','no_vino')">🚫 No se presentó</button>` : ''}
      </div>
      <button class="rc-llamar" onclick="llamarSiguiente()" ${cuantos ? '' : 'disabled'}>📣 Llamar siguiente <small>${cuantos} en espera</small></button>`;
  } else {
    cont.innerHTML = `
      <div class="rc-vacio-ico">🪑</div>
      <div class="rc-vacio-t">Tu puesto está libre</div>
      <div class="rc-vacio-s">${cuantos ? `Hay <b>${cuantos}</b> ${cuantos === 1 ? 'persona' : 'personas'} esperando.` : 'No hay nadie esperando por ahora.'}</div>
      <button class="rc-llamar" onclick="llamarSiguiente()" ${cuantos && pid ? '' : 'disabled'}>📣 Llamar siguiente</button>`;
  }

  // Lista de espera
  $('rc-espera-n').textContent = espera.length;
  $('rc-espera').innerHTML = espera.length ? espera.map((t, i) => `
    <div class="rc-fila ${t.preferencial ? 'pref' : ''}">
      <div class="rc-pos">${i + 1}</div>
      <div class="rc-cod">${esc(t.codigo)}</div>
      <div class="rc-info"><b>${esc(t.servicio_nombre || '')}</b><span>${t.nombre ? esc(t.nombre) + ' · ' : ''}${t.origen === 'kiosko' ? 'Kiosko · ' : ''}<i class="rc-reloj" data-desde="${t.created_at}"></i></span></div>
      <div class="rc-acc">
        <button class="rc-mini" title="Llamar a este turno a mi puesto" onclick="accion('${t.id}','llamar')">📣</button>
        <button class="rc-mini" title="Pasar al final" onclick="accion('${t.id}','al_final')">↓</button>
        <button class="rc-mini rc-mini-mal" title="Cancelar turno" onclick="confirmarCancelar('${t.id}','${esc(t.codigo)}')">✕</button>
      </div>
    </div>`).join('') : '<div class="rc-lista-vacia">Nadie en espera 🎉</div>';

  // En atención (todos los puestos)
  const enAt = RC.turnos.filter(t => ['llamado', 'atendiendo'].includes(t.estado)).sort((a, b) => new Date(b.llamado_at) - new Date(a.llamado_at));
  $('rc-enat').innerHTML = enAt.length ? enAt.map(t => `
    <div class="rc-at">
      <div class="rc-at-cod">${esc(t.codigo)}</div>
      <div class="rc-at-p">${esc(t.puesto_nombre || '')}</div>
      ${chip(t.estado)}
      <div class="rc-at-q">${esc(t.atendido_por || '')}</div>
    </div>`).join('') : '<div class="rc-lista-vacia">Ningún puesto atendiendo.</div>';

  // Terminados
  const fin = RC.turnos.filter(t => ['atendido', 'no_vino', 'cancelado'].includes(t.estado)).sort((a, b) => new Date(b.fin_at) - new Date(a.fin_at)).slice(0, 25);
  $('rc-fin').innerHTML = fin.length ? `<table class="rc-tabla"><thead><tr><th>Turno</th><th>Servicio</th><th>Puesto</th><th>Esperó</th><th>Atención</th><th>Estado</th><th></th></tr></thead><tbody>
    ${fin.map(t => `<tr><td><b>${esc(t.codigo)}</b>${t.nombre ? `<div class="rc-sub">${esc(t.nombre)}</div>` : ''}</td><td>${esc(t.servicio_nombre || '')}</td><td>${esc(t.puesto_nombre || '—')}</td>
      <td>${t.llamado_at ? durTxt(minutos(t.created_at, t.llamado_at)) : '—'}</td><td>${t.fin_at && (t.atencion_at || t.llamado_at) && t.estado === 'atendido' ? durTxt(minutos(t.atencion_at || t.llamado_at, t.fin_at)) : '—'}</td>
      <td>${chip(t.estado)}</td><td>${['no_vino', 'cancelado'].includes(t.estado) ? `<button class="rc-link" onclick="accion('${t.id}','reabrir')">Volver a la fila</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="rc-lista-vacia">Todavía no se termina ningún turno hoy.</div>';
  pintarRelojes();
}
function pintarRelojes() {
  document.querySelectorAll('[data-desde]').forEach(el => {
    const d = el.getAttribute('data-desde'); if (!d || d === 'null') { el.textContent = ''; return; }
    const m = minutos(d); el.textContent = el.classList.contains('rc-act-reloj') ? `⏱ ${durTxt(m)}` : `esperando ${durTxt(m)}`;
    el.classList.toggle('rc-tarde', m >= 20);
  });
}

async function llamarSiguiente() {
  const pid = miPuestoId();
  if (!pid) { showToast('Primero crea un puesto en Ajustes.', 'error'); return; }
  const btns = document.querySelectorAll('.rc-llamar'); btns.forEach(b => b.disabled = true);
  try {
    const f = filtroServicios();
    const { data, error } = await sb.rpc('recepcion_llamar_siguiente', { p_puesto: pid, p_servicios: f.length ? f : null, p_quien: quien() });
    if (error) throw error;
    if (!data?.ok) { showToast(motivo(data), 'error'); }
    else showToast(`📣 Llamando ${data.codigo} a ${data.puesto}`);
  } catch (e) { console.error(e); showToast('No se pudo llamar. Revisa tu internet.', 'error'); }
  await cargarTurnos(true);
}
async function accion(id, acc) {
  try {
    const { data, error } = await sb.rpc('recepcion_accion', { p_turno: id, p_accion: acc, p_puesto: miPuestoId(), p_quien: quien() });
    if (error) throw error;
    if (!data?.ok) showToast(motivo(data), 'error');
    else if (acc === 'rellamar' || acc === 'llamar') showToast('📣 Llamado en la pantalla');
  } catch (e) { console.error(e); showToast('No se pudo hacer. Revisa tu internet.', 'error'); }
  await cargarTurnos(true);
}
function confirmarCancelar(id, cod) {
  $('rc-cancel-txt').textContent = `¿Cancelar el turno ${cod}? Sale de la fila (se puede devolver desde "Terminados hoy").`;
  $('rc-cancel-btn').onclick = async () => { closeModal('modal-rc-cancelar'); await accion(id, 'cancelar'); };
  openModal('modal-rc-cancelar');
}

/* ---------- Nuevo turno ---------- */
function abrirNuevoTurno() {
  const act = RC.servicios.filter(s => s.activo);
  if (!act.length) { showToast('Crea al menos un servicio en Ajustes.', 'error'); return; }
  ['rc-n-nombre', 'rc-n-tel', 'rc-n-nota'].forEach(id => $(id).value = '');
  $('rc-n-servicios').innerHTML = act.map(s => {
    const n = RC.turnos.filter(t => t.estado === 'espera' && t.servicio_id === s.id).length;
    return `<button type="button" class="rc-serv ${s.preferencial ? 'pref' : ''}" onclick="darTurno('${s.id}', this)">
      <span class="rc-serv-l">${esc(s.letra)}</span><span class="rc-serv-n">${esc(s.nombre)}</span><span class="rc-serv-e">${n} en espera</span></button>`;
  }).join('');
  openModal('modal-rc-nuevo');
}
async function darTurno(servicioId, btn) {
  document.querySelectorAll('.rc-serv').forEach(b => b.disabled = true);
  btn.classList.add('cargando');
  try {
    const { data, error } = await sb.rpc('recepcion_nuevo_turno', {
      p_servicio: servicioId, p_nombre: $('rc-n-nombre').value, p_telefono: $('rc-n-tel').value, p_nota: $('rc-n-nota').value, p_creado_por: quien(),
    });
    if (error) throw error;
    if (!data?.ok) { showToast(motivo(data), 'error'); return; }
    RC.ultimoTurno = { ...data, telefono: $('rc-n-tel').value.trim(), nombre: $('rc-n-nombre').value.trim() };
    closeModal('modal-rc-nuevo');
    mostrarTurnoCreado();
    cargarTurnos(true);
  } catch (e) { console.error(e); showToast('No se pudo dar el turno. Revisa tu internet.', 'error'); }
  finally { document.querySelectorAll('.rc-serv').forEach(b => b.disabled = false); btn.classList.remove('cargando'); }
}
function mostrarTurnoCreado() {
  const t = RC.ultimoTurno; if (!t) return;
  $('rc-c-cod').textContent = t.codigo;
  $('rc-c-serv').textContent = t.servicio || '';
  $('rc-c-del').textContent = t.delante === 0 ? 'Es el siguiente en ser atendido' : `${t.delante} ${t.delante === 1 ? 'persona' : 'personas'} adelante`;
  $('rc-c-qr').innerHTML = qrSVG(urlSeguimiento(t.token), 4);
  $('rc-c-wa').style.display = t.telefono ? '' : 'none';
  openModal('modal-rc-creado');
}
function enviarWhatsApp() {
  const t = RC.ultimoTurno; if (!t?.telefono) return;
  let tel = t.telefono.replace(/\D/g, ''); if (tel.length === 8) tel = '505' + tel;
  const neg = STATE.empresaConfig.nombre_comercial || 'nuestro negocio';
  const msg = `Hola${t.nombre ? ' ' + t.nombre.split(' ')[0] : ''} 👋 Tu turno en ${neg} es *${t.codigo}* (${t.servicio}).\nMira en tu celular cuánto falta y te avisamos cuando te toque:\n${urlSeguimiento(t.token)}`;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank');
}
function imprimirTicket() {
  const t = RC.ultimoTurno; if (!t) return;
  const neg = esc(STATE.empresaConfig.nombre_comercial || '');
  const ancho = (STATE.empresaConfig.recepcion_cfg?.ticket_ancho === '80mm') ? '72mm' : '48mm';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Turno ${esc(t.codigo)}</title><style>
    @page{margin:0;size:auto} body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}
    .t{width:${ancho};margin:0 auto;padding:4mm 0;text-align:center}
    .n{font-size:13px;font-weight:700} .s{font-size:11px;margin-top:2mm} .c{font-size:44px;font-weight:900;letter-spacing:1px;margin:2mm 0}
    .d{font-size:11px} .q svg{width:30mm;height:30mm;margin-top:2mm} .f{font-size:9.5px;margin-top:2mm}
  </style></head><body><div class="t"><div class="n">${neg}</div><div class="s">SU TURNO</div><div class="c">${esc(t.codigo)}</div>
  <div class="d">${esc(t.servicio || '')}</div><div class="d">${new Date().toLocaleString('es-NI', { dateStyle: 'short', timeStyle: 'short' })}</div>
  <div class="d">${t.delante === 0 ? 'Es el siguiente' : t.delante + ' antes de usted'}</div>
  <div class="q">${qrSVG(urlSeguimiento(t.token), 3)}</div><div class="f">Escanee para ver su turno en el celular</div></div></body></html>`;
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (_) {} setTimeout(() => fr.remove(), 4000); }, 300);
}

/* =====================================================
   TABS
===================================================== */
function irTab(t) {
  if ((t === 'equipos' || t === 'ajustes') && !esAdmin()) { showToast('Solo el administrador puede entrar aquí.', 'error'); return; }
  RC.tab = t;
  document.querySelectorAll('.rc-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.rc-panel').forEach(p => p.style.display = p.id === 'rc-p-' + t ? '' : 'none');
  if (t === 'atender') cargarTurnos(true);
  if (t === 'equipos') cargarEquipos();
  if (t === 'ajustes') renderAjustes();
  if (t === 'estadisticas') cargarStats();
}

/* =====================================================
   EQUIPOS (TV y kiosko)
===================================================== */
async function cargarEquipos() {
  $('rc-url-tv').textContent = baseURL() + 'recepcion-pantalla.html';
  $('rc-url-k').textContent = baseURL() + 'recepcion-turno.html';
  $('rc-qr-tv').innerHTML = qrSVG(baseURL() + 'recepcion-pantalla.html', 3);
  $('rc-qr-k').innerHTML = qrSVG(baseURL() + 'recepcion-turno.html', 3);
  const { data } = await sb.from('recepcion_dispositivos').select('id,tipo,nombre,activo,ultimo_uso,created_at').eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
  RC.equipos = data || [];
  $('rc-equipos').innerHTML = RC.equipos.length ? RC.equipos.map(e => {
    const enLinea = e.activo && e.ultimo_uso && (Date.now() - new Date(e.ultimo_uso)) < 5 * 60000;
    return `<div class="rc-eq ${e.activo ? '' : 'off'}">
      <div class="rc-eq-ico">${e.tipo === 'pantalla' ? '📺' : '🎟️'}</div>
      <div class="rc-eq-i"><b>${esc(e.nombre)}</b><span>${e.tipo === 'pantalla' ? 'Pantalla de turnos' : 'Kiosko "Tome su turno"'} · vinculado ${new Date(e.created_at).toLocaleDateString('es-NI')}</span></div>
      <span class="rc-chip" style="${!e.activo ? 'color:#64748b;background:#f1f5f9' : enLinea ? 'color:#047857;background:#e3f8ee' : 'color:#b45309;background:#fff4de'}">${!e.activo ? 'Desactivado' : enLinea ? '● En línea' : 'Sin conexión'}</span>
      <button class="rc-link" onclick="cambiarEquipo('${e.id}', ${!e.activo})">${e.activo ? 'Desactivar' : 'Activar'}</button>
    </div>`;
  }).join('') : '<div class="rc-lista-vacia">Todavía no hay equipos vinculados.</div>';
}
async function vincular() {
  const cod = $('rc-v-cod').value.replace(/\D/g, '');
  const err = $('rc-v-err'); err.textContent = '';
  if (cod.length !== 6) { err.textContent = 'Escribe los 6 números que aparecen en el equipo.'; return; }
  const b = $('rc-v-btn'); b.disabled = true;
  try {
    const { data, error } = await sb.rpc('recepcion_par_vincular', { p_codigo: cod, p_nombre: $('rc-v-nom').value });
    if (error) throw error;
    if (!data?.ok) { err.textContent = motivo(data); return; }
    $('rc-v-cod').value = ''; $('rc-v-nom').value = '';
    showToast(data.tipo === 'pantalla' ? '📺 Pantalla vinculada: ya muestra los turnos.' : '🎟️ Kiosko vinculado: ya puede dar turnos.');
    cargarEquipos();
  } catch (e) { console.error(e); err.textContent = 'No se pudo vincular. Revisa tu internet.'; }
  finally { b.disabled = false; }
}
async function cambiarEquipo(id, activar) {
  const { error } = await sb.from('recepcion_dispositivos').update({ activo: activar }).eq('id', id).eq('auth_user_id', STATE.userId);
  if (error) { showToast('No se pudo cambiar.', 'error'); return; }
  showToast(activar ? 'Equipo activado.' : 'Equipo desactivado: deja de funcionar al instante.');
  cargarEquipos();
}

/* =====================================================
   AJUSTES
===================================================== */
function cfgRec() { return STATE.empresaConfig.recepcion_cfg || {}; }
function renderAjustes() {
  $('rc-servs').innerHTML = RC.servicios.map(s => `
    <tr data-id="${s.id}">
      <td><input class="rc-in" data-f="nombre" value="${esc(s.nombre)}" maxlength="60"/></td>
      <td><input class="rc-in rc-in-l" data-f="letra" value="${esc(s.letra)}" maxlength="2"/></td>
      <td><input class="rc-in rc-in-n" data-f="minutos_estimados" type="number" min="1" max="240" value="${s.minutos_estimados}"/></td>
      <td style="text-align:center"><input type="checkbox" data-f="preferencial" ${s.preferencial ? 'checked' : ''}/></td>
      <td style="text-align:center"><input type="checkbox" data-f="activo" ${s.activo ? 'checked' : ''}/></td>
    </tr>`).join('');
  $('rc-puestos').innerHTML = RC.puestos.map(p => `
    <tr data-id="${p.id}">
      <td><input class="rc-in" data-f="nombre" value="${esc(p.nombre)}" maxlength="40"/></td>
      <td style="text-align:center"><input type="checkbox" data-f="activo" ${p.activo ? 'checked' : ''}/></td>
    </tr>`).join('');
  const c = cfgRec();
  $('rc-o-voz').checked = c.voz !== false;
  $('rc-o-sonido').checked = c.sonido !== false;
  $('rc-o-nombre').checked = c.mostrar_nombre === true;
  $('rc-o-ticket').checked = c.kiosko_imprimir === true;
  $('rc-o-ancho').value = c.ticket_ancho === '80mm' ? '80mm' : '58mm';
  $('rc-o-msg').value = c.mensaje || '';
}
function agregarServicio() {
  const usadas = new Set(RC.servicios.map(s => s.letra));
  const letra = 'ABCDEFGHJKLMNRSTUVWXYZ'.split('').find(l => !usadas.has(l)) || 'Z';
  const tr = document.createElement('tr'); tr.dataset.id = 'nuevo';
  tr.innerHTML = `<td><input class="rc-in" data-f="nombre" placeholder="Ej. Retiro de pedidos" maxlength="60"/></td>
    <td><input class="rc-in rc-in-l" data-f="letra" value="${letra}" maxlength="2"/></td>
    <td><input class="rc-in rc-in-n" data-f="minutos_estimados" type="number" min="1" max="240" value="5"/></td>
    <td style="text-align:center"><input type="checkbox" data-f="preferencial"/></td><td style="text-align:center"><input type="checkbox" data-f="activo" checked/></td>`;
  $('rc-servs').appendChild(tr); tr.querySelector('input').focus();
}
function agregarPuesto() {
  const tr = document.createElement('tr'); tr.dataset.id = 'nuevo';
  tr.innerHTML = `<td><input class="rc-in" data-f="nombre" placeholder="Ej. Caja ${RC.puestos.length + 1}" maxlength="40"/></td><td style="text-align:center"><input type="checkbox" data-f="activo" checked/></td>`;
  $('rc-puestos').appendChild(tr); tr.querySelector('input').focus();
}
function leerFilas(tbody) {
  return Array.from($(tbody).querySelectorAll('tr')).map((tr, i) => {
    const o = { id: tr.dataset.id, orden: i + 1 };
    tr.querySelectorAll('[data-f]').forEach(el => { o[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
    return o;
  });
}
async function guardarAjustes() {
  const err = $('rc-a-err'); err.textContent = '';
  const servs = leerFilas('rc-servs').filter(s => s.nombre || s.id !== 'nuevo');
  const pts = leerFilas('rc-puestos').filter(p => p.nombre || p.id !== 'nuevo');
  for (const s of servs) {
    s.letra = (s.letra || '').toUpperCase();
    if (!s.nombre) { err.textContent = 'Cada servicio necesita un nombre.'; return; }
    if (!/^[A-Z]{1,2}$/.test(s.letra)) { err.textContent = `La letra de "${s.nombre}" debe ser 1 o 2 letras (A-Z).`; return; }
    s.minutos_estimados = Math.min(240, Math.max(1, parseInt(s.minutos_estimados, 10) || 5));
  }
  const letrasAct = servs.filter(s => s.activo).map(s => s.letra);
  if (new Set(letrasAct).size !== letrasAct.length) { err.textContent = 'Dos servicios activos no pueden tener la misma letra.'; return; }
  if (!servs.some(s => s.activo)) { err.textContent = 'Deja al menos un servicio activo.'; return; }
  for (const p of pts) if (!p.nombre) { err.textContent = 'Cada puesto necesita un nombre.'; return; }
  if (!pts.some(p => p.activo)) { err.textContent = 'Deja al menos un puesto activo.'; return; }
  const b = $('rc-a-btn'); b.disabled = true;
  try {
    for (const s of servs) {
      const fila = { nombre: s.nombre, letra: s.letra, minutos_estimados: s.minutos_estimados, preferencial: s.preferencial, activo: s.activo, orden: s.orden };
      const r = s.id === 'nuevo' ? await sb.from('recepcion_servicios').insert({ ...fila, auth_user_id: STATE.userId })
                                 : await sb.from('recepcion_servicios').update(fila).eq('id', s.id).eq('auth_user_id', STATE.userId);
      if (r.error) throw r.error;
    }
    for (const p of pts) {
      const fila = { nombre: p.nombre, activo: p.activo, orden: p.orden };
      const r = p.id === 'nuevo' ? await sb.from('recepcion_puestos').insert({ ...fila, auth_user_id: STATE.userId })
                                 : await sb.from('recepcion_puestos').update(fila).eq('id', p.id).eq('auth_user_id', STATE.userId);
      if (r.error) throw r.error;
    }
    const cfg = { ...cfgRec(), voz: $('rc-o-voz').checked, sonido: $('rc-o-sonido').checked, mostrar_nombre: $('rc-o-nombre').checked,
                  kiosko_imprimir: $('rc-o-ticket').checked, ticket_ancho: $('rc-o-ancho').value, mensaje: $('rc-o-msg').value.trim().slice(0, 240) };
    const r = await sb.from('configuracion_empresa').update({ recepcion_cfg: cfg }).eq('auth_user_id', STATE.userId);
    if (r.error) throw r.error;
    STATE.empresaConfig.recepcion_cfg = cfg;
    await cargarCatalogos(); renderAjustes();
    showToast('✅ Ajustes guardados. Las pantallas se actualizan solas.');
  } catch (e) { console.error(e); err.textContent = 'No se pudo guardar: ' + (e.message || 'revisa tu internet.'); }
  finally { b.disabled = false; }
}

/* =====================================================
   ESTADÍSTICAS
===================================================== */
function rangoFechas() {
  const v = $('rc-s-rango').value; const d = new Date(); const f = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  const hoy = f(d);
  if (v === 'hoy') return [hoy, hoy];
  if (v === 'ayer') { const a = new Date(d); a.setDate(a.getDate() - 1); return [f(a), f(a)]; }
  if (v === '7') { const a = new Date(d); a.setDate(a.getDate() - 6); return [f(a), hoy]; }
  if (v === '30') { const a = new Date(d); a.setDate(a.getDate() - 29); return [f(a), hoy]; }
  if (v === 'mes') return [`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, hoy];
  return [hoy, hoy];
}
async function leerTurnosRango(desde, hasta) {
  const todos = []; const P = 1000;
  for (let i = 0; i < 100; i++) {
    const { data, error } = await sb.from('recepcion_turnos')
      .select('fecha,codigo,servicio_nombre,nombre,estado,puesto_nombre,atendido_por,origen,preferencial,llamadas,created_at,llamado_at,atencion_at,fin_at')
      .eq('auth_user_id', STATE.userId).gte('fecha', desde).lte('fecha', hasta).order('created_at').range(i * P, i * P + P - 1);
    if (error) throw error;
    todos.push(...(data || [])); if (!data || data.length < P) break;
  }
  return todos;
}
function prom(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
async function cargarStats() {
  const [desde, hasta] = rangoFechas();
  $('rc-s-cuerpo').innerHTML = '<div class="rc-lista-vacia">Calculando…</div>';
  try {
    const l = await leerTurnosRango(desde, hasta);
    const esp = l.filter(t => t.llamado_at).map(t => (new Date(t.llamado_at) - new Date(t.created_at)) / 60000);
    const ate = l.filter(t => t.estado === 'atendido' && t.fin_at && (t.atencion_at || t.llamado_at)).map(t => (new Date(t.fin_at) - new Date(t.atencion_at || t.llamado_at)) / 60000);
    const agrupar = (k) => { const m = {}; l.forEach(t => { const key = t[k] || '—'; (m[key] = m[key] || []).push(t); }); return m; };
    const fila = (nombre, arr) => {
      const e = arr.filter(t => t.llamado_at).map(t => (new Date(t.llamado_at) - new Date(t.created_at)) / 60000);
      const a = arr.filter(t => t.estado === 'atendido' && t.fin_at && (t.atencion_at || t.llamado_at)).map(t => (new Date(t.fin_at) - new Date(t.atencion_at || t.llamado_at)) / 60000);
      return { nombre, total: arr.length, atendidos: arr.filter(t => t.estado === 'atendido').length, novino: arr.filter(t => t.estado === 'no_vino').length, espera: prom(e), atencion: prom(a) };
    };
    const porServ = Object.entries(agrupar('servicio_nombre')).map(([k, v]) => fila(k, v)).sort((a, b) => b.total - a.total);
    const porPuesto = Object.entries(agrupar('puesto_nombre')).filter(([k]) => k !== '—').map(([k, v]) => fila(k, v)).sort((a, b) => b.total - a.total);
    const porEmp = Object.entries(agrupar('atendido_por')).filter(([k]) => k !== '—').map(([k, v]) => fila(k, v)).sort((a, b) => b.total - a.total);
    const horas = Array.from({ length: 24 }, () => 0); l.forEach(t => horas[new Date(t.created_at).getHours()]++);
    const hMin = horas.findIndex(h => h > 0), hMax = 23 - [...horas].reverse().findIndex(h => h > 0);
    const maxH = Math.max(1, ...horas);
    RC.stats = { desde, hasta, l, porServ, porPuesto, porEmp, horas, k: {
      total: l.length, atendidos: l.filter(t => t.estado === 'atendido').length, novino: l.filter(t => t.estado === 'no_vino').length,
      cancel: l.filter(t => t.estado === 'cancelado').length, espera: prom(esp), esperaMax: esp.length ? Math.max(...esp) : null, atencion: prom(ate),
      kiosko: l.filter(t => t.origen === 'kiosko').length } };
    const k = RC.stats.k;
    const tabla = (titulo, filas) => `<div class="rc-card"><div class="rc-card-t">${titulo}</div>${filas.length ? `<table class="rc-tabla"><thead><tr><th>Nombre</th><th>Turnos</th><th>Atendidos</th><th>No vinieron</th><th>Espera prom.</th><th>Atención prom.</th></tr></thead><tbody>
      ${filas.map(f => `<tr><td><b>${esc(f.nombre)}</b></td><td>${f.total}</td><td>${f.atendidos}</td><td>${f.novino}</td><td>${durTxt(f.espera)}</td><td>${durTxt(f.atencion)}</td></tr>`).join('')}</tbody></table>` : '<div class="rc-lista-vacia">Sin datos.</div>'}</div>`;
    $('rc-s-cuerpo').innerHTML = `
      <div class="rc-kpis">
        <div class="rc-kpi"><span>Turnos dados</span><b>${k.total}</b><i>${k.kiosko} desde el kiosko</i></div>
        <div class="rc-kpi"><span>Atendidos</span><b>${k.atendidos}</b><i>${k.total ? Math.round(k.atendidos / k.total * 100) : 0}% del total</i></div>
        <div class="rc-kpi"><span>Espera promedio</span><b>${durTxt(k.espera)}</b><i>la más larga: ${durTxt(k.esperaMax)}</i></div>
        <div class="rc-kpi"><span>Atención promedio</span><b>${durTxt(k.atencion)}</b><i>por persona</i></div>
        <div class="rc-kpi"><span>No se presentaron</span><b>${k.novino}</b><i>${k.cancel} cancelados</i></div>
      </div>
      <div class="rc-card"><div class="rc-card-t">Horas con más gente (turnos dados)</div>
        ${hMin < 0 ? '<div class="rc-lista-vacia">Sin datos.</div>' : `<div class="rc-barras">${horas.slice(hMin, hMax + 1).map((h, i) => `<div class="rc-barra"><i style="height:${Math.round(h / maxH * 100)}%"><em>${h || ''}</em></i><span>${String(hMin + i).padStart(2, '0')}h</span></div>`).join('')}</div>`}
      </div>
      ${tabla('Por servicio', porServ)}${tabla('Por puesto', porPuesto)}${tabla('Por persona que atendió', porEmp)}`;
  } catch (e) { console.error(e); $('rc-s-cuerpo').innerHTML = '<div class="rc-lista-vacia" style="color:#b91c1c">No se pudieron cargar las estadísticas.</div>'; }
}
async function cargarExcelJS() {
  if (window.ExcelJS) return;
  await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s); });
}
async function exportarExcel() {
  const S = RC.stats; if (!S) { showToast('Primero carga las estadísticas.', 'error'); return; }
  try {
    await cargarExcelJS();
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Recepción');
    const azul = 'FF1D4ED8';
    ws.columns = [{ width: 12 }, { width: 10 }, { width: 22 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 }];
    ws.mergeCells('A1:L1'); ws.getCell('A1').value = `${STATE.empresaConfig.nombre_comercial || 'Negocio'} — Reporte de Recepción (turnos)`;
    ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }; ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } };
    ws.getRow(1).height = 26;
    ws.mergeCells('A2:L2'); ws.getCell('A2').value = `Del ${S.desde} al ${S.hasta} · Generado ${new Date().toLocaleString('es-NI')}`; ws.getCell('A2').font = { italic: true, color: { argb: 'FF475569' } };
    const k = S.k; let r = 4;
    [['Turnos dados', k.total], ['Atendidos', k.atendidos], ['No se presentaron', k.novino], ['Cancelados', k.cancel], ['Espera promedio (min)', k.espera != null ? +k.espera.toFixed(1) : '—'], ['Atención promedio (min)', k.atencion != null ? +k.atencion.toFixed(1) : '—']]
      .forEach(([a, b]) => { ws.getCell(`A${r}`).value = a; ws.mergeCells(`A${r}:C${r}`); ws.getCell(`D${r}`).value = b; ws.getCell(`A${r}`).font = { bold: true }; r++; });
    r++;
    const enc = ['Fecha', 'Turno', 'Servicio', 'Cliente', 'Puesto', 'Atendió', 'Estado', 'Pidió', 'Llamado', 'Terminó', 'Esperó (min)', 'Atención (min)'];
    ws.getRow(r).values = enc; ws.getRow(r).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
    ws.getRow(r).height = 22; r++;
    const h = iso => iso ? new Date(iso).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }) : '';
    S.l.forEach((t, i) => {
      const esp = t.llamado_at ? +((new Date(t.llamado_at) - new Date(t.created_at)) / 60000).toFixed(1) : '';
      const at = t.estado === 'atendido' && t.fin_at && (t.atencion_at || t.llamado_at) ? +((new Date(t.fin_at) - new Date(t.atencion_at || t.llamado_at)) / 60000).toFixed(1) : '';
      const row = ws.getRow(r++);
      row.values = [t.fecha, t.codigo, t.servicio_nombre || '', t.nombre || '', t.puesto_nombre || '', t.atendido_por || '', (ESTADOS[t.estado] || {}).t || t.estado, h(t.created_at), h(t.llamado_at), h(t.fin_at), esp, at];
      if (i % 2) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5FB' } }; });
    });
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `Recepcion_${S.desde}_a_${S.hasta}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { console.error(e); showToast('No se pudo crear el Excel.', 'error'); }
}

/* =====================================================
   INICIO
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = $('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;
    const [cfg, us] = await Promise.all([
      sb.from('configuracion_empresa').select('*').eq('auth_user_id', user.id).maybeSingle(),
      sb.from('usuarios').select('*').eq('auth_user_id', user.id).maybeSingle(),
    ]);
    STATE.empresaConfig = cfg.data || {}; STATE.currentUser = us.data || {};
    const lt = $('sidebar-logo-text'); if (lt) lt.textContent = STATE.empresaConfig.nombre_comercial || 'Mi negocio';
    const name = STATE.currentUser?.nombre || user.email?.split('@')[0] || 'Usuario';
    const hn = $('header-name'); if (hn) hn.textContent = name;
    const ha = $('header-avatar'); if (ha) ha.textContent = (name || 'U')[0].toUpperCase();
    $('loader').classList.add('hidden'); $('app').style.display = 'flex';

    if (STATE.empresaConfig.usa_modulo_recepcion !== true) {
      $('rc-bloqueo').innerHTML = '🛎️ El módulo de <b>Recepción</b> está apagado. Actívalo en <a href="configuracion.html">Configuración → Recepción (Turnos)</a>.';
      $('rc-bloqueo').style.display = ''; $('rc-cuerpo').style.display = 'none'; return;
    }
    if (!esAdmin()) document.querySelectorAll('.rc-tab[data-tab="equipos"], .rc-tab[data-tab="ajustes"]').forEach(b => b.style.display = 'none');
    await sb.rpc('recepcion_iniciar');      // crea servicios y puestos de ejemplo solo la primera vez
    await cargarCatalogos();
    await cargarTurnos(true);
    arrancarSondeo();
  } catch (e) {
    console.error('init recepcion:', e);
    $('loader').classList.add('hidden'); $('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

/* Moneda de visualización (igual que en el resto de módulos) */
function abrirModalMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  $('mv-moneda-oficial').textContent = oficial;
  $('mv-select-moneda').value = monedaVisualizacionActiva() || '';
  $('mv-tasa').value = tasaVisualizacionActiva() || '';
  $('mv-error').textContent = '';
  onCambiarSelectMonedaVis();
  $('modal-moneda-vis').style.display = 'flex';
}
function onCambiarSelectMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = $('mv-select-moneda').value;
  $('mv-wrap-tasa').style.display = (elegida && elegida !== oficial) ? '' : 'none';
}
function guardarMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = $('mv-select-moneda').value;
  const errEl = $('mv-error'); errEl.textContent = '';
  if (!elegida || elegida === oficial) desactivarMonedaVisualizacion();
  else {
    const tasa = parseFloat($('mv-tasa').value);
    if (!tasa || tasa <= 0) { errEl.textContent = 'Escribe tu tasa de cambio (cordobas por 1 dolar).'; return; }
    activarMonedaVisualizacion(elegida, tasa);
  }
  location.reload();
}
