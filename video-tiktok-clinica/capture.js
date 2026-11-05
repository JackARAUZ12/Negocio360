// Captures REAL Negocio360 clinic screens (repo pages + simulated Supabase from clinica/pruebas) for the TikTok video.
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const HERE = __dirname, OUT = path.join(HERE, 'shots');
const UID = 'u-prueba-0000-0000-000000000001';
const MOCK = fs.readFileSync(path.join(RAIZ, 'clinica/pruebas/supabase-simulado.js'), 'utf8');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOY = ymd(new Date());
const MANANA = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); })();
const hace = min => new Date(Date.now() - min * 60000).toISOString();

const MED = [
  ['ruiz', 'Dra. Ana Ruiz', 'medicina_general', 'k1'], ['mendez', 'Dr. Carlos Méndez', 'pediatria', 'k2'],
  ['torres', 'Dra. Sofía Torres', 'odontologia', 'k3'], ['vega', 'Lic. Paula Vega', 'fisioterapia', 'k4'],
];
const PAC = [
  ['maria', 'María José', 'López', '8845-1203', '1991-03-14', 'F', 'Penicilina'], ['pedro', 'Pedro', 'Gómez', '8763-2290', '1978-07-02', 'M', ''],
  ['ana', 'Ana Lucía', 'Castillo', '8821-4410', '1988-11-23', 'F', ''], ['luis', 'Luis', 'Pérez', '8932-1188', '1965-01-30', 'M', 'Sulfas'],
  ['sofia', 'Sofía', 'Martínez', '8710-5521', '1995-06-09', 'F', ''], ['daniel', 'Daniel', 'Rivas', '8654-7733', '2019-04-18', 'M', ''],
  ['carmen', 'Carmen', 'Ortega', '8890-6612', '1957-09-05', 'F', 'AINES'], ['jorge', 'Jorge', 'Herrera', '8577-3349', '1983-12-12', 'M', ''],
  ['valeria', 'Valeria', 'Cruz', '8466-2875', '2001-02-27', 'F', ''], ['roberto', 'Roberto', 'Salinas', '8399-1456', '1970-08-19', 'M', ''],
];
function semilla() {
  const db = {
    configuracion_empresa: [{ id: 'cfg1', auth_user_id: UID, usa_modulo_clinica: true, nombre_comercial: 'Centro Médico San Rafael', direccion: 'Managua, Nicaragua', telefono: '2250-4400', moneda: 'C$', pais: 'NI', clinica_especialidades: [], onboarding_completado: true }],
    usuarios: [{ id: 'us1', auth_user_id: UID, nombre: 'Centro Médico San Rafael', multiusuario_activo: false, estado_cuenta: 'activa' }],
    tutoriales_vistos: ['clinica_panel', 'clinica_sala', 'clinica_pacientes', 'clinica_equipo', 'clinica_reportes', 'clinica_hospital', 'clinica_seguros', 'agenda', 'ventas', 'dashboard'].map(k => ({ auth_user_id: UID, modulo_key: k })),
    perfiles_acceso: [{ id: 'perf-admin', auth_user_id: UID, nombre: 'Dirección', tipo: 'admin', activo: true, es_principal: true }, { id: 'perf-recep', auth_user_id: UID, nombre: 'Recepción', tipo: 'restringido', activo: true }],
    agenda_profesionales: [], clinica_personal: [{ id: 'per-admin', auth_user_id: UID, perfil_id: 'perf-admin', nombre: 'Dirección', rol: 'admin', activo: true, honorario_tipo: 'ninguno', honorario_valor: 0 }],
    clinica_consultorios: [['k1', 'Consultorio 1'], ['k2', 'Consultorio 2'], ['k3', 'Consultorio dental'], ['k4', 'Gimnasio']].map(([id, nombre]) => ({ id, auth_user_id: UID, nombre, activo: true })),
    clinica_pacientes: [], clinica_antecedentes: [], clientes: [],
    productos: [
      ['prod-consulta', 'Consulta general', 'servicio', 600], ['prod-pedia', 'Consulta pediátrica', 'servicio', 700], ['prod-dental', 'Limpieza dental', 'servicio', 900],
      ['prod-fisio', 'Sesión de fisioterapia', 'servicio', 500], ['prod-ultra', 'Ultrasonido obstétrico', 'servicio', 1200],
      ['prod-amox', 'Amoxicilina 500 mg', 'producto', 18], ['prod-acet', 'Acetaminofén 500 mg', 'producto', 12.5], ['prod-ibu', 'Ibuprofeno 400 mg', 'producto', 10],
    ].map(([id, nombre, tipo, precio]) => ({ id, auth_user_id: UID, nombre, tipo, precio, costo: tipo === 'producto' ? precio / 2 : 0, stock_actual: tipo === 'producto' ? 240 : 0, activo: true, tipo_precio: 'fijo', es_sustancia_controlada: false })),
    metodos_pago: [{ id: 'mp-efectivo', auth_user_id: UID, nombre: 'Efectivo', activo: true, tipo: 'efectivo' }, { id: 'mp-tarjeta', auth_user_id: UID, nombre: 'Tarjeta', activo: true, tipo: 'tarjeta' }],
    clinica_convenios: [{ id: 'conv1', auth_user_id: UID, nombre: 'Seguros América', tipo: 'aseguradora', cobertura_pct: 80, activo: true }],
    empleados: [], agenda_citas: [], agenda_citas_servicios: [], clinica_cita_info: [], ventas: [], venta_detalles: [], clinica_consultas: [],
  };
  MED.forEach(([k, nombre, esp, kons], i) => {
    db.perfiles_acceso.push({ id: 'perf-' + k, auth_user_id: UID, nombre, tipo: 'restringido', activo: true });
    db.agenda_profesionales.push({ id: 'prof-' + k, auth_user_id: UID, nombre, activo: true, orden: i, empleado_id: 'emp-' + k, perfil_id: 'perf-' + k });
    db.clinica_personal.push({ id: 'per-' + k, auth_user_id: UID, perfil_id: 'perf-' + k, nombre, rol: 'medico', especialidad: esp, consultorio_id: kons, activo: true, agenda_profesional_id: 'prof-' + k, honorario_tipo: 'porcentaje', honorario_valor: 30, empleado_id: 'emp-' + k, registro: String(18000 + i * 731) });
    db.empleados.push({ id: 'emp-' + k, auth_user_id: UID, nombre, salario: 0, tipo_salario: 'mensual', estado: 'activo', cargo: 'Médico' });
  });
  PAC.forEach(([k, nombres, apellidos, tel, nac, sx, alergia], i) => { const sexo = sx === 'F' ? 'femenino' : 'masculino';
    db.clientes.push({ id: 'cli-' + k, auth_user_id: UID, nombre: nombres, apellido: apellidos, telefono: tel, activo: true });
    db.clinica_pacientes.push({ id: 'p-' + k, auth_user_id: UID, nombres, apellidos, telefono: tel, fecha_nacimiento: nac, sexo, cedula: `001-${nac.slice(8, 10)}${nac.slice(5, 7)}${nac.slice(2, 4)}-00${41 + i}K`, numero_expediente: 'EXP-' + String(1201 + i).padStart(6, '0'), activo: true, cliente_id: 'cli-' + k, created_at: HOY + 'T08:00:00Z', convenio_id: k === 'maria' ? 'conv1' : null, poliza: k === 'maria' ? 'SA-77812' : null, poliza_vence: '2099-12-31' });
    if (alergia) db.clinica_antecedentes.push({ paciente_id: 'p-' + k, alergias: alergia, patologicos: k === 'luis' ? 'Hipertensión arterial (2015)' : '', quirurgicos: '', familiares: 'Madre: diabetes tipo 2' });
  });
  const cita = (id, pac, prof, hora, estado, prod, precio, extra = {}) => {
    const p = PAC.find(x => x[0] === pac);
    db.agenda_citas.push({ id, auth_user_id: UID, fecha: extra.fecha || HOY, cliente_id: 'cli-' + pac, cliente_nombre: p[1] + ' ' + p[2], cliente_telefono: p[3], estado, notas: extra.notas || null, venta_id: extra.venta_id || null });
    db.agenda_citas_servicios.push({ id: 'srv-' + id, auth_user_id: UID, cita_id: id, profesional_id: 'prof-' + prof, producto_id: prod, servicio_nombre: db.productos.find(x => x.id === prod).nombre, precio, hora_inicio: hora + ':00', duracion_min: extra.dur || 30, orden: 0 });
  };
  cita('c1', 'maria', 'ruiz', '09:00', 'confirmada', 'prod-consulta', 600, { notas: 'Dolor de cabeza y mareos' });
  cita('c2', 'pedro', 'ruiz', '09:30', 'confirmada', 'prod-consulta', 600);
  cita('c3', 'ana', 'ruiz', '10:30', 'reservada', 'prod-consulta', 600);
  cita('c4', 'daniel', 'mendez', '08:30', 'en_atencion', 'prod-pedia', 700);
  cita('c5', 'valeria', 'mendez', '10:00', 'confirmada', 'prod-pedia', 700);
  cita('c6', 'jorge', 'torres', '09:00', 'confirmada', 'prod-dental', 900, { dur: 60 });
  cita('c7', 'carmen', 'vega', '08:00', 'completada', 'prod-fisio', 500, { venta_id: 'v1', dur: 60 });
  cita('c8', 'roberto', 'vega', '11:00', 'reservada', 'prod-fisio', 500, { dur: 60 });
  cita('c9', 'sofia', 'ruiz', '11:30', 'reservada', 'prod-ultra', 1200);
  cita('c10', 'luis', 'mendez', '11:30', 'reservada', 'prod-pedia', 700);
  cita('m1', 'luis', 'ruiz', '08:00', 'confirmada', 'prod-consulta', 600, { fecha: MANANA });
  cita('m2', 'ana', 'ruiz', '09:00', 'confirmada', 'prod-consulta', 600, { fecha: MANANA });
  cita('m3', 'carmen', 'vega', '10:00', 'confirmada', 'prod-fisio', 500, { fecha: MANANA });
  const info = (cid, pac, kons, o) => db.clinica_cita_info.push({ agenda_cita_id: cid, auth_user_id: UID, paciente_id: 'p-' + pac, consultorio_id: kons, ...o });
  info('c1', 'maria', 'k1', { llegada_en: hace(14) }); info('c2', 'pedro', 'k1', { llegada_en: hace(6) });
  info('c4', 'daniel', 'k2', { llegada_en: hace(32), llamado_en: hace(20), atendida_en: null });
  info('c6', 'jorge', 'k3', { llegada_en: hace(3) }); info('c7', 'carmen', 'k4', { llegada_en: hace(130), atendida_en: hace(70) });
  db.ventas.push({ id: 'v1', auth_user_id: UID, numero_venta: 'V-00412', estado: 'completada', total: 500 });
  db.venta_detalles.push({ venta_id: 'v1', auth_user_id: UID, producto_nombre: 'Sesión de fisioterapia', tipo_item: 'servicio', cantidad: 1, subtotal: 500 });
  return db;
}

