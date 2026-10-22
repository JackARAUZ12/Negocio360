// Correcciones en la web (ventas.js), con la pantalla real de Ventas y un
// Supabase simulado que anota cada escritura:
//   - la comisión bancaria solo con TARJETA, como gasto real ligado a la
//     venta + su egreso de Caja ligado al gasto;
//   - en transferencias no hay comisión (ni en pantalla ni guardada);
//   - anular la venta anula también su comisión (gasto y egreso);
//   - el lote elegido se descuenta UNA sola vez, con las unidades reales.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { abrirVentas } = require('../referencia-web/arnes');
const { escenarios } = require('../referencia-web/escenarios');
const F = require('../referencia-web/fixtures');

const fixtures = () => ({ userId: F.U, email: 'prueba@negocio360.test', tablas: JSON.parse(JSON.stringify(F.tablas)),
  rpc: { generar_numero_venta: 'V-000777', generar_numero_garantia: 'GT-000001', obtener_stock_compartido_config: null } });

async function vender(nombre) {
  const esc = escenarios.find((e) => e.nombre === nombre);
  const { navegador, page, errores } = await abrirVentas(fixtures());
  await page.waitForFunction(() => typeof S !== 'undefined' && S.userId && S.productosCache && S.productosCache.length > 0 && S.metodosPago && S.metodosPago.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.evaluate(`(${esc.pasos.toString()})(${JSON.stringify(F.IDS)})`);
  const pantalla = await page.evaluate((tipo) => {
    const id = tipo === 'rapida' ? 'vr-banco-comision-resultado-wrap' : 'banco-comision-resultado-wrap';
    const el = document.getElementById(id);
    return { comisionVisible: !!el && el.style.display !== 'none' };
  }, esc.tipo);
  const desde = await page.evaluate(() => window.__N360_REGISTRO.length);
  await page.evaluate(() => { window.validarPasoActual = () => true; });
  await page.evaluate((tipo) => (tipo === 'rapida' ? confirmarVentaRapida() : confirmarVenta(false)), esc.tipo);
  await page.waitForTimeout(1200);
  const registro = await page.evaluate((d) => window.__N360_REGISTRO.slice(d), desde);
  return { navegador, page, errores, registro, pantalla };
}

const escrituras = (reg, tabla) => reg.filter((r) => r.tabla === tabla && r.op !== 'select');
// Id de la venta: insertada directo (web anterior) o devuelto por venta_registrar_atomica (web nueva).
function ventaDe(reg) {
  const ins = escrituras(reg, 'ventas').find((w) => w.op === 'insert');
  if (ins) return { id: ins.ids[0], total: Number(ins.payload.total) };
  const at = reg.find((w) => w.op === 'rpc' && w.nombre === 'venta_registrar_atomica');
  return { id: at.resultado.venta_id, total: Number(at.args.p_venta.total) };
}
function ingresosDe(reg) {
  const directos = escrituras(reg, 'movimientos_financieros').filter((m) => m.payload.tipo_flujo === 'INGRESO').map((m) => m.payload);
  if (directos.length) return directos;
  const at = reg.find((w) => w.op === 'rpc' && w.nombre === 'venta_registrar_atomica');
  return at ? at.args.p_caja : [];
}

for (const nombre of ['nueva-tarjeta-banco-comision-garantia', 'rapida-tarjeta-comision']) {
  test(`tarjeta (${nombre}): comisión como gasto ligado a la venta + egreso ligado al gasto`, async () => {
    const r = await vender(nombre);
    try {
      assert.deepStrictEqual(r.errores, []);
      assert.strictEqual(r.pantalla.comisionVisible, true);
      const venta = ventaDe(r.registro);
      const gastos = escrituras(r.registro, 'gastos');
      assert.strictEqual(gastos.length, 2); // insertar + enlazar con su egreso
      const g = gastos[0];
      assert.strictEqual(g.op, 'insert');
      assert.strictEqual(g.payload.tipo, 'inmediato'); // antes 'operativo' (la base lo rechazaba)
      assert.strictEqual(g.payload.categoria, 'Comisiones bancarias');
      assert.strictEqual(g.payload.venta_id, venta.id);
      assert.strictEqual(g.payload.metodo_pago_nombre, 'Tarjeta');
      const total = venta.total;
      assert.strictEqual(g.payload.monto, Math.round(total * 3) / 100); // 3% del total, a 2 decimales
      const egreso = escrituras(r.registro, 'movimientos_financieros').find((m) => m.payload.tipo_flujo === 'EGRESO');
      assert.strictEqual(egreso.payload.tipo_movimiento, 'GASTO');
      assert.strictEqual(egreso.payload.referencia_tipo, 'gasto');
      assert.strictEqual(egreso.payload.referencia_id, g.ids[0]);
      assert.strictEqual(egreso.payload.monto, g.payload.monto);
      assert.strictEqual(egreso.payload.banco_id, F.IDS.bac);
      assert.deepStrictEqual(gastos[1].payload, { movimiento_financiero_id: egreso.ids[0] });
      const constancia = escrituras(r.registro, 'ventas').find((w) => w.op === 'update' && 'comision_monto' in w.payload);
      assert.strictEqual(constancia.payload.comision_monto, g.payload.monto);
    } finally { await r.navegador.close(); }
  });
}

test('transferencia a un banco con comisión: no se cobra comisión (ni se muestra)', async () => {
  const r = await vender('nueva-transferencia-banco-sin-comision');
  try {
    assert.deepStrictEqual(r.errores, []);
    assert.strictEqual(r.pantalla.comisionVisible, false);
    assert.strictEqual(escrituras(r.registro, 'gastos').length, 0);
    assert.strictEqual(escrituras(r.registro, 'movimientos_financieros').filter((m) => m.payload.tipo_flujo === 'EGRESO').length, 0);
    assert.ok(!escrituras(r.registro, 'ventas').some((w) => w.op === 'update' && 'comision_monto' in w.payload));
    // el ingreso sí va al banco elegido
    const ingreso = ingresosDe(r.registro)[0];
    assert.strictEqual(ingreso.banco_id, F.IDS.bac);
  } finally { await r.navegador.close(); }
});

test('anular una venta con tarjeta: también se anula su comisión (gasto cancelado y egreso anulado)', async () => {
  const r = await vender('nueva-tarjeta-banco-comision-garantia');
  try {
    const venta = ventaDe(r.registro);
    const gastoId = escrituras(r.registro, 'gastos')[0].ids[0];
    const desde = await r.page.evaluate(() => window.__N360_REGISTRO.length);
    await r.page.evaluate(async (id) => {
      S.ventas = [{ id, numero_venta: 'V-000777' }];
      S.ventaDetalleId = id;
      await anularVenta();
    }, venta.id);
    await r.page.waitForTimeout(600);
    const reg = await r.page.evaluate((d) => window.__N360_REGISTRO.slice(d), desde);
    const movs = reg.filter((w) => w.tabla === 'movimientos_financieros');
    // reverso del ingreso de la venta
    assert.ok(movs.some((w) => w.op === 'insert' && w.payload.tipo_flujo === 'EGRESO' && /^Reverso por anulación/.test(w.payload.concepto)));
    // egreso de la comisión anulado, buscado por su gasto
    const anulaCom = movs.find((w) => w.op === 'update' && w.payload.estado === 'anulado'
      && w.filtros.some((f) => f[1] === 'referencia_tipo' && f[2] === 'gasto') && w.filtros.some((f) => f[1] === 'referencia_id' && f[2] === gastoId));
    assert.ok(anulaCom, 'se anula el egreso de la comisión');
    const cancela = reg.find((w) => w.tabla === 'gastos' && w.op === 'update' && w.payload.estado === 'cancelado');
    assert.ok(cancela && cancela.filtros.some((f) => f[1] === 'id' && f[2] === gastoId), 'se cancela el gasto de la comisión');
    const anulada = reg.find((w) => w.tabla === 'ventas' && w.op === 'update' && w.payload.estado === 'anulada');
    assert.ok(anulada);
  } finally { await r.navegador.close(); }
});

test('lote elegido en la venta: se descuenta UNA sola vez y con las unidades reales', async () => {
  const r = await vender('nueva-farmacia-lote-presentacion');
  try {
    assert.deepStrictEqual(r.errores, []);
    const rpcs = r.registro.filter((w) => w.op === 'rpc' && /^descontar_lote/.test(w.nombre));
    const paracetamol = rpcs.filter((w) => w.args.p_producto_id === F.IDS.paracetamol);
    assert.deepStrictEqual(paracetamol, [{ op: 'rpc', nombre: 'descontar_lote_venta', args: { p_lote_id: F.IDS.lote1, p_producto_id: F.IDS.paracetamol, p_cantidad: 4 } }]);
    // ya no se escribe el lote "a mano" desde el navegador (lo hace el servidor, atómico)
    assert.strictEqual(escrituras(r.registro, 'producto_lotes').length, 0);
    // presentación Caja x12 sin lote elegido: 12 unidades por FEFO
    assert.ok(rpcs.some((w) => w.nombre === 'descontar_lote_fefo' && w.args.p_producto_id === F.IDS.clavos && w.args.p_cantidad === 12));
  } finally { await r.navegador.close(); }
});
