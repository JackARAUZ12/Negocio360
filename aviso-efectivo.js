/* =====================================================
   AVISO-EFECTIVO.JS — NEGOCIO360
   Aviso (NO bloqueante) cuando un pago en EFECTIVO supera
   el efectivo disponible. Solo LEE: no cambia ninguna regla
   de Caja. Si el usuario elige transferir desde un banco,
   usa la misma función del servidor que Caja › Transferencias
   (registrar_transferencia_interna).
   Uso:  const seguir = await AvisoEfectivo.verificar({ sb, userId, monto, origenCaja });
   Devuelve true si se debe continuar con el guardado.
===================================================== */
(function () {
  'use strict';
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const fmt = n => 'C$ ' + r2(n).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // Mismas reglas que caja.js (ingresoEsDeCajaChica / egresoEsDeCajaChica)
  const movEsEfectivo = m => (m.metodo_pago_nombre || 'Efectivo').toLowerCase().includes('efectivo');
  const ingChica = m => (m.tipo_movimiento === 'TRANSFERENCIA' || m.tipo_movimiento === 'CAPITAL_AGREGADO') ? m.origen_caja === 'chica' : movEsEfectivo(m);
  const egrChica = m => m.tipo_movimiento === 'TRANSFERENCIA' ? m.origen_caja === 'chica'
    : (m.origen_caja === 'general' ? false : (m.origen_caja === 'chica' ? true : movEsEfectivo(m)));

  async function efectivoDisponible(sb, userId, origenCaja) {
    if (origenCaja === 'chica') {
      const { data: ses } = await sb.from('caja_chica_sesiones').select('monto_apertura')
        .eq('auth_user_id', userId).eq('fecha', hoyISO()).eq('estado', 'abierta').maybeSingle();
      if (ses) {
        const { data: movs } = await sb.from('movimientos_financieros')
          .select('tipo_flujo, monto, metodo_pago_nombre, origen_caja, tipo_movimiento')
          .eq('auth_user_id', userId).eq('estado', 'completado').eq('fecha', hoyISO());
        const l = movs || [];
        const s = a => a.reduce((t, m) => t + Number(m.monto || 0), 0);
        return r2(Number(ses.monto_apertura || 0) + s(l.filter(m => m.tipo_flujo === 'INGRESO' && ingChica(m))) - s(l.filter(m => m.tipo_flujo === 'EGRESO' && egrChica(m))));
      }
    }
    // Efectivo total del libro: movimientos que no pertenecen a ningún banco
    const { data: movs } = await sb.from('movimientos_financieros').select('tipo_flujo, monto')
      .eq('auth_user_id', userId).eq('estado', 'completado').is('banco_id', null);
    return r2((movs || []).reduce((t, m) => t + (m.tipo_flujo === 'INGRESO' ? 1 : -1) * Number(m.monto || 0), 0));
  }

  async function bancosConSaldo(sb, userId) {
    const { data: bancos } = await sb.from('bancos').select('id, nombre, saldo_inicial, moneda').eq('auth_user_id', userId).eq('activo', true).order('nombre');
    const out = [];
    for (const b of (bancos || [])) {
      if ((b.moneda || 'NIO') !== 'NIO') continue; // solo córdobas: sin conversiones
      const { data: movs } = await sb.from('movimientos_financieros').select('tipo_flujo, monto')
        .eq('auth_user_id', userId).eq('banco_id', b.id).eq('estado', 'completado');
      const saldo = r2(Number(b.saldo_inicial || 0) + (movs || []).reduce((t, m) => t + (m.tipo_flujo === 'INGRESO' ? 1 : -1) * Number(m.monto || 0), 0));
      out.push({ id: b.id, nombre: b.nombre, saldo });
    }
    return out;
  }

  function avisar(msg, tipo) {
    if (typeof window.showToast === 'function') { window.showToast(msg, tipo); return; }
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:8px;z-index:100000;font-size:14px;max-width:90vw';
    document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
  }

  function modal(html) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.id = 'aviso-efectivo-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
      ov.innerHTML = `<div role="dialog" aria-modal="true" style="background:var(--bg-card,#fff);color:var(--text,#111);max-width:440px;width:100%;border-radius:14px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.35);max-height:90vh;overflow:auto">${html}</div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-ae]');
        if (!b) return;
        const sel = ov.querySelector('#ae-banco');
        const res = { accion: b.dataset.ae, bancoId: sel ? sel.value : null };
        ov.remove(); resolve(res);
      });
    });
  }

  async function verificar({ sb, userId, monto, origenCaja, mensajeError }) {
    try {
      monto = r2(monto);
      if (!sb || !userId || !(monto > 0)) return true;
      const disp = await efectivoDisponible(sb, userId, origenCaja);
      if (monto <= disp + 0.005) return true;
      const falta = r2(monto - disp);
      const bancos = (await bancosConSaldo(sb, userId)).filter(b => b.saldo + 0.005 >= falta);
      const btn = 'width:100%;padding:11px;border-radius:9px;border:1px solid var(--border,#ccc);background:transparent;color:inherit;font-weight:600;cursor:pointer;margin-top:8px;font-size:14px';
      const html = `
        <h3 style="margin:0 0 8px;font-size:17px">⚠️ No hay suficiente efectivo</h3>
        <p style="margin:0 0 6px;font-size:14px">Este pago es de <b>${fmt(monto)}</b> y en efectivo${origenCaja === 'chica' ? ' (Caja Chica)' : ''} hay <b>${fmt(Math.max(disp, 0))}</b>.</p>
        <p style="margin:0 0 12px;font-size:14px">Faltan <b style="color:var(--danger,#dc2626)">${fmt(falta)}</b>.</p>
        ${bancos.length ? `
          <label style="font-size:12px;display:block;margin-bottom:4px">Transferir ${fmt(falta)} desde:</label>
          <select id="ae-banco" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--bg-input,transparent);color:inherit">
            ${bancos.map(b => `<option value="${esc(b.id)}">🏦 ${esc(b.nombre)} — ${fmt(b.saldo)}</option>`).join('')}
          </select>
          <button type="button" data-ae="transferir" style="${btn};background:var(--accent,#2563eb);color:#fff;border-color:transparent">Transferir ${fmt(falta)} y guardar</button>` : ''}
        <button type="button" data-ae="cambiar" style="${btn}">Cambiar el método de pago (pagar con banco)</button>
        <button type="button" data-ae="continuar" style="${btn};font-weight:500">Guardar de todos modos</button>`;
      const r = await modal(html);
      if (r.accion === 'continuar') return true;
      if (r.accion === 'cambiar') {
        avisar('Cambia el método de pago a Transferencia o Tarjeta y elige el banco.', 'warning');
        return false;
      }
      if (r.accion === 'transferir') {
        const banco = bancos.find(b => b.id === r.bancoId) || bancos[0];
        let entraChica = null;
        if (origenCaja === 'chica') entraChica = 'chica';
        const { data, error } = await sb.rpc('registrar_transferencia_interna', {
          p_transferencia_id: (crypto.randomUUID ? crypto.randomUUID() : null), p_monto: falta,
          p_sale_origen_caja: null, p_sale_banco: banco.id,
          p_entra_origen_caja: entraChica, p_entra_banco: null,
          p_concepto_sale: `Transferencia hacia ${entraChica ? 'Caja Chica' : 'Efectivo'} — para cubrir un pago en efectivo`,
          p_concepto_entra: `Transferencia desde ${banco.nombre} — para cubrir un pago en efectivo`,
          p_es_reverso: false, p_fecha: hoyISO(),
        });
        if (error || !data?.ok) {
          const msg = (data && data.mensaje) || (error && error.message) || 'No se pudo transferir';
          avisar(mensajeError || ('No se pudo transferir: ' + msg), 'error');
          return false;
        }
        avisar(`Se transfirieron ${fmt(falta)} desde ${banco.nombre}.`);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('AvisoEfectivo:', e); // el aviso nunca debe impedir guardar
      return true;
    }
  }

  window.AvisoEfectivo = { verificar, efectivoDisponible };
})();
