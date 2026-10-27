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
t('fase 4: todas las especialidades tienen plantilla válida', () => {
  Object.entries(C.CLINICA_ESPECIALIDADES).forEach(([k, e]) => {
    assert.ok(e.n && e.e && Array.isArray(e.campos), k);
    const vistos = new Set();
    e.campos.forEach(f => { assert.ok(f.k && f.n && ['text', 'number', 'select', 'textarea', 'date', 'odontograma'].includes(f.tipo), k + '.' + f.k); assert.ok(!vistos.has(f.k), 'repetido ' + k + '.' + f.k); vistos.add(f.k);
      if (f.tipo === 'select') assert.ok(f.opciones.length > 1, k + '.' + f.k); });
    if (e.calc) assert.ok(Array.isArray(C.clinicaCalculosEspecialidad(k, {}, {})), k);
  });
  assert.strictEqual(Object.keys(C.CLINICA_ESPECIALIDADES).filter(k => k !== 'medicina_general' && !C.CLINICA_ESPECIALIDADES[k].campos.length).length, 0);
});
t('edad gestacional y fecha probable de parto (Naegele)', () => {
  const eg = C.clinicaEdadGestacional('2026-03-01', '2026-10-24');
  assert.strictEqual(eg.semanas, 33); assert.strictEqual(eg.dias, 6); assert.strictEqual(eg.fpp, '2026-12-06');
  assert.strictEqual(C.clinicaEdadGestacional('2026-11-01', '2026-10-24'), null);   // futura
  assert.strictEqual(C.clinicaEdadGestacional('2025-01-01', '2026-10-24'), null);   // más de 45 semanas
  const r = C.clinicaCalculosEspecialidad('ginecologia', { embarazo: 'Sí', fum: '2026-03-01', fcf: '170', edema: 'Severo' }, { fecha: '2026-10-24' });
  assert.ok(r[0].t.includes('33 semanas 6 días') && r.some(x => x.t.includes('FCF fuera de rango')) && r.some(x => x.t.includes('preeclampsia')));
});
t('Glasgow, dolor, PHQ-9/GAD-7, riesgo suicida', () => {
  assert.strictEqual(C.clinicaGlasgow('4', '5', '6').total, 15); assert.ok(C.clinicaGlasgow('2', '2', '4').t.includes('grave'));
  assert.ok(C.clinicaGlasgow('3', '5', '6').t.includes('leve')); assert.ok(C.clinicaGlasgow('3', '4', '5').t.includes('moderado')); assert.strictEqual(C.clinicaGlasgow('5', '5', '6'), null); assert.strictEqual(C.clinicaGlasgow('4', '', '6'), null);
  assert.ok(C.clinicaEscalaDolor('8').t.includes('intenso')); assert.strictEqual(C.clinicaEscalaDolor('11'), null);
  const p = C.clinicaCalculosEspecialidad('psicologia', { phq9: '16', gad7: '4', riesgo_suicida: 'Alto' });
  assert.ok(p[0].t.includes('moderadamente grave') && p[1].t.includes('mínima') && p[2].clase === 'rojo');
});
t('nutrición: cintura e índice cintura/cadera según sexo', () => {
  const m = C.clinicaRiesgoCintura('90', '100', 'femenino'); assert.ok(m[0].t.includes('muy alto') && m[1].t.includes('0.9 (alto)'));
  const h = C.clinicaRiesgoCintura('90', '100', 'masculino'); assert.ok(h[0].t.includes('sin riesgo') && h[1].t.includes('(normal)'));
});
t('urología, endocrinología, oftalmología, fisioterapia, pediatría', () => {
  assert.ok(C.clinicaCalculosEspecialidad('urologia', { ipss: '22', psa: '6.1' }).map(x => x.t).join('|').includes('severos|PSA elevado'));
  assert.ok(C.clinicaCalculosEspecialidad('endocrinologia', { hba1c: '8.2', tsh: '9' })[0].t.includes('fuera de meta'));
  assert.ok(C.clinicaCalculosEspecialidad('endocrinologia', { hba1c: '6' })[0].t.includes('prediabetes'));
  assert.strictEqual(C.clinicaCalculosEspecialidad('oftalmologia', { pio_od: '25', pio_oi: '15' }).length, 1);
  assert.ok(C.clinicaCalculosEspecialidad('fisioterapia', { eva_antes: '7', eva_despues: '4' })[0].t.includes('bajó 3 puntos'));
  assert.ok(C.clinicaCalculosEspecialidad('pediatria', { vacunas: 'Incompletas' }, { nacimiento: '2025-01-30', fecha: '2026-10-24' })[0].t.includes('20 meses'));
  assert.strictEqual(C.clinicaMesesEdad('2026-01-31', '2026-02-28'), 0);
});
t('odontograma: limpieza (no se guarda basura) e índices CPO-D / ceo-d', () => {
  const o = C.clinicaLimpiarOdontograma({ 16: { e: 'caries', s: ['O', 'M', 'X', 'O'] }, 26: { e: 'obturado', s: ['O'] }, 36: { e: 'ausente', s: ['O'] }, 99: { e: 'caries' },
    11: { e: 'hackeo' }, 21: { e: 'sano' }, 22: { e: 'sano', n: 'vigilar' }, 46: { e: 'por_extraer', n: 'x'.repeat(300) }, 55: { e: 'caries' }, 85: { e: 'ausente' } });
  assert.strictEqual(JSON.stringify(o[16]), JSON.stringify({ e: 'caries', s: ['O', 'M'] }));
  assert.ok(!o[36].s && !o[99] && !o[11] && !o[21] && o[22].n === 'vigilar' && o[46].n.length === 200);
  const r = C.clinicaIndicesDentales(o).map(x => x.t);
  assert.ok(r[0].startsWith('CPO-D 4 (cariados 2, perdidos 1, obturados 1)'), r[0]);
  assert.ok(r[1].startsWith('ceo-d 2'), r[1]);
  assert.ok(r.some(x => x.includes('2 dientes con caries')) && r.some(x => x.includes('1 extracción indicada')));
  assert.strictEqual(C.clinicaDientesDe('Mixta').length, 52); assert.strictEqual(C.clinicaDientesDe('Temporal').length, 20); assert.strictEqual(C.clinicaDientesDe('').length, 32);
});
t('plantilla: resumen para la nota y validación de rangos', () => {
  const r = C.clinicaResumenDatos('ginecologia', { fum: '2026-03-01', fcf: '140', gestas: '', odontograma: {} });
  assert.strictEqual(r.length, 2); assert.ok(r[1].v === '140 lpm' && r[0].v.includes('marzo'));
  assert.ok(C.clinicaValidarDatos('ortopedia', { dolor_eva: '12' }).includes('entre 0 y 10'));
  assert.ok(C.clinicaValidarDatos('nutricion', { cintura_cm: 'abc' }).includes('número'));
  assert.strictEqual(C.clinicaValidarDatos('ortopedia', { dolor_eva: '7' }), '');
  assert.ok(C.clinicaValidarDatos('ginecologia', { embarazo: 'Sí', fum: '2099-01-01' }).includes('FUM'));
});
t('fase 5: días de estancia y su cobro', () => {
  const ing = '2026-10-20T10:00:00Z';
  assert.strictEqual(C.clinicaDiasEstancia(ing, '2026-10-20T20:00:00Z', 'hospitalizacion'), 1);
  assert.strictEqual(C.clinicaDiasEstancia(ing, '2026-10-22T10:00:00Z', 'hospitalizacion'), 2);
  assert.strictEqual(C.clinicaDiasEstancia(ing, '2026-10-22T10:01:00Z', 'hospitalizacion'), 3);
  assert.strictEqual(C.clinicaDiasEstancia(ing, '2026-10-25T10:00:00Z', 'observacion'), 1);
  assert.strictEqual(C.clinicaDuracionTexto(ing, '2026-10-21T13:30:00Z'), '1 d 3 h');
  const c = C.clinicaCobroEstancia({ tipo: 'hospitalizacion', ingreso_en: ing, alta_en: '2026-10-22T09:00:00Z' }, { id: 'dia', precio: 1500 },
    [{ producto_id: 'suero', cantidad: 2, productos: { precio: 120 } }, { producto_id: 'suero', cantidad: 1, productos: { precio: 120 } }, { producto_id: null, descripcion: 'borrado' }]);
  assert.strictEqual(JSON.stringify(c.items), JSON.stringify([{ producto_id: 'dia', cantidad: 2, total: 3000 }, { producto_id: 'suero', cantidad: 3, total: 360 }]));
  assert.strictEqual(c.unidades, 2); assert.strictEqual(c.sinCatalogo[0], 'borrado');
});
t('fase 5: seguro — vigencia y reparto exacto (sin centavos perdidos)', () => {
  const k = { id: 'k1', activo: true, cobertura_pct: 80 };
  assert.ok(C.clinicaConvenioVigente({ convenio_id: 'k1', poliza_vence: '2026-12-31' }, k, '2026-10-24'));
  assert.ok(!C.clinicaConvenioVigente({ convenio_id: 'k1', poliza_vence: '2026-10-01' }, k, '2026-10-24'));
  assert.ok(!C.clinicaConvenioVigente({ convenio_id: 'k1' }, { ...k, activo: false }));
  assert.ok(!C.clinicaConvenioVigente({ convenio_id: 'k2' }, k));
  const r = C.clinicaAplicarConvenio([{ producto_id: 's', cantidad: 1, total: 500 }, { producto_id: 'm', cantidad: 3, total: 37.5 }, { producto_id: 'x', cantidad: 1, total: 33.33 }], 80, { s: 'servicio', m: 'producto' });
  assert.strictEqual(JSON.stringify(r.paciente.map(x => x.total)), '[100,7.5,6.67]');
  assert.strictEqual(r.cubierto, 456.66); assert.strictEqual(r.cubiertoServicios, 400);
  assert.strictEqual(Math.round((r.totalPaciente + r.cubierto) * 100), Math.round((500 + 37.5 + 33.33) * 100));   // cuadra al centavo
  assert.strictEqual(C.clinicaAplicarConvenio([{ producto_id: 's', total: 500 }], 100, {}).totalPaciente, 0);
});
t('fase 5: pendientes por facturar a la aseguradora (sin repetir)', () => {
  const citas = [{ id: 'a', convenio_id: 'k1', monto_cubierto: 400, venta_id: 'v1' }, { id: 'b', convenio_id: 'k1', monto_cubierto: 100, venta_id: 'v2' },
    { id: 'c', convenio_id: 'k2', monto_cubierto: 50, venta_id: 'v3' }, { id: 'd', convenio_id: 'k1', monto_cubierto: 70, venta_id: null }, { id: 'e', convenio_id: null, monto_cubierto: 0, venta_id: 'v5' }];
  const g = C.clinicaPendientesSeguro(citas, [{ estado: 'facturado', citas: ['b'] }, { estado: 'anulado', citas: ['c'] }]);
  assert.strictEqual(JSON.stringify(g.map(x => [x.convenio_id, x.citas.map(c => c.id).join(''), x.monto])), '[["k1","a",400],["k2","c",50]]');
});
t('fase 5: honorario sobre el total cuando paga el seguro', () => {
  const h = C.clinicaCalcularHonorarios({ medico: { id: 'm1', honorario_tipo: 'porcentaje', honorario_valor: 30 },
    citas: [{ id: 'c1', medico_id: 'm1', estado: 'atendida', venta_id: 'v1', cubierto_servicios: 400, monto_cubierto: 400 }],
    ventas: [{ id: 'v1', estado: 'completada', total: 100 }], detalles: [{ venta_id: 'v1', tipo_item: 'servicio', subtotal: 100 }], devoluciones: [], pagadas: [] });
  assert.strictEqual(h.base, 500); assert.strictEqual(h.monto, 150);
  const r = C.clinicaResumenReporte({ citas: [{ id: 'c1', medico_id: 'm1', estado: 'atendida', venta_id: 'v1', monto_cubierto: 400 }], ventas: [{ id: 'v1', estado: 'completada', total: 100 }], detalles: [], devoluciones: [] });
  assert.strictEqual(r.total.cobrado, 100); assert.strictEqual(r.total.cubierto, 400);
});
t('CSV seguro para Excel', () => { const c = C.clinicaCSV([['a', '=1+1', 'x,y', 'di"jo']]); assert.ok(c.includes("'=1+1") && c.includes('"x,y"') && c.includes('"di""jo"')); });
t('Fila de espera: urgentes primero, luego por turno', () => {
  const tur = C.clinicaTurnos([
    { id: 'a', estado: 'en_espera', llegada_en: '2026-10-27T08:00:00Z' }, { id: 'b', estado: 'en_espera', llegada_en: '2026-10-27T08:05:00Z', prioridad: 'urgente' },
    { id: 'c', estado: 'en_consulta', llegada_en: '2026-10-27T07:50:00Z' }, { id: 'd', estado: 'en_espera', llegada_en: '2026-10-27T08:10:00Z' },
    { id: 'e', estado: 'en_espera', llegada_en: '2026-10-27T08:12:00Z', prioridad: 'urgente' }], Date.parse('2026-10-27T08:20:00Z'));
  const f = C.clinicaOrdenEspera(tur);
  assert.strictEqual(f.map(x => x.id).join(''), 'bead');
  assert.strictEqual(f.find(x => x.id === 'b').turno, 3);            // el turno sigue siendo por orden de llegada
});
t('Cita de la Agenda trae prioridad y si llegó sin cita', () => {
  const c = C.clinicaCitaDeAgenda({ id: 'x', estado: 'confirmada', agenda_citas_servicios: [] }, { info: { llegada_en: '2026-10-27T08:00:00Z', prioridad: 'urgente', sin_cita: true } });
  assert.strictEqual(c.prioridad, 'urgente'); assert.strictEqual(c.sin_cita, true); assert.strictEqual(c.estado, 'en_espera');
  const d = C.clinicaCitaDeAgenda({ id: 'y', estado: 'confirmada', agenda_citas_servicios: [] }, {});
  assert.strictEqual(d.prioridad, 'normal'); assert.strictEqual(d.sin_cita, false);
  assert.strictEqual(C.clinicaHoraAhora(new Date(2026, 9, 27, 7, 5)), '07:05');
});
t('Terapias: dolor que baja y sesión N de M', () => {
  const r = C.clinicaCalculosEspecialidad('fisioterapia', { eva_antes: '7', eva_despues: '4', sesion: '4', sesiones_plan: '10' }, {});
  assert.strictEqual(JSON.stringify(r.map(x => x.t)), JSON.stringify(['El dolor bajó 3 puntos en la sesión', 'Sesión 4 de 10: faltan 6']));
  assert.strictEqual(C.clinicaCalculosEspecialidad('quiropraxia', { sesion: 8, sesiones_plan: 8 }, {})[0].t, 'Sesión 8 de 8: plan completo (valorar el alta)');
  assert.strictEqual(C.clinicaCalculosEspecialidad('masoterapia', { contraindicaciones: 'No' }, {})[0].clase, 'rojo');
  assert.strictEqual(C.clinicaCalculosEspecialidad('podologia', { diabetico: 'Sí' }, {}).length, 1);
});
t('Terapias: especialidades nuevas y servicios sugeridos', () => {
  for (const k of ['fisioterapia', 'quiropraxia', 'masoterapia', 'terapia_ocupacional', 'terapia_lenguaje', 'acupuntura', 'podologia'])
    assert.ok(C.CLINICA_ESPECIALIDADES[k] && C.clinicaServiciosSugeridos(k).length >= 2, k);
  assert.strictEqual(C.CLINICA_ESPECIALIDADES.fisioterapia.n, 'Fisioterapia');           // el nombre guardado en el personal no cambia
  assert.ok(C.clinicaServiciosSugeridos('medicina_general').some(x => x.n === 'Consulta general'));
  assert.strictEqual(C.clinicaServiciosSugeridos('laboratorio').length, 0);
  assert.strictEqual(C.clinicaValidarDatos('fisioterapia', { eva_antes: '11' }) !== '', true);
});
console.log(`${ok} pruebas unitarias correctas${process.exitCode ? ' (CON FALLAS)' : ''}`);
