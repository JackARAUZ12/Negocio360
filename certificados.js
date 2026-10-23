/* =====================================================
   CERTIFICADOS.JS — NEGOCIO360 (23-oct-2026)
   Certificados de regalo (gift cards): crear, ver su historial,
   descargar el certificado en PDF, cobrarlo en Ventas (si se eligió
   "cobrado como venta") y anularlo (si no se ha usado).
   Esta página NUNCA cambia saldos ni Caja por su cuenta: todo pasa por
   las funciones de la base (certificado_emitir, certificado_anular) y,
   al usarlos, por la misma operación que guarda la venta.
===================================================== */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = { userId: null, empresaConfig: {}, currentUser: {}, lista: [], clientes: [], metodos: [], bancos: [], actual: null };

const MODO_LABEL = { anticipo: 'Cobrado por adelantado', venta: 'Cobrado como venta', cortesia: 'Cortesía' };
const ESTADO = {
  activo:          { label: 'Activo',            c: 'var(--success)', bg: 'var(--success-soft)' },
  pendiente_cobro: { label: 'Pendiente de cobrar', c: '#b45309', bg: '#fef3cd' },
  agotado:         { label: 'Usado por completo', c: 'var(--text-muted)', bg: 'var(--bg-app)' },
  vencido:         { label: 'Vencido',            c: 'var(--danger)', bg: 'var(--danger-soft)' },
  anulado:         { label: 'Anulado',            c: 'var(--danger)', bg: 'var(--danger-soft)' },
};
const MOV_LABEL = { emision: 'Creado', activacion: 'Cobrado en Ventas', canje: 'Usado en venta', reverso_canje: 'Devuelto (venta anulada)', anulacion: 'Anulado' };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(n) {
  const sym = monedaParaMostrar(STATE.empresaConfig?.moneda);
  return `${sym} ${convertirParaMostrar(Number(n) || 0, STATE.empresaConfig?.moneda).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function ymdLocal(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function hoyISO() { return ymdLocal(new Date()); }
function fechaCorta(iso) { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function perfilActivo() { try { return JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null')?.nombre || null; } catch (_) { return null; } }
function estadoReal(c) { return (c.estado === 'activo' || c.estado === 'pendiente_cobro') && c.fecha_vence && String(c.fecha_vence) < hoyISO() ? 'vencido' : c.estado; }

/* ---------- shell (igual al resto del sistema) ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('n360_theme', theme);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = theme === 'dark' ? 'block' : 'none'; if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
function isMobileViewport() { return window.innerWidth <= 860; }
function toggleSidebar() {
  if (isMobileViewport()) { document.getElementById('sidebar').classList.toggle('mobile-open'); document.getElementById('sidebar-overlay').classList.toggle('active'); }
  else { document.getElementById('sidebar').classList.toggle('collapsed'); document.getElementById('main').classList.toggle('sidebar-collapsed'); }
}
function closeMobileSidebar() { document.getElementById('sidebar').classList.remove('mobile-open'); document.getElementById('sidebar-overlay').classList.remove('active'); }
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
function openModal(id) { const el = document.getElementById(id); if (el) { el.style.display = 'flex'; el.classList.add('modal-open'); document.body.style.overflow = 'hidden'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display = 'none'; el.classList.remove('modal-open'); document.body.style.overflow = ''; } }
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast'); if (!t) { console.log(msg); return; }
  t.textContent = msg; t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`; setTimeout(() => t.classList.remove('show'), 3500);
}

