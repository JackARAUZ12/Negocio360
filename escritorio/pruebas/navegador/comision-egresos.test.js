// Comisión OPCIONAL por pagar con tarjeta en egresos (Gastos, Compras,
// Cuentas por pagar), con las pantallas reales y el Supabase simulado.
//   N360_REF_WEB=<copia empaquetada> para probar otra versión de las páginas.
'use strict';
const test = require('node:test');
const fs = require('fs');
const path = require('path');
// La comisión de egresos vive en la versión para main (docs/publicar-main-comisiones.patch):
// estas pruebas corren sobre esa copia (N360_REF_WEB) y se saltan si las páginas no la traen.
const WEB = process.env.N360_REF_WEB || path.join(__dirname, '..', '..', 'build', 'web');
const SIN_COMPONENTE = !fs.existsSync(path.join(WEB, 'comision-pago-tarjeta.js'));
const assert = require('node:assert');
const { abrirVentas } = require('../referencia-web/arnes');
const F = require('../referencia-web/fixtures');

const CXP = '0ff11e00-0000-4000-8000-000000000a01';
const fixtures = () => {
  const t = JSON.parse(JSON.stringify(F.tablas));
  t.cuentas_por_pagar = [{ id: CXP, auth_user_id: F.U, numero: 'CXP-0001', proveedor_nombre: 'Distribuidora Uno', monto_total: 1000,
    monto_pagado: 0, saldo_pendiente: 1000, estado: 'pendiente', tipo_credito: 'simple', fecha_compra: '2026-10-01', created_at: '2026-10-01T00:00:00Z' }];
  t.gastos = []; t.compras = []; t.proveedores = [];
  return { userId: F.U, email: 'prueba@negocio360.test', tablas: t, rpc: { siguiente_numero_compra: 'C-000001' } };
};

async function abrir(pagina, listo) {
  const r = await abrirVentas(fixtures(), { pagina });
  await r.page.waitForFunction(listo, null, { timeout: 20000 });
  await r.page.waitForTimeout(600);
  return r;
}
const registro = (page, desde) => page.evaluate((d) => window.__N360_REGISTRO.slice(d), desde);
const n = (page) => page.evaluate(() => window.__N360_REGISTRO.length);
const escr = (reg, tabla) => reg.filter((w) => w.tabla === tabla && w.op !== 'select');

// Elige el método por nombre (Tarjeta / Transferencia) y avisa el cambio como el usuario.
async function elegirMetodo(page, selectId, nombre) {
  await page.evaluate(([id, nom]) => {
    const sel = document.getElementById(id);
    const op = [...sel.options].find((o) => (o.dataset.nombre || o.textContent).trim() === nom);
    sel.value = op.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selectId, nombre]);
  await page.waitForTimeout(200);
}
async function marcarComision(page, prefijo, pct) {
  await page.evaluate(([p, v]) => {
    const chk = document.getElementById(`${p}-com-chk`);
    chk.checked = true; chk.dispatchEvent(new Event('change'));
    const inp = document.getElementById(`${p}-com-pct`);
    inp.value = String(v); inp.dispatchEvent(new Event('input'));
  }, [prefijo, pct]);
}
const visible = (page, prefijo) => page.evaluate((p) => {
  const w = document.getElementById(`${p}-comision-tarjeta-wrap`); return !!w && w.style.display !== 'none';
}, prefijo);

function revisarComision(reg, { origenTipo, origenId, monto }) {
  const g = escr(reg, 'gastos').find((w) => w.op === 'insert' && w.payload.categoria === 'Comisiones bancarias');
  assert.ok(g, 'se guardó el gasto de la comisión');
  assert.strictEqual(g.payload.tipo, 'inmediato');
  assert.strictEqual(g.payload.monto, monto);
  assert.strictEqual(g.payload.origen_tipo, origenTipo);
  if (origenId) assert.strictEqual(g.payload.origen_id, origenId);
  const m = escr(reg, 'movimientos_financieros').find((w) => w.op === 'insert' && w.payload.referencia_tipo === 'gasto' && w.payload.referencia_id === g.ids[0]);
  assert.ok(m, 'su egreso de Caja ligado al gasto');
  assert.deepStrictEqual([m.payload.tipo_flujo, m.payload.tipo_movimiento, m.payload.monto, m.payload.banco_id], ['EGRESO', 'GASTO', monto, F.IDS.bac]);
  assert.ok(escr(reg, 'gastos').some((w) => w.op === 'update' && w.payload.movimiento_financiero_id === m.ids[0]));
  return g;
}

