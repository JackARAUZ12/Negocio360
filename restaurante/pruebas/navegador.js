/* Pruebas en navegador real (Chromium) del Restaurante · Fase 1 (cobro con candados).
   Base de datos SIMULADA (la misma de la Clínica: clinica/pruebas/supabase-simulado.js): no toca producción.
   Ejecutar desde la raíz del repo:
     NODE_PATH=/opt/node22/lib/node_modules node restaurante/pruebas/navegador.js
   Revisa: cobro de la mesa como VENTA real (motor de Ventas), pago dividido por platillos, propina
   aparte en Caja, mesa que se cierra sola, candado contra el doble cobro, rondas a cocina, quitar
   platillos con motivo, cuadre contra una venta directa y que nada se desborde en celular (360 px). */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const UID = 'u-prueba-0000-0000-000000000001';
const MOCK = fs.readFileSync(path.join(RAIZ, 'clinica', 'pruebas', 'supabase-simulado.js'), 'utf8');
const XSS = '<img src=x onerror="window.__xss=1">';

function semilla() {
  const vistos = ['restaurante_mesas', 'restaurante_comandas', 'restaurante_cocina', 'ventas', 'dashboard'].map(k => ({ auth_user_id: UID, modulo_key: k }));
  const ahora = new Date(Date.now() - 20 * 60000).toISOString();
  return {
    configuracion_empresa: [{ id: 'cfg1', auth_user_id: UID, usa_modulo_restaurante: true, nombre_comercial: 'Fritanga Doña Tere', moneda: 'C$', pais: 'NI', onboarding_completado: true }],
    usuarios: [{ id: 'us1', auth_user_id: UID, nombre: 'Jack', multiusuario_activo: false, estado_cuenta: 'activa' }],
    tutoriales_vistos: vistos,
    restaurante_mesas: [
      { id: 'm1', auth_user_id: UID, numero: '1', zona: 'interior', capacidad: 4, estado: 'ocupada', activo: true },
      { id: 'm2', auth_user_id: UID, numero: '2', zona: 'terraza', capacidad: 2, estado: 'ocupada', activo: true },
      { id: 'm3', auth_user_id: UID, numero: '3', zona: 'interior', capacidad: 2, estado: 'ocupada', activo: true },
    ],
    productos: [
      { id: 'p-carne', auth_user_id: UID, nombre: 'Carne asada ' + XSS, tipo: 'producto', precio: 260, costo: 120, stock_actual: 25, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false },
      { id: 'p-cerveza', auth_user_id: UID, nombre: 'Cerveza nacional', tipo: 'producto', precio: 60, costo: 30, stock_actual: 96, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false },
      { id: 'p-naca', auth_user_id: UID, nombre: 'Nacatamal', tipo: 'producto', precio: 110, costo: 50, stock_actual: 30, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false },
    ],
    clientes: [{ id: 'cli-1', auth_user_id: UID, nombre: 'Cliente', apellido: 'Frecuente', activo: true }],
    metodos_pago: [{ id: 'mp-efectivo', auth_user_id: UID, nombre: 'Efectivo', activo: true, tipo: 'efectivo', orden: 1 }, { id: 'mp-tarjeta', auth_user_id: UID, nombre: 'Tarjeta', activo: true, tipo: 'tarjeta', orden: 2 }],
    restaurante_comandas: [
      { id: 'com-1', auth_user_id: UID, mesa_id: 'm1', estado: 'enviada', ronda_actual: 1, numero_comensales: 3, mesero_nombre: 'Ana', created_at: ahora },
      { id: 'com-2', auth_user_id: UID, mesa_id: 'm2', estado: 'lista', ronda_actual: 1, numero_comensales: 2, created_at: ahora },
      { id: 'com-3', auth_user_id: UID, mesa_id: 'm3', estado: 'enviada', ronda_actual: 1, numero_comensales: 2, created_at: ahora },
    ],
    restaurante_comanda_items: [
      { id: 'i-carne', auth_user_id: UID, comanda_id: 'com-1', producto_id: 'p-carne', nombre_producto: 'Carne asada ' + XSS, cantidad: 2, precio_unitario: 260, estado: 'en_preparacion', ronda: 1, created_at: ahora },
      { id: 'i-cerveza', auth_user_id: UID, comanda_id: 'com-1', producto_id: 'p-cerveza', nombre_producto: 'Cerveza nacional', cantidad: 3, precio_unitario: 60, estado: 'listo', ronda: 1, created_at: ahora },
      { id: 'i-naca', auth_user_id: UID, comanda_id: 'com-1', producto_id: 'p-naca', nombre_producto: 'Nacatamal', cantidad: 1, precio_unitario: 110, estado: 'en_preparacion', ronda: 1, created_at: ahora },
      { id: 'i-c2', auth_user_id: UID, comanda_id: 'com-2', producto_id: 'p-naca', nombre_producto: 'Nacatamal', cantidad: 2, precio_unitario: 110, estado: 'listo', ronda: 1, created_at: ahora },
      { id: 'i-c3', auth_user_id: UID, comanda_id: 'com-3', producto_id: 'p-carne', nombre_producto: 'Carne asada', cantidad: 1, precio_unitario: 260, estado: 'en_preparacion', ronda: 1, created_at: ahora },
    ],
  };
}

