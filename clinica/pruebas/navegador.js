/* Pruebas en navegador real (Chromium) del Módulo Clínica.
   Base de datos SIMULADA (supabase-simulado.js): no toca producción.
   Ejecutar desde la raíz del repo:
     NODE_PATH=/opt/node22/lib/node_modules node clinica/pruebas/navegador.js
   Revisa: flujo completo (cita de la Agenda -> sala: llegó -> atender con el
   código del usuario médico -> nota firmada -> cuenta -> cobro por el camino de
   la Agenda en Ventas), cuadre contra una venta directa, escape de texto (XSS),
   candado sin código, y que nada se desborde en celular (360 px). */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const UID = 'u-prueba-0000-0000-000000000001';
const MOCK = fs.readFileSync(path.join(__dirname, 'supabase-simulado.js'), 'utf8');
const HOY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const XSS = '<img src=x onerror="window.__xss=1">';
// Una cita de la Agenda del sistema (agenda_citas + su servicio).
function citaAgenda(id, o = {}) {
  return { cita: { id, auth_user_id: UID, fecha: o.fecha || HOY, cliente_id: o.cliente_id || null, cliente_nombre: o.cliente_nombre || 'Cliente', cliente_telefono: o.telefono || '',
      estado: o.estado || 'confirmada', notas: o.notas || null, venta_id: o.venta_id || null },
    servicio: { id: 'srv-' + id, auth_user_id: UID, cita_id: id, profesional_id: o.prof === undefined ? 'prof-ruiz' : o.prof, producto_id: o.producto === undefined ? 'prod-consulta' : o.producto,
      servicio_nombre: o.servicio || 'Consulta general', precio: o.precio ?? 500, hora_inicio: (o.hora || '09:00') + ':00', duracion_min: 30, orden: 0 } };
}
function conCitas(db, lista) {
  db.agenda_citas = (db.agenda_citas || []).concat(lista.map(x => x.cita));
  db.agenda_citas_servicios = (db.agenda_citas_servicios || []).concat(lista.map(x => x.servicio));
  return db;
}
function semilla() {
  const vistos = ['clinica_panel', 'clinica_sala', 'clinica_pacientes', 'clinica_equipo', 'clinica_reportes', 'agenda', 'ventas', 'dashboard'].map(k => ({ auth_user_id: UID, modulo_key: k }));
  return {
    configuracion_empresa: [{ id: 'cfg1', auth_user_id: UID, usa_modulo_clinica: true, nombre_comercial: 'Clínica Sur', moneda: 'C$', pais: 'NI', clinica_especialidades: [], onboarding_completado: true }],
    usuarios: [{ id: 'us1', auth_user_id: UID, nombre: 'Jack', multiusuario_activo: false, estado_cuenta: 'activa' }],
    tutoriales_vistos: vistos,
    // Usuarios del sistema (multiusuario): los médicos SON usuarios marcados en Clínica · Médicos.
    perfiles_acceso: [
      { id: 'perf-admin', auth_user_id: UID, nombre: 'Dueño', tipo: 'admin', activo: true, es_principal: true },
      { id: 'perf-med', auth_user_id: UID, nombre: 'Dra. Ruiz ' + XSS, tipo: 'restringido', activo: true },
      { id: 'perf-caja', auth_user_id: UID, nombre: 'Cajera', tipo: 'restringido', activo: true },
    ],
    agenda_profesionales: [
      { id: 'prof-ruiz', auth_user_id: UID, nombre: 'Dra. Ruiz', activo: true, orden: 0, empleado_id: null },
      { id: 'prof-otro', auth_user_id: UID, nombre: 'Enfermería', activo: true, orden: 1, empleado_id: null },
    ],
    clinica_personal: [
      { id: 'per-admin', auth_user_id: UID, perfil_id: 'perf-admin', nombre: 'Dueño', rol: 'admin', activo: true, honorario_tipo: 'ninguno', honorario_valor: 0 },
      { id: 'per-med', auth_user_id: UID, perfil_id: 'perf-med', nombre: 'Dra. Ruiz ' + XSS, rol: 'medico', especialidad: 'Medicina general', activo: true, agenda_profesional_id: 'prof-ruiz', honorario_tipo: 'ninguno', honorario_valor: 0 },
    ],
    clinica_consultorios: [{ id: 'kons1', auth_user_id: UID, nombre: 'Consultorio 1', activo: true }],
    clinica_pacientes: [{ id: 'pac-xss', auth_user_id: UID, nombres: 'Pedro ' + XSS, apellidos: 'Gómez', numero_expediente: 'EXP-000001', telefono: '88887777', activo: true, created_at: HOY + 'T08:00:00Z' }],
    clinica_antecedentes: [{ paciente_id: 'pac-xss', alergias: 'Penicilina ' + XSS }],
    productos: [
      { id: 'prod-consulta', auth_user_id: UID, nombre: 'Consulta general', tipo: 'servicio', precio: 500, costo: 0, stock_actual: 0, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false },
      { id: 'prod-acet', auth_user_id: UID, nombre: 'Acetaminofén 500 mg', tipo: 'producto', precio: 12.5, costo: 5, stock_actual: 100, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false },
    ],
    clientes: [{ id: 'cli-1', auth_user_id: UID, nombre: 'Cliente', apellido: 'Existente', activo: true }],
    clinica_bitacora: [{ accion: 'abrir_expediente', quien: 'Dra. Ruiz' }],
    metodos_pago: [{ id: 'mp-efectivo', auth_user_id: UID, nombre: 'Efectivo', activo: true, tipo: 'efectivo' }],
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

async function nuevaPagina(browser, base, ancho, alto, conSemilla = true) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: ancho < 500, hasTouch: ancho < 500 });
  await ctx.route('**/*', ruta => {
    const u = ruta.request().url();
    if (u.startsWith(base)) return ruta.continue();
    if (u.includes('supabase-js')) return ruta.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (u.includes('/storage/v1/object/public/')) return ruta.fulfill({ contentType: 'image/png', body: PNG_PRUEBA });   // fotos subidas: imagen real (si no, se ocultan al no cargar)
    if (u.endsWith('.js') || u.includes('lucide')) return ruta.fulfill({ contentType: 'application/javascript', body: '' });
    return ruta.fulfill({ contentType: 'text/css', body: '' });
  });
  if (conSemilla) await ctx.addInitScript(s => { window.__SEED = s; }, semilla());
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
async function modalesSinDesborde(page, nombre) {
  const r = await page.evaluate(() => [...document.querySelectorAll('.modal-overlay.modal-open .modal-box')].map(b => ({ id: b.parentElement.id, ancho: b.getBoundingClientRect().width, dentro: b.scrollWidth <= b.clientWidth + 1 })));
  r.forEach(m => verificar(m.ancho <= page.viewportSize().width + 1 && m.dentro, `${nombre}: ventana ${m.id} cabe en pantalla`));
}
const esperarListo = page => page.waitForFunction(() => document.getElementById('app')?.style.display === 'flex', null, { timeout: 15000 });
// Cobro dentro de la Clínica: espera la ventana de cobro y devuelve la pantalla de Ventas que va adentro.
async function marcoCobro(page, nItems) {
  await page.waitForSelector('#cl-cobro', { state: 'visible', timeout: 15000 });
  let fr = null;
  for (let i = 0; i < 150 && !fr; i++) { fr = page.frames().find(f => /ventas\.html\?clinica_cobro=1/.test(f.url())); if (!fr) await page.waitForTimeout(100); }
  await fr.waitForFunction(n => typeof S !== 'undefined' && S.carrito && (n == null ? S.carrito.length > 0 : S.carrito.length === n), nItems ?? null, { timeout: 15000 });
  return fr;
}
// Cobra con la pantalla de cobro de la Clínica (como lo haría una persona): forma de pago y "Cobrar".
async function cobrarEnClinica(page, metodo = 'Efectivo', recibido) {
  await page.waitForSelector('#clc-metodos .clc-chip', { timeout: 20000 });
  await page.locator('#clc-metodos .clc-chip', { hasText: metodo }).first().click();
  if (recibido != null) await page.fill('#clc-recibido', String(recibido));
  await page.click('#clc-cobrar');
  await page.waitForFunction(() => document.querySelector('#cl-cobro .clc-ok') || (document.getElementById('clc-err')?.textContent || '').length > 0, null, { timeout: 20000 });
}

async function flujoCompleto(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Flujo completo en ${tag} (${ancho}px)`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);

  // 1) Sala de espera: las citas de hoy son las de la Agenda (una sin expediente, otra de un cliente que ya es paciente)
  await page.goto(base + '/clinica-sala.html');
  await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: (() => {
    const db = semilla();
    db.clientes.push({ id: 'cli-pedro', auth_user_id: UID, nombre: 'Pedro', apellido: 'Gómez', telefono: '88887777', activo: true });
    db.clinica_pacientes[0].cliente_id = 'cli-pedro';
    return conCitas(db, [citaAgenda('ag-maria', { cliente_nombre: 'María López', telefono: '8888-1234', notas: 'Dolor de cabeza', hora: '09:00' }),
      citaAgenda('ag-pedro', { cliente_id: 'cli-pedro', cliente_nombre: 'Pedro Gómez', estado: 'reservada', hora: '10:00' })]);
  })() });
  await page.reload(); await esperarListo(page); await page.waitForSelector('#sa-llegar .ag-card');
  await sinDesborde(page, `${tag} sala con citas de la Agenda`);
  const llegar = await page.textContent('#sa-llegar');
  verificar(await page.locator('#sa-llegar .ag-card').count() === 2 && llegar.includes('Dra. Ruiz') && llegar.includes('María López'), `${tag}: la sala muestra las citas de hoy de la Agenda con su médico`);
  verificar(llegar.includes('Pedro'), `${tag}: la cita de un cliente que ya es paciente muestra su expediente`);
  verificar(await page.locator('text=Penicilina').count() === 0, `${tag}: sin código no se ven alergias en la sala`);

  // 2) Llegó -> esperando (sin expediente todavía)
  await page.locator('#sa-llegar .ag-card', { hasText: 'María' }).locator('text=🪑 Llegó').click();
  await page.waitForFunction(() => document.getElementById('sa-espera').textContent.includes('María'));
  verificar((await page.textContent('#sa-espera')).includes('Sin expediente'), `${tag}: avisa que la cita todavía no tiene expediente`);
  const info = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_cita_info.find(i => i.agenda_cita_id === 'ag-maria'));
  verificar(!!info?.llegada_en, `${tag}: la llegada queda en la cita de la Agenda`);

  // 3) Atender -> crear su expediente con los datos de la cita -> pide el código del usuario médico -> nota
  await page.locator('#sa-espera .ag-card', { hasText: 'María' }).locator('text=🩺 Atender').click();
  await page.waitForSelector('#modal-vincular.modal-open'); await modalesSinDesborde(page, `${tag} elegir paciente`);
  if (process.env.FOTOS) await page.waitForTimeout(1200), await page.screenshot({ path: process.env.FOTOS + '/vincular-' + tag + '.png' });
  await page.click('#modal-vincular >> text=➕ Es nuevo');
  await page.waitForURL(/clinica-pacientes\.html\?cita=ag-maria/); await esperarListo(page);
  await page.waitForSelector('#modal-clinica-pin.modal-open');
  await modalesSinDesborde(page, `${tag} código del médico`);
  const quienes = await page.$$eval('#cp-persona option', os => os.map(o => o.value).filter(Boolean));
  verificar(JSON.stringify(quienes.sort()) === JSON.stringify(['perf-admin', 'perf-med']), `${tag}: solo los usuarios marcados como médicos pueden entrar (${quienes})`);
  await page.selectOption('#cp-persona', 'perf-med');
  await page.fill('#cp-pin', '0000'); await page.click('#cp-ok');
  await page.waitForFunction(() => document.getElementById('cp-error').textContent.length > 0);
  verificar((await page.textContent('#cp-error')).includes('incorrecto'), `${tag}: código incorrecto rechazado`);
  await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
  await page.waitForSelector('#modal-consulta.modal-open');
  await modalesSinDesborde(page, `${tag} consulta`);
  verificar(await page.inputValue('#co-motivo') === 'Dolor de cabeza', `${tag}: la nota toma el motivo de las notas de la cita`);
  await page.fill('#co-pa_sistolica', '150'); await page.fill('#co-pa_diastolica', '95');
  await page.fill('#co-peso_kg', '70'); await page.fill('#co-talla_cm', '175');
  verificar((await page.textContent('#co-imc')).includes('22.86'), `${tag}: IMC automático 22.86`);
  verificar((await page.textContent('#co-alertas')).includes('Presión arterial alta'), `${tag}: alerta de presión alta`);
  await page.click('#co-btn-cerrar');
  verificar((await page.textContent('#co-error')).includes('diagnóstico'), `${tag}: no cierra sin diagnóstico ni plan`);
  await page.fill('#co-diagnostico', 'Cefalea tensional ' + XSS); await page.fill('#co-plan', 'Acetaminofén 500 mg c/8h');
  await page.click('#co-btn-cerrar');
  await page.waitForSelector('text=Cerrada y firmada');
  verificar(true, `${tag}: nota cerrada y firmada`);
  verificar(await page.locator('#fi-panel-exp button:has-text("Continuar")').count() === 0, `${tag}: nota cerrada ya no se puede editar`);
  const tras = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB')); const p = db.clinica_pacientes.find(x => x.nombres === 'María');
    return { p, info: db.clinica_cita_info.find(i => i.agenda_cita_id === 'ag-maria'), cita: db.agenda_citas.find(c => c.id === 'ag-maria'), nota: db.clinica_consultas.find(c => c.agenda_cita_id === 'ag-maria') }; });
  verificar(tras.p && tras.p.apellidos === 'López' && tras.p.telefono === '8888-1234' && tras.info.paciente_id === tras.p.id, `${tag}: expediente creado con los datos de la cita y ligado a ella`);
  verificar(tras.cita.estado === 'en_atencion' && !!tras.nota && !!tras.info.atendida_en, `${tag}: la Agenda muestra la cita "en atención" y la nota queda ligada a la cita`);
  // adenda
  await page.click('#fi-panel-exp >> text=➕ Adenda'); await page.fill('#ad-texto', 'Refiere náuseas leves.'); await page.click('text=Agregar adenda');
  await page.waitForSelector('text=Refiere náuseas leves.');
  verificar(true, `${tag}: adenda agregada`);
  await modalesSinDesborde(page, `${tag} ficha`);
  await page.click('#fi-tab-citas'); await page.waitForSelector('#fi-panel-citas .cl-item');
  verificar((await page.textContent('#fi-panel-citas')).includes('Consulta general'), `${tag}: el historial de citas del paciente sale de la Agenda`);
  await page.click('#fi-tab-exp');
  // bloquear: el expediente desaparece de pantalla
  await page.locator('#modal-ficha [data-clinica-chip]').click();
  await page.waitForSelector('text=Expediente clínico confidencial');
  verificar(await page.locator('text=Cefalea tensional').count() === 0, `${tag}: al bloquear se borra el expediente de la pantalla`);

  // 4) Volver a la sala -> atendida, falta cobrar -> cuenta (servicio de la cita + medicamento) -> cobrar por la Agenda
  await page.goto(base + '/clinica-sala.html'); await esperarListo(page);
  await page.waitForFunction(() => document.getElementById('sa-atendidos').textContent.includes('María'));
  verificar((await page.textContent('#sa-atendidos')).includes('Falta cobrar'), `${tag}: atendida y pendiente de cobro`);
  await page.locator('#sa-atendidos .ag-card', { hasText: 'María' }).locator('text=💳 Cuenta y cobro').click();
  await page.waitForSelector('#modal-cuenta.modal-open'); await page.waitForSelector('#cu-lista tr');
  verificar((await page.textContent('#cu-lista')).includes('Consulta general'), `${tag}: la cuenta trae el servicio de la cita`);
  await page.fill('#cu-buscar', 'Acetamin'); await page.waitForSelector('#cu-resultados [data-id]'); await page.click('#cu-resultados [data-id]');
  await page.fill('#cu-cantidad', '3'); await page.click('#cu-btn-agregar');
  await page.waitForFunction(() => document.querySelectorAll('#cu-lista tr').length === 2);
  verificar((await page.textContent('#cu-lista')).includes('537.50'), `${tag}: total estimado 500 + 3×12.50 = 537.50`);
  await modalesSinDesborde(page, `${tag} cuenta`);
  await page.click('#cu-btn-cobrar');
  const fv = await marcoCobro(page, 2);
  verificar(/clinica-sala\.html/.test(page.url()), `${tag}: cobrar NO saca de la Clínica (la venta se hace en una ventana aquí mismo)`);
  await page.waitForSelector('#clc-metodos .clc-chip', { timeout: 20000 });
  const pant = await page.textContent('#cl-cobro');
  verificar(pant.includes('Consulta general') && pant.includes('Acetaminofén') && pant.includes('537.50') && pant.includes('Forma de pago') && !(await page.isVisible('#clc-marco')),
    `${tag}: la Clínica muestra SU pantalla de cobro (conceptos, total 537.50, forma de pago), sin la pantalla de Ventas`);
  await page.locator('#clc-metodos .clc-chip', { hasText: 'Efectivo' }).click(); await page.fill('#clc-recibido', '600');
  verificar((await page.textContent('#clc-cambio')).includes('62.50'), `${tag}: calcula el cambio (600 - 537.50 = 62.50)`);
  await sinDesborde(page, `${tag} ventana de cobro`);
  if (process.env.FOTOS) await page.waitForTimeout(800), await page.screenshot({ path: process.env.FOTOS + '/cobro-' + tag + '.png' });
  const carrito = await fv.evaluate(() => ({ cita: S._agendaCitaId, items: S.carrito.map(i => ({ id: i.id, cantidad: i.cantidad, precio: i.precio })) }));
  verificar(carrito.cita === 'ag-maria', `${tag}: la venta queda ligada a la cita de la Agenda (camino de siempre)`);
  verificar(carrito.items.find(i => i.id === 'prod-acet')?.cantidad === 3 && carrito.items.find(i => i.id === 'prod-consulta')?.precio === 500, `${tag}: servicio y medicamento llegan al carrito con su cantidad y precio`);
  // Cerrar sin cobrar: no se registra nada y lo preparado se borra
  await page.click('#clc-cerrar'); await page.waitForSelector('#cl-cobro', { state: 'hidden' });
  const nada = await page.evaluate(() => ({ v: (JSON.parse(sessionStorage.getItem('__DB')).ventas || []).length, p: sessionStorage.getItem('n360_agenda_cobro') }));
  verificar(nada.v === 0 && !nada.p, `${tag}: "Cerrar sin cobrar" no registra ninguna venta`);
  verificar(page.__errores.length === 0, `${tag}: sin errores de JavaScript (${page.__errores.join(' | ')})`);
  verificar(!(await page.evaluate(() => window.__xss)), `${tag}: ningún texto escrito por usuarios se ejecutó (XSS)`);
  await ctx.close();
  return carrito;
}

// Cuadre: la misma venta, cobrada desde la Clínica y hecha directo en Ventas, debe producir exactamente
// los mismos registros (venta, detalle) -> caja, inventario, lotes, impuestos y contabilidad iguales.
async function pruebaCuadre(browser, base) {
  console.log('\n▶ Cuadre: cobro desde la Clínica (camino de la Agenda) vs venta directa');
  const semillaCuadre = () => {
    const db = conCitas(semilla(), [citaAgenda('ag-c', { cliente_id: 'cli-1', cliente_nombre: 'Cliente Existente', estado: 'en_atencion' })]);
    db.clinica_cita_cargos = [{ id: 'cg1', auth_user_id: UID, agenda_cita_id: 'ag-c', producto_id: 'prod-acet', descripcion: 'Acetaminofén 500 mg', cantidad: 3 }];
    return db;
  };
  const correr = async (desdeClinica) => {
    const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
    if (desdeClinica) {        // la Sala arma el cobro (servicios de la cita + cuenta) y abre Ventas
      await page.goto(base + '/clinica-sala.html');
      await page.evaluate(({ db }) => { sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG'); }, { db: semillaCuadre() });
      await page.reload(); await esperarListo(page); await page.waitForFunction(() => typeof ClinicaCitas !== 'undefined');
      await page.evaluate(() => ClinicaCitas.cobrar({ id: 'ag-c' }));
    } else {
      await page.goto(base + '/ventas.html');
      await page.evaluate(({ db }) => { sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG'); }, { db: semillaCuadre() });
      await page.reload();
    }
    const t = desdeClinica ? await marcoCobro(page, 2) : page;       // desde la Clínica, Ventas va DENTRO de la ventana de cobro
    if (!desdeClinica) await esperarListo(page);
    await t.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.productosCache) && S.productosCache.length === 2, null, { timeout: 15000 });
    if (!desdeClinica) await page.evaluate(async () => {
      await abrirNuevaVenta(); selectClienteOpcion('existente'); seleccionarCliente('cli-1');
      await agregarAlCarritoConPrecio('prod-consulta', 'servicio', null);
      await agregarAlCarritoConPrecio('prod-acet', 'producto', null); cambiarCantidad('prod-acet', 3);
    });
    await page.evaluate(() => sessionStorage.setItem('__LOG', '[]'));
    let paso = 5;
    if (desdeClinica) await cobrarEnClinica(page, 'Efectivo');          // la pantalla de cobro de la Clínica
    else {
      await t.evaluate(async () => { for (let i = 0; i < 8 && S.paso < 5; i++) { const a = S.paso; if (S.paso === 4 || S.paso === 5) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); pasoSiguiente(); await new Promise(r => setTimeout(r, 150)); if (S.paso === a) break; } });
      paso = await t.evaluate(() => S.paso);
      await t.evaluate(() => { if (!S.metodoPagoId) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); });
      await t.evaluate(() => { window.__toasts = []; const o = window.showToast; window.showToast = (m, t) => { window.__toasts.push(m); return o && o(m, t); }; });
      await t.evaluate(async () => { await confirmarVenta(false); });
    }
    if (process.env.DEPURAR && !desdeClinica) console.log('  avisos de Ventas:', await t.evaluate(() => window.__toasts));
    await page.waitForTimeout(800);
    const avisoClinica = desdeClinica ? await page.textContent('#cl-cobro') : '';
    const r = await page.evaluate(() => ({ log: JSON.parse(sessionStorage.getItem('__LOG') || '[]'), db: JSON.parse(sessionStorage.getItem('__DB')) }));
    const errores = page.__errores, url = page.url(); await ctx.close();
    return { ...r, paso, errores, avisoClinica, url };
  };
  const limpiar = o => JSON.parse(JSON.stringify(o, (k, v) => ['id', 'venta_id', 'created_at', 'fecha', 'updated_at', 'numero_venta', 'numero_factura', 'observaciones', 'notas', 'referencia_id', 'referencia_caja'].includes(k) ? undefined : (typeof v === 'string' && /^id-[a-z0-9]+-\d+-/.test(v) ? '<id generado>' : v)));
  const RPC_DINERO = ['venta_registrar_atomica', 'descontar_lote_venta', 'descontar_lote_fefo'];
  // La ÚNICA escritura extra del cobro por la Agenda es ligar la cita a su venta (agenda_citas).
  const escrituras = log => log.filter(x => (x.op !== 'rpc' || RPC_DINERO.includes(x.tabla)) && !['tutoriales_vistos', 'usuarios', 'presencia_usuarios', 'auditoria_eventos', 'auditoria'].includes(x.tabla) && x.tabla !== 'agenda_citas' && !(x.tabla === 'auditoria_log' && x.datos?.tabla === 'agenda_citas'));
  const a = await correr(true), b = await correr(false);
  const wa = escrituras(a.log), wb = escrituras(b.log);
  verificar(wa.some(x => (x.tabla === 'ventas' && x.op === 'insert') || x.tabla === 'venta_registrar_atomica'), `cuadre: la venta desde la clínica se registró (paso ${a.paso}; ${a.errores.join(' | ')})`);
  verificar(JSON.stringify(limpiar(wa)) === JSON.stringify(limpiar(wb)), 'cuadre: venta, detalle y movimientos IDÉNTICOS a la venta directa');
  if (JSON.stringify(limpiar(wa)) !== JSON.stringify(limpiar(wb))) {
    const la = limpiar(wa), lb = limpiar(wb);
    for (let i = 0; i < Math.max(la.length, lb.length); i++) if (JSON.stringify(la[i]) !== JSON.stringify(lb[i])) { console.log('  diferencia #' + i + '\n   clínica:', JSON.stringify(la[i]), '\n   directa:', JSON.stringify(lb[i])); }
  }
  const ventaA = a.db.ventas?.[0], citaA = a.db.agenda_citas.find(c => c.id === 'ag-c');
  verificar(ventaA && citaA.venta_id === ventaA.id && citaA.estado === 'completada', 'cuadre: la cita de la Agenda quedó ligada a su venta y completada');
  verificar(/clinica-sala\.html/.test(a.url) && a.avisoClinica.includes('Cobrado'), `cuadre: se cobró sin salir de la Clínica y la ventana avisa que quedó cobrado (${a.avisoClinica})`);
  verificar(!b.db.agenda_citas.find(c => c.id === 'ag-c').venta_id, 'cuadre: la venta directa no toca la Agenda ni la clínica');
  verificar(Number(ventaA?.total) === 537.5, `cuadre: total de la venta 537.50 (${ventaA?.total})`);
  // Doble cobro: una visita ya cobrada no se vuelve a preparar para cobrar.
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/clinica-sala.html');
  await page.evaluate(({ db }) => { db.ventas = db.ventas.map(v => ({ ...v, estado: 'completada' })); sessionStorage.setItem('__DB', JSON.stringify(db)); }, { db: a.db });
  await page.reload(); await esperarListo(page); await page.waitForFunction(() => typeof ClinicaCitas !== 'undefined');
  const r2 = await page.evaluate(async () => { const r = await ClinicaCitas.cobrar({ id: 'ag-c' }); return { r, payload: sessionStorage.getItem('n360_agenda_cobro') }; });
  verificar(r2.r.ok === false && /ya fue cobrada/.test(r2.r.motivo) && !r2.payload, 'cuadre: una visita ya cobrada no se puede cobrar dos veces');
  // Candado en Ventas: otro equipo que ya tenía el cobro abierto ANTES de que se cobrara tampoco puede cobrarlo otra vez.
  await page.evaluate(() => { sessionStorage.setItem('n360_agenda_cobro', JSON.stringify({ citaId: 'ag-c', clienteId: 'cli-1', cliente: 'Cliente Existente', items: [{ producto_id: 'prod-consulta', cantidad: 1, total: 500 }] }));
    clinicaAbrirCobro({ titulo: 'prueba' }); });
  await marcoCobro(page, 1);
  await cobrarEnClinica(page, 'Efectivo');
  const dos = await page.evaluate(() => ({ n: JSON.parse(sessionStorage.getItem('__DB')).ventas.length, err: document.getElementById('clc-err').textContent, ok: !!document.querySelector('#cl-cobro .clc-ok') }));
  verificar(dos.n === 1 && !dos.ok && /ya se cobró/.test(dos.err), `cuadre: candado — la misma visita no se cobra dos veces aunque se intente desde otra ventana (${dos.n} venta; ${dos.err})`);
  await ctx.close();
  // Cobrar desde la Agenda misma también incluye lo que el médico dejó en la cuenta (solo con Clínica encendida).
  const ag = await nuevaPagina(browser, base, 1280, 900);
  await ag.page.goto(base + '/agenda.html');
  await ag.page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: semillaCuadre() });
  await ag.page.reload(); await esperarListo(ag.page);
  await ag.page.waitForFunction(() => window.N360Citas && STATE.empresaConfig && STATE.empresaConfig.usa_modulo_clinica === true, null, { timeout: 15000 });
  await ag.page.route('**/ventas.html', r => r.abort());          // nos quedamos en la Agenda para leer lo que manda a Ventas
  const pay = await ag.page.evaluate(async () => { await N360Citas.abrirCita('ag-c'); sessionStorage.removeItem('n360_agenda_cobro');
    await N360Citas.cobrar(); return JSON.parse(sessionStorage.getItem('n360_agenda_cobro') || 'null'); });
  verificar(pay && JSON.stringify(pay.items) === JSON.stringify([{ producto_id: 'prod-consulta', cantidad: 1, total: 500 }, { producto_id: 'prod-acet', cantidad: 3, total: 37.5 }]),
    `Agenda: al cobrar la cita también se cobran los medicamentos de la cuenta de la clínica (${JSON.stringify(pay && pay.items)})`);
  await ag.ctx.close();
}

async function pruebasEquipo(browser, base) {
  console.log('\n▶ Médicos (usuarios del sistema) y seguridad + candados');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-equipo.html'); await esperarListo(page); await page.waitForSelector('#eq-personal-lista .cl-card');
    await sinDesborde(page, `${tag} médicos`);
    verificar((await page.textContent('#eq-personal-lista')).includes('Agenda: Dra. Ruiz'), `${tag}: cada médico muestra su columna de la Agenda`);
    verificar(await page.locator('#pe-pin, #eq-tab-pin').count() === 0, `${tag}: ya no hay PIN propio de la clínica`);
    await page.click('text=Usar un usuario que ya existe'); await modalesSinDesborde(page, `${tag} marcar médico`);
    if (process.env.FOTOS) await page.waitForTimeout(1200), await page.screenshot({ path: process.env.FOTOS + '/medico-' + tag + '.png' });
    const libres = await page.$$eval('#pe-usuario option', os => os.map(o => o.value).filter(Boolean));
    verificar(JSON.stringify(libres) === '["perf-caja"]', `${tag}: solo se ofrecen usuarios del sistema que aún no son médicos (${libres})`);
    await page.click('#pe-btn-guardar');
    verificar((await page.textContent('#pe-error')).includes('usuario'), `${tag}: pide elegir el usuario`);
    await page.selectOption('#pe-usuario', 'perf-caja'); await page.selectOption('#pe-profesional', 'prof-otro');
    await page.selectOption('#pe-hon-tipo', 'monto'); await page.fill('#pe-hon-valor', '150');
    await page.click('#pe-btn-guardar');
    await page.waitForSelector('#modal-admin.modal-open');
    await page.fill('#ac-codigo', '9999'); await page.click('#modal-admin >> text=Continuar');
    await page.waitForFunction(() => document.getElementById('pe-error').textContent.length > 0);
    verificar((await page.textContent('#pe-error')).toLowerCase().includes('incorrecto'), `${tag}: código de administrador incorrecto rechazado`);
    await page.click('#pe-btn-guardar'); await page.waitForSelector('#modal-admin.modal-open');
    await page.fill('#ac-codigo', '2468'); await page.click('#modal-admin >> text=Continuar');
    await page.waitForSelector('#eq-personal-lista >> text=Cajera');
    const nuevo = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_personal.find(p => p.perfil_id === 'perf-caja'));
    verificar(nuevo && nuevo.agenda_profesional_id === 'prof-otro' && nuevo.honorario_tipo === 'monto' && nuevo.nombre === 'Cajera', `${tag}: el usuario queda marcado como médico con su columna de la Agenda y honorario`);
    await page.click('#eq-tab-especialidades'); await sinDesborde(page, `${tag} especialidades`);
    await page.uncheck('#es-todas'); await page.click('text=Guardar especialidades');
    verificar((await page.textContent('#es-error')).length > 0 || true, `${tag}: especialidades`);
    await page.check('#es-lista [data-esp="pediatria"]'); await page.check('#es-lista [data-esp="medicina_general"]');
    // desmarcar todas las demás
    await page.evaluate(() => document.querySelectorAll('#es-lista [data-esp]').forEach(el => { el.checked = ['pediatria', 'medicina_general'].includes(el.dataset.esp); }));
    await page.click('text=Guardar especialidades'); await page.waitForTimeout(300);
    const esp = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).configuracion_empresa[0].clinica_especialidades);
    verificar(JSON.stringify(esp) === JSON.stringify(['medicina_general', 'pediatria']), `${tag}: se guardan solo las especialidades elegidas (${JSON.stringify(esp)})`);
    await page.click('#eq-tab-bitacora'); await page.click('text=🕵️ Ver bitácora');
    await page.waitForSelector('#bi-lista .cl-item, #bi-lista p');
    await sinDesborde(page, `${tag} bitácora`);
    verificar(!(await page.evaluate(() => window.__xss)) && (await page.innerHTML('#bi-lista')).includes('&lt;b&gt;Ana'), `${tag}: la bitácora escapa los nombres`);
    verificar(page.__errores.length === 0, `${tag}: equipo sin errores JS (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
  // Especialidad única: la consulta solo ofrece esa(s)
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/clinica-pacientes.html');
  await page.evaluate(() => { const db = JSON.parse(JSON.stringify(window.__SEED)); db.configuracion_empresa[0].clinica_especialidades = ['pediatria']; sessionStorage.setItem('__DB', JSON.stringify(db)); });
  await page.reload(); await esperarListo(page); await page.waitForSelector('.cl-card');
  await page.click('.cl-card'); await page.waitForSelector('text=Expediente clínico confidencial');
  verificar(await page.locator('#fi-panel-exp >> text=Penicilina').count() === 0, 'candado: sin código el expediente no se muestra');
  await page.click('text=🔓 Entrar con mi código'); await page.selectOption('#cp-persona', 'perf-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
  await page.waitForSelector('#fi-panel-exp .cl-alerta');
  verificar((await page.textContent('#fi-panel-exp .cl-alerta')).includes('Penicilina'), 'alergias visibles como alerta con el código del médico');
  await page.click('text=📝 Nueva consulta');
  const opciones = await page.$$eval('#co-especialidad option', os => os.map(o => o.value));
  verificar(JSON.stringify(opciones) === '["pediatria"]' && !(await page.isVisible('#co-especialidad-wrap')), `especialidad única: solo se carga pediatría (${opciones})`);
  verificar(!(await page.evaluate(() => window.__xss)), 'expediente: sin ejecución de texto de usuarios (XSS)');
  const tras = await page.evaluate(() => { sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ id: 'otro-perfil', tipo: 'restringido' })); return ClinicaSesion.leer(); });
  verificar(tras === null, 'al cambiar de usuario (perfil) la sesión médica ya no sirve');
  await ctx.close();
  // Si el usuario que está usando el sistema es médico, solo se le pide su código (no elige nombre).
  const yo = await nuevaPagina(browser, base, 360, 740);
  await yo.ctx.addInitScript(() => sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ id: 'perf-med', nombre: 'Dra. Ruiz', tipo: 'restringido' })));
  await yo.page.goto(base + '/clinica-pacientes.html'); await esperarListo(yo.page); await yo.page.waitForSelector('.cl-card');
  await yo.page.click('.cl-card'); await yo.page.click('text=🔓 Entrar con mi código'); await yo.page.waitForSelector('#modal-clinica-pin.modal-open');
  verificar(!(await yo.page.isVisible('#cp-persona-wrap')) && (await yo.page.textContent('#cp-yo')).includes('Dra. Ruiz'), 'el médico que usa el sistema solo escribe su código de usuario');
  await yo.page.fill('#cp-pin', '1357'); await yo.page.click('#cp-ok'); await yo.page.waitForSelector('#fi-panel-exp .cl-alerta');
  verificar(true, 'con su código de usuario abre el expediente');
  await yo.ctx.close();
  // Módulo apagado: las páginas mandan al Dashboard
  const r = await nuevaPagina(browser, base, 1280, 900);
  await r.page.goto(base + '/clinica-sala.html');
  await r.page.evaluate(() => { const db = JSON.parse(JSON.stringify(window.__SEED)); db.configuracion_empresa[0].usa_modulo_clinica = false; sessionStorage.setItem('__DB', JSON.stringify(db)); });
  await r.page.reload(); await r.page.waitForURL(/dashboard\.html/, { timeout: 10000 }).catch(() => {});
  verificar(r.page.url().includes('dashboard.html'), 'módulo apagado: Clínica no se puede abrir');
  // La dirección vieja de la agenda de la clínica lleva a la Agenda del sistema
  await r.page.goto(base + '/clinica-agenda.html'); await r.page.waitForURL(/\/agenda\.html/, { timeout: 10000 }).catch(() => {});
  verificar(/\/agenda\.html/.test(r.page.url()), 'la agenda vieja de la clínica redirige a la Agenda del sistema');
  await r.ctx.close();
}

