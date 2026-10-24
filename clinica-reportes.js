/* =====================================================
   CLINICA-REPORTES.JS — NEGOCIO360 · Módulo Clínica
   Sobre las citas de la Agenda del sistema. Atendidos, inasistencias e ingresos por médico y por
   servicio (lo cobrado se lee de las MISMAS ventas, menos
   sus devoluciones, para que cuadre con Ventas y Caja),
   honorarios por médico con pago por Salarios, y
   diagnósticos frecuentes (con código del médico o de
   administrador; solo cifras, sin nombres de pacientes).
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
   REPORTES
===================================================== */
const RP = { citas: [], ventas: [], detalles: [], devoluciones: [], personal: [], pagadas: [], liquidaciones: [], resumen: null, honorarios: {}, codigoAdmin: null, pidiendo: null };
const $r = id => document.getElementById(id);

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
    const hoy = vetHoy();
    $r('rp-desde').value = hoy.slice(0, 8) + '01'; $r('rp-hasta').value = hoy;
    await cargar();
  } catch (e) {
    console.error('init clinica-reportes:', e);
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
    desde += tam; if (desde > 50000) break;
  }
  return todo;
}
// Trae por partes (listas de ids largas no caben en una sola consulta).
async function porPartes(ids, consulta) {
  let todo = [];
  for (let i = 0; i < ids.length; i += 150) todo = todo.concat(await traerTodo(() => consulta(ids.slice(i, i + 150))));
  return todo;
}
async function cargar() {
  const desde = $r('rp-desde').value, hasta = $r('rp-hasta').value;
  if (!desde || !hasta || desde > hasta) { showToast('Revisa las fechas: "desde" no puede ser después de "hasta".', 'error'); return; }
  $r('rp-cuerpo').style.opacity = '.5';
  try {
    const [cc, pag] = await Promise.all([
      ClinicaCitas.cargar(desde, hasta),
      traerTodo(() => sb.from('clinica_honorarios').select('id, personal_id, desde, hasta, monto, estado, citas, created_at, pagada_en').eq('auth_user_id', STATE.userId).order('created_at', { ascending: false }).order('id')),
    ]);
    const citas = cc.citas;
    RP.citas = citas; RP.personal = cc.medicos; RP.liquidaciones = pag;
    RP.pagadas = pag.filter(h => h.estado === 'pagada').flatMap(h => h.citas || []);
    const ventaIds = [...new Set(citas.map(c => c.venta_id).filter(Boolean))];
    const [ventas, detalles, devoluciones] = await Promise.all([
      porPartes(ventaIds, ids => sb.from('ventas').select('id, numero_venta, estado, total, fecha').eq('auth_user_id', STATE.userId).in('id', ids).order('id')),
      porPartes(ventaIds, ids => sb.from('venta_detalles').select('venta_id, producto_nombre, tipo_item, cantidad, subtotal').eq('auth_user_id', STATE.userId).in('venta_id', ids).order('id')),
      porPartes(ventaIds, ids => sb.from('devoluciones_venta').select('venta_id, total, estado').eq('auth_user_id', STATE.userId).in('venta_id', ids).order('id')),
    ]);
    RP.ventas = ventas; RP.detalles = detalles; RP.devoluciones = devoluciones;
    RP.resumen = clinicaResumenReporte({ citas, ventas, detalles, devoluciones, medicos: RP.personal });
    RP.honorarios = {};
    RP.personal.filter(m => m.honorario_tipo && m.honorario_tipo !== 'ninguno').forEach(m => {
      RP.honorarios[m.id] = clinicaCalcularHonorarios({ medico: m, citas, ventas, detalles, devoluciones, pagadas: RP.pagadas });
    });
    render();
    $r('rp-dx').innerHTML = '<p class="cl-sub">Por confidencialidad, los diagnósticos se ven con el código de un médico o el de administrador.</p>';
  } catch (e) { console.error('cargar reportes:', e); showToast('No se pudieron cargar los reportes.', 'error'); }
  finally { $r('rp-cuerpo').style.opacity = ''; }
}
function render() {
  const t = RP.resumen.total, validas = t.citas - t.canceladas;
  $r('rp-kpi-citas').textContent = t.citas; $r('rp-kpi-aten').textContent = t.atendidas;
  $r('rp-kpi-falta').textContent = validas > 0 ? Math.round(t.no_asistio * 100 / validas) + '%' : '0%';
  $r('rp-kpi-cobrado').textContent = fmt(t.cobrado);
  $r('rp-kpi-cobrado').title = t.cubierto ? `Además, ${fmt(t.cubierto)} cubierto por seguros (se factura en Clínica · Seguros)` : '';
  $r('rp-cubierto').innerHTML = t.cubierto ? `<div class="cl-info">🛡️ Además de lo cobrado a pacientes, los seguros cubrieron <b>${esc(fmt(t.cubierto))}</b> en estas fechas (se les factura en Clínica · Seguros).</div>` : '';
  $r('rp-sin-cobrar').innerHTML = t.sin_cobrar ? `<div class="cl-aviso">⚠️ ${t.sin_cobrar} consulta${t.sin_cobrar === 1 ? '' : 's'} atendida${t.sin_cobrar === 1 ? '' : 's'} todavía sin cobrar en este periodo (cóbralas desde la Sala de espera o la Agenda).</div>` : '';
  // Por médico (con honorarios)
  $r('rp-medicos').innerHTML = RP.resumen.porMedico.length ? RP.resumen.porMedico.map(f => {
    const m = RP.personal.find(x => x.id === f.medico_id), h = f.medico_id && RP.honorarios[f.medico_id];
    const hon = !m || !m.honorario_tipo || m.honorario_tipo === 'ninguno' ? '<span class="cl-sub">Sin honorarios</span>'
      : `<b>${esc(fmt(h.monto))}</b> <span class="cl-sub">(${m.honorario_tipo === 'porcentaje' ? Number(m.honorario_valor) + '% de ' + esc(fmt(h.base)) + ' en servicios' : esc(fmt(m.honorario_valor)) + ' por consulta'})${h.yaPagadas ? ` · ${h.yaPagadas} ya pagada${h.yaPagadas === 1 ? '' : 's'}` : ''}</span>`;
    const pagar = h && h.monto > 0 ? (m.empleado_id ? `<button class="btn-accion-tabla btn-primary" onclick="pagarHonorarios('${m.id}')">💵 Pagar en Salarios</button>`
      : '<span class="cl-badge cl-badge-ambar">Ligar a un empleado en Clínica · Médicos para pagar</span>') : '';
    return `<div class="cl-item"><div class="cl-item-cab"><div class="cl-item-tit">👨‍⚕️ ${esc(f.nombre)}</div><div class="cl-item-tit">${esc(fmt(f.cobrado))}</div></div>
      <p class="cl-sub">${f.citas} citas · ${f.atendidas} atendidas · ${f.no_asistio} no asistió · ${f.canceladas} canceladas${f.sin_cobrar ? ` · ${f.sin_cobrar} sin cobrar` : ''}</p>
      <p>Honorarios: ${hon}</p>${pagar ? `<div class="cl-acciones">${pagar}</div>` : ''}</div>`;
  }).join('') : '<p class="cl-sub">No hay citas en estas fechas.</p>';
  // Servicios y productos
  $r('rp-servicios').innerHTML = RP.resumen.servicios.length
    ? `<table class="cl-tabla-cuenta"><tr><td><b>Servicio / producto</b></td><td style="text-align:right"><b>Cant.</b></td><td style="text-align:right"><b>Total</b></td></tr>${RP.resumen.servicios.map(s =>
        `<tr><td>${s.tipo === 'servicio' ? '🛎️' : '📦'} ${esc(s.nombre)}</td><td style="text-align:right">${esc(vetFormatoNumero(s.cantidad))}</td><td style="text-align:right">${esc(fmt(s.total))}</td></tr>`).join('')}</table>
       <p class="cl-sub">Montos de cada línea de venta (antes de devoluciones). El total cobrado de arriba ya descuenta devoluciones.</p>`
    : '<p class="cl-sub">Sin ventas ligadas a citas en estas fechas.</p>';
  // Inasistencias
  const falta = RP.citas.filter(c => c.estado === 'no_asistio');
  $r('rp-falta').innerHTML = falta.length ? falta.map(c => `<div class="cl-item" style="padding:9px 12px"><div class="cl-item-cab"><div><div class="cl-item-tit">${esc(clinicaNombrePaciente(c.clinica_pacientes || {}))}</div>
      <div class="cl-item-fecha">${esc(vetFechaLarga(c.fecha))}${c.hora ? ' · ' + esc(vetFormatoHora(c.hora)) : ''}${c.medico_id ? ' · ' + esc(RP.personal.find(m => m.id === c.medico_id)?.nombre || '') : ''}</div></div>
      ${c.telefono ? `<span class="cl-sub">📞 ${esc(c.telefono)}</span>` : ''}</div></div>`).join('')
    : '<p class="cl-sub">Nadie faltó en estas fechas. 🎉</p>';
  // Liquidaciones de honorarios
  const est = { enviada: ['Pendiente de pago', 'ambar'], pagada: ['Pagada', 'verde'], anulada: ['Anulada', 'rojo'] };
  $r('rp-liq').innerHTML = RP.liquidaciones.length ? RP.liquidaciones.slice(0, 50).map(h => `<div class="cl-item" style="padding:9px 12px"><div class="cl-item-cab"><div>
      <div class="cl-item-tit">${esc(RP.personal.find(m => m.id === h.personal_id)?.nombre || '')} · ${esc(fmt(h.monto))}</div>
      <div class="cl-item-fecha">${esc(vetFechaLarga(h.desde))} al ${esc(vetFechaLarga(h.hasta))} · ${(h.citas || []).length} consultas</div></div>
      <span class="cl-badge cl-badge-${est[h.estado][1]}">${est[h.estado][0]}</span></div>
      ${h.estado === 'enviada' ? `<div class="cl-acciones"><button class="btn-accion-tabla btn-ghost" onclick="reenviarLiquidacion('${h.id}')">💵 Abrir en Salarios</button><button class="btn-accion-tabla btn-ghost" onclick="anularLiquidacion('${h.id}')">🚫 Anular</button></div>` : ''}</div>`).join('')
    : '<p class="cl-sub">Todavía no hay liquidaciones de honorarios.</p>';
}

