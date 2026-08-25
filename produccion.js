/* =====================================================
   PRODUCCION.JS — NEGOCIO360
   Recetas (BOM), órdenes de producción, y costeo real basado en lo
   que de verdad se consumió — reutilizando la misma función atómica
   de stock ya construida y probada (incrementar_stock_producto),
   tanto para consumir materia prima (cantidad negativa) como para
   agregar el producto terminado (cantidad positiva).
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  productos: [], recetas: [], ordenes: [],
  tabActivo: 'ordenes',
  componentesRecetaActual: [], // [{producto_id, nombre, cantidad}]
  tipoRecetaActual: 'normal',
  salidasDespieceActual: [], // [{producto_id, nombre, cantidad_rendimiento, es_merma}]
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = monedaParaMostrar(STATE.empresaConfig?.moneda);
  return `${sym} ${convertirParaMostrar(amount, STATE.empresaConfig?.moneda).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function fmtNum(n) { return Number(n||0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }

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

async function cargarProductosCache() {
  try {
    const { data } = await sb.from('productos').select('id,nombre,sku,tipo,costo,precio,stock_actual,activo')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.productos = data || [];
  } catch (e) { STATE.productos = []; }
}

/* =====================================================
   PAGINACIÓN Y FILTROS DE LA TABLA DE ÓRDENES
===================================================== */
STATE.filtroEstadoOrden = '';
STATE.paginaOrdenes = 1;
const ORDENES_POR_PAGINA = 5;

function filtrarOrdenesPorEstado(estado) {
  STATE.filtroEstadoOrden = estado;
  STATE.paginaOrdenes = 1;
  document.querySelectorAll('.servicio-vista-btn').forEach(b => b.classList.toggle('active', b.dataset.estado === estado));
  renderTablaOrdenes();
}

function cambiarPaginaOrdenes(delta) {
  STATE.paginaOrdenes = Math.max(1, STATE.paginaOrdenes + delta);
  renderTablaOrdenes();
}

