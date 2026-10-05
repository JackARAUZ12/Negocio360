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

    await cargarEstancias();
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
   EN EL LOCAL -- hospitalizacion, pension y bano (utilidades en vet-comun.js)
===================================================== */
const ES = { items: [], mascotas: [], mapa: {}, equipo: [], cargos: {}, notas: {}, ultimaNota: {}, filtro: 'activos', mascota: null, prodTarifa: null, prodCargo: null, ctx: null, editId: null };
const $e = id => document.getElementById(id);
const hhmmES = iso => { const d = new Date(iso); return `${_vp(d.getHours())}:${_vp(d.getMinutes())}`; };
const fechaHoraES = iso => { const p = vetPartes(vetYmdLocal(iso)); return `${_vp(p.d)}/${_vp(p.m)} ${vetFormatoHora(hhmmES(iso))}`; };
const fechaCortaES = ymd => { if (!ymd) return '—'; const p = vetPartes(ymd); return `${_vp(p.d)}/${_vp(p.m)}/${p.y}`; };

async function traerTodo(construir) {
  const tam = 1000; let desde = 0, todo = [];
  while (true) {
    const { data, error } = await construir().range(desde, desde + tam - 1);
    if (error) throw error;
    todo = todo.concat(data || []);
    if (!data || data.length < tam) break;
    desde += tam; if (desde > 50000) break;
  }
  return todo;
}
function duenoES(m) {
  const c = m && m.clientes;
  if (!c) return { nombre: '(sin dueño)', tel: '' };
  return { nombre: `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Sin nombre', tel: c.telefono || c.whatsapp || '' };
}
const enChunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/* ---------- Carga ---------- */
async function cargarEstancias() {
  try {
    const [eq, ms, es] = await Promise.all([
      traerTodo(() => sb.from('vet_veterinarios').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('id')),
      traerTodo(() => sb.from('vet_mascotas').select('id, nombre, especie, activo, cliente_id, clientes(nombre, apellido, telefono, whatsapp)').eq('auth_user_id', STATE.userId).order('id')),
      traerTodo(() => sb.from('vet_estancias').select('*, ventas(numero_venta, estado)').eq('auth_user_id', STATE.userId).order('id')),
    ]);
    ES.equipo = eq; ES.mascotas = ms; ES.mapa = {}; ms.forEach(m => { ES.mapa[m.id] = m; });
    ES.items = es.sort((a, b) => String(b.fecha_ingreso).localeCompare(String(a.fecha_ingreso)));
    // cargos (en lotes pequeños: la URL de un "in" con cientos de ids se vuelve demasiado larga) y ultima nota de los hospitalizados
    ES.cargos = {}; ES.ultimaNota = {};
    for (const grupo of enChunks(ES.items.map(i => i.id), 80)) {
      const { data } = await sb.from('vet_cargos').select('*, productos(precio)').eq('auth_user_id', STATE.userId).in('estancia_id', grupo).order('created_at');
      (data || []).forEach(c => { (ES.cargos[c.estancia_id] = ES.cargos[c.estancia_id] || []).push(c); });
    }
    const hosp = ES.items.filter(i => i.tipo === 'hospitalizacion' && (i.estado === 'activa' || i.estado === 'lista')).map(i => i.id);
    if (hosp.length) {
      const { data } = await sb.from('vet_estancia_notas').select('*').eq('auth_user_id', STATE.userId).in('estancia_id', hosp).order('fecha', { ascending: false });
      (data || []).forEach(n => { if (!ES.ultimaNota[n.estancia_id]) ES.ultimaNota[n.estancia_id] = n; });
    }
    renderES();
  } catch (e) { console.error('cargarEstancias:', e); $e('es-lista').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar. Intenta recargar la página.</p>'; }
}

/* ---------- Lista ---------- */
const enLocal = i => i.estado === 'activa' || i.estado === 'lista';
const cobrada = i => i.ventas && i.ventas.estado === 'completada';
const porCobrar = i => i.estado === 'finalizada' && (ES.cargos[i.id] || []).length > 0 && !cobrada(i);
function filtrarES(f) { ES.filtro = f; document.querySelectorAll('#es-chips .vt-chip').forEach(b => b.classList.toggle('activa', b.dataset.f === f)); renderES(); }
function itemsES() {
  const t = $e('es-tipo').value;
  return ES.items.filter(i => (!t || i.tipo === t) && (ES.filtro === 'activos' ? enLocal(i) : ES.filtro === 'porcobrar' ? porCobrar(i) : (i.estado === 'finalizada' || i.estado === 'cancelada')));
}
function renderES() {
  const activos = ES.items.filter(enLocal);
  $e('es-kpi-total').textContent = activos.length;
  $e('es-kpi-hosp').textContent = activos.filter(i => i.tipo === 'hospitalizacion').length;
  $e('es-kpi-pens').textContent = activos.filter(i => i.tipo === 'pension').length;
  $e('es-kpi-listos').textContent = activos.filter(i => i.estado === 'lista').length;
  const cont = $e('es-lista'), lista = itemsES(), hoy = vetHoy();
  if (!lista.length) { cont.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;padding:14px 0">${ES.filtro === 'activos' ? 'No hay mascotas en el local ahora. Ingresa una con "+ Ingresar mascota".' : ES.filtro === 'porcobrar' ? 'No hay cuentas por cobrar. 🎉' : 'Sin historial todavía.'}</p>`; return; }
  cont.innerHTML = lista.slice(0, 300).map(i => {
    const m = ES.mapa[i.mascota_id], esp = VET_ESPECIES[m?.especie] || VET_ESPECIES.otro, d = duenoES(m), t = VET_TIPOS_ESTANCIA[i.tipo], est = VET_ESTADOS_ESTANCIA[i.estado];
    const dias = vetDiasEstancia(i.fecha_ingreso, i.fecha_salida);
    const vencida = enLocal(i) && i.fecha_salida_prevista && i.fecha_salida_prevista < hoy;
    const cargos = ES.cargos[i.id] || [], total = cargos.reduce((s, c) => s + Number(c.cantidad) * Number(c.productos?.precio || 0), 0), nota = ES.ultimaNota[i.id];
    const b = [];
    if (enLocal(i)) {
      if (i.tipo === 'hospitalizacion') b.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirNota('${i.id}')">📝 Nota</button>`);
      if (i.tipo === 'estetica' && i.estado === 'activa') b.push(`<button class="btn-accion-tabla btn-ghost" onclick="marcarLista('${i.id}')">✨ Lista</button>`);
      b.push(`<button class="btn-accion-tabla btn-ghost" onclick="avisarListo('${i.id}')">📲 Avisar</button>`);
      b.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirCuenta('${i.id}')">💳 Cuenta</button>`);
      b.push(`<button class="btn-accion-tabla btn-primary" onclick="finalizarES('${i.id}')">✅ ${esc(t.verbo)}</button>`);
      b.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirIngreso('${i.id}')">✏️</button><button class="btn-accion-tabla btn-ghost" onclick="cancelarES('${i.id}')">❌</button>`);
    } else if (i.estado === 'finalizada') {
      b.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirCuenta('${i.id}')">💳 Cuenta</button>`);
      if (cargos.length && !cobrada(i)) b.push(`<button class="btn-accion-tabla btn-primary" onclick="cobrarES('${i.id}')">💳 Cobrar</button>`);
    }
    return `<div class="ag-card est-${i.estado === 'lista' ? 'confirmada' : i.estado === 'finalizada' ? 'atendida' : i.estado}">
      <div class="ag-fila"><div><span class="ag-hora">${t.e} ${esc(t.n)}</span>${i.ubicacion ? ` <span class="ag-dur">· ${esc(i.ubicacion)}</span>` : ''}</div><span class="vt-badge vt-badge-${est.clase}">${esc(est.n)}</span></div>
      <div class="vt-mascota"><span class="vt-emoji">${esp.e}</span><div><div class="vt-nombre">${esc(m?.nombre || '(mascota eliminada)')}</div><div class="vt-sub">👤 ${esc(d.nombre)}${d.tel ? ' · ' + esc(d.tel) : ''}</div></div></div>
      <div class="vt-sub">Ingresó ${esc(fechaHoraES(i.fecha_ingreso))} · <b>${dias} ${dias === 1 ? 'día' : 'días'}</b>${i.fecha_salida ? ' · salió ' + esc(fechaHoraES(i.fecha_salida)) : ''}</div>
      ${i.fecha_salida_prevista && enLocal(i) ? `<div class="vt-sub">Salida prevista: ${fechaCortaES(i.fecha_salida_prevista)} ${vencida ? '<span class="vt-badge vt-badge-rojo">pasó la fecha</span>' : ''}</div>` : ''}
      ${i.motivo ? `<div class="ag-motivo">${esc(i.motivo)}</div>` : ''}${i.veterinario ? `<div class="vt-sub">👨‍⚕️ ${esc(i.veterinario)}</div>` : ''}
      ${nota ? `<div class="es-nota"><b>Última nota</b> (${esc(fechaHoraES(nota.fecha))}): ${esc(nota.nota)}${nota.temperatura ? ` · ${nota.temperatura} °C` : ''}</div>` : ''}
      ${cargos.length ? `<div class="vt-sub">💳 ${cargos.length} concepto${cargos.length === 1 ? '' : 's'} · ${esc(fmt(total))} ${cobrada(i) ? `<span class="vt-cobrada">✅ Cobrada · ${esc(i.ventas.numero_venta)}</span>` : ''}</div>` : ''}
      <div class="ag-btns">${b.join('')}</div></div>`;
  }).join('');
}

