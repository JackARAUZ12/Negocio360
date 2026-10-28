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

/* =====================================================
   INGRESAR MATERIA PRIMA — misma función que "Nuevo Producto" en
   Productos/Servicios (con es_materia_prima=true de una vez), pero
   accesible directo desde Producción, sin salir del módulo. No
   toca productos.js en absoluto -- implementación propia y
   autónoma, para no arriesgar nada de lo que ya funciona ahí.
===================================================== */
function abrirModalIngresarMateriaPrima() {
  // Reset del formulario "nueva"
  document.getElementById('mp-nombre').value = '';
  document.getElementById('mp-sku').value = '';
  document.getElementById('mp-categoria').value = '';
  document.getElementById('mp-costo').value = '';
  document.getElementById('mp-stock-inicial').value = '';
  document.getElementById('mp-stock-minimo').value = '';
  llenarUnidadesMP();
  setDescontarCajaMateriaPrima(true);
  actualizarResumenMateriaPrima();

  // Reset del formulario "existente"
  document.getElementById('mp-existente-cantidad').value = '';
  document.getElementById('mp-existente-costo').value = '';
  document.getElementById('mp-existente-stock-actual').textContent = '';
  STATE.materiaPrimaExistenteSeleccionada = null;
  setDescontarCajaMateriaPrimaExistente(true);
  actualizarResumenMateriaPrimaExistente();

  document.getElementById('mp-error').textContent = '';

  // Siempre arranca en la pantalla de elección
  volverAEleccionMateriaPrima();
  openModal('modal-materia-prima');
}

// Unidad de la materia prima (la de inventario y, si se compra distinto, la de compra con su equivalencia).
function llenarUnidadesMP() {
  const U = window.N360Unidades; const todas = U ? U.todas() : [];
  const ops = todas.map(u => `<option value="${esc(u.codigo)}">${esc(u.nombre)}${u.abreviatura ? ' (' + esc(u.abreviatura) + ')' : ''}</option>`).join('');
  document.getElementById('mp-unidad').innerHTML = '<option value="">Unidad (sin especificar)</option>' + ops;
  document.getElementById('mp-unidad-compra').innerHTML = '<option value="">No, igual</option>' + ops;
  document.getElementById('mp-factor').value = '';
  alCambiarUnidadMP();
}
function alCambiarUnidadMP() {
  const u = document.getElementById('mp-unidad').value, c = document.getElementById('mp-unidad-compra').value;
  const nu = u ? nombreUnidad(u) : 'unidad', nus = u ? nombreUnidad(u, true) : 'unidades';
  document.getElementById('mp-costo-label').textContent = `Costo por ${nu} *`;
  document.getElementById('mp-stock-label').textContent = `Cantidad que tienes (en ${nus}) *`;
  const wrap = document.getElementById('mp-factor-wrap'), f = document.getElementById('mp-factor');
  if (c && c !== u) {
    wrap.style.display = '';
    document.getElementById('mp-factor-label').textContent = `¿Cuántas ${nus} trae 1 ${nombreUnidad(c)}? *`;
    const auto = factorUnidad(c, { unidad_codigo: u });           // quintal → libras = 100, etc.
    if (auto && auto !== 1 && !f.value) f.value = Math.round(auto * 10000) / 10000;
  } else { wrap.style.display = 'none'; f.value = ''; }
}

// El modal siempre arranca preguntando que se quiere hacer -- no
// asume "nueva" por defecto, para que quede claro que tambien se
// puede agregar stock a algo que ya existe.
function elegirModoMateriaPrima(modo) {
  document.getElementById('mp-paso-eleccion').style.display = 'none';
  document.getElementById('mp-form-nueva').style.display = modo === 'nueva' ? 'block' : 'none';
  document.getElementById('mp-form-existente').style.display = modo === 'existente' ? 'block' : 'none';
  document.getElementById('mp-btn-guardar').style.display = modo === 'nueva' ? 'inline-flex' : 'none';
  document.getElementById('mp-existente-btn-guardar').style.display = modo === 'existente' ? 'inline-flex' : 'none';

  if (modo === 'existente') {
    cargarMateriasPrimasParaSelector();
  }
}

function volverAEleccionMateriaPrima() {
  document.getElementById('mp-paso-eleccion').style.display = 'block';
  document.getElementById('mp-form-nueva').style.display = 'none';
  document.getElementById('mp-form-existente').style.display = 'none';
  document.getElementById('mp-btn-guardar').style.display = 'none';
  document.getElementById('mp-existente-btn-guardar').style.display = 'none';
}

async function cargarMateriasPrimasParaSelector() {
  const sel = document.getElementById('mp-existente-select');
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    const { data } = await N360Leer.todo(() => sb.from('productos')
      .select('id,nombre,sku,costo,stock_actual')
      .eq('auth_user_id', STATE.userId).eq('es_materia_prima', true).eq('activo', true)
      .order('nombre'), 'productos');
    STATE.materiasPrimasDisponibles = data || [];
    poblarSelectorMateriaPrimaExistente(STATE.materiasPrimasDisponibles);
  } catch (e) {
    sel.innerHTML = '<option value="">No se pudieron cargar</option>';
  }
}

function poblarSelectorMateriaPrimaExistente(materias) {
  STATE.materiasPrimasDisponibles = materias;
  const sel = document.getElementById('mp-existente-select');
  if (!materias.length) {
    sel.innerHTML = '<option value="">No tienes materias primas registradas todavía</option>';
    return;
  }
  sel.innerHTML = '<option value="">— Elige una —</option>' +
    materias.map(m => `<option value="${m.id}">${esc(m.nombre)}${m.sku ? ' ('+esc(m.sku)+')' : ''}</option>`).join('');
}

function onSeleccionarMateriaPrimaExistente() {
  const id = document.getElementById('mp-existente-select')?.value;
  const materia = (STATE.materiasPrimasDisponibles || []).find(m => m.id === id) || null;
  STATE.materiaPrimaExistenteSeleccionada = materia;
  const info = document.getElementById('mp-existente-stock-actual');
  if (materia) {
    info.textContent = `Stock actual: ${materia.stock_actual} — costo guardado: ${fmt(materia.costo)}`;
    // Se sugiere el mismo costo guardado, editable por si esta
    // entrada cuesta distinto.
    const costoInput = document.getElementById('mp-existente-costo');
    if (!costoInput.value) costoInput.value = materia.costo;
  } else {
    info.textContent = '';
  }
  actualizarResumenMateriaPrimaExistente();
}

function setDescontarCajaMateriaPrimaExistente(descontar) {
  STATE.descontarCajaMateriaPrimaExistente = descontar;
  const btnSi = document.getElementById('mp-existente-caja-si');
  const btnNo = document.getElementById('mp-existente-caja-no');
  btnSi.style.borderColor = descontar ? 'var(--accent)' : '';
  btnSi.style.background  = descontar ? 'var(--accent-soft)' : '';
  btnNo.style.borderColor = !descontar ? 'var(--accent)' : '';
  btnNo.style.background  = !descontar ? 'var(--accent-soft)' : '';
}

function actualizarResumenMateriaPrimaExistente() {
  const cantidad = Number(document.getElementById('mp-existente-cantidad')?.value) || 0;
  const costo = Number(document.getElementById('mp-existente-costo')?.value) || 0;
  const monto = cantidad * costo;
  const resumen = document.getElementById('mp-existente-monto-resumen');
  if (resumen) resumen.textContent = monto > 0 ? `— esta compra es ${fmt(monto)}` : '';
}

// Interruptor claro y SIEMPRE visible (antes era un checkbox que
// solo aparecía si ya había un monto escrito -- podía pasar
// desapercibido). Ahora la elección es explícita desde el principio.
function setDescontarCajaMateriaPrima(descontar) {
  STATE.descontarCajaMateriaPrima = descontar;
  const btnSi = document.getElementById('mp-caja-si');
  const btnNo = document.getElementById('mp-caja-no');
  btnSi.style.borderColor = descontar ? 'var(--accent)' : '';
  btnSi.style.background  = descontar ? 'var(--accent-soft)' : '';
  btnNo.style.borderColor = !descontar ? 'var(--accent)' : '';
  btnNo.style.background  = !descontar ? 'var(--accent-soft)' : '';
}

