/* ============================================================
   TRANSPORTE-FRONTERAS.JS — NEGOCIO360 (Transporte · Fase 10)
   Cruces de frontera y documentos de la orden.
   - Documentos de la orden (carta de porte, manifiesto, DUA…) con el mismo
     sistema de documentos de Flota y Conductores (foto/PDF, vencimiento).
   - Cruces por frontera con su estado: pendiente → en trámite → cruzado / retenido.
   - El costo del trámite suma a los costos del viaje (categoría "frontera") y,
     si quieres, sale de Caja como Gasto (Contabilidad lo asienta).
   - Carta de porte lista para imprimir con los datos de la orden.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, num } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const FR = { vista: 'cruces', cruces: [], ordenes: [], rutas: [], unidades: [], conductores: [], docs: {}, metodos: [], bancos: [], costos: {}, editId: null, ordenSel: null };
const ESTADO = {
  pendiente:  { t: 'Por llegar', clase: 'gris', ico: '⏳' },
  en_tramite: { t: 'En trámite', clase: 'azul', ico: '📝' },
  cruzado:    { t: 'Cruzó', clase: 'verde', ico: '✅' },
  retenido:   { t: 'Retenido', clase: 'rojo', ico: '⛔' },
};
const DOCS_FRONTERA = ['carta_porte', 'manifiesto', 'dua'];

async function cargarTodo() {
  const [cruces, ordenes, rutas, unidades, conductores, docs] = await Promise.all([
    TX.paginar(() => sb.from('transporte_cruces').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.paginar(() => sb.from('transporte_ordenes').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.paginar(() => sb.from('transporte_rutas').select('*').eq('auth_user_id', TX.userId)),
    TX.paginar(() => sb.from('transporte_unidades').select('id,nombre,placa,tipo').eq('auth_user_id', TX.userId)),
    TX.paginar(() => sb.from('transporte_conductores').select('id,nombre,cedula,licencia_tipo').eq('auth_user_id', TX.userId)),
    TX.cargarDocs('orden'),
  ]);
  FR.cruces = cruces; FR.ordenes = ordenes; FR.rutas = rutas; FR.unidades = unidades; FR.conductores = conductores; FR.docs = TX.agruparDocs(docs);
  try { const { data } = await sb.from('transporte_subcontrataciones').select('*').eq('auth_user_id', TX.userId).eq('estado', 'activa').order('created_at', { ascending: false }); FR.subs = data || []; } catch (_) { FR.subs = []; }
  try { const { data } = await sb.from('metodos_pago').select('*').eq('auth_user_id', TX.userId).eq('activo', true).order('orden'); FR.metodos = data || []; } catch (_) { FR.metodos = []; }
  try { const { data } = await sb.from('bancos').select('id,nombre').eq('auth_user_id', TX.userId).eq('activo', true).order('nombre'); FR.bancos = data || []; } catch (_) { FR.bancos = []; }
}
const ord = id => FR.ordenes.find(o => o.id === id);
const rutaDe = o => FR.rutas.find(r => r.id === o?.ruta_id);
const docsDe = id => FR.docs[id] || [];
const activa = o => ['pendiente', 'asignada', 'en_ruta'].includes(o.estado);
const requiereFrontera = o => !!rutaDe(o)?.cruza_frontera || FR.cruces.some(c => c.orden_id === o.id);
function faltantes(o) {
  if (!requiereFrontera(o)) return [];
  const tiene = new Set(docsDe(o.id).map(d => d.tipo));
  return DOCS_FRONTERA.filter(t => !tiene.has(t)).map(t => TX.etiquetaDoc('orden', t).t);
}
const ordenesConFrontera = () => FR.ordenes.filter(o => o.estado !== 'cancelada' && requiereFrontera(o));

/* ---------------- Pintado ---------------- */
function renderKpis() {
  const mes = TX.hoyISO().slice(0, 7);
  const tr = FR.cruces.filter(c => c.estado === 'en_tramite').length, ret = FR.cruces.filter(c => c.estado === 'retenido').length;
  const cr = FR.cruces.filter(c => c.estado === 'cruzado' && String(c.cruce_en || '').slice(0, 7) === mes).length;
  const falt = ordenesConFrontera().filter(o => activa(o) && faltantes(o).length).length;
  $('fr-kpis').innerHTML = `
    <div class="tx-kpi"><span>En trámite</span><b>${tr}</b><small>cruces en la frontera</small></div>
    <div class="tx-kpi"><span>Retenidos</span><b>${ret}</b><small>requieren atención</small></div>
    <div class="tx-kpi"><span>Cruzaron este mes</span><b>${cr}</b><small>cruces completados</small></div>
    <div class="tx-kpi"><span>Con papeles incompletos</span><b>${falt}</b><small>órdenes activas con frontera</small></div>`;
}
function filaCruce(c) {
  const o = ord(c.orden_id), e = ESTADO[c.estado] || ESTADO.pendiente, id = esc(c.id);
  const sig = c.estado === 'pendiente' ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-fr-avanzar="${id}" data-a="llego">Llegó a la frontera</button>`
    : c.estado === 'en_tramite' ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-ok" data-fr-avanzar="${id}" data-a="cruzo">Ya cruzó</button><button type="button" class="tx-btn tx-btn-sm" data-fr-avanzar="${id}" data-a="retenido">Retenido</button>`
    : c.estado === 'retenido' ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-ok" data-fr-avanzar="${id}" data-a="cruzo">Liberado, cruzó</button>` : '';
  return `<div class="tx-doc"><div class="tx-doc-info"><b>🛂 ${esc(c.frontera)} · ${esc(o?.numero || 'Orden')} <span class="tx-chip ${e.clase}">${e.ico} ${esc(e.t)}</span></b>
    <small>${esc(c.sentido === 'regreso' ? 'Regreso' : 'Ida')}${c.referencia ? ' · trámite ' + esc(c.referencia) : ''}${c.agente_aduanal ? ' · agente ' + esc(c.agente_aduanal) : ''}${Number(c.costo_tramite) > 0 ? ' · costo ' + esc(money(c.costo_tramite)) : ''}</small>
    <small>${c.llegada_en ? 'Llegó ' + esc(TX.fmtFecha(c.llegada_en)) : ''}${c.cruce_en ? ' · Cruzó ' + esc(TX.fmtFecha(c.cruce_en)) : ''}${c.notas ? ' · ' + esc(c.notas) : ''}</small></div>
    <div class="tx-fila-chips">${sig}<button type="button" class="tx-btn tx-btn-sm" data-fr-editar="${id}">✏️</button><button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-fr-borrar="${id}">🗑</button></div></div>`;
}
function renderVista() {
  document.querySelectorAll('[data-fr-vista]').forEach(b => b.classList.toggle('on', b.dataset.frVista === FR.vista));
  const el = $('fr-vista');
  if (FR.vista === 'docs') {
    if (FR.ordenSel && ord(FR.ordenSel)) return renderDocsOrden(el, ord(FR.ordenSel));
    const l = FR.ordenes.filter(o => o.estado !== 'cancelada' && (activa(o) || docsDe(o.id).length || requiereFrontera(o))).slice(0, 80);
    el.innerHTML = l.length ? l.map(o => {
      const s = TX.saludDocs(docsDe(o.id)), f = faltantes(o);
      return `<div class="tx-doc"><div class="tx-doc-info"><b>📋 ${esc(o.numero)} · ${esc(o.cliente_nombre || 'Sin cliente')}</b>
        <small>${esc(o.origen || '—')} → ${esc(o.destino || '—')}${requiereFrontera(o) ? ' · 🛂 cruza frontera' : ''}</small>
        <div class="tx-fila-chips"><span class="tx-chip ${s.clase}">${esc(s.texto)}</span>${f.length ? `<span class="tx-chip rojo">Faltan: ${esc(f.join(', '))}</span>` : ''}</div></div>
        <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-fr-orden="${esc(o.id)}">Abrir</button></div></div>`;
    }).join('') : '<div class="tx-vacio"><div class="tx-vacio-i">🗂️</div><b>Sin órdenes</b><p>Cuando crees órdenes de transporte podrás adjuntar aquí sus documentos.</p></div>';
    return;
  }
  el.innerHTML = `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-primary" data-fr-nuevo>＋ Registrar cruce</button></div>` +
    (FR.cruces.length ? FR.cruces.map(filaCruce).join('') : '<div class="tx-vacio"><div class="tx-vacio-i">🛂</div><b>Sin cruces registrados</b><p>Registra los cruces de frontera de tus viajes internacionales para dar seguimiento a cada trámite.</p></div>');
}
function renderDocsOrden(el, o) {
  const f = faltantes(o), cs = FR.cruces.filter(c => c.orden_id === o.id);
  el.innerHTML = `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-sm" data-fr-orden="">← Todas las órdenes</button>
      <button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-fr-carta="${esc(o.id)}">🖨️ Carta de porte</button>
      <button type="button" class="tx-btn tx-btn-sm" data-fr-nuevo="${esc(o.id)}">＋ Registrar cruce</button></div>
    <h3 style="margin:4px 0">📋 ${esc(o.numero)} · ${esc(o.cliente_nombre || '')}</h3>
    <small style="color:var(--text-secondary)">${esc(o.origen || '—')} → ${esc(o.destino || '—')}</small>
    ${f.length ? `<div class="tx-fila-chips" style="margin:8px 0"><span class="tx-chip rojo">Faltan documentos de frontera: ${esc(f.join(', '))}</span></div>` : ''}
    ${cs.length ? `<div class="tx-sec">Cruces</div>${cs.map(filaCruce).join('')}` : ''}
    <div class="tx-sec">Documentos de la orden</div>${TX.htmlDocs('orden', o.id, docsDe(o.id))}`;
}
function renderTodo() { renderKpis(); renderVista(); }
async function refrescarDocs() { FR.docs = TX.agruparDocs(await TX.cargarDocs('orden')); renderTodo(); }

