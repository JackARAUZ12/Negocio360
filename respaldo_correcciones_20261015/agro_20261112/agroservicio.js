/* ============================================================
   AGROSERVICIO.JS — NEGOCIO360 · Panel único de Agroservicio (Fase 1)
   Inicio · Productores · Cobros de cosecha · Restringidos e IPSA · Vencimientos
   CANDADOS:
   * Esta pantalla NO escribe directo en ninguna tabla de dinero ni inventario.
     Solo usa dos funciones del servidor que validan todo:
       - agro_productor_guardar  (ficha del productor y su límite)
       - agro_venta_restringida  (venta + inventario + lote + Caja/fiado + bitácora,
                                  todo o nada, con clave única por clic)
   * Los cobros se hacen en Fiados (el mismo cobro de siempre, que entra a Caja).
   * El límite de crédito y la cosecha vencida se revisan en el SERVIDOR al fiar,
     desde cualquier pantalla (Ventas, Fiados o este panel).
   * La bitácora de restringidos no se puede editar ni borrar.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const AG = {
  userId: null, empresaConfig: {}, nombre: 'Usuario', tab: 'inicio', ocupado: false,
  clientes: [], productores: {}, fiados: [], productos: [], lotes: [], metodos: [], bancos: [],
  venta: { lineas: [], clave: null }, mesBitacora: null, filtroProd: '', verTodos: false,
};

/* ---------- utilidades ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function n2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function num(v) { return Number(v || 0).toLocaleString('es-NI', { maximumFractionDigits: 3 }); }
function sym() {
  const m = AG.empresaConfig?.moneda;
  if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} }
  return m === 'USD' ? '$' : 'C$';
}
function fmt(v) {
  let x = Number(v || 0);
  if (typeof convertirParaMostrar === 'function') { try { x = convertirParaMostrar(x, AG.empresaConfig?.moneda); } catch (_) {} }
  return sym() + ' ' + x.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function hoyISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Managua' }); }
function sumarDias(iso, d) { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); }
function diasEntre(desde, hasta) { return Math.round((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 86400000); }
function fechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString('es-NI', { day: 'numeric', month: 'short', year: 'numeric' });
}
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
}
function nombreCliente(c) { return `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || 'Cliente'; }
function telWa(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 8) d = '505' + d;
  return d;
}

/* ---------- tema / menú (igual que los demás módulos) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('n360_theme', t); } catch (_) {}
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = t === 'dark' ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
let sidebarCollapsed = false;
function isMobileView() { return window.innerWidth <= 768; }
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar'); if (!sidebar) return;
  if (isMobileView()) {
    const open = sidebar.classList.toggle('mobile-open');
    const ov = document.getElementById('sidebar-overlay'); if (ov) ov.classList.toggle('active', open);
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}
function closeMobileSidebar() {
  const s = document.getElementById('sidebar'), o = document.getElementById('sidebar-overlay');
  if (s) s.classList.remove('mobile-open'); if (o) o.classList.remove('active');
}
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
let _toastT = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type} show`;
  clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.remove('show'), 5000);
}

/* ---------- modal ---------- */
function agModal(html) {
  document.getElementById('ag-modal-box').innerHTML = html;
  document.getElementById('ag-modal').classList.add('abierto');
}
function agCerrarModal() { if (AG.ocupado) return; document.getElementById('ag-modal').classList.remove('abierto'); }

