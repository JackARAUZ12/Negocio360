/* =====================================================
   CLÍNICA -- utilidades compartidas (puras, sin acceso a la
   base de datos ni al DOM, para poder probarlas bien).
   Las usan: clinica-agenda.js, clinica-pacientes.js y
   clinica-equipo.js. Reutiliza las de fecha/hora/WhatsApp de
   vet-comun.js (que se carga antes).
===================================================== */

/* ---------- Especialidades (catálogo: agregar una es una línea) ----------
   'campos' = datos extra que la plantilla de esa especialidad agrega a la
   consulta (se guardan en consulta.datos). Medicina general usa solo los
   campos base de toda consulta. Las demás plantillas llegan en la Fase 4. */
const CLINICA_ESPECIALIDADES = {
  medicina_general:      { e: '🩺', n: 'Medicina general',             campos: [] },
  medicina_interna:      { e: '🫀', n: 'Medicina interna',             campos: [] },
  pediatria:             { e: '🧒', n: 'Pediatría',                    campos: [] },
  ginecologia:           { e: '🤰', n: 'Ginecología y obstetricia',    campos: [] },
  cardiologia:           { e: '❤️', n: 'Cardiología',                  campos: [] },
  dermatologia:          { e: '🧴', n: 'Dermatología',                 campos: [] },
  oftalmologia:          { e: '👁️', n: 'Oftalmología',                 campos: [] },
  otorrinolaringologia:  { e: '👂', n: 'Otorrinolaringología',         campos: [] },
  ortopedia:             { e: '🦴', n: 'Ortopedia y traumatología',    campos: [] },
  neurologia:            { e: '🧠', n: 'Neurología',                   campos: [] },
  psicologia:            { e: '💬', n: 'Psicología / psiquiatría',     campos: [] },
  nutricion:             { e: '🥗', n: 'Nutrición',                    campos: [] },
  fisioterapia:          { e: '🏃', n: 'Fisioterapia',                 campos: [] },
  odontologia:           { e: '🦷', n: 'Odontología',                  campos: [] },
  urologia:              { e: '🚻', n: 'Urología',                     campos: [] },
  endocrinologia:        { e: '🧪', n: 'Endocrinología',               campos: [] },
  laboratorio:           { e: '🔬', n: 'Laboratorio clínico',          campos: [] },
};
// Lo que la clínica eligió en Configuración. Vacío o "multiespecialidad" = todas.
function clinicaEspecialidadesActivas(config) {
  const lista = Array.isArray(config) ? config : [];
  if (!lista.length || lista.includes('multiespecialidad')) return Object.keys(CLINICA_ESPECIALIDADES);
  const validas = lista.filter(k => CLINICA_ESPECIALIDADES[k]);
  return validas.length ? validas : Object.keys(CLINICA_ESPECIALIDADES);
}
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
    clinica_sesion_invalida: 'Tu sesión médica se cerró. Ingresa tu PIN de nuevo.',
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
  falta_motivo: 'Escribe el motivo.', proximo_control: 'El próximo control no puede ser una fecha pasada.',
  cita: 'Esa cita ya no está disponible para atender.', cita_con_nota: 'Esa cita ya tiene una nota de consulta.',
  no_borrador: 'Esta nota ya está cerrada: no se puede modificar.', no_autor: 'Solo el médico que escribió la nota puede hacer esto.',
  incompleta: 'Para cerrar la nota escribe al menos el diagnóstico o el plan.', no_cerrada: 'Solo se agregan adendas a notas cerradas.',
  texto: 'Escribe el texto.', ya_anulada: 'Esta nota ya estaba anulada.', sin_permiso: 'Necesitas el código de administrador.',
  incorrecto: 'PIN o código incorrecto.', bloqueado: 'Demasiados intentos fallidos. Espera unos minutos.',
  pin_formato: 'El PIN debe tener de 4 a 8 números.', pin_requerido: 'Médicos y administradores necesitan un PIN (4 a 8 números).',
  nombre: 'Escribe el nombre.', rol: 'Elige el rol.', consultorio: 'Ese consultorio no existe.', no_encontrado: 'No se encontró.',
  sin_pin: 'Esta persona todavía no tiene PIN. Pídele al administrador que se lo asigne.',
  sin_acceso_clinico: 'Recepción no tiene acceso al expediente clínico.', formato: 'El código debe tener de 4 a 12 números.',
};
function clinicaTextoMotivo(r) {
  if (!r) return 'No se pudo completar. Intenta de nuevo.';
  if (r.motivo === 'bloqueado') { const m = Math.max(1, Math.ceil((r.bloqueado_seg || 60) / 60)); return `Demasiados intentos fallidos. Espera ${m} minuto${m === 1 ? '' : 's'}.`; }
  if (r.motivo === 'incorrecto' && r.restantes > 0 && r.restantes <= 3) return `PIN o código incorrecto (te quedan ${r.restantes} intento${r.restantes === 1 ? '' : 's'}).`;
  return CLINICA_MOTIVOS_RPC[r.motivo] || 'No se pudo completar. Intenta de nuevo.';
}

const CLINICA_ACCIONES_BITACORA = {
  inicio_sesion: '🔓 Entró con su PIN', cierre_sesion: '🔒 Cerró su sesión', pin_incorrecto: '⚠️ PIN incorrecto', bloqueo: '⛔ Bloqueo por intentos',
  abrir_expediente: '📂 Abrió el expediente', editar_antecedentes: '✏️ Editó antecedentes', crear_nota: '📝 Creó una nota',
  editar_borrador: '✏️ Editó un borrador', cerrar_nota: '✅ Cerró y firmó una nota', adenda: '➕ Agregó una adenda',
  anular_nota: '🚫 Anuló una nota', personal_creado: '👤 Agregó personal', personal_editado: '👤 Editó personal',
  pin_definido: '🔑 Asignó un PIN', pin_cambiado: '🔑 Cambió su PIN', ver_bitacora: '🕵️ Revisó la bitácora',
};

if (typeof module !== 'undefined') module.exports = {
  CLINICA_ESPECIALIDADES, clinicaEspecialidadesActivas, clinicaNombreEspecialidad, CLINICA_TIPOS_CITA, CLINICA_ESTADOS_CITA,
  clinicaSiguientesEstados, clinicaChoqueCita, clinicaSemana, clinicaMensajeCita, clinicaEdad, clinicaAnios, clinicaNombrePaciente,
  CLINICA_SIGNOS, clinicaValidarSignos, clinicaNumero, clinicaIMC, clinicaClasificarIMC, clinicaAlertasSignos, clinicaTextoPA,
  CLINICA_ESTADOS_NOTA, clinicaTextoError, clinicaTextoMotivo, CLINICA_ACCIONES_BITACORA,
};
