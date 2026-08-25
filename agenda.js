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
  clientes: [], eventos: [], itemsAgenda: [],
  calVista: 'mes', calFecha: new Date(), // fecha de referencia del período que se está viendo
  categoriaEventoActual: 'otro',
};

const CATEGORIA_COLOR = { reunion:'#4361ee', entrega:'#9061f9', tarea:'#f4419f', pago:'#fb9f1c', evento:'#0ecb9d', otro:'#9ca3af' };
const CATEGORIA_LABEL = { reunion:'Reunión', entrega:'Entrega', tarea:'Tarea', pago:'Pago', evento:'Evento', otro:'Otro' };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(amount) {
  const sym = monedaParaMostrar(STATE.empresaConfig?.moneda);
  return `${sym} ${convertirParaMostrar(amount, STATE.empresaConfig?.moneda).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
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
   CALENDARIO — cálculo del rango visible según la vista activa, y
   toda la navegación (Hoy, ‹ ›, cambiar entre Mes/Semana/Día).
===================================================== */
function primerDiaVisibleDelMes(fecha) {
  const primerDiaMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  const inicio = new Date(primerDiaMes);
  inicio.setDate(inicio.getDate() - primerDiaMes.getDay()); // retrocede hasta el domingo
  return inicio;
}
function domingoDeLaSemana(fecha) {
  const d = new Date(fecha);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function sumarDias(fecha, n) { const d = new Date(fecha); d.setDate(d.getDate() + n); return d; }

function rangoVisibleCalendario() {
  if (STATE.calVista === 'dia') {
    const iso = ymdLocal(STATE.calFecha);
    return { desde: iso, hasta: iso };
  }
  if (STATE.calVista === 'semana') {
    const inicio = domingoDeLaSemana(STATE.calFecha);
    return { desde: ymdLocal(inicio), hasta: ymdLocal(sumarDias(inicio, 6)) };
  }
  // 'mes' — igual que se ve en pantalla: desde el domingo antes del
  // día 1, hasta completar 6 semanas (42 días), como cualquier
  // calendario real.
  const inicio = primerDiaVisibleDelMes(STATE.calFecha);
  return { desde: ymdLocal(inicio), hasta: ymdLocal(sumarDias(inicio, 41)) };
}

function irAHoyCalendario() {
  STATE.calFecha = new Date();
  cargarAgenda();
}

function cambiarPeriodoCalendario(delta) {
  const f = new Date(STATE.calFecha);
  if (STATE.calVista === 'mes') f.setMonth(f.getMonth() + delta);
  else if (STATE.calVista === 'semana') f.setDate(f.getDate() + delta * 7);
  else f.setDate(f.getDate() + delta);
  STATE.calFecha = f;
  cargarAgenda();
}

function cambiarVistaCalendario(vista) {
  STATE.calVista = vista;
  document.querySelectorAll('.cal-vista-btn').forEach(b => b.classList.toggle('active', b.dataset.vista === vista));
  cargarAgenda();
}

/* =====================================================
   CARGA COMBINADA — junta eventos propios + lo que ya tiene fecha
   en otros módulos, para el rango visible del calendario actual.
===================================================== */
async function cargarAgenda() {
  const cont = document.getElementById('calendario-contenedor');
  if (cont) cont.innerHTML = 'Cargando…';
  const { desde, hasta } = rangoVisibleCalendario();

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
      fecha: e.fecha, tipo: 'evento', categoria: e.categoria || 'otro',
      titulo: e.titulo, hora: e.hora ? e.hora.slice(0,5) : null, sub: e.descripcion || '',
      id: e.id, completado: e.estado === 'completado', clickeable: true,
    }));

    if ((cuotasCredito.data||[]).length) {
      const creditoIds = [...new Set(cuotasCredito.data.map(c => c.credito_id))];
      const { data: creditosInfo } = await sb.from('creditos').select('id, cliente_id, numero_credito').in('id', creditoIds);
      const clienteIds = [...new Set((creditosInfo||[]).map(c => c.cliente_id).filter(Boolean))];
      const { data: clientesInfo } = clienteIds.length
        ? await sb.from('clientes').select('id, nombre').in('id', clienteIds) : { data: [] };
      const mapaCreditos = Object.fromEntries((creditosInfo||[]).map(c => [c.id, c]));
      const mapaClientes = Object.fromEntries((clientesInfo||[]).map(c => [c.id, c.nombre]));

      cuotasCredito.data.forEach(cuota => {
        if (Number(cuota.saldo ?? cuota.monto_total) <= 0) return;
        const credito = mapaCreditos[cuota.credito_id];
        const nombreCliente = credito ? (mapaClientes[credito.cliente_id] || 'Cliente') : 'Cliente';
        items.push({
          fecha: cuota.fecha_vencimiento, tipo: 'credito', categoria: 'pago',
          titulo: `Cuota de crédito — ${nombreCliente}`,
          sub: `${fmt(cuota.saldo ?? cuota.monto_total)} pendiente`,
          urlDestino: 'creditos.html', clickeable: true,
        });
      });
    }

    if ((cuotasCxp.data||[]).length) {
      const cuentaIds = [...new Set(cuotasCxp.data.map(c => c.cuenta_id))];
      const { data: cuentasInfo } = await sb.from('cuentas_por_pagar').select('id, proveedor_nombre').in('id', cuentaIds);
      const mapaCuentas = Object.fromEntries((cuentasInfo||[]).map(c => [c.id, c.proveedor_nombre]));

      cuotasCxp.data.forEach(cuota => {
        if (Number(cuota.saldo ?? cuota.monto_total) <= 0) return;
        items.push({
          fecha: cuota.fecha_vencimiento, tipo: 'cxp', categoria: 'pago',
          titulo: `Pago a proveedor — ${mapaCuentas[cuota.cuenta_id] || 'Proveedor'}`,
          sub: `${fmt(cuota.saldo ?? cuota.monto_total)} pendiente`,
          urlDestino: 'cuentas-por-pagar.html', clickeable: true,
        });
      });
    }

    (gastosProg.data||[]).forEach(g => items.push({
      fecha: g.fecha_proxima, tipo: 'gasto', categoria: 'pago',
      titulo: `Gasto programado — ${g.nombre}`,
      sub: `${fmt(g.monto)} · ${g.categoria || ''}`,
      urlDestino: 'gastos.html', clickeable: true,
    }));

    (activosGarantia.data||[]).forEach(a => items.push({
      fecha: a.garantia_vencimiento, tipo: 'activo', categoria: 'otro',
      titulo: `Garantía por vencer — ${a.nombre}`,
      sub: 'Revisa si conviene renovarla',
      urlDestino: 'activos.html', clickeable: true,
    }));

    items.forEach(it => { it.color = CATEGORIA_COLOR[it.categoria] || CATEGORIA_COLOR.otro; });
    items.sort((a, b) => a.fecha.localeCompare(b.fecha));
    STATE.itemsAgenda = items;
    renderCalendario();
  } catch (e) {
    console.error('cargarAgenda:', e);
    if (cont) cont.innerHTML = '<p style="color:var(--danger);font-size:13px">No se pudo cargar la agenda.</p>';
  }
}

const TIPO_LABEL_AGENDA = { evento:'Tu evento', credito:'Crédito', cxp:'Cuenta por pagar', gasto:'Gasto programado', activo:'Garantía' };

/* =====================================================
   RENDER DEL CALENDARIO — despacha a mes/semana/día según la vista
   activa, y arma el título del período que se está viendo.
===================================================== */
function renderCalendario() {
  const titulo = document.getElementById('cal-titulo-periodo');
  if (STATE.calVista === 'mes') {
    if (titulo) titulo.textContent = STATE.calFecha.toLocaleDateString('es-NI', { month:'long', year:'numeric' });
    renderCalendarioMes();
  } else if (STATE.calVista === 'semana') {
    const inicio = domingoDeLaSemana(STATE.calFecha);
    const fin = sumarDias(inicio, 6);
    if (titulo) titulo.textContent = `${inicio.toLocaleDateString('es-NI',{day:'numeric',month:'short'})} – ${fin.toLocaleDateString('es-NI',{day:'numeric',month:'short',year:'numeric'})}`;
    renderCalendarioSemana();
  } else {
    if (titulo) titulo.textContent = STATE.calFecha.toLocaleDateString('es-NI', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    renderCalendarioDia();
  }
}

function itemsDelDia(iso) { return STATE.itemsAgenda.filter(it => it.fecha === iso); }

// Contenido interno de un bloque de evento en el calendario — título
// siempre, y la hora debajo en su propia línea cuando existe (igual
// que el diseño de referencia).
function contenidoPillEvento(it) {
  return `<div class="cal-evento-titulo">${esc(it.titulo)}</div>${it.hora ? `<div class="cal-evento-hora">${esc(it.hora)}</div>` : ''}`;
}

function renderCalendarioMes() {
  const cont = document.getElementById('calendario-contenedor');
  if (!cont) return;
  const inicio = primerDiaVisibleDelMes(STATE.calFecha);
  const hoy = todayLocalISO();
  const mesActual = STATE.calFecha.getMonth();
  const dow = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  let html = `<div class="cal-grid-header">${dow.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div><div class="cal-grid">`;
  for (let i = 0; i < 42; i++) {
    const dia = sumarDias(inicio, i);
    const iso = ymdLocal(dia);
    const esOtroMes = dia.getMonth() !== mesActual;
    const esHoy = iso === hoy;
    const items = itemsDelDia(iso);
    const visibles = items.slice(0, 3);
    const restantes = items.length - visibles.length;

    html += `<div class="cal-cell ${esOtroMes?'cal-otro-mes':''} ${esHoy?'cal-hoy':''}" onclick="abrirEventosDia('${iso}')">
      <span class="cal-cell-num">${dia.getDate()}</span>
      <div class="cal-eventos-wrap">
      ${visibles.map(it => `<div class="cal-evento-pill" style="background:${it.color}">${contenidoPillEvento(it)}</div>`).join('')}
      ${restantes > 0 ? `<div class="cal-evento-mas">+${restantes} más</div>` : ''}
      </div>
    </div>`;
  }
  html += '</div>';
  cont.innerHTML = html;
}

function renderCalendarioSemana() {
  const cont = document.getElementById('calendario-contenedor');
  if (!cont) return;
  const inicio = domingoDeLaSemana(STATE.calFecha);
  const hoy = todayLocalISO();
  const dow = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  let html = `<div class="cal-grid-header">${dow.map((d,i) => {
    const dia = sumarDias(inicio, i);
    return `<div class="cal-dow">${d} <span style="color:var(--text-secondary)">${dia.getDate()}</span></div>`;
  }).join('')}</div><div class="cal-grid">`;

  for (let i = 0; i < 7; i++) {
    const dia = sumarDias(inicio, i);
    const iso = ymdLocal(dia);
    const esHoy = iso === hoy;
    const items = itemsDelDia(iso);
    html += `<div class="cal-cell cal-semana-cell ${esHoy?'cal-hoy':''}" onclick="abrirEventosDia('${iso}')">
      <div class="cal-eventos-wrap">
      ${items.map(it => `<div class="cal-evento-pill" style="background:${it.color}">${contenidoPillEvento(it)}</div>`).join('')}
      </div>
    </div>`;
  }
  html += '</div>';
  cont.innerHTML = html;
}

function renderCalendarioDia() {
  const cont = document.getElementById('calendario-contenedor');
  if (!cont) return;
  const iso = ymdLocal(STATE.calFecha);
  const items = itemsDelDia(iso);

  if (!items.length) {
    cont.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">Nada agendado este día. 🎉</div>`;
    return;
  }
  cont.innerHTML = `<div class="cal-dia-lista">${items.map(it => filaEventoHTML(it)).join('')}</div>`;
}

