/* ============================================================
   TRANSPORTE-LIQUIDACIONES.JS — NEGOCIO360 (Transporte · Fase 7)
   Liquidación de conductores y ayudantes: pago por viaje, km o
   porcentaje del flete, con anticipos y descuentos.
   - El pago neto sale de Caja como un Gasto (Contabilidad lo asienta).
   - Los anticipos ya dados en los viajes (Costos) se descuentan aquí.
   - Cada orden liquidada suma su costo real a la rentabilidad.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, num } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const LQ = {
  vista: 'pend', personas: [], ordenes: [], costos: [], rutas: [], liqs: [], liqOrd: [], metodos: [], bancos: [],
  liq: null, pagoId: null, detalleId: null,
};
const MODALIDAD = { viaje: 'Monto fijo por viaje', km: 'Monto por kilómetro', porcentaje: 'Porcentaje del flete' };

/* ---------------- Carga ---------------- */
async function cargarTodo() {
  const [personas, ordenes, costos, rutas, liqs, liqOrd] = await Promise.all([
    TX.paginar(() => sb.from('transporte_conductores').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_ordenes').select('*').eq('auth_user_id', TX.userId).eq('estado', 'entregada')),
    TX.paginar(() => sb.from('transporte_costos').select('*').eq('auth_user_id', TX.userId).eq('categoria', 'anticipo')),
    TX.paginar(() => sb.from('transporte_rutas').select('id,nombre,distancia_km').eq('auth_user_id', TX.userId)),
    TX.paginar(() => sb.from('transporte_liquidaciones').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.paginar(() => sb.from('transporte_liquidacion_ordenes').select('*').eq('auth_user_id', TX.userId)),
  ]);
  LQ.personas = personas; LQ.ordenes = ordenes; LQ.costos = costos; LQ.rutas = rutas; LQ.liqs = liqs; LQ.liqOrd = liqOrd;
  try { const { data } = await sb.from('metodos_pago').select('*').eq('auth_user_id', TX.userId).eq('activo', true).order('orden'); LQ.metodos = data || []; } catch (_) { LQ.metodos = []; }
  try { const { data } = await sb.from('bancos').select('id,nombre').eq('auth_user_id', TX.userId).eq('activo', true).order('nombre'); LQ.bancos = data || []; } catch (_) { LQ.bancos = []; }
}

/* ---------------- Cálculos ---------------- */
const persona = id => LQ.personas.find(p => p.id === id);
const liqPagada = id => LQ.liqs.find(l => l.id === id && l.estado === 'pagada');
// ¿Esta orden ya fue liquidada a esta persona (en una liquidación no anulada)?
function yaLiquidada(personaId, ordenId) {
  return LQ.liqOrd.some(x => x.orden_id === ordenId && liqPagada(x.liquidacion_id)?.conductor_id === personaId);
}
const rutaDe = o => LQ.rutas.find(r => r.id === o.ruta_id);
function kmDe(o) {
  if (o.odometro_salida != null && o.odometro_llegada != null) { const k = Number(o.odometro_llegada) - Number(o.odometro_salida); if (k > 0) return k; }
  const r = rutaDe(o); return r && r.distancia_km != null ? Number(r.distancia_km) : 0;
}
function pagoSugerido(p, o) {
  const t = Number(p.pago_tarifa) || 0;
  if (p.pago_modalidad === 'km') return r2(t * kmDe(o));
  if (p.pago_modalidad === 'porcentaje') return r2(Number(o.total || 0) * t / 100);
  return r2(t);
}
// Órdenes entregadas donde participó (conductor o ayudante) y aún no se le liquidan
function pendientesDe(p) {
  return LQ.ordenes.filter(o => (o.conductor_id === p.id || o.ayudante_id === p.id) && !yaLiquidada(p.id, o.id))
    .sort((a, b) => String(a.entrega_real || a.created_at).localeCompare(String(b.entrega_real || b.created_at)));
}
// Anticipos dados al conductor en esas órdenes que todavía no se descontaron
const anticiposDe = (p, o) => o.conductor_id === p.id ? LQ.costos.filter(c => c.orden_id === o.id && !c.liquidacion_id) : [];
const fmtFecha = TX.fmtFecha;
const fmtF = iso => iso ? TX.fmtFecha(iso) : '—';
function siguienteNumero() {
  let max = 0;
  LQ.liqs.forEach(l => { const m = /(\d+)$/.exec(l.numero || ''); if (m) max = Math.max(max, Number(m[1])); });
  return 'LQ-' + String(max + 1).padStart(4, '0');
}

/* ---------------- Vistas ---------------- */
function renderKpis() {
  let porLiq = 0, nPend = 0, antPend = 0;
  LQ.personas.forEach(p => {
    const ords = pendientesDe(p); if (!ords.length) return; nPend++;
    ords.forEach(o => { porLiq += pagoSugerido(p, o); antPend += anticiposDe(p, o).reduce((s, c) => s + Number(c.monto || 0), 0); });
  });
  const mes = TX.hoyISO().slice(0, 7);
  const pag = LQ.liqs.filter(l => l.estado === 'pagada' && String(l.fecha).slice(0, 7) === mes);
  $('lq-kpis').innerHTML = `
    <div class="tx-kpi"><span>Por liquidar (estimado)</span><b>${esc(money(porLiq))}</b><small>${nPend} persona(s) con viajes pendientes</small></div>
    <div class="tx-kpi"><span>Anticipos por descontar</span><b>${esc(money(antPend))}</b><small>ya entregados en viajes</small></div>
    <div class="tx-kpi"><span>Pagado este mes</span><b>${esc(money(r2(pag.reduce((s, l) => s + Number(l.neto || 0), 0))))}</b><small>${pag.length} liquidación(es)</small></div>
    <div class="tx-kpi"><span>Liquidaciones</span><b>${LQ.liqs.filter(l => l.estado === 'pagada').length}</b><small>${LQ.liqs.filter(l => l.estado === 'anulada').length} anulada(s)</small></div>`;
}

function renderPendientes() {
  const items = LQ.personas.filter(p => p.estado !== 'inactivo' || pendientesDe(p).length).map(p => ({ p, ords: pendientesDe(p) })).filter(x => x.ords.length);
  if (!items.length) {
    $('lq-vista').innerHTML = `<div class="tx-vacio"><div class="tx-vacio-i">✅</div><b>No hay viajes por liquidar</b><p>Cuando una orden se marque como entregada, aparecerá aquí para pagarle a su conductor.</p></div>`;
    return;
  }
  $('lq-vista').innerHTML = `<div class="tx-grid">${items.map(({ p, ords }) => {
    const bruto = r2(ords.reduce((s, o) => s + pagoSugerido(p, o), 0));
    const ant = r2(ords.reduce((s, o) => s + anticiposDe(p, o).reduce((a, c) => a + Number(c.monto || 0), 0), 0));
    const sinForma = !(Number(p.pago_tarifa) > 0);
    return `<div class="tx-card"><div class="tx-card-body" style="padding:14px 16px">
      <div class="tx-fila-chips"><span class="tx-chip">${p.rol === 'ayudante' ? 'Ayudante' : 'Conductor'}</span>${sinForma ? '<span class="tx-chip naranja">Sin forma de pago</span>' : `<span class="tx-chip verde">${esc(MODALIDAD[p.pago_modalidad] || '')}</span>`}</div>
      <b>${esc(p.nombre)}</b>
      <small>${ords.length} viaje(s) entregado(s) sin liquidar</small>
      <small>Pago estimado: <b>${esc(money(bruto))}</b>${ant > 0 ? ` · Anticipos: <b>${esc(money(ant))}</b>` : ''}</small>
      <div class="tx-fila-chips" style="margin-top:8px"><button type="button" class="tx-btn tx-btn-primary tx-btn-sm" data-lq-liquidar="${esc(p.id)}">💵 Liquidar</button>
        <button type="button" class="tx-btn tx-btn-sm" data-lq-pago="${esc(p.id)}">⚙️ Forma de pago</button></div>
    </div></div>`;
  }).join('')}</div>`;
}

function renderHistorial() {
  if (!LQ.liqs.length) { $('lq-vista').innerHTML = `<div class="tx-vacio"><div class="tx-vacio-i">🧾</div><b>Aún no hay liquidaciones</b><p>Las liquidaciones que hagas quedarán aquí, con su comprobante.</p></div>`; return; }
  $('lq-vista').innerHTML = LQ.liqs.map(l => `<div class="tx-fila" data-lq-abrir="${esc(l.id)}"><div class="tx-fila-main"><b>${esc(l.numero)} · ${esc(l.conductor_nombre || 'Conductor')}</b>
      <small>${esc(fmtF(l.fecha))} · ${esc(MODALIDAD[l.modalidad] || '')}${l.metodo_pago_nombre ? ' · ' + esc(l.metodo_pago_nombre) : ''}</small>
      <div class="tx-fila-chips" style="margin-top:4px">${l.estado === 'anulada' ? '<span class="tx-chip rojo">Anulada</span>' : '<span class="tx-chip verde">Pagada</span>'}</div></div>
      <div class="tx-fila-der">${esc(money(l.neto))}</div></div>`).join('');
}

function renderPago() {
  const ps = LQ.personas.filter(p => p.estado !== 'inactivo');
  if (!ps.length) { $('lq-vista').innerHTML = `<div class="tx-vacio"><div class="tx-vacio-i">🧑‍✈️</div><b>Aún no tienes conductores</b><p>Regístralos en Conductores y vuelve para definir cómo se les paga.</p><a class="tx-btn tx-btn-primary" href="conductores.html">Ir a Conductores</a></div>`; return; }
  $('lq-vista').innerHTML = ps.map(p => `<div class="tx-fila" data-lq-pago="${esc(p.id)}"><div class="tx-fila-main"><b>${esc(p.nombre)}</b>
      <small>${p.rol === 'ayudante' ? 'Ayudante' : 'Conductor'}${p.vinculo === 'subcontratado' ? ' · subcontratado' : ''}</small></div>
      <div class="tx-fila-der" style="font-size:13px">${Number(p.pago_tarifa) > 0
        ? esc(p.pago_modalidad === 'porcentaje' ? p.pago_tarifa + '% del flete' : money(p.pago_tarifa) + (p.pago_modalidad === 'km' ? ' por km' : ' por viaje')) : '<span style="color:var(--text-muted)">Sin definir</span>'}</div></div>`).join('');
}

function renderTodo() {
  renderKpis();
  document.querySelectorAll('[data-lq-vista]').forEach(b => b.classList.toggle('on', b.dataset.lqVista === LQ.vista));
  if (LQ.vista === 'pend') renderPendientes(); else if (LQ.vista === 'hist') renderHistorial(); else renderPago();
}

/* ---------------- Forma de pago ---------------- */
function abrirPago(id) {
  const p = persona(id); if (!p) return; LQ.pagoId = id;
  $('lp-titulo').textContent = 'Forma de pago · ' + p.nombre;
  $('lp-modalidad').value = p.pago_modalidad || 'viaje'; $('lp-tarifa').value = Number(p.pago_tarifa) > 0 ? p.pago_tarifa : '';
  cambiaModalidad(); $('lp-error').textContent = ''; TX.abrir('lq-modal-pago');
}
function cambiaModalidad() {
  const m = $('lp-modalidad').value;
  $('lp-tarifa-lbl').textContent = m === 'viaje' ? 'Monto por viaje *' : m === 'km' ? 'Monto por kilómetro *' : 'Porcentaje del flete (%) *';
  $('lp-ayuda').textContent = m === 'km' ? 'Se multiplica por los km recorridos (odómetro de la orden, o la distancia de la ruta).' : m === 'porcentaje' ? 'Se calcula sobre el total (flete) de cada orden.' : 'Se paga este monto por cada viaje entregado.';
}
async function guardarPago() {
  const t = num($('lp-tarifa').value), m = $('lp-modalidad').value;
  if (t == null || t <= 0) { $('lp-error').textContent = 'Escribe un valor mayor a 0.'; return; }
  if (m === 'porcentaje' && t > 100) { $('lp-error').textContent = 'El porcentaje no puede pasar de 100.'; return; }
  const btn = $('lp-guardar'); btn.disabled = true;
  try {
    const { error } = await sb.from('transporte_conductores').update({ pago_modalidad: m, pago_tarifa: t }).eq('id', LQ.pagoId).eq('auth_user_id', TX.userId);
    if (error) throw error;
    TX.cerrar('lq-modal-pago'); TX.toast('Forma de pago guardada');
    await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); $('lp-error').textContent = 'No se pudo guardar. Intenta de nuevo.'; }
  finally { btn.disabled = false; }
}

/* ---------------- Liquidar ---------------- */
function abrirLiquidar(id) {
  const p = persona(id); if (!p) return;
  const ords = pendientesDe(p);
  if (!ords.length) { TX.toast('No hay viajes por liquidar', 'error'); return; }
  const caja = LQ.metodos.length > 0 && !!window.CajaAPI;
  LQ.liq = {
    p, caja, metodoId: LQ.metodos[0]?.id || '', bancoId: '', fecha: TX.hoyISO(), notas: '',
    filas: ords.map(o => ({ o, sel: true, monto: pagoSugerido(p, o) })),
    antSel: new Set(ords.flatMap(o => anticiposDe(p, o).map(c => c.id))),
    bonos: [], descs: [],
  };
  renderLiquidar(); TX.abrir('lq-modal-liquidar');
}

function totalesLiq() {
  const L = LQ.liq;
  const sel = L.filas.filter(f => f.sel);
  const bruto = r2(sel.reduce((s, f) => s + (Number(f.monto) || 0), 0));
  const ids = new Set(sel.map(f => f.o.id));
  const ants = L.filas.filter(f => f.sel).flatMap(f => anticiposDe(L.p, f.o)).filter(c => L.antSel.has(c.id));
  const anticipos = r2(ants.reduce((s, c) => s + Number(c.monto || 0), 0));
  const bonos = r2(L.bonos.reduce((s, b) => s + (Number(b.monto) || 0), 0));
  const descuentos = r2(L.descs.reduce((s, b) => s + (Number(b.monto) || 0), 0));
  return { sel, ids, ants, bruto, anticipos, bonos, descuentos, neto: r2(bruto + bonos - anticipos - descuentos) };
}

function renderLiquidar() {
  const L = LQ.liq, p = L.p, T = totalesLiq();
  const filaLinea = (arr, tipo) => arr.map((b, i) => `<div class="tx-cols" style="grid-template-columns:2fr 1fr auto;align-items:end;margin-bottom:6px">
      <input class="tx-in" data-lq-l="${tipo}" data-i="${i}" data-k="concepto" value="${esc(b.concepto)}" placeholder="Concepto" maxlength="80"/>
      <input class="tx-in" data-lq-l="${tipo}" data-i="${i}" data-k="monto" value="${esc(b.monto)}" inputmode="decimal" placeholder="Monto"/>
      <button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-lq-quitar="${tipo}:${i}">🗑</button></div>`).join('');
  const antOrd = f => anticiposDe(p, f.o);
  const metodo = LQ.metodos.find(m => m.id === L.metodoId);
  const nm = (metodo?.nombre || '').toLowerCase();
  const pideBanco = L.caja && T.neto > 0 && (nm.includes('tarjeta') || nm.includes('transferencia')) && LQ.bancos.length > 0;
  $('lq-liq-cuerpo').innerHTML = `
    <div class="tx-fila-chips" style="justify-content:space-between;align-items:flex-start">
      <div><h3 style="margin:0">💵 Liquidar a ${esc(p.nombre)}</h3><small style="color:var(--text-secondary)">${esc(MODALIDAD[p.pago_modalidad] || '')}${Number(p.pago_tarifa) > 0 ? ' · ' + esc(p.pago_modalidad === 'porcentaje' ? p.pago_tarifa + '%' : money(p.pago_tarifa)) : ' · define la forma de pago o escribe los montos a mano'}</small></div>
      <button type="button" class="tx-btn tx-btn-sm" onclick="TXcerrar('lq-modal-liquidar')">Cerrar</button></div>
    <div class="tx-sec">Viajes a pagar</div>
    ${L.filas.map((f, i) => `<div class="tx-doc"><label class="tx-doc-info" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="checkbox" style="width:auto;margin-top:3px" data-lq-sel="${i}" ${f.sel ? 'checked' : ''}/>
        <span><b>${esc(f.o.numero)} · ${esc(f.o.cliente_nombre || 'Sin cliente')}</b><small>${esc(f.o.origen || '—')} → ${esc(f.o.destino || '—')} · ${esc(fmtF(String(f.o.entrega_real || '').slice(0, 10)))} · flete ${esc(money(f.o.total))}${kmDe(f.o) ? ' · ' + kmDe(f.o).toLocaleString('es-NI') + ' km' : ''}</small></span></label>
        <div class="tx-doc-acc"><input class="tx-in" style="width:110px;text-align:right" inputmode="decimal" data-lq-monto="${i}" value="${esc(f.monto)}" ${f.sel ? '' : 'disabled'}/></div></div>`).join('')}
    <div class="tx-sec">Anticipos que se descuentan</div>
    ${T.ants.length || L.filas.some(f => f.sel && antOrd(f).length) ? L.filas.filter(f => f.sel).flatMap(f => antOrd(f).map(c => `<div class="tx-doc"><label class="tx-doc-info" style="display:flex;gap:8px;cursor:pointer"><input type="checkbox" style="width:auto;margin-top:3px" data-lq-ant="${esc(c.id)}" ${L.antSel.has(c.id) ? 'checked' : ''}/>
        <span><b>💵 Anticipo · ${esc(f.o.numero)}</b><small>${esc(fmtF(c.fecha))}${c.descripcion ? ' · ' + esc(c.descripcion) : ''}</small></span></label><b>− ${esc(money(c.monto))}</b></div>`)).join('')
      : '<div style="font-size:13px;color:var(--text-muted)">No hay anticipos pendientes en estos viajes.</div>'}
    <div class="tx-sec">Bonos o adicionales</div>
    ${filaLinea(L.bonos, 'bonos')}<button type="button" class="tx-btn tx-btn-sm" data-lq-agregar="bonos">＋ Agregar bono</button>
    <div class="tx-sec">Otros descuentos (multas, préstamos, daños…)</div>
    ${filaLinea(L.descs, 'descs')}<button type="button" class="tx-btn tx-btn-sm" data-lq-agregar="descs">＋ Agregar descuento</button>
    <div id="lq-resumen"></div>
    <div class="tx-cols" style="margin-top:10px">
      <div class="tx-campo"><label for="lq-fecha">Fecha</label><input class="tx-in" type="date" id="lq-fecha" value="${esc(L.fecha)}"/></div>
      <div class="tx-campo"><label for="lq-notas">Notas</label><input class="tx-in" id="lq-notas" value="${esc(L.notas)}" maxlength="200" placeholder="Opcional"/></div>
    </div>
    <div id="lq-caja-box"></div>
    <div class="tx-err" id="lq-error"></div>
    <div class="tx-pie"><button type="button" class="tx-btn" onclick="TXcerrar('lq-modal-liquidar')">Cancelar</button><button type="button" class="tx-btn tx-btn-primary" id="lq-confirmar">Confirmar liquidación</button></div>`;
  pintarResumen();
}

// Solo repinta los totales y el bloque de Caja (así no se pierde lo que se está escribiendo)
function pintarResumen() {
  const L = LQ.liq; if (!L || !$('lq-resumen')) return;
  const T = totalesLiq();
  const metodo = LQ.metodos.find(m => m.id === L.metodoId);
  const nm = (metodo?.nombre || '').toLowerCase();
  const pideBanco = L.caja && T.neto > 0 && (nm.includes('tarjeta') || nm.includes('transferencia')) && LQ.bancos.length > 0;
  $('lq-resumen').innerHTML = `<div class="tx-sec">Resumen</div>
    <div class="tx-doc"><div class="tx-doc-info"><b>Pago bruto (${T.sel.length} viaje(s))</b></div><b>${esc(money(T.bruto))}</b></div>
    ${T.bonos ? `<div class="tx-doc"><div class="tx-doc-info"><b>+ Bonos</b></div><b>${esc(money(T.bonos))}</b></div>` : ''}
    ${T.anticipos ? `<div class="tx-doc"><div class="tx-doc-info"><b>− Anticipos</b></div><b>${esc(money(T.anticipos))}</b></div>` : ''}
    ${T.descuentos ? `<div class="tx-doc"><div class="tx-doc-info"><b>− Otros descuentos</b></div><b>${esc(money(T.descuentos))}</b></div>` : ''}
    <div class="tx-doc" style="background:var(--accent-soft)"><div class="tx-doc-info"><b>A pagar ahora</b></div><b style="font-size:16px">${esc(money(T.neto))}</b></div>`;
  $('lq-caja-box').innerHTML = LQ.metodos.length && window.CajaAPI && T.neto > 0
    ? `<div class="tx-campo"><label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-primary)"><input type="checkbox" id="lq-caja" style="width:auto" ${L.caja ? 'checked' : ''}/> Pagar ahora desde Caja (se registra en Gastos y Contabilidad)</label></div>
      <div class="tx-campo" id="lq-metodo-wrap" style="${L.caja ? '' : 'display:none'}"><label for="lq-metodo">Método de pago</label><select class="tx-in" id="lq-metodo">${LQ.metodos.map(m => `<option value="${esc(m.id)}" ${m.id === L.metodoId ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></div>
      <div class="tx-campo" id="lq-banco-wrap" style="${pideBanco ? '' : 'display:none'}"><label for="lq-banco">Banco de donde sale</label><select class="tx-in" id="lq-banco"><option value="">Selecciona un banco…</option>${LQ.bancos.map(b => `<option value="${esc(b.id)}" ${b.id === L.bancoId ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}</select></div>`
    : (T.neto > 0 ? '<div class="tx-ayuda">Sin métodos de pago configurados: la liquidación se guarda sin mover Caja.</div>' : '<div class="tx-ayuda">El neto es 0: solo se cierra la cuenta (los anticipos cubren el pago), sin mover Caja.</div>');
  const bc = $('lq-confirmar'); if (bc) bc.disabled = !T.sel.length;
}

// Reparte un total entre las órdenes de forma proporcional (la última recibe el resto)
function repartir(total, pesos) {
  const sum = pesos.reduce((a, b) => a + b, 0), out = []; let acum = 0;
  pesos.forEach((w, i) => {
    const parte = i === pesos.length - 1 ? r2(total - acum) : r2(total * (sum > 0 ? w / sum : 1 / pesos.length));
    out.push(parte); acum = r2(acum + parte);
  });
  return out;
}

async function ultimoMovimientoId() {
  try { const { data } = await sb.from('movimientos_financieros').select('id').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }).limit(1).maybeSingle(); return data?.id || null; } catch (_) { return null; }
}
async function anularGasto(gastoId, motivo) {
  await sb.from('movimientos_financieros').update({ estado: 'anulado', anulado_en: new Date().toISOString(), anulado_motivo: motivo })
    .eq('referencia_tipo', 'gasto').eq('referencia_id', gastoId).eq('auth_user_id', TX.userId).eq('estado', 'completado');
  await sb.from('gastos').update({ estado: 'cancelado', cancelado_en: new Date().toISOString(), cancelado_motivo: motivo }).eq('id', gastoId).eq('auth_user_id', TX.userId);
}

async function confirmarLiquidacion() {
  const L = LQ.liq, p = L.p, T = totalesLiq();
  const err = m => { const e = $('lq-error'); if (e) e.textContent = m; };
  if (!T.sel.length) return err('Marca al menos un viaje.');
  if (T.sel.some(f => !(Number(f.monto) >= 0))) return err('Revisa los montos de los viajes.');
  if (T.bruto + T.bonos <= 0) return err('El pago es 0. Define la forma de pago o escribe los montos a mano.');
  if (T.neto < 0) return err(`Los anticipos y descuentos (${money(T.anticipos + T.descuentos)}) superan el pago (${money(T.bruto + T.bonos)}). Desmarca alguno o ajusta los montos.`);
  const cajaOn = !!$('lq-caja')?.checked && T.neto > 0;
  let metodo = null, bancoId = null;
  if (cajaOn) {
    metodo = LQ.metodos.find(m => m.id === $('lq-metodo').value); if (!metodo) return err('Elige el método de pago.');
    if ($('lq-banco-wrap').style.display !== 'none') { bancoId = $('lq-banco').value; if (!bancoId) return err('Selecciona de qué banco sale el dinero.'); }
  }
  const fecha = $('lq-fecha').value || TX.hoyISO();
  const btn = $('lq-confirmar'); btn.disabled = true;
  let liqId = null, gastoId = null;
  try {
    const numero = siguienteNumero();
    const detalle = {
      bonos: L.bonos.filter(b => Number(b.monto) > 0).map(b => ({ concepto: b.concepto || 'Bono', monto: Number(b.monto) })),
      descuentos: L.descs.filter(b => Number(b.monto) > 0).map(b => ({ concepto: b.concepto || 'Descuento', monto: Number(b.monto) })),
      anticipos: T.ants.map(c => ({ id: c.id, orden_id: c.orden_id, monto: Number(c.monto), fecha: c.fecha })),
    };
    const { data: liq, error: e1 } = await sb.from('transporte_liquidaciones').insert({
      auth_user_id: TX.userId, numero, conductor_id: p.id, conductor_nombre: p.nombre, fecha, modalidad: p.pago_modalidad,
      bruto: T.bruto, bonos: T.bonos, anticipos: T.anticipos, descuentos: T.descuentos, neto: T.neto, detalle,
      estado: 'pagada', metodo_pago_nombre: cajaOn ? metodo.nombre : null, notas: $('lq-notas').value.trim() || null,
    }).select().single();
    if (e1) throw e1;
    liqId = liq.id;

    if (cajaOn) {
      const concepto = `Liquidación ${numero} · ${p.nombre}`;
      const obs = `Pago a ${p.rol === 'ayudante' ? 'ayudante' : 'conductor'} ${p.nombre}: ${T.sel.length} viaje(s)`;
      const { data: g, error: eg } = await sb.from('gastos').insert({
        auth_user_id: TX.userId, tipo: 'inmediato', concepto, categoria: 'Salarios', monto: T.neto, fecha, metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre,
        impuesto: 0, observaciones: obs, estado: 'activo', empleado: p.nombre,
      }).select().single();
      if (eg) throw eg;
      gastoId = g.id;
      const mov = await window.CajaAPI.registrarMovimiento({
        auth_user_id: TX.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO', concepto: `Salarios: ${concepto}`, monto: T.neto,
        metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre, origen_caja: null, banco_id: bancoId || null,
        referencia_tipo: 'gasto', referencia_id: g.id, observaciones: obs, fecha,
      });
      if (!mov.ok) { await sb.from('gastos').delete().eq('id', g.id).eq('auth_user_id', TX.userId); gastoId = null; throw new Error('Caja: ' + mov.error); }
      const movId = await ultimoMovimientoId();
      if (movId) await sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', g.id).eq('auth_user_id', TX.userId);
      await sb.from('transporte_liquidaciones').update({ gasto_id: gastoId, movimiento_caja_id: movId }).eq('id', liqId).eq('auth_user_id', TX.userId);
    }

    // Reparto por orden: la suma de costo_neto es exactamente el neto pagado
    const montos = T.sel.map(f => Number(f.monto) || 0);
    const bonoPor = repartir(T.bonos, montos), descPor = repartir(T.descuentos, montos);
    const filas = T.sel.map((f, i) => {
      const ant = r2(anticiposDe(p, f.o).filter(c => L.antSel.has(c.id)).reduce((s, c) => s + Number(c.monto || 0), 0));
      return { auth_user_id: TX.userId, liquidacion_id: liqId, orden_id: f.o.id, bruto: montos[i], bono: bonoPor[i], anticipo: ant, descuento: descPor[i],
        costo_neto: r2(montos[i] + bonoPor[i] - ant - descPor[i]) };
    });
    const { error: e2 } = await sb.from('transporte_liquidacion_ordenes').insert(filas);
    if (e2) throw e2;
    if (T.ants.length) {
      const { error: e3 } = await sb.from('transporte_costos').update({ liquidacion_id: liqId }).in('id', T.ants.map(c => c.id)).eq('auth_user_id', TX.userId);
      if (e3) throw e3;
    }
    TX.cerrar('lq-modal-liquidar'); TX.toast(cajaOn ? 'Liquidación pagada y descontada de Caja' : 'Liquidación guardada');
    await cargarTodo(); renderTodo(); abrirDetalle(liqId);
  } catch (e) {
    console.error(e);
    try {
      if (gastoId) await anularGasto(gastoId, 'No se pudo completar la liquidación');
      if (liqId) await sb.from('transporte_liquidaciones').delete().eq('id', liqId).eq('auth_user_id', TX.userId);
    } catch (_) {}
    err('No se pudo guardar la liquidación. No se registró nada en Caja.');
    btn.disabled = false;
  }
}

/* ---------------- Detalle / comprobante / anular ---------------- */
function abrirDetalle(id) { LQ.detalleId = id; renderDetalle(); TX.abrir('lq-modal-detalle'); }
function renderDetalle() {
  const l = LQ.liqs.find(x => x.id === LQ.detalleId); if (!l) { TX.cerrar('lq-modal-detalle'); return; }
  const lo = LQ.liqOrd.filter(x => x.liquidacion_id === l.id);
  const d = l.detalle || {};
  const orden = id => LQ.ordenes.find(o => o.id === id);
  $('lq-det-cuerpo').innerHTML = `
    <div id="lq-comprobante">
    <div class="tx-fila-chips" style="justify-content:space-between;align-items:flex-start">
      <div><h3 style="margin:0">🧾 ${esc(l.numero)}</h3><small style="color:var(--text-secondary)">${esc(l.conductor_nombre || '')} · ${esc(fmtF(l.fecha))}</small></div>
      <div class="tx-fila-chips">${l.estado === 'anulada' ? '<span class="tx-chip rojo">Anulada</span>' : '<span class="tx-chip verde">Pagada</span>'}
        <button type="button" class="tx-btn tx-btn-sm" onclick="TXcerrar('lq-modal-detalle')">Cerrar</button></div></div>
    <div class="tx-sec">Viajes</div>
    ${lo.length ? lo.map(x => { const o = orden(x.orden_id); return `<div class="tx-doc"><div class="tx-doc-info"><b>${esc(o ? o.numero : 'Orden')} ${o ? '· ' + esc(o.cliente_nombre || '') : ''}</b><small>${o ? esc((o.origen || '—') + ' → ' + (o.destino || '—')) : ''}</small></div><b>${esc(money(x.bruto))}</b></div>`; }).join('')
      : '<div style="font-size:13px;color:var(--text-muted)">Sin viajes (liquidación anulada).</div>'}
    <div class="tx-sec">Cuentas</div>
    <div class="tx-doc"><div class="tx-doc-info"><b>Pago bruto</b><small>${esc(MODALIDAD[l.modalidad] || '')}</small></div><b>${esc(money(l.bruto))}</b></div>
    ${(d.bonos || []).map(b => `<div class="tx-doc"><div class="tx-doc-info"><b>+ ${esc(b.concepto)}</b></div><b>${esc(money(b.monto))}</b></div>`).join('')}
    ${(d.anticipos || []).map(a => `<div class="tx-doc"><div class="tx-doc-info"><b>− Anticipo ${esc(fmtF(a.fecha))}</b></div><b>${esc(money(a.monto))}</b></div>`).join('')}
    ${(d.descuentos || []).map(b => `<div class="tx-doc"><div class="tx-doc-info"><b>− ${esc(b.concepto)}</b></div><b>${esc(money(b.monto))}</b></div>`).join('')}
    <div class="tx-doc" style="background:var(--accent-soft)"><div class="tx-doc-info"><b>Neto pagado</b><small>${l.gasto_id ? '💸 Salió de Caja y está en Gastos' : 'Sin movimiento de Caja'}${l.metodo_pago_nombre ? ' · ' + esc(l.metodo_pago_nombre) : ''}</small></div><b style="font-size:16px">${esc(money(l.neto))}</b></div>
    ${l.notas ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:8px">📝 ${esc(l.notas)}</div>` : ''}
    ${l.estado === 'anulada' ? `<div style="font-size:13px;color:var(--danger);margin-top:8px">Anulada: ${esc(l.anulada_motivo || '')}</div>` : ''}
    </div>
    <div class="tx-pie" style="justify-content:space-between">
      ${l.estado === 'pagada' ? `<button type="button" class="tx-btn tx-btn-borrar" data-lq-anular="${esc(l.id)}">⛔ Anular liquidación</button>` : '<span></span>'}
      <button type="button" class="tx-btn" data-lq-imprimir="${esc(l.id)}">🖨️ Imprimir</button></div>`;
}

async function anularLiquidacion(id) {
  const l = LQ.liqs.find(x => x.id === id); if (!l || l.estado !== 'pagada') return;
  if (!await TX.confirmar('¿Anular la liquidación?', `Se devuelve ${money(l.neto)} a Caja${l.gasto_id ? ' y se cancela su gasto' : ''}, y los viajes y anticipos quedan otra vez por liquidar.`, 'Anular', true)) return;
  try {
    const motivo = 'Liquidación anulada';
    if (l.gasto_id) await anularGasto(l.gasto_id, motivo);
    await sb.from('transporte_liquidacion_ordenes').delete().eq('liquidacion_id', id).eq('auth_user_id', TX.userId);
    await sb.from('transporte_costos').update({ liquidacion_id: null }).eq('liquidacion_id', id).eq('auth_user_id', TX.userId);
    const { error } = await sb.from('transporte_liquidaciones').update({ estado: 'anulada', anulada_en: new Date().toISOString(), anulada_motivo: motivo }).eq('id', id).eq('auth_user_id', TX.userId);
    if (error) throw error;
    TX.toast('Liquidación anulada'); await cargarTodo(); renderTodo(); renderDetalle();
  } catch (e) { console.error(e); TX.toast('No se pudo anular la liquidación', 'error'); }
}

function imprimirLiquidacion() {
  const cuerpo = $('lq-comprobante'); if (!cuerpo) return;
  const w = window.open('', '_blank', 'width=720,height=900'); if (!w) { TX.toast('Permite las ventanas emergentes para imprimir', 'error'); return; }
  const neg = TX.empresaConfig?.nombre_comercial || 'Negocio360';
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Liquidación</title><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;padding:24px;max-width:640px;margin:0 auto}
    .tx-doc{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #ddd;padding:6px 0}.tx-doc small{display:block;color:#555}
    .tx-sec{font-weight:700;margin:14px 0 4px;text-transform:uppercase;font-size:11px;color:#444}.tx-btn,.tx-fila-chips button{display:none}
    .tx-chip{border:1px solid #999;border-radius:10px;padding:1px 8px;font-size:11px}h3{margin:0}
    .firma{margin-top:48px;display:flex;gap:40px}.firma div{flex:1;border-top:1px solid #000;text-align:center;padding-top:4px;font-size:12px}
  </style></head><body><h2 style="margin:0 0 4px">${esc(neg)}</h2><div style="margin-bottom:10px">Comprobante de liquidación</div>${cuerpo.innerHTML}
  <div class="firma"><div>Entregué conforme</div><div>Recibí conforme</div></div></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

/* ---------------- Eventos ---------------- */
function enlazar() {
  $('lp-modalidad').addEventListener('change', cambiaModalidad);
  $('lp-guardar').addEventListener('click', guardarPago);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-lq-vista],[data-lq-liquidar],[data-lq-pago],[data-lq-abrir],[data-lq-agregar],[data-lq-quitar],[data-lq-anular],[data-lq-imprimir],#lq-confirmar');
    if (!t) return;
    if (t.id === 'lq-confirmar') return confirmarLiquidacion();
    const d = t.dataset;
    if (d.lqVista) { LQ.vista = d.lqVista; renderTodo(); }
    else if (d.lqLiquidar) abrirLiquidar(d.lqLiquidar);
    else if (d.lqPago) abrirPago(d.lqPago);
    else if (d.lqAbrir) abrirDetalle(d.lqAbrir);
    else if (d.lqAgregar) { LQ.liq[d.lqAgregar].push({ concepto: '', monto: '' }); renderLiquidar(); }
    else if (d.lqQuitar) { const [k, i] = d.lqQuitar.split(':'); LQ.liq[k].splice(Number(i), 1); renderLiquidar(); }
    else if (d.lqAnular) anularLiquidacion(d.lqAnular);
    else if (d.lqImprimir) imprimirLiquidacion();
  });
  // Cambios dentro del modal de liquidar (sin perder lo escrito: solo se vuelve a dibujar lo necesario)
  document.addEventListener('change', e => {
    const L = LQ.liq; if (!L || !$('lq-modal-liquidar').classList.contains('open')) return;
    const t = e.target;
    if (t.dataset.lqSel != null) { L.filas[Number(t.dataset.lqSel)].sel = t.checked; renderLiquidar(); }
    else if (t.dataset.lqAnt) { if (t.checked) L.antSel.add(t.dataset.lqAnt); else L.antSel.delete(t.dataset.lqAnt); renderLiquidar(); }
    else if (t.dataset.lqMonto != null) { L.filas[Number(t.dataset.lqMonto)].monto = num(t.value) ?? 0; pintarResumen(); }
    else if (t.dataset.lqL) { const b = L[t.dataset.lqL][Number(t.dataset.i)]; if (b) { b[t.dataset.k] = t.dataset.k === 'monto' ? (num(t.value) ?? '') : t.value; pintarResumen(); } }
    else if (t.id === 'lq-caja') { L.caja = t.checked; pintarResumen(); }
    else if (t.id === 'lq-metodo') { L.metodoId = t.value; pintarResumen(); }
    else if (t.id === 'lq-banco') { L.bancoId = t.value; }
    else if (t.id === 'lq-fecha') { L.fecha = t.value; }
    else if (t.id === 'lq-notas') { L.notas = t.value; }
  });
}

window.LQ = LQ;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => { enlazar(); await cargarTodo(); renderTodo(); });
});
