// Convierte lo que el código REAL de ventas.js intentó escribir en la base
// (anotado por un cliente de Supabase "grabador") en el paquete que recibe
// offline_registrar_venta. Así la venta sin conexión lleva exactamente las
// mismas filas que habría guardado la web.
//
// Lo que NO se copia, porque lo calcula el servidor de forma segura:
//   - actualizaciones de stock y lotes (la web escribe valores absolutos de
//     su copia local; el servidor resta en el momento);
//   - saldos de Caja e Impuestos, número de garantía, total del cliente,
//     referencia_caja, y los enlaces gasto ↔ egreso de la comisión bancaria.
// Si la venta intentó algo que sin conexión no se permite (cliente nuevo,
// fiado/crédito, recetas, transporte, números de serie…), se devuelve en
// `noPermitido` y la venta NO debe guardarse sin conexión.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.N360RegistroAPayload = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Escrituras que se ignoran porque el servidor las rehace o no aplican.
  const IGNORAR_UPDATE = new Set(['productos', 'producto_lotes', 'clientes']);
  // Tablas que sin conexión no se permiten (la venta debe esperar internet).
  const NO_PERMITIDAS = new Set(['clientes', 'fiados', 'creditos', 'farmacia_recetas', 'vet_consultas', 'vet_estancias',
    'transporte_ordenes', 'numeros_serie', 'proformas', 'pagos_clientes_recurrentes', 'impuestos', 'bancos']);

  const sinId = (fila) => { const f = Object.assign({}, fila); delete f.id; return f; };
  const comoLista = (x) => (Array.isArray(x) ? x : (x ? [x] : []));

  function convertir(registro, extra) {
    extra = extra || {};
    const noPermitido = [];
    const p = {
      version: 1,
      uuid: extra.uuid || null,
      dispositivo_uid: extra.dispositivo_uid || null,
      tipo: extra.tipo,
      fecha_hoy: extra.fecha_hoy || null,
      vendida_en: extra.vendida_en || null,
      venta: null, detalles: [], caja: [], comision: null, impuestos: [], venta_impuestos: [],
      retencion: null, garantias: [], auditoria: [],
      componentes_promo: extra.componentes_promo || {},
      precios_catalogo: extra.precios_catalogo || {},
    };
    let ventaFalsaId = null;

    for (const op of registro || []) {
      if (op.op === 'select') continue;
      if (op.op === 'rpc') {
        if (/^(descontar_lote_fefo|generar_numero_garantia|generar_numero_venta)$/.test(op.nombre)) continue;
        if (op.nombre === 'descontar_stock_remoto') { noPermitido.push('stock compartido entre sucursales'); continue; }
        continue; // otras funciones de solo lectura o de fondo
      }
      const t = op.tabla;
      if (op.op === 'insert' && t === 'ventas') {
        if (p.venta) { noPermitido.push('más de una venta en la misma operación'); continue; }
        p.venta = sinId(op.payload);
        ventaFalsaId = op.ids && op.ids[0];
        continue;
      }
      if (op.op === 'insert' && t === 'venta_detalles') { p.detalles = comoLista(op.payload).map(sinId); continue; }
      if (op.op === 'insert' && t === 'movimientos_financieros') {
        const m = sinId(op.payload);
        if (m.tipo_flujo === 'INGRESO' && m.tipo_movimiento === 'VENTA') {
          p.caja.push({ concepto: m.concepto, monto: m.monto, metodo_pago_id: m.metodo_pago_id || null, metodo_pago_nombre: m.metodo_pago_nombre || null,
            banco_id: m.banco_id || null, monto_moneda_banco: m.monto_moneda_banco == null ? null : m.monto_moneda_banco,
            observaciones: m.observaciones == null ? null : m.observaciones, fecha: m.fecha });
        } else if (m.tipo_flujo === 'EGRESO' && m.tipo_movimiento === 'GASTO' && /^Comisión bancaria/.test(m.concepto || '')) {
          p.comision = Object.assign(p.comision || {}, {
            banco_id: m.banco_id, monto: m.monto,
            movimiento: { concepto: m.concepto, monto: m.monto, metodo_pago_id: m.metodo_pago_id || null, metodo_pago_nombre: m.metodo_pago_nombre || null, banco_id: m.banco_id,
              monto_moneda_banco: m.monto_moneda_banco == null ? null : m.monto_moneda_banco, fecha: m.fecha },
          });
        } else noPermitido.push('movimiento de Caja no reconocido: ' + (m.concepto || ''));
        continue;
      }
      if (op.op === 'update' && t === 'ventas') {
        const pl = op.payload || {};
        if ('comision_porcentaje' in pl || 'comision_monto' in pl) {
          p.comision = Object.assign(p.comision || {}, { porcentaje: pl.comision_porcentaje, monto: pl.comision_monto });
        } else if (Object.keys(pl).some((k) => k !== 'referencia_caja')) noPermitido.push('cambio no reconocido en la venta');
        continue;
      }
      if (op.op === 'insert' && t === 'movimientos_impuestos') {
        const m = sinId(op.payload);
        p.impuestos.push({ concepto: m.concepto, monto: m.monto, impuesto_id: m.impuesto_id || null, impuesto_nombre: m.impuesto_nombre || null, fecha: m.fecha });
        continue;
      }
      if (op.op === 'insert' && t === 'venta_impuestos') {
        p.venta_impuestos = p.venta_impuestos.concat(comoLista(op.payload).map((v) => ({ impuesto_id: v.impuesto_id, nombre: v.nombre, porcentaje: v.porcentaje, monto: v.monto })));
        continue;
      }
      if (op.op === 'insert' && t === 'retenciones_ir') {
        const r = op.payload;
        p.retencion = { contraparte_nombre: r.contraparte_nombre, fecha: r.fecha, base: r.base, porcentaje: r.porcentaje, monto: r.monto };
        continue;
      }
      if (op.op === 'insert' && t === 'garantias_clientes') {
        p.garantias = p.garantias.concat(comoLista(op.payload).map((g) => {
          const f = sinId(g); delete f.numero; delete f.venta_id; delete f.auth_user_id; return f;
        }));
        continue;
      }
      if (op.op === 'insert' && t === 'auditoria_log') {
        const a = op.payload || {};
        p.auditoria.push({ perfil_nombre: a.perfil_nombre, perfil_tipo: a.perfil_tipo, modulo: a.modulo, tabla: a.tabla, accion: a.accion, resumen: a.resumen == null ? null : a.resumen });
        continue;
      }
      if (op.op === 'insert' && t === 'gastos') {
        const g = op.payload || {};
        if (g.categoria === 'Comisiones bancarias' && /^Comisión bancaria/.test(g.concepto || '')) {
          p.comision = Object.assign(p.comision || {}, { gasto: { concepto: g.concepto, observaciones: g.observaciones == null ? null : g.observaciones } });
        } else noPermitido.push('gasto no reconocido');
        continue;
      }
      if (op.op === 'update' && t === 'gastos') {
        // solo enlazar el gasto de la comisión con su egreso de Caja (lo rehace el servidor)
        if (Object.keys(op.payload || {}).some((k) => k !== 'movimiento_financiero_id')) noPermitido.push('cambio no reconocido en un gasto');
        continue;
      }
      if (op.op === 'update' && IGNORAR_UPDATE.has(t)) continue;
      if (NO_PERMITIDAS.has(t)) { noPermitido.push(t); continue; }
      noPermitido.push(`${op.op} ${t}`);
    }

    if (!p.venta) noPermitido.push('no se armó ninguna venta');
    else {
      const mp = String(p.venta.metodo_pago || '').toLowerCase();
      if (mp === 'fiado' || mp === 'credito' || p.venta.estado_pago === 'credito') noPermitido.push('venta a crédito o fiado');
      if (p.venta.canje_recompensa_id) noPermitido.push('canje de puntos');
    }
    if (p.detalles.some((d) => d.venta_id && ventaFalsaId && d.venta_id !== ventaFalsaId)) noPermitido.push('detalle de otra venta');
    p.detalles.forEach((d) => { delete d.venta_id; delete d.auth_user_id; });
    if (p.venta) { delete p.venta.auth_user_id; delete p.venta.referencia_caja; }
    return { payload: p, noPermitido: [...new Set(noPermitido)] };
  }

  return { convertir };
});
