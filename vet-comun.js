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

/* =====================================================
   FASE 2 -- equipo veterinario, agenda y dosis
===================================================== */
const VET_TIPOS_CITA = {
  consulta:   { e: '🩺', n: 'Consulta' },     vacunacion: { e: '💉', n: 'Vacunación' },
  cirugia:    { e: '🔪', n: 'Cirugía' },      control:    { e: '🔁', n: 'Control' },
  estetica:   { e: '🛁', n: 'Baño / estética' }, otro:   { e: '📝', n: 'Otro' },
};
const VET_ESTADOS_CITA = {
  programada: { n: 'Programada', clase: 'azul' },  confirmada: { n: 'Confirmada', clase: 'verde' },
  atendida:   { n: 'Atendida',   clase: 'gris' },  cancelada:  { n: 'Cancelada',  clase: 'rojo' },
  no_asistio: { n: 'No asistió', clase: 'ambar' },
};

// Equipo: 0 veterinarios = texto libre | 1 = se asigna solo, sin preguntar | 2 o mas = selector.
function vetModoEquipo(equipo) {
  const n = (equipo || []).filter(v => v.activo !== false).length;
  return n === 0 ? 'libre' : n === 1 ? 'unico' : 'varios';
}
// Devuelve { id, nombre } del veterinario a guardar segun el modo del equipo.
function vetResolverVeterinario(equipo, idElegido, textoLibre) {
  const activos = (equipo || []).filter(v => v.activo !== false);
  if (activos.length === 0) { const t = String(textoLibre || '').trim(); return { id: null, nombre: t || null }; }
  if (activos.length === 1) return { id: activos[0].id, nombre: activos[0].nombre };
  const v = idElegido ? activos.find(x => x.id === idElegido) : null;
  return v ? { id: v.id, nombre: v.nombre } : { id: null, nombre: null };
}

