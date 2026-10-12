/* ============================================================
   TRANSPORTE-FACTURACION.JS — NEGOCIO360 (Transporte · Fase 9)
   Del viaje entregado a la venta y su cobranza.
   - "Facturar" abre Ventas con el cliente y el flete de la orden ya cargados
     (contado, crédito a fecha fija, retención de IR del cliente, Caja y
     Contabilidad los resuelve Ventas, sin duplicar lógica).
   - Al confirmar la venta, la orden queda ligada a ella (ordenes.venta_id).
   - Aquí se ve si cada viaje facturado está cobrado o cuánto falta.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const FC = { vista: 'pend', ordenes: [], ventas: {}, creditos: {} };
const NOMBRE_SERVICIO = 'Flete de transporte';

async function cargarTodo() {
  FC.ordenes = await TX.paginar(() => sb.from('transporte_ordenes').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }));
  const ids = FC.ordenes.map(o => o.venta_id).filter(Boolean);
  FC.ventas = {}; FC.creditos = {};
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    try { const { data } = await sb.from('ventas').select('*').in('id', lote).eq('auth_user_id', TX.userId); (data || []).forEach(v => { FC.ventas[v.id] = v; }); } catch (_) {}
    try { const { data } = await sb.from('creditos').select('*').in('venta_id', lote).eq('auth_user_id', TX.userId); (data || []).forEach(c => { FC.creditos[c.venta_id] = c; }); } catch (_) {}
  }
}
// Una orden cuenta como facturada solo si su venta existe y no está anulada
const ventaActiva = o => { const v = o.venta_id && FC.ventas[o.venta_id]; return v && v.estado !== 'anulada' ? v : null; };
const porFacturar = () => FC.ordenes.filter(o => o.estado === 'entregada' && !ventaActiva(o) && Number(o.total) > 0);
const facturadas = () => FC.ordenes.filter(o => o.venta_id && FC.ventas[o.venta_id]);

function estadoCobro(v) {
  if (!v || v.estado === 'anulada') return { t: 'Venta anulada', clase: 'rojo', saldo: 0 };
  const c = FC.creditos[v.id];
  if (c) {
    const saldo = r2(c.saldo_pendiente);
    return saldo <= 0.005 || c.estado === 'pagado' || c.estado === 'cancelado' ? { t: 'Cobrado', clase: 'verde', saldo: 0 } : { t: `Por cobrar ${money(saldo)}`, clase: 'amarillo', saldo };
  }
  return { t: 'Cobrado (contado)', clase: 'verde', saldo: 0 };
}

function renderKpis() {
  const pf = porFacturar(), fa = facturadas().filter(o => ventaActiva(o)), mes = TX.hoyISO().slice(0, 7);
  const porCobrar = r2(fa.reduce((s, o) => s + estadoCobro(FC.ventas[o.venta_id]).saldo, 0));
  const facMes = fa.filter(o => String(o.facturada_en || '').slice(0, 7) === mes);
  $('fc-kpis').innerHTML = `
    <div class="tx-kpi"><span>Por facturar</span><b>${esc(money(r2(pf.reduce((s, o) => s + Number(o.total || 0), 0))))}</b><small>${pf.length} viaje(s) entregado(s)</small></div>
    <div class="tx-kpi"><span>Facturado este mes</span><b>${esc(money(r2(facMes.reduce((s, o) => s + Number(FC.ventas[o.venta_id].total || o.total || 0), 0))))}</b><small>${facMes.length} viaje(s)</small></div>
    <div class="tx-kpi"><span>Por cobrar</span><b>${esc(money(porCobrar))}</b><small>de viajes facturados a crédito</small></div>
    <div class="tx-kpi"><span>Viajes facturados</span><b>${fa.length}</b><small>en total</small></div>`;
}
function renderVista() {
  document.querySelectorAll('[data-fc-vista]').forEach(b => b.classList.toggle('on', b.dataset.fcVista === FC.vista));
  const el = $('fc-vista');
  if (FC.vista === 'pend') {
    const l = porFacturar();
    el.innerHTML = l.length ? l.map(o => {
      const anul = o.venta_id && FC.ventas[o.venta_id]?.estado === 'anulada';
      return `<div class="tx-doc"><div class="tx-doc-info"><b>📋 ${esc(o.numero)} · ${esc(o.cliente_nombre || 'Sin cliente')} · ${esc(money(o.total))}</b>
        <small>${esc(o.origen || '—')} → ${esc(o.destino || '—')} · entregada ${esc(TX.fmtFecha(o.entrega_real))}${anul ? ' · ⚠️ la venta anterior fue anulada' : ''}</small>
        ${o.subcontratada ? '<small>🤝 Viaje subcontratado</small>' : ''}</div>
        <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-primary tx-btn-sm" data-fc-facturar="${esc(o.id)}">🧾 Facturar</button></div></div>`;
    }).join('') : '<div class="tx-vacio"><div class="tx-vacio-i">✅</div><b>Nada por facturar</b><p>Cuando entregues una orden aparecerá aquí lista para convertirla en venta.</p></div>';
    return;
  }
  const l = facturadas();
  el.innerHTML = l.length ? l.map(o => {
    const v = FC.ventas[o.venta_id], e = estadoCobro(v);
    return `<div class="tx-doc"><div class="tx-doc-info"><b>🧾 ${esc(v.numero_venta || 'Venta')} · ${esc(o.numero)} · ${esc(o.cliente_nombre || v.cliente_nombre || '')}</b>
      <small>${esc(TX.fmtFecha(v.fecha_venta || v.created_at))} · total ${esc(money(v.total))}${Number(v.retencion_ir_monto) > 0 ? ' · retención IR ' + esc(money(v.retencion_ir_monto)) : ''}</small>
      <div class="tx-fila-chips"><span class="tx-chip ${e.clase}">${esc(e.t)}</span></div></div>
      <div class="tx-fila-chips"><a class="tx-btn tx-btn-sm" href="ventas.html">Ver en Ventas</a>${e.saldo > 0 ? '<a class="tx-btn tx-btn-sm tx-btn-primary" href="creditos.html">💵 Cobrar</a>' : ''}</div></div>`;
  }).join('') : '<div class="tx-vacio">Aún no has facturado ningún viaje.</div>';
}
function renderTodo() { renderKpis(); renderVista(); }

async function servicioFlete() {
  const { data: ex } = await sb.from('productos').select('id').eq('auth_user_id', TX.userId).eq('nombre', NOMBRE_SERVICIO).eq('tipo', 'servicio').limit(1);
  if (ex && ex.length) { await sb.from('productos').update({ activo: true }).eq('id', ex[0].id).eq('auth_user_id', TX.userId); return ex[0].id; }
  const { data, error } = await sb.from('productos').insert({
    auth_user_id: TX.userId, tipo: 'servicio', nombre: NOMBRE_SERVICIO, precio: 0, costo: 0, stock_actual: 0, activo: true,
  }).select().single();
  if (error) throw error;
  return data.id;
}
async function facturar(id) {
  const o = FC.ordenes.find(x => x.id === id); if (!o) return;
  try {
    const productoId = await servicioFlete();
    sessionStorage.setItem('n360_tx_cobro', JSON.stringify({
      ordenId: o.id, numero: o.numero, clienteId: o.cliente_id || null, productoId, monto: Number(o.total) || 0,
      concepto: `Flete ${o.numero}: ${o.origen || ''} → ${o.destino || ''}`,
    }));
    location.href = 'ventas.html';
  } catch (e) { console.error(e); TX.toast('No se pudo preparar la factura.', 'error'); }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-fc-vista],[data-fc-facturar]'); if (!t) return;
  if (t.dataset.fcVista) { FC.vista = t.dataset.fcVista; renderVista(); }
  else if (t.dataset.fcFacturar) facturar(t.dataset.fcFacturar);
});
window.FC = FC;
document.addEventListener('DOMContentLoaded', () => { TX.init(async () => { await cargarTodo(); renderTodo(); }); });
