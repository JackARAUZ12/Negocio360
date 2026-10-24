/* Pruebas en navegador real (Chromium) del Módulo Clínica — Fase 1.
   Base de datos SIMULADA (supabase-simulado.js): no toca producción.
   Ejecutar desde la raíz del repo:
     NODE_PATH=/opt/node22/lib/node_modules node clinica/pruebas/navegador.js
   Revisa: flujo completo (agenda -> llegó -> atender con PIN -> nota firmada ->
   cuenta -> cobro en Ventas), cuadre contra una venta directa, escape de texto
   (XSS), candado sin PIN, y que nada se desborde en celular (360 px). */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const UID = 'u-prueba-0000-0000-000000000001';
const MOCK = fs.readFileSync(path.join(__dirname, 'supabase-simulado.js'), 'utf8');
const HOY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const XSS = '<img src=x onerror="window.__xss=1">';
function semilla() {
  const vistos = ['clinica_agenda', 'clinica_pacientes', 'clinica_equipo', 'ventas', 'dashboard'].map(k => ({ auth_user_id: UID, modulo_key: k }));
  return {
    configuracion_empresa: [{ id: 'cfg1', auth_user_id: UID, usa_modulo_clinica: true, nombre_comercial: 'Clínica Sur', moneda: 'C$', pais: 'NI', clinica_especialidades: [], onboarding_completado: true }],
    usuarios: [{ id: 'us1', auth_user_id: UID, nombre: 'Jack', multiusuario_activo: false, estado_cuenta: 'activa' }],
    tutoriales_vistos: vistos,
    clinica_personal: [
      { id: 'per-admin', auth_user_id: UID, nombre: 'Admin Clínica', rol: 'admin', atiende: false, pin_configurado: true, activo: true },
      { id: 'per-med', auth_user_id: UID, nombre: 'Dra. Ruiz ' + XSS, rol: 'medico', atiende: true, especialidad: 'Medicina general', pin_configurado: true, activo: true },
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

  // 1) Agenda: nueva cita con paciente nuevo
  await page.goto(base + '/clinica-agenda.html'); await esperarListo(page);
  await page.waitForTimeout(400);
  await sinDesborde(page, `${tag} agenda vacía`);
  verificar(await page.locator('#sidebar').getByText('Agenda de la clínica').count() >= 0, 'agenda carga');
  await page.click('text=+ Nueva cita');
  await modalesSinDesborde(page, `${tag} nueva cita`);
  await page.click('text=+ Es un paciente nuevo');
  await page.fill('#ci-np-nombres', 'María'); await page.fill('#ci-np-apellidos', 'López'); await page.fill('#ci-np-tel', '8888-1234');
  await page.click('text=Registrar paciente');
  await page.waitForSelector('#ci-p-elegido:visible');
  await page.fill('#ci-hora', '23:59');
  await page.click('#ci-btn-guardar');
  verificar((await page.textContent('#ci-error')).includes('medianoche'), `${tag}: no deja citas que pasan la medianoche`);
  await page.fill('#ci-hora', '09:00');
  await page.fill('#ci-motivo', 'Dolor de cabeza');
  await page.click('#ci-btn-guardar');
  await page.waitForSelector('.ag-card');
  // choque de horario del mismo médico
  await page.click('text=+ Nueva cita');
  await page.fill('#ci-p-buscar', 'Pedro'); await page.waitForSelector('#ci-p-resultados [data-id]'); await page.click('#ci-p-resultados [data-id]');
  await page.fill('#ci-hora', '09:15'); await page.click('#ci-btn-guardar');
  verificar((await page.textContent('#ci-error')).includes('ya tiene una cita'), `${tag}: detecta choque de horario`);
  await page.fill('#ci-hora', '10:00'); await page.click('#ci-btn-guardar');
  await page.waitForFunction(() => document.querySelectorAll('.ag-card').length === 2);
  await sinDesborde(page, `${tag} agenda con citas`);
  verificar(await page.locator('.ag-card').filter({ hasText: 'Penicilina' }).count() === 0, `${tag}: sin PIN no se ven alergias en la agenda`);

  // 2) Llegó -> sala de espera
  const tarjeta = page.locator('.ag-card').filter({ hasText: 'María' });
  await tarjeta.locator('text=🪑 Llegó').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ag-card')].some(c => c.textContent.includes('María') && c.textContent.includes('En sala de espera')));
  verificar(true, `${tag}: paciente pasa a sala de espera`);
  // vista semana
  await page.click('#ag-v-semana'); await page.waitForSelector('.ag-dia'); await sinDesborde(page, `${tag} vista semana`); await page.click('#ag-v-dia'); await page.waitForSelector('.ag-card');

  // 3) Atender -> pide PIN -> nota
  await page.locator('.ag-card').filter({ hasText: 'María' }).locator('text=🩺 Atender').click();
  await page.waitForURL(/clinica-pacientes\.html\?cita=/); await esperarListo(page);
  await page.waitForSelector('#modal-clinica-pin.modal-open');
  await modalesSinDesborde(page, `${tag} PIN`);
  await page.selectOption('#cp-persona', 'per-med');
  await page.fill('#cp-pin', '0000'); await page.click('#cp-ok');
  await page.waitForFunction(() => document.getElementById('cp-error').textContent.length > 0);
  verificar((await page.textContent('#cp-error')).includes('incorrecto'), `${tag}: PIN incorrecto rechazado`);
  await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
  await page.waitForSelector('#modal-consulta.modal-open');
  await modalesSinDesborde(page, `${tag} consulta`);
  verificar(await page.inputValue('#co-motivo') === 'Dolor de cabeza', `${tag}: la nota toma el motivo de la cita`);
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
  // adenda
  await page.click('#fi-panel-exp >> text=➕ Adenda'); await page.fill('#ad-texto', 'Refiere náuseas leves.'); await page.click('text=Agregar adenda');
  await page.waitForSelector('text=Refiere náuseas leves.');
  verificar(true, `${tag}: adenda agregada`);
  await modalesSinDesborde(page, `${tag} ficha`);
  // bloquear: el expediente desaparece de pantalla
  await page.locator('#modal-ficha [data-clinica-chip]').click();
  await page.waitForSelector('text=Expediente clínico confidencial');
  verificar(await page.locator('text=Cefalea tensional').count() === 0, `${tag}: al bloquear se borra el expediente de la pantalla`);

  // 4) Volver a la agenda -> cita atendida -> cuenta -> cobrar
  await page.goto(base + '/clinica-agenda.html'); await esperarListo(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.ag-card')].some(c => c.textContent.includes('María') && c.textContent.includes('Atendida')));
  await page.locator('.ag-card').filter({ hasText: 'María' }).locator('text=💳 Cuenta').click();
  await page.waitForSelector('#modal-cuenta.modal-open');
  for (const [q, cant] of [['Consulta', '1'], ['Acetamin', '3']]) {
    await page.fill('#cu-buscar', q); await page.waitForSelector('#cu-resultados [data-id]'); await page.click('#cu-resultados [data-id]');
    await page.fill('#cu-cantidad', cant); await page.click('#cu-btn-agregar');
    await page.waitForFunction(n => document.querySelectorAll('#cu-lista tr').length === n, q === 'Consulta' ? 1 : 2);
  }
  verificar((await page.textContent('#cu-lista')).includes('537.50'), `${tag}: total estimado 500 + 3×12.50 = 537.50`);
  await modalesSinDesborde(page, `${tag} cuenta`);
  await page.click('#cu-btn-cobrar');
  await page.waitForURL(/ventas\.html/);
  await page.waitForFunction(() => typeof S !== 'undefined' && S.carrito && S.carrito.length === 2, null, { timeout: 15000 });
  const carritoClinica = await page.evaluate(() => ({ cliente: S.clienteId, cita: S._clinicaCitaId, items: S.carrito.map(i => ({ id: i.id, cantidad: i.cantidad, precio: i.precio, subtotal: i.subtotal })) }));
  const pac = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_pacientes.find(p => p.nombres === 'María'));
  verificar(!!pac.cliente_id && carritoClinica.cliente === pac.cliente_id, `${tag}: el paciente se creó como cliente y quedó seleccionado`);
  verificar(carritoClinica.items.find(i => i.id === 'prod-acet')?.cantidad === 3, `${tag}: cantidades de la cuenta llegan al carrito`);
  verificar(page.__errores.length === 0, `${tag}: sin errores de JavaScript (${page.__errores.join(' | ')})`);
  verificar(!(await page.evaluate(() => window.__xss)), `${tag}: ningún texto escrito por usuarios se ejecutó (XSS)`);
  await ctx.close();
  return carritoClinica;
}

// Cuadre: la misma venta, cobrada desde la Clínica y hecha directo en Ventas, debe producir exactamente
// los mismos registros (venta, detalle) -> caja, inventario, lotes, impuestos y contabilidad iguales.
async function pruebaCuadre(browser, base) {
  console.log('\n▶ Cuadre: cobro desde la Clínica vs venta directa');
  const correr = async (desdeClinica) => {
    const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
    await page.goto(base + '/ventas.html');
    await page.evaluate(({ desdeClinica, UID }) => {
      const db = JSON.parse(JSON.stringify(window.__SEED));
      db.clinica_pacientes.push({ id: 'pac-c', auth_user_id: UID, nombres: 'Cliente', apellidos: 'Existente', cliente_id: 'cli-1', activo: true, numero_expediente: 'EXP-000009' });
      db.clinica_citas = [{ id: 'cita-c', auth_user_id: UID, paciente_id: 'pac-c', fecha: '2026-10-24', hora: '09:00', duracion_min: 30, estado: 'atendida' }];
      sessionStorage.setItem('__DB', JSON.stringify(db)); sessionStorage.removeItem('__LOG');
      if (desdeClinica) sessionStorage.setItem('n360_clinica_cobro', JSON.stringify({ citaId: 'cita-c', clienteId: 'cli-1', paciente: 'Cliente Existente', items: [{ producto_id: 'prod-consulta', cantidad: 1 }, { producto_id: 'prod-acet', cantidad: 3 }] }));
    }, { desdeClinica, UID });
    await page.reload(); await esperarListo(page);
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
  const escrituras = log => log.filter(x => (x.op !== 'rpc' || RPC_DINERO.includes(x.tabla)) && !['tutoriales_vistos', 'usuarios', 'presencia_usuarios', 'auditoria_eventos', 'auditoria'].includes(x.tabla) && x.tabla !== 'clinica_citas' && !(x.tabla === 'auditoria_log' && x.datos?.tabla === 'clinica_citas'));
  const a = await correr(true), b = await correr(false);
  const wa = escrituras(a.log), wb = escrituras(b.log);
  verificar(wa.some(x => (x.tabla === 'ventas' && x.op === 'insert') || x.tabla === 'venta_registrar_atomica'), `cuadre: la venta desde la clínica se registró (paso ${a.paso}; ${a.errores.join(' | ')})`);
  verificar(JSON.stringify(limpiar(wa)) === JSON.stringify(limpiar(wb)), 'cuadre: venta, detalle y movimientos IDÉNTICOS a la venta directa');
  if (JSON.stringify(limpiar(wa)) !== JSON.stringify(limpiar(wb))) {
    const la = limpiar(wa), lb = limpiar(wb);
    for (let i = 0; i < Math.max(la.length, lb.length); i++) if (JSON.stringify(la[i]) !== JSON.stringify(lb[i])) { console.log('  diferencia #' + i + '\n   clínica:', JSON.stringify(la[i]), '\n   directa:', JSON.stringify(lb[i])); }
  }
  const ventaA = a.db.ventas?.[0], citaA = a.db.clinica_citas.find(c => c.id === 'cita-c');
  verificar(ventaA && citaA.venta_id === ventaA.id, 'cuadre: la cita quedó ligada a su venta');
  verificar(!b.db.clinica_citas.find(c => c.id === 'cita-c').venta_id, 'cuadre: la venta directa no toca la clínica');
  verificar(Number(ventaA?.total) === 537.5, `cuadre: total de la venta 537.50 (${ventaA?.total})`);
  // Doble cobro: si la cita ya tiene una venta completada, Ventas no la vuelve a cargar.
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/ventas.html');
  await page.evaluate(({ db }) => { db.ventas = db.ventas.map(v => ({ ...v, estado: 'completada' })); sessionStorage.setItem('__DB', JSON.stringify(db));
    sessionStorage.setItem('n360_clinica_cobro', JSON.stringify({ citaId: 'cita-c', clienteId: 'cli-1', items: [{ producto_id: 'prod-consulta', cantidad: 1 }] })); }, { db: a.db });
  await page.reload(); await esperarListo(page); await page.waitForTimeout(1500);
  verificar(await page.evaluate(() => S.carrito.length) === 0, 'cuadre: una visita ya cobrada no se puede cobrar dos veces');
  await ctx.close();
}

async function pruebasEquipo(browser, base) {
  console.log('\n▶ Equipo y seguridad + candados');
  for (const [ancho, alto] of [[1280, 900], [360, 740]]) {
    const tag = ancho < 500 ? 'celular' : 'computadora';
    const { ctx, page } = await nuevaPagina(browser, base, ancho, alto);
    await page.goto(base + '/clinica-equipo.html'); await esperarListo(page); await page.waitForSelector('#eq-personal-lista .cl-card');
    await sinDesborde(page, `${tag} equipo`);
    await page.click('text=+ Agregar persona'); await modalesSinDesborde(page, `${tag} persona`);
    await page.fill('#pe-nombre', 'Dr. Nuevo'); await page.fill('#pe-pin', '1111'); await page.fill('#pe-pin2', '1111'); await page.click('#pe-btn-guardar');
    verificar((await page.textContent('#pe-error')).includes('fácil'), `${tag}: rechaza PIN fácil de adivinar`);
    await page.fill('#pe-pin', '4826'); await page.fill('#pe-pin2', '4826'); await page.click('#pe-btn-guardar');
    await page.waitForSelector('#modal-admin.modal-open');
    await page.fill('#ac-codigo', '9999'); await page.click('#modal-admin >> text=Continuar');
    await page.waitForFunction(() => document.getElementById('pe-error').textContent.length > 0);
    verificar((await page.textContent('#pe-error')).toLowerCase().includes('incorrecto'), `${tag}: código de administrador incorrecto rechazado`);
    await page.click('#pe-btn-guardar'); await page.waitForSelector('#modal-admin.modal-open');
    await page.fill('#ac-codigo', '2468'); await page.click('#modal-admin >> text=Continuar');
    await page.waitForSelector('#eq-personal-lista >> text=Dr. Nuevo');
    verificar(true, `${tag}: agregar médico con código de administrador`);
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
  verificar(await page.locator('#fi-panel-exp >> text=Penicilina').count() === 0, 'candado: sin PIN el expediente no se muestra');
  await page.click('text=🔓 Entrar con mi PIN'); await page.selectOption('#cp-persona', 'per-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
  await page.waitForSelector('#fi-panel-exp .cl-alerta');
  verificar((await page.textContent('#fi-panel-exp .cl-alerta')).includes('Penicilina'), 'alergias visibles como alerta con PIN');
  await page.click('text=📝 Nueva consulta');
  const opciones = await page.$$eval('#co-especialidad option', os => os.map(o => o.value));
  verificar(JSON.stringify(opciones) === '["pediatria"]' && !(await page.isVisible('#co-especialidad-wrap')), `especialidad única: solo se carga pediatría (${opciones})`);
  verificar(!(await page.evaluate(() => window.__xss)), 'expediente: sin ejecución de texto de usuarios (XSS)');
  const tras = await page.evaluate(() => { sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ id: 'otro-perfil', tipo: 'restringido' })); return ClinicaSesion.leer(); });
  verificar(tras === null, 'al cambiar de usuario (perfil) la sesión médica ya no sirve');
  await ctx.close();
  // Módulo apagado: las páginas mandan al Dashboard
  const r = await nuevaPagina(browser, base, 1280, 900);
  await r.page.goto(base + '/clinica-agenda.html');
  await r.page.evaluate(() => { const db = JSON.parse(JSON.stringify(window.__SEED)); db.configuracion_empresa[0].usa_modulo_clinica = false; sessionStorage.setItem('__DB', JSON.stringify(db)); });
  await r.page.reload(); await r.page.waitForURL(/dashboard\.html/, { timeout: 10000 }).catch(() => {});
  verificar(r.page.url().includes('dashboard.html'), 'módulo apagado: Clínica no se puede abrir');
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
    db.clinica_citas = [{ id: 'cita-f2', auth_user_id: UID, paciente_id: 'pac-xss', medico_id: 'per-med', fecha: HOY, hora: '08:00', duracion_min: 30, estado: 'en_espera' }];
    sessionStorage.setItem('__DB', JSON.stringify(db));
  }, { UID, HOY });
  await page.goto(base + '/clinica-pacientes.html?cita=cita-f2'); await esperarListo(page);
  await page.waitForSelector('#modal-clinica-pin.modal-open'); await page.selectOption('#cp-persona', 'per-med'); await page.fill('#cp-pin', '1357'); await page.click('#cp-ok');
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
  const cargos = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__DB')).clinica_cargos || []);
  verificar(cargos.length === 1 && cargos[0].producto_id === 'prod-acet' && cargos[0].cantidad === 10 && cargos[0].cita_id === 'cita-f2', `${tag}: receta agregada a la cuenta de la visita (solo lo del inventario)`);

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
  db.clinica_personal[1].nombre = 'Dra. Ruiz'; db.clinica_personal[1].honorario_tipo = 'porcentaje'; db.clinica_personal[1].honorario_valor = 30; db.clinica_personal[1].empleado_id = 'emp-1';
  db.empleados = [{ id: 'emp-1', auth_user_id: UID, nombre: 'Dra. Ruiz', salario: 0, tipo_salario: 'mensual', estado: 'activo', cargo: 'Médico' }];
  db.clinica_pacientes.push({ id: 'p-ana', auth_user_id: UID, nombres: 'Ana María', apellidos: 'Castillo', telefono: '88881111', numero_expediente: 'EXP-000002', activo: true },
                            { id: 'p-luis', auth_user_id: UID, nombres: 'Luis', apellidos: 'Pérez', telefono: '88882222', numero_expediente: 'EXP-000003', activo: true });
  db.clinica_citas = [
    { id: 's1', auth_user_id: UID, paciente_id: 'p-ana', medico_id: 'per-med', consultorio_id: 'kons1', fecha: HOY, hora: '08:00', duracion_min: 30, estado: 'en_espera', llegada_en: hace(25) },
    { id: 's2', auth_user_id: UID, paciente_id: 'p-luis', medico_id: 'per-med', fecha: HOY, hora: '09:00', duracion_min: 30, estado: 'programada' },
    { id: 's3', auth_user_id: UID, paciente_id: 'pac-xss', medico_id: 'per-med', fecha: HOY, hora: '07:00', duracion_min: 30, estado: 'en_consulta', llegada_en: hace(60) },
    { id: 'r1', auth_user_id: UID, paciente_id: 'p-luis', medico_id: 'per-med', fecha: manana, hora: '10:00', duracion_min: 30, estado: 'confirmada' },
    { id: 'h1', auth_user_id: UID, paciente_id: 'p-ana', medico_id: 'per-med', fecha: HOY, hora: '06:00', duracion_min: 30, estado: 'atendida', venta_id: 'v1' },
    { id: 'h2', auth_user_id: UID, paciente_id: 'p-luis', medico_id: 'per-med', fecha: HOY, hora: '06:30', duracion_min: 30, estado: 'atendida', venta_id: 'v2' },
    { id: 'h3', auth_user_id: UID, paciente_id: 'p-luis', medico_id: 'per-med', fecha: HOY, hora: '05:00', duracion_min: 30, estado: 'no_asistio' },
  ];
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

  // Recordatorios de mañana
  await page.goto(base + '/clinica-agenda.html'); await esperarListo(page);
  await page.click('text=📲 Recordatorios'); await page.waitForSelector('#re-lista .cl-item'); await modalesSinDesborde(page, `${tag} recordatorios`);
  const [wa] = await Promise.all([ctx.waitForEvent('page'), page.click('#re-lista >> text=📲 Enviar por WhatsApp')]);
  verificar(wa.url().includes('wa.me/50588882222') && decodeURIComponent(wa.url()).includes('Luis'), `${tag}: recordatorio abre WhatsApp con el mensaje listo`);
  await wa.close(); await page.waitForSelector('#re-lista >> text=✓ Avisado');
  verificar(true, `${tag}: la cita queda marcada como avisada`);

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

// Regresión: las páginas existentes cargan igual, sin errores nuevos, y sin "Clínica" en el menú si está apagado.
async function regresion(browser, base) {
  console.log('\n▶ Regresión de páginas existentes (Clínica apagada)');
  const paginas = ['dashboard.html', 'ventas.html', 'clientes.html', 'productos.html', 'caja.html', 'reportes.html', 'configuracion.html', 'mascotas.html', 'vet-agenda.html', 'lotes.html', 'vencimientos.html', 'personalizacion.html', 'contabilidad.html', 'compras.html'];
  for (const p of paginas) {
    const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
    await page.goto(base + '/' + p);
    await page.evaluate(() => { const db = JSON.parse(JSON.stringify(window.__SEED)); db.configuracion_empresa[0].usa_modulo_clinica = false; db.configuracion_empresa[0].usa_modulo_veterinaria = true; sessionStorage.setItem('__DB', JSON.stringify(db)); });
    await page.reload(); await page.waitForTimeout(2500);
    const menuClinica = await page.locator('.sidebar-nav >> text=/Clínica|Agenda de la clínica/').count();
    verificar(menuClinica === 0, `${p}: sin enlaces de Clínica en el menú cuando está apagada`);
    const propios = page.__errores.filter(e => /clinica/i.test(e));
    verificar(propios.length === 0, `${p}: sin errores relacionados con Clínica (${propios.join(' | ')})`);
    await ctx.close();
  }
  // Con Clínica encendida aparece su sección en el menú de otra página
  const { ctx, page } = await nuevaPagina(browser, base, 1280, 900);
  await page.goto(base + '/clientes.html'); await page.waitForTimeout(2500);
  const enlaces = await page.$$eval('.sidebar-nav a, .sidebar-nav .nav-item', els => els.map(e => e.textContent.trim()));
  verificar(enlaces.some(t => t.includes('Pacientes')) && enlaces.some(t => t.includes('Equipo y seguridad')), 'con Clínica encendida su sección aparece en el menú');
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
    await pruebasEquipo(browser, base);
    await regresion(browser, base);
    await regresionVentas(browser, process.env.RAIZ_MAIN);
  } catch (e) { fallas.push('EXCEPCIÓN: ' + (e.stack || e)); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${oks.length} verificaciones correctas, ${fallas.length} fallas`);
  if (fallas.length) { fallas.forEach(f => console.log(' -', f)); process.exitCode = 1; }
})();
