/* ============================================================
   FIADOS.JS — NEGOCIO360
   Cuaderno de fiados estilo pulpería: anotar quién debe, cuánto,
   cobrar (total o abono) y eliminar si hubo error.
   Conexiones: Clientes, Productos/Inventario, Ventas (si el fiado
   lleva productos), Caja (al cobrar entra el dinero).
   No toca Créditos ni ningún otro módulo.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.__cajaSB || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const FD = {
  userId: null, empresaConfig: {}, perfilNombre: 'Usuario',
  clientes: [], productos: [], escalas: {}, metodos: [], bancos: [],
  fiados: [], pagos: {}, filtro: 'pendiente', busqueda: '',
  abiertos: new Set(), nuevo: null, cobro: null,
};

/* ---------- utilidades ---------- */
const esc = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function hoyISO() { return ymd(new Date()); }
function sym() {
  const m = FD.empresaConfig?.moneda;
  if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} }
  return m === 'USD' ? '$' : 'C$';
}
function fmt(n) {
  // Antes solo cambiaba la etiqueta (USD) sin convertir el número. Ahora
  // convierte también el número, igual que el resto de módulos. Solo afecta
  // lo que se ve; los saldos guardados no cambian.
  let v = Number(n || 0);
  if (typeof convertirParaMostrar === 'function') { try { v = convertirParaMostrar(v, FD.empresaConfig?.moneda); } catch (_) {} }
  return sym() + ' ' + v.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function diasDesde(iso) {
  const a = new Date(String(iso).slice(0, 10) + 'T12:00:00'), b = new Date(hoyISO() + 'T12:00:00');
  const d = Math.round((b - a) / 86400000);
  return isFinite(d) ? Math.max(0, d) : 0;
}
function cantTxt(n) {
  if (window.N360Cant) return N360Cant.bonito(n);
  return Number(n).toLocaleString('es-NI', { maximumFractionDigits: 6 });
}
function quitarTildes(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

/* ---------- tema / sidebar / toast (idéntico al resto) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('n360_theme', t);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = t === 'dark' ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
let sidebarCollapsed = false;
function isMobileView() { return window.innerWidth <= 768; }
function toggleSidebar() {
  if (isMobileView()) {
    const sb_ = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
    if (!sb_) return;
    const open = sb_.classList.toggle('mobile-open');
    if (ov) ov.classList.toggle('active', open);
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}
function closeMobileSidebar() {
  const s = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
  if (s) s.classList.remove('mobile-open');
  if (ov) ov.classList.remove('active');
}
window.addEventListener('resize', () => { if (!isMobileView()) closeMobileSidebar(); });
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
let _tt = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type} show`;
  clearTimeout(_tt); _tt = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ---------- empresa / perfil ---------- */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    if (data) {
      FD.empresaConfig = data;
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = data.nombre_comercial || 'Mi negocio';
      if (data.color_principal) {
        document.documentElement.style.setProperty('--accent', data.color_principal);
        document.documentElement.style.setProperty('--accent-soft', data.color_principal + '22');
        document.documentElement.style.setProperty('--border-focus', data.color_principal);
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try { const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle(); return data; } catch { return null; }
}
function renderUserInfo(user, email) {
  if (!user) return;
  const nombre = user.nombre || email?.split('@')[0] || 'Usuario', apellido = user.apellido || '';
  FD.perfilNombre = `${nombre} ${apellido}`.trim();
  document.getElementById('header-name').textContent = FD.perfilNombre;
  document.getElementById('header-biz').textContent = FD.empresaConfig?.nombre_comercial || 'Mi negocio';
  document.getElementById('header-avatar').textContent = ((nombre[0] || '') + (apellido[0] || '')).toUpperCase() || 'U';
  const pt = document.getElementById('plan-text'); if (pt) { const p = user.plan || 'Gratuito'; pt.textContent = p.charAt(0).toUpperCase() + p.slice(1); }
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sb.from('administradores').select('email,activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const el = document.getElementById('nav-admin'); if (el) el.style.display = 'flex'; }
  } catch { /* silencioso */ }
}
function nombrePerfilActivo() {
  try { const p = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (p?.nombre) return p.nombre; } catch (_) {}
  return FD.perfilNombre;
}

/* ---------- modales y confirmación propios ---------- */
function abrirModal(id) { const m = document.getElementById(id); if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; } }
function cerrarModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); if (!document.querySelector('.fd-modal.open')) document.body.style.overflow = ''; }
function confirmar(titulo, texto, textoBoton = 'Continuar', peligro = false) {
  return new Promise(resolve => {
    document.getElementById('fd-conf-titulo').textContent = titulo;
    document.getElementById('fd-conf-texto').textContent = texto;
    const ok = document.getElementById('fd-conf-ok');
    ok.textContent = textoBoton; ok.className = peligro ? 'fd-btn fd-btn-danger' : 'fd-btn fd-btn-primary';
    const fin = v => { ok.onclick = null; document.getElementById('fd-conf-no').onclick = null; cerrarModal('modal-confirmar'); resolve(v); };
    ok.onclick = () => fin(true);
    document.getElementById('fd-conf-no').onclick = () => fin(false);
    abrirModal('modal-confirmar');
  });
}

/* ============================================================
   CARGA DE DATOS
   ============================================================ */
async function paginar(construir) {
  const out = []; const TAM = 1000;
  for (let desde = 0; desde < 50000; desde += TAM) {
    const { data, error } = await construir().range(desde, desde + TAM - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < TAM) break;
  }
  return out;
}