function actualizarResumenMateriaPrima() {
  const costo = Number(document.getElementById('mp-costo')?.value) || 0;
  const stock = Number(document.getElementById('mp-stock-inicial')?.value) || 0;
  const monto = costo * stock;
  const resumen = document.getElementById('mp-monto-resumen');
  resumen.textContent = monto > 0 ? `— esta compra es ${fmt(monto)}` : '';
}

async function guardarMateriaPrima() {
  const errEl = document.getElementById('mp-error');
  errEl.textContent = '';

  const nombre = document.getElementById('mp-nombre')?.value.trim();
  if (!nombre) { errEl.textContent = 'Escribe el nombre de la materia prima.'; return; }
  const costo = Number(document.getElementById('mp-costo')?.value);
  if (isNaN(costo) || costo < 0) { errEl.textContent = 'Escribe un costo válido.'; return; }
  const stockInicial = Number(document.getElementById('mp-stock-inicial')?.value);
  if (isNaN(stockInicial) || stockInicial < 0) { errEl.textContent = 'Escribe un stock inicial válido.'; return; }
  const stockMinimo = Number(document.getElementById('mp-stock-minimo')?.value) || 0;
  const sku = document.getElementById('mp-sku')?.value.trim() || null;
  const categoria = document.getElementById('mp-categoria')?.value.trim() || null;
  const descontarCaja = STATE.descontarCajaMateriaPrima !== false;
  const montoCompra = costo * stockInicial;
  const unidad = document.getElementById('mp-unidad')?.value || '';
  const unidadCompra = document.getElementById('mp-unidad-compra')?.value || '';
  const factorCompra = parseFloat(document.getElementById('mp-factor')?.value);
  if (unidadCompra && unidadCompra !== unidad && !(factorCompra > 0)) { errEl.textContent = 'Escribe cuántas trae la unidad de compra.'; return; }
  const uSel = unidad && window.N360Unidades ? window.N360Unidades.porCodigo(unidad) : null;
  const camposUnidad = uSel ? { unidad_codigo: uSel.codigo, unidad_medida: uSel.nombre.toLowerCase(), permite_fraccion: !!uSel.fraccionable } : {};
  if (unidadCompra && unidadCompra !== unidad && factorCompra > 0) Object.assign(camposUnidad, { unidad_compra_codigo: unidadCompra, factor_compra: factorCompra });

  setBtnLoading('mp-btn-guardar', true);
  try {
    const { data: materiaPrima, error: errMP } = await sb.from('productos').insert({
      auth_user_id: STATE.userId, tipo: 'producto', nombre, sku, categoria,
      costo, precio: 0, tipo_precio: 'fijo',
      stock_actual: stockInicial, stock_minimo: stockMinimo,
      es_materia_prima: true, activo: true, ...camposUnidad,
    }).select().single();
    if (errMP) throw errMP;

    // Mismo mecanismo exacto que ya usa Productos/Servicios al crear
    // un producto con stock inicial: descuenta de Caja SOLO si hay
    // costo x cantidad > 0 y el usuario dejó la casilla marcada.
    if (descontarCaja && montoCompra > 0) {
      try {
        const { data: ultMov } = await sb.from('movimientos_financieros')
          .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado', 'completado')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const saldoAnterior = ultMov ? Number(ultMov.saldo_resultante) : 0;
        const saldoResultante = saldoAnterior - montoCompra;

        await sb.from('movimientos_financieros').insert({
          auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'COMPRA',
          concepto: `Compra de materia prima: ${nombre}`, monto: montoCompra,
          saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
          metodo_pago_nombre: 'Efectivo', referencia_tipo: 'producto', referencia_id: materiaPrima.id,
          fecha: ymdLocal(new Date()), estado: 'completado',
        });
      } catch (eCaja) {
        console.warn('No se pudo descontar de Caja (la materia prima ya quedó guardada):', eCaja);
        showToast('Materia prima guardada, pero no se pudo descontar de Caja', 'error');
      }
    }

    closeModal('modal-materia-prima');
    showToast(`"${nombre}" agregada a tu inventario de materia prima`);
    await cargarProductosCache(); // refresca la caché para que ya aparezca disponible en recetas/órdenes
  } catch (e) {
    console.error('guardarMateriaPrima:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message || '');
  } finally {
    setBtnLoading('mp-btn-guardar', false);
  }
}

// Agregar stock a una materia prima que YA EXISTE -- usa el mismo
// RPC atomico que ya usa Compras (incrementar_stock_producto),
// nunca modifica el costo guardado del producto (igual que hace
// Compras al comprar mas de un producto que ya existe).
async function guardarStockMateriaPrimaExistente() {
  const errEl = document.getElementById('mp-error');
  errEl.textContent = '';

  const materia = STATE.materiaPrimaExistenteSeleccionada;
  if (!materia) { errEl.textContent = 'Elige una materia prima.'; return; }
  const cantidad = Number(document.getElementById('mp-existente-cantidad')?.value);
  if (!cantidad || cantidad <= 0) { errEl.textContent = 'Escribe una cantidad válida.'; return; }
  const costoEntrada = Number(document.getElementById('mp-existente-costo')?.value);
  if (isNaN(costoEntrada) || costoEntrada < 0) { errEl.textContent = 'Escribe un costo válido para esta entrada.'; return; }
  const descontarCaja = STATE.descontarCajaMateriaPrimaExistente !== false;
  const montoCompra = cantidad * costoEntrada;

  setBtnLoading('mp-existente-btn-guardar', true);
  try {
    const { data: resultado, error: errStock } = await sb.rpc('incrementar_stock_producto', {
      p_producto_id: materia.id, p_auth_user_id: STATE.userId, p_cantidad: cantidad,
    });
    if (errStock) throw errStock;
    const stockNuevo = resultado && resultado.length ? resultado[0].stock_actual : null;

    if (descontarCaja && montoCompra > 0) {
      try {
        const { data: ultMov } = await sb.from('movimientos_financieros')
          .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado', 'completado')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const saldoAnterior = ultMov ? Number(ultMov.saldo_resultante) : 0;
        const saldoResultante = saldoAnterior - montoCompra;

        await sb.from('movimientos_financieros').insert({
          auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'COMPRA',
          concepto: `Compra de materia prima: ${materia.nombre}`, monto: montoCompra,
          saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
          metodo_pago_nombre: 'Efectivo', referencia_tipo: 'producto', referencia_id: materia.id,
          fecha: ymdLocal(new Date()), estado: 'completado',
        });
      } catch (eCaja) {
        console.warn('No se pudo descontar de Caja (el stock ya quedó actualizado):', eCaja);
        showToast('Stock actualizado, pero no se pudo descontar de Caja', 'error');
      }
    }

    closeModal('modal-materia-prima');
    showToast(`"${materia.nombre}" ahora tiene ${stockNuevo ?? '—'} en stock`);
    await cargarProductosCache();
  } catch (e) {
    console.error('guardarStockMateriaPrimaExistente:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message || '');
  } finally {
    setBtnLoading('mp-existente-btn-guardar', false);
  }
}

async function cargarProductosCache() {
  try {
    const { data } = await N360Leer.todo(() => sb.from('productos').select('id,nombre,sku,tipo,costo,precio,stock_actual,activo,es_materia_prima,unidad_codigo,unidad_compra_codigo,factor_compra')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre'), 'productos');
    STATE.productos = data || [];
  } catch (e) { STATE.productos = []; }
  try { if (STATE.recetas.length) renderProducirHoy(); } catch (e) {}
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
      .select('*, receta_componentes(id, producto_id, cantidad, unidad_codigo, uso_continuo), receta_despiece_salidas(id, producto_id, cantidad_rendimiento, es_merma)')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    STATE.recetas = data || [];
    renderTablaRecetas();
  } catch (e) { console.error('cargarRecetas:', e); }
}

function nombreProducto(id) { return STATE.productos.find(p => p.id === id)?.nombre || '—'; }

/* ---------- Unidades en las recetas (misma regla que el servidor: _unidad_factor) ----------
   La receta puede decir "0.25 quintal" o "2 onzas" aunque el inventario esté en libras.
   Factor = cuántas unidades de inventario del producto son 1 unidad de la receta. */
const UNIDAD_BASE = { gramo:['peso',1], kilogramo:['peso',1000], libra:['peso',453.59237], onza:['peso',28.349523125], quintal:['peso',45359.237], tonelada:['peso',1000000],
  mililitro:['volumen',1], litro:['volumen',1000], galon:['volumen',3785.411784],
  centimetro:['longitud',1], metro:['longitud',100], pulgada:['longitud',2.54], pie:['longitud',30.48], yarda:['longitud',91.44], vara:['longitud',83.59],
  unidad:['conteo',1], docena:['conteo',12], par:['conteo',2] };
function factorUnidad(desde, prod) {
  const u = prod?.unidad_codigo || '';
  if (!desde || desde === u) return 1;
  if (desde === prod?.unidad_compra_codigo && Number(prod?.factor_compra) > 0) return Number(prod.factor_compra);
  const a = UNIDAD_BASE[desde], b = UNIDAD_BASE[u];
  return a && b && a[0] === b[0] ? a[1] / b[1] : null;
}
function nombreUnidad(cod, plural) {
  if (!cod) return '';
  const u = window.N360Unidades?.porCodigo(cod);
  return u ? (plural ? u.plural : u.nombre).toLowerCase() : cod;
}
// Unidades en que se puede escribir un ingrediente: la suya, la de compra y las convertibles.
function unidadesPosibles(prod) {
  if (!prod) return [];
  const lista = [prod.unidad_codigo || ''];
  if (prod.unidad_compra_codigo && Number(prod.factor_compra) > 0) lista.push(prod.unidad_compra_codigo);
  const base = UNIDAD_BASE[prod.unidad_codigo];
  if (base) Object.keys(UNIDAD_BASE).forEach(k => { if (UNIDAD_BASE[k][0] === base[0]) lista.push(k); });
  return [...new Set(lista)];
}
function textoUnidadInventario(prod) { return prod?.unidad_codigo ? nombreUnidad(prod.unidad_codigo, true) : 'unidades'; }

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
    actualizarKPIsProduccion();
  } catch (e) { showToast('No se pudo eliminar', 'error'); }
}

