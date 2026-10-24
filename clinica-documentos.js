/* =====================================================
   CLÍNICA -- Documentos (Fase 2): catálogos y armado del
   documento imprimible en hoja CARTA o en TICKET (80 mm).
   Funciones puras: reciben los datos y devuelven el HTML;
   todo texto escrito por usuarios se escapa (esc).
   Requiere clinica-comun.js y vet-comun.js (fechas).
===================================================== */
const CLINICA_DOCUMENTOS = {
  receta:         { e: '💊', n: 'Receta médica' },
  orden_lab:      { e: '🧪', n: 'Orden de laboratorio' },
  orden_imagen:   { e: '🩻', n: 'Orden de imágenes / estudios' },
  constancia:     { e: '📄', n: 'Constancia de atención' },
  certificado:    { e: '📜', n: 'Certificado médico' },
  referencia:     { e: '↗️', n: 'Referencia / interconsulta' },
  consentimiento: { e: '✍️', n: 'Consentimiento informado' },
};
const CLINICA_EXAMENES_LAB = {
  'Hematología': ['Biometría hemática completa (BHC)', 'Recuento de plaquetas', 'Grupo sanguíneo y factor Rh', 'Velocidad de sedimentación (VSG)',
    'Tiempo de protrombina (TP)', 'Tiempo parcial de tromboplastina (TPT)', 'Gota gruesa (malaria)'],
  'Química': ['Glucosa en ayunas', 'Hemoglobina glicosilada (HbA1c)', 'Creatinina', 'Nitrógeno de urea (BUN)', 'Ácido úrico', 'Colesterol total',
    'Triglicéridos', 'Perfil lipídico completo', 'TGO / AST', 'TGP / ALT', 'Bilirrubinas', 'Fosfatasa alcalina', 'Electrolitos (Na, K, Cl)', 'Proteína C reactiva (PCR)'],
  'Orina y heces': ['Examen general de orina (EGO)', 'Urocultivo', 'Examen general de heces (EGH)', 'Sangre oculta en heces', 'Coprocultivo'],
  'Hormonas y serología': ['Prueba de embarazo (β-hCG)', 'TSH', 'T4 libre', 'Antígeno prostático (PSA)', 'VIH', 'VDRL / RPR (sífilis)',
    'Hepatitis B (HBsAg)', 'Dengue NS1', 'Dengue IgM', 'Factor reumatoideo', 'Antiestreptolisinas (ASO)'],
  'Otros': ['Papanicolaou', 'Exudado faríngeo con cultivo', 'Baciloscopía (BAAR)'],
};
const CLINICA_ESTUDIOS_IMAGEN = ['Radiografía de tórax PA', 'Radiografía de columna lumbar', 'Radiografía de columna cervical', 'Radiografía de rodilla',
  'Radiografía de mano / muñeca', 'Radiografía de tobillo / pie', 'Ultrasonido abdominal', 'Ultrasonido pélvico', 'Ultrasonido obstétrico',
  'Ultrasonido renal y de vías urinarias', 'Ultrasonido de mama', 'Ultrasonido de tiroides', 'Mamografía', 'Electrocardiograma (EKG)',
  'Ecocardiograma', 'Tomografía (TAC) de cráneo', 'Tomografía (TAC) de abdomen', 'Resonancia magnética', 'Densitometría ósea'];

function clinicaTextoConstancia(paciente, fechaYmd) {
  return `Por medio de la presente se hace constar que ${paciente || 'el/la paciente'} asistió a consulta médica en esta clínica el día ${vetFechaLarga(fechaYmd || vetHoy())}.`;
}
function clinicaTextoCertificado(paciente, fechaYmd) {
  return `Certifico que he examinado a ${paciente || 'el/la paciente'} el día ${vetFechaLarga(fechaYmd || vetHoy())}.`;
}
const CLINICA_TEXTO_CONSENTIMIENTO = 'Declaro que el médico me explicó, en palabras que entendí, en qué consiste el procedimiento, sus beneficios, riesgos y alternativas, que pude hacer preguntas y que me fueron respondidas. Entiendo que puedo retirar este consentimiento en cualquier momento antes del procedimiento. Por lo anterior, autorizo libre y voluntariamente que se me realice.';

function _cdEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const _cdTexto = s => _cdEsc(s).replace(/\n/g, '<br>');
const _cdURL = u => /^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '';

