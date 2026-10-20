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
    prefs: { formato: 'hoja', papel: 'carta', tamHoja: '40x30', tamRollo: '40x30', tamTicket: '58x40', ivaDefecto: 'incluido', estilo: 'super', color: null,
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
  // Un solo código de diseño con dos "pintores": jsPDF (el PDF que se
  // imprime) y Canvas (la vista previa). Así lo que se ve es lo que sale.
  const PT = 0.3528;                                   // 1 punto tipográfico = 0.3528 mm
  const cacheBarras = {}, cacheImg = {};
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
  function pintorPDF(doc) {
    const fuente = o => { doc.setFont(o.font === 'serif' ? 'times' : 'helvetica', o.bold && o.italic ? 'bolditalic' : o.bold ? 'bold' : o.italic ? 'italic' : 'normal'); doc.setFontSize(o.size); };
    return {
      rect(x, y, w, h, o = {}) {
        if (o.fill) doc.setFillColor(...o.fill);
        if (o.stroke) { doc.setDrawColor(...o.stroke); doc.setLineWidth(o.lw || 0.2); }
        if (o.dash) doc.setLineDashPattern(o.dash, 0);
        const st = o.fill && o.stroke ? 'FD' : o.fill ? 'F' : 'S';
        if (o.r) doc.roundedRect(x, y, w, h, o.r, o.r, st); else doc.rect(x, y, w, h, st);
        if (o.dash) doc.setLineDashPattern([], 0);
      },
      line(x1, y1, x2, y2, o = {}) { doc.setDrawColor(...(o.stroke || [0, 0, 0])); doc.setLineWidth(o.lw || 0.2); doc.line(x1, y1, x2, y2); },
      width(s, o) { fuente(o); return doc.getTextWidth(String(s)); },
      text(s, x, y, o) { fuente(o); doc.setTextColor(...(o.color || [20, 20, 20])); doc.text(String(s), x, y, { align: o.align || 'left', baseline: 'top' }); },
      image(url, x, y, w, h) { doc.addImage(url, 'PNG', x, y, w, h); },
    };
  }
  function pintorCanvas(ctx, k) {
    const css = c => `rgb(${(c || [20, 20, 20]).join(',')})`;
    const fam = o => `${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} ${o.size * PT * k}px ${o.font === 'serif' ? '"Times New Roman", Times, serif' : 'Helvetica, Arial, sans-serif'}`;
    const ruta = (x, y, w, h, r) => {
      ctx.beginPath();
      if (!r) { ctx.rect(x, y, w, h); return; }
      r = Math.min(r, w / 2, h / 2);
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    };
    return {
      rect(x, y, w, h, o = {}) {
        ctx.save(); ruta(x * k, y * k, w * k, h * k, (o.r || 0) * k);
        if (o.fill) { ctx.fillStyle = css(o.fill); ctx.fill(); }
        if (o.stroke) { ctx.strokeStyle = css(o.stroke); ctx.lineWidth = (o.lw || 0.2) * k; if (o.dash) ctx.setLineDash(o.dash.map(v => v * k)); ctx.stroke(); }
        ctx.restore();
      },
      line(x1, y1, x2, y2, o = {}) { ctx.save(); ctx.strokeStyle = css(o.stroke || [0, 0, 0]); ctx.lineWidth = (o.lw || 0.2) * k; ctx.beginPath(); ctx.moveTo(x1 * k, y1 * k); ctx.lineTo(x2 * k, y2 * k); ctx.stroke(); ctx.restore(); },
      width(s, o) { ctx.font = fam(o); return ctx.measureText(String(s)).width / k; },
      text(s, x, y, o) { ctx.font = fam(o); ctx.fillStyle = css(o.color); ctx.textBaseline = 'top'; ctx.textAlign = o.align || 'left'; ctx.fillText(String(s), x * k, y * k); },
      image(url, x, y, w, h) {
        let img = cacheImg[url];
        if (!img) { img = cacheImg[url] = new Image(); img.onload = () => programarMuestra(); img.src = url; }
        if (img.complete && img.naturalWidth) ctx.drawImage(img, x * k, y * k, w * k, h * k);
      },
    };
  }

  // Colores
  const hexARgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mezclar = (c, f) => c.map(v => Math.round(v + (255 - v) * f));               // aclarar hacia blanco
  const oscuro = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 150;
  const NEGRO = [22, 22, 26], GRIS = [110, 112, 120], GRIS_L = [200, 202, 208], BLANCO = [255, 255, 255], AMARILLO = [255, 214, 10];

  // Texto que cabe: baja el tamaño hasta que entra en el ancho
  function ajustar(P, s, maxW, o, min = 4.5) { const q = { ...o }; while (q.size > min && P.width(s, q) > maxW) q.size -= 0.25; return q; }
  // Nombre en hasta 2 líneas dentro de (w × maxH)
  function envolver(P, texto, maxW, o) {
    const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean), lineas = [];
    let actual = '';
    for (const pal of palabras) {
      const prueba = actual ? actual + ' ' + pal : pal;
      if (!actual || P.width(prueba, o) <= maxW) actual = prueba; else { lineas.push(actual); actual = pal; }
    }
    if (actual) lineas.push(actual);
    return lineas;
  }
  function bloqueNombre(P, texto, x, y, w, maxH, o0, align) {
    const o = { ...o0 };
    let lineas;
    for (;;) {
      lineas = envolver(P, texto, w, o);
      const alto = Math.min(lineas.length, 2) * o.size * PT * 1.12;
      if ((lineas.length <= 2 && alto <= maxH && lineas.every(l => P.width(l, o) <= w)) || o.size <= 5) break;
      o.size -= 0.25;
    }
    if (lineas.length > 2) { lineas = lineas.slice(0, 2); let u = lineas[1]; while (u.length > 1 && P.width(u + '…', o) > w) u = u.slice(0, -1); lineas[1] = u + '…'; }
    lineas = lineas.map(l => { let u = l; while (u.length > 1 && P.width(u, o) > w) u = u.slice(0, -1); return u; });
    const xx = align === 'left' ? x : x + w / 2;
    lineas.forEach((l, i) => P.text(l, xx, y + i * o.size * PT * 1.12, { ...o, align: align === 'left' ? 'left' : 'center' }));
    return lineas.length * o.size * PT * 1.12;
  }
  // Precio estilo góndola: símbolo y centavos pequeños arriba, entero grande
  function dibujarPrecio(P, n, x, y, w, maxH, o) {
    const s = Number(n || 0).toFixed(2), [ent, dec] = s.split('.');
    const partes = { sim: simbolo(), ent: Number(ent).toLocaleString('en-US'), dec };
    let size = maxH / (PT * 0.9);
    const medir = sz => {
      const chico = { size: sz * 0.42, bold: true, font: o.font }, grande = { size: sz, bold: true, font: o.font };
      const wS = P.width(partes.sim, chico), wE = P.width(partes.ent, grande), wD = P.width(partes.dec, chico), esp = sz * PT * 0.06;
      return { chico, grande, wS, wE, wD, esp, total: wS + esp + wE + esp + wD };
    };
    let m = medir(size);
    while (m.total > w && size > 6) { size -= 0.25; m = medir(size); }
    let cx = o.align === 'left' ? x : x + (w - m.total) / 2;
    const alto = size * PT * 0.9, sube = size * PT * 0.1;
    P.text(partes.sim, cx, y + sube, { ...m.chico, color: o.color }); cx += m.wS + m.esp;
    P.text(partes.ent, cx, y, { ...m.grande, color: o.color }); cx += m.wE + m.esp;
    P.text(partes.dec, cx, y + sube, { ...m.chico, color: o.color });
    if (o.subrayarCentavos) P.line(cx, y + sube + m.chico.size * PT * 0.95, cx + m.wD, y + sube + m.chico.size * PT * 0.95, { stroke: o.color, lw: Math.max(0.15, size * 0.006) });
    return { alto, ancho: m.total, x0: o.align === 'left' ? x : x + (w - m.total) / 2 };
  }
  // Precio anterior tachado
  function dibujarAntes(P, l, x, y, w, size, align, color) {
    const t = 'Antes ' + fmtPrecio(l.antes), o = ajustar(P, t, w, { size, font: 'sans', color: color || GRIS });
    const an = P.width(t, o), x0 = align === 'left' ? x : x + (w - an) / 2;
    P.text(t, x0, y, { ...o, align: 'left' });
    P.line(x0, y + o.size * PT * 0.48, x0 + an, y + o.size * PT * 0.48, { stroke: color || GRIS, lw: 0.2 });
    return o.size * PT * 1.05;
  }
  // Pie: código de barras y/o SKU · fecha. Devuelve el alto usado desde abajo.
  function dibujarPie(P, l, x, fondo, w, h, opt, color) {        // h = alto de referencia para tamaños
    let usado = 0;
    const pie = [opt.sku && l.sku ? 'SKU ' + l.sku : '', opt.fecha ? opt.fechaTxt : ''].filter(Boolean).join('   ·   ');
    if (pie) {
      const o = ajustar(P, pie, w, { size: Math.max(4.5, Math.min(6.5, h * 0.065 / PT)), color: color || GRIS });
      P.text(pie, x + w / 2, fondo - o.size * PT, { ...o, align: 'center' });
      usado += o.size * PT + h * 0.015;
    }
    const bc = opt.codigo && l.codigo ? barras(l.codigo) : null;
    if (bc) {
      const bh = Math.min(h * 0.17, 9), bw = Math.min(w * 0.92, bh * bc.r * 1.5);
      P.image(bc.url, x + (w - bw) / 2, fondo - usado - bh, bw, bh);
      usado += bh + h * 0.025;
    }
    return usado;
  }
  const hayAntes = l => l.antes != null && Number(l.antes) > Number(l.precio);
  const textoIva = l => IVA[l.iva] || '';

  // ── Los 5 diseños ─────────────────────────────────────────
  const ESTILOS = {
    super: { t: 'Supermercado', d: 'Franja de color, precio con centavos arriba' },
    oferta: { t: 'Oferta', d: 'Para promociones y descuentos' },
    moderno: { t: 'Moderno', d: 'Barra lateral de color' },
    elegante: { t: 'Elegante', d: 'Doble marco y letra con serifa' },
    clasico: { t: 'Clásico', d: 'Blanco y negro, ahorra tinta' },
  };
  function dibujarEtiqueta(P, l, x, y, w, h, opt) {
    const C = opt.color, base = Math.min(w, h), pad = Math.max(1.2, base * 0.06);
    const estilo = ESTILOS[opt.estilo] ? opt.estilo : 'super';
    const iva = textoIva(l), unidad = l.unidad || '';

    if (estilo === 'super' || estilo === 'oferta') {
      const m = base * 0.025, of = estilo === 'oferta';
      const txtBanda = oscuro(C) ? BLANCO : NEGRO;
      const hb = h * (of ? 0.18 : 0.16);
      P.rect(x + m, y + m, w - 2 * m, h - 2 * m, { stroke: of ? C : GRIS_L, lw: of ? 0.5 : 0.25, r: base * 0.05, fill: of ? mezclar(AMARILLO, 0.82) : null });
      P.rect(x + m, y + m, w - 2 * m, hb, { fill: C, r: base * 0.05 });
      P.rect(x + m, y + m + hb * 0.5, w - 2 * m, hb * 0.5, { fill: C });            // esquinas de abajo rectas
      const pct = hayAntes(l) ? Math.round(100 * (Number(l.antes) - Number(l.precio)) / Number(l.antes)) : 0;
      const titulo = of ? (hayAntes(l) ? `¡OFERTA!${pct >= 1 ? '  -' + pct + '%' : ''}` : 'PRECIO ESPECIAL') : (opt.negocio && opt.negocioTxt ? opt.negocioTxt.toUpperCase() : 'PRECIO');
      const ob = ajustar(P, titulo, w - 2 * pad, { size: hb * 0.64 / PT, bold: true, italic: of, color: txtBanda });
      P.text(titulo, x + w / 2, y + m + (hb - ob.size * PT * 0.8) / 2, { ...ob, align: 'center' });
      let top = y + m + hb + h * 0.03;
      let fondo = y + h - m - pad * 0.5;
      fondo -= dibujarPie(P, l, x + pad, fondo, w - 2 * pad, h * 0.8, opt);           // pie más compacto en este diseño
      // Fila inferior: IVA en pastilla (+ unidad)
      const hFila = h * 0.085;
      if (iva || unidad) {
        const filaY = fondo - hFila;
        if (iva) {
          const oi = ajustar(P, iva, (w - 2 * pad) * 0.6, { size: hFila * 0.66 / PT, bold: true, color: of ? NEGRO : C });
          const wi = P.width(iva, oi) + hFila * 0.9;
          const xi = unidad ? x + pad : x + (w - wi) / 2;
          P.rect(xi, filaY, wi, hFila, { stroke: of ? NEGRO : C, lw: 0.25, r: hFila / 2, fill: of ? BLANCO : mezclar(C, 0.9) });
          P.text(iva, xi + wi / 2, filaY + (hFila - oi.size * PT * 0.78) / 2, { ...oi, align: 'center' });
        }
        if (unidad) {
          const ou = ajustar(P, unidad, (w - 2 * pad) * (iva ? 0.36 : 1), { size: hFila * 0.64 / PT, bold: true, color: GRIS });
          P.text(unidad, iva ? x + w - pad : x + w / 2, filaY + (hFila - ou.size * PT * 0.78) / 2, { ...ou, align: iva ? 'right' : 'center' });
        }
        fondo = filaY - h * 0.04;      // aire para la coma y los descendentes del precio
      }
      // Presupuesto: el precio tiene garantizado su alto mínimo; el nombre usa lo que sobra
      const hAntes = hayAntes(l) ? Math.min(7.5, h * 0.055 / PT) * PT * 1.05 : 0;
      const precioMin = h * 0.22;
      const libreNombre = Math.max(h * 0.08, fondo - top - hAntes - precioMin);
      top += bloqueNombre(P, l.nombre, x + pad, top, w - 2 * pad, Math.min(libreNombre, h * 0.2), { size: Math.min(10.5, h * 0.08 / PT), bold: true, color: NEGRO }, 'center') + h * 0.012;
      if (hayAntes(l)) top += dibujarAntes(P, l, x + pad, top, w - 2 * pad, Math.min(7.5, h * 0.055 / PT), 'center');
      const altoP = Math.max(2, Math.min(fondo - top, h * 0.32));
      dibujarPrecio(P, l.precio, x + pad, top + (fondo - top - altoP) / 2, w - 2 * pad, altoP, { color: of ? C : NEGRO, align: 'center', subrayarCentavos: !of });
      return;
    }

    if (estilo === 'moderno') {
      const m = base * 0.025, barra = Math.max(1.2, w * 0.045);
      P.rect(x + m, y + m, w - 2 * m, h - 2 * m, { stroke: GRIS_L, lw: 0.25, r: base * 0.06 });
      P.rect(x + m, y + m, barra, h - 2 * m, { fill: C, r: base * 0.06 });
      P.rect(x + m + barra * 0.5, y + m, barra * 0.5, h - 2 * m, { fill: C });
      const ix = x + m + barra + pad * 0.8, iw = x + w - m - pad * 0.8 - ix;
      let top = y + m + pad * 0.7, fondo = y + h - m - pad * 0.6;
      fondo -= dibujarPie(P, l, ix, fondo, iw, h, opt);
      if (opt.negocio && opt.negocioTxt) {
        const on = ajustar(P, opt.negocioTxt.toUpperCase(), iw, { size: Math.min(6.5, h * 0.065 / PT), bold: true, color: C });
        P.text(opt.negocioTxt.toUpperCase(), ix, top, { ...on, align: 'left' }); top += on.size * PT * 1.25;
      }
      top += bloqueNombre(P, l.nombre, ix, top, iw, (fondo - top) * 0.38, { size: Math.min(11, h * 0.085 / PT), bold: true, color: NEGRO }, 'left') + h * 0.02;
      if (hayAntes(l)) top += dibujarAntes(P, l, ix, top, iw, Math.min(7.5, h * 0.06 / PT), 'left');
      const ley = [unidad, iva].filter(Boolean).join(' · ');
      let hLey = 0;
      if (ley) { const ol = ajustar(P, ley, iw, { size: Math.min(7, h * 0.065 / PT), color: GRIS }); hLey = ol.size * PT * 1.2; P.text(ley, ix, fondo - hLey, { ...ol, align: 'left' }); }
      const altoP = Math.max(2, Math.min(fondo - hLey - top - h * 0.02, h * 0.3));
      dibujarPrecio(P, l.precio, ix, top + (fondo - hLey - top - altoP) / 2, iw, altoP, { color: C, align: 'left' });
      return;
    }

    if (estilo === 'elegante') {
      const m = base * 0.03, m2 = m + base * 0.03;
      P.rect(x + m, y + m, w - 2 * m, h - 2 * m, { stroke: C, lw: 0.45 });
      P.rect(x + m2, y + m2, w - 2 * m2, h - 2 * m2, { stroke: C, lw: 0.15 });
      const ix = x + m2 + pad * 0.6, iw = w - 2 * (m2 + pad * 0.6);
      let top = y + m2 + pad * 0.6, fondo = y + h - m2 - pad * 0.5;
      fondo -= dibujarPie(P, l, ix, fondo, iw, h, opt);
      if (opt.negocio && opt.negocioTxt) {
        const t = opt.negocioTxt.toUpperCase(), on = ajustar(P, t, iw * 0.8, { size: Math.min(6.5, h * 0.06 / PT), font: 'serif', color: C });
        P.text(t, x + w / 2, top, { ...on, align: 'center' }); top += on.size * PT * 1.15;
        const an = Math.min(iw * 0.35, P.width(t, on));
        P.line(x + w / 2 - an / 2, top, x + w / 2 + an / 2, top, { stroke: C, lw: 0.15 }); top += h * 0.03;
      }
      top += bloqueNombre(P, l.nombre, ix, top, iw, (fondo - top) * 0.36, { size: Math.min(11.5, h * 0.09 / PT), bold: true, font: 'serif', color: NEGRO }, 'center') + h * 0.015;
      if (hayAntes(l)) top += dibujarAntes(P, l, ix, top, iw, Math.min(7.5, h * 0.06 / PT), 'center');
      const ley = [unidad, iva].filter(Boolean).join(' · ');
      let hLey = 0;
      if (ley) { const ol = ajustar(P, ley, iw, { size: Math.min(7, h * 0.065 / PT), italic: true, font: 'serif', color: GRIS }); hLey = ol.size * PT * 1.2; P.text(ley, x + w / 2, fondo - hLey, { ...ol, align: 'center' }); }
      const altoP = Math.max(2, Math.min(fondo - hLey - top - h * 0.015, h * 0.3));
      dibujarPrecio(P, l.precio, ix, top + (fondo - hLey - top - altoP) / 2, iw, altoP, { color: NEGRO, align: 'center', font: 'serif' });
      return;
    }

    // Clásico (blanco y negro)
    const ix = x + pad, iw = w - 2 * pad;
    let top = y + pad, fondo = y + h - pad;
    fondo -= dibujarPie(P, l, ix, fondo, iw, h, opt, NEGRO);
    if (opt.negocio && opt.negocioTxt) {
      const on = ajustar(P, opt.negocioTxt, iw, { size: Math.min(7, h * 0.07 / PT), color: NEGRO });
      P.text(opt.negocioTxt, x + w / 2, top, { ...on, align: 'center' }); top += on.size * PT * 1.2;
    }
    top += bloqueNombre(P, l.nombre, ix, top, iw, (fondo - top) * 0.36, { size: Math.min(11, h * 0.085 / PT), bold: true, color: NEGRO }, 'center') + h * 0.015;
    if (hayAntes(l)) top += dibujarAntes(P, l, ix, top, iw, Math.min(7.5, h * 0.06 / PT), 'center', NEGRO);
    const ley = [unidad, iva].filter(Boolean).join(' · ');
    let hLey = 0;
    if (ley) { const ol = ajustar(P, ley, iw, { size: Math.min(7, h * 0.065 / PT), color: NEGRO }); hLey = ol.size * PT * 1.2; P.text(ley, x + w / 2, fondo - hLey, { ...ol, align: 'center' }); }
    const altoP = Math.max(2, Math.min(fondo - hLey - top - h * 0.015, h * 0.3));
    P.line(x + w / 2 - iw * 0.3, top - h * 0.005, x + w / 2 + iw * 0.3, top - h * 0.005, { stroke: GRIS_L, lw: 0.15 });
    dibujarPrecio(P, l.precio, ix, top + (fondo - hLey - top - altoP) / 2, iw, altoP, { color: NEGRO, align: 'center' });
  }

  function etiquetasExpandidas() {
    const out = [];
    for (const l of ST.lineas) for (let i = 0; i < Math.max(0, Math.floor(Number(l.copias) || 0)); i++) out.push(l);
    return out;
  }
  function opciones() {
    return { negocio: ST.prefs.negocio, codigo: ST.prefs.codigo, sku: ST.prefs.sku, fecha: ST.prefs.fecha, estilo: ST.prefs.estilo,
      color: ST.prefs.estilo === 'clasico' ? NEGRO : colorActual(),
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
    let doc, P;
    if (ST.formato === 'hoja') {
      const d = distribucion(), porHoja = d.cols * d.rows;
      doc = new jsPDF({ unit: 'mm', format: [d.pagina.w, d.pagina.h], orientation: 'portrait' });
      P = pintorPDF(doc);
      let pos = Math.min(porHoja, Math.max(1, parseInt($('ep-inicio').value, 10) || 1)) - 1, pagina = 0;
      for (const l of lista) {
        if (pos >= porHoja) { doc.addPage([d.pagina.w, d.pagina.h], 'portrait'); pos = 0; pagina++; }
        const c = pos % d.cols, f = Math.floor(pos / d.cols);
        const x = d.x0 + c * (d.t.w + d.gapX), y = d.y0 + f * (d.t.h + d.gapY);
        if (ST.prefs.corte && !d.t.fijo) P.rect(x, y, d.t.w, d.t.h, { stroke: [195, 195, 195], lw: 0.12, dash: [1, 1] });
        dibujarEtiqueta(P, l, x, y, d.t.w, d.t.h, opt);
        pos++;
      }
    } else {
      const t = tamActual(), util = t.util || t.w;
      const orient = t.w > t.h ? 'landscape' : 'portrait';
      doc = new jsPDF({ unit: 'mm', format: [t.w, t.h], orientation: orient });
      P = pintorPDF(doc);
      lista.forEach((l, i) => {
        if (i > 0) doc.addPage([t.w, t.h], orient);
        dibujarEtiqueta(P, l, (t.w - util) / 2, 0, util, t.h, opt);
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

  // Vista previa: el MISMO dibujo del PDF, pintado en un canvas
  const MUESTRA = { nombre: 'Arroz Faisán 1 lb', precio: 32.5, antes: 40, unidad: 'c/u', sku: 'ARZ-01', codigo: '7501234567890', iva: 'incluido' };
  function pintarEnCanvas(canvas, l, wmm, hmm, opt, maxPx) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const escala = Math.min(maxPx.w / wmm, maxPx.h / hmm);
    canvas.style.width = Math.round(wmm * escala) + 'px'; canvas.style.height = Math.round(hmm * escala) + 'px';
    canvas.width = Math.round(wmm * escala * dpr); canvas.height = Math.round(hmm * escala * dpr);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    dibujarEtiqueta(pintorCanvas(ctx, escala * dpr), l, 0, 0, wmm, hmm, opt);
  }
  let rafMuestra = 0;
  function programarMuestra() { cancelAnimationFrame(rafMuestra); rafMuestra = requestAnimationFrame(pintarMuestra); }
  function pintarMuestra() {
    const real = ST.lineas.find(x => Number(x.copias) > 0 && String(x.nombre).trim());
    const l = real || { ...MUESTRA, iva: ST.prefs.ivaDefecto };
    const t = tamActual(), util = t.util || t.w;
    let c = $('ep-muestra-c');
    if (!c) { $('ep-muestra').innerHTML = '<canvas id="ep-muestra-c" class="ep-muestra-c" aria-label="Vista previa de la etiqueta"></canvas>'; c = $('ep-muestra-c'); }
    pintarEnCanvas(c, l, util, t.h, opciones(), { w: Math.min(320, ($('ep-muestra').clientWidth || 300) - 4), h: 230 });
    // miniaturas de los diseños
    document.querySelectorAll('[data-ep-estilo] canvas').forEach(cv => {
      const opt = { ...opciones(), estilo: cv.dataset.est, color: cv.dataset.est === 'clasico' ? NEGRO : colorActual() };
      pintarEnCanvas(cv, l, 40, 30, opt, { w: 132, h: 99 });
    });
  }

  // Diseño y color
  const PALETA = [['#d62828', 'Rojo'], ['#1d4ed8', 'Azul'], ['#15803d', 'Verde'], ['#ea580c', 'Naranja'], ['#7c3aed', 'Morado'], ['#111827', 'Negro']];
  function colorActual() {
    const c = hexARgb(ST.prefs.color) || hexARgb(TX.empresaConfig?.color_principal) || [214, 40, 40];
    return c;
  }
  function pintarDiseno() {
    $('ep-estilos').innerHTML = Object.entries(ESTILOS).map(([k, v]) => `
      <button type="button" class="ep-estilo${ST.prefs.estilo === k ? ' on' : ''}" data-ep-estilo="${k}" role="radio" aria-checked="${ST.prefs.estilo === k}">
        <canvas data-est="${k}" aria-hidden="true"></canvas><b>${esc(v.t)}</b><span>${esc(v.d)}</span>
      </button>`).join('');
    const negocio = TX.empresaConfig?.color_principal && hexARgb(TX.empresaConfig.color_principal) ? TX.empresaConfig.color_principal : null;
    const actual = (ST.prefs.color || negocio || '#d62828').toLowerCase();
    $('ep-colores').innerHTML = '<span>Color:</span>' +
      (negocio ? `<button type="button" class="ep-color${!ST.prefs.color ? ' on' : ''}" data-ep-color="" style="--c:${esc(negocio)}" title="Color de tu negocio" aria-label="Color de tu negocio"><i></i><small>Mi negocio</small></button>` : '') +
      PALETA.map(([hex, n]) => `<button type="button" class="ep-color${ST.prefs.color && ST.prefs.color.toLowerCase() === hex ? ' on' : ''}" data-ep-color="${hex}" style="--c:${hex}" title="${n}" aria-label="${n}"><i></i></button>`).join('') +
      `<label class="ep-color ep-color-libre" title="Otro color"><input type="color" id="ep-color-libre" value="${esc(actual)}" aria-label="Otro color" /></label>`;
    const sinColor = ST.prefs.estilo === 'clasico';
    $('ep-colores').classList.toggle('ep-desactivado', sinColor);
    programarMuestra();
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
    document.addEventListener('input', e => { if (e.target.id === 'ep-color-libre') { ST.prefs.color = e.target.value; guardarPrefs(); programarMuestra(); } });
    document.addEventListener('change', e => { if (e.target.id === 'ep-color-libre') pintarDiseno(); });
    window.addEventListener('resize', programarMuestra);
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
      const b = e.target.closest('[data-ep-add],[data-ep-quitar],[data-ep-iva],[data-ep-iva-todas],[data-ep-formato],[data-ep-estilo],[data-ep-color]'); if (!b) return;
      if (b.dataset.epEstilo) { ST.prefs.estilo = b.dataset.epEstilo; guardarPrefs(); pintarDiseno(); return; }
      if (b.dataset.epColor !== undefined) { ST.prefs.color = b.dataset.epColor || null; guardarPrefs(); pintarDiseno(); return; }
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
      pintarDiseno();
      try { await cargarProductos(); }
      catch (e) { console.error('cargarProductos:', e); $('ep-resultados').innerHTML = '<div class="ep-vacio">No se pudieron cargar tus productos. Puedes crear etiquetas manuales.</div>'; }
      refrescar();
    });
  });
})();
