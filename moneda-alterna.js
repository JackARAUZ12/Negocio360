/* ============================================================
   MONEDA-ALTERNA.JS — NEGOCIO360
   Ayuda para escribir un monto en la OTRA moneda: si la cuenta es en
   dólares, "💱 Ingresar en córdobas"; si es en córdobas, "💱 Ingresar
   en dólares". Convierte con la tasa de Caja › Bancos y escribe el
   resultado en el campo de monto de siempre.

   Solo es una calculadora junto al campo: lo que se guarda sigue
   siendo el monto del campo original, en la moneda de la cuenta.
   No toca caja, bancos, contabilidad ni reportes por su cuenta.

   Uso:
     N360MonedaAlterna.adjuntar(input, () => ({ moneda: 'USD', tasa: 37.1 }))
     N360MonedaAlterna.estado(input)  -> { moneda, monto, tasa, base } | null
     N360MonedaAlterna.reset(input)
   ============================================================ */
(function () {
  'use strict';
  if (window.N360MonedaAlterna) return;

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const fmt = n => Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const SIMBOLO = { USD: 'USD', NIO: 'C$' };
  const estados = new WeakMap();

  function estilos() {
    if (document.getElementById('n360-ma-css')) return;
    const st = document.createElement('style');
    st.id = 'n360-ma-css';
    st.textContent = `
      .n360-ma { margin-top: 5px; font-size: 12px; }
      .n360-ma-link { background: none; border: 0; padding: 2px 0; cursor: pointer; font: inherit; font-size: 12px;
        font-weight: 600; color: var(--accent, #6c63ff); }
      .n360-ma-link:hover { text-decoration: underline; }
      .n360-ma-panel { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 4px; padding: 8px 10px;
        border: 1px dashed var(--border, rgba(127,127,127,.35)); border-radius: 8px; background: var(--bg-hover, rgba(127,127,127,.06)); }
      .n360-ma-panel[hidden] { display: none; }
      .n360-ma-panel label { font-weight: 600; color: var(--text-secondary, inherit); white-space: nowrap; }
      .n360-ma-panel input { width: 120px; min-width: 0; flex: 1 1 100px; max-width: 160px; padding: 6px 8px; margin: 0;
        border: 1px solid var(--border, rgba(127,127,127,.35)); border-radius: 6px; background: var(--bg-surface, #fff);
        color: var(--text-primary, inherit); font: inherit; font-size: 13px; text-align: right; }
      .n360-ma-res { flex: 1 1 100%; color: var(--text-secondary, inherit); }
      .n360-ma-res b { color: var(--text-primary, inherit); }
      .n360-ma-err { color: var(--danger, #dc2626); }
      .n360-ma-x { margin-left: auto; background: none; border: 0; cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px;
        color: var(--text-secondary, inherit); }
    `;
    document.head.appendChild(st);
  }

  function datos(input) {
    const e = estados.get(input);
    if (!e) return null;
    let cfg = {};
    try { cfg = e.config() || {}; } catch (_) {}
    const base = cfg.moneda === 'USD' ? 'USD' : 'NIO';
    return { e, base, otra: base === 'USD' ? 'NIO' : 'USD', tasa: Number(cfg.tasa) || 0 };
  }

  // Monto en la moneda de la cuenta a partir del monto en la otra moneda.
  function convertir(monto, base, tasa) {
    if (!(tasa > 0)) return null;
    return r2(base === 'USD' ? monto / tasa : monto * tasa);
  }

  function pintar(input) {
    const d = datos(input); if (!d) return;
    const { e, base, otra, tasa } = d;
    e.link.textContent = e.compacto ? '💱 ' + SIMBOLO[otra] : (otra === 'NIO' ? '💱 Ingresar en córdobas' : '💱 Ingresar en dólares');
    e.link.title = otra === 'NIO' ? 'Ingresar en córdobas' : 'Ingresar en dólares';
    e.lblOtra.textContent = 'Monto en ' + SIMBOLO[otra];
    const monto = parseFloat(e.campo.value);
    if (!(tasa > 0)) {
      e.res.innerHTML = '<span class="n360-ma-err">Falta configurar la tasa de cambio en Caja › Bancos.</span>';
      return;
    }
    if (!(monto > 0)) {
      e.res.textContent = 'Tasa: C$ ' + fmt(tasa) + ' por dólar';
      return;
    }
    const conv = convertir(monto, base, tasa);
    e.res.innerHTML = 'Equivale a <b>' + SIMBOLO[base] + ' ' + fmt(conv) + '</b> · tasa C$ ' + fmt(tasa) + ' por dólar';
  }

  function aplicar(input) {
    const d = datos(input); if (!d) return;
    const monto = parseFloat(d.e.campo.value);
    const conv = monto > 0 ? convertir(monto, d.base, d.tasa) : null;
    d.e.escribiendo = true;
    input.value = conv != null ? conv.toFixed(2) : '';
    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally { d.e.escribiendo = false; }
    pintar(input);
  }

  function cerrar(input) {
    const e = estados.get(input); if (!e) return;
    e.panel.hidden = true;
    e.link.hidden = false;
    e.campo.value = '';
  }

  // opciones.compacto: botón corto "💱 C$" junto al campo y el panel dentro de
  // opciones.contenedor (para filas angostas, como el pago dividido de Ventas).
  function adjuntar(input, config, opciones) {
    if (typeof input === 'string') input = document.getElementById(input);
    if (!input || estados.has(input) || typeof config !== 'function') return;
    const op = opciones || {};
    const compacto = !!(op.compacto && op.contenedor);
    estilos();
    const caja = document.createElement('div');
    caja.className = 'n360-ma';
    caja.innerHTML =
      '<button type="button" class="n360-ma-link"></button>' +
      '<div class="n360-ma-panel" hidden>' +
        '<label></label><input type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">' +
        '<button type="button" class="n360-ma-x" title="Quitar" aria-label="Quitar">✕</button>' +
        '<div class="n360-ma-res"></div>' +
      '</div>';
    if (compacto) {
      const link = caja.querySelector('.n360-ma-link');
      link.style.cssText = 'flex:0 0 auto;white-space:nowrap';
      input.insertAdjacentElement('afterend', link);
      caja.style.marginTop = '0';
      op.contenedor.appendChild(caja);
    } else {
      input.insertAdjacentElement('afterend', caja);
    }
    const e = {
      config, caja, escribiendo: false, compacto,
      link: compacto ? input.nextElementSibling : caja.querySelector('.n360-ma-link'), panel: caja.querySelector('.n360-ma-panel'),
      lblOtra: caja.querySelector('label'), campo: caja.querySelector('.n360-ma-panel input'),
      res: caja.querySelector('.n360-ma-res'),
    };
    estados.set(input, e);
    const id = (input.id || 'm') + '-ma';
    e.campo.id = id; e.lblOtra.htmlFor = id;

    e.link.addEventListener('click', () => {
      e.link.hidden = true; e.panel.hidden = false; pintar(input); e.campo.focus();
    });
    e.campo.addEventListener('input', () => aplicar(input));
    e.panel.querySelector('.n360-ma-x').addEventListener('click', () => cerrar(input));
    // Si la persona escribe directo en el monto original, la conversión ya
    // no aplica: se cierra para que nunca queden dos números distintos.
    input.addEventListener('input', () => { if (!e.escribiendo && !e.panel.hidden) cerrar(input); });
    pintar(input);
  }

  // Lo que se escribió en la otra moneda, solo si sigue coincidiendo con el
  // monto actual del campo (si no coincide, se ignora por seguridad).
  function estado(input) {
    if (typeof input === 'string') input = document.getElementById(input);
    const d = input && datos(input); if (!d || d.e.panel.hidden) return null;
    const monto = parseFloat(d.e.campo.value);
    const conv = monto > 0 ? convertir(monto, d.base, d.tasa) : null;
    const actual = parseFloat(input.value);
    if (conv == null || !(Math.abs(conv - actual) < 0.005)) return null;
    return { moneda: d.otra, monto: r2(monto), tasa: d.tasa, base: conv };
  }

  // Texto corto para dejar constancia (observaciones / nota).
  function nota(input, verbo) {
    const s = estado(input); if (!s) return '';
    return (verbo || 'Pagó') + ' ' + SIMBOLO[s.moneda] + ' ' + fmt(s.monto) + ' (tasa C$ ' + fmt(s.tasa) + ')';
  }

  // Vuelve a abrir el panel con un monto ya escrito (por ejemplo, si la
  // pantalla se redibujó). Recalcula y escribe el monto en el campo.
  function restaurar(input, montoOtra) {
    if (typeof input === 'string') input = document.getElementById(input);
    const e = input && estados.get(input); if (!e || !(montoOtra > 0)) return;
    e.link.hidden = true; e.panel.hidden = false; e.campo.value = String(montoOtra);
    aplicar(input);
  }

  function reset(input) {
    if (typeof input === 'string') input = document.getElementById(input);
    if (input && estados.has(input)) { cerrar(input); pintar(input); }
  }

  window.N360MonedaAlterna = { adjuntar, estado, nota, reset, restaurar, convertir };
})();
