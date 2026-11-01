/* =====================================================
   MENSAJERIA-CUADRE.JS — NEGOCIO360 · Mensajería: Cuadre de repartidores
   Para cada repartidor: entregas sin cuadrar, efectivo que debe
   entregar, lo pagado por transferencia y su deuda por faltantes.
   Al cuadrar (todo en el servidor, una sola vez por entrega):
    - las tarifas que pagó quien recibió -> venta normal (Ventas + Caja);
    - lo cobrado de productos -> dinero de los comercios (no es venta):
      queda "por liquidar";
    - faltante -> sale de Caja y queda como deuda del repartidor.
===================================================== */
'use strict';
const TC = { reps: [], pend: {}, ocupado: false };
const $c = id => document.getElementById(id);

TC.cargar = async function () {
  TC.reps = await msRepartidores(false);
  const res = await Promise.all(TC.reps.map(r => sb.rpc('msj_cuadre_pendiente', { p_repartidor: r.id }).then(x => x.data).catch(() => null)));
  TC.pend = {}; TC.reps.forEach((r, i) => { TC.pend[r.id] = res[i] && res[i].ok ? res[i] : { envios: [], esperado_cod: 0, esperado_envio: 0, transferencias: 0, transfer_envio: 0, transfer_cod: 0, deuda: 0 }; });
  TC.pintar(); TC.historial();
};
TC.pintar = function () {
  const lista = TC.reps.filter(r => r.activo || (TC.pend[r.id].envios || []).length || Number(TC.pend[r.id].deuda) > 0);
  if (!lista.length) { $c('c-reps').innerHTML = '<div class="tl-vacio" style="grid-column:1/-1">No hay repartidores. Regístralos en “Zonas, tarifas y repartidores”.</div>'; return; }
  lista.sort((a, b) => (TC.pend[b.id].envios.length - TC.pend[a.id].envios.length) || a.nombre.localeCompare(b.nombre));
  $c('c-reps').innerHTML = lista.map(r => {
    const p = TC.pend[r.id], esp = Number(p.esperado_cod) + Number(p.esperado_envio), n = p.envios.length;
    return `<div class="tl-card"><h3><span>${esc(r.nombre)}</span>${n ? `<span class="ms-chip por_recoger">${n} sin cuadrar</span>` : '<span class="ms-chip entregado">✔ Al día</span>'}</h3>
      <div class="ms-total"><span>Efectivo que debe entregar</span><b>${fmt(esp)}</b></div>
      ${Number(p.transferencias) > 0 ? `<div class="ms-total"><span>Pagado por transferencia</span><b>${fmt(p.transferencias)}</b></div>` : ''}
      ${Number(p.deuda) > 0 ? `<div class="ms-total" style="color:var(--danger)"><span>Debe de cuadres anteriores</span><b>${fmt(p.deuda)}</b></div>` : ''}
      <div class="tl-acc">${n ? `<button type="button" class="btn-primary" onclick="TC.abrir('${r.id}')">💵 Cuadrar</button>` : ''}
        ${Number(p.deuda) > 0 ? `<button type="button" class="btn-secondary" onclick="TC.abono('${r.id}')">➕ Registrar abono</button>` : ''}</div></div>`;
  }).join('');
};
TC.abrir = async function (id) {
  const r = TC.reps.find(x => x.id === id), p = TC.pend[id]; if (!r || !p) return;
  await msBancos();
  const cod = Number(p.esperado_cod), env = Number(p.esperado_envio), esp = cod + env, trEnv = Number(p.transfer_envio || 0), trCod = Number(p.transfer_cod || 0);
  const cuerpo = `<div style="overflow-x:auto"><table class="tl-tabla"><thead><tr><th>Guía</th><th>Recibió</th><th>Cómo pagó</th><th class="tl-num">Producto</th><th class="tl-num">Envío</th></tr></thead><tbody>
      ${p.envios.map(e => `<tr><td data-t="Guía"><span class="ms-num">${esc(e.numero)}</span></td><td data-t="Destinatario">${esc(e.destinatario)}</td>
        <td data-t="Cómo pagó">${e.metodo === 'efectivo' ? '💵 Efectivo' : e.metodo === 'transferencia' ? '🏦 Transferencia' : '— Sin cobro'}</td>
        <td data-t="Producto" class="tl-num">${fmt(e.cod)}</td><td data-t="Envío" class="tl-num">${fmt(e.envio)}</td></tr>`).join('')}</tbody></table></div>
    <div class="tl-sec">
      <div class="ms-total"><span>💵 Efectivo de envíos <span class="tl-muted">(tuyo: entra a Caja como venta)</span></span><b>${fmt(env)}</b></div>
      <div class="ms-total"><span>📦 Efectivo de productos <span class="tl-muted">(de los comercios: queda por liquidar)</span></span><b>${fmt(cod)}</b></div>
      <div class="ms-total grande"><span>Debe entregar</span><b>${fmt(esp)}</b></div>
      ${trEnv + trCod > 0 ? `<div class="tl-muted">🏦 Por transferencia: ${trEnv > 0 ? fmt(trEnv) + ' de envíos (entra al banco como venta)' : ''}${trEnv > 0 && trCod > 0 ? ' y ' : ''}${trCod > 0 ? fmt(trCod) + ' de productos (de los comercios)' : ''}. Ese dinero no lo trae el repartidor.</div>` : ''}
    </div>
    ${trEnv > 0 ? msMetodoHTML('cq-tr', '🏦 ¿A qué banco entraron las transferencias de envíos?', { inicial: 'transferencia' }) : ''}
    <div class="tl-f"><label for="cq-ent">¿Cuánto efectivo entregó? *</label><input class="tl-inp" id="cq-ent" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" style="font-size:18px;font-weight:800"></div>
    <div id="cq-dif"></div>
    <div class="tl-f"><label for="cq-notas">Notas</label><input class="tl-inp" id="cq-notas" maxlength="500" autocomplete="off"></div><div id="cq-av"></div>`;
  const m = msVentana('cq-modal', `💵 Cuadre de ${esc(r.nombre)}`, cuerpo, '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="cq-ok">Registrar cuadre</button>', 700);
  msMetodoActivar(m);
  const trSel = m.querySelector('.ms-metodo[data-metodo="cq-tr"]'); if (trSel) trSel.querySelector('.ms-opciones').style.display = 'none';
  const dif = () => {
    const v = m.querySelector('#cq-ent').value; if (v === '') { m.querySelector('#cq-dif').innerHTML = ''; return; }
    const d = Math.round((Number(v) - esp) * 100) / 100;
    m.querySelector('#cq-dif').innerHTML = d === 0 ? '<div class="ms-dif ok">✔ Cuadra exacto</div>' : d < 0 ? `<div class="ms-dif mal">Faltan ${fmt(-d)}: salen de Caja y quedan como deuda del repartidor</div>` : `<div class="ms-dif mas">Sobran ${fmt(d)}: entran a Caja como sobrante</div>`;
  };
  m.querySelector('#cq-ent').oninput = dif;
  m.querySelector('#cq-ok').onclick = async () => {
    if (TC.ocupado) return;
    const v = m.querySelector('#cq-ent').value.trim(), av = m.querySelector('#cq-av');
    if (v === '' || !(Number(v) >= 0)) { av.innerHTML = '<div class="tl-aviso">Escribe cuánto efectivo entregó (puede ser 0).</div>'; return; }
    const banco = trEnv > 0 ? msMetodoLeer(m, 'cq-tr').banco_id : null;
    if (trEnv > 0 && !banco) { av.innerHTML = `<div class="tl-aviso">${MS_MOTIVOS.banco_transfer}</div>`; return; }
    const d = Math.round((Number(v) - esp) * 100) / 100;
    if (d !== 0 && !confirm(d < 0 ? `Faltan ${fmt(-d)}. Quedarán como deuda de ${r.nombre}. ¿Registrar el cuadre?` : `Sobran ${fmt(d)}. ¿Registrar el cuadre así?`)) return;
    TC.ocupado = true; const btn = m.querySelector('#cq-ok'); btn.disabled = true;
    const x = await msRpc('msj_cuadre_cerrar', { p: { repartidor_id: id, envio_ids: p.envios.map(e => e.id), entregado: Number(v), banco_id: banco, notas: m.querySelector('#cq-notas').value.trim() || null, por: msPor() } });
    TC.ocupado = false; btn.disabled = false;
    if (!x.ok) { av.innerHTML = `<div class="tl-aviso">${esc(x.msg)}</div>`; if (x.motivo === 'cambiaron') TC.cargar(); return; }
    m.classList.remove('abierto');
    const ventas = [x.venta_efectivo, x.venta_transferencia].filter(Boolean);
    msVentana('cq-listo', `✅ Cuadre ${esc(x.numero)} registrado`, `
      ${ventas.length ? ventas.map(vv => `<div class="ms-total"><span>🧾 Venta ${esc(vv.numero)} (envíos)</span><b>${fmt(vv.total)}</b></div>`).join('') : '<div class="tl-muted">No había tarifas cobradas por el repartidor.</div>'}
      ${Number(x.por_liquidar) > 0 ? `<div class="ms-total"><span>📦 Dinero de comercios por liquidar</span><b>${fmt(x.por_liquidar)}</b></div>` : ''}
      ${Number(x.diferencia) < 0 ? `<div class="ms-dif mal">Faltaron ${fmt(-x.diferencia)}: quedan como deuda de ${esc(r.nombre)}</div>` : Number(x.diferencia) > 0 ? `<div class="ms-dif mas">Sobraron ${fmt(x.diferencia)}</div>` : '<div class="ms-dif ok">✔ Cuadró exacto</div>'}
      <div class="tl-muted">Guarda aparte el dinero de los comercios: se les entrega en “Liquidar comercios”.</div>`,
      '<button type="button" class="btn-primary" data-cerrar>Listo</button>', 480);
    TC.cargar();
  };
  setTimeout(() => { const i = m.querySelector('#cq-ent'); if (i && !m.contains(document.activeElement)) i.focus(); }, 60);
};
TC.abono = async function (id) {
  const r = TC.reps.find(x => x.id === id), deuda = Number(TC.pend[id]?.deuda || 0); if (!r) return;
  await msBancos();
  const m = msVentana('ab-modal', `➕ Abono de ${esc(r.nombre)}`, `<div class="ms-total grande"><span>Debe</span><b>${fmt(deuda)}</b></div>
    <div class="tl-f"><label for="ab-monto">Monto que abona *</label><input class="tl-inp" id="ab-monto" type="number" inputmode="decimal" min="0.01" step="0.01" max="${deuda}"></div>
    ${msMetodoHTML('ab', '¿Cómo lo pagó?')}
    <div class="tl-f"><label for="ab-notas">Notas</label><input class="tl-inp" id="ab-notas" maxlength="500" autocomplete="off"></div><div id="ab-av"></div>`,
    '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="ab-ok">Registrar abono</button>', 460);
  msMetodoActivar(m);
  m.querySelector('#ab-ok').onclick = async () => {
    if (TC.ocupado) return;
    const v = Number(m.querySelector('#ab-monto').value || 0), av = m.querySelector('#ab-av'), met = msMetodoLeer(m, 'ab');
    if (!(v > 0)) { av.innerHTML = '<div class="tl-aviso">Escribe el monto del abono.</div>'; return; }
    if (v > deuda + 0.001) { av.innerHTML = `<div class="tl-aviso">El abono no puede ser mayor que lo que debe (${fmt(deuda)}).</div>`; return; }
    if (met.metodo === 'transferencia' && !met.banco_id) { av.innerHTML = `<div class="tl-aviso">${MS_MOTIVOS.banco}</div>`; return; }
    TC.ocupado = true;
    const x = await msRpc('msj_abono_cobrar', { p: { repartidor_id: id, monto: v, metodo: met.metodo, banco_id: met.banco_id, notas: m.querySelector('#ab-notas').value.trim() || null, por: msPor() } });
    TC.ocupado = false;
    if (!x.ok) { av.innerHTML = `<div class="tl-aviso">${esc(x.msg)}</div>`; return; }
    m.classList.remove('abierto'); showToast(`✅ Abono ${x.numero} registrado (entró a Caja) · debe ${fmt(x.deuda)}`); TC.cargar();
  };
};
TC.historial = async function () {
  const { data } = await sb.from('mensajeria_cuadres').select('*').eq('auth_user_id', TL.userId).order('created_at', { ascending: false }).limit(50);
  const nom = id => TC.reps.find(r => r.id === id)?.nombre || '—';
  $c('c-hist').querySelector('tbody').innerHTML = (data || []).map(q => `<tr><td data-t="Número"><span class="ms-num">${esc(q.numero)}</span></td><td data-t="Fecha">${tlFechaHora(q.created_at)}</td>
      <td data-t="Repartidor">${esc(nom(q.repartidor_id))}</td><td data-t="Tipo">${q.tipo === 'abono' ? '➕ Abono' : `💵 Cuadre · ${q.envios} entrega${q.envios === 1 ? '' : 's'}`}</td>
      <td data-t="Debía" class="tl-num">${q.tipo === 'abono' ? '—' : fmt(q.esperado)}</td><td data-t="Entregó" class="tl-num">${fmt(q.entregado)}</td>
      <td data-t="Diferencia" class="tl-num" style="color:${Number(q.diferencia) < 0 ? 'var(--danger)' : Number(q.diferencia) > 0 && q.tipo === 'cuadre' ? 'var(--warning)' : 'inherit'};font-weight:700">${q.tipo === 'abono' ? '−' + fmt(q.entregado) + ' de deuda' : fmt(q.diferencia)}</td>
      <td data-t="Por">${esc(q.por || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="tl-vacio">Aún no hay cuadres.</td></tr>';
};

window.tallerListo = async function () { await TC.cargar(); };
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('.tl-modal.abierto').forEach(m => m.classList.remove('abierto')); });
