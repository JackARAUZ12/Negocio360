/* =====================================================
   CAJAAPI.JS — NEGOCIO360
   API compartida de Caja, pensada para ser usada desde
   OTROS módulos (ventas.js, gastos.js, compras.js, etc.)
   cuando necesitan registrar un movimiento financiero o
   consultar el saldo actual sin duplicar lógica.

   IMPORTANTE — por qué existe este archivo por separado:
   Este script se carga en varias páginas junto a otros
   scripts (incluyendo caja.js, que trae su propia copia
   de window.CajaAPI para el módulo de Caja). Para evitar
   que las declaraciones de este archivo choquen con las
   de caja.js ("Identifier ... has already been declared"),
   TODO su contenido vive dentro de un IIFE. Así nunca
   redeclara const/let en el scope global.

   Si en el futuro este archivo vuelve a crecer y a
   duplicar UI, saldo, estado, etc. de caja.js, va a
   volver a romper caja.html — mantenerlo así de delgado
   es intencional.
===================================================== */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

  // Reutiliza el cliente de Supabase si otro script (p. ej. caja.js)
  // ya lo creó antes; si no, lo crea y lo comparte en window.__cajaSB.
  const sb = window.__cajaSB || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window.__cajaSB = sb;

  // FIX CRÍTICO DE ZONA HORARIA: toISOString() da la fecha en UTC;
  // en Nicaragua (UTC-6) eso adelanta el "día" a las 6 PM hora local.
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  async function currentUserId() {
    try {
      const { data } = await sb.auth.getUser();
      return data?.user?.id || null;
    } catch (e) {
      return null;
    }
  }

  window.CajaAPI = {
    /**
     * Registra un movimiento financiero (ingreso o egreso) y
     * recalcula el saldo en cadena a partir del último
     * movimiento completado. Usado por ventas, compras, gastos, etc.
     */
    async registrarMovimiento(params) {
      try {
        const userId = params.auth_user_id || await currentUserId();
        if (!userId) throw new Error('userId requerido');

        const { data: ult } = await sb
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

        const { error } = await sb.from('movimientos_financieros').insert({
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
          fecha:              params.fecha              || todayISO(),
          estado:             'completado',
        });

        if (error) throw error;

        try {
          localStorage.setItem('n360_caja', saldoRes.toString());
          localStorage.setItem('n360_capital', saldoRes.toString());
          localStorage.setItem('n360_caja_updated', new Date().toISOString());
        } catch (_) { /* silencioso */ }

        return { ok: true, saldoResultante: saldoRes };
      } catch (e) {
        console.error('CajaAPI.registrarMovimiento:', e);
        return { ok: false, error: e.message };
      }
    },

    /** Devuelve el saldo actual (último movimiento completado). */
    async getCapital(userId) {
      try {
        const uid = userId || await currentUserId();
        const { data } = await sb
          .from('movimientos_financieros')
          .select('saldo_resultante')
          .eq('auth_user_id', uid)
          .eq('estado', 'completado')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data ? Number(data.saldo_resultante) : 0;
      } catch (e) {
        return 0;
      }
    },

    /** Alias de getCapital, por compatibilidad con código existente. */
    async getCaja(userId) {
      return this.getCapital(userId);
    },
  };
})();
