/* ============================================================
   TRANSPORTE-ORDENES.JS — NEGOCIO360 (Transporte · Fases 5 y 6)
   Órdenes de transporte con tablero de despacho, ciclo del viaje
   (pendiente → asignada → en ruta → entregada), costos del viaje
   (opcionalmente pagados desde Caja como Gasto) y rentabilidad.
   Escribe solo en transporte_*; Gastos/Caja solo cuando el usuario
   marca "Pagado ahora desde Caja". Lee Clientes, Flota y Conductores.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, num, fmtFecha } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const OT = {
  ordenes: [], costos: [], rutas: [], tarifas: [], clientes: [], unidades: [], conductores: [],
  docsU: {}, docsC: {}, metodos: [], bancos: [],
  vista: 'tablero', filtro: { q: '', estado: '', periodo: 'mes' },
  editando: null, detalleId: null, tab: 'resumen', costoEdit: null, cantManual: false,
};
const ESTADOS = {
  pendiente: { t: 'Pendiente', clase: 'gris', ico: '🕓' },
  asignada:  { t: 'Asignada', clase: 'naranja', ico: '🧑‍✈️' },
  en_ruta:   { t: 'En ruta', clase: 'azul', ico: '🚚' },
  entregada: { t: 'Entregada', clase: 'verde', ico: '✅' },
  cancelada: { t: 'Cancelada', clase: 'rojo', ico: '⛔' },
};
const ACTIVAS = ['pendiente', 'asignada', 'en_ruta'];
const CAT_COSTO = {
  combustible: { t: 'Combustible', ico: '⛽', gasto: 'Combustible' },
  peaje:       { t: 'Peajes', ico: '🛣️', gasto: 'Otros' },
  viatico:     { t: 'Viáticos (comida)', ico: '🍽️', gasto: 'Otros' },
  anticipo:    { t: 'Anticipo al conductor', ico: '💵', gasto: 'Otros' },
  reparacion:  { t: 'Reparación en ruta', ico: '🔧', gasto: 'Mantenimiento' },
  frontera:    { t: 'Trámites de frontera', ico: '🛂', gasto: 'Otros' },
  hospedaje:   { t: 'Hospedaje', ico: '🏨', gasto: 'Otros' },
  otro:        { t: 'Otro costo', ico: '📌', gasto: 'Otros' },
};
const COBRO = { viaje: 'viaje', km: 'km', tonelada: 'tonelada' };
const PERIODOS = { mes: 'Este mes', '3m': 'Últimos 90 días', anio: 'Este año', todo: 'Todo el historial' };

/* ============================================================
   CARGA
   ============================================================ */
async function cargarOrdenes() {
  OT.ordenes = await TX.paginar(() => sb.from('transporte_ordenes').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }));
}
async function cargarCostos() {
  OT.costos = await TX.paginar(() => sb.from('transporte_costos').select('*').eq('auth_user_id', TX.userId).order('fecha', { ascending: false }));
  // Pago real a conductores (liquidaciones no anuladas): también es costo del viaje
  try { OT.liqOrd = await TX.paginar(() => sb.from('transporte_liquidacion_ordenes').select('*').eq('auth_user_id', TX.userId)); } catch (_) { OT.liqOrd = []; }
  // Fletes subcontratados (transportistas externos, no anulados): también son costo del viaje
  try { OT.subOrd = await TX.paginar(() => sb.from('transporte_subcontrataciones').select('*').eq('auth_user_id', TX.userId).eq('estado', 'activa')); } catch (_) { OT.subOrd = []; }
  OT.comp = await TX.cargarComprobantes();
}
async function cargarTodo() {
  const [, , rutas, tarifas, unidades, conductores, docsU, docsC] = await Promise.all([
    cargarOrdenes(), cargarCostos(),
    TX.paginar(() => sb.from('transporte_rutas').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_tarifas').select('*').eq('auth_user_id', TX.userId)),
    TX.paginar(() => sb.from('transporte_unidades').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_conductores').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.cargarDocs('unidad'), TX.cargarDocs('conductor'),
  ]);
  OT.rutas = rutas; OT.tarifas = tarifas; OT.unidades = unidades; OT.conductores = conductores;
  OT.docsU = TX.agruparDocs(docsU); OT.docsC = TX.agruparDocs(docsC);
  try { const { data } = await sb.from('clientes').select('id,nombre').eq('auth_user_id', TX.userId).eq('activo', true).order('nombre'); OT.clientes = data || []; } catch (_) { OT.clientes = []; }
  try { const { data } = await sb.from('metodos_pago').select('*').eq('auth_user_id', TX.userId).eq('activo', true).order('orden'); OT.metodos = data || []; } catch (_) { OT.metodos = []; }
  try { const { data } = await sb.from('bancos').select('id,nombre').eq('auth_user_id', TX.userId).eq('activo', true).order('nombre'); OT.bancos = data || []; } catch (_) { OT.bancos = []; }
}

/* ============================================================
   CÁLCULOS
   ============================================================ */
const ord = id => OT.ordenes.find(o => o.id === id);
const costosDe = id => OT.costos.filter(c => c.orden_id === id);
const liqDe = id => (OT.liqOrd || []).filter(x => x.orden_id === id);
const subDe = id => (OT.subOrd || []).filter(x => x.orden_id === id);
const totalCostos = id => r2(costosDe(id).reduce((s, c) => s + Number(c.monto || 0), 0) + liqDe(id).reduce((s, x) => s + Number(x.costo_neto || 0), 0) + subDe(id).reduce((s, x) => s + Number(x.monto || 0), 0));
const utilidad = o => r2(Number(o.total || 0) - totalCostos(o.id));
const margen = (ing, ut) => (ing > 0 ? Math.round((ut / ing) * 1000) / 10 : null);
const unidadDe = id => OT.unidades.find(u => u.id === id);
const condDe = id => OT.conductores.find(c => c.id === id);
const nombreCliente = o => o.cliente_nombre || OT.clientes.find(c => c.id === o.cliente_id)?.nombre || 'Sin cliente';
function desde(periodo) {
  const h = new Date();
  if (periodo === 'mes') return TX.ymd(new Date(h.getFullYear(), h.getMonth(), 1));
  if (periodo === '3m') return TX.ymd(new Date(h.getTime() - 90 * 86400000));
  if (periodo === 'anio') return TX.ymd(new Date(h.getFullYear(), 0, 1));
  return '0000-00-00';
}
const fechaClave = o => String(o.entrega_real || o.salida_real || o.fecha_programada || o.created_at || '').slice(0, 10);
const enPeriodo = (o, p) => ACTIVAS.includes(o.estado) || fechaClave(o) >= desde(p);
function buscarTarifa(rutaId, clienteId) {
  const ts = OT.tarifas.filter(t => t.ruta_id === rutaId && t.activa);
  return (clienteId && ts.find(t => t.cliente_id === clienteId)) || ts.find(t => !t.cliente_id) || null;
}
const usadoPor = (id, exceptoOrden, estados) => OT.ordenes.find(x => x.id !== exceptoOrden && estados.includes(x.estado) &&
  [x.unidad_id, x.remolque_id, x.conductor_id, x.ayudante_id].includes(id));
function docsVencidos(docs, soloTipo) {
  return (docs || []).filter(d => (!soloTipo || d.tipo === soloTipo) && TX.estadoDoc(d.vencimiento).clave === 'vencido');
}
const lt = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmtHora = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }); };

/* ============================================================
   KPIs, AVISOS Y VISTAS
   ============================================================ */
