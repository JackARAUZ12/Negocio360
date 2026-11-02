/* =====================================================
   MENSAJERIA-PAGOS.JS — NEGOCIO360 · Mensajería: Pago a repartidores
   Repartidores que cobran por entrega o por porcentaje de la tarifa:
   cuánto ganaron (entregas aún sin pagar), su deuda de cuadres y el
   pago. El pago queda como gasto (Gastos + Caja); lo que se descuenta
   de su deuda vuelve a entrar como abono. Todo en el servidor.
===================================================== */
'use strict';
const TP = { reps: [], pend: {}, ocupado: false };
const $p = id => document.getElementById(id);
const TP_FORMA = r => r.pago_tipo === 'por_entrega' ? `${fmt(r.pago_valor)} por entrega` : r.pago_tipo === 'porcentaje' ? `${Number(r.pago_valor)}% de la tarifa` : 'Sin forma de pago';

TP.cargar = async function () {
  TP.reps = (await msRepartidores(false)).filter(r => r.activo || r.pago_tipo !== 'ninguno');
  const con = TP.reps.filter(r => r.pago_tipo !== 'ninguno');
  const res = await Promise.all(con.map(r => sb.rpc('msj_pago_pendiente', { p_repartidor: r.id }).then(x => x.data).catch(() => null)));
  TP.pend = {}; con.forEach((r, i) => { TP.pend[r.id] = res[i] && res[i].ok ? res[i] : { envios: [], total: 0, deuda: 0 }; });
  TP.pintar(); TP.historial();
};
TP.pintar = function () {
  if (!TP.reps.length) { $p('p-lista').innerHTML = '<div class="tl-vacio" style="grid-column:1/-1">No hay repartidores.</div>'; return; }
  const orden = [...TP.reps].sort((a, b) => (Number(TP.pend[b.id]?.total || 0) - Number(TP.pend[a.id]?.total || 0)) || a.nombre.localeCompare(b.nombre));
  $p('p-lista').innerHTML = orden.map(r => {
    if (r.pago_tipo === 'ninguno') return `<div class="tl-card" style="opacity:.75"><h3><span>${esc(r.nombre)}</span><span class="ms-chip">Sin forma de pago</span></h3>
      <div class="tl-muted">Si se le paga por entrega o por porcentaje, configúralo en Repartidores. Si tiene sueldo fijo, se paga en Salarios.</div>
      <div class="tl-acc"><button type="button" class="btn-secondary" onclick="(window.parent!==window&&window.parent.tpIr)?window.parent.tpIr('mensajeria-ajustes.html?tab=repartidores'):location.href='mensajeria-ajustes.html?tab=repartidores'">⚙️ Configurar</button></div></div>`;
    const p = TP.pend[r.id], n = p.envios.length;
    return `<div class="tl-card"><h3><span>${esc(r.nombre)}</span><span class="ms-chip">${esc(TP_FORMA(r))}</span></h3>
      <div class="ms-total"><span>Entregas por pagar</span><b>${n}</b></div>
      <div class="ms-total grande"><span>Ganó</span><b>${fmt(p.total)}</b></div>
      ${Number(p.deuda) > 0 ? `<div class="ms-total" style="color:var(--danger)"><span>Debe de cuadres</span><b>${fmt(p.deuda)}</b></div>` : ''}
      <div class="tl-acc">${n ? `<button type="button" class="btn-primary" onclick="TP.abrir('${r.id}')">💼 Pagar</button>` : '<span class="ms-chip entregado">✔ Al día</span>'}</div></div>`;
  }).join('');
};
TP.abrir = async function (id) {
  const r = TP.reps.find(x => x.id === id), p = TP.pend[id]; if (!r || !p) return;
  await msBancos();
  const total = Number(p.total), deuda = Number(p.deuda), maxDesc = Math.min(deuda, total);
  const m = msVentana('p-modal', `💼 Pagar a ${esc(r.nombre)}`, `
    <div style="overflow-x:auto;max-height:260px"><table class="tl-tabla"><thead><tr><th>Guía</th><th>Para</th><th>Entregado</th><th class="tl-num">Gana</th></tr></thead><tbody>
      ${p.envios.map(e => `<tr><td data-t="Guía"><span class="ms-num">${esc(e.numero)}</span></td><td data-t="Para">${esc(e.destinatario)}</td><td data-t="Entregado">${tlFecha(e.entregado_at)}</td><td data-t="Gana" class="tl-num">${fmt(e.monto)}</td></tr>`).join('')}</tbody></table></div>
    <div class="tl-sec"><div class="ms-total"><span>Ganó (${esc(TP_FORMA(r))})</span><b>${fmt(total)}</b></div>
      ${deuda > 0 ? `<label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" class="ms-sel" id="p-desc-chk" checked> Descontar su deuda (${fmt(deuda)})</label>
        <div class="tl-f"><label for="p-desc">Monto a descontar</label><input class="tl-inp" id="p-desc" type="number" inputmode="decimal" min="0" max="${maxDesc}" step="0.01" value="${maxDesc}"></div>` : ''}
      <div class="ms-total grande"><span>Se le entrega</span><b id="p-neto">${fmt(total - (deuda > 0 ? maxDesc : 0))}</b></div></div>
    ${msMetodoHTML('p-met', '¿Cómo le pagas?')}
    <div class="tl-f"><label for="p-notas">Notas</label><input class="tl-inp" id="p-notas" maxlength="500" autocomplete="off"></div><div id="p-av"></div>`,
    '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="p-ok">Registrar pago</button>', 640);
  msMetodoActivar(m);
  const desc = () => { const chk = m.querySelector('#p-desc-chk'); if (!chk) return 0; m.querySelector('#p-desc').disabled = !chk.checked; return chk.checked ? Number(m.querySelector('#p-desc').value || 0) : 0; };
  const neto = () => { m.querySelector('#p-neto').textContent = fmt(Math.max(0, total - desc())); };
  m.querySelectorAll('#p-desc,#p-desc-chk').forEach(x => x.oninput = x.onchange = neto);
  m.querySelector('#p-ok').onclick = async () => {
    if (TP.ocupado) return;
    const d = Math.round(desc() * 100) / 100, met = msMetodoLeer(m, 'p-met'), av = m.querySelector('#p-av');
    if (d < 0 || d > maxDesc + 0.001) { av.innerHTML = `<div class="tl-aviso">Lo que se descuenta no puede pasar de ${fmt(maxDesc)}.</div>`; return; }
    if (met.metodo === 'transferencia' && !met.banco_id) { av.innerHTML = `<div class="tl-aviso">${MS_MOTIVOS.banco}</div>`; return; }
    TP.ocupado = true; const btn = m.querySelector('#p-ok'); btn.disabled = true;
    const x = await msRpc('msj_pago_registrar', { p: { repartidor_id: id, envio_ids: p.envios.map(e => e.id), descontar_deuda: d, metodo: met.metodo, banco_id: met.banco_id,
      notas: m.querySelector('#p-notas').value.trim() || null, por: msPor() } });
    TP.ocupado = false; btn.disabled = false;
    if (!x.ok) { av.innerHTML = `<div class="tl-aviso">${esc(x.msg)}</div>`; if (x.motivo === 'cambiaron') { m.classList.remove('abierto'); TP.cargar(); } return; }
    m.classList.remove('abierto'); showToast(`✅ Pago ${x.numero}: se le entregan ${fmt(x.neto)}${Number(x.descuento) > 0 ? ' (descontados ' + fmt(x.descuento) + ' de su deuda)' : ''}`);
    TP.cargar();
  };
};
TP.historial = async function () {
  const { data } = await sb.from('mensajeria_pagos').select('*').eq('auth_user_id', TL.userId).order('created_at', { ascending: false }).limit(50);
  const nom = id => TP.reps.find(r => r.id === id)?.nombre || '—';
  $p('p-hist').querySelector('tbody').innerHTML = (data || []).map(q => `<tr><td data-t="Número"><span class="ms-num">${esc(q.numero)}</span></td><td data-t="Fecha">${tlFechaHora(q.created_at)}</td>
    <td data-t="Repartidor">${esc(nom(q.repartidor_id))}</td><td data-t="Entregas" class="tl-num">${q.envios}</td><td data-t="Ganó" class="tl-num">${fmt(q.monto)}</td>
    <td data-t="Descuento" class="tl-num">${Number(q.descuento_deuda) ? fmt(q.descuento_deuda) : '—'}</td><td data-t="Se le pagó" class="tl-num" style="font-weight:700">${fmt(q.neto_pagado)}</td></tr>`).join('')
    || '<tr><td colspan="7" class="tl-vacio">Aún no hay pagos.</td></tr>';
};

window.tallerListo = async function () { await TP.cargar(); };
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('.tl-modal.abierto').forEach(m => m.classList.remove('abierto')); });
