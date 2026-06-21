/* ============================================================
   CLIENTES.JS — NEGOCIO360
   CRM básico. Integrado completamente con Ventas.
   Reutiliza tabla clientes creada/usada por ventas.js.
   RLS + Supabase Auth.
   ============================================================ */

'use strict';

/* ============================================================
   SUPABASE — mismas credenciales que ventas.js
   ============================================================ */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const CS = {
  userId:        null,
  userEmail:     null,
  empresaConfig: {},
  moneda:        'C$',

  // Lista principal
  clientes:      [],
  clientesTotal: 0,
  page:          1,
  perPage:       20,
  filtro:        'todos',
  busqueda:      '',

  // Cliente activo (perfil / edición)
  clienteActivo: null,
  ventasCliente: [],

  // Venta activa para detalle desde perfil
  ventaDetalleActiva: null,

  // KPIs cacheados
  kpi: {},
};

/* ============================================================
   HELPERS
   ============================================================ */
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sym() { return CS.moneda || 'C$'; }

function fmt(n) {
  const v = parseFloat(n || 0);
  return `${sym()} ${v.toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
}

function fmtShort(n) {
  const v = parseFloat(n || 0), s = sym();
  if (v >= 1_000_000) return `${s}${(v/1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${s}${(v/1_000).toFixed(1)}k`;
  return `${s}${v.toLocaleString('es-NI', { minimumFractionDigits:0 })}`;
}

function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'));
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00');
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}

/* ============================================================
   CALCULAR ESTADO CLIENTE (automático)
   ============================================================ */
function calcularEstado(cliente) {
  const { num_compras, ultima_compra } = cliente;
  const n   = Number(num_compras || 0);
  const dias = diasDesde(ultima_compra);

  if (n === 0)      return 'nuevo';
  if (n >= 5)       return 'frecuente';
  if (dias !== null && dias > 60) return 'inactivo';
  return 'activo';
}

function estadoBadgeHtml(estado) {
  const map = {
    activo:    { cls:'badge-activo',    label:'Activo'    },
    inactivo:  { cls:'badge-inactivo',  label:'Inactivo'  },
    frecuente: { cls:'badge-frecuente', label:'Frecuente' },
    nuevo:     { cls:'badge-nuevo',     label:'Nuevo'     },
  };
  const e = map[estado] || map.activo;
  return `<span class="cli-estado-badge ${e.cls}">${e.label}</span>`;
}

function iniciales(nombre) {
  if (!nombre) return '?';
  const partes = nombre.trim().split(' ');
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return partes[0].slice(0,2).toUpperCase();
}

function colorAvatar(nombre) {
  const colores = ['#5a5af4','#22c55e','#f97316','#8b5cf6','#06b6d4','#ec4899','#f59e0b','#10b981'];
  let hash = 0;
  for (let i = 0; i < (nombre||'').length; i++) hash = nombre.charCodeAt(i) + ((hash<<5)-hash);
  return colores[Math.abs(hash) % colores.length];
}

/* ============================================================
   TEMA
   ============================================================ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('n360_theme', t);
  const sun  = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = t === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() {
  const c = document.documentElement.getAttribute('data-theme');
  applyTheme(c === 'dark' ? 'light' : 'dark');
}

/* ============================================================
   SIDEBAR
   ============================================================ */
let sidebarCollapsed = false;
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
  document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
}
function navigate(url) { window.location.href = url; }

/* ============================================================
   MODALES
   ============================================================ */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('modal-open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('modal-open'); document.body.style.overflow = ''; }
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

/* ============================================================
   ADMIN ACCESS
   ============================================================ */
async function checkAdminAccess(email) {
  try {
    const { data } = await sb.from('administradores').select('email,activo')
      .eq('email', email).eq('activo', true).maybeSingle();
    if (data) {
      const el = document.getElementById('nav-admin');
      if (el) el.style.display = 'flex';
    }
  } catch { /* silencioso */ }
}

/* ============================================================
   EMPRESA CONFIG
   ============================================================ */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*')
      .eq('auth_user_id', userId).maybeSingle();
    if (data) {
      CS.empresaConfig = data;
      CS.moneda = data.moneda || 'C$';
      const bizName = data.nombre_negocio || data.nombre || 'Negocio360';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      if (data.color_primario) {
        document.documentElement.style.setProperty('--accent', data.color_primario);
        document.documentElement.style.setProperty('--accent-soft', data.color_primario + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_primario);
      }
      if (data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch(e) { console.warn('loadEmpresaConfig:', e); }
}

async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*')
      .eq('auth_user_id', userId).maybeSingle();
    return data;
  } catch { return null; }
}

function renderUserInfo(user, email) {
  if (!user) return;
  const nombre   = user.nombre   || email?.split('@')[0] || 'Usuario';
  const apellido = user.apellido || '';
  const biz      = CS.empresaConfig?.nombre_negocio || user.nombre_negocio || 'Mi negocio';
  const plan     = user.plan || 'Gratuito';
  const initials = ((nombre[0]||'') + (apellido[0]||'')).toUpperCase();

  document.getElementById('header-name').textContent   = `${nombre} ${apellido}`.trim();
  document.getElementById('header-biz').textContent    = biz;
  document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
  document.getElementById('plan-text').textContent     = plan.charAt(0).toUpperCase() + plan.slice(1);

  if (plan === 'pro' || plan === 'enterprise') {
    const box = document.getElementById('upgrade-box');
    if (box) box.style.display = 'none';
  }
}

/* ============================================================
   KPIs
   ============================================================ */
async function loadKPIs() {
  try {
    // Intentar función SQL primero (más eficiente)
    const { data: kpiData, error } = await sb.rpc('get_clientes_kpi', { p_user_id: CS.userId });

    if (!error && kpiData) {
      CS.kpi = kpiData;
      renderKPIs(kpiData);
      return;
    }

    // Fallback: calcular directamente desde clientes
    const { data: clientes } = await sb.from('clientes')
      .select('id,nombre,total_compras,num_compras,ultima_compra,estado,created_at')
      .eq('auth_user_id', CS.userId).eq('activo', true);

    const mesStart = startOfMonthISO();
    const ahora    = new Date();
    const hace30   = new Date(ahora - 30*86400000).toISOString().split('T')[0];

    const total    = clientes?.length || 0;
    const activos  = (clientes||[]).filter(c => c.ultima_compra && c.ultima_compra >= hace30).length;
    const nuevosMes= (clientes||[]).filter(c => c.created_at?.slice(0,10) >= mesStart).length;

    const conCompras = (clientes||[]).filter(c => Number(c.num_compras) > 0);
    const totalGen   = conCompras.reduce((s,c) => s + Number(c.total_compras||0), 0);
    const totalComs  = conCompras.reduce((s,c) => s + Number(c.num_compras||0), 0);
    const ticket     = totalComs > 0 ? totalGen / totalComs : 0;

    let topCliente = '—', topMonto = 0;
    if (conCompras.length) {
      const top = conCompras.sort((a,b) => Number(b.total_compras) - Number(a.total_compras))[0];
      topCliente = top.nombre;
      topMonto   = Number(top.total_compras);
    }

    const kpi = { total_clientes: total, activos, nuevos_mes: nuevosMes,
      top_cliente: topCliente, top_monto: topMonto,
      total_generado: totalGen, ticket_promedio: ticket };

    CS.kpi = kpi;
    renderKPIs(kpi);

  } catch(e) { console.warn('loadKPIs:', e); }
}

function renderKPIs(k) {
  setKPIEl('kpi-total',       k.total_clientes?.toString() || '0', null);
  setKPIEl('kpi-activos',     k.activos?.toString() || '0', null);
  setKPIEl('kpi-nuevos',      k.nuevos_mes?.toString() || '0', null);
  setKPIEl('kpi-top',         esc(k.top_cliente || '—'), null);
  setKPIEl('kpi-generado',    fmtShort(k.total_generado || 0), null);
  setKPIEl('kpi-ticket',      fmtShort(k.ticket_promedio || 0), null);

  // Sub-etiquetas
  const topSub = document.getElementById('kpi-top-sub');
  if (topSub && k.top_monto) topSub.textContent = `${fmt(k.top_monto)} facturados`;
}

function setKPIEl(id, val, delta) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ============================================================
   CARGAR CLIENTES (tabla principal)
   ============================================================ */
async function loadClientes() {
  const tbody = document.getElementById('clientes-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="8">Cargando clientes…</td></tr>';

  try {
    let q = sb.from('clientes')
      .select('*', { count: 'exact' })
      .eq('auth_user_id', CS.userId)
      .eq('activo', true)
      .order('nombre');

    // Búsqueda
    const b = CS.busqueda.trim();
    if (b) {
      q = q.or(`nombre.ilike.%${b}%,telefono.ilike.%${b}%,correo.ilike.%${b}%,empresa.ilike.%${b}%`);
    }

    // Filtros de estado
    switch (CS.filtro) {
      case 'activos':
        q = q.eq('estado', 'activo'); break;
      case 'inactivos':
        q = q.eq('estado', 'inactivo'); break;
      case 'frecuentes':
        q = q.eq('estado', 'frecuente'); break;
      case 'nuevos':
        q = q.eq('estado', 'nuevo'); break;
      case 'con-compras':
        q = q.gt('num_compras', 0); break;
      case 'sin-compras':
        q = q.eq('num_compras', 0); break;
    }

    const fromR = (CS.page - 1) * CS.perPage;
    q = q.range(fromR, fromR + CS.perPage - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    CS.clientes      = data || [];
    CS.clientesTotal = count || 0;

    renderTablaClientes();
    renderPaginacion();
    updateCountLabel();

  } catch(e) {
    console.error('loadClientes:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Error al cargar clientes.</td></tr>`;
  }
}

function renderTablaClientes() {
  const tbody = document.getElementById('clientes-tbody');
  if (!tbody) return;

  if (!CS.clientes.length) {
    tbody.innerHTML = `
      <tr><td colspan="8" class="empty-cell">
        <div class="empty-icon">👥</div>
        <p>${CS.busqueda ? 'Sin resultados para "' + esc(CS.busqueda) + '"' : 'Sin clientes registrados'}</p>
        <button class="btn-primary" style="margin-top:12px" onclick="abrirModalNuevoCliente()">+ Nuevo cliente</button>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = CS.clientes.map(c => {
    const estadoAuto  = calcularEstado(c);
    const numCompras  = Number(c.num_compras || 0);
    const totalGast   = Number(c.total_compras || 0);
    const ultimaFmt   = fmtFecha(c.ultima_compra);
    const ticket      = numCompras > 0 ? totalGast / numCompras : 0;
    const color       = colorAvatar(c.nombre);
    const ini         = iniciales(c.nombre);

    return `
    <tr onclick="abrirPerfil('${c.id}')" style="cursor:pointer">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="cli-avatar-sm" style="background:${color}">${ini}</div>
          <div>
            <div style="font-weight:600;color:var(--text-primary)">${esc(c.nombre)}</div>
            ${c.empresa ? `<div style="font-size:11.5px;color:var(--text-muted)">${esc(c.empresa)}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="color:var(--text-secondary);font-size:13px">${c.telefono ? esc(c.telefono) : '—'}</td>
      <td style="color:var(--text-secondary);font-size:13px">${c.correo ? esc(c.correo) : '—'}</td>
      <td style="color:var(--text-secondary);font-size:12.5px">${ultimaFmt}</td>
      <td style="text-align:center">
        <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${numCompras}</span>
      </td>
      <td style="font-family:var(--font-mono);font-weight:700;color:var(--text-primary)">${fmt(totalGast)}</td>
      <td>${estadoBadgeHtml(estadoAuto)}</td>
      <td class="td-actions" onclick="event.stopPropagation()">
        <button class="btn-icon-sm" title="Ver perfil" onclick="abrirPerfil('${c.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="btn-icon-sm" title="Editar" onclick="abrirEditar('${c.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon-sm del" title="Eliminar" onclick="confirmarEliminar('${c.id}','${esc(c.nombre)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderPaginacion() {
  const total = Math.ceil(CS.clientesTotal / CS.perPage);
  const info  = document.getElementById('pag-info');
  const prev  = document.getElementById('btn-prev');
  const next  = document.getElementById('btn-next');

  if (info) {
    const f = Math.min((CS.page-1)*CS.perPage+1, CS.clientesTotal);
    const t = Math.min(CS.page*CS.perPage, CS.clientesTotal);
    info.textContent = CS.clientesTotal > 0 ? `Mostrando ${f}–${t} de ${CS.clientesTotal}` : 'Sin resultados';
  }
  if (prev) prev.disabled = CS.page <= 1;
  if (next) next.disabled = CS.page >= total;
}

function updateCountLabel() {
  const el = document.getElementById('clientes-count-label');
  if (el) el.textContent = `${CS.clientesTotal} cliente${CS.clientesTotal !== 1 ? 's' : ''}`;
}

function paginaAnterior() { if (CS.page > 1) { CS.page--; loadClientes(); } }
function paginaSiguiente() {
  if (CS.page < Math.ceil(CS.clientesTotal / CS.perPage)) { CS.page++; loadClientes(); }
}

function setFiltro(f) {
  CS.filtro = f;
  CS.page   = 1;
  document.querySelectorAll('.filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.f === f));
  loadClientes();
}

let busquedaTimer = null;
function buscarClientes() {
  CS.busqueda = document.getElementById('cli-search')?.value || '';
  CS.page = 1;
  clearTimeout(busquedaTimer);
  busquedaTimer = setTimeout(loadClientes, 320);
}

/* ============================================================
   MODAL NUEVO / EDITAR CLIENTE
   ============================================================ */
function abrirModalNuevoCliente() {
  CS.clienteActivo = null;
  document.getElementById('modal-cliente-title').textContent = 'Nuevo Cliente';
  limpiarFormCliente();
  openModal('modal-cliente');
}

function abrirEditar(clienteId) {
  const c = CS.clientes.find(x => x.id === clienteId);
  if (!c) return;
  CS.clienteActivo = c;
  document.getElementById('modal-cliente-title').textContent = 'Editar Cliente';
  rellenarFormCliente(c);
  openModal('modal-cliente');
}

function limpiarFormCliente() {
  ['fc-nombre','fc-telefono','fc-correo','fc-empresa','fc-direccion','fc-observaciones'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const est = document.getElementById('fc-estado');
  if (est) est.value = 'activo';
}

function rellenarFormCliente(c) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('fc-nombre',       c.nombre);
  set('fc-telefono',     c.telefono);
  set('fc-correo',       c.correo);
  set('fc-empresa',      c.empresa);
  set('fc-direccion',    c.direccion);
  set('fc-observaciones',c.observaciones);
  const est = document.getElementById('fc-estado');
  if (est) est.value = c.estado || 'activo';
}

async function guardarCliente() {
  const nombre = document.getElementById('fc-nombre')?.value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'error'); return; }

  const payload = {
    auth_user_id: CS.userId,
    nombre,
    telefono:      document.getElementById('fc-telefono')?.value.trim() || null,
    correo:        document.getElementById('fc-correo')?.value.trim()   || null,
    empresa:       document.getElementById('fc-empresa')?.value.trim()  || null,
    direccion:     document.getElementById('fc-direccion')?.value.trim()|| null,
    observaciones: document.getElementById('fc-observaciones')?.value.trim() || null,
    estado:        document.getElementById('fc-estado')?.value || 'activo',
    activo:        true,
  };

  const btn = document.getElementById('btn-guardar-cliente');
  if (btn) btn.disabled = true;

  try {
    if (CS.clienteActivo) {
      // EDITAR
      const { error } = await sb.from('clientes')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', CS.clienteActivo.id)
        .eq('auth_user_id', CS.userId);
      if (error) throw error;
      showToast('Cliente actualizado', 'success');
    } else {
      // CREAR — verificar duplicado por teléfono o correo
      if (payload.telefono || payload.correo) {
        let dupQ = sb.from('clientes').select('id,nombre')
          .eq('auth_user_id', CS.userId).eq('activo', true);
        if (payload.telefono) dupQ = dupQ.eq('telefono', payload.telefono);
        const { data: dup } = await dupQ.maybeSingle();
        if (dup) {
          showToast(`Ya existe "${dup.nombre}" con ese teléfono`, 'warning');
          if (btn) btn.disabled = false;
          return;
        }
      }
      const { error } = await sb.from('clientes').insert(payload);
      if (error) throw error;
      showToast('Cliente creado', 'success');
    }

    closeModal('modal-cliente');
    await Promise.allSettled([loadClientes(), loadKPIs()]);

  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================
   PERFIL COMPLETO DEL CLIENTE
   ============================================================ */
async function abrirPerfil(clienteId) {
  const c = CS.clientes.find(x => x.id === clienteId);
  if (!c) {
    // Puede venir de Top Clientes, buscar directamente
    const { data } = await sb.from('clientes').select('*')
      .eq('id', clienteId).eq('auth_user_id', CS.userId).maybeSingle();
    if (!data) return;
    CS.clienteActivo = data;
  } else {
    CS.clienteActivo = c;
  }

  const cl = CS.clienteActivo;
  const color = colorAvatar(cl.nombre);
  const ini   = iniciales(cl.nombre);
  const estadoAuto = calcularEstado(cl);

  // Header del perfil
  document.getElementById('perfil-nombre').textContent  = cl.nombre;
  document.getElementById('perfil-empresa').textContent = cl.empresa || '';
  document.getElementById('perfil-estado-badge').innerHTML = estadoBadgeHtml(estadoAuto);
  document.getElementById('perfil-avatar').textContent  = ini;
  document.getElementById('perfil-avatar').style.background = color;

  // Info general
  setPerfilField('perfil-telefono', cl.telefono);
  setPerfilField('perfil-correo',   cl.correo);
  setPerfilField('perfil-direccion',cl.direccion);
  setPerfilField('perfil-empresa-val', cl.empresa);
  setPerfilField('perfil-observaciones', cl.observaciones);
  setPerfilField('perfil-creado',   fmtFecha(cl.created_at));

  // Estadísticas (del campo calculado, actualizar desde ventas siempre)
  await cargarStatsCliente(cl.id);

  // Historial de ventas
  await cargarHistorialVentas(cl.id);

  openModal('modal-perfil');
}

function setPerfilField(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '—';
}

async function cargarStatsCliente(clienteId) {
  try {
    // Calcular SIEMPRE desde ventas reales (datos frescos, sin depender del campo cacheado)
    const { data: ventas } = await sb.from('ventas')
      .select('id,total,fecha,estado')
      .eq('cliente_id', clienteId)
      .eq('auth_user_id', CS.userId)
      .eq('estado', 'completada')
      .order('fecha', { ascending: false });

    const arrV       = ventas || [];
    const totalGast  = arrV.reduce((s,v) => s + Number(v.total), 0);
    const numComp    = arrV.length;
    const ticket     = numComp > 0 ? totalGast / numComp : 0;
    const ultimaComp = arrV.length ? arrV[0].fecha : null;
    const primeraComp= arrV.length ? arrV[arrV.length-1].fecha : null;

    setPerfilField('perfil-stat-compras',    numComp.toString());
    setPerfilField('perfil-stat-total',      fmt(totalGast));
    setPerfilField('perfil-stat-ticket',     fmt(ticket));
    setPerfilField('perfil-stat-ultima',     fmtFecha(ultimaComp));
    setPerfilField('perfil-stat-primera',    fmtFecha(primeraComp));
    setPerfilField('perfil-stat-num-ventas', numComp.toString());

    // Actualizar campos en BD en segundo plano
    sb.from('clientes').update({
      total_compras:  totalGast,
      num_compras:    numComp,
      ultima_compra:  ultimaComp,
      primera_compra: primeraComp,
    }).eq('id', clienteId).eq('auth_user_id', CS.userId).then(() => {});

  } catch(e) { console.warn('cargarStatsCliente:', e); }
}

async function cargarHistorialVentas(clienteId) {
  CS.ventasCliente = [];
  const tbody = document.getElementById('historial-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Cargando historial…</td></tr>';

  try {
    const { data } = await sb.from('ventas')
      .select('id,numero_venta,fecha,metodo_pago_nombre,total,estado')
      .eq('cliente_id', clienteId)
      .eq('auth_user_id', CS.userId)
      .order('fecha', { ascending: false })
      .limit(50);

    CS.ventasCliente = data || [];

    if (!tbody) return;

    if (!CS.ventasCliente.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">
        <div class="empty-icon">🧾</div>
        <p>Sin ventas registradas</p>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = CS.ventasCliente.map(v => {
      const estadoCls = {
        completada:'estado-completada', anulada:'estado-anulada', devuelta:'estado-devuelta'
      }[v.estado] || 'estado-completada';
      return `
      <tr style="cursor:pointer" onclick="verDetalleVentaPerfil('${v.id}')">
        <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent);font-size:12px">${esc(v.numero_venta)}</span></td>
        <td style="color:var(--text-secondary);font-size:12.5px">${fmtFecha(v.fecha)}</td>
        <td style="color:var(--text-secondary);font-size:12.5px">${esc(v.metodo_pago_nombre || '—')}</td>
        <td style="font-family:var(--font-mono);font-weight:700">${fmt(v.total)}</td>
        <td><span class="estado-badge ${estadoCls}">${v.estado}</span></td>
      </tr>`;
    }).join('');

  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Error al cargar historial.</td></tr>`;
  }
}

/* ============================================================
   DETALLE DE VENTA DESDE PERFIL
   Reutiliza la misma data de ventas. NO duplica.
   ============================================================ */
async function verDetalleVentaPerfil(ventaId) {
  const venta = CS.ventasCliente.find(v => v.id === ventaId);
  if (!venta) return;

  CS.ventaDetalleActiva = venta;

  document.getElementById('vdet-title').textContent    = `Venta ${venta.numero_venta}`;
  document.getElementById('vdet-subtitle').textContent = fmtFecha(venta.fecha);

  const body = document.getElementById('vdet-body');
  body.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted)">Cargando…</p>';

  openModal('modal-venta-detalle');

  try {
    // Cargar detalle completo y detalles de items
    const [ventaFull, items] = await Promise.all([
      sb.from('ventas').select('*').eq('id', ventaId).eq('auth_user_id', CS.userId).maybeSingle(),
      sb.from('venta_detalles').select('*').eq('venta_id', ventaId).eq('auth_user_id', CS.userId),
    ]);

    const v = ventaFull.data;
    const its = items.data || [];
    const estadoCls = {
      completada:'estado-completada', anulada:'estado-anulada', devuelta:'estado-devuelta'
    }[v.estado] || 'estado-completada';

    body.innerHTML = `
      <div class="detalle-grid">
        <div class="detalle-item">
          <div class="detalle-label">Número</div>
          <div class="detalle-value" style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${esc(v.numero_venta)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Estado</div>
          <div class="detalle-value"><span class="estado-badge ${estadoCls}">${v.estado}</span></div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Fecha</div>
          <div class="detalle-value">${fmtFecha(v.fecha)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Método de pago</div>
          <div class="detalle-value">${esc(v.metodo_pago_nombre || '—')}</div>
        </div>
        ${v.observaciones ? `
        <div class="detalle-item full">
          <div class="detalle-label">Observaciones</div>
          <div class="detalle-value">${esc(v.observaciones)}</div>
        </div>` : ''}
        <div class="detalle-divider"></div>
        <div class="detalle-item full">
          <div class="detalle-label">Productos y servicios</div>
          <table class="detalle-items-table">
            <thead>
              <tr><th>Ítem</th><th>Tipo</th><th>Qty</th><th>Precio</th><th>Desc.</th><th>Subtotal</th></tr>
            </thead>
            <tbody>
              ${its.map(it => `
              <tr>
                <td style="font-weight:500">${esc(it.producto_nombre)}</td>
                <td><span class="tipo-item-badge ${it.tipo_item==='producto'?'badge-prod':'badge-serv'}">${it.tipo_item}</span></td>
                <td>${Number(it.cantidad).toLocaleString('es-NI',{maximumFractionDigits:2})}</td>
                <td>${fmt(it.precio)}</td>
                <td>${Number(it.descuento)>0 ? fmt(it.descuento) : '—'}</td>
                <td style="font-weight:600">${fmt(it.subtotal)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="detalle-divider"></div>
        <div class="detalle-item">
          <div class="detalle-label">Subtotal</div>
          <div class="detalle-value">${fmt(v.subtotal)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Descuento</div>
          <div class="detalle-value">${fmt(v.descuento)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">TOTAL</div>
          <div class="detalle-value" style="font-size:20px;font-weight:800;color:var(--accent)">${fmt(v.total)}</div>
        </div>
        <div class="detalle-item">
          <div class="detalle-label">Ganancia</div>
          <div class="detalle-value" style="color:var(--success);font-weight:700">${fmt(v.ganancia)}</div>
        </div>
      </div>`;
  } catch(e) {
    body.innerHTML = `<p style="color:var(--danger);padding:20px">Error: ${e.message}</p>`;
  }
}

/* ============================================================
   SECCIÓN TABS (Top, Frecuentes, Inactivos)
   ============================================================ */
let tabActiva = 'lista';

function cambiarTab(tab) {
  tabActiva = tab;
  document.querySelectorAll('.section-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));

  const paneles = { lista:'panel-lista', top:'panel-top', frecuentes:'panel-frecuentes', inactivos:'panel-inactivos' };
  Object.entries(paneles).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = k === tab ? '' : 'none';
  });

  if (tab === 'top')        loadTopClientes();
  if (tab === 'frecuentes') loadFrecuentes();
  if (tab === 'inactivos')  loadInactivos();
}

/* ---- TOP 10 CLIENTES ---- */
async function loadTopClientes() {
  const tbody = document.getElementById('top-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Cargando…</td></tr>';

  try {
    const { data } = await sb.from('clientes')
      .select('id,nombre,telefono,num_compras,total_compras,ultima_compra')
      .eq('auth_user_id', CS.userId).eq('activo', true)
      .gt('num_compras', 0)
      .order('total_compras', { ascending: false })
      .limit(10);

    if (!tbody) return;

    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell"><p>Sin datos aún. Los clientes aparecerán aquí cuando tengan compras.</p></td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((c, i) => {
      const color = colorAvatar(c.nombre);
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
      return `
      <tr onclick="abrirPerfil('${c.id}')" style="cursor:pointer">
        <td style="text-align:center;font-size:16px;width:40px">${medal}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="cli-avatar-sm" style="background:${color};font-size:11px">${iniciales(c.nombre)}</div>
            <span style="font-weight:600">${esc(c.nombre)}</span>
          </div>
        </td>
        <td style="font-family:var(--font-mono);font-weight:700;color:var(--accent);font-size:15px">${fmt(c.total_compras)}</td>
        <td style="text-align:center;font-weight:600">${c.num_compras}</td>
        <td style="color:var(--text-secondary);font-size:12.5px">${fmtFecha(c.ultima_compra)}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Error al cargar.</td></tr>`;
  }
}

/* ---- CLIENTES FRECUENTES (5+ compras) ---- */
async function loadFrecuentes() {
  const tbody = document.getElementById('frecuentes-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Cargando…</td></tr>';

  try {
    const { data } = await sb.from('clientes')
      .select('id,nombre,telefono,num_compras,total_compras,ultima_compra')
      .eq('auth_user_id', CS.userId).eq('activo', true)
      .gte('num_compras', 5)
      .order('num_compras', { ascending: false });

    if (!tbody) return;

    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell"><p>Ningún cliente con 5+ compras aún.</p></td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(c => `
      <tr onclick="abrirPerfil('${c.id}')" style="cursor:pointer">
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="cli-avatar-sm" style="background:${colorAvatar(c.nombre)};font-size:11px">${iniciales(c.nombre)}</div>
            <span style="font-weight:600">${esc(c.nombre)}</span>
          </div>
        </td>
        <td style="color:var(--text-secondary);font-size:12.5px">${c.telefono || '—'}</td>
        <td style="font-family:var(--font-mono);font-weight:700;text-align:center;color:var(--accent)">${c.num_compras}</td>
        <td style="font-family:var(--font-mono);font-weight:700">${fmt(c.total_compras)}</td>
        <td style="color:var(--text-secondary);font-size:12.5px">${fmtFecha(c.ultima_compra)}</td>
      </tr>`).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Error al cargar.</td></tr>`;
  }
}

/* ---- CLIENTES INACTIVOS ---- */
let diasInactividadFiltro = 30;

async function loadInactivos() {
  const tbody = document.getElementById('inactivos-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Cargando…</td></tr>';

  const dias = diasInactividadFiltro;
  const corte = new Date(Date.now() - dias * 86400000).toISOString().split('T')[0];

  try {
    const { data } = await sb.from('clientes')
      .select('id,nombre,telefono,num_compras,total_compras,ultima_compra')
      .eq('auth_user_id', CS.userId).eq('activo', true)
      .gt('num_compras', 0)
      .lt('ultima_compra', corte)
      .order('ultima_compra', { ascending: true });

    if (!tbody) return;

    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell"><p>¡Todos tus clientes han comprado en los últimos ${dias} días! 🎉</p></td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(c => {
      const d = diasDesde(c.ultima_compra);
      return `
      <tr onclick="abrirPerfil('${c.id}')" style="cursor:pointer">
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="cli-avatar-sm" style="background:${colorAvatar(c.nombre)};font-size:11px">${iniciales(c.nombre)}</div>
            <span style="font-weight:600">${esc(c.nombre)}</span>
          </div>
        </td>
        <td style="color:var(--text-secondary);font-size:12.5px">${c.telefono || '—'}</td>
        <td style="text-align:center">
          <span style="color:var(--danger);font-weight:700;font-family:var(--font-mono)">${d !== null ? d + ' días' : '—'}</span>
        </td>
        <td style="color:var(--text-secondary);font-size:12.5px">${fmtFecha(c.ultima_compra)}</td>
        <td style="font-family:var(--font-mono);font-weight:700">${fmt(c.total_compras)}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Error al cargar.</td></tr>`;
  }
}

function cambiarDiasInactividad(dias) {
  diasInactividadFiltro = dias;
  document.querySelectorAll('.dias-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.dias) === dias));
  loadInactivos();
}

/* ============================================================
   ELIMINAR CLIENTE
   ============================================================ */
let clienteEliminarId   = null;
let clienteEliminarNom  = '';

function confirmarEliminar(id, nombre) {
  clienteEliminarId  = id;
  clienteEliminarNom = nombre;
  document.getElementById('confirm-eliminar-nombre').textContent = nombre;
  openModal('modal-eliminar');
}

async function ejecutarEliminar() {
  if (!clienteEliminarId) return;
  const btn = document.getElementById('btn-confirmar-eliminar');
  if (btn) btn.disabled = true;

  try {
    // Soft delete: marcar como inactivo
    const { error } = await sb.from('clientes')
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq('id', clienteEliminarId)
      .eq('auth_user_id', CS.userId);

    if (error) throw error;

    showToast(`Cliente "${clienteEliminarNom}" eliminado`, 'warning');
    closeModal('modal-eliminar');
    clienteEliminarId = null;
    await Promise.allSettled([loadClientes(), loadKPIs()]);

  } catch(e) {
    showToast('Error al eliminar: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================
   SINCRONIZAR STATS DESDE VENTAS
   Llamada manual o automática para mantener coherencia
   ============================================================ */
async function sincronizarStats() {
  showToast('Sincronizando estadísticas…', 'info');
  try {
    const { data } = await sb.rpc('sincronizar_todos_clientes', { p_user_id: CS.userId });
    showToast(`${data} clientes sincronizados`, 'success');
    await Promise.allSettled([loadClientes(), loadKPIs()]);
  } catch(e) {
    // Sincronización manual como fallback
    const { data: clientes } = await sb.from('clientes')
      .select('id').eq('auth_user_id', CS.userId).eq('activo', true);

    for (const c of (clientes || [])) {
      await cargarStatsCliente(c.id);
    }
    showToast('Estadísticas actualizadas', 'success');
    await Promise.allSettled([loadClientes(), loadKPIs()]);
  }
}

/* ============================================================
   EXPORTS GLOBALES
   ============================================================ */
window.toggleTheme          = toggleTheme;
window.toggleSidebar        = toggleSidebar;
window.navigate             = navigate;
window.openModal            = openModal;
window.closeModal           = closeModal;
window.setFiltro            = setFiltro;
window.buscarClientes       = buscarClientes;
window.paginaAnterior       = paginaAnterior;
window.paginaSiguiente      = paginaSiguiente;
window.abrirModalNuevoCliente = abrirModalNuevoCliente;
window.abrirEditar          = abrirEditar;
window.guardarCliente       = guardarCliente;
window.abrirPerfil          = abrirPerfil;
window.verDetalleVentaPerfil = verDetalleVentaPerfil;
window.cambiarTab           = cambiarTab;
window.cambiarDiasInactividad = cambiarDiasInactividad;
window.confirmarEliminar    = confirmarEliminar;
window.ejecutarEliminar     = ejecutarEliminar;
window.sincronizarStats     = sincronizarStats;
window.loadClientes         = loadClientes;

/* ============================================================
   KEYBOARD
   ============================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['modal-cliente','modal-perfil','modal-venta-detalle','modal-eliminar'].forEach(closeModal);
  }
});

/* ============================================================
   INIT
   ============================================================ */
async function initClientes() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');

  const now = new Date();
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = now.toLocaleDateString('es-NI',
    { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data:{ user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }

    CS.userId    = user.id;
    CS.userEmail = user.email;

    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);

    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    else {
      document.getElementById('header-name').textContent   = user.email?.split('@')[0] || 'Usuario';
      document.getElementById('header-avatar').textContent = (user.email||'U')[0].toUpperCase();
    }

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await Promise.allSettled([loadKPIs(), loadClientes()]);

    // Escuchar cambios de ventas.js en tiempo real vía localStorage
    window.addEventListener('storage', e => {
      if (e.key === 'n360_venta_nueva') {
        loadKPIs();
        // Actualizar stats del cliente de esa venta si está en lista
        try {
          const d = JSON.parse(e.newValue);
          if (d?.ventaId) {
            // Recargar tabla para reflejar actualizaciones de ventas.js
            loadClientes();
          }
        } catch { /* silencioso */ }
      }
    });

  } catch(err) {
    console.error('initClientes:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.href = 'login.html';
});

document.addEventListener('DOMContentLoaded', () => {
  initClientes();
  if (window.lucide) lucide.createIcons();
});