async function cargarClientes() {
  const { data } = await N360Leer.todo(() => sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp,limite_credito')
    .eq('auth_user_id', FD.userId).eq('activo', true).order('nombre'), 'clientes');
  FD.clientes = data || [];
}
async function cargarMetodos() {
  try {
    const { data } = await sb.from('metodos_pago').select('*').eq('auth_user_id', FD.userId).eq('activo', true).order('orden');
    FD.metodos = data || [];
  } catch (_) { FD.metodos = []; }
  try {
    const { data } = await sb.from('bancos').select('id,nombre,moneda,activo').eq('auth_user_id', FD.userId).eq('activo', true).order('nombre');
    FD.bancos = data || [];
  } catch (_) { FD.bancos = []; }
}
async function cargarProductos() {
  const { data } = await N360Leer.todo(() => sb.from('productos')
    .select('id,tipo,nombre,sku,precio,costo,stock_actual,tipo_precio,unidad_codigo,permite_fraccion')
    .eq('auth_user_id', FD.userId).eq('activo', true).eq('es_materia_prima', false).order('nombre'), 'productos');
  FD.productos = (data || []).filter(p => p.tipo === 'producto' || p.tipo === 'servicio');
  FD.escalas = {};
  try {
    const { data: esc_ } = await N360Leer.todo(() => sb.from('precios_escala').select('id,producto_id,nombre,precio,orden').eq('auth_user_id', FD.userId).order('orden'), 'escalas de precio');
    (esc_ || []).forEach(e => { (FD.escalas[e.producto_id] = FD.escalas[e.producto_id] || []).push(e); });
  } catch (_) { /* sin escalas */ }
}
async function cargarFiados() {
  FD.fiados = await paginar(() => sb.from('fiados').select('*').eq('auth_user_id', FD.userId)
    .neq('estado', 'eliminado').order('fecha', { ascending: false }).order('created_at', { ascending: false }));
  FD.pagos = {};
  const ids = FD.fiados.map(f => f.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await sb.from('fiado_pagos').select('*').in('fiado_id', ids.slice(i, i + 150)).order('created_at');
    (data || []).forEach(p => { (FD.pagos[p.fiado_id] = FD.pagos[p.fiado_id] || []).push(p); });
  }
}

/* ============================================================
   RESUMEN + LISTA
   ============================================================ */
function claveCliente(f) { return f.cliente_id || ('n:' + quitarTildes(f.cliente_nombre)); }
function saldoPendienteDeCliente(clienteId, nombre) {
  return r2(FD.fiados.filter(f => f.estado === 'pendiente' && (clienteId ? f.cliente_id === clienteId : quitarTildes(f.cliente_nombre) === quitarTildes(nombre)))
    .reduce((s, f) => s + Number(f.saldo || 0), 0));
}

function renderResumen() {
  const pend = FD.fiados.filter(f => f.estado === 'pendiente');
  const total = r2(pend.reduce((s, f) => s + Number(f.saldo || 0), 0));
  const personas = new Set(pend.map(claveCliente)).size;
  const mes = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  let cobradoMes = 0;
  Object.values(FD.pagos).flat().forEach(p => { if (String(p.created_at).slice(0, 10) >= mes) cobradoMes += Number(p.monto || 0); });
  const viejo = pend.reduce((m, f) => (!m || f.fecha < m.fecha ? f : m), null);
  document.getElementById('fd-kpis').innerHTML = `
    <div class="fd-kpi"><span>Te deben</span><b>${esc(fmt(total))}</b><small>${pend.length} fiado${pend.length === 1 ? '' : 's'} pendiente${pend.length === 1 ? '' : 's'}</small></div>
    <div class="fd-kpi"><span>Personas que deben</span><b>${personas}</b><small>clientes con saldo</small></div>
    <div class="fd-kpi"><span>Cobrado este mes</span><b>${esc(fmt(r2(cobradoMes)))}</b><small>pagos y abonos</small></div>
    <div class="fd-kpi"><span>El más antiguo</span><b>${viejo ? diasDesde(viejo.fecha) + ' días' : '—'}</b><small>${viejo ? esc(viejo.cliente_nombre) : 'sin deudas'}</small></div>`;
}

function filtrarFiados() {
  const q = quitarTildes(FD.busqueda);
  return FD.fiados.filter(f => {
    if (FD.filtro === 'pendiente' && f.estado !== 'pendiente') return false;
    if (FD.filtro === 'pagado' && f.estado !== 'pagado') return false;
    if (q && !(quitarTildes(f.cliente_nombre).includes(q) || quitarTildes(f.descripcion).includes(q))) return false;
    return true;
  });
}

function renderLista() {
  const cont = document.getElementById('fd-lista');
  const lista = filtrarFiados();
  if (!lista.length) {
    cont.innerHTML = `<div class="fd-vacio"><div class="fd-vacio-i">📒</div>
      <b>${FD.fiados.length ? 'No hay fiados con ese filtro' : 'Aún no has anotado fiados'}</b>
      <p>${FD.fiados.length ? 'Prueba con otro filtro o búsqueda.' : 'Toca “Nuevo fiado” para anotar el primero.'}</p></div>`;
    return;
  }
  const grupos = new Map();
  lista.forEach(f => {
    const k = claveCliente(f);
    if (!grupos.has(k)) grupos.set(k, { clave: k, cliente_id: f.cliente_id, nombre: f.cliente_nombre, fiados: [] });
    grupos.get(k).fiados.push(f);
  });
  const arr = [...grupos.values()].map(g => ({ ...g, saldo: r2(g.fiados.filter(f => f.estado === 'pendiente').reduce((s, f) => s + Number(f.saldo || 0), 0)) }))
    .sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre));
  cont.innerHTML = arr.map(g => {
    const abierto = FD.abiertos.has(g.clave);
    const pendientes = g.fiados.filter(f => f.estado === 'pendiente');
    const cli = g.cliente_id ? FD.clientes.find(c => c.id === g.cliente_id) : null;
    const tel = cli ? (cli.whatsapp || cli.telefono) : '';
    const viejo = pendientes.reduce((m, f) => (!m || f.fecha < m ? f.fecha : m), null);
    return `<div class="fd-cliente" data-clave="${esc(g.clave)}">
      <div class="fd-cliente-cab" data-fd-toggle="${esc(g.clave)}">
        <div class="fd-av">${esc((g.nombre || '?')[0].toUpperCase())}</div>
        <div class="fd-cliente-info"><b>${esc(g.nombre)}</b>
          <small>${pendientes.length ? `${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} · desde hace ${diasDesde(viejo)} días` : 'Sin deudas pendientes'}</small></div>
        <div class="fd-cliente-saldo ${g.saldo > 0 ? 'debe' : 'ok'}">${g.saldo > 0 ? esc(fmt(g.saldo)) : 'Al día'}</div>
        <div class="fd-chev">${abierto ? '▾' : '▸'}</div>
      </div>
      ${abierto ? `<div class="fd-cliente-cuerpo">
        ${g.saldo > 0 ? `<div class="fd-acciones-cliente">
          <button type="button" class="fd-btn fd-btn-ok" data-fd-cobrar-todo="${esc(g.clave)}">✅ Cobrar todo (${esc(fmt(g.saldo))})</button>
          <button type="button" class="fd-btn fd-btn-sec" data-fd-wa="${esc(g.clave)}" data-tel="${esc(tel || '')}">💬 Recordar por WhatsApp</button>
          <button type="button" class="fd-btn fd-btn-sec" data-fd-nuevo-para="${esc(g.cliente_id || '')}" data-nombre="${esc(g.nombre)}">＋ Fiar más</button>
        </div>` : ''}
        ${g.fiados.map(f => filaFiado(f)).join('')}
      </div>` : ''}
    </div>`;
  }).join('');
}

