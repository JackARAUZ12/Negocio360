/* =====================================================
   SERVICIO.JS — NEGOCIO360
   Servicio postventa / garantías: qué pasa DESPUÉS de la venta --
   reclamos, reparaciones, cambios. Vínculo opcional con cliente y
   producto reales, pero funciona igual sin ellos.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  clientes: [], productos: [], tickets: [], garantias: [],
  filtroEstado: '',
  clienteElegido: null, productoElegido: null, garantiaElegidaTicket: null,
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = monedaParaMostrar(STATE.empresaConfig?.moneda);
  return `${sym} ${convertirParaMostrar(amount, STATE.empresaConfig?.moneda).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayLocalISO() { return ymdLocal(new Date()); }
function fmtFechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0,10) + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
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

/* =====================================================
   HELPERS DE MODAL Y TOAST
===================================================== */
function openModal(id) { const el = document.getElementById(id); if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; } }
function setBtnLoading(id, loading) { const btn = document.getElementById(id); if (btn) { btn.disabled = loading; btn.style.opacity = loading ? '.6' : ''; } }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* =====================================================
   CARGA BASE
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
  } catch (e) {}
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

async function cargarClientesCache() {
  try {
    const { data } = await sb.from('clientes').select('id,nombre').eq('auth_user_id', STATE.userId).order('nombre');
    STATE.clientes = data || [];
  } catch (e) { STATE.clientes = []; }
}
async function cargarProductosCache() {
  try {
    const { data } = await sb.from('productos').select('id,nombre,sku').eq('auth_user_id', STATE.userId).order('nombre');
    STATE.productos = data || [];
  } catch (e) { STATE.productos = []; }
}

/* =====================================================
   BÚSQUEDA DE CLIENTE / PRODUCTO DENTRO DEL MODAL
===================================================== */
function buscarClienteTicket(q) {
  const cont = document.getElementById('tk-cliente-resultados');
  q = q.trim().toLowerCase();
  if (!q) { cont.innerHTML = ''; return; }
  const resultados = STATE.clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 6);
  cont.innerHTML = resultados.map(c => `
    <div style="padding:6px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
         onclick="elegirClienteTicket('${c.id}','${esc(c.nombre)}')">${esc(c.nombre)}</div>
  `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
}
function elegirClienteTicket(id, nombre) {
  STATE.clienteElegido = { id, nombre };
  document.getElementById('tk-cliente-id').value = id;
  document.getElementById('tk-buscar-cliente').value = '';
  document.getElementById('tk-cliente-resultados').innerHTML = '';
  const el = document.getElementById('tk-cliente-elegido');
  el.style.display = 'flex';
  el.innerHTML = `<span>👤 ${esc(nombre)}</span><button type="button" class="row-action-btn" onclick="quitarClienteTicket()">✕</button>`;
}
function quitarClienteTicket() {
  STATE.clienteElegido = null;
  document.getElementById('tk-cliente-id').value = '';
  document.getElementById('tk-cliente-elegido').style.display = 'none';
}

function buscarProductoTicket(q) {
  const cont = document.getElementById('tk-producto-resultados');
  q = q.trim().toLowerCase();
  if (!q) { cont.innerHTML = ''; return; }
  const resultados = STATE.productos.filter(p => p.nombre.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q)).slice(0, 6);
  cont.innerHTML = resultados.map(p => `
    <div style="padding:6px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
         onclick="elegirProductoTicket('${p.id}','${esc(p.nombre)}')">${esc(p.nombre)}${p.sku?` <span style="color:var(--text-muted)">(${esc(p.sku)})</span>`:''}</div>
  `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
}
function elegirProductoTicket(id, nombre) {
  STATE.productoElegido = { id, nombre };
  document.getElementById('tk-producto-id').value = id;
  document.getElementById('tk-buscar-producto').value = '';
  document.getElementById('tk-producto-resultados').innerHTML = '';
  const el = document.getElementById('tk-producto-elegido');
  el.style.display = 'flex';
  el.innerHTML = `<span>📦 ${esc(nombre)}</span><button type="button" class="row-action-btn" onclick="quitarProductoTicket()">✕</button>`;
}
function quitarProductoTicket() {
  STATE.productoElegido = null;
  document.getElementById('tk-producto-id').value = '';
  document.getElementById('tk-producto-elegido').style.display = 'none';
}

