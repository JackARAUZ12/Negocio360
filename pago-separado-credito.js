/* ============================================================
   PAGO-SEPARADO-CREDITO.JS — NEGOCIO360 · Fase 4.1
   "➗ Pago separado" en Créditos → Registrar pago: un mismo abono pagado
   con varios métodos (ej. C$300 efectivo + C$700 transferencia al BAC).
   Esta pieza SOLO arma y valida las líneas en pantalla. Quien registra es
   creditos.js, con estos candados:
     · la suma de las líneas debe ser EXACTAMENTE el monto del abono;
     · cada línea entra a Caja como su propio movimiento (con su método y banco);
     · si una línea falla, se anulan las que ya entraron y el crédito NO se toca;
     · anular el abono revierte TODOS sus movimientos.
   Si no se toca "Pago separado", Registrar pago funciona exactamente igual que siempre.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360PSCred) return;
  const P = { activo: false, lineas: [], bancos: null };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const necesitaBanco = nom => /tarjeta|transferencia/i.test(String(nom || ''));
  const $ = id => document.getElementById(id);
  const fmtN = n => r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function opcionesMetodo() {
    const sel = $('rp-metodo'); if (!sel) return [];
    return [...sel.options].filter(o => o.value).map(o => ({ id: o.value, nombre: o.dataset.nombre || o.textContent.trim() }));
  }
  async function bancos() {
    if (P.bancos) return P.bancos;
    // Créditos le pasa su propia lista de bancos (la misma que usa al elegir banco)
    try { P.bancos = typeof P.fuenteBancos === 'function' ? ((await P.fuenteBancos()) || []) : []; }
    catch (e) { P.bancos = []; }
    return P.bancos;
  }

  function estilos() {
    if ($('ps-cred-css')) return;
    const s = document.createElement('style'); s.id = 'ps-cred-css';
    s.textContent = `
      #ps-cred-wrap{margin-top:10px;padding:12px;border:1.5px dashed var(--accent,#5a5af4);border-radius:12px;background:var(--bg-surface-2,transparent)}
      .ps-cred-fila{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) auto;gap:6px;align-items:center;margin-bottom:6px}
      .ps-cred-fila select,.ps-cred-fila input{width:100%;min-width:0;box-sizing:border-box}
      .ps-cred-x{background:none;border:1px solid var(--border,#e5e7eb);border-radius:8px;width:32px;height:32px;cursor:pointer;color:var(--danger,#dc2626)}
      .ps-cred-suma{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:700;padding:8px 10px;border-radius:9px;margin-top:6px}
      .ps-cred-suma.ok{background:var(--success-soft,#dcfce7);color:var(--success,#16a34a)}
      .ps-cred-suma.mal{background:var(--warning-soft,#fef3c7);color:#b45309}
      .ps-cred-link{background:none;border:none;color:var(--accent,#5a5af4);font-weight:700;font-size:13px;cursor:pointer;padding:6px 0}
      @media (max-width:560px){ .ps-cred-fila{grid-template-columns:1fr 1fr} .ps-cred-fila .ps-cred-monto{grid-column:1} }`;
    document.head.appendChild(s);
  }

  // Inserta el enlace "➗ Pago separado" debajo del método (una sola vez)
  function montar() {
    estilos();
    const sel = $('rp-metodo'); if (!sel || $('ps-cred-link')) return;
    const fila = sel.closest('.form-row') || sel.parentElement;
    fila.insertAdjacentHTML('afterend', `<div id="ps-cred-zona">
      <button type="button" class="ps-cred-link" id="ps-cred-link" onclick="N360PSCred.activar()">➗ Pago separado (pagar con varios métodos)</button>
      <div id="ps-cred-wrap" style="display:none"></div></div>`);
  }

  function filaHTML(l, i, mets, bks) {
    const mostrarBanco = necesitaBanco(l.metodoNombre) && bks.length;
    return `<div class="ps-cred-fila" data-i="${i}">
      <select onchange="N360PSCred._metodo(${i}, this)" aria-label="Método">${mets.map(m => `<option value="${esc(m.id)}" data-nombre="${esc(m.nombre)}" ${m.id === l.metodoId ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select>
      ${mostrarBanco ? `<select onchange="N360PSCred._banco(${i}, this.value)" aria-label="Banco"><option value="">¿A qué banco?</option>${bks.map(b => `<option value="${esc(b.id)}" ${b.id === l.bancoId ? 'selected' : ''}>🏦 ${esc(b.nombre)}${b.moneda && b.moneda !== 'NIO' ? ' (' + esc(b.moneda) + ')' : ''}</option>`).join('')}</select>` : '<span style="font-size:12px;color:var(--text-muted)">—</span>'}
      <input class="ps-cred-monto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Monto" value="${l.monto ? l.monto : ''}" oninput="N360PSCred._monto(${i}, this.value)" aria-label="Monto">
      <button type="button" class="ps-cred-x" title="Quitar" onclick="N360PSCred._quitar(${i})" ${P.lineas.length <= 2 ? 'disabled style="opacity:.35"' : ''}>✕</button></div>`;
  }
  async function pintar() {
    const w = $('ps-cred-wrap'); if (!w) return;
    const mets = opcionesMetodo(), bks = await bancos();
    w.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
        <b style="font-size:13.5px">➗ Pago separado</b>
        <button type="button" class="ps-cred-link" onclick="N360PSCred.desactivar()">Usar un solo método</button></div>
      ${P.lineas.map((l, i) => filaHTML(l, i, mets, bks)).join('')}
      <button type="button" class="ps-cred-link" onclick="N360PSCred._agregar()">＋ Agregar otro método</button>
      <div id="ps-cred-suma"></div>`;
    pintarSuma();
  }
  function pintarSuma() {
    const el = $('ps-cred-suma'); if (!el) return;
    const total = r2(parseFloat(($('rp-monto') || {}).value) || 0), suma = r2(P.lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0)), dif = r2(total - suma);
    const ok = total > 0 && Math.abs(dif) < 0.005;
    el.className = 'ps-cred-suma ' + (ok ? 'ok' : 'mal');
    el.innerHTML = `<span>Suma: ${fmtN(suma)} de ${fmtN(total)}</span><span>${ok ? '✅ Cuadra' : total <= 0 ? 'Escribe primero el monto a pagar' : dif > 0 ? `Falta ${fmtN(dif)}` : `Sobra ${fmtN(-dif)}`}</span>`;
  }

  async function activar() {
    montar();
    const mets = opcionesMetodo();
    if (mets.length < 2) { try { showToast('Necesitas al menos 2 métodos de pago activos para pagar separado', 'error'); } catch (_) {} return; }
    const efectivo = mets.find(m => /efectivo/i.test(m.nombre)) || mets[0];
    const otro = mets.find(m => m.id !== efectivo.id) || mets[1];
    P.activo = true;
    P.lineas = [{ metodoId: efectivo.id, metodoNombre: efectivo.nombre, bancoId: null, monto: 0 }, { metodoId: otro.id, metodoNombre: otro.nombre, bancoId: null, monto: 0 }];
    // Mientras está activo, el método único y su banco no se usan
    const sel = $('rp-metodo'); if (sel) { sel.disabled = true; sel.closest('div').style.opacity = '.45'; }
    ['rp-banco-elegir-wrap', 'rp-banco-elegido-wrap'].forEach(id => { const e = $(id); if (e) e.style.display = 'none'; });
    $('ps-cred-link').style.display = 'none'; $('ps-cred-wrap').style.display = '';
    await pintar();
    const m = $('rp-monto'); if (m && !m._psCred) { m._psCred = true; m.addEventListener('input', pintarSuma); }
  }
  function desactivar() {
    P.activo = false; P.lineas = [];
    const sel = $('rp-metodo'); if (sel) { sel.disabled = false; sel.closest('div').style.opacity = ''; }
    const w = $('ps-cred-wrap'); if (w) { w.style.display = 'none'; w.innerHTML = ''; }
    const l = $('ps-cred-link'); if (l) l.style.display = '';
  }

  // Revisión final antes de registrar. Devuelve las líneas limpias o el motivo.
  async function validar(total) {
    if (!P.activo) return { ok: true, lineas: null };
    total = r2(total);
    const bks = await bancos();
    const lineas = P.lineas.map(l => ({ ...l, monto: r2(l.monto) }));
    if (lineas.length < 2) return { ok: false, msg: 'El pago separado necesita al menos 2 líneas' };
    for (const l of lineas) {
      if (!(l.monto > 0)) return { ok: false, msg: 'Cada línea del pago separado debe tener un monto mayor a cero' };
      if (necesitaBanco(l.metodoNombre) && bks.length && !l.bancoId) return { ok: false, msg: `Elige a qué banco entra la línea de ${l.metodoNombre}` };
      if (!necesitaBanco(l.metodoNombre)) l.bancoId = null;
    }
    const suma = r2(lineas.reduce((s, l) => s + l.monto, 0));
    if (Math.abs(suma - total) >= 0.005) return { ok: false, msg: `Las líneas suman ${fmtN(suma)} y el abono es ${fmtN(total)}: deben ser iguales` };
    return { ok: true, lineas: lineas.map(l => ({ ...l, bancoNombre: (bks.find(b => b.id === l.bancoId) || {}).nombre || null, bancoMoneda: (bks.find(b => b.id === l.bancoId) || {}).moneda || null })) };
  }
  // Texto que queda en el abono y en el comprobante (ej. "Pago separado: Efectivo 300.00 + Transferencia (BAC) 700.00")
  function descripcion(lineas) {
    return 'Pago separado: ' + lineas.map(l => `${l.metodoNombre}${l.bancoNombre ? ' (' + l.bancoNombre + ')' : ''} ${fmtN(l.monto)}`).join(' + ');
  }

  window.N360PSCred = {
    montar, activar, desactivar, validar, descripcion,
    activo: () => P.activo,
    reset: () => { desactivar(); P.bancos = null; },
    usarBancos(fn) { P.fuenteBancos = fn; P.bancos = null; },
    _metodo(i, sel) { const o = sel.selectedOptions[0]; P.lineas[i].metodoId = sel.value; P.lineas[i].metodoNombre = (o && (o.dataset.nombre || o.textContent.trim())) || ''; P.lineas[i].bancoId = null; pintar(); },
    _banco(i, v) { P.lineas[i].bancoId = v || null; },
    _monto(i, v) { P.lineas[i].monto = r2(parseFloat(v) || 0); pintarSuma(); },
    _quitar(i) { if (P.lineas.length <= 2) return; P.lineas.splice(i, 1); pintar(); },
    _agregar() { const m = opcionesMetodo()[0]; if (!m) return; P.lineas.push({ metodoId: m.id, metodoNombre: m.nombre, bancoId: null, monto: 0 }); pintar(); },
    _estado: () => JSON.parse(JSON.stringify(P)),
  };
})();
