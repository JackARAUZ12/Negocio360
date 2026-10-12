/* =====================================================
   ASISTENTE DE IMPUESTOS — Contabilidad
   Configura, en 3 preguntas, las cuentas y conexiones que la
   contabilización automática necesita para los impuestos.

   Reglas de seguridad (no dañar nada):
   - NUNCA cambia una conexión (mapeo) que ya esté puesta: solo
     completa lo que está vacío.
   - NUNCA borra ni renombra cuentas. Reutiliza las que ya existen
     (por nombre) y crea únicamente las que faltan.
   - NO crea asientos ni toca Ventas/Compras/Gastos/Salarios. Los
     asientos siguen saliendo de "Generar automáticos", que siempre
     cuadra (Debe = Haber).
   Depende de contabilidad.js (STATE, sbClient, esc, fmt, round2…).
===================================================== */
(function () {
  // ---- Cuentas que el asistente puede necesitar ----
  // buscar: nombres que se consideran "la misma cuenta" si el usuario ya la tiene.
  const ROLES = {
    caja:        { nombre: 'Caja General', tipo: 'activo', nat: 'deudora', codigo: '1110', padre: '1100', buscar: /^caja( general)?$|caja general/i },
    iva_pagar:   { nombre: 'IVA por Pagar', tipo: 'pasivo', nat: 'acreedora', codigo: '2120', padre: '2100', buscar: /iva.*(pagar|d[eé]bito|trasladado|cobrado)|d[eé]bito fiscal/i },
    iva_acred:   { nombre: 'IVA Acreditable', tipo: 'activo', nat: 'deudora', codigo: '1150', padre: '1100', buscar: /iva.*(acreditable|cr[eé]dito|pagado)|cr[eé]dito fiscal/i },
    otros_pagar: { nombre: 'Impuestos por Pagar', tipo: 'pasivo', nat: 'acreedora', codigo: '2130', padre: '2100', buscar: /^impuestos?( municipales?)?.*pagar/i },
    ret_pagar:   { nombre: 'Retenciones de IR por Pagar', tipo: 'pasivo', nat: 'acreedora', codigo: '2150', padre: '2100', buscar: /retenci[oó]n(es)?.*(ir|renta).*pagar|(ir|renta).*retenid.*pagar/i },
    ret_favor:   { nombre: 'Retenciones de IR a Favor', tipo: 'activo', nat: 'deudora', codigo: '1160', padre: '1100', buscar: /retenci[oó]n(es)?.*(ir|renta).*(favor|cobrar)|(ir|renta).*a favor|anticipo.*(ir|renta)/i },
    nomina_pagar:{ nombre: 'Retenciones de Nómina por Pagar (INSS e IR)', tipo: 'pasivo', nat: 'acreedora', codigo: '2160', padre: '2100', buscar: /retenciones?.*n[oó]mina|inss laboral.*pagar|deducciones.*(ley|n[oó]mina).*pagar/i },
    aportes_pagar:{ nombre: 'Aportes Patronales por Pagar (INSS/INATEC)', tipo: 'pasivo', nat: 'acreedora', codigo: '2170', padre: '2100', buscar: /aportes?.*(patronal|inss|inatec).*pagar|inss patronal.*pagar/i },
    aportes_gasto:{ nombre: 'Gasto por Aportes Patronales', tipo: 'gasto', nat: 'deudora', codigo: '6160', padre: '6100', buscar: /aportes?.*patronal|cargas sociales|inss patronal/i },
  };

  // ---- Conexiones (mapeo). debe/haber = rol de cuenta, o null. ----
  const CONEXIONES = {
    iva: [
      { tipo: 'iva_ventas', haber: 'iva_pagar' },
      { tipo: 'iva_gastos', debe: 'iva_acred' },
      { tipo: 'impuesto_ventas_otros', haber: 'otros_pagar' },
      { tipo: 'pago_impuestos', debe: 'iva_pagar', haber: 'caja' },
    ],
    ret_clientes: [
      { tipo: 'retencion_ir_clientes', debe: 'ret_favor' },
    ],
    ret_proveedores: [
      { tipo: 'retencion_ir', haber: 'ret_pagar' },
      { tipo: 'pago_retenciones_ir', debe: 'ret_pagar', haber: 'caja' },
    ],
    nomina: [
      { tipo: 'nomina_deducciones_ley', haber: 'nomina_pagar' },
      { tipo: 'aporte_patronal', debe: 'aportes_gasto', haber: 'aportes_pagar' },
    ],
  };

  const PREGUNTAS = [
    { id: 'iva', titulo: 'Mi negocio cobra IVA', ayuda: 'El IVA que cobras a tus clientes no es tuyo: se lo debes a la DGI. Esto lo separa de tus ventas y también registra el IVA que pagas en compras y gastos (para restarlo).' },
    { id: 'ret_clientes', titulo: 'Mis clientes me retienen IR', ayuda: 'Cuando un cliente te paga y te descuenta el 2 % (u otro %) de IR. Para ti es un pago de impuesto por adelantado, un saldo a tu favor.' },
    { id: 'ret_proveedores', titulo: 'Yo retengo IR a proveedores o servicios', ayuda: 'Cuando tú pagas a un proveedor y le descuentas el IR. Ese dinero lo debes entregar a la DGI.' },
    { id: 'nomina', titulo: 'Tengo empleados (INSS e IR de salarios)', ayuda: 'Separa lo que retienes a los empleados y lo que aportas tú como patrono (INSS patronal, INATEC); ambos quedan como deuda por pagar.' },
  ];

  const NOMBRE_TIPO = {
    iva_ventas: 'IVA que cobras a tus clientes',
    iva_gastos: 'IVA que pagas en compras y gastos',
    impuesto_ventas_otros: 'Otros impuestos cobrados en ventas',
    pago_impuestos: 'Pago de impuestos a la DGI',
    retencion_ir_clientes: 'IR que te retienen tus clientes (a tu favor)',
    retencion_ir: 'IR que tú retienes a proveedores (por pagar)',
    pago_retenciones_ir: 'Pago de retenciones de IR a la DGI',
    nomina_deducciones_ley: 'INSS e IR retenidos a empleados',
    aporte_patronal: 'Aportes patronales (INSS patronal, INATEC)',
  };

  let PLAN = null; // { crear:[roles], conexiones:[{tipo,debeId,haberId,...}], ya:[...], avisos:[] }

  const cuentasActivas = () => (STATE.cuentas || []).filter(c => c.activa !== false);

  // Encuentra una cuenta existente para un rol (por nombre, mismo tipo, que admita movimientos).
  function buscarExistente(rolKey, mapeo) {
    const r = ROLES[rolKey];
    if (rolKey === 'caja') {
      const idVenta = mapeo.get('venta')?.cuenta_debe_id;
      const c = idVenta && cuentasActivas().find(x => x.id === idVenta && x.permite_movimientos);
      if (c) return c;
    }
    return cuentasActivas().find(c => c.permite_movimientos && c.tipo === r.tipo && r.buscar.test(String(c.nombre || '')));
  }

  function codigoLibre(preferido, usados) {
    let n = parseInt(preferido, 10);
    if (!Number.isFinite(n)) n = 9000;
    while (usados.has(String(n))) n++;
    return String(n);
  }

  async function leerMapeo() {
    const { data } = await sbClient.from('contabilidad_mapeo_cuentas').select('*').eq('auth_user_id', STATE.userId);
    return new Map((data || []).map(m => [m.tipo_transaccion, m]));
  }

  // Calcula (SIN escribir nada) qué se va a crear, reutilizar y conectar.
  async function calcularPlan(sel) {
    if (!STATE.cuentas || !STATE.cuentas.length) await cargarCuentas();
    const mapeo = await leerMapeo();
    const usados = new Set((STATE.cuentas || []).map(c => String(c.codigo)));
    const rolId = new Map();      // rol → id de cuenta existente
    const crear = new Map();      // rol → { codigo, ... }
    const reutiliza = [];
    const ya = [], nuevas = [], avisos = [];

    const asegurar = rolKey => {
      if (rolId.has(rolKey) || crear.has(rolKey)) return;
      const ex = buscarExistente(rolKey, mapeo);
      if (ex) { rolId.set(rolKey, ex.id); reutiliza.push({ rol: rolKey, cuenta: ex }); return; }
      const codigo = codigoLibre(ROLES[rolKey].codigo, usados);
      usados.add(codigo);
      crear.set(rolKey, { ...ROLES[rolKey], codigo });
    };

    for (const grupo of Object.keys(CONEXIONES)) {
      if (!sel[grupo]) continue;
      for (const cx of CONEXIONES[grupo]) {
        const actual = mapeo.get(cx.tipo) || {};
        const fila = { tipo: cx.tipo, debe: actual.cuenta_debe_id || null, haber: actual.cuenta_haber_id || null, pone: [] };
        for (const lado of ['debe', 'haber']) {
          if (!cx[lado]) continue;
          if (fila[lado]) continue;           // ya configurado: NO se toca
          asegurar(cx[lado]);
          fila.pone.push({ lado, rol: cx[lado] });
        }
        if (fila.pone.length) nuevas.push(fila); else ya.push(fila);
      }
    }
    if (sel.nomina) {
      const ps = mapeo.get('pago_salario');
      if (!ps || !ps.cuenta_debe_id || !ps.cuenta_haber_id) avisos.push('Todavía no está conectado el "Pago de salario" (Contabilización automática › Avanzado). Sin eso, las deducciones de nómina no se asientan.');
    }
    if (sel.iva || sel.ret_proveedores) {
      const hayCaja = ['caja'].some(k => rolId.has(k) || crear.has(k));
      if (crear.has('caja')) avisos.push('No encontré tu cuenta de Caja; se creará "Caja General" para registrar los pagos a la DGI. Si pagas desde un banco, puedes cambiarla luego en Avanzado.');
      void hayCaja;
    }
    return { sel, mapeo, rolId, crear, reutiliza, nuevas, ya, avisos };
  }

  function nombreRol(plan, rol) {
    if (plan.crear.has(rol)) return `${plan.crear.get(rol).codigo} · ${plan.crear.get(rol).nombre} (nueva)`;
    const c = (STATE.cuentas || []).find(x => x.id === plan.rolId.get(rol));
    return c ? `${c.codigo} · ${c.nombre}` : '—';
  }

  function renderPlan(plan) {
    const cuentaTxt = id => { const c = (STATE.cuentas || []).find(x => x.id === id); return c ? `${esc(c.codigo)} · ${esc(c.nombre)}` : '—'; };
    const nuevasCta = [...plan.crear.values()];
    const filasNuevas = plan.nuevas.map(f => `<tr><td>${esc(NOMBRE_TIPO[f.tipo] || f.tipo)}</td><td style="font-size:12.5px">${f.pone.map(p => `<b>${p.lado === 'debe' ? 'Debe' : 'Haber'}</b>: ${esc(nombreRol(plan, p.rol))}`).join('<br>')}</td></tr>`).join('');
    const filasYa = plan.ya.map(f => `<tr><td>${esc(NOMBRE_TIPO[f.tipo] || f.tipo)}</td><td style="font-size:12.5px;color:var(--text-muted)">Ya estaba conectado${f.debe ? ' · Debe ' + cuentaTxt(f.debe) : ''}${f.haber ? ' · Haber ' + cuentaTxt(f.haber) : ''}. No se toca.</td></tr>`).join('');
    return `
      ${nuevasCta.length ? `<div style="margin-bottom:12px"><b>Cuentas nuevas que se crearán</b>
        <ul style="margin:6px 0 0 18px;font-size:13px">${nuevasCta.map(c => `<li>${esc(c.codigo)} · ${esc(c.nombre)} <span style="color:var(--text-muted)">(${esc(c.tipo)})</span></li>`).join('')}</ul></div>` : ''}
      ${plan.reutiliza.length ? `<div style="margin-bottom:12px"><b>Cuentas tuyas que se reutilizan</b>
        <ul style="margin:6px 0 0 18px;font-size:13px">${plan.reutiliza.map(r => `<li>${esc(r.cuenta.codigo)} · ${esc(r.cuenta.nombre)}</li>`).join('')}</ul></div>` : ''}
      ${filasNuevas ? `<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>Se conectará</th><th>Cuenta</th></tr></thead><tbody>${filasNuevas}</tbody></table></div>` : ''}
      ${filasYa ? `<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>Ya configurado</th><th></th></tr></thead><tbody>${filasYa}</tbody></table></div>` : ''}
      ${plan.avisos.map(a => `<p style="font-size:12.5px;color:var(--warning,#b45309);margin:6px 0">⚠ ${esc(a)}</p>`).join('')}
      ${!filasNuevas && !nuevasCta.length ? '<p style="color:var(--success);font-weight:600">✅ Todo lo que elegiste ya está configurado. No hay nada que cambiar.</p>' : ''}
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px">No se borra ni se modifica nada de lo que ya tienes. Los asientos siguen saliendo de "Generar automáticos" y siempre cuadran (Debe = Haber).</p>`;
  }

  // ---- UI ----
  async function detectar() {
    const sel = { iva: true, ret_clientes: false, ret_proveedores: false, nomina: false };
    try {
      const [r1, r2, r3] = await Promise.all([
        sbClient.from('retenciones_ir').select('id', { head: true, count: 'exact' }).eq('auth_user_id', STATE.userId).eq('lado', 'a_favor'),
        sbClient.from('retenciones_ir').select('id', { head: true, count: 'exact' }).eq('auth_user_id', STATE.userId).eq('lado', 'por_pagar'),
        sbClient.from('empleados').select('id', { head: true, count: 'exact' }).eq('auth_user_id', STATE.userId),
      ]);
      if ((r1.count || 0) > 0) sel.ret_clientes = true;
      if ((r2.count || 0) > 0) sel.ret_proveedores = true;
      if ((r3.count || 0) > 0) sel.nomina = true;
    } catch (e) { /* sin detección: el usuario elige */ }
    return sel;
  }

  function leerSeleccion() {
    const sel = {};
    PREGUNTAS.forEach(p => { sel[p.id] = !!document.getElementById('ai-q-' + p.id)?.checked; });
    return sel;
  }

  async function abrirAsistenteImpuestos() {
    PLAN = null;
    const cuerpo = document.getElementById('ai-cuerpo');
    document.getElementById('ai-error').textContent = '';
    document.getElementById('ai-btn-revisar').style.display = '';
    document.getElementById('ai-btn-aplicar').style.display = 'none';
    document.getElementById('ai-btn-atras').style.display = 'none';
    cuerpo.innerHTML = 'Preparando…';
    openModal('modal-asistente-impuestos');
    const sel = await detectar();
    cuerpo.innerHTML = `
      <p style="font-size:13px;margin-bottom:12px">Marca lo que aplica a tu negocio. Yo creo las cuentas que falten y las conecto solas. Antes de guardar nada te muestro exactamente qué voy a hacer.</p>
      ${PREGUNTAS.map(p => `
        <label style="display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;cursor:pointer">
          <input type="checkbox" id="ai-q-${p.id}" ${sel[p.id] ? 'checked' : ''} style="margin-top:3px"/>
          <span><span style="font-weight:600;font-size:13.5px">${esc(p.titulo)}</span><br><span style="font-size:12px;color:var(--text-muted)">${esc(p.ayuda)}</span></span>
        </label>`).join('')}
      <p style="font-size:12px;color:var(--text-muted)">Las casillas ya vienen marcadas según lo que detecté en tu sistema. Puedes cambiarlas.</p>`;
  }

  async function revisarAsistente() {
    const err = document.getElementById('ai-error');
    err.textContent = '';
    try {
      const sel = leerSeleccion();
      if (!Object.values(sel).some(Boolean)) { err.textContent = 'Marca al menos una opción.'; return; }
      PLAN = await calcularPlan(sel);
      document.getElementById('ai-cuerpo').innerHTML = `<p style="font-size:13px;margin-bottom:12px"><b>Esto es lo que voy a hacer</b> (todavía no he guardado nada):</p>${renderPlan(PLAN)}`;
      const hayCambios = PLAN.crear.size > 0 || PLAN.nuevas.length > 0;
      document.getElementById('ai-btn-revisar').style.display = 'none';
      document.getElementById('ai-btn-aplicar').style.display = hayCambios ? '' : 'none';
      document.getElementById('ai-btn-atras').style.display = '';
    } catch (e) {
      console.error('asistente impuestos:', e);
      err.textContent = 'No se pudo preparar el plan: ' + (e.message || '');
    }
  }

  async function aplicarAsistente() {
    if (!PLAN) return;
    const err = document.getElementById('ai-error');
    err.textContent = '';
    setBtnLoading('ai-btn-aplicar', true);
    try {
      const plan = PLAN;
      const porCodigo = new Map((STATE.cuentas || []).map(c => [String(c.codigo), c]));
      const idDe = new Map(plan.rolId);
      // 1) Crear solo las cuentas que faltan.
      for (const [rol, def] of plan.crear) {
        const padre = def.padre ? porCodigo.get(def.padre) : null;
        const { data, error } = await sbClient.from('cuentas_contables').insert({
          auth_user_id: STATE.userId, codigo: def.codigo, nombre: def.nombre, tipo: def.tipo,
          naturaleza: def.nat, nivel: padre ? (Number(padre.nivel) || 2) + 1 : 1,
          permite_movimientos: true, activa: true, cuenta_padre_id: padre ? padre.id : null,
        }).select().single();
        if (error || !data) throw new Error(`No se pudo crear la cuenta ${def.codigo} ${def.nombre}: ${error?.message || ''}`);
        idDe.set(rol, data.id);
      }
      // 2) Conectar: solo los lados que estaban vacíos (lee otra vez por si algo cambió).
      const vigente = await leerMapeo();
      let conectados = 0;
      for (const f of plan.nuevas) {
        const act = vigente.get(f.tipo) || {};
        let debe = act.cuenta_debe_id || null, haber = act.cuenta_haber_id || null;
        for (const p of f.pone) {
          const id = idDe.get(p.rol);
          if (!id) continue;
          if (p.lado === 'debe' && !debe) debe = id;
          if (p.lado === 'haber' && !haber) haber = id;
        }
        const { error } = await sbClient.from('contabilidad_mapeo_cuentas').upsert({
          auth_user_id: STATE.userId, tipo_transaccion: f.tipo, cuenta_debe_id: debe, cuenta_haber_id: haber,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'auth_user_id,tipo_transaccion' });
        if (error) throw new Error(`No se pudo conectar "${NOMBRE_TIPO[f.tipo] || f.tipo}": ${error.message}`);
        conectados++;
      }
      await cargarCuentas();
      const cuadre = await verificarCuadre();
      document.getElementById('ai-cuerpo').innerHTML = `
        <div style="text-align:center;margin:6px 0 14px"><div style="font-size:30px">✅</div>
          <p style="font-weight:700;font-size:15px">Impuestos configurados</p>
          <p style="font-size:13px;color:var(--text-muted)">${plan.crear.size} cuenta(s) nueva(s) · ${conectados} conexión(es) completada(s)</p></div>
        ${cuadre}
        <p style="font-size:13px;margin-top:12px"><b>Siguiente paso:</b> presiona <i>Generar automáticos</i> para que tus movimientos ya hechos (ventas, compras, retenciones, pagos) entren a la contabilidad con los impuestos separados. Luego revisa la pestaña <b>Impuestos</b>.</p>`;
      document.getElementById('ai-btn-aplicar').style.display = 'none';
      document.getElementById('ai-btn-atras').style.display = 'none';
      document.getElementById('ai-btn-revisar').style.display = 'none';
      PLAN = null;
      if (typeof cargarImpuestosContables === 'function') cargarImpuestosContables();
    } catch (e) {
      console.error('aplicarAsistente:', e);
      err.textContent = (e.message || 'Error al aplicar') + ' — lo que se alcanzó a crear queda disponible; puedes volver a abrir el asistente y continuar sin duplicar nada.';
    } finally {
      setBtnLoading('ai-btn-aplicar', false);
    }
  }

  // Comprueba que, en todo el libro, Debe total = Haber total.
  async function verificarCuadre() {
    try {
      const ids = (STATE.cuentas || []).map(c => c.id);
      if (!ids.length) return '';
      const { data, error } = await sbClient.rpc('sumar_movimientos_por_cuenta', { p_cuenta_ids: ids, p_fecha_desde: null, p_fecha_hasta: null });
      if (error) throw error;
      const D = round2((data || []).reduce((a, x) => a + (Number(x.total_debe) || 0), 0));
      const H = round2((data || []).reduce((a, x) => a + (Number(x.total_haber) || 0), 0));
      const ok = Math.abs(D - H) < 0.01;
      return `<div style="padding:10px 14px;border-radius:8px;background:var(--bg-hover,#f3f4f6);font-size:13px">
        Verificación de cuadre del libro: Debe ${fmt(D)} · Haber ${fmt(H)} — ${ok ? '<b style="color:var(--success)">✅ cuadra</b>' : '<b style="color:var(--danger)">⚠ diferencia ' + fmt(round2(D - H)) + ' (ya existía antes; el asistente no crea asientos)</b>'}</div>`;
    } catch (e) { return ''; }
  }

  function volverAsistente() { abrirAsistenteImpuestos(); }

  // Aviso/semáforo que se muestra arriba de la pestaña Impuestos.
  function bannerImpuestos(sinConfigurar) {
    const n = (sinConfigurar || []).length;
    const boton = `<button class="btn-primary btn-sm" onclick="abrirAsistenteImpuestos()">🧭 Asistente de impuestos</button>`;
    if (!n) return `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 14px;border-radius:8px;background:rgba(16,185,129,.1);margin-bottom:12px"><span style="font-size:13px">🟢 Todos los impuestos están conectados a la contabilidad.</span>${boton}</div>`;
    const nombres = sinConfigurar.map(d => NOMBRE_TIPO[d.tipo] || d.etiqueta).filter(Boolean);
    return `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 14px;border-radius:8px;background:rgba(245,158,11,.12);margin-bottom:12px"><span style="font-size:13px">🟡 Sin conectar: ${nombres.map(esc).join(' · ')}. <span style="color:var(--text-muted)">Si no usas alguno, no pasa nada.</span></span>${boton}</div>`;
  }

  window.abrirAsistenteImpuestos = abrirAsistenteImpuestos;
  window.revisarAsistenteImpuestos = revisarAsistente;
  window.aplicarAsistenteImpuestos = aplicarAsistente;
  window.volverAsistenteImpuestos = volverAsistente;
  window.bannerImpuestosContables = bannerImpuestos;
  window.__asistenteImpuestos = { calcularPlan, ROLES, CONEXIONES }; // para pruebas
})();
