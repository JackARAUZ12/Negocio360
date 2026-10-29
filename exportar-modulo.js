/* =====================================================
   EXPORTAR-MODULO.JS — Negocio360
   Motor común de exportación profesional (Excel + PDF), con el mismo estilo
   que "Exportar cartera" de Créditos:
     · Ventana con filtros (período, estados, cliente/proveedor/…) y resumen en vivo.
     · Excel: hoja "Resumen" + hojas de detalle con filtros de Excel, encabezado fijo,
       subtotales por grupo y fila TOTAL con SUBTOTAL(109) (se ajusta al filtrar en Excel).
     · PDF: encabezado con logo, tarjetas de totales, tablas con subtotales y total general.
   Solo LEE datos del propio negocio (auth_user_id): no modifica ventas, caja, créditos,
   inventario ni contabilidad. Lee sin límite de filas (de 1,000 en 1,000).
   Cada módulo define su "configuración" (qué leer, qué filtros, qué hojas) en su propio
   archivo exportar-<modulo>.js y llama a N360Exp.abrir(cfg, ctx).
   ctx = { sb, userId, empresaConfig }
===================================================== */
(function () {
  'use strict';

  var PAGINA = 1000;
  var LOTE = 80;
  var ST = null; // estado de la ventana abierta

  /* ---------------- utilidades ---------------- */
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function r2(x) { return Math.round(num(x) * 100) / 100; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lotes(arr, n) { var o = []; for (var i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }
  function miles(n) { return num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hoyISO() { return ymd(new Date()); }
  function fechaCorta(iso) { var s = String(iso || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''; return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4); }
  function sumarDias(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function diasEntre(desdeISO, hastaISO) { return Math.round((new Date(hastaISO + 'T12:00:00') - new Date(desdeISO + 'T12:00:00')) / 86400000); }
  function ahoraTexto() { var d = new Date(); return fechaCorta(hoyISO()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fechaExcel(iso) { var s = String(iso || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; return new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12)); }
  function limpiarHoja(s) { return String(s).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31); }
  function nombreCompleto(c) { return c ? ((c.nombre || '') + ' ' + (c.apellido || '')).trim() : ''; }
  function aviso(msg, tipo) { try { if (typeof showToast === 'function') showToast(msg, tipo || 'success'); else if (typeof window.showToast === 'function') window.showToast(msg, tipo || 'success'); } catch (e) {} }

  // Período -> { desde, hasta } (ISO) o null para "todo"
  function rangoPeriodo(clave, desdeP, hastaP) {
    var hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth(), h = ymd(hoy);
    if (clave === 'hoy') return { desde: h, hasta: h };
    if (clave === '7d') return { desde: sumarDias(h, -6), hasta: h };
    if (clave === '30d') return { desde: sumarDias(h, -29), hasta: h };
    if (clave === 'mes') return { desde: ymd(new Date(y, m, 1)), hasta: h };
    if (clave === 'mesant') return { desde: ymd(new Date(y, m - 1, 1)), hasta: ymd(new Date(y, m, 0)) };
    if (clave === 'trimestre') { var q = Math.floor(m / 3) * 3; return { desde: ymd(new Date(y, q, 1)), hasta: h }; }
    if (clave === 'anio') return { desde: ymd(new Date(y, 0, 1)), hasta: h };
    if (clave === 'anioant') return { desde: ymd(new Date(y - 1, 0, 1)), hasta: ymd(new Date(y - 1, 11, 31)) };
    if (clave === 'todo') return null;
    var d1 = /^\d{4}-\d{2}-\d{2}$/.test(desdeP || '') ? desdeP : ymd(new Date(y, m, 1));
    var d2 = /^\d{4}-\d{2}-\d{2}$/.test(hastaP || '') ? hastaP : h;
    return d1 <= d2 ? { desde: d1, hasta: d2 } : { desde: d2, hasta: d1 };
  }
  var PERIODOS = [['hoy', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'], ['trimestre', 'Este trimestre'], ['anio', 'Este año'], ['anioant', 'Año anterior'], ['custom', 'Rango de fechas'], ['todo', 'Todo el historial']];
  function textoPeriodo(op) {
    if (!op.periodo || !op.desde) return 'Todo el historial';
    return fechaCorta(op.desde) === fechaCorta(op.hasta) ? fechaCorta(op.desde) : fechaCorta(op.desde) + ' al ' + fechaCorta(op.hasta);
  }

  // Ayudantes que reciben las configuraciones de cada módulo
  function crearAyudantes(ctx) {
    var E = {
      num: num, r2: r2, esc: esc, lotes: lotes, miles: miles, ymd: ymd, hoyISO: hoyISO, fechaCorta: fechaCorta,
      sumarDias: sumarDias, diasEntre: diasEntre, nombreCompleto: nombreCompleto, rangoPeriodo: rangoPeriodo,
      // Convierte a la moneda de visualización (igual que las pantallas)
      cv: function (x) {
        try {
          if (typeof convertirParaMostrar === 'function') return num(convertirParaMostrar(num(x), ctx.empresaConfig && ctx.empresaConfig.moneda));
        } catch (e) {}
        return num(x);
      },
      simbolo: function () {
        try { return (typeof monedaParaMostrar === 'function') ? monedaParaMostrar(ctx.empresaConfig && ctx.empresaConfig.moneda) : 'NIO'; } catch (e) { return 'NIO'; }
      },
      dinero: function (n) { return E.simbolo() + ' ' + miles(n); },
      nombreNegocio: function () {
        var c = ctx.empresaConfig || {};
        return c.nombre_comercial || c.nombre_negocio || 'Mi negocio';
      },
      // Lee TODAS las filas (de 1,000 en 1,000, con orden estable por id y reintentos)
      leerTodo: async function (construir, etiqueta) {
        var filas = [];
        for (var desde = 0; desde < 5000000; desde += PAGINA) {
          var pagina = null, ultimo = null;
          for (var intento = 0; intento < 3; intento++) {
            if (intento) await new Promise(function (r) { setTimeout(r, intento * 700); });
            try {
              var x = await construir().order('id', { ascending: true }).range(desde, desde + PAGINA - 1);
              if (!x.error) { pagina = x.data || []; ultimo = null; break; }
              ultimo = x.error;
            } catch (e) { ultimo = e; }
          }
          if (pagina === null) throw (ultimo || new Error('No se pudo leer ' + (etiqueta || 'los datos')));
          for (var i = 0; i < pagina.length; i++) filas.push(pagina[i]);
          if (pagina.length < PAGINA) break;
        }
        return filas;
      },
      // Para listas largas de ids (.in)
      leerPorIds: async function (ids, construir, etiqueta) {
        var out = [];
        var partes = lotes(ids, LOTE);
        for (var i = 0; i < partes.length; i++) {
          var f = await E.leerTodo(function () { return construir(partes[i]); }, etiqueta);
          for (var k = 0; k < f.length; k++) out.push(f[k]);
        }
        return out;
      },
    };
    return E;
  }

  /* ---------------- marca: color y logo ---------------- */
  async function colorMarca(ctx) {
    try {
      var r = await ctx.sb.from('configuracion_proforma').select('color_principal').eq('auth_user_id', ctx.userId).maybeSingle();
      if (r && r.data && /^#?[0-9a-f]{6}$/i.test(r.data.color_principal || '')) return r.data.color_principal;
    } catch (e) {}
    return '#1b3a8a';
  }
  function hexARgb(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return [27, 58, 138]; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  async function cargarLogo(ctx) {
    try {
      var r = await ctx.sb.from('configuracion_empresa').select('logo_principal_url').eq('auth_user_id', ctx.userId).maybeSingle();
      var url = r && r.data && r.data.logo_principal_url;
      if (!url) return null;
      var resp = await fetch(url); var blob = await resp.blob();
      var dataUrl = await new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.readAsDataURL(blob); });
      var img = new Image();
      await new Promise(function (ok) { img.onload = ok; img.onerror = ok; img.src = dataUrl; });
      return { dataUrl: dataUrl, formato: blob.type.indexOf('png') >= 0 ? 'PNG' : 'JPEG', w: img.naturalWidth || 200, h: img.naturalHeight || 200 };
    } catch (e) { return null; }
  }

  /* ---------------- EXCEL ---------------- */
  function cargarScript(src) {
    return new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { mal(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function asegurarExcelJS() {
    if (window.ExcelJS) return;
    await cargarScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
    if (!window.ExcelJS) throw new Error('ExcelJS no disponible');
  }

  // Ordena las filas por grupo y calcula los subtotales de cada grupo (para PDF y Excel).
  function prepararTabla(t) {
    var cols = t.columnas, filas = (t.filas || []).slice();
    var salida = [];
    if (t.agrupar) {
      var clave = t.agrupar.k;
      var orden = [], mapa = {};
      filas.forEach(function (f) { var g = f[clave]; if (!mapa[g]) { mapa[g] = []; orden.push(g); } mapa[g].push(f); });
      orden.forEach(function (g) {
        mapa[g].forEach(function (f) { salida.push({ tipo: 'dato', f: f }); });
        var sub = {};
        (t.sumar || []).forEach(function (k) { sub[k] = mapa[g].reduce(function (s, f) { return s + num(f[k]); }, 0); });
        salida.push({ tipo: 'sub', g: g, n: mapa[g].length, f: sub });
      });
    } else {
      filas.forEach(function (f) { salida.push({ tipo: 'dato', f: f }); });
    }
    var tot = {};
    (t.sumar || []).forEach(function (k) { tot[k] = filas.reduce(function (s, f) { return s + num(f[k]); }, 0); });
    return { items: salida, tot: tot, n: filas.length };
  }

  async function construirExcel(res, cfg, ctx, op) {
    await asegurarExcelJS();
    var E = ST && ST.E || crearAyudantes(ctx);
    var color = (await colorMarca(ctx)).replace('#', '').toUpperCase();
    var rgb = hexARgb(color), luz = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    var textoEnc = luz > 150 ? 'FF141420' : 'FFFFFFFF';
    var wb = new window.ExcelJS.Workbook();
    wb.creator = 'Negocio360'; wb.created = new Date();
    var sym = E.simbolo();
    var FMT_DIN = '"' + sym + '" #,##0.00;[Red]-"' + sym + '" #,##0.00';
    var FMT_FEC = 'dd/mm/yyyy';
    var borde = { style: 'thin', color: { argb: 'FFDDDDE6' } };
    var bordes = { top: borde, left: borde, bottom: borde, right: borde };
    var filtrosTxt = cfg.textoFiltros ? cfg.textoFiltros(op) : '';

    function fmtNum(c) { if (c.pctj) return '0.0%'; return c.din ? FMT_DIN : (c.dec ? '#,##0.00' : (c.cant ? '#,##0.###' : '#,##0')); }
    function encabezadoHoja(ws, titulo, ancho) {
      ancho = Math.max(ancho, 4);
      ws.mergeCells(1, 1, 1, ancho); ws.getCell(1, 1).value = E.nombreNegocio();
      ws.getCell(1, 1).font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF' + color } };
      ws.mergeCells(2, 1, 2, ancho); ws.getCell(2, 1).value = titulo;
      ws.getCell(2, 1).font = { name: 'Arial', size: 12, bold: true };
      ws.mergeCells(3, 1, 3, ancho); ws.getCell(3, 1).value = 'Generado: ' + ahoraTexto() + (filtrosTxt ? '   ·   ' + filtrosTxt : '');
      ws.getCell(3, 1).font = { name: 'Arial', size: 9, color: { argb: 'FF666677' } };
      ws.getRow(1).height = 22;
    }
    // Dibuja una tabla desde la fila "fila"; devuelve la siguiente fila libre.
    function tabla(ws, fila, t, soloUna) {
      var cols = t.columnas;
      if (t.subtitulo) {
        var c0 = ws.getCell(fila, 1); c0.value = t.subtitulo; c0.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF' + color } };
        fila++;
      }
      var enc = ws.getRow(fila);
      cols.forEach(function (c, i) {
        var cel = enc.getCell(i + 1); cel.value = c.t;
        cel.font = { name: 'Arial', size: 10, bold: true, color: { argb: textoEnc } };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
        cel.alignment = { vertical: 'middle', horizontal: (c.num || c.fecha) ? 'right' : 'left', wrapText: true };
        cel.border = bordes;
        if (!ws.getColumn(i + 1).width || ws.getColumn(i + 1).width < c.w) ws.getColumn(i + 1).width = c.w;
      });
      enc.height = 26;
      var p = prepararTabla(t);
      var filaEnc = fila, r = fila + 1, ini = r, rangoGrupo = null;
      p.items.forEach(function (it, k) {
        var row = ws.getRow(r);
        if (it.tipo === 'dato') {
          if (rangoGrupo === null) rangoGrupo = r;
          cols.forEach(function (c, i) {
            var v = it.f[c.k]; var cel = row.getCell(i + 1);
            cel.value = c.fecha ? fechaExcel(v) : (v === '' || v === undefined || v === null ? null : v);
            var rojo = c.rojo && it.f[c.rojo];
            cel.font = { name: 'Arial', size: 10, color: { argb: rojo ? 'FFC0392B' : 'FF1A1A2E' }, bold: !!rojo };
            cel.border = bordes;
            if (c.num) { cel.numFmt = fmtNum(c); cel.alignment = { horizontal: 'right' }; }
            else if (c.fecha) { cel.numFmt = FMT_FEC; cel.alignment = { horizontal: 'right' }; }
            else cel.alignment = { vertical: 'top', wrapText: !!c.wrap };
            if (k % 2 === 1) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6FA' } };
          });
        } else {
          var gIni = rangoGrupo, gFin = r - 1, puesto = false;
          cols.forEach(function (c, i) {
            var cel = row.getCell(i + 1);
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E6F3' } };
            cel.border = { top: borde, bottom: borde, left: borde, right: borde };
            cel.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1A1A2E' } };
            if ((t.sumar || []).indexOf(c.k) >= 0 && gIni !== null) {
              var col = ws.getColumn(i + 1).letter;
              cel.value = { formula: 'SUBTOTAL(109,' + col + gIni + ':' + col + gFin + ')', result: c.num && !c.cant && !c.entero ? r2(it.f[c.k]) : it.f[c.k] };
              cel.numFmt = fmtNum(c); cel.alignment = { horizontal: 'right' };
            } else if (!puesto) {
              cel.value = (t.agrupar.etiqueta || 'Subtotal') + ' — ' + it.g + ' (' + it.n + ')'; puesto = true;
            }
          });
          rangoGrupo = null;
        }
        r++;
      });
      var fin = r - 1;
      // Fila TOTAL con SUBTOTAL(109): se ajusta al filtrar en Excel y no cuenta dos veces los subtotales
      var tot = ws.getRow(r), etiq = false;
      cols.forEach(function (c, i) {
        var cel = tot.getCell(i + 1);
        cel.border = { top: { style: 'medium', color: { argb: 'FF' + color } }, bottom: borde, left: borde, right: borde };
        cel.font = { name: 'Arial', size: 10, bold: true };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEEF5' } };
        if ((t.sumar || []).indexOf(c.k) >= 0 && p.items.length) {
          var col = ws.getColumn(i + 1).letter;
          cel.value = { formula: 'SUBTOTAL(109,' + col + ini + ':' + col + fin + ')', result: c.dec || c.din ? r2(p.tot[c.k]) : p.tot[c.k] };
          cel.numFmt = fmtNum(c); cel.alignment = { horizontal: 'right' };
        } else if (!etiq) { cel.value = t.etiquetaTotal || 'TOTAL'; etiq = true; }
      });
      if (soloUna && p.items.length && !t.agrupar) ws.autoFilter = { from: { row: filaEnc, column: 1 }, to: { row: fin, column: cols.length } };
      if (soloUna) ws.views = [{ state: 'frozen', ySplit: filaEnc, xSplit: 0 }];
      if (t.nota) { var rn = ws.getRow(r + 1); rn.getCell(1).value = t.nota; rn.getCell(1).font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF777788' } }; r++; }
      return r + 2;
    }

    // Hoja "Resumen": indicadores + tablas de resumen + notas
    var ws0 = wb.addWorksheet('Resumen');
    var anchoRes = 4;
    (res.resumenTablas || []).forEach(function (t) { anchoRes = Math.max(anchoRes, t.columnas.length); });
    encabezadoHoja(ws0, cfg.titulo, anchoRes);
    var f0 = 5;
    var kp = ws0.getRow(f0);
    ['Indicador', 'Valor'].forEach(function (h, i) {
      var cel = kp.getCell(i + 1); cel.value = h;
      cel.font = { name: 'Arial', size: 10, bold: true, color: { argb: textoEnc } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } }; cel.border = bordes;
      cel.alignment = { horizontal: i ? 'right' : 'left' };
    });
    var fk = f0 + 1;
    (res.kpis || []).forEach(function (k) {
      var a = ws0.getCell(fk, 1), b = ws0.getCell(fk, 2);
      a.value = k.t; b.value = k.num !== undefined ? k.num : k.v;
      a.font = { name: 'Arial', size: 10, bold: !!k.fuerte }; b.font = { name: 'Arial', size: 10, bold: !!k.fuerte, color: { argb: k.rojo ? 'FFC0392B' : 'FF1A1A2E' } };
      a.border = bordes; b.border = bordes; b.alignment = { horizontal: 'right' };
      if (k.num !== undefined) b.numFmt = k.din ? FMT_DIN : (k.dec ? '#,##0.00' : '#,##0');
      fk++;
    });
    ws0.getColumn(1).width = Math.max(ws0.getColumn(1).width || 0, 34);
    ws0.getColumn(2).width = Math.max(ws0.getColumn(2).width || 0, 20);
    var fila = fk + 2;
    (res.resumenTablas || []).forEach(function (t) { fila = tabla(ws0, fila, t, false); });
    (res.notas || []).forEach(function (n) {
      var cel = ws0.getCell(fila, 1); cel.value = n; cel.font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF777788' } }; fila++;
    });
    ws0.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

    // Hojas de detalle
    (res.hojas || []).forEach(function (h) {
      var ws = wb.addWorksheet(limpiarHoja(h.nombre));
      var ancho = 4; h.tablas.forEach(function (t) { ancho = Math.max(ancho, t.columnas.length); });
      encabezadoHoja(ws, h.titulo || h.nombre, ancho);
      var f = 5;
      h.tablas.forEach(function (t) { f = tabla(ws, f, t, h.tablas.length === 1); });
      ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    });
    var buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------------- PDF ---------------- */
  async function construirPDF(res, cfg, ctx, op) {
    if (!window.jspdf) throw new Error('jsPDF no disponible');
    var E = ST && ST.E || crearAyudantes(ctx);
    var jsPDF = window.jspdf.jsPDF;
    var horizontal = (cfg.pdfOrientacion || 'portrait') === 'landscape';
    var doc = new jsPDF({ orientation: horizontal ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    // La tipografía base del PDF no trae algunos símbolos (− ↔): se cambian por equivalentes.
    function san(t) { if (Array.isArray(t)) return t.map(san); return typeof t === 'string' ? t.replace(/\u2212/g, '-').replace(/\u2194/g, '<->') : t; }
    var _texto = doc.text.bind(doc);
    doc.text = function (t) { var a = Array.prototype.slice.call(arguments); a[0] = san(t); return _texto.apply(null, a); };
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
    var rgb = hexARgb(await colorMarca(ctx));
    var luz = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    var txtEnc = luz > 150 ? [20, 20, 30] : [255, 255, 255];
    var sym = E.simbolo();
    function din(n) { return sym + ' ' + miles(n); }

    doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(0, 0, W, 28, 'F');
    var tx = M;
    try {
      var logo = await cargarLogo(ctx);
      if (logo) {
        var esc2 = Math.min(30 / logo.w, 18 / logo.h, 1) || 1, lw = logo.w * esc2, lh = logo.h * esc2;
        doc.addImage(logo.dataUrl, logo.formato, M, (28 - lh) / 2, lw, lh); tx = M + lw + 5;
      }
    } catch (e) {}
    doc.setTextColor(txtEnc[0], txtEnc[1], txtEnc[2]);
    doc.setFont(undefined, 'bold'); doc.setFontSize(15);
    doc.text(doc.splitTextToSize(E.nombreNegocio(), W - tx - 60)[0], tx, 13);
    doc.setFont(undefined, 'normal'); doc.setFontSize(10.5);
    doc.text(cfg.titulo, tx, 21);
    doc.setFontSize(8.5); doc.text('Generado: ' + ahoraTexto(), W - M, 12, { align: 'right' });
    if (cfg.pdfCabeceraDerecha) doc.text(String(cfg.pdfCabeceraDerecha(op) || ''), W - M, 18, { align: 'right' });

    var y = 35;
    doc.setTextColor(100, 100, 120); doc.setFontSize(8.5);
    var ft = (cfg.textoFiltros ? cfg.textoFiltros(op) : '') + (cfg.textoFiltros ? '  ·  ' : '') + 'Importes en ' + sym;
    if (ft) { var lineas = doc.splitTextToSize(ft, W - M * 2); doc.text(lineas, M, y); y += lineas.length * 4 + 3; }

    // tarjetas de totales (hasta 4 por fila)
    var kp = (res.kpis || []).filter(function (k) { return k.tarjeta !== false; }).slice(0, 8);
    var porFila = 4, aw = (W - M * 2 - 3 * (porFila - 1)) / porFila;
    kp.forEach(function (c, i) {
      var col = i % porFila, fil = Math.floor(i / porFila);
      var x = M + col * (aw + 3), yy = y + fil * 19;
      var rojo = !!c.rojo;
      doc.setDrawColor(222, 222, 232); doc.setFillColor(rojo ? 253 : 247, rojo ? 236 : 247, rojo ? 234 : 251);
      doc.roundedRect(x, yy, aw, 16, 2, 2, 'FD');
      doc.setTextColor(110, 110, 130); doc.setFontSize(7.5); doc.setFont(undefined, 'normal'); doc.text(doc.splitTextToSize(c.t, aw - 5)[0], x + 3, yy + 5.5);
      doc.setTextColor(rojo ? 192 : 20, rojo ? 57 : 20, rojo ? 43 : 30);
      doc.setFontSize(10.5); doc.setFont(undefined, 'bold'); doc.text(doc.splitTextToSize(String(c.v), aw - 5)[0], x + 3, yy + 12.5);
    });
    if (kp.length) y += Math.ceil(kp.length / porFila) * 19 + 3;

    // Fila de subtotal/total: la etiqueta ocupa (colSpan) todas las columnas anteriores a la primera suma
    function filaEtiquetada(cols, t, etiqueta, valor) {
      var sumar = t.sumar || [], primera = -1;
      for (var i = 0; i < cols.length; i++) { if (sumar.indexOf(cols[i].k) >= 0) { primera = i; break; } }
      if (primera <= 0) { var fila0 = []; cols.forEach(function (c, i) { fila0.push(sumar.indexOf(c.k) >= 0 ? valor(c) : (i === 0 ? etiqueta : '')); }); return fila0; }
      var fila = [{ content: etiqueta, colSpan: primera }];
      for (var j = primera; j < cols.length; j++) fila.push(sumar.indexOf(cols[j].k) >= 0 ? valor(cols[j]) : '');
      return fila;
    }
    var secciones = (res.resumenTablas || []).filter(function (t) { return t.pdf !== false; })
      .concat((res.hojas || []).reduce(function (a, h) { return a.concat(h.tablas.filter(function (t) { return t.pdf !== false && h.pdf !== false; })); }, []));
    secciones.forEach(function (t) {
      var cols = t.columnas.filter(function (c) { return c.p !== false; });
      var p = prepararTabla({ columnas: t.columnas, filas: t.filas, sumar: t.sumar, agrupar: t.agrupar });
      if (y > H - 45) { doc.addPage(); y = 16; }
      doc.setTextColor(20, 20, 30); doc.setFont(undefined, 'bold'); doc.setFontSize(11);
      doc.text(t.subtitulo || t.tituloPdf || '', M, y); if (t.subtitulo || t.tituloPdf) y += 3;
      function celda(c, v, esTotal) {
        if (v === null || v === undefined || v === '') return '';
        if (c.fecha) return fechaCorta(v);
        if (c.pctj) return (num(v) * 100).toFixed(1) + '%';
        if (c.num) return c.din ? miles(v) : (c.dec ? miles(v) : (c.cant ? String(Math.round(num(v) * 1000) / 1000) : String(Math.round(num(v)))));
        return String(v);
      }
      var body = [], marcas = [];
      p.items.forEach(function (it) {
        if (it.tipo === 'dato') { body.push(cols.map(function (c) { return celda(c, it.f[c.k]); })); marcas.push({ rojo: cols.map(function (c) { return !!(c.rojo && it.f[c.rojo]); }) }); }
        else {
          body.push(filaEtiquetada(cols, t, (t.agrupar.etiqueta || 'Subtotal') + ' — ' + it.g + ' (' + it.n + ')', function (c) { return celda(c, it.f[c.k]); }));
          marcas.push({ sub: true });
        }
      });
      var foot = [filaEtiquetada(cols, t, t.etiquetaTotal || 'TOTAL', function (c) { return celda(c, p.tot[c.k]); })];
      var estilosCol = {};
      cols.forEach(function (c, i) { if (c.num || c.fecha) estilosCol[i] = { halign: 'right' }; });
      doc.autoTable({
        startY: y, margin: { left: M, right: M, bottom: 16 },
        head: [cols.map(function (c) { return c.t; })], body: body, foot: foot,
        showFoot: 'lastPage', showHead: 'everyPage', theme: 'striped',
        headStyles: { fillColor: rgb, textColor: txtEnc, fontSize: 8 },
        footStyles: { fillColor: [237, 238, 245], textColor: [20, 20, 30], fontStyle: 'bold', fontSize: 8.5 },
        styles: { fontSize: 8, cellPadding: 1.8, valign: 'middle', overflow: 'linebreak' },
        columnStyles: estilosCol,
        didParseCell: function (h) {
          var idx = h.column.index;
          if (h.cell && h.cell.text) h.cell.text = san(h.cell.text);
          if ((h.section === 'head' || h.section === 'foot') && (cols[idx].num || cols[idx].fecha)) h.cell.styles.halign = 'right';
          if (h.section === 'body') {
            var mk = marcas[h.row.index] || {};
            if (mk.sub) { h.cell.styles.fillColor = [227, 230, 243]; h.cell.styles.fontStyle = 'bold'; }
            else if (mk.rojo && mk.rojo[idx]) { h.cell.styles.textColor = [192, 57, 43]; h.cell.styles.fontStyle = 'bold'; }
          }
        },
      });
      y = doc.lastAutoTable.finalY + 8;
    });

    // total general destacado
    var tg = res.totalGeneral || [];
    if (tg.length) {
      if (y > H - 20 - tg.length * 6) { doc.addPage(); y = 16; }
      var bh = 6 + tg.length * 6;
      doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.6); doc.setFillColor(247, 247, 251);
      doc.roundedRect(W - M - 95, y, 95, bh, 2, 2, 'FD'); doc.setLineWidth(0.2);
      tg.forEach(function (r, i) {
        var yy = y + 6.5 + i * 6, ultimo = i === tg.length - 1;
        doc.setTextColor(ultimo ? 20 : 90, ultimo ? 20 : 90, ultimo ? 30 : 110);
        doc.setFont(undefined, ultimo ? 'bold' : 'normal'); doc.setFontSize(ultimo ? 10.5 : 9);
        doc.text(r[0], W - M - 91, yy); doc.text(String(r[1]), W - M - 4, yy, { align: 'right' });
      });
      y += bh + 6;
    }
    (res.notas || []).forEach(function (n) {
      if (y > H - 18) { doc.addPage(); y = 16; }
      doc.setFont(undefined, 'italic'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 140);
      var ls = doc.splitTextToSize(n, W - M * 2); doc.text(ls, M, y); y += ls.length * 3.6 + 1;
    });
    var n = doc.getNumberOfPages();
    for (var pg = 1; pg <= n; pg++) {
      doc.setPage(pg); doc.setFont(undefined, 'normal'); doc.setFontSize(7.5); doc.setTextColor(150, 150, 170);
      doc.text(cfg.titulo + ' · ' + E.nombreNegocio() + ' · generado por Negocio360', M, H - 7);
      doc.text('Página ' + pg + ' de ' + n, W - M, H - 7, { align: 'right' });
    }
    return doc;
  }

  /* ---------------- ventana de opciones ---------------- */
  function entidadesSeleccionadas() { return Object.keys(ST.sel).filter(function (k) { return ST.sel[k]; }); }

  function opcionesActuales() {
    var op = { entidades: entidadesSeleccionadas() };
    var rg = rangoPeriodo(ST.valores.periodo, ST.valores.desde, ST.valores.hasta);
    op.periodo = ST.valores.periodo; op.desde = rg ? rg.desde : null; op.hasta = rg ? rg.hasta : null;
    (ST.cfg.filtros || []).forEach(function (f) { if (f.tipo !== 'periodo') op[f.k] = ST.valores[f.k]; });
    return op;
  }

  function pintarModal() {
    var m = document.getElementById('n360-exp-modulo'); if (!m || !ST) return;
    var cfg = ST.cfg, E = ST.E, op = opcionesActuales();
    var listaEl = m.querySelector('#nx-lista'), resEl = m.querySelector('#nx-resumen'), nsel = m.querySelector('#nx-nsel');
    if (!ST.datos) { if (listaEl) listaEl.innerHTML = '<div style="padding:14px;font-size:13px;color:var(--text-muted,#777)">Cargando…</div>'; return; }
    if (cfg.entidad) {
      var q = ST.busqueda.trim().toLowerCase();
      var ents = cfg.entidad.lista(ST.datos, op, E) || [];
      if (q) ents = ents.filter(function (c) { return String(c.nombre).toLowerCase().indexOf(q) >= 0; });
      listaEl.innerHTML = ents.length ? ents.map(function (c) {
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border,#e8e8ef);cursor:pointer;font-size:13px">' +
          '<input type="checkbox" data-ent="' + esc(c.id) + '" ' + (ST.sel[c.id] ? 'checked' : '') + '/>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.nombre) + '</span>' +
          '<span style="color:var(--text-muted,#777);font-size:12px;white-space:nowrap">' + esc(c.extra || '') + '</span></label>';
      }).join('') : '<div style="padding:14px;color:var(--text-muted,#777);font-size:13px">' + esc(cfg.entidad.vacio || 'No hay resultados.') + '</div>';
      var sel = entidadesSeleccionadas();
      nsel.textContent = sel.length ? sel.length + ' seleccionado' + (sel.length === 1 ? '' : 's') : 'Todos';
    }
    resEl.innerHTML = cfg.vista ? cfg.vista(ST.datos, op, E) : '';
  }

  async function recargarDatos() {
    if (!ST) return;
    var miId = ++ST.cargaId;
    ST.datos = null; ST.cargando = true; pintarModal();
    var m = document.getElementById('n360-exp-modulo');
    try {
      var op = opcionesActuales();
      var datos = await ST.cfg.cargar(ST.ctx, op, ST.E);
      if (!ST || miId !== ST.cargaId) return;
      ST.datos = datos; mostrarError(m, '');
    } catch (e) {
      console.error('exportar (cargar):', e);
      if (ST && miId === ST.cargaId) mostrarError(m, 'No se pudieron cargar los datos: ' + (e && e.message ? e.message : 'error'));
    } finally { if (ST && miId === ST.cargaId) { ST.cargando = false; llenarSelects(); pintarModal(); } }
  }

  function radioHtml(nombre, v, t, marcado) {
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="radio" name="' + nombre + '" value="' + esc(v) + '" ' + (marcado ? 'checked' : '') + '/>' + esc(t) + '</label>';
  }
  var ESTILO_INPUT = 'padding:8px 10px;border:1px solid var(--border,#e8e8ef);border-radius:8px;font-size:13px;background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14)';

  function construirModal() {
    var d = document.getElementById('n360-exp-modulo'); if (d) d.remove();
    var cfg = ST.cfg;
    d = document.createElement('div'); d.id = 'n360-exp-modulo';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:12px';
    var bloques = '';
    (cfg.filtros || []).forEach(function (f) {
      if (f.tipo === 'periodo') {
        bloques += '<div><div style="font-weight:600;font-size:13px;margin-bottom:6px">' + esc(f.etiqueta || 'Período') + '</div>' +
          '<select id="nx-periodo" style="width:100%;' + ESTILO_INPUT + '">' +
          PERIODOS.filter(function (p) { return p[0] !== 'todo' || f.permiteTodo; }).map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === ST.valores.periodo ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') +
          '</select>' +
          '<div id="nx-rango" style="display:' + (ST.valores.periodo === 'custom' ? 'flex' : 'none') + ';gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">' +
            '<input type="date" id="nx-desde" value="' + esc(ST.valores.desde) + '" style="flex:1;min-width:130px;' + ESTILO_INPUT + '"/> <span style="font-size:12px">a</span>' +
            '<input type="date" id="nx-hasta" value="' + esc(ST.valores.hasta) + '" style="flex:1;min-width:130px;' + ESTILO_INPUT + '"/></div></div>';
      } else if (f.tipo === 'radio') {
        bloques += '<div><div style="font-weight:600;font-size:13px;margin-bottom:6px">' + esc(f.etiqueta) + '</div><div style="display:flex;gap:14px;flex-wrap:wrap">' +
          f.opciones.map(function (o) { return radioHtml('nx-' + f.k, o[0], o[1], o[0] === ST.valores[f.k]); }).join('') + '</div></div>';
      } else if (f.tipo === 'select') {
        bloques += '<div><div style="font-weight:600;font-size:13px;margin-bottom:6px">' + esc(f.etiqueta) + '</div><select id="nx-sel-' + f.k + '" data-k="' + f.k + '" style="width:100%;' + ESTILO_INPUT + '"></select></div>';
      }
    });
    if (cfg.entidad) {
      bloques += '<div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><span style="font-weight:600;font-size:13px">' + esc(cfg.entidad.etiqueta) + '</span>' +
        '<span style="font-size:12px;color:var(--text-muted,#777)"><span id="nx-nsel"></span> · <a href="#" id="nx-todos" style="color:var(--accent,#5a5af4)">Quitar selección</a></span></div>' +
        '<input type="search" id="nx-buscar" placeholder="Buscar…" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:6px;' + ESTILO_INPUT + '"/>' +
        '<div id="nx-lista" style="max-height:200px;overflow-y:auto;border:1px solid var(--border,#e8e8ef);border-radius:8px"></div></div>';
    }
    d.innerHTML =
      '<div style="background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);border-radius:14px;width:100%;max-width:580px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border,#e8e8ef)">' +
        '<span style="font-weight:700;font-size:15px">📥 ' + esc(cfg.titulo) + '</span>' +
        '<button type="button" id="nx-x" style="background:none;border:none;font-size:18px;cursor:pointer;color:inherit">✕</button></div>' +
      '<div style="padding:14px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:14px">' +
        '<div style="font-size:12.5px;color:var(--text-muted,#777)">' + esc(cfg.ayuda || 'Elige qué incluir. Solo lee la información: no cambia nada.') + '</div>' +
        bloques +
        '<div id="nx-resumen" style="padding:10px 12px;background:var(--bg-app,var(--bg-surface-2,#f5f5fa));border-radius:8px;font-size:13px;line-height:1.5"></div>' +
        '<div id="nx-error" style="color:var(--danger,#c0392b);font-size:12.5px;display:none"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--border,#e8e8ef)">' +
        '<button type="button" class="btn-secondary" id="nx-cancelar" style="flex:1;min-width:90px">Cancelar</button>' +
        '<button type="button" class="btn-primary" id="nx-excel" style="flex:1;min-width:120px">📊 Excel</button>' +
        '<button type="button" class="btn-primary" id="nx-pdf" style="flex:1;min-width:120px">📄 PDF</button></div></div>';
    document.body.appendChild(d);
    var cerrar = function () { d.remove(); ST = null; };
    d.querySelector('#nx-x').onclick = cerrar; d.querySelector('#nx-cancelar').onclick = cerrar;
    d.addEventListener('mousedown', function (e) { if (e.target === d) cerrar(); });
    (cfg.filtros || []).forEach(function (f) {
      if (f.tipo === 'periodo') {
        var sel = d.querySelector('#nx-periodo'), rg = d.querySelector('#nx-rango');
        sel.onchange = function () { ST.valores.periodo = sel.value; rg.style.display = sel.value === 'custom' ? 'flex' : 'none'; if (sel.value !== 'custom') recargarDatos(); else recargarDatos(); };
        d.querySelector('#nx-desde').onchange = function (e) { ST.valores.desde = e.target.value; recargarDatos(); };
        d.querySelector('#nx-hasta').onchange = function (e) { ST.valores.hasta = e.target.value; recargarDatos(); };
      } else if (f.tipo === 'radio') {
        d.querySelectorAll('input[name="nx-' + f.k + '"]').forEach(function (r) { r.onchange = function () { ST.valores[f.k] = r.value; if (f.recarga) recargarDatos(); else pintarModal(); }; });
      } else if (f.tipo === 'select') {
        d.querySelector('#nx-sel-' + f.k).onchange = function (e) { ST.valores[f.k] = e.target.value; pintarModal(); };
      }
    });
    if (cfg.entidad) {
      d.querySelector('#nx-buscar').oninput = function (e) { ST.busqueda = e.target.value; pintarModal(); };
      d.querySelector('#nx-todos').onclick = function (e) { e.preventDefault(); ST.sel = {}; pintarModal(); };
      d.querySelector('#nx-lista').addEventListener('change', function (e) { var id = e.target && e.target.getAttribute('data-ent'); if (id !== null && id !== undefined) { ST.sel[id] = e.target.checked; pintarModal(); } });
    }
    d.querySelector('#nx-excel').onclick = function () { exportar('excel'); };
    d.querySelector('#nx-pdf').onclick = function () { exportar('pdf'); };
    return d;
  }

  function llenarSelects() {
    if (!ST || !ST.datos) return;
    var m = document.getElementById('n360-exp-modulo'); if (!m) return;
    (ST.cfg.filtros || []).forEach(function (f) {
      if (f.tipo !== 'select') return;
      var el = m.querySelector('#nx-sel-' + f.k); if (!el) return;
      var ops = f.opciones(ST.datos, ST.E) || [];
      if (!ST.valores[f.k] || !ops.some(function (o) { return o[0] === ST.valores[f.k]; })) ST.valores[f.k] = ops.length ? ops[0][0] : '';
      el.innerHTML = ops.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === ST.valores[f.k] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
    });
  }

  function descargar(blob, nombre) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function mostrarError(m, txt) { var e = m && m.querySelector('#nx-error'); if (e) { e.textContent = txt; e.style.display = txt ? '' : 'none'; } }
  function nombreArchivo(cfg, ext) { return (cfg.archivo || 'Exportacion') + '_' + hoyISO() + '.' + ext; }

  async function exportar(formato) {
    var m = document.getElementById('n360-exp-modulo');
    if (!ST || ST.cargando || !ST.datos) { mostrarError(m, 'Espera a que termine de cargar.'); return; }
    var bE = m.querySelector('#nx-excel'), bP = m.querySelector('#nx-pdf');
    var original = [bE.textContent, bP.textContent];
    try {
      mostrarError(m, '');
      [bE, bP].forEach(function (b) { b.disabled = true; });
      (formato === 'excel' ? bE : bP).textContent = 'Preparando…';
      var op = opcionesActuales();
      var res = await ST.cfg.armar(ST.datos, op, ST.E, ST.ctx);
      if (!res || res.vacio) { mostrarError(m, (res && res.mensajeVacio) || 'No hay datos que cumplan esos filtros.'); return; }
      if (formato === 'excel') descargar(await construirExcel(res, ST.cfg, ST.ctx, op), nombreArchivo(ST.cfg, 'xlsx'));
      else (await construirPDF(res, ST.cfg, ST.ctx, op)).save(nombreArchivo(ST.cfg, 'pdf'));
      aviso((ST.cfg.titulo || 'Exportación') + ' lista' + (res.mensajeOk ? ': ' + res.mensajeOk : ''));
    } catch (e) {
      console.error('exportar:', e);
      mostrarError(m, 'No se pudo exportar: ' + (e && e.message ? e.message : 'error desconocido'));
    } finally {
      if (document.body.contains(bE)) { bE.disabled = false; bE.textContent = original[0]; bP.disabled = false; bP.textContent = original[1]; }
    }
  }

  async function abrir(cfg, ctx) {
    if (!ctx || !ctx.sb || !ctx.userId) { aviso('Espera a que cargue la página e inténtalo de nuevo', 'error'); return; }
    var E = crearAyudantes(ctx);
    ST = { cfg: cfg, ctx: ctx, E: E, datos: null, sel: {}, busqueda: '', valores: {}, cargaId: 0, cargando: false };
    var rg0 = null;
    (cfg.filtros || []).forEach(function (f) {
      if (f.tipo === 'periodo') { ST.valores.periodo = f.def || 'mes'; rg0 = rangoPeriodo(ST.valores.periodo); ST.valores.desde = rg0 ? rg0.desde : ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); ST.valores.hasta = rg0 ? rg0.hasta : hoyISO(); }
      else if (f.tipo === 'radio') ST.valores[f.k] = f.def !== undefined ? f.def : f.opciones[0][0];
      else if (f.tipo === 'select') ST.valores[f.k] = f.def || '';
    });
    construirModal();
    await recargarDatos();
    llenarSelects(); pintarModal();
  }

  window.N360Exp = {
    abrir: abrir,
    // utilidades para pruebas y para las configuraciones
    _crearAyudantes: crearAyudantes, _construirExcel: construirExcel, _construirPDF: construirPDF, _prepararTabla: prepararTabla,
    _setEstado: function (s) { ST = s; },
  };
})();