test('Gastos: con tarjeta la comisión es opcional (apagada por defecto); marcada se guarda ligada al gasto; cancelar el gasto la cancela', { skip: SIN_COMPONENTE }, async () => {
  const r = await abrir('gastos.html', () => document.getElementById('gasto-metodo') && document.getElementById('gasto-metodo').options.length > 1);
  const { page } = r;
  try {
    const llenar = async (metodo, concepto) => {
      await page.evaluate(() => openNuevoGasto());
      await page.waitForTimeout(300);
      await page.evaluate((c) => { document.getElementById('gasto-concepto').value = c; document.getElementById('gasto-monto').value = '200'; }, concepto);
      await elegirMetodo(page, 'gasto-metodo', metodo);
      await page.evaluate((b) => { const s = document.getElementById('gasto-banco'); if (s) s.value = b; }, F.IDS.bac);
    };
    // 1) Tarjeta SIN marcar: no hay comisión
    await llenar('Tarjeta', 'Hosting sin comisión');
    assert.strictEqual(await visible(page, 'gasto'), true);
    let d = await n(page);
    await page.evaluate(() => saveGasto()); await page.waitForTimeout(800);
    let reg = await registro(page, d);
    assert.strictEqual(escr(reg, 'gastos').filter((w) => w.op === 'insert').length, 1);
    // 2) Transferencia: la opción ni aparece
    await llenar('Transferencia', 'Pago por transferencia');
    assert.strictEqual(await visible(page, 'gasto'), false);
    // 3) Tarjeta con comisión 3% de 200 = 6.00
    await llenar('Tarjeta', 'Hosting con comisión');
    await marcarComision(page, 'gasto', 3);
    assert.strictEqual(await page.evaluate(() => document.getElementById('gasto-com-monto').value), '6.00');
    d = await n(page);
    await page.evaluate(() => saveGasto()); await page.waitForTimeout(1000);
    reg = await registro(page, d);
    const principal = escr(reg, 'gastos').find((w) => w.op === 'insert' && w.payload.concepto === 'Hosting con comisión');
    revisarComision(reg, { origenTipo: 'gasto', origenId: principal.ids[0], monto: 6 });
    // 4) Cancelar el gasto principal cancela su comisión
    d = await n(page);
    await page.evaluate((id) => { confirmarCancelarGasto(id); return cancelarGasto(); }, principal.ids[0]);
    await page.waitForTimeout(800);
    reg = await registro(page, d);
    const anulaCom = reg.find((w) => w.tabla === 'gastos' && w.op === 'update' && w.payload.estado === 'cancelado' && w.payload.cancelado_motivo === 'Gasto cancelado');
    assert.ok(anulaCom, 'la comisión quedó cancelada');
    assert.deepStrictEqual(r.errores, []);
  } finally { await r.navegador.close(); }
});

test('Compras (compra directa): comisión opcional con tarjeta, ligada a la compra; anular la compra la anula', { skip: SIN_COMPONENTE }, async () => {
  const r = await abrir('compras.html', () => typeof STATE !== 'undefined' && STATE.userId && STATE.metodosPago && STATE.metodosPago.length > 0);
  const { page } = r;
  try {
    await page.evaluate(() => abrirCompraDirecta());
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('cd-concepto').value = 'Repuestos'; document.getElementById('cd-monto').value = '500'; });
    await elegirMetodo(page, 'cd-metodo-pago', 'Tarjeta');
    await page.waitForTimeout(300);
    await page.evaluate((b) => { const s = document.getElementById('cd-banco'); s.value = b; }, F.IDS.bac);
    assert.strictEqual(await visible(page, 'cd'), true);
    await marcarComision(page, 'cd', 2.5);
    assert.strictEqual(await page.evaluate(() => document.getElementById('cd-com-monto').value), '12.50');
    let d = await n(page);
    await page.evaluate(() => guardarCompraDirecta()); await page.waitForTimeout(1200);
    let reg = await registro(page, d);
    const compra = escr(reg, 'compras').find((w) => w.op === 'insert');
    assert.ok(compra, 'compra guardada');
    revisarComision(reg, { origenTipo: 'compra', origenId: compra.ids[0], monto: 12.5 });
    // el egreso de la compra sigue siendo el monto de la compra (la comisión va aparte)
    const egCompra = escr(reg, 'movimientos_financieros').find((w) => w.op === 'insert' && w.payload.tipo_movimiento === 'COMPRA');
    assert.strictEqual(egCompra.payload.monto, 500);
    // anular la compra
    d = await n(page);
    await page.evaluate((id) => { confirmarAnularCompra(id); return anularCompra(); }, compra.ids[0]);
    await page.waitForTimeout(1000);
    reg = await registro(page, d);
    assert.ok(reg.some((w) => w.tabla === 'gastos' && w.op === 'update' && w.payload.estado === 'cancelado' && /Compra C-000001 anulada/.test(w.payload.cancelado_motivo)), 'comisión cancelada con la compra');
    assert.deepStrictEqual(r.errores, []);
  } finally { await r.navegador.close(); }
});

