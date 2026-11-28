/* ============================================================
   AGUA.JS — NEGOCIO360 · Panel Agua (venta de agua de pozo por mensualidad)
   Inicio · Cartera · Abonados · Cobro del mes · Arreglos · Cortes · Gastos y más · Ajustes
   CANDADOS:
   * Esta pantalla NO escribe directo en ninguna tabla: todo pasa por funciones del servidor
     (agua_guardar_abonado, agua_importar, agua_generar_mes, agua_preparar_cobro,
     agua_confirmar_cobro, agua_cargo_extra, agua_anular_cargo, agua_cambiar_estado,
     agua_crear_arreglo, agua_anular_arreglo, agua_guardar_config), que validan y son todo o nada.
   * El dinero entra con el MOTOR DE VENTAS de siempre (agua-cobro.js): Ventas, Caja, ticket.
   * El cobro del mes no se duplica (una mensualidad por abonado y mes).
   * Los cargos con pagos no se anulan aquí: se anula la venta en Ventas y el pago se revierte solo.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.__awSB = sb;

const AW_DEF = { dias_gracia: 5, mora_tipo: 'ninguno', mora_valor: 0, meses_corte: 2, reconexion: 0, iva_pct: 15, prefijo: 'AB-', dia_cobro: 5, menu_exclusivo: false };
const AW = {
  userId: null, empresaConfig: {}, cfg: { ...AW_DEF }, nombre: 'Usuario', tab: 'inicio', ocupado: false,
  abonados: [], cargos: [], arreglos: [], calc: new Map(), cargado: false,
  filtro: { texto: '', estado: '', sector: '', meses: '', deudaMin: '' }, pagina: 0, filtroAb: '', paginaAb: 0,
};
const POR_PAGINA = 100;

/* ---------- utilidades ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function n2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function sym() {
  const m = AW.empresaConfig?.moneda;
  if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} }
  return m === 'USD' ? '$' : 'C$';
}
function fmt(v) {
  let x = Number(v || 0);
  if (typeof convertirParaMostrar === 'function') { try { x = convertirParaMostrar(x, AW.empresaConfig?.moneda); } catch (_) {} }
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
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function mesTexto(iso) { const [y, m] = String(iso).split('-').map(Number); return `${MESES[m - 1]} ${y}`; }
function primerDia(iso) { return String(iso).slice(0, 7) + '-01'; }
function sumarMes(iso, n) { const [y, m] = String(iso).split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function telWa(t) { let d = String(t || '').replace(/\D/g, ''); if (!d) return ''; if (d.length === 8) d = '505' + d; return d; }
function nombreAb(a) { return `${a?.nombre || ''} ${a?.apellido || ''}`.trim(); }
function err(e) { return (e && (e.message || e.error_description)) || String(e || 'Error'); }
window.awFmt = fmt; window.awHoy = hoyISO; window.awFecha = fechaCorta; window.awTelWa = telWa;

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
function awModal(html) { document.getElementById('aw-modal-box').innerHTML = html; document.getElementById('aw-modal').classList.add('abierto'); }
function awCerrarModal() { if (AW.ocupado) return; document.getElementById('aw-modal').classList.remove('abierto'); }
function cabModal(titulo) { return `<div class="tl-modal-cab"><h2>${titulo}</h2><button type="button" class="tl-x" onclick="awCerrarModal()" aria-label="Cerrar" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text-muted)">✕</button></div>`; }
async function rpc(nombre, args) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) throw error;
  return data;
}

/* ---------- lectura (paginada: nada se queda fuera) ---------- */
async function leerTodo(armar) {
  const out = []; const paso = 1000;
  for (let desde = 0; desde < 200000; desde += paso) {
    const { data, error } = await armar().range(desde, desde + paso - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < paso) break;
  }
  return out;
}
async function awCargar() {
  const uid = AW.userId;
  const [abonados, cargos, arreglos] = await Promise.all([
    leerTodo(() => sb.from('agua_abonados').select('*').eq('auth_user_id', uid).order('codigo', { ascending: true }).order('id')),
    leerTodo(() => sb.from('agua_cargos').select('id,abonado_id,tipo,periodo,concepto,monto,pagado,estado,vence,arreglo_id,iva').eq('auth_user_id', uid).in('estado', ['pendiente', 'parcial']).order('id')),
    leerTodo(() => sb.from('agua_arreglos').select('*').eq('auth_user_id', uid).eq('estado', 'vigente').order('id')),
  ]);
  AW.abonados = abonados; AW.cargos = cargos; AW.arreglos = arreglos; AW.cargado = true;
  awCalcular();
}

