/* =====================================================
   CLÍNICA -- utilidades compartidas (puras, sin acceso a la
   base de datos ni al DOM, para poder probarlas bien).
   Las usan: clinica-sala.js, clinica-pacientes.js y
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
  ver_reporte: '📊 Vio el reporte clínico',
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
    const base = _r2c(servicios * factor);
    let monto = 0;
    if (medico.honorario_tipo === 'porcentaje') monto = _r2c(base * (Number(medico.honorario_valor) || 0) / 100);
    else if (medico.honorario_tipo === 'monto') monto = neto > 0 ? _r2c(medico.honorario_valor) : 0;
    res.lineas.push({ cita_id: c.id, fecha: c.fecha, venta: v.numero_venta, neto, base, monto });
    res.base = _r2c(res.base + base); res.monto = _r2c(res.monto + monto);
  });
  return res;
}
// Resumen para Reportes: por médico (citas, atendidas, no asistió, cobrado neto) y por servicio/producto.
function clinicaResumenReporte({ citas, ventas, detalles, devoluciones, medicos }) {
  const vPorId = {}; (ventas || []).forEach(v => { vPorId[v.id] = v; });
  const fila = () => ({ citas: 0, atendidas: 0, no_asistio: 0, canceladas: 0, cobrado: 0, sin_cobrar: 0 });
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
function clinicaCSV(filas) {
  const celda = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n');
}

if (typeof module !== 'undefined') module.exports = {
  clinicaCitaDeAgenda, clinicaCobroAgenda,
  CLINICA_ESPECIALIDADES, clinicaEspecialidadesActivas, clinicaNombreEspecialidad, CLINICA_TIPOS_CITA, CLINICA_ESTADOS_CITA,
  clinicaSiguientesEstados, clinicaChoqueCita, clinicaSemana, clinicaMensajeCita, clinicaEdad, clinicaAnios, clinicaNombrePaciente,
  CLINICA_SIGNOS, clinicaValidarSignos, clinicaNumero, clinicaIMC, clinicaClasificarIMC, clinicaAlertasSignos, clinicaTextoPA,
  CLINICA_ESTADOS_NOTA, clinicaTextoError, clinicaTextoMotivo, CLINICA_ACCIONES_BITACORA,
  clinicaNombreCorto, clinicaTurnos, clinicaTextoEspera, clinicaNetoVenta, clinicaCalcularHonorarios, clinicaResumenReporte, clinicaCSV,
};