function servidor() {
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  return http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    const f = u.startsWith('/__v/') ? path.join(HERE, 'vendor', u.slice(5)) : path.join(RAIZ, u);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(8790);
}
const BASE = 'http://localhost:8790';
async function pagina(browser, w, h, db, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.dpr || 2, isMobile: w < 500, hasTouch: w < 900 });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (u.includes('lucide')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(HERE, 'vendor/lucide.js')) });
    if (u.includes('fonts.googleapis.com')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(HERE, 'vendor/fonts.css')) });
    if (u.endsWith('.js')) return r.fulfill({ contentType: 'application/javascript', body: '' });
    return r.fulfill({ contentType: 'text/css', body: '' });
  });
  await ctx.addInitScript(s => { window.__SEED = s; try { localStorage.setItem('n360_theme', 'light'); } catch (_) {} }, db);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  pageerror', String(e).slice(0, 160)));
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const listo = page => page.waitForFunction(() => document.getElementById('app')?.style.display === 'flex', null, { timeout: 20000 });
const RECTS = fs.existsSync(path.join(HERE, 'rects.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'rects.json'))) : {};
const shot = async (page, name, o = {}) => { await page.waitForTimeout(o.wait ?? 700); await page.screenshot({ path: path.join(OUT, name + '.png'), ...o.opts });
  if (o.rects) { RECTS[name] = {}; for (const [k, sel] of Object.entries(o.rects)) { const bb = await page.locator(sel).first().boundingBox().catch(() => null); RECTS[name][k] = bb; } fs.writeFileSync(path.join(HERE, 'rects.json'), JSON.stringify(RECTS, null, 1)); }
  console.log('  ✓', name, o.rects ? JSON.stringify(RECTS[name]) : ''); };
async function abrir(browser, w, h, url, o = {}) {
  const r = await pagina(browser, w, h, o.db || semilla(), o);
  await r.page.goto(BASE + url); if (o.listo !== false) await listo(r.page).catch(() => console.log('  (no #app flex)', url));
  await r.page.waitForTimeout(1200);
  return r;
}

async function desbloquear(page, perf = 'perf-ruiz', shots) {
  await page.click('text=🔓 Entrar con mi código');
  await page.waitForSelector('#modal-clinica-pin.modal-open');
  await page.selectOption('#cp-persona', perf).catch(() => {});
  if (shots) { for (let i = 0; i <= 4; i++) { await page.fill('#cp-pin', '1357'.slice(0, i)); await shot(page, shots + i, { wait: 300 }); } }
  else await page.fill('#cp-pin', '1357');
  await page.click('#cp-ok');
}
async function nuevaConsulta(page, esp) {
  await page.click('text=📝 Nueva consulta'); await page.waitForSelector('#modal-consulta.modal-open');
  if (esp) { await page.selectOption('#co-especialidad', esp); await page.dispatchEvent('#co-especialidad', 'change'); }
  await page.waitForTimeout(500);
}
const caja = page => ({ opts: { clip: undefined } });
const SCENES = {
  async panel(b) {
    for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone'], [820, 1180, 'tab']]) {
      const { ctx, page } = await abrir(b, w, h, '/clinica-panel.html');
      await page.waitForSelector('#cpn-ciclo .cpn-ciclo-paso').catch(() => {});
      await shot(page, 'panel_' + tag); await ctx.close();
    }
  },
  async agenda(b) {
    for (const [w, h, tag] of [[1180, 820, 'tab'], [1440, 900, 'desk']]) {
      const { ctx, page } = await abrir(b, w, h, '/agenda.html');
      await page.locator('button', { hasText: /^Día$/ }).first().click().catch(() => console.log('  no Día'));
      await shot(page, 'agenda_' + tag, { wait: 1500, rects: { maria: 'text=María José López' } }); await ctx.close();
    }
  },
  async sala(b) {
    let { ctx, page } = await abrir(b, 1440, 900, '/clinica-sala.html');
    await shot(page, 'sala_desk', { wait: 1500 });
    // reminders modal (WhatsApp)
    await page.locator('text=📲 Recordatorios').first().click().catch(e => console.log('  no recordatorios btn'));
    await shot(page, 'sala_recordatorios', { wait: 1200 }); await ctx.close();
    const db = semilla(); db.clinica_cita_info.find(x => x.agenda_cita_id === 'c1').llamado_en = new Date().toISOString();
    ({ ctx, page } = await abrir(b, 1920, 1080, '/clinica-sala.html?pantalla=1', { dpr: 1, db }));
    await page.addStyleTag({ content: '#sp-sonido{display:none!important}' });
    await shot(page, 'sala_tv', { wait: 1500 }); await ctx.close();
  },
};

Object.assign(SCENES, {
  async pin(b) {
    const { ctx, page } = await abrir(b, 390, 844, '/clinica-pacientes.html?paciente=p-maria');
    await shot(page, 'exp_locked_phone', { wait: 800 });
    await desbloquear(page, 'perf-ruiz', 'pin_phone_');
    await page.waitForTimeout(1500); await shot(page, 'exp_phone');
    await ctx.close();
  },
  async consulta(b) {
    const { ctx, page } = await abrir(b, 1440, 900, '/clinica-pacientes.html?paciente=p-maria');
    await desbloquear(page); await page.waitForTimeout(1500);
    await shot(page, 'exp_desk', { rects: { alerta: 'text=ALERGIAS: Penicilina' } });
    await nuevaConsulta(page, 'medicina_general');
    await page.fill('#co-motivo', 'Dolor de cabeza y mareos desde hace 3 días').catch(() => {});
    await shot(page, 'co_0', { rects: { alerta: 'text=ALERGIAS: Penicilina', motivo: '#co-motivo' } });
    const vit = [['#co-pa_sistolica', '150'], ['#co-pa_diastolica', '95'], ['#co-fc', '88'], ['#co-temperatura', '36.8'], ['#co-spo2', '98'], ['#co-peso_kg', '68'], ['#co-talla_cm', '162']];
    for (const [sel, v] of vit) { await page.fill(sel, v); await page.dispatchEvent(sel, 'input'); }
    await page.locator('#co-pa_sistolica').scrollIntoViewIfNeeded();
    await shot(page, 'co_vitales', { rects: { imc: '#co-imc', pa: '#co-pa_sistolica', alertas: '#co-alertas' } });
    await page.locator('#co-dx-buscar').scrollIntoViewIfNeeded(); await page.fill('#co-dx-buscar', 'migra'); await page.dispatchEvent('#co-dx-buscar', 'input');
    await shot(page, 'co_dx', { wait: 600, rects: { res: '#co-dx-resultados', input: '#co-dx-buscar' } });
    await page.locator('#co-dx-resultados > *').first().click().catch(e => console.log('  no dx click'));
    await page.fill('#co-plan', 'Acetaminofén 500 mg c/8h por 3 días. Control en 1 semana.').catch(() => {});
    await shot(page, 'co_dx_ok');
    await page.click('#co-btn-cerrar'); await page.waitForSelector('text=Cerrada y firmada', { timeout: 10000 }).catch(() => console.log('  no firmada'));
    await shot(page, 'exp_firmada', { wait: 1000, rects: { firmada: 'text=Cerrada y firmada', nota: 'text=Firmada el' } });
    // documents
    const btnDoc = page.locator('text=/Nuevo documento|📄 Documento/').first();
    if (await btnDoc.count()) { await btnDoc.click(); await shot(page, 'doc_modal', { wait: 800 }); } else console.log('  no doc button');
    await ctx.close();
  },
  async especialidades(b) {
    const db = semilla();
    db.clinica_consultas = [{ id: 'cc-odo', paciente_id: 'p-jorge', medico_id: 'per-torres', medico_nombre: 'Dra. Sofía Torres', especialidad: 'odontologia', estado: 'cerrada', motivo: 'Revisión dental', fecha: '2026-09-01T15:00:00Z', datos: { denticion: 'Permanente', odontograma: { 16: { e: 'caries', s: ['O'] }, 26: { e: 'obturado', s: ['M', 'O'] }, 36: { e: 'ausente' }, 46: { e: 'endodoncia' }, 11: { e: 'corona' } } }, diagnosticos: [] }];
    for (const [pac, perf, esp, fill, name] of [
      ['p-jorge', 'perf-torres', 'odontologia', null, 'esp_odonto'],
      ['p-daniel', 'perf-mendez', 'pediatria', null, 'esp_pedia'],
      ['p-sofia', 'perf-ruiz', 'ginecologia', 'gine', 'esp_gine'],
      ['p-carmen', 'perf-vega', 'fisioterapia', 'fisio', 'esp_fisio'],
    ]) {
      const { ctx, page } = await abrir(b, 1440, 900, '/clinica-pacientes.html?paciente=' + pac, { db });
      await desbloquear(page, perf); await page.waitForTimeout(1200);
      await nuevaConsulta(page, esp);
      if (fill === 'gine') {
        const d = new Date(); d.setDate(d.getDate() - 30 * 7 - 2);
        await page.selectOption('#co-extra [data-extra="embarazo"]', 'Sí').catch(() => {});
        await page.fill('#co-extra [data-extra="fum"]', ymd(d)).catch(() => {}); await page.fill('#co-extra [data-extra="fcf"]', '142').catch(() => {});
        await page.dispatchEvent('#co-extra [data-extra="fcf"]', 'input').catch(() => {});
      }
      if (fill === 'fisio') {
        for (const [k, v] of [['sesion', '4'], ['sesiones_plan', '10'], ['eva_antes', '8'], ['eva_despues', '3']]) { await page.fill(`#co-extra [data-extra="${k}"]`, v).catch(() => {}); await page.dispatchEvent(`#co-extra [data-extra="${k}"]`, 'input').catch(() => {}); }
      }
      if (fill === 'fisio') { await page.selectOption('#co-extra [data-extra="zona"]', { index: 3 }).catch(() => {}); await page.locator('#co-extra-calc').scrollIntoViewIfNeeded().catch(() => {}); }
      else await page.locator('#co-extra').scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, name, { wait: 600, rects: { calc: '#co-extra-calc', odo: '#co-odo', extra: '#co-extra' } });
      if (esp === 'odontologia') { await page.click('#co-odo .odo-d[aria-label^="Diente 24:"]').catch(() => {}); await shot(page, 'esp_odonto_edit', { wait: 500 }); }
      await ctx.close();
    }
  },
  async cobro(b) {
    const db = semilla(); db.agenda_citas.find(c => c.id === 'c1').estado = 'en_atencion';
    for (const [w, h, tag] of [[390, 844, 'phone'], [1180, 820, 'tab']]) {
      const { ctx, page } = await abrir(b, w, h, '/agenda.html', { db });
      await page.waitForFunction(() => window.N360Citas && STATE.empresaConfig?.usa_modulo_clinica === true, null, { timeout: 15000 });
      await page.evaluate(async () => { await N360Citas.abrirCita('c1'); await N360Citas.cobrar(); });
      await page.waitForSelector('#clc-metodos .clc-chip', { timeout: 20000 });
      await shot(page, 'cobro_' + tag, { wait: 1200 });
      await page.locator('#clc-metodos .clc-chip', { hasText: 'Efectivo' }).first().click(); await page.fill('#clc-recibido', '200').catch(() => {});
      await shot(page, 'cobro_' + tag + '_ef', { wait: 500 });
      await page.click('#clc-cobrar');
      await page.waitForSelector('#cl-cobro .clc-ok', { timeout: 20000 }).catch(() => console.log('  no ok'));
      await shot(page, 'cobrado_' + tag, { wait: 800 });
      await ctx.close();
    }
  },
  async receta(b) {
    const { ctx, page } = await abrir(b, 816, 1056, '/clinica-pacientes.html', { listo: false });
    const html = await page.evaluate(() => clinicaHtmlDocumento({ doc: { tipo: 'receta', numero: 'RX-000148', fecha: new Date().toISOString(), medico_nombre: 'Dra. Ana Ruiz', medico_registro: '18000', estado: 'emitido',
      contenido: { items: [{ medicamento: 'Acetaminofén 500 mg', presentacion: 'Tabletas', cantidad: '9', indicaciones: '1 tableta cada 8 horas por 3 días' }, { medicamento: 'Ibuprofeno 400 mg', presentacion: 'Tabletas', cantidad: '6', indicaciones: '1 tableta cada 12 horas con comida' }], notas: 'Abundantes líquidos. Control en 1 semana.' } },
      paciente: { nombres: 'María José', apellidos: 'López', fecha_nacimiento: '1991-03-14', cedula: '001-140391-0041K', numero_expediente: 'EXP-001201' },
      negocio: { nombre_comercial: 'Centro Médico San Rafael', direccion: 'Managua, Nicaragua', telefono: '2250-4400' }, formato: 'carta' }));
    await page.setContent(html); await shot(page, 'doc_receta', { wait: 600 });
    await ctx.close();
  },
  async reportes(b) {
    const { ctx, page } = await abrir(b, 1440, 900, '/clinica-equipo.html');
    await shot(page, 'equipo_desk', { wait: 1500, rects: { ruiz: 'text=Honorario 30%' } }); await ctx.close();
  },
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = servidor(); const b = await chromium.launch();
  const which = process.argv.slice(2);
  for (const k of (which.length ? which : Object.keys(SCENES))) { console.log('▶', k); try { await SCENES[k](b); } catch (e) { console.log('  ERROR', k, e.message.split('\n')[0]); } }
  await b.close(); srv.close();
})();
