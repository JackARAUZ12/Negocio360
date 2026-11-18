/* ============================================================
   VENTAS › DEVOLUCIÓN (pantalla)
   ------------------------------------------------------------
   Botón "↩️ Devolución" en el detalle de una venta completada.
   Se elige qué productos regresan y cuántos, si vuelven al inventario
   (buen estado) o no (dañados), el motivo, y — si hay dinero que
   devolver — con qué método y de qué banco sale.

   TODO el registro lo hace la base de datos en UNA sola operación
   (registrar_devolucion_venta): inventario, Caja/banco, Impuestos,
   crédito o fiado, cliente y puntos. O se guarda completo o no se
   guarda nada. Antes de confirmar se muestra exactamente lo que va a
   pasar (la misma función, en modo "simular", sin guardar).

   Usa lo que ya existe en ventas.js: sb, S, fmt, esc, showToast,
   openModal, closeModal, todayISO, round2, cargarBancosDisponibles,
   obtenerNombrePerfilActivo, loadVentas, loadKPIs, abrirDetalle.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360Devolucion) return;

  const D = { venta: null, items: [], ya: {}, timer: null, sim: null, simSeq: 0, guardando: false };
  const $ = id => document.getElementById(id);
  const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const fmtCant = n => Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 3 });

  function asegurarModal() {
    if ($('modal-devolucion')) return;
    const div = document.createElement('div');
    div.innerHTML = `
<div class="modal-overlay" id="modal-devolucion" onclick="if(event.target===this)N360Devolucion.cerrar()">
  <div class="modal-box modal-md" style="max-width:760px">
    <div class="modal-header">
      <div>
        <div class="modal-title">↩️ Devolución</div>
        <div class="modal-subtitle" id="dv-sub">—</div>
      </div>
      <button class="modal-close" onclick="N360Devolucion.cerrar()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto">
      <p style="font-size:12.5px;color:var(--text-secondary);margin:0 0 10px">
        Elige qué regresa el cliente y cuánto. Lo que viene <b>en buen estado vuelve al inventario</b>; lo dañado no vuelve (queda como pérdida).
        La venta original no se borra: la devolución queda como un documento aparte, con la fecha de hoy.
      </p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px" id="dv-tabla">
          <thead><tr style="text-align:left;color:var(--text-muted);font-size:11.5px">
            <th style="padding:6px 4px">Producto</th><th style="padding:6px 4px;text-align:right">Vendido</th>
            <th style="padding:6px 4px;text-align:right">Ya devuelto</th><th style="padding:6px 4px;width:96px">A devolver</th>
          </tr></thead>
          <tbody id="dv-tbody"></tbody>
        </table>
      </div>
      <div style="margin:8px 0 14px"><button type="button" class="btn-ghost" id="dv-btn-todo" onclick="N360Devolucion.devolverTodo()">Devolver todo lo que queda</button></div>
      <div class="form-group">
        <label for="dv-motivo">Motivo *</label>
        <textarea id="dv-motivo" rows="2" maxlength="300" style="width:100%" placeholder="Ej. producto defectuoso, talla equivocada, el cliente cambió de opinión…"></textarea>
      </div>
      <div id="dv-dinero-wrap" style="display:none">
        <div class="form-group">
          <label for="dv-metodo">¿Cómo se le devuelve el dinero? *</label>
          <select id="dv-metodo" style="width:100%" onchange="N360Devolucion.onMetodo()"></select>
        </div>
        <div class="form-group" id="dv-banco-wrap" style="display:none">
          <label for="dv-banco">¿De qué banco sale? *</label>
          <select id="dv-banco" style="width:100%" onchange="N360Devolucion.onBanco()"></select>
          <div id="dv-banco-info" style="font-size:12px;color:var(--text-muted);margin-top:4px"></div>
        </div>
      </div>
      <div id="dv-resumen" style="background:var(--bg-surface-2,var(--bg-app));border:1px solid var(--border);border-radius:10px;padding:12px;font-size:13px;line-height:1.7">
        Elige al menos un producto.
      </div>
      <div id="dv-error" style="color:var(--danger);font-size:13px;margin-top:8px"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" onclick="N360Devolucion.cerrar()">Cancelar</button>
      <button class="btn-primary" id="dv-btn" onclick="N360Devolucion.confirmar()" disabled>Registrar devolución</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
  }

  function cerrar() { closeModal('modal-devolucion'); if ($('modal-detalle')?.classList.contains('modal-open')) document.body.style.overflow = 'hidden'; }

  // Cantidades ya devueltas por línea de la venta
  async function cargarYaDevuelto(ventaId) {
    const ya = {};
    const { data: devs, error } = await sb.from('devoluciones_venta').select('id').eq('venta_id', ventaId).eq('auth_user_id', S.userId);
    if (error) throw error;
    const ids = (devs || []).map(d => d.id);
    if (ids.length) {
      const { data: det, error: e2 } = await sb.from('devolucion_venta_detalles').select('venta_detalle_id, cantidad').in('devolucion_id', ids);
      if (e2) throw e2;
      (det || []).forEach(x => { ya[x.venta_detalle_id] = round2((ya[x.venta_detalle_id] || 0) + Number(x.cantidad || 0)); });
    }
    return ya;
  }

  function sinInventario(it) { return it.tipo_item === 'servicio' || !!it.promocion_id || (!it.producto_id && !it.combo_id); }

  async function abrir(ventaId) {
    const venta = (S.ventas || []).find(v => v.id === ventaId) || D.venta;
    if (!venta || venta.id !== ventaId) { showToast('Venta no encontrada', 'error'); return; }
    if (venta.estado !== 'completada') { showToast('Solo se pueden devolver ventas completadas', 'error'); return; }
    asegurarModal();
    D.venta = venta; D.sim = null;
    $('dv-sub').textContent = `Venta ${venta.numero_venta} · ${venta.cliente_nombre || 'Consumidor final'} · ${fmt(venta.total)}`;
    $('dv-motivo').value = ''; $('dv-error').textContent = '';
    $('dv-tbody').innerHTML = '<tr><td colspan="4" style="padding:14px;color:var(--text-muted)">Cargando…</td></tr>';
    $('dv-btn').disabled = true;
    openModal('modal-devolucion');
    try {
      const [{ data: items, error }, ya] = await Promise.all([
        sb.from('venta_detalles').select('*').eq('venta_id', ventaId).eq('auth_user_id', S.userId).order('created_at'),
        cargarYaDevuelto(ventaId),
      ]);
      if (error) throw error;
      D.items = items || []; D.ya = ya;
      pintarTabla();
      await llenarMetodos();
      recalcular();
    } catch (e) {
      $('dv-tbody').innerHTML = `<tr><td colspan="4" style="padding:14px;color:var(--danger)">No se pudo cargar la venta: ${esc(e.message || e)}</td></tr>`;
    }
  }

  function pintarTabla() {
    $('dv-tbody').innerHTML = D.items.map((it, i) => {
      const vend = Number(it.cantidad || 0), ya = Number(D.ya[it.id] || 0), queda = Math.max(0, Math.round((vend - ya) * 1000) / 1000);
      const sinInv = sinInventario(it);
      const etiquetaInv = it.tipo_item === 'servicio' ? 'Servicio (no tiene inventario)'
        : it.promocion_id ? 'Promoción: el inventario se ajusta a mano'
        : 'No tiene inventario';
      return `<tr style="border-top:1px solid var(--border)" data-i="${i}">
        <td style="padding:7px 4px">${esc(it.producto_nombre || '')}${it.presentacion_nombre ? ` <span style="color:var(--text-muted);font-size:11.5px">(${esc(it.presentacion_nombre)})</span>` : ''}${it.es_regalia ? ' <span style="color:var(--text-muted);font-size:11.5px">(regalía)</span>' : ''}
          ${queda > 0 ? `<div style="font-size:12px;margin-top:3px">${sinInv ? `<span style="color:var(--text-muted)">${etiquetaInv}</span>`
            : `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" class="dv-reing" data-i="${i}" checked onchange="N360Devolucion.recalcular()"/> Vuelve al inventario (buen estado)</label>`}</div>` : ''}</td>
        <td style="padding:7px 4px;text-align:right">${fmtCant(vend)}</td>
        <td style="padding:7px 4px;text-align:right;color:${ya > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${fmtCant(ya)}</td>
        <td style="padding:7px 4px">${queda > 0
          ? `<input type="number" min="0" max="${queda}" step="any" value="0" class="dv-cant" data-i="${i}" style="width:88px" oninput="N360Devolucion.recalcular()" aria-label="Cantidad a devolver de ${esc(it.producto_nombre || '')}"/>`
          : '<span style="color:var(--text-muted);font-size:12px">Ya devuelto</span>'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" style="padding:14px;color:var(--text-muted)">Esta venta no tiene productos.</td></tr>';
    const quedaAlgo = D.items.some(it => Number(it.cantidad || 0) - Number(D.ya[it.id] || 0) > 0.0005);
    $('dv-btn-todo').style.display = quedaAlgo ? '' : 'none';
  }

  function devolverTodo() {
    document.querySelectorAll('#dv-tbody .dv-cant').forEach(inp => { inp.value = inp.max; });
    recalcular();
  }

  function lineasElegidas() {
    const out = [], errores = [];
    document.querySelectorAll('#dv-tbody .dv-cant').forEach(inp => {
      const it = D.items[Number(inp.dataset.i)];
      const q = num(inp.value), max = num(inp.max);
      if (q < 0) errores.push(`La cantidad de "${it.producto_nombre}" no puede ser negativa.`);
      else if (q > max + 0.0005) errores.push(`De "${it.producto_nombre}" solo quedan ${fmtCant(max)} por devolver.`);
      else if (q > 0) {
        const chk = document.querySelector(`#dv-tbody .dv-reing[data-i="${inp.dataset.i}"]`);
        out.push({ venta_detalle_id: it.id, cantidad: Math.round(q * 1000) / 1000, reingresa: chk ? chk.checked : false });
      }
    });
    return { lineas: out, errores };
  }

  async function llenarMetodos() {
    const sel = $('dv-metodo');
    const metodos = (S.metodosPago || []).filter(m => !/cr[eé]dito|fiado/i.test(m.nombre || ''));
    sel.innerHTML = '<option value="">Selecciona…</option>' + metodos.map(m => `<option value="${esc(m.id)}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
    // Por defecto, el mismo método con el que se cobró la venta (si existe y no es crédito)
    const original = metodos.find(m => m.id === D.venta.metodo_pago_id);
    if (original) sel.value = original.id;
    await onMetodo(true);
  }

  function metodoElegido() {
    const sel = $('dv-metodo');
    const opt = sel?.selectedOptions?.[0];
    return { id: sel?.value || null, nombre: opt?.dataset?.nombre || null };
  }
  function necesitaBanco(nombre) { const n = (nombre || '').toLowerCase(); return n.includes('tarjeta') || n.includes('transferencia'); }

  async function onMetodo(silencioso) {
    const { nombre } = metodoElegido();
    const wrap = $('dv-banco-wrap'), sel = $('dv-banco');
    if (!necesitaBanco(nombre)) { wrap.style.display = 'none'; sel.value = ''; $('dv-banco-info').textContent = ''; if (!silencioso) recalcular(); return; }
    const bancos = (typeof cargarBancosDisponibles === 'function') ? await cargarBancosDisponibles() : [];
    if (!bancos.length) { wrap.style.display = 'none'; sel.value = ''; if (!silencioso) recalcular(); return; }
    const monedaBase = S.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    sel.innerHTML = '<option value="">Selecciona un banco…</option>' + bancos.map(b =>
      `<option value="${esc(b.id)}" data-moneda="${esc(b.moneda || 'NIO')}">${esc(b.nombre)}${(b.moneda || 'NIO') !== monedaBase ? ` (${esc(b.moneda)})` : ''}</option>`).join('');
    wrap.style.display = '';
    onBanco();
    if (!silencioso) recalcular();
  }

  // Banco en otra moneda: cuánto sale en la moneda del banco (igual que en Ventas)
  function montoBanco() {
    const sel = $('dv-banco'); const opt = sel?.selectedOptions?.[0];
    if (!sel?.value || !opt) return { banco: null, convertido: null, ok: true };
    const monedaBase = S.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    const monedaBanco = opt.dataset.moneda || 'NIO';
    if (monedaBanco === monedaBase) return { banco: sel.value, convertido: null, ok: true };
    const tasa = Number(S.empresaConfig?.tasa_cambio_usd || 0);
    if (!tasa) return { banco: sel.value, convertido: null, ok: false };
    const caja = Number(D.sim?.monto_caja || 0);
    return { banco: sel.value, convertido: monedaBase === 'NIO' ? round2(caja / tasa) : round2(caja * tasa), ok: true, moneda: monedaBanco };
  }
  function onBanco() {
    const info = $('dv-banco-info'); if (!info) return;
    const mb = montoBanco();
    info.innerHTML = !mb.banco ? '' : !mb.ok ? '<span style="color:var(--danger)">Falta configurar tu tasa de cambio en Caja › Bancos.</span>'
      : mb.convertido != null ? `Se registrará como ${esc(mb.moneda)} ${mb.convertido.toLocaleString('es-NI', { minimumFractionDigits: 2 })}` : '';
  }

  function payload(simular) {
    const { lineas } = lineasElegidas();
    const met = metodoElegido();
    const mb = montoBanco();
    let perfilTipo = 'admin';
    try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.tipo && pf.tipo !== 'admin') perfilTipo = 'restringido'; } catch (_) {}
    return {
      venta_id: D.venta.id, motivo: ($('dv-motivo').value || '').trim() || (simular ? 'simulación' : ''),
      fecha: todayISO(), lineas,
      metodo_pago_id: met.id || null, metodo_pago_nombre: met.nombre || (simular ? 'Efectivo' : null),
      banco_id: mb.banco || null, monto_moneda_banco: mb.convertido,
      usuario_nombre: (typeof obtenerNombrePerfilActivo === 'function' ? obtenerNombrePerfilActivo() : 'Admin'), perfil_tipo: perfilTipo,
      simular: !!simular,
    };
  }

  function recalcular() {
    clearTimeout(D.timer);
    const { lineas, errores } = lineasElegidas();
    $('dv-error').textContent = errores.join(' ');
    if (!lineas.length || errores.length) {
      D.sim = null; $('dv-btn').disabled = true;
      $('dv-resumen').innerHTML = errores.length ? 'Corrige las cantidades.' : 'Elige al menos un producto.';
      $('dv-dinero-wrap').style.display = 'none';
      return;
    }
    $('dv-resumen').innerHTML = '<span style="color:var(--text-muted)">Calculando…</span>';
    $('dv-btn').disabled = true;
    D.timer = setTimeout(simular, 300);
  }

  async function simular() {
    const seq = ++D.simSeq;
    const { data, error } = await sb.rpc('registrar_devolucion_venta', { p: payload(true) });
    if (seq !== D.simSeq) return;   // llegó una respuesta vieja
    if (error) { D.sim = null; $('dv-resumen').innerHTML = `<span style="color:var(--danger)">${esc(error.message || 'No se pudo calcular')}</span>`; $('dv-btn').disabled = true; return; }
    D.sim = data;
    const s = data;
    const filas = [];
    filas.push(`<div style="display:flex;justify-content:space-between"><span>Valor de lo devuelto${Number(s.impuesto) > 0 ? ` (incluye IVA ${fmt(s.impuesto)})` : ''}</span><b>${fmt(s.total)}</b></div>`);
    if (Number(s.monto_credito) > 0) filas.push(`<div style="display:flex;justify-content:space-between"><span>🧾 Se rebaja de lo que debe el cliente (${s.tipo_venta === 'fiado' ? 'fiado' : 'crédito'})</span><b>${fmt(s.monto_credito)}</b></div>`);
    if (Number(s.deuda_condonada) > 0) filas.push(`<div style="display:flex;justify-content:space-between;color:var(--text-secondary)"><span>Intereses que ya no se cobrarán (se devolvió todo)</span><b>${fmt(s.deuda_condonada)}</b></div>`);
    if (Number(s.monto_dinero) > 0) {
      filas.push(`<div style="display:flex;justify-content:space-between;color:var(--danger)"><span>💵 Se le devuelve en dinero</span><b>${fmt(s.monto_dinero)}</b></div>`);
      const detCaja = [`sale de Caja/banco ${fmt(s.monto_caja)}`];
      if (Number(s.impuesto_revertido) > 0) detCaja.push(`IVA revertido en Impuestos ${fmt(s.impuesto_revertido)}`);
      filas.push(`<div style="font-size:12px;color:var(--text-muted)">${detCaja.join(' · ')}</div>`);
    } else filas.push(`<div style="font-size:12px;color:var(--text-muted)">No sale dinero de Caja.</div>`);
    if (Number(s.costo_reingresado) > 0) filas.push(`<div style="font-size:12px;color:var(--text-muted)">📦 Vuelve al inventario mercadería con costo de ${fmt(s.costo_reingresado)}</div>`);
    if (Number(s.costo_no_reingresado) > 0) filas.push(`<div style="font-size:12px;color:var(--warning)">⚠ No vuelve al inventario (dañado/servicio): costo ${fmt(s.costo_no_reingresado)}</div>`);
    $('dv-resumen').innerHTML = filas.join('');
    $('dv-dinero-wrap').style.display = Number(s.monto_dinero) > 0 ? '' : 'none';
    onBanco();
    $('dv-btn').disabled = false;
  }

  async function saldoCajaActual() {
    try {
      const { data } = await sb.from('movimientos_financieros').select('saldo_resultante').eq('auth_user_id', S.userId).eq('estado', 'completado')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return data ? Number(data.saldo_resultante) : 0;
    } catch (_) { return null; }
  }

  async function confirmar() {
    if (D.guardando) return;
    $('dv-error').textContent = '';
    const { lineas, errores } = lineasElegidas();
    if (errores.length) { $('dv-error').textContent = errores.join(' '); return; }
    if (!lineas.length) { $('dv-error').textContent = 'Elige al menos un producto a devolver.'; return; }
    const motivo = ($('dv-motivo').value || '').trim();
    if (motivo.length < 3) { $('dv-error').textContent = 'Escribe el motivo de la devolución.'; $('dv-motivo').focus(); return; }
    if (!D.sim) { $('dv-error').textContent = 'Espera a que se calcule el resumen.'; return; }
    const hayDinero = Number(D.sim.monto_dinero) > 0;
    const met = metodoElegido();
    if (hayDinero && !met.nombre) { $('dv-error').textContent = 'Elige cómo se le devuelve el dinero al cliente.'; return; }
    if (hayDinero && $('dv-banco-wrap').style.display !== 'none' && !$('dv-banco').value) { $('dv-error').textContent = 'Elige de qué banco sale el dinero.'; return; }
    if (hayDinero && !montoBanco().ok) { $('dv-error').textContent = 'Falta configurar tu tasa de cambio en Caja › Bancos.'; return; }

    let aviso = '';
    if (hayDinero && !$('dv-banco').value) {
      const saldo = await saldoCajaActual();
      if (saldo != null && saldo < Number(D.sim.monto_caja)) aviso = `\n\n⚠ Tu Caja tiene ${fmt(saldo)} y van a salir ${fmt(D.sim.monto_caja)}. La Caja quedará en negativo.`;
    }
    const resumen = `¿Registrar la devolución de ${fmt(D.sim.total)}?` +
      (Number(D.sim.monto_credito) > 0 ? `\n• Se rebaja ${fmt(D.sim.monto_credito)} de la deuda del cliente.` : '') +
      (hayDinero ? `\n• Se le devuelven ${fmt(D.sim.monto_dinero)} en dinero (${met.nombre}).` : '') +
      `\n\nNo se puede deshacer.` + aviso;
    if (!confirm(resumen)) return;

    D.guardando = true;
    const btn = $('dv-btn'); btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Guardando…';
    try {
      const { data, error } = await sb.rpc('registrar_devolucion_venta', { p: payload(false) });
      if (error) throw error;
      closeModal('modal-devolucion');
      showToast(`✅ Devolución ${data.numero} registrada — ${fmt(data.total)}`, 'success');
      const ventaId = D.venta.id;
      try { await Promise.allSettled([loadVentas(), loadKPIs(), typeof loadProductosCache === 'function' ? loadProductosCache() : null]); } catch (_) {}
      try { if (typeof abrirDetalle === 'function' && (S.ventas || []).some(v => v.id === ventaId)) await abrirDetalle(ventaId); } catch (_) {}
      imprimirComprobante(data.id);
    } catch (e) {
      $('dv-error').textContent = e.message || String(e);
      showToast('No se registró la devolución: ' + (e.message || e), 'error');
    } finally {
      D.guardando = false; btn.textContent = txt; btn.disabled = false;
    }
  }

  /* ---------- Comprobante imprimible ---------- */
  async function imprimirComprobante(devolucionId) {
    const w = window.open('', '_blank', 'width=420,height=680');
    if (!w) { showToast('Tu navegador bloqueó la ventana del comprobante. Puedes imprimirlo desde el detalle de la venta.', 'warning'); return; }
    w.document.write('<p style="font-family:sans-serif;color:#888;padding:20px">Generando comprobante…</p>');
    try {
      const { data: d, error } = await sb.from('devoluciones_venta').select('*').eq('id', devolucionId).maybeSingle();
      if (error || !d) throw error || new Error('No encontrada');
      const [{ data: det }, { data: v }] = await Promise.all([
        sb.from('devolucion_venta_detalles').select('*').eq('devolucion_id', d.id).order('created_at'),
        sb.from('ventas').select('numero_venta, cliente_nombre, fecha').eq('id', d.venta_id).maybeSingle(),
      ]);
      const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const negocio = S.empresaConfig?.nombre_comercial || S.empresaConfig?.nombre || 'Mi negocio';
      const filas = (det || []).map(x => `<tr><td>${fmtCant(x.cantidad)}</td><td>${e(x.producto_nombre)}<div class="s">${x.reingresa ? 'Vuelve al inventario' : (x.tipo_item === 'servicio' ? 'Servicio' : 'No vuelve al inventario')}</div></td><td class="r">${e(fmt(x.monto))}</td></tr>`).join('');
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${e(d.numero)}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:16px;max-width:360px}h1{font-size:15px;margin:0 0 2px;text-align:center}
.c{text-align:center}.s{font-size:10.5px;color:#666}table{width:100%;border-collapse:collapse;margin:8px 0}td{padding:4px 2px;border-bottom:1px dashed #ccc;vertical-align:top}
.r{text-align:right;white-space:nowrap}.t{display:flex;justify-content:space-between;margin:2px 0}.b{font-weight:700}.firma{margin-top:36px;border-top:1px solid #333;text-align:center;padding-top:4px}
@media print{button{display:none}}</style></head><body>
<h1>${e(negocio)}</h1><div class="c b">COMPROBANTE DE DEVOLUCIÓN</div><div class="c">${e(d.numero)}</div>
<p>Fecha: ${e(d.fecha)}<br>Venta original: ${e(v?.numero_venta || '')}<br>Cliente: ${e(v?.cliente_nombre || 'Consumidor final')}<br>Motivo: ${e(d.motivo)}</p>
<table><tbody>${filas}</tbody></table>
<div class="t b"><span>Valor devuelto</span><span>${e(fmt(d.total))}</span></div>
${Number(d.impuesto) > 0 ? `<div class="t"><span>Incluye IVA</span><span>${e(fmt(d.impuesto))}</span></div>` : ''}
${Number(d.monto_credito) > 0 ? `<div class="t"><span>Rebajado de su deuda</span><span>${e(fmt(d.monto_credito))}</span></div>` : ''}
${Number(d.deuda_condonada) > 0 ? `<div class="t"><span>Intereses que ya no se cobran</span><span>${e(fmt(d.deuda_condonada))}</span></div>` : ''}
${Number(d.monto_dinero) > 0 ? `<div class="t b"><span>Devuelto en dinero${d.metodo_pago_nombre ? ' (' + e(d.metodo_pago_nombre) + ')' : ''}</span><span>${e(fmt(d.monto_dinero))}</span></div>` : ''}
<div class="firma">Recibí conforme (cliente)</div>
<p class="s c">Atendió: ${e(d.usuario_nombre || '')}</p>
<button onclick="window.print()" style="width:100%;padding:10px;margin-top:8px">Imprimir</button>
<script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
      w.document.close();
    } catch (err) {
      try { w.document.body.innerHTML = '<p style="font-family:sans-serif;color:#c00;padding:20px">No se pudo generar el comprobante.</p>'; } catch (_) {}
    }
  }

  /* ---------- Detalle de la venta: botón + devoluciones ya hechas + candados ---------- */
  async function decorarDetalle(venta) {
    const body = $('det-body');
    if (!body || !venta || venta.estado !== 'completada') return;
    $('det-devoluciones-box')?.remove();
    let devs = [], ya = {}, items = [];
    try {
      const [r1, r2, yaDev] = await Promise.all([
        sb.from('devoluciones_venta').select('id, numero, fecha, total, motivo, monto_dinero, monto_credito').eq('venta_id', venta.id).eq('auth_user_id', S.userId).order('created_at'),
        sb.from('venta_detalles').select('id, cantidad').eq('venta_id', venta.id).eq('auth_user_id', S.userId),
        cargarYaDevuelto(venta.id),
      ]);
      if (r1.error) return;   // tabla no disponible: no se muestra nada
      devs = r1.data || []; items = r2.data || []; ya = yaDev;
    } catch (_) { return; }
    if (S.ventaDetalleId !== venta.id) return;   // el usuario ya abrió otra venta

    const quedaAlgo = items.some(it => Number(it.cantidad || 0) - Number(ya[it.id] || 0) > 0.0005);
    const box = document.createElement('div');
    box.id = 'det-devoluciones-box';
    box.style.cssText = 'margin-bottom:12px';
    const totalDev = devs.reduce((s, d) => s + Number(d.total || 0), 0);
    box.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${quedaAlgo ? `<button class="btn-secondary btn-sm" onclick="N360Devolucion.abrir('${venta.id}')">↩️ Devolución</button>` : '<span style="font-size:12.5px;color:var(--text-muted)">Todo lo de esta venta ya fue devuelto.</span>'}
      </div>
      ${devs.length ? `<div style="margin-top:10px;border:1px solid var(--border);border-radius:10px;padding:10px;font-size:12.5px">
        <div style="font-weight:700;margin-bottom:6px">Devoluciones de esta venta · total ${fmt(totalDev)}</div>
        ${devs.map(d => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px dashed var(--border);flex-wrap:wrap">
          <span><b style="font-family:var(--font-mono)">${esc(d.numero)}</b> · ${esc(d.fecha)} · ${esc(d.motivo || '')}</span>
          <span style="white-space:nowrap">${fmt(d.total)} <button class="btn-ghost btn-sm" style="padding:2px 8px" onclick="N360Devolucion.imprimirComprobante('${d.id}')">🖨️</button></span>
        </div>`).join('')}
        <div style="color:var(--text-muted);font-size:11.5px;margin-top:6px">Una venta con devoluciones ya no se puede anular ni corregir (descuadraría lo devuelto).</div>
      </div>` : ''}`;
    body.insertBefore(box, body.firstChild);

    // Candados en pantalla (la base de datos también los aplica)
    if (devs.length) {
      const btnAn = $('btn-anular-venta'); if (btnAn) btnAn.style.display = 'none';
      const btnCo = $('btn-corregir-venta'); if (btnCo) btnCo.style.display = 'none';
      document.querySelectorAll('#det-herramientas-edicion button').forEach(b => { if (/Cambiar cliente/i.test(b.textContent)) b.style.display = 'none'; });
    }
  }

  window.N360Devolucion = { abrir, cerrar, recalcular, devolverTodo, onMetodo, onBanco, confirmar, decorarDetalle, imprimirComprobante };
})();