/* ---------- Veterinario: libre / unico / varios ---------- */
function pintarVetES(idPref, textoPrevio) {
  const modo = vetModoEquipo(ES.equipo), txt = $e('ing-vet'), sel = $e('ing-vet-sel'), fijo = $e('ing-vet-fijo');
  txt.style.display = modo === 'libre' ? '' : 'none'; sel.style.display = modo === 'varios' ? '' : 'none'; fijo.style.display = modo === 'unico' ? '' : 'none';
  if (modo === 'libre') txt.value = textoPrevio || '';
  if (modo === 'unico') fijo.textContent = '👨‍⚕️ ' + ES.equipo[0].nombre + ' (asignado automáticamente)';
  if (modo === 'varios') { sel.innerHTML = '<option value="">— Sin asignar —</option>' + ES.equipo.map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join(''); sel.value = idPref || ''; }
}

/* ---------- Buscadores ---------- */
function elegirMascotaES(id) {
  ES.mascota = ES.mapa[id]; if (!ES.mascota) return;
  $e('ing-m-resultados').style.display = 'none'; $e('ing-m-buscar').value = '';
  const esp = VET_ESPECIES[ES.mascota.especie] || VET_ESPECIES.otro, el = $e('ing-m-elegida');
  el.textContent = `${esp.e} ${ES.mascota.nombre} · 👤 ${duenoES(ES.mascota).nombre}`; el.style.display = '';
}
function buscarMascotaES(q) {
  const cont = $e('ing-m-resultados'); q = (q || '').trim().toLowerCase();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  const h = ES.mascotas.filter(m => m.activo && [m.nombre, duenoES(m).nombre, duenoES(m).tel].some(t => String(t || '').toLowerCase().includes(q))).slice(0, 8);
  cont.innerHTML = h.length ? h.map(m => `<div class="vt-resultado" data-id="${m.id}">${(VET_ESPECIES[m.especie] || VET_ESPECIES.otro).e} <b>${esc(m.nombre)}</b> <span style="color:var(--text-muted)">· ${esc(duenoES(m).nombre)}</span></div>`).join('')
    : '<div class="vt-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados — regístrala primero en Mascotas</div>';
  cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => elegirMascotaES(el.dataset.id)));
  cont.style.display = '';
}
const _timers = {};
function elegirProdES(pref, id, nombre) {
  if (pref === 'ct') ES.prodCargo = { id, nombre }; else ES.prodTarifa = { id, nombre };
  $e(pref + '-resultados').style.display = 'none'; $e(pref + '-buscar').value = '';
  const el = $e(pref + '-elegido'); el.textContent = '✔ ' + nombre; el.style.display = '';
}
function buscarProdES(pref, q) {
  clearTimeout(_timers[pref]); const cont = $e(pref + '-resultados'); q = (q || '').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _timers[pref] = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('productos').select('id, nombre, precio, tipo').eq('auth_user_id', STATE.userId).eq('activo', true)
        .or('es_sustancia_controlada.is.null,es_sustancia_controlada.eq.false').ilike('nombre', `%${q}%`).order('nombre').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length) ? data.map(p => `<div class="vt-resultado" data-id="${p.id}" data-n="${esc(p.nombre)}">${p.tipo === 'servicio' ? '🛎️' : '📦'} ${esc(p.nombre)} <span style="color:var(--text-muted)">· ${esc(fmt(p.precio || 0))}</span></div>`).join('')
        : '<div class="vt-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados</div>';
      cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => elegirProdES(pref, el.dataset.id, el.dataset.n)));
      cont.style.display = '';
    } catch (e) { console.error('buscarProdES:', e); }
  }, 250);
}

