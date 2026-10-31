/* ============================================================
   MATERIA PRIMA FALTANTE -> ORDEN DE COMPRA   (ciclo opcional, Fase 2)
   Muestra qué materia prima falta para producir una o varias órdenes
   y, con un clic, crea la(s) orden(es) de compra (una por proveedor).
   Una orden de compra es solo una solicitud al proveedor: NO toca Caja ni
   Inventario; se convierte en compra real desde Compras.
   Solo funciona si el negocio activó "Pedidos con producción".
   Lo usan Producción y Proformas.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360Faltantes) return;

  var ids = [], rotulo = '', ocupado = false;

  function $(id) { return document.getElementById(id); }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 3 }); }
  function money(n) { try { return typeof fmt === 'function' ? fmt(n) : Number(n || 0).toFixed(2); } catch (_) { return Number(n || 0).toFixed(2); } }
  function cliente() {
    try { if (typeof sbClient !== 'undefined' && sbClient) return sbClient; } catch (_) { /* nada */ }
    try { if (typeof sb !== 'undefined' && sb) return sb; } catch (_) { /* nada */ }
    return null;
  }
  function usuario() {
    try { return (STATE.currentUser && STATE.currentUser.nombre) || (STATE.userEmail || '').split('@')[0] || 'Usuario'; } catch (_) { return 'Usuario'; }
  }
  function activo() { try { return !!(STATE.empresaConfig && STATE.empresaConfig.usa_ciclo_produccion_pedidos === true); } catch (_) { return false; } }

  function asegurarModal() {
    if ($('modal-faltantes')) return;
    var d = document.createElement('div');
    d.className = 'modal-overlay';
    d.id = 'modal-faltantes';
    d.setAttribute('onclick', "if(event.target===this)closeModal('modal-faltantes')");
    d.innerHTML = '<div class="modal-box" style="max-width:640px"><div class="modal-header"><h3 class="modal-title" id="mfal-titulo" style="margin:0">🛒 Materia prima</h3>' +
      '<button class="modal-close" onclick="closeModal(\'modal-faltantes\')">&times;</button></div>' +
      '<div class="modal-body" id="mfal-cuerpo"></div>' +
      '<div class="modal-footer"><button class="btn-ghost" onclick="closeModal(\'modal-faltantes\')">Cerrar</button>' +
      '<button class="btn-primary" id="mfal-crear" style="display:none" onclick="N360Faltantes.crear()">Crear orden(es) de compra</button></div></div>';
    document.body.appendChild(d);
  }

  var MSG = {
    unidad: 'Una materia prima de la receta tiene una unidad que no se puede convertir. Revisa la receta en Producción.',
    materia_no_existe: 'Una materia prima de la receta ya no existe. Revisa la receta en Producción.',
    sin_ordenes: 'Estas órdenes ya no están pendientes, no hay nada que comprar para ellas.',
    desactivado: 'La opción "Pedidos con producción" está apagada en Configuración.'
  };

  async function abrir(ordenIds, titulo) {
    if (!activo()) return;
    ids = (ordenIds || []).filter(Boolean);
    rotulo = titulo || '';
    asegurarModal();
    $('mfal-titulo').textContent = '🛒 Materia prima' + (rotulo ? ' — ' + rotulo : '');
    var bt = $('mfal-crear'); bt.style.display = 'none'; bt.disabled = false;
    $('mfal-cuerpo').innerHTML = 'Calculando lo que falta…';
    openModal('modal-faltantes');
    try {
      var r = await cliente().rpc('produccion_faltantes', { p_orden_ids: ids });
      if (r.error) throw r.error;
      var d = r.data || {};
      if (!d.ok) { $('mfal-cuerpo').innerHTML = '<p style="color:var(--danger)">' + e(MSG[d.motivo] || 'No se pudo calcular.') + '</p>'; return; }
      if (!(d.ordenes || []).length) { $('mfal-cuerpo').innerHTML = '<p>' + e(MSG.sin_ordenes) + '</p>'; return; }
      var items = d.items || [], faltan = items.filter(function (i) { return Number(i.falta) > 0; });
      var filas = items.map(function (i) {
        var f = Number(i.falta) > 0;
        return '<tr><td>' + e(i.nombre) + '</td><td class="td-right">' + num(i.necesario) + '</td><td class="td-right">' + num(i.disponible) + '</td>' +
          '<td class="td-right" style="font-weight:700;color:' + (f ? 'var(--danger)' : 'var(--success)') + '">' + (f ? num(i.falta) : '✓') + '</td>' +
          '<td>' + e(f ? (i.proveedor_nombre || '—') : '') + '</td></tr>';
      }).join('');
      var cab = '<p style="font-size:13px;margin-bottom:8px">Órdenes: <strong>' + e(d.ordenes.map(function (o) { return o.numero; }).join(', ')) + '</strong>' +
        (d.ordenes.length > 1 ? ' (el inventario se cuenta una sola vez para todas)' : '') + '</p>';
      var tabla = '<div class="table-wrap"><table><thead><tr><th>Materia prima</th><th class="th-right">Necesitas</th><th class="th-right">Hay</th><th class="th-right">Falta</th><th>Proveedor</th></tr></thead><tbody>' +
        (filas || '<tr><td colspan="5" class="empty-cell">Estas órdenes no usan materia prima.</td></tr>') + '</tbody></table></div>';
      if (!faltan.length) {
        $('mfal-cuerpo').innerHTML = cab + tabla + '<p style="margin-top:10px;color:var(--success);font-weight:700">✅ Hay materia prima suficiente para producir.</p>';
        return;
      }
      var cuantos = {}; faltan.forEach(function (i) { cuantos[i.proveedor_id || '_'] = 1; });
      var nOc = Object.keys(cuantos).length;
      $('mfal-cuerpo').innerHTML = cab + tabla +
        '<p style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)">Se creará ' + (nOc === 1 ? '1 orden de compra' : nOc + ' órdenes de compra (una por proveedor)') +
        ' con lo que falta. Es solo una solicitud al proveedor: <strong>no toca Caja ni Inventario</strong>. Cuando llegue la mercancía la conviertes en compra desde Compras.</p>';
      bt.style.display = '';
    } catch (err) {
      console.error('N360Faltantes.abrir:', err);
      $('mfal-cuerpo').innerHTML = '<p style="color:var(--danger)">No se pudo calcular lo que falta. Intenta de nuevo.</p>';
    }
  }

  async function crear() {
    if (ocupado) return;
    ocupado = true;
    var bt = $('mfal-crear'); if (bt) bt.disabled = true;
    try {
      var r = await cliente().rpc('produccion_crear_ordenes_compra', { p_orden_ids: ids, p_usuario: usuario() });
      if (r.error) throw r.error;
      var d = r.data || {};
      var cuerpo = $('mfal-cuerpo');
      if (!d.ok) {
        var m = d.motivo === 'ya_tiene_oc'
          ? 'Ya hay una orden de compra pendiente para esta producción (' + e(d.ocs) + '). Revísala en Compras › Órdenes de compra, o cancélala antes de crear otra.'
          : e(MSG[d.motivo] || 'No se pudo crear la orden de compra.');
        cuerpo.innerHTML = '<p style="color:var(--danger)">' + m + '</p>';
        if (d.motivo === 'ya_tiene_oc' && bt) bt.style.display = 'none';
        else if (bt) bt.disabled = false;
        return;
      }
      if (d.nada_falta) { cuerpo.innerHTML = '<p style="color:var(--success);font-weight:700">✅ Ya no falta nada: alguien repuso la materia prima.</p>'; if (bt) bt.style.display = 'none'; return; }
      cuerpo.innerHTML = '<p style="color:var(--success);font-weight:700">✅ ' + d.creadas.length + ' orden(es) de compra creada(s):</p><ul style="padding-left:18px;font-size:13px">' +
        d.creadas.map(function (c) { return '<li><strong>' + e(c.numero) + '</strong> — ' + e(c.proveedor || 'Sin proveedor') + ' — ' + money(c.total) + '</li>'; }).join('') + '</ul>' +
        '<p style="font-size:13px;margin-top:8px">Siguiente paso: en <a href="compras.html" style="font-weight:700">Compras › Órdenes de compra</a> la envías al proveedor y, cuando llegue la mercancía, la conviertes en compra. Después completas la producción.</p>';
      if (bt) bt.style.display = 'none';
    } catch (err) {
      console.error('N360Faltantes.crear:', err);
      $('mfal-cuerpo').innerHTML = '<p style="color:var(--danger)">No se pudo crear la orden de compra. Intenta de nuevo.</p>';
      if (bt) bt.disabled = false;
    } finally { ocupado = false; }
  }

  window.N360Faltantes = { abrir: abrir, crear: crear, activo: activo };
})();