function cambiarVistaRecetasCompleta() {
  const el = document.getElementById('vista-recetas-completa');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

/* =====================================================
   RECETAS (BOM)
===================================================== */
async function cargarRecetas() {
  try {
    const { data } = await sb.from('recetas_produccion')
      .select('*, receta_componentes(id, producto_id, cantidad), receta_despiece_salidas(id, producto_id, cantidad_rendimiento, es_merma)')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    STATE.recetas = data || [];
    renderTablaRecetas();
  } catch (e) { console.error('cargarRecetas:', e); }
}

function nombreProducto(id) { return STATE.productos.find(p => p.id === id)?.nombre || '—'; }

function renderTablaRecetas() {
  const tbody = document.getElementById('tabla-recetas');
  if (!tbody) return;
  if (!STATE.recetas.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Todavía no has creado ninguna receta.</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.recetas.map(r => {
    const nComp = (r.receta_componentes||[]).length;
    const esDespiece = r.tipo === 'despiece';
    const nSalidas = (r.receta_despiece_salidas||[]).length;
    return `<tr>
      <td><strong>${esc(r.nombre)}</strong> ${esDespiece ? '<span style="font-size:10px;color:#f59e0b;font-weight:700">🍗 DESPIECE</span>' : ''}</td>
      <td>${esDespiece ? `${nSalidas} salida${nSalidas===1?'':'s'}` : esc(nombreProducto(r.producto_terminado_id))}</td>
      <td>${esDespiece ? '—' : `${fmtNum(r.cantidad_producida)} unidad${r.cantidad_producida==1?'':'es'}`}</td>
      <td>${nComp} producto${nComp===1?'':'s'}</td>
      <td><span class="status-badge ${r.activa?'status-activo':'status-inactivo'}" style="cursor:pointer" onclick="toggleRecetaActiva('${r.id}', ${!r.activa})">${r.activa?'Activa':'Pausada'}</span></td>
      <td>
        <button class="row-action-btn" title="Editar" onclick="abrirModalReceta('${r.id}')">✏️</button>
        <button class="row-action-btn" title="Eliminar" onclick="eliminarReceta('${r.id}')" style="color:var(--danger)">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

async function toggleRecetaActiva(id, nuevoValor) {
  try {
    await sb.from('recetas_produccion').update({ activa: nuevoValor, updated_at: new Date().toISOString() })
      .eq('id', id).eq('auth_user_id', STATE.userId);
    showToast(nuevoValor ? 'Receta activada' : 'Receta pausada');
    await cargarRecetas();
    actualizarKPIsProduccion();
  } catch (e) { showToast('No se pudo actualizar', 'error'); }
}

async function eliminarReceta(id) {
  if (!confirm('¿Eliminar esta receta? Esta acción no se puede deshacer.')) return;
  try {
    await sb.from('recetas_produccion').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    showToast('Receta eliminada');
    await cargarRecetas();
  } catch (e) { showToast('No se pudo eliminar', 'error'); }
}

function llenarSelectProductosTerminados() {
  const opciones = STATE.productos.filter(p => p.tipo === 'producto').map(p =>
    `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  const sel = document.getElementById('rc-producto-terminado');
  if (sel) sel.innerHTML = opciones;
}

function cambiarTipoReceta(tipo) {
  STATE.tipoRecetaActual = tipo;
  document.querySelectorAll('.prod-tipo-receta-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
  document.getElementById('rc-seccion-normal').style.display = tipo === 'normal' ? '' : 'none';
  document.getElementById('rc-seccion-despiece').style.display = tipo === 'despiece' ? '' : 'none';
  document.getElementById('rc-titulo-componentes').textContent = tipo === 'despiece' ? 'Materia prima que se despieza' : 'Materia prima que necesita';
}

function abrirModalReceta(id) {
  document.getElementById('rc-error').textContent = '';
  document.getElementById('rc-id').value = id || '';
  llenarSelectProductosTerminados();
  STATE.componentesRecetaActual = [];
  STATE.salidasDespieceActual = [];
  document.getElementById('rc-buscar-componente').value = '';
  document.getElementById('rc-buscar-resultados').innerHTML = '';
  document.getElementById('rd-buscar-salida').value = '';
  document.getElementById('rd-buscar-resultados').innerHTML = '';

  if (id) {
    const r = STATE.recetas.find(x => x.id === id);
    if (!r) return;
    document.getElementById('receta-titulo-modal').textContent = '✏️ Editar receta';
    document.getElementById('rc-nombre').value = r.nombre;
    cambiarTipoReceta(r.tipo || 'normal');

    if (r.tipo === 'despiece') {
      STATE.salidasDespieceActual = (r.receta_despiece_salidas||[]).map(s => ({
        producto_id: s.producto_id, nombre: nombreProducto(s.producto_id),
        cantidad_rendimiento: s.cantidad_rendimiento, es_merma: s.es_merma,
      }));
    } else {
      document.getElementById('rc-producto-terminado').value = r.producto_terminado_id;
      document.getElementById('rc-cantidad-produce').value = r.cantidad_producida;
    }
    STATE.componentesRecetaActual = (r.receta_componentes||[]).map(c => ({
      producto_id: c.producto_id, nombre: nombreProducto(c.producto_id), cantidad: c.cantidad,
    }));
  } else {
    document.getElementById('receta-titulo-modal').textContent = '🧪 Nueva receta';
    document.getElementById('rc-nombre').value = 'Receta estándar';
    document.getElementById('rc-cantidad-produce').value = 1;
    cambiarTipoReceta('normal');
  }
  renderListaComponentesReceta();
  renderListaSalidasDespiece();
  openModal('modal-receta');
}

function renderListaSalidasDespiece() {
  const cont = document.getElementById('rd-lista-salidas');
  if (!cont) return;
  if (!STATE.salidasDespieceActual.length) {
    cont.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Todavía no has agregado ninguna salida.</p>';
    return;
  }
  cont.innerHTML = STATE.salidasDespieceActual.map((s, i) => `
    <div class="prod-componente-row">
      <span>${s.es_merma ? '🗑️' : '📦'} ${esc(s.nombre)}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" min="0.01" step="0.01" value="${s.cantidad_rendimiento}" style="width:75px" onchange="cambiarCantidadSalida(${i}, this.value)"/>
        <label style="display:flex;align-items:center;gap:3px;font-size:11px;white-space:nowrap;cursor:pointer">
          <input type="checkbox" ${s.es_merma?'checked':''} onchange="toggleEsMermaSalida(${i}, this.checked)"/> desecho
        </label>
        <button type="button" class="row-action-btn" title="Quitar" onclick="quitarSalidaDespiece(${i})" style="color:var(--danger)">✕</button>
      </div>
    </div>`).join('');
}
function cambiarCantidadSalida(idx, valor) {
  const n = parseFloat(valor);
  if (!isNaN(n) && n > 0) STATE.salidasDespieceActual[idx].cantidad_rendimiento = n;
}
function toggleEsMermaSalida(idx, valor) { STATE.salidasDespieceActual[idx].es_merma = valor; }
function quitarSalidaDespiece(idx) { STATE.salidasDespieceActual.splice(idx, 1); renderListaSalidasDespiece(); }
function agregarSalidaDespiece(productoId, nombre) {
  if (STATE.salidasDespieceActual.some(s => s.producto_id === productoId)) return;
  STATE.salidasDespieceActual.push({ producto_id: productoId, nombre, cantidad_rendimiento: 1, es_merma: false });
  document.getElementById('rd-buscar-salida').value = '';
  document.getElementById('rd-buscar-resultados').innerHTML = '';
  renderListaSalidasDespiece();
}

function initBusquedaSalidaDespiece() {
  const input = document.getElementById('rd-buscar-salida');
  if (!input) return;
  input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const cont = document.getElementById('rd-buscar-resultados');
    if (!q) { cont.innerHTML = ''; return; }
    const yaAgregados = new Set(STATE.salidasDespieceActual.map(s => s.producto_id));
    const resultados = STATE.productos.filter(p => !yaAgregados.has(p.id) && p.nombre.toLowerCase().includes(q)).slice(0, 6);
    cont.innerHTML = resultados.map(p => `
      <div style="padding:6px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
           onclick="agregarSalidaDespiece('${p.id}','${esc(p.nombre)}')">${esc(p.nombre)}</div>
    `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
  });
}

function renderListaComponentesReceta() {
  const cont = document.getElementById('rc-lista-componentes');
  if (!cont) return;
  if (!STATE.componentesRecetaActual.length) {
    cont.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Todavía no has agregado materia prima.</p>';
    return;
  }
  cont.innerHTML = STATE.componentesRecetaActual.map((c, i) => `
    <div class="prod-componente-row">
      <span>${esc(c.nombre)}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" min="0.01" step="0.01" value="${c.cantidad}" style="width:80px" onchange="cambiarCantidadComponente(${i}, this.value)"/>
        <button type="button" class="row-action-btn" title="Quitar" onclick="quitarComponenteReceta(${i})" style="color:var(--danger)">✕</button>
      </div>
    </div>`).join('');
}

function cambiarCantidadComponente(idx, valor) {
  const n = parseFloat(valor);
  if (!isNaN(n) && n > 0) STATE.componentesRecetaActual[idx].cantidad = n;
}
function quitarComponenteReceta(idx) {
  STATE.componentesRecetaActual.splice(idx, 1);
  renderListaComponentesReceta();
}
function agregarComponenteReceta(productoId, nombre) {
  if (STATE.componentesRecetaActual.some(c => c.producto_id === productoId)) return;
  STATE.componentesRecetaActual.push({ producto_id: productoId, nombre, cantidad: 1 });
  document.getElementById('rc-buscar-componente').value = '';
  document.getElementById('rc-buscar-resultados').innerHTML = '';
  renderListaComponentesReceta();
}

function initBusquedaComponenteReceta() {
  const input = document.getElementById('rc-buscar-componente');
  if (!input) return;
  input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const cont = document.getElementById('rc-buscar-resultados');
    if (!q) { cont.innerHTML = ''; return; }
    const yaAgregados = new Set(STATE.componentesRecetaActual.map(c => c.producto_id));
    const productoTerminadoId = document.getElementById('rc-producto-terminado')?.value;
    const resultados = STATE.productos
      .filter(p => !yaAgregados.has(p.id) && p.id !== productoTerminadoId && p.nombre.toLowerCase().includes(q))
      .slice(0, 6);
    cont.innerHTML = resultados.map(p => `
      <div style="padding:6px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:12.5px"
           onclick="agregarComponenteReceta('${p.id}','${esc(p.nombre)}')">
        ${esc(p.nombre)} <span style="color:var(--text-muted)">— stock: ${fmtNum(p.stock_actual)}</span>
      </div>
    `).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin resultados</p>';
  });
}

async function guardarReceta() {
  const errEl = document.getElementById('rc-error');
  errEl.textContent = '';
  const id = document.getElementById('rc-id').value;
  const nombre = document.getElementById('rc-nombre').value.trim();
  const tipo = STATE.tipoRecetaActual;

  if (!nombre) { errEl.textContent = 'El nombre de la receta es obligatorio.'; return; }
  if (!STATE.componentesRecetaActual.length) { errEl.textContent = 'Agrega al menos una materia prima.'; return; }

  let productoTerminadoId = null, cantidadProduce = null;
  if (tipo === 'normal') {
    productoTerminadoId = document.getElementById('rc-producto-terminado').value;
    cantidadProduce = parseFloat(document.getElementById('rc-cantidad-produce').value);
    if (!productoTerminadoId) { errEl.textContent = 'Elige el producto terminado.'; return; }
    if (!cantidadProduce || cantidadProduce <= 0) { errEl.textContent = 'La cantidad que produce debe ser mayor a cero.'; return; }
  } else {
    if (!STATE.salidasDespieceActual.length) { errEl.textContent = 'Agrega al menos una salida (lo que vas a obtener).'; return; }
  }

  setBtnLoading('btn-guardar-receta', true);
  try {
    const payload = {
      auth_user_id: STATE.userId, tipo,
      producto_terminado_id: tipo === 'normal' ? productoTerminadoId : null,
      nombre, cantidad_producida: tipo === 'normal' ? cantidadProduce : 1,
      updated_at: new Date().toISOString(),
    };
    let recetaId = id;
    if (id) {
      const { error } = await sb.from('recetas_produccion').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
      if (error) throw error;
      await sb.from('receta_componentes').delete().eq('receta_id', id).eq('auth_user_id', STATE.userId);
      await sb.from('receta_despiece_salidas').delete().eq('receta_id', id).eq('auth_user_id', STATE.userId);
    } else {
      const { data, error } = await sb.from('recetas_produccion').insert(payload).select('id').single();
      if (error) throw error;
      recetaId = data.id;
    }

    const filas = STATE.componentesRecetaActual.map(c => ({
      auth_user_id: STATE.userId, receta_id: recetaId, producto_id: c.producto_id, cantidad: c.cantidad,
    }));
    const { error: errComp } = await sb.from('receta_componentes').insert(filas);
    if (errComp) throw errComp;

    if (tipo === 'despiece') {
      const filasSalidas = STATE.salidasDespieceActual.map(s => ({
        auth_user_id: STATE.userId, receta_id: recetaId, producto_id: s.producto_id,
        cantidad_rendimiento: s.cantidad_rendimiento, es_merma: s.es_merma,
      }));
      const { error: errSal } = await sb.from('receta_despiece_salidas').insert(filasSalidas);
      if (errSal) throw errSal;
    }

    showToast(id ? 'Receta actualizada' : 'Receta creada');
    closeModal('modal-receta');
    await cargarRecetas();
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('guardarReceta:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-guardar-receta', false);
  }
}


/* =====================================================
   ÓRDENES DE PRODUCCIÓN
===================================================== */
async function cargarOrdenes() {
  try {
    const { data } = await sb.from('ordenes_produccion').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    STATE.ordenes = data || [];
    renderTablaOrdenes();
  } catch (e) { console.error('cargarOrdenes:', e); }
}

const ESTADO_ORDEN_LABEL = { pendiente:'Pendiente', en_proceso:'En proceso', completada:'Completada', cancelada:'Cancelada' };
const ESTADO_ORDEN_CLASE = { pendiente:'status-pendiente', en_proceso:'status-pendiente', completada:'status-activo', cancelada:'status-inactivo' };

function renderTablaOrdenes() {
  const tbody = document.getElementById('tabla-ordenes-produccion');
  if (!tbody) return;

  const filtradas = STATE.filtroEstadoOrden
    ? STATE.ordenes.filter(o => o.estado === STATE.filtroEstadoOrden)
    : STATE.ordenes;

  if (!filtradas.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No hay órdenes ${STATE.filtroEstadoOrden ? 'en este estado' : 'todavía'}.</td></tr>`;
    document.getElementById('prod-paginacion-info').textContent = 'Mostrando 0 de 0 órdenes';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / ORDENES_POR_PAGINA));
  STATE.paginaOrdenes = Math.min(STATE.paginaOrdenes, totalPaginas);
  const inicio = (STATE.paginaOrdenes - 1) * ORDENES_POR_PAGINA;
  const pagina = filtradas.slice(inicio, inicio + ORDENES_POR_PAGINA);

  tbody.innerHTML = pagina.map(o => {
    const pct = o.estado === 'completada' ? 100 : (o.estado === 'en_proceso' ? Number(o.porcentaje_avance||0) : 0);
    const colorBarra = o.estado === 'cancelada' ? 'var(--danger)' : (o.estado === 'completada' ? 'var(--success)' : 'var(--accent)');
    const esDespiece = o.tipo === 'despiece';
    const nombreCol = esDespiece
      ? `🍗 ${esc(STATE.recetas.find(r => r.id === o.receta_id)?.nombre || 'Despiece')}`
      : esc(nombreProducto(o.producto_terminado_id));
    return `<tr>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(o.numero)}</span></td>
      <td>${nombreCol}</td>
      <td>${fmtNum(o.cantidad_planificada)} ${esDespiece ? 'lote(s)' : 'unidades'}</td>
      <td><span class="status-badge ${ESTADO_ORDEN_CLASE[o.estado]}">${ESTADO_ORDEN_LABEL[o.estado]}</span></td>
      <td style="min-width:110px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:6px;background:var(--bg-app);border-radius:20px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${colorBarra}"></div></div>
          <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${pct}%</span>
        </div>
      </td>
      <td>${o.fecha_entrega ? fmtFechaCorta(o.fecha_entrega) : '—'}</td>
      <td>
        <button class="row-action-btn" title="Ver detalle" onclick="verDetalleOrden('${o.id}')">👁️</button>
        ${o.estado==='pendiente' ? `<button class="row-action-btn" title="Iniciar producción" onclick="marcarOrdenEnProceso('${o.id}')" style="color:var(--accent)">▶️</button>` : ''}
        ${o.estado==='en_proceso' ? `<button class="row-action-btn" title="Actualizar avance" onclick="abrirModalProgreso('${o.id}')" style="color:var(--accent)">📈</button>` : ''}
        ${(o.estado==='pendiente'||o.estado==='en_proceso') ? `<button class="row-action-btn" title="Completar" onclick="completarOrdenPlanificada('${o.id}')" style="color:var(--success)">✅</button>` : ''}
        ${o.estado==='pendiente' ? `<button class="row-action-btn" title="Cancelar" onclick="cancelarOrden('${o.id}')" style="color:var(--danger)">🗑️</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  document.getElementById('prod-paginacion-info').textContent = `Mostrando ${inicio+1} a ${Math.min(inicio+ORDENES_POR_PAGINA, filtradas.length)} de ${filtradas.length} órdenes`;
  document.getElementById('prod-paginacion-actual').textContent = `${STATE.paginaOrdenes} / ${totalPaginas}`;
}

// Pasar una orden de "pendiente" a "en_proceso" -- todavia no se
// consume nada de materia prima, solo marca que ya se empezo a
// trabajar en ella.
async function marcarOrdenEnProceso(ordenId) {
  try {
    await sb.from('ordenes_produccion').update({ estado: 'en_proceso', porcentaje_avance: 5, updated_at: new Date().toISOString() })
      .eq('id', ordenId).eq('auth_user_id', STATE.userId);
    showToast('▶️ Orden marcada en proceso');
    await cargarOrdenes();
    actualizarKPIsProduccion();
  } catch (e) { showToast('No se pudo actualizar', 'error'); }
}

function abrirModalProgreso(ordenId) {
  const orden = STATE.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  document.getElementById('progreso-orden-titulo').textContent = `Progreso — ${orden.numero}`;
  document.getElementById('pg-orden-id').value = ordenId;
  document.getElementById('pg-porcentaje').value = orden.porcentaje_avance || 0;
  document.getElementById('pg-porcentaje-num').textContent = `${orden.porcentaje_avance || 0}%`;
  document.getElementById('pg-error').textContent = '';
  openModal('modal-progreso-orden');
}

async function guardarProgresoOrden() {
  const ordenId = document.getElementById('pg-orden-id').value;
  const pct = parseFloat(document.getElementById('pg-porcentaje').value);
  try {
    await sb.from('ordenes_produccion').update({ porcentaje_avance: pct, updated_at: new Date().toISOString() })
      .eq('id', ordenId).eq('auth_user_id', STATE.userId);
    showToast('Progreso actualizado');
    closeModal('modal-progreso-orden');
    await cargarOrdenes();
  } catch (e) {
    document.getElementById('pg-error').textContent = 'No se pudo guardar. Intenta de nuevo.';
  }
}

function llenarSelectRecetasOrden() {
  const opciones = STATE.recetas.filter(r => r.activa).map(r =>
    `<option value="${r.id}">${esc(r.nombre)} — ${esc(nombreProducto(r.producto_terminado_id))}</option>`).join('');
  const sel = document.getElementById('op-receta');
  if (sel) sel.innerHTML = opciones || '<option value="">— No hay recetas activas —</option>';
}

function abrirModalOrden() {
  document.getElementById('op-error').textContent = '';
  llenarSelectRecetasOrden();
  document.getElementById('op-cantidad').value = '';
  document.getElementById('op-fecha-entrega').value = '';
  document.getElementById('op-costo-mano-obra').value = 0;
  document.getElementById('op-costo-indirecto').value = 0;
  document.getElementById('op-merma-cantidad').value = 0;
  document.getElementById('op-merma-motivo').value = '';
  document.getElementById('op-merma-motivo-wrap').style.display = 'none';
  document.getElementById('op-necesidades-wrap').style.display = 'none';
  document.getElementById('op-resumen-costo').style.display = 'none';
  if (!STATE.recetas.filter(r=>r.activa).length) {
    document.getElementById('op-error').textContent = 'Primero crea una receta activa para poder producir.';
  }
  openModal('modal-orden');
}

function onCambiarRecetaOrden() {
  const receta = STATE.recetas.find(r => r.id === document.getElementById('op-receta').value);
  const label = document.getElementById('op-cantidad-label');
  if (receta) {
    const esDespiece = receta.tipo === 'despiece';
    label.textContent = esDespiece ? '¿Cuántos lotes vas a procesar? *' : '¿Cuánto vas a producir? *';
    document.getElementById('op-cantidad').value = esDespiece ? 1 : receta.cantidad_producida;
  }
  recalcularNecesidadesOrden();
}

// Escala las salidas de una receta de despiece segun cuantos lotes se
// van a procesar, y calcula el valor relativo de cada una (cuanto
// rinde x su precio de venta) -- la base para repartir el costo.
function calcularSalidasDespiece(receta, cantidadLotes) {
  return (receta.receta_despiece_salidas || []).map(s => {
    const prod = STATE.productos.find(p => p.id === s.producto_id);
    const cantidadObtenida = round2(s.cantidad_rendimiento * cantidadLotes);
    const valorRelativo = s.es_merma ? 0 : round2(cantidadObtenida * Number(prod?.precio || 0));
    return { producto_id: s.producto_id, nombre: prod?.nombre || '—', cantidadObtenida, valorRelativo, esMerma: s.es_merma };
  });
}

// El costo total de la materia prima se reparte entre las salidas
// proporcional a su valor relativo -- lo que vale mas, absorbe mas
// costo. La suma de todo lo asignado siempre da el costo total, sin
// perder ni duplicar nada (probado en aislado antes de construir esto).
function asignarCostoSalidasDespiece(salidas, costoTotal) {
  const sumaValorRelativo = salidas.reduce((s, x) => s + x.valorRelativo, 0);
  return salidas.map(s => {
    const costoAsignado = sumaValorRelativo > 0 ? round2((s.valorRelativo / sumaValorRelativo) * costoTotal) : 0;
    const costoUnitario = s.cantidadObtenida > 0 ? round2(costoAsignado / s.cantidadObtenida) : 0;
    return { ...s, costoAsignado, costoUnitario };
  });
}

// Calcula, sin escribir nada todavía, cuánta materia prima se
// necesitaría y cuál sería el costo total/unitario resultante --
// esto es lo que el cajero VE antes de decidir producir.
function calcularNecesidadesOrden(receta, cantidadProducir) {
  const factor = cantidadProducir / Number(receta.cantidad_producida || 1);
  const necesidades = (receta.receta_componentes || []).map(c => {
    const prod = STATE.productos.find(p => p.id === c.producto_id);
    const necesario = round2(c.cantidad * factor);
    const disponible = Number(prod?.stock_actual || 0);
    return {
      producto_id: c.producto_id, nombre: prod?.nombre || '—',
      necesario, disponible, costoUnitario: Number(prod?.costo || 0),
      subtotal: round2(necesario * Number(prod?.costo || 0)),
      suficiente: disponible >= necesario,
    };
  });
  const costoMateriales = round2(necesidades.reduce((s, n) => s + n.subtotal, 0));
  return { necesidades, costoMateriales, todoSuficiente: necesidades.every(n => n.suficiente) };
}

function recalcularNecesidadesOrden() {
  const recetaId = document.getElementById('op-receta').value;
  const cantidad = parseFloat(document.getElementById('op-cantidad').value);
  const wrap = document.getElementById('op-necesidades-wrap');
  const resumenEl = document.getElementById('op-resumen-costo');
  const salidasWrap = document.getElementById('op-salidas-despiece-wrap');
  if (!recetaId || !cantidad || cantidad <= 0) { wrap.style.display = 'none'; resumenEl.style.display = 'none'; salidasWrap.style.display = 'none'; return; }

  const receta = STATE.recetas.find(r => r.id === recetaId);
  if (!receta) return;

  const { necesidades, costoMateriales, todoSuficiente } = calcularNecesidadesOrden(receta, cantidad);
  document.getElementById('op-necesidades-lista').innerHTML = necesidades.map(n => `
    <div class="prod-componente-row">
      <span>${n.suficiente ? '✅' : '⚠️'} ${esc(n.nombre)}</span>
      <span style="font-family:var(--font-mono)">${fmtNum(n.necesario)} / ${fmtNum(n.disponible)} disp.</span>
    </div>`).join('');
  wrap.style.display = '';

  // DESPIECE: en vez de "unidades buenas de un solo producto", se
  // muestran las salidas reales (cada una con su cantidad escalada),
  // y el costo se reparte por valor relativo -- no hay un solo
  // "costo por unidad" simple, cada salida tiene el suyo.
  if (receta.tipo === 'despiece') {
    const manoObra = parseFloat(document.getElementById('op-costo-mano-obra').value) || 0;
    const indirecto = parseFloat(document.getElementById('op-costo-indirecto').value) || 0;
    const costoTotal = round2(costoMateriales + manoObra + indirecto);
    const salidas = calcularSalidasDespiece(receta, cantidad);
    const salidasConCosto = asignarCostoSalidasDespiece(salidas, costoTotal);

    document.getElementById('op-salidas-despiece-lista').innerHTML = salidasConCosto.map(s => `
      <div class="prod-componente-row">
        <span>${s.esMerma ? '🗑️' : '📦'} ${esc(s.nombre)}</span>
        <span style="text-align:right">${fmtNum(s.cantidadObtenida)} unid.${!s.esMerma ? ` — <b>${fmt(s.costoUnitario)}</b>/unid.` : ' (desecho)'}</span>
      </div>`).join('');
    salidasWrap.style.display = '';

    resumenEl.innerHTML = `
      <div style="display:flex;justify-content:space-between"><span>Costo de materiales:</span><b>${fmt(costoMateriales)}</b></div>
      <div style="display:flex;justify-content:space-between"><span>Mano de obra + indirectos:</span><b>${fmt(manoObra+indirecto)}</b></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:6px;padding-top:6px"><span>Costo total (se reparte entre las salidas):</span><b>${fmt(costoTotal)}</b></div>
      ${!todoSuficiente ? '<div style="color:var(--danger);font-weight:700;margin-top:6px">⚠️ No hay suficiente materia prima para procesar esta cantidad todavía.</div>' : ''}
    `;
    resumenEl.style.display = '';
    return;
  }
  salidasWrap.style.display = 'none';

  // Merma: la materia prima se consume igual sobre la cantidad
  // PLANIFICADA (se usó lo mismo para intentar producir todo), pero
  // el costo por unidad y el inventario final solo cuentan las
  // unidades que de verdad salieron buenas.
  const merma = Math.min(cantidad, Math.max(0, parseFloat(document.getElementById('op-merma-cantidad').value) || 0));
  const cantidadBuena = Math.max(0.01, round2(cantidad - merma));
  document.getElementById('op-merma-motivo-wrap').style.display = merma > 0 ? '' : 'none';

  const manoObra = parseFloat(document.getElementById('op-costo-mano-obra').value) || 0;
  const indirecto = parseFloat(document.getElementById('op-costo-indirecto').value) || 0;
  const costoTotal = round2(costoMateriales + manoObra + indirecto);
  const costoUnitario = round2(costoTotal / cantidadBuena);

  resumenEl.innerHTML = `
    <div style="display:flex;justify-content:space-between"><span>Costo de materiales:</span><b>${fmt(costoMateriales)}</b></div>
    <div style="display:flex;justify-content:space-between"><span>Mano de obra + indirectos:</span><b>${fmt(manoObra+indirecto)}</b></div>
    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:6px;padding-top:6px"><span>Costo total:</span><b>${fmt(costoTotal)}</b></div>
    ${merma > 0 ? `<div style="display:flex;justify-content:space-between;color:#f59e0b"><span>Unidades buenas (tras merma):</span><b>${fmtNum(cantidadBuena)}</b></div>` : ''}
    <div style="display:flex;justify-content:space-between;color:var(--accent);font-weight:800"><span>Costo por unidad:</span><span>${fmt(costoUnitario)}</span></div>
    ${!todoSuficiente ? '<div style="color:var(--danger);font-weight:700;margin-top:6px">⚠️ No hay suficiente materia prima para producir esta cantidad todavía.</div>' : ''}
  `;
  resumenEl.style.display = '';
}

// Aplica el consumo real de materia prima + la produccion del
// terminado -- reutiliza la MISMA funcion atomica ya probada
// (incrementar_stock_producto), en negativo para consumir y en
// positivo para producir. Se usa tanto al crear-y-completar de una
// vez, como al completar una orden que ya estaba planificada.
async function procesarConsumoYProduccion(ordenId, receta, necesidades, cantidadProducir, productoTerminadoId) {
  for (const n of necesidades) {
    const { data: resultado, error } = await sb.rpc('incrementar_stock_producto', {
      p_producto_id: n.producto_id, p_auth_user_id: STATE.userId, p_cantidad: -n.necesario,
    });
    const stockDespues = (!error && resultado && resultado.length) ? Number(resultado[0].stock_actual) : null;

    await sb.from('orden_produccion_consumos').insert({
      auth_user_id: STATE.userId, orden_id: ordenId, producto_id: n.producto_id,
      producto_nombre: n.nombre, cantidad_consumida: n.necesario,
      costo_unitario: n.costoUnitario, subtotal: n.subtotal,
      stock_antes: stockDespues!=null ? round2(stockDespues + n.necesario) : n.disponible,
      stock_despues: stockDespues,
    });
  }

  await sb.rpc('incrementar_stock_producto', {
    p_producto_id: productoTerminadoId, p_auth_user_id: STATE.userId, p_cantidad: cantidadProducir,
  });
}

// Version para DESPIECE: consume la materia prima igual (mismo
// bucle), pero en vez de agregar UN producto terminado, agrega cada
// salida por separado, con su costo ya repartido por valor relativo.
async function procesarConsumoYSalidasDespiece(ordenId, necesidades, salidasConCosto) {
  for (const n of necesidades) {
    const { data: resultado, error } = await sb.rpc('incrementar_stock_producto', {
      p_producto_id: n.producto_id, p_auth_user_id: STATE.userId, p_cantidad: -n.necesario,
    });
    const stockDespues = (!error && resultado && resultado.length) ? Number(resultado[0].stock_actual) : null;

    await sb.from('orden_produccion_consumos').insert({
      auth_user_id: STATE.userId, orden_id: ordenId, producto_id: n.producto_id,
      producto_nombre: n.nombre, cantidad_consumida: n.necesario,
      costo_unitario: n.costoUnitario, subtotal: n.subtotal,
      stock_antes: stockDespues!=null ? round2(stockDespues + n.necesario) : n.disponible,
      stock_despues: stockDespues,
    });
  }

  for (const s of salidasConCosto) {
    if (s.cantidadObtenida <= 0) continue;
    // La merma/desecho (huesos, plumas, etc.) tambien puede tener un
    // producto asociado para llevar registro, pero no se le suma
    // stock -- no es algo que se vaya a vender.
    if (!s.esMerma) {
      await sb.rpc('incrementar_stock_producto', {
        p_producto_id: s.producto_id, p_auth_user_id: STATE.userId, p_cantidad: s.cantidadObtenida,
      });
    }
    await sb.from('orden_despiece_resultados').insert({
      auth_user_id: STATE.userId, orden_id: ordenId, producto_id: s.producto_id,
      producto_nombre: s.nombre, cantidad_obtenida: s.cantidadObtenida,
      valor_relativo: s.valorRelativo, costo_asignado: s.costoAsignado, costo_unitario: s.costoUnitario,
    });
  }
}

async function guardarOrden(estadoDeseado) {
  const errEl = document.getElementById('op-error');
  errEl.textContent = '';
  const recetaId = document.getElementById('op-receta').value;
  const cantidad = parseFloat(document.getElementById('op-cantidad').value);
  const fechaEntrega = document.getElementById('op-fecha-entrega').value || null;
  const manoObra = parseFloat(document.getElementById('op-costo-mano-obra').value) || 0;
  const indirecto = parseFloat(document.getElementById('op-costo-indirecto').value) || 0;
  const mermaCantidad = Math.min(cantidad||0, Math.max(0, parseFloat(document.getElementById('op-merma-cantidad').value) || 0));
  const mermaMotivo = document.getElementById('op-merma-motivo').value.trim() || null;

  if (!recetaId) { errEl.textContent = 'Elige una receta.'; return; }
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad a producir debe ser mayor a cero.'; return; }

  const receta = STATE.recetas.find(r => r.id === recetaId);
  const { necesidades, costoMateriales, todoSuficiente } = calcularNecesidadesOrden(receta, cantidad);

  if (estadoDeseado === 'completada' && !todoSuficiente) {
    errEl.textContent = 'No hay suficiente materia prima para completar esta producción ahora. Guárdala como pendiente, o ajusta la cantidad.';
    return;
  }

  try {
    const { data: numero } = await sb.rpc('generar_numero_orden_produccion', { p_user_id: STATE.userId });
    const costoTotal = round2(costoMateriales + manoObra + indirecto);

    // DESPIECE: no hay un solo producto terminado ni una sola
    // "cantidad producida" -- hay varias salidas, cada una con su
    // propio costo repartido por valor relativo.
    if (receta.tipo === 'despiece') {
      const salidas = calcularSalidasDespiece(receta, cantidad);
      const salidasConCosto = asignarCostoSalidasDespiece(salidas, costoTotal);

      const payloadDespiece = {
        auth_user_id: STATE.userId, numero: numero || `OP-${Date.now()}`,
        tipo: 'despiece', receta_id: recetaId, producto_terminado_id: null,
        cantidad_planificada: cantidad, fecha_planificada: todayLocalISO(), fecha_entrega: fechaEntrega,
        costo_mano_obra: manoObra, costo_indirecto: indirecto,
        usuario_nombre: STATE.currentUser?.nombre || 'Usuario',
        estado: estadoDeseado,
      };
      if (estadoDeseado === 'completada') {
        Object.assign(payloadDespiece, {
          costo_materiales: costoMateriales, costo_total: costoTotal,
          fecha_completada: new Date().toISOString(),
        });
      }

      const { data: ordenDespiece, error: errDespiece } = await sb.from('ordenes_produccion').insert(payloadDespiece).select('id').single();
      if (errDespiece) throw errDespiece;

      if (estadoDeseado === 'completada') {
        await procesarConsumoYSalidasDespiece(ordenDespiece.id, necesidades, salidasConCosto);
      }

      showToast(estadoDeseado === 'completada' ? '🍗 Despiece completado' : 'Orden de despiece guardada como pendiente');
      closeModal('modal-orden');
      await Promise.all([cargarOrdenes(), cargarProductosCache()]);
      actualizarKPIsProduccion();
      return;
    }

    // Las unidades buenas son las que de verdad entran al inventario
    // y sobre las que se reparte el costo -- la materia prima ya se
    // gastó igual intentando producir toda la cantidad planificada.
    const cantidadBuena = Math.max(0.01, round2(cantidad - mermaCantidad));
    const costoUnitario = round2(costoTotal / cantidadBuena);

    const payload = {
      auth_user_id: STATE.userId, numero: numero || `OP-${Date.now()}`,
      receta_id: recetaId, producto_terminado_id: receta.producto_terminado_id,
      cantidad_planificada: cantidad, fecha_planificada: todayLocalISO(), fecha_entrega: fechaEntrega,
      costo_mano_obra: manoObra, costo_indirecto: indirecto,
      merma_cantidad: mermaCantidad, merma_motivo: mermaCantidad > 0 ? mermaMotivo : null,
      usuario_nombre: STATE.currentUser?.nombre || 'Usuario',
      estado: estadoDeseado,
    };
    if (estadoDeseado === 'completada') {
      Object.assign(payload, {
        cantidad_producida: cantidadBuena, costo_materiales: costoMateriales,
        costo_total: costoTotal, costo_unitario: costoUnitario,
        fecha_completada: new Date().toISOString(),
      });
    }

    const { data: orden, error } = await sb.from('ordenes_produccion').insert(payload).select('id').single();
    if (error) throw error;

    if (estadoDeseado === 'completada') {
      await procesarConsumoYProduccion(orden.id, receta, necesidades, cantidadBuena, receta.producto_terminado_id);
    }

    showToast(estadoDeseado === 'completada' ? '🏭 Producción completada' : 'Orden guardada como pendiente');
    closeModal('modal-orden');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('guardarOrden:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  }
}

// Abre el modal para completar una orden, dejando que el usuario
// confirme cuantas unidades de verdad salieron buenas (por si hubo
// merma) antes de tocar el inventario.
function completarOrdenPlanificada(ordenId) {
  const orden = STATE.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  const receta = STATE.recetas.find(r => r.id === orden.receta_id);
  if (!receta) { showToast('No se encontró la receta de esta orden', 'error'); return; }

  const { todoSuficiente } = calcularNecesidadesOrden(receta, orden.cantidad_planificada);
  if (!todoSuficiente) {
    showToast('No hay suficiente materia prima todavía para completar esta orden', 'error');
    return;
  }

  // DESPIECE: no tiene el concepto de "unidades buenas de un solo
  // producto" -- se completa directo con las salidas ya definidas en
  // la receta, escaladas a la cantidad planificada.
  if (receta.tipo === 'despiece') {
    if (!confirm(`¿Completar este despiece de ${fmtNum(orden.cantidad_planificada)} lote(s)? Esto descontará la materia prima y agregará cada salida a su inventario.`)) return;
    completarOrdenDespieceDirecto(orden, receta);
    return;
  }

  document.getElementById('completar-orden-titulo').textContent = `Completar ${orden.numero}`;
  document.getElementById('co-orden-id').value = ordenId;
  document.getElementById('co-planificado-txt').textContent = `Ibas a producir ${fmtNum(orden.cantidad_planificada)} unidades de ${nombreProducto(orden.producto_terminado_id)}.`;
  document.getElementById('co-cantidad-buena').value = orden.cantidad_planificada;
  document.getElementById('co-cantidad-buena').max = orden.cantidad_planificada;
  document.getElementById('co-merma-motivo').value = '';
  document.getElementById('co-merma-motivo-wrap').style.display = 'none';
  document.getElementById('co-error').textContent = '';
  openModal('modal-completar-orden');
}

async function completarOrdenDespieceDirecto(orden, receta) {
  try {
    const { necesidades, costoMateriales } = calcularNecesidadesOrden(receta, orden.cantidad_planificada);
    const costoTotal = round2(costoMateriales + Number(orden.costo_mano_obra||0) + Number(orden.costo_indirecto||0));
    const salidas = calcularSalidasDespiece(receta, orden.cantidad_planificada);
    const salidasConCosto = asignarCostoSalidasDespiece(salidas, costoTotal);

    await procesarConsumoYSalidasDespiece(orden.id, necesidades, salidasConCosto);

    await sb.from('ordenes_produccion').update({
      estado: 'completada', costo_materiales: costoMateriales, costo_total: costoTotal,
      fecha_completada: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', orden.id).eq('auth_user_id', STATE.userId);

    showToast('🍗 Despiece completado');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('completarOrdenDespieceDirecto:', e);
    showToast('No se pudo completar el despiece', 'error');
  }
}

function onCambiarCantidadBuenaCompletar() {
  const ordenId = document.getElementById('co-orden-id').value;
  const orden = STATE.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  const buena = parseFloat(document.getElementById('co-cantidad-buena').value) || 0;
  const merma = Math.max(0, round2(orden.cantidad_planificada - buena));
  const wrap = document.getElementById('co-merma-motivo-wrap');
  wrap.style.display = merma > 0 ? '' : 'none';
  if (merma > 0) document.getElementById('co-merma-resumen').textContent = `Merma: ${fmtNum(merma)} unidades`;
}

async function confirmarCompletarOrden() {
  const errEl = document.getElementById('co-error');
  errEl.textContent = '';
  const ordenId = document.getElementById('co-orden-id').value;
  const orden = STATE.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  const receta = STATE.recetas.find(r => r.id === orden.receta_id);
  if (!receta) return;

  const cantidadBuenaRaw = parseFloat(document.getElementById('co-cantidad-buena').value);
  if (isNaN(cantidadBuenaRaw) || cantidadBuenaRaw < 0) { errEl.textContent = 'Indica cuántas unidades buenas salieron.'; return; }
  if (cantidadBuenaRaw > orden.cantidad_planificada) { errEl.textContent = 'No puede ser más de lo planificado.'; return; }
  const cantidadBuena = Math.max(0.01, round2(cantidadBuenaRaw));
  const mermaCantidad = Math.max(0, round2(orden.cantidad_planificada - cantidadBuenaRaw));
  const mermaMotivo = document.getElementById('co-merma-motivo').value.trim() || null;

  const { necesidades, costoMateriales } = calcularNecesidadesOrden(receta, orden.cantidad_planificada);

  try {
    const costoTotal = round2(costoMateriales + Number(orden.costo_mano_obra||0) + Number(orden.costo_indirecto||0));
    const costoUnitario = round2(costoTotal / cantidadBuena);

    await procesarConsumoYProduccion(ordenId, receta, necesidades, cantidadBuena, orden.producto_terminado_id);

    await sb.from('ordenes_produccion').update({
      estado: 'completada', cantidad_producida: cantidadBuena,
      costo_materiales: costoMateriales, costo_total: costoTotal, costo_unitario: costoUnitario,
      merma_cantidad: mermaCantidad, merma_motivo: mermaCantidad > 0 ? mermaMotivo : null,
      fecha_completada: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', ordenId).eq('auth_user_id', STATE.userId);

    showToast('🏭 Producción completada');
    closeModal('modal-completar-orden');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('confirmarCompletarOrden:', e);
    errEl.textContent = 'No se pudo completar. Intenta de nuevo.';

  }
}

async function cancelarOrden(ordenId) {
  if (!confirm('¿Cancelar esta orden pendiente? No se ha consumido ningún material todavía, así que no hay nada que revertir.')) return;
  try {
    await sb.from('ordenes_produccion').update({ estado: 'cancelada', updated_at: new Date().toISOString() })
      .eq('id', ordenId).eq('auth_user_id', STATE.userId);
    showToast('Orden cancelada');
    await cargarOrdenes();
    actualizarKPIsProduccion();
  } catch (e) { showToast('No se pudo cancelar', 'error'); }
}

async function verDetalleOrden(ordenId) {
  const orden = STATE.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  const esDespiece = orden.tipo === 'despiece';
  document.getElementById('detalle-orden-titulo').textContent = `Orden ${orden.numero}${esDespiece ? ' 🍗' : ''}`;

  let consumosHtml = '<p style="font-size:12px;color:var(--text-muted)">Todavía no se ha consumido nada (orden pendiente).</p>';
  let salidasHtml = '';
  if (orden.estado === 'completada') {
    const { data: consumos } = await sb.from('orden_produccion_consumos').select('*').eq('orden_id', ordenId);
    if (consumos && consumos.length) {
      consumosHtml = consumos.map(c => `
        <div class="prod-componente-row">
          <span>${esc(c.producto_nombre)}</span>
          <span>${fmtNum(c.cantidad_consumida)} × ${fmt(c.costo_unitario)} = <b>${fmt(c.subtotal)}</b></span>
        </div>`).join('');
    }
    if (esDespiece) {
      const { data: salidas } = await sb.from('orden_despiece_resultados').select('*').eq('orden_id', ordenId);
      if (salidas && salidas.length) {
        salidasHtml = salidas.map(s => `
          <div class="prod-componente-row">
            <span>📦 ${esc(s.producto_nombre)}</span>
            <span>${fmtNum(s.cantidad_obtenida)} unid. — <b>${fmt(s.costo_unitario)}</b>/unid. (${fmt(s.costo_asignado)})</span>
          </div>`).join('');
      }
    }
  }

  document.getElementById('detalle-orden-cuerpo').innerHTML = `
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.7">
      ${esDespiece
        ? `<div><b>Tipo:</b> Despiece / Coproductos</div><div><b>Lotes planificados:</b> ${fmtNum(orden.cantidad_planificada)}</div>`
        : `<div><b>Producto:</b> ${esc(nombreProducto(orden.producto_terminado_id))}</div>
           <div><b>Planificado:</b> ${fmtNum(orden.cantidad_planificada)} · <b>Producido:</b> ${orden.cantidad_producida!=null?fmtNum(orden.cantidad_producida):'—'}</div>`}
      <div><b>Estado:</b> ${ESTADO_ORDEN_LABEL[orden.estado]}${orden.estado==='en_proceso' ? ` (${orden.porcentaje_avance||0}% de avance)` : ''} · <b>Creada:</b> ${fmtFechaCorta(orden.fecha_planificada)}</div>
      ${orden.fecha_entrega ? `<div><b>Fecha de entrega:</b> ${fmtFechaCorta(orden.fecha_entrega)}</div>` : ''}
      ${!esDespiece && Number(orden.merma_cantidad||0) > 0 ? `<div style="color:#f59e0b"><b>⚠️ Merma:</b> ${fmtNum(orden.merma_cantidad)} unidades${orden.merma_motivo ? ` — ${esc(orden.merma_motivo)}` : ''}</div>` : ''}
    </div>
    ${orden.estado === 'completada' && !esDespiece ? `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px">
      <div class="panel-card" style="margin:0;padding:10px"><div style="font-size:11px;color:var(--text-muted)">Costo total</div><div style="font-weight:800">${fmt(orden.costo_total)}</div></div>
      <div class="panel-card" style="margin:0;padding:10px"><div style="font-size:11px;color:var(--text-muted)">Costo por unidad</div><div style="font-weight:800;color:var(--accent)">${fmt(orden.costo_unitario)}</div></div>
    </div>` : ''}
    ${orden.estado === 'completada' && esDespiece ? `
    <div class="panel-card" style="margin:0 0 14px;padding:10px"><div style="font-size:11px;color:var(--text-muted)">Costo total (repartido entre las salidas)</div><div style="font-weight:800">${fmt(orden.costo_total)}</div></div>
    <div style="font-weight:700;font-size:13px;margin-bottom:6px">Salidas obtenidas</div>
    ${salidasHtml || '<p style="font-size:12px;color:var(--text-muted)">Sin salidas registradas.</p>'}
    ` : ''}
    <div style="font-weight:700;font-size:13px;margin:14px 0 6px">Materia prima consumida</div>
    ${consumosHtml}
  `;
  document.getElementById('detalle-orden-footer').innerHTML = `<button class="btn-ghost" onclick="closeModal('modal-detalle-orden')">Cerrar</button>`;
  openModal('modal-detalle-orden');
}

/* =====================================================
   KPIs
===================================================== */
function actualizarKPIsProduccion() {
  const pendientes = STATE.ordenes.filter(o => o.estado === 'pendiente');
  const enProceso = STATE.ordenes.filter(o => o.estado === 'en_proceso');
  const activas = pendientes.length + enProceso.length;

  const hoyStr = todayLocalISO();
  const completadasHoy = STATE.ordenes.filter(o => o.estado === 'completada' && (o.fecha_completada||'').slice(0,10) === hoyStr);

  const hoy = new Date();
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
  const completadasMes = STATE.ordenes.filter(o => o.estado === 'completada' && (o.fecha_planificada||'') >= inicioMes);
  const canceladasMes = STATE.ordenes.filter(o => o.estado === 'cancelada' && (o.fecha_planificada||'') >= inicioMes);
  const totalConsideradoMes = completadasMes.length + canceladasMes.length;
  // Eficiencia: de las órdenes que ya se resolvieron este mes (terminaron
  // o se cancelaron), qué porcentaje sí llegó a completarse.
  const eficiencia = totalConsideradoMes > 0 ? round2((completadasMes.length / totalConsideradoMes) * 100) : 100;

  document.getElementById('kpi-activas').textContent = activas.toString();
  document.getElementById('kpi-en-produccion-pct').textContent = enProceso.length.toString();
  document.getElementById('kpi-completadas-hoy').textContent = completadasHoy.length.toString();
  document.getElementById('kpi-pendientes').textContent = pendientes.length.toString();
  document.getElementById('kpi-eficiencia').textContent = `${eficiencia}%`;

  renderResumenProduccion(completadasMes, canceladasMes, enProceso, pendientes, eficiencia);
  renderTablaRecetasPrincipales();
  renderConsumoMaterialesHoy();
}

// Dona de resumen (SVG puro, sin librerías) + barras de eficiencia
function renderResumenProduccion(completadasMes, canceladasMes, enProceso, pendientes, eficiencia) {
  const cont = document.getElementById('prod-donut-contenedor');
  if (!cont) return;

  const datos = [
    { valor: completadasMes.length, color: '#10b981' },
    { valor: enProceso.length,      color: '#3b82f6' },
    { valor: pendientes.length,     color: '#f59e0b' },
    { valor: canceladasMes.length,  color: '#ef4444' },
  ];
  const total = datos.reduce((s,d) => s+d.valor, 0) || 1;
  const radio = 60, grosor = 16, circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;
  const segmentos = datos.map(d => {
    const porcion = d.valor / total;
    const largo = porcion * circunferencia;
    const offset = -acumulado * circunferencia;
    acumulado += porcion;
    return `<circle cx="70" cy="70" r="${radio}" fill="none" stroke="${d.color}" stroke-width="${grosor}"
      stroke-dasharray="${largo} ${circunferencia-largo}" stroke-dashoffset="${offset}" transform="rotate(-90 70 70)"/>`;
  }).join('');

  cont.innerHTML = `
    <svg width="140" height="140" viewBox="0 0 140 140">
      ${total <= 1 && datos.every(d=>d.valor===0) ? `<circle cx="70" cy="70" r="${radio}" fill="none" stroke="var(--border)" stroke-width="${grosor}"/>` : segmentos}
      <text x="70" y="65" text-anchor="middle" style="font-size:11px;fill:var(--text-muted)">Total</text>
      <text x="70" y="83" text-anchor="middle" style="font-size:20px;font-weight:800;fill:var(--text-primary,#111)">${total===1&&datos.every(d=>d.valor===0)?0:total}</text>
    </svg>`;

  const pct = (n) => total ? Math.round((n/total)*100*10)/10 : 0;
  document.getElementById('resumen-completadas').textContent = `${completadasMes.length} (${pct(completadasMes.length)}%)`;
  document.getElementById('resumen-en-proceso').textContent = `${enProceso.length} (${pct(enProceso.length)}%)`;
  document.getElementById('resumen-pendientes').textContent = `${pendientes.length} (${pct(pendientes.length)}%)`;
  document.getElementById('resumen-canceladas').textContent = `${canceladasMes.length} (${pct(canceladasMes.length)}%)`;

  document.getElementById('resumen-eficiencia-txt').textContent = `${eficiencia}%`;
  document.getElementById('barra-eficiencia').style.width = `${Math.min(100,eficiencia)}%`;

  const totalProducido = completadasMes.reduce((s,o) => s + Number(o.cantidad_producida||0), 0);
  const totalPlanificado = completadasMes.reduce((s,o) => s + Number(o.cantidad_planificada||0), 0);
  const vsPlan = totalPlanificado > 0 ? round2(((totalProducido - totalPlanificado) / totalPlanificado) * 100) : 0;
  const vsPlanEl = document.getElementById('resumen-vs-plan-txt');
  vsPlanEl.textContent = `${vsPlan >= 0 ? '+' : ''}${vsPlan}%`;
  vsPlanEl.style.color = vsPlan >= 0 ? 'var(--success)' : 'var(--danger)';
  document.getElementById('barra-vs-plan').style.width = `${Math.min(100, Math.max(0, 50 + vsPlan))}%`;
}

// Tarjeta compacta de recetas principales (las más usadas), con
// enlace a "ver todas" -- funciona igual para comida, muebles,
// repuestos, o cualquier otra cosa que el negocio fabrique.
function renderTablaRecetasPrincipales() {
  const tbody = document.getElementById('tabla-recetas-principales');
  if (!tbody) return;
  const principales = STATE.recetas.filter(r => r.activa).slice(0, 4);
  if (!principales.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);font-size:12.5px">Todavía no tienes recetas activas.</td></tr>`;
    return;
  }
  tbody.innerHTML = principales.map(r => {
    const esDespiece = r.tipo === 'despiece';
    const producto = STATE.productos.find(p => p.id === r.producto_terminado_id);
    return `<tr>
      <td>${esDespiece ? '🍗 ' + esc(r.nombre) : esc(nombreProducto(r.producto_terminado_id))}</td>
      <td style="font-size:12px;color:var(--text-muted)">${esDespiece ? `${(r.receta_despiece_salidas||[]).length} salidas` : `1 lote = ${fmtNum(r.cantidad_producida)} unid.`}</td>
      <td>${esDespiece ? '—' : `${fmtNum(producto?.stock_actual)} unidades`}</td>
      <td>
        <button class="row-action-btn" title="Ver" onclick="abrirModalReceta('${r.id}')">👁️</button>
        <button class="row-action-btn" title="Producir" onclick="abrirModalOrden()">🏭</button>
      </td>
    </tr>`;
  }).join('');
}

// Consumo de materiales SOLO de las órdenes completadas HOY -- lo
// que de verdad se gastó hoy, comparado contra lo que había
// disponible antes de consumirlo.
async function renderConsumoMaterialesHoy() {
  const tbody = document.getElementById('tabla-consumo-materiales');
  if (!tbody) return;
  const ordenesHoy = STATE.ordenes.filter(o => o.estado === 'completada' && (o.fecha_completada||'').slice(0,10) === todayLocalISO());
  if (!ordenesHoy.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);font-size:12.5px">Todavía no se ha producido nada hoy.</td></tr>`;
    return;
  }
  try {
    const { data: consumos } = await sb.from('orden_produccion_consumos').select('producto_id, producto_nombre, cantidad_consumida')
      .in('orden_id', ordenesHoy.map(o => o.id));
    const porMaterial = new Map();
    (consumos||[]).forEach(c => {
      const acc = porMaterial.get(c.producto_id) || { nombre: c.producto_nombre, consumido: 0 };
      acc.consumido += Number(c.cantidad_consumida||0);
      porMaterial.set(c.producto_id, acc);
    });
    if (!porMaterial.size) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);font-size:12.5px">Sin consumo de materiales hoy.</td></tr>`; return; }

    tbody.innerHTML = Array.from(porMaterial.entries()).map(([productoId, info]) => {
      const producto = STATE.productos.find(p => p.id === productoId);
      const disponible = Number(producto?.stock_actual || 0);
      const colorDisp = disponible <= 0 ? 'var(--danger)' : (disponible < info.consumido ? '#f59e0b' : 'var(--success)');
      return `<tr>
        <td>${esc(info.nombre)}</td>
        <td>${fmtNum(info.consumido)}</td>
        <td>${fmtNum(info.consumido)}</td>
        <td style="color:${colorDisp};font-weight:600">${fmtNum(disponible)}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--danger);font-size:12.5px">No se pudo cargar el consumo de hoy.</td></tr>`;
  }
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });
  initBusquedaComponenteReceta();
  initBusquedaSalidaDespiece();

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarProductosCache();
    await Promise.all([cargarRecetas(), cargarOrdenes()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('init producción:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});


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
