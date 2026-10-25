/* =====================================================
   CLINICA-SEGUROS.JS — NEGOCIO360 · Módulo Clínica (Fase 5)
   Seguros y convenios: aseguradoras/empresas con su % de
   cobertura (cada una ligada a un cliente), lo que falta
   facturarles (la parte que cubrieron de cada cita cobrada
   con seguro) y las facturas a la aseguradora, que se hacen
   por Ventas como cualquier venta (normalmente a crédito:
   el cobro sigue en Créditos, con su Caja y contabilidad).
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
   SEGUROS Y CONVENIOS
===================================================== */
const SG = { convenios: [], citas: [], reclamos: [], editId: null, sel: {} };
const $g = id => document.getElementById(id);
const TIPOS_CONV = { aseguradora: '🛡️ Aseguradora', empresa: '🏢 Empresa', otro: '🤝 Otro' };

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
    const hoy = vetHoy(); $g('sg-desde').value = hoy.slice(0, 8) + '01'; $g('sg-hasta').value = hoy;
    await cargar();
    cambiarTab('pendiente');
  } catch (e) {
    console.error('init clinica-seguros:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

function cambiarTab(t) {
  ['pendiente', 'facturas', 'convenios'].forEach(k => { $g('sg-tab-' + k).classList.toggle('activa', k === t); $g('sg-panel-' + k).style.display = k === t ? '' : 'none'; });
}
const convenio = id => SG.convenios.find(k => k.id === id);
async function cargar() {
  const desde = $g('sg-desde').value, hasta = $g('sg-hasta').value;
  if (!desde || !hasta || desde > hasta) { showToast('Revisa las fechas.', 'error'); return; }
  try {
    const [k, r, cc] = await Promise.all([
      sb.from('clinica_convenios').select('*').eq('auth_user_id', STATE.userId).order('activo', { ascending: false }).order('nombre'),
      sb.from('clinica_reclamos').select('*, ventas(numero_venta, estado)').eq('auth_user_id', STATE.userId).order('created_at', { ascending: false }).limit(500),
      ClinicaCitas.cargar(desde, hasta),
    ]);
    SG.convenios = k.data || []; SG.reclamos = r.data || []; SG.citas = cc.citas;
    // Estancias (observación / hospitalización) cobradas con seguro en estas fechas: también se facturan aquí.
    const { data: est } = await sb.from('clinica_estancias').select('id, numero, alta_en, convenio_id, cobertura_pct, monto_cubierto, venta_id, clinica_pacientes(nombres, apellidos)')
      .eq('auth_user_id', STATE.userId).not('convenio_id', 'is', null).gt('monto_cubierto', 0).not('venta_id', 'is', null)
      .gte('alta_en', desde + 'T00:00:00').lte('alta_en', hasta + 'T23:59:59');
    SG.citas = SG.citas.concat((est || []).map(e => ({ id: e.id, tipo: 'estancia', fecha: String(e.alta_en).slice(0, 10), convenio_id: e.convenio_id,
      cobertura_pct: Number(e.cobertura_pct), monto_cubierto: Number(e.monto_cubierto), venta_id: e.venta_id, clinica_pacientes: e.clinica_pacientes, motivo: `Estancia ${e.numero || ''}`.trim() })));
    // Solo cuentan las citas cuya venta (la parte del paciente) sigue completada.
    const vIds = [...new Set(SG.citas.filter(c => c.venta_id && c.monto_cubierto > 0).map(c => c.venta_id))];
    const vivas = new Set();
    for (let i = 0; i < vIds.length; i += 150) {
      const { data: vs } = await sb.from('ventas').select('id, estado').eq('auth_user_id', STATE.userId).in('id', vIds.slice(i, i + 150));
      (vs || []).filter(v => v.estado === 'completada').forEach(v => vivas.add(v.id));
    }
    SG.citas = SG.citas.filter(c => !c.venta_id || vivas.has(c.venta_id));
    render();
  } catch (e) { console.error('cargar seguros:', e); showToast('No se pudo cargar.', 'error'); }
}
function render() {
  const grupos = clinicaPendientesSeguro(SG.citas, SG.reclamos);
  const totalPend = grupos.reduce((t, g) => t + g.monto, 0);
  $g('sg-kpi-pend').textContent = fmt(totalPend);
  $g('sg-kpi-env').textContent = SG.reclamos.filter(r => r.estado === 'enviado').length;
  $g('sg-kpi-conv').textContent = SG.convenios.filter(k => k.activo).length;
  // Por facturar
  $g('sg-pendiente').innerHTML = grupos.length ? grupos.map(g => {
    const k = convenio(g.convenio_id) || { nombre: 'Convenio', cobertura_pct: 0 };
    SG.sel[g.convenio_id] = SG.sel[g.convenio_id] || new Set(g.citas.map(c => c.id));
    const elegidas = g.citas.filter(c => SG.sel[g.convenio_id].has(c.id)), monto = elegidas.reduce((t, c) => t + c.monto_cubierto, 0);
    return `<div class="cl-item"><div class="cl-item-cab"><div class="cl-item-tit">🛡️ ${esc(k.nombre)}</div><div class="cl-item-tit">${esc(fmt(g.monto))}</div></div>
      ${g.citas.map(c => `<label class="cl-check" style="margin:4px 0"><input type="checkbox" ${SG.sel[g.convenio_id].has(c.id) ? 'checked' : ''} onchange="alternarCita('${g.convenio_id}','${c.id}')"/>
        ${esc(vetFechaLarga(c.fecha))} · ${esc(clinicaNombrePaciente(c.clinica_pacientes || {}))} · ${esc(c.motivo || '')} — <b>${esc(fmt(c.monto_cubierto))}</b> <span class="cl-sub">(${esc(Number(c.cobertura_pct))}%)</span></label>`).join('')}
      <div class="cl-acciones">${k.cliente_id ? '' : '<span class="cl-badge cl-badge-ambar">Se creará como cliente al facturar</span>'}
        <button class="btn-accion-tabla btn-primary" ${elegidas.length ? '' : 'disabled'} onclick="facturar('${g.convenio_id}')">🧾 Facturar ${esc(fmt(monto))} (${elegidas.length} concepto${elegidas.length === 1 ? '' : 's'})</button></div></div>`;
  }).join('') : '<div class="cl-info">No hay nada pendiente de facturar a aseguradoras en estas fechas.</div>';
  // Facturas
  const est = { enviado: ['Falta confirmar en Ventas', 'ambar'], facturado: ['Facturado', 'verde'], anulado: ['Anulado', 'rojo'] };
  $g('sg-facturas').innerHTML = SG.reclamos.length ? SG.reclamos.map(r => `<div class="cl-item"><div class="cl-item-cab"><div>
      <div class="cl-item-tit">${esc(convenio(r.convenio_id)?.nombre || '')} · ${esc(fmt(r.monto))}</div>
      <div class="cl-item-fecha">${esc(new Date(r.created_at).toLocaleDateString('es-NI'))} · ${(r.citas || []).length} concepto(s)${r.ventas ? ' · ' + esc(r.ventas.numero_venta || '') : ''}</div></div>
      <span class="cl-badge cl-badge-${est[r.estado][1]}">${est[r.estado][0]}</span></div>
      ${r.estado === 'enviado' ? `<div class="cl-acciones"><button class="btn-accion-tabla btn-ghost" onclick="irAVentas('${r.id}')">🧾 Abrir en Ventas</button><button class="btn-accion-tabla btn-ghost" onclick="anularReclamo('${r.id}')">🚫 Anular</button></div>` : ''}</div>`).join('')
    : '<p class="cl-sub">Todavía no hay facturas a aseguradoras.</p>';
  // Convenios
  $g('sg-convenios').innerHTML = SG.convenios.length ? SG.convenios.map(k => `<div class="cl-card" tabindex="0" role="button" onclick="abrirConvenio('${k.id}')" onkeydown="if(event.key==='Enter')abrirConvenio('${k.id}')" style="${k.activo ? '' : 'opacity:.6'}">
      <div class="cl-nombre">${esc(k.nombre)}</div><div><span class="cl-badge cl-badge-azul">${esc(TIPOS_CONV[k.tipo] || k.tipo)}</span> <span class="cl-badge cl-badge-verde">Cubre ${esc(Number(k.cobertura_pct))}%</span>${k.activo ? '' : ' <span class="cl-badge cl-badge-gris">Inactivo</span>'}</div>
      ${k.telefono ? `<div class="cl-sub">📞 ${esc(k.telefono)}</div>` : ''}</div>`).join('')
    : '<div class="cl-info" style="grid-column:1/-1">Sin convenios. Agrega las aseguradoras o empresas con las que trabajas.</div>';
}
function alternarCita(conv, cita) { const s = SG.sel[conv]; s.has(cita) ? s.delete(cita) : s.add(cita); render(); }

/* ---------- Convenios ---------- */
function abrirConvenio(id) {
  const k = id ? convenio(id) : null;
  SG.editId = k ? k.id : null;
  $g('kv-titulo').textContent = k ? '✏️ Editar convenio' : '🛡️ Nuevo convenio';
  $g('kv-nombre').value = k?.nombre || ''; $g('kv-tipo').value = k?.tipo || 'aseguradora'; $g('kv-pct').value = k ? Number(k.cobertura_pct) : '';
  $g('kv-telefono').value = k?.telefono || ''; $g('kv-notas').value = k?.notas || ''; $g('kv-activo').checked = k ? !!k.activo : true;
  $g('kv-activo-wrap').style.display = k ? '' : 'none'; $g('kv-error').textContent = '';
  openModal('modal-convenio'); setTimeout(() => $g('kv-nombre').focus(), 50);
}
async function guardarConvenio() {
  const err = $g('kv-error'); err.textContent = '';
  const nombre = $g('kv-nombre').value.trim(), pct = Number($g('kv-pct').value);
  if (!nombre) { err.textContent = 'Escribe el nombre.'; return; }
  if (!(pct >= 0 && pct <= 100) || $g('kv-pct').value === '') { err.textContent = 'La cobertura va de 0 a 100 %.'; return; }
  const datos = { nombre: nombre.slice(0, 120), tipo: $g('kv-tipo').value, cobertura_pct: Math.round(pct * 100) / 100, telefono: $g('kv-telefono').value.trim().slice(0, 30) || null,
    notas: $g('kv-notas').value.trim().slice(0, 500) || null, activo: SG.editId ? $g('kv-activo').checked : true, updated_at: new Date().toISOString() };
  try {
    const q = SG.editId ? sb.from('clinica_convenios').update(datos).eq('id', SG.editId).eq('auth_user_id', STATE.userId)
      : sb.from('clinica_convenios').insert({ ...datos, auth_user_id: STATE.userId });
    const { error } = await q; if (error) throw error;
    closeModal('modal-convenio'); showToast('Convenio guardado.'); await cargar(); cambiarTab('convenios');
  } catch (e) { console.error('guardarConvenio:', e); err.textContent = clinicaTextoError(e, 'No se pudo guardar.'); }
}

/* ---------- Facturar a la aseguradora (por Ventas, normalmente a crédito) ---------- */
async function servicioCobertura() {
  const nombre = 'Cobertura de seguro médico';
  const { data } = await sb.from('productos').select('id').eq('auth_user_id', STATE.userId).eq('tipo', 'servicio').eq('nombre', nombre).limit(1);
  if (data && data.length) return data[0].id;
  const { data: nuevo, error } = await sb.from('productos').insert({ auth_user_id: STATE.userId, nombre, tipo: 'servicio', precio: 0, activo: true }).select('id').single();
  if (error) throw error;
  return nuevo.id;
}
async function clienteDe(k) {
  if (k.cliente_id) return k.cliente_id;
  const { data: c, error } = await sb.from('clientes').insert({ auth_user_id: STATE.userId, nombre: k.nombre.slice(0, 100), telefono: k.telefono || null }).select('id').single();
  if (error) throw error;
  await sb.from('clinica_convenios').update({ cliente_id: c.id }).eq('id', k.id).eq('auth_user_id', STATE.userId);
  k.cliente_id = c.id; return c.id;
}
async function facturar(convId) {
  const k = convenio(convId); if (!k) return;
  const g = clinicaPendientesSeguro(SG.citas, SG.reclamos).find(x => x.convenio_id === convId); if (!g) return;
  const elegidas = g.citas.filter(c => SG.sel[convId].has(c.id)); if (!elegidas.length) return;
  const monto = Math.round(elegidas.reduce((t, c) => t + c.monto_cubierto, 0) * 100) / 100;
  if (!confirm(`¿Facturar ${fmt(monto)} a ${k.nombre} por ${elegidas.length} concepto(s)?\n\nSe abrirá la pantalla de cobro: si la aseguradora te paga después, elige "Fiado" (se activa en Configuración).`)) return;
  try {
    await clienteDe(k);
    const { data, error } = await sb.from('clinica_reclamos').insert({ auth_user_id: STATE.userId, convenio_id: k.id, estado: 'enviado', citas: elegidas.map(c => c.id), monto,
      detalle: { lineas: elegidas.map(c => ({ cita_id: c.id, tipo: c.tipo || 'cita', fecha: c.fecha, paciente: clinicaNombrePaciente(c.clinica_pacientes || {}), monto: c.monto_cubierto, pct: c.cobertura_pct })) } }).select('id').single();
    if (error) throw error;
    await irAVentas(data.id, k, monto, elegidas.length);
  } catch (e) { console.error('facturar:', e); showToast(clinicaTextoError(e, 'No se pudo preparar la factura.'), 'error'); }
}
async function irAVentas(id, k, monto, n) {
  try {
    const r = SG.reclamos.find(x => x.id === id);
    k = k || convenio(r.convenio_id); monto = monto ?? Number(r.monto); n = n ?? (r.citas || []).length;
    const prod = await servicioCobertura(), cliente = await clienteDe(k);
    sessionStorage.setItem('n360_clinica_cobro', JSON.stringify({ tipo: 'reclamo', id, clienteId: cliente, cliente: k.nombre,
      concepto: `Cobertura ${k.nombre} · ${n} cita${n === 1 ? '' : 's'}`, items: [{ producto_id: prod, cantidad: 1, total: monto }] }));
    // Sin salir de la Clínica: Ventas se abre en una ventana aquí mismo (si te paga después, "Crédito").
    if (typeof clinicaAbrirCobro === 'function' && clinicaAbrirCobro({ titulo: `Facturar a ${k.nombre}`,
      alTerminar: ventaId => clinicaLigarVenta('clinica_reclamos', id, ventaId, { estado: 'facturado' }, q => q.eq('estado', 'enviado')),
      alCerrar: async cobrado => { if (cobrado) showToast('✅ Factura registrada en Ventas.'); await cargar(); } })) return;
    window.location.href = 'ventas.html';
  } catch (e) { console.error('irAVentas:', e); showToast('No se pudo abrir Ventas.', 'error'); }
}
async function anularReclamo(id) {
  if (!confirm('¿Anular esta factura pendiente? Sus citas vuelven a quedar por facturar.')) return;
  try {
    const { error } = await sb.from('clinica_reclamos').update({ estado: 'anulado' }).eq('id', id).eq('auth_user_id', STATE.userId).eq('estado', 'enviado');
    if (error) throw error;
    showToast('Anulada.'); await cargar();
  } catch (e) { console.error('anularReclamo:', e); showToast('No se pudo anular.', 'error'); }
}
