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
    if (STATE.empresaConfig?.usa_puntos !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarPuntos();
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
   PROGRAMA DE PUNTOS -- fase 1: reglas, saldos por cliente,
   ajuste manual e historial. Los puntos NUNCA se escriben
   directo desde aqui: todo pasa por funciones de la base de
   datos (puntos_ajustar_manual), que validan dueno y saldo.
===================================================== */
const PT = { config: null, tieneReglas: false, clientes: [], filtrados: [], clienteActual: null, recompensas: [], recEdit: null, recProducto: null };
const $pt = id => document.getElementById(id);
function fmtPts(n) { return Number(n || 0).toLocaleString('es-NI'); }

// Trae TODAS las filas de una consulta, de a 1000 (limite de la API),
// para no truncar en silencio si el negocio tiene muchos clientes.
async function traerTodo(construir) {
  const tam = 1000; let desde = 0, todo = [];
  while (true) {
    const { data, error } = await construir().range(desde, desde + tam - 1);
    if (error) throw error;
    todo = todo.concat(data || []);
    if (!data || data.length < tam) break;
    desde += tam;
    if (desde > 50000) break; // tope de seguridad
  }
  return todo;
}

async function cargarPuntos() {
  try {
    await Promise.all([cargarReglas(), cargarClientesPuntos(), cargarRecompensas()]);
  } catch (e) {
    console.error('cargarPuntos:', e);
    const tb = $pt('pt-tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudo cargar el programa de puntos.</td></tr>';
  }
}

/* ---------- Reglas ---------- */
async function cargarReglas() {
  const { data, error } = await sb.from('puntos_configuracion').select('*').eq('auth_user_id', STATE.userId).maybeSingle();
  if (error) throw error;
  PT.tieneReglas = !!data;
  PT.config = data || { monto_base: 100, puntos_ganados: 1, incluir_iva: false, minimo_canje: 0, maximo_por_venta: null, vencimiento_meses: null };
  $pt('pt-monto-base').value = PT.config.monto_base;
  $pt('pt-puntos-ganados').value = PT.config.puntos_ganados;
  $pt('pt-minimo-canje').value = PT.config.minimo_canje || 0;
  $pt('pt-maximo-venta').value = PT.config.maximo_por_venta ?? '';
  $pt('pt-vencimiento').value = PT.config.vencimiento_meses ?? '';
  $pt('pt-incluir-iva').checked = PT.config.incluir_iva === true;
  actualizarResumenReglas();
  pintarEstadoPrograma();
}

// Deja claro si el programa esta REALMENTE acumulando: sin reglas guardadas, no suma nada.
function pintarEstadoPrograma() {
  const el = $pt('pt-estado');
  if (!el) return;
  el.style.display = '';
  if (PT.tieneReglas) {
    el.className = 'pt-estado pt-estado-ok';
    el.textContent = '✅ Programa en marcha: las ventas a clientes registrados ya acumulan puntos con estas reglas.';
  } else {
    el.className = 'pt-estado pt-estado-warn';
    el.textContent = '⚠️ Todavía no has guardado las reglas: los puntos NO se acumulan hasta que presiones "Guardar reglas".';
  }
}

function actualizarResumenReglas() {
  const base = parseFloat($pt('pt-monto-base').value);
  const pts = Number($pt('pt-puntos-ganados').value);
  const r = $pt('pt-resumen');
  if (!(base > 0) || !Number.isInteger(pts) || pts < 1) { r.textContent = 'Indica el monto y los puntos para ver cómo funcionará el programa.'; return; }
  r.innerHTML = `Por cada <strong>${esc(fmt(base))}</strong> de compra, el cliente gana <strong>${fmtPts(pts)} punto${pts === 1 ? '' : 's'}</strong>. `
    + `Ejemplo: una compra de ${esc(fmt(base * 10))} = ${fmtPts(pts * 10)} puntos. `
    + `Lo que sobre y no complete un bloque no suma.`;
}

async function guardarReglasPuntos() {
  const msg = $pt('pt-config-msg');
  const fallo = t => { msg.style.color = 'var(--danger,#dc2626)'; msg.textContent = t; };
  msg.textContent = '';

  const base = parseFloat($pt('pt-monto-base').value);
  const pts = Number($pt('pt-puntos-ganados').value);
  const minimo = $pt('pt-minimo-canje').value === '' ? 0 : Number($pt('pt-minimo-canje').value);
  const maxRaw = $pt('pt-maximo-venta').value.trim();
  const venRaw = $pt('pt-vencimiento').value.trim();

  if (!(base > 0)) return fallo('El monto debe ser mayor que 0.');
  if (!Number.isInteger(pts) || pts < 1) return fallo('Los puntos que gana el cliente deben ser un número entero, mínimo 1.');
  if (!Number.isInteger(minimo) || minimo < 0) return fallo('El mínimo para canjear debe ser un número entero, 0 o más.');
  if (maxRaw !== '' && (!Number.isInteger(Number(maxRaw)) || Number(maxRaw) < 1)) return fallo('El máximo por venta debe ser un entero mayor que 0, o déjalo vacío.');
  if (venRaw !== '' && (!Number.isInteger(Number(venRaw)) || Number(venRaw) < 1)) return fallo('El vencimiento debe ser un número entero de meses, o déjalo vacío.');

  const btn = $pt('pt-btn-guardar'); btn.disabled = true;
  try {
    const { error } = await sb.from('puntos_configuracion').upsert({
      auth_user_id: STATE.userId, monto_base: base, puntos_ganados: pts,
      incluir_iva: $pt('pt-incluir-iva').checked, minimo_canje: minimo,
      maximo_por_venta: maxRaw === '' ? null : parseInt(maxRaw, 10),
      vencimiento_meses: venRaw === '' ? null : parseInt(venRaw, 10),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    if (error) throw error;
    msg.style.color = 'var(--success,#16a34a)'; msg.textContent = '✓ Reglas guardadas.';
    PT.tieneReglas = true; pintarEstadoPrograma();
    showToast('Reglas del programa guardadas.');
  } catch (e) {
    console.error('guardarReglasPuntos:', e);
    fallo('No se pudieron guardar las reglas. Intenta de nuevo.');
  } finally { btn.disabled = false; }
}

/* ---------- Clientes y saldos ---------- */
async function cargarClientesPuntos() {
  const clientes = await traerTodo(() => sb.from('clientes')
    .select('id, nombre, apellido, telefono, whatsapp, activo').eq('auth_user_id', STATE.userId).order('id'));
  const saldos = await traerTodo(() => sb.from('puntos_saldos')
    .select('cliente_id, saldo, total_ganado, total_canjeado').eq('auth_user_id', STATE.userId).order('cliente_id'));

  const mapa = {};
  saldos.forEach(s => { mapa[s.cliente_id] = s; });
  PT.clientes = clientes.filter(c => c.activo !== false).map(c => {
    const s = mapa[c.id];
    return {
      id: c.id, nombre: `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Sin nombre',
      telefono: c.telefono || c.whatsapp || '',
      saldo: s ? s.saldo : 0, ganado: s ? s.total_ganado : 0, canjeado: s ? s.total_canjeado : 0,
    };
  }).sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, 'es'));

  // KPIs sobre TODOS los saldos (incluidos clientes ya inactivos).
  $pt('pt-kpi-clientes').textContent = fmtPts(saldos.filter(s => s.saldo > 0).length);
  $pt('pt-kpi-circulacion').textContent = fmtPts(saldos.reduce((t, s) => t + Math.max(0, s.saldo), 0));
  $pt('pt-kpi-ganados').textContent = fmtPts(saldos.reduce((t, s) => t + s.total_ganado, 0));
  $pt('pt-kpi-canjeados').textContent = fmtPts(saldos.reduce((t, s) => t + s.total_canjeado, 0));
  filtrarClientesPuntos();
}

function filtrarClientesPuntos() {
  const q = ($pt('pt-buscar')?.value || '').trim().toLowerCase();
  const soloPuntos = $pt('pt-filtro')?.value === 'con_puntos';
  PT.filtrados = PT.clientes.filter(c =>
    (!soloPuntos || c.saldo > 0) &&
    (!q || c.nombre.toLowerCase().includes(q) || c.telefono.toLowerCase().includes(q)));
  renderClientesPuntos();
}

function renderClientesPuntos() {
  const tbody = $pt('pt-tbody');
  const lista = PT.filtrados;
  const LIMITE = 200;
  $pt('pt-pie').textContent = lista.length > LIMITE
    ? `Mostrando ${LIMITE} de ${lista.length} clientes -- usa el buscador para encontrar a alguien.`
    : `${lista.length} cliente${lista.length === 1 ? '' : 's'}`;
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">No hay clientes para mostrar.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.slice(0, LIMITE).map(c => `
    <tr>
      <td><strong>${esc(c.nombre)}</strong></td>
      <td class="pt-hide-m">${c.telefono ? esc(c.telefono) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="pt-saldo">${fmtPts(c.saldo)}</td>
      <td class="pt-hide-m">${fmtPts(c.ganado)}</td>
      <td class="pt-hide-m">${fmtPts(c.canjeado)}</td>
      <td style="white-space:nowrap">
        <button class="btn-accion-tabla btn-ghost" onclick="abrirAjustePuntos('${c.id}')" title="Sumar o restar puntos">⭐ Ajustar</button>
        <button class="btn-accion-tabla btn-ghost" onclick="abrirHistorialPuntos('${c.id}')" title="Ver historial">📜</button>
      </td>
    </tr>`).join('');
}

/* ---------- Ajuste manual ---------- */
function abrirAjustePuntos(clienteId) {
  const c = PT.clientes.find(x => x.id === clienteId);
  if (!c) return;
  PT.clienteActual = c;
  $pt('aj-info').textContent = `${c.nombre} — saldo actual: ${fmtPts(c.saldo)} puntos`;
  $pt('aj-tipo').value = 'sumar';
  $pt('aj-puntos').value = '';
  $pt('aj-nota').value = '';
  $pt('aj-error').textContent = '';
  openModal('modal-ajuste-puntos');
}
function cerrarAjustePuntos() { closeModal('modal-ajuste-puntos'); PT.clienteActual = null; }

async function guardarAjustePuntos() {
  const c = PT.clienteActual; if (!c) return;
  const err = $pt('aj-error'); err.textContent = '';
  let pts = Number($pt('aj-puntos').value);
  if (!Number.isInteger(pts) || pts <= 0) { err.textContent = 'Indica una cantidad entera mayor que 0.'; return; }
  if ($pt('aj-tipo').value === 'restar') pts = -pts;

  const btn = $pt('aj-btn-guardar'); btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('puntos_ajustar_manual', { p_cliente_id: c.id, p_puntos: pts, p_nota: $pt('aj-nota').value });
    if (error) throw error;
    if (!data?.ok) { err.textContent = data?.mensaje || 'No se pudo aplicar el ajuste.'; return; }
    showToast('Puntos actualizados.');
    cerrarAjustePuntos();
    await cargarClientesPuntos();
  } catch (e) {
    console.error('guardarAjustePuntos:', e);
    err.textContent = 'No se pudo aplicar el ajuste. Intenta de nuevo.';
  } finally { btn.disabled = false; }
}

/* ---------- Historial ---------- */
const PT_TIPO_LABEL = { acumulacion: '🛒 Compra', canje: '🎉 Canje', ajuste: '⭐ Ajuste manual', vencimiento: '⏳ Vencimiento', reversion: '↩️ Reversión', devolucion_canje: '↩️ Puntos devueltos' };

async function abrirHistorialPuntos(clienteId) {
  const c = PT.clientes.find(x => x.id === clienteId);
  const cont = $pt('hist-contenido');
  cont.innerHTML = '<p style="color:var(--text-muted)">Cargando…</p>';
  openModal('modal-historial-puntos');
  try {
    const { data, error } = await sb.from('puntos_movimientos')
      .select('tipo, puntos, nota, created_at').eq('auth_user_id', STATE.userId).eq('cliente_id', clienteId)
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const cab = `<div style="margin-bottom:12px"><div style="font-weight:800;font-size:14px">${esc(c?.nombre || 'Cliente')}</div>
      <div style="font-size:12px;color:var(--text-muted)">Saldo actual: <strong>${fmtPts(c?.saldo)}</strong> puntos</div></div>`;
    if (!data || !data.length) { cont.innerHTML = cab + '<p style="color:var(--text-muted);font-size:13px">Este cliente todavía no tiene movimientos de puntos.</p>'; return; }
    cont.innerHTML = cab + data.map(m => `
      <div class="pt-mov">
        <div>
          <div style="font-weight:600">${PT_TIPO_LABEL[m.tipo] || esc(m.tipo)}${m.nota ? ` — ${esc(m.nota)}` : ''}</div>
          <div style="color:var(--text-muted);font-size:11.5px">${new Date(m.created_at).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        </div>
        <span class="${m.puntos > 0 ? 'pt-mov-pos' : 'pt-mov-neg'}">${m.puntos > 0 ? '+' : ''}${fmtPts(m.puntos)}</span>
      </div>`).join('');
  } catch (e) {
    console.error('abrirHistorialPuntos:', e);
    cont.innerHTML = '<p style="color:var(--danger,#dc2626)">No se pudo cargar el historial.</p>';
  }
}
function cerrarHistorialPuntos() { closeModal('modal-historial-puntos'); }


/* =====================================================
   CATALOGO DE RECOMPENSAS -- lo que el cliente obtiene a
   cambio de sus puntos. El canje real ocurre en Ventas y lo
   valida la base de datos (puntos, stock, vigencia).
===================================================== */
const REC_TIPO_LABEL = { descuento_monto: '💵 Descuento en dinero', descuento_porcentaje: '🏷️ Descuento en %', producto_gratis: '🎁 Producto gratis' };

function descripcionRecompensa(r) {
  if (r.tipo === 'descuento_monto') return `${fmt(r.valor)} de descuento en la compra`;
  if (r.tipo === 'descuento_porcentaje') return `${Number(r.valor)}% de descuento en la compra`;
  return `Producto gratis: ${r.producto_nombre || '(producto eliminado)'}`;
}

async function cargarRecompensas() {
  const { data, error } = await sb.from('puntos_recompensas').select('*').eq('auth_user_id', STATE.userId).order('costo_puntos', { ascending: true });
  if (error) throw error;
  const lista = data || [];
  // Nombre del producto de las recompensas "producto gratis" (una sola consulta)
  const ids = [...new Set(lista.filter(r => r.producto_id).map(r => r.producto_id))];
  if (ids.length) {
    const { data: prods } = await sb.from('productos').select('id, nombre').in('id', ids);
    const mapa = {}; (prods || []).forEach(p => { mapa[p.id] = p.nombre; });
    lista.forEach(r => { r.producto_nombre = mapa[r.producto_id] || null; });
  }
  PT.recompensas = lista;
  renderRecompensas();
}

function renderRecompensas() {
  const cont = $pt('pt-recompensas');
  if (!cont) return;
  if (!PT.recompensas.length) {
    cont.innerHTML = '<p style="color:var(--text-muted);font-size:13px;grid-column:1/-1">Todavía no has creado recompensas. Crea la primera con "+ Nueva recompensa" (por ejemplo: "C$50 de descuento" por 500 puntos).</p>';
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  cont.innerHTML = PT.recompensas.map(r => {
    const vencida = r.vigente_hasta && r.vigente_hasta < hoy;
    const agotada = r.stock_disponible !== null && r.stock_disponible <= 0;
    const chips = [];
    if (!r.activa) chips.push('⏸️ Desactivada');
    if (vencida) chips.push('⌛ Vencida');
    if (agotada) chips.push('📭 Agotada');
    if (r.stock_disponible !== null && !agotada) chips.push(`📦 Quedan ${fmtPts(r.stock_disponible)}`);
    if (r.vigente_hasta && !vencida) chips.push(`📅 Hasta ${r.vigente_hasta}`);
    chips.push(`🔁 Canjeada ${fmtPts(r.veces_canjeada)} ${r.veces_canjeada === 1 ? 'vez' : 'veces'}`);
    return `
      <div class="pt-rec ${r.activa ? '' : 'pt-rec-off'}">
        <div class="pt-rec-nombre">${esc(r.nombre)}</div>
        <div class="pt-rec-desc">${esc(descripcionRecompensa(r))}</div>
        <div class="pt-rec-costo">${fmtPts(r.costo_puntos)} puntos</div>
        <div class="pt-chips">${chips.map(c => `<span class="pt-chip">${esc(c)}</span>`).join('')}</div>
        <div class="pt-rec-acciones">
          <button class="btn-accion-tabla btn-ghost" onclick="abrirRecompensa('${r.id}')">✏️ Editar</button>
          <button class="btn-accion-tabla btn-ghost" onclick="toggleRecompensa('${r.id}')">${r.activa ? '⏸️ Desactivar' : '▶️ Activar'}</button>
          <button class="btn-accion-tabla btn-ghost" onclick="eliminarRecompensa('${r.id}')">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

function cambiarTipoRecompensa() {
  const tipo = $pt('rc-tipo').value;
  $pt('rc-wrap-valor').style.display = tipo === 'producto_gratis' ? 'none' : '';
  $pt('rc-wrap-producto').style.display = tipo === 'producto_gratis' ? '' : 'none';
  $pt('rc-valor-label').textContent = tipo === 'descuento_porcentaje' ? 'Porcentaje de descuento (1 a 100) *' : 'Monto del descuento *';
  $pt('rc-valor').max = tipo === 'descuento_porcentaje' ? '100' : '';
}

function elegirProductoRecompensa(id, nombre) {
  PT.recProducto = { id, nombre };
  $pt('rc-producto-resultados').style.display = 'none';
  $pt('rc-producto-buscar').value = '';
  const el = $pt('rc-producto-elegido');
  el.textContent = '🎁 ' + nombre; el.style.display = '';
}

let _timerProdRec = null;
function buscarProductoRecompensa(q) {
  clearTimeout(_timerProdRec);
  const cont = $pt('rc-producto-resultados');
  q = (q || '').trim();
  if (q.length < 2) { cont.style.display = 'none'; return; }
  _timerProdRec = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('productos').select('id, nombre')
        .eq('auth_user_id', STATE.userId).eq('activo', true).eq('tipo', 'producto')
        .or('es_sustancia_controlada.is.null,es_sustancia_controlada.eq.false')
        .ilike('nombre', `%${q}%`).order('nombre').limit(8);
      if (error) throw error;
      cont.innerHTML = (data && data.length)
        ? data.map(p => `<div class="pt-resultado" data-id="${p.id}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)}</div>`).join('')
        : '<div class="pt-resultado" style="cursor:default;color:var(--text-muted)">Sin resultados</div>';
      cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => elegirProductoRecompensa(el.dataset.id, el.dataset.nombre)));
      cont.style.display = '';
    } catch (e) { console.error('buscarProductoRecompensa:', e); }
  }, 250);
}

function abrirRecompensa(id) {
  const r = id ? PT.recompensas.find(x => x.id === id) : null;
  PT.recEdit = r || null;
  PT.recProducto = r && r.producto_id ? { id: r.producto_id, nombre: r.producto_nombre || 'Producto' } : null;
  $pt('rc-titulo').textContent = r ? '✏️ Editar recompensa' : '🎉 Nueva recompensa';
  $pt('rc-nombre').value = r ? r.nombre : '';
  $pt('rc-tipo').value = r ? r.tipo : 'descuento_monto';
  $pt('rc-valor').value = r && r.valor != null ? r.valor : '';
  $pt('rc-costo').value = r ? r.costo_puntos : '';
  $pt('rc-stock').value = r && r.stock_disponible !== null ? r.stock_disponible : '';
  $pt('rc-vigencia').value = r && r.vigente_hasta ? r.vigente_hasta : '';
  $pt('rc-error').textContent = '';
  $pt('rc-producto-buscar').value = '';
  $pt('rc-producto-resultados').style.display = 'none';
  const el = $pt('rc-producto-elegido');
  if (PT.recProducto) { el.textContent = '🎁 ' + PT.recProducto.nombre; el.style.display = ''; } else { el.style.display = 'none'; }
  cambiarTipoRecompensa();
  openModal('modal-recompensa');
}
function cerrarRecompensa() { closeModal('modal-recompensa'); PT.recEdit = null; }

async function guardarRecompensa() {
  const err = $pt('rc-error'); err.textContent = '';
  const fallo = t => { err.textContent = t; };
  const nombre = $pt('rc-nombre').value.trim();
  const tipo = $pt('rc-tipo').value;
  const costo = Number($pt('rc-costo').value);
  const valorRaw = $pt('rc-valor').value;
  const stockRaw = $pt('rc-stock').value.trim();
  const vigencia = $pt('rc-vigencia').value || null;

  if (!nombre) return fallo('Ponle un nombre a la recompensa.');
  if (!Number.isInteger(costo) || costo < 1) return fallo('El costo en puntos debe ser un número entero, mínimo 1.');
  let valor = null, productoId = null;
  if (tipo === 'producto_gratis') {
    if (!PT.recProducto) return fallo('Elige el producto que se regala.');
    productoId = PT.recProducto.id;
  } else {
    valor = Number(valorRaw);
    if (!(valor > 0)) return fallo('Indica el valor del descuento (mayor que 0).');
    if (tipo === 'descuento_porcentaje' && valor > 100) return fallo('El porcentaje no puede ser mayor a 100.');
  }
  if (stockRaw !== '' && (!Number.isInteger(Number(stockRaw)) || Number(stockRaw) < 0)) return fallo('La cantidad disponible debe ser un entero (0 o más), o déjala vacía.');
  if (vigencia && !PT.recEdit && vigencia < new Date().toISOString().slice(0, 10)) return fallo('La fecha de vigencia ya pasó.');

  const payload = { nombre, tipo, valor, producto_id: productoId, costo_puntos: costo,
    stock_disponible: stockRaw === '' ? null : parseInt(stockRaw, 10), vigente_hasta: vigencia };
  const btn = $pt('rc-btn-guardar'); btn.disabled = true;
  try {
    const q = PT.recEdit
      ? sb.from('puntos_recompensas').update(payload).eq('id', PT.recEdit.id).eq('auth_user_id', STATE.userId)
      : sb.from('puntos_recompensas').insert({ ...payload, auth_user_id: STATE.userId });
    const { error } = await q;
    if (error) throw error;
    showToast(PT.recEdit ? 'Recompensa actualizada.' : 'Recompensa creada.');
    cerrarRecompensa();
    await cargarRecompensas();
  } catch (e) {
    console.error('guardarRecompensa:', e);
    fallo('No se pudo guardar la recompensa. Intenta de nuevo.');
  } finally { btn.disabled = false; }
}

async function toggleRecompensa(id) {
  const r = PT.recompensas.find(x => x.id === id); if (!r) return;
  try {
    const { error } = await sb.from('puntos_recompensas').update({ activa: !r.activa }).eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast(r.activa ? 'Recompensa desactivada.' : 'Recompensa activada.');
    await cargarRecompensas();
  } catch (e) { console.error('toggleRecompensa:', e); showToast('No se pudo cambiar el estado.', 'error'); }
}

async function eliminarRecompensa(id) {
  const r = PT.recompensas.find(x => x.id === id); if (!r) return;
  if (r.veces_canjeada > 0) { showToast('Ya fue canjeada: desactívala en vez de eliminarla, así se conserva el historial.', 'error'); return; }
  if (!confirm(`¿Eliminar la recompensa "${r.nombre}"?`)) return;
  try {
    const { error } = await sb.from('puntos_recompensas').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Recompensa eliminada.');
    await cargarRecompensas();
  } catch (e) { console.error('eliminarRecompensa:', e); showToast('No se pudo eliminar.', 'error'); }
}