test('Cuentas por pagar: pago con tarjeta con comisión opcional; con transferencia no aparece', { skip: SIN_COMPONENTE }, async () => {
  const r = await abrir('cuentas-por-pagar.html', () => typeof STATE !== 'undefined' && STATE.userId && STATE.cuentas && STATE.cuentas.length > 0);
  const { page } = r;
  try {
    await page.evaluate((id) => abrirPagarDesdeTabla(id), CXP);
    await page.waitForTimeout(500);
    await page.evaluate(() => { const m = document.getElementById('pg-monto'); m.value = '400'; m.dispatchEvent(new Event('input', { bubbles: true })); });
    await elegirMetodo(page, 'pg-metodo', 'Transferencia');
    assert.strictEqual(await visible(page, 'pg'), false);
    await elegirMetodo(page, 'pg-metodo', 'Tarjeta');
    await page.evaluate((b) => { document.getElementById('pg-banco').value = b; }, F.IDS.bac);
    assert.strictEqual(await visible(page, 'pg'), true);
    await marcarComision(page, 'pg', 3);
    const d = await n(page);
    await page.evaluate(() => confirmarPagoCxP()); await page.waitForTimeout(1500);
    const reg = await registro(page, d);
    const pago = escr(reg, 'cuentas_por_pagar_pagos').find((w) => w.op === 'insert');
    assert.ok(pago, 'pago registrado');
    revisarComision(reg, { origenTipo: 'pago_cxp', origenId: pago.ids[0], monto: 12 });
    const egPago = escr(reg, 'movimientos_financieros').find((w) => w.op === 'insert' && w.payload.tipo_movimiento === 'PAGO');
    assert.strictEqual(Number(egPago.payload.monto), 400);
    assert.deepStrictEqual(r.errores, []);
  } finally { await r.navegador.close(); }
});

test('La opción aparece solo con tarjeta en los demás pagos: compra normal, completar compra, pago de gasto programado y prima', { skip: SIN_COMPONENTE }, async () => {
  const casos = [
    { pagina: 'compras.html', listo: () => typeof STATE !== 'undefined' && STATE.userId && STATE.metodosPago && STATE.metodosPago.length > 0,
      abrir: () => abrirNuevaCompra(), sel: 'nc-metodo-pago', prefijo: 'nc' },
    { pagina: 'compras.html', listo: () => typeof STATE !== 'undefined' && STATE.userId && STATE.metodosPago && STATE.metodosPago.length > 0,
      abrir: () => { STATE.compras = [{ id: 'cp1', numero: 'C-000009', total: 300, estado: 'pendiente' }]; abrirCompletarCompra('cp1'); }, sel: 'cc-metodo-pago', prefijo: 'cc' },
    { pagina: 'cuentas-por-pagar.html', listo: () => typeof STATE !== 'undefined' && STATE.userId && STATE.metodosPago && STATE.metodosPago.length > 0,
      abrir: () => abrirNuevaCuentaDirecta(), sel: 'ncd-metodo-prima', prefijo: 'ncd' },
  ];
  for (const c of casos) {
    const r = await abrir(c.pagina, c.listo);
    try {
      await r.page.evaluate(`(${c.abrir.toString()})()`);
      await r.page.waitForTimeout(400);
      await elegirMetodo(r.page, c.sel, 'Tarjeta');
      assert.strictEqual(await visible(r.page, c.prefijo), true, `${c.prefijo} con tarjeta`);
      assert.strictEqual(await r.page.evaluate((p) => document.getElementById(`${p}-com-chk`).checked, c.prefijo), false, `${c.prefijo} apagada por defecto`);
      await elegirMetodo(r.page, c.sel, 'Transferencia');
      assert.strictEqual(await visible(r.page, c.prefijo), false, `${c.prefijo} con transferencia`);
    } finally { await r.navegador.close(); }
  }
  // Pago de un gasto programado
  const fx = fixtures();
  fx.tablas.gastos_programados = [{ id: 'gp1', auth_user_id: F.U, nombre: 'Alquiler', categoria: 'Alquiler', monto: 1000, frecuencia: 'mensual',
    fecha_proxima: '2099-01-01', activo: true, created_at: '2026-10-01T00:00:00Z' }];
  const r = await abrirVentas(fx, { pagina: 'gastos.html' });
  try {
    await r.page.waitForFunction(() => document.getElementById('gasto-metodo') && document.getElementById('gasto-metodo').options.length > 1, null, { timeout: 20000 });
    await r.page.waitForTimeout(800);
    await r.page.evaluate(() => abrirRegistrarPago('gp1'));
    await r.page.waitForTimeout(400);
    await elegirMetodo(r.page, 'pago-metodo', 'Tarjeta');
    assert.strictEqual(await visible(r.page, 'pago'), true, 'pago programado con tarjeta');
    await marcarComision(r.page, 'pago', 1.5);
    assert.strictEqual(await r.page.evaluate(() => document.getElementById('pago-com-monto').value), '15.00');
    await elegirMetodo(r.page, 'pago-metodo', 'Transferencia');
    assert.strictEqual(await visible(r.page, 'pago'), false, 'pago programado con transferencia');
  } finally { await r.navegador.close(); }
});
