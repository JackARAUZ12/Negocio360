/* =====================================================
   ACTIVOS.JS — NEGOCIO360
   Vehículos, herramientas, maquinaria y todo lo que el negocio posee
   para operar (no para vender) — con depreciación por línea recta
   según la Ley 822 de Nicaragua, y asientos contables automáticos.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  activos: [], perfiles: [], proveedores: [], metodosPago: [],
  cuentasContables: [], filtroEstado: '',
  activoActualId: null,
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = monedaParaMostrar(STATE.empresaConfig?.moneda);
  return `${sym} ${convertirParaMostrar(amount, STATE.empresaConfig?.moneda).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function fmtNum(n) { return Number(n||0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }

/* FIX ZONA HORARIA (mismo ya documentado en Ventas/Compras/Delivery):
   new Date().toISOString() da la fecha en UTC. Nicaragua es UTC-6,
   así que después de las 6PM hora local la fecha en UTC ya es el
   día siguiente. Se usa la fecha calendario LOCAL, desde el inicio. */
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayLocalISO() { return ymdLocal(new Date()); }

/* =====================================================
   CATEGORÍAS DE ACTIVO — vida útil según el Artículo 34 del
   Reglamento de la Ley 822 (Decreto 01-2013), Ley de Concertación
   Tributaria de Nicaragua. Cada una sugiere también a qué cuenta
   contable estándar pertenece (mismos códigos de la plantilla que
   ya usa Contabilidad: 1210 Mobiliario y Equipo, 1220 Vehículos).
===================================================== */
const CATEGORIAS_ACTIVOS = [
  { key:'vehiculo_carga',      label:'Vehículo de transporte colectivo/carga',      vidaUtil:5,  cuentaCodigo:'1220' },
  { key:'vehiculo_alquiler',   label:'Vehículo de empresa de alquiler',              vidaUtil:3,  cuentaCodigo:'1220' },
  { key:'vehiculo_particular', label:'Vehículo particular usado en el negocio',      vidaUtil:5,  cuentaCodigo:'1220' },
  { key:'vehiculo_otro',       label:'Otro equipo de transporte',                    vidaUtil:8,  cuentaCodigo:'1220' },
  { key:'maquinaria_fija',     label:'Maquinaria fija (adherida a la planta)',       vidaUtil:10, cuentaCodigo:'1210' },
  { key:'maquinaria_movil',    label:'Maquinaria no adherida permanentemente',       vidaUtil:7,  cuentaCodigo:'1210' },
  { key:'maquinaria_otra',     label:'Otra maquinaria y equipo',                     vidaUtil:5,  cuentaCodigo:'1210' },
  { key:'mobiliario',          label:'Mobiliario y equipo de oficina',               vidaUtil:5,  cuentaCodigo:'1210' },
  { key:'comunicacion',        label:'Equipos de comunicación',                      vidaUtil:5,  cuentaCodigo:'1210' },
  { key:'aire_elevador',       label:'Ascensores / aire acondicionado central',      vidaUtil:10, cuentaCodigo:'1210' },
  { key:'computo',             label:'Equipo de cómputo (CPU, laptop, impresora…)',  vidaUtil:2,  cuentaCodigo:'1210' },
  { key:'medios',              label:'Equipo para medios (cámaras)',                 vidaUtil:2,  cuentaCodigo:'1210' },
  { key:'herramientas',        label:'Herramientas y otros',                         vidaUtil:5,  cuentaCodigo:'1210' },
];

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
function fmtFechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}

/* =====================================================
   INICIALIZACIÓN
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
   CARGA DE DATOS DE APOYO — perfiles, proveedores, métodos, bancos,
   cuentas contables (para las sugerencias automáticas).
===================================================== */
async function cargarPerfilesInternos() {
  try {
    const { data } = await sb.from('perfiles_acceso').select('id,nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.perfiles = data || [];
    const sel = document.getElementById('na-responsable');
    if (sel) sel.innerHTML = '<option value="">— Sin asignar —</option>' +
      STATE.perfiles.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  } catch (e) { STATE.perfiles = []; }
}

async function cargarProveedoresActivos() {
  try {
    const { data } = await sb.from('proveedores').select('id,nombre').eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.proveedores = data || [];
    const sel = document.getElementById('na-proveedor');
    if (sel) sel.innerHTML = '<option value="">— Sin especificar —</option>' +
      STATE.proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  } catch (e) { STATE.proveedores = []; }
}

async function loadMetodosPago() {
  try {
    const { data } = await sb.from('metodos_pago').select('id, nombre, activo, es_default')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('orden');
    STATE.metodosPago = data && data.length ? data : [{ id: null, nombre: 'Efectivo', es_default: true }];
  } catch (e) { STATE.metodosPago = [{ id: null, nombre: 'Efectivo', es_default: true }]; }
  const opciones = STATE.metodosPago.map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  const def = STATE.metodosPago.find(m => m.es_default);
  ['na-metodo', 'ba-metodo'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = opciones;
    if (def) sel.value = def.id || '';
  });
}

async function cargarCuentasContables() {
  try {
    const { data } = await sb.from('cuentas_contables').select('id,codigo,nombre').eq('auth_user_id', STATE.userId).eq('activa', true);
    STATE.cuentasContables = data || [];
  } catch (e) { STATE.cuentasContables = []; }
}
function buscarCuentaPorCodigo(codigo) {
  return STATE.cuentasContables.find(c => c.codigo === codigo) || null;
}

let _bancosCacheActivos = null;
async function cargarBancosDisponiblesActivos() {
  if (_bancosCacheActivos) return _bancosCacheActivos;
  try {
    const { data } = await sb.from('bancos').select('*').eq('auth_user_id', STATE.userId).eq('activo', true).order('created_at');
    _bancosCacheActivos = data || [];
  } catch (e) { _bancosCacheActivos = []; }
  return _bancosCacheActivos;
}
async function saldoActualBancoActivos(bancoId) {
  const { data: movs } = await sb.from('movimientos_financieros')
    .select('tipo_flujo, monto, monto_moneda_banco').eq('auth_user_id', STATE.userId).eq('banco_id', bancoId).eq('estado', 'completado');
  const { data: banco } = await sb.from('bancos').select('saldo_inicial, moneda').eq('id', bancoId).single();
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (banco?.moneda||'NIO') !== monedaBase;
  const montoDe = (m) => esOtraMoneda ? Number(m.monto_moneda_banco ?? m.monto) : Number(m.monto);
  const suma = (movs||[]).reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? montoDe(m) : -montoDe(m)), 0);
  return Number(banco?.saldo_inicial||0) + suma;
}

