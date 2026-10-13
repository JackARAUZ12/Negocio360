/* ============================================================
   TRANSPORTE-SUBCONTRATISTAS.JS — NEGOCIO360 (Transporte · Fase 8)
   Transportistas externos: subcontratar el viaje de una orden.
   - De contado: Gasto + salida de Caja (neto de retención de IR) + retención por pagar.
   - A crédito: Cuenta por Pagar (fecha fija, costo de servicio); la retención de IR
     se aplica al pagar desde Cuentas por Pagar.
   - El costo suma a la rentabilidad de la orden (Órdenes de transporte).
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, num } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const SC = { vista: 'viajes', subs: [], viajes: [], ordenes: [], metodos: [], bancos: [], cxp: [], editId: null };

async function cargarTodo() {
  const [subs, viajes, ordenes] = await Promise.all([
    TX.paginar(() => sb.from('transporte_subcontratistas').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_subcontrataciones').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.paginar(() => sb.from('transporte_ordenes').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
  ]);
  SC.subs = subs; SC.viajes = viajes; SC.ordenes = ordenes;
  SC.comp = await TX.cargarComprobantes();
  try { const { data } = await sb.from('metodos_pago').select('*').eq('auth_user_id', TX.userId).eq('activo', true).order('orden'); SC.metodos = data || []; } catch (_) { SC.metodos = []; }
  try { const { data } = await sb.from('bancos').select('id,nombre').eq('auth_user_id', TX.userId).eq('activo', true).order('nombre'); SC.bancos = data || []; } catch (_) { SC.bancos = []; }
  const ids = SC.viajes.map(v => v.cuenta_pagar_id).filter(Boolean);
  SC.cxp = [];
  if (ids.length) { try { const { data } = await sb.from('cuentas_por_pagar').select('id,numero,monto_total,monto_pagado,saldo_pendiente,estado,fecha_vencimiento').in('id', ids).eq('auth_user_id', TX.userId); SC.cxp = data || []; } catch (_) { SC.cxp = []; } }
}

const subDe = id => SC.subs.find(s => s.id === id);
const ordDe = id => SC.ordenes.find(o => o.id === id);
const cxpDe = id => SC.cxp.find(c => c.id === id);
const activos = () => SC.viajes.filter(v => v.estado === 'activa');

/* ---------------- Pintado ---------------- */
function renderKpis() {
  const a = activos(), mes = TX.hoyISO().slice(0, 7);
  const delMes = a.filter(v => String(v.fecha).slice(0, 7) === mes);
  const porPagar = r2(a.filter(v => v.cuenta_pagar_id).reduce((s, v) => s + Number(cxpDe(v.cuenta_pagar_id)?.saldo_pendiente || 0), 0));
  $('sc-kpis').innerHTML = `
    <div class="tx-kpi"><span>Subcontratado este mes</span><b>${esc(money(r2(delMes.reduce((s, v) => s + Number(v.monto || 0), 0))))}</b><small>${delMes.length} viaje(s)</small></div>
    <div class="tx-kpi"><span>Por pagar a transportistas</span><b>${esc(money(porPagar))}</b><small>en Cuentas por Pagar</small></div>
    <div class="tx-kpi"><span>Viajes subcontratados</span><b>${a.length}</b><small>${SC.viajes.length - a.length} anulado(s)</small></div>
    <div class="tx-kpi"><span>Transportistas</span><b>${SC.subs.filter(s => s.activo).length}</b><small>activos</small></div>`;
}
function renderVista() {
  document.querySelectorAll('[data-sc-vista]').forEach(b => b.classList.toggle('on', b.dataset.scVista === SC.vista));
  const el = $('sc-vista');
  if (SC.vista === 'lista') {
    el.innerHTML = `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-primary" data-sc-nuevo-sub>＋ Nuevo transportista</button></div>` +
      (SC.subs.length ? SC.subs.map(s => {
        const n = SC.viajes.filter(v => v.subcontratista_id === s.id && v.estado === 'activa');
        return `<div class="tx-doc"><div class="tx-doc-info"><b>🤝 ${esc(s.nombre)}${s.activo ? '' : ' (inactivo)'}</b>
          <small>${[s.ruc && 'RUC ' + s.ruc, s.telefono, s.placa_habitual && 'Cabezal ' + s.placa_habitual, s.placa_furgon && 'Furgón ' + s.placa_furgon, Number(s.dias_credito) > 0 ? s.dias_credito + ' días de crédito' : 'Contado', Number(s.retencion_ir_pct) > 0 ? 'Ret. IR ' + s.retencion_ir_pct + '%' : ''].filter(Boolean).map(esc).join(' · ')}</small>
          <small>${n.length} viaje(s) · ${esc(money(r2(n.reduce((t, v) => t + Number(v.monto || 0), 0))))}</small></div>
          <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-sm" data-sc-edit-sub="${esc(s.id)}">✏️ Editar</button></div></div>`;
      }).join('') : '<div class="tx-vacio">Aún no tienes transportistas externos. Crea el primero para poder subcontratar viajes.</div>');
    return;
  }
  el.innerHTML = `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-primary" data-sc-nuevo-viaje>＋ Subcontratar un viaje</button></div>` +
    (SC.viajes.length ? SC.viajes.map(v => {
      const o = ordDe(v.orden_id), c = cxpDe(v.cuenta_pagar_id), anul = v.estado !== 'activa';
      const pago = v.forma_pago === 'contado' ? `Contado${v.metodo_pago_nombre ? ' · ' + v.metodo_pago_nombre : ''}` : (c ? `Crédito ${c.numero} · ${c.estado === 'pagado' ? 'pagado' : 'saldo ' + money(c.saldo_pendiente)}${v.fecha_vencimiento ? ' · vence ' + TX.fmtFecha(v.fecha_vencimiento) : ''}` : 'Crédito');
      return `<div class="tx-doc" ${anul ? 'style="opacity:.55"' : ''}><div class="tx-doc-info"><b>🚚 ${esc(o?.numero || 'Orden')} · ${esc(v.subcontratista_nombre || subDe(v.subcontratista_id)?.nombre || '—')} · ${esc(money(v.monto))}${anul ? ' (anulada)' : ''}</b>
        <small>${esc(o ? `${o.origen || '—'} → ${o.destino || '—'}` : '')} · ${esc(TX.fmtFecha(v.fecha))} · ${esc(pago)}${Number(v.retencion_ir_monto) > 0 ? ' · retención IR ' + esc(money(v.retencion_ir_monto)) : ''}</small>
        ${[unidadTxt(v.placa, v.tipo_unidad, 'Cabezal'), unidadTxt(v.placa_furgon, v.tipo_furgon, 'Furgón'), v.conductor_nombre && 'Conductor: ' + v.conductor_nombre].filter(Boolean).length ? `<small>🚛 ${[unidadTxt(v.placa, v.tipo_unidad, 'Cabezal'), unidadTxt(v.placa_furgon, v.tipo_furgon, 'Furgón'), v.conductor_nombre && 'Conductor: ' + v.conductor_nombre].filter(Boolean).map(esc).join(' · ')}</small>` : ''}
        ${o ? `<small>Flete cobrado ${esc(money(o.total))} → margen ${esc(money(r2(Number(o.total || 0) - Number(v.monto))))}</small>` : ''}${TX.htmlComprobantes('subcontratacion', v.id, SC.comp)}</div>
        <div class="tx-fila-chips">${o ? `<a class="tx-btn tx-btn-sm" href="transporte-ordenes.html?orden=${esc(o.id)}">Ver orden</a>` : ''}${anul ? '' : `<button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-sc-anular="${esc(v.id)}">Anular</button>`}</div></div>`;
    }).join('') : '<div class="tx-vacio">Todavía no has subcontratado ningún viaje.</div>');
}
/* Tipos de unidad para el cabezal (motriz) y el furgón / remolque (arrastre). Se muestran como texto en listas y documentos. */
const tiposOpc = rol => '<option value="">— Sin indicar —</option>' + Object.entries(TX.TIPOS_UNIDAD).filter(([, v]) => v.rol === rol).map(([k, v]) => `<option value="${k}">${v.ico} ${esc(v.t)}</option>`).join('');
const tipoTxt = k => (k && TX.TIPOS_UNIDAD[k]) ? TX.TIPOS_UNIDAD[k].t : '';
const unidadTxt = (placa, tipo, etiqueta) => (placa || tipo) ? `${etiqueta}: ${[tipoTxt(tipo), placa].filter(Boolean).join(' · ')}` : '';
function renderTodo() { renderKpis(); renderVista(); }