// Una fila de evento reutilizable — misma tarjeta para el modal del
// día y la vista de día completa.
function filaEventoHTML(it) {
  return `
    <div class="panel-card" style="margin:0 0 8px;border-left:3px solid ${it.color};${it.clickeable?'cursor:pointer':''};${it.completado?'opacity:.55':''}"
         ${it.tipo==='evento' ? `onclick="abrirEditarEvento('${it.id}')"` : (it.urlDestino ? `onclick="navigate('${it.urlDestino}')"` : '')}>
      <div class="panel-body" style="display:flex;align-items:center;gap:10px;padding:10px 12px">
        <span class="cal-dot" style="background:${it.color};width:10px;height:10px"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;${it.completado?'text-decoration:line-through':''}">${esc(it.titulo)}</div>
          ${(it.hora || it.sub) ? `<div style="font-size:11.5px;color:var(--text-muted)">${it.hora ? esc(it.hora) : ''}${it.hora && it.sub ? ' — ' : ''}${esc(it.sub||'')}</div>` : ''}
        </div>
        <span style="font-size:9.5px;font-weight:700;color:${it.color};background:${it.color}22;padding:2px 7px;border-radius:20px;white-space:nowrap">${CATEGORIA_LABEL[it.categoria] || TIPO_LABEL_AGENDA[it.tipo]}</span>
      </div>
    </div>`;
}

