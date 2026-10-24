/* =====================================================
   CLÍNICA -- Catálogo CIE-10 (subconjunto frecuente en
   consulta externa / atención primaria), en español.
   La CIE-10 es la clasificación de la OMS de uso libre para
   registrar diagnósticos; aquí va una selección de los
   códigos más usados. Si un diagnóstico no está, el médico
   lo escribe como texto libre (se guarda sin código).
   Formato: [código, descripción]
===================================================== */
const CLINICA_CIE10 = [
  // Infecciosas y parasitarias
  ['A09', 'Diarrea y gastroenteritis de presunto origen infeccioso'], ['A08.4', 'Infección intestinal viral, sin otra especificación'],
  ['A06.0', 'Disentería amebiana aguda'], ['A01.0', 'Fiebre tifoidea'], ['A15.0', 'Tuberculosis del pulmón'],
  ['A90', 'Fiebre del dengue (dengue clásico)'], ['A91', 'Fiebre del dengue hemorrágico'], ['A92.0', 'Enfermedad por virus Chikungunya'],
  ['A92.5', 'Enfermedad por virus Zika'], ['B01.9', 'Varicela sin complicaciones'], ['B02.9', 'Herpes zóster sin complicaciones'],
  ['B00.1', 'Dermatitis vesicular por herpes simple'], ['B05.9', 'Sarampión sin complicaciones'], ['B26.9', 'Parotiditis sin complicaciones'],
  ['B34.9', 'Infección viral, no especificada'], ['B35.1', 'Tiña de las uñas (onicomicosis)'], ['B35.3', 'Tiña del pie'], ['B35.4', 'Tiña del cuerpo'],
  ['B36.0', 'Pitiriasis versicolor'], ['B37.0', 'Estomatitis candidiásica (algodoncillo)'], ['B37.3', 'Candidiasis de la vulva y de la vagina'],
  ['B50.9', 'Paludismo por Plasmodium falciparum, sin otra especificación'], ['B54', 'Paludismo (malaria), no especificado'],
  ['B65.9', 'Esquistosomiasis, no especificada'], ['B76.9', 'Anquilostomiasis, no especificada'], ['B77.9', 'Ascariasis, no especificada'],
  ['B80', 'Enterobiasis (oxiuros)'], ['B82.9', 'Parasitosis intestinal, sin otra especificación'], ['B86', 'Escabiosis (sarna)'], ['B85.0', 'Pediculosis capitis (piojos)'],
  ['B24', 'Enfermedad por VIH, sin otra especificación'], ['A53.9', 'Sífilis, no especificada'], ['A54.9', 'Infección gonocócica, no especificada'],
  ['A63.0', 'Verrugas anogenitales (venéreas)'], ['B07', 'Verrugas víricas'], ['A46', 'Erisipela'], ['L03.9', 'Celulitis, de sitio no especificado'],
  // Neoplasias (frecuentes en seguimiento)
  ['C50.9', 'Tumor maligno de la mama, parte no especificada'], ['C53.9', 'Tumor maligno del cuello del útero, sin otra especificación'],
  ['C61', 'Tumor maligno de la próstata'], ['D25.9', 'Leiomioma del útero, sin otra especificación (mioma)'], ['D17.9', 'Tumor benigno lipomatoso (lipoma)'],
  // Sangre, endocrinas, nutricionales y metabólicas
  ['D50.9', 'Anemia por deficiencia de hierro, sin otra especificación'], ['D64.9', 'Anemia de tipo no especificado'],
  ['E03.9', 'Hipotiroidismo, no especificado'], ['E05.9', 'Tirotoxicosis (hipertiroidismo), sin otra especificación'], ['E04.9', 'Bocio no tóxico, no especificado'],
  ['E10.9', 'Diabetes mellitus tipo 1, sin mención de complicación'], ['E11.9', 'Diabetes mellitus tipo 2, sin mención de complicación'],
  ['E11.6', 'Diabetes mellitus tipo 2, con otras complicaciones especificadas'], ['E14.9', 'Diabetes mellitus, no especificada, sin complicación'],
  ['R73.0', 'Anormalidades en la prueba de tolerancia a la glucosa (prediabetes)'], ['E16.2', 'Hipoglicemia, no especificada'],
  ['E44.0', 'Desnutrición proteicocalórica moderada'], ['E46', 'Desnutrición proteicocalórica, no especificada'], ['E55.9', 'Deficiencia de vitamina D, no especificada'],
  ['E66.9', 'Obesidad, no especificada'], ['E66.0', 'Obesidad debida a exceso de calorías'], ['E78.0', 'Hipercolesterolemia pura'],
  ['E78.1', 'Hipergliceridemia pura'], ['E78.5', 'Hiperlipidemia, no especificada'], ['E79.0', 'Hiperuricemia sin signos de artritis'],
  ['E86', 'Depleción del volumen (deshidratación)'], ['E87.6', 'Hipopotasemia'], ['E28.2', 'Síndrome de ovario poliquístico'],
  // Mentales y del comportamiento
  ['F10.2', 'Trastornos por uso de alcohol: síndrome de dependencia'], ['F17.2', 'Trastornos por uso de tabaco: síndrome de dependencia'],
  ['F32.9', 'Episodio depresivo, no especificado'], ['F33.9', 'Trastorno depresivo recurrente, no especificado'],
  ['F41.0', 'Trastorno de pánico'], ['F41.1', 'Trastorno de ansiedad generalizada'], ['F41.9', 'Trastorno de ansiedad, no especificado'],
  ['F43.2', 'Trastornos de adaptación'], ['F51.0', 'Insomnio no orgánico'], ['F90.0', 'Trastorno de la actividad y de la atención (TDAH)'],
  ['F84.0', 'Autismo en la niñez'], ['F20.9', 'Esquizofrenia, no especificada'], ['F31.9', 'Trastorno afectivo bipolar, no especificado'],
  // Sistema nervioso
  ['G40.9', 'Epilepsia, tipo no especificado'], ['G43.9', 'Migraña, no especificada'], ['G44.2', 'Cefalea debida a tensión'],
  ['R51', 'Cefalea'], ['G47.0', 'Trastornos del inicio y del mantenimiento del sueño (insomnio)'], ['G56.0', 'Síndrome del túnel carpiano'],
  ['G51.0', 'Parálisis de Bell'], ['G62.9', 'Polineuropatía, no especificada'], ['G20', 'Enfermedad de Parkinson'], ['G30.9', 'Enfermedad de Alzheimer, no especificada'],
  ['R42', 'Mareo y desvanecimiento'], ['R55', 'Síncope y colapso'], ['R56.0', 'Convulsiones febriles'],
  // Ojo y oído
  ['H10.9', 'Conjuntivitis, no especificada'], ['H10.1', 'Conjuntivitis atópica aguda (alérgica)'], ['H00.0', 'Orzuelo y otras inflamaciones de los párpados'],
  ['H01.0', 'Blefaritis'], ['H11.0', 'Pterigión'], ['H25.9', 'Catarata senil, no especificada'], ['H40.9', 'Glaucoma, no especificado'],
  ['H52.1', 'Miopía'], ['H52.4', 'Presbicia'], ['H04.1', 'Otros trastornos de la glándula lagrimal (ojo seco)'],
  ['H60.9', 'Otitis externa, sin otra especificación'], ['H65.9', 'Otitis media no supurativa, sin otra especificación'],
  ['H66.9', 'Otitis media, no especificada'], ['H61.2', 'Cerumen impactado'], ['H81.1', 'Vértigo paroxístico benigno'], ['H91.9', 'Hipoacusia, no especificada'],
  ['H93.1', 'Tinnitus (zumbido de oídos)'],
  // Circulatorio
  ['I10', 'Hipertensión esencial (primaria)'], ['I11.9', 'Enfermedad cardíaca hipertensiva sin insuficiencia cardíaca'],
  ['I20.9', 'Angina de pecho, no especificada'], ['I21.9', 'Infarto agudo del miocardio, sin otra especificación'], ['I25.9', 'Enfermedad isquémica crónica del corazón'],
  ['I48', 'Fibrilación y aleteo auricular'], ['I49.9', 'Arritmia cardíaca, no especificada'], ['I50.9', 'Insuficiencia cardíaca, no especificada'],
  ['I63.9', 'Infarto cerebral, no especificado'], ['I64', 'Accidente vascular encefálico agudo, no especificado'], ['I83.9', 'Venas varicosas de los miembros inferiores'],
  ['I84.9', 'Hemorroides no especificadas'], ['I95.9', 'Hipotensión, no especificada'], ['R00.0', 'Taquicardia, no especificada'],
  // Respiratorio
  ['J00', 'Rinofaringitis aguda (resfriado común)'], ['J01.9', 'Sinusitis aguda, no especificada'], ['J02.9', 'Faringitis aguda, no especificada'],
  ['J02.0', 'Faringitis estreptocócica'], ['J03.9', 'Amigdalitis aguda, no especificada'], ['J04.0', 'Laringitis aguda'],
  ['J06.9', 'Infección aguda de las vías respiratorias superiores, no especificada'], ['J10.1', 'Influenza con otras manifestaciones respiratorias, virus identificado'],
  ['J11.1', 'Influenza con otras manifestaciones respiratorias, virus no identificado'], ['J12.9', 'Neumonía viral, no especificada'],
  ['J18.9', 'Neumonía, no especificada'], ['J20.9', 'Bronquitis aguda, no especificada'], ['J21.9', 'Bronquiolitis aguda, no especificada'],
  ['J30.4', 'Rinitis alérgica, no especificada'], ['J32.9', 'Sinusitis crónica, no especificada'], ['J35.0', 'Amigdalitis crónica'],
  ['J40', 'Bronquitis, no especificada como aguda o crónica'], ['J44.9', 'Enfermedad pulmonar obstructiva crónica (EPOC), no especificada'],
  ['J45.9', 'Asma, no especificada'], ['J46', 'Estado asmático (crisis asmática grave)'], ['U07.1', 'COVID-19, virus identificado'],
  ['R05', 'Tos'], ['R06.0', 'Disnea'],
  // Digestivo
  ['K02.9', 'Caries dental, no especificada'], ['K04.7', 'Absceso periapical sin fístula'], ['K05.1', 'Gingivitis crónica'], ['K12.0', 'Estomatitis aftosa recurrente'],
  ['K21.9', 'Enfermedad del reflujo gastroesofágico sin esofagitis'], ['K25.9', 'Úlcera gástrica, no especificada'], ['K29.7', 'Gastritis, no especificada'],
  ['K30', 'Dispepsia'], ['K35.8', 'Apendicitis aguda, otra y la no especificada'], ['K40.9', 'Hernia inguinal unilateral sin obstrucción ni gangrena'],
  ['K42.9', 'Hernia umbilical sin obstrucción ni gangrena'], ['K52.9', 'Colitis y gastroenteritis no infecciosas, no especificadas'],
  ['K58.9', 'Síndrome del colon irritable sin diarrea'], ['K59.0', 'Constipación (estreñimiento)'], ['K60.2', 'Fisura anal, no especificada'],
  ['K70.3', 'Cirrosis hepática alcohólica'], ['K76.0', 'Degeneración grasa del hígado (hígado graso)'], ['K80.2', 'Cálculo de la vesícula biliar sin colecistitis'],
  ['K81.0', 'Colecistitis aguda'], ['K85.9', 'Pancreatitis aguda, no especificada'], ['K92.2', 'Hemorragia gastrointestinal, no especificada'],
  ['R10.4', 'Otros dolores abdominales y los no especificados'], ['R11', 'Náusea y vómito'], ['R19.7', 'Diarrea, no especificada'],
  // Piel
  ['L01.0', 'Impétigo'], ['L02.9', 'Absceso cutáneo, furúnculo y ántrax, de sitio no especificado'], ['L08.9', 'Infección local de la piel, no especificada'],
  ['L20.9', 'Dermatitis atópica, no especificada'], ['L21.9', 'Dermatitis seborreica, no especificada'], ['L22', 'Dermatitis del pañal'],
  ['L23.9', 'Dermatitis alérgica de contacto, de causa no especificada'], ['L25.9', 'Dermatitis de contacto, forma y causa no especificadas'],
  ['L30.9', 'Dermatitis, no especificada'], ['L40.0', 'Psoriasis vulgar'], ['L50.9', 'Urticaria, no especificada'], ['L60.0', 'Uña encarnada'],
  ['L63.9', 'Alopecia areata, no especificada'], ['L70.0', 'Acné vulgar'], ['L72.1', 'Quiste tricodérmico (quiste sebáceo)'], ['L80', 'Vitiligo'],
  ['L81.1', 'Cloasma (melasma)'], ['L82', 'Queratosis seborreica'], ['L89.9', 'Úlcera de decúbito, no especificada'], ['T78.4', 'Alergia no especificada'],
  ['T63.4', 'Efecto tóxico del veneno de artrópodos (picaduras)'],
  // Osteomuscular
  ['M10.9', 'Gota, no especificada'], ['M13.9', 'Artritis, no especificada'], ['M15.9', 'Poliartrosis, no especificada'], ['M17.9', 'Gonartrosis (artrosis de rodilla), no especificada'],
  ['M16.9', 'Coxartrosis (artrosis de cadera), no especificada'], ['M19.9', 'Artrosis, no especificada'], ['M05.9', 'Artritis reumatoide seropositiva, sin otra especificación'],
  ['M06.9', 'Artritis reumatoide, no especificada'], ['M25.5', 'Dolor en articulación'], ['M54.2', 'Cervicalgia'], ['M54.4', 'Lumbago con ciática'],
  ['M54.5', 'Lumbago no especificado (dolor lumbar)'], ['M54.9', 'Dorsalgia, no especificada'], ['M62.6', 'Distensión muscular'],
  ['M65.4', 'Tenosinovitis de estiloides radial (de Quervain)'], ['M75.1', 'Síndrome del manguito rotatorio'], ['M77.1', 'Epicondilitis lateral (codo de tenista)'],
  ['M79.1', 'Mialgia'], ['M79.7', 'Fibromialgia'], ['M81.9', 'Osteoporosis, no especificada'], ['M72.2', 'Fibromatosis de la aponeurosis plantar (fascitis plantar)'],
  ['M41.9', 'Escoliosis, no especificada'],
  // Genitourinario
  ['N10', 'Pielonefritis aguda'], ['N18.9', 'Enfermedad renal crónica, no especificada'], ['N20.0', 'Cálculo del riñón'], ['N23', 'Cólico renal, no especificado'],
  ['N30.0', 'Cistitis aguda'], ['N39.0', 'Infección de vías urinarias, sitio no especificado'], ['N40', 'Hiperplasia de la próstata'],
  ['N41.0', 'Prostatitis aguda'], ['N45.9', 'Orquitis, epididimitis y orquiepididimitis sin absceso'], ['N47', 'Prepucio redundante, fimosis y parafimosis'],
  ['N60.1', 'Mastopatía quística difusa'], ['N63', 'Masa no especificada en la mama'], ['N70.9', 'Salpingitis y ooforitis, no especificadas'],
  ['N73.9', 'Enfermedad inflamatoria pélvica femenina, no especificada'], ['N76.0', 'Vaginitis aguda'], ['N77.1', 'Vaginitis, vulvitis y vulvovaginitis en enfermedades clasificadas en otra parte'],
  ['N83.2', 'Otros quistes ováricos y los no especificados'], ['N91.2', 'Amenorrea, sin otra especificación'], ['N92.0', 'Menstruación excesiva y frecuente con ciclo regular'],
  ['N92.6', 'Menstruación irregular, no especificada'], ['N94.6', 'Dismenorrea, no especificada'], ['N95.1', 'Estados menopáusicos y climatéricos femeninos'],
  ['N97.9', 'Infertilidad femenina, no especificada'], ['N89.8', 'Otros trastornos no inflamatorios especificados de la vagina (leucorrea)'],
  ['R30.0', 'Disuria'], ['R31', 'Hematuria, no especificada'],
  // Embarazo, parto y puerperio
  ['Z34.9', 'Supervisión de embarazo normal no especificado'], ['Z32.1', 'Embarazo confirmado'], ['O03.9', 'Aborto espontáneo completo o no especificado, sin complicación'],
  ['O13', 'Hipertensión gestacional sin proteinuria significativa'], ['O14.9', 'Preeclampsia, no especificada'], ['O20.0', 'Amenaza de aborto'],
  ['O21.0', 'Hiperémesis gravídica leve'], ['O23.4', 'Infección no especificada de las vías urinarias en el embarazo'], ['O24.4', 'Diabetes mellitus que se origina con el embarazo'],
  ['O26.9', 'Afección relacionada con el embarazo, no especificada'], ['O47.9', 'Falso trabajo de parto, sin otra especificación'], ['O80.9', 'Parto único espontáneo, sin otra especificación'],
  ['O99.0', 'Anemia que complica el embarazo, el parto y el puerperio'], ['O91.2', 'Mastitis no purulenta asociada con el parto'], ['Z39.2', 'Seguimiento postparto, de rutina'],
  // Perinatal
  ['P59.9', 'Ictericia neonatal, no especificada'], ['P07.3', 'Otros recién nacidos pretérmino'],
  // Síntomas y signos generales
  ['R50.9', 'Fiebre, no especificada'], ['R52.9', 'Dolor, no especificado'], ['R53', 'Malestar y fatiga'], ['R07.4', 'Dolor en el pecho, no especificado'],
  ['R60.0', 'Edema localizado'], ['R63.4', 'Pérdida anormal de peso'], ['R63.0', 'Anorexia (falta de apetito)'], ['R21', 'Salpullido y otras erupciones cutáneas no específicas'],
  ['R59.0', 'Adenomegalia localizada'], ['R74.0', 'Elevación de los niveles de transaminasas'], ['R80', 'Proteinuria aislada'], ['R03.0', 'Lectura elevada de la presión sanguínea, sin diagnóstico de hipertensión'],
  // Traumatismos
  ['S00.9', 'Traumatismo superficial de la cabeza, parte no especificada'], ['S06.0', 'Concusión'], ['S01.9', 'Herida de la cabeza, parte no especificada'],
  ['S13.4', 'Esguince y torcedura de la columna cervical'], ['S33.5', 'Esguince y torcedura de la columna lumbar'], ['S42.0', 'Fractura de la clavícula'],
  ['S52.5', 'Fractura de la epífisis inferior del radio'], ['S61.9', 'Herida de la muñeca y de la mano, parte no especificada'], ['S62.6', 'Fractura de otro dedo de la mano'],
  ['S63.5', 'Esguince y torcedura de la muñeca'], ['S80.0', 'Contusión de la rodilla'], ['S82.6', 'Fractura del maléolo externo'], ['S83.6', 'Esguince y torcedura de la rodilla'],
  ['S93.4', 'Esguince y torcedura del tobillo'], ['T14.0', 'Traumatismo superficial de región no especificada del cuerpo'], ['T14.1', 'Herida de región no especificada del cuerpo'],
  ['T20.0', 'Quemadura de la cabeza y del cuello, grado no especificado'], ['T30.0', 'Quemadura de región del cuerpo no especificada'], ['T15.9', 'Cuerpo extraño en parte externa del ojo'],
  ['T88.7', 'Efecto adverso no especificado de droga o medicamento'], ['W54', 'Mordedura o ataque de perro'],
  // Factores que influyen en el estado de salud (consultas de control)
  ['Z00.0', 'Examen médico general'], ['Z00.1', 'Control de salud de rutina del niño'], ['Z01.4', 'Examen ginecológico (general) (de rutina)'],
  ['Z02.7', 'Extensión de certificado médico'], ['Z02.1', 'Examen preempleo'], ['Z23', 'Necesidad de inmunización (vacuna)'], ['Z30.0', 'Consejo y asesoramiento general sobre la anticoncepción'],
  ['Z30.4', 'Supervisión del uso de drogas anticonceptivas'], ['Z71.3', 'Consulta para instrucción y vigilancia de la dieta'], ['Z09.9', 'Examen de seguimiento consecutivo a tratamiento'],
  ['Z12.4', 'Examen de pesquisa de tumor maligno del cuello uterino (Papanicolaou)'], ['Z76.0', 'Consulta para repetición de receta'], ['Z48.0', 'Atención de los apósitos y suturas (curación)'],
];