function filaFiado(f) {
  const pagos = FD.pagos[f.id] || [];
  const pend = f.estado === 'pendiente';
  const abonos = pagos.length ? `<div class="fd-abonos">${pagos.map(p => `Abono ${esc(fmtFecha(String(p.created_at).slice(0, 10)))}: ${esc(fmt(p.monto))} <span>(${esc(p.metodo_pago_nombre || '')})</span>`).join('<br>')}</div>` : '';
  return `<div class="fd-fiado ${pend ? '' : 'pagado'}" data-id="${esc(f.id)}">
    <div class="fd-fiado-top">
      <div class="fd-fiado-desc"><b>${esc(f.descripcion || (f.tipo === 'productos' ? 'Fiado con productos' : 'Fiado'))}</b>
        <small>${esc(fmtFecha(f.fecha))}${f.tipo === 'productos' ? ' · con productos' : ''}${pend ? ` · ${diasDesde(f.fecha)} días` : ''}</small></div>
      <div class="fd-fiado-montos">
        <span class="fd-saldo ${pend ? '' : 'ok'}">${pend ? esc(fmt(f.saldo)) : 'Pagado'}</span>
        ${Number(f.monto_pagado) > 0 && pend ? `<small>de ${esc(fmt(f.monto_total))}</small>` : (!pend ? `<small>${esc(fmt(f.monto_total))}</small>` : '')}
      </div>
    </div>
    ${abonos}
    ${f.tipo === 'productos' && f.venta_id ? `<div class="fd-detalle" data-fd-detalle="${esc(f.id)}"><button type="button" class="fd-link" data-fd-ver-detalle="${esc(f.id)}">Ver productos</button></div>` : ''}
    <div class="fd-fiado-btns">
      ${pend ? `<button type="button" class="fd-btn fd-btn-ok" data-fd-pagar="${esc(f.id)}">✅ Pagado</button>
      <button type="button" class="fd-btn fd-btn-sec" data-fd-abono="${esc(f.id)}">💵 Abono</button>` : ''}
      <button type="button" class="fd-btn fd-btn-borrar" data-fd-borrar="${esc(f.id)}" title="Eliminar">🗑 Eliminar</button>
    </div>
  </div>`;
}

function renderTodo() { renderResumen(); renderLista(); }

/* ============================================================
   NUEVO FIADO
   ============================================================ */
function nuevoFiadoVacio() { return { clienteId: '', clienteNombre: '', telefono: '', tipo: 'monto', items: [] }; }

function abrirNuevoFiado(clienteId, nombre) {
  FD.nuevo = nuevoFiadoVacio();
  if (clienteId) { FD.nuevo.clienteId = clienteId; const c = FD.clientes.find(x => x.id === clienteId); FD.nuevo.clienteNombre = c ? `${c.nombre} ${c.apellido || ''}`.trim() : (nombre || ''); }
  else if (nombre) FD.nuevo.clienteNombre = nombre;
  document.getElementById('nf-cliente').value = FD.nuevo.clienteNombre;
  document.getElementById('nf-tel').value = '';
  document.getElementById('nf-monto').value = '';
  document.getElementById('nf-desc').value = '';
  document.getElementById('nf-fecha').value = hoyISO();
  document.getElementById('nf-error').textContent = '';
  document.getElementById('nf-sugerencias').innerHTML = '';
  document.getElementById('nf-buscar-prod').value = '';
  document.getElementById('nf-prod-res').innerHTML = '';
  setTipoFiado('monto');
  actualizarAvisoCliente();
  abrirModal('modal-nuevo');
  setTimeout(() => document.getElementById(FD.nuevo.clienteNombre ? 'nf-monto' : 'nf-cliente').focus(), 80);
}

function setTipoFiado(t) {
  FD.nuevo.tipo = t;
  document.querySelectorAll('[data-fd-tipo]').forEach(b => b.classList.toggle('on', b.dataset.fdTipo === t));
  document.getElementById('nf-bloque-monto').style.display = t === 'monto' ? '' : 'none';
  document.getElementById('nf-bloque-prod').style.display = t === 'productos' ? '' : 'none';
  renderItemsNuevo();
}

function onClienteInput() {
  const txt = document.getElementById('nf-cliente').value.trim();
  const q = quitarTildes(txt);
  FD.nuevo.clienteNombre = txt;
  const exacto = FD.clientes.find(c => quitarTildes(`${c.nombre} ${c.apellido || ''}`.trim()) === q);
  FD.nuevo.clienteId = exacto ? exacto.id : '';
  const cont = document.getElementById('nf-sugerencias');
  if (!q || exacto) { cont.innerHTML = ''; actualizarAvisoCliente(); return; }
  const m = FD.clientes.filter(c => quitarTildes(`${c.nombre} ${c.apellido || ''}`).includes(q)).slice(0, 6);
  cont.innerHTML = m.map(c => `<button type="button" class="fd-sug" data-fd-sug="${esc(c.id)}">${esc(c.nombre)} ${esc(c.apellido || '')}${c.telefono ? ` <small>${esc(c.telefono)}</small>` : ''}</button>`).join('')
    + `<div class="fd-sug-nuevo">${m.length ? 'O se creará como cliente nuevo' : 'Cliente nuevo: se creará con este nombre'}</div>`;
  actualizarAvisoCliente();
}

