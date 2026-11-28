/* =====================================================
   AGUA-COBRO.JS — NEGOCIO360 · Cobrar mensualidades (Panel Agua)
   Paso 1: qué meses/cargos se pagan y cuánto (abono parcial o meses por adelantado).
   Paso 2: forma de pago. La venta se registra con el MISMO motor de Ventas
   (ventas.html?agua_cobro=1&motor=1, oculto): Ventas, Caja, bancos, IVA, ticket y
   reportes quedan igual que una venta normal.
   Candados (en el servidor): agua_preparar_cobro reparte el pago (lo más viejo primero,
   sin pasarse de lo que se debe); Ventas revisa que el cobro siga pendiente y que el total
   cuadre; agua_confirmar_cobro aplica el pago a los meses (repetible sin duplicar).
   Si después se anula la venta en Ventas, el pago se revierte solo.
===================================================== */
const AWCobro = (() => {
  const E = { abierto: false };
  const sb = () => window.__awSB;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const motor = () => { try { return document.getElementById('awc-marco')?.contentWindow?.N360MotorVenta || null; } catch (_) { return null; } };
  const f = n => (window.awFmt ? window.awFmt(n) : r2(n).toFixed(2));
  const NOMBRE_SERVICIO = 'Servicio de agua';
  const uid = () => window.__awUid;
  const usuario = () => window.__awUsuario || null;

  function estilos() {
    if (document.getElementById('awc-estilos')) return;
    const st = document.createElement('style'); st.id = 'awc-estilos';
    st.textContent = `
#awc-cobro{position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:12px}
#awc-cobro .awc-caja{background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#111827);width:100%;max-width:560px;max-height:94vh;border-radius:16px;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}
#awc-cobro .awc-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border,#e5e7eb)}
#awc-cobro .awc-tit{font-weight:800;font-size:16px;min-width:0;overflow-wrap:anywhere}
#awc-cobro .awc-x{border:none;background:none;font-size:22px;cursor:pointer;color:var(--text-muted,#6b7280);line-height:1;padding:4px 8px}
#awc-cobro .awc-cuerpo{padding:14px 16px;overflow-y:auto;flex:1;min-height:0}
#awc-cobro .awc-pie{padding:12px 16px;border-top:1px solid var(--border,#e5e7eb);display:flex;flex-direction:column;gap:8px}
#awc-cobro .awc-sec{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted,#6b7280);margin:14px 0 6px}
#awc-cobro .awc-chips{display:flex;flex-wrap:wrap;gap:6px}
#awc-cobro .awc-chip{border:1.5px solid var(--border,#e5e7eb);background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#111827);border-radius:999px;padding:8px 13px;font-size:13.5px;font-weight:600;cursor:pointer;min-height:38px}
#awc-cobro .awc-chip.activo{border-color:var(--accent,#4f46e5);background:var(--accent-soft,#eef2ff);color:var(--accent,#4f46e5)}
#awc-cobro .awc-linea{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--border,#e5e7eb);font-size:13.5px}
#awc-cobro .awc-linea span{min-width:0;overflow-wrap:anywhere}
#awc-cobro .awc-linea b{flex:none;white-space:nowrap}
#awc-cobro .awc-linea small{display:block;color:var(--text-muted,#6b7280);font-size:12px}
#awc-cobro .awc-tot{margin-top:10px;font-size:14px}
#awc-cobro .awc-tot div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
#awc-cobro .awc-grande{font-size:20px;font-weight:900}
#awc-cobro .awc-ayuda{font-size:12.5px;color:var(--text-muted,#6b7280)}
#awc-cobro .awc-info{font-size:12.5px;background:var(--accent-soft,#eef2ff);color:var(--text-primary,#111827);border-radius:10px;padding:9px 11px;margin-top:10px}
#awc-cobro .awc-ret{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;font-size:13px}
#awc-cobro .awc-ret input[type=checkbox]{width:18px;height:18px;flex:none;margin:0;accent-color:var(--accent,#4f46e5)}
#awc-cobro .awc-ret input[type=number]{width:80px;flex:none}
#awc-cobro .awc-in{box-sizing:border-box;border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:9px 11px;font-size:15px;background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#111827)}
#awc-cobro .awc-fila{display:flex;gap:10px;margin-top:10px}
#awc-cobro .awc-fila>div{flex:1;min-width:0}
#awc-cobro .awc-fila .awc-in{width:100%}
#awc-cobro .awc-lab{display:block;font-size:12px;font-weight:700;color:var(--text-muted,#6b7280);margin-bottom:4px}
#awc-cobro .awc-cambio{font-size:18px;font-weight:900;padding:8px 0}
#awc-cobro .awc-err{color:var(--danger,#dc2626);font-size:13px;min-height:1em;margin-top:8px}
#awc-cobro .awc-btn{width:100%;border:none;border-radius:12px;padding:13px;font-size:16px;font-weight:800;cursor:pointer;background:var(--accent,#4f46e5);color:#fff}
#awc-cobro .awc-btn:disabled{opacity:.55;cursor:not-allowed}
#awc-cobro .awc-link{border:none;background:none;color:var(--accent,#4f46e5);font-weight:700;font-size:13px;cursor:pointer;padding:6px}
#awc-cobro .awc-cargando{padding:30px 10px;text-align:center;color:var(--text-muted,#6b7280)}
#awc-cobro .awc-ok{text-align:center;padding:10px 0}
#awc-cobro .awc-ok-ico{font-size:44px}
#awc-cobro .awc-ok-tit{font-size:20px;font-weight:900;margin-top:6px}
#awc-cobro .awc-sep{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,.9fr) auto;gap:6px;align-items:center;margin-top:6px}
#awc-cobro .awc-sep select,#awc-cobro .awc-sep input{width:100%;min-width:0;font-size:14px;padding:8px}
#awc-cobro .awc-sep-x{border:1px solid var(--border,#e5e7eb);background:none;border-radius:8px;width:34px;height:34px;cursor:pointer;color:var(--danger,#dc2626)}
#awc-cobro .awc-sep-suma{margin-top:8px;padding:8px 10px;border-radius:9px;font-size:13px;font-weight:700;background:#fef3c7;color:#b45309}
#awc-cobro .awc-sep-suma.ok{background:var(--success-soft,#dcfce7);color:var(--success,#16a34a)}
@media (max-width:480px){#awc-cobro .awc-sep{grid-template-columns:1fr 1fr}}
#awc-marco{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;top:0}
#awc-cobro.awc-avanzado .awc-caja{max-width:980px;height:94vh}
#awc-cobro.awc-avanzado .awc-cuerpo{display:none}
#awc-cobro.awc-avanzado #awc-marco{position:static;width:100%;flex:1;height:auto;opacity:1;pointer-events:auto;left:auto}
@media (max-width:420px){#awc-cobro{padding:6px}#awc-cobro .awc-fila{flex-direction:column}}
#awc-cobro .awc-cargo{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px dashed var(--border,#e5e7eb);font-size:13.5px;cursor:pointer}
#awc-cobro .awc-cargo input{width:18px;height:18px;margin:0;accent-color:var(--accent,#4f46e5)}
#awc-cobro .awc-cargo small{display:block;color:var(--text-muted,#6b7280);font-size:12px}`;
    document.head.appendChild(st);
  }
  function modal() {
    estilos();
    let m = document.getElementById('awc-cobro');
    if (m) return m;
    m = document.createElement('div'); m.id = 'awc-cobro'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'awc-tit');
    m.innerHTML = `<div class="awc-caja"><div class="awc-cab"><div class="awc-tit" id="awc-tit">Cobrar</div><button type="button" class="awc-x" id="awc-x" aria-label="Cerrar">✕</button></div>
      <div class="awc-cuerpo" id="awc-cuerpo"></div><iframe id="awc-marco" title="Venta del cobro" src="about:blank"></iframe><div class="awc-pie" id="awc-pie"></div></div>`;
    document.body.appendChild(m);
    m.querySelector('#awc-x').addEventListener('click', cerrar);
    window.addEventListener('message', async ev => {
      const fr = document.getElementById('awc-marco');
      if (!E.abierto || !fr || ev.source !== fr.contentWindow || ev.origin !== location.origin) return;
      if (!ev.data || ev.data.tipo !== 'n360_operacion_completada' || !ev.data.ventaId || E.ventaId) return;
      await hecho({ ventaId: ev.data.ventaId, numero: String(ev.data.nota || '').replace(/^Venta\s*/, ''), total: ev.data.monto }, true);
    });
    return m;
  }
  async function servicioAgua() {
    const { data: ex } = await sb().from('productos').select('id,activo').eq('auth_user_id', uid()).eq('nombre', NOMBRE_SERVICIO).eq('tipo', 'servicio').limit(1);
    if (ex && ex.length) { if (ex[0].activo === false) await sb().from('productos').update({ activo: true }).eq('id', ex[0].id).eq('auth_user_id', uid()); return ex[0].id; }
    const { data, error } = await sb().from('productos').insert({ auth_user_id: uid(), tipo: 'servicio', nombre: NOMBRE_SERVICIO, precio: 0, costo: 0, stock_actual: 0, activo: true, categoria: 'Agua' }).select('id').single();
    if (error) throw error;
    return data.id;
  }

  /* ---------- Paso 1: qué se paga ---------- */
  async function abrir(abonadoId, { alCerrar } = {}) {
    if (E.abierto) return true;
    const m = modal();
    Object.assign(E, { abierto: true, abonadoId, ab: null, cargos: [], sel: new Set(), adelanto: 0, alCerrar: alCerrar || null, ventaId: null, cobro: null,
      metodo: null, banco: null, bancos: [], estado: null, cobrando: false, sep: null });
    m.classList.remove('awc-avanzado');
    document.getElementById('awc-tit').textContent = '💧 Cobrar';
    document.getElementById('awc-cuerpo').innerHTML = '<div class="awc-cargando">Buscando lo que debe…</div>';
    document.getElementById('awc-pie').innerHTML = '';
    m.style.display = 'flex';
    try {
      const { data: ab, error } = await sb().from('agua_abonados').select('*').eq('id', abonadoId).eq('auth_user_id', uid()).maybeSingle();
      if (error) throw error;
      if (!ab) return pintarError('Ese abonado ya no existe.');
      if (!ab.cliente_id) return pintarError('Este abonado no tiene cliente ligado. Edítalo y guárdalo de nuevo.');
      const { data: cs, error: e2 } = await sb().from('agua_cargos').select('*').eq('abonado_id', abonadoId).eq('auth_user_id', uid()).in('estado', ['pendiente', 'parcial']).order('vence', { ascending: true });
      if (e2) throw e2;
      E.ab = ab; E.cargos = cs || [];
      const hoy = window.awHoy ? window.awHoy() : new Date().toISOString().slice(0, 10);
      E.cargos.forEach(c => { if (c.vence <= hoy || c.tipo !== 'mensualidad') E.sel.add(c.id); });
      if (!E.sel.size && E.cargos.length) E.sel.add(E.cargos[0].id);
      document.getElementById('awc-tit').textContent = `💧 Cobrar a ${ab.codigo}`;
      pintarPaso1();
    } catch (e) { console.error('cobro agua:', e); pintarError('No se pudo cargar lo que debe. Revisa tu conexión.'); }
    return true;
  }
  const debe = c => r2(Number(c.monto) - Number(c.pagado));
  const totalSel = () => r2(E.cargos.filter(c => E.sel.has(c.id)).reduce((a, c) => a + debe(c), 0) + E.adelanto * r2(Number(E.ab?.cuota || 0) * (E.ab?.cobra_iva ? 1 + (Number(window.__awCfg?.iva_pct) || 15) / 100 : 1)));
  function pintarPaso1() {
    const ab = E.ab;
    document.getElementById('awc-cuerpo').innerHTML = `
      <div class="awc-ayuda"><b>${esc(ab.nombre)} ${esc(ab.apellido || '')}</b> · ${esc(ab.direccion || '')}</div>
      ${Number(ab.saldo_favor) > 0 ? `<div class="awc-info">💚 Tiene <b>${esc(f(ab.saldo_favor))}</b> a favor: se aplica solo a sus próximas mensualidades.</div>` : ''}
      <div class="awc-sec">¿Qué paga?</div>
      ${E.cargos.length ? E.cargos.map(c => `<label class="awc-cargo"><input type="checkbox" data-cargo="${esc(c.id)}" ${E.sel.has(c.id) ? 'checked' : ''}>
          <span>${esc(c.concepto)}<small>Vence ${esc(window.awFecha ? window.awFecha(c.vence) : c.vence)}${Number(c.pagado) > 0 ? ' · ya abonó ' + esc(f(c.pagado)) : ''}${c.arreglo_id ? ' · en arreglo' : ''}</small></span>
          <b>${esc(f(debe(c)))}</b></label>`).join('') : '<div class="awc-ayuda">No debe nada. Puedes cobrar meses por adelantado.</div>'}
      <div class="awc-fila">
        <div><label class="awc-lab" for="awc-adelanto">Meses por adelantado</label><input class="awc-in" id="awc-adelanto" type="number" min="0" max="24" step="1" value="${E.adelanto}"></div>
        <div><label class="awc-lab" for="awc-monto">Monto a cobrar</label><input class="awc-in" id="awc-monto" type="number" inputmode="decimal" min="0" step="0.01" value="${totalSel().toFixed(2)}"></div>
      </div>
      <div class="awc-ayuda" id="awc-nota-monto" style="margin-top:6px">Si paga menos, queda como <b>abono</b> y el resto sigue pendiente.</div>
      <div class="awc-err" id="awc-err" role="alert"></div>`;
    document.getElementById('awc-pie').innerHTML = `<button type="button" class="awc-btn" id="awc-seguir">Continuar</button>`;
    document.querySelectorAll('#awc-cuerpo [data-cargo]').forEach(ch => ch.addEventListener('change', () => {
      if (ch.checked) E.sel.add(ch.dataset.cargo); else E.sel.delete(ch.dataset.cargo);
      document.getElementById('awc-monto').value = totalSel().toFixed(2); validar1();
    }));
    document.getElementById('awc-adelanto').addEventListener('input', ev => {
      E.adelanto = Math.max(0, Math.min(24, parseInt(ev.target.value, 10) || 0));
      document.getElementById('awc-monto').value = totalSel().toFixed(2); validar1();
    });
    document.getElementById('awc-monto').addEventListener('input', validar1);
    document.getElementById('awc-seguir').addEventListener('click', preparar);
    validar1();
  }
  function validar1() {
    const monto = r2(document.getElementById('awc-monto')?.value), tope = totalSel();
    const err = document.getElementById('awc-err'), b = document.getElementById('awc-seguir');
    let msg = '';
    if (!E.sel.size && !E.adelanto) msg = 'Marca lo que paga o pon meses por adelantado.';
    else if (!(monto > 0)) msg = 'Escribe cuánto paga.';
    else if (monto > tope + 0.005) msg = `No puede pagar más de ${f(tope)} con lo marcado. Marca más meses o pon meses por adelantado.`;
    if (err) err.textContent = msg;
    if (b) { b.disabled = !!msg; b.textContent = msg ? 'Continuar' : `Continuar · cobrar ${f(monto)}`; }
    return !msg;
  }
  async function preparar() {
    if (!validar1() || E.preparando) return;
    E.preparando = true;
    const b = document.getElementById('awc-seguir'); b.disabled = true; b.textContent = 'Preparando…';
    try {
      const { data, error } = await sb().rpc('agua_preparar_cobro', { p_abonado_id: E.abonadoId, p_cargo_ids: [...E.sel], p_monto: r2(document.getElementById('awc-monto').value),
        p_meses_adelanto: E.adelanto, p_usuario: usuario() });
      if (error) throw error;
      E.cobro = data;
      const productoId = await servicioAgua();
      sessionStorage.setItem('n360_agua_cobro', JSON.stringify({ cobroId: data.cobro_id, clienteId: data.cliente_id, productoId, base: Number(data.base) || 0,
        ivaPct: Number(data.iva_pct) || 0, monto: Number(data.monto) || 0, concepto: data.concepto, observaciones: data.concepto, auto: true }));
      document.getElementById('awc-cuerpo').innerHTML = '<div class="awc-cargando">Preparando la venta…</div>';
      document.getElementById('awc-pie').innerHTML = '';
      cargarMotor();
    } catch (e) {
      console.error('preparar cobro agua:', e);
      document.getElementById('awc-err').textContent = (e && e.message) || 'No se pudo preparar el cobro.';
      b.disabled = false; b.textContent = 'Continuar';
    } finally { E.preparando = false; }
  }
  function cargarMotor() {
    const fr = document.getElementById('awc-marco');
    clearInterval(E.vigia); let n = 0;
    E.vigia = setInterval(() => {
      n++;
      const mt = motor();
      if (mt) { let e = null; try { e = mt.estado(); } catch (_) {} if (e && e.listo) { clearInterval(E.vigia); E.estado = e; pintarPago(); return; } }
      if (n > 600) { clearInterval(E.vigia); pintarError('No se pudo preparar la venta. Revisa tu conexión y vuelve a intentarlo.', true); }
    }, 50);
    fr.src = 'ventas.html?agua_cobro=1&motor=1';
  }
  function pintarError(msg, conAvanzado) {
    document.getElementById('awc-cuerpo').innerHTML = `<div class="awc-cargando" style="color:var(--danger,#dc2626)">${esc(msg)}</div>`;
    document.getElementById('awc-pie').innerHTML = (conAvanzado ? '<button type="button" class="awc-link" id="awc-avanzado">Abrir la venta completa aquí mismo →</button>' : '')
      + '<button type="button" class="awc-link" id="awc-cerrar2">Cerrar</button>';
    document.getElementById('awc-cerrar2').addEventListener('click', cerrar);
    const av = document.getElementById('awc-avanzado'); if (av) av.addEventListener('click', avanzado);
  }

  /* ---------- Paso 2: forma de pago y cobrar ---------- */
  const aPagar = () => r2(Number(E.estado?.resumen?.cobrar ?? E.estado?.resumen?.total) || 0);
  function totalesHtml() {
    const r = E.estado.resumen || {}, t = r.texto || {};
    return `<div><span>Subtotal</span><span>${esc(t.subtotal)}</span></div>
      ${Number(r.impuestos) > 0 ? `<div><span>${esc(E.estado.impuestosTexto)}</span><span>${esc(t.impuestos)}</span></div>` : ''}
      <div class="awc-grande"><span>Total a cobrar</span><span>${esc(t.cobrar)}</span></div>`;
  }
  async function pintarPago() {
    const e = E.estado;
    if (Math.abs(aPagar() - Number(E.cobro.monto)) > 0.05) {
      return pintarError(`El total de la venta (${f(aPagar())}) no cuadra con el cobro (${f(E.cobro.monto)}). Revisa el IVA en Ajustes y vuelve a intentar.`);
    }
    document.getElementById('awc-cuerpo').innerHTML = `
      <div class="awc-ayuda">Abonado <b>${esc(E.ab.codigo)}</b> · ${esc(E.ab.nombre)} ${esc(E.ab.apellido || '')}</div>
      ${e.items.map(i => `<div class="awc-linea"><span>${esc(i.nombre)}</span><b>${esc(i.texto)}</b></div>`).join('')}
      <div class="awc-tot" id="awc-tot">${totalesHtml()}</div>
      <div class="awc-sec">¿Cómo te paga?</div>
      <div class="awc-chips" id="awc-metodos">${e.metodos.map(mt => `<button type="button" class="awc-chip" data-metodo="${esc(mt.id)}" data-nombre="${esc(mt.nombre)}">${esc(mt.nombre)}</button>`).join('')
        + (e.separado && e.metodos.length > 1 ? '<button type="button" class="awc-chip" data-metodo="__separado" data-nombre="Pago separado">➗ Pago separado</button>' : '') || '<span class="awc-ayuda">No hay formas de pago activas: configúralas en Caja.</span>'}</div>
      <div id="awc-separado" style="display:none"></div>
      <div id="awc-bancos-wrap" style="display:none"><div class="awc-sec">¿A qué banco entra?</div><div class="awc-chips" id="awc-bancos"></div></div>
      <div id="awc-efectivo" class="awc-fila" style="display:none">
        <div><label class="awc-lab" for="awc-recibido">Recibido</label><input class="awc-in" id="awc-recibido" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00"/></div>
        <div><span class="awc-lab">Cambio</span><div class="awc-cambio" id="awc-cambio">—</div></div></div>
      <div class="awc-info">ℹ️ Se registra como una venta normal: queda en <b>Ventas</b> y en <b>Caja</b>, con su ticket. El pago se aplica a los meses del abonado.</div>
      <div class="awc-err" id="awc-err" role="alert"></div>`;
    document.getElementById('awc-pie').innerHTML = `<button type="button" class="awc-btn" id="awc-cobrar" disabled>Cobrar ${esc(f(aPagar()))}</button>`;
    document.querySelectorAll('#awc-metodos [data-metodo]').forEach(b => b.addEventListener('click', () => elegirMetodo(b.dataset.metodo, b.dataset.nombre)));
    document.getElementById('awc-recibido').addEventListener('input', cambio);
    document.getElementById('awc-cobrar').addEventListener('click', cobrar);
    try { E.bancos = await motor().bancos(); } catch (_) { E.bancos = []; }
    const ef = e.metodos.find(m => /efectivo/i.test(m.nombre));
    if (e.metodos.length === 1) elegirMetodo(e.metodos[0].id, e.metodos[0].nombre); else if (ef) elegirMetodo(ef.id, ef.nombre);
  }
  const necesitaBanco = nombre => /tarjeta|transferencia|dep[oó]sito|cheque/i.test(nombre || '') && E.bancos.length > 0;
  function elegirMetodo(id, nombre) {
    if (E.cobrando) return;
    E.metodo = { id, nombre }; E.banco = null;
    document.querySelectorAll('#awc-metodos [data-metodo]').forEach(b => b.classList.toggle('activo', b.dataset.metodo === id));
    pintarSeparado(id === '__separado');
    const conBanco = id !== '__separado' && necesitaBanco(nombre);
    document.getElementById('awc-bancos-wrap').style.display = conBanco ? '' : 'none';
    if (conBanco) {
      document.getElementById('awc-bancos').innerHTML = E.bancos.map(b => `<button type="button" class="awc-chip" data-banco="${esc(b.id)}">🏦 ${esc(b.nombre)}</button>`).join('');
      document.querySelectorAll('#awc-bancos [data-banco]').forEach(b => b.addEventListener('click', () => {
        E.banco = E.bancos.find(x => x.id === b.dataset.banco) || null;
        document.querySelectorAll('#awc-bancos [data-banco]').forEach(x => x.classList.toggle('activo', x === b)); listo();
      }));
    }
    document.getElementById('awc-efectivo').style.display = /efectivo/i.test(nombre) ? 'flex' : 'none';
    listo(); cambio();
  }
  function pintarSeparado(mostrar) {
    const cont = document.getElementById('awc-separado'); if (!cont) return;
    cont.style.display = mostrar ? '' : 'none';
    if (!mostrar) { E.sep = null; cont.innerHTML = ''; return; }
    const ms = E.estado.metodos;
    if (!E.sep) { const ef = ms.find(m => /efectivo/i.test(m.nombre)) || ms[0], ot = ms.find(m => m.id !== ef.id) || ms[0]; E.sep = [{ metodoId: ef.id, monto: 0, bancoId: '' }, { metodoId: ot.id, monto: 0, bancoId: '' }]; }
    const nom = id => (ms.find(m => m.id === id) || {}).nombre || '';
    cont.innerHTML = `<div class="awc-sec">Reparte el pago</div>${E.sep.map((l, i) => `<div class="awc-sep">
        <select class="awc-in" data-sep-met="${i}" aria-label="Forma de pago">${ms.map(m => `<option value="${esc(m.id)}" ${m.id === l.metodoId ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select>
        ${necesitaBanco(nom(l.metodoId)) ? `<select class="awc-in" data-sep-banco="${i}" aria-label="Banco"><option value="">¿A qué banco?</option>${E.bancos.map(b => `<option value="${esc(b.id)}" ${b.id === l.bancoId ? 'selected' : ''}>🏦 ${esc(b.nombre)}</option>`).join('')}</select>` : '<span class="awc-ayuda">—</span>'}
        <input class="awc-in" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Monto" aria-label="Monto" data-sep-monto="${i}" value="${l.monto || ''}">
        <button type="button" class="awc-sep-x" data-sep-quitar="${i}" title="Quitar" ${E.sep.length <= 2 ? 'disabled style="opacity:.35"' : ''}>✕</button></div>`).join('')}
      <button type="button" class="awc-link" id="awc-sep-mas">＋ Agregar otra forma de pago</button>
      <div class="awc-sep-suma" id="awc-sep-suma"></div>`;
    cont.querySelectorAll('[data-sep-met]').forEach(s => s.addEventListener('change', () => { const l = E.sep[+s.dataset.sepMet]; l.metodoId = s.value; l.bancoId = ''; pintarSeparado(true); }));
    cont.querySelectorAll('[data-sep-banco]').forEach(s => s.addEventListener('change', () => { E.sep[+s.dataset.sepBanco].bancoId = s.value; listo(); }));
    cont.querySelectorAll('[data-sep-monto]').forEach(s => s.addEventListener('input', () => { E.sep[+s.dataset.sepMonto].monto = r2(s.value); listo(); }));
    cont.querySelectorAll('[data-sep-quitar]').forEach(s => s.addEventListener('click', () => { if (E.sep.length > 2) { E.sep.splice(+s.dataset.sepQuitar, 1); pintarSeparado(true); } }));
    document.getElementById('awc-sep-mas').addEventListener('click', () => { E.sep.push({ metodoId: ms[0].id, monto: 0, bancoId: '' }); pintarSeparado(true); });
    listo();
  }
  function separadoListo() {
    if (!E.sep) return false;
    const ms = E.estado.metodos, nom = id => (ms.find(m => m.id === id) || {}).nombre || '';
    const suma = r2(E.sep.reduce((a, l) => a + (Number(l.monto) || 0), 0)), dif = r2(aPagar() - suma);
    const sinBanco = E.sep.find(l => l.monto > 0 && necesitaBanco(nom(l.metodoId)) && !l.bancoId);
    const ok = Math.abs(dif) < 0.005 && !sinBanco && E.sep.filter(l => l.monto > 0).length >= 2;
    const el = document.getElementById('awc-sep-suma');
    if (el) {
      el.className = 'awc-sep-suma' + (ok ? ' ok' : '');
      el.textContent = `Suma: ${f(suma)} de ${f(aPagar())} · ` + (Math.abs(dif) >= 0.005 ? (dif > 0 ? 'Falta ' + f(dif) : 'Sobra ' + f(-dif))
        : sinBanco ? `Elige el banco de ${nom(sinBanco.metodoId)}` : E.sep.filter(l => l.monto > 0).length < 2 ? 'Usa al menos 2 formas de pago' : '✅ Cuadra');
    }
    return ok;
  }
  function listo() {
    const b = document.getElementById('awc-cobrar'); if (!b) return;
    if (E.metodo?.id === '__separado') { b.disabled = !separadoListo() || E.cobrando; b.textContent = 'Cobrar ' + f(aPagar()); return; }
    b.disabled = !E.metodo || (necesitaBanco(E.metodo.nombre) && !E.banco) || E.cobrando;
    b.textContent = 'Cobrar ' + f(aPagar());
  }
  function cambio() {
    const el = document.getElementById('awc-cambio'); if (!el) return;
    const rec = Number(document.getElementById('awc-recibido').value);
    if (!(rec > 0)) { el.textContent = '—'; el.style.color = ''; return; }
    const d = r2(rec - aPagar());
    el.textContent = d >= 0 ? f(d) : 'Faltan ' + f(-d);
    el.style.color = d >= 0 ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)';
  }
  async function cobrar() {
    if (E.cobrando || E.ventaId) return;
    const mt = E.metodo, mot = motor(); if (!mt || !mot) return;
    const rec = Number(document.getElementById('awc-recibido')?.value);
    if (/efectivo/i.test(mt.nombre) && rec > 0 && rec + 0.004 < aPagar()) { document.getElementById('awc-err').textContent = 'Lo recibido es menos que el total a cobrar.'; return; }
    E.cobrando = true; listo();
    document.getElementById('awc-cobrar').textContent = 'Cobrando…';
    document.getElementById('awc-err').textContent = '';
    let r, separado = null;
    if (mt.id === '__separado') {
      if (!separadoListo()) { E.cobrando = false; listo(); document.getElementById('awc-err').textContent = 'El pago separado debe cuadrar exacto.'; return; }
      const ms = E.estado.metodos;
      separado = E.sep.filter(l => l.monto > 0).map(l => ({ metodoId: l.metodoId, monto: l.monto, banco: l.bancoId ? (E.bancos.find(b => b.id === l.bancoId) || null) : null }));
      E.metodo = { ...mt, nombre: 'Pago separado (' + separado.map(l => (ms.find(m => m.id === l.metodoId) || {}).nombre).join(' + ') + ')' };
    }
    try { r = await mot.cobrar({ metodoId: separado ? null : mt.id, metodoNombre: E.metodo.nombre, fiado: false, separado, banco: separado ? null : E.banco, notas: E.cobro?.concepto }); }
    catch (e) { r = { ok: false, motivo: 'No se pudo registrar la venta. Intenta de nuevo.' }; }
    E.cobrando = false;
    if (r && r.ok) { if (!E.ventaId) await hecho(r, false); return; }
    listo();
    document.getElementById('awc-err').textContent = (r && r.motivo) || 'No se registró la venta.';
  }
  function avanzado() {
    if (E.ventaId) return;
    document.getElementById('awc-cobro').classList.add('awc-avanzado');
    try { motor()?.irAPago(); } catch (_) {}
    document.getElementById('awc-pie').innerHTML = '<div class="awc-ayuda" style="text-align:center">Completa la venta aquí arriba. Al confirmarla, el pago se aplica al abonado.</div>';
  }

  /* ---------- Cobrado ---------- */
  async function hecho(r, desdeAvanzado) {
    E.ventaId = r.ventaId;
    document.getElementById('awc-cobro').classList.remove('awc-avanzado');
    // Ventas ya aplicó el pago al confirmar; si no alcanzó, se aplica aquí (el servidor no duplica).
    let aviso = '';
    try {
      const { data: rc, error } = await sb().rpc('agua_confirmar_cobro', { p_cobro_id: E.cobro.cobro_id, p_venta_id: r.ventaId });
      if (error || !rc?.ok) aviso = 'La venta quedó registrada, pero no se pudo aplicar a los meses. Avísanos para revisarlo.';
      else if (Number(rc.a_favor) > 0) aviso = `${f(rc.a_favor)} quedó como saldo a favor del abonado.`;
    } catch (e) { aviso = 'La venta quedó registrada, pero no se pudo confirmar el pago del abonado. Revisa tu conexión.'; }
    const total = Number(r.total) || 0;
    const rec = Number(document.getElementById('awc-recibido')?.value);
    const dif = !desdeAvanzado && /efectivo/i.test(E.metodo?.nombre || '') && rec > 0 ? r2(rec - aPagar()) : 0;
    document.getElementById('awc-cuerpo').innerHTML = `<div class="awc-ok"><div class="awc-ok-ico">✅</div>
      <div class="awc-ok-tit">Cobrado ${esc(f(total))}</div>
      <div class="awc-ayuda">Venta ${esc(r.numero || '')}${E.metodo?.nombre && !desdeAvanzado ? ' · ' + esc(E.metodo.nombre) : ''}</div>
      ${dif > 0 ? `<div style="margin-top:12px;font-size:20px;font-weight:900">Cambio: ${esc(f(dif))}</div>` : ''}
      ${aviso ? `<div class="awc-info" style="margin-top:12px">${esc(aviso)}</div>` : ''}
      <div class="awc-ayuda" style="margin-top:12px">Quedó en Ventas y en Caja. El pago ya está aplicado a ${esc(E.ab.codigo)}.</div>
      <div class="awc-chips" style="margin-top:14px;justify-content:center"><button type="button" class="awc-chip" id="awc-ticket">🧾 Imprimir ticket</button><button type="button" class="awc-chip" id="awc-pdf">📄 Recibo PDF</button>${E.ab.whatsapp || E.ab.telefono ? '<button type="button" class="awc-chip" id="awc-wa">📲 WhatsApp</button>' : ''}</div></div>`;
    document.getElementById('awc-pie').innerHTML = '<button type="button" class="awc-btn" id="awc-listo">✓ Listo</button>';
    document.getElementById('awc-listo').addEventListener('click', cerrar);
    document.getElementById('awc-ticket').addEventListener('click', () => {
      let w = null; try { w = window.open('', '_blank', 'width=380,height=600'); } catch (_) {}
      Promise.resolve(motor()?.imprimirTicket(r.ventaId, w)).catch(() => { try { w && w.close(); } catch (_) {} });
    });
    document.getElementById('awc-pdf').addEventListener('click', () => { Promise.resolve(motor()?.descargarRecibo(r.ventaId)).catch(() => {}); });
    const wa = document.getElementById('awc-wa');
    if (wa) wa.addEventListener('click', () => {
      const t = window.awTelWa ? window.awTelWa(E.ab.whatsapp || E.ab.telefono) : '';
      const msg = `Hola ${E.ab.nombre}, recibimos tu pago de ${f(total)} (${E.cobro?.concepto || 'agua'}). ¡Gracias!`;
      if (t) window.open(`https://wa.me/${t}?text=${encodeURIComponent(msg)}`, '_blank');
    });
  }
  function cerrar() {
    if (E.cobrando) return;
    clearInterval(E.vigia);
    const m = document.getElementById('awc-cobro'); if (m) { m.style.display = 'none'; m.classList.remove('awc-avanzado'); }
    const fr = document.getElementById('awc-marco'); if (fr) fr.src = 'about:blank';
    try { sessionStorage.removeItem('n360_agua_cobro'); } catch (_) {}
    const cobrado = !!E.ventaId, fin = E.alCerrar;
    // Se cerró sin cobrar: el cobro preparado se cancela (y los meses por adelantado sin pagar se anulan).
    if (!cobrado && E.cobro?.cobro_id) { sb().rpc('agua_cancelar_cobro', { p_cobro_id: E.cobro.cobro_id }).then(() => {}, () => {}); }
    E.abierto = false; E.alCerrar = null;
    if (typeof fin === 'function') { try { fin(cobrado); } catch (_) {} }
  }
  return { abrir, cerrar, _estado: () => E };
})();
window.AWCobro = AWCobro;
