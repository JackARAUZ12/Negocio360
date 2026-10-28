/* ============================================================
   CLIENTE-HISTORIAL.JS — NEGOCIO360 (Clientes · Historial del cliente)
   Todo lo de UN cliente en una sola pantalla: lo que debe, lo que ya
   pagó, lo vencido, su crédito disponible, sus créditos (con el detalle
   de cada uno aquí mismo), pagos, fiados, compras, línea de tiempo,
   reporte y estado de cuenta en PDF.
   SOLO LECTURA: únicamente consulta (select). No escribe en ninguna
   tabla, no cobra, no edita, no anula. No toca Créditos, Caja ni
   Contabilidad.
   Permisos: igual que Clientes; los montos de crédito solo los ve quien
   tiene acceso a Créditos.
   ============================================================ */
'use strict';

(function () {
  const sb = TX.sb;
  const $ = id => document.getElementById(id);
  const esc = TX.esc;
  const money = n => TX.fmtMoneda(n);
  const fecha = d => TX.fmtFecha(d);
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const hoy = () => TX.hoyISO();
  const dia = d => String(d || '').slice(0, 10);
  const FREC = { diaria: 'diaria', semanal: 'semanal', quincenal: 'quincenal', mensual: 'mensual', bimestral: 'bimestral', trimestral: 'trimestral', anual: 'anual' };
  const FREC_PL = { diaria: 'diarias', semanal: 'semanales', quincenal: 'quincenales', mensual: 'mensuales', bimestral: 'bimestrales', trimestral: 'trimestrales', anual: 'anuales' };
  const textoCuotas = (n, frec) => `${n} cuota${n === 1 ? '' : 's'} ${(n === 1 ? FREC : FREC_PL)[frec] || ''}`.trim();

  const CH = {
    id: null, cliente: null, verCreditos: true,
    creditos: [], cuotas: {}, pagos: [], eventos: {}, ventas: [], fiados: [], fiadoPagos: [], devoluciones: [],
    tab: 'activos', rango: '12m', desde: null, hasta: null, lineaMax: 80,
  };

  // ── Permisos (misma regla que Clientes / Créditos) ────────
  function permisos() {
    let pf = null, rest = null;
    try { pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); } catch (_) {}
    if (!pf || pf.tipo === 'admin') return { clientes: true, creditos: true };
    try { rest = JSON.parse(sessionStorage.getItem('n360_sucursal_modulos') || 'null'); } catch (_) {}
    const mods = new Set(pf.modulos || []);
    const ok = k => mods.has(k) && (!Array.isArray(rest) || rest.includes(k));
    return { clientes: ok('clientes'), creditos: ok('creditos') };
  }

  // ── Carga (solo lectura) ──────────────────────────────────
  async function enLotes(tabla, columna, ids, select, extra) {
    const out = [];
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150);
      const filas = await TX.paginar(() => { let q = sb.from(tabla).select(select).eq('auth_user_id', TX.userId).in(columna, lote); return extra ? extra(q) : q; });
      out.push(...filas);
    }
    return out;
  }
  async function cargar() {
    const { data: cl, error } = await sb.from('clientes').select('*').eq('id', CH.id).eq('auth_user_id', TX.userId).maybeSingle();
    if (error) throw error;
    if (!cl) return false;
    CH.cliente = cl;
    const tareas = [
      TX.paginar(() => sb.from('ventas').select('id,numero_venta,numero_factura,fecha,created_at,total,estado,estado_pago,metodo_pago,metodo_pago_nombre')
        .eq('auth_user_id', TX.userId).eq('cliente_id', CH.id).order('created_at', { ascending: false })).then(v => { CH.ventas = v; }),
      TX.paginar(() => sb.from('fiados').select('*').eq('auth_user_id', TX.userId).eq('cliente_id', CH.id).order('created_at', { ascending: false }))
        .then(f => { CH.fiados = f.filter(x => !x.eliminado_at && x.estado !== 'eliminado'); }).catch(() => { CH.fiados = []; }),
    ];
    if (CH.verCreditos) {
      tareas.push(TX.paginar(() => sb.from('creditos').select('*').eq('auth_user_id', TX.userId).eq('cliente_id', CH.id).order('created_at', { ascending: false }))
        .then(c => { CH.creditos = c; }));
    }
    // CRM: notas/llamadas/mensajes, cotizaciones y citas (solo se muestran en la línea de tiempo; si falla, no se muestran)
    const opcional = (consulta, k) => TX.paginar(consulta).then(r => { CH[k] = r; }).catch(() => { CH[k] = []; });
    tareas.push(
      opcional(() => sb.from('cliente_interacciones').select('id,tipo,fecha,titulo,descripcion,created_at').eq('auth_user_id', TX.userId).eq('cliente_id', CH.id).order('fecha', { ascending: false }), 'interacciones'),
      opcional(() => sb.from('proformas').select('id,numero_proforma,fecha,created_at,total,estado').eq('auth_user_id', TX.userId).eq('cliente_id', CH.id).order('created_at', { ascending: false }), 'proformas'),
      opcional(() => sb.from('agenda_citas').select('id,fecha,estado,notas,created_at').eq('auth_user_id', TX.userId).eq('cliente_id', CH.id).order('fecha', { ascending: false }), 'citas'));
    await Promise.all(tareas);
    const idsCred = CH.creditos.map(c => c.id);
    const idsFiado = CH.fiados.map(f => f.id);
    const idsVenta = CH.ventas.map(v => v.id);
    const [cuotas, pagos, eventos, fpagos, devs] = await Promise.all([
      idsCred.length ? enLotes('creditos_cuotas', 'credito_id', idsCred, '*', q => q.order('numero')) : [],
      idsCred.length ? enLotes('creditos_pagos', 'credito_id', idsCred, '*') : [],
      idsCred.length ? enLotes('creditos_historial', 'credito_id', idsCred, 'id,credito_id,tipo_evento,descripcion,created_at').catch(() => []) : [],
      idsFiado.length ? enLotes('fiado_pagos', 'fiado_id', idsFiado, '*').catch(() => []) : [],
      idsVenta.length ? enLotes('devoluciones_venta', 'venta_id', idsVenta, 'id,numero,venta_id,fecha,created_at,total,motivo,estado').catch(() => []) : [],
    ]);
    CH.cuotas = {}; cuotas.forEach(q => (CH.cuotas[q.credito_id] = CH.cuotas[q.credito_id] || []).push(q));
    Object.values(CH.cuotas).forEach(l => l.sort((a, b) => a.numero - b.numero));
    CH.pagos = pagos.sort((a, b) => String(b.fecha || b.created_at).localeCompare(String(a.fecha || a.created_at)));
    CH.eventos = {}; eventos.forEach(e => (CH.eventos[e.credito_id] = CH.eventos[e.credito_id] || []).push(e));
    CH.fiadoPagos = fpagos;
    CH.devoluciones = devs;
    return true;
  }

  // ── Cálculos ──────────────────────────────────────────────
  const pendienteCuota = q => r2(Math.max(0, Number(q.monto_total || 0) - Number(q.monto_pagado || 0)));
  const cuotasDe = c => CH.cuotas[c.id] || [];
  const anulado = c => c.estado === 'cancelado' && (CH.eventos[c.id] || []).some(e => e.tipo_evento === 'anulado');
  const activo = c => c.estado !== 'cancelado';
  const pendientes = c => cuotasDe(c).filter(q => q.estado !== 'pagada' && pendienteCuota(q) > 0.005);
  const vencidas = c => activo(c) ? pendientes(c).filter(q => dia(q.fecha_vencimiento) < hoy()) : [];
  const proxima = c => activo(c) ? pendientes(c)[0] || null : null;
  const pagosDe = c => CH.pagos.filter(p => p.credito_id === c.id);
  const pagadoDe = c => anulado(c) ? r2(pagosDe(c).filter(p => p.estado !== 'anulado').reduce((s, p) => s + Number(p.monto || 0), 0))
    : r2(Math.max(0, Number(c.total_financiado || 0) - (activo(c) ? Number(c.saldo_pendiente || 0) : 0)));
  const avance = c => { const t = Number(c.total_financiado || 0); return t > 0 ? Math.min(100, Math.max(0, Math.round(100 * pagadoDe(c) / t))) : 0; };
  const vence = c => { const l = cuotasDe(c); return l.length ? l[l.length - 1].fecha_vencimiento : null; };
  const diasEntre = (a, b) => Math.round((new Date(dia(b) + 'T12:00:00') - new Date(dia(a) + 'T12:00:00')) / 86400000);
  const fiadoActivo = f => f.estado !== 'pagado' && Number(f.saldo || 0) > 0.005;
  function estadoCredito(c) {
    if (c.estado === 'cancelado') return anulado(c) ? { t: 'Anulado', cls: 'gris' } : { t: 'Pagado', cls: 'verde' };
    const v = vencidas(c);
    if (v.length) return { t: `Atrasado ${diasEntre(v[0].fecha_vencimiento, hoy())} día(s)`, cls: 'rojo' };
    const p = proxima(c);
    if (p && diasEntre(hoy(), p.fecha_vencimiento) <= 7) return { t: 'Vence pronto', cls: 'amarillo' };
    return { t: 'Al día', cls: 'verde' };
  }
  function resumen() {
    const act = CH.creditos.filter(activo);
    const debeCred = r2(act.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0));
    const debeFiado = r2(CH.fiados.filter(fiadoActivo).reduce((s, f) => s + Number(f.saldo || 0), 0));
    const pagosCred = r2(CH.pagos.filter(p => p.estado !== 'anulado').reduce((s, p) => s + Number(p.monto || 0), 0));
    const primas = r2(CH.creditos.filter(c => !anulado(c)).reduce((s, c) => s + Number(c.prima_monto || 0), 0));
    const pagosFiado = r2(CH.fiadoPagos.reduce((s, p) => s + Number(p.monto || 0), 0));
    const venc = act.flatMap(vencidas);
    const vencido = r2(venc.reduce((s, q) => s + pendienteCuota(q), 0));
    const masVieja = venc.map(q => dia(q.fecha_vencimiento)).sort()[0] || null;
    const proximas = act.map(proxima).filter(Boolean).sort((a, b) => dia(a.fecha_vencimiento).localeCompare(dia(b.fecha_vencimiento)));
    const limite = Number(CH.cliente.limite_credito || 0);
    const debe = r2(debeCred + debeFiado);
    return { debe, debeCred, debeFiado, pagado: r2(pagosCred + primas + pagosFiado), primas, vencido, cuotasVencidas: venc.length,
      diasAtraso: masVieja ? diasEntre(masVieja, hoy()) : 0, proxima: proximas[0] || null, limite, disponible: limite > 0 ? r2(limite - debe) : null,
      activos: act.length };
  }

  // ── Pantalla ──────────────────────────────────────────────
  const iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  function render() {
    const c = CH.cliente, R = CH.verCreditos ? resumen() : null;
    const nombre = `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Cliente';
    let estadoTxt, estadoCls;
    if (!R) { estadoTxt = 'Solo compras (no tienes acceso a Créditos)'; estadoCls = 'gris'; }
    else if (R.vencido > 0) { estadoTxt = `Atrasado ${R.diasAtraso} día(s) · ${money(R.vencido)} vencido en ${R.cuotasVencidas} cuota(s)`; estadoCls = 'rojo'; }
    else if (R.proxima) { estadoTxt = `Al día · próximo pago ${money(pendienteCuota(R.proxima))} el ${fecha(R.proxima.fecha_vencimiento)}`; estadoCls = 'verde'; }
    else if (R.debe > 0) { estadoTxt = `Debe ${money(R.debe)} en fiados`; estadoCls = 'amarillo'; }
    else { estadoTxt = 'Sin deudas pendientes'; estadoCls = 'verde'; }
    const usoPct = R && R.limite > 0 ? Math.min(100, Math.round(100 * R.debe / R.limite)) : 0;
    const tabs = [
      ...(R ? [['activos', `Créditos activos (${R.activos})`], ['pagos', 'Pagos'], ['cerrados', 'Créditos cerrados']] : []),
      ['fiados', 'Fiados'], ['compras', 'Compras'], ['linea', 'Línea de tiempo'], ['reporte', 'Reporte'],
    ];
    if (!tabs.some(t => t[0] === CH.tab)) CH.tab = tabs[0][0];
    $('ch-app').innerHTML = `
      <div class="ch-cab">
        <a class="tx-btn tx-btn-sm" href="clientes.html">← Clientes</a>
        <div class="ch-cliente">
          <div class="ch-avatar">${esc(iniciales(nombre))}</div>
          <div class="ch-cliente-info">
            <h1>${esc(nombre)}</h1>
            <div class="ch-sub">${[c.telefono || c.whatsapp, c.empresa, c.created_at ? 'Cliente desde ' + fecha(c.created_at) : ''].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
        </div>
        <div class="ch-cab-acc">
          <button type="button" class="tx-btn tx-btn-primary" id="ch-pdf">📄 Estado de cuenta</button>
          <button type="button" class="tx-btn" id="ch-csv">⬇ Pagos (Excel)</button>
        </div>
      </div>
      <div class="ch-estado ch-${estadoCls}"><span class="ch-punto"></span>${esc(estadoTxt)}</div>
      ${R ? `<div class="ch-kpis">
        <div class="ch-kpi ch-kpi-debe"><span>💰 Debe hoy</span><b>${esc(money(R.debe))}</b><small>${R.debeFiado > 0 ? `Créditos ${esc(money(R.debeCred))} · Fiados ${esc(money(R.debeFiado))}` : `${R.activos} crédito(s) activo(s)`}</small></div>
        <div class="ch-kpi ch-kpi-pago"><span>✅ Ya pagó</span><b>${esc(money(R.pagado))}</b><small>Abonos${R.primas > 0 ? ' y primas' : ''} a créditos y fiados</small></div>
        <div class="ch-kpi ${R.vencido > 0 ? 'ch-kpi-venc' : 'ch-kpi-ok'}"><span>⚠️ Vencido</span><b>${esc(money(R.vencido))}</b><small>${R.vencido > 0 ? `Desde hace ${R.diasAtraso} día(s)` : 'Nada atrasado'}</small></div>
        <div class="ch-kpi ch-kpi-disp"><span>💳 Crédito disponible</span><b>${R.disponible == null ? 'Sin límite' : esc(money(Math.max(0, R.disponible)))}</b>
          ${R.limite > 0 ? `<div class="ch-barra ${usoPct >= 90 ? 'rojo' : usoPct >= 70 ? 'amarillo' : ''}"><i style="width:${usoPct}%"></i></div><small>Usa ${usoPct}% de su límite de ${esc(money(R.limite))}${R.disponible < 0 ? ' · ¡sobrepasado!' : ''}</small>` : '<small>No tiene límite de crédito configurado</small>'}</div>
      </div>` : ''}
      <nav class="ch-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" class="ch-tab${CH.tab === k ? ' on' : ''}" data-ch-tab="${k}" aria-selected="${CH.tab === k}">${esc(t)}</button>`).join('')}</nav>
      <div id="ch-tab-cuerpo" class="ch-tab-cuerpo"></div>`;
    pintarTab();
  }
  function pintarTab() {
    const f = { activos: tActivos, pagos: tPagos, cerrados: tCerrados, fiados: tFiados, compras: tCompras, linea: tLinea, reporte: tReporte }[CH.tab];
    $('ch-tab-cuerpo').innerHTML = f ? f() : '';
    document.querySelectorAll('.ch-tab').forEach(b => { b.classList.toggle('on', b.dataset.chTab === CH.tab); b.setAttribute('aria-selected', String(b.dataset.chTab === CH.tab)); });
  }
  const vacio = (ico, t, d) => `<div class="ch-vacio"><div class="ch-vacio-i">${ico}</div><b>${esc(t)}</b>${d ? `<p>${esc(d)}</p>` : ''}</div>`;
  const chip = (t, cls) => `<span class="ch-chip ${cls}">${esc(t)}</span>`;

  function tarjetaCredito(c) {
    const e = estadoCredito(c), pct = avance(c), p = proxima(c);
    const modal = c.modalidad_pago === 'fecha_fija' ? 'Un solo pago a fecha fija' : textoCuotas(cuotasDe(c).length || c.num_cuotas || 0, c.frecuencia);
    return `<button type="button" class="ch-cred" data-ch-credito="${esc(c.id)}">
      <div class="ch-cred-top"><b>${esc(c.numero_credito || 'Crédito')}</b>${chip(e.t, e.cls)}</div>
      <div class="ch-cred-sub">${c.tipo === 'venta' ? '🛒 Venta a crédito' : '💵 Préstamo'} · ${esc(fecha(c.fecha_inicio || c.created_at))} · ${esc(modal)}</div>
      <div class="ch-cred-nums">
        <div><span>Total</span><b>${esc(money(c.total_financiado))}</b></div>
        <div><span>${anulado(c) ? 'Abonado' : 'Pagado'}</span><b class="verde">${esc(money(pagadoDe(c)))}</b></div>
        <div><span>Saldo</span><b class="${activo(c) && Number(c.saldo_pendiente) > 0 ? 'rojo' : ''}">${esc(money(activo(c) ? c.saldo_pendiente : 0))}</b></div>
      </div>
      ${anulado(c) ? '' : `<div class="ch-barra ${e.cls === 'rojo' ? 'rojo' : ''}"><i style="width:${pct}%"></i></div><div class="ch-cred-pie"><span>${pct}% pagado</span>`}
      ${anulado(c) ? '<div class="ch-cred-pie"><span>Crédito anulado</span>' : ''}
      <span>${p ? `Próxima: ${esc(fecha(p.fecha_vencimiento))} · ${esc(money(pendienteCuota(p)))}` : (activo(c) ? '' : (vence(c) ? 'Cerrado' : ''))}</span></div>
      <span class="ch-ver">Ver detalle →</span>
    </button>`;
  }
  function tActivos() {
    const l = CH.creditos.filter(activo);
    const fi = CH.fiados.filter(fiadoActivo);
    return (l.length ? `<div class="ch-grid-cred">${l.map(tarjetaCredito).join('')}</div>` : vacio('🎉', 'No tiene créditos activos', 'Cuando tenga un crédito pendiente aparecerá aquí con su avance.'))
      + (fi.length ? `<h3 class="ch-h3">Fiados pendientes</h3>${listaFiados(fi)}` : '');
  }
  function tCerrados() {
    const l = CH.creditos.filter(c => !activo(c));
    return l.length ? `<div class="ch-grid-cred">${l.map(tarjetaCredito).join('')}</div>` : vacio('📁', 'Aún no tiene créditos cerrados');
  }
  function todosLosPagos() {
    const num = id => CH.creditos.find(c => c.id === id)?.numero_credito || 'Crédito';
    return [
      ...CH.pagos.map(p => ({ fecha: p.fecha || p.created_at, monto: p.monto, metodo: p.metodo_pago_nombre, recibo: p.comprobante_numero, ref: num(p.credito_id), creditoId: p.credito_id,
        anulado: p.estado === 'anulado', motivo: p.anulado_motivo, saldo: p.saldo_nuevo, tipo: 'Crédito' })),
      ...CH.fiadoPagos.map(p => ({ fecha: p.created_at, monto: p.monto, metodo: p.metodo_pago_nombre, recibo: '', ref: 'Fiado', saldo: p.saldo_nuevo, tipo: 'Fiado' })),
    ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }
  function filaPago(p) {
    return `<div class="ch-pago${p.anulado ? ' anulado' : ''}">
      <div class="ch-pago-ico">${p.anulado ? '↩️' : '✅'}</div>
      <div class="ch-pago-info"><b>${esc(money(p.monto))}</b><small>${esc(fecha(p.fecha))} · ${esc(p.metodo || '—')}${p.recibo ? ' · Recibo ' + esc(p.recibo) : ''}</small>
        ${p.anulado ? `<small class="rojo">Pago anulado${p.motivo ? ': ' + esc(p.motivo) : ''}</small>` : ''}</div>
      <div class="ch-pago-der">${p.creditoId ? `<button type="button" class="ch-link" data-ch-credito="${esc(p.creditoId)}">${esc(p.ref)}</button>` : `<span>${esc(p.ref)}</span>`}
        ${p.saldo != null ? `<small>Quedó debiendo ${esc(money(p.saldo))}</small>` : ''}</div>
    </div>`;
  }
  function tPagos() {
    const l = todosLosPagos();
    if (!l.length) return vacio('🧾', 'Aún no ha hecho pagos');
    const tot = r2(l.filter(p => !p.anulado).reduce((s, p) => s + Number(p.monto || 0), 0));
    return `<div class="ch-total-linea">${l.filter(p => !p.anulado).length} pago(s) · total ${esc(money(tot))}</div><div class="ch-lista">${l.map(filaPago).join('')}</div>`;
  }
  function listaFiados(l) {
    return `<div class="ch-lista">${l.map(f => {
      const pag = CH.fiadoPagos.filter(p => p.fiado_id === f.id);
      const act = fiadoActivo(f);
      return `<div class="ch-fiado">
        <div class="ch-fiado-top"><b>${esc(f.descripcion || 'Fiado')}</b>${chip(act ? 'Pendiente' : 'Pagado', act ? 'amarillo' : 'verde')}</div>
        <small>${esc(fecha(f.fecha || f.created_at))}${f.creado_por_nombre ? ' · por ' + esc(f.creado_por_nombre) : ''}</small>
        <div class="ch-cred-nums"><div><span>Total</span><b>${esc(money(f.monto_total))}</b></div><div><span>Pagado</span><b class="verde">${esc(money(f.monto_pagado))}</b></div><div><span>Saldo</span><b class="${act ? 'rojo' : ''}">${esc(money(f.saldo))}</b></div></div>
        ${pag.length ? `<details><summary>${pag.length} abono(s)</summary>${pag.map(p => `<div class="ch-mini-fila"><span>${esc(fecha(p.created_at))} · ${esc(p.metodo_pago_nombre || '—')}</span><b>${esc(money(p.monto))}</b></div>`).join('')}</details>` : ''}
      </div>`;
    }).join('')}</div>`;
  }
  function tFiados() { return CH.fiados.length ? listaFiados(CH.fiados) : vacio('📒', 'No tiene fiados'); }
  function tCompras() {
    if (!CH.ventas.length) return vacio('🛍️', 'Aún no tiene compras registradas');
    const val = CH.ventas.filter(v => v.estado !== 'anulada');
    const tot = r2(val.reduce((s, v) => s + Number(v.total || 0), 0));
    const cred = val.filter(v => v.estado_pago === 'credito').length;
    return `<div class="ch-total-linea">${val.length} compra(s) · total ${esc(money(tot))}${cred ? ` · ${cred} a crédito` : ''}</div>
      <div class="ch-lista">${CH.ventas.map(v => `<div class="ch-pago${v.estado === 'anulada' ? ' anulado' : ''}">
        <div class="ch-pago-ico">${v.estado === 'anulada' ? '✖️' : v.estado_pago === 'credito' ? '🧾' : '🛒'}</div>
        <div class="ch-pago-info"><b>${esc(money(v.total))}</b><small>${esc(fecha(v.fecha || v.created_at))} · ${esc(v.numero_venta || v.numero_factura || 'Venta')}</small></div>
        <div class="ch-pago-der">${v.estado === 'anulada' ? chip('Anulada', 'gris') : v.estado_pago === 'credito' ? chip('A crédito', 'amarillo') : chip(v.metodo_pago_nombre || 'Contado', 'verde')}</div>
      </div>`).join('')}</div>`;
  }
  function eventosLinea() {
    const ev = [];
    CH.ventas.forEach(v => ev.push({ f: v.created_at || v.fecha, ico: v.estado === 'anulada' ? '✖️' : '🛒', t: `${v.estado === 'anulada' ? 'Compra anulada' : 'Compra'} ${v.numero_venta || ''}`, m: v.total, cls: v.estado === 'anulada' ? 'gris' : '' }));
    if (CH.verCreditos) {
      CH.creditos.forEach(c => {
        ev.push({ f: c.created_at, ico: '🧾', t: `Crédito ${c.numero_credito || ''} otorgado`, m: c.total_financiado, credito: c.id });
        (CH.eventos[c.id] || []).filter(e => ['editado', 'desembolso', 'anulado', 'cancelado'].includes(e.tipo_evento)).forEach(e =>
          ev.push({ f: e.created_at, ico: e.tipo_evento === 'cancelado' ? '🏁' : e.tipo_evento === 'anulado' ? '⛔' : '✏️', t: `${c.numero_credito || 'Crédito'}: ${e.descripcion || e.tipo_evento}`, credito: c.id, cls: e.tipo_evento === 'anulado' ? 'gris' : '' }));
      });
      CH.pagos.forEach(p => ev.push({ f: p.created_at || p.fecha, ico: p.estado === 'anulado' ? '↩️' : '✅', t: `${p.estado === 'anulado' ? 'Pago anulado' : 'Pago'} a ${CH.creditos.find(c => c.id === p.credito_id)?.numero_credito || 'crédito'}`, m: p.monto, credito: p.credito_id, cls: p.estado === 'anulado' ? 'gris' : 'verde' }));
    }
    CH.fiados.forEach(f => ev.push({ f: f.created_at || f.fecha, ico: '📒', t: `Fiado: ${f.descripcion || ''}`, m: f.monto_total }));
    CH.fiadoPagos.forEach(p => ev.push({ f: p.created_at, ico: '✅', t: 'Abono a fiado', m: p.monto, cls: 'verde' }));
    const ICO_INT = { llamada: '📞', visita: '🚗', reunion: '🤝', mensaje: '💬', correo: '✉️', cotizacion: '📄', reclamo: '⚠️', otro: '📝' };
    (CH.interacciones || []).forEach(i => ev.push({ f: i.fecha || i.created_at, ico: ICO_INT[i.tipo] || '📝', t: [i.titulo || 'Nota', i.descripcion].filter(Boolean).join(': ').slice(0, 160) }));
    const EST_PRO = { aceptada: 'aceptada', convertida: 'convertida en venta', rechazada: 'rechazada', perdida: 'perdida', vencida: 'vencida' };
    (CH.proformas || []).forEach(p => ev.push({ f: p.created_at || p.fecha, ico: '📄', t: `Cotización ${p.numero_proforma || ''}${EST_PRO[p.estado] ? ' (' + EST_PRO[p.estado] + ')' : ''}`, m: p.total, cls: ['rechazada', 'perdida', 'anulada'].includes(p.estado) ? 'gris' : '' }));
    (CH.citas || []).forEach(c => ev.push({ f: c.fecha || c.created_at, ico: '📅', t: `Cita${c.estado ? ' (' + String(c.estado).replace(/_/g, ' ') + ')' : ''}${c.notas ? ': ' + String(c.notas).slice(0, 80) : ''}`, cls: ['cancelada', 'no_asistio'].includes(c.estado) ? 'gris' : '' }));
    CH.devoluciones.forEach(d => ev.push({ f: d.created_at || d.fecha, ico: '↩️', t: `Devolución ${d.numero || ''}${d.motivo ? ': ' + d.motivo : ''}`, m: d.total }));
    return ev.filter(e => e.f).sort((a, b) => String(b.f).localeCompare(String(a.f)));
  }
  function tLinea() {
    const ev = eventosLinea();
    if (!ev.length) return vacio('🕑', 'Sin movimientos todavía');
    const vis = ev.slice(0, CH.lineaMax);
    let mesAnt = '';
    return `<div class="ch-linea">${vis.map(e => {
      const mes = new Date(dia(e.f) + 'T12:00:00').toLocaleDateString('es-NI', { month: 'long', year: 'numeric' });
      const cab = mes !== mesAnt ? `<div class="ch-linea-mes">${esc(mes)}</div>` : ''; mesAnt = mes;
      return `${cab}<div class="ch-linea-it ${e.cls || ''}"><div class="ch-linea-ico">${e.ico}</div>
        <div class="ch-linea-txt"><b>${esc(e.t)}</b><small>${esc(fecha(e.f))}</small></div>
        <div class="ch-linea-der">${e.m != null ? `<b>${esc(money(e.m))}</b>` : ''}${e.credito ? `<button type="button" class="ch-link" data-ch-credito="${esc(e.credito)}">Ver</button>` : ''}</div></div>`;
    }).join('')}</div>${ev.length > CH.lineaMax ? `<button type="button" class="tx-btn ch-mas" id="ch-linea-mas">Ver ${Math.min(80, ev.length - CH.lineaMax)} más</button>` : ''}`;
  }

  // ── Reporte ───────────────────────────────────────────────
  function rangoFechas() {
    const h = hoy(), d = new Date(h + 'T12:00:00');
    if (CH.rango === 'mes') return [h.slice(0, 8) + '01', h];
    if (CH.rango === 'anio') return [h.slice(0, 4) + '-01-01', h];
    if (CH.rango === 'todo') return ['1900-01-01', h];
    if (CH.rango === 'rango' && CH.desde && CH.hasta) return [CH.desde, CH.hasta];
    const ini = new Date(d); ini.setMonth(ini.getMonth() - 11); ini.setDate(1);
    return [TX.ymd(ini), h];
  }
  function tReporte() {
    const [d, h] = rangoFechas(), en = f => dia(f) >= d && dia(f) <= h;
    const compras = CH.ventas.filter(v => v.estado !== 'anulada' && en(v.fecha || v.created_at));
    const totCompras = r2(compras.reduce((s, v) => s + Number(v.total || 0), 0));
    const pagos = todosLosPagos().filter(p => !p.anulado && en(p.fecha));
    const totPagos = r2(pagos.reduce((s, p) => s + Number(p.monto || 0), 0));
    const creds = CH.creditos.filter(c => en(c.fecha_inicio || c.created_at));
    // Últimos 12 meses (o los meses del rango, máx. 12)
    const fin = new Date(h + 'T12:00:00'), meses = [];
    for (let i = 11; i >= 0; i--) { const x = new Date(fin.getFullYear(), fin.getMonth() - i, 1); const k = TX.ymd(x).slice(0, 7); if (k >= d.slice(0, 7)) meses.push(k); }
    const porMes = (lista, campoF, campoM) => meses.map(m => r2(lista.filter(x => dia(x[campoF]).slice(0, 7) === m).reduce((s, x) => s + Number(x[campoM] || 0), 0)));
    const mc = porMes(CH.ventas.filter(v => v.estado !== 'anulada').map(v => ({ f: v.fecha || v.created_at, m: v.total })), 'f', 'm');
    const mp = porMes(todosLosPagos().filter(p => !p.anulado).map(p => ({ f: p.fecha, m: p.monto })), 'f', 'm');
    const max = Math.max(1, ...mc, ...mp);
    const todasCuotas = CH.creditos.filter(c => !anulado(c)).flatMap(cuotasDe);
    const pagadas = todasCuotas.filter(q => q.estado === 'pagada').length;
    const ultCompra = CH.ventas.find(v => v.estado !== 'anulada'), ultPago = todosLosPagos().find(p => !p.anulado);
    const nm = m => new Date(m + '-15T12:00:00').toLocaleDateString('es-NI', { month: 'short' });
    return `<div class="ch-rangos">
        ${[['12m', 'Últimos 12 meses'], ['anio', 'Este año'], ['mes', 'Este mes'], ['todo', 'Todo'], ['rango', 'Elegir fechas']].map(([k, t]) => `<button type="button" class="ch-rango${CH.rango === k ? ' on' : ''}" data-ch-rango="${k}">${t}</button>`).join('')}
        ${CH.rango === 'rango' ? `<div class="ch-fechas"><input type="date" class="tx-in" id="ch-desde" value="${esc(CH.desde || '')}" aria-label="Desde" /><input type="date" class="tx-in" id="ch-hasta" value="${esc(CH.hasta || '')}" aria-label="Hasta" /><button type="button" class="tx-btn tx-btn-sm" id="ch-aplicar">Ver</button></div>` : ''}
      </div>
      <div class="ch-kpis ch-kpis-rep">
        <div class="ch-kpi"><span>🛒 Compró</span><b>${esc(money(totCompras))}</b><small>${compras.length} compra(s) · promedio ${esc(money(compras.length ? totCompras / compras.length : 0))}</small></div>
        ${CH.verCreditos ? `<div class="ch-kpi"><span>✅ Pagó</span><b>${esc(money(totPagos))}</b><small>${pagos.length} pago(s) a créditos y fiados</small></div>
        <div class="ch-kpi"><span>🧾 Créditos nuevos</span><b>${creds.length}</b><small>por ${esc(money(creds.reduce((s, c) => s + Number(c.total_financiado || 0), 0)))}</small></div>
        <div class="ch-kpi"><span>📅 Cuotas</span><b>${pagadas} / ${todasCuotas.length}</b><small>pagadas de todos sus créditos</small></div>` : ''}
      </div>
      <div class="ch-card"><h3 class="ch-h3">Compras${CH.verCreditos ? ' y pagos' : ''} por mes</h3>
        <div class="ch-graf" style="--n:${meses.length}">${meses.map((m, i) => `<div class="ch-graf-col" title="${esc(nm(m))}: compras ${esc(money(mc[i]))}${CH.verCreditos ? ', pagos ' + esc(money(mp[i])) : ''}">
          <div class="ch-graf-barras"><i class="c" style="height:${(100 * mc[i] / max).toFixed(1)}%"></i>${CH.verCreditos ? `<i class="p" style="height:${(100 * mp[i] / max).toFixed(1)}%"></i>` : ''}</div><small>${esc(nm(m))}</small></div>`).join('')}</div>
        <div class="ch-ley"><span><i class="c"></i> Compras</span>${CH.verCreditos ? '<span><i class="p"></i> Pagos</span>' : ''}</div>
      </div>
      <div class="ch-card ch-datos">
        <div><span>Cliente desde</span><b>${esc(fecha(CH.cliente.created_at))}</b></div>
        <div><span>Última compra</span><b>${ultCompra ? esc(fecha(ultCompra.fecha || ultCompra.created_at)) : '—'}</b></div>
        ${CH.verCreditos ? `<div><span>Último pago</span><b>${ultPago ? esc(fecha(ultPago.fecha)) : '—'}</b></div>
        <div><span>Créditos en total</span><b>${CH.creditos.length}</b></div>` : ''}
      </div>`;
  }

  // ── Detalle de un crédito (aquí mismo, solo lectura) ──────
  const cacheDetalle = {};
  async function abrirCredito(id) {
    const c = CH.creditos.find(x => x.id === id); if (!c) return;
    $('ch-panel-titulo').textContent = `Crédito ${c.numero_credito || ''}`;
    $('ch-panel-cuerpo').innerHTML = '<div class="ch-cargando">Cargando…</div>';
    $('ch-panel').hidden = false; $('ch-panel-fondo').hidden = false;
    requestAnimationFrame(() => { $('ch-panel').classList.add('abierto'); $('ch-panel-fondo').classList.add('abierto'); });
    document.body.style.overflow = 'hidden';
    try { history.replaceState(null, '', `?id=${encodeURIComponent(CH.id)}&credito=${encodeURIComponent(id)}`); } catch (_) {}
    if (!cacheDetalle[id]) {
      try {
        if (c.venta_id) {
          const { data } = await sb.from('venta_detalles').select('producto_nombre,cantidad,precio,subtotal').eq('venta_id', c.venta_id).order('created_at');
          cacheDetalle[id] = { items: (data || []).map(d => ({ n: String(d.producto_nombre || 'Ítem').split('\n')[0], cant: d.cantidad, sub: d.subtotal != null ? d.subtotal : Number(d.cantidad) * Number(d.precio) })) };
        } else {
          let concepto = 'Préstamo / financiamiento';
          if (c.producto_financiero_id) { const { data } = await sb.from('productos').select('nombre').eq('id', c.producto_financiero_id).eq('auth_user_id', TX.userId).maybeSingle(); if (data?.nombre) concepto = data.nombre; }
          cacheDetalle[id] = { items: [{ n: concepto, cant: 1, sub: c.monto_original || c.capital_financiado }] };
        }
      } catch (_) { cacheDetalle[id] = { items: [] }; }
    }
    if (!$('ch-panel').hidden) $('ch-panel-cuerpo').innerHTML = htmlDetalle(c, cacheDetalle[id]);
  }
  function cerrarCredito() {
    $('ch-panel').classList.remove('abierto'); $('ch-panel-fondo').classList.remove('abierto');
    setTimeout(() => { $('ch-panel').hidden = true; $('ch-panel-fondo').hidden = true; }, 220);
    document.body.style.overflow = '';
    try { history.replaceState(null, '', `?id=${encodeURIComponent(CH.id)}`); } catch (_) {}
  }
  function htmlDetalle(c, det) {
    const e = estadoCredito(c), pct = avance(c), cuotas = cuotasDe(c), pagos = pagosDe(c), p = proxima(c), v = vencidas(c);
    const ev = (CH.eventos[c.id] || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const fin = vence(c), plazo = fin ? diasEntre(c.fecha_inicio || c.created_at, fin) : null;
    const modal = c.modalidad_pago === 'fecha_fija' ? 'Un solo pago a fecha fija' : textoCuotas(cuotas.length || c.num_cuotas || 0, c.frecuencia);
    let queSigue;
    if (anulado(c)) queSigue = `<div class="ch-sigue gris">⛔ Este crédito fue anulado.</div>`;
    else if (!activo(c)) queSigue = `<div class="ch-sigue verde">🏁 ¡Crédito pagado por completo!</div>`;
    else if (v.length) queSigue = `<div class="ch-sigue rojo">⚠️ Tiene ${v.length} cuota(s) vencida(s) por ${esc(money(v.reduce((s, q) => s + pendienteCuota(q), 0)))}. La más antigua venció el ${esc(fecha(v[0].fecha_vencimiento))} (hace ${diasEntre(v[0].fecha_vencimiento, hoy())} día(s)).</div>`;
    else if (p) queSigue = `<div class="ch-sigue azul">📅 Próximo pago: <b>${esc(money(pendienteCuota(p)))}</b> el <b>${esc(fecha(p.fecha_vencimiento))}</b> (${diasEntre(hoy(), p.fecha_vencimiento) === 0 ? 'hoy' : 'en ' + diasEntre(hoy(), p.fecha_vencimiento) + ' día(s)'}).</div>`;
    else queSigue = '';
    const estadoCuota = q => {
      const pen = pendienteCuota(q);
      if (q.estado === 'pagada' || pen <= 0.005) return chip('Pagada', 'verde');
      if (dia(q.fecha_vencimiento) < hoy() && activo(c)) return chip(`Vencida · ${diasEntre(q.fecha_vencimiento, hoy())} d`, 'rojo');
      if (Number(q.monto_pagado) > 0) return chip('Parcial', 'amarillo');
      return chip('Pendiente', 'gris');
    };
    return `
      <div class="ch-det-top">${chip(e.t, e.cls)} <span class="ch-sub">${c.tipo === 'venta' ? '🛒 Venta a crédito' : '💵 Préstamo'} · ${esc(fecha(c.fecha_inicio || c.created_at))}</span></div>
      ${anulado(c) ? '' : `<div class="ch-det-avance"><div class="ch-det-pct">${pct}%<small>pagado</small></div>
        <div class="ch-det-avance-der"><div class="ch-barra grande ${e.cls === 'rojo' ? 'rojo' : ''}"><i style="width:${pct}%"></i></div>
        <div class="ch-det-avance-nums"><span>Pagado <b class="verde">${esc(money(pagadoDe(c)))}</b></span><span>Falta <b class="${activo(c) ? 'rojo' : ''}">${esc(money(activo(c) ? c.saldo_pendiente : 0))}</b></span></div></div></div>`}
      ${queSigue}
      <h3 class="ch-h3">Resumen</h3>
      <div class="ch-det-grid">
        <div><span>Monto original</span><b>${esc(money(c.monto_original || c.capital_financiado))}</b></div>
        ${Number(c.prima_monto) > 0 ? `<div><span>Prima / anticipo</span><b>${esc(money(c.prima_monto))}</b></div>` : ''}
        <div><span>Financiado</span><b>${esc(money(c.capital_financiado))}</b></div>
        ${Number(c.total_intereses) > 0 ? `<div><span>Intereses</span><b>${esc(money(c.total_intereses))}</b></div>` : ''}
        <div class="destacado"><span>Total a pagar</span><b>${esc(money(c.total_financiado))}</b></div>
        <div><span>Forma de pago</span><b>${esc(modal)}</b></div>
        ${fin ? `<div><span>Vence</span><b>${esc(fecha(fin))}</b></div>` : ''}
        ${plazo != null ? `<div><span>Plazo</span><b>${plazo} día(s)</b></div>` : ''}
        ${Number(c.tasa_interes) > 0 ? `<div><span>Tasa de interés</span><b>${esc(c.tasa_interes)}%</b></div>` : ''}
      </div>
      ${cuotas.length ? `<h3 class="ch-h3">Plan de pagos (${cuotas.filter(q => q.estado === 'pagada').length} de ${cuotas.length} pagadas)</h3>
        <div class="ch-cuotas">${cuotas.map(q => `<div class="ch-cuota"><div class="ch-cuota-n">#${esc(q.numero)}</div>
          <div class="ch-cuota-info"><b>${esc(money(q.monto_total))}</b><small>Vence ${esc(fecha(q.fecha_vencimiento))}${Number(q.monto_pagado) > 0 && pendienteCuota(q) > 0.005 ? ` · pagado ${esc(money(q.monto_pagado))}, falta ${esc(money(pendienteCuota(q)))}` : ''}</small></div>
          <div>${estadoCuota(q)}</div></div>`).join('')}</div>` : ''}
      <h3 class="ch-h3">Pagos de este crédito (${pagos.filter(x => x.estado !== 'anulado').length})</h3>
      ${pagos.length ? `<div class="ch-lista">${pagos.map(x => filaPago({ fecha: x.fecha || x.created_at, monto: x.monto, metodo: x.metodo_pago_nombre, recibo: x.comprobante_numero, ref: '', anulado: x.estado === 'anulado', motivo: x.anulado_motivo, saldo: x.saldo_nuevo })).join('')}</div>` : '<div class="ch-nota">Todavía no tiene pagos.</div>'}
      ${det?.items?.length ? `<h3 class="ch-h3">${c.venta_id ? 'Productos' : 'Concepto'}</h3><div class="ch-lista">${det.items.map(i => `<div class="ch-mini-fila"><span>${esc(i.n)}${Number(i.cant) !== 1 ? ` <small>× ${esc(Number(i.cant).toLocaleString('es-NI', { maximumFractionDigits: 3 }))}</small>` : ''}</span><b>${esc(money(i.sub))}</b></div>`).join('')}</div>` : ''}
      ${ev.length ? `<h3 class="ch-h3">Historial del crédito</h3><div class="ch-linea ch-linea-mini">${ev.map(x => `<div class="ch-linea-it"><div class="ch-linea-ico">${{ creado: '🧾', pago: '✅', pago_anulado: '↩️', anulado: '⛔', cancelado: '🏁', editado: '✏️', desembolso: '💵' }[x.tipo_evento] || '•'}</div>
        <div class="ch-linea-txt"><b>${esc(x.descripcion || x.tipo_evento)}</b><small>${esc(fecha(x.created_at))}</small></div></div>`).join('')}</div>` : ''}
      ${c.observaciones ? `<h3 class="ch-h3">Observaciones</h3><div class="ch-nota">${esc(c.observaciones)}</div>` : ''}
      <div class="ch-nota ch-nota-pie">Vista de solo lectura. Para cobrar o modificar este crédito usa el módulo Créditos.</div>`;
  }

  // ── Estado de cuenta (PDF) y pagos (CSV) ──────────────────
  async function logoDataUrl() {
    const url = TX.empresaConfig?.logo_principal_url || TX.empresaConfig?.logo_url;
    if (!url) return null;
    try {
      const r = await fetch(url, { mode: 'cors' }); if (!r.ok) return null;
      const b = await r.blob();
      return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); });
    } catch (_) { return null; }
  }
  async function estadoCuenta() {
    if (typeof window.jspdf?.jsPDF !== 'function') { TX.toast('No se pudo cargar el generador de PDF. Recarga la página.', 'error'); return; }
    const btn = $('ch-pdf'); btn.disabled = true;
    try {
      const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'letter' });
      const E = TX.empresaConfig || {}, c = CH.cliente, nombre = `${c.nombre || ''} ${c.apellido || ''}`.trim();
      const W = doc.internal.pageSize.getWidth(), M = 14;
      let y = 14;
      const logo = await logoDataUrl();
      let xTxt = M;
      if (logo) { try { doc.addImage(logo, M, y, 22, 22, undefined, 'FAST'); xTxt = M + 26; } catch (_) {} }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
      doc.text(E.nombre_comercial || 'Mi negocio', xTxt, y + 5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
      [E.ruc ? 'RUC: ' + E.ruc : '', E.telefono || E.whatsapp ? 'Tel: ' + (E.telefono || E.whatsapp) : '', E.direccion || ''].filter(Boolean).forEach((t, i) => doc.text(String(t), xTxt, y + 10 + i * 4.2));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 20, 20);
      doc.text('ESTADO DE CUENTA', W - M, y + 5, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
      doc.text(`Fecha: ${fecha(hoy())}`, W - M, y + 10, { align: 'right' });
      y += 28;
      doc.setDrawColor(220, 220, 220); doc.line(M, y, W - M, y); y += 6;
      doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text('CLIENTE', M, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 20); doc.text(nombre || 'Cliente', M, y + 5.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
      doc.text([c.telefono || c.whatsapp ? 'Tel: ' + (c.telefono || c.whatsapp) : '', c.ruc ? 'RUC: ' + c.ruc : '', c.direccion || ''].filter(Boolean).join('   ·   '), M, y + 10.5);
      y += 16;
      if (CH.verCreditos) {
        const R = resumen(), cajas = [['Debe hoy', money(R.debe)], ['Vencido', money(R.vencido)], ['Ya pagó', money(R.pagado)], ['Crédito disponible', R.disponible == null ? 'Sin límite' : money(Math.max(0, R.disponible))]];
        const bw = (W - 2 * M - 9) / 4;
        cajas.forEach(([t, v], i) => {
          const x = M + i * (bw + 3);
          doc.setFillColor(i === 1 && R.vencido > 0 ? 254 : 245, i === 1 && R.vencido > 0 ? 236 : 246, i === 1 && R.vencido > 0 ? 236 : 250);
          doc.roundedRect(x, y, bw, 17, 2, 2, 'F');
          doc.setFontSize(8); doc.setTextColor(100, 100, 110); doc.text(t, x + 3, y + 5.5);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(i === 1 && R.vencido > 0 ? 200 : 20, 20, 20); doc.text(String(v), x + 3, y + 12.5);
          doc.setFont('helvetica', 'normal');
        });
        y += 23;
        const act = CH.creditos.filter(activo);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 20, 20); doc.text('Créditos activos', M, y); y += 2;
        doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: { fillColor: [40, 44, 60] },
          head: [['Crédito', 'Fecha', 'Total', 'Pagado', 'Saldo', 'Próximo pago']],
          body: act.length ? act.map(cr => { const p = proxima(cr); return [cr.numero_credito || '', fecha(cr.fecha_inicio || cr.created_at), money(cr.total_financiado), money(pagadoDe(cr)), money(cr.saldo_pendiente), p ? `${fecha(p.fecha_vencimiento)} · ${money(pendienteCuota(p))}` : '—']; }) : [['Sin créditos activos', '', '', '', '', '']],
          columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } } });
        y = doc.lastAutoTable.finalY + 7;
        const pend = act.flatMap(cr => pendientes(cr).map(q => ({ cr, q }))).sort((a, b) => dia(a.q.fecha_vencimiento).localeCompare(dia(b.q.fecha_vencimiento)));
        if (pend.length) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Cuotas pendientes', M, y); y += 2;
          doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: { fillColor: [40, 44, 60] },
            head: [['Crédito', 'Cuota', 'Vence', 'Monto pendiente', 'Estado']],
            body: pend.map(({ cr, q }) => [cr.numero_credito || '', '#' + q.numero, fecha(q.fecha_vencimiento), money(pendienteCuota(q)), dia(q.fecha_vencimiento) < hoy() ? `Vencida (${diasEntre(q.fecha_vencimiento, hoy())} d)` : (Number(q.monto_pagado) > 0 ? 'Parcial' : 'Pendiente')]),
            columnStyles: { 3: { halign: 'right' } },
            didParseCell: d => { if (d.section === 'body' && d.column.index === 4 && String(d.cell.raw).startsWith('Vencida')) d.cell.styles.textColor = [200, 30, 30]; } });
          y = doc.lastAutoTable.finalY + 7;
        }
        const fiP = CH.fiados.filter(fiadoActivo);
        if (fiP.length) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Fiados pendientes', M, y); y += 2;
          doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: { fillColor: [40, 44, 60] },
            head: [['Fecha', 'Detalle', 'Total', 'Pagado', 'Saldo']], body: fiP.map(f => [fecha(f.fecha || f.created_at), f.descripcion || 'Fiado', money(f.monto_total), money(f.monto_pagado), money(f.saldo)]),
            columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } } });
          y = doc.lastAutoTable.finalY + 7;
        }
        const pg = todosLosPagos().slice(0, 25);
        if (pg.length) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Últimos pagos', M, y); y += 2;
          doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: { fillColor: [40, 44, 60] },
            head: [['Fecha', 'Aplicado a', 'Método', 'Recibo', 'Monto']], body: pg.map(p => [fecha(p.fecha), p.ref, p.metodo || '—', p.recibo || '', (p.anulado ? 'ANULADO ' : '') + money(p.monto)]),
            columnStyles: { 4: { halign: 'right' } } });
          y = doc.lastAutoTable.finalY + 7;
        }
      } else {
        doc.setFontSize(10); doc.text('Resumen de compras', M, y); y += 2;
        doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5 }, head: [['Fecha', 'Venta', 'Total']],
          body: CH.ventas.filter(v => v.estado !== 'anulada').slice(0, 40).map(v => [fecha(v.fecha || v.created_at), v.numero_venta || '', money(v.total)]) });
      }
      const n = doc.internal.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
        doc.text(`Documento informativo generado el ${fecha(hoy())}. No es recibo de pago.   Página ${i} de ${n}`, W / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
      }
      doc.save(`Estado_de_cuenta_${(nombre || 'cliente').replace(/[^\w\-]+/g, '_')}.pdf`);
      TX.toast('Estado de cuenta descargado.');
    } catch (e) { console.error('estadoCuenta:', e); TX.toast('No se pudo generar el estado de cuenta: ' + (e.message || e), 'error'); }
    finally { btn.disabled = false; }
  }
  function csvPagos() {
    const l = CH.verCreditos ? todosLosPagos() : [];
    if (!l.length) { TX.toast('No hay pagos para exportar.', 'error'); return; }
    const filas = [['Fecha', 'Tipo', 'Aplicado a', 'Monto', 'Método', 'Recibo', 'Saldo después', 'Estado'],
      ...l.map(p => [dia(p.fecha), p.tipo, p.ref, r2(p.monto), p.metodo || '', p.recibo || '', p.saldo == null ? '' : r2(p.saldo), p.anulado ? 'Anulado' : 'Válido'])];
    const txt = filas.map(r => r.map(v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
    a.download = `pagos_${(CH.cliente.nombre || 'cliente').replace(/[^\w\-]+/g, '_')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── Eventos ───────────────────────────────────────────────
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ch-tab],[data-ch-credito],[data-ch-rango],#ch-pdf,#ch-csv,#ch-linea-mas,#ch-aplicar,#ch-panel-cerrar,#ch-panel-fondo'); if (!t) return;
    if (t.dataset.chTab) { CH.tab = t.dataset.chTab; pintarTab(); }
    else if (t.dataset.chCredito) abrirCredito(t.dataset.chCredito);
    else if (t.dataset.chRango) { CH.rango = t.dataset.chRango; pintarTab(); }
    else if (t.id === 'ch-pdf') estadoCuenta();
    else if (t.id === 'ch-csv') csvPagos();
    else if (t.id === 'ch-linea-mas') { CH.lineaMax += 80; pintarTab(); }
    else if (t.id === 'ch-aplicar') {
      const d = $('ch-desde').value, h = $('ch-hasta').value;
      if (!d || !h || d > h) { TX.toast('Elige fechas válidas (desde ≤ hasta).', 'error'); return; }
      CH.desde = d; CH.hasta = h; pintarTab();
    }
    else if (t.id === 'ch-panel-cerrar' || t.id === 'ch-panel-fondo') cerrarCredito();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ch-panel').hidden) cerrarCredito(); });

  document.addEventListener('DOMContentLoaded', () => {
    const P = permisos();
    if (!P.clientes) { location.href = 'dashboard.html'; return; }
    CH.verCreditos = P.creditos;
    const qs = new URLSearchParams(location.search);
    CH.id = qs.get('id');
    TX.init(async () => {
      if (!CH.id) { $('ch-app').innerHTML = vacio('👥', 'Elige un cliente', 'Abre el historial desde el módulo de Clientes.') + '<div style="text-align:center"><a class="tx-btn" href="clientes.html">Ir a Clientes</a></div>'; return; }
      try {
        const ok = await cargar();
        if (!ok) { $('ch-app').innerHTML = vacio('🔍', 'No encontramos ese cliente', 'Puede que haya sido eliminado.') + '<div style="text-align:center"><a class="tx-btn" href="clientes.html">Volver a Clientes</a></div>'; return; }
        render();
        const cred = qs.get('credito');
        if (cred && CH.creditos.some(c => c.id === cred)) abrirCredito(cred);
      } catch (e) {
        console.error('historial cliente:', e);
        $('ch-app').innerHTML = vacio('⚠️', 'No se pudo cargar el historial', 'Revisa tu conexión y vuelve a intentarlo.');
      }
    });
  });
  window.CH = CH;
})();
