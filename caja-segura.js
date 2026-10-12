/* ============================================================
   CAJA SEGURA — que una venta nunca quede "pagada" sin su
   movimiento en Caja, y que anular una venta cierre bien.

   Antes: la venta se guardaba y luego, en un paso aparte, se
   anotaba el ingreso en Caja. Si ese segundo paso fallaba (internet,
   pantalla cerrada, error), el error se ignoraba: la venta quedaba
   pagada y la Caja sin el dinero, y nadie se enteraba.

   Ahora, para cada movimiento de Caja:
     1. se intenta guardar; si falla, se reintenta (3 intentos);
     2. antes de reintentar se revisa que no se haya guardado ya
        (por si la respuesta se perdió) para no duplicar;
     3. si de verdad no se pudo, se AVISA en pantalla y queda en una
        cola de pendientes que se reintenta sola al abrir Ventas,
        Proformas o Caja.

   Este módulo es aditivo: no cambia ninguna tabla ni formato.
   El saldo lo encadena el servidor (trigger trg_00_encadenar_saldo).
   ============================================================ */
(function () {
  'use strict';
  if (window.N360CajaSegura) return;

  var LS = 'n360_caja_pendientes';
  var reintentando = false;

  function leer() { try { return JSON.parse(localStorage.getItem(LS) || '[]') || []; } catch (_) { return []; } }
  function guardar(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (_) { /* sin storage: solo se avisa */ } }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function aviso(msg, tipo) { try { if (typeof showToast === 'function') showToast(msg, tipo || 'warning'); } catch (_) { /* nada */ } }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ¿Ya existe este mismo movimiento? (la respuesta pudo perderse) */
  async function yaExiste(sb, f) {
    try {
      if (!f || !f.referencia_id) return null;
      var r = await sb.from('movimientos_financieros').select('id')
        .eq('auth_user_id', f.auth_user_id)
        .eq('referencia_tipo', f.referencia_tipo || 'venta')
        .eq('referencia_id', f.referencia_id)
        .eq('tipo_flujo', f.tipo_flujo)
        .neq('estado', 'anulado')
        .eq('concepto', f.concepto)
        .limit(1).maybeSingle();
      return (r && r.data) ? r.data : null;
    } catch (_) { return null; }
  }

  /* Saldo "de cortesía" para filas que no lo traen; el servidor lo recalcula igual. */
  async function completarSaldo(sb, f) {
    if (f.saldo_anterior != null && f.saldo_resultante != null) return f;
    var ult = null;
    try {
      var r = await sb.from('movimientos_financieros').select('saldo_resultante')
        .eq('auth_user_id', f.auth_user_id).eq('estado', 'completado')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      ult = r && r.data ? Number(r.data.saldo_resultante) : 0;
    } catch (_) { ult = 0; }
    var ant = ult || 0;
    var res = f.tipo_flujo === 'INGRESO' ? ant + Number(f.monto) : ant - Number(f.monto);
    return Object.assign({}, f, { saldo_anterior: r2(ant), saldo_resultante: r2(res) });
  }

  function encolar(fila, etiqueta) {
    var a = leer();
    a.push({ fila: fila, etiqueta: etiqueta || '', ts: Date.now() });
    guardar(a);
  }

  /* Inserta un movimiento de Caja con reintentos. Devuelve {data, error, pendiente}. */
  async function insertarMovimiento(sb, fila, opts) {
    opts = opts || {};
    var intentos = opts.intentos || 3;
    var ultimo = null;
    var f = await completarSaldo(sb, fila);
    for (var i = 0; i < intentos; i++) {
      if (i > 0) {
        await esperar(i === 1 ? 700 : 1500);
        var ex = await yaExiste(sb, f);
        if (ex) return { data: ex, error: null, reintentos: i };
      }
      try {
        var r = await sb.from('movimientos_financieros').insert(f).select('id').single();
        if (!r.error && r.data) return { data: r.data, error: null, reintentos: i };
        ultimo = r.error || new Error('Sin respuesta');
      } catch (e) { ultimo = e; }
    }
    console.warn('CajaSegura: no se pudo registrar en Caja', f.concepto, ultimo);
    encolar(f, opts.etiqueta);
    aviso('⚠ ' + (opts.etiqueta || 'Un movimiento') + ' se guardó pero NO se pudo registrar en Caja. Quedó pendiente y se reintentará solo al abrir Ventas o Caja.', 'error');
    return { data: null, error: ultimo, reintentos: intentos, pendiente: true };
  }

  /* Reintenta lo que quedó pendiente (solo de este usuario). */
  async function reintentarPendientes(sb, userId) {
    if (reintentando) return 0;
    reintentando = true;
    var hechos = 0;
    try {
      var a = leer();
      if (!a.length) return 0;
      var quedan = [];
      for (var i = 0; i < a.length; i++) {
        var it = a[i];
        if (!it || !it.fila || (userId && it.fila.auth_user_id !== userId)) { quedan.push(it); continue; }
        var ex = await yaExiste(sb, it.fila);
        if (ex) { hechos++; continue; }
        try {
          var r = await sb.from('movimientos_financieros').insert(it.fila).select('id').single();
          if (!r.error && r.data) {
            hechos++;
            if (it.fila.referencia_tipo === 'venta' && it.fila.tipo_flujo === 'INGRESO') {
              try { await sb.from('ventas').update({ referencia_caja: r.data.id }).eq('id', it.fila.referencia_id).is('referencia_caja', null); } catch (_) { /* opcional */ }
            }
          } else quedan.push(it);
        } catch (_) { quedan.push(it); }
      }
      guardar(quedan);
      if (hechos > 0) aviso('✅ Se registraron en Caja ' + hechos + ' movimiento(s) que habían quedado pendientes.', 'success');
    } finally { reintentando = false; }
    return hechos;
  }

  function pendientes() { return leer().length; }

  /* ---------- Anular una venta: reversar en Caja TODAS sus líneas, una sola vez ---------- */
  async function reversarVentaEnCaja(sb, userId, ventaId, numeroVenta, fechaISO) {
    // Solo ingresos COMPLETADOS (un ingreso ya anulado no se vuelve a descontar).
    var q1 = await sb.from('movimientos_financieros')
      .select('monto, banco_id, metodo_pago_id, metodo_pago_nombre')
      .eq('referencia_tipo', 'venta').eq('referencia_id', ventaId)
      .eq('auth_user_id', userId).eq('tipo_flujo', 'INGRESO').eq('estado', 'completado');
    if (q1.error) return { ok: false, error: q1.error, motivo: 'consulta' };
    var ingresos = (q1.data || []).filter(function (m) { return Number(m.monto) > 0; });
    if (!ingresos.length) return { ok: true, lineas: 0, motivo: 'sin_ingreso' };

    // Si ya hay un reverso completado de esta venta, no se duplica.
    var q2 = await sb.from('movimientos_financieros').select('id')
      .eq('referencia_tipo', 'venta').eq('referencia_id', ventaId)
      .eq('auth_user_id', userId).eq('tipo_flujo', 'EGRESO').eq('estado', 'completado')
      .like('concepto', 'Reverso por anulación%').limit(1);
    if (!q2.error && q2.data && q2.data.length) return { ok: true, lineas: 0, motivo: 'ya_reversada' };

    var base = ('Reverso por anulación de venta ' + (numeroVenta || '')).trim();
    var fallos = 0, hechas = 0;
    for (var i = 0; i < ingresos.length; i++) {
      var m = ingresos[i];
      var concepto = ingresos.length > 1 ? base + ' — ' + (m.metodo_pago_nombre || 'línea ' + (i + 1)) : base;
      var res = await insertarMovimiento(sb, {
        auth_user_id: userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'OTRO_EGRESO',
        concepto: concepto, monto: r2(Number(m.monto)),
        metodo_pago_id: m.metodo_pago_id || null, metodo_pago_nombre: m.metodo_pago_nombre || null,
        banco_id: m.banco_id || null, referencia_tipo: 'venta', referencia_id: ventaId,
        fecha: fechaISO, estado: 'completado',
      }, { etiqueta: 'El reverso de la venta ' + (numeroVenta || '') });
      if (res.error) fallos++; else hechas++;
    }
    return { ok: fallos === 0, lineas: hechas, fallos: fallos };
  }

  window.N360CajaSegura = {
    insertarMovimiento: insertarMovimiento,
    reintentarPendientes: reintentarPendientes,
    reversarVentaEnCaja: reversarVentaEnCaja,
    pendientes: pendientes,
    _yaExiste: yaExiste,
  };
})();