function servidor(raiz = RAIZ) {
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
  return http.createServer((req, res) => {
    const f = path.join(raiz, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(0);
}
const fallas = [], oks = [];
const verificar = (cond, msg) => { (cond ? oks : fallas).push(msg); if (!cond) console.error('  ✗', msg); };
async function nuevaPagina(browser, base, ancho, alto) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: ancho < 500, hasTouch: ancho < 500 });
  await ctx.route('**/*', ruta => {
    const u = ruta.request().url();
    if (u.startsWith(base)) return ruta.continue();
    if (u.includes('supabase-js')) return ruta.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (u.endsWith('.js') || u.includes('lucide')) return ruta.fulfill({ contentType: 'application/javascript', body: '' });
    return ruta.fulfill({ contentType: 'text/css', body: '' });
  });
  await ctx.addInitScript(s => { window.__SEED = s; }, semilla());
  const page = await ctx.newPage();
  page.__errores = [];
  page.on('pageerror', e => page.__errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
async function sinDesborde(page, nombre) {
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vista: window.innerWidth }));
  verificar(w.doc <= w.vista + 1, `${nombre}: sin desborde horizontal (${w.doc} <= ${w.vista})`);
}
async function cajaSinDesborde(page, nombre) {
  const r = await page.evaluate(() => { const c = document.querySelector('#rc-cobro .rc-caja'); if (!c) return null; const b = c.getBoundingClientRect(); const cu = document.getElementById('rc-cuerpo');
    return { ancho: b.width, dentro: cu.scrollWidth <= cu.clientWidth + 1 }; });
  verificar(r && r.ancho <= page.viewportSize().width + 1 && r.dentro, `${nombre}: la pantalla de cobro cabe sin desbordarse`);
}
const esperarListo = page => page.waitForFunction(() => document.getElementById('app')?.style.display === 'flex', null, { timeout: 15000 });
const db = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
const log = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('__LOG') || '[]'));
async function esperarPago(page) {
  await page.waitForSelector('#rc-metodos [data-metodo]', { timeout: 20000 });
}
async function cobrarCon(page, metodo, recibido) {
  await page.locator('#rc-metodos [data-metodo]', { hasText: metodo }).first().click();
  if (recibido != null) await page.fill('#rc-recibido', String(recibido));
  await page.click('#rc-cobrar');
  await page.waitForFunction(() => document.querySelector('#rc-cobro .rc-ok') || (document.getElementById('rc-err')?.textContent || '').length > 0, null, { timeout: 20000 });
}