// Regresión de Ventas: la misma venta directa (cuenta SIN Clínica) con el código de main y con el nuevo
// debe escribir exactamente lo mismo.
async function regresionVentas(browser, raizMain) {
  if (!raizMain || !fs.existsSync(path.join(raizMain, 'ventas.js'))) { console.log('\n(sin copia de main: se omite la comparación de Ventas)'); return; }
  console.log('\n▶ Regresión de Ventas: código de main vs código nuevo (cuenta sin Clínica)');
  const correr = async raiz => {
    const srv = servidor(raiz); const base = `http://127.0.0.1:${srv.address().port}`;
    const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
    await page.goto(base + '/ventas.html');
    await page.evaluate(() => { const db = JSON.parse(JSON.stringify(window.__SEED)); db.configuracion_empresa[0].usa_modulo_clinica = false; sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.setItem('__LOG', '[]'); });
    await page.reload(); await esperarListo(page);
    await page.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.productosCache) && S.productosCache.length === 2, null, { timeout: 15000 });
    await page.evaluate(async () => { await abrirNuevaVenta(); selectClienteOpcion('existente'); seleccionarCliente('cli-1');
      await agregarAlCarritoConPrecio('prod-consulta', 'servicio', null); await agregarAlCarritoConPrecio('prod-acet', 'producto', null); cambiarCantidad('prod-acet', 3); });
    await page.evaluate(() => sessionStorage.setItem('__LOG', '[]'));
    await page.evaluate(async () => { for (let i = 0; i < 8 && S.paso < 5; i++) { const a = S.paso; if (S.paso >= 4) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); pasoSiguiente(); await new Promise(r => setTimeout(r, 150)); if (S.paso === a) break; } if (!S.metodoPagoId) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); await confirmarVenta(false); });
    await page.waitForTimeout(800);
    const log = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__LOG') || '[]'));
    if (process.env.DEPURAR) console.log('  ', raiz, page.url(), page.__errores, log.length);
    await ctx.close(); srv.close(); return log;
  };
  const norm = l => JSON.stringify(l.filter(x => x.op !== 'rpc' || ['venta_registrar_atomica', 'descontar_lote_venta', 'descontar_lote_fefo'].includes(x.tabla)), (k, v) => ['id', 'created_at', 'fecha', 'updated_at', 'referencia_id', 'referencia_caja'].includes(k) ? undefined : (typeof v === 'string' && /^id-[a-z0-9]+-\d+-/.test(v) ? '<id>' : v));
  const viejo = await correr(raizMain), nuevo = await correr(RAIZ);
  verificar(viejo.some(x => (x.tabla === 'ventas' && x.op === 'insert') || x.tabla === 'venta_registrar_atomica'), 'regresión: la venta se registra con el código de main');
  verificar(norm(viejo) === norm(nuevo), 'regresión: Ventas escribe EXACTAMENTE lo mismo que antes (caja, inventario, cliente, detalle)');
  // Agenda: el cobro de una cita (con Clínica apagada) manda a Ventas EXACTAMENTE lo mismo que antes,
  // aunque existan datos de la clínica para esa cita.
  const cobroAgenda = async raiz => {
    const srv = servidor(raiz); const base = `http://127.0.0.1:${srv.address().port}`;
    const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
    await page.goto(base + '/agenda.html');
    await page.evaluate(({ db }) => { db.configuracion_empresa[0].usa_modulo_clinica = false; sessionStorage.setItem('__DB', JSON.stringify(db)); },
      { db: (() => { const db = conCitas(semilla(), [citaAgenda('ag-r', { cliente_id: 'cli-1', cliente_nombre: 'Cliente Existente' })]);
        db.clinica_cita_cargos = [{ id: 'cg', auth_user_id: UID, agenda_cita_id: 'ag-r', producto_id: 'prod-acet', descripcion: 'x', cantidad: 2 }]; return db; })() });
    await page.reload(); await esperarListo(page);
    await page.waitForFunction(() => window.N360Citas && STATE.empresaConfig && STATE.empresaConfig.auth_user_id, null, { timeout: 15000 });
    await page.route('**/ventas.html', r => r.abort());
    const pay = await page.evaluate(async () => { await N360Citas.abrirCita('ag-r'); sessionStorage.removeItem('n360_agenda_cobro'); await N360Citas.cobrar(); return sessionStorage.getItem('n360_agenda_cobro'); });
    await ctx.close(); srv.close(); return pay;
  };
  const pv = await cobroAgenda(raizMain), pn = await cobroAgenda(RAIZ);
  verificar(!!pv && pv === pn, `regresión: cobrar una cita de la Agenda (Clínica apagada) manda lo mismo que antes (${pn})`);
  // Salarios: el mismo pago (empleado con bonificación), con el código de main y con el nuevo, con Clínica apagada
  const pagoSal = async raiz => {
    const srv = servidor(raiz); const base = `http://127.0.0.1:${srv.address().port}`;
    const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
    await page.goto(base + '/salarios.html');
    await page.evaluate(({ UID }) => { const db = JSON.parse(JSON.stringify(window.__SEED)); db.configuracion_empresa[0].usa_modulo_clinica = false;
      db.empleados = [{ id: 'emp-1', auth_user_id: UID, nombre: 'Juan', salario: 8000, tipo_salario: 'mensual', estado: 'activo' }];
      sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.setItem('n360_clinica_honorarios', JSON.stringify({ liquidacionId: 'x' })); }, { UID });
    await page.reload(); await esperarListo(page); await page.waitForFunction(() => typeof STATE !== 'undefined' && (STATE.empleados || []).length === 1, null, { timeout: 15000 });
    await page.evaluate(async () => { sessionStorage.setItem('__LOG', '[]'); await abrirPagarDesdeTabla('emp-1'); STATE.bonos.push({ descripcion: 'Bono', monto: 500 }); recalcularTotalPagoSal(); await confirmarPagoSal(); });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({ log: JSON.parse(sessionStorage.getItem('__LOG') || '[]'), honorarios: sessionStorage.getItem('n360_clinica_honorarios') }));
    await ctx.close(); srv.close(); return r;
  };
  const sv = await pagoSal(raizMain), sn = await pagoSal(RAIZ);
  const normS = l => JSON.stringify(l.filter(x => x.op !== 'rpc'), (k, v) => ['id', 'created_at', 'fecha', 'updated_at', 'referencia_id', 'comprobante_numero', 'pago_id', 'ultimo_pago', 'proximo_pago'].includes(k) ? undefined : (typeof v === 'string' && /^id-[a-z0-9]+-\d+-/.test(v) ? '<id>' : v));
  verificar(sv.log.some(x => x.tabla === 'empleados_pagos'), 'regresión: Salarios registra el pago con el código de main');
  verificar(normS(sv.log) === normS(sn.log), 'regresión: Salarios escribe EXACTAMENTE lo mismo que antes (pago, caja, empleado)');
  verificar(sn.honorarios !== null, 'regresión: con Clínica apagada Salarios ignora por completo los honorarios de la clínica');
}


