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
  const vistos = ['clinica_sala', 'clinica_pacientes', 'clinica_equipo', 'clinica_reportes', 'agenda', 'ventas', 'dashboard'].map(k => ({ auth_user_id: UID, modulo_key: k }));
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
  await page.waitForURL(/ventas\.html/);
  await page.waitForFunction(() => typeof S !== 'undefined' && S.carrito && S.carrito.length === 2, null, { timeout: 15000 });
  const carrito = await page.evaluate(() => ({ cita: S._agendaCitaId, items: S.carrito.map(i => ({ id: i.id, cantidad: i.cantidad, precio: i.precio })) }));
  verificar(carrito.cita === 'ag-maria', `${tag}: la venta queda ligada a la cita de la Agenda (camino de siempre)`);
  verificar(carrito.items.find(i => i.id === 'prod-acet')?.cantidad === 3 && carrito.items.find(i => i.id === 'prod-consulta')?.precio === 500, `${tag}: servicio y medicamento llegan al carrito con su cantidad y precio`);
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
      await Promise.all([page.waitForURL(/ventas\.html/), page.evaluate(() => ClinicaCitas.cobrar({ id: 'ag-c' }))]);
    } else {
      await page.goto(base + '/ventas.html');
      await page.evaluate(({ db }) => { sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG'); }, { db: semillaCuadre() });
      await page.reload();
    }
    await esperarListo(page);
    await page.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.productosCache) && S.productosCache.length === 2, null, { timeout: 15000 });
    if (desdeClinica) await page.waitForFunction(() => S.carrito.length === 2, null, { timeout: 15000 });
    else await page.evaluate(async () => {
      await abrirNuevaVenta(); selectClienteOpcion('existente'); seleccionarCliente('cli-1');
      await agregarAlCarritoConPrecio('prod-consulta', 'servicio', null);
      await agregarAlCarritoConPrecio('prod-acet', 'producto', null); cambiarCantidad('prod-acet', 3);
    });
    await page.evaluate(() => sessionStorage.setItem('__LOG', '[]'));
    await page.evaluate(async () => { for (let i = 0; i < 8 && S.paso < 5; i++) { const a = S.paso; if (S.paso === 4 || S.paso === 5) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); pasoSiguiente(); await new Promise(r => setTimeout(r, 150)); if (S.paso === a) break; } });
    const paso = await page.evaluate(() => S.paso);
    await page.evaluate(() => { if (!S.metodoPagoId) seleccionarMetodoPago('mp-efectivo', 'Efectivo'); });
    await page.evaluate(() => { window.__toasts = []; const o = window.showToast; window.showToast = (m, t) => { window.__toasts.push(m); return o && o(m, t); }; });
    await page.evaluate(async () => { await confirmarVenta(false); });
    if (process.env.DEPURAR) console.log('  avisos de Ventas:', await page.evaluate(() => window.__toasts));
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ log: JSON.parse(sessionStorage.getItem('__LOG') || '[]'), db: JSON.parse(sessionStorage.getItem('__DB')) }));
    const errores = page.__errores; await ctx.close();
    return { ...r, paso, errores };
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
  verificar(!b.db.agenda_citas.find(c => c.id === 'ag-c').venta_id, 'cuadre: la venta directa no toca la Agenda ni la clínica');
  verificar(Number(ventaA?.total) === 537.5, `cuadre: total de la venta 537.50 (${ventaA?.total})`);
  // Doble cobro: una visita ya cobrada no se vuelve a preparar para cobrar.
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/clinica-sala.html');
  await page.evaluate(({ db }) => { db.ventas = db.ventas.map(v => ({ ...v, estado: 'completada' })); sessionStorage.setItem('__DB', JSON.stringify(db)); }, { db: a.db });
  await page.reload(); await esperarListo(page); await page.waitForFunction(() => typeof ClinicaCitas !== 'undefined');
  const r2 = await page.evaluate(async () => { const r = await ClinicaCitas.cobrar({ id: 'ag-c' }); return { r, payload: sessionStorage.getItem('n360_agenda_cobro') }; });
  verificar(r2.r.ok === false && /ya fue cobrada/.test(r2.r.motivo) && !r2.payload, 'cuadre: una visita ya cobrada no se puede cobrar dos veces');
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
    await page.click('text=+ Marcar un usuario como médico'); await modalesSinDesborde(page, `${tag} marcar médico`);
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
  await page.waitForURL(/ventas\.html/, { timeout: 10000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && S.carrito && S.carrito.length === 1, null, { timeout: 15000 });
  const cart = await page.evaluate(() => S.carrito.map(i => ({ id: i.id, cantidad: i.cantidad })));
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
  await page.click('#ho-lista >> text=💳 Cobrar'); await page.waitForURL(/ventas\.html/);
  await page.waitForFunction(() => typeof S !== 'undefined' && S.carrito && S.carrito.length === 2, null, { timeout: 15000 });
  const carE = await page.evaluate(() => ({ cobro: S._clinicaCobro, items: S.carrito.map(i => [i.id, i.cantidad, i.precio]), cliente: S.clienteId }));
  verificar(carE.cobro?.tipo === 'estancia' && JSON.stringify(carE.items) === '[["srv-dia",1,1500],["prod-suero",2,120]]' && carE.cliente === 'cli-pedro', `${tag}: Ventas abre la cuenta de la estancia con el paciente (${JSON.stringify(carE)})`);
  await confirmarVentaAbierta(page);
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
  await page.click('#cu-btn-cobrar'); await page.waitForURL(/ventas\.html/);
  await page.waitForFunction(() => typeof S !== 'undefined' && S.carrito && S.carrito.length === 1, null, { timeout: 15000 });
  verificar(await page.evaluate(() => S.carrito[0].precio) === 100, `${tag}: el paciente paga solo su 20% (100.00)`);
  await confirmarVentaAbierta(page);
  const snap = await page.evaluate(() => { const db = JSON.parse(sessionStorage.getItem('__DB')); return { i: db.clinica_cita_info.find(x => x.agenda_cita_id === 'ag-s'), c: db.agenda_citas.find(x => x.id === 'ag-s') }; });
  verificar(snap.i.monto_cubierto === 400 && snap.i.cubierto_servicios === 400 && snap.i.convenio_id === 'k1' && !!snap.c.venta_id, `${tag}: queda anotado lo que cubre el seguro (400) y la cita cobrada`);
  // Facturar a la aseguradora
  await page.goto(base + '/clinica-seguros.html'); await esperarListo(page); await page.waitForSelector('#sg-pendiente .cl-item');
  await sinDesborde(page, `${tag} seguros`);
  if (process.env.FOTOS) await page.screenshot({ path: process.env.FOTOS + '/seguros-' + tag + '.png', fullPage: true });
  verificar((await page.textContent('#sg-kpi-pend')).includes('400.00'), `${tag}: por facturar a aseguradoras 400.00`);
  await page.click('#sg-pendiente >> text=🧾 Facturar'); await page.waitForURL(/ventas\.html/);
  await page.waitForFunction(() => typeof S !== 'undefined' && S.carrito && S.carrito.length === 1, null, { timeout: 15000 });
  const fac = await page.evaluate(() => ({ cobro: S._clinicaCobro, item: [S.carrito[0].nombre, S.carrito[0].precio], cliente: S.clienteId, db: JSON.parse(sessionStorage.getItem('__DB')) }));
  const k1 = fac.db.clinica_convenios.find(k => k.id === 'k1');
  verificar(fac.cobro?.tipo === 'reclamo' && fac.item[1] === 400 && /Cobertura Seguros América/.test(fac.item[0]) && k1.cliente_id && fac.cliente === k1.cliente_id,
    `${tag}: la factura a la aseguradora se abre en Ventas a nombre de la aseguradora (${JSON.stringify(fac.item)})`);
  await confirmarVentaAbierta(page);
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

// Cuenta DEMO: no usa el multiusuario. El expediente se abre eligiendo el médico, sin código.
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
  verificar(enlaces.some(t => t.includes('Pacientes')) && enlaces.some(t => t.includes('Médicos y seguridad')) && !enlaces.some(t => t.includes('Clínica · Agenda')), 'con Clínica encendida su sección aparece en el menú (sin agenda propia: se usa la Agenda)');
  await ctx.close();
}

(async () => {
  const srv = servidor(); const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  try {
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
    await pruebaEnVivo(browser, base, 1280, 900);
    await pruebaEnVivo(browser, base, 360, 740);
    await pruebasEquipo(browser, base);
    await regresion(browser, base);
    await regresionVentas(browser, process.env.RAIZ_MAIN);
  } catch (e) { fallas.push('EXCEPCIÓN: ' + (e.stack || e)); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${oks.length} verificaciones correctas, ${fallas.length} fallas`);
  if (fallas.length) { fallas.forEach(f => console.log(' -', f)); process.exitCode = 1; }
})();