function actualizarAvisoCliente() {
  const el = document.getElementById('nf-aviso'); if (!el) return;
  const n = FD.nuevo; if (!n) return;
  const cli = n.clienteId ? FD.clientes.find(c => c.id === n.clienteId) : null;
  document.getElementById('nf-tel-wrap').style.display = (n.clienteNombre && !n.clienteId) ? '' : 'none';
  const deuda = n.clienteNombre ? saldoPendienteDeCliente(n.clienteId, n.clienteNombre) : 0;
  const nuevoMonto = montoNuevo();
  const limite = Number(cli?.limite_credito || 0);
  let html = '';
  if (deuda > 0) html += `Este cliente ya te debe <b>${esc(fmt(deuda))}</b>. `;
  if (limite > 0 && deuda + nuevoMonto > limite) html += `<span class="fd-aviso-rojo">⚠️ Con este fiado pasaría su límite de ${esc(fmt(limite))}.</span>`;
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}

function montoNuevo() {
  const n = FD.nuevo; if (!n) return 0;
  if (n.tipo === 'monto') return r2(Number(document.getElementById('nf-monto').value) || 0);
  return r2(n.items.reduce((s, i) => s + i.precio * i.cantidad, 0));
}

/* ---- productos del fiado ---- */
function buscarProductoNuevo() {
  const q = quitarTildes(document.getElementById('nf-buscar-prod').value.trim());
  const cont = document.getElementById('nf-prod-res');
  if (!q) { cont.innerHTML = ''; return; }
  const m = FD.productos.filter(p => quitarTildes(p.nombre).includes(q) || quitarTildes(p.sku).includes(q)).slice(0, 8);
  cont.innerHTML = m.length ? m.map(p => `<button type="button" class="fd-sug" data-fd-add="${esc(p.id)}">${esc(p.nombre)} <small>${esc(fmt(p.precio))}${p.tipo === 'producto' ? ' · stock ' + esc(cantTxt(p.stock_actual || 0)) : ''}</small></button>`).join('')
    : '<div class="fd-sug-nuevo">Sin resultados</div>';
}

function agregarProductoNuevo(id) {
  const p = FD.productos.find(x => x.id === id); if (!p) return;
  const escalas = FD.escalas[id] || [];
  const ya = FD.nuevo.items.find(i => i.producto_id === id && !i.escala_id);
  if (ya && !escalas.length) { ya.cantidad = r2(ya.cantidad + 1); }
  else {
    const e0 = (p.tipo_precio === 'escala' && escalas.length) ? escalas[0] : null;
    FD.nuevo.items.push({
      producto_id: id, nombre: p.nombre, sku: p.sku || null, tipo_item: p.tipo, costo: Number(p.costo || 0),
      precio: e0 ? Number(e0.precio) : Number(p.precio || 0), cantidad: 1, texto: '1',
      escala_id: e0 ? e0.id : null, escala_nombre: e0 ? e0.nombre : null,
      escalas: p.tipo_precio === 'escala' ? escalas : [], permite_fraccion: p.permite_fraccion !== false,
    });
  }
  document.getElementById('nf-buscar-prod').value = '';
  document.getElementById('nf-prod-res').innerHTML = '';
  renderItemsNuevo();
}

function renderItemsNuevo() {
  const n = FD.nuevo; if (!n) return;
  const cont = document.getElementById('nf-items');
  cont.innerHTML = n.items.length ? n.items.map((it, i) => `<div class="fd-item">
      <div class="fd-item-n"><b>${esc(it.nombre)}</b>
        ${it.escalas.length ? `<select data-fd-escala="${i}">${it.escalas.map(e => `<option value="${esc(e.id)}"${e.id === it.escala_id ? ' selected' : ''}>${esc(e.nombre)} · ${esc(fmt(e.precio))}</option>`).join('')}</select>` : `<small>${esc(fmt(it.precio))} c/u</small>`}</div>
      <input type="text" inputmode="decimal" class="fd-item-cant" value="${esc(it.texto)}" data-fd-cant="${i}" aria-label="Cantidad"/>
      <div class="fd-item-sub">${esc(fmt(r2(it.precio * it.cantidad)))}</div>
      <button type="button" class="fd-x" data-fd-quitar="${i}" aria-label="Quitar">✕</button></div>`).join('')
    : '<div class="fd-vacio-mini">Busca y agrega los productos que se llevó.</div>';
  document.getElementById('nf-total-prod').textContent = fmt(montoNuevo());
  actualizarAvisoCliente();
}

function cambiarCantidadItem(i, texto) {
  const it = FD.nuevo.items[i]; if (!it) return;
  it.texto = texto;
  let v = NaN;
  if (window.N360Cant) { const r = N360Cant.parse(texto); v = r && typeof r === 'object' ? r.valor : r; }
  else v = Number(String(texto).replace(',', '.'));
  if (isFinite(v) && v > 0) {
    // Producto marcado "solo unidades enteras" en Productos: no se acepta media, un cuarto, etc.
    if (it.permite_fraccion === false && Math.abs(v - Math.round(v)) > 1e-9) {
      showToast(`"${it.nombre}" se vende en unidades enteras. Escribe un número entero.`, 'error');
    } else it.cantidad = v;
  }
  const sub = document.querySelectorAll('#nf-items .fd-item-sub')[i]; if (sub) sub.textContent = fmt(r2(it.precio * it.cantidad));
  document.getElementById('nf-total-prod').textContent = fmt(montoNuevo());
  actualizarAvisoCliente();
}

/* ---- guardar ---- */
async function asegurarCliente() {
  const n = FD.nuevo;
  if (n.clienteId) return n.clienteId;
  const nombre = n.clienteNombre.trim();
  const existente = FD.clientes.find(c => quitarTildes(`${c.nombre} ${c.apellido || ''}`.trim()) === quitarTildes(nombre));
  if (existente) return existente.id;
  const tel = document.getElementById('nf-tel').value.trim() || null;
  const { data, error } = await sb.from('clientes').insert({ auth_user_id: FD.userId, nombre, telefono: tel }).select('id,nombre,apellido,telefono,whatsapp,limite_credito').single();
  if (error) throw error;
  FD.clientes.push(data);
  return data.id;
}