function llenarSelectProductosTerminados() {
  const opciones = STATE.productos.filter(p => p.tipo === 'producto').map(p =>
    `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  const sel = document.getElementById('rc-producto-terminado');
  if (sel) sel.innerHTML = opciones;
}

function alCambiarAlVender() {
  const si = document.getElementById('rc-al-vender').checked;
  const cant = document.getElementById('rc-cantidad-produce');
  if (si && (!cant.value || Number(cant.value) !== 1)) cant.value = 1;          // un plato = una receta
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
      producto_id: c.producto_id, nombre: nombreProducto(c.producto_id), cantidad: c.cantidad, unidad_codigo: c.unidad_codigo || '', uso_continuo: !!c.uso_continuo,
    }));
    document.getElementById('rc-al-vender').checked = !!r.al_vender;
    document.getElementById('rc-costo-extra').value = Number(r.costo_extra_tanda || 0) || '';
  } else {
    document.getElementById('receta-titulo-modal').textContent = '🧪 Nueva receta';
    document.getElementById('rc-nombre').value = 'Receta estándar';
    document.getElementById('rc-cantidad-produce').value = 1;
    document.getElementById('rc-costo-extra').value = '';
    document.getElementById('rc-al-vender').checked = false;
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
  cont.innerHTML = STATE.componentesRecetaActual.map((c, i) => {
    const prod = STATE.productos.find(p => p.id === c.producto_id);
    const ops = unidadesPosibles(prod);
    const fu = factorUnidad(c.unidad_codigo, prod);
    const equiv = c.unidad_codigo && fu != null && prod?.unidad_codigo && c.unidad_codigo !== prod.unidad_codigo
      ? `= ${fmtNum(Math.round(c.cantidad * fu * 1000) / 1000)} ${textoUnidadInventario(prod)}` : '';
    return `
    <div class="prod-componente-row" style="flex-wrap:wrap;gap:6px">
      <span style="min-width:0;flex:1 1 140px">${esc(c.nombre)}<span class="rc-equiv" style="display:block;font-size:11px;color:var(--text-muted)">${esc(equiv)}</span></span>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <input type="number" min="0.001" step="0.001" value="${c.cantidad}" style="width:78px" aria-label="Cantidad de ${esc(c.nombre)}" onchange="cambiarCantidadComponente(${i}, this.value)"/>
        ${ops.length > 1 ? `<select data-unidad="${i}" aria-label="Unidad de ${esc(c.nombre)}" style="width:auto;max-width:120px" onchange="cambiarUnidadComponente(${i}, this.value)">
          ${ops.map(u => `<option value="${esc(u === (prod?.unidad_codigo || '') ? '' : u)}" ${(c.unidad_codigo || '') === (u === (prod?.unidad_codigo || '') ? '' : u) ? 'selected' : ''}>${esc(u ? nombreUnidad(u, true) : 'unidades')}</option>`).join('')}
        </select>` : `<span style="font-size:12px;color:var(--text-muted)">${esc(textoUnidadInventario(prod))}</span>`}
        <button type="button" class="row-action-btn" title="Quitar" onclick="quitarComponenteReceta(${i})" style="color:var(--danger)">✕</button>
      </div>
      <label class="rc-continuo" style="flex-basis:100%"><input type="checkbox" data-continuo="${i}" ${c.uso_continuo ? 'checked' : ''} onchange="STATE.componentesRecetaActual[${i}].uso_continuo = this.checked"/> Se va gastando con el tiempo (aceite, gas, sal…): no se descuenta por ${STATE.tipoRecetaActual === 'despiece' ? 'lote' : 'tanda ni por plato'}</label>
    </div>`; }).join('');
}
function cambiarUnidadComponente(idx, valor) {
  STATE.componentesRecetaActual[idx].unidad_codigo = valor || '';
  renderListaComponentesReceta();
}

function cambiarCantidadComponente(idx, valor) {
  const n = parseFloat(valor);
  if (!isNaN(n) && n > 0) { STATE.componentesRecetaActual[idx].cantidad = n; renderListaComponentesReceta(); }
}
function quitarComponenteReceta(idx) {
  STATE.componentesRecetaActual.splice(idx, 1);
  renderListaComponentesReceta();
}
function agregarComponenteReceta(productoId, nombre) {
  if (STATE.componentesRecetaActual.some(c => c.producto_id === productoId)) return;
  STATE.componentesRecetaActual.push({ producto_id: productoId, nombre, cantidad: 1, unidad_codigo: '', uso_continuo: false });
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
        ${esc(p.nombre)} <span style="color:var(--text-muted)">— hay ${fmtNum(p.stock_actual)} ${esc(textoUnidadInventario(p))}</span>
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
  if (STATE.componentesRecetaActual.every(c => c.uso_continuo)) { errEl.textContent = 'Al menos un ingrediente debe descontarse siempre (no todos pueden ser "se va gastando").'; return; }
  const costoExtra = parseFloat(document.getElementById('rc-costo-extra').value) || 0;
  if (costoExtra < 0) { errEl.textContent = 'El costo extra no puede ser negativo.'; return; }
  const malaUnidad = STATE.componentesRecetaActual.find(c => factorUnidad(c.unidad_codigo, STATE.productos.find(p => p.id === c.producto_id)) == null);
  if (malaUnidad) { errEl.textContent = `Revisa la unidad de "${malaUnidad.nombre}".`; return; }

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
      costo_extra_tanda: round2(costoExtra),
      al_vender: tipo === 'normal' && document.getElementById('rc-al-vender').checked,
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
      unidad_codigo: c.unidad_codigo || null, uso_continuo: !!c.uso_continuo,
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
    await cargarRecetas(); await cargarInsumos();
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
  const opciones = STATE.recetas.filter(r => r.activa && !r.al_vender).map(r =>      // las "al vender" se descuentan solas en Ventas
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
  delete document.getElementById('op-costo-mano-obra').dataset.manual;
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
  const necesidades = (receta.receta_componentes || []).filter(c => !c.uso_continuo).map(c => {
    const prod = STATE.productos.find(p => p.id === c.producto_id);
    const fu = factorUnidad(c.unidad_codigo, prod);
    const necesario = c.unidad_codigo ? Math.round(c.cantidad * (fu ?? 0) * factor * 1000) / 1000 : round2(c.cantidad * factor);
    const disponible = Number(prod?.stock_actual || 0);
    return {
      producto_id: c.producto_id, nombre: prod?.nombre || '—',
      necesario, disponible, costoUnitario: Number(prod?.costo || 0), unidadTxt: textoUnidadInventario(prod),
      subtotal: round2(necesario * Number(prod?.costo || 0)),
      suficiente: disponible >= necesario, unidadMala: fu == null,
    };
  });
  const costoMateriales = round2(necesidades.reduce((s, n) => s + n.subtotal, 0));
  return { necesidades, costoMateriales, todoSuficiente: necesidades.every(n => n.suficiente && !n.unidadMala) };
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

  // Costo extra por tanda de la receta (mano de obra, gas…), si no se escribió a mano.
  const moEl = document.getElementById('op-costo-mano-obra');
  if (moEl && moEl.dataset.manual !== '1') moEl.value = round2(Number(receta.costo_extra_tanda || 0) * cantidad / Number(receta.cantidad_producida || 1)) || 0;
  const { necesidades, costoMateriales, todoSuficiente } = calcularNecesidadesOrden(receta, cantidad);
  document.getElementById('op-necesidades-lista').innerHTML = necesidades.map(n => `
    <div class="prod-componente-row">
      <span>${n.suficiente ? '✅' : '⚠️'} ${esc(n.nombre)}</span>
      <span style="font-family:var(--font-mono)">${fmtNum(n.necesario)} / ${fmtNum(n.disponible)} ${esc(n.unidadTxt)}</span>
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

/* Completar producción: UNA sola operación en el servidor (todo o nada). Descuenta la
   materia prima, suma el producto terminado, ACTUALIZA SU COSTO (promedio) y cierra la
   orden; una orden ya completada no se completa dos veces. Producir no toca Caja. */
let PRODUCIENDO = false;
function textoMotivoProduccion(r) {
  const m = r && r.motivo;
  if (m === 'falta_materia' && Array.isArray(r.faltantes) && r.faltantes.length)
    return 'No alcanza la materia prima: ' + r.faltantes.map(f => `${f.nombre} (necesitas ${fmtNum(f.necesario)}, hay ${fmtNum(f.disponible)})`).join(', ') + '.';
  return ({
    ya_completada: 'Esta producción ya estaba completada (no se descontó nada otra vez).',
    cancelada: 'Esta orden está cancelada.', sin_receta: 'No se encontró la receta de esta orden.',
    cantidad: 'La cantidad a producir debe ser mayor a cero.', cantidad_buena: 'Las unidades buenas deben ser más de 0 y no más de lo planificado.',
    materia_no_existe: 'Una materia prima de la receta ya no existe. Revisa la receta.',
    salida_no_existe: 'Un corte de la receta ya no existe. Revisa la receta.',
    terminado_no_existe: 'El producto terminado de la receta ya no existe. Revisa la receta.',
    no_existe: 'No se encontró la orden.', receta: 'La receta tiene una cantidad inválida.',
  })[m] || 'No se pudo completar. Intenta de nuevo.';
}
function textoCostoNuevo(r) {
  return r && r.costo_nuevo != null && Number(r.costo_nuevo) !== Number(r.costo_anterior)
    ? ` · costo del producto: ${fmt(r.costo_anterior)} → ${fmt(r.costo_nuevo)}` : '';
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

  if (estadoDeseado === 'completada') {
    if (PRODUCIENDO) return;
    PRODUCIENDO = true;
    try {
      const { data: r, error } = await sb.rpc('produccion_crear_y_completar', { p_datos: {
        receta_id: recetaId, cantidad_planificada: cantidad, fecha_entrega: fechaEntrega,
        costo_mano_obra: manoObra, costo_indirecto: indirecto,
        merma_cantidad: receta.tipo === 'despiece' ? 0 : mermaCantidad, merma_motivo: mermaMotivo,
        usuario_nombre: STATE.currentUser?.nombre || 'Usuario' } });
      if (error) throw error;
      if (!r || !r.ok) { errEl.textContent = textoMotivoProduccion(r); return; }
      showToast((receta.tipo === 'despiece' ? '🍗 Despiece completado' : '🏭 Producción completada') + textoCostoNuevo(r));
      closeModal('modal-orden');
      await Promise.all([cargarOrdenes(), cargarProductosCache()]);
      actualizarKPIsProduccion();
    } catch (e) {
      console.error('guardarOrden:', e);
      errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
    } finally { PRODUCIENDO = false; }
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
  if (PRODUCIENDO) return;
  PRODUCIENDO = true;
  try {
    const { data: r, error } = await sb.rpc('produccion_completar_orden', { p_orden_id: orden.id });
    if (error) throw error;
    if (!r || !r.ok) { showToast(textoMotivoProduccion(r), 'error'); await cargarOrdenes(); return; }

    showToast('🍗 Despiece completado');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('completarOrdenDespieceDirecto:', e);
    showToast('No se pudo completar el despiece', 'error');
  } finally { PRODUCIENDO = false; }
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

  if (cantidadBuenaRaw <= 0) { errEl.textContent = 'Las unidades buenas deben ser más de 0.'; return; }
  if (PRODUCIENDO) return;
  PRODUCIENDO = true;
  try {
    const { data: r, error } = await sb.rpc('produccion_completar_orden', { p_orden_id: ordenId, p_cantidad_buena: cantidadBuena, p_merma_motivo: mermaCantidad > 0 ? mermaMotivo : null });
    if (error) throw error;
    if (!r || !r.ok) { errEl.textContent = textoMotivoProduccion(r); if (r && r.motivo === 'ya_completada') { await cargarOrdenes(); } return; }

    showToast('🏭 Producción completada' + textoCostoNuevo(r));
    closeModal('modal-completar-orden');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('confirmarCompletarOrden:', e);
    errEl.textContent = 'No se pudo completar. Intenta de nuevo.';
  } finally { PRODUCIENDO = false; }
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
/* =====================================================
   PRODUCIR HOY — lo de todos los días en 2 toques: tocar lo que hiciste,
   escribir cuántos salieron (y cuántos malos) y "Listo". Usa la misma función
   del servidor (todo o nada, costo al día, sin tocar Caja).
===================================================== */
function esHoy(iso) { return iso && ymdLocal(new Date(iso)) === todayLocalISO(); }
// Cuánto alcanza la materia prima para hacer (unidades, o lotes en despiece).
function alcanzaPara(receta) {
  const base = Number(receta.cantidad_producida || 1);
  const { necesidades } = calcularNecesidadesOrden(receta, base);
  if (!necesidades.length) return null;
  let tandas = Infinity;
  necesidades.forEach(n => { if (n.unidadMala) tandas = 0; else if (n.necesario > 0) tandas = Math.min(tandas, n.disponible / n.necesario); });
  return tandas === Infinity ? null : Math.max(0, Math.floor(tandas * base + 1e-9));
}
function tituloReceta(r) { return r.tipo === 'despiece' ? (r.nombre || 'Despiece') : (nombreProducto(r.producto_terminado_id) || r.nombre); }
function renderProducirHoy() {
  const cont = document.getElementById('ph-tarjetas');
  if (!cont) return;
  const todas = STATE.recetas.filter(r => r.activa !== false);
  const activas = todas.filter(r => !r.al_vender);
  const alVender = todas.filter(r => r.al_vender);
  if (!activas.length && alVender.length) {
    cont.innerHTML = '';
  } else if (!activas.length) {
    cont.innerHTML = `<div class="ph-vacio">Todavía no tienes recetas. <button type="button" class="btn-secondary" onclick="abrirModalReceta()">🧪 Crear mi primera receta</button></div>`;
  } else {
    cont.innerHTML = activas.map(r => {
      const desp = r.tipo === 'despiece', base = Number(r.cantidad_producida || 1);
      const { costoMateriales } = calcularNecesidadesOrden(r, base);
      const unit = desp ? null : round2((costoMateriales + Number(r.costo_extra_tanda || 0)) / base);
      const alc = alcanzaPara(r);
      const txtAlc = alc == null ? '' : alc <= 0 ? '<span class="ph-falta">⚠️ Falta materia prima</span>'
        : `Alcanza para <b>${fmtNum(alc)}</b> ${desp ? 'lote(s)' : ''}`;
      return `<button type="button" class="ph-card" data-receta="${esc(r.id)}" onclick="abrirProducirHoy('${esc(r.id)}')">
        <span class="ph-ico">${desp ? '🍗' : '🍞'}</span>
        <span class="ph-nombre">${esc(tituloReceta(r))}</span>
        <span class="ph-sub">${desp ? 'Despiece' : `Receta para ${fmtNum(base)}`}${unit != null ? ` · ${fmt(unit)} c/u` : ''}</span>
        <span class="ph-sub">${txtAlc}</span>
      </button>`;
    }).join('');
  }
  if (alVender.length) cont.insertAdjacentHTML('beforeend', `<div class="ph-preparados" style="grid-column:1/-1">🍳 Se preparan al vender (se descuentan solos en Ventas): ${alVender.map(r => esc(tituloReceta(r))).join(', ')}</div>`);
  const hoy = STATE.ordenes.filter(o => o.estado === 'completada' && esHoy(o.fecha_completada));
  const lista = document.getElementById('ph-hoy');
  if (lista) lista.innerHTML = hoy.length ? '<div class="ph-hoy-titulo">Hoy produjiste</div>' + hoy.map(o => {
    const r = STATE.recetas.find(x => x.id === o.receta_id);
    return `<div class="prod-componente-row"><span>${esc(r ? tituloReceta(r) : o.numero)}</span>
      <span>${o.tipo === 'despiece' ? `${fmtNum(o.cantidad_planificada)} lote(s)` : `${fmtNum(o.cantidad_producida)} buenos${Number(o.merma_cantidad) > 0 ? ` · ${fmtNum(o.merma_cantidad)} malos` : ''}`} · ${fmt(o.costo_total)}</span></div>`;
  }).join('') : '';
}
function abrirProducirHoy(recetaId) {
  const r = STATE.recetas.find(x => x.id === recetaId);
  if (!r) return;
  STATE.phReceta = r;
  const desp = r.tipo === 'despiece';
  document.getElementById('ph-titulo').textContent = (desp ? '🍗 ' : '🍞 ') + tituloReceta(r);
  document.getElementById('ph-cantidad-label').textContent = desp ? '¿Cuántos lotes procesaste?' : '¿Cuántos hiciste?';
  document.getElementById('ph-cantidad').value = desp ? 1 : Number(r.cantidad_producida || 1);
  document.getElementById('ph-malos').value = 0;
  document.getElementById('ph-malos-wrap').style.display = desp ? 'none' : '';
  document.getElementById('ph-motivo').value = '';
  document.getElementById('ph-error').textContent = '';
  STATE.phPesos = {};                          // pesos reales escritos a mano (despiece)
  recalcularProducirHoy();
  openModal('modal-producir-hoy');
  // Solo pone el cursor en la cantidad si no se está escribiendo ya en otra casilla (si no, lo escrito saltaría).
  setTimeout(() => { const a = document.activeElement; if (a && a.matches && a.matches('#modal-producir-hoy input')) return;
    const el = document.getElementById('ph-cantidad'); el.focus(); el.select(); }, 60);
}
function recalcularProducirHoy() {
  const r = STATE.phReceta; if (!r) return;
  const desp = r.tipo === 'despiece';
  const cant = parseFloat(document.getElementById('ph-cantidad').value) || 0;
  const malos = desp ? 0 : Math.min(cant, Math.max(0, parseFloat(document.getElementById('ph-malos').value) || 0));
  document.getElementById('ph-motivo-wrap').style.display = malos > 0 ? '' : 'none';
  const prev = document.getElementById('ph-preview');
  if (cant <= 0) { prev.innerHTML = ''; return; }
  if (desp) return pintarDespieceReal(r, cant, prev);
  const { necesidades, costoMateriales, todoSuficiente } = calcularNecesidadesOrden(r, cant);
  const extra = round2(Number(r.costo_extra_tanda || 0) * cant / Number(r.cantidad_producida || 1));
  const total = round2(costoMateriales + extra), buenos = round2(cant - malos);
  prev.innerHTML = `<div class="ph-prev-titulo">Se va a usar</div>` + necesidades.map(n => `
    <div class="prod-componente-row ${n.suficiente && !n.unidadMala ? '' : 'ph-fila-falta'}"><span>${n.suficiente && !n.unidadMala ? '✅' : '⚠️'} ${esc(n.nombre)}</span>
      <span>${n.unidadMala ? 'revisa la unidad en la receta' : `${fmtNum(n.necesario)} ${esc(n.unidadTxt)} <small>(hay ${fmtNum(n.disponible)})</small>`}</span></div>`).join('') +
    `<div class="ph-totales">
      <div><span>Materia prima</span><b>${fmt(costoMateriales)}</b></div>
      ${extra > 0 ? `<div><span>Costo extra (mano de obra, gas…)</span><b>${fmt(extra)}</b></div>` : ''}
      ${desp ? `<div><span>Costo total (se reparte entre los cortes)</span><b>${fmt(total)}</b></div>`
        : `<div class="ph-unidad"><span>Cada uno te cuesta</span><b>${buenos > 0 ? fmt(round2(total / buenos)) : '—'}</b></div>`}
      ${!todoSuficiente ? '<div class="ph-falta">⚠️ No alcanza la materia prima para esta cantidad.</div>' : ''}
    </div>`;
}
/* Despiece (carnicería): cada animal pesa distinto. Se proponen los pesos de la receta y se
   pueden cambiar por los de verdad (lo que entró y lo que salió de cada corte); el costo se
   reparte con esos pesos. Los que no se tocan quedan como dice la receta. */
function datosDespieceReal(r, cant) {
  const { necesidades } = calcularNecesidadesOrden(r, cant);
  const P = STATE.phPesos || {};
  const entradas = necesidades.map(n => {
    const prod = STATE.productos.find(p => p.id === n.producto_id);
    const real = P['c:' + n.producto_id];
    return { ...n, peso: real != null ? real : n.necesario, costo: Number(prod?.costo || 0) };
  });
  const salidas = (r.receta_despiece_salidas || []).map(sd => {
    const prod = STATE.productos.find(p => p.id === sd.producto_id);
    const real = P['s:' + sd.producto_id];
    const peso = real != null ? real : round2(sd.cantidad_rendimiento * cant);
    return { producto_id: sd.producto_id, nombre: prod?.nombre || '—', peso, esMerma: !!sd.es_merma, unidadTxt: textoUnidadInventario(prod),
             valor: sd.es_merma ? 0 : round2(peso * Number(prod?.precio || 0)) };
  });
  const extra = round2(Number(r.costo_extra_tanda || 0) * cant / Number(r.cantidad_producida || 1));
  const costoMat = round2(entradas.reduce((t, e) => t + round2(e.peso * e.costo), 0));
  const total = round2(costoMat + extra), sumaValor = salidas.reduce((t, x) => t + x.valor, 0);
  salidas.forEach(x => { x.costoUnit = x.peso > 0 && sumaValor > 0 ? round2(round2(x.valor / sumaValor * total) / x.peso) : 0; });
  const entro = entradas.reduce((t, e) => t + e.peso, 0), salio = salidas.reduce((t, x) => t + x.peso, 0);
  return { entradas, salidas, extra, costoMat, total, entro, salio, todoSuficiente: entradas.every(e => !e.unidadMala && e.disponible >= e.peso) };
}
function pintarDespieceReal(r, cant, prev) {
  const d = datosDespieceReal(r, cant);
  const inp = (clave, valor, etiqueta) => `<input type="number" class="ph-peso" min="0" step="0.001" inputmode="decimal" value="${valor}" aria-label="${esc(etiqueta)}" oninput="cambiarPesoReal('${clave}', this.value)"/>`;
  prev.innerHTML = `<div class="ph-prev-titulo">Lo que entró (puedes poner el peso real)</div>` + d.entradas.map(e => `
    <div class="prod-componente-row" data-fila="c:${esc(e.producto_id)}"><span><span class="ph-ok"></span> ${esc(e.nombre)} <small>(hay ${fmtNum(e.disponible)})</small></span>
      <span class="ph-peso-wrap">${inp('c:' + e.producto_id, e.peso, 'Peso real de ' + e.nombre)} ${esc(e.unidadTxt)}</span></div>`).join('') +
    `<div class="ph-prev-titulo">Lo que salió</div>` + d.salidas.map(x => `
    <div class="prod-componente-row" data-fila="s:${esc(x.producto_id)}"><span>${x.esMerma ? '🗑️' : '📦'} ${esc(x.nombre)}${x.esMerma ? ' <small>(desecho)</small>' : ' <small class="ph-cu"></small>'}</span>
      <span class="ph-peso-wrap">${inp('s:' + x.producto_id, x.peso, 'Peso real de ' + x.nombre)} ${esc(x.unidadTxt)}</span></div>`).join('') +
    `<div class="ph-totales" id="ph-desp-totales"></div>`;
  actualizarTotalesDespiece(d);
}
// Al escribir un peso solo cambian los totales y los costos (las casillas no se vuelven a dibujar:
// así no se pierde lo escrito ni se cierra el teclado del celular).
function actualizarTotalesDespiece(d) {
  const prev = document.getElementById('ph-preview');
  d.entradas.forEach(e => { const f = prev.querySelector(`[data-fila="c:${CSS.escape(e.producto_id)}"]`); if (!f) return;
    const ok = !e.unidadMala && e.disponible >= e.peso; f.classList.toggle('ph-fila-falta', !ok); f.querySelector('.ph-ok').textContent = ok ? '✅' : '⚠️'; });
  d.salidas.forEach(x => { const el = prev.querySelector(`[data-fila="s:${CSS.escape(x.producto_id)}"] .ph-cu`); if (el) el.textContent = x.peso > 0 ? `· ${fmt(x.costoUnit)} c/u` : ''; });
  document.getElementById('ph-desp-totales').innerHTML = `
      <div><span>Costo de lo que entró</span><b>${fmt(d.costoMat)}</b></div>
      ${d.extra > 0 ? `<div><span>Costo extra (mano de obra…)</span><b>${fmt(d.extra)}</b></div>` : ''}
      <div><span>Entró / salió</span><b>${fmtNum(d.entro)} / ${fmtNum(d.salio)}</b></div>
      ${d.entro - d.salio > 0.0005 ? `<div class="ph-perdida"><span>Se perdió en el proceso (agua, sangre…)</span><b>${fmtNum(Math.round((d.entro - d.salio) * 1000) / 1000)}</b></div>` : ''}
      ${!d.todoSuficiente ? '<div class="ph-falta">⚠️ No alcanza la materia prima para esta cantidad.</div>' : ''}`;
}
function cambiarPesoReal(clave, valor) {
  const n = parseFloat(valor);
  STATE.phPesos = STATE.phPesos || {};
  if (isNaN(n)) delete STATE.phPesos[clave]; else STATE.phPesos[clave] = n;
  const cant = parseFloat(document.getElementById('ph-cantidad').value) || 0;
  actualizarTotalesDespiece(datosDespieceReal(STATE.phReceta, cant));
}

async function guardarProducirHoy() {
  const r = STATE.phReceta; if (!r) return;
  const err = document.getElementById('ph-error'); err.textContent = '';
  const desp = r.tipo === 'despiece';
  const cant = parseFloat(document.getElementById('ph-cantidad').value);
  const malos = desp ? 0 : Math.max(0, parseFloat(document.getElementById('ph-malos').value) || 0);
  if (!cant || cant <= 0) { err.textContent = desp ? 'Escribe cuántos lotes procesaste.' : 'Escribe cuántos hiciste.'; return; }
  if (malos >= cant) { err.textContent = 'Los malos deben ser menos que los que hiciste.'; return; }
  let reales = null;
  if (desp) {
    const d = datosDespieceReal(r, cant);
    if (d.entradas.some(e => !(e.peso > 0)) || d.salidas.some(x => !(x.peso >= 0))) { err.textContent = 'Revisa los pesos: deben ser números mayores que 0.'; return; }
    if (!d.todoSuficiente) { err.textContent = 'No alcanza la materia prima. Ingresa más materia prima o baja la cantidad.'; return; }
    if (d.salio > d.entro + 0.0005) { err.textContent = 'Salió más de lo que entró. Revisa los pesos.'; return; }
    reales = { consumo: {}, salidas: {} };
    d.entradas.forEach(e => { reales.consumo[e.producto_id] = e.peso; });
    d.salidas.forEach(x => { reales.salidas[x.producto_id] = x.peso; });
  } else {
    const { todoSuficiente } = calcularNecesidadesOrden(r, cant);
    if (!todoSuficiente) { err.textContent = 'No alcanza la materia prima. Ingresa más materia prima o baja la cantidad.'; return; }
  }
  if (PRODUCIENDO) return;
  PRODUCIENDO = true;
  const btn = document.getElementById('ph-btn'); btn.disabled = true;
  try {
    const { data: res, error } = await sb.rpc('produccion_crear_y_completar', { p_datos: {
      receta_id: r.id, cantidad_planificada: cant, merma_cantidad: malos, ...(reales ? { reales } : {}),
      merma_motivo: malos > 0 ? (document.getElementById('ph-motivo').value.trim() || null) : null,
      usuario_nombre: STATE.currentUser?.nombre || 'Usuario' } });   // sin costo_mano_obra: el servidor usa el costo extra de la receta
    if (error) throw error;
    if (!res || !res.ok) { err.textContent = textoMotivoProduccion(res); return; }
    showToast(`✅ Listo: ${desp ? fmtNum(cant) + ' lote(s) de ' + tituloReceta(r) : fmtNum(round2(cant - malos)) + ' ' + tituloReceta(r)} al inventario` + textoCostoNuevo(res));
    closeModal('modal-producir-hoy');
    await Promise.all([cargarOrdenes(), cargarProductosCache()]);
    actualizarKPIsProduccion();
  } catch (e) {
    console.error('guardarProducirHoy:', e);
    err.textContent = 'No se pudo guardar. Intenta de nuevo.';
  } finally { PRODUCIENDO = false; btn.disabled = false; }
}

/* =====================================================
   MERMA DESPUÉS DE PRODUCIR (pan vencido, dañado, que no se vendió).
   Baja la existencia en el servidor y queda como "ajuste de existencia (baja)"
   con su costo, que la contabilidad ya toma. No toca Caja.
===================================================== */
const MOTIVOS_MERMA = [
  { id: 'vencido', txt: '⏰ Se venció' }, { id: 'danado', txt: '💥 Se dañó' },
  { id: 'no_vendido', txt: '🥖 No se vendió' }, { id: 'otro', txt: '📝 Otro' },
];
function abrirMermaProducto() {
  const terminados = new Set(STATE.recetas.map(r => r.producto_terminado_id).filter(Boolean));
  STATE.recetas.forEach(r => (r.receta_despiece_salidas || []).forEach(x => { if (!x.es_merma) terminados.add(x.producto_id); }));
  const lista = STATE.productos.filter(p => p.tipo === 'producto' && !p.es_materia_prima)
    .sort((a, b) => (terminados.has(b.id) - terminados.has(a.id)) || a.nombre.localeCompare(b.nombre));
  document.getElementById('mm-producto').innerHTML = '<option value="">— Elige el producto —</option>' +
    lista.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)} (hay ${fmtNum(p.stock_actual)})</option>`).join('');
  document.getElementById('mm-motivos').innerHTML = MOTIVOS_MERMA.map((m, i) =>
    `<label class="mm-motivo"><input type="radio" name="mm-motivo" value="${m.id}" ${i === 0 ? 'checked' : ''}/> ${m.txt}</label>`).join('');
  document.getElementById('mm-cantidad').value = '';
  document.getElementById('mm-nota').value = '';
  document.getElementById('mm-error').textContent = '';
  document.getElementById('mm-valor').textContent = '';
  openModal('modal-merma');
}
function recalcularMerma() {
  const p = STATE.productos.find(x => x.id === document.getElementById('mm-producto').value);
  const c = parseFloat(document.getElementById('mm-cantidad').value) || 0;
  document.getElementById('mm-valor').textContent = p && c > 0 ? `Pierdes ${fmt(round2(c * Number(p.costo || 0)))} (a costo). No sale dinero de la Caja.` : '';
}
let REGISTRANDO_MERMA = false;
async function guardarMerma() {
  const err = document.getElementById('mm-error'); err.textContent = '';
  const id = document.getElementById('mm-producto').value, c = parseFloat(document.getElementById('mm-cantidad').value);
  const motivo = document.querySelector('input[name="mm-motivo"]:checked')?.value;
  if (!id) { err.textContent = 'Elige el producto.'; return; }
  if (!(c > 0)) { err.textContent = 'Escribe cuántos se perdieron.'; return; }
  if (REGISTRANDO_MERMA) return;
  REGISTRANDO_MERMA = true;
  const btn = document.getElementById('mm-btn'); btn.disabled = true;
  try {
    const { data: r, error } = await sb.rpc('produccion_merma_registrar', { p_producto_id: id, p_cantidad: c, p_motivo: motivo, p_nota: document.getElementById('mm-nota').value.trim() || null });
    if (error) throw error;
    if (!r || !r.ok) { err.textContent = r && r.motivo === 'sin_existencia' ? `No hay tanto: solo hay ${fmtNum(r.disponible)}.` : 'No se pudo registrar. Revisa los datos.'; return; }
    showToast(`🗑️ Merma registrada: ${fmt(r.costo_total)} a costo`);
    closeModal('modal-merma');
    await cargarProductosCache(); await cargarMermasMes(); renderReporteMes();
  } catch (e) { console.error('guardarMerma:', e); err.textContent = 'No se pudo registrar. Intenta de nuevo.'; }
  finally { REGISTRANDO_MERMA = false; btn.disabled = false; }
}

/* =====================================================
   INSUMOS QUE SE VAN GASTANDO (aceite, gas, sal…)
   No se descuentan por plato ni por tanda. Al abrir uno nuevo se descuenta del
   inventario como ajuste (gasto de cocina) con su costo; no toca Caja.
   Rendimiento: platos vendidos / unidades producidas entre una apertura y la siguiente.
===================================================== */
async function cargarInsumos() {
  const ids = new Set();
  STATE.recetas.forEach(r => (r.receta_componentes || []).forEach(c => { if (c.uso_continuo) ids.add(c.producto_id); }));
  STATE.insumoIds = [...ids];
  STATE.aperturas = []; STATE.usosInsumo = [];
  if (!ids.size) return;
  try {
    const { data } = await sb.from('insumo_aperturas').select('producto_id, cantidad, costo_total, created_at')
      .eq('auth_user_id', STATE.userId).in('producto_id', [...ids]).order('created_at');
    STATE.aperturas = data || [];
    const desde = STATE.aperturas.length ? STATE.aperturas[0].created_at : null;
    const platos = [...new Set(STATE.recetas.filter(r => r.al_vender && (r.receta_componentes || []).some(c => c.uso_continuo)).map(r => r.producto_terminado_id))];
    if (desde && platos.length) {
      const { data: vd } = await N360Leer.todo(() => sb.from('venta_detalles').select('producto_id, cantidad, created_at, ventas(estado)')
        .eq('auth_user_id', STATE.userId).in('producto_id', platos).gte('created_at', desde), 'ventas');
      STATE.usosInsumo = (vd || []).filter(x => x.ventas?.estado !== 'anulada').map(x => ({ producto_id: x.producto_id, cantidad: Number(x.cantidad || 0), fecha: x.created_at }));
    }
  } catch (e) { console.warn('cargarInsumos:', e); }
}
// Cuántos platos/unidades usaron este insumo entre dos fechas.
function usosDeInsumo(insumoId, desde, hasta) {
  const recetas = STATE.recetas.filter(r => (r.receta_componentes || []).some(c => c.producto_id === insumoId && c.uso_continuo));
  const platos = new Set(recetas.filter(r => r.al_vender).map(r => r.producto_terminado_id));
  const tandas = new Set(recetas.filter(r => !r.al_vender).map(r => r.id));
  const enRango = f => f && new Date(f) >= new Date(desde) && (!hasta || new Date(f) < new Date(hasta));
  const vendidos = (STATE.usosInsumo || []).filter(u => platos.has(u.producto_id) && enRango(u.fecha)).reduce((t, u) => t + u.cantidad, 0);
  const producidos = STATE.ordenes.filter(o => o.estado === 'completada' && tandas.has(o.receta_id) && enRango(o.fecha_completada))
    .reduce((t, o) => t + Number(o.tipo === 'despiece' ? o.cantidad_planificada : o.cantidad_producida || 0), 0);
  return vendidos + producidos;
}
function renderInsumos() {
  const panel = document.getElementById('prod-insumos'); if (!panel) return;
  const ids = STATE.insumoIds || [];
  panel.style.display = ids.length ? '' : 'none';
  if (!ids.length) return;
  document.getElementById('in-lista').innerHTML = ids.map(id => {
    const p = STATE.productos.find(x => x.id === id); if (!p) return '';
    const ab = (STATE.aperturas || []).filter(a => a.producto_id === id);
    const u = textoUnidadInventario(p);
    let rinde = null;
    const ciclos = [];
    for (let i = 0; i + 1 < ab.length; i++) { const n = usosDeInsumo(id, ab[i].created_at, ab[i + 1].created_at); if (n > 0) ciclos.push(n / Number(ab[i].cantidad || 1)); }
    if (ciclos.length) rinde = ciclos.reduce((t, x) => t + x, 0) / ciclos.length;
    const ult = ab[ab.length - 1];
    const desdeUlt = ult ? usosDeInsumo(id, ult.created_at, null) : 0;
    const quedan = rinde && ult ? Math.round(rinde * Number(ult.cantidad || 1) - desdeUlt) : null;
    const dias = ult ? Math.floor((Date.now() - new Date(ult.created_at)) / 86400000) : null;
    return `<div class="in-card">
      <span class="in-nombre">${esc(p.nombre)}</span>
      <span class="in-dato">Guardados sin abrir: <b>${fmtNum(p.stock_actual)}</b> ${esc(u)}</span>
      ${ult ? `<span class="in-dato">Último abierto ${dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`} · desde entonces: ${fmtNum(desdeUlt)} usados</span>` : '<span class="in-dato">Todavía no has registrado ninguno abierto.</span>'}
      ${rinde ? `<span class="in-dato">Rinde aprox. <b>${fmtNum(Math.round(rinde))}</b> por ${esc(nombreUnidad(p.unidad_codigo) || 'unidad')} · ${fmt(round2(Number(p.costo || 0) / rinde))} c/u</span>` : ult ? '<span class="in-dato">Cuando abras el siguiente, te diré cuánto rinde.</span>' : ''}
      ${quedan != null ? (quedan <= Math.max(5, rinde * 0.15) ? `<span class="in-alerta">⚠️ Se está por acabar: quedan unos ${fmtNum(Math.max(0, quedan))}</span>` : `<span class="in-dato">Al abierto le quedan unos ${fmtNum(quedan)}</span>`) : ''}
      ${Number(p.stock_actual) <= 0 ? '<span class="in-alerta">⚠️ No te queda ninguno guardado</span>' : ''}
      <button type="button" class="btn-secondary" style="margin-top:4px" onclick="abrirInsumo('${esc(id)}')">🫙 Abrí uno nuevo</button>
    </div>`;
  }).join('');
}
function abrirInsumo(id) {
  const p = STATE.productos.find(x => x.id === id); if (!p) return;
  STATE.insumoActual = p;
  document.getElementById('in-titulo').textContent = `🫙 Abrí ${p.nombre}`;
  document.getElementById('in-cantidad-label').textContent = `¿Cuántos ${textoUnidadInventario(p)} abriste?`;
  document.getElementById('in-cantidad').value = 1;
  document.getElementById('in-nota').value = '';
  document.getElementById('in-error').textContent = '';
  recalcularInsumo();
  openModal('modal-insumo');
}
function recalcularInsumo() {
  const p = STATE.insumoActual, c = parseFloat(document.getElementById('in-cantidad').value) || 0;
  document.getElementById('in-valor').textContent = p && c > 0 ? `Pasa a gasto de cocina: ${fmt(round2(c * Number(p.costo || 0)))}. No sale dinero de la Caja.` : '';
}
let ABRIENDO_INSUMO = false;
async function guardarInsumo() {
  const err = document.getElementById('in-error'); err.textContent = '';
  const p = STATE.insumoActual, c = parseFloat(document.getElementById('in-cantidad').value);
  if (!p) return;
  if (!(c > 0)) { err.textContent = 'Escribe cuántos abriste.'; return; }
  if (ABRIENDO_INSUMO) return;
  ABRIENDO_INSUMO = true;
  const btn = document.getElementById('in-btn'); btn.disabled = true;
  try {
    const { data: r, error } = await sb.rpc('produccion_insumo_abrir', { p_producto_id: p.id, p_cantidad: c, p_nota: document.getElementById('in-nota').value.trim() || null });
    if (error) throw error;
    if (!r || !r.ok) { err.textContent = r && r.motivo === 'sin_existencia' ? `No tienes tantos guardados: hay ${fmtNum(r.disponible)}. Ingresa la compra primero.` : 'No se pudo registrar.'; return; }
    showToast(`🫙 Registrado: ${p.nombre} (${fmt(r.costo_total)} a gasto de cocina)`);
    closeModal('modal-insumo');
    await cargarProductosCache(); await cargarInsumos(); renderInsumos();
  } catch (e) { console.error('guardarInsumo:', e); err.textContent = 'No se pudo registrar. Intenta de nuevo.'; }
  finally { ABRIENDO_INSUMO = false; btn.disabled = false; }
}

