/* =====================================================
   CLINICA-HOSPITAL.JS — NEGOCIO360 · Módulo Clínica (Fase 5)
   Observación y hospitalización (modelo de las estancias de
   Veterinaria): ingreso, cama, médico, cuenta (servicio por
   día + medicamentos/insumos), alta y cobro por Ventas.
   Lo clínico (nota de ingreso, evolución, enfermería, signos,
   alta) solo se ve y se escribe con el código del médico:
   lo entrega el servidor y queda en la bitácora.
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
   ESTANCIAS
===================================================== */
const HO = { estancias: [], pacientes: [], medicos: [], servicios: [], filtro: 'activa', ing: { paciente: null }, cuentaId: null, cuenta: [], prodCargo: null, notasId: null, anularId: null };
const $h = id => document.getElementById(id);

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
    ClinicaSesion.iniciar(user.id, {});
    await ClinicaSesion.comprobar();
    const [meds, sv] = await Promise.all([
      ClinicaCitas.medicos(),
      sb.from('productos').select('id, nombre, precio, tipo').eq('auth_user_id', STATE.userId).eq('tipo', 'servicio').eq('activo', true).order('nombre'),
    ]);
    HO.medicos = meds.filter(m => m.activo && m.rol !== 'enfermeria'); HO.servicios = sv.data || [];
    await cargar();
    await ingresoDesdeURL();
  } catch (e) {
    console.error('init clinica-hospital:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

const medicoNombre = id => HO.medicos.find(m => m.id === id)?.nombre || '';
const servicioDe = id => HO.servicios.find(x => x.id === id) || null;
async function cargar() {
  try {
    const { data, error } = await sb.from('clinica_estancias')
      .select('*, clinica_pacientes(id, nombres, apellidos, numero_expediente, telefono, cliente_id, convenio_id, poliza_vence), ventas(estado, numero_venta)')
      .eq('auth_user_id', STATE.userId).order('ingreso_en', { ascending: false }).limit(300);
    if (error) throw error;
    HO.estancias = data || [];
    const ids = HO.estancias.map(e => e.id);
    HO.cargosPor = {};
    if (ids.length) {
      const { data: cg } = await sb.from('clinica_estancia_cargos').select('estancia_id, producto_id, cantidad, descripcion, productos(precio)').eq('auth_user_id', STATE.userId).in('estancia_id', ids);
      (cg || []).forEach(x => { (HO.cargosPor[x.estancia_id] = HO.cargosPor[x.estancia_id] || []).push(x); });
    }
    render();
  } catch (e) { console.error('cargar estancias:', e); $h('ho-lista').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudieron cargar las estancias.</p>'; }
}
function cobrada(e) { return !!e.venta_id && e.ventas && e.ventas.estado !== 'anulada'; }
function totalEstimado(e) {
  const c = clinicaCobroEstancia(e, servicioDe(e.servicio_id), HO.cargosPor[e.id] || []);
  return { ...c, total: c.items.reduce((t, x) => t + x.total, 0) };
}
function filtrar(f) { HO.filtro = f; document.querySelectorAll('#ho-chips .cl-tab').forEach(b => b.classList.toggle('activa', b.dataset.f === f)); render(); }
function render() {
  const act = HO.estancias.filter(e => e.estado === 'activa'), hoy = vetHoy();
  $h('ho-kpi-act').textContent = act.length;
  $h('ho-kpi-obs').textContent = act.filter(e => e.tipo === 'observacion').length;
  $h('ho-kpi-hos').textContent = act.filter(e => e.tipo === 'hospitalizacion').length;
  $h('ho-kpi-alta').textContent = HO.estancias.filter(e => e.estado === 'alta' && String(e.alta_en || '').slice(0, 10) === hoy).length;
  const lista = HO.estancias.filter(e => e.estado === HO.filtro);
  $h('ho-lista').innerHTML = lista.length ? lista.map(e => {
    const t = CLINICA_TIPOS_ESTANCIA[e.tipo], p = e.clinica_pacientes || {}, est = totalEstimado(e), sv = servicioDe(e.servicio_id);
    const btns = [];
    btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirNotas('${e.id}')">📝 Notas y signos</button>`);
    if (e.estado !== 'anulada' && !cobrada(e)) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirCuenta('${e.id}')">💊 Cuenta</button>`);
    if (e.estado === 'activa') btns.push(`<button class="btn-accion-tabla btn-primary" onclick="darAlta('${e.id}')">🏁 Dar de alta</button>`);
    if (e.estado === 'alta' && !cobrada(e)) btns.push(`<button class="btn-accion-tabla btn-primary" onclick="cobrar('${e.id}')">💳 Cobrar</button>`);
    if (e.estado === 'activa' || (e.estado === 'alta' && !cobrada(e))) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirAnular('${e.id}')">🚫 Anular</button>`);
    return `<div class="ag-card est-${e.estado === 'activa' ? 'en_consulta' : 'atendida'}">
      <div class="ag-fila"><span class="ag-hora">${esc(t.e)} ${esc(e.numero || '')}</span>
        ${e.estado === 'anulada' ? '<span class="cl-badge cl-badge-rojo">Anulada</span>' : cobrada(e) ? `<span class="cl-badge cl-badge-verde">Cobrada · ${esc(e.ventas.numero_venta || '')}</span>` : e.estado === 'alta' ? '<span class="cl-badge cl-badge-ambar">Alta · falta cobrar</span>' : `<span class="cl-badge cl-badge-morado">${esc(t.n)}</span>`}</div>
      <div class="cl-nombre">${esc(clinicaNombrePaciente(p))}</div>
      <div class="cl-sub">${esc(p.numero_expediente || '')}${e.cama ? ' · 🛏️ ' + esc(e.cama) : ''}${e.medico_id ? ' · 👨‍⚕️ ' + esc(medicoNombre(e.medico_id)) : ''}</div>
      <div class="cl-sub">Ingreso ${esc(new Date(e.ingreso_en).toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }))} · ${esc(clinicaDuracionTexto(e.ingreso_en, e.alta_en))}</div>
      ${e.estado !== 'anulada' ? `<div class="cl-sub">${sv ? `${esc(sv.nombre)} × ${est.unidades}` : 'Sin servicio por día'}${(HO.cargosPor[e.id] || []).length ? ` · ${(HO.cargosPor[e.id] || []).length} cargo(s)` : ''} · <b>${esc(fmt(est.total))}</b></div>` : `<div class="cl-sub">🚫 ${esc(e.motivo_anulacion || '')}</div>`}
      <div class="ag-btns">${btns.join('')}</div></div>`;
  }).join('') : `<div class="cl-info" style="grid-column:1/-1">${HO.filtro === 'activa' ? 'Nadie en observación ni hospitalizado. Usa "+ Ingreso".' : 'No hay estancias aquí.'}</div>`;
}

/* ---------- Ingreso ---------- */
function abrirIngreso() {
  HO.ing = { paciente: null };
  $h('in-buscar').value = ''; $h('in-resultados').style.display = 'none'; $h('in-elegido').style.display = 'none'; $h('in-buscar-wrap').style.display = '';
  $h('in-tipo').value = 'observacion'; $h('in-cama').value = ''; $h('in-nota').value = ''; $h('in-error').textContent = '';
  $h('in-medico').innerHTML = '<option value="">— Sin médico —</option>' + HO.medicos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
  $h('in-servicio').innerHTML = '<option value="">— Ninguno (cobrar solo lo de la cuenta) —</option>' + HO.servicios.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)} · ${esc(fmt(x.precio || 0))}</option>`).join('');
  alCambiarTipo();
  openModal('modal-ingreso'); setTimeout(() => $h('in-buscar').focus(), 50);
}
// Desde la Sala ("🛏️ Dejar en observación"): el ingreso se abre con el paciente y su médico ya elegidos.
async function ingresoDesdeURL() {
  const q = new URLSearchParams(location.search), id = q.get('ingreso'); if (!id) return;
  try {
    const { data: p } = await sb.from('clinica_pacientes').select('id, nombres, apellidos, numero_expediente, telefono').eq('auth_user_id', STATE.userId).eq('id', id).maybeSingle();
    if (!p) return;
    if (HO.estancias.some(e => e.estado === 'activa' && e.paciente_id === p.id)) { showToast(`${clinicaNombrePaciente(p)} ya está en observación u hospitalizado.`, 'error'); return; }
    abrirIngreso(); elegirPaciente(p);
    const m = q.get('medico'); if (m && HO.medicos.some(x => x.id === m)) $h('in-medico').value = m;
    setTimeout(() => $h('in-cama').focus(), 60);
  } catch (e) { console.warn('ingreso desde la Sala:', e); }
}
function alCambiarTipo() { $h('in-servicio-ayuda').textContent = $h('in-tipo').value === 'hospitalizacion' ? 'Se cobra por día (cada 24 horas o fracción).' : 'Se cobra una vez por la observación.'; }
let _tP = null;
function buscarPaciente(q) {
  clearTimeout(_tP);
  const cont = $h('in-resultados'); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _tP = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('clinica_pacientes').select('id, nombres, apellidos, numero_expediente, telefono')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .or(`nombres.ilike.%${q}%,apellidos.ilike.%${q}%,cedula.ilike.%${q}%,numero_expediente.ilike.%${q}%`).order('nombres').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length) ? data.map(p => `<div class="cl-resultado" tabindex="0" data-id="${esc(p.id)}">${esc(clinicaNombrePaciente(p))} <span class="cl-sub">· ${esc(p.numero_expediente || '')}</span></div>`).join('')
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados. Regístralo primero en Pacientes.</div>';
      cont.querySelectorAll('[data-id]').forEach(el => { const f = () => elegirPaciente(data.find(x => x.id === el.dataset.id)); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
      cont.style.display = '';
    } catch (e) { console.error('buscarPaciente:', e); }
  }, 250);
}
function elegirPaciente(p) {
  HO.ing.paciente = p;
  $h('in-resultados').style.display = 'none'; $h('in-buscar-wrap').style.display = 'none';
  const el = $h('in-elegido'); el.innerHTML = `<span>✔ ${esc(clinicaNombrePaciente(p))} · ${esc(p.numero_expediente || '')}</span> <button type="button" class="cl-link" onclick="quitarPaciente()">cambiar</button>`; el.style.display = '';
}
function quitarPaciente() { HO.ing.paciente = null; $h('in-elegido').style.display = 'none'; $h('in-buscar-wrap').style.display = ''; $h('in-buscar').focus(); }
async function guardarIngreso() {
  const err = $h('in-error'); err.textContent = '';
  if (!HO.ing.paciente) { err.textContent = 'Busca y elige al paciente.'; return; }
  const nota = $h('in-nota').value.trim();
  const btn = $h('in-btn'); btn.disabled = true;
  try {
    const { data, error } = await sb.from('clinica_estancias').insert({ auth_user_id: STATE.userId, paciente_id: HO.ing.paciente.id, tipo: $h('in-tipo').value,
      cama: $h('in-cama').value.trim().slice(0, 40) || null, medico_id: $h('in-medico').value || null, servicio_id: $h('in-servicio').value || null }).select('id, numero').single();
    if (error) throw error;
    closeModal('modal-ingreso');
    showToast(`Ingreso ${data.numero} registrado.`);
    if (nota) {     // la nota de ingreso es clínica: se guarda con el código del médico
      try { const r = await ClinicaSesion.rpc('clinica_estancia_nota_agregar', { p_estancia_id: data.id, p_datos: { tipo: 'ingreso', texto: nota } });
        if (!r || !r.ok) showToast(clinicaTextoMotivo(r), 'error'); }
      catch (e) { if (!e.cancelado) console.error('nota de ingreso:', e); else showToast('El ingreso quedó registrado; la nota de ingreso no se guardó (falta el código del médico).', 'error'); }
    }
    await cargar();
  } catch (e) {
    console.error('guardarIngreso:', e);
    err.textContent = /una_activa|duplicate/i.test(e?.message || '') ? 'Ese paciente ya está en observación u hospitalizado.' : clinicaTextoError(e, 'No se pudo registrar el ingreso.');
  } finally { btn.disabled = false; }
}

/* ---------- Notas clínicas y signos (con el código del médico) ---------- */
const SIGNOS_EST = ['pa_sistolica', 'pa_diastolica', 'fc', 'fr', 'temperatura', 'spo2', 'glucosa_mg_dl'];
async function abrirNotas(id) {
  HO.notasId = id;
  const e = HO.estancias.find(x => x.id === id); if (!e) return;
  $h('no-titulo').textContent = `📝 ${e.numero} · ${clinicaNombrePaciente(e.clinica_pacientes || {})}`;
  $h('no-form').style.display = e.estado === 'activa' ? '' : 'none';
  SIGNOS_EST.forEach(k => { $h('no-' + k).value = ''; }); $h('no-texto').value = ''; $h('no-tipo').value = 'evolucion'; $h('no-error').textContent = '';
  $h('no-lista').innerHTML = '<p class="cl-sub">Cargando…</p>'; $h('no-alergias').innerHTML = '';
  openModal('modal-notas');
  await pintarNotas();
}
async function pintarNotas() {
  try {
    const r = await ClinicaSesion.rpc('clinica_estancia_notas', { p_estancia_id: HO.notasId });
    if (!r || !r.ok) { $h('no-lista').innerHTML = `<p style="color:var(--danger,#dc2626)">${esc(clinicaTextoMotivo(r))}</p>`; return; }
    // Enfermería solo escribe notas de enfermería (el servidor también lo exige); se le muestran las alergias.
    const esEnf = r.rol === 'enfermeria';
    [...$h('no-tipo').options].forEach(o => { o.disabled = esEnf && o.value !== 'enfermeria'; o.hidden = esEnf && o.value !== 'enfermeria'; });
    if (esEnf) $h('no-tipo').value = 'enfermeria';
    $h('no-alergias').innerHTML = r.alergias ? `<div class="cl-alerta" style="margin:0 0 10px">⚠️ ALERGIAS: ${esc(r.alergias)}</div>` : '';
    const notas = (r.notas || []).slice().reverse();
    $h('no-lista').innerHTML = notas.length ? notas.map(n => {
      const sg = [n.pa_sistolica && n.pa_diastolica && `PA ${n.pa_sistolica}/${n.pa_diastolica}`, n.fc && `FC ${n.fc}`, n.fr && `FR ${n.fr}`, n.temperatura && `T ${n.temperatura} °C`,
        n.spo2 && `SpO₂ ${n.spo2}%`, n.glucosa_mg_dl && `Glucosa ${n.glucosa_mg_dl}`].filter(Boolean);
      return `<div class="cl-item"><div class="cl-item-cab"><div class="cl-item-tit">${esc(CLINICA_TIPOS_NOTA_ESTANCIA[n.tipo] || n.tipo)}</div>
        <div class="cl-item-fecha">${esc(new Date(n.created_at).toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }))} · ${esc(n.autor_nombre)}</div></div>
        ${sg.length ? `<p class="cl-sub" style="margin:2px 0"><b>${esc(sg.join(' · '))}</b></p>` : ''}<p style="white-space:pre-wrap;margin:4px 0 0">${esc(n.texto)}</p></div>`;
    }).join('') : '<p class="cl-sub">Todavía no hay notas.</p>';
  } catch (e) {
    if (e.cancelado) { closeModal('modal-notas'); return; }
    console.error('pintarNotas:', e); $h('no-lista').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudieron cargar las notas.</p>';
  }
}
async function guardarNotaEstancia() {
  const err = $h('no-error'); err.textContent = '';
  const d = { tipo: $h('no-tipo').value, texto: $h('no-texto').value.trim() };
  if (!d.texto) { err.textContent = 'Escribe la nota.'; return; }
  const vs = {}; SIGNOS_EST.forEach(k => { vs[k] = $h('no-' + k).value; });
  const e = clinicaValidarSignos(vs); if (e) { err.textContent = e; return; }
  SIGNOS_EST.forEach(k => { const n = clinicaNumero(vs[k]); if (n != null) d[k] = String(n); });
  const btn = $h('no-btn'); btn.disabled = true;
  try {
    const r = await ClinicaSesion.rpc('clinica_estancia_nota_agregar', { p_estancia_id: HO.notasId, p_datos: d });
    if (!r || !r.ok) { err.textContent = clinicaTextoMotivo(r); return; }
    SIGNOS_EST.forEach(k => { $h('no-' + k).value = ''; }); $h('no-texto').value = '';
    showToast('Nota guardada.'); await pintarNotas();
  } catch (x) { if (!x.cancelado) { console.error('guardarNotaEstancia:', x); err.textContent = 'No se pudo guardar.'; } }
  finally { btn.disabled = false; }
}

/* ---------- Cuenta de la estancia ---------- */
async function abrirCuenta(id) {
  HO.cuentaId = id; HO.prodCargo = null;
  const e = HO.estancias.find(x => x.id === id); if (!e) return;
  $h('cu-titulo').textContent = `💊 Cuenta · ${e.numero}`;
  $h('cu-buscar').value = ''; $h('cu-resultados').style.display = 'none'; $h('cu-elegido').style.display = 'none'; $h('cu-cantidad').value = '1'; $h('cu-error').textContent = '';
  openModal('modal-cuenta'); await pintarCuenta();
}
async function pintarCuenta() {
  const e = HO.estancias.find(x => x.id === HO.cuentaId);
  try {
    const { data, error } = await sb.from('clinica_estancia_cargos').select('id, producto_id, descripcion, cantidad, productos(precio)').eq('auth_user_id', STATE.userId).eq('estancia_id', HO.cuentaId).order('created_at');
    if (error) throw error;
    HO.cuenta = data || []; HO.cargosPor[HO.cuentaId] = HO.cuenta;
    const sv = servicioDe(e.servicio_id), est = totalEstimado(e);
    $h('cu-lista').innerHTML = `<table class="cl-tabla-cuenta">
      ${sv ? `<tr><td>${est.unidades} ×</td><td>${esc(sv.nombre)} <span class="cl-sub">(${e.tipo === 'hospitalizacion' ? 'por día' : 'observación'})</span></td><td style="text-align:right;white-space:nowrap">${esc(fmt(est.unidades * Number(sv.precio || 0)))}</td><td></td></tr>` : ''}
      ${HO.cuenta.map(x => `<tr><td>${esc(vetFormatoNumero(x.cantidad))} ×</td><td>${esc(x.descripcion)}</td><td style="text-align:right;white-space:nowrap">${x.productos ? esc(fmt(Number(x.cantidad) * Number(x.productos.precio || 0))) : '—'}</td>
        <td style="text-align:right"><button class="cl-link" onclick="quitarCargo('${x.id}')">quitar</button></td></tr>`).join('')}</table>
      <div class="cl-total">Total estimado: ${esc(fmt(est.total))}</div>${e.estado === 'activa' && e.tipo === 'hospitalizacion' ? '<p class="cl-sub" style="text-align:right;margin:2px 0 0">Los días se cuentan hasta el alta.</p>' : ''}`;
    render();
  } catch (x) { console.error('pintarCuenta:', x); $h('cu-lista').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la cuenta.</p>'; }
}
function elegirProducto(id, nombre) {
  HO.prodCargo = { id, nombre };
  $h('cu-resultados').style.display = 'none'; $h('cu-buscar').value = '';
  const el = $h('cu-elegido'); el.innerHTML = `<span>✔ ${esc(nombre)}</span>`; el.style.display = '';
}
let _tProd = null;
function buscarProducto(q) {
  clearTimeout(_tProd);
  const cont = $h('cu-resultados'); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _tProd = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('productos').select('id, nombre, precio, tipo').eq('auth_user_id', STATE.userId).eq('activo', true)
        .or('es_sustancia_controlada.is.null,es_sustancia_controlada.eq.false').ilike('nombre', `%${q}%`).order('nombre').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length) ? data.map(p => `<div class="cl-resultado" tabindex="0" data-id="${esc(p.id)}" data-n="${esc(p.nombre)}">${p.tipo === 'servicio' ? '🛎️' : '📦'} ${esc(p.nombre)} <span class="cl-sub">· ${esc(fmt(p.precio || 0))}</span></div>`).join('')
        : '<div class="cl-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados.</div>';
      cont.querySelectorAll('[data-id]').forEach(el => { const f = () => elegirProducto(el.dataset.id, el.dataset.n); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
      cont.style.display = '';
    } catch (e) { console.error('buscarProducto:', e); }
  }, 250);
}
async function agregarCargo() {
  const err = $h('cu-error'); err.textContent = '';
  const cant = Number($h('cu-cantidad').value);
  if (!HO.prodCargo) { err.textContent = 'Busca y elige el medicamento, insumo o servicio.'; return; }
  if (!(cant > 0) || cant > 100000) { err.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  const btn = $h('cu-btn'); btn.disabled = true;
  try {
    const { error } = await sb.from('clinica_estancia_cargos').insert({ auth_user_id: STATE.userId, estancia_id: HO.cuentaId, producto_id: HO.prodCargo.id, descripcion: HO.prodCargo.nombre.slice(0, 200), cantidad: cant });
    if (error) throw error;
    HO.prodCargo = null; $h('cu-elegido').style.display = 'none'; $h('cu-cantidad').value = '1';
    await pintarCuenta();
  } catch (e) { console.error('agregarCargo:', e); err.textContent = clinicaTextoError(e, 'No se pudo agregar.'); }
  finally { btn.disabled = false; }
}
async function quitarCargo(id) {
  try { const { error } = await sb.from('clinica_estancia_cargos').delete().eq('id', id).eq('auth_user_id', STATE.userId); if (error) throw error; await pintarCuenta(); }
  catch (e) { console.error('quitarCargo:', e); showToast(clinicaTextoError(e, 'No se pudo quitar.'), 'error'); }
}

/* ---------- Alta, anulación y cobro ---------- */
async function darAlta(id) {
  const e = HO.estancias.find(x => x.id === id); if (!e) return;
  if (!confirm(`¿Dar de alta a ${clinicaNombrePaciente(e.clinica_pacientes || {})}?\n\nDespués ya no se agregan notas y se cobra la estancia. Escribe antes la nota de alta en "Notas y signos".`)) return;
  try {
    const { error } = await sb.from('clinica_estancias').update({ estado: 'alta' }).eq('id', id).eq('auth_user_id', STATE.userId).eq('estado', 'activa');
    if (error) throw error;
    showToast('Alta registrada. Ya puedes cobrar la estancia.'); HO.filtro = 'alta'; filtrar('alta'); await cargar();
  } catch (x) { console.error('darAlta:', x); showToast(clinicaTextoError(x, 'No se pudo dar de alta.'), 'error'); }
}
function abrirAnular(id) { HO.anularId = id; $h('an-motivo').value = ''; $h('an-error').textContent = ''; openModal('modal-anular'); setTimeout(() => $h('an-motivo').focus(), 50); }
async function confirmarAnular() {
  const m = $h('an-motivo').value.trim();
  if (m.length < 5) { $h('an-error').textContent = 'Escribe el motivo (al menos 5 letras).'; return; }
  try {
    const { error } = await sb.from('clinica_estancias').update({ estado: 'anulada', motivo_anulacion: m.slice(0, 300) }).eq('id', HO.anularId).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    closeModal('modal-anular'); showToast('Estancia anulada.'); await cargar();
  } catch (x) { console.error('anular:', x); $h('an-error').textContent = clinicaTextoError(x, 'No se pudo anular.'); }
}
// Cobrar: Ventas abre la venta con el paciente (como cliente), los días y la cuenta. Al confirmar, la estancia queda cobrada.
async function cobrar(id) {
  const e = HO.estancias.find(x => x.id === id); if (!e) return;
  try {
    const { data: actual } = await sb.from('clinica_estancias').select('estado, venta_id, ventas(estado, numero_venta)').eq('id', id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (!actual || actual.estado !== 'alta') { showToast('Primero da de alta la estancia.', 'error'); return; }
    if (actual.venta_id && actual.ventas && actual.ventas.estado !== 'anulada') { showToast(`Esta estancia ya se cobró (${actual.ventas.numero_venta}).`, 'error'); await cargar(); return; }
    const { data: cg } = await sb.from('clinica_estancia_cargos').select('producto_id, descripcion, cantidad, productos(precio)').eq('auth_user_id', STATE.userId).eq('estancia_id', id);
    const c = clinicaCobroEstancia(e, servicioDe(e.servicio_id), cg || []);
    if (!c.items.length) { showToast('La cuenta está vacía: elige el servicio por día o agrega cargos.', 'error'); return; }
    // El paciente se cobra como cliente: si todavía no está en Clientes, se crea y se liga.
    const p = e.clinica_pacientes || {};
    let clienteId = p.cliente_id || null;
    if (!clienteId) {
      const { data: nuevo, error } = await sb.from('clientes').insert({ auth_user_id: STATE.userId, nombre: p.nombres || 'Paciente', apellido: p.apellidos || null, telefono: p.telefono || null }).select('id').single();
      if (error) throw error;
      clienteId = nuevo.id;
      await sb.from('clinica_pacientes').update({ cliente_id: clienteId }).eq('id', p.id).eq('auth_user_id', STATE.userId);
    }
    // Seguro del paciente (si tiene uno vigente): el paciente paga su parte y lo cubierto queda anotado en la
    // estancia para facturárselo a la aseguradora en Seguros (igual que en las citas). Se puede quitar al cobrar.
    let conv = null;
    if (p.convenio_id) {
      const { data: k } = await sb.from('clinica_convenios').select('id, nombre, cobertura_pct, activo').eq('auth_user_id', STATE.userId).eq('id', p.convenio_id).maybeSingle();
      if (clinicaConvenioVigente(p, k)) conv = k;
    }
    let tipos = null;
    const preparar = async k => {
      let items = c.items.map(x => ({ ...x }));
      if (k) {
        if (!tipos) {
          const { data: prods } = await sb.from('productos').select('id, tipo').eq('auth_user_id', STATE.userId).in('id', items.map(x => x.producto_id));
          tipos = {}; (prods || []).forEach(x => { tipos[x.id] = x.tipo; });
        }
        const rep = clinicaAplicarConvenio(items, k.cobertura_pct, tipos);
        items = rep.paciente;
        const { error: eS } = await sb.from('clinica_estancias').update({ convenio_id: k.id, cobertura_pct: Number(k.cobertura_pct), monto_cubierto: rep.cubierto, cubierto_servicios: rep.cubiertoServicios }).eq('id', id).eq('auth_user_id', STATE.userId);
        if (eS) throw eS;
      } else {
        const { error: eS } = await sb.from('clinica_estancias').update({ convenio_id: null, cobertura_pct: null, monto_cubierto: null, cubierto_servicios: null }).eq('id', id).eq('auth_user_id', STATE.userId);
        if (eS) throw eS;
      }
      sessionStorage.setItem('n360_clinica_cobro', JSON.stringify({ tipo: 'estancia', id, clienteId, cliente: clinicaNombrePaciente(p), items }));
    };
    await preparar(conv);
    // Se cobra en la pantalla de cobro de la Clínica.
    if (typeof clinicaAbrirCobro === 'function' && clinicaAbrirCobro({ titulo: `Cobrar estancia · ${clinicaNombrePaciente(p)}`,
      seguro: conv ? { nombre: conv.nombre, pct: Number(conv.cobertura_pct), aplicado: true, cambiar: aplicar => preparar(aplicar ? conv : null) } : null,
      alTerminar: ventaId => clinicaLigarVenta('clinica_estancias', id, ventaId),
      alCerrar: async cobrado => { if (cobrado) showToast('✅ Estancia cobrada y registrada en Ventas.'); await cargar(); } })) return;
    window.location.href = 'ventas.html';
  } catch (x) { console.error('cobrar estancia:', x); showToast('No se pudo preparar el cobro. Intenta de nuevo.', 'error'); }
}
