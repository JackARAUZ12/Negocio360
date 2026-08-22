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
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$';
  return `${sym} ${Number(amount||0).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
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
   PESTAÑAS
===================================================== */
function cambiarTabProduccion(tab) {
  STATE.tabActivo = tab;
  document.querySelectorAll('.prod-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tab-ordenes').style.display = tab === 'ordenes' ? '' : 'none';
  document.getElementById('tab-recetas').style.display = tab === 'recetas' ? '' : 'none';
}

/* =====================================================
   RECETAS (BOM)
===================================================== */
async function cargarRecetas() {
  try {
    const { data } = await sb.from('recetas_produccion')
      .select('*, receta_componentes(id, producto_id, cantidad)')
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
    return `<tr>
      <td><strong>${esc(r.nombre)}</strong></td>
      <td>${esc(nombreProducto(r.producto_terminado_id))}</td>
      <td>${fmtNum(r.cantidad_producida)} unidad${r.cantidad_producida==1?'':'es'}</td>
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

function abrirModalReceta(id) {
  document.getElementById('rc-error').textContent = '';
  document.getElementById('rc-id').value = id || '';
  llenarSelectProductosTerminados();
  STATE.componentesRecetaActual = [];
  document.getElementById('rc-buscar-componente').value = '';
  document.getElementById('rc-buscar-resultados').innerHTML = '';

  if (id) {
    const r = STATE.recetas.find(x => x.id === id);
    if (!r) return;
    document.getElementById('receta-titulo-modal').textContent = '✏️ Editar receta';
    document.getElementById('rc-producto-terminado').value = r.producto_terminado_id;
    document.getElementById('rc-nombre').value = r.nombre;
    document.getElementById('rc-cantidad-produce').value = r.cantidad_producida;
    STATE.componentesRecetaActual = (r.receta_componentes||[]).map(c => ({
      producto_id: c.producto_id, nombre: nombreProducto(c.producto_id), cantidad: c.cantidad,
    }));
  } else {
    document.getElementById('receta-titulo-modal').textContent = '🧪 Nueva receta';
    document.getElementById('rc-nombre').value = 'Receta estándar';
    document.getElementById('rc-cantidad-produce').value = 1;
  }
  renderListaComponentesReceta();
  openModal('modal-receta');
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
  const productoTerminadoId = document.getElementById('rc-producto-terminado').value;
  const nombre = document.getElementById('rc-nombre').value.trim();
  const cantidadProduce = parseFloat(document.getElementById('rc-cantidad-produce').value);

  if (!productoTerminadoId) { errEl.textContent = 'Elige el producto terminado.'; return; }
  if (!nombre) { errEl.textContent = 'El nombre de la receta es obligatorio.'; return; }
  if (!cantidadProduce || cantidadProduce <= 0) { errEl.textContent = 'La cantidad que produce debe ser mayor a cero.'; return; }
  if (!STATE.componentesRecetaActual.length) { errEl.textContent = 'Agrega al menos una materia prima.'; return; }

  setBtnLoading('btn-guardar-receta', true);
  try {
    const payload = {
      auth_user_id: STATE.userId, producto_terminado_id: productoTerminadoId,
      nombre, cantidad_producida: cantidadProduce, updated_at: new Date().toISOString(),
    };
    let recetaId = id;
    if (id) {
      const { error } = await sb.from('recetas_produccion').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
      if (error) throw error;
      await sb.from('receta_componentes').delete().eq('receta_id', id).eq('auth_user_id', STATE.userId);
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

const ESTADO_ORDEN_LABEL = { planificada:'Planificada', completada:'Completada', cancelada:'Cancelada' };
const ESTADO_ORDEN_CLASE = { planificada:'status-pendiente', completada:'status-activo', cancelada:'status-inactivo' };

function renderTablaOrdenes() {
  const tbody = document.getElementById('tabla-ordenes-produccion');
  if (!tbody) return;
  if (!STATE.ordenes.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Todavía no has creado ninguna orden de producción.</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.ordenes.map(o => `
    <tr>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(o.numero)}</span></td>
      <td>${esc(nombreProducto(o.producto_terminado_id))}</td>
      <td>${fmtNum(o.cantidad_planificada)}</td>
      <td>${o.cantidad_producida!=null ? fmtNum(o.cantidad_producida) : '—'}</td>
      <td><span class="status-badge ${ESTADO_ORDEN_CLASE[o.estado]}">${ESTADO_ORDEN_LABEL[o.estado]}</span></td>
      <td>${o.costo_unitario ? fmt(o.costo_unitario) : '—'}</td>
      <td>${fmtFechaCorta(o.fecha_planificada)}</td>
      <td>
        <button class="row-action-btn" title="Ver detalle" onclick="verDetalleOrden('${o.id}')">👁️</button>
        ${o.estado==='planificada' ? `<button class="row-action-btn" title="Completar" onclick="completarOrdenPlanificada('${o.id}')" style="color:var(--success)">✅</button>` : ''}
        ${o.estado==='planificada' ? `<button class="row-action-btn" title="Cancelar" onclick="cancelarOrden('${o.id}')" style="color:var(--danger)">🗑️</button>` : ''}
      </td>
    </tr>`).join('');
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
  document.getElementById('op-fecha').value = todayLocalISO();
  document.getElementById('op-costo-mano-obra').value = 0;
  document.getElementById('op-costo-indirecto').value = 0;
  document.getElementById('op-necesidades-wrap').style.display = 'none';
  document.getElementById('op-resumen-costo').style.display = 'none';
  if (!STATE.recetas.filter(r=>r.activa).length) {
    document.getElementById('op-error').textContent = 'Primero crea una receta activa para poder producir.';
  }
  openModal('modal-orden');
}

function onCambiarRecetaOrden() {
  const receta = STATE.recetas.find(r => r.id === document.getElementById('op-receta').value);
  if (receta) document.getElementById('op-cantidad').value = receta.cantidad_producida;
  recalcularNecesidadesOrden();
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
  if (!recetaId || !cantidad || cantidad <= 0) { wrap.style.display = 'none'; resumenEl.style.display = 'none'; return; }

  const receta = STATE.recetas.find(r => r.id === recetaId);
  if (!receta) return;

  const { necesidades, costoMateriales, todoSuficiente } = calcularNecesidadesOrden(receta, cantidad);
  document.getElementById('op-necesidades-lista').innerHTML = necesidades.map(n => `
    <div class="prod-componente-row">
      <span>${n.suficiente ? '✅' : '⚠️'} ${esc(n.nombre)}</span>
      <span style="font-family:var(--font-mono)">${fmtNum(n.necesario)} / ${fmtNum(n.disponible)} disp.</span>
    </div>`).join('');
  wrap.style.display = '';

  const manoObra = parseFloat(document.getElementById('op-costo-mano-obra').value) || 0;
  const indirecto = parseFloat(document.getElementById('op-costo-indirecto').value) || 0;
  const costoTotal = round2(costoMateriales + manoObra + indirecto);
  const costoUnitario = round2(costoTotal / cantidad);

  resumenEl.innerHTML = `
    <div style="display:flex;justify-content:space-between"><span>Costo de materiales:</span><b>${fmt(costoMateriales)}</b></div>
    <div style="display:flex;justify-content:space-between"><span>Mano de obra + indirectos:</span><b>${fmt(manoObra+indirecto)}</b></div>
    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:6px;padding-top:6px"><span>Costo total:</span><b>${fmt(costoTotal)}</b></div>
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

async function guardarOrden(estadoDeseado) {
  const errEl = document.getElementById('op-error');
  errEl.textContent = '';
  const recetaId = document.getElementById('op-receta').value;
  const cantidad = parseFloat(document.getElementById('op-cantidad').value);
  const fecha = document.getElementById('op-fecha').value || todayLocalISO();
  const manoObra = parseFloat(document.getElementById('op-costo-mano-obra').value) || 0;
  const indirecto = parseFloat(document.getElementById('op-costo-indirecto').value) || 0;

  if (!recetaId) { errEl.textContent = 'Elige una receta.'; return; }
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'La cantidad a producir debe ser mayor a cero.'; return; }

  const receta = STATE.recetas.find(r => r.id === recetaId);
  const { necesidades, costoMateriales, todoSuficiente } = calcularNecesidadesOrden(receta, cantidad);

  if (estadoDeseado === 'completada' && !todoSuficiente) {
    errEl.textContent = 'No hay suficiente materia prima para completar esta producción ahora. Guárdala como planificada, o ajusta la cantidad.';
    return;
  }

  try {
    const { data: numero } = await sb.rpc('generar_numero_orden_produccion', { p_user_id: STATE.userId });
    const costoTotal = round2(costoMateriales + manoObra + indirecto);
    const costoUnitario = round2(costoTotal / cantidad);

    const payload = {
      auth_user_id: STATE.userId, numero: numero || `OP-${Date.now()}`,
      receta_id: recetaId, producto_terminado_id: receta.producto_terminado_id,
      cantidad_planificada: cantidad, fecha_planificada: fecha,
      costo_mano_obra: manoObra, costo_indirecto: indirecto,
      usuario_nombre: STATE.currentUser?.nombre || 'Usuario',
      estado: estadoDeseado,
    };
    if (estadoDeseado === 'completada') {
      Object.assign(payload, {
        cantidad_producida: cantidad, costo_materiales: costoMateriales,
        costo_total: costoTotal, costo_unitario: costoUnitario,
        fecha_completada: new Date().toISOString(),
      });
    }

    const { data: orden, error } = await sb.from('ordenes_produccion').insert(payload).select('id').single();
    if (error) throw error;

    if (estadoDeseado === 'completada') {
      await procesarConsumoYProduccion(orden.id, receta, necesidades, cantidad, receta.producto_terminado_id);
    }

    showToast(estadoDeseado === 'completada' ? '🏭 Producción completada' : 'Orden guardada como planificada');
    closeModal('modal-orden');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('guardarOrden:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  }
}

async function completarOrdenPlanificada(ordenId) {
  const orden = STATE.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  const receta = STATE.recetas.find(r => r.id === orden.receta_id);
  if (!receta) { showToast('No se encontró la receta de esta orden', 'error'); return; }

  const { necesidades, costoMateriales, todoSuficiente } = calcularNecesidadesOrden(receta, orden.cantidad_planificada);
  if (!todoSuficiente) {
    showToast('No hay suficiente materia prima todavía para completar esta orden', 'error');
    return;
  }
  if (!confirm(`¿Completar la producción de ${fmtNum(orden.cantidad_planificada)} unidades? Esto descontará la materia prima y agregará el producto terminado al inventario.`)) return;

  try {
    const costoTotal = round2(costoMateriales + Number(orden.costo_mano_obra||0) + Number(orden.costo_indirecto||0));
    const costoUnitario = round2(costoTotal / orden.cantidad_planificada);

    await procesarConsumoYProduccion(ordenId, receta, necesidades, orden.cantidad_planificada, orden.producto_terminado_id);

    await sb.from('ordenes_produccion').update({
      estado: 'completada', cantidad_producida: orden.cantidad_planificada,
      costo_materiales: costoMateriales, costo_total: costoTotal, costo_unitario: costoUnitario,
      fecha_completada: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', ordenId).eq('auth_user_id', STATE.userId);

    showToast('🏭 Producción completada');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('completarOrdenPlanificada:', e);
    showToast('No se pudo completar la producción', 'error');
  }
}

async function cancelarOrden(ordenId) {
  if (!confirm('¿Cancelar esta orden planificada? No se ha consumido ningún material todavía, así que no hay nada que revertir.')) return;
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
  document.getElementById('detalle-orden-titulo').textContent = `Orden ${orden.numero}`;

  let consumosHtml = '<p style="font-size:12px;color:var(--text-muted)">Todavía no se ha consumido nada (orden planificada).</p>';
  if (orden.estado === 'completada') {
    const { data: consumos } = await sb.from('orden_produccion_consumos').select('*').eq('orden_id', ordenId);
    if (consumos && consumos.length) {
      consumosHtml = consumos.map(c => `
        <div class="prod-componente-row">
          <span>${esc(c.producto_nombre)}</span>
          <span>${fmtNum(c.cantidad_consumida)} × ${fmt(c.costo_unitario)} = <b>${fmt(c.subtotal)}</b></span>
        </div>`).join('');
    }
  }

  document.getElementById('detalle-orden-cuerpo').innerHTML = `
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.7">
      <div><b>Producto:</b> ${esc(nombreProducto(orden.producto_terminado_id))}</div>
      <div><b>Planificado:</b> ${fmtNum(orden.cantidad_planificada)} · <b>Producido:</b> ${orden.cantidad_producida!=null?fmtNum(orden.cantidad_producida):'—'}</div>
      <div><b>Estado:</b> ${ESTADO_ORDEN_LABEL[orden.estado]} · <b>Fecha:</b> ${fmtFechaCorta(orden.fecha_planificada)}</div>
    </div>
    ${orden.estado === 'completada' ? `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px">
      <div class="panel-card" style="margin:0;padding:10px"><div style="font-size:11px;color:var(--text-muted)">Costo total</div><div style="font-weight:800">${fmt(orden.costo_total)}</div></div>
      <div class="panel-card" style="margin:0;padding:10px"><div style="font-size:11px;color:var(--text-muted)">Costo por unidad</div><div style="font-weight:800;color:var(--accent)">${fmt(orden.costo_unitario)}</div></div>
    </div>` : ''}
    <div style="font-weight:700;font-size:13px;margin-bottom:6px">Materia prima consumida</div>
    ${consumosHtml}
  `;
  document.getElementById('detalle-orden-footer').innerHTML = `<button class="btn-ghost" onclick="closeModal('modal-detalle-orden')">Cerrar</button>`;
  openModal('modal-detalle-orden');
}

/* =====================================================
   KPIs
===================================================== */
function actualizarKPIsProduccion() {
  const planificadas = STATE.ordenes.filter(o => o.estado === 'planificada').length;
  const hoy = new Date();
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
  const completadasMes = STATE.ordenes.filter(o => o.estado === 'completada' && (o.fecha_planificada||'') >= inicioMes);
  const producidoMes = completadasMes.reduce((s,o) => s + Number(o.cantidad_producida||0), 0);
  const costoMes = completadasMes.reduce((s,o) => s + Number(o.costo_materiales||0), 0);
  const recetasActivas = STATE.recetas.filter(r => r.activa).length;

  document.getElementById('kpi-planificadas').textContent = planificadas.toString();
  document.getElementById('kpi-producido-mes').textContent = fmtNum(producidoMes);
  document.getElementById('kpi-costo-mes').textContent = fmt(costoMes);
  document.getElementById('kpi-recetas-activas').textContent = recetasActivas.toString();
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });
  initBusquedaComponenteReceta();

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
