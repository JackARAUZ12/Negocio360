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
    if (STATE.empresaConfig?.usa_modulo_farmacia !== true && STATE.empresaConfig?.usa_modulo_veterinaria !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarLotes();
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
   LOTES -- todos los lotes de todos los productos, en un
   solo lugar, con busqueda y edicion inline.
===================================================== */
async function cargarLotes() {
  const tbody = document.getElementById('lt-tbody');
  try {
    let consulta = sb.from('producto_lotes').select('*, productos(nombre)')
      .eq('auth_user_id', STATE.userId).eq('activo', true);
    if (!STATE.verAgotados) consulta = consulta.gt('cantidad_actual', 0);     // por defecto: solo lotes con unidades (como siempre)
    const { data, error } = await consulta.order('fecha_vencimiento', { ascending: true });
    if (error) throw error;
    STATE.lotes = data || [];
    STATE.agotadosCount = 0;
    if (!STATE.verAgotados && !STATE.lotes.length) {
      try {
        const { count } = await sb.from('producto_lotes').select('id', { count: 'exact', head: true })
          .eq('auth_user_id', STATE.userId).eq('activo', true).lte('cantidad_actual', 0);
        STATE.agotadosCount = count || 0;
      } catch (_) { /* solo afecta al texto del mensaje */ }
    }
    STATE.filtrados = STATE.lotes;
    renderLotes();
  } catch (e) {
    console.error('cargarLotes:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudieron cargar los lotes.</td></tr>';
  }
}

function alternarAgotados(valor) { STATE.verAgotados = !!valor; cargarLotes(); }

function filtrarLotes() {
  const q = (document.getElementById('lt-buscar')?.value || '').trim().toLowerCase();
  STATE.filtrados = !q ? STATE.lotes : STATE.lotes.filter(l =>
    (l.productos?.nombre || '').toLowerCase().includes(q) || (l.numero_lote || '').toLowerCase().includes(q)
  );
  renderLotes();
}

function renderLotes() {
  const tbody = document.getElementById('lt-tbody');
  const pie = document.getElementById('lt-pie');
  const lista = STATE.filtrados || [];
  if (pie) pie.textContent = `${lista.length} lote${lista.length === 1 ? '' : 's'}`;
  actualizarKpisLotes();
  if (!tbody) return;

  if (!lista.length) {
    const n = STATE.agotadosCount || 0;
    if ((STATE.lotes || []).length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Ningún lote coincide con la búsqueda.</td></tr>'; return; }
    if (n) {
      const plural = (a, b) => n === 1 ? a : b;
    const hint = ' Si te quedan unidades SIN lote, asígnalas a uno (con su vencimiento) en Productos/Servicios → editar el producto → «Asignar este stock a un lote».';
      const mensaje = `No hay lotes con unidades disponibles. Tienes ${n} lote${plural('', 's')} agotado${plural('', 's')} (sin unidades): marca «Mostrar lotes agotados» para verlo${plural('', 's')}.` + hint;
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">' + mensaje + '</td></tr>'; return;
    }
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Sin lotes registrados todavía -- se agregan al comprar un producto desde Compras, o desde el detalle de un producto en Productos/Servicios.</td></tr>';
    return;
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  tbody.innerHTML = lista.map(l => {
    const venc = new Date(l.fecha_vencimiento + 'T00:00:00');
    const dias = Math.round((venc - hoy) / 86400000);
    const agotado = Number(l.cantidad_actual) <= 0;
    let color = 'var(--text-primary)', etiqueta = '';
    if (agotado) { color = 'var(--text-muted)'; }                      // sin unidades: nada que vigilar
    else if (dias < 0) { color = 'var(--danger,#dc2626)'; etiqueta = ' — ¡vencido!'; }
    else if (dias <= 30) { color = '#f59e0b'; etiqueta = ` — vence en ${dias} día${dias===1?'':'s'}`; }
    return `
      <tr data-lote-id="${l.id}"${agotado ? ' style="opacity:.65"' : ''}>
        <td class="lt-celda-numero"><strong>${l.numero_lote ? esc(l.numero_lote) : '<span style="color:var(--text-muted);font-weight:400">Sin número</span>'}</strong></td>
        <td>${esc(l.productos?.nombre || 'Producto eliminado')}</td>
        <td>${fmtNumLote(l.cantidad_actual)}${agotado ? ' <span style="font-size:11px;font-weight:700;color:var(--text-muted)">· agotado</span>' : ''}</td>
        <td class="lt-celda-venc" style="color:${color};font-weight:600">${l.fecha_vencimiento}${etiqueta}</td>
        <td>
          <button class="btn-accion-tabla btn-ghost" onclick="abrirEdicionLoteInline('${l.id}')">✏️ Editar</button>
          <button class="btn-accion-tabla btn-ghost" onclick="abrirTrazabilidadLote('${l.id}')">🔍 Trazabilidad</button>
          ${agotado ? '' : `<button class="btn-accion-tabla btn-ghost" onclick="abrirDevolucionProveedor('${l.id}')">↩️ Devolver a proveedor</button>`}
        </td>
      </tr>`;
  }).join('');
}

function actualizarKpisLotes() {
  const lista = (STATE.lotes || []).filter(l => Number(l.cantidad_actual) > 0);      // los indicadores cuentan solo lotes con unidades
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  let vencidos = 0, porVencer = 0, vigentes = 0;
  lista.forEach(l => {
    const dias = Math.round((new Date(l.fecha_vencimiento + 'T00:00:00') - hoy) / 86400000);
    if (dias < 0) vencidos++;
    else if (dias <= 30) porVencer++;
    else vigentes++;
  });
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('lt-kpi-total', lista.length);
  set('lt-kpi-vencidos', vencidos);
  set('lt-kpi-porvencer', porVencer);
  set('lt-kpi-vigentes', vigentes);
}

function fmtNumLote(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }

function abrirEdicionLoteInline(loteId) {
  const l = STATE.lotes.find(x => x.id === loteId);
  if (!l) return;
  const fila = document.querySelector(`tr[data-lote-id="${loteId}"]`);
  if (!fila) return;
  fila.querySelector('.lt-celda-numero').innerHTML = `<input type="text" id="editNum_${loteId}" value="${esc(l.numero_lote || '')}" style="width:100%;padding:4px 6px;border-radius:6px;border:1px solid var(--border,#e5e7eb)"/>`;
  fila.querySelector('.lt-celda-venc').innerHTML = `<input type="date" id="editVenc_${loteId}" value="${l.fecha_vencimiento}" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border,#e5e7eb)"/>`;
  const celdaAcciones = fila.children[4];
  celdaAcciones.innerHTML = `
    <button class="btn-accion-tabla btn-primary" onclick="guardarEdicionLoteInline('${loteId}')">Guardar</button>
    <button class="btn-accion-tabla btn-ghost" onclick="renderLotes()">Cancelar</button>`;
}

async function guardarEdicionLoteInline(loteId) {
  const numero = (document.getElementById(`editNum_${loteId}`)?.value || '').trim();
  const vencimiento = document.getElementById(`editVenc_${loteId}`)?.value || '';
  if (!vencimiento) { showToast('La fecha de vencimiento es obligatoria.', 'error'); return; }
  try {
    const { error } = await sb.from('producto_lotes')
      .update({ numero_lote: numero || null, fecha_vencimiento: vencimiento, updated_at: new Date().toISOString() })
      .eq('id', loteId);
    if (error) throw error;
    showToast('Lote actualizado correctamente.', 'success');
    await cargarLotes();
  } catch (e) {
    console.error('guardarEdicionLoteInline:', e);
    showToast('No se pudo guardar. Intenta de nuevo.', 'error');
  }
}

/* =====================================================
   TRAZABILIDAD POR LOTE -- de que compra salio, y en que
   ventas termino. Reutiliza compra_id (ya en producto_lotes)
   y lote_id (ya en venta_detalles, agregado para FEFO).
===================================================== */
async function abrirTrazabilidadLote(loteId) {
  const cont = document.getElementById('trazabilidad-contenido');
  cont.innerHTML = '<p style="color:var(--text-muted)">Cargando…</p>';
  openModal('modal-trazabilidad');
  try {
    const { data: lote, error } = await sb.from('producto_lotes')
      .select('*, productos(nombre)').eq('id', loteId).eq('auth_user_id', STATE.userId).maybeSingle();
    if (error) throw error;
    if (!lote) { cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se encontró el lote.</p>'; return; }

    let htmlCompra = '<p style="color:var(--text-muted);font-size:12.5px">Este lote no tiene una compra de origen registrada.</p>';
    if (lote.compra_id) {
      const { data: compra } = await sb.from('compras')
        .select('numero, proveedor_nombre, fecha, total').eq('id', lote.compra_id).maybeSingle();
      if (compra) {
        htmlCompra = `<div style="background:var(--bg-app,#f8fafc);border-radius:8px;padding:10px 12px">
          <div style="font-weight:700;font-size:13px">Compra #${esc(compra.numero || '—')}</div>
          <div style="font-size:12px;color:var(--text-muted)">${esc(compra.proveedor_nombre || 'Sin proveedor')} · ${compra.fecha} · ${fmt(compra.total)}</div>
        </div>`;
      }
    }

    const { data: detalles } = await sb.from('venta_detalles')
      .select('cantidad, ventas(numero_venta, fecha, cliente_nombre)').eq('lote_id', loteId);
    const ventasHtml = (detalles && detalles.length)
      ? detalles.map(d => `<div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--bg-app,#f8fafc);border-radius:8px;margin-bottom:5px;font-size:12.5px">
          <span>Venta #${esc(d.ventas?.numero_venta || '—')} · ${d.ventas?.fecha || ''} · ${esc(d.ventas?.cliente_nombre || 'Sin cliente')}</span>
          <strong>${fmtNumLote(d.cantidad)} u.</strong>
        </div>`).join('')
      : '<p style="color:var(--text-muted);font-size:12.5px">Este lote todavía no se ha vendido.</p>';

    cont.innerHTML = `
      <div style="margin-bottom:14px">
        <div style="font-weight:700;font-size:14px">${esc(lote.productos?.nombre || 'Producto')} — Lote ${esc(lote.numero_lote || 'sin número')}</div>
        <div style="font-size:12px;color:var(--text-muted)">Cantidad inicial: ${fmtNumLote(lote.cantidad_inicial)} · Actual: ${fmtNumLote(lote.cantidad_actual)} · Vence: ${lote.fecha_vencimiento}</div>
      </div>
      <div style="font-weight:600;font-size:12.5px;margin-bottom:6px">📥 De dónde salió</div>
      ${htmlCompra}
      <div style="font-weight:600;font-size:12.5px;margin:14px 0 6px">📤 En qué ventas terminó</div>
      ${ventasHtml}
    `;
  } catch (e) {
    console.error('abrirTrazabilidadLote:', e);
    cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar la trazabilidad.</p>';
  }
}

function cerrarTrazabilidadLote() {
  closeModal('modal-trazabilidad');
}

function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* =====================================================
   DEVOLUCION A PROVEEDOR -- cuando un lote esta vencido o
   defectuoso. Descuenta el lote y el stock general, y deja
   registro con motivo para consultar despues.
===================================================== */
let _loteDevolucionActual = null;

async function abrirDevolucionProveedor(loteId) {
  document.getElementById('dev-error').textContent = '';
  document.getElementById('dev-cantidad').value = '';
  document.getElementById('dev-motivo').value = '';
  document.getElementById('dev-info').textContent = 'Cargando…';
  openModal('modal-devolucion');
  try {
    const { data: lote, error } = await sb.from('producto_lotes')
      .select('*, productos(nombre)').eq('id', loteId).eq('auth_user_id', STATE.userId).maybeSingle();
    if (error) throw error;
    if (!lote) { document.getElementById('dev-info').textContent = 'No se encontró el lote.'; return; }

    let proveedorNombre = null;
    if (lote.compra_id) {
      const { data: compra } = await sb.from('compras').select('proveedor_nombre').eq('id', lote.compra_id).maybeSingle();
      proveedorNombre = compra?.proveedor_nombre || null;
    }

    _loteDevolucionActual = { ...lote, proveedor_nombre: proveedorNombre };
    document.getElementById('dev-info').textContent =
      `${lote.productos?.nombre || 'Producto'} — Lote ${lote.numero_lote || 'sin número'} · Disponible: ${fmtNumLote(lote.cantidad_actual)}${proveedorNombre ? ' · Proveedor: ' + proveedorNombre : ''}`;
    document.getElementById('dev-cantidad').max = lote.cantidad_actual;
  } catch (e) {
    console.error('abrirDevolucionProveedor:', e);
    document.getElementById('dev-info').textContent = 'No se pudo cargar el lote.';
  }
}

function cerrarDevolucionProveedor() {
  closeModal('modal-devolucion');
  _loteDevolucionActual = null;
}

async function guardarDevolucionProveedor() {
  const errEl = document.getElementById('dev-error');
  errEl.textContent = '';
  if (!_loteDevolucionActual) return;

  const cantidad = parseFloat(document.getElementById('dev-cantidad').value);
  const motivo = document.getElementById('dev-motivo').value.trim() || null;
  const lote = _loteDevolucionActual;

  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad debe ser mayor que 0.'; return; }
  if (cantidad > Number(lote.cantidad_actual)) { errEl.textContent = `No puedes devolver más de lo disponible en el lote (${fmtNumLote(lote.cantidad_actual)}).`; return; }

  document.getElementById('btn-guardar-devolucion').disabled = true;
  try {
    // 1) Descontar del lote
    const { error: errLote } = await sb.from('producto_lotes')
      .update({ cantidad_actual: round2(Number(lote.cantidad_actual) - cantidad) })
      .eq('id', lote.id).eq('auth_user_id', STATE.userId);
    if (errLote) throw errLote;

    // 2) Descontar del stock general del producto
    const { data: prod } = await sb.from('productos').select('stock_actual').eq('id', lote.producto_id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (prod) {
      await sb.from('productos').update({ stock_actual: Math.max(0, round2(Number(prod.stock_actual || 0) - cantidad)) })
        .eq('id', lote.producto_id).eq('auth_user_id', STATE.userId);
    }

    // 3) Dejar registro
    const { error: errReg } = await sb.from('devoluciones_proveedor').insert({
      auth_user_id: STATE.userId, lote_id: lote.id, producto_id: lote.producto_id,
      producto_nombre: lote.productos?.nombre || 'Producto', proveedor_nombre: lote.proveedor_nombre,
      cantidad, motivo, fecha: todayISO(),
    });
    if (errReg) throw errReg;

    showToast('Devolución registrada correctamente.');
    cerrarDevolucionProveedor();
    await cargarLotes();
  } catch (e) {
    console.error('guardarDevolucionProveedor:', e);
    errEl.textContent = 'No se pudo registrar la devolución. Intenta de nuevo.';
  } finally {
    document.getElementById('btn-guardar-devolucion').disabled = false;
  }
}