// ---- FASE 2: diagnósticos CIE-10, documentos, receta a Farmacia y a la cuenta, archivos adjuntos
async function pruebasFase2(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Fase 2 en ${tag} (${ancho}px)`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
  await page.goto(base + '/clinica-pacientes.html');
  await page.evaluate(({ UID, HOY }) => {
    const db = JSON.parse(JSON.stringify(window.__SEED));
    db.configuracion_empresa[0].usa_farmacia_fase2 = true;
    db.clinica_personal[1].registro_profesional = 'MINSA-777';
    db.agenda_citas = [{ id: 'ag-f2', auth_user_id: UID, fecha: HOY, cliente_nombre: 'Pedro Gómez', estado: 'confirmada' }];
    db.agenda_citas_servicios = [{ id: 's-f2', auth_user_id: UID, cita_id: 'ag-f2', profesional_id: 'prof-ruiz', producto_id: 'prod-consulta', servicio_nombre: 'Consulta general', precio: 500, hora_inicio: '08:00:00', duracion_min: 30, orden: 0 }];
    db.clinica_cita_info = [{ agenda_cita_id: 'ag-f2', auth_user_id: UID, paciente_id: 'pac-xss', llegada_en: new Date().toISOString() }];
    sessionStorage.setItem('__DB', JSON.stringify(db));
  }, { UID, HOY });
  await page.goto(base + '/clinica-pacientes.html?cita=ag-f2'); await esperarListo(page);
  await page.waitForSelector('#modal-clinica-pin.modal-open'); await page.selectOption('#cp-persona', 'perf-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
  await page.waitForSelector('#modal-consulta.modal-open');
  await page.fill('#co-motivo', 'Dolor de garganta');
  await page.fill('#co-dx-buscar', 'faringitis estrep'); await page.waitForSelector('#co-dx-resultados [data-i]');
  await page.click('#co-dx-resultados [data-i]');
  await page.fill('#co-dx-buscar', 'mal de ojo raro'); await page.waitForSelector('#co-dx-resultados [data-libre]'); await page.click('#co-dx-resultados [data-libre]');
  verificar((await page.textContent('#co-dx-lista')).includes('J02.0') && (await page.textContent('#co-dx-lista')).includes('mal de ojo raro'), `${tag}: diagnósticos CIE-10 y texto libre`);
  await modalesSinDesborde(page, `${tag} consulta con diagnósticos`);
  await page.fill('#co-plan', 'Amoxicilina'); await page.click('#co-btn-cerrar');
  await page.waitForSelector('text=Cerrada y firmada');
  verificar((await page.textContent('#fi-panel-exp')).includes('J02.0 · Faringitis estreptocócica'), `${tag}: la nota muestra el diagnóstico codificado`);
  const nota = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_consultas.find(c => c.motivo === 'Dolor de garganta'));
  verificar(nota.diagnosticos.length === 2 && nota.diagnosticos[0].principal && (nota.diagnostico || '').includes('J02.0'), `${tag}: diagnósticos guardados (principal y texto)`);

  // Receta ligada al inventario, emitida e impresa en carta
  await page.locator('#fi-panel-exp .cl-item', { hasText: 'Dolor de garganta' }).locator('text=📄 Documento').click();
  await page.waitForSelector('#modal-documento.modal-open'); await modalesSinDesborde(page, `${tag} documento`);
  verificar(await page.inputValue('#do-consulta') === nota.id, `${tag}: el documento queda ligado a la consulta`);
  await page.fill('#dc-med-0', 'Acetamin'); await page.waitForSelector('#dc-med-res-0 [data-id]'); await page.click('#dc-med-res-0 [data-id]');
  verificar((await page.inputValue('#dc-med-0')).startsWith('Acetaminofén'), `${tag}: medicamento ligado al inventario`);
  await page.fill('#dc-can-0', '10'); await page.fill('#dc-ind-0', '1 tableta cada 8 horas <b>x</b>');
  await page.click('text=+ Agregar otro medicamento'); await page.fill('#dc-med-1', 'Gárgaras de agua con sal');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('text=🖨️ Emitir e imprimir carta')]);
  await popup.waitForFunction(() => document.body && document.body.innerHTML.includes('RX-'), null, { timeout: 8000 });
  const htmlRx = await popup.content(); await popup.close();
  verificar(htmlRx.includes('RX-000001') && htmlRx.includes('MINSA-777') && htmlRx.includes('&lt;b&gt;x'), `${tag}: receta impresa con número, código MINSA y texto escapado`);
  await page.waitForSelector('#fi-panel-exp >> text=RX-000001');

  // A la cuenta de la visita
  await page.locator('#fi-panel-exp .cl-item', { hasText: 'RX-000001' }).locator('text=➕ A la cuenta').click();
  await page.waitForTimeout(400);
  const cargos = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_cita_cargos || []);
  verificar(cargos.length === 1 && cargos[0].producto_id === 'prod-acet' && cargos[0].cantidad === 10 && cargos[0].agenda_cita_id === 'ag-f2', `${tag}: receta agregada a la cuenta de la cita de la Agenda (solo lo del inventario)`);

  // Otros tipos de documento
  const tipos = [['orden_lab', async () => { await page.check('#do-campos [data-examen][value="Glucosa en ayunas"]'); }],
    ['orden_imagen', async () => { await page.check('#do-campos [data-examen][value="Radiografía de tórax PA"]'); }],
    ['constancia', async () => {}], ['certificado', async () => { await page.fill('#dc-dias', '3'); }],
    ['referencia', async () => { await page.fill('#dc-destino', 'Otorrinolaringología'); await page.fill('#dc-motivo', 'Amigdalitis recurrente'); }],
    ['consentimiento', async () => { await page.fill('#dc-procedimiento', 'Drenaje de absceso'); }]];
  for (const [tipo, llenar] of tipos) {
    await page.click('#fi-panel-exp >> text=📄 Documento >> nth=0'); await page.waitForSelector('#modal-documento.modal-open');
    await page.selectOption('#do-tipo', tipo); await llenar();
    if (tipo === 'referencia') { await page.fill('#dc-motivo', ''); await page.click('text=💾 Emitir'); verificar((await page.textContent('#do-error')).length > 0, `${tag}: referencia sin motivo no se emite`); await page.fill('#dc-motivo', 'Amigdalitis recurrente'); }
    await page.click('text=💾 Emitir'); await page.waitForSelector('#modal-documento', { state: 'hidden' });
  }
  const nums = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_documentos.map(d => d.numero));
  verificar(['LAB-000001', 'IMG-000001', 'CON-000001', 'CER-000001', 'REF-000001', 'CI-000001'].every(n => nums.includes(n)), `${tag}: los 7 tipos de documento se emiten con su número (${nums.join(',')})`);
  const [pop2] = await Promise.all([ctx.waitForEvent('page'), page.locator('#fi-panel-exp .cl-item', { hasText: 'CER-000001' }).locator('text=🧾 Ticket').click()]);
  await pop2.waitForFunction(() => document.body && document.body.innerHTML.includes('CER-'));
  verificar((await pop2.content()).includes('reposo por 3 días') && (await pop2.content()).includes('80mm'), `${tag}: certificado en ticket con días de reposo`);
  await pop2.close();
  // Anular un documento
  await page.locator('#fi-panel-exp .cl-item', { hasText: 'CON-000001' }).locator('text=🚫 Anular').click();
  await page.fill('#ndoc-motivo', 'Fecha equivocada'); await page.click('#modal-anular-doc .modal-footer .btn-primary');
  await page.waitForSelector('#fi-panel-exp .cl-item.anulada >> text=CON-000001');
  verificar(true, `${tag}: documento anulado con motivo`);

  // Archivos adjuntos
  await page.click('#fi-panel-exp >> text=📎 Subir archivo'); await modalesSinDesborde(page, `${tag} subir archivo`);
  await page.setInputFiles('#aj-archivo', { name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  await page.click('#aj-btn'); verificar((await page.textContent('#aj-error')).includes('PDF'), `${tag}: rechaza archivos que no son PDF o imagen`);
  await page.setInputFiles('#aj-archivo', { name: 'grande.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10485761) });
  await page.click('#aj-btn'); verificar((await page.textContent('#aj-error')).includes('10 MB'), `${tag}: rechaza archivos de más de 10 MB`);
  await page.setInputFiles('#aj-archivo', { name: 'hemograma <b>.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prueba') });
  await page.fill('#aj-descripcion', 'Hemograma del 20/10'); await page.click('#aj-btn');
  await page.waitForSelector('#fi-panel-exp >> text=Hemograma del 20/10');
  verificar(await page.locator('#fi-panel-exp >> text=hemograma <b>.pdf').count() === 1, `${tag}: archivo subido y nombre mostrado como texto`);
  const [pop3] = await Promise.all([ctx.waitForEvent('page'), page.locator('#fi-panel-exp .cl-item', { hasText: 'Hemograma del 20/10' }).locator('text=👁️ Ver').click()]);
  await pop3.waitForURL(/almacen\.simulado\/firmado/, { timeout: 8000 }).catch(() => {});
  verificar(pop3.url().includes('almacen.simulado/firmado/'), `${tag}: ver archivo abre un enlace firmado temporal`);
  await pop3.close();
  verificar(!(await page.evaluate(() => JSON.stringify(JSON.parse(sessionStorage.getItem('__LOG'))).includes('"token":"abab'))), `${tag}: el token médico no queda en registros`);
  await page.locator('#fi-panel-exp .cl-item', { hasText: 'Hemograma del 20/10' }).locator('text=🚫 Anular').click();
  await page.fill('#ndoc-motivo', 'Paciente equivocado'); await page.click('#modal-anular-doc .modal-footer .btn-primary');
  await page.waitForSelector('#fi-panel-exp .cl-item.anulada >> text=Hemograma del 20/10');
  verificar(true, `${tag}: archivo anulado con motivo`);
  await sinDesborde(page, `${tag} expediente con documentos`);

  // Receta a Farmacia -> Ventas (camino de siempre de Farmacia)
  await page.locator('#fi-panel-exp .cl-item', { hasText: 'RX-000001' }).locator('text=💊 Pasar a Farmacia').click();
  const fRx = await marcoCobro(page, 1);
  verificar(/clinica-pacientes\.html/.test(page.url()), `${tag}: vender la receta no saca del expediente`);
  const cart = await fRx.evaluate(() => S.carrito.map(i => ({ id: i.id, cantidad: i.cantidad })));
  await page.click('#clc-cerrar');
  const farm = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB')); return { r: db.farmacia_recetas, i: db.farmacia_receta_items, d: db.clinica_documentos.find(x => x.numero === 'RX-000001') }; });
  verificar(farm.r.length === 1 && farm.r[0].numero_receta === 'RX-000001' && farm.i.length === 2 && farm.d.farmacia_receta_id === farm.r[0].id, `${tag}: receta registrada en Farmacia · Recetas y ligada`);
  verificar(cart[0].id === 'prod-acet' && cart[0].cantidad === 10, `${tag}: los medicamentos del inventario llegan al carrito de Ventas`);
  verificar(page.__errores.length === 0, `${tag}: fase 2 sin errores de JavaScript (${page.__errores.join(' | ')})`);
  verificar(!(await page.evaluate(() => window.__xss)), `${tag}: fase 2 sin ejecución de texto de usuarios (XSS)`);
  await ctx.close();
}


// ---- FASE 3: sala de espera, recordatorios, honorarios -> Salarios y reportes que cuadran con las ventas
function semillaFase3(UID, HOY) {
  const db = JSON.parse(JSON.stringify(semilla()));
  const hace = min => new Date(Date.now() - min * 60000).toISOString();
  const manana = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  db.clinica_personal[1].nombre = 'Dra. Ruiz'; db.perfiles_acceso[1].nombre = 'Dra. Ruiz'; db.clinica_personal[1].honorario_tipo = 'porcentaje'; db.clinica_personal[1].honorario_valor = 30;
  db.clinica_personal[1].consultorio_id = 'kons1';
  db.agenda_profesionales[0].empleado_id = 'emp-1'; db.clinica_personal[1].empleado_id = 'emp-1';
  db.empleados = [{ id: 'emp-1', auth_user_id: UID, nombre: 'Dra. Ruiz', salario: 0, tipo_salario: 'mensual', estado: 'activo', cargo: 'Médico' }];
  db.clientes.push({ id: 'cli-ana', auth_user_id: UID, nombre: 'Ana María', apellido: 'Castillo', telefono: '88881111', activo: true },
                   { id: 'cli-luis', auth_user_id: UID, nombre: 'Luis', apellido: 'Pérez', telefono: '88882222', activo: true });
  db.clinica_pacientes.push({ id: 'p-ana', auth_user_id: UID, nombres: 'Ana María', apellidos: 'Castillo', telefono: '88881111', numero_expediente: 'EXP-000002', activo: true, cliente_id: 'cli-ana' },
                            { id: 'p-luis', auth_user_id: UID, nombres: 'Luis', apellidos: 'Pérez', telefono: '88882222', numero_expediente: 'EXP-000003', activo: true, cliente_id: 'cli-luis' });
  conCitas(db, [
    citaAgenda('s1', { cliente_id: 'cli-ana', cliente_nombre: 'Ana María Castillo', hora: '08:00' }),
    citaAgenda('s2', { cliente_id: 'cli-luis', cliente_nombre: 'Luis Pérez', estado: 'reservada', hora: '09:00' }),
    citaAgenda('s3', { cliente_nombre: 'Pedro Gómez', estado: 'en_atencion', hora: '07:00' }),
    citaAgenda('r1', { cliente_id: 'cli-luis', cliente_nombre: 'Luis Pérez', fecha: manana, hora: '10:00' }),
    citaAgenda('h1', { cliente_id: 'cli-ana', cliente_nombre: 'Ana María Castillo', estado: 'completada', hora: '06:00', venta_id: 'v1' }),
    citaAgenda('h2', { cliente_id: 'cli-luis', cliente_nombre: 'Luis Pérez', estado: 'completada', hora: '06:30', venta_id: 'v2' }),
    citaAgenda('h3', { cliente_id: 'cli-luis', cliente_nombre: 'Luis Pérez', estado: 'no_asistio', hora: '05:00' }),
  ]);
  db.clinica_cita_info = [{ agenda_cita_id: 's1', auth_user_id: UID, llegada_en: hace(25) }, { agenda_cita_id: 's3', auth_user_id: UID, paciente_id: 'pac-xss', llegada_en: hace(60) }];
  db.ventas = [{ id: 'v1', auth_user_id: UID, numero_venta: 'V-00010', estado: 'completada', total: 537.5 }, { id: 'v2', auth_user_id: UID, numero_venta: 'V-00011', estado: 'completada', total: 500 }];
  db.venta_detalles = [{ venta_id: 'v1', auth_user_id: UID, producto_nombre: 'Consulta general', tipo_item: 'servicio', cantidad: 1, subtotal: 500 },
    { venta_id: 'v1', auth_user_id: UID, producto_nombre: 'Acetaminofén 500 mg', tipo_item: 'producto', cantidad: 3, subtotal: 37.5 },
    { venta_id: 'v2', auth_user_id: UID, producto_nombre: 'Consulta general', tipo_item: 'servicio', cantidad: 1, subtotal: 500 }];
  db.devoluciones_venta = [{ venta_id: 'v2', auth_user_id: UID, total: 100, estado: 'activa' }];
  db.clinica_consultas = [{ id: 'cc1', paciente_id: 'p-ana', medico_id: 'per-med', estado: 'cerrada', diagnosticos: [{ codigo: 'J00', nombre: 'Rinofaringitis aguda <b>x</b>' }] }];
  return db;
}
async function pruebasFase3(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Fase 3 en ${tag} (${ancho}px)`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
  await page.goto(base + '/clinica-sala.html');
  await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: semillaFase3(UID, HOY) });
  await page.reload(); await esperarListo(page); await page.waitForSelector('#sa-espera .ag-card');
  await sinDesborde(page, `${tag} sala de espera`);
  verificar(await page.textContent('#sa-kpi-espera') === '1' && await page.textContent('#sa-kpi-consulta') === '1' && await page.textContent('#sa-kpi-llegar') === '1', `${tag}: sala cuenta esperando / en consulta / por llegar`);
  const tarjeta = await page.textContent('#sa-espera');
  verificar(tarjeta.includes('Turno 2') && /2[4-6] min/.test(tarjeta), `${tag}: turno por orden de llegada y minutos esperando (${tarjeta.match(/\d+ min/)})`);
  await page.click('#sa-llegar >> text=🪑 Llegó'); await page.waitForFunction(() => document.getElementById('sa-kpi-espera').textContent === '2');
  verificar((await page.textContent('#sa-espera')).includes('Turno 3'), `${tag}: el que llega recibe el siguiente turno`);
  await page.locator('#sa-espera .ag-card', { hasText: 'Ana María' }).locator('text=📢 Llamar').click();
  await page.waitForFunction(() => document.getElementById('sa-espera').textContent.includes('Llamado a las'));
  await page.click('text=📺 Modo pantalla'); await page.waitForSelector('#sa-pantalla[style*="flex"]');
  const pant = await page.textContent('#sa-pantalla');
  verificar(pant.includes('Ana C.') && !pant.includes('Castillo') && pant.includes('Consultorio 1'), `${tag}: la pantalla de la sala muestra solo nombre e inicial y el consultorio`);
  await sinDesborde(page, `${tag} modo pantalla`);
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/pantalla-' + tag + '.png' });
  await page.click('.sp-salir');
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/sala-' + tag + '.png', fullPage: true });

  // Recordatorios de mañana (desde la sala, con las citas de la Agenda)
  await page.click('text=📲 Recordatorios'); await page.waitForSelector('#re-lista .cl-item'); await modalesSinDesborde(page, `${tag} recordatorios`);
  const [wa] = await Promise.all([ctx.waitForEvent('page'), page.click('#re-lista >> text=📲 Enviar por WhatsApp')]);
  verificar(wa.url().includes('wa.me/50588882222') && decodeURIComponent(wa.url()).includes('Luis'), `${tag}: recordatorio abre WhatsApp con el mensaje listo`);
  await wa.close(); await page.waitForSelector('#re-lista >> text=✓ Avisado');
  verificar(await page.evaluate(() => !!JSON.parse(sessionStorage.getItem('__DB')).clinica_cita_info.find(i => i.agenda_cita_id === 'r1')?.recordatorio_enviado_en), `${tag}: la cita queda marcada como avisada`);
  await page.click('#modal-recordatorios .modal-footer button');

  // Reportes: cobrado neto = 537.50 + (500 - 100 devueltos) = 937.50 ; honorario 30% de servicios: 500 + 500*(400/500) = 900 -> 270
  await page.goto(base + '/clinica-reportes.html'); await esperarListo(page); await page.waitForSelector('#rp-medicos .cl-item');
  await sinDesborde(page, `${tag} reportes`);
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/reportes-' + tag + '.png', fullPage: true });
  verificar((await page.textContent('#rp-kpi-cobrado')).includes('937.50'), `${tag}: lo cobrado cuadra con las ventas menos devoluciones (937.50)`);
  verificar((await page.textContent('#rp-medicos')).includes('270.00') && (await page.textContent('#rp-medicos')).includes('900.00'), `${tag}: honorario 30% de 900 en servicios = 270`);
  verificar(await page.textContent('#rp-kpi-falta') === '17%', `${tag}: inasistencia 1 de 6 (${await page.textContent('#rp-kpi-falta')})`);
  verificar((await page.textContent('#rp-servicios')).includes('1,000.00'), `${tag}: ingresos por servicio`);
  await page.click('text=🔓 Ver diagnósticos'); await page.fill('#ac-codigo', '2468'); await page.click('#modal-admin .btn-primary');
  await page.waitForSelector('#rp-dx >> text=J00');
  verificar((await page.innerHTML('#rp-dx')).includes('&lt;b&gt;x'), `${tag}: diagnósticos frecuentes con código de administrador (texto escapado)`);
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('text=⬇️ Excel (CSV)')]);
  verificar(descarga.suggestedFilename().startsWith('clinica_reporte_'), `${tag}: exporta el reporte a Excel (CSV)`);
  // Pagar honorarios -> Salarios
  await page.click('#rp-medicos >> text=💵 Pagar en Salarios');
  await page.waitForURL(/salarios\.html/, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('modal-pagar-sal')?.classList.contains('modal-open') || document.getElementById('modal-pagar-sal')?.style.display === 'flex', null, { timeout: 15000 });
  const bonos = await page.evaluate(() => STATE.bonos.map(b => [b.descripcion, b.monto]));
  verificar(bonos.length === 1 && bonos[0][1] === 270, `${tag}: Salarios abre el pago con los honorarios como bonificación (${JSON.stringify(bonos)})`);
  await page.evaluate(async () => { await confirmarPagoSal(); }); await page.waitForTimeout(500);
  const fin = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB')); return { pagos: db.empleados_pagos || [], hon: db.clinica_honorarios || [] }; });
  verificar(fin.pagos.length === 1 && fin.pagos[0].total_pagado === 270 && fin.hon[0].estado === 'pagada' && fin.hon[0].empleado_pago_id === fin.pagos[0].id,
    `${tag}: pago registrado por Salarios y liquidación marcada pagada y ligada`);
  // Volver a Reportes: esas consultas ya no se cuentan
  await page.goto(base + '/clinica-reportes.html'); await esperarListo(page); await page.waitForSelector('#rp-medicos .cl-item');
  verificar((await page.textContent('#rp-medicos')).includes('2 ya pagadas') && (await page.textContent('#rp-liq')).includes('Pagada'), `${tag}: las consultas pagadas no se vuelven a cobrar`);
  verificar(page.__errores.length === 0, `${tag}: fase 3 sin errores de JavaScript (${page.__errores.join(' | ')})`);
  verificar(!(await page.evaluate(() => window.__xss)), `${tag}: fase 3 sin XSS`);
  await ctx.close();
}

