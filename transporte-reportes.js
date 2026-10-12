/* ============================================================
   TRANSPORTE-REPORTES.JS — NEGOCIO360 (Transporte · Fase 12)
   Indicadores de la operación a partir de lo que ya está registrado:
   órdenes entregadas, costos del viaje (costos, liquidaciones y fletes
   subcontratados), mantenimiento, incidencias y tiempos.
   Solo lee datos: no modifica nada. Se puede exportar a CSV e imprimir.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const nfmt = (n, d = 0) => Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: d, maximumFractionDigits: d });
const TOLERANCIA = 1.10; // un viaje cumple su tiempo si tarda hasta 10 % más que el estimado de la ruta

const RP = { vista: 'resumen', periodo: 'mes', desde: '', hasta: '', ordenes: [], costos: [], liqOrd: [], subOrd: [], rutas: [], unidades: [], conductores: [], mant: [], incs: [], tabla: null };
const TIPOS_INC = { retraso: 'Retraso', dano_carga: 'Daño a la carga', faltante: 'Faltante de mercancía', accidente: 'Accidente', averia: 'Avería mecánica', robo: 'Robo o pérdida', multa: 'Multa o retención', reclamo: 'Reclamo del cliente', otro: 'Otro' };

async function cargarTodo() {
  const q = t => TX.paginar(() => sb.from(t).select('*').eq('auth_user_id', TX.userId));
  const [ordenes, costos, rutas, unidades, conductores, mant, incs] = await Promise.all([
    q('transporte_ordenes'), q('transporte_costos'), q('transporte_rutas'), q('transporte_unidades'), q('transporte_conductores'), q('transporte_mant_ordenes'), q('transporte_incidencias'),
  ]);
  Object.assign(RP, { ordenes, costos, rutas, unidades, conductores, mant, incs });
  try { RP.liqOrd = await q('transporte_liquidacion_ordenes'); } catch (_) { RP.liqOrd = []; }
  try { RP.subOrd = await TX.paginar(() => sb.from('transporte_subcontrataciones').select('*').eq('auth_user_id', TX.userId).eq('estado', 'activa')); } catch (_) { RP.subOrd = []; }
}

/* ---------------- Periodo ---------------- */
function rango() {
  const h = new Date(), y = h.getFullYear(), m = h.getMonth(), p = RP.periodo;
  if (p === 'mes') return [TX.ymd(new Date(y, m, 1)), TX.ymd(new Date(y, m + 1, 0))];
  if (p === 'mes_ant') return [TX.ymd(new Date(y, m - 1, 1)), TX.ymd(new Date(y, m, 0))];
  if (p === '3m') return [TX.ymd(new Date(h.getTime() - 90 * 86400000)), TX.ymd(h)];
  if (p === 'anio') return [`${y}-01-01`, `${y}-12-31`];
  if (p === 'rango') return [RP.desde || '0000-01-01', RP.hasta || '9999-12-31'];
  return ['0000-01-01', '9999-12-31'];
}
const enRango = (f, [a, b]) => { const d = String(f || '').slice(0, 10); return d >= a && d <= b; };
const fechaOrden = o => String(o.entrega_real || o.salida_real || o.fecha_programada || o.created_at || '').slice(0, 10);

/* ---------------- Cálculos ---------------- */
const costoOrden = id => r2(RP.costos.filter(c => c.orden_id === id).reduce((s, c) => s + Number(c.monto || 0), 0)
  + RP.liqOrd.filter(x => x.orden_id === id).reduce((s, x) => s + Number(x.costo_neto || 0), 0)
  + RP.subOrd.filter(x => x.orden_id === id).reduce((s, x) => s + Number(x.monto || 0), 0));
