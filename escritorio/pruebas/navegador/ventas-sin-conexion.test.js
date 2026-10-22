// La pantalla real de Ventas (build/web/ventas.html) SIN internet, con el
// modo sin conexión del programa. Para cada escenario se compara el paquete
// que se guarda en el equipo con el que sale del registro de la web normal
// (el mismo que en la Fase 2 se comparó centavo por centavo en el servidor).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { abrirVentas } = require('../referencia-web/arnes');
const { escenarios } = require('../referencia-web/escenarios');
const F = require('../referencia-web/fixtures');
const { convertir } = require('../../src/compartido/registro-a-payload');

const fixtures = () => ({ userId: F.U, email: 'prueba-offline@negocio360.test', tablas: JSON.parse(JSON.stringify(F.tablas)),
  rpc: { generar_numero_venta: 'V-000777', generar_numero_garantia: 'GT-000001', obtener_stock_compartido_config: null } });

// Programa simulado: lo que en Electron hace el proceso principal.
function programaFalso(arg) {
  const log = [];
  window.__N360_PROG = { log, guardadas: [], numeros: ['V-000777'], conexion: arg.conexion };
  const P = window.__N360_PROG;
  const oyentesCx = new Set();
  window.negocio360Escritorio = {
    esEscritorio: true,
    estadoConexion: async () => ({ conexion: P.conexion }),
    alCambiarConexion: (fn) => { oyentesCx.add(fn); return () => oyentesCx.delete(fn); },
    reintentarConexion: async () => ({ conexion: P.conexion }),
    info: async () => ({ version: 'prueba' }),
  };
  P.cambiarConexion = (c) => { P.conexion = c; oyentesCx.forEach((fn) => fn({ conexion: c })); };
  const tablas = () => window.__N360_FIXTURES.tablas;
  window.negocio360SinConexion = {
    estado: async () => ({ habilitado: arg.habilitado, cuenta: arg.cuenta, dispositivo_uid: arg.dispositivo, sin_subir_equipo: P.guardadas.length }),
    fijarSesion: async () => ({ ok: true }),
    catalogoLeer: async (ts) => { log.push('catalogoLeer'); return Object.fromEntries(ts.map((t) => [t, JSON.parse(JSON.stringify(tablas()[t] || []))])); },
    catalogoReemplazar: async () => ({}), catalogoInfo: async () => [],
    rpcGuardar: async () => true, rpcLeer: async () => null,
    numeroTomar: async () => { log.push('numero'); return P.numeros.shift() || null; },
    ventaGuardar: async (v) => { log.push('ventaGuardar'); P.guardadas.push(JSON.parse(JSON.stringify(v))); return { guardada: true }; },
    ventasListar: async () => [], ventaAnular: async () => ({ ok: true }), ventaReintentar: async () => true,
    subirAhora: async () => ({}), exportar: async () => ({}),
    pinGuardar: async () => true, pinVerificar: async () => ({ ok: false, motivo: 'incorrecto' }),
    alCambiar: () => () => {},
    retenerImpresion: () => log.push('retener'),
    liberarImpresion: async () => { log.push('liberar'); return []; },
    descartarImpresion: () => log.push('descartar'),
  };
}