/* ---------------- Transportistas ---------------- */
function abrirSub(id) {
  const s = id ? subDe(id) : null; SC.editId = id || null;
  $('ss-titulo').textContent = s ? 'Editar transportista' : 'Nuevo transportista';
  $('ss-nombre').value = s?.nombre || ''; $('ss-ruc').value = s?.ruc || ''; $('ss-tel').value = s?.telefono || ''; $('ss-placa').value = s?.placa_habitual || ''; $('ss-tipo').innerHTML = tiposOpc('motriz'); $('ss-tipo-furgon').innerHTML = tiposOpc('arrastre'); $('ss-tipo').value = s?.tipo_unidad || ''; $('ss-tipo-furgon').value = s?.tipo_furgon || ''; $('ss-placa-furgon').value = s?.placa_furgon || '';
  $('ss-dias').value = s?.dias_credito ?? 0; $('ss-ret').value = s?.retencion_ir_pct ?? 0; $('ss-notas').value = s?.notas || ''; $('ss-error').textContent = '';
  TX.abrir('sc-modal-sub');
}
async function guardarSub() {
  const err = m => { $('ss-error').textContent = m; };
  const nombre = $('ss-nombre').value.trim(); if (!nombre) return err('Escribe el nombre del transportista.');
  const dias = Math.max(0, Math.round(num($('ss-dias').value) || 0)), ret = num($('ss-ret').value) || 0;
  if (ret < 0 || ret > 100) return err('La retención debe estar entre 0 y 100%.');
  const p = { nombre, ruc: $('ss-ruc').value.trim() || null, telefono: $('ss-tel').value.trim() || null, placa_habitual: $('ss-placa').value.trim() || null, placa_furgon: $('ss-placa-furgon').value.trim() || null, tipo_unidad: $('ss-tipo').value || null, tipo_furgon: $('ss-tipo-furgon').value || null, dias_credito: dias, retencion_ir_pct: ret, notas: $('ss-notas').value.trim() || null };
  const btn = $('ss-guardar'); btn.disabled = true;
  try {
    if (SC.editId) { const { error } = await sb.from('transporte_subcontratistas').update(p).eq('id', SC.editId).eq('auth_user_id', TX.userId); if (error) throw error; }
    else { const { error } = await sb.from('transporte_subcontratistas').insert({ ...p, auth_user_id: TX.userId, activo: true }); if (error) throw error; }
    TX.cerrar('sc-modal-sub'); TX.toast('Transportista guardado'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); err('No se pudo guardar.'); }
  finally { btn.disabled = false; }
}