// Al hacer clic en cualquier celda del calendario (mes o semana) —
// muestra todo lo de ese día, con acceso directo a crear uno nuevo
// ya con esa fecha lista.
function abrirEventosDia(iso) {
  const items = itemsDelDia(iso);
  const fechaLegible = new Date(iso + 'T00:00:00').toLocaleDateString('es-NI', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('ed-titulo').textContent = fechaLegible;
  document.getElementById('ed-lista').innerHTML = items.length
    ? items.map(it => filaEventoHTML(it)).join('')
    : `<p style="text-align:center;color:var(--text-muted);font-size:13px;padding:10px 0">Nada agendado este día.</p>`;
  document.getElementById('ed-btn-nuevo').setAttribute('onclick', `closeModal('modal-eventos-dia');abrirNuevoEvento('${iso}')`);
  openModal('modal-eventos-dia');
}

/* =====================================================
   NUEVO / EDITAR EVENTO PROPIO
===================================================== */
function elegirCategoriaEvento(cat) {
  STATE.categoriaEventoActual = cat;
  document.querySelectorAll('.cal-cat-btn').forEach(b => {
    const activa = b.dataset.cat === cat;
    b.classList.toggle('active', activa);
    b.style.background = activa ? (CATEGORIA_COLOR[cat] + '22') : '';
  });
}

function abrirNuevoEvento(fechaPrellenada) {
  document.getElementById('ne-titulo-modal').textContent = 'Nuevo evento';
  document.getElementById('ne-evento-id').value = '';
  document.getElementById('ne-titulo').value = '';
  document.getElementById('ne-fecha').value = fechaPrellenada || todayLocalISO();
  document.getElementById('ne-hora').value = '';
  document.getElementById('ne-cliente').value = '';
  document.getElementById('ne-descripcion').value = '';
  document.getElementById('ne-error').textContent = '';
  document.getElementById('btn-eliminar-evento').style.display = 'none';
  elegirCategoriaEvento('otro');
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
  elegirCategoriaEvento(e.categoria || 'otro');
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
  const categoria = STATE.categoriaEventoActual || 'otro';

  if (!titulo) { errEl.textContent = 'El título es obligatorio.'; return; }
  if (!fecha) { errEl.textContent = 'La fecha es obligatoria.'; return; }

  setBtnLoading('btn-guardar-evento', true);
  try {
    const payload = { titulo, fecha, hora, cliente_id: clienteId, descripcion, categoria, updated_at: new Date().toISOString() };
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
