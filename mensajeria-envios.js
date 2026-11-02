/* =====================================================
   MENSAJERIA-ENVIOS.JS — NEGOCIO360 · Mensajería: Envíos (guías)
   Registrar y editar envíos (la tarifa la calcula el servidor según
   zona, precio especial del comercio y recargos), ver su historial
   y foto de entrega, imprimir la etiqueta y avisar por WhatsApp.
   Todo cambio pasa por funciones del servidor (msj_*).
===================================================== */
'use strict';
const TE = { lista: [], zonas: [], comercios: [], reps: {}, filtro: 'activos', editando: null, ocupado: false, tarifaN: 0 };
const $e = id => document.getElementById(id);
const TE_TABS = [['activos', '📋 Activos'], ['por_recoger', '📍 Por recoger'], ['en_bodega', '🏬 En bodega'], ['asignado', '🧑 Asignados'], ['en_ruta', '🛵 En ruta'],
  ['no_entregado', '⚠️ No entregados'], ['entregado', '✅ Entregados'], ['cerrados', '↩️ Devueltos / cancelados'], ['todos', 'Todos']];

TE.cargar = async function () {
  const dias = Number($e('e-periodo').value || 7), desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - (dias - 1));
  $e('e-lista').innerHTML = '<div class="section-loading"><div class="mini-spinner"></div></div>';
  // Lo activo se ve siempre (aunque sea viejo); lo terminado, según el periodo elegido.
  const [act, ter] = await Promise.all([
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).in('estado', MS_ACTIVOS).order('created_at', { ascending: false }).limit(1000),
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).in('estado', ['entregado', 'devuelto', 'cancelado']).gte('created_at', desde.toISOString()).order('created_at', { ascending: false }).limit(1000),
  ]);
  TE.lista = [...(act.data || []), ...(ter.data || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  TE.pintar();
};
TE.pintarTabs = function () {
  const n = k => k === 'todos' ? TE.lista.length : k === 'activos' ? TE.lista.filter(e => MS_ACTIVOS.includes(e.estado)).length
    : k === 'cerrados' ? TE.lista.filter(e => ['devuelto', 'cancelado'].includes(e.estado)).length : TE.lista.filter(e => e.estado === k).length;
  $e('e-tabs').innerHTML = TE_TABS.map(([k, t]) => `<button type="button" role="tab" aria-selected="${TE.filtro === k}" class="ms-tab${TE.filtro === k ? ' activa' : ''}" onclick="TE.filtrar('${k}')">${t} <b>${n(k)}</b></button>`).join('');
};
TE.filtrar = function (k) { TE.filtro = k; TE.pintar(); };
TE.visibles = function () {
  const q = ($e('e-buscar').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return TE.lista.filter(e => {
    if (TE.filtro === 'activos' && !MS_ACTIVOS.includes(e.estado)) return false;
    if (TE.filtro === 'cerrados' && !['devuelto', 'cancelado'].includes(e.estado)) return false;
    if (!['activos', 'cerrados', 'todos'].includes(TE.filtro) && e.estado !== TE.filtro) return false;
    if (!q) return true;
    const txt = [e.numero, e.destinatario_nombre, e.destinatario_telefono, e.direccion, e.referencia, e.remitente_nombre, e.remitente_telefono, e.zona_nombre, e.descripcion]
      .join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return q.split(/\s+/).every(p => txt.includes(p));
  });
};
TE.pintar = function () {
  TE.pintarTabs();
  const l = TE.visibles();
  const cobrar = l.filter(e => MS_ACTIVOS.includes(e.estado)).reduce((a, e) => a + msPorCobrar(e), 0);
  const tarifas = l.filter(e => e.estado !== 'cancelado').reduce((a, e) => a + Number(e.tarifa || 0) + Number(e.recargo_reintentos || 0), 0);
  $e('e-resumen').innerHTML = `<div><b>${l.length}</b><span>envío${l.length === 1 ? '' : 's'} en la lista</span></div>
    <div><b>${fmt(tarifas)}</b><span>en tarifas de envío</span></div><div><b>${fmt(cobrar)}</b><span>por cobrar en la calle</span></div>`;
  if (!l.length) {
    $e('e-lista').innerHTML = `<div class="tl-vacio" style="grid-column:1/-1">${TE.lista.length ? 'Ningún envío coincide con la búsqueda.' : 'Aún no hay envíos. Toca “+ Nuevo envío” para registrar el primero.'}</div>`;
    return;
  }
  $e('e-lista').innerHTML = l.slice(0, 300).map(e => {
    const c = msPorCobrar(e), rep = TE.reps[e.repartidor_id];
    const puedeEditar = ['por_recoger', 'en_bodega', 'asignado', 'no_entregado'].includes(e.estado) && !e.tarifa_venta_id && !e.liquidacion_id;
    const puedeCobrar = e.envio_lo_paga === 'comercio' && !e.tarifa_venta_id && !e.liquidacion_id && e.estado !== 'cancelado' && Number(e.tarifa) + Number(e.recargo_reintentos || 0) > 0;
    return `<div class="tl-card ms-ot${e.urgente ? ' urg' : ''}">
      <h3><span class="ms-num">${esc(e.numero)}</span><span>${/^Portal/.test(e.creado_por || '') ? '<span class="ms-chip portal">🌐 Portal</span> ' : ''}${e.urgente ? '<span class="ms-chip urg">🚨 Urgente</span> ' : ''}${msChip(e.estado)}</span></h3>
      <div class="ms-linea">👤 <span><b>${esc(e.destinatario_nombre)}</b>${e.destinatario_telefono ? ' · ' + esc(e.destinatario_telefono) : ''}</span></div>
      <div class="ms-linea">📍 <span>${esc(e.direccion)}${e.zona_nombre ? ' · <b>' + esc(e.zona_nombre) + '</b>' : ''}</span></div>
      <div class="ms-linea">📤 <span>${esc(e.remitente_nombre)}</span></div>
      ${rep ? `<div class="ms-linea">🛵 <span>${esc(rep.nombre)}</span></div>` : ''}
      <div class="ms-linea">🧾 <span>Tarifa <b>${fmt(Number(e.tarifa) + Number(e.recargo_reintentos || 0))}</b> (${e.envio_lo_paga === 'destinatario' ? 'paga quien recibe' : 'paga quien envía'})${e.tarifa_venta_id ? ' <span class="ms-chip entregado">✔ cobrada</span>' : ''}${e.liquidacion_id ? ' <span class="ms-chip entregado">✔ liquidado</span>' : ''}</span></div>
      ${c > 0 && e.estado !== 'entregado' ? `<div><span class="ms-cobrar">💵 Cobrar ${fmt(c)}</span></div>` : ''}
      ${e.estado === 'entregado' ? `<div class="tl-muted">Recibió ${esc(e.recibio_nombre || '')} · ${tlFechaHora(e.entregado_at)}${e.metodo_cobro ? ' · ' + (e.metodo_cobro === 'efectivo' ? '💵 efectivo' : '🏦 transferencia') : ''}</div>` : ''}
      ${e.estado === 'no_entregado' && e.motivo_no_entrega ? `<div class="tl-aviso">⚠️ ${esc(e.motivo_no_entrega)}</div>` : ''}
      <div class="tl-acc">
        <button type="button" class="btn-secondary" onclick="TE.ver('${e.id}')">👁 Ver</button>
        ${puedeEditar ? `<button type="button" class="btn-secondary" onclick="TE.editar('${e.id}')">✏️ Editar</button>` : ''}
        <button type="button" class="btn-secondary" onclick="TE.etiqueta('${e.id}')">🏷️ Etiqueta</button>
        ${puedeCobrar ? `<button type="button" class="btn-secondary" onclick="TE.cobrar('${e.id}')">💳 Cobrar envío</button>` : ''}
        ${e.destinatario_telefono ? `<a class="btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center;padding:7px 11px;font-size:12.5px" target="_blank" rel="noopener" href="${esc(TE.waLink(e))}">💬 WhatsApp</a>` : ''}
        ${e.estado === 'por_recoger' ? `<button type="button" class="btn-secondary" onclick="TE.estado('${e.id}','en_bodega')">🏬 Ya llegó a bodega</button>` : ''}
        ${['por_recoger', 'en_bodega', 'asignado'].includes(e.estado) && !e.tarifa_venta_id ? `<button type="button" class="btn-secondary" style="color:var(--danger)" onclick="TE.estado('${e.id}','cancelado')">✖ Cancelar</button>` : ''}
        ${['en_bodega', 'no_entregado'].includes(e.estado) ? `<button type="button" class="btn-secondary" onclick="TE.estado('${e.id}','devuelto')">↩️ Devolver al remitente</button>` : ''}
      </div></div>`;
  }).join('') + (l.length > 300 ? `<div class="tl-vacio" style="grid-column:1/-1">Se muestran los primeros 300. Usa la búsqueda para encontrar los demás.</div>` : '');
};
TE.waLink = function (e) {
  const neg = TL.empresaConfig?.nombre_comercial || '', c = msPorCobrar(e);
  const link = msRastreoUrl(e);
  return msWa(e.destinatario_telefono, `Hola ${e.destinatario_nombre}, le saluda ${neg}. Tenemos su envío ${e.numero} de ${e.remitente_nombre}.${c > 0 && e.estado !== 'entregado' ? ' Monto a pagar al recibir: ' + fmt(c) + '.' : ''}${link ? ' Puede seguirlo aquí: ' + link : ''} ¿Nos confirma que podrá recibirlo?`);
};
// Cobrar la tarifa ahora (quien envía paga al dejar el paquete): venta normal en Ventas y Caja.
TE.cobrar = async function (id) {
  const e = TE.lista.find(x => x.id === id); if (!e) return;
  await msBancos();
  const monto = Number(e.tarifa) + Number(e.recargo_reintentos || 0);
  const m = msVentana('e-cobrar', `💳 Cobrar envío ${esc(e.numero)}`, `<div class="ms-total grande"><span>Tarifa del envío</span><b>${fmt(monto)}</b></div>
    <div class="tl-muted">Lo paga <b>${esc(e.remitente_nombre)}</b>. Queda como una venta normal (Ventas y Caja) y ya no se le cobra al liquidar.</div>
    ${msMetodoHTML('cob', '¿Cómo pagó?')}<div id="e-cob-av"></div>`,
    '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="e-cob-ok">Cobrar</button>', 460);
  msMetodoActivar(m);
  m.querySelector('#e-cob-ok').onclick = async () => {
    const met = msMetodoLeer(m, 'cob'), av = m.querySelector('#e-cob-av');
    if (met.metodo === 'transferencia' && !met.banco_id) { av.innerHTML = `<div class="tl-aviso">${MS_MOTIVOS.banco}</div>`; return; }
    const btn = m.querySelector('#e-cob-ok'); btn.disabled = true;
    const r = await msRpc('msj_envio_cobrar', { p: { envio_id: id, metodo: met.metodo, banco_id: met.banco_id, por: msPor() } });
    btn.disabled = false;
    if (!r.ok) { av.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
    m.classList.remove('abierto'); showToast(r.ya ? 'Ese envío ya estaba cobrado.' : `✅ Cobrado: venta ${r.venta.numero} por ${fmt(r.venta.total)}`); TE.cargar();
  };
};
TE.etiqueta = function (id) { const e = TE.lista.find(x => x.id === id); if (e) msEtiqueta(e); };
// Etiquetas de lo que se ve en la lista que aún no sale a entregar (máximo 100 por vez).
TE.etiquetas = function () {
  const l = TE.visibles().filter(e => ['por_recoger', 'en_bodega', 'asignado', 'no_entregado'].includes(e.estado));
  if (!l.length) { showToast('No hay envíos por salir en esta lista.', 'warning'); return; }
  if (l.length > 100) showToast('Se imprimen los primeros 100.', 'warning');
  msEtiquetas(l.slice(0, 100));
};
TE.copiarRastreo = async function (id) {
  const e = TE.lista.find(x => x.id === id), url = msRastreoUrl(e); if (!url) return;
  try { await navigator.clipboard.writeText(url); showToast('🔗 Enlace de rastreo copiado'); } catch (_) { prompt('Copia el enlace de rastreo:', url); }
};
TE.estado = async function (id, nuevo) {
  const e = TE.lista.find(x => x.id === id); if (!e) return;
  let motivo = null;
  if (nuevo === 'cancelado' || nuevo === 'devuelto') {
    motivo = prompt(nuevo === 'cancelado' ? `¿Por qué se cancela el envío ${e.numero}?` : `¿Por qué se devuelve el envío ${e.numero} al remitente?`);
    if (motivo === null) return;
    if (motivo.trim().length < 3) { showToast('Escribe el motivo (mínimo 3 letras).', 'error'); return; }
  }
  const r = await msRpc('msj_envio_estado', { p_id: id, p_nuevo: nuevo, p_motivo: motivo, p_por: msPor() });
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast(`${MS_ESTADOS[nuevo].i} ${e.numero}: ${MS_ESTADOS[nuevo].t.toLowerCase()}`); TE.cargar();
};

/* ---------- Ver: datos, historial y foto ---------- */
TE.ver = async function (id) {
  const e = TE.lista.find(x => x.id === id); if (!e) return;
  const m = msVentana('e-ver', `📦 ${esc(e.numero)} ${msChip(e.estado)}`, '<div class="section-loading"><div class="mini-spinner"></div></div>', '<button type="button" class="btn-secondary" data-cerrar>Cerrar</button>', 620);
  const [{ data: ev }, foto] = await Promise.all([
    sb.from('mensajeria_envio_eventos').select('*').eq('envio_id', id).order('created_at'),
    e.foto_path ? msVerFoto(e.foto_path) : Promise.resolve(''),
  ]);
  const rep = TE.reps[e.repartidor_id];
  m.querySelector('.tl-modal-cuerpo').innerHTML = `
    <div class="tl-sec"><b>📤 De</b><div class="ms-linea"><span>${esc(e.remitente_nombre)}${e.remitente_telefono ? ' · ' + esc(e.remitente_telefono) : ''}${e.recoger_direccion ? '<br>Recoger en: ' + esc(e.recoger_direccion) : ''}</span></div></div>
    <div class="tl-sec"><b>📥 Para</b><div class="ms-linea"><span><b>${esc(e.destinatario_nombre)}</b>${e.destinatario_telefono ? ' · ' + esc(e.destinatario_telefono) : ''}<br>${esc(e.direccion)}${e.referencia ? '<br>' + esc(e.referencia) : ''}${e.zona_nombre ? '<br>Zona: ' + esc(e.zona_nombre) : ''}</span></div>
      <div class="tl-acc"><a class="btn-secondary" style="text-decoration:none;padding:7px 11px;font-size:12.5px" target="_blank" rel="noopener" href="${esc(msMaps(e))}">🧭 Google Maps</a><a class="btn-secondary" style="text-decoration:none;padding:7px 11px;font-size:12.5px" target="_blank" rel="noopener" href="${esc(msWaze(e))}">🚗 Waze</a></div></div>
    <div class="tl-sec"><b>📦 Paquete</b><div class="ms-linea"><span>${esc(e.descripcion || 'Sin descripción')} · ${Number(e.paquetes)} paquete${Number(e.paquetes) === 1 ? '' : 's'} · ${esc(MS_TAMANOS[e.tamano])}${e.urgente ? ' · 🚨 urgente' : ''}</span></div>
      <div class="ms-total"><span>Tarifa del envío</span><b>${fmt(e.tarifa)}</b></div>
      ${Number(e.recargo_reintentos) > 0 ? `<div class="ms-total"><span>Recargo por reintentos</span><b>${fmt(e.recargo_reintentos)}</b></div>` : ''}
      <div class="ms-total"><span>Lo paga</span><b>${e.envio_lo_paga === 'destinatario' ? 'Quien recibe' : 'Quien envía'}</b></div>
      <div class="ms-total"><span>Cobrar contra entrega</span><b>${fmt(e.monto_cobrar)}</b></div>
      ${e.notas ? `<div class="tl-muted">📝 ${esc(e.notas)}</div>` : ''}</div>
    ${rep ? `<div class="tl-sec"><b>🛵 Repartidor</b><div class="ms-linea"><span>${esc(rep.nombre)}${rep.telefono ? ' · ' + esc(rep.telefono) : ''}</span></div></div>` : ''}
    ${e.estado === 'entregado' ? `<div class="tl-sec"><b>✅ Entrega</b><div class="ms-linea"><span>Recibió <b>${esc(e.recibio_nombre || '')}</b> · ${tlFechaHora(e.entregado_at)}${e.metodo_cobro ? '<br>Cobrado ' + fmt(Number(e.cobrado_cod) + Number(e.cobrado_envio)) + ' en ' + (e.metodo_cobro === 'efectivo' ? 'efectivo' : 'transferencia') : ''}${e.cuadre_id ? '<br>✔ Ya cuadrado con el repartidor' : ''}</span></div>
      ${foto ? `<img class="ms-foto-prev" src="${esc(foto)}" alt="Foto de la entrega">` : '<span class="tl-muted">Sin foto.</span>'}</div>` : ''}
    ${e.rastreo_token ? `<div class="tl-sec"><b>🔗 Rastreo para el cliente</b><div class="tl-muted">Quien espera el paquete ve en qué paso va, sin cuenta. No ve direcciones ni teléfonos.</div>
      <div class="tl-acc"><button type="button" class="btn-secondary" onclick="TE.copiarRastreo('${e.id}')">📋 Copiar enlace</button><a class="btn-secondary" style="text-decoration:none;padding:7px 11px;font-size:12.5px" target="_blank" rel="noopener" href="${esc(msRastreoUrl(e))}">👁 Ver como el cliente</a></div></div>` : ''}
    <div class="tl-sec"><b>🕓 Historial</b><div class="tl-hist" style="max-height:none">${(ev || []).map(x => `<div>• ${tlFechaHora(x.created_at)} — <b>${esc((MS_ESTADOS[x.evento] || {}).t || x.evento)}</b>${x.detalle ? ': ' + esc(x.detalle) : ''}${x.por ? ' <span class="tl-muted">(' + esc(x.por) + ')</span>' : ''}</div>`).join('') || 'Sin movimientos.'}</div></div>`;
};

/* ---------- Formulario ---------- */
TE.llenarSelects = function () {
  $e('f-comercio').innerHTML = '<option value="">Persona o comercio sin registrar</option>' + TE.comercios.map(c => `<option value="${c.id}">${esc(c.completo)}</option>`).join('');
  $e('f-zona').innerHTML = '<option value="">Sin zona</option>' + TE.zonas.filter(z => z.activo).map(z => `<option value="${z.id}">${esc(z.nombre)} · ${fmt(z.tarifa)}</option>`).join('');
};
TE.nuevo = function () { TE.abrir(null); };
TE.editar = function (id) { TE.abrir(TE.lista.find(x => x.id === id) || null); };
TE.abrir = function (e) {
  TE.editando = e; TE.llenarSelects();
  $e('e-titulo').textContent = e ? `Editar envío ${e.numero}` : 'Nuevo envío';
  const v = (id, x) => { $e(id).value = x ?? ''; };
  v('f-comercio', e?.comercio_id); v('f-rem', e?.remitente_nombre); v('f-remtel', e?.remitente_telefono); v('f-recoger', e?.recoger_direccion);
  v('f-des', e?.destinatario_nombre); v('f-destel', e?.destinatario_telefono); v('f-dir', e?.direccion); v('f-ref', e?.referencia);
  if (e && e.zona_id && !TE.zonas.some(z => z.id === e.zona_id && z.activo)) $e('f-zona').insertAdjacentHTML('beforeend', `<option value="${e.zona_id}">${esc(e.zona_nombre || 'Zona')}</option>`);
  v('f-zona', e?.zona_id); v('f-ubic', e && e.lat != null ? `${e.lat}, ${e.lng}` : '');
  v('f-desc', e?.descripcion); v('f-paq', e?.paquetes || 1); v('f-tam', e?.tamano || 'pequeno'); v('f-cobrar', e && Number(e.monto_cobrar) ? e.monto_cobrar : '');
  v('f-paga', e?.envio_lo_paga || 'comercio'); v('f-fecha', e?.fecha_programada || msHoyISO()); v('f-notas', e?.notas);
  $e('f-urg').checked = !!e?.urgente; $e('f-bodega').checked = false; $e('f-bodega-wrap').style.display = e ? 'none' : 'flex';
  $e('e-aviso').innerHTML = '';
  $e('e-modal').classList.add('abierto'); TE.tarifa();
  setTimeout(() => { if (!$e('e-modal').contains(document.activeElement)) $e(e ? 'f-des' : 'f-comercio').focus(); }, 60);
};
TE.cerrar = function () { $e('e-modal').classList.remove('abierto'); };
TE.alCambiarComercio = function () {
  const c = TE.comercios.find(x => x.id === $e('f-comercio').value);
  if (c) { $e('f-rem').value = c.completo; if (!$e('f-remtel').value) $e('f-remtel').value = c.telefono || ''; if (!$e('f-recoger').value) $e('f-recoger').value = c.direccion || ''; }
  TE.tarifa();
};
TE.comercioNuevo = function () {
  tlCrearCliente(c => { TE.comercios.push({ id: c.id, completo: c.nombre, nombre: c.nombre }); TE.comercios.sort((a, b) => a.completo.localeCompare(b.completo)); TE.llenarSelects(); $e('f-comercio').value = c.id; TE.alCambiarComercio(); });
};
// La tarifa la confirma el servidor al guardar; aquí solo se muestra antes.
TE.tarifa = async function () {
  const n = ++TE.tarifaN, zona = $e('f-zona').value || null;
  const el = $e('f-tarifa');
  if (!zona) { el.className = 'tl-aviso'; el.textContent = 'Elige la zona para calcular la tarifa del envío (sin zona, la tarifa queda en cero).'; return; }
  const { data } = await sb.rpc('msj_tarifa_calcular', { p_zona: zona, p_comercio: $e('f-comercio').value || null, p_urgente: $e('f-urg').checked, p_tamano: $e('f-tam').value });
  if (n !== TE.tarifaN) return;
  const t = Number(data || 0), cob = Number($e('f-cobrar').value || 0), paga = $e('f-paga').value;
  el.className = 'tl-aviso ok';
  el.innerHTML = `🧾 Tarifa del envío: <b>${fmt(t)}</b>${TE.editando && Number(TE.editando.recargo_reintentos) > 0 ? ' + reintentos ' + fmt(TE.editando.recargo_reintentos) : ''} · ` +
    (paga === 'destinatario' ? `el repartidor cobra <b>${fmt(cob + t + Number(TE.editando?.recargo_reintentos || 0))}</b> al entregar` : cob > 0 ? `el repartidor cobra <b>${fmt(cob)}</b> (producto)` : 'el repartidor no cobra nada');
};
TE.guardar = async function () {
  if (TE.ocupado) return;
  const av = $e('e-aviso'), g = id => $e(id).value.trim();
  const ub = msLeerUbicacion(g('f-ubic'));
  if (!ub.ok) { av.innerHTML = `<div class="tl-aviso">${MS_MOTIVOS.ubicacion}</div>`; return; }
  if (!$e('f-comercio').value && g('f-rem').length < 2) { av.innerHTML = '<div class="tl-aviso">Escribe quién envía (o elige el comercio).</div>'; $e('f-rem').focus(); return; }
  if (g('f-des').length < 2) { av.innerHTML = '<div class="tl-aviso">Escribe a quién va el envío.</div>'; $e('f-des').focus(); return; }
  if (g('f-dir').length < 3) { av.innerHTML = '<div class="tl-aviso">Escribe la dirección de entrega.</div>'; $e('f-dir').focus(); return; }
  const cobrar = Number(g('f-cobrar') || 0);
  if (!(cobrar >= 0)) { av.innerHTML = '<div class="tl-aviso">El monto a cobrar no es válido.</div>'; return; }
  if (cobrar > 0 && !$e('f-comercio').value) { av.innerHTML = `<div class="tl-aviso">${MS_MOTIVOS.cod_sin_comercio} Toca “➕ Registrar comercio”.</div>`; return; }
  // Sin zona la tarifa queda en cero: se avisa antes de guardar para que no pase sin querer.
  if (!$e('f-zona').value && TE.zonas.some(z => z.activo) && !(TE.editando && !TE.editando.zona_id)
    && !confirm('No elegiste la zona: este envío quedaría con tarifa ' + fmt(0) + ' y no ganarías nada por llevarlo.\n\n¿Registrarlo así de todos modos?')) { $e('f-zona').focus(); av.innerHTML = '<div class="tl-aviso">Elige la zona para que la tarifa salga sola.</div>'; return; }
  const p = {
    id: TE.editando?.id || null, comercio_id: $e('f-comercio').value || null, remitente_nombre: g('f-rem'), remitente_telefono: g('f-remtel'), recoger_direccion: g('f-recoger'),
    destinatario_nombre: g('f-des'), destinatario_telefono: g('f-destel'), direccion: g('f-dir'), referencia: g('f-ref'), zona_id: $e('f-zona').value || null,
    lat: ub.lat, lng: ub.lng, descripcion: g('f-desc'), paquetes: Number(g('f-paq') || 1), tamano: $e('f-tam').value, urgente: $e('f-urg').checked,
    monto_cobrar: cobrar, envio_lo_paga: $e('f-paga').value, fecha_programada: g('f-fecha') || null, notas: g('f-notas'), en_bodega: $e('f-bodega').checked, por: msPor(),
  };
  TE.ocupado = true; const btn = $e('e-guardar'); btn.disabled = true;
  const r = await msRpc('msj_envio_guardar', { p });
  TE.ocupado = false; btn.disabled = false;
  if (!r.ok) { av.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  TE.cerrar();
  showToast(TE.editando ? `✅ Envío ${r.numero} actualizado` : `✅ Envío ${r.numero} registrado · tarifa ${fmt(r.tarifa)}`);
  const nuevo = !TE.editando;
  await TE.cargar();
  if (nuevo) {
    const e = TE.lista.find(x => x.id === r.id);
    if (e) msVentana('e-listo', `✅ Envío ${esc(r.numero)} registrado`, `<div class="ms-linea">🧾 Tarifa del envío (lo que tú ganas): <b>${fmt(r.tarifa)}</b>${!e.zona_id ? ' <span class="ms-chip no_entregado">sin zona</span>' : ''}</div>${msPorCobrar(e) > 0 ? `<div class="ms-linea">💵 Al entregar, el repartidor cobra <b>${fmt(msPorCobrar(e))}</b>${Number(e.monto_cobrar) > 0 ? ` <span class="tl-muted">(producto ${fmt(e.monto_cobrar)}${e.envio_lo_paga === 'destinatario' ? ' + envío ' + fmt(Number(e.tarifa) + Number(e.recargo_reintentos || 0)) : ''}; el producto es del comercio)</span>` : ''}</div>` : ''}<div class="tl-muted">Pega la etiqueta en el paquete. Luego asígnalo a un repartidor en Despacho.</div>`,
      `<button type="button" class="btn-secondary" data-cerrar>Listo</button>${e.envio_lo_paga === 'comercio' && !e.comercio_id && Number(e.tarifa) > 0 ? `<button type="button" class="btn-secondary" onclick="document.getElementById('e-listo').classList.remove('abierto');TE.cobrar('${e.id}')">💳 Cobrar envío</button>` : ''}${e.destinatario_telefono ? `<a class="btn-secondary" style="text-decoration:none" target="_blank" rel="noopener" href="${esc(TE.waLink(e))}">💬 Avisar por WhatsApp</a>` : ''}<button type="button" class="btn-primary" onclick="TE.etiqueta('${e.id}')">🏷️ Imprimir etiqueta</button>`, 480);
  }
};

window.tallerListo = async function () {
  const [zonas, comercios, reps] = await Promise.all([msZonas(false), msComercios(), msRepartidores(false)]);
  TE.zonas = zonas; TE.comercios = comercios; reps.forEach(r => { TE.reps[r.id] = r; });
  try { const q = new URLSearchParams(location.search); if (q.get('estado')) TE.filtro = q.get('estado'); } catch (_) {}
  await TE.cargar();
  try { if (new URLSearchParams(location.search).get('nuevo') === '1') TE.nuevo(); } catch (_) {}
};
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('.tl-modal.abierto').forEach(m => m.classList.remove('abierto')); });
