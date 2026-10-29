/* =====================================================
   EXPORTAR-GASTOS.JS — Negocio360
   "Exportar" del módulo Gastos (Excel + PDF) con el motor N360Exp.
   Solo LEE. El total suma el "monto" de los gastos activos, igual que los
   indicadores de la pantalla (los cancelados no suman).
   Hojas: Resumen · Por categoría · Detalle de gastos (subtotal por categoría) · Por empleado · Por mes.
===================================================== */
(function () {
  'use strict';

  function d10(x) { return String(x || '').slice(0, 10); }
  function fc(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function lista(d, k, rotulo) { var s = {}; d.gastos.forEach(function (g) { if (g[k]) s[g[k]] = 1; }); return [['', rotulo]].concat(Object.keys(s).sort().map(function (x) { return [x, x]; })); }

  var cfg = {
    titulo: 'Reporte de gastos',
    archivo: 'Gastos',
    pdfOrientacion: 'landscape',
    ayuda: 'Egresos del negocio por categoría, empleado y mes. Los totales usan la regla de la pantalla de Gastos (los cancelados no suman). Solo lee la información.',
    filtros: [
      { tipo: 'periodo', etiqueta: 'Período', def: 'mes' },
      { tipo: 'radio', k: 'estado', etiqueta: 'Estado', def: 'activo', opciones: [['activo', 'Activos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']] },
      { tipo: 'radio', k: 'tipo', etiqueta: 'Tipo', def: 'todos', opciones: [['todos', 'Todos'], ['inmediato', 'Inmediatos'], ['programado', 'Programados / recurrentes']] },
      { tipo: 'select', k: 'categoria', etiqueta: 'Categoría', opciones: function (d) { return lista(d, 'categoria', 'Todas las categorías'); } },
      { tipo: 'select', k: 'metodo', etiqueta: 'Forma de pago', opciones: function (d) { return lista(d, 'metodo_pago_nombre', 'Todas las formas de pago'); } },
      { tipo: 'select', k: 'empleado', etiqueta: 'Empleado / beneficiario', opciones: function (d) { return lista(d, 'empleado', 'Todos'); } },
    ],

    cargar: async function (ctx, op, E) {
      var gastos = await E.leerTodo(function () {
        return ctx.sb.from('gastos').select('id,tipo,concepto,categoria,monto,fecha,metodo_pago_nombre,observaciones,empleado,estado,impuesto,retencion_ir_monto')
          .eq('auth_user_id', ctx.userId).gte('fecha', op.desde).lte('fecha', op.hasta);
      }, 'gastos');
      return { gastos: gastos };
    },

    vista: function (d, op, E) {
      var f = filtrar(d, op), t = E.r2(f.reduce(function (s, g) { return s + E.r2(E.cv(g.monto)); }, 0));
      return '<b>' + f.length + '</b> gasto' + (f.length === 1 ? '' : 's') + '<br>Total: <b>' + E.dinero(t) + '</b>';
    },

    textoFiltros: function (op) {
      var p = ['Período: ' + (op.desde === op.hasta ? fc(op.desde) : fc(op.desde) + ' al ' + fc(op.hasta))];
      p.push('Estado: ' + ({ activo: 'activos', cancelado: 'cancelados', todos: 'todos' }[op.estado] || ''));
      if (op.tipo && op.tipo !== 'todos') p.push('Tipo: ' + op.tipo);
      if (op.categoria) p.push('Categoría: ' + op.categoria);
      if (op.metodo) p.push('Forma de pago: ' + op.metodo);
      if (op.empleado) p.push('Empleado: ' + op.empleado);
      return p.join('  ·  ');
    },

    armar: async function (d, op, E) {
      var f = filtrar(d, op);
      if (!f.length) return { vacio: true, mensajeVacio: 'No hay gastos que cumplan esos filtros.' };
      var filas = f.map(function (g) {
        var cancel = g.estado !== 'activo';
        return { fecha: d10(g.fecha), concepto: g.concepto || '', categoria: g.categoria || 'Sin categoría', tipo: g.tipo === 'programado' ? 'Programado' : 'Inmediato', empleado: g.empleado || '', metodo: g.metodo_pago_nombre || '—',
          estado: cancel ? 'Cancelado' : 'Activo', monto: E.r2(E.cv(g.monto)), iva: E.r2(E.cv(g.impuesto || 0)), ret: E.r2(E.cv(g.retencion_ir_monto || 0)), obs: g.observaciones || '', cancel: cancel, mes: d10(g.fecha).slice(0, 7) };
      }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
      var sum = function (arr, k) { return E.r2(arr.reduce(function (s, r) { return s + E.num(r[k]); }, 0)); };
      var T = { monto: sum(filas, 'monto'), iva: sum(filas, 'iva'), ret: sum(filas, 'ret') };
      var mayor = null; var pc = {};
      filas.forEach(function (r) { pc[r.categoria] = E.r2((pc[r.categoria] || 0) + r.monto); });
      Object.keys(pc).forEach(function (k) { if (!mayor || pc[k] > pc[mayor]) mayor = k; });
      var nCanc = filas.filter(function (r) { return r.cancel; }).length;
      var kpi = function (t, n, extra) { var o = { t: t, num: n, v: E.dinero(n), din: true }; if (extra) for (var k in extra) o[k] = extra[k]; return o; };
      var kpis = [
        { t: 'Cantidad de gastos', num: filas.length, v: String(filas.length) },
        kpi('Total de gastos', T.monto, { fuerte: true }),
        kpi('Gasto promedio', E.r2(T.monto / filas.length)),
        { t: 'Mayor categoría', num: mayor, v: mayor + ' (' + E.dinero(pc[mayor]) + ')' },
        kpi('IVA incluido en los gastos', T.iva), kpi('Retenciones IR', T.ret),
        { t: 'Cancelados incluidos', num: nCanc, v: String(nCanc), rojo: nCanc > 0, tarjeta: nCanc > 0 },
      ];
      kpis[3].num = undefined;
      function agrupa(clave) {
        var m = {};
        filas.forEach(function (r) { var k = r[clave] || '—'; var o = m[k] || (m[k] = { g: k, n: 0, monto: 0, iva: 0, pct: 0 }); o.n++; o.monto = E.r2(o.monto + r.monto); o.iva = E.r2(o.iva + r.iva); });
        var arr = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.monto - a.monto; });
        arr.forEach(function (o) { o.pct = T.monto ? Math.round(o.monto / T.monto * 10000) / 10000 : 0; });
        return arr;
      }
      function colsRes(t) { return [{ k: 'g', t: t, w: 30 }, { k: 'n', t: '# gastos', w: 10, num: true }, { k: 'monto', t: 'Total', w: 18, num: true, din: true }, { k: 'iva', t: 'IVA incluido', w: 16, num: true, din: true }, { k: 'pct', t: '% del total', w: 12, num: true, pctj: true }]; }
      var S = ['n', 'monto', 'iva'];
      var resumenTablas = [{ subtitulo: 'Por forma de pago', columnas: colsRes('Forma de pago'), filas: agrupa('metodo'), sumar: S }, { subtitulo: 'Por tipo', columnas: colsRes('Tipo'), filas: agrupa('tipo'), sumar: S }];
      var tCat = { etiquetaTotal: 'TOTAL', sumar: S, filas: agrupa('categoria'), columnas: colsRes('Categoría') };
      var tDet = { etiquetaTotal: 'TOTAL GENERAL', agrupar: { k: 'categoria', etiqueta: 'Subtotal categoría' }, sumar: ['monto', 'iva', 'ret'],
        filas: filas.slice().sort(function (a, b) { return a.categoria.localeCompare(b.categoria) || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0); }),
        columnas: [{ k: 'categoria', t: 'Categoría', w: 20 }, { k: 'fecha', t: 'Fecha', w: 12, fecha: true }, { k: 'concepto', t: 'Concepto', w: 34, wrap: true }, { k: 'tipo', t: 'Tipo', w: 11 }, { k: 'empleado', t: 'Empleado', w: 18 }, { k: 'metodo', t: 'Forma de pago', w: 18 },
          { k: 'estado', t: 'Estado', w: 11, rojo: 'cancel' }, { k: 'monto', t: 'Monto', w: 16, num: true, din: true, rojo: 'cancel' }, { k: 'iva', t: 'IVA incl.', w: 13, num: true, din: true }, { k: 'ret', t: 'Retención IR', w: 13, num: true, din: true, p: false }, { k: 'obs', t: 'Observaciones', w: 30, wrap: true, p: false }] };
      var hojas = [{ nombre: 'Por categoría', titulo: 'Gastos por categoría', tablas: [tCat] }, { nombre: 'Detalle de gastos', titulo: 'Detalle de gastos (agrupado por categoría)', tablas: [tDet] }];
      var conEmp = filas.filter(function (r) { return r.empleado; });
      if (conEmp.length) {
        var me = {}; conEmp.forEach(function (r) { var o = me[r.empleado] || (me[r.empleado] = { g: r.empleado, n: 0, monto: 0, iva: 0, pct: 0 }); o.n++; o.monto = E.r2(o.monto + r.monto); });
        var arr = Object.keys(me).map(function (k) { return me[k]; }).sort(function (a, b) { return b.monto - a.monto; }); var tE = sum(conEmp, 'monto');
        arr.forEach(function (o) { o.pct = tE ? Math.round(o.monto / tE * 10000) / 10000 : 0; });
        hojas.push({ nombre: 'Por empleado', titulo: 'Gastos por empleado / beneficiario', tablas: [{ etiquetaTotal: 'TOTAL', sumar: ['n', 'monto'], filas: arr, columnas: colsRes('Empleado').filter(function (c) { return c.k !== 'iva'; }) }] });
      }
      var mm = {}; filas.forEach(function (r) { var o = mm[r.mes] || (mm[r.mes] = { mes: r.mes, g: '', n: 0, monto: 0, iva: 0, pct: 0 }); o.n++; o.monto = E.r2(o.monto + r.monto); o.iva = E.r2(o.iva + r.iva); });
      var meses = Object.keys(mm).sort().map(function (k) { var o = mm[k]; o.g = MESES[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4); o.pct = T.monto ? Math.round(o.monto / T.monto * 10000) / 10000 : 0; return o; });
      if (meses.length > 1) hojas.push({ nombre: 'Por mes', titulo: 'Gastos por mes', tablas: [{ etiquetaTotal: 'TOTAL', sumar: S, filas: meses, columnas: colsRes('Mes') }] });
      var notas = ['Total = suma del monto de cada gasto (igual que la pantalla de Gastos). "IVA incluido" es informativo: ya forma parte del monto.',
        'Cada importe se convierte a la moneda de visualización y se redondea a 2 decimales antes de sumar; la diferencia con la pantalla puede ser de centavos.'];
      if (nCanc) notas.push('Se incluyen gastos cancelados porque elegiste verlos: suman en este reporte pero no en la pantalla.');
      return { kpis: kpis, resumenTablas: resumenTablas, hojas: hojas, notas: notas, totalGeneral: [['Gastos incluidos', String(filas.length)], ['TOTAL DE GASTOS', E.dinero(T.monto)]], mensajeOk: filas.length + ' gastos' };
    },
  };

  function filtrar(d, op) {
    return d.gastos.filter(function (g) {
      if (op.estado === 'activo' && g.estado !== 'activo') return false;
      if (op.estado === 'cancelado' && g.estado === 'activo') return false;
      if (op.tipo === 'inmediato' && g.tipo === 'programado') return false;
      if (op.tipo === 'programado' && g.tipo !== 'programado') return false;
      if (op.categoria && g.categoria !== op.categoria) return false;
      if (op.metodo && g.metodo_pago_nombre !== op.metodo) return false;
      if (op.empleado && g.empleado !== op.empleado) return false;
      return true;
    });
  }

  window.abrirExportarGastos = function () {
    if (!window.N360Exp) { try { showToast('El exportador no cargó. Recarga la página.', 'error'); } catch (e) {} return; }
    var gs = window.GS || {};
    N360Exp.abrir(cfg, { sb: window.__cajaSB, userId: gs.userId, empresaConfig: gs.empresaConfig });
  };
  window._cfgExportarGastos = cfg;
})();