const kmOrden = o => (o.odometro_salida != null && o.odometro_llegada != null && Number(o.odometro_llegada) >= Number(o.odometro_salida)) ? Number(o.odometro_llegada) - Number(o.odometro_salida) : 0;
function horasOrden(o) { if (!o.salida_real || !o.entrega_real) return null; const h = (new Date(o.entrega_real) - new Date(o.salida_real)) / 3600000; return isFinite(h) && h >= 0 ? h : null; }
function datos() {
  const r = rango();
  const ents = RP.ordenes.filter(o => o.estado === 'entregada' && enRango(fechaOrden(o), r));
  const mant = RP.mant.filter(m => m.estado === 'cerrada' && enRango(m.fecha, r));
  const incs = RP.incs.filter(i => enRango(i.fecha, r));
  const ing = r2(ents.reduce((s, o) => s + Number(o.total || 0), 0)), cos = r2(ents.reduce((s, o) => s + costoOrden(o.id), 0));
  const km = ents.reduce((s, o) => s + kmOrden(o), 0), kmCon = ents.filter(o => kmOrden(o) > 0);
  const conTiempo = ents.filter(o => horasOrden(o) != null && Number(RP.rutas.find(x => x.id === o.ruta_id)?.tiempo_horas) > 0);
  const cumplen = conTiempo.filter(o => horasOrden(o) <= Number(RP.rutas.find(x => x.id === o.ruta_id).tiempo_horas) * TOLERANCIA);
  const hs = ents.map(horasOrden).filter(h => h != null);
  return { r, ents, mant, incs, ing, cos, ut: r2(ing - cos), km, kmCon, conTiempo, cumplen, horasProm: hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null, mantTotal: r2(mant.reduce((s, m) => s + Number(m.total || 0), 0)) };
}