async function listo(page) {
  await page.waitForFunction(() => typeof S !== 'undefined' && S.userId && S.productosCache && S.productosCache.length > 0 && S.metodosPago && S.metodosPago.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
}

// La web normal (sin programa): lo que guardaría.
async function referencia(esc) {
  const { navegador, page } = await abrirVentas(fixtures());
  try {
    await listo(page);
    await page.evaluate(`(${esc.pasos.toString()})(${JSON.stringify(F.IDS)})`);
    const extra = await page.evaluate((tipo) => {
      const carrito = tipo === 'rapida' ? VR.carrito : S.carrito;
      const cat = (id) => (S.productosCache.find((p) => p.id === id) || {}).precio;
      return {
        fecha_hoy: todayISO(),
        componentes_promo: Object.fromEntries(carrito.map((it, i) => [i, it.esPromocion ? (it.componentesPromo || []) : null]).filter(([, c]) => c)),
        precios_catalogo: Object.fromEntries(carrito.map((it, i) => [i, (!it.esCombo && !it.esPromocion && !it.escalaId && !it.presentacionId) ? cat(it.id) : null]).filter(([, v]) => v != null)),
      };
    }, esc.tipo);
    const desde = await page.evaluate(() => window.__N360_REGISTRO.length);
    await page.evaluate(() => { window.validarPasoActual = () => true; });
    await page.evaluate((tipo) => (tipo === 'rapida' ? confirmarVentaRapida() : confirmarVenta(false)), esc.tipo);
    await page.waitForTimeout(1500);
    const registro = await page.evaluate((d) => window.__N360_REGISTRO.slice(d), desde);
    return convertir(registro, { ...extra, tipo: esc.tipo }).payload;
  } finally { await navegador.close(); }
}

async function sinConexion(esc, { conexion = 'sin_conexion', habilitado = true } = {}) {
  const { navegador, page, errores } = await abrirVentas(fixtures(), {
    extra: programaFalso, extraArg: { conexion, habilitado, cuenta: F.U, dispositivo: F.IDS.dispositivo },
  });
  try {
    await listo(page);
    await page.evaluate(`(${esc.pasos.toString()})(${JSON.stringify(F.IDS)})`);
    await page.evaluate(() => { window.validarPasoActual = () => true; });
    await page.evaluate((tipo) => (tipo === 'rapida' ? confirmarVentaRapida() : confirmarVenta(false)), esc.tipo);
    await page.waitForTimeout(300);
    const prog = await page.evaluate(() => ({ log: window.__N360_PROG.log, guardadas: window.__N360_PROG.guardadas }));
    const toast = await page.evaluate(() => document.getElementById('toast') && document.getElementById('toast').textContent);
    const registroServidor = await page.evaluate(() => window.__N360_REGISTRO.filter((r) => r.op !== 'rpc').length);
    return { prog, toast, errores, registroServidor, page, navegador };
  } catch (e) { await navegador.close(); throw e; }
}

const normalizar = (p) => {
  const x = JSON.parse(JSON.stringify(p));
  delete x.uuid; delete x.dispositivo_uid; delete x.vendida_en;
  return x;
};

for (const esc of escenarios) {
  test(`sin internet: ${esc.nombre} guarda el mismo paquete que la web`, async () => {
    const ref = await referencia(esc);
    const r = await sinConexion(esc);
    try {
      assert.deepStrictEqual(r.errores, []);
      assert.strictEqual(r.prog.guardadas.length, 1, 'se guardó una venta en el equipo');
      const v = r.prog.guardadas[0];
      assert.strictEqual(v.payload.uuid, v.uuid);
      assert.strictEqual(v.payload.dispositivo_uid, F.IDS.dispositivo);
      assert.ok(v.payload.vendida_en);
      assert.deepStrictEqual(normalizar(v.payload), normalizar(ref));
      // El ticket se retuvo hasta que la venta quedó guardada.
      const L = r.prog.log;
      assert.ok(L.indexOf('retener') < L.indexOf('ventaGuardar') && L.indexOf('ventaGuardar') < L.indexOf('liberar'), L.join(','));
      // Nada se mandó al "servidor" (todo quedó en el equipo).
      assert.strictEqual(r.registroServidor, 0);
      assert.match(r.toast, /registrada.*Guardada en este equipo/);
      // Stock: lo vendido queda restado en la copia local.
      if (v.payload.detalles.some((d) => d.producto_id === F.IDS.cable)) {
        assert.ok(v.deltas.some((d) => d.tabla === 'productos' && d.id === F.IDS.cable && d.delta < 0));
      }
      assert.ok(v.filasLocales.some((f) => f.tabla === 'ventas' && f.fila.numero_venta === 'V-000777'));
    } finally { await r.navegador.close(); }
  });
}

test('con internet la venta de contado también va por la bandeja (todo o nada) y no toca el servidor directo', async () => {
  const r = await sinConexion(escenarios.find((e) => e.nombre === 'rapida-efectivo-iva'), { conexion: 'en_linea' });
  try {
    assert.strictEqual(r.prog.guardadas.length, 1);
    assert.strictEqual(r.registroServidor, 0);
    assert.doesNotMatch(r.toast, /Guardada en este equipo/);
  } finally { await r.navegador.close(); }
});

test('cuenta sin el modo: la venta va directo al servidor como en la web', async () => {
  const r = await sinConexion(escenarios[0], { conexion: 'en_linea', habilitado: false });
  try {
    assert.strictEqual(r.prog.guardadas.length, 0);
    assert.ok(r.registroServidor > 0);
  } finally { await r.navegador.close(); }
});

test('sin internet, fiado no se permite: aviso y nada guardado', async () => {
  const esc = { tipo: 'nueva', pasos: async (I) => { await abrirNuevaVenta(); await agregarAlCarritoConPrecio(I.martillo, 'producto', null); S.metodoPagoId = 'fiado'; S.metodoPagoNombre = 'Fiado'; seleccionarCliente(I.cliente); S.clienteOpcion = 'existente'; calcularResumen(); } };
  const r = await sinConexion(esc);
  try {
    assert.strictEqual(r.prog.guardadas.length, 0);
    assert.strictEqual(r.registroServidor, 0);
    const aviso = await r.page.evaluate(() => document.getElementById('n360-aviso-sin-conexion')?.textContent || '');
    assert.match(aviso, /crédito o fiado/);
  } finally { await r.navegador.close(); }
});

test('sin internet, pantalla de Ventas carga desde la copia local y numera desde el bloque', async () => {
  const r = await sinConexion({ tipo: 'nueva', pasos: async () => { await abrirNuevaVenta(); } });
  try {
    const num = await r.page.evaluate(() => S.numeroVenta);
    assert.strictEqual(num, 'V-000777');
    assert.ok(r.prog.log.includes('catalogoLeer'));
  } finally { await r.navegador.close(); }
});