async function guardarNuevoFiado() {
  const n = FD.nuevo; const err = document.getElementById('nf-error'); err.textContent = '';
  const nombre = (n.clienteNombre || '').trim();
  if (!nombre) { err.textContent = 'Escribe el nombre de quien se lleva el fiado.'; return; }
  const fecha = document.getElementById('nf-fecha').value || hoyISO();
  let total = 0, descripcion = document.getElementById('nf-desc').value.trim() || null;
  if (n.tipo === 'monto') {
    total = r2(Number(document.getElementById('nf-monto').value));
    if (!(total > 0)) { err.textContent = 'Escribe cuánto se le fía (mayor a cero).'; return; }
  } else {
    if (!n.items.length) { err.textContent = 'Agrega al menos un producto.'; return; }
    if (n.items.some(i => !(i.cantidad > 0))) { err.textContent = 'Revisa las cantidades: deben ser mayores a cero.'; return; }
    total = montoNuevo();
    if (!(total > 0)) { err.textContent = 'El total debe ser mayor a cero.'; return; }
    if (!descripcion) descripcion = n.items.map(i => `${cantTxt(i.cantidad)} ${i.nombre}`).join(', ').slice(0, 200);
  }
  // Aviso de límite (solo aviso, nunca bloquea)
  const cli = n.clienteId ? FD.clientes.find(c => c.id === n.clienteId) : null;
  const limite = Number(cli?.limite_credito || 0);
  if (limite > 0) {
    const deuda = saldoPendienteDeCliente(n.clienteId, nombre);
    if (deuda + total > limite) {
      const sigue = await confirmar('Pasa el límite del cliente', `${nombre} ya debe ${fmt(deuda)} y su límite es ${fmt(limite)}. Con este fiado sería ${fmt(deuda + total)}. ¿Quieres fiarle de todas formas?`, 'Sí, fiar');
      if (!sigue) return;
    }
  }
  const btn = document.getElementById('nf-guardar'); btn.disabled = true;
  try {
    const clienteId = await asegurarCliente();
    const nombreCli = (() => { const c = FD.clientes.find(x => x.id === clienteId); return c ? `${c.nombre} ${c.apellido || ''}`.trim() : nombre; })();
    let ventaId = null;
    if (n.tipo === 'productos') ventaId = await crearVentaDeFiado(n, clienteId, nombreCli, total, fecha);
    const { error } = await sb.from('fiados').insert({
      auth_user_id: FD.userId, cliente_id: clienteId, cliente_nombre: nombreCli, tipo: n.tipo, descripcion,
      monto_total: total, monto_pagado: 0, saldo: total, estado: 'pendiente', fecha, venta_id: ventaId,
      creado_por_nombre: nombrePerfilActivo(),
    });
    if (error) {
      if (ventaId) await revertirVentaFiado(ventaId, n.items);
      throw error;
    }
    cerrarModal('modal-nuevo');
    showToast(`Fiado de ${fmt(total)} anotado a ${nombreCli}`);
    FD.abiertos.add(clienteId);
    FD.filtro = 'pendiente'; document.getElementById('fd-filtro').value = 'pendiente';
    await Promise.all([cargarFiados(), n.tipo === 'productos' ? cargarProductos() : Promise.resolve()]);
    renderTodo();
  } catch (e) {
    console.error('guardarNuevoFiado:', e);
    err.textContent = 'No se pudo guardar: ' + (e.message || 'intenta de nuevo');
  } finally { btn.disabled = false; }
}

/* ---- venta + inventario para fiados con productos ---- */
async function crearVentaDeFiado(n, clienteId, nombreCli, total, fecha) {
  let numeroVenta = null;
  try { const { data } = await sb.rpc('generar_numero_venta', { p_user_id: FD.userId }); numeroVenta = data || null; } catch (_) {}
  const costoTotal = r2(n.items.reduce((s, i) => s + i.costo * i.cantidad, 0));
  const { data: venta, error: eV } = await sb.from('ventas').insert({
    auth_user_id: FD.userId, cliente_id: clienteId, cliente_nombre: nombreCli, numero_venta: numeroVenta,
    subtotal: total, impuesto: 0, total, costo_total: costoTotal, ganancia: r2(total - costoTotal),
    metodo_pago: 'fiado', estado_pago: 'credito', estado: 'completada', iva_activo: false, iva_porcentaje: 0,
    categoria: 'fiado', notas: 'Venta generada automáticamente por el módulo de Fiados',
    creado_por_nombre: nombrePerfilActivo(), fecha: new Date(fecha + 'T12:00:00').toISOString(),
  }).select().single();
  if (eV) throw eV;
  const detalles = n.items.map(it => ({
    venta_id: venta.id, auth_user_id: FD.userId, producto_id: it.producto_id, producto_nombre: it.nombre, producto_sku: it.sku,
    tipo_item: it.tipo_item, cantidad: it.cantidad, precio: it.precio, costo: it.costo, subtotal: r2(it.precio * it.cantidad),
    ganancia: r2((it.precio - it.costo) * it.cantidad), escala_id: it.escala_id || null, escala_nombre: it.escala_nombre || null,
  }));
  const { error: eD } = await sb.from('venta_detalles').insert(detalles);
  if (eD) { await sb.from('ventas').delete().eq('id', venta.id); throw eD; }
  // Inventario: el producto ya salió, se descuenta ahora
  // (en el servidor, restando sobre la existencia REAL; nunca baja de 0)
  const descontar = n.items.filter(it => it.tipo_item === 'producto' && it.producto_id)
    .map(it => ({ producto_id: it.producto_id, delta: -Number(it.cantidad || 0) }));
  if (descontar.length) {
    const { error: eS } = await sb.rpc('ajustar_stock_relativo', { p_items: descontar });
    if (eS) console.warn('Inventario del fiado:', eS);
  }
  await ajustarCompras(clienteId, total, 1);
  return venta.id;
}