/* =====================================================
   COSTOS Y MERMA DEL MES (solo lectura)
===================================================== */
function inicioMes() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
async function cargarMermasMes() {
  try {
    const { data } = await sb.from('movimientos_inventario').select('producto_id, cantidad, costo_total, razon, created_at')
      .eq('auth_user_id', STATE.userId).like('razon', 'merma_%').gte('created_at', inicioMes().toISOString());
    STATE.mermasMes = data || [];
  } catch (e) { STATE.mermasMes = []; }
}
function renderReporteMes() {
  const cont = document.getElementById('rp-mes'); if (!cont) return;
  const desde = inicioMes();
  const ords = STATE.ordenes.filter(o => o.estado === 'completada' && o.fecha_completada && new Date(o.fecha_completada) >= desde);
  const filas = {};
  const fila = (id, nombre) => (filas[id] = filas[id] || { nombre, producido: 0, costo: 0, mermaProd: 0, valorMermaProd: 0, mermaDesp: 0, valorMermaDesp: 0 });
  ords.forEach(o => {
    if (o.tipo === 'despiece') { const r = STATE.recetas.find(x => x.id === o.receta_id); const f = fila('d:' + o.receta_id, (r ? tituloReceta(r) : 'Despiece') + ' (despiece)'); f.producido += Number(o.cantidad_planificada || 0); f.costo += Number(o.costo_total || 0); return; }
    const f = fila(o.producto_terminado_id, nombreProducto(o.producto_terminado_id));
    f.producido += Number(o.cantidad_producida || 0); f.costo += Number(o.costo_total || 0);
    f.mermaProd += Number(o.merma_cantidad || 0); f.valorMermaProd += Number(o.merma_cantidad || 0) * Number(o.costo_unitario || 0);
  });
  (STATE.mermasMes || []).forEach(m => { const f = fila(m.producto_id, nombreProducto(m.producto_id)); f.mermaDesp += Math.abs(Number(m.cantidad || 0)); f.valorMermaDesp += Number(m.costo_total || 0); });
  const lista = Object.values(filas).sort((a, b) => b.costo - a.costo);
  const tot = lista.reduce((t, f) => ({ costo: t.costo + f.costo, perdido: t.perdido + f.valorMermaProd + f.valorMermaDesp }), { costo: 0, perdido: 0 });
  if (!lista.length) { cont.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted)">Todavía no hay producción ni merma este mes.</p>'; return; }
  cont.innerHTML = `
    <div class="rp-resumen">
      <div><span>Produjiste este mes por</span><b>${fmt(round2(tot.costo))}</b></div>
      <div class="${tot.perdido > 0 ? 'rp-perdido' : ''}"><span>Perdiste en merma</span><b>${fmt(round2(tot.perdido))}</b></div>
    </div>
    <div class="table-wrap"><table class="rp-tabla">
      <thead><tr><th>Producto</th><th>Producido</th><th>Costo c/u</th><th>Malos al producir</th><th>Merma después</th><th>Perdido</th></tr></thead>
      <tbody>${lista.map(f => `<tr><td>${esc(f.nombre)}</td><td>${fmtNum(f.producido)}</td>
        <td>${f.producido > 0 && !f.nombre.endsWith('(despiece)') ? fmt(round2(f.costo / f.producido)) : '—'}</td>
        <td>${f.mermaProd ? fmtNum(f.mermaProd) : '—'}</td><td>${f.mermaDesp ? fmtNum(f.mermaDesp) : '—'}</td>
        <td>${f.valorMermaProd + f.valorMermaDesp > 0 ? fmt(round2(f.valorMermaProd + f.valorMermaDesp)) : '—'}</td></tr>`).join('')}</tbody>
    </table></div>
    <p style="font-size:11.5px;color:var(--text-muted);margin:6px 0 0">"Malos al producir" ya va incluido en el costo de los buenos. "Merma después" baja el inventario como ajuste y no saca dinero de la Caja.</p>`;
}

