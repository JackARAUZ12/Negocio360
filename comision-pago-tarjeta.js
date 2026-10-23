/* ============================================================
   COMISIÓN POR PAGAR CON TARJETA (egresos) — OPCIONAL
   ------------------------------------------------------------
   Cuando el negocio PAGA con tarjeta (un gasto, una compra, un pago a
   proveedor) normalmente no hay comisión. A veces el proveedor sí la
   cobra: entonces se marca la casilla y se indica el % o el monto.

   - Solo aparece si el método de pago es tarjeta; apagada por defecto.
   - Se registra igual que cualquier gasto: una fila en "gastos"
     (categoría "Comisiones bancarias", ligada a la operación que la
     originó con origen_tipo/origen_id) + su EGRESO en Caja ligado al
     gasto, del mismo banco. Así aparece una sola vez en Gastos,
     reportes y Contabilidad, y cuadra con Caja y con el banco.
   - Si la operación original se anula/cancela, anular() cancela el gasto
     de la comisión y anula su egreso.

   Uso en cada módulo:
     N360ComisionPago.montar({ prefijo, despuesDe, metodo, monto });
     const com = N360ComisionPago.leer(prefijo);          // null si no aplica
     await N360ComisionPago.registrar(sb, { ...datos, comision: com });
     await N360ComisionPago.anular(sb, userId, origenTipo, origenId, motivo);
   ============================================================ */
