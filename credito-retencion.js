/* =====================================================================
   RETENCIÓN DEL CLIENTE AL PAGAR UN CRÉDITO  (Créditos → Registrar pago)
   Cuando una empresa le paga al negocio y le RETIENE IR (2%) y/o el
   impuesto de la alcaldía (IMI 1%), lo retenido:
     • baja el saldo del crédito (lo hace el servidor, todo o nada),
     • NO entra a Caja,
     • queda "a favor" en Impuestos para acreditarlo con la constancia.
   Módulo aditivo: si no carga, Créditos funciona igual que siempre.
   ===================================================================== */
(function () {
  'use strict';
  const H = () => window.N360CredHelpers || {};
  const sb = () => window.__cajaSB;
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (H().fmt ? H().fmt(n) : r2(n).toFixed(2));
  const toast = (m, t) => (H().showToast ? H().showToast(m, t) : alert(m));

  let _saldo = 0, _base = 0, _tocadoIr = false, _tocadoImi = false;

  function montar() {
    if ($('rr-wrap')) return;
    const monto = $('rp-monto');
    const fila = monto && monto.closest('.form-row');
    if (!fila) return;
    const div = document.createElement('div');
    div.id = 'rr-wrap';
    div.style.cssText = 'margin:12px 0 4px';
    div.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;font-size:13px;margin:0">
        <input type="checkbox" id="rr-activo" onchange="N360RetCred._toggle()" style="width:auto;margin:0" />
        🧾 El cliente me retuvo (IR / alcaldía)
      </label>
      <div id="rr-panel" style="display:none;margin-top:10px;padding:12px;border:1.5px solid var(--border, #e5e7eb);border-radius:10px;background:var(--bg-soft, rgba(99,102,241,.04))">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Lo retenido <b>no entra a Caja</b>: baja el saldo del crédito y queda a tu favor en <b>Impuestos</b>. Copia los montos de la <b>constancia de retención</b> que te dio el cliente.</div>
        <div class="form-row">
          <div><label>Base de la retención (factura sin IVA)</label><input type="number" id="rr-base" min="0" step="0.01" oninput="N360RetCred._recalc(true)" /></div>
        </div>
        <div class="form-row" style="align-items:end">
          <div><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="rr-ir-on" checked onchange="N360RetCred._recalc(true)" style="width:auto;margin:0" /> IR (%)</label>
            <input type="number" id="rr-ir-pct" value="2" min="0" max="100" step="0.01" oninput="N360RetCred._recalc(true)" /></div>
          <div><label>Monto IR retenido</label><input type="number" id="rr-ir" min="0" step="0.01" oninput="N360RetCred._manual('ir')" /></div>
        </div>
        <div class="form-row" style="align-items:end">
          <div><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="rr-imi-on" onchange="N360RetCred._recalc(true)" style="width:auto;margin:0" /> Alcaldía / IMI (%)</label>
            <input type="number" id="rr-imi-pct" value="1" min="0" max="100" step="0.01" oninput="N360RetCred._recalc(true)" /></div>
          <div><label>Monto alcaldía retenido</label><input type="number" id="rr-imi" min="0" step="0.01" oninput="N360RetCred._manual('imi')" /></div>
        </div>
        <div id="rr-resumen" style="margin-top:6px;padding:10px 12px;border-radius:8px;background:var(--surface, #fff);border:1px dashed var(--border, #d1d5db);font-size:13px"></div>
      </div>`;
    fila.insertAdjacentElement('afterend', div);
    monto.addEventListener('input', resumen);
  }

  function reset() {
    montar();
    if (!$('rr-wrap')) return;
    $('rr-activo').checked = false; $('rr-panel').style.display = 'none';
    $('rr-ir-on').checked = true; $('rr-ir-pct').value = 2; $('rr-imi-on').checked = false; $('rr-imi-pct').value = 1;
    $('rr-base').value = ''; $('rr-ir').value = ''; $('rr-imi').value = '';
    _tocadoIr = _tocadoImi = false; _saldo = 0; _base = 0;
  }

  // Se llama al elegir el crédito: guarda el saldo y propone la base (factura sin IVA).
  async function cargarCredito(credito) {
    montar();
    if (!$('rr-wrap') || !credito) return;
    _saldo = r2(credito.saldo_pendiente);
    let base = r2(credito.capital_financiado || credito.monto_original || 0);
    try {
      if (credito.venta_id) {
        const { data: v } = await sb().from('ventas').select('subtotal,descuento').eq('id', credito.venta_id).maybeSingle();
        if (v) base = r2(Math.max(0, Number(v.subtotal || 0) - Number(v.descuento || 0)));
      }
    } catch (_) {}
    _base = base;
    if (!$('rr-activo').checked || !$('rr-base').value) $('rr-base').value = base || '';
    recalc(true);
  }

  function toggle() {
    const on = $('rr-activo').checked;
    $('rr-panel').style.display = on ? '' : 'none';
    if (on && !$('rr-base').value && _base) $('rr-base').value = _base;
    recalc(true); resumen();
  }

  function manual(cual) { if (cual === 'ir') _tocadoIr = true; else _tocadoImi = true; resumen(); }

  function recalc(desdeBase) {
    if (!$('rr-wrap')) return;
    const base = r2($('rr-base').value);
    const irOn = $('rr-ir-on').checked, imiOn = $('rr-imi-on').checked;
    $('rr-ir-pct').disabled = !irOn; $('rr-ir').disabled = !irOn;
    $('rr-imi-pct').disabled = !imiOn; $('rr-imi').disabled = !imiOn;
    if (desdeBase) { _tocadoIr = false; _tocadoImi = false; }
    if (!_tocadoIr) $('rr-ir').value = irOn ? r2(base * (Number($('rr-ir-pct').value) || 0) / 100) : '';
    if (!_tocadoImi) $('rr-imi').value = imiOn ? r2(base * (Number($('rr-imi-pct').value) || 0) / 100) : '';
    if (!irOn) $('rr-ir').value = '';
    if (!imiOn) $('rr-imi').value = '';
    resumen();
  }

  function datos() {
    if (!$('rr-wrap') || !$('rr-activo').checked) return { activo: false, total: 0 };
    const irOn = $('rr-ir-on').checked, imiOn = $('rr-imi-on').checked;
    const ir = irOn ? r2($('rr-ir').value) : 0, imi = imiOn ? r2($('rr-imi').value) : 0;
    return { activo: true, base: r2($('rr-base').value), pctIr: irOn ? Number($('rr-ir-pct').value) || 0 : 0, ir,
             pctImi: imiOn ? Number($('rr-imi-pct').value) || 0 : 0, imi, total: r2(ir + imi) };
  }

  function resumen() {
    const el = $('rr-resumen'); if (!el) return;
    const d = datos();
    if (!d.activo) { el.innerHTML = ''; return; }
    const rec = r2($('rp-monto')?.value);
    const tot = r2(rec + d.total);
    const pasa = _saldo > 0 && tot > _saldo + 0.01;
    const pctReal = d.base > 0 ? (d.total / d.base) * 100 : 0;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between"><span>Recibido (entra a Caja)</span><b>${fmt(rec)}</b></div>
      <div style="display:flex;justify-content:space-between"><span>Retenido por el cliente (no entra a Caja)</span><b>${fmt(d.total)}</b></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border,#e5e7eb);margin-top:6px;padding-top:6px"><span>Se descuenta del crédito</span><b>${fmt(tot)}</b></div>
      ${_saldo ? `<div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:12px"><span>Saldo después</span><span>${fmt(Math.max(0, r2(_saldo - tot)))}</span></div>` : ''}
      ${pasa ? `<div style="color:var(--danger,#dc2626);font-weight:600;margin-top:6px">⚠️ Lo recibido más lo retenido (${fmt(tot)}) es más que el saldo (${fmt(_saldo)}).</div>` : ''}
      ${!pasa && pctReal > 3.05 ? `<div style="color:var(--warning,#d97706);margin-top:6px">⚠️ La retención es ${pctReal.toFixed(2)}% de la base. Lo normal es 2% (IR) + 1% (alcaldía). Revisa la constancia.</div>` : ''}`;
  }

  // Valida antes de registrar. Devuelve mensaje de error o '' si está bien.
  function validar(montoRecibido, saldo) {
    const d = datos();
    if (!d.activo) return '';
    if (!(d.total > 0)) return 'Escribe cuánto te retuvo el cliente (o desmarca "El cliente me retuvo").';
    if (d.ir < 0 || d.imi < 0) return 'Los montos retenidos no pueden ser negativos.';
    if (r2(montoRecibido + d.total) > r2(saldo) + 0.01) return `Lo recibido más lo retenido (${fmt(r2(montoRecibido + d.total))}) es más que el saldo pendiente (${fmt(saldo)}).`;
    return '';
  }

  async function aplicar(creditoId, notas) {
    const d = datos();
    if (!d.activo || !(d.total > 0)) return null;
    const usuario = (H().usuario ? H().usuario() : null) || null;
    const hoy = H().todayISO ? H().todayISO() : new Date().toISOString().slice(0, 10);
    const { data, error } = await sb().rpc('credito_aplicar_retencion', {
      p_credito_id: creditoId, p_base: d.base, p_pct_ir: d.pctIr, p_monto_ir: d.ir, p_pct_imi: d.pctImi, p_monto_imi: d.imi,
      p_fecha: hoy, p_notas: notas || null, p_usuario: usuario,
    });
    if (error) throw error;
    return Object.assign({}, data, { ir: d.ir, imi: d.imi });
  }

  // Lista de retenciones dentro del detalle del crédito (con botón para anular).
  async function pintarEnDetalle(creditoId) {
    try {
      const { data, error } = await sb().from('creditos_retenciones').select('*').eq('credito_id', creditoId).order('created_at', { ascending: false });
      if (error || !data || !data.length) return [];
      const body = $('detalle-credito-body'); if (!body) return data;
      const labels = Array.from(body.querySelectorAll('label'));
      const ancla = labels.find(l => /^Historial$/.test((l.textContent || '').trim()));
      const html = `
        <label>Retenciones del cliente (${data.filter(r => r.estado === 'activa').length})</label>
        <div class="table-wrap" style="margin-bottom:16px"><table>
          <thead><tr><th>Fecha</th><th>IR</th><th>Alcaldía</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>${data.map(r => `<tr>
            <td>${esc(H().fmtDate ? H().fmtDate(r.fecha) : r.fecha)}</td>
            <td>${fmt(r.monto_ir)}</td><td>${fmt(r.monto_imi)}</td><td><b>${fmt(r.monto_total)}</b></td>
            <td>${r.estado === 'activa' ? 'Aplicada (no entró a Caja)' : 'Anulada'}</td>
            <td>${r.estado === 'activa' ? `<button class="btn-icon" title="Anular esta retención (devuelve el saldo al crédito)" style="color:var(--danger)" onclick="N360RetCred.anular('${r.id}','${creditoId}')">🗑️</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>`;
      const cont = document.createElement('div'); cont.innerHTML = html;
      if (ancla) ancla.insertAdjacentElement('beforebegin', cont); else body.appendChild(cont);
      return data;
    } catch (e) { console.warn('pintarEnDetalle retenciones:', e); return []; }
  }

  async function anular(opId, creditoId) {
    if (!confirm('¿Anular esta retención?\n\nEl monto retenido vuelve al saldo pendiente del crédito y sale de "a favor" en Impuestos. No toca Caja.')) return;
    const motivo = prompt('¿Por qué se anula? (opcional)') || null;
    try {
      const { error } = await sb().rpc('credito_anular_retencion', { p_operacion_id: opId, p_motivo: motivo });
      if (error) throw error;
      toast('Retención anulada', 'success');
      if (typeof window.abrirDetalleCredito === 'function') await window.abrirDetalleCredito(creditoId);
      if (H().refrescarTodo) { try { await H().refrescarTodo(); } catch (_) {} }
    } catch (e) { toast('No se pudo anular: ' + (e.message || e), 'error'); }
  }

  async function tieneActivas(creditoId) {
    try {
      const { count } = await sb().from('creditos_retenciones').select('id', { count: 'exact', head: true }).eq('credito_id', creditoId).eq('estado', 'activa');
      return (count || 0) > 0;
    } catch (_) { return false; }
  }

  window.N360RetCred = { montar, reset, cargarCredito, datos, validar, aplicar, pintarEnDetalle, anular, tieneActivas,
                         _toggle: toggle, _recalc: recalc, _manual: manual };
})();
