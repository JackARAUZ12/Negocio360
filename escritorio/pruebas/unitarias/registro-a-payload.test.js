'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { convertir } = require('../../src/compartido/registro-a-payload');

const CAPTURAS = path.join(__dirname, '..', 'referencia-web', 'capturas.json');
const capturas = fs.existsSync(CAPTURAS) ? JSON.parse(fs.readFileSync(CAPTURAS, 'utf8')) : [];

test('las 10 ventas capturadas de la web real se convierten sin nada prohibido', { skip: !capturas.length }, () => {
  assert.strictEqual(capturas.length, 10);
  for (const c of capturas) {
    const { payload, noPermitido } = convertir(c.registro, { tipo: c.tipo, componentes_promo: c.extra.componentes_promo });
    assert.deepStrictEqual(noPermitido, [], c.nombre);
    assert.ok(payload.venta && payload.detalles.length > 0, c.nombre);
    assert.ok(!('auth_user_id' in payload.venta) && !('referencia_caja' in payload.venta));
    payload.detalles.forEach((d) => { assert.ok(!('venta_id' in d) && !('auth_user_id' in d) && !('id' in d)); });
    // lo que entra a Caja = total − impuestos − retención
    const caja = payload.caja.reduce((a, m) => a + m.monto, 0);
    const neto = payload.venta.total - payload.venta.impuesto - (payload.venta.retencion_ir_monto || 0);
    assert.ok(Math.abs(caja - neto) < 0.005, `${c.nombre}: caja ${caja} vs neto ${neto}`);
  }
});

test('pago dividido, comisión, garantía, otros impuestos y retención se trasladan', { skip: !capturas.length }, () => {
  const por = Object.fromEntries(capturas.map((c) => [c.nombre, convertir(c.registro, { tipo: c.tipo }).payload]));
  assert.strictEqual(por['nueva-pago-separado-iva'].caja.length, 2);
  assert.deepStrictEqual(por['nueva-tarjeta-banco-comision-garantia'].comision, {
    banco_id: por['nueva-tarjeta-banco-comision-garantia'].comision.banco_id, monto: 84, porcentaje: 3,
    gasto: { concepto: 'Comisión bancaria 3% — BAC (Venta V-000777)', observaciones: 'Generado automáticamente por la venta V-000777' },
    movimiento: por['nueva-tarjeta-banco-comision-garantia'].comision.movimiento });
  assert.strictEqual(por['nueva-tarjeta-banco-comision-garantia'].comision.movimiento.metodo_pago_nombre, 'Tarjeta');
  assert.strictEqual(por['nueva-tarjeta-banco-comision-garantia'].garantias.length, 1);
  assert.ok(!('numero' in por['nueva-tarjeta-banco-comision-garantia'].garantias[0]));
  assert.strictEqual(por['nueva-otros-impuestos-retencion'].impuestos.length, 2);
  assert.strictEqual(por['nueva-otros-impuestos-retencion'].venta_impuestos.length, 1);
  assert.strictEqual(por['nueva-otros-impuestos-retencion'].retencion.monto, 30.03);
  assert.ok(por['rapida-efectivo-iva'].auditoria.length >= 5);
});

test('lo que no se permite sin conexión se detecta', () => {
  const venta = { op: 'insert', tabla: 'ventas', payload: { numero_venta: 'V-1', total: 1, impuesto: 0 }, ids: ['x'] };
  const casos = [
    [{ op: 'insert', tabla: 'clientes', payload: { nombre: 'Nuevo' } }, 'clientes'],
    [{ op: 'insert', tabla: 'fiados', payload: {} }, 'fiados'],
    [{ op: 'rpc', nombre: 'descontar_stock_remoto', args: {} }, 'stock compartido entre sucursales'],
    [{ op: 'insert', tabla: 'numeros_serie', payload: [] }, 'numeros_serie'],
    [{ op: 'update', tabla: 'transporte_ordenes', payload: {} }, 'transporte_ordenes'],
    [{ op: 'insert', tabla: 'tabla_rara', payload: {} }, 'insert tabla_rara'],
  ];
  for (const [op, esperado] of casos) {
    assert.ok(convertir([venta, op]).noPermitido.includes(esperado), esperado);
  }
  assert.ok(convertir([]).noPermitido.includes('no se armó ninguna venta'));
  const fiado = { op: 'insert', tabla: 'ventas', payload: { metodo_pago: 'fiado' }, ids: ['x'] };
  assert.ok(convertir([fiado]).noPermitido.includes('venta a crédito o fiado'));
  assert.ok(convertir([venta, venta]).noPermitido.includes('más de una venta en la misma operación'));
});

