/* ============================================================
   DESCUENTO-DOC.JS — NEGOCIO360 · Descuento general en Proformas y Cotizaciones
   El MISMO descuento general de Ventas: % o monto fijo, con motivo, sobre lo que queda
   después de los descuentos por producto. Respeta el permiso y el tope por usuario de
   Ventas (Configuración de Ventas). Nunca deja el total negativo.
   La base de datos revisa aparte que subtotal − descuento + impuestos = total.
   Sin aplicar un descuento general, el documento se guarda exactamente igual que siempre.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360DescDoc) return;
  const D = { dg: null, monto: 0, base: 0, topado: false };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const fm = v => { try { return fmt(v); } catch (_) { return 'C$ ' + r2(v).toFixed(2); } };
  function cfg() {
    try { if (window.N360VentasConfig && N360VentasConfig.descuentoGeneral) return N360VentasConfig.descuentoGeneral(); } catch (_) {}
    return { permitido: true, maxPct: 100 };
  }
  function aviso(m, t) { try { showToast(m, t || 'warning'); } catch (_) {} }
  function refrescar() { try { if (typeof actualizarResumenProf === 'function') actualizarResumenProf(); } catch (_) {} pintarChip(); }

  // Se llama desde calcularResumenProf(): devuelve cuánto descuenta el general.
  function calcular(subtotal, descLineas) {
    const base = Math.max(r2(subtotal - descLineas), 0);
    D.base = base; D.monto = 0; D.topado = false;
    if (!D.dg) return 0;
    const c = cfg(), maxPct = c.permitido ? c.maxPct : 0;
    const v = Math.max(Number(D.dg.valor) || 0, 0);
    const bruto = D.dg.modo === 'porcentaje' ? r2(base * Math.min(v, 100) / 100) : r2(v);
    if (!c.permitido) { D.dg = null; return 0; }
    // Carrito vacío (por ejemplo, mientras carga una proforma para editar): no se borra el descuento, solo no aplica aún.
    if (!(base > 0) || !(bruto > 0)) return 0;
    if (D.dg.modo === 'monto' && bruto > base + 0.004) {
      D.dg = null; aviso('El descuento general se quitó porque ya no cabe en el documento. Vuelve a aplicarlo si lo necesitas.');
      setTimeout(pintarChip, 0); return 0;
    }
    if (D.dg.modo === 'porcentaje') D.dg.valor = Math.min(v, 100, maxPct);
    const tope = r2(base * maxPct / 100);
    D.monto = Math.min(bruto, base, tope);
    D.topado = bruto > D.monto + 0.004;
    if (!(D.monto > 0)) D.monto = 0;
    clearTimeout(calcular._t); calcular._t = setTimeout(pintarChip, 0);   // la etiqueta siempre refleja lo calculado
    return D.monto;
  }
  // Columnas que se guardan con el documento. Sin descuento: todo en blanco (como siempre).
  function payload() {
    if (D.dg && D.monto > 0) return { descuento_general: r2(D.monto), descuento_general_modo: D.dg.modo, descuento_general_valor: r2(D.dg.valor), descuento_general_motivo: D.dg.motivo || null };
    return { descuento_general: 0, descuento_general_modo: null, descuento_general_valor: null, descuento_general_motivo: null };
  }
  // Para la venta al convertir una proforma (solo si traía descuento general).
  function paraVenta(p) {
    if (!p || !(Number(p.descuento_general) > 0)) return {};
    return { descuento_general: Number(p.descuento_general), descuento_general_modo: p.descuento_general_modo,
      descuento_general_valor: Number(p.descuento_general_valor) || 0, descuento_general_motivo: p.descuento_general_motivo || null };
  }
  function reset() { D.dg = null; D.monto = 0; pintarChip(); }
  function cargar(p) {
    D.dg = (p && Number(p.descuento_general) > 0 && p.descuento_general_modo)
      ? { modo: p.descuento_general_modo, valor: Number(p.descuento_general_valor) || 0, motivo: p.descuento_general_motivo || '' } : null;
    pintarChip();
  }

  /* ---------- botón y chip debajo de "Descuento" en el resumen ---------- */
  function pintarChip() {
    const fila = document.getElementById('np-resumen-descuento')?.closest('.resumen-fila');
    if (!fila) return;
    let w = document.getElementById('dgd-wrap');
    if (!cfg().permitido) { if (w) w.remove(); return; }
    if (!w) { w = document.createElement('div'); w.id = 'dgd-wrap'; w.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 6px'; fila.insertAdjacentElement('afterend', w); }
    w.innerHTML = D.dg && D.monto > 0
      ? `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:4px 10px;font-size:12.5px;font-weight:700">🏷️ Descuento general: ${D.dg.modo === 'porcentaje' ? r2(D.dg.valor) + '%' : 'monto fijo'} (−${esc(fm(D.monto))})${D.dg.motivo ? ' · ' + esc(D.dg.motivo) : ''}
           <button type="button" onclick="N360DescDoc.abrir()" style="border:0;background:none;color:inherit;cursor:pointer;font-weight:800" title="Cambiar">✎</button>
           <button type="button" onclick="N360DescDoc.quitar()" style="border:0;background:none;color:inherit;cursor:pointer;font-weight:800" title="Quitar" aria-label="Quitar descuento general">✕</button></span>
         ${D.topado ? '<span style="font-size:12px;color:var(--warning)">Se aplicó solo hasta tu tope permitido.</span>' : ''}`
      : `<button type="button" class="btn-secondary" style="padding:5px 12px;font-size:12.5px" onclick="N360DescDoc.abrir()">🏷️ Descuento general</button>`;
  }
  function quitar() { D.dg = null; refrescar(); }
  function abrir() {
    const prev = D.dg || { modo: 'porcentaje', valor: '', motivo: '' };
    document.getElementById('dgd-overlay')?.remove();
    const o = document.createElement('div');
    o.id = 'dgd-overlay';
    o.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    o.innerHTML = `<div role="dialog" aria-modal="true" style="background:var(--bg-surface,#fff);color:var(--text-primary,#111);border-radius:16px;max-width:400px;width:100%;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:16px">🏷️ Descuento general</b>
        <button type="button" id="dgd-x" style="border:none;background:none;font-size:20px;cursor:pointer;color:inherit" aria-label="Cerrar">✕</button></div>
      <div style="font-size:12.5px;color:var(--text-muted,#888);margin-bottom:10px">Se aplica a todo el documento, después de los descuentos por producto.</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button type="button" id="dgd-modo" style="flex:none;width:44px;height:44px;border-radius:10px;border:1px solid var(--border,#ddd);background:var(--bg-hover,#f0f0f5);cursor:pointer;font-weight:800;color:inherit" title="Cambiar entre % y monto"></button>
        <input type="number" id="dgd-valor" min="0" step="0.01" inputmode="decimal" style="flex:1;min-height:44px;padding:8px 12px;border:1px solid var(--border,#ddd);border-radius:10px;font-size:16px;background:var(--bg-surface,#fff);color:inherit" aria-label="Valor del descuento">
      </div>
      <input type="text" id="dgd-motivo" maxlength="80" placeholder="Motivo (opcional): cliente frecuente, pago de contado…" style="width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--border,#ddd);border-radius:10px;font-size:14px;margin-bottom:12px;background:var(--bg-surface,#fff);color:inherit">
      <div id="dgd-vista" style="padding:10px 12px;background:var(--bg-app,#f5f5fa);border-radius:10px;font-size:13px;line-height:1.7;margin-bottom:8px"></div>
      <div id="dgd-error" style="color:var(--danger,#dc2626);font-size:12.5px;min-height:18px;margin-bottom:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn-secondary" id="dgd-cancelar">Cancelar</button><button type="button" class="btn-primary" id="dgd-aplicar">Aplicar</button></div>
    </div>`;
    document.body.appendChild(o);
    let modo = prev.modo === 'monto' ? 'monto' : 'porcentaje';
    const $v = o.querySelector('#dgd-valor'), $m = o.querySelector('#dgd-modo');
    $v.value = prev.valor || ''; o.querySelector('#dgd-motivo').value = prev.motivo || '';
    const c = cfg();
    function calc() {
      const v = Math.max(Number($v.value) || 0, 0), base = D.base;
      const bruto = modo === 'porcentaje' ? r2(base * Math.min(v, 100) / 100) : r2(v);
      const tope = r2(base * c.maxPct / 100);
      let err = '';
      if (modo === 'porcentaje' && v > 100) err = 'El porcentaje no puede pasar de 100%.';
      else if (modo === 'monto' && bruto > base + 0.004) err = `El monto no puede ser mayor que ${fm(base)}.`;
      else if (bruto > tope + 0.004) err = `Tu tope de descuento es ${c.maxPct}% (${fm(tope)}).`;
      return { v, bruto: Math.min(bruto, base, tope), err };
    }
    function pintar() {
      $m.textContent = modo === 'porcentaje' ? '%' : (typeof sym === 'function' ? sym() : 'C$');
      const k = calc();
      o.querySelector('#dgd-vista').innerHTML = `<div style="display:flex;justify-content:space-between"><span>Base (después de descuentos por producto)</span><b>${fm(D.base)}</b></div>
        <div style="display:flex;justify-content:space-between"><span>Descuento general</span><b style="color:var(--danger,#dc2626)">−${fm(k.bruto)}</b></div>
        <div style="display:flex;justify-content:space-between"><span>Queda (antes de IVA)</span><b>${fm(Math.max(D.base - k.bruto, 0))}</b></div>`;
      o.querySelector('#dgd-error').textContent = k.err;
    }
    const cerrar = () => o.remove();
    $m.onclick = () => { modo = modo === 'porcentaje' ? 'monto' : 'porcentaje'; pintar(); };
    $v.oninput = pintar;
    o.querySelector('#dgd-x').onclick = cerrar; o.querySelector('#dgd-cancelar').onclick = cerrar;
    o.addEventListener('mousedown', e => { if (e.target === o) cerrar(); });
    o.querySelector('#dgd-aplicar').onclick = () => {
      const k = calc();
      if (k.err) { o.querySelector('#dgd-error').textContent = k.err; return; }
      if (!(k.v > 0) || !(k.bruto > 0)) { o.querySelector('#dgd-error').textContent = 'Escribe un descuento mayor que cero.'; return; }
      D.dg = { modo, valor: k.v, motivo: (o.querySelector('#dgd-motivo').value || '').trim().slice(0, 80) };
      cerrar(); refrescar();
    };
    pintar(); setTimeout(() => $v.focus(), 30);
  }
  async function init() {
    for (let i = 0; i < 40; i++) { try { if (typeof STATE !== 'undefined' && STATE.userId) break; } catch (_) {} await new Promise(r => setTimeout(r, 250)); }
    try { if (window.N360VentasConfig && typeof STATE !== 'undefined' && STATE.userId) await N360VentasConfig.cargar(sbClient, STATE.userId); } catch (_) {}
    pintarChip();
  }
  window.N360DescDoc = { calcular, payload, paraVenta, reset, cargar, abrir, quitar, _estado: () => ({ ...D, dg: D.dg && { ...D.dg } }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