/* ---------------- Subcontratar un viaje ---------------- */
const elegibles = () => SC.ordenes.filter(o => ['pendiente', 'asignada'].includes(o.estado) && !o.subcontratada);
function abrirViaje(ordenId) {
  const ords = elegibles();
  if (!SC.subs.some(s => s.activo)) { TX.toast('Primero crea un transportista.', 'error'); SC.vista = 'lista'; renderVista(); return; }
  if (!ords.length) { TX.toast('No hay órdenes pendientes o asignadas para subcontratar.', 'error'); return; }
  $('sv-orden').innerHTML = ords.map(o => `<option value="${esc(o.id)}">${esc(o.numero)} · ${esc(o.origen || '—')} → ${esc(o.destino || '—')}</option>`).join('');
  if (ordenId && ords.some(o => o.id === ordenId)) $('sv-orden').value = ordenId;
  $('sv-sub').innerHTML = SC.subs.filter(s => s.activo).map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('');
  $('sv-metodo').innerHTML = SC.metodos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
  $('sv-monto').value = ''; $('sv-fecha').value = TX.hoyISO(); $('sv-placa').value = ''; $('sv-placa-furgon').value = ''; $('sv-conductor').value = ''; $('sv-tipo').innerHTML = tiposOpc('motriz'); $('sv-tipo-furgon').innerHTML = tiposOpc('arrastre'); $('sv-notas').value = ''; $('sv-error').textContent = '';
  cambiaSub(); cambiaForma(); TX.abrir('sc-modal-viaje');
}
function cambiaSub() {
  const s = subDe($('sv-sub').value), o = ordDe($('sv-orden').value);
  if (s) {
    $('sv-forma').value = Number(s.dias_credito) > 0 ? 'credito' : (SC.metodos.length && window.CajaAPI ? 'contado' : 'credito');
    $('sv-ret').value = s.retencion_ir_pct || 0; $('sv-placa').value = s.placa_habitual || ''; $('sv-placa-furgon').value = s.placa_furgon || ''; $('sv-tipo').value = s.tipo_unidad || ''; $('sv-tipo-furgon').value = s.tipo_furgon || '';
    cambiaForma();
  }
  $('sv-ref').textContent = o ? `Flete que cobras en esta orden: ${money(o.total)}` : '';
}
function cambiaForma() {
  const s = subDe($('sv-sub').value), cr = $('sv-forma').value === 'credito';
  $('sv-venc-wrap').style.display = cr ? '' : 'none'; $('sv-caja-wrap').style.display = cr ? 'none' : '';
  if (cr) { const d = new Date($('sv-fecha').value + 'T12:00:00'); d.setDate(d.getDate() + (Number(s?.dias_credito) || 30)); $('sv-venc').value = TX.ymd(d); }
  $('sv-ret-wrap').style.display = cr ? 'none' : '';
  cambiaMetodo(); actualizaRet();
}
function cambiaMetodo() {
  const n = ($('sv-metodo').selectedOptions[0]?.textContent || '').toLowerCase();
  const nec = $('sv-forma').value === 'contado' && (n.includes('tarjeta') || n.includes('transferencia')) && SC.bancos.length > 0;
  $('sv-banco-wrap').style.display = nec ? '' : 'none';
  if (nec) $('sv-banco').innerHTML = '<option value="">Selecciona un banco…</option>' + SC.bancos.map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('');
}
function actualizaRet() {
  const m = num($('sv-monto').value) || 0, p = num($('sv-ret').value) || 0, r = r2(m * p / 100);
  $('sv-ret-ayuda').textContent = $('sv-forma').value === 'credito'
    ? 'A crédito, la retención de IR se aplica cuando registres el pago en Cuentas por Pagar.'
    : (r > 0 ? `Retienes ${money(r)} y pagas ${money(m - r)} desde Caja. La retención queda por pagar a la DGI (módulo Impuestos).` : 'Sin retención.');
}
async function ultimoMovimientoId() {
  try { const { data } = await sb.from('movimientos_financieros').select('id').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }).limit(1).maybeSingle(); return data?.id || null; } catch (_) { return null; }
}
async function anularGasto(gastoId, motivo) {
  await sb.from('movimientos_financieros').update({ estado: 'anulado', anulado_en: new Date().toISOString(), anulado_motivo: motivo })
    .eq('referencia_tipo', 'gasto').eq('referencia_id', gastoId).eq('auth_user_id', TX.userId).eq('estado', 'completado');
  await sb.from('gastos').update({ estado: 'cancelado', cancelado_en: new Date().toISOString(), cancelado_motivo: motivo }).eq('id', gastoId).eq('auth_user_id', TX.userId);
  await sb.from('retenciones_ir').update({ estado: 'anulada' }).eq('gasto_id', gastoId).eq('auth_user_id', TX.userId).eq('estado', 'pendiente');
}
async function proveedorDe(s) {
  if (s.proveedor_id) return { id: s.proveedor_id, nombre: s.nombre };
  const { data, error } = await sb.from('proveedores').insert({ auth_user_id: TX.userId, nombre: s.nombre, telefono: s.telefono || null, observaciones: 'Transportista subcontratado', activo: true, monto_acumulado: 0, total_compras: 0 }).select().single();
  if (error) throw error;
  await sb.from('transporte_subcontratistas').update({ proveedor_id: data.id }).eq('id', s.id).eq('auth_user_id', TX.userId);
  s.proveedor_id = data.id;
  return { id: data.id, nombre: s.nombre };
}
async function numeroCxP() {
  try { const { data, error } = await sb.rpc('generar_numero_cxp', { p_user_id: TX.userId }); if (error || !data) throw error || new Error('x'); return data; } catch (_) { return 'CXP-' + String(Date.now()).slice(-6); }
}
async function guardarViaje() {
  const err = m => { $('sv-error').textContent = m; };
  const o = ordDe($('sv-orden').value), s = subDe($('sv-sub').value);
  if (!o || !s) return err('Elige la orden y el transportista.');
  if (o.subcontratada || !['pendiente', 'asignada'].includes(o.estado)) return err('Esa orden ya no se puede subcontratar.');
  const monto = num($('sv-monto').value); if (monto == null || monto <= 0) return err('Escribe el costo del flete (mayor a 0).');
  const fecha = $('sv-fecha').value || TX.hoyISO(), contado = $('sv-forma').value === 'contado';
  const pct = contado ? (num($('sv-ret').value) || 0) : 0;
  if (pct < 0 || pct > 100) return err('La retención debe estar entre 0 y 100%.');
  const ret = r2(monto * pct / 100), neto = r2(monto - ret);
  let metodo = null, bancoId = null;
  if (contado) {
    if (!window.CajaAPI) return err('Caja no está disponible. Elige "A crédito".');
    metodo = SC.metodos.find(m => m.id === $('sv-metodo').value); if (!metodo) return err('Elige el método de pago.');
    if ($('sv-banco-wrap').style.display !== 'none') { bancoId = $('sv-banco').value; if (!bancoId) return err('Selecciona de qué banco sale el dinero.'); }
  } else if (!$('sv-venc').value) return err('Indica la fecha de pago acordada.');
  const btn = $('sv-guardar'); btn.disabled = true;
  let gastoId = null, cxpId = null, movId = null, subId = null;
  const estadoPrevio = o.estado;
  try {
    const concepto = `Flete subcontratado ${o.numero} · ${s.nombre}`;
    const obs = `Orden de transporte ${o.numero} (${o.cliente_nombre || 'cliente'}) · transportista externo ${s.nombre}`;
    if (contado) {
      const { data: g, error: eg } = await sb.from('gastos').insert({
        auth_user_id: TX.userId, tipo: 'inmediato', concepto, categoria: 'Transporte subcontratado', monto, fecha, metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre,
        impuesto: 0, observaciones: obs, estado: 'activo', retencion_ir_monto: ret, retencion_ir_porcentaje: pct,
      }).select().single();
      if (eg) throw eg;
      gastoId = g.id;
      const mov = await window.CajaAPI.registrarMovimiento({
        auth_user_id: TX.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO', concepto: `Transporte subcontratado: ${concepto}`, monto: neto,
        metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre, origen_caja: null, banco_id: bancoId || null,
        referencia_tipo: 'gasto', referencia_id: g.id, observaciones: obs, fecha,
      });
      if (!mov.ok) { await sb.from('gastos').delete().eq('id', g.id).eq('auth_user_id', TX.userId); gastoId = null; throw new Error('Caja: ' + mov.error); }
      movId = await ultimoMovimientoId();
      if (movId) await sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', g.id).eq('auth_user_id', TX.userId);
      if (ret > 0) {
        const { error: er } = await sb.from('retenciones_ir').insert({
          auth_user_id: TX.userId, lado: 'por_pagar', origen: 'gasto', gasto_id: g.id, estado: 'pendiente',
          contraparte_nombre: s.nombre, fecha, base: monto, porcentaje: pct, monto: ret,
        });
        if (er) throw er;
      }
    } else {
      const prov = await proveedorDe(s);
      const { data: c, error: ec } = await sb.from('cuentas_por_pagar').insert({
        auth_user_id: TX.userId, numero: await numeroCxP(), proveedor_id: prov.id, proveedor_nombre: prov.nombre, compra_id: null, tipo_credito: 'fecha_fija',
        fecha_compra: fecha, fecha_vencimiento: $('sv-venc').value, clase_costo: 'servicio', monto_original: monto, monto_total: monto, monto_pagado: 0, saldo_pendiente: monto,
        prima_tipo: 'ninguna', prima_valor: 0, prima_monto: 0, tasa_interes: 0, estado: 'pendiente', observaciones: concepto,
        usuario_nombre: TX.perfilNombre || 'Usuario',
      }).select().single();
      if (ec) throw ec;
      cxpId = c.id;
    }
    const { data: sv, error: e2 } = await sb.from('transporte_subcontrataciones').insert({
      auth_user_id: TX.userId, orden_id: o.id, subcontratista_id: s.id, subcontratista_nombre: s.nombre, fecha, monto, forma_pago: contado ? 'contado' : 'credito',
      fecha_vencimiento: contado ? null : $('sv-venc').value, retencion_ir_porcentaje: pct, retencion_ir_monto: ret, placa: $('sv-placa').value.trim() || null, placa_furgon: $('sv-placa-furgon').value.trim() || null, tipo_unidad: $('sv-tipo').value || null, tipo_furgon: $('sv-tipo-furgon').value || null, conductor_nombre: $('sv-conductor').value.trim() || null,
      notas: $('sv-notas').value.trim() || null, metodo_pago_nombre: contado ? metodo.nombre : null, gasto_id: gastoId, movimiento_caja_id: movId, cuenta_pagar_id: cxpId, estado: 'activa',
    }).select().single();
    if (e2) throw e2;
    subId = sv.id;
    const patch = { subcontratada: true, estado: estadoPrevio === 'pendiente' ? 'asignada' : estadoPrevio };
    const { error: e3 } = await sb.from('transporte_ordenes').update(patch).eq('id', o.id).eq('auth_user_id', TX.userId);
    if (e3) throw e3;
    TX.cerrar('sc-modal-viaje'); TX.toast(contado ? 'Viaje subcontratado y pagado desde Caja' : 'Viaje subcontratado; quedó en Cuentas por Pagar');
    await cargarTodo(); SC.vista = 'viajes'; renderTodo();
  } catch (e) {
    console.error(e);
    try {
      if (subId) await sb.from('transporte_subcontrataciones').delete().eq('id', subId).eq('auth_user_id', TX.userId);
      if (gastoId) await anularGasto(gastoId, 'No se pudo completar la subcontratación');
      if (cxpId) await sb.from('cuentas_por_pagar').delete().eq('id', cxpId).eq('auth_user_id', TX.userId);
    } catch (_) {}
    err('No se pudo subcontratar el viaje. No se registró nada en Caja ni en Cuentas por Pagar.');
  } finally { btn.disabled = false; }
}