// ---- Horas
function vetHoraMin(hhmm) { const [h, m] = String(hhmm || '').slice(0, 5).split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function vetMinAHora(min) { return `${_vp(Math.floor(min / 60) % 24)}:${_vp(min % 60)}`; }
function vetFormatoHora(hhmm) {
  if (!/^\d{1,2}:\d{2}/.test(String(hhmm || ''))) return '—';      // vacio o mal formado: nunca "medianoche"
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${_vp(m || 0)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
function vetRangoCita(hora, duracion) { return `${vetFormatoHora(hora)} – ${vetFormatoHora(vetMinAHora(vetHoraMin(hora) + Number(duracion || 30)))}`; }
// Choque de horario: misma fecha, MISMO veterinario (o ambas sin asignar) y rangos que se pisan.
// Las citas canceladas o de quien no asistio no ocupan agenda. Terminar justo cuando otra empieza NO es choque.
function vetChoqueCita(nueva, existentes, ignorarId) {
  const ini = vetHoraMin(nueva.hora), fin = ini + Number(nueva.duracion_min || 30);
  return (existentes || []).find(c => {
    if (c.id === ignorarId || c.fecha !== nueva.fecha) return false;
    if (c.estado === 'cancelada' || c.estado === 'no_asistio') return false;
    if ((c.veterinario_id || '') !== (nueva.veterinario_id || '')) return false;
    const ci = vetHoraMin(c.hora), cf = ci + Number(c.duracion_min || 30);
    return ini < cf && ci < fin;
  }) || null;
}
function vetMensajeCita({ dueno, mascota, negocio, fecha, hora, veterinario }) {
  const saludo = dueno ? `Hola ${dueno}` : 'Hola';
  const con = veterinario ? ` con ${veterinario}` : '';
  return `${saludo}, le saludamos de ${negocio || 'su veterinaria'} 🐾. Le recordamos la cita de ${mascota}${con} el ${vetFechaLarga(fecha)} a las ${vetFormatoHora(hora)}. ¡Los esperamos! Si necesita cambiarla, avísenos.`;
}

// ---- Dosis (AYUDA de calculo: el veterinario siempre confirma con su criterio clinico)
const _r2 = n => Math.round(n * 100) / 100;
// mg totales = peso x dosis. Liquidos (mg/ml) -> ml; tabletas (mg/tableta) -> tabletas, redondeado a 1/4.
function vetCalcularDosis({ pesoKg, dosisMgKg, concentracion, unidad }) {
  const peso = Number(pesoKg), dosis = Number(dosisMgKg), conc = Number(concentracion);
  if (!(peso > 0) || !(dosis > 0) || !(conc > 0)) return null;
  const mgTotal = _r2(peso * dosis);
  const exacta = mgTotal / conc;
  if (unidad === 'mg/tableta') {
    const cuartos = Math.round(exacta * 4) / 4;
    return { mgTotal, exacta: _r2(exacta), cantidad: cuartos > 0 ? cuartos : 0.25, unidadTexto: cuartos === 1 ? 'tableta' : 'tabletas', redondeada: true };
  }
  return { mgTotal, exacta: _r2(exacta), cantidad: _r2(exacta), unidadTexto: 'ml', redondeada: false };
}
function vetTotalADispensar(cantidadPorToma, frecuenciaHoras, dias) {
  const c = Number(cantidadPorToma), f = Number(frecuenciaHoras), d = Number(dias);
  if (!(c > 0) || !(f > 0) || !(d > 0)) return null;
  return _r2(c * (24 / f) * d);
}
function vetFormatoNumero(n) { return String(_r2(Number(n))).replace(/\.0+$/, ''); }
// "Dar 2.4 ml cada 12 h por 7 días (vía oral)"
function vetTextoPosologia(it) {
  const partes = [];
  if (it.cantidad_por_toma) partes.push(`Dar ${vetFormatoNumero(it.cantidad_por_toma)}${it.unidad_toma ? ' ' + it.unidad_toma : ''}`);
  if (it.frecuencia_horas) partes.push(`cada ${it.frecuencia_horas} h`);
  if (it.duracion_dias) partes.push(`por ${it.duracion_dias} ${Number(it.duracion_dias) === 1 ? 'día' : 'días'}`);
  let t = partes.join(' ');
  if (it.via) t += (t ? ' ' : '') + `(vía ${it.via})`;
  return t || '—';
}
const VET_DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function vetDiaSemana(ymd) { const p = vetPartes(ymd); return VET_DIAS_SEMANA[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]; }

// ---- Receta imprimible (pura: devuelve el HTML; quien la llama abre la ventana de impresion)
function vetEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function vetHtmlReceta({ negocio, fecha, mascota, especie, raza, edad, peso, dueno, veterinario, items }) {
  const filas = (items || []).map((it, i) => {
    const total = vetTotalADispensar(it.cantidad_por_toma, it.frecuencia_horas, it.duracion_dias);
    return `<tr><td>${i + 1}</td><td><b>${vetEsc(it.medicamento)}</b>${it.indicaciones ? `<div class="s">${vetEsc(it.indicaciones)}</div>` : ''}</td>`
      + `<td>${vetEsc(vetTextoPosologia(it))}${total ? `<div class="s">Total a dispensar: ${vetEsc(vetFormatoNumero(total))} ${vetEsc(it.unidad_toma || '')}</div>` : ''}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Receta — ${vetEsc(mascota)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:14px} h1{font-size:20px;margin:0} .sub{color:#555;font-size:13px}
    .cab{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px}
    .caja{border:1px solid #bbb;border-radius:8px;padding:10px 14px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ddd;padding:9px 6px;text-align:left;vertical-align:top} th{font-size:12px;color:#555;text-transform:uppercase}
    .s{color:#555;font-size:12px;margin-top:3px} .firma{margin-top:70px;text-align:center} .firma div{border-top:1px solid #111;width:260px;margin:0 auto;padding-top:6px}
  </style></head><body>
    <div class="cab"><div><h1>${vetEsc(negocio || 'Veterinaria')}</h1><div class="sub">Receta veterinaria</div></div><div class="sub">${vetEsc(vetFechaLarga(fecha))}</div></div>
    <div class="caja">
      <div><b>Mascota:</b> ${vetEsc(mascota)}</div><div><b>Dueño:</b> ${vetEsc(dueno || '—')}</div>
      <div><b>Especie / raza:</b> ${vetEsc([especie, raza].filter(Boolean).join(' · ') || '—')}</div><div><b>Edad:</b> ${vetEsc(edad || '—')}</div>
      <div><b>Peso:</b> ${peso ? vetEsc(peso) + ' kg' : '—'}</div><div><b>Veterinario:</b> ${vetEsc(veterinario || '—')}</div>
    </div>
    <table><thead><tr><th>#</th><th>Medicamento</th><th>Cómo darlo</th></tr></thead><tbody>${filas || '<tr><td colspan="3">Sin medicamentos.</td></tr>'}</tbody></table>
    <div class="firma"><div>${vetEsc(veterinario || 'Firma y sello del veterinario')}</div></div>
  </body></html>`;
}

/* =====================================================
   FASE 3 -- estancias (hospital, pension, bano) y certificados
===================================================== */
const VET_TIPOS_ESTANCIA = {
  hospitalizacion: { e: '🏥', n: 'Hospitalización', verbo: 'Dar de alta' },
  pension:         { e: '🏨', n: 'Pensión',         verbo: 'Registrar salida' },
  estetica:        { e: '🛁', n: 'Baño / estética', verbo: 'Entregar' },
};
const VET_ESTADOS_ESTANCIA = {
  activa: { n: 'En el local', clase: 'azul' }, lista: { n: 'Lista para recoger', clase: 'verde' },
  finalizada: { n: 'Finalizada', clase: 'gris' }, cancelada: { n: 'Cancelada', clase: 'rojo' },
};
// 'YYYY-MM-DD' en HORA LOCAL de un instante (un ingreso a las 11 p. m. cuenta para ESE dia, no para el siguiente en UTC).
function vetYmdLocal(iso) { const d = new Date(iso); return `${d.getFullYear()}-${_vp(d.getMonth() + 1)}-${_vp(d.getDate())}`; }
// Dias cobrables: dias de calendario entre ingreso y salida (2 noches = 2); el minimo es 1 (mismo dia = 1).
function vetDiasEstancia(ingreso, salida) {
  if (!ingreso) return 1;
  return Math.max(1, vetDiasEntre(vetYmdLocal(ingreso), vetYmdLocal(salida || new Date().toISOString())));
}
function vetMensajeListo({ dueno, mascota, negocio }) {
  return `${dueno ? 'Hola ' + dueno : 'Hola'}, le saludamos de ${negocio || 'su veterinaria'} 🐾. Ya puede pasar a recoger a ${mascota} cuando guste. ¡Los esperamos!`;
}
function vetImprimirHtml(html) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  return true;
}
const _VET_CSS_CERT = `body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:36px;font-size:14px} h1{font-size:20px;margin:0} h2{text-align:center;font-size:18px;margin:18px 0 14px;letter-spacing:.5px;text-transform:uppercase}
  .sub{color:#555;font-size:13px} .cab{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px}
  .caja{border:1px solid #bbb;border-radius:8px;padding:10px 14px;margin:14px 0;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
  table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left} th{font-size:12px;color:#555;text-transform:uppercase}
  p{line-height:1.6} .obs{border-bottom:1px solid #999;height:26px;margin-top:6px} .firma{margin-top:70px;text-align:center} .firma div{border-top:1px solid #111;width:260px;margin:0 auto;padding-top:6px}`;
function _vetCajaPaciente(d) {
  return `<div class="caja"><div><b>Mascota:</b> ${vetEsc(d.mascota)}</div><div><b>Dueño:</b> ${vetEsc(d.dueno || '—')}</div>
    <div><b>Especie / raza:</b> ${vetEsc([d.especie, d.raza].filter(Boolean).join(' · ') || '—')}</div><div><b>Sexo:</b> ${vetEsc(d.sexo || '—')}</div>
    <div><b>Edad:</b> ${vetEsc(d.edad || '—')}</div><div><b>Microchip:</b> ${vetEsc(d.microchip || '—')}</div>${d.peso ? `<div><b>Peso:</b> ${vetEsc(d.peso)} kg</div>` : ''}</div>`;
}
function _vetCabCert(d, titulo) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${vetEsc(titulo)} — ${vetEsc(d.mascota)}</title><style>${_VET_CSS_CERT}</style></head><body>
    <div class="cab"><div><h1>${vetEsc(d.negocio || 'Veterinaria')}</h1></div><div class="sub">${vetEsc(vetFechaLarga(d.fecha))}</div></div><h2>${vetEsc(titulo)}</h2>`;
}
function vetHtmlCertificadoVacunas(d) {
  const filas = (d.vacunas || []).slice().sort((a, b) => String(a.fecha_aplicacion).localeCompare(String(b.fecha_aplicacion))).map(v =>
    `<tr><td>${vetEsc(vetFechaLarga(v.fecha_aplicacion))}</td><td>${vetEsc((VET_TIPOS_REGISTRO[v.tipo] || VET_TIPOS_REGISTRO.otro).n)}</td><td><b>${vetEsc(v.nombre)}</b></td><td>${vetEsc(v.lote || '—')}</td><td>${v.proxima_dosis ? vetEsc(vetFechaLarga(v.proxima_dosis)) : '—'}</td></tr>`).join('');
  return _vetCabCert(d, 'Certificado de vacunación') + _vetCajaPaciente(d)
    + `<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Aplicación</th><th>Lote</th><th>Próxima dosis</th></tr></thead><tbody>${filas || '<tr><td colspan="5">Sin registros de vacunación.</td></tr>'}</tbody></table>`
    + `<div class="firma"><div>${vetEsc(d.veterinario || 'Firma y sello del veterinario')}</div></div></body></html>`;
}
function vetHtmlCertificadoSalud(d) {
  return _vetCabCert(d, 'Certificado de salud') + _vetCajaPaciente(d)
    + `<p>Por medio de la presente se certifica que el paciente arriba descrito fue examinado clínicamente el ${vetEsc(vetFechaLarga(d.fecha))} y, al momento del examen, no presenta signos aparentes de enfermedad infectocontagiosa.</p>
    <p><b>Observaciones:</b></p><div class="obs"></div><div class="obs"></div>
    <p class="sub">Este certificado no sustituye los requisitos sanitarios que exija la autoridad competente para viajes o traslados.</p>
    <div class="firma"><div>${vetEsc(d.veterinario || 'Firma y sello del veterinario')}</div></div></body></html>`;
}
