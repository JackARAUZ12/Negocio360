/* =====================================================
   COMISIONES.JS — NEGOCIO360 · Módulo de Comisiones (aparte de Salarios)
   Se leen con permisos del dueño; todo cambio (personas, cálculo por venta,
   comisiones manuales, quitar y pagar) pasa por funciones del servidor.
===================================================== */
'use strict';
window.TL_FLAG = 'usa_modulo_comisiones';
window.TL_APAGADO = { i: '💵', t: 'Comisiones está apagado', d: 'Actívalo en <b>Configuración → Comisiones</b> para empezar a llevar las comisiones por venta.' };
const $ = id => document.getElementById(id);
const num = v => Number(v || 0);
const BASES = { venta: '% de la venta (sin IVA)', ganancia: '% de la ganancia', fijo: 'Monto fijo por venta' };
const hoyISO = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
const CM = { pers: [], movs: [], pagos: [], metodos: [], bancos: [], freel: 0, tab_: 'pend', abierta: null, editId: null, manualDe: null, pagarDe: null, ocupado: false, sel: {} };

window.tallerListo = async function () {
  CM.cargarCaja = false;
  await CM.generar();
  await CM.cargar();
};
CM.generar = async function () {
  const r = await tlRpc('comision_generar', {});
  if (r && r.ok && (r.nuevas || r.anuladas)) console.info('Comisiones nuevas:', r.nuevas, 'anuladas:', r.anuladas);
};
CM.cargar = async function () {
  const uid = TL.userId;
  try {
    const [p, m, g, mp, bk, fr] = await Promise.all([
      sb.from('comision_beneficiarios').select('*').eq('auth_user_id', uid).order('nombre').limit(500),
      sb.from('comision_movimientos').select('*').eq('auth_user_id', uid).in('estado', ['pendiente']).order('fecha', { ascending: false }).limit(5000),
      sb.from('comision_pagos').select('*').eq('auth_user_id', uid).order('created_at', { ascending: false }).limit(200),
      sb.from('metodos_pago').select('id,nombre').eq('auth_user_id', uid).eq('activo', true).order('nombre'),
      sb.from('bancos').select('id,nombre').eq('auth_user_id', uid).eq('activo', true).order('nombre'),
      sb.from('freelancers').select('id', { count: 'exact', head: true }).eq('auth_user_id', uid).eq('tipo_comision', 'porcentaje'),
    ]);
    if (p.error) throw p.error;
    CM.pers = p.data || []; CM.movs = m.data || []; CM.pagos = g.data || []; CM.metodos = mp.data || []; CM.bancos = bk.data || []; CM.freel = fr.count || 0;
  } catch (e) { console.warn(e); $('c-cuerpo').innerHTML = '<div class="tl-vacio">No se pudieron cargar las comisiones. Recarga la pantalla.</div>'; return; }
  $('c-imp').style.display = (CM.freel > 0 && !CM.pers.length) ? '' : 'none';
  CM.pintar();
};
CM.tab = function (t) {
  CM.tab_ = t;
  ['pend', 'pagos', 'pers'].forEach(k => { $('c-t-' + k).className = k === t ? 'btn-primary' : 'btn-secondary'; });
  CM.pintar();
};
CM.nombre = id => (CM.pers.find(p => p.id === id) || {}).nombre || '—';
CM.pintar = function () {
  const pend = CM.movs.filter(m => m.estado === 'pendiente'), totP = pend.reduce((a, m) => a + num(m.monto), 0);
  const mes = hoyISO().slice(0, 7), pagMes = CM.pagos.filter(g => String(g.fecha).slice(0, 7) === mes).reduce((a, g) => a + num(g.total), 0);
  $('c-kpis').innerHTML = `<div class="tl-card"><span class="tl-muted">Por pagar</span><h3>${fmt(totP)}</h3><span class="tl-muted">${pend.length} comisión(es)</span></div>
    <div class="tl-card"><span class="tl-muted">Pagado este mes</span><h3>${fmt(pagMes)}</h3></div>
    <div class="tl-card"><span class="tl-muted">Personas activas</span><h3>${CM.pers.filter(p => p.activo).length}</h3></div>`;
  if (CM.tab_ === 'pend') CM.pintarPend(); else if (CM.tab_ === 'pagos') CM.pintarPagos(); else CM.pintarPers();
};
CM.pintarPend = function () {
  const conPend = CM.pers.filter(p => CM.movs.some(m => m.beneficiario_id === p.id));
  if (!CM.pers.length) { $('c-cuerpo').innerHTML = '<div class="tl-vacio">Aún no hay personas con comisión. Toca <b>+ Persona nueva</b>' + (CM.freel ? ' o <b>Traer de Freelancers</b>' : '') + '.</div>'; return; }
  if (!conPend.length) { $('c-cuerpo').innerHTML = '<div class="tl-vacio">No hay comisiones por pagar. Las nuevas ventas aparecen aquí solas.</div>'; return; }
  $('c-cuerpo').innerHTML = '<div class="tl-cards" style="grid-template-columns:1fr">' + conPend.map(p => {
    const ms = CM.movs.filter(m => m.beneficiario_id === p.id), tot = ms.reduce((a, m) => a + num(m.monto), 0), ab = CM.abierta === p.id;
    return `<div class="tl-card"><h3><span>${esc(p.nombre)}${p.activo ? '' : ' <span class="badge badge-neutral">Archivada</span>'}</span><span>${fmt(tot)}</span></h3>
      <div class="tl-muted">${ms.length} comisión(es) por pagar · ${esc(CM.regla(p))}</div>
      <div class="tl-acc"><button type="button" class="btn-primary" onclick="CM.abrir('${p.id}')">${ab ? 'Ocultar' : 'Ver y pagar'}</button><button type="button" class="btn-secondary" onclick="CM.manual('${p.id}')">+ Comisión manual</button></div>
      ${ab ? CM.tablaPend(p, ms) : ''}</div>`;
  }).join('') + '</div>';
};
CM.regla = p => p.base === 'fijo' ? `${fmt(p.valor)} por venta` : `${num(p.valor)}% ${p.base === 'ganancia' ? 'de la ganancia' : 'de la venta (sin IVA)'}`;
CM.abrir = function (id) {
  CM.abierta = CM.abierta === id ? null : id;
  if (CM.abierta) { CM.sel = {}; CM.movs.filter(m => m.beneficiario_id === id).forEach(m => { CM.sel[m.id] = true; }); }
  CM.pintar();
};
CM.tablaPend = function (p, ms) {
  const filas = ms.map(m => `<tr><td data-t="Elegir"><input type="checkbox" ${CM.sel[m.id] ? 'checked' : ''} onchange="CM.marcar('${m.id}',this.checked)" aria-label="Elegir comisión"></td>
    <td data-t="Fecha">${tlFecha(m.fecha)}</td><td data-t="Detalle">${m.origen === 'venta' ? 'Venta ' + esc(m.venta_numero || '') : 'Manual' + (m.nota ? ' · ' + esc(m.nota) : '')}</td>
    <td data-t="Base" class="tl-num">${m.origen === 'venta' ? (p.base === 'fijo' ? '—' : fmt(m.base_monto)) : '—'}</td><td data-t="%" class="tl-num">${num(m.porcentaje) ? num(m.porcentaje) + '%' : '—'}</td>
    <td data-t="Comisión" class="tl-num"><b>${fmt(m.monto)}</b></td><td class="tl-ac"><button type="button" class="btn-secondary" onclick="CM.quitar('${m.id}')">Quitar</button></td></tr>`).join('');
  const tot = ms.filter(m => CM.sel[m.id]).reduce((a, m) => a + num(m.monto), 0), n = ms.filter(m => CM.sel[m.id]).length;
  return `<table class="tl-tabla"><thead><tr><th></th><th>Fecha</th><th>Detalle</th><th class="tl-num">Base</th><th class="tl-num">%</th><th class="tl-num">Comisión</th><th></th></tr></thead><tbody>${filas}</tbody></table>
    <div class="tl-acc" style="justify-content:space-between;align-items:center"><span><b>${n}</b> elegida(s) · <b>${fmt(tot)}</b></span><button type="button" class="btn-primary" ${n ? '' : 'disabled'} onclick="CM.abrirPago('${p.id}')">Pagar elegidas</button></div>`;
};
CM.marcar = function (id, v) { CM.sel[id] = v; CM.pintar(); };
CM.pintarPagos = function () {
  $('c-cuerpo').innerHTML = CM.pagos.length ? `<table class="tl-tabla"><thead><tr><th>Fecha</th><th>Persona</th><th>Método</th><th class="tl-num">Comisiones</th><th class="tl-num">Total</th></tr></thead><tbody>${CM.pagos.map(g => `<tr><td data-t="Fecha">${tlFecha(g.fecha)}</td><td data-t="Persona">${esc(CM.nombre(g.beneficiario_id))}</td><td data-t="Método">${esc(g.metodo_pago_nombre || '')}</td><td data-t="Comisiones" class="tl-num">${g.cantidad}</td><td data-t="Total" class="tl-num"><b>${fmt(g.total)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="tl-vacio">Todavía no has pagado comisiones desde aquí.</div>';
};
CM.pintarPers = function () {
  $('c-cuerpo').innerHTML = CM.pers.length ? '<div class="tl-cards">' + CM.pers.map(p => `<div class="tl-card"><h3><span>${esc(p.nombre)}</span>${p.activo ? '' : '<span class="badge badge-neutral">Archivada</span>'}</h3>
    <div>${esc(CM.regla(p))}</div><div class="tl-muted">${p.vendedor_nombre ? 'Vendedor: ' + esc(p.vendedor_nombre) : 'Sin vendedor: solo comisiones manuales'} · desde ${tlFecha(p.fecha_inicio)}</div>
    <div class="tl-acc"><button type="button" class="btn-secondary" onclick="CM.personaEditar('${p.id}')">Editar</button><button type="button" class="btn-secondary" onclick="CM.archivar('${p.id}',${!p.activo})">${p.activo ? 'Archivar' : 'Reactivar'}</button></div></div>`).join('') + '</div>'
    : '<div class="tl-vacio">Aún no hay personas. Toca <b>+ Persona nueva</b>.</div>';
};
CM.abrirM = id => { $(id).classList.add('abierto'); document.body.style.overflow = 'hidden'; };
CM.cerrar = id => { $(id).classList.remove('abierto'); document.body.style.overflow = ''; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') ['p-modal', 'g-modal', 'm-modal'].forEach(id => { if ($(id) && $(id).classList.contains('abierto')) CM.cerrar(id); }); });
CM.accion = async function (fn) { if (CM.ocupado) return null; CM.ocupado = true; try { return await fn(); } finally { CM.ocupado = false; } };

/* ---------- Personas ---------- */
CM.vendedores = async function () {
  try {
    const { data } = await sb.from('ventas').select('creado_por_nombre').eq('auth_user_id', TL.userId).not('creado_por_nombre', 'is', null).order('fecha', { ascending: false }).limit(1500);
    $('p-vend-lista').innerHTML = [...new Set((data || []).map(x => x.creado_por_nombre).filter(Boolean))].slice(0, 60).map(n => `<option value="${esc(n)}">`).join('');
  } catch (_) {}
};
CM.cambioBase = function () { const f = $('p-base').value === 'fijo'; $('p-valor-lbl').textContent = f ? 'Monto por venta' : 'Porcentaje (%)'; $('p-valor').max = f ? '' : '100'; };
CM.personaNueva = function () {
  CM.editId = null; ['p-nombre', 'p-vend', 'p-valor', 'p-tel'].forEach(i => { $(i).value = ''; }); $('p-base').value = 'venta'; $('p-ini').value = hoyISO(); $('p-aviso').innerHTML = ''; $('p-titulo').textContent = 'Persona nueva';
  CM.cambioBase(); CM.vendedores(); CM.abrirM('p-modal'); setTimeout(() => $('p-nombre').focus(), 50);
};
CM.personaEditar = function (id) {
  const p = CM.pers.find(x => x.id === id); if (!p) return; CM.editId = id;
  $('p-nombre').value = p.nombre; $('p-vend').value = p.vendedor_nombre || ''; $('p-base').value = p.base; $('p-valor').value = num(p.valor); $('p-ini').value = p.fecha_inicio; $('p-tel').value = p.telefono || ''; $('p-aviso').innerHTML = ''; $('p-titulo').textContent = 'Editar persona';
  CM.cambioBase(); CM.vendedores(); CM.abrirM('p-modal');
};
CM.personaGuardar = async function () {
  const p = { id: CM.editId, nombre: $('p-nombre').value.trim(), vendedor_nombre: $('p-vend').value.trim(), base: $('p-base').value, valor: $('p-valor').value, fecha_inicio: $('p-ini').value, telefono: $('p-tel').value.trim() };
  if (p.nombre.length < 2) { $('p-aviso').innerHTML = '<div class="tl-aviso">Escribe el nombre.</div>'; return; }
  if (p.valor === '' || num(p.valor) < 0) { $('p-aviso').innerHTML = '<div class="tl-aviso">Escribe el porcentaje o el monto.</div>'; return; }
  $('p-guardar').disabled = true;
  const r = await CM.accion(() => tlRpc('comision_beneficiario_guardar', { p }));
  $('p-guardar').disabled = false;
  if (!r) return; if (!r.ok) { $('p-aviso').innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  CM.cerrar('p-modal'); showToast('✅ Persona guardada'); await CM.generar(); await CM.cargar();
};
CM.archivar = async function (id, activo) {
  const r = await CM.accion(() => tlRpc('comision_beneficiario_archivar', { p_id: id, p_activo: activo }));
  if (!r) return; if (!r.ok) { showToast(r.msg, 'error'); return; } await CM.cargar();
};
CM.importar = async function () {
  const r = await CM.accion(() => tlRpc('comision_importar_freelancers', {}));
  if (!r) return; if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast(`✅ Se trajeron ${r.importados} persona(s)${r.omitidos_fijo ? ` · ${r.omitidos_fijo} con monto fijo se agregan a mano` : ''}`); await CM.generar(); await CM.cargar();
};

/* ---------- Manual, quitar, pagar ---------- */
CM.manual = function (id) { CM.manualDe = id; $('m-titulo').textContent = 'Comisión manual · ' + CM.nombre(id); $('m-monto').value = ''; $('m-nota').value = ''; $('m-fecha').value = hoyISO(); $('m-aviso').innerHTML = ''; CM.abrirM('m-modal'); setTimeout(() => $('m-monto').focus(), 50); };
CM.manualGuardar = async function () {
  const monto = $('m-monto').value; if (!(num(monto) > 0)) { $('m-aviso').innerHTML = '<div class="tl-aviso">Escribe un monto mayor que cero.</div>'; return; }
  $('m-ok').disabled = true;
  const r = await CM.accion(() => tlRpc('comision_manual_agregar', { p_beneficiario_id: CM.manualDe, p: { monto, fecha: $('m-fecha').value, nota: $('m-nota').value.trim() } }));
  $('m-ok').disabled = false;
  if (!r) return; if (!r.ok) { $('m-aviso').innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  CM.cerrar('m-modal'); showToast('✅ Comisión agregada'); await CM.cargar(); CM.abierta = null; CM.abrir(CM.manualDe);
};
CM.quitar = async function (id) {
  if (!confirm('¿Quitar esta comisión? Ya no se podrá pagar.')) return;
  const r = await CM.accion(() => tlRpc('comision_anular', { p_mov_id: id, p_nota: 'Quitada por ' + TL.nombre }));
  if (!r) return; if (!r.ok) { showToast(r.msg, 'error'); await CM.cargar(); return; } showToast('Comisión quitada'); await CM.cargar();
};
CM.abrirPago = function (id) {
  const ids = CM.movs.filter(m => m.beneficiario_id === id && CM.sel[m.id]); if (!ids.length) return;
  CM.pagarDe = id; const tot = ids.reduce((a, m) => a + num(m.monto), 0);
  $('g-resumen').innerHTML = `Pagar <b>${fmt(tot)}</b> a <b>${esc(CM.nombre(id))}</b> (${ids.length} comisión${ids.length === 1 ? '' : 'es'}). Sale de Caja como egreso.`;
  $('g-met').innerHTML = '<option value="">— Elige —</option>' + CM.metodos.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');
  $('g-banco').innerHTML = '<option value="">Ninguno</option>' + CM.bancos.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('');
  $('g-fecha').value = hoyISO(); $('g-obs').value = ''; $('g-aviso').innerHTML = ''; CM.abrirM('g-modal');
};
CM.pagar = async function () {
  const sel = $('g-met'); if (!sel.value) { $('g-aviso').innerHTML = '<div class="tl-aviso">Elige el método de pago.</div>'; return; }
  const ids = CM.movs.filter(m => m.beneficiario_id === CM.pagarDe && CM.sel[m.id]).map(m => m.id); if (!ids.length) return;
  $('g-ok').disabled = true; $('g-ok').textContent = 'Pagando…';
  const p = { metodo_pago_id: sel.value, metodo_pago_nombre: sel.options[sel.selectedIndex].text, banco_id: $('g-banco').value || null, fecha: $('g-fecha').value, observaciones: $('g-obs').value.trim(), por: TL.nombre };
  const r = await CM.accion(() => tlRpc('comision_pagar', { p_beneficiario_id: CM.pagarDe, p_mov_ids: ids, p }));
  $('g-ok').disabled = false; $('g-ok').textContent = 'Pagar y sacar de Caja';
  if (!r) return;
  if (!r.ok) { $('g-aviso').innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; if (r.motivo === 'cambiaron') await CM.cargar(); return; }
  CM.cerrar('g-modal'); showToast(`✅ Pagado ${fmt(r.total)}`); CM.abierta = null; await CM.cargar();
};