/* ---------- estado de cada abonado ---------- */
const ESTADOS = {
  aldia: { t: '🟢 Al día', c: 'aldia' }, porvencer: { t: '🔵 Por vencer', c: 'porvencer' }, hoy: { t: '🟡 Vence hoy', c: 'hoy' },
  parcial: { t: '🟠 Pago parcial', c: 'parcial' }, atrasado: { t: '🔴 Atrasado', c: 'atrasado' }, arreglo: { t: '🟣 En arreglo', c: 'arreglo' },
  cortado: { t: '⚫ Cortado', c: 'cortado' }, suspendido: { t: '⚫ Suspendido', c: 'suspendido' }, pausado: { t: '⚪ Pausado', c: 'pausado' },
  favor: { t: '💚 Saldo a favor', c: 'favor' },
};
function pill(k, extra) { const e = ESTADOS[k] || ESTADOS.aldia; return `<span class="aw-est ${e.c}">${e.t}${extra ? ' · ' + esc(extra) : ''}</span>`; }
function awCalcular() {
  const hoy = hoyISO(), en7 = sumarDias(hoy, 7);
  const porAb = new Map();
  AW.cargos.forEach(c => { if (!porAb.has(c.abonado_id)) porAb.set(c.abonado_id, []); porAb.get(c.abonado_id).push(c); });
  const arr = new Map(); AW.arreglos.forEach(r => arr.set(r.abonado_id, r));
  const gracia = Number(AW.cfg.dias_gracia) || 0;
  AW.calc = new Map();
  AW.abonados.forEach(a => {
    const pend = porAb.get(a.id) || [];
    const deuda = n2(pend.reduce((s, c) => s + Number(c.monto) - Number(c.pagado), 0));
    const venc = pend.filter(c => c.vence < hoy);
    const mesesAtr = venc.filter(c => c.tipo === 'mensualidad').length;
    const deudaVencida = n2(venc.reduce((s, c) => s + Number(c.monto) - Number(c.pagado), 0));
    const futuros = pend.filter(c => c.vence >= hoy).map(c => c.vence).sort();
    const proximo = futuros[0] || null;
    const parcial = pend.some(c => c.estado === 'parcial');
    const r = arr.get(a.id) || null;
    let arreglo = null;
    if (r) {
      const enArr = pend.filter(c => c.arreglo_id === r.id);
      const resta = n2(enArr.reduce((s, c) => s + Number(c.monto) - Number(c.pagado), 0));
      const pagado = n2(Number(r.monto) - resta);
      const limite = sumarDias(hoy, -gracia);
      const debiaHaber = n2((r.cuotas || []).filter(q => q.fecha <= limite).reduce((s, q) => s + Number(q.monto || 0), 0));
      const prox = (r.cuotas || []).map(q => q.fecha).filter(f => f >= hoy).sort()[0] || null;
      arreglo = { r, pagado, resta, cumple: pagado + 0.009 >= debiaHaber, debiaHaber, prox };
    }
    const vencSinArreglo = venc.filter(c => !(r && c.arreglo_id === r.id));
    let est;
    if (a.estado === 'cortado') est = 'cortado';
    else if (a.estado === 'suspendido') est = 'suspendido';
    else if (a.estado === 'pausado') est = 'pausado';
    else if (arreglo && arreglo.cumple && !vencSinArreglo.length) est = 'arreglo';
    else if (vencSinArreglo.length || (arreglo && !arreglo.cumple)) est = vencSinArreglo.some(c => c.estado === 'parcial') ? 'parcial' : 'atrasado';
    else if (pend.some(c => c.vence === hoy)) est = 'hoy';
    else if (proximo && proximo <= en7) est = 'porvencer';
    else if (parcial) est = 'parcial';
    else if (deuda <= 0 && Number(a.saldo_favor) > 0) est = 'favor';
    else est = 'aldia';
    AW.calc.set(a.id, { est, deuda, deudaVencida, mesesAtr, proximo, pend, arreglo, incumple: !!(arreglo && !arreglo.cumple) });
  });
}
const calc = id => AW.calc.get(id) || { est: 'aldia', deuda: 0, deudaVencida: 0, mesesAtr: 0, proximo: null, pend: [], arreglo: null };
const abonado = id => AW.abonados.find(a => a.id === id);
function sectores() { return [...new Set(AW.abonados.map(a => a.sector).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es')); }

/* ---------- pestañas ---------- */
async function awTab(tab, forzar) {
  AW.tab = tab;
  document.querySelectorAll('#aw-tabs .ag-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === tab));
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  const v = document.getElementById('aw-vista');
  if (!AW.cargado || forzar) { v.innerHTML = '<p class="tln-sub">Cargando…</p>'; try { await awCargar(); } catch (e) { console.error(e); v.innerHTML = `<div class="ag-alerta mal">No se pudieron cargar los datos: ${esc(err(e))}</div>`; return; } }
  try {
    if (tab === 'inicio') await vistaInicio(v);
    else if (tab === 'cartera') vistaCartera(v);
    else if (tab === 'abonados') vistaAbonados(v);
    else if (tab === 'mes') await vistaMes(v);
    else if (tab === 'arreglos') vistaArreglos(v);
    else if (tab === 'cortes') vistaCortes(v);
    else if (tab === 'otros') vistaOtros(v);
    else if (tab === 'ajustes') vistaAjustes(v);
  } catch (e) { console.error('awTab', tab, e); v.innerHTML = `<div class="ag-alerta mal">Ocurrió un problema: ${esc(err(e))}</div>`; }
}
async function awRefrescar() { await awCargar(); await awTab(AW.tab); }

/* ---------- INICIO ---------- */
async function vistaInicio(v) {
  const hoy = hoyISO(), mes = primerDia(hoy), finMes = sumarMes(mes, 1);
  const activos = AW.abonados.filter(a => a.estado === 'activo');
  const cuenta = k => AW.abonados.filter(a => calc(a.id).est === k).length;
  const porCobrar = n2(AW.abonados.reduce((s, a) => s + calc(a.id).deuda, 0));
  let facturado = 0, cobrado = 0, generado = false;
  try {
    const cm = await leerTodo(() => sb.from('agua_cargos').select('monto').eq('auth_user_id', AW.userId).eq('tipo', 'mensualidad').eq('periodo', mes).neq('estado', 'anulado').order('id'));
    facturado = n2(cm.reduce((s, c) => s + Number(c.monto), 0)); generado = cm.length > 0;
    const co = await leerTodo(() => sb.from('agua_cobros').select('monto').eq('auth_user_id', AW.userId).eq('estado', 'aplicado').gte('aplicado_en', mes + 'T06:00:00Z').lt('aplicado_en', finMes + 'T06:00:00Z').order('id'));
    cobrado = n2(co.reduce((s, c) => s + Number(c.monto), 0));
  } catch (e) { console.warn('kpis mes:', e); }
  const atrasados = cuenta('atrasado') + cuenta('parcial');
  const moros = activos.length ? Math.round(AW.abonados.filter(a => a.estado === 'activo' && ['atrasado', 'parcial'].includes(calc(a.id).est)).length / activos.length * 100) : 0;
  const kpi = (l, val, s, tab, filtro, cls = '') => `<button type="button" class="ag-kpi ${cls}" onclick="awIrCartera('${filtro || ''}','${tab || 'cartera'}')"><div class="ag-kpi-l">${l}</div><div class="ag-kpi-v">${val}</div>${s ? `<div class="ag-kpi-s">${s}</div>` : ''}</button>`;
  v.innerHTML = `
    ${!AW.abonados.length ? `<div class="ag-card"><h3>👋 Empieza aquí</h3><p class="ag-ayuda">1) Registra tus abonados uno por uno o súbelos desde la plantilla de Excel. 2) Genera el cobro del mes. 3) Cobra por código.</p>
      <div class="ag-acciones"><button class="btn-primary" onclick="awEditarAbonado()">＋ Nuevo abonado</button><button class="btn-secondary" onclick="awImportar()">📥 Importar desde Excel</button></div></div>` : ''}
    ${AW.abonados.length && !generado ? `<div class="ag-alerta ambar"><span>🗓️ Todavía no has generado el cobro de <b>${esc(mesTexto(mes))}</b>.</span><button class="btn-primary" style="flex:none" onclick="awTab('mes')">Generar cobro del mes</button></div>` : ''}
    <div class="ag-card"><h3>💳 Cobrar por código</h3>
      <div class="ag-buscar"><input class="ag-inp" id="aw-cod-rapido" placeholder="Escribe el código (ej. ${esc(AW.cfg.prefijo || 'AB-')}0012) o el nombre" autocomplete="off" onkeydown="if(event.key==='Enter')awBuscarRapido()"><button class="btn-primary" onclick="awBuscarRapido()">Buscar</button></div>
      <div id="aw-rapido-res"></div></div>
    <div class="ag-kpis">
      ${kpi('Abonados activos', activos.length, `${AW.abonados.length} en total`, 'abonados', '')}
      ${kpi('Facturado ' + MESES[Number(mes.slice(5, 7)) - 1], fmt(facturado), generado ? 'Mensualidades del mes' : 'Aún sin generar', 'mes', '')}
      ${kpi('Cobrado este mes', fmt(cobrado), 'Pagos aplicados', 'cartera', '')}
      ${kpi('Por cobrar', fmt(porCobrar), 'Todo lo pendiente', 'cartera', 'condeuda')}
      ${kpi('Atrasados', atrasados, `Morosidad ${moros}%`, 'cartera', 'atrasado', atrasados ? 'rojo' : '')}
      ${kpi('Vence hoy', cuenta('hoy'), '', 'cartera', 'hoy', cuenta('hoy') ? 'ambar' : '')}
      ${kpi('Por vencer (7 días)', cuenta('porvencer'), '', 'cartera', 'porvencer')}
      ${kpi('En arreglo', cuenta('arreglo') + AW.abonados.filter(a => calc(a.id).incumple).length, AW.abonados.filter(a => calc(a.id).incumple).length ? AW.abonados.filter(a => calc(a.id).incumple).length + ' incumplido(s)' : '', 'arreglos', '')}
      ${kpi('Cortados', cuenta('cortado'), '', 'cortes', '')}
    </div>
    <div class="ag-accesos">
      <button type="button" class="ag-acceso" onclick="awEditarAbonado()"><span>➕</span><div><b>Nuevo abonado</b><small>Con su código</small></div></button>
      <button type="button" class="ag-acceso" onclick="awTab('mes')"><span>🗓️</span><div><b>Cobro del mes</b><small>Generar las mensualidades</small></div></button>
      <button type="button" class="ag-acceso" onclick="awIrCartera('atrasado')"><span>🔴</span><div><b>Atrasados</b><small>Cobrar y recordar</small></div></button>
      <button type="button" class="ag-acceso" onclick="awTab('cortes')"><span>✂️</span><div><b>Cortes</b><small>Para cortar y reconectar</small></div></button>
      <button type="button" class="ag-acceso" onclick="navigate('reportes.html')"><span>📊</span><div><b>Reportes</b><small>Ventas y Caja de siempre</small></div></button>
    </div>`;
  setTimeout(() => document.getElementById('aw-cod-rapido')?.focus(), 50);
}
function awIrCartera(filtro, tab) {
  if (tab && tab !== 'cartera') { awTab(tab); return; }
  AW.filtro = { texto: '', estado: filtro && filtro !== 'condeuda' ? filtro : '', sector: '', meses: '', deudaMin: filtro === 'condeuda' ? '0.01' : '' };
  AW.pagina = 0; awTab('cartera');
}
function buscarAbonados(q) {
  const t = String(q || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return [];
  const digitos = t.replace(/\D/g, '');
  const exactos = AW.abonados.filter(a => a.codigo.toUpperCase() === t || (digitos && a.codigo.replace(/\D/g, '').replace(/^0+/, '') === digitos.replace(/^0+/, '')));
  if (exactos.length) return exactos;
  const tt = String(q).trim().toLowerCase();
  return AW.abonados.filter(a => a.codigo.toLowerCase().includes(tt) || nombreAb(a).toLowerCase().includes(tt) || String(a.cedula || '').toLowerCase().includes(tt) || String(a.telefono || '').includes(tt)).slice(0, 20);
}
function awBuscarRapido() {
  const q = document.getElementById('aw-cod-rapido')?.value || '';
  const res = buscarAbonados(q), el = document.getElementById('aw-rapido-res');
  if (!q.trim()) { el.innerHTML = ''; return; }
  if (!res.length) { el.innerHTML = '<p class="tln-sub">No se encontró ningún abonado con ese código o nombre.</p>'; return; }
  el.innerHTML = filasCartera(res, true);
}

/* ---------- CARTERA ---------- */
function filtrarCartera() {
  const f = AW.filtro, t = (f.texto || '').trim().toLowerCase();
  return AW.abonados.filter(a => {
    const c = calc(a.id);
    if (t && !(a.codigo.toLowerCase().includes(t) || nombreAb(a).toLowerCase().includes(t) || String(a.direccion || '').toLowerCase().includes(t) || String(a.telefono || '').includes(t))) return false;
    if (f.estado) { if (f.estado === 'incumplido') { if (!c.incumple) return false; } else if (c.est !== f.estado) return false; }
    if (f.sector && a.sector !== f.sector) return false;
    if (f.meses && c.mesesAtr < Number(f.meses)) return false;
    if (f.deudaMin && c.deuda < Number(f.deudaMin)) return false;
    return true;
  });
}
function filasCartera(lista, compacta) {
  if (!lista.length) return '<div class="ag-vacio"><div class="ico">🔍</div><p>No hay abonados con esos filtros.</p></div>';
  return `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Código</th><th>Abonado</th>${compacta ? '' : '<th class="aw-ocultar-movil">Sector</th>'}<th>Estado</th><th class="num">Debe</th><th class="aw-ocultar-movil">Atraso</th><th class="aw-ocultar-movil">Próximo</th><th></th></tr></thead><tbody>
    ${lista.map(a => { const c = calc(a.id); return `<tr>
      <td class="aw-cod">${esc(a.codigo)}</td>
      <td><b>${esc(nombreAb(a))}</b><div class="tln-sub">${esc(a.direccion || '')}</div></td>
      ${compacta ? '' : `<td class="aw-ocultar-movil">${esc(a.sector || '—')}</td>`}
      <td>${pill(c.est)}${c.incumple ? ' <span class="ag-pill mal">arreglo incumplido</span>' : ''}</td>
      <td class="num ${c.deudaVencida > 0 ? 'ag-rojo' : ''}">${fmt(c.deuda)}</td>
      <td class="aw-ocultar-movil">${c.mesesAtr ? c.mesesAtr + (c.mesesAtr === 1 ? ' mes' : ' meses') : '—'}</td>
      <td class="aw-ocultar-movil">${c.proximo ? fechaCorta(c.proximo) : '—'}</td>
      <td><div class="aw-acc"><button class="aw-btn pri" onclick="awCobrar('${a.id}')">💳 Cobrar</button><button class="aw-btn" onclick="awFicha('${a.id}')">Ficha</button>${(a.whatsapp || a.telefono) ? `<button class="aw-btn" title="Recordatorio por WhatsApp" onclick="awRecordar('${a.id}')">📲</button>` : ''}</div></td>
    </tr>`; }).join('')}</tbody></table></div>`;
}
function vistaCartera(v) {
  const f = AW.filtro, lista = filtrarCartera();
  const pag = Math.max(0, Math.min(AW.pagina, Math.ceil(lista.length / POR_PAGINA) - 1));
  const tot = n2(lista.reduce((s, a) => s + calc(a.id).deuda, 0));
  const opt = (val, txt, sel) => `<option value="${esc(val)}" ${String(sel) === String(val) ? 'selected' : ''}>${esc(txt)}</option>`;
  v.innerHTML = `<div class="ag-card"><h3>📋 Cartera de abonados</h3>
    <p class="ag-ayuda">Quién está al día, quién debe, quién pagó una parte y quién tiene arreglo. Filtra, cobra, manda recordatorios o imprime la lista para el cobrador.</p>
    <div class="aw-filtros">
      <input class="ag-inp" id="awf-texto" placeholder="Código, nombre, dirección…" value="${esc(f.texto)}" oninput="awFiltrar()">
      <select class="ag-sel" id="awf-estado" onchange="awFiltrar()">${opt('', 'Todos los estados', f.estado)}${Object.entries(ESTADOS).map(([k, e]) => opt(k, e.t, f.estado)).join('')}${opt('incumplido', '⚠️ Arreglo incumplido', f.estado)}</select>
      <select class="ag-sel" id="awf-sector" onchange="awFiltrar()">${opt('', 'Todos los sectores', f.sector)}${sectores().map(s => opt(s, s, f.sector)).join('')}</select>
      <select class="ag-sel" id="awf-meses" onchange="awFiltrar()">${opt('', 'Cualquier atraso', f.meses)}${opt('1', '1 mes o más', f.meses)}${opt('2', '2 meses o más', f.meses)}${opt('3', '3 meses o más', f.meses)}${opt('6', '6 meses o más', f.meses)}</select>
      <input class="ag-inp" id="awf-deuda" type="number" min="0" step="0.01" placeholder="Debe más de…" value="${esc(f.deudaMin)}" oninput="awFiltrar()">
    </div>
    <div class="ag-acciones" style="margin:0 0 10px"><span class="tln-sub"><b>${lista.length}</b> abonado(s) · deben <b>${fmt(tot)}</b></span><span style="flex:1"></span>
      <button class="btn-secondary" onclick="awImprimirLista()">🖨️ Lista para el cobrador</button>
      <button class="btn-secondary" onclick="awExportar()">📊 Excel</button>
      <button class="btn-secondary" onclick="awRecordarSerie()">📲 Recordatorios en serie</button>
      <button class="btn-secondary" onclick="awLimpiarFiltros()">Quitar filtros</button></div>
    <div id="aw-cartera-tabla">${filasCartera(lista.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA))}</div>
    ${lista.length > POR_PAGINA ? `<div class="aw-pag"><button class="aw-btn" ${pag ? '' : 'disabled'} onclick="AW.pagina=${pag - 1};awTab('cartera')">← Anterior</button>Página ${pag + 1} de ${Math.ceil(lista.length / POR_PAGINA)}<button class="aw-btn" ${(pag + 1) * POR_PAGINA < lista.length ? '' : 'disabled'} onclick="AW.pagina=${pag + 1};awTab('cartera')">Siguiente →</button></div>` : ''}
  </div>`;
}
let _filtT = null;
function awFiltrar() {
  AW.filtro = { texto: document.getElementById('awf-texto').value, estado: document.getElementById('awf-estado').value, sector: document.getElementById('awf-sector').value,
    meses: document.getElementById('awf-meses').value, deudaMin: document.getElementById('awf-deuda').value };
  AW.pagina = 0;
  clearTimeout(_filtT);
  _filtT = setTimeout(() => {
    const foco = document.activeElement?.id, pos = document.activeElement?.selectionStart;
    vistaCartera(document.getElementById('aw-vista'));
    const el = foco && document.getElementById(foco); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (_) {} }
  }, 200);
}
function awLimpiarFiltros() { AW.filtro = { texto: '', estado: '', sector: '', meses: '', deudaMin: '' }; AW.pagina = 0; awTab('cartera'); }
function nombreNegocio() { return AW.empresaConfig?.nombre_comercial || 'Mi negocio'; }
function awImprimirLista() {
  const lista = filtrarCartera().slice().sort((x, y) => String(x.sector || '').localeCompare(String(y.sector || ''), 'es') || x.codigo.localeCompare(y.codigo, 'es', { numeric: true }));
  if (!lista.length) { showToast('No hay abonados en la lista.', 'warning'); return; }
  const w = window.open('', '_blank'); if (!w) { showToast('Permite ventanas emergentes para imprimir.', 'warning'); return; }
  const tot = n2(lista.reduce((s, a) => s + calc(a.id).deuda, 0));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Lista de cobro</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;margin:18px;color:#111}h1{font-size:18px;margin:0}p{margin:2px 0 10px;color:#555}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}
    td.n{text-align:right;white-space:nowrap}.f{width:110px}@media print{button{display:none}}</style></head><body>
    <button onclick="print()" style="float:right;padding:8px 14px">Imprimir</button>
    <h1>${esc(nombreNegocio())} — Lista de cobro</h1><p>${esc(fechaCorta(hoyISO()))} · ${lista.length} abonado(s) · Total ${esc(fmt(tot))}</p>
    <table><thead><tr><th>Código</th><th>Abonado</th><th>Dirección</th><th>Sector</th><th>Atraso</th><th>Debe</th><th class="f">Recibido / firma</th></tr></thead><tbody>
    ${lista.map(a => { const c = calc(a.id); return `<tr><td><b>${esc(a.codigo)}</b></td><td>${esc(nombreAb(a))}<br><small>${esc(a.telefono || '')}</small></td><td>${esc(a.direccion || '')}${a.referencia ? '<br><small>' + esc(a.referencia) + '</small>' : ''}</td><td>${esc(a.sector || '')}</td><td>${c.mesesAtr ? c.mesesAtr + ' mes(es)' : '—'}</td><td class="n">${esc(fmt(c.deuda))}</td><td></td></tr>`; }).join('')}
    </tbody></table></body></html>`);
  w.document.close();
}
function awExportar() {
  const lista = filtrarCartera();
  if (!window.XLSX) { showToast('No se pudo cargar Excel. Revisa tu conexión.', 'error'); return; }
  const filas = lista.map(a => { const c = calc(a.id); return { 'Código': a.codigo, 'Nombre': a.nombre, 'Apellido': a.apellido || '', 'Teléfono': a.telefono || '', 'Dirección': a.direccion || '',
    'Sector': a.sector || '', 'Cuota': Number(a.cuota), 'Estado del servicio': a.estado, 'Estado de pago': (ESTADOS[c.est] || {}).t?.replace(/^\S+\s/, '') || c.est,
    'Debe': c.deuda, 'Vencido': c.deudaVencida, 'Meses atrasados': c.mesesAtr, 'Próximo vencimiento': c.proximo || '', 'Saldo a favor': Number(a.saldo_favor) || 0 }; });
  const ws = XLSX.utils.json_to_sheet(filas); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Cartera');
  XLSX.writeFile(wb, `cartera_agua_${hoyISO()}.xlsx`);
}
function mensajeRecordatorio(a) {
  const c = calc(a.id);
  if (c.deudaVencida > 0) return `Hola ${a.nombre}, le saludamos de ${nombreNegocio()}. Su servicio de agua (código ${a.codigo}) tiene un saldo pendiente de ${fmt(c.deuda)}${c.mesesAtr ? ` (${c.mesesAtr} mes${c.mesesAtr > 1 ? 'es' : ''})` : ''}. Le agradecemos ponerse al día. ¡Gracias!`;
  if (c.deuda > 0) return `Hola ${a.nombre}, le saludamos de ${nombreNegocio()}. Le recordamos que su mensualidad de agua (código ${a.codigo}) de ${fmt(c.deuda)} vence el ${fechaCorta(c.proximo)}. ¡Gracias!`;
  return `Hola ${a.nombre}, le saludamos de ${nombreNegocio()}. Su servicio de agua (código ${a.codigo}) está al día. ¡Gracias por su pago!`;
}
function awRecordar(id) {
  const a = abonado(id); const t = telWa(a?.whatsapp || a?.telefono);
  if (!t) { showToast('Este abonado no tiene teléfono.', 'warning'); return; }
  window.open(`https://wa.me/${t}?text=${encodeURIComponent(mensajeRecordatorio(a))}`, '_blank');
}
function awRecordarSerie() {
  const lista = filtrarCartera().filter(a => telWa(a.whatsapp || a.telefono) && calc(a.id).deuda > 0);
  if (!lista.length) { showToast('Nadie en esta lista debe y tiene teléfono.', 'warning'); return; }
  AW.serie = { lista, i: 0 };
  pintarSerie();
}
function pintarSerie() {
  const s = AW.serie, a = s.lista[s.i];
  awModal(`${cabModal('📲 Recordatorios en serie')}<div class="tl-modal-cuerpo">
    <p class="ag-ayuda">${s.i + 1} de ${s.lista.length}. Toca <b>Enviar</b>: se abre WhatsApp con el mensaje listo; envíalo y vuelve aquí para el siguiente.</p>
    <div class="ag-card" style="margin:0"><b class="aw-cod">${esc(a.codigo)}</b> · <b>${esc(nombreAb(a))}</b> · debe ${esc(fmt(calc(a.id).deuda))}
      <p class="tln-sub" style="margin-top:8px;white-space:pre-wrap">${esc(mensajeRecordatorio(a))}</p></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="awSerieMover(-1)" ${s.i ? '' : 'disabled'}>← Anterior</button><button class="btn-secondary" onclick="awSerieMover(1)">Saltar</button><button class="btn-primary" onclick="awRecordar('${a.id}');awSerieMover(1)">📲 Enviar</button></div>`);
}
function awSerieMover(d) { const s = AW.serie; s.i += d; if (s.i >= s.lista.length) { awCerrarModal(); showToast('Listo: terminaste la lista de recordatorios.'); return; } if (s.i < 0) s.i = 0; pintarSerie(); }

/* ---------- COBRAR ---------- */
function awCobrar(id) {
  awCerrarModal();
  AWCobro.abrir(id, { alCerrar: cobrado => { if (cobrado) { showToast('Cobro registrado.'); awRefrescar(); } } });
}

/* ---------- ABONADOS ---------- */
function vistaAbonados(v) {
  const t = AW.filtroAb.trim().toLowerCase();
  const lista = AW.abonados.filter(a => !t || a.codigo.toLowerCase().includes(t) || nombreAb(a).toLowerCase().includes(t) || String(a.cedula || '').toLowerCase().includes(t) || String(a.telefono || '').includes(t));
  const pag = Math.max(0, Math.min(AW.paginaAb, Math.ceil(lista.length / POR_PAGINA) - 1));
  v.innerHTML = `<div class="ag-card"><h3>👥 Abonados</h3>
    <p class="ag-ayuda">Cada abonado tiene su <b>código</b>. Una persona con dos casas tiene dos códigos. Al registrarlo se crea solo como cliente para que sus pagos salgan en Reportes.</p>
    <div class="ag-buscar"><input class="ag-inp" id="aw-ab-buscar" placeholder="Buscar por código, nombre, cédula o teléfono" value="${esc(AW.filtroAb)}" oninput="AW.filtroAb=this.value;AW.paginaAb=0;clearTimeout(window._abT);window._abT=setTimeout(()=>{vistaAbonados(document.getElementById('aw-vista'));const e=document.getElementById('aw-ab-buscar');e.focus();e.setSelectionRange(e.value.length,e.value.length)},200)">
      <button class="btn-primary" onclick="awEditarAbonado()">＋ Nuevo abonado</button><button class="btn-secondary" onclick="awImportar()">📥 Importar Excel</button></div>
    ${lista.length ? `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Código</th><th>Abonado</th><th class="aw-ocultar-movil">Teléfono</th><th class="aw-ocultar-movil">Sector</th><th class="num">Cuota</th><th>Servicio</th><th></th></tr></thead><tbody>
      ${lista.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA).map(a => `<tr><td class="aw-cod">${esc(a.codigo)}</td><td><b>${esc(nombreAb(a))}</b><div class="tln-sub">${esc(a.direccion || '')}</div></td>
        <td class="aw-ocultar-movil">${esc(a.telefono || '—')}</td><td class="aw-ocultar-movil">${esc(a.sector || '—')}</td><td class="num">${fmt(a.cuota)}${a.cobra_iva ? ' <span class="ag-pill">+IVA</span>' : ''}</td>
        <td>${pill(['cortado', 'suspendido', 'pausado'].includes(a.estado) ? a.estado : 'aldia').replace('🟢 Al día', '🟢 Activo')}</td>
        <td><div class="aw-acc"><button class="aw-btn" onclick="awFicha('${a.id}')">Ficha</button><button class="aw-btn" onclick="awEditarAbonado('${a.id}')">Editar</button></div></td></tr>`).join('')}
      </tbody></table></div>
      ${lista.length > POR_PAGINA ? `<div class="aw-pag"><button class="aw-btn" ${pag ? '' : 'disabled'} onclick="AW.paginaAb=${pag - 1};awTab('abonados')">← Anterior</button>Página ${pag + 1} de ${Math.ceil(lista.length / POR_PAGINA)}<button class="aw-btn" ${(pag + 1) * POR_PAGINA < lista.length ? '' : 'disabled'} onclick="AW.paginaAb=${pag + 1};awTab('abonados')">Siguiente →</button></div>` : ''}`
    : `<div class="ag-vacio"><div class="ico">💧</div><p>${AW.abonados.length ? 'Nadie coincide con la búsqueda.' : 'Aún no tienes abonados.'}</p></div>`}
  </div>`;
}
function campo(id, label, val, extra = '') { return `<div class="ag-campo"><label for="${id}">${label}</label><input class="ag-inp" id="${id}" value="${esc(val ?? '')}" ${extra}></div>`; }
function awEditarAbonado(id) {
  const a = id ? abonado(id) : null;
  const sug = !a ? `Vacío = automático (${esc(AW.cfg.prefijo || 'AB-')}0001…)` : '';
  awModal(`${cabModal(a ? `Editar abonado ${esc(a.codigo)}` : '➕ Nuevo abonado')}<div class="tl-modal-cuerpo">
    <div class="ag-grid2">${campo('awe-codigo', 'Código', a?.codigo, `placeholder="${sug}" maxlength="30" style="text-transform:uppercase"`)}${campo('awe-cuota', 'Cuota mensual *', a ? a.cuota : '', 'type="number" min="0" step="0.01" inputmode="decimal"')}</div>
    <div class="ag-grid2">${campo('awe-nombre', 'Nombre *', a?.nombre, 'maxlength="100"')}${campo('awe-apellido', 'Apellido', a?.apellido, 'maxlength="100"')}</div>
    <div class="ag-grid2">${campo('awe-cedula', 'Cédula / RUC', a?.cedula, 'maxlength="30"')}${campo('awe-telefono', 'Teléfono', a?.telefono, 'inputmode="tel" maxlength="20"')}</div>
    <div class="ag-grid2">${campo('awe-whatsapp', 'WhatsApp', a?.whatsapp, 'inputmode="tel" maxlength="20"')}${campo('awe-correo', 'Correo', a?.correo, 'type="email" maxlength="120"')}</div>
    ${campo('awe-direccion', 'Dirección *', a?.direccion, 'maxlength="250"')}
    <div class="ag-grid2">${campo('awe-referencia', 'Referencia de la casa', a?.referencia, 'maxlength="200" placeholder="Ej. portón verde"')}<div class="ag-campo"><label for="awe-sector">Sector / zona</label><input class="ag-inp" id="awe-sector" list="awe-sectores" value="${esc(a?.sector || '')}" maxlength="60"><datalist id="awe-sectores">${sectores().map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
    <div class="ag-grid2">${campo('awe-dia', 'Día de cobro (1-28)', a ? a.dia_cobro : AW.cfg.dia_cobro, 'type="number" min="1" max="28" step="1"')}${campo('awe-inicio', 'Inicia el servicio', a ? a.fecha_inicio : hoyISO(), 'type="date"')}</div>
    <label class="ag-chk"><input type="checkbox" id="awe-iva" ${a?.cobra_iva ? 'checked' : ''}> Cobrar IVA (${esc(String(AW.cfg.iva_pct))}%) en su mensualidad</label>
    ${campo('awe-notas', 'Notas', a?.notas, 'maxlength="500"')}
    ${a ? '<p class="tln-sub">El estado del servicio (pausar, cortar, reconectar) se cambia desde la <b>Ficha</b>.</p>' : ''}
    <div class="ag-alerta mal" id="awe-err" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="awCerrarModal()">Cancelar</button><button class="btn-primary" id="awe-guardar" onclick="awGuardarAbonado('${a?.id || ''}')">Guardar</button></div>`);
  setTimeout(() => document.getElementById(a ? 'awe-nombre' : 'awe-codigo')?.focus(), 50);
}
async function awGuardarAbonado(id) {
  const val = k => document.getElementById(k)?.value ?? '';
  const e = document.getElementById('awe-err'); e.style.display = 'none';
  const p = { id: id || null, codigo: val('awe-codigo'), nombre: val('awe-nombre'), apellido: val('awe-apellido'), cedula: val('awe-cedula'), telefono: val('awe-telefono'),
    whatsapp: val('awe-whatsapp'), correo: val('awe-correo'), direccion: val('awe-direccion'), referencia: val('awe-referencia'), sector: val('awe-sector'),
    cuota: val('awe-cuota'), dia_cobro: val('awe-dia'), fecha_inicio: val('awe-inicio'), cobra_iva: document.getElementById('awe-iva').checked, notas: val('awe-notas') };
  if (id) p.estado = abonado(id)?.estado || 'activo';
  const falta = !p.nombre.trim() ? 'Escribe el nombre.' : !p.direccion.trim() ? 'Escribe la dirección.' : (p.cuota === '' || Number(p.cuota) < 0) ? 'Escribe la cuota mensual.' : '';
  if (falta) { e.textContent = falta; e.style.display = 'flex'; return; }
  const b = document.getElementById('awe-guardar'); b.disabled = true; b.textContent = 'Guardando…'; AW.ocupado = true;
  try {
    const r = await rpc('agua_guardar_abonado', { p, p_usuario: AW.nombre });
    AW.ocupado = false; awCerrarModal();
    showToast(id ? 'Abonado actualizado.' : `Abonado ${r.codigo} registrado.`);
    await awRefrescar();
  } catch (x) { AW.ocupado = false; e.textContent = err(x); e.style.display = 'flex'; b.disabled = false; b.textContent = 'Guardar'; }
}