// Cuerpo propio de cada tipo de documento.
function _cdCuerpo(d, ticket) {
  const c = d.contenido || {};
  const linea = (t, v) => v ? `<p><b>${t}:</b> ${_cdTexto(v)}</p>` : '';
  switch (d.tipo) {
    case 'receta': {
      const items = Array.isArray(c.items) ? c.items : [];
      const rx = ticket
        ? items.map((it, i) => `<div class="it"><b>${i + 1}. ${_cdEsc(it.medicamento)}</b>${it.presentacion ? ` <span>${_cdEsc(it.presentacion)}</span>` : ''}${it.cantidad ? ` <span>· Cant.: ${_cdEsc(it.cantidad)}</span>` : ''}${it.indicaciones ? `<div>${_cdTexto(it.indicaciones)}</div>` : ''}</div>`).join('')
        : `<table><thead><tr><th>#</th><th>Medicamento</th><th>Cantidad</th><th>Cómo tomarlo</th></tr></thead><tbody>${items.map((it, i) =>
            `<tr><td>${i + 1}</td><td><b>${_cdEsc(it.medicamento)}</b>${it.presentacion ? `<div class="s">${_cdEsc(it.presentacion)}</div>` : ''}</td><td>${_cdEsc(it.cantidad || '—')}</td><td>${_cdTexto(it.indicaciones || '')}</td></tr>`).join('')}</tbody></table>`;
      return `<div class="rx">℞</div>${rx}${linea('Indicaciones generales', c.notas)}`;
    }
    case 'orden_lab':
      return `${linea('Diagnóstico presuntivo', c.diagnostico)}<p><b>Exámenes solicitados:</b></p><ul>${(c.examenes || []).map(x => `<li>☑ ${_cdEsc(x)}</li>`).join('')}${c.otros ? `<li>☑ ${_cdTexto(c.otros)}</li>` : ''}</ul>${linea('Indicaciones', c.indicaciones)}`;
    case 'orden_imagen':
      return `${linea('Diagnóstico / indicación clínica', c.diagnostico)}<p><b>Estudios solicitados:</b></p><ul>${(c.estudios || []).map(x => `<li>☑ ${_cdEsc(x)}</li>`).join('')}${c.otros ? `<li>☑ ${_cdTexto(c.otros)}</li>` : ''}</ul>${linea('Región / detalles', c.region)}${linea('Indicaciones', c.indicaciones)}`;
    case 'constancia':
      return `<p class="txt">${_cdTexto(c.texto)}</p>${linea('Hora de atención', c.horario)}<p class="s">Se extiende la presente a solicitud del interesado para los fines que estime conveniente.</p>`;
    case 'certificado': {
      const dias = Number(c.dias_reposo) || 0;
      const reposo = dias > 0 ? `<p>Se indica <b>reposo por ${dias} ${dias === 1 ? 'día' : 'días'}</b>${c.desde ? `, del ${_cdEsc(vetFechaLarga(c.desde))} al ${_cdEsc(vetFechaLarga(vetSumarDias(c.desde, dias - 1)))}` : ''}.</p>` : '';
      return `<p class="txt">${_cdTexto(c.texto)}</p>${linea('Diagnóstico', c.diagnostico)}${reposo}<p class="s">Se extiende el presente certificado a solicitud del interesado.</p>`;
    }
    case 'referencia':
      return `${linea('Se refiere a', c.destino)}${c.urgente ? '<p><b>⚠️ URGENTE</b></p>' : ''}${linea('Motivo de la referencia', c.motivo)}${linea('Resumen clínico', c.resumen)}${linea('Diagnóstico', c.diagnostico)}${linea('Tratamiento recibido', c.tratamiento)}`;
    case 'consentimiento':
      return `${linea('Procedimiento', c.procedimiento)}${linea('En qué consiste', c.descripcion)}${linea('Riesgos y posibles complicaciones', c.riesgos)}${linea('Alternativas', c.alternativas)}
        <p class="txt">${_cdTexto(c.declaracion || CLINICA_TEXTO_CONSENTIMIENTO)}</p>${c.representante ? linea('Firma como representante', c.representante) : ''}`;
  }
  return '';
}