/* ---------- Honorarios -> Salarios ---------- */
async function pagarHonorarios(medicoId) {
  const m = RP.personal.find(x => x.id === medicoId), h = RP.honorarios[medicoId];
  if (!m || !h || !(h.monto > 0) || !m.empleado_id) return;
  if (!confirm(`Pagar ${fmt(h.monto)} de honorarios a ${m.nombre} (${h.lineas.length} consultas del ${vetFechaLarga($r('rp-desde').value)} al ${vetFechaLarga($r('rp-hasta').value)})?\n\nSe abrirá Salarios con el monto como bonificación para que confirmes el pago.`)) return;
  try {
    const { data, error } = await sb.from('clinica_honorarios').insert({ auth_user_id: STATE.userId, personal_id: m.id, empleado_id: m.empleado_id, estado: 'enviada',
      desde: $r('rp-desde').value, hasta: $r('rp-hasta').value, citas: h.lineas.map(l => l.cita_id), monto: h.monto,
      detalle: { tipo: m.honorario_tipo, valor: Number(m.honorario_valor), base: h.base, lineas: h.lineas } }).select('id').single();
    if (error) throw error;
    irASalarios(data.id);
  } catch (e) { console.error('pagarHonorarios:', e); showToast('No se pudo preparar el pago.', 'error'); }
}
function irASalarios(id) {
  sessionStorage.setItem('n360_clinica_honorarios', JSON.stringify({ liquidacionId: id }));
  window.location.href = 'salarios.html';
}
function reenviarLiquidacion(id) { irASalarios(id); }
async function anularLiquidacion(id) {
  if (!confirm('¿Anular esta liquidación pendiente? Sus consultas vuelven a quedar disponibles para pagarse.')) return;
  try {
    const { error } = await sb.from('clinica_honorarios').update({ estado: 'anulada' }).eq('id', id).eq('auth_user_id', STATE.userId).eq('estado', 'enviada');
    if (error) throw error;
    showToast('Liquidación anulada.'); await cargar();
  } catch (e) { console.error('anularLiquidacion:', e); showToast('No se pudo anular.', 'error'); }
}

