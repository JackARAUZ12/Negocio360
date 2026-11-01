/* =====================================================
   MENSAJERIA-LIQUIDACIONES.JS — NEGOCIO360 · Mensajería: Liquidar comercios
   Cada comercio: lo cobrado a su nombre (su dinero), tus tarifas y el
   neto. Al liquidar (todo en el servidor, una sola vez por envío):
    - tus tarifas -> venta normal al comercio (Ventas + Caja);
    - su dinero -> se le entrega (no es ganancia: no toca Caja).
   Estado de cuenta para imprimir y aviso por WhatsApp.
===================================================== */
'use strict';
const TQ = { comercios: [], hist: [], ocupado: false };
const $q = id => document.getElementById(id);

TQ.cargar = async function () {
  const [r, h] = await Promise.all([
    sb.rpc('msj_liquidaciones_resumen').then(x => x.data).catch(() => null),
    sb.from('mensajeria_liquidaciones').select('*').eq('auth_user_id', TL.userId).order('created_at', { ascending: false }).limit(50),
  ]);
  TQ.comercios = (r && r.ok ? r.comercios : []) || []; TQ.hist = h.data || [];
  TQ.pintar(); TQ.pintarHist();
};
TQ.pintar = function () {
  const listos = TQ.comercios.filter(c => Number(c.listos) > 0);
  const debes = listos.reduce((a, c) => a + Math.max(0, Number(c.cod) - Number(c.tarifas)), 0);
  const tuyas = listos.reduce((a, c) => a + Number(c.tarifas), 0);
  const calle = TQ.comercios.reduce((a, c) => a + Number(c.en_calle || 0), 0);
  $q('q-res').innerHTML = `<div><b>${fmt(debes)}</b><span>les debes a comercios (listo para liquidar)</span></div>
    <div><b>${fmt(tuyas)}</b><span>tus tarifas por cobrarles</span></div>
    <div><b>${fmt(calle)}</b><span>cobrado y aún con el repartidor (falta cuadrar)</span></div>`;
  if (!TQ.comercios.length) { $q('q-lista').innerHTML = '<div class="tl-vacio" style="grid-column:1/-1">No hay comercios con envíos pendientes de liquidar. 👍</div>'; return; }
  const orden = [...TQ.comercios].sort((a, b) => (Number(b.listos) > 0) - (Number(a.listos) > 0) || a.nombre.localeCompare(b.nombre));
  $q('q-lista').innerHTML = orden.map(c => {
    const neto = Number(c.cod) - Number(c.tarifas), listos = Number(c.listos);
    return `<div class="tl-card"><h3><span>${esc(c.nombre)}</span>${listos ? `<span class="ms-chip por_recoger">${listos} listo${listos === 1 ? '' : 's'}</span>` : '<span class="ms-chip">En proceso</span>'}</h3>
      ${listos ? `<div class="ms-total"><span>Cobrado a su nombre</span><b>${fmt(c.cod)}</b></div>
      <div class="ms-total"><span>Tus tarifas</span><b>− ${fmt(c.tarifas)}</b></div>
      <div class="ms-total grande"><span>${neto >= 0 ? 'Le pagas' : 'Te paga'}</span><b style="color:${neto >= 0 ? 'var(--text-primary)' : 'var(--success)'}">${fmt(Math.abs(neto))}</b></div>` : ''}
      ${Number(c.en_proceso) ? `<div class="tl-muted">📦 ${c.en_proceso} envío${Number(c.en_proceso) === 1 ? '' : 's'} todavía en camino o sin cuadrar${Number(c.en_calle) > 0 ? ' (' + fmt(c.en_calle) + ' con el repartidor)' : ''}.</div>` : ''}
      <div class="tl-acc">${listos ? `<button type="button" class="btn-primary" onclick="TQ.abrir('${c.comercio_id}')">🤝 Liquidar</button>` : ''}</div></div>`;
  }).join('');
};
TQ.abrir = async function (comId) {
  const c = TQ.comercios.find(x => x.comercio_id === comId); if (!c) return;
  await msBancos();
  const m = msVentana('q-modal', `🤝 Liquidar a ${esc(c.nombre)}`, '<div class="section-loading"><div class="mini-spinner"></div></div>', '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="q-ok" disabled>Registrar liquidación</button>', 720);
  const { data: d } = await sb.rpc('msj_liquidacion_pendiente', { p_comercio: comId });
  if (!d || !d.ok) { m.querySelector('.tl-modal-cuerpo').innerHTML = `<div class="tl-aviso">${esc(msMensaje(d))}</div>`; return; }
  const cod = Number(d.cod), tar = Number(d.tarifas), neto = Math.round((cod - tar) * 100) / 100;
  m.querySelector('.tl-modal-cuerpo').innerHTML = `
    <div style="overflow-x:auto"><table class="tl-tabla"><thead><tr><th>Guía</th><th>Para</th><th>Estado</th><th class="tl-num">Cobrado</th><th class="tl-num">Tarifa</th></tr></thead><tbody>
      ${d.envios.map(e => `<tr><td data-t="Guía"><span class="ms-num">${esc(e.numero)}</span></td><td data-t="Para">${esc(e.destinatario)}</td><td data-t="Estado">${msChip(e.estado)}</td>
        <td data-t="Cobrado" class="tl-num">${fmt(e.cod)}</td><td data-t="Tarifa" class="tl-num">${Number(e.tarifa) ? fmt(e.tarifa) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="tl-sec">
      <div class="ms-total"><span>📦 Cobrado a su nombre (su dinero)</span><b>${fmt(cod)}</b></div>
      <div class="ms-total"><span>🧾 Tus tarifas de envío</span><b>− ${fmt(tar)}</b></div>
      <div class="ms-total grande"><span>${neto > 0 ? 'Le pagas' : neto < 0 ? 'Te paga' : 'Queda en cero'}</span><b>${fmt(Math.abs(neto))}</b></div>
    </div>
    ${tar > 0 ? msMetodoHTML('q-tar', `🧾 Tus tarifas (${fmt(tar)}) entran a Caja como venta. ¿Dónde queda ese dinero?`) : ''}
    ${neto !== 0 ? msMetodoHTML('q-pago', neto > 0 ? `💸 ¿Cómo le pagas los ${fmt(neto)}?` : `💰 ¿Cómo te paga los ${fmt(-neto)}?`) : ''}
    <div class="tl-f"><label for="q-notas">Notas</label><input class="tl-inp" id="q-notas" maxlength="500" autocomplete="off"></div><div id="q-av"></div>`;
  msMetodoActivar(m);
  const ok = m.querySelector('#q-ok'); ok.disabled = false;
  ok.onclick = async () => {
    if (TQ.ocupado) return;
    const av = m.querySelector('#q-av'), t = msMetodoLeer(m, 'q-tar'), pg = msMetodoLeer(m, 'q-pago');
    if (tar > 0 && t.metodo === 'transferencia' && !t.banco_id) { av.innerHTML = `<div class="tl-aviso">${MS_MOTIVOS.banco}</div>`; return; }
    if (!confirm(`¿Registrar la liquidación de ${c.nombre}? ${neto > 0 ? 'Le pagas ' + fmt(neto) : neto < 0 ? 'Te paga ' + fmt(-neto) : 'Queda en cero'}.`)) return;
    TQ.ocupado = true; ok.disabled = true;
    const x = await msRpc('msj_liquidacion_registrar', { p: { comercio_id: comId, envio_ids: d.envios.map(e => e.id), tarifas_metodo: t.metodo, tarifas_banco_id: t.banco_id,
      pago_metodo: pg.metodo, pago_banco_id: pg.banco_id, notas: m.querySelector('#q-notas').value.trim() || null, por: msPor() } });
    TQ.ocupado = false; ok.disabled = false;
    if (!x.ok) { av.innerHTML = `<div class="tl-aviso">${esc(x.msg)}</div>`; if (x.motivo === 'cambiaron') { m.classList.remove('abierto'); TQ.cargar(); } return; }
    m.classList.remove('abierto');
    const msg = `Hola ${c.nombre}, le saluda ${TL.empresaConfig?.nombre_comercial || ''}. Liquidación ${x.numero}: ${d.envios.length} envío${d.envios.length === 1 ? '' : 's'}, cobrado a su nombre ${fmt(x.cod)}, tarifas ${fmt(x.tarifas)}. ${Number(x.neto) >= 0 ? 'Le entregamos ' + fmt(x.neto) : 'Saldo a nuestro favor: ' + fmt(-x.neto)}. ¡Gracias!`;
    const wa = msWa(c.telefono, msg);
    msVentana('q-listo', `✅ Liquidación ${esc(x.numero)} registrada`, `
      ${x.venta ? `<div class="ms-total"><span>🧾 Venta ${esc(x.venta.numero)} (tus tarifas)</span><b>${fmt(x.venta.total)}</b></div>` : ''}
      <div class="ms-total grande"><span>${Number(x.neto) >= 0 ? 'Le pagas' : 'Te paga'}</span><b>${fmt(Math.abs(x.neto))}</b></div>
      <div class="tl-muted">Imprime o envía el estado de cuenta para que el comercio vea el detalle.</div>`,
      `<button type="button" class="btn-secondary" data-cerrar>Listo</button>${wa ? `<a class="btn-secondary" style="text-decoration:none" target="_blank" rel="noopener" href="${esc(wa)}">💬 WhatsApp</a>` : ''}<button type="button" class="btn-primary" onclick="TQ.imprimir('${x.id}')">🖨️ Estado de cuenta</button>`, 480);
    TQ.cargar();
  };
};
TQ.imprimir = async function (liqId) {
  const [{ data: q }, { data: envs }] = await Promise.all([
    sb.from('mensajeria_liquidaciones').select('*').eq('id', liqId).maybeSingle(),
    sb.from('mensajeria_envios').select('numero,destinatario_nombre,direccion,estado,cobrado_cod,tarifa,recargo_reintentos,envio_lo_paga,tarifa_venta_id,entregado_at,updated_at').eq('liquidacion_id', liqId).order('numero'),
  ]);
  if (!q) return;
  const filas = (envs || []).map(e => {
    const cobrado = e.estado === 'entregado' ? Number(e.cobrado_cod) : 0;
    return `<tr><td>${esc(e.numero)}</td><td>${esc(e.destinatario_nombre)}<div class="muted">${esc(e.direccion)}</div></td><td>${esc((MS_ESTADOS[e.estado] || {}).t || e.estado)}</td><td class="n">${esc(fmt(cobrado))}</td></tr>`;
  }).join('');
  msImprimir(`Liquidación ${q.numero}`, `<h1>${esc(TL.empresaConfig?.nombre_comercial || '')}</h1><div class="muted">Estado de cuenta · Liquidación ${esc(q.numero)} · ${esc(tlFechaHora(q.created_at))}</div>
    <h2>Comercio: ${esc(q.comercio_nombre || '')}</h2>
    <table><thead><tr><th>Guía</th><th>Para</th><th>Estado</th><th class="n">Cobrado</th></tr></thead><tbody>${filas}</tbody>
      <tfoot><tr class="tot"><td colspan="3">Cobrado a su nombre</td><td class="n">${esc(fmt(q.cod_total))}</td></tr>
      <tr><td colspan="3">Menos tarifas de envío</td><td class="n">− ${esc(fmt(q.tarifas_total))}</td></tr></tfoot></table>
    <div class="caja">${Number(q.neto) >= 0 ? 'Le entregamos' : 'Saldo a nuestro favor'}: ${esc(fmt(Math.abs(q.neto)))}${q.pago_metodo ? ' · ' + (q.pago_metodo === 'efectivo' ? 'efectivo' : 'transferencia') : ''}</div>
    <p class="muted">${q.envios} envío${q.envios === 1 ? '' : 's'}${q.notas ? ' · ' + esc(q.notas) : ''}${q.por ? ' · Registró: ' + esc(q.por) : ''}</p>
    <p style="margin-top:40px">______________________<br><span class="muted">Recibí conforme</span></p>`);
};
TQ.pintarHist = function () {
  $q('q-hist').querySelector('tbody').innerHTML = TQ.hist.map(q => `<tr><td data-t="Número"><span class="ms-num">${esc(q.numero)}</span></td><td data-t="Fecha">${tlFechaHora(q.created_at)}</td>
    <td data-t="Comercio">${esc(q.comercio_nombre || '')}</td><td data-t="Cobrado" class="tl-num">${fmt(q.cod_total)}</td><td data-t="Tarifas" class="tl-num">${fmt(q.tarifas_total)}</td>
    <td data-t="Neto" class="tl-num" style="font-weight:700">${Number(q.neto) >= 0 ? 'Le pagaste ' : 'Te pagó '}${fmt(Math.abs(q.neto))}</td>
    <td class="tl-ac"><button type="button" class="btn-secondary tln-btn-sm" onclick="TQ.imprimir('${q.id}')">🖨️ Ver</button></td></tr>`).join('') || '<tr><td colspan="7" class="tl-vacio">Aún no hay liquidaciones.</td></tr>';
};

window.tallerListo = async function () { await TQ.cargar(); };
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('.tl-modal.abierto').forEach(m => m.classList.remove('abierto')); });
