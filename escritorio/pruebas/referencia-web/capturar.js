// Ejecuta cada escenario con el código real de la web y guarda lo que
// habría escrito en la base (registro) + datos del carrito para el payload.
//   node capturar.js [salida.json]
'use strict';
const fs = require('fs');
const path = require('path');
const { abrirVentas } = require('./arnes');
const { escenarios } = require('./escenarios');
const F = require('./fixtures');

async function capturar(esc) {
  const fixtures = { userId: F.U, email: 'prueba-offline@negocio360.test', tablas: F.tablas,
    rpc: { generar_numero_venta: 'V-000777', generar_numero_garantia: 'GT-000001', obtener_stock_compartido_config: null } };
  const { navegador, page, errores } = await abrirVentas(fixtures);
  try {
    await page.waitForFunction(() => typeof S !== 'undefined' && S.userId && S.productosCache && S.productosCache.length > 0 && S.metodosPago && S.metodosPago.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.evaluate(`(${esc.pasos.toString()})(${JSON.stringify(F.IDS)})`);
    const extra = await page.evaluate((tipo) => {
      const carrito = tipo === 'rapida' ? VR.carrito : S.carrito;
      const cat = (id) => (S.productosCache.find((p) => p.id === id) || {}).precio;
      return {
        fecha_hoy: todayISO(),
        componentes_promo: Object.fromEntries(carrito.map((it, i) => [i, it.esPromocion ? (it.componentesPromo || []) : null]).filter(([, c]) => c)),
        precios_catalogo: Object.fromEntries(carrito.map((it, i) => [i, (!it.esCombo && !it.esPromocion && !it.escalaId && !it.presentacionId) ? cat(it.id) : null]).filter(([, v]) => v != null)),
        resumen: tipo === 'rapida' ? calcularResumenVR() : S._resumen,
      };
    }, esc.tipo);
    const desde = await page.evaluate(() => window.__N360_REGISTRO.length);
    await page.evaluate(() => { window.validarPasoActual = () => true; });
    await page.evaluate((tipo) => (tipo === 'rapida' ? confirmarVentaRapida() : confirmarVenta(false)), esc.tipo);
    await page.waitForTimeout(1500);
    const registro = await page.evaluate((d) => window.__N360_REGISTRO.slice(d), desde);
    const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"]')].map((t) => t.textContent.trim()).filter(Boolean).slice(-5));
    return { nombre: esc.nombre, tipo: esc.tipo, registro, extra, errores, toasts };
  } finally { await navegador.close(); }
}

(async () => {
  const salida = process.argv[2] || path.join(__dirname, 'capturas.json');
  const res = [];
  for (const e of escenarios) {
    const r = await capturar(e);
    const escrituras = r.registro.filter((x) => x.op !== 'rpc' || /descontar|generar/.test(x.nombre));
    console.log(`${r.nombre}: ${escrituras.length} escrituras; errores: ${r.errores.length}; ${r.toasts.filter((t) => /registrada|Error/.test(t)).join(' | ')}`);
    res.push(r);
  }
  fs.writeFileSync(salida, JSON.stringify(res, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
