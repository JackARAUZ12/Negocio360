/* =====================================================
   VETERINARIA -- utilidades compartidas (puras, sin acceso
   a la base de datos ni al DOM, para poder probarlas bien).
   Las usan: mascotas.js y vet-recordatorios.js
===================================================== */
const VET_ESPECIES = {
  perro:  { e: '🐶', n: 'Perro' },   gato:   { e: '🐱', n: 'Gato' },
  ave:    { e: '🐦', n: 'Ave' },     conejo: { e: '🐰', n: 'Conejo' },
  roedor: { e: '🐹', n: 'Roedor' },  reptil: { e: '🦎', n: 'Reptil' },
  equino: { e: '🐴', n: 'Equino' },  bovino: { e: '🐄', n: 'Bovino' },
  otro:   { e: '🐾', n: 'Otro' },
};
const VET_TIPOS_REGISTRO = {
  vacuna:                 { e: '💉', n: 'Vacuna' },
  desparasitacion_interna: { e: '💊', n: 'Desparasitación interna' },
  desparasitacion_externa: { e: '🧴', n: 'Antipulgas / garrapatas' },
  otro:                   { e: '📝', n: 'Otro' },
};
// Protocolos SUGERIDOS por especie (el veterinario siempre puede cambiarlos).
// 'dias' = cada cuanto se repite; sirve para calcular el proximo refuerzo.
const VET_PROTOCOLOS = {
  perro: [
    { tipo: 'vacuna', nombre: 'Rabia', dias: 365 },
    { tipo: 'vacuna', nombre: 'Múltiple (parvovirus, moquillo, hepatitis)', dias: 365 },
    { tipo: 'vacuna', nombre: 'Bordetella (tos de las perreras)', dias: 365 },
    { tipo: 'vacuna', nombre: 'Leptospirosis', dias: 365 },
    { tipo: 'desparasitacion_interna', nombre: 'Desparasitación interna', dias: 90 },
    { tipo: 'desparasitacion_externa', nombre: 'Antipulgas y garrapatas', dias: 30 },
  ],
  gato: [
    { tipo: 'vacuna', nombre: 'Triple felina', dias: 365 },
    { tipo: 'vacuna', nombre: 'Rabia', dias: 365 },
    { tipo: 'vacuna', nombre: 'Leucemia felina', dias: 365 },
    { tipo: 'desparasitacion_interna', nombre: 'Desparasitación interna', dias: 90 },
    { tipo: 'desparasitacion_externa', nombre: 'Antipulgas', dias: 30 },
  ],
  conejo: [
    { tipo: 'vacuna', nombre: 'Mixomatosis y enfermedad hemorrágica', dias: 365 },
    { tipo: 'desparasitacion_interna', nombre: 'Desparasitación interna', dias: 90 },
  ],
  equino: [
    { tipo: 'vacuna', nombre: 'Tétanos', dias: 365 },
    { tipo: 'vacuna', nombre: 'Encefalitis equina', dias: 365 },
    { tipo: 'desparasitacion_interna', nombre: 'Desparasitación interna', dias: 120 },
  ],
  bovino: [
    { tipo: 'vacuna', nombre: 'Fiebre aftosa', dias: 180 },
    { tipo: 'vacuna', nombre: 'Brucelosis', dias: 365 },
    { tipo: 'desparasitacion_interna', nombre: 'Desparasitación interna', dias: 120 },
  ],
};
function vetProtocolosDe(especie) {
  return VET_PROTOCOLOS[especie] || [{ tipo: 'desparasitacion_interna', nombre: 'Desparasitación interna', dias: 90 }];
}

const VET_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const VET_CODIGOS_PAIS = { NI: '505', HN: '504', SV: '503', GT: '502', CR: '506', PA: '507', MX: '52', CO: '57', US: '1', DO: '1', ES: '34', PE: '51', EC: '593', AR: '54', CL: '56' };

const _vp = n => String(n).padStart(2, '0');
function vetPartes(ymd) { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return { y, m, d }; }
function vetHoy() { const d = new Date(); return `${d.getFullYear()}-${_vp(d.getMonth() + 1)}-${_vp(d.getDate())}`; }
// Dias de 'desde' a 'hasta' (negativo si 'hasta' es anterior). Sin problemas de zona horaria.
function vetDiasEntre(desde, hasta) {
  const a = vetPartes(desde), b = vetPartes(hasta);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}