async function ajustarCompras(clienteId, monto, signo) {
  try {
    const { data: c } = await sb.from('clientes').select('total_compras,num_compras').eq('id', clienteId).eq('auth_user_id', FD.userId).maybeSingle();
    if (c) await sb.from('clientes').update({ total_compras: Math.max(0, r2(Number(c.total_compras || 0) + signo * monto)), num_compras: Math.max(0, Number(c.num_compras || 0) + signo) }).eq('id', clienteId).eq('auth_user_id', FD.userId);
  } catch (e) { console.warn('ajustarCompras:', e); }
}

// Devoluciones (Ventas): una venta con devoluciones ya no se anula ni se cambia desde aquí.
// Devuelve un mensaje si no se puede seguir, o null. Se revisa ANTES de tocar inventario o Caja.
async function bloqueoDevolucionesVenta(cli, ventaId) {
  if (!ventaId) return null;
  try {
    const r = await cli.from('devoluciones_venta').select('id', { count: 'exact', head: true }).eq('venta_id', ventaId);
    if (r.error) return 'No se pudo comprobar si la venta tiene devoluciones. Revisa tu conexión e intenta de nuevo.';
    return (r.count || 0) > 0 ? 'La venta de esto tiene devoluciones registradas (Ventas › Devolución): ya no se puede anular ni cambiar desde aquí.' : null;
  } catch (_) { return 'No se pudo comprobar si la venta tiene devoluciones. Revisa tu conexión e intenta de nuevo.'; }
}

