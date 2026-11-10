/* =====================================================================
   INTERESES-COBRADOS.JS — Negocio360 (10-nov-2026)
   ---------------------------------------------------------------------
   Ganancia de los PRÉSTAMOS (créditos financieros): la parte de INTERÉS
   de cada pago cobrado en el período. El capital que regresa NO es
   ganancia. Ej.: préstamo de 4,000 que se cobra en 5,120 → el 21.9% de
   cada pago es interés.

   - Solo créditos tipo 'financiero' (préstamos en efectivo). Las ventas
     al crédito ya cuentan su ganancia en Ventas, así no se duplica.
   - Solo pagos 'completado' con fecha dentro del período (un pago
     anulado deja de contar solo).
   - La proporción sale de las cuotas del propio crédito
     (Σ interés / Σ monto de cuotas), así el IVA o mora no se cuentan
     como interés.
   - Solo LEE. No toca caja, saldos ni créditos.
   ===================================================================== */
(function () {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  async function leerPaginado(construir) {
    const out = [];
    const PAG = 1000;
    for (let desde = 0; desde < 200000; desde += PAG) {
      const { data, error } = await construir().range(desde, desde + PAG - 1);
      if (error) throw error;
      const filas = data || [];
      out.push(...filas);
      if (filas.length < PAG) break;
    }
    return out;
  }

  /** Total de intereses cobrados entre `desde` y `hasta` (YYYY-MM-DD, inclusive). */
  async function total(sb, userId, desde, hasta) {
    if (!sb || !userId) return 0;
    try {
      const pagos = await leerPaginado(() => sb.from('creditos_pagos')
        .select('id,credito_id,monto,fecha')
        .eq('auth_user_id', userId).eq('estado', 'completado')
        .gte('fecha', desde).lte('fecha', String(hasta).slice(0, 10))
        .order('id'));
      if (!pagos.length) return 0;

      const ids = [...new Set(pagos.map(p => p.credito_id).filter(Boolean))];
      const proporcion = new Map();   // credito_id -> fracción de interés
      for (let i = 0; i < ids.length; i += 150) {
        const lote = ids.slice(i, i + 150);
        const { data: creds, error: e1 } = await sb.from('creditos').select('id,tipo,total_intereses,total_financiado')
          .eq('auth_user_id', userId).in('id', lote);
        if (e1) throw e1;
        const financieros = (creds || []).filter(c => c.tipo === 'financiero');
        if (!financieros.length) continue;
        const cuotas = await leerPaginado(() => sb.from('creditos_cuotas').select('id,credito_id,monto_total,interes')
          .eq('auth_user_id', userId).in('credito_id', financieros.map(c => c.id)).order('id'));
        const suma = new Map();
        cuotas.forEach(q => {
          const a = suma.get(q.credito_id) || { tot: 0, int: 0 };
          a.tot += Number(q.monto_total || 0); a.int += Number(q.interes || 0);
          suma.set(q.credito_id, a);
        });
        financieros.forEach(c => {
          const a = suma.get(c.id);
          let f = 0;
          if (a && a.tot > 0) f = a.int / a.tot;
          else if (Number(c.total_financiado) > 0) f = Number(c.total_intereses || 0) / Number(c.total_financiado);
          proporcion.set(c.id, Math.min(1, Math.max(0, f)));
        });
      }
      return r2(pagos.reduce((s, p) => s + Number(p.monto || 0) * (proporcion.get(p.credito_id) || 0), 0));
    } catch (e) {
      console.warn('N360InteresesCobrados:', e);
      return 0;
    }
  }

  window.N360InteresesCobrados = { total };
})();