// HTML completo listo para imprimir. formato: 'carta' | 'ticket'.
function clinicaHtmlDocumento({ doc, paciente, negocio, formato }) {
  const ticket = formato === 'ticket';
  const t = CLINICA_DOCUMENTOS[doc.tipo] || { n: 'Documento' };
  const p = paciente || {};
  const n = negocio || {};
  const fechaYmd = String(doc.fecha || '').slice(0, 10) || vetHoy();
  const logo = !ticket && _cdURL(n.logo_principal_url);
  const firmaMedico = `<div class="firma"><div>${_cdEsc(doc.medico_nombre || 'Médico')}${doc.medico_especialidad ? `<br><span class="s">${_cdEsc(doc.medico_especialidad)}</span>` : ''}${doc.medico_registro ? `<br><span class="s">Cód. MINSA ${_cdEsc(doc.medico_registro)}</span>` : ''}</div></div>`;
  const firmas = doc.tipo === 'consentimiento'
    ? `<div class="firmas"><div class="firma"><div>Firma del paciente o representante<br><span class="s">Cédula:</span></div></div>${firmaMedico}<div class="firma"><div>Testigo</div></div></div>`
    : firmaMedico;
  const css = ticket
    ? `@page{size:80mm auto;margin:3mm} body{font-family:Arial,Helvetica,sans-serif;color:#000;width:72mm;margin:0 auto;font-size:12px} h1{font-size:14px;margin:0;text-align:center} h2{font-size:13px;text-align:center;margin:8px 0 2px;text-transform:uppercase}
       .cab{text-align:center;border-bottom:1px dashed #000;padding-bottom:6px} .s{font-size:10.5px} .num{text-align:center;font-size:11px;margin-bottom:6px} .pac{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:5px 0;margin:6px 0}
       .pac div{margin:1px 0} p{margin:5px 0;line-height:1.35} ul{padding-left:16px;margin:4px 0} .it{margin:6px 0} .rx{font-size:20px;font-weight:bold} .firma{margin-top:36px;text-align:center} .firma div{border-top:1px solid #000;padding-top:4px}
       .firmas .firma{margin-top:30px} .anulado{border:2px solid #000;text-align:center;font-weight:bold;padding:4px;margin:6px 0}`
    : `@page{size:letter;margin:16mm} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:13.5px} h1{font-size:19px;margin:0} h2{text-align:center;font-size:17px;margin:16px 0 4px;letter-spacing:.5px;text-transform:uppercase}
       .cab{display:flex;justify-content:space-between;gap:14px;align-items:center;border-bottom:2px solid #111;padding-bottom:10px} .cab img{max-height:62px;max-width:150px} .s{color:#555;font-size:12px}
       .num{text-align:center;color:#555;font-size:12.5px;margin-bottom:12px} .pac{border:1px solid #bbb;border-radius:8px;padding:9px 13px;margin:10px 0 14px;display:grid;grid-template-columns:1fr 1fr;gap:4px 18px}
       table{width:100%;border-collapse:collapse;margin-top:6px} th,td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left;vertical-align:top} th{font-size:11.5px;color:#555;text-transform:uppercase}
       p{line-height:1.55;margin:7px 0} .txt{font-size:14px} ul{margin:4px 0;columns:2} .rx{font-size:26px;font-weight:bold;font-family:Georgia,serif}
       .firma{margin-top:64px;text-align:center} .firma div{border-top:1px solid #111;width:270px;margin:0 auto;padding-top:6px} .firmas{display:grid;grid-template-columns:1fr 1fr;gap:10px 30px}
       .firmas .firma div{width:auto} .anulado{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:90px;font-weight:bold;color:rgba(200,0,0,.18);transform:rotate(-24deg);pointer-events:none}`;
  const datosNeg = [n.direccion, n.ciudad, n.telefono && 'Tel. ' + n.telefono].filter(Boolean).map(_cdEsc).join(' · ');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${_cdEsc(t.n)} ${_cdEsc(doc.numero || '')}</title><style>${css}</style></head><body>
    ${doc.estado === 'anulado' ? '<div class="anulado">ANULADO</div>' : ''}
    <div class="cab">${ticket
      ? `<h1>${_cdEsc(n.nombre_comercial || 'Clínica')}</h1>${datosNeg ? `<div class="s">${datosNeg}</div>` : ''}`
      : `<div><h1>${_cdEsc(n.nombre_comercial || 'Clínica')}</h1>${datosNeg ? `<div class="s">${datosNeg}</div>` : ''}</div>${logo ? `<img src="${_cdEsc(logo)}" alt="">` : ''}`}</div>
    <h2>${_cdEsc(t.n)}</h2>
    <div class="num">N.º ${_cdEsc(doc.numero || '—')} · ${_cdEsc(vetFechaLarga(fechaYmd))}</div>
    <div class="pac">
      <div><b>Paciente:</b> ${_cdEsc(clinicaNombrePaciente(p))}</div><div><b>Edad:</b> ${_cdEsc(clinicaEdad(p.fecha_nacimiento, fechaYmd))}</div>
      <div><b>Cédula:</b> ${_cdEsc(p.cedula || '—')}</div><div><b>Expediente:</b> ${_cdEsc(p.numero_expediente || '—')}</div>
    </div>
    ${_cdCuerpo(doc, ticket)}
    ${firmas}
  </body></html>`;
}

if (typeof module !== 'undefined') module.exports = { CLINICA_DOCUMENTOS, CLINICA_EXAMENES_LAB, CLINICA_ESTUDIOS_IMAGEN, clinicaHtmlDocumento, clinicaTextoConstancia, clinicaTextoCertificado };
