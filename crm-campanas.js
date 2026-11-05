/* ============================================================
   CRM-CAMPANAS.JS — Negocio360 (CRM · Fase 4)
   Campañas por WhatsApp, GRATIS: el sistema arma la lista y el mensaje,
   la persona lo envía con un toque desde su propio WhatsApp (wa.me).
     · Mensajes predeterminados del sistema (cumpleaños, te extrañamos,
       gracias por tu compra, promoción…) que cada negocio puede editar
       (crm_mensajes_sistema) y volver al original cuando quiera.
     · A quién: cumpleañeros, X días sin comprar, compraron hace poco,
       un grupo de la Fase 3 o todos.
     · Cada envío queda anotado en el cliente (cliente_interacciones) y
       se marca "Enviado" para no repetirlo el mismo día.
   No usa servicios pagados ni envía nada solo. No toca ventas, Caja ni dinero.
   Depende de crm-seguimiento.js (N360CRM) y crm-grupos.js (N360Grupos).
   ============================================================ */
(function () {
  'use strict';
  const K = { sb: null, userId: null, editados: {}, tipo: null, publico: null, texto: '', enviados: {}, lista: [] };
  const U = () => window.N360CRM.ui;
  const esc = s => U().esc(s);

  const TIPOS = {
    cumple: { t: 'Cumpleaños / aniversario', i: '🎂', d: 'Felicita a quien tiene hoy su fecha especial (la "Fecha de aniversario" de su ficha).', p: 'cumple_hoy',
      x: '¡Feliz cumpleaños, {nombre}! 🎉 De parte de todos en {negocio} te deseamos un día increíble. Pasa a vernos, tenemos un detalle para ti 🎁' },
    extranamos: { t: 'Te extrañamos', i: '💌', d: 'Para quienes hace días no te compran.', p: 'sin_30',
      x: 'Hola {nombre}, ¡te extrañamos en {negocio}! Hace {dias} días no te vemos. ¿Todo bien? Pasa cuando quieras, aquí te esperamos 😊' },
    gracias: { t: 'Gracias por tu compra', i: '🙏', d: 'Para quienes compraron en los últimos 3 días.', p: 'compro_3',
      x: '¡Gracias por tu compra, {nombre}! 🙌 Esperamos que te haya encantado. Cualquier cosa que necesites, aquí estamos. — {negocio}' },
    bienvenida: { t: 'Bienvenida', i: '🌱', d: 'Para tus clientes nuevos.', p: 'grupo:nuevo',
      x: '¡Bienvenido/a a {negocio}, {nombre}! 🌱 Gracias por elegirnos. Guarda este número para pedidos, consultas o lo que necesites.' },
    promocion: { t: 'Promoción', i: '🔥', d: 'Anuncia una oferta. Completa la parte entre [ ].', p: 'todos',
      x: '¡Hola {nombre}! 🔥 Esta semana en {negocio}: [escribe aquí tu promoción]. ¡Te esperamos!' },
    novedades: { t: 'Productos nuevos', i: '✨', d: 'Cuenta lo nuevo que tienes. Completa la parte entre [ ].', p: 'todos',
      x: 'Hola {nombre} ✨ ¡Llegó algo nuevo a {negocio}! [escribe aquí qué llegó]. Pregúntanos sin compromiso.' },
    fiestas: { t: 'Felices fiestas', i: '🎉', d: 'Saludo para fechas especiales.', p: 'todos',
      x: '¡Hola {nombre}! 🎉 Todo el equipo de {negocio} te desea felices fiestas. ¡Gracias por tu preferencia!' },
    libre: { t: 'Mensaje libre', i: '✍️', d: 'Escribe lo que quieras.', p: 'todos', x: 'Hola {nombre}, ' },
    // ── Recordatorios (Fase 2): solo LEEN créditos y Agenda; no cambian montos, cuotas ni citas ──
    cuota_vence: { t: 'Cuota por vencer', i: '📅', d: 'Recuérdale la cuota de crédito que vence pronto.', p: 'cuota_3', ps: ['cuota_hoy', 'cuota_3', 'cuota_7'], rec: true,
      x: 'Hola {nombre} 👋 Te saludamos de {negocio}. Te recordamos que tu cuota de {monto} vence el {fecha}. ¡Gracias por tu puntualidad! 🙌' },
    cuota_vencida: { t: 'Cuota vencida', i: '⏰', d: 'Para quienes tienen cuotas de crédito atrasadas.', p: 'vencida', ps: ['vencida', 'vencida_30'], rec: true,
      x: 'Hola {nombre}, te saludamos de {negocio}. Tienes un saldo vencido de {monto} desde el {fecha} ({atraso} días). ¿Nos ayudas a ponerte al día? Cualquier duda, aquí estamos 🙏' },
    cita_manana: { t: 'Cita de mañana', i: '🗓️', d: 'Citas de la Agenda que tienen un cliente asignado.', p: 'cita_manana', ps: ['cita_manana', 'cita_hoy'], rec: true,
      x: 'Hola {nombre} 👋 Te recordamos tu cita en {negocio}: {fecha} a las {hora}. ¿Nos confirmas tu asistencia? 😊' },
  };
  const ORDEN = ['cumple', 'extranamos', 'gracias', 'bienvenida', 'promocion', 'novedades', 'fiestas', 'libre'];
  const ORDEN_REC = ['cuota_vence', 'cuota_vencida', 'cita_manana'];

  // ── Utilidades ──
  const mesDia = f => String(f || '').slice(5, 10);
  function proximosMesDia(n) { const out = []; for (let i = 0; i < n; i++) out.push(U().masDias(i).slice(5, 10)); return out; }
  function dinero(n) {
    const m = String((K.rec && K.rec.moneda) || 'NIO').toUpperCase(), s = { NIO: 'C$', USD: 'US$', CRC: '₡', HNL: 'L', GTQ: 'Q', MXN: 'MX$', EUR: '€' }[m] || m;
    return s + ' ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function hora12(h) {
    if (!h) return 'la hora acordada';
    const [H, M] = String(h).split(':').map(Number); if (isNaN(H)) return String(h);
    return `${((H + 11) % 12) + 1}:${String(M || 0).padStart(2, '0')} ${H < 12 ? 'am' : 'pm'}`;
  }
  function rellenar(texto, c) {
    const ctx = U().contexto(), r = c._r || {};
    return String(texto)
      .replace(/\{nombre\}/gi, String(c.nombre || '').split(' ')[0] || '')
      .replace(/\{negocio\}/gi, ctx.negocio || 'nuestro negocio')
      .replace(/\{dias\}/gi, c.diasUltima == null ? 'varios' : String(c.diasUltima))
      .replace(/\{monto\}/gi, r.monto != null ? dinero(r.monto) : '')
      .replace(/\{fecha\}/gi, r.fecha ? U().fechaCorta(r.fecha) : '')
      .replace(/\{hora\}/gi, r.fecha ? hora12(r.hora) : '')
      .replace(/\{atraso\}/gi, r.atraso != null ? String(r.atraso) : '');
  }
  const textoDe = tipo => K.editados[tipo] != null ? K.editados[tipo] : TIPOS[tipo].x;
  const tituloEnvio = tipo => `${TIPOS[tipo].rec ? 'Recordatorio' : 'Campaña'}: ${TIPOS[tipo].t}`;

  // ── Datos de recordatorios (solo lectura). Si algo falla, simplemente salen vacíos. ──
  async function leerPaginas(fn, max = 20) {
    const out = [];
    for (let i = 0; i < max; i++) {
      const { data, error } = await fn().range(i * 1000, i * 1000 + 999);
      if (error) throw error;
      out.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function cargarRecordatorios() {
    const R = { moneda: 'NIO', panel: false, venc: {}, prox: {}, citas: {} };
    K.rec = R;
    const hoy = U().hoy(), en7 = U().masDias(7), man = U().masDias(1);
    try {
      const { data: cfg } = await K.sb.from('configuracion_empresa').select('moneda,recordatorios_panel').eq('auth_user_id', K.userId).maybeSingle();
      R.moneda = (cfg && cfg.moneda) || 'NIO'; R.panel = !!(cfg && cfg.recordatorios_panel);
    } catch (e) { /* sin moneda: C$ */ }
    try {
      const cuotas = await leerPaginas(() => K.sb.from('creditos_cuotas').select('id,credito_id,fecha_vencimiento,monto_total,monto_pagado,estado')
        .eq('auth_user_id', K.userId).in('estado', ['pendiente', 'parcial', 'vencida']).lte('fecha_vencimiento', en7).order('id'));
      const ids = [...new Set(cuotas.map(q => q.credito_id).filter(Boolean))], cred = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await K.sb.from('creditos').select('id,cliente_id,estado').eq('auth_user_id', K.userId).in('id', ids.slice(i, i + 150));
        if (error) throw error;
        (data || []).forEach(c => { cred[c.id] = c; });
      }
      cuotas.forEach(q => {
        const c = cred[q.credito_id]; if (!c || !c.cliente_id || !['activo', 'con_atraso'].includes(c.estado)) return;
        const pend = Math.round(Math.max((Number(q.monto_total) || 0) - (Number(q.monto_pagado) || 0), 0) * 100) / 100;
        if (!(pend >= 0.01) || !q.fecha_vencimiento) return;
        const f = String(q.fecha_vencimiento).slice(0, 10);
        if (f < hoy) { const v = R.venc[c.cliente_id] || (R.venc[c.cliente_id] = { monto: 0, fecha: f }); v.monto += pend; if (f < v.fecha) v.fecha = f; }
        else (R.prox[c.cliente_id] || (R.prox[c.cliente_id] = [])).push({ f, m: pend });
      });
      Object.values(R.venc).forEach(v => { v.monto = Math.round(v.monto * 100) / 100; v.atraso = Math.round((new Date(hoy + 'T12:00:00') - new Date(v.fecha + 'T12:00:00')) / 864e5); });
    } catch (e) { console.warn('recordatorios cuotas:', e); R.venc = {}; R.prox = {}; }
    try {
      const { data, error } = await K.sb.from('agenda_eventos').select('id,fecha,hora,cliente_id,estado').eq('auth_user_id', K.userId)
        .in('fecha', [hoy, man]).eq('estado', 'pendiente').not('cliente_id', 'is', null).limit(2000);
      if (error) throw error;
      (data || []).forEach(e => {
        const k = e.cliente_id + '|' + e.fecha, a = R.citas[k];
        if (!a || String(e.hora || '99') < String(a.hora || '99')) R.citas[k] = { fecha: String(e.fecha).slice(0, 10), hora: e.hora ? String(e.hora).slice(0, 5) : null };
      });
    } catch (e) { console.warn('recordatorios citas:', e); R.citas = {}; }
    return R;
  }
  function proxHasta(cid, n) {
    const l = (K.rec && K.rec.prox[cid]) || [], tope = U().masDias(n), sel = l.filter(x => x.f <= tope);
    if (!sel.length) return null;
    return { monto: Math.round(sel.reduce((s, x) => s + x.m, 0) * 100) / 100, fecha: sel.reduce((a, x) => x.f < a ? x.f : a, sel[0].f) };
  }

  function publicos(todos) {
    const G = window.N360Grupos ? window.N360Grupos.GRUPOS : {};
    const hoyMD = U().hoy().slice(5, 10), semana = proximosMesDia(7);
    const p = [
      ['cumple_hoy', '🎂 Su fecha especial es hoy', c => c.fecha_aniversario && mesDia(c.fecha_aniversario) === hoyMD],
      ['cumple_semana', '🎂 Su fecha especial es esta semana', c => c.fecha_aniversario && semana.includes(mesDia(c.fecha_aniversario))],
      ['sin_30', '💌 Sin comprar 30 días o más', c => c.diasUltima != null && c.diasUltima >= 30],
      ['sin_60', '💌 Sin comprar 60 días o más', c => c.diasUltima != null && c.diasUltima >= 60],
      ['sin_90', '💌 Sin comprar 90 días o más', c => c.diasUltima != null && c.diasUltima >= 90],
      ['compro_3', '🙏 Compraron en los últimos 3 días', c => c.diasUltima != null && c.diasUltima <= 3],
      ...Object.keys(G).map(k => ['grupo:' + k, `${G[k].i} Grupo: ${G[k].t}`, c => c.grupo === k]),
      ['todos', '👥 Todos mis clientes', () => true],
    ];
    const R = K.rec || { venc: {}, prox: {}, citas: {} }, hoy = U().hoy(), man = U().masDias(1);
    const rec = [
      ['cuota_hoy', '📅 Cuota que vence hoy', c => proxHasta(c.id, 0)],
      ['cuota_3', '📅 Cuota que vence en los próximos 3 días', c => proxHasta(c.id, 3)],
      ['cuota_7', '📅 Cuota que vence en los próximos 7 días', c => proxHasta(c.id, 7)],
      ['vencida', '⏰ Con cuotas vencidas', c => R.venc[c.id] || null],
      ['vencida_30', '⏰ Con cuotas vencidas hace 30 días o más', c => (R.venc[c.id] && R.venc[c.id].atraso >= 30) ? R.venc[c.id] : null],
      ['cita_manana', '🗓️ Tienen cita mañana', c => R.citas[c.id + '|' + man] || null],
      ['cita_hoy', '🗓️ Tienen cita hoy', c => R.citas[c.id + '|' + hoy] || null],
    ];
    return [
      ...p.map(([k, t, f]) => ({ k, t, lista: todos.filter(f) })),
      ...rec.map(([k, t, f]) => ({ k, t, rec: true, lista: todos.map(c => { const r = f(c); return r ? { ...c, _r: r } : null; }).filter(Boolean) })),
    ];
  }

  async function cargarEditados() {
    try {
      const { data } = await K.sb.from('crm_mensajes_sistema').select('tipo,texto').eq('auth_user_id', K.userId);
      K.editados = {}; (data || []).forEach(r => { K.editados[r.tipo] = r.texto; });
    } catch (e) { K.editados = {}; }
  }
  async function cargarEnviadosHoy() {
    K.enviados = {};
    try {
      const desde = new Date(); desde.setHours(0, 0, 0, 0);
      for (const pre of ['Campaña:%', 'Recordatorio:%']) {
        const { data } = await K.sb.from('cliente_interacciones').select('cliente_id,titulo').eq('auth_user_id', K.userId)
          .like('titulo', pre).gte('fecha', desde.toISOString());
        (data || []).forEach(r => { K.enviados[r.cliente_id + '|' + r.titulo] = true; });
      }
    } catch (e) { /* si falla, solo no se marca lo ya enviado */ }
  }

  function estilos() {
    U().estilos();
    if (document.getElementById('camp-estilos')) return;
    const s = document.createElement('style'); s.id = 'camp-estilos';
    s.textContent = `
      .cp-tipos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:10px}
      .cp-tipo{border:1px solid var(--border,#e8e8ef);border-radius:12px;padding:12px;background:var(--bg-surface-2,transparent);color:var(--text-primary,inherit);text-align:left;font:inherit;cursor:pointer;min-width:0}
      .cp-tipo:hover{border-color:var(--accent,#5a5af4)}
      .cp-tipo b{display:block;font-size:14px}
      .cp-tipo small{display:block;font-size:11.5px;color:var(--text-muted,#71717a);margin-top:3px;overflow-wrap:anywhere}
      .cp-tipo .cp-n{display:inline-block;margin-top:6px;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(90,90,244,.13);color:var(--accent,#5a5af4)}
      .cp-tipo .cp-ed{color:#d97706;font-size:11px;font-weight:700;margin-left:4px}
      .cp-paso{display:flex;flex-direction:column;gap:10px}
      .cp-paso select,.cp-paso textarea{width:100%;padding:9px 10px;border:1px solid var(--border,#e8e8ef);border-radius:8px;font:inherit;font-size:13.5px;background:var(--bg-surface-2,transparent);color:inherit;box-sizing:border-box}
      .cp-paso textarea{min-height:96px;resize:vertical}
      .cp-vars{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;color:var(--text-muted,#71717a)}
      .cp-aviso{padding:9px 11px;border-radius:9px;background:rgba(217,119,6,.13);color:#d97706;font-size:12.5px;font-weight:600}
      .cp-progreso{height:8px;border-radius:999px;background:var(--bg-surface-2,rgba(127,127,127,.15));overflow:hidden}
      .cp-progreso i{display:block;height:100%;background:#16a34a;transition:width .3s}
      .cp-fila{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border,#e8e8ef);font-size:12.5px}
      .cp-fila .cp-txt{flex:1;min-width:0}
      .cp-fila .cp-txt b{display:block;overflow-wrap:anywhere}
      .cp-fila .cp-txt small{display:block;color:var(--text-muted,#71717a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cp-fila.enviado{opacity:.65}
      .cp-fila .crm-btn{flex:none;padding:7px 11px}
      @media (max-width:1100px){ .cp-tipos{grid-template-columns:repeat(2,minmax(0,1fr))} }`;
    document.head.appendChild(s);
  }

  // ── Paso 1: elegir tipo de mensaje ──
  async function montar(cont, { tipo } = {}) {
    estilos();
    if (!cont) return;
    K.cont = cont;
    cont.innerHTML = '<div class="crm-vacio">Preparando campañas…</div>';
    try { [K.lista] = await Promise.all([window.N360Grupos.datos(true), cargarEditados(), cargarEnviadosHoy(), cargarRecordatorios()]); }
    catch (e) { console.error('campañas:', e); cont.innerHTML = '<div class="crm-vacio">No se pudieron preparar las campañas.</div>'; return; }
    if (tipo && TIPOS[tipo]) return abrirTipo(tipo);
    pintarTipos();
  }
  function pintarTipos() {
    const cont = K.cont, pub = publicos(K.lista), cuenta = k => (pub.find(p => p.k === k) || { lista: [] }).lista.length;
    const tarjeta = k => { const t = TIPOS[k], n = cuenta(t.p); return `<button type="button" class="cp-tipo" data-cp-tipo="${k}">
        <b>${t.i} ${esc(t.t)}${K.editados[k] != null ? '<span class="cp-ed">✏️ editado</span>' : ''}</b><small>${esc(t.d)}</small>
        ${t.rec || ['cumple', 'extranamos', 'gracias', 'bienvenida'].includes(k) ? `<span class="cp-n">${n} cliente${n === 1 ? '' : 's'} ${k === 'cumple' ? 'hoy' : 'ahora'}</span>` : ''}</button>`; };
    const panel = !!(K.rec && K.rec.panel);
    cont.innerHTML = `<div class="crm-ayuda" style="font-size:12.5px">Elige qué mensaje quieres mandar. El sistema arma la lista de clientes y el mensaje con el nombre de cada uno; tú lo envías con un toque desde <b>tu WhatsApp</b>. <b>Es gratis</b>: no se paga nada a Meta. Todos los mensajes los puedes editar.</div>
      <div style="margin-top:14px;font-weight:800;font-size:14px">📲 Recordatorios de cobro y citas</div>
      <div class="crm-ayuda" style="font-size:12px">Solo leen tus créditos y tu Agenda para armar el mensaje: no cambian cuotas, saldos, Caja ni citas.</div>
      <div class="cp-tipos">${ORDEN_REC.map(tarjeta).join('')}</div>
      <label for="cp-panel" style="display:flex!important;flex-direction:row!important;justify-content:flex-start!important;gap:8px;align-items:center;margin-top:10px;font-size:12.5px;cursor:pointer;width:auto;font-weight:600">
        <input type="checkbox" id="cp-panel" ${panel ? 'checked' : ''} style="width:18px!important;height:18px;flex:none;margin:0;accent-color:var(--accent,#5a5af4)">
        <span style="flex:1;min-width:0">📌 Avisarme cada día en el Panel cuántos recordatorios tengo pendientes <span style="font-weight:400;color:var(--text-muted,#71717a)">(apagado si no lo marcas)</span></span></label>
      <div style="margin-top:18px;font-weight:800;font-size:14px">💬 Campañas</div>
      <div class="cp-tipos">${ORDEN.map(tarjeta).join('')}</div>`;
    cont.onclick = e => { const b = e.target.closest('[data-cp-tipo]'); if (b) abrirTipo(b.dataset.cpTipo); };
    const chk = cont.querySelector('#cp-panel');
    chk.onchange = async () => {
      const val = chk.checked; chk.disabled = true;
      try {
        const { error } = await K.sb.from('configuracion_empresa').update({ recordatorios_panel: val }).eq('auth_user_id', K.userId);
        if (error) throw error;
        K.rec.panel = val; U().aviso(val ? '📌 Listo: verás el aviso en el Panel cada día' : 'Aviso del Panel apagado');
      } catch (e) { console.error('recordatorios panel:', e); chk.checked = !val; U().aviso('No se pudo guardar', 'error'); }
      finally { chk.disabled = false; }
    };
  }

  // ── Paso 2: a quién, mensaje editable y envío uno por uno ──
  function abrirTipo(tipo) {
    const cont = K.cont, t = TIPOS[tipo];
    K.tipo = tipo; K.publico = t.p; K.texto = textoDe(tipo);
    const pub = publicos(K.lista).filter(p => t.ps ? t.ps.includes(p.k) : !p.rec);
    cont.innerHTML = `<div class="cp-paso">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="crm-link" data-cp-volver>← Tipos de mensaje</button><b style="font-size:15px">${t.i} ${esc(t.t)}</b></div>
      <label class="crm-campo">¿A quién?<select id="cp-publico">${pub.map(p => `<option value="${esc(p.k)}" ${p.k === K.publico ? 'selected' : ''}>${esc(p.t)} (${p.lista.length})</option>`).join('')}</select></label>
      <label class="crm-campo">Mensaje (puedes cambiarlo)<textarea id="cp-texto" maxlength="1000">${esc(K.texto)}</textarea></label>
      <div class="cp-vars">Se cambia solo: <code>{nombre}</code> nombre del cliente · <code>{negocio}</code> tu negocio · ${tipo === 'cita_manana'
        ? '<code>{fecha}</code> día de la cita · <code>{hora}</code> hora'
        : t.rec ? `<code>{monto}</code> ${tipo === 'cuota_vencida' ? 'saldo vencido' : 'monto de la cuota'} · <code>{fecha}</code> ${tipo === 'cuota_vencida' ? 'desde cuándo' : 'cuándo vence'}${tipo === 'cuota_vencida' ? ' · <code>{atraso}</code> días de atraso' : ''}`
        : '<code>{dias}</code> días sin comprar'}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="crm-btn" id="cp-guardar">💾 Guardar como mi mensaje</button>
        <button type="button" class="crm-btn" id="cp-original" ${K.editados[tipo] != null ? '' : 'style="display:none"'}>↩️ Volver al original</button></div>
      <div class="cp-aviso" id="cp-falta" style="display:none">Te falta completar la parte entre [ corchetes ] antes de enviar.</div>
      <div id="cp-lista"></div></div>`;
    const ta = cont.querySelector('#cp-texto');
    ta.oninput = () => { K.texto = ta.value; pintarLista(); };
    cont.querySelector('#cp-publico').onchange = e => { K.publico = e.target.value; pintarLista(); };
    cont.querySelector('#cp-guardar').onclick = async () => {
      const txt = ta.value.trim(); if (!txt) { U().aviso('El mensaje está vacío', 'error'); return; }
      try {
        const { error } = await K.sb.from('crm_mensajes_sistema').upsert({ auth_user_id: K.userId, tipo, texto: txt, updated_at: new Date().toISOString() }, { onConflict: 'auth_user_id,tipo' });
        if (error) throw error;
        K.editados[tipo] = txt; cont.querySelector('#cp-original').style.display = ''; U().aviso('💾 Guardado: la próxima vez saldrá así');
      } catch (e) { console.error('campaña guardar:', e); U().aviso('No se pudo guardar', 'error'); }
    };
    cont.querySelector('#cp-original').onclick = async () => {
      if (!confirm('¿Volver al mensaje original del sistema? Se pierde tu versión editada.')) return;
      try {
        const { error } = await K.sb.from('crm_mensajes_sistema').delete().eq('auth_user_id', K.userId).eq('tipo', tipo);
        if (error) throw error;
        delete K.editados[tipo]; K.texto = TIPOS[tipo].x; ta.value = K.texto; cont.querySelector('#cp-original').style.display = 'none'; pintarLista(); U().aviso('Volvió el mensaje original');
      } catch (e) { U().aviso('No se pudo', 'error'); }
    };
    cont.onclick = e => {
      if (e.target.closest('[data-cp-volver]')) return pintarTipos();
      const b = e.target.closest('[data-cp-enviar]'); if (b) return enviar(b.dataset.cpEnviar);
      if (e.target.closest('[data-cp-siguiente]')) { const sig = destinatarios().find(c => c._wa && !c._enviado); if (sig) enviar(sig.id); }
    };
    pintarLista();
  }
  function destinatarios() {
    const p = publicos(K.lista).find(x => x.k === K.publico) || { lista: [] }, titulo = tituloEnvio(K.tipo);
    return p.lista.map(c => ({ ...c, _wa: window.N360CRM.numeroWhatsApp(c), _enviado: !!K.enviados[c.id + '|' + titulo] }))
      .sort((a, b) => (!!b._wa - !!a._wa) || String(a.nombre).localeCompare(String(b.nombre)));
  }
  function pintarLista() {
    const zona = K.cont.querySelector('#cp-lista'); if (!zona) return;
    const falta = /\[[^\]]*\]/.test(K.texto);
    K.cont.querySelector('#cp-falta').style.display = falta ? '' : 'none';
    const l = destinatarios(), conWa = l.filter(c => c._wa), env = conWa.filter(c => c._enviado).length, sinTel = l.length - conWa.length;
    if (!l.length) { zona.innerHTML = '<div class="crm-vacio">Nadie en esta lista por ahora. Elige otro "¿A quién?".</div>'; return; }
    zona.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 6px">
        <b style="font-size:13px">${env} de ${conWa.length} enviados${sinTel ? ` <span class="crm-ayuda">· ${sinTel} sin teléfono</span>` : ''}</b>
        ${env < conWa.length ? `<button type="button" class="crm-btn wa" data-cp-siguiente ${falta ? 'disabled' : ''}>💬 Enviar al siguiente</button>` : (conWa.length ? '<b style="color:#16a34a">✅ ¡Listo, a todos!</b>' : '')}</div>
      <div class="cp-progreso"><i style="width:${conWa.length ? Math.round(env / conWa.length * 100) : 0}%"></i></div>
      ${l.slice(0, 500).map(c => `<div class="cp-fila ${c._enviado ? 'enviado' : ''}">
        <div class="cp-txt"><b>${esc(c.nombre)}</b><small>${c._wa ? esc(rellenar(K.texto, c)) : 'Sin teléfono ni WhatsApp guardado'}</small></div>
        ${c._wa ? (c._enviado ? `<button type="button" class="crm-btn" data-cp-enviar="${esc(c.id)}" title="Enviar otra vez">✅ Enviado</button>` : `<button type="button" class="crm-btn wa" data-cp-enviar="${esc(c.id)}" ${falta ? 'disabled' : ''}>💬 Enviar</button>`) : ''}</div>`).join('')}
      ${l.length > 500 ? '<div class="crm-vacio">Se muestran los primeros 500.</div>' : ''}`;
  }
  function enviar(id) {
    if (/\[[^\]]*\]/.test(K.texto)) { U().aviso('Completa la parte entre [ corchetes ] antes de enviar', 'error'); return; }
    const c = destinatarios().find(x => x.id === id); if (!c || !c._wa) return;
    const texto = rellenar(K.texto, c).trim(), titulo = tituloEnvio(K.tipo);
    window.open(`https://wa.me/${c._wa}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    K.enviados[c.id + '|' + titulo] = true;
    pintarLista();
    U().registrar(c, 'mensaje', titulo, texto).catch(e => console.warn('campaña registro:', e));
  }

  // ── Aviso del Panel: cumpleañeros de hoy (consulta liviana) ──
  async function montarAvisoPanel(cont) {
    estilos();
    if (!cont) return;
    let html = '';
    try {
      const { data, error } = await K.sb.from('clientes').select('id,nombre,fecha_aniversario').eq('auth_user_id', K.userId).eq('activo', true).not('fecha_aniversario', 'is', null);
      if (error) throw error;
      const hoyMD = U().hoy().slice(5, 10), l = (data || []).filter(c => mesDia(c.fecha_aniversario) === hoyMD);
      if (l.length) html += `<div class="crm-aviso"><div><b>🎂 Hoy es el cumpleaños o aniversario de ${l.length === 1 ? '1 cliente' : `${l.length} clientes`}</b>
        <div class="crm-ayuda">${l.slice(0, 3).map(c => esc(c.nombre)).join(' · ')}${l.length > 3 ? ' …' : ''}</div></div>
        <a class="crm-btn prim" href="clientes.html?tab=campanas&tipo=cumple" style="text-decoration:none">Felicitar por WhatsApp</a></div>`;
    } catch (e) { /* sin aviso de cumpleaños */ }
    cont.innerHTML = html;
    // Recordatorios: solo si el negocio lo activó en Clientes → Campañas (apagado por defecto)
    try {
      const R = await cargarRecordatorios();
      if (!R.panel) return;
      const man = U().masDias(1);
      const nProx = Object.keys(R.prox).filter(cid => proxHasta(cid, 3)).length, nVenc = Object.keys(R.venc).length;
      const nCitas = Object.keys(R.citas).filter(k => k.endsWith('|' + man)).length;
      if (!nProx && !nVenc && !nCitas) return;
      const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;
      const btn = (n, tipo, txt) => n ? `<a class="crm-btn" href="clientes.html?tab=campanas&tipo=${tipo}" style="text-decoration:none">${txt}</a>` : '';
      cont.insertAdjacentHTML('beforeend', `<div class="crm-aviso" style="margin-top:8px"><div><b>📲 Recordatorios por WhatsApp para hoy</b>
        <div class="crm-ayuda">${[nProx ? `📅 ${pl(nProx, 'cliente con cuota por vencer (3 días)', 'clientes con cuota por vencer (3 días)')}` : '',
          nVenc ? `⏰ ${pl(nVenc, 'cliente con cuotas vencidas', 'clientes con cuotas vencidas')}` : '',
          nCitas ? `🗓️ ${pl(nCitas, 'cita mañana', 'citas mañana')}` : ''].filter(Boolean).join(' · ')}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${btn(nProx, 'cuota_vence', '📅 Por vencer')}${btn(nVenc, 'cuota_vencida', '⏰ Vencidas')}${btn(nCitas, 'cita_manana', '🗓️ Citas')}</div></div>`);
    } catch (e) { /* el aviso nunca debe afectar al Panel */ }
  }

  window.N360Campanas = {
    init({ sb, userId }) { K.sb = sb; K.userId = userId; },
    montar, montarAvisoPanel, TIPOS, rellenar,
  };
})();
