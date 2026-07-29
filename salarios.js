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
  ['emp-nombre','emp-cargo','emp-telefono','emp-correo','emp-observaciones'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  document.getElementById('emp-fecha-ingreso').value = todayISO();
  document.getElementById('emp-tipo-salario').value = 'mensual';
  document.getElementById('emp-salario').value = '';
  document.getElementById('emp-estado').value = 'activo';
  document.getElementById('emp-error').textContent = '';
  openModal('modal-empleado');
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

  const payload = {
    nombre, cargo: document.getElementById('emp-cargo').value.trim() || null,
    telefono: document.getElementById('emp-telefono').value.trim() || null,
    correo: document.getElementById('emp-correo').value.trim() || null,
    fecha_ingreso: fechaIngreso, tipo_salario: tipoSalario, salario,
    estado: document.getElementById('emp-estado').value,
    observaciones: document.getElementById('emp-observaciones').value.trim() || null,
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
    const { error } = await sbClient.from('empleados_adelantos').insert({
      auth_user_id: STATE.userId, empleado_id: emp.id, monto, fecha, motivo, estado: 'pendiente',
    });
    if (error) throw error;
    showToast('Adelanto registrado');
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
    const { data: pago, error: errPago } = await sbClient.from('empleados_pagos').insert({
      auth_user_id: STATE.userId, empleado_id: emp.id, fecha,
      salario_base: base, bonificaciones: totalBonos, bonificaciones_detalle: STATE.bonos,
      deducciones: totalDeducciones, deducciones_detalle: STATE.deducciones,
      adelantos_descontados: totalAdelantos, total_pagado: total,
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
