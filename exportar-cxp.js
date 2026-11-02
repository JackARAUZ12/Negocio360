/* =====================================================
   EXPORTAR-CXP.JS — Negocio360
   "Exportar" del módulo Cuentas por pagar (Excel + PDF) con el motor N360Exp.
   Solo LEE. Hojas: Resumen · Por proveedor · Detalle de cuentas · Antigüedad de saldos · Cuotas pendientes.
   Estado de cada cuenta = misma regla que la pantalla: anulado / pagado (saldo ≤ 0.01) /
   vencido (próxima cuota sin pagar ya pasó) / pendiente.
   Las cuotas se miden con monto_total − monto_pagado (el campo "saldo" de las cuotas puede estar desactualizado).
===================================================== */
(function () {
  'use strict';

  function claveProv(c) { return c.proveedor_id ? 'p:' + c.proveedor_id : 'n:' + (c.proveedor_nombre || ''); }
  function nombreProv(c) { return c.proveedor_nombre || 'Sin proveedor'; }
  function d10(x) { return String(x || '').slice(0, 10); }
  var NOMBRE_ESTADO = { pendiente: 'Pendiente', vencido: 'Vencida', pagado: 'Pagada', anulado: 'Anulada' };

  var cfg = {
    titulo: 'Reporte de cuentas por pagar',
    archivo: 'Cuentas_por_pagar',
    pdfOrientacion: 'landscape',
    ayuda: 'Lo que debes a tus proveedores, con vencimientos y antigüedad. Solo lee la información: no cambia nada.',
    filtros: [
      { tipo: 'periodo', etiqueta: 'Fecha de la compra', def: 'todo', permiteTodo: true },
      { tipo: 'radio', k: 'estado', etiqueta: 'Estado', def: 'porpagar', opciones: [['porpagar', 'Por pagar (pendientes + vencidas)'], ['vencido', 'Solo vencidas'], ['pagado', 'Pagadas'], ['anulado', 'Anuladas'], ['todas', 'Todas']] },
    ],
    entidad: {
      etiqueta: 'Proveedores (déjalo vacío para incluir a todos)',
      vacio: 'No hay cuentas con esos filtros.',
      lista: function (d, op, E) {
        var m = {};
        filtrar(d, Object.assign({}, op, { entidades: [] })).forEach(function (c) { var k = claveProv(c); var o = m[k] || (m[k] = { id: k, nombre: nombreProv(c), saldo: 0 }); if (c._estado !== 'pagado' && c._estado !== 'anulado') o.saldo += E.num(c.saldo_pendiente); });
        return Object.keys(m).map(function (k) { return { id: m[k].id, nombre: m[k].nombre, extra: m[k].saldo > 0.004 ? 'debes ' + E.dinero(E.cv(m[k].saldo)) : '' }; }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
      },
    },

    cargar: async function (ctx, op, E) {
      var cuentas = await E.leerTodo(function () {
        var q = ctx.sb.from('cuentas_por_pagar').select('id,numero,proveedor_id,proveedor_nombre,compra_id,tipo_credito,fecha_compra,fecha_vencimiento,num_cuotas,monto_total,monto_pagado,saldo_pendiente,estado,observaciones')
          .eq('auth_user_id', ctx.userId);
        if (op.desde) q = q.gte('fecha_compra', op.desde).lte('fecha_compra', op.hasta);
        return q;
      }, 'cuentas por pagar');
      var cuotas = cuentas.length ? await E.leerPorIds(cuentas.map(function (c) { return c.id; }), function (parte) {
        return ctx.sb.from('cuentas_por_pagar_cuotas').select('id,cuenta_id,numero,fecha_vencimiento,monto_total,monto_pagado,estado').in('cuenta_id', parte).neq('estado', 'pagada');
      }, 'cuotas') : [];
      var hoy = E.hoyISO(), prox = {}, porCuenta = {};
      cuotas.forEach(function (q) { (porCuenta[q.cuenta_id] = porCuenta[q.cuenta_id] || []).push(q); var f = d10(q.fecha_vencimiento); if (f && (!prox[q.cuenta_id] || f < prox[q.cuenta_id])) prox[q.cuenta_id] = f; });
      cuentas.forEach(function (c) {
        c._cuotas = (porCuenta[c.id] || []).sort(function (a, b) { return E.num(a.numero) - E.num(b.numero); });
        c._proxima = prox[c.id] || d10(c.fecha_vencimiento);
        // misma regla que calcularEstadoCuenta() de la pantalla
        if (c.estado === 'anulado') c._estado = 'anulado';
        else if (E.num(c.saldo_pendiente) <= 0.01) c._estado = 'pagado';
        else if (c._proxima && c._proxima < hoy) c._estado = 'vencido';
        else c._estado = 'pendiente';
      });
      return { cuentas: cuentas, hoy: hoy };
    },

    vista: function (d, op, E) {
      var f = filtrar(d, op), t = f.filter(function (c) { return c._estado !== 'pagado' && c._estado !== 'anulado'; });
      var saldo = E.r2(t.reduce(function (s, c) { return s + E.r2(E.cv(c.saldo_pendiente)); }, 0));
      var venc = E.r2(f.filter(function (c) { return c._estado === 'vencido'; }).reduce(function (s, c) { return s + E.r2(E.cv(c.saldo_pendiente)); }, 0));
      return '<b>' + f.length + '</b> cuenta' + (f.length === 1 ? '' : 's') + '<br>Por pagar: <b>' + E.dinero(saldo) + '</b> · En cuentas vencidas: <b>' + E.dinero(venc) + '</b>';
    },

    textoFiltros: function (op) {
      var p = ['Compras: ' + (op.desde ? fc(op.desde) + ' al ' + fc(op.hasta) : 'todas las fechas')];
      p.push('Estado: ' + ({ porpagar: 'por pagar (pendientes + vencidas)', vencido: 'solo vencidas', pagado: 'pagadas', anulado: 'anuladas', todas: 'todas' }[op.estado] || ''));
      if (op.entidades && op.entidades.length) p.push('Proveedores seleccionados: ' + op.entidades.length);
      return p.join('  ·  ');
    },

    armar: async function (d, op, E) {
      var f = filtrar(d, op);
      if (!f.length) return { vacio: true, mensajeVacio: 'No hay cuentas que cumplan esos filtros.' };
      var hoy = d.hoy;
      var filas = f.map(function (c) {
        var total = E.r2(E.cv(c.monto_total)), pagado = E.r2(E.cv(c.monto_pagado)), saldo = E.r2(E.cv(c.saldo_pendiente));
        var activa = c._estado === 'pendiente' || c._estado === 'vencido';
        var atraso = c._estado === 'vencido' && c._proxima ? E.diasEntre(c._proxima, hoy) : 0;
        // antigüedad: cuotas vencidas por tramo; sin cuotas se usa el vencimiento de la cuenta
        var b = { v1: 0, v31: 0, v61: 0, v90: 0 }, venc = 0;
        if (activa) {
          var lista = c._cuotas.length ? c._cuotas.map(function (q) { return { f: d10(q.fecha_vencimiento), m: Math.max(0, E.num(q.monto_total) - E.num(q.monto_pagado)) }; }) : [{ f: d10(c.fecha_vencimiento), m: E.num(c.saldo_pendiente) }];
          lista.forEach(function (q) {
            if (!q.f || q.f >= hoy || q.m <= 0.004) return;
            var dias = E.diasEntre(q.f, hoy), m = E.r2(E.cv(q.m));
            if (dias <= 30) b.v1 = E.r2(b.v1 + m); else if (dias <= 60) b.v31 = E.r2(b.v31 + m); else if (dias <= 90) b.v61 = E.r2(b.v61 + m); else b.v90 = E.r2(b.v90 + m);
          });
          venc = E.r2(b.v1 + b.v31 + b.v61 + b.v90);
        }
        return { id: c.id, prov: nombreProv(c), pkey: claveProv(c), numero: c.numero || '', compra: d10(c.fecha_compra), proxima: activa ? c._proxima : '', cuotas: E.num(c.num_cuotas) || (c._cuotas.length || 1), pendientes: c._cuotas.length,
          total: total, pagado: pagado, saldo: activa ? saldo : (c._estado === 'pagado' ? 0 : saldo), estadoTxt: NOMBRE_ESTADO[c._estado] || c._estado, estado: c._estado, atraso: atraso,
          porVencer: activa ? Math.max(0, E.r2(saldo - venc)) : 0, v1: b.v1, v31: b.v31, v61: b.v61, v90: b.v90, vencidoCuotas: venc, enVencida: c._estado === 'vencido' ? saldo : 0, rojo: c._estado === 'vencido', obs: c.observaciones || '' };
      });
      var activas = filas.filter(function (r) { return r.estado === 'pendiente' || r.estado === 'vencido'; });
      var sum = function (arr, k) { return E.r2(arr.reduce(function (s, r) { return s + E.num(r[k]); }, 0)); };
      var T = { total: sum(filas, 'total'), pagado: sum(filas, 'pagado'), porPagar: sum(activas, 'saldo'), enVenc: sum(filas, 'enVencida'), vencCuotas: sum(activas, 'vencidoCuotas'), porVencer: sum(activas, 'porVencer') };
      var nVenc = filas.filter(function (r) { return r.estado === 'vencido'; }).length;
      var provs = {}; filas.forEach(function (r) { provs[r.pkey] = 1; });
      var kpi = function (t, n, extra) { var o = { t: t, num: n, v: E.dinero(n), din: true }; if (extra) for (var k in extra) o[k] = extra[k]; return o; };
      var kpis = [
        { t: 'Cuentas incluidas', num: filas.length, v: String(filas.length) },
        { t: 'Proveedores', num: Object.keys(provs).length, v: String(Object.keys(provs).length) },
        kpi('Por pagar (pendientes + vencidas)', T.porPagar, { fuerte: true }),
        kpi('En cuentas vencidas (como la pantalla)', T.enVenc, { rojo: T.enVenc > 0.004 }),
        kpi('Cuotas ya vencidas', T.vencCuotas, { rojo: T.vencCuotas > 0.004 }),
        kpi('Por vencer', T.porVencer),
        { t: 'Cuentas vencidas', num: nVenc, v: String(nVenc), rojo: nVenc > 0 },
        kpi('Monto total de las cuentas', T.total, { tarjeta: false }), kpi('Total pagado', T.pagado, { tarjeta: false }),
      ];

      var porEstado = {};
      filas.forEach(function (r) { var o = porEstado[r.estadoTxt] || (porEstado[r.estadoTxt] = { g: r.estadoTxt, n: 0, total: 0, pagado: 0, saldo: 0 }); o.n++; o.total = E.r2(o.total + r.total); o.pagado = E.r2(o.pagado + r.pagado); o.saldo = E.r2(o.saldo + r.saldo); });
      var tEstado = { subtitulo: 'Por estado', etiquetaTotal: 'TOTAL', sumar: ['n', 'total', 'pagado', 'saldo'], filas: Object.keys(porEstado).map(function (k) { return porEstado[k]; }),
        columnas: [{ k: 'g', t: 'Estado', w: 26 }, { k: 'n', t: 'Cuentas', w: 10, num: true }, { k: 'total', t: 'Monto total', w: 17, num: true, din: true }, { k: 'pagado', t: 'Pagado', w: 17, num: true, din: true }, { k: 'saldo', t: 'Saldo pendiente', w: 17, num: true, din: true }] };

      // por proveedor
      var mp = {};
      filas.forEach(function (r) {
        var o = mp[r.pkey] || (mp[r.pkey] = { prov: r.prov, n: 0, total: 0, pagado: 0, saldo: 0, vencido: 0, proxima: '' });
        o.n++; o.total = E.r2(o.total + r.total); o.pagado = E.r2(o.pagado + r.pagado);
        if (r.estado === 'pendiente' || r.estado === 'vencido') { o.saldo = E.r2(o.saldo + r.saldo); o.vencido = E.r2(o.vencido + r.enVencida); if (r.proxima && (!o.proxima || r.proxima < o.proxima)) o.proxima = r.proxima; }
      });
      var porProv = Object.keys(mp).map(function (k) { return mp[k]; }).sort(function (a, b) { return b.saldo - a.saldo; });
      var tProv = { etiquetaTotal: 'TOTAL', sumar: ['n', 'total', 'pagado', 'saldo', 'vencido'], filas: porProv,
        columnas: [{ k: 'prov', t: 'Proveedor', w: 34 }, { k: 'n', t: 'Cuentas', w: 10, num: true }, { k: 'total', t: 'Monto total', w: 17, num: true, din: true }, { k: 'pagado', t: 'Pagado', w: 17, num: true, din: true },
          { k: 'saldo', t: 'Saldo por pagar', w: 17, num: true, din: true }, { k: 'vencido', t: 'En cuentas vencidas', w: 18, num: true, din: true, rojo: null }, { k: 'proxima', t: 'Próximo vencimiento', w: 15, fecha: true }] };

      // detalle agrupado por proveedor
      var tDet = { etiquetaTotal: 'TOTAL GENERAL', agrupar: { k: 'prov', etiqueta: 'Subtotal proveedor' }, sumar: ['total', 'pagado', 'saldo'],
        filas: filas.slice().sort(function (a, b) { return a.prov.localeCompare(b.prov) || (a.compra < b.compra ? -1 : 1); }),
        columnas: [{ k: 'prov', t: 'Proveedor', w: 28 }, { k: 'numero', t: 'No. cuenta', w: 16 }, { k: 'compra', t: 'Fecha compra', w: 13, fecha: true }, { k: 'proxima', t: 'Próx. vencimiento', w: 14, fecha: true },
          { k: 'cuotas', t: 'Cuotas', w: 8, num: true }, { k: 'pendientes', t: 'Cuotas pend.', w: 9, num: true },
          { k: 'total', t: 'Monto total', w: 16, num: true, din: true }, { k: 'pagado', t: 'Pagado', w: 16, num: true, din: true }, { k: 'saldo', t: 'Saldo', w: 16, num: true, din: true, rojo: 'rojo' },
          { k: 'estadoTxt', t: 'Estado', w: 11, rojo: 'rojo' }, { k: 'atraso', t: 'Días de atraso', w: 10, num: true }, { k: 'obs', t: 'Observaciones', w: 30, wrap: true, p: false }] };

      var hojas = [{ nombre: 'Por proveedor', titulo: 'Cuentas por pagar por proveedor', tablas: [tProv] }, { nombre: 'Detalle de cuentas', titulo: 'Detalle de cuentas por pagar (agrupado por proveedor)', tablas: [tDet] }];

      if (activas.length) {
        var ma = {};
        activas.forEach(function (r) { var o = ma[r.pkey] || (ma[r.pkey] = { prov: r.prov, saldo: 0, porVencer: 0, v1: 0, v31: 0, v61: 0, v90: 0, vencidoCuotas: 0 }); ['saldo', 'porVencer', 'v1', 'v31', 'v61', 'v90', 'vencidoCuotas'].forEach(function (k) { o[k] = E.r2(o[k] + r[k]); }); });
        var ant = Object.keys(ma).map(function (k) { return ma[k]; }).sort(function (a, b) { return b.saldo - a.saldo; });
        hojas.push({ nombre: 'Antigüedad de saldos', titulo: 'Antigüedad de saldos por pagar', tablas: [{ etiquetaTotal: 'TOTAL', sumar: ['saldo', 'porVencer', 'v1', 'v31', 'v61', 'v90', 'vencidoCuotas'], filas: ant,
          columnas: [{ k: 'prov', t: 'Proveedor', w: 34 }, { k: 'saldo', t: 'Saldo por pagar', w: 17, num: true, din: true }, { k: 'porVencer', t: 'Por vencer', w: 16, num: true, din: true }, { k: 'v1', t: 'Vencido 1–30 días', w: 16, num: true, din: true },
            { k: 'v31', t: 'Vencido 31–60', w: 15, num: true, din: true }, { k: 'v61', t: 'Vencido 61–90', w: 15, num: true, din: true }, { k: 'v90', t: 'Vencido +90', w: 15, num: true, din: true }, { k: 'vencidoCuotas', t: 'Total vencido', w: 16, num: true, din: true }] }] });
        // cuotas pendientes
        var idAct = {}; activas.forEach(function (r) { idAct[r.id] = r; });
        var cu = [];
        f.forEach(function (c) {
          var r = idAct[c.id]; if (!r) return;
          if (!c._cuotas.length) { cu.push({ prov: r.prov, numero: r.numero, cuota: '—', vence: d10(c.fecha_vencimiento), monto: r.total, pagado: r.pagado, saldo: r.saldo, atraso: r.atraso, estadoTxt: r.estadoTxt, rojo: r.rojo }); return; }
          c._cuotas.forEach(function (q) {
            var saldoQ = Math.max(0, E.num(q.monto_total) - E.num(q.monto_pagado)); if (saldoQ <= 0.004) return;
            var fv = d10(q.fecha_vencimiento), at = fv && fv < hoy ? E.diasEntre(fv, hoy) : 0;
            cu.push({ prov: r.prov, numero: r.numero, cuota: '#' + q.numero, vence: fv, monto: E.r2(E.cv(q.monto_total)), pagado: E.r2(E.cv(q.monto_pagado)), saldo: E.r2(E.cv(saldoQ)), atraso: at, estadoTxt: at > 0 ? 'Vencida' : (E.num(q.monto_pagado) > 0 ? 'Parcial' : 'Pendiente'), rojo: at > 0 });
          });
        });
        cu.sort(function (a, b) { return a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : 0; });
        hojas.push({ nombre: 'Cuotas pendientes', titulo: 'Cuotas pendientes (ordenadas por vencimiento)', pdf: false, tablas: [{ nota: 'El saldo de las cuotas se calcula como monto − pagado; puede diferir del saldo de la cuenta si existen pagos antiguos que no se repartieron por cuota.', etiquetaTotal: 'TOTAL', sumar: ['monto', 'pagado', 'saldo'], filas: cu,
          columnas: [{ k: 'prov', t: 'Proveedor', w: 30 }, { k: 'numero', t: 'No. cuenta', w: 16 }, { k: 'cuota', t: 'Cuota', w: 8 }, { k: 'vence', t: 'Vence', w: 12, fecha: true }, { k: 'monto', t: 'Monto cuota', w: 16, num: true, din: true }, { k: 'pagado', t: 'Pagado', w: 16, num: true, din: true },
            { k: 'saldo', t: 'Saldo cuota', w: 16, num: true, din: true, rojo: 'rojo' }, { k: 'atraso', t: 'Días de atraso', w: 10, num: true }, { k: 'estadoTxt', t: 'Estado', w: 11, rojo: 'rojo' }] }] });
      }

      return {
        kpis: kpis, resumenTablas: [tEstado], hojas: hojas,
        totalGeneral: [['Monto total de las cuentas', E.dinero(T.total)], ['Pagado', E.dinero(T.pagado)], ['POR PAGAR', E.dinero(T.porPagar)]],
        notas: ['Por pagar = saldo de las cuentas pendientes y vencidas (igual que la pantalla). "En cuentas vencidas" es el saldo completo de las cuentas cuya próxima cuota ya pasó.',
          '"Cuotas ya vencidas" suma solo lo vencido de cada cuota (monto − pagado) y se reparte por antigüedad; por vencer = saldo − cuotas vencidas.'],
        mensajeOk: filas.length + ' cuentas',
      };
    },
  };

  function fc(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }

  function filtrar(d, op) {
    var sel = {}; (op.entidades || []).forEach(function (k) { sel[k] = 1; }); var haySel = (op.entidades || []).length > 0;
    return d.cuentas.filter(function (c) {
      var e = c._estado;
      if (op.estado === 'porpagar' && e !== 'pendiente' && e !== 'vencido') return false;
      if (op.estado === 'vencido' && e !== 'vencido') return false;
      if (op.estado === 'pagado' && e !== 'pagado') return false;
      if (op.estado === 'anulado' && e !== 'anulado') return false;
      if (haySel && !sel[claveProv(c)]) return false;
      return true;
    });
  }

  window.abrirExportarCxP = function () {
    if (!window.N360Exp) { try { showToast('El exportador no cargó. Recarga la página.', 'error'); } catch (e) {} return; }
    N360Exp.abrir(cfg, { sb: sbClient, userId: STATE.userId, empresaConfig: STATE.empresaConfig });
  };
  window._cfgExportarCxP = cfg;
})();
