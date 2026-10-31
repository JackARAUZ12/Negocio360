/* ============================================================
   RESERVA DEL PRODUCTO TERMINADO   (ciclo opcional, Fase 3d)
   Muestra en el detalle de la proforma lo reservado para ese pedido y permite reservar
   (si no se hizo solo) o liberar. La reserva no mueve inventario ni Caja: solo impide que
   otra venta se lleve esas unidades (el candado está en la base de datos).
   ============================================================ */
(function () {
  'use strict';
  if (window.N360ProfReserva) return;
  function $(id) { return document.getElementById(id); }
  function e(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function activo() { try { var c = STATE.empresaConfig || {}; return c.usa_ciclo_produccion_pedidos === true && c.usa_reserva_producto_terminado === true; } catch (_) { return false; } }
  var ocupado = false;

  async function pintar(p, body) {
    var viejo = $('pfr-detalle'); if (viejo) viejo.remove();
    if (!activo() || !body || ['convertida', 'rechazada', 'pago_parcial'].indexOf(p.estado) >= 0) return;
    var r = await sbClient.from('producto_reservas').select('cantidad,producto_id,productos(nombre)').eq('proforma_id', p.id).eq('estado', 'activa').eq('auth_user_id', STATE.userId);
    var res = r.data || [];
    var tieneProd = window.N360ProfProd && N360ProfProd.activo() && (STATE.detalleActual || []).length;
    if (!res.length && !tieneProd) return;
    var filas = res.map(function (x) { return '<li>' + e(Number(x.cantidad)) + ' × ' + e(x.productos && x.productos.nombre) + '</li>'; }).join('');
    var html = '<div id="pfr-detalle" style="margin-top:16px;padding:12px;border:1px solid var(--border);border-radius:10px">' +
      '<div style="font-weight:700;margin-bottom:6px">🔒 Producto reservado</div>' +
      (res.length ? '<ul style="padding-left:18px;font-size:13px">' + filas + '</ul><p style="font-size:12.5px;color:var(--text-secondary);margin-top:6px">Otras ventas no pueden llevarse estas unidades. Se liberan solas al convertir la proforma en venta.</p>' +
        '<button class="btn-secondary" style="margin-top:8px" onclick="N360ProfReserva.liberar()">Liberar reserva</button>'
        : '<p style="font-size:12.5px;color:var(--text-secondary)">Nada reservado todavía. Cuando termine la producción se reserva solo; si ya terminó, puedes reservar ahora.</p>' +
          '<button class="btn-secondary" style="margin-top:8px" onclick="N360ProfReserva.reservar()">Reservar producto terminado</button>') + '</div>';
    body.insertAdjacentHTML('beforeend', html);
  }

  async function reservar() {
    var p = STATE.proformaActual; if (!p || ocupado) return; ocupado = true;
    try {
      var r = await sbClient.rpc('proforma_reservar', { p_proforma_id: p.id });
      if (r.error) throw r.error;
      var d = r.data || {};
      if (!d.ok) { showToast('No se pudo reservar.', 'error'); return; }
      var n = (d.creadas || []).length;
      showToast(n ? '🔒 Producto reservado' : 'No hay producto terminado disponible para reservar (o la producción no ha terminado).', n ? undefined : 'error');
      if ((d.parciales || []).length) showToast('Algunas cantidades quedaron reservadas solo en parte: no hay más disponible.', 'error');
      try { verDetalleProf(p.id); } catch (_) { /* nada */ }
    } catch (ex) { console.error('N360ProfReserva.reservar:', ex); showToast('No se pudo reservar. Intenta de nuevo.', 'error'); } finally { ocupado = false; }
  }
  async function liberar() {
    var p = STATE.proformaActual; if (!p || ocupado) return; ocupado = true;
    try {
      var r = await sbClient.rpc('proforma_liberar_reserva', { p_proforma_id: p.id });
      if (r.error) throw r.error;
      showToast('Reserva liberada');
      try { verDetalleProf(p.id); } catch (_) { /* nada */ }
    } catch (ex) { console.error('N360ProfReserva.liberar:', ex); showToast('No se pudo liberar. Intenta de nuevo.', 'error'); } finally { ocupado = false; }
  }
  window.N360ProfReserva = { pintar: pintar, reservar: reservar, liberar: liberar, activo: activo };
})();
