/* =====================================================
   EXPORTAR-SERIES.JS — Negocio360
   Reporte "Series y garantías de proveedor" (Excel + PDF) con el motor N360Exp.
   Solo LEE. Cuenta unidades (series), no dinero: no afecta ni se compara con caja/contabilidad.
   Hojas: Resumen · Por proveedor · Detalle de series · Garantías por vencer · Reclamos.
===================================================== */
(function () {
  'use strict';
  var ESTADOS = { en_stock: 'En stock', vendida: 'Vendida', en_reclamo: 'En reclamo', devuelta_proveedor: 'Devuelta al proveedor' };
  var RECL = { abierto: 'Abierto', enviado: 'Enviado al proveedor', aprobado: 'Aprobado', resuelto: 'Resuelto', rechazado: 'Rechazado' };
  function d10(x) { return String(x || '').slice(0, 10); }
  function fc(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dias(iso) { return Math.round((new Date(iso + 'T12:00:00') - new Date(hoyISO() + 'T12:00:00')) / 86400000); }
  function vig(r) { // vigencia de la garantía del proveedor
    if (!r.vence) return 'sin';
    var d = dias(r.vence); return d < 0 ? 'vencida' : (d <= 30 ? 'pronto' : 'vigente');
  }
  var VIG = { sin: 'Sin garantía registrada', vencida: 'Vencida', pronto: 'Vence en 30 días', vigente: 'Vigente' };
  function provNombre(r) { return r.proveedor_nombre || 'Sin proveedor'; }
  function provClave(r) { return r.proveedor_id ? 'p:' + r.proveedor_id : 'n:' + (r.proveedor_nombre || ''); }

  var cfg = {
    titulo: 'Series y garantías de proveedor',
    archivo: 'Series_garantias',
    pdfOrientacion: 'landscape',
    ayuda: 'Series registradas con su proveedor y la garantía del proveedor, con alertas de vencimiento y reclamos. Cuenta unidades (no dinero). Solo lee la información.',
    filtros: [
      { tipo: 'periodo', etiqueta: 'Fecha de compra', def: 'todo', permiteTodo: true },
      { tipo: 'radio', k: 'estado', etiqueta: 'Estado de la serie', def: 'todas', opciones: [['todas', 'Todas'], ['en_stock', 'En stock'], ['vendida', 'Vendidas'], ['en_reclamo', 'En reclamo'], ['devuelta_proveedor', 'Devueltas al proveedor']] },
      { tipo: 'radio', k: 'garantia', etiqueta: 'Garantía del proveedor', def: 'todas', opciones: [['todas', 'Todas'], ['vigente', 'Vigentes'], ['pronto', 'Vencen en 30 días'], ['vencida', 'Vencidas'], ['sin', 'Sin garantía registrada']] },
      { tipo: 'select', k: 'producto', etiqueta: 'Producto', opciones: function (d) { var m = {}; d.series.forEach(function (r) { m[r.producto_id] = d.prods[r.producto_id] || '—'; }); return [['', 'Todos los productos']].concat(Object.keys(m).sort(function (a, b) { return m[a].localeCompare(m[b]); }).map(function (k) { return [k, m[k]]; })); } },
    ],
    entidad: {
      etiqueta: 'Proveedores (déjalo vacío para incluir a todos)',
      vacio: 'No hay series registradas con esos filtros.',
      lista: function (d, op) {
        var m = {};
        filtrar(d, Object.assign({}, op, { entidades: [] })).forEach(function (r) { var k = provClave(r); var o = m[k] || (m[k] = { id: k, nombre: provNombre(r), n: 0 }); o.n++; });
        return Object.keys(m).map(function (k) { return { id: m[k].id, nombre: m[k].nombre, extra: m[k].n + ' serie' + (m[k].n === 1 ? '' : 's') }; }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
      },
    },

    cargar: async function (ctx, op, E) {
      var series = await E.leerTodo(function () {
        return ctx.sb.from('numeros_serie').select('id,producto_id,numero_serie,estado,compra_id,proveedor_id,proveedor_nombre,fecha_compra,garantia_proveedor_meses,garantia_proveedor_vence,cliente_id,fecha_venta').eq('auth_user_id', ctx.userId).not('estado', 'is', null);
      }, 'series');
      var reclamos = await E.leerTodo(function () { return ctx.sb.from('reclamos_proveedor').select('*').eq('auth_user_id', ctx.userId); }, 'reclamos');
      var prods = {}, comp = {}, cli = {};
      function ids(arr, k) { var s = {}; arr.forEach(function (r) { if (r[k]) s[r[k]] = 1; }); return Object.keys(s); }
      var pi = ids(series, 'producto_id');
      if (pi.length) (await E.leerPorIds(pi, function (parte) { return ctx.sb.from('productos').select('id,nombre').eq('auth_user_id', ctx.userId).in('id', parte); }, 'productos')).forEach(function (p) { prods[p.id] = p.nombre; });
      var ci = ids(series, 'compra_id');
      if (ci.length) (await E.leerPorIds(ci, function (parte) { return ctx.sb.from('compras').select('id,numero').eq('auth_user_id', ctx.userId).in('id', parte); }, 'compras')).forEach(function (c) { comp[c.id] = c.numero; });
      var li = ids(series, 'cliente_id');
      if (li.length) (await E.leerPorIds(li, function (parte) { return ctx.sb.from('clientes').select('id,nombre,apellido').eq('auth_user_id', ctx.userId).in('id', parte); }, 'clientes')).forEach(function (c) { cli[c.id] = ((c.nombre || '') + ' ' + (c.apellido || '')).trim(); });
      series.forEach(function (r) { r.vence = d10(r.garantia_proveedor_vence); });
      return { series: series, reclamos: reclamos, prods: prods, comp: comp, cli: cli };
    },

    vista: function (d, op) {
      var f = filtrar(d, op), p = f.filter(function (r) { return vig(r) === 'pronto'; }).length, v = f.filter(function (r) { return vig(r) === 'vencida'; }).length;
      return '<b>' + f.length + '</b> serie' + (f.length === 1 ? '' : 's') + '<br>Garantía vence en 30 días: <b>' + p + '</b> · vencida: <b>' + v + '</b>';
    },

    textoFiltros: function (op) {
      var p = [op.desde ? 'Compra del ' + fc(op.desde) + ' al ' + fc(op.hasta) : 'Todo el historial'];
      if (op.estado && op.estado !== 'todas') p.push('Estado: ' + ESTADOS[op.estado]);
      if (op.garantia && op.garantia !== 'todas') p.push('Garantía proveedor: ' + VIG[op.garantia]);
      if (op.entidades && op.entidades.length) p.push('Proveedores seleccionados: ' + op.entidades.length);
      return p.join('  ·  ');
    },

    armar: async function (d, op, E) {
      var f = filtrar(d, op);
      if (!f.length) return { vacio: true, mensajeVacio: 'No hay series que cumplan esos filtros.' };
      var filas = f.map(function (r) {
        var v = vig(r);
        return { prov: provNombre(r), producto: d.prods[r.producto_id] || '—', serie: r.numero_serie, estado: ESTADOS[r.estado] || r.estado, compra: d.comp[r.compra_id] || (r.fecha_compra ? 'Inventario' : ''), fcompra: d10(r.fecha_compra),
          meses: r.garantia_proveedor_meses ? E.num(r.garantia_proveedor_meses) : null, vence: r.vence, dias: r.vence ? dias(r.vence) : null, vigencia: VIG[v], v: v, cliente: r.estado === 'vendida' ? (d.cli[r.cliente_id] || 'Sin cliente') : '', fventa: d10(r.fecha_venta), u: 1 };
      }).sort(function (a, b) { return a.prov.localeCompare(b.prov) || a.producto.localeCompare(b.producto) || a.serie.localeCompare(b.serie); });
      var cuenta = function (fn) { return filas.filter(fn).length; };
      var abiertos = d.reclamos.filter(function (x) { return x.estado !== 'resuelto' && x.estado !== 'rechazado'; }).length;
      var kpis = [
        { t: 'Series registradas', num: filas.length, v: String(filas.length), fuerte: true },
        { t: 'En stock', num: cuenta(function (r) { return r.estado === 'En stock'; }), v: String(cuenta(function (r) { return r.estado === 'En stock'; })) },
        { t: 'Vendidas', num: cuenta(function (r) { return r.estado === 'Vendida'; }), v: String(cuenta(function (r) { return r.estado === 'Vendida'; })) },
        { t: 'En reclamo', num: cuenta(function (r) { return r.estado === 'En reclamo'; }), v: String(cuenta(function (r) { return r.estado === 'En reclamo'; })) },
        { t: 'Garantía vence en 30 días', num: cuenta(function (r) { return r.v === 'pronto'; }), v: String(cuenta(function (r) { return r.v === 'pronto'; })), rojo: cuenta(function (r) { return r.v === 'pronto'; }) > 0 },
        { t: 'Garantía vencida', num: cuenta(function (r) { return r.v === 'vencida'; }), v: String(cuenta(function (r) { return r.v === 'vencida'; })) },
        { t: 'Reclamos abiertos (todos)', num: abiertos, v: String(abiertos) },
      ];
      function agrupa(clave) {
        var m = {}; filas.forEach(function (r) { var k = r[clave]; var o = m[k] || (m[k] = { g: k, u: 0 }); o.u++; });
        return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.u - a.u; });
      }
      var cols = function (t) { return [{ k: 'g', t: t, w: 34 }, { k: 'u', t: 'Series', w: 12, num: true, cant: true }]; };
      var resumenTablas = [
        { subtitulo: 'Por estado', columnas: cols('Estado'), filas: agrupa('estado'), sumar: ['u'] },
        { subtitulo: 'Garantía del proveedor', columnas: cols('Vigencia'), filas: agrupa('vigencia'), sumar: ['u'] },
      ];
      var tProv = { etiquetaTotal: 'TOTAL', sumar: ['u'], filas: agrupa('prov'), columnas: cols('Proveedor') };
      var tDet = { etiquetaTotal: 'TOTAL SERIES', agrupar: { k: 'prov', etiqueta: 'Subtotal proveedor' }, sumar: ['u'], filas: filas,
        columnas: [{ k: 'prov', t: 'Proveedor', w: 24 }, { k: 'producto', t: 'Producto', w: 28 }, { k: 'serie', t: 'Serie', w: 20 }, { k: 'estado', t: 'Estado', w: 16 }, { k: 'compra', t: 'Compra', w: 14 }, { k: 'fcompra', t: 'Fecha compra', w: 12, fecha: true },
          { k: 'meses', t: 'Meses garantía', w: 10, num: true, cant: true, p: false }, { k: 'vence', t: 'Vence garantía', w: 13, fecha: true }, { k: 'vigencia', t: 'Vigencia', w: 20, rojo: 'vencida' },
          { k: 'cliente', t: 'Cliente', w: 22, p: false }, { k: 'fventa', t: 'Fecha venta', w: 12, fecha: true, p: false }, { k: 'u', t: 'Series', w: 8, num: true, cant: true }] };
      var hojas = [{ nombre: 'Por proveedor', titulo: 'Series por proveedor', tablas: [tProv] }, { nombre: 'Detalle de series', titulo: 'Detalle de series (agrupado por proveedor)', tablas: [tDet] }];
      var porVencer = filas.filter(function (r) { return r.v === 'pronto' || r.v === 'vencida'; }).sort(function (a, b) { return String(a.vence) < String(b.vence) ? -1 : 1; });
      if (porVencer.length) hojas.push({ nombre: 'Garantías por vencer', titulo: 'Garantías del proveedor por vencer o vencidas', tablas: [{ etiquetaTotal: 'TOTAL', sumar: ['u'], filas: porVencer,
        columnas: [{ k: 'vence', t: 'Vence', w: 12, fecha: true }, { k: 'dias', t: 'Días', w: 8, num: true, cant: true }, { k: 'serie', t: 'Serie', w: 20 }, { k: 'producto', t: 'Producto', w: 28 }, { k: 'prov', t: 'Proveedor', w: 24 }, { k: 'estado', t: 'Estado', w: 16 }, { k: 'u', t: 'Series', w: 8, num: true, cant: true }] }] });
      var provPorSerie = {}; d.series.forEach(function (r) { provPorSerie[r.id] = provNombre(r); });
      var rec = d.reclamos.slice().sort(function (a, b) { return String(b.fecha_reclamo) < String(a.fecha_reclamo) ? -1 : 1; }).map(function (x) {
        return { numero: x.numero || '', fecha: d10(x.fecha_reclamo), serie: x.numero_serie || '', producto: x.producto_nombre || '', prov: x.proveedor_nombre || '—', falla: x.descripcion || '', estado: RECL[x.estado] || x.estado, resultado: x.resultado || '', cierre: d10(x.fecha_cierre), u: 1 };
      });
      if (rec.length) hojas.push({ nombre: 'Reclamos', titulo: 'Reclamos al proveedor (todos)', tablas: [{ etiquetaTotal: 'TOTAL RECLAMOS', sumar: ['u'], filas: rec,
        columnas: [{ k: 'numero', t: 'No.', w: 12 }, { k: 'fecha', t: 'Fecha', w: 12, fecha: true }, { k: 'serie', t: 'Serie', w: 18 }, { k: 'producto', t: 'Producto', w: 24 }, { k: 'prov', t: 'Proveedor', w: 22 }, { k: 'falla', t: 'Falla', w: 28, wrap: true }, { k: 'estado', t: 'Estado', w: 18 }, { k: 'resultado', t: 'Resultado', w: 12, p: false }, { k: 'cierre', t: 'Cierre', w: 12, fecha: true, p: false }, { k: 'u', t: 'Reclamos', w: 10, num: true, cant: true }] }] });
      var notas = ['Este reporte cuenta unidades (series), no dinero: no se compara con caja ni contabilidad.',
        'Solo incluye series registradas desde compras o inventario. Las series escritas a mano en ventas antiguas no tienen proveedor ni garantía del proveedor.',
        'La vigencia se calcula con la fecha de hoy (' + fc(hoyISO()) + '). "Vence en 30 días" = faltan 30 días o menos.',
        'La hoja de Reclamos muestra todos los reclamos del negocio (no depende del filtro de series).'];
      return { kpis: kpis, resumenTablas: resumenTablas, hojas: hojas, notas: notas, totalGeneral: [['Series registradas', String(filas.length)]], mensajeOk: filas.length + ' series' };
    },
  };

  function filtrar(d, op) {
    var sel = {}; (op.entidades || []).forEach(function (k) { sel[k] = 1; }); var haySel = (op.entidades || []).length > 0;
    return d.series.filter(function (r) {
      if (op.desde && (!r.fecha_compra || d10(r.fecha_compra) < op.desde || d10(r.fecha_compra) > op.hasta)) return false;
      if (op.estado && op.estado !== 'todas' && r.estado !== op.estado) return false;
      if (op.garantia && op.garantia !== 'todas' && vig(r) !== op.garantia) return false;
      if (op.producto && r.producto_id !== op.producto) return false;
      if (haySel && !sel[provClave(r)]) return false;
      return true;
    });
  }

  window.abrirExportarSeries = function (ctx) {
    if (!window.N360Exp) { try { showToast('El exportador no cargó. Recarga la página.', 'error'); } catch (e) {} return; }
    N360Exp.abrir(cfg, ctx);
  };
  window._cfgExportarSeries = cfg;
})();