async function pruebaCobro(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Cobro de mesa en ${tag} (${ancho}px)`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
  await page.goto(base + '/restaurante-comandas.html'); await esperarListo(page);
  await page.waitForSelector('#com-grid .hab-card');
  const tarjeta = page.locator('#com-grid .hab-card', { hasText: 'Mesa 1' });
  verificar((await tarjeta.textContent()).includes('810.00'), `${tag}: la mesa muestra su cuenta (2×260 + 3×60 + 110 = 810)`);
  await sinDesborde(page, `${tag} comandas`);

  // 1) Pago dividido: esta persona paga 1 carne y 2 cervezas, con 10 % de propina
  await tarjeta.locator('text=💰 Cobrar').click();
  await page.waitForSelector('#rc-cobro [data-modo="dividir"]');
  verificar(/Cobrar — Mesa 1/.test(await page.textContent('#rc-tit')), `${tag}: abre la pantalla de cobro del restaurante (no lleva a Ventas)`);
  verificar(/restaurante-comandas\.html/.test(page.url()), `${tag}: se queda en Comandas`);
  verificar((await page.textContent('#rc-pie')).includes('891.00'), `${tag}: cuenta completa 810 + propina 10 % (81) = 891`);
  await cajaSinDesborde(page, `${tag} elegir`);
  await page.click('#rc-cobro [data-modo="dividir"]');
  await page.click('[data-mas="i-carne"]'); await page.click('[data-mas="i-cerveza"]'); await page.click('[data-mas="i-cerveza"]');
  verificar((await page.textContent('#rc-pie')).includes('418.00'), `${tag}: dividir: 260 + 2×60 = 380 + propina 38 = 418`);
  verificar((await page.textContent('#rc-cuerpo')).includes('Quedarán platillos pendientes'), `${tag}: avisa que quedan platillos en la mesa`);
  if (process.env.FOTOS) await page.waitForTimeout(500), await page.screenshot({ path: process.env.FOTOS + '/rest-dividir-' + tag + '.png' });
  await page.fill('#rc-personas', '2'); await page.dispatchEvent('#rc-personas', 'change');
  verificar((await page.textContent('#rc-cuerpo')).includes('209.00 por persona'), `${tag}: partes iguales como referencia (418 / 2 = 209)`);
  await page.evaluate(() => sessionStorage.setItem('__LOG', '[]'));
  await page.click('#rc-seguir');
  await esperarPago(page);
  const pago = await page.textContent('#rc-cuerpo');
  verificar(pago.includes('380.00') && pago.includes('Propina (aparte)') && pago.includes('418.00'), `${tag}: el pago muestra la venta (380) y la propina aparte (38): total 418`);
  verificar(!(await page.isVisible('#rc-marco')) || (await page.evaluate(() => document.getElementById('rc-marco').getBoundingClientRect().height)) < 2, `${tag}: la pantalla de Ventas no se ve (motor oculto)`);
  // Otro equipo no puede empezar a cobrar la misma mesa mientras tanto
  const doble = await page.evaluate(async () => (await sb.rpc('restaurante_cobro_reservar', { p_comanda_id: 'com-1', p_items: null, p_quien: 'otro' })).data);
  verificar(doble && doble.ok === false && doble.motivo === 'en_cobro', `${tag}: candado: nadie más puede cobrar la mesa mientras se cobra`);
  await cajaSinDesborde(page, `${tag} pago`);
  if (process.env.FOTOS) await page.waitForTimeout(500), await page.screenshot({ path: process.env.FOTOS + '/rest-pago-' + tag + '.png' });
  await cobrarCon(page, 'Efectivo', 500);
  verificar(await page.isVisible('#rc-cobro .rc-ok'), `${tag}: cobrado (${await page.textContent('#rc-err').catch(() => '')})`);
  const hecho = await page.textContent('#rc-cuerpo');
  verificar(hecho.includes('Cambio') && hecho.includes('82.00'), `${tag}: cambio 500 - 418 = 82`);
  if (process.env.FOTOS) await page.waitForTimeout(500), await page.screenshot({ path: process.env.FOTOS + '/rest-hecho-' + tag + '.png' });
  verificar(hecho.includes('Propina') && hecho.includes('38.00') && hecho.includes('Aún quedan platillos'), `${tag}: propina registrada aparte y la mesa sigue abierta`);
  let d = await db(page), l = await log(page);
  const v1 = (d.ventas || [])[0];
  const reg = l.filter(x => x.op === 'rpc' && x.tabla === 'venta_registrar_atomica');
  verificar((d.ventas || []).length === 1 && Number(v1.total) === 380, `${tag}: se registró UNA venta real por 380 (en Ventas)`);
  const args = reg[0]?.datos || {};
  verificar(reg.length === 1 && (args.p_caja || []).reduce((s, c) => s + Number(c.monto), 0) === 380, `${tag}: Caja recibe la venta por el camino de Ventas (380)`);
  verificar(JSON.stringify((args.p_stock || []).map(x => [x.producto_id, x.cantidad]).sort()) === JSON.stringify([['p-carne', 1], ['p-cerveza', 2]]), `${tag}: inventario: se descuentan 1 carne y 2 cervezas`);
  const prop = (d.movimientos_financieros || []).filter(m => m.tipo_movimiento === 'OTRO_INGRESO' && /Propina/.test(m.concepto));
  verificar(prop.length === 1 && Number(prop[0].monto) === 38 && prop[0].referencia_tipo === 'restaurante_propina', `${tag}: la propina (38) entra a Caja como otro ingreso, NO como venta`);
  const pagados = d.restaurante_comanda_items.filter(i => i.comanda_id === 'com-1' && i.venta_id === v1.id);
  verificar(pagados.length === 2 && pagados.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0) === 380, `${tag}: los platillos cobrados quedan ligados a su venta`);
  verificar(d.restaurante_comandas.find(c => c.id === 'com-1').estado !== 'cerrada', `${tag}: la mesa sigue abierta con lo que falta`);

  // 2) El resto, sin propina y con tarjeta: la mesa se cierra sola y pasa a limpieza
  await page.click('#rc-resto');
  await page.waitForSelector('#rc-cobro [data-modo="todo"].activo');
  verificar((await page.textContent('#rc-cuerpo')).includes('Nacatamal') && !(await page.textContent('#rc-cuerpo')).includes('2/'), `${tag}: "Cobrar lo que falta" trae solo lo pendiente`);
  await page.click('[data-prop="0"]');
  verificar((await page.textContent('#rc-pie')).includes('430.00'), `${tag}: falta 260 + 60 + 110 = 430`);
  await page.click('#rc-seguir'); await esperarPago(page);
  await cobrarCon(page, 'Tarjeta');
  verificar((await page.textContent('#rc-cuerpo')).includes('Mesa cerrada'), `${tag}: al pagar todo, la mesa se cierra`);
  d = await db(page);
  const com = d.restaurante_comandas.find(c => c.id === 'com-1');
  verificar(com.estado === 'cerrada' && Number(com.total_cobrado) === 848 && Number(com.propina_monto) === 38 && com.metodo_pago === 'Varios', `${tag}: cuenta cerrada: 380 + 430 + propina 38 = 848, pagada con varios métodos`);
  verificar(d.restaurante_mesas.find(m => m.id === 'm1').estado === 'limpieza', `${tag}: la mesa pasa a limpieza`);
  verificar(d.ventas.length === 2 && d.ventas.reduce((s, v) => s + Number(v.total), 0) === 810, `${tag}: dos ventas que suman exactamente la cuenta (810)`);
  await page.click('#rc-listo');
  await page.waitForFunction(() => !document.getElementById('com-grid').textContent.includes('Mesa 1'));
  verificar(true, `${tag}: la mesa cobrada sale de la lista de comandas abiertas`);

  // 3) Candado en Ventas: si la reserva ya no está vigente (otro equipo la cobró o la soltó), NO se registra otra venta
  await page.locator('#com-grid .hab-card', { hasText: 'Mesa 2' }).locator('text=💰 Cobrar').click();
  await page.waitForSelector('#rc-seguir'); await page.click('#rc-seguir'); await esperarPago(page);
  await page.evaluate(() => { const x = JSON.parse(sessionStorage.getItem('__DB')); x.restaurante_cobros.filter(k => k.comanda_id === 'com-2').forEach(k => { k.estado = 'liberado'; }); sessionStorage.setItem('__DB', JSON.stringify(x)); });
  await cobrarCon(page, 'Efectivo');
  verificar(/ya se cobró o se soltó/.test(await page.textContent('#rc-err')) && (await db(page)).ventas.length === 2, `${tag}: candado de Ventas: no registra una venta si la mesa ya no está apartada para este cobro`);
  await page.click('#rc-x');
  await page.waitForFunction(() => document.getElementById('rc-cobro').style.display === 'none');
  verificar(true, `${tag}: cerrar sin cobrar no deja nada a medias`);
  // Cerrar sin cobrar suelta la reserva: se puede volver a cobrar
  await page.locator('#com-grid .hab-card', { hasText: 'Mesa 2' }).locator('text=💰 Cobrar').click();
  await page.waitForSelector('#rc-seguir'); await page.click('#rc-seguir'); await esperarPago(page);
  await page.click('#rc-x'); await page.waitForFunction(() => document.getElementById('rc-cobro').style.display === 'none');
  d = await db(page);
  verificar(d.restaurante_cobros.filter(k => k.comanda_id === 'com-2' && k.estado === 'reservado').length === 0, `${tag}: al cerrar sin cobrar, la mesa queda libre para cobrarse después`);
  verificar(page.__errores.length === 0 && !(await page.evaluate(() => window.__xss)), `${tag}: sin errores de JavaScript ni XSS (${page.__errores.join(' | ')})`);
  await ctx.close();
}

async function pruebaRondas(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Rondas y quitar con motivo en ${tag}`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(/Cuántos/.test(d.message()) ? '1' : 'El cliente cambió de idea') : d.accept());
  await page.goto(base + '/restaurante-comandas.html'); await esperarListo(page);
  await page.waitForSelector('#com-grid .hab-card');
  await page.locator('#com-grid .hab-card', { hasText: 'Mesa 3' }).locator('text=Abrir').click();
  await page.waitForSelector('#modal-comanda.modal-open');
  verificar(!(await page.isVisible('#cd-btn-enviar')), `${tag}: ya enviada y sin nada nuevo: no hay botón de enviar`);
  // Lo que se pide DESPUÉS de enviar también llega a cocina (2.ª ronda)
  await page.evaluate(() => agregarItemComanda('p-cerveza', 'Cerveza nacional', 60));
  await page.waitForFunction(() => document.getElementById('cd-btn-enviar').style.display !== 'none');
  verificar((await page.textContent('#cd-btn-enviar')).includes('2.ª ronda'), `${tag}: aparece "Enviar a cocina (2.ª ronda)"`);
  await page.click('#cd-btn-enviar');
  await page.waitForFunction(() => !document.getElementById('modal-comanda').classList.contains('modal-open'));
  let d = await db(page);
  const nueva = d.restaurante_comanda_items.find(i => i.comanda_id === 'com-3' && i.producto_id === 'p-cerveza');
  verificar(nueva.estado === 'en_preparacion' && nueva.ronda === 2 && d.restaurante_comandas.find(c => c.id === 'com-3').ronda_actual === 2, `${tag}: la 2.ª ronda queda en preparación (llega a cocina)`);
  // Quitar un platillo que ya está en cocina: pide motivo y queda registrado (no se borra)
  await page.locator('#com-grid .hab-card', { hasText: 'Mesa 3' }).locator('text=Abrir').click();
  await page.waitForSelector('#modal-comanda.modal-open');
  await page.locator('#cd-lista-items .cd-item', { hasText: 'Carne' }).locator('.cd-item-quitar').click();
  await page.waitForFunction(() => !document.getElementById('cd-lista-items').textContent.includes('Carne'));
  d = await db(page);
  const quitado = d.restaurante_comanda_items.find(i => i.id === 'i-c3');
  verificar(quitado && quitado.estado === 'cancelado' && quitado.motivo_cancelacion === 'El cliente cambió de idea', `${tag}: el platillo en cocina queda cancelado con su motivo (no se borra)`);
  await page.evaluate(() => closeModal('modal-comanda'));
  // Cocina: ve la 2.ª ronda y lo quitado tachado
  await page.goto(base + '/restaurante-cocina.html'); await esperarListo(page);
  await page.waitForSelector('#cocina-grid .hab-card');
  const cocina = await page.textContent('body');
  verificar(cocina.includes('2.ª ronda') && cocina.includes('Cerveza nacional'), `${tag}: cocina recibe la 2.ª ronda`);
  verificar(cocina.includes('No preparar') && cocina.includes('El cliente cambió de idea'), `${tag}: cocina ve tachado lo que se quitó, con el motivo`);
  await sinDesborde(page, `${tag} cocina`);
  verificar(page.__errores.length === 0, `${tag}: sin errores de JavaScript (${page.__errores.join(' | ')})`);
  await ctx.close();
}

