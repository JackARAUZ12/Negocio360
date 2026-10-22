/* Negocio360 Escritorio — Caja (solo dentro del programa).
 * No deja hacer el cierre de caja (diario o mensual) mientras este equipo
 * tenga ventas guardadas que todavía no subieron: el cierre saldría sin ellas.
 */
(function () {
  'use strict';
  const API = window.negocio360SinConexion;
  if (!API) return;

  function avisar(n) {
    const msg = `Hay ${n} venta(s) de este equipo que todavía no suben al servidor. Espera a que se suban (o revisa la pantalla Sincronización) y luego haz el cierre.`;
    if (typeof window.showToast === 'function') window.showToast(msg, 'error');
    else alert(msg);
  }

  function envolver(nombre) {
    const original = window[nombre];
    if (typeof original !== 'function') return;
    window[nombre] = async function (...args) {
      let n = 0;
      try { n = (await API.estado()).sin_subir_equipo || 0; } catch (_) { n = 0; }
      if (n > 0) { avisar(n); return undefined; }
      return original.apply(this, args);
    };
  }
  envolver('crearCierreDiario');
  envolver('crearCierreMensual');
})();