function actualizarKPIsProduccion() {
  try { renderReporteMes(); } catch (e) { console.error('renderReporteMes:', e); }
  try { renderInsumos(); } catch (e) { console.error('renderInsumos:', e); }
  try { renderProducirHoy(); } catch (e) { console.error('renderProducirHoy:', e); }
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

    if (window.N360Unidades) await window.N360Unidades.cargarPersonalizadas(sb, user.id);
    await cargarProductosCache();
    await Promise.all([cargarRecetas(), cargarOrdenes(), cargarMermasMes()]);
    await cargarInsumos();
    actualizarKPIsProduccion();

    // Llegada directa desde "+ Nueva materia prima" en Productos/Servicios
    // -- se reutiliza el mismo modal de siempre, con la misma logica
    // real (incluido el descuento de Caja), en vez de duplicarla ahi.
    if (new URLSearchParams(window.location.search).get('abrir') === 'materia-prima') {
      abrirModalIngresarMateriaPrima();
    }
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
  let intentos = 0;
  const intervalo = setInterval(() => {
    intentos++;
    if (STATE.empresaConfig || intentos >= 30) {
      clearInterval(intervalo);
      const btn = document.getElementById('btn-moneda-vis-texto');
      if (btn) btn.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda);
    }
  }, 100);
});
