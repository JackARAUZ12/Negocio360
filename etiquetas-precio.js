/* ============================================================
   ETIQUETAS-PRECIO.JS — NEGOCIO360 (Otros · Etiquetas de precio)
   Etiquetas de precio para imprimir (tipo supermercado).
   - SOLO LEE Productos/Servicios. No escribe en ninguna tabla, no
     cambia precios ni inventario. Las etiquetas manuales y los
     precios editados aquí solo existen en esta pantalla.
   - Las preferencias (formato, tamaño, campos) se recuerdan en este
     navegador; nada se guarda en el sistema.
   - PDF generado en el navegador (jsPDF): hoja carta/A4 llena de
     etiquetas, rollo de etiquetas (una por página exacta) o impresora
     de tickets de 58/80 mm.
   ============================================================ */
'use strict';

(function () {
  const sb = TX.sb;
  const $ = id => document.getElementById(id);
  const esc = TX.esc;
  const MAX_ETIQUETAS = 2000;
  const PREFS_KEY = 'n360_etq_prefs';

  // Tamaños (mm). "fijo" = hoja adhesiva con distribución exacta.
  const TAM_HOJA = {
    '30x20': { t: '30 × 20 mm (mini)', w: 30, h: 20 },
    '40x30': { t: '40 × 30 mm (estándar de góndola)', w: 40, h: 30 },
    '50x30': { t: '50 × 30 mm', w: 50, h: 30 },
    '60x40': { t: '60 × 40 mm (grande)', w: 60, h: 40 },
    '70x37': { t: 'Hoja adhesiva A4 de 24 (70 × 37 mm)', w: 70, h: 37, fijo: { papel: 'a4', cols: 3, rows: 8, top: 0.5, left: 0, gapX: 0, gapY: 0 } },
    '100x50': { t: '100 × 50 mm (ofertas)', w: 100, h: 50 },
    'avery5160': { t: 'Hoja adhesiva Avery 5160 (30 por hoja carta)', w: 66.675, h: 25.4, fijo: { papel: 'carta', cols: 3, rows: 10, top: 12.7, left: 4.7625, gapX: 3.175, gapY: 0 } },
  };
  const TAM_ROLLO = {
    '30x20': { t: '30 × 20 mm', w: 30, h: 20 }, '40x30': { t: '40 × 30 mm', w: 40, h: 30 }, '50x30': { t: '50 × 30 mm', w: 50, h: 30 },
    '50x40': { t: '50 × 40 mm', w: 50, h: 40 }, '60x40': { t: '60 × 40 mm', w: 60, h: 40 }, '100x50': { t: '100 × 50 mm', w: 100, h: 50 },
  };
  const TAM_TICKET = {
    '58x30': { t: 'Rollo 58 mm · etiqueta baja', w: 58, h: 30, util: 48 }, '58x40': { t: 'Rollo 58 mm · etiqueta alta', w: 58, h: 40, util: 48 },
    '80x35': { t: 'Rollo 80 mm · etiqueta baja', w: 80, h: 35, util: 72 }, '80x50': { t: 'Rollo 80 mm · etiqueta alta', w: 80, h: 50, util: 72 },
  };
  const PAPEL = { carta: { w: 215.9, h: 279.4 }, a4: { w: 210, h: 297 } };
  const IVA = { incluido: 'IVA incluido', mas: '+ IVA', exento: 'Exento de IVA', ninguno: '' };
  const IVA_CICLO = ['incluido', 'mas', 'exento', 'ninguno'];

  const ST = {
    productos: [], lineas: [], formato: 'hoja',
    prefs: { formato: 'hoja', papel: 'carta', tamHoja: '40x30', tamRollo: '40x30', tamTicket: '58x40', ivaDefecto: 'incluido',
      negocio: true, codigo: false, sku: false, fecha: false, corte: true },
  };
  try { Object.assign(ST.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (_) {}
  const guardarPrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(ST.prefs)); } catch (_) {} };

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  // Moneda del negocio (la de los precios guardados en Productos)
  const simbolo = () => { const m = TX.empresaConfig?.moneda || 'NIO'; return ({ NIO: 'C$', USD: '$' }[m]) || m; };
  const fmtPrecio = n => `${simbolo()} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const quitarTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let seq = 0;

  // ── Productos (solo lectura) ──────────────────────────────
  async function cargarProductos() {
    ST.productos = await TX.paginar(() => sb.from('productos')
      .select('id,nombre,sku,codigo_barras,precio,categoria,tipo,unidad_medida,stock_actual,activo,es_materia_prima')
      .eq('auth_user_id', TX.userId).eq('activo', true).order('nombre'));
    const cats = [...new Set(ST.productos.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    $('ep-categoria').innerHTML = '<option value="">Todas las categorías</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    pintarResultados();
  }
  function filtrados() {
    const q = quitarTildes($('ep-buscar').value.trim()), cat = $('ep-categoria').value, serv = $('ep-servicios').checked;
    return ST.productos.filter(p => {
      if (p.es_materia_prima) return false;
      if (!serv && p.tipo === 'servicio') return false;
      if (cat && p.categoria !== cat) return false;
      if (!q) return true;
      return quitarTildes(`${p.nombre} ${p.sku || ''} ${p.codigo_barras || ''}`).includes(q);
    });
  }
  function pintarResultados() {
    const l = filtrados(), MAXV = 60;
    const enLista = new Set(ST.lineas.filter(x => x.productoId).map(x => x.productoId));
    $('ep-resultados').innerHTML = l.length ? l.slice(0, MAXV).map(p => `
      <button type="button" class="ep-res${enLista.has(p.id) ? ' ya' : ''}" data-ep-add="${esc(p.id)}">
        <span class="ep-res-n">${esc(p.nombre)}<small>${esc([p.categoria, p.sku].filter(Boolean).join(' · ') || (p.tipo === 'servicio' ? 'Servicio' : 'Producto'))}</small></span>
        <b>${esc(fmtPrecio(p.precio))}</b><i>${enLista.has(p.id) ? '✓' : '＋'}</i>
      </button>`).join('') + (l.length > MAXV ? `<div class="ep-vacio">Y ${l.length - MAXV} más… escribe para buscar, o usa "Agregar todos los mostrados".</div>` : '')
      : `<div class="ep-vacio">${ST.productos.length ? 'Ningún producto coincide.' : 'Aún no tienes productos activos. Puedes crear etiquetas manuales.'}</div>`;
  }

  // ── Lista de etiquetas ────────────────────────────────────
  function lineaDeProducto(p) {
    return { key: ++seq, productoId: p.id, nombre: p.nombre, precio: r2(p.precio), antes: null, unidad: '', sku: p.sku || '', codigo: p.codigo_barras || p.sku || '',
      stock: Number(p.stock_actual) || 0, iva: ST.prefs.ivaDefecto, copias: 1 };
  }
  function agregarProducto(id) {
    const p = ST.productos.find(x => x.id === id); if (!p) return;
    if (ST.lineas.some(x => x.productoId === id)) { TX.toast('Ese producto ya está en la lista.', 'error'); return; }
    ST.lineas.push(lineaDeProducto(p));
    refrescar();
  }
  function agregarTodos() {
    const ya = new Set(ST.lineas.map(x => x.productoId));
    const nuevos = filtrados().filter(p => !ya.has(p.id));
    if (!nuevos.length) { TX.toast('No hay productos nuevos para agregar.', 'error'); return; }
    if (ST.lineas.length + nuevos.length > 500) { TX.toast('Máximo 500 productos por tanda. Filtra por categoría.', 'error'); return; }
    nuevos.forEach(p => ST.lineas.push(lineaDeProducto(p)));
    TX.toast(`${nuevos.length} producto(s) agregado(s).`);
    refrescar();
  }
  function agregarManual() {
    ST.lineas.push({ key: ++seq, productoId: null, nombre: '', precio: 0, antes: null, unidad: '', sku: '', codigo: '', stock: 0, iva: ST.prefs.ivaDefecto, copias: 1 });
    refrescar();
    const ins = document.querySelector(`[data-ep-campo="nombre"][data-ep-key="${seq}"]`); if (ins) ins.focus();
  }
  const totalEtiquetas = () => ST.lineas.reduce((s, l) => s + Math.max(0, Math.floor(Number(l.copias) || 0)), 0);

  function pintarLineas() {
    $('ep-lineas').innerHTML = ST.lineas.length ? ST.lineas.map(l => `
      <div class="ep-linea">
        <div class="ep-linea-top">
          <input class="tx-in" data-ep-key="${l.key}" data-ep-campo="nombre" value="${esc(l.nombre)}" maxlength="80" placeholder="Nombre del producto" aria-label="Nombre" />
          <button type="button" class="ep-x" data-ep-quitar="${l.key}" aria-label="Quitar">×</button>
        </div>
        <div class="ep-linea-campos">
          <label>Precio<input class="tx-in" type="number" inputmode="decimal" min="0" step="0.01" data-ep-key="${l.key}" data-ep-campo="precio" value="${esc(l.precio)}" /></label>
          <label>Antes (oferta)<input class="tx-in" type="number" inputmode="decimal" min="0" step="0.01" data-ep-key="${l.key}" data-ep-campo="antes" value="${l.antes == null ? '' : esc(l.antes)}" placeholder="—" /></label>
          <label>Unidad<input class="tx-in" data-ep-key="${l.key}" data-ep-campo="unidad" value="${esc(l.unidad)}" maxlength="14" placeholder="c/u, por lb…" /></label>
          <label>Copias<input class="tx-in" type="number" inputmode="numeric" min="0" max="500" step="1" data-ep-key="${l.key}" data-ep-campo="copias" value="${esc(l.copias)}" /></label>
        </div>
        <div class="ep-linea-pie">
          <button type="button" class="ep-iva ep-iva-${l.iva}" data-ep-iva="${l.key}" title="Toca para cambiar">${esc(IVA[l.iva] || 'Sin leyenda de IVA')}</button>
          <span class="ep-origen">${l.productoId ? 'De Productos' + (l.productoId && l.stock ? ` · stock ${esc(l.stock)}` : '') : 'Manual'}</span>
        </div>
      </div>`).join('')
      : '<div class="ep-vacio">Toca un producto de la lista para agregarlo, o crea una etiqueta manual.</div>';
  }
  function refrescar(soloInfo) {
    if (!soloInfo) { pintarLineas(); pintarResultados(); }
    const total = totalEtiquetas();
    $('ep-resumen').textContent = `${total} etiqueta${total === 1 ? '' : 's'}`;
    $('ep-pdf').disabled = $('ep-ver').disabled = !total;
    pintarInfo(); pintarMuestra();
  }

  // ── Formato ───────────────────────────────────────────────
  function tamActual() {
    if (ST.formato === 'rollo') return TAM_ROLLO[ST.prefs.tamRollo] || TAM_ROLLO['40x30'];
    if (ST.formato === 'ticket') return TAM_TICKET[ST.prefs.tamTicket] || TAM_TICKET['58x40'];
    return TAM_HOJA[ST.prefs.tamHoja] || TAM_HOJA['40x30'];
  }
  function pintarFormato() {
    ST.formato = ST.prefs.formato in { hoja: 1, rollo: 1, ticket: 1 } ? ST.prefs.formato : 'hoja';
    document.querySelectorAll('[data-ep-formato]').forEach(b => { b.classList.toggle('on', b.dataset.epFormato === ST.formato); b.setAttribute('aria-checked', String(b.dataset.epFormato === ST.formato)); });
    const lista = ST.formato === 'rollo' ? TAM_ROLLO : ST.formato === 'ticket' ? TAM_TICKET : TAM_HOJA;
    const actual = ST.formato === 'rollo' ? ST.prefs.tamRollo : ST.formato === 'ticket' ? ST.prefs.tamTicket : ST.prefs.tamHoja;
    $('ep-tamano').innerHTML = Object.entries(lista).map(([k, v]) => `<option value="${k}"${k === actual ? ' selected' : ''}>${esc(v.t)}</option>`).join('');
    const hoja = ST.formato === 'hoja';
    $('ep-w-papel').style.display = hoja && !TAM_HOJA[ST.prefs.tamHoja]?.fijo ? '' : 'none';
    $('ep-w-inicio').style.display = hoja ? '' : 'none';
    $('ep-w-corte').style.display = hoja ? '' : 'none';
    $('ep-papel').value = ST.prefs.papel;
    ['negocio', 'codigo', 'sku', 'fecha', 'corte'].forEach(c => { $('ep-f-' + c).checked = !!ST.prefs[c]; });
    refrescar(true);
  }
  // Distribución en hoja: columnas, filas y posición de cada etiqueta.
  function distribucion() {
    const t = TAM_HOJA[ST.prefs.tamHoja] || TAM_HOJA['40x30'];
    if (t.fijo) {
      const f = t.fijo, pg = PAPEL[f.papel];
      return { pagina: pg, t, cols: f.cols, rows: f.rows, x0: f.left, y0: f.top, gapX: f.gapX, gapY: f.gapY };
    }
    // Hoja para recortar: 4 mm de margen (lo que imprime casi cualquier impresora) y
    // etiquetas pegadas entre sí, compartiendo la línea de corte (más etiquetas por hoja).
    const pg = PAPEL[ST.prefs.papel] || PAPEL.carta, margen = 4, gap = 0;
    const cols = Math.max(1, Math.floor((pg.w - 2 * margen + gap) / (t.w + gap)));
    const rows = Math.max(1, Math.floor((pg.h - 2 * margen + gap) / (t.h + gap)));
    const anchoUsado = cols * t.w + (cols - 1) * gap, altoUsado = rows * t.h + (rows - 1) * gap;
    return { pagina: pg, t, cols, rows, x0: (pg.w - anchoUsado) / 2, y0: (pg.h - altoUsado) / 2, gapX: gap, gapY: gap };
  }
  function pintarInfo() {
    const total = totalEtiquetas();
    let txt;
    if (ST.formato === 'hoja') {
      const d = distribucion(), porHoja = d.cols * d.rows;
      const inicio = Math.min(porHoja, Math.max(1, parseInt($('ep-inicio').value, 10) || 1));
      const hojas = total ? Math.ceil((total + inicio - 1) / porHoja) : 0;
      txt = `<b>${porHoja} etiquetas por hoja</b> (${d.cols} columnas × ${d.rows} filas).` + (total ? ` Tus ${total} etiquetas ocupan <b>${hojas} hoja${hojas === 1 ? '' : 's'}</b>.` : '');
    } else {
      const t = tamActual();
      txt = `Una etiqueta de <b>${t.w} × ${t.h} mm</b> por página, seguidas en el rollo.` + (total ? ` Total: <b>${total}</b>.` : '');
    }
    if (total > MAX_ETIQUETAS) txt += ` <span class="ep-alerta">Máximo ${MAX_ETIQUETAS} etiquetas por PDF.</span>`;
    $('ep-info-txt').innerHTML = txt;
  }

  // ── Dibujo de una etiqueta (mm) ───────────────────────────
  const cacheBarras = {};
  function barras(codigo) {
    if (!codigo || typeof JsBarcode !== 'function') return null;
    if (cacheBarras[codigo] !== undefined) return cacheBarras[codigo];
    try {
      const c = document.createElement('canvas');
      JsBarcode(c, String(codigo), { format: 'CODE128', width: 2, height: 60, displayValue: false, margin: 0 });
      cacheBarras[codigo] = { url: c.toDataURL('image/png'), r: c.width / c.height };
    } catch (_) { cacheBarras[codigo] = null; }
    return cacheBarras[codigo];
  }
  function ajustarTexto(doc, texto, maxW, tamMax, tamMin) {
    let t = tamMax;
    doc.setFontSize(t);
    while (t > tamMin && doc.getTextWidth(texto) > maxW) { t -= 0.5; doc.setFontSize(t); }
    return t;
  }
  function dibujarEtiqueta(doc, l, x, y, w, h, opt) {
    const pad = Math.max(1.2, Math.min(w, h) * 0.06);
    const ix = x + pad, iw = w - 2 * pad;
    let top = y + pad, fondo = y + h - pad;
    const pt = mm => mm / 0.3528;                       // mm de alto -> puntos de fuente
    doc.setTextColor(20, 20, 20);
    // Pie: código de barras / SKU / fecha
    const bc = opt.codigo && l.codigo ? barras(l.codigo) : null;
    const pieTxt = [opt.sku && l.sku ? 'SKU ' + l.sku : '', opt.fecha ? opt.fechaTxt : ''].filter(Boolean).join('   ');
    if (pieTxt) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.max(5, Math.min(7, pt(h * 0.07))));
      doc.text(pieTxt, x + w / 2, fondo, { align: 'center', baseline: 'bottom' });
      fondo -= h * 0.09;
    }
    if (bc) {
      const bh = Math.min(h * 0.2, 9), bw = Math.min(iw, bh * bc.r * 1.6);
      doc.addImage(bc.url, 'PNG', x + (w - bw) / 2, fondo - bh, bw, bh);
      fondo -= bh + h * 0.03;
    }
    // Cabecera: negocio
    if (opt.negocio && opt.negocioTxt) {
      doc.setFont('helvetica', 'normal');
      const fs = ajustarTexto(doc, opt.negocioTxt, iw, Math.min(7, pt(h * 0.08)), 4.5);
      doc.text(opt.negocioTxt, x + w / 2, top, { align: 'center', baseline: 'top' });
      top += fs * 0.3528 + h * 0.03;
    }
    // Nombre (hasta 2 líneas)
    const espacio = fondo - top;
    doc.setFont('helvetica', 'bold');
    let fsN = Math.min(11, pt(espacio * 0.2), pt(h * 0.085)), lineas;   // tope por alto: todas parejas
    doc.setFontSize(fsN);
    lineas = doc.splitTextToSize(l.nombre || '', iw);
    while (fsN > 5 && lineas.length > 2) { fsN -= 0.5; doc.setFontSize(fsN); lineas = doc.splitTextToSize(l.nombre || '', iw); }
    if (lineas.length > 2) { lineas = lineas.slice(0, 2); lineas[1] = lineas[1].replace(/.{0,2}$/, '…'); }
    doc.text(lineas, x + w / 2, top, { align: 'center', baseline: 'top', lineHeightFactor: 1.1 });
    top += lineas.length * fsN * 0.3528 * 1.1 + espacio * 0.04;
    // Leyenda IVA y unidad (abajo del precio)
    const leyenda = [l.unidad, IVA[l.iva]].filter(Boolean).join(' · ');
    let fsL = 0;
    if (leyenda) { doc.setFont('helvetica', 'normal'); fsL = ajustarTexto(doc, leyenda, iw, Math.min(8, pt((fondo - top) * 0.17), pt(h * 0.06)), 4.5); }
    const altoLey = leyenda ? fsL * 0.3528 + 0.8 : 0;
    // Precio anterior tachado
    let zonaTop = top;
    if (l.antes != null && Number(l.antes) > Number(l.precio)) {
      doc.setFont('helvetica', 'normal');
      const tA = 'Antes ' + fmtPrecio(l.antes);
      const fsA = ajustarTexto(doc, tA, iw, Math.min(8, pt((fondo - top) * 0.16)), 4.5);
      doc.setTextColor(110, 110, 110);
      doc.text(tA, x + w / 2, zonaTop, { align: 'center', baseline: 'top' });
      const anchoA = doc.getTextWidth(tA), yA = zonaTop + fsA * 0.3528 * 0.45;
      doc.setDrawColor(110, 110, 110); doc.setLineWidth(0.2); doc.line(x + w / 2 - anchoA / 2, yA, x + w / 2 + anchoA / 2, yA);
      doc.setTextColor(20, 20, 20);
      zonaTop += fsA * 0.3528 + 0.6;
    }
    // Precio grande: ocupa lo que queda
    const altoPrecio = Math.max(2, fondo - zonaTop - altoLey);
    doc.setFont('helvetica', 'bold');
    const tP = fmtPrecio(l.precio);
    const fsP = ajustarTexto(doc, tP, iw, Math.min(pt(altoPrecio * 0.92), pt(h * 0.2)), 6);
    const yP = zonaTop + (altoPrecio - fsP * 0.3528) / 2;
    doc.text(tP, x + w / 2, yP, { align: 'center', baseline: 'top' });
    if (leyenda) { doc.setFont('helvetica', 'normal'); doc.setFontSize(fsL); doc.text(leyenda, x + w / 2, fondo - altoLey + 0.4, { align: 'center', baseline: 'top' }); }
  }

  function etiquetasExpandidas() {
    const out = [];
    for (const l of ST.lineas) for (let i = 0; i < Math.max(0, Math.floor(Number(l.copias) || 0)); i++) out.push(l);
    return out;
  }
  function opciones() {
    return { negocio: ST.prefs.negocio, codigo: ST.prefs.codigo, sku: ST.prefs.sku, fecha: ST.prefs.fecha,
      negocioTxt: TX.empresaConfig?.nombre_comercial || '', fechaTxt: new Date().toLocaleDateString('es-NI') };
  }
  function validar() {
    const sinNombre = ST.lineas.filter(l => Number(l.copias) > 0 && !String(l.nombre).trim());
    if (sinNombre.length) { TX.toast('Hay etiquetas sin nombre. Escríbelo o quítalas.', 'error'); return false; }
    const total = totalEtiquetas();
    if (!total) { TX.toast('Agrega al menos una etiqueta con 1 copia o más.', 'error'); return false; }
    if (total > MAX_ETIQUETAS) { TX.toast(`Máximo ${MAX_ETIQUETAS} etiquetas por PDF. Baja las copias o hazlo en dos tandas.`, 'error'); return false; }
    if (typeof window.jspdf?.jsPDF !== 'function') { TX.toast('No se pudo cargar el generador de PDF. Revisa tu conexión y recarga.', 'error'); return false; }
    return true;
  }
  function generarPDF() {
    const { jsPDF } = window.jspdf;
    const lista = etiquetasExpandidas(), opt = opciones();
    let doc;
    if (ST.formato === 'hoja') {
      const d = distribucion(), porHoja = d.cols * d.rows;
      doc = new jsPDF({ unit: 'mm', format: [d.pagina.w, d.pagina.h], orientation: 'portrait' });
      let pos = Math.min(porHoja, Math.max(1, parseInt($('ep-inicio').value, 10) || 1)) - 1, pagina = 0;
      for (const l of lista) {
        if (pos >= porHoja) { doc.addPage([d.pagina.w, d.pagina.h], 'portrait'); pos = 0; pagina++; }
        const c = pos % d.cols, f = Math.floor(pos / d.cols);
        const x = d.x0 + c * (d.t.w + d.gapX), y = d.y0 + f * (d.t.h + d.gapY);
        if (ST.prefs.corte && !d.t.fijo) { doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.15); doc.setLineDashPattern([1, 1], 0); doc.rect(x, y, d.t.w, d.t.h); doc.setLineDashPattern([], 0); }
        dibujarEtiqueta(doc, l, x, y, d.t.w, d.t.h, opt);
        pos++;
      }
    } else {
      const t = tamActual(), util = t.util || t.w;
      const orient = t.w > t.h ? 'landscape' : 'portrait';
      doc = new jsPDF({ unit: 'mm', format: [t.w, t.h], orientation: orient });
      lista.forEach((l, i) => {
        if (i > 0) doc.addPage([t.w, t.h], orient);
        dibujarEtiqueta(doc, l, (t.w - util) / 2, 0, util, t.h, opt);
      });
    }
    return doc;
  }
  const nombreArchivo = () => `etiquetas-precio_${new Date().toISOString().slice(0, 10)}.pdf`;
  function descargarPDF() {
    if (!validar()) return;
    try { generarPDF().save(nombreArchivo()); TX.toast('PDF listo para imprimir.'); }
    catch (e) { console.error('etiquetas PDF:', e); TX.toast('No se pudo generar el PDF: ' + (e.message || e), 'error'); }
  }
  function verPDF() {
    if (!validar()) return;
    const ventana = window.open('', '_blank');   // se abre en el clic para que el navegador no la bloquee
    try {
      const url = URL.createObjectURL(generarPDF().output('blob'));
      if (ventana) ventana.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { if (ventana) ventana.close(); TX.toast('No se pudo generar la vista: ' + (e.message || e), 'error'); }
  }

  // Muestra HTML de una etiqueta (misma información que el PDF)
  function pintarMuestra() {
    const l = ST.lineas.find(x => Number(x.copias) > 0 && String(x.nombre).trim()) || { nombre: 'Arroz Faisán 1 lb', precio: 32.5, antes: null, unidad: 'c/u', sku: 'ARZ-01', codigo: '7501234567890', iva: ST.prefs.ivaDefecto };
    const t = tamActual(), util = t.util || t.w, escala = Math.min(4.2, 230 / util, 170 / t.h);
    const opt = opciones(), ley = [l.unidad, IVA[l.iva]].filter(Boolean).join(' · ');
    $('ep-muestra').innerHTML = `<div class="ep-etq" style="width:${util * escala}px;height:${t.h * escala}px;font-size:${escala * 2.2}px">
      ${opt.negocio && opt.negocioTxt ? `<div class="ep-etq-neg">${esc(opt.negocioTxt)}</div>` : ''}
      <div class="ep-etq-nom">${esc(l.nombre)}</div>
      ${l.antes != null && Number(l.antes) > Number(l.precio) ? `<div class="ep-etq-antes">Antes ${esc(fmtPrecio(l.antes))}</div>` : ''}
      <div class="ep-etq-pre">${esc(fmtPrecio(l.precio))}</div>
      ${ley ? `<div class="ep-etq-ley">${esc(ley)}</div>` : ''}
      ${opt.codigo && l.codigo ? `<div class="ep-etq-bc">${barras(l.codigo) ? `<img src="${barras(l.codigo).url}" alt="" />` : ''}</div>` : ''}
      ${(opt.sku && l.sku) || opt.fecha ? `<div class="ep-etq-pie">${esc([opt.sku && l.sku ? 'SKU ' + l.sku : '', opt.fecha ? opt.fechaTxt : ''].filter(Boolean).join('   '))}</div>` : ''}
    </div>`;
  }

  // ── Eventos ───────────────────────────────────────────────
  function eventos() {
    let t = 0;
    $('ep-buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(pintarResultados, 150); });
    $('ep-categoria').addEventListener('change', pintarResultados);
    $('ep-servicios').addEventListener('change', pintarResultados);
    $('ep-agregar-todos').addEventListener('click', agregarTodos);
    $('ep-manual').addEventListener('click', agregarManual);
    $('ep-limpiar').addEventListener('click', async () => {
      if (!ST.lineas.length) return;
      if (await TX.confirmar('Quitar todas', '¿Quitar todas las etiquetas de la lista? Tus productos no cambian.', 'Quitar', true)) { ST.lineas = []; refrescar(); }
    });
    $('ep-copias-stock').addEventListener('click', () => {
      let n = 0; ST.lineas.forEach(l => { if (l.productoId) { l.copias = Math.max(0, Math.min(500, Math.floor(l.stock))); n++; } });
      if (!n) { TX.toast('Solo aplica a etiquetas que vienen de Productos.', 'error'); return; }
      refrescar(); TX.toast('Copias igualadas al stock de cada producto.');
    });
    $('ep-pdf').addEventListener('click', descargarPDF);
    $('ep-ver').addEventListener('click', verPDF);
    $('ep-tamano').addEventListener('change', e => {
      if (ST.formato === 'rollo') ST.prefs.tamRollo = e.target.value; else if (ST.formato === 'ticket') ST.prefs.tamTicket = e.target.value; else ST.prefs.tamHoja = e.target.value;
      guardarPrefs(); pintarFormato();
    });
    $('ep-papel').addEventListener('change', e => { ST.prefs.papel = e.target.value; guardarPrefs(); refrescar(true); });
    $('ep-inicio').addEventListener('input', () => refrescar(true));
    ['negocio', 'codigo', 'sku', 'fecha', 'corte'].forEach(c => $('ep-f-' + c).addEventListener('change', e => { ST.prefs[c] = e.target.checked; guardarPrefs(); refrescar(true); }));
    // Edición de líneas (sin redibujar la lista para no perder el foco)
    $('ep-lineas').addEventListener('input', e => {
      const el = e.target, key = Number(el.dataset.epKey), campo = el.dataset.epCampo;
      const l = ST.lineas.find(x => x.key === key); if (!l || !campo) return;
      if (campo === 'nombre' || campo === 'unidad') l[campo] = el.value;
      else if (campo === 'antes') l.antes = el.value === '' ? null : Math.max(0, r2(el.value));
      else if (campo === 'copias') l.copias = Math.max(0, Math.min(500, Math.floor(Number(el.value) || 0)));
      else if (campo === 'precio') l.precio = Math.max(0, r2(el.value));
      refrescar(true);
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-ep-add],[data-ep-quitar],[data-ep-iva],[data-ep-iva-todas],[data-ep-formato]'); if (!b) return;
      if (b.dataset.epAdd) agregarProducto(b.dataset.epAdd);
      else if (b.dataset.epQuitar) { ST.lineas = ST.lineas.filter(x => x.key !== Number(b.dataset.epQuitar)); refrescar(); }
      else if (b.dataset.epIva) {
        const l = ST.lineas.find(x => x.key === Number(b.dataset.epIva)); if (!l) return;
        l.iva = IVA_CICLO[(IVA_CICLO.indexOf(l.iva) + 1) % IVA_CICLO.length];
        b.className = `ep-iva ep-iva-${l.iva}`; b.textContent = IVA[l.iva] || 'Sin leyenda de IVA';
        refrescar(true);
      }
      else if (b.dataset.epIvaTodas) {
        ST.prefs.ivaDefecto = b.dataset.epIvaTodas; guardarPrefs();
        ST.lineas.forEach(l => { l.iva = b.dataset.epIvaTodas; });
        refrescar(); TX.toast(`IVA: "${IVA[b.dataset.epIvaTodas] || 'Sin leyenda'}" en todas las etiquetas.`);
      }
      else if (b.dataset.epFormato) { ST.prefs.formato = b.dataset.epFormato; guardarPrefs(); pintarFormato(); }
    });
  }

  window.EP = ST;
  document.addEventListener('DOMContentLoaded', () => {
    eventos(); pintarFormato(); refrescar();
    TX.init(async () => {
      try { await cargarProductos(); }
      catch (e) { console.error('cargarProductos:', e); $('ep-resultados').innerHTML = '<div class="ep-vacio">No se pudieron cargar tus productos. Puedes crear etiquetas manuales.</div>'; }
      refrescar();
    });
  });
})();
