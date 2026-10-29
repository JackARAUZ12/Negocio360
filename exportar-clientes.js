/* =====================================================
   EXPORTAR-CLIENTES.JS — Negocio360
   "Exportar" del módulo Clientes (Excel + PDF) usando el motor N360Exp.
   Solo LEE. Hojas: Resumen · Listado de clientes · Antigüedad de saldos.
   El saldo por cobrar sale de los créditos con saldo (igual que el módulo Créditos);
   lo vencido y su antigüedad salen de las cuotas pendientes (monto_total − monto_pagado).
===================================================== */
(function () {
  'use strict';

  var ESTADOS = [['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']];

  function unicos(lista, k) { var s = {}; lista.forEach(function (c) { if (c[k]) s[c[k]] = 1; }); return Object.keys(s).sort(); }
  function opciones(rotulo, d, k) { return [['', rotulo]].concat(unicos(d.clientes, k).map(function (x) { return [x, x]; })); }

  var cfg = {
    titulo: 'Reporte de clientes',
    archivo: 'Clientes',
    pdfOrientacion: 'landscape',
    ayuda: 'Listado de clientes con lo comprado, lo que deben y la antigüedad de sus saldos. Solo lee la información: no cambia nada.',
    filtros: [
      { tipo: 'radio', k: 'estado', etiqueta: 'Clientes', def: 'activos', opciones: ESTADOS },
      { tipo: 'radio', k: 'saldo', etiqueta: 'Saldo por cobrar', def: 'todos', opciones: [['todos', 'Todos'], ['consaldo', 'Con saldo'], ['vencidos', 'Con saldo vencido'], ['sinsaldo', 'Sin saldo']] },
      { tipo: 'select', k: 'tipo', etiqueta: 'Tipo de cliente', opciones: function (d) { return opciones('Todos los tipos', d, 'tipo_cliente'); } },
      { tipo: 'select', k: 'segmento', etiqueta: 'Segmento', opciones: function (d) { return opciones('Todos los segmentos', d, 'segmento'); } },
      { tipo: 'select', k: 'ciudad', etiqueta: 'Ciudad', opciones: function (d) { return opciones('Todas las ciudades', d, 'ciudad'); } },
      { tipo: 'radio', k: 'sinCompra', etiqueta: 'Actividad', def: 'todos', opciones: [['todos', 'Todos'], ['concompras', 'Con compras'], ['sincompras', 'Sin compras'], ['inactivo90', 'Sin comprar hace 90+ días']] },
    ],
    entidad: {
      etiqueta: 'Clientes específicos (déjalo vacío para incluir a todos)',
      vacio: 'No hay clientes con esos filtros.',
      lista: function (d, op, E) { return filtrar(d, Object.assign({}, op, { entidades: [] }), E).map(function (c) { return { id: c.id, nombre: nombreC(c), extra: c._saldo > 0.004 ? 'debe ' + E.dinero(c._saldo) : '' }; }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); }); },
    },

    cargar: async function (ctx, op, E) {
      var clientes = await E.leerTodo(function () {
        return ctx.sb.from('clientes').select('id,nombre,apellido,empresa,tipo_cliente,segmento,ciudad,telefono,whatsapp,email,correo,activo,estado,num_compras,total_compras,primera_compra,ultima_compra,limite_credito')
          .eq('auth_user_id', ctx.userId);
      }, 'clientes');
      var creditos = await E.leerTodo(function () {
        return ctx.sb.from('creditos').select('id,cliente_id,estado,saldo_pendiente').eq('auth_user_id', ctx.userId).gt('saldo_pendiente', 0.01).neq('estado', 'cancelado');
      }, 'créditos');
      var cuotas = creditos.length ? await E.leerPorIds(creditos.map(function (c) { return c.id; }), function (parte) {
        return ctx.sb.from('creditos_cuotas').select('id,credito_id,fecha_vencimiento,monto_total,monto_pagado,estado').in('credito_id', parte).neq('estado', 'pagada');
      }, 'cuotas') : [];
      var hoy = E.hoyISO();
      var porCred = {}; creditos.forEach(function (c) { porCred[c.id] = c; });
      var ag = {};
      function a(cid) { return ag[cid] || (ag[cid] = { saldo: 0, v1: 0, v31: 0, v61: 0, v90: 0, creditos: 0, masAtraso: 0, cuotasCred: {} }); }
      creditos.forEach(function (c) { var o = a(c.cliente_id); o.saldo = E.r2(o.saldo + E.cv(c.saldo_pendiente)); o.creditos++; });
      cuotas.forEach(function (q) {
        var c = porCred[q.credito_id]; if (!c) return;
        var saldo = Math.max(0, E.num(q.monto_total) - E.num(q.monto_pagado)); if (saldo <= 0.004) return;
        var f = String(q.fecha_vencimiento || '').slice(0, 10); if (!f || f >= hoy) return;
        var dias = E.diasEntre(f, hoy), o = a(c.cliente_id), m = E.r2(E.cv(saldo));
        if (dias <= 30) o.v1 = E.r2(o.v1 + m); else if (dias <= 60) o.v31 = E.r2(o.v31 + m); else if (dias <= 90) o.v61 = E.r2(o.v61 + m); else o.v90 = E.r2(o.v90 + m);
        if (dias > o.masAtraso) o.masAtraso = dias;
      });
      clientes.forEach(function (c) {
        var o = ag[c.id] || { saldo: 0, v1: 0, v31: 0, v61: 0, v90: 0, creditos: 0, masAtraso: 0 };
        c._saldo = o.saldo; c._v1 = o.v1; c._v31 = o.v31; c._v61 = o.v61; c._v90 = o.v90; c._vencido = E.r2(o.v1 + o.v31 + o.v61 + o.v90);
        c._creditos = o.creditos; c._atraso = o.masAtraso;
      });
      return { clientes: clientes, hoy: hoy };
    },

    vista: function (d, op, E) {
      var f = filtrar(d, op, E), n = f.length;
      var saldo = E.r2(f.reduce(function (s, c) { return s + c._saldo; }, 0)), venc = E.r2(f.reduce(function (s, c) { return s + c._vencido; }, 0));
      var comp = E.r2(f.reduce(function (s, c) { return s + E.cv(c.total_compras || 0); }, 0));
      return '<b>' + n + '</b> cliente' + (n === 1 ? '' : 's') + '<br>Total comprado: <b>' + E.dinero(comp) + '</b><br>Por cobrar: <b>' + E.dinero(saldo) + '</b> · Vencido: <b>' + E.dinero(venc) + '</b>';
    },

    textoFiltros: function (op) {
      var p = ['Clientes: ' + ({ activos: 'activos', inactivos: 'inactivos', todos: 'todos' }[op.estado] || 'todos')];
      if (op.saldo && op.saldo !== 'todos') p.push('Saldo: ' + ({ consaldo: 'con saldo', vencidos: 'con saldo vencido', sinsaldo: 'sin saldo' }[op.saldo]));
      if (op.tipo) p.push('Tipo: ' + op.tipo);
      if (op.segmento) p.push('Segmento: ' + op.segmento);
      if (op.ciudad) p.push('Ciudad: ' + op.ciudad);
      if (op.sinCompra && op.sinCompra !== 'todos') p.push('Actividad: ' + ({ concompras: 'con compras', sincompras: 'sin compras', inactivo90: 'sin comprar hace 90+ días' }[op.sinCompra]));
      if (op.entidades && op.entidades.length) p.push('Clientes seleccionados: ' + op.entidades.length);
      return p.join('  ·  ');
    },

    armar: async function (d, op, E) {
      var f = filtrar(d, op, E);
      if (!f.length) return { vacio: true, mensajeVacio: 'No hay clientes que cumplan esos filtros.' };
      var hoy = d.hoy;
      var filas = f.map(function (c) {
        var comp = E.r2(E.cv(c.total_compras || 0)), n = E.num(c.num_compras);
        var uc = String(c.ultima_compra || '').slice(0, 10);
        return { id: c.id, cliente: nombreC(c), empresa: c.empresa || '', tipo: c.tipo_cliente || '—', segmento: c.segmento || '—', ciudad: c.ciudad || '—', telefono: c.telefono || c.whatsapp || '', correo: c.email || c.correo || '',
          estado: c.activo === false ? 'Inactivo' : 'Activo', compras: n, total: comp, ticket: n > 0 ? E.r2(comp / n) : 0,
          primera: String(c.primera_compra || '').slice(0, 10), ultima: uc, sinComprar: uc ? E.diasEntre(uc, hoy) : '', limite: E.r2(E.cv(c.limite_credito || 0)),
          saldo: c._saldo, vencido: c._vencido, v1: c._v1, v31: c._v31, v61: c._v61, v90: c._v90, porVencer: Math.max(0, E.r2(c._saldo - c._vencido)), atraso: c._atraso, rojo: c._vencido > 0.004 };
      }).sort(function (a, b) { return b.total - a.total; });
      var sum = function (arr, k) { return E.r2(arr.reduce(function (s, r) { return s + E.num(r[k]); }, 0)); };
      var T = { total: sum(filas, 'total'), compras: sum(filas, 'compras'), saldo: sum(filas, 'saldo'), venc: sum(filas, 'vencido'), limite: sum(filas, 'limite') };
      var conSaldo = filas.filter(function (r) { return r.saldo > 0.004; }).length, conVenc = filas.filter(function (r) { return r.vencido > 0.004; }).length;
      var kpi = function (t, n, extra) { var o = { t: t, num: n, v: E.dinero(n), din: true }; if (extra) for (var k in extra) o[k] = extra[k]; return o; };
      var kpis = [
        { t: 'Clientes', num: filas.length, v: String(filas.length), fuerte: true },
        { t: 'Con compras', num: filas.filter(function (r) { return r.compras > 0; }).length, v: String(filas.filter(function (r) { return r.compras > 0; }).length) },
        kpi('Total comprado', T.total, { fuerte: true }),
        kpi('Ticket promedio', T.compras > 0 ? E.r2(T.total / T.compras) : 0),
        kpi('Por cobrar (créditos)', T.saldo, { fuerte: true }),
        kpi('Saldo vencido', T.venc, { rojo: T.venc > 0.004 }),
        { t: 'Clientes con saldo', num: conSaldo, v: String(conSaldo) },
        { t: 'Clientes con saldo vencido', num: conVenc, v: String(conVenc), rojo: conVenc > 0 },
        kpi('Límite de crédito otorgado', T.limite, { tarjeta: false }),
      ];

      function agrupa(clave) {
        var m = {};
        filas.forEach(function (r) { var k = r[clave]; var o = m[k] || (m[k] = { g: k, n: 0, compras: 0, total: 0, saldo: 0, vencido: 0 }); o.n++; o.compras += r.compras; o.total = E.r2(o.total + r.total); o.saldo = E.r2(o.saldo + r.saldo); o.vencido = E.r2(o.vencido + r.vencido); });
        return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.total - a.total; });
      }
      function colsRes(t) { return [{ k: 'g', t: t, w: 30 }, { k: 'n', t: 'Clientes', w: 11, num: true }, { k: 'compras', t: '# compras', w: 11, num: true }, { k: 'total', t: 'Total comprado', w: 17, num: true, din: true }, { k: 'saldo', t: 'Por cobrar', w: 16, num: true, din: true }, { k: 'vencido', t: 'Vencido', w: 16, num: true, din: true }]; }
      var S = ['n', 'compras', 'total', 'saldo', 'vencido'];
      var resumenTablas = [
        { subtitulo: 'Por tipo de cliente', columnas: colsRes('Tipo'), filas: agrupa('tipo'), sumar: S },
        { subtitulo: 'Por segmento', columnas: colsRes('Segmento'), filas: agrupa('segmento'), sumar: S },
        { subtitulo: 'Por ciudad', columnas: colsRes('Ciudad'), filas: agrupa('ciudad'), sumar: S },
      ];

      var tListado = { etiquetaTotal: 'TOTAL', sumar: ['compras', 'total', 'limite', 'saldo', 'vencido'], filas: filas,
        columnas: [{ k: 'cliente', t: 'Cliente', w: 30 }, { k: 'empresa', t: 'Empresa', w: 22, p: false }, { k: 'tipo', t: 'Tipo', w: 13 }, { k: 'segmento', t: 'Segmento', w: 13 }, { k: 'ciudad', t: 'Ciudad', w: 15 },
          { k: 'telefono', t: 'Teléfono', w: 14 }, { k: 'correo', t: 'Correo', w: 26, p: false }, { k: 'estado', t: 'Estado', w: 10 },
          { k: 'compras', t: '# compras', w: 10, num: true }, { k: 'total', t: 'Total comprado', w: 16, num: true, din: true }, { k: 'ticket', t: 'Ticket prom.', w: 14, num: true, din: true, p: false },
          { k: 'primera', t: 'Primera compra', w: 13, fecha: true, p: false }, { k: 'ultima', t: 'Última compra', w: 13, fecha: true }, { k: 'sinComprar', t: 'Días sin comprar', w: 11, num: true, p: false },
          { k: 'limite', t: 'Límite crédito', w: 15, num: true, din: true, p: false }, { k: 'saldo', t: 'Por cobrar', w: 15, num: true, din: true }, { k: 'vencido', t: 'Vencido', w: 15, num: true, din: true, rojo: 'rojo' }] };

      var ant = filas.filter(function (r) { return r.saldo > 0.004; }).sort(function (a, b) { return b.saldo - a.saldo; });
      var tAnt = { etiquetaTotal: 'TOTAL', sumar: ['saldo', 'porVencer', 'v1', 'v31', 'v61', 'v90', 'vencido'], filas: ant,
        columnas: [{ k: 'cliente', t: 'Cliente', w: 32 }, { k: 'telefono', t: 'Teléfono', w: 14 }, { k: 'saldo', t: 'Saldo por cobrar', w: 17, num: true, din: true }, { k: 'porVencer', t: 'Por vencer', w: 15, num: true, din: true },
          { k: 'v1', t: 'Vencido 1–30 días', w: 16, num: true, din: true }, { k: 'v31', t: 'Vencido 31–60', w: 15, num: true, din: true }, { k: 'v61', t: 'Vencido 61–90', w: 15, num: true, din: true }, { k: 'v90', t: 'Vencido +90', w: 15, num: true, din: true },
          { k: 'vencido', t: 'Total vencido', w: 15, num: true, din: true, rojo: 'rojo' }, { k: 'atraso', t: 'Mayor atraso (días)', w: 12, num: true }] };
      var hojas = [{ nombre: 'Listado de clientes', titulo: 'Listado de clientes', tablas: [tListado] }];
      if (ant.length) hojas.push({ nombre: 'Antigüedad de saldos', titulo: 'Antigüedad de saldos por cobrar', tablas: [tAnt] });
      return {
        kpis: kpis, resumenTablas: resumenTablas, hojas: hojas,
        totalGeneral: [['Total comprado', E.dinero(T.total)], ['Por cobrar', E.dinero(T.saldo)], ['SALDO VENCIDO', E.dinero(T.venc)]],
        notas: ['Total comprado y # compras son los acumulados guardados en la ficha de cada cliente.',
          'Por cobrar = saldo de los créditos activos (igual que el módulo Créditos). Vencido y su antigüedad salen de las cuotas pendientes con fecha pasada; Por vencer = Por cobrar − Vencido.'],
        mensajeOk: filas.length + ' clientes',
      };
    },
  };

  function nombreC(c) { return ((c.nombre || '') + ' ' + (c.apellido || '')).trim() || 'Sin nombre'; }

  function filtrar(d, op, E) {
    var sel = {}; (op.entidades || []).forEach(function (k) { sel[k] = 1; }); var haySel = (op.entidades || []).length > 0;
    var hoy = d.hoy;
    return d.clientes.filter(function (c) {
      if (op.estado === 'activos' && c.activo === false) return false;
      if (op.estado === 'inactivos' && c.activo !== false) return false;
      if (op.tipo && c.tipo_cliente !== op.tipo) return false;
      if (op.segmento && c.segmento !== op.segmento) return false;
      if (op.ciudad && c.ciudad !== op.ciudad) return false;
      if (op.saldo === 'consaldo' && !(c._saldo > 0.004)) return false;
      if (op.saldo === 'vencidos' && !(c._vencido > 0.004)) return false;
      if (op.saldo === 'sinsaldo' && c._saldo > 0.004) return false;
      if (op.sinCompra === 'concompras' && !(E.num(c.num_compras) > 0)) return false;
      if (op.sinCompra === 'sincompras' && E.num(c.num_compras) > 0) return false;
      if (op.sinCompra === 'inactivo90') { var uc = String(c.ultima_compra || '').slice(0, 10); if (uc && E.diasEntre(uc, hoy) < 90) return false; if (!uc && !(E.num(c.num_compras) > 0)) return false; }
      if (haySel && !sel[c.id]) return false;
      return true;
    });
  }

  window.abrirExportarClientes = function () {
    if (!window.N360Exp) { try { showToast('El exportador no cargó. Recarga la página.', 'error'); } catch (e) {} return; }
    N360Exp.abrir(cfg, { sb: sb, userId: CS.userId, empresaConfig: CS.empresaConfig });
  };
  window._cfgExportarClientes = cfg;
})();
