/* =====================================================
   CONTABILIDAD.JS — NEGOCIO360
   Catálogo de cuentas + asientos contables con partida doble real.

   REGLA DE ORO: en cada asiento, Debe siempre debe ser igual a Haber.
   Esta regla se valida en el navegador (para avisar al instante) Y
   en la base de datos (registrar_asiento_contable), así que aunque
   hubiera un error de cálculo aquí, nunca se puede "colar" un asiento
   desbalanceado — la base de datos lo rechaza.

   FASE 1 de este módulo: catálogo de cuentas + asientos manuales +
   Libro Mayor + Balance de Comprobación. A propósito NO conecta
   todavía Ventas/Compras/Gastos/Salarios automáticamente — esa
   decisión (qué cuenta le corresponde a cada tipo de movimiento)
   merece su propia aprobación explícita, con calma, no apurada.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},
  cuentas: [], asientos: [],
  seccionActual: 'asientos',
};

/* =====================================================
   HELPERS
===================================================== */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtFecha(iso) {
  if (!iso) return '—';
  // FIX ZONA HORARIA: new Date("2026-08-19") sin hora se interpreta
  // como medianoche UTC, no medianoche local — en Nicaragua (UTC-6)
  // esa medianoche UTC ya es las 6PM del día ANTERIOR hora local, y
  // por eso se mostraba un día antes del real. Se agrega la hora
  // explícita para forzar que se lea como medianoche LOCAL.
  const fechaSolo = String(iso).slice(0, 10);
  return new Date(fechaSolo + 'T00:00:00').toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function fmt(n) {
  const moneda = monedaParaMostrar(STATE.empresaConfig?.moneda);
  return `${moneda} ${convertirParaMostrar(n, STATE.empresaConfig?.moneda).toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
}
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* =====================================================
   THEME / SIDEBAR / NAV (idéntico al resto del sistema)
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

async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbClient.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || data.nombre || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      if (data.color_principal || data.color_primario) {
        const col = data.color_principal || data.color_primario;
        document.documentElement.style.setProperty('--accent', col);
        document.documentElement.style.setProperty('--accent-soft', col + '22');
        document.documentElement.style.setProperty('--border-focus', col);
      }
      if (data.logo_principal_url || data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_principal_url || data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sbClient.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { console.warn('loadUserProfile:', e); return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const biz  = STATE.empresaConfig?.nombre_comercial || 'Mi negocio';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hBiz  = document.getElementById('header-biz');  if (hBiz)  hBiz.textContent  = biz;
  const hAv   = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name || 'U')[0].toUpperCase();
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sbClient.from('administradores').select('email, activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const nav = document.getElementById('nav-admin'); if (nav) nav.style.display = 'flex'; }
  } catch (e) { /* silencioso */ }
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; }
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) { e.target.style.display='none'; document.body.style.overflow=''; }
});
function showToast(msg, type='success') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type} toast-show`;
  clearTimeout(el._timer); el._timer = setTimeout(()=>el.classList.remove('toast-show'), 3500);
}
function setBtnLoading(id, loading) {
  const el = document.getElementById(id); if (!el) return;
  el.disabled = loading; el.style.opacity = loading ? '0.6' : '1';
}

/* =====================================================
   NAVEGACIÓN ENTRE SECCIONES
===================================================== */
function cambiarSeccionContable(seccion) {
  STATE.seccionActual = seccion;
  ['asientos','mayor','balance','resultados','balancegeneral','flujo','impuestos'].forEach(s => {
    document.getElementById(`seccion-${s}`).style.display = s === seccion ? '' : 'none';
    document.getElementById(`tab-btn-${s}`).classList.toggle('active', s === seccion);
  });
  if (seccion === 'mayor') poblarSelectCuentasMayor();
  if (seccion === 'balance') cargarBalanceComprobacion();
  if (seccion === 'impuestos') {
    if (!document.getElementById('imp-hasta').value) document.getElementById('imp-hasta').value = todayISO();
    cargarImpuestosContables();
  }
  if (seccion === 'resultados' && !document.getElementById('er-desde').value) {
    const hoy = new Date();
    document.getElementById('er-desde').value = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
    document.getElementById('er-hasta').value = todayISO();
  }
  if (seccion === 'balancegeneral' && !document.getElementById('bg-fecha').value) {
    document.getElementById('bg-fecha').value = todayISO();
  }
  if (seccion === 'flujo' && !document.getElementById('fe-desde').value) {
    const hoy = new Date();
    document.getElementById('fe-desde').value = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
    document.getElementById('fe-hasta').value = todayISO();
  }
}

/* =====================================================
   CATÁLOGO DE CUENTAS
===================================================== */
async function abrirCatalogoCuentas() {
  openModal('modal-catalogo-cuentas');
  await cargarCuentas();
}
async function cargarCuentas() {
  try {
    const { data } = await sbClient.from('cuentas_contables').select('*').eq('auth_user_id', STATE.userId).order('codigo');
    STATE.cuentas = data || [];
    renderCuentas();
  } catch (e) { console.warn('cargarCuentas:', e); }
}
function renderCuentas() {
  const tbody = document.getElementById('cuentas-tbody');
  if (!tbody) return;
  if (!STATE.cuentas.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Todavía no tienes ninguna cuenta — carga la plantilla estándar o crea una desde cero.</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.cuentas.map(c => `
    <tr>
      <td style="font-weight:600">${esc(c.codigo)}</td>
      <td style="padding-left:${(c.nivel-1)*14}px">${esc(c.nombre)}${!c.permite_movimientos ? ' <span style="font-size:10px;color:var(--text-muted)">(grupo)</span>' : ''}</td>
      <td>${capitalize(c.tipo)}</td>
      <td>${c.naturaleza === 'deudora' ? 'Deudora' : 'Acreedora'}</td>
      <td><label class="switch-mini"><input type="checkbox" ${c.activa?'checked':''} onchange="toggleCuentaActiva('${c.id}', this.checked)"/></label></td>
      <td class="td-actions"><button class="btn-icon" title="Editar" onclick="abrirEditarCuenta('${c.id}')">✏️</button><button class="btn-icon btn-icon-danger" title="Eliminar" onclick="eliminarCuenta('${c.id}')">🗑️</button></td>
    </tr>`).join('');
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }
async function toggleCuentaActiva(id, activa) {
  try {
    await sbClient.from('cuentas_contables').update({ activa }).eq('id', id).eq('auth_user_id', STATE.userId);
    const c = STATE.cuentas.find(x=>x.id===id); if (c) c.activa = activa;
  } catch (e) { showToast('No se pudo actualizar', 'error'); }
}

// Antes de eliminar, se revisa si la cuenta tiene movimientos o
// subcuentas — nunca se debe borrar una cuenta que ya se usó, porque
// eso dejaría huérfanos los asientos que dependen de ella. La base
// de datos también lo bloquea de todas formas (protección doble),
// pero aquí se explica claramente el motivo antes de intentarlo.
async function eliminarCuenta(id) {
  const c = STATE.cuentas.find(x => x.id === id);
  if (!c) return;

  const tieneSubcuentas = STATE.cuentas.some(x => x.cuenta_padre_id === id);
  if (tieneSubcuentas) {
    alert(`No se puede eliminar "${c.codigo} — ${c.nombre}" porque tiene subcuentas dentro de ella. Elimina o reasigna esas subcuentas primero.`);
    return;
  }

  const { count } = await sbClient.from('asientos_detalle').select('id', { count:'exact', head:true }).eq('cuenta_id', id).eq('auth_user_id', STATE.userId);
  if (count > 0) {
    alert(`No se puede eliminar "${c.codigo} — ${c.nombre}" porque ya tiene ${count} movimiento(s) contable(s) registrados. Si ya no la usas, mejor desactívala con el interruptor — así se conserva su historial pero deja de aparecer para asientos nuevos.`);
    return;
  }

  if (!confirm(`¿Eliminar la cuenta "${c.codigo} — ${c.nombre}"?\n\nEsta cuenta todavía no tiene ningún movimiento, así que se puede borrar sin ningún riesgo. Esta acción no se puede deshacer.`)) return;

  try {
    const { error } = await sbClient.from('cuentas_contables').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Cuenta eliminada');
    await cargarCuentas();
  } catch (e) {
    // Si por alguna razón la comprobación anterior no detectó algo y
    // la base de datos igual la bloquea, se explica el mismo motivo.
    showToast('No se pudo eliminar: esta cuenta ya tiene movimientos vinculados', 'error');
  }
}

// Plantilla estándar de cuentas — genérica, no atada a un solo país,
// sirve como punto de partida editable.
const PLANTILLA_CUENTAS = [
  { codigo:'1000', nombre:'ACTIVO', tipo:'activo', naturaleza:'deudora', permite_movimientos:false, nivel:1 },
  { codigo:'1100', nombre:'Activo Circulante', tipo:'activo', naturaleza:'deudora', permite_movimientos:false, nivel:2, padre:'1000' },
  { codigo:'1110', nombre:'Caja General', tipo:'activo', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'1100' },
  { codigo:'1120', nombre:'Bancos', tipo:'activo', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'1100' },
  { codigo:'1130', nombre:'Cuentas por Cobrar Clientes', tipo:'activo', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'1100' },
  { codigo:'1140', nombre:'Inventario', tipo:'activo', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'1100' },
  { codigo:'1150', nombre:'IVA Acreditable', tipo:'activo', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'1100' },
  { codigo:'1200', nombre:'Activo Fijo', tipo:'activo', naturaleza:'deudora', permite_movimientos:false, nivel:2, padre:'1000' },
  { codigo:'1210', nombre:'Mobiliario y Equipo', tipo:'activo', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'1200' },
  { codigo:'1220', nombre:'Vehículos', tipo:'activo', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'1200' },
  { codigo:'1230', nombre:'Depreciación Acumulada', tipo:'activo', naturaleza:'acreedora', permite_movimientos:true, nivel:3, padre:'1200' },

  { codigo:'2000', nombre:'PASIVO', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:false, nivel:1 },
  { codigo:'2100', nombre:'Pasivo Circulante', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:false, nivel:2, padre:'2000' },
  { codigo:'2110', nombre:'Cuentas por Pagar Proveedores', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:true, nivel:3, padre:'2100' },
  { codigo:'2120', nombre:'IVA por Pagar', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:true, nivel:3, padre:'2100' },
  { codigo:'2130', nombre:'Impuestos por Pagar', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:true, nivel:3, padre:'2100' },
  { codigo:'2140', nombre:'Sueldos por Pagar', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:true, nivel:3, padre:'2100' },
  { codigo:'2200', nombre:'Pasivo Largo Plazo', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:false, nivel:2, padre:'2000' },
  { codigo:'2210', nombre:'Préstamos por Pagar', tipo:'pasivo', naturaleza:'acreedora', permite_movimientos:true, nivel:3, padre:'2200' },

  { codigo:'3000', nombre:'CAPITAL', tipo:'capital', naturaleza:'acreedora', permite_movimientos:false, nivel:1 },
  { codigo:'3100', nombre:'Capital Social', tipo:'capital', naturaleza:'acreedora', permite_movimientos:true, nivel:2, padre:'3000' },
  { codigo:'3200', nombre:'Utilidades Retenidas', tipo:'capital', naturaleza:'acreedora', permite_movimientos:true, nivel:2, padre:'3000' },
  { codigo:'3300', nombre:'Utilidad del Ejercicio', tipo:'capital', naturaleza:'acreedora', permite_movimientos:true, nivel:2, padre:'3000' },

  { codigo:'4000', nombre:'INGRESOS', tipo:'ingreso', naturaleza:'acreedora', permite_movimientos:false, nivel:1 },
  { codigo:'4100', nombre:'Ventas', tipo:'ingreso', naturaleza:'acreedora', permite_movimientos:true, nivel:2, padre:'4000' },
  { codigo:'4200', nombre:'Otros Ingresos', tipo:'ingreso', naturaleza:'acreedora', permite_movimientos:true, nivel:2, padre:'4000' },

  { codigo:'5000', nombre:'COSTOS', tipo:'costo', naturaleza:'deudora', permite_movimientos:false, nivel:1 },
  { codigo:'5100', nombre:'Costo de Ventas', tipo:'costo', naturaleza:'deudora', permite_movimientos:true, nivel:2, padre:'5000' },

  { codigo:'6000', nombre:'GASTOS', tipo:'gasto', naturaleza:'deudora', permite_movimientos:false, nivel:1 },
  { codigo:'6100', nombre:'Gastos de Operación', tipo:'gasto', naturaleza:'deudora', permite_movimientos:false, nivel:2, padre:'6000' },
  { codigo:'6110', nombre:'Sueldos y Salarios', tipo:'gasto', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'6100' },
  { codigo:'6120', nombre:'Alquiler', tipo:'gasto', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'6100' },
  { codigo:'6130', nombre:'Publicidad', tipo:'gasto', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'6100' },
  { codigo:'6140', nombre:'Servicios Básicos', tipo:'gasto', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'6100' },
  { codigo:'6150', nombre:'Depreciación', tipo:'gasto', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'6100' },
  { codigo:'6190', nombre:'Otros Gastos', tipo:'gasto', naturaleza:'deudora', permite_movimientos:true, nivel:3, padre:'6100' },
];

async function cargarPlantillaCuentas() {
  if (!confirm(`Se agregarán ${PLANTILLA_CUENTAS.length} cuentas estándar. Las que ya tengas con el mismo código no se duplican. ¿Continuar?`)) return;
  try {
    const { data: existentes } = await sbClient.from('cuentas_contables').select('id, codigo').eq('auth_user_id', STATE.userId);
    const mapaExistentes = new Map((existentes||[]).map(c => [c.codigo, c.id]));

    // Primera pasada: crear/actualizar todas SIN padre (para tener los
    // ids), segunda pasada: asignar cuenta_padre_id por código.
    const idsPorCodigo = new Map(mapaExistentes);
    for (const c of PLANTILLA_CUENTAS) {
      if (idsPorCodigo.has(c.codigo)) continue;
      const { data, error } = await sbClient.from('cuentas_contables').insert({
        auth_user_id: STATE.userId, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo,
        naturaleza: c.naturaleza, nivel: c.nivel, permite_movimientos: c.permite_movimientos, activa: true,
      }).select().single();
      if (!error && data) idsPorCodigo.set(c.codigo, data.id);
    }
    for (const c of PLANTILLA_CUENTAS) {
      if (!c.padre) continue;
      const propioId = idsPorCodigo.get(c.codigo);
      const padreId = idsPorCodigo.get(c.padre);
      if (propioId && padreId) {
        await sbClient.from('cuentas_contables').update({ cuenta_padre_id: padreId }).eq('id', propioId).eq('auth_user_id', STATE.userId);
      }
    }
    showToast('Plantilla de cuentas cargada');
    await cargarCuentas();
  } catch (e) {
    console.error('cargarPlantillaCuentas:', e);
    showToast('Error al cargar la plantilla', 'error');
  }
}

function abrirNuevaCuenta() {
  document.getElementById('cta-modal-title').textContent = 'Nueva cuenta';
  document.getElementById('cta-id').value = '';
  document.getElementById('cta-codigo').value = '';
  document.getElementById('cta-nombre').value = '';
  document.getElementById('cta-tipo').value = 'activo';
  document.getElementById('cta-naturaleza').value = 'deudora';
  document.getElementById('cta-permite-movimientos').checked = true;
  document.getElementById('cta-error').textContent = '';
  poblarSelectCuentaPadre(null);
  openModal('modal-nueva-cuenta');
}
function abrirEditarCuenta(id) {
  const c = STATE.cuentas.find(x => x.id === id);
  if (!c) return;
  document.getElementById('cta-modal-title').textContent = 'Editar cuenta';
  document.getElementById('cta-id').value = c.id;
  document.getElementById('cta-codigo').value = c.codigo;
  document.getElementById('cta-nombre').value = c.nombre;
  document.getElementById('cta-tipo').value = c.tipo;
  document.getElementById('cta-naturaleza').value = c.naturaleza;
  document.getElementById('cta-permite-movimientos').checked = c.permite_movimientos;
  document.getElementById('cta-error').textContent = '';
  poblarSelectCuentaPadre(c.id);
  document.getElementById('cta-padre').value = c.cuenta_padre_id || '';
  openModal('modal-nueva-cuenta');
}
function poblarSelectCuentaPadre(excluirId) {
  const sel = document.getElementById('cta-padre');
  sel.innerHTML = '<option value="">— Ninguna (cuenta principal) —</option>' +
    STATE.cuentas.filter(c => c.id !== excluirId).map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
}
function autoNaturalezaCuenta() {
  const tipo = document.getElementById('cta-tipo').value;
  document.getElementById('cta-naturaleza').value = ['activo','costo','gasto'].includes(tipo) ? 'deudora' : 'acreedora';
}
async function guardarCuenta() {
  const errEl = document.getElementById('cta-error');
  errEl.textContent = '';
  const id = document.getElementById('cta-id').value || null;
  const codigo = document.getElementById('cta-codigo').value.trim();
  const nombre = document.getElementById('cta-nombre').value.trim();
  if (!codigo) { errEl.textContent = 'El código es requerido.'; return; }
  if (!nombre) { errEl.textContent = 'El nombre es requerido.'; return; }

  const padreId = document.getElementById('cta-padre').value || null;
  const payload = {
    codigo, nombre, tipo: document.getElementById('cta-tipo').value,
    naturaleza: document.getElementById('cta-naturaleza').value,
    cuenta_padre_id: padreId,
    nivel: padreId ? (STATE.cuentas.find(c=>c.id===padreId)?.nivel || 1) + 1 : 1,
    permite_movimientos: document.getElementById('cta-permite-movimientos').checked,
  };
  setBtnLoading('btn-guardar-cuenta', true);
  try {
    if (id) {
      await sbClient.from('cuentas_contables').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
    } else {
      await sbClient.from('cuentas_contables').insert({ auth_user_id: STATE.userId, activa: true, ...payload });
    }
    showToast('Cuenta guardada');
    closeModal('modal-nueva-cuenta');
    await cargarCuentas();
  } catch (e) {
    errEl.textContent = e.message?.includes('duplicate') ? 'Ya existe una cuenta con ese código.' : ('Error: ' + (e.message||''));
  } finally {
    setBtnLoading('btn-guardar-cuenta', false);
  }
}

/* =====================================================
   ASIENTOS CONTABLES
===================================================== */
let ASIENTO_LINEAS = [];
async function cargarAsientos() {
  const tbody = document.getElementById('asientos-tbody');
  try {
    const { data } = await sbClient.from('asientos_contables').select('*').eq('auth_user_id', STATE.userId).order('fecha', { ascending:false }).order('created_at', { ascending:false });
    STATE.asientos = data || [];
    if (!tbody) return;
    if (!STATE.asientos.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Todavía no has registrado ningún asiento</td></tr>`; return; }
    tbody.innerHTML = STATE.asientos.map(a => `
      <tr>
        <td data-label="N°" style="font-weight:600">${esc(a.numero)}</td>
        <td data-label="Fecha">${fmtFecha(a.fecha)}</td>
        <td data-label="Concepto">${esc(a.concepto)}</td>
        <td data-label="Debe">${fmt(a.total_debe)}</td>
        <td data-label="Haber">${fmt(a.total_haber)}</td>
        <td data-label="Estado"><span class="status-badge ${a.estado==='registrado'?'badge-activo':a.estado==='anulado'?'badge-inactivo':'badge-pendiente'}">${capitalize(a.estado)}</span></td>
        <td class="td-actions" data-label=""><button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="verAsiento('${a.id}')">Ver</button></td>
      </tr>`).join('');
  } catch (e) { console.warn('cargarAsientos:', e); }
}

async function abrirNuevoAsiento() {
  if (!STATE.cuentas.length) await cargarCuentas();
  if (!STATE.cuentas.filter(c=>c.permite_movimientos).length) {
    showToast('Primero carga o crea tu Catálogo de Cuentas', 'error');
    abrirCatalogoCuentas();
    return;
  }
  document.getElementById('as-fecha').value = todayISO();
  document.getElementById('as-concepto').value = '';
  document.getElementById('as-error').textContent = '';
  ASIENTO_LINEAS = [{ cuenta_id:'', debe:'', haber:'', descripcion:'' }, { cuenta_id:'', debe:'', haber:'', descripcion:'' }];
  renderLineasAsiento();
  openModal('modal-nuevo-asiento');
}
function renderLineasAsiento() {
  const opciones = STATE.cuentas.filter(c => c.permite_movimientos)
    .map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  document.getElementById('as-lineas').innerHTML = ASIENTO_LINEAS.map((l, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <select style="flex:2;min-width:180px" onchange="ASIENTO_LINEAS[${i}].cuenta_id=this.value">
        <option value="">Elige una cuenta…</option>${opciones}
      </select>
      <input type="number" placeholder="Debe" style="width:110px" value="${l.debe}" onchange="ASIENTO_LINEAS[${i}].debe=this.value;ASIENTO_LINEAS[${i}].haber='';renderLineasAsiento();actualizarTotalesAsiento()"/>
      <input type="number" placeholder="Haber" style="width:110px" value="${l.haber}" onchange="ASIENTO_LINEAS[${i}].haber=this.value;ASIENTO_LINEAS[${i}].debe='';renderLineasAsiento();actualizarTotalesAsiento()"/>
      <button type="button" class="btn-icon btn-icon-danger" onclick="ASIENTO_LINEAS.splice(${i},1);renderLineasAsiento();actualizarTotalesAsiento()">🗑️</button>
    </div>`).join('');
  // Reponer los valores de cuenta seleccionados (el innerHTML los resetea)
  const selects = document.querySelectorAll('#as-lineas select');
  selects.forEach((s,i) => { s.value = ASIENTO_LINEAS[i]?.cuenta_id || ''; });
  actualizarTotalesAsiento();
}
function agregarLineaAsiento() {
  ASIENTO_LINEAS.push({ cuenta_id:'', debe:'', haber:'', descripcion:'' });
  renderLineasAsiento();
}
function actualizarTotalesAsiento() {
  const totalDebe = round2(ASIENTO_LINEAS.reduce((s,l)=>s+(parseFloat(l.debe)||0),0));
  const totalHaber = round2(ASIENTO_LINEAS.reduce((s,l)=>s+(parseFloat(l.haber)||0),0));
  document.getElementById('as-total-debe').textContent = fmt(totalDebe);
  document.getElementById('as-total-haber').textContent = fmt(totalHaber);
  const dif = round2(totalDebe - totalHaber);
  const difEl = document.getElementById('as-diferencia');
  difEl.textContent = fmt(Math.abs(dif));
  difEl.style.color = dif === 0 ? 'var(--success)' : 'var(--danger)';
}

async function guardarAsiento(registrar) {
  const errEl = document.getElementById('as-error');
  errEl.textContent = '';
  const fecha = document.getElementById('as-fecha').value;
  const concepto = document.getElementById('as-concepto').value.trim();
  if (!fecha) { errEl.textContent = 'La fecha es requerida.'; return; }
  if (!concepto) { errEl.textContent = 'El concepto es requerido.'; return; }

  const lineasValidas = ASIENTO_LINEAS.filter(l => l.cuenta_id && (parseFloat(l.debe)>0 || parseFloat(l.haber)>0));
  if (lineasValidas.length < 2) { errEl.textContent = 'Se necesitan al menos 2 líneas con cuenta y monto.'; return; }

  const totalDebe = round2(lineasValidas.reduce((s,l)=>s+(parseFloat(l.debe)||0),0));
  const totalHaber = round2(lineasValidas.reduce((s,l)=>s+(parseFloat(l.haber)||0),0));
  if (registrar && totalDebe !== totalHaber) {
    errEl.textContent = `El asiento no cuadra: Debe ${fmt(totalDebe)} es distinto de Haber ${fmt(totalHaber)}. Ajusta los montos antes de registrar.`;
    return;
  }

  const btnId = registrar ? 'btn-registrar-asiento' : 'btn-guardar-borrador-asiento';
  setBtnLoading(btnId, true);
  try {
    const { data: numeroData } = await sbClient.rpc('generar_numero_asiento', { p_user_id: STATE.userId });
    const { data: asiento, error: errA } = await sbClient.from('asientos_contables').insert({
      auth_user_id: STATE.userId, numero: numeroData, fecha, concepto, estado: 'borrador', origen: 'manual',
      total_debe: totalDebe, total_haber: totalHaber, usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
    }).select().single();
    if (errA) throw errA;

    const detalle = lineasValidas.map((l, i) => ({
      auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: l.cuenta_id,
      debe: parseFloat(l.debe)||0, haber: parseFloat(l.haber)||0, descripcion: l.descripcion || null, orden: i,
    }));
    const { error: errD } = await sbClient.from('asientos_detalle').insert(detalle);
    if (errD) throw errD;

    if (registrar) {
      // Se valida OTRA VEZ en la base de datos — nunca se confía
      // únicamente en el cálculo del navegador para algo tan crítico.
      const { error: errReg } = await sbClient.rpc('registrar_asiento_contable', { p_asiento_id: asiento.id });
      if (errReg) throw errReg;
      showToast(`Asiento ${numeroData} registrado — cuadra perfecto`);
    } else {
      showToast(`Asiento ${numeroData} guardado como borrador`);
    }

    closeModal('modal-nuevo-asiento');
    await cargarAsientos();
  } catch (e) {
    console.error('guardarAsiento:', e);
    errEl.textContent = 'Error: ' + (e.message || 'no se pudo guardar');
  } finally {
    setBtnLoading(btnId, false);
  }
}

let ASIENTO_VIENDO = null;
async function verAsiento(id) {
  const a = STATE.asientos.find(x => x.id === id);
  if (!a) return;
  ASIENTO_VIENDO = a;
  document.getElementById('va-titulo').textContent = `Asiento ${a.numero}`;
  document.getElementById('va-cuerpo').innerHTML = 'Cargando…';
  openModal('modal-ver-asiento');

  const { data: detalle } = await sbClient.from('asientos_detalle').select('*, cuentas_contables(codigo,nombre)').eq('asiento_id', id).order('orden');
  document.getElementById('va-cuerpo').innerHTML = `
    <div class="form-row" style="margin-bottom:14px">
      <div><label>Fecha</label><div class="stat-readonly">${fmtFecha(a.fecha)}</div></div>
      <div><label>Estado</label><div class="stat-readonly">${capitalize(a.estado)}</div></div>
      <div class="full-col"><label>Concepto</label><div class="stat-readonly">${esc(a.concepto)}</div></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Cuenta</th><th>Debe</th><th>Haber</th></tr></thead>
        <tbody>
          ${(detalle||[]).map(d => `<tr><td>${esc(d.cuentas_contables?.codigo)} — ${esc(d.cuentas_contables?.nombre)}</td><td>${d.debe>0?fmt(d.debe):'—'}</td><td>${d.haber>0?fmt(d.haber):'—'}</td></tr>`).join('')}
          <tr style="font-weight:800;border-top:2px solid var(--border)"><td>TOTALES</td><td>${fmt(a.total_debe)}</td><td>${fmt(a.total_haber)}</td></tr>
        </tbody>
      </table>
    </div>
    ${a.estado==='anulado' ? `<p style="font-size:12px;color:var(--danger);margin-top:10px">Anulado: ${esc(a.anulado_motivo||'')}</p>` : ''}`;

  document.getElementById('va-btn-registrar').style.display = a.estado === 'borrador' ? '' : 'none';
  document.getElementById('va-btn-anular').style.display = a.estado === 'registrado' ? '' : 'none';
  document.getElementById('va-btn-editar').style.display = '';
  document.getElementById('va-btn-guardar-edicion').style.display = 'none';
}
async function registrarAsientoDesdeVer() {
  if (!ASIENTO_VIENDO) return;
  try {
    const { error } = await sbClient.rpc('registrar_asiento_contable', { p_asiento_id: ASIENTO_VIENDO.id });
    if (error) throw error;
    showToast('Asiento registrado — cuadra perfecto');
    closeModal('modal-ver-asiento');
    await cargarAsientos();
  } catch (e) {
    showToast('No se pudo registrar: ' + (e.message||''), 'error');
  }
}
async function anularAsiento() {
  if (!ASIENTO_VIENDO) return;
  const motivo = prompt('¿Por qué se anula este asiento?');
  if (motivo === null) return;
  try {
    await sbClient.from('asientos_contables').update({ estado:'anulado', anulado_en: new Date().toISOString(), anulado_motivo: motivo || 'Sin especificar' })
      .eq('id', ASIENTO_VIENDO.id).eq('auth_user_id', STATE.userId);
    showToast('Asiento anulado');
    closeModal('modal-ver-asiento');
    await cargarAsientos();
  } catch (e) {
    showToast('No se pudo anular', 'error');
  }
}

/* =====================================================
   EDITAR ASIENTO MANUALMENTE — para cuando el contador necesita
   corregir un dato especifico (cuenta equivocada, monto mal
   escrito, fecha incorrecta) sin tener que anular y volver a crear
   todo desde cero. Funciona sin importar el estado (borrador o
   registrado) -- la correccion se puede necesitar en cualquiera
   de los 2. Siempre exige que Debe siga siendo igual a Haber antes
   de guardar, igual que en cualquier otro asiento del sistema.
===================================================== */
function renderEditorLineasAsiento() {
  const cont = document.getElementById('va-editor-lineas');
  if (!cont) return;
  const opcionesCuentas = STATE.cuentas.filter(c => c.permite_movimientos)
    .map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');

  cont.innerHTML = STATE.lineasAsientoEditando.map((linea, i) => `
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:center;margin-bottom:8px">
      <select onchange="actualizarLineaAsiento(${i}, 'cuenta_id', this.value)">
        <option value="">— Elige una cuenta —</option>
        ${opcionesCuentas}
      </select>
      <input type="number" min="0" step="0.01" placeholder="Debe" value="${linea.debe || ''}" oninput="actualizarLineaAsiento(${i}, 'debe', this.value)"/>
      <input type="number" min="0" step="0.01" placeholder="Haber" value="${linea.haber || ''}" oninput="actualizarLineaAsiento(${i}, 'haber', this.value)"/>
      <button type="button" onclick="eliminarLineaAsiento(${i})" title="Eliminar línea" style="background:none;border:none;cursor:pointer;font-size:15px;color:var(--danger);padding:4px">🗑️</button>
    </div>`).join('');

  // Preseleccionar la cuenta de cada linea (el <select> no soporta
  // "selected" dinamico limpio dentro del template de arriba).
  const selects = cont.querySelectorAll('select');
  STATE.lineasAsientoEditando.forEach((linea, i) => { if (selects[i]) selects[i].value = linea.cuenta_id || ''; });

  actualizarResumenCuadreEdicion();
}
function agregarLineaEdicionAsiento() {
  STATE.lineasAsientoEditando.push({ cuenta_id:'', debe:'', haber:'' });
  renderEditorLineasAsiento();
}
function actualizarLineaAsiento(i, campo, valor) {
  if (!STATE.lineasAsientoEditando[i]) return;
  STATE.lineasAsientoEditando[i][campo] = valor;
  actualizarResumenCuadreEdicion();
}
function eliminarLineaAsiento(i) {
  STATE.lineasAsientoEditando.splice(i, 1);
  renderEditorLineasAsiento();
}
function actualizarResumenCuadreEdicion() {
  const el = document.getElementById('va-resumen-cuadre');
  if (!el) return;
  const totalDebe = round2(STATE.lineasAsientoEditando.reduce((s,l) => s + (Number(l.debe)||0), 0));
  const totalHaber = round2(STATE.lineasAsientoEditando.reduce((s,l) => s + (Number(l.haber)||0), 0));
  const cuadra = totalDebe === totalHaber && totalDebe > 0;
  el.innerHTML = `Debe: <b>${fmt(totalDebe)}</b> — Haber: <b>${fmt(totalHaber)}</b> — ` +
    (cuadra ? `<span style="color:var(--success)">✅ Cuadra</span>` : `<span style="color:var(--danger)">⚠️ No cuadra</span>`);
}

async function activarEdicionAsiento() {
  if (!ASIENTO_VIENDO) return;
  const { data: detalle } = await sbClient.from('asientos_detalle').select('*').eq('asiento_id', ASIENTO_VIENDO.id).order('orden');
  STATE.lineasAsientoEditando = (detalle||[]).map(d => ({ cuenta_id: d.cuenta_id, debe: d.debe>0?d.debe:'', haber: d.haber>0?d.haber:'' }));

  document.getElementById('va-cuerpo').innerHTML = `
    <div class="form-row" style="margin-bottom:14px">
      <div class="form-group"><label>Fecha</label><input type="date" id="va-edit-fecha" value="${esc(ASIENTO_VIENDO.fecha)}"/></div>
      <div class="form-group full-col"><label>Concepto</label><input type="text" id="va-edit-concepto" value="${esc(ASIENTO_VIENDO.concepto||'')}"/></div>
    </div>
    <div id="va-editor-lineas"></div>
    <button type="button" class="btn-ghost" style="margin-top:6px" onclick="agregarLineaEdicionAsiento()">+ Agregar línea</button>
    <div id="va-resumen-cuadre" style="margin-top:10px;font-size:13px"></div>
    <p id="va-edit-error" style="color:var(--danger);font-size:12.5px;margin-top:6px"></p>`;

  renderEditorLineasAsiento();

  document.getElementById('va-btn-editar').style.display = 'none';
  document.getElementById('va-btn-guardar-edicion').style.display = '';
  document.getElementById('va-btn-registrar').style.display = 'none';
  document.getElementById('va-btn-anular').style.display = 'none';
}

async function guardarEdicionAsiento() {
  if (!ASIENTO_VIENDO) return;
  const errEl = document.getElementById('va-edit-error');
  errEl.textContent = '';

  const fecha = document.getElementById('va-edit-fecha')?.value;
  const concepto = document.getElementById('va-edit-concepto')?.value.trim();
  if (!fecha) { errEl.textContent = 'Elige una fecha.'; return; }
  if (!concepto) { errEl.textContent = 'Escribe un concepto.'; return; }

  const lineasValidas = STATE.lineasAsientoEditando.filter(l => l.cuenta_id && ((Number(l.debe)||0) > 0 || (Number(l.haber)||0) > 0));
  if (lineasValidas.length < 2) { errEl.textContent = 'Se necesitan al menos 2 líneas (una cuenta no puede cuadrar sola).'; return; }

  const lineaIncompleta = STATE.lineasAsientoEditando.findIndex(l => l.cuenta_id && (Number(l.debe)||0) > 0 && (Number(l.haber)||0) > 0);
  if (lineaIncompleta !== -1) { errEl.textContent = `La línea #${lineaIncompleta+1} tiene Debe y Haber a la vez — una línea solo debe tener uno de los dos.`; return; }

  const totalDebe = round2(lineasValidas.reduce((s,l) => s + (Number(l.debe)||0), 0));
  const totalHaber = round2(lineasValidas.reduce((s,l) => s + (Number(l.haber)||0), 0));
  if (totalDebe !== totalHaber) { errEl.textContent = `No cuadra: Debe ${fmt(totalDebe)} vs Haber ${fmt(totalHaber)} — deben ser exactamente iguales.`; return; }

  setBtnLoading('va-btn-guardar-edicion', true);
  try {
    await sbClient.from('asientos_contables').update({
      fecha, concepto, total_debe: totalDebe, total_haber: totalHaber,
    }).eq('id', ASIENTO_VIENDO.id).eq('auth_user_id', STATE.userId);

    // Reemplazar las lineas -- igual que sincronizarEscalas() en
    // Productos: borrar todo lo viejo, insertar lo nuevo completo.
    await sbClient.from('asientos_detalle').delete().eq('asiento_id', ASIENTO_VIENDO.id).eq('auth_user_id', STATE.userId);
    const nuevasLineas = lineasValidas.map((l, i) => ({
      auth_user_id: STATE.userId, asiento_id: ASIENTO_VIENDO.id, cuenta_id: l.cuenta_id,
      debe: Number(l.debe)||0, haber: Number(l.haber)||0, orden: i,
    }));
    const { error: errIns } = await sbClient.from('asientos_detalle').insert(nuevasLineas);
    if (errIns) throw errIns;

    showToast('Asiento corregido');
    closeModal('modal-ver-asiento');
    await cargarAsientos();
  } catch (e) {
    console.error('guardarEdicionAsiento:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('va-btn-guardar-edicion', false);
  }
}

/* =====================================================
   LIBRO MAYOR — movimiento detallado de una cuenta
===================================================== */
function poblarSelectCuentasMayor() {
  const sel = document.getElementById('mayor-cuenta-select');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Elige una cuenta…</option>' +
    STATE.cuentas.filter(c => c.permite_movimientos).map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  if (actual) sel.value = actual;
  // Cuentas de dinero (contabilidad-dinero.js): opción "Todo el dinero" y cuadre, solo si está configurado.
  if (window.N360Dinero) {
    N360Dinero.opcionesMayor(sel).then(() => { if (actual) sel.value = actual; });
    N360Dinero.renderCuadre();
  }
}
async function cargarLibroMayor() {
  const cuentaId = document.getElementById('mayor-cuenta-select').value;
  const tbody = document.getElementById('mayor-tbody');
  if (!cuentaId) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Elige una cuenta para ver su movimiento</td></tr>'; return; }
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Cargando…</td></tr>';
  if (cuentaId === '__dinero__' && window.N360Dinero) { await N360Dinero.cargarMayorConsolidado(tbody); return; }

  const cuenta = STATE.cuentas.find(c => c.id === cuentaId);

  // BUG REAL CORREGIDO: esta consulta traia como maximo 1000 filas
  // (limite por defecto de Supabase) -- en una cuenta con mucho
  // movimiento (confirmado con un caso real: 6179 lineas), se veia
  // una lista incompleta y el saldo acumulado final quedaba mal, sin
  // ningun aviso de que faltaban datos. Ahora se pagina de verdad:
  // se sigue pidiendo la siguiente pagina hasta traer TODO.
  let data = [];
  let desde = 0;
  const TAMANO_PAGINA = 1000;
  while (true) {
    const { data: pagina, error } = await sbClient.from('asientos_detalle')
      .select('*, asientos_contables!inner(numero,fecha,concepto,estado)')
      .eq('cuenta_id', cuentaId).eq('auth_user_id', STATE.userId).eq('asientos_contables.estado', 'registrado')
      .order('asientos_contables(fecha)')
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (error) { console.error('cargarLibroMayor:', error); break; }
    data = data.concat(pagina || []);
    if (!pagina || pagina.length < TAMANO_PAGINA) break; // ya se trajo todo
    desde += TAMANO_PAGINA;
  }

  const lista = data.sort((a,b) => (a.asientos_contables.fecha||'').localeCompare(b.asientos_contables.fecha||''));
  let saldo = 0;
  const filas = lista.map(d => {
    saldo += cuenta.naturaleza === 'deudora' ? (d.debe - d.haber) : (d.haber - d.debe);
    return { ...d, saldoAcumulado: saldo };
  });

  if (!filas.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Esta cuenta todavía no tiene movimientos registrados</td></tr>'; return; }
  tbody.innerHTML = filas.map(d => `
    <tr>
      <td>${fmtFecha(d.asientos_contables.fecha)}</td>
      <td>${esc(d.asientos_contables.numero)}</td>
      <td>${esc(d.descripcion || d.asientos_contables.concepto)}</td>
      <td>${d.debe>0?fmt(d.debe):'—'}</td>
      <td>${d.haber>0?fmt(d.haber):'—'}</td>
      <td style="font-weight:700">${fmt(d.saldoAcumulado)}</td>
    </tr>`).join('');
}

/* =====================================================
   BALANCE DE COMPROBACIÓN — la prueba de que todo cuadra: la suma
   general de todos los Debe siempre debe ser igual a la suma
   general de todos los Haber, sin excepción.
===================================================== */
async function cargarBalanceComprobacion() {
  const tbody = document.getElementById('balance-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Cargando…</td></tr>';
  try {
    // Mismo bug real corregido que en calcularMovimientoPorTipo(): se
    // traían todas las lineas de detalle al navegador (limitado a
    // 1000 por consulta) -- ahora se suma directo en la base de
    // datos, sin ese límite, sin importar cuantos asientos existan.
    const idsTodasCuentas = STATE.cuentas.filter(c => c.permite_movimientos).map(c => c.id);
    const { data, error } = idsTodasCuentas.length
      ? await sbClient.rpc('sumar_movimientos_por_cuenta', { p_cuenta_ids: idsTodasCuentas, p_fecha_desde: null, p_fecha_hasta: null })
      : { data: [], error: null };
    if (error) throw error;

    const porCuenta = new Map();
    (data||[]).forEach(d => porCuenta.set(d.cuenta_id, { debe: Number(d.total_debe)||0, haber: Number(d.total_haber)||0 }));

    let totalDebeGeneral = 0, totalHaberGeneral = 0;
    const filas = STATE.cuentas.filter(c => c.permite_movimientos && porCuenta.has(c.id)).map(c => {
      const { debe, haber } = porCuenta.get(c.id);
      totalDebeGeneral += debe; totalHaberGeneral += haber;
      const saldo = c.naturaleza === 'deudora' ? debe - haber : haber - debe;
      return { cuenta: c, debe, haber, saldoDeudor: saldo>0 && c.naturaleza==='deudora' ? saldo : (saldo<0 && c.naturaleza==='acreedora' ? -saldo : 0), saldoAcreedor: saldo>0 && c.naturaleza==='acreedora' ? saldo : (saldo<0 && c.naturaleza==='deudora' ? -saldo : 0) };
    });

    if (!filas.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Todavía no hay asientos registrados</td></tr>'; STATE.balanceActual = null; return; }

    tbody.innerHTML = filas.map(f => `
      <tr>
        <td>${esc(f.cuenta.codigo)}</td><td>${esc(f.cuenta.nombre)}</td>
        <td>${fmt(f.debe)}</td><td>${fmt(f.haber)}</td>
        <td>${f.saldoDeudor>0?fmt(f.saldoDeudor):'—'}</td><td>${f.saldoAcreedor>0?fmt(f.saldoAcreedor):'—'}</td>
      </tr>`).join('') + `
      <tr style="font-weight:800;border-top:2px solid var(--border)">
        <td colspan="2">TOTALES</td><td>${fmt(totalDebeGeneral)}</td><td>${fmt(totalHaberGeneral)}</td>
        <td>${fmt(filas.reduce((s,f)=>s+f.saldoDeudor,0))}</td><td>${fmt(filas.reduce((s,f)=>s+f.saldoAcreedor,0))}</td>
      </tr>`;

    const cuadra = round2(totalDebeGeneral) === round2(totalHaberGeneral);
    document.getElementById('balance-cuadre-aviso').innerHTML = cuadra
      ? `<div style="background:var(--success-soft);color:var(--success);padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600">✅ Todo cuadra: Debe = Haber = ${fmt(totalDebeGeneral)}</div>`
      : `<div style="background:var(--danger-soft);color:var(--danger);padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600">⚠️ Hay una diferencia de ${fmt(Math.abs(totalDebeGeneral-totalHaberGeneral))} — esto no debería pasar nunca; revisa si algún asiento quedó anulado a medias.</div>`;

    STATE.balanceActual = { filas, totalDebeGeneral, totalHaberGeneral };
  } catch (e) {
    console.error('cargarBalanceComprobacion:', e);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Error al cargar</td></tr>';
  }
}

function exportarBalance(formato) {
  const b = STATE.balanceActual;
  if (!b || !b.filas.length) { showToast('No hay datos para exportar', 'error'); return; }
  const bizName = STATE.empresaConfig?.nombre_comercial || 'Mi Negocio';
  const headers = ['Código','Cuenta','Debe','Haber','Saldo Deudor','Saldo Acreedor'];
  const rows = b.filas.map(f => [f.cuenta.codigo, f.cuenta.nombre, f.debe, f.haber, f.saldoDeudor||0, f.saldoAcreedor||0]);
  const totales = ['','TOTALES', b.totalDebeGeneral, b.totalHaberGeneral, b.filas.reduce((s,f)=>s+f.saldoDeudor,0), b.filas.reduce((s,f)=>s+f.saldoAcreedor,0)];

  if (formato === 'excel') {
    // BUG REAL CORREGIDO: el PDF ya convertia correctamente (usa
    // fmt(), que si respeta la moneda de visualizacion) -- pero
    // Excel usaba los numeros crudos de "rows" directo, siempre en
    // la moneda oficial. Se convierte aqui, en un arreglo aparte,
    // para no afectar en nada al PDF (que sigue usando "rows" tal
    // cual, sin duplicar la conversion).
    const cv = v => convertirParaMostrar(Number(v)||0, STATE.empresaConfig?.moneda);
    const rowsExcel = b.filas.map(f => [f.cuenta.codigo, f.cuenta.nombre, cv(f.debe), cv(f.haber), cv(f.saldoDeudor||0), cv(f.saldoAcreedor||0)]);
    const totalesExcel = ['','TOTALES', cv(b.totalDebeGeneral), cv(b.totalHaberGeneral), cv(b.filas.reduce((s,f)=>s+f.saldoDeudor,0)), cv(b.filas.reduce((s,f)=>s+f.saldoAcreedor,0))];
    const aoa = [[bizName],['Balance de Comprobación'],[`Al ${fmtFecha(todayISO())}`],[],headers,...rowsExcel,totalesExcel];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [0,1,2].map(r => ({ s:{r,c:0}, e:{r,c:headers.length-1} }));
    ws['!cols'] = headers.map((h,ci) => ({ wch: Math.min(Math.max(...[...rowsExcel.map(r=>String(r[ci]??'').length), h.length])+2, 32) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Balance');
    XLSX.writeFile(wb, 'Balance_de_Comprobacion.xlsx');
  } else {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    doc.setFontSize(14); doc.text(bizName, 14, 14);
    doc.setFontSize(10); doc.text('Balance de Comprobación', 14, 20);
    doc.autoTable({ startY:26, head:[headers], body:[...rows.map(r=>r.map((v,i)=>i>1?fmt(v):v)), totales.map((v,i)=>i>1?fmt(v):v)], theme:'grid', headStyles:{fillColor:[108,99,255]} });
    doc.save('Balance_de_Comprobacion.pdf');
  }
  showToast(`${formato.toUpperCase()} descargado`);
}

/* =====================================================
   ESTADO DE RESULTADOS — solo lectura, calculado a partir de los
   asientos ya REGISTRADOS (nunca de borradores) en el rango de
   fechas elegido.

   Matemática (naturaleza de cada tipo de cuenta):
   - Ingreso  (acreedora): saldo = Haber - Debe
   - Costo    (deudora):   saldo = Debe - Haber
   - Gasto    (deudora):   saldo = Debe - Haber
   Utilidad Bruta = Ingresos - Costos
   Utilidad Neta  = Utilidad Bruta - Gastos
===================================================== */
async function calcularMovimientoPorTipo(tiposCuenta, fechaDesde, fechaHasta) {
  const cuentasFiltradas = STATE.cuentas.filter(c => tiposCuenta.includes(c.tipo));
  if (!cuentasFiltradas.length) return { filas: [], total: 0 };
  const idsCuentas = cuentasFiltradas.map(c => c.id);

  // BUG REAL CORREGIDO: antes se traía CADA línea de asientos_detalle
  // al navegador para sumarla aquí -- pero Supabase limita cada
  // consulta a 1000 filas por defecto. En cuentas con mucho
  // movimiento (confirmado con un caso real: 6179 líneas en una sola
  // cuenta), la suma quedaba basada en una porción al azar de los
  // datos, nunca el total real -- por eso el Balance General podía
  // no cuadrar. Ahora se suma DIRECTO en la base de datos (función
  // sumar_movimientos_por_cuenta), sin traer ninguna fila individual
  // -- nunca queda limitado, sin importar cuantos movimientos tenga.
  const { data, error } = await sbClient.rpc('sumar_movimientos_por_cuenta', {
    p_cuenta_ids: idsCuentas,
    p_fecha_desde: fechaDesde || null,
    p_fecha_hasta: fechaHasta || null,
  });
  if (error) { console.error('sumar_movimientos_por_cuenta:', error); return { filas: [], total: 0 }; }

  const porCuenta = new Map();
  (data||[]).forEach(d => porCuenta.set(d.cuenta_id, { debe: Number(d.total_debe)||0, haber: Number(d.total_haber)||0 }));

  const filas = cuentasFiltradas.filter(c => porCuenta.has(c.id)).map(c => {
    const { debe, haber } = porCuenta.get(c.id);
    const saldo = c.naturaleza === 'deudora' ? round2(debe - haber) : round2(haber - debe);
    return { cuenta: c, saldo };
  });
  const total = round2(filas.reduce((s,f)=>s+f.saldo, 0));
  return { filas, total };
}

// Desglose de gastos por categoria real (Publicidad, Salarios, etc.)
// -- distinto del agrupado por cuenta contable que ya arma
// calcularMovimientoPorTipo(). No toca ese calculo, solo agrega una
// vista adicional consultando la tabla gastos directamente.
async function calcularGastosPorCategoria(desde, hasta) {
  try {
    const { data, error } = await sbClient.from('gastos')
      .select('categoria, monto').eq('auth_user_id', STATE.userId).eq('estado', 'activo')
      .gte('fecha', desde).lte('fecha', hasta);
    if (error) throw error;
    const porCategoria = {};
    (data || []).forEach(g => {
      const cat = g.categoria || 'Sin categoría';
      porCategoria[cat] = (porCategoria[cat] || 0) + (Number(g.monto) || 0);
    });
    return Object.entries(porCategoria)
      .map(([categoria, monto]) => ({ categoria, monto: round2(monto) }))
      .sort((a, b) => b.monto - a.monto);
  } catch (e) {
    console.error('calcularGastosPorCategoria:', e);
    return [];
  }
}

async function cargarEstadoResultados() {
  const desde = document.getElementById('er-desde').value;
  const hasta = document.getElementById('er-hasta').value;
  if (!desde || !hasta) { showToast('Elige el período', 'error'); return; }
  const cuerpo = document.getElementById('er-cuerpo');
  cuerpo.innerHTML = 'Calculando…';

  const ingresos = await calcularMovimientoPorTipo(['ingreso'], desde, hasta);
  const costos   = await calcularMovimientoPorTipo(['costo'], desde, hasta);
  const gastos   = await calcularMovimientoPorTipo(['gasto'], desde, hasta);
  const gastosPorCategoria = await calcularGastosPorCategoria(desde, hasta);

  const utilidadBruta = round2(ingresos.total - costos.total);
  const utilidadNeta = round2(utilidadBruta - gastos.total);

  STATE.estadoResultadosActual = { desde, hasta, ingresos, costos, gastos, utilidadBruta, utilidadNeta, gastosPorCategoria };

  const filaGrupo = (titulo, grupo, signo='') => `
    <tr style="font-weight:700;background:var(--bg-app)"><td colspan="2">${titulo}</td></tr>
    ${grupo.filas.map(f => `<tr><td style="padding-left:24px">${esc(f.cuenta.codigo)} — ${esc(f.cuenta.nombre)}</td><td style="text-align:right">${fmt(f.saldo)}</td></tr>`).join('') || '<tr><td style="padding-left:24px;color:var(--text-muted)" colspan="2">Sin movimiento en este período</td></tr>'}
    <tr style="font-weight:700;border-top:1px solid var(--border)"><td style="padding-left:24px">Total ${titulo}</td><td style="text-align:right">${fmt(grupo.total)}</td></tr>`;

  cuerpo.innerHTML = `
    <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px">Período: ${fmtFecha(desde)} — ${fmtFecha(hasta)}</div>
    <table style="width:100%;font-size:13.5px;border-collapse:collapse">
      ${filaGrupo('Ingresos', ingresos)}
      ${filaGrupo('Costo de Ventas', costos)}
      <tr style="font-weight:800;font-size:15px;background:var(--accent-soft);color:var(--accent)"><td>Utilidad Bruta</td><td style="text-align:right">${fmt(utilidadBruta)}</td></tr>
      ${filaGrupo('Gastos de Operación', gastos)}
      ${gastosPorCategoria.length ? `
      <tr><td colspan="2" style="padding:10px 12px 4px;font-size:12px;color:var(--text-muted)">Desglose por categoría</td></tr>
      ${gastosPorCategoria.map(g => `<tr><td style="padding-left:24px;font-size:12.5px">${esc(g.categoria)}</td><td style="text-align:right;font-size:12.5px">${fmt(g.monto)}</td></tr>`).join('')}
      ` : ''}
      <tr style="font-weight:800;font-size:16px;background:${utilidadNeta>=0?'var(--success-soft)':'var(--danger-soft)'};color:${utilidadNeta>=0?'var(--success)':'var(--danger)'}"><td>${utilidadNeta>=0?'Utilidad Neta del período':'Pérdida Neta del período'}</td><td style="text-align:right">${fmt(Math.abs(utilidadNeta))}</td></tr>
    </table>`;
}

function exportarEstadoResultados(formato) {
  const e = STATE.estadoResultadosActual;
  if (!e) { showToast('Primero calcula el período', 'error'); return; }
  const bizName = STATE.empresaConfig?.nombre_comercial || 'Mi Negocio';
  const filas = [
    ['INGRESOS','',''], ...e.ingresos.filas.map(f=>[f.cuenta.codigo, f.cuenta.nombre, f.saldo]), ['','Total Ingresos', e.ingresos.total],
    ['COSTO DE VENTAS','',''], ...e.costos.filas.map(f=>[f.cuenta.codigo, f.cuenta.nombre, f.saldo]), ['','Total Costos', e.costos.total],
    ['','UTILIDAD BRUTA', e.utilidadBruta],
    ['GASTOS DE OPERACIÓN','',''], ...e.gastos.filas.map(f=>[f.cuenta.codigo, f.cuenta.nombre, f.saldo]), ['','Total Gastos', e.gastos.total],
    ...((e.gastosPorCategoria||[]).length ? [['','Desglose por categoría',''], ...e.gastosPorCategoria.map(g=>['', '  '+g.categoria, g.monto])] : []),
    ['','UTILIDAD NETA', e.utilidadNeta],
  ];
  if (formato === 'excel') {
    // Mismo bug real corregido que en exportarBalance(): el PDF ya
    // convierte (usa fmt()), Excel usaba el numero crudo. Se
    // convierte aqui en un arreglo aparte para no afectar al PDF.
    const cv = v => convertirParaMostrar(Number(v)||0, STATE.empresaConfig?.moneda);
    const filasExcel = filas.map(f => [f[0], f[1], typeof f[2]==='number' ? cv(f[2]) : f[2]]);
    const aoa = [[bizName],['Estado de Resultados'],[`Período: ${fmtFecha(e.desde)} — ${fmtFecha(e.hasta)}`],[],['Código','Cuenta','Monto'],...filasExcel];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [0,1,2].map(r => ({ s:{r,c:0}, e:{r,c:2} }));
    ws['!cols'] = [{wch:10},{wch:32},{wch:16}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Estado de Resultados');
    XLSX.writeFile(wb, 'Estado_de_Resultados.xlsx');
  } else {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    doc.setFontSize(14); doc.text(bizName, 14, 14);
    doc.setFontSize(10); doc.text('Estado de Resultados', 14, 20);
    doc.text(`Período: ${fmtFecha(e.desde)} — ${fmtFecha(e.hasta)}`, 14, 25);
    doc.autoTable({ startY:30, head:[['Código','Cuenta','Monto']], body: filas.map(f=>[f[0], f[1], typeof f[2]==='number'?fmt(f[2]):'']), theme:'grid', headStyles:{fillColor:[108,99,255]} });
    doc.save('Estado_de_Resultados.pdf');
  }
  showToast(`${formato.toUpperCase()} descargado`);
}

/* =====================================================
   BALANCE GENERAL — solo lectura, "foto" acumulada desde el inicio
   hasta la fecha elegida.

   Activo = Pasivo + Capital + Utilidad Acumulada
   Esto SIEMPRE debe cuadrar matemáticamente si la partida doble se
   respetó en cada asiento — es la prueba final de que todo el
   sistema contable está sano.
===================================================== */
async function cargarBalanceGeneral() {
  const fecha = document.getElementById('bg-fecha').value;
  if (!fecha) { showToast('Elige una fecha', 'error'); return; }
  const cuerpo = document.getElementById('bg-cuerpo');
  cuerpo.innerHTML = 'Calculando…';

  const activo = await calcularMovimientoPorTipo(['activo'], null, fecha);
  const pasivo = await calcularMovimientoPorTipo(['pasivo'], null, fecha);
  const capital = await calcularMovimientoPorTipo(['capital'], null, fecha);
  const ingresos = await calcularMovimientoPorTipo(['ingreso'], null, fecha);
  const costos = await calcularMovimientoPorTipo(['costo'], null, fecha);
  const gastos = await calcularMovimientoPorTipo(['gasto'], null, fecha);
  const utilidadAcumulada = round2(ingresos.total - costos.total - gastos.total);

  const totalPasivoCapital = round2(pasivo.total + capital.total + utilidadAcumulada);
  const cuadra = round2(activo.total) === totalPasivoCapital;

  STATE.balanceGeneralActual = { fecha, activo, pasivo, capital, utilidadAcumulada, totalPasivoCapital, cuadra };

  document.getElementById('bg-cuadre-aviso').innerHTML = cuadra
    ? `<div style="background:var(--success-soft);color:var(--success);padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600">✅ Cuadra: Activo (${fmt(activo.total)}) = Pasivo + Capital (${fmt(totalPasivoCapital)})</div>`
    : `<div style="background:var(--danger-soft);color:var(--danger);padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600">⚠️ No cuadra: Activo ${fmt(activo.total)} vs Pasivo+Capital ${fmt(totalPasivoCapital)} — esto no debería pasar nunca; revisa si hay algún asiento anulado a medias.</div>`;

  const filaGrupo = (titulo, grupo) => `
    <tr style="font-weight:700;background:var(--bg-app)"><td colspan="2">${titulo}</td></tr>
    ${grupo.filas.map(f => `<tr><td style="padding-left:24px">${esc(f.cuenta.codigo)} — ${esc(f.cuenta.nombre)}</td><td style="text-align:right">${fmt(f.saldo)}</td></tr>`).join('') || '<tr><td style="padding-left:24px;color:var(--text-muted)" colspan="2">Sin saldo</td></tr>'}
    <tr style="font-weight:700;border-top:1px solid var(--border)"><td style="padding-left:24px">Total ${titulo}</td><td style="text-align:right">${fmt(grupo.total)}</td></tr>`;

  cuerpo.innerHTML = `
    <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px">Al ${fmtFecha(fecha)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <table style="width:100%;font-size:13.5px;border-collapse:collapse">
        ${filaGrupo('Activo', activo)}
      </table>
      <table style="width:100%;font-size:13.5px;border-collapse:collapse">
        ${filaGrupo('Pasivo', pasivo)}
        ${filaGrupo('Capital', capital)}
        <tr style="font-weight:700;background:var(--accent-soft);color:var(--accent)"><td>Utilidad Acumulada</td><td style="text-align:right">${fmt(utilidadAcumulada)}</td></tr>
        <tr style="font-weight:800;font-size:15px;border-top:2px solid var(--border)"><td>Total Pasivo + Capital</td><td style="text-align:right">${fmt(totalPasivoCapital)}</td></tr>
      </table>
    </div>
    <div id="bg-cuadre-grupo"></div>`;
  cargarCuadreGrupo(activo);
}

/* Cuadre del grupo (solo lectura): mercadería de la central y de cada
   bodega/sucursal al costo, contra el saldo de la cuenta de Inventario.
   Solo aparece si esta cuenta es la central de un grupo. */
async function cargarCuadreGrupo(activo) {
  const cont = document.getElementById('bg-cuadre-grupo');
  if (!cont || !window.N360ContaGrupo) return;
  cont.innerHTML = '';
  try {
    const lugares = await N360ContaGrupo.inventarioPorLugar(sbClient, STATE.userId, STATE.empresaConfig?.nombre_comercial || 'Central');
    if (lugares.length < 2) return; // no es central de un grupo: no se muestra nada
    const { data: mapeoData } = await sbClient.from('contabilidad_mapeo_cuentas').select('tipo_transaccion, cuenta_debe_id, cuenta_haber_id').eq('auth_user_id', STATE.userId);
    const mp = new Map((mapeoData || []).map(m => [m.tipo_transaccion, m]));
    const idsInv = new Set([mp.get('costo_ventas')?.cuenta_haber_id, mp.get('compra')?.cuenta_debe_id, mp.get('inventario_inicial')?.cuenta_debe_id].filter(Boolean));
    const filasInv = (activo?.filas || []).filter(f => idsInv.has(f.cuenta.id));
    const contable = round2(filasInv.reduce((t, f) => t + f.saldo, 0));
    const real = round2(lugares.reduce((t, l) => t + l.valor, 0));
    const dif = round2(real - contable);
    const ok = Math.abs(dif) < 1;
    const tipoTxt = t => t === 'central' ? 'Central' : t === 'bodega' ? 'Bodega' : 'Sucursal';
    cont.innerHTML = `
      <div style="margin-top:22px;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
        <div style="font-weight:700;font-size:14.5px;margin-bottom:4px">🏬 Inventario del grupo (central, bodegas y sucursales)</div>
        <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px">La contabilidad de esta cuenta es el libro de todo el grupo. Mercadería de HOY (existencias × costo) de cada lugar, contra la cuenta de Inventario. Los traslados entre lugares no cambian el total.</div>
        <table style="width:100%;font-size:13.5px;border-collapse:collapse">
          ${lugares.map(l => `<tr><td>${esc(l.nombre)} <span style="color:var(--text-muted);font-size:12px">· ${tipoTxt(l.tipo)} · ${l.conExistencia} producto(s) con existencia</span></td><td style="text-align:right">${fmt(l.valor)}</td></tr>`).join('')}
          <tr style="font-weight:700;border-top:1px solid var(--border)"><td>Mercadería total del grupo</td><td style="text-align:right">${fmt(real)}</td></tr>
          <tr><td>Inventario en contabilidad ${filasInv.length ? '(' + filasInv.map(f => esc(f.cuenta.codigo)).join(', ') + ')' : '(cuenta no configurada)'}</td><td style="text-align:right">${fmt(contable)}</td></tr>
          <tr style="font-weight:700;color:${ok ? 'var(--success)' : 'var(--danger)'}"><td>Diferencia</td><td style="text-align:right">${fmt(dif)}</td></tr>
        </table>
        <div style="font-size:12.5px;margin-top:8px;color:${ok ? 'var(--success)' : 'var(--text-secondary)'}">${ok
          ? '✅ El inventario contable cuadra con la mercadería de todo el grupo.'
          : 'Para cuadrarlo: presiona "Generar asientos" (incluye bodegas y sucursales) y luego "Conciliar inventario inicial", que registra como apertura la mercadería que ya existía, incluida la de las bodegas.'}</div>
      </div>`;
  } catch (e) { console.warn('cargarCuadreGrupo:', e); }
}

function exportarBalanceGeneral(formato) {
  const b = STATE.balanceGeneralActual;
  if (!b) { showToast('Primero calcula el balance', 'error'); return; }
  const bizName = STATE.empresaConfig?.nombre_comercial || 'Mi Negocio';
  const filas = [
    ['ACTIVO','',''], ...b.activo.filas.map(f=>[f.cuenta.codigo, f.cuenta.nombre, f.saldo]), ['','Total Activo', b.activo.total],
    ['PASIVO','',''], ...b.pasivo.filas.map(f=>[f.cuenta.codigo, f.cuenta.nombre, f.saldo]), ['','Total Pasivo', b.pasivo.total],
    ['CAPITAL','',''], ...b.capital.filas.map(f=>[f.cuenta.codigo, f.cuenta.nombre, f.saldo]), ['','Total Capital', b.capital.total],
    ['','Utilidad Acumulada', b.utilidadAcumulada],
    ['','TOTAL PASIVO + CAPITAL', b.totalPasivoCapital],
  ];
  if (formato === 'excel') {
    // Mismo bug real corregido que en las 2 exportaciones anteriores:
    // el PDF ya convierte (usa fmt()), Excel usaba el numero crudo.
    const cv = v => convertirParaMostrar(Number(v)||0, STATE.empresaConfig?.moneda);
    const filasExcel = filas.map(f => [f[0], f[1], typeof f[2]==='number' ? cv(f[2]) : f[2]]);
    const aoa = [[bizName],['Balance General'],[`Al ${fmtFecha(b.fecha)}`],[],['Código','Cuenta','Monto'],...filasExcel];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [0,1,2].map(r => ({ s:{r,c:0}, e:{r,c:2} }));
    ws['!cols'] = [{wch:10},{wch:32},{wch:16}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Balance General');
    XLSX.writeFile(wb, 'Balance_General.xlsx');
  } else {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    doc.setFontSize(14); doc.text(bizName, 14, 14);
    doc.setFontSize(10); doc.text('Balance General', 14, 20);
    doc.text(`Al ${fmtFecha(b.fecha)}`, 14, 25);
    doc.autoTable({ startY:30, head:[['Código','Cuenta','Monto']], body: filas.map(f=>[f[0], f[1], typeof f[2]==='number'?fmt(f[2]):'']), theme:'grid', headStyles:{fillColor:[108,99,255]} });
    doc.save('Balance_General.pdf');
  }
  showToast(`${formato.toUpperCase()} descargado`);
}

/* =====================================================
   ESTADO DE FLUJO DE EFECTIVO — método directo (el más claro para
   un dueño de negocio, según las guías profesionales: "efectivo
   recibido de clientes", "efectivo pagado a proveedores", etc.).

   Solo lee movimientos_financieros (la Caja) — nunca toca ni
   modifica nada del resto del sistema. Se contrasta contra el saldo
   real de Caja al final, para comprobar que cuadra con la realidad,
   no solo con la teoría.
===================================================== */
const CATEGORIA_FLUJO = {
  VENTA: { grupo:'operacion', label:'Efectivo recibido de clientes (ventas)' },
  COBRO: { grupo:'operacion', label:'Efectivo recibido de clientes (cobros)' },
  PAGO_CREDITO: { grupo:'operacion', label:'Efectivo recibido de clientes (créditos)' },
  COMPRA: { grupo:'operacion', label:'Efectivo pagado a proveedores (compras)' },
  PAGO: { grupo:'operacion', label:'Pagos a proveedores (cuentas por pagar)' },
  GASTO: { grupo:'operacion', label:'Efectivo pagado en gastos' },
  PAGO_SALARIO: { grupo:'operacion', label:'Efectivo pagado en salarios' },
  CREDITO_OTORGADO: { grupo:'operacion', label:'Créditos otorgados (sin movimiento de caja)' },
  OTRO_INGRESO: { grupo:'operacion', label:'Otros ingresos operativos' },
  OTRO_EGRESO: { grupo:'operacion', label:'Otros egresos operativos' },
  CAPITAL_AGREGADO: { grupo:'financiamiento', label:'Capital aportado por el dueño' },
  RETIRO: { grupo:'financiamiento', label:'Retiros del dueño' },
};

async function cargarFlujoEfectivo() {
  const desde = document.getElementById('fe-desde').value;
  const hasta = document.getElementById('fe-hasta').value;
  if (!desde || !hasta) { showToast('Elige el período', 'error'); return; }
  const cuerpo = document.getElementById('fe-cuerpo');
  cuerpo.innerHTML = 'Calculando…';

  // BUG REAL CORREGIDO: esta funcion traia CADA movimiento financiero
  // individual al navegador para sumarlo aqui -- con miles de
  // movimientos reales, Supabase corta en 1000 filas por defecto,
  // dando un "efectivo real" y "saldo inicial" incorrectos. Ahora se
  // suma DIRECTO en la base de datos (2 funciones nuevas), sin traer
  // ninguna fila individual -- nunca queda limitado.
  const fechaAntesDesde = (() => {
    const [y,m,d] = desde.split('-').map(Number);
    const dt = new Date(y, m-1, d-1);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  })();

  const [{ data: saldoInicialData }, { data: categorias }, { data: saldoRealData }] = await Promise.all([
    sbClient.rpc('saldo_efectivo_hasta_fecha', { p_fecha: fechaAntesDesde }),
    sbClient.rpc('flujo_efectivo_por_categoria', { p_desde: desde, p_hasta: hasta }),
    sbClient.rpc('saldo_efectivo_hasta_fecha', { p_fecha: hasta }),
  ]);
  const saldoInicial = round2(Number(saldoInicialData) || 0);

  const grupos = { operacion: [], financiamiento: [], inversion: [] };
  const acumulado = new Map();
  (categorias||[]).forEach(m => {
    const info = CATEGORIA_FLUJO[m.tipo_movimiento] || { grupo:'operacion', label: m.tipo_movimiento };
    const signo = m.tipo_flujo === 'INGRESO' ? 1 : -1;
    const clave = `${info.grupo}:${info.label}`;
    acumulado.set(clave, round2((acumulado.get(clave)||0) + signo*Number(m.total||0)));
  });
  acumulado.forEach((monto, clave) => {
    const [grupo, label] = clave.split(':');
    grupos[grupo].push({ label, monto });
  });

  const totalOperacion = round2(grupos.operacion.reduce((s,f)=>s+f.monto,0));
  const totalFinanciamiento = round2(grupos.financiamiento.reduce((s,f)=>s+f.monto,0));
  const totalInversion = round2(grupos.inversion.reduce((s,f)=>s+f.monto,0));
  const flujoNeto = round2(totalOperacion + totalFinanciamiento + totalInversion);
  const saldoFinalCalculado = round2(saldoInicial + flujoNeto);

  // Prueba de realidad: se compara contra el efectivo real acumulado
  // a esa fecha (nunca contra Caja General completa, que sí incluye
  // tarjeta/transferencia y por eso no debe coincidir con esto).
  const saldoRealCaja = round2(Number(saldoRealData) || 0);
  const cuadra = saldoFinalCalculado === saldoRealCaja;

  STATE.flujoEfectivoActual = { desde, hasta, saldoInicial, grupos, totalOperacion, totalFinanciamiento, totalInversion, flujoNeto, saldoFinalCalculado, saldoRealCaja, cuadra };

  document.getElementById('fe-cuadre-aviso').innerHTML = cuadra
    ? `<div style="background:var(--success-soft);color:var(--success);padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600">✅ Cuadra con el efectivo real que debería haber: ${fmt(saldoRealCaja)}</div>`
    : `<div style="background:var(--danger-soft);color:var(--danger);padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600">⚠️ No coincide: calculado ${fmt(saldoFinalCalculado)} vs efectivo real ${fmt(saldoRealCaja)}</div>`;

  const filaGrupo = (titulo, lista, total) => `
    <tr style="font-weight:700;background:var(--bg-app)"><td colspan="2">${titulo}</td></tr>
    ${lista.map(f => `<tr><td style="padding-left:24px">${esc(f.label)}</td><td style="text-align:right">${fmt(f.monto)}</td></tr>`).join('') || '<tr><td style="padding-left:24px;color:var(--text-muted)" colspan="2">Sin movimiento en este período</td></tr>'}
    <tr style="font-weight:700;border-top:1px solid var(--border)"><td style="padding-left:24px">Flujo neto de ${titulo.toLowerCase()}</td><td style="text-align:right">${fmt(total)}</td></tr>`;

  cuerpo.innerHTML = `
    <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px">Período: ${fmtFecha(desde)} — ${fmtFecha(hasta)}</div>
    <table style="width:100%;font-size:13.5px;border-collapse:collapse">
      ${filaGrupo('Actividades de Operación', grupos.operacion, totalOperacion)}
      ${filaGrupo('Actividades de Financiamiento', grupos.financiamiento, totalFinanciamiento)}
      ${filaGrupo('Actividades de Inversión', grupos.inversion, totalInversion)}
      <tr style="font-weight:800;font-size:15px;background:var(--accent-soft);color:var(--accent)"><td>Flujo neto del período</td><td style="text-align:right">${fmt(flujoNeto)}</td></tr>
      <tr><td>Saldo inicial en efectivo</td><td style="text-align:right">${fmt(saldoInicial)}</td></tr>
      <tr style="font-weight:800;font-size:16px;background:var(--success-soft);color:var(--success)"><td>Saldo final en efectivo</td><td style="text-align:right">${fmt(saldoFinalCalculado)}</td></tr>
    </table>`;
}

function exportarFlujoEfectivo(formato) {
  const f = STATE.flujoEfectivoActual;
  if (!f) { showToast('Primero calcula el período', 'error'); return; }
  const bizName = STATE.empresaConfig?.nombre_comercial || 'Mi Negocio';
  const filas = [
    ['ACTIVIDADES DE OPERACIÓN','',''], ...f.grupos.operacion.map(x=>['', x.label, x.monto]), ['','Flujo neto de operación', f.totalOperacion],
    ['ACTIVIDADES DE FINANCIAMIENTO','',''], ...f.grupos.financiamiento.map(x=>['', x.label, x.monto]), ['','Flujo neto de financiamiento', f.totalFinanciamiento],
    ['ACTIVIDADES DE INVERSIÓN','',''], ...f.grupos.inversion.map(x=>['', x.label, x.monto]), ['','Flujo neto de inversión', f.totalInversion],
    ['','FLUJO NETO DEL PERÍODO', f.flujoNeto],
    ['','Saldo inicial en efectivo', f.saldoInicial],
    ['','SALDO FINAL EN EFECTIVO', f.saldoFinalCalculado],
  ];
  if (formato === 'excel') {
    // Mismo bug real corregido que en las 3 exportaciones anteriores:
    // el PDF ya convierte (usa fmt()), Excel usaba el numero crudo.
    const cv = v => convertirParaMostrar(Number(v)||0, STATE.empresaConfig?.moneda);
    const filasExcel = filas.map(fl => [fl[0], fl[1], typeof fl[2]==='number' ? cv(fl[2]) : fl[2]]);
    const aoa = [[bizName],['Estado de Flujo de Efectivo'],[`Período: ${fmtFecha(f.desde)} — ${fmtFecha(f.hasta)}`],[],['Código','Concepto','Monto'],...filasExcel];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [0,1,2].map(r => ({ s:{r,c:0}, e:{r,c:2} }));
    ws['!cols'] = [{wch:6},{wch:40},{wch:16}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Flujo de Efectivo');
    XLSX.writeFile(wb, 'Estado_de_Flujo_de_Efectivo.xlsx');
  } else {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    doc.setFontSize(14); doc.text(bizName, 14, 14);
    doc.setFontSize(10); doc.text('Estado de Flujo de Efectivo', 14, 20);
    doc.text(`Período: ${fmtFecha(f.desde)} — ${fmtFecha(f.hasta)}`, 14, 25);
    doc.autoTable({ startY:30, head:[['Concepto','Monto']], body: filas.map(fl=>[fl[1], typeof fl[2]==='number'?fmt(fl[2]):'']), theme:'grid', headStyles:{fillColor:[108,99,255]} });
    doc.save('Estado_de_Flujo_de_Efectivo.pdf');
  }
  showToast(`${formato.toUpperCase()} descargado`);
}

/* =====================================================
   INIT
===================================================== */
/* =====================================================
   CONTABILIZACIÓN AUTOMÁTICA — LEE de Ventas/Gastos/Compras/Salarios
   para crear asientos aquí en Contabilidad. NUNCA escribe ni modifica
   nada en esas tablas — todo lo que se toca en esta sección es
   estrictamente de solo lectura hacia el resto del sistema.
===================================================== */
const TIPOS_TRANSACCION = {
  venta: { label: 'Venta (en efectivo/tarjeta)', ejemplo: 'Debe: Caja — Haber: Ventas' },
  iva_ventas: { label: 'IVA que cobras a tus clientes', ejemplo: 'De la misma venta: Haber: Ventas (neto) — Haber: IVA por Pagar' },
  impuesto_ventas_otros: { label: 'Otros impuestos cobrados en ventas (solo Cuenta Haber)', ejemplo: 'De la misma venta: Haber: Impuestos por Pagar (2130). Si una venta lleva IR u otro impuesto y esto no está configurado, la venta espera sin asentarse.' },
  retencion_ir_clientes: { label: 'IR que te retienen tus clientes (solo Cuenta Debe)', ejemplo: 'De la venta con retención: Debe: Caja (neto de la retención) — Debe: Retenciones de IR a favor — Haber: Ventas (+ IVA). Si una venta lleva retención y esto no está configurado, la venta espera sin asentarse.' },
  pago_retenciones_ir: { label: 'Pago de retenciones de IR a la DGI', ejemplo: 'Cuando pagas lo retenido a proveedores desde Impuestos: Debe: Retenciones por Pagar (2130) — Haber: Caja. Si no lo configuras, ese pago espera sin asentarse.' },
  pago_impuestos: { label: 'Pago de impuestos a la DGI (IVA y otros)', ejemplo: 'Debe: IVA por Pagar (o Impuestos por Pagar) — Haber: Caja. Con IVA acreditable configurado, se liquida: Debe IVA por Pagar — Haber IVA Acreditable — Haber Caja (neto). Aquí pon por defecto Debe: Impuestos por Pagar (2130) y Haber: Caja.' },
  nomina_deducciones_ley: { label: 'INSS e IR retenidos a empleados (solo Cuenta Haber)', ejemplo: 'Del pago de salario: Debe: Sueldos (bruto) — Haber: Caja (neto) — Haber: Retenciones de nómina por pagar. Solo las deducciones automáticas de ley; adelantos y préstamos quedan como siempre.' },
  aporte_patronal: { label: 'Aportes patronales (INSS patronal, INATEC)', ejemplo: 'Debe: Gasto por aportes patronales — Haber: Aportes por pagar (INSS/INATEC). No mueve Caja: es lo que debes enterar a las instituciones.' },
  credito_otorgado: { label: 'Crédito otorgado (venta a crédito)', ejemplo: 'Debe: Cuentas por Cobrar — Haber: Ventas' },
  pago_credito: { label: 'Pago de crédito recibido', ejemplo: 'Debe: Caja — Haber: Cuentas por Cobrar' },
  descuento_credito: { label: 'Descuento o rebaja a un crédito de cliente', ejemplo: 'Debe: Descuentos sobre ventas (u Otros Gastos) — Haber: Cuentas por Cobrar. Es la rebaja que se registra en Créditos al renegociar un saldo menor con motivo; no mueve Caja.' },
  costo_ventas: { label: 'Costo de lo vendido (automático en cada venta)', ejemplo: 'Debe: Costo de Ventas — Haber: Inventario' },
  costo_servicios: { label: 'Costo de servicios contratados (transporte, fletes, mano de obra — solo Cuenta Debe)', ejemplo: 'Debe: Costo de Ventas (5100) — el Haber sale de la compra o cuenta por pagar. Si lo configuras, el costo estimado de los servicios en Ventas deja de asentarse (para no duplicar el costo).' },
  retencion_ir: { label: 'IR que tú retienes a proveedores (solo Cuenta Haber)', ejemplo: 'Del pago a proveedor: Debe: Cuentas por Pagar (bruto) — Haber: Caja (neto) — Haber: Retenciones por Pagar (2130)' },
  gasto: { label: 'Gasto', ejemplo: 'Debe: Gastos — Haber: Caja' },
  iva_gastos: { label: 'IVA que pagas en compras y gastos (solo Cuenta Debe)', ejemplo: 'Del mismo gasto: Debe: Gastos (neto) — Debe: IVA Acreditable' },
  compra: { label: 'Compra (pagada de una vez)', ejemplo: 'Debe: Inventario — Haber: Caja' },
  cxp_generada: { label: 'Cuenta por pagar (compra a crédito con proveedor)', ejemplo: 'Debe: Inventario — Haber: Cuentas por Pagar' },
  pago_cxp: { label: 'Pago a proveedor (de una cuenta por pagar)', ejemplo: 'Debe: Cuentas por Pagar — Haber: Caja' },
  pago_salario: { label: 'Pago de salario', ejemplo: 'Debe: Sueldos y Salarios — Haber: Caja' },
  capital_inicial: { label: 'Dinero inicial de caja / aportes de capital (apertura)', ejemplo: 'Debe: Caja General — Haber: Capital (Aporte de Socios)' },
  credito_existente: { label: 'Créditos de clientes que ya existían antes de usar el sistema (apertura)', ejemplo: 'Debe: Cuentas por Cobrar — Haber: Capital' },
  inventario_inicial: { label: 'Inventario que ya existía antes de usar el sistema (apertura)', ejemplo: 'Debe: Inventario — Haber: Capital' },
  ajuste_inventario_entrada: { label: 'Ajuste de existencia que SUBE (conteo, devolución, corrección…)', ejemplo: 'Debe: Inventario — Haber: Otros Ingresos (4200). Solo los cambios de existencia hechos desde la ficha del producto CON motivo; si el motivo es "Inventario inicial", va contra Capital usando la línea de arriba. Incluye bodegas y sucursales del grupo.' },
  ajuste_inventario_salida: { label: 'Ajuste de existencia que BAJA (conteo, daño, vencimiento, robo…)', ejemplo: 'Debe: Otros Gastos (6190) — Haber: Inventario. Solo los cambios de existencia hechos desde la ficha del producto CON motivo (las bajas de "Movimientos especiales" ya se registran como gasto de merma). Incluye bodegas y sucursales del grupo.' },
  faltante_caja: { label: 'Faltante de caja al cerrar Caja Chica', ejemplo: 'Debe: Otros Gastos (6190) — Haber: Caja General. Se asienta solo con la diferencia que quedó guardada en el cierre; no cambia el saldo del módulo Caja.' },
  sobrante_caja: { label: 'Sobrante de caja al cerrar Caja Chica', ejemplo: 'Debe: Caja General — Haber: Otros Ingresos (4200). Se asienta solo con la diferencia que quedó guardada en el cierre; no cambia el saldo del módulo Caja.' },
};
let STATE_MAPEO = [];

/* Qué TIPO de cuenta tiene sentido en cada lado de cada regla.
   Problema real (All Plastic): "Pago de crédito recibido" tenía en el Haber la
   cuenta Ventas, así que cada abono se contaba como una venta nueva (C$390K de
   ventas de más) y Cuentas por Cobrar nunca bajaba. Ahora una regla así no se
   puede guardar, y si ya existe se avisa al abrir la configuración. */
const REGLAS_TIPO_CUENTA = {
  venta:              { debe: ['activo'],                 haber: ['ingreso'],          porque: 'entra dinero (Activo) y se registra una venta (Ingreso)' },
  credito_otorgado:   { debe: ['activo'],                 haber: ['ingreso'],          porque: 'el cliente te queda debiendo (Cuentas por Cobrar, Activo) y se registra una venta (Ingreso)' },
  descuento_credito:  { debe: ['gasto', 'ingreso', 'costo'], haber: ['activo'],        porque: 'la rebaja es un gasto o un descuento sobre ventas, y BAJA lo que el cliente debe (Cuentas por Cobrar)' },
  pago_credito:       { debe: ['activo'],                 haber: ['activo'],           porque: 'entra dinero y BAJA lo que el cliente debe (Cuentas por Cobrar). Si el Haber fuera Ventas, cada abono se contaría como otra venta' },
  costo_ventas:       { debe: ['costo', 'gasto'],         haber: ['activo'],           porque: 'sale mercadería del Inventario (Activo) hacia Costo de Ventas' },
  gasto:              { debe: ['gasto', 'costo'],         haber: ['activo', 'pasivo'], porque: 'se registra un gasto y sale dinero (o queda por pagar)' },
  compra:             { debe: ['activo', 'costo', 'gasto'], haber: ['activo'],         porque: 'entra mercadería y sale dinero de Caja/Bancos (Activo)' },
  cxp_generada:       { debe: ['activo', 'costo', 'gasto'], haber: ['pasivo'],         porque: 'entra mercadería y queda una deuda con el proveedor (Pasivo)' },
  pago_cxp:           { debe: ['pasivo'],                 haber: ['activo'],           porque: 'baja la deuda con el proveedor (Pasivo) y sale dinero (Activo)' },
  pago_salario:       { debe: ['gasto', 'costo', 'pasivo'], haber: ['activo'],         porque: 'se registra el sueldo y sale dinero (Activo)' },
  capital_inicial:    { debe: ['activo'],                 haber: ['capital', 'pasivo'], porque: 'entra dinero y lo aporta el dueño (Capital)' },
  credito_existente:  { debe: ['activo'],                 haber: ['capital'],          porque: 'son deudas de clientes que ya existían: Cuentas por Cobrar contra Capital (no contra Inventario)' },
  inventario_inicial: { debe: ['activo'],                 haber: ['capital'],          porque: 'mercadería que ya existía: Inventario contra Capital' },
};
const NOMBRE_TIPO_CUENTA = { activo: 'Activo', pasivo: 'Pasivo', capital: 'Capital', ingreso: 'Ingresos', costo: 'Costos', gasto: 'Gastos' };

// Devuelve la lista de problemas (texto) de un juego de reglas { tipo: {debe, haber} }.
function validarReglasMapeo(reglas) {
  const cuenta = id => STATE.cuentas.find(c => c.id === id);
  const lista = arr => arr.map(t => NOMBRE_TIPO_CUENTA[t] || t).join(' o ');
  const errores = [];
  for (const [tipo, r] of Object.entries(reglas)) {
    if (!r || !r.debe || !r.haber) continue;
    const etiqueta = TIPOS_TRANSACCION[tipo]?.label || tipo;
    if (r.debe === r.haber) { errores.push(`"${etiqueta}": el Debe y el Haber no pueden ser la misma cuenta.`); continue; }
    const regla = REGLAS_TIPO_CUENTA[tipo];
    if (!regla) continue;
    const cd = cuenta(r.debe), ch = cuenta(r.haber);
    if (cd && cd.tipo && !regla.debe.includes(cd.tipo))
      errores.push(`"${etiqueta}": el Debe es "${cd.codigo} ${cd.nombre}" (${NOMBRE_TIPO_CUENTA[cd.tipo] || cd.tipo}), pero debe ser una cuenta de ${lista(regla.debe)}: ${regla.porque}.`);
    if (ch && ch.tipo && !regla.haber.includes(ch.tipo))
      errores.push(`"${etiqueta}": el Haber es "${ch.codigo} ${ch.nombre}" (${NOMBRE_TIPO_CUENTA[ch.tipo] || ch.tipo}), pero debe ser una cuenta de ${lista(regla.haber)}: ${regla.porque}.`);
  }
  // El abono de un crédito debe bajar la MISMA cuenta que subió al otorgarlo.
  const co = reglas.credito_otorgado, pc = reglas.pago_credito;
  if (co && pc && co.debe && pc.haber && co.debe !== pc.haber) {
    const a = cuenta(co.debe), b = cuenta(pc.haber);
    errores.push(`"Pago de crédito recibido": el Haber debe ser la misma cuenta que el Debe de "Crédito otorgado" (${a ? a.codigo + ' ' + a.nombre : 'Cuentas por Cobrar'}); ahora es "${b ? b.codigo + ' ' + b.nombre : '?'}".`);
  }
  const dc = reglas.descuento_credito;
  if (co && dc && co.debe && dc.haber && co.debe !== dc.haber) {
    const a = cuenta(co.debe), b = cuenta(dc.haber);
    errores.push(`"Descuento o rebaja a un crédito": el Haber debe ser la misma cuenta que el Debe de "Crédito otorgado" (${a ? a.codigo + ' ' + a.nombre : 'Cuentas por Cobrar'}); ahora es "${b ? b.codigo + ' ' + b.nombre : '?'}".`);
  }
  return errores;
}
function mostrarProblemasMapeo(errores, bloquea) {
  const errEl = document.getElementById('mapeo-error');
  if (!errEl) return;
  if (!errores.length) { errEl.textContent = ''; return; }
  errEl.innerHTML = `<div style="text-align:left;line-height:1.45"><b>${bloquea ? 'No se guardó. Corrige estas reglas:' : '⚠️ Revisa estas reglas (están contando mal en tus libros):'}</b><ul style="margin:6px 0 0 18px;padding:0">${errores.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

async function abrirMapeoCuentas() {
  if (!STATE.cuentas.length) await cargarCuentas();
  // BUG REAL CORREGIDO: si el usuario todavia no tiene ninguna cuenta
  // en su Catalogo de cuentas, los menus de "Cuenta Debe"/"Cuenta
  // Haber" quedaban vacios (solo "— Elegir —"), sin explicar por que
  // -- parecia que "no hay opciones ni para ventas ni para nada".
  // Ahora se detecta este caso y se guia directo a crear el catalogo
  // de cuentas primero, con un boton para cargar la plantilla estandar.
  const permiteMovimientos = STATE.cuentas.filter(c => c.permite_movimientos);
  if (!permiteMovimientos.length) {
    document.getElementById('mapeo-filas').innerHTML = `
      <div style="text-align:center;padding:24px 12px">
        <div style="font-size:28px;margin-bottom:8px">📋</div>
        <p style="font-size:13.5px;font-weight:600;margin-bottom:6px">Todavía no tienes ninguna cuenta contable</p>
        <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:16px">Para configurar la contabilización automática, primero necesitas tu Catálogo de cuentas — son las cuentas que se usarán en el Debe y el Haber de cada asiento.</p>
        <button class="btn-primary btn-sm" onclick="closeModal('modal-mapeo-cuentas'); cargarPlantillaCuentas();">Cargar plantilla estándar de cuentas</button>
      </div>`;
    document.getElementById('mapeo-error').textContent = '';
    openModal('modal-mapeo-cuentas');
    return;
  }
  try {
    const { data } = await sbClient.from('contabilidad_mapeo_cuentas').select('*').eq('auth_user_id', STATE.userId);
    STATE_MAPEO = data || [];
  } catch (e) { STATE_MAPEO = []; }
  renderMapeoFilas();
  document.getElementById('mapeo-error').textContent = '';
  // Si alguna regla guardada ya está mal, se avisa de una vez (sin bloquear nada).
  const actuales = {};
  STATE_MAPEO.forEach(m => { actuales[m.tipo_transaccion] = { debe: m.cuenta_debe_id, haber: m.cuenta_haber_id }; });
  mostrarProblemasMapeo(validarReglasMapeo(actuales), false);
  openModal('modal-mapeo-cuentas');
}
function renderMapeoFilas() {
  const opciones = STATE.cuentas.filter(c => c.permite_movimientos)
    .map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  // Los tipos de impuestos/nómina van plegados en "Avanzado": se configuran con el Asistente de impuestos.
  const TIPOS_IMPUESTOS = ['iva_ventas','impuesto_ventas_otros','retencion_ir_clientes','pago_retenciones_ir','pago_impuestos','nomina_deducciones_ley','aporte_patronal','retencion_ir','iva_gastos'];
  const filaMapeo = ([tipo, info]) => {
    return `
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px">${info.label}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Ejemplo típico: ${info.ejemplo}</div>
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group" style="margin-bottom:0"><label style="font-size:11px">Cuenta Debe</label>
          <select id="mapeo-debe-${tipo}"><option value="">— Elegir —</option>${opciones}</select>
        </div>
        <div class="form-group" style="margin-bottom:0"><label style="font-size:11px">Cuenta Haber</label>
          <select id="mapeo-haber-${tipo}"><option value="">— Elegir —</option>${opciones}</select>
        </div>
      </div>
    </div>`;
  };
  const todas = Object.entries(TIPOS_TRANSACCION);
  document.getElementById('mapeo-filas').innerHTML =
    todas.filter(([t]) => !TIPOS_IMPUESTOS.includes(t)).map(filaMapeo).join('') +
    `<details style="margin-top:6px"><summary style="cursor:pointer;font-weight:600;font-size:13px;margin-bottom:10px">Impuestos y nómina — avanzado</summary>
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 12px;border-radius:8px;background:var(--bg-hover,#f3f4f6);margin:8px 0 12px">
        <span style="font-size:12.5px">Lo más fácil es dejar que el asistente lo configure por ti.</span>
        <button class="btn-primary btn-sm" type="button" onclick="closeModal('modal-mapeo-cuentas'); abrirAsistenteImpuestos();">🧭 Abrir asistente de impuestos</button>
      </div>
      ${todas.filter(([t]) => TIPOS_IMPUESTOS.includes(t)).map(filaMapeo).join('')}</details>`;
  Object.keys(TIPOS_TRANSACCION).forEach(tipo => {
    const existente = STATE_MAPEO.find(m => m.tipo_transaccion === tipo);
    if (existente) {
      document.getElementById(`mapeo-debe-${tipo}`).value = existente.cuenta_debe_id || '';
      document.getElementById(`mapeo-haber-${tipo}`).value = existente.cuenta_haber_id || '';
    }
  });
}
async function guardarMapeoCuentas() {
  const errEl = document.getElementById('mapeo-error');
  errEl.textContent = '';
  // Primero se revisa que cada regla use el tipo de cuenta correcto; si no, no se guarda nada.
  const reglas = {};
  for (const tipo of Object.keys(TIPOS_TRANSACCION)) {
    const d = document.getElementById(`mapeo-debe-${tipo}`), h = document.getElementById(`mapeo-haber-${tipo}`);
    if (d && h) reglas[tipo] = { debe: d.value || null, haber: h.value || null };
  }
  const problemas = validarReglasMapeo(reglas);
  if (problemas.length) { mostrarProblemasMapeo(problemas, true); errEl.scrollIntoView?.({ block: 'nearest' }); return; }
  setBtnLoading('btn-guardar-mapeo', true);
  try {
    // BUG REAL CORREGIDO: si la base rechazaba una regla, el error se ignoraba y
    // aun así decía "Configuración guardada" (13 reglas nunca se guardaban).
    const noGuardadas = [];
    for (const tipo of Object.keys(TIPOS_TRANSACCION)) {
      const debe = document.getElementById(`mapeo-debe-${tipo}`).value || null;
      const haber = document.getElementById(`mapeo-haber-${tipo}`).value || null;
      if (!debe && !haber) continue; // no configurado, se deja como está
      const { error } = await sbClient.from('contabilidad_mapeo_cuentas').upsert({
        auth_user_id: STATE.userId, tipo_transaccion: tipo, cuenta_debe_id: debe, cuenta_haber_id: haber,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_user_id,tipo_transaccion' });
      if (error) noGuardadas.push(TIPOS_TRANSACCION[tipo]?.label || tipo);
    }
    if (noGuardadas.length) {
      errEl.innerHTML = `<div style="text-align:left;line-height:1.45"><b>Estas reglas NO se guardaron (las demás sí):</b><ul style="margin:6px 0 0 18px;padding:0">${noGuardadas.map(t => `<li>${esc(t)}</li>`).join('')}</ul>Avisa a soporte.</div>`;
      errEl.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    showToast('Configuración guardada');
    closeModal('modal-mapeo-cuentas');
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-mapeo', false);
  }
}

async function abrirGenerarAsientos() {
  // BUG REAL CORREGIDO: "desde" arrancaba en el primer día del MES
  // ACTUAL -- cualquier movimiento pendiente de antes de este mes
  // (confirmado con un caso real: una venta del 20 de julio, con
  // "hoy" ya en agosto) nunca se tocaba, aunque el banner los siga
  // contando como pendientes para siempre.
  //
  // Ahora se calcula la fecha REAL mas antigua pendiente (una sola
  // consulta liviana que trabaja directo en la base de datos, sin
  // traer ninguna fila al navegador -- nunca gasta de mas) y se usa
  // exactamente esa como punto de partida, ni un dia antes ni un dia
  // despues de lo que realmente hace falta.
  document.getElementById('ga-hasta').value = todayISO();
  document.getElementById('ga-resultado').innerHTML = 'Buscando la fecha pendiente más antigua…';
  document.getElementById('ga-error').textContent = '';
  openModal('modal-generar-asientos');

  let fechaDesde = todayISO();
  try {
    const { data, error } = await sbClient.rpc('fecha_mas_antigua_pendiente_contabilizar');
    if (error) throw error;
    if (data) fechaDesde = data;
  } catch (e) {
    console.warn('fecha_mas_antigua_pendiente_contabilizar:', e);
  }
  document.getElementById('ga-desde').value = fechaDesde;
  document.getElementById('ga-resultado').innerHTML = '';
}

/* =====================================================
   REINICIAR CONTABILIDAD — borra TODOS los asientos y empieza de
   cero. Nunca toca Ventas/Gastos/Compras/Salarios ni ningun otro
   dato real del negocio, ni el Catalogo de cuentas, ni la
   Contabilizacion automatica configurada -- solo asientos_contables
   y asientos_detalle, que se pueden volver a generar despues.
===================================================== */
async function abrirReiniciarContabilidad() {
  document.getElementById('rc-confirmacion').value = '';
  document.getElementById('rc-error').textContent = '';
  document.getElementById('btn-confirmar-reinicio').disabled = true;
  document.getElementById('rc-cantidad-asientos').textContent = 'Contando…';
  openModal('modal-reiniciar-contabilidad');

  try {
    const { count } = await sbClient.from('asientos_contables')
      .select('id', { count:'exact', head:true }).eq('auth_user_id', STATE.userId);
    document.getElementById('rc-cantidad-asientos').textContent = count ?? 0;
  } catch (e) {
    document.getElementById('rc-cantidad-asientos').textContent = 'varios';
  }
}

function onEscribirConfirmacionReinicio() {
  const valor = document.getElementById('rc-confirmacion')?.value.trim();
  document.getElementById('btn-confirmar-reinicio').disabled = (valor !== 'REINICIAR');
}

async function confirmarReiniciarContabilidad() {
  const errEl = document.getElementById('rc-error');
  errEl.textContent = '';
  const valor = document.getElementById('rc-confirmacion')?.value.trim();
  if (valor !== 'REINICIAR') { errEl.textContent = 'Escribe exactamente REINICIAR para confirmar.'; return; }

  setBtnLoading('btn-confirmar-reinicio', true);
  try {
    // 1) Traer los IDs de TODOS los asientos de esta cuenta (paginado
    //    de verdad, sin limite de 1000 -- puede haber miles).
    let idsAsientos = [];
    let desde = 0;
    const TAMANO_PAGINA = 1000;
    while (true) {
      const { data: pagina, error } = await sbClient.from('asientos_contables')
        .select('id').eq('auth_user_id', STATE.userId).range(desde, desde + TAMANO_PAGINA - 1);
      if (error) throw error;
      idsAsientos = idsAsientos.concat((pagina||[]).map(a => a.id));
      if (!pagina || pagina.length < TAMANO_PAGINA) break;
      desde += TAMANO_PAGINA;
    }

    // 2) Borrar el detalle primero (asientos_detalle depende de
    //    asientos_contables), despues las cabeceras -- en lotes, para
    //    no mandar una lista de miles de ids en una sola consulta.
    const LOTE = 200;
    for (let i = 0; i < idsAsientos.length; i += LOTE) {
      const lote = idsAsientos.slice(i, i + LOTE);
      const { error: errDet } = await sbClient.from('asientos_detalle').delete()
        .eq('auth_user_id', STATE.userId).in('asiento_id', lote);
      if (errDet) throw errDet;
    }
    for (let i = 0; i < idsAsientos.length; i += LOTE) {
      const lote = idsAsientos.slice(i, i + LOTE);
      const { error: errAs } = await sbClient.from('asientos_contables').delete()
        .eq('auth_user_id', STATE.userId).in('id', lote);
      if (errAs) throw errAs;
    }

    closeModal('modal-reiniciar-contabilidad');
    showToast(`Contabilidad reiniciada — ${idsAsientos.length} asiento(s) eliminado(s)`);
    await Promise.allSettled([cargarAsientos(), actualizarBannerAsientosPendientes()]);
  } catch (e) {
    console.error('confirmarReiniciarContabilidad:', e);
    errEl.textContent = 'Error al reiniciar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-confirmar-reinicio', false);
  }
}

/* =====================================================
   CONCILIAR INVENTARIO INICIAL — el inventario que el negocio ya tenia
   antes de usar el sistema nunca paso por una compra, asi que no tiene
   asiento. Aqui se calcula la diferencia entre el valor real de tus
   productos (existencias x costo, igual que Productos y Reportes) y el
   saldo contable de Inventario, y se registra UN asiento de apertura por
   esa diferencia. Solo LEE productos; no modifica nada en ningun modulo.
   Se hace una sola vez; exige tener todo lo demas ya generado.
===================================================== */
async function conciliarInventarioInicial() {
  if (STATE.conciliandoInventario) return;
  const errEl = document.getElementById('ga-error');
  const resEl = document.getElementById('ga-resultado');
  errEl.textContent = '';
  STATE.conciliandoInventario = true;
  try {
    const { data: mapeoData } = await sbClient.from('contabilidad_mapeo_cuentas').select('*').eq('auth_user_id', STATE.userId);
    const mapeo = new Map((mapeoData||[]).map(m => [m.tipo_transaccion, m]));
    const m = mapeo.get('inventario_inicial');
    if (!m || !m.cuenta_debe_id || !m.cuenta_haber_id) { errEl.textContent = 'Primero configura "Inventario que ya existía antes de usar el sistema" en la Contabilización automática (Debe: Inventario — Haber: Capital).'; return; }

    const { data: yaHay } = await sbClient.from('asientos_contables').select('id').eq('auth_user_id', STATE.userId)
      .eq('referencia_tipo', 'inventario_inicial').neq('estado', 'anulado').limit(1);
    if (yaHay && yaHay.length) { errEl.textContent = 'El asiento de inventario inicial ya fue generado antes (no se duplica). Si necesitas rehacerlo, anúlalo primero.'; return; }

    const { data: conteos } = await sbClient.rpc('contar_pendientes_contabilizar');
    const pendientes = (conteos||[]).reduce((t, c) => t + (mapeo.get(c.tipo) ? Number(c.cantidad)||0 : 0), 0);
    if (pendientes > 0) { errEl.textContent = `Primero presiona "Generar asientos": hay ${pendientes} movimiento(s) sin registrar y la diferencia saldría mal calculada.`; return; }

    resEl.innerHTML = 'Calculando…';
    let prods = [];
    { let i = 0; const TAM = 1000;
      while (true) {
        const { data: pg } = await sbClient.from('productos').select('stock_actual, costo, tipo').eq('auth_user_id', STATE.userId).range(i, i + TAM - 1);
        prods = prods.concat(pg || []);
        if (!pg || pg.length < TAM) break;
        i += TAM;
      }
    }
    let valorReal = round2(prods.filter(p => p.tipo === 'producto').reduce((t, p) => t + Number(p.stock_actual||0) * Number(p.costo||0), 0));
    // Contabilidad del grupo: si esta cuenta es la central, el inventario real incluye la
    // mercadería de sus bodegas y sucursales (en un solo libro, todo es inventario del negocio).
    let detalleGrupo = '';
    if (window.N360ContaGrupo) {
      const lugares = await N360ContaGrupo.inventarioPorLugar(sbClient, STATE.userId, STATE.empresaConfig?.nombre_comercial || 'Central');
      if (lugares.length > 1) {
        const otros = lugares.slice(1);
        valorReal = round2(valorReal + otros.reduce((t, l) => t + l.valor, 0));
        detalleGrupo = '\n\nIncluye la mercadería de todo el grupo:\n' + lugares.map(l => `• ${l.nombre}: ${fmt(l.valor)}`).join('\n');
      }
    }

    let saldoContable = 0;
    { let i = 0; const TAM = 1000;
      while (true) {
        const { data: pg } = await sbClient.from('asientos_detalle')
          .select('debe, haber, asientos_contables!inner(estado)').eq('auth_user_id', STATE.userId)
          .eq('cuenta_id', m.cuenta_debe_id).eq('asientos_contables.estado', 'registrado').range(i, i + TAM - 1);
        (pg||[]).forEach(d => { saldoContable += Number(d.debe||0) - Number(d.haber||0); });
        if (!pg || pg.length < TAM) break;
        i += TAM;
      }
    }
    saldoContable = round2(saldoContable);
    const diferencia = round2(valorReal - saldoContable);
    if (diferencia <= 0.01) {
      resEl.innerHTML = `✅ Nada que conciliar: el inventario real (${fmt(valorReal)}) ya no supera el saldo contable (${fmt(saldoContable)}).`;
      return;
    }
    if (!confirm(`Valor real del inventario: ${fmt(valorReal)}${detalleGrupo}\nSaldo contable de Inventario: ${fmt(saldoContable)}\n\nSe registrará UN asiento de apertura por ${fmt(diferencia)}\n(Debe: Inventario — Haber: cuenta de Capital elegida).\n¿Continuar?`)) { resEl.innerHTML = ''; return; }

    const { data: primero } = await sbClient.from('asientos_contables').select('fecha').eq('auth_user_id', STATE.userId).neq('estado', 'anulado').order('fecha', { ascending: true }).limit(1).maybeSingle();
    const fecha = primero?.fecha || todayISO();
    const numero = (await sbClient.rpc('generar_numero_asiento', { p_user_id: STATE.userId })).data;
    const { data: asiento, error: errA } = await sbClient.from('asientos_contables').insert({
      auth_user_id: STATE.userId, numero, fecha, concepto: 'Inventario inicial (existencias previas al sistema)',
      estado: 'borrador', origen: 'automatico', referencia_tipo: 'inventario_inicial', referencia_id: STATE.userId,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
    }).select().single();
    if (errA || !asiento) throw errA || new Error('No se pudo crear el asiento');
    const { error: errD } = await sbClient.from('asientos_detalle').insert([
      { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: m.cuenta_debe_id, debe: diferencia, haber: 0, orden: 0 },
      { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: haberId, debe: 0, haber: diferencia, orden: 1 },
    ]);
    if (errD) throw errD;
    const { error: errReg } = await sbClient.rpc('registrar_asiento_contable', { p_asiento_id: asiento.id });
    if (errReg) throw errReg;
    resEl.innerHTML = `✅ Asiento de inventario inicial registrado por ${fmt(diferencia)}.`;
    showToast('Inventario inicial conciliado');
    await cargarAsientos();
  } catch (e) {
    console.error('conciliarInventarioInicial:', e);
    errEl.textContent = 'Error: ' + (e.message || '');
  } finally {
    STATE.conciliandoInventario = false;
  }
}

/* Candado ENTRE ventanas/pestañas: el candado de STATE solo protege dentro de una misma pantalla.
   Como Contabilidad ahora también puede generar en segundo plano (otra pantalla oculta), este candado
   en localStorage evita que dos pantallas generen a la vez los mismos asientos (duplicados). */
const ID_VENTANA_CONTA = Math.random().toString(36).slice(2);
// Pantalla oculta (iframe) que abre modulos-guard.js en otros módulos para generar asientos sin que el usuario salga de lo que hace.
const EN_FONDO_CONTA = (() => { try { return new URLSearchParams(location.search).get('bg') === '1' && window.self !== window.top; } catch (_) { return false; } })();
const FECHA_INICIO_AUTO_CAJA = '2026-10-13'; // faltantes/sobrantes: lo automático solo toma cierres desde esta fecha; los anteriores, solo si se piden a mano
function claveCandadoConta() { return 'n360_conta_gen_lock_' + (STATE.userId || ''); }
function tomarCandadoConta() {
  try {
    const k = claveCandadoConta();
    const raw = localStorage.getItem(k);
    if (raw) {
      const [t, id] = raw.split('|');
      if (id !== ID_VENTANA_CONTA && Date.now() - Number(t) < 5 * 60 * 1000) return false;
    }
    localStorage.setItem(k, Date.now() + '|' + ID_VENTANA_CONTA);
    return (localStorage.getItem(k) || '').split('|')[1] === ID_VENTANA_CONTA;
  } catch (_) { return true; } // sin localStorage: se sigue con el candado normal de la pantalla
}
function soltarCandadoConta() {
  try { const k = claveCandadoConta(); if ((localStorage.getItem(k) || '').split('|')[1] === ID_VENTANA_CONTA) localStorage.removeItem(k); } catch (_) {}
}
async function generarAsientosAutomaticos() {
  if (!tomarCandadoConta()) {
    const e = document.getElementById('ga-error');
    if (e) e.textContent = 'Ya se están generando asientos en otra ventana. Espera un momento y vuelve a intentar.';
    return;
  }
  try { await generarAsientosAutomaticosInterno(); } finally { soltarCandadoConta(); }
  try { await anularAsientosDeOrigenAnulado(); } catch (e) { console.warn('anularAsientosDeOrigenAnulado:', e); }
  // Cuentas de dinero: si el negocio lo configuró, el dinero se vuelve a ubicar en Caja Chica y Bancos
  // (la base de datos lo hace en una sola transacción; si no está configurado, no hace nada).
  if (window.N360Dinero) {
    const u = await N360Dinero.ubicarTrasGenerar();
    const res = document.getElementById('ga-resultado');
    if (u && u.configurado && res && ((u.dias_crear || 0) + (u.dias_reemplazar || 0) + (u.dias_anular || 0)) > 0) {
      res.insertAdjacentHTML('beforeend', `<div style="font-size:12.5px;margin-top:6px">💰 Dinero ubicado en Caja Chica y Bancos: ${(u.dias_crear || 0) + (u.dias_reemplazar || 0)} día(s) actualizados.</div>`);
    }
  }
}

/* Si una venta, gasto o compra se anula DESPUÉS de esta fecha, su asiento automático también se anula
   (antes quedaba vigente y seguía sumando ingresos/gastos que ya no existen).
   Solo toca anulaciones nuevas: lo anulado antes no se modifica (se revisa aparte con el cliente).
   Nunca borra: el asiento queda en estado "anulado" con su motivo, igual que al anularlo a mano. */
const FECHA_INICIO_ANULA_ASIENTOS = '2026-10-14T00:00:00Z';
async function anularAsientosDeOrigenAnulado() {
  const fuentes = [
    { tabla: 'ventas',  filtro: q => q.eq('estado', 'anulada').gte('updated_at', FECHA_INICIO_ANULA_ASIENTOS),   tipos: ['venta', 'credito_otorgado'], motivo: 'Venta anulada' },
    { tabla: 'gastos',  filtro: q => q.eq('estado', 'cancelado').gte('cancelado_en', FECHA_INICIO_ANULA_ASIENTOS), tipos: ['gasto'],                     motivo: 'Gasto cancelado' },
    { tabla: 'compras', filtro: q => q.eq('estado', 'anulada').gte('anulada_en', FECHA_INICIO_ANULA_ASIENTOS),     tipos: ['compra'],                    motivo: 'Compra anulada' },
    { tabla: 'cuentas_por_pagar', filtro: q => q.eq('estado', 'anulado'),                                            tipos: ['cxp_generada'],              motivo: 'Cuenta por pagar anulada (su compra se anuló)' },
  ];
  let total = 0;
  // Contabilidad del grupo: los documentos de bodegas/sucursales también tienen su asiento en
  // ESTOS libros; si se anulan allá, su asiento aquí se anula igual. Solo se LEE al miembro.
  const lugares = [{ uid: STATE.userId, lector: sbClient }];
  if (window.N360ContaGrupo) {
    (await N360ContaGrupo.miembros(sbClient)).forEach(mg => lugares.push({ uid: mg.auth_user_id, lector: N360ContaGrupo.lector(sbClient, mg.auth_user_id) }));
  }
  for (const L of lugares)
  for (const f of fuentes) {
    const { data: docs, error } = await f.filtro(L.lector.from(f.tabla).select('id').eq('auth_user_id', L.uid)).limit(500);
    if (error || !docs || !docs.length) continue;
    const ids = docs.map(d => d.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { data: hechos } = await sbClient.from('asientos_contables')
        .update({ estado: 'anulado', anulado_en: new Date().toISOString(), anulado_motivo: f.motivo + ' (anulado automáticamente)' })
        .eq('auth_user_id', STATE.userId).eq('origen', 'automatico').eq('estado', 'registrado')
        .in('referencia_tipo', f.tipos).in('referencia_id', ids.slice(i, i + 100)).select('id');
      total += (hechos || []).length;
    }
  }
  return total;
}
async function generarAsientosAutomaticosInterno() {
  // BUG REAL CORREGIDO: el mismo movimiento se convertia en asiento
  // hasta 14 veces -- el chequeo de "ya se genero antes" vivia solo
  // en un Set armado UNA vez al entrar aqui; si el proceso tardaba
  // (miles de movimientos) y el usuario presionaba el boton de nuevo
  // por impaciencia, cada click arrancaba su PROPIA ejecucion
  // independiente, viendo el mismo estado "antes de empezar" que la
  // anterior -- generando el mismo asiento varias veces en paralelo.
  // Este candado bloquea CUALQUIER ejecucion nueva mientras ya hay
  // una corriendo, sin importar cuantas veces se presione el boton.
  if (STATE.generandoAsientosAutomaticos) return;
  STATE.generandoAsientosAutomaticos = true;

  const errEl = document.getElementById('ga-error');
  errEl.textContent = '';
  const desde = document.getElementById('ga-desde').value;
  const hasta = document.getElementById('ga-hasta').value;
  if (!desde || !hasta) { errEl.textContent = 'Elige el rango de fechas.'; STATE.generandoAsientosAutomaticos = false; return; }

  const { data: mapeoData } = await sbClient.from('contabilidad_mapeo_cuentas').select('*').eq('auth_user_id', STATE.userId);
  const mapeo = new Map((mapeoData||[]).map(m => [m.tipo_transaccion, m]));
  if (!mapeo.size) { errEl.textContent = 'Primero configura la Contabilización automática (botón junto a Catálogo de cuentas).'; STATE.generandoAsientosAutomaticos = false; return; }

  setBtnLoading('btn-generar-asientos', true);
  document.getElementById('ga-resultado').innerHTML = 'Leyendo tus Ventas, Gastos, Compras y Salarios…';
  // Empresa vinculada: si a este libro le falta el asiento de algún traslado
  // entre negocios (por ejemplo, después de "Reiniciar contabilidad"), se
  // vuelve a crear. Para cuentas sin empresa la función no hace nada.
  try { await sbClient.rpc('empresa_traslados_asentar_pendientes'); } catch (_) {}
  try {
    // BUG REAL CORREGIDO: esta consulta traia como maximo 1000 filas
    // (limite por defecto de Supabase) -- con miles de asientos ya
    // generados, el Set de "ya hechos" quedaba incompleto, arriesgando
    // volver a crear duplicados de cosas que YA existian pero quedaron
    // fuera de esas primeras 1000 filas. Ahora se pagina de verdad.
    let yaGenerados = [];
    { let desdeIdx = 0; const TAM = 1000;
      while (true) {
        const { data: pagina } = await sbClient.from('asientos_contables')
          .select('referencia_tipo, referencia_id').eq('auth_user_id', STATE.userId).eq('origen', 'automatico')
          .range(desdeIdx, desdeIdx + TAM - 1);
        yaGenerados = yaGenerados.concat(pagina || []);
        if (!pagina || pagina.length < TAM) break;
        desdeIdx += TAM;
      }
    }
    const yaHechos = new Set(yaGenerados.map(a => `${a.referencia_tipo}:${a.referencia_id}`));

    let creados = 0, saltados = 0, sinConfigurar = 0;

    // CONTABILIDAD DEL GRUPO ("un solo libro en la central"): primero se
    // procesa la propia cuenta, EXACTAMENTE igual que siempre; después, si
    // esta cuenta es la central de un grupo, cada bodega/sucursal. Sus
    // asientos se escriben en ESTOS libros (los de la central), con el
    // nombre del lugar al inicio del concepto. Solo cambian las LECTURAS:
    // cada fuente lee sus propios documentos; las escrituras son las de siempre.
    // Los traslados entre lugares del grupo no generan asiento: en un solo
    // libro, la mercadería solo cambia de lugar.
    const fuentesConta = [{ uid: STATE.userId, lector: sbClient, etiqueta: '', todoElHistorial: false }];
    if (window.N360ContaGrupo) {
      const miembrosGrupo = await N360ContaGrupo.miembros(sbClient);
      miembrosGrupo.forEach(mg => fuentesConta.push({
        uid: mg.auth_user_id, lector: N360ContaGrupo.lector(sbClient, mg.auth_user_id),
        etiqueta: `[${mg.nombre}] `,
        // Los documentos de bodegas/sucursales se revisan completos (sin el rango de fechas):
        // la "fecha pendiente más antigua" que sugiere el sistema solo conoce los de la central.
        // Lo ya registrado se salta igual (no se duplica).
        todoElHistorial: true,
      }));
    }
    for (const F of fuentesConta) {
    if (F !== fuentesConta[0]) document.getElementById('ga-resultado').innerHTML = `Leyendo ${esc(F.etiqueta.replace(/[\[\]]/g, '').trim())}…`;

    async function procesarTipo(tipo, tabla, campoMonto, filtroEstado, campoEstado, conceptoPrefijo, filtroExtra, obtenerLineasExtra, campoFecha, obtenerDivisionIva, opts) {
      const m = mapeo.get(opts?.mapeoDe || tipo);
      // "Sin configurar" es un aviso de configuración: se cuenta una sola vez (en la central),
      // no una vez por cada bodega/sucursal del grupo.
      if (!m || !m.cuenta_debe_id || !m.cuenta_haber_id) { if (F === fuentesConta[0]) sinConfigurar++; return; }
      campoFecha = campoFecha || 'fecha';

      // SOLO LECTURA — nunca se hace ningún update/insert/delete sobre
      // esta tabla, solo se consulta. Paginado de verdad (mismo motivo
      // que arriba): un tipo con muchos movimientos en el rango elegido
      // no debe quedar cortado en las primeras 1000 filas.
      let filas = [];
      { let desdeIdx = 0; const TAM = 1000;
        while (true) {
          let query = F.lector.from(tabla).select('*').eq('auth_user_id', F.uid);
          if (campoEstado) query = query.eq(campoEstado, filtroEstado); // algunas tablas (ej. pagos ya hechos) no tienen "estado" — todas sus filas ya son reales
          // Los saldos de apertura (opts.sinRango) son pocos y se revisan siempre completos:
          // la fecha 'pendiente mas antigua' que sugiere el modal no los conoce.
          if (!opts?.sinRango && !F.todoElHistorial) query = query.gte(campoFecha, desde).lte(campoFecha, `${hasta} 23:59:59`);
          if (filtroExtra) query = filtroExtra(query);
          const { data: pagina } = await query.range(desdeIdx, desdeIdx + TAM - 1);
          filas = filas.concat(pagina || []);
          if (!pagina || pagina.length < TAM) break;
          desdeIdx += TAM;
        }
      }

      for (const fila of (filas||[])) {
        const clave = `${tipo}:${fila.id}`;
        if (yaHechos.has(clave)) { saltados++; continue; }
        if (opts?.omitirFila && opts.omitirFila(fila)) continue;
        const monto = opts?.obtenerMonto ? round2(Number(await opts.obtenerMonto(fila) || 0)) : round2(Number(fila[campoMonto] || 0));
        if (monto <= 0) continue;
        // Algunos gastos no sacan dinero de Caja (ej. merma de inventario): opts.cuentaHaber
        // puede indicar otra cuenta de Haber para ese caso; si no, se usa la del mapeo.
        const haberId = (opts?.cuentaHaber && opts.cuentaHaber(fila)) || m.cuenta_haber_id;

        // Cuenta de Debe distinta para esta fila (ej. servicios contratados): false = falta configurarla,
        // se omite para NO asentarla mal (no se pierde: se genera cuando se configure).
        const debeOv = opts?.cuentaDebe ? opts.cuentaDebe(fila) : undefined;
        if (debeOv === false) { sinConfigurar++; continue; }
        const debeId = debeOv || m.cuenta_debe_id;
        // Parte a separar del monto (IVA o retención). { bloquear:true } = hace falta configurar su cuenta.
        const divisionIva = obtenerDivisionIva ? await obtenerDivisionIva(fila) : null;
        if (divisionIva && divisionIva.bloquear) { sinConfigurar++; continue; }

        // Costo de lo vendido (si está configurado) — se agrega como
        // 2 líneas MÁS dentro del MISMO asiento, no como uno aparte.
        // Sigue cuadrando porque Debe y Haber de esas 2 líneas son
        // igual monto entre sí, sin importar cuánto sea.
        const lineasExtra = obtenerLineasExtra ? await obtenerLineasExtra(fila) : [];

        const numero = (await sbClient.rpc('generar_numero_asiento', { p_user_id: STATE.userId })).data;
        const fechaAsiento = String(fila[campoFecha]).slice(0, 10); // por si es timestamp completo (ej. created_at)
        const { data: asiento, error: errA } = await sbClient.from('asientos_contables').insert({
          auth_user_id: STATE.userId, numero, fecha: fechaAsiento,
          concepto: `${F.etiqueta}${conceptoPrefijo}${(opts?.concepto && opts.concepto(fila)) || fila.concepto || fila.numero_venta || fila.numero || fila.numero_credito || ''}`.trim(),
          estado: 'borrador', origen: 'automatico', referencia_tipo: tipo, referencia_id: fila.id,
          usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
        }).select().single();
        if (errA || !asiento) continue;

        // Si hay un monto de IVA a separar de esta transaccion (venta
        // o gasto con IVA, y el mapeo de esa cuenta ya esta
        // configurado), la linea principal de Haber (o Debe, para
        // gastos) se DIVIDE en 2 -- el monto neto a la cuenta de
        // siempre, y el IVA a su propia cuenta. Si no aplica (nadie
        // configuro el mapeo de IVA, o esta transaccion no tiene IVA),
        // el asiento queda IGUAL que siempre: una sola linea por lado.
        let lineas;
        // Partes a separar: IVA y/o otros impuestos (IR, etc.), cada una a su cuenta.
        const partes = [];
        if (divisionIva && divisionIva.montoIva > 0) partes.push({ monto: divisionIva.montoIva, cuenta: divisionIva.cuentaIvaId, desc: 'IVA' });
        if (divisionIva && Array.isArray(divisionIva.extras)) divisionIva.extras.forEach(x => { if (x.monto > 0) partes.push({ monto: x.monto, cuenta: x.cuentaId, desc: x.desc || 'Impuesto' }); });
        const sumaPartes = round2(partes.reduce((a, x) => a + x.monto, 0));
        if (partes.length && sumaPartes < monto) {
          const montoNeto = round2(monto - sumaPartes);
          if (divisionIva.lado === 'haber') {
            lineas = [
              { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: debeId, debe: monto, haber: 0, orden: 0 },
              { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: haberId, debe: 0, haber: montoNeto, orden: 1 },
              ...partes.map((x, i) => ({ auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: x.cuenta, debe: 0, haber: x.monto, orden: 2 + i, descripcion: x.desc })),
            ];
          } else {
            lineas = [
              { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: debeId, debe: montoNeto, haber: 0, orden: 0 },
              ...partes.map((x, i) => ({ auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: x.cuenta, debe: x.monto, haber: 0, orden: 1 + i, descripcion: x.desc })),
              { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: haberId, debe: 0, haber: monto, orden: 9 },
            ];
          }
        } else {
          lineas = [
            { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: debeId, debe: monto, haber: 0, orden: 0 },
            { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: haberId, debe: 0, haber: monto, orden: 1 },
          ];
        }
        // Partes que REDUCEN la línea principal (retenciones): a favor en Debe (ventas) o por pagar en Haber (compras/pagos).
        const debeEx = ((divisionIva && divisionIva.debeExtras) || []).filter(x => x.monto > 0);
        const haberEx = ((divisionIva && divisionIva.haberExtras) || []).filter(x => x.monto > 0);
        if (debeEx.length) {
          const sumD = round2(debeEx.reduce((a, x) => a + x.monto, 0));
          const principal = lineas.find(l => l.cuenta_id === debeId && l.debe > 0 && l.orden === 0);
          if (principal && principal.debe - sumD > 0.004) {
            principal.debe = round2(principal.debe - sumD);
            debeEx.forEach((x, i) => lineas.push({ auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: x.cuentaId, debe: x.monto, haber: 0, orden: 4 + i, descripcion: x.desc || 'Retención' }));
          }
        }
        if (haberEx.length) {
          const sumH = round2(haberEx.reduce((a, x) => a + x.monto, 0));
          const principalH = lineas.find(l => l.cuenta_id === haberId && l.haber > 0 && (l.orden === 1 || l.orden === 9) && l.debe === 0);
          if (principalH && principalH.haber - sumH > 0.004) {
            principalH.haber = round2(principalH.haber - sumH);
            haberEx.forEach((x, i) => lineas.push({ auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: x.cuentaId, debe: 0, haber: x.monto, orden: 6 + i, descripcion: x.desc || 'Retención' }));
          }
        }
        lineas = [
          ...lineas,
          ...lineasExtra.map((l, i) => ({ auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: l.cuenta_id, debe: l.debe||0, haber: l.haber||0, orden: 10+i, descripcion: l.descripcion||null })),
        ];
        await sbClient.from('asientos_detalle').insert(lineas);

        // Debe y Haber son el MISMO monto por construcción, así que
        // siempre cuadra — pero igual pasa por la misma validación de
        // la base de datos que cualquier asiento manual, sin excepción.
        const { error: errReg } = await sbClient.rpc('registrar_asiento_contable', { p_asiento_id: asiento.id });
        if (!errReg) creados++;
      }
    }

    // Costo de lo vendido: se busca en venta_detalles (costo real
    // guardado por producto al momento de vender) para CADA venta —
    // sin esto, "Costo de Ventas" siempre daba 0 y la utilidad se
    // veía inflada, como si vender no costara nada.
    const mapeoCosto = mapeo.get('costo_ventas');
    const mapeoCostoServ = mapeo.get('costo_servicios');
    const cuentaDebeServicio = f => (f.clase_costo === 'servicio') ? (mapeoCostoServ?.cuenta_debe_id || false) : undefined;
    async function obtenerCostoVentaVendido(venta) {
      if (!mapeoCosto || !mapeoCosto.cuenta_debe_id || !mapeoCosto.cuenta_haber_id) return [];
      const { data: detalles } = await F.lector.from('venta_detalles').select('cantidad, costo, tipo_item').eq('venta_id', venta.id).eq('auth_user_id', F.uid);
      // Si el negocio configuró "Costo de servicios", el costo de los servicios sale de sus compras/cuentas por pagar
      // reales: el costo estimado de la venta ya no se asienta (así no se duplica ni toca Inventario).
      const servicioPorSuCuenta = !!(mapeoCostoServ && mapeoCostoServ.cuenta_debe_id);
      const costoTotal = round2((detalles||[]).filter(d => !(servicioPorSuCuenta && d.tipo_item === 'servicio')).reduce((s,d) => s + (Number(d.cantidad||0) * Number(d.costo||0)), 0));
      if (costoTotal <= 0) return [];
      return [
        { cuenta_id: mapeoCosto.cuenta_debe_id, debe: costoTotal, haber: 0, descripcion: 'Costo de lo vendido' },
        { cuenta_id: mapeoCosto.cuenta_haber_id, debe: 0, haber: costoTotal, descripcion: 'Salida de inventario' },
      ];
    }

    // "Venta" normal EXCLUYE las de crédito — esas van aparte como
    // "Crédito otorgado", porque en una venta a crédito NO entra
    // dinero a la Caja en ese momento; contarla igual que una venta en
    // efectivo habría duplicado el dinero (0% margen de error).
    // IVA cobrado en la venta (opcional): si el mapeo iva_ventas esta
    // configurado, se separa de la cuenta de Ventas hacia su propia
    // cuenta de "IVA por Pagar" -- si nadie lo configuro, esta funcion
    // no hace nada y el asiento sigue igual que siempre.
    const mapeoIvaVentas = mapeo.get('iva_ventas');
    const mapeoOtrosVentas = mapeo.get('impuesto_ventas_otros');
    // Otros impuestos de cada venta (IR, etc.) guardados en venta_impuestos.
    const extrasPorVenta = new Map();
    try {
      const { data: vi } = await F.lector.from('venta_impuestos').select('venta_id, nombre, monto').eq('auth_user_id', F.uid);
      (vi || []).forEach(x => { const a = extrasPorVenta.get(x.venta_id) || []; a.push({ nombre: x.nombre, monto: round2(Number(x.monto || 0)) }); extrasPorVenta.set(x.venta_id, a); });
    } catch (e) { /* tabla ausente: sin extras */ }
    const mapeoRetClientes = mapeo.get('retencion_ir_clientes');
    async function obtenerDivisionIvaVenta(venta) {
      const base = await obtenerDivisionIvaVentaBase(venta);
      const retV = round2(Number(venta.retencion_ir_monto || 0));
      if (retV <= 0) return base;
      if (base && base.bloquear) return base;
      if (!mapeoRetClientes || !mapeoRetClientes.cuenta_debe_id) return { bloquear: true };
      const ex = { debeExtras: [{ monto: retV, cuentaId: mapeoRetClientes.cuenta_debe_id, desc: 'Retención de IR a favor' }] };
      return base ? { ...base, ...ex } : { montoIva: 0, cuentaIvaId: null, lado: 'haber', ...ex };
    }
    async function obtenerDivisionIvaVentaBase(venta) {
      const extrasV = (extrasPorVenta.get(venta.id) || []).filter(x => x.monto > 0);
      const sumaExtras = round2(extrasV.reduce((a, x) => a + x.monto, 0));
      // ventas.impuesto = IVA + otros impuestos; el IVA puro es la diferencia.
      const ivaPuro = Math.max(0, round2(Number(venta.impuesto || 0) - sumaExtras));
      if (sumaExtras > 0 && !(mapeoOtrosVentas && mapeoOtrosVentas.cuenta_haber_id)) return { bloquear: true };
      const ivaOk = mapeoIvaVentas && mapeoIvaVentas.cuenta_haber_id && ivaPuro > 0;
      if (!ivaOk && sumaExtras <= 0) return null;
      return {
        montoIva: ivaOk ? ivaPuro : 0,
        cuentaIvaId: ivaOk ? mapeoIvaVentas.cuenta_haber_id : null,
        lado: 'haber',
        extras: extrasV.map(x => ({ monto: x.monto, cuentaId: mapeoOtrosVentas.cuenta_haber_id, desc: x.nombre })),
      };
    }

    await procesarTipo('venta', 'ventas', 'total', 'completada', 'estado', 'Venta ', q => q.neq('metodo_pago', 'credito').neq('metodo_pago', 'fiado'), obtenerCostoVentaVendido, undefined, obtenerDivisionIvaVenta);
    await procesarTipo('credito_otorgado', 'ventas', 'total', 'completada', 'estado', 'Crédito otorgado — venta ', q => q.in('metodo_pago', ['credito', 'fiado']), obtenerCostoVentaVendido, undefined, obtenerDivisionIvaVenta);
    await procesarTipo('pago_credito', 'creditos_pagos', 'monto', 'completado', 'estado', 'Pago de crédito recibido');
    // Cobros de Fiados: mismo asiento que un pago de crédito (Debe Caja / Haber Cuentas por Cobrar), usando esa misma configuración.
    await procesarTipo('pago_fiado', 'fiado_pagos', 'monto', null, null, 'Cobro de fiado', null, null, 'created_at', null, { mapeoDe: 'pago_credito' });
    // Descuentos/rebajas a créditos de clientes (Créditos › Renegociar a un saldo menor con motivo).
    // Quedan en el historial del crédito; aquí se asientan: Debe Descuentos/Gastos — Haber Cuentas por Cobrar.
    // Si hay descuentos y la regla no está configurada, se avisa como cualquier otro tipo sin configurar.
    {
      const filtroDesc = q => q.eq('tipo_evento', 'editado').not('data->>descuento', 'is', null);
      let hayDescuentos = !!mapeo.get('descuento_credito');
      if (!hayDescuentos) {
        const { count } = await F.lector.from('creditos_historial').select('id', { count: 'exact', head: true })
          .eq('auth_user_id', F.uid).eq('tipo_evento', 'editado').not('data->>descuento', 'is', null);
        hayDescuentos = (count || 0) > 0;
      }
      if (hayDescuentos) {
        await procesarTipo('descuento_credito', 'creditos_historial', 'data', null, null, 'Descuento concedido — ',
          filtroDesc, null, 'created_at', null,
          { obtenerMonto: async f => Number(f.data?.descuento || 0),
            concepto: f => `${f.data?.numeroCredito || 'crédito'}${f.data?.motivoDescuento ? ' (' + String(f.data.motivoDescuento).slice(0, 80) + ')' : ''}` });
      }
    }

    // DEVOLUCIONES DE VENTA (DEV-…): el asiento contrario a la venta, solo por lo devuelto.
    //   Debe Ventas (y IVA por pagar, si está configurado) = valor devuelto
    //   Haber Caja = dinero devuelto al cliente · Haber Cuentas por Cobrar = lo rebajado de su deuda
    //   Debe Inventario / Haber Costo de ventas = costo de lo que volvió en buen estado (lo dañado queda como costo)
    // Usa las mismas cuentas que ya están configuradas para Venta, Crédito otorgado, Costo de ventas e IVA.
    {
      const mV = mapeo.get('venta'), mCr = mapeo.get('credito_otorgado'), mCo = mapeo.get('costo_ventas'), mIv = mapeo.get('iva_ventas');
      const ctaVentas = mV?.cuenta_haber_id || mCr?.cuenta_haber_id || null;
      const ctaCaja = mV?.cuenta_debe_id || null, ctaCxC = mCr?.cuenta_debe_id || null;
      let devs = [];
      try {
        let desdeIdx = 0; const TAM = 1000;
        while (true) {
          let q = F.lector.from('devoluciones_venta').select('*').eq('auth_user_id', F.uid);
          if (!F.todoElHistorial) q = q.gte('fecha', desde).lte('fecha', hasta);
          const { data: pagina, error: eDev } = await q.order('fecha').range(desdeIdx, desdeIdx + TAM - 1);
          if (eDev) break;   // tabla aún no disponible: no hay devoluciones que asentar
          devs = devs.concat(pagina || []);
          if (!pagina || pagina.length < TAM) break;
          desdeIdx += TAM;
        }
      } catch (_) { devs = []; }
      const numVenta = new Map();
      const idsV = [...new Set(devs.map(d => d.venta_id))];
      for (let i = 0; i < idsV.length; i += 200) {
        const { data: vs } = await F.lector.from('ventas').select('id, numero_venta').in('id', idsV.slice(i, i + 200));
        (vs || []).forEach(v => numVenta.set(v.id, v.numero_venta));
      }
      for (const dev of devs) {
        if (yaHechos.has(`devolucion_venta:${dev.id}`)) { saltados++; continue; }
        const total = round2(Number(dev.total || 0));
        const dinero = round2(Number(dev.monto_dinero || 0)), deuda = round2(Number(dev.monto_credito || 0));
        if (total <= 0 && !(Number(dev.costo_reingresado) > 0)) continue;
        if (!ctaVentas || (dinero > 0 && !ctaCaja) || (deuda > 0 && !ctaCxC)) { if (F === fuentesConta[0]) sinConfigurar++; continue; }
        const iva = (mIv && mIv.cuenta_haber_id) ? Math.min(round2(Number(dev.impuesto || 0)), total) : 0;
        const costoRe = (mCo && mCo.cuenta_debe_id && mCo.cuenta_haber_id) ? round2(Number(dev.costo_reingresado || 0)) : 0;
        const numero = (await sbClient.rpc('generar_numero_asiento', { p_user_id: STATE.userId })).data;
        const { data: asiento, error: errA } = await sbClient.from('asientos_contables').insert({
          auth_user_id: STATE.userId, numero, fecha: String(dev.fecha).slice(0, 10),
          concepto: `${F.etiqueta}Devolución ${dev.numero} de venta ${numVenta.get(dev.venta_id) || ''}`.trim(),
          estado: 'borrador', origen: 'automatico', referencia_tipo: 'devolucion_venta', referencia_id: dev.id,
          usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
        }).select().single();
        if (errA || !asiento) continue;
        const L = (cuenta_id, debe, haber, orden, descripcion) => ({ auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id, debe: round2(debe), haber: round2(haber), orden, descripcion });
        const lineas = [];
        if (round2(total - iva) > 0) lineas.push(L(ctaVentas, total - iva, 0, 0, 'Devolución de venta'));
        if (iva > 0) lineas.push(L(mIv.cuenta_haber_id, iva, 0, 1, 'IVA de lo devuelto'));
        if (dinero > 0) lineas.push(L(ctaCaja, 0, dinero, 2, 'Dinero devuelto al cliente'));
        if (deuda > 0) lineas.push(L(ctaCxC, 0, deuda, 3, 'Rebajado de lo que debía el cliente'));
        if (costoRe > 0) {
          lineas.push(L(mCo.cuenta_haber_id, costoRe, 0, 10, 'Mercadería devuelta al inventario'));
          lineas.push(L(mCo.cuenta_debe_id, 0, costoRe, 11, 'Costo de lo vendido (devolución)'));
        }
        await sbClient.from('asientos_detalle').insert(lineas);
        const { error: errReg } = await sbClient.rpc('registrar_asiento_contable', { p_asiento_id: asiento.id });
        if (!errReg) creados++;
      }
    }
    // IVA pagado en el gasto (opcional): si el mapeo iva_gastos esta
    // configurado, se separa de la cuenta de Gastos hacia su propia
    // cuenta de "IVA Acreditable" -- si nadie lo configuro, el
    // asiento sigue igual que siempre.
    const mapeoIvaGastos = mapeo.get('iva_gastos');
    async function obtenerDivisionIvaGasto(gasto) {
      let base = null;
      if (mapeoIvaGastos && mapeoIvaGastos.cuenta_debe_id) {
        const iva = round2(Number(gasto.impuesto || 0));
        if (iva > 0) base = { montoIva: iva, cuentaIvaId: mapeoIvaGastos.cuenta_debe_id, lado: 'debe' };
      }
      // Gasto con retención de IR practicada: Caja sale neto y la retención queda por pagar.
      const ret = round2(Number(gasto.retencion_ir_monto || 0));
      if (ret <= 0) return base;
      const mRet = mapeo.get('retencion_ir');
      if (!mRet || !mRet.cuenta_haber_id) return { bloquear: true };
      const ex = { haberExtras: [{ monto: ret, cuentaId: mRet.cuenta_haber_id, desc: 'Retención de IR por pagar' }] };
      return base ? { ...base, ...ex } : { montoIva: 0, cuentaIvaId: null, lado: 'debe', ...ex };
    }

    // Merma de inventario: se registra como gasto pero NO sale dinero de Caja; lo que baja es el
    // Inventario (misma cuenta de Haber que usa 'costo_ventas'). Sin esto, Caja quedaba de menos
    // y Inventario de mas por el monto de la merma.
    const cuentaHaberGasto = g => (/^merma de inventario/i.test(String(g.concepto||'')) && !g.metodo_pago_nombre && mapeoCosto?.cuenta_haber_id) ? mapeoCosto.cuenta_haber_id : null;
    await procesarTipo('gasto', 'gastos', 'monto', 'activo', 'estado', 'Gasto: ', null, null, undefined, obtenerDivisionIvaGasto, { cuentaHaber: cuentaHaberGasto });
    // Compra a crédito: su asiento ya sale como "Cuenta por pagar" (al generarse) y como
    // "Pago a proveedor" (al pagar). Generar además el asiento de "Compra" (Debe Inventario /
    // Haber Caja) la contaba dos veces y sacaba de Caja dinero que nunca salió. Solo se omiten
    // las compras que tienen cuenta por pagar y NO movieron Caja al registrarse.
    const comprasConCxp = new Set();
    { let desdeIdx = 0; const TAM = 1000;
      while (true) {
        const { data: pagina } = await F.lector.from('cuentas_por_pagar').select('compra_id').eq('auth_user_id', F.uid).not('compra_id', 'is', null).range(desdeIdx, desdeIdx + TAM - 1);
        (pagina || []).forEach(x => comprasConCxp.add(x.compra_id));
        if (!pagina || pagina.length < TAM) break;
        desdeIdx += TAM;
      }
    }
    // IVA de compras (opcional): si "IVA pagado en gastos" está configurado, el IVA de la compra va a IVA Acreditable.
    const divisionIvaCompra = c => {
      const iva = round2(Number(c?.iva_monto || 0));
      if (!mapeoIvaGastos || !mapeoIvaGastos.cuenta_debe_id || iva <= 0) return null;
      return { montoIva: iva, cuentaIvaId: mapeoIvaGastos.cuenta_debe_id, lado: 'debe' };
    };
    // Compra de contado con retención de IR practicada: Caja sale neto y la retención queda en Retenciones por Pagar.
    const divisionCompraConRet = async c => {
      const base = divisionIvaCompra(c);
      const ret = round2(Number(c?.retencion_ir_monto || 0));
      if (ret <= 0) return base;
      const mRet = mapeo.get('retencion_ir');
      if (!mRet || !mRet.cuenta_haber_id) return { bloquear: true };
      const ex = { haberExtras: [{ monto: ret, cuentaId: mRet.cuenta_haber_id, desc: 'Retención de IR por pagar' }] };
      return base ? { ...base, ...ex } : { montoIva: 0, cuentaIvaId: null, lado: 'debe', ...ex };
    };
    await procesarTipo('compra', 'compras', 'total', 'completada', 'estado', 'Compra ', null, null, undefined, divisionCompraConRet,
      { omitirFila: c => !c.movimiento_caja_id && comprasConCxp.has(c.id), cuentaDebe: cuentaDebeServicio });
    // Pago de retenciones de IR a la DGI (desde Impuestos): Debe Retenciones por Pagar / Haber Caja.
    await procesarTipo('pago_retenciones_ir', 'retenciones_ir_pagos', 'monto', 'activo', 'estado', 'Pago de retenciones de IR a la DGI');
    // Pago de impuestos a la DGI (Impuestos › Pagar): sin esto, el IVA por pagar nunca bajaba en Contabilidad.
    // Con IVA acreditable configurado se hace la liquidación: Debe IVA por pagar / Haber IVA acreditable / Haber Caja (neto).
    {
      const mPagoImp = mapeo.get('pago_impuestos');
      const ctaIvaPagar = mapeo.get('iva_ventas')?.cuenta_haber_id || null;
      const ctaIvaAcred = mapeo.get('iva_gastos')?.cuenta_debe_id || null;
      const ctaOtros = mapeo.get('impuesto_ventas_otros')?.cuenta_haber_id || null;
      const offsetPorPago = new Map();
      if (mPagoImp && mPagoImp.cuenta_debe_id && mPagoImp.cuenta_haber_id) {
        let movs = [];
        { let desdeIdx = 0; const TAM = 1000;
          while (true) {
            const { data: pagina } = await F.lector.from('movimientos_impuestos').select('id, tipo_movimiento, monto, impuesto_id, created_at')
              .eq('auth_user_id', F.uid).order('created_at', { ascending: true }).order('id', { ascending: true }).range(desdeIdx, desdeIdx + TAM - 1);
            movs = movs.concat(pagina || []);
            if (!pagina || pagina.length < TAM) break;
            desdeIdx += TAM;
          } }
        let V = 0, C = 0, consumido = 0, pagadoBruto = 0;
        for (const mv of movs) {
          if (mv.impuesto_id) continue; // solo el IVA
          const mt = Number(mv.monto) || 0;
          if (mv.tipo_movimiento === 'IVA_VENTA') V = round2(V + mt);
          else if (mv.tipo_movimiento === 'IVA_COMPRA') C = round2(C + mt);
          else if (mv.tipo_movimiento === 'PAGO_IMPUESTO' && mt > 0) {
            let A = 0;
            if (ctaIvaPagar && ctaIvaAcred) {
              A = Math.max(0, round2(Math.min(C, V) - consumido));
              A = Math.min(A, Math.max(0, round2(V - pagadoBruto - mt)));
            }
            consumido = round2(consumido + A); pagadoBruto = round2(pagadoBruto + mt + A);
            if (A > 0) offsetPorPago.set(mv.id, A);
          }
        }
      }
      await procesarTipo('pago_impuesto', 'movimientos_impuestos', 'monto', null, null, '', q => q.eq('tipo_movimiento', 'PAGO_IMPUESTO'),
        async fila => {
          const A = offsetPorPago.get(fila.id) || 0;
          return A > 0 ? [
            { cuenta_id: ctaIvaPagar, debe: A, haber: 0, descripcion: 'Liquidación de IVA: se aplica el IVA acreditable' },
            { cuenta_id: ctaIvaAcred, debe: 0, haber: A, descripcion: 'IVA acreditable aplicado' },
          ] : [];
        }, 'fecha', null, {
          mapeoDe: 'pago_impuestos',
          cuentaDebe: fila => (fila.impuesto_id ? (ctaOtros || undefined) : (ctaIvaPagar || undefined)),
        });
    }

    // Salarios: con "Deducciones de ley" configurado, el sueldo se registra BRUTO y las deducciones automáticas
    // (INSS laboral, IR de salarios) quedan por pagar. Sin configurar, todo sigue exactamente igual que antes.
    {
      const mDedLey = mapeo.get('nomina_deducciones_ley');
      const dedLey = fila => {
        if (!mDedLey || !mDedLey.cuenta_haber_id) return 0;
        const det = Array.isArray(fila.deducciones_detalle) ? fila.deducciones_detalle : [];
        return round2(det.filter(d => d && (d.esConcepto === true || /\(autom[aá]tico\)/i.test(String(d.descripcion || '')))).reduce((a, d) => a + (Number(d.monto) || 0), 0));
      };
      await procesarTipo('pago_salario', 'empleados_pagos', 'total_pagado', 'pagado', 'estado', 'Pago de salario', null, null, undefined,
        async fila => {
          const l = dedLey(fila);
          return l > 0 ? { montoIva: 0, cuentaIvaId: null, lado: 'haber', extras: [{ monto: l, cuentaId: mDedLey.cuenta_haber_id, desc: 'Deducciones de ley por pagar' }] } : null;
        }, { obtenerMonto: async fila => round2(Number(fila.total_pagado || 0) + dedLey(fila)) });
    }
    // Aportes patronales (INSS patronal, INATEC): gasto del patrono y obligación por pagar. No mueve Caja.
    await procesarTipo('aporte_patronal', 'empleados_pagos', 'aportes_patronales', 'pagado', 'estado', 'Aportes patronales');

    // Faltantes y sobrantes al cerrar Caja Chica (solo si el negocio configuró su cuenta): la diferencia ya queda
    // guardada en el cierre; aquí solo se LEE y se asienta en Contabilidad. No toca el saldo del módulo Caja.
    // En modo automático solo entran cierres desde FECHA_INICIO_AUTO_CAJA (los anteriores, solo al generar a mano).
    {
      const omitirCierreViejo = fila => STATE.generacionAutomatica === true && String(fila.cerrada_en || fila.fecha).slice(0, 10) < FECHA_INICIO_AUTO_CAJA;
      if (mapeo.get('faltante_caja')) {
        await procesarTipo('faltante_caja', 'caja_chica_sesiones', 'diferencia', 'cerrada', 'estado', 'Faltante de caja — cierre de Caja Chica',
          q => q.lt('diferencia', 0), null, 'fecha', null,
          { omitirFila: omitirCierreViejo, obtenerMonto: async f => Math.abs(Number(f.diferencia || 0)) });
      }
      if (mapeo.get('sobrante_caja')) {
        await procesarTipo('sobrante_caja', 'caja_chica_sesiones', 'diferencia', 'cerrada', 'estado', 'Sobrante de caja — cierre de Caja Chica',
          q => q.gt('diferencia', 0), null, 'fecha', null,
          { omitirFila: omitirCierreViejo, obtenerMonto: async f => Math.abs(Number(f.diferencia || 0)) });
      }
    }

    // Cuentas por Pagar (dinero que le debes a un proveedor): la
    // obligación se registra desde que se genera (fecha_compra),
    // sin importar si ya se pagó o sigue pendiente — el pago en sí,
    // cuando ocurre, es un movimiento aparte.
    await procesarTipo('cxp_generada', 'cuentas_por_pagar', 'monto_total', null, null, 'Cuenta por pagar — ', q => q.neq('estado', 'anulado'), null, 'fecha_compra',
      async cxp => {
        if (!cxp.compra_id) return null;
        const { data: cp } = await F.lector.from('compras').select('iva_monto').eq('id', cxp.compra_id).eq('auth_user_id', F.uid).maybeSingle();
        return divisionIvaCompra(cp);
      }, { cuentaDebe: cuentaDebeServicio });
    // Pago a proveedor con retención de IR: Debe CxP (bruto) / Haber Caja (neto) / Haber Retenciones por pagar.
    const mapeoRetIr = mapeo.get('retencion_ir');
    await procesarTipo('pago_cxp', 'cuentas_por_pagar_pagos', 'monto', null, null, 'Pago a proveedor', null, null, 'created_at',
      async p => {
        const ret = round2(Number(p.retencion_monto || 0));
        if (ret <= 0) return null;
        if (!mapeoRetIr || !mapeoRetIr.cuenta_haber_id) return { bloquear: true };
        return { montoIva: ret, cuentaIvaId: mapeoRetIr.cuenta_haber_id, lado: 'haber' };
      });

    // AJUSTES DE EXISTENCIA hechos desde la ficha del producto CON motivo (desde el 14-oct-2026
    // se pide motivo y se guarda su costo). Los viejos sin motivo ('edicion_producto') no se
    // tocan: muchos fueron la carga inicial y los cubre la conciliación de inventario inicial.
    // Las bajas de "Movimientos especiales" (tipo 'merma') ya entran como gasto de merma.
    // Los traslados entre lugares del grupo no son ajustes y no generan asiento.
    // Solo actúan si el negocio configuró su cuenta (si no, no se cuentan como pendientes).
    {
      const filtroAjuste = q => q.eq('tipo', 'ajuste_manual').neq('razon', 'edicion_producto').not('costo_total', 'is', null);
      const montoAjuste = async f => Math.abs(Number(f.costo_total || 0));
      if (mapeo.get('inventario_inicial')) {
        await procesarTipo('ajuste_inventario_inicial', 'movimientos_inventario', 'costo_total', null, null, 'Inventario inicial (cargado desde el producto)',
          q => filtroAjuste(q).eq('razon', 'inventario_inicial').gt('cantidad', 0), null, 'created_at', null,
          { mapeoDe: 'inventario_inicial', obtenerMonto: montoAjuste });
      }
      if (mapeo.get('ajuste_inventario_entrada')) {
        await procesarTipo('ajuste_inventario_entrada', 'movimientos_inventario', 'costo_total', null, null, 'Ajuste de existencia (sube)',
          q => filtroAjuste(q).neq('razon', 'inventario_inicial').gt('cantidad', 0), null, 'created_at', null,
          { obtenerMonto: montoAjuste });
      }
      if (mapeo.get('ajuste_inventario_salida')) {
        await procesarTipo('ajuste_inventario_salida', 'movimientos_inventario', 'costo_total', null, null, 'Ajuste de existencia (baja)',
          q => filtroAjuste(q).lt('cantidad', 0), null, 'created_at', null,
          { obtenerMonto: montoAjuste });
      }
    }

    // SALDOS DE APERTURA (lo que el negocio ya tenia antes de usar el sistema).
    // Solo se LEE de Caja y Creditos; nada se modifica ahi.
    // 1) Dinero inicial / aportes de capital que entraron a Caja.
    await procesarTipo('capital_inicial', 'movimientos_financieros', 'monto', 'completado', 'estado', 'Aporte de capital: ',
      q => q.eq('tipo_movimiento', 'CAPITAL_AGREGADO'), null, 'fecha', null, { sinRango: true });
    // 2) Creditos que ya existian (financieros): a Cuentas por Cobrar se debita
    //    saldo pendiente + lo ya cobrado, porque esos cobros SI generan su asiento
    //    (pago_credito) y sin este debito Cuentas por Cobrar quedaba en negativo.
    await procesarTipo('credito_existente', 'creditos', 'saldo_pendiente', null, null, 'Saldo inicial de crédito existente ',
      q => q.eq('es_existente', true).neq('estado', 'anulado'), null, 'created_at', null, {
        sinRango: true,
        obtenerMonto: async (cr) => {
          const { data: pagos } = await F.lector.from('creditos_pagos').select('monto')
            .eq('credito_id', cr.id).eq('auth_user_id', F.uid).eq('estado', 'completado');
          return Number(cr.saldo_pendiente || 0) + (pagos || []).reduce((t, p) => t + Number(p.monto || 0), 0);
        },
      });
    } // fin del recorrido por la central y su grupo

    let resumen = `✅ ${creados} asiento(s) nuevo(s) generado(s) y registrado(s).`;
    if (fuentesConta.length > 1) resumen += ` Incluye ${fuentesConta.length - 1} bodega(s)/sucursal(es) del grupo.`;
    if (saltados) resumen += ` ${saltados} ya existían (no se duplicaron).`;
    if (sinConfigurar) resumen += ` ⚠️ ${sinConfigurar} tipo(s) de movimiento sin configurar en "Contabilización automática".`;
    document.getElementById('ga-resultado').innerHTML = resumen;
    STATE.ultimosCreados = creados;
    if (!EN_FONDO_CONTA) showToast(`${creados} asiento(s) generado(s)`);
    await cargarAsientos();
    actualizarBannerAsientosPendientes();
  } catch (e) {
    console.error('generarAsientosAutomaticos:', e);
    errEl.textContent = 'Error: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-generar-asientos', false);
    STATE.generandoAsientosAutomaticos = false;
  }
}

/* =====================================================
   BANNER DE PENDIENTES — cuenta (sin crear nada) cuántos movimientos
   todavía no tienen su asiento automático, para que el banner de
   arriba diga algo útil apenas se entra al módulo.
===================================================== */
async function actualizarBannerAsientosPendientes() {
  const tituloEl = document.getElementById('banner-asientos-titulo');
  const descEl = document.getElementById('banner-asientos-desc');
  const btnEl = document.getElementById('btn-banner-generar');
  if (!tituloEl) return;

  try {
    const { data: mapeoData } = await sbClient.from('contabilidad_mapeo_cuentas').select('tipo_transaccion, cuenta_debe_id, cuenta_haber_id').eq('auth_user_id', STATE.userId);
    const mapeo = new Map((mapeoData||[]).map(m => [m.tipo_transaccion, m]));
    if (!mapeo.size) {
      tituloEl.textContent = 'Todavía no has configurado la contabilización automática';
      descEl.textContent = 'Configúrala una sola vez, y de ahí en adelante solo aprietas un botón.';
      btnEl.innerHTML = 'Configurar ahora';
      btnEl.setAttribute('onclick', 'abrirMapeoCuentas()');
      return;
    }
    btnEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> Generar todo automático';
    btnEl.setAttribute('onclick', 'abrirGenerarAsientos()');

    // BUG REAL CORREGIDO: antes se traia CADA asiento ya generado (para
    // saber cuales no contar de nuevo) y CADA fila de cada tabla, sin
    // ningun limite -- con miles de asientos ya generados, el Set de
    // "ya hechos" quedaba incompleto (cortado en 1000 filas), haciendo
    // que movimientos YA procesados se siguieran contando como
    // pendientes para siempre (confirmado con un caso real: el banner
    // decia 186, pero el numero real correcto era 32). Ahora se cuenta
    // TODO directo en la base de datos, sin traer ninguna fila
    // individual -- nunca queda limitado.
    const { data: conteos, error: errConteo } = await sbClient.rpc('contar_pendientes_contabilizar');
    if (errConteo) throw errConteo;
    const porTipo = new Map((conteos||[]).map(c => [c.tipo, Number(c.cantidad)||0]));
    const soloSiMapeado = tipo => mapeo.get(tipo) ? (porTipo.get(tipo)||0) : 0;

    const total = ['venta','credito_otorgado','pago_credito','gasto','compra','pago_salario','cxp_generada','pago_cxp','pago_impuesto','pago_retenciones_ir','aporte_patronal']
      .reduce((s, tipo) => s + soloSiMapeado(tipo), 0) + (mapeo.get('pago_credito') ? (porTipo.get('pago_fiado')||0) : 0);
    // Devoluciones de venta aún sin asiento (se cuentan aparte: son un documento nuevo)
    let pendDev = 0;
    if (mapeo.get('venta') || mapeo.get('credito_otorgado')) {
      try {
        const { count: nDev } = await sbClient.from('devoluciones_venta').select('id', { count: 'exact', head: true }).eq('auth_user_id', STATE.userId);
        if (nDev) {
          const { count: nAs } = await sbClient.from('asientos_contables').select('id', { count: 'exact', head: true })
            .eq('auth_user_id', STATE.userId).eq('origen', 'automatico').eq('referencia_tipo', 'devolucion_venta');
          pendDev = Math.max(0, (nDev || 0) - (nAs || 0));
        }
      } catch (_) { pendDev = 0; }
    }

    const totalConDev = total + pendDev;
    if (totalConDev > 0) {
      tituloEl.textContent = `${totalConDev} movimiento${totalConDev===1?'':'s'} sin registrar contablemente`;
      descEl.textContent = 'Ventas, gastos, compras, créditos, cuentas por pagar y salarios — todo en un clic.';
    } else {
      tituloEl.textContent = '✅ Tu contabilidad está al día';
      descEl.textContent = 'Todos tus movimientos ya tienen su asiento contable generado.';
    }
  } catch (e) {
    console.warn('actualizarBannerAsientosPendientes:', e);
    tituloEl.textContent = 'Contabilización automática';
    descEl.textContent = 'Genera los asientos de tus movimientos con un clic.';
  }
}

/* Generación automática opcional: si el negocio la activó, al entrar se generan solos los asientos
   pendientes (misma función y mismas reglas que el botón manual; no se duplica nada). */
async function guardarAutoGenerar(activo) {
  try {
    const { error } = await sbClient.from('configuracion_empresa').update({ contabilidad_auto_generar: !!activo }).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    STATE.empresaConfig.contabilidad_auto_generar = !!activo;
    showToast(activo ? 'Los asientos se generarán solos al entrar' : 'Generación automática desactivada');
    if (activo) autoGenerarAlEntrar();
  } catch (e) {
    const chk = document.getElementById('chk-auto-generar'); if (chk) chk.checked = !activo;
    showToast('No se pudo guardar la preferencia', 'error');
  }
}
async function autoGenerarAlEntrar() {
  try {
    if (STATE.empresaConfig?.contabilidad_auto_generar !== true || STATE.generandoAsientosAutomaticos) return;
    const { data: mapeoData } = await sbClient.from('contabilidad_mapeo_cuentas').select('tipo_transaccion').eq('auth_user_id', STATE.userId);
    if (!mapeoData || !mapeoData.length) return;
    let { data: desde } = await sbClient.rpc('fecha_mas_antigua_pendiente_contabilizar');
    // Faltantes/sobrantes de Caja Chica: ese contador de pendientes no los conoce, así que se revisan aparte.
    const tiposCaja = mapeoData.map(m => m.tipo_transaccion).filter(t => t === 'faltante_caja' || t === 'sobrante_caja');
    if (tiposCaja.length) {
      const { data: ses } = await sbClient.from('caja_chica_sesiones').select('id, fecha, diferencia, cerrada_en')
        .eq('auth_user_id', STATE.userId).eq('estado', 'cerrada').neq('diferencia', 0).gte('fecha', FECHA_INICIO_AUTO_CAJA).order('fecha').limit(500);
      const candidatas = (ses || []).filter(x => Number(x.diferencia) < 0 ? tiposCaja.includes('faltante_caja') : tiposCaja.includes('sobrante_caja'));
      if (candidatas.length) {
        const { data: hechos } = await sbClient.from('asientos_contables').select('referencia_id')
          .eq('auth_user_id', STATE.userId).eq('origen', 'automatico').in('referencia_tipo', ['faltante_caja', 'sobrante_caja']).in('referencia_id', candidatas.map(x => x.id));
        const yaIds = new Set((hechos || []).map(h => h.referencia_id));
        const sinAsiento = candidatas.find(x => !yaIds.has(x.id));
        if (sinAsiento) { const f = String(sinAsiento.fecha).slice(0, 10); if (!desde || f < String(desde).slice(0, 10)) desde = f; }
      }
    }
    if (!desde) return;
    document.getElementById('ga-desde').value = String(desde).slice(0, 10);
    document.getElementById('ga-hasta').value = todayISO();
    STATE.generacionAutomatica = true;
    try { await generarAsientosAutomaticos(); } finally { STATE.generacionAutomatica = false; }
    actualizarBannerAsientosPendientes();
  } catch (e) { console.warn('autoGenerarAlEntrar:', e); }
}

async function initContabilidad() {
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id; STATE.userEmail = user.email;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    if (EN_FONDO_CONTA) {
      // Pantalla oculta: solo genera lo pendiente (si el negocio lo activó) y avisa a la pantalla de arriba.
      try { await autoGenerarAlEntrar(); } catch (_) {}
      try { window.parent.postMessage({ n360: 'conta-fondo-listo', creados: STATE.ultimosCreados || 0 }, location.origin); } catch (_) {}
      return;
    }
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarCuentas();
    await cargarAsientos();
    actualizarBannerAsientosPendientes(); // no se espera (await) — no bloquea el resto de la carga
    { const chk = document.getElementById('chk-auto-generar'); if (chk) chk.checked = STATE.empresaConfig?.contabilidad_auto_generar === true; }
    autoGenerarAlEntrar();
  } catch (err) {
    console.error('initContabilidad:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initContabilidad();
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


/* =====================================================
   IMPUESTOS EN CONTABILIDAD — resumen de saldos por cuenta de impuesto
   y conciliación contra el módulo Impuestos. SOLO LECTURA.
===================================================== */
async function cargarImpuestosContables() {
  const cont = document.getElementById('imp-cuerpo');
  if (!cont) return;
  cont.innerHTML = 'Calculando…';
  try {
    const hasta = document.getElementById('imp-hasta')?.value || null;
    const { data: mapeoData } = await sbClient.from('contabilidad_mapeo_cuentas').select('tipo_transaccion, cuenta_debe_id, cuenta_haber_id').eq('auth_user_id', STATE.userId);
    const mapeo = new Map((mapeoData || []).map(m => [m.tipo_transaccion, m]));
    const cuentaPor = new Map((STATE.cuentas || []).map(c => [c.id, c]));

    // Cada concepto fiscal, la cuenta donde vive y su naturaleza.
    const defs = [
      { tipo: 'iva_ventas', lado: 'cuenta_haber_id', nat: 'acreedora', etiqueta: 'IVA por pagar (cobrado en ventas)' },
      { tipo: 'iva_gastos', lado: 'cuenta_debe_id', nat: 'deudora', etiqueta: 'IVA acreditable (pagado en compras y gastos)' },
      { tipo: 'retencion_ir', lado: 'cuenta_haber_id', nat: 'acreedora', etiqueta: 'Retenciones de IR por pagar (practicadas a proveedores)' },
      { tipo: 'retencion_ir_clientes', lado: 'cuenta_debe_id', nat: 'deudora', etiqueta: 'Retenciones de IR a favor (te retuvieron los clientes)' },
      { tipo: 'impuesto_ventas_otros', lado: 'cuenta_haber_id', nat: 'acreedora', etiqueta: 'Otros impuestos por pagar' },
      { tipo: 'nomina_deducciones_ley', lado: 'cuenta_haber_id', nat: 'acreedora', etiqueta: 'INSS / IR de nómina por pagar (retenido a empleados)' },
      { tipo: 'aporte_patronal', lado: 'cuenta_haber_id', nat: 'acreedora', etiqueta: 'Aportes patronales por pagar (INSS patronal, INATEC)' },
    ];
    const porCuenta = new Map();
    const sinConfigurar = [];
    for (const d of defs) {
      const id = mapeo.get(d.tipo)?.[d.lado];
      if (!id || !cuentaPor.has(id)) { sinConfigurar.push(d); continue; }
      const g = porCuenta.get(id) || { id, nat: d.nat, etiquetas: [], tipos: [] };
      g.etiquetas.push(d.etiqueta); g.tipos.push(d.tipo);
      porCuenta.set(id, g);
    }
    const ids = [...porCuenta.keys()];
    const { data: sumas, error } = ids.length
      ? await sbClient.rpc('sumar_movimientos_por_cuenta', { p_cuenta_ids: ids, p_fecha_desde: null, p_fecha_hasta: hasta })
      : { data: [], error: null };
    if (error) throw error;
    const mov = new Map((sumas || []).map(x => [x.cuenta_id, { debe: Number(x.total_debe) || 0, haber: Number(x.total_haber) || 0 }]));
    const saldoDe = id => { const g = porCuenta.get(id); const m = mov.get(id) || { debe: 0, haber: 0 }; return round2(g.nat === 'acreedora' ? m.haber - m.debe : m.debe - m.haber); };

    const filas = [...porCuenta.values()].map(g => {
      const c = cuentaPor.get(g.id);
      return `<tr><td>${esc(c.codigo)} · ${esc(c.nombre)}</td><td style="font-size:12.5px;color:var(--text-muted)">${g.etiquetas.map(esc).join(' · ')}</td>
        <td style="text-align:right;font-weight:700">${fmt(saldoDe(g.id))}</td><td>${g.nat === 'acreedora' ? 'Por pagar (acreedora)' : 'A favor (deudora)'}</td></tr>`;
    }).join('');

    // IVA neto = por pagar − acreditable (cuando ambos están configurados)
    const idIvaP = mapeo.get('iva_ventas')?.cuenta_haber_id, idIvaA = mapeo.get('iva_gastos')?.cuenta_debe_id;
    let bloqueIva = '';
    let ivaNetoCont = null;
    if (idIvaP && idIvaA && porCuenta.has(idIvaP) && porCuenta.has(idIvaA)) {
      ivaNetoCont = round2(saldoDe(idIvaP) - saldoDe(idIvaA));
      bloqueIva = `<div style="padding:10px 14px;border-radius:8px;background:var(--bg-hover,#f3f4f6);margin:10px 0;font-weight:700">IVA neto: ${ivaNetoCont >= 0 ? 'a pagar' : 'a favor'} ${fmt(Math.abs(ivaNetoCont))}</div>`;
    }

    // Conciliación con el módulo Impuestos (mismos datos que ve el usuario allá).
    const concil = [];
    try {
      let q = sbClient.from('movimientos_impuestos').select('tipo_movimiento, monto, impuesto_id, fecha, concepto').eq('auth_user_id', STATE.userId);
      if (hasta) q = q.lte('fecha', hasta);
      let movs = []; let desdeIdx = 0;
      while (true) {
        const { data: pg } = await q.range(desdeIdx, desdeIdx + 999);
        movs = movs.concat(pg || []);
        if (!pg || pg.length < 1000) break;
        desdeIdx += 1000;
      }
      const iva = movs.filter(m => !m.impuesto_id);
      const V = iva.filter(m => m.tipo_movimiento === 'IVA_VENTA').reduce((a, m) => a + Number(m.monto || 0), 0);
      const C = iva.filter(m => m.tipo_movimiento === 'IVA_COMPRA').reduce((a, m) => a + Number(m.monto || 0), 0);
      const P = iva.filter(m => m.tipo_movimiento === 'PAGO_IMPUESTO').reduce((a, m) => a + Number(m.monto || 0), 0);
      const ivaModulo = round2(V - C - P);
      if (ivaNetoCont !== null) concil.push({ nombre: 'IVA neto por pagar', modulo: ivaModulo, cont: ivaNetoCont });
      const cuotas = round2(movs.filter(m => m.tipo_movimiento === 'IVA_VENTA' && /cuota de cr[eé]dito/i.test(String(m.concepto || ''))).reduce((a, m) => a + Number(m.monto || 0), 0));
      if (cuotas > 0) bloqueIva += `<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px">ℹ️ El módulo Impuestos incluye ${fmt(cuotas)} de impuestos cobrados en cuotas de créditos financieros. Esos todavía no generan asiento automático, por eso puede haber diferencia.</div>`;
    } catch (e) { console.warn('conciliación IVA:', e); }
    try {
      let q = sbClient.from('retenciones_ir').select('lado, monto, estado, fecha').eq('auth_user_id', STATE.userId).eq('estado', 'pendiente');
      if (hasta) q = q.lte('fecha', hasta);
      const { data: rets } = await q.limit(5000);
      const sumLado = l => round2((rets || []).filter(r => r.lado === l).reduce((a, r) => a + Number(r.monto || 0), 0));
      const idRP = mapeo.get('retencion_ir')?.cuenta_haber_id, idRF = mapeo.get('retencion_ir_clientes')?.cuenta_debe_id;
      const compartida = idRP && ['impuesto_ventas_otros', 'nomina_deducciones_ley', 'aporte_patronal'].some(t => mapeo.get(t)?.cuenta_haber_id === idRP);
      if (idRP && porCuenta.has(idRP) && !compartida) concil.push({ nombre: 'Retenciones de IR por pagar', modulo: sumLado('por_pagar'), cont: saldoDe(idRP) });
      if (idRF && porCuenta.has(idRF)) concil.push({ nombre: 'Retenciones de IR a favor', modulo: sumLado('a_favor'), cont: saldoDe(idRF) });
    } catch (e) { console.warn('conciliación retenciones:', e); }

    const filasConc = concil.map(c => {
      const dif = round2(c.cont - c.modulo);
      return `<tr><td>${esc(c.nombre)}</td><td style="text-align:right">${fmt(c.modulo)}</td><td style="text-align:right">${fmt(c.cont)}</td>
        <td style="text-align:right;font-weight:700;color:${Math.abs(dif) < 0.01 ? 'var(--success)' : 'var(--warning)'}">${Math.abs(dif) < 0.01 ? '✅ cuadra' : fmt(dif)}</td></tr>`;
    }).join('');

    const faltan = sinConfigurar.length ? `<div style="font-size:12.5px;color:var(--text-muted);margin-top:12px"><b>Sin cuenta asignada</b> (Contabilización automática › Configurar): ${sinConfigurar.map(d => esc(d.etiqueta)).join(' · ')}. Los movimientos que dependen de ellas esperan sin asentarse hasta que las configures.</div>` : '';

    const bannerAsist = (typeof window.bannerImpuestosContables === 'function') ? window.bannerImpuestosContables(sinConfigurar) : '';
    cont.innerHTML = `
      ${bannerAsist}
      ${bloqueIva}
      ${filas ? `<div class="table-wrap"><table><thead><tr><th>Cuenta</th><th>Qué contiene</th><th style="text-align:right">Saldo${hasta ? ' al ' + esc(hasta) : ''}</th><th>Naturaleza</th></tr></thead><tbody>${filas}</tbody></table></div>`
        : '<p style="color:var(--text-muted)">Todavía no has asignado cuentas a los impuestos. Hazlo en Contabilización automática › Configurar.</p>'}
      ${filasConc ? `<h4 style="margin:18px 0 6px">Conciliación con el módulo Impuestos</h4>
        <div class="table-wrap"><table><thead><tr><th>Concepto</th><th style="text-align:right">Módulo Impuestos</th><th style="text-align:right">Contabilidad</th><th style="text-align:right">Diferencia</th></tr></thead><tbody>${filasConc}</tbody></table></div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Una diferencia suele ser asientos todavía sin generar (presiona "Generar automáticos"), saldos anteriores al uso de Contabilidad, o IVA de compras no separado.</p>` : ''}
      ${faltan}`;
  } catch (e) {
    console.error('cargarImpuestosContables:', e);
    cont.innerHTML = '<p style="color:var(--danger)">No se pudo calcular el resumen de impuestos.</p>';
  }
}
window.cargarImpuestosContables = cargarImpuestosContables;
