/* =====================================================
   RESTAURANTE-COBRO.JS — NEGOCIO360 · Cobro de una mesa
   Pantalla de cobro PROPIA del restaurante (no lleva a Ventas),
   pero la venta se registra con el MISMO motor de Ventas
   (ventas.html?rest_cobro=1&motor=1, oculto): Caja, inventario,
   lotes, impuestos, contabilidad y reportes quedan igual que
   una venta directa.
   Candados: el servidor aparta los platillos que se cobran
   (restaurante_cobro_reservar) y nadie más puede cobrarlos ni
   cancelarlos mientras tanto; Ventas vuelve a revisar justo
   antes de registrar; un platillo cobrado queda ligado a su
   venta y ya no se toca. Pago dividido real: se cobra solo lo
   elegido y la mesa se cierra sola cuando todo está pagado.
   La propina va APARTE de la venta (Caja · otro ingreso, para
   el personal), anotada una sola vez.
   Requiere de la página: sb, STATE, showToast y CajaAPI.
===================================================== */
const RCobro = (() => {
  const E = { abierto: false };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const motor = () => { try { return document.getElementById('rc-marco')?.contentWindow?.N360MotorVenta || null; } catch (_) { return null; } };
  const f = n => { try { const m = motor(); if (m) return m.fmt(n); } catch (_) {} return (typeof fmt === 'function') ? fmt(n) : 'C$ ' + r2(n).toFixed(2); };
  const MOTIVOS = {
    no_existe: 'Esa cuenta ya no existe.', cerrada: 'Esa mesa ya se cerró.', en_cobro: 'Alguien más está cobrando esta mesa en este momento.',
    item_no_disponible: 'Un platillo ya se cobró o se canceló mientras tanto. Vuelve a abrir el cobro.', items_invalidos: 'La selección no es válida. Vuelve a intentarlo.',
    cantidad_invalida: 'Una cantidad no es válida.', nada_por_cobrar: 'No hay nada por cobrar en esta mesa.',
    sin_producto: 'Un platillo ya no está en el menú (catálogo): no se puede cobrar por Ventas.',
  };

  function estilos() {
    if (document.getElementById('rc-estilos')) return;
    const st = document.createElement('style'); st.id = 'rc-estilos';
    st.textContent = `
#rc-cobro{position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:12px}
#rc-cobro .rc-caja{background:var(--bg-surface,#fff);color:var(--text-primary,#111827);width:100%;max-width:560px;max-height:94vh;border-radius:16px;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}
#rc-cobro .rc-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border,#e5e7eb)}
#rc-cobro .rc-tit{font-weight:800;font-size:16px;min-width:0;overflow-wrap:anywhere}
#rc-cobro .rc-x{border:none;background:none;font-size:22px;cursor:pointer;color:var(--text-muted,#6b7280);line-height:1;padding:4px 8px}
#rc-cobro .rc-cuerpo{padding:14px 16px;overflow-y:auto;flex:1;min-height:0}
#rc-cobro .rc-pie{padding:12px 16px;border-top:1px solid var(--border,#e5e7eb);display:flex;flex-direction:column;gap:8px}
#rc-cobro .rc-sec{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted,#6b7280);margin:14px 0 6px}
#rc-cobro .rc-sec:first-child{margin-top:0}
#rc-cobro .rc-chips{display:flex;flex-wrap:wrap;gap:6px}
#rc-cobro .rc-chip{border:1.5px solid var(--border,#e5e7eb);background:var(--bg-surface,#fff);color:var(--text-primary,#111827);border-radius:999px;padding:8px 13px;font-size:13.5px;font-weight:600;cursor:pointer;min-height:38px}
#rc-cobro .rc-chip.activo{border-color:var(--accent,#4f46e5);background:var(--accent-soft,#eef2ff);color:var(--accent,#4f46e5)}
#rc-cobro .rc-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--border,#e5e7eb)}
#rc-cobro .rc-item-n{flex:1;min-width:0;font-size:13.5px;overflow-wrap:anywhere}
#rc-cobro .rc-item-n small{display:block;color:var(--text-muted,#6b7280);font-size:12px}
#rc-cobro .rc-paso{display:flex;align-items:center;gap:4px;flex-shrink:0}
#rc-cobro .rc-paso button{width:34px;height:34px;border-radius:8px;border:1px solid var(--border,#e5e7eb);background:var(--bg-surface,#fff);color:var(--text-primary,#111827);font-size:18px;cursor:pointer}
#rc-cobro .rc-paso span{min-width:42px;text-align:center;font-weight:700;font-size:13px}
#rc-cobro .rc-monto{font-weight:700;font-size:13.5px;flex-shrink:0;min-width:74px;text-align:right}
#rc-cobro .rc-tot{margin-top:12px;border-top:1px solid var(--border,#e5e7eb);padding-top:10px;font-size:14px}
#rc-cobro .rc-tot div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
#rc-cobro .rc-grande{font-size:20px;font-weight:900}
#rc-cobro .rc-ayuda{font-size:12.5px;color:var(--text-muted,#6b7280);margin-top:6px}
#rc-cobro .rc-in{width:100%;box-sizing:border-box;border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:10px 12px;font-size:15px;background:var(--bg-surface,#fff);color:var(--text-primary,#111827)}
#rc-cobro .rc-fila{display:flex;gap:10px}
#rc-cobro .rc-fila>div{flex:1;min-width:0}
#rc-cobro .rc-lab{font-size:12px;color:var(--text-muted,#6b7280);display:block;margin-bottom:4px}
#rc-cobro .rc-cambio{font-size:18px;font-weight:800;padding:8px 0}
#rc-cobro .rc-btn{width:100%;min-height:50px;border:none;border-radius:12px;background:var(--accent,#4f46e5);color:#fff;font-size:16px;font-weight:800;cursor:pointer}
#rc-cobro .rc-btn:disabled{opacity:.5;cursor:not-allowed}
#rc-cobro .rc-link{border:none;background:none;color:var(--accent,#4f46e5);font-size:13px;font-weight:600;cursor:pointer;padding:6px;text-align:center}
#rc-cobro .rc-err{color:var(--danger,#dc2626);font-size:13px;margin-top:8px;min-height:1px}
#rc-cobro .rc-aviso{background:var(--warning-soft,#fef3c7);color:var(--text-primary,#111827);border-radius:10px;padding:10px 12px;font-size:13px;margin-top:8px}
#rc-cobro .rc-ok{text-align:center;padding:10px 0}
#rc-cobro .rc-ok-ico{font-size:44px}
#rc-cobro .rc-ok-tit{font-size:22px;font-weight:900;margin-top:4px}
#rc-cobro .rc-cargando{text-align:center;padding:40px 10px;color:var(--text-muted,#6b7280)}
#rc-cobro .rc-res{border:1px solid var(--border,#e5e7eb);border-radius:10px;margin-top:6px;max-height:180px;overflow-y:auto}
#rc-cobro .rc-res div{padding:9px 11px;cursor:pointer;font-size:13.5px}
#rc-cobro .rc-res div:hover{background:var(--bg-hover,#f3f4f6)}
#rc-marco{border:none;width:100%;height:0;display:block}
#rc-cobro.rc-avanzado .rc-cuerpo{display:none}
#rc-cobro.rc-avanzado #rc-marco{height:70vh}
@media (max-width:480px){#rc-cobro{padding:0;align-items:stretch}#rc-cobro .rc-caja{max-height:100vh;border-radius:0;max-width:none}#rc-cobro .rc-monto{min-width:64px}}`;
    document.head.appendChild(st);
  }
  function modal() {
    let m = document.getElementById('rc-cobro');
    if (m) return m;
    estilos();
    m = document.createElement('div'); m.id = 'rc-cobro'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="rc-caja"><div class="rc-cab"><span class="rc-tit" id="rc-tit">💰 Cobrar</span><button type="button" class="rc-x" aria-label="Cerrar" id="rc-x">×</button></div>
      <div class="rc-cuerpo" id="rc-cuerpo"></div><iframe id="rc-marco" title="Venta" src="about:blank"></iframe><div class="rc-pie" id="rc-pie"></div></div>`;
    document.body.appendChild(m);
    document.getElementById('rc-x').addEventListener('click', cerrar);
    window.addEventListener('message', async ev => {
      const fr = document.getElementById('rc-marco');
      if (!E.abierto || !fr || ev.source !== fr.contentWindow || ev.origin !== location.origin) return;
      if (!ev.data || ev.data.tipo !== 'n360_operacion_completada' || !ev.data.ventaId || E.ventaId) return;
      await hecho({ ventaId: ev.data.ventaId, numero: String(ev.data.nota || '').replace(/^Venta\s*/, ''), total: ev.data.monto }, true);
    });
    return m;
  }

  /* ---------- 1) Qué se cobra ---------- */
  async function abrir(comanda, { alCerrar } = {}) {
    if (E.abierto) return;
    const m = modal();
    Object.assign(E, { abierto: true, comanda, alCerrar: alCerrar || null, items: [], sel: {}, modo: 'todo', propinaPct: 10, propinaOtro: '', personas: 1,
      clienteId: null, clienteNombre: '', cobroId: null, lineas: [], estado: null, metodo: null, banco: null, bancos: [], cobrando: false, ventaId: null, venta: null, propinaHecha: false, cerrada: false });
    m.classList.remove('rc-avanzado');
    document.getElementById('rc-tit').textContent = `💰 Cobrar — Mesa ${comanda.restaurante_mesas?.numero || ''}`;
    document.getElementById('rc-cuerpo').innerHTML = '<div class="rc-cargando">Cargando la cuenta…</div>'; document.getElementById('rc-pie').innerHTML = '';
    m.style.display = 'flex';
    try {
      const { data, error } = await sb.from('restaurante_comanda_items').select('*').eq('comanda_id', comanda.id).eq('auth_user_id', STATE.userId)
        .neq('estado', 'cancelado').is('venta_id', null).order('created_at');
      if (error) throw error;
      E.items = data || [];
    } catch (e) { console.error('cobro: cargar platillos', e); pintarError('No se pudo cargar la cuenta. Revisa tu conexión.'); return; }
    if (!E.items.length) { pintarError('No hay nada pendiente de cobrar en esta mesa.'); return; }
    E.items.forEach(i => { E.sel[i.id] = Number(i.cantidad); });
    pintarElegir();
  }
  function pintarError(msg) {
    document.getElementById('rc-cuerpo').innerHTML = `<div class="rc-cargando" style="color:var(--danger,#dc2626)">${esc(msg)}</div>`;
    document.getElementById('rc-pie').innerHTML = '<button type="button" class="rc-link" id="rc-cerrar2">Cerrar</button>';
    document.getElementById('rc-cerrar2').addEventListener('click', cerrar);
  }
  const subtotalSel = () => r2(E.items.reduce((s, i) => s + r2((E.sel[i.id] || 0) * Number(i.precio_unitario)), 0));
  const propinaDe = sub => E.propinaPct === 'otro' ? Math.max(0, r2(E.propinaOtro)) : r2(sub * Number(E.propinaPct) / 100);
  function pintarElegir() {
    const todo = E.modo === 'todo';
    const sub = subtotalSel(), prop = propinaDe(sub), total = r2(sub + prop);
    const quedan = E.items.filter(i => (E.sel[i.id] || 0) < Number(i.cantidad)).length;
    document.getElementById('rc-cuerpo').innerHTML = `
      <div class="rc-sec">¿Qué se cobra?</div>
      <div class="rc-chips"><button type="button" class="rc-chip ${todo ? 'activo' : ''}" data-modo="todo">🧾 Toda la cuenta</button>
        <button type="button" class="rc-chip ${todo ? '' : 'activo'}" data-modo="dividir">✂️ Dividir por platillos</button></div>
      ${todo ? '' : '<div class="rc-ayuda">Elige lo que paga esta persona. Lo demás queda pendiente en la mesa para el siguiente cobro.</div>'}
      <div style="margin-top:8px">${E.items.map(i => {
        const q = E.sel[i.id] || 0, max = Number(i.cantidad);
        return `<div class="rc-item"><div class="rc-item-n">${esc(i.nombre_producto)}<small>${esc(String(max))} × ${esc(f(i.precio_unitario))}${Number(i.ronda) > 1 ? ' · ' + esc(String(i.ronda)) + '.ª ronda' : ''}</small></div>
          ${todo ? `<span class="rc-paso"><span>${esc(String(max))}</span></span>` : `<span class="rc-paso"><button type="button" data-menos="${esc(i.id)}" aria-label="Menos">−</button><span>${esc(String(q))}/${esc(String(max))}</span><button type="button" data-mas="${esc(i.id)}" aria-label="Más">+</button></span>`}
          <span class="rc-monto">${esc(f(r2(q * Number(i.precio_unitario))))}</span></div>`;
      }).join('')}</div>
      <div class="rc-sec">Propina (va aparte de la venta, para el personal)</div>
      <div class="rc-chips">${[0, 5, 10, 15].map(p => `<button type="button" class="rc-chip ${E.propinaPct === p ? 'activo' : ''}" data-prop="${p}">${p ? p + ' %' : 'Sin propina'}</button>`).join('')}
        <button type="button" class="rc-chip ${E.propinaPct === 'otro' ? 'activo' : ''}" data-prop="otro">Otro monto</button></div>
      ${E.propinaPct === 'otro' ? `<input class="rc-in" id="rc-prop-otro" type="number" inputmode="decimal" min="0" step="any" placeholder="Monto de la propina" value="${esc(E.propinaOtro)}" style="margin-top:8px"/>` : ''}
      <div class="rc-sec">Cliente</div>
      <div id="rc-cli">${E.clienteId ? `<div class="rc-chips"><span class="rc-chip activo">👤 ${esc(E.clienteNombre)}</span><button type="button" class="rc-link" id="rc-cli-quitar">Quitar</button></div>`
        : `<input class="rc-in" id="rc-cli-buscar" placeholder="Consumidor final (o busca un cliente para la factura)" autocomplete="off"/><div class="rc-res" id="rc-cli-res" style="display:none"></div>`}</div>
      <div class="rc-tot">
        <div><span>Consumo</span><span>${esc(f(sub))}</span></div>
        <div><span>Propina</span><span>${esc(f(prop))}</span></div>
        <div class="rc-grande"><span>Total</span><span>${esc(f(total))}</span></div>
        <div class="rc-ayuda">Si tu negocio cobra IVA, se agrega al consumo en el siguiente paso, igual que en Ventas.</div>
      </div>
      <div class="rc-sec">Dividir en partes iguales (referencia)</div>
      <div class="rc-fila" style="align-items:center"><div><input class="rc-in" id="rc-personas" type="number" min="1" max="50" value="${esc(String(E.personas))}" aria-label="Personas"/></div>
        <div class="rc-ayuda" style="margin:0">${E.personas > 1 ? `${esc(f(r2(total / E.personas)))} por persona. Para cobrarle a cada uno por separado usa "Dividir por platillos" o "Pago separado" en el siguiente paso.` : 'Personas en la mesa'}</div></div>
      ${!todo && quedan ? `<div class="rc-aviso">Quedarán platillos pendientes: la mesa sigue abierta hasta que se cobre todo.</div>` : ''}
      <div class="rc-err" id="rc-err" role="alert"></div>`;
    document.getElementById('rc-pie').innerHTML = `<button type="button" class="rc-btn" id="rc-seguir" ${sub > 0 ? '' : 'disabled'}>Continuar al pago · ${esc(f(total))}</button>`;
    const c = document.getElementById('rc-cuerpo');
    c.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => {
      E.modo = b.dataset.modo;
      E.items.forEach(i => { E.sel[i.id] = E.modo === 'todo' ? Number(i.cantidad) : 0; });
      pintarElegir();
    }));
    c.querySelectorAll('[data-mas]').forEach(b => b.addEventListener('click', () => { const i = E.items.find(x => x.id === b.dataset.mas); E.sel[i.id] = Math.min(Number(i.cantidad), (E.sel[i.id] || 0) + 1); pintarElegir(); }));
    c.querySelectorAll('[data-menos]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.menos; E.sel[id] = Math.max(0, (E.sel[id] || 0) - 1); pintarElegir(); }));
    c.querySelectorAll('[data-prop]').forEach(b => b.addEventListener('click', () => { E.propinaPct = b.dataset.prop === 'otro' ? 'otro' : Number(b.dataset.prop); pintarElegir(); }));
    const po = document.getElementById('rc-prop-otro');
    if (po) { po.addEventListener('change', () => { E.propinaOtro = po.value; pintarElegir(); }); }
    document.getElementById('rc-personas').addEventListener('change', ev => { E.personas = Math.min(50, Math.max(1, parseInt(ev.target.value, 10) || 1)); pintarElegir(); });
    const q = document.getElementById('rc-cli-quitar'); if (q) q.addEventListener('click', () => { E.clienteId = null; E.clienteNombre = ''; pintarElegir(); });
    const bc = document.getElementById('rc-cli-buscar'); if (bc) bc.addEventListener('input', () => buscarCliente(bc.value));
    document.getElementById('rc-seguir').addEventListener('click', continuar);
  }
  let _tCli = null;
  function buscarCliente(txt) {
    clearTimeout(_tCli);
    const res = document.getElementById('rc-cli-res'); const q = String(txt || '').replace(/[,()%*\\]/g, ' ').trim();
    if (q.length < 2) { res.style.display = 'none'; return; }
    _tCli = setTimeout(async () => {
      try {
        const { data } = await sb.from('clientes').select('id, nombre, apellido, telefono').eq('auth_user_id', STATE.userId)
          .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%`).order('nombre').limit(8);
        res.innerHTML = (data || []).length ? data.map(c => `<div data-id="${esc(c.id)}" data-n="${esc([c.nombre, c.apellido].filter(Boolean).join(' '))}">👤 ${esc([c.nombre, c.apellido].filter(Boolean).join(' '))}${c.telefono ? ' · ' + esc(c.telefono) : ''}</div>`).join('')
          : '<div style="cursor:default;color:var(--text-muted)">Sin resultados. Se cobra como consumidor final.</div>';
        res.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => { E.clienteId = el.dataset.id; E.clienteNombre = el.dataset.n; pintarElegir(); }));
        res.style.display = '';
      } catch (e) { console.warn('buscar cliente:', e); }
    }, 220);
  }

  /* ---------- 2) Reservar en el servidor y preparar la venta ---------- */
  async function continuar(ev, reintento) {
    const err = document.getElementById('rc-err'); err.textContent = '';
    const btn = document.getElementById('rc-seguir'); btn.disabled = true; btn.textContent = 'Preparando…';
    const pedido = E.modo === 'todo' ? null : E.items.filter(i => (E.sel[i.id] || 0) > 0).map(i => ({ item_id: i.id, cantidad: E.sel[i.id] }));
    let quien = ''; try { quien = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null')?.nombre || STATE.currentUser?.nombre || ''; } catch (_) {}
    let r;
    try { const x = await sb.rpc('restaurante_cobro_reservar', { p_comanda_id: E.comanda.id, p_items: pedido, p_quien: quien || null }); if (x.error) throw x.error; r = x.data; }
    catch (e) { console.error('reservar cobro:', e); r = { ok: false, motivo: 'red' }; }
    if (!r || !r.ok) {
      btn.disabled = false; btn.textContent = 'Continuar al pago';
      if (r?.motivo === 'en_cobro' && !reintento) {
        err.innerHTML = `${esc(MOTIVOS.en_cobro)} <button type="button" class="rc-link" id="rc-soltar">Nadie más está cobrando: soltar y continuar</button>`;
        document.getElementById('rc-soltar').addEventListener('click', async () => {
          if (!confirm('¿Seguro que nadie más está cobrando esta mesa en otro equipo?\n\nSi alguien la está cobrando, su cobro no se registrará.')) return;
          try { await sb.rpc('restaurante_cobro_liberar', { p_cobro_id: null, p_comanda_id: E.comanda.id }); } catch (_) {}
          continuar(null, true);
        });
        return;
      }
      err.textContent = (MOTIVOS[r?.motivo] || 'No se pudo preparar el cobro. Revisa tu conexión e intenta de nuevo.') + (r?.nombre ? ` (${r.nombre})` : '');
      return;
    }
    E.cobroId = r.cobro_id; E.lineas = r.lineas || []; E.subtotal = Number(r.subtotal) || 0; E.propina = propinaDe(E.subtotal);
    try { sessionStorage.setItem('n360_rest_cobro', JSON.stringify({ cobroId: E.cobroId, lineas: E.lineas, clienteId: E.clienteId })); } catch (_) {}
    document.getElementById('rc-cuerpo').innerHTML = '<div class="rc-cargando">Preparando la venta…</div>'; document.getElementById('rc-pie').innerHTML = '';
    cargarMotor();
  }
  function cargarMotor() {
    const fr = document.getElementById('rc-marco');
    clearInterval(E.vigia); let n = 0;
    E.vigia = setInterval(() => {
      n++;
      const m = motor();
      if (m) { let e = null; try { e = m.estado(); } catch (_) {} if (e && e.listo) { clearInterval(E.vigia); E.estado = e; pintarPago(); return; } }
      if (n > 600) { clearInterval(E.vigia); pintarError('No se pudo preparar la venta. Revisa tu conexión y vuelve a intentarlo.'); }
    }, 50);
    fr.src = 'ventas.html?rest_cobro=1&motor=1';
  }

  /* ---------- 3) Forma de pago y cobrar ---------- */
  const aPagar = () => r2((Number(E.estado?.resumen?.cobrar ?? E.estado?.resumen?.total) || 0) + (E.propina || 0));
  async function pintarPago() {
    const e = E.estado, r = e.resumen || {}, t = r.texto || {};
    document.getElementById('rc-cuerpo').innerHTML = `
      <div class="rc-ayuda" style="margin:0 0 6px">Cliente: <b>${esc(e.cliente || 'Consumidor final')}</b></div>
      ${e.items.map(i => `<div class="rc-item"><div class="rc-item-n">${esc(i.nombre)}<small>${esc(String(i.cantidad))} × ${esc(i.precioTexto)}</small></div><span class="rc-monto">${esc(i.texto)}</span></div>`).join('')}
      <div class="rc-tot">
        <div><span>Consumo</span><span>${esc(t.subtotal)}</span></div>
        ${Number(r.descuento) > 0 ? `<div><span>Descuento</span><span>-${esc(t.descuento)}</span></div>` : ''}
        ${Number(r.impuestos) > 0 ? `<div><span>${esc(e.impuestosTexto)}</span><span>${esc(t.impuestos)}</span></div>` : ''}
        ${Math.round((Number(r.cobrar ?? r.total) || 0) * 100) !== Math.round((Number(r.subtotal) || 0) * 100) ? `<div><span>Venta</span><span>${esc(t.cobrar || t.total)}</span></div>` : ''}
        ${E.propina > 0 ? `<div><span>Propina (aparte)</span><span>${esc(f(E.propina))}</span></div>` : ''}
        <div class="rc-grande"><span>Total a pagar</span><span>${esc(f(aPagar()))}</span></div>
      </div>
      <div class="rc-sec">Forma de pago</div>
      <div class="rc-chips" id="rc-metodos">${e.metodos.map(mt => `<button type="button" class="rc-chip" data-metodo="${esc(mt.id)}" data-nombre="${esc(mt.nombre)}">${esc(mt.nombre)}</button>`).join('')
        + (e.fiado ? '<button type="button" class="rc-chip" data-metodo="__fiado" data-nombre="Fiado">📒 Fiado</button>' : '') || '<span class="rc-ayuda">No hay formas de pago activas: configúralas en Caja.</span>'}</div>
      <div id="rc-bancos-wrap" style="display:none"><div class="rc-sec">¿A qué banco entra?</div><div class="rc-chips" id="rc-bancos"></div></div>
      <div id="rc-efectivo" class="rc-fila" style="display:none;margin-top:10px">
        <div><label class="rc-lab" for="rc-recibido">Recibido</label><input class="rc-in" id="rc-recibido" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00"/></div>
        <div><span class="rc-lab">Cambio</span><div class="rc-cambio" id="rc-cambio">—</div></div></div>
      <div class="rc-err" id="rc-err" role="alert"></div>`;
    document.getElementById('rc-pie').innerHTML = `<button type="button" class="rc-btn" id="rc-cobrar" disabled>Cobrar ${esc(f(aPagar()))}</button>
      <button type="button" class="rc-link" id="rc-avanzado">Otras opciones (pago separado por método, puntos, certificados…) →</button>
      <button type="button" class="rc-link" id="rc-volver">← Cambiar lo que se cobra</button>`;
    document.querySelectorAll('#rc-metodos [data-metodo]').forEach(b => b.addEventListener('click', () => elegirMetodo(b.dataset.metodo, b.dataset.nombre)));
    document.getElementById('rc-recibido').addEventListener('input', cambio);
    document.getElementById('rc-cobrar').addEventListener('click', cobrar);
    document.getElementById('rc-avanzado').addEventListener('click', avanzado);
    document.getElementById('rc-volver').addEventListener('click', volver);
    try { E.bancos = await motor().bancos(); } catch (_) { E.bancos = []; }
    if (e.metodos.length === 1 && !e.fiado) elegirMetodo(e.metodos[0].id, e.metodos[0].nombre);
  }
  const necesitaBanco = nombre => /tarjeta|transferencia/i.test(nombre || '') && E.bancos.length > 0;
  function elegirMetodo(id, nombre) {
    if (E.cobrando) return;
    E.metodo = { id, nombre }; E.banco = null;
    document.querySelectorAll('#rc-metodos [data-metodo]').forEach(b => b.classList.toggle('activo', b.dataset.metodo === id));
    const conBanco = id !== '__fiado' && necesitaBanco(nombre);
    document.getElementById('rc-bancos-wrap').style.display = conBanco ? '' : 'none';
    if (conBanco) {
      document.getElementById('rc-bancos').innerHTML = E.bancos.map(b => `<button type="button" class="rc-chip" data-banco="${esc(b.id)}">🏦 ${esc(b.nombre)}</button>`).join('');
      document.querySelectorAll('#rc-bancos [data-banco]').forEach(b => b.addEventListener('click', () => {
        E.banco = E.bancos.find(x => x.id === b.dataset.banco) || null;
        document.querySelectorAll('#rc-bancos [data-banco]').forEach(x => x.classList.toggle('activo', x === b)); listo();
      }));
    }
    document.getElementById('rc-efectivo').style.display = /efectivo/i.test(nombre) ? 'flex' : 'none';
    const err = document.getElementById('rc-err');
    err.textContent = id === '__fiado' && E.propina > 0 ? 'Con fiado la propina no se cobra ahora: se registrará solo la venta.' : '';
    listo(); cambio();
  }
  function listo() {
    const b = document.getElementById('rc-cobrar'); if (!b) return;
    b.disabled = !E.metodo || (E.metodo.id !== '__fiado' && necesitaBanco(E.metodo.nombre) && !E.banco) || E.cobrando;
    b.textContent = 'Cobrar ' + f(E.metodo?.id === '__fiado' ? aPagar() - (E.propina || 0) : aPagar());
  }
  function cambio() {
    const el = document.getElementById('rc-cambio'); if (!el) return;
    const rec = Number(document.getElementById('rc-recibido').value);
    if (!(rec > 0)) { el.textContent = '—'; el.style.color = ''; return; }
    const d = r2(rec - aPagar());
    el.textContent = d >= 0 ? f(d) : 'Faltan ' + f(-d);
    el.style.color = d >= 0 ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)';
  }
  async function cobrar() {
    if (E.cobrando || E.ventaId) return;
    const m = E.metodo, mot = motor(); if (!m || !mot) return;
    const rec = Number(document.getElementById('rc-recibido')?.value);
    if (/efectivo/i.test(m.nombre) && rec > 0 && rec + 0.004 < aPagar()) { document.getElementById('rc-err').textContent = 'Lo recibido es menos que el total a pagar.'; return; }
    E.cobrando = true; listo();
    const btn = document.getElementById('rc-cobrar'); btn.textContent = 'Cobrando…';
    document.getElementById('rc-err').textContent = '';
    const mesa = E.comanda.restaurante_mesas?.numero || '';
    let r;
    try { r = await mot.cobrar({ metodoId: m.id === '__fiado' ? null : m.id, metodoNombre: m.nombre, fiado: m.id === '__fiado', banco: E.banco, notas: `Restaurante · Mesa ${mesa}` }); }
    catch (e) { r = { ok: false, motivo: 'No se pudo registrar la venta. Intenta de nuevo.' }; }
    E.cobrando = false;
    if (r && r.ok) { if (!E.ventaId) await hecho(r, false); return; }
    listo();
    document.getElementById('rc-err').textContent = (r && r.motivo) || 'No se registró la venta.';
  }
  function avanzado() {
    if (E.ventaId) return;
    document.getElementById('rc-cobro').classList.add('rc-avanzado');
    try { motor()?.irAPago(); } catch (_) {}
    document.getElementById('rc-pie').innerHTML = `<div class="rc-ayuda" style="text-align:center">Completa la venta aquí arriba. ${E.propina > 0 ? 'La propina se registra al terminar.' : ''}</div>`;
  }
  async function volver() {
    if (E.cobrando || E.ventaId) return;
    await soltar();
    document.getElementById('rc-marco').src = 'about:blank';
    abrirDeNuevo();
  }
  async function abrirDeNuevo() {
    const c = E.comanda, fin = E.alCerrar;
    E.abierto = false; await abrir(c, { alCerrar: fin });
  }
  async function soltar() {
    if (E.cobroId && !E.ventaId) { try { await sb.rpc('restaurante_cobro_liberar', { p_cobro_id: E.cobroId, p_comanda_id: null }); } catch (_) {} }
    E.cobroId = null;
    try { sessionStorage.removeItem('n360_rest_cobro'); } catch (_) {}
  }

  /* ---------- 4) Cobrado: ligar, propina aparte, ticket ---------- */
  async function hecho(r, desdeAvanzado) {
    E.ventaId = r.ventaId; E.venta = r;
    document.getElementById('rc-cobro').classList.remove('rc-avanzado');
    // Respaldo: Ventas ya lo liga al confirmar; si no alcanzó, se liga aquí (el servidor no duplica nada).
    try { const { data: c } = await sb.rpc('restaurante_cobro_confirmar', { p_cobro_id: E.cobroId, p_venta_id: r.ventaId }); E.cerrada = !!c?.cerrada; if (c && !c.ok) console.warn('confirmar cobro:', c); }
    catch (e) { console.warn('confirmar cobro:', e); }
    const metodoPropina = desdeAvanzado ? null : (E.metodo?.id === '__fiado' ? 'sin' : E.metodo);
    if (E.propina > 0 && metodoPropina && metodoPropina !== 'sin') await registrarPropina(metodoPropina, E.banco);
    pintarHecho(desdeAvanzado && E.propina > 0 && !E.propinaHecha);
  }
  async function registrarPropina(metodo, banco) {
    if (E.propinaHecha || !(E.propina > 0)) return true;
    const mesa = E.comanda.restaurante_mesas?.numero || '';
    try {
      const { data: a, error: eA } = await sb.rpc('restaurante_cobro_propina', { p_cobro_id: E.cobroId, p_monto: E.propina, p_metodo: metodo.nombre });
      if (eA || !a?.ok) { if (a?.motivo === 'ya_tiene_propina') { E.propinaHecha = true; return true; } throw eA || new Error(a?.motivo || 'propina'); }
      const caja = window.CajaAPI ? await window.CajaAPI.registrarMovimiento({ auth_user_id: STATE.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'OTRO_INGRESO',
        concepto: `Propina — Mesa ${mesa} (para el personal)`, monto: E.propina, metodo_pago_id: metodo.id || null, metodo_pago_nombre: metodo.nombre,
        banco_id: banco?.id || null, referencia_tipo: 'restaurante_propina', referencia_id: E.cobroId }) : { ok: false, error: 'Caja no disponible' };
      if (!caja || !caja.ok) { try { await sb.rpc('restaurante_cobro_propina', { p_cobro_id: E.cobroId, p_monto: 0 }); } catch (_) {} throw new Error(caja?.error || 'caja'); }
      E.propinaHecha = true; return true;
    } catch (e) { console.error('propina:', e); E.propinaError = true; return false; }
  }
  function pintarHecho(pedirMetodoPropina) {
    const r = E.venta, total = Number(r.total) || 0;
    const rec = Number(document.getElementById('rc-recibido')?.value);
    const dif = /efectivo/i.test(E.metodo?.nombre || '') && rec > 0 ? r2(rec - total - (E.propinaHecha ? E.propina : 0)) : 0;
    document.getElementById('rc-cuerpo').innerHTML = `<div class="rc-ok"><div class="rc-ok-ico">✅</div><div class="rc-ok-tit">Cobrado ${esc(f(total))}</div>
      <div class="rc-ayuda">Venta ${esc(r.numero || '')}${E.metodo?.nombre ? ' · ' + esc(E.metodo.nombre) : ''}</div>
      ${E.propinaHecha ? `<div style="margin-top:8px;font-weight:700">+ Propina ${esc(f(E.propina))} <span class="rc-ayuda">(en Caja, aparte de la venta)</span></div>` : ''}
      ${dif > 0 ? `<div style="margin-top:12px;font-size:20px;font-weight:900">Cambio: ${esc(f(dif))}</div>` : ''}
      ${E.propinaError ? `<div class="rc-aviso">La propina de ${esc(f(E.propina))} no se pudo registrar en Caja. <button type="button" class="rc-link" id="rc-prop-reintentar">Reintentar</button></div>` : ''}
      ${pedirMetodoPropina ? `<div class="rc-aviso">¿Cómo pagaron la propina de ${esc(f(E.propina))}?<div class="rc-chips" style="margin-top:8px;justify-content:center">${(E.estado?.metodos || []).map(mt => `<button type="button" class="rc-chip" data-pm="${esc(mt.id)}" data-pn="${esc(mt.nombre)}">${esc(mt.nombre)}</button>`).join('')}<button type="button" class="rc-chip" data-pm="__no">No dejaron</button></div></div>` : ''}
      <div class="rc-ayuda" style="margin-top:12px">Quedó registrada en Ventas y en Caja, como cualquier venta.</div>
      <div style="margin-top:8px;font-weight:700">${E.cerrada ? '🧹 Mesa cerrada: pasó a limpieza.' : '🍽️ Aún quedan platillos por cobrar en esta mesa.'}</div>
      <div class="rc-chips" style="margin-top:14px;justify-content:center"><button type="button" class="rc-chip" id="rc-ticket">🧾 Imprimir ticket</button><button type="button" class="rc-chip" id="rc-pdf">📄 Recibo PDF</button></div></div>`;
    document.getElementById('rc-pie').innerHTML = (E.cerrada ? '' : '<button type="button" class="rc-btn" id="rc-resto">Cobrar lo que falta</button>')
      + `<button type="button" class="${E.cerrada ? 'rc-btn' : 'rc-link'}" id="rc-listo">✓ Listo</button>`;
    document.getElementById('rc-listo').addEventListener('click', cerrar);
    const resto = document.getElementById('rc-resto'); if (resto) resto.addEventListener('click', () => { const c = E.comanda, fin = E.alCerrar; terminar(true); abrir(c, { alCerrar: fin }); });
    document.getElementById('rc-ticket').addEventListener('click', () => {
      let w = null; try { w = window.open('', '_blank', 'width=380,height=600'); } catch (_) {}
      Promise.resolve(motor()?.imprimirTicket(r.ventaId, w)).catch(() => { try { w && w.close(); } catch (_) {} showToast('No se pudo imprimir el ticket.', 'error'); });
    });
    document.getElementById('rc-pdf').addEventListener('click', () => { Promise.resolve(motor()?.descargarRecibo(r.ventaId)).catch(() => {}); });
    const re = document.getElementById('rc-prop-reintentar');
    if (re) re.addEventListener('click', async () => { E.propinaError = false; await registrarPropina(E.metodo, E.banco); pintarHecho(false); });
    document.querySelectorAll('[data-pm]').forEach(b => b.addEventListener('click', async () => {
      if (b.dataset.pm !== '__no') { E.metodo = E.metodo || { id: b.dataset.pm, nombre: b.dataset.pn }; await registrarPropina({ id: b.dataset.pm, nombre: b.dataset.pn }, null); }
      else E.propina = 0;
      pintarHecho(false);
    }));
  }

  function terminar(cobrado) {
    clearInterval(E.vigia);
    const m = document.getElementById('rc-cobro'); m.style.display = 'none'; m.classList.remove('rc-avanzado');
    document.getElementById('rc-marco').src = 'about:blank';
    try { sessionStorage.removeItem('n360_rest_cobro'); } catch (_) {}
    const fin = E.alCerrar; E.abierto = false; E.alCerrar = null;
    if (typeof fin === 'function') { try { fin(cobrado); } catch (_) {} }
  }
  async function cerrar() {
    if (E.cobrando) return;                                   // no se cierra a media venta
    const cobrado = !!E.ventaId;
    if (!cobrado) { await soltar(); showToast('No se cobró nada.'); }
    terminar(cobrado);
  }
  return { abrir, cerrar, _estado: () => E };
})();
