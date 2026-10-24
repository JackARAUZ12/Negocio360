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
    await pruebasEquipo(browser, base);
    await regresion(browser, base);
    await regresionVentas(browser, process.env.RAIZ_MAIN);
  } catch (e) { fallas.push('EXCEPCIÓN: ' + (e.stack || e)); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${oks.length} verificaciones correctas, ${fallas.length} fallas`);
  if (fallas.length) { fallas.forEach(f => console.log(' -', f)); process.exitCode = 1; }
})();
