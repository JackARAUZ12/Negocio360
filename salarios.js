/* =====================================================
   SALARIOS.JS — NEGOCIO360
   Administración de empleados y pago de salarios.

   ARQUITECTURA:
     Salarios → Caja (todo pago SIEMPRE crea un egreso en Caja,
                       vía window.CajaAPI — nunca se omite, igual
                       que Créditos y Cuentas por Pagar)
     Salarios → Empleados (actualiza último pago / próximo pago)
   No modifica Inventario, Productos, Servicios, Clientes, Ventas,
   Compras, Créditos ni Cuentas por Pagar.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},

  empleados: [],
  metodosPago: [],

  filtro: 'todos',
  search: '',
  page: 1,
  perPage: 15,

  empleadoActual: null,
  adelantosPendientes: [],
  bonos: [],        // [{descripcion, monto}]
  deducciones: [],  // [{descripcion, monto}]
  conceptos: [],
  aportesPatronales: [],
  planillas: [],
  planillaSeleccion: new Map(),
  bonoAnualConfig: null,

  ultimoComprobante: null,
};

/* =====================================================
   HELPERS: FECHA (mismo fix de huso horario que el resto del sistema)
===================================================== */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO() { return ymd(new Date()); }
function ymdUTC(dt) { return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Calcula la fecha del próximo pago según el tipo de salario.
function sumarPeriodoSalario(fechaISO, tipoSalario, n) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  if (tipoSalario === 'diario')    { const dt = new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+1*n);  return ymdUTC(dt); }
  if (tipoSalario === 'semanal')   { const dt = new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+7*n);  return ymdUTC(dt); }
  if (tipoSalario === 'quincenal') { const dt = new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+15*n); return ymdUTC(dt); }
  // mensual — respeta fin de mes
  let mm = (m - 1) + n;
  const yy = y + Math.floor(mm / 12);
  mm = ((mm % 12) + 12) % 12;
  const ultimoDiaMes = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return ymdUTC(new Date(Date.UTC(yy, mm, Math.min(d, ultimoDiaMes))));
}

