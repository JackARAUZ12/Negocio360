/* =====================================================
   CLÍNICA -- utilidades compartidas (puras, sin acceso a la
   base de datos ni al DOM, para poder probarlas bien).
   Las usan: clinica-sala.js, clinica-pacientes.js y
   clinica-equipo.js. Reutiliza las de fecha/hora/WhatsApp de
   vet-comun.js (que se carga antes).
===================================================== */

/* ---------- Especialidades (catálogo: agregar una es una línea) ----------
   'campos' = datos extra que la plantilla de esa especialidad agrega a la
   consulta (se guardan en consulta.datos, con el mismo candado y la misma
   firma que el resto de la nota). Tipos: text, number (u = unidad, min/max),
   select (opciones), textarea, date, odontograma. 'calc' devuelve avisos y
   cálculos automáticos [{ t: texto, clase: verde|azul|ambar|rojo }].
   Medicina general usa solo los campos base de toda consulta. */
const _SINO = ['No', 'Sí'];
const _ZONAS = ['Cervical (cuello)', 'Hombro', 'Codo', 'Muñeca y mano', 'Dorsal (espalda alta)', 'Lumbar (espalda baja)', 'Cadera', 'Rodilla', 'Tobillo y pie', 'Varias zonas', 'Neurológica (todo el cuerpo)'];
const CLINICA_ESPECIALIDADES = {
  medicina_general:      { e: '🩺', n: 'Medicina general', campos: [] },
  medicina_interna:      { e: '🫀', n: 'Medicina interna', campos: [
    { k: 'revision_sistemas', n: 'Revisión por sistemas', tipo: 'textarea' },
    { k: 'cronicas', n: 'Control de enfermedades crónicas', tipo: 'textarea' } ] },
  pediatria:             { e: '🧒', n: 'Pediatría', campos: [
    { k: 'perimetro_cefalico', n: 'Perímetro cefálico', tipo: 'number', u: 'cm', min: 20, max: 70 },
    { k: 'percentil_peso', n: 'Percentil de peso', tipo: 'text' },
    { k: 'percentil_talla', n: 'Percentil de talla', tipo: 'text' },
    { k: 'desarrollo', n: 'Desarrollo psicomotor', tipo: 'select', opciones: ['Adecuado para la edad', 'Con retraso', 'En evaluación'] },
    { k: 'alimentacion', n: 'Alimentación', tipo: 'select', opciones: ['Lactancia materna exclusiva', 'Lactancia mixta', 'Fórmula', 'Alimentación complementaria', 'Dieta familiar'] },
    { k: 'vacunas', n: 'Vacunas', tipo: 'select', opciones: ['Completas para la edad', 'Incompletas', 'Sin carné'] } ],
    calc: (d, x) => {
      const r = [];
      if (x.nacimiento) { const m = clinicaMesesEdad(x.nacimiento, x.fecha); if (m != null) r.push({ t: `Edad: ${m} meses`, clase: 'azul' }); }
      if (d.vacunas && d.vacunas !== 'Completas para la edad') r.push({ t: 'Vacunas pendientes', clase: 'ambar' });
      if (d.desarrollo === 'Con retraso') r.push({ t: 'Desarrollo con retraso: valorar referencia', clase: 'ambar' });
      return r;
    } },
  ginecologia:           { e: '🤰', n: 'Ginecología y obstetricia', campos: [
    { k: 'embarazo', n: '¿Embarazada?', tipo: 'select', opciones: _SINO },
    { k: 'fum', n: 'Fecha de última menstruación (FUM)', tipo: 'date' },
    { k: 'gestas', n: 'Gestas', tipo: 'number', min: 0, max: 30 }, { k: 'partos', n: 'Partos', tipo: 'number', min: 0, max: 30 },
    { k: 'cesareas', n: 'Cesáreas', tipo: 'number', min: 0, max: 30 }, { k: 'abortos', n: 'Abortos', tipo: 'number', min: 0, max: 30 },
    { k: 'fcf', n: 'Frecuencia cardíaca fetal', tipo: 'number', u: 'lpm', min: 50, max: 250 },
    { k: 'altura_uterina', n: 'Altura uterina', tipo: 'number', u: 'cm', min: 5, max: 50 },
    { k: 'movimientos_fetales', n: 'Movimientos fetales', tipo: 'select', opciones: ['Presentes', 'Disminuidos', 'Ausentes'] },
    { k: 'presentacion', n: 'Presentación', tipo: 'select', opciones: ['Cefálica', 'Pélvica', 'Transversa'] },
    { k: 'edema', n: 'Edema', tipo: 'select', opciones: ['No', 'Leve', 'Moderado', 'Severo'] },
    { k: 'citologia', n: 'Última citología (PAP)', tipo: 'text' },
    { k: 'planificacion', n: 'Método de planificación', tipo: 'text' } ],
    calc: (d, x) => {
      const r = [];
      if (d.embarazo === 'Sí' && d.fum) {
        const eg = clinicaEdadGestacional(d.fum, x.fecha);
        if (eg) r.push({ t: `Edad gestacional: ${eg.semanas} semanas ${eg.dias} día${eg.dias === 1 ? '' : 's'} · Fecha probable de parto: ${vetFechaLarga(eg.fpp)}`, clase: eg.semanas > 42 ? 'rojo' : 'azul' });
        else r.push({ t: 'Revisa la FUM: no puede ser futura ni de hace más de 45 semanas.', clase: 'ambar' });
      }
      const f = clinicaNumero(d.fcf);
      if (f != null && (f < 110 || f > 160)) r.push({ t: `FCF fuera de rango (110–160): ${f} lpm`, clase: 'rojo' });
      if (d.movimientos_fetales === 'Ausentes' || d.movimientos_fetales === 'Disminuidos') r.push({ t: `Movimientos fetales ${d.movimientos_fetales.toLowerCase()}`, clase: 'rojo' });
      if (d.edema === 'Moderado' || d.edema === 'Severo') r.push({ t: `Edema ${d.edema.toLowerCase()}: descartar preeclampsia`, clase: 'rojo' });
      return r;
    } },
  cardiologia:           { e: '❤️', n: 'Cardiología', campos: [
    { k: 'ritmo', n: 'Ritmo', tipo: 'select', opciones: ['Sinusal', 'Fibrilación auricular', 'Otro'] },
    { k: 'soplo', n: 'Soplo', tipo: 'select', opciones: _SINO },
    { k: 'nyha', n: 'Clase funcional (NYHA)', tipo: 'select', opciones: ['I', 'II', 'III', 'IV'] },
    { k: 'edema_mi', n: 'Edema de miembros inferiores', tipo: 'select', opciones: ['No', 'Leve', 'Moderado', 'Severo'] },
    { k: 'ecg', n: 'Hallazgos del electrocardiograma', tipo: 'textarea' },
    { k: 'riesgo_cv', n: 'Riesgo cardiovascular', tipo: 'select', opciones: ['Bajo', 'Moderado', 'Alto', 'Muy alto'] } ],
    calc: d => {
      const r = [];
      if (d.nyha === 'III' || d.nyha === 'IV') r.push({ t: `Clase funcional NYHA ${d.nyha}`, clase: 'rojo' });
      if (d.ritmo === 'Fibrilación auricular') r.push({ t: 'Fibrilación auricular: valorar anticoagulación', clase: 'ambar' });
      return r;
    } },
  dermatologia:          { e: '🧴', n: 'Dermatología', campos: [
    { k: 'localizacion', n: 'Localización', tipo: 'text' },
    { k: 'tipo_lesion', n: 'Tipo de lesión', tipo: 'select', opciones: ['Mácula', 'Pápula', 'Placa', 'Nódulo', 'Vesícula', 'Pústula', 'Úlcera', 'Costra', 'Escama', 'Otra'] },
    { k: 'tamano_mm', n: 'Tamaño', tipo: 'number', u: 'mm', min: 0, max: 1000 },
    { k: 'distribucion', n: 'Distribución', tipo: 'select', opciones: ['Localizada', 'Generalizada', 'Simétrica', 'Segmentaria'] },
    { k: 'color', n: 'Color', tipo: 'text' }, { k: 'evolucion', n: 'Tiempo de evolución', tipo: 'text' } ] },
  oftalmologia:          { e: '👁️', n: 'Oftalmología', campos: [
    { k: 'av_od', n: 'Agudeza visual OD (sin corrección)', tipo: 'text' }, { k: 'av_oi', n: 'Agudeza visual OI (sin corrección)', tipo: 'text' },
    { k: 'av_od_cc', n: 'Agudeza visual OD (con corrección)', tipo: 'text' }, { k: 'av_oi_cc', n: 'Agudeza visual OI (con corrección)', tipo: 'text' },
    { k: 'pio_od', n: 'Presión intraocular OD', tipo: 'number', u: 'mmHg', min: 1, max: 80 }, { k: 'pio_oi', n: 'Presión intraocular OI', tipo: 'number', u: 'mmHg', min: 1, max: 80 },
    { k: 'refraccion', n: 'Refracción', tipo: 'textarea' }, { k: 'fondo_ojo', n: 'Fondo de ojo', tipo: 'textarea' } ],
    calc: d => ['od', 'oi'].map(o => { const v = clinicaNumero(d['pio_' + o]); return v != null && v > 21 ? { t: `Presión intraocular ${o.toUpperCase()} alta (${v} mmHg): descartar glaucoma`, clase: 'rojo' } : null; }).filter(Boolean) },
  otorrinolaringologia:  { e: '👂', n: 'Otorrinolaringología', campos: [
    { k: 'otoscopia_od', n: 'Otoscopia oído derecho', tipo: 'text' }, { k: 'otoscopia_oi', n: 'Otoscopia oído izquierdo', tipo: 'text' },
    { k: 'rinoscopia', n: 'Rinoscopia', tipo: 'text' }, { k: 'orofaringe', n: 'Orofaringe', tipo: 'text' },
    { k: 'audicion', n: 'Audición', tipo: 'select', opciones: ['Normal', 'Disminuida oído derecho', 'Disminuida oído izquierdo', 'Disminuida ambos oídos'] } ] },
  ortopedia:             { e: '🦴', n: 'Ortopedia y traumatología', campos: [
    { k: 'segmento', n: 'Segmento afectado', tipo: 'text' },
    { k: 'lado', n: 'Lado', tipo: 'select', opciones: ['Derecho', 'Izquierdo', 'Bilateral'] },
    { k: 'dolor_eva', n: 'Dolor (escala 0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'fuerza', n: 'Fuerza muscular', tipo: 'select', opciones: ['5/5', '4/5', '3/5', '2/5', '1/5', '0/5'] },
    { k: 'movilidad', n: 'Arcos de movilidad', tipo: 'textarea' }, { k: 'pruebas', n: 'Pruebas especiales', tipo: 'textarea' },
    { k: 'imagenes', n: 'Estudios de imagen', tipo: 'textarea' } ],
    calc: d => { const e = clinicaEscalaDolor(d.dolor_eva); return e ? [e] : []; } },
  neurologia:            { e: '🧠', n: 'Neurología', campos: [
    { k: 'glasgow_o', n: 'Glasgow · apertura ocular', tipo: 'select', opciones: ['4', '3', '2', '1'] },
    { k: 'glasgow_v', n: 'Glasgow · respuesta verbal', tipo: 'select', opciones: ['5', '4', '3', '2', '1'] },
    { k: 'glasgow_m', n: 'Glasgow · respuesta motora', tipo: 'select', opciones: ['6', '5', '4', '3', '2', '1'] },
    { k: 'pares', n: 'Pares craneales', tipo: 'textarea' }, { k: 'fuerza', n: 'Fuerza', tipo: 'text' }, { k: 'reflejos', n: 'Reflejos', tipo: 'text' },
    { k: 'sensibilidad', n: 'Sensibilidad', tipo: 'text' }, { k: 'marcha', n: 'Marcha y coordinación', tipo: 'text' } ],
    calc: d => { const g = clinicaGlasgow(d.glasgow_o, d.glasgow_v, d.glasgow_m); return g ? [g] : []; } },
  psicologia:            { e: '💬', n: 'Psicología / psiquiatría', campos: [
    { k: 'sesion', n: 'Sesión n.º', tipo: 'number', min: 1, max: 1000 },
    { k: 'animo', n: 'Estado de ánimo', tipo: 'select', opciones: ['Eutímico', 'Deprimido', 'Ansioso', 'Irritable', 'Eufórico'] },
    { k: 'phq9', n: 'PHQ-9 (depresión, 0 a 27)', tipo: 'number', min: 0, max: 27 },
    { k: 'gad7', n: 'GAD-7 (ansiedad, 0 a 21)', tipo: 'number', min: 0, max: 21 },
    { k: 'riesgo_suicida', n: 'Riesgo suicida', tipo: 'select', opciones: ['Sin riesgo', 'Bajo', 'Moderado', 'Alto'] },
    { k: 'plan_terapeutico', n: 'Plan terapéutico', tipo: 'textarea' } ],
    calc: d => {
      const r = [], p = clinicaNumero(d.phq9), g = clinicaNumero(d.gad7);
      if (p != null) { const n = p >= 20 ? ['grave', 'rojo'] : p >= 15 ? ['moderadamente grave', 'rojo'] : p >= 10 ? ['moderada', 'ambar'] : p >= 5 ? ['leve', 'ambar'] : ['mínima', 'verde']; r.push({ t: `PHQ-9 ${p}: depresión ${n[0]}`, clase: n[1] }); }
      if (g != null) { const n = g >= 15 ? ['grave', 'rojo'] : g >= 10 ? ['moderada', 'ambar'] : g >= 5 ? ['leve', 'ambar'] : ['mínima', 'verde']; r.push({ t: `GAD-7 ${g}: ansiedad ${n[0]}`, clase: n[1] }); }
      if (d.riesgo_suicida === 'Moderado' || d.riesgo_suicida === 'Alto') r.push({ t: `⚠️ Riesgo suicida ${d.riesgo_suicida.toLowerCase()}: activar plan de seguridad`, clase: 'rojo' });
      return r;
    } },
  nutricion:             { e: '🥗', n: 'Nutrición', campos: [
    { k: 'cintura_cm', n: 'Circunferencia de cintura', tipo: 'number', u: 'cm', min: 30, max: 250 },
    { k: 'cadera_cm', n: 'Circunferencia de cadera', tipo: 'number', u: 'cm', min: 30, max: 250 },
    { k: 'grasa_pct', n: 'Grasa corporal', tipo: 'number', u: '%', min: 1, max: 80 },
    { k: 'actividad', n: 'Actividad física', tipo: 'select', opciones: ['Sedentaria', 'Ligera', 'Moderada', 'Intensa'] },
    { k: 'kcal', n: 'Requerimiento calórico', tipo: 'number', u: 'kcal/día', min: 500, max: 8000 },
    { k: 'dieta', n: 'Plan de alimentación', tipo: 'textarea' } ],
    calc: (d, x) => clinicaRiesgoCintura(d.cintura_cm, d.cadera_cm, x.sexo) },
  fisioterapia:          { e: '🏃', n: 'Fisioterapia', campos: [
    { k: 'tipo_sesion', n: 'Tipo de sesión', tipo: 'select', opciones: ['Evaluación inicial', 'Sesión de tratamiento', 'Reevaluación', 'Alta'] },
    { k: 'zona', n: 'Zona a tratar', tipo: 'select', opciones: _ZONAS },
    { k: 'lado', n: 'Lado', tipo: 'select', opciones: ['Derecho', 'Izquierdo', 'Ambos', 'No aplica'] },
    { k: 'diagnostico_funcional', n: 'Diagnóstico fisioterapéutico', tipo: 'textarea' },
    { k: 'sesion', n: 'Sesión n.º', tipo: 'number', min: 1, max: 1000 },
    { k: 'sesiones_plan', n: 'Sesiones del plan', tipo: 'number', min: 1, max: 200 },
    { k: 'eva_antes', n: 'Dolor antes (0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'eva_despues', n: 'Dolor después (0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'movilidad', n: 'Movilidad (arcos de movimiento)', tipo: 'textarea' },
    { k: 'fuerza', n: 'Fuerza muscular', tipo: 'select', opciones: ['5/5 normal', '4/5 buena', '3/5 regular', '2/5 mala', '1/5 vestigios', '0/5 nula'] },
    { k: 'pruebas', n: 'Pruebas especiales', tipo: 'textarea' },
    { k: 'agentes', n: 'Agentes físicos', tipo: 'text' },
    { k: 'tecnicas', n: 'Técnicas aplicadas', tipo: 'textarea' }, { k: 'ejercicios', n: 'Ejercicios para la casa', tipo: 'textarea' },
    { k: 'evolucion', n: 'Evolución', tipo: 'select', opciones: ['Mejoría', 'Igual', 'Empeoró'] } ],
    calc: d => clinicaCalcTerapia(d),
    servicios: [{ n: 'Evaluación inicial de fisioterapia', p: 600, min: 60 }, { n: 'Sesión de fisioterapia', p: 500, min: 45 },
      { n: 'Sesión con electroterapia y ultrasonido', p: 650, min: 45 }, { n: 'Rehabilitación postoperatoria', p: 700, min: 60 },
      { n: 'Fisioterapia deportiva', p: 650, min: 60 }, { n: 'Vendaje neuromuscular (kinesiotape)', p: 250, min: 15 }, { n: 'Sesión a domicilio', p: 900, min: 60 }] },
  quiropraxia:           { e: '🦴', n: 'Quiropraxia', campos: [
    { k: 'zona', n: 'Zona', tipo: 'select', opciones: ['Cervical (cuello)', 'Dorsal (espalda alta)', 'Lumbar (espalda baja)', 'Sacro y pelvis', 'Varias zonas'] },
    { k: 'segmentos', n: 'Segmentos ajustados', tipo: 'text' },
    { k: 'tecnica', n: 'Técnica', tipo: 'select', opciones: ['Diversificada', 'Activador', 'Gonstead', 'Thompson (drop)', 'Flexión-distracción', 'Otra'] },
    { k: 'postura', n: 'Postura', tipo: 'select', opciones: ['Adecuada', 'Hombros desnivelados', 'Pelvis desnivelada', 'Cabeza adelantada', 'Escoliosis', 'Otra'] },
    { k: 'eva_antes', n: 'Dolor antes (0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'eva_despues', n: 'Dolor después (0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'sesion', n: 'Sesión n.º', tipo: 'number', min: 1, max: 1000 },
    { k: 'sesiones_plan', n: 'Sesiones del plan', tipo: 'number', min: 1, max: 200 },
    { k: 'recomendaciones', n: 'Recomendaciones', tipo: 'textarea' } ],
    calc: d => clinicaCalcTerapia(d),
    servicios: [{ n: 'Evaluación quiropráctica', p: 800, min: 45 }, { n: 'Ajuste quiropráctico', p: 700, min: 30 }, { n: 'Ajuste con terapia de tejido blando', p: 900, min: 45 }] },
  masoterapia:           { e: '💆', n: 'Masoterapia (masajes)', campos: [
    { k: 'tipo_masaje', n: 'Tipo de masaje', tipo: 'select', opciones: ['Terapéutico', 'Descontracturante', 'Relajante', 'Deportivo', 'Drenaje linfático', 'Piedras calientes', 'Prenatal', 'Reflexología'] },
    { k: 'duracion', n: 'Duración', tipo: 'select', opciones: ['30 minutos', '45 minutos', '60 minutos', '90 minutos'] },
    { k: 'zonas', n: 'Zonas trabajadas', tipo: 'text' },
    { k: 'presion', n: 'Presión', tipo: 'select', opciones: ['Suave', 'Media', 'Fuerte'] },
    { k: 'productos', n: 'Aceites o cremas usados', tipo: 'text' },
    { k: 'contraindicaciones', n: '¿Revisó contraindicaciones (embarazo, várices, presión, heridas)?', tipo: 'select', opciones: ['Sí, ninguna', 'Sí, hay una (ver notas)', 'No'] },
    { k: 'eva_antes', n: 'Dolor o tensión antes (0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'eva_despues', n: 'Dolor o tensión después (0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'observaciones', n: 'Observaciones', tipo: 'textarea' } ],
    calc: d => { const r = clinicaCalcTerapia(d);
      if (d.contraindicaciones === 'No') r.push({ t: 'Falta revisar contraindicaciones', clase: 'rojo' });
      if (d.contraindicaciones === 'Sí, hay una (ver notas)') r.push({ t: 'Tiene una contraindicación: revisar antes de cada masaje', clase: 'ambar' });
      return r; },
    servicios: [{ n: 'Masaje terapéutico 60 min', p: 900, min: 60 }, { n: 'Masaje descontracturante 60 min', p: 900, min: 60 }, { n: 'Masaje relajante 60 min', p: 800, min: 60 },
      { n: 'Masaje relajante 90 min', p: 1100, min: 90 }, { n: 'Masaje deportivo', p: 950, min: 60 }, { n: 'Drenaje linfático', p: 950, min: 60 },
      { n: 'Masaje con piedras calientes', p: 1100, min: 75 }, { n: 'Reflexología podal', p: 600, min: 45 }] },
  terapia_ocupacional:   { e: '🧩', n: 'Terapia ocupacional', campos: [
    { k: 'area', n: 'Área trabajada', tipo: 'select', opciones: ['Motricidad fina', 'Actividades de la vida diaria', 'Integración sensorial', 'Cognitiva', 'Adaptación del hogar o trabajo'] },
    { k: 'independencia', n: 'Nivel de independencia', tipo: 'select', opciones: ['Independiente', 'Ayuda mínima', 'Ayuda moderada', 'Ayuda total'] },
    { k: 'sesion', n: 'Sesión n.º', tipo: 'number', min: 1, max: 1000 }, { k: 'sesiones_plan', n: 'Sesiones del plan', tipo: 'number', min: 1, max: 200 },
    { k: 'actividades', n: 'Actividades realizadas', tipo: 'textarea' }, { k: 'tareas_casa', n: 'Tareas para la casa', tipo: 'textarea' } ],
    calc: d => clinicaCalcTerapia(d),
    servicios: [{ n: 'Evaluación de terapia ocupacional', p: 700, min: 60 }, { n: 'Sesión de terapia ocupacional', p: 550, min: 45 }] },
  terapia_lenguaje:      { e: '🗣️', n: 'Terapia de lenguaje', campos: [
    { k: 'area', n: 'Área trabajada', tipo: 'select', opciones: ['Articulación (pronunciación)', 'Lenguaje expresivo', 'Comprensión', 'Voz', 'Fluidez (tartamudez)', 'Deglución'] },
    { k: 'sesion', n: 'Sesión n.º', tipo: 'number', min: 1, max: 1000 }, { k: 'sesiones_plan', n: 'Sesiones del plan', tipo: 'number', min: 1, max: 200 },
    { k: 'logros', n: 'Logros de la sesión', tipo: 'textarea' }, { k: 'tareas_casa', n: 'Tareas para la casa', tipo: 'textarea' } ],
    calc: d => clinicaCalcTerapia(d),
    servicios: [{ n: 'Evaluación de lenguaje', p: 700, min: 60 }, { n: 'Sesión de terapia de lenguaje', p: 550, min: 45 }] },
  acupuntura:            { e: '📍', n: 'Acupuntura', campos: [
    { k: 'puntos', n: 'Puntos aplicados', tipo: 'textarea' },
    { k: 'tecnica', n: 'Técnica', tipo: 'select', opciones: ['Agujas', 'Electroacupuntura', 'Moxibustión', 'Ventosas', 'Auriculoterapia'] },
    { k: 'eva_antes', n: 'Dolor antes (0 a 10)', tipo: 'number', min: 0, max: 10 }, { k: 'eva_despues', n: 'Dolor después (0 a 10)', tipo: 'number', min: 0, max: 10 },
    { k: 'sesion', n: 'Sesión n.º', tipo: 'number', min: 1, max: 1000 }, { k: 'sesiones_plan', n: 'Sesiones del plan', tipo: 'number', min: 1, max: 200 } ],
    calc: d => clinicaCalcTerapia(d),
    servicios: [{ n: 'Sesión de acupuntura', p: 700, min: 45 }, { n: 'Ventosas (terapia de copas)', p: 500, min: 30 }] },
  podologia:             { e: '🦶', n: 'Podología', campos: [
    { k: 'pie', n: 'Pie', tipo: 'select', opciones: ['Derecho', 'Izquierdo', 'Ambos'] },
    { k: 'hallazgos', n: 'Hallazgos', tipo: 'select', opciones: ['Uña encarnada', 'Callosidades', 'Hongos en uñas', 'Pie diabético (control)', 'Juanete', 'Pie plano', 'Otro'] },
    { k: 'diabetico', n: '¿Paciente diabético?', tipo: 'select', opciones: _SINO },
    { k: 'procedimiento', n: 'Procedimiento realizado', tipo: 'textarea' }, { k: 'recomendaciones', n: 'Recomendaciones', tipo: 'textarea' } ],
    calc: d => d.diabetico === 'Sí' ? [{ t: 'Pie diabético: revisar sensibilidad y circulación en cada visita', clase: 'ambar' }] : [],
    servicios: [{ n: 'Consulta de podología', p: 600, min: 30 }, { n: 'Quiropodia (limpieza de pies)', p: 500, min: 45 }, { n: 'Tratamiento de uña encarnada', p: 800, min: 45 }] },
  odontologia:           { e: '🦷', n: 'Odontología', campos: [
    { k: 'denticion', n: 'Dentición', tipo: 'select', opciones: ['Permanente', 'Temporal', 'Mixta'] },
    { k: 'odontograma', n: 'Odontograma', tipo: 'odontograma' },
    { k: 'higiene', n: 'Higiene oral', tipo: 'select', opciones: ['Buena', 'Regular', 'Deficiente'] },
    { k: 'tratamiento_realizado', n: 'Tratamiento realizado hoy', tipo: 'textarea' },
    { k: 'plan_tratamiento', n: 'Plan de tratamiento', tipo: 'textarea' } ],
    calc: d => clinicaIndicesDentales(d.odontograma) },
  urologia:              { e: '🚻', n: 'Urología', campos: [
    { k: 'ipss', n: 'IPSS (síntomas prostáticos, 0 a 35)', tipo: 'number', min: 0, max: 35 },
    { k: 'psa', n: 'PSA', tipo: 'number', u: 'ng/ml', min: 0, max: 10000 },
    { k: 'tacto_rectal', n: 'Tacto rectal', tipo: 'text' }, { k: 'sintomas', n: 'Síntomas urinarios', tipo: 'textarea' } ],
    calc: d => {
      const r = [], i = clinicaNumero(d.ipss), p = clinicaNumero(d.psa);
      if (i != null) r.push(i >= 20 ? { t: `IPSS ${i}: síntomas severos`, clase: 'rojo' } : i >= 8 ? { t: `IPSS ${i}: síntomas moderados`, clase: 'ambar' } : { t: `IPSS ${i}: síntomas leves`, clase: 'verde' });
      if (p != null && p > 4) r.push({ t: `PSA elevado (${p} ng/ml)`, clase: 'rojo' });
      return r;
    } },
  endocrinologia:        { e: '🧪', n: 'Endocrinología', campos: [
    { k: 'hba1c', n: 'Hemoglobina glicosilada (HbA1c)', tipo: 'number', u: '%', min: 2, max: 25 },
    { k: 'tsh', n: 'TSH', tipo: 'number', u: 'mUI/L', min: 0, max: 500 },
    { k: 'insulina', n: '¿Usa insulina?', tipo: 'select', opciones: _SINO },
    { k: 'tratamiento', n: 'Tratamiento actual', tipo: 'textarea' } ],
    calc: d => {
      const r = [], h = clinicaNumero(d.hba1c), t = clinicaNumero(d.tsh);
      if (h != null) r.push(h < 5.7 ? { t: `HbA1c ${h}%: normal`, clase: 'verde' } : h < 6.5 ? { t: `HbA1c ${h}%: prediabetes`, clase: 'ambar' } : h < 7 ? { t: `HbA1c ${h}%: diabetes en meta`, clase: 'verde' } : { t: `HbA1c ${h}%: diabetes fuera de meta (<7%)`, clase: 'rojo' });
      if (t != null && (t < 0.4 || t > 4.5)) r.push({ t: `TSH fuera de rango (0.4–4.5): ${t}`, clase: 'ambar' });
      return r;
    } },
  laboratorio:           { e: '🔬', n: 'Laboratorio clínico', campos: [
    { k: 'muestra', n: 'Tipo de muestra', tipo: 'select', opciones: ['Sangre', 'Orina', 'Heces', 'Otra'] },
    { k: 'examenes', n: 'Exámenes realizados', tipo: 'textarea' },
    { k: 'resultados', n: 'Resultados', tipo: 'textarea' },
    { k: 'referencia', n: 'Valores de referencia / observaciones', tipo: 'textarea' } ] },
};
// Lo que la clínica eligió en Configuración. Vacío o "multiespecialidad" = todas.
function clinicaEspecialidadesActivas(config) {
  const lista = Array.isArray(config) ? config : [];
  if (!lista.length || lista.includes('multiespecialidad')) return Object.keys(CLINICA_ESPECIALIDADES);
  const validas = lista.filter(k => CLINICA_ESPECIALIDADES[k]);
  return validas.length ? validas : Object.keys(CLINICA_ESPECIALIDADES);
}
// Servicios típicos de cada especialidad (para agregarlos al catálogo con un toque). Las terapias los
// traen en su ficha; las especialidades médicas más comunes, aquí.
const _CLINICA_SERVICIOS_MEDICOS = {
  medicina_general: [{ n: 'Consulta general', p: 600 }, { n: 'Consulta de control', p: 400 }, { n: 'Curación', p: 350 }, { n: 'Inyección (aplicación)', p: 150 }, { n: 'Nebulización', p: 300 }],
  pediatria: [{ n: 'Consulta pediátrica', p: 700 }, { n: 'Control de niño sano', p: 500 }],
  ginecologia: [{ n: 'Consulta ginecológica', p: 850 }, { n: 'Control prenatal', p: 800 }, { n: 'Citología (PAP)', p: 600 }],
  odontologia: [{ n: 'Consulta odontológica', p: 500 }, { n: 'Limpieza dental', p: 900 }, { n: 'Resina dental', p: 1200 }, { n: 'Extracción dental', p: 1000 }],
  psicologia: [{ n: 'Consulta psicológica', p: 900 }, { n: 'Terapia de pareja', p: 1200 }],
  nutricion: [{ n: 'Consulta nutricional', p: 700 }, { n: 'Control nutricional', p: 450 }],
};
function clinicaServiciosSugeridos(k) { return (CLINICA_ESPECIALIDADES[k] && CLINICA_ESPECIALIDADES[k].servicios) || _CLINICA_SERVICIOS_MEDICOS[k] || []; }
function clinicaNombreEspecialidad(k) { const e = CLINICA_ESPECIALIDADES[k]; return e ? `${e.e} ${e.n}` : (k || '—'); }

/* ---------- Agenda ---------- */
const CLINICA_TIPOS_CITA = {
  primera_vez:   { e: '🆕', n: 'Primera vez' },   consulta: { e: '🩺', n: 'Consulta' },
  control:       { e: '🔁', n: 'Control' },       procedimiento: { e: '💉', n: 'Procedimiento' },
  urgencia:      { e: '🚑', n: 'Urgencia' },      otro: { e: '📝', n: 'Otro' },
};
const CLINICA_ESTADOS_CITA = {
  programada:  { n: 'Programada',      clase: 'azul' },
  confirmada:  { n: 'Confirmada',      clase: 'verde' },
  en_espera:   { n: 'En sala de espera', clase: 'ambar' },
  en_consulta: { n: 'En consulta',     clase: 'morado' },
  atendida:    { n: 'Atendida',        clase: 'gris' },
  no_asistio:  { n: 'No asistió',      clase: 'rojo' },
  cancelada:   { n: 'Cancelada',       clase: 'rojo' },
};
// Qué botones de estado ofrecer según el estado actual (recepción).
function clinicaSiguientesEstados(estado) {
  return ({
    programada:  ['confirmada', 'en_espera', 'no_asistio', 'cancelada'],
    confirmada:  ['en_espera', 'no_asistio', 'cancelada'],
    en_espera:   ['programada', 'cancelada'],
    en_consulta: [],
    atendida:    [],
    no_asistio:  ['programada'],
    cancelada:   ['programada'],
  })[estado] || [];
}
// Choque de horario: misma fecha y MISMO médico, rangos que se pisan. Las canceladas / no asistió no ocupan.
function clinicaChoqueCita(nueva, existentes, ignorarId) {
  if (!nueva.medico_id) return null;
  const ini = vetHoraMin(nueva.hora), fin = ini + Number(nueva.duracion_min || 30);
  return (existentes || []).find(c => {
    if (c.id === ignorarId || c.fecha !== nueva.fecha || c.medico_id !== nueva.medico_id) return false;
    if (c.estado === 'cancelada' || c.estado === 'no_asistio') return false;
    const ci = vetHoraMin(c.hora), cf = ci + Number(c.duracion_min || 30);
    return ini < cf && ci < fin;
  }) || null;
}
// Los 7 días (lunes a domingo) de la semana que contiene 'ymd'.
function clinicaSemana(ymd) {
  const dow = new Date(Date.UTC(...(p => [p.y, p.m - 1, p.d])(vetPartes(ymd)))).getUTCDay();   // 0 = domingo
  const lunes = vetSumarDias(ymd, dow === 0 ? -6 : 1 - dow);
  return Array.from({ length: 7 }, (_, i) => vetSumarDias(lunes, i));
}
function clinicaMensajeCita({ paciente, negocio, fecha, hora, medico }) {
  const saludo = paciente ? `Hola ${paciente}` : 'Hola';
  return `${saludo}, le saludamos de ${negocio || 'su clínica'} 🩺. Le recordamos su cita${medico ? ` con ${medico}` : ''} el ${vetFechaLarga(fecha)} a las ${vetFormatoHora(hora)}. Si necesita cambiarla, avísenos. ¡Le esperamos!`;
}

/* ---------- Paciente ---------- */
// Edad para personas: "34 años", "2 años 3 meses", "8 meses", "12 días".
function clinicaEdad(nacimiento, hoy) {
  if (!nacimiento) return '—';
  const h = vetPartes(hoy || vetHoy()), n = vetPartes(nacimiento);
  let anios = h.y - n.y, meses = h.m - n.m;
  if (h.d < n.d) meses--;
  if (meses < 0) { anios--; meses += 12; }
  if (anios < 0) return '—';
  if (anios >= 3) return `${anios} años`;
  if (anios >= 1) return `${anios} ${anios === 1 ? 'año' : 'años'}${meses ? ` ${meses} ${meses === 1 ? 'mes' : 'meses'}` : ''}`;
  if (meses >= 1) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const d = vetDiasEntre(nacimiento, hoy || vetHoy());
  return d <= 0 ? 'Recién nacido' : `${d} ${d === 1 ? 'día' : 'días'}`;
}
function clinicaAnios(nacimiento, hoy) {
  if (!nacimiento) return null;
  const h = vetPartes(hoy || vetHoy()), n = vetPartes(nacimiento);
  let a = h.y - n.y; if (h.m < n.m || (h.m === n.m && h.d < n.d)) a--;
  return a < 0 ? null : a;
}
function clinicaNombrePaciente(p) { return `${p?.nombres || ''} ${p?.apellidos || ''}`.trim() || 'Sin nombre'; }
const CLINICA_TIPOS_SANGRE = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/* ---------- Signos vitales ---------- */
// Rangos aceptados (los mismos que exige la base de datos) y avisos de valores fuera de lo normal en adultos.
const CLINICA_SIGNOS = {
  pa_sistolica:  { n: 'Presión sistólica', u: 'mmHg', min: 40, max: 300, entero: true },
  pa_diastolica: { n: 'Presión diastólica', u: 'mmHg', min: 20, max: 200, entero: true },
  fc:            { n: 'Frecuencia cardiaca', u: 'lpm', min: 20, max: 300, entero: true },
  fr:            { n: 'Frecuencia respiratoria', u: 'rpm', min: 4, max: 80, entero: true },
  temperatura:   { n: 'Temperatura', u: '°C', min: 30, max: 45, dec: 1 },
  spo2:          { n: 'Saturación de oxígeno', u: '%', min: 40, max: 100, entero: true },
  peso_kg:       { n: 'Peso', u: 'kg', min: 0.2, max: 400, dec: 2 },
  talla_cm:      { n: 'Talla', u: 'cm', min: 20, max: 250, dec: 1 },
  glucosa_mg_dl: { n: 'Glucosa', u: 'mg/dl', min: 10, max: 1500, dec: 1 },
};
// Devuelve el primer error en texto, o '' si todo está bien. 'valores' = { campo: texto }.
function clinicaValidarSignos(valores) {
  for (const [k, r] of Object.entries(CLINICA_SIGNOS)) {
    const crudo = String(valores?.[k] ?? '').trim();
    if (crudo === '') continue;
    const n = Number(crudo.replace(',', '.'));
    if (!Number.isFinite(n)) return `${r.n}: escribe solo números.`;
    if (r.entero && !Number.isInteger(n)) return `${r.n}: debe ser un número entero.`;
    if (n < r.min || n > r.max) return `${r.n}: debe estar entre ${r.min} y ${r.max} ${r.u}.`;
  }
  const s = Number(valores?.pa_sistolica), d = Number(valores?.pa_diastolica);
  const tieneS = String(valores?.pa_sistolica ?? '').trim() !== '', tieneD = String(valores?.pa_diastolica ?? '').trim() !== '';
  if (tieneS !== tieneD) return 'Presión arterial: escribe los dos valores (alta y baja).';
  if (tieneS && tieneD && d >= s) return 'Presión arterial: la baja (diastólica) debe ser menor que la alta (sistólica).';
  return '';
}
function clinicaNumero(v) { const t = String(v ?? '').trim().replace(',', '.'); return t === '' ? null : Number(t); }
// IMC = peso (kg) / talla (m)². Redondeado a 2 decimales, igual que la base de datos.
function clinicaIMC(pesoKg, tallaCm) {
  const p = Number(pesoKg), t = Number(tallaCm);
  if (!(p > 0) || !(t > 0)) return null;
  return Math.round((p / Math.pow(t / 100, 2)) * 100) / 100;
}
function clinicaClasificarIMC(imc, anios) {
  if (imc == null) return null;
  if (anios != null && anios < 18) return { texto: 'Menor de 18 años: valorar con tablas de crecimiento', clase: 'gris' };
  if (imc < 18.5) return { texto: 'Bajo peso', clase: 'ambar' };
  if (imc < 25) return { texto: 'Peso normal', clase: 'verde' };
  if (imc < 30) return { texto: 'Sobrepeso', clase: 'ambar' };
  return { texto: 'Obesidad', clase: 'rojo' };
}
// Avisos (no bloquean) de signos fuera de lo esperado en un adulto.
function clinicaAlertasSignos(v) {
  const a = [], n = k => clinicaNumero(v?.[k]);
  if (n('pa_sistolica') >= 140 || n('pa_diastolica') >= 90) a.push('Presión arterial alta');
  else if (n('pa_sistolica') != null && n('pa_sistolica') < 90) a.push('Presión arterial baja');
  if (n('temperatura') >= 38) a.push('Fiebre');
  if (n('spo2') != null && n('spo2') < 92) a.push('Saturación de oxígeno baja');
  if (n('fc') != null && (n('fc') > 100 || n('fc') < 50)) a.push(n('fc') > 100 ? 'Frecuencia cardiaca alta' : 'Frecuencia cardiaca baja');
  if (n('glucosa_mg_dl') != null && (n('glucosa_mg_dl') >= 200 || n('glucosa_mg_dl') < 70)) a.push(n('glucosa_mg_dl') < 70 ? 'Glucosa baja' : 'Glucosa alta');
  return a;
}
function clinicaTextoPA(c) { return c?.pa_sistolica && c?.pa_diastolica ? `${c.pa_sistolica}/${c.pa_diastolica}` : null; }

/* ---------- Notas ---------- */
const CLINICA_ESTADOS_NOTA = {
  borrador: { n: 'Borrador (sin cerrar)', clase: 'ambar' },
  cerrada:  { n: 'Cerrada y firmada',     clase: 'verde' },
  anulada:  { n: 'Anulada',               clase: 'rojo' },
};
// Errores de la base de datos -> texto para el usuario.
function clinicaTextoError(e, porDefecto) {
  const m = String(e?.message || e || '');
  const tabla = {
    clinica_sesion_invalida: 'Tu sesión médica se cerró. Escribe tu código de nuevo.',
    clinica_choque_horario: 'Ese médico ya tiene una cita a esa hora. Elige otra hora.',
    clinica_cita_pasa_medianoche: 'La cita debe terminar antes de la medianoche.',
    clinica_fecha_nacimiento_invalida: 'La fecha de nacimiento no puede ser futura.',
    clinica_cita_cobrada: 'Esta visita ya fue cobrada: su cuenta ya no se puede cambiar.',
    clinica_nota_cerrada: 'Una nota cerrada no se modifica: agrega una adenda.',
    clinica_cita_con_consulta: 'Esa cita ya tiene una consulta: no se puede cambiar de paciente.',
    clinica_pacientes_cedula: 'Ya existe un paciente con esa cédula.',
  };
  for (const [k, t] of Object.entries(tabla)) if (m.includes(k)) return t;
  if (m.includes('duplicate key') && m.includes('cedula')) return tabla.clinica_pacientes_cedula;
  if (m.includes('violates foreign key') || m.includes('_fkey')) return 'Este registro tiene historial y no se puede borrar: archívalo.';
  return porDefecto || 'No se pudo completar. Intenta de nuevo.';
}
const CLINICA_MOTIVOS_RPC = {
  solo_enfermeria: 'Enfermería solo escribe notas de enfermería (con signos). Ingreso, evolución, indicaciones y alta son del médico.',
  falta_motivo: 'Escribe el motivo.', proximo_control: 'El próximo control no puede ser una fecha pasada.',
  cita: 'Esa cita ya no está disponible para atender.', cita_con_nota: 'Esa cita ya tiene una nota de consulta.',
  no_borrador: 'Esta nota ya está cerrada: no se puede modificar.', no_autor: 'Solo el médico que escribió la nota puede hacer esto.',
  incompleta: 'Para cerrar la nota escribe al menos el diagnóstico o el plan.', no_cerrada: 'Solo se agregan adendas a notas cerradas.',
  texto: 'Escribe el texto.', ya_anulada: 'Esta nota ya estaba anulada.', sin_permiso: 'Necesitas el código de administrador.',
  incorrecto: 'Código incorrecto.', bloqueado: 'Demasiados intentos fallidos. Espera unos minutos.',
  pin_formato: 'El PIN debe tener de 4 a 8 números.', pin_requerido: 'Médicos y administradores necesitan un PIN (4 a 8 números).',
  nombre: 'Escribe el nombre.', rol: 'Elige el rol.', consultorio: 'Ese consultorio no existe.', no_encontrado: 'No se encontró.',
  sin_pin: 'Este usuario todavía no tiene código. Defínelo en el menú de usuarios.',
  sin_acceso_clinico: 'Tu usuario no está marcado como médico: no tiene acceso al expediente clínico.', formato: 'El código debe tener de 4 a 12 números.',
  incompleto: 'Faltan datos obligatorios del documento.', tipo: 'Tipo de documento no válido.', contenido: 'El documento es demasiado grande.',
  consulta: 'Esa consulta no es de este paciente.', ya_en_farmacia: 'Esta receta ya está en Farmacia.', tipo_archivo: 'Solo se aceptan PDF, JPG, PNG o WEBP.',
  tamano: 'El archivo es muy grande (máximo 10 MB).', archivo_no_llego: 'El archivo no terminó de subir. Intenta de nuevo.',
  perfil: 'Elige un usuario del sistema.', perfil_repetido: 'Ese usuario ya está en la lista de médicos.',
  profesional: 'Esa columna de la Agenda no existe.', profesional_repetido: 'Esa columna de la Agenda ya es de otro médico.',
  usar_usuarios: 'El código se cambia en el menú de usuarios del sistema.', sin_usuario: 'Esta persona no está ligada a un usuario del sistema.',
  estancia_cerrada: 'Esta estancia ya tiene alta: no admite más notas.', signos: 'Revisa los signos vitales: hay un valor fuera de rango.',
  honorario: 'Revisa el honorario: el porcentaje va de 0 a 100.', empleado: 'Ese empleado no existe en Salarios.', fechas: 'Revisa las fechas (máximo 2 años).',
};
function clinicaTextoMotivo(r) {
  if (!r) return 'No se pudo completar. Intenta de nuevo.';
  if (r.motivo === 'bloqueado') { const m = Math.max(1, Math.ceil((r.bloqueado_seg || 60) / 60)); return `Demasiados intentos fallidos. Espera ${m} minuto${m === 1 ? '' : 's'}.`; }
  if (r.motivo === 'incorrecto' && r.restantes > 0 && r.restantes <= 3) return `Código incorrecto (te quedan ${r.restantes} intento${r.restantes === 1 ? '' : 's'}).`;
  return CLINICA_MOTIVOS_RPC[r.motivo] || 'No se pudo completar. Intenta de nuevo.';
}

const CLINICA_ACCIONES_BITACORA = {
  inicio_sesion: '🔓 Entró con su código', cierre_sesion: '🔒 Cerró su sesión', pin_incorrecto: '⚠️ Código incorrecto', bloqueo: '⛔ Bloqueo por intentos',
  abrir_expediente: '📂 Abrió el expediente', editar_antecedentes: '✏️ Editó antecedentes', crear_nota: '📝 Creó una nota',
  editar_borrador: '✏️ Editó un borrador', cerrar_nota: '✅ Cerró y firmó una nota', adenda: '➕ Agregó una adenda',
  anular_nota: '🚫 Anuló una nota', personal_creado: '👤 Marcó a un médico', personal_editado: '👤 Editó un médico',
  pin_definido: '🔑 Asignó un PIN', pin_cambiado: '🔑 Cambió su PIN', ver_bitacora: '🕵️ Revisó la bitácora',
  emitir_documento: '📄 Emitió un documento', anular_documento: '🚫 Anuló un documento', receta_a_farmacia: '💊 Pasó una receta a Farmacia',
  subir_adjunto: '📎 Subió un archivo', ver_adjunto: '👁️ Abrió un archivo', anular_adjunto: '🚫 Anuló un archivo',
  ver_reporte: '📊 Vio el reporte clínico', nota_estancia: '🛏️ Escribió en una estancia', ver_estancia: '🛏️ Abrió las notas de una estancia',
};

/* =====================================================
   FASE 3 -- sala de espera, honorarios y reportes (puras)
===================================================== */
const _r2c = n => Math.round((Number(n) || 0) * 100) / 100;
// "María José López" -> "María L." (para la pantalla de la sala: no muestra el nombre completo).
function clinicaNombreCorto(p) {
  const n = String(p?.nombres || '').trim().split(/\s+/)[0] || 'Paciente';
  const a = String(p?.apellidos || '').trim();
  return a ? `${n} ${a[0].toUpperCase()}.` : n;
}
// Turnos de hoy: los que llegaron, en orden de llegada (número fijo por llegada), y cuánto llevan esperando.
function clinicaTurnos(citas, ahoraMs) {
  const ahora = ahoraMs || Date.now();
  const llegaron = (citas || []).filter(c => c.llegada_en && ['en_espera', 'en_consulta', 'atendida'].includes(c.estado))
    .slice().sort((a, b) => String(a.llegada_en).localeCompare(String(b.llegada_en)));
  return llegaron.map((c, i) => ({ ...c, turno: i + 1,
    espera_min: c.estado === 'en_espera' ? Math.max(0, Math.floor((ahora - new Date(c.llegada_en).getTime()) / 60000)) : null }));
}
// Fila de espera: los urgentes primero (por orden de llegada) y luego los demás por su turno.
function clinicaOrdenEspera(turnos) {
  return (turnos || []).filter(t => t.estado === 'en_espera').slice()
    .sort((a, b) => ((b.prioridad === 'urgente') - (a.prioridad === 'urgente')) || (a.turno - b.turno));
}
// Hora actual "HH:MM" (para la visita de quien llega sin cita).
function clinicaHoraAhora(d) { const x = d || new Date(); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; }
function clinicaTextoEspera(min) {
  if (min == null) return '';
  if (min < 1) return 'recién llegó';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
// Neto cobrado de una venta = total - devoluciones vigentes. Factor = qué parte de la venta sigue cobrada.
function clinicaNetoVenta(venta, devoluciones) {
  if (!venta || venta.estado !== 'completada') return { neto: 0, factor: 0 };
  const total = Number(venta.total) || 0;
  const devuelto = (devoluciones || []).filter(d => d.venta_id === venta.id && d.estado !== 'anulada').reduce((t, d) => t + (Number(d.total) || 0), 0);
  const neto = _r2c(Math.max(0, total - devuelto));
  return { neto, factor: total > 0 ? neto / total : 0 };
}
// Honorarios por médico. Porcentaje: sobre los SERVICIOS cobrados (no medicamentos), proporcional a lo
// que no se devolvió. Monto fijo: por cada consulta atendida y cobrada (si no se devolvió completa).
// Las citas que ya están en una liquidación pagada no se vuelven a contar.
function clinicaCalcularHonorarios({ medico, citas, ventas, detalles, devoluciones, pagadas }) {
  const yaPagadas = new Set(pagadas || []);
  const porVenta = {}; (detalles || []).forEach(d => { (porVenta[d.venta_id] = porVenta[d.venta_id] || []).push(d); });
  const res = { lineas: [], monto: 0, base: 0, sinCobrar: 0, yaPagadas: 0 };
  (citas || []).filter(c => c.medico_id === medico.id && c.estado === 'atendida').forEach(c => {
    if (yaPagadas.has(c.id)) { res.yaPagadas++; return; }
    const v = (ventas || []).find(x => x.id === c.venta_id);
    if (!v || v.estado !== 'completada') { res.sinCobrar++; return; }
    const { neto, factor } = clinicaNetoVenta(v, devoluciones);
    const servicios = (porVenta[v.id] || []).filter(d => d.tipo_item === 'servicio').reduce((t, d) => t + (Number(d.subtotal) || 0), 0);
    // Con seguro: el paciente pagó su parte y la aseguradora el resto (cubierto_servicios): el honorario es sobre el total.
    const base = _r2c(servicios * factor + (Number(c.cubierto_servicios) || 0));
    let monto = 0;
    if (medico.honorario_tipo === 'porcentaje') monto = _r2c(base * (Number(medico.honorario_valor) || 0) / 100);
    else if (medico.honorario_tipo === 'monto') monto = neto > 0 || Number(c.monto_cubierto) > 0 ? _r2c(medico.honorario_valor) : 0;
    res.lineas.push({ cita_id: c.id, fecha: c.fecha, venta: v.numero_venta, neto, base, monto });
    res.base = _r2c(res.base + base); res.monto = _r2c(res.monto + monto);
  });
  return res;
}
// Resumen para Reportes: por médico (citas, atendidas, no asistió, cobrado neto) y por servicio/producto.
function clinicaResumenReporte({ citas, ventas, detalles, devoluciones, medicos }) {
  const vPorId = {}; (ventas || []).forEach(v => { vPorId[v.id] = v; });
  const fila = () => ({ citas: 0, atendidas: 0, no_asistio: 0, canceladas: 0, cobrado: 0, sin_cobrar: 0, cubierto: 0 });
  const total = fila(), porMedico = {};
  const ventasContadas = new Set();
  (citas || []).forEach(c => {
    const k = c.medico_id || '_sin';
    const f = porMedico[k] = porMedico[k] || fila();
    [f, total].forEach(x => {
      x.citas++;
      if (c.estado === 'atendida') x.atendidas++;
      if (c.estado === 'no_asistio') x.no_asistio++;
      if (c.estado === 'cancelada') x.canceladas++;
    });
    const v = vPorId[c.venta_id];
    if (v && v.estado === 'completada' && Number(c.monto_cubierto) > 0) { f.cubierto = _r2c(f.cubierto + Number(c.monto_cubierto)); total.cubierto = _r2c(total.cubierto + Number(c.monto_cubierto)); }
    if (v && v.estado === 'completada' && !ventasContadas.has(v.id)) {
      ventasContadas.add(v.id);
      const { neto } = clinicaNetoVenta(v, devoluciones);
      f.cobrado = _r2c(f.cobrado + neto); total.cobrado = _r2c(total.cobrado + neto);
    } else if (c.estado === 'atendida' && !(v && v.estado === 'completada')) { f.sin_cobrar++; total.sin_cobrar++; }
  });
  const servicios = {};
  (detalles || []).filter(d => ventasContadas.has(d.venta_id)).forEach(d => {
    const k = d.producto_nombre || '—';
    const s = servicios[k] = servicios[k] || { nombre: k, tipo: d.tipo_item, cantidad: 0, total: 0 };
    s.cantidad = _r2c(s.cantidad + (Number(d.cantidad) || 0)); s.total = _r2c(s.total + (Number(d.subtotal) || 0));
  });
  const nombre = id => (medicos || []).find(m => m.id === id)?.nombre || 'Sin médico asignado';
  return { total, porMedico: Object.entries(porMedico).map(([id, f]) => ({ medico_id: id === '_sin' ? null : id, nombre: id === '_sin' ? 'Sin médico asignado' : nombre(id), ...f }))
    .sort((a, b) => b.citas - a.citas), servicios: Object.values(servicios).sort((a, b) => b.total - a.total) };
}
/* ---------- Cálculos de las plantillas por especialidad ---------- */
// Meses cumplidos entre la fecha de nacimiento y 'hasta' (ISO o YYYY-MM-DD).
function clinicaMesesEdad(nacimiento, hasta) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(nacimiento || '')) return null;
  const n = vetPartes(String(nacimiento).slice(0, 10)), h = vetPartes(String(hasta || vetHoy()).slice(0, 10));
  let m = (h.y - n.y) * 12 + (h.m - n.m); if (h.d < n.d) m--;
  return m >= 0 ? m : null;
}
// Edad gestacional por FUM (regla de Naegele: FPP = FUM + 280 días). Null si la FUM es futura o de hace más de 45 semanas.
function clinicaEdadGestacional(fum, hasta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fum || '')) return null;
  const a = vetPartes(fum), b = vetPartes(String(hasta || vetHoy()).slice(0, 10));
  const dias = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  if (dias < 0 || dias > 45 * 7) return null;
  return { semanas: Math.floor(dias / 7), dias: dias % 7, fpp: vetSumarDias(fum, 280) };
}
function clinicaGlasgow(o, v, m) {
  const [a, b, c] = [o, v, m].map(x => clinicaNumero(x));
  if (a == null || b == null || c == null || a < 1 || a > 4 || b < 1 || b > 5 || c < 1 || c > 6) return null;
  const t = a + b + c;
  return { t: `Glasgow ${t}/15 (O${a} V${b} M${c}): ${t >= 13 ? 'leve' : t >= 9 ? 'moderado' : 'grave'}`, clase: t >= 13 ? (t === 15 ? 'verde' : 'ambar') : 'rojo', total: t };
}
// Terapias (fisioterapia, quiropraxia, masajes…): cuánto bajó el dolor en la sesión y en qué va el plan.
function clinicaCalcTerapia(d) {
  const r = [];
  const a = clinicaNumero(d.eva_antes), b = clinicaNumero(d.eva_despues);
  if (a != null && b != null) r.push({ t: b < a ? `El dolor bajó ${a - b} punto${a - b === 1 ? '' : 's'} en la sesión` : b > a ? `El dolor subió ${b - a} punto${b - a === 1 ? '' : 's'}` : 'El dolor no cambió', clase: b < a ? 'verde' : b > a ? 'rojo' : 'ambar' });
  const n = clinicaNumero(d.sesion), t = clinicaNumero(d.sesiones_plan);
  if (n != null && t != null && t > 0) {
    if (n >= t) r.push({ t: `Sesión ${n} de ${t}: plan completo (valorar el alta)`, clase: 'verde' });
    else r.push({ t: `Sesión ${n} de ${t}: faltan ${t - n}`, clase: 'azul' });
  }
  return r;
}
function clinicaEscalaDolor(v) {
  const n = clinicaNumero(v);
  if (n == null || n < 0 || n > 10) return null;
  return { t: `Dolor ${n}/10: ${n === 0 ? 'sin dolor' : n <= 3 ? 'leve' : n <= 6 ? 'moderado' : 'intenso'}`, clase: n <= 3 ? 'verde' : n <= 6 ? 'ambar' : 'rojo' };
}
// Riesgo por cintura (OMS) e índice cintura/cadera según el sexo del paciente.
function clinicaRiesgoCintura(cintura, cadera, sexo) {
  const ci = clinicaNumero(cintura), ca = clinicaNumero(cadera), mujer = sexo === 'femenino', r = [];
  if (ci != null && sexo) {
    const [alto, muyAlto] = mujer ? [80, 88] : [94, 102];
    r.push(ci >= muyAlto ? { t: `Cintura ${ci} cm: riesgo cardiometabólico muy alto`, clase: 'rojo' } : ci >= alto ? { t: `Cintura ${ci} cm: riesgo aumentado`, clase: 'ambar' } : { t: `Cintura ${ci} cm: sin riesgo aumentado`, clase: 'verde' });
  }
  if (ci != null && ca) {
    const icc = Math.round(ci / ca * 100) / 100, lim = mujer ? 0.85 : 0.9;
    r.push({ t: `Índice cintura/cadera ${icc}${sexo ? (icc > lim ? ' (alto)' : ' (normal)') : ''}`, clase: sexo ? (icc > lim ? 'ambar' : 'verde') : 'azul' });
  }
  return r;
}

/* ---------- Odontograma (numeración FDI) ---------- */
const CLINICA_DIENTES = {
  permanente: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28], [48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
  temporal:   [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65], [85, 84, 83, 82, 81], [71, 72, 73, 74, 75]],
};
const CLINICA_ESTADOS_DIENTE = {
  sano:        { n: 'Sano',              c: '#ffffff', b: '#cbd5e1', ic: '' },
  caries:      { n: 'Caries',            c: '#fee2e2', b: '#dc2626', ic: '●', caras: true },
  obturado:    { n: 'Obturado',          c: '#dbeafe', b: '#2563eb', ic: '■', caras: true },
  sellante:    { n: 'Sellante',          c: '#dcfce7', b: '#16a34a', ic: 'S', caras: true },
  endodoncia:  { n: 'Endodoncia',        c: '#ede9fe', b: '#7c3aed', ic: 'E' },
  corona:      { n: 'Corona',            c: '#fef3c7', b: '#d97706', ic: '◯' },
  fractura:    { n: 'Fractura',          c: '#ffedd5', b: '#ea580c', ic: '⚡' },
  por_extraer: { n: 'Extracción indicada', c: '#fecaca', b: '#991b1b', ic: '✕' },
  ausente:     { n: 'Ausente / extraído', c: '#e5e7eb', b: '#6b7280', ic: '—' },
  implante:    { n: 'Implante',          c: '#e0f2fe', b: '#0284c7', ic: 'I' },
};
const CLINICA_CARAS = { O: 'Oclusal / incisal', M: 'Mesial', D: 'Distal', V: 'Vestibular', L: 'Lingual / palatina' };
function clinicaDientesDe(denticion) {
  const d = denticion === 'Temporal' ? ['temporal'] : denticion === 'Mixta' ? ['permanente', 'temporal'] : ['permanente'];
  return d.flatMap(k => CLINICA_DIENTES[k].flat());
}
// Deja solo dientes válidos, estados conocidos, caras válidas y notas cortas (lo que se guarda en la nota).
function clinicaLimpiarOdontograma(o) {
  const out = {}, validos = new Set([...CLINICA_DIENTES.permanente.flat(), ...CLINICA_DIENTES.temporal.flat()].map(String));
  Object.entries(o && typeof o === 'object' ? o : {}).forEach(([k, v]) => {
    if (!validos.has(String(k)) || !v || !CLINICA_ESTADOS_DIENTE[v.e] || v.e === 'sano' && !v.n) return;
    const caras = CLINICA_ESTADOS_DIENTE[v.e].caras ? [...new Set((Array.isArray(v.s) ? v.s : []).filter(c => CLINICA_CARAS[c]))] : [];
    out[k] = { e: v.e, ...(caras.length ? { s: caras } : {}), ...(v.n ? { n: String(v.n).slice(0, 200) } : {}) };
  });
  return out;
}
// Índices CPO-D (permanentes) y ceo-d (temporales): cariados (incl. extracción indicada), perdidos/extraídos, obturados.
function clinicaIndicesDentales(o) {
  const od = clinicaLimpiarOdontograma(o), perm = new Set(CLINICA_DIENTES.permanente.flat().map(String));
  const cuenta = { P: { c: 0, p: 0, o: 0 }, T: { c: 0, p: 0, o: 0 } };
  Object.entries(od).forEach(([k, v]) => {
    const g = cuenta[perm.has(k) ? 'P' : 'T'];
    if (v.e === 'caries' || v.e === 'por_extraer') g.c++;
    else if (v.e === 'ausente') g.p++;
    else if (v.e === 'obturado' || v.e === 'corona' || v.e === 'endodoncia') g.o++;
  });
  const r = [], tP = cuenta.P.c + cuenta.P.p + cuenta.P.o, tT = cuenta.T.c + cuenta.T.p + cuenta.T.o;
  const nCaries = Object.values(od).filter(v => v.e === 'caries').length, nExt = Object.values(od).filter(v => v.e === 'por_extraer').length;
  if (Object.keys(od).length) {
    r.push({ t: `CPO-D ${tP} (cariados ${cuenta.P.c}, perdidos ${cuenta.P.p}, obturados ${cuenta.P.o})`, clase: tP ? 'azul' : 'verde' });
    if (tT) r.push({ t: `ceo-d ${tT} (cariados ${cuenta.T.c}, extraídos ${cuenta.T.p}, obturados ${cuenta.T.o})`, clase: 'azul' });
    if (nCaries) r.push({ t: `${nCaries} diente${nCaries === 1 ? '' : 's'} con caries por tratar`, clase: 'ambar' });
    if (nExt) r.push({ t: `${nExt} extracción${nExt === 1 ? '' : 'es'} indicada${nExt === 1 ? '' : 's'}`, clase: 'rojo' });
  }
  return r;
}
// Avisos y cálculos de la plantilla de una especialidad (ctx: { fecha, nacimiento, sexo }).
function clinicaCalculosEspecialidad(especialidad, datos, ctx) {
  const esp = CLINICA_ESPECIALIDADES[especialidad];
  if (!esp || typeof esp.calc !== 'function') return [];
  try { return esp.calc(datos || {}, ctx || {}) || []; } catch (_) { return []; }
}
// Lo que se muestra de la plantilla en la nota: [{ n, v }] (texto plano; se escapa al pintar).
function clinicaResumenDatos(especialidad, datos) {
  const esp = CLINICA_ESPECIALIDADES[especialidad], d = datos || {};
  if (!esp) return [];
  return esp.campos.filter(f => f.tipo !== 'odontograma' && d[f.k] != null && String(d[f.k]).trim() !== '')
    .map(f => ({ n: f.n, v: f.tipo === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(d[f.k]) ? vetFechaLarga(d[f.k]) : `${d[f.k]}${f.u ? ' ' + f.u : ''}` }));
}
// Valida los números de la plantilla (rangos). Devuelve el primer error o ''.
function clinicaValidarDatos(especialidad, datos) {
  const esp = CLINICA_ESPECIALIDADES[especialidad], d = datos || {};
  for (const f of (esp?.campos || [])) {
    if (f.tipo !== 'number' || d[f.k] == null || d[f.k] === '') continue;
    const n = clinicaNumero(d[f.k]);
    if (n == null || Number.isNaN(n)) return `"${f.n}" debe ser un número.`;
    if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) return `"${f.n}" debe estar entre ${f.min} y ${f.max}${f.u ? ' ' + f.u : ''}.`;
  }
  if (d.fum && d.embarazo === 'Sí' && !clinicaEdadGestacional(d.fum)) return 'Revisa la FUM: no puede ser futura ni de hace más de 45 semanas.';
  return '';
}