// Calcula, en vivo, si la garantía sigue vigente hoy, según la fecha
// de compra + los meses de garantía que se indiquen.
function calcularEstadoGarantia(fechaCompra, garantiaMeses) {
  if (!fechaCompra || !garantiaMeses) return null;
  const compra = new Date(fechaCompra + 'T00:00:00');
  const vencimiento = new Date(compra);
  vencimiento.setMonth(vencimiento.getMonth() + Number(garantiaMeses));
  const hoy = new Date();
  const vigente = hoy <= vencimiento;
  return { vigente, vencimiento: ymdLocal(vencimiento) };
}

function actualizarEstadoGarantiaTicket() {
  const fecha = document.getElementById('tk-fecha-compra').value;
  const meses = document.getElementById('tk-garantia-meses').value;
  const el = document.getElementById('tk-estado-garantia');
  const resultado = calcularEstadoGarantia(fecha, meses);
  if (!resultado) { el.innerHTML = ''; return; }
  el.innerHTML = resultado.vigente
    ? `<span style="color:var(--success);font-weight:600">✅ Garantía vigente hasta ${fmtFechaCorta(resultado.vencimiento)}</span>`
    : `<span style="color:var(--danger);font-weight:600">⚠️ Garantía vencida desde ${fmtFechaCorta(resultado.vencimiento)}</span>`;
}


/* =====================================================
   CREAR TICKET
===================================================== */
function abrirModalTicket() {
  document.getElementById('tk-error').textContent = '';
  STATE.clienteElegido = null;
  STATE.productoElegido = null;
  STATE.garantiaElegidaTicket = null;
  document.getElementById('tk-cliente-id').value = '';
  document.getElementById('tk-producto-id').value = '';
  document.getElementById('tk-garantia-id').value = '';
  document.getElementById('tk-buscar-cliente').value = '';
  document.getElementById('tk-buscar-producto').value = '';
  document.getElementById('tk-buscar-garantia').value = '';
  document.getElementById('tk-cliente-resultados').innerHTML = '';
  document.getElementById('tk-producto-resultados').innerHTML = '';
  document.getElementById('tk-garantia-resultados').innerHTML = '';
  document.getElementById('tk-cliente-elegido').style.display = 'none';
  document.getElementById('tk-producto-elegido').style.display = 'none';
  document.getElementById('tk-garantia-elegida').style.display = 'none';
  document.getElementById('tk-fecha-compra').value = '';
  document.getElementById('tk-garantia-meses').value = '';
  document.getElementById('tk-estado-garantia').innerHTML = '';
  document.getElementById('tk-descripcion').value = '';
  document.getElementById('tk-tecnico').value = '';
  openModal('modal-ticket');
}