/* ---------------- Cruces ---------------- */
function fronterasDe(o) {
  const r = rutaDe(o); if (!r || !r.fronteras) return [];
  return String(r.fronteras).split(/[,;\n/→>]+/).map(x => x.trim()).filter(Boolean);
}
function abrirCruce(id, ordenId) {
  const c = id ? FR.cruces.find(x => x.id === id) : null; FR.editId = id || null;
  const ords = FR.ordenes.filter(o => o.estado !== 'cancelada' && (c ? true : (activa(o) || requiereFrontera(o))));
  if (!ords.length) { TX.toast('Primero crea una orden de transporte.', 'error'); return; }
  $('fc-titulo').textContent = c ? 'Editar cruce' : 'Nuevo cruce de frontera';
  $('fc-orden').innerHTML = ords.map(o => `<option value="${esc(o.id)}">${esc(o.numero)} · ${esc(o.origen || '—')} → ${esc(o.destino || '—')}</option>`).join('');
  $('fc-orden').value = c?.orden_id || (ordenId && ords.some(o => o.id === ordenId) ? ordenId : ords[0].id);
  $('fc-orden').disabled = !!c;
  $('fc-frontera').value = c?.frontera || ''; $('fc-sentido').value = c?.sentido || 'ida'; $('fc-ref').value = c?.referencia || ''; $('fc-agente').value = c?.agente_aduanal || '';
  $('fc-costo').value = c && Number(c.costo_tramite) > 0 ? c.costo_tramite : ''; $('fc-notas').value = c?.notas || ''; $('fc-error').textContent = '';
  const bloqueaCosto = !!(c && c.costo_id);
  $('fc-costo').disabled = bloqueaCosto;
  $('fc-metodo').innerHTML = FR.metodos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
  const puedeCaja = FR.metodos.length > 0 && !!window.CajaAPI && !bloqueaCosto;
  $('fc-caja-wrap').style.display = puedeCaja ? '' : 'none'; $('fc-caja').checked = false; $('fc-metodo-wrap').style.display = 'none';
  sugerirFronteras(); cambiaMetodo();
  TX.abrir('fr-modal-cruce');
}
function sugerirFronteras() {
  const o = ord($('fc-orden').value), fs = fronterasDe(o);
  $('fc-fronteras').innerHTML = fs.map(f => `<option value="${esc(f)}"></option>`).join('');
  $('fc-ayuda').textContent = fs.length ? `Fronteras de la ruta: ${fs.join(', ')}` : '';
  if (!FR.editId && !$('fc-frontera').value && fs.length) $('fc-frontera').value = fs[0];
}
function cambiaMetodo() {
  const n = ($('fc-metodo').selectedOptions[0]?.textContent || '').toLowerCase();
  const nec = $('fc-caja').checked && (n.includes('tarjeta') || n.includes('transferencia')) && FR.bancos.length > 0;
  $('fc-banco-wrap').style.display = nec ? '' : 'none';
  if (nec) $('fc-banco').innerHTML = '<option value="">Selecciona un banco…</option>' + FR.bancos.map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('');
}
async function ultimoMovimientoId() {
  try { const { data } = await sb.from('movimientos_financieros').select('id').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }).limit(1).maybeSingle(); return data?.id || null; } catch (_) { return null; }
}
async function anularGasto(gastoId, motivo) {
  await sb.from('movimientos_financieros').update({ estado: 'anulado', anulado_en: new Date().toISOString(), anulado_motivo: motivo })
    .eq('referencia_tipo', 'gasto').eq('referencia_id', gastoId).eq('auth_user_id', TX.userId).eq('estado', 'completado');
  await sb.from('gastos').update({ estado: 'cancelado', cancelado_en: new Date().toISOString(), cancelado_motivo: motivo }).eq('id', gastoId).eq('auth_user_id', TX.userId);
}
async function guardarCruce() {
  const err = m => { $('fc-error').textContent = m; };
  const o = ord($('fc-orden').value); if (!o) return err('Elige la orden.');
  const frontera = $('fc-frontera').value.trim(); if (!frontera) return err('Escribe el nombre de la frontera.');
  const c = FR.editId ? FR.cruces.find(x => x.id === FR.editId) : null;
  const costo = c?.costo_id ? Number(c.costo_tramite) : (num($('fc-costo').value) || 0);
  if (costo < 0) return err('El costo no puede ser negativo.');
  const caja = costo > 0 && !c?.costo_id && $('fc-caja-wrap').style.display !== 'none' && $('fc-caja').checked;
  let metodo = null, bancoId = null;
  if (caja) {
    metodo = FR.metodos.find(m => m.id === $('fc-metodo').value); if (!metodo) return err('Elige el método de pago.');
    if ($('fc-banco-wrap').style.display !== 'none') { bancoId = $('fc-banco').value; if (!bancoId) return err('Selecciona de qué banco sale el dinero.'); }
  }
  const base = { frontera, sentido: $('fc-sentido').value, referencia: $('fc-ref').value.trim() || null, agente_aduanal: $('fc-agente').value.trim() || null, notas: $('fc-notas').value.trim() || null };
  const btn = $('fc-guardar'); btn.disabled = true;
  let gastoId = null, costoId = null, cruceId = null;
  try {
    if (c) {
      const { error } = await sb.from('transporte_cruces').update(base).eq('id', c.id).eq('auth_user_id', TX.userId); if (error) throw error;
      if (costo > 0 && !c.costo_id) {
        // costo agregado después: se registra igual que al crear
        cruceId = c.id;
      }
    }
    if (!c) {
      const { data, error } = await sb.from('transporte_cruces').insert({ ...base, auth_user_id: TX.userId, orden_id: o.id, estado: 'pendiente', costo_tramite: 0 }).select().single();
      if (error) throw error; cruceId = data.id;
    }
    if (cruceId && costo > 0) {
      const fecha = TX.hoyISO(), desc = `Frontera ${frontera}${base.referencia ? ' · trámite ' + base.referencia : ''}`;
      let movId = null;
      if (caja) {
        const concepto = `Transporte ${o.numero} · Trámites de frontera: ${desc}`, obs = `Orden de transporte ${o.numero} (${o.cliente_nombre || 'cliente'})`;
        const { data: g, error: eg } = await sb.from('gastos').insert({
          auth_user_id: TX.userId, tipo: 'inmediato', concepto, categoria: 'Otros', monto: costo, fecha, metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre,
          impuesto: 0, observaciones: obs, estado: 'activo',
        }).select().single();
        if (eg) throw eg;
        gastoId = g.id;
        const mov = await window.CajaAPI.registrarMovimiento({
          auth_user_id: TX.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO', concepto: `Otros: ${concepto}`, monto: costo,
          metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre, origen_caja: null, banco_id: bancoId || null,
          referencia_tipo: 'gasto', referencia_id: g.id, observaciones: obs, fecha,
        });
        if (!mov.ok) { await sb.from('gastos').delete().eq('id', g.id).eq('auth_user_id', TX.userId); gastoId = null; throw new Error('Caja: ' + mov.error); }
        movId = await ultimoMovimientoId();
        if (movId) await sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', g.id).eq('auth_user_id', TX.userId);
      }
      const { data: k, error: ek } = await sb.from('transporte_costos').insert({
        auth_user_id: TX.userId, orden_id: o.id, categoria: 'frontera', descripcion: desc, monto: costo, fecha, gasto_id: gastoId, movimiento_caja_id: movId,
      }).select().single();
      if (ek) throw ek;
      costoId = k.id;
      const { error: eu } = await sb.from('transporte_cruces').update({ costo_tramite: costo, costo_id: costoId }).eq('id', cruceId).eq('auth_user_id', TX.userId);
      if (eu) throw eu;
    }
    TX.cerrar('fr-modal-cruce'); TX.toast(caja ? 'Cruce guardado y costo descontado de Caja' : 'Cruce guardado');
    await cargarTodo(); renderTodo();
  } catch (e) {
    console.error(e);
    try {
      if (costoId) await sb.from('transporte_costos').delete().eq('id', costoId).eq('auth_user_id', TX.userId);
      if (gastoId) await anularGasto(gastoId, 'No se pudo guardar el cruce de frontera');
      if (cruceId && !c) await sb.from('transporte_cruces').delete().eq('id', cruceId).eq('auth_user_id', TX.userId);
    } catch (_) {}
    err('No se pudo guardar el cruce. No se registró nada en Caja.');
  } finally { btn.disabled = false; }
}
async function avanzar(id, accion) {
  const c = FR.cruces.find(x => x.id === id); if (!c) return;
  const ahora = new Date().toISOString();
  const patch = accion === 'llego' ? { estado: 'en_tramite', llegada_en: ahora } : accion === 'cruzo' ? { estado: 'cruzado', cruce_en: ahora, llegada_en: c.llegada_en || ahora } : { estado: 'retenido', llegada_en: c.llegada_en || ahora };
  try {
    const { error } = await sb.from('transporte_cruces').update(patch).eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error;
    Object.assign(c, patch); TX.toast(accion === 'cruzo' ? 'Cruce completado' : accion === 'llego' ? 'Llegada registrada' : 'Marcado como retenido'); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo actualizar el cruce.', 'error'); }
}
async function borrarCruce(id) {
  const c = FR.cruces.find(x => x.id === id); if (!c) return;
  const txt = c.costo_id ? 'Se quita también su costo del viaje; si salió de Caja, el dinero vuelve.' : 'Se quita el registro del cruce.';
  if (!await TX.confirmar('¿Eliminar este cruce?', txt, 'Eliminar', true)) return;
  try {
    if (c.costo_id) {
      const { data: k } = await sb.from('transporte_costos').select('gasto_id').eq('id', c.costo_id).eq('auth_user_id', TX.userId).maybeSingle();
      if (k?.gasto_id) await anularGasto(k.gasto_id, 'Cruce de frontera eliminado');
      await sb.from('transporte_costos').delete().eq('id', c.costo_id).eq('auth_user_id', TX.userId);
    }
    const { error } = await sb.from('transporte_cruces').delete().eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error;
    TX.toast('Cruce eliminado'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo eliminar el cruce.', 'error'); }
}

/* ---------------- Carta de porte (imprimible) ---------------- */
function cartaPorte(id) {
  const o = ord(id); if (!o) return;
  const u = FR.unidades.find(x => x.id === o.unidad_id), rem = FR.unidades.find(x => x.id === o.remolque_id), cd = FR.conductores.find(x => x.id === o.conductor_id);
  const r = rutaDe(o), neg = TX.empresaConfig?.nombre_comercial || 'Mi empresa';
  const fecha = TX.fmtFecha(o.salida_real || o.fecha_programada || o.created_at);
  const fila = (a, b) => `<tr><th>${esc(a)}</th><td>${esc(b == null || b === '' ? '—' : b)}</td></tr>`;
  // Transporte: flota propia o transportista externo (con sus dos placas: cabezal y furgón/remolque).
  const sv = o.subcontratada ? (FR.subs || []).find(x => x.orden_id === o.id) : null;
  const tipoT = k => (k && TX.TIPOS_UNIDAD[k]) ? TX.TIPOS_UNIDAD[k].t : '';
  const unid = (x, tipo, placa) => x ? [tipoT(x.tipo), x.nombre, x.placa].filter(Boolean).join(' · ') : [tipoT(tipo), placa].filter(Boolean).join(' · ');
  const filasTransporte = sv
    ? fila('Transportista', sv.subcontratista_nombre || 'Transportista externo') + fila('Cabezal (tipo · placa)', unid(null, sv.tipo_unidad, sv.placa)) + fila('Furgón / remolque (tipo · placa)', unid(null, sv.tipo_furgon, sv.placa_furgon)) + fila('Conductor', sv.conductor_nombre)
    : fila('Cabezal / unidad (tipo · placa)', u ? unid(u) : (o.subcontratada ? 'Transportista externo' : '')) + fila('Furgón / remolque (tipo · placa)', rem ? unid(rem) : '') + fila('Conductor', cd ? [cd.nombre, cd.cedula && 'Céd. ' + cd.cedula, cd.licencia_tipo && 'Lic. ' + cd.licencia_tipo].filter(Boolean).join(' · ') : '');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Carta de porte ${esc(o.numero)}</title>
    <style>body{font-family:Arial,sans-serif;margin:28px;color:#111}h1{font-size:20px;margin:0}h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #111;padding-bottom:3px}
    table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;width:32%;padding:5px 8px;background:#f3f3f3;border:1px solid #ccc}td{padding:5px 8px;border:1px solid #ccc}
    .top{display:flex;justify-content:space-between;align-items:flex-start}.firmas{display:flex;gap:30px;margin-top:60px}.firmas div{flex:1;border-top:1px solid #111;text-align:center;font-size:12px;padding-top:4px}
    [contenteditable]:hover{background:#fff8d6;outline:1px dashed #b8a000}[contenteditable]:focus{background:#fff3b0;outline:2px solid #b8a000}.aviso{background:#eef6ff;border:1px solid #9cc4ee;border-radius:6px;padding:8px 12px;font-size:12.5px;margin-bottom:14px}@media print{button,.aviso{display:none}[contenteditable]:hover,[contenteditable]:focus{background:none;outline:none}}</style></head><body>
    <div class="aviso">✏️ Toca cualquier dato para corregirlo antes de imprimir. Los cambios son solo para esta impresión: no modifican la orden.</div>
    <div class="top"><div><h1>CARTA DE PORTE</h1><div style="font-size:13px;margin-top:4px">${esc(neg)}</div></div><div style="text-align:right;font-size:13px"><b>N.º CP-${esc(o.numero)}</b><br>Fecha: ${esc(fecha)}</div></div>
    <h2>Remitente / cliente</h2><table>${fila('Cliente', o.cliente_nombre)}${fila('Origen', o.origen)}${fila('Destino', o.destino)}${fila('Países', r ? [r.pais_origen, r.pais_destino].filter(Boolean).join(' → ') : '')}${fila('Fronteras', r?.cruza_frontera ? r.fronteras : 'No cruza frontera')}</table>
    <h2>Mercancía</h2><table>${fila('Descripción de la carga', o.carga_descripcion)}${fila('Peso (ton)', o.peso_ton)}${fila('Volumen (m³)', o.volumen_m3)}${fila('Bultos', o.bultos)}</table>
    <h2>Transporte</h2><table>${filasTransporte}</table>
    ${o.notas ? `<h2>Observaciones</h2><table>${fila('Notas', o.notas)}</table>` : ''}
    <div class="firmas"><div>Remitente</div><div>Transportista / conductor</div><div>Receptor</div></div>
    <p style="margin-top:24px"><button onclick="window.print()">🖨️ Imprimir</button></p></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { TX.toast('Tu navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.', 'error'); return; }
  w.document.write(html); w.document.close();
  try { w.document.querySelectorAll('td,.top h1,.top b').forEach(el => el.setAttribute('contenteditable', 'true')); } catch (_) {}
}

/* ---------------- Eventos ---------------- */
function enlazar() {
  $('fc-guardar').addEventListener('click', guardarCruce);
  $('fc-orden').addEventListener('change', () => { $('fc-frontera').value = ''; FR.editId = null; sugerirFronteras(); });
  $('fc-caja').addEventListener('change', () => { $('fc-metodo-wrap').style.display = $('fc-caja').checked ? '' : 'none'; cambiaMetodo(); });
  $('fc-metodo').addEventListener('change', cambiaMetodo);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-fr-vista],[data-fr-nuevo],[data-fr-editar],[data-fr-borrar],[data-fr-avanzar],[data-fr-orden],[data-fr-carta],[data-tx-doc-nuevo],[data-tx-doc-editar],[data-tx-doc-borrar]');
    if (!t) return; const d = t.dataset;
    if (d.frVista) { FR.vista = d.frVista; if (d.frVista === 'cruces') FR.ordenSel = null; renderVista(); }
    else if ('frNuevo' in d) abrirCruce(null, d.frNuevo || null);
    else if (d.frEditar) abrirCruce(d.frEditar);
    else if (d.frBorrar) borrarCruce(d.frBorrar);
    else if (d.frAvanzar) avanzar(d.frAvanzar, d.a);
    else if ('frOrden' in d) { FR.vista = 'docs'; FR.ordenSel = d.frOrden || null; renderVista(); }
    else if (d.frCarta) cartaPorte(d.frCarta);
    else if (d.txDocNuevo) TX.abrirDoc('orden', d.txDocNuevo, null, refrescarDocs);
    else if (d.txDocEditar) { const doc = docsDe(FR.ordenSel).find(x => x.id === d.txDocEditar); if (doc) TX.abrirDoc('orden', FR.ordenSel, doc, refrescarDocs); }
    else if (d.txDocBorrar) { const doc = docsDe(FR.ordenSel).find(x => x.id === d.txDocBorrar); if (doc) TX.quitarDoc(doc, refrescarDocs); }
  });
}

window.FR = FR;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => {
    enlazar(); await cargarTodo(); renderTodo();
    const p = new URLSearchParams(location.search).get('orden');
    if (p && ord(p)) { FR.vista = 'docs'; FR.ordenSel = p; renderVista(); }
  });
});