(function () {
  'use strict';
  if (window.N360ComisionPago) return;

  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const montados = {};

  const esTarjeta = (nombre) => String(nombre || '').toLowerCase().includes('tarjeta');

  function nombreMetodo(sel) {
    if (!sel) return '';
    const op = sel.selectedOptions && sel.selectedOptions[0];
    return (op && (op.dataset.nombre || op.textContent)) || '';
  }

  // cfg: { prefijo, despuesDe (id del elemento tras el que va), metodo (id del
  // <select> de método), monto (id del input del monto, o función que lo devuelve) }
  function montar(cfg) {
    const ancla = document.getElementById(cfg.despuesDe);
    if (!ancla || montados[cfg.prefijo]) return;
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    wrap.id = `${cfg.prefijo}-comision-tarjeta-wrap`;
    wrap.style.display = 'none';
    wrap.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400">
        <input type="checkbox" id="${cfg.prefijo}-com-chk" style="width:auto"/>
        El proveedor me cobra una comisión por pagar con tarjeta (opcional)
      </label>
      <div id="${cfg.prefijo}-com-campos" style="display:none;margin-top:6px;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px">
        <input type="number" id="${cfg.prefijo}-com-pct" min="0" max="100" step="0.01" placeholder="%" style="width:80px"/> <span>%</span>
        <span>=</span>
        <input type="number" id="${cfg.prefijo}-com-monto" min="0" step="0.01" placeholder="0.00" style="width:120px"/>
        <div style="flex-basis:100%;font-size:11.5px;color:var(--text-muted)">Se registra aparte como gasto "Comisiones bancarias" y sale del mismo banco.</div>
      </div>`;
    ancla.insertAdjacentElement('afterend', wrap);
    const st = { cfg, wrap, manual: false };
    montados[cfg.prefijo] = st;
    const $ = (s) => document.getElementById(`${cfg.prefijo}-com-${s}`);
    $('chk').addEventListener('change', () => { $('campos').style.display = $('chk').checked ? 'flex' : 'none'; });
    $('pct').addEventListener('input', () => { st.manual = false; recalcular(cfg.prefijo); });
    $('monto').addEventListener('input', () => { st.manual = true; });
    const sel = document.getElementById(cfg.metodo);
    if (sel) sel.addEventListener('change', () => actualizar(cfg.prefijo));
    const inp = typeof cfg.monto === 'string' ? document.getElementById(cfg.monto) : null;
    if (inp) inp.addEventListener('input', () => recalcular(cfg.prefijo));
    actualizar(cfg.prefijo);
  }

  function base(st) {
    const m = typeof st.cfg.monto === 'function' ? st.cfg.monto() : document.getElementById(st.cfg.monto)?.value;
    return Number(String(m == null ? '' : m).replace(',', '.')) || 0;
  }

  function recalcular(prefijo) {
    const st = montados[prefijo]; if (!st || st.manual) return;
    const pct = parseFloat(document.getElementById(`${prefijo}-com-pct`).value);
    document.getElementById(`${prefijo}-com-monto`).value = pct > 0 ? r2(base(st) * pct / 100).toFixed(2) : '';
  }

  // Muestra la opción solo con tarjeta; con otro método se apaga sola.
  function actualizar(prefijo) {
    const st = montados[prefijo]; if (!st) return;
    const tarjeta = esTarjeta(nombreMetodo(document.getElementById(st.cfg.metodo)));
    st.wrap.style.display = tarjeta ? '' : 'none';
    if (!tarjeta) limpiar(prefijo);
  }

  function limpiar(prefijo) {
    const st = montados[prefijo]; if (!st) return;
    document.getElementById(`${prefijo}-com-chk`).checked = false;
    document.getElementById(`${prefijo}-com-campos`).style.display = 'none';
    document.getElementById(`${prefijo}-com-pct`).value = '';
    document.getElementById(`${prefijo}-com-monto`).value = '';
    st.manual = false;
  }

  // Devuelve null si no aplica; { monto, pct } si se marcó. Lanza Error si falta un dato.
  function leer(prefijo) {
    const st = montados[prefijo]; if (!st) return null;
    actualizar(prefijo);
    if (st.wrap.style.display === 'none' || !document.getElementById(`${prefijo}-com-chk`).checked) return null;
    const pctTxt = document.getElementById(`${prefijo}-com-pct`).value;
    const pct = pctTxt === '' ? null : Math.min(100, Math.max(0, parseFloat(pctTxt) || 0));
    const monto = r2(parseFloat(document.getElementById(`${prefijo}-com-monto`).value));
    if (!(monto > 0)) throw new Error('Indica el monto de la comisión por pagar con tarjeta (o desmarca la casilla).');
    const b = base(st);
    if (b > 0 && monto >= b) throw new Error('La comisión no puede ser mayor o igual al monto pagado.');
    return { monto, pct };
  }

  async function montoEnMonedaBanco(sb, userId, bancoId, monto) {
    if (!bancoId) return null;
    try {
      const [{ data: b }, { data: cfg }] = await Promise.all([
        sb.from('bancos').select('moneda').eq('id', bancoId).eq('auth_user_id', userId).maybeSingle(),
        sb.from('configuracion_empresa').select('moneda, tasa_cambio_usd').eq('auth_user_id', userId).maybeSingle(),
      ]);
      const baseMon = cfg?.moneda === 'USD' ? 'USD' : 'NIO';
      const mb = b?.moneda || 'NIO';
      const tasa = Number(cfg?.tasa_cambio_usd || 0);
      if (mb === baseMon || !tasa) return null;
      return r2(baseMon === 'NIO' ? monto / tasa : monto * tasa);
    } catch (_) { return null; }
  }

  // d: { userId, comision:{monto,pct}, fecha, metodoId, metodoNombre, bancoId, origenCaja,
  //      descripcion (de qué fue el pago), origenTipo ('gasto'|'compra'|'pago_cxp'|'prima_cxp'), origenId }
  // Devuelve { ok, gastoId } o { ok:false, error }. Gasto y egreso van juntos.
  async function registrar(sb, d) {
    const c = d && d.comision;
    if (!c || !(c.monto > 0)) return { ok: true, gastoId: null };
    if (!esTarjeta(d.metodoNombre)) return { ok: true, gastoId: null };
    const concepto = `Comisión por pago con tarjeta${c.pct ? ` ${c.pct}%` : ''} — ${d.descripcion || ''}`.trim();
    const fecha = d.fecha || new Date().toISOString().slice(0, 10);
    const { data: gasto, error: eG } = await sb.from('gastos').insert({
      auth_user_id: d.userId, tipo: 'inmediato', concepto, categoria: 'Comisiones bancarias', monto: c.monto, fecha,
      metodo_pago_id: d.metodoId || null, metodo_pago_nombre: d.metodoNombre || null, estado: 'activo',
      origen_tipo: d.origenTipo || null, origen_id: d.origenId || null,
      observaciones: 'Comisión cobrada por el proveedor al pagar con tarjeta',
    }).select('id').single();
    if (eG || !gasto) return { ok: false, error: eG || new Error('No se guardó la comisión') };
    const { data: ult } = await sb.from('movimientos_financieros').select('saldo_resultante')
      .eq('auth_user_id', d.userId).eq('estado', 'completado').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const saldoAnt = Number(ult?.saldo_resultante) || 0;
    const { data: mov, error: eM } = await sb.from('movimientos_financieros').insert({
      auth_user_id: d.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO', concepto, monto: c.monto,
      saldo_anterior: saldoAnt, saldo_resultante: r2(saldoAnt - c.monto),
      metodo_pago_id: d.metodoId || null, metodo_pago_nombre: d.metodoNombre || null,
      banco_id: d.bancoId || null, monto_moneda_banco: await montoEnMonedaBanco(sb, d.userId, d.bancoId, c.monto),
      origen_caja: d.origenCaja || null, referencia_tipo: 'gasto', referencia_id: gasto.id, fecha, estado: 'completado',
    }).select('id').single();
    if (eM || !mov) {
      // Sin su egreso, el gasto tampoco se queda (Caja y Gastos siempre iguales).
      await sb.from('gastos').update({ estado: 'cancelado', cancelado_en: new Date().toISOString(), cancelado_motivo: 'No se pudo registrar en Caja' })
        .eq('id', gasto.id).eq('auth_user_id', d.userId);
      return { ok: false, error: eM || new Error('No se registró la comisión en Caja') };
    }
    await sb.from('gastos').update({ movimiento_financiero_id: mov.id }).eq('id', gasto.id).eq('auth_user_id', d.userId);
    return { ok: true, gastoId: gasto.id };
  }

  // Cancela las comisiones de una operación (y anula sus egresos de Caja).
  async function anular(sb, userId, origenTipo, origenId, motivo) {
    if (!origenTipo || !origenId) return 0;
    const ahora = new Date().toISOString();
    const { data: gs, error } = await sb.from('gastos').select('id')
      .eq('auth_user_id', userId).eq('origen_tipo', origenTipo).eq('origen_id', origenId).eq('estado', 'activo');
    if (error) throw error;
    for (const g of (gs || [])) {
      const { error: e1 } = await sb.from('movimientos_financieros')
        .update({ estado: 'anulado', anulado_en: ahora, anulado_motivo: motivo || 'Operación anulada' })
        .eq('referencia_tipo', 'gasto').eq('referencia_id', g.id).eq('auth_user_id', userId).eq('estado', 'completado');
      if (e1) throw e1;
      const { error: e2 } = await sb.from('gastos')
        .update({ estado: 'cancelado', cancelado_en: ahora, cancelado_motivo: motivo || 'Operación anulada' })
        .eq('id', g.id).eq('auth_user_id', userId);
      if (e2) throw e2;
    }
    return (gs || []).length;
  }

  window.N360ComisionPago = { montar, actualizar, leer, limpiar, registrar, anular, esTarjeta };
})();
