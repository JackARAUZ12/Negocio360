/* =====================================================
   AGENDA.JS — NEGOCIO360
   Todo lo que tiene fecha en el negocio, en un solo lugar: cuotas de
   crédito por vencer, cuentas por pagar, gastos programados,
   garantías de activos — más tus propias citas y recordatorios.
   Los datos de otros módulos se LEEN en vivo, nunca se duplican
   aquí, para que nunca queden desincronizados.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  clientes: [], eventos: [], itemsAgenda: [], filtroRango: 'semana',
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$';
  return `${sym} ${Number(amount||0).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

/* FIX ZONA HORARIA (mismo ya documentado en Ventas/Compras/Delivery/
   Activos): se usa la fecha calendario LOCAL, nunca UTC. */
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayLocalISO() { return ymdLocal(new Date()); }
function fmtFechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-NI', { weekday:'short', day:'2-digit', month:'short' });
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

async function cargarClientesAgenda() {
  try {
    const { data } = await sb.from('clientes').select('id,nombre').eq('auth_user_id', STATE.userId).order('nombre');
    STATE.clientes = data || [];
    const sel = document.getElementById('ne-cliente');
    if (sel) sel.innerHTML = '<option value="">— Sin vincular —</option>' +
      STATE.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  } catch (e) { STATE.clientes = []; }
}

/* =====================================================
   RANGO DE FECHAS SEGÚN EL FILTRO ACTIVO
===================================================== */
function rangoDeFechas(filtro) {
  const hoy = new Date();
  const desde = todayLocalISO();
  let hasta;
  if (filtro === 'hoy') {
    hasta = desde;
  } else if (filtro === 'semana') {
    const d = new Date(hoy); d.setDate(d.getDate() + 7);
    hasta = ymdLocal(d);
  } else if (filtro === 'mes') {
    const d = new Date(hoy); d.setDate(d.getDate() + 30);
    hasta = ymdLocal(d);
  } else {
    hasta = '2099-12-31'; // "todos" — sin límite práctico hacia adelante
  }
  return { desde, hasta };
}

function filtrarAgendaPorRango(rango) {
  STATE.filtroRango = rango;
  document.querySelectorAll('.filtro-agenda-btn').forEach(b => b.classList.toggle('active', b.dataset.rango === rango));
  cargarAgenda();
}