/* ---------- carga ---------- */
async function cargar() {
  const { data, error } = await sb.from('certificados_regalo').select('*').eq('auth_user_id', STATE.userId).order('created_at', { ascending: false }).range(0, 4999);
  if (error) { console.error(error); document.getElementById('gc-lista').innerHTML = '<tr><td colspan="7" style="color:var(--danger);padding:16px">No se pudieron cargar los certificados.</td></tr>'; return; }
  STATE.lista = data || [];
  renderKpis(); renderLista();
}
function renderKpis() {
  const l = STATE.lista;
  const act = l.filter(c => estadoReal(c) === 'activo');
  document.getElementById('gc-k-activos').textContent = act.length;
  document.getElementById('gc-k-saldo').textContent = fmt(act.filter(c => c.modo !== 'cortesia').reduce((a, c) => a + Number(c.saldo), 0));
  document.getElementById('gc-k-pend').textContent = l.filter(c => estadoReal(c) === 'pendiente_cobro').length;
  document.getElementById('gc-k-venc').textContent = l.filter(c => estadoReal(c) === 'vencido' && Number(c.saldo) > 0).length;
}
function badge(est) { const e = ESTADO[est] || ESTADO.activo; return `<span class="gc-badge" style="color:${e.c};background:${e.bg}">${e.label}</span>`; }
function renderLista() {
  const q = (document.getElementById('gc-buscar')?.value || '').trim().toLowerCase();
  const f = document.getElementById('gc-filtro')?.value || 'vigentes';
  const filas = STATE.lista.filter(c => {
    const e = estadoReal(c);
    if (f === 'vigentes' && !['activo', 'pendiente_cobro'].includes(e)) return false;
    if (!['vigentes', 'todos'].includes(f) && e !== f) return false;
    if (q && ![c.codigo, c.beneficiario_nombre, c.comprador_nombre].some(x => String(x || '').toLowerCase().includes(q))) return false;
    return true;
  });
  document.getElementById('gc-lista').innerHTML = filas.length ? filas.map(c => `
    <tr onclick="abrirDetalle('${c.id}')">
      <td class="gc-cod">${esc(c.codigo)}</td>
      <td>${esc(c.beneficiario_nombre || '—')}${c.comprador_nombre ? `<div style="font-size:11px;color:var(--text-muted)">de ${esc(c.comprador_nombre)}</div>` : ''}</td>
      <td>${fmt(c.monto_original)}</td>
      <td style="font-weight:700">${fmt(c.saldo)}</td>
      <td style="font-size:12px">${MODO_LABEL[c.modo]}${c.uso_parcial ? '' : '<div style="font-size:11px;color:var(--text-muted)">uso único</div>'}</td>
      <td>${c.fecha_vence ? fechaCorta(c.fecha_vence) : 'No vence'}</td>
      <td>${badge(estadoReal(c))}</td>
    </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">${STATE.lista.length ? 'Ningún certificado coincide.' : 'Todavía no has creado certificados de regalo.'}</td></tr>`;
}

/* ---------- nuevo ---------- */
async function abrirNuevo() {
  ['gn-monto', 'gn-codigo', 'gn-comprador-nombre', 'gn-benef-nombre', 'gn-mensaje'].forEach(id => { document.getElementById(id).value = ''; });
  document.querySelector('input[name="gn-modo"][value="anticipo"]').checked = true;
  document.getElementById('gn-vence-chk').checked = false; document.getElementById('gn-vence').disabled = true; document.getElementById('gn-vence').value = '';
  document.getElementById('gn-parcial').checked = true;
  document.getElementById('gn-comprador').value = ''; document.getElementById('gn-benef').value = '';
  document.getElementById('gn-error').textContent = '';
  document.getElementById('gn-metodo').innerHTML = STATE.metodos.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('') || '<option value="">Efectivo</option>';
  alCambiarModo(); alCambiarMetodo();
  openModal('modal-gc-nuevo');
}
function modoElegido() { return document.querySelector('input[name="gn-modo"]:checked')?.value || 'anticipo'; }
function alCambiarModo() { document.getElementById('gn-pago-wrap').style.display = modoElegido() === 'anticipo' ? '' : 'none'; }
function alCambiarMetodo() {
  const nombre = (document.getElementById('gn-metodo').selectedOptions[0]?.textContent || '').toLowerCase();
  const usaBanco = /tarjeta|transferencia/.test(nombre) && STATE.bancos.length;
  document.getElementById('gn-banco-wrap').style.display = usaBanco ? '' : 'none';
  document.getElementById('gn-banco').innerHTML = '<option value="">— Sin banco —</option>' + STATE.bancos.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('');
}
function nombreCliente(id) { return (STATE.clientes.find(c => c.id === id) || {}).nombre || ''; }

async function emitir() {
  const err = document.getElementById('gn-error'); err.textContent = '';
  const monto = Math.round((parseFloat(document.getElementById('gn-monto').value) || 0) * 100) / 100;
  if (!(monto > 0)) { err.textContent = 'Escribe el monto del certificado.'; return; }
  const modo = modoElegido();
  const venceChk = document.getElementById('gn-vence-chk').checked, vence = document.getElementById('gn-vence').value;
  if (venceChk && !vence) { err.textContent = 'Elige la fecha de vencimiento o quita "Tiene vencimiento".'; return; }
  if (venceChk && vence < hoyISO()) { err.textContent = 'La fecha de vencimiento ya pasó.'; return; }
  const compId = document.getElementById('gn-comprador').value, benId = document.getElementById('gn-benef').value;
  const metSel = document.getElementById('gn-metodo');
  const p = {
    monto, modo, uso_parcial: document.getElementById('gn-parcial').checked, fecha_vence: venceChk ? vence : null,
    codigo: document.getElementById('gn-codigo').value.trim().toUpperCase() || null,
    comprador_cliente_id: compId || null, comprador_nombre: compId ? nombreCliente(compId) : document.getElementById('gn-comprador-nombre').value.trim(),
    beneficiario_cliente_id: benId || null, beneficiario_nombre: benId ? nombreCliente(benId) : document.getElementById('gn-benef-nombre').value.trim(),
    mensaje: document.getElementById('gn-mensaje').value.trim(), creado_por: perfilActivo(),
  };
  if (modo === 'anticipo') {
    p.metodo_pago_id = metSel.value || null; p.metodo_pago_nombre = metSel.selectedOptions[0]?.textContent || 'Efectivo';
    const bancoWrap = document.getElementById('gn-banco-wrap');
    p.banco_id = bancoWrap.style.display !== 'none' ? (document.getElementById('gn-banco').value || null) : null;
  }
  const btn = document.getElementById('gn-btn'); btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('certificado_emitir', { p });
    if (error) throw error;
    closeModal('modal-gc-nuevo');
    showToast(`Certificado ${data.codigo} creado${modo === 'anticipo' ? ' — el dinero entró a Caja' : ''}`);
    await cargar();
    await abrirDetalle(data.id);
  } catch (e) {
    console.error('emitir:', e);
    err.textContent = e?.message && !/fetch/i.test(e.message) ? e.message : 'No se pudo crear. Revisa tu conexión e intenta de nuevo.';
  } finally { btn.disabled = false; }
}