/* ---------------- Anular ---------------- */
async function anularViaje(id) {
  const v = SC.viajes.find(x => x.id === id); if (!v || v.estado !== 'activa') return;
  const o = ordDe(v.orden_id);
  if (o && ['en_ruta', 'entregada'].includes(o.estado)) { TX.toast('La orden ya está en ruta o entregada; no se puede anular la subcontratación.', 'error'); return; }
  let c = null;
  if (v.cuenta_pagar_id) {
    const { data } = await sb.from('cuentas_por_pagar').select('id,monto_pagado').eq('id', v.cuenta_pagar_id).eq('auth_user_id', TX.userId).maybeSingle();
    c = data;
    if (c && Number(c.monto_pagado) > 0) { TX.toast('Esa cuenta por pagar ya tiene pagos. Anula primero los pagos en Cuentas por Pagar.', 'error'); return; }
  }
  if (v.gasto_id) {
    const { data: r } = await sb.from('retenciones_ir').select('estado').eq('gasto_id', v.gasto_id).eq('auth_user_id', TX.userId).maybeSingle();
    if (r && ['pagada', 'acreditada'].includes(r.estado)) { TX.toast('La retención de este viaje ya fue pagada a la DGI; no se puede anular.', 'error'); return; }
  }
  const txt = v.forma_pago === 'contado' ? 'El dinero vuelve a Caja y se cancela el gasto y la retención.' : 'Se elimina la cuenta por pagar.';
  if (!await TX.confirmar('¿Anular la subcontratación?', txt, 'Anular', true)) return;
  try {
    if (v.gasto_id) await anularGasto(v.gasto_id, 'Subcontratación anulada');
    if (v.cuenta_pagar_id) await sb.from('cuentas_por_pagar').delete().eq('id', v.cuenta_pagar_id).eq('auth_user_id', TX.userId);
    const { error } = await sb.from('transporte_subcontrataciones').update({ estado: 'anulada', anulada_motivo: 'Anulada por el usuario' }).eq('id', id).eq('auth_user_id', TX.userId);
    if (error) throw error;
    if (o) {
      const patch = { subcontratada: false }; if (o.estado === 'asignada' && !o.unidad_id && !o.conductor_id) patch.estado = 'pendiente';
      await sb.from('transporte_ordenes').update(patch).eq('id', o.id).eq('auth_user_id', TX.userId);
    }
    TX.toast('Subcontratación anulada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo anular completamente. Revisa Gastos / Cuentas por Pagar.', 'error'); }
}