// Cuadre: el cobro de la mesa manda a Ventas EXACTAMENTE lo mismo que una venta directa de los mismos platillos.
async function pruebaCuadre(browser, base) {
  console.log('\n▶ Cuadre: cobro de mesa vs venta directa');
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/restaurante-comandas.html'); await esperarListo(page);
  await page.waitForSelector('#com-grid .hab-card');
  await page.evaluate(() => sessionStorage.setItem('__LOG', '[]'));
  await page.locator('#com-grid .hab-card', { hasText: 'Mesa 1' }).locator('text=💰 Cobrar').click();
  await page.waitForSelector('#rc-seguir'); await page.click('[data-prop="0"]'); await page.click('#rc-seguir'); await esperarPago(page);
  await cobrarCon(page, 'Efectivo');
  const mesa = (await log(page)).find(x => x.op === 'rpc' && x.tabla === 'venta_registrar_atomica')?.datos;
  await page.goto(base + '/ventas.html'); await esperarListo(page);
  await page.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.productosCache) && S.productosCache.length === 3, null, { timeout: 15000 });
  await page.evaluate(async () => { await abrirNuevaVenta(); selectClienteOpcion('final');
    await agregarAlCarritoConPrecio('p-carne', 'producto', null); cambiarCantidad('p-carne', 2);
    await agregarAlCarritoConPrecio('p-cerveza', 'producto', null); cambiarCantidad('p-cerveza', 3);
    await agregarAlCarritoConPrecio('p-naca', 'producto', null); sessionStorage.setItem('__LOG', '[]'); });
  await page.evaluate(async () => { for (let i = 0; i < 8 && S.paso < 5; i++) { const a = S.paso; pasoSiguiente(); await new Promise(r => setTimeout(r, 150)); if (S.paso === a) break; } seleccionarMetodoPago('mp-efectivo', 'Efectivo'); await confirmarVenta(false); });
  await page.waitForTimeout(600);
  const directa = (await log(page)).find(x => x.op === 'rpc' && x.tabla === 'venta_registrar_atomica')?.datos;
  const norm = a => a && JSON.stringify({ det: (a.p_detalles || []).map(x => [x.producto_id, x.cantidad, x.precio, x.subtotal, x.costo, x.ganancia]).sort(), stock: (a.p_stock || []).map(x => [x.producto_id, x.cantidad]).sort(),
    caja: (a.p_caja || []).map(x => [x.monto, x.metodo_pago_id]), venta: ['subtotal', 'descuento', 'impuesto', 'total', 'costo_total', 'metodo_pago_id'].map(k => a.p_venta && a.p_venta[k]) });
  verificar(!!mesa && !!directa, 'cuadre: ambas ventas se registraron');
  verificar(norm(mesa) === norm(directa), `cuadre: cobrar la mesa escribe lo mismo que una venta directa (detalle, inventario, caja, totales)\n    mesa:    ${norm(mesa)}\n    directa: ${norm(directa)}`);
  await ctx.close();
}

