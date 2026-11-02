/* =====================================================
   MENSAJERIA-IMPORTAR.JS — NEGOCIO360 · Mensajería: cargar envíos desde Excel
   Para comercios que mandan muchos envíos de una vez. Acepta Excel
   (.xlsx/.xls) o CSV. Reconoce las columnas por su nombre (con o sin
   tildes), muestra una vista previa con los errores fila por fila y
   carga todo junto en el servidor: todo o nada (msj_envios_importar),
   con las mismas reglas y tarifas que uno por uno.
   Requiere: mensajeria-base.js y TE (mensajeria-envios.js).
===================================================== */
'use strict';
const TI = { filas: [], listas: [] };
const TI_COLS = [
  ['comercio', ['comercio', 'cliente', 'tienda']], ['remitente', ['remitente', 'quien envia', 'envia', 'de']], ['remitente_telefono', ['telefono remitente', 'tel remitente', 'telefono de quien envia']],
  ['destinatario', ['destinatario', 'para', 'quien recibe', 'recibe', 'nombre']], ['telefono', ['telefono', 'telefono destinatario', 'celular', 'tel', 'whatsapp']],
  ['direccion', ['direccion', 'direccion de entrega', 'domicilio']], ['referencia', ['referencia', 'punto de referencia', 'senas']], ['zona', ['zona', 'barrio', 'municipio']],
  ['descripcion', ['descripcion', 'que lleva', 'producto', 'contenido']], ['paquetes', ['paquetes', 'cantidad', 'bultos']], ['tamano', ['tamano', 'tamaño']],
  ['urgente', ['urgente']], ['cobrar', ['cobrar', 'cobrar contra entrega', 'contra entrega', 'monto', 'valor']], ['paga', ['paga envio', 'quien paga', 'paga el envio', 'paga']],
  ['fecha', ['fecha', 'fecha de entrega']], ['notas', ['notas', 'nota', 'observaciones', 'comentario']], ['ubicacion', ['ubicacion', 'maps', 'google maps', 'link']],
];
const TI_PLANTILLA = ['Comercio', 'Remitente', 'Teléfono remitente', 'Destinatario', 'Teléfono', 'Dirección', 'Referencia', 'Zona', 'Descripción', 'Paquetes', 'Tamaño', 'Urgente', 'Cobrar contra entrega', 'Paga envío', 'Fecha', 'Notas'];
const tiNorm = t => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function tiCargarXLSX() {
  if (window.XLSX) return Promise.resolve(true);
  return new Promise(res => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = () => res(!!window.XLSX); s.onerror = () => res(false); document.head.appendChild(s); });
}
// CSV sencillo (comas o punto y coma, comillas dobles).
function tiCSV(texto) {
  texto = texto.replace(/^﻿/, ''); const sep = (texto.split('\n')[0].match(/;/g) || []).length > (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const filas = []; let f = [], c = '', q = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (q) { if (ch === '"') { if (texto[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { f.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; f.push(c); filas.push(f); f = []; c = ''; }
    else c += ch;
  }
  if (c !== '' || f.length) { f.push(c); filas.push(f); }
  return filas;
}
TI.plantilla = async function () {
  const ejemplo = [TI_PLANTILLA, ['', 'Tienda Rosa', '88112233', 'Ana López', '88445566', 'Bello Horizonte, casa 5', 'Frente a la pulpería', TE.zonas.find(z => z.activo)?.nombre || 'Centro', '2 blusas', '1', 'Pequeño', 'No', '500', 'Destinatario', '', '']];
  if (await tiCargarXLSX()) {
    const hoja = XLSX.utils.aoa_to_sheet(ejemplo); hoja['!cols'] = TI_PLANTILLA.map(() => ({ wch: 18 }));
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'Envíos'); XLSX.writeFile(libro, 'plantilla_envios.xlsx'); return;
  }
  const csv = '﻿' + ejemplo.map(f => f.map(v => /[",;\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'plantilla_envios.csv'; a.click();
};
TI.abrir = function () {
  const m = msVentana('ti-modal', '📥 Cargar envíos desde Excel', `
    <div class="ms-nota">Sube un Excel o CSV con <b>una fila por envío</b>. Mínimo: <b>Destinatario</b> y <b>Dirección</b>. La tarifa sale sola según la <b>Zona</b> (escrita igual que en tus zonas). Máximo 300 por carga. Antes de cargar verás cada fila y sus errores.</div>
    <div class="tl-f"><label for="ti-com">Comercio que manda estos envíos <span class="tl-muted">(si el archivo no trae columna “Comercio”)</span></label>
      <select class="tl-sel" id="ti-com"><option value="">Ninguno / viene en el archivo</option>${TE.comercios.map(c => `<option value="${c.id}">${esc(c.completo)}</option>`).join('')}</select></div>
    <div class="tl-f"><label for="ti-arch">Archivo</label><input class="tl-inp" id="ti-arch" type="file" accept=".xlsx,.xls,.csv,text/csv"></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" class="ms-sel" id="ti-bodega"> Los paquetes ya están en nuestra bodega</label>
    <div id="ti-prev"></div><div id="ti-av"></div>`,
    '<button type="button" class="btn-secondary" onclick="TI.plantilla()">⬇️ Plantilla</button><button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="ti-ok" disabled>Cargar envíos</button>', 820);
  m.querySelector('#ti-arch').onchange = () => TI.leer(m);
  m.querySelector('#ti-com').onchange = () => { if (TI.crudo) TI.preparar(m); };
  m.querySelector('#ti-ok').onclick = () => TI.cargar(m);
};
TI.leer = async function (m) {
  const f = m.querySelector('#ti-arch').files[0], av = m.querySelector('#ti-av'); av.innerHTML = ''; TI.crudo = null;
  if (!f) return;
  try {
    let filas;
    if (/\.csv$/i.test(f.name) || f.type === 'text/csv') filas = tiCSV(await f.text());
    else {
      if (!(await tiCargarXLSX())) { av.innerHTML = '<div class="tl-aviso">No se pudo abrir el lector de Excel. Revisa tu conexión o guarda el archivo como CSV.</div>'; return; }
      const libro = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: '' });
    }
    TI.crudo = filas; TI.preparar(m);
  } catch (e) { console.warn(e); av.innerHTML = '<div class="tl-aviso">No se pudo leer el archivo. Revisa que sea Excel o CSV.</div>'; }
};
function tiFecha(v) {
  if (v instanceof Date && !isNaN(v)) return ymd(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) return ymd(new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000));
  const s = String(v || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return 'mal';
}
TI.preparar = function (m) {
  const filas = (TI.crudo || []).filter(f => f.some(c => String(c ?? '').trim() !== ''));
  const prev = m.querySelector('#ti-prev'), ok = m.querySelector('#ti-ok');
  if (filas.length < 2) { prev.innerHTML = '<div class="tl-aviso">El archivo no tiene envíos (la primera fila deben ser los títulos).</div>'; ok.disabled = true; return; }
  const titulos = filas[0].map(tiNorm), idx = {};
  TI_COLS.forEach(([k, alias]) => { const i = titulos.findIndex(t => alias.map(tiNorm).includes(t)); if (i >= 0) idx[k] = i; });
  if (idx.destinatario == null || idx.direccion == null) { prev.innerHTML = '<div class="tl-aviso">No encontré las columnas <b>Destinatario</b> y <b>Dirección</b>. Descarga la plantilla para ver cómo debe quedar.</div>'; ok.disabled = true; return; }
  const comFijo = m.querySelector('#ti-com').value, zonas = {}, coms = {};
  TE.zonas.filter(z => z.activo).forEach(z => { zonas[tiNorm(z.nombre)] = z; });
  TE.comercios.forEach(c => { coms[tiNorm(c.completo)] = c; coms[tiNorm(c.nombre)] = coms[tiNorm(c.nombre)] || c; });
  const val = (f, k) => idx[k] == null ? '' : f[idx[k]];
  const txt = (f, k) => String(val(f, k) ?? '').trim();
  TI.filas = filas.slice(1).map((f, n) => {
    const errores = [], p = {};
    const comTxt = txt(f, 'comercio'), com = comTxt ? coms[tiNorm(comTxt)] : (comFijo ? TE.comercios.find(c => c.id === comFijo) : null);
    if (comTxt && !com) errores.push(`el comercio “${comTxt}” no está registrado`);
    p.comercio_id = com ? com.id : null;
    p.remitente_nombre = txt(f, 'remitente') || (com ? com.completo : '');
    if (p.remitente_nombre.length < 2) errores.push('falta quién envía');
    p.remitente_telefono = txt(f, 'remitente_telefono'); p.destinatario_nombre = txt(f, 'destinatario'); p.destinatario_telefono = txt(f, 'telefono');
    p.direccion = txt(f, 'direccion'); p.referencia = txt(f, 'referencia'); p.descripcion = txt(f, 'descripcion'); p.notas = txt(f, 'notas');
    if (p.destinatario_nombre.length < 2) errores.push('falta el destinatario');
    if (p.direccion.length < 3) errores.push('falta la dirección');
    const zt = txt(f, 'zona'); if (zt) { const z = zonas[tiNorm(zt)]; if (z) { p.zona_id = z.id; p.zona_nombre = z.nombre; } else errores.push(`la zona “${zt}” no existe`); }
    const cob = String(val(f, 'cobrar') ?? '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
    p.monto_cobrar = cob === '' ? 0 : Number(cob); if (!(p.monto_cobrar >= 0)) errores.push('el monto a cobrar no es válido');
    if (p.monto_cobrar > 0 && !p.comercio_id) errores.push('para cobrar contra entrega elige el comercio');
    const paq = txt(f, 'paquetes'); p.paquetes = paq === '' ? 1 : Math.round(Number(paq)); if (!(p.paquetes >= 1 && p.paquetes <= 999)) errores.push('cantidad de paquetes no válida');
    const tam = tiNorm(txt(f, 'tamano')); p.tamano = /grand/.test(tam) ? 'grande' : /medi/.test(tam) ? 'mediano' : 'pequeno';
    p.urgente = /^(si|s|x|1|true|urgente)$/.test(tiNorm(txt(f, 'urgente')));
    p.envio_lo_paga = /(destinatario|recibe|cliente final)/.test(tiNorm(txt(f, 'paga'))) ? 'destinatario' : 'comercio';
    const fe = tiFecha(val(f, 'fecha')); if (fe === 'mal') errores.push('fecha no válida (usa día/mes/año)'); else p.fecha_programada = fe;
    const ub = msLeerUbicacion(txt(f, 'ubicacion')); if (!ub.ok) errores.push('ubicación no válida'); else { p.lat = ub.lat; p.lng = ub.lng; }
    p.en_bodega = m.querySelector('#ti-bodega').checked;
    return { n: n + 2, p, errores };
  });
  const malas = TI.filas.filter(x => x.errores.length);
  prev.innerHTML = `<div class="ms-res" style="margin:4px 0 8px"><div><b>${TI.filas.length}</b><span>envíos en el archivo</span></div><div class="${malas.length ? 'alerta' : ''}"><b>${malas.length}</b><span>con errores</span></div></div>
    ${TI.filas.length > 300 ? '<div class="tl-aviso">Máximo 300 envíos por carga. Divide el archivo.</div>' : ''}
    <div style="overflow-x:auto;max-height:320px"><table class="tl-tabla"><thead><tr><th>Fila</th><th>Para</th><th>Dirección</th><th>Zona</th><th class="tl-num">Cobrar</th><th>Revisión</th></tr></thead><tbody>
    ${TI.filas.slice(0, 300).map(x => `<tr><td data-t="Fila">${x.n}</td><td data-t="Para">${esc(x.p.destinatario_nombre)}</td><td data-t="Dirección">${esc(x.p.direccion)}</td><td data-t="Zona">${esc(x.p.zona_nombre || '—')}</td>
      <td data-t="Cobrar" class="tl-num">${x.p.monto_cobrar ? fmt(x.p.monto_cobrar) : '—'}</td>
      <td data-t="Revisión">${x.errores.length ? `<span style="color:var(--danger);font-weight:700">⚠️ ${esc(x.errores.join(' · '))}</span>` : '<span class="ms-chip entregado">✔ Bien</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  ok.disabled = !!malas.length || TI.filas.length > 300;
  ok.textContent = malas.length ? 'Corrige los errores' : `Cargar ${TI.filas.length} envío${TI.filas.length === 1 ? '' : 's'}`;
};
TI.cargar = async function (m) {
  const ok = m.querySelector('#ti-ok'), av = m.querySelector('#ti-av');
  if (!TI.filas.length || TI.filas.some(x => x.errores.length)) return;
  ok.disabled = true; ok.textContent = 'Cargando…';
  const envios = TI.filas.map(x => { const p = { ...x.p }; delete p.zona_nombre; return p; });
  const r = await msRpc('msj_envios_importar', { p: { envios, por: msPor() } });
  ok.disabled = false; ok.textContent = `Cargar ${TI.filas.length} envíos`;
  if (!r.ok) { av.innerHTML = `<div class="tl-aviso">${esc(r.motivo === 'fila' ? `Fila ${TI.filas[r.fila - 1]?.n ?? r.fila} del archivo: ${MS_MOTIVOS[r.detalle] || 'tiene un dato que no es válido.'} No se cargó ningún envío.` : r.msg)}</div>`; return; }
  m.classList.remove('abierto');
  await TE.cargar();
  const nuevos = TE.lista.filter(e => e.numero >= r.desde && e.numero <= r.hasta);
  msVentana('ti-listo', `✅ ${r.creados} envíos cargados`, `<div class="ms-linea">Del <b>${esc(r.desde)}</b> al <b>${esc(r.hasta)}</b>, con su tarifa calculada.</div><div class="tl-muted">Imprime sus etiquetas y asígnalos en Despacho.</div>`,
    `<button type="button" class="btn-secondary" data-cerrar>Listo</button><button type="button" class="btn-primary" id="ti-et">🏷️ Imprimir ${nuevos.length} etiquetas</button>`, 460);
  document.getElementById('ti-et').onclick = () => msEtiquetas(nuevos);
};