/* ---------- FICHA ---------- */
async function awFicha(id) {
  const a = abonado(id); if (!a) return;
  const c = calc(id);
  awModal(`${cabModal(`💧 ${esc(a.codigo)} · ${esc(nombreAb(a))}`)}<div class="tl-modal-cuerpo"><p class="tln-sub">Cargando…</p></div>`);
  let eventos = [], cobros = [];
  try {
    const [ev, co] = await Promise.all([
      sb.from('agua_eventos').select('*').eq('abonado_id', id).eq('auth_user_id', AW.userId).order('created_at', { ascending: false }).limit(40),
      sb.from('agua_cobros').select('id,monto,estado,venta_id,aplicado_en,created_at,a_favor').eq('abonado_id', id).eq('auth_user_id', AW.userId).eq('estado', 'aplicado').order('aplicado_en', { ascending: false }).limit(12),
    ]);
    eventos = ev.data || []; cobros = co.data || [];
  } catch (e) { console.warn('ficha:', e); }
  const pend = c.pend.slice().sort((x, y) => String(x.vence).localeCompare(String(y.vence)));
  const acciones = a.estado === 'cortado'
    ? `<button class="btn-secondary" onclick="awReconectar('${id}')">🔌 Reconectar</button>`
    : `${a.estado !== 'pausado' ? `<button class="btn-secondary" onclick="awCambiarEstado('${id}','pausado')">⏸️ Pausar</button>` : `<button class="btn-secondary" onclick="awCambiarEstado('${id}','activo')">▶️ Reactivar</button>`}
       ${a.estado !== 'suspendido' ? `<button class="btn-secondary" onclick="awCambiarEstado('${id}','suspendido')">⛔ Suspender</button>` : `<button class="btn-secondary" onclick="awCambiarEstado('${id}','activo')">▶️ Reactivar</button>`}
       <button class="btn-secondary" onclick="awCambiarEstado('${id}','cortado')">✂️ Cortar</button>`;
  document.getElementById('aw-modal-box').innerHTML = `${cabModal(`💧 ${esc(a.codigo)} · ${esc(nombreAb(a))}`)}<div class="tl-modal-cuerpo">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${pill(c.est)}${c.incumple ? '<span class="ag-pill mal">arreglo incumplido</span>' : ''}<span class="ag-pill">Servicio: ${esc(a.estado)}</span><span class="ag-pill">Cuota ${esc(fmt(a.cuota))}${a.cobra_iva ? ' + IVA' : ''}</span><span class="ag-pill">Cobro el día ${esc(String(a.dia_cobro))}</span>${Number(a.saldo_favor) > 0 ? `<span class="ag-pill ok">A favor ${esc(fmt(a.saldo_favor))}</span>` : ''}</div>
    <div class="tln-sub">${esc(a.direccion || '')}${a.referencia ? ' · ' + esc(a.referencia) : ''}${a.sector ? ' · Sector ' + esc(a.sector) : ''}<br>${esc(a.telefono || '')}${a.cedula ? ' · ' + esc(a.cedula) : ''}</div>
    <div class="ag-acciones" style="margin:0"><button class="btn-primary" onclick="awCobrar('${id}')">💳 Cobrar</button><button class="btn-secondary" onclick="awEstadoCuenta('${id}')">🧾 Estado de cuenta</button>
      ${(a.whatsapp || a.telefono) ? `<button class="btn-secondary" onclick="awRecordar('${id}')">📲 WhatsApp</button>` : ''}<button class="btn-secondary" onclick="awEditarAbonado('${id}')">✏️ Editar</button></div>
    <div><b>Pendiente: ${esc(fmt(c.deuda))}</b>${c.deudaVencida > 0 ? ` <span class="ag-rojo">(${esc(fmt(c.deudaVencida))} vencido)</span>` : ''}</div>
    ${pend.length ? `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Concepto</th><th>Vence</th><th class="num">Monto</th><th class="num">Abonado</th><th class="num">Debe</th><th></th></tr></thead><tbody>
      ${pend.map(x => `<tr><td>${esc(x.concepto)}${x.arreglo_id ? ' <span class="ag-pill">arreglo</span>' : ''}</td><td>${fechaCorta(x.vence)}</td><td class="num">${fmt(x.monto)}</td><td class="num">${fmt(x.pagado)}</td><td class="num"><b>${fmt(n2(x.monto - x.pagado))}</b></td>
        <td>${Number(x.pagado) > 0 ? '' : `<button class="aw-btn" title="Anular este cargo" onclick="awAnularCargo('${x.id}','${id}')">🗑️</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tln-sub">No debe nada.</p>'}
    ${c.arreglo ? `<div class="ag-alerta ${c.arreglo.cumple ? '' : 'mal'}" style="display:block"><b>🤝 Arreglo de pago:</b> ${esc(fmt(c.arreglo.r.monto))} · pagado ${esc(fmt(c.arreglo.pagado))} · falta ${esc(fmt(c.arreglo.resta))} ${c.arreglo.cumple ? '· al día' : '· <b>incumplido</b>'}
      <div class="tln-sub">${(c.arreglo.r.cuotas || []).map(q => `${fechaCorta(q.fecha)}: ${fmt(q.monto)}`).join(' · ')}</div></div>` : ''}
    <div class="ag-acciones" style="margin:0"><button class="btn-secondary" onclick="awCargoExtra('${id}')">➕ Cargo extra</button>${!c.arreglo && c.deudaVencida > 0 ? `<button class="btn-secondary" onclick="awNuevoArreglo('${id}')">🤝 Arreglo de pago</button>` : ''}${acciones}</div>
    ${cobros.length ? `<div><b>Últimos pagos</b><ul class="aw-hist">${cobros.map(k => `<li>${esc(fmt(k.monto))} <small>· ${esc(new Date(k.aplicado_en || k.created_at).toLocaleString('es-NI'))}${Number(k.a_favor) > 0 ? ' · ' + esc(fmt(k.a_favor)) + ' a favor' : ''}</small></li>`).join('')}</ul></div>` : ''}
    <div><b>Historial</b><ul class="aw-hist">${eventos.length ? eventos.map(e => `<li>${esc(e.descripcion)}<br><small>${esc(new Date(e.created_at).toLocaleString('es-NI'))}${e.usuario ? ' · ' + esc(e.usuario) : ''}</small></li>`).join('') : '<li><small>Sin movimientos todavía.</small></li>'}</ul></div>
  </div><div class="tl-modal-pie"><button class="btn-secondary" onclick="awCerrarModal()">Cerrar</button></div>`;
}
async function awAnularCargo(cargoId, abId) {
  const motivo = prompt('¿Por qué se anula este cargo? (queda en el historial)');
  if (!motivo || !motivo.trim()) return;
  try { await rpc('agua_anular_cargo', { p_cargo_id: cargoId, p_motivo: motivo, p_usuario: AW.nombre }); showToast('Cargo anulado.'); await awCargar(); awFicha(abId); if (AW.tab !== 'inicio') awTab(AW.tab); }
  catch (e) { showToast(err(e), 'error'); }
}
function awCargoExtra(id) {
  const a = abonado(id);
  awModal(`${cabModal(`➕ Cargo extra · ${esc(a.codigo)}`)}<div class="tl-modal-cuerpo">
    <div class="ag-campo"><label for="awx-tipo">Tipo</label><select class="ag-sel" id="awx-tipo"><option value="otro">Otro (material, reparación…)</option><option value="reconexion">Reconexión</option></select></div>
    ${campo('awx-concepto', 'Concepto *', '', 'maxlength="120" placeholder="Ej. Llave de paso"')}
    ${campo('awx-monto', 'Monto *', '', 'type="number" min="0" step="0.01" inputmode="decimal"')}
    ${a.cobra_iva ? `<p class="tln-sub">A este abonado se le suma IVA (${esc(String(AW.cfg.iva_pct))}%).</p>` : ''}
    <div class="ag-alerta mal" id="awx-err" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="awFicha('${id}')">Volver</button><button class="btn-primary" id="awx-ok" onclick="awGuardarCargo('${id}')">Agregar cargo</button></div>`);
}
async function awGuardarCargo(id) {
  const b = document.getElementById('awx-ok'), e = document.getElementById('awx-err');
  b.disabled = true;
  try {
    await rpc('agua_cargo_extra', { p_abonado_id: id, p_tipo: document.getElementById('awx-tipo').value, p_concepto: document.getElementById('awx-concepto').value,
      p_monto: n2(document.getElementById('awx-monto').value), p_usuario: AW.nombre });
    showToast('Cargo agregado.'); await awCargar(); awFicha(id);
  } catch (x) { e.textContent = err(x); e.style.display = 'flex'; b.disabled = false; }
}
async function awCambiarEstado(id, estado) {
  const a = abonado(id);
  const txt = { pausado: 'PAUSAR (no se le cobra mientras esté pausado: casa sola, viaje…)', suspendido: 'SUSPENDER', cortado: 'CORTAR el servicio', activo: 'REACTIVAR' }[estado];
  const motivo = prompt(`¿Seguro que quieres ${txt} a ${a.codigo}?\n\nEscribe el motivo (opcional):`, '');
  if (motivo === null) return;
  try { await rpc('agua_cambiar_estado', { p_abonado_id: id, p_estado: estado, p_motivo: motivo, p_cobrar_reconexion: false, p_usuario: AW.nombre }); showToast('Estado actualizado.'); await awCargar(); awFicha(id); }
  catch (e) { showToast(err(e), 'error'); }
}
function awReconectar(id) {
  const a = abonado(id), rec = Number(AW.cfg.reconexion) || 0;
  awModal(`${cabModal(`🔌 Reconectar · ${esc(a.codigo)}`)}<div class="tl-modal-cuerpo">
    <p>El servicio de <b>${esc(nombreAb(a))}</b> vuelve a quedar <b>activo</b>.</p>
    ${rec > 0 ? `<label class="ag-chk"><input type="checkbox" id="awr-cargo" checked> Cobrar reconexión de ${esc(fmt(rec))}${a.cobra_iva ? ' + IVA' : ''} (queda como cargo pendiente)</label>` : '<p class="tln-sub">No tienes cargo de reconexión configurado (Ajustes).</p>'}
    ${campo('awr-motivo', 'Nota (opcional)', '', 'maxlength="200"')}</div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="awFicha('${id}')">Volver</button><button class="btn-primary" id="awr-ok" onclick="awHacerReconexion('${id}')">Reconectar</button></div>`);
}
async function awHacerReconexion(id) {
  const b = document.getElementById('awr-ok'); b.disabled = true;
  try {
    const r = await rpc('agua_cambiar_estado', { p_abonado_id: id, p_estado: 'activo', p_motivo: document.getElementById('awr-motivo').value, p_cobrar_reconexion: !!document.getElementById('awr-cargo')?.checked, p_usuario: AW.nombre });
    showToast(Number(r.reconexion) > 0 ? `Reconectado. Cargo de reconexión ${fmt(r.reconexion)}.` : 'Reconectado.'); await awCargar(); awFicha(id); if (AW.tab === 'cortes') awTab('cortes');
  } catch (e) { showToast(err(e), 'error'); b.disabled = false; }
}
async function awEstadoCuenta(id) {
  const a = abonado(id), c = calc(id);
  const w = window.open('', '_blank'); if (!w) { showToast('Permite ventanas emergentes para imprimir.', 'warning'); return; }
  let cobros = [];
  try { const { data } = await sb.from('agua_cobros').select('monto,aplicado_en').eq('abonado_id', id).eq('auth_user_id', AW.userId).eq('estado', 'aplicado').order('aplicado_en', { ascending: false }).limit(12); cobros = data || []; } catch (_) {}
  const pend = c.pend.slice().sort((x, y) => String(x.vence).localeCompare(String(y.vence)));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Estado de cuenta ${esc(a.codigo)}</title><style>
    body{font-family:Arial,sans-serif;font-size:13px;margin:22px;color:#111;max-width:760px}h1{font-size:19px;margin:0}h2{font-size:14px;margin:18px 0 6px}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}td.n,th.n{text-align:right}
    .tot{font-size:16px;font-weight:bold;text-align:right;margin-top:10px}.muted{color:#666}@media print{button{display:none}}</style></head><body>
    <button onclick="print()" style="float:right;padding:8px 14px">Imprimir</button>
    <h1>${esc(nombreNegocio())}</h1><div class="muted">Estado de cuenta · ${esc(fechaCorta(hoyISO()))}</div>
    <h2>Abonado ${esc(a.codigo)}</h2><div><b>${esc(nombreAb(a))}</b><br>${esc(a.direccion || '')}${a.sector ? ' · ' + esc(a.sector) : ''}<br>Cuota mensual: ${esc(fmt(a.cuota))}${a.cobra_iva ? ' + IVA' : ''} · Día de cobro: ${esc(String(a.dia_cobro))}</div>
    <h2>Pendiente</h2>${pend.length ? `<table><thead><tr><th>Concepto</th><th>Vence</th><th class="n">Monto</th><th class="n">Abonado</th><th class="n">Debe</th></tr></thead><tbody>
      ${pend.map(x => `<tr><td>${esc(x.concepto)}</td><td>${esc(fechaCorta(x.vence))}</td><td class="n">${esc(fmt(x.monto))}</td><td class="n">${esc(fmt(x.pagado))}</td><td class="n">${esc(fmt(n2(x.monto - x.pagado)))}</td></tr>`).join('')}</tbody></table>` : '<p>No tiene saldo pendiente. ¡Gracias!</p>'}
    <div class="tot">Total a pagar: ${esc(fmt(c.deuda))}</div>${Number(a.saldo_favor) > 0 ? `<div class="muted" style="text-align:right">Saldo a favor: ${esc(fmt(a.saldo_favor))}</div>` : ''}
    ${cobros.length ? `<h2>Últimos pagos</h2><table><tbody>${cobros.map(k => `<tr><td>${esc(new Date(k.aplicado_en).toLocaleDateString('es-NI'))}</td><td class="n">${esc(fmt(k.monto))}</td></tr>`).join('')}</tbody></table>` : ''}
    </body></html>`);
  w.document.close();
}

/* ---------- COBRO DEL MES ---------- */
async function vistaMes(v) {
  const hoy = hoyISO(), mes = AW.mesSel || primerDia(hoy);
  const opciones = [-2, -1, 0, 1].map(n => sumarMes(primerDia(hoy), n));
  let cargos = [];
  try { cargos = await leerTodo(() => sb.from('agua_cargos').select('monto,pagado,estado').eq('auth_user_id', AW.userId).eq('tipo', 'mensualidad').eq('periodo', mes).neq('estado', 'anulado').order('id')); } catch (e) { console.warn(e); }
  const fact = n2(cargos.reduce((s, c) => s + Number(c.monto), 0)), cob = n2(cargos.reduce((s, c) => s + Number(c.pagado), 0));
  const sinGenerar = AW.abonados.filter(a => a.estado === 'activo' && Number(a.cuota) > 0 && a.fecha_inicio <= sumarDias(sumarMes(mes, 1), -1)).length - cargos.length;
  let hist = [];
  try { const { data } = await sb.from('agua_eventos').select('descripcion,created_at,usuario').eq('auth_user_id', AW.userId).eq('tipo', 'generar_mes').order('created_at', { ascending: false }).limit(10); hist = data || []; } catch (_) {}
  const moraTxt = AW.cfg.mora_tipo === 'fijo' ? `${fmt(AW.cfg.mora_valor)} por mes` : AW.cfg.mora_tipo === 'porcentaje' ? `${AW.cfg.mora_valor}% de la cuota por mes` : 'sin recargo';
  v.innerHTML = `<div class="ag-card"><h3>🗓️ Cobro del mes</h3>
    <p class="ag-ayuda">Crea la mensualidad de cada abonado <b>activo</b> (los pausados, suspendidos y cortados no se cobran). Si ya la tiene, no se repite: puedes tocarlo las veces que quieras. A quien tenga saldo a favor se le descuenta solo. Recargo por mora: <b>${esc(moraTxt)}</b> (Ajustes).</p>
    <div class="ag-buscar"><select class="ag-sel" id="aw-mes" style="max-width:260px" onchange="AW.mesSel=this.value;awTab('mes')">${opciones.map(o => `<option value="${o}" ${o === mes ? 'selected' : ''}>${mesTexto(o)}</option>`).join('')}</select>
      <button class="btn-primary" id="aw-generar" onclick="awGenerarMes()">Generar cobro de ${esc(mesTexto(mes))}</button></div>
    <div class="ag-kpis" style="margin-top:10px">
      <div class="ag-kpi"><div class="ag-kpi-l">Mensualidades</div><div class="ag-kpi-v">${cargos.length}</div><div class="ag-kpi-s">${sinGenerar > 0 ? sinGenerar + ' activo(s) sin generar' : 'Todos generados'}</div></div>
      <div class="ag-kpi"><div class="ag-kpi-l">Facturado</div><div class="ag-kpi-v">${fmt(fact)}</div></div>
      <div class="ag-kpi"><div class="ag-kpi-l">Cobrado del mes</div><div class="ag-kpi-v">${fmt(cob)}</div><div class="ag-kpi-s">${fact ? Math.round(cob / fact * 100) : 0}%</div></div>
      <div class="ag-kpi ${fact - cob > 0 ? 'ambar' : ''}"><div class="ag-kpi-l">Falta cobrar</div><div class="ag-kpi-v">${fmt(n2(fact - cob))}</div></div>
    </div></div>
    ${hist.length ? `<div class="ag-card"><h3>Historial</h3><ul class="aw-hist">${hist.map(h => `<li>${esc(h.descripcion)}<br><small>${esc(new Date(h.created_at).toLocaleString('es-NI'))}${h.usuario ? ' · ' + esc(h.usuario) : ''}</small></li>`).join('')}</ul></div>` : ''}`;
}
async function awGenerarMes() {
  const mes = document.getElementById('aw-mes').value;
  if (!confirm(`¿Generar el cobro de ${mesTexto(mes)}?\n\nA cada abonado activo se le crea su mensualidad (si ya la tiene, no se repite).`)) return;
  const b = document.getElementById('aw-generar'); b.disabled = true; b.textContent = 'Generando…';
  try {
    const r = await rpc('agua_generar_mes', { p_periodo: mes, p_usuario: AW.nombre });
    showToast(`${mesTexto(mes)}: ${r.nuevos} mensualidad(es) nuevas por ${fmt(r.total)}${r.ya_estaban ? `, ${r.ya_estaban} ya estaban` : ''}${r.mora ? `, ${r.mora} con mora` : ''}.`);
    await awRefrescar();
  } catch (e) { showToast(err(e), 'error'); b.disabled = false; b.textContent = 'Generar'; }
}

/* ---------- ARREGLOS ---------- */
function vistaArreglos(v) {
  const lista = AW.abonados.filter(a => calc(a.id).arreglo);
  v.innerHTML = `<div class="ag-card"><h3>🤝 Arreglos de pago</h3>
    <p class="ag-ayuda">La deuda vencida se divide en cuotas con fecha. Mientras cumpla, sale como <b>En arreglo</b> y no aparece para corte. Si se atrasa en una cuota, sale como <b>incumplido</b>. Las mensualidades nuevas se cobran aparte. Para hacer uno: Ficha del abonado → <b>Arreglo de pago</b>.</p>
    ${lista.length ? `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Código</th><th>Abonado</th><th class="num">Arreglo</th><th class="num">Pagado</th><th class="num">Falta</th><th>Próxima cuota</th><th>Cumple</th><th></th></tr></thead><tbody>
      ${lista.map(a => { const r = calc(a.id).arreglo; return `<tr><td class="aw-cod">${esc(a.codigo)}</td><td>${esc(nombreAb(a))}</td><td class="num">${fmt(r.r.monto)}</td><td class="num">${fmt(r.pagado)}</td><td class="num">${fmt(r.resta)}</td>
        <td>${r.prox ? fechaCorta(r.prox) : '—'}</td><td>${r.cumple ? '<span class="ag-pill ok">Sí</span>' : '<span class="ag-pill mal">Incumplido</span>'}</td>
        <td><div class="aw-acc"><button class="aw-btn pri" onclick="awCobrar('${a.id}')">💳 Cobrar</button><button class="aw-btn" onclick="awFicha('${a.id}')">Ficha</button><button class="aw-btn" onclick="awAnularArreglo('${r.r.id}')">Anular</button></div></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="ag-vacio"><div class="ico">🤝</div><p>No hay arreglos vigentes.</p></div>'}</div>`;
}
function awNuevoArreglo(id) {
  const a = abonado(id), c = calc(id), hoy = hoyISO();
  const deuda = n2(c.pend.filter(x => x.vence <= hoy && !x.arreglo_id).reduce((s, x) => s + Number(x.monto) - Number(x.pagado), 0));
  AW.arr = { id, deuda };
  awModal(`${cabModal(`🤝 Arreglo de pago · ${esc(a.codigo)}`)}<div class="tl-modal-cuerpo">
    <p>Deuda vencida a dividir: <b>${esc(fmt(deuda))}</b></p>
    <div class="ag-grid2">${campo('awa-n', 'Número de cuotas', 3, 'type="number" min="1" max="24" step="1"')}<div class="ag-campo"><label for="awa-cada">Cada</label><select class="ag-sel" id="awa-cada"><option value="7">Semana</option><option value="15" selected>Quincena</option><option value="30">Mes</option></select></div></div>
    ${campo('awa-desde', 'Primera cuota', sumarDias(hoy, 7), 'type="date"')}
    <button class="btn-secondary" onclick="awArmarCuotas()">Repartir en cuotas iguales</button>
    <div id="awa-cuotas"></div>
    ${campo('awa-notas', 'Nota (opcional)', '', 'maxlength="300"')}
    <div class="ag-alerta mal" id="awa-err" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="awFicha('${id}')">Volver</button><button class="btn-primary" id="awa-ok" onclick="awGuardarArreglo()">Guardar arreglo</button></div>`);
  awArmarCuotas();
}
function awArmarCuotas() {
  const n = Math.max(1, Math.min(24, parseInt(document.getElementById('awa-n').value, 10) || 1)), cada = Number(document.getElementById('awa-cada').value) || 15;
  const desde = document.getElementById('awa-desde').value || hoyISO(), d = AW.arr.deuda;
  const base = Math.floor(d / n * 100) / 100;
  const cuotas = Array.from({ length: n }, (_, i) => ({ fecha: cada === 30 ? sumarMesDia(desde, i) : sumarDias(desde, i * cada), monto: i === n - 1 ? n2(d - base * (n - 1)) : base }));
  document.getElementById('awa-cuotas').innerHTML = `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>#</th><th>Fecha</th><th class="num">Monto</th></tr></thead><tbody>
    ${cuotas.map((q, i) => `<tr><td>${i + 1}</td><td><input class="ag-inp" type="date" data-q-f="${i}" value="${q.fecha}"></td><td><input class="ag-inp" type="number" min="0" step="0.01" data-q-m="${i}" value="${q.monto.toFixed(2)}" oninput="awSumaCuotas()"></td></tr>`).join('')}
    </tbody></table></div><div class="tln-sub" id="awa-suma"></div>`;
  awSumaCuotas();
}
function sumarMesDia(iso, n) { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y, m - 1 + n, 1); const ult = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`; }
function awSumaCuotas() {
  const s = n2([...document.querySelectorAll('[data-q-m]')].reduce((a, i) => a + Number(i.value || 0), 0));
  const el = document.getElementById('awa-suma'); if (!el) return;
  const ok = Math.abs(s - AW.arr.deuda) < 0.011;
  el.innerHTML = `Suma: <b>${fmt(s)}</b> de ${fmt(AW.arr.deuda)} ${ok ? '✅' : '<span class="ag-rojo">— debe sumar exacto</span>'}`;
}
async function awGuardarArreglo() {
  const cuotas = [...document.querySelectorAll('[data-q-f]')].map((f, i) => ({ fecha: f.value, monto: n2(document.querySelector(`[data-q-m="${i}"]`).value) }));
  const b = document.getElementById('awa-ok'), e = document.getElementById('awa-err'); b.disabled = true;
  try {
    await rpc('agua_crear_arreglo', { p_abonado_id: AW.arr.id, p_cuotas: cuotas, p_notas: document.getElementById('awa-notas').value, p_usuario: AW.nombre });
    showToast('Arreglo de pago guardado.'); await awCargar(); awFicha(AW.arr.id);
  } catch (x) { e.textContent = err(x); e.style.display = 'flex'; b.disabled = false; }
}
async function awAnularArreglo(arregloId) {
  const motivo = prompt('¿Por qué se anula el arreglo? La deuda vuelve a quedar como atrasada.');
  if (!motivo || !motivo.trim()) return;
  try { await rpc('agua_anular_arreglo', { p_arreglo_id: arregloId, p_motivo: motivo, p_usuario: AW.nombre }); showToast('Arreglo anulado.'); await awRefrescar(); }
  catch (e) { showToast(err(e), 'error'); }
}

/* ---------- CORTES ---------- */
function vistaCortes(v) {
  const meses = Number(AW.cfg.meses_corte) || 2;
  const paraCorte = AW.abonados.filter(a => a.estado === 'activo' && calc(a.id).mesesAtr >= meses && !(calc(a.id).arreglo && calc(a.id).arreglo.cumple));
  const cortados = AW.abonados.filter(a => a.estado === 'cortado');
  const tabla = (lista, accion) => lista.length ? `<div class="ag-tw"><table class="ag-tabla"><thead><tr><th>Código</th><th>Abonado</th><th class="aw-ocultar-movil">Dirección</th><th class="num">Debe</th><th>Atraso</th><th></th></tr></thead><tbody>
    ${lista.map(a => { const c = calc(a.id); return `<tr><td class="aw-cod">${esc(a.codigo)}</td><td>${esc(nombreAb(a))}</td><td class="aw-ocultar-movil">${esc(a.direccion || '')}</td><td class="num ag-rojo">${fmt(c.deuda)}</td><td>${c.mesesAtr} mes(es)</td>
      <td><div class="aw-acc">${accion(a)}<button class="aw-btn" onclick="awFicha('${a.id}')">Ficha</button></div></td></tr>`; }).join('')}</tbody></table></div>` : '';
  v.innerHTML = `<div class="ag-card"><h3>✂️ Para corte <span class="ag-pill">${paraCorte.length}</span></h3>
    <p class="ag-ayuda">Abonados activos con <b>${meses} o más meses</b> atrasados y sin un arreglo al día (lo cambias en Ajustes). Cortar no borra la deuda.</p>
    ${tabla(paraCorte, a => `<button class="aw-btn" onclick="awCambiarEstado('${a.id}','cortado').then(()=>awTab('cortes'))">✂️ Cortar</button><button class="aw-btn pri" onclick="awCobrar('${a.id}')">💳 Cobrar</button>`) || '<p class="tln-sub">Nadie para corte. 👍</p>'}
    ${paraCorte.length ? `<div class="ag-acciones"><button class="btn-secondary" onclick="AW.filtro={texto:'',estado:'',sector:'',meses:'${meses}',deudaMin:''};awImprimirLista()">🖨️ Imprimir lista de corte</button></div>` : ''}</div>
    <div class="ag-card"><h3>⚫ Cortados <span class="ag-pill">${cortados.length}</span></h3>
    ${tabla(cortados, a => `<button class="aw-btn pri" onclick="awCobrar('${a.id}')">💳 Cobrar</button><button class="aw-btn" onclick="awReconectar('${a.id}')">🔌 Reconectar</button>`) || '<p class="tln-sub">No hay abonados cortados.</p>'}</div>`;
}

/* ---------- GASTOS Y MÁS (pantallas de siempre, dentro del panel) ---------- */
const AW_OTRAS = [['gastos.html', '💸 Gastos'], ['compras.html', '🛒 Compras'], ['productos.html', '📦 Materiales'], ['caja.html', '💵 Caja'], ['salarios.html', '👷 Salarios'], ['cuentas-por-pagar.html', '📄 Cuentas por pagar']];
const AW_CSS_DENTRO = `#sidebar,#sidebar-overlay,#header,.mobile-menu-btn,#n360-asistente-btn,.asis-fab,.chat-fab{display:none!important}
#main{margin-left:0!important;width:100%!important;min-height:0!important}html,body{overflow-x:hidden}`;
function vistaOtros(v) {
  const sel = AW.otra || 'gastos.html';
  v.innerHTML = `<div class="ag-card" style="padding:10px"><p class="ag-ayuda" style="margin:0 0 8px">Las pantallas de siempre, aquí mismo: lo que registres (luz de la bomba, reparaciones, cloro, salario del cobrador) queda en Gastos, Compras y Caja como siempre y sale en Reportes.</p>
    <div class="ag-tabs" style="margin:0 0 8px">${AW_OTRAS.map(([f, t]) => `<button type="button" class="ag-tab ${f === sel ? 'activa' : ''}" onclick="AW.otra='${f}';awTab('otros')">${t}</button>`).join('')}</div>
    <div class="aw-marco-wrap" id="aw-marco-wrap"><iframe id="aw-marco" title="Pantalla" src="${sel}"></iframe></div></div>`;
  const fr = document.getElementById('aw-marco'), wrap = document.getElementById('aw-marco-wrap');
  const alto = () => { const top = wrap.getBoundingClientRect().top; wrap.style.height = Math.max(520, window.innerHeight - Math.max(0, top) - 12) + 'px'; fr.style.height = '100%'; };
  alto(); window.addEventListener('resize', alto);
  let n = 0; clearInterval(AW.vigia);
  AW.vigia = setInterval(() => { n++; try { const d = fr.contentDocument; if (d && d.documentElement && d.documentElement.dataset.awDentro !== '1' && d.location.href !== 'about:blank') { d.documentElement.dataset.awDentro = '1'; const st = d.createElement('style'); st.textContent = AW_CSS_DENTRO; (d.head || d.documentElement).appendChild(st); } } catch (_) {} if (n > 400) clearInterval(AW.vigia); }, 25);
  fr.addEventListener('load', () => {
    try { const f = fr.contentWindow.location.pathname.split('/').pop(); if (['login.html', 'index.html', 'dashboard.html', 'agua.html'].includes(f)) { fr.src = 'about:blank'; if (f === 'login.html') location.href = 'login.html'; return; } } catch (_) {}
    try { const d = fr.contentDocument; if (d && d.documentElement.dataset.awDentro !== '1') { d.documentElement.dataset.awDentro = '1'; const st = d.createElement('style'); st.textContent = AW_CSS_DENTRO; d.head.appendChild(st); } } catch (_) {}
  });
}

/* ---------- AJUSTES ---------- */
function vistaAjustes(v) {
  const c = AW.cfg;
  v.innerHTML = `<div class="ag-card"><h3>⚙️ Reglas del cobro</h3>
    <div class="ag-grid2">${campo('awc-dia', 'Día de cobro por defecto (1-28)', c.dia_cobro, 'type="number" min="1" max="28"')}${campo('awc-gracia', 'Días de gracia antes de la mora', c.dias_gracia, 'type="number" min="0" max="60"')}</div>
    <div class="ag-grid2"><div class="ag-campo"><label for="awc-mora-tipo">Recargo por mora</label><select class="ag-sel" id="awc-mora-tipo">
      <option value="ninguno" ${c.mora_tipo === 'ninguno' ? 'selected' : ''}>Sin recargo</option><option value="fijo" ${c.mora_tipo === 'fijo' ? 'selected' : ''}>Monto fijo por mes</option><option value="porcentaje" ${c.mora_tipo === 'porcentaje' ? 'selected' : ''}>% de la cuota por mes</option></select></div>
      ${campo('awc-mora-valor', 'Valor del recargo', c.mora_valor, 'type="number" min="0" step="0.01"')}</div>
    <div class="ag-grid2">${campo('awc-corte', 'Meses atrasados para corte', c.meses_corte, 'type="number" min="1" max="24"')}${campo('awc-recon', 'Cargo de reconexión', c.reconexion, 'type="number" min="0" step="0.01"')}</div>
    <div class="ag-grid2">${campo('awc-iva', 'IVA % (para abonados con IVA)', c.iva_pct, 'type="number" min="0" max="100" step="0.01"')}${campo('awc-prefijo', 'Inicio del código automático', c.prefijo, 'maxlength="8" style="text-transform:uppercase"')}</div>
    <label class="ag-chk"><input type="checkbox" id="awc-menu" ${c.menu_exclusivo ? 'checked' : ''}> <span><b>Menú solo del panel:</b> el menú de la izquierda muestra solo Panel Agua, Dashboard, Reportes, Estadísticas, Sucursales y Configuración. (No borra ni bloquea nada; se quita desmarcando aquí.)</span></label>
    <p class="tln-sub">La mora se suma una vez al mes, al generar el cobro del mes, a quien tenga meses anteriores vencidos (pasados los días de gracia) y sin arreglo de pago.</p>
    <div class="ag-alerta mal" id="awc-err" style="display:none"></div>
    <div class="ag-acciones"><button class="btn-primary" id="awc-ok" onclick="awGuardarAjustes()">Guardar ajustes</button></div></div>
    <div class="ag-card"><h3>📥 Plantilla de Excel</h3><p class="ag-ayuda">Descarga la plantilla, llena una fila por abonado y súbela en <b>Abonados → Importar Excel</b>.</p>
      <button class="btn-secondary" onclick="awDescargarPlantilla()">⬇️ Descargar plantilla</button></div>`;
}
async function awGuardarAjustes() {
  const val = id => document.getElementById(id).value;
  const p = { dia_cobro: val('awc-dia'), dias_gracia: val('awc-gracia'), mora_tipo: val('awc-mora-tipo'), mora_valor: val('awc-mora-valor'), meses_corte: val('awc-corte'),
    reconexion: val('awc-recon'), iva_pct: val('awc-iva'), prefijo: val('awc-prefijo'), menu_exclusivo: document.getElementById('awc-menu').checked };
  const b = document.getElementById('awc-ok'), e = document.getElementById('awc-err'); b.disabled = true; e.style.display = 'none';
  try { const r = await rpc('agua_guardar_config', { p }); AW.cfg = { ...AW_DEF, ...(r.config || {}) }; window.__awCfg = AW.cfg; showToast('Ajustes guardados. El menú cambia al recargar la página.'); awCalcular(); vistaAjustes(document.getElementById('aw-vista')); }
  catch (x) { e.textContent = err(x); e.style.display = 'flex'; b.disabled = false; }
}

/* ---------- IMPORTAR (plantilla de Excel) ---------- */
const COLS_IMPORT = [['codigo', ['código', 'codigo']], ['nombre', ['nombre']], ['apellido', ['apellido']], ['cedula', ['cédula', 'cedula', 'ruc']], ['telefono', ['teléfono', 'telefono']],
  ['whatsapp', ['whatsapp']], ['correo', ['correo', 'email']], ['direccion', ['dirección', 'direccion']], ['referencia', ['referencia']], ['sector', ['sector', 'zona']],
  ['cuota', ['cuota']], ['dia_cobro', ['día de cobro', 'dia de cobro', 'día', 'dia']], ['estado', ['estado']], ['notas', ['notas']],
  ['deuda', ['deuda']], ['meses_atrasados', ['meses atrasados']], ['saldo_favor', ['saldo a favor']], ['cobra_iva', ['iva']], ['fecha_inicio', ['fecha de inicio', 'inicio']]];
function awDescargarPlantilla() {
  if (!window.XLSX) { showToast('No se pudo cargar Excel. Revisa tu conexión.', 'error'); return; }
  const enc = ['Código *', 'Nombre *', 'Apellido', 'Cédula / RUC', 'Teléfono', 'WhatsApp', 'Correo', 'Dirección *', 'Referencia de la casa', 'Sector / Zona', 'Cuota mensual (C$) *', 'Día de cobro (1-28)', 'Estado', 'Notas', 'Deuda al iniciar', 'Meses atrasados', 'Saldo a favor', 'Cobra IVA (Sí/No)'];
  const ej = ['AB-0001', 'María José', 'López Ruiz', '001-150385-0003K', '8888-1234', '8888-1234', '', 'Del pozo 2 c. al norte', 'Portón verde', 'Sector 1', 350, 5, 'Activo', 'Ejemplo: borra esta fila', 0, 0, 0, 'No'];
  const ws = XLSX.utils.aoa_to_sheet([enc, ej]); ws['!cols'] = enc.map(h => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Abonados'); XLSX.writeFile(wb, 'Plantilla Abonados.xlsx');
}
function awImportar() {
  awModal(`${cabModal('📥 Importar abonados desde Excel')}<div class="tl-modal-cuerpo">
    <p class="ag-ayuda">Usa la plantilla (una fila por abonado). Columnas obligatorias: <b>Código, Nombre y Cuota</b>. Si alguna fila tiene un error, <b>no se guarda ninguna</b> y te decimos cuál corregir.</p>
    <div class="ag-acciones" style="margin:0"><input type="file" id="awi-archivo" accept=".xlsx,.xls,.csv"><button class="btn-secondary" onclick="awDescargarPlantilla()">⬇️ Plantilla</button></div>
    <div id="awi-prev"></div><div class="ag-alerta mal" id="awi-err" style="display:none;white-space:pre-wrap"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="awCerrarModal()">Cancelar</button><button class="btn-primary" id="awi-ok" disabled onclick="awConfirmarImport()">Importar</button></div>`);
  document.getElementById('awi-archivo').addEventListener('change', awLeerArchivo);
}
function normalizar(t) { return String(t || '').toLowerCase().replace(/\*/g, '').replace(/\(.*?\)/g, '').trim(); }
async function awLeerArchivo(ev) {
  const file = ev.target.files[0]; if (!file) return;
  const e = document.getElementById('awi-err'); e.style.display = 'none';
  if (!window.XLSX) { e.textContent = 'No se pudo cargar Excel. Revisa tu conexión.'; e.style.display = 'flex'; return; }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames.find(n => /abonad/i.test(n)) || wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const iEnc = filas.findIndex(f => f.some(c => /c[oó]digo/i.test(String(c))) && f.some(c => /nombre/i.test(String(c))));
    if (iEnc < 0) throw new Error('No encontré la fila de encabezados (Código, Nombre…). Usa la plantilla.');
    const enc = filas[iEnc].map(normalizar);
    const idx = {}; COLS_IMPORT.forEach(([k, alias]) => { const i = enc.findIndex(h => alias.some(al => h === al || h.startsWith(al))); if (i >= 0) idx[k] = i; });
    if (idx.codigo == null || idx.nombre == null || idx.cuota == null) throw new Error('Faltan columnas: Código, Nombre o Cuota.');
    const out = [];
    filas.slice(iEnc + 1).forEach(f => {
      if (!f.some(c => String(c).trim() !== '')) return;
      const g = k => idx[k] == null ? '' : f[idx[k]];
      if (/ejemplo/i.test(String(g('notas'))) && /^AB-0001$/i.test(String(g('codigo')).trim())) return;   // fila de ejemplo de la plantilla
      const est = String(g('estado') || '').trim().toLowerCase();
      const fi = g('fecha_inicio'); const fiIso = fi instanceof Date ? fi.toISOString().slice(0, 10) : (String(fi || '').match(/^\d{4}-\d{2}-\d{2}/) ? String(fi).slice(0, 10) : '');
      out.push({ codigo: String(g('codigo')).trim(), nombre: String(g('nombre')).trim(), apellido: String(g('apellido')).trim(), cedula: String(g('cedula')).trim(),
        telefono: String(g('telefono')).trim(), whatsapp: String(g('whatsapp')).trim(), correo: String(g('correo')).trim(), direccion: String(g('direccion')).trim(),
        referencia: String(g('referencia')).trim(), sector: String(g('sector')).trim(), cuota: g('cuota') === '' ? '' : String(Number(String(g('cuota')).replace(/[^\d.-]/g, '')) || 0),
        dia_cobro: g('dia_cobro') === '' ? '' : String(parseInt(g('dia_cobro'), 10) || ''), estado: est ? (['activo', 'pausado', 'suspendido', 'cortado'].includes(est) ? est : est) : 'activo',
        notas: String(g('notas')).trim(), deuda: String(Number(g('deuda')) || 0), meses_atrasados: String(g('meses_atrasados') || ''), saldo_favor: String(Number(g('saldo_favor')) || 0),
        cobra_iva: /^s[ií]/i.test(String(g('cobra_iva')).trim()), fecha_inicio: fiIso });
    });
    if (!out.length) throw new Error('El archivo no tiene filas con abonados.');
    AW.import = out;
    const deuda = n2(out.reduce((s, r) => s + Number(r.deuda || 0), 0));
    document.getElementById('awi-prev').innerHTML = `<div class="ag-alerta" style="display:block"><b>${out.length}</b> abonado(s) listos para revisar · cuota mensual total ${esc(fmt(out.reduce((s, r) => s + Number(r.cuota || 0), 0)))}${deuda ? ` · deuda anterior ${esc(fmt(deuda))}` : ''}</div>
      <div class="ag-tw" style="max-height:240px;overflow:auto"><table class="ag-tabla"><thead><tr><th>Código</th><th>Nombre</th><th>Sector</th><th class="num">Cuota</th><th>Estado</th></tr></thead><tbody>
      ${out.slice(0, 50).map(r => `<tr><td class="aw-cod">${esc(r.codigo)}</td><td>${esc(r.nombre + ' ' + r.apellido)}</td><td>${esc(r.sector)}</td><td class="num">${esc(r.cuota)}</td><td>${esc(r.estado)}</td></tr>`).join('')}
      </tbody></table></div>${out.length > 50 ? `<p class="tln-sub">… y ${out.length - 50} más.</p>` : ''}`;
    document.getElementById('awi-ok').disabled = false;
  } catch (x) { e.textContent = err(x); e.style.display = 'flex'; document.getElementById('awi-ok').disabled = true; }
}
async function awConfirmarImport() {
  const b = document.getElementById('awi-ok'), e = document.getElementById('awi-err'); b.disabled = true; b.textContent = 'Importando…'; AW.ocupado = true; e.style.display = 'none';
  try {
    const r = await rpc('agua_importar', { p_filas: AW.import, p_usuario: AW.nombre });
    AW.ocupado = false;
    if (!r.ok) {
      e.textContent = 'No se importó nada. Corrige estas filas y vuelve a subir el archivo:\n' + (r.errores || []).slice(0, 30).map(x => `• Fila ${x.fila}: ${x.error}`).join('\n') + ((r.errores || []).length > 30 ? `\n… y ${(r.errores || []).length - 30} más` : '');
      e.style.display = 'flex'; b.textContent = 'Importar'; return;
    }
    awCerrarModal(); showToast(`${r.importados} abonado(s) importados.`); AW.import = null; await awRefrescar();
  } catch (x) { AW.ocupado = false; e.textContent = err(x); e.style.display = 'flex'; b.disabled = false; b.textContent = 'Importar'; }
}

/* ---------- arranque ---------- */
async function awInit() {
  applyTheme((() => { try { return localStorage.getItem('n360_theme') || 'light'; } catch (_) { return 'light'; } })());
  const f = document.getElementById('header-fecha'); if (f) f.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user; AW.userId = user.id; window.__awUid = user.id;
    const { data: cfg } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', user.id).maybeSingle();
    AW.empresaConfig = cfg || {}; AW.cfg = { ...AW_DEF, ...((cfg && cfg.agua_config) || {}) }; window.__awCfg = AW.cfg;
    if (cfg?.color_principal) { document.documentElement.style.setProperty('--accent', cfg.color_principal); document.documentElement.style.setProperty('--accent-soft', cfg.color_principal + '22'); }
    const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const { data: perfil } = await sb.from('usuarios').select('*').eq('auth_user_id', user.id).maybeSingle();
    AW.nombre = perfil ? (`${perfil.nombre || ''} ${perfil.apellido || ''}`.trim() || user.email?.split('@')[0] || 'Usuario') : (user.email?.split('@')[0] || 'Usuario');
    try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.nombre) AW.nombre = String(pf.nombre).slice(0, 100); } catch (_) {}
    window.__awUsuario = AW.nombre;
    const hn = document.getElementById('header-name'); if (hn) hn.textContent = AW.nombre;
    const hb = document.getElementById('header-biz'); if (hb) hb.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const ha = document.getElementById('header-avatar'); if (ha) ha.textContent = (AW.nombre[0] || 'U').toUpperCase();
    const pt = document.getElementById('plan-text'); if (pt) pt.textContent = perfil?.plan ? String(perfil.plan).charAt(0).toUpperCase() + String(perfil.plan).slice(1) : 'Plan';
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    if (AW.empresaConfig.usa_modulo_agua !== true) {
      document.getElementById('content').innerHTML = `<div class="tl-apagado"><div style="font-size:42px">💧</div><h2>El Panel Agua está apagado</h2>
        <p>Actívalo en <b>Configuración → Panel Agua</b> para manejar abonados, mensualidades, cartera, arreglos y cortes.</p>
        <button class="btn-primary" onclick="navigate('configuracion.html')">Ir a Configuración</button></div>`;
      return;
    }
    const inicial = (location.hash || '').replace('#', '');
    await awTab(['inicio', 'cartera', 'abonados', 'mes', 'arreglos', 'cortes', 'otros', 'ajustes'].includes(inicial) ? inicial : 'inicio');
  } catch (e) {
    console.error('awInit:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando el Panel Agua.', 'error');
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') awCerrarModal(); });
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', () => { awInit(); if (window.lucide) lucide.createIcons(); });
