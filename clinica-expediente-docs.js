/* =====================================================
   CLÍNICA · FASE 2 — en el expediente del paciente:
   diagnósticos CIE-10 en la consulta, documentos (receta y
   paso a Farmacia, órdenes, constancia, certificado,
   referencia, consentimiento) y archivos adjuntos privados.
   Se carga después de clinica-pacientes.js y usa su estado
   (CP, STATE, sb, $p, esc). Todo lo clínico pasa por el
   servidor con la sesión médica (ClinicaSesion).
===================================================== */

/* ---------- Diagnósticos CIE-10 en la consulta ---------- */
function htmlDiagnosticos(lista) {
  if (!Array.isArray(lista) || !lista.length) return '';
  return `<p><b>Diagnósticos:</b> ${lista.map(x => `<span class="cl-badge ${x.principal ? 'cl-badge-azul' : 'cl-badge-gris'}">${x.codigo ? esc(x.codigo) + ' · ' : ''}${esc(x.nombre)}</span>`).join(' ')}</p>`;
}
function pintarDx() {
  const cont = $p('co-dx-lista'), lista = CP.dx || [];
  cont.innerHTML = lista.length ? lista.map((x, i) => `<div class="cl-elegido" style="margin-top:4px">
      <span>${x.principal ? '⭐ ' : ''}${x.codigo ? `<b>${esc(x.codigo)}</b> · ` : ''}${esc(x.nombre)}</span>
      <span style="white-space:nowrap">${x.principal ? '' : `<button class="cl-link" type="button" onclick="marcarDxPrincipal(${i})">Principal</button> `}<button class="cl-link" type="button" onclick="quitarDx(${i})" aria-label="Quitar">✕</button></span></div>`).join('')
    : '<p class="cl-sub" style="margin:4px 0 0">Busca por nombre o código (ej. "faringitis" o "J02").</p>';
}
let _tDx = null;
function buscarDx(q) {
  clearTimeout(_tDx);
  _tDx = setTimeout(() => {
    const cont = $p('co-dx-resultados'), res = clinicaBuscarCIE10(q);
    if (String(q || '').trim().length < 2) { cont.style.display = 'none'; return; }
    cont.innerHTML = res.map((d, i) => `<div class="cl-resultado" tabindex="0" data-i="${i}"><b>${esc(d.codigo)}</b> · ${esc(d.nombre)}</div>`).join('')
      + `<div class="cl-resultado" tabindex="0" data-libre="1">✏️ Usar "<b>${esc(String(q).trim().slice(0, 200))}</b>" como texto libre (sin código)</div>`;
    cont.querySelectorAll('[data-i]').forEach(el => { const f = () => agregarDx(res[Number(el.dataset.i)]); el.addEventListener('click', f); el.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
    cont.querySelector('[data-libre]').addEventListener('click', () => agregarDx({ codigo: '', nombre: String(q).trim().slice(0, 200) }));
    cont.style.display = '';
  }, 150);
}
function agregarDx(d) {
  CP.dx = CP.dx || [];
  if (!d || !d.nombre) return;
  if (CP.dx.length >= 20) { showToast('Máximo 20 diagnósticos por consulta.', 'error'); return; }
  if (!CP.dx.some(x => (x.codigo && x.codigo === d.codigo) || (!x.codigo && x.nombre === d.nombre))) CP.dx.push({ codigo: d.codigo || '', nombre: d.nombre, principal: !CP.dx.length });
  $p('co-dx-buscar').value = ''; $p('co-dx-resultados').style.display = 'none'; pintarDx();
}
function quitarDx(i) { const era = CP.dx[i]?.principal; CP.dx.splice(i, 1); if (era && CP.dx[0]) CP.dx[0].principal = true; pintarDx(); }
function marcarDxPrincipal(i) { CP.dx.forEach((x, j) => { x.principal = j === i; }); pintarDx(); }

/* ---------- Documentos ---------- */
const fechaDoc = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }); };
function seccionDocumentos(docs, yo) {
  const html = docs.map(d => {
    const t = CLINICA_DOCUMENTOS[d.tipo] || { e: '📄', n: d.tipo };
    const items = d.tipo === 'receta' ? (d.contenido?.items || []) : [];
    const btns = [`<button class="btn-accion-tabla btn-ghost" onclick="imprimirDocumento('${d.id}','carta')">🖨️ Carta</button>`,
      `<button class="btn-accion-tabla btn-ghost" onclick="imprimirDocumento('${d.id}','ticket')">🧾 Ticket</button>`];
    if (d.estado === 'emitido' && d.tipo === 'receta') {
      if (STATE.empresaConfig?.usa_farmacia_fase2 === true) btns.push(d.farmacia_receta_id ? '<span class="cl-badge cl-badge-verde">💊 En Farmacia</span>' : `<button class="btn-accion-tabla btn-ghost" onclick="recetaAFarmacia('${d.id}')">💊 Pasar a Farmacia</button>`);
      if (items.some(it => it.producto_id) && d.consulta_id) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="recetaACuenta('${d.id}')">➕ A la cuenta</button>`);
    }
    if (d.estado === 'emitido' && (d.medico_id === yo.id || yo.rol === 'admin')) btns.push(`<button class="btn-accion-tabla btn-ghost" onclick="abrirAnularDoc('${d.id}')">🚫 Anular</button>`);
    const resumen = d.tipo === 'receta' ? items.map(it => it.medicamento).join(', ')
      : d.tipo === 'orden_lab' ? (d.contenido?.examenes || []).join(', ') : d.tipo === 'orden_imagen' ? (d.contenido?.estudios || []).join(', ')
      : d.tipo === 'referencia' ? 'A: ' + (d.contenido?.destino || '') : d.tipo === 'consentimiento' ? (d.contenido?.procedimiento || '') : '';
    return `<div class="cl-item ${d.estado === 'anulado' ? 'anulada' : ''}"><div class="cl-item-cab"><div>
        <div class="cl-item-tit">${t.e} ${esc(t.n)} <span class="cl-sub">${esc(d.numero)}</span></div>
        <div class="cl-item-fecha">${esc(fechaDoc(d.fecha))} · ${esc(d.medico_nombre)}</div></div>
        ${d.estado === 'anulado' ? '<span class="cl-badge cl-badge-rojo">Anulado</span>' : ''}</div>
      ${resumen ? `<p class="cl-sub">${esc(resumen.slice(0, 240))}</p>` : ''}
      ${d.estado === 'anulado' ? `<p class="cl-sub">🚫 ${esc(d.anulado_por_nombre || '')}: ${esc(d.motivo_anulacion || '')}</p>` : ''}
      <div class="cl-acciones">${btns.join('')}</div></div>`;
  }).join('');
  return `<div class="cl-seccion">Documentos (${docs.length})</div>${html || '<p class="cl-sub">Sin documentos. Usa "📄 Documento" para hacer recetas, órdenes, constancias…</p>'}`;
}

const DOC = { tipo: 'receta', consultaId: null, items: [], prodBusca: null };
function abrirDocumento(tipo, consultaId) {
  DOC.consultaId = consultaId || null;
  const sel = $p('do-tipo');
  if (!sel.options.length) Object.entries(CLINICA_DOCUMENTOS).forEach(([k, v]) => sel.add(new Option(`${v.e} ${v.n}`, k)));
  const cons = (CP.exp?.consultas || []).filter(c => c.estado !== 'anulada');
  $p('do-consulta').innerHTML = '<option value="">— Sin ligar a una consulta —</option>' + cons.map(c => `<option value="${esc(c.id)}">${esc(fechaDoc(c.fecha))} · ${esc(c.motivo.slice(0, 60))}</option>`).join('');
  $p('do-consulta').value = DOC.consultaId || (cons[0] && cons[0].fecha.slice(0, 10) === vetHoy() ? cons[0].id : '');
  sel.value = tipo || 'receta';
  $p('do-error').textContent = '';
  cambiarTipoDocumento();
  openModal('modal-documento');
}
function consultaElegida() { return (CP.exp?.consultas || []).find(c => c.id === $p('do-consulta').value) || null; }
function textoDx(c) { if (!c) return ''; return (Array.isArray(c.diagnosticos) && c.diagnosticos.length) ? c.diagnosticos.map(x => (x.codigo ? x.codigo + ' ' : '') + x.nombre).join('; ') : (c.diagnostico || ''); }
function campoDoc(id, label, tipo = 'text', extra = '') { return `<div class="cl-field"><label for="dc-${id}">${label}</label><input type="${tipo}" id="dc-${id}" class="cl-in" ${extra}/></div>`; }
function areaDoc(id, label, ph = '', max = 4000) { return `<div class="cl-field"><label for="dc-${id}">${label}</label><textarea id="dc-${id}" class="cl-ta" maxlength="${max}" placeholder="${esc(ph)}"></textarea></div>`; }
function cambiarTipoDocumento() {
  const tipo = $p('do-tipo').value, c = consultaElegida(), nombre = clinicaNombrePaciente(CP.ficha), cont = $p('do-campos');
  DOC.tipo = tipo;
  if (tipo === 'receta') {
    DOC.items = [{ medicamento: '', presentacion: '', cantidad: '', indicaciones: '', producto_id: null }];
    cont.innerHTML = `<div id="dc-items"></div><button class="cl-link" type="button" onclick="agregarItemReceta()">+ Agregar otro medicamento</button>${areaDoc('notas', 'Indicaciones generales', 'Ej: tomar con alimentos, volver si hay fiebre…', 1000)}`;
    pintarItemsReceta();
  } else if (tipo === 'orden_lab' || tipo === 'orden_imagen') {
    const grupos = tipo === 'orden_lab' ? CLINICA_EXAMENES_LAB : { 'Estudios': CLINICA_ESTUDIOS_IMAGEN };
    cont.innerHTML = `${campoDoc('diagnostico', tipo === 'orden_lab' ? 'Diagnóstico presuntivo' : 'Indicación clínica', 'text', 'maxlength="400"')}
      ${Object.entries(grupos).map(([g, xs]) => `<div class="cl-seccion">${esc(g)}</div><div class="cl-grid2">${xs.map(x => `<label class="cl-check"><input type="checkbox" data-examen value="${esc(x)}"/> ${esc(x)}</label>`).join('')}</div>`).join('')}
      ${areaDoc('otros', 'Otros', 'Escribe aquí si no está en la lista', 1000)}${tipo === 'orden_imagen' ? campoDoc('region', 'Región / detalles', 'text', 'maxlength="300"') : ''}
      ${campoDoc('indicaciones', 'Indicaciones', 'text', `maxlength="400" placeholder="${tipo === 'orden_lab' ? 'Ej: ayuno de 8 horas' : 'Ej: vejiga llena'}"`)}`;
    $p('dc-diagnostico').value = textoDx(c).slice(0, 400);
  } else if (tipo === 'constancia') {
    cont.innerHTML = areaDoc('texto', 'Texto *', '', 2000) + campoDoc('horario', 'Hora de atención (opcional)', 'text', 'maxlength="60" placeholder="Ej: de 9:00 a 10:00 a. m."');
    $p('dc-texto').value = clinicaTextoConstancia(nombre, c ? c.fecha.slice(0, 10) : vetHoy());
  } else if (tipo === 'certificado') {
    cont.innerHTML = areaDoc('texto', 'Texto *', '', 2000) + campoDoc('diagnostico', 'Diagnóstico (si el paciente lo autoriza)', 'text', 'maxlength="400"')
      + `<div class="cl-grid2">${campoDoc('dias', 'Días de reposo', 'number', 'min="0" max="365" step="1" inputmode="numeric"')}${campoDoc('desde', 'A partir del', 'date')}</div>`;
    $p('dc-texto').value = clinicaTextoCertificado(nombre, c ? c.fecha.slice(0, 10) : vetHoy());
    $p('dc-desde').value = vetHoy();
  } else if (tipo === 'referencia') {
    cont.innerHTML = campoDoc('destino', 'Se refiere a *', 'text', 'maxlength="200" placeholder="Ej: Cardiología, Hospital…"')
      + `<label class="cl-check"><input type="checkbox" id="dc-urgente"/> Es urgente</label>`
      + areaDoc('motivo', 'Motivo de la referencia *', '', 1000) + areaDoc('resumen', 'Resumen clínico', 'Historia breve, hallazgos, exámenes', 4000)
      + campoDoc('diagnostico', 'Diagnóstico', 'text', 'maxlength="400"') + areaDoc('tratamiento', 'Tratamiento recibido', '', 2000);
    $p('dc-diagnostico').value = textoDx(c).slice(0, 400);
    if (c) $p('dc-resumen').value = [c.motivo, c.enfermedad_actual].filter(Boolean).join('. ').slice(0, 4000);
  } else if (tipo === 'consentimiento') {
    cont.innerHTML = campoDoc('procedimiento', 'Procedimiento *', 'text', 'maxlength="200" placeholder="Ej: Sutura de herida, extracción de uña…"')
      + areaDoc('descripcion', 'En qué consiste', '', 2000) + areaDoc('riesgos', 'Riesgos y posibles complicaciones', '', 2000)
      + areaDoc('alternativas', 'Alternativas', '', 1000) + campoDoc('representante', 'Si firma un representante: nombre y parentesco', 'text', 'maxlength="120"')
      + areaDoc('declaracion', 'Declaración', '', 2000);
    $p('dc-declaracion').value = CLINICA_TEXTO_CONSENTIMIENTO;
  }
}
// ---- Receta: varios medicamentos; cada uno puede ligarse a un producto del inventario (para cobrar o vender en Farmacia)
function pintarItemsReceta() {
  $p('dc-items').innerHTML = DOC.items.map((it, i) => `<div class="cl-item" style="padding:10px 12px">
      <div class="cl-item-cab"><b>Medicamento ${i + 1}</b>${DOC.items.length > 1 ? `<button class="cl-link" type="button" onclick="quitarItemReceta(${i})">Quitar</button>` : ''}</div>
      <div class="cl-field"><label for="dc-med-${i}">Nombre *</label><input type="text" id="dc-med-${i}" class="cl-in" maxlength="200" value="${esc(it.medicamento)}" oninput="itemReceta(${i},'medicamento',this.value);buscarProductoReceta(${i},this.value)" autocomplete="off" placeholder="Ej: Acetaminofén 500 mg"/>
        <div id="dc-med-res-${i}" class="cl-resultados" style="display:none"></div>
        ${it.producto_id ? `<div class="cl-sub">🔗 Ligado al inventario <button class="cl-link" type="button" onclick="desligarProducto(${i})">quitar</button></div>` : ''}</div>
      <div class="cl-grid2">
        <div class="cl-field"><label for="dc-pre-${i}">Presentación / dosis</label><input type="text" id="dc-pre-${i}" class="cl-in" maxlength="120" value="${esc(it.presentacion)}" oninput="itemReceta(${i},'presentacion',this.value)" placeholder="Ej: tabletas 500 mg"/></div>
        <div class="cl-field"><label for="dc-can-${i}">Cantidad a entregar</label><input type="text" id="dc-can-${i}" class="cl-in" maxlength="40" value="${esc(it.cantidad)}" oninput="itemReceta(${i},'cantidad',this.value)" placeholder="Ej: 15"/></div>
      </div>
      <div class="cl-field"><label for="dc-ind-${i}">Cómo tomarlo</label><input type="text" id="dc-ind-${i}" class="cl-in" maxlength="300" value="${esc(it.indicaciones)}" oninput="itemReceta(${i},'indicaciones',this.value)" placeholder="Ej: 1 tableta cada 8 horas por 5 días"/></div>
    </div>`).join('');
}
function itemReceta(i, k, v) { if (DOC.items[i]) { DOC.items[i][k] = v; if (k === 'medicamento' && DOC.items[i].producto_id && v !== DOC.items[i]._nombreProducto) { DOC.items[i].producto_id = null; } } }
function agregarItemReceta() { if (DOC.items.length >= 30) return; DOC.items.push({ medicamento: '', presentacion: '', cantidad: '', indicaciones: '', producto_id: null }); pintarItemsReceta(); $p('dc-med-' + (DOC.items.length - 1)).focus(); }
function quitarItemReceta(i) { DOC.items.splice(i, 1); pintarItemsReceta(); }
function desligarProducto(i) { DOC.items[i].producto_id = null; pintarItemsReceta(); }
let _tRxProd = null;
function buscarProductoReceta(i, q) {
  clearTimeout(_tRxProd);
  const cont = $p('dc-med-res-' + i); q = (q || '').replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 3) { cont.style.display = 'none'; return; }
  _tRxProd = setTimeout(async () => {
    try {
      const { data, error } = await sb.from('productos').select('id, nombre, presentacion, concentracion, es_sustancia_controlada')
        .eq('auth_user_id', STATE.userId).eq('activo', true).eq('tipo', 'producto').ilike('nombre', `%${q}%`).order('nombre').limit(6);
      if (error) throw error;
      if (!data || !data.length) { cont.style.display = 'none'; return; }
      cont.innerHTML = '<div class="cl-sub" style="padding:6px 11px">Ligar con tu inventario (opcional):</div>' + data.map(p => `<div class="cl-resultado" tabindex="0" data-id="${esc(p.id)}">📦 ${esc(p.nombre)}${p.es_sustancia_controlada ? ' <span class="cl-badge cl-badge-ambar">controlado</span>' : ''}</div>`).join('');
      cont.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => {
        const p = data.find(x => x.id === el.dataset.id);
        Object.assign(DOC.items[i], { producto_id: p.id, medicamento: p.nombre, _nombreProducto: p.nombre, presentacion: DOC.items[i].presentacion || [p.presentacion, p.concentracion].filter(Boolean).join(' ') });
        pintarItemsReceta();
      }));
      cont.style.display = '';
    } catch (e) { console.warn('buscarProductoReceta:', e); }
  }, 300);
}
function leerDocumento() {
  const v = id => ($p('dc-' + id)?.value || '').trim();
  switch (DOC.tipo) {
    case 'receta': {
      const items = DOC.items.map(it => ({ medicamento: it.medicamento.trim().slice(0, 200), presentacion: it.presentacion.trim().slice(0, 120), cantidad: it.cantidad.trim().slice(0, 40),
        indicaciones: it.indicaciones.trim().slice(0, 300), producto_id: it.producto_id || null })).filter(it => it.medicamento);
      if (!items.length) return { error: 'Escribe al menos un medicamento.' };
      return { items, notas: v('notas') };
    }
    case 'orden_lab': case 'orden_imagen': {
      const sel = [...document.querySelectorAll('#do-campos [data-examen]:checked')].map(el => el.value);
      if (!sel.length && !v('otros')) return { error: 'Marca al menos un examen o escríbelo en "Otros".' };
      const base = { diagnostico: v('diagnostico'), otros: v('otros'), indicaciones: v('indicaciones') };
      return DOC.tipo === 'orden_lab' ? { ...base, examenes: sel } : { ...base, estudios: sel, region: v('region') };
    }
    case 'constancia': return v('texto') ? { texto: v('texto'), horario: v('horario') } : { error: 'Escribe el texto.' };
    case 'certificado': {
      const dias = v('dias');
      if (!v('texto')) return { error: 'Escribe el texto.' };
      if (dias !== '' && !/^\d{1,3}$/.test(dias)) return { error: 'Los días de reposo deben ser un número entero (0 a 365).' };
      return { texto: v('texto'), diagnostico: v('diagnostico'), dias_reposo: dias === '' ? null : String(Number(dias)), desde: dias && Number(dias) > 0 ? (v('desde') || vetHoy()) : null };
    }
    case 'referencia': return v('destino') && v('motivo') ? { destino: v('destino'), urgente: $p('dc-urgente').checked, motivo: v('motivo'), resumen: v('resumen'), diagnostico: v('diagnostico'), tratamiento: v('tratamiento') }
      : { error: 'Escribe a dónde se refiere y el motivo.' };
    case 'consentimiento': return v('procedimiento') ? { procedimiento: v('procedimiento'), descripcion: v('descripcion'), riesgos: v('riesgos'), alternativas: v('alternativas'), representante: v('representante'), declaracion: v('declaracion') }
      : { error: 'Escribe el procedimiento.' };
  }
  return { error: 'Tipo de documento no válido.' };
}
async function guardarDocumento(formato) {
  const err = $p('do-error'); err.textContent = '';
  const contenido = leerDocumento();
  if (contenido.error) { err.textContent = contenido.error; return; }
  const btns = document.querySelectorAll('#modal-documento .modal-footer button'); btns.forEach(b => { b.disabled = true; });
  // Se abre la ventana de impresión YA (en el clic), para que el navegador no la bloquee.
  const w = formato ? window.open('', '_blank') : null;
  try {
    const r = await ClinicaSesion.rpc('clinica_documento_emitir', { p_datos: { paciente_id: CP.ficha.id, consulta_id: $p('do-consulta').value || null, tipo: DOC.tipo, contenido } });
    if (!r || !r.ok) { if (w) w.close(); err.textContent = clinicaTextoMotivo(r); return; }
    closeModal('modal-documento');
    showToast(`Documento ${r.numero} emitido.`);
    await pintarExpediente();
    if (w) imprimirDocumento(r.id, formato, w);
  } catch (e) { if (w) w.close(); if (!e.cancelado) { console.error('guardarDocumento:', e); err.textContent = clinicaTextoError(e, 'No se pudo emitir el documento.'); } }
  finally { btns.forEach(b => { b.disabled = false; }); }
}
function imprimirDocumento(id, formato, ventana) {
  const d = (CP.exp?.documentos || []).find(x => x.id === id);
  if (!d) { if (ventana) ventana.close(); return; }
  const html = clinicaHtmlDocumento({ doc: d, paciente: CP.ficha, negocio: STATE.empresaConfig, formato });
  const w = ventana || window.open('', '_blank');
  if (!w) { showToast('Tu navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.', 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
}
let _anularDocId = null;
function abrirAnularDoc(id) { _anularDocId = id; $p('ndoc-motivo').value = ''; $p('ndoc-error').textContent = ''; openModal('modal-anular-doc'); }
async function confirmarAnularDoc() {
  const m = $p('ndoc-motivo').value.trim();
  if (m.length < 5) { $p('ndoc-error').textContent = 'Escribe el motivo (al menos 5 letras).'; return; }
  try {
    const fn = _anularDocId.startsWith('adj:') ? 'clinica_adjunto_anular' : 'clinica_documento_anular';
    const r = await ClinicaSesion.rpc(fn, { p_id: _anularDocId.replace(/^adj:/, ''), p_motivo: m });
    if (!r || !r.ok) { $p('ndoc-error').textContent = clinicaTextoMotivo(r); return; }
    closeModal('modal-anular-doc'); showToast('Anulado (se conserva en el historial).'); await pintarExpediente();
  } catch (e) { if (!e.cancelado) { console.error('anular:', e); $p('ndoc-error').textContent = clinicaTextoError(e); } }
}

// ---- Receta -> Farmacia: queda registrada en Farmacia · Recetas y se puede vender por Ventas (camino de siempre).
async function recetaAFarmacia(id) {
  const d = (CP.exp?.documentos || []).find(x => x.id === id);
  if (!d || STATE.empresaConfig?.usa_farmacia_fase2 !== true) return;
  try {
    const items = d.contenido?.items || [];
    const { data: fr, error } = await sb.from('farmacia_recetas').insert({ auth_user_id: STATE.userId, paciente_nombre: clinicaNombrePaciente(CP.ficha).slice(0, 120),
      medico_nombre: d.medico_nombre, numero_receta: d.numero, fecha: String(d.fecha).slice(0, 10), observaciones: 'Desde Clínica' }).select('id').single();
    if (error) throw error;
    const filas = items.map(it => ({ receta_id: fr.id, producto_id: it.producto_id || null, producto_nombre: it.medicamento, cantidad: Number(String(it.cantidad).replace(',', '.')) > 0 ? Number(String(it.cantidad).replace(',', '.')) : 1 }));
    const { error: e2 } = await sb.from('farmacia_receta_items').insert(filas);
    if (e2) throw e2;
    const r = await ClinicaSesion.rpc('clinica_documento_farmacia', { p_id: d.id, p_farmacia_receta_id: fr.id });
    if (!r || !r.ok) throw new Error(r?.motivo || 'no se pudo ligar');
    await pintarExpediente();
    const vendibles = filas.filter(f => f.producto_id);
    if (vendibles.length && confirm('La receta quedó en Farmacia. ¿Vender los medicamentos ahora?')) {
      sessionStorage.setItem('n360_receta_a_vender', JSON.stringify({ recetaId: fr.id, items: vendibles.map(f => ({ producto_id: f.producto_id, cantidad: f.cantidad })) }));
      window.location.href = 'ventas.html';
    } else showToast('Receta enviada a Farmacia · Recetas.');
  } catch (e) { if (!e.cancelado) { console.error('recetaAFarmacia:', e); showToast('No se pudo pasar a Farmacia. Intenta de nuevo.', 'error'); } }
}
// ---- Receta -> cuenta de la visita (se cobra junto con la consulta, por Ventas).
async function recetaACuenta(id) {
  const d = (CP.exp?.documentos || []).find(x => x.id === id);
  const c = d && (CP.exp?.consultas || []).find(x => x.id === d.consulta_id);
  if (!c || !c.cita_id) { showToast('Esta receta no está ligada a una consulta con cita: cóbrala directo en Ventas.', 'error'); return; }
  try {
    const { data: cita } = await sb.from('clinica_citas').select('id, ventas(estado)').eq('id', c.cita_id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (!cita) { showToast('No se encontró la cita de esta consulta.', 'error'); return; }
    if (cita.ventas?.estado === 'completada') { showToast('Esa visita ya fue cobrada: vende los medicamentos directo en Ventas.', 'error'); return; }
    const filas = (d.contenido?.items || []).filter(it => it.producto_id).map(it => ({ auth_user_id: STATE.userId, cita_id: c.cita_id, producto_id: it.producto_id,
      descripcion: it.medicamento.slice(0, 200), cantidad: Number(String(it.cantidad).replace(',', '.')) > 0 ? Number(String(it.cantidad).replace(',', '.')) : 1 }));
    const { error } = await sb.from('clinica_cargos').insert(filas);
    if (error) throw error;
    showToast(`${filas.length} medicamento(s) agregados a la cuenta de la visita. Recepción la cobra en la Agenda.`);
  } catch (e) { console.error('recetaACuenta:', e); showToast(clinicaTextoError(e, 'No se pudo agregar a la cuenta.'), 'error'); }
}

/* ---------- Archivos adjuntos (almacén privado) ---------- */
const ADJ_TIPOS = { 'application/pdf': '📄', 'image/jpeg': '🖼️', 'image/png': '🖼️', 'image/webp': '🖼️' };
const tamanoTexto = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
function seccionAdjuntos(adj, yo) {
  const html = adj.map(a => `<div class="cl-item ${a.estado === 'anulado' ? 'anulada' : ''}"><div class="cl-item-cab"><div>
      <div class="cl-item-tit">${ADJ_TIPOS[a.mime] || '📎'} ${esc(a.nombre)}</div>
      <div class="cl-item-fecha">${esc(fechaDoc(a.created_at))} · ${esc(a.subido_por_nombre || '')} · ${esc(tamanoTexto(a.tamano))}</div></div>
      ${a.estado === 'anulado' ? '<span class="cl-badge cl-badge-rojo">Anulado</span>' : ''}</div>
      ${a.descripcion ? `<p class="cl-sub">${esc(a.descripcion)}</p>` : ''}${a.estado === 'anulado' ? `<p class="cl-sub">🚫 ${esc(a.motivo_anulacion || '')}</p>` : ''}
      ${a.estado === 'listo' ? `<div class="cl-acciones"><button class="btn-accion-tabla btn-ghost" onclick="verAdjunto('${a.id}')">👁️ Ver</button><button class="btn-accion-tabla btn-ghost" onclick="abrirAnularDoc('adj:${a.id}')">🚫 Anular</button></div>` : ''}</div>`).join('');
  return `<div class="cl-seccion">Archivos (${adj.length})</div>${html || '<p class="cl-sub">Sin archivos. Sube resultados de laboratorio, imágenes o documentos con "📎 Subir archivo".</p>'}`;
}
function abrirAdjunto() {
  $p('aj-archivo').value = ''; $p('aj-descripcion').value = ''; $p('aj-error').textContent = ''; $p('aj-progreso').textContent = '';
  const cons = (CP.exp?.consultas || []).filter(c => c.estado !== 'anulada');
  $p('aj-consulta').innerHTML = '<option value="">— Sin ligar a una consulta —</option>' + cons.map(c => `<option value="${esc(c.id)}">${esc(fechaDoc(c.fecha))} · ${esc(c.motivo.slice(0, 60))}</option>`).join('');
  openModal('modal-adjunto');
}
// Llama a la función del servidor que entrega enlaces firmados (con la sesión médica). Si venció, pide el PIN y reintenta.
async function servidorAdjuntos(cuerpo) {
  for (let intento = 0; intento < 2; intento++) {
    let s = ClinicaSesion.leer() || await ClinicaSesion.pedir();
    if (!s) { const e = new Error('cancelado'); e.cancelado = true; throw e; }
    const { data, error } = await sb.functions.invoke('clinica-adjuntos', { body: { ...cuerpo, token: s.token } });
    const r = data || (error && error.context && typeof error.context.json === 'function' ? await error.context.json().catch(() => null) : null);
    if (r && r.motivo === 'sesion' && intento === 0) { await ClinicaSesion.bloquear(); continue; }
    if (!r) throw error || new Error('sin respuesta');
    return r;
  }
}
async function subirAdjunto() {
  const err = $p('aj-error'); err.textContent = '';
  const f = $p('aj-archivo').files[0];
  if (!f) { err.textContent = 'Elige el archivo.'; return; }
  if (!ADJ_TIPOS[f.type]) { err.textContent = 'Solo se aceptan PDF, JPG, PNG o WEBP.'; return; }
  if (f.size > 10485760) { err.textContent = 'El archivo pasa de 10 MB. Redúcelo o tómale foto de nuevo.'; return; }
  const btn = $p('aj-btn'); btn.disabled = true;
  try {
    $p('aj-progreso').textContent = 'Preparando…';
    const r = await servidorAdjuntos({ accion: 'subir', paciente_id: CP.ficha.id, consulta_id: $p('aj-consulta').value || null, nombre: f.name.slice(0, 150), mime: f.type, tamano: f.size, descripcion: $p('aj-descripcion').value.trim().slice(0, 300) || null });
    if (!r.ok) { err.textContent = r.motivo === 'tipo_archivo' ? 'Tipo de archivo no permitido.' : r.motivo === 'tamano' ? 'El archivo es muy grande (máximo 10 MB).' : 'No se pudo preparar la subida.'; return; }
    $p('aj-progreso').textContent = 'Subiendo…';
    const { error: eUp } = await sb.storage.from('clinica-adjuntos').uploadToSignedUrl(r.ruta, r.subida, f, { contentType: f.type });
    if (eUp) throw eUp;
    const c = await servidorAdjuntos({ accion: 'confirmar', id: r.id });
    if (!c.ok) { err.textContent = 'El archivo no terminó de subir. Intenta de nuevo.'; return; }
    closeModal('modal-adjunto'); showToast('Archivo guardado en el expediente.'); await pintarExpediente();
  } catch (e) { if (!e.cancelado) { console.error('subirAdjunto:', e); err.textContent = 'No se pudo subir. Revisa tu conexión e intenta de nuevo.'; } }
  finally { btn.disabled = false; $p('aj-progreso').textContent = ''; }
}
async function verAdjunto(id) {
  const w = window.open('', '_blank');           // se abre ya (en el clic) para que no la bloquee el navegador
  try {
    const r = await servidorAdjuntos({ accion: 'ver', id });
    if (!r.ok || !/^https:\/\//.test(r.url || '')) { if (w) w.close(); showToast('No se pudo abrir el archivo.', 'error'); return; }
    if (w) w.location.href = r.url; else window.location.href = r.url;
  } catch (e) { if (w) w.close(); if (!e.cancelado) { console.error('verAdjunto:', e); showToast('No se pudo abrir el archivo.', 'error'); } }
}