/* ---------------- Eventos ---------------- */
function enlazar() {
  TX.alCambiarComprobantes = async () => { SC.comp = await TX.cargarComprobantes(); renderVista(); };
  $('ss-guardar').addEventListener('click', guardarSub);
  $('sv-guardar').addEventListener('click', guardarViaje);
  $('sv-sub').addEventListener('change', cambiaSub);
  $('sv-orden').addEventListener('change', cambiaSub);
  $('sv-forma').addEventListener('change', cambiaForma);
  $('sv-fecha').addEventListener('change', cambiaForma);
  $('sv-metodo').addEventListener('change', cambiaMetodo);
  $('sv-monto').addEventListener('input', actualizaRet);
  $('sv-ret').addEventListener('input', actualizaRet);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-sc-vista],[data-sc-nuevo-sub],[data-sc-edit-sub],[data-sc-nuevo-viaje],[data-sc-anular]');
    if (!t) return; const d = t.dataset;
    if (d.scVista) { SC.vista = d.scVista; renderVista(); }
    else if ('scNuevoSub' in d) abrirSub(null);
    else if (d.scEditSub) abrirSub(d.scEditSub);
    else if ('scNuevoViaje' in d) abrirViaje(null);
    else if (d.scAnular) anularViaje(d.scAnular);
  });
}

window.SC = SC;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => {
    enlazar(); await cargarTodo(); renderTodo();
    const p = new URLSearchParams(location.search).get('orden');
    if (p) abrirViaje(p);
  });
});