/* =====================================================
   CARGA COMBINADA — junta eventos propios + lo que ya tiene fecha
   en otros módulos, todo ordenado cronológicamente.
===================================================== */
async function cargarAgenda() {
  const cont = document.getElementById('lista-agenda');
  if (cont) cont.innerHTML = 'Cargando…';
  const { desde, hasta } = rangoDeFechas(STATE.filtroRango);

  try {
    const [eventos, cuotasCredito, cuotasCxp, gastosProg, activosGarantia] = await Promise.all([
      sb.from('agenda_eventos').select('*').eq('auth_user_id', STATE.userId)
        .gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelado').order('fecha'),
      sb.from('creditos_cuotas').select('id, fecha_vencimiento, monto_total, saldo, credito_id, estado')
        .eq('auth_user_id', STATE.userId).in('estado', ['pendiente','parcial'])
        .gte('fecha_vencimiento', desde).lte('fecha_vencimiento', hasta),
      sb.from('cuentas_por_pagar_cuotas').select('id, fecha_vencimiento, monto_total, saldo, cuenta_id, estado')
        .eq('auth_user_id', STATE.userId).in('estado', ['pendiente','parcial'])
        .gte('fecha_vencimiento', desde).lte('fecha_vencimiento', hasta),
      sb.from('gastos_programados').select('id, nombre, monto, fecha_proxima, categoria')
        .eq('auth_user_id', STATE.userId).eq('activo', true)
        .gte('fecha_proxima', desde).lte('fecha_proxima', hasta),
      sb.from('activos_fijos').select('id, nombre, garantia_vencimiento')
        .eq('auth_user_id', STATE.userId).eq('estado', 'activo').not('garantia_vencimiento', 'is', null)
        .gte('garantia_vencimiento', desde).lte('garantia_vencimiento', hasta),
    ]);

    const items = [];

    (eventos.data||[]).forEach(e => items.push({
      fecha: e.fecha, tipo: 'evento', icono: '📌', color: 'var(--accent)',
      titulo: e.titulo, sub: e.hora ? `${e.hora.slice(0,5)}${e.descripcion ? ' — '+e.descripcion : ''}` : (e.descripcion||''),
      id: e.id, completado: e.estado === 'completado', clickeable: true,
    }));

    // Cuotas de crédito — se busca el nombre del cliente por separado,
    // uniendo en JS (más simple y confiable que un join anidado).
    if ((cuotasCredito.data||[]).length) {
      const creditoIds = [...new Set(cuotasCredito.data.map(c => c.credito_id))];
      const { data: creditosInfo } = await sb.from('creditos').select('id, cliente_id, numero_credito').in('id', creditoIds);
      const clienteIds = [...new Set((creditosInfo||[]).map(c => c.cliente_id).filter(Boolean))];
      const { data: clientesInfo } = clienteIds.length
        ? await sb.from('clientes').select('id, nombre').in('id', clienteIds) : { data: [] };
      const mapaCreditos = Object.fromEntries((creditosInfo||[]).map(c => [c.id, c]));
      const mapaClientes = Object.fromEntries((clientesInfo||[]).map(c => [c.id, c.nombre]));

      cuotasCredito.data.forEach(cuota => {
        if (Number(cuota.saldo ?? cuota.monto_total) <= 0) return; // ya no debe nada de verdad, sin importar el estado
        const credito = mapaCreditos[cuota.credito_id];
        const nombreCliente = credito ? (mapaClientes[credito.cliente_id] || 'Cliente') : 'Cliente';
        items.push({
          fecha: cuota.fecha_vencimiento, tipo: 'credito', icono: '💳', color: '#f59e0b',
          titulo: `Cuota de crédito — ${nombreCliente}`,
          sub: `${fmt(cuota.saldo ?? cuota.monto_total)} pendiente`,
          urlDestino: 'creditos.html', clickeable: true,
        });
      });
    }

    // Cuentas por pagar — mismo espíritu, uniendo con proveedor_nombre
    // (ya viene denormalizado en cuentas_por_pagar).
    if ((cuotasCxp.data||[]).length) {
      const cuentaIds = [...new Set(cuotasCxp.data.map(c => c.cuenta_id))];
      const { data: cuentasInfo } = await sb.from('cuentas_por_pagar').select('id, proveedor_nombre').in('id', cuentaIds);
      const mapaCuentas = Object.fromEntries((cuentasInfo||[]).map(c => [c.id, c.proveedor_nombre]));

      cuotasCxp.data.forEach(cuota => {
        if (Number(cuota.saldo ?? cuota.monto_total) <= 0) return;
        items.push({
          fecha: cuota.fecha_vencimiento, tipo: 'cxp', icono: '📄', color: '#ef4444',
          titulo: `Pago a proveedor — ${mapaCuentas[cuota.cuenta_id] || 'Proveedor'}`,
          sub: `${fmt(cuota.saldo ?? cuota.monto_total)} pendiente`,
          urlDestino: 'cuentas-por-pagar.html', clickeable: true,
        });
      });
    }

    (gastosProg.data||[]).forEach(g => items.push({
      fecha: g.fecha_proxima, tipo: 'gasto', icono: '💸', color: '#8b5cf6',
      titulo: `Gasto programado — ${g.nombre}`,
      sub: `${fmt(g.monto)} · ${g.categoria || ''}`,
      urlDestino: 'gastos.html', clickeable: true,
    }));

    (activosGarantia.data||[]).forEach(a => items.push({
      fecha: a.garantia_vencimiento, tipo: 'activo', icono: '🛡️', color: 'var(--success)',
      titulo: `Garantía por vencer — ${a.nombre}`,
      sub: 'Revisa si conviene renovarla',
      urlDestino: 'activos.html', clickeable: true,
    }));

    items.sort((a, b) => a.fecha.localeCompare(b.fecha));
    STATE.itemsAgenda = items;
    renderListaAgenda();
  } catch (e) {
    console.error('cargarAgenda:', e);
    if (cont) cont.innerHTML = '<p style="color:var(--danger);font-size:13px">No se pudo cargar la agenda.</p>';
  }
}

const TIPO_LABEL_AGENDA = { evento:'Tu evento', credito:'Crédito', cxp:'Cuenta por pagar', gasto:'Gasto programado', activo:'Garantía' };