async function devolverStockDeVenta(ventaId) {
  // Se suma en el servidor sobre la existencia REAL, en una sola operación.
  // Igual que se descontó al vender: presentaciones (caja x12) y combos.
  const { data: dets } = await sb.from('venta_detalles').select('producto_id,combo_id,cantidad,tipo_item,presentacion_factor').eq('venta_id', ventaId);
  const devolver = [];
  for (const d of (dets || [])) {
    if (d.tipo_item !== 'producto') continue;
    const factor = Number(d.presentacion_factor) > 0 ? Number(d.presentacion_factor) : 1;
    if (d.producto_id) devolver.push({ producto_id: d.producto_id, delta: Number(d.cantidad || 0) * factor });
    else if (d.combo_id) devolver.push({ combo_id: d.combo_id, delta: Number(d.cantidad || 0) });
  }
  if (devolver.length) {
    const { error } = await sb.rpc('ajustar_stock_relativo', { p_items: devolver });
    if (error) throw error;
  }
}
// Si la venta (hecha desde Ventas) registró IVA, al eliminar el fiado se revierte con un registro nuevo que resta.
async function revertirIvaDeVenta(ventaId, etiqueta) {
  try {
    const { data: movIva } = await sb.from('movimientos_impuestos').select('monto')
      .eq('referencia_venta_id', ventaId).eq('auth_user_id', FD.userId).eq('tipo_movimiento', 'IVA_VENTA').gt('monto', 0).maybeSingle();
    if (!movIva || !(Number(movIva.monto) > 0)) return;
    const { data: ult } = await sb.from('movimientos_impuestos').select('saldo_resultante').eq('auth_user_id', FD.userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const ant = ult ? Number(ult.saldo_resultante) : 0, m = r2(Number(movIva.monto));
    await sb.from('movimientos_impuestos').insert({
      auth_user_id: FD.userId, tipo_movimiento: 'IVA_VENTA', concepto: `Reverso de IVA por eliminar fiado de ${etiqueta || 'cliente'}`,
      monto: -m, saldo_anterior: ant, saldo_resultante: r2(ant - m), referencia_venta_id: ventaId, fecha: hoyISO(),
    });
  } catch (e) { console.warn('revertirIvaDeVenta:', e); }
}
// Anula la venta del fiado en UNA operación del servidor (todo o nada):
// inventario (con presentaciones y combos), estado, historial del cliente
// e IVA. Si ya estaba anulada, no repite nada. No toca Caja (un fiado no entró a Caja).
async function anularVentaDelFiado(ventaId) {
  const { data, error } = await sb.rpc('venta_anular_atomica', { p_venta_id: ventaId, p_descontar_caja: false, p_fecha: hoyISO() });
  if (error) throw error;
  return data;
}
async function revertirVentaFiado(ventaId) {
  try { await anularVentaDelFiado(ventaId); }
  catch (e) { console.warn('revertirVentaFiado:', e); }
}

/* ============================================================
   COBRAR: PAGADO / ABONO / COBRAR TODO
   ============================================================ */
function opcionesMetodos() {
  if (!FD.metodos.length) return '<option value="">Efectivo</option>';
  return FD.metodos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
}

function abrirCobro(modo, ids) {
  const fiados = ids.map(id => FD.fiados.find(f => f.id === id)).filter(f => f && f.estado === 'pendiente');
  if (!fiados.length) return;
  const saldo = r2(fiados.reduce((s, f) => s + Number(f.saldo || 0), 0));
  FD.cobro = { modo, ids: fiados.map(f => f.id), saldo };
  const titulo = modo === 'abono' ? '💵 Registrar abono' : (fiados.length > 1 ? '✅ Cobrar todo' : '✅ Marcar como pagado');
  document.getElementById('co-titulo').textContent = titulo;
  document.getElementById('co-resumen').innerHTML = `<b>${esc(fiados[0].cliente_nombre)}</b><br><small>${fiados.length > 1 ? fiados.length + ' fiados · ' : ''}Saldo pendiente: <b>${esc(fmt(saldo))}</b></small>`;
  const campo = document.getElementById('co-monto');
  campo.value = modo === 'abono' ? '' : String(saldo);
  campo.readOnly = modo !== 'abono';
  if (window.N360MonedaAlterna) {
    N360MonedaAlterna.adjuntar(campo, () => ({ moneda: FD.empresaConfig?.moneda, tasa: FD.empresaConfig?.tasa_cambio_usd }));
    N360MonedaAlterna.reset(campo);
  }
  document.getElementById('co-monto-wrap').style.display = modo === 'abono' ? '' : 'none';
  document.getElementById('co-metodo').innerHTML = opcionesMetodos();
  document.getElementById('co-banco-wrap').style.display = 'none';
  document.getElementById('co-banco').innerHTML = '<option value="">Sin banco (caja general)</option>' + FD.bancos.map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('');
  document.getElementById('co-error').textContent = '';
  document.getElementById('co-confirmar').textContent = modo === 'abono' ? 'Registrar abono' : `Cobrar ${fmt(saldo)}`;
  onMetodoCobroChange();
  abrirModal('modal-cobro');
  if (modo === 'abono') setTimeout(() => campo.focus(), 80);
}

function onMetodoCobroChange() {
  const sel = document.getElementById('co-metodo');
  const nombre = (sel.options[sel.selectedIndex]?.textContent || '').toLowerCase();
  const noEfectivo = nombre && !/efectivo|cash/.test(nombre);
  document.getElementById('co-banco-wrap').style.display = (noEfectivo && FD.bancos.length) ? '' : 'none';
}

async function confirmarCobro() {
  const c = FD.cobro; if (!c) return;
  const err = document.getElementById('co-error'); err.textContent = '';
  let monto = r2(Number(document.getElementById('co-monto').value));
  if (c.modo === 'abono') {
    if (!(monto > 0)) { err.textContent = 'Escribe cuánto abonó.'; return; }
    if (monto > c.saldo + 0.001) { err.textContent = `No puede abonar más de lo que debe (${fmt(c.saldo)}).`; return; }
  } else monto = c.saldo;
  const sel = document.getElementById('co-metodo');
  const metodoId = sel.value || null;
  const metodoNombre = sel.options[sel.selectedIndex]?.textContent || 'Efectivo';
  const bancoId = document.getElementById('co-banco-wrap').style.display === 'none' ? null : (document.getElementById('co-banco').value || null);
  // 💱 Si el abono se escribió en la otra moneda: queda la nota y, si entra a un
  // banco de esa misma moneda, el banco recibe el monto exacto (repartido entre
  // los fiados en proporción; el último se lleva el resto para que sume exacto).
  const otra = c.modo === 'abono' && window.N360MonedaAlterna ? N360MonedaAlterna.estado('co-monto') : null;
  const notaOtra = otra ? N360MonedaAlterna.nota('co-monto') : '';
  const bancoSel = bancoId ? (FD.bancos || []).find(b => b.id === bancoId) : null;
  const exactoBanco = otra && bancoSel && (bancoSel.moneda || 'NIO') === otra.moneda ? otra.monto : null;
  let exactoUsado = 0;
  const btn = document.getElementById('co-confirmar'); btn.disabled = true;
  try {
    // Reparte el monto entre los fiados (del más antiguo al más nuevo)
    let restante = monto;
    const orden = c.ids.map(id => FD.fiados.find(f => f.id === id)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const nombreCli = orden[0].cliente_nombre;
    for (const f of orden) {
      if (restante <= 0.004) break;
      const aplicar = r2(Math.min(restante, Number(f.saldo)));
      const saldoNuevo = r2(Number(f.saldo) - aplicar);
      const pagado = saldoNuevo <= 0.004;
      let mb = null;
      if (exactoBanco != null) {
        const ultimo = r2(restante - aplicar) <= 0.004;
        mb = ultimo ? r2(exactoBanco - exactoUsado) : r2(aplicar * exactoBanco / monto);
        exactoUsado = r2(exactoUsado + mb);
      }
      const cajaRes = await registrarCaja(f, aplicar, metodoId, metodoNombre, bancoId, mb, notaOtra);
      const { error: eP } = await sb.from('fiado_pagos').insert({
        auth_user_id: FD.userId, fiado_id: f.id, monto: aplicar, metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
        saldo_anterior: Number(f.saldo), saldo_nuevo: pagado ? 0 : saldoNuevo,
      });
      if (eP) throw eP;
      const { error: eF } = await sb.from('fiados').update({
        monto_pagado: r2(Number(f.monto_pagado || 0) + aplicar), saldo: pagado ? 0 : saldoNuevo,
        estado: pagado ? 'pagado' : 'pendiente', pagado_at: pagado ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
      }).eq('id', f.id).eq('auth_user_id', FD.userId);
      if (eF) throw eF;
      if (!cajaRes.ok) console.warn('Caja:', cajaRes.error);
      restante = r2(restante - aplicar);
    }
    cerrarModal('modal-cobro');
    showToast(c.modo === 'abono' ? `Abono de ${fmt(monto)} registrado` : `Cobrado ${fmt(monto)} de ${nombreCli}`);
    await cargarFiados(); renderTodo();
  } catch (e) {
    console.error('confirmarCobro:', e);
    err.textContent = 'No se pudo registrar: ' + (e.message || 'intenta de nuevo');
    await cargarFiados(); renderTodo();
  } finally { btn.disabled = false; FD.cobro = null; }
}

async function registrarCaja(f, monto, metodoId, metodoNombre, bancoId, montoMonedaBanco, nota) {
  if (!window.CajaAPI || typeof CajaAPI.registrarMovimiento !== 'function') return { ok: false, error: 'CajaAPI no disponible' };
  return CajaAPI.registrarMovimiento({
    auth_user_id: FD.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'COBRO',
    concepto: `Fiado cobrado — ${f.cliente_nombre}`, monto, metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre,
    banco_id: bancoId, referencia_tipo: 'fiado', referencia_id: f.id,
    monto_moneda_banco: montoMonedaBanco != null ? montoMonedaBanco : null,
    observaciones: [f.descripcion, nota].filter(Boolean).join(' · ') || null,
  });
}

/* ============================================================
   ELIMINAR
   ============================================================ */
async function eliminarFiado(id) {
  const f = FD.fiados.find(x => x.id === id); if (!f) return;
  if ((FD.pagos[id] || []).length) {
    showToast('Este fiado ya tiene abonos o pagos registrados, por eso no se puede eliminar.', 'error');
    return;
  }
  if (f.venta_id) {
    const bloqDev = await bloqueoDevolucionesVenta(sb, f.venta_id);
    if (bloqDev) { showToast(bloqDev, 'error'); return; }
  }
  const extra = f.tipo === 'productos' ? ' Los productos vuelven al inventario.' : '';
  const ok = await confirmar('¿Eliminar este fiado?', `Se eliminará el fiado de ${fmt(f.monto_total)} de ${f.cliente_nombre}.${extra}`, 'Sí, eliminar', true);
  if (!ok) return;
  try {
    if (f.venta_id) await anularVentaDelFiado(f.venta_id);
    const { error } = await sb.from('fiados').update({ estado: 'eliminado', eliminado_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).eq('auth_user_id', FD.userId);
    if (error) throw error;
    showToast('Fiado eliminado');
    await Promise.all([cargarFiados(), f.venta_id ? cargarProductos() : Promise.resolve()]); renderTodo();
  } catch (e) { console.error('eliminarFiado:', e); showToast('No se pudo eliminar. Intenta de nuevo.', 'error'); }
}

/* ============================================================
   DETALLE DE PRODUCTOS / WHATSAPP
   ============================================================ */
async function verDetalle(id) {
  const f = FD.fiados.find(x => x.id === id); if (!f || !f.venta_id) return;
  const cont = document.querySelector(`[data-fd-detalle="${id}"]`); if (!cont) return;
  const { data } = await sb.from('venta_detalles').select('producto_nombre,cantidad,precio,subtotal').eq('venta_id', f.venta_id);
  cont.innerHTML = (data || []).map(d => `<div class="fd-det-fila"><span>${esc(cantTxt(d.cantidad))} × ${esc(d.producto_nombre)}</span><span>${esc(fmt(d.subtotal))}</span></div>`).join('') || '<small>Sin detalle</small>';
}

function enviarWhatsApp(clave, tel) {
  const g = FD.fiados.filter(f => claveCliente(f) === clave && f.estado === 'pendiente'); if (!g.length) return;
  const saldo = r2(g.reduce((s, f) => s + Number(f.saldo || 0), 0));
  let t = String(tel || '').replace(/\D/g, '');
  if (t.length === 8) t = '505' + t;
  const neg = FD.empresaConfig?.nombre_comercial || 'nuestro negocio';
  const texto = `Hola ${g[0].cliente_nombre}, te recuerdo que tienes un saldo pendiente de ${fmt(saldo)} en ${neg}. ¡Gracias!`;
  window.open(`https://wa.me/${t}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
}

/* ============================================================
   EVENTOS E INICIO
   ============================================================ */
function enlazarEventos() {
  document.getElementById('fd-buscar').addEventListener('input', e => { FD.busqueda = e.target.value; renderLista(); });
  document.getElementById('fd-filtro').addEventListener('change', e => { FD.filtro = e.target.value; renderLista(); });
  document.getElementById('nf-cliente').addEventListener('input', onClienteInput);
  document.getElementById('nf-monto').addEventListener('input', actualizarAvisoCliente);
  document.getElementById('nf-buscar-prod').addEventListener('input', buscarProductoNuevo);
  document.getElementById('co-metodo').addEventListener('change', onMetodoCobroChange);

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-fd-toggle],[data-fd-pagar],[data-fd-abono],[data-fd-borrar],[data-fd-cobrar-todo],[data-fd-wa],[data-fd-nuevo-para],[data-fd-ver-detalle],[data-fd-sug],[data-fd-add],[data-fd-quitar],[data-fd-tipo]');
    if (!t) return;
    const d = t.dataset;
    if (d.fdToggle != null) { FD.abiertos.has(d.fdToggle) ? FD.abiertos.delete(d.fdToggle) : FD.abiertos.add(d.fdToggle); renderLista(); }
    else if (d.fdPagar) abrirCobro('total', [d.fdPagar]);
    else if (d.fdAbono) abrirCobro('abono', [d.fdAbono]);
    else if (d.fdBorrar) eliminarFiado(d.fdBorrar);
    else if (d.fdCobrarTodo) abrirCobro('total', FD.fiados.filter(f => claveCliente(f) === d.fdCobrarTodo && f.estado === 'pendiente').map(f => f.id));
    else if (d.fdWa) enviarWhatsApp(d.fdWa, d.tel);
    else if (d.fdNuevoPara != null) abrirNuevoFiado(d.fdNuevoPara || '', d.nombre);
    else if (d.fdVerDetalle) verDetalle(d.fdVerDetalle);
    else if (d.fdSug) { const c = FD.clientes.find(x => x.id === d.fdSug); if (c) { FD.nuevo.clienteId = c.id; FD.nuevo.clienteNombre = `${c.nombre} ${c.apellido || ''}`.trim(); document.getElementById('nf-cliente').value = FD.nuevo.clienteNombre; document.getElementById('nf-sugerencias').innerHTML = ''; actualizarAvisoCliente(); } }
    else if (d.fdAdd) agregarProductoNuevo(d.fdAdd);
    else if (d.fdQuitar != null) { FD.nuevo.items.splice(Number(d.fdQuitar), 1); renderItemsNuevo(); }
    else if (d.fdTipo) setTipoFiado(d.fdTipo);
  });
  document.addEventListener('input', e => { const c = e.target.closest('[data-fd-cant]'); if (c) cambiarCantidadItem(Number(c.dataset.fdCant), c.value); });
  document.addEventListener('change', e => {
    const s = e.target.closest('[data-fd-escala]'); if (!s) return;
    const it = FD.nuevo.items[Number(s.dataset.fdEscala)]; const es = it?.escalas.find(x => x.id === s.value);
    if (it && es) { it.escala_id = es.id; it.escala_nombre = es.nombre; it.precio = Number(es.precio); renderItemsNuevo(); }
  });
  document.querySelectorAll('.fd-modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) cerrarModal(m.id); }));
}

async function initFiados() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user; FD.userId = user.id;
    if (user.email) checkAdminAccess(user.email);
    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    enlazarEventos();
    await Promise.all([cargarClientes(), cargarMetodos(), cargarProductos()]);
    await cargarFiados();
    renderTodo();
  } catch (err) {
    console.error('initFiados:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando Fiados.', 'error');
  }
}

window.FD = FD;
FD.abrirNuevo = abrirNuevoFiado; FD.guardarNuevo = guardarNuevoFiado; FD.confirmarCobro = confirmarCobro; FD.cerrar = cerrarModal;
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', () => { initFiados(); if (window.lucide) lucide.createIcons(); });