function vetSumarDias(ymd, dias) {
  const p = vetPartes(ymd);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(dias)));
  return `${t.getUTCFullYear()}-${_vp(t.getUTCMonth() + 1)}-${_vp(t.getUTCDate())}`;
}
function vetFechaLarga(ymd) { const p = vetPartes(ymd); return `${p.d} de ${VET_MESES[p.m - 1]} de ${p.y}`; }

// Edad legible de la mascota: "2 años 3 meses", "5 meses", "12 días".
function vetEdad(nacimiento, hoy) {
  if (!nacimiento) return '—';
  const hoyYmd = hoy || vetHoy();
  const n = vetPartes(nacimiento), h = vetPartes(hoyYmd);
  let anios = h.y - n.y, meses = h.m - n.m;
  if (h.d < n.d) meses--;
  if (meses < 0) { anios--; meses += 12; }
  if (anios < 0) return '—';
  if (anios >= 1) return `${anios} ${anios === 1 ? 'año' : 'años'}${meses > 0 ? ` ${meses} ${meses === 1 ? 'mes' : 'meses'}` : ''}`;
  if (meses >= 1) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const d = vetDiasEntre(nacimiento, hoyYmd);
  return d <= 0 ? 'Recién nacido' : `${d} ${d === 1 ? 'día' : 'días'}`;
}

// Estado de un refuerzo respecto a hoy: texto y color para la etiqueta.
function vetEstadoRefuerzo(proxima, hoy) {
  const dias = vetDiasEntre(hoy || vetHoy(), proxima);
  if (dias < 0) return { dias, clase: 'rojo', texto: `Venció hace ${-dias} ${-dias === 1 ? 'día' : 'días'}` };
  if (dias === 0) return { dias, clase: 'ambar', texto: 'Es hoy' };
  if (dias <= 7) return { dias, clase: 'ambar', texto: `En ${dias} ${dias === 1 ? 'día' : 'días'}` };
  if (dias <= 30) return { dias, clase: 'azul', texto: `En ${dias} días` };
  return { dias, clase: 'verde', texto: `En ${dias} días` };
}

// Refuerzos PENDIENTES: de cada (mascota, vacuna) solo cuenta el registro MAS RECIENTE,
// y solo si trae fecha de proxima dosis. Asi, cuando la mascota recibe su refuerzo, el
// aviso viejo desaparece solo. 'registros' debe incluir TODAS las aplicaciones.
function vetPendientesRefuerzo(registros) {
  const ultimo = new Map();
  (registros || []).forEach(r => {
    const clave = `${r.mascota_id}|${String(r.nombre || '').trim().toLowerCase()}`;
    const prev = ultimo.get(clave);
    const esMasNuevo = !prev || r.fecha_aplicacion > prev.fecha_aplicacion
      || (r.fecha_aplicacion === prev.fecha_aplicacion && String(r.created_at || '') > String(prev.created_at || ''));
    if (esMasNuevo) ultimo.set(clave, r);
  });
  return [...ultimo.values()].filter(r => r.proxima_dosis)
    .sort((a, b) => (a.proxima_dosis < b.proxima_dosis ? -1 : a.proxima_dosis > b.proxima_dosis ? 1 : 0));
}

// Numero listo para WhatsApp (solo digitos, con codigo de pais) o null si no sirve.
function vetTelefonoWhatsApp(crudo, pais) {
  const texto = String(crudo || '').trim();
  if (!texto) return null;
  const tienePlus = texto.startsWith('+') || texto.startsWith('00');
  let d = texto.replace(/\D/g, '');
  if (!d) return null;
  if (tienePlus) { if (texto.startsWith('00')) d = d.slice(2); return d.length >= 8 ? d : null; }
  const cod = VET_CODIGOS_PAIS[String(pais || 'NI').toUpperCase()] || '505';
  if (d.length >= cod.length + 7 && d.startsWith(cod)) return d;   // ya trae el codigo de pais
  if (d.length < 7) return null;                                    // demasiado corto para ser un telefono
  return cod + d;
}

function vetMensajeRecordatorio({ dueno, mascota, vacuna, proxima, negocio, hoy }) {
  const dias = vetDiasEntre(hoy || vetHoy(), proxima);
  const f = vetFechaLarga(proxima);
  const cuando = dias < 0 ? `que venció el ${f}` : dias === 0 ? 'para hoy' : `para el ${f}`;
  const saludo = dueno ? `Hola ${dueno}` : 'Hola';
  return `${saludo}, le saludamos de ${negocio || 'su veterinaria'} 🐾. Le recordamos que ${mascota} tiene pendiente su refuerzo de ${vacuna} ${cuando}. ¿Le agendamos una cita?`;
}
function vetEnlaceWhatsApp(telefono, texto) { return `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`; }
