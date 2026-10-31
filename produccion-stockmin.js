/* ============================================================
   STOCK MÍNIMO -> PRODUCIR   (ciclo opcional, Fase 3a)
   Muestra los productos que están por debajo de su stock mínimo y que tienen
   una receta, y crea las órdenes de producción (PENDIENTES) con un clic.
   No mueve inventario ni Caja. Solo funciona si el negocio activó
   "Pedidos con producción" y "Producir cuando baje del stock mínimo".
   ============================================================ */
(function () {
  'use strict';
  if (window.N360StockMin) return;
  var datos = [], ocupado = false;
  function $(id) { return document.getElementById(id); }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 3 }); }
  function cliente() { try { if (typeof sb !== 'undefined' && sb) return sb; } catch (_) {} try { if (typeof sbClient !== 'undefined' && sbClient) return sbClient; } catch (_) {} return null; }
  function usuario() { try { return (STATE.currentUser && STATE.currentUser.nombre) || (STATE.userEmail || '').split('@')[0] || 'Usuario'; } catch (_) { return 'Usuario'; } }
  function activo() { try { var c = STATE.empresaConfig || {}; return c.usa_ciclo_produccion_pedidos === true && c.usa_stock_minimo_produccion === true; } catch (_) { return false; } }

  function asegurarModal() {
    if ($('modal-stockmin')) return;
    var d = document.createElement('div');
    d.className = 'modal-overlay'; d.id = 'modal-stockmin';
    d.setAttribute('onclick', "if(event.target===this)closeModal('modal-stockmin')");
    d.innerHTML = '<div class="modal-box" style="max-width:700px"><div class="modal-header"><h3 class="modal-title" style="margin:0">📉 Producir lo que está bajo el mínimo</h3>' +
      '<button class="modal-close" onclick="closeModal(\'modal-stockmin\')">&times;</button></div>' +
      '<div class="modal-body" id="smin-cuerpo"></div>' +
      '<div class="modal-footer"><button class="btn-ghost" onclick="closeModal(\'modal-stockmin\')">Cerrar</button>' +
      '<button class="btn-primary" id="smin-crear" style="display:none" onclick="N360StockMin.crear()">Crear órdenes de producción</button></div></div>';
    document.body.appendChild(d);
  }

  async function abrir() {
    if (!activo()) return;
    asegurarModal();
    var bt = $('smin-crear'); bt.style.display = 'none'; bt.disabled = false;
    $('smin-cuerpo').innerHTML = 'Revisando tu inventario…';
    openModal('modal-stockmin');
    try {
      var r = await cliente().rpc('produccion_sugerencias_stock_minimo');
      if (r.error) throw r.error;
      var d = r.data || {};
      if (!d.ok) { $('smin-cuerpo').innerHTML = '<p style="color:var(--danger)">Esta opción está apagada en Configuración.</p>'; return; }
      datos = d.items || [];
      var om = (d.omitidos || []).map(function (o) {
        return '<li>' + e(o.nombre) + ' — ' + (o.motivo === 'varias_recetas' ? 'tiene varias recetas activas, deja una sola' : o.motivo === 'sin_receta' ? 'no tiene receta de producción' : 'receta con rendimiento inválido') + '</li>';
      }).join('');
      var omHtml = om ? '<p style="margin-top:12px;font-size:12.5px;color:var(--text-secondary)">No se pueden sugerir (revísalos en Producción):</p><ul style="padding-left:18px;font-size:12.5px">' + om + '</ul>' : '';
      if (!datos.length) {
        $('smin-cuerpo').innerHTML = '<p style="color:var(--success);font-weight:700">✅ Ningún producto con receta está bajo su stock mínimo (contando lo que ya está en producción).</p>' + omHtml;
        return;
      }
      var filas = datos.map(function (i) {
        return '<tr><td>' + e(i.nombre) + '</td><td class="td-right">' + num(i.stock_actual) + '</td><td class="td-right">' + num(i.stock_minimo) + '</td>' +
          '<td class="td-right">' + num(i.en_cola) + '</td><td class="td-right" style="font-weight:700">' + num(i.sugerida) + '</td></tr>';
      }).join('');
      $('smin-cuerpo').innerHTML = '<div class="table-wrap"><table><thead><tr><th>Producto</th><th class="th-right">Hay</th><th class="th-right">Mínimo</th><th class="th-right">Ya en producción</th><th class="th-right">Producir</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
        '<p style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)">La cantidad se redondea a tandas completas de la receta. Se crean órdenes <strong>pendientes</strong>: no mueven inventario ni Caja hasta que las completes.</p>' + omHtml;
      bt.style.display = '';
    } catch (err) {
      console.error('N360StockMin.abrir:', err);
      $('smin-cuerpo').innerHTML = '<p style="color:var(--danger)">No se pudo revisar el inventario. Intenta de nuevo.</p>';
    }
  }

  async function crear() {
    if (ocupado) return;
    ocupado = true;
    var bt = $('smin-crear'); if (bt) bt.disabled = true;
    try {
      var r = await cliente().rpc('produccion_crear_ordenes_stock_minimo', { p_producto_ids: datos.map(function (i) { return i.producto_id; }), p_usuario: usuario() });
      if (r.error) throw r.error;
      var d = r.data || {};
      if (!d.ok) { $('smin-cuerpo').innerHTML = '<p style="color:var(--danger)">No se pudo crear: la opción está apagada o no hay productos.</p>'; return; }
      var c = d.creadas || [];
      $('smin-cuerpo').innerHTML = c.length
        ? '<p style="color:var(--success);font-weight:700">✅ ' + c.length + ' orden(es) creada(s):</p><ul style="padding-left:18px;font-size:13px">' +
          c.map(function (x) { return '<li><strong>' + e(x.numero) + '</strong> — ' + e(x.producto) + ' × ' + num(x.cantidad) + '</li>'; }).join('') + '</ul>'
        : '<p>Ya no hay nada que crear: alguien más ya las creó o repuso el inventario.</p>';
      if (bt) bt.style.display = 'none';
      if (typeof cargarOrdenes === 'function') cargarOrdenes();
    } catch (err) {
      console.error('N360StockMin.crear:', err);
      $('smin-cuerpo').innerHTML = '<p style="color:var(--danger)">No se pudo crear. Intenta de nuevo.</p>';
      if (bt) bt.disabled = false;
    } finally { ocupado = false; }
  }

  // Botón en la cabecera de Producción: aparece solo si el negocio activó la opción.
  var intentos = 0;
  function ponerBoton() {
    if (activo()) {
      var barra = document.querySelector('.greeting-actions');
      if (barra && !$('btn-stockmin')) {
        var b = document.createElement('button');
        b.className = 'btn-secondary'; b.id = 'btn-stockmin';
        b.title = 'Productos bajo su stock mínimo: crear sus órdenes de producción';
        b.textContent = '📉 Bajo el mínimo';
        b.onclick = abrir;
        barra.appendChild(b);
      }
      return;
    }
    if (++intentos < 40) setTimeout(ponerBoton, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ponerBoton); else ponerBoton();

  window.N360StockMin = { abrir: abrir, crear: crear, activo: activo };
})();