/* ---------- Fase 5: observación / hospitalización y seguros ---------- */
const CLINICA_TIPOS_ESTANCIA = { observacion: { e: '🛋️', n: 'Observación' }, hospitalizacion: { e: '🛏️', n: 'Hospitalización' } };
const CLINICA_TIPOS_NOTA_ESTANCIA = { ingreso: '📥 Ingreso', evolucion: '📈 Evolución', enfermeria: '💉 Enfermería', indicaciones: '📋 Indicaciones', alta: '🏁 Alta' };
// Unidades a cobrar: hospitalización = días (cada 24 h o fracción, mínimo 1); observación = 1.
function clinicaDiasEstancia(ingreso, alta, tipo, ahoraMs) {
  if (tipo !== 'hospitalizacion') return 1;
  const ini = new Date(ingreso).getTime(), fin = alta ? new Date(alta).getTime() : (ahoraMs || Date.now());
  if (!(ini > 0) || !(fin >= ini)) return 1;
  return Math.max(1, Math.ceil((fin - ini) / 86400000));
}
function clinicaDuracionTexto(ingreso, alta, ahoraMs) {
  const min = Math.max(0, Math.floor(((alta ? new Date(alta).getTime() : (ahoraMs || Date.now())) - new Date(ingreso).getTime()) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}
// Cobro de una estancia (mismo formato que el cobro de la Agenda): servicio × unidades + cargos al precio del catálogo.
function clinicaCobroEstancia(estancia, servicio, cargos, ahoraMs) {
  const items = [], sinCatalogo = [];
  const sumar = (producto_id, cantidad, total) => {
    const ya = items.find(x => x.producto_id === producto_id);
    if (ya) { ya.cantidad = _r2c(ya.cantidad + cantidad); ya.total = _r2c(ya.total + total); }
    else items.push({ producto_id, cantidad: _r2c(cantidad), total: _r2c(total) });
  };
  const unidades = clinicaDiasEstancia(estancia.ingreso_en, estancia.alta_en, estancia.tipo, ahoraMs);
  if (servicio && servicio.id) sumar(servicio.id, unidades, unidades * (Number(servicio.precio) || 0));
  (cargos || []).forEach(x => {
    if (x.producto_id && x.productos) sumar(x.producto_id, Number(x.cantidad) || 1, (Number(x.cantidad) || 1) * (Number(x.productos.precio) || 0));
    else sinCatalogo.push(x.descripcion);
  });
  return { unidades, items, sinCatalogo };
}
// ¿El convenio del paciente aplica hoy? (activo y póliza sin vencer)
function clinicaConvenioVigente(paciente, convenio, hoy) {
  if (!paciente || !convenio || paciente.convenio_id !== convenio.id || !convenio.activo) return false;
  if (!(Number(convenio.cobertura_pct) > 0)) return false;
  return !paciente.poliza_vence || paciente.poliza_vence >= (hoy || vetHoy());
}
// Reparte la cuenta con el seguro: el paciente paga (100 - cobertura)% de cada línea; la aseguradora el resto.
// tipos: { producto_id: 'servicio' | 'producto' } para saber cuánto de lo cubierto son servicios (honorarios).
function clinicaAplicarConvenio(items, pct, tipos) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  let cubierto = 0, cubiertoServicios = 0;
  const paciente = (items || []).map(it => {
    const total = _r2c(Number(it.total) || 0), pagaPaciente = _r2c(total * (100 - p) / 100), cubre = _r2c(total - pagaPaciente);
    cubierto = _r2c(cubierto + cubre);
    if ((tipos || {})[it.producto_id] === 'servicio') cubiertoServicios = _r2c(cubiertoServicios + cubre);
    return { ...it, total: pagaPaciente };
  });
  return { paciente, cubierto, cubiertoServicios, totalPaciente: _r2c(paciente.reduce((t, x) => t + x.total, 0)) };
}
// Citas cobradas con seguro que todavía no se facturan a la aseguradora (por convenio).
function clinicaPendientesSeguro(citas, reclamos) {
  const yaFacturadas = new Set((reclamos || []).filter(r => r.estado !== 'anulado').flatMap(r => r.citas || []));
  const porConvenio = {};
  (citas || []).filter(c => c.convenio_id && Number(c.monto_cubierto) > 0 && c.venta_id && !yaFacturadas.has(c.id)).forEach(c => {
    const g = porConvenio[c.convenio_id] = porConvenio[c.convenio_id] || { convenio_id: c.convenio_id, citas: [], monto: 0 };
    g.citas.push(c); g.monto = _r2c(g.monto + Number(c.monto_cubierto));
  });
  return Object.values(porConvenio);
}

/* ---------- Citas de la Agenda vistas por la clínica ---------- */
// Una cita de la Agenda (agenda_citas + servicios) + lo propio de la clínica (clinica_cita_info) en la
// forma que usan la sala, los reportes y el expediente. El médico es el primer servicio cuyo profesional
// está ligado a un médico; el paciente, el ligado a la cita o el que tiene el mismo cliente.
function clinicaCitaDeAgenda(a, { info, medicos, pacientes, clientes } = {}) {
  const lin = (a.agenda_citas_servicios || []).slice()
    .sort((x, y) => String(x.hora_inicio).localeCompare(String(y.hora_inicio)) || (Number(x.orden) || 0) - (Number(y.orden) || 0));
  const meds = medicos || [], pacs = pacientes || [], i = info || {};
  const med = lin.map(l => l.profesional_id && meds.find(m => m.agenda_profesional_id === l.profesional_id)).find(Boolean) || null;
  const pac = (i.paciente_id && pacs.find(p => p.id === i.paciente_id)) || (a.cliente_id && pacs.find(p => p.cliente_id === a.cliente_id)) || null;
  let estado;
  if (a.estado === 'cancelada' || a.estado === 'no_asistio') estado = a.estado;
  else if (a.estado === 'completada' || i.atendida_en) estado = 'atendida';
  else if (a.estado === 'en_atencion') estado = 'en_consulta';
  else if (i.llegada_en) estado = 'en_espera';
  else estado = a.estado === 'confirmada' ? 'confirmada' : 'programada';
  const telCliente = a.cliente_id ? ((clientes || []).find(c => c.id === a.cliente_id)?.telefono || '') : '';
  return {
    id: a.id, fecha: a.fecha, hora: lin[0] ? String(lin[0].hora_inicio).slice(0, 5) : '',
    duracion_min: lin[0] ? Number(lin[0].duracion_min) || 30 : 30, estado, estado_agenda: a.estado,
    venta_id: a.venta_id || null, notas: a.notas || '', cliente_id: a.cliente_id || null, cliente_nombre: a.cliente_nombre || '',
    paciente_id: pac ? pac.id : null, paciente: pac,
    clinica_pacientes: pac || { nombres: a.cliente_nombre || 'Sin nombre', apellidos: '', telefono: a.cliente_telefono || telCliente },
    telefono: (pac && pac.telefono) || a.cliente_telefono || telCliente || '',
    medico_id: med ? med.id : null, consultorio_id: i.consultorio_id || (med && med.consultorio_id) || null,
    llegada_en: i.llegada_en || null, llamado_en: i.llamado_en || null, atendida_en: i.atendida_en || null,
    recordatorio_enviado_en: i.recordatorio_enviado_en || null,
    prioridad: i.prioridad === 'urgente' ? 'urgente' : 'normal', sin_cita: i.sin_cita === true,
    convenio_id: i.convenio_id || null, cobertura_pct: i.cobertura_pct != null ? Number(i.cobertura_pct) : null,
    monto_cubierto: Number(i.monto_cubierto) || 0, cubierto_servicios: Number(i.cubierto_servicios) || 0,
    servicios: lin.map(l => l.servicio_nombre), motivo: lin.map(l => l.servicio_nombre).join(', '),
  };
}
// Datos para cobrar por el camino de la Agenda (n360_agenda_cobro): los servicios de la cita con el
// precio acordado + lo agregado a la cuenta de la visita (al precio del catálogo).
function clinicaCobroAgenda(cita, cargos) {
  const items = [], sinCatalogo = [];
  const sumar = (producto_id, cantidad, total) => {
    const ya = items.find(x => x.producto_id === producto_id);
    if (ya) { ya.cantidad = _r2c(ya.cantidad + cantidad); ya.total = _r2c(ya.total + total); }
    else items.push({ producto_id, cantidad: _r2c(cantidad), total: _r2c(total) });
  };
  (cita.agenda_citas_servicios || []).forEach(l => {
    if (l.producto_id) sumar(l.producto_id, 1, Number(l.precio) || 0);
    else sinCatalogo.push(`${l.servicio_nombre} (${(Number(l.precio) || 0).toFixed(2)})`);
  });
  (cargos || []).forEach(x => {
    if (x.producto_id && x.productos) sumar(x.producto_id, Number(x.cantidad) || 1, (Number(x.cantidad) || 1) * (Number(x.productos.precio) || 0));
    else sinCatalogo.push(x.descripcion);
  });
  return { citaId: cita.id, clienteId: cita.cliente_id || null, cliente: cita.cliente_nombre || '', items, sinCatalogo };
}
/* ---------- Cobrar en la Clínica (pantalla propia) ----------
   La Clínica muestra SU pantalla de cobro (paciente, conceptos, impuestos, total, forma de pago, recibido y
   cambio). La venta se registra con el MISMO motor de Ventas, que trabaja sin mostrarse
   (ventas.html?clinica_cobro=1&motor=1): mismos cálculos, candados, Caja, inventario, lotes, impuestos,
   contabilidad y reportes. Nada se calcula aparte, por eso todo cuadra igual que una venta normal.
   Quien llama deja preparado lo que se cobra (n360_agenda_cobro, n360_clinica_cobro o n360_receta_a_vender).
   Pago separado (varias formas de pago): aquí mismo, con el pago separado de Ventas.
   Casos especiales (puntos, certificados): "Otras opciones" muestra la venta completa. */
const _CL_COBRO = { abierto: false, alTerminar: null, alCerrar: null, ventaId: null, vigia: null, escuchando: false, metodo: null, banco: null, bancos: [], estado: null, cobrando: false, clienteId: null };
const _CL_COBRO_CSS = `#sidebar,#sidebar-overlay,#header,.mobile-menu-btn{display:none!important}
#main{margin-left:0!important;width:100%!important;min-height:0!important}html,body{overflow-x:hidden}`;
const _clEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function _clCobroModal() {
  let m = document.getElementById('cl-cobro');
  if (m) return m;
  const st = document.createElement('style');
  st.textContent = `#cl-cobro{position:fixed;inset:0;z-index:100050;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:16px}
#cl-cobro .clc-caja{background:var(--bg-surface,#fff);color:var(--text-primary);border-radius:18px;width:100%;max-width:560px;max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35)}
#cl-cobro.clc-avanzado .clc-caja{max-width:1100px;height:100%}
#cl-cobro .clc-cab{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border,#e5e7eb)}
#cl-cobro .clc-tit{flex:1;min-width:0;font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cl-cobro .clc-x{flex:none;border:0;background:var(--bg-hover,#f0f0f5);color:var(--text-primary);width:34px;height:34px;border-radius:10px;font-size:16px;cursor:pointer}
#cl-cobro .clc-cuerpo{flex:1;min-height:0;overflow-y:auto;padding:14px 16px}
#cl-cobro .clc-marco-wrap{position:absolute;left:-10000px;top:0;width:1100px;height:800px;visibility:hidden}
#cl-cobro.clc-avanzado .clc-marco-wrap{position:relative;left:0;width:100%;height:100%;visibility:visible;flex:1}
#cl-cobro.clc-avanzado .clc-cuerpo,#cl-cobro.clc-avanzado .clc-pie{display:none}
#cl-cobro iframe{display:block;width:100%;height:100%;border:0;background:var(--bg-base,#f5f5f7)}
#cl-cobro .clc-quien{font-size:13px;color:var(--text-secondary);margin-bottom:10px}
#cl-cobro .clc-quien b{color:var(--text-primary)}
#cl-cobro .clc-linea{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#e5e7eb);font-size:13.5px}
#cl-cobro .clc-linea>span:first-child{flex:1;min-width:0;word-break:break-word}
#cl-cobro .clc-linea>b{flex:none;white-space:nowrap}
#cl-cobro .clc-cant{color:var(--text-muted);font-size:12px}
#cl-cobro .clc-tot{margin-top:10px;font-size:13.5px}
#cl-cobro .clc-tot div{display:flex;justify-content:space-between;padding:3px 0;color:var(--text-secondary)}
#cl-cobro .clc-tot .clc-grande{font-size:22px;font-weight:900;color:var(--text-primary);padding-top:8px;margin-top:4px;border-top:2px solid var(--border,#e5e7eb)}
#cl-cobro .clc-seguro{display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:12px;border-radius:12px;background:var(--accent-soft,#eef);font-size:13.5px;cursor:pointer}
#cl-cobro .clc-seguro input{width:20px;height:20px;flex:none;margin:1px 0 0;accent-color:var(--accent,#6C63FF)}
#cl-cobro .clc-sec{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:16px 0 8px}
#cl-cobro .clc-chips{display:flex;flex-wrap:wrap;gap:8px}
#cl-cobro .clc-chip{border:1.5px solid var(--border,#e5e7eb);background:var(--bg-surface,#fff);color:var(--text-primary);border-radius:12px;padding:10px 14px;font-weight:700;font-size:13.5px;cursor:pointer;flex:1 1 auto;min-width:110px}
#cl-cobro .clc-chip.activo{border-color:var(--accent,#6C63FF);background:var(--accent-soft,#eef);color:var(--accent,#6C63FF)}
#cl-cobro .clc-fila{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
#cl-cobro .clc-fila>div{flex:1 1 140px;min-width:0}
#cl-cobro label.clc-lab{display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:4px}
#cl-cobro .clc-in{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--border,#e5e7eb);background:var(--bg-surface,#fff);color:var(--text-primary);font-size:15px}
#cl-cobro .clc-cambio{font-size:20px;font-weight:900;padding:8px 0}
#cl-cobro .clc-err{color:var(--danger,#dc2626);font-size:13px;font-weight:600;min-height:18px;margin-top:10px}
#cl-cobro .clc-pie{padding:12px 16px;border-top:1px solid var(--border,#e5e7eb);display:flex;flex-direction:column;gap:8px}
#cl-cobro .clc-btn{border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:900;cursor:pointer;background:var(--accent,#6C63FF);color:#fff;width:100%}
#cl-cobro .clc-btn:disabled{opacity:.55;cursor:not-allowed}
#cl-cobro .clc-link{border:0;background:none;color:var(--text-muted);font-size:12.5px;font-weight:700;cursor:pointer;padding:2px}
#cl-cobro .clc-ok{text-align:center;padding:26px 6px}
#cl-cobro .clc-ok-ico{font-size:52px}
#cl-cobro .clc-ok-tit{font-size:20px;font-weight:900;margin:6px 0}
#cl-cobro .clc-cargando{text-align:center;padding:40px 10px;color:var(--text-muted);font-size:13.5px}
@media (max-width:600px){#cl-cobro{padding:0;align-items:stretch}#cl-cobro .clc-caja{border-radius:0;max-width:none}}`;
  document.head.appendChild(st);
  m = document.createElement('div'); m.id = 'cl-cobro'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Cobrar');
  m.innerHTML = `<div class="clc-caja"><div class="clc-cab"><span class="clc-tit" id="clc-tit">💳 Cobrar</span>
      <button type="button" class="clc-x" id="clc-cerrar" aria-label="Cerrar">✕</button></div>
    <div class="clc-cuerpo" id="clc-cuerpo"></div>
    <div class="clc-pie" id="clc-pie"></div>
    <div class="clc-marco-wrap" id="clc-marco-wrap"><iframe id="clc-marco" title="Venta" src="about:blank" tabindex="-1"></iframe></div></div>`;
  document.body.appendChild(m);
  document.getElementById('clc-cerrar').addEventListener('click', clinicaCerrarCobro);
  document.getElementById('clc-marco').addEventListener('load', () => {
    try { const doc = document.getElementById('clc-marco').contentDocument; if (doc && doc.location.href !== 'about:blank') _clCobroPreparar(doc); } catch (_) {}
  });
  return m;
}
function _clCobroPreparar(doc) {
  if (!doc || !doc.documentElement || doc.documentElement.dataset.clCobro === '1') return;
  doc.documentElement.dataset.clCobro = '1';
  const st = doc.createElement('style'); st.textContent = _CL_COBRO_CSS; (doc.head || doc.documentElement).appendChild(st);
}
const _clMotor = () => { try { return document.getElementById('clc-marco').contentWindow.N360MotorVenta || null; } catch (_) { return null; } };
function clinicaAbrirCobro({ titulo, alTerminar, alCerrar, seguro } = {}) {
  if (_CL_COBRO.abierto) return false;
  const m = _clCobroModal();
  Object.assign(_CL_COBRO, { abierto: true, alTerminar: alTerminar || null, alCerrar: alCerrar || null, seguro: seguro || null, ventaId: null, metodo: null, banco: null, bancos: [], estado: null, cobrando: false });
  m.classList.remove('clc-avanzado');
  document.getElementById('clc-tit').textContent = '💳 ' + (titulo || 'Cobrar');
  document.getElementById('clc-cuerpo').innerHTML = '<div class="clc-cargando">Preparando la cuenta…</div>';
  document.getElementById('clc-pie').innerHTML = '';
  if (!_CL_COBRO.escuchando) {
    _CL_COBRO.escuchando = true;
    window.addEventListener('message', async ev => {
      const f = document.getElementById('clc-marco');
      if (!_CL_COBRO.abierto || !f || ev.source !== f.contentWindow || ev.origin !== location.origin) return;
      if (!ev.data || ev.data.tipo !== 'n360_operacion_completada' || !ev.data.ventaId || _CL_COBRO.ventaId) return;
      await _clCobroHecho({ ventaId: ev.data.ventaId, numero: String(ev.data.nota || '').replace(/^Venta\s*/, ''), total: ev.data.monto });
    });
  }
  m.style.display = 'flex';
  _clCargarMotor();
  return true;
}
// Carga (o recarga, p. ej. al aplicar o quitar el seguro) la venta preparada en el motor de Ventas.
function _clCargarMotor() {
  const fr = document.getElementById('clc-marco');
  clearInterval(_CL_COBRO.vigia); let n = 0;
  _CL_COBRO.vigia = setInterval(() => {
    n++;
    try { const d = fr.contentDocument; if (d && d.location.href !== 'about:blank') _clCobroPreparar(d); } catch (_) {}
    const motor = _clMotor();
    if (motor) {
      let e = null; try { e = motor.estado(); } catch (_) {}
      if (e && e.listo) { clearInterval(_CL_COBRO.vigia); _CL_COBRO.estado = e; _clCobroPintar(); return; }
    }
    if (n > 600) { clearInterval(_CL_COBRO.vigia); _clCobroError('No se pudo preparar la cuenta. Revisa tu conexión o usa "Otras opciones".', true); }
  }, 50);
  try { if (fr.contentWindow && fr.contentWindow.location.href !== 'about:blank') { fr.contentWindow.location.replace('ventas.html?clinica_cobro=1&motor=1'); return; } } catch (_) {}
  fr.src = 'ventas.html?clinica_cobro=1&motor=1';
}
function _clCobroError(msg, sinCuenta) {
  if (sinCuenta) document.getElementById('clc-cuerpo').innerHTML = `<div class="clc-cargando" style="color:var(--danger,#dc2626)">${_clEsc(msg)}</div>`;
  else { const e = document.getElementById('clc-err'); if (e) e.textContent = msg; }
  if (sinCuenta) document.getElementById('clc-pie').innerHTML = '<button type="button" class="clc-link" onclick="clinicaCobroAvanzado()">Otras opciones (abrir la venta completa) →</button>';
}
async function _clCobroPintar() {
  const e = _CL_COBRO.estado, r = e.resumen || {}, t = r.texto || {};
  const lineas = e.items.map(i => `<div class="clc-linea"><span>${_clEsc(i.nombre)}<span class="clc-cant" style="display:block">${_clEsc(String(i.cantidad))} × ${_clEsc(i.precioTexto)}</span></span><b>${_clEsc(i.texto)}</b></div>`).join('');
  const metodos = e.metodos.map(mt => `<button type="button" class="clc-chip" data-metodo="${_clEsc(mt.id)}" data-nombre="${_clEsc(mt.nombre)}">${_clEsc(mt.nombre)}</button>`).join('')
    + (e.fiado ? '<button type="button" class="clc-chip" data-metodo="__fiado" data-nombre="Fiado">📒 Fiado (paga después)</button>' : '')
    + (e.separado ? '<button type="button" class="clc-chip" data-metodo="__separado" data-nombre="Pago separado">➗ Pago separado</button>' : '');
  document.getElementById('clc-cuerpo').innerHTML = `
    <div class="clc-quien">Cliente: <b>${_clEsc(e.cliente || 'Consumidor final')}</b></div>
    <div class="clc-lineas">${lineas}</div>
    <div class="clc-tot">
      <div><span>Subtotal</span><span>${_clEsc(t.subtotal)}</span></div>
      ${Number(r.descuento) > 0 ? `<div><span>Descuento</span><span>-${_clEsc(t.descuento)}</span></div>` : ''}
      ${Number(r.impuestos) > 0 ? `<div><span>${_clEsc(e.impuestosTexto)}</span><span>${_clEsc(t.impuestos)}</span></div>` : ''}
      <div class="clc-grande"><span>Total</span><span id="clc-total">${_clEsc(t.cobrar)}</span></div>
    </div>
    ${_CL_COBRO.seguro ? `<label class="clc-seguro"><input type="checkbox" id="clc-seguro" ${_CL_COBRO.seguro.aplicado ? 'checked' : ''}/>
      <span><b>🛡️ Aplicar seguro: ${_clEsc(_CL_COBRO.seguro.nombre)}</b> (cubre el ${_clEsc(String(_CL_COBRO.seguro.pct))}%)<span class="cl-sub" style="display:block">${_CL_COBRO.seguro.aplicado ? 'El paciente paga solo su parte; lo cubierto se factura a la aseguradora en Seguros.' : 'Sin seguro: el paciente paga todo.'}</span></span></label>` : ''}
    <div class="clc-sec">Forma de pago</div>
    <div class="clc-chips" id="clc-metodos">${metodos || '<span class="cl-sub">No hay formas de pago activas: configúralas en Caja.</span>'}</div>
    <div id="clc-bancos-wrap" style="display:none"><div class="clc-sec">¿A qué banco entra?</div><div class="clc-chips" id="clc-bancos"></div></div>
    <div id="clc-separado" style="display:none"></div>
    <div id="clc-efectivo" style="display:none" class="clc-fila">
      <div><label class="clc-lab" for="clc-recibido">Recibido</label><input class="clc-in" id="clc-recibido" type="number" inputmode="decimal" step="any" min="0" placeholder="0.00"/></div>
      <div><label class="clc-lab">Cambio</label><div class="clc-cambio" id="clc-cambio">—</div></div>
    </div>
    <div class="clc-sec">Nota (opcional)</div>
    <input class="clc-in" id="clc-nota" maxlength="300" placeholder="Aparece en la venta"/>
    <div class="clc-err" id="clc-err" role="alert"></div>`;
  document.getElementById('clc-pie').innerHTML = `<button type="button" class="clc-btn" id="clc-cobrar" disabled>Cobrar ${_clEsc(t.cobrar)}</button>
    <button type="button" class="clc-link" onclick="clinicaCobroAvanzado()">Otras opciones (puntos, certificados…) →</button>`;
  document.querySelectorAll('#clc-metodos .clc-chip').forEach(b => b.addEventListener('click', () => _clElegirMetodo(b.dataset.metodo, b.dataset.nombre)));
  document.getElementById('clc-recibido').addEventListener('input', _clCambio);
  document.getElementById('clc-cobrar').addEventListener('click', _clCobrarAhora);
  const seg = document.getElementById('clc-seguro');
  if (seg) seg.addEventListener('change', async () => {
    if (_CL_COBRO.cobrando) { seg.checked = !seg.checked; return; }
    const aplicar = seg.checked;
    document.getElementById('clc-cuerpo').innerHTML = '<div class="clc-cargando">Recalculando la cuenta…</div>'; document.getElementById('clc-pie').innerHTML = '';
    try { await _CL_COBRO.seguro.cambiar(aplicar); _CL_COBRO.seguro.aplicado = aplicar; _CL_COBRO.metodo = null; _CL_COBRO.banco = null; _clCargarMotor(); }
    catch (e) { console.error('cambiar seguro:', e); _clCobroError('No se pudo recalcular la cuenta. Cierra e intenta de nuevo.', true); }
  });
  try { _CL_COBRO.telefono = _clMotor().clienteTelefono() || ''; } catch (_) { _CL_COBRO.telefono = ''; }
  try { _CL_COBRO.bancos = await _clMotor().bancos(); } catch (_) { _CL_COBRO.bancos = []; }
  if (e.metodos.length === 1) _clElegirMetodo(e.metodos[0].id, e.metodos[0].nombre);
}
function _clNecesitaBanco(nombre) { const n = String(nombre || '').toLowerCase(); return (n.includes('tarjeta') || n.includes('transferencia')) && _CL_COBRO.bancos.length > 0; }
function _clElegirMetodo(id, nombre) {
  if (_CL_COBRO.cobrando) return;
  _CL_COBRO.metodo = { id, nombre }; _CL_COBRO.banco = null;
  document.querySelectorAll('#clc-metodos .clc-chip').forEach(b => b.classList.toggle('activo', b.dataset.metodo === id));
  _clPintarSeparado(id === '__separado');
  const conBanco = !id.startsWith('__') && _clNecesitaBanco(nombre);
  document.getElementById('clc-bancos-wrap').style.display = conBanco ? '' : 'none';
  if (conBanco) {
    document.getElementById('clc-bancos').innerHTML = _CL_COBRO.bancos.map(b => `<button type="button" class="clc-chip" data-banco="${_clEsc(b.id)}">🏦 ${_clEsc(b.nombre)}${b.moneda && b.moneda !== 'NIO' ? ' (' + _clEsc(b.moneda) + ')' : ''}</button>`).join('');
    document.querySelectorAll('#clc-bancos .clc-chip').forEach(b => b.addEventListener('click', () => {
      _CL_COBRO.banco = _CL_COBRO.bancos.find(x => x.id === b.dataset.banco) || null;
      document.querySelectorAll('#clc-bancos .clc-chip').forEach(x => x.classList.toggle('activo', x === b)); _clListo();
    }));
  }
  document.getElementById('clc-efectivo').style.display = /efectivo/i.test(nombre) ? 'flex' : 'none';
  document.getElementById('clc-err').textContent = '';
  _clListo(); _clCambio();
}
function _clListo() {
  const m = _CL_COBRO.metodo, b = document.getElementById('clc-cobrar'); if (!b) return;
  if (m && m.id === '__separado') { b.disabled = !_clSeparadoListo() || _CL_COBRO.cobrando; return; }
  b.disabled = !m || (m.id !== '__fiado' && _clNecesitaBanco(m.nombre) && !_CL_COBRO.banco) || _CL_COBRO.cobrando;
}
/* Pago separado (p. ej. una parte en efectivo y otra con tarjeta): el MISMO de Ventas. Aquí solo se reparte
   el total entre las formas de pago (con su banco si es tarjeta o transferencia); Ventas lo valida igual
   y registra un movimiento de Caja por cada forma de pago. */
const _clTotalCobrar = () => Number(_CL_COBRO.estado?.resumen?.cobrar ?? _CL_COBRO.estado?.resumen?.total) || 0;
const _clR2 = n => Math.round((Number(n) || 0) * 100) / 100;
function _clPintarSeparado(mostrar) {
  const cont = document.getElementById('clc-separado'); if (!cont) return;
  cont.style.display = mostrar ? '' : 'none';
  if (!mostrar) { _CL_COBRO.separado = null; cont.innerHTML = ''; return; }
  const metodos = (_CL_COBRO.estado?.metodos || []);
  _CL_COBRO.separado = metodos.map(mt => ({ metodoId: mt.id, metodoNombre: mt.nombre, monto: 0, banco: null }));
  cont.innerHTML = `<div class="clc-sec">¿Cuánto paga con cada forma?</div>
    ${_CL_COBRO.separado.map((l, i) => `<div class="clc-sep-linea">
      <div class="clc-fila" style="margin-top:6px;align-items:center"><div style="flex:1 1 120px"><b>${_clEsc(l.metodoNombre)}</b></div>
        <div style="flex:0 1 150px"><input class="clc-in" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00" data-sep-monto="${i}" aria-label="Monto con ${_clEsc(l.metodoNombre)}"/></div></div>
      <div class="clc-chips" data-sep-bancos="${i}" style="display:none;margin-top:6px"></div></div>`).join('')}
    <button type="button" class="clc-link" id="clc-sep-resto" style="margin-top:8px">Completar lo que falta con la última forma de pago que escribiste</button>
    <div id="clc-sep-resumen" style="margin-top:10px;padding:10px 12px;border-radius:10px;font-size:13.5px;font-weight:700"></div>`;
  cont.querySelectorAll('[data-sep-monto]').forEach(inp => inp.addEventListener('input', () => {
    const i = Number(inp.dataset.sepMonto), l = _CL_COBRO.separado[i];
    l.monto = Math.max(0, _clR2(inp.value));
    _clBancosSeparado(i); _clResumenSeparado(); _clListo();
  }));
  document.getElementById('clc-sep-resto').addEventListener('click', () => {
    const ls = _CL_COBRO.separado, conMonto = ls.map((l, i) => i).filter(i => ls[i].monto > 0);
    const i = conMonto.length ? conMonto[conMonto.length - 1] : 0;
    const otros = _clR2(ls.reduce((a, l, k) => a + (k === i ? 0 : l.monto), 0));
    ls[i].monto = Math.max(0, _clR2(_clTotalCobrar() - otros));
    const inp = cont.querySelector(`[data-sep-monto="${i}"]`); if (inp) inp.value = ls[i].monto ? ls[i].monto.toFixed(2) : '';
    _clBancosSeparado(i); _clResumenSeparado(); _clListo();
  });
  _clResumenSeparado();
}
function _clBancosSeparado(i) {
  const l = _CL_COBRO.separado[i], box = document.querySelector(`#clc-separado [data-sep-bancos="${i}"]`); if (!box) return;
  const necesita = l.monto > 0 && _clNecesitaBanco(l.metodoNombre);
  box.style.display = necesita ? 'flex' : 'none';
  if (!necesita) { l.banco = null; return; }
  if (box.dataset.listo === '1') return;
  box.dataset.listo = '1';
  box.innerHTML = _CL_COBRO.bancos.map(b => `<button type="button" class="clc-chip" data-sep-banco="${_clEsc(b.id)}">🏦 ${_clEsc(b.nombre)}</button>`).join('');
  box.querySelectorAll('[data-sep-banco]').forEach(btn => btn.addEventListener('click', () => {
    l.banco = _CL_COBRO.bancos.find(x => x.id === btn.dataset.sepBanco) || null;
    box.querySelectorAll('[data-sep-banco]').forEach(x => x.classList.toggle('activo', x === btn)); _clResumenSeparado(); _clListo();
  }));
}
function _clResumenSeparado() {
  const el = document.getElementById('clc-sep-resumen'); if (!el) return;
  const f = _clMotor()?.fmt || (x => Number(x || 0).toFixed(2));
  const total = _clTotalCobrar(), suma = _clR2((_CL_COBRO.separado || []).reduce((a, l) => a + l.monto, 0)), dif = _clR2(total - suma);
  const sinBanco = (_CL_COBRO.separado || []).find(l => l.monto > 0 && _clNecesitaBanco(l.metodoNombre) && !l.banco);
  if (Math.abs(dif) < 0.01) {
    el.style.background = 'var(--success-soft,#dcfce7)'; el.style.color = 'var(--success,#16a34a)';
    el.textContent = sinBanco ? `Cuadra exacto. Falta elegir a qué banco entra lo de ${sinBanco.metodoNombre}.` : `✅ Cuadra exacto: ${f(suma)} de ${f(total)}`;
  } else if (dif > 0) {
    el.style.background = 'var(--warning-soft,#fef3c7)'; el.style.color = '#b45309';
    el.textContent = `Falta ${f(dif)} (llevas ${f(suma)} de ${f(total)})`;
  } else {
    el.style.background = 'var(--danger-soft,#fee2e2)'; el.style.color = 'var(--danger,#dc2626)';
    el.textContent = `Te pasaste por ${f(-dif)} (llevas ${f(suma)} de ${f(total)})`;
  }
}
function _clSeparadoListo() {
  const ls = (_CL_COBRO.separado || []).filter(l => l.monto > 0);
  if (ls.length < 1) return false;
  if (Math.abs(_clR2(ls.reduce((a, l) => a + l.monto, 0)) - _clTotalCobrar()) >= 0.01) return false;
  return !ls.some(l => _clNecesitaBanco(l.metodoNombre) && !l.banco);
}
function _clCambio() {
  const el = document.getElementById('clc-cambio'); if (!el) return;
  const total = Number(_CL_COBRO.estado?.resumen?.cobrar ?? _CL_COBRO.estado?.resumen?.total) || 0;
  const rec = Number(document.getElementById('clc-recibido').value);
  if (!(rec > 0)) { el.textContent = '—'; el.style.color = ''; return; }
  const dif = Math.round((rec - total) * 100) / 100;
  const f = _clMotor()?.fmt || (x => x.toFixed(2));
  el.textContent = dif >= 0 ? f(dif) : 'Faltan ' + f(-dif);
  el.style.color = dif >= 0 ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)';
}
async function _clCobrarAhora() {
  if (_CL_COBRO.cobrando || _CL_COBRO.ventaId) return;
  const m = _CL_COBRO.metodo, motor = _clMotor();
  if (!m || !motor) return;
  const total = Number(_CL_COBRO.estado?.resumen?.cobrar ?? _CL_COBRO.estado?.resumen?.total) || 0;
  const rec = Number(document.getElementById('clc-recibido')?.value);
  if (/efectivo/i.test(m.nombre) && rec > 0 && rec + 0.004 < total) { document.getElementById('clc-err').textContent = 'Lo recibido es menos que el total.'; return; }
  _CL_COBRO.cobrando = true; _clListo();
  const btn = document.getElementById('clc-cobrar'); btn.textContent = 'Cobrando…';
  document.getElementById('clc-err').textContent = '';
  let r;
  const separado = m.id === '__separado' ? (_CL_COBRO.separado || []).filter(l => l.monto > 0).map(l => ({ metodoId: l.metodoId, monto: l.monto, banco: l.banco })) : null;
  if (separado && !_clSeparadoListo()) { _CL_COBRO.cobrando = false; _clListo(); document.getElementById('clc-err').textContent = 'El pago separado debe cuadrar exacto con el total.'; return; }
  if (separado) _CL_COBRO.metodo = { ...m, nombre: `Pago separado (${(_CL_COBRO.separado || []).filter(l => l.monto > 0).map(l => l.metodoNombre).join(' + ')})` };
  try { r = await motor.cobrar({ metodoId: (m.id === '__fiado' || separado) ? null : m.id, metodoNombre: m.nombre, fiado: m.id === '__fiado', separado, banco: separado ? null : _CL_COBRO.banco, notas: document.getElementById('clc-nota').value.trim() }); }
  catch (e) { r = { ok: false, motivo: 'No se pudo registrar la venta. Intenta de nuevo.' }; }
  _CL_COBRO.cobrando = false;
  if (r && r.ok) { if (!_CL_COBRO.ventaId) await _clCobroHecho(r); return; }
  btn.textContent = 'Cobrar ' + (_CL_COBRO.estado?.resumen?.texto?.cobrar || ''); _clListo();
  document.getElementById('clc-err').textContent = (r && r.motivo) || 'No se registró la venta.';
}
async function _clCobroHecho(r) {
  _CL_COBRO.ventaId = r.ventaId;
  const f = _clMotor()?.fmt || (x => Number(x || 0).toFixed(2));
  const rec = Number(document.getElementById('clc-recibido')?.value), total = Number(r.total) || 0;
  const cambio = _CL_COBRO.metodo?.id !== '__separado' && /efectivo/i.test(_CL_COBRO.metodo?.nombre || '') && rec > total ? Math.round((rec - total) * 100) / 100 : 0;
  document.getElementById('cl-cobro').classList.remove('clc-avanzado');
  document.getElementById('clc-cuerpo').innerHTML = `<div class="clc-ok"><div class="clc-ok-ico">✅</div><div class="clc-ok-tit">Cobrado ${_clEsc(f(total))}</div>
    <div class="cl-sub">Venta ${_clEsc(r.numero || '')} · ${_clEsc(_CL_COBRO.metodo?.nombre || '')}</div>
    ${cambio > 0 ? `<div style="margin-top:12px;font-size:18px;font-weight:900">Cambio: ${_clEsc(f(cambio))}</div>` : ''}
    <div class="cl-sub" style="margin-top:12px">Quedó registrada en Ventas y en Caja, como cualquier venta.</div>
    <div class="clc-chips" style="margin-top:16px">
      <button type="button" class="clc-chip" id="clc-ticket">🧾 Imprimir ticket</button>
      ${_clTelWhatsApp(_CL_COBRO.telefono) ? '<button type="button" class="clc-chip" id="clc-wa">📲 Enviar por WhatsApp</button>' : ''}
      <button type="button" class="clc-chip" id="clc-pdf">📄 Recibo PDF</button>
    </div></div>`;
  document.getElementById('clc-pie').innerHTML = '<button type="button" class="clc-btn" id="clc-listo">✓ Listo</button>';
  document.getElementById('clc-listo').addEventListener('click', clinicaCerrarCobro);
  const venta = { ...r, cliente: _CL_COBRO.estado?.cliente || '', metodo: _CL_COBRO.metodo?.nombre || '', totalTexto: f(total) };
  document.getElementById('clc-ticket').addEventListener('click', () => {
    // La ventana de impresión se abre en el mismo toque (si no, el navegador la bloquea); si hay impresora directa, se cierra sola.
    let w = null; try { w = window.open('', '_blank', 'width=380,height=600'); } catch (_) {}
    Promise.resolve(_clMotor()?.imprimirTicket(r.ventaId, w)).catch(() => { try { w && w.close(); } catch (_) {} if (typeof showToast === 'function') showToast('No se pudo imprimir el ticket.', 'error'); });
  });
  document.getElementById('clc-pdf').addEventListener('click', () => { Promise.resolve(_clMotor()?.descargarRecibo(r.ventaId)).catch(() => {}); });
  const wa = document.getElementById('clc-wa');
  if (wa) wa.addEventListener('click', () => { const u = _clEnlaceRecibo(venta); if (u) window.open(u, '_blank'); });
  try { if (_CL_COBRO.alTerminar) await _CL_COBRO.alTerminar(r.ventaId); } catch (x) { console.warn('después del cobro:', x); }
}
// Recibo por WhatsApp (mismo formato de número que los recordatorios).
function _clTelWhatsApp(tel) {
  if (typeof vetTelefonoWhatsApp === 'function') return vetTelefonoWhatsApp(tel, (typeof STATE !== 'undefined' && STATE.empresaConfig?.pais) || 'NI');
  const d = String(tel || '').replace(/\D/g, ''); if (d.length < 7) return null;
  return d.length === 8 ? '505' + d : d;
}
function _clEnlaceRecibo(v) {
  const tel = _clTelWhatsApp(_CL_COBRO.telefono); if (!tel) return null;
  const negocio = (typeof STATE !== 'undefined' && (STATE.empresaConfig?.nombre_comercial || STATE.empresaConfig?.nombre_negocio)) || 'nuestra clínica';
  const texto = `Hola${v.cliente ? ' ' + v.cliente : ''}, gracias por su visita a ${negocio}. Su pago de ${v.totalTexto} quedó registrado (recibo ${v.numero || ''}${v.metodo ? ', ' + v.metodo : ''}). ¡Que tenga un excelente día!`;
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}
// Casos especiales: se muestra la venta completa (la misma), ya en "Método de pago".
function clinicaCobroAvanzado() {
  const m = document.getElementById('cl-cobro'); if (!m || _CL_COBRO.ventaId) return;
  m.classList.add('clc-avanzado');
  try { _clMotor()?.irAPago(); } catch (_) {}
}
function clinicaCerrarCobro() {
  const m = document.getElementById('cl-cobro'); if (!m) return;
  if (_CL_COBRO.cobrando) return;                         // no se cierra a media venta
  clearInterval(_CL_COBRO.vigia);
  m.style.display = 'none'; m.classList.remove('clc-avanzado');
  document.getElementById('clc-marco').src = 'about:blank';
  ['n360_agenda_cobro', 'n360_clinica_cobro', 'n360_receta_a_vender'].forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });
  const cobrado = !!_CL_COBRO.ventaId, fin = _CL_COBRO.alCerrar;
  Object.assign(_CL_COBRO, { abierto: false, alTerminar: null, alCerrar: null, ventaId: null, metodo: null, banco: null, estado: null, separado: null });
  if (!cobrado && typeof showToast === 'function') showToast('No se cobró nada.');
  if (typeof fin === 'function') { try { fin(cobrado); } catch (_) {} }
}
// Respaldo: si Ventas registró la venta pero no alcanzó a ligarla, se liga aquí, SOLO si sigue libre
// (nunca se reemplaza otra venta). Devuelve true si quedó ligada a esta venta.
async function clinicaLigarVenta(tabla, id, ventaId, extra = {}, condicion = null) {
  const { data: x } = await sb.from(tabla).select('venta_id').eq('id', id).eq('auth_user_id', STATE.userId).maybeSingle();
  if (!x) return false;
  if (x.venta_id === ventaId) return true;
  if (x.venta_id) {
    const { data: v } = await sb.from('ventas').select('estado').eq('id', x.venta_id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (v && v.estado !== 'anulada') { console.warn('clinicaLigarVenta: ya ligada a otra venta', tabla, id); return false; }
  }
  let q = sb.from(tabla).update({ venta_id: ventaId, ...extra }).eq('id', id).eq('auth_user_id', STATE.userId);
  q = x.venta_id ? q.eq('venta_id', x.venta_id) : q.is('venta_id', null);
  if (condicion) q = condicion(q);
  const { error } = await q;
  if (error) { console.warn('clinicaLigarVenta:', error); return false; }
  return true;
}
function clinicaCSV(filas) {
  const celda = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n');
}

if (typeof module !== 'undefined') module.exports = {
  clinicaCitaDeAgenda, clinicaCobroAgenda, CLINICA_TIPOS_ESTANCIA, CLINICA_TIPOS_NOTA_ESTANCIA, clinicaDiasEstancia, clinicaDuracionTexto,
  clinicaCobroEstancia, clinicaConvenioVigente, clinicaAplicarConvenio, clinicaPendientesSeguro, clinicaMesesEdad, clinicaEdadGestacional, clinicaGlasgow, clinicaEscalaDolor, clinicaRiesgoCintura,
  CLINICA_DIENTES, CLINICA_ESTADOS_DIENTE, CLINICA_CARAS, clinicaDientesDe, clinicaLimpiarOdontograma, clinicaIndicesDentales,
  clinicaCalculosEspecialidad, clinicaResumenDatos, clinicaValidarDatos,
  CLINICA_ESPECIALIDADES, clinicaEspecialidadesActivas, clinicaNombreEspecialidad, CLINICA_TIPOS_CITA, CLINICA_ESTADOS_CITA,
  clinicaSiguientesEstados, clinicaChoqueCita, clinicaSemana, clinicaMensajeCita, clinicaEdad, clinicaAnios, clinicaNombrePaciente,
  CLINICA_SIGNOS, clinicaValidarSignos, clinicaNumero, clinicaIMC, clinicaClasificarIMC, clinicaAlertasSignos, clinicaTextoPA,
  CLINICA_ESTADOS_NOTA, clinicaTextoError, clinicaTextoMotivo, CLINICA_ACCIONES_BITACORA,
  clinicaNombreCorto, clinicaTurnos, clinicaOrdenEspera, clinicaHoraAhora, clinicaTextoEspera, clinicaNetoVenta, clinicaCalcularHonorarios, clinicaResumenReporte, clinicaCSV,
};
