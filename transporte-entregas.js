/* ============================================================
   TRANSPORTE-ENTREGAS.JS — NEGOCIO360 (Transporte · Fase 12)
   Prueba de entrega con firma e incidencias / reclamos.
   - Prueba de entrega: quién recibió, cuándo, bultos, si llegó conforme o con
     novedades y firma dibujada en pantalla. Se guarda aparte (transporte_entregas);
     no cambia el estado ni el costo de la orden. Las fotos del acuse usan el mismo
     sistema de documentos de las órdenes.
   - Incidencias: retrasos, daños, faltantes, accidentes, averías, robos, multas y
     reclamos, con gravedad, estado de gestión, evidencias y montos de seguimiento
     (no mueven Caja).
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, num } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);

const EN = { vista: 'entregas', ordenes: [], entregas: [], incs: [], docsO: {}, docsI: {}, unidades: [], conductores: [], rutas: [], filtroEnt: '', filtroInc: 'activas', q: '', ordenSel: null, incSel: null, editInc: null, editEnt: null, firmaDirty: false };
const TIPOS_INC = {
  retraso:   { t: 'Retraso', ico: '⏱️' },
  dano_carga: { t: 'Daño a la carga', ico: '💥' },
  faltante:  { t: 'Faltante de mercancía', ico: '📉' },
  accidente: { t: 'Accidente', ico: '🚨' },
  averia:    { t: 'Avería mecánica', ico: '🔧' },
  robo:      { t: 'Robo o pérdida', ico: '🔒' },
  multa:     { t: 'Multa o retención', ico: '🚔' },
  reclamo:   { t: 'Reclamo del cliente', ico: '📩' },
  otro:      { t: 'Otro', ico: '❓' },
};
const ESTADO_INC = {
  abierta:    { t: 'Abierta', clase: 'rojo', ico: '🔴' },
  en_gestion: { t: 'En gestión', clase: 'azul', ico: '🔵' },
  resuelta:   { t: 'Resuelta', clase: 'verde', ico: '🟢' },
};
const GRAV = { baja: { t: 'Baja', clase: 'gris' }, media: { t: 'Media', clase: 'naranja' }, alta: { t: 'Alta', clase: 'rojo' } };

async function cargarTodo() {
  const [ordenes, entregas, incs, docsO, docsI, unidades, conductores, rutas] = await Promise.all([
    TX.paginar(() => sb.from('transporte_ordenes').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.paginar(() => sb.from('transporte_entregas').select('*').eq('auth_user_id', TX.userId)),
    TX.paginar(() => sb.from('transporte_incidencias').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.cargarDocs('orden'), TX.cargarDocs('incidencia'),
    TX.paginar(() => sb.from('transporte_unidades').select('id,nombre,placa').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_conductores').select('id,nombre').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_rutas').select('id,nombre').eq('auth_user_id', TX.userId)),
  ]);
  EN.ordenes = ordenes; EN.entregas = entregas; EN.incs = incs; EN.docsO = TX.agruparDocs(docsO); EN.docsI = TX.agruparDocs(docsI);
  EN.unidades = unidades; EN.conductores = conductores; EN.rutas = rutas;
}
const ord = id => EN.ordenes.find(o => o.id === id);
const entDe = id => EN.entregas.find(e => e.orden_id === id);
const inc = id => EN.incs.find(i => i.id === id);
const incsDe = oid => EN.incs.filter(i => i.orden_id === oid);
const nomU = id => { const u = EN.unidades.find(x => x.id === id); return u ? `${u.nombre}${u.placa ? ' · ' + u.placa : ''}` : '—'; };
const nomC = id => EN.conductores.find(x => x.id === id)?.nombre || '—';
const abierta = i => i.estado !== 'resuelta';
const lt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtHora = iso => { if (!iso) return '—'; const d = new Date(iso); return isFinite(d) ? d.toLocaleString('es-NI', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };

/* ---------------- Pintado ---------------- */
const entregables = () => EN.ordenes.filter(o => ['entregada', 'en_ruta'].includes(o.estado));
function renderKpis() {
  const lim = TX.ymd(new Date(Date.now() - 30 * 86400000));
  const sin = EN.ordenes.filter(o => o.estado === 'entregada' && !entDe(o.id) && String(o.entrega_real || o.created_at).slice(0, 10) >= lim).length;
  const nov = EN.entregas.filter(e => e.conforme === false).length;
  const ab = EN.incs.filter(abierta), rec = ab.reduce((s, i) => s + Number(i.monto_reclamado || 0), 0), alta = ab.filter(i => i.gravedad === 'alta').length;
  $('en-kpis').innerHTML = `
    <div class="tx-kpi ${sin ? 'aviso' : ''}"><span>Sin prueba de entrega</span><b>${sin}</b><small>entregadas en 30 días</small></div>
    <div class="tx-kpi ${nov ? 'aviso' : ''}"><span>Entregas con novedades</span><b>${nov}</b><small>llegaron con problemas</small></div>
    <div class="tx-kpi ${ab.length ? 'alerta' : ''}"><span>Incidencias abiertas</span><b>${ab.length}</b><small>${alta} de gravedad alta</small></div>
    <div class="tx-kpi"><span>Reclamado sin resolver</span><b>${esc(money(rec))}</b><small>en incidencias abiertas</small></div>`;
}
function chipEntrega(o) {
  const e = entDe(o.id);
  if (!e) return o.estado === 'entregada' ? '<span class="tx-chip naranja">Sin prueba de entrega</span>' : '<span class="tx-chip azul">En ruta</span>';
  return e.conforme === false ? '<span class="tx-chip rojo">Con novedades</span>' : '<span class="tx-chip verde">Entrega conforme</span>';
}
function vistaEntregas() {
  const f = EN.filtroEnt, q = TX.quitarTildes(EN.q);
  let l = entregables();
  if (f === 'sin') l = l.filter(o => o.estado === 'entregada' && !entDe(o.id));
  if (f === 'novedad') l = l.filter(o => entDe(o.id)?.conforme === false);
  if (q) l = l.filter(o => TX.quitarTildes([o.numero, o.cliente_nombre, o.destino, o.receptor].join(' ')).includes(q));
  l = l.sort((a, b) => String(b.entrega_real || b.salida_real || b.created_at).localeCompare(String(a.entrega_real || a.salida_real || a.created_at))).slice(0, 120);
  const barra = `<div class="tx-barra"><input id="en-q" placeholder="Buscar por orden, cliente o receptor…" value="${esc(EN.q)}"/><select id="en-f-ent"><option value="">Todas</option><option value="sin" ${f === 'sin' ? 'selected' : ''}>Sin prueba de entrega</option><option value="novedad" ${f === 'novedad' ? 'selected' : ''}>Con novedades</option></select></div>`;
  if (!l.length) return barra + `<div class="tx-vacio"><div class="tx-vacio-i">📦</div><b>Sin entregas para mostrar</b><p>Cuando una orden pase a “En ruta” o “Entregada” aparecerá aquí para registrar su prueba de entrega.</p></div>`;
  return barra + l.map(o => {
    const e = entDe(o.id), id = esc(o.id);
    return `<div class="tx-doc"><div class="tx-doc-info"><b>📋 ${esc(o.numero)} · ${esc(o.cliente_nombre || 'Sin cliente')} ${chipEntrega(o)}${incsDe(o.id).some(abierta) ? '<span class="tx-chip rojo">⚠️ Incidencia abierta</span>' : ''}</b>
      <small>${esc(o.origen || '—')} → ${esc(o.destino || '—')}${o.entrega_real ? ' · entregada ' + esc(fmtHora(o.entrega_real)) : ''}</small>
      <small>${e ? `Recibió: ${esc(e.receptor)}${e.firma_url ? ' · con firma' : ''}` : o.receptor ? `Recibió (según la orden): ${esc(o.receptor)}` : ''}</small></div>
      <div class="tx-fila-chips">${o.estado === 'entregada' && !e ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-en-entrega="${id}">Registrar prueba</button>` : ''}
        <button type="button" class="tx-btn tx-btn-sm" data-en-orden="${id}">Abrir</button></div></div>`;
  }).join('');
}
function vistaOrden(o) {
  const e = entDe(o.id), id = esc(o.id), is = incsDe(o.id);
  return `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-sm" data-en-orden="">← Todas las entregas</button>
      ${o.estado === 'entregada' ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-en-entrega="${id}">${e ? '✏️ Editar prueba de entrega' : 'Registrar prueba de entrega'}</button>` : ''}
      ${e ? `<button type="button" class="tx-btn tx-btn-sm" data-en-acta="${id}">🖨️ Acta de entrega</button>` : ''}
      <button type="button" class="tx-btn tx-btn-sm" data-en-inc-nueva="${id}">⚠️ Nueva incidencia</button></div>
    <h3 style="margin:4px 0">📋 ${esc(o.numero)} · ${esc(o.cliente_nombre || '')} ${chipEntrega(o)}</h3>
    <small style="color:var(--text-secondary)">${esc(o.origen || '—')} → ${esc(o.destino || '—')} · ${esc(nomU(o.unidad_id))} · ${esc(nomC(o.conductor_id))}</small>
    ${o.estado !== 'entregada' ? '<div class="tx-aviso-banda" style="margin-top:10px"><div style="font-size:22px">🚚</div><div><b>La orden todavía no está entregada</b>Primero registra la entrega en <a href="transporte-ordenes.html">Órdenes</a>; luego podrás guardar aquí su prueba de entrega con firma.</div></div>' : ''}
    ${e ? `<div class="tx-sec">Prueba de entrega</div><div class="tx-datos">
        <div class="tx-dato"><span>Recibió</span><b>${esc(e.receptor)}</b></div><div class="tx-dato"><span>Documento</span><b>${esc(e.receptor_documento || '—')}</b></div>
        <div class="tx-dato"><span>Fecha</span><b>${esc(fmtHora(e.recibido_en))}</b></div><div class="tx-dato"><span>Bultos</span><b>${e.bultos_recibidos != null ? esc(e.bultos_recibidos) : '—'}${o.bultos != null ? ' de ' + esc(o.bultos) : ''}</b></div></div>
      ${e.observaciones ? `<p style="font-size:13px;margin:6px 0"><b>Observaciones:</b> ${esc(e.observaciones)}</p>` : ''}
      ${e.firma_url ? `<div style="margin:8px 0"><small style="color:var(--text-secondary)">Firma del receptor</small><br><img src="${esc(e.firma_url)}" alt="Firma" style="max-width:320px;width:100%;border:1px solid var(--border);border-radius:10px;background:#fff"/></div>` : ''}` : ''}
    ${is.length ? `<div class="tx-sec">Incidencias de esta orden</div>${is.map(filaInc).join('')}` : ''}
    <div class="tx-sec">Evidencia y documentos de la orden</div>${TX.htmlDocs('orden', o.id, EN.docsO[o.id] || [])}`;
}
function filaInc(i) {
  const t = TIPOS_INC[i.tipo] || TIPOS_INC.otro, e = ESTADO_INC[i.estado] || ESTADO_INC.abierta, g = GRAV[i.gravedad] || GRAV.media, o = ord(i.orden_id), id = esc(i.id);
  return `<div class="tx-doc"><div class="tx-doc-info"><b>${t.ico} ${esc(i.numero)} · ${esc(t.t)} <span class="tx-chip ${e.clase}">${e.ico} ${esc(e.t)}</span><span class="tx-chip ${g.clase}">Gravedad ${esc(g.t.toLowerCase())}</span></b>
    <small>${esc(i.descripcion)}</small>
    <small>${esc(TX.fmtFecha(i.fecha))}${o ? ' · ' + esc(o.numero) : ''}${i.unidad_id ? ' · ' + esc(nomU(i.unidad_id)) : ''}${i.conductor_id ? ' · ' + esc(nomC(i.conductor_id)) : ''}${Number(i.costo_estimado) > 0 ? ' · costo est. ' + esc(money(i.costo_estimado)) : ''}${Number(i.monto_reclamado) > 0 ? ' · reclamado ' + esc(money(i.monto_reclamado)) : ''}</small>
    ${i.resolucion ? `<small>Resolución: ${esc(i.resolucion)}${i.resuelta_en ? ' (' + esc(TX.fmtFecha(i.resuelta_en)) + ')' : ''}</small>` : ''}</div>
    <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-sm" data-en-inc-ver="${id}">Evidencia</button>
      ${i.estado === 'abierta' ? `<button type="button" class="tx-btn tx-btn-sm" data-en-inc-gestion="${id}">En gestión</button>` : ''}
      ${i.estado !== 'resuelta' ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-ok" data-en-inc-resolver="${id}">Resolver</button>` : `<button type="button" class="tx-btn tx-btn-sm" data-en-inc-reabrir="${id}">Reabrir</button>`}
      <button type="button" class="tx-btn tx-btn-sm" data-en-inc-editar="${id}">✏️</button><button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-en-inc-borrar="${id}">🗑</button></div></div>`;
}
function vistaIncidencias() {
  const f = EN.filtroInc, q = TX.quitarTildes(EN.q);
  let l = EN.incs.slice();
  if (f === 'activas') l = l.filter(abierta); else if (f) l = l.filter(i => i.estado === f);
  if (q) l = l.filter(i => TX.quitarTildes([i.numero, i.descripcion, TIPOS_INC[i.tipo]?.t, ord(i.orden_id)?.numero].join(' ')).includes(q));
  const barra = `<div class="tx-barra"><button type="button" class="tx-btn tx-btn-primary" data-en-inc-nueva="">＋ Nueva incidencia</button><input id="en-q" placeholder="Buscar incidencia…" value="${esc(EN.q)}"/>
    <select id="en-f-inc"><option value="activas" ${f === 'activas' ? 'selected' : ''}>Abiertas y en gestión</option><option value="abierta" ${f === 'abierta' ? 'selected' : ''}>Solo abiertas</option><option value="en_gestion" ${f === 'en_gestion' ? 'selected' : ''}>En gestión</option><option value="resuelta" ${f === 'resuelta' ? 'selected' : ''}>Resueltas</option><option value="" ${f === '' ? 'selected' : ''}>Todas</option></select></div>`;
  return barra + (l.length ? l.map(filaInc).join('') : `<div class="tx-vacio"><div class="tx-vacio-i">✅</div><b>Sin incidencias en esta lista</b><p>Registra aquí cualquier problema de un viaje (daños, faltantes, retrasos, accidentes) para darle seguimiento hasta resolverlo.</p></div>`);
}
function vistaIncDetalle(i) {
  const o = ord(i.orden_id);
  return `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-sm" data-en-inc-ver="">← Todas las incidencias</button></div>${filaInc(i)}
    ${o ? `<small style="color:var(--text-secondary)">Orden ${esc(o.numero)} · ${esc(o.cliente_nombre || '')} · <a href="#" data-en-orden="${esc(o.id)}">abrir orden</a></small>` : ''}
    <div class="tx-sec">Evidencia (fotos, parte policial, reclamos)</div>${TX.htmlDocs('incidencia', i.id, EN.docsI[i.id] || [])}`;
}
function renderVista() {
  document.querySelectorAll('[data-en-vista]').forEach(b => b.classList.toggle('on', b.dataset.enVista === EN.vista));
  const el = $('en-vista');
  if (EN.vista === 'incidencias') { const i = EN.incSel && inc(EN.incSel); el.innerHTML = i ? vistaIncDetalle(i) : vistaIncidencias(); }
  else { const o = EN.ordenSel && ord(EN.ordenSel); el.innerHTML = o ? vistaOrden(o) : vistaEntregas(); }
}
function renderTodo() { renderKpis(); renderVista(); }
async function refrescarDocs() { const [a, b] = await Promise.all([TX.cargarDocs('orden'), TX.cargarDocs('incidencia')]); EN.docsO = TX.agruparDocs(a); EN.docsI = TX.agruparDocs(b); renderVista(); }

/* ---------------- Firma ---------------- */
function prepararFirma() {
  const c = $('en-firma'), ctx = c.getContext('2d'); let dibujando = false, ult = null;
  const limpiar = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); EN.firmaDirty = false; };
  const pos = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  c.addEventListener('pointerdown', e => { dibujando = true; ult = pos(e); try { c.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  c.addEventListener('pointermove', e => {
    if (!dibujando) return; const p = pos(e);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(ult.x, ult.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ult = p; EN.firmaDirty = true; e.preventDefault();
  });
  const fin = () => { dibujando = false; };
  c.addEventListener('pointerup', fin); c.addEventListener('pointercancel', fin); c.addEventListener('pointerleave', fin);
  $('en-firma-borrar').addEventListener('click', limpiar);
  EN.limpiarFirma = limpiar; limpiar();
}
const firmaBlob = () => new Promise(res => $('en-firma').toBlob(b => res(b), 'image/png'));

/* ---------------- Prueba de entrega ---------------- */
function abrirEntrega(ordenId) {
  const o = ord(ordenId); if (!o) return; const e = entDe(ordenId); EN.editEnt = e || null; EN.entOrden = ordenId;
  $('en-titulo').textContent = e ? `Editar prueba de entrega · ${o.numero}` : `Prueba de entrega · ${o.numero}`;
  $('en-resumen').textContent = `${o.cliente_nombre || 'Sin cliente'} · ${o.origen || '—'} → ${o.destino || '—'}`;
  $('en-receptor').value = e?.receptor || o.receptor || ''; $('en-doc').value = e?.receptor_documento || '';
  $('en-fecha').value = lt(new Date(e?.recibido_en || o.entrega_real || Date.now())); $('en-bultos').value = e?.bultos_recibidos ?? o.bultos ?? '';
  $('en-conforme').value = e && e.conforme === false ? '0' : '1'; $('en-obs').value = e?.observaciones || ''; $('en-error').textContent = '';
  EN.limpiarFirma(); $('en-firma-actual').textContent = e?.firma_url ? 'Ya hay una firma guardada; si firmas de nuevo, se reemplaza.' : '';
  TX.abrir('en-modal-entrega');
}
async function guardarEntrega() {
  const err = m => { $('en-error').textContent = m; };
  const o = ord(EN.entOrden); if (!o) return;
  const receptor = $('en-receptor').value.trim(); if (!receptor) return err('Escribe quién recibió la carga.');
  const conforme = $('en-conforme').value === '1', obs = $('en-obs').value.trim();
  if (!conforme && !obs) return err('Describe las novedades en Observaciones.');
  const bultos = num($('en-bultos').value); if (bultos != null && bultos < 0) return err('Los bultos no pueden ser negativos.');
  const f = new Date($('en-fecha').value); const recibido = isFinite(f) ? f.toISOString() : new Date().toISOString();
  const btn = $('en-guardar'); btn.disabled = true;
  try {
    const prev = EN.editEnt; let firma_url = prev?.firma_url || null, firma_path = prev?.firma_path || null;
    if (EN.firmaDirty) {
      const b = await firmaBlob(); const sub = await TX.subirArchivo(b, 'firmas', 'png', 'image/png');
      if (firma_url) await TX.borrarArchivo(firma_path || firma_url);
      firma_url = sub.url; firma_path = sub.path;
    }
    const fila = { receptor, receptor_documento: $('en-doc').value.trim() || null, recibido_en: recibido, conforme, bultos_recibidos: bultos, observaciones: obs || null, firma_url, firma_path };
    const q = prev ? sb.from('transporte_entregas').update(fila).eq('id', prev.id).eq('auth_user_id', TX.userId) : sb.from('transporte_entregas').insert({ ...fila, auth_user_id: TX.userId, orden_id: o.id });
    const { error } = await q; if (error) throw error;
    if (!o.receptor) { try { await sb.from('transporte_ordenes').update({ receptor }).eq('id', o.id).eq('auth_user_id', TX.userId); } catch (_) {} }
    TX.cerrar('en-modal-entrega'); TX.toast('Prueba de entrega guardada'); await cargarTodo(); renderTodo();
    if (!conforme && !incsDe(o.id).some(abierta) && await TX.confirmar('¿Registrar una incidencia?', 'La carga llegó con novedades. ¿Quieres abrir una incidencia para darle seguimiento al reclamo?', 'Sí, registrar')) abrirInc(null, o.id, obs);
  } catch (e) { console.error(e); err(/duplicate|unique/i.test(e.message || '') ? 'Esta orden ya tiene prueba de entrega.' : 'No se pudo guardar la prueba de entrega.'); } finally { btn.disabled = false; }
}
function actaEntrega(id) {
  const o = ord(id), e = entDe(id); if (!o || !e) return;
  const neg = TX.empresaConfig?.nombre_comercial || 'Mi empresa';
  const fila = (a, b) => `<tr><th>${esc(a)}</th><td>${esc(b == null || b === '' ? '—' : b)}</td></tr>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta de entrega ${esc(o.numero)}</title>
    <style>body{font-family:Arial,sans-serif;margin:28px;color:#111}h1{font-size:20px;margin:0}h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;border-bottom:2px solid #111;padding-bottom:3px}
    table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;width:32%;padding:5px 8px;background:#f3f3f3;border:1px solid #ccc}td{padding:5px 8px;border:1px solid #ccc}
    @media print{button{display:none}}</style></head><body>
    <h1>ACTA DE ENTREGA</h1><div style="font-size:13px;margin:4px 0 0">${esc(neg)} · Orden ${esc(o.numero)}</div>
    <h2>Viaje</h2><table>${fila('Cliente', o.cliente_nombre)}${fila('Origen', o.origen)}${fila('Destino', o.destino)}${fila('Carga', o.carga_descripcion)}${fila('Bultos de la orden', o.bultos)}</table>
    <h2>Recepción</h2><table>${fila('Recibió', e.receptor)}${fila('Documento', e.receptor_documento)}${fila('Fecha y hora', fmtHora(e.recibido_en))}${fila('Bultos recibidos', e.bultos_recibidos)}${fila('Estado de la carga', e.conforme === false ? 'CON NOVEDADES' : 'Conforme')}${fila('Observaciones', e.observaciones)}</table>
    ${e.firma_url ? `<h2>Firma del receptor</h2><img src="${esc(e.firma_url)}" alt="Firma" style="max-width:320px;border:1px solid #ccc"/>` : ''}
    <p style="margin-top:24px"><button onclick="window.print()">🖨️ Imprimir</button></p></body></html>`;
  const w = window.open('', '_blank'); if (!w) { TX.toast('Tu navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.', 'error'); return; }
  w.document.write(html); w.document.close();
}

/* ---------------- Incidencias ---------------- */
function siguienteNumeroInc() {
  const n = EN.incs.reduce((m, i) => { const x = parseInt(String(i.numero).replace(/\D/g, ''), 10); return isFinite(x) && x > m ? x : m; }, 0);
  return 'INC-' + String(n + 1).padStart(4, '0');
}
function llenarSelectsInc() {
  $('in-orden').innerHTML = '<option value="">— Sin orden —</option>' + EN.ordenes.filter(o => o.estado !== 'cancelada').slice(0, 300).map(o => `<option value="${esc(o.id)}">${esc(o.numero)} · ${esc(o.cliente_nombre || '')} · ${esc(o.destino || '')}</option>`).join('');
  $('in-tipo').innerHTML = Object.entries(TIPOS_INC).map(([k, v]) => `<option value="${k}">${v.ico} ${esc(v.t)}</option>`).join('');
  $('in-unidad').innerHTML = '<option value="">—</option>' + EN.unidades.map(u => `<option value="${esc(u.id)}">${esc(nomU(u.id))}</option>`).join('');
  $('in-cond').innerHTML = '<option value="">—</option>' + EN.conductores.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('');
}
function abrirInc(id, ordenId, desc) {
  const i = id ? inc(id) : null; EN.editInc = id || null; llenarSelectsInc();
  $('in-titulo').textContent = i ? `Editar ${i.numero}` : 'Nueva incidencia';
  $('in-orden').value = i?.orden_id || ordenId || ''; $('in-tipo').value = i?.tipo || (desc ? 'reclamo' : 'otro'); $('in-grav').value = i?.gravedad || 'media';
  $('in-unidad').value = i?.unidad_id || ''; $('in-cond').value = i?.conductor_id || '';
  $('in-desc').value = i?.descripcion || desc || ''; $('in-fecha').value = i?.fecha || TX.hoyISO(); $('in-costo').value = i && Number(i.costo_estimado) > 0 ? i.costo_estimado : ''; $('in-reclamo').value = i && Number(i.monto_reclamado) > 0 ? i.monto_reclamado : '';
  $('in-error').textContent = ''; if (!i && ordenId) autoOrdenInc();
  TX.abrir('en-modal-inc');
}
function autoOrdenInc() { const o = ord($('in-orden').value); if (o) { if (o.unidad_id) $('in-unidad').value = o.unidad_id; if (o.conductor_id) $('in-cond').value = o.conductor_id; } }
async function guardarInc() {
  const err = m => { $('in-error').textContent = m; };
  const desc = $('in-desc').value.trim(); if (!desc) return err('Describe qué pasó.');
  const costo = num($('in-costo').value) || 0, rec = num($('in-reclamo').value) || 0; if (costo < 0 || rec < 0) return err('Los montos no pueden ser negativos.');
  const fila = { orden_id: $('in-orden').value || null, unidad_id: $('in-unidad').value || null, conductor_id: $('in-cond').value || null, tipo: $('in-tipo').value, gravedad: $('in-grav').value, descripcion: desc, fecha: $('in-fecha').value || TX.hoyISO(), costo_estimado: costo, monto_reclamado: rec };
  const btn = $('in-guardar'); btn.disabled = true;
  try {
    const q = EN.editInc ? sb.from('transporte_incidencias').update(fila).eq('id', EN.editInc).eq('auth_user_id', TX.userId) : sb.from('transporte_incidencias').insert({ ...fila, auth_user_id: TX.userId, numero: siguienteNumeroInc(), estado: 'abierta' });
    const { error } = await q; if (error) throw error;
    TX.cerrar('en-modal-inc'); TX.toast('Incidencia guardada');
    if (!EN.editInc) { EN.vista = 'incidencias'; EN.filtroInc = 'activas'; EN.incSel = null; }
    await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); err('No se pudo guardar la incidencia.'); } finally { btn.disabled = false; }
}
async function cambiarEstadoInc(id, patch, msg) {
  try { const { error } = await sb.from('transporte_incidencias').update(patch).eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error; TX.toast(msg); await cargarTodo(); renderTodo(); }
  catch (e) { console.error(e); TX.toast('No se pudo actualizar la incidencia.', 'error'); }
}
function abrirResolver(id) { EN.resId = id; $('ir-titulo').textContent = `Resolver ${inc(id)?.numero || ''}`; $('ir-texto').value = inc(id)?.resolucion || ''; $('ir-error').textContent = ''; TX.abrir('en-modal-res'); }
async function guardarResolver() {
  const t = $('ir-texto').value.trim(); if (!t) { $('ir-error').textContent = 'Escribe cómo se resolvió.'; return; }
  TX.cerrar('en-modal-res'); await cambiarEstadoInc(EN.resId, { estado: 'resuelta', resolucion: t, resuelta_en: new Date().toISOString() }, 'Incidencia resuelta');
}
async function borrarInc(id) {
  const i = inc(id); if (!i) return;
  if (!await TX.confirmar('¿Eliminar esta incidencia?', 'Se elimina también su evidencia adjunta.', 'Eliminar', true)) return;
  try {
    for (const d of (EN.docsI[id] || [])) { await sb.from('transporte_documentos').delete().eq('id', d.id).eq('auth_user_id', TX.userId); if (d.archivo_url) await TX.borrarArchivo(d.archivo_path || d.archivo_url); }
    const { error } = await sb.from('transporte_incidencias').delete().eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error;
    EN.incSel = null; TX.toast('Incidencia eliminada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo eliminar la incidencia.', 'error'); }
}

/* ---------------- Eventos ---------------- */
function enlazar() {
  prepararFirma();
  $('en-guardar').addEventListener('click', guardarEntrega);
  $('in-guardar').addEventListener('click', guardarInc);
  $('ir-guardar').addEventListener('click', guardarResolver);
  $('in-orden').addEventListener('change', autoOrdenInc);
  document.addEventListener('input', e => { if (e.target.id === 'en-q') { EN.q = e.target.value; const pos = e.target.selectionStart; renderVista(); const n = $('en-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } } });
  document.addEventListener('change', e => {
    if (e.target.id === 'en-f-ent') { EN.filtroEnt = e.target.value; renderVista(); }
    else if (e.target.id === 'en-f-inc') { EN.filtroInc = e.target.value; renderVista(); }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-en-vista],[data-en-entrega],[data-en-orden],[data-en-acta],[data-en-inc-nueva],[data-en-inc-ver],[data-en-inc-gestion],[data-en-inc-resolver],[data-en-inc-reabrir],[data-en-inc-editar],[data-en-inc-borrar],[data-tx-doc-nuevo],[data-tx-doc-editar],[data-tx-doc-borrar]');
    if (!t) return; const d = t.dataset; if (t.tagName === 'A') e.preventDefault();
    const docCtx = () => EN.vista === 'incidencias' ? { tipo: 'incidencia', id: EN.incSel, docs: EN.docsI } : { tipo: 'orden', id: EN.ordenSel, docs: EN.docsO };
    if (d.enVista) { EN.vista = d.enVista; renderVista(); }
    else if (d.enEntrega) abrirEntrega(d.enEntrega);
    else if ('enOrden' in d) { EN.vista = 'entregas'; EN.ordenSel = d.enOrden || null; renderTodo(); }
    else if (d.enActa) actaEntrega(d.enActa);
    else if ('enIncNueva' in d) abrirInc(null, d.enIncNueva || null);
    else if ('enIncVer' in d) { EN.vista = 'incidencias'; EN.incSel = d.enIncVer || null; renderTodo(); }
    else if (d.enIncGestion) cambiarEstadoInc(d.enIncGestion, { estado: 'en_gestion' }, 'Incidencia en gestión');
    else if (d.enIncResolver) abrirResolver(d.enIncResolver);
    else if (d.enIncReabrir) cambiarEstadoInc(d.enIncReabrir, { estado: 'abierta', resuelta_en: null }, 'Incidencia reabierta');
    else if (d.enIncEditar) abrirInc(d.enIncEditar);
    else if (d.enIncBorrar) borrarInc(d.enIncBorrar);
    else if (d.txDocNuevo) { const c = docCtx(); TX.abrirDoc(c.tipo, d.txDocNuevo, null, refrescarDocs); if (c.tipo === 'orden') { $('tx-doc-tipo').value = 'prueba_entrega'; } }
    else if (d.txDocEditar) { const c = docCtx(), doc = (c.docs[c.id] || []).find(x => x.id === d.txDocEditar); if (doc) TX.abrirDoc(c.tipo, c.id, doc, refrescarDocs); }
    else if (d.txDocBorrar) { const c = docCtx(), doc = (c.docs[c.id] || []).find(x => x.id === d.txDocBorrar); if (doc) TX.quitarDoc(doc, refrescarDocs); }
  });
}

window.EN = EN;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => {
    enlazar(); await cargarTodo();
    const q = new URLSearchParams(location.search), oid = q.get('orden');
    if (oid && ord(oid)) { EN.ordenSel = oid; }
    if (q.get('vista') === 'incidencias') EN.vista = 'incidencias';
    renderTodo();
  });
});