// Buscar una garantía ya registrada, para vincular el ticket a ella
// en vez de escribir todo de nuevo a mano.
function buscarGarantiaTicket(q) {
  const cont = document.getElementById('tk-garantia-resultados');
  q = q.trim().toLowerCase();
  if (!q) { cont.innerHTML = ''; return; }
  const resultados = STATE.garantias.filter(g =>
    (g.cliente_nombre||'').toLowerCase().includes(q) || (g.producto_nombre||'').toLowerCase().includes(q) || g.numero.toLowerCase().includes(q)
  ).slice(0, 6);
  cont.innerHTML = resultados.map(g => `
    <div style="padding:6px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
         onclick="elegirGarantiaTicket('${g.id}')">
      <b>${esc(g.numero)}</b> — ${esc(g.producto_nombre||'—')} ${g.cliente_nombre ? `(${esc(g.cliente_nombre)})` : ''}
    </div>
  `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
}
function elegirGarantiaTicket(id) {
  const g = STATE.garantias.find(x => x.id === id);
  if (!g) return;
  STATE.garantiaElegidaTicket = g;
  document.getElementById('tk-garantia-id').value = g.id;
  document.getElementById('tk-buscar-garantia').value = '';
  document.getElementById('tk-garantia-resultados').innerHTML = '';
  const el = document.getElementById('tk-garantia-elegida');
  el.style.display = 'flex';
  el.innerHTML = `<span>🛡️ ${esc(g.numero)} — ${esc(g.producto_nombre||'—')}</span><button type="button" class="row-action-btn" onclick="quitarGarantiaTicket()">✕</button>`;

  // Autocompletar cliente, producto, fecha y meses desde la garantía elegida
  if (g.cliente_id) elegirClienteTicket(g.cliente_id, g.cliente_nombre);
  if (g.producto_id) elegirProductoTicket(g.producto_id, g.producto_nombre);
  document.getElementById('tk-fecha-compra').value = g.fecha_compra;
  document.getElementById('tk-garantia-meses').value = g.garantia_meses;
  actualizarEstadoGarantiaTicket();
}
function quitarGarantiaTicket() {
  STATE.garantiaElegidaTicket = null;
  document.getElementById('tk-garantia-id').value = '';
  document.getElementById('tk-garantia-elegida').style.display = 'none';
}

async function guardarTicket() {
  const errEl = document.getElementById('tk-error');
  errEl.textContent = '';
  const descripcion = document.getElementById('tk-descripcion').value.trim();
  if (!descripcion) { errEl.textContent = 'Describe el problema o motivo del reclamo.'; return; }

  const fechaCompra = document.getElementById('tk-fecha-compra').value || null;
  const garantiaMeses = parseFloat(document.getElementById('tk-garantia-meses').value) || null;
  const tecnico = document.getElementById('tk-tecnico').value.trim() || null;
  const garantiaId = document.getElementById('tk-garantia-id').value || null;

  setBtnLoading('btn-guardar-ticket', true);
  try {
    const { data: numero } = await sb.rpc('generar_numero_ticket_servicio', { p_user_id: STATE.userId });

    const payload = {
      auth_user_id: STATE.userId, numero: numero || `ST-${Date.now()}`,
      cliente_id: STATE.clienteElegido?.id || null, cliente_nombre: STATE.clienteElegido?.nombre || null,
      producto_id: STATE.productoElegido?.id || null, producto_nombre: STATE.productoElegido?.nombre || null,
      garantia_id: garantiaId,
      fecha_compra: fechaCompra, garantia_meses: garantiaMeses,
      descripcion_problema: descripcion, tecnico_asignado: tecnico,
      usuario_nombre: STATE.currentUser?.nombre || 'Usuario', estado: 'abierto',
    };

    const { error } = await sb.from('servicio_postventa').insert(payload);

    if (error) throw error;

    showToast('🛠️ Ticket creado');
    closeModal('modal-ticket');
    await cargarTickets();
    actualizarKPIsServicio();
  } catch (e) {
    console.error('guardarTicket:', e);
    errEl.textContent = 'No se pudo crear el ticket. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-guardar-ticket', false);
  }
}

/* =====================================================
   LISTA / FILTRO
===================================================== */
async function cargarTickets() {
  try {
    const { data } = await sb.from('servicio_postventa').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    STATE.tickets = data || [];
    renderTablaTickets();
  } catch (e) { console.error('cargarTickets:', e); }
}

