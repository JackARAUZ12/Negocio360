/* =====================================================
   TRANSPORTE-COBRO.JS — NEGOCIO360 · Cobrar un viaje
   Pantalla de cobro PROPIA de Transporte (no lleva a Ventas),
   pero la venta se registra con el MISMO motor de Ventas
   (ventas.html?tx_cobro=1&motor=1, oculto): Caja, bancos,
   crédito, IVA, retención de IR, contabilidad y reportes
   quedan igual que una venta directa.
   Candados: se relee la orden antes de cobrar (si ya tiene una
   venta que no está anulada, no se cobra dos veces); Ventas
   vuelve a revisar justo antes de registrar y, al confirmar,
   liga la orden a la venta (transporte_ordenes.venta_id).
   Requiere de la página: TX (transporte-comun.js).
===================================================== */
const TXCobro = (() => {
  const E = { abierto: false };
  const sb = () => TX.sb;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const motor = () => { try { return document.getElementById('txc-marco')?.contentWindow?.N360MotorVenta || null; } catch (_) { return null; } };
  const f = n => { try { const m = motor(); if (m) return m.fmt(n); } catch (_) {} return TX.fmtMoneda(n); };
  const NOMBRE_SERVICIO = 'Flete de transporte';

  function estilos() {
    if (document.getElementById('txc-estilos')) return;
    const st = document.createElement('style'); st.id = 'txc-estilos';
    st.textContent = `
#txc-cobro{position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:12px}
#txc-cobro .txc-caja{background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#111827);width:100%;max-width:560px;max-height:94vh;border-radius:16px;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}
#txc-cobro .txc-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border,#e5e7eb)}
#txc-cobro .txc-tit{font-weight:800;font-size:16px;min-width:0;overflow-wrap:anywhere}
#txc-cobro .txc-x{border:none;background:none;font-size:22px;cursor:pointer;color:var(--text-muted,#6b7280);line-height:1;padding:4px 8px}
#txc-cobro .txc-cuerpo{padding:14px 16px;overflow-y:auto;flex:1;min-height:0}
#txc-cobro .txc-pie{padding:12px 16px;border-top:1px solid var(--border,#e5e7eb);display:flex;flex-direction:column;gap:8px}
#txc-cobro .txc-sec{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted,#6b7280);margin:14px 0 6px}
#txc-cobro .txc-chips{display:flex;flex-wrap:wrap;gap:6px}
#txc-cobro .txc-chip{border:1.5px solid var(--border,#e5e7eb);background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#111827);border-radius:999px;padding:8px 13px;font-size:13.5px;font-weight:600;cursor:pointer;min-height:38px}
#txc-cobro .txc-chip.activo{border-color:var(--accent,#4f46e5);background:var(--accent-soft,#eef2ff);color:var(--accent,#4f46e5)}
#txc-cobro .txc-linea{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--border,#e5e7eb);font-size:13.5px}
#txc-cobro .txc-linea span{min-width:0;overflow-wrap:anywhere}
#txc-cobro .txc-linea b{flex:none;white-space:nowrap}
#txc-cobro .txc-linea small{display:block;color:var(--text-muted,#6b7280);font-size:12px}
#txc-cobro .txc-tot{margin-top:10px;font-size:14px}
#txc-cobro .txc-tot div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
#txc-cobro .txc-grande{font-size:20px;font-weight:900}
#txc-cobro .txc-ayuda{font-size:12.5px;color:var(--text-muted,#6b7280)}
#txc-cobro .txc-info{font-size:12.5px;background:var(--accent-soft,#eef2ff);color:var(--text-primary,#111827);border-radius:10px;padding:9px 11px;margin-top:10px}
#txc-cobro .txc-ret{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;font-size:13px}
#txc-cobro .txc-ret input[type=checkbox]{width:18px;height:18px;flex:none;margin:0;accent-color:var(--accent,#4f46e5)}
#txc-cobro .txc-ret input[type=number]{width:80px;flex:none}
#txc-cobro .txc-in{box-sizing:border-box;border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:9px 11px;font-size:15px;background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#111827)}
#txc-cobro .txc-fila{display:flex;gap:10px;margin-top:10px}
#txc-cobro .txc-fila>div{flex:1;min-width:0}
#txc-cobro .txc-fila .txc-in{width:100%}
#txc-cobro .txc-lab{display:block;font-size:12px;font-weight:700;color:var(--text-muted,#6b7280);margin-bottom:4px}
#txc-cobro .txc-cambio{font-size:18px;font-weight:900;padding:8px 0}
#txc-cobro .txc-err{color:var(--danger,#dc2626);font-size:13px;min-height:1em;margin-top:8px}
#txc-cobro .txc-btn{width:100%;border:none;border-radius:12px;padding:13px;font-size:16px;font-weight:800;cursor:pointer;background:var(--accent,#4f46e5);color:#fff}
#txc-cobro .txc-btn:disabled{opacity:.55;cursor:not-allowed}
#txc-cobro .txc-link{border:none;background:none;color:var(--accent,#4f46e5);font-weight:700;font-size:13px;cursor:pointer;padding:6px}
#txc-cobro .txc-cargando{padding:30px 10px;text-align:center;color:var(--text-muted,#6b7280)}
#txc-cobro .txc-ok{text-align:center;padding:10px 0}
#txc-cobro .txc-ok-ico{font-size:44px}
#txc-cobro .txc-ok-tit{font-size:20px;font-weight:900;margin-top:6px}
#txc-marco{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;top:0}
#txc-cobro.txc-avanzado .txc-caja{max-width:980px;height:94vh}
#txc-cobro.txc-avanzado .txc-cuerpo{display:none}
#txc-cobro.txc-avanzado #txc-marco{position:static;width:100%;flex:1;height:auto;opacity:1;pointer-events:auto;left:auto}
@media (max-width:420px){#txc-cobro{padding:6px}#txc-cobro .txc-fila{flex-direction:column}}`;
    document.head.appendChild(st);
  }
  function modal() {
    estilos();
    let m = document.getElementById('txc-cobro');
    if (m) return m;
    m = document.createElement('div'); m.id = 'txc-cobro'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'txc-tit');
    m.innerHTML = `<div class="txc-caja"><div class="txc-cab"><div class="txc-tit" id="txc-tit">Cobrar viaje</div><button type="button" class="txc-x" id="txc-x" aria-label="Cerrar">✕</button></div>
      <div class="txc-cuerpo" id="txc-cuerpo"></div><iframe id="txc-marco" title="Venta del viaje" src="about:blank"></iframe><div class="txc-pie" id="txc-pie"></div></div>`;
    document.body.appendChild(m);
    m.querySelector('#txc-x').addEventListener('click', cerrar);
    window.addEventListener('message', async ev => {
      const fr = document.getElementById('txc-marco');
      if (!E.abierto || !fr || ev.source !== fr.contentWindow || ev.origin !== location.origin) return;
      if (!ev.data || ev.data.tipo !== 'n360_operacion_completada' || !ev.data.ventaId || E.ventaId) return;
      await hecho({ ventaId: ev.data.ventaId, numero: String(ev.data.nota || '').replace(/^Venta\s*/, ''), total: ev.data.monto }, true);
    });
    return m;
  }

  // El servicio "Flete de transporte" del catálogo (se crea una sola vez, como siempre se hizo en Facturación).
  async function servicioFlete() {
    const { data: ex } = await sb().from('productos').select('id,activo').eq('auth_user_id', TX.userId).eq('nombre', NOMBRE_SERVICIO).eq('tipo', 'servicio').limit(1);
    if (ex && ex.length) { if (ex[0].activo === false) await sb().from('productos').update({ activo: true }).eq('id', ex[0].id).eq('auth_user_id', TX.userId); return ex[0].id; }
    const { data, error } = await sb().from('productos').insert({ auth_user_id: TX.userId, tipo: 'servicio', nombre: NOMBRE_SERVICIO, precio: 0, costo: 0, stock_actual: 0, activo: true }).select('id').single();
    if (error) throw error;
    return data.id;
  }
  function observaciones(o) {
    const p = [`Viaje ${o.numero || ''}: ${o.origen || '—'} → ${o.destino || '—'}`];
    if (o.entrega_real) p.push(`entregado ${TX.fmtFecha(o.entrega_real)}`);
    if (o.receptor) p.push(`recibió ${o.receptor}`);
    if (o.carga_descripcion) p.push(`carga: ${o.carga_descripcion}`);
    return p.join(' · ');
  }

  /* ---------- 1) Abrir: revisar la orden y preparar la venta ---------- */
  async function abrir(ordenId, { alCerrar } = {}) {
    if (E.abierto) return true;
    const m = modal();
    Object.assign(E, { abierto: true, ordenId, orden: null, alCerrar: alCerrar || null, ventaId: null, venta: null, metodo: null, banco: null, bancos: [], estado: null, cobrando: false, ret: { activo: false, pct: 2 } });
    m.classList.remove('txc-avanzado');
    document.getElementById('txc-tit').textContent = '💳 Cobrar viaje';
    document.getElementById('txc-cuerpo').innerHTML = '<div class="txc-cargando">Revisando el viaje…</div>';
    document.getElementById('txc-pie').innerHTML = '';
    m.style.display = 'flex';
    try {
      const { data: o, error } = await sb().from('transporte_ordenes').select('*').eq('id', ordenId).eq('auth_user_id', TX.userId).maybeSingle();
      if (error) throw error;
      if (!o) return pintarError('Esa orden ya no existe.');
      if (o.venta_id) {
        const { data: v } = await sb().from('ventas').select('numero_venta, estado').eq('id', o.venta_id).eq('auth_user_id', TX.userId).maybeSingle();
        if (v && v.estado !== 'anulada') return pintarError(`Este viaje ya está cobrado (venta ${v.numero_venta || ''}). No se cobra dos veces.`);
      }
      if (o.estado !== 'entregada') return pintarError('Primero registra la entrega del viaje: solo se cobran viajes entregados.');
      if (!(Number(o.total) > 0)) return pintarError('El viaje no tiene precio (total en cero). Ponle el flete en la orden.');
      if (!o.cliente_id) return pintarError('La orden no tiene cliente. Edita la orden y elige el cliente para poder cobrarla.');
      E.orden = o;
      document.getElementById('txc-tit').textContent = `💳 Cobrar viaje ${o.numero || ''}`.trim();
      const productoId = await servicioFlete();
      sessionStorage.setItem('n360_tx_cobro', JSON.stringify({
        ordenId: o.id, numero: o.numero, clienteId: o.cliente_id, productoId, monto: Number(o.total) || 0,
        concepto: `Flete ${o.numero}: ${o.origen || ''} → ${o.destino || ''}`, auto: true, observaciones: observaciones(o),
      }));
      document.getElementById('txc-cuerpo').innerHTML = '<div class="txc-cargando">Preparando la venta…</div>';
      cargarMotor();
    } catch (e) { console.error('cobro transporte:', e); pintarError('No se pudo preparar el cobro. Revisa tu conexión e intenta de nuevo.'); }
    return true;
  }
  function cargarMotor() {
    const fr = document.getElementById('txc-marco');
    clearInterval(E.vigia); let n = 0;
    E.vigia = setInterval(() => {
      n++;
      const mt = motor();
      if (mt) { let e = null; try { e = mt.estado(); } catch (_) {} if (e && e.listo) { clearInterval(E.vigia); E.estado = e; pintarPago(); return; } }
      if (n > 600) { clearInterval(E.vigia); pintarError('No se pudo preparar la venta. Revisa tu conexión y vuelve a intentarlo.', true); }
    }, 50);
    fr.src = 'ventas.html?tx_cobro=1&motor=1';
  }
  function pintarError(msg, conAvanzado) {
    document.getElementById('txc-cuerpo').innerHTML = `<div class="txc-cargando" style="color:var(--danger,#dc2626)">${esc(msg)}</div>`;
    document.getElementById('txc-pie').innerHTML = (conAvanzado ? '<button type="button" class="txc-link" id="txc-avanzado">Otras opciones (abrir la venta completa aquí mismo) →</button>' : '')
      + '<button type="button" class="txc-link" id="txc-cerrar2">Cerrar</button>';
    document.getElementById('txc-cerrar2').addEventListener('click', cerrar);
    const av = document.getElementById('txc-avanzado'); if (av) av.addEventListener('click', avanzado);
  }

  /* ---------- 2) Forma de pago y cobrar ---------- */
  const aPagar = () => r2(Number(E.estado?.resumen?.cobrar ?? E.estado?.resumen?.total) || 0);
  function refrescarEstado() { try { E.estado = motor().estado(); } catch (_) {} }
  function totalesHtml() {
    const r = E.estado.resumen || {}, t = r.texto || {};
    return `<div><span>Subtotal</span><span>${esc(t.subtotal)}</span></div>
      ${Number(r.descuento) > 0 ? `<div><span>Descuento</span><span>-${esc(t.descuento)}</span></div>` : ''}
      ${Number(r.impuestos) > 0 ? `<div><span>${esc(E.estado.impuestosTexto)}</span><span>${esc(t.impuestos)}</span></div>` : ''}
      ${Number(r.retencionIr) > 0 ? `<div><span>Total de la factura</span><span>${esc(t.total)}</span></div><div><span>Retención IR (${esc(String(r.retencionPct))}%)</span><span>-${esc(t.retencionIr)}</span></div>` : ''}
      <div class="txc-grande"><span>${Number(r.retencionIr) > 0 ? 'Recibes' : 'Total a cobrar'}</span><span>${esc(t.cobrar)}</span></div>`;
  }
  async function pintarPago() {
    const e = E.estado, o = E.orden;
    document.getElementById('txc-cuerpo').innerHTML = `
      <div class="txc-ayuda">Cliente: <b>${esc(o.cliente_nombre || e.cliente || '')}</b></div>
      ${e.items.map(i => `<div class="txc-linea"><span>${esc(i.nombre)}<small>${esc(o.origen || '—')} → ${esc(o.destino || '—')}${o.entrega_real ? ' · entregado ' + esc(TX.fmtFecha(o.entrega_real)) : ''}</small></span><b>${esc(i.texto)}</b></div>`).join('')}
      <div class="txc-tot" id="txc-tot">${totalesHtml()}</div>
      ${e.retencion ? `<label class="txc-ret"><input type="checkbox" id="txc-ret-chk" ${E.ret.activo ? 'checked' : ''}/> El cliente me retiene IR
        <input type="number" class="txc-in" id="txc-ret-pct" min="0" max="100" step="0.01" value="${esc(String(E.ret.pct))}" ${E.ret.activo ? '' : 'disabled'} aria-label="Porcentaje de retención"/> %</label>` : ''}
      <div class="txc-sec">¿Cómo te paga?</div>
      <div class="txc-chips" id="txc-metodos">${e.metodos.map(mt => `<button type="button" class="txc-chip" data-metodo="${esc(mt.id)}" data-nombre="${esc(mt.nombre)}">${esc(mt.nombre)}</button>`).join('')
        + (e.fiado ? '<button type="button" class="txc-chip" data-metodo="__fiado" data-nombre="A crédito">🧾 A crédito (paga después)</button>' : '') || '<span class="txc-ayuda">No hay formas de pago activas: configúralas en Caja.</span>'}</div>
      <div id="txc-bancos-wrap" style="display:none"><div class="txc-sec">¿A qué banco entra?</div><div class="txc-chips" id="txc-bancos"></div></div>
      <div id="txc-efectivo" class="txc-fila" style="display:none">
        <div><label class="txc-lab" for="txc-recibido">Recibido</label><input class="txc-in" id="txc-recibido" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00"/></div>
        <div><span class="txc-lab">Cambio</span><div class="txc-cambio" id="txc-cambio">—</div></div></div>
      <div class="txc-info">ℹ️ Se registra como una venta normal: queda en <b>Ventas</b> y en <b>Caja</b> (o en <b>Créditos</b> si es a crédito), con sus impuestos y reportes. La orden queda marcada como cobrada.</div>
      <div class="txc-err" id="txc-err" role="alert"></div>`;
    document.getElementById('txc-pie').innerHTML = `<button type="button" class="txc-btn" id="txc-cobrar" disabled>Cobrar ${esc(f(aPagar()))}</button>
      <button type="button" class="txc-link" id="txc-avanzado">Otras opciones (pago en varias formas, descuento, crédito por cuotas…) →</button>`;
    document.querySelectorAll('#txc-metodos [data-metodo]').forEach(b => b.addEventListener('click', () => elegirMetodo(b.dataset.metodo, b.dataset.nombre)));
    document.getElementById('txc-recibido').addEventListener('input', cambio);
    document.getElementById('txc-cobrar').addEventListener('click', cobrar);
    document.getElementById('txc-avanzado').addEventListener('click', avanzado);
    const chk = document.getElementById('txc-ret-chk'), pct = document.getElementById('txc-ret-pct');
    const aplicarRet = () => {
      E.ret = { activo: !!chk.checked, pct: Math.min(100, Math.max(0, Number(pct.value) || 0)) };
      pct.disabled = !E.ret.activo;
      try { motor().retencion(E.ret.activo, E.ret.pct); } catch (_) {}
      refrescarEstado(); document.getElementById('txc-tot').innerHTML = totalesHtml(); listo(); cambio();
    };
    if (chk) { chk.addEventListener('change', aplicarRet); pct.addEventListener('input', aplicarRet); }
    try { E.bancos = await motor().bancos(); } catch (_) { E.bancos = []; }
    if (e.metodos.length === 1 && !e.fiado) elegirMetodo(e.metodos[0].id, e.metodos[0].nombre);
  }
  const necesitaBanco = nombre => /tarjeta|transferencia|dep[oó]sito|cheque/i.test(nombre || '') && E.bancos.length > 0;
  function elegirMetodo(id, nombre) {
    if (E.cobrando) return;
    E.metodo = { id, nombre }; E.banco = null;
    document.querySelectorAll('#txc-metodos [data-metodo]').forEach(b => b.classList.toggle('activo', b.dataset.metodo === id));
    const conBanco = id !== '__fiado' && necesitaBanco(nombre);
    document.getElementById('txc-bancos-wrap').style.display = conBanco ? '' : 'none';
    if (conBanco) {
      document.getElementById('txc-bancos').innerHTML = E.bancos.map(b => `<button type="button" class="txc-chip" data-banco="${esc(b.id)}">🏦 ${esc(b.nombre)}</button>`).join('');
      document.querySelectorAll('#txc-bancos [data-banco]').forEach(b => b.addEventListener('click', () => {
        E.banco = E.bancos.find(x => x.id === b.dataset.banco) || null;
        document.querySelectorAll('#txc-bancos [data-banco]').forEach(x => x.classList.toggle('activo', x === b)); listo();
      }));
    }
    document.getElementById('txc-efectivo').style.display = /efectivo/i.test(nombre) ? 'flex' : 'none';
    // A crédito no se aplica la retención ahora (Ventas la toma solo en ventas de contado).
    const chk = document.getElementById('txc-ret-chk');
    if (chk) { chk.disabled = id === '__fiado'; if (id === '__fiado' && chk.checked) { chk.checked = false; chk.dispatchEvent(new Event('change')); } }
    document.getElementById('txc-err').textContent = id === '__fiado' ? 'Queda a crédito: lo verás en "Por cobrar" y en Créditos hasta que te pague.' : '';
    listo(); cambio();
  }
  function listo() {
    const b = document.getElementById('txc-cobrar'); if (!b) return;
    b.disabled = !E.metodo || (E.metodo.id !== '__fiado' && necesitaBanco(E.metodo.nombre) && !E.banco) || E.cobrando;
    b.textContent = (E.metodo?.id === '__fiado' ? 'Registrar a crédito ' : 'Cobrar ') + f(aPagar());
  }
  function cambio() {
    const el = document.getElementById('txc-cambio'); if (!el) return;
    const rec = Number(document.getElementById('txc-recibido').value);
    if (!(rec > 0)) { el.textContent = '—'; el.style.color = ''; return; }
    const d = r2(rec - aPagar());
    el.textContent = d >= 0 ? f(d) : 'Faltan ' + f(-d);
    el.style.color = d >= 0 ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)';
  }
  async function cobrar() {
    if (E.cobrando || E.ventaId) return;
    const mt = E.metodo, mot = motor(); if (!mt || !mot) return;
    const rec = Number(document.getElementById('txc-recibido')?.value);
    if (/efectivo/i.test(mt.nombre) && rec > 0 && rec + 0.004 < aPagar()) { document.getElementById('txc-err').textContent = 'Lo recibido es menos que el total a cobrar.'; return; }
    E.cobrando = true; listo();
    document.getElementById('txc-cobrar').textContent = 'Cobrando…';
    document.getElementById('txc-err').textContent = '';
    let r;
    try { r = await mot.cobrar({ metodoId: mt.id === '__fiado' ? null : mt.id, metodoNombre: mt.nombre, fiado: mt.id === '__fiado', banco: E.banco, notas: observaciones(E.orden) }); }
    catch (e) { r = { ok: false, motivo: 'No se pudo registrar la venta. Intenta de nuevo.' }; }
    E.cobrando = false;
    if (r && r.ok) { if (!E.ventaId) await hecho(r, false); return; }
    listo();
    document.getElementById('txc-err').textContent = (r && r.motivo) || 'No se registró la venta.';
  }
  // Otras opciones: la venta completa (la misma de Ventas) se muestra aquí mismo, dentro de Transporte.
  function avanzado() {
    if (E.ventaId) return;
    const m = document.getElementById('txc-cobro'); m.classList.add('txc-avanzado');
    try { motor()?.irAPago(); } catch (_) {}
    document.getElementById('txc-pie').innerHTML = '<div class="txc-ayuda" style="text-align:center">Completa la venta aquí arriba. Al confirmarla, el viaje queda cobrado.</div>';
  }

  /* ---------- 3) Cobrado: ligar la orden, ticket ---------- */
  async function hecho(r, desdeAvanzado) {
    E.ventaId = r.ventaId; E.venta = r;
    document.getElementById('txc-cobro').classList.remove('txc-avanzado');
    // Ventas ya liga la orden al confirmar; si no alcanzó, se liga aquí (sin pisar otra venta).
    try {
      const { data: o } = await sb().from('transporte_ordenes').select('venta_id').eq('id', E.ordenId).eq('auth_user_id', TX.userId).maybeSingle();
      if (o && o.venta_id !== r.ventaId) await sb().from('transporte_ordenes').update({ venta_id: r.ventaId, facturada_en: new Date().toISOString() }).eq('id', E.ordenId).eq('auth_user_id', TX.userId);
    } catch (e) { console.warn('ligar orden:', e); }
    const total = Number(r.total) || 0, credito = !desdeAvanzado && E.metodo?.id === '__fiado';
    const rec = Number(document.getElementById('txc-recibido')?.value);
    const dif = !desdeAvanzado && /efectivo/i.test(E.metodo?.nombre || '') && rec > 0 ? r2(rec - aPagar()) : 0;
    document.getElementById('txc-cuerpo').innerHTML = `<div class="txc-ok"><div class="txc-ok-ico">✅</div>
      <div class="txc-ok-tit">${credito ? 'Registrado a crédito' : 'Cobrado'} ${esc(f(total))}</div>
      <div class="txc-ayuda">Venta ${esc(r.numero || '')}${E.metodo?.nombre && !desdeAvanzado ? ' · ' + esc(E.metodo.nombre) : ''}</div>
      ${dif > 0 ? `<div style="margin-top:12px;font-size:20px;font-weight:900">Cambio: ${esc(f(dif))}</div>` : ''}
      <div class="txc-ayuda" style="margin-top:12px">${credito ? 'Quedó en Ventas y en Créditos: cuando te pague, regístralo en "Por cobrar".' : 'Quedó en Ventas y en Caja, como cualquier venta.'} La orden ${esc(E.orden?.numero || '')} quedó cobrada.</div>
      <div class="txc-chips" style="margin-top:14px;justify-content:center"><button type="button" class="txc-chip" id="txc-ticket">🧾 Imprimir ticket</button><button type="button" class="txc-chip" id="txc-pdf">📄 Recibo PDF</button></div></div>`;
    document.getElementById('txc-pie').innerHTML = '<button type="button" class="txc-btn" id="txc-listo">✓ Listo</button>';
    document.getElementById('txc-listo').addEventListener('click', cerrar);
    document.getElementById('txc-ticket').addEventListener('click', () => {
      let w = null; try { w = window.open('', '_blank', 'width=380,height=600'); } catch (_) {}
      Promise.resolve(motor()?.imprimirTicket(r.ventaId, w)).catch(() => { try { w && w.close(); } catch (_) {} TX.toast('No se pudo imprimir el ticket.', 'error'); });
    });
    document.getElementById('txc-pdf').addEventListener('click', () => { Promise.resolve(motor()?.descargarRecibo(r.ventaId)).catch(() => {}); });
  }

  function cerrar() {
    if (E.cobrando) return;                                   // no se cierra a media venta
    clearInterval(E.vigia);
    const m = document.getElementById('txc-cobro'); if (m) { m.style.display = 'none'; m.classList.remove('txc-avanzado'); }
    const fr = document.getElementById('txc-marco'); if (fr) fr.src = 'about:blank';
    try { sessionStorage.removeItem('n360_tx_cobro'); } catch (_) {}
    const cobrado = !!E.ventaId, fin = E.alCerrar;
    if (!cobrado && E.abierto) TX.toast('No se cobró nada.');
    E.abierto = false; E.alCerrar = null;
    if (typeof fin === 'function') { try { fin(cobrado); } catch (_) {} }
  }
  return { abrir, cerrar, _estado: () => E };
})();
window.TXCobro = TXCobro;
