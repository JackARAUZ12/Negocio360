/* =====================================================
   EXPORTAR CARTERA DE CRÉDITOS (Excel + PDF)
   Todos los clientes con su saldo y sus créditos/cuotas pendientes.
   - Solo LEE (no modifica créditos, pagos, caja ni contabilidad).
   - Sin límite de fechas ni de cantidad: lee por partes de 1,000 filas.
   - Filtros: cliente(s), estado (todos / vencidos / al día) y tipo.
   - Excel (3 hojas, con filtros de Excel y totales que se ajustan al filtrar) y
     PDF vertical (resumen por cliente + detalle + totales).
===================================================== */
(function () {
  'use strict';

  var PAGINA = 1000;      // la base no entrega más de 1,000 filas por consulta
  var LOTE = 80;          // ids por consulta (.in) para no pasarse del largo de la URL
  var ST = { cargando: false, listo: false, creditos: [], clientes: {}, sel: {}, estado: 'todos', tipo: 'todos', busqueda: '' };

  function sb() { return window.__cajaSB; }
  function uid() { return window.CS && window.CS.userId; }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  // convierte a la moneda de visualización del negocio (igual que la pantalla de Créditos)
  function cv(x) {
    try { if (typeof convertirParaMostrar === 'function') return num(convertirParaMostrar(num(x), window.CS && window.CS.empresaConfig && window.CS.empresaConfig.moneda)); } catch (e) {}
    return num(x);
  }
  function r2(x) { return Math.round(num(x) * 100) / 100; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lotes(arr, n) { var o = []; for (var i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }
  function simbolo() {
    try { return (typeof monedaParaMostrar === 'function' && window.CS && window.CS.empresaConfig) ? monedaParaMostrar(window.CS.empresaConfig.moneda) : 'NIO'; } catch (e) { return 'NIO'; }
  }
  function miles(n) { return num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dinero(n) { return simbolo() + ' ' + miles(n); }
  function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(iso) { var s = String(iso || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''; return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4); }
  function diasEntre(desdeISO, hastaISO) { return Math.round((new Date(hastaISO + 'T12:00:00') - new Date(desdeISO + 'T12:00:00')) / 86400000); }
  function nombreNegocio() {
    var c = (window.CS && window.CS.empresaConfig) || {};
    return c.nombre_comercial || c.nombre_negocio || (window.CS && window.CS.currentUser && window.CS.currentUser.nombre_negocio) || 'Mi negocio';
  }
  function aviso(msg, tipo) { try { if (typeof showToast === 'function') showToast(msg, tipo || 'success'); else if (typeof window.showToast === 'function') window.showToast(msg, tipo || 'success'); } catch (e) {} }

  /* ---------------- lectura de datos (sin límites) ---------------- */
  async function leerCreditosPendientes() {
    var out = [];
    for (var d = 0; d < 10000000; d += PAGINA) {
      var r = await sb().from('creditos')
        .select('id,numero_credito,cliente_id,tipo,estado,modalidad_pago,fecha_inicio,created_at,total_financiado,saldo_pendiente')
        .eq('auth_user_id', uid()).gt('saldo_pendiente', 0.01).neq('estado', 'cancelado')
        .order('created_at', { ascending: false }).order('id').range(d, d + PAGINA - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data || []);
      if (!r.data || r.data.length < PAGINA) break;
    }
    return out;
  }
  async function leerClientes(ids) {
    var mapa = {};
    for (var ch of lotes(ids, LOTE)) {
      var r = await sb().from('clientes').select('id,nombre,apellido,telefono').in('id', ch);
      if (r.error) throw r.error;
      (r.data || []).forEach(function (c) { mapa[c.id] = c; });
    }
    return mapa;
  }
  async function leerCuotas(creditoIds) {
    var mapa = {};
    for (var ch of lotes(creditoIds, LOTE)) {
      for (var d = 0; d < 10000000; d += PAGINA) {
        var r = await sb().from('creditos_cuotas')
          .select('id,credito_id,numero,fecha_vencimiento,monto_total,monto_pagado,saldo,estado')
          .in('credito_id', ch).neq('estado', 'pagada')
          .order('credito_id').order('numero').range(d, d + PAGINA - 1);
        if (r.error) throw r.error;
        (r.data || []).forEach(function (q) { (mapa[q.credito_id] = mapa[q.credito_id] || []).push(q); });
        if (!r.data || r.data.length < PAGINA) break;
      }
    }
    return mapa;
  }
  async function leerProformas(creditos) {
    // Si el crédito nació de una proforma, se muestra ese número (igual que en la pantalla de Créditos)
    var m = {};
    try {
      if (!window.N360ProformaCredito) return m;
      for (var ch of lotes(creditos, LOTE)) {
        var mp = await window.N360ProformaCredito.mapa(sb(), uid(), ch);
        ch.forEach(function (c) { var p = mp.get(c.id); if (p) m[c.id] = p; });
      }
    } catch (e) { console.warn('exportar cartera: proformas', e); }
    return m;
  }
  function nombreCliente(c) { return c ? ((c.nombre || '') + ' ' + (c.apellido || '')).trim() || 'Sin nombre' : 'Sin cliente'; }

  /* ---------------- armado de la cartera ---------------- */
  // Devuelve clientes con sus créditos (y cuotas pendientes), más totales. Aplica los filtros elegidos.
  function armarCartera(creditos, cuotasPorCredito, proformas, opciones) {
    var hoy = hoyISO();
    var filas = [];
    creditos.forEach(function (c) {
      var cuotas = (cuotasPorCredito[c.id] || []).map(function (q) {
        // Siempre monto_total - monto_pagado: el campo cuotas.saldo está desactualizado en datos antiguos (queda en 0 aunque la cuota esté pendiente).
        var saldo = Math.max(0, num(q.monto_total) - num(q.monto_pagado));
        var venc = String(q.fecha_vencimiento || '').slice(0, 10);
        var vencida = venc && venc < hoy && saldo > 0.005;
        return {
          numero: q.numero, vence: venc, monto: r2(cv(q.monto_total)), pagado: r2(cv(q.monto_pagado)), saldo: r2(cv(saldo)),
          diasAtraso: vencida ? diasEntre(venc, hoy) : 0,
          estado: vencida ? 'Vencida' : (num(q.monto_pagado) > 0 ? 'Parcial' : 'Pendiente'),
        };
      }).filter(function (q) { return q.saldo > 0.005; });
      var vencidas = cuotas.filter(function (q) { return q.estado === 'Vencida'; });
      var sinCuotas = cuotas.length === 0;
      var vencidoMonto = sinCuotas ? (c.estado === 'con_atraso' ? r2(cv(c.saldo_pendiente)) : 0) : r2(vencidas.reduce(function (s, q) { return s + q.saldo; }, 0));
      var atraso = vencidas.length ? Math.max.apply(null, vencidas.map(function (q) { return q.diasAtraso; })) : 0;
      var vencido = vencidas.length > 0 || (sinCuotas && c.estado === 'con_atraso');
      var fechas = cuotas.map(function (q) { return q.vence; }).filter(Boolean).sort();
      var total = r2(cv(c.total_financiado)), saldo = r2(cv(c.saldo_pendiente));
      filas.push({
        id: c.id, clienteId: c.cliente_id || '', numero: c.numero_credito || '', proforma: proformas[c.id] || '',
        tipo: c.tipo === 'financiero' ? 'Financiero' : 'Venta a crédito',
        fecha: String(c.fecha_inicio || c.created_at || '').slice(0, 10),
        total: total, pagado: r2(Math.max(0, total - saldo)), saldo: saldo,
        proximo: fechas[0] || '', ultimo: fechas[fechas.length - 1] || '',
        cuotasPend: cuotas.length, cuotas: cuotas, vencidoMonto: vencidoMonto, atraso: atraso,
        vencido: vencido, estado: vencido ? 'Vencido' : (c.estado === 'en_proceso' ? 'En proceso' : 'Al día'),
        sinCuotas: sinCuotas,
      });
    });
    // filtros por estado / tipo / cliente
    filas = filas.filter(function (f) {
      if (opciones.estado === 'vencidos' && !f.vencido) return false;
      if (opciones.estado === 'aldia' && f.vencido) return false;
      if (opciones.tipo === 'venta' && f.tipo !== 'Venta a crédito') return false;
      if (opciones.tipo === 'financiero' && f.tipo !== 'Financiero') return false;
      if (opciones.clientes && opciones.clientes.length && opciones.clientes.indexOf(f.clienteId || '_sin') < 0) return false;
      return true;
    });
    var porCliente = {};
    filas.forEach(function (f) {
      var k = f.clienteId || '_sin';
      var cl = ST.clientes[f.clienteId];
      var g = porCliente[k] || (porCliente[k] = { id: k, nombre: nombreCliente(cl), telefono: (cl && cl.telefono) || '', creditos: [], total: 0, pagado: 0, saldo: 0, vencido: 0, atraso: 0, cuotas: 0 });
      g.creditos.push(f); g.total += f.total; g.pagado += f.pagado; g.saldo += f.saldo; g.vencido += f.vencidoMonto; g.cuotas += f.cuotasPend;
      g.atraso = Math.max(g.atraso, f.atraso);
    });
    var clientes = Object.keys(porCliente).map(function (k) {
      var g = porCliente[k];
      g.creditos.sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)) || String(a.numero).localeCompare(String(b.numero)); });
      ['total', 'pagado', 'saldo', 'vencido'].forEach(function (x) { g[x] = r2(g[x]); });
      var pr = g.creditos.map(function (c) { return c.proximo; }).filter(Boolean).sort();
      g.proximo = pr[0] || '';
      return g;
    });
    clientes.sort(function (a, b) { return b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, 'es'); });
    var tot = { clientes: clientes.length, creditos: filas.length, total: 0, pagado: 0, saldo: 0, vencido: 0, cuotas: 0 };
    clientes.forEach(function (g) { tot.total += g.total; tot.pagado += g.pagado; tot.saldo += g.saldo; tot.vencido += g.vencido; tot.cuotas += g.cuotas; });
    ['total', 'pagado', 'saldo', 'vencido'].forEach(function (x) { tot[x] = r2(tot[x]); });
    return { clientes: clientes, totales: tot, filas: filas };
  }

  function textoFiltros(op) {
    var p = [];
    p.push('Estado: ' + ({ todos: 'todos los créditos con saldo', vencidos: 'solo vencidos', aldia: 'solo al día' }[op.estado] || 'todos'));
    p.push('Tipo: ' + ({ todos: 'todos', venta: 'ventas a crédito', financiero: 'financieros' }[op.tipo] || 'todos'));
    p.push(op.clientes && op.clientes.length ? 'Clientes: ' + op.clientes.length + ' seleccionado' + (op.clientes.length === 1 ? '' : 's') : 'Clientes: todos');
    return p.join('  ·  ');
  }
  function ahoraTexto() {
    var d = new Date();
    return fechaCorta(hoyISO()) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function nombreArchivo(ext) { return 'Cartera_creditos_' + hoyISO() + '.' + ext; }

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
  function fechaExcel(iso) { var s = String(iso || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; return new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12)); }

  async function colorMarca() {
    try { if (window._cc_cargarConfigDocumentos) { var cfg = await window._cc_cargarConfigDocumentos(uid()); if (cfg && cfg.color_principal) return cfg.color_principal; } } catch (e) {}
    return '#1b3a8a';
  }
  function hexARgb(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return [27, 58, 138]; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  async function construirExcel(cart, op) {
    await asegurarExcelJS();
    var color = (await colorMarca()).replace('#', '').toUpperCase();
    var luz = (function () { var c = hexARgb(color); return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000; })();
    var textoEnc = luz > 150 ? 'FF141420' : 'FFFFFFFF';
    var wb = new window.ExcelJS.Workbook();
    wb.creator = 'Negocio360'; wb.created = new Date();
    var sym = simbolo();
    var FMT_DIN = '"' + sym + '" #,##0.00;[Red]-"' + sym + '" #,##0.00';
    var FMT_FEC = 'dd/mm/yyyy';
    var borde = { style: 'thin', color: { argb: 'FFDDDDE6' } };
    var bordes = { top: borde, left: borde, bottom: borde, right: borde };

    function encabezadoHoja(ws, titulo, anchoCols) {
      ws.mergeCells(1, 1, 1, anchoCols); ws.getCell(1, 1).value = nombreNegocio();
      ws.getCell(1, 1).font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF' + color } };
      ws.mergeCells(2, 1, 2, anchoCols); ws.getCell(2, 1).value = titulo;
      ws.getCell(2, 1).font = { name: 'Arial', size: 12, bold: true };
      ws.mergeCells(3, 1, 3, anchoCols); ws.getCell(3, 1).value = 'Generado: ' + ahoraTexto() + '   ·   ' + textoFiltros(op);
      ws.getCell(3, 1).font = { name: 'Arial', size: 9, color: { argb: 'FF666677' } };
      ws.getRow(1).height = 22;
    }
    // Crea una tabla con filtros, encabezado fijo y fila de totales con SUBTOTAL (se ajusta al filtrar en Excel)
    function tabla(ws, filaEnc, columnas, filas, sumar) {
      var enc = ws.getRow(filaEnc);
      columnas.forEach(function (c, i) {
        var cel = enc.getCell(i + 1); cel.value = c.t;
        cel.font = { name: 'Arial', size: 10, bold: true, color: { argb: textoEnc } };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
        cel.alignment = { vertical: 'middle', horizontal: c.num || c.fecha ? 'right' : 'left', wrapText: true };
        cel.border = bordes;
        ws.getColumn(i + 1).width = c.w;
      });
      enc.height = 26;
      filas.forEach(function (f, k) {
        var row = ws.getRow(filaEnc + 1 + k);
        columnas.forEach(function (c, i) {
          var v = f[c.k]; var cel = row.getCell(i + 1);
          cel.value = c.fecha ? fechaExcel(v) : (v === '' || v === undefined ? null : v);
          cel.font = { name: 'Arial', size: 10, color: { argb: (c.rojo && f[c.rojo]) ? 'FFC0392B' : 'FF1A1A2E' }, bold: !!(c.rojo && f[c.rojo]) };
          cel.border = bordes;
          if (c.num) { cel.numFmt = c.din ? FMT_DIN : (c.dec ? '#,##0.00' : '#,##0'); cel.alignment = { horizontal: 'right' }; }
          else if (c.fecha) { cel.numFmt = FMT_FEC; cel.alignment = { horizontal: 'right' }; }
          else cel.alignment = { vertical: 'top', wrapText: !!c.wrap };
          if (k % 2 === 1) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6FA' } };
        });
      });
      var ini = filaEnc + 1, fin = filaEnc + filas.length, filaTot = fin + 1;
      var tot = ws.getRow(filaTot);
      var etiquetaPuesta = false;
      columnas.forEach(function (c, i) {
        var cel = tot.getCell(i + 1);
        cel.border = { top: { style: 'medium', color: { argb: 'FF' + color } }, bottom: borde, left: borde, right: borde };
        cel.font = { name: 'Arial', size: 10, bold: true };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEEF5' } };
        if (sumar.indexOf(c.k) >= 0) {
          var col = ws.getColumn(i + 1).letter;
          var resultado = filas.reduce(function (s, f) { return s + num(f[c.k]); }, 0);
          cel.value = { formula: 'SUBTOTAL(109,' + col + ini + ':' + col + fin + ')', result: c.dec || c.din ? r2(resultado) : resultado };
          cel.numFmt = c.din ? FMT_DIN : (c.dec ? '#,##0.00' : '#,##0'); cel.alignment = { horizontal: 'right' };
        } else if (!etiquetaPuesta) { cel.value = 'TOTAL'; etiquetaPuesta = true; }
      });
      if (filas.length) ws.autoFilter = { from: { row: filaEnc, column: 1 }, to: { row: fin, column: columnas.length } };
      ws.views = [{ state: 'frozen', ySplit: filaEnc, xSplit: 0 }];
      return filaTot;
    }

    // Hoja 1: resumen por cliente
    var ws1 = wb.addWorksheet('Resumen por cliente');
    encabezadoHoja(ws1, 'Cartera de créditos pendientes — resumen por cliente', 8);
    tabla(ws1, 5, [
      { k: 'nombre', t: 'Cliente', w: 34 }, { k: 'telefono', t: 'Teléfono', w: 15 },
      { k: 'creditos', t: 'Créditos con saldo', w: 11, num: true }, { k: 'total', t: 'Total financiado', w: 18, num: true, din: true },
      { k: 'pagado', t: 'Pagado', w: 18, num: true, din: true }, { k: 'saldo', t: 'Saldo pendiente', w: 18, num: true, din: true },
      { k: 'vencido', t: 'Monto vencido', w: 18, num: true, din: true, rojo: 'esVencido' }, { k: 'atraso', t: 'Días de atraso', w: 11, num: true },
    ], cart.clientes.map(function (g) { return { nombre: g.nombre, telefono: g.telefono, creditos: g.creditos.length, total: g.total, pagado: g.pagado, saldo: g.saldo, vencido: g.vencido, atraso: g.atraso, esVencido: g.vencido > 0 }; }),
      ['creditos', 'total', 'pagado', 'saldo', 'vencido']);

    // Hoja 2: facturas (créditos) pendientes
    var ws2 = wb.addWorksheet('Facturas pendientes');
    encabezadoHoja(ws2, 'Facturas de crédito pendientes', 13);
    var det = [];
    cart.clientes.forEach(function (g) { g.creditos.forEach(function (c) {
      det.push({ cliente: g.nombre, telefono: g.telefono, numero: c.numero + (c.proforma ? ' (' + c.proforma + ')' : ''), tipo: c.tipo, fecha: c.fecha,
        total: c.total, pagado: c.pagado, saldo: c.saldo, cuotas: c.cuotasPend, proximo: c.proximo, ultimo: c.ultimo, atraso: c.atraso, estado: c.estado, esVencido: c.vencido });
    }); });
    tabla(ws2, 5, [
      { k: 'cliente', t: 'Cliente', w: 30 }, { k: 'telefono', t: 'Teléfono', w: 14 }, { k: 'numero', t: 'N° crédito', w: 18 }, { k: 'tipo', t: 'Tipo', w: 16 },
      { k: 'fecha', t: 'Fecha del crédito', w: 13, fecha: true }, { k: 'total', t: 'Total', w: 17, num: true, din: true }, { k: 'pagado', t: 'Pagado', w: 17, num: true, din: true },
      { k: 'saldo', t: 'Saldo pendiente', w: 17, num: true, din: true }, { k: 'cuotas', t: 'Cuotas pendientes', w: 10, num: true },
      { k: 'proximo', t: 'Próximo vencimiento', w: 13, fecha: true }, { k: 'ultimo', t: 'Último vencimiento', w: 13, fecha: true },
      { k: 'atraso', t: 'Días de atraso', w: 10, num: true }, { k: 'estado', t: 'Estado', w: 12, rojo: 'esVencido' },
    ], det, ['total', 'pagado', 'saldo', 'cuotas']);

    // Hoja 3: cuotas pendientes (detalle)
    var ws3 = wb.addWorksheet('Cuotas pendientes');
    encabezadoHoja(ws3, 'Detalle de cuotas pendientes', 10);
    var cu = [];
    cart.clientes.forEach(function (g) { g.creditos.forEach(function (c) {
      if (!c.cuotas.length) cu.push({ cliente: g.nombre, numero: c.numero, cuota: '—', vence: '', monto: '', pagado: '', saldo: c.saldo, atraso: c.atraso, estado: c.vencido ? 'Vencida' : 'Sin cuotas registradas', esVencido: c.vencido });
      c.cuotas.forEach(function (q) { cu.push({ cliente: g.nombre, numero: c.numero, cuota: '#' + q.numero, vence: q.vence, monto: q.monto, pagado: q.pagado, saldo: q.saldo, atraso: q.diasAtraso, estado: q.estado, esVencido: q.estado === 'Vencida' }); });
    }); });
    tabla(ws3, 5, [
      { k: 'cliente', t: 'Cliente', w: 32 }, { k: 'numero', t: 'N° crédito', w: 18 }, { k: 'cuota', t: 'Cuota', w: 9 }, { k: 'vence', t: 'Vence', w: 13, fecha: true },
      { k: 'monto', t: 'Monto de la cuota', w: 18, num: true, din: true }, { k: 'pagado', t: 'Abonado', w: 18, num: true, din: true }, { k: 'saldo', t: 'Saldo de la cuota', w: 18, num: true, din: true },
      { k: 'atraso', t: 'Días de atraso', w: 10, num: true }, { k: 'estado', t: 'Estado', w: 20, rojo: 'esVencido' },
    ], cu, ['monto', 'pagado', 'saldo']);
    var nota = ws3.getRow(cu.length + 8);
    nota.getCell(1).value = 'Nota: el saldo de cada crédito es el que muestra la pantalla de Créditos. En créditos antiguos sin cuotas registradas se muestra el saldo completo del crédito.';
    nota.getCell(1).font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF777788' } };

    [ws1, ws2, ws3].forEach(function (ws) { ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }; });
    var buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------------- PDF (vertical) ---------------- */
  async function construirPDF(cart, op) {
    if (!window.jspdf) throw new Error('jsPDF no disponible');
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
    var rgb = hexARgb(await colorMarca());
    var luz = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    var txtEnc = luz > 150 ? [20, 20, 30] : [255, 255, 255];
    var sym = simbolo();
    function din(n) { return sym + ' ' + miles(n); }

    // encabezado
    doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(0, 0, W, 28, 'F');
    var tx = M;
    try {
      if (window._cc_cargarLogo) {
        var logo = await window._cc_cargarLogo(uid());
        if (logo && logo.dataUrl) { var dim = window._cc_ajustarLogo(logo.anchoNatural, logo.altoNatural, 30, 18); doc.addImage(logo.dataUrl, logo.formato, M, (28 - dim.h) / 2, dim.w, dim.h); tx = M + dim.w + 5; }
      }
    } catch (e) {}
    doc.setTextColor(txtEnc[0], txtEnc[1], txtEnc[2]);
    doc.setFont(undefined, 'bold'); doc.setFontSize(15);
    doc.text(doc.splitTextToSize(nombreNegocio(), W - tx - 60)[0], tx, 13);
    doc.setFont(undefined, 'normal'); doc.setFontSize(10.5);
    doc.text('Cartera de créditos pendientes', tx, 21);
    doc.setFontSize(8.5); doc.text('Generado: ' + ahoraTexto(), W - M, 12, { align: 'right' });
    doc.text(op.clientes && op.clientes.length ? op.clientes.length + ' cliente(s) seleccionado(s)' : 'Todos los clientes', W - M, 18, { align: 'right' });

    var y = 35;
    doc.setTextColor(100, 100, 120); doc.setFontSize(8.5);
    doc.text(doc.splitTextToSize(textoFiltros(op), W - M * 2), M, y); y += 8;

    // tarjetas de totales
    var t = cart.totales;
    var tarj = [['Clientes', String(t.clientes)], ['Créditos con saldo', String(t.creditos)], ['Saldo pendiente', din(t.saldo)], ['Monto vencido', din(t.vencido)]];
    var aw = (W - M * 2 - 9) / 4;
    tarj.forEach(function (c, i) {
      var x = M + i * (aw + 3);
      doc.setDrawColor(222, 222, 232); doc.setFillColor(i === 3 && t.vencido > 0 ? 253 : 247, i === 3 && t.vencido > 0 ? 236 : 247, i === 3 && t.vencido > 0 ? 234 : 251);
      doc.roundedRect(x, y, aw, 16, 2, 2, 'FD');
      doc.setTextColor(110, 110, 130); doc.setFontSize(7.5); doc.setFont(undefined, 'normal'); doc.text(c[0], x + 3, y + 5.5);
      doc.setTextColor(i === 3 && t.vencido > 0 ? 192 : 20, i === 3 && t.vencido > 0 ? 57 : 20, i === 3 && t.vencido > 0 ? 43 : 30);
      doc.setFontSize(i >= 2 ? 10 : 12); doc.setFont(undefined, 'bold'); doc.text(doc.splitTextToSize(c[1], aw - 5)[0], x + 3, y + 12.5);
    });
    y += 22;

    // resumen por cliente
    doc.setTextColor(20, 20, 30); doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.text('Resumen por cliente', M, y); y += 3;
    doc.autoTable({
      startY: y, margin: { left: M, right: M, bottom: 16 },
      head: [['Cliente', 'Créd.', 'Saldo pendiente', 'Vencido', 'Atraso']],
      body: cart.clientes.map(function (g) { return [g.nombre + (g.telefono ? '\n' + g.telefono : ''), String(g.creditos.length), din(g.saldo), g.vencido > 0 ? din(g.vencido) : '—', g.atraso > 0 ? g.atraso + ' d' : '—']; }),
      foot: [['TOTAL', String(t.creditos), din(t.saldo), din(t.vencido), '']],
      showFoot: 'lastPage', showHead: 'everyPage', theme: 'striped',
      headStyles: { fillColor: rgb, textColor: txtEnc, fontSize: 8.5 },
      footStyles: { fillColor: [237, 238, 245], textColor: [20, 20, 30], fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
      columnStyles: { 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right', cellWidth: 'wrap' }, 3: { halign: 'right', cellWidth: 'wrap' }, 4: { halign: 'right', cellWidth: 'wrap' } },
      didParseCell: function (h) {
        if (h.section === 'head' && h.column.index > 0) h.cell.styles.halign = 'right';
        if (h.section === 'foot' && h.column.index > 0) h.cell.styles.halign = 'right';
        if (h.section === 'body' && h.column.index === 3 && h.cell.raw !== '—') h.cell.styles.textColor = [192, 57, 43];
      },
    });
    y = doc.lastAutoTable.finalY + 8;

    // detalle por cliente
    doc.addPage(); y = 16;
    doc.setTextColor(20, 20, 30); doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.text('Detalle por cliente', M, y); y += 5;
    cart.clientes.forEach(function (g) {
      if (y > H - 50) { doc.addPage(); y = 16; }
      // barra del cliente
      doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.roundedRect(M, y, W - M * 2, 8.5, 1.5, 1.5, 'F');
      doc.setTextColor(txtEnc[0], txtEnc[1], txtEnc[2]); doc.setFont(undefined, 'bold'); doc.setFontSize(9.5);
      doc.text(doc.splitTextToSize(g.nombre + (g.telefono ? '  ·  ' + g.telefono : ''), 120)[0], M + 3, y + 5.7);
      doc.text('Saldo: ' + din(g.saldo), W - M - 3, y + 5.7, { align: 'right' });
      y += 10;
      doc.autoTable({
        startY: y, margin: { left: M, right: M, bottom: 16 },
        head: [['Crédito', 'Fecha', 'Próx. venc.', 'Total', 'Pagado', 'Saldo', 'Estado']],
        body: g.creditos.map(function (c) { return [c.numero + (c.proforma ? '\n' + c.proforma : ''), fechaCorta(c.fecha), fechaCorta(c.proximo) || '—', din(c.total), din(c.pagado), din(c.saldo), c.estado + (c.atraso > 0 ? '\n' + c.atraso + ' d' : '')]; }),
        showHead: 'everyPage', theme: 'grid',
        headStyles: { fillColor: [240, 240, 246], textColor: [60, 60, 80], fontSize: 8, lineColor: [225, 225, 232] },
        styles: { fontSize: 8, cellPadding: 1.8, lineColor: [225, 225, 232], valign: 'middle' },
        columnStyles: { 3: { halign: 'right', cellWidth: 'wrap' }, 4: { halign: 'right', cellWidth: 'wrap' }, 5: { halign: 'right', cellWidth: 'wrap' } },
        didParseCell: function (h) {
          if (h.section === 'head' && h.column.index >= 3 && h.column.index <= 5) h.cell.styles.halign = 'right';
          if (h.section === 'body' && h.column.index === 6 && /^Vencido/.test(String(h.cell.raw))) { h.cell.styles.textColor = [192, 57, 43]; h.cell.styles.fontStyle = 'bold'; }
          if (h.section === 'body' && h.column.index === 5) h.cell.styles.fontStyle = 'bold';
        },
      });
      y = doc.lastAutoTable.finalY + 2;
      // cuotas pendientes de cada crédito (detalle)
      var cuotasTodas = [];
      g.creditos.forEach(function (c) { c.cuotas.forEach(function (q) { cuotasTodas.push([c.numero, '#' + q.numero, fechaCorta(q.vence), din(q.monto), din(q.saldo), q.estado + (q.diasAtraso > 0 ? ' (' + q.diasAtraso + ' d)' : '')]); }); });
      if (cuotasTodas.length) {
        doc.autoTable({
          startY: y + 1, margin: { left: M + 6, right: M, bottom: 16 },
          head: [['Crédito', 'Cuota', 'Vence', 'Monto', 'Saldo', 'Estado']], body: cuotasTodas,
          showHead: 'everyPage', theme: 'plain',
          headStyles: { fontSize: 7.5, textColor: [110, 110, 130], fontStyle: 'bold', lineColor: [225, 225, 232], lineWidth: { bottom: 0.2 } },
          styles: { fontSize: 7.5, cellPadding: 1.3, textColor: [70, 70, 90] },
          columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
          didParseCell: function (h) {
            if (h.section === 'head' && (h.column.index === 3 || h.column.index === 4)) h.cell.styles.halign = 'right';
            if (h.section === 'body' && h.column.index === 5 && /^Vencida/.test(String(h.cell.raw))) { h.cell.styles.textColor = [192, 57, 43]; h.cell.styles.fontStyle = 'bold'; }
          },
        });
        y = doc.lastAutoTable.finalY;
      }
      y += 7;
    });

    // total general
    if (y > H - 40) { doc.addPage(); y = 16; }
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.6); doc.setFillColor(247, 247, 251);
    doc.roundedRect(W - M - 90, y, 90, 24, 2, 2, 'FD'); doc.setLineWidth(0.2);
    doc.setTextColor(90, 90, 110); doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    doc.text('Total financiado:', W - M - 86, y + 6.5); doc.text(din(t.total), W - M - 4, y + 6.5, { align: 'right' });
    doc.text('Pagado:', W - M - 86, y + 12); doc.text(din(t.pagado), W - M - 4, y + 12, { align: 'right' });
    doc.setTextColor(20, 20, 30); doc.setFont(undefined, 'bold'); doc.setFontSize(11);
    doc.text('SALDO TOTAL:', W - M - 86, y + 19.5); doc.text(din(t.saldo), W - M - 4, y + 19.5, { align: 'right' });

    // pie con número de página
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p); doc.setFont(undefined, 'normal'); doc.setFontSize(7.5); doc.setTextColor(150, 150, 170);
      doc.text('Cartera de créditos · ' + nombreNegocio() + ' · generado por Negocio360', M, H - 7);
      doc.text('Página ' + p + ' de ' + n, W - M, H - 7, { align: 'right' });
    }
    return doc;
  }

  /* ---------------- ventana de opciones ---------------- */
  function seleccionActual() { return Object.keys(ST.sel).filter(function (k) { return ST.sel[k]; }); }
  function filtrarClientesVisibles() {
    var q = ST.busqueda.trim().toLowerCase();
    var vistos = {};
    ST.creditos.forEach(function (c) { vistos[c.cliente_id || '_sin'] = (vistos[c.cliente_id || '_sin'] || 0) + num(c.saldo_pendiente); });
    var lista = Object.keys(vistos).map(function (k) { return { id: k, nombre: nombreCliente(k === '_sin' ? null : ST.clientes[k]), saldo: r2(cv(vistos[k])) }; });
    lista.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
    return q ? lista.filter(function (c) { return c.nombre.toLowerCase().indexOf(q) >= 0; }) : lista;
  }
  function resumenSeleccion() {
    var sel = seleccionActual();
    var hoy = hoyISO(); // los "vencidos" exactos se calculan al exportar; aquí solo cuenta por saldo
    var filas = ST.creditos.filter(function (c) {
      if (ST.tipo === 'venta' && c.tipo === 'financiero') return false;
      if (ST.tipo === 'financiero' && c.tipo !== 'financiero') return false;
      if (ST.estado === 'vencidos' && c.estado !== 'con_atraso') return true;   // se afina al exportar
      return !sel.length || sel.indexOf(c.cliente_id || '_sin') >= 0;
    }).filter(function (c) { return !sel.length || sel.indexOf(c.cliente_id || '_sin') >= 0; });
    var saldo = filas.reduce(function (s, c) { return s + num(c.saldo_pendiente); }, 0);
    var clientes = {}; filas.forEach(function (c) { clientes[c.cliente_id || '_sin'] = 1; });
    return { creditos: filas.length, clientes: Object.keys(clientes).length, saldo: r2(cv(saldo)) };
  }

  function pintarModal() {
    var m = document.getElementById('n360-exp-cartera'); if (!m) return;
    var lista = filtrarClientesVisibles();
    var sel = seleccionActual();
    var res = resumenSeleccion();
    var html = lista.length ? lista.map(function (c) {
      return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border,#e8e8ef);cursor:pointer;font-size:13px">' +
        '<input type="checkbox" data-cli="' + esc(c.id) + '" ' + (ST.sel[c.id] ? 'checked' : '') + '/>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.nombre) + '</span>' +
        '<span style="color:var(--text-muted,#777);font-size:12px;white-space:nowrap">' + esc(dinero(c.saldo)) + '</span></label>';
    }).join('') : '<div style="padding:14px;color:var(--text-muted,#777);font-size:13px">No hay clientes con saldo pendiente.</div>';
    m.querySelector('#exp-lista').innerHTML = html;
    m.querySelector('#exp-resumen').innerHTML =
      '<b>' + res.clientes + '</b> cliente' + (res.clientes === 1 ? '' : 's') + ' · <b>' + res.creditos + '</b> crédito' + (res.creditos === 1 ? '' : 's') +
      ' con saldo · saldo <b>' + esc(dinero(res.saldo)) + '</b>' + (ST.estado === 'vencidos' ? ' <span style="color:var(--text-muted,#777)">(se afina al exportar: solo vencidos)</span>' : '');
    m.querySelector('#exp-nsel').textContent = sel.length ? sel.length + ' seleccionado' + (sel.length === 1 ? '' : 's') : 'Todos los clientes';
  }

  function construirModal() {
    var d = document.getElementById('n360-exp-cartera'); if (d) d.remove();
    d = document.createElement('div'); d.id = 'n360-exp-cartera';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:12px';
    var rad = function (nombre, valor, txt, marcado) { return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="radio" name="' + nombre + '" value="' + valor + '" ' + (marcado ? 'checked' : '') + '/>' + txt + '</label>'; };
    d.innerHTML =
      '<div style="background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);border-radius:14px;width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border,#e8e8ef)">' +
        '<span style="font-weight:700;font-size:15px">📥 Exportar cartera de créditos</span>' +
        '<button type="button" id="exp-x" style="background:none;border:none;font-size:18px;cursor:pointer;color:inherit">✕</button></div>' +
      '<div style="padding:14px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:14px">' +
        '<div style="font-size:12.5px;color:var(--text-muted,#777)">Todos los clientes con su saldo y sus créditos y cuotas pendientes, sin límite de fechas. Solo lee la información: no cambia nada.</div>' +
        '<div><div style="font-weight:600;font-size:13px;margin-bottom:6px">Estado</div><div style="display:flex;gap:14px;flex-wrap:wrap">' +
          rad('exp-estado', 'todos', 'Todos con saldo', true) + rad('exp-estado', 'vencidos', 'Solo vencidos', false) + rad('exp-estado', 'aldia', 'Solo al día', false) + '</div></div>' +
        '<div><div style="font-weight:600;font-size:13px;margin-bottom:6px">Tipo</div><div style="display:flex;gap:14px;flex-wrap:wrap">' +
          rad('exp-tipo', 'todos', 'Todos', true) + rad('exp-tipo', 'venta', 'Ventas a crédito', false) + rad('exp-tipo', 'financiero', 'Financieros', false) + '</div></div>' +
        '<div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><span style="font-weight:600;font-size:13px">Cliente</span>' +
          '<span style="font-size:12px;color:var(--text-muted,#777)"><span id="exp-nsel"></span> · <a href="#" id="exp-todos" style="color:var(--accent,#5a5af4)">Quitar selección</a></span></div>' +
          '<input type="search" id="exp-buscar" placeholder="Buscar cliente…" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid var(--border,#e8e8ef);border-radius:8px;font-size:13px;background:var(--bg-surface,#fff);color:inherit;margin-bottom:6px"/>' +
          '<div id="exp-lista" style="max-height:200px;overflow-y:auto;border:1px solid var(--border,#e8e8ef);border-radius:8px"></div></div>' +
        '<div id="exp-resumen" style="padding:10px 12px;background:var(--bg-app,var(--bg-surface-2,#f5f5fa));border-radius:8px;font-size:13px"></div>' +
        '<div id="exp-error" style="color:var(--danger,#c0392b);font-size:12.5px;display:none"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--border,#e8e8ef)">' +
        '<button type="button" class="btn-secondary" id="exp-cancelar" style="flex:1;min-width:90px">Cancelar</button>' +
        '<button type="button" class="btn-primary" id="exp-excel" style="flex:1;min-width:120px">📊 Excel</button>' +
        '<button type="button" class="btn-primary" id="exp-pdf" style="flex:1;min-width:120px">📄 PDF</button></div></div>';
    document.body.appendChild(d);
    var cerrar = function () { d.remove(); };
    d.querySelector('#exp-x').onclick = cerrar; d.querySelector('#exp-cancelar').onclick = cerrar;
    d.addEventListener('mousedown', function (e) { if (e.target === d) cerrar(); });
    d.querySelectorAll('input[name="exp-estado"]').forEach(function (r) { r.onchange = function () { ST.estado = r.value; pintarModal(); }; });
    d.querySelectorAll('input[name="exp-tipo"]').forEach(function (r) { r.onchange = function () { ST.tipo = r.value; pintarModal(); }; });
    d.querySelector('#exp-buscar').oninput = function (e) { ST.busqueda = e.target.value; pintarModal(); };
    d.querySelector('#exp-todos').onclick = function (e) { e.preventDefault(); ST.sel = {}; pintarModal(); };
    d.querySelector('#exp-lista').addEventListener('change', function (e) { var id = e.target && e.target.getAttribute('data-cli'); if (id !== null && id !== undefined) { ST.sel[id] = e.target.checked; pintarModal(); } });
    d.querySelector('#exp-excel').onclick = function () { exportar('excel'); };
    d.querySelector('#exp-pdf').onclick = function () { exportar('pdf'); };
    return d;
  }

  function opcionesActuales() { return { estado: ST.estado, tipo: ST.tipo, clientes: seleccionActual() }; }
  function descargar(blob, nombre) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function mostrarError(m, txt) { var e = m && m.querySelector('#exp-error'); if (e) { e.textContent = txt; e.style.display = txt ? '' : 'none'; } }

  async function exportar(formato) {
    var m = document.getElementById('n360-exp-cartera');
    var bE = m && m.querySelector('#exp-excel'), bP = m && m.querySelector('#exp-pdf');
    var original = [bE && bE.textContent, bP && bP.textContent];
    try {
      mostrarError(m, '');
      [bE, bP].forEach(function (b) { if (b) b.disabled = true; });
      var activo = formato === 'excel' ? bE : bP; if (activo) activo.textContent = 'Preparando…';
      var op = opcionesActuales();
      // créditos a exportar (por tipo y cliente); el estado "vencido" se resuelve con las cuotas
      var cand = ST.creditos.filter(function (c) {
        if (op.tipo === 'venta' && c.tipo === 'financiero') return false;
        if (op.tipo === 'financiero' && c.tipo !== 'financiero') return false;
        if (op.clientes.length && op.clientes.indexOf(c.cliente_id || '_sin') < 0) return false;
        return true;
      });
      var cuotas = await leerCuotas(cand.map(function (c) { return c.id; }));
      var prof = await leerProformas(cand);
      var cart = armarCartera(cand, cuotas, prof, op);
      if (!cart.clientes.length) { mostrarError(m, 'No hay créditos que cumplan esos filtros.'); return; }
      if (formato === 'excel') descargar(await construirExcel(cart, op), nombreArchivo('xlsx'));
      else (await construirPDF(cart, op)).save(nombreArchivo('pdf'));
      aviso('Cartera exportada: ' + cart.totales.clientes + ' cliente(s), saldo ' + dinero(cart.totales.saldo));
    } catch (e) {
      console.error('exportar cartera:', e);
      mostrarError(m, 'No se pudo exportar: ' + (e && e.message ? e.message : 'error desconocido'));
    } finally {
      if (bE) { bE.disabled = false; bE.textContent = original[0]; }
      if (bP) { bP.disabled = false; bP.textContent = original[1]; }
    }
  }

  async function abrir() {
    if (ST.cargando) return;
    if (!uid()) { aviso('Espera a que cargue la página e inténtalo de nuevo', 'error'); return; }
    ST.estado = 'todos'; ST.tipo = 'todos'; ST.busqueda = ''; ST.sel = {};
    var m = construirModal();
    m.querySelector('#exp-lista').innerHTML = '<div style="padding:14px;font-size:13px;color:var(--text-muted,#777)">Cargando clientes…</div>';
    ST.cargando = true;
    try {
      ST.creditos = await leerCreditosPendientes();
      var ids = Array.from(new Set(ST.creditos.map(function (c) { return c.cliente_id; }).filter(Boolean)));
      ST.clientes = await leerClientes(ids);
      pintarModal();
    } catch (e) {
      console.error('exportar cartera (cargar):', e);
      m.querySelector('#exp-lista').innerHTML = '';
      mostrarError(m, 'No se pudieron cargar los créditos: ' + (e && e.message ? e.message : 'error'));
    } finally { ST.cargando = false; }
  }

  window.abrirExportarCartera = abrir;
  // para pruebas
  window.__expCartera = { armarCartera: armarCartera, construirExcel: construirExcel, construirPDF: construirPDF, leerCreditosPendientes: leerCreditosPendientes, leerCuotas: leerCuotas, leerClientes: leerClientes, ST: ST };
})();