/* ---------- detalle ---------- */
async function abrirDetalle(id) {
  const c = STATE.lista.find(x => x.id === id); if (!c) return;
  STATE.actual = c;
  const { data: movs } = await sb.from('certificados_regalo_movimientos').select('*').eq('certificado_id', id).eq('auth_user_id', STATE.userId).order('created_at');
  const e = estadoReal(c);
  document.getElementById('gd-titulo').innerHTML = `Certificado <span class="gc-cod">${esc(c.codigo)}</span> ${badge(e)}`;
  document.getElementById('gd-cuerpo').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
      <div><b>Monto:</b> ${fmt(c.monto_original)}</div><div><b>Saldo:</b> <span style="font-size:15px;font-weight:800">${fmt(c.saldo)}</span></div>
      <div><b>Para:</b> ${esc(c.beneficiario_nombre || '—')}</div><div><b>De:</b> ${esc(c.comprador_nombre || '—')}</div>
      <div><b>Cómo se registró:</b> ${MODO_LABEL[c.modo]}${c.metodo_pago_nombre ? ' · ' + esc(c.metodo_pago_nombre) : ''}</div>
      <div><b>Uso:</b> ${c.uso_parcial ? 'por partes' : 'una sola vez'}</div>
      <div><b>Creado:</b> ${fechaCorta(c.fecha_emision)}</div><div><b>Vence:</b> ${c.fecha_vence ? fechaCorta(c.fecha_vence) : 'No vence'}</div>
      ${c.mensaje ? `<div style="grid-column:1/-1"><b>Mensaje:</b> ${esc(c.mensaje)}</div>` : ''}
      ${c.anulado_motivo ? `<div style="grid-column:1/-1;color:var(--danger)"><b>Anulado:</b> ${esc(c.anulado_motivo)}</div>` : ''}
    </div>
    ${c.estado === 'pendiente_cobro' ? `<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:#fef3cd;color:#b45309;font-size:12.5px">Este certificado todavía no se puede usar: primero cóbralo en Ventas.</div>` : ''}
    <div style="margin-top:14px;font-weight:700;font-size:13px">Historial</div>
    <table class="gc-hist">${(movs || []).map(m => `<tr>
      <td>${new Date(m.created_at).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td><b>${MOV_LABEL[m.tipo] || m.tipo}</b>${m.venta_numero ? ` · ${esc(m.venta_numero)}` : ''}${m.observacion ? `<div style="font-size:11.5px;color:var(--text-muted)">${esc(m.observacion)}</div>` : ''}</td>
      <td style="text-align:right">${m.tipo === 'canje' ? '−' + fmt(m.consumido) : m.tipo === 'reverso_canje' ? '+' + fmt(m.consumido) : m.tipo === 'emision' ? fmt(m.monto) : ''}</td>
      <td style="text-align:right;color:var(--text-muted)">${m.saldo_despues != null ? 'saldo ' + fmt(m.saldo_despues) : ''}</td></tr>`).join('')}</table>`;
  document.getElementById('gd-btn-cobrar').style.display = c.estado === 'pendiente_cobro' ? '' : 'none';
  document.getElementById('gd-btn-anular').style.display = (['activo', 'pendiente_cobro'].includes(c.estado) && Number(c.saldo) >= Number(c.monto_original) && !(c.modo === 'venta' && c.estado === 'activo')) ? '' : 'none';
  openModal('modal-gc-det');
}

/* ---------- cobrar en Ventas (modo "venta") ---------- */
async function servicioCertificadoId() {
  const { data } = await sb.from('productos').select('id,activo').eq('auth_user_id', STATE.userId).eq('tipo', 'servicio').eq('nombre', 'Certificado de regalo').limit(1);
  if (data && data[0]) {
    if (data[0].activo === false) await sb.from('productos').update({ activo: true }).eq('id', data[0].id).eq('auth_user_id', STATE.userId);
    return data[0].id;
  }
  const { data: nuevo, error } = await sb.from('productos').insert({ auth_user_id: STATE.userId, tipo: 'servicio', nombre: 'Certificado de regalo', precio: 0, costo: 0, activo: true,
    descripcion: 'Creado automáticamente para cobrar certificados de regalo en Ventas.' }).select('id').single();
  if (error) throw error;
  return nuevo.id;
}
async function cobrarEnVentas() {
  const c = STATE.actual; if (!c || c.estado !== 'pendiente_cobro') return;
  try {
    const productoId = await servicioCertificadoId();
    sessionStorage.setItem('n360_certificado_cobro', JSON.stringify({ certId: c.id, codigo: c.codigo, monto: Number(c.monto_original), productoId, clienteId: c.comprador_cliente_id || null }));
    window.location.href = 'ventas.html';
  } catch (e) { console.error('cobrarEnVentas:', e); showToast('No se pudo preparar el cobro. Intenta de nuevo.', 'error'); }
}

/* ---------- anular ---------- */
function abrirAnular() {
  const c = STATE.actual; if (!c) return;
  document.getElementById('ga-motivo').value = ''; document.getElementById('ga-error').textContent = '';
  document.getElementById('ga-devolver').checked = false;
  document.getElementById('ga-devolver-wrap').style.display = c.modo === 'anticipo' ? 'flex' : 'none';
  openModal('modal-gc-anular');
}
async function anular() {
  const c = STATE.actual; if (!c) return;
  const err = document.getElementById('ga-error'); err.textContent = '';
  const motivo = document.getElementById('ga-motivo').value.trim();
  if (!motivo) { err.textContent = 'Escribe el motivo.'; return; }
  const btn = document.getElementById('ga-btn'); btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('certificado_anular', { p_id: c.id, p_motivo: motivo, p_devolver: document.getElementById('ga-devolver').checked, p_creado_por: perfilActivo() });
    if (error) throw error;
    closeModal('modal-gc-anular'); closeModal('modal-gc-det');
    showToast(data?.devuelto ? 'Certificado anulado y dinero devuelto (salió de Caja)' : 'Certificado anulado');
    await cargar();
  } catch (e) { err.textContent = e?.message && !/fetch/i.test(e.message) ? e.message : 'No se pudo anular.'; }
  finally { btn.disabled = false; }
}

/* ---------- PDF del certificado ---------- */
async function cargarLogo() {
  const url = STATE.empresaConfig?.logo_principal_url || STATE.empresaConfig?.logo_url;
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
  } catch (_) { return null; }
}
async function descargarPDF() {
  const c = STATE.actual; if (!c) return;
  if (!window.jspdf) { showToast('No se pudo cargar el generador de PDF. Revisa tu internet y recarga la página.', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [210, 110] });
  const W = 210, H = 110;
  const negocio = STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi negocio';
  doc.setFillColor(124, 58, 237); doc.rect(0, 0, 8, H, 'F');
  doc.setDrawColor(124, 58, 237); doc.setLineWidth(0.6); doc.roundedRect(12, 6, W - 18, H - 12, 4, 4);
  const logo = await cargarLogo();
  if (logo) { try { doc.addImage(logo, 18, 11, 24, 24, undefined, 'FAST'); } catch (_) {} }
  doc.setTextColor(30, 30, 40); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(negocio, logo ? 46 : 18, 19);
  doc.setFontSize(22); doc.setTextColor(124, 58, 237);
  doc.text('CERTIFICADO DE REGALO', W - 14, 21, { align: 'right' });
  doc.setTextColor(30, 30, 40); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  let y = 44;
  if (c.beneficiario_nombre) { doc.text('Para:', 18, y); doc.setFont('helvetica', 'bold'); doc.text(String(c.beneficiario_nombre), 32, y); doc.setFont('helvetica', 'normal'); y += 8; }
  if (c.comprador_nombre) { doc.text('De:', 18, y); doc.setFont('helvetica', 'bold'); doc.text(String(c.comprador_nombre), 32, y); doc.setFont('helvetica', 'normal'); y += 8; }
  if (c.mensaje) { doc.setFont('helvetica', 'italic'); doc.setFontSize(10.5); doc.splitTextToSize(`“${c.mensaje}”`, 110).slice(0, 3).forEach(l => { doc.text(l, 18, y); y += 5.5; }); doc.setFont('helvetica', 'normal'); }
  doc.setFontSize(10); doc.setTextColor(110, 110, 120); doc.text('Valor', W - 14, 42, { align: 'right' });
  doc.setFontSize(30); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 40);
  doc.text(fmt(c.monto_original), W - 14, 56, { align: 'right' });
  doc.setFillColor(243, 240, 255); doc.roundedRect(W - 84, 64, 70, 16, 3, 3, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 110, 120); doc.text('Código', W - 49, 69.5, { align: 'center' });
  doc.setFont('courier', 'bold'); doc.setFontSize(15); doc.setTextColor(76, 29, 149); doc.text(c.codigo, W - 49, 77, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 110, 120);
  const cond = [
    c.fecha_vence ? `Válido hasta el ${fechaCorta(c.fecha_vence)}.` : 'No vence.',
    c.uso_parcial ? 'Se puede usar en varias compras hasta agotar el saldo.' : 'Se usa en una sola compra.',
    'No se cambia por dinero en efectivo. Presenta el código al pagar.',
  ];
  doc.text(cond.join('  ·  '), 18, H - 12);
  doc.save(`Certificado_${c.codigo}.pdf`);
}

/* ---------- inicio ---------- */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;
    const [cfg, us, cl, mp, bc] = await Promise.all([
      sb.from('configuracion_empresa').select('*').eq('auth_user_id', user.id).maybeSingle(),
      sb.from('usuarios').select('*').eq('auth_user_id', user.id).maybeSingle(),
      sb.from('clientes').select('id,nombre').eq('auth_user_id', user.id).order('nombre').range(0, 9999),
      sb.from('metodos_pago').select('id,nombre,activo').eq('auth_user_id', user.id).order('nombre'),
      sb.from('bancos').select('id,nombre,moneda,activo').eq('auth_user_id', user.id).order('nombre'),
    ]);
    STATE.empresaConfig = cfg.data || {}; STATE.currentUser = us.data || {};
    STATE.clientes = cl.data || []; STATE.metodos = (mp.data || []).filter(m => m.activo !== false); STATE.bancos = (bc.data || []).filter(b => b.activo !== false);
    const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = STATE.empresaConfig.nombre_comercial || 'Mi negocio';
    const name = STATE.currentUser?.nombre || user.email?.split('@')[0] || 'Usuario';
    const hn = document.getElementById('header-name'); if (hn) hn.textContent = name;
    const ha = document.getElementById('header-avatar'); if (ha) ha.textContent = (name || 'U')[0].toUpperCase();
    ['gn-comprador', 'gn-benef'].forEach(id => {
      const sel = document.getElementById(id);
      sel.innerHTML = '<option value="">— Escribir nombre —</option>' + STATE.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
      if (window.N360SelectBuscable) N360SelectBuscable.mejorar(sel, { placeholder: 'Buscar cliente… (opcional)', incluirVacio: true, anchoCompleto: true });
    });
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    await cargar();
  } catch (e) {
    console.error('init certificados:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => { init(); if (window.lucide) lucide.createIcons(); });

/* Moneda de visualización (igual que en el resto de módulos) */
function abrirModalMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  document.getElementById('mv-moneda-oficial').textContent = oficial;
  document.getElementById('mv-select-moneda').value = monedaVisualizacionActiva() || '';
  document.getElementById('mv-tasa').value = tasaVisualizacionActiva() || '';
  document.getElementById('mv-error').textContent = '';
  onCambiarSelectMonedaVis();
  document.getElementById('modal-moneda-vis').style.display = 'flex';
}
function onCambiarSelectMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  document.getElementById('mv-wrap-tasa').style.display = (elegida && elegida !== oficial) ? '' : 'none';
}
function guardarMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  const errEl = document.getElementById('mv-error'); errEl.textContent = '';
  if (!elegida || elegida === oficial) desactivarMonedaVisualizacion();
  else {
    const tasa = parseFloat(document.getElementById('mv-tasa').value);
    if (!tasa || tasa <= 0) { errEl.textContent = 'Escribe tu tasa de cambio (cordobas por 1 dolar).'; return; }
    activarMonedaVisualizacion(elegida, tasa);
  }
  location.reload();
}
window.addEventListener('DOMContentLoaded', () => {
  let n = 0; const iv = setInterval(() => { n++; if (STATE.empresaConfig || n >= 30) { clearInterval(iv); const b = document.getElementById('btn-moneda-vis-texto'); if (b) b.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda); } }, 100);
});