/* ---------- Diagnósticos frecuentes (con código del médico o de administrador) ---------- */
async function verDiagnosticos() {
  const s = ClinicaSesion.leer();
  let auth = s ? { token: s.token } : (RP.codigoAdmin ? { admin_pin: RP.codigoAdmin } : null);
  if (!auth) {
    $r('ac-codigo').value = ''; $r('ac-error').textContent = ''; openModal('modal-admin'); setTimeout(() => $r('ac-codigo').focus(), 50);
    auth = await new Promise(res => { RP.pidiendo = res; });
    if (!auth) return;
  }
  $r('rp-dx').innerHTML = '<p class="cl-sub">Cargando…</p>';
  try {
    const { data: r, error } = await sb.rpc('clinica_reporte_clinico', { p_auth: auth, p_desde: $r('rp-desde').value, p_hasta: $r('rp-hasta').value });
    if (error) throw error;
    if (!r || !r.ok) { RP.codigoAdmin = null; $r('rp-dx').innerHTML = `<p style="color:var(--danger,#dc2626)">${esc(clinicaTextoMotivo(r))}</p>`; return; }
    const max = Math.max(1, ...(r.diagnosticos || []).map(d => d.total));
    $r('rp-dx').innerHTML = ((r.diagnosticos || []).length ? r.diagnosticos.map(d => `<div style="margin:6px 0"><div class="ag-fila"><span>${d.codigo !== '—' ? `<b>${esc(d.codigo)}</b> · ` : ''}${esc(d.nombre)}</span><b>${d.total}</b></div>
        <div style="height:8px;background:var(--bg-app);border-radius:6px"><div style="height:8px;border-radius:6px;background:var(--accent,#6C63FF);width:${Math.round(d.total * 100 / max)}%"></div></div></div>`).join('')
      : '<p class="cl-sub">No hay diagnósticos registrados en notas cerradas de estas fechas.</p>')
      + ((r.notas || []).length ? `<div class="cl-seccion">Notas por médico</div>${r.notas.map(n => `<p class="cl-sub">👨‍⚕️ ${esc(n.medico_nombre)}: ${n.cerradas} cerradas${n.borradores ? ` · <b>${n.borradores} sin cerrar</b>` : ''}${n.anuladas ? ` · ${n.anuladas} anuladas` : ''}</p>`).join('')}` : '');
  } catch (e) { console.error('verDiagnosticos:', e); $r('rp-dx').innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar.</p>'; }
}
function respuestaAdmin(ok) {
  const res = RP.pidiendo; RP.pidiendo = null;
  if (!ok) { closeModal('modal-admin'); res && res(null); return; }
  const c = $r('ac-codigo').value.trim();
  if (!/^[0-9]{4,12}$/.test(c)) { $r('ac-error').textContent = 'El código tiene de 4 a 12 números.'; RP.pidiendo = res; return; }
  RP.codigoAdmin = c; closeModal('modal-admin'); res && res({ admin_pin: c });
}

/* ---------- Exportar (Excel / CSV) ---------- */
function descargar(nombre, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' })); a.download = nombre;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportar() {
  if (!RP.resumen) return;
  const d = $r('rp-desde').value, h = $r('rp-hasta').value;
  const filas = [['Reporte de la clínica', `${d} a ${h}`], [], ['Médico', 'Citas', 'Atendidas', 'No asistió', 'Canceladas', 'Sin cobrar', 'Cobrado neto', 'Honorarios']];
  RP.resumen.porMedico.forEach(f => filas.push([f.nombre, f.citas, f.atendidas, f.no_asistio, f.canceladas, f.sin_cobrar, f.cobrado, f.medico_id && RP.honorarios[f.medico_id] ? RP.honorarios[f.medico_id].monto : '']));
  filas.push([], ['Servicio / producto', 'Tipo', 'Cantidad', 'Total']);
  RP.resumen.servicios.forEach(s => filas.push([s.nombre, s.tipo, s.cantidad, s.total]));
  descargar(`clinica_reporte_${d}_${h}.csv`, clinicaCSV(filas));
}
