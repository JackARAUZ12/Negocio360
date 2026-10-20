/* =====================================================
   CUENTAS DE DINERO — Contabilidad
   Ubica el dinero de Caja General en Caja Chica (todo el efectivo)
   y en la cuenta de cada banco (tarjeta/transferencia con banco),
   igual que lo separa el módulo Caja.

   Reglas de seguridad (no dañar nada):
   - NUNCA edita ni borra un asiento existente. El cálculo y la
     escritura los hace la base de datos (contabilidad_ubicar_dinero)
     en UNA transacción: se agrega un asiento por día "Ubicación del
     dinero" que solo pasa montos entre cuentas de dinero (Debe = Haber,
     el total de dinero no cambia). Si un día cambia, se anula el de ese
     día y se crea uno nuevo.
   - Sin configurar, no hace nada: todo sigue en Caja General.
   - Desactivar anula esos asientos: todo vuelve a como estaba.
   - Solo se ubica lo que Caja demuestra; lo demás queda "sin ubicar"
     en Caja General y se explica el motivo.
   Depende de contabilidad.js (STATE, sbClient, esc, fmt, round2…).
===================================================== */
(function () {
  'use strict';

  const D = { config: null, bancos: [], previa: null };

  /* ---------- Datos ---------- */
  async function cargarConfig() {
    const { data, error } = await sbClient.from('contabilidad_cuentas_dinero')
      .select('clave, cuenta_id').eq('auth_user_id', STATE.userId);
    if (error) throw error;
    const cfg = { caja_general: null, efectivo: null, bancos: {} };
    (data || []).forEach(r => {
      if (r.clave === 'caja_general') cfg.caja_general = r.cuenta_id;
      else if (r.clave === 'efectivo') cfg.efectivo = r.cuenta_id;
      else if (r.clave.startsWith('banco:')) cfg.bancos[r.clave.slice(6)] = r.cuenta_id;
    });
    D.config = cfg;
    return cfg;
  }
  function configurado(cfg) {
    cfg = cfg || D.config;
    return !!(cfg && cfg.caja_general && (cfg.efectivo || Object.keys(cfg.bancos).length));
  }
  // Cuentas de dinero en uso (sin repetir): Caja General primero.
  function cuentasDinero(cfg) {
    cfg = cfg || D.config;
    if (!configurado(cfg)) return [];
    return [...new Set([cfg.caja_general, cfg.efectivo, ...Object.values(cfg.bancos)].filter(Boolean))];
  }
  const cuenta = id => STATE.cuentas.find(c => c.id === id);
  const nombreCuenta = id => { const c = cuenta(id); return c ? `${c.codigo} — ${c.nombre}` : 'Cuenta'; };

  /* ---------- Sugerencias (solo se proponen; el humano confirma con Guardar) ---------- */
  const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function cuentasActivo() {
    return STATE.cuentas.filter(c => c.tipo === 'activo' && c.permite_movimientos && c.activa !== false);
  }
  function sugerirCajaGeneral(mapeoVenta) {
    if (mapeoVenta && cuenta(mapeoVenta)) return mapeoVenta;
    return (cuentasActivo().find(c => /caja general/.test(normal(c.nombre))) || {}).id || '';
  }
  function sugerirEfectivo(cg) {
    const cands = cuentasActivo().filter(c => c.id !== cg && /caja chica|fondo.*caja/.test(normal(c.nombre)));
    return (cands.find(c => /nacional|cordoba|\bmn\b|m\.n/.test(normal(c.nombre))) || cands[0] || {}).id || '';
  }
  function sugerirBanco(b, cg) {
    const cands = cuentasActivo().filter(c => c.id !== cg && /banco|bac|lafise|banpro|ficohsa|fichosa|avanz|bdf/.test(normal(c.nombre)));
    const digitos = String(b.numero_cuenta || '').replace(/\D/g, '');
    if (digitos.length >= 5) {
      const porNumero = cands.find(c => String(c.nombre).replace(/\D/g, '').includes(digitos.slice(-6)));
      if (porNumero) return porNumero.id;
    }
    const palabra = normal(b.nombre).split(/\s+/).find(p => p.length >= 3 && !['banco', 'usd', 'cor', 'dolar', 'nio'].includes(p));
    if (palabra) {
      const porNombre = cands.filter(c => normal(c.nombre).includes(palabra));
      if (porNombre.length === 1) return porNombre[0].id;
    }
    // Cuenta general de bancos (ej. "1120 Bancos"), si existe una sola así.
    const generales = cands.filter(c => /^bancos?$/.test(normal(c.nombre).trim()));
    return generales.length === 1 ? generales[0].id : '';
  }

  /* ---------- Ventana de configuración ---------- */
  function opciones(seleccion, excluir) {
    return '<option value="">— No ubicar —</option>' + cuentasActivo()
      .filter(c => c.id !== excluir)
      .map(c => `<option value="${c.id}" ${c.id === seleccion ? 'selected' : ''}>${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  }

  async function abrir() {
    if (!STATE.cuentas.length) await cargarCuentas();
    const body = document.getElementById('cd-cuerpo');
    document.getElementById('cd-error').textContent = '';
    document.getElementById('cd-previa').innerHTML = '';
    body.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Cargando…</p>';
    openModal('modal-cuentas-dinero');
    try {
      const [cfg, bancosRes, mapeoRes] = await Promise.all([
        cargarConfig(),
        sbClient.rpc('contabilidad_bancos_del_grupo'),
        sbClient.from('contabilidad_mapeo_cuentas').select('cuenta_debe_id').eq('auth_user_id', STATE.userId).eq('tipo_transaccion', 'venta').maybeSingle(),
      ]);
      if (bancosRes.error) throw bancosRes.error;
      D.bancos = (bancosRes.data || []).filter(b => b.activo !== false || cfg.bancos[b.banco_id]);
      const yaConfigurado = configurado(cfg);
      const cg = cfg.caja_general || sugerirCajaGeneral(mapeoRes.data?.cuenta_debe_id);
      const ef = yaConfigurado ? (cfg.efectivo || '') : sugerirEfectivo(cg);
      render(cg, ef, yaConfigurado);
      if (yaConfigurado) await vistaPrevia(false);
    } catch (e) {
      console.error('Cuentas de dinero:', e);
      body.innerHTML = `<p style="color:var(--danger);font-size:13px">No se pudo cargar: ${esc(e.message || e)}</p>`;
    }
  }

  function render(cg, ef, yaConfigurado) {
    const sinActivos = !cuentasActivo().length;
    if (sinActivos) {
      document.getElementById('cd-cuerpo').innerHTML = `<p style="font-size:13px">Primero necesitas tu Catálogo de cuentas (cuentas de Activo como Caja General, Caja Chica y Bancos).</p>`;
      return;
    }
    const filasBancos = D.bancos.length ? D.bancos.map(b => {
      const sel = yaConfigurado ? (D.config.bancos[b.banco_id] || '') : sugerirBanco(b, cg);
      return `<div class="cd-banco-fila">
        <div><b>${esc(b.nombre)}</b> <span class="cd-chip">${esc(b.moneda || 'NIO')}</span>${b.numero_cuenta ? `<div style="font-size:11px;color:var(--text-muted)">${esc(b.numero_cuenta)}</div>` : ''}${b.lugar ? `<div style="font-size:11px;color:var(--accent)">${esc(b.lugar)}</div>` : ''}</div>
        <div><select class="cd-banco" data-banco="${b.banco_id}">${opciones(sel, cg)}</select>
          ${!yaConfigurado && sel ? '<div style="font-size:10.5px;color:var(--text-muted)">Sugerida — revísala</div>' : ''}</div>
      </div>`;
    }).join('') : `<div style="font-size:12.5px;color:var(--text-muted)">No tienes bancos creados en el módulo Caja. Puedes ubicar solo el efectivo.</div>`;

    document.getElementById('cd-cuerpo').innerHTML = `
      <div class="cd-paso">
        <div class="cd-paso-titulo">1. ¿Cuál es tu Caja General?</div>
        <div class="cd-ayuda">La cuenta a la que hoy llega todo el dinero en tus asientos. De aquí se ubica lo que corresponde a Caja Chica y a cada banco.</div>
        <select id="cd-caja-general" onchange="N360Dinero._cambioCG()">${opciones(cg).replace('— No ubicar —', '— Elegir —')}</select>
      </div>
      <div class="cd-paso">
        <div class="cd-paso-titulo">2. Efectivo → Caja Chica</div>
        <div class="cd-ayuda">Todo lo cobrado y pagado <b>en efectivo</b> (las mismas reglas del cajón en el módulo Caja) va a esta cuenta.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select id="cd-efectivo" style="flex:1;min-width:220px">${opciones(ef, cg)}</select>
          <button class="btn-secondary btn-sm" type="button" onclick="N360Dinero._crearCajaChica()">+ Crear cuenta "Caja Chica"</button>
        </div>
        ${!yaConfigurado && ef ? '<div style="font-size:10.5px;color:var(--text-muted);margin-top:4px">Sugerida — revísala</div>' : ''}
      </div>
      <div class="cd-paso">
        <div class="cd-paso-titulo">3. Cada banco → su cuenta</div>
        <div class="cd-ayuda">Lo cobrado o pagado con <b>tarjeta o transferencia</b> en ese banco (según Caja) va a la cuenta que elijas. Puedes usar una sola cuenta "Bancos" para todos.</div>
        ${D.bancos.length > 1 ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
          <select id="cd-todos" style="flex:1;min-width:220px">${opciones('', cg).replace('— No ubicar —', '— Usar una cuenta para todos —')}</select>
          <button class="btn-secondary btn-sm" type="button" onclick="N360Dinero._aplicarATodos()">Aplicar a todos</button></div>` : ''}
        <div class="cd-banco-fila cd-banco-cabecera"><div>Banco (módulo Caja)</div><div>Cuenta contable</div></div>
        ${filasBancos}
        <div class="cd-ayuda" style="margin-top:6px">Los montos se asientan en la moneda de tu negocio (${esc(STATE.empresaConfig?.moneda || 'NIO')}), aunque el banco sea en otra moneda.</div>
      </div>`;
    document.getElementById('btn-cd-desactivar').style.display = yaConfigurado ? '' : 'none';
    document.getElementById('btn-cd-aplicar').style.display = 'none';
  }

  function _cambioCG() {
    const cg = document.getElementById('cd-caja-general').value;
    const ef = document.getElementById('cd-efectivo').value;
    const bancos = {};
    document.querySelectorAll('.cd-banco').forEach(s => { bancos[s.dataset.banco] = s.value; });
    D.config = { caja_general: cg, efectivo: ef === cg ? '' : ef, bancos };
    render(cg, D.config.efectivo, true);
    document.getElementById('btn-cd-desactivar').style.display = 'none';
  }
  function _aplicarATodos() {
    const v = document.getElementById('cd-todos')?.value;
    if (!v) { showToast('Elige primero la cuenta', 'error'); return; }
    document.querySelectorAll('.cd-banco').forEach(s => { s.value = v; });
  }
  async function _crearCajaChica() {
    const cg = cuenta(document.getElementById('cd-caja-general').value);
    const existente = cuentasActivo().find(c => /^caja chica$/.test(normal(c.nombre).trim()));
    if (existente) { document.getElementById('cd-efectivo').value = existente.id; showToast('Ya tienes una cuenta "Caja Chica": quedó elegida'); return; }
    const usados = new Set(STATE.cuentas.map(c => c.codigo));
    const base = cg ? cg.codigo : '1110';
    const codigo = ['1115', '1111', '1112', `${base}.1`, `${base}-CC`].find(c => !usados.has(c));
    if (!codigo) { showToast('No se encontró un código libre: créala desde el Catálogo de cuentas', 'error'); return; }
    const { data, error } = await sbClient.from('cuentas_contables').insert({
      auth_user_id: STATE.userId, codigo, nombre: 'Caja Chica', tipo: 'activo', naturaleza: 'deudora',
      nivel: cg?.nivel || 3, cuenta_padre_id: cg?.cuenta_padre_id || null, permite_movimientos: true,
    }).select().single();
    if (error) { showToast('No se pudo crear la cuenta: ' + error.message, 'error'); return; }
    await cargarCuentas();
    const cgId = document.getElementById('cd-caja-general').value;
    const bancos = {}; document.querySelectorAll('.cd-banco').forEach(s => { bancos[s.dataset.banco] = s.value; });
    D.config = { caja_general: cgId, efectivo: data.id, bancos };
    render(cgId, data.id, true);
    showToast(`Cuenta ${codigo} — Caja Chica creada`);
  }

  /* ---------- Guardar, vista previa y aplicar ---------- */
  async function guardar() {
    const err = document.getElementById('cd-error');
    err.textContent = '';
    const cg = document.getElementById('cd-caja-general')?.value || '';
    const ef = document.getElementById('cd-efectivo')?.value || '';
    const bancos = {};
    document.querySelectorAll('.cd-banco').forEach(s => { if (s.value) bancos[s.dataset.banco] = s.value; });
    if (!cg) { err.textContent = 'Elige tu Caja General (paso 1).'; return; }
    if (!ef && !Object.keys(bancos).length) { err.textContent = 'Elige al menos la cuenta de Caja Chica o la de un banco.'; return; }
    if (ef === cg || Object.values(bancos).includes(cg)) { err.textContent = 'Caja Chica y los bancos deben ser cuentas distintas de Caja General.'; return; }

    setBtnLoading('btn-cd-guardar', true);
    try {
      const anterior = await cargarConfig();
      const filas = [{ clave: 'caja_general', cuenta_id: cg }];
      if (ef) filas.push({ clave: 'efectivo', cuenta_id: ef });
      Object.entries(bancos).forEach(([b, c]) => filas.push({ clave: 'banco:' + b, cuenta_id: c }));
      const ahora = new Date().toISOString();
      const { error } = await sbClient.from('contabilidad_cuentas_dinero').upsert(
        filas.map(f => ({ auth_user_id: STATE.userId, ...f, updated_at: ahora })), { onConflict: 'auth_user_id,clave' });
      if (error) throw error;
      // Lo que se dejó en "— No ubicar —" se quita de la configuración.
      const quitar = [];
      if (anterior.efectivo && !ef) quitar.push('efectivo');
      Object.keys(anterior.bancos).forEach(b => { if (!bancos[b]) quitar.push('banco:' + b); });
      if (quitar.length) {
        const { error: e2 } = await sbClient.from('contabilidad_cuentas_dinero').delete().eq('auth_user_id', STATE.userId).in('clave', quitar);
        if (e2) throw e2;
      }
      await cargarConfig();
      showToast('Configuración guardada. Revisa la vista previa y aplica.');
      await vistaPrevia(true);
    } catch (e) {
      console.error('guardar cuentas de dinero:', e);
      err.textContent = 'No se pudo guardar: ' + (e.message || e);
    } finally { setBtnLoading('btn-cd-guardar', false); }
  }

  function textoMonto(n) { return fmt(Math.abs(Number(n) || 0)); }

  async function vistaPrevia(mostrarAplicar) {
    const box = document.getElementById('cd-previa');
    box.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted)">Calculando la vista previa (no se guarda nada)…</p>';
    const { data, error } = await sbClient.rpc('contabilidad_ubicar_dinero', { p_aplicar: false });
    if (error) { box.innerHTML = `<p style="color:var(--danger);font-size:12.5px">${esc(error.message)}</p>`; return; }
    D.previa = data;
    if (!data?.configurado) { box.innerHTML = ''; return; }
    const pendientes = (data.dias_crear || 0) + (data.dias_reemplazar || 0) + (data.dias_anular || 0) + (data.huerfanos || 0);
    const filas = (data.por_cuenta || []).map(x => `<div class="cd-fila"><span>${esc(nombreCuenta(x.cuenta_id))}</span><b>${Number(x.neto) < 0 ? '−' : ''}${textoMonto(x.neto)}</b></div>`).join('');
    const motivo = (o, txt) => (o && o.cantidad) ? `<li>${txt}: <b>${o.cantidad}</b> (${textoMonto(o.monto)})</li>` : '';
    box.innerHTML = `
      <div class="cd-previa">
        <div style="font-weight:700;margin-bottom:6px">${pendientes ? '👀 Vista previa — todavía no se ha aplicado nada' : '✅ Todo está al día'}</div>
        <div style="font-size:12.5px;margin-bottom:8px">
          ${data.dias} día(s) con dinero por ubicar ·
          ${data.dias_crear ? `<b>${data.dias_crear}</b> asiento(s) nuevo(s) · ` : ''}${data.dias_reemplazar ? `<b>${data.dias_reemplazar}</b> por actualizar · ` : ''}${data.dias_anular ? `<b>${data.dias_anular}</b> por anular · ` : ''}${data.dias_sin_cambio} sin cambios
          ${data.transferencias ? ` · ${data.transferencias} movimiento(s) de transferencias internas` : ''}
        </div>
        ${filas ? `<div style="font-size:11.5px;font-weight:700;color:var(--text-muted);margin-bottom:2px">PASA DE CAJA GENERAL A…</div><div style="margin-bottom:8px">${filas}</div>` : ''}
        ${(data.sin_banco_asignado?.cantidad || data.sin_movimiento_caja?.cantidad || data.monto_distinto?.cantidad) ? `
        <div style="font-size:12px;color:var(--text-secondary)"><b>Se queda en Caja General (sin ubicar):</b><ul style="margin:4px 0 0 18px;padding:0">
          ${motivo(data.sin_banco_asignado, 'Cobros/pagos con tarjeta o transferencia sin banco elegido en Caja (o con un banco sin cuenta aquí)')}
          ${motivo(data.sin_movimiento_caja, 'Asientos sin movimiento en Caja (o con su movimiento anulado)')}
          ${motivo(data.monto_distinto, 'Diferencia entre lo asentado y lo que registró Caja')}
        </ul></div>` : ''}
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:8px">Nada de esto edita ni borra asientos: se agrega un asiento por día "Ubicación del dinero" (Debe = Haber). El total de tu dinero no cambia.</div>
      </div>`;
    document.getElementById('btn-cd-aplicar').style.display = pendientes ? '' : 'none';
    if (mostrarAplicar && pendientes) document.getElementById('btn-cd-aplicar').scrollIntoView?.({ block: 'nearest' });
  }

  async function aplicar() {
    if (!D.previa?.configurado) return;
    if (!confirm('¿Aplicar la ubicación del dinero?\n\nSe agregan asientos "Ubicación del dinero" (uno por día). No se edita ni se borra ningún asiento y puedes desactivarlo cuando quieras.')) return;
    setBtnLoading('btn-cd-aplicar', true);
    try {
      const { data, error } = await sbClient.rpc('contabilidad_ubicar_dinero', { p_aplicar: true });
      if (error) throw error;
      showToast(`Dinero ubicado: ${(data.dias_crear || 0) + (data.dias_reemplazar || 0)} día(s) actualizados`);
      await vistaPrevia(false);
      refrescarPantallas();
    } catch (e) {
      console.error('aplicar ubicación del dinero:', e);
      document.getElementById('cd-error').textContent = 'No se aplicó nada: ' + (e.message || e);
    } finally { setBtnLoading('btn-cd-aplicar', false); }
  }

  async function desactivar() {
    if (!confirm('¿Desactivar la ubicación del dinero?\n\nSe anulan los asientos "Ubicación del dinero" y todo el dinero vuelve a verse en Caja General, como antes. No se toca ningún otro asiento.')) return;
    setBtnLoading('btn-cd-desactivar', true);
    try {
      const { data: n, error } = await sbClient.rpc('contabilidad_quitar_ubicacion_dinero');
      if (error) throw error;
      const { error: e2 } = await sbClient.from('contabilidad_cuentas_dinero').delete().eq('auth_user_id', STATE.userId);
      if (e2) throw e2;
      D.config = null;
      showToast(`Desactivado: ${n || 0} asiento(s) de ubicación anulados`);
      closeModal('modal-cuentas-dinero');
      refrescarPantallas();
    } catch (e) {
      document.getElementById('cd-error').textContent = 'No se pudo desactivar: ' + (e.message || e);
    } finally { setBtnLoading('btn-cd-desactivar', false); }
  }

  function refrescarPantallas() {
    try { if (typeof cargarAsientos === 'function') cargarAsientos(); } catch (_) {}
    try { if (STATE.seccionActual === 'mayor') { poblarSelectCuentasMayor(); cargarLibroMayor(); } } catch (_) {}
  }

  /* ---------- Después de "Generar asientos": se ubica solo ---------- */
  async function ubicarTrasGenerar() {
    try {
      const cfg = await cargarConfig();
      if (!configurado(cfg)) return null;
      const { data, error } = await sbClient.rpc('contabilidad_ubicar_dinero', { p_aplicar: true });
      if (error) { console.warn('ubicar dinero:', error); return null; }
      return data;
    } catch (e) { console.warn('ubicarTrasGenerar:', e); return null; }
  }

  /* ---------- Libro Mayor: cuadre y vista consolidada ---------- */
  async function opcionesMayor(sel) {
    try { await cargarConfig(); } catch (_) { return; }
    if (!configurado() || !sel || sel.querySelector('option[value="__dinero__"]')) return;
    const op = document.createElement('option');
    op.value = '__dinero__';
    op.textContent = '💰 Todo el dinero (Caja General + Caja Chica + Bancos)';
    sel.insertBefore(op, sel.options[1] || null);
  }

  async function saldosDinero() {
    const ids = cuentasDinero();
    if (!ids.length) return null;
    const { data, error } = await sbClient.rpc('sumar_movimientos_por_cuenta', { p_cuenta_ids: ids, p_fecha_desde: null, p_fecha_hasta: null });
    if (error) throw error;
    const m = new Map((data || []).map(r => [r.cuenta_id, round2(Number(r.total_debe || 0) - Number(r.total_haber || 0))]));
    return ids.map(id => ({ id, saldo: m.get(id) || 0 }));
  }

  async function renderCuadre() {
    const cont = document.getElementById('mayor-cuadre-dinero');
    if (!cont) return;
    cont.innerHTML = '';
    try {
      await cargarConfig();
      if (!configurado()) return;
      const saldos = await saldosDinero();
      const cg = D.config.caja_general;
      const total = round2(saldos.reduce((t, s) => t + s.saldo, 0));
      const sinUbicar = (saldos.find(s => s.id === cg) || {}).saldo || 0;
      const filas = saldos.filter(s => s.id !== cg).map(s => `
        <div class="cd-fila"><span>${esc(nombreCuenta(s.id))}${s.id === D.config.efectivo ? ' <span style="font-size:11px;color:var(--text-muted)">(efectivo)</span>' : ''}</span><span>${fmt(s.saldo)}</span></div>`).join('');
      const aviso = Math.abs(sinUbicar) < 0.01
        ? '<span style="color:var(--success)">✅ Todo el dinero está ubicado en Caja Chica o en un banco.</span>'
        : sinUbicar > 0
          ? `⚠️ Hay <b>${fmt(sinUbicar)}</b> en Caja General que no está registrado en ningún banco ni en Caja Chica (por ejemplo, cobros con tarjeta sin banco elegido en Caja).`
          : `⚠️ Faltan <b>${fmt(Math.abs(sinUbicar))}</b>: salió de Caja General más dinero del que está ubicado en Caja Chica y bancos.`;
      cont.innerHTML = `
        <div class="cd-cuadre">
          <div style="font-weight:700;margin-bottom:6px">💰 Cuadre del dinero</div>
          ${filas}
          <div class="cd-fila"><span>${esc(nombreCuenta(cg))} <span style="font-size:11px;color:var(--text-muted)">(sin ubicar)</span></span><span>${fmt(sinUbicar)}</span></div>
          <div class="cd-fila" style="font-weight:800;border-bottom:none"><span>Total del dinero</span><span>${fmt(total)}</span></div>
          <div style="font-size:12px;margin-top:6px">${aviso}</div>
        </div>`;
    } catch (e) { console.warn('cuadre del dinero:', e); }
  }

  // Todas las cuentas de dinero juntas. Se omiten los asientos "Ubicación del dinero"
  // porque solo cambian el dinero de lugar (en el total se cancelan).
  async function cargarMayorConsolidado(tbody) {
    const ids = cuentasDinero();
    if (!ids.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Configura primero las Cuentas de dinero</td></tr>'; return; }
    let data = [];
    let desde = 0;
    const TAM = 1000;
    while (true) {
      const { data: pagina, error } = await sbClient.from('asientos_detalle')
        .select('cuenta_id, debe, haber, descripcion, asientos_contables!inner(numero,fecha,concepto,estado,referencia_tipo)')
        .in('cuenta_id', ids).eq('auth_user_id', STATE.userId).eq('asientos_contables.estado', 'registrado')
        .order('asiento_id').range(desde, desde + TAM - 1);
      if (error) { console.error('mayor consolidado:', error); break; }
      data = data.concat(pagina || []);
      if (!pagina || pagina.length < TAM) break;
      desde += TAM;
    }
    const lista = data.filter(d => d.asientos_contables.referencia_tipo !== 'ubicacion_dinero')
      .sort((a, b) => (a.asientos_contables.fecha || '').localeCompare(b.asientos_contables.fecha || '') || String(a.asientos_contables.numero).localeCompare(String(b.asientos_contables.numero)));
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Todavía no hay movimientos de dinero registrados</td></tr>'; return; }
    let saldo = 0;
    tbody.innerHTML = lista.map(d => {
      saldo = round2(saldo + Number(d.debe || 0) - Number(d.haber || 0));
      const c = cuenta(d.cuenta_id);
      return `<tr>
        <td>${fmtFecha(d.asientos_contables.fecha)}</td>
        <td>${esc(d.asientos_contables.numero)}</td>
        <td>${esc(d.descripcion || d.asientos_contables.concepto)}${c ? `<div style="font-size:11px;color:var(--text-muted)">${esc(c.codigo)} — ${esc(c.nombre)}</div>` : ''}</td>
        <td>${d.debe > 0 ? fmt(d.debe) : '—'}</td>
        <td>${d.haber > 0 ? fmt(d.haber) : '—'}</td>
        <td style="font-weight:700">${fmt(saldo)}</td>
      </tr>`;
    }).join('');
  }

  window.N360Dinero = {
    abrir, guardar, aplicar, desactivar, ubicarTrasGenerar, opcionesMayor, renderCuadre, cargarMayorConsolidado,
    _cambioCG, _aplicarATodos, _crearCajaChica,
  };
})();
