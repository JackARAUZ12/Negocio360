/* ============================================================
   VUELTO-EFECTIVO.JS — NEGOCIO360 · "¿Con cuánto paga?"
   Calculadora de vuelto al cobrar en EFECTIVO (Nueva Venta y Venta
   rápida), en córdobas o en dólares, con la tasa de Caja › Bancos.

   Es SOLO una ayuda para el cajero:
     - NO cambia el total, la Caja, los bancos, el inventario ni los
       reportes. A Caja entra lo de siempre (el total de la venta).
     - Lo recibido y el vuelto quedan como nota en la venta y salen
       en el ticket.
     - El campo es opcional: si no se escribe nada, la venta sigue
       exactamente como antes.
     - Candado: si se escribe un monto MENOR a lo que se cobra, no
       deja confirmar ("Faltan C$ …").
   Todo se calcula en centavos enteros (nunca hay medio centavo).
   ============================================================ */
(function () {
  'use strict';
  if (window.N360Vuelto) return;

  // Billetes por moneda. Moneda local desconocida: sin botones de billetes (se escribe el monto).
  const BILLETES_LOCAL = { NIO: [10, 20, 50, 100, 200, 500, 1000], CRC: [1000, 2000, 5000, 10000, 20000] };
  const NOMBRE_LOCAL = { NIO: 'córdobas', CRC: 'colones' };
  const BILLETES_USD = [1, 5, 10, 20, 50, 100];
  const c = n => Math.round((Number(n) || 0) * 100);            // a centavos
  const d = n => n / 100;                                         // de centavos
  const fmt = n => Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtTasa = n => Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 4 });   // 36.6243 completa
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // Estado por pantalla: 'nv' (Nueva Venta) y 'vr' (Venta rápida)
  const EST = { nv: nuevo(), vr: nuevo() };
  function nuevo() { return { moneda: null, centavos: 0, entrega: 'local', abierto: false }; }
  // Venta rápida: el negocio elige si el panel sale abierto, cerrado (un toque para abrirlo) o apagado.
  // Nueva Venta: siempre abierto, como antes.
  function modoPanel(modo) {
    if (modo !== 'vr') return 'abierto';
    let m = null; try { m = (typeof VR !== 'undefined' && VR.config) ? VR.config.vuelto_modo : null; } catch (_) {}
    if (m !== 'apagado' && window.N360POS && N360POS.enCobro && N360POS.enCobro()) return 'abierto';   // caja POS: el cobro está siempre a la vista (versión compacta)
    return (m === 'abierto' || m === 'apagado') ? m : 'cerrado';
  }
  const TICKET = {};   // número de venta -> datos para imprimir el ticket

  /* ---------- Lectura del contexto de ventas.js (solo lectura) ---------- */
  function cfg() {
    let ec = {};
    try { ec = (typeof S !== 'undefined' && S.empresaConfig) || {}; } catch (_) {}
    const base = ec.moneda === 'USD' ? 'USD' : 'NIO';
    const tasa = Number(ec.tasa_cambio_usd) || 0;
    // Moneda local real (córdobas en casi todas las cuentas; colones en Costa Rica). Cuenta en dólares: la local es córdobas.
    const codLocal = base === 'USD' ? 'NIO' : (ec.moneda === 'CRC' ? 'CRC' : (!ec.moneda || ec.moneda === 'NIO' || ec.moneda === 'C$' ? 'NIO' : String(ec.moneda)));
    let simLocal = 'C$';
    try { if (base !== 'USD' && typeof monedaParaMostrar === 'function') simLocal = monedaParaMostrar(ec.moneda) || 'C$'; } catch (_) {}
    if (!simLocal || simLocal === 'NIO') simLocal = 'C$';
    const nombreLocal = NOMBRE_LOCAL[codLocal] || 'moneda local';
    const billetesLocal = BILLETES_LOCAL[codLocal] || [];
    return { base, tasa, simLocal, nombreLocal, billetesLocal };
  }
  function contexto(modo) {
    try {
      if (modo === 'nv') {
        const id = S.metodoPagoId, nom = String(S.metodoPagoNombre || '').toLowerCase();
        const ok = !!id && id !== 'separado' && id !== 'fiado' && nom.includes('efectivo');
        return { visible: ok, totalBase: Number(S._resumen?.cobrar) || 0, ancla: document.getElementById('metodos-grid') };
      }
      const id = VR.metodoPagoId, nom = String(VR.metodoPagoNombre || '').toLowerCase();
      const ok = !!id && id !== 'separado' && nom.includes('efectivo');
      let total = 0;
      if (ok && typeof calcularResumenVR === 'function') total = Number(calcularResumenVR().total) || 0;
      return { visible: ok, totalBase: total, ancla: document.getElementById('vr-metodos-grid') };
    } catch (_) { return { visible: false, totalBase: 0, ancla: null }; }
  }

  /* ---------- Cálculo (todo en centavos de la moneda LOCAL) ---------- */
  function calcular(modo) {
    const k = cfg(), ctx = contexto(modo), e = EST[modo];
    const hayDolar = k.tasa > 0;
    const baseMon = k.base === 'USD' ? 'USD' : 'NIO';
    const monedaPago = hayDolar && (e.moneda === 'USD' || e.moneda === 'NIO') ? e.moneda : baseMon;
    const tasaC = c(k.tasa);
    // Total a cobrar en la moneda base y en local
    const totalBaseC = c(ctx.totalBase);
    const aLocal = (cent, mon) => mon === 'NIO' ? cent : usdALocal(cent, k.tasa);   // USD -> C$ (centavos, exacto)
    const baseEsLocal = k.base !== 'USD';
    const r = { k, ctx, monedaPago, hayDolar, totalBaseC, recibidoC: e.centavos, estado: 'vacio' };
    if (!(e.centavos > 0)) return r;
    if (!baseEsLocal && !hayDolar) {
      // Cuenta en dólares sin tasa: todo en dólares
      const v = e.centavos - totalBaseC;
      r.estado = v < 0 ? 'falta' : 'ok'; r.faltaC = Math.max(0, -v); r.vueltoBaseC = Math.max(0, v); r.soloBase = true;
      return r;
    }
    if (!baseEsLocal && r.monedaPago === 'USD') {
      // Cuenta en dólares y paga en dólares: dólares menos dólares, sin pasar por córdobas (cero redondeos).
      const v = e.centavos - totalBaseC;
      r.usdDirecto = true;
      if (v < 0) { r.estado = 'falta'; r.faltaC = -v; r.faltaLocalC = usdALocal(-v, k.tasa); return r; }
      r.estado = v === 0 ? 'exacto' : 'ok';
      r.vueltoBaseC = v; r.vueltoLocalC = usdALocal(v, k.tasa);
      return r;
    }
    const totalLocalC = baseEsLocal ? totalBaseC : usdALocal(totalBaseC, k.tasa);
    const recibidoLocalC = aLocal(e.centavos, r.monedaPago);
    const vLocal = recibidoLocalC - totalLocalC;
    r.totalLocalC = totalLocalC; r.recibidoLocalC = recibidoLocalC;
    if (vLocal < 0) {
      r.estado = 'falta'; r.faltaLocalC = -vLocal;
      return r;
    }
    r.estado = vLocal === 0 ? 'exacto' : 'ok';
    r.vueltoLocalC = vLocal;
    // Opción en dólares: dólares enteros + el resto en córdobas
    if (hayDolar && tasaC > 0) {
      const dol = Math.floor(vLocal * 100 / tasaDiez(k.tasa));       // dólares enteros que caben (enteros exactos)
      const resto = vLocal - usdALocal(dol * 100, k.tasa);
      if (dol >= 1 && resto >= 0) { r.opDolares = dol; r.opRestoLocalC = resto; }
    }
    if (r.estado === 'ok' && !r.opDolares) e.entrega = 'local';
    return r;
  }
  // Tasa en diezmilésimas (36.6243 -> 366243) y conversiones con ENTEROS: sin errores de punto flotante.
  function tasaDiez(tasa) { return Math.round((Number(tasa) || 0) * 10000); }
  function usdALocal(centUsd, tasa) {               // centavos de dólar -> centavos de córdoba, redondeo normal (.5 sube)
    const t = tasaDiez(tasa); if (!(t > 0)) return 0;
    return Math.floor((centUsd * t + 5000) / 10000);
  }
  function localAUsdArriba(centLocal, tasa) {       // centavos de córdoba -> centavos de dólar que alcanzan (hacia arriba)
    const t = tasaDiez(tasa); if (!(t > 0)) return 0;
    return Math.floor((centLocal * 10000 + t - 1) / t);
  }

  /* ---------- Textos ---------- */
  function sim(mon, k) { return mon === 'USD' ? '$' : k.simLocal; }
  function textoVuelto(r, entrega) {
    const k = r.k;
    if (r.soloBase) return `$ ${fmt(d(r.vueltoBaseC))}`;
    if (r.usdDirecto) return entrega === 'local' ? `${k.simLocal} ${fmt(d(r.vueltoLocalC))}` : `$ ${fmt(d(r.vueltoBaseC))}`;
    if (entrega === 'usd' && r.opDolares) return `$ ${fmt(r.opDolares)}${r.opRestoLocalC > 0 ? ` + ${k.simLocal} ${fmt(d(r.opRestoLocalC))}` : ''}`;
    return `${k.simLocal} ${fmt(d(r.vueltoLocalC))}`;
  }
  function textoRecibido(r) {
    const k = r.k;
    const base = `${sim(r.monedaPago, k)} ${fmt(d(r.recibidoC))}`;
    if (r.soloBase) return base;
    const baseMon = k.base === 'USD' ? 'USD' : 'NIO';
    let enOtra = '';
    if (r.monedaPago !== baseMon) enOtra = r.monedaPago === 'USD'
      ? ` (tasa ${k.simLocal} ${fmtTasa(k.tasa)} = ${k.simLocal} ${fmt(d(r.recibidoLocalC))})`
      : ` (tasa ${k.simLocal} ${fmtTasa(k.tasa)} = $ ${fmt(d(r.recibidoC) / k.tasa)})`;
    return base + enOtra;
  }

  /* ---------- Interfaz ---------- */
  function estilos() {
    if (document.getElementById('n360-vu-css')) return;
    const st = document.createElement('style');
    st.id = 'n360-vu-css';
    st.textContent = `
.n360-vu { margin-top: 14px; padding: 12px; border: 1.5px solid var(--border-color, rgba(127,127,127,.3)); border-radius: var(--radius-md, 12px); background: var(--bg-hover, rgba(127,127,127,.05)); }
.n360-vu-cab { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.n360-vu-cab b { font-size: 14px; color: var(--text-primary, inherit); }
.n360-vu-cab span { font-size: 13px; color: var(--text-secondary, inherit); }
.n360-vu-cab span strong { color: var(--text-primary, inherit); font-variant-numeric: tabular-nums; }
.n360-vu-mon { display: inline-flex; border: 1px solid var(--border-color, rgba(127,127,127,.3)); border-radius: 10px; padding: 3px; margin-bottom: 10px; background: var(--bg-surface, var(--bg-secondary, #fff)); }
.n360-vu-mon button { border: 0; background: transparent; font: inherit; font-size: 13.5px; font-weight: 700; padding: 8px 16px; border-radius: 8px; cursor: pointer; color: var(--text-secondary, inherit); min-height: 38px; }
.n360-vu-mon button.on { background: var(--accent, #5a5af4); color: #fff; }
.n360-vu-bil { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
.n360-vu-bil button { border: 1px solid var(--border-color, rgba(127,127,127,.3)); background: var(--bg-surface, var(--bg-secondary, #fff)); color: var(--text-primary, inherit); font: inherit; font-size: 14px; font-weight: 700; padding: 10px 4px; border-radius: 10px; cursor: pointer; min-height: 44px; font-variant-numeric: tabular-nums; }
.n360-vu-bil button:active { transform: scale(.97); }
.n360-vu-bil button.ex { border-color: var(--success, #16a34a); color: var(--success, #16a34a); }
.n360-vu-fila { display: flex; gap: 6px; align-items: center; }
.n360-vu-fila input { flex: 1; min-width: 0; min-height: 44px; padding: 0 12px; border: 1px solid var(--border-color, rgba(127,127,127,.3)); border-radius: 10px; background: var(--bg-surface, var(--bg-secondary, #fff)); color: var(--text-primary, inherit); font: inherit; font-size: 16px; font-weight: 700; text-align: right; }
.n360-vu-fila button { min-height: 44px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--border-color, rgba(127,127,127,.3)); background: transparent; color: var(--text-secondary, inherit); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.n360-vu-res { margin-top: 10px; padding: 12px; border-radius: 10px; text-align: center; font-size: 13px; color: var(--text-secondary, inherit); background: var(--bg-surface, var(--bg-secondary, #fff)); }
.n360-vu-res.ok { border: 2px solid var(--success, #16a34a); }
.n360-vu-res.falta { border: 2px solid var(--danger, #dc2626); color: var(--danger, #dc2626); font-weight: 700; font-size: 16px; }
.n360-vu-res.exacto { border: 2px solid var(--success, #16a34a); color: var(--success, #16a34a); font-weight: 800; font-size: 17px; }
.n360-vu-lbl { font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary, inherit); }
.n360-vu-big { font-size: 30px; font-weight: 800; color: var(--success, #16a34a); line-height: 1.15; margin: 2px 0; font-variant-numeric: tabular-nums; }
.n360-vu-sub { font-size: 12px; color: var(--text-secondary, inherit); }
.n360-vu-ops { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
.n360-vu-ops button { border: 1.5px solid var(--border-color, rgba(127,127,127,.3)); background: transparent; color: var(--text-primary, inherit); font: inherit; font-size: 13px; font-weight: 700; padding: 9px 6px; border-radius: 10px; cursor: pointer; line-height: 1.3; min-height: 48px; }
.n360-vu-ops button small { display: block; font-size: 11px; font-weight: 600; color: var(--text-secondary, inherit); }
.n360-vu-ops button.on { border-color: var(--success, #16a34a); background: color-mix(in srgb, var(--success, #16a34a) 10%, transparent); }
.n360-vu.n360-vu-min { padding: 0; border: 0; background: transparent; }
.n360-vu-abrir { width: 100%; min-height: 44px; border: 1.5px dashed var(--border-color, rgba(127,127,127,.4)); background: transparent; color: var(--text-secondary, inherit); font: inherit; font-size: 14px; font-weight: 700; border-radius: 10px; cursor: pointer; }
.n360-vu-abrir:hover { border-color: var(--accent, #5a5af4); color: var(--accent, #5a5af4); }
.n360-vu-hint { font-size: 11.5px; color: var(--text-muted, var(--text-secondary, inherit)); margin-top: 8px; text-align: center; }
@media (max-width: 420px) { .n360-vu-big { font-size: 26px; } .n360-vu-bil button { font-size: 13px; } }
`;
    document.head.appendChild(st);
  }

  function panel(modo) {
    let p = document.getElementById('n360-vu-' + modo);
    const ctx = contexto(modo);
    if (!p && ctx.ancla) {
      estilos();
      p = document.createElement('div');
      p.id = 'n360-vu-' + modo; p.className = 'n360-vu'; p.style.display = 'none';
      ctx.ancla.insertAdjacentElement('afterend', p);
      p.addEventListener('click', ev => alClic(modo, ev));
      p.addEventListener('input', ev => { if (ev.target && ev.target.matches('input')) alEscribir(modo, ev.target); });
    }
    return p;
  }

  function pintar(modo) {
    const p = panel(modo); if (!p) return;
    const ctx = contexto(modo);
    if (!ctx.visible) { p.style.display = 'none'; return; }
    const e = EST[modo], k = cfg();
    const mp = modoPanel(modo);
    if (mp === 'apagado') { e.centavos = 0; p.innerHTML = ''; p.style.display = 'none'; return; }
    if (mp === 'cerrado' && !e.abierto && !(e.centavos > 0)) {
      p.innerHTML = `<button type="button" data-abrir="1" class="n360-vu-abrir">💵 Calcular vuelto</button>`;
      p.classList.add('n360-vu-min'); p.style.display = '';
      return;
    }
    p.classList.remove('n360-vu-min');
    if (!e.moneda) { e.moneda = k.base === 'USD' ? 'USD' : 'NIO'; if (k.base === 'USD') e.entrega = 'usd'; }   // cuenta en dólares: vuelto en dólares por defecto
    if (!(k.tasa > 0)) e.moneda = k.base === 'USD' ? 'USD' : 'NIO';
    const r = calcular(modo);
    const mon = r.monedaPago;
    const s = sim(mon, k);
    // Total a cobrar en la moneda en que paga
    let totalTxt = `${sim(k.base === 'USD' ? 'USD' : 'NIO', k)} ${fmt(d(r.totalBaseC))}`;
    if (k.tasa > 0 && mon !== (k.base === 'USD' ? 'USD' : 'NIO')) {
      const enMon = mon === 'USD' ? localAUsdArriba(r.totalBaseC, k.tasa) : usdALocal(r.totalBaseC, k.tasa);
      totalTxt += ` <span class="n360-vu-sub">(= ${s} ${fmt(d(enMon))})</span>`;
    }
    const inp = p.querySelector('input');
    const enfocado = inp && document.activeElement === inp;
    const valorEscrito = inp ? inp.value : '';

    let res = '';
    if (r.estado === 'vacio') res = `<div class="n360-vu-res">Opcional: toca los billetes que te dio el cliente y te digo el vuelto.</div>`;
    else if (r.estado === 'falta') {
      const falt = (r.soloBase || r.usdDirecto) ? `$ ${fmt(d(r.faltaC))}` : `${k.simLocal} ${fmt(d(r.faltaLocalC))}${k.tasa > 0 ? ` <span style="font-weight:600">(≈ $ ${fmt(d(r.faltaLocalC) / k.tasa)})</span>` : ''}`;
      res = `<div class="n360-vu-res falta">Faltan ${falt}<div class="n360-vu-sub" style="font-weight:600;margin-top:4px">Lo recibido no alcanza. Corrige el monto o bórralo.</div></div>`;
    } else if (r.estado === 'exacto') res = `<div class="n360-vu-res exacto">✓ Pago exacto, sin vuelto</div>`;
    else {
      const ops = r.usdDirecto
        ? `<div class="n360-vu-ops">
             <button type="button" data-entrega="usd" class="${e.entrega !== 'local' ? 'on' : ''}">En dólares<small>$ ${fmt(d(r.vueltoBaseC))}</small></button>
             <button type="button" data-entrega="local" class="${e.entrega === 'local' ? 'on' : ''}">Todo en ${esc(k.nombreLocal)}<small>${k.simLocal} ${fmt(d(r.vueltoLocalC))}</small></button>
           </div><div class="n360-vu-hint">Toca cómo le das el vuelto (queda en el ticket).</div>`
        : (!r.soloBase && r.opDolares)
        ? `<div class="n360-vu-ops">
             <button type="button" data-entrega="local" class="${e.entrega !== 'usd' ? 'on' : ''}">Todo en ${esc(k.nombreLocal)}<small>${k.simLocal} ${fmt(d(r.vueltoLocalC))}</small></button>
             <button type="button" data-entrega="usd" class="${e.entrega === 'usd' ? 'on' : ''}">En dólares<small>$ ${fmt(r.opDolares)}${r.opRestoLocalC > 0 ? ` + ${k.simLocal} ${fmt(d(r.opRestoLocalC))}` : ''}</small></button>
           </div><div class="n360-vu-hint">Toca cómo le das el vuelto (queda en el ticket).</div>` : '';
      const equiv = (!r.soloBase && !r.usdDirecto && k.tasa > 0) ? `<div class="n360-vu-sub">equivale a $ ${fmt(d(r.vueltoLocalC) / k.tasa)}</div>` : '';
      res = `<div class="n360-vu-res ok"><div class="n360-vu-lbl">Vuelto</div><div class="n360-vu-big">${esc(textoVuelto(r, e.entrega))}</div>${e.entrega === 'usd' && (r.opDolares || r.usdDirecto) ? '' : equiv}${ops}</div>`;
    }

    const exacto = k.tasa > 0 || mon === (k.base === 'USD' ? 'USD' : 'NIO');
    p.innerHTML = `
      <div class="n360-vu-cab"><b>💵 ¿Con cuánto paga?</b><span>A cobrar: <strong>${totalTxt}</strong>${mp === 'cerrado' ? ` <button type="button" data-cerrar="1" title="Cerrar" aria-label="Cerrar calculadora de vuelto" style="margin-left:6px;border:0;background:transparent;color:inherit;font:inherit;font-size:15px;cursor:pointer;padding:2px 6px">✕</button>` : ''}</span></div>
      ${k.tasa > 0 ? `<div class="n360-vu-mon" role="group" aria-label="Moneda con que paga">
        <button type="button" data-mon="NIO" class="${mon === 'NIO' ? 'on' : ''}">${k.nombreLocal.charAt(0).toUpperCase() + k.nombreLocal.slice(1)}</button>
        <button type="button" data-mon="USD" class="${mon === 'USD' ? 'on' : ''}">Dólares</button></div>` : ''}
      <div class="n360-vu-bil">
        ${exacto ? `<button type="button" class="ex" data-exacto="1">Exacto</button>` : ''}
        ${(mon === 'USD' ? BILLETES_USD : k.billetesLocal).map(b => `<button type="button" data-bil="${b}">${s}${b.toLocaleString('es-NI')}</button>`).join('')}
      </div>
      <div class="n360-vu-fila">
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="o escribe cuánto te dio (${s})" aria-label="Monto recibido" value="${esc(enfocado ? valorEscrito : (e.centavos > 0 ? (e.centavos / 100).toString() : ''))}">
        <button type="button" data-borrar="1">Borrar</button>
      </div>
      ${k.tasa > 0 ? '' : `<div class="n360-vu-hint">¿Te pagan en dólares? Primero pon tu tasa de cambio.
        <button type="button" data-ir-tasa="1" style="display:block;margin:6px auto 0;border:1px solid var(--accent,#5a5af4);background:transparent;color:var(--accent,#5a5af4);font:inherit;font-size:13px;font-weight:700;padding:8px 14px;border-radius:10px;cursor:pointer;min-height:40px">💱 Poner mi tasa de cambio ↗</button></div>`}
      ${res}`;
    p.style.display = '';
    if (enfocado) {
      const ni = p.querySelector('input');
      if (ni) { ni.focus(); try { ni.setSelectionRange(ni.value.length, ni.value.length); } catch (_) {} }
    }
  }

  function volverAlEscaner(modo) {
    if (modo === 'vr') { try { if (typeof enfocarScannerVR === 'function') enfocarScannerVR(); } catch (_) {} }
  }

  function alClic(modo, ev) {
    const b = ev.target.closest('button'); if (!b) return;
    ev.preventDefault();
    const e = EST[modo], k = cfg();
    const entregaInicial = k.base === 'USD' ? 'usd' : 'local';   // cuenta en dólares: vuelto en dólares por defecto
    if (b.dataset.irTasa) { irATasa(modo); return; }
    if (b.dataset.abrir) { e.abierto = true; pintar(modo); return; }
    if (b.dataset.cerrar) { e.abierto = false; e.centavos = 0; e.entrega = k.base === 'USD' ? 'usd' : 'local'; pintar(modo); volverAlEscaner(modo); return; }
    if (b.dataset.mon) { if (e.moneda !== b.dataset.mon) { e.moneda = b.dataset.mon; e.centavos = 0; e.entrega = entregaInicial; } }
    else if (b.dataset.bil) { e.centavos += Number(b.dataset.bil) * 100; }
    else if (b.dataset.exacto) {
      const ctx = contexto(modo), tb = c(ctx.totalBase), base = k.base === 'USD' ? 'USD' : 'NIO';
      const mon = e.moneda || base;
      e.centavos = mon === base ? tb : (mon === 'USD' ? localAUsdArriba(tb, k.tasa) : usdALocal(tb, k.tasa));
    }
    else if (b.dataset.borrar) { e.centavos = 0; e.entrega = entregaInicial; }
    else if (b.dataset.entrega) { e.entrega = b.dataset.entrega === 'usd' ? 'usd' : 'local'; }
    pintar(modo);
    volverAlEscaner(modo);
  }

  // Abre Caja › Bancos con el campo de tasa listo, en otra pestaña para no perder la venta en curso.
  // Al volver a esta pestaña se lee la tasa nueva y aparece el botón "Dólares".
  let esperandoTasa = false;
  function irATasa(modo) {
    esperandoTasa = true;
    const w = window.open('caja.html?tasa=1', '_blank');
    if (!w) location.href = 'caja.html?tasa=1';   // bloqueado: se va en la misma pestaña
  }
  async function releerTasa() {
    if (!esperandoTasa || document.visibilityState !== 'visible') return;
    try {
      const uid = (typeof S !== 'undefined' && S.userId) || null;
      if (!uid || typeof sb === 'undefined') return;
      const { data } = await sb.from('configuracion_empresa').select('tasa_cambio_usd').eq('auth_user_id', uid).maybeSingle();
      const t = Number(data && data.tasa_cambio_usd) || 0;
      if (t > 0 && S.empresaConfig) {
        S.empresaConfig.tasa_cambio_usd = t;
        esperandoTasa = false;
        ['nv', 'vr'].forEach(m => { try { pintar(m); } catch (_) {} });
      }
    } catch (_) {}
  }
  document.addEventListener('visibilitychange', releerTasa);
  window.addEventListener('focus', releerTasa);

  let tEscribir = 0;
  function alEscribir(modo, inp) {
    EST[modo].centavos = leerMonto(inp.value);
    clearTimeout(tEscribir);
    tEscribir = setTimeout(() => pintar(modo), 120);
  }
  // "1,000" y "1.000" con 3 cifras al final = mil; "12,50" o "12.5" = doce con cincuenta; "1,250.75" = mil doscientos cincuenta con 75.
  function leerMonto(texto) {
    let t = String(texto || '').replace(/[^\d.,]/g, '');
    if (!t) return 0;
    const ultP = t.lastIndexOf('.'), ultC = t.lastIndexOf(',');
    let decSep = null;
    if (ultP >= 0 && ultC >= 0) decSep = ultP > ultC ? '.' : ',';                       // los dos: el último es el decimal
    else {
      const sep = ultP >= 0 ? '.' : (ultC >= 0 ? ',' : null);
      if (sep) {
        const grupos = t.split(sep);
        const finalEs3 = grupos[grupos.length - 1].length === 3;
        decSep = (grupos.length > 2 || finalEs3) ? null : sep;                             // 1,000 / 1.000.000 = miles
      }
    }
    let entero = t, dec = '';
    if (decSep) { const i = t.lastIndexOf(decSep); entero = t.slice(0, i); dec = t.slice(i + 1); }
    entero = entero.replace(/[.,]/g, '');
    dec = dec.replace(/[.,]/g, '').slice(0, 2);
    const num = Number((entero || '0') + (dec ? '.' + dec : ''));
    return num > 0 && isFinite(num) ? Math.round(num * 100) : 0;
  }

  /* ---------- API usada por ventas.js ---------- */
  function refrescar(modo) { try { pintar(modo); } catch (e) { console.warn('Vuelto:', e); } }
  function reset(modo) {
    EST[modo] = nuevo();
    const p = document.getElementById('n360-vu-' + modo);
    if (p) { p.innerHTML = ''; p.style.display = 'none'; }
    try { refrescar(modo); } catch (_) {}
  }
  // Candado: devuelve el motivo para NO confirmar, o null si todo bien.
  function error(modo) {
    try {
      const ctx = contexto(modo);
      if (!ctx.visible || !(EST[modo].centavos > 0)) return null;
      const r = calcular(modo);
      if (r.estado !== 'falta') return null;
      const falt = (r.soloBase || r.usdDirecto) ? `$ ${fmt(d(r.faltaC))}` : `${r.k.simLocal} ${fmt(d(r.faltaLocalC))}`;
      return `El efectivo recibido no alcanza: faltan ${falt}. Corrige "¿Con cuánto paga?" o bórralo.`;
    } catch (_) { return null; }
  }
  // Nota para guardar en la venta (vacía si no se usó la calculadora)
  function nota(modo) {
    try {
      const ctx = contexto(modo);
      if (!ctx.visible || !(EST[modo].centavos > 0)) return '';
      const r = calcular(modo);
      if (r.estado === 'falta' || r.estado === 'vacio') return '';
      const v = r.estado === 'exacto' ? 'sin vuelto' : `vuelto ${textoVuelto(r, EST[modo].entrega)}`;
      return `Efectivo: recibió ${textoRecibido(r)} · ${v}`;
    } catch (_) { return ''; }
  }
  // Guarda lo necesario para que el ticket muestre Recibido / Vuelto
  function recordar(modo, numeroVenta) {
    try {
      if (!numeroVenta) return;
      const ctx = contexto(modo);
      if (!ctx.visible || !(EST[modo].centavos > 0)) { delete TICKET[numeroVenta]; return; }
      const r = calcular(modo);
      if (r.estado === 'falta' || r.estado === 'vacio') { delete TICKET[numeroVenta]; return; }
      TICKET[numeroVenta] = { recibido: textoRecibido(r), vuelto: r.estado === 'exacto' ? 'Sin vuelto' : textoVuelto(r, EST[modo].entrega) };
    } catch (_) {}
  }
  function ticketHTML(numeroVenta) {
    const t = numeroVenta && TICKET[numeroVenta]; if (!t) return '';
    return `<div class="fila-dato"><span>Efectivo recibido</span><span>${esc(t.recibido.replace(/ \(tasa.*\)$/, ''))}</span></div>` +
           `<div class="fila-dato negrita"><span>Su vuelto</span><span>${esc(t.vuelto)}</span></div>`;
  }

  // Mismas dos líneas para las impresoras de texto (RawBT, USB, app de escritorio)
  function lineas(numeroVenta) {
    const t = numeroVenta && TICKET[numeroVenta]; if (!t) return [];
    return [{ izq: 'Efectivo recibido', der: t.recibido.replace(/ \(tasa.*\)$/, '') }, { izq: 'Su vuelto', der: t.vuelto, negrita: true }];
  }

  window.N360Vuelto = { refrescar, reset, error, nota, recordar, ticketHTML, lineas, _calcular: calcular, _estado: EST, _leerMonto: leerMonto, _conv: { usdALocal, localAUsdArriba } };
})();
