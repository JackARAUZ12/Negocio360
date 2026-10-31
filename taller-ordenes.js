/* =====================================================
   TALLER-ORDENES.JS — NEGOCIO360 · Órdenes y presupuestos
   Tablero por estado, presupuesto por líneas con aprobación del
   cliente línea por línea, trabajos adicionales y entrega con cobro.
   Los números (totales, IVA, inventario, Caja) los calcula SIEMPRE
   el servidor; esta pantalla solo los muestra.
===================================================== */
'use strict';
const $ = id => document.getElementById(id);
const ESTADOS = [
  { k: 'recibido', n: 'Recibido', i: '🚗' }, { k: 'diagnostico', n: 'Diagnóstico', i: '🔍' }, { k: 'esperando_aprobacion', n: 'Esperando aprobación', i: '✅' },
  { k: 'en_reparacion', n: 'En reparación', i: '🔧' }, { k: 'listo', n: 'Listo para entregar', i: '🏁' },
];
const ETQ_ESTADO = { recibido: 'Recibido', diagnostico: 'Diagnóstico', esperando_aprobacion: 'Esperando aprobación', en_reparacion: 'En reparación', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
const ETQ_TIPO = { mano_obra: '🛠️ Mano de obra', repuesto: '⚙️ Repuesto', externo: '🏭 Trabajo externo', otro: '➕ Otro' };
// Pasos permitidos desde cada estado (el servidor valida lo mismo).
const SIGUIENTES = {
  recibido: [{ a: 'diagnostico', t: '🔍 Pasar a diagnóstico', p: true }],
  diagnostico: [{ a: 'esperando_aprobacion', t: '✅ Pedir aprobación al cliente', p: true }, { a: 'en_reparacion', t: '🔧 Empezar reparación' }],
  esperando_aprobacion: [{ a: 'en_reparacion', t: '🔧 Empezar reparación', p: true }, { a: 'diagnostico', t: '↩ Volver a diagnóstico' }],
  en_reparacion: [{ a: 'listo', t: '🏁 Marcar Listo (control de calidad hecho)', p: true }, { a: 'esperando_aprobacion', t: '✅ Pedir aprobación de adicionales' }],
  listo: [{ a: 'en_reparacion', t: '↩ Volver a reparación' }],
};

const TO = { ord: [], veh: {}, cli: {}, metodos: [], bancos: [], actual: null, lineas: [], hist: [], venta: null, editLinea: null, ocupado: false, prodSel: null };

window.tallerListo = async function () {
  await TO.cargar();
  const q = new URLSearchParams(location.search);
  if (q.get('nuevo')) TO.nueva(q.get('nuevo'));
  else if (q.get('ot')) TO.detalle(q.get('ot'));
};
const num = v => Number(v || 0);
const badgeAprob = l => l.aprobacion === 'aprobada' ? '<span class="badge badge-success">Aprobada</span>' : l.aprobacion === 'rechazada' ? '<span class="badge badge-danger">Rechazada</span>' : '<span class="badge badge-warning">Pendiente</span>';

TO.cargar = async function () {
  const uid = TL.userId;
  try {
    const [o, v, c, m, b] = await Promise.all([
      sb.from('taller_ordenes').select('*').eq('auth_user_id', uid).order('fecha_ingreso', { ascending: false }).limit(1500),
      sb.from('taller_vehiculos').select('*').eq('auth_user_id', uid).limit(3000),
      sb.from('clientes').select('id,nombre').eq('auth_user_id', uid).limit(3000),
      sb.from('metodos_pago').select('id,nombre').eq('auth_user_id', uid).eq('activo', true).order('nombre'),
      sb.from('bancos').select('id,nombre').eq('auth_user_id', uid).eq('activo', true).order('nombre'),
    ]);
    if (o.error) throw o.error;
    TO.ord = o.data || []; TO.veh = {}; (v.data || []).forEach(x => { TO.veh[x.id] = x; });
    TO.cli = {}; (c.data || []).forEach(x => { TO.cli[x.id] = x.nombre; });
    TO.metodos = m.data || []; TO.bancos = b.data || [];
  } catch (e) { console.warn(e); $('o-tablero').innerHTML = '<div class="tl-vacio">No se pudieron cargar las órdenes. Recarga la pantalla.</div>'; return; }
  TO.pintar();
};
TO.vehTxt = id => { const v = TO.veh[id]; return v ? `${v.placa || 'SIN PLACA'} · ${[v.marca, v.modelo].filter(Boolean).join(' ')}` : 'Vehículo'; };
TO.pasaFiltro = (o, q) => !q || [o.numero, o.falla_reportada, o.cliente_nombre, TO.veh[o.vehiculo_id]?.placa, TO.veh[o.vehiculo_id]?.marca].some(x => String(x || '').toLowerCase().includes(q));
TO.tarjeta = function (o) {
  const atraso = o.fecha_prometida && !['entregado', 'cancelado'].includes(o.estado) && o.fecha_prometida < new Date().toISOString().slice(0, 10);
  return `<button type="button" class="tl-ot${o.prioridad === 'urgente' ? ' urg' : ''}" onclick="TO.detalle('${o.id}')">
    <b>${esc(o.numero)} · <span class="tl-placa">${esc(TO.veh[o.vehiculo_id]?.placa || '—')}</span></b>
    <span>${esc([TO.veh[o.vehiculo_id]?.marca, TO.veh[o.vehiculo_id]?.modelo].filter(Boolean).join(' ') || 'Vehículo')}${o.cliente_nombre ? ' · ' + esc(o.cliente_nombre) : ''}</span>
    <span class="tl-muted">${esc(String(o.falla_reportada || '').slice(0, 70))}</span>
    <span class="tl-muted">${o.prioridad === 'urgente' ? '🔴 Urgente · ' : ''}${atraso ? '⏰ Atrasada · ' : o.fecha_prometida ? 'Promesa ' + tlFecha(o.fecha_prometida) + ' · ' : ''}${o.estado === 'entregado' ? fmt(o.total) : o.total_estimado > 0 ? 'Estimado ' + fmt(o.total_estimado) : 'Sin presupuesto'}</span></button>`;
};
TO.pintar = function () {
  const q = ($('o-buscar').value || '').trim().toLowerCase();
  const abiertas = TO.ord.filter(o => !['entregado', 'cancelado'].includes(o.estado) && TO.pasaFiltro(o, q));
  $('o-tablero').innerHTML = ESTADOS.map(e => {
    const l = abiertas.filter(o => o.estado === e.k);
    return `<div class="tl-col"><h3><span>${e.i} ${e.n}</span><span class="badge badge-neutral">${l.length}</span></h3>${l.map(TO.tarjeta).join('') || '<div class="tl-vacio">Sin órdenes</div>'}</div>`;
  }).join('');
  const ver = $('o-cerradas').checked;
  const cerradas = ver ? TO.ord.filter(o => ['entregado', 'cancelado'].includes(o.estado) && TO.pasaFiltro(o, q)).slice(0, 60) : [];
  $('o-cerradas-lista').innerHTML = ver ? `<div class="panel-title" style="margin-bottom:8px">Entregadas y canceladas (últimas ${cerradas.length})</div><div class="tl-cards">${cerradas.map(o => `<div class="tl-card" style="cursor:pointer" onclick="TO.detalle('${o.id}')"><h3><span>${esc(o.numero)}</span><span class="badge ${o.estado === 'entregado' ? 'badge-success' : 'badge-neutral'}">${ETQ_ESTADO[o.estado]}</span></h3><div>${esc(TO.vehTxt(o.vehiculo_id))}</div><div class="tl-muted">${tlFecha(o.fecha_entrega || o.updated_at)}${o.estado === 'entregado' ? ' · ' + fmt(o.total) : ''}</div></div>`).join('') || '<div class="tl-vacio">Nada para mostrar.</div>'}</div>` : '';
};

/* ---------- Nueva orden ---------- */
TO.nueva = function (vehId) {
  const ocupados = new Set(TO.ord.filter(o => !['entregado', 'cancelado'].includes(o.estado)).map(o => o.vehiculo_id));
  const libres = Object.values(TO.veh).filter(v => v.activo && !ocupados.has(v.id)).sort((a, b) => String(a.placa || '').localeCompare(String(b.placa || '')));
  $('n-veh').innerHTML = '<option value="">— Elige el vehículo —</option>' + libres.map(v => `<option value="${v.id}">${esc((v.placa || 'SIN PLACA') + ' · ' + [v.marca, v.modelo].filter(Boolean).join(' ') + (v.cliente_id && TO.cli[v.cliente_id] ? ' · ' + TO.cli[v.cliente_id] : ''))}</option>`).join('');
  if (vehId && libres.some(v => v.id === vehId)) $('n-veh').value = vehId;
  ['n-falla', 'n-km', 'n-prom', 'n-mec', 'n-obs'].forEach(id => { $(id).value = ''; }); $('n-prio').value = 'normal'; $('n-aviso').innerHTML = '';
  const v = TO.veh[$('n-veh').value]; if (v && v.km_actual != null) $('n-km').value = v.km_actual;
  $('n-veh').onchange = () => { const x = TO.veh[$('n-veh').value]; if (x && x.km_actual != null && !$('n-km').value) $('n-km').value = x.km_actual; };
  $('n-modal').classList.add('abierto'); document.body.style.overflow = 'hidden';
};
TO.cerrarNueva = function () { $('n-modal').classList.remove('abierto'); if (!$('d-modal').classList.contains('abierto')) document.body.style.overflow = ''; };
TO.crear = async function () {
  if (TO.ocupado) return;
  const p = { vehiculo_id: $('n-veh').value, falla_reportada: $('n-falla').value.trim(), km_ingreso: $('n-km').value, fecha_prometida: $('n-prom').value, prioridad: $('n-prio').value,
    mecanico_nombre: $('n-mec').value.trim(), observaciones: $('n-obs').value.trim(), creado_por: TL.nombre };
  if (!p.vehiculo_id) { $('n-aviso').innerHTML = '<div class="tl-aviso">Elige el vehículo.</div>'; return; }
  if (p.falla_reportada.length < 3) { $('n-aviso').innerHTML = '<div class="tl-aviso">Describe la falla (mínimo 3 letras).</div>'; return; }
  TO.ocupado = true; $('n-guardar').disabled = true; $('n-guardar').textContent = 'Creando…';
  const r = await tlRpc('taller_orden_crear', { p });
  TO.ocupado = false; $('n-guardar').disabled = false; $('n-guardar').textContent = 'Crear orden';
  if (!r.ok) { $('n-aviso').innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  showToast('✅ Orden ' + r.numero + ' creada');
  TO.cerrarNueva(); await TO.cargar(); TO.detalle(r.id);
};

/* ---------- Detalle ---------- */
TO.detalle = async function (id) {
  $('d-modal').classList.add('abierto'); document.body.style.overflow = 'hidden';
  $('d-cuerpo').innerHTML = '<div class="section-loading"><div class="mini-spinner"></div></div>';
  await TO.recargar(id);
};
TO.cerrarDetalle = function () { $('d-modal').classList.remove('abierto'); document.body.style.overflow = ''; TO.actual = null; TO.editLinea = null; TO.prodSel = null; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('n-modal').classList.contains('abierto')) TO.cerrarNueva(); else if ($('d-modal').classList.contains('abierto')) TO.cerrarDetalle(); } });
TO.recargar = async function (id) {
  const uid = TL.userId, oid = id || TO.actual?.id;
  try {
    const [o, l, h] = await Promise.all([
      sb.from('taller_ordenes').select('*').eq('auth_user_id', uid).eq('id', oid).maybeSingle(),
      sb.from('taller_orden_lineas').select('*').eq('auth_user_id', uid).eq('orden_id', oid).order('created_at'),
      sb.from('taller_orden_historial').select('*').eq('auth_user_id', uid).eq('orden_id', oid).order('created_at', { ascending: false }).limit(40),
    ]);
    if (!o.data) { $('d-cuerpo').innerHTML = '<div class="tl-vacio">No se encontró la orden.</div>'; return; }
    TO.actual = o.data; TO.lineas = l.data || []; TO.hist = h.data || []; TO.venta = null;
    if (TO.actual.venta_id) { const { data } = await sb.from('ventas').select('numero_venta').eq('id', TO.actual.venta_id).maybeSingle(); TO.venta = data; }
  } catch (e) { console.warn(e); $('d-cuerpo').innerHTML = '<div class="tl-vacio">No se pudo cargar la orden. Intenta de nuevo.</div>'; return; }
  const i = TO.ord.findIndex(x => x.id === TO.actual.id); if (i >= 0) TO.ord[i] = TO.actual; else TO.ord.unshift(TO.actual);
  TO.pintarDetalle(); TO.pintar();
};
TO.pintarDetalle = function () {
  const o = TO.actual, v = TO.veh[o.vehiculo_id] || {}, abierta = !['entregado', 'cancelado'].includes(o.estado);
  const pend = TO.lineas.filter(l => l.aprobacion === 'pendiente').length;
  $('d-titulo').textContent = `${o.numero} · ${v.placa || 'SIN PLACA'}`;
  const sig = (SIGUIENTES[o.estado] || []).map(s => `<button type="button" class="${s.p ? 'btn-primary' : 'btn-secondary'}" onclick="TO.estado('${s.a}')">${s.t}</button>`).join('');
  const html = [];
  html.push(`<div class="tl-sec"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
      <div><b>${esc([v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || 'Vehículo')}</b> <span class="tl-muted">${esc(v.color || '')}</span><div class="tl-muted">${o.cliente_nombre ? '👤 ' + esc(o.cliente_nombre) + ' · ' : ''}Ingreso ${tlFechaHora(o.fecha_ingreso)}${o.km_ingreso != null ? ' · ' + Number(o.km_ingreso).toLocaleString('es-NI') + ' km' : ''}</div></div>
      <span class="badge ${o.estado === 'entregado' ? 'badge-success' : o.estado === 'cancelado' ? 'badge-neutral' : 'badge-accent'}">${ETQ_ESTADO[o.estado]}</span></div>
      ${o.estado === 'entregado' ? `<div class="tl-aviso ok">Entregado ${tlFechaHora(o.fecha_entrega)} · Venta ${esc(TO.venta?.numero_venta || '')} · Total ${fmt(o.total)}</div>` : ''}
    </div>`);
  // Datos
  html.push(`<div class="tl-sec"><b>Datos de la orden</b><div class="tl-grid">
      <div class="tl-f full"><label for="e-falla">Falla reportada</label><textarea class="tl-txt" id="e-falla" maxlength="2000" ${abierta ? '' : 'disabled'}>${esc(o.falla_reportada)}</textarea></div>
      <div class="tl-f full"><label for="e-diag">Diagnóstico del mecánico</label><textarea class="tl-txt" id="e-diag" maxlength="4000" ${abierta ? '' : 'disabled'}>${esc(o.diagnostico || '')}</textarea></div>
      <div class="tl-f"><label for="e-mec">Mecánico</label><input class="tl-inp" id="e-mec" maxlength="120" value="${esc(o.mecanico_nombre || '')}" ${abierta ? '' : 'disabled'}></div>
      <div class="tl-f"><label for="e-prom">Fecha prometida</label><input class="tl-inp" id="e-prom" type="date" value="${esc(o.fecha_prometida || '')}" ${abierta ? '' : 'disabled'}></div>
      <div class="tl-f"><label for="e-prio">Prioridad</label><select class="tl-sel" id="e-prio" ${abierta ? '' : 'disabled'}><option value="normal" ${o.prioridad === 'normal' ? 'selected' : ''}>Normal</option><option value="urgente" ${o.prioridad === 'urgente' ? 'selected' : ''}>Urgente</option></select></div>
      <div class="tl-f"><label for="e-iva">IVA</label><select class="tl-sel" id="e-iva" ${abierta ? '' : 'disabled'}><option value="0" ${!o.iva_activo ? 'selected' : ''}>Sin IVA</option><option value="1" ${o.iva_activo ? 'selected' : ''}>Con IVA ${num(o.iva_porcentaje)}%</option></select></div>
      <div class="tl-f full"><label for="e-obs">Observaciones</label><textarea class="tl-txt" id="e-obs" maxlength="2000" ${abierta ? '' : 'disabled'}>${esc(o.observaciones || '')}</textarea></div></div>
      ${abierta ? '<div><button type="button" class="btn-secondary" onclick="TO.guardarDatos()">Guardar datos</button></div>' : ''}</div>`);
  // Líneas
  const filas = TO.lineas.map(l => `<tr class="${l.aprobacion === 'rechazada' ? 'tl-tachada' : ''}">
      <td data-t="Detalle"><b>${esc(l.descripcion)}</b> <span class="tl-muted">${esc(ETQ_TIPO[l.tipo] || '')}</span>${l.adicional ? ' <span class="badge badge-accent">Adicional</span>' : ''}${l.tipo === 'repuesto' && l.producto_id ? ` <span class="tl-muted" id="st-${l.id}"></span>` : ''}</td>
      <td data-t="Cant." class="tl-num">${num(l.cantidad)}</td><td data-t="Precio" class="tl-num">${fmt(l.precio_unitario)}</td>
      <td data-t="Desc." class="tl-num">${num(l.descuento) ? fmt(l.descuento) : '—'}</td><td data-t="Subtotal" class="tl-num">${fmt(l.subtotal)}</td>
      <td data-t="Cliente">${badgeAprob(l)}${l.decidido_por ? `<div class="tl-muted">${esc(l.decidido_por)}</div>` : ''}</td>
      <td class="tl-ac">${abierta ? `<div class="tl-lin-acc">
        ${l.aprobacion !== 'aprobada' ? `<button class="btn-primary" onclick="TO.decidir('${l.id}','aprobada')">Aprobar</button>` : ''}
        ${l.aprobacion !== 'rechazada' ? `<button class="btn-secondary" onclick="TO.decidir('${l.id}','rechazada')">Rechazar</button>` : ''}
        ${l.aprobacion !== 'pendiente' ? `<button class="btn-secondary" onclick="TO.decidir('${l.id}','pendiente')">Pendiente</button>` : ''}
        <button class="btn-secondary" onclick="TO.editarLinea('${l.id}')">Editar</button>
        <button class="btn-secondary" onclick="TO.quitarLinea('${l.id}')">Quitar</button></div>` : ''}</td></tr>`).join('');
  html.push(`<div class="tl-sec"><b>Presupuesto</b>
      ${pend ? `<div class="tl-aviso">${pend} línea${pend === 1 ? '' : 's'} esperando la decisión del cliente. Solo se cobra lo aprobado.</div>` : ''}
      ${TO.lineas.length ? `<table class="tl-tabla"><thead><tr><th>Detalle</th><th class="tl-num">Cant.</th><th class="tl-num">Precio</th><th class="tl-num">Desc.</th><th class="tl-num">Subtotal</th><th>Cliente</th><th></th></tr></thead><tbody>${filas}</tbody></table>` : '<div class="tl-vacio">Aún no hay líneas. Agrega la mano de obra y los repuestos.</div>'}
      <div class="tl-tot"><div><span>Subtotal aprobado</span><span>${fmt(o.subtotal)}</span></div>${num(o.descuento) ? `<div><span>Descuento</span><span>− ${fmt(o.descuento)}</span></div>` : ''}${o.iva_activo ? `<div><span>IVA ${num(o.iva_porcentaje)}%</span><span>${fmt(o.impuesto)}</span></div>` : ''}
        <div class="grande"><span>Total a cobrar</span><span>${fmt(o.total)}</span></div>${abierta && num(o.total_estimado) !== num(o.total) ? `<div class="tl-muted"><span>Si el cliente aprueba todo</span><span>${fmt(o.total_estimado)}</span></div>` : ''}</div>
      ${abierta ? TO.formLinea() : ''}</div>`);
  if (abierta) html.push(`<div class="tl-sec"><b>Siguiente paso</b><div class="tl-acc" style="margin:0">${sig}<button type="button" class="btn-secondary" style="margin-left:auto" onclick="TO.estado('cancelado')">Cancelar orden</button></div></div>`);
  if (o.estado === 'listo') html.push(TO.formEntrega());
  html.push(`<div class="tl-sec"><b>Historial</b><div class="tl-hist">${TO.hist.map(h => `<div>${tlFechaHora(h.created_at)} · <b>${esc(h.evento)}</b>${h.detalle ? ' · ' + esc(h.detalle) : ''}${h.por ? ' · ' + esc(h.por) : ''}</div>`).join('') || '—'}</div></div>`);
  $('d-cuerpo').innerHTML = html.join('');
  TO.stocks();
};
TO.stocks = async function () {
  const ids = [...new Set(TO.lineas.filter(l => l.producto_id && l.tipo === 'repuesto' && l.aprobacion !== 'rechazada').map(l => l.producto_id))];
  if (!ids.length || ['entregado', 'cancelado'].includes(TO.actual.estado)) return;
  const { data } = await sb.from('productos').select('id,stock_actual').in('id', ids);
  const st = {}; (data || []).forEach(p => { st[p.id] = num(p.stock_actual); });
  const falta = {}; TO.lineas.filter(l => l.producto_id && l.tipo === 'repuesto' && l.aprobacion !== 'rechazada').forEach(l => { falta[l.producto_id] = (falta[l.producto_id] || 0) + num(l.cantidad); });
  TO.lineas.forEach(l => { const el = $('st-' + l.id); if (el && l.producto_id) { const hay = st[l.producto_id], nec = falta[l.producto_id]; el.innerHTML = hay == null ? '' : hay >= nec ? `· stock ${hay}` : `<b style="color:var(--danger)">· stock ${hay}, necesita ${nec}</b>`; } });
};
TO.formLinea = function () {
  const e = TO.editLinea ? TO.lineas.find(l => l.id === TO.editLinea) : null;
  return `<div class="tl-sec" style="background:var(--bg-hover)"><b>${e ? 'Editar línea' : 'Agregar línea'}</b>
    ${e && e.aprobacion !== 'pendiente' ? '<div class="tl-aviso">Al guardar, la línea vuelve a quedar pendiente: el cliente debe aprobarla de nuevo.</div>' : ''}
    ${!e && TO.lineas.some(l => l.aprobacion === 'aprobada') ? '<div class="tl-aviso">Esta orden ya tiene trabajos aprobados: la nueva línea será un <b>trabajo adicional</b> y necesita su propia aprobación.</div>' : ''}
    <div class="tl-grid">
      <div class="tl-f"><label for="l-tipo">Tipo</label><select class="tl-sel" id="l-tipo" onchange="TO.cambioTipo()">${Object.entries(ETQ_TIPO).map(([k, t]) => `<option value="${k}" ${(e?.tipo || 'mano_obra') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="tl-f" id="l-bus-wrap"><label for="l-bus">Buscar repuesto en tu inventario</label><input class="tl-inp" id="l-bus" type="search" autocomplete="off" placeholder="Nombre o código…" oninput="TO.buscarProd()"><div id="l-res"></div></div>
      <div class="tl-f full"><label for="l-desc">Descripción</label><input class="tl-inp" id="l-desc" maxlength="300" value="${esc(e?.descripcion || '')}" placeholder="Ej. Cambio de aceite y filtro"></div>
      <div class="tl-f"><label for="l-cant">Cantidad</label><input class="tl-inp" id="l-cant" type="number" inputmode="decimal" min="0.001" step="any" value="${e ? num(e.cantidad) : 1}"></div>
      <div class="tl-f"><label for="l-precio">Precio unitario</label><input class="tl-inp" id="l-precio" type="number" inputmode="decimal" min="0" step="0.01" value="${e ? num(e.precio_unitario) : ''}"></div>
      <div class="tl-f"><label for="l-dcto">Descuento (monto)</label><input class="tl-inp" id="l-dcto" type="number" inputmode="decimal" min="0" step="0.01" value="${e ? num(e.descuento) : 0}"></div>
      <div class="tl-f" id="l-costo-wrap"><label for="l-costo">Costo unitario (tu costo)</label><input class="tl-inp" id="l-costo" type="number" inputmode="decimal" min="0" step="0.01" value="${e ? num(e.costo_unitario) : 0}"></div></div>
    <div class="tl-acc"><button type="button" class="btn-primary" id="l-guardar" onclick="TO.guardarLinea()">${e ? 'Guardar cambios' : 'Agregar al presupuesto'}</button>${e ? '<button type="button" class="btn-secondary" onclick="TO.cancelarEdicion()">Cancelar edición</button>' : ''}</div></div>`;
};
TO.cambioTipo = function () {
  const t = $('l-tipo').value;
  $('l-bus-wrap').style.display = t === 'repuesto' ? '' : 'none';
  $('l-costo-wrap').style.display = t === 'mano_obra' ? 'none' : '';
  if (t !== 'repuesto') TO.prodSel = null;
};
setTimeout(() => {}, 0);
TO.buscarProd = function () {
  clearTimeout(TO._bt);
  TO._bt = setTimeout(async () => {
    const q = ($('l-bus').value || '').trim().replace(/[,()%*\\]/g, ' ');
    if (q.length < 2) { $('l-res').innerHTML = ''; return; }
    const { data } = await sb.from('productos').select('id,nombre,sku,precio,costo,stock_actual').eq('auth_user_id', TL.userId).eq('tipo', 'producto').eq('activo', true).or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`).order('nombre').limit(8);
    TO._res = data || [];
    $('l-res').innerHTML = TO._res.length ? TO._res.map((p, i) => `<button type="button" class="tl-ot" style="margin-top:4px" onclick="TO.elegirProd(${i})"><b>${esc(p.nombre)}</b><span class="tl-muted">${p.sku ? esc(p.sku) + ' · ' : ''}Stock ${num(p.stock_actual)} · Precio ${fmt(p.precio)}</span></button>`).join('') : '<div class="tl-muted">Sin resultados. Crea el repuesto en Productos o agrégalo como “Otro”.</div>';
  }, 250);
};
TO.elegirProd = function (i) {
  const p = TO._res[i]; if (!p) return;
  TO.prodSel = p.id; $('l-desc').value = p.nombre; $('l-precio').value = num(p.precio); $('l-costo').value = num(p.costo);
  $('l-res').innerHTML = `<div class="tl-aviso ok">Repuesto elegido: ${esc(p.nombre)} · stock ${num(p.stock_actual)}</div>`; $('l-bus').value = '';
};
TO.editarLinea = function (id) {
  TO.editLinea = id; const l = TO.lineas.find(x => x.id === id); TO.prodSel = l?.producto_id || null; TO.pintarDetalle();
  $('l-tipo').scrollIntoView({ block: 'center' }); TO.cambioTipo();
};
TO.cancelarEdicion = function () { TO.editLinea = null; TO.prodSel = null; TO.pintarDetalle(); };
TO.accion = async function (fn) {
  if (TO.ocupado) return null;
  TO.ocupado = true;
  try { return await fn(); } finally { TO.ocupado = false; }
};
TO.guardarLinea = async function () {
  const tipo = $('l-tipo').value;
  const p = { id: TO.editLinea || null, tipo, producto_id: tipo === 'repuesto' ? TO.prodSel : null, descripcion: $('l-desc').value.trim(), cantidad: $('l-cant').value, precio_unitario: $('l-precio').value,
    descuento: $('l-dcto').value || 0, costo_unitario: tipo === 'mano_obra' ? 0 : ($('l-costo').value || 0), por: TL.nombre };
  if (!p.descripcion) { showToast('Escribe la descripción.', 'warning'); return; }
  if (p.precio_unitario === '') { showToast('Escribe el precio.', 'warning'); return; }
  $('l-guardar').disabled = true;
  const r = await TO.accion(() => tlRpc('taller_linea_guardar', { p_orden_id: TO.actual.id, p }));
  if (!r) return;
  if (!r.ok) { showToast(r.msg, 'error'); $('l-guardar').disabled = false; return; }
  showToast('✅ Línea guardada'); TO.editLinea = null; TO.prodSel = null; await TO.recargar();
};
TO.quitarLinea = async function (id) {
  if (!confirm('¿Quitar esta línea del presupuesto?')) return;
  const r = await TO.accion(() => tlRpc('taller_linea_eliminar', { p_linea_id: id, p_por: TL.nombre }));
  if (!r) return; if (!r.ok) { showToast(r.msg, 'error'); return; }
  await TO.recargar();
};
TO.decidir = async function (id, d) {
  const r = await TO.accion(() => tlRpc('taller_decidir_lineas', { p_orden_id: TO.actual.id, p_linea_ids: [id], p_decision: d, p_por: TL.nombre, p_nota: null }));
  if (!r) return; if (!r.ok) { showToast(r.msg, 'error'); return; }
  await TO.recargar();
};
TO.guardarDatos = async function () {
  const p = { falla_reportada: $('e-falla').value.trim(), diagnostico: $('e-diag').value.trim(), mecanico_nombre: $('e-mec').value.trim(), fecha_prometida: $('e-prom').value,
    prioridad: $('e-prio').value, iva_activo: $('e-iva').value === '1', observaciones: $('e-obs').value.trim(), por: TL.nombre };
  const r = await TO.accion(() => tlRpc('taller_orden_actualizar', { p_orden_id: TO.actual.id, p }));
  if (!r) return; if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast('✅ Datos guardados'); await TO.recargar();
};
TO.estado = async function (nuevo) {
  if (nuevo === 'cancelado' && !confirm('¿Cancelar esta orden? Ya no se podrá cobrar ni modificar.')) return;
  const r = await TO.accion(() => tlRpc('taller_orden_estado', { p_orden_id: TO.actual.id, p_nuevo: nuevo, p_por: TL.nombre }));
  if (!r) return; if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast('✅ Estado: ' + ETQ_ESTADO[nuevo]); await TO.recargar();
};
/* ---------- Entrega y cobro ---------- */
TO.formEntrega = function () {
  const o = TO.actual, reps = TO.lineas.filter(l => l.aprobacion === 'aprobada' && l.tipo === 'repuesto' && l.producto_id).length;
  const pend = TO.lineas.filter(l => l.aprobacion === 'pendiente').length;
  if (!TO.metodos.length) return '<div class="tl-sec"><b>💳 Entrega y cobro</b><div class="tl-aviso">Primero crea un método de pago en Configuración para poder cobrar.</div></div>';
  return `<div class="tl-sec"><b>💳 Entrega y cobro</b>
    ${pend ? `<div class="tl-aviso">Hay ${pend} línea(s) sin decidir. Apruébalas o recházalas antes de entregar.</div>` : ''}
    <div class="tl-aviso ok">Se cobrará <b>${fmt(o.total)}</b>${o.iva_activo ? ` (incluye IVA ${fmt(o.impuesto)})` : ''}${reps ? ` y se descontarán ${reps} repuesto(s) del inventario` : ''}. Se crea una venta normal y el dinero entra a Caja.</div>
    <div class="tl-grid">
      <div class="tl-f"><label for="x-met">Método de pago</label><select class="tl-sel" id="x-met"><option value="">— Elige —</option>${TO.metodos.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}</select></div>
      <div class="tl-f"><label for="x-banco">Banco (si aplica)</label><select class="tl-sel" id="x-banco"><option value="">Ninguno</option>${TO.bancos.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('')}</select></div>
      <div class="tl-f"><label for="x-km">Kilometraje de salida</label><input class="tl-inp" id="x-km" type="number" inputmode="decimal" min="0" step="0.1" value="${o.km_ingreso != null ? num(o.km_ingreso) : ''}"></div></div>
    <div><button type="button" class="btn-primary" id="x-entregar" onclick="TO.entregar()" ${pend ? 'disabled' : ''}>Entregar y cobrar</button></div></div>`;
};
TO.entregar = async function () {
  const sel = $('x-met'); if (!sel.value) { showToast('Elige el método de pago.', 'warning'); return; }
  const nombre = sel.options[sel.selectedIndex].text;
  if (!confirm(`¿Entregar el vehículo y cobrar ${fmt(TO.actual.total)} con ${nombre}? Esta acción crea la venta y no se puede repetir.`)) return;
  $('x-entregar').disabled = true; $('x-entregar').textContent = 'Entregando…';
  const p = { metodo_pago_id: sel.value, metodo_pago_nombre: nombre, banco_id: $('x-banco').value || null, km_salida: $('x-km').value, creado_por: TL.nombre };
  const r = await TO.accion(() => tlRpc('taller_orden_entregar', { p_orden_id: TO.actual.id, p }));
  if (!r) return;
  if (!r.ok) { showToast(r.msg, 'error'); $('x-entregar').disabled = false; $('x-entregar').textContent = 'Entregar y cobrar'; return; }
  showToast('✅ Entregado y cobrado' + (r.numero_venta ? ' · Venta ' + r.numero_venta : ''));
  try { window.parent !== window && window.parent.postMessage({ tipo: 'n360_operacion_completada', nota: 'Entrega cobrada' }, '*'); } catch (_) {}
  await TO.recargar();
};