/* ---------- lectura (solo lectura, paginada para no dejar datos fuera) ---------- */
async function leerTodo(armar) {
  const out = []; const paso = 1000;
  for (let desde = 0; desde < 50000; desde += paso) {
    const { data, error } = await armar().range(desde, desde + paso - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < paso) break;
  }
  return out;
}
async function cargarBase() {
  const u = AG.userId;
  const [clientes, productores, fiados, productos, lotes] = await Promise.all([
    leerTodo(() => sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp,ruc,direccion,limite_credito,activo').eq('auth_user_id', u).order('nombre')),
    leerTodo(() => sb.from('agro_productores').select('*').eq('auth_user_id', u)),
    leerTodo(() => sb.from('fiados').select('id,cliente_id,cliente_nombre,descripcion,monto_total,monto_pagado,saldo,fecha,estado').eq('auth_user_id', u).eq('estado', 'pendiente').order('fecha')),
    leerTodo(() => sb.from('productos').select('id,nombre,sku,precio,costo,stock_actual,stock_minimo,es_sustancia_controlada,activo,tipo,ubicacion_fisica').eq('auth_user_id', u).eq('tipo', 'producto').order('nombre')),
    leerTodo(() => sb.from('producto_lotes').select('id,producto_id,numero_lote,fecha_vencimiento,cantidad_actual,activo').eq('auth_user_id', u).eq('activo', true).gt('cantidad_actual', 0).order('fecha_vencimiento')),
  ]);
  AG.clientes = clientes.filter(c => c.activo !== false);
  AG.productores = {}; productores.forEach(p => { AG.productores[p.cliente_id] = p; });
  AG.fiados = fiados;
  AG.productos = productos.filter(p => p.activo !== false);
  AG.lotes = lotes;
}
function deudaPorCliente() {
  const m = {};
  AG.fiados.forEach(f => { if (!f.cliente_id) return; m[f.cliente_id] = n2((m[f.cliente_id] || 0) + Number(f.saldo || 0)); });
  return m;
}
function nombreProducto(id) { return AG.productos.find(p => p.id === id)?.nombre || 'Producto'; }

/* ---------- pestañas ---------- */
async function agTab(t) {
  AG.tab = t;
  document.querySelectorAll('.ag-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === t));
  try { history.replaceState(null, '', '#' + t); } catch (_) {}
  const v = document.getElementById('ag-vista');
  v.innerHTML = '<p class="tln-sub">Cargando…</p>';
  try {
    await cargarBase();
    if (t === 'inicio') await agInicio();
    else if (t === 'productores') agProductores();
    else if (t === 'cobros') agCobros();
    else if (t === 'restringidos') await agRestringidos();
    else if (t === 'vencimientos') agVencimientos();
  } catch (e) {
    console.error('agTab', e);
    v.innerHTML = '<div class="tl-aviso">No se pudo cargar la información. Revisa tu conexión y vuelve a intentar.</div>';
  }
}

/* =========================== INICIO =========================== */
async function agInicio() {
  const hoy = hoyISO(), u = AG.userId;
  const manana = sumarDias(hoy, 1);
  let vendidoHoy = 0, ventasHoy = 0, restringidosHoy = 0;
  try {
    const vs = await leerTodo(() => sb.from('ventas').select('total').eq('auth_user_id', u).eq('estado', 'completada')
      .gte('fecha', hoy + 'T00:00:00-06:00').lt('fecha', manana + 'T00:00:00-06:00'));
    vendidoHoy = n2(vs.reduce((s, x) => s + Number(x.total || 0), 0)); ventasHoy = vs.length;
  } catch (e) { console.warn('ventas hoy', e); }
  try {
    const { count } = await sb.from('registro_sustancias_controladas').select('id', { count: 'exact', head: true }).eq('auth_user_id', u).eq('fecha', hoy);
    restringidosHoy = count || 0;
  } catch (e) { console.warn('bitacora hoy', e); }

  const deuda = deudaPorCliente();
  const porCobrar = n2(AG.fiados.reduce((s, f) => s + Number(f.saldo || 0), 0));
  const en30 = sumarDias(hoy, 30);
  let cos30 = 0, cos30n = 0, venc = 0, vencN = 0;
  Object.entries(deuda).forEach(([cid, d]) => {
    const fc = AG.productores[cid]?.fecha_cosecha;
    if (!fc || d <= 0) return;
    if (fc < hoy) { venc = n2(venc + d); vencN++; }
    else if (fc <= en30) { cos30 = n2(cos30 + d); cos30n++; }
  });
  const en60 = sumarDias(hoy, 60);
  const lotesVencidos = AG.lotes.filter(l => l.fecha_vencimiento && l.fecha_vencimiento < hoy);
  const lotesPronto = AG.lotes.filter(l => l.fecha_vencimiento && l.fecha_vencimiento >= hoy && l.fecha_vencimiento <= en60);
  const stockBajo = AG.productos.filter(p => Number(p.stock_minimo || 0) > 0 && Number(p.stock_actual || 0) <= Number(p.stock_minimo || 0));

  const alertas = [];
  if (vencN) alertas.push({ c: 'mal', t: `🔴 <b>${vencN}</b> productor(es) con la cosecha ya pasada y saldo pendiente: <b>${fmt(venc)}</b>. No se les puede fiar más hasta que abonen.`, b: 'Ver cobros', a: "agTab('cobros')" });
  if (lotesVencidos.length) alertas.push({ c: 'mal', t: `🔴 <b>${lotesVencidos.length}</b> lote(s) vencido(s) con existencia. No se pueden vender: sepáralos para devolución o destrucción.`, b: 'Ver', a: "agTab('vencimientos')" });
  if (cos30n) alertas.push({ c: 'ambar', t: `🟠 <b>${cos30n}</b> productor(es) cosechan en los próximos 30 días: <b>${fmt(cos30)}</b> por cobrar.`, b: 'Ver cobros', a: "agTab('cobros')" });
  if (lotesPronto.length) alertas.push({ c: 'ambar', t: `🟡 <b>${lotesPronto.length}</b> lote(s) vencen en menos de 60 días. Véndelos primero (el sistema ya los ofrece primero).`, b: 'Ver', a: "agTab('vencimientos')" });
  if (stockBajo.length) alertas.push({ c: 'ambar', t: `📉 <b>${stockBajo.length}</b> producto(s) en o bajo su mínimo: ${stockBajo.slice(0, 4).map(p => esc(p.nombre)).join(', ')}${stockBajo.length > 4 ? '…' : ''}.`, b: 'Comprar', a: "navigate('compras.html')" });
  const restringidos = AG.productos.filter(p => p.es_sustancia_controlada === true);
  if (!restringidos.length) alertas.push({ c: '', t: '🔒 Aún no tienes productos marcados como <b>restringidos</b>. En Productos, marca la casilla 🔒 en los agroquímicos o medicamentos de uso controlado para venderlos con cédula y receta.', b: 'Ir a Productos', a: "navigate('productos.html')" });

  const kpi = (l, v, s, a, cls = '') => `<button type="button" class="ag-kpi ${cls}" onclick="${a}"><div class="ag-kpi-l">${l}</div><div class="ag-kpi-v">${v}</div><div class="ag-kpi-s">${s}</div></button>`;
  document.getElementById('ag-vista').innerHTML = `
    <div class="ag-kpis">
      ${kpi('💵 Vendido hoy', fmt(vendidoHoy), `${ventasHoy} venta(s)`, "navigate('ventas.html')")}
      ${kpi('🧾 Por cobrar a productores', fmt(porCobrar), `${Object.keys(deuda).length} cliente(s) con saldo`, "agTab('cobros')")}
      ${kpi('⏰ Cosecha en 30 días', fmt(cos30), `${cos30n} productor(es)`, "agTab('cobros')", cos30n ? 'ambar' : '')}
      ${kpi('🔴 Cosecha vencida', fmt(venc), `${vencN} productor(es)`, "agTab('cobros')", vencN ? 'rojo' : '')}
      ${kpi('⚠️ Lotes por vencer (60 días)', lotesPronto.length, `${lotesVencidos.length} ya vencido(s)`, "agTab('vencimientos')", lotesVencidos.length ? 'rojo' : (lotesPronto.length ? 'ambar' : ''))}
      ${kpi('🔒 Restringidos vendidos hoy', restringidosHoy, 'registrados en la bitácora', "agTab('restringidos')")}
    </div>
    <div class="ag-card">
      <h3>Lo que necesita tu atención</h3>
      ${alertas.length ? alertas.map(x => `<div class="ag-alerta ${x.c}"><span>${x.t}</span><button class="btn-secondary" style="flex:none" onclick="${x.a}">${x.b}</button></div>`).join('')
        : '<div class="ag-alerta"><span>✅ Todo en orden: sin cobros vencidos, sin lotes vencidos ni stock bajo.</span></div>'}
    </div>
    <div class="ag-card">
      <h3>Accesos rápidos</h3>
      <p class="ag-ayuda">Son los módulos de siempre. Todo lo que hagas ahí se refleja aquí automáticamente.</p>
      <div class="ag-accesos">
        <button class="ag-acceso" onclick="navigate('ventas.html')"><span>🛒</span><div><b>Nueva venta</b><small>Contado o fiado a cosecha</small></div></button>
        <button class="ag-acceso" onclick="agTab('restringidos')"><span>🔒</span><div><b>Vender restringido</b><small>Con cédula y receta</small></div></button>
        <button class="ag-acceso" onclick="navigate('fiados.html')"><span>💰</span><div><b>Cobrar un abono</b><small>Entra a Caja</small></div></button>
        <button class="ag-acceso" onclick="navigate('compras.html')"><span>📦</span><div><b>Comprar mercadería</b><small>Con lote y vencimiento</small></div></button>
        <button class="ag-acceso" onclick="navigate('productos.html')"><span>🏷️</span><div><b>Productos</b><small>Presentaciones: saco, libra, litro</small></div></button>
        <button class="ag-acceso" onclick="navigate('reportes.html')"><span>📊</span><div><b>Reportes</b><small>Ventas y ganancias</small></div></button>
      </div>
    </div>`;
}

/* =========================== PRODUCTORES =========================== */
function agProductores() {
  const deuda = deudaPorCliente();
  const f = (AG.filtroProd || '').toLowerCase().trim();
  let lista = AG.clientes.filter(c => AG.verTodos || AG.productores[c.id] || (deuda[c.id] || 0) > 0);
  if (f) lista = AG.clientes.filter(c => `${nombreCliente(c)} ${c.ruc || ''} ${c.telefono || ''} ${AG.productores[c.id]?.finca || ''} ${AG.productores[c.id]?.comunidad || ''}`.toLowerCase().includes(f));
  lista.sort((a, b) => (AG.productores[b.id] ? 1 : 0) - (AG.productores[a.id] ? 1 : 0) || nombreCliente(a).localeCompare(nombreCliente(b)));
  const hoy = hoyISO();
  const filas = lista.slice(0, 300).map(c => {
    const p = AG.productores[c.id]; const d = deuda[c.id] || 0; const lim = Number(c.limite_credito || 0);
    const cult = (p?.cultivos || []).map(x => `${esc(x.cultivo)}${x.manzanas ? ' ' + num(x.manzanas) + ' mz' : ''}`).join(', ');
    let estado = '<span class="ag-pill ok">Al día</span>';
    if (d > 0 && p?.fecha_cosecha && p.fecha_cosecha < hoy) estado = '<span class="ag-pill mal">Cosecha vencida</span>';
    else if (lim > 0 && d >= lim - 0.004) estado = '<span class="ag-pill mal">Límite lleno</span>';
    else if (d > 0) estado = '<span class="ag-pill ambar">Con saldo</span>';
    if (!p) estado += ' <span class="ag-pill">Sin ficha</span>';
    return `<tr>
      <td><b>${esc(nombreCliente(c))}</b><div class="tln-sub">${esc([p?.finca, p?.comunidad, p?.municipio].filter(Boolean).join(' · ') || (c.telefono || ''))}</div></td>
      <td>${cult || '<span class="tln-sub">—</span>'}</td>
      <td>${p?.fecha_cosecha ? fechaCorta(p.fecha_cosecha) : '<span class="tln-sub">—</span>'}</td>
      <td class="num">${lim > 0 ? fmt(lim) : '<span class="tln-sub">Sin límite</span>'}</td>
      <td class="num ${d > 0 ? 'ag-rojo' : ''}">${fmt(d)}</td>
      <td>${estado}</td>
      <td style="white-space:nowrap"><button class="btn-secondary" onclick="agFicha('${c.id}')">${p ? 'Ficha' : '➕ Ficha'}</button>
        ${d > 0 ? `<button class="btn-ghost" onclick="agEstadoCuenta('${c.id}')">Estado de cuenta</button>` : ''}</td></tr>`;
  }).join('');
  document.getElementById('ag-vista').innerHTML = `
    <div class="ag-card">
      <h3>👨‍🌾 Productores</h3>
      <p class="ag-ayuda">Cada productor es un <b>cliente</b> del sistema con su ficha agrícola: finca, cultivos, ganado, <b>fecha de cosecha</b> y <b>límite de crédito</b>.
        Al fiar (desde Ventas, Fiados o aquí) el sistema no deja pasar el límite, ni fiar a quien tiene la cosecha vencida con saldo.</p>
      <div class="ag-buscar ag-no-print">
        <input class="ag-inp" id="ag-f-prod" placeholder="Buscar por nombre, cédula, teléfono, finca o comunidad…" value="${esc(AG.filtroProd)}" oninput="AG.filtroProd=this.value;clearTimeout(AG._tf);AG._tf=setTimeout(agProductores,250)"/>
        <label class="ag-chk" style="margin:0;align-items:center"><input type="checkbox" ${AG.verTodos ? 'checked' : ''} onchange="AG.verTodos=this.checked;agProductores()"/> Ver todos mis clientes</label>
        <button class="btn-primary" onclick="agFicha(null)">➕ Nuevo productor</button>
      </div>
      ${lista.length ? `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Productor</th><th>Cultivos</th><th>Cosecha</th><th class="num">Límite</th><th class="num">Debe</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
        ${lista.length > 300 ? '<p class="tln-sub">Se muestran 300. Usa el buscador para encontrar a los demás.</p>' : ''}`
        : `<div class="ag-vacio"><div class="ico">👨‍🌾</div><p>${f ? 'No hay resultados para esa búsqueda.' : 'Todavía no tienes productores con ficha. Crea el primero o marca "Ver todos mis clientes" para agregarle la ficha a un cliente que ya existe.'}</p></div>`}
    </div>`;
  const inp = document.getElementById('ag-f-prod');
  if (inp && document.activeElement !== inp && AG.filtroProd) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function filaCultivo(c = {}) {
  return `<div class="ag-linea" style="grid-template-columns:1fr 110px 34px"><input class="ag-inp ag-cul-n" placeholder="Cultivo (maíz, frijol, café…)" value="${esc(c.cultivo || '')}"/>
    <input class="ag-inp ag-cul-m" type="number" min="0" step="0.25" placeholder="Manzanas" value="${c.manzanas ?? ''}"/>
    <button type="button" class="tl-x" onclick="this.parentElement.remove()" aria-label="Quitar">✕</button></div>`;
}
function filaGanado(g = {}) {
  return `<div class="ag-linea" style="grid-template-columns:1fr 110px 34px"><input class="ag-inp ag-gan-t" placeholder="Animal (vacas, cerdos, gallinas…)" value="${esc(g.tipo || '')}"/>
    <input class="ag-inp ag-gan-c" type="number" min="0" step="1" placeholder="Cantidad" value="${g.cantidad ?? ''}"/>
    <button type="button" class="tl-x" onclick="this.parentElement.remove()" aria-label="Quitar">✕</button></div>`;
}
function agFicha(clienteId) {
  const c = clienteId ? AG.clientes.find(x => x.id === clienteId) : null;
  const p = clienteId ? (AG.productores[clienteId] || {}) : {};
  const deuda = clienteId ? (deudaPorCliente()[clienteId] || 0) : 0;
  agModal(`<div class="tl-modal-cab"><h2>👨‍🌾 ${c ? esc(nombreCliente(c)) : 'Nuevo productor'}</h2><button type="button" class="tl-x" onclick="agCerrarModal()" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo">
      <div class="ag-grid2">
        ${c ? '' : '<div class="ag-campo" style="grid-column:1/-1"><label>Nombre completo *</label><input class="ag-inp" id="fp-nombre" maxlength="150"/></div>'}
        <div class="ag-campo"><label>Cédula</label><input class="ag-inp" id="fp-cedula" value="${esc(c?.ruc || '')}" maxlength="40"/></div>
        <div class="ag-campo"><label>Teléfono / WhatsApp</label><input class="ag-inp" id="fp-tel" value="${esc(c?.whatsapp || c?.telefono || '')}" maxlength="30"/></div>
        <div class="ag-campo" style="grid-column:1/-1"><label>Dirección</label><input class="ag-inp" id="fp-dir" value="${esc(c?.direccion || '')}" maxlength="250"/></div>
        <div class="ag-campo"><label>Finca</label><input class="ag-inp" id="fp-finca" value="${esc(p.finca || '')}" maxlength="150"/></div>
        <div class="ag-campo"><label>Comunidad / comarca</label><input class="ag-inp" id="fp-com" value="${esc(p.comunidad || '')}" maxlength="150"/></div>
        <div class="ag-campo"><label>Municipio</label><input class="ag-inp" id="fp-mun" value="${esc(p.municipio || '')}" maxlength="150"/></div>
        <div class="ag-campo"><label>📅 Fecha de su próxima cosecha</label><input class="ag-inp" id="fp-cosecha" type="date" value="${esc(p.fecha_cosecha || '')}"/></div>
      </div>
      <div class="tl-sec"><b>🌱 Cultivos</b><div id="fp-cultivos">${(p.cultivos || []).map(filaCultivo).join('')}</div>
        <button type="button" class="btn-ghost" style="align-self:flex-start" onclick="document.getElementById('fp-cultivos').insertAdjacentHTML('beforeend', filaCultivo())">➕ Agregar cultivo</button></div>
      <div class="tl-sec"><b>🐄 Ganado y animales</b><div id="fp-ganado">${(p.ganado || []).map(filaGanado).join('')}</div>
        <button type="button" class="btn-ghost" style="align-self:flex-start" onclick="document.getElementById('fp-ganado').insertAdjacentHTML('beforeend', filaGanado())">➕ Agregar animales</button></div>
      <div class="tl-sec"><b>💳 Crédito</b>
        <div class="ag-grid2"><div class="ag-campo"><label>Límite de crédito (0 = sin límite)</label><input class="ag-inp" id="fp-limite" type="number" min="0" step="0.01" value="${Number(c?.limite_credito || 0)}"/></div>
        <div class="ag-campo"><label>Debe hoy</label><div style="font-size:18px;font-weight:800;padding-top:6px" class="${deuda > 0 ? 'ag-rojo' : ''}">${fmt(deuda)}</div></div></div>
        <div class="ag-ayuda" style="margin:0">Si con una venta fiada su deuda pasa este límite, <b>el sistema no la deja guardar</b>. Si la fecha de cosecha ya pasó y aún debe, tampoco se le puede fiar hasta que abone.</div></div>
      <div class="ag-campo"><label>Notas</label><textarea class="ag-inp" id="fp-notas" rows="2" maxlength="1000">${esc(p.notas || '')}</textarea></div>
      <div id="fp-err"></div>
    </div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="agCerrarModal()">Cancelar</button><button class="btn-primary" id="fp-btn" onclick="agGuardarFicha(${clienteId ? `'${clienteId}'` : 'null'})">Guardar ficha</button></div>`);
}
const MOTIVOS_FICHA = { nombre: 'Escribe el nombre del productor.', limite: 'El límite de crédito no es válido.', fecha: 'La fecha de cosecha no es válida.', cliente: 'Ese cliente ya no existe. Recarga la pantalla.', desactivado: 'El Agroservicio está apagado. Actívalo en Configuración.', datos: 'Revisa los datos.', sesion: 'Tu sesión terminó. Vuelve a entrar.' };
async function agGuardarFicha(clienteId) {
  if (AG.ocupado) return;
  const v = id => (document.getElementById(id)?.value || '').trim();
  const err = document.getElementById('fp-err'); err.innerHTML = '';
  const cultivos = [...document.querySelectorAll('#fp-cultivos .ag-linea')].map(r => ({ cultivo: r.querySelector('.ag-cul-n').value.trim(), manzanas: Number(r.querySelector('.ag-cul-m').value) || 0 })).filter(x => x.cultivo);
  const ganado = [...document.querySelectorAll('#fp-ganado .ag-linea')].map(r => ({ tipo: r.querySelector('.ag-gan-t').value.trim(), cantidad: Number(r.querySelector('.ag-gan-c').value) || 0 })).filter(x => x.tipo);
  const lim = Number(v('fp-limite') || 0);
  if (!clienteId && !v('fp-nombre')) { err.innerHTML = '<div class="tl-aviso">Escribe el nombre del productor.</div>'; return; }
  if (!(lim >= 0)) { err.innerHTML = '<div class="tl-aviso">El límite de crédito no es válido.</div>'; return; }
  const datos = { nombre: v('fp-nombre'), cedula: v('fp-cedula'), telefono: v('fp-tel'), direccion: v('fp-dir'), finca: v('fp-finca'), comunidad: v('fp-com'),
    municipio: v('fp-mun'), fecha_cosecha: v('fp-cosecha'), limite_credito: lim, notas: v('fp-notas'), cultivos, ganado };
  AG.ocupado = true; const b = document.getElementById('fp-btn'); if (b) b.disabled = true;
  try {
    const { data, error } = await sb.rpc('agro_productor_guardar', { p_cliente_id: clienteId, p_datos: datos });
    if (error || !data?.ok) { err.innerHTML = `<div class="tl-aviso">${esc(error ? 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.' : (MOTIVOS_FICHA[data.motivo] || 'No se pudo guardar.'))}</div>`; return; }
    AG.ocupado = false; agCerrarModal(); showToast('Ficha guardada.');
    await agTab(AG.tab);
  } finally { AG.ocupado = false; if (b) b.disabled = false; }
}

function mensajeEstadoCuenta(c, fiados, total) {
  const p = AG.productores[c.id];
  const negocio = AG.empresaConfig?.nombre_comercial || 'nuestro agroservicio';
  const lineas = fiados.map(f => `• ${fechaCorta(f.fecha)}: ${f.descripcion || 'Compra'} — debe ${fmt(f.saldo)}`).join('\n');
  return `Hola ${nombreCliente(c)}, le saluda ${negocio}.\nSu estado de cuenta:\n${lineas}\n\nTotal pendiente: ${fmt(total)}` +
    (p?.fecha_cosecha ? `\nFecha acordada de pago (cosecha): ${fechaCorta(p.fecha_cosecha)}` : '') + '\n¡Gracias por su preferencia!';
}
function agEstadoCuenta(clienteId) {
  const c = AG.clientes.find(x => x.id === clienteId); if (!c) return;
  const fs = AG.fiados.filter(f => f.cliente_id === clienteId);
  const total = n2(fs.reduce((s, f) => s + Number(f.saldo || 0), 0));
  const wa = telWa(c.whatsapp || c.telefono);
  const msg = mensajeEstadoCuenta(c, fs, total);
  agModal(`<div class="tl-modal-cab"><h2>🧾 Estado de cuenta — ${esc(nombreCliente(c))}</h2><button type="button" class="tl-x" onclick="agCerrarModal()" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo">
      <div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Fecha</th><th>Detalle</th><th class="num">Total</th><th class="num">Abonado</th><th class="num">Debe</th></tr></thead>
      <tbody>${fs.map(f => `<tr><td>${fechaCorta(f.fecha)}</td><td>${esc(f.descripcion || 'Compra')}</td><td class="num">${fmt(f.monto_total)}</td><td class="num">${fmt(f.monto_pagado)}</td><td class="num ag-rojo">${fmt(f.saldo)}</td></tr>`).join('')}</tbody></table></div>
      <div class="ag-total">Total pendiente: ${fmt(total)}</div>
      <div class="ag-ayuda" style="margin:0">Para registrar un abono usa <b>Fiados</b>: es el mismo cobro de siempre y entra a Caja.</div>
    </div>
    <div class="tl-modal-pie">
      ${wa ? `<a class="btn-secondary" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}">📲 Enviar por WhatsApp</a>` : '<span class="tln-sub">Sin teléfono para WhatsApp</span>'}
      <button class="btn-primary" onclick="navigate('fiados.html')">💰 Cobrar abono en Fiados</button></div>`);
}

/* =========================== COBROS DE COSECHA =========================== */
function agCobros() {
  const deuda = deudaPorCliente(); const hoy = hoyISO(); const en30 = sumarDias(hoy, 30);
  const grupos = { vencido: [], pronto: [], luego: [], sin: [] };
  Object.entries(deuda).forEach(([cid, d]) => {
    if (d <= 0.004) return;
    const c = AG.clientes.find(x => x.id === cid) || { id: cid, nombre: AG.fiados.find(f => f.cliente_id === cid)?.cliente_nombre || 'Cliente' };
    const fc = AG.productores[cid]?.fecha_cosecha || null;
    const item = { c, d, fc };
    if (!fc) grupos.sin.push(item); else if (fc < hoy) grupos.vencido.push(item); else if (fc <= en30) grupos.pronto.push(item); else grupos.luego.push(item);
  });
  Object.values(grupos).forEach(g => g.sort((a, b) => String(a.fc || '9').localeCompare(String(b.fc || '9')) || b.d - a.d));
  const sinCliente = n2(AG.fiados.filter(f => !f.cliente_id).reduce((s, f) => s + Number(f.saldo || 0), 0));
  const tabla = (titulo, ayuda, arr, cls) => {
    if (!arr.length) return '';
    const tot = n2(arr.reduce((s, x) => s + x.d, 0));
    return `<div class="ag-card"><h3>${titulo} <span class="ag-pill ${cls}">${arr.length} · ${fmt(tot)}</span></h3><p class="ag-ayuda">${ayuda}</p>
      <div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Productor</th><th>Cosecha</th><th class="num">Debe</th><th></th></tr></thead><tbody>
      ${arr.map(x => {
        const dias = x.fc ? diasEntre(hoy, x.fc) : null;
        const cuando = x.fc ? `${fechaCorta(x.fc)}<div class="tln-sub">${dias < 0 ? `hace ${-dias} día(s)` : dias === 0 ? 'hoy' : `en ${dias} día(s)`}</div>` : '<span class="tln-sub">Sin fecha</span>';
        const wa = telWa(x.c.whatsapp || x.c.telefono);
        const fs = AG.fiados.filter(f => f.cliente_id === x.c.id);
        return `<tr><td><b>${esc(nombreCliente(x.c))}</b></td><td>${cuando}</td><td class="num ag-rojo">${fmt(x.d)}</td>
          <td style="white-space:nowrap">${wa ? `<a class="btn-ghost" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(mensajeEstadoCuenta(x.c, fs, x.d))}">📲 Recordar</a>` : ''}
          <button class="btn-secondary" onclick="agEstadoCuenta('${x.c.id}')">Estado de cuenta</button>
          ${AG.clientes.find(y => y.id === x.c.id) ? `<button class="btn-ghost" onclick="agFicha('${x.c.id}')">Ficha</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
  };
  const vacio = !grupos.vencido.length && !grupos.pronto.length && !grupos.luego.length && !grupos.sin.length;
  document.getElementById('ag-vista').innerHTML = `
    <div class="ag-card ag-no-print"><h3>💰 Cobros de cosecha</h3>
      <p class="ag-ayuda">El productor compra fiado y paga cuando cosecha. Aquí ves quién debe y cuándo cosecha. Los abonos se cobran en <b>Fiados</b> (entran a Caja como siempre) y se reflejan aquí al instante.</p>
      <div class="ag-acciones" style="margin:0"><button class="btn-primary" onclick="navigate('fiados.html')">💰 Cobrar un abono</button><button class="btn-secondary" onclick="window.print()">🖨️ Imprimir lista</button></div></div>
    ${vacio ? '<div class="ag-card ag-vacio"><div class="ico">✅</div><p>Nadie te debe en este momento.</p></div>' : ''}
    ${tabla('🔴 Cosecha ya pasada', 'Ya debieron pagar. El sistema no les deja fiar más hasta que abonen (o actualices su fecha de cosecha).', grupos.vencido, 'mal')}
    ${tabla('🟠 Cosechan en los próximos 30 días', 'Buen momento para recordarles su saldo.', grupos.pronto, 'ambar')}
    ${tabla('🟢 Cosechan más adelante', '', grupos.luego, 'ok')}
    ${tabla('⚪ Sin fecha de cosecha', 'Abre su ficha y ponle la fecha de cosecha para que el sistema te avise a tiempo.', grupos.sin, '')}
    ${sinCliente > 0 ? `<div class="ag-card"><p class="ag-ayuda" style="margin:0">Además hay <b>${fmt(sinCliente)}</b> fiado a personas que no están registradas como cliente. Míralos en Fiados.</p></div>` : ''}`;
}

/* =========================== RESTRINGIDOS E IPSA =========================== */
async function agRestringidos() {
  if (!AG.metodos.length) {
    try {
      const [{ data: m }, { data: b }] = await Promise.all([
        sb.from('metodos_pago').select('id,nombre').eq('auth_user_id', AG.userId).eq('activo', true).order('nombre'),
        sb.from('bancos').select('id,nombre').eq('auth_user_id', AG.userId).eq('activo', true).order('nombre'),
      ]);
      AG.metodos = m || []; AG.bancos = b || [];
    } catch (e) { console.warn('metodos', e); }
  }
  if (!AG.venta.clave) AG.venta.clave = uuid();
  if (!AG.mesBitacora) AG.mesBitacora = hoyISO().slice(0, 7);
  const restringidos = AG.productos.filter(p => p.es_sustancia_controlada === true);
  const recetaObl = AG.empresaConfig?.agro_receta_obligatoria !== false;
  const productores = AG.clientes.filter(c => AG.productores[c.id]);
  document.getElementById('ag-vista').innerHTML = `
    <div class="ag-card ag-no-print"><h3>🔒 Vender producto restringido</h3>
      <p class="ag-ayuda">Para agroquímicos y medicamentos de uso controlado. La venta queda en Ventas, descuenta inventario del lote que vence primero (nunca de uno vencido),
        entra a Caja o al fiado del productor, y se anota sola en la bitácora, <b>todo en un solo paso</b>.</p>
      ${!restringidos.length ? `<div class="tl-aviso">No tienes productos marcados como restringidos. En <b>Productos</b>, edita el producto y marca la casilla 🔒.</div>
        <div class="ag-acciones"><button class="btn-primary" onclick="navigate('productos.html')">Ir a Productos</button></div>` : `
      <div class="tl-sec"><b>1. Comprador</b>
        <div class="ag-campo"><label>Productor registrado (opcional; obligatorio para fiar)</label>
          <select class="ag-sel" id="vr-cli" onchange="agVrCliente()"><option value="">— Cliente de mostrador —</option>
          ${productores.map(c => `<option value="${c.id}">${esc(nombreCliente(c))}${c.ruc ? ' · ' + esc(c.ruc) : ''}</option>`).join('')}</select></div>
        <div class="ag-grid2">
          <div class="ag-campo"><label>Nombre completo *</label><input class="ag-inp" id="vr-nom" maxlength="150"/></div>
          <div class="ag-campo"><label>Cédula *</label><input class="ag-inp" id="vr-ced" maxlength="40"/></div>
          <div class="ag-campo" style="grid-column:1/-1"><label>Dirección *</label><input class="ag-inp" id="vr-dir" maxlength="250"/></div>
          <div class="ag-campo" style="grid-column:1/-1"><label>¿Para qué lo usará? (cultivo, plaga o animal) *</label><input class="ag-inp" id="vr-uso" maxlength="250" placeholder="Ej.: maleza en maíz, 5 manzanas"/></div>
          <div class="ag-campo"><label>N.º de receta ${recetaObl ? '*' : '(opcional)'}</label><input class="ag-inp" id="vr-rec" maxlength="60"/></div>
          <div class="ag-campo"><label>Profesional que la firma ${recetaObl ? '*' : '(opcional)'}</label><input class="ag-inp" id="vr-prof" maxlength="150" placeholder="Ing. agrónomo / médico veterinario"/></div>
        </div>
        <label class="ag-chk"><input type="checkbox" id="vr-mayor"/> Verifiqué la cédula: el comprador es <b>mayor de edad</b>.</label>
      </div>
      <div class="tl-sec"><b>2. Productos</b>
        <div id="vr-lineas"></div>
        <button type="button" class="btn-ghost" style="align-self:flex-start" onclick="agVrAgregar()">➕ Agregar producto</button>
        <div class="ag-total" id="vr-total">Total: ${fmt(0)}</div>
      </div>
      <div class="tl-sec"><b>3. Pago</b>
        <div class="ag-grid2">
          <div class="ag-campo"><label>Forma de pago</label><select class="ag-sel" id="vr-forma" onchange="agVrForma()"><option value="contado">Contado</option><option value="fiado">Fiado a cosecha</option></select></div>
          <div class="ag-campo" id="vr-met-wrap"><label>Método</label><select class="ag-sel" id="vr-met" onchange="agVrForma()">${AG.metodos.length ? AG.metodos.map(m => `<option value="${m.id}" data-n="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('') : '<option value="" data-n="Efectivo">Efectivo</option>'}</select></div>
          <div class="ag-campo" id="vr-banco-wrap" style="display:none"><label>¿A qué banco entra? *</label><select class="ag-sel" id="vr-banco"><option value="">— Elige —</option>${AG.bancos.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('')}</select></div>
        </div>
      </div>
      <div id="vr-err"></div>
      <div class="ag-acciones"><button class="btn-primary" id="vr-btn" onclick="agVrConfirmar()">✅ Confirmar venta</button><button class="btn-secondary" onclick="agVrLimpiar()">Limpiar</button></div>`}
    </div>
    <div class="ag-card"><h3>📒 Bitácora de productos restringidos (IPSA)</h3>
      <p class="ag-ayuda">Se llena sola. <b>No se puede editar ni borrar.</b> Si una venta se anula en Ventas, aquí aparece marcada como anulada. Las entradas vienen de tus Compras.</p>
      <div class="ag-buscar ag-no-print"><input class="ag-inp" type="month" id="vr-mes" value="${AG.mesBitacora}" style="max-width:200px;flex:none" onchange="AG.mesBitacora=this.value;agBitacora()"/>
        <button class="btn-secondary" onclick="agBitacoraCsv()">⬇️ Excel (CSV)</button><button class="btn-secondary" onclick="window.print()">🖨️ Imprimir / PDF</button></div>
      <div id="vr-bitacora"><p class="tln-sub">Cargando…</p></div>
    </div>`;
  if (restringidos.length) {
    if (!AG.venta.lineas.length) AG.venta.lineas = [{ producto_id: '', cantidad: 1, precio: 0 }];
    agVrRender(); agVrForma();
  }
  await agBitacora();
}
function agVrCliente() {
  const id = document.getElementById('vr-cli').value;
  const c = AG.clientes.find(x => x.id === id);
  if (c) {
    document.getElementById('vr-nom').value = nombreCliente(c);
    if (c.ruc) document.getElementById('vr-ced').value = c.ruc;
    const p = AG.productores[c.id];
    const dir = c.direccion || [p?.finca, p?.comunidad, p?.municipio].filter(Boolean).join(', ');
    if (dir) document.getElementById('vr-dir').value = dir;
  }
}
function stockDisponible(prodId) {
  const p = AG.productos.find(x => x.id === prodId); if (!p) return { stock: 0, vendible: 0, conLote: false };
  const hoy = hoyISO();
  const lotes = AG.lotes.filter(l => l.producto_id === prodId);
  if (!lotes.length) return { stock: Number(p.stock_actual || 0), vendible: Number(p.stock_actual || 0), conLote: false };
  const buenos = lotes.filter(l => !l.fecha_vencimiento || l.fecha_vencimiento >= hoy).reduce((s, l) => s + Number(l.cantidad_actual || 0), 0);
  return { stock: Number(p.stock_actual || 0), vendible: Math.min(buenos, Number(p.stock_actual || 0)), conLote: true };
}
function agVrRender() {
  const cont = document.getElementById('vr-lineas'); if (!cont) return;
  const restringidos = AG.productos.filter(p => p.es_sustancia_controlada === true);
  cont.innerHTML = AG.venta.lineas.map((l, i) => {
    const sd = l.producto_id ? stockDisponible(l.producto_id) : null;
    return `<div class="ag-linea">
      <select class="ag-sel" onchange="agVrProd(${i}, this.value)"><option value="">— Elige el producto —</option>
        ${restringidos.map(p => `<option value="${p.id}" ${p.id === l.producto_id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>
      <input class="ag-inp" type="number" min="0.001" step="any" value="${l.cantidad}" oninput="AG.venta.lineas[${i}].cantidad=Number(this.value)||0;agVrTotal()" aria-label="Cantidad"/>
      <input class="ag-inp" type="number" min="0.01" step="0.01" value="${l.precio || ''}" placeholder="Precio" oninput="AG.venta.lineas[${i}].precio=Number(this.value)||0;agVrTotal()" aria-label="Precio unitario"/>
      <button type="button" class="tl-x" onclick="agVrQuitar(${i})" aria-label="Quitar">✕</button>
      ${sd ? `<div class="tln-sub" style="grid-column:1/-1;margin-top:-4px">Disponible para vender: <b>${num(sd.vendible)}</b>${sd.conLote && sd.vendible < sd.stock ? ` <span class="ag-rojo">(${num(sd.stock - sd.vendible)} en lote vencido, no se vende)</span>` : ''}</div>` : ''}
    </div>`;
  }).join('');
  agVrTotal();
}
function agVrProd(i, id) {
  const p = AG.productos.find(x => x.id === id);
  AG.venta.lineas[i].producto_id = id;
  AG.venta.lineas[i].precio = p ? Number(p.precio || 0) : 0;
  agVrRender();
}
function agVrAgregar() { AG.venta.lineas.push({ producto_id: '', cantidad: 1, precio: 0 }); agVrRender(); }
function agVrQuitar(i) { AG.venta.lineas.splice(i, 1); if (!AG.venta.lineas.length) AG.venta.lineas.push({ producto_id: '', cantidad: 1, precio: 0 }); agVrRender(); }
function agVrTotal() {
  const t = n2(AG.venta.lineas.reduce((s, l) => s + n2((Number(l.cantidad) || 0) * (Number(l.precio) || 0)), 0));
  const el = document.getElementById('vr-total'); if (el) el.textContent = 'Total: ' + fmt(t);
  return t;
}
function agVrForma() {
  const forma = document.getElementById('vr-forma')?.value;
  const mw = document.getElementById('vr-met-wrap'), bw = document.getElementById('vr-banco-wrap');
  if (!mw || !bw) return;
  mw.style.display = forma === 'fiado' ? 'none' : '';
  const sel = document.getElementById('vr-met');
  const n = (sel?.selectedOptions[0]?.dataset.n || '').toLowerCase();
  bw.style.display = (forma !== 'fiado' && (n.includes('tarjeta') || n.includes('transferencia')) && AG.bancos.length) ? '' : 'none';
}
function agVrLimpiar() { AG.venta = { lineas: [{ producto_id: '', cantidad: 1, precio: 0 }], clave: uuid() }; agRestringidos(); }
const MOTIVOS_VR = {
  desactivado: 'El Agroservicio está apagado. Actívalo en Configuración.', sesion: 'Tu sesión terminó. Vuelve a entrar.',
  comprador: 'Faltan datos del comprador: nombre, cédula, dirección y para qué lo usará.', mayor_edad: 'Confirma que verificaste la cédula y que el comprador es mayor de edad.',
  receta: 'Falta el número de receta y el profesional que la firma.', fiado_cliente: 'Para fiar, elige un productor registrado.',
  cliente: 'Ese cliente ya no existe. Recarga la pantalla.', sin_lineas: 'Agrega al menos un producto.', repetido: 'Un producto aparece dos veces: deja una sola línea por producto.',
  cantidad: 'Revisa las cantidades y precios: deben ser mayores que cero.', producto: 'Un producto ya no existe o no está activo. Recarga la pantalla.',
  no_restringido: 'Ese producto no está marcado como restringido.', metodo: 'Elige el método de pago.', datos: 'Revisa los datos e intenta de nuevo.',
};
function mensajeVr(d) {
  if (d.motivo === 'sin_stock') return `No alcanza ${d.producto}: solo hay ${num(d.hay)}. No se vendió nada.`;
  if (d.motivo === 'lote_vencido') return `De ${d.producto} solo hay ${num(d.disponible)} sin vencer. Lo vencido no se puede vender. No se vendió nada.`;
  return (d.producto ? d.producto + ': ' : '') + (MOTIVOS_VR[d.motivo] || 'No se pudo completar la venta.');
}
async function agVrConfirmar() {
  if (AG.ocupado) return;
  const v = id => (document.getElementById(id)?.value || '').trim();
  const err = document.getElementById('vr-err'); err.innerHTML = '';
  const aviso = m => { err.innerHTML = `<div class="tl-aviso">${esc(m)}</div>`; };
  const lineas = AG.venta.lineas.filter(l => l.producto_id);
  if (!lineas.length) return aviso('Agrega al menos un producto.');
  if (lineas.some(l => !(l.cantidad > 0) || !(l.precio > 0))) return aviso('Revisa las cantidades y precios: deben ser mayores que cero.');
  for (const l of lineas) {
    const sd = stockDisponible(l.producto_id);
    if (l.cantidad > sd.vendible + 0.0005) return aviso(`De ${nombreProducto(l.producto_id)} solo hay ${num(sd.vendible)} para vender.`);
  }
  const forma = v('vr-forma'); const cliId = v('vr-cli') || null;
  if (forma === 'fiado' && !cliId) return aviso('Para fiar, elige un productor registrado.');
  const sel = document.getElementById('vr-met');
  const metNombre = sel?.selectedOptions[0]?.dataset.n || 'Efectivo';
  const bancoVisible = document.getElementById('vr-banco-wrap')?.style.display !== 'none';
  if (forma !== 'fiado' && bancoVisible && !v('vr-banco')) return aviso('Indica a qué banco entra el dinero.');
  const total = agVrTotal();
  if (!confirm(`¿Confirmar la venta de productos restringidos por ${fmt(total)}${forma === 'fiado' ? ' (fiado)' : ''}?\n\nQuedará en la bitácora y no se podrá borrar.`)) return;
  const comprador = { nombre: v('vr-nom'), cedula: v('vr-ced'), direccion: v('vr-dir'), uso: v('vr-uso'), receta_numero: v('vr-rec'), receta_profesional: v('vr-prof'),
    mayor_edad: document.getElementById('vr-mayor')?.checked === true };
  const pago = { forma, metodo_pago_id: forma === 'fiado' ? null : (sel?.value || null), metodo_pago_nombre: forma === 'fiado' ? null : metNombre,
    banco_id: (forma !== 'fiado' && bancoVisible) ? v('vr-banco') : null, usuario: AG.nombre };
  const items = lineas.map(l => ({ producto_id: l.producto_id, cantidad: n2(l.cantidad * 1000) / 1000, precio: n2(l.precio) }));
  AG.ocupado = true; const b = document.getElementById('vr-btn'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
  try {
    let res = null, fallo = null;
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise(r => setTimeout(r, i === 1 ? 800 : 1800));
      try {
        const { data, error } = await sb.rpc('agro_venta_restringida', { p_clave: AG.venta.clave, p_items: items, p_comprador: comprador, p_pago: pago, p_cliente_id: cliId });
        if (!error) { res = data; fallo = null; break; }
        fallo = error;
        if (error.code && !/^(08|57|53|40)/.test(error.code)) break;   // error de datos: no reintentar
      } catch (e) { fallo = e; }
    }
    if (fallo) {
      const m = fallo.code === 'P0001' && fallo.message ? fallo.message : 'No se pudo confirmar la venta (sin conexión). Revisa Ventas antes de repetirla: con la misma pantalla abierta, si vuelves a tocar Confirmar no se duplica.';
      return aviso(m);
    }
    if (!res?.ok) return aviso(mensajeVr(res || {}));
    showToast(res.ya_existia ? 'Esa venta ya estaba guardada (no se repitió).' : `Venta ${res.numero_venta} guardada: ${fmt(res.total)}.`);
    AG.venta = { lineas: [{ producto_id: '', cantidad: 1, precio: 0 }], clave: uuid() };
    AG.ocupado = false;
    await agTab('restringidos');
  } finally { AG.ocupado = false; if (b) { b.disabled = false; b.textContent = '✅ Confirmar venta'; } }
}

async function datosBitacora() {
  const mes = AG.mesBitacora || hoyISO().slice(0, 7);
  const desde = mes + '-01';
  const [y, m] = mes.split('-').map(Number);
  const hasta = new Date(y, m, 1).toISOString().slice(0, 10);
  const u = AG.userId;
  const salidas = await leerTodo(() => sb.from('registro_sustancias_controladas')
    .select('id,fecha,producto_id,producto_nombre,cantidad,comprador_nombre,comprador_documento,comprador_direccion,uso_destino,receta_numero,receta_profesional,lote_numero,lote_vencimiento,venta_id,created_at')
    .eq('auth_user_id', u).gte('fecha', desde).lt('fecha', hasta).order('fecha').order('created_at'));
  const ventaIds = [...new Set(salidas.map(s => s.venta_id).filter(Boolean))];
  const estados = {};
  for (let i = 0; i < ventaIds.length; i += 200) {
    const { data } = await sb.from('ventas').select('id,numero_venta,estado').in('id', ventaIds.slice(i, i + 200));
    (data || []).forEach(x => { estados[x.id] = x; });
  }
  const idsR = AG.productos.filter(p => p.es_sustancia_controlada === true).map(p => p.id);
  let entradas = [];
  if (idsR.length) {
    const compras = await leerTodo(() => sb.from('compras').select('id,numero,fecha,proveedor_nombre,estado').eq('auth_user_id', u).gte('fecha', desde).lt('fecha', hasta).neq('estado', 'anulada'));
    const cids = compras.map(c => c.id);
    for (let i = 0; i < cids.length; i += 200) {
      const { data } = await sb.from('detalle_compras').select('compra_id,producto_id,producto_nombre,cantidad').in('compra_id', cids.slice(i, i + 200)).in('producto_id', idsR);
      (data || []).forEach(d => { const c = compras.find(x => x.id === d.compra_id); entradas.push({ ...d, fecha: c?.fecha, numero: c?.numero, proveedor: c?.proveedor_nombre }); });
    }
    entradas.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }
  return { salidas, estados, entradas, mes };
}
async function agBitacora() {
  const cont = document.getElementById('vr-bitacora'); if (!cont) return;
  cont.innerHTML = '<p class="tln-sub">Cargando…</p>';
  try {
    const { salidas, estados, entradas } = await datosBitacora();
    AG._bit = { salidas, estados, entradas };
    const negocio = esc(AG.empresaConfig?.nombre_comercial || '');
    cont.innerHTML = `<p class="tln-sub" style="margin-bottom:8px">${negocio} · Mes ${esc(AG.mesBitacora)} · ${salidas.length} salida(s) · ${entradas.length} entrada(s)</p>
      <b style="font-size:13.5px">Salidas (ventas)</b>
      ${salidas.length ? `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Fecha</th><th>Producto</th><th>Lote / vence</th><th class="num">Cant.</th><th>Comprador</th><th>Uso</th><th>Receta</th><th>Venta</th></tr></thead><tbody>
        ${salidas.map(s => { const vt = estados[s.venta_id]; const anul = vt && vt.estado === 'anulada';
          return `<tr${anul ? ' style="opacity:.6"' : ''}><td>${fechaCorta(s.fecha)}</td><td>${esc(s.producto_nombre)}</td><td>${esc(s.lote_numero || '—')}${s.lote_vencimiento ? `<div class="tln-sub">${fechaCorta(s.lote_vencimiento)}</div>` : ''}</td>
          <td class="num">${num(s.cantidad)}</td><td>${esc(s.comprador_nombre)}<div class="tln-sub">${esc(s.comprador_documento || '')}${s.comprador_direccion ? ' · ' + esc(s.comprador_direccion) : ''}</div></td>
          <td>${esc(s.uso_destino || '—')}</td><td>${esc(s.receta_numero || '—')}${s.receta_profesional ? `<div class="tln-sub">${esc(s.receta_profesional)}</div>` : ''}</td>
          <td>${esc(vt?.numero_venta || '—')}${anul ? ' <span class="ag-pill mal">Anulada</span>' : ''}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<p class="tln-sub">Sin salidas este mes.</p>'}
      <b style="font-size:13.5px;display:block;margin-top:12px">Entradas (compras)</b>
      ${entradas.length ? `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Fecha</th><th>Producto</th><th class="num">Cant.</th><th>Proveedor</th><th>Compra</th></tr></thead><tbody>
        ${entradas.map(e => `<tr><td>${fechaCorta(e.fecha)}</td><td>${esc(e.producto_nombre)}</td><td class="num">${num(e.cantidad)}</td><td>${esc(e.proveedor || '—')}</td><td>${esc(e.numero || '—')}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="tln-sub">Sin entradas este mes.</p>'}`;
  } catch (e) {
    console.error('bitacora', e);
    cont.innerHTML = '<div class="tl-aviso">No se pudo cargar la bitácora. Intenta de nuevo.</div>';
  }
}
function agBitacoraCsv() {
  const b = AG._bit; if (!b) return;
  const q = x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`;
  const filas = [['Tipo', 'Fecha', 'Producto', 'Lote', 'Vence', 'Cantidad', 'Comprador / Proveedor', 'Cédula', 'Dirección', 'Uso', 'Receta', 'Profesional', 'Documento', 'Estado']];
  b.salidas.forEach(s => { const vt = b.estados[s.venta_id];
    filas.push(['Salida', s.fecha, s.producto_nombre, s.lote_numero, s.lote_vencimiento, s.cantidad, s.comprador_nombre, s.comprador_documento, s.comprador_direccion, s.uso_destino, s.receta_numero, s.receta_profesional, vt?.numero_venta, vt?.estado === 'anulada' ? 'Anulada' : 'Vigente']); });
  b.entradas.forEach(e => filas.push(['Entrada', e.fecha, e.producto_nombre, '', '', e.cantidad, e.proveedor, '', '', '', '', '', e.numero, 'Vigente']));
  const csv = '﻿' + filas.map(r => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `bitacora-restringidos-${AG.mesBitacora}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* =========================== VENCIMIENTOS =========================== */
function agVencimientos() {
  const hoy = hoyISO(); const en30 = sumarDias(hoy, 30); const en90 = sumarDias(hoy, 90);
  const lotes = AG.lotes.filter(l => l.fecha_vencimiento && l.fecha_vencimiento <= en90).sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
  const costoDe = id => Number(AG.productos.find(p => p.id === id)?.costo || 0);
  const grupo = (titulo, arr, cls, ayuda) => arr.length ? `<div class="ag-card"><h3>${titulo} <span class="ag-pill ${cls}">${arr.length} · ${fmt(arr.reduce((s, l) => s + Number(l.cantidad_actual || 0) * costoDe(l.producto_id), 0))} al costo</span></h3>
    <p class="ag-ayuda">${ayuda}</p><div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th class="num">Cantidad</th></tr></thead><tbody>
    ${arr.map(l => { const d = diasEntre(hoy, l.fecha_vencimiento); return `<tr><td>${esc(nombreProducto(l.producto_id))}</td><td>${esc(l.numero_lote || '—')}</td><td>${fechaCorta(l.fecha_vencimiento)}<div class="tln-sub">${d < 0 ? `venció hace ${-d} día(s)` : d === 0 ? 'vence hoy' : `en ${d} día(s)`}</div></td><td class="num">${num(l.cantidad_actual)}</td></tr>`; }).join('')}
    </tbody></table></div></div>` : '';
  const venc = lotes.filter(l => l.fecha_vencimiento < hoy), m30 = lotes.filter(l => l.fecha_vencimiento >= hoy && l.fecha_vencimiento <= en30), m90 = lotes.filter(l => l.fecha_vencimiento > en30);
  document.getElementById('ag-vista').innerHTML = `
    <div class="ag-card ag-no-print"><h3>⏰ Vencimientos</h3>
      <p class="ag-ayuda">Los lotes se crean al registrar tus <b>Compras</b> con su vencimiento. Al vender, el sistema toma primero el lote que vence antes y <b>no deja vender uno vencido</b>.</p>
      <div class="ag-acciones" style="margin:0"><button class="btn-secondary" onclick="navigate('lotes.html')">📦 Ver todos los lotes</button><button class="btn-secondary" onclick="navigate('vencimientos.html')">⏰ Vencimientos detallado</button></div></div>
    ${!lotes.length ? '<div class="ag-card ag-vacio"><div class="ico">✅</div><p>Ningún lote vence en los próximos 90 días.</p></div>' : ''}
    ${grupo('🔴 Vencidos con existencia', venc, 'mal', 'No se pueden vender. Sepáralos para devolución al proveedor o destrucción según la norma, y registra la baja en Productos.')}
    ${grupo('🟠 Vencen en 30 días o menos', m30, 'ambar', 'Ofrécelos primero.')}
    ${grupo('🟡 Vencen en 31 a 90 días', m90, '', '')}`;
}

/* ---------- arranque ---------- */
async function agInit() {
  applyTheme((() => { try { return localStorage.getItem('n360_theme') || 'light'; } catch (_) { return 'light'; } })());
  const f = document.getElementById('header-fecha'); if (f) f.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user; AG.userId = user.id;
    const { data: cfg } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', user.id).maybeSingle();
    AG.empresaConfig = cfg || {};
    if (cfg?.color_principal) { document.documentElement.style.setProperty('--accent', cfg.color_principal); document.documentElement.style.setProperty('--accent-soft', cfg.color_principal + '22'); }
    const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const { data: perfil } = await sb.from('usuarios').select('*').eq('auth_user_id', user.id).maybeSingle();
    AG.nombre = perfil ? (`${perfil.nombre || ''} ${perfil.apellido || ''}`.trim() || user.email?.split('@')[0] || 'Usuario') : (user.email?.split('@')[0] || 'Usuario');
    try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.nombre) AG.nombre = String(pf.nombre).slice(0, 100); } catch (_) {}
    const hn = document.getElementById('header-name'); if (hn) hn.textContent = AG.nombre;
    const hb = document.getElementById('header-biz'); if (hb) hb.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const ha = document.getElementById('header-avatar'); if (ha) ha.textContent = (AG.nombre[0] || 'U').toUpperCase();
    const pt = document.getElementById('plan-text'); if (pt) pt.textContent = perfil?.plan ? String(perfil.plan).charAt(0).toUpperCase() + String(perfil.plan).slice(1) : 'Plan';
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    if (AG.empresaConfig.usa_modulo_agro !== true) {
      document.getElementById('content').innerHTML = `<div class="tl-apagado"><div style="font-size:42px">🌾</div><h2>El Agroservicio está apagado</h2>
        <p>Actívalo en <b>Configuración → Agroservicio</b> para usar el panel de productores, cobros de cosecha, restringidos e IPSA.</p>
        <button class="btn-primary" onclick="navigate('configuracion.html')">Ir a Configuración</button></div>`;
      return;
    }
    const inicial = (location.hash || '').replace('#', '');
    await agTab(['inicio', 'productores', 'cobros', 'restringidos', 'vencimientos'].includes(inicial) ? inicial : 'inicio');
  } catch (e) {
    console.error('agInit:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando el Agroservicio.', 'error');
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') agCerrarModal(); });
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', () => { agInit(); if (window.lucide) lucide.createIcons(); });
