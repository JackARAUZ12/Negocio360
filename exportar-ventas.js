/* =====================================================
   EXPORTAR-VENTAS.JS — Negocio360
   "Exportar" del módulo Ventas (Excel + PDF) usando el motor N360Exp.
   Solo LEE: no cambia ventas, caja, créditos, inventario ni contabilidad.
   Los totales usan la misma regla que la pantalla de Ventas:
     · solo ventas "completada" (opcional ver anuladas),
     · ingreso NETO = total − IVA,
     · las devoluciones restan (aparecen como filas negativas),
     · contado / crédito según esVentaACredito().
===================================================== */
(function () {
  'use strict';

  function esCredito(v) { return v && (v.estado_pago === 'credito' || v.metodo_pago === 'credito' || v.metodo_pago === 'fiado'); }
  function sigDia(iso) { var p = iso.split('-').map(Number); var d = new Date(p[0], p[1] - 1, p[2] + 1); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function claveCliente(v) { return v.cliente_id ? 'c:' + v.cliente_id : (v.cliente_nombre ? 'n:' + v.cliente_nombre : '__mostrador'); }
  function nombreCliente(v) { return v.cliente_nombre || 'Cliente de mostrador'; }

  var cfg = {
    titulo: 'Reporte de ventas',
    archivo: 'Ventas',
    pdfOrientacion: 'landscape',
    ayuda: 'Elige el período y los filtros. Los totales usan la misma regla que la pantalla de Ventas (ingreso neto sin IVA, con devoluciones restadas). Solo lee la información.',
    filtros: [
      { tipo: 'periodo', etiqueta: 'Período', def: 'mes', permiteTodo: false },
      { tipo: 'radio', k: 'estado', etiqueta: 'Estado de la venta', def: 'completada', recarga: false, opciones: [['completada', 'Completadas'], ['anulada', 'Anuladas'], ['todas', 'Todas']] },
      { tipo: 'radio', k: 'pago', etiqueta: 'Forma de pago', def: 'todas', recarga: false, opciones: [['todas', 'Todas'], ['contado', 'Contado'], ['credito', 'Crédito']] },
      { tipo: 'select', k: 'vendedor', etiqueta: 'Vendedor', opciones: function (d) { var s = {}; d.ventas.forEach(function (v) { if (v.creado_por_nombre) s[v.creado_por_nombre] = 1; }); return [['', 'Todos los vendedores']].concat(Object.keys(s).sort().map(function (x) { return [x, x]; })); } },
      { tipo: 'select', k: 'metodo', etiqueta: 'Método de pago', opciones: function (d) { var s = {}; d.ventas.forEach(function (v) { if (v.metodo_pago_nombre) s[v.metodo_pago_nombre] = 1; }); return [['', 'Todos los métodos']].concat(Object.keys(s).sort().map(function (x) { return [x, x]; })); } },
      { tipo: 'radio', k: 'lineas', etiqueta: 'Productos vendidos (hojas de líneas y por producto)', def: 'si', recarga: false, opciones: [['si', 'Incluir'], ['no', 'No incluir']] },
    ],
    entidad: {
      etiqueta: 'Clientes (déjalo vacío para incluir a todos)',
      vacio: 'No hay ventas en ese período.',
      lista: function (d, op, E) {
        var m = {};
        filtrar(d, op, true).forEach(function (v) {
          var k = claveCliente(v); if (!m[k]) m[k] = { id: k, nombre: nombreCliente(v), n: 0 }; m[k].n++;
        });
        return Object.keys(m).map(function (k) { return { id: m[k].id, nombre: m[k].nombre, extra: m[k].n + ' mov.' }; }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
      },
    },

    cargar: async function (ctx, op, E) {
      var rg = { desde: op.desde, hasta: op.hasta };
      var restr = (typeof obtenerRestriccionHistorialVentas === 'function') ? obtenerRestriccionHistorialVentas() : null;
      var ventas = await E.leerTodo(function () {
        var q = ctx.sb.from('ventas').select('id,numero_venta,fecha,cliente_id,cliente_nombre,subtotal,descuento,impuesto,total,costo_total,ganancia,metodo_pago,estado_pago,metodo_pago_nombre,estado,creado_por_nombre,descuento_general')
          .eq('auth_user_id', ctx.userId).gte('fecha', rg.desde).lt('fecha', sigDia(rg.hasta));
        if (restr) q = q.eq('creado_por_nombre', restr);
        return q;
      }, 'ventas');
      var devs = [];
      if (window.N360DevolucionesVenta) {
        devs = await N360DevolucionesVenta.filasNegativas(ctx.sb, ctx.userId, rg.desde, rg.hasta, { creadoPor: restr || null });
      }
      return { ventas: ventas, devs: devs };
    },

    vista: function (d, op, E) {
      var f = filtrar(d, op, false), t = totales(f, E);
      return '<b>' + t.n + '</b> venta' + (t.n === 1 ? '' : 's') + (t.nDev ? ' · ' + t.nDev + ' devolución(es)' : '') + '<br>' +
        'Ventas netas (sin IVA): <b>' + E.dinero(t.neto) + '</b> · Total con IVA: <b>' + E.dinero(t.total) + '</b><br>' +
        'Ganancia: <b>' + E.dinero(t.ganancia) + '</b>';
    },

    textoFiltros: function (op) {
      var p = [];
      p.push('Período: ' + (op.desde ? (op.desde === op.hasta ? fc(op.desde) : fc(op.desde) + ' al ' + fc(op.hasta)) : 'Todo'));
      p.push('Estado: ' + ({ completada: 'completadas', anulada: 'anuladas', todas: 'todas' }[op.estado] || ''));
      if (op.pago && op.pago !== 'todas') p.push('Pago: ' + op.pago);
      if (op.vendedor) p.push('Vendedor: ' + op.vendedor);
      if (op.metodo) p.push('Método: ' + op.metodo);
      if (op.entidades && op.entidades.length) p.push('Clientes seleccionados: ' + op.entidades.length);
      return p.join('  ·  ');
    },

    armar: async function (d, op, E, ctx) {
      var f = filtrar(d, op, false);
      if (!f.length) return { vacio: true, mensajeVacio: 'No hay ventas que cumplan esos filtros.' };
      var filas = f.map(function (v) {
        var esDev = !!v.es_devolucion, cred = !esDev && esCredito(v);
        var total = E.r2(E.cv(v.total)), imp = E.r2(E.cv(v.impuesto || 0));
        return {
          id: v.id, fecha: String(v.fecha || '').slice(0, 10), numero: v.numero_venta || '', cliente: nombreCliente(v), ckey: claveCliente(v),
          vendedor: v.creado_por_nombre || '—', metodo: v.metodo_pago_nombre || '—',
          tipo: esDev ? 'Devolución' : (cred ? 'Crédito' : 'Contado'), estado: esDev ? 'devolución' : (v.estado || ''),
          subtotal: E.r2(E.cv(v.subtotal || 0)), descuento: E.r2(E.cv((v.descuento || 0))), impuesto: imp, total: total,
          neto: E.r2(total - imp), costo: E.r2(E.cv(v.costo_total || 0)), ganancia: E.r2(E.cv(v.ganancia || 0)),
          contado: (!esDev && !cred) || esDev && !esCredito(v._venta || v) ? E.r2(total - imp) : 0,
          credito: cred || (esDev && esCredito(v)) ? E.r2(total - imp) : 0,
          esDev: esDev,
        };
      });
      // contado/crédito: se recalcula claro (devolución hereda la forma de pago de su venta)
      filas.forEach(function (r, i) {
        var v = f[i], cred = esCredito(v);
        r.contado = cred ? 0 : r.neto; r.credito = cred ? r.neto : 0;
      });
      filas.sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (a.numero < b.numero ? 1 : -1); });

      var sum = function (arr, k) { return E.r2(arr.reduce(function (s, r) { return s + E.num(r[k]); }, 0)); };
      var nVentas = filas.filter(function (r) { return !r.esDev; }).length, nDev = filas.length - nVentas;
      var T = { neto: sum(filas, 'neto'), imp: sum(filas, 'impuesto'), total: sum(filas, 'total'), gan: sum(filas, 'ganancia'), costo: sum(filas, 'costo'), contado: sum(filas, 'contado'), credito: sum(filas, 'credito'), desc: sum(filas, 'descuento') };
      var devNeto = E.r2(filas.filter(function (r) { return r.esDev; }).reduce(function (s, r) { return s + r.neto; }, 0));
      var ticket = nVentas ? E.r2(T.neto / nVentas) : 0;
      var kpi = function (t, n, extra) { var o = { t: t, num: n, v: E.dinero(n), din: true }; if (extra) for (var k in extra) o[k] = extra[k]; return o; };
      var kpis = [
        { t: 'Cantidad de ventas', num: nVentas, v: String(nVentas) },
        kpi('Ventas netas (sin IVA)', T.neto, { fuerte: true }),
        kpi('IVA', T.imp),
        kpi('Total con IVA', T.total),
        kpi('Cobrado de contado (neto)', T.contado),
        kpi('A crédito (neto)', T.credito),
        kpi('Ganancia', T.gan, { fuerte: true }),
        kpi('Ticket promedio (neto)', ticket),
      ];
      if (nDev) { kpis.push({ t: 'Devoluciones (ya restadas)', num: devNeto, v: E.dinero(devNeto), din: true, rojo: devNeto < 0, tarjeta: false }); }
      kpis.push(kpi('Costo de lo vendido', T.costo, { tarjeta: false }), kpi('Descuentos', T.desc, { tarjeta: false }));

      // ---- tablas de resumen
      function agrupa(clave, nombreCol) {
        var m = {};
        filas.forEach(function (r) { var k = r[clave] || '—'; var o = m[k] || (m[k] = { g: k, n: 0, neto: 0, impuesto: 0, total: 0, ganancia: 0, contado: 0, credito: 0 }); if (!r.esDev) o.n++; ['neto', 'impuesto', 'total', 'ganancia', 'contado', 'credito'].forEach(function (c) { o[c] = E.r2(o[c] + r[c]); }); });
        return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.neto - a.neto; });
      }
      var colsRes = function (tit, ancho) {
        return [{ k: 'g', t: tit, w: ancho || 30 }, { k: 'n', t: '# ventas', w: 10, num: true }, { k: 'neto', t: 'Venta neta', w: 16, num: true, din: true }, { k: 'impuesto', t: 'IVA', w: 14, num: true, din: true }, { k: 'total', t: 'Total', w: 16, num: true, din: true }, { k: 'ganancia', t: 'Ganancia', w: 16, num: true, din: true }];
      };
      var S = ['n', 'neto', 'impuesto', 'total', 'ganancia'];
      var resumenTablas = [
        { subtitulo: 'Por forma de pago', columnas: colsRes('Forma de pago'), filas: agrupa('tipo'), sumar: S },
        { subtitulo: 'Por método de pago', columnas: colsRes('Método de pago'), filas: agrupa('metodo'), sumar: S },
        { subtitulo: 'Por vendedor', columnas: colsRes('Vendedor'), filas: agrupa('vendedor'), sumar: S },
      ];

      // ---- por cliente
      var mc = {};
      filas.forEach(function (r) {
        var o = mc[r.ckey] || (mc[r.ckey] = { cliente: r.cliente, n: 0, neto: 0, impuesto: 0, total: 0, contado: 0, credito: 0, ganancia: 0, ultima: '' });
        if (!r.esDev) { o.n++; if (r.fecha > o.ultima) o.ultima = r.fecha; }
        ['neto', 'impuesto', 'total', 'contado', 'credito', 'ganancia'].forEach(function (c) { o[c] = E.r2(o[c] + r[c]); });
      });
      var porCliente = Object.keys(mc).map(function (k) { return mc[k]; }).sort(function (a, b) { return b.neto - a.neto; });
      var tPorCliente = {
        subtitulo: null, etiquetaTotal: 'TOTAL', sumar: ['n', 'neto', 'impuesto', 'total', 'contado', 'credito', 'ganancia'], filas: porCliente,
        columnas: [{ k: 'cliente', t: 'Cliente', w: 34 }, { k: 'n', t: '# ventas', w: 10, num: true }, { k: 'ultima', t: 'Última compra', w: 14, fecha: true },
          { k: 'neto', t: 'Venta neta', w: 16, num: true, din: true }, { k: 'impuesto', t: 'IVA', w: 13, num: true, din: true }, { k: 'total', t: 'Total', w: 16, num: true, din: true },
          { k: 'contado', t: 'Contado', w: 15, num: true, din: true }, { k: 'credito', t: 'Crédito', w: 15, num: true, din: true }, { k: 'ganancia', t: 'Ganancia', w: 16, num: true, din: true }],
      };

      // ---- detalle agrupado por cliente
      var tDetalle = {
        etiquetaTotal: 'TOTAL GENERAL', agrupar: { k: 'cliente', etiqueta: 'Subtotal cliente' }, sumar: ['subtotal', 'descuento', 'impuesto', 'total', 'neto', 'ganancia'],
        filas: filas.slice().sort(function (a, b) { return a.cliente.localeCompare(b.cliente) || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0); }),
        columnas: [{ k: 'cliente', t: 'Cliente', w: 28 }, { k: 'fecha', t: 'Fecha', w: 12, fecha: true }, { k: 'numero', t: 'No. venta', w: 18 }, { k: 'tipo', t: 'Tipo', w: 11 }, { k: 'estado', t: 'Estado', w: 12 },
          { k: 'vendedor', t: 'Vendedor', w: 18 }, { k: 'metodo', t: 'Método de pago', w: 20 },
          { k: 'subtotal', t: 'Subtotal', w: 14, num: true, din: true }, { k: 'descuento', t: 'Descuento', w: 13, num: true, din: true }, { k: 'impuesto', t: 'IVA', w: 13, num: true, din: true },
          { k: 'total', t: 'Total', w: 15, num: true, din: true, rojo: 'esDev' }, { k: 'neto', t: 'Venta neta', w: 15, num: true, din: true, rojo: 'esDev' }, { k: 'ganancia', t: 'Ganancia', w: 15, num: true, din: true }],
      };

      var hojas = [
        { nombre: 'Por cliente', titulo: 'Ventas por cliente', tablas: [tPorCliente] },
        { nombre: 'Detalle de ventas', titulo: 'Detalle de ventas (agrupado por cliente)', tablas: [tDetalle] },
      ];

      // ---- productos vendidos
      var notas = [
        'Venta neta = Total − IVA, igual que la pantalla de Ventas. Las devoluciones aparecen en negativo y ya están restadas.',
        'Cada importe se convierte a la moneda de visualización y se redondea a 2 decimales antes de sumar; la diferencia con la pantalla puede ser de centavos.',
      ];
      if (op.lineas === 'si') {
        var ids = filas.filter(function (r) { return !r.esDev; }).map(function (r) { return r.id; });
        var idsOk = {}; filas.forEach(function (r) { idsOk[r.id] = r; });
        var dets = ids.length ? await E.leerPorIds(ids, function (parte) {
          return ctx.sb.from('venta_detalles').select('id,venta_id,producto_nombre,producto_sku,cantidad,precio,descuento,subtotal,ganancia,es_regalia,presentacion_nombre')
            .eq('auth_user_id', ctx.userId).in('venta_id', parte);
        }, 'productos vendidos') : [];
        var lineas = dets.map(function (x) {
          var vr = idsOk[x.venta_id] || {};
          return { cliente: vr.cliente || '', fecha: vr.fecha || '', numero: vr.numero || '', producto: (x.producto_nombre || '—') + (x.presentacion_nombre ? ' (' + x.presentacion_nombre + ')' : ''), sku: x.producto_sku || '',
            cantidad: E.num(x.cantidad), precio: E.r2(E.cv(x.precio)), descuento: E.r2(E.cv(x.descuento || 0)), subtotal: E.r2(E.cv(x.subtotal)), ganancia: E.r2(E.cv(x.ganancia || 0)), regalia: x.es_regalia ? 'Sí' : '' };
        }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (a.numero < b.numero ? 1 : -1); });
        var mp = {};
        lineas.forEach(function (l) { var o = mp[l.producto] || (mp[l.producto] = { producto: l.producto, sku: l.sku, cantidad: 0, subtotal: 0, ganancia: 0 }); o.cantidad = Math.round((o.cantidad + l.cantidad) * 1000) / 1000; o.subtotal = E.r2(o.subtotal + l.subtotal); o.ganancia = E.r2(o.ganancia + l.ganancia); });
        var porProd = Object.keys(mp).map(function (k) { return mp[k]; }).sort(function (a, b) { return b.subtotal - a.subtotal; });
        hojas.push({ nombre: 'Por producto', titulo: 'Productos vendidos (acumulado)', tablas: [{
          etiquetaTotal: 'TOTAL', sumar: ['cantidad', 'subtotal', 'ganancia'], filas: porProd,
          columnas: [{ k: 'producto', t: 'Producto', w: 40 }, { k: 'sku', t: 'SKU', w: 16 }, { k: 'cantidad', t: 'Cantidad', w: 12, num: true, cant: true }, { k: 'subtotal', t: 'Importe', w: 16, num: true, din: true }, { k: 'ganancia', t: 'Ganancia', w: 16, num: true, din: true }] }] });
        hojas.push({ nombre: 'Líneas de productos', titulo: 'Líneas de productos vendidos', pdf: false, tablas: [{
          etiquetaTotal: 'TOTAL', sumar: ['cantidad', 'subtotal', 'ganancia'], filas: lineas,
          columnas: [{ k: 'fecha', t: 'Fecha', w: 12, fecha: true }, { k: 'numero', t: 'No. venta', w: 18 }, { k: 'cliente', t: 'Cliente', w: 28 }, { k: 'producto', t: 'Producto', w: 38 }, { k: 'sku', t: 'SKU', w: 14 },
            { k: 'cantidad', t: 'Cantidad', w: 11, num: true, cant: true }, { k: 'precio', t: 'Precio', w: 14, num: true, din: true }, { k: 'descuento', t: 'Descuento', w: 13, num: true, din: true },
            { k: 'subtotal', t: 'Importe', w: 15, num: true, din: true }, { k: 'ganancia', t: 'Ganancia', w: 15, num: true, din: true }, { k: 'regalia', t: 'Regalía', w: 9 }] }] });
        notas.push('El importe de las líneas es antes de descuento general e IVA de la venta, por eso puede diferir de la venta neta.');
      }

      return {
        kpis: kpis, resumenTablas: resumenTablas, hojas: hojas, notas: notas,
        totalGeneral: [['Ventas netas (sin IVA)', E.dinero(T.neto)], ['IVA', E.dinero(T.imp)], ['TOTAL CON IVA', E.dinero(T.total)]],
        mensajeOk: nVentas + ' ventas',
      };
    },
  };

  function fc(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }

  // Aplica los filtros a las filas cargadas. sinClientes=true: ignora la selección de clientes (para listarlos)
  function filtrar(d, op, sinClientes) {
    var sel = {}; (op.entidades || []).forEach(function (k) { sel[k] = 1; });
    var haySel = !sinClientes && (op.entidades || []).length > 0;
    var est = op.estado || 'completada';
    var out = [];
    d.ventas.forEach(function (v) {
      if (est !== 'todas' && v.estado !== est) return;
      out.push(v);
    });
    if (est !== 'anulada' && !op.metodo) out = out.concat(d.devs);
    return out.filter(function (v) {
      if (op.pago === 'contado' && esCredito(v)) return false;
      if (op.pago === 'credito' && !esCredito(v)) return false;
      if (op.vendedor && v.creado_por_nombre !== op.vendedor) return false;
      if (op.metodo && v.metodo_pago_nombre !== op.metodo) return false;
      if (haySel && !sel[claveCliente(v)]) return false;
      return true;
    });
  }
  function totales(f, E) {
    var t = { n: 0, nDev: 0, neto: 0, total: 0, ganancia: 0 };
    f.forEach(function (v) {
      if (v.es_devolucion) t.nDev++; else t.n++;
      var total = E.r2(E.cv(v.total)), imp = E.r2(E.cv(v.impuesto || 0));
      t.total = E.r2(t.total + total); t.neto = E.r2(t.neto + total - imp); t.ganancia = E.r2(t.ganancia + E.r2(E.cv(v.ganancia || 0)));
    });
    return t;
  }

  window.abrirExportarVentas = function () {
    if (!window.N360Exp) { try { showToast('El exportador no cargó. Recarga la página.', 'error'); } catch (e) {} return; }
    N360Exp.abrir(cfg, { sb: sb, userId: S.userId, empresaConfig: S.empresaConfig });
  };
  window._cfgExportarVentas = cfg;
})();
