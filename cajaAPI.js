/* =====================================================
   cajaAPI.js — NEGOCIO360
   API pública de Caja para uso desde cualquier módulo.
   Incluir ANTES de caja.js y gastos.js en sus respectivos HTML.
   Versión: 1.1
===================================================== */

'use strict';

(function () {
  const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

  // Reusar cliente si ya existe (caja.js lo crea con el mismo nombre)
  const _sb = window.__cajaSB || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window.__cajaSB = _sb;

  function todayISO() { return new Date().toISOString().split('T')[0]; }

  window.CajaAPI = {

    /**
     * Registra un movimiento financiero y actualiza el saldo.
     * Parámetros:
     *   auth_user_id, tipo_flujo ('INGRESO'|'EGRESO'), tipo_movimiento,
     *   concepto, monto, metodo_pago_id?, metodo_pago_nombre?,
     *   referencia_tipo?, referencia_id?, observaciones?, fecha?
     * Retorna: { ok: true, saldoResultante } | { ok: false, error }
     */
    async registrarMovimiento(params) {
      try {
        const userId = params.auth_user_id;
        if (!userId) throw new Error('auth_user_id requerido');

        // Saldo del último movimiento completado
        const { data: ult } = await _sb
          .from('movimientos_financieros')
          .select('saldo_resultante')
          .eq('auth_user_id', userId)
          .eq('estado', 'completado')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const saldoAnt = ult ? Number(ult.saldo_resultante) : 0;
        const monto    = Number(params.monto);
        const saldoRes = params.tipo_flujo === 'INGRESO'
          ? saldoAnt + monto
          : saldoAnt - monto;

        const { error } = await _sb.from('movimientos_financieros').insert({
          auth_user_id:       userId,
          tipo_flujo:         params.tipo_flujo,
          tipo_movimiento:    params.tipo_movimiento,
          concepto:           params.concepto,
          monto:              monto,
          saldo_anterior:     saldoAnt,
          saldo_resultante:   saldoRes,
          metodo_pago_nombre: params.metodo_pago_nombre || 'Efectivo',
          metodo_pago_id:     params.metodo_pago_id     || null,
          referencia_tipo:    params.referencia_tipo    || null,
          referencia_id:      params.referencia_id      || null,
          observaciones:      params.observaciones      || null,
          fecha:              params.fecha               || todayISO(),
          estado:             'completado',
        });

        if (error) throw error;

        // Actualizar caché de localStorage para el dashboard
        try {
          localStorage.setItem('n360_capital', saldoRes.toString());
          localStorage.setItem('n360_caja_updated', new Date().toISOString());
        } catch (_) { /* silencioso */ }

        return { ok: true, saldoResultante: saldoRes };
      } catch (e) {
        console.error('CajaAPI.registrarMovimiento:', e);
        return { ok: false, error: e.message };
      }
    },

    /** Retorna el saldo resultante del último movimiento completado */
    async getCapital(userId) {
      try {
        const { data } = await _sb
          .from('movimientos_financieros')
          .select('saldo_resultante')
          .eq('auth_user_id', userId)
          .eq('estado', 'completado')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data ? Number(data.saldo_resultante) : 0;
      } catch (e) {
        return 0;
      }
    },
  };
})();
