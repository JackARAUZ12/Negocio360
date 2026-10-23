/* =====================================================
   CERTIFICADOS-VENTA.JS — NEGOCIO360 (23-oct-2026)
   Usar un certificado de regalo al cobrar una venta (paso "Método de
   pago" de Nueva venta). Solo aparece si el negocio activó el módulo
   de Certificados de regalo en Configuración.
     * Cobrado por adelantado → paga parte o todo lo que se cobra (ese
       dinero ya entró a Caja al venderlo).
     * Cobrado como venta / cortesía → se aplica como descuento.
   Esta pantalla solo CALCULA y muestra. El saldo lo valida y lo
   descuenta la base, en la misma operación que guarda la venta.
   Usa lo que ventas.js ya tiene (S, sb, fmt, esc, round2, showToast,
   calcularResumen, todayISO).
===================================================== */
(function () {
  'use strict';
  const MODO = { anticipo: 'Cobrado por adelantado', venta: 'Cobrado como venta', cortesia: 'Cortesía' };
  const $ = id => document.getElementById(id);
  const activo = () => S?.empresaConfig?.usa_modulo_certificados === true && !S._certEmisionId;

  function caja() {
    let el = $('cert-regalo-box');
    if (!el) {
      const grid = $('metodos-grid');
      if (!grid) return null;
      el = document.createElement('div');
      el.id = 'cert-regalo-box';
      el.style.cssText = 'border:1.5px dashed var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px';
      grid.parentElement.insertBefore(el, grid);
    }
    return el;
  }

  function pintar() {
    const el = caja(); if (!el) return;
    if (!activo()) { el.style.display = 'none'; return; }
    el.style.display = '';
    const c = S.certificado;
    if (!c) {
      el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:700">🎁 ¿Paga con certificado de regalo?</span>
        <input type="text" id="cert-regalo-codigo" placeholder="Código (ej. GC-4F2A9C)" style="max-width:190px;text-transform:uppercase"
               onkeydown="if(event.key==='Enter'){event.preventDefault();N360CertVenta.aplicar();}"/>
        <button type="button" class="btn-secondary btn-sm" id="cert-regalo-btn" onclick="N360CertVenta.aplicar()">Aplicar</button>
        <span id="cert-regalo-error" style="color:var(--danger);font-size:12px"></span></div>`;
      return;
    }
    const r = S._resumen || {};
    const aplicado = Number(r.certAplicado) || 0;
    const consumido = c.uso_parcial ? aplicado : Number(c.saldo);
    const queda = round2(Number(c.saldo) - consumido);
    const perdido = !c.uso_parcial ? round2(Number(c.saldo) - aplicado) : 0;
    el.style.borderColor = 'var(--success)';
    el.innerHTML = `<div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;justify-content:space-between">
      <div>
        <div style="font-weight:700">🎁 Certificado ${esc(c.codigo)} <span style="font-weight:500;color:var(--text-muted)">· ${MODO[c.modo] || ''}${c.beneficiario ? ' · para ' + esc(c.beneficiario) : ''}</span></div>
        <div>Se aplica <b>${fmt(aplicado)}</b> ${c.modo === 'anticipo' ? 'como pago' : 'como descuento'} · al certificado le quedarán <b>${fmt(Math.max(0, queda))}</b></div>
        ${c.modo === 'anticipo' ? `<div>Falta cobrar: <b>${fmt(r.cobrar || 0)}</b>${(r.cobrar || 0) <= 0 ? ' — el certificado cubre todo; elige cualquier método (no entra dinero ahora).' : ''}</div>` : ''}
        ${perdido > 0.004 ? `<div style="color:var(--warning)">Certificado de uso único: se perderán ${fmt(perdido)}.</div>` : ''}
      </div>
      <button type="button" class="btn-ghost btn-sm" onclick="N360CertVenta.quitar()">Quitar</button></div>`;
  }

  function refrescarPago() {
    calcularResumen();
    try {
      if (S.metodoPagoId === 'separado' && typeof renderResumenPagoSeparado === 'function') renderResumenPagoSeparado();
      if (S.bancoElegidoId && typeof elegirBancoVenta === 'function') {
        const b = (typeof _bancosCache !== 'undefined' && _bancosCache || []).find(x => x.id === S.bancoElegidoId);
        elegirBancoVenta(S.bancoElegidoId, S.bancoElegidoNombre, b?.moneda);
      }
    } catch (_) {}
    pintar();
  }

  async function aplicar() {
    const err = $('cert-regalo-error'); if (err) err.textContent = '';
    const codigo = String($('cert-regalo-codigo')?.value || '').trim().toUpperCase();
    if (!codigo) { if (err) err.textContent = 'Escribe el código.'; return; }
    if (S.metodoPagoId === 'fiado') { if (err) err.textContent = 'Una venta fiada no se paga con certificado.'; return; }
    const btn = $('cert-regalo-btn'); if (btn) btn.disabled = true;
    try {
      const { data: c, error } = await sb.from('certificados_regalo').select('*').eq('auth_user_id', S.userId).eq('codigo', codigo).maybeSingle();
      if (error) throw error;
      const motivo = !c ? 'No existe un certificado con ese código.'
        : c.estado === 'anulado' ? 'Ese certificado fue anulado.'
        : c.estado === 'pendiente_cobro' ? 'Ese certificado todavía no se ha cobrado.'
        : (c.estado === 'agotado' || Number(c.saldo) <= 0) ? 'Ese certificado ya no tiene saldo.'
        : (c.fecha_vence && String(c.fecha_vence) < todayISO()) ? `Ese certificado venció el ${String(c.fecha_vence).split('-').reverse().join('/')}.` : '';
      if (motivo) { if (err) err.textContent = motivo; return; }
      S.certificado = { id: c.id, codigo: c.codigo, modo: c.modo, saldo: Number(c.saldo), uso_parcial: c.uso_parcial !== false,
                        beneficiario: c.beneficiario_nombre || null };
      calcularResumen();
      const aplicado = Number(S._resumen?.certAplicado) || 0;
      if (aplicado <= 0) { S.certificado = null; calcularResumen(); if (err) err.textContent = 'No hay nada que pagar con el certificado en esta venta.'; return; }
      if (!S.certificado.uso_parcial && S.certificado.saldo - aplicado > 0.004) {
        const ok = window.confirm(`El certificado ${c.codigo} es de USO ÚNICO.\n\nSe usarán ${fmt(aplicado)} y se perderán ${fmt(S.certificado.saldo - aplicado)} que sobran.\n\n¿Aplicarlo de todas formas?`);
        if (!ok) { S.certificado = null; calcularResumen(); return; }
      }
      refrescarPago();
      showToast(`Certificado ${c.codigo} aplicado: ${fmt(aplicado)}`);
    } catch (e) {
      console.error('aplicar certificado:', e);
      if (err) err.textContent = 'No se pudo revisar el certificado. Intenta de nuevo.';
    } finally { if (btn) btn.disabled = false; }
  }

  function quitar() { S.certificado = null; refrescarPago(); }

  // Línea en el resumen final (paso 6)
  function resumenFinal() {
    const el = $('resumen-final-contenido'); if (!el || !S.certificado) return;
    const r = S._resumen || {};
    const linea = document.createElement('div');
    linea.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--success-soft);color:var(--success);font-size:12.5px';
    linea.innerHTML = S.certificado.modo === 'anticipo'
      ? `🎁 Pagado con certificado ${esc(S.certificado.codigo)}: <b>${fmt(r.certPago || 0)}</b> · Falta cobrar: <b>${fmt(r.cobrar || 0)}</b>`
      : `🎁 Certificado ${esc(S.certificado.codigo)} aplicado como descuento: <b>${fmt(r.descuentoCert || 0)}</b>`;
    el.appendChild(linea);
  }

  window.N360CertVenta = { pintar, aplicar, quitar, resumenFinal };
})();