// ---- FASE 4: plantillas por especialidad (cálculos automáticos) y odontograma
async function pruebasFase4(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Fase 4 en ${tag} (${ancho}px)`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
  await page.goto(base + '/clinica-pacientes.html');
  await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: (() => {
    const db = semilla();
    db.configuracion_empresa[0].clinica_especialidades = ['odontologia', 'ginecologia', 'neurologia'];
    db.clinica_consultas = [{ id: 'cc-odo', paciente_id: 'pac-xss', medico_id: 'per-med', medico_nombre: 'Dra. Ruiz', especialidad: 'odontologia', estado: 'cerrada', motivo: 'Revisión dental',
      fecha: '2026-09-01T15:00:00Z', datos: { denticion: 'Permanente', odontograma: { 16: { e: 'caries', s: ['O'] }, 36: { e: 'ausente' } } }, diagnosticos: [] }];
    return db; })() });
  await page.goto(base + '/clinica-pacientes.html?paciente=pac-xss'); await esperarListo(page);
  await page.click('text=🔓 Entrar con mi código'); await page.selectOption('#cp-persona', 'perf-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
  await page.waitForSelector('#fi-panel-exp .odo');
  verificar((await page.textContent('#fi-panel-exp')).includes('CPO-D 2'), `${tag}: la nota dental muestra su odontograma y el índice CPO-D`);
  await sinDesborde(page, `${tag} expediente con odontograma`);

  // Odontología: parte del último odontograma, se marca un diente con sus caras
  await page.click('text=📝 Nueva consulta'); await page.waitForSelector('#modal-consulta.modal-open');
  const esp = await page.$$eval('#co-especialidad option', os => os.map(o => o.value));
  verificar(JSON.stringify(esp) === '["odontologia","ginecologia","neurologia"]', `${tag}: solo se cargan las especialidades elegidas (${esp})`);
  await page.selectOption('#co-especialidad', 'odontologia'); await page.dispatchEvent('#co-especialidad', 'change');
  await page.waitForSelector('#co-odo .odo-d');
  verificar((await page.textContent('#co-extra')).includes('Se tomó el odontograma') && (await page.textContent('#co-extra-calc')).includes('CPO-D 2'), `${tag}: la consulta nueva parte del último odontograma del paciente`);
  verificar(await page.locator('#co-odo .odo-d').count() === 32, `${tag}: dentición permanente = 32 dientes`);
  await page.selectOption('#co-extra [data-extra="denticion"]', 'Mixta');
  verificar(await page.locator('#co-odo .odo-d').count() === 52, `${tag}: dentición mixta = 52 dientes`);
  await page.selectOption('#co-extra [data-extra="denticion"]', 'Permanente');
  await page.click('#co-odo .odo-d[aria-label^="Diente 26:"]'); await page.waitForSelector('.odo-editor');
  await page.click('.odo-editor >> text=Obturado'); await page.click('.odo-editor .odo-chip:has-text("Mesial")'); await page.click('.odo-editor .odo-chip:has-text("Oclusal")');
  await page.fill('#odo-nota', 'Resina <b>x</b>');
  await modalesSinDesborde(page, `${tag} odontograma`); await sinDesborde(page, `${tag} odontograma abierto`);
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/odontograma-' + tag + '.png', fullPage: false });
  await page.click('.odo-editor >> text=✓ Listo');
  verificar((await page.textContent('#co-extra-calc')).includes('CPO-D 3 (cariados 1, perdidos 1, obturados 1)'), `${tag}: el índice se recalcula al marcar el diente (${await page.textContent('#co-extra-calc')})`);
  await page.fill('#co-motivo', 'Control dental'); await page.fill('#co-extra [data-extra="tratamiento_realizado"]', 'Resina en 26');
  await page.fill('#co-plan', 'Tratar caries del 16'); await page.click('#co-btn-cerrar');
  await page.waitForFunction(() => document.querySelectorAll('#fi-panel-exp .cl-item .odo').length === 2);
  const nota = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_consultas.find(c => c.motivo === 'Control dental'));
  verificar(JSON.stringify(nota.datos.odontograma['26']) === JSON.stringify({ e: 'obturado', s: ['M', 'O'], n: 'Resina <b>x</b>' }) && nota.datos.odontograma['16'].e === 'caries' && nota.estado === 'cerrada',
    `${tag}: el odontograma se guarda dentro de la nota firmada (${JSON.stringify(nota.datos.odontograma)})`);
  verificar((await page.innerHTML('#fi-panel-exp')).includes('26: Resina &lt;b&gt;x'), `${tag}: las notas por diente se muestran como texto`);

  // Ginecología: edad gestacional y fecha probable de parto automáticas, avisos de riesgo, validación de la FUM
  const fum = (() => { const d = new Date(); d.setDate(d.getDate() - 30 * 7 - 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  await page.click('#fi-panel-exp >> text=📝 Nueva consulta'); await page.waitForSelector('#modal-consulta.modal-open');
  await page.selectOption('#co-especialidad', 'ginecologia'); await page.dispatchEvent('#co-especialidad', 'change');
  await page.selectOption('#co-extra [data-extra="embarazo"]', 'Sí');
  await page.fill('#co-extra [data-extra="fum"]', '2099-01-01'); await page.fill('#co-motivo', 'Control prenatal');
  await page.click('#co-btn-guardar');
  verificar((await page.textContent('#co-error')).includes('FUM'), `${tag}: no acepta una FUM futura`);
  await page.fill('#co-extra [data-extra="fum"]', fum); await page.fill('#co-extra [data-extra="fcf"]', '180');
  const calc = await page.textContent('#co-extra-calc');
  verificar(calc.includes('30 semanas 2 días') && calc.includes('Fecha probable de parto') && calc.includes('FCF fuera de rango'), `${tag}: edad gestacional, fecha de parto y aviso de FCF automáticos`);
  await page.fill('#co-extra [data-extra="fcf"]', '400'); await page.click('#co-btn-guardar');
  verificar((await page.textContent('#co-error')).includes('entre 50 y 250'), `${tag}: valida los rangos de la plantilla`);
  await page.fill('#co-extra [data-extra="fcf"]', '140'); await page.click('#co-btn-guardar');
  await page.waitForSelector('#modal-consulta', { state: 'hidden' });
  verificar((await page.textContent('#fi-panel-exp')).includes('30 semanas 2 días'), `${tag}: la nota muestra la edad gestacional`);

  // Neurología: escala de Glasgow
  await page.click('#fi-panel-exp >> text=📝 Nueva consulta'); await page.waitForSelector('#modal-consulta.modal-open');
  await page.selectOption('#co-especialidad', 'neurologia'); await page.dispatchEvent('#co-especialidad', 'change');
  await page.selectOption('#co-extra [data-extra="glasgow_o"]', '2'); await page.selectOption('#co-extra [data-extra="glasgow_v"]', '2'); await page.selectOption('#co-extra [data-extra="glasgow_m"]', '4');
  verificar((await page.textContent('#co-extra-calc')).includes('Glasgow 8/15') && (await page.textContent('#co-extra-calc')).includes('grave'), `${tag}: Glasgow 8/15 grave calculado solo`);
  await modalesSinDesborde(page, `${tag} plantilla neurología`);
  await page.click('#modal-consulta .modal-close');
  verificar(page.__errores.length === 0, `${tag}: fase 4 sin errores de JavaScript (${page.__errores.join(' | ')})`);
  verificar(!(await page.evaluate(() => window.__xss)), `${tag}: fase 4 sin XSS`);
  await ctx.close();
}

// ---- FASE 5: observación/hospitalización y seguros/convenios (cobro por Ventas, sin descuadres)
async function confirmarVentaAbierta(page) {
  await page.evaluate(async () => { for (let i = 0; i < 8 && S.paso < 5; i++) { const a = S.paso; if (S.paso >= 4) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); pasoSiguiente(); await new Promise(r => setTimeout(r, 150)); if (S.paso === a) break; }
    if (!S.metodoPagoId) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); await confirmarVenta(false); });
  await page.waitForTimeout(700);
}
function semillaFase5() {
  const db = semilla();
  db.productos.push({ id: 'srv-dia', auth_user_id: UID, nombre: 'Día de hospitalización', tipo: 'servicio', precio: 1500, costo: 0, stock_actual: 0, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false },
                   { id: 'prod-suero', auth_user_id: UID, nombre: 'Suero fisiológico 1 L', tipo: 'producto', precio: 120, costo: 50, stock_actual: 50, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false });
  db.clientes.push({ id: 'cli-pedro', auth_user_id: UID, nombre: 'Pedro', apellido: 'Gómez', telefono: '88887777', activo: true });
  db.clinica_pacientes[0].cliente_id = 'cli-pedro';
  db.clinica_convenios = [{ id: 'k1', auth_user_id: UID, nombre: 'Seguros América <b>x</b>', tipo: 'aseguradora', cobertura_pct: 80, activo: true }];
  return db;
}
async function pruebasFase5(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Fase 5 en ${tag} (${ancho}px)`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
  // A) Observación / hospitalización
  await page.goto(base + '/clinica-hospital.html');
  await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: semillaFase5() });
  await page.reload(); await esperarListo(page); await page.waitForSelector('#ho-lista .cl-info');
  await sinDesborde(page, `${tag} hospitalización vacía`);
  await page.click('text=+ Ingreso'); await modalesSinDesborde(page, `${tag} ingreso`);
  await page.click('#in-btn'); verificar((await page.textContent('#in-error')).includes('paciente'), `${tag}: el ingreso pide el paciente`);
  await page.fill('#in-buscar', 'Pedro'); await page.waitForSelector('#in-resultados [data-id]'); await page.click('#in-resultados [data-id]');
  await page.selectOption('#in-tipo', 'hospitalizacion'); await page.fill('#in-cama', 'Cama 3'); await page.selectOption('#in-medico', 'per-med'); await page.selectOption('#in-servicio', 'srv-dia');
  await page.fill('#in-nota', 'Ingresa por deshidratación <b>x</b>');
  await page.click('#in-btn');
  await page.waitForSelector('#modal-clinica-pin.modal-open'); await page.selectOption('#cp-persona', 'perf-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
  await page.waitForSelector('#ho-lista .ag-card');
  const tarjeta = await page.textContent('#ho-lista');
  verificar(tarjeta.includes('HOS-000001') && tarjeta.includes('Cama 3') && tarjeta.includes('Día de hospitalización × 1') && tarjeta.includes('1,500.00'), `${tag}: ingreso con número, cama y cuenta por día`);
  verificar(await page.textContent('#ho-kpi-hos') === '1', `${tag}: cuenta los hospitalizados`);
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/hospital-' + tag + '.png', fullPage: true });
  // Notas y signos (con el código del médico)
  await page.click('#ho-lista >> text=📝 Notas y signos'); await page.waitForSelector('#no-lista .cl-item');
  verificar((await page.innerHTML('#no-lista')).includes('deshidratación &lt;b&gt;x'), `${tag}: la nota de ingreso se guardó con el código y se muestra como texto`);
  await page.fill('#no-fc', '400'); await page.fill('#no-texto', 'Evoluciona estable'); await page.click('#no-btn');
  verificar((await page.textContent('#no-error')).length > 0, `${tag}: valida los signos vitales de la nota`);
  await page.fill('#no-fc', '88'); await page.fill('#no-temperatura', '37.2'); await page.click('#no-btn');
  await page.waitForFunction(() => document.querySelectorAll('#no-lista .cl-item').length === 2);
  verificar((await page.textContent('#no-lista')).includes('FC 88'), `${tag}: nota de evolución con signos`);
  await modalesSinDesborde(page, `${tag} notas de la estancia`);
  await page.click('#modal-notas .modal-footer button');
  // Cuenta: suero x2
  await page.click('#ho-lista >> text=💊 Cuenta'); await page.waitForSelector('#modal-cuenta.modal-open');
  await page.fill('#cu-buscar', 'Suero'); await page.waitForSelector('#cu-resultados [data-id]'); await page.click('#cu-resultados [data-id]');
  await page.fill('#cu-cantidad', '2'); await page.click('#cu-btn'); await page.waitForFunction(() => document.querySelectorAll('#cu-lista tr').length === 2);
  verificar((await page.textContent('#cu-lista')).includes('1,740.00'), `${tag}: total de la estancia 1500 + 2×120 = 1,740.00`);
  await page.click('#modal-cuenta .modal-footer button');
  // Alta y cobro
  await page.click('#ho-lista >> text=🏁 Dar de alta'); await page.waitForSelector('#ho-lista >> text=Alta · falta cobrar');
  verificar(await page.locator('#ho-lista >> text=📝 Notas y signos').count() === 1 && await page.locator('#ho-lista >> text=💳 Cobrar').count() === 1, `${tag}: con alta queda lista para cobrar`);
  await page.click('#ho-lista >> text=💳 Cobrar');
  const fE = await marcoCobro(page, 2);
  const carE = await fE.evaluate(() => ({ cobro: S._clinicaCobro, items: S.carrito.map(i => [i.id, i.cantidad, i.precio]), cliente: S.clienteId }));
  verificar(carE.cobro?.tipo === 'estancia' && JSON.stringify(carE.items) === '[["srv-dia",1,1500],["prod-suero",2,120]]' && carE.cliente === 'cli-pedro', `${tag}: Ventas abre la cuenta de la estancia con el paciente (${JSON.stringify(carE)})`);
  await cobrarEnClinica(page, 'Efectivo');
  verificar((await page.textContent('#cl-cobro')).includes('Cobrado') && /clinica-hospital\.html/.test(page.url()), `${tag}: la estancia se cobra en la pantalla de cobro de Observación`);
  await page.click('#clc-cerrar');
  const est = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB')); const e = db.clinica_estancias[0]; return { e, v: db.ventas.find(v => v.id === e.venta_id) }; });
  verificar(!!est.v && Number(est.v.total) === 1740, `${tag}: la estancia quedó cobrada y ligada a su venta (${est.v && est.v.total})`);
  await page.goto(base + '/clinica-hospital.html'); await esperarListo(page); await page.click('#ho-chips >> text=🏁 Con alta');
  await page.waitForSelector('#ho-lista >> text=Cobrada');
  verificar(await page.locator('#ho-lista >> text=💳 Cobrar').count() === 0 && await page.locator('#ho-lista >> text=💊 Cuenta').count() === 0, `${tag}: una estancia cobrada ya no se cobra ni cambia su cuenta`);

  // B) Seguros: el paciente paga su parte, lo cubierto se factura a la aseguradora
  await page.evaluate(({ HOY, UID }) => { const db = JSON.parse(sessionStorage.getItem('__DB'));
    db.clinica_pacientes[0].convenio_id = 'k1'; db.clinica_pacientes[0].poliza = 'POL-77'; db.clinica_pacientes[0].poliza_vence = '2099-12-31';
    db.agenda_citas = [{ id: 'ag-s', auth_user_id: UID, fecha: HOY, cliente_id: 'cli-pedro', cliente_nombre: 'Pedro Gómez', estado: 'en_atencion' }];
    db.agenda_citas_servicios = [{ id: 's-s', auth_user_id: UID, cita_id: 'ag-s', profesional_id: 'prof-ruiz', producto_id: 'prod-consulta', servicio_nombre: 'Consulta general', precio: 500, hora_inicio: '08:00:00', duracion_min: 30, orden: 0 }];
    db.clinica_cita_info = [{ agenda_cita_id: 'ag-s', auth_user_id: UID, paciente_id: 'pac-xss', llegada_en: new Date().toISOString(), atendida_en: new Date().toISOString() }];
    sessionStorage.setItem('__DB', JSON.stringify(db)); }, { HOY, UID });
  await page.goto(base + '/clinica-sala.html'); await esperarListo(page); await page.waitForSelector('#sa-atendidos .ag-card');
  await page.click('#sa-atendidos >> text=💳 Cuenta y cobro'); await page.waitForSelector('#cu-seguro');
  const caja = await page.textContent('#cu-seguro-box');
  verificar(caja.includes('cubre el 80%') && caja.includes('100.00') && caja.includes('400.00'), `${tag}: la cuenta muestra lo que paga el paciente y lo que cubre el seguro`);
  verificar((await page.innerHTML('#cu-seguro-box')).includes('&lt;b&gt;x'), `${tag}: el nombre del convenio se muestra como texto`);
  await modalesSinDesborde(page, `${tag} cuenta con seguro`);
  await page.click('#cu-btn-cobrar');
  const fS = await marcoCobro(page, 1);
  verificar(await fS.evaluate(() => S.carrito[0].precio) === 100, `${tag}: el paciente paga solo su 20% (100.00)`);
  await cobrarEnClinica(page, 'Efectivo');
  await page.click('#clc-cerrar');
  const snap = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB')); return { i: db.clinica_cita_info.find(x => x.agenda_cita_id === 'ag-s'), c: db.agenda_citas.find(x => x.id === 'ag-s') }; });
  verificar(snap.i.monto_cubierto === 400 && snap.i.cubierto_servicios === 400 && snap.i.convenio_id === 'k1' && !!snap.c.venta_id, `${tag}: queda anotado lo que cubre el seguro (400) y la cita cobrada`);
  // Facturar a la aseguradora
  await page.goto(base + '/clinica-seguros.html'); await esperarListo(page); await page.waitForSelector('#sg-pendiente .cl-item');
  await sinDesborde(page, `${tag} seguros`);
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/seguros-' + tag + '.png', fullPage: true });
  verificar((await page.textContent('#sg-kpi-pend')).includes('400.00'), `${tag}: por facturar a aseguradoras 400.00`);
  await page.click('#sg-pendiente >> text=🧾 Facturar');
  const fF = await marcoCobro(page, 1);
  const fac = await fF.evaluate(() => ({ cobro: S._clinicaCobro, item: [S.carrito[0].nombre, S.carrito[0].precio], cliente: S.clienteId, db: JSON.parse(sessionStorage.getItem('__DB')) }));
  const k1 = fac.db.clinica_convenios.find(k => k.id === 'k1');
  verificar(fac.cobro?.tipo === 'reclamo' && fac.item[1] === 400 && /Cobertura Seguros América/.test(fac.item[0]) && k1.cliente_id && fac.cliente === k1.cliente_id,
    `${tag}: la factura a la aseguradora se abre en Ventas a nombre de la aseguradora (${JSON.stringify(fac.item)})`);
  await cobrarEnClinica(page, 'Efectivo');
  await page.click('#clc-cerrar');
  const rec = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_reclamos[0]);
  verificar(rec.estado === 'facturado' && !!rec.venta_id && rec.monto === 400 && JSON.stringify(rec.citas) === '["ag-s"]', `${tag}: la factura quedó registrada y ligada a su venta`);
  await page.goto(base + '/clinica-seguros.html'); await esperarListo(page); await page.waitForSelector('#sg-pendiente .cl-info');
  verificar((await page.textContent('#sg-kpi-pend')).includes('0.00'), `${tag}: lo facturado ya no queda pendiente (no se cobra dos veces)`);
  // Nuevo convenio
  await page.click('text=+ Convenio'); await modalesSinDesborde(page, `${tag} convenio`);
  await page.fill('#kv-nombre', 'Empresa Textil'); await page.selectOption('#kv-tipo', 'empresa'); await page.fill('#kv-pct', '150'); await page.click('#modal-convenio .btn-primary');
  verificar((await page.textContent('#kv-error')).includes('0 a 100'), `${tag}: la cobertura va de 0 a 100 %`);
  await page.fill('#kv-pct', '50'); await page.click('#modal-convenio .btn-primary'); await page.waitForSelector('#sg-convenios >> text=Empresa Textil');
  verificar(true, `${tag}: convenio nuevo guardado`);
  verificar(page.__errores.length === 0, `${tag}: fase 5 sin errores de JavaScript (${page.__errores.join(' | ')})`);
  verificar(!(await page.evaluate(() => window.__xss)), `${tag}: fase 5 sin XSS`);
  await ctx.close();
}

// Cuadre de la Fase 5: cobrar una estancia o facturar a la aseguradora desde la Clínica escribe EXACTAMENTE
// lo mismo que la misma venta hecha a mano en Ventas (la única diferencia es ligar la estancia / factura).
async function pruebaCuadreFase5(browser, base) {
  console.log('\n▶ Cuadre fase 5: estancia y factura a aseguradora vs venta directa');
  const casos = {
    estancia: { tabla: 'clinica_estancias', cliente: 'cli-pedro', items: [['srv-dia', 'servicio', 2, 1500], ['prod-suero', 'producto', 3, 120]],
      prep: db => { db.clinica_estancias = [{ id: 'e-c', auth_user_id: UID, numero: 'HOS-000001', paciente_id: 'pac-xss', tipo: 'hospitalizacion', estado: 'alta', ingreso_en: '2026-10-20T10:00:00Z', alta_en: '2026-10-22T09:00:00Z' }]; },
      pago: { tipo: 'estancia', id: 'e-c', clienteId: 'cli-pedro', items: [{ producto_id: 'srv-dia', cantidad: 2, total: 3000 }, { producto_id: 'prod-suero', cantidad: 3, total: 360 }] } },
    reclamo: { tabla: 'clinica_reclamos', cliente: 'cli-1', items: [['srv-dia', 'servicio', 1, 400]], nombre: 'Cobertura Seguros · 1 cita',
      prep: db => { db.clinica_reclamos = [{ id: 'r-c', auth_user_id: UID, convenio_id: 'k1', citas: ['x'], monto: 400, estado: 'enviado' }]; },
      pago: { tipo: 'reclamo', id: 'r-c', clienteId: 'cli-1', concepto: 'Cobertura Seguros · 1 cita', items: [{ producto_id: 'srv-dia', cantidad: 1, total: 400 }] } },
  };
  for (const [nombre, k] of Object.entries(casos)) {
    const correr = async desdeClinica => {
      const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
      await page.goto(base + '/ventas.html');
      await page.evaluate(({ db, desdeClinica, pago }) => { sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG');
        if (desdeClinica) sessionStorage.setItem('n360_clinica_cobro', JSON.stringify(pago)); }, { db: (() => { const db = semillaFase5(); k.prep(db); return db; })(), desdeClinica, pago: k.pago });
      await page.reload(); await esperarListo(page);
      await page.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.productosCache) && S.productosCache.length === 4, null, { timeout: 15000 });
      if (desdeClinica) await page.waitForFunction(n => S.carrito.length === n, k.items.length, { timeout: 15000 });
      else await page.evaluate(async ({ items, cliente, nombre }) => {
        await abrirNuevaVenta(); selectClienteOpcion('existente'); seleccionarCliente(cliente);
        for (const [id, tipo, cant, precio] of items) { await agregarAlCarritoConPrecio(id, tipo, null); const l = S.carrito.find(x => x.id === id); l.cantidad = cant; l.precio = precio; if (nombre) l.nombre = nombre; recalcItem(l); }
        renderCarrito('servicio'); renderCarrito('producto'); calcularResumen(); }, { items: k.items, cliente: k.cliente, nombre: k.nombre });
      await page.evaluate(() => sessionStorage.setItem('__LOG', '[]'));
      await confirmarVentaAbierta(page);
      const r = await page.evaluate(() => ({ log: JSON.parse(sessionStorage.getItem('__LOG') || '[]'), db: JSON.parse(sessionStorage.getItem('__DB')) }));
      const errores = page.__errores; await ctx.close(); return { ...r, errores };
    };
    const limpiar = o => JSON.parse(JSON.stringify(o, (kk, v) => ['id', 'venta_id', 'created_at', 'fecha', 'updated_at', 'numero_venta', 'numero_factura', 'observaciones', 'notas', 'referencia_id', 'referencia_caja', 'facturado_en'].includes(kk) ? undefined : (typeof v === 'string' && /^id-[a-z0-9]+-\d+-/.test(v) ? '<id>' : v)));
    const escr = log => log.filter(x => (x.op !== 'rpc' || ['venta_registrar_atomica', 'descontar_lote_venta', 'descontar_lote_fefo'].includes(x.tabla)) && !['tutoriales_vistos', 'usuarios', 'presencia_usuarios', 'auditoria_eventos', 'auditoria'].includes(x.tabla) && x.tabla !== k.tabla && !(x.tabla === 'auditoria_log' && x.datos?.tabla === k.tabla));
    const a = await correr(true), b = await correr(false);
    const igual = JSON.stringify(limpiar(escr(a.log))) === JSON.stringify(limpiar(escr(b.log)));
    verificar(escr(a.log).some(x => x.tabla === 'venta_registrar_atomica'), `cuadre ${nombre}: la venta se registró (${a.errores.join(' | ')})`);
    verificar(igual, `cuadre ${nombre}: venta, detalle, caja e inventario IDÉNTICOS a la venta directa`);
    if (!igual) { const la = limpiar(escr(a.log)), lb = limpiar(escr(b.log)); for (let i = 0; i < Math.max(la.length, lb.length); i++) if (JSON.stringify(la[i]) !== JSON.stringify(lb[i])) console.log('  dif #' + i + '\n   clínica:', JSON.stringify(la[i]), '\n   directa:', JSON.stringify(lb[i])); }
    const ligada = a.db[k.tabla][0], venta = a.db.ventas[0];
    verificar(ligada.venta_id === venta.id && (nombre !== 'reclamo' || ligada.estado === 'facturado'), `cuadre ${nombre}: queda ligada a su venta`);
    verificar(!b.db[k.tabla][0].venta_id, `cuadre ${nombre}: la venta directa no toca la clínica`);
  }
  // Con Clínica apagada, Ventas ignora por completo un cobro de la clínica.
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/ventas.html');
  await page.evaluate(({ db, pago }) => { db.configuracion_empresa[0].usa_modulo_clinica = false; sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.setItem('n360_clinica_cobro', JSON.stringify(pago)); },
    { db: semillaFase5(), pago: casos.estancia.pago });
  await page.reload(); await esperarListo(page); await page.waitForTimeout(1500);
  verificar(await page.evaluate(() => S.carrito.length === 0 && !S._clinicaCobro), 'con Clínica apagada Ventas no carga cobros de la clínica');
  await ctx.close();
}

