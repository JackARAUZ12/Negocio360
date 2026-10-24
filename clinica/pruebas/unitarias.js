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
// ---- Fase 3: sala de espera, honorarios y reportes
t('nombre corto para la pantalla', () => { assert.strictEqual(C.clinicaNombreCorto({ nombres: 'María José', apellidos: 'López' }), 'María L.'); assert.strictEqual(C.clinicaNombreCorto({ nombres: 'Ana' }), 'Ana'); });
t('turnos por orden de llegada', () => {
  const ahora = Date.parse('2026-10-24T15:30:00Z');
  const tu = C.clinicaTurnos([{ id: 'b', estado: 'en_espera', llegada_en: '2026-10-24T15:10:00Z' }, { id: 'a', estado: 'atendida', llegada_en: '2026-10-24T14:00:00Z' },
    { id: 'c', estado: 'programada' }, { id: 'd', estado: 'cancelada', llegada_en: '2026-10-24T14:30:00Z' }], ahora);
  assert.deepStrictEqual(Array.from(tu.map(x => x.id + x.turno)), ['a1', 'b2']);
  assert.strictEqual(tu[1].espera_min, 20); assert.strictEqual(tu[0].espera_min, null);
  assert.strictEqual(C.clinicaTextoEspera(75), '1 h 15 min'); assert.strictEqual(C.clinicaTextoEspera(0), 'recién llegó');
});
const ventasH = [{ id: 'v1', estado: 'completada', total: 600, numero_venta: 'V-1' }, { id: 'v2', estado: 'completada', total: 500, numero_venta: 'V-2' },
  { id: 'v3', estado: 'anulada', total: 500 }, { id: 'v4', estado: 'completada', total: 500 }];
const detH = [{ venta_id: 'v1', tipo_item: 'servicio', subtotal: 500, producto_nombre: 'Consulta', cantidad: 1 }, { venta_id: 'v1', tipo_item: 'producto', subtotal: 100, producto_nombre: 'Acet', cantidad: 8 },
  { venta_id: 'v2', tipo_item: 'servicio', subtotal: 500, producto_nombre: 'Consulta', cantidad: 1 }, { venta_id: 'v4', tipo_item: 'servicio', subtotal: 500, producto_nombre: 'Consulta', cantidad: 1 }];
const devH = [{ venta_id: 'v2', total: 250, estado: 'activa' }, { venta_id: 'v1', total: 600, estado: 'anulada' }, { venta_id: 'v4', total: 500, estado: 'activa' }];
const citasH = [{ id: 'c1', medico_id: 'm1', estado: 'atendida', venta_id: 'v1', fecha: '2026-10-01' }, { id: 'c2', medico_id: 'm1', estado: 'atendida', venta_id: 'v2', fecha: '2026-10-02' },
  { id: 'c3', medico_id: 'm1', estado: 'atendida', venta_id: 'v3' }, { id: 'c4', medico_id: 'm1', estado: 'atendida', venta_id: null }, { id: 'c5', medico_id: 'm2', estado: 'atendida', venta_id: 'v1' },
  { id: 'c6', medico_id: 'm1', estado: 'no_asistio' }, { id: 'c7', medico_id: 'm1', estado: 'atendida', venta_id: 'v4' }, { id: 'c8', medico_id: 'm1', estado: 'atendida', venta_id: 'v1' }];
