/* Pruebas de las utilidades puras de la Clínica (sin navegador ni base de datos).
   Ejecutar:  node clinica/pruebas/unitarias.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const raiz = path.join(__dirname, '..', '..');
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(raiz, 'vet-comun.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(raiz, 'clinica-comun.js'), 'utf8').replace(/if \(typeof module[\s\S]*$/, ''), ctx);
for (const f of ['clinica-cie10.js', 'clinica-documentos.js']) vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8').replace(/if \(typeof module[\s\S]*$/, ''), ctx);
const C = new Proxy({}, { get: (_, k) => vm.runInContext(String(k), ctx) });
let ok = 0;
const t = (nombre, fn) => { try { fn(); ok++; } catch (e) { console.error('✗', nombre, '\n ', e.message); process.exitCode = 1; } };

t('edad adulto', () => assert.strictEqual(C.clinicaEdad('1990-05-10', '2026-10-23'), '36 años'));
t('edad cumpleaños mañana', () => assert.strictEqual(C.clinicaEdad('1990-10-24', '2026-10-23'), '35 años'));
t('edad cumpleaños hoy', () => assert.strictEqual(C.clinicaEdad('1990-10-23', '2026-10-23'), '36 años'));
t('edad niño 2 años', () => assert.strictEqual(C.clinicaEdad('2024-07-01', '2026-10-23'), '2 años 3 meses'));
t('edad bebé meses', () => assert.strictEqual(C.clinicaEdad('2026-02-23', '2026-10-23'), '8 meses'));
t('edad recién nacido días', () => assert.strictEqual(C.clinicaEdad('2026-10-11', '2026-10-23'), '12 días'));
t('edad 29 feb', () => assert.strictEqual(C.clinicaEdad('2000-02-29', '2026-02-28'), '25 años'));
t('edad vacía', () => assert.strictEqual(C.clinicaEdad(null), '—'));
t('edad futura', () => assert.strictEqual(C.clinicaEdad('2030-01-01', '2026-10-23'), '—'));
t('años', () => { assert.strictEqual(C.clinicaAnios('2010-10-24', '2026-10-23'), 15); assert.strictEqual(C.clinicaAnios('2010-10-23', '2026-10-23'), 16); });

t('IMC 70/175 = 22.86 (igual que la base)', () => assert.strictEqual(C.clinicaIMC(70, 175), 22.86));
t('IMC inválido', () => { assert.strictEqual(C.clinicaIMC(0, 170), null); assert.strictEqual(C.clinicaIMC(70, null), null); });
t('IMC clasificación', () => {
  assert.strictEqual(C.clinicaClasificarIMC(17, 30).texto, 'Bajo peso');
  assert.strictEqual(C.clinicaClasificarIMC(22, 30).texto, 'Peso normal');
  assert.strictEqual(C.clinicaClasificarIMC(25, 30).texto, 'Sobrepeso');
  assert.strictEqual(C.clinicaClasificarIMC(30, 30).texto, 'Obesidad');
  assert.ok(C.clinicaClasificarIMC(22, 10).texto.includes('Menor de 18'));
});

t('signos válidos', () => assert.strictEqual(C.clinicaValidarSignos({ pa_sistolica: '120', pa_diastolica: '80', temperatura: '36,8', peso_kg: '70.5' }), ''));
t('signos: PA incompleta', () => assert.ok(C.clinicaValidarSignos({ pa_sistolica: '120' }).includes('dos valores')));
t('signos: diastólica >= sistólica', () => assert.ok(C.clinicaValidarSignos({ pa_sistolica: '80', pa_diastolica: '90' }).includes('menor')));
t('signos: fuera de rango', () => assert.ok(C.clinicaValidarSignos({ temperatura: '50' }).includes('entre 30 y 45')));
t('signos: entero', () => assert.ok(C.clinicaValidarSignos({ fc: '72.5' }).includes('entero')));
t('signos: texto', () => assert.ok(C.clinicaValidarSignos({ spo2: 'abc' }).includes('números')));
t('alertas signos', () => {
  const a = C.clinicaAlertasSignos({ pa_sistolica: '150', pa_diastolica: '95', temperatura: '38.5', spo2: '90' });
  assert.deepStrictEqual(Array.from(a), ['Presión arterial alta', 'Fiebre', 'Saturación de oxígeno baja']);
  assert.strictEqual(C.clinicaAlertasSignos({}).length, 0);
});

t('choque mismo médico', () => {
  const ex = [{ id: 'a', fecha: '2026-10-23', hora: '09:00:00', duracion_min: 30, medico_id: 'm1', estado: 'programada' }];
  assert.ok(C.clinicaChoqueCita({ fecha: '2026-10-23', hora: '09:15', duracion_min: 30, medico_id: 'm1' }, ex));
  assert.strictEqual(C.clinicaChoqueCita({ fecha: '2026-10-23', hora: '09:30', duracion_min: 30, medico_id: 'm1' }, ex), null, 'terminar justo cuando empieza otra no choca');
  assert.strictEqual(C.clinicaChoqueCita({ fecha: '2026-10-23', hora: '09:00', duracion_min: 30, medico_id: 'm2' }, ex), null, 'otro médico');
  assert.strictEqual(C.clinicaChoqueCita({ fecha: '2026-10-23', hora: '09:00', duracion_min: 30, medico_id: 'm1' }, ex, 'a'), null, 'la misma cita al editar');
  assert.strictEqual(C.clinicaChoqueCita({ fecha: '2026-10-23', hora: '09:00', duracion_min: 30, medico_id: 'm1' }, [{ ...ex[0], estado: 'cancelada' }]), null, 'cancelada no ocupa');
  assert.strictEqual(C.clinicaChoqueCita({ fecha: '2026-10-23', hora: '09:00', duracion_min: 30, medico_id: null }, ex), null, 'sin médico');
});
t('semana lunes a domingo', () => {
  assert.deepStrictEqual(Array.from(C.clinicaSemana('2026-10-23')), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.strictEqual(C.clinicaSemana('2026-10-25')[0], '2026-10-19', 'domingo pertenece a la semana que empezó el lunes');
  assert.strictEqual(C.clinicaSemana('2026-11-01')[6], '2026-11-01');
});
t('especialidades activas', () => {
  const todas = Object.keys(C.CLINICA_ESPECIALIDADES).length;
  assert.strictEqual(C.clinicaEspecialidadesActivas([]).length, todas);
  assert.strictEqual(C.clinicaEspecialidadesActivas(null).length, todas);
  assert.strictEqual(C.clinicaEspecialidadesActivas(['multiespecialidad']).length, todas);
  assert.deepStrictEqual(Array.from(C.clinicaEspecialidadesActivas(['pediatria', 'xx'])), ['pediatria']);
  assert.strictEqual(C.clinicaEspecialidadesActivas(['xx']).length, todas);
  assert.ok(todas >= 17);
});
t('siguientes estados', () => {
  assert.ok(Array.from(C.clinicaSiguientesEstados('programada')).includes('en_espera'));
  assert.strictEqual(C.clinicaSiguientesEstados('atendida').length, 0);
  assert.strictEqual(C.clinicaSiguientesEstados('raro').length, 0);
});
t('mensaje WhatsApp', () => {
  const m = C.clinicaMensajeCita({ paciente: 'Ana', negocio: 'Clínica Sur', fecha: '2026-10-24', hora: '14:30:00', medico: 'Dra. Ruiz' });
  assert.ok(m.includes('Hola Ana') && m.includes('Clínica Sur') && m.includes('24 de octubre de 2026') && m.includes('2:30 p. m.') && m.includes('Dra. Ruiz'));
});
t('textos de error', () => {
  assert.ok(C.clinicaTextoError({ message: 'clinica_choque_horario' }).includes('ya tiene una cita'));
  assert.ok(C.clinicaTextoError({ message: 'duplicate key value violates unique constraint "clinica_pacientes_cedula"' }).includes('cédula'));
  assert.strictEqual(C.clinicaTextoError({ message: 'x' }, 'por defecto'), 'por defecto');
  assert.ok(C.clinicaTextoMotivo({ ok: false, motivo: 'bloqueado', bloqueado_seg: 300 }).includes('5 minutos'));
  assert.ok(C.clinicaTextoMotivo({ ok: false, motivo: 'incorrecto', restantes: 2 }).includes('2 intentos'));
});
// ---- Fase 2: CIE-10 y documentos
t('CIE-10 por código exacto', () => assert.strictEqual(C.clinicaBuscarCIE10('j00')[0].codigo, 'J00'));
t('CIE-10 código sin punto', () => assert.strictEqual(C.clinicaBuscarCIE10('J069')[0].codigo, 'J06.9'));
t('CIE-10 por palabras sin tildes', () => assert.ok(C.clinicaBuscarCIE10('dolor lumbar').some(d => d.codigo === 'M54.5')));
t('CIE-10 palabras en otro orden', () => assert.ok(C.clinicaBuscarCIE10('aguda faringitis').some(d => d.codigo === 'J02.9')));
t('CIE-10 hipertension', () => assert.strictEqual(C.clinicaBuscarCIE10('hipertension')[0].codigo, 'I10'));
t('CIE-10 texto corto o vacío', () => { assert.strictEqual(C.clinicaBuscarCIE10('a').length, 0); assert.strictEqual(C.clinicaBuscarCIE10('').length, 0); });
t('CIE-10 sin códigos repetidos', () => { const cs = C.CLINICA_CIE10.map(x => x[0]); assert.strictEqual(new Set(cs).size, cs.length); assert.ok(cs.length >= 250); });
const XSS = '<img src=x onerror=alert(1)>';
const pac = { nombres: 'Ana ' + XSS, apellidos: 'López', fecha_nacimiento: '1990-01-01', cedula: '001', numero_expediente: 'EXP-000001' };
const neg = { nombre_comercial: 'Clínica ' + XSS, direccion: 'Managua', telefono: '2222', logo_principal_url: 'javascript:alert(1)' };
for (const tipo of ['receta', 'orden_lab', 'orden_imagen', 'constancia', 'certificado', 'referencia', 'consentimiento']) {
  for (const formato of ['carta', 'ticket']) t(`documento ${tipo} (${formato}) escapa todo`, () => {
    const contenido = { items: [{ medicamento: 'Acet ' + XSS, indicaciones: XSS, cantidad: '10', presentacion: XSS }], notas: XSS, examenes: [XSS], estudios: [XSS], otros: XSS,
      texto: XSS, dias_reposo: '3', desde: '2026-10-24', destino: XSS, motivo: XSS, procedimiento: XSS, riesgos: XSS, diagnostico: XSS };
    const html = C.clinicaHtmlDocumento({ doc: { tipo, numero: 'X-1', fecha: '2026-10-24T10:00:00Z', medico_nombre: 'Dra ' + XSS, medico_registro: '123', contenido, estado: 'emitido' }, paciente: pac, negocio: neg, formato });
    assert.ok(!html.includes('<img src=x'), 'no debe quedar HTML ejecutable');
    assert.ok(!html.includes('javascript:'), 'no debe usar enlaces javascript:');
    assert.ok(html.includes('&lt;img'), 'el texto se muestra escapado');
    assert.ok(html.includes('Cód. MINSA 123'), 'lleva el código MINSA');
  });
}
t('certificado calcula fechas de reposo', () => {
  const html = C.clinicaHtmlDocumento({ doc: { tipo: 'certificado', numero: 'CER-1', fecha: '2026-10-24', contenido: { texto: 'x', dias_reposo: '3', desde: '2026-10-30' } }, paciente: pac, negocio: neg, formato: 'carta' });
  assert.ok(html.includes('reposo por 3 días') && html.includes('30 de octubre de 2026') && html.includes('1 de noviembre de 2026'));
});
t('documento anulado lleva sello', () => assert.ok(C.clinicaHtmlDocumento({ doc: { tipo: 'constancia', estado: 'anulado', contenido: { texto: 'x' } }, paciente: pac, negocio: {}, formato: 'carta' }).includes('ANULADO')));
t('logo solo con https', () => assert.ok(C.clinicaHtmlDocumento({ doc: { tipo: 'constancia', contenido: { texto: 'x' } }, paciente: pac, negocio: { logo_principal_url: 'https://x.supabase.co/logo.png' }, formato: 'carta' }).includes('<img src="https://x.supabase.co/logo.png"')));
console.log(`${ok} pruebas unitarias correctas${process.exitCode ? ' (CON FALLAS)' : ''}`);