test('stock, lotes y cliente no viajan: los calcula el servidor', () => {
  const ops = [
    { op: 'insert', tabla: 'ventas', payload: { numero_venta: 'V-1', total: 10, impuesto: 0 }, ids: ['v'] },
    { op: 'update', tabla: 'productos', payload: { stock_actual: 3 }, filtros: [] },
    { op: 'update', tabla: 'producto_lotes', payload: { cantidad_actual: 1 }, filtros: [] },
    { op: 'update', tabla: 'clientes', payload: { total_compras: 99 }, filtros: [] },
    { op: 'rpc', nombre: 'descontar_lote_fefo', args: {} },
    { op: 'rpc', nombre: 'descontar_lote_venta', args: {} },
    { op: 'update', tabla: 'ventas', payload: { referencia_caja: 'm' }, filtros: [] },
  ];
  const { payload, noPermitido } = convertir(ops, { tipo: 'nueva' });
  assert.deepStrictEqual(noPermitido, []);
  assert.strictEqual(JSON.stringify(payload).includes('stock_actual'), false);
  assert.strictEqual(JSON.stringify(payload).includes('total_compras'), false);
});

test('comisión de tarjeta: gasto + egreso ligado + venta; los enlaces los rehace el servidor', () => {
  const ops = [
    { op: 'insert', tabla: 'ventas', payload: { numero_venta: 'V-1', total: 100, impuesto: 0 }, ids: ['v'] },
    { op: 'insert', tabla: 'gastos', payload: { tipo: 'inmediato', categoria: 'Comisiones bancarias', concepto: 'Comisión bancaria 3% — BAC (Venta V-1)', monto: 3, venta_id: 'v', observaciones: 'Generado automáticamente por la venta V-1' }, ids: ['g'] },
    { op: 'insert', tabla: 'movimientos_financieros', payload: { tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO', concepto: 'Comisión bancaria 3% — BAC (Venta V-1)', monto: 3, banco_id: 'b', metodo_pago_nombre: 'Tarjeta', monto_moneda_banco: 0.08, referencia_tipo: 'gasto', referencia_id: 'g', fecha: '2026-10-22' }, ids: ['m'] },
    { op: 'update', tabla: 'gastos', payload: { movimiento_financiero_id: 'm' }, filtros: [] },
    { op: 'update', tabla: 'ventas', payload: { comision_porcentaje: 3, comision_monto: 3 }, filtros: [] },
  ];
  const { payload, noPermitido } = convertir(ops, { tipo: 'nueva' });
  assert.deepStrictEqual(noPermitido, []);
  assert.deepStrictEqual(payload.comision, {
    gasto: { concepto: 'Comisión bancaria 3% — BAC (Venta V-1)', observaciones: 'Generado automáticamente por la venta V-1' },
    banco_id: 'b', monto: 3, porcentaje: 3,
    movimiento: { concepto: 'Comisión bancaria 3% — BAC (Venta V-1)', monto: 3, metodo_pago_id: null, metodo_pago_nombre: 'Tarjeta', banco_id: 'b', monto_moneda_banco: 0.08, fecha: '2026-10-22' },
  });
  assert.ok(convertir([ops[0], { op: 'insert', tabla: 'gastos', payload: { categoria: 'Otro', concepto: 'x' } }]).noPermitido.includes('gasto no reconocido'));
  assert.ok(convertir([ops[0], { op: 'update', tabla: 'gastos', payload: { monto: 1 } }]).noPermitido.includes('cambio no reconocido en un gasto'));
});