t('neto de venta descuenta devoluciones vigentes', () => {
  assert.strictEqual(C.clinicaNetoVenta(ventasH[0], devH).neto, 600);
  assert.strictEqual(C.clinicaNetoVenta(ventasH[1], devH).neto, 250);
  assert.strictEqual(C.clinicaNetoVenta(ventasH[2], devH).neto, 0);
});
t('honorario por porcentaje solo sobre servicios y neto de devoluciones', () => {
  const h = C.clinicaCalcularHonorarios({ medico: { id: 'm1', honorario_tipo: 'porcentaje', honorario_valor: 30 }, citas: citasH, ventas: ventasH, detalles: detH, devoluciones: devH, pagadas: ['c8'] });
  // c1: 500 servicio -> 150 ; c2: 500 * (250/500) = 250 -> 75 ; c7 devuelta completa -> 0 ; c3 anulada y c4 sin venta: sin cobrar ; c8 ya pagada
  assert.strictEqual(h.monto, 225); assert.strictEqual(h.base, 750); assert.strictEqual(h.sinCobrar, 2); assert.strictEqual(h.yaPagadas, 1); assert.strictEqual(h.lineas.length, 3);
});
t('honorario monto fijo por consulta cobrada', () => {
  const h = C.clinicaCalcularHonorarios({ medico: { id: 'm1', honorario_tipo: 'monto', honorario_valor: 100 }, citas: citasH, ventas: ventasH, detalles: detH, devoluciones: devH, pagadas: [] });
  assert.strictEqual(h.monto, 300);   // c1, c2, c8 (c7 devuelta completa = 0)
});
t('resumen del reporte cuadra con las ventas', () => {
  const r = C.clinicaResumenReporte({ citas: citasH, ventas: ventasH, detalles: detH, devoluciones: devH, medicos: [{ id: 'm1', nombre: 'Dra. A' }] });
  // ventas ligadas y completadas: v1 (600, una sola vez aunque 3 citas la apunten), v2 (250), v4 (0)
  assert.strictEqual(r.total.cobrado, 850); assert.strictEqual(r.total.citas, 8); assert.strictEqual(r.total.no_asistio, 1);
  assert.strictEqual(r.servicios.find(x => x.nombre === 'Consulta').total, 1500);
  assert.strictEqual(r.porMedico.find(x => x.medico_id === 'm1').nombre, 'Dra. A');
});
t('cita de la Agenda vista por la clínica (estado, médico, paciente)', () => {
  const meds = [{ id: 'm1', nombre: 'Dra. A', agenda_profesional_id: 'prof1', consultorio_id: 'k1' }];
  const pacs = [{ id: 'p1', nombres: 'Ana', apellidos: 'Ruiz', telefono: '8888', cliente_id: 'cli1' }];
  const base = { id: 'a1', fecha: '2026-10-24', estado: 'confirmada', cliente_id: 'cli1', cliente_nombre: 'Ana Ruiz', agenda_citas_servicios: [
    { profesional_id: 'otro', servicio_nombre: 'Lavado', hora_inicio: '09:00:00', duracion_min: 15, orden: 1 },
    { profesional_id: 'prof1', servicio_nombre: 'Consulta', hora_inicio: '08:30:00', duracion_min: 30, orden: 0 }] };
  let c = C.clinicaCitaDeAgenda(base, { medicos: meds, pacientes: pacs });
  assert.strictEqual(c.estado, 'confirmada'); assert.strictEqual(c.hora, '08:30'); assert.strictEqual(c.medico_id, 'm1');
  assert.strictEqual(c.paciente_id, 'p1'); assert.strictEqual(c.consultorio_id, 'k1'); assert.strictEqual(c.telefono, '8888'); assert.strictEqual(c.motivo, 'Consulta, Lavado');
  c = C.clinicaCitaDeAgenda(base, { info: { llegada_en: '2026-10-24T14:00:00Z' }, medicos: meds, pacientes: pacs });
  assert.strictEqual(c.estado, 'en_espera');
  assert.strictEqual(C.clinicaCitaDeAgenda({ ...base, estado: 'en_atencion' }, { info: { llegada_en: 'x' } }).estado, 'en_consulta');
  assert.strictEqual(C.clinicaCitaDeAgenda({ ...base, estado: 'en_atencion' }, { info: { atendida_en: 'x' } }).estado, 'atendida');
  assert.strictEqual(C.clinicaCitaDeAgenda({ ...base, estado: 'completada' }).estado, 'atendida');
  assert.strictEqual(C.clinicaCitaDeAgenda({ ...base, estado: 'reservada' }).estado, 'programada');
  assert.strictEqual(C.clinicaCitaDeAgenda({ ...base, estado: 'no_asistio' }, { info: { llegada_en: 'x' } }).estado, 'no_asistio');
  // sin expediente: muestra el nombre de la cita; el paciente ligado a la cita gana al del cliente
  c = C.clinicaCitaDeAgenda({ ...base, cliente_id: null, cliente_telefono: '7777' }, { medicos: meds, pacientes: pacs });
  assert.strictEqual(c.paciente_id, null); assert.strictEqual(c.clinica_pacientes.nombres, 'Ana Ruiz'); assert.strictEqual(c.telefono, '7777');
  c = C.clinicaCitaDeAgenda(base, { info: { paciente_id: 'p2' }, pacientes: [...pacs, { id: 'p2', nombres: 'Otra', cliente_id: null }] });
  assert.strictEqual(c.paciente_id, 'p2');
});
t('cobro por el camino de la Agenda: servicios + cuenta de la visita', () => {
  const d = C.clinicaCobroAgenda({ id: 'a1', cliente_id: 'cli1', cliente_nombre: 'Ana', agenda_citas_servicios: [
    { producto_id: 'srv', servicio_nombre: 'Consulta', precio: 500 }, { producto_id: null, servicio_nombre: 'Extra', precio: 50 }] },
    [{ producto_id: 'med', cantidad: 3, productos: { precio: 12.5 }, descripcion: 'Acet' }, { producto_id: 'med', cantidad: 1, productos: { precio: 12.5 } }, { producto_id: null, descripcion: 'Viejo' }]);
  assert.strictEqual(JSON.stringify(d.items), JSON.stringify([{ producto_id: 'srv', cantidad: 1, total: 500 }, { producto_id: 'med', cantidad: 4, total: 50 }]));
  assert.strictEqual(d.citaId, 'a1'); assert.strictEqual(d.clienteId, 'cli1'); assert.strictEqual(d.sinCatalogo.length, 2);
});
t('CSV seguro para Excel', () => { const c = C.clinicaCSV([['a', '=1+1', 'x,y', 'di"jo']]); assert.ok(c.includes("'=1+1") && c.includes('"x,y"') && c.includes('"di""jo"')); });
console.log(`${ok} pruebas unitarias correctas${process.exitCode ? ' (CON FALLAS)' : ''}`);