// Mesero con permiso SOLO de Comandas (sin Ventas): puede cobrar la mesa; pero no puede abrir Ventas suelta.
async function pruebaMesero(browser, base) {
  console.log('\n▶ Mesero sin permiso de Ventas');
  const { ctx, page } = await nuevaPagina(browser, base, 360, 740);
  await page.goto(base + '/restaurante-comandas.html');
  await page.evaluate(({ UID }) => { const x = JSON.parse(JSON.stringify(window.__SEED)); x.usuarios[0].multiusuario_activo = true;
    x.perfiles_acceso = [{ id: 'perf-admin', auth_user_id: UID, nombre: 'Dueño', tipo: 'admin', activo: true, es_principal: true },
      { id: 'perf-mesero', auth_user_id: UID, nombre: 'Mesero Luis', tipo: 'restringido', activo: true, modulos: ['restaurante_comandas'] }];
    sessionStorage.setItem('__DB', JSON.stringify(x));
    sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ id: 'perf-mesero', nombre: 'Mesero Luis', tipo: 'restringido', modulos: ['restaurante_comandas'], authUserId: UID })); }, { UID });
  await page.reload(); await esperarListo(page); await page.waitForSelector('#com-grid .hab-card');
  await page.locator('#com-grid .hab-card', { hasText: 'Mesa 2' }).locator('text=💰 Cobrar').click();
  await page.waitForSelector('#rc-seguir'); await page.click('[data-prop="0"]'); await page.click('#rc-seguir'); await esperarPago(page);
  await cobrarCon(page, 'Efectivo');
  verificar(await page.isVisible('#rc-cobro .rc-ok'), 'mesero: cobra la mesa aunque no tenga permiso de Ventas');
  const d = await db(page);
  verificar(d.ventas.length === 1 && Number(d.ventas[0].total) === 220 && (d.restaurante_cobros || []).some(k => k.creado_por === 'Mesero Luis'), 'mesero: la venta queda registrada (220) y el cobro dice quién lo hizo');
  await page.goto(base + '/ventas.html');
  await page.waitForURL(u => !/\/ventas\.html/.test(String(u)), { timeout: 15000 }).catch(() => {});
  verificar(!/\/ventas\.html/.test(page.url()), `mesero: no puede abrir Ventas por su cuenta (${page.url().split('/').pop()})`);
  await ctx.close();
}

