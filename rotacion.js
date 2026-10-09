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
    if (STATE.empresaConfig?.usa_modulo_farmacia !== true && STATE.empresaConfig?.usa_modulo_insumos !== true) {
      window.location.href = 'dashboard.html';
      return;
    }

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarRotacion();
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
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
function fmt(n) { return 'C$' + Number(n||0).toLocaleString('es-NI', { minimumFractionDigits: 2 }); }

/* =====================================================
   ROTACION Y MARGEN -- que se vende mas, que se vende
   menos, y cuanto deja de ganancia cada producto.
===================================================== */
async function cargarRotacion() {
  const tbody = document.getElementById('rm-tbody');
  try {
    const dias = parseInt(document.getElementById('rm-rango').value, 10) || 30;
    const desde = new Date(); desde.setDate(desde.getDate() - dias);
    const desdeISO = desde.toISOString().slice(0, 10);

    // Ventas del rango, agrupadas por producto.
    const { data: detalles, error } = await sb.from('venta_detalles')
      .select('producto_id, producto_nombre, cantidad, subtotal, ventas!inner(fecha, auth_user_id)')
      .eq('ventas.auth_user_id', STATE.userId).gte('ventas.fecha', desdeISO);
    if (error) throw error;

    const porProducto = {};
    (detalles || []).forEach(d => {
      if (!d.producto_id) return;
      if (!porProducto[d.producto_id]) porProducto[d.producto_id] = { id: d.producto_id, nombre: d.producto_nombre, unidades: 0, ingresos: 0 };
      porProducto[d.producto_id].unidades += Number(d.cantidad || 0);
      porProducto[d.producto_id].ingresos += Number(d.subtotal || 0);
    });

    // Todos los productos activos (tipo 'producto') -- los que no
    // vendieron nada en el rango tambien aparecen, como "sin movimiento".
    const { data: productos } = await sb.from('productos')
      .select('id, nombre, costo, precio, stock_actual, stock_minimo, stock_maximo').eq('auth_user_id', STATE.userId).eq('tipo', 'producto').eq('activo', true);

    const lista = (productos || []).map(p => {
      const v = porProducto[p.id];
      const unidades = v ? v.unidades : 0;
      const ingresos = v ? v.ingresos : 0;
      const precioPromedio = unidades > 0 ? ingresos / unidades : Number(p.precio || 0);
      const costo = Number(p.costo || 0);
      const margenPct = precioPromedio > 0 ? round2(((precioPromedio - costo) / precioPromedio) * 100) : 0;

      // Alerta de reposicion: stock actual ya llego al minimo (o
      // menos). La cantidad sugerida completa hasta el maximo si
      // esta definido; si no, una heuristica simple (el doble del
      // minimo) para dar un numero razonable de todas formas.
      const stockActual = Number(p.stock_actual || 0);
      const stockMinimo = Number(p.stock_minimo || 0);
      const stockMaximo = p.stock_maximo != null ? Number(p.stock_maximo) : null;
      const necesitaReponer = stockMinimo > 0 && stockActual <= stockMinimo;
      const cantidadSugerida = necesitaReponer
        ? round2(stockMaximo != null ? Math.max(0, stockMaximo - stockActual) : stockMinimo * 2)
        : 0;

      return { id: p.id, nombre: p.nombre, unidades: round2(unidades), ingresos: round2(ingresos), margenPct,
        stockActual, stockMinimo, necesitaReponer, cantidadSugerida };
    });

    // Clasificacion por terciles de unidades vendidas (solo entre los
    // que SI vendieron algo -- los de 0 unidades son "sin movimiento").
    const conVentas = lista.filter(x => x.unidades > 0).sort((a, b) => b.unidades - a.unidades);
    const corte1 = Math.ceil(conVentas.length / 3);
    const corte2 = Math.ceil((conVentas.length * 2) / 3);
    conVentas.forEach((x, i) => { x.rotacion = i < corte1 ? 'alta' : (i < corte2 ? 'media' : 'baja'); });
    lista.filter(x => x.unidades === 0).forEach(x => { x.rotacion = 'sin_movimiento'; });

    STATE.rotacion = lista.sort((a, b) => b.unidades - a.unidades);
    STATE.rotacionFiltrada = STATE.rotacion;
    renderRotacion();
  } catch (e) {
    console.error('cargarRotacion:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--danger,#dc2626)">No se pudo cargar la rotación.</td></tr>';
  }
}

function filtrarRotacion() {
  const q = (document.getElementById('rm-buscar')?.value || '').trim().toLowerCase();
  STATE.rotacionFiltrada = !q ? STATE.rotacion : STATE.rotacion.filter(r => (r.nombre || '').toLowerCase().includes(q));
  renderRotacion();
}

const ROTACION_LABEL = {
  alta: '🟢 Alta', media: '🟡 Media', baja: '🔵 Baja', sin_movimiento: '⚪ Sin movimiento',
};

function renderRotacion() {
  const tbody = document.getElementById('rm-tbody');
  const lista = STATE.rotacionFiltrada || [];

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('rm-kpi-alta', STATE.rotacion.filter(x => x.rotacion === 'alta').length);
  set('rm-kpi-media', STATE.rotacion.filter(x => x.rotacion === 'media').length);
  set('rm-kpi-baja', STATE.rotacion.filter(x => x.rotacion === 'baja' || x.rotacion === 'sin_movimiento').length);

  // Para reponer ya: solo los que SI tienen el minimo configurado y
  // ya lo tocaron, priorizando primero los que mas se venden (alta
  // rotacion) -- esos son los mas urgentes de no dejar sin stock.
  const ordenPrioridad = { alta: 0, media: 1, baja: 2, sin_movimiento: 3 };
  const paraReponer = STATE.rotacion.filter(x => x.necesitaReponer)
    .sort((a, b) => (ordenPrioridad[a.rotacion] ?? 9) - (ordenPrioridad[b.rotacion] ?? 9));
  const contReponer = document.getElementById('rm-reponer-lista');
  const wrapReponer = document.getElementById('rm-reponer-wrap');
  if (wrapReponer) wrapReponer.style.display = paraReponer.length ? '' : 'none';
  if (contReponer) {
    contReponer.innerHTML = paraReponer.map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-app,#fff7ed);border-radius:8px;margin-bottom:6px">
        <div>
          <strong style="font-size:13px">${esc(r.nombre)}</strong> ${ROTACION_LABEL[r.rotacion] || ''}
          <div style="font-size:11.5px;color:var(--text-muted)">Stock actual: ${r.stockActual} (mínimo: ${r.stockMinimo})</div>
        </div>
        <span style="font-weight:700;font-size:13px;color:var(--warning,#d97706)">Pedir ~${r.cantidadSugerida}</span>
      </div>`).join('');
  }

  if (!tbody) return;
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">Sin productos para mostrar.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(r => `
    <tr>
      <td>${esc(r.nombre)}</td>
      <td>${ROTACION_LABEL[r.rotacion] || '—'}</td>
      <td>${r.unidades}</td>
      <td>${fmt(r.ingresos)}</td>
      <td>${r.margenPct}%</td>
    </tr>`).join('');
}
