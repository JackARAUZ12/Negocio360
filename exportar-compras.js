/* =====================================================
   EXPORTAR-COMPRAS.JS — Negocio360
   "Exportar" del módulo Compras (Excel + PDF) con el motor N360Exp.
   Solo LEE. Los totales usan la misma regla que la pantalla de Compras:
   se suma el "total" de las compras que no están anuladas.
   Hojas: Resumen · Por proveedor · Detalle de compras · Por producto · Líneas de productos.
===================================================== */
(function () {
  'use strict';

  function claveProv(c) { return c.proveedor_id ? 'p:' + c.proveedor_id : 'n:' + (c.proveedor_nombre || ''); }
  function nombreProv(c) { return c.proveedor_nombre || 'Sin proveedor'; }
  function d10(x) { return String(x || '').slice(0, 10); }
  function fc(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }

  var cfg = {
    titulo: 'Reporte de compras',
    archivo: 'Compras',
    pdfOrientacion: 'landscape',
    ayuda: 'Compras a proveedores con subtotales por proveedor y totales. Los totales usan la regla de la pantalla de Compras (las anuladas no suman). Solo lee la información.',
    filtros: [
      { tipo: 'periodo', etiqueta: 'Período', def: 'mes' },
      { tipo: 'radio', k: 'estado', etiqueta: 'Estado', def: 'activas', opciones: [['activas', 'Activas (sin anuladas)'], ['anulada', 'Anuladas'], ['todas', 'Todas']] },
      { tipo: 'radio', k: 'tipo', etiqueta: 'Tipo de compra', def: 'todas', opciones: [['todas', 'Todas'], ['productos', 'De productos'], ['directas', 'Directas (gasto)']] },
      { tipo: 'select', k: 'metodo', etiqueta: 'Forma de pago', opciones: function (d) { var s = {}; d.compras.forEach(function (c) { if (c.metodo_pago_nombre) s[c.metodo_pago_nombre] = 1; }); return [['', 'Todas las formas de pago']].concat(Object.keys(s).sort().map(function (x) { return [x, x]; })); } },
      { tipo: 'radio', k: 'lineas', etiqueta: 'Productos comprados (hojas por producto y líneas)', def: 'si', opciones: [['si', 'Incluir'], ['no', 'No incluir']] },
    ],
    entidad: {
      etiqueta: 'Proveedores (déjalo vacío para incluir a todos)',
      vacio: 'No hay compras en ese período.',
      lista: function (d, op) {
        var m = {};
        filtrar(d, Object.assign({}, op, { entidades: [] })).forEach(function (c) { var k = claveProv(c); var o = m[k] || (m[k] = { id: k, nombre: nombreProv(c), n: 0 }); o.n++; });
        return Object.keys(m).map(function (k) { return { id: m[k].id, nombre: m[k].nombre, extra: m[k].n + ' compra' + (m[k].n === 1 ? '' : 's') }; }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
      },
    },

    cargar: async function (ctx, op, E) {
      var compras = await E.leerTodo(function () {
        return ctx.sb.from('compras').select('id,numero,proveedor_id,proveedor_nombre,fecha,subtotal,descuento_total,iva_monto,total,metodo_pago_nombre,estado,es_directa,concepto,usuario_nombre')
          .eq('auth_user_id', ctx.userId).gte('fecha', op.desde).lte('fecha', op.hasta);
      }, 'compras');
      return { compras: compras };
    },

    vista: function (d, op, E) {
      var f = filtrar(d, op);
      var total = E.r2(f.reduce(function (s, c) { return s + E.r2(E.cv(c.total)); }, 0));
      return '<b>' + f.length + '</b> compra' + (f.length === 1 ? '' : 's') + '<br>Total comprado: <b>' + E.dinero(total) + '</b>';
    },

    textoFiltros: function (op) {
      var p = ['Período: ' + (op.desde === op.hasta ? fc(op.desde) : fc(op.desde) + ' al ' + fc(op.hasta))];
      p.push('Estado: ' + ({ activas: 'activas (sin anuladas)', anulada: 'anuladas', todas: 'todas' }[op.estado] || ''));
      if (op.tipo && op.tipo !== 'todas') p.push('Tipo: ' + (op.tipo === 'directas' ? 'directas' : 'de productos'));
      if (op.metodo) p.push('Forma de pago: ' + op.metodo);
      if (op.entidades && op.entidades.length) p.push('Proveedores seleccionados: ' + op.entidades.length);
      return p.join('  ·  ');
    },

    armar: async function (d, op, E, ctx) {
      var f = filtrar(d, op);
      if (!f.length) return { vacio: true, mensajeVacio: 'No hay compras que cumplan esos filtros.' };
      var filas = f.map(function (c) {
        return { id: c.id, fecha: d10(c.fecha), numero: c.numero || '', prov: nombreProv(c), pkey: claveProv(c), metodo: c.metodo_pago_nombre || '—', estado: c.estado === 'anulada' ? 'Anulada' : (c.estado === 'pendiente' ? 'Pendiente' : 'Completada'),
          tipo: c.es_directa ? 'Directa' : 'Productos', concepto: c.concepto || '', usuario: c.usuario_nombre || '—',
          subtotal: E.r2(E.cv(c.subtotal || 0)), descuento: E.r2(E.cv(c.descuento_total || 0)), iva: E.r2(E.cv(c.iva_monto || 0)), total: E.r2(E.cv(c.total || 0)), anulada: c.estado === 'anulada' };
      }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (a.numero < b.numero ? 1 : -1); });
      var sum = function (arr, k) { return E.r2(arr.reduce(function (s, r) { return s + E.num(r[k]); }, 0)); };
      var T = { sub: sum(filas, 'subtotal'), desc: sum(filas, 'descuento'), iva: sum(filas, 'iva'), total: sum(filas, 'total') };
      var activas = filas.filter(function (r) { return !r.anulada; });
      var nProv = {}; filas.forEach(function (r) { nProv[r.pkey] = 1; });
      var kpi = function (t, n, extra) { var o = { t: t, num: n, v: E.dinero(n), din: true }; if (extra) for (var k in extra) o[k] = extra[k]; return o; };
      var kpis = [
        { t: 'Cantidad de compras', num: filas.length, v: String(filas.length) },
        { t: 'Proveedores', num: Object.keys(nProv).length, v: String(Object.keys(nProv).length) },
        kpi('Total comprado', T.total, { fuerte: true }),
        kpi('Compra promedio', filas.length ? E.r2(T.total / filas.length) : 0),
        kpi('Subtotal', T.sub), kpi('IVA', T.iva), kpi('Descuentos', T.desc),
        { t: 'Anuladas incluidas', num: filas.length - activas.length, v: String(filas.length - activas.length), rojo: filas.length - activas.length > 0 },
      ];

      function agrupa(clave) {
        var m = {};
        filas.forEach(function (r) { var k = r[clave]; var o = m[k] || (m[k] = { g: k, n: 0, subtotal: 0, iva: 0, total: 0 }); o.n++; o.subtotal = E.r2(o.subtotal + r.subtotal); o.iva = E.r2(o.iva + r.iva); o.total = E.r2(o.total + r.total); });
        return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.total - a.total; });
      }
      function colsRes(t) { return [{ k: 'g', t: t, w: 32 }, { k: 'n', t: '# compras', w: 11, num: true }, { k: 'subtotal', t: 'Subtotal', w: 16, num: true, din: true }, { k: 'iva', t: 'IVA', w: 14, num: true, din: true }, { k: 'total', t: 'Total', w: 17, num: true, din: true }]; }
      var S = ['n', 'subtotal', 'iva', 'total'];
      var resumenTablas = [
        { subtitulo: 'Por forma de pago', columnas: colsRes('Forma de pago'), filas: agrupa('metodo'), sumar: S },
        { subtitulo: 'Por estado', columnas: colsRes('Estado'), filas: agrupa('estado'), sumar: S },
      ];
      var tProv = { etiquetaTotal: 'TOTAL', sumar: S, filas: agrupa('prov'), columnas: colsRes('Proveedor') };
      var tDet = { etiquetaTotal: 'TOTAL GENERAL', agrupar: { k: 'prov', etiqueta: 'Subtotal proveedor' }, sumar: ['subtotal', 'descuento', 'iva', 'total'],
        filas: filas.slice().sort(function (a, b) { return a.prov.localeCompare(b.prov) || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0); }),
        columnas: [{ k: 'prov', t: 'Proveedor', w: 28 }, { k: 'fecha', t: 'Fecha', w: 12, fecha: true }, { k: 'numero', t: 'No. compra', w: 16 }, { k: 'tipo', t: 'Tipo', w: 11 }, { k: 'metodo', t: 'Forma de pago', w: 18 }, { k: 'estado', t: 'Estado', w: 12, rojo: 'anulada' },
          { k: 'usuario', t: 'Registró', w: 16, p: false }, { k: 'concepto', t: 'Concepto', w: 26, wrap: true, p: false },
          { k: 'subtotal', t: 'Subtotal', w: 15, num: true, din: true }, { k: 'descuento', t: 'Descuento', w: 13, num: true, din: true }, { k: 'iva', t: 'IVA', w: 13, num: true, din: true }, { k: 'total', t: 'Total', w: 16, num: true, din: true, rojo: 'anulada' }] };
      var hojas = [{ nombre: 'Por proveedor', titulo: 'Compras por proveedor', tablas: [tProv] }, { nombre: 'Detalle de compras', titulo: 'Detalle de compras (agrupado por proveedor)', tablas: [tDet] }];
      var notas = ['Total = suma del total de cada compra (incluye IVA), igual que la pantalla de Compras.',
        'Cada importe se convierte a la moneda de visualización y se redondea a 2 decimales antes de sumar; la diferencia con la pantalla puede ser de centavos.'];
      if (op.estado === 'todas' && filas.length - activas.length > 0) notas.push('Las compras anuladas están incluidas porque elegiste "Todas": suman al total de este reporte, pero no suman en la pantalla.');

      if (op.lineas === 'si') {
        var ids = filas.filter(function (r) { return r.tipo === 'Productos'; }).map(function (r) { return r.id; });
        var porId = {}; filas.forEach(function (r) { porId[r.id] = r; });
        var dets = ids.length ? await E.leerPorIds(ids, function (parte) {
          return ctx.sb.from('detalle_compras').select('id,compra_id,producto_nombre,producto_sku,cantidad,costo_unitario,descuento,iva_monto,subtotal,es_regalia').eq('auth_user_id', ctx.userId).in('compra_id', parte);
        }, 'detalle de compras') : [];
        var lineas = dets.map(function (x) {
          var c = porId[x.compra_id] || {};
          return { fecha: c.fecha || '', numero: c.numero || '', prov: c.prov || '', producto: x.producto_nombre || '—', sku: x.producto_sku || '', cantidad: E.num(x.cantidad), costo: E.r2(E.cv(x.costo_unitario)), descuento: E.r2(E.cv(x.descuento || 0)), iva: E.r2(E.cv(x.iva_monto || 0)), subtotal: E.r2(E.cv(x.subtotal)), regalia: x.es_regalia ? 'Sí' : '' };
        }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (a.numero < b.numero ? 1 : -1); });
        var mp = {};
        lineas.forEach(function (l) { var o = mp[l.producto] || (mp[l.producto] = { producto: l.producto, sku: l.sku, cantidad: 0, subtotal: 0 }); o.cantidad = Math.round((o.cantidad + l.cantidad) * 1000) / 1000; o.subtotal = E.r2(o.subtotal + l.subtotal); });
        var porProd = Object.keys(mp).map(function (k) { return mp[k]; }).sort(function (a, b) { return b.subtotal - a.subtotal; });
        hojas.push({ nombre: 'Por producto', titulo: 'Productos comprados (acumulado)', tablas: [{ etiquetaTotal: 'TOTAL', sumar: ['cantidad', 'subtotal'], filas: porProd,
          columnas: [{ k: 'producto', t: 'Producto', w: 40 }, { k: 'sku', t: 'SKU', w: 16 }, { k: 'cantidad', t: 'Cantidad', w: 12, num: true, cant: true }, { k: 'subtotal', t: 'Importe (sin IVA)', w: 18, num: true, din: true }] }] });
        hojas.push({ nombre: 'Líneas de productos', titulo: 'Líneas de productos comprados', pdf: false, tablas: [{ etiquetaTotal: 'TOTAL', sumar: ['cantidad', 'subtotal'], filas: lineas,
          columnas: [{ k: 'fecha', t: 'Fecha', w: 12, fecha: true }, { k: 'numero', t: 'No. compra', w: 16 }, { k: 'prov', t: 'Proveedor', w: 26 }, { k: 'producto', t: 'Producto', w: 38 }, { k: 'sku', t: 'SKU', w: 14 }, { k: 'cantidad', t: 'Cantidad', w: 11, num: true, cant: true },
            { k: 'costo', t: 'Costo unit.', w: 14, num: true, din: true }, { k: 'descuento', t: 'Descuento', w: 13, num: true, din: true }, { k: 'iva', t: 'IVA', w: 13, num: true, din: true }, { k: 'subtotal', t: 'Importe', w: 15, num: true, din: true }, { k: 'regalia', t: 'Regalía', w: 9 }] }] });
        notas.push('El importe de las líneas es el subtotal por producto (sin IVA general ni descuentos de la compra).');
      }
      return { kpis: kpis, resumenTablas: resumenTablas, hojas: hojas, notas: notas,
        totalGeneral: [['Subtotal', E.dinero(T.sub)], ['IVA', E.dinero(T.iva)], ['TOTAL COMPRADO', E.dinero(T.total)]], mensajeOk: filas.length + ' compras' };
    },
  };

  function filtrar(d, op) {
    var sel = {}; (op.entidades || []).forEach(function (k) { sel[k] = 1; }); var haySel = (op.entidades || []).length > 0;
    return d.compras.filter(function (c) {
      if (op.estado === 'activas' && c.estado === 'anulada') return false;
      if (op.estado === 'anulada' && c.estado !== 'anulada') return false;
      if (op.tipo === 'productos' && c.es_directa) return false;
      if (op.tipo === 'directas' && !c.es_directa) return false;
      if (op.metodo && c.metodo_pago_nombre !== op.metodo) return false;
      if (haySel && !sel[claveProv(c)]) return false;
      return true;
    });
  }

  window.abrirExportarCompras = function () {
    if (!window.N360Exp) { try { showToast('El exportador no cargó. Recarga la página.', 'error'); } catch (e) {} return; }
    N360Exp.abrir(cfg, { sb: sbClient, userId: STATE.userId, empresaConfig: STATE.empresaConfig });
  };
  window._cfgExportarCompras = cfg;
})();
