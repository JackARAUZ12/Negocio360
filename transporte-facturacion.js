/* ============================================================
   TRANSPORTE-FACTURACION.JS — NEGOCIO360 (Transporte · Fase 9)
   Del viaje entregado a la venta y su cobranza.
   - "Facturar" abre aquí mismo la pantalla de Ventas (incrustada) con el
     cliente, el flete y los datos del viaje ya cargados (contado, crédito a
     fecha fija, retención de IR, Caja, bancos y Contabilidad los resuelve
     Ventas, sin duplicar lógica). La venta queda en Ventas como cualquier otra.
   - "Cobrar" abre el pago del crédito de Créditos, también incrustado.
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
      <div class="tx-fila-chips"><a class="tx-btn tx-btn-sm" href="ventas.html">Ver en Ventas</a>${e.saldo > 0 && FC.creditos[v.id] ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-fc-cobrar="${esc(FC.creditos[v.id].id)}">💵 Cobrar</button>` : ''}</div></div>`;
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
// Datos del viaje que quedan en Observaciones de la venta
function observacionesOrden(o) {
  const p = [`Viaje ${o.numero || ''}: ${o.origen || '—'} → ${o.destino || '—'}`];
  if (o.entrega_real) p.push(`entregado ${TX.fmtFecha(o.entrega_real)}`);
  if (o.receptor) p.push(`recibió ${o.receptor}`);
  if (o.carga_descripcion) p.push(`carga: ${o.carga_descripcion}`);
  return p.join(' · ');
}
// "Facturar": la venta se hace aquí mismo, con la pantalla real de Ventas
// incrustada (misma validación, Caja, bancos, IVA, retención IR, crédito y
// Contabilidad de siempre). Llega con el cliente, el flete y los datos del
// viaje cargados y parada en "Método de pago".
async function facturar(id) {
  const local = FC.ordenes.find(x => x.id === id); if (!local) return;
  try {
    // Se relee la orden: si otra pestaña ya la facturó, no se deja duplicar
    const { data: o, error } = await sb.from('transporte_ordenes').select('*').eq('id', id).eq('auth_user_id', TX.userId).maybeSingle();
    if (error) throw error;
    if (!o) { TX.toast('Esa orden ya no existe.', 'error'); return; }
    if (o.venta_id) {
      const { data: vPrev } = await sb.from('ventas').select('numero_venta, estado').eq('id', o.venta_id).eq('auth_user_id', TX.userId).maybeSingle();
      if (vPrev && vPrev.estado !== 'anulada') {
        TX.toast(`Este viaje ya está facturado (venta ${vPrev.numero_venta || ''}).`, 'warning');
        await cargarTodo(); renderTodo(); return;
      }
    }
    if (o.estado !== 'entregada' || !(Number(o.total) > 0)) { TX.toast('Solo se facturan viajes entregados con total mayor a cero.', 'warning'); return; }
    const productoId = await servicioFlete();
    sessionStorage.setItem('n360_tx_cobro', JSON.stringify({
      ordenId: o.id, numero: o.numero, clienteId: o.cliente_id || null, productoId, monto: Number(o.total) || 0,
      concepto: `Flete ${o.numero}: ${o.origen || ''} → ${o.destino || ''}`,
      auto: true, observaciones: observacionesOrden(o),
    }));
    abrirEmbebido('ventas.html?tx_factura=1&embed=1', `Facturar viaje ${o.numero || ''} · ${money(o.total)}`);
  } catch (e) { console.error(e); TX.toast('No se pudo preparar la factura.', 'error'); }
}
function cobrar(creditoId) {
  abrirEmbebido(`creditos.html?abrir_pago=${encodeURIComponent(creditoId)}&embed=1`, 'Registrar cobro del crédito');
}

// Ventana incrustada (mismo patrón que Rutas)
function abrirEmbebido(url, titulo) {
  $('fc-embed-titulo').textContent = titulo || '';
  const b = $('fc-embed-cerrar'); b.textContent = '✕ Cerrar sin registrar'; b.classList.remove('tx-btn-primary');
  $('fc-embed-frame').src = url;
  $('fc-modal-embebido').style.display = 'flex';
}
async function cerrarEmbebido() {
  $('fc-modal-embebido').style.display = 'none';
  $('fc-embed-frame').src = 'about:blank';
  sessionStorage.removeItem('n360_tx_cobro');
  try { await cargarTodo(); renderTodo(); } catch (e) { console.error(e); }
}
window.addEventListener('message', async ev => {
  if (ev.origin !== location.origin || !ev.data || ev.data.tipo !== 'n360_operacion_completada') return;
  if (ev.source !== $('fc-embed-frame').contentWindow) return;
  const d = ev.data;
  // Respaldo: si Ventas registró la venta pero no pudo ligar la orden, se liga aquí
  if (d.txOrdenId && d.ventaId && !d.txVinculada) {
    try { await sb.from('transporte_ordenes').update({ venta_id: d.ventaId, facturada_en: new Date().toISOString() }).eq('id', d.txOrdenId).eq('auth_user_id', TX.userId); }
    catch (e) { console.warn('Ligar orden a la venta:', e); }
  }
  TX.toast(`✅ ${d.nota || 'Operación registrada'}${d.monto ? ' — ' + money(d.monto) : ''}`, 'success');
  const b = $('fc-embed-cerrar'); b.textContent = '✓ Listo — cerrar'; b.classList.add('tx-btn-primary');
  try { await cargarTodo(); renderTodo(); } catch (e) { console.error(e); }
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-fc-vista],[data-fc-facturar],[data-fc-cobrar],#fc-embed-cerrar'); if (!t) return;
  if (t.id === 'fc-embed-cerrar') cerrarEmbebido();
  else if (t.dataset.fcVista) { FC.vista = t.dataset.fcVista; renderVista(); }
  else if (t.dataset.fcFacturar) facturar(t.dataset.fcFacturar);
  else if (t.dataset.fcCobrar) cobrar(t.dataset.fcCobrar);
});
window.FC = FC;
document.addEventListener('DOMContentLoaded', () => { TX.init(async () => { await cargarTodo(); renderTodo(); }); });
