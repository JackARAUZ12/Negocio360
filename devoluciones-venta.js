/* ============================================================
   DEVOLUCIONES DE VENTA — datos compartidos (solo lectura)
   ------------------------------------------------------------
   Una devolución (DEV-000001) es un documento propio, con su propia
   fecha, que resta de las ventas del período en que ocurrió.
   La venta original NO cambia (sigue "completada" en su fecha).

   Para que Ventas, Dashboard, Estadísticas y Reportes muestren las
   ventas NETAS sin tocar cada cálculo, cada devolución se entrega como
   una "fila de venta en negativo" con los mismos campos que una venta:
     total    = −valor devuelto (con IVA)
     impuesto = −IVA de lo devuelto
     costo_total = −costo de lo que volvió al inventario (lo dañado sigue siendo costo)
   Así, cualquier suma de total / impuesto / costo ya da el neto.
   Las filas traen es_devolucion:true para no contarlas como "transacciones".

   Uso:
     const filas = await N360DevolucionesVenta.filasNegativas(sb, userId, '2026-10-01', '2026-10-31', { creadoPor })
     const mapa  = await N360DevolucionesVenta.porVentas(sb, userId, ventaIds)   // { venta_id: { total, n, numeros } }
   Si la tabla todavía no existe o falla la lectura, devuelve vacío
   (nunca rompe la pantalla que lo usa).
   ============================================================ */
(function () {
  'use strict';
  if (window.N360DevolucionesVenta) return;

  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function soloFecha(x) { return x ? String(x).slice(0, 10) : null; }

  async function delPeriodo(sb, userId, desde, hasta, opts) {
    opts = opts || {};
    try {
      var filas = [], ini = 0, TAM = 1000;
      while (true) {
        var q = sb.from('devoluciones_venta')
          .select('id, numero, venta_id, fecha, motivo, tipo_venta, total, impuesto, neto, costo_reingresado, costo_no_reingresado, monto_credito, monto_dinero, monto_caja, metodo_pago_nombre, usuario_nombre, created_at')
          .eq('auth_user_id', userId);
        if (desde) q = q.gte('fecha', soloFecha(desde));
        if (hasta) q = q.lte('fecha', soloFecha(hasta));
        if (opts.creadoPor) q = q.eq('usuario_nombre', opts.creadoPor);
        var r = await q.order('fecha', { ascending: false }).range(ini, ini + TAM - 1);
        if (r.error) return [];
        filas = filas.concat(r.data || []);
        if (!r.data || r.data.length < TAM) break;
        ini += TAM;
      }
      if (!filas.length) return [];
      // Datos de la venta original (cliente, forma de pago) para agrupar igual que las ventas
      var ids = Array.from(new Set(filas.map(function (d) { return d.venta_id; })));
      var ventas = {};
      for (var i = 0; i < ids.length; i += 200) {
        var rv = await sb.from('ventas').select('id, numero_venta, cliente_id, cliente_nombre, metodo_pago, estado_pago, metodo_pago_nombre')
          .in('id', ids.slice(i, i + 200));
        (rv.data || []).forEach(function (v) { ventas[v.id] = v; });
      }
      filas.forEach(function (d) { d._venta = ventas[d.venta_id] || {}; });
      return filas;
    } catch (e) { console.warn('N360DevolucionesVenta.delPeriodo:', e); return []; }
  }

  async function filasNegativas(sb, userId, desde, hasta, opts) {
    var devs = await delPeriodo(sb, userId, desde, hasta, opts);
    return devs.map(function (d) {
      var v = d._venta || {};
      var total = r2(d.total), imp = r2(d.impuesto), costo = r2(d.costo_reingresado);
      return {
        id: 'dev:' + d.id, devolucion_id: d.id, es_devolucion: true,
        numero_venta: d.numero + (v.numero_venta ? ' (de ' + v.numero_venta + ')' : ''),
        fecha: d.fecha, created_at: d.created_at,
        subtotal: -r2(total - imp), descuento: 0, impuesto: -imp, total: -total,
        costo_total: -costo, ganancia: -r2(total - costo),
        cliente_id: v.cliente_id || null, cliente_nombre: v.cliente_nombre || null,
        metodo_pago: v.metodo_pago || null, estado_pago: v.estado_pago || null,
        metodo_pago_nombre: 'Devolución' + (d.metodo_pago_nombre ? ' · ' + d.metodo_pago_nombre : ''),
        estado: 'completada', creado_por_nombre: d.usuario_nombre || null,
        venta_original_id: d.venta_id, motivo: d.motivo,
      };
    });
  }

  async function porVentas(sb, userId, ventaIds) {
    var mapa = {};
    var ids = (ventaIds || []).filter(function (x) { return x && String(x).indexOf('dev:') !== 0; });
    if (!ids.length) return mapa;
    try {
      for (var i = 0; i < ids.length; i += 200) {
        var r = await sb.from('devoluciones_venta').select('id, numero, venta_id, total, fecha')
          .eq('auth_user_id', userId).in('venta_id', ids.slice(i, i + 200));
        if (r.error) return mapa;
        (r.data || []).forEach(function (d) {
          var m = mapa[d.venta_id] || (mapa[d.venta_id] = { total: 0, n: 0, numeros: [] });
          m.total = r2(m.total + Number(d.total || 0)); m.n++; m.numeros.push(d.numero);
        });
      }
    } catch (e) { console.warn('N360DevolucionesVenta.porVentas:', e); }
    return mapa;
  }

  // ¿Esta venta tiene devoluciones? (para bloquear anular/corregir ANTES de tocar nada)
  // Devuelve un MENSAJE si no se puede seguir (tiene devoluciones, o no se pudo comprobar), o null si se puede.
  async function bloqueoPorDevoluciones(sb, ventaId) {
    if (!ventaId) return null;
    try {
      var r = await sb.from('devoluciones_venta').select('id', { count: 'exact', head: true }).eq('venta_id', ventaId);
      if (r.error) return 'No se pudo comprobar si esta venta tiene devoluciones. Revisa tu conexión e intenta de nuevo.';
      return (r.count || 0) > 0 ? 'Esta venta tiene devoluciones registradas: ya no se puede anular ni cambiar. Si hace falta, usa "Devolución" para lo que falte.' : null;
    } catch (_) { return 'No se pudo comprobar si esta venta tiene devoluciones. Revisa tu conexión e intenta de nuevo.'; }
  }

  window.N360DevolucionesVenta = { delPeriodo: delPeriodo, filasNegativas: filasNegativas, porVentas: porVentas, bloqueoPorDevoluciones: bloqueoPorDevoluciones };
})();
