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
  ['asientos','mayor','balance','resultados','balancegeneral','flujo'].forEach(s => {
    document.getElementById(`seccion-${s}`).style.display = s === seccion ? '' : 'none';
    document.getElementById(`tab-btn-${s}`).classList.toggle('active', s === seccion);
  });
  if (seccion === 'mayor') poblarSelectCuentasMayor();
  if (seccion === 'balance') cargarBalanceComprobacion();
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
}
async function cargarLibroMayor() {
  const cuentaId = document.getElementById('mayor-cuenta-select').value;
  const tbody = document.getElementById('mayor-tbody');
  if (!cuentaId) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Elige una cuenta para ver su movimiento</td></tr>'; return; }
  tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Cargando…</td></tr>';

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
    const aoa = [[bizName],['Balance de Comprobación'],[`Al ${fmtFecha(todayISO())}`],[],headers,...rows,totales];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [0,1,2].map(r => ({ s:{r,c:0}, e:{r,c:headers.length-1} }));
    ws['!cols'] = headers.map((h,ci) => ({ wch: Math.min(Math.max(...[...rows.map(r=>String(r[ci]??'').length), h.length])+2, 32) }));
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

async function cargarEstadoResultados() {
  const desde = document.getElementById('er-desde').value;
  const hasta = document.getElementById('er-hasta').value;
  if (!desde || !hasta) { showToast('Elige el período', 'error'); return; }
  const cuerpo = document.getElementById('er-cuerpo');
  cuerpo.innerHTML = 'Calculando…';

  const ingresos = await calcularMovimientoPorTipo(['ingreso'], desde, hasta);
  const costos   = await calcularMovimientoPorTipo(['costo'], desde, hasta);
  const gastos   = await calcularMovimientoPorTipo(['gasto'], desde, hasta);

  const utilidadBruta = round2(ingresos.total - costos.total);
  const utilidadNeta = round2(utilidadBruta - gastos.total);

  STATE.estadoResultadosActual = { desde, hasta, ingresos, costos, gastos, utilidadBruta, utilidadNeta };

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
    ['','UTILIDAD NETA', e.utilidadNeta],
  ];
  if (formato === 'excel') {
    const aoa = [[bizName],['Estado de Resultados'],[`Período: ${fmtFecha(e.desde)} — ${fmtFecha(e.hasta)}`],[],['Código','Cuenta','Monto'],...filas];
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
    </div>`;
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
    const aoa = [[bizName],['Balance General'],[`Al ${fmtFecha(b.fecha)}`],[],['Código','Cuenta','Monto'],...filas];
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

  // "Flujo de Efectivo" es efectivo real — nunca tarjeta ni
  // transferencia, aunque esos movimientos también hayan pasado por
  // Caja General. Esa es la diferencia real entre este reporte y el
  // saldo general del negocio.
  const esEfectivo = m => (m.metodo_pago_nombre || 'Efectivo').toLowerCase().includes('efectivo');

  // Saldo inicial: todo el efectivo que pasó ANTES de "desde".
  const { data: previos } = await sbClient.from('movimientos_financieros')
    .select('tipo_flujo, monto, metodo_pago_nombre').eq('auth_user_id', STATE.userId).eq('estado', 'completado').lt('fecha', desde);
  const saldoInicial = round2((previos||[]).filter(esEfectivo).reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? Number(m.monto) : -Number(m.monto)), 0));

  // Movimientos del período elegido — solo efectivo.
  const { data: movsCrudos } = await sbClient.from('movimientos_financieros')
    .select('tipo_flujo, tipo_movimiento, monto, metodo_pago_nombre').eq('auth_user_id', STATE.userId).eq('estado', 'completado')
    .gte('fecha', desde).lte('fecha', hasta);
  const movs = (movsCrudos||[]).filter(esEfectivo);

  const grupos = { operacion: [], financiamiento: [], inversion: [] };
  const acumulado = new Map();
  movs.forEach(m => {
    const info = CATEGORIA_FLUJO[m.tipo_movimiento] || { grupo:'operacion', label: m.tipo_movimiento };
    const signo = m.tipo_flujo === 'INGRESO' ? 1 : -1;
    const clave = `${info.grupo}:${info.label}`;
    acumulado.set(clave, round2((acumulado.get(clave)||0) + signo*Number(m.monto||0)));
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
  const { data: todosHastaFecha } = await sbClient.from('movimientos_financieros')
    .select('tipo_flujo, monto, metodo_pago_nombre').eq('auth_user_id', STATE.userId).eq('estado', 'completado').lte('fecha', hasta);
  const saldoRealCaja = round2((todosHastaFecha||[]).filter(esEfectivo).reduce((s,m) => s + (m.tipo_flujo==='INGRESO' ? Number(m.monto) : -Number(m.monto)), 0));
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
    const aoa = [[bizName],['Estado de Flujo de Efectivo'],[`Período: ${fmtFecha(f.desde)} — ${fmtFecha(f.hasta)}`],[],['Código','Concepto','Monto'],...filas];
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
  credito_otorgado: { label: 'Crédito otorgado (venta a crédito)', ejemplo: 'Debe: Cuentas por Cobrar — Haber: Ventas' },
  pago_credito: { label: 'Pago de crédito recibido', ejemplo: 'Debe: Caja — Haber: Cuentas por Cobrar' },
  costo_ventas: { label: 'Costo de lo vendido (automático en cada venta)', ejemplo: 'Debe: Costo de Ventas — Haber: Inventario' },
  gasto: { label: 'Gasto', ejemplo: 'Debe: Gastos — Haber: Caja' },
  compra: { label: 'Compra (pagada de una vez)', ejemplo: 'Debe: Inventario — Haber: Caja' },
  cxp_generada: { label: 'Cuenta por pagar (compra a crédito con proveedor)', ejemplo: 'Debe: Inventario — Haber: Cuentas por Pagar' },
  pago_cxp: { label: 'Pago a proveedor (de una cuenta por pagar)', ejemplo: 'Debe: Cuentas por Pagar — Haber: Caja' },
  pago_salario: { label: 'Pago de salario', ejemplo: 'Debe: Sueldos y Salarios — Haber: Caja' },
};
let STATE_MAPEO = [];

async function abrirMapeoCuentas() {
  if (!STATE.cuentas.length) await cargarCuentas();
  try {
    const { data } = await sbClient.from('contabilidad_mapeo_cuentas').select('*').eq('auth_user_id', STATE.userId);
    STATE_MAPEO = data || [];
  } catch (e) { STATE_MAPEO = []; }
  renderMapeoFilas();
  document.getElementById('mapeo-error').textContent = '';
  openModal('modal-mapeo-cuentas');
}
function renderMapeoFilas() {
  const opciones = STATE.cuentas.filter(c => c.permite_movimientos)
    .map(c => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  document.getElementById('mapeo-filas').innerHTML = Object.entries(TIPOS_TRANSACCION).map(([tipo, info]) => {
    const existente = STATE_MAPEO.find(m => m.tipo_transaccion === tipo) || {};
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
  }).join('');
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
  setBtnLoading('btn-guardar-mapeo', true);
  try {
    for (const tipo of Object.keys(TIPOS_TRANSACCION)) {
      const debe = document.getElementById(`mapeo-debe-${tipo}`).value || null;
      const haber = document.getElementById(`mapeo-haber-${tipo}`).value || null;
      if (!debe && !haber) continue; // no configurado, se deja como está
      await sbClient.from('contabilidad_mapeo_cuentas').upsert({
        auth_user_id: STATE.userId, tipo_transaccion: tipo, cuenta_debe_id: debe, cuenta_haber_id: haber,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_user_id,tipo_transaccion' });
    }
    showToast('Configuración guardada');
    closeModal('modal-mapeo-cuentas');
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-mapeo', false);
  }
}

function abrirGenerarAsientos() {
  const hoy = new Date();
  document.getElementById('ga-desde').value = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
  document.getElementById('ga-hasta').value = todayISO();
  document.getElementById('ga-resultado').innerHTML = '';
  document.getElementById('ga-error').textContent = '';
  openModal('modal-generar-asientos');
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

async function generarAsientosAutomaticos() {
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
  try {
    // Ya generados antes, para nunca duplicar el mismo asiento.
    const { data: yaGenerados } = await sbClient.from('asientos_contables')
      .select('referencia_tipo, referencia_id').eq('auth_user_id', STATE.userId).eq('origen', 'automatico');
    const yaHechos = new Set((yaGenerados||[]).map(a => `${a.referencia_tipo}:${a.referencia_id}`));

    let creados = 0, saltados = 0, sinConfigurar = 0;

    async function procesarTipo(tipo, tabla, campoMonto, filtroEstado, campoEstado, conceptoPrefijo, filtroExtra, obtenerLineasExtra, campoFecha) {
      const m = mapeo.get(tipo);
      if (!m || !m.cuenta_debe_id || !m.cuenta_haber_id) { sinConfigurar++; return; }
      campoFecha = campoFecha || 'fecha';

      // SOLO LECTURA — nunca se hace ningún update/insert/delete sobre
      // esta tabla, solo se consulta.
      let query = sbClient.from(tabla).select('*').eq('auth_user_id', STATE.userId);
      if (campoEstado) query = query.eq(campoEstado, filtroEstado); // algunas tablas (ej. pagos ya hechos) no tienen "estado" — todas sus filas ya son reales
      query = query.gte(campoFecha, desde).lte(campoFecha, `${hasta} 23:59:59`);
      if (filtroExtra) query = filtroExtra(query);
      const { data: filas } = await query;

      for (const fila of (filas||[])) {
        const clave = `${tipo}:${fila.id}`;
        if (yaHechos.has(clave)) { saltados++; continue; }
        const monto = round2(Number(fila[campoMonto] || 0));
        if (monto <= 0) continue;

        // Costo de lo vendido (si está configurado) — se agrega como
        // 2 líneas MÁS dentro del MISMO asiento, no como uno aparte.
        // Sigue cuadrando porque Debe y Haber de esas 2 líneas son
        // igual monto entre sí, sin importar cuánto sea.
        const lineasExtra = obtenerLineasExtra ? await obtenerLineasExtra(fila) : [];

        const numero = (await sbClient.rpc('generar_numero_asiento', { p_user_id: STATE.userId })).data;
        const fechaAsiento = String(fila[campoFecha]).slice(0, 10); // por si es timestamp completo (ej. created_at)
        const { data: asiento, error: errA } = await sbClient.from('asientos_contables').insert({
          auth_user_id: STATE.userId, numero, fecha: fechaAsiento,
          concepto: `${conceptoPrefijo}${fila.concepto || fila.numero_venta || fila.numero || ''}`.trim(),
          estado: 'borrador', origen: 'automatico', referencia_tipo: tipo, referencia_id: fila.id,
          usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
        }).select().single();
        if (errA || !asiento) continue;

        const lineas = [
          { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: m.cuenta_debe_id, debe: monto, haber: 0, orden: 0 },
          { auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: m.cuenta_haber_id, debe: 0, haber: monto, orden: 1 },
          ...lineasExtra.map((l, i) => ({ auth_user_id: STATE.userId, asiento_id: asiento.id, cuenta_id: l.cuenta_id, debe: l.debe||0, haber: l.haber||0, orden: 2+i, descripcion: l.descripcion||null })),
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
    async function obtenerCostoVentaVendido(venta) {
      if (!mapeoCosto || !mapeoCosto.cuenta_debe_id || !mapeoCosto.cuenta_haber_id) return [];
      const { data: detalles } = await sbClient.from('venta_detalles').select('cantidad, costo').eq('venta_id', venta.id).eq('auth_user_id', STATE.userId);
      const costoTotal = round2((detalles||[]).reduce((s,d) => s + (Number(d.cantidad||0) * Number(d.costo||0)), 0));
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
    await procesarTipo('venta', 'ventas', 'total', 'completada', 'estado', 'Venta ', q => q.neq('metodo_pago', 'credito'), obtenerCostoVentaVendido);
    await procesarTipo('credito_otorgado', 'ventas', 'total', 'completada', 'estado', 'Crédito otorgado — venta ', q => q.eq('metodo_pago', 'credito'), obtenerCostoVentaVendido);
    await procesarTipo('pago_credito', 'creditos_pagos', 'monto', 'completado', 'estado', 'Pago de crédito recibido');
    await procesarTipo('gasto', 'gastos', 'monto', 'activo', 'estado', 'Gasto: ');
    await procesarTipo('compra', 'compras', 'total', 'completada', 'estado', 'Compra ');
    await procesarTipo('pago_salario', 'empleados_pagos', 'total_pagado', 'pagado', 'estado', 'Pago de salario');

    // Cuentas por Pagar (dinero que le debes a un proveedor): la
    // obligación se registra desde que se genera (fecha_compra),
    // sin importar si ya se pagó o sigue pendiente — el pago en sí,
    // cuando ocurre, es un movimiento aparte.
    await procesarTipo('cxp_generada', 'cuentas_por_pagar', 'monto_total', null, null, 'Cuenta por pagar — ', null, null, 'fecha_compra');
    await procesarTipo('pago_cxp', 'cuentas_por_pagar_pagos', 'monto', null, null, 'Pago a proveedor', null, null, 'created_at');

    let resumen = `✅ ${creados} asiento(s) nuevo(s) generado(s) y registrado(s).`;
    if (saltados) resumen += ` ${saltados} ya existían (no se duplicaron).`;
    if (sinConfigurar) resumen += ` ⚠️ ${sinConfigurar} tipo(s) de movimiento sin configurar en "Contabilización automática".`;
    document.getElementById('ga-resultado').innerHTML = resumen;
    showToast(`${creados} asiento(s) generado(s)`);
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

    const { data: yaGenerados } = await sbClient.from('asientos_contables')
      .select('referencia_tipo, referencia_id').eq('auth_user_id', STATE.userId).eq('origen', 'automatico');
    const yaHechos = new Set((yaGenerados||[]).map(a => `${a.referencia_tipo}:${a.referencia_id}`));

    async function contarTipo(tipo, tabla, filtroEstado, campoEstado, filtroExtra) {
      if (!mapeo.get(tipo)) return 0;
      let query = sbClient.from(tabla).select('id').eq('auth_user_id', STATE.userId);
      if (campoEstado) query = query.eq(campoEstado, filtroEstado);
      if (filtroExtra) query = filtroExtra(query);
      const { data } = await query;
      return (data||[]).filter(f => !yaHechos.has(`${tipo}:${f.id}`)).length;
    }

    const [nVenta, nCredito, nPagoCredito, nGasto, nCompra, nSalario, nCxp, nPagoCxp] = await Promise.all([
      contarTipo('venta', 'ventas', 'completada', 'estado', q => q.neq('metodo_pago', 'credito')),
      contarTipo('credito_otorgado', 'ventas', 'completada', 'estado', q => q.eq('metodo_pago', 'credito')),
      contarTipo('pago_credito', 'creditos_pagos', 'completado', 'estado'),
      contarTipo('gasto', 'gastos', 'activo', 'estado'),
      contarTipo('compra', 'compras', 'completada', 'estado'),
      contarTipo('pago_salario', 'empleados_pagos', 'pagado', 'estado'),
      contarTipo('cxp_generada', 'cuentas_por_pagar', null, null),
      contarTipo('pago_cxp', 'cuentas_por_pagar_pagos', null, null),
    ]);
    const total = nVenta + nCredito + nPagoCredito + nGasto + nCompra + nSalario + nCxp + nPagoCxp;

    if (total > 0) {
      tituloEl.textContent = `${total} movimiento${total===1?'':'s'} sin registrar contablemente`;
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
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarCuentas();
    await cargarAsientos();
    actualizarBannerAsientosPendientes(); // no se espera (await) — no bloquea el resto de la carga
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
  setTimeout(() => {
    const btn = document.getElementById('btn-moneda-vis-texto');
    if (btn) btn.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda);
  }, 800);
});