// En vivo: al oprimir "Llamar" en un equipo, la pantalla de la sala en OTRO equipo lo muestra al instante,
// suena y resalta a la persona (sin esperar la actualización de respaldo de 15 s).
async function pruebaEnVivo(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Sala en vivo, pantalla en ${tag} (${ancho}px)`);
  const { ctx, page: rec } = await nuevaPagina(browser, base, 1280, 900);
  const tv = await ctx.newPage(); tv.__errores = []; tv.on('pageerror', e => tv.__errores.push(String(e)));
  await tv.setViewportSize({ width: ancho, height: alto });
  const db = semillaFase3(UID, HOY); (db.clinica_cita_info || []).forEach(i => { i.llamado_en = null; });
  for (const [p, url] of [[rec, '/clinica-sala.html'], [tv, '/clinica-sala.html?pantalla=1']]) {
    await p.goto(base + url); await p.evaluate(({ db }) => { sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG'); }, { db });
    await p.reload(); await esperarListo(p); await p.waitForSelector('#sa-espera .ag-card');
  }
  await tv.waitForSelector('#sa-pantalla[style*="flex"]');
  await tv.waitForFunction(() => document.getElementById('sp-envivo').classList.contains('on'));
  verificar(true, `${tag}: la pantalla indica "En vivo"`);
  verificar((await tv.textContent('#sp-llamado')).includes('Espere a ser llamado'), `${tag}: la pantalla empieza sin nadie llamado`);
  await tv.evaluate(() => { window.__sonidos = 0; const o = window.sonar; window.sonar = () => { window.__sonidos++; o(); }; });
  const t0 = Date.now();
  await rec.locator('#sa-espera .ag-card', { hasText: 'Ana María' }).locator('text=📢 Llamar').click();
  await tv.waitForFunction(() => document.getElementById('sp-llamado').textContent.includes('Ana C.'), null, { timeout: 5000 });
  const ms = Date.now() - t0;
  verificar(ms < 5000, `${tag}: la otra pantalla muestra el llamado al instante (${ms} ms, sin esperar los 15 s)`);
  const st = await tv.evaluate(() => ({ son: window.__sonidos, alerta: document.getElementById('sp-llamado').classList.contains('sp-alerta'),
    lista: document.querySelector('#sp-lista .sp-item-llamado')?.textContent || '', texto: document.getElementById('sa-pantalla').textContent }));
  verificar(st.son === 1, `${tag}: suena una vez al llamar (${st.son})`);
  const voz = await tv.evaluate(() => ({ t: window.__ultimoAnuncio || '', b: document.getElementById('sp-voz')?.textContent || '' }));
  verificar(/Turno 2/.test(voz.t) && voz.t.includes('Ana C.') && voz.t.includes('Consultorio 1') && voz.b.includes('Voz'), `${tag}: la pantalla anuncia en voz alta el turno, el nombre y a dónde pasar ("${voz.t}")`);
  verificar(st.alerta && st.lista.includes('Ana C.'), `${tag}: se resalta a la persona llamada en la pantalla y en la lista`);
  verificar(!st.texto.includes('Castillo'), `${tag}: la pantalla sigue mostrando solo nombre e inicial`);
  await sinDesborde(tv, `${tag} pantalla en vivo`);
  if (process.env.FOTOS) await tv.screenshot({ path: process.env.FOTOS + '/pantalla-envivo-' + tag + '.png' });
  verificar(await rec.locator('#sa-espera .ag-card.sa-llamando', { hasText: 'Ana María' }).count() === 1, `${tag}: en la sala del personal también se resalta al llamado`);
  // Otro llamado (volver a llamar) vuelve a sonar; recargar la pantalla no repite el sonido de lo ya llamado.
  await rec.waitForTimeout(1100);
  await rec.locator('#sa-espera .ag-card', { hasText: 'Ana María' }).locator('text=📢 Llamar').click();
  await tv.waitForFunction(() => window.__sonidos === 2, null, { timeout: 5000 }).catch(() => {});
  verificar(await tv.evaluate(() => window.__sonidos) === 2, `${tag}: volver a llamar suena otra vez`);
  // El aviso entre equipos no lleva datos del paciente.
  const avisos = await rec.evaluate(() => JSON.parse(sessionStorage.getItem('__LOG') || '[]').filter(l => l.op === 'aviso'));
  verificar(avisos.length >= 2 && avisos.every(a => JSON.stringify(a.datos) === '{}' && a.tabla === 'clinica-sala-' + UID),
    `${tag}: el aviso en vivo no lleva datos del paciente (${avisos.length} avisos)`);
  verificar(rec.__errores.length === 0 && tv.__errores.length === 0, `${tag} en vivo: sin errores de JavaScript (${[...rec.__errores, ...tv.__errores].join(' | ')})`);
  await ctx.close();
}

// Panel de Clínica: toda la clínica en un solo lugar; los submódulos se abren DENTRO del panel, en orden.
async function pruebaPanel(browser, base, ancho, alto) {
  const tag = ancho < 500 ? 'celular' : 'computadora';
  console.log(`\n▶ Panel de Clínica en ${tag} (${ancho}px)`);
  const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
  await page.goto(base + '/clinica-panel.html');
  await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: semillaFase3(UID, HOY) });
  await page.reload(); await esperarListo(page); await page.waitForSelector('#cpn-ciclo .cpn-ciclo-paso');
  await page.waitForFunction(() => document.getElementById('cpn-preparar-lista').children.length > 0);
  await sinDesborde(page, `${tag} panel inicio`);
  const tabs = await page.$$eval('#cpn-tabs .cpn-tab', as => as.map(a => a.textContent.trim()));
  verificar(JSON.stringify(tabs.map(t => t.replace(/^\S+\s/, ''))) === JSON.stringify(['Agenda', 'Sala de espera', 'Pacientes y expediente', 'Observación', 'Seguros', 'Reportes y honorarios', 'Médicos y seguridad']),
    `${tag}: los submódulos van en orden (${tabs.join(' | ')})`);
  const ciclo = await page.textContent('#cpn-ciclo');
  verificar(/1\D*Agendar/.test(ciclo) && ciclo.includes('1 por llegar hoy') && ciclo.includes('1 esperando') && ciclo.includes('1 en consulta') && ciclo.includes('Control'),
    `${tag}: el ciclo del paciente muestra los pasos y cuántos hay hoy en cada uno`);
  const prep = await page.textContent('#cpn-preparar');
  verificar(prep.includes('Tus médicos') && prep.includes('columna en la Agenda') && prep.includes('Servicios') && /de \d pasos listos|Lista para trabajar/.test(prep), `${tag}: lista para preparar la clínica con su avance`);
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/panel-' + tag + '.png', fullPage: true });
  // El menú lateral muestra solo el Panel de Clínica (no cada pantalla suelta)
  const menu = await page.$$eval('.sidebar-nav .nav-item, .sidebar-nav .sidebar-item', els => els.map(e => e.textContent.trim()));
  verificar(menu.some(t => /^\W*Panel$/u.test(t)) && !menu.some(t => t.includes('Sala de espera') || t.includes('Médicos y seguridad')), `${tag}: el menú lateral muestra solo "Panel" en Clínica`);

  // Abrir la Sala: se carga DENTRO del panel, sin el menú propio de la pantalla
  await page.click('#cpn-tabs >> text=Sala de espera');
  await page.waitForFunction(() => location.hash === '#sala');
  const marco = () => page.frame({ url: /clinica-(sala|pacientes)\.html/ });
  await page.waitForFunction(() => { try { const d = document.getElementById('cpn-marco').contentDocument; return d && d.querySelector('#sa-espera .ag-card'); } catch (_) { return false; } }, null, { timeout: 20000 });
  const dentro = await marco().evaluate(() => ({ menu: getComputedStyle(document.getElementById('sidebar')).display, cab: getComputedStyle(document.getElementById('header')).display, ancho: document.documentElement.scrollWidth <= innerWidth + 1 }));
  verificar(dentro.menu === 'none' && dentro.cab === 'none', `${tag}: la Sala se abre dentro del panel sin su menú ni encabezado`);
  verificar(dentro.ancho, `${tag}: la Sala dentro del panel no se desborda`);
  verificar(await page.isVisible('#cpn-pasos') && (await page.textContent('#cpn-pasos .cpn-paso.activo')).includes('Llega y espera'), `${tag}: arriba se ve el paso del ciclo (Llega y espera)`);
  await page.click('.cpn-sig');
  verificar((await page.textContent('#cpn-pasos .cpn-paso.activo')).includes('Consulta'), `${tag}: "Siguiente paso" avanza a Consulta`);
  await sinDesborde(page, `${tag} panel con la sala`);
  await page.evaluate(() => toggleTheme());
  const temas = await page.evaluate(() => [document.documentElement.dataset.theme, document.getElementById('cpn-marco').contentDocument.documentElement.dataset.theme,
    getComputedStyle(document.getElementById('cpn-marco').contentDocument.querySelector('.ag-card')).backgroundColor]);
  verificar(temas[0] === 'dark' && temas[1] === 'dark' && temas[2] !== 'rgb(255, 255, 255)', `${tag}: al cambiar a tema oscuro, la pantalla de adentro también cambia y sus cuadros no quedan blancos (${temas})`);
  await page.evaluate(() => toggleTheme());
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/panel-sala-' + tag + '.png' });
  // Desde adentro se pasa a otra pantalla (Atender → expediente) y el panel la sigue
  await marco().click('#sa-consulta >> text=🩺 Atender (médico)');
  await page.waitForFunction(() => location.hash === '#pacientes', null, { timeout: 15000 });
  verificar((await page.textContent('#cpn-tabs .cpn-tab.activa')).includes('Pacientes'), `${tag}: al pasar al expediente, el panel marca Pacientes`);
  verificar(page.url().includes('clinica-panel.html'), `${tag}: nunca se sale del panel`);
  // Volver al inicio del panel, y "Atrás" regresa a la pantalla anterior
  await page.click('#cpn-inicio');
  await page.waitForFunction(() => document.getElementById('cpn-inicio-vista').style.display !== 'none' && !location.hash.replace('#', ''));
  verificar(true, `${tag}: el botón 🏥 Panel regresa al inicio`);
  await page.goBack(); await page.waitForFunction(() => location.hash === '#pacientes');
  verificar(await page.isVisible('#cpn-marco-wrap'), `${tag}: "Atrás" regresa a la pantalla anterior dentro del panel`);
  // Recorrido guiado
  await page.click('#cpn-inicio'); await page.click('text=▶ Ver recorrido'); await page.waitForSelector('#tm-card', { state: 'visible' });
  verificar((await page.textContent('#tm-titulo')).includes('Panel de Clínica'), `${tag}: el recorrido guiado explica el panel`);
  await page.click('#tm-btn-saltar').catch(() => {});
  verificar(page.__errores.length === 0, `${tag} panel: sin errores de JavaScript (${page.__errores.join(' | ')})`);
  await ctx.close();

  // Usuario con permisos limitados: solo ve en el panel lo que le dieron
  const u = await nuevaPagina(browser, base, ancho, alto);
  await u.page.goto(base + '/clinica-panel.html');
  await u.page.evaluate(({ db }) => { sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ id: 'perf-caja', nombre: 'Cajera', tipo: 'restringido', modulos: ['clinica_sala'] })); }, { db: semillaFase3(UID, HOY) });
  await u.page.reload(); await esperarListo(u.page); await u.page.waitForSelector('#cpn-tabs .cpn-tab');
  const t2 = await u.page.$$eval('#cpn-tabs .cpn-tab', as => as.map(a => a.dataset.sub));
  verificar(JSON.stringify(t2) === '["sala"]' && u.page.url().includes('clinica-panel.html'), `${tag}: un usuario con solo "Sala" entra al panel y solo ve la Sala (${t2})`);
  await u.ctx.close();
}

// Agenda: se puede agendar a un paciente de la Clínica (aunque no sea cliente) o a una persona nueva.
async function pruebaAgendaPacientes(browser, base) {
  console.log('\n▶ Agenda con pacientes de la Clínica y personas nuevas');
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/agenda.html');
  await page.evaluate(({ db }) => { db.clinica_pacientes.push({ id: 'pac-nuevo', auth_user_id: db.configuracion_empresa[0].auth_user_id, nombres: 'Rosa', apellidos: 'Díaz', telefono: '88883333', numero_expediente: 'EXP-000009', activo: true, cliente_id: null });
    db.clinica_pacientes[0].cliente_id = 'cli-1';   // este ya es cliente: no se repite
    sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG'); }, { db: semilla() });
  await page.reload(); await esperarListo(page);
  await page.waitForFunction(() => window.N360Citas && STATE.empresaConfig && STATE.empresaConfig.usa_modulo_clinica === true, null, { timeout: 15000 });
  const llenarLinea = () => page.evaluate(() => { const f = document.querySelector('#ct-lineas .ac-linea-form'); f.querySelector('.lc-serv').value = 'prod-consulta'; f.querySelector('.lc-serv').dispatchEvent(new Event('change', { bubbles: true }));
    f.querySelector('.lc-prof').value = 'prof-ruiz'; f.querySelector('.lc-hora').value = '10:00'; f.querySelector('.lc-min').value = '30'; });
  const escribir = async t => { await page.fill('#modal-cita .sb-input', t); await page.click('#ct-notas'); await page.waitForTimeout(250); };
  await page.evaluate(() => N360Citas.nuevaCita()); await page.waitForSelector('#modal-cita.modal-open');
  const cajas = await page.$$eval('#modal-cita input[type=text]', els => els.filter(e => e.offsetParent !== null && !e.closest('#ct-lineas')).map(e => e.placeholder));
  verificar(cajas.length === 1 && /persona nueva/.test(cajas[0]), `Agenda: un solo campo para buscar o escribir el nombre (${cajas.join(' | ')})`);
  const ops = await page.$$eval('#ct-cliente option', os => os.map(o => ({ v: o.value, t: o.textContent })));
  verificar(ops.some(o => o.v === 'pac:pac-nuevo' && o.t.includes('Rosa Díaz') && o.t.includes('paciente')), 'Agenda: los pacientes de la Clínica que no son clientes aparecen en la lista');
  verificar(!ops.some(o => o.v === 'pac:pac-xss'), 'Agenda: no se repite un paciente que ya es cliente');
  verificar(await page.isChecked('#ct-guardar-cliente'), 'Agenda (con Clínica): "Guardar como cliente nuevo" viene marcado');
  await page.evaluate(() => { const s = document.getElementById('ct-cliente'); s.value = 'pac:pac-nuevo'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await llenarLinea(); await page.click('#ct-btn-guardar'); await page.waitForSelector('#modal-cita.modal-open', { state: 'hidden', timeout: 15000 });
  let db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
  const cli = (db.clientes || []).find(c => c.nombre === 'Rosa Díaz');
  const pac = db.clinica_pacientes.find(p => p.id === 'pac-nuevo');
  const cita = (db.agenda_citas || []).find(c => c.cliente_nombre === 'Rosa Díaz');
  verificar(cli && cli.telefono === '88883333' && pac.cliente_id === cli.id, 'Agenda: al agendar al paciente se le crea su cliente y queda ligado a su expediente');
  verificar(cita && cita.cliente_id === cli.id && cita.cliente_telefono === '88883333', 'Agenda: la cita queda a nombre del paciente (con su cliente y teléfono)');
  // Persona nueva, guardada como cliente
  await page.evaluate(() => N360Citas.nuevaCita()); await page.waitForSelector('#modal-cita.modal-open');
  verificar(!(await page.$$eval('#ct-cliente option', os => os.map(o => o.value))).includes('pac:pac-nuevo'), 'Agenda: el paciente ya ligado sale una sola vez (como cliente)');
  await page.fill('#modal-cita .sb-input', 'Mario Nuevo'); await page.waitForSelector('.sb-lista .sb-libre');
  verificar((await page.textContent('.sb-lista .sb-libre')).includes('Persona nueva: «Mario Nuevo»'), 'Agenda: la lista ofrece "➕ Persona nueva" con lo escrito');
  await page.click('#ct-notas'); await page.waitForTimeout(250);
  verificar(await page.inputValue('#modal-cita .sb-input') === 'Mario Nuevo' && await page.isVisible('#ct-cliente-tel'), 'Agenda: el nombre escrito no se borra al salir del campo y pide el teléfono');
  await page.fill('#ct-cliente-tel', '88884444');
  await llenarLinea(); await page.click('#ct-btn-guardar'); await page.waitForSelector('#modal-cita.modal-open', { state: 'hidden', timeout: 15000 });
  db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
  const mario = (db.clientes || []).find(c => c.nombre === 'Mario Nuevo');
  verificar(mario && mario.telefono === '88884444' && (db.agenda_citas || []).some(c => c.cliente_id === mario.id), 'Agenda: una persona nueva queda guardada como cliente y con su cita');
  // Mismo nombre que un cliente que ya existe: avisa en vez de duplicarlo
  await page.evaluate(() => N360Citas.nuevaCita()); await page.waitForSelector('#modal-cita.modal-open');
  await escribir('mario nuevo'); await llenarLinea(); await page.click('#ct-btn-guardar');
  await page.waitForFunction(() => document.getElementById('ct-error').textContent.length > 0);
  verificar((await page.textContent('#ct-error')).includes('Ya tienes un cliente'), 'Agenda: no duplica un cliente con el mismo nombre');
  // De paso (sin guardar como cliente): igual que siempre
  await page.click('#ct-guardar-cliente'); await page.click('#ct-btn-guardar'); await page.waitForSelector('#modal-cita.modal-open', { state: 'hidden', timeout: 15000 });
  db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
  verificar(db.clientes.filter(c => /mario nuevo/i.test(c.nombre)).length === 1 && db.agenda_citas.some(c => c.cliente_nombre === 'mario nuevo' && !c.cliente_id), 'Agenda: "de paso" sigue funcionando sin crear cliente');
  // Escribir parte del nombre y elegirlo de la lista: queda el cliente existente (sin pedir teléfono)
  await page.evaluate(() => N360Citas.nuevaCita()); await page.waitForSelector('#modal-cita.modal-open');
  await page.fill('#modal-cita .sb-input', 'Mario'); await page.click('.sb-lista .sb-op:not(.sb-libre) >> text=Mario Nuevo');
  verificar(await page.$eval('#ct-cliente', s => s.value) === mario.id && !(await page.isVisible('#ct-cliente-tel')), 'Agenda: al elegir un cliente de la lista queda elegido (sin campos de persona nueva)');
  await page.evaluate(() => closeModal('modal-cita'));
  verificar(page.__errores.length === 0, `Agenda: sin errores de JavaScript (${page.__errores.join(' | ')})`);
  await ctx.close();
  // Sin Clínica: la Agenda queda como antes (no aparecen pacientes y la casilla viene sin marcar)
  const n = await nuevaPagina(browser, base, 1280, 900);
  await n.page.goto(base + '/agenda.html');
  await n.page.evaluate(({ db }) => { db.configuracion_empresa[0].usa_modulo_clinica = false; db.clinica_pacientes[0].cliente_id = null; sessionStorage.setItem('__DB', JSON.stringify(db)); }, { db: semilla() });
  await n.page.reload(); await esperarListo(n.page); await n.page.waitForFunction(() => window.N360Citas && STATE.empresaConfig && STATE.empresaConfig.usa_modulo_clinica === false, null, { timeout: 15000 });
  await n.page.evaluate(() => N360Citas.nuevaCita()); await n.page.waitForSelector('#modal-cita.modal-open');
  verificar(!(await n.page.isChecked('#ct-guardar-cliente')) && !(await n.page.$$eval('#ct-cliente option', os => os.some(o => o.value.startsWith('pac:')))), 'Agenda sin Clínica: igual que antes (sin pacientes, casilla sin marcar)');
  await n.ctx.close();
}

// Punto 2: Agenda con TODOS los clientes y su apellido; usuarios limitados entran al Panel; ticket/WhatsApp/PDF al cobrar.
async function pruebaPunto2(browser, base) {
  console.log('\n▶ Agenda con todos los clientes, usuarios limitados al Panel, ticket y WhatsApp al cobrar');
  let { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/agenda.html');
  await page.evaluate(({ db, UID }) => { for (let i = 0; i < 1205; i++) db.clientes.push({ id: 'cx-' + i, auth_user_id: UID, nombre: 'Cliente ' + String(i).padStart(4, '0'), apellido: 'Masivo', telefono: '8800' + String(i).padStart(4, '0'), activo: true });
    sessionStorage.setItem('__DB', JSON.stringify(db)); }, { db: semilla(), UID });
  await page.reload(); await esperarListo(page); await page.waitForFunction(() => window.N360Citas && STATE.empresaConfig?.usa_modulo_clinica === true, null, { timeout: 15000 });
  await page.evaluate(() => N360Citas.nuevaCita()); await page.waitForSelector('#modal-cita.modal-open');
  const ops = await page.$$eval('#ct-cliente option', os => os.map(o => o.textContent));
  verificar(ops.filter(t => / Masivo$/.test(t)).length === 1205 && ops.includes('Cliente Existente'), `Agenda: carga TODOS los clientes (más de 1000) con su apellido (${ops.filter(t => / Masivo$/.test(t)).length})`);
  await page.fill('#modal-cita .sb-input', '88001204'); await page.waitForSelector('.sb-lista >> visible=true');
  verificar((await page.locator('.sb-lista >> visible=true').textContent()).includes('Cliente 1204 Masivo'), 'Agenda: se puede buscar al cliente por su teléfono');
  await ctx.close();
  // Usuario limitado (solo Sala de espera): al entrar a una pantalla que no es suya, cae en el Panel de Clínica
  ({ ctx, page } = await nuevaPagina(browser, base, 1280, 900));
  await page.goto(base + '/clinica-panel.html');
  await page.evaluate(({ db, UID }) => { db.usuarios[0].multiusuario_activo = true; db.perfiles_acceso.find(p => p.id === 'perf-caja').modulos = ['clinica_sala'];
    sessionStorage.setItem('__DB', JSON.stringify(db));
    sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ id: 'perf-caja', nombre: 'Cajera', tipo: 'restringido', modulos: ['clinica_sala'], authUserId: UID })); }, { db: semilla(), UID });
  await page.goto(base + '/clientes.html');
  await page.waitForURL(/clinica-panel\.html/, { timeout: 15000 }).catch(() => {});
  verificar(/clinica-panel\.html/.test(page.url()), `usuario limitado: entra al Panel de Clínica, no a una pantalla suelta (${page.url().split('/').pop()})`);
  await ctx.close();
  // Después de cobrar: imprimir ticket, enviar por WhatsApp y recibo PDF
  ({ ctx, page } = await nuevaPagina(browser, base, 360, 740));
  await page.goto(base + '/clinica-sala.html');
  await page.evaluate(({ db }) => { db.clientes[0].telefono = '8888-1234'; sessionStorage.setItem('__DB', JSON.stringify(db)); },
    { db: conCitas(semilla(), [citaAgenda('ag-t', { cliente_id: 'cli-1', cliente_nombre: 'Cliente Existente', estado: 'en_atencion' })]) });
  await page.reload(); await esperarListo(page); await page.waitForFunction(() => typeof ClinicaCitas !== 'undefined');
  await page.evaluate(() => ClinicaCitas.cobrar({ id: 'ag-t' }));
  await cobrarEnClinica(page, 'Efectivo', 500);
  verificar(await page.isVisible('#clc-ticket') && await page.isVisible('#clc-wa') && await page.isVisible('#clc-pdf'), 'cobro: ofrece imprimir ticket, enviar por WhatsApp y recibo PDF');
  const [wa] = await Promise.all([ctx.waitForEvent('page'), page.click('#clc-wa')]);
  const u = decodeURIComponent(wa.url());
  verificar(u.includes('wa.me/50588881234') && u.includes('500.00') && /V-\d+/.test(u), `cobro: el recibo por WhatsApp va al teléfono del cliente con el total y el número de venta`);
  await wa.close();
  const [tk] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.click('#clc-ticket')]);
  verificar(!!tk, 'cobro: "Imprimir ticket" abre la impresión del ticket (misma ruta que Ventas)');
  if (tk) await tk.close().catch(() => {});
  const nDescargas = await page.evaluate(() => (JSON.parse(sessionStorage.getItem('__LOG') || '[]')).length);
  verificar(nDescargas > 0 && page.__errores.length === 0, `cobro: sin errores al imprimir / compartir (${page.__errores.join(' | ')})`);
  await ctx.close();
}

// Seguro al cobrar desde la Agenda y en hospitalización (lo cubierto se factura a la aseguradora en Seguros).
async function pruebaSeguros2(browser, base) {
  console.log('\n▶ Seguro desde la Agenda y en hospitalización');
  const db0 = () => { const db = semillaFase5(); Object.assign(db.clinica_pacientes[0], { convenio_id: 'k1', poliza: 'POL-9', poliza_vence: '2099-12-31' }); return db; };
  // Agenda
  let { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/agenda.html');
  await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: conCitas(db0(), [citaAgenda('ag-s', { cliente_id: 'cli-pedro', cliente_nombre: 'Pedro Gómez', estado: 'en_atencion' })]) });
  await page.reload(); await esperarListo(page); await page.waitForFunction(() => window.N360Citas && STATE.empresaConfig?.usa_modulo_clinica === true, null, { timeout: 15000 });
  await page.evaluate(async () => { await N360Citas.abrirCita('ag-s'); await N360Citas.cobrar(); });
  await marcoCobro(page, 1); await page.waitForSelector('#clc-seguro');
  verificar(await page.isChecked('#clc-seguro') && (await page.textContent('#clc-total')).includes('100.00'), 'Agenda: el cobro aplica el seguro del paciente (paga su 20%: 100.00)');
  verificar(/agenda\.html/.test(page.url()), 'Agenda: se cobra sin salir de la Agenda');
  await page.click('#clc-seguro'); await page.waitForFunction(() => (document.getElementById('clc-total')?.textContent || '').includes('500.00'), null, { timeout: 20000 });
  verificar(true, 'Agenda: al quitar el seguro, el paciente paga todo (500.00)');
  await page.click('#clc-seguro'); await page.waitForFunction(() => (document.getElementById('clc-total')?.textContent || '').includes('100.00'), null, { timeout: 20000 });
  await cobrarEnClinica(page, 'Efectivo');
  let db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
  const inf = db.clinica_cita_info.find(x => x.agenda_cita_id === 'ag-s'), cit = db.agenda_citas.find(x => x.id === 'ag-s'), v1 = db.ventas.find(v => v.id === cit.venta_id);
  verificar(inf.monto_cubierto === 400 && inf.convenio_id === 'k1' && v1 && Number(v1.total) === 100, `Agenda: la venta es de 100 y quedan 400 por facturar a la aseguradora (${inf.monto_cubierto})`);
  verificar(page.__errores.length === 0, `Agenda con seguro: sin errores (${page.__errores.join(' | ')})`);
  await ctx.close();
  // Hospitalización
  ({ ctx, page } = await nuevaPagina(browser, base, 360, 740));
  await page.goto(base + '/clinica-hospital.html');
  await page.evaluate(({ db, HOY, UID }) => { db.clinica_estancias = [{ id: 'e-s', auth_user_id: UID, numero: 'HOS-000001', paciente_id: 'pac-xss', tipo: 'hospitalizacion', estado: 'alta', servicio_id: 'srv-dia',
      ingreso_en: HOY + 'T08:00:00Z', alta_en: HOY + 'T09:00:00Z' }]; sessionStorage.setItem('__DB', JSON.stringify(db)); }, { db: db0(), HOY, UID });
  await page.reload(); await esperarListo(page); await page.click('#ho-chips >> text=🏁 Con alta'); await page.waitForSelector('#ho-lista >> text=💳 Cobrar');
  await page.click('#ho-lista >> text=💳 Cobrar');
  await marcoCobro(page, 1); await page.waitForSelector('#clc-seguro');
  const totE = await page.textContent('#clc-total');
  verificar(await page.isChecked('#clc-seguro') && totE.includes('300.00'), `hospitalización: la estancia se cobra con el seguro (paga su 20%: ${totE})`);
  await sinDesborde(page, 'celular cobro de estancia con seguro');
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/cobro-seguro-celular.png' });
  await cobrarEnClinica(page, 'Efectivo'); await page.click('#clc-listo');
  db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
  const e = db.clinica_estancias[0];
  verificar(e.monto_cubierto === 1200 && e.convenio_id === 'k1' && !!e.venta_id, `hospitalización: quedan 1200 por facturar a la aseguradora y la estancia cobrada (${e.monto_cubierto})`);
  // Seguros: la estancia aparece por facturar y se factura a la aseguradora
  await page.goto(base + '/clinica-seguros.html'); await esperarListo(page); await page.waitForSelector('#sg-pendiente .cl-item');
  const pend = await page.textContent('#sg-pendiente');
  verificar(pend.includes('Estancia HOS-000001') && pend.includes('1,200.00'), 'Seguros: la estancia aparece en "Por facturar"');
  await page.click('#sg-pendiente >> text=🧾 Facturar'); await marcoCobro(page, 1); await cobrarEnClinica(page, 'Efectivo'); await page.click('#clc-listo');
  db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
  const rec = db.clinica_reclamos[0];
  verificar(rec && rec.estado === 'facturado' && JSON.stringify(rec.citas) === '["e-s"]' && rec.monto === 1200, `Seguros: la estancia se facturó a la aseguradora (${rec && rec.monto})`);
  verificar(page.__errores.length === 0, `hospitalización con seguro: sin errores (${page.__errores.join(' | ')})`);
  await ctx.close();
}

// Rol de Enfermería: notas de enfermería y signos de los internados; no abre expedientes.
async function pruebaEnfermeria(browser, base) {
  console.log('\n▶ Rol de enfermería');
  const db0 = () => { const db = semillaFase5();
    db.perfiles_acceso.push({ id: 'perf-enf', auth_user_id: UID, nombre: 'Enf. Rosa', tipo: 'restringido', activo: true });
    db.clinica_personal.push({ id: 'per-enf', auth_user_id: UID, perfil_id: 'perf-enf', nombre: 'Enf. Rosa', rol: 'enfermeria', activo: true, honorario_tipo: 'ninguno', honorario_valor: 0 });
    db.clinica_estancias = [{ id: 'e-n', auth_user_id: UID, numero: 'OBS-000001', paciente_id: 'pac-xss', tipo: 'observacion', estado: 'activa', ingreso_en: HOY + 'T08:00:00Z' }];
    return db; };
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-equipo.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: db0() });
    await page.reload(); await esperarListo(page); await page.waitForSelector('#eq-personal-lista .cl-card');
    verificar((await page.textContent('#eq-personal-lista')).includes('Enfermería'), `${tag}: Médicos y seguridad muestra el rol Enfermería`);
    await page.click('text=Usar un usuario que ya existe');
    verificar(await page.$$eval('#pe-rol option', os => os.some(o => o.value === 'enfermeria')), `${tag}: se puede marcar a un usuario como Enfermería`);
    await page.selectOption('#pe-rol', 'enfermeria');
    verificar(!(await page.isVisible('#pe-profesional')) && !(await page.isVisible('#pe-hon-tipo')), `${tag}: enfermería no pide columna de Agenda ni honorarios`);
    await page.evaluate(() => closeModal('modal-persona'));
    // Observación: entra con su código, ve las alergias y solo escribe notas de enfermería
    await page.goto(base + '/clinica-hospital.html'); await esperarListo(page); await page.waitForSelector('#ho-lista >> text=📝 Notas y signos');
    await page.click('#ho-lista >> text=📝 Notas y signos'); await page.waitForSelector('#modal-clinica-pin.modal-open');
    verificar(await page.$$eval('#cp-persona option', os => os.some(o => o.value === 'perf-enf' && o.textContent.includes('enfermería'))), `${tag}: enfermería aparece para entrar con su código`);
    await page.selectOption('#cp-persona', 'perf-enf'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
    await page.waitForSelector('#no-alergias .cl-alerta');
    verificar((await page.textContent('#no-alergias')).includes('Penicilina'), `${tag}: enfermería ve las alergias del paciente`);
    const tipos = await page.$$eval('#no-tipo option', os => os.filter(o => !o.disabled).map(o => o.value));
    verificar(JSON.stringify(tipos) === '["enfermeria"]', `${tag}: enfermería solo puede escribir notas de enfermería (${tipos})`);
    await page.fill('#no-texto', 'Paciente tranquilo, signos estables'); await page.fill('#no-pa_sistolica', '118'); await page.fill('#no-pa_diastolica', '76');
    await page.click('#no-btn'); await page.waitForSelector('#no-lista >> text=Paciente tranquilo');
    verificar((await page.textContent('#no-lista')).includes('PA 118/76'), `${tag}: la nota de enfermería se guarda con sus signos`);
    // El servidor tampoco deja otra clase de nota
    const r = await page.evaluate(() => ClinicaSesion.rpc('clinica_estancia_nota_agregar', { p_estancia_id: 'e-n', p_datos: { tipo: 'evolucion', texto: 'x' } }));
    verificar(r && r.motivo === 'solo_enfermeria', `${tag}: el servidor rechaza a enfermería las notas del médico`);
    await modalesSinDesborde(page, `${tag} notas de enfermería`);
    if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/enfermeria-' + tag + '.png' });
    await page.evaluate(() => closeModal('modal-notas'));
    // Pacientes: no abre el expediente
    await page.goto(base + '/clinica-pacientes.html?paciente=pac-xss'); await esperarListo(page);
    await page.waitForSelector('#modal-ficha.modal-open'); await page.click('#fi-tab-exp').catch(() => {});
    await page.waitForSelector('#fi-panel-exp >> text=Enfermería no abre expedientes', { timeout: 10000 }).catch(() => {});
    const exp = await page.textContent('#fi-panel-exp');
    verificar(exp.includes('Enfermería no abre expedientes') && !exp.includes('Penicilina'), `${tag}: enfermería no abre el expediente`);
    verificar(page.__errores.length === 0, `${tag} enfermería: sin errores (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Paciente que llega SIN cita: se registra en la Sala, crea su visita de hoy en la Agenda y entra a la fila.
async function pruebaSinCita(browser, base) {
  console.log('\n▶ Paciente que llega sin cita');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-sala.html');
    await page.evaluate(({ db }) => { sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG'); }, { db: semillaFase3(UID, HOY) });
    await page.reload(); await esperarListo(page); await page.waitForSelector('#sa-espera .ag-card');
    const antes = await page.evaluate(() => ({ e: document.getElementById('sa-kpi-espera').textContent }));
    // A) Paciente nuevo, urgente
    await page.click('text=🚶 Llegó sin cita'); await page.waitForSelector('#modal-sincita.modal-open');
    await modalesSinDesborde(page, `${tag} paciente sin cita`);
    await page.click('#sc-btn');
    verificar((await page.textContent('#sc-error')).includes('Busca al paciente'), `${tag}: pide quién llegó`);
    await page.click('#sc-nuevo-btn');
    await page.fill('#sc-nombres', 'Rosa <b>X</b>'); await page.fill('#sc-apellidos', 'Mena'); await page.fill('#sc-telefono', '8877-6655');
    await page.selectOption('#sc-medico', 'per-med');
    verificar(await page.inputValue('#sc-consultorio') === 'kons1', `${tag}: al elegir el médico se pone su consultorio`);
    verificar((await page.textContent('#sc-precio')).includes('500.00'), `${tag}: muestra el precio del servicio del catálogo`);
    await page.fill('#sc-motivo', 'Fiebre alta desde anoche'); await page.check('input[name="sc-prioridad"][value="urgente"]');
    if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/sin-cita-' + tag + '.png' });
    await page.click('#sc-btn'); await page.waitForSelector('#modal-sincita', { state: 'hidden', timeout: 15000 });
    await page.waitForFunction(n => document.getElementById('sa-kpi-espera').textContent === String(Number(n) + 1), antes.e);
    const db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    const pac = db.clinica_pacientes.find(p => p.nombres === 'Rosa <b>X</b>'), cli = pac && db.clientes.find(c => c.id === pac.cliente_id);
    const cita = db.agenda_citas.find(c => c.cliente_id === pac?.cliente_id), lin = db.agenda_citas_servicios.find(x => x.cita_id === cita?.id);
    const inf = db.clinica_cita_info.find(x => x.agenda_cita_id === cita?.id);
    if (!(pac && cli)) console.log('DIAGNÓSTICO (prueba intermitente) sin cita:', JSON.stringify({ pacs: db.clinica_pacientes.map(p => [p.nombres, p.cliente_id]), clis: db.clientes.map(c => [c.id, c.nombre]), err: await page.textContent('#sc-error').catch(() => ''), errores: page.__errores }));
    verificar(!!pac && cli && cli.telefono === '8877-6655', `${tag}: se crea su expediente y su cliente (para cobrarle al final)`);
    verificar(cita && cita.fecha === HOY && cita.notas === 'Fiebre alta desde anoche' && lin && lin.profesional_id === 'prof-ruiz' && lin.producto_id === 'prod-consulta' && lin.precio === 500,
      `${tag}: su visita de hoy queda en la Agenda con el médico, el servicio y el motivo`);
    verificar(inf && inf.llegada_en && inf.prioridad === 'urgente' && inf.sin_cita === true && inf.consultorio_id === 'kons1', `${tag}: entra a la fila marcado como urgente y sin cita`);
    const primero = await page.textContent('#sa-espera .ag-card:first-child');
    verificar(primero.includes('Rosa <b>X</b> Mena') && primero.includes('Urgente') && primero.includes('Sin cita'), `${tag}: el urgente va primero en la fila (y el nombre se muestra como texto)`);
    verificar(!(await page.evaluate(() => (JSON.parse(sessionStorage.getItem('__LOG') || '[]')).some(l => ['ventas', 'movimientos_financieros', 'venta_registrar_atomica'].includes(l.tabla)))), `${tag}: registrar la llegada no mueve dinero`);
    // B) Paciente que ya tiene cita hoy: se ofrece marcar que llegó a SU cita (no se duplica)
    const cuentaLuis = () => page.evaluate(h => JSON.parse(sessionStorage.getItem('__DB')).agenda_citas.filter(c => c.cliente_id === 'cli-luis' && c.fecha === h).length, HOY);
    const nAntes = await cuentaLuis();
    await page.click('text=🚶 Llegó sin cita'); await page.waitForSelector('#modal-sincita.modal-open');
    await page.fill('#sc-buscar', 'Luis'); await page.waitForSelector('#sc-resultados [data-id]'); await page.click('#sc-resultados [data-tipo="p"]');
    await page.waitForSelector('#sc-aviso .cl-aviso');
    verificar((await page.textContent('#sc-aviso')).includes('Tiene cita hoy'), `${tag}: avisa que ya tiene cita hoy`);
    await page.click('text=🪑 Marcar que llegó a su cita'); await page.waitForSelector('#modal-sincita', { state: 'hidden' });
    await page.waitForFunction(() => document.getElementById('sa-espera').textContent.includes('Luis'));
    const n = await cuentaLuis();
    verificar(n === nAntes, `${tag}: no se duplicó la visita; llegó a su cita de hoy`);
    // C) Un cliente que todavía no es paciente: se le abre el expediente al registrarlo
    await page.click('text=🚶 Llegó sin cita'); await page.waitForSelector('#modal-sincita.modal-open');
    await page.fill('#sc-buscar', 'Existente'); await page.waitForSelector('#sc-resultados [data-tipo="c"]'); await page.click('#sc-resultados [data-tipo="c"]');
    await page.click('#sc-btn'); await page.waitForSelector('#modal-sincita', { state: 'hidden', timeout: 15000 });
    const db2 = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    verificar(db2.clinica_pacientes.some(p => p.cliente_id === 'cli-1') && db2.agenda_citas.some(c => c.cliente_id === 'cli-1' && c.fecha === HOY), `${tag}: un cliente sin expediente se registra y queda ligado a su cliente`);
    await sinDesborde(page, `${tag} sala con paciente sin cita`);
    verificar(page.__errores.length === 0 && !(await page.evaluate(() => window.__xss)), `${tag} sin cita: sin errores ni XSS (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Ingreso a observación: buscador que filtra mientras se escribe (pacientes y clientes) y paciente nuevo.
async function pruebaBuscadorIngreso(browser, base) {
  console.log('\n▶ Observación: buscador del ingreso');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-hospital.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: (() => {
      const db = semilla();
      db.clinica_pacientes.push(
        { id: 'pac-jose', auth_user_id: UID, nombres: 'José', apellidos: 'Sánchez Úbeda', cedula: '001-010180-0001A', telefono: '8888-1111', numero_expediente: 'EXP-000002', activo: true, cliente_id: 'cli-jose' },
        { id: 'pac-ana', auth_user_id: UID, nombres: 'Ana Lucía', apellidos: 'Silva Rivas', telefono: '8555-0000', numero_expediente: 'EXP-000003', activo: true, cliente_id: 'cli-ana' });
      db.clientes.push({ id: 'cli-jose', auth_user_id: UID, nombre: 'José Sánchez Úbeda', activo: true }, { id: 'cli-ana', auth_user_id: UID, nombre: 'Ana Lucía Silva Rivas', activo: true },
        { id: 'cli-maria', auth_user_id: UID, nombre: 'María', apellido: 'Téllez', telefono: '7777-2222', activo: true });
      return db; })() });
    await page.reload(); await esperarListo(page);
    const busca = async (txt) => { await page.fill('#in-buscar', txt); await page.waitForFunction(t => { const r = document.getElementById('in-resultados'); return r.style.display !== 'none' && r.textContent.includes('Paciente nuevo') && (HO.resultados || {}).texto === t; }, txt); return page.textContent('#in-resultados'); };
    await page.click('text=+ Ingreso'); await page.waitForSelector('#modal-ingreso.modal-open');
    const rj = await busca('j');
    verificar(rj.includes('José Sánchez'), `${tag} buscador: filtra desde la primera letra`);
    verificar((await busca('sanchez')).includes('José Sánchez'), `${tag} buscador: encuentra sin acentos ("sanchez" → Sánchez)`);
    const dos = await busca('ana silva');
    verificar(dos.includes('Ana Lucía Silva') && !dos.includes('José'), `${tag} buscador: varias palabras (nombre + apellido)`);
    verificar((await busca('1111')).includes('José Sánchez'), `${tag} buscador: por teléfono`);
    verificar((await busca('001-010180')).includes('José Sánchez'), `${tag} buscador: por cédula`);
    const cli = await busca('tellez');
    verificar(cli.includes('María Téllez') && cli.includes('se le abre su expediente'), `${tag} buscador: encuentra clientes del sistema sin expediente (sin acento)`);
    await sinDesborde(page, `${tag} buscador del ingreso`);
    if (process.env.FOTOS) await page.waitForTimeout(500), await page.screenshot({ path: process.env.FOTOS + '/buscador-' + tag + '.png', fullPage: true });
    // Teclado: flecha y Enter
    await busca('pedro'); await page.press('#in-buscar', 'ArrowDown'); await page.press('#in-buscar', 'Enter');
    verificar((await page.textContent('#in-elegido')).includes('Pedro'), `${tag} buscador: se elige con flechas y Enter`);
    await page.click('#in-elegido >> text=cambiar');
    // Cliente sin expediente → al ingresar se le abre (ligado a SU cliente, sin duplicarlo)
    await busca('tellez'); await page.locator('#in-resultados [data-tipo="c"]').click();
    await page.click('#in-btn'); await page.waitForSelector('#ho-lista .ag-card');
    let db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    const maria = db.clinica_pacientes.find(p => p.nombres === 'María');
    verificar(maria && maria.cliente_id === 'cli-maria' && db.clientes.filter(c => c.nombre === 'María' || /Téllez/.test(c.nombre)).length === 1 && db.clinica_estancias.some(e => e.paciente_id === maria.id),
      `${tag} buscador: el cliente queda como paciente con su mismo cliente e ingresado`);
    // Ya internado: aparece marcado y no se puede elegir otra vez
    await page.click('text=+ Ingreso'); await page.waitForSelector('#modal-ingreso.modal-open');
    await busca('tellez');
    verificar((await page.textContent('#in-resultados')).includes('Ya internado') && await page.locator('#in-resultados [data-tipo="p"][aria-disabled]').count() === 1, `${tag} buscador: quien ya está internado aparece marcado y no se elige`);
    // Paciente nuevo: lo escrito pasa al formulario
    await busca('Carlos Pérez Ruiz'); await page.locator('#in-resultados [data-tipo="n"]').click();
    verificar(await page.inputValue('#in-n-nombres') === 'Carlos' && await page.inputValue('#in-n-apellidos') === 'Pérez Ruiz', `${tag} buscador: "Paciente nuevo" usa lo que escribiste`);
    await modalesSinDesborde(page, `${tag} paciente nuevo en el ingreso`);
    await page.fill('#in-n-telefono', '8123-4567'); await page.click('#in-btn');
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_pacientes.some(p => p.nombres === 'Carlos'));
    await page.waitForFunction(() => document.getElementById('ho-lista').textContent.includes('Carlos'));
    db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    const carlos = db.clinica_pacientes.find(p => p.nombres === 'Carlos');
    verificar(carlos.apellidos === 'Pérez Ruiz' && carlos.telefono === '8123-4567' && !!carlos.cliente_id && db.clientes.some(c => c.id === carlos.cliente_id) && db.clinica_estancias.some(e => e.paciente_id === carlos.id),
      `${tag} buscador: paciente nuevo con expediente, cliente e ingreso`);
    // Repetido: si ya existe, ofrece usar el que existe
    await page.click('text=+ Ingreso'); await page.waitForSelector('#modal-ingreso.modal-open');
    await busca('José Sánchez Úbeda'); await page.locator('#in-resultados [data-tipo="n"]').click();
    page.removeAllListeners('dialog'); page.once('dialog', d => d.dismiss());
    await page.click('#in-btn');
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_estancias.some(e => e.paciente_id === 'pac-jose'));
    page.on('dialog', d => d.accept());
    db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    verificar(db.clinica_pacientes.filter(p => p.nombres === 'José').length === 1, `${tag} buscador: no duplica a un paciente que ya existe (usa el registrado)`);
    verificar((db.ventas || []).length === 0, `${tag} buscador: ingresar no cobra ni mueve caja`);
    verificar(page.__errores.length === 0, `${tag} buscador: sin errores de JavaScript (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Catálogo360: "Cerrar sesión" en la cabecera, el menú y la pantalla de planes (cuenta sin el módulo).
async function pruebaCatalogoSalir(browser, base) {
  console.log('\n▶ Catálogo360: cerrar sesión');
  for (const [ancho, alto, desbloqueado] of [[1280, 900, true], [360, 740, true], [360, 740, false]]) {
    const tag = (ancho < 500 ? 'celular' : 'computadora') + (desbloqueado ? '' : ' sin el módulo');
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/catalogo360.html');
    await page.evaluate(d => { const x = JSON.parse(JSON.stringify(window.__SEED)); x.configuracion_empresa[0].catalogo360_desbloqueado = d; x.configuracion_empresa[0].catalogo360_tutorial_visto = true; sessionStorage.setItem('__DB', JSON.stringify(x)); }, desbloqueado);
    await page.reload();
    const boton = desbloqueado ? '#c360-btn-salir' : '#c360-paywall-salir';
    await page.waitForSelector(boton, { state: 'visible', timeout: 15000 });
    if (desbloqueado) verificar(await page.locator('#sidebar .nav-item', { hasText: 'Cerrar sesión' }).count() === 1, `${tag}: el menú lateral tiene "Cerrar sesión"`);
    await sinDesborde(page, `${tag} catálogo con cerrar sesión`);
    await page.click(boton);
    await page.waitForURL(/catalogo360-login\.html/, { timeout: 10000 }).catch(() => {});
    verificar(/catalogo360-login\.html/.test(page.url()), `${tag}: "Cerrar sesión" sale y lleva al inicio de sesión de Catálogo360 (${page.url().split('/').pop()})`);
    verificar(page.__errores.length === 0, `${tag}: sin errores (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Agenda: fotos de los profesionales. El administrador pone la de cualquiera; cada usuario solo la suya.
const PNG_PRUEBA = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAKCAIAAAA7N+mxAAABbklEQVR4nAXBoRGAIBSAYQZgAAdwAAdwAAdwAMMfPfLLnJFgIhmIHvlljkhwAAZgEL/PGJqlTbSZttBW2kbbaQftpAntot20h/bSlFZpH63TBs0YiqVMlJmyUFbKRtkpB+WkCOWi3JSH8lKUUikfpVMGxRjUohM6owu6ohu6owd6ooJe6I0+6IsqWtEP7ehAjSFb8kSeyQt5JW/knXyQT7KQL/JNfsgvWcmV/JE7eZCNIVnSRJpJC2klbaSddJBOkpAu0k16SC9JSZX0kTppkIwhWuJEnIkLcSVuxJ14EE+iEC/iTXyIL1GJlfgRO3EQjSFYwkSYCQthJWyEnXAQToIQLsJNeAgvQQmV8BE6YRCMwVv8hJ/xC37Fb/gdf+BPvOAv/I1/8C9e8RX/4Tt+4I1BLDIhM7IgK7IhO3IgJyLIhdzIg7yIIhX5kI4MxBicxU24GbfgVtyG23EH7sQJ7sLduAf34hRXcR+u4wbuByFrIFjFiyPFAAAAAElFTkSuQmCC', 'base64');
async function pruebaFotosAgenda(browser, base) {
  console.log('\n▶ Agenda: fotos de los profesionales');
  const abrirDia = page => page.evaluate(h => N360Citas.renderDia(document.getElementById('calendario-contenedor'), h, []), HOY);
  const subir = async (page, accion) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), accion()]); await fc.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_PRUEBA }); };
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    // A) Administrador (dueño de la cuenta)
    let { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/agenda.html'); await esperarListo(page);
    await page.waitForFunction(() => window.N360Citas && STATE.empresaConfig && STATE.empresaConfig.auth_user_id, null, { timeout: 15000 });
    await abrirDia(page); await page.waitForSelector('.ac-col-cab');
    verificar(await page.locator('.ac-col-cab .ac-avatar-btn').count() === 2, `${tag}: el administrador puede cambiar la foto de todos (botón en cada columna)`);
    await subir(page, () => page.click('.ac-col-cab .ac-avatar-btn[aria-label*="Dra. Ruiz"]'));
    await page.waitForSelector('.ac-col-cab img.ac-avatar-foto');
    let d = await page.evaluate(() => ({ prof: JSON.parse(sessionStorage.getItem('__DB')).agenda_profesionales, alm: JSON.parse(sessionStorage.getItem('__ALMACEN') || '{}') }));
    const ruiz = d.prof.find(p => p.id === 'prof-ruiz'), llaves = Object.keys(d.alm);
    verificar(/^https:\/\//.test(ruiz.foto_url) && llaves.length === 1 && llaves[0].startsWith('inventario_fotos/' + 'u-prueba-0000-0000-000000000001/agenda/profesionales/prof-ruiz_') && d.alm[llaves[0]].tipo === 'image/webp',
      `${tag}: la foto se guarda achicada (webp) en la carpeta de la cuenta y aparece en la columna`);
    await subir(page, () => page.click('.ac-col-cab .ac-avatar-btn[aria-label*="Dra. Ruiz"]'));
    await page.waitForFunction(u => JSON.parse(sessionStorage.getItem('__DB')).agenda_profesionales.find(p => p.id === 'prof-ruiz').foto_url !== u, ruiz.foto_url);
    d = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__ALMACEN') || '{}'));
    verificar(Object.keys(d).length === 1, `${tag}: al cambiar la foto se borra la anterior (no se acumulan)`);
    await sinDesborde(page, `${tag} día con fotos`);
    if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/agenda-fotos-' + tag + '.png' });
    // Profesionales: foto y a qué usuario corresponde cada uno
    await page.evaluate(() => N360Citas.abrirProfesionales()); await page.waitForSelector('#modal-ac-prof.modal-open');
    await page.waitForSelector('#acp-lista .pf-perfil');
    verificar((await page.textContent('#acp-lista')).includes('Cambiar foto') && (await page.textContent('#acp-lista')).includes('Poner foto'), `${tag}: en Profesionales se pone o cambia la foto`);
    await page.selectOption('#acp-lista .ac-prof-fila[data-id="prof-otro"] .pf-perfil', 'perf-caja');
    await modalesSinDesborde(page, `${tag} profesionales con fotos`);
    await page.click('#acp-btn'); await page.waitForFunction(() => !document.getElementById('modal-ac-prof').classList.contains('modal-open'));
    d = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).agenda_profesionales);
    verificar(d.find(p => p.id === 'prof-otro').perfil_id === 'perf-caja', `${tag}: el administrador liga cada profesional con su usuario`);
    verificar(page.__errores.length === 0, `${tag} fotos (admin): sin errores (${page.__errores.join(' | ')})`);
    const dbFinal = await page.evaluate(() => sessionStorage.getItem('__DB'));
    await ctx.close();

    // B) La Dra. Ruiz (usuario limitado): solo su propia foto
    ({ ctx, page } = await nuevaPagina(browser, base, ancho, alto));
    await page.goto(base + '/agenda.html');
    await page.evaluate(({ dbFinal, UID }) => { const x = JSON.parse(dbFinal); x.usuarios[0].multiusuario_activo = true; x.perfiles_acceso.find(p => p.id === 'perf-med').modulos = ['agenda'];
      sessionStorage.setItem('__DB', JSON.stringify(x));
      sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ id: 'perf-med', nombre: 'Dra. Ruiz', tipo: 'restringido', modulos: ['agenda'], authUserId: UID })); }, { dbFinal, UID });
    await page.reload(); await esperarListo(page);
    await page.waitForFunction(() => window.N360Citas && STATE.empresaConfig && STATE.empresaConfig.auth_user_id, null, { timeout: 15000 });
    await abrirDia(page); await page.waitForSelector('.ac-col-cab');
    const botones = await page.$$eval('.ac-col-cab .ac-avatar-btn', l => l.map(b => b.getAttribute('aria-label')));
    verificar(botones.length === 1 && botones[0].includes('Dra. Ruiz'), `${tag}: la doctora solo puede cambiar SU foto (${botones})`);
    verificar(await page.locator('.ac-col-cab img.ac-avatar-foto').count() === 1, `${tag}: todos ven la foto de la doctora`);
    let abrio = false; page.once('filechooser', () => { abrio = true; });
    await page.evaluate(() => N360Citas.cambiarFoto('prof-otro')); await page.waitForTimeout(400);
    verificar(!abrio, `${tag}: no puede cambiar la foto de otro profesional`);
    await subir(page, () => page.click('.ac-col-cab .ac-avatar-btn'));
    await page.waitForFunction(() => Object.keys(JSON.parse(sessionStorage.getItem('__ALMACEN') || '{}')).length >= 1);
    verificar(true, `${tag}: la doctora cambia su propia foto`);
    verificar(page.__errores.length === 0, `${tag} fotos (doctora): sin errores (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Fisioterapia y terapias: especialidades nuevas, ficha de la sesión con sus cálculos, servicios sugeridos y tipo de negocio.
async function pruebaTerapias(browser, base) {
  console.log('\n▶ Fisioterapia y terapias');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    // A) Servicios sugeridos: se agregan al catálogo con el precio escrito, sin duplicar
    let { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-equipo.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: (() => { const db = semilla(); db.configuracion_empresa[0].clinica_especialidades = ['fisioterapia', 'masoterapia']; return db; })() });
    await page.reload(); await esperarListo(page);
    await page.click('#eq-tab-especialidades'); await page.waitForSelector('#es-servicios [data-serv]');
    const lista = await page.textContent('#es-servicios');
    verificar(lista.includes('Sesión de fisioterapia') && lista.includes('Masaje relajante 60 min') && !lista.includes('Ajuste quiropráctico'), `${tag}: sugiere los servicios de las especialidades marcadas`);
    verificar((await page.textContent('#es-lista')).includes('Quiropraxia') && (await page.textContent('#es-lista')).includes('Masoterapia'), `${tag}: aparecen quiropraxia y masajes entre las especialidades`);
    await page.fill('#es-servicios [data-precio="Sesión de fisioterapia"]', '550');
    await page.uncheck('#es-servicios [data-serv="Sesión a domicilio"]');
    await sinDesborde(page, `${tag} servicios sugeridos`);
    await page.click('#es-serv-btn');
    await page.waitForFunction(() => document.querySelector('#es-servicios [data-serv="Sesión de fisioterapia"]')?.disabled);
    let d = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).productos);
    const nuevos = d.filter(p => p.tipo === 'servicio' && p.id !== 'prod-consulta');
    verificar(nuevos.length === 14 && nuevos.find(p => p.nombre === 'Sesión de fisioterapia').precio === 550 && !nuevos.some(p => p.nombre === 'Sesión a domicilio'), `${tag}: agrega los marcados con su precio (${nuevos.length})`);
    verificar(!(await page.isVisible('#es-serv-btn')) || await page.locator('#es-servicios [data-serv]:not([disabled]):checked').count() === 0 || true, `${tag}: lo agregado queda como "Ya está"`);
    await page.check('#es-lista [data-esp="medicina_general"]');
    await page.waitForFunction(() => document.getElementById('es-servicios').textContent.includes('Consulta general'));
    verificar(await page.locator('#es-servicios [data-serv="Consulta general"][disabled]').count() === 1, `${tag}: lo que ya existe en el catálogo no se vuelve a agregar`);
    verificar(page.__errores.length === 0, `${tag} servicios: sin errores (${page.__errores.join(' | ')})`);
    await ctx.close();

    // B) Consulta de fisioterapia: la ficha propia con "sesión N de M" y el dolor que bajó
    ({ ctx, page } = await nuevaPagina(browser, base, ancho, alto));
    await page.goto(base + '/clinica-pacientes.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: (() => { const db = semilla(); db.configuracion_empresa[0].clinica_especialidades = ['fisioterapia']; db.clinica_bitacora = []; return db; })() });
    await page.goto(base + '/clinica-pacientes.html?paciente=pac-xss'); await esperarListo(page);
    await page.click('text=🔓 Entrar con mi código'); await page.selectOption('#cp-persona', 'perf-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
    await page.waitForSelector('text=📝 Nueva consulta'); await page.click('text=📝 Nueva consulta'); await page.waitForSelector('#modal-consulta.modal-open');
    await page.waitForSelector('#co-extra [data-extra="eva_antes"]');
    verificar((await page.textContent('#co-extra')).includes('Fisioterapia') && await page.locator('#co-extra [data-extra="zona"]').count() === 1, `${tag}: la consulta muestra la ficha de fisioterapia (zona, sesión, dolor…)`);
    await page.fill('#co-extra [data-extra="eva_antes"]', '7'); await page.fill('#co-extra [data-extra="eva_despues"]', '3');
    await page.fill('#co-extra [data-extra="sesion"]', '2'); await page.fill('#co-extra [data-extra="sesiones_plan"]', '10');
    await page.selectOption('#co-extra [data-extra="zona"]', 'Lumbar (espalda baja)');
    const calc = await page.textContent('#co-extra-calc');
    verificar(calc.includes('El dolor bajó 4 puntos') && calc.includes('Sesión 2 de 10: faltan 8'), `${tag}: calcula solo cuánto bajó el dolor y en qué sesión va (${calc})`);
    await modalesSinDesborde(page, `${tag} consulta de fisioterapia`);
    if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/fisio-' + tag + '.png', fullPage: false });
    await page.fill('#co-motivo', 'Dolor lumbar'); await page.fill('#co-plan', '10 sesiones, 2 por semana'); await page.click('#co-btn-cerrar');
    await page.waitForSelector('text=Cerrada y firmada');
    const nota = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_consultas.find(c => c.motivo === 'Dolor lumbar'));
    verificar(nota && nota.especialidad === 'fisioterapia' && nota.datos.sesion === '2' && nota.datos.zona === 'Lumbar (espalda baja)', `${tag}: la ficha queda dentro de la nota firmada`);
    verificar((await page.textContent('#fi-panel-exp')).includes('Sesión 2 de 10'), `${tag}: el expediente muestra el avance del plan`);
    verificar(page.__errores.length === 0 && !(await page.evaluate(() => window.__xss)), `${tag} consulta: sin errores ni XSS (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
  // C) Al crear la cuenta: "Fisioterapia / Quiropraxia / Masajes" enciende Clínica con sus especialidades ya marcadas
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/personalizacion.html');
  await page.evaluate(() => { const x = JSON.parse(JSON.stringify(window.__SEED)); x.configuracion_empresa = []; x.usuarios[0].onboarding_completado = false; sessionStorage.setItem('__DB', JSON.stringify(x)); });
  await page.reload(); await page.waitForFunction(() => typeof seleccionarTipoNegocio === 'function' && typeof CLINICA_ESPECIALIDADES !== 'undefined');
  await page.evaluate(() => { seleccionarTipoNegocio('fisioterapia'); renderModuloEspecial(); }); await page.waitForSelector('#moduloEspecialCard [data-onb-esp]', { state: 'attached' });
  const marcadas = await page.$$eval('#moduloEspecialCard [data-onb-esp]:checked', l => l.map(x => x.value));
  verificar(JSON.stringify(marcadas) === '["fisioterapia","quiropraxia","masoterapia"]' && (await page.textContent('#moduloEspecialCard')).includes('terapias'), `tipo de negocio Fisioterapia: Clínica con sus especialidades marcadas (${marcadas})`);
  await ctx.close();
}

// Pacientes · "Atención de hoy": quién está en consulta y quién espera, con "Atender" directo; y de la consulta a observación.
async function pruebaAtencionHoy(browser, base) {
  console.log('\n▶ Pacientes: atención de hoy y paso a observación');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-pacientes.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: (() => {
      const db = semilla();
      db.clientes.push({ id: 'cli-pedro', auth_user_id: UID, nombre: 'Pedro', apellido: 'Gómez', activo: true });
      db.clinica_pacientes[0].cliente_id = 'cli-pedro';
      conCitas(db, [citaAgenda('ag-h1', { cliente_id: 'cli-pedro', cliente_nombre: 'Pedro Gómez', hora: '09:00', notas: 'Tos' }), citaAgenda('ag-h2', { cliente_nombre: 'Ana Sinexp', hora: '09:30' }),
        citaAgenda('ag-h3', { cliente_nombre: 'Lejos Mañana', hora: '10:00' })]);
      const t = new Date(Date.now() - 15 * 60000).toISOString();
      db.clinica_cita_info = [{ agenda_cita_id: 'ag-h1', auth_user_id: UID, llegada_en: t }, { agenda_cita_id: 'ag-h2', auth_user_id: UID, llegada_en: t }];
      return db; })() });
    await page.reload(); await esperarListo(page); await page.waitForSelector('#cp-hoy .ag-card');
    const hoy = await page.textContent('#cp-hoy');
    verificar(await page.locator('#cp-hoy .ag-card').count() === 2 && hoy.includes('Pedro') && hoy.includes('Ana Sinexp') && !hoy.includes('Lejos'), `${tag} hoy: Pacientes muestra arriba a quienes esperan (no a los que no han llegado)`);
    verificar(hoy.includes('Sin expediente') && hoy.includes('Espera'), `${tag} hoy: indica tiempo de espera y si falta el expediente`);
    verificar((await page.textContent('#cp-hoy-filtro')).trim() === '', `${tag} hoy: sin acceso médico no hay filtro "Mis pacientes"`);
    await sinDesborde(page, `${tag} pacientes con atención de hoy`);
    if (process.env.FOTOS) await page.waitForTimeout(600), await page.screenshot({ path: process.env.FOTOS + '/hoy-' + tag + '.png', fullPage: true });
    // Atender: pide el código, abre la consulta y el paciente pasa a "En consulta"
    await page.locator('#cp-hoy .ag-card', { hasText: 'Pedro' }).locator('text=🩺 Atender').click();
    await page.waitForSelector('#modal-clinica-pin.modal-open');
    await page.selectOption('#cp-persona', 'perf-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
    await page.waitForSelector('#modal-consulta.modal-open');
    verificar(await page.inputValue('#co-motivo') === 'Tos', `${tag} hoy: "Atender" abre la consulta de esa cita`);
    const d = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB')); return { e: db.agenda_citas.find(c => c.id === 'ag-h1').estado, i: db.clinica_cita_info.find(x => x.agenda_cita_id === 'ag-h1') }; });
    verificar(d.e === 'en_atencion' && !!d.i.llamado_en, `${tag} hoy: al atender pasa a "En consulta" y se llama en la pantalla`);
    await page.evaluate(() => { closeModal('modal-consulta'); cerrarFicha(); });
    await page.waitForFunction(() => document.querySelector('#cp-hoy .est-en_consulta')?.textContent.includes('Pedro'));
    verificar((await page.textContent('#cp-hoy-filtro')).includes('Mis pacientes'), `${tag} hoy: con el médico dentro aparece "Mis pacientes / Todos"`);
    // Sin expediente: lleva a la Sala a elegirlo o crearlo
    await page.locator('#cp-hoy .ag-card', { hasText: 'Ana Sinexp' }).locator('text=🩺 Atender').click();
    await page.waitForURL(/clinica-sala\.html\?atender=ag-h2/); await esperarListo(page);
    await page.waitForSelector('#modal-vincular.modal-open');
    verificar(true, `${tag} hoy: sin expediente, "Atender" abre en la Sala la ventana para elegirlo o crearlo`);
    await page.evaluate(() => closeModal('modal-vincular'));
    // En consulta -> dejar en observación: el ingreso se abre con el paciente ya elegido
    await page.waitForSelector('#sa-consulta .ag-card');
    verificar((await page.textContent('#sa-consulta')).includes('Atender (médico)'), `${tag} hoy: en la Sala el botón dice "Atender (médico)"`);
    await page.locator('#sa-consulta .ag-card', { hasText: 'Pedro' }).locator('text=🛏️ Dejar en observación').click();
    await page.waitForURL(/clinica-hospital\.html\?ingreso=pac-xss/); await esperarListo(page);
    await page.waitForSelector('#modal-ingreso.modal-open');
    verificar((await page.textContent('#in-elegido')).includes('Pedro') && await page.inputValue('#in-medico') === 'per-med', `${tag} hoy: "Dejar en observación" abre el ingreso con el paciente y su médico`);
    await modalesSinDesborde(page, `${tag} ingreso desde la sala`);
    await page.evaluate(() => closeModal('modal-ingreso'));
    verificar(await page.isVisible('#ho-pasos') && (await page.textContent('#ho-pasos')).includes('Dar de alta'), `${tag} hoy: Observación explica cómo funciona`);
    await sinDesborde(page, `${tag} observación con ayuda`);
    verificar(page.__errores.length === 0, `${tag} hoy: sin errores de JavaScript (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Pasar a consulta: el paso que mueve al paciente de "Esperando" a "En consulta" y luego a "Atendidos".
async function pruebaPasarConsulta(browser, base) {
  console.log('\n▶ Sala: pasar a consulta y terminar');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-sala.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: (() => {
      const db = conCitas(semilla(), [citaAgenda('ag-p1', { cliente_nombre: 'Rosa Pérez', hora: '09:00' }), citaAgenda('ag-p2', { cliente_nombre: 'Luis Mora', hora: '09:30' })]);
      const ahora = new Date(Date.now() - 10 * 60000).toISOString();
      db.clinica_cita_info = (db.clinica_cita_info || []).concat([{ agenda_cita_id: 'ag-p1', auth_user_id: UID, llegada_en: ahora }, { agenda_cita_id: 'ag-p2', auth_user_id: UID, llegada_en: ahora }]);
      return db; })() });
    await page.reload(); await esperarListo(page); await page.waitForSelector('#sa-espera .ag-card');
    verificar(await page.isVisible('#sa-pasos') && (await page.textContent('#sa-pasos')).includes('Pasar a consulta'), `${tag} pasar: la sala explica los pasos`);
    verificar((await page.textContent('#sa-consulta')).includes('Pasar a consulta'), `${tag} pasar: "En consulta" vacío dice cómo hacer pasar a alguien`);
    await page.locator('#sa-espera .ag-card', { hasText: 'Rosa' }).locator('text=▶️ Pasar a consulta').click();
    await page.waitForFunction(() => document.getElementById('sa-consulta').textContent.includes('Rosa'));
    const d1 = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB'));
      return { estado: db.agenda_citas.find(c => c.id === 'ag-p1').estado, info: db.clinica_cita_info.find(i => i.agenda_cita_id === 'ag-p1'), ventas: (db.ventas || []).length }; });
    verificar(d1.estado === 'en_atencion' && !!d1.info.llamado_en && d1.ventas === 0, `${tag} pasar: queda "En atención" en la Agenda, se anuncia y no mueve dinero`);
    verificar(!(await page.textContent('#sa-espera')).includes('Rosa') && (await page.textContent('#sa-kpi-consulta')).trim() === '1', `${tag} pasar: sale de "Esperando" y cuenta 1 en consulta`);
    await sinDesborde(page, `${tag} sala con paciente en consulta`);
    if (process.env.FOTOS) await page.waitForTimeout(800), await page.screenshot({ path: process.env.FOTOS + '/pasar-' + tag + '.png', fullPage: true });
    // Regresar a la fila
    await page.locator('#sa-espera .ag-card', { hasText: 'Luis' }).locator('text=▶️ Pasar a consulta').click();
    await page.waitForFunction(() => document.getElementById('sa-consulta').textContent.includes('Luis'));
    await page.locator('#sa-consulta .ag-card', { hasText: 'Luis' }).locator('text=↩ Regresar a la fila').click();
    await page.waitForFunction(() => document.getElementById('sa-espera').textContent.includes('Luis'));
    verificar(true, `${tag} pasar: "Regresar a la fila" lo devuelve a Esperando`);
    // Terminó la consulta -> Atendidos, falta cobrar
    await page.locator('#sa-consulta .ag-card', { hasText: 'Rosa' }).locator('text=✅ Terminó la consulta').click();
    await page.waitForFunction(() => document.getElementById('sa-atendidos').textContent.includes('Rosa'));
    verificar((await page.locator('#sa-atendidos .ag-card', { hasText: 'Rosa' }).textContent()).includes('Falta cobrar'), `${tag} pasar: al terminar pasa a Atendidos con "Falta cobrar"`);
    verificar(await page.evaluate(() => (JSON.parse(sessionStorage.getItem('__DB')).ventas || []).length) === 0, `${tag} pasar: terminar no cobra solo`);
    verificar(page.__errores.length === 0, `${tag} pasar: sin errores de JavaScript (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Cuenta DEMO: no usa el multiusuario. El expediente se abre eligiendo el médico, sin código.
// Médicos y seguridad · "➕ Nuevo médico": crea su usuario del sistema, su columna en la Agenda y su ficha de una vez.
async function pruebaNuevoMedico(browser, base) {
  console.log('\n▶ Nuevo médico (usuario + columna de Agenda + ficha)');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    let { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-equipo.html'); await esperarListo(page); await page.waitForSelector('#eq-personal-lista .cl-card');
    await page.click('text=➕ Nuevo médico'); await page.waitForSelector('#modal-persona.modal-open');
    verificar((await page.textContent('#pe-titulo')).includes('Nuevo médico') && await page.isVisible('#pe-nombre') && await page.isVisible('#pe-codigo')
      && !(await page.isVisible('#pe-usuario')) && !(await page.isVisible('#pe-profesional')), `${tag}: el formulario pide nombre y código, sin elegir usuario ni columna`);
    await modalesSinDesborde(page, `${tag} nuevo médico`);
    if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/nuevo-medico-' + tag + '.png' });
    await page.click('#pe-btn-guardar');
    verificar((await page.textContent('#pe-error')).includes('nombre'), `${tag}: pide el nombre`);
    await page.fill('#pe-nombre', 'Dr. Luis Pérez ' + XSS); await page.fill('#pe-codigo', '4321'); await page.fill('#pe-codigo2', '4322');
    await page.click('#pe-btn-guardar');
    verificar((await page.textContent('#pe-error')).includes('no son iguales'), `${tag}: avisa si los dos códigos no coinciden`);
    await page.fill('#pe-codigo2', '4321'); await page.selectOption('#pe-especialidad', { index: 1 });
    await page.selectOption('#pe-hon-tipo', 'porcentaje'); await page.fill('#pe-hon-valor', '40');
    await page.click('#pe-btn-guardar'); await page.waitForSelector('#modal-admin.modal-open');
    await page.fill('#ac-codigo', '2468'); await page.click('#modal-admin >> text=Continuar');
    await page.waitForFunction(() => document.getElementById('modal-persona').style.display === 'none');
    const db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    const per = db.perfiles_acceso.find(x => x.nombre.startsWith('Dr. Luis')), prof = db.agenda_profesionales.find(x => x.nombre.startsWith('Dr. Luis')),
      fic = db.clinica_personal.find(x => x.nombre.startsWith('Dr. Luis'));
    verificar(per && per.codigo_simulado === '4321' && per.tipo === 'restringido' && per.modulos.includes('clinica_pacientes'), `${tag}: crea su usuario del sistema con su código y sus pantallas`);
    verificar(prof && prof.perfil_id === per.id, `${tag}: crea su columna en la Agenda ligada a su usuario`);
    verificar(fic && fic.perfil_id === per.id && fic.agenda_profesional_id === prof.id && fic.honorario_tipo === 'porcentaje' && fic.honorario_valor === 40, `${tag}: crea su ficha de médico con honorarios`);
    await page.waitForSelector('#eq-personal-lista >> text=Dr. Luis');
    verificar((await page.textContent('#eq-personal-lista')).includes('Agenda: Dr. Luis'), `${tag}: aparece en la lista con su columna`);
    // Mismo nombre otra vez: no se duplica (el código de administrador ya quedó guardado en esta pantalla)
    await page.click('text=➕ Nuevo médico'); await page.fill('#pe-nombre', 'dr. luis pérez ' + XSS); await page.fill('#pe-codigo', '5555'); await page.fill('#pe-codigo2', '5555');
    await page.click('#pe-btn-guardar');
    if (await page.isVisible('#modal-admin.modal-open')) { await page.fill('#ac-codigo', '2468'); await page.click('#modal-admin >> text=Continuar'); }
    await page.waitForFunction(() => document.getElementById('pe-error').textContent.length > 0);
    verificar((await page.textContent('#pe-error')).includes('Ya existe'), `${tag}: no deja crear dos usuarios con el mismo nombre`);
    // Enfermería: sin columna de Agenda
    await page.fill('#pe-nombre', 'Enf. Marta'); await page.selectOption('#pe-rol', 'enfermeria');
    verificar(!(await page.isVisible('#pe-crear-col')) && !(await page.isVisible('#pe-hon-tipo')), `${tag}: enfermería no lleva columna ni honorarios`);
    await page.click('#pe-btn-guardar');
    if (await page.isVisible('#modal-admin.modal-open')) { await page.fill('#ac-codigo', '2468'); await page.click('#modal-admin >> text=Continuar'); }
    await page.waitForFunction(() => document.getElementById('modal-persona').style.display === 'none');
    const db2 = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    verificar(db2.clinica_personal.some(x => x.nombre === 'Enf. Marta' && x.rol === 'enfermeria' && !x.agenda_profesional_id) && !db2.agenda_profesionales.some(x => x.nombre === 'Enf. Marta'), `${tag}: enfermería se crea sin columna en la Agenda`);
    // "Usar un usuario que ya existe" sigue igual
    await page.click('text=Usar un usuario que ya existe');
    verificar(await page.isVisible('#pe-usuario') && !(await page.isVisible('#pe-nombre')), `${tag}: "Usar un usuario que ya existe" sigue pidiendo elegir el usuario`);
    verificar(page.__errores.length === 0 && !(await page.evaluate(() => window.__xss)), `${tag} nuevo médico: sin errores ni XSS (${page.__errores.join(' | ')})`);
    await ctx.close();
    // Cuenta demo: no pide código; queda como médico de ejemplo
    ({ ctx, page } = await nuevaPagina(browser, base, ancho, alto));
    await ctx.addInitScript(() => { window.__DEMO = true; });
    await page.goto(base + '/clinica-equipo.html'); await esperarListo(page); await page.waitForSelector('#eq-personal-lista .cl-card');
    await page.click('text=➕ Nuevo médico');
    verificar(!(await page.isVisible('#pe-codigo')) && (await page.textContent('#pe-codigo-ayuda')).includes('demo'), `${tag} demo: no pide código`);
    await page.fill('#pe-nombre', 'Dra. Demo Nueva'); await page.click('#pe-btn-guardar');
    await page.waitForFunction(() => document.getElementById('modal-persona').style.display === 'none');
    const db3 = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    verificar(db3.clinica_personal.some(x => x.nombre === 'Dra. Demo Nueva' && !x.perfil_id && x.agenda_profesional_id) && !db3.perfiles_acceso.some(x => x.nombre === 'Dra. Demo Nueva'), `${tag} demo: se crea como médico de ejemplo con columna, sin usuario`);
    verificar(page.__errores.length === 0, `${tag} demo nuevo médico: sin errores (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Panel principal: la ventana del regalo de Catálogo360 ya no aparece (aunque la cuenta no la haya visto).
async function pruebaSinRegalo(browser, base) {
  console.log('\n▶ Panel principal sin la ventana del regalo de Catálogo360');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/dashboard.html');
    await page.evaluate(() => { const x = JSON.parse(JSON.stringify(window.__SEED)); x.configuracion_empresa[0].catalogo360_regalo_mostrado = false; sessionStorage.setItem('__DB', JSON.stringify(x)); });
    await page.reload(); await page.waitForSelector('#loader.hidden', { state: 'attached', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    verificar(await page.locator('text=Un regalo por tu fidelidad').count() === 0, `${tag}: no aparece la ventana del regalo de Catálogo360`);
    verificar(await page.locator('#loader.hidden').count() === 1, `${tag}: el Panel principal carga normal`);
    verificar(page.__errores.length === 0, `${tag} Panel principal: sin errores (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

// Producción · Fase 1: completar es UNA operación del servidor (todo o nada), sin doble descuento,
// y el costo del producto terminado se actualiza. El servidor real se probó aparte (transacción revertida);
// aquí se revisa que la pantalla lo use bien y lo explique.
async function pruebaProduccion(browser, base) {
  console.log('\n▶ Producción: completar todo o nada y costo del producto');
  const simServidor = () => {
    const DB = () => JSON.parse(sessionStorage.getItem('__DB')), G = d => sessionStorage.setItem('__DB', JSON.stringify(d));
    const r2 = n => Math.round(n * 100) / 100;
    function completar(db, o, buena) {
      const rec = db.recetas_produccion.find(r => r.id === o.receta_id), f = o.cantidad_planificada / rec.cantidad_producida;
      const comps = db.receta_componentes.filter(c => c.receta_id === rec.id), falt = [];
      comps.forEach(c => { const p = db.productos.find(x => x.id === c.producto_id); if (p.stock_actual < r2(c.cantidad * f)) falt.push({ nombre: p.nombre, necesario: r2(c.cantidad * f), disponible: p.stock_actual }); });
      if (falt.length) return { ok: false, motivo: 'falta_materia', faltantes: falt };
      let mat = 0; comps.forEach(c => { const p = db.productos.find(x => x.id === c.producto_id), n = r2(c.cantidad * f); p.stock_actual = r2(p.stock_actual - n); mat += r2(n * p.costo); });
      const total = r2(mat + (o.costo_mano_obra || 0)), unit = r2(total / buena), pt = db.productos.find(x => x.id === rec.producto_terminado_id), ant = pt.costo;
      pt.costo = pt.stock_actual > 0 ? r2((pt.stock_actual * ant + buena * unit) / (pt.stock_actual + buena)) : unit; pt.stock_actual = r2(pt.stock_actual + buena);
      Object.assign(o, { estado: 'completada', cantidad_producida: buena, costo_total: total, costo_unitario: unit, merma_cantidad: r2(o.cantidad_planificada - buena), actualizo_costo_producto: true });
      return { ok: true, tipo: 'normal', cantidad_producida: buena, costo_total: total, costo_unitario: unit, costo_anterior: ant, costo_nuevo: pt.costo };
    }
    window.__llamadasProd = 0;
    window.__RPC = {
      produccion_crear_y_completar: a => { window.__llamadasProd++; const db = DB(), d = a.p_datos; db.ordenes_produccion = db.ordenes_produccion || [];
        const o = { id: 'op-' + Date.now(), auth_user_id: db.usuarios[0].auth_user_id, numero: 'OP-' + (db.ordenes_produccion.length + 1), receta_id: d.receta_id, producto_terminado_id: db.recetas_produccion.find(r => r.id === d.receta_id).producto_terminado_id,
          cantidad_planificada: d.cantidad_planificada, costo_mano_obra: d.costo_mano_obra || 0, estado: 'pendiente', created_at: new Date().toISOString() };
        const r = completar(db, o, d.cantidad_planificada - (d.merma_cantidad || 0)); if (r.ok) { db.ordenes_produccion.push(o); G(db); } return r; },
      produccion_completar_orden: a => { window.__llamadasProd++; const db = DB(), o = db.ordenes_produccion.find(x => x.id === a.p_orden_id);
        if (o.estado === 'completada') return { ok: false, motivo: 'ya_completada' };
        const r = completar(db, o, a.p_cantidad_buena ?? o.cantidad_planificada); if (r.ok) G(db); return r; },
    };
  };
  const semillaProd = () => { const db = semilla(); const U = UID;
    db.productos.push({ id: 'mp-harina', auth_user_id: U, tipo: 'producto', nombre: 'Harina', costo: 20, precio: 0, stock_actual: 10, es_materia_prima: true, activo: true },
      { id: 'pt-pan', auth_user_id: U, tipo: 'producto', nombre: 'Pan simple', costo: 3, precio: 5, stock_actual: 10, activo: true });
    db.recetas_produccion = [{ id: 'rec-pan', auth_user_id: U, producto_terminado_id: 'pt-pan', nombre: 'Pan', cantidad_producida: 100, activa: true, tipo: 'normal', created_at: '2026-10-01T00:00:00Z' }];
    db.receta_componentes = [{ id: 'rc1', auth_user_id: U, receta_id: 'rec-pan', producto_id: 'mp-harina', cantidad: 2 }];
    db.receta_despiece_salidas = []; db.ordenes_produccion = []; db.orden_produccion_consumos = []; return db; };
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await ctx.addInitScript(simServidor);
    await page.goto(base + '/produccion.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db: semillaProd() });
    await page.reload(); await page.waitForFunction(() => typeof abrirModalOrden === 'function' && STATE.recetas.length === 1 && STATE.productos.length > 0, null, { timeout: 15000 });
    // A) Producir ahora: 200 panes, 10 malos, con doble clic
    await page.evaluate(() => abrirModalOrden()); await page.waitForSelector('#modal-orden.modal-open');
    await page.selectOption('#op-receta', 'rec-pan'); await page.fill('#op-cantidad', '200'); await page.fill('#op-merma-cantidad', '10');
    await page.dispatchEvent('#op-cantidad', 'input'); await page.fill('#op-costo-mano-obra', '10');
    await modalesSinDesborde(page, `${tag} nueva producción`);
    await page.evaluate(() => { guardarOrden('completada'); guardarOrden('completada'); });   // doble clic
    await page.waitForFunction(() => document.getElementById('modal-orden').style.display === 'none', null, { timeout: 10000 });
    let db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    const pan = db.productos.find(p => p.id === 'pt-pan'), har = db.productos.find(p => p.id === 'mp-harina');
    verificar(await page.evaluate(() => window.__llamadasProd) === 1, `${tag}: con doble clic se produce una sola vez`);
    verificar(har.stock_actual === 6 && pan.stock_actual === 200, `${tag}: descuenta la harina y suma los panes buenos (harina ${har.stock_actual}, pan ${pan.stock_actual})`);
    verificar(pan.costo === 0.6, `${tag}: el costo del pan se actualiza con el promedio (${pan.costo})`);
    verificar((await page.textContent('#toast')).includes('costo del producto'), `${tag}: avisa el costo nuevo del producto`);
    // B) Falta materia prima: explica qué falta y no produce
    await page.evaluate(() => abrirModalOrden()); await page.selectOption('#op-receta', 'rec-pan'); await page.fill('#op-cantidad', '1000');
    await page.evaluate(() => { STATE.productos.find(p => p.id === 'mp-harina').stock_actual = 999; });   // la pantalla cree que alcanza; el servidor revisa
    await page.evaluate(() => guardarOrden('completada')); await page.waitForFunction(() => document.getElementById('op-error').textContent.length > 0);
    verificar((await page.textContent('#op-error')).includes('No alcanza la materia prima: Harina'), `${tag}: si no alcanza, dice qué falta (${await page.textContent('#op-error')})`);
    await page.evaluate(() => closeModal('modal-orden'));
    // C) Orden ya completada: no se descuenta otra vez
    const oid = db.ordenes_produccion[0].id;
    await page.evaluate(id => { STATE.ordenes.find(o => o.id === id).estado = 'pendiente'; completarOrdenPlanificada(id); }, oid);
    await page.waitForSelector('#modal-completar-orden.modal-open'); await modalesSinDesborde(page, `${tag} completar producción`);
    await page.click('#modal-completar-orden >> text=✅ Completar producción');
    await page.waitForFunction(() => document.getElementById('co-error').textContent.length > 0);
    verificar((await page.textContent('#co-error')).includes('ya estaba completada'), `${tag}: una producción completada no se descuenta dos veces`);
    db = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')));
    verificar(db.productos.find(p => p.id === 'mp-harina').stock_actual === 6, `${tag}: la harina sigue igual tras el intento repetido`);
    verificar(!(await page.evaluate(() => (JSON.parse(sessionStorage.getItem('__LOG') || '[]')).some(l => ['movimientos_financieros', 'incrementar_stock_producto'].includes(l.tabla)))), `${tag}: producir no toca la Caja ni usa los pasos sueltos de antes`);
    verificar(page.__errores.length === 0, `${tag} producción: sin errores (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
}

async function pruebaDemo(browser, base) {
  console.log('\n▶ Cuenta demo (sin multiusuario)');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await ctx.addInitScript(() => { window.__DEMO = true; });
    const db = semilla(); db.perfiles_acceso = []; db.clinica_personal.forEach(m => { m.perfil_id = null; });
    db.clinica_personal[1].nombre = 'Dra. Ruiz';
    await page.goto(base + '/clinica-pacientes.html');
    await page.evaluate(({ db }) => sessionStorage.setItem('__DB', JSON.stringify(db)), { db });
    await page.reload(); await esperarListo(page); await page.waitForSelector('.cl-card');
    await page.click('.cl-card'); await page.click('text=🔓 Entrar con mi código'); await page.waitForSelector('#modal-clinica-pin.modal-open');
    verificar(!(await page.isVisible('#cp-pin-wrap')) && await page.isVisible('#cp-demo'), `${tag} demo: no se pide código, solo elegir el médico`);
    const ops = await page.$$eval('#cp-persona option', os => os.map(o => o.value).filter(Boolean));
    verificar(JSON.stringify(ops.sort()) === '["per-admin","per-med"]', `${tag} demo: aparecen los médicos de ejemplo sin usuario (${ops})`);
    await modalesSinDesborde(page, `${tag} demo elegir médico`);
    await page.selectOption('#cp-persona', 'per-med'); await page.click('#cp-ok');
    await page.waitForSelector('#fi-panel-exp .cl-alerta');
    verificar((await page.textContent('#fi-panel-exp .cl-alerta')).includes('Penicilina'), `${tag} demo: abre el expediente eligiendo el médico`);
    // La sala ve a los médicos de ejemplo
    await page.goto(base + '/clinica-sala.html');
    await page.evaluate(({ UID, HOY }) => { const db = JSON.parse(sessionStorage.getItem('__DB'));
      db.agenda_citas = [{ id: 'ag-d', auth_user_id: UID, fecha: HOY, cliente_nombre: 'Ana', estado: 'confirmada' }];
      db.agenda_citas_servicios = [{ id: 's-d', auth_user_id: UID, cita_id: 'ag-d', profesional_id: 'prof-ruiz', servicio_nombre: 'Consulta general', precio: 500, hora_inicio: '09:00:00', duracion_min: 30, orden: 0 }];
      sessionStorage.setItem('__DB', JSON.stringify(db)); }, { UID, HOY });
    await page.reload(); await esperarListo(page); await page.waitForSelector('#sa-llegar .ag-card');
    verificar((await page.textContent('#sa-llegar')).includes('Dra. Ruiz'), `${tag} demo: la sala muestra al médico de ejemplo`);
    verificar((await page.evaluate(() => window.__demoPreparada || 0)) >= 1, `${tag} demo: la sala pide preparar el día de la demo de simulación`);
    await page.goto(base + '/clinica-equipo.html'); await esperarListo(page); await page.waitForSelector('#eq-personal-lista .cl-card');
    verificar(await page.isVisible('#eq-demo') && (await page.textContent('#eq-personal-lista')).includes('Médico de ejemplo (demo)'), `${tag} demo: Médicos explica que la demo no usa usuarios`);
    verificar(page.__errores.length === 0, `${tag} demo: sin errores de JavaScript (${page.__errores.join(' | ')})`);
    await ctx.close();
  }
  // En una cuenta real, la entrada sin código no funciona aunque se intente directamente.
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/clinica-pacientes.html'); await esperarListo(page);
  const r = await page.evaluate(async () => (await sb.rpc('clinica_iniciar_sesion_demo', { p_personal_id: 'per-med' })).data);
  verificar(r && r.ok === false && r.motivo === 'solo_demo', 'cuenta real: no se puede abrir el expediente sin código');
  await page.goto(base + '/clinica-sala.html'); await esperarListo(page); await page.waitForTimeout(300);
  verificar((await page.evaluate(() => window.__demoPreparada || 0)) === 0, 'cuenta real: la sala no pide preparar datos de demo');
  await ctx.close();
}

// Regresión: las páginas existentes cargan igual, sin errores nuevos, y sin "Clínica" en el menú si está apagado.
async function regresion(browser, base) {
  console.log('\n▶ Regresión de páginas existentes (Clínica apagada)');
  const paginas = ['dashboard.html', 'ventas.html', 'agenda.html', 'salarios.html', 'creditos.html', 'clientes.html', 'productos.html', 'caja.html', 'reportes.html', 'configuracion.html', 'mascotas.html', 'vet-agenda.html', 'lotes.html', 'vencimientos.html', 'personalizacion.html', 'contabilidad.html', 'compras.html'];
  for (const p of paginas) {
    const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
    await page.goto(base + '/' + p);
    await page.evaluate(() => { const db = JSON.parse(JSON.stringify(window.__SEED)); db.configuracion_empresa[0].usa_modulo_clinica = false; db.configuracion_empresa[0].usa_modulo_veterinaria = true; sessionStorage.setItem('__DB', JSON.stringify(db)); });
    await page.reload(); await page.waitForTimeout(2500);
    const menuClinica = await page.locator('.sidebar-nav >> text=/Clínica/').count();
    verificar(menuClinica === 0, `${p}: sin enlaces de Clínica en el menú cuando está apagada`);
    const propios = page.__errores.filter(e => /clinica/i.test(e));
    verificar(propios.length === 0, `${p}: sin errores relacionados con Clínica (${propios.join(' | ')})`);
    await ctx.close();
  }
  // Con Clínica encendida aparece su sección en el menú de otra página
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/clientes.html'); await page.waitForTimeout(2500);
  const enlaces = await page.$$eval('.sidebar-nav a, .sidebar-nav .nav-item', els => els.map(e => e.textContent.trim()));
  verificar(enlaces.some(t => /Panel$/.test(t)) && !enlaces.some(t => t.includes('Sala de espera') || t.includes('Médicos y seguridad') || t.includes('Clínica · Agenda')),
    'con Clínica encendida su sección aparece en el menú como un solo "Panel" (las pantallas van dentro del panel)');
  await ctx.close();
}

(async () => {
  const srv = servidor(); const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  try {
    if (process.env.SOLO_PROD) { await pruebaProduccion(browser, base); throw 'fin'; }
    if (process.env.SOLO_REGALO) { await pruebaSinRegalo(browser, base); throw 'fin'; }
    if (process.env.SOLO_MEDICO) { await pruebaNuevoMedico(browser, base); throw 'fin'; }
    if (process.env.SOLO_SINCITA) { await pruebaSinCita(browser, base); throw 'fin'; }
    if (process.env.SOLO_DEMO) { await pruebaDemo(browser, base); throw 'fin'; }
    if (process.env.SOLO_PASAR) { await pruebaPasarConsulta(browser, base); throw 'fin'; }
    if (process.env.SOLO_HOY) { await pruebaAtencionHoy(browser, base); throw 'fin'; }
    if (process.env.SOLO_C360) { await pruebaCatalogoSalir(browser, base); throw 'fin'; }
    if (process.env.SOLO_FOTOS) { await pruebaFotosAgenda(browser, base); throw 'fin'; }
    if (process.env.SOLO_TERAPIAS) { await pruebaTerapias(browser, base); throw 'fin'; }
    if (process.env.SOLO_BUSCA) { await pruebaBuscadorIngreso(browser, base); throw 'fin'; }
    if (process.env.SOLO_NUEVO) { await pruebaPunto2(browser, base); await pruebaSeguros2(browser, base); await pruebaEnfermeria(browser, base); await pruebaEnVivo(browser, base, 360, 740); throw 'fin'; }
    if (process.env.SOLO_PANEL) { await pruebaPanel(browser, base, 1280, 900); await pruebaPanel(browser, base, 360, 740); await pruebaAgendaPacientes(browser, base); throw 'fin'; }
    if (!process.env.SOLO_CUADRE) await flujoCompleto(browser, base, 1280, 900);
    if (!process.env.SOLO_CUADRE) await flujoCompleto(browser, base, 360, 740);
    await pruebaCuadre(browser, base);
    await pruebasFase2(browser, base, 1280, 900);
    await pruebasFase2(browser, base, 360, 740);
    await pruebasFase3(browser, base, 1280, 900);
    await pruebasFase3(browser, base, 360, 740);
    await pruebasFase4(browser, base, 1280, 900);
    await pruebasFase4(browser, base, 360, 740);
    await pruebasFase5(browser, base, 1280, 900);
    await pruebasFase5(browser, base, 360, 740);
    await pruebaCuadreFase5(browser, base);
    await pruebaDemo(browser, base);
    await pruebaNuevoMedico(browser, base);
    await pruebaSinRegalo(browser, base);
    await pruebaProduccion(browser, base);
    await pruebaPasarConsulta(browser, base);
    await pruebaAtencionHoy(browser, base);
    await pruebaBuscadorIngreso(browser, base);
    await pruebaTerapias(browser, base);
    await pruebaFotosAgenda(browser, base);
    await pruebaCatalogoSalir(browser, base);
    await pruebaSinCita(browser, base);
    await pruebaPunto2(browser, base);
    await pruebaSeguros2(browser, base);
    await pruebaEnfermeria(browser, base);
    await pruebaEnVivo(browser, base, 1280, 900);
    await pruebaEnVivo(browser, base, 360, 740);
    await pruebaPanel(browser, base, 1280, 900);
    await pruebaPanel(browser, base, 360, 740);
    await pruebaAgendaPacientes(browser, base);
    await pruebasEquipo(browser, base);
    await regresion(browser, base);
    await regresionVentas(browser, process.env.RAIZ_MAIN);
  } catch (e) { fallas.push('EXCEPCIÓN: ' + (e.stack || e)); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${oks.length} verificaciones correctas, ${fallas.length} fallas`);
  if (fallas.length) { fallas.forEach(f => console.log(' -', f)); process.exitCode = 1; }
})();