function renderListaAgenda() {
  const cont = document.getElementById('lista-agenda');
  if (!cont) return;
  if (!STATE.itemsAgenda.length) {
    cont.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">
      No hay nada agendado en este rango. 🎉
    </div>`;
    return;
  }

  // Agrupado por fecha, para verlo como una agenda real día por día.
  const grupos = {};
  STATE.itemsAgenda.forEach(it => {
    if (!grupos[it.fecha]) grupos[it.fecha] = [];
    grupos[it.fecha].push(it);
  });

  const hoy = todayLocalISO();
  cont.innerHTML = Object.keys(grupos).map(fecha => {
    const etiquetaFecha = fecha === hoy ? 'Hoy' : fmtFechaCorta(fecha);
    return `
    <div style="margin-bottom:16px">
      <div style="font-weight:700;font-size:12.5px;color:${fecha===hoy?'var(--accent)':'var(--text-muted)'};margin-bottom:8px;text-transform:capitalize">${etiquetaFecha}</div>
      ${grupos[fecha].map(it => `
        <div class="panel-card" style="margin:0 0 8px;border-left:3px solid ${it.color};${it.clickeable?'cursor:pointer':''};${it.completado?'opacity:.55':''}"
             ${it.tipo==='evento' ? `onclick="abrirEditarEvento('${it.id}')"` : (it.urlDestino ? `onclick="navigate('${it.urlDestino}')"` : '')}>
          <div class="panel-body" style="display:flex;align-items:center;gap:10px;padding:10px 12px">
            <span style="font-size:18px">${it.icono}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;${it.completado?'text-decoration:line-through':''}">${esc(it.titulo)}</div>
              ${it.sub ? `<div style="font-size:11.5px;color:var(--text-muted)">${esc(it.sub)}</div>` : ''}
            </div>
            <span style="font-size:9.5px;font-weight:700;color:${it.color};background:${it.color}22;padding:2px 7px;border-radius:20px;white-space:nowrap">${TIPO_LABEL_AGENDA[it.tipo]}</span>
          </div>
        </div>`).join('')}
    </div>`;
  }).join('');
}

/* =====================================================
   NUEVO / EDITAR EVENTO PROPIO
===================================================== */
function abrirNuevoEvento() {
  document.getElementById('ne-titulo-modal').textContent = 'Nuevo evento';
  document.getElementById('ne-evento-id').value = '';
  document.getElementById('ne-titulo').value = '';
  document.getElementById('ne-fecha').value = todayLocalISO();
  document.getElementById('ne-hora').value = '';
  document.getElementById('ne-cliente').value = '';
  document.getElementById('ne-descripcion').value = '';
  document.getElementById('ne-error').textContent = '';
  document.getElementById('btn-eliminar-evento').style.display = 'none';
  openModal('modal-nuevo-evento');
}

async function abrirEditarEvento(eventoId) {
  const { data: e } = await sb.from('agenda_eventos').select('*').eq('id', eventoId).eq('auth_user_id', STATE.userId).maybeSingle();
  if (!e) return;
  document.getElementById('ne-titulo-modal').textContent = 'Editar evento';
  document.getElementById('ne-evento-id').value = e.id;
  document.getElementById('ne-titulo').value = e.titulo;
  document.getElementById('ne-fecha').value = e.fecha;
  document.getElementById('ne-hora').value = e.hora || '';
  document.getElementById('ne-cliente').value = e.cliente_id || '';
  document.getElementById('ne-descripcion').value = e.descripcion || '';
  document.getElementById('ne-error').textContent = '';
  document.getElementById('btn-eliminar-evento').style.display = '';
  openModal('modal-nuevo-evento');
}

async function guardarEvento() {
  const errEl = document.getElementById('ne-error');
  errEl.textContent = '';
  const id = document.getElementById('ne-evento-id').value;
  const titulo = document.getElementById('ne-titulo').value.trim();
  const fecha = document.getElementById('ne-fecha').value;
  const hora = document.getElementById('ne-hora').value || null;
  const clienteId = document.getElementById('ne-cliente').value || null;
  const descripcion = document.getElementById('ne-descripcion').value.trim() || null;

  if (!titulo) { errEl.textContent = 'El título es obligatorio.'; return; }
  if (!fecha) { errEl.textContent = 'La fecha es obligatoria.'; return; }

  setBtnLoading('btn-guardar-evento', true);
  try {
    const payload = { titulo, fecha, hora, cliente_id: clienteId, descripcion, updated_at: new Date().toISOString() };
    let error;
    if (id) {
      ({ error } = await sb.from('agenda_eventos').update(payload).eq('id', id).eq('auth_user_id', STATE.userId));
    } else {
      ({ error } = await sb.from('agenda_eventos').insert({ ...payload, auth_user_id: STATE.userId, estado: 'pendiente' }));
    }
    if (error) throw error;

    showToast(id ? 'Evento actualizado' : 'Evento creado');
    closeModal('modal-nuevo-evento');
    await cargarAgenda();
  } catch (e) {
    console.error('guardarEvento:', e);
    errEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
  } finally {
    setBtnLoading('btn-guardar-evento', false);
  }
}

async function eliminarEvento() {
  const id = document.getElementById('ne-evento-id').value;
  if (!id) return;
  try {
    const { error } = await sb.from('agenda_eventos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Evento eliminado');
    closeModal('modal-nuevo-evento');
    await cargarAgenda();
  } catch (e) {
    console.error('eliminarEvento:', e);
    showToast('No se pudo eliminar', 'error');
  }
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

    await cargarClientesAgenda();
    await cargarAgenda();
  } catch (e) {
    console.error('init agenda:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});
