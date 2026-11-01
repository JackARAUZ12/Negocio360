/* iva-lineas.js — IVA con tarifas distintas por producto (SOLO cuentas de Costa Rica con colones; ver cr-modo.js).
 * Función pura de cálculo + carga de las tarifas guardadas en los productos. No toca la base ni la pantalla.
 *
 * REGLA DE SEGURIDAD: si todas las líneas tienen la tarifa general (o ninguna tiene otra), "mixto" es false y quien llama
 * usa EXACTAMENTE la fórmula de siempre (base × tasa, redondeada una sola vez). Solo cuando hay tarifas distintas se suma
 * línea por línea. La base total (subtotal − descuentos) nunca cambia: solo se reparte entre las líneas. */
(function () {
  'use strict';
  if (window.N360IvaLineas) return;
  var r2 = function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; };
  var TARIFAS = [13, 4, 2, 1, 0];

  // lineas: [{ bruto, descLinea, tarifa }]  (tarifa null/undefined = la general)
  // baseObjetivo: la base imponible de la venta (subtotal − todos los descuentos), ya calculada por el sistema.
  function calcular(lineas, baseObjetivo, tasaGeneral) {
    var g = Number(tasaGeneral) || 0;
    var base = Math.max(Number(baseObjetivo) || 0, 0);
    var tar = (lineas || []).map(function (l) { var t = (l && l.tarifa != null && l.tarifa !== '') ? Number(l.tarifa) : g; return isNaN(t) ? g : t; });
    var mixto = tar.some(function (t) { return Math.abs(t - g) > 1e-9; });
    if (!mixto) return { mixto: false };
    var neto = (lineas || []).map(function (l) { return Math.max(r2((Number(l.bruto) || 0) - (Number(l.descLinea) || 0)), 0); });
    var suma = neto.reduce(function (a, b) { return a + b; }, 0);
    var bases = neto.map(function (n) { return suma > 0 ? r2(n * base / suma) : 0; });
    // el redondeo puede dejar unos centavos: se ajustan en la línea más grande para que la suma sea EXACTAMENTE la base
    var dif = r2(base - bases.reduce(function (a, b) { return a + b; }, 0));
    if (suma > 0 && Math.abs(dif) > 0) { var im = 0; bases.forEach(function (b, i) { if (b > bases[im]) im = i; }); bases[im] = r2(bases[im] + dif); }
    var out = bases.map(function (b, i) { return { base: b, tarifa: tar[i], iva: r2(b * tar[i] / 100) }; });
    var iva = r2(out.reduce(function (a, o) { return a + o.iva; }, 0));
    // CANDADO: si algo no cuadra (suma de bases distinta de la base, IVA negativo, o más IVA que aplicando la tarifa más alta a todo),
    // NO se usa este cálculo: se devuelve error y quien llama sigue con el cálculo de siempre.
    var maxT = Math.max.apply(null, tar), sumaBases = r2(bases.reduce(function (a, b) { return a + b; }, 0));
    var malo = Math.abs(sumaBases - r2(base)) > 0.001 || iva < 0 || iva > r2(base * maxT / 100) + 0.05 || out.some(function (o) { return !(o.base >= 0) || !(o.iva >= 0) || !isFinite(o.iva); });
    if (malo) { try { console.warn('IVA por línea: el cálculo no pasó los candados; se usa el cálculo normal', { base: base, bases: bases, iva: iva }); } catch (_) {} return { mixto: false, error: true }; }
    return { mixto: true, iva: iva, lineas: out, efectivo: base > 0 ? r2(iva / base * 100) : g };
  }

  // Tarifas guardadas en los productos (solo las que tienen una). Se cargan una vez; se pueden volver a pedir con recargar=true.
  var mapa = null, cargando = null;
  async function cargarTarifas(sb, recargar) {
    if (mapa && !recargar) return mapa;
    if (cargando) return cargando;
    cargando = (async function () {
      try {
        var d = await sb.from('productos').select('id,iva_tarifa').not('iva_tarifa', 'is', null).limit(5000);
        if (!d || d.error) throw (d && d.error) || new Error('sin respuesta');
        var m = {};
        (d.data || []).forEach(function (p) { m[p.id] = Number(p.iva_tarifa); });
        mapa = m;
      } catch (e) { /* si falla NO se queda un mapa vacío: listo() sigue en false y la venta se detiene */ }
      cargando = null; return mapa;
    })();
    return cargando;
  }
  function listo() { return !!mapa; }
  function tarifaDe(id) { return mapa && id != null && mapa[id] != null ? mapa[id] : null; }

  window.N360IvaLineas = { calcular: calcular, cargarTarifas: cargarTarifas, tarifaDe: tarifaDe, listo: listo, TARIFAS: TARIFAS };
})();