// El módulo apagado: Ventas ignora por completo un cobro de restaurante que quedó guardado.
async function pruebaApagado(browser, base) {
  console.log('\n▶ Restaurante apagado');
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/ventas.html');
  await page.evaluate(() => { const x = JSON.parse(JSON.stringify(window.__SEED)); x.configuracion_empresa[0].usa_modulo_restaurante = false;
    x.restaurante_cobros = [{ id: 'k1', comanda_id: 'com-1', estado: 'reservado', items: [] }];
    sessionStorage.setItem('__DB', JSON.stringify(x)); sessionStorage.setItem('n360_rest_cobro', JSON.stringify({ cobroId: 'k1', lineas: [{ producto_id: 'p-carne', cantidad: 1, precio: 260 }] })); });
  await page.reload(); await esperarListo(page); await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ carrito: S.carrito.length, rc: S._restCobro || null, guardado: sessionStorage.getItem('n360_rest_cobro') }));
  verificar(r.carrito === 0 && !r.rc && r.guardado !== null, 'con Restaurante apagado, Ventas no carga ni toca cobros de mesas');
  await ctx.close();
}

(async () => {
  const srv = servidor(); const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    await pruebaCobro(browser, base, 1280, 900);
    await pruebaCobro(browser, base, 360, 740);
    await pruebaRondas(browser, base, 1280, 900);
    await pruebaRondas(browser, base, 360, 740);
    await pruebaCuadre(browser, base);
    await pruebaApagado(browser, base);
    await pruebaMesero(browser, base);
  } catch (e) { fallas.push('EXCEPCIÓN: ' + (e.stack || e)); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${oks.length} verificaciones correctas, ${fallas.length} fallas`);
  if (fallas.length) { fallas.forEach(f => console.log(' -', f)); process.exitCode = 1; }
})();