function filtradas() {
  const q = TX.quitarTildes(OT.filtro.q);
  return OT.ordenes.filter(o => {
    if (OT.vista === 'lista' && OT.filtro.estado && o.estado !== OT.filtro.estado) return false;
    if (!enPeriodo(o, OT.filtro.periodo)) return false;
    if (q) {
      const u = unidadDe(o.unidad_id);
      if (!TX.quitarTildes([o.numero, nombreCliente(o), o.origen, o.destino, o.carga_descripcion, u?.placa, u?.nombre].join(' ')).includes(q)) return false;
    }
    return true;
  });
}
function renderKpis() {
  const c = e => OT.ordenes.filter(o => o.estado === e).length;
  const ent = OT.ordenes.filter(o => o.estado === 'entregada' && enPeriodo(o, OT.filtro.periodo));
  const ing = r2(ent.reduce((s, o) => s + Number(o.total || 0), 0)), cos = r2(ent.reduce((s, o) => s + totalCostos(o.id), 0)), ut = r2(ing - cos);
  $('ot-kpis').innerHTML = `
    <div class="tx-kpi"><span>🕓 Por asignar</span><b>${c('pendiente')}</b><small>esperan unidad y conductor</small></div>
    <div class="tx-kpi"><span>🧑‍✈️ Asignadas</span><b>${c('asignada')}</b><small>listas para salir</small></div>
    <div class="tx-kpi"><span>🚚 En ruta</span><b>${c('en_ruta')}</b><small>viajando ahora</small></div>
    <div class="tx-kpi"><span>✅ Entregadas</span><b>${ent.length}</b><small>${esc(PERIODOS[OT.filtro.periodo].toLowerCase())}</small></div>
    <div class="tx-kpi ${ut < 0 ? 'alerta' : ''}"><span>💰 Utilidad</span><b>${esc(money(ut))}</b><small>${margen(ing, ut) == null ? 'sin ingresos' : margen(ing, ut) + '% de margen'}</small></div>`;
}
function renderAvisos() {
  const hoy = TX.hoyISO();
  const tarde = OT.ordenes.filter(o => ['pendiente', 'asignada'].includes(o.estado) && o.fecha_programada && o.fecha_programada < hoy);
  $('ot-avisos').innerHTML = tarde.length ? `<div class="tx-aviso-banda"><div style="font-size:22px">⏰</div><div><b>${tarde.length} orden(es) atrasada(s)</b>
    ${tarde.slice(0, 3).map(o => `<div><a href="#" data-ot-abrir="${esc(o.id)}" style="color:inherit;font-weight:700">${esc(o.numero)}</a> · ${esc(nombreCliente(o))} · programada ${esc(fmtFecha(o.fecha_programada))}</div>`).join('')}
    ${tarde.length > 3 ? `<div style="color:var(--text-secondary)">…y ${tarde.length - 3} más</div>` : ''}</div></div>` : '';
}
function tarjeta(o) {
  const u = unidadDe(o.unidad_id), c = condDe(o.conductor_id), hoy = TX.hoyISO();
  const tarde = ['pendiente', 'asignada'].includes(o.estado) && o.fecha_programada && o.fecha_programada < hoy;
  return `<div class="tx-ot" data-ot-abrir="${esc(o.id)}">
    <div class="tx-ot-num">${esc(o.numero)}${o.fecha_programada ? ' · ' + esc(fmtFecha(o.fecha_programada)) : ''}</div>
    <b>${esc(nombreCliente(o))}</b>
    <small>📍 ${esc(o.origen || '—')} → ${esc(o.destino || '—')}</small>
    ${u || c ? `<small>${u ? '🚛 ' + esc(u.nombre) : ''}${u && c ? ' · ' : ''}${c ? '🧑‍✈️ ' + esc(c.nombre) : ''}</small>` : ''}
    <div class="tx-fila-chips"><span class="tx-ot-monto">${esc(money(o.total))}</span>${tarde ? '<span class="tx-chip rojo">⏰ Atrasada</span>' : ''}</div></div>`;
}
function renderTablero() {
  const lista = filtradas();
  const cols = ['pendiente', 'asignada', 'en_ruta', 'entregada'];
  const hay = lista.some(o => o.estado !== 'cancelada');
  if (!OT.ordenes.length) {
    $('ot-vista').innerHTML = `<div class="tx-vacio"><div class="tx-vacio-i">📋</div><b>Aún no tienes órdenes de transporte</b><p>Crea la primera: elige cliente, ruta y carga, y luego asígnale unidad y conductor.</p><button type="button" class="tx-btn tx-btn-primary" data-ot-nueva>＋ Crear la primera orden</button></div>`;
    return;
  }
  $('ot-vista').innerHTML = `<div class="tx-kan">${cols.map(e => {
    const l = lista.filter(o => o.estado === e).sort((a, b) => String(a.fecha_programada || a.created_at).localeCompare(String(b.fecha_programada || b.created_at)) * (e === 'entregada' ? -1 : 1));
    return `<div class="tx-kan-col"><div class="tx-kan-tit">${ESTADOS[e].ico} ${ESTADOS[e].t}<span>${l.length}</span></div>
      ${l.length ? l.map(tarjeta).join('') : '<div class="tx-kan-vacio">Nada por aquí</div>'}</div>`;
  }).join('')}</div>${hay ? '' : '<div class="tx-ayuda" style="margin-top:8px">No hay órdenes con ese filtro.</div>'}`;
}
function renderLista() {
  const lista = filtradas().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!lista.length) { $('ot-vista').innerHTML = `<div class="tx-vacio"><div class="tx-vacio-i">🔎</div><b>No hay órdenes con ese filtro</b><p>Prueba con otro estado o periodo.</p></div>`; return; }
  $('ot-vista').innerHTML = lista.map(o => {
    const e = ESTADOS[o.estado] || ESTADOS.pendiente, ut = utilidad(o);
    return `<div class="tx-fila" data-ot-abrir="${esc(o.id)}"><div class="tx-fila-main"><b>${esc(o.numero)} · ${esc(nombreCliente(o))}</b>
      <small>📍 ${esc(o.origen || '—')} → ${esc(o.destino || '—')} · ${esc(fmtFecha(o.fecha_programada))}</small>
      <div class="tx-fila-chips" style="margin-top:4px"><span class="tx-chip ${e.clase}">${e.ico} ${e.t}</span>${o.estado === 'entregada' ? `<span class="tx-chip ${ut >= 0 ? 'verde' : 'rojo'}">Utilidad ${esc(money(ut))}</span>` : ''}</div></div>
      <div class="tx-fila-der">${esc(money(o.total))}</div></div>`;
  }).join('');
}
function grupo(ents, clave, etiqueta) {
  const m = new Map();
  ents.forEach(o => {
    const k = clave(o); if (!k) return;
    const g = m.get(k) || { n: etiqueta(o, k), v: 0, ing: 0, cos: 0 };
    g.v++; g.ing += Number(o.total || 0); g.cos += totalCostos(o.id); m.set(k, g);
  });
  return [...m.values()].map(g => ({ ...g, ut: r2(g.ing - g.cos) })).sort((a, b) => b.ut - a.ut);
}
function tablaRank(titulo, filas) {
  if (!filas.length) return '';
  return `<div class="tx-sec">${titulo}</div><div class="tx-scroll"><table class="tx-rank"><thead><tr><th>Nombre</th><th class="n">Viajes</th><th class="n">Ingresos</th><th class="n">Costos</th><th class="n">Utilidad</th><th class="n">Margen</th></tr></thead><tbody>
    ${filas.map(g => { const m = margen(g.ing, g.ut); return `<tr><td>${esc(g.n)}</td><td class="n">${g.v}</td><td class="n">${esc(money(g.ing))}</td><td class="n">${esc(money(g.cos))}</td><td class="n ${g.ut >= 0 ? 'tx-pos' : 'tx-neg'}"><b>${esc(money(g.ut))}</b></td><td class="n">${m == null ? '—' : m + '%'}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function renderRentab() {
  const ent = OT.ordenes.filter(o => o.estado === 'entregada' && enPeriodo(o, OT.filtro.periodo));
  if (!ent.length) { $('ot-vista').innerHTML = `<div class="tx-vacio"><div class="tx-vacio-i">📈</div><b>Aún no hay viajes entregados en este periodo</b><p>La rentabilidad se calcula con las órdenes entregadas: lo que cobras menos lo que cuesta cada viaje.</p></div>`; return; }
  const ing = r2(ent.reduce((s, o) => s + Number(o.total || 0), 0)), cos = r2(ent.reduce((s, o) => s + totalCostos(o.id), 0)), ut = r2(ing - cos);
  const sinCostos = ent.filter(o => !costosDe(o.id).length).length;
  const prom = ent.length ? r2(ut / ent.length) : 0;
  $('ot-vista').innerHTML = `
    <div class="tx-kpis"><div class="tx-kpi"><span>Ingresos por fletes</span><b>${esc(money(ing))}</b><small>${ent.length} viaje(s) entregado(s)</small></div>
      <div class="tx-kpi"><span>Costos de los viajes</span><b>${esc(money(cos))}</b><small>combustible, peajes, viáticos…</small></div>
      <div class="tx-kpi ${ut < 0 ? 'alerta' : ''}"><span>Utilidad</span><b>${esc(money(ut))}</b><small>${margen(ing, ut) == null ? '' : margen(ing, ut) + '% de margen'}</small></div>
      <div class="tx-kpi"><span>Utilidad por viaje</span><b>${esc(money(prom))}</b><small>promedio</small></div></div>
    ${sinCostos ? `<div class="tx-aviso-banda"><div style="font-size:22px">⚠️</div><div><b>${sinCostos} viaje(s) sin costos registrados</b>Su utilidad aparece completa porque no se anotó combustible ni otros gastos. Regístralos en la pestaña “Costos” de cada orden para un cálculo real.</div></div>` : ''}
    <div class="tx-ayuda">No incluye depreciación ni salarios fijos. El mantenimiento y las llantas se ven en Mantenimiento y en Reportes.</div>
    ${tablaRank('Por ruta', grupo(ent, o => o.ruta_id || ('libre:' + (o.origen || '') + '>' + (o.destino || '')), (o, k) => OT.rutas.find(r => r.id === o.ruta_id)?.nombre || `${o.origen || '?'} → ${o.destino || '?'}`))}
    ${tablaRank('Por cliente', grupo(ent, o => o.cliente_id || ('n:' + nombreCliente(o)), o => nombreCliente(o)))}
    ${tablaRank('Por unidad', grupo(ent, o => o.unidad_id, o => { const u = unidadDe(o.unidad_id); return u ? u.nombre + (u.placa ? ' · ' + u.placa : '') : 'Unidad eliminada'; }))}
    ${tablaRank('Por conductor', grupo(ent, o => o.conductor_id, o => condDe(o.conductor_id)?.nombre || 'Conductor eliminado'))}`;
}
function renderVista() {
  document.querySelectorAll('[data-ot-vista]').forEach(b => b.classList.toggle('on', b.dataset.otVista === OT.vista));
  $('ot-f-estado').style.display = OT.vista === 'lista' ? '' : 'none';
  if (OT.vista === 'tablero') renderTablero(); else if (OT.vista === 'lista') renderLista(); else renderRentab();
}
function renderTodo() { renderKpis(); renderAvisos(); renderVista(); if (OT.detalleId) renderDetalle(); }

/* ============================================================
   DETALLE
   ============================================================ */
function abrirDetalle(id, tab) {
  if (!ord(id)) return;
  OT.detalleId = id; OT.tab = tab || 'resumen'; renderDetalle(); TX.abrir('ot-modal-detalle');
}
function pasos(o) {
  if (o.estado === 'cancelada') return `<div class="tx-pasos"><div class="tx-paso cancel">⛔ Orden cancelada</div></div>`;
  const orden = ['pendiente', 'asignada', 'en_ruta', 'entregada'], i = orden.indexOf(o.estado);
  return `<div class="tx-pasos">${orden.map((e, k) => `<div class="tx-paso ${k < i ? 'hecho' : k === i ? (e === 'entregada' ? 'hecho' : 'ahora') : ''}">${ESTADOS[e].ico} ${ESTADOS[e].t}</div>`).join('')}</div>`;
}
function acciones(o) {
  const id = esc(o.id), b = (cls, a, txt) => `<button type="button" class="tx-btn ${cls}" data-${a}="${id}">${txt}</button>`;
  const a = [];
  if (o.estado === 'pendiente') a.push(b('tx-btn-primary', 'ot-asignar', '🧑‍✈️ Asignar unidad y conductor'));
  if (o.estado === 'asignada') { a.push(b('tx-btn-primary', 'ot-iniciar', '🚦 Iniciar viaje')); if (!o.subcontratada) a.push(b('', 'ot-asignar', '↺ Reasignar')); }
  if (!o.subcontratada && ['pendiente', 'asignada'].includes(o.estado)) a.push(`<a class="tx-btn" href="transporte-subcontratistas.html?orden=${id}">🤝 Subcontratar a un transportista</a>`);
  if (o.subcontratada) a.push(`<a class="tx-btn" href="transporte-subcontratistas.html">🤝 Subcontratada · ver transportista</a>`);
  if (o.estado === 'en_ruta') a.push(b('tx-btn-ok', 'ot-entregar', '✅ Registrar entrega'));
  if (o.estado !== 'cancelada') a.push(`<a class="tx-btn" href="transporte-fronteras.html?orden=${id}">🛂 Fronteras y documentos</a>`);
  if (['en_ruta', 'entregada'].includes(o.estado)) a.push(`<a class="tx-btn" href="transporte-entregas.html?orden=${id}">📦 Prueba de entrega e incidencias</a>`);
  // Cobrar aquí mismo (pantalla de cobro de Transporte, con el motor de Ventas); si no está disponible, en Facturación.
  if (o.estado === 'entregada') a.push(!o.venta_id && window.TXCobro ? b('tx-btn-primary', 'ot-cobrar', '💳 Cobrar este viaje')
    : `<a class="tx-btn" href="transporte-facturacion.html">${o.venta_id ? '🧾 Cobrado · ver cobranza' : '🧾 Facturar este viaje'}</a>`);
  if (ACTIVAS.includes(o.estado)) a.push(b('tx-btn-borrar', 'ot-cancelar', '✕ Cancelar orden'));
  return a.length ? `<div class="tx-fila-chips" style="margin:6px 0 4px">${a.join('')}</div>` : '';
}
function persona(id, tipo) {
  const e = tipo === 'unidad' ? unidadDe(id) : condDe(id); if (!e) return '<span style="color:var(--text-muted)">—</span>';
  const docs = (tipo === 'unidad' ? OT.docsU : OT.docsC)[id], s = TX.saludDocs(docs), est = (tipo === 'unidad' ? TX.ESTADOS_UNIDAD : TX.ESTADOS_CONDUCTOR)[e.estado];
  return `<b>${tipo === 'unidad' ? '🚛' : '🧑‍✈️'} ${esc(e.nombre)}${e.placa ? ' · ' + esc(e.placa) : ''}</b>
    <div class="tx-fila-chips">${est ? `<span class="tx-chip ${est.clase}">${est.ico} ${esc(est.t)}</span>` : ''}<span class="tx-chip ${s.clase}">${esc(s.texto)}</span></div>`;
}
function renderDetalle() {
  const o = ord(OT.detalleId); if (!o) { TX.cerrar('ot-modal-detalle'); return; }
  const e = ESTADOS[o.estado] || ESTADOS.pendiente, cs = costosDe(o.id);
  const tabs = [['resumen', 'Resumen'], ['despacho', 'Despacho'], ['costos', `Costos (${cs.length})`]];
  $('ot-detalle-cuerpo').innerHTML = `
    <div class="tx-fila-chips" style="justify-content:space-between;align-items:flex-start">
      <div><h3 style="margin:0">📋 ${esc(o.numero)} <span class="tx-chip ${e.clase}">${e.ico} ${e.t}</span></h3><small style="color:var(--text-secondary)">${esc(nombreCliente(o))} · ${esc(o.origen || '—')} → ${esc(o.destino || '—')}</small></div>
      <div class="tx-fila-chips">${o.estado !== 'cancelada' ? `<button type="button" class="tx-btn tx-btn-sm" data-ot-editar="${esc(o.id)}">✏️ Editar</button>` : ''}<button type="button" class="tx-btn tx-btn-sm" onclick="TXcerrar('ot-modal-detalle')">Cerrar</button></div>
    </div>
    ${pasos(o)}${acciones(o)}
    <div class="tx-tabs">${tabs.map(([k, l]) => `<button type="button" class="tx-tab ${OT.tab === k ? 'on' : ''}" data-ot-tab="${k}">${l}</button>`).join('')}</div>
    <div class="tx-panel on">${OT.tab === 'resumen' ? tabResumen(o) : OT.tab === 'despacho' ? tabDespacho(o) : tabCostos(o)}</div>`;
}
function tabResumen(o) {
  const r = OT.rutas.find(x => x.id === o.ruta_id), cos = totalCostos(o.id), ut = utilidad(o), m = margen(Number(o.total), ut);
  const d = (l, v) => v ? `<div class="tx-dato"><span>${l}</span><b>${esc(v)}</b></div>` : '';
  const recs = Array.isArray(o.recargos) ? o.recargos : [];
  return `<div class="tx-datos">
    ${d('Cliente', nombreCliente(o))}${d('Ruta', r?.nombre)}${d('Fecha programada', o.fecha_programada ? fmtFecha(o.fecha_programada) : '')}
    ${d('Carga', o.carga_descripcion)}${d('Peso', o.peso_ton != null ? o.peso_ton + ' t' : '')}${d('Volumen', o.volumen_m3 != null ? o.volumen_m3 + ' m³' : '')}${d('Bultos', o.bultos != null ? String(o.bultos) : '')}
    ${d('Salida real', o.salida_real ? fmtHora(o.salida_real) : '')}${d('Entrega real', o.entrega_real ? fmtHora(o.entrega_real) : '')}${d('Recibió', o.receptor)}
  </div>
  ${o.nota_entrega ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">📝 Entrega: ${esc(o.nota_entrega)}</div>` : ''}
  ${o.motivo_cancelacion ? `<div style="font-size:13px;color:var(--danger);margin-bottom:8px">⛔ Motivo: ${esc(o.motivo_cancelacion)}</div>` : ''}
  ${o.notas ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">📝 ${esc(o.notas)}</div>` : ''}
  <div class="tx-sec">Cobro al cliente</div>
  <div class="tx-doc"><div class="tx-doc-info"><b>Flete: ${esc(money(o.flete))}</b><small>${esc(money(o.tarifa_precio))} por ${COBRO[o.tarifa_tipo] || 'viaje'} × ${esc(Number(o.cantidad_base))}</small></div></div>
  ${recs.map(x => `<div class="tx-doc"><div class="tx-doc-info"><b>+ ${esc(x.nombre || 'Recargo')}</b></div><b>${esc(money(x.monto))}</b></div>`).join('')}
  <div class="tx-kpis" style="margin-top:12px"><div class="tx-kpi"><span>Total a cobrar</span><b>${esc(money(o.total))}</b></div>
    <div class="tx-kpi"><span>Costos del viaje</span><b>${esc(money(cos))}</b><small>${costosDe(o.id).length} registro(s)</small></div>
    <div class="tx-kpi ${ut < 0 ? 'alerta' : ''}"><span>Utilidad del viaje</span><b>${esc(money(ut))}</b><small>${m == null ? '' : m + '% de margen'}</small></div></div>
  <div class="tx-ayuda">El cobro se factura desde Ventas o Créditos; el cobro automático de órdenes llegará en una fase posterior.</div>
  <div class="tx-pie" style="justify-content:space-between">${['pendiente', 'cancelada'].includes(o.estado) ? `<button type="button" class="tx-btn tx-btn-borrar" data-ot-borrar="${esc(o.id)}">🗑 Eliminar orden</button>` : '<span></span>'}</div>`;
}
function tabDespacho(o) {
  const km = o.odometro_salida != null && o.odometro_llegada != null ? Number(o.odometro_llegada) - Number(o.odometro_salida) : null;
  const bloque = (t, id, tipo) => `<div class="tx-dato"><span>${t}</span>${id ? persona(id, tipo) : '<b style="color:var(--text-muted)">Sin asignar</b>'}</div>`;
  return `<div class="tx-datos" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${bloque('Unidad motriz', o.unidad_id, 'unidad')}${bloque('Remolque / furgón', o.remolque_id, 'unidad')}${bloque('Conductor', o.conductor_id, 'conductor')}${bloque('Ayudante', o.ayudante_id, 'conductor')}</div>
    <div class="tx-datos"><div class="tx-dato"><span>Salida</span><b>${esc(fmtHora(o.salida_real))}</b></div><div class="tx-dato"><span>Entrega</span><b>${esc(fmtHora(o.entrega_real))}</b></div>
      <div class="tx-dato"><span>Km salida</span><b>${o.odometro_salida != null ? esc(Number(o.odometro_salida).toLocaleString('es-NI')) : '—'}</b></div><div class="tx-dato"><span>Km llegada</span><b>${o.odometro_llegada != null ? esc(Number(o.odometro_llegada).toLocaleString('es-NI')) : '—'}</b></div>
      ${km != null && km >= 0 ? `<div class="tx-dato"><span>Recorrido</span><b>${esc(km.toLocaleString('es-NI'))} km</b></div>` : ''}</div>
    ${['pendiente', 'asignada'].includes(o.estado) ? `<button type="button" class="tx-btn tx-btn-primary tx-btn-sm" data-ot-asignar="${esc(o.id)}">${o.estado === 'pendiente' ? 'Asignar' : 'Reasignar'}</button>` : ''}`;
}
function tabCostos(o) {
  const cs = costosDe(o.id), tot = totalCostos(o.id), lq = liqDe(o.id), sc = subDe(o.id);
  const puede = o.estado !== 'cancelada';
  const porCat = {}; cs.forEach(c => { porCat[c.categoria] = (porCat[c.categoria] || 0) + Number(c.monto); });
  return `${puede ? `<button type="button" class="tx-btn tx-btn-primary tx-btn-sm" data-ot-costo-nuevo="${esc(o.id)}">＋ Agregar costo</button>` : ''}
    <div style="margin-top:12px">${cs.length ? cs.map(c => { const k = CAT_COSTO[c.categoria] || CAT_COSTO.otro; return `<div class="tx-doc"><div class="tx-doc-info"><b>${k.ico} ${esc(k.t)} · ${esc(money(c.monto))}</b>
        <small>${esc(fmtFecha(c.fecha))}${c.descripcion ? ' · ' + esc(c.descripcion) : ''}${c.gasto_id ? ' · 💸 Registrado en Gastos y Caja' : ''}${c.liquidacion_id ? ' · 🔒 Descontado en liquidación' : ''}</small>${TX.htmlComprobantes('costo', c.id, OT.comp)}</div>
        <div class="tx-doc-acc">${(c.gasto_id || c.liquidacion_id) ? '' : `<button type="button" class="tx-btn tx-btn-sm" data-ot-costo-editar="${esc(c.id)}">✏️</button>`}<button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-ot-costo-borrar="${esc(c.id)}">🗑</button></div></div>`; }).join('')
      : '<div class="tx-vacio" style="padding:24px 12px"><div class="tx-vacio-i">🧾</div><b>Sin costos todavía</b><p>Anota combustible, peajes, viáticos y todo lo que cuesta este viaje para conocer tu utilidad real.</p></div>'}</div>
    ${lq.length ? `<div class="tx-sec">Pago a conductores</div>${lq.map(x => `<div class="tx-doc"><div class="tx-doc-info"><b>👤 Liquidación · ${esc(money(x.costo_neto))}</b><small>Pago ${esc(money(x.bruto))}${Number(x.anticipo) ? ' − anticipo ' + esc(money(x.anticipo)) + ' (ya está arriba)' : ''} · se administra en Liquidación de conductores</small>${x.liquidacion_id ? TX.htmlComprobantes('liquidacion', x.liquidacion_id, OT.comp) : ''}</div></div>`).join('')}` : ''}
    ${sc.length ? `<div class="tx-sec">Transportista externo</div>${sc.map(x => `<div class="tx-doc"><div class="tx-doc-info"><b>🤝 ${esc(x.subcontratista_nombre || 'Subcontratista')} · ${esc(money(x.monto))}</b><small>${x.forma_pago === 'contado' ? 'Pagado de contado desde Caja' : 'A crédito en Cuentas por Pagar'} · se administra en Subcontratistas</small>${TX.htmlComprobantes('subcontratacion', x.id, OT.comp)}</div></div>`).join('')}` : ''}
    ${(cs.length || lq.length || sc.length) ? `<div class="tx-sec">Resumen</div>${Object.entries(porCat).map(([k, v]) => `<div class="tx-doc"><div class="tx-doc-info"><b>${(CAT_COSTO[k] || CAT_COSTO.otro).ico} ${esc((CAT_COSTO[k] || CAT_COSTO.otro).t)}</b></div><b>${esc(money(v))}</b></div>`).join('')}
      ${lq.length ? `<div class="tx-doc"><div class="tx-doc-info"><b>👤 Pago a conductores</b></div><b>${esc(money(r2(lq.reduce((s, x) => s + Number(x.costo_neto || 0), 0))))}</b></div>` : ''}
      ${sc.length ? `<div class="tx-doc"><div class="tx-doc-info"><b>🤝 Transportista externo</b></div><b>${esc(money(r2(sc.reduce((s, x) => s + Number(x.monto || 0), 0))))}</b></div>` : ''}
      <div class="tx-doc"><div class="tx-doc-info"><b>Total costos</b></div><b>${esc(money(tot))}</b></div>` : ''}`;
}

/* ============================================================
   FORMULARIO DE ORDEN
   ============================================================ */
function llenarSelects() {
  $('ot-f-estado').innerHTML = '<option value="">Todos los estados</option>' + Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}">${v.ico} ${v.t}</option>`).join('');
  $('ot-f-periodo').innerHTML = Object.entries(PERIODOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('ot-f-periodo').value = OT.filtro.periodo;
}
function recargosDOM() {
  return [...document.querySelectorAll('#of-recargos .tx-rec')].map(r => ({ nombre: r.querySelector('.rn').value.trim(), monto: num(r.querySelector('.rm').value) || 0 }));
}
function pintarRecargos(arr) {
  $('of-recargos').innerHTML = arr.map((x, i) => `<div class="tx-rec"><input class="tx-in rn" placeholder="Concepto" maxlength="60" value="${esc(x.nombre)}" style="flex:2"/><input class="tx-in rm" placeholder="Monto" inputmode="decimal" value="${esc(x.monto || '')}" style="flex:1"/><button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-ot-rec-del="${i}" aria-label="Quitar">✕</button></div>`).join('');
}
function recalcular() {
  const precio = num($('of-precio').value) || 0, cant = num($('of-cant').value) || 0;
  const flete = r2(precio * cant), rec = r2(recargosDOM().reduce((s, x) => s + x.monto, 0));
  $('of-flete').textContent = money(flete); $('of-total').textContent = money(flete + rec);
  return { flete, total: r2(flete + rec) };
}
function cantidadAuto() {
  const t = $('of-tipo').value; $('of-cant-u').textContent = COBRO[t];
  if (OT.cantManual) return;
  if (t === 'viaje') $('of-cant').value = 1;
  else if (t === 'km') $('of-cant').value = OT.rutas.find(r => r.id === $('of-ruta').value)?.distancia_km ?? '';
  else $('of-cant').value = $('of-ton').value || '';
}
function aplicarTarifa(forzar) {
  const rid = $('of-ruta').value, cid = $('of-cliente').value, r = OT.rutas.find(x => x.id === rid);
  const info = $('of-tarifa-info');
  if (!r) { info.textContent = 'Sin ruta: escribe el precio a mano.'; return; }
  if (forzar) { if (!$('of-origen').value.trim() || $('of-origen').dataset.auto === '1') { $('of-origen').value = r.origen; $('of-origen').dataset.auto = '1'; }
    if (!$('of-destino').value.trim() || $('of-destino').dataset.auto === '1') { $('of-destino').value = r.destino; $('of-destino').dataset.auto = '1'; } }
  const t = buscarTarifa(rid, cid);
  if (t) {
    if (forzar) { $('of-tipo').value = t.tipo_cobro; $('of-precio').value = t.precio; OT.cantManual = false; }
    info.textContent = `Tarifa ${t.cliente_id ? 'de este cliente' : 'general'} de la ruta: ${money(t.precio)} por ${COBRO[t.tipo_cobro]}. Puedes cambiarla.`;
  } else info.textContent = 'Esta ruta no tiene tarifa: escribe el precio a mano (o créala en Rutas y tarifas).';
  cantidadAuto(); recalcular();
}
function abrirForm(id) {
  const o = id ? ord(id) : null; OT.editando = o; OT.cantManual = !!o;
  $('ot-form-titulo').textContent = o ? `Editar ${o.numero}` : 'Nueva orden de transporte';
  $('of-cliente').innerHTML = '<option value="">— Escribir un nombre —</option>' + OT.clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('');
  if (window.N360SelectBuscable) N360SelectBuscable.mejorar($('of-cliente'), { placeholder: 'Busca el cliente… (opcional)', incluirVacio: true, copiarClase: true, anchoCompleto: true });
  $('of-ruta').innerHTML = '<option value="">Ruta libre (sin ruta guardada)</option>' + OT.rutas.filter(r => r.activa || r.id === o?.ruta_id).map(r => `<option value="${esc(r.id)}">${esc(r.nombre)}</option>`).join('');
  const v = (i, x) => { $(i).value = x == null ? '' : x; };
  $('of-cliente').value = o?.cliente_id || ''; v('of-cli-nombre', o?.cliente_nombre); $('of-ruta').value = o?.ruta_id || '';
  v('of-fecha', o?.fecha_programada || TX.hoyISO()); v('of-origen', o?.origen); v('of-destino', o?.destino);
  $('of-origen').dataset.auto = ''; $('of-destino').dataset.auto = '';
  v('of-carga', o?.carga_descripcion); v('of-ton', o?.peso_ton); v('of-m3', o?.volumen_m3); v('of-bultos', o?.bultos);
  $('of-tipo').value = o?.tarifa_tipo || 'viaje'; v('of-precio', o ? o.tarifa_precio : ''); v('of-cant', o ? o.cantidad_base : 1); v('of-notas', o?.notas);
  $('of-cli-nombre-wrap').style.display = $('of-cliente').value ? 'none' : '';
  pintarRecargos(Array.isArray(o?.recargos) ? o.recargos : []);
  $('of-cant-u').textContent = COBRO[$('of-tipo').value]; $('of-tarifa-info').textContent = o ? '' : 'Elige una ruta para que el precio se llene solo.';
  $('of-error').textContent = ''; recalcular(); TX.abrir('ot-modal-form');
}
async function siguienteNumero() {
  let max = 0;
  try {
    const { data } = await sb.from('transporte_ordenes').select('numero').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }).limit(500);
    (data || []).forEach(x => { const m = String(x.numero).match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  } catch (_) { OT.ordenes.forEach(x => { const m = String(x.numero).match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }); }
  return 'OT-' + String(max + 1).padStart(4, '0');
}
async function guardarOrden() {
  const err = m => { $('of-error').textContent = m; };
  const cid = $('of-cliente').value || null, cli = cid ? OT.clientes.find(c => c.id === cid) : null;
  const cnom = cli ? cli.nombre : $('of-cli-nombre').value.trim();
  if (!cnom) return err('Elige un cliente o escribe su nombre.');
  const origen = $('of-origen').value.trim(), destino = $('of-destino').value.trim();
  if (!origen || !destino) return err('Indica el origen y el destino.');
  const precio = num($('of-precio').value), cant = num($('of-cant').value);
  if (precio == null || precio <= 0) return err('Escribe el precio del flete (mayor a 0).');
  if (cant == null || cant <= 0) return err(`Indica la cantidad (${COBRO[$('of-tipo').value]}s) para calcular el flete.`);
  const recs = recargosDOM().filter(x => x.nombre || x.monto);
  if (recs.some(x => !x.nombre || x.monto <= 0)) return err('Cada recargo necesita concepto y un monto mayor a 0.');
  const { flete, total } = recalcular();
  const p = {
    cliente_id: cid, cliente_nombre: cnom, ruta_id: $('of-ruta').value || null, origen, destino,
    fecha_programada: $('of-fecha').value || null, carga_descripcion: $('of-carga').value.trim() || null,
    peso_ton: num($('of-ton').value), volumen_m3: num($('of-m3').value), bultos: num($('of-bultos').value),
    tarifa_tipo: $('of-tipo').value, tarifa_precio: precio, cantidad_base: cant, flete, recargos: recs, total, notas: $('of-notas').value.trim() || null,
  };
  const btn = $('of-guardar'); btn.disabled = true;
  try {
    if (OT.editando) {
      const { error } = await sb.from('transporte_ordenes').update(p).eq('id', OT.editando.id).eq('auth_user_id', TX.userId); if (error) throw error;
      Object.assign(OT.editando, p);
    } else {
      const numero = await siguienteNumero();
      const { data, error } = await sb.from('transporte_ordenes').insert({ ...p, numero, estado: 'pendiente', auth_user_id: TX.userId }).select().single();
      if (error) throw error;
      OT.ordenes.unshift(data); OT.detalleId = data.id; OT.tab = 'resumen';
    }
    TX.cerrar('ot-modal-form'); TX.toast('Orden guardada'); renderTodo();
    if (OT.detalleId) TX.abrir('ot-modal-detalle');
  } catch (e) { console.error(e); err('No se pudo guardar la orden. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}
async function eliminarOrden(id) {
  const o = ord(id); if (!o) return;
  if (costosDe(id).some(c => c.gasto_id)) { TX.toast('Esta orden tiene costos pagados desde Caja. Elimínalos primero (devuelve el dinero).', 'error'); return; }
  if (!await TX.confirmar('¿Eliminar la orden?', `Se borrará ${o.numero} y sus costos. No se puede deshacer.`, 'Eliminar', true)) return;
  const { error } = await sb.from('transporte_ordenes').delete().eq('id', id).eq('auth_user_id', TX.userId);
  if (error) { TX.toast('No se pudo eliminar', 'error'); return; }
  TX.toast('Orden eliminada'); OT.detalleId = null; TX.cerrar('ot-modal-detalle');
  await Promise.all([cargarOrdenes(), cargarCostos()]); renderTodo();
}

/* ============================================================
   CICLO: ASIGNAR → SALIR → ENTREGAR / CANCELAR
   ============================================================ */
async function actualizarOrden(o, patch) {
  const { error } = await sb.from('transporte_ordenes').update(patch).eq('id', o.id).eq('auth_user_id', TX.userId);
  if (error) throw error;
  Object.assign(o, patch);
}
function opcionesPersona(lista, actual, extra) {
  const ops = lista.filter(x => x.estado === 'disponible' || x.id === actual);
  return (extra ? '<option value="">— Ninguno —</option>' : (ops.length ? '<option value="">Selecciona…</option>' : '<option value="">No hay disponibles</option>'))
    + ops.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}${x.placa ? ' · ' + esc(x.placa) : ''}</option>`).join('');
}
function abrirAsignar(id) {
  const o = ord(id); if (!o) return;
  $('od-guardar').dataset.id = id; $('od-error').textContent = ''; $('od-aviso').innerHTML = '';
  $('od-unidad').innerHTML = opcionesPersona(OT.unidades.filter(u => u.rol === 'motriz'), o.unidad_id, false);
  $('od-remolque').innerHTML = opcionesPersona(OT.unidades.filter(u => u.rol === 'arrastre'), o.remolque_id, true);
  $('od-conductor').innerHTML = opcionesPersona(OT.conductores.filter(c => c.rol === 'conductor'), o.conductor_id, false);
  $('od-ayudante').innerHTML = opcionesPersona(OT.conductores.filter(c => c.rol === 'ayudante'), o.ayudante_id, true);
  $('od-unidad').value = o.unidad_id || ''; $('od-remolque').value = o.remolque_id || ''; $('od-conductor').value = o.conductor_id || ''; $('od-ayudante').value = o.ayudante_id || '';
  TX.abrir('ot-modal-desp');
}
async function guardarAsignacion() {
  const o = ord($('od-guardar').dataset.id); if (!o) return;
  const err = m => { $('od-error').textContent = m; };
  const u = $('od-unidad').value, rm = $('od-remolque').value || null, c = $('od-conductor').value, a = $('od-ayudante').value || null;
  if (!u) return err('Elige la unidad motriz.');
  if (!c) return err('Elige el conductor.');
  const avisos = [];
  [[u, 'unidad'], [rm, 'unidad'], [c, 'conductor'], [a, 'conductor']].forEach(([id, tipo]) => {
    if (!id) return;
    const ent = tipo === 'unidad' ? unidadDe(id) : condDe(id);
    const v = tipo === 'unidad' ? docsVencidos(OT.docsU[id]) : docsVencidos(OT.docsC[id]);
    if (v.length) avisos.push(`${ent.nombre}: ${v.map(d => TX.etiquetaDoc(tipo, d.tipo).t).join(', ')} vencido(s)`);
    const otra = usadoPor(id, o.id, ['asignada', 'en_ruta']);
    if (otra) avisos.push(`${ent.nombre} ya está en la orden ${otra.numero}`);
  });
  if (avisos.length && !await TX.confirmar('Revisa antes de asignar', avisos.join(' · ') + '. ¿Asignar de todos modos?', 'Asignar igual')) return;
  const btn = $('od-guardar'); btn.disabled = true;
  try {
    await actualizarOrden(o, { unidad_id: u, remolque_id: rm, conductor_id: c, ayudante_id: a, estado: 'asignada' });
    TX.cerrar('ot-modal-desp'); TX.toast('Orden asignada'); renderTodo();
  } catch (e) { console.error(e); err('No se pudo asignar.'); }
  finally { btn.disabled = false; }
}
function abrirSalida(id) {
  const o = ord(id); if (!o) return;
  const faltan = [[o.unidad_id, 'unidad'], [o.remolque_id, 'unidad'], [o.conductor_id, 'conductor'], [o.ayudante_id, 'conductor']]
    .filter(([i]) => i).map(([i, t]) => (t === 'unidad' ? unidadDe(i) : condDe(i))).filter(e => e && e.estado !== 'disponible');
  if (faltan.length) { TX.toast(`${faltan[0].nombre} no está disponible (${(TX.ESTADOS_UNIDAD[faltan[0].estado] || TX.ESTADOS_CONDUCTOR[faltan[0].estado] || {}).t || faltan[0].estado}). Reasigna la orden o cambia su estado.`, 'error'); return; }
  $('os-guardar').dataset.id = id; $('os-fecha').value = lt(new Date()); $('os-odo').value = unidadDe(o.unidad_id)?.odometro_km ?? ''; $('os-error').textContent = '';
  TX.abrir('ot-modal-salida');
}
async function marcarEntidades(o, nuevo, nota) {
  for (const [id, tipo] of [[o.unidad_id, 'unidad'], [o.remolque_id, 'unidad'], [o.conductor_id, 'conductor'], [o.ayudante_id, 'conductor']]) {
    if (!id) continue;
    const ent = tipo === 'unidad' ? unidadDe(id) : condDe(id); if (!ent) continue;
    if (nuevo === 'disponible') {
      if (ent.estado !== 'en_viaje' || usadoPor(id, o.id, ['en_ruta'])) continue;
    } else if (ent.estado !== 'disponible') continue;
    try { await TX.cambiarEstado(tipo, ent, nuevo, nota); } catch (e) { console.warn('cambiarEstado', e); }
  }
}
async function guardarSalida() {
  const o = ord($('os-guardar').dataset.id); if (!o) return;
  const f = $('os-fecha').value; if (!f) { $('os-error').textContent = 'Indica la fecha y hora de salida.'; return; }
  const btn = $('os-guardar'); btn.disabled = true;
  try {
    await actualizarOrden(o, { estado: 'en_ruta', salida_real: new Date(f).toISOString(), odometro_salida: num($('os-odo').value) });
    await marcarEntidades(o, 'en_viaje', `Orden ${o.numero}`);
    TX.cerrar('ot-modal-salida'); TX.toast('¡Buen viaje! La orden está en ruta'); renderTodo();
  } catch (e) { console.error(e); $('os-error').textContent = 'No se pudo iniciar el viaje.'; }
  finally { btn.disabled = false; }
}
function abrirEntrega(id) {
  const o = ord(id); if (!o) return;
  $('oe-guardar').dataset.id = id; $('oe-fecha').value = lt(new Date()); $('oe-receptor').value = ''; $('oe-odo').value = ''; $('oe-nota').value = ''; $('oe-error').textContent = '';
  TX.abrir('ot-modal-entrega');
}
async function guardarEntrega() {
  const o = ord($('oe-guardar').dataset.id); if (!o) return;
  const f = $('oe-fecha').value; if (!f) { $('oe-error').textContent = 'Indica la fecha y hora de entrega.'; return; }
  const odo = num($('oe-odo').value);
  if (odo != null && o.odometro_salida != null && odo < Number(o.odometro_salida)) { $('oe-error').textContent = 'El kilometraje de llegada no puede ser menor al de salida.'; return; }
  const btn = $('oe-guardar'); btn.disabled = true;
  try {
    await actualizarOrden(o, { estado: 'entregada', entrega_real: new Date(f).toISOString(), receptor: $('oe-receptor').value.trim() || null, odometro_llegada: odo, nota_entrega: $('oe-nota').value.trim() || null });
    const u = unidadDe(o.unidad_id);
    if (odo != null && u && (u.odometro_km == null || odo > Number(u.odometro_km))) {
      const { error } = await sb.from('transporte_unidades').update({ odometro_km: odo }).eq('id', u.id).eq('auth_user_id', TX.userId);
      if (!error) u.odometro_km = odo;
    }
    await marcarEntidades(o, 'disponible', `Entregó ${o.numero}`);
    TX.cerrar('ot-modal-entrega'); TX.toast('Entrega registrada'); renderTodo();
  } catch (e) { console.error(e); $('oe-error').textContent = 'No se pudo registrar la entrega.'; }
  finally { btn.disabled = false; }
}
function abrirCancelar(id) { $('oc-guardar').dataset.id = id; $('oc-motivo').value = ''; $('oc-error').textContent = ''; TX.abrir('ot-modal-cancel'); }
async function guardarCancelacion() {
  const o = ord($('oc-guardar').dataset.id); if (!o) return;
  const m = $('oc-motivo').value.trim(); if (!m) { $('oc-error').textContent = 'Escribe el motivo.'; return; }
  const estabaEnRuta = o.estado === 'en_ruta';
  const btn = $('oc-guardar'); btn.disabled = true;
  try {
    await actualizarOrden(o, { estado: 'cancelada', motivo_cancelacion: m });
    if (estabaEnRuta) await marcarEntidades(o, 'disponible', `Cancelada ${o.numero}`);
    TX.cerrar('ot-modal-cancel'); TX.toast('Orden cancelada'); renderTodo();
  } catch (e) { console.error(e); $('oc-error').textContent = 'No se pudo cancelar.'; }
  finally { btn.disabled = false; }
}

/* ============================================================
   COSTOS DEL VIAJE (+ Gastos y Caja opcional)
   ============================================================ */
function abrirCosto(ordenId, costoId) {
  const c = costoId ? OT.costos.find(x => x.id === costoId) : null;
  OT.costoEdit = { ordenId, c };
  $('oc2-titulo').textContent = c ? 'Editar costo' : 'Nuevo costo del viaje';
  $('oc2-cat').innerHTML = Object.entries(CAT_COSTO).map(([k, v]) => `<option value="${k}">${v.ico} ${esc(v.t)}</option>`).join('');
  $('oc2-cat').value = c?.categoria || 'combustible'; $('oc2-monto').value = c ? c.monto : ''; $('oc2-fecha').value = c?.fecha || TX.hoyISO(); $('oc2-desc').value = c?.descripcion || '';
  $('oc2-metodo').innerHTML = OT.metodos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
  const puedeCaja = OT.metodos.length > 0 && !!window.CajaAPI;
  $('oc2-caja-wrap').style.display = puedeCaja ? '' : 'none';
  $('oc2-caja').checked = puedeCaja && !c; $('oc2-metodo-wrap').style.display = $('oc2-caja').checked ? '' : 'none';
  cambiaMetodo(); $('oc2-error').textContent = '';
  TX.abrir('ot-modal-costo');
}
function cambiaMetodo() {
  const n = ($('oc2-metodo').selectedOptions[0]?.textContent || '').toLowerCase();
  const nec = $('oc2-caja').checked && (n.includes('tarjeta') || n.includes('transferencia')) && OT.bancos.length > 0;
  $('oc2-banco-wrap').style.display = nec ? '' : 'none';
  if (nec) $('oc2-banco').innerHTML = '<option value="">Selecciona un banco…</option>' + OT.bancos.map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('');
  else $('oc2-banco').value = '';
}
async function ultimoMovimientoId() {
  try { const { data } = await sb.from('movimientos_financieros').select('id').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }).limit(1).maybeSingle(); return data?.id || null; } catch (_) { return null; }
}
async function anularGasto(gastoId, motivo) {
  await sb.from('movimientos_financieros').update({ estado: 'anulado', anulado_en: new Date().toISOString(), anulado_motivo: motivo })
    .eq('referencia_tipo', 'gasto').eq('referencia_id', gastoId).eq('auth_user_id', TX.userId).eq('estado', 'completado');
  await sb.from('gastos').update({ estado: 'cancelado', cancelado_en: new Date().toISOString(), cancelado_motivo: motivo }).eq('id', gastoId).eq('auth_user_id', TX.userId);
}
async function guardarCosto() {
  const { ordenId, c } = OT.costoEdit, o = ord(ordenId); if (!o) return;
  const err = m => { $('oc2-error').textContent = m; };
  const monto = num($('oc2-monto').value);
  if (monto == null || monto <= 0) return err('Escribe un monto mayor a 0.');
  const cat = $('oc2-cat').value, k = CAT_COSTO[cat], desc = $('oc2-desc').value.trim(), fecha = $('oc2-fecha').value || TX.hoyISO();
  const caja = $('oc2-caja-wrap').style.display !== 'none' && $('oc2-caja').checked;
  let metodo = null, bancoId = null;
  if (caja) {
    metodo = OT.metodos.find(m => m.id === $('oc2-metodo').value); if (!metodo) return err('Elige el método de pago.');
    if ($('oc2-banco-wrap').style.display !== 'none') { bancoId = $('oc2-banco').value; if (!bancoId) return err('Selecciona de qué banco sale el dinero.'); }
  }
  const btn = $('oc2-guardar'); btn.disabled = true;
  let gastoId = null, movId = null;
  try {
    if (caja) {
      const concepto = `Transporte ${o.numero} · ${k.t}${desc ? ': ' + desc : ''}`;
      const obs = `Orden de transporte ${o.numero} (${nombreCliente(o)})`;
      const { data: g, error: eg } = await sb.from('gastos').insert({
        auth_user_id: TX.userId, tipo: 'inmediato', concepto, categoria: k.gasto, monto, fecha, metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre,
        impuesto: 0, observaciones: obs, estado: 'activo',
      }).select().single();
      if (eg) throw eg;
      gastoId = g.id;
      const mov = await window.CajaAPI.registrarMovimiento({
        auth_user_id: TX.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO', concepto: `${k.gasto}: ${concepto}`, monto,
        metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre, origen_caja: null, banco_id: bancoId || null,
        referencia_tipo: 'gasto', referencia_id: g.id, observaciones: obs, fecha,
      });
      if (!mov.ok) { await sb.from('gastos').delete().eq('id', g.id).eq('auth_user_id', TX.userId); gastoId = null; throw new Error('Caja: ' + mov.error); }
      movId = await ultimoMovimientoId();
      if (movId) await sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', g.id).eq('auth_user_id', TX.userId);
    }
    const p = { categoria: cat, descripcion: desc || null, monto, fecha };
    if (c) { const { error } = await sb.from('transporte_costos').update(p).eq('id', c.id).eq('auth_user_id', TX.userId); if (error) throw error; if (gastoId) await sb.from('transporte_costos').update({ gasto_id: gastoId, movimiento_caja_id: movId }).eq('id', c.id); }
    else { const { error } = await sb.from('transporte_costos').insert({ ...p, orden_id: ordenId, auth_user_id: TX.userId, gasto_id: gastoId, movimiento_caja_id: movId }); if (error) throw error; }
    TX.cerrar('ot-modal-costo'); TX.toast(caja ? 'Costo guardado y descontado de Caja' : 'Costo guardado');
    await cargarCostos(); OT.tab = 'costos'; renderTodo();
  } catch (e) {
    console.error(e);
    if (gastoId) { try { await anularGasto(gastoId, 'No se pudo guardar el costo del viaje'); } catch (_) {} }
    err('No se pudo guardar el costo. No se registró nada en Caja.');
  } finally { btn.disabled = false; }
}
async function borrarCosto(id) {
  const c = OT.costos.find(x => x.id === id); if (!c) return;
  if (c.liquidacion_id) { TX.toast('Este anticipo ya se descontó en una liquidación. Anula la liquidación primero.', 'error'); return; }
  const txt = c.gasto_id ? 'Se cancelará también el gasto y el dinero vuelve a Caja.' : 'Se quitará de los costos del viaje.';
  if (!await TX.confirmar('¿Eliminar este costo?', txt, 'Eliminar', true)) return;
  try {
    if (c.gasto_id) await anularGasto(c.gasto_id, 'Costo de viaje eliminado');
    const { error } = await sb.from('transporte_costos').delete().eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error;
    await TX.borrarComprobantesDe('costo', id);
    TX.toast('Costo eliminado'); await cargarCostos(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo eliminar el costo', 'error'); }
}

/* ============================================================
   EVENTOS
   ============================================================ */
function enlazar() {
  TX.alCambiarComprobantes = async () => { OT.comp = await TX.cargarComprobantes(); renderTodo(); };
  $('ot-buscar').addEventListener('input', e => { OT.filtro.q = e.target.value; renderVista(); });
  $('ot-f-estado').addEventListener('change', e => { OT.filtro.estado = e.target.value; renderVista(); });
  $('ot-f-periodo').addEventListener('change', e => { OT.filtro.periodo = e.target.value; renderKpis(); renderVista(); });
  $('of-cliente').addEventListener('change', () => { $('of-cli-nombre-wrap').style.display = $('of-cliente').value ? 'none' : ''; aplicarTarifa(true); });
  $('of-ruta').addEventListener('change', () => { OT.cantManual = false; aplicarTarifa(true); });
  $('of-origen').addEventListener('input', e => { e.target.dataset.auto = ''; });
  $('of-destino').addEventListener('input', e => { e.target.dataset.auto = ''; });
  $('of-tipo').addEventListener('change', () => { OT.cantManual = false; cantidadAuto(); recalcular(); });
  $('of-ton').addEventListener('input', () => { cantidadAuto(); recalcular(); });
  $('of-cant').addEventListener('input', () => { OT.cantManual = true; recalcular(); });
  $('of-precio').addEventListener('input', recalcular);
  $('of-recargos').addEventListener('input', recalcular);
  $('of-add-recargo').addEventListener('click', () => { const a = recargosDOM(); a.push({ nombre: '', monto: '' }); pintarRecargos(a); });
  $('of-guardar').addEventListener('click', guardarOrden);
  $('od-guardar').addEventListener('click', guardarAsignacion);
  $('od-unidad').addEventListener('change', () => {
    const c = OT.conductores.find(x => x.unidad_asignada_id === $('od-unidad').value && x.estado === 'disponible' && x.rol === 'conductor');
    if (c && !$('od-conductor').value) $('od-conductor').value = c.id;
    if (c && c.remolque_asignado_id && !$('od-remolque').value) $('od-remolque').value = c.remolque_asignado_id;
  });
  $('od-conductor').addEventListener('change', () => {
    const c = OT.conductores.find(x => x.id === $('od-conductor').value);
    if (c && c.remolque_asignado_id && !$('od-remolque').value && OT.unidades.some(u => u.id === c.remolque_asignado_id)) $('od-remolque').value = c.remolque_asignado_id;
  });
  $('os-guardar').addEventListener('click', guardarSalida);
  $('oe-guardar').addEventListener('click', guardarEntrega);
  $('oc-guardar').addEventListener('click', guardarCancelacion);
  $('oc2-guardar').addEventListener('click', guardarCosto);
  $('oc2-caja').addEventListener('change', () => { $('oc2-metodo-wrap').style.display = $('oc2-caja').checked ? '' : 'none'; cambiaMetodo(); });
  $('oc2-metodo').addEventListener('change', cambiaMetodo);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ot-abrir],[data-ot-nueva],[data-ot-editar],[data-ot-vista],[data-ot-tab],[data-ot-asignar],[data-ot-iniciar],[data-ot-entregar],[data-ot-cancelar],[data-ot-borrar],[data-ot-costo-nuevo],[data-ot-costo-editar],[data-ot-costo-borrar],[data-ot-rec-del],[data-ot-cobrar]');
    if (!t) return; const d = t.dataset;
    if (d.otAbrir) { e.preventDefault(); abrirDetalle(d.otAbrir); }
    else if ('otNueva' in d) { OT.detalleId = null; abrirForm(null); }
    else if (d.otEditar) abrirForm(d.otEditar);
    else if (d.otVista) { OT.vista = d.otVista; renderVista(); }
    else if (d.otTab) { OT.tab = d.otTab; renderDetalle(); }
    else if (d.otAsignar) abrirAsignar(d.otAsignar);
    else if (d.otIniciar) abrirSalida(d.otIniciar);
    else if (d.otEntregar) abrirEntrega(d.otEntregar);
    else if (d.otCancelar) abrirCancelar(d.otCancelar);
    else if (d.otBorrar) eliminarOrden(d.otBorrar);
    else if (d.otCostoNuevo) abrirCosto(d.otCostoNuevo, null);
    else if (d.otCostoEditar) abrirCosto(OT.detalleId, d.otCostoEditar);
    else if (d.otCostoBorrar) borrarCosto(d.otCostoBorrar);
    else if (d.otCobrar) TXCobro.abrir(d.otCobrar, { alCerrar: async cobrado => { if (cobrado) { await cargarTodo(); renderTodo(); } } });
    else if (d.otRecDel != null) { const a = recargosDOM(); a.splice(Number(d.otRecDel), 1); pintarRecargos(a); recalcular(); }
  });
}

window.OT = OT;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => {
    llenarSelects(); enlazar();
    await cargarTodo(); renderTodo();
    const p = new URLSearchParams(location.search).get('orden');
    if (p && ord(p)) abrirDetalle(p);
  });
});
