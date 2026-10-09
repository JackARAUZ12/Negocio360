/* ============================================================
   VENTAS — CORREGIR Y EDITAR (Negocio360)
   ------------------------------------------------------------
   A) "Corregir venta": carga la venta en el asistente de Nueva
      Venta para cambiarla y, al confirmar, anula la original con
      la MISMA rutina de anulacion que ya existe (stock, caja, IVA,
      cliente, puntos) y registra la nueva. Ambas quedan enlazadas
      en sus observaciones.
   B) Edicion segura: nota de la venta y cliente (sin tocar stock
      ni dinero).
   Solo funciona en ventas "simples": si la venta tiene algo que la
   anulacion no revierte por completo (credito, combos, series,
   garantias, comision bancaria, pago separado...), NO se permite y
   se explica el motivo. Nunca modifica una venta sin pasar por esas
   comprobaciones.
   Depende de ventas.js (S, sb, anularVenta, abrirNuevaVenta...).
   ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const e = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const notify = (msg, tipo) => { if (typeof showToast === 'function') showToast(msg, tipo || 'success'); };
  const dia = f => String(f || '').slice(0, 10);
  const redondear = n => Math.round((Number(n) || 0) * 100) / 100;

  let ctxActual = null;   // { venta, detalles } de la venta abierta en el detalle

  /* ---------- utilidades de consulta tolerantes a fallos ---------- */
  async function contar(tabla, col, valor) {
    try {
      const { count, error } = await sb.from(tabla).select('id', { count: 'exact', head: true })
        .eq(col, valor).eq('auth_user_id', S.userId);
      if (error) return 0;
      return count || 0;
    } catch (_) { return 0; }
  }

  /* ============================================================
     COMPROBACIONES: ¿se puede corregir esta venta?
     ============================================================ */
  async function evaluar(v) {
    const razones = [];
    if (!v) return { ok: false, razones: ['No se encontró la venta.'], detalles: [] };
    if (v.estado !== 'completada') razones.push('Solo se pueden corregir ventas completadas.');

    const { data: detalles, error: errDet } = await sb.from('venta_detalles').select('*')
      .eq('venta_id', v.id).eq('auth_user_id', S.userId);
    if (errDet) return { ok: false, razones: ['No se pudo leer el detalle de la venta.'], detalles: [] };
    if (!detalles || !detalles.length) razones.push('La venta no tiene productos registrados.');

    let sumaDesc = 0;
    (detalles || []).forEach(d => {
      sumaDesc += Number(d.descuento) || 0;
      if (d.combo_id) razones.push(`Incluye un combo ("${d.producto_nombre}").`);
      else if (d.promocion_id) razones.push(`Incluye una promoción ("${d.producto_nombre}").`);
      else if (d.tipo_item !== 'producto' && d.tipo_item !== 'servicio') razones.push(`Línea no reconocida ("${d.producto_nombre}").`);
      else if (!d.producto_id) razones.push(`"${d.producto_nombre}" ya no está enlazado a un producto.`);
      else if (!(S.productosCache || []).some(p => p.id === d.producto_id)) razones.push(`"${d.producto_nombre}" ya no está disponible para vender (inactivo o eliminado).`);
      if (d.presentacion_id) razones.push(`"${d.producto_nombre}" se vendió por presentación.`);
      if (d.lote_id) razones.push(`"${d.producto_nombre}" tiene un lote asignado.`);
    });
    if (Math.abs(sumaDesc - (Number(v.descuento) || 0)) > 0.01) razones.push('Tiene descuentos generales (promociones o puntos) que no son de una línea.');

    if (v.canje_recompensa_id) razones.push('Tiene un canje de puntos.');
    if (v.proforma_id) razones.push('Viene de una proforma.');
    if (Number(v.comision_monto) > 0) razones.push('Tiene comisión bancaria registrada.');
    if (/separado/i.test(v.metodo_pago_nombre || '')) razones.push('Se cobró con pago separado.');
    if (v.cliente_id && !(S.clientesCache || []).some(c => c.id === v.cliente_id)) razones.push('El cliente de la venta ya no está disponible.');

    const [cred, serie, gar, rec, vetc, vete] = await Promise.all([
      contar('creditos', 'venta_id', v.id), contar('numeros_serie', 'venta_id', v.id),
      contar('garantias_clientes', 'venta_id', v.id), contar('farmacia_recetas', 'venta_id', v.id),
      contar('vet_consultas', 'venta_id', v.id), contar('vet_estancias', 'venta_id', v.id),
    ]);
    if (cred) razones.push('Tiene un crédito asociado.');
    if (serie) razones.push('Tiene números de serie registrados.');
    if (gar) razones.push('Tiene garantías registradas.');
    if (rec) razones.push('Está vinculada a una receta.');
    if (vetc || vete) razones.push('Está vinculada a una consulta o estancia veterinaria.');

    try {
      const { count } = await sb.from('movimientos_financieros').select('id', { count: 'exact', head: true })
        .eq('auth_user_id', S.userId).eq('referencia_tipo', 'venta').eq('referencia_id', v.id).eq('tipo_flujo', 'INGRESO');
      if ((count || 0) > 1) razones.push('Tiene más de un cobro en Caja.');
    } catch (_) { /* si no se puede leer, la propia anulación lo manejará */ }

    try {
      const f = dia(v.fecha);
      const { data: cierres } = await sb.from('cierres_caja').select('id,tipo,fecha,periodo_inicio,periodo_fin')
        .eq('auth_user_id', S.userId).or(`fecha.eq.${f},and(periodo_inicio.lte.${f},periodo_fin.gte.${f})`).limit(1);
      if (cierres && cierres.length) razones.push('Esa fecha ya tiene un cierre de caja.');
    } catch (_) { /* sin información de cierres: no bloquea */ }

    return { ok: razones.length === 0, razones: [...new Set(razones)], detalles: detalles || [] };
  }

  /* ============================================================
     VENTANITAS (modales propios, mismo estilo de la app)
     ============================================================ */
  function asegurarModal() {
    if ($('modal-correccion')) return;
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'modal-correccion';
    div.setAttribute('onclick', "if(event.target===this)closeModal('modal-correccion')");
    div.innerHTML = `
      <div class="modal-box" style="max-width:480px">
        <div class="modal-header"><div><div class="modal-title" id="mc-titulo"></div></div>
          <button class="modal-close" onclick="closeModal('modal-correccion')">✕</button></div>
        <div class="modal-body" id="mc-cuerpo"></div>
        <div class="modal-footer"><button class="btn-ghost" onclick="closeModal('modal-correccion')">Cancelar</button>
          <button class="btn-primary" id="mc-ok">Aceptar</button></div>
      </div>`;
    document.body.appendChild(div);
  }
  function abrirModal(titulo, html, textoOk, alAceptar) {
    asegurarModal();
    $('mc-titulo').textContent = titulo;
    $('mc-cuerpo').innerHTML = html;
    const ok = $('mc-ok');
    ok.style.display = alAceptar ? '' : 'none';
    ok.textContent = textoOk || 'Aceptar';
    ok.disabled = false;
    ok.onclick = alAceptar ? async () => { ok.disabled = true; try { await alAceptar(); } finally { ok.disabled = false; } } : null;
    openModal('modal-correccion');
  }

  /* ============================================================
     A) CORREGIR VENTA
     ============================================================ */
  async function iniciar() {
    if (!ctxActual) return;
    const { venta } = ctxActual;
    abrirModal('Corregir venta', '<p style="color:var(--text-muted)">Revisando si esta venta se puede corregir…</p>', '', null);
    const ev = await evaluar(venta);
    ctxActual.evaluacion = ev;
    if (!ev.ok) {
      abrirModal('No se puede corregir esta venta',
        `<p style="font-size:13.5px;margin-bottom:10px">Para no descuadrar Caja, inventario o créditos, esta venta no se puede corregir automáticamente por estos motivos:</p>
         <ul style="margin:0 0 12px 18px;font-size:13px;line-height:1.7">${ev.razones.map(r => `<li>${e(r)}</li>`).join('')}</ul>
         <p style="font-size:12.5px;color:var(--text-muted)">Opción: anúlala con el botón "Anular venta" y regístrala de nuevo.</p>`, '', null);
      return;
    }
    abrirModal('Corregir venta ' + venta.numero_venta,
      `<p style="font-size:13.5px;line-height:1.6;margin-bottom:12px">Se abrirá la venta en el asistente de <strong>Nueva Venta</strong> con todos sus datos para que cambies lo necesario.
        Al <strong>confirmar</strong>, se <strong>anula la venta original</strong> (devuelve el stock y revierte Caja e IVA) y se registra la nueva. Si cierras sin confirmar, no cambia nada.</p>
       <label style="font-size:12.5px;font-weight:600">¿Por qué se corrige? <span style="color:var(--danger)">*</span></label>
       <textarea id="mc-motivo" rows="3" maxlength="200" placeholder="Ej: error en la cantidad, el cliente cambió el pedido…" style="width:100%;margin-top:6px"></textarea>`,
      'Continuar', async () => {
        const motivo = ($('mc-motivo')?.value || '').trim();
        if (motivo.length < 5) { notify('Escribe el motivo (mínimo 5 letras).', 'error'); return; }
        closeModal('modal-correccion');
        await cargarEnVenta(venta, ev.detalles, motivo);
      });
  }

  function construirItem(d) {
    const prod = S.productosCache.find(p => p.id === d.producto_id);
    const esProducto = d.tipo_item === 'producto';
    // La venta original todavia descuenta su stock: para poder editarla se
    // le suma lo que ella misma ocupa (al confirmar se anula y se devuelve).
    const stockReal = esProducto ? (Number(prod.stock_actual) || 0) + (Number(d.cantidad) || 0) : null;
    const item = {
      id: prod.id, nombre: prod.nombre, sku: prod.sku || d.producto_sku || '', tipo: d.tipo_item,
      cantidad: Number(d.cantidad) || 0, precio: Number(d.precio) || 0, costo: Number(d.costo) || 0,
      descuento: Number(d.descuento) || 0, descuentoModo: 'monto',
      subtotal: 0, ganancia: 0,
      stockMax: esProducto ? (S.venderSinStockActivo ? Infinity : stockReal) : Infinity,
      stockDisponibleReal: esProducto ? stockReal : null,
      sinStock: !!d.vendido_sin_stock,
      esCombo: false,
      escalaId: d.escala_id || null, escalaNombre: d.escala_nombre || null,
      origenStockId: null, origenStockNombre: null,
      presentaciones: esProducto ? (S.presentacionesPorProducto?.[prod.id] || []) : [],
      unidadMedida: prod.unidad_medida || null, unidadCodigo: prod.unidad_codigo || null,
      permiteFraccion: (prod.permite_fraccion === true || prod.permite_fraccion === false) ? prod.permite_fraccion : null,
      presentacionId: null, presentacionNombre: null, presentacionFactor: null, precioBase: null,
      loteId: null, loteNumero: null, loteVencimiento: null,
      esRegalia: !!d.es_regalia, precioEditado: true,
    };
    recalcItem(item);
    return item;
  }

  async function cargarEnVenta(v, detalles, motivo) {
    closeModal('modal-detalle');
    await abrirNuevaVenta();                       // reinicia el asistente (y limpia cualquier corrección previa)

    // Cliente
    if (v.cliente_id) { selectClienteOpcion('existente'); seleccionarCliente(v.cliente_id); }
    else selectClienteOpcion('final');

    // Fecha original, para no mover la venta de día en los reportes
    const fi = $('nv-fecha-venta'); if (fi) fi.value = dia(v.fecha);

    // Método de pago (si es tarjeta/transferencia, el banco se vuelve a elegir como siempre)
    const m = (S.metodosPago || []).find(x => x.id === v.metodo_pago_id) ||
              (S.metodosPago || []).find(x => String(x.nombre).toLowerCase() === String(v.metodo_pago_nombre || '').toLowerCase());
    if (m) { try { seleccionarMetodoPago(m.id, m.nombre); } catch (err) { console.warn('corrección: método de pago', err); } }

    // IVA
    if (v.iva_activo) {
      try { if (!S.ivaActivo) toggleIva(); cambiarIvaPorcentaje(Number(v.iva_porcentaje) || 0); } catch (err) { console.warn('corrección: IVA', err); }
    }

    // Observaciones: se conservan las de la venta original (sin repetir etiquetas de correcciones previas)
    const obsLimpia = String(v.observaciones || '').replace(/^\s*\[(Corrige a|Reemplazada por)[^\]]*\]\s*/gm, '').trim();
    const ob = $('venta-observaciones'); if (ob) ob.value = obsLimpia;

    // Productos / servicios
    S.carrito = detalles.map(construirItem);
    renderCarritoAmbos();

    S.correccion = { ventaId: v.id, numero: v.numero_venta, motivo, anulada: false, totalOriginal: Number(v.total) || 0 };
    mostrarBanner();
    goToPaso(1);
    notify(`Corrigiendo ${v.numero_venta}: cambia lo necesario y confirma al final.`, 'warning');
  }

  function mostrarBanner() {
    limpiarBanner();
    const c = S.correccion; if (!c) return;
    const cont = document.querySelector('#modal-venta .modal-box');
    if (!cont) return;
    const b = document.createElement('div');
    b.id = 'banner-correccion';
    b.style.cssText = 'background:var(--warning-soft,#fff7e0);color:var(--warning,#b7791f);border-bottom:1px solid var(--border);padding:8px 16px;font-size:12.5px;font-weight:600';
    b.innerHTML = `✏️ Corrigiendo la venta ${e(c.numero)} — al confirmar se anula la original y se registra esta nueva.`;
    cont.insertBefore(b, cont.children[1] || null);
  }
  function limpiarBanner() { const b = $('banner-correccion'); if (b) b.remove(); }

  // Se llama desde confirmarVenta, ANTES de crear la venta nueva.
  async function anularOriginal() {
    const c = S.correccion;
    if (!c) return;
    if (!c.anulada) {
      const { data: v } = await sb.from('ventas').select('estado').eq('id', c.ventaId).eq('auth_user_id', S.userId).maybeSingle();
      if (!v) throw new Error('No se encontró la venta original. No se registró nada.');
      if (v.estado === 'anulada') { c.anulada = true; }
      else if (v.estado !== 'completada') throw new Error('La venta original ya no está completada. No se registró nada.');
      else {
        S.ventaDetalleId = c.ventaId;
        const chk = $('chk-anular-descontar-caja'); if (chk) chk.checked = true;
        await anularVenta();                       // misma rutina de siempre
        const { data: v2 } = await sb.from('ventas').select('estado').eq('id', c.ventaId).eq('auth_user_id', S.userId).maybeSingle();
        if (!v2 || v2.estado !== 'anulada') throw new Error('No se pudo anular la venta original. No se registró la nueva.');
        c.anulada = true;
      }
    }
    // Con el stock ya devuelto: recargar y confirmar que alcanza para la nueva versión
    await loadProductosCache();
    if (!S.venderSinStockActivo) {
      for (const it of S.carrito) {
        if (it.tipo !== 'producto') continue;
        const p = S.productosCache.find(x => x.id === it.id);
        const disp = Number(p?.stock_actual) || 0;
        if (unidadesInventario(it) > disp + 1e-9) {
          throw new Error(`Stock insuficiente de "${it.nombre}" (hay ${disp}). La venta original ya fue anulada: ajusta la cantidad y vuelve a confirmar.`);
        }
        it.stockMax = disp; it.stockDisponibleReal = disp;
      }
    }
  }

  // Se llama tras guardar la venta nueva.
  async function marcarReemplazo(c, numeroNuevo) {
    try {
      const { data: o } = await sb.from('ventas').select('observaciones').eq('id', c.ventaId).eq('auth_user_id', S.userId).maybeSingle();
      const marca = `[Reemplazada por ${numeroNuevo} — motivo: ${c.motivo}]`;
      const nuevo = (o?.observaciones ? o.observaciones + '\n' : '') + marca;
      await sb.from('ventas').update({ observaciones: nuevo }).eq('id', c.ventaId).eq('auth_user_id', S.userId);
      await loadVentas();
    } catch (err) { console.warn('No se pudo anotar el reemplazo en la venta original:', err); }
  }

  function permitirCierre() {
    const c = S.correccion;
    if (!c) return true;
    if (c.anulada) {
      const ok = window.confirm(`La venta ${c.numero} YA fue anulada y la corrección todavía no se ha guardado.\n\nSi cierras ahora, quedará anulada SIN reemplazo.\n\n¿Cerrar de todos modos?`);
      if (!ok) return false;
    }
    S.correccion = null; limpiarBanner();
    return true;
  }

  /* ============================================================
     B) EDICION SEGURA: nota y cliente
     ============================================================ */
  function editarNota() {
    if (!ctxActual) return;
    const { venta } = ctxActual;
    abrirModal('Editar nota de la venta ' + venta.numero_venta,
      `<p style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px">Solo cambia el texto de observaciones. No toca montos, inventario ni Caja.</p>
       <textarea id="mc-nota" rows="4" maxlength="500" style="width:100%">${e(venta.observaciones || '')}</textarea>`,
      'Guardar', async () => {
        const txt = ($('mc-nota')?.value || '').trim();
        const { error } = await sb.from('ventas').update({ observaciones: txt || null }).eq('id', venta.id).eq('auth_user_id', S.userId);
        if (error) { notify('No se pudo guardar la nota.', 'error'); return; }
        closeModal('modal-correccion');
        notify('Nota actualizada.');
        await loadVentas(); abrirDetalle(venta.id);
      });
  }

  async function motivosBloqueoCliente(v) {
    const r = [];
    if (v.estado !== 'completada') r.push('La venta no está completada.');
    if (v.canje_recompensa_id) r.push('Tiene un canje de puntos.');
    if (await contar('creditos', 'venta_id', v.id)) r.push('Tiene un crédito asociado.');
    if (await contar('puntos_movimientos', 'venta_id', v.id)) r.push('Ya generó puntos para su cliente.');
    if (await contar('garantias_clientes', 'venta_id', v.id)) r.push('Tiene garantías a nombre del cliente.');
    return r;
  }

  async function cambiarCliente() {
    if (!ctxActual) return;
    const { venta } = ctxActual;
    abrirModal('Cambiar cliente', '<p style="color:var(--text-muted)">Comprobando…</p>', '', null);
    const bloqueos = await motivosBloqueoCliente(venta);
    if (bloqueos.length) {
      abrirModal('No se puede cambiar el cliente',
        `<ul style="margin:0 0 0 18px;font-size:13px;line-height:1.7">${bloqueos.map(b => `<li>${e(b)}</li>`).join('')}</ul>
         <p style="font-size:12.5px;color:var(--text-muted);margin-top:10px">Para estos casos usa "Corregir venta" (si aplica).</p>`, '', null);
      return;
    }
    const opciones = ['<option value="">Consumidor Final</option>']
      .concat((S.clientesCache || []).map(c => `<option value="${e(c.id)}" ${c.id === venta.cliente_id ? 'selected' : ''}>${e(c.nombre)}</option>`));
    abrirModal('Cambiar cliente de ' + venta.numero_venta,
      `<p style="font-size:12.5px;color:var(--text-muted);margin-bottom:8px">Se mueve el monto de esta venta del historial del cliente anterior al nuevo. No cambia inventario ni Caja.</p>
       <select id="mc-cliente" style="width:100%">${opciones.join('')}</select>`,
      'Guardar', async () => {
        const nuevoId = $('mc-cliente')?.value || null;
        if ((nuevoId || null) === (venta.cliente_id || null)) { closeModal('modal-correccion'); return; }
        const nuevo = nuevoId ? S.clientesCache.find(c => c.id === nuevoId) : null;
        const total = redondear(venta.total);
        const { error } = await sb.from('ventas').update({ cliente_id: nuevoId, cliente_nombre: nuevo ? nuevo.nombre : 'Consumidor Final' })
          .eq('id', venta.id).eq('auth_user_id', S.userId);
        if (error) { notify('No se pudo cambiar el cliente.', 'error'); return; }
        const mover = async (id, signo) => {
          if (!id) return;
          try {
            const { data: c } = await sb.from('clientes').select('total_compras,num_compras').eq('id', id).eq('auth_user_id', S.userId).maybeSingle();
            if (!c) return;
            await sb.from('clientes').update({
              total_compras: Math.max(0, redondear((Number(c.total_compras) || 0) + signo * total)),
              num_compras: Math.max(0, (Number(c.num_compras) || 0) + signo),
            }).eq('id', id).eq('auth_user_id', S.userId);
          } catch (err) { console.warn('cambiarCliente: historial del cliente', err); }
        };
        await mover(venta.cliente_id, -1);
        await mover(nuevoId, +1);
        closeModal('modal-correccion');
        notify('Cliente actualizado.');
        await loadVentas(); abrirDetalle(venta.id);
      });
  }

  /* ============================================================
     Botones en el detalle de la venta (los llama abrirDetalle)
     ============================================================ */
  function decorarDetalle(venta) {
    ctxActual = { venta };
    const btn = $('btn-corregir-venta');
    if (btn) btn.style.display = venta.estado === 'completada' ? '' : 'none';
    const body = $('det-body');
    if (!body || venta.estado !== 'completada') return;
    const prev = $('det-herramientas-edicion'); if (prev) prev.remove();
    const bar = document.createElement('div');
    bar.id = 'det-herramientas-edicion';
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px';
    bar.innerHTML = `<button class="btn-secondary btn-sm" onclick="N360Correccion.editarNota()">📝 Editar nota</button>
                     <button class="btn-secondary btn-sm" onclick="N360Correccion.cambiarCliente()">👤 Cambiar cliente</button>`;
    body.insertBefore(bar, body.firstChild);
  }

  window.N360Correccion = { iniciar, editarNota, cambiarCliente, decorarDetalle, anularOriginal, marcarReemplazo, permitirCierre, limpiarBanner, _evaluar: evaluar };
})();