/* =====================================================
   MATEMÁTICA DE DEPRECIACIÓN — línea recta, calculada en vivo (no
   se guarda un total aparte que se pueda desincronizar). Se calcula
   por MESES completos transcurridos desde la adquisición, topado a
   la vida útil total (nunca deprecia de más).
===================================================== */
function calcularDepreciacion(activo) {
  const costo = Number(activo.costo_adquisicion);
  const residual = Number(activo.valor_residual || 0);
  const vidaUtilMeses = Number(activo.vida_util_anos) * 12;
  const depreciable = Math.max(0, costo - residual);
  const depreciacionMensual = vidaUtilMeses > 0 ? depreciable / vidaUtilMeses : 0;

  const fechaAdq = new Date(activo.fecha_adquisicion + 'T00:00:00');
  const hoy = new Date();
  let mesesTranscurridos = (hoy.getFullYear() - fechaAdq.getFullYear()) * 12 + (hoy.getMonth() - fechaAdq.getMonth());
  if (hoy.getDate() < fechaAdq.getDate()) mesesTranscurridos -= 1; // aún no se cumple el mes completo
  mesesTranscurridos = Math.max(0, Math.min(mesesTranscurridos, vidaUtilMeses));

  const depreciacionAcumulada = round2(depreciacionMensual * mesesTranscurridos);
  const valorEnLibros = round2(costo - depreciacionAcumulada);
  const totalmenteDepreciado = mesesTranscurridos >= vidaUtilMeses;

  return { depreciacionMensual: round2(depreciacionMensual), mesesTranscurridos, vidaUtilMeses, depreciacionAcumulada, valorEnLibros, totalmenteDepreciado };
}

/* =====================================================
   CARGA Y RENDER DE LA LISTA
===================================================== */
async function cargarActivos() {
  const cont = document.getElementById('lista-activos');
  if (cont) cont.innerHTML = 'Cargando…';
  try {
    const { data, error } = await sb.from('activos_fijos').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    if (error) throw error;
    STATE.activos = data || [];
    renderKPIsActivos();
    renderListaActivos();
  } catch (e) {
    console.error('cargarActivos:', e);
    if (cont) cont.innerHTML = '<p style="color:var(--danger);font-size:13px">No se pudieron cargar los activos.</p>';
  }
}

function renderKPIsActivos() {
  const activos = STATE.activos.filter(a => a.estado !== 'baja');
  const valorLibrosTotal = activos.reduce((s,a) => s + calcularDepreciacion(a).valorEnLibros, 0);
  const depreciacionTotal = activos.reduce((s,a) => s + calcularDepreciacion(a).depreciacionAcumulada, 0);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('kpi-total-activos', STATE.activos.length);
  set('kpi-valor-libros', fmt(valorLibrosTotal));
  set('kpi-depreciacion-total', fmt(depreciacionTotal));
  set('kpi-mantenimiento', STATE.activos.filter(a => a.estado === 'mantenimiento').length);
}

function filtrarActivosPorEstado(estado) {
  STATE.filtroEstado = estado;
  document.querySelectorAll('.filtro-estado-activo-btn').forEach(b => b.classList.toggle('active', b.dataset.estado === estado));
  renderListaActivos();
}

const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS_ACTIVOS.map(c => [c.key, c.label]));
const ESTADO_ACTIVO_LABEL = { activo:'Activo', mantenimiento:'En mantenimiento', baja:'Dado de baja' };
const ESTADO_ACTIVO_COLOR = { activo:'var(--success)', mantenimiento:'#f59e0b', baja:'var(--text-muted)' };