/* ---------- Ingreso / edicion ---------- */
function abrirIngreso(id) {
  const i = id ? ES.items.find(x => x.id === id) : null; ES.editId = i ? i.id : null; ES.prodTarifa = null;
  const selT = $e('ing-tipo');
  if (!selT.options.length) Object.entries(VET_TIPOS_ESTANCIA).forEach(([k, v]) => selT.add(new Option(`${v.e} ${v.n}`, k)));
  $e('ing-titulo').textContent = i ? '✏️ Editar estancia' : '🏥 Ingresar mascota';
  ['ing-m-buscar', 'ing-t-buscar'].forEach(x => { $e(x).value = ''; }); ['ing-m-resultados', 'ing-t-resultados', 'ing-m-elegida', 'ing-t-elegido'].forEach(x => { $e(x).style.display = 'none'; });
  ES.mascota = null; if (i) elegirMascotaES(i.mascota_id);
  selT.value = i ? i.tipo : 'hospitalizacion'; selT.disabled = !!i;
  $e('ing-ubic').value = i?.ubicacion || ''; $e('ing-motivo').value = i?.motivo || ''; $e('ing-salida').value = i?.fecha_salida_prevista || ''; $e('ing-error').textContent = '';
  pintarVetES(i?.veterinario_id, i?.veterinario);
  if (i && i.tarifa_producto_id) { ES.prodTarifa = { id: i.tarifa_producto_id, nombre: '(tarifa ya asignada)' }; const el = $e('ing-t-elegido'); el.textContent = '✔ Tarifa ya asignada (busca otra para cambiarla)'; el.style.display = ''; }
  openModal('modal-ing');
}
function cerrarIngreso() { closeModal('modal-ing'); }
async function guardarIngreso() {
  const err = $e('ing-error'); err.textContent = ''; const fallo = t => { err.textContent = t; };
  const salida = $e('ing-salida').value || null;
  if (!ES.mascota) return fallo('Elige la mascota.');
  if (salida && !ES.editId && salida < vetHoy()) return fallo('La salida prevista no puede ser una fecha pasada.');
  const vet = vetResolverVeterinario(ES.equipo, $e('ing-vet-sel').value, $e('ing-vet').value), v = id => $e(id).value.trim() || null;
  const payload = { veterinario_id: vet.id, veterinario: vet.nombre, ubicacion: v('ing-ubic'), motivo: v('ing-motivo'), fecha_salida_prevista: salida, tarifa_producto_id: ES.prodTarifa ? ES.prodTarifa.id : null };
  const btn = $e('ing-btn-guardar'); btn.disabled = true;
  try {
    const q = ES.editId ? sb.from('vet_estancias').update(payload).eq('id', ES.editId).eq('auth_user_id', STATE.userId)
      : sb.from('vet_estancias').insert({ ...payload, auth_user_id: STATE.userId, mascota_id: ES.mascota.id, tipo: $e('ing-tipo').value });
    const { error } = await q;
    if (error) { if (error.code === '23505') return fallo('Esa mascota ya está en el local con ese servicio.'); throw error; }
    showToast(ES.editId ? 'Estancia actualizada.' : 'Mascota ingresada.'); closeModal('modal-ing'); await cargarEstancias();
  } catch (e) { console.error('guardarIngreso:', e); fallo('No se pudo guardar. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}

/* ---------- Estados y avisos ---------- */
async function actualizarES(id, cambios) {
  const { error } = await sb.from('vet_estancias').update(cambios).eq('id', id).eq('auth_user_id', STATE.userId);
  if (error) throw error;
  Object.assign(ES.items.find(x => x.id === id) || {}, cambios);
}
async function marcarLista(id) {
  try { await actualizarES(id, { estado: 'lista' }); showToast('Marcada como lista. Puedes avisar al dueño con 📲.'); renderES(); }
  catch (e) { console.error('marcarLista:', e); showToast('No se pudo cambiar el estado.', 'error'); }
}
async function avisarListo(id) {
  const i = ES.items.find(x => x.id === id); if (!i) return;
  const m = ES.mapa[i.mascota_id], d = duenoES(m), tel = vetTelefonoWhatsApp(d.tel, STATE.empresaConfig?.pais);
  if (!tel) { showToast('El dueño no tiene un teléfono válido. Agrégalo en la ficha de la mascota.', 'error'); return; }
  window.open(vetEnlaceWhatsApp(tel, vetMensajeListo({ dueno: d.nombre, mascota: m?.nombre || 'su mascota', negocio: STATE.empresaConfig?.nombre_comercial })), '_blank', 'noopener');   // primero: el navegador exige que sea directo al clic
  try { await actualizarES(id, { aviso_enviado_en: new Date().toISOString() }); } catch (e) { console.warn('avisarListo (marcar):', e); }
}
async function finalizarES(id) {
  const i = ES.items.find(x => x.id === id); if (!i) return;
  const t = VET_TIPOS_ESTANCIA[i.tipo], m = ES.mapa[i.mascota_id], dias = vetDiasEstancia(i.fecha_ingreso, new Date().toISOString());
  if (!confirm(`${t.verbo} a ${m?.nombre || 'la mascota'}?\n\n${dias} ${dias === 1 ? 'día' : 'días'} de ${t.n.toLowerCase()}${i.tarifa_producto_id ? ' — se agregará la tarifa a la cuenta.' : '.'}`)) return;
  try {
    const yaTiene = (ES.cargos[id] || []).some(c => c.automatico);
    if (i.tarifa_producto_id && !yaTiene) {         // la tarifa por dia se agrega UNA sola vez (la base lo garantiza con un indice unico)
      const { data: prod } = await sb.from('productos').select('nombre').eq('id', i.tarifa_producto_id).maybeSingle();
      const { error } = await sb.from('vet_cargos').insert({ auth_user_id: STATE.userId, estancia_id: id, producto_id: i.tarifa_producto_id, descripcion: `${prod?.nombre || t.n} × ${dias} ${dias === 1 ? 'día' : 'días'}`, cantidad: dias, automatico: true });
      if (error && error.code !== '23505') throw error;
    }
    await actualizarES(id, { estado: 'finalizada', fecha_salida: new Date().toISOString() });
    showToast(`${t.verbo}: ${dias} ${dias === 1 ? 'día' : 'días'} registrados.`); await cargarEstancias();
  } catch (e) { console.error('finalizarES:', e); showToast('No se pudo completar. Intenta de nuevo.', 'error'); }
}
async function cancelarES(id) {
  const i = ES.items.find(x => x.id === id); if (!i) return;
  if (!confirm(`¿Cancelar la estancia de ${ES.mapa[i.mascota_id]?.nombre || 'la mascota'}?`)) return;
  try { await actualizarES(id, { estado: 'cancelada' }); renderES(); } catch (e) { console.error('cancelarES:', e); showToast('No se pudo cancelar.', 'error'); }
}

/* ---------- Notas de evolucion (hospital) ---------- */
async function abrirNota(id) {
  ES.ctx = id; const i = ES.items.find(x => x.id === id);
  $e('nt-titulo').textContent = `📝 Evolución — ${ES.mapa[i.mascota_id]?.nombre || ''}`;
  ['nt-temp', 'nt-peso', 'nt-texto', 'nt-trat'].forEach(x => { $e(x).value = ''; }); $e('nt-error').textContent = '';
  $e('nt-lista').innerHTML = '<p class="vt-sub">Cargando…</p>'; openModal('modal-nota'); await recargarNotas();
}
async function recargarNotas() {
  const { data } = await sb.from('vet_estancia_notas').select('*').eq('auth_user_id', STATE.userId).eq('estancia_id', ES.ctx).order('fecha', { ascending: false });
  ES.notas[ES.ctx] = data || [];
  $e('nt-lista').innerHTML = ES.notas[ES.ctx].length ? ES.notas[ES.ctx].map(n => `<div class="vt-item"><div class="vt-item-cab"><div class="vt-item-fecha">${esc(fechaHoraES(n.fecha))}</div><div>${n.temperatura ? `<span class="vt-badge vt-badge-gris">${n.temperatura} °C</span> ` : ''}${n.peso ? `<span class="vt-badge vt-badge-gris">${n.peso} kg</span>` : ''}</div></div><p>${esc(n.nota)}</p>${n.tratamiento ? `<p><b>Tratamiento:</b> ${esc(n.tratamiento)}</p>` : ''}</div>`).join('') : '<p class="vt-sub">Todavía no hay notas.</p>';
}
function cerrarNota() { closeModal('modal-nota'); cargarEstancias(); }
async function guardarNota() {
  const err = $e('nt-error'); err.textContent = ''; const fallo = t => { err.textContent = t; };
  const texto = $e('nt-texto').value.trim(), tempRaw = $e('nt-temp').value.trim(), pesoRaw = $e('nt-peso').value.trim();
  if (!texto) return fallo('Escribe la nota de evolución.');
  if (tempRaw !== '' && !(Number(tempRaw) >= 30 && Number(tempRaw) <= 45)) return fallo('La temperatura debe estar entre 30 y 45 °C.');
  if (pesoRaw !== '' && !(Number(pesoRaw) > 0)) return fallo('El peso debe ser mayor que 0.');
  const btn = $e('nt-btn-guardar'); btn.disabled = true;
  try {
    const peso = pesoRaw === '' ? null : Number(pesoRaw);
    const { error } = await sb.from('vet_estancia_notas').insert({ auth_user_id: STATE.userId, estancia_id: ES.ctx, nota: texto, temperatura: tempRaw === '' ? null : Number(tempRaw), peso, tratamiento: $e('nt-trat').value.trim() || null });
    if (error) throw error;
    if (peso) { const i = ES.items.find(x => x.id === ES.ctx); if (i) await sb.from('vet_mascotas').update({ peso_actual: peso }).eq('id', i.mascota_id).eq('auth_user_id', STATE.userId); }
    ['nt-temp', 'nt-peso', 'nt-texto', 'nt-trat'].forEach(x => { $e(x).value = ''; }); showToast('Nota agregada.'); await recargarNotas();
  } catch (e) { console.error('guardarNota:', e); fallo('No se pudo guardar. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}

/* ---------- Cuenta y cobro ---------- */
function abrirCuenta(id) {
  ES.ctx = id; ES.prodCargo = null; const i = ES.items.find(x => x.id === id);
  $e('ct-titulo').textContent = `💳 Cuenta — ${ES.mapa[i.mascota_id]?.nombre || ''}`;
  $e('ct-buscar').value = ''; $e('ct-resultados').style.display = 'none'; $e('ct-elegido').style.display = 'none'; $e('ct-cantidad').value = '1'; $e('ct-error').textContent = '';
  renderCuenta(); openModal('modal-cta');
}
function cerrarCuenta() { closeModal('modal-cta'); renderES(); }
function renderCuenta() {
  const i = ES.items.find(x => x.id === ES.ctx), cargos = ES.cargos[ES.ctx] || [], bloqueada = cobrada(i);
  const total = cargos.reduce((s, c) => s + Number(c.cantidad) * Number(c.productos?.precio || 0), 0);
  $e('ct-lista').innerHTML = cargos.length ? cargos.map(c => `<div class="vt-item"><div class="vt-item-cab"><div><div class="vt-item-tit">${esc(vetFormatoNumero(c.cantidad))} × ${esc(c.descripcion)}</div><div class="vt-item-fecha">${c.productos?.precio ? esc(fmt(c.cantidad * c.productos.precio)) : ''}${c.automatico ? ' · tarifa por día (automática)' : ''}</div></div>${bloqueada ? '' : `<button class="btn-accion-tabla btn-ghost" onclick="eliminarCargoES('${c.id}')">🗑️</button>`}</div></div>`).join('') + `<p><b>Total estimado: ${esc(fmt(total))}</b> ${bloqueada ? `<span class="vt-cobrada">✅ Cobrada · ${esc(i.ventas.numero_venta)}</span>` : ''}</p>` : '<p class="vt-sub">La cuenta está vacía.</p>';
}
async function guardarCargoES() {
  const err = $e('ct-error'); err.textContent = ''; const cant = Number($e('ct-cantidad').value), i = ES.items.find(x => x.id === ES.ctx);
  if (cobrada(i)) { err.textContent = 'Esta cuenta ya fue cobrada.'; return; }
  if (!ES.prodCargo) { err.textContent = 'Elige el servicio o producto.'; return; }
  if (!(cant > 0)) { err.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  const btn = $e('ct-btn-guardar'); btn.disabled = true;
  try {
    const { data, error } = await sb.from('vet_cargos').insert({ auth_user_id: STATE.userId, estancia_id: ES.ctx, producto_id: ES.prodCargo.id, descripcion: ES.prodCargo.nombre, cantidad: cant }).select('*, productos(precio)').single();
    if (error) throw error;
    (ES.cargos[ES.ctx] = ES.cargos[ES.ctx] || []).push(data); ES.prodCargo = null; $e('ct-elegido').style.display = 'none'; $e('ct-cantidad').value = '1'; showToast('Agregado a la cuenta.'); renderCuenta();
  } catch (e) { console.error('guardarCargoES:', e); err.textContent = 'No se pudo agregar. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}
async function eliminarCargoES(cid) {
  try {
    const { error } = await sb.from('vet_cargos').delete().eq('id', cid).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    ES.cargos[ES.ctx] = (ES.cargos[ES.ctx] || []).filter(c => c.id !== cid); renderCuenta();
  } catch (e) { console.error('eliminarCargoES:', e); showToast('No se pudo quitar.', 'error'); }
}
function cobrarES(id) {
  const i = ES.items.find(x => x.id === id), m = ES.mapa[i?.mascota_id], cargos = (ES.cargos[id] || []).filter(c => c.producto_id);
  if (!m || !m.cliente_id) { showToast('Esta mascota no tiene dueño registrado: edítala en Mascotas y elige su dueño.', 'error'); return; }
  if (!cargos.length) { showToast('La cuenta está vacía.', 'error'); return; }
  sessionStorage.setItem('n360_vet_cobro', JSON.stringify({ estanciaId: id, clienteId: m.cliente_id, mascota: m.nombre, items: cargos.map(c => ({ producto_id: c.producto_id, cantidad: Number(c.cantidad) })) }));
  window.location.href = 'ventas.html';
}