// Quita tildes y pasa a minúsculas para buscar sin importar cómo se escriba.
function clinicaNormalizar(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
const _CIE10_INDICE = CLINICA_CIE10.map(([c, n]) => ({ codigo: c, nombre: n, clave: clinicaNormalizar(c + ' ' + n), cod: clinicaNormalizar(c).replace('.', '') }));
// Busca por código (J00, j06.9, J069) o por palabras en cualquier orden ("dolor lumbar", "faringitis").
function clinicaBuscarCIE10(q, limite = 12) {
  const t = clinicaNormalizar(q);
  if (t.length < 2) return [];
  const cod = t.replace(/\s|\./g, '');
  const palabras = t.split(/\s+/).filter(Boolean);
  const res = [];
  for (const d of _CIE10_INDICE) {
    let puntos = 0;
    if (d.cod === cod) puntos = 100;
    else if (/^[a-z]\d/.test(cod) && d.cod.startsWith(cod)) puntos = 80 - d.cod.length;
    else if (palabras.every(p => d.clave.includes(p))) puntos = 40 - Math.min(30, d.nombre.length / 4) + (clinicaNormalizar(d.nombre).startsWith(palabras[0]) ? 10 : 0);
    if (puntos > 0) res.push({ puntos, d });
  }
  return res.sort((a, b) => b.puntos - a.puntos).slice(0, limite).map(x => ({ codigo: x.d.codigo, nombre: x.d.nombre }));
}

if (typeof module !== 'undefined') module.exports = { CLINICA_CIE10, clinicaBuscarCIE10, clinicaNormalizar };
