// Qué lee la pantalla de Ventas (al abrir y al vender), para decidir qué
// copiar al equipo para trabajar sin conexión.
'use strict';
const { abrirVentas } = require('./arnes');
const F = require('./fixtures');
const { escenarios } = require('./escenarios');
(async () => {
  const todas = new Map();
  for (const esc of escenarios) {
    const { navegador, page } = await abrirVentas({ userId: F.U, tablas: JSON.parse(JSON.stringify(F.tablas)), rpc: { generar_numero_venta: 'V-000777' } });
    await page.waitForFunction(() => typeof S !== 'undefined' && S.productosCache && S.productosCache.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(3500);
    await page.evaluate(`(${esc.pasos.toString()})(${JSON.stringify(F.IDS)})`);
    await page.evaluate(() => { window.validarPasoActual = () => true; });
    await page.evaluate((t) => (t === 'rapida' ? confirmarVentaRapida() : confirmarVenta(false)), esc.tipo);
    await page.waitForTimeout(1500);
    for (const l of await page.evaluate(() => window.__N360_LECTURAS)) {
      const k = l.rpc ? 'rpc:' + l.rpc : l.tabla;
      const e = todas.get(k) || { n: 0, cols: new Set(), filtros: new Set() };
      e.n++; if (l.cols) e.cols.add(l.cols.slice(0, 80)); (l.filtros || []).forEach((f) => e.filtros.add(f[0] + ' ' + f[1]));
      todas.set(k, e);
    }
    await navegador.close();
  }
  for (const [k, e] of [...todas].sort()) console.log(k.padEnd(36), String(e.n).padStart(4), [...e.filtros].join(', ').slice(0, 90));
})();
