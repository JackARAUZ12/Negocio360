/* ============================================================
   MOTIVO DEL CAMBIO DE EXISTENCIA (compartido: Productos y Bodega)
   ------------------------------------------------------------
   Antes, cambiar la existencia desde la ficha del producto se
   guardaba sin motivo y sin costo ("Editado directamente desde el
   formulario"), así que el inventario no se podía rastrear: no se
   sabía si era una carga inicial, un conteo, una merma o mercadería
   comprada que debió entrar por Compras.

   Ahora, al guardar un cambio de existencia, se pregunta el motivo.
   Si se cancela, NO se guarda nada (ni el producto ni el stock).
   Esto solo agrega una pregunta: no cambia cómo se guarda el
   producto ni el tipo de movimiento que leen los reportes.
   ============================================================ */
(function () {
  'use strict';

  var SUBE = [
    { razon: 'inventario_inicial', icono: '📦', etiqueta: 'Inventario inicial', ayuda: 'Mercadería que ya tenía antes de usar el sistema' },
    { razon: 'conteo_fisico', icono: '🔢', etiqueta: 'Conteo físico', ayuda: 'Al contar, había más de lo que decía el sistema' },
    { razon: 'devolucion_cliente', icono: '↩️', etiqueta: 'Devolución de cliente', ayuda: 'Un cliente devolvió mercadería' },
    { razon: 'traslado_recibido', icono: '🚚', etiqueta: 'Traída de otra bodega', ayuda: 'Llegó de otra bodega o sucursal' },
    { razon: 'error_anterior', icono: '✏️', etiqueta: 'Corregir un error', ayuda: 'Se había registrado mal antes' },
    { razon: 'otro', icono: '📝', etiqueta: 'Otro motivo', ayuda: 'Escribe cuál en la nota' },
  ];
  var BAJA = [
    { razon: 'conteo_fisico', icono: '🔢', etiqueta: 'Conteo físico', ayuda: 'Al contar, había menos de lo que decía el sistema' },
    { razon: 'dano', icono: '💥', etiqueta: 'Daño', ayuda: 'Mercadería dañada' },
    { razon: 'vencimiento', icono: '🗓️', etiqueta: 'Vencimiento', ayuda: 'Producto vencido' },
    { razon: 'robo', icono: '🔓', etiqueta: 'Robo o pérdida', ayuda: 'Faltante por robo o extravío' },
    { razon: 'uso_interno', icono: '🏭', etiqueta: 'Uso interno', ayuda: 'Se usó en el negocio o se regaló' },
    { razon: 'error_anterior', icono: '✏️', etiqueta: 'Corregir un error', ayuda: 'Se había registrado mal antes' },
    { razon: 'otro', icono: '📝', etiqueta: 'Otro motivo', ayuda: 'Escribe cuál en la nota' },
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 3 }); }

  /**
   * Pregunta el motivo de un cambio de existencia.
   * @param {{nombre:string, antes:number, despues:number}} o
   * @returns {Promise<{razon:string, etiqueta:string, nota:string}|null>} null si se cancela
   */
  function pedirMotivo(o) {
    return new Promise(function (resolve) {
      var antes = Number(o.antes || 0), despues = Number(o.despues || 0);
      var sube = despues > antes;
      var lista = sube ? SUBE : BAJA;
      var dif = despues - antes;
      var elegido = null;

      var fondo = document.createElement('div');
      fondo.id = 'aex-modal';
      fondo.setAttribute('role', 'dialog');
      fondo.setAttribute('aria-modal', 'true');
      fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
      var tarjetas = lista.map(function (x) {
        return '<button type="button" data-razon="' + x.razon + '" class="aex-op" style="text-align:left;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:10px;background:var(--bg-surface,#fff);color:var(--text-primary,#111);cursor:pointer;font:inherit">' +
          '<span style="font-size:18px;line-height:1">' + x.icono + '</span>' +
          '<span><b style="display:block;font-size:13.5px">' + esc(x.etiqueta) + '</b><small style="color:var(--text-secondary,#666);font-size:12px">' + esc(x.ayuda) + '</small></span></button>';
      }).join('');
      fondo.innerHTML =
        '<div style="background:var(--bg-surface,#fff);color:var(--text-primary,#111);border-radius:14px;width:100%;max-width:460px;max-height:90vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,.25)">' +
          '<div style="padding:16px 18px;border-bottom:1px solid var(--border,#e5e7eb)">' +
            '<div style="font-weight:700;font-size:15px">' + (sube ? '📈' : '📉') + ' ¿Por qué cambia la existencia?</div>' +
            '<div style="font-size:12.5px;color:var(--text-secondary,#666);margin-top:4px"><b>' + esc(o.nombre || 'Producto') + '</b>: de ' + num(antes) + ' a ' + num(despues) + ' (' + (dif > 0 ? '+' : '') + num(dif) + ')</div>' +
          '</div>' +
          '<div style="padding:14px 18px">' +
            (sube ? '<div style="font-size:12.5px;background:var(--warning-soft,#fff7e6);color:var(--text-primary,#111);border-radius:8px;padding:9px 11px;margin-bottom:12px">💡 Si es mercadería que <b>compraste</b>, regístrala en <b>Compras</b>: así queda el pago, el proveedor y el costo. Cancela aquí y ve a Compras.</div>' : '') +
            '<div style="display:grid;gap:8px">' + tarjetas + '</div>' +
            '<label style="display:block;font-size:12.5px;font-weight:600;margin:12px 0 5px">Nota <span id="aex-nota-req" style="font-weight:400;color:var(--text-secondary,#666)">(opcional)</span></label>' +
            '<input id="aex-nota" type="text" maxlength="200" placeholder="Ej: conteo del 14 de octubre" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:var(--bg-surface-2,#fafafa);color:var(--text-primary,#111);font-size:13.5px"/>' +
            '<p id="aex-error" style="color:#ef4444;font-size:12.5px;margin:8px 0 0;min-height:1em"></p>' +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--border,#e5e7eb)">' +
            '<button type="button" id="aex-cancelar" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border,#e5e7eb);background:transparent;color:var(--text-primary,#111);cursor:pointer;font-size:13px">Cancelar (no guardar)</button>' +
            '<button type="button" id="aex-ok" style="padding:8px 14px;border-radius:8px;border:none;background:var(--accent,#6C63FF);color:#fff;cursor:pointer;font-size:13px;font-weight:600">Guardar con este motivo</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(fondo);

      function q(id) { return fondo.querySelector('#' + id); }
      function cerrar(valor) {
        document.removeEventListener('keydown', teclas, true);
        if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
        resolve(valor);
      }
      function teclas(e) { if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); } }
      document.addEventListener('keydown', teclas, true);

      Array.prototype.forEach.call(fondo.querySelectorAll('.aex-op'), function (b) {
        b.addEventListener('click', function () {
          elegido = lista.filter(function (x) { return x.razon === b.getAttribute('data-razon'); })[0];
          Array.prototype.forEach.call(fondo.querySelectorAll('.aex-op'), function (o2) {
            o2.style.borderColor = 'var(--border,#e5e7eb)'; o2.style.background = 'var(--bg-surface,#fff)';
          });
          b.style.borderColor = 'var(--accent,#6C63FF)'; b.style.background = 'var(--accent-soft,#eef)';
          q('aex-nota-req').textContent = elegido.razon === 'otro' ? '(obligatoria)' : '(opcional)';
          q('aex-error').textContent = '';
        });
      });
      q('aex-cancelar').addEventListener('click', function () { cerrar(null); });
      fondo.addEventListener('click', function (e) { if (e.target === fondo) cerrar(null); });
      q('aex-ok').addEventListener('click', function () {
        var nota = (q('aex-nota').value || '').trim();
        if (!elegido) { q('aex-error').textContent = 'Elige un motivo.'; return; }
        if (elegido.razon === 'otro' && !nota) { q('aex-error').textContent = 'Escribe el motivo en la nota.'; q('aex-nota').focus(); return; }
        cerrar({ razon: elegido.razon, etiqueta: elegido.etiqueta, nota: nota });
      });
    });
  }

  // Texto que se guarda en la nota del movimiento de inventario.
  function notaMovimiento(m) {
    if (!m) return 'Editado directamente desde el formulario de producto';
    return 'Editado desde el producto — ' + m.etiqueta + (m.nota ? ': ' + m.nota : '');
  }

  window.N360AjusteExistencia = { pedirMotivo: pedirMotivo, notaMovimiento: notaMovimiento, _SUBE: SUBE, _BAJA: BAJA };
})();