/* =====================================================
   HELPERS: FORMATO
===================================================== */
function sym() { return STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$'; }
function fmt(amount) {
  const n = Number(amount) || 0;
  return `${sym()} ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtNum(v) { return Number(v || 0).toLocaleString('es-NI'); }
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const TIPO_SALARIO_LABEL = { mensual:'Mensual', quincenal:'Quincenal', semanal:'Semanal', diario:'Diario' };

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

/* =====================================================
   CONFIG EMPRESA / PERFIL / ADMIN (idéntico al resto del sistema)
===================================================== */
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

/* =====================================================
   MÉTODOS DE PAGO
===================================================== */
async function loadMetodosPago() {
  try {
    const { data } = await sbClient.from('metodos_pago').select('id, nombre, activo, es_default')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('orden');
    STATE.metodosPago = data || [];
  } catch (e) {
    console.warn('loadMetodosPago:', e);
    STATE.metodosPago = [{ id: null, nombre: 'Efectivo', es_default: true }];
  }
  const opciones = (STATE.metodosPago.length?STATE.metodosPago:[{id:null,nombre:'Efectivo',es_default:true}])
    .map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  const def = STATE.metodosPago.find(m => m.es_default);
  const sel = document.getElementById('pg-sal-metodo');
  if (sel) { sel.innerHTML = opciones; if (def) sel.value = def.id || ''; }
}

/* =====================================================
   EMPLEADOS — CRUD
===================================================== */
async function loadEmpleados() {
  const tbody = document.getElementById('sal-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Cargando empleados…</td></tr>`;
  try {
    const { data, error } = await sbClient.from('empleados').select('*').eq('auth_user_id', STATE.userId).order('nombre');
    if (error) throw error;
    STATE.empleados = data || [];
    STATE.page = 1;
    renderTablaSal();
  } catch (e) {
    console.error('loadEmpleados:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No se pudieron cargar los empleados</td></tr>`;
  }
}

function abrirNuevoEmpleado() {
  document.getElementById('emp-modal-title').textContent = 'Nuevo empleado';
  document.getElementById('emp-id').value = '';
  ['emp-nombre','emp-cargo','emp-telefono','emp-correo','emp-observaciones',
   'emp-cedula','emp-fecha-nacimiento','emp-direccion','emp-contacto-nombre','emp-contacto-telefono',
   'emp-departamento','emp-fecha-fin-contrato'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  document.getElementById('emp-fecha-ingreso').value = todayISO();
  document.getElementById('emp-tipo-salario').value = 'mensual';
  document.getElementById('emp-salario').value = '';
  document.getElementById('emp-estado').value = 'activo';
  document.getElementById('emp-pais').value = 'NI';
  document.getElementById('emp-tipo-contrato').value = 'indefinido';
  document.getElementById('emp-fecha-fin-wrap').style.display = 'none';
  poblarSelectReportaA(null);
  document.getElementById('emp-error').textContent = '';
  openModal('modal-empleado');
}
function poblarSelectReportaA(excluirId) {
  const sel = document.getElementById('emp-reporta-a');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Nadie / gerencia —</option>' +
    STATE.empleados.filter(e => e.id !== excluirId).map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
}
function abrirEditarEmpleado(id) {
  const emp = STATE.empleados.find(e => e.id === id);
  if (!emp) return;
  document.getElementById('emp-modal-title').textContent = 'Editar empleado';
  document.getElementById('emp-id').value = emp.id;
  document.getElementById('emp-nombre').value = emp.nombre || '';
  document.getElementById('emp-cargo').value = emp.cargo || '';
  document.getElementById('emp-telefono').value = emp.telefono || '';
  document.getElementById('emp-correo').value = emp.correo || '';
  document.getElementById('emp-fecha-ingreso').value = emp.fecha_ingreso || '';
  document.getElementById('emp-tipo-salario').value = emp.tipo_salario || 'mensual';
  document.getElementById('emp-salario').value = emp.salario || '';
  document.getElementById('emp-estado').value = emp.estado || 'activo';
  document.getElementById('emp-observaciones').value = emp.observaciones || '';
  document.getElementById('emp-cedula').value = emp.cedula || '';
  document.getElementById('emp-fecha-nacimiento').value = emp.fecha_nacimiento || '';
  document.getElementById('emp-direccion').value = emp.direccion || '';
  document.getElementById('emp-contacto-nombre').value = emp.contacto_emergencia_nombre || '';
  document.getElementById('emp-contacto-telefono').value = emp.contacto_emergencia_telefono || '';
  document.getElementById('emp-pais').value = emp.pais || 'NI';
  document.getElementById('emp-departamento').value = emp.departamento || '';
  document.getElementById('emp-tipo-contrato').value = emp.tipo_contrato || 'indefinido';
  document.getElementById('emp-fecha-fin-contrato').value = emp.fecha_fin_contrato || '';
  document.getElementById('emp-fecha-fin-wrap').style.display = emp.tipo_contrato === 'plazo_fijo' ? '' : 'none';
  poblarSelectReportaA(emp.id);
  document.getElementById('emp-reporta-a').value = emp.reporta_a || '';
  document.getElementById('emp-error').textContent = '';
  openModal('modal-empleado');
}

async function guardarEmpleado() {
  const errEl = document.getElementById('emp-error');
  errEl.textContent = '';
  const id = document.getElementById('emp-id').value || null;
  const nombre = document.getElementById('emp-nombre').value.trim();
  const salario = parseFloat(document.getElementById('emp-salario').value);
  const tipoSalario = document.getElementById('emp-tipo-salario').value;
  const fechaIngreso = document.getElementById('emp-fecha-ingreso').value || null;

  if (!nombre) { errEl.textContent = 'El nombre es requerido.'; return; }
  if (isNaN(salario) || salario < 0) { errEl.textContent = 'Indica un salario válido.'; return; }

  const tipoContrato = document.getElementById('emp-tipo-contrato').value;
  const payload = {
    nombre, cargo: document.getElementById('emp-cargo').value.trim() || null,
    telefono: document.getElementById('emp-telefono').value.trim() || null,
    correo: document.getElementById('emp-correo').value.trim() || null,
    fecha_ingreso: fechaIngreso, tipo_salario: tipoSalario, salario,
    estado: document.getElementById('emp-estado').value,
    observaciones: document.getElementById('emp-observaciones').value.trim() || null,
    cedula: document.getElementById('emp-cedula').value.trim() || null,
    fecha_nacimiento: document.getElementById('emp-fecha-nacimiento').value || null,
    direccion: document.getElementById('emp-direccion').value.trim() || null,
    contacto_emergencia_nombre: document.getElementById('emp-contacto-nombre').value.trim() || null,
    contacto_emergencia_telefono: document.getElementById('emp-contacto-telefono').value.trim() || null,
    pais: document.getElementById('emp-pais').value || 'NI',
    departamento: document.getElementById('emp-departamento').value.trim() || null,
    reporta_a: document.getElementById('emp-reporta-a').value || null,
    tipo_contrato: tipoContrato,
    fecha_fin_contrato: tipoContrato === 'plazo_fijo' ? (document.getElementById('emp-fecha-fin-contrato').value || null) : null,
  };

  setBtnLoading('btn-guardar-empleado', true);
  try {
    if (id) {
      const emp = STATE.empleados.find(e => e.id === id);
      // Si cambia el tipo de salario o el salario, se recalcula el
      // próximo pago desde el último pago (o desde el ingreso si aún no
      // ha cobrado), para que quede coherente con el nuevo periodo.
      const base = emp?.ultimo_pago || fechaIngreso || todayISO();
      payload.proximo_pago = sumarPeriodoSalario(base, tipoSalario, 1);
      payload.updated_at = new Date().toISOString();
      const { error } = await sbClient.from('empleados').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
      if (error) throw error;

      // Nunca se pierde el dato anterior — si cambia el salario o el
      // cargo, queda registrado en el historial del empleado.
      const cambios = [];
      if (emp && Number(emp.salario) !== Number(salario)) cambios.push({ campo:'salario', anterior:String(emp.salario), nuevo:String(salario) });
      if (emp && (emp.cargo||'') !== (payload.cargo||'')) cambios.push({ campo:'cargo', anterior:emp.cargo||'—', nuevo:payload.cargo||'—' });
      if (cambios.length) {
        try {
          await sbClient.from('empleados_historial_cambios').insert(cambios.map(c => ({
            auth_user_id: STATE.userId, empleado_id: id, campo: c.campo,
            valor_anterior: c.anterior, valor_nuevo: c.nuevo,
            usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
          })));
        } catch (eHist) { console.warn('No se pudo registrar el historial:', eHist); }
      }
      showToast('Empleado actualizado');
    } else {
      payload.proximo_pago = sumarPeriodoSalario(fechaIngreso || todayISO(), tipoSalario, 1);
      const { error } = await sbClient.from('empleados').insert({ auth_user_id: STATE.userId, ...payload });
      if (error) throw error;
      showToast('Empleado registrado');
    }
    closeModal('modal-empleado');
    await Promise.allSettled([loadEmpleados(), loadKPIsSal()]);
  } catch (e) {
    console.error('guardarEmpleado:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-empleado', false);
  }
}

function confirmarEliminarEmpleado(id) {
  const emp = STATE.empleados.find(e => e.id === id);
  if (!emp) return;
  STATE.empleadoActual = emp;
  openModal('modal-confirmar-eliminar-emp');
}
async function eliminarEmpleado() {
  const emp = STATE.empleadoActual;
  if (!emp) return;
  setBtnLoading('btn-confirmar-eliminar-emp', true);
  try {
    const { error } = await sbClient.from('empleados').delete().eq('id', emp.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Empleado eliminado');
    closeModal('modal-confirmar-eliminar-emp');
    await Promise.allSettled([loadEmpleados(), loadKPIsSal()]);
  } catch (e) {
    console.error('eliminarEmpleado:', e);
    showToast('Error al eliminar: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-confirmar-eliminar-emp', false);
  }
}

/* =====================================================
   TABLA / FILTROS / BÚSQUEDA
===================================================== */
function empleadosFiltrados() {
  const q = STATE.search.toLowerCase().trim();
  const hoy = todayISO();
  return STATE.empleados.filter(e => {
    if (STATE.filtro === 'activo'    && e.estado !== 'activo')    return false;
    if (STATE.filtro === 'inactivo'  && e.estado !== 'inactivo')  return false;
    if (STATE.filtro === 'pendiente' && !(e.proximo_pago && e.proximo_pago <= hoy)) return false;
    if (STATE.filtro === 'pagado'    && e.ultimo_pago !== hoy)    return false;
    if (!q) return true;
    return (e.nombre||'').toLowerCase().includes(q) || (e.cargo||'').toLowerCase().includes(q) ||
           (TIPO_SALARIO_LABEL[e.tipo_salario]||'').toLowerCase().includes(q);
  });
}
function renderTablaSal() {
  const tbody = document.getElementById('sal-tbody');
  if (!tbody) return;
  const filtrados = empleadosFiltrados();
  const totalPag = Math.max(1, Math.ceil(filtrados.length / STATE.perPage));
  STATE.page = Math.min(STATE.page, totalPag);
  const inicio = (STATE.page-1)*STATE.perPage;
  const pagina = filtrados.slice(inicio, inicio+STATE.perPage);
  const hoy = todayISO();

  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No hay empleados con estos filtros</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(e => {
      const vencido = e.proximo_pago && e.proximo_pago <= hoy;
      return `
      <tr>
        <td style="font-weight:500">${esc(e.nombre)}</td>
        <td>${esc(e.cargo||'—')}</td>
        <td>${TIPO_SALARIO_LABEL[e.tipo_salario]||e.tipo_salario}</td>
        <td class="td-right td-money">${fmt(e.salario)}</td>
        <td>${e.proximo_pago ? `<span style="${vencido?'color:var(--danger);font-weight:700':''}">${fmtDate(e.proximo_pago)}</span>` : '—'}</td>
        <td><span class="status-badge badge-${e.estado}">${e.estado==='activo'?'Activo':'Inactivo'}</span></td>
        <td class="td-actions">
          <button class="btn-icon" title="Editar" onclick="abrirEditarEmpleado('${e.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>
          <button class="btn-icon" title="Ver historial" onclick="verHistorialEmpleado('${e.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
          <button class="btn-icon" title="Registrar pago" onclick="abrirPagarDesdeTabla('${e.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>
          <button class="btn-icon" title="Pagar Bono Anual" onclick="abrirPagarBonoAnual('${e.id}')">🎁</button>
          <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="confirmarEliminarEmpleado('${e.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`;
    }).join('');
  }

  const info = document.getElementById('paginacion-info');
  if (info) info.textContent = filtrados.length ? `${inicio+1}–${Math.min(inicio+STATE.perPage,filtrados.length)} de ${filtrados.length}` : '—';
  const prev = document.getElementById('btn-pag-prev'); if (prev) prev.disabled = STATE.page<=1;
  const next = document.getElementById('btn-pag-next'); if (next) next.disabled = STATE.page>=totalPag;
}
function setFiltroSal(f) {
  STATE.filtro = f; STATE.page = 1;
  document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => b.classList.toggle('active', b.dataset.filtro===f));
  renderTablaSal();
}
function buscarSal() { STATE.search = document.getElementById('sal-search')?.value || ''; STATE.page = 1; renderTablaSal(); }
function paginaAnterior() { if (STATE.page>1) { STATE.page--; renderTablaSal(); } }
function paginaSiguiente() { STATE.page++; renderTablaSal(); }

/* =====================================================
   KPIs
===================================================== */
async function loadKPIsSal() {
  try {
    const hoy = todayISO();
    const activos = STATE.empleados.filter(e => e.estado === 'activo');
    const pendientesHoy = STATE.empleados.filter(e => e.proximo_pago && e.proximo_pago <= hoy).length;

    const inicioMes = hoy.slice(0,7)+'-01';
    const { data: pagosMes } = await sbClient.from('empleados_pagos').select('total_pagado')
      .eq('auth_user_id', STATE.userId).gte('fecha', inicioMes);
    const totalMes = (pagosMes||[]).reduce((s,p)=>s+Number(p.total_pagado||0),0);

    const { data: adelantosPend } = await sbClient.from('empleados_adelantos').select('monto')
      .eq('auth_user_id', STATE.userId).eq('estado','pendiente');
    const totalAdelantos = (adelantosPend||[]).reduce((s,a)=>s+Number(a.monto||0),0);

    const proximos = activos.filter(e=>e.proximo_pago).sort((a,b)=>a.proximo_pago.localeCompare(b.proximo_pago));
    const proximo = proximos[0];

    const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    set('kpi-total-empleados', fmtNum(STATE.empleados.length));
    set('kpi-pagos-pendientes', fmtNum(pendientesHoy));
    set('kpi-pagos-mes', fmtNum((pagosMes||[]).length));
    set('kpi-total-mes', fmt(totalMes));
    set('kpi-proximo-pago', proximo ? `${esc(proximo.nombre)} · ${fmtDate(proximo.proximo_pago)}` : '—');
    set('kpi-adelantos-pendientes', fmt(totalAdelantos));
  } catch (e) { console.warn('loadKPIsSal:', e); }
}

/* =====================================================
   HISTORIAL DEL EMPLEADO (pagos + adelantos)
===================================================== */
async function verHistorialEmpleado(id) {
  const emp = STATE.empleados.find(e => e.id === id);
  if (!emp) return;
  STATE.empleadoActual = emp;
  document.getElementById('hist-emp-title').textContent = `${emp.nombre} — Historial`;
  const body = document.getElementById('historial-empleado-body');
  body.innerHTML = 'Cargando…';
  openModal('modal-historial-empleado');

  try {
    const [{ data: pagos }, { data: adelantos }] = await Promise.all([
      sbClient.from('empleados_pagos').select('*').eq('empleado_id', id).order('fecha', { ascending:false }),
      sbClient.from('empleados_adelantos').select('*').eq('empleado_id', id).order('fecha', { ascending:false }),
    ]);

    let html = `
      <div class="form-row">
        <div><label>Cargo</label><div class="stat-readonly">${esc(emp.cargo||'—')}</div></div>
        <div><label>Tipo de salario</label><div class="stat-readonly">${TIPO_SALARIO_LABEL[emp.tipo_salario]||'—'}</div></div>
        <div><label>Salario</label><div class="stat-readonly">${fmt(emp.salario)}</div></div>
        <div><label>Próximo pago</label><div class="stat-readonly">${fmtDate(emp.proximo_pago)}</div></div>
      </div>

      <div class="nc-paso-title" style="margin-top:16px">Historial de pagos</div>
      <div class="table-wrap"><table><thead><tr>
        <th>Fecha</th><th class="th-right">Base</th><th class="th-right">Bonos</th><th class="th-right">Deducciones</th><th class="th-right">Adelantos</th><th class="th-right">Total</th><th>Método</th><th>Estado</th>
      </tr></thead><tbody>
      ${(pagos||[]).map(p => `<tr>
        <td>${fmtDate(p.fecha)}</td>
        <td class="td-right td-money">${fmt(p.salario_base)}</td>
        <td class="td-right td-money">${fmt(p.bonificaciones)}</td>
        <td class="td-right td-money">${fmt(p.deducciones)}</td>
        <td class="td-right td-money">${fmt(p.adelantos_descontados)}</td>
        <td class="td-right td-money" style="font-weight:700">${fmt(p.total_pagado)}</td>
        <td>${esc(p.metodo_pago_nombre||'—')}</td>
        <td><span class="status-badge badge-${p.estado==='pagado'?'pagado':'pendiente'}">${p.estado==='pagado'?'Pagado':'Pendiente'}</span></td>
      </tr>`).join('') || '<tr><td colspan="8" class="empty-cell">Sin pagos registrados todavía</td></tr>'}
      </tbody></table></div>

      <div class="nc-paso-title" style="margin-top:16px">Adelantos</div>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th class="th-right">Monto</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>
      ${(adelantos||[]).map(a => `<tr>
        <td>${fmtDate(a.fecha)}</td>
        <td class="td-right td-money">${fmt(a.monto)}</td>
        <td>${esc(a.motivo||'—')}</td>
        <td><span class="status-badge ${a.estado==='pendiente'?'badge-pendiente':'badge-pagado'}">${a.estado==='pendiente'?'Pendiente':'Descontado'}</span></td>
      </tr>`).join('') || '<tr><td colspan="4" class="empty-cell">Sin adelantos registrados</td></tr>'}
      </tbody></table></div>
    `;
    body.innerHTML = html;
  } catch (e) {
    console.error('verHistorialEmpleado:', e);
    body.innerHTML = 'No se pudo cargar el historial.';
  }
}
function abrirPagarDesdeHistorial() {
  const emp = STATE.empleadoActual;
  closeModal('modal-historial-empleado');
  if (emp) abrirPagarDesdeTabla(emp.id);
}
function abrirAdelantoDesdeHistorial() {
  const emp = STATE.empleadoActual;
  closeModal('modal-historial-empleado');
  if (emp) abrirAdelanto(emp.id);
}

/* =====================================================
   ADELANTOS
===================================================== */
function abrirAdelanto(empleadoId) {
  const emp = STATE.empleados.find(e => e.id === empleadoId);
  if (!emp) return;
  STATE.empleadoActual = emp;
  document.getElementById('adel-empleado-nombre').textContent = emp.nombre;
  document.getElementById('adel-monto').value = '';
  document.getElementById('adel-fecha').value = todayISO();
  document.getElementById('adel-motivo').value = '';
  document.getElementById('adel-error').textContent = '';
  openModal('modal-adelanto');
}
async function guardarAdelanto() {
  const errEl = document.getElementById('adel-error');
  errEl.textContent = '';
  const emp = STATE.empleadoActual;
  if (!emp) return;
  const monto = round2(parseFloat(document.getElementById('adel-monto').value));
  if (!(monto > 0)) { errEl.textContent = 'El monto debe ser mayor a cero.'; return; }
  const fecha = document.getElementById('adel-fecha').value || todayISO();
  const motivo = document.getElementById('adel-motivo').value.trim() || null;

  setBtnLoading('btn-guardar-adelanto', true);
  try {
    const { data: adel, error } = await sbClient.from('empleados_adelantos').insert({
      auth_user_id: STATE.userId, empleado_id: emp.id, monto, fecha, motivo, estado: 'pendiente',
    }).select().single();
    if (error) throw error;

    // Un adelanto es dinero real que sale de Caja en ese momento —
    // después, al pagar el salario, se descuenta lo ya adelantado del
    // monto final (eso ya funcionaba); lo que faltaba era registrar
    // ESTA salida real de dinero cuando se entrega el adelanto.
    if (window.CajaAPI) {
      const cajaRes = await window.CajaAPI.registrarMovimiento({
        auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'PAGO_SALARIO',
        concepto: `Adelanto de salario — ${emp.nombre}${motivo ? ': '+motivo : ''}`,
        monto, referencia_tipo: 'empleado', referencia_id: adel.id, fecha,
      });
      if (!cajaRes.ok) showToast('El adelanto se registró, pero no se pudo descontar de Caja: ' + cajaRes.error, 'error');
    }

    showToast('Adelanto registrado y descontado de Caja');
    closeModal('modal-adelanto');
    await loadKPIsSal();
  } catch (e) {
    console.error('guardarAdelanto:', e);
    errEl.textContent = 'Error al registrar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-adelanto', false);
  }
}

/* =====================================================
   REGISTRAR PAGO
===================================================== */
async function abrirPagarDesdeTabla(empleadoId) {
  const emp = STATE.empleados.find(e => e.id === empleadoId);
  if (!emp) return;
  STATE.empleadoActual = emp;
  STATE.bonos = [];
  STATE.deducciones = [];
  STATE.aportesPatronales = [];

  // Se calculan solos los conceptos activos configurados en "Conceptos
  // de Nómina" para el país de este empleado — quedan como deducciones
  // normales (editables/quitables), nunca se imponen sin que se vean.
  if (!STATE.conceptos.length) await cargarConceptos();
  const base = Number(emp.salario||0);
  STATE.conceptos.filter(c => c.activo && c.tipo === 'deduccion').forEach(c => {
    const monto = calcularConcepto(c, base);
    if (monto > 0) STATE.deducciones.push({ descripcion: `${c.nombre} (automático)`, monto, esConcepto: true });
  });
  STATE.conceptos.filter(c => c.activo && c.tipo === 'aporte_patronal').forEach(c => {
    const monto = calcularConcepto(c, base);
    if (monto > 0) STATE.aportesPatronales.push({ descripcion: c.nombre, monto });
  });

  document.getElementById('pg-sal-empleado-nombre').textContent = emp.nombre;
  document.getElementById('pg-sal-base').textContent = fmt(emp.salario);
  document.getElementById('pg-sal-bono-desc').value = '';
  document.getElementById('pg-sal-bono-monto').value = '';
  document.getElementById('pg-sal-deduccion-desc').value = '';
  document.getElementById('pg-sal-deduccion-monto').value = '';
  document.getElementById('pg-sal-observaciones').value = '';
  document.getElementById('pg-sal-fecha').value = todayISO();
  document.getElementById('pg-sal-error').textContent = '';
  populateMetodosSelectSal();
  renderBonosSal();
  renderDeduccionesSal();
  renderAportesPatronalesSal();

  try {
    const { data: adelantos } = await sbClient.from('empleados_adelantos').select('*')
      .eq('empleado_id', emp.id).eq('estado', 'pendiente').order('fecha');
    STATE.adelantosPendientes = adelantos || [];
  } catch (e) { STATE.adelantosPendientes = []; }

  const wrap = document.getElementById('pg-sal-adelantos-wrap');
  const check = document.getElementById('pg-sal-descontar-adelantos');
  if (STATE.adelantosPendientes.length) {
    wrap.style.display = 'block';
    check.checked = false;
    document.getElementById('pg-sal-adelantos-lista').innerHTML = STATE.adelantosPendientes.map(a =>
      `<div class="resumen-fila"><span class="resumen-label">${fmtDate(a.fecha)}${a.motivo?' — '+esc(a.motivo):''}</span><span class="resumen-val">${fmt(a.monto)}</span></div>`
    ).join('');
  } else {
    wrap.style.display = 'none';
  }

  recalcularTotalPagoSal();
  openModal('modal-pagar-sal');
}
function populateMetodosSelectSal() {
  const opciones = (STATE.metodosPago.length?STATE.metodosPago:[{id:null,nombre:'Efectivo',es_default:true}])
    .map(m => `<option value="${m.id||''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  const def = STATE.metodosPago.find(m => m.es_default);
  const sel = document.getElementById('pg-sal-metodo');
  if (sel) { sel.innerHTML = opciones; if (def) sel.value = def.id || ''; }
}

function renderBonosSal() {
  const cont = document.getElementById('pg-sal-bonos-lista');
  cont.innerHTML = STATE.bonos.length ? STATE.bonos.map((b, idx) => `
    <div class="resumen-fila">
      <span class="resumen-label">${esc(b.descripcion)}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span class="resumen-val">${fmt(b.monto)}</span>
        <button class="btn-icon btn-icon-danger" onclick="eliminarBonoSal(${idx})" title="Quitar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </span>
    </div>`).join('') : '<p style="font-size:12px;color:var(--text-muted);padding:4px 0">Sin bonificaciones agregadas</p>';
}
function agregarBonoSal() {
  const desc = document.getElementById('pg-sal-bono-desc').value.trim();
  const monto = round2(parseFloat(document.getElementById('pg-sal-bono-monto').value));
  if (!desc || !(monto > 0)) { showToast('Escribe una descripción y un monto válido', 'error'); return; }
  STATE.bonos.push({ descripcion: desc, monto });
  document.getElementById('pg-sal-bono-desc').value = '';
  document.getElementById('pg-sal-bono-monto').value = '';
  renderBonosSal();
  recalcularTotalPagoSal();
}
function eliminarBonoSal(idx) { STATE.bonos.splice(idx,1); renderBonosSal(); recalcularTotalPagoSal(); }

function renderDeduccionesSal() {
  const cont = document.getElementById('pg-sal-deducciones-lista');
  cont.innerHTML = STATE.deducciones.length ? STATE.deducciones.map((d, idx) => `
    <div class="resumen-fila">
      <span class="resumen-label">${esc(d.descripcion)}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span class="resumen-val" style="color:var(--danger)">${fmt(d.monto)}</span>
        <button class="btn-icon btn-icon-danger" onclick="eliminarDeduccionSal(${idx})" title="Quitar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </span>
    </div>`).join('') : '<p style="font-size:12px;color:var(--text-muted);padding:4px 0">Sin deducciones agregadas</p>';
}
function agregarDeduccionSal() {
  const desc = document.getElementById('pg-sal-deduccion-desc').value.trim();
  const monto = round2(parseFloat(document.getElementById('pg-sal-deduccion-monto').value));
  if (!desc || !(monto > 0)) { showToast('Escribe una descripción y un monto válido', 'error'); return; }
  STATE.deducciones.push({ descripcion: desc, monto });
  document.getElementById('pg-sal-deduccion-desc').value = '';
  document.getElementById('pg-sal-deduccion-monto').value = '';
  renderDeduccionesSal();
  recalcularTotalPagoSal();
}
function eliminarDeduccionSal(idx) { STATE.deducciones.splice(idx,1); renderDeduccionesSal(); recalcularTotalPagoSal(); }

// Los aportes patronales son informativos aquí — el negocio los paga
// aparte (no se le descuentan al empleado), así que no afectan el
// total a pagar, pero sí quedan guardados para saber el costo real
// de esa persona para el negocio.
function renderAportesPatronalesSal() {
  const cont = document.getElementById('pg-sal-aportes-lista');
  if (!cont) return;
  if (!STATE.aportesPatronales.length) { cont.parentElement.style.display = 'none'; return; }
  cont.parentElement.style.display = '';
  const total = STATE.aportesPatronales.reduce((s,a)=>s+a.monto,0);
  cont.innerHTML = STATE.aportesPatronales.map(a => `
    <div class="resumen-fila"><span class="resumen-label">${esc(a.descripcion)}</span><span class="resumen-val">${fmt(a.monto)}</span></div>
  `).join('') + `<div class="resumen-fila" style="font-weight:700;border-top:1px solid var(--border);padding-top:6px;margin-top:4px"><span>Costo adicional para el negocio</span><span>${fmt(total)}</span></div>`;
}

function recalcularTotalPagoSal() {
  const emp = STATE.empleadoActual;
  if (!emp) return;
  const base = Number(emp.salario||0);
  const totalBonos = STATE.bonos.reduce((s,b)=>s+b.monto, 0);
  const totalDeducciones = STATE.deducciones.reduce((s,d)=>s+d.monto, 0);
  const descontar = document.getElementById('pg-sal-descontar-adelantos')?.checked;
  const totalAdelantos = descontar ? STATE.adelantosPendientes.reduce((s,a)=>s+Number(a.monto||0), 0) : 0;
  const total = round2(base + totalBonos - totalDeducciones - totalAdelantos);

  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('pg-sal-resumen-base', fmt(base));
  set('pg-sal-resumen-bonos', totalBonos>0?fmt(totalBonos):'—');
  set('pg-sal-resumen-deducciones', totalDeducciones>0?`-${fmt(totalDeducciones)}`:'—');
  set('pg-sal-resumen-adelantos', totalAdelantos>0?`-${fmt(totalAdelantos)}`:'—');
  set('pg-sal-resumen-total', fmt(total));
}

async function confirmarPagoSal() {
  const errEl = document.getElementById('pg-sal-error');
  errEl.textContent = '';
  const emp = STATE.empleadoActual;
  if (!emp) return;

  const base = Number(emp.salario||0);
  const totalBonos = round2(STATE.bonos.reduce((s,b)=>s+b.monto, 0));
  const totalDeducciones = round2(STATE.deducciones.reduce((s,d)=>s+d.monto, 0));
  const descontarAdelantos = document.getElementById('pg-sal-descontar-adelantos')?.checked || false;
  const totalAdelantos = descontarAdelantos ? round2(STATE.adelantosPendientes.reduce((s,a)=>s+Number(a.monto||0), 0)) : 0;
  const total = round2(base + totalBonos - totalDeducciones - totalAdelantos);

  if (total <= 0) { errEl.textContent = 'El total a pagar debe ser mayor a cero.'; return; }

  const metodoSel = document.getElementById('pg-sal-metodo');
  const metodoId = metodoSel?.value || null;
  const metodoNombre = metodoSel?.selectedOptions[0]?.dataset.nombre || 'Efectivo';
  const fecha = document.getElementById('pg-sal-fecha').value || todayISO();
  const observaciones = document.getElementById('pg-sal-observaciones').value.trim() || null;

  setBtnLoading('btn-confirmar-pago-sal', true);
  try {
    const comprobanteNumero = `SAL-${Date.now().toString().slice(-8)}`;
    const totalAportesPatronales = round2((STATE.aportesPatronales||[]).reduce((s,a)=>s+a.monto, 0));
    const { data: pago, error: errPago } = await sbClient.from('empleados_pagos').insert({
      auth_user_id: STATE.userId, empleado_id: emp.id, fecha,
      salario_base: base, bonificaciones: totalBonos, bonificaciones_detalle: STATE.bonos,
      deducciones: totalDeducciones, deducciones_detalle: STATE.deducciones,
      adelantos_descontados: totalAdelantos, total_pagado: total,
      aportes_patronales: totalAportesPatronales, aportes_patronales_detalle: STATE.aportesPatronales||[],
      metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre, observaciones,
      estado: 'pagado', comprobante_numero: comprobanteNumero,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail?.split('@')[0] || 'Usuario',
    }).select().single();
    if (errPago) throw errPago;

    // Marca los adelantos como descontados (si el usuario aceptó)
    if (descontarAdelantos && STATE.adelantosPendientes.length) {
      await sbClient.from('empleados_adelantos')
        .update({ estado: 'descontado', pago_id: pago.id })
        .in('id', STATE.adelantosPendientes.map(a => a.id));
    }

    // Egreso en Caja — NUNCA se omite, sea cual sea el monto
    const cajaRes = await window.CajaAPI.registrarMovimiento({
      auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'PAGO_SALARIO',
      concepto: `Pago de salario a ${emp.nombre}`, monto: total,
      metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
      referencia_tipo: 'salario', referencia_id: pago.id, observaciones, fecha,
    });
    if (!cajaRes.ok) showToast('El pago se guardó, pero no se pudo registrar en Caja: ' + cajaRes.error, 'error');

    // Actualiza último pago / próximo pago del empleado
    const proximoPago = sumarPeriodoSalario(fecha, emp.tipo_salario, 1);
    await sbClient.from('empleados').update({
      ultimo_pago: fecha, proximo_pago: proximoPago, updated_at: new Date().toISOString(),
    }).eq('id', emp.id);

    showToast('Pago registrado correctamente');
    closeModal('modal-pagar-sal');
    mostrarComprobanteSal({
      titulo: 'Pago de salario', numero: comprobanteNumero, empleado: emp.nombre, cargo: emp.cargo || '—',
      fecha, base, bonos: totalBonos, deducciones: totalDeducciones, adelantos: totalAdelantos, total,
      observaciones, usuario: STATE.currentUser?.nombre || STATE.userEmail,
    });
    await Promise.allSettled([loadEmpleados(), loadKPIsSal()]);
  } catch (e) {
    console.error('confirmarPagoSal:', e);
    errEl.textContent = 'Error al registrar el pago: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-confirmar-pago-sal', false);
  }
}

/* =====================================================
   COMPROBANTE
===================================================== */
function mostrarComprobanteSal(c) {
  STATE.ultimoComprobante = c;
  document.getElementById('comprobante-sal-body').innerHTML = `
    <div class="ticket-print">
      <div style="text-align:center;font-weight:800;margin-bottom:4px">${esc(STATE.empresaConfig?.nombre_comercial || 'Negocio360')}</div>
      <div style="text-align:center;color:var(--text-muted);margin-bottom:8px">${esc(c.titulo)}</div>
      <hr/>
      <div class="tp-row"><span>N° comprobante:</span><b>${esc(c.numero)}</b></div>
      <div class="tp-row"><span>Empleado:</span><b>${esc(c.empleado)}</b></div>
      <div class="tp-row"><span>Cargo:</span><b>${esc(c.cargo)}</b></div>
      <div class="tp-row"><span>Fecha:</span><b>${fmtDate(c.fecha)}</b></div>
      <hr/>
      <div class="tp-row"><span>Salario base:</span><b>${fmt(c.base)}</b></div>
      <div class="tp-row"><span>Bonificaciones:</span><b>${fmt(c.bonos)}</b></div>
      <div class="tp-row"><span>Deducciones:</span><b>-${fmt(c.deducciones)}</b></div>
      <div class="tp-row"><span>Adelantos descontados:</span><b>-${fmt(c.adelantos)}</b></div>
      <hr/>
      <div class="tp-row"><span>Total pagado:</span><b>${fmt(c.total)}</b></div>
      ${c.observaciones ? `<div class="tp-row"><span>Observaciones:</span><b>${esc(c.observaciones)}</b></div>` : ''}
    </div>`;
  openModal('modal-comprobante-sal');
}
function imprimirComprobanteSal() {
  const html = document.getElementById('comprobante-sal-body').innerHTML;
  const w = window.open('', '_blank', 'width=380,height=600');
  w.document.write(`<html><head><meta charset="UTF-8"><title>Comprobante</title>
    <style>body{font-family:'JetBrains Mono',monospace;font-size:12.5px;padding:16px}.tp-row{display:flex;justify-content:space-between;gap:10px}hr{border:none;border-top:1px dashed #999;margin:8px 0}</style>
    </head><body>${html}<script>window.print();</script></body></html>`);
  w.document.close();
}

/* =====================================================
   MODAL / TOAST / UI HELPERS (idénticos al resto del sistema)
===================================================== */
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
   INIT
===================================================== */
/* =====================================================
   CONCEPTOS DE NÓMINA — motor genérico de deducciones/aportes.
   Cada negocio configura los suyos según su país; el sistema no
   asume ninguna ley específica de por sí, solo ofrece plantillas
   opcionales como punto de partida.
===================================================== */
STATE.conceptos = [];

async function abrirConceptosNomina() {
  openModal('modal-conceptos-nomina');
  await cargarConceptos();
}
async function cargarConceptos() {
  try {
    const { data } = await sbClient.from('nomina_conceptos').select('*')
      .eq('auth_user_id', STATE.userId).order('orden');
    STATE.conceptos = data || [];
    renderConceptos();
  } catch (e) { console.warn('cargarConceptos:', e); }
}
function renderConceptos() {
  const tbody = document.getElementById('conceptos-tbody');
  if (!tbody) return;
  if (!STATE.conceptos.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Todavía no has configurado ningún concepto — carga una plantilla o agrega uno personalizado.</td></tr>`;
    return;
  }
  const metodoLabel = { porcentaje: c => `${c.valor}%`, monto_fijo: c => fmt(c.valor), tabla_progresiva: () => 'Tabla progresiva' };
  tbody.innerHTML = STATE.conceptos.map(c => `
    <tr>
      <td style="font-weight:600">${esc(c.nombre)}${c.obligatorio ? ' <span style="font-size:10.5px;color:var(--text-muted)">(por ley)</span>' : ''}</td>
      <td>${c.tipo === 'deduccion' ? 'Deducción' : 'Aporte patronal'}</td>
      <td>${metodoLabel[c.metodo_calculo] ? metodoLabel[c.metodo_calculo](c) : '—'}</td>
      <td><label class="switch-mini"><input type="checkbox" ${c.activo?'checked':''} onchange="toggleConceptoActivo('${c.id}', this.checked)"/></label></td>
      <td class="td-actions">
        <button class="btn-icon" title="Editar" onclick="abrirEditarConcepto('${c.id}')">✏️</button>
        <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="eliminarConcepto('${c.id}')">🗑️</button>
      </td>
    </tr>`).join('');
}
async function toggleConceptoActivo(id, activo) {
  try {
    await sbClient.from('nomina_conceptos').update({ activo, updated_at:new Date().toISOString() }).eq('id', id).eq('auth_user_id', STATE.userId);
    const c = STATE.conceptos.find(x=>x.id===id); if (c) c.activo = activo;
  } catch (e) { showToast('No se pudo actualizar', 'error'); }
}
async function eliminarConcepto(id) {
  if (!confirm('¿Eliminar este concepto? Ya no se aplicará en los próximos pagos (los pagos ya hechos no cambian).')) return;
  try {
    await sbClient.from('nomina_conceptos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    showToast('Concepto eliminado');
    await cargarConceptos();
  } catch (e) { showToast('Error al eliminar', 'error'); }
}

// Plantillas por país — solo son un punto de partida editable, nunca
// se aplican solas ni se imponen: el negocio elige cargarlas y puede
// modificar o borrar cualquier concepto después.
const PLANTILLAS_PAIS = {
  NI: {
    nombre: 'Nicaragua',
    conceptos: [
      { nombre: 'INSS Laboral', tipo: 'deduccion', metodo_calculo: 'porcentaje', valor: 7, obligatorio: true },
      // 21.5% aplica a empresas con MENOS de 50 trabajadores (la gran
      // mayoría de negocios) — si el negocio tiene 50 o más, debe
      // cambiarlo a mano a 22.5% desde "Editar" en Conceptos de Nómina.
      { nombre: 'INSS Patronal', tipo: 'aporte_patronal', metodo_calculo: 'porcentaje', valor: 21.5, obligatorio: true },
      { nombre: 'INATEC', tipo: 'aporte_patronal', metodo_calculo: 'porcentaje', valor: 2, obligatorio: true },
      { nombre: 'IR sobre salarios', tipo: 'deduccion', metodo_calculo: 'tabla_progresiva', obligatorio: true,
        tabla_progresiva: [
          { hasta: 100000, tasa: 0 },
          { hasta: 200000, tasa: 15 },
          { hasta: 350000, tasa: 20 },
          { hasta: 500000, tasa: 25 },
          { hasta: null,   tasa: 30 },
        ] },
    ],
  },
};
async function cargarPlantillaConceptos(pais) {
  const plantilla = PLANTILLAS_PAIS[pais];
  if (!plantilla) { showToast('Todavía no hay plantilla para ese país', 'error'); return; }
  if (!confirm(`Se agregarán ${plantilla.conceptos.length} conceptos típicos de ${plantilla.nombre}. Podrás editarlos o borrarlos después. ¿Continuar?`)) return;
  try {
    // Nunca se duplica: si ya existe un concepto con el mismo nombre
    // (sin importar mayúsculas), se actualiza ese en vez de crear uno
    // nuevo — antes, cargar la plantilla 2 veces sumaba el doble de
    // deducciones al pago.
    const { data: existentes } = await sbClient.from('nomina_conceptos').select('id, nombre').eq('auth_user_id', STATE.userId);
    const mapaExistentes = new Map((existentes||[]).map(e => [e.nombre.toLowerCase().trim(), e.id]));

    let creados = 0, actualizados = 0;
    for (let i = 0; i < plantilla.conceptos.length; i++) {
      const c = plantilla.conceptos[i];
      const payloadC = {
        nombre: c.nombre, tipo: c.tipo, metodo_calculo: c.metodo_calculo,
        valor: c.valor || null, tabla_progresiva: c.tabla_progresiva || null,
        obligatorio: c.obligatorio, pais_plantilla: pais, updated_at: new Date().toISOString(),
      };
      const idExistente = mapaExistentes.get(c.nombre.toLowerCase().trim());
      if (idExistente) {
        await sbClient.from('nomina_conceptos').update(payloadC).eq('id', idExistente).eq('auth_user_id', STATE.userId);
        actualizados++;
      } else {
        await sbClient.from('nomina_conceptos').insert({ auth_user_id: STATE.userId, activo: true, orden: i, ...payloadC });
        creados++;
      }
    }

    // Cada concepto (deducción o aporte) también se refleja en el
    // catálogo de Impuestos que ya usan Ventas/Créditos/Proformas —
    // si ya existe uno con ese mismo nombre, NUNCA se duplica, se
    // actualiza el existente.
    for (const c of plantilla.conceptos) {
      try {
        await sbClient.rpc('sincronizar_concepto_a_impuestos', {
          p_nombre: c.nombre, p_tipo_valor: c.metodo_calculo === 'monto_fijo' ? 'fijo' : c.metodo_calculo,
          p_valor: c.valor || null, p_tabla_progresiva: c.tabla_progresiva || null, p_pais: pais,
        });
      } catch (eSync) { console.warn('No se pudo sincronizar a Impuestos:', c.nombre, eSync); }
    }

    showToast(`Plantilla de ${plantilla.nombre}: ${creados} concepto(s) nuevo(s), ${actualizados} actualizado(s) — nunca duplicados`);
    await cargarConceptos();
  } catch (e) { showToast('Error al cargar la plantilla', 'error'); }
}

let CONCEPTO_TRAMOS = [];
function abrirNuevoConcepto() {
  document.getElementById('con-modal-title').textContent = 'Nuevo concepto';
  document.getElementById('con-id').value = '';
  document.getElementById('con-nombre').value = '';
  document.getElementById('con-tipo').value = 'deduccion';
  document.getElementById('con-metodo').value = 'porcentaje';
  document.getElementById('con-valor').value = '';
  document.getElementById('con-obligatorio').checked = false;
  document.getElementById('con-error').textContent = '';
  CONCEPTO_TRAMOS = [{ hasta: '', tasa: '' }];
  toggleMetodoConceptoUI();
  renderTramosConcepto();
  openModal('modal-nuevo-concepto');
}
function abrirEditarConcepto(id) {
  const c = STATE.conceptos.find(x => x.id === id);
  if (!c) return;
  document.getElementById('con-modal-title').textContent = 'Editar concepto';
  document.getElementById('con-id').value = c.id;
  document.getElementById('con-nombre').value = c.nombre;
  document.getElementById('con-tipo').value = c.tipo;
  document.getElementById('con-metodo').value = c.metodo_calculo;
  document.getElementById('con-valor').value = c.valor || '';
  document.getElementById('con-obligatorio').checked = !!c.obligatorio;
  document.getElementById('con-error').textContent = '';
  CONCEPTO_TRAMOS = c.tabla_progresiva && c.tabla_progresiva.length ? c.tabla_progresiva.map(t => ({ hasta: t.hasta ?? '', tasa: t.tasa })) : [{ hasta:'', tasa:'' }];
  toggleMetodoConceptoUI();
  renderTramosConcepto();
  openModal('modal-nuevo-concepto');
}
function toggleMetodoConceptoUI() {
  const metodo = document.getElementById('con-metodo').value;
  document.getElementById('con-valor-wrap').style.display = metodo === 'tabla_progresiva' ? 'none' : '';
  document.getElementById('con-tabla-wrap').style.display = metodo === 'tabla_progresiva' ? '' : 'none';
  document.getElementById('con-valor-label').textContent = metodo === 'porcentaje' ? 'Porcentaje (%)' : 'Monto fijo';
}
function renderTramosConcepto() {
  const cont = document.getElementById('con-tabla-tramos');
  cont.innerHTML = CONCEPTO_TRAMOS.map((t, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <input type="number" placeholder="Hasta (vacío = sin límite)" value="${t.hasta}" style="flex:1" onchange="CONCEPTO_TRAMOS[${i}].hasta = this.value ? parseFloat(this.value) : null"/>
      <input type="number" placeholder="Tasa %" value="${t.tasa}" style="width:90px" onchange="CONCEPTO_TRAMOS[${i}].tasa = parseFloat(this.value)||0"/>
      <button type="button" class="btn-icon btn-icon-danger" onclick="CONCEPTO_TRAMOS.splice(${i},1); renderTramosConcepto();">🗑️</button>
    </div>`).join('');
}
function agregarTramoConcepto() { CONCEPTO_TRAMOS.push({ hasta:'', tasa:'' }); renderTramosConcepto(); }

async function guardarConcepto() {
  const errEl = document.getElementById('con-error');
  errEl.textContent = '';
  const id = document.getElementById('con-id').value || null;
  const nombre = document.getElementById('con-nombre').value.trim();
  const tipo = document.getElementById('con-tipo').value;
  const metodo = document.getElementById('con-metodo').value;
  if (!nombre) { errEl.textContent = 'El nombre es requerido.'; return; }

  const payload = {
    nombre, tipo, metodo_calculo: metodo,
    valor: metodo !== 'tabla_progresiva' ? (parseFloat(document.getElementById('con-valor').value) || 0) : null,
    tabla_progresiva: metodo === 'tabla_progresiva' ? CONCEPTO_TRAMOS.filter(t => t.tasa !== '' && t.tasa != null) : null,
    obligatorio: document.getElementById('con-obligatorio').checked,
    updated_at: new Date().toISOString(),
  };
  setBtnLoading('btn-guardar-concepto', true);
  try {
    if (id) {
      await sbClient.from('nomina_conceptos').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
    } else {
      payload.activo = true; payload.orden = STATE.conceptos.length;
      await sbClient.from('nomina_conceptos').insert({ auth_user_id: STATE.userId, ...payload });
    }

    // También se refleja en el catálogo de Impuestos — sin duplicar
    // si ya existe uno con el mismo nombre.
    try {
      await sbClient.rpc('sincronizar_concepto_a_impuestos', {
        p_nombre: nombre, p_tipo_valor: metodo === 'monto_fijo' ? 'fijo' : metodo,
        p_valor: payload.valor, p_tabla_progresiva: payload.tabla_progresiva,
        p_pais: document.getElementById('emp-pais')?.value || null,
      });
    } catch (eSync) { console.warn('No se pudo sincronizar a Impuestos:', eSync); }

    showToast('Concepto guardado — también visible en Impuestos');
    closeModal('modal-nuevo-concepto');
    await cargarConceptos();
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-concepto', false);
  }
}

// Aplica un concepto sobre un monto base — usado al calcular un pago.
function calcularConcepto(concepto, montoBase) {
  if (concepto.metodo_calculo === 'porcentaje') return round2(montoBase * (Number(concepto.valor)||0) / 100);
  if (concepto.metodo_calculo === 'monto_fijo') return round2(Number(concepto.valor)||0);
  if (concepto.metodo_calculo === 'tabla_progresiva') {
    const tramos = concepto.tabla_progresiva || [];
    for (const t of tramos) {
      if (t.hasta == null || montoBase <= Number(t.hasta)) return round2(montoBase * (Number(t.tasa)||0) / 100);
    }
    return 0;
  }
  return 0;
}

/* =====================================================
   FASE 3 — PLANILLA: pagar a todo el equipo de una sola vez.
   Reutiliza exactamente el mismo cálculo de conceptos que ya usa el
   pago individual — nunca una fórmula aparte.
===================================================== */
STATE.planillas = [];
STATE.planillaSeleccion = new Map(); // empleado_id -> {incluido, base, deducciones, total}

async function abrirPlanillas() {
  document.getElementById('panel-planillas').style.display = '';
  await cargarPlanillas();
}
async function cargarPlanillas() {
  try {
    const { data } = await sbClient.from('nomina_planillas').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending:false });
    STATE.planillas = data || [];
    renderPlanillas();
  } catch (e) { console.warn('cargarPlanillas:', e); }
}
function renderPlanillas() {
  const tbody = document.getElementById('planillas-tbody');
  if (!tbody) return;
  if (!STATE.planillas.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Todavía no has creado ninguna planilla</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.planillas.map(p => `
    <tr>
      <td style="font-weight:600">${esc(p.nombre)}</td>
      <td>${fmtDate(p.periodo_desde)} — ${fmtDate(p.periodo_hasta)}</td>
      <td>${fmtDate(p.fecha_pago)}</td>
      <td>${p.total_empleados}</td>
      <td>${fmt(p.total_pagado)}</td>
      <td><span class="status-badge ${p.estado==='pagada'?'badge-activo':'badge-pendiente'}">${p.estado==='pagada'?'Pagada':'Borrador'}</span></td>
      <td class="td-actions">${p.estado==='pagada' ? `<button class="btn-icon" title="Descargar planilla" onclick="abrirExportarPlanilla('${p.id}')">📄</button>` : ''}</td>
    </tr>`).join('');
}

async function abrirNuevaPlanilla() {
  document.getElementById('pl-nombre').value = '';
  const hoy = new Date();
  document.getElementById('pl-desde').value = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  document.getElementById('pl-hasta').value = todayISO();
  document.getElementById('pl-fecha-pago').value = todayISO();
  document.getElementById('pl-error').textContent = '';
  STATE.planillaSeleccion = new Map();
  openModal('modal-nueva-planilla');
  document.getElementById('pl-lista-empleados').innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:12.5px">Calculando deducciones…</div>';
  // Antes esto se saltaba si STATE.conceptos todavía estaba vacío (por
  // ejemplo, al entrar directo a Planilla sin haber abierto antes
  // "Conceptos de Nómina" o un pago individual) — la planilla salía
  // sin ninguna deducción aplicada, a diferencia del pago individual.
  await cargarConceptos();
  renderListaEmpleadosPlanilla();
}

function renderListaEmpleadosPlanilla() {
  const cont = document.getElementById('pl-lista-empleados');
  const activos = STATE.empleados.filter(e => e.estado === 'activo');
  if (!activos.length) { cont.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:12.5px">No hay empleados activos</div>'; return; }

  cont.innerHTML = activos.map(e => {
    const base = Number(e.salario||0);
    let deducciones = 0;
    STATE.conceptos.filter(c => c.activo && c.tipo === 'deduccion').forEach(c => { deducciones += calcularConcepto(c, base); });
    const total = round2(base - deducciones);
    STATE.planillaSeleccion.set(e.id, { incluido: true, nombre: e.nombre, base, deducciones: round2(deducciones), total });
    return `
    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px">
      <input type="checkbox" checked onchange="togglePlanillaEmpleado('${e.id}', this.checked)"/>
      <span style="flex:1">${esc(e.nombre)} <span style="color:var(--text-muted);font-size:11.5px">${esc(e.cargo||'')}</span></span>
      <span style="color:var(--text-muted);font-size:12px">Base: ${fmt(base)}</span>
      ${deducciones>0 ? `<span style="color:var(--danger);font-size:12px">-${fmt(deducciones)}</span>` : ''}
      <span style="font-weight:700">${fmt(total)}</span>
    </label>`;
  }).join('');
  actualizarTotalPlanilla();
}
function togglePlanillaEmpleado(id, incluido) {
  const s = STATE.planillaSeleccion.get(id); if (s) s.incluido = incluido;
  actualizarTotalPlanilla();
}
function actualizarTotalPlanilla() {
  const total = Array.from(STATE.planillaSeleccion.values()).filter(s=>s.incluido).reduce((s,x)=>s+x.total, 0);
  document.getElementById('pl-total-general').textContent = fmt(round2(total));
}

async function guardarPlanilla(pagar) {
  const errEl = document.getElementById('pl-error');
  errEl.textContent = '';
  const nombre = document.getElementById('pl-nombre').value.trim();
  const desde = document.getElementById('pl-desde').value;
  const hasta = document.getElementById('pl-hasta').value;
  const fechaPago = document.getElementById('pl-fecha-pago').value;
  if (!nombre) { errEl.textContent = 'Escribe un nombre para la planilla.'; return; }
  const incluidos = Array.from(STATE.planillaSeleccion.entries()).filter(([id,s]) => s.incluido);
  if (!incluidos.length) { errEl.textContent = 'Elige al menos un empleado.'; return; }

  const btnId = pagar ? 'btn-pagar-planilla' : 'btn-guardar-planilla-borrador';
  setBtnLoading(btnId, true);
  try {
    const totalGeneral = round2(incluidos.reduce((s,[,x])=>s+x.total, 0));
    const { data: planilla, error: errP } = await sbClient.from('nomina_planillas').insert({
      auth_user_id: STATE.userId, nombre, periodo_desde: desde, periodo_hasta: hasta, fecha_pago: fechaPago,
      estado: pagar ? 'pagada' : 'borrador', total_empleados: incluidos.length, total_pagado: totalGeneral,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail, pagada_en: pagar ? new Date().toISOString() : null,
    }).select().single();
    if (errP) throw errP;

    if (pagar) {
      // Un pago real por cada empleado — mismo mecanismo de siempre
      // (empleados_pagos), solo que agrupados bajo esta planilla.
      for (const [empId, s] of incluidos) {
        const deduccionesDetalle = [];
        STATE.conceptos.filter(c => c.activo && c.tipo === 'deduccion').forEach(c => {
          const monto = calcularConcepto(c, s.base);
          if (monto > 0) deduccionesDetalle.push({ descripcion: `${c.nombre} (automático)`, monto });
        });
        const aportesDetalle = [];
        STATE.conceptos.filter(c => c.activo && c.tipo === 'aporte_patronal').forEach(c => {
          const monto = calcularConcepto(c, s.base);
          if (monto > 0) aportesDetalle.push({ descripcion: c.nombre, monto });
        });
        const totalAportes = round2(aportesDetalle.reduce((sum,a)=>sum+a.monto,0));

        const { data: pagoRow } = await sbClient.from('empleados_pagos').insert({
          auth_user_id: STATE.userId, empleado_id: empId, fecha: fechaPago,
          salario_base: s.base, bonificaciones: 0, bonificaciones_detalle: [],
          deducciones: s.deducciones, deducciones_detalle: deduccionesDetalle,
          adelantos_descontados: 0, total_pagado: s.total,
          aportes_patronales: totalAportes, aportes_patronales_detalle: aportesDetalle,
          metodo_pago_nombre: 'Efectivo', estado: 'pagado',
          comprobante_numero: `SAL-${Date.now().toString().slice(-8)}-${empId.slice(0,4)}`,
          usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
          planilla_id: planilla.id,
        }).select().single();

        // Egreso en Caja por cada empleado — antes la planilla nunca
        // tocaba Caja, aunque el pago individual sí lo hacía siempre.
        if (window.CajaAPI && pagoRow) {
          const cajaRes = await window.CajaAPI.registrarMovimiento({
            auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'PAGO_SALARIO',
            concepto: `Pago de salario a ${s.nombre} — planilla ${nombre}`, monto: s.total,
            metodo_pago_nombre: 'Efectivo', referencia_tipo: 'salario', referencia_id: pagoRow.id, fecha: fechaPago,
          });
          if (!cajaRes.ok) console.error(`No se pudo descontar de Caja el pago de ${s.nombre}:`, cajaRes.error);
        }

        await sbClient.from('empleados').update({
          ultimo_pago: fechaPago,
          proximo_pago: sumarPeriodoSalario(fechaPago, STATE.empleados.find(e=>e.id===empId)?.tipo_salario||'mensual', 1),
        }).eq('id', empId).eq('auth_user_id', STATE.userId);
      }
    }

    showToast(pagar ? `Planilla pagada — ${incluidos.length} empleado(s), ${fmt(totalGeneral)}` : 'Planilla guardada como borrador');
    closeModal('modal-nueva-planilla');
    await Promise.allSettled([cargarPlanillas(), loadEmpleados(), loadKPIsSal()]);
  } catch (e) {
    console.error('guardarPlanilla:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading(btnId, false);
  }
}

/* =====================================================
   BONO ANUAL (Aguinaldo / 13er mes / 13th month / Prima...) —
   genérico: nombre, número de cuotas y fechas configurables, porque
   varía mucho de un país a otro. El cálculo es proporcional al
   tiempo trabajado desde el último pago de este mismo bono.
===================================================== */
STATE.bonoAnualConfig = null;

async function abrirBonoAnualConfig() {
  try {
    const { data } = await sbClient.from('nomina_bono_anual_config').select('*').eq('auth_user_id', STATE.userId).maybeSingle();
    STATE.bonoAnualConfig = data || { activo:false, nombre:'Aguinaldo', num_cuotas:1, fechas_pago:['12-10'] };
  } catch (e) { STATE.bonoAnualConfig = { activo:false, nombre:'Aguinaldo', num_cuotas:1, fechas_pago:['12-10'] }; }

  document.getElementById('ba-activo').checked = !!STATE.bonoAnualConfig.activo;
  document.getElementById('ba-nombre').value = STATE.bonoAnualConfig.nombre || 'Aguinaldo';
  document.getElementById('ba-num-cuotas').value = STATE.bonoAnualConfig.num_cuotas || 1;
  document.getElementById('ba-error').textContent = '';
  renderFechasBonoAnual();
  openModal('modal-bono-anual-config');
}
function renderFechasBonoAnual() {
  const num = parseInt(document.getElementById('ba-num-cuotas').value) || 1;
  const fechasActuales = STATE.bonoAnualConfig?.fechas_pago || ['12-10'];
  const cont = document.getElementById('ba-fechas-lista');
  cont.innerHTML = Array.from({length:num}, (_,i) => {
    const [mes,dia] = (fechasActuales[i] || '12-10').split('-');
    return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span style="font-size:12.5px;width:60px">Parte ${i+1}:</span>
      <select id="ba-fecha-mes-${i}" style="flex:1">
        ${['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => `<option value="${m}" ${m===mes?'selected':''}>${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][parseInt(m)-1]}</option>`).join('')}
      </select>
      <input type="number" id="ba-fecha-dia-${i}" min="1" max="31" value="${parseInt(dia)||10}" style="width:70px"/>
    </div>`;
  }).join('');
}
async function guardarBonoAnualConfig() {
  const errEl = document.getElementById('ba-error');
  errEl.textContent = '';
  const nombre = document.getElementById('ba-nombre').value.trim();
  if (!nombre) { errEl.textContent = 'Escribe un nombre para el bono.'; return; }
  const numCuotas = parseInt(document.getElementById('ba-num-cuotas').value) || 1;
  const fechas = Array.from({length:numCuotas}, (_,i) => {
    const mes = document.getElementById(`ba-fecha-mes-${i}`).value;
    const dia = String(parseInt(document.getElementById(`ba-fecha-dia-${i}`).value)||10).padStart(2,'0');
    return `${mes}-${dia}`;
  });
  setBtnLoading('btn-guardar-bono-config', true);
  try {
    await sbClient.from('nomina_bono_anual_config').upsert({
      auth_user_id: STATE.userId, nombre, activo: document.getElementById('ba-activo').checked,
      num_cuotas: numCuotas, fechas_pago: fechas, updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    showToast('Configuración de Bono Anual guardada');
    closeModal('modal-bono-anual-config');
    STATE.bonoAnualConfig = { activo: document.getElementById('ba-activo').checked, nombre, num_cuotas: numCuotas, fechas_pago: fechas };
  } catch (e) {
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-bono-config', false);
  }
}

let BONO_EMPLEADO_ACTUAL = null;
async function abrirPagarBonoAnual(empleadoId) {
  const emp = STATE.empleados.find(e => e.id === empleadoId);
  if (!emp) return;
  if (!STATE.bonoAnualConfig) {
    try {
      const { data } = await sbClient.from('nomina_bono_anual_config').select('*').eq('auth_user_id', STATE.userId).maybeSingle();
      STATE.bonoAnualConfig = data || null;
    } catch (e) { STATE.bonoAnualConfig = null; }
  }
  const cfg = STATE.bonoAnualConfig;
  if (!cfg || !cfg.activo) { showToast('El Bono Anual no está activado — actívalo primero desde el botón "Bono Anual"', 'error'); return; }

  // Se busca el último pago de este mismo bono, para calcular
  // proporcionalmente el período trabajado desde entonces (o desde
  // que ingresó, si nunca lo ha recibido).
  const { data: ultimoPago } = await sbClient.from('empleados_bono_anual_pagos')
    .select('*').eq('empleado_id', empleadoId).order('fecha', { ascending:false }).limit(1).maybeSingle();
  const desde = ultimoPago?.fecha || emp.fecha_ingreso || todayISO();
  const hasta = todayISO();
  const diasPeriodo = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000));
  const diasAnioProrrateo = Math.round(365 / (cfg.num_cuotas||1));
  const proporcion = Math.min(1, diasPeriodo / diasAnioProrrateo);
  const montoBase = round2((Number(emp.salario||0) / (cfg.num_cuotas||1)) * proporcion);
  const cuotaNumero = (ultimoPago?.cuota_numero || 0) % (cfg.num_cuotas||1) + 1;

  BONO_EMPLEADO_ACTUAL = { emp, desde, hasta, cuotaNumero };
  document.getElementById('pb-titulo').textContent = `Pagar ${cfg.nombre}`;
  document.getElementById('pb-empleado-nombre').textContent = emp.nombre;
  document.getElementById('pb-cuota-numero').textContent = `${cuotaNumero} de ${cfg.num_cuotas}`;
  document.getElementById('pb-periodo').textContent = `${fmtDate(desde)} — ${fmtDate(hasta)}`;
  document.getElementById('pb-monto').value = montoBase;
  document.getElementById('pb-fecha').value = todayISO();
  document.getElementById('pb-observaciones').value = '';
  document.getElementById('pb-error').textContent = '';
  openModal('modal-pagar-bono');
}
async function confirmarPagoBonoAnual() {
  const errEl = document.getElementById('pb-error');
  errEl.textContent = '';
  if (!BONO_EMPLEADO_ACTUAL) return;
  const { emp, desde, hasta, cuotaNumero } = BONO_EMPLEADO_ACTUAL;
  const monto = round2(parseFloat(document.getElementById('pb-monto').value));
  if (!(monto > 0)) { errEl.textContent = 'El monto debe ser mayor a cero.'; return; }
  const fecha = document.getElementById('pb-fecha').value || todayISO();

  setBtnLoading('btn-confirmar-bono', true);
  try {
    const { data: bonoRow, error } = await sbClient.from('empleados_bono_anual_pagos').insert({
      auth_user_id: STATE.userId, empleado_id: emp.id, fecha, periodo_desde: desde, periodo_hasta: hasta,
      monto, cuota_numero: cuotaNumero, metodo_pago_nombre: 'Efectivo',
      observaciones: document.getElementById('pb-observaciones').value.trim() || null,
      comprobante_numero: `BON-${Date.now().toString().slice(-8)}`,
      usuario_nombre: STATE.currentUser?.nombre || STATE.userEmail,
    }).select().single();
    if (error) throw error;

    if (window.CajaAPI) {
      const cajaRes = await window.CajaAPI.registrarMovimiento({
        auth_user_id: STATE.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'PAGO_SALARIO',
        concepto: `${STATE.bonoAnualConfig?.nombre || 'Bono anual'} — ${emp.nombre} (cuota ${cuotaNumero})`,
        monto, metodo_pago_nombre: 'Efectivo', referencia_tipo: 'salario', referencia_id: bonoRow.id, fecha,
      });
      if (!cajaRes.ok) showToast('El bono se registró, pero no se pudo descontar de Caja: ' + cajaRes.error, 'error');
    }

    showToast(`${STATE.bonoAnualConfig?.nombre || 'Bono'} pagado a ${emp.nombre} y descontado de Caja`);
    closeModal('modal-pagar-bono');
  } catch (e) {
    errEl.textContent = 'Error al registrar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-confirmar-bono', false);
  }
}

/* =====================================================
   EXPORTAR PLANILLA — PDF y Excel profesionales. Todo sale de los
   pagos YA registrados (empleados_pagos), nunca se recalcula nada al
   exportar, para que el documento sea exactamente lo que se pagó.
===================================================== */
STATE.planillaExportando = null;

async function abrirExportarPlanilla(planillaId) {
  try {
    const { data: planilla } = await sbClient.from('nomina_planillas').select('*').eq('id', planillaId).eq('auth_user_id', STATE.userId).maybeSingle();
    if (!planilla) { showToast('Planilla no encontrada', 'error'); return; }
    const { data: pagos } = await sbClient.from('empleados_pagos')
      .select('*, empleados(nombre, cedula, cargo)').eq('planilla_id', planillaId).eq('auth_user_id', STATE.userId).order('created_at');
    STATE.planillaExportando = { planilla, pagos: pagos || [] };
    document.getElementById('ep-formato').value = 'NI';
    openModal('modal-exportar-planilla');
  } catch (e) {
    console.error('abrirExportarPlanilla:', e);
    showToast('No se pudo cargar la planilla', 'error');
  }
}

// Junta los nombres únicos de conceptos (deducciones o aportes) que
// de verdad aparecen en los pagos de esta planilla — así las columnas
// del documento reflejan exactamente lo que se aplicó, ni más ni menos.
function conceptosUnicos(pagos, campoDetalle) {
  const nombres = new Set();
  pagos.forEach(p => (p[campoDetalle] || []).forEach(d => nombres.add(d.descripcion.replace(' (automático)', ''))));
  return Array.from(nombres);
}
function montoConcepto(detalle, nombreConcepto) {
  const item = (detalle || []).find(d => d.descripcion.replace(' (automático)', '') === nombreConcepto);
  return item ? Number(item.monto) : 0;
}

async function exportarPlanilla(formato) {
  const ctx = STATE.planillaExportando;
  if (!ctx) return;
  const { planilla, pagos } = ctx;
  const modoNicaragua = document.getElementById('ep-formato').value === 'NI';
  const bizName = STATE.empresaConfig?.nombre_comercial || STATE.currentUser?.nombre_negocio || 'Mi Negocio';

  const nombresDeducciones = conceptosUnicos(pagos, 'deducciones_detalle');
  const nombresAportes = conceptosUnicos(pagos, 'aportes_patronales_detalle');

  if (formato === 'excel') {
    const headers = ['#', 'Cédula', 'Nombre', 'Cargo', 'Salario Base',
      ...nombresDeducciones, 'Total Deducciones', 'Salario Neto',
      ...(modoNicaragua ? nombresAportes.map(n => `${n} (patronal)`) : []),
    ];
    const rows = pagos.map((p, i) => [
      i+1, p.empleados?.cedula || '—', p.empleados?.nombre || '—', p.empleados?.cargo || '—', Number(p.salario_base),
      ...nombresDeducciones.map(n => montoConcepto(p.deducciones_detalle, n)),
      Number(p.deducciones), Number(p.total_pagado),
      ...(modoNicaragua ? nombresAportes.map(n => montoConcepto(p.aportes_patronales_detalle, n)) : []),
    ]);
    const totales = ['', '', '', 'TOTALES', pagos.reduce((s,p)=>s+Number(p.salario_base),0),
      ...nombresDeducciones.map(n => pagos.reduce((s,p)=>s+montoConcepto(p.deducciones_detalle,n),0)),
      pagos.reduce((s,p)=>s+Number(p.deducciones),0), pagos.reduce((s,p)=>s+Number(p.total_pagado),0),
      ...(modoNicaragua ? nombresAportes.map(n => pagos.reduce((s,p)=>s+montoConcepto(p.aportes_patronales_detalle,n),0)) : []),
    ];
    const ws = XLSX.utils.aoa_to_sheet([
      [bizName], [`Planilla: ${planilla.nombre}`], [`Período: ${fmtDate(planilla.periodo_desde)} — ${fmtDate(planilla.periodo_hasta)}   Fecha de pago: ${fmtDate(planilla.fecha_pago)}`], [],
      headers, ...rows, totales,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilla');
    XLSX.writeFile(wb, `Planilla_${planilla.nombre.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`);
    showToast('Excel descargado');
    closeModal('modal-exportar-planilla');
    return;
  }

  // PDF
  if (!window.jspdf) { showToast('No se pudo cargar el generador de PDF', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  doc.setFontSize(14); doc.setFont(undefined,'bold'); doc.text(bizName, 14, 14);
  doc.setFontSize(10); doc.setFont(undefined,'normal');
  doc.text(`Planilla: ${planilla.nombre}`, 14, 20);
  doc.text(`Período: ${fmtDate(planilla.periodo_desde)} — ${fmtDate(planilla.periodo_hasta)}   Fecha de pago: ${fmtDate(planilla.fecha_pago)}`, 14, 25);

  const head = ['#', 'Cédula', 'Nombre', 'Cargo', 'Sal. Base',
    ...nombresDeducciones, 'Tot. Deducc.', 'Sal. Neto',
    ...(modoNicaragua ? nombresAportes : []),
  ];
  const body = pagos.map((p, i) => [
    i+1, p.empleados?.cedula || '—', p.empleados?.nombre || '—', p.empleados?.cargo || '—', fmt(p.salario_base),
    ...nombresDeducciones.map(n => fmt(montoConcepto(p.deducciones_detalle, n))),
    fmt(p.deducciones), fmt(p.total_pagado),
    ...(modoNicaragua ? nombresAportes.map(n => fmt(montoConcepto(p.aportes_patronales_detalle, n))) : []),
  ]);
  const totalesRow = ['', '', '', 'TOTALES', fmt(pagos.reduce((s,p)=>s+Number(p.salario_base),0)),
    ...nombresDeducciones.map(n => fmt(pagos.reduce((s,p)=>s+montoConcepto(p.deducciones_detalle,n),0))),
    fmt(pagos.reduce((s,p)=>s+Number(p.deducciones),0)), fmt(pagos.reduce((s,p)=>s+Number(p.total_pagado),0)),
    ...(modoNicaragua ? nombresAportes.map(n => fmt(pagos.reduce((s,p)=>s+montoConcepto(p.aportes_patronales_detalle,n),0))) : []),
  ];

  doc.autoTable({
    startY: 30, head: [head], body: [...body, totalesRow],
    theme: 'grid', headStyles: { fillColor: [108,99,255], fontSize: 7.5 }, styles: { fontSize: 7.5, cellPadding: 2 },
    didParseCell: (data) => { if (data.row.index === body.length) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [240,240,245]; } },
  });

  doc.setFontSize(8); doc.setTextColor(140,140,140);
  doc.text('Generado por Negocio360 — los montos corresponden exactamente a lo registrado al momento del pago.', 14, doc.internal.pageSize.getHeight() - 8);

  doc.save(`Planilla_${planilla.nombre.replace(/[^a-zA-Z0-9]/g,'_')}.pdf`);
  showToast('PDF descargado');
  closeModal('modal-exportar-planilla');
}

async function initSalarios() {
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

    await loadMetodosPago();
    await loadEmpleados();
    await loadKPIsSal();
  } catch (err) {
    console.error('initSalarios:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initSalarios();
  if (window.lucide) lucide.createIcons();
});