/* ---------------- Pintado ---------------- */
function renderKpis(d) {
  const mg = d.ing > 0 ? Math.round(d.ut / d.ing * 1000) / 10 : null, cumpl = d.conTiempo.length ? Math.round(d.cumplen.length / d.conTiempo.length * 100) : null;
  $('rp-kpis').innerHTML = `
    <div class="tx-kpi"><span>Viajes entregados</span><b>${d.ents.length}</b><small>en el periodo</small></div>
    <div class="tx-kpi"><span>Ingresos por fletes</span><b>${esc(money(d.ing))}</b><small>${d.ents.length ? esc(money(d.ing / d.ents.length)) + ' por viaje' : '—'}</small></div>
    <div class="tx-kpi"><span>Costos de los viajes</span><b>${esc(money(d.cos))}</b><small>costos, pago a conductores y fletes externos</small></div>
    <div class="tx-kpi ${d.ut < 0 ? 'alerta' : ''}"><span>Utilidad de los viajes</span><b>${esc(money(d.ut))}</b><small>${mg == null ? '—' : mg + ' % de margen'}</small></div>
    <div class="tx-kpi"><span>Kilómetros recorridos</span><b>${nfmt(d.km)}</b><small>${d.km > 0 ? esc(money(d.ing / d.km)) + ' de ingreso por km' : 'sin odómetro registrado'}</small></div>
    <div class="tx-kpi ${cumpl != null && cumpl < 80 ? 'aviso' : ''}"><span>Cumplimiento de tiempo</span><b>${cumpl == null ? '—' : cumpl + ' %'}</b><small>${d.conTiempo.length ? `${d.cumplen.length} de ${d.conTiempo.length} viajes con tiempo estimado` : 'define horas en Rutas'}</small></div>
    <div class="tx-kpi"><span>Mantenimiento</span><b>${esc(money(d.mantTotal))}</b><small>${d.mant.length} orden(es) cerrada(s)</small></div>
    <div class="tx-kpi ${d.incs.length ? 'aviso' : ''}"><span>Incidencias</span><b>${d.incs.length}</b><small>${d.incs.filter(i => i.estado !== 'resuelta').length} sin resolver</small></div>`;
}
function tabla(titulo, cols, filas, vacio) {
  RP.tabla = { titulo, cols, filas };
  if (!filas.length) return `<div class="tx-vacio"><div class="tx-vacio-i">📭</div><b>${esc(vacio || 'Sin datos en este periodo')}</b><p>Cambia el periodo o registra más viajes entregados.</p></div>`;
  const fm = (c, v) => c.t === 'money' ? esc(money(v)) : c.t === 'pct' ? (v == null ? '—' : esc(v) + ' %') : c.t === 'km' ? nfmt(v) : c.t === 'num' ? nfmt(v, c.d || 0) : esc(v == null ? '—' : v);
  return `<div class="tx-scroll"><table class="tx-rank"><thead><tr>${cols.map(c => `<th class="${c.t && c.t !== 'txt' ? 'n' : ''}">${esc(c.n)}</th>`).join('')}</tr></thead><tbody>
    ${filas.map(f => `<tr>${cols.map(c => `<td class="${c.t && c.t !== 'txt' ? 'n' : ''} ${c.k === 'ut' ? (f.ut >= 0 ? 'tx-pos' : 'tx-neg') : ''}">${c.k === 'ut' ? '<b>' + fm(c, f[c.k]) + '</b>' : fm(c, f[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const COLS_BASE = [{ k: 'n', n: 'Nombre' }, { k: 'v', n: 'Viajes', t: 'num' }, { k: 'km', n: 'Km', t: 'km' }, { k: 'ing', n: 'Ingresos', t: 'money' }, { k: 'cos', n: 'Costos', t: 'money' }, { k: 'ut', n: 'Utilidad', t: 'money' }, { k: 'mg', n: 'Margen', t: 'pct' }];
function agrupar(ents, clave, nombre) {
  const m = new Map();
  ents.forEach(o => {
    const k = clave(o) || '_sin'; const g = m.get(k) || { k, n: clave(o) ? nombre(o) : 'Sin asignar', v: 0, km: 0, ing: 0, cos: 0 };
    g.v++; g.km += kmOrden(o); g.ing += Number(o.total || 0); g.cos += costoOrden(o.id); m.set(k, g);
  });
  return [...m.values()].map(g => ({ ...g, ing: r2(g.ing), cos: r2(g.cos), ut: r2(g.ing - g.cos), mg: g.ing > 0 ? Math.round((g.ing - g.cos) / g.ing * 1000) / 10 : null })).sort((a, b) => b.ut - a.ut);
}
function barras(d) {
  const m = new Map();
  d.ents.forEach(o => { const k = fechaOrden(o).slice(0, 7); const g = m.get(k) || { k, ing: 0, cos: 0 }; g.ing += Number(o.total || 0); g.cos += costoOrden(o.id); m.set(k, g); });
  const l = [...m.values()].sort((a, b) => a.k.localeCompare(b.k)).slice(-12);
  if (!l.length) return '';
  const max = Math.max(...l.map(x => Math.max(x.ing, x.cos)), 1);
  const nm = k => { const [y, mm] = k.split('-'); return new Date(+y, +mm - 1, 1).toLocaleDateString('es-NI', { month: 'short', year: '2-digit' }); };
  return `<div class="tx-sec">Ingresos y costos por mes</div><div class="tx-fila-chips" style="font-size:12px;margin-bottom:6px"><span class="tx-chip azul">Ingresos</span><span class="tx-chip naranja">Costos</span></div>
    <div style="display:flex;gap:10px;align-items:flex-end;min-height:150px;overflow-x:auto;padding-bottom:4px">${l.map(x => `<div style="flex:1 0 54px;text-align:center;font-size:11px;color:var(--text-secondary)">
      <div style="display:flex;gap:3px;align-items:flex-end;justify-content:center;height:120px"><div title="Ingresos ${esc(money(x.ing))}" style="width:16px;height:${Math.max(2, Math.round(x.ing / max * 120))}px;background:var(--accent);border-radius:4px 4px 0 0"></div><div title="Costos ${esc(money(x.cos))}" style="width:16px;height:${Math.max(2, Math.round(x.cos / max * 120))}px;background:var(--warning);border-radius:4px 4px 0 0"></div></div>${esc(nm(x.k))}</div>`).join('')}</div>`;
}
function vistaResumen(d) {
  const sinCostos = d.ents.filter(o => costoOrden(o.id) === 0).length;
  const enCurso = RP.ordenes.filter(o => ['pendiente', 'asignada', 'en_ruta'].includes(o.estado)).length;
  const top = (arr, n) => arr.slice(0, n);
  const mini = (t, f) => f.length ? `<div class="tx-sec">${t}</div>${tabla(t, COLS_BASE.slice(0, 1).concat(COLS_BASE.slice(3, 6)), top(f, 5))}` : '';
  const cli = agrupar(d.ents, o => o.cliente_id || o.cliente_nombre, o => o.cliente_nombre || 'Sin cliente');
  const rut = agrupar(d.ents, o => o.ruta_id || (o.origen || o.destino ? `${o.origen}>${o.destino}` : ''), o => RP.rutas.find(r => r.id === o.ruta_id)?.nombre || `${o.origen || '?'} → ${o.destino || '?'}`);
  RP.tabla = null;
  return `${sinCostos ? `<div class="tx-aviso-banda"><div style="font-size:22px">⚠️</div><div><b>${sinCostos} viaje(s) sin costos registrados</b>Su utilidad sale completa porque no se anotó combustible ni otros costos. Regístralos en cada orden para un cálculo real.</div></div>` : ''}
    <div class="tx-ayuda" style="margin-bottom:8px">${enCurso} orden(es) en curso no se cuentan hasta que se entreguen. La utilidad no incluye depreciación, salarios fijos ni el mantenimiento (se muestra aparte).</div>
    ${barras(d)}${mini('Mejores clientes por utilidad', cli)}${mini('Mejores rutas por utilidad', rut)}`
    + (d.ents.length ? '' : `<div class="tx-vacio"><div class="tx-vacio-i">📈</div><b>Aún no hay viajes entregados en este periodo</b><p>Los indicadores se calculan con las órdenes entregadas.</p></div>`);
}
function vistaUnidades(d) {
  const filas = agrupar(d.ents, o => o.unidad_id || (o.subcontratada ? 'ext' : ''), o => { if (o.subcontratada && !o.unidad_id) return 'Transportista externo'; const u = RP.unidades.find(x => x.id === o.unidad_id); return u ? u.nombre + (u.placa ? ' · ' + u.placa : '') : 'Unidad eliminada'; })
    .map(f => { const mt = r2(d.mant.filter(m => m.unidad_id === f.k).reduce((s, m) => s + Number(m.total || 0), 0)); return { ...f, mant: mt, utm: r2(f.ut - mt), cpk: f.km > 0 ? r2((f.cos + mt) / f.km) : null }; });
  const ids = new Set(filas.map(f => f.k));
  d.mant.forEach(m => { if (!ids.has(m.unidad_id)) { ids.add(m.unidad_id); const u = RP.unidades.find(x => x.id === m.unidad_id); filas.push({ k: m.unidad_id, n: u ? u.nombre + (u.placa ? ' · ' + u.placa : '') : 'Unidad eliminada', v: 0, km: 0, ing: 0, cos: 0, ut: 0, mg: null, mant: r2(d.mant.filter(x => x.unidad_id === m.unidad_id).reduce((s, x) => s + Number(x.total || 0), 0)), utm: 0, cpk: null }); filas[filas.length - 1].utm = -filas[filas.length - 1].mant; } });
  const cols = [...COLS_BASE.slice(0, 6), { k: 'mant', n: 'Mantenimiento', t: 'money' }, { k: 'utm', n: 'Utilidad tras mant.', t: 'money' }, { k: 'cpk', n: 'Costo por km', t: 'money' }];
  return tabla('Rendimiento por unidad', cols, filas.sort((a, b) => b.utm - a.utm), 'Sin viajes ni mantenimiento en este periodo');
}
function vistaIncidencias(d) {
  const por = new Map();
  d.incs.forEach(i => { const g = por.get(i.tipo) || { n: TIPOS_INC[i.tipo] || i.tipo, c: 0, ab: 0, cost: 0, rec: 0 }; g.c++; if (i.estado !== 'resuelta') g.ab++; g.cost += Number(i.costo_estimado || 0); g.rec += Number(i.monto_reclamado || 0); por.set(i.tipo, g); });
  const res = d.incs.filter(i => i.estado === 'resuelta' && i.resuelta_en && i.created_at).map(i => (new Date(i.resuelta_en) - new Date(i.created_at)) / 86400000).filter(x => isFinite(x) && x >= 0);
  const prom = res.length ? res.reduce((a, b) => a + b, 0) / res.length : null;
  const filas = [...por.values()].sort((a, b) => b.c - a.c);
  return `<div class="tx-ayuda" style="margin-bottom:8px">${prom != null ? `Tiempo promedio para resolver: ${nfmt(prom, 1)} día(s).` : 'Aún no hay incidencias resueltas para medir el tiempo de resolución.'}</div>`
    + tabla('Incidencias por tipo', [{ k: 'n', n: 'Tipo' }, { k: 'c', n: 'Cantidad', t: 'num' }, { k: 'ab', n: 'Sin resolver', t: 'num' }, { k: 'cost', n: 'Costo estimado', t: 'money' }, { k: 'rec', n: 'Reclamado', t: 'money' }], filas, 'Sin incidencias en este periodo');
}
function render() {
  document.querySelectorAll('[data-rp-vista]').forEach(b => b.classList.toggle('on', b.dataset.rpVista === RP.vista));
  const d = datos(); renderKpis(d); const el = $('rp-vista');
  if (RP.vista === 'clientes') el.innerHTML = tabla('Por cliente', COLS_BASE.map(c => c.k === 'n' ? { ...c, n: 'Cliente' } : c), agrupar(d.ents, o => o.cliente_id || o.cliente_nombre, o => o.cliente_nombre || 'Sin cliente'));
  else if (RP.vista === 'rutas') el.innerHTML = tabla('Por ruta', COLS_BASE.map(c => c.k === 'n' ? { ...c, n: 'Ruta' } : c), agrupar(d.ents, o => o.ruta_id || (o.origen || o.destino ? `${o.origen}>${o.destino}` : ''), o => RP.rutas.find(r => r.id === o.ruta_id)?.nombre || `${o.origen || '?'} → ${o.destino || '?'}`));
  else if (RP.vista === 'unidades') el.innerHTML = vistaUnidades(d);
  else if (RP.vista === 'conductores') {
    const filas = agrupar(d.ents, o => o.conductor_id || (o.subcontratada ? 'ext' : ''), o => { if (o.subcontratada && !o.conductor_id) return 'Transportista externo'; return RP.conductores.find(c => c.id === o.conductor_id)?.nombre || 'Conductor eliminado'; })
      .map(f => ({ ...f, inc: d.incs.filter(i => i.conductor_id === f.k).length }));
    el.innerHTML = tabla('Por conductor', [...COLS_BASE.map(c => c.k === 'n' ? { ...c, n: 'Conductor' } : c), { k: 'inc', n: 'Incidencias', t: 'num' }], filas);
  } else if (RP.vista === 'incidencias') el.innerHTML = vistaIncidencias(d);
  else el.innerHTML = vistaResumen(d);
}

/* ---------------- Exportar ---------------- */
function csv() {
  if (!RP.tabla) { TX.toast('Abre Clientes, Rutas, Unidades, Conductores o Incidencias para exportar su tabla.', 'error'); return; }
  const { titulo, cols, filas } = RP.tabla, q = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const l = [cols.map(c => q(c.n)).join(',')].concat(filas.map(f => cols.map(c => q(f[c.k])).join(',')));
  const blob = new Blob(['﻿' + l.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `transporte_${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${TX.hoyISO()}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function enlazar() {
  $('rp-periodo').addEventListener('change', e => {
    RP.periodo = e.target.value; const rg = RP.periodo === 'rango';
    $('rp-desde').style.display = rg ? '' : 'none'; $('rp-hasta').style.display = rg ? '' : 'none'; render();
  });
  $('rp-desde').addEventListener('change', e => { RP.desde = e.target.value; render(); });
  $('rp-hasta').addEventListener('change', e => { RP.hasta = e.target.value; render(); });
  $('rp-csv').addEventListener('click', csv);
  $('rp-imprimir').addEventListener('click', () => window.print());
  document.addEventListener('click', e => { const t = e.target.closest('[data-rp-vista]'); if (t) { RP.vista = t.dataset.rpVista; render(); } });
}
window.RP = RP;
document.addEventListener('DOMContentLoaded', () => { TX.init(async () => { enlazar(); await cargarTodo(); render(); }); });