function renderListaActivos() {
  const cont = document.getElementById('lista-activos');
  if (!cont) return;
  const lista = STATE.filtroEstado ? STATE.activos.filter(a => a.estado === STATE.filtroEstado) : STATE.activos;

  if (!lista.length) {
    cont.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">
      ${STATE.activos.length ? 'No hay activos con este filtro.' : 'Todavía no has registrado ningún activo fijo.'}
    </div>`;
    return;
  }

  cont.innerHTML = lista.map(a => {
    const dep = calcularDepreciacion(a);
    const color = ESTADO_ACTIVO_COLOR[a.estado] || 'var(--text-muted)';
    return `
    <div class="panel-card" style="margin:0 0 10px;border-left:3px solid ${color};cursor:pointer" onclick="abrirDetalleActivo('${a.id}')">
      <div class="panel-body" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-weight:700;font-size:13.5px">${esc(a.nombre)}</span>
            <span style="font-size:10.5px;font-weight:700;color:${color};background:${color}22;padding:2px 8px;border-radius:20px">${ESTADO_ACTIVO_LABEL[a.estado]}</span>
            ${dep.totalmenteDepreciado && a.estado!=='baja' ? `<span style="font-size:10px;color:var(--text-muted)">— totalmente depreciado</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--text-muted)">${a.numero} · ${esc(CATEGORIA_LABEL[a.categoria] || a.categoria)}</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">Adquirido: ${fmtFechaCorta(a.fecha_adquisicion)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-muted)">Valor en libros</div>
          <div style="font-size:17px;font-weight:800;color:var(--accent)">${fmt(dep.valorEnLibros)}</div>
          <div style="font-size:11px;color:var(--text-muted)">de ${fmt(a.costo_adquisicion)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* =====================================================
   NUEVO ACTIVO
===================================================== */
function abrirNuevoActivo() {
  document.getElementById('na-nombre').value = '';
  const selCat = document.getElementById('na-categoria');
  selCat.innerHTML = CATEGORIAS_ACTIVOS.map(c => `<option value="${c.key}">${esc(c.label)} (${c.vidaUtil} años)</option>`).join('');
  document.getElementById('na-fecha').value = todayLocalISO();
  document.getElementById('na-costo').value = '';
  document.getElementById('na-vida-util').value = CATEGORIAS_ACTIVOS[0].vidaUtil;
  document.getElementById('na-valor-residual').value = '0';
  document.getElementById('na-serie').value = '';
  document.getElementById('na-ubicacion').value = '';
  document.getElementById('na-responsable').value = '';
  document.getElementById('na-proveedor').value = '';
  document.getElementById('na-garantia').value = '';
  document.getElementById('na-vida-util-gerencial').value = '';
  document.getElementById('na-usado-rutas').checked = false;
  document.getElementById('na-usado-delivery').checked = false;
  document.getElementById('na-descontar-caja').checked = true;
  document.getElementById('na-error').textContent = '';
  onCambioCategoriaActivo();
  onToggleDescontarCajaActivo();
  _bancoElegidoActivo = null; _montoBancoConvertidoActivo = null;
  document.getElementById('na-banco-elegir-wrap').style.display = 'none';
  document.getElementById('na-banco-elegido-wrap').style.display = 'none';
  openModal('modal-nuevo-activo');
}

function onCambioCategoriaActivo() {
  const key = document.getElementById('na-categoria').value;
  const cat = CATEGORIAS_ACTIVOS.find(c => c.key === key);
  if (!cat) return;
  document.getElementById('na-vida-util').value = cat.vidaUtil;
  document.getElementById('na-categoria-nota').textContent =
    `Vida útil sugerida según la Ley 822 de Nicaragua: ${cat.vidaUtil} años — puedes cambiarla si tu caso es distinto.`;
}

function onToggleDescontarCajaActivo() {
  const activo = document.getElementById('na-descontar-caja').checked;
  document.getElementById('na-metodo-wrap').style.display = activo ? '' : 'none';
}

function onCambioMontoActivo() {
  // Si ya se había elegido un banco antes de terminar de escribir el
  // costo, se le pide simplemente que lo vuelva a elegir — más
  // simple y seguro que intentar recalcular la conversión a medias.
  if (_bancoElegidoActivo) {
    cancelarSeleccionBancoActivo();
    showToast('Vuelve a elegir el banco, el costo cambió', 'error');
  }
}

let _bancoElegidoActivo = null;
let _montoBancoConvertidoActivo = null;

async function mostrarSelectorBancoActivo(metodoNombre) {
  const metodo = (metodoNombre || '').toLowerCase();
  document.getElementById('na-banco-elegir-wrap').style.display = 'none';
  document.getElementById('na-banco-elegido-wrap').style.display = 'none';
  _bancoElegidoActivo = null; _montoBancoConvertidoActivo = null;
  if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;

  const bancos = await cargarBancosDisponiblesActivos();
  if (!bancos.length) return;

  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  document.getElementById('na-banco-elegir-grid').innerHTML = bancos.map(b => `
    <div class="metodo-card" onclick="elegirBancoActivo('${b.id}','${esc(b.nombre)}','${b.moneda||'NIO'}')">
      <span class="mc-icon">🏦</span>
      <span class="mc-name">${esc(b.nombre)}${(b.moneda||'NIO')!==monedaBase ? ` <b style="color:var(--accent)">(${b.moneda})</b>` : ''}</span>
    </div>`).join('');
  document.getElementById('na-banco-elegir-wrap').style.display = '';
}

function elegirBancoActivo(bancoId, bancoNombre, monedaBanco) {
  _bancoElegidoActivo = bancoId;
  document.getElementById('na-banco-elegir-wrap').style.display = 'none';
  const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
  const esOtraMoneda = (monedaBanco||'NIO') !== monedaBase;
  const monto = parseFloat(document.getElementById('na-costo').value) || 0;
  const elNombre = document.getElementById('na-banco-elegido-nombre');

  if (esOtraMoneda) {
    const tasa = Number(STATE.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) {
      elNombre.innerHTML = `${esc(bancoNombre)} <span style="color:var(--danger)">— falta configurar tu tasa de cambio en Caja › Bancos</span>`;
    } else {
      const convertido = monedaBase === 'NIO' ? round2(monto / tasa) : round2(monto * tasa);
      _montoBancoConvertidoActivo = convertido;
      elNombre.innerHTML = `${esc(bancoNombre)} — se descontará ${monedaBanco==='USD'?'$':'C$'} ${convertido.toLocaleString('es-NI',{minimumFractionDigits:2})}`;
    }
  } else {
    elNombre.textContent = bancoNombre;
  }
  document.getElementById('na-banco-elegido-wrap').style.display = 'flex';
}

function cancelarSeleccionBancoActivo() {
  _bancoElegidoActivo = null; _montoBancoConvertidoActivo = null;
  document.getElementById('na-metodo').value = '';
  document.getElementById('na-banco-elegir-wrap').style.display = 'none';
  document.getElementById('na-banco-elegido-wrap').style.display = 'none';
}

async function guardarNuevoActivo() {
  const errEl = document.getElementById('na-error');
  errEl.textContent = '';

  const nombre = document.getElementById('na-nombre').value.trim();
  const categoria = document.getElementById('na-categoria').value;
  const fecha = document.getElementById('na-fecha').value;
  const costo = round2(parseFloat(document.getElementById('na-costo').value) || 0);
  const vidaUtil = parseFloat(document.getElementById('na-vida-util').value) || 0;
  const valorResidual = round2(parseFloat(document.getElementById('na-valor-residual').value) || 0);
  const descontarCaja = document.getElementById('na-descontar-caja').checked;

  if (!nombre) { errEl.textContent = 'El nombre del activo es obligatorio.'; return; }
  if (!fecha) { errEl.textContent = 'La fecha de adquisición es obligatoria.'; return; }
  if (costo <= 0) { errEl.textContent = 'El costo de adquisición debe ser mayor a cero.'; return; }
  if (vidaUtil <= 0) { errEl.textContent = 'La vida útil debe ser mayor a cero.'; return; }

  let metodoId = null, metodoNombre = null;
  if (descontarCaja) {
    const metodoSel = document.getElementById('na-metodo');
    metodoId = metodoSel.value || null;
    metodoNombre = metodoSel.selectedOptions[0]?.dataset.nombre || 'Efectivo';

    if (_bancoElegidoActivo) {
      const bancoInfo = (await cargarBancosDisponiblesActivos()).find(b => b.id === _bancoElegidoActivo);
      const monedaBase = STATE.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
      const esOtraMoneda = bancoInfo && (bancoInfo.moneda||'NIO') !== monedaBase;
      if (esOtraMoneda && !STATE.empresaConfig?.tasa_cambio_usd) {
        errEl.textContent = 'Falta configurar tu tasa de cambio en Caja › Bancos antes de continuar.';
        return;
      }
      const montoADescontar = esOtraMoneda ? _montoBancoConvertidoActivo : costo;
      const saldoBanco = await saldoActualBancoActivos(_bancoElegidoActivo);
      if (montoADescontar > saldoBanco + 0.01) {
        errEl.textContent = `Saldo insuficiente en ${bancoInfo?.nombre || 'ese banco'} — tiene ${saldoBanco.toLocaleString('es-NI',{minimumFractionDigits:2})} disponible.`;
        return;
      }
    }
  }

  setBtnLoading('btn-guardar-activo', true);
  try {
    const { data: numero } = await sb.rpc('siguiente_numero_activo', { p_user_id: STATE.userId });
    const cat = CATEGORIAS_ACTIVOS.find(c => c.key === categoria);
    const cuentaActivo = cat ? buscarCuentaPorCodigo(cat.cuentaCodigo) : null;
    const cuentaDepreciacion = buscarCuentaPorCodigo('1230'); // Depreciación Acumulada
    const cuentaGastoDepreciacion = buscarCuentaPorCodigo('6150'); // Depreciación (gasto)

    let movimientoCompraId = null;
    if (descontarCaja) {
      const { data: ultMov } = await sb.from('movimientos_financieros')
        .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
        .order('created_at', { ascending:false }).limit(1).maybeSingle();
      const saldoAnterior = ultMov?.saldo_resultante || 0;
      const saldoResultante = saldoAnterior - costo;

      const { data: mov, error: errMov } = await sb.from('movimientos_financieros').insert({
        auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'OTRO_EGRESO',
        concepto: `Compra de activo fijo: ${nombre}`,
        monto: costo, saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
        metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
        banco_id: _bancoElegidoActivo || null, monto_moneda_banco: _bancoElegidoActivo ? (_montoBancoConvertidoActivo ?? null) : null,
        fecha: todayLocalISO(), estado: 'completado',
      }).select('id').single();
      if (errMov) throw errMov;
      movimientoCompraId = mov.id;
    }

    const responsableInicial = document.getElementById('na-responsable').value || null;
    const ubicacionInicial = document.getElementById('na-ubicacion').value.trim() || null;

    const { data: nuevoActivo, error } = await sb.from('activos_fijos').insert({
      auth_user_id: STATE.userId, numero: numero || `AF-${Date.now()}`,
      nombre, categoria, fecha_adquisicion: fecha, costo_adquisicion: costo,
      vida_util_anos: vidaUtil, valor_residual: valorResidual,
      numero_serie: document.getElementById('na-serie').value.trim() || null,
      ubicacion: ubicacionInicial,
      responsable_perfil_id: responsableInicial,
      proveedor_id: document.getElementById('na-proveedor').value || null,
      garantia_vencimiento: document.getElementById('na-garantia').value || null,
      vida_util_gerencial_anos: parseFloat(document.getElementById('na-vida-util-gerencial').value) || null,
      usado_en_rutas: document.getElementById('na-usado-rutas').checked,
      usado_en_delivery: document.getElementById('na-usado-delivery').checked,
      estado: 'activo', movimiento_compra_id: movimientoCompraId,
      cuenta_activo_id: cuentaActivo?.id || null,
      cuenta_depreciacion_id: cuentaDepreciacion?.id || null,
      cuenta_gasto_depreciacion_id: cuentaGastoDepreciacion?.id || null,
    }).select('id').single();
    if (error) throw error;

    // Si ya se asignó responsable/ubicación desde la creación, se
    // registra como el primer renglón del historial de reasignaciones.
    if (responsableInicial || ubicacionInicial) {
      await sb.from('activo_reasignaciones').insert({
        auth_user_id: STATE.userId, activo_id: nuevoActivo.id,
        responsable_perfil_id: responsableInicial, ubicacion: ubicacionInicial,
        motivo: 'Asignación inicial', fecha_desde: todayLocalISO(),
      });
    }

    showToast('Activo registrado correctamente');
    closeModal('modal-nuevo-activo');
    await cargarActivos();
  } catch (e) {
    console.error('guardarNuevoActivo:', e);
    errEl.textContent = 'No se pudo crear el activo. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-guardar-activo', false);
  }
}

/* =====================================================
   DETALLE DEL ACTIVO — info completa, depreciación, mantenimientos,
   y accesos a "generar asientos", "registrar mantenimiento", "dar de baja".
===================================================== */
async function abrirDetalleActivo(activoId) {
  const a = STATE.activos.find(x => x.id === activoId);
  if (!a) return;
  STATE.activoActualId = activoId;
  document.getElementById('da-titulo').textContent = a.nombre;
  const cuerpo = document.getElementById('da-cuerpo');
  cuerpo.innerHTML = 'Cargando…';
  openModal('modal-detalle-activo');

  const dep = calcularDepreciacion(a);
  const responsable = STATE.perfiles.find(p => p.id === a.responsable_perfil_id);
  const proveedor = STATE.proveedores.find(p => p.id === a.proveedor_id);

  const { data: mantenimientos } = await sb.from('activo_mantenimientos').select('*')
    .eq('auth_user_id', STATE.userId).eq('activo_id', activoId).order('fecha', { ascending: false });
  const { data: reasignaciones } = await sb.from('activo_reasignaciones').select('*')
    .eq('auth_user_id', STATE.userId).eq('activo_id', activoId).order('fecha_desde', { ascending: false });
  const { data: mejoras } = await sb.from('activo_mejoras_capitalizadas').select('*')
    .eq('auth_user_id', STATE.userId).eq('activo_id', activoId).order('fecha', { ascending: false });

  const mesesPendientes = Math.max(0, dep.mesesTranscurridos - (a.meses_depreciados || 0));

  // Garantía/seguro — semáforo simple según cercanía del vencimiento.
  let garantiaHtml = '';
  if (a.garantia_vencimiento) {
    const hoy = new Date(); const venc = new Date(a.garantia_vencimiento + 'T00:00:00');
    const diasRestantes = Math.round((venc - hoy) / 86400000);
    const color = diasRestantes < 0 ? 'var(--danger)' : diasRestantes <= 30 ? '#f59e0b' : 'var(--success)';
    const texto = diasRestantes < 0 ? `venció hace ${Math.abs(diasRestantes)} días` : `vence en ${diasRestantes} días`;
    garantiaHtml = `<div><b>Garantía/seguro:</b> <span style="color:${color};font-weight:600">${fmtFechaCorta(a.garantia_vencimiento)} (${texto})</span></div>`;
  }

  // Vida útil gerencial (si es distinta a la fiscal) — se calcula
  // aparte, solo para mostrar, nunca reemplaza la fiscal.
  let gerencialHtml = '';
  if (a.vida_util_gerencial_anos) {
    const depGerencial = calcularDepreciacion({ ...a, vida_util_anos: a.vida_util_gerencial_anos });
    gerencialHtml = `<div style="margin-top:8px;padding:8px 10px;background:var(--bg-app);border-radius:8px;font-size:12px">
      📊 <b>Reporte interno</b> (vida útil de ${a.vida_util_gerencial_anos} años): valor en libros ${fmt(depGerencial.valorEnLibros)} — esto NO afecta tu contabilidad fiscal, es solo para tu propio análisis.
    </div>`;
  }

  // Costo real de operación, si es un vehículo usado en Rutas/Delivery.
  let operacionHtml = '';
  const operacion = await calcularCostoOperacionVehiculo(a, mantenimientos);
  if (operacion) {
    operacionHtml = `<div style="margin-top:12px;padding:10px 12px;background:var(--accent-soft);border-radius:8px;font-size:12.5px">
      🚚 <b>Costo real de operación</b> — ${fmt(operacion.costoTotal)} en total (depreciación + mantenimientos)
      ${operacion.usosTotal > 0 ? `, usado en ${operacion.usosTotal} ${operacion.usosTotal===1?'viaje':'viajes'} (${operacion.usosRutas} rutas, ${operacion.usosDelivery} deliveries) — ${fmt(operacion.costoPorUso)} por viaje` : ' — sin viajes registrados todavía'}
    </div>`;
  }

  cuerpo.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
      <div class="panel-card" style="margin:0;padding:12px"><div style="font-size:11px;color:var(--text-muted)">Costo actual</div><div style="font-size:16px;font-weight:800">${fmt(a.costo_adquisicion)}</div></div>
      <div class="panel-card" style="margin:0;padding:12px"><div style="font-size:11px;color:var(--text-muted)">Depreciación acumulada</div><div style="font-size:16px;font-weight:800;color:#f59e0b">${fmt(dep.depreciacionAcumulada)}</div></div>
      <div class="panel-card" style="margin:0;padding:12px"><div style="font-size:11px;color:var(--text-muted)">Valor en libros</div><div style="font-size:16px;font-weight:800;color:var(--accent)">${fmt(dep.valorEnLibros)}</div></div>
      <div class="panel-card" style="margin:0;padding:12px"><div style="font-size:11px;color:var(--text-muted)">Depreciación mensual</div><div style="font-size:16px;font-weight:800">${fmt(dep.depreciacionMensual)}</div></div>
    </div>

    <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:14px;line-height:1.7">
      <div><b>Número:</b> ${esc(a.numero)} · <b>Categoría:</b> ${esc(CATEGORIA_LABEL[a.categoria]||a.categoria)}</div>
      <div><b>Adquirido:</b> ${fmtFechaCorta(a.fecha_adquisicion)} · <b>Vida útil:</b> ${a.vida_util_anos} años (${dep.mesesTranscurridos}/${dep.vidaUtilMeses} meses transcurridos)</div>
      ${a.numero_serie ? `<div><b>Serie/placa:</b> ${esc(a.numero_serie)}</div>` : ''}
      ${a.ubicacion ? `<div><b>Ubicación:</b> ${esc(a.ubicacion)}</div>` : ''}
      ${responsable ? `<div><b>Responsable:</b> ${esc(responsable.nombre)}</div>` : ''}
      ${proveedor ? `<div><b>Proveedor:</b> ${esc(proveedor.nombre)}</div>` : ''}
      ${garantiaHtml}
    </div>
    ${gerencialHtml}
    ${operacionHtml}

    ${a.estado === 'baja' ? `
    <div style="padding:10px 12px;background:var(--bg-app);border-radius:8px;font-size:12.5px;margin:14px 0">
      🚫 Dado de baja el ${fmtFechaCorta(a.fecha_baja)} — motivo: ${esc(a.motivo_baja)}${a.valor_venta ? ` — vendido por ${fmt(a.valor_venta)}` : ''}
    </div>` : `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">
      ${mesesPendientes > 0 ? `<button class="btn-secondary btn-sm" onclick="generarAsientosDepreciacion('${a.id}')">📒 Generar asiento (${mesesPendientes} mes${mesesPendientes===1?'':'es'} pendiente${mesesPendientes===1?'':'s'})</button>` : `<span style="font-size:11.5px;color:var(--text-muted)">✅ Depreciación al día</span>`}
      <button class="btn-secondary btn-sm" onclick="abrirMantenimiento('${a.id}')">🔧 Mantenimiento</button>
      <button class="btn-secondary btn-sm" onclick="abrirMejora('${a.id}')">⬆️ Capitalizar mejora</button>
      <button class="btn-secondary btn-sm" onclick="abrirReasignar('${a.id}')">📍 Reasignar</button>
      <button class="btn-secondary btn-sm" onclick="abrirEtiqueta('${a.id}')">🏷️ Etiqueta</button>
      <button class="btn-ghost btn-sm" style="color:var(--danger)" onclick="abrirBajaActivo('${a.id}')">Dar de baja</button>
    </div>`}

    <div style="font-weight:700;font-size:13px;margin-bottom:8px">Historial de mantenimientos</div>
    <div style="margin-bottom:16px">
      ${(mantenimientos||[]).length ? mantenimientos.map(m => `
        <div style="display:flex;justify-content:space-between;padding:8px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:6px;font-size:12.5px">
          <span>${fmtFechaCorta(m.fecha)} — ${esc(m.descripcion)}</span>
          <span style="font-weight:600">${fmt(m.costo)}</span>
        </div>`).join('') : '<p style="font-size:12px;color:var(--text-muted)">Sin mantenimientos registrados todavía.</p>'}
    </div>

    ${(mejoras||[]).length ? `
    <div style="font-weight:700;font-size:13px;margin-bottom:8px">Mejoras capitalizadas</div>
    <div style="margin-bottom:16px">
      ${mejoras.map(m => `
        <div style="display:flex;justify-content:space-between;padding:8px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:6px;font-size:12.5px">
          <span>${fmtFechaCorta(m.fecha)} — ${esc(m.descripcion)}</span>
          <span style="font-weight:600;color:var(--accent)">+${fmt(m.monto)}</span>
        </div>`).join('')}
    </div>` : ''}

    ${(reasignaciones||[]).length ? `
    <div style="font-weight:700;font-size:13px;margin-bottom:8px">Historial de asignación</div>
    <div>
      ${reasignaciones.map(r => {
        const persona = STATE.perfiles.find(p => p.id === r.responsable_perfil_id);
        return `<div style="padding:8px 10px;background:var(--bg-app);border-radius:8px;margin-bottom:6px;font-size:12.5px">
          <b>${fmtFechaCorta(r.fecha_desde)}${r.fecha_hasta ? ' → '+fmtFechaCorta(r.fecha_hasta) : ' → hoy'}</b>
          ${persona ? ' — '+esc(persona.nombre) : ''}${r.ubicacion ? ' — '+esc(r.ubicacion) : ''}
          ${r.motivo ? `<div style="color:var(--text-muted);font-size:11.5px">${esc(r.motivo)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : ''}
  `;
}

/* =====================================================
   REGISTRAR MANTENIMIENTO — crea el gasto real vinculado
===================================================== */
function abrirMantenimiento(activoId) {
  document.getElementById('mn-activo-id').value = activoId;
  document.getElementById('mn-descripcion').value = '';
  document.getElementById('mn-fecha').value = todayLocalISO();
  document.getElementById('mn-costo').value = '';
  document.getElementById('mn-error').textContent = '';
  closeModal('modal-detalle-activo');
  openModal('modal-mantenimiento');
}

async function guardarMantenimiento() {
  const errEl = document.getElementById('mn-error');
  errEl.textContent = '';
  const activoId = document.getElementById('mn-activo-id').value;
  const a = STATE.activos.find(x => x.id === activoId);
  if (!a) return;
  const descripcion = document.getElementById('mn-descripcion').value.trim();
  const fecha = document.getElementById('mn-fecha').value;
  const costo = round2(parseFloat(document.getElementById('mn-costo').value) || 0);

  if (!descripcion) { errEl.textContent = 'Describe qué se le hizo al activo.'; return; }
  if (costo <= 0) { errEl.textContent = 'El costo debe ser mayor a cero.'; return; }

  try {
    const { data: ultMov } = await sb.from('movimientos_financieros')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
      .order('created_at', { ascending:false }).limit(1).maybeSingle();
    const saldoAnterior = ultMov?.saldo_resultante || 0;
    const saldoResultante = saldoAnterior - costo;

    const { data: mov, error: errMov } = await sb.from('movimientos_financieros').insert({
      auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO',
      concepto: `Mantenimiento: ${a.nombre} — ${descripcion}`,
      monto: costo, saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
      metodo_pago_nombre: 'Efectivo', fecha, estado: 'completado',
    }).select('id').single();
    if (errMov) throw errMov;

    const { data: gasto, error: errGasto } = await sb.from('gastos').insert({
      auth_user_id: STATE.userId, tipo: 'inmediato', concepto: `Mantenimiento: ${a.nombre}`,
      categoria: 'Mantenimiento de activos', monto: costo, fecha,
      metodo_pago_nombre: 'Efectivo', observaciones: descripcion,
      movimiento_financiero_id: mov.id, estado: 'activo',
    }).select('id').single();
    if (errGasto) throw errGasto;

    const { error: errMant } = await sb.from('activo_mantenimientos').insert({
      auth_user_id: STATE.userId, activo_id: activoId, fecha, descripcion, costo, gasto_id: gasto.id,
    });
    if (errMant) throw errMant;

    showToast('Mantenimiento registrado');
    closeModal('modal-mantenimiento');
    await cargarActivos();
    await abrirDetalleActivo(activoId);
  } catch (e) {
    console.error('guardarMantenimiento:', e);
    errEl.textContent = 'No se pudo registrar. Intenta de nuevo.';
  }
}

/* =====================================================
   DAR DE BAJA — venta (genera ingreso + ganancia/pérdida contable),
   o pérdida/robo/donación/obsoleto (sin ingreso).
===================================================== */
let _motivoBajaActual = 'venta';
let _bancoElegidoBaja = null;
let _montoBancoConvertidoBaja = null;

function abrirBajaActivo(activoId) {
  document.getElementById('ba-activo-id').value = activoId;
  document.getElementById('ba-valor-venta').value = '';
  document.getElementById('ba-error').textContent = '';
  _bancoElegidoBaja = null; _montoBancoConvertidoBaja = null;
  document.getElementById('ba-banco-elegir-wrap').style.display = 'none';
  document.getElementById('ba-banco-elegido-wrap').style.display = 'none';
  cambiarMotivoBaja('venta');
  closeModal('modal-detalle-activo');
  openModal('modal-baja-activo');
}

function cambiarMotivoBaja(motivo) {
  _motivoBajaActual = motivo;
  document.querySelectorAll('.motivo-baja-btn').forEach(b => b.classList.toggle('active', b.dataset.motivo === motivo));
  document.getElementById('ba-venta-wrap').style.display = motivo === 'venta' ? '' : 'none';
  actualizarGananciaBaja();
}

document.addEventListener('DOMContentLoaded', () => {
  const inputVenta = document.getElementById('ba-valor-venta');
  if (inputVenta) inputVenta.addEventListener('input', actualizarGananciaBaja);
});

function actualizarGananciaBaja() {
  const el = document.getElementById('ba-ganancia-texto');
  if (!el) return;
  const activoId = document.getElementById('ba-activo-id').value;
  const a = STATE.activos.find(x => x.id === activoId);
  const valorVenta = parseFloat(document.getElementById('ba-valor-venta').value) || 0;
  if (!a || valorVenta <= 0) { el.textContent = ''; return; }
  const dep = calcularDepreciacion(a);
  const ganancia = round2(valorVenta - dep.valorEnLibros);
  el.textContent = ganancia >= 0
    ? `Ganancia contable: ${fmt(ganancia)} (valor en libros: ${fmt(dep.valorEnLibros)})`
    : `Pérdida contable: ${fmt(Math.abs(ganancia))} (valor en libros: ${fmt(dep.valorEnLibros)})`;
}

async function mostrarSelectorBancoBaja(metodoNombre) {
  const metodo = (metodoNombre || '').toLowerCase();
  document.getElementById('ba-banco-elegir-wrap').style.display = 'none';
  document.getElementById('ba-banco-elegido-wrap').style.display = 'none';
  _bancoElegidoBaja = null; _montoBancoConvertidoBaja = null;
  if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;
  const bancos = await cargarBancosDisponiblesActivos();
  if (!bancos.length) return;
  document.getElementById('ba-banco-elegir-grid').innerHTML = bancos.map(b => `
    <div class="metodo-card" onclick="elegirBancoBaja('${b.id}','${esc(b.nombre)}')">
      <span class="mc-icon">🏦</span><span class="mc-name">${esc(b.nombre)}</span>
    </div>`).join('');
  document.getElementById('ba-banco-elegir-wrap').style.display = '';
}
function elegirBancoBaja(bancoId, bancoNombre) {
  _bancoElegidoBaja = bancoId;
  document.getElementById('ba-banco-elegir-wrap').style.display = 'none';
  document.getElementById('ba-banco-elegido-nombre').textContent = bancoNombre;
  document.getElementById('ba-banco-elegido-wrap').style.display = '';
}

async function confirmarBajaActivo() {
  const errEl = document.getElementById('ba-error');
  errEl.textContent = '';
  const activoId = document.getElementById('ba-activo-id').value;
  const a = STATE.activos.find(x => x.id === activoId);
  if (!a) return;

  let valorVenta = null, movimientoVentaId = null;

  if (_motivoBajaActual === 'venta') {
    valorVenta = round2(parseFloat(document.getElementById('ba-valor-venta').value) || 0);
    if (valorVenta <= 0) { errEl.textContent = 'Indica por cuánto se vendió.'; return; }

    const metodoSel = document.getElementById('ba-metodo');
    const metodoId = metodoSel.value || null;
    const metodoNombre = metodoSel.selectedOptions[0]?.dataset.nombre || 'Efectivo';

    try {
      const { data: ultMov } = await sb.from('movimientos_financieros')
        .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
        .order('created_at', { ascending:false }).limit(1).maybeSingle();
      const saldoAnterior = ultMov?.saldo_resultante || 0;
      const saldoResultante = saldoAnterior + valorVenta;

      const { data: mov, error: errMov } = await sb.from('movimientos_financieros').insert({
        auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'OTRO_INGRESO',
        concepto: `Venta de activo fijo: ${a.nombre}`,
        monto: valorVenta, saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
        metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
        banco_id: _bancoElegidoBaja || null,
        fecha: todayLocalISO(), estado: 'completado',
      }).select('id').single();
      if (errMov) throw errMov;
      movimientoVentaId = mov.id;
    } catch (e) {
      console.error('confirmarBajaActivo (venta):', e);
      errEl.textContent = 'No se pudo registrar la venta. Intenta de nuevo.';
      return;
    }
  }

  try {
    const { error } = await sb.from('activos_fijos').update({
      estado: 'baja', fecha_baja: todayLocalISO(), motivo_baja: _motivoBajaActual,
      valor_venta: valorVenta, movimiento_venta_id: movimientoVentaId, updated_at: new Date().toISOString(),
    }).eq('id', activoId).eq('auth_user_id', STATE.userId);
    if (error) throw error;

    showToast('Activo dado de baja');
    closeModal('modal-baja-activo');
    await cargarActivos();
  } catch (e) {
    console.error('confirmarBajaActivo:', e);
    errEl.textContent = 'No se pudo completar la baja. Intenta de nuevo.';
  }
}

/* =====================================================
   GENERAR ASIENTOS DE DEPRECIACIÓN — un asiento contable por cada
   mes pendiente (Debe: Gasto por Depreciación / Haber: Depreciación
   Acumulada), usando las mismas funciones ya construidas y probadas
   en Contabilidad para numerar y registrar asientos.
===================================================== */
async function generarAsientosDepreciacion(activoId) {
  const a = STATE.activos.find(x => x.id === activoId);
  if (!a) return;
  if (!a.cuenta_depreciacion_id || !a.cuenta_gasto_depreciacion_id) {
    showToast('Este activo no tiene cuentas contables vinculadas (revisa que tu catálogo tenga las cuentas 1230 y 6150).', 'error');
    return;
  }

  const dep = calcularDepreciacion(a);
  const mesesPendientes = Math.max(0, dep.mesesTranscurridos - (a.meses_depreciados || 0));
  if (mesesPendientes <= 0) { showToast('No hay meses pendientes de depreciar.'); return; }

  const montoPorMes = dep.depreciacionMensual;
  if (montoPorMes <= 0) { showToast('Este activo no tiene depreciación mensual (revisa el valor residual y la vida útil).', 'error'); return; }

  try {
    let mesesGenerados = 0;
    for (let i = 0; i < mesesPendientes; i++) {
      const { data: numero } = await sb.rpc('generar_numero_asiento', { p_user_id: STATE.userId });
      const { data: asiento, error: errAsiento } = await sb.from('asientos_contables').insert({
        auth_user_id: STATE.userId, numero: numero, fecha: todayLocalISO(),
        concepto: `Depreciación mensual — ${a.nombre} (${a.numero})`,
        estado: 'borrador', origen: 'automatico', referencia_tipo: 'activo_fijo', referencia_id: a.id,
        total_debe: montoPorMes, total_haber: montoPorMes,
      }).select('id').single();
      if (errAsiento) throw errAsiento;

      const { error: errDetalle } = await sb.from('asientos_detalle').insert([
        { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: a.cuenta_gasto_depreciacion_id, debe: montoPorMes, haber: 0, descripcion: `Depreciación — ${a.nombre}`, orden: 1 },
        { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: a.cuenta_depreciacion_id, debe: 0, haber: montoPorMes, descripcion: `Depreciación acumulada — ${a.nombre}`, orden: 2 },
      ]);
      if (errDetalle) throw errDetalle;

      const { error: errReg } = await sb.rpc('registrar_asiento_contable', { p_asiento_id: asiento.id });
      if (errReg) throw errReg;

      mesesGenerados++;
    }

    await sb.from('activos_fijos').update({
      meses_depreciados: (a.meses_depreciados || 0) + mesesGenerados, updated_at: new Date().toISOString(),
    }).eq('id', activoId).eq('auth_user_id', STATE.userId);

    showToast(`${mesesGenerados} asiento${mesesGenerados===1?'':'s'} de depreciación generado${mesesGenerados===1?'':'s'}`);
    await cargarActivos();
    await abrirDetalleActivo(activoId);
  } catch (e) {
    console.error('generarAsientosDepreciacion:', e);
    showToast('No se pudieron generar los asientos. Intenta de nuevo.', 'error');
  }
}

/* =====================================================
   REASIGNAR — historial de responsable/ubicación en el tiempo.
===================================================== */
function abrirReasignar(activoId) {
  const a = STATE.activos.find(x => x.id === activoId);
  if (!a) return;
  document.getElementById('rs-activo-id').value = activoId;
  document.getElementById('rs-responsable').value = a.responsable_perfil_id || '';
  document.getElementById('rs-ubicacion').value = a.ubicacion || '';
  document.getElementById('rs-motivo').value = '';
  document.getElementById('rs-error').textContent = '';
  closeModal('modal-detalle-activo');
  openModal('modal-reasignar-activo');
}

async function guardarReasignacion() {
  const errEl = document.getElementById('rs-error');
  errEl.textContent = '';
  const activoId = document.getElementById('rs-activo-id').value;
  const responsableId = document.getElementById('rs-responsable').value || null;
  const ubicacion = document.getElementById('rs-ubicacion').value.trim() || null;
  const motivo = document.getElementById('rs-motivo').value.trim() || null;

  try {
    await sb.from('activo_reasignaciones').update({ fecha_hasta: todayLocalISO() })
      .eq('activo_id', activoId).eq('auth_user_id', STATE.userId).is('fecha_hasta', null);

    const { error: errIns } = await sb.from('activo_reasignaciones').insert({
      auth_user_id: STATE.userId, activo_id: activoId,
      responsable_perfil_id: responsableId, ubicacion, motivo,
      fecha_desde: todayLocalISO(),
    });
    if (errIns) throw errIns;

    const { error: errUp } = await sb.from('activos_fijos').update({
      responsable_perfil_id: responsableId, ubicacion, updated_at: new Date().toISOString(),
    }).eq('id', activoId).eq('auth_user_id', STATE.userId);
    if (errUp) throw errUp;

    showToast('Activo reasignado');
    closeModal('modal-reasignar-activo');
    await cargarActivos();
  } catch (e) {
    console.error('guardarReasignacion:', e);
    errEl.textContent = 'No se pudo reasignar. Intenta de nuevo.';
  }
}

/* =====================================================
   CAPITALIZAR MEJORA
===================================================== */
function abrirMejora(activoId) {
  document.getElementById('mj-activo-id').value = activoId;
  document.getElementById('mj-descripcion').value = '';
  document.getElementById('mj-fecha').value = todayLocalISO();
  document.getElementById('mj-monto').value = '';
  document.getElementById('mj-error').textContent = '';
  closeModal('modal-detalle-activo');
  openModal('modal-mejora-activo');
}

async function guardarMejoraCapitalizada() {
  const errEl = document.getElementById('mj-error');
  errEl.textContent = '';
  const activoId = document.getElementById('mj-activo-id').value;
  const a = STATE.activos.find(x => x.id === activoId);
  if (!a) return;
  const descripcion = document.getElementById('mj-descripcion').value.trim();
  const fecha = document.getElementById('mj-fecha').value;
  const monto = round2(parseFloat(document.getElementById('mj-monto').value) || 0);

  if (!descripcion) { errEl.textContent = 'Describe qué mejora se hizo.'; return; }
  if (monto <= 0) { errEl.textContent = 'El monto debe ser mayor a cero.'; return; }

  try {
    const { data: ultMov } = await sb.from('movimientos_financieros')
      .select('saldo_resultante').eq('auth_user_id', STATE.userId).eq('estado','completado')
      .order('created_at', { ascending:false }).limit(1).maybeSingle();
    const saldoAnterior = ultMov?.saldo_resultante || 0;
    const saldoResultante = saldoAnterior - monto;

    const { data: mov, error: errMov } = await sb.from('movimientos_financieros').insert({
      auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO',
      concepto: `Mejora capitalizada: ${a.nombre} — ${descripcion}`,
      monto, saldo_anterior: saldoAnterior, saldo_resultante: saldoResultante,
      metodo_pago_nombre: 'Efectivo', fecha, estado: 'completado',
    }).select('id').single();
    if (errMov) throw errMov;

    const { data: gasto, error: errGasto } = await sb.from('gastos').insert({
      auth_user_id: STATE.userId, tipo: 'inmediato', concepto: `Mejora: ${a.nombre}`,
      categoria: 'Mejoras de activos', monto, fecha,
      metodo_pago_nombre: 'Efectivo', observaciones: descripcion,
      movimiento_financiero_id: mov.id, estado: 'activo',
    }).select('id').single();
    if (errGasto) throw errGasto;

    const { error: errMejora } = await sb.from('activo_mejoras_capitalizadas').insert({
      auth_user_id: STATE.userId, activo_id: activoId, fecha, descripcion, monto, gasto_id: gasto.id,
    });
    if (errMejora) throw errMejora;

    const { error: errUpdate } = await sb.from('activos_fijos').update({
      costo_adquisicion: round2(Number(a.costo_adquisicion) + monto), updated_at: new Date().toISOString(),
    }).eq('id', activoId).eq('auth_user_id', STATE.userId);
    if (errUpdate) throw errUpdate;

    showToast('Mejora capitalizada — el costo del activo aumentó');
    closeModal('modal-mejora-activo');
    await cargarActivos();
    await abrirDetalleActivo(activoId);
  } catch (e) {
    console.error('guardarMejoraCapitalizada:', e);
    errEl.textContent = 'No se pudo registrar. Intenta de nuevo.';
  }
}

/* =====================================================
   ETIQUETA / CÓDIGO QR
===================================================== */
function abrirEtiqueta(activoId) {
  const a = STATE.activos.find(x => x.id === activoId);
  if (!a) return;
  const texto = encodeURIComponent(`${a.numero} — ${a.nombre}`);
  const urlQR = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${texto}`;
  document.getElementById('et-cuerpo').innerHTML = `
    <img src="${urlQR}" alt="Código QR" style="border:1px solid var(--border);border-radius:8px" id="et-imagen"/>
    <div style="font-weight:800;font-size:15px;margin-top:10px">${esc(a.numero)}</div>
    <div style="font-size:13px;color:var(--text-secondary)">${esc(a.nombre)}</div>
  `;
  closeModal('modal-detalle-activo');
  openModal('modal-etiqueta-activo');
}

function imprimirEtiquetaActivo() {
  const contenido = document.getElementById('et-cuerpo').innerHTML;
  const ventana = window.open('', '_blank', 'width=400,height=500');
  ventana.document.write(`<html><head><title>Etiqueta</title></head>
    <body style="text-align:center;font-family:sans-serif;padding:30px">${contenido}</body></html>`);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}

/* =====================================================
   COSTO REAL DE OPERACIÓN — vehículos vinculados a Rutas/Delivery
===================================================== */
async function calcularCostoOperacionVehiculo(activo, mantenimientos) {
  if (!activo.usado_en_rutas && !activo.usado_en_delivery) return null;
  const dep = calcularDepreciacion(activo);
  const totalMantenimientos = (mantenimientos||[]).reduce((s,m) => s + Number(m.costo||0), 0);
  const costoTotal = round2(dep.depreciacionAcumulada + totalMantenimientos);

  let usosRutas = 0, usosDelivery = 0;
  if (activo.usado_en_rutas) {
    const { count } = await sb.from('rutas').select('id', { count:'exact', head:true })
      .eq('auth_user_id', STATE.userId).eq('activo_vehiculo_id', activo.id);
    usosRutas = count || 0;
  }
  if (activo.usado_en_delivery) {
    const { count } = await sb.from('delivery_pedidos').select('id', { count:'exact', head:true })
      .eq('auth_user_id', STATE.userId).eq('activo_vehiculo_id', activo.id);
    usosDelivery = count || 0;
  }
  const usosTotal = usosRutas + usosDelivery;
  return { costoTotal, usosRutas, usosDelivery, usosTotal,
    costoPorUso: usosTotal > 0 ? round2(costoTotal / usosTotal) : null };
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

    await Promise.all([cargarPerfilesInternos(), cargarProveedoresActivos(), loadMetodosPago(), cargarCuentasContables()]);
    await cargarActivos();
  } catch (e) {
    console.error('init activos:', e);
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
