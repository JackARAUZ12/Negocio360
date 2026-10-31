/* ============================================================
   CICLO OPCIONAL: PROFORMA APROBADA -> PRODUCCIÓN -> INVENTARIO -> VENTA
   Módulo aditivo. Solo hace algo si el negocio activó la opción
   (Configuración › Pedidos con producción). Apagado, no cambia nada.
   - Botón "Pasar a producción" en proformas APROBADAS: crea órdenes PENDIENTES
     (no produce ni mueve inventario; eso lo sigue haciendo el módulo Producción).
   - Mientras la producción no esté terminada, la proforma no se edita, no se elimina
     y no se convierte en venta (el servidor también lo impide).
   ============================================================ */
(function () {
  'use strict';
  if (window.N360ProfProd) return;

  var LINKS = {};            // proforma_id -> [{producto_id, cantidad, orden_id, ordenes_produccion:{...}}]
  var ocupado = false;

  function $(id) { return document.getElementById(id); }
  function e(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function toast(m, t) { try { showToast(m, t); } catch (_) { /* nada */ } }
  function activo() { try { return !!(STATE.empresaConfig && STATE.empresaConfig.usa_ciclo_produccion_pedidos === true); } catch (_) { return false; } }

  var SEL = 'id,proforma_id,producto_id,cantidad,orden_id,ordenes_produccion(numero,estado,porcentaje_avance,cantidad_planificada,cantidad_producida)';

  async function cargar() {
    LINKS = {};
    if (!activo()) return;
    try {
      var desde = 0, paso = 1000;
      for (;;) {
        var r = await sbClient.from('proforma_produccion').select(SEL).eq('auth_user_id', STATE.userId).order('id').range(desde, desde + paso - 1);
        if (r.error) throw r.error;
        (r.data || []).forEach(function (l) { (LINKS[l.proforma_id] = LINKS[l.proforma_id] || []).push(l); });
        if (!r.data || r.data.length < paso) break;
        desde += paso;
      }
    } catch (err) { console.warn('N360ProfProd.cargar:', err); }
  }

  async function recargarUna(pid) {
    if (!activo()) return;
    try {
      var r = await sbClient.from('proforma_produccion').select(SEL).eq('auth_user_id', STATE.userId).eq('proforma_id', pid);
      if (!r.error) LINKS[pid] = r.data || [];
    } catch (_) { /* se queda lo que había */ }
  }

  function vivas(pid) {
    return (LINKS[pid] || []).filter(function (l) { return l.ordenes_produccion && l.ordenes_produccion.estado !== 'cancelada'; });
  }
  // Tiene órdenes vivas: no se edita ni se elimina.
  function bloqueada(pid) { return activo() && vivas(pid).length > 0; }
  // Hay producción sin terminar: no se convierte en venta.
  function pendiente(pid) {
    return activo() && vivas(pid).some(function (l) { var s = l.ordenes_produccion.estado; return s === 'pendiente' || s === 'en_proceso'; });
  }

  var ESTADO = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada', cancelada: 'Cancelada' };

  function chip(pid) {
    if (!activo()) return '';
    var v = vivas(pid);
    if (!v.length) return '';
    var todo = v.every(function (l) { return l.ordenes_produccion.estado === 'completada'; });
    return todo
      ? ' <span title="Producción terminada: lista para entregar" style="font-size:11px;color:var(--success);font-weight:700;white-space:nowrap">🏭 Producida</span>'
      : ' <span title="Tiene producción en curso" style="font-size:11px;color:var(--warning);font-weight:700;white-space:nowrap">🏭 En producción</span>';
  }

  function nombreDe(pid, productoId) {
    var d = (STATE.detalleActual || []).filter(function (x) { return x.producto_id === productoId; })[0];
    return d ? d.producto_nombre : 'Producto';
  }

  /* Bloque dentro del detalle de la proforma + botón del pie. */
  async function pintarDetalle(p, body) {
    var btn = $('det-prof-btn-produccion');
    if (btn) btn.style.display = (activo() && p.estado === 'aprobada') ? 'inline-flex' : 'none';
    if (!activo() || !body) return;
    await recargarUna(p.id);
    var v = vivas(p.id);
    if (!v.length) return;
    var filas = v.map(function (l) {
      var o = l.ordenes_produccion;
      var pct = o.estado === 'completada' ? 100 : (o.estado === 'en_proceso' ? Number(o.porcentaje_avance || 0) : 0);
      var extra = '';
      if (o.estado === 'completada' && Number(o.cantidad_producida || 0) < Number(l.cantidad)) {
        extra = ' <span style="color:var(--warning)">(salieron ' + e(Number(o.cantidad_producida || 0)) + ' de ' + e(Number(l.cantidad)) + ')</span>';
      }
      return '<tr><td><strong style="font-family:var(--font-mono)">' + e(o.numero) + '</strong></td><td>' + e(nombreDe(p.id, l.producto_id)) + '</td>' +
        '<td class="td-right">' + e(Number(l.cantidad)) + '</td><td>' + e(ESTADO[o.estado] || o.estado) + extra + '</td><td class="td-right">' + pct + '%</td></tr>';
    }).join('');
    var hayPend = pendiente(p.id);
    var html = '<div id="pfp-detalle" style="margin-top:16px;padding:12px;border:1px solid var(--border);border-radius:10px">' +
      '<div style="font-weight:700;margin-bottom:8px">🏭 Producción de esta proforma</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Orden</th><th>Producto</th><th class="th-right">Cant.</th><th>Estado</th><th class="th-right">Avance</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '<p style="margin-top:8px;font-size:12.5px;color:' + (hayPend ? 'var(--warning)' : 'var(--success)') + '">' +
      (hayPend ? 'Cuando la producción esté completada podrás convertir la proforma en venta. Las órdenes se completan en <a href="produccion.html" style="font-weight:700">Producción</a>.'
               : '✅ Producción terminada: el producto ya está en inventario y la proforma se puede convertir en venta.') + '</p>' +
      (hayPend && window.N360Faltantes ? '<button class="btn-secondary" style="margin-top:8px" onclick="N360ProfProd.verFaltantes(\'' + e(p.id) + '\')">🛒 Materia prima: qué falta y comprar</button>' : '') + '</div>';
    var viejo = $('pfp-detalle'); if (viejo) viejo.remove();
    body.insertAdjacentHTML('beforeend', html);
  }

  /* ---------- Ventana "Pasar a producción" ---------- */
  function asegurarModal() {
    if ($('modal-pf-produccion')) return;
    var d = document.createElement('div');
    d.className = 'modal-overlay';
    d.id = 'modal-pf-produccion';
    d.setAttribute('onclick', "if(event.target===this)closeModal('modal-pf-produccion')");
    d.innerHTML = '<div class="modal-box"><div class="modal-header"><h3>🏭 Pasar a producción</h3>' +
      '<button class="modal-close" onclick="closeModal(\'modal-pf-produccion\')">&times;</button></div>' +
      '<div class="modal-body" id="pfp-cuerpo"></div>' +
      '<div class="modal-footer"><button class="btn-ghost" onclick="closeModal(\'modal-pf-produccion\')">Cerrar</button>' +
      '<button class="btn-primary" id="pfp-confirmar" onclick="N360ProfProd.confirmar()">Crear órdenes de producción</button></div></div>';
    document.body.appendChild(d);
  }

  var MOTIVO = {
    sin_receta: 'sin receta de producción: se vende del inventario',
    varias_recetas: 'tiene varias recetas activas: crea la orden a mano en Producción',
    ya_tiene: 'ya tiene su orden de producción',
    sin_producto: 'el producto ya no existe'
  };

  async function abrir() {
    var p = STATE.proformaActual;
    if (!p || !activo()) return;
    if (p.estado !== 'aprobada') { toast('Solo las proformas aprobadas pasan a producción', 'error'); return; }
    asegurarModal();
    var cuerpo = $('pfp-cuerpo'), bt = $('pfp-confirmar');
    cuerpo.innerHTML = 'Revisando recetas…';
    if (bt) { bt.disabled = true; bt.style.display = ''; }
    openModal('modal-pf-produccion');
    try {
      var rr = await sbClient.from('recetas_produccion').select('id,producto_terminado_id,activa,tipo,al_vender').eq('auth_user_id', STATE.userId);
      if (rr.error) throw rr.error;
      var recs = (rr.data || []).filter(function (r) { return r.activa !== false && (r.tipo || 'normal') === 'normal' && !r.al_vender; });
      var porProd = {};
      (STATE.detalleActual || []).forEach(function (d) {
        if (d.tipo_item !== 'producto' || !d.producto_id) return;
        var x = porProd[d.producto_id] = porProd[d.producto_id] || { nombre: d.producto_nombre, q: 0 };
        x.q += Number(d.cantidad) || 0;
      });
      var ya = vivas(p.id).map(function (l) { return l.producto_id; });
      var haceFalta = 0, filas = '';
      Object.keys(porProd).forEach(function (pid) {
        var x = porProd[pid];
        var n = recs.filter(function (r) { return r.producto_terminado_id === pid; }).length;
        var estado = ya.indexOf(pid) >= 0 ? 'ya_tiene' : (n === 0 ? 'sin_receta' : (n > 1 ? 'varias_recetas' : 'ok'));
        if (estado === 'ok') haceFalta++;
        filas += '<li style="margin:4px 0">' + (estado === 'ok' ? '✅ ' : '➖ ') + '<strong>' + e(x.q) + ' × ' + e(x.nombre) + '</strong> — ' +
          (estado === 'ok' ? 'se creará su orden de producción' : e(MOTIVO[estado])) + '</li>';
      });
      cuerpo.innerHTML = '<p style="font-size:13.5px;margin-bottom:8px">Se crearán órdenes <strong>pendientes</strong> para los productos que tienen receta. ' +
        'No se descuenta nada del inventario todavía: eso pasa cuando completes la orden en Producción.</p>' +
        '<ul style="list-style:none;padding:0;font-size:13px">' + (filas || '<li>Esta proforma no tiene productos.</li>') + '</ul>' +
        (haceFalta ? '<div style="margin-top:12px"><label style="font-size:12.5px">Fecha de entrega al cliente (opcional)</label>' +
          '<input type="date" id="pfp-fecha" class="form-input" style="margin-top:4px"></div>' : '<p style="margin-top:10px;color:var(--warning);font-size:13px">Ningún producto de esta proforma necesita una orden nueva.</p>');
      if (bt) bt.disabled = !haceFalta;
    } catch (err) {
      console.error('N360ProfProd.abrir:', err);
      cuerpo.innerHTML = 'No se pudieron revisar las recetas. Intenta de nuevo.';
    }
  }

  async function confirmar() {
    if (ocupado) return;
    var p = STATE.proformaActual;
    if (!p) return;
    ocupado = true;
    var bt = $('pfp-confirmar'); if (bt) bt.disabled = true;
    try {
      var fecha = ($('pfp-fecha') && $('pfp-fecha').value) || null;
      var usuario = (STATE.currentUser && STATE.currentUser.nombre) || (STATE.userEmail || '').split('@')[0] || 'Usuario';
      var r = await sbClient.rpc('proforma_pasar_a_produccion', { p_proforma_id: p.id, p_fecha_entrega: fecha, p_usuario: usuario });
      if (r.error) throw r.error;
      var d = r.data || {};
      if (!d.ok) {
        var m = { desactivado: 'La opción de producción para pedidos está apagada en Configuración.', estado: 'Solo las proformas aprobadas pasan a producción.', no_existe: 'No se encontró la proforma.' }[d.motivo];
        $('pfp-cuerpo').innerHTML = '<p style="color:var(--danger)">' + e(m || 'No se pudo pasar a producción.') + '</p>';
        return;
      }
      var cre = d.creadas || [], om = d.omitidas || [];
      var html = cre.length
        ? '<p style="color:var(--success);font-weight:700">✅ ' + cre.length + ' orden(es) creada(s):</p><ul style="padding-left:18px;font-size:13px">' +
          cre.map(function (c) { return '<li><strong>' + e(c.numero) + '</strong> — ' + e(Number(c.cantidad)) + ' × ' + e(c.producto) + '</li>'; }).join('') + '</ul>' +
          '<p style="font-size:13px;margin-top:8px">Siguiente paso: completa la orden en <a href="produccion.html" style="font-weight:700">Producción</a>. Si falta materia prima, ahí te lo dirá.</p>'
        : '<p>No se creó ninguna orden nueva.</p>';
      var raros = om.filter(function (o) { return o.motivo !== 'sin_receta'; });
      if (raros.length) html += '<ul style="padding-left:18px;font-size:12.5px;color:var(--text-secondary)">' + raros.map(function (o) { return '<li>' + e(o.producto) + ': ' + e(MOTIVO[o.motivo] || o.motivo) + '</li>'; }).join('') + '</ul>';
      ultimasCreadas = cre.map(function (c) { return c.orden_id; });
      if (cre.length && window.N360Faltantes) html += '<button class="btn-secondary" style="margin-top:8px" onclick="N360ProfProd.verFaltantesNuevas()">🛒 Revisar si falta materia prima</button>';
      $('pfp-cuerpo').innerHTML = html;
      if (bt) bt.style.display = 'none';
      await cargar();
      try { renderTablaProf(); } catch (_) { /* nada */ }
      try { verDetalleProf(p.id); } catch (_) { /* nada */ }
    } catch (err) {
      console.error('N360ProfProd.confirmar:', err);
      $('pfp-cuerpo').innerHTML = '<p style="color:var(--danger)">No se pudo pasar a producción. Intenta de nuevo.</p>';
      if (bt) bt.disabled = false;
    } finally { ocupado = false; }
  }

  function verFaltantes(pid) {
    var ords = vivas(pid).filter(function (l) { var s = l.ordenes_produccion.estado; return s === 'pendiente' || s === 'en_proceso'; }).map(function (l) { return l.orden_id; });
    var pf = (STATE.proformas || []).filter(function (x) { return x.id === pid; })[0];
    if (window.N360Faltantes) window.N360Faltantes.abrir(ords, pf ? pf.numero_proforma : '');
  }
  var ultimasCreadas = [];
  function verFaltantesNuevas() {
    if (window.N360Faltantes) window.N360Faltantes.abrir(ultimasCreadas, STATE.proformaActual ? STATE.proformaActual.numero_proforma : '');
  }

  // Si el negocio completa la producción en otra pestaña y vuelve, se refresca el estado.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !activo()) return;
    cargar().then(function () { try { renderTablaProf(); } catch (_) { /* nada */ } });
  });


  // Opción "crear la orden sola al aprobar": se llama justo después de guardar una proforma que
  // acaba de pasar a "aprobada". Usa la misma función de servidor del botón manual (evita duplicados).
  // Si algo falla, la proforma queda aprobada igual y el botón manual sigue disponible.
  async function autoAlAprobar(proformaId) {
    try {
      var c = STATE.empresaConfig || {};
      if (!(c.usa_ciclo_produccion_pedidos === true && c.usa_orden_auto_al_aprobar === true)) return null;
      var usuario = (STATE.currentUser && STATE.currentUser.nombre) || (STATE.userEmail || '').split('@')[0] || 'Usuario';
      var r = await sbClient.rpc('proforma_pasar_a_produccion', { p_proforma_id: proformaId, p_fecha_entrega: null, p_usuario: usuario });
      if (r.error || !r.data || !r.data.ok) return null;
      return (r.data.creadas || []);
    } catch (err) { console.error('N360ProfProd.autoAlAprobar:', err); return null; }
  }

  window.N360ProfProd = {
    activo: activo, cargar: cargar, bloqueada: bloqueada, pendiente: pendiente,
    chip: chip, pintarDetalle: pintarDetalle, abrir: abrir, confirmar: confirmar,
    verFaltantes: verFaltantes, verFaltantesNuevas: verFaltantesNuevas, autoAlAprobar: autoAlAprobar
  };

  // Si las proformas ya se pintaron antes de que este módulo existiera, se completa ahora.
  try {
    if (activo() && STATE.proformas && STATE.proformas.length) {
      cargar().then(function () { try { renderTablaProf(); } catch (_) { /* nada */ } });
    }
  } catch (_) { /* nada */ }
})();
