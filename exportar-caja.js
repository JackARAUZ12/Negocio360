/* =====================================================
   EXPORTAR-CAJA.JS — Negocio360
   "Exportar" del módulo Caja (Excel + PDF) con el motor N360Exp.
   Solo LEE movimientos_financieros: no crea ni cambia ningún movimiento.
   Misma regla que la pantalla de Caja:
     · solo movimientos "completado" cuentan (los anulados no mueven el saldo),
     · las transferencias entre cuentas propias NO son ingresos ni egresos del negocio:
       van en su propia columna,
     · el saldo se toma del propio movimiento (saldo_anterior / saldo_resultante).
   Incluye un "cuadre": saldo inicial + ingresos − egresos ± transferencias = saldo final.
   Hojas: Resumen · Movimientos · Por día · Por tipo de movimiento.
===================================================== */
(function () {
  'use strict';

  function d10(x) { return String(x || '').slice(0, 10); }
  function fc(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
  function bonito(t) { t = String(t || '—').replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); }
  function esTransf(m) { return m.tipo_movimiento === 'TRANSFERENCIA'; }
  function lista(d, k, rotulo, fmt) { var s = {}; d.movs.forEach(function (m) { if (m[k]) s[m[k]] = 1; }); return [['', rotulo]].concat(Object.keys(s).sort().map(function (x) { return [x, fmt ? fmt(x) : x]; })); }

  var cfg = {
    titulo: 'Reporte de caja',
    archivo: 'Caja',
    pdfOrientacion: 'landscape',
    ayuda: 'Movimientos de caja con ingresos, egresos, transferencias internas y saldos. Solo lee la información: no crea ni cambia movimientos.',
    filtros: [
      { tipo: 'periodo', etiqueta: 'Período', def: 'mes' },
      { tipo: 'radio', k: 'estado', etiqueta: 'Estado de los movimientos', def: 'completado', opciones: [['completado', 'Completados'], ['anulado', 'Anulados (solo consulta)']] },
      { tipo: 'radio', k: 'flujo', etiqueta: 'Flujo', def: 'todos', opciones: [['todos', 'Todos'], ['INGRESO', 'Solo ingresos'], ['EGRESO', 'Solo egresos']] },
      { tipo: 'radio', k: 'origen', etiqueta: 'Origen', def: 'todos', opciones: [['todos', 'Todos'], ['ligado', 'Ligados (ventas, compras, gastos…)'], ['manual', 'Manuales de Caja']] },
      { tipo: 'select', k: 'metodo', etiqueta: 'Método de pago', opciones: function (d) { return lista(d, 'metodo_pago_nombre', 'Todos los métodos'); } },
      { tipo: 'select', k: 'tipoMov', etiqueta: 'Tipo de movimiento', opciones: function (d) { return lista(d, 'tipo_movimiento', 'Todos los tipos', bonito); } },
    ],

    cargar: async function (ctx, op, E) {
      var movs = await E.leerTodo(function () {
        return ctx.sb.from('movimientos_financieros').select('id,fecha,created_at,concepto,tipo_flujo,tipo_movimiento,monto,saldo_anterior,saldo_resultante,metodo_pago_nombre,referencia_tipo,estado,es_reverso')
          .eq('auth_user_id', ctx.userId).gte('fecha', op.desde).lte('fecha', op.hasta);
      }, 'movimientos de caja');
      movs.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : String(a.created_at) > String(b.created_at) ? 1 : (a.id < b.id ? -1 : 1); });
      return { movs: movs };
    },

    vista: function (d, op, E) {
      var f = filtrar(d, op), T = totales(f, E);
      return '<b>' + f.length + '</b> movimiento' + (f.length === 1 ? '' : 's') + '<br>Ingresos: <b>' + E.dinero(T.ing) + '</b> · Egresos: <b>' + E.dinero(T.egr) + '</b>' + (Math.abs(T.tr) > 0.004 ? '<br>Transferencias internas (neto): <b>' + E.dinero(T.tr) + '</b>' : '');
    },

    textoFiltros: function (op) {
      var p = ['Período: ' + (op.desde === op.hasta ? fc(op.desde) : fc(op.desde) + ' al ' + fc(op.hasta))];
      p.push('Estado: ' + (op.estado === 'anulado' ? 'anulados' : 'completados'));
      if (op.flujo && op.flujo !== 'todos') p.push(op.flujo === 'INGRESO' ? 'Solo ingresos' : 'Solo egresos');
      if (op.origen && op.origen !== 'todos') p.push('Origen: ' + (op.origen === 'ligado' ? 'ligados' : 'manuales'));
      if (op.metodo) p.push('Método: ' + op.metodo);
      if (op.tipoMov) p.push('Tipo: ' + bonito(op.tipoMov));
      return p.join('  ·  ');
    },

    armar: async function (d, op, E) {
      var f = filtrar(d, op);
      if (!f.length) return { vacio: true, mensajeVacio: 'No hay movimientos que cumplan esos filtros.' };
      var filas = f.map(function (m) {
        var monto = E.r2(E.cv(m.monto)), ing = 0, egr = 0, tr = 0;
        if (esTransf(m)) tr = m.tipo_flujo === 'INGRESO' ? monto : -monto;
        else if (m.tipo_flujo === 'INGRESO') ing = monto; else egr = monto;
        return { fecha: d10(m.fecha), concepto: m.concepto || '', tipo: bonito(m.tipo_movimiento), metodo: m.metodo_pago_nombre || '—', origen: m.referencia_tipo ? bonito(m.referencia_tipo) : 'Manual',
          ing: ing, egr: egr, tr: tr, saldo: m.estado === 'completado' ? E.r2(E.cv(m.saldo_resultante)) : '', reverso: !!m.es_reverso ? 'Reverso' : '', estado: m.estado === 'completado' ? 'Completado' : 'Anulado', tmov: m.tipo_movimiento || '' };
      });
      var T = totales(f, E);
      var sum = function (arr, k) { return E.r2(arr.reduce(function (s, r) { return s + E.num(r[k]); }, 0)); };
      var kpi = function (t, n, extra) { var o = { t: t, num: n, v: E.dinero(n), din: true }; if (extra) for (var k in extra) o[k] = extra[k]; return o; };
      var ligIng = sum(filas.filter(function (r, i) { return f[i].referencia_tipo; }), 'ing'), ligEgr = sum(filas.filter(function (r, i) { return f[i].referencia_tipo; }), 'egr');
      var kpis = [
        { t: 'Movimientos', num: filas.length, v: String(filas.length) },
        kpi('Ingresos', T.ing, { fuerte: true }), kpi('Egresos', T.egr, { fuerte: true }), kpi('Resultado (ingresos − egresos)', E.r2(T.ing - T.egr), { rojo: T.ing - T.egr < 0 }),
        kpi('Ingresos ligados (ventas, cobros…)', ligIng), kpi('Egresos ligados (compras, gastos…)', ligEgr),
        kpi('Otros ingresos (manuales)', E.r2(T.ing - ligIng)), kpi('Otros egresos (manuales)', E.r2(T.egr - ligEgr)),
      ];
      if (Math.abs(T.tr) > 0.004) kpis.push(kpi('Transferencias internas (neto)', T.tr, { tarjeta: false }));

      var totalGeneral = [['Ingresos', E.dinero(T.ing)], ['Egresos', E.dinero(T.egr)], ['RESULTADO', E.dinero(E.r2(T.ing - T.egr))]];
      var notas = ['Ingresos y egresos no incluyen las transferencias entre cuentas propias (caja ↔ banco): esas no son ingresos ni egresos del negocio y van en su propia columna.',
        'Los saldos son los que quedaron guardados en cada movimiento; este reporte no los recalcula ni los modifica.'];
      var cuadrable = op.estado === 'completado' && (!op.flujo || op.flujo === 'todos') && (!op.origen || op.origen === 'todos') && !op.metodo && !op.tipoMov;
      if (cuadrable) {
        var ini = E.r2(E.cv(f[0].saldo_anterior)), fin = E.r2(E.cv(f[f.length - 1].saldo_resultante));
        var calc = E.r2(ini + T.ing - T.egr + T.tr), dif = E.r2(fin - calc);
        kpis.splice(1, 0, kpi('Saldo al inicio del período', ini, { tarjeta: true }), kpi('Saldo al final del período', fin, { fuerte: true }));
        totalGeneral.unshift(['Saldo inicial', E.dinero(ini)]);
        totalGeneral.push(['Saldo final', E.dinero(fin)]);
        var ok = Math.abs(dif) <= 0.05;
        kpis.splice(3, 0, { t: 'Cuadre (saldo inicial + movimientos − saldo final)', num: dif, v: ok ? 'Cuadra (diferencia 0.00)' : E.dinero(dif), din: true, rojo: !ok, tarjeta: true });
        notas.push(ok ? 'Cuadre: saldo inicial + ingresos − egresos ± transferencias = saldo final.' : 'ATENCIÓN: el saldo final guardado no coincide con saldo inicial + movimientos (diferencia ' + E.dinero(dif) + '). Puede deberse a movimientos de bancos en otra moneda o a movimientos fuera del período; conviene revisarlo.');
      }
      if (kpis.length > 8) kpis.forEach(function (k, i) { if (i >= 8 && k.tarjeta !== true) k.tarjeta = false; });

      var cols = function (primero) { return [primero, { k: 'n', t: '# mov.', w: 9, num: true }, { k: 'ing', t: 'Ingresos', w: 17, num: true, din: true }, { k: 'egr', t: 'Egresos', w: 17, num: true, din: true }, { k: 'tr', t: 'Transferencias (+/−)', w: 18, num: true, din: true }, { k: 'neto', t: 'Resultado', w: 17, num: true, din: true }]; };
      function agrupa(clave, etiqueta) {
        var m = {};
        filas.forEach(function (r) { var k = r[clave] || '—'; var o = m[k] || (m[k] = { g: k, n: 0, ing: 0, egr: 0, tr: 0, neto: 0 }); o.n++; o.ing = E.r2(o.ing + r.ing); o.egr = E.r2(o.egr + r.egr); o.tr = E.r2(o.tr + r.tr); o.neto = E.r2(o.ing - o.egr); });
        return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.ing + b.egr - (a.ing + a.egr); });
      }
      var S = ['n', 'ing', 'egr', 'tr', 'neto'];
      var resumenTablas = [
        { subtitulo: 'Por tipo de movimiento', columnas: cols({ k: 'g', t: 'Tipo', w: 30 }), filas: agrupa('tipo'), sumar: S },
        { subtitulo: 'Por método de pago', columnas: cols({ k: 'g', t: 'Método de pago', w: 30 }), filas: agrupa('metodo'), sumar: S },
        { subtitulo: 'Por origen', columnas: cols({ k: 'g', t: 'Origen', w: 30 }), filas: agrupa('origen'), sumar: S },
      ];
      var tMov = { etiquetaTotal: 'TOTAL', sumar: ['ing', 'egr', 'tr'], filas: filas,
        columnas: [{ k: 'fecha', t: 'Fecha', w: 12, fecha: true }, { k: 'concepto', t: 'Concepto', w: 40, wrap: true }, { k: 'tipo', t: 'Tipo', w: 22 }, { k: 'origen', t: 'Origen', w: 14 }, { k: 'metodo', t: 'Método de pago', w: 18 },
          { k: 'ing', t: 'Ingreso', w: 16, num: true, din: true }, { k: 'egr', t: 'Egreso', w: 16, num: true, din: true }, { k: 'tr', t: 'Transferencia (+/−)', w: 17, num: true, din: true }, { k: 'saldo', t: 'Saldo después', w: 17, num: true, din: true },
          { k: 'reverso', t: 'Reverso', w: 9, p: false }, { k: 'estado', t: 'Estado', w: 11, p: false }] };
      var md = {}; var orden = [];
      filas.forEach(function (r) { var o = md[r.fecha]; if (!o) { o = md[r.fecha] = { fecha: r.fecha, n: 0, ing: 0, egr: 0, tr: 0, neto: 0, saldo: '' }; orden.push(r.fecha); } o.n++; o.ing = E.r2(o.ing + r.ing); o.egr = E.r2(o.egr + r.egr); o.tr = E.r2(o.tr + r.tr); o.neto = E.r2(o.ing - o.egr); if (r.saldo !== '') o.saldo = r.saldo; });
      var porDia = orden.sort().map(function (k) { return md[k]; });
      var tDia = { etiquetaTotal: 'TOTAL', sumar: S, filas: porDia, columnas: [{ k: 'fecha', t: 'Fecha', w: 14, fecha: true }].concat(cols({ k: '_', t: '', w: 0 }).slice(1)).concat([{ k: 'saldo', t: 'Saldo al cierre del día', w: 20, num: true, din: true }]) };
      var hojas = [{ nombre: 'Movimientos', titulo: 'Movimientos de caja', tablas: [tMov] }, { nombre: 'Por día', titulo: 'Caja por día', tablas: [tDia] }];
      return { kpis: kpis, resumenTablas: resumenTablas, hojas: hojas, notas: notas, totalGeneral: totalGeneral, mensajeOk: filas.length + ' movimientos' };
    },
  };

  function totales(f, E) {
    var t = { ing: 0, egr: 0, tr: 0 };
    f.forEach(function (m) {
      var monto = E.r2(E.cv(m.monto));
      if (esTransf(m)) t.tr = E.r2(t.tr + (m.tipo_flujo === 'INGRESO' ? monto : -monto));
      else if (m.tipo_flujo === 'INGRESO') t.ing = E.r2(t.ing + monto); else t.egr = E.r2(t.egr + monto);
    });
    return t;
  }

  function filtrar(d, op) {
    var est = op.estado === 'anulado' ? 'anulado' : 'completado';
    return d.movs.filter(function (m) {
      if (est === 'completado' ? m.estado !== 'completado' : m.estado === 'completado') return false;
      if (op.flujo && op.flujo !== 'todos' && m.tipo_flujo !== op.flujo) return false;
      if (op.origen === 'ligado' && !m.referencia_tipo) return false;
      if (op.origen === 'manual' && m.referencia_tipo) return false;
      if (op.metodo && m.metodo_pago_nombre !== op.metodo) return false;
      if (op.tipoMov && m.tipo_movimiento !== op.tipoMov) return false;
      return true;
    });
  }

  window.abrirExportarCaja = function () {
    if (!window.N360Exp) { try { showToast('El exportador no cargó. Recarga la página.', 'error'); } catch (e) {} return; }
    N360Exp.abrir(cfg, { sb: sbClient, userId: STATE.userId, empresaConfig: STATE.empresaConfig });
  };
  window._cfgExportarCaja = cfg;
})();