function filtrarTicketsPorEstado(estado) {
  STATE.filtroEstado = estado;
  document.querySelectorAll('.prod-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.estado === estado));
  renderTablaTickets();
}

const ESTADO_TICKET_LABEL = { abierto:'Abierto', en_reparacion:'En reparación', resuelto:'Resuelto', rechazado:'Rechazado', cambio_realizado:'Cambio realizado' };
const ESTADO_TICKET_CLASE = { abierto:'status-pendiente', en_reparacion:'status-pendiente', resuelto:'status-activo', rechazado:'status-inactivo', cambio_realizado:'status-activo' };

function renderTablaTickets() {
  const tbody = document.getElementById('tabla-tickets-servicio');
  if (!tbody) return;
  const lista = STATE.filtroEstado ? STATE.tickets.filter(t => t.estado === STATE.filtroEstado) : STATE.tickets;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No hay tickets ${STATE.filtroEstado ? 'en este estado' : 'todavía'}.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(t => {
    const garantia = calcularEstadoGarantia(t.fecha_compra, t.garantia_meses);
    let garantiaHtml = '—';
    if (garantia) garantiaHtml = garantia.vigente ? '<span style="color:var(--success)">✅ Vigente</span>' : '<span style="color:var(--danger)">⚠️ Vencida</span>';

    return `<tr>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(t.numero)}</span></td>
      <td>${esc(t.cliente_nombre || '—')}</td>
      <td>${esc(t.producto_nombre || '—')}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.descripcion_problema)}">${esc(t.descripcion_problema)}</td>
      <td>${garantiaHtml}</td>
      <td><span class="status-badge ${ESTADO_TICKET_CLASE[t.estado]}">${ESTADO_TICKET_LABEL[t.estado]}</span></td>
      <td>${fmtFechaCorta(t.fecha_ticket)}</td>
      <td><button class="row-action-btn" title="Ver / actualizar" onclick="verDetalleTicket('${t.id}')">👁️</button></td>
    </tr>`;
  }).join('');
}

/* =====================================================
   DETALLE / ACTUALIZAR TICKET
===================================================== */
function verDetalleTicket(id) {
  const t = STATE.tickets.find(x => x.id === id);
  if (!t) return;
  const garantia = calcularEstadoGarantia(t.fecha_compra, t.garantia_meses);

  document.getElementById('detalle-ticket-titulo').textContent = `Ticket ${t.numero}`;
  document.getElementById('detalle-ticket-cuerpo').innerHTML = `
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.8">
      ${t.cliente_nombre ? `<div><b>Cliente:</b> ${esc(t.cliente_nombre)}</div>` : ''}
      ${t.producto_nombre ? `<div><b>Producto:</b> ${esc(t.producto_nombre)}</div>` : ''}
      ${t.fecha_compra ? `<div><b>Comprado el:</b> ${fmtFechaCorta(t.fecha_compra)}${t.garantia_meses ? ` — garantía de ${t.garantia_meses} meses` : ''}</div>` : ''}
      ${garantia ? `<div>${garantia.vigente ? `<span style="color:var(--success)">✅ Garantía vigente hasta ${fmtFechaCorta(garantia.vencimiento)}</span>` : `<span style="color:var(--danger)">⚠️ Garantía vencida desde ${fmtFechaCorta(garantia.vencimiento)}</span>`}</div>` : ''}
      ${t.tecnico_asignado ? `<div><b>Técnico:</b> ${esc(t.tecnico_asignado)}</div>` : ''}
      <div><b>Registrado:</b> ${fmtFechaCorta(t.fecha_ticket)}</div>
    </div>
    <div style="padding:10px 12px;background:var(--bg-app);border-radius:8px;font-size:12.5px;margin-bottom:14px">
      <b>Problema reportado:</b><br/>${esc(t.descripcion_problema)}
    </div>

    <div class="form-group">
      <label>Estado</label>
      <select id="dt-estado">
        ${Object.entries(ESTADO_TICKET_LABEL).map(([v,l]) => `<option value="${v}" ${t.estado===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Solución / diagnóstico</label>
      <textarea id="dt-solucion" placeholder="Qué se hizo o se va a hacer...">${esc(t.solucion || '')}</textarea>
    </div>
    <div class="form-group">
      <label>Costo de reparación (opcional)</label>
      <input type="number" id="dt-costo" min="0" step="0.01" value="${t.costo_reparacion || 0}"/>
    </div>
    <p id="dt-error" style="color:var(--danger);font-size:12.5px"></p>
  `;
  document.getElementById('detalle-ticket-footer').innerHTML = `
    <button class="btn-ghost" onclick="closeModal('modal-detalle-ticket')">Cerrar</button>
    <button class="btn-primary" onclick="actualizarTicket('${t.id}')">Guardar cambios</button>
  `;
  openModal('modal-detalle-ticket');
}

async function actualizarTicket(id) {
  const errEl = document.getElementById('dt-error');
  const estado = document.getElementById('dt-estado').value;
  const solucion = document.getElementById('dt-solucion').value.trim() || null;
  const costo = parseFloat(document.getElementById('dt-costo').value) || 0;

  try {
    const payload = { estado, solucion, costo_reparacion: costo, updated_at: new Date().toISOString() };
    const estadosFinales = ['resuelto', 'rechazado', 'cambio_realizado'];
    const ticketActual = STATE.tickets.find(t => t.id === id);
    if (estadosFinales.includes(estado) && !estadosFinales.includes(ticketActual?.estado)) {
      payload.fecha_resolucion = new Date().toISOString();
    }

    const { error } = await sb.from('servicio_postventa').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;

    showToast('Ticket actualizado');
    closeModal('modal-detalle-ticket');
    await cargarTickets();
    actualizarKPIsServicio();
  } catch (e) {
    console.error('actualizarTicket:', e);
    errEl.textContent = 'No se pudo actualizar. Intenta de nuevo.';
  }
}

/* =====================================================
   KPIs
===================================================== */
function actualizarKPIsServicio() {
  const abiertos = STATE.tickets.filter(t => t.estado === 'abierto').length;
  const enReparacion = STATE.tickets.filter(t => t.estado === 'en_reparacion').length;

  const hoy = new Date();
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
  const resueltosMes = STATE.tickets.filter(t =>
    ['resuelto','cambio_realizado'].includes(t.estado) && t.fecha_resolucion && t.fecha_resolucion.slice(0,10) >= inicioMes
  );

  let tiempoPromedioTxt = '—';
  const conTiempo = STATE.tickets.filter(t => t.fecha_resolucion && t.fecha_ticket);
  if (conTiempo.length) {
    const diasPromedio = conTiempo.reduce((s, t) => {
      const dias = (new Date(t.fecha_resolucion) - new Date(t.fecha_ticket + 'T00:00:00')) / 86400000;
      return s + Math.max(0, dias);
    }, 0) / conTiempo.length;
    tiempoPromedioTxt = `${diasPromedio.toFixed(1)} días`;
  }

  document.getElementById('kpi-abiertos').textContent = abiertos.toString();
  document.getElementById('kpi-reparacion').textContent = enReparacion.toString();
  document.getElementById('kpi-resueltos-mes').textContent = resueltosMes.length.toString();
  document.getElementById('kpi-tiempo-promedio').textContent = tiempoPromedioTxt;
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.all([cargarClientesCache(), cargarProductosCache()]);
    await cargarGarantias();
    await cargarTickets();
    actualizarKPIsServicio();
  } catch (e) {
    console.error('init servicio:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   VISTA: GARANTÍAS (aparte de Tickets)
===================================================== */
function cambiarVistaServicio(vista) {
  document.querySelectorAll('.servicio-vista-btn').forEach(b => b.classList.toggle('active', b.dataset.vista === vista));
  document.getElementById('vista-tickets').style.display = vista === 'tickets' ? '' : 'none';
  document.getElementById('vista-garantias').style.display = vista === 'garantias' ? '' : 'none';
  document.getElementById('btn-nuevo-ticket').style.display = vista === 'tickets' ? '' : 'none';
  document.getElementById('btn-nueva-garantia').style.display = vista === 'garantias' ? '' : 'none';
}

async function cargarGarantias() {
  try {
    const { data } = await sb.from('garantias_clientes').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    STATE.garantias = data || [];
    renderTablaGarantias();
  } catch (e) { console.error('cargarGarantias:', e); }
}

function renderTablaGarantias() {
  const tbody = document.getElementById('tabla-garantias');
  if (!tbody) return;
  if (!STATE.garantias.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Todavía no hay ninguna garantía registrada.</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.garantias.map(g => {
    const vigente = todayLocalISO() <= g.fecha_vencimiento;
    return `<tr>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(g.numero)}</span></td>
      <td>${esc(g.cliente_nombre || '—')}</td>
      <td>${esc(g.producto_nombre || '—')}</td>
      <td>${fmtFechaCorta(g.fecha_compra)}</td>
      <td>${fmtFechaCorta(g.fecha_vencimiento)}</td>
      <td>${vigente ? '<span style="color:var(--success);font-weight:600">✅ Vigente</span>' : '<span style="color:var(--danger);font-weight:600">⚠️ Vencida</span>'}</td>
      <td><span class="status-badge ${g.origen==='automatica'?'status-activo':'status-pendiente'}">${g.origen==='automatica'?'Automática':'Manual'}</span></td>
    </tr>`;
  }).join('');
}

/* =====================================================
   NUEVA GARANTÍA (registro manual)
===================================================== */
STATE.clienteElegidoGarantia = null;
STATE.productoElegidoGarantia = null;

function abrirModalGarantia() {
  document.getElementById('gt-error').textContent = '';
  STATE.clienteElegidoGarantia = null;
  STATE.productoElegidoGarantia = null;
  document.getElementById('gt-cliente-id').value = '';
  document.getElementById('gt-producto-id').value = '';
  document.getElementById('gt-buscar-cliente').value = '';
  document.getElementById('gt-buscar-producto').value = '';
  document.getElementById('gt-cliente-resultados').innerHTML = '';
  document.getElementById('gt-producto-resultados').innerHTML = '';
  document.getElementById('gt-cliente-elegido').style.display = 'none';
  document.getElementById('gt-producto-elegido').style.display = 'none';
  document.getElementById('gt-fecha-compra').value = todayLocalISO();
  document.getElementById('gt-garantia-meses').value = '';
  document.getElementById('gt-observaciones').value = '';
  openModal('modal-garantia');
}

function buscarClienteGarantia(q) {
  const cont = document.getElementById('gt-cliente-resultados');
  q = q.trim().toLowerCase();
  if (!q) { cont.innerHTML = ''; return; }
  const resultados = STATE.clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 6);
  cont.innerHTML = resultados.map(c => `
    <div style="padding:6px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
         onclick="elegirClienteGarantia('${c.id}','${esc(c.nombre)}')">${esc(c.nombre)}</div>
  `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
}
function elegirClienteGarantia(id, nombre) {
  STATE.clienteElegidoGarantia = { id, nombre };
  document.getElementById('gt-cliente-id').value = id;
  document.getElementById('gt-buscar-cliente').value = '';
  document.getElementById('gt-cliente-resultados').innerHTML = '';
  const el = document.getElementById('gt-cliente-elegido');
  el.style.display = 'flex';
  el.innerHTML = `<span>👤 ${esc(nombre)}</span><button type="button" class="row-action-btn" onclick="quitarClienteGarantia()">✕</button>`;
}
function quitarClienteGarantia() {
  STATE.clienteElegidoGarantia = null;
  document.getElementById('gt-cliente-id').value = '';
  document.getElementById('gt-cliente-elegido').style.display = 'none';
}

function buscarProductoGarantia(q) {
  const cont = document.getElementById('gt-producto-resultados');
  q = q.trim().toLowerCase();
  if (!q) { cont.innerHTML = ''; return; }
  const resultados = STATE.productos.filter(p => p.nombre.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q)).slice(0, 6);
  cont.innerHTML = resultados.map(p => `
    <div style="padding:6px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
         onclick="elegirProductoGarantia('${p.id}','${esc(p.nombre)}')">${esc(p.nombre)}</div>
  `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
}
function elegirProductoGarantia(id, nombre) {
  STATE.productoElegidoGarantia = { id, nombre };
  document.getElementById('gt-producto-id').value = id;
  document.getElementById('gt-buscar-producto').value = '';
  document.getElementById('gt-producto-resultados').innerHTML = '';
  const el = document.getElementById('gt-producto-elegido');
  el.style.display = 'flex';
  el.innerHTML = `<span>📦 ${esc(nombre)}</span><button type="button" class="row-action-btn" onclick="quitarProductoGarantia()">✕</button>`;
}
function quitarProductoGarantia() {
  STATE.productoElegidoGarantia = null;
  document.getElementById('gt-producto-id').value = '';
  document.getElementById('gt-producto-elegido').style.display = 'none';
}

async function guardarGarantia() {
  const errEl = document.getElementById('gt-error');
  errEl.textContent = '';
  const fechaCompra = document.getElementById('gt-fecha-compra').value;
  const garantiaMeses = parseFloat(document.getElementById('gt-garantia-meses').value);
  const observaciones = document.getElementById('gt-observaciones').value.trim() || null;

  if (!fechaCompra) { errEl.textContent = 'La fecha de compra es obligatoria.'; return; }
  if (!garantiaMeses || garantiaMeses <= 0) { errEl.textContent = 'Los meses de garantía deben ser mayor a cero.'; return; }

  setBtnLoading('btn-guardar-garantia', true);
  try {
    const vencimiento = new Date(fechaCompra + 'T00:00:00');
    vencimiento.setMonth(vencimiento.getMonth() + garantiaMeses);
    const { data: numero } = await sb.rpc('generar_numero_garantia', { p_user_id: STATE.userId });

    const payload = {
      auth_user_id: STATE.userId, numero: numero || `GT-${Date.now()}`,
      cliente_id: STATE.clienteElegidoGarantia?.id || null, cliente_nombre: STATE.clienteElegidoGarantia?.nombre || null,
      producto_id: STATE.productoElegidoGarantia?.id || null, producto_nombre: STATE.productoElegidoGarantia?.nombre || null,
      venta_id: null, fecha_compra: fechaCompra, garantia_meses: garantiaMeses,
      fecha_vencimiento: ymdLocal(vencimiento), origen: 'manual', observaciones,
      usuario_nombre: STATE.currentUser?.nombre || 'Usuario',
    };

    const { error } = await sb.from('garantias_clientes').insert(payload);
    if (error) throw error;

    showToast('🛡️ Garantía registrada');
    closeModal('modal-garantia');
    await cargarGarantias();
  } catch (e) {
    console.error('guardarGarantia:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-guardar-garantia', false);
  }
}


/* ============================================================
   MODAL DE MONEDA DE VISUALIZACION -- agregado para que este
   modulo tambien pueda ver todo en otra moneda (nunca toca los
   datos reales, solo como se muestran).
   ============================================================ */
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
  const errEl = document.getElementById('mv-error');
  errEl.textContent = '';
  if (!elegida || elegida === oficial) {
    desactivarMonedaVisualizacion();
  } else {
    const tasa = parseFloat(document.getElementById('mv-tasa').value);
    if (!tasa || tasa <= 0) { errEl.textContent = 'Escribe tu tasa de cambio (cordobas por 1 dolar).'; return; }
    activarMonedaVisualizacion(elegida, tasa);
  }
  location.reload();
}
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const btn = document.getElementById('btn-moneda-vis-texto');
    if (btn) btn.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda);
  }, 800);
});
