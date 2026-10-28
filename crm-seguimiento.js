/* ============================================================
   CRM-SEGUIMIENTO.JS — Negocio360 (CRM · Fase 1)
   Seguimiento de clientes en 1 toque:
     · "Llamé", "Nota", "Visita": quedan en cliente_interacciones (la tabla
       de interacciones que ya existía).
     · WhatsApp con mensajes guardados (crm_plantillas); {nombre} se cambia
       por el nombre del cliente y queda registrado como interacción.
     · Recordatorios / tareas (crm_tareas), con o sin cliente.
     · Lista de "Seguimientos" (atrasados, hoy, próximos) y aviso en el Panel.
   No toca ventas, Caja, créditos ni inventario.
   Uso: N360CRM.init({ sb, userId, usuario }) y luego las funciones públicas.
   ============================================================ */
(function () {
  'use strict';
  const C = { sb: null, userId: null, usuario: null, plantillas: null };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoy = () => ymd(new Date());
  const masDias = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const fechaCorta = iso => { if (!iso) return ''; const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return d.toLocaleDateString('es-NI', { weekday: 'short', day: 'numeric', month: 'short' }); };

  const TIPOS_TAREA = {
    seguimiento: { t: 'Seguimiento', i: '⏰' }, llamar: { t: 'Llamar', i: '📞' }, whatsapp: { t: 'Escribir por WhatsApp', i: '💬' },
    visitar: { t: 'Visitar', i: '🚗' }, cobrar: { t: 'Cobrar', i: '💰' }, cotizar: { t: 'Enviar cotización', i: '📄' }, otro: { t: 'Otro', i: '•' },
  };
  const PLANTILLAS_BASE = [
    { nombre: 'Saludo', texto: 'Hola {nombre} 👋, ¿cómo estás? Te escribimos de {negocio}. ¿En qué te podemos ayudar?' },
    { nombre: 'Seguimiento de cotización', texto: 'Hola {nombre}, te escribimos para saber si pudiste revisar la cotización que te enviamos. ¿Tienes alguna duda?' },
    { nombre: 'Te extrañamos', texto: 'Hola {nombre}, ¡hace tiempo no te vemos! Pasa por {negocio}, tenemos novedades para ti.' },
    { nombre: 'Gracias por tu compra', texto: '¡Gracias por tu compra, {nombre}! Cualquier cosa que necesites, aquí estamos. — {negocio}' },
  ];

  // Mismo criterio de todo el sistema: 8 dígitos (Nicaragua) → se antepone 505.
  function numeroWhatsApp(cli) {
    const t = String((cli && (cli.whatsapp || cli.telefono)) || '').replace(/\D/g, '');
    if (!t) return null;
    return t.length === 8 ? '505' + t : t;
  }

  // ── Estilos y ventanas (una sola vez; colores del tema de cada pantalla, con respaldo) ──
  function estilos() {
    if (document.getElementById('crm-estilos')) return;
    const s = document.createElement('style'); s.id = 'crm-estilos';
    s.textContent = `
      .crm-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10050;display:none;align-items:center;justify-content:center;padding:12px}
      .crm-ov.abierto{display:flex}
      .crm-caja{background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#0d0d14);border-radius:14px;width:100%;max-width:440px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35)}
      .crm-cab{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border,#e8e8ef);font-weight:800;font-size:15px}
      .crm-cab button{background:none;border:none;font-size:18px;cursor:pointer;color:inherit}
      .crm-cuerpo{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px}
      .crm-pie{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#e8e8ef);flex-wrap:wrap}
      .crm-campo{display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600}
      .crm-campo input,.crm-campo select,.crm-campo textarea{width:100%;padding:9px 10px;border:1px solid var(--border,#e8e8ef);border-radius:8px;font:inherit;font-weight:400;font-size:13.5px;background:var(--bg-surface-2,var(--bg-input,transparent));color:inherit;box-sizing:border-box}
      .crm-campo textarea{min-height:84px;resize:vertical}
      .crm-fila{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .crm-btn{padding:9px 14px;border-radius:9px;border:1px solid var(--border,#e8e8ef);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
      .crm-btn.prim{background:var(--accent,#5a5af4);border-color:var(--accent,#5a5af4);color:#fff}
      .crm-btn.wa{background:#16a34a;border-color:#16a34a;color:#fff}
      .crm-btn:disabled{opacity:.6;cursor:default}
      .crm-chips{display:flex;flex-wrap:wrap;gap:6px}
      .crm-chip{padding:6px 10px;border-radius:999px;border:1px solid var(--border,#e8e8ef);background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
      .crm-chip.on{background:var(--accent,#5a5af4);border-color:var(--accent,#5a5af4);color:#fff}
      .crm-err{color:var(--danger,#dc2626);font-size:12.5px;min-height:1em;margin:0}
      .crm-ayuda{font-size:11.5px;color:var(--text-muted,#71717a);font-weight:400}
      .crm-acciones{display:flex;flex-wrap:wrap;gap:6px}
      .crm-accion{display:inline-flex;align-items:center;gap:5px;padding:7px 11px;border-radius:999px;border:1px solid var(--border,#e8e8ef);background:var(--bg-surface-2,transparent);color:var(--text-primary,inherit);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
      .crm-accion:hover{border-color:var(--accent,#5a5af4)}
      .crm-tarea{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border,#e8e8ef)}
      .crm-tarea input[type=checkbox]{width:18px;height:18px;margin-top:2px;flex:none;cursor:pointer;accent-color:var(--accent,#5a5af4)}
      .crm-tarea .crm-t-txt{flex:1;min-width:0;font-size:13px}
      .crm-tarea .crm-t-txt b{display:block;overflow-wrap:anywhere}
      .crm-tarea small{color:var(--text-muted,#71717a);font-size:11.5px}
      .crm-tarea.hecha b{text-decoration:line-through;opacity:.6}
      .crm-tarea .crm-t-der{display:flex;gap:4px;align-items:center;flex:none}
      .crm-vence{font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap}
      .crm-vence.atrasada{background:rgba(220,38,38,.14);color:var(--danger,#dc2626)}
      .crm-vence.hoy{background:rgba(217,119,6,.16);color:#d97706}
      .crm-vence.prox{background:rgba(90,90,244,.12);color:var(--accent,#5a5af4)}
      .crm-grupo{font-weight:800;font-size:12.5px;margin:12px 0 2px;display:flex;justify-content:space-between}
      .crm-link{background:none;border:none;padding:0;color:var(--accent,#5a5af4);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
      .crm-mini{background:none;border:none;cursor:pointer;font-size:15px;padding:2px 4px;color:inherit}
      .crm-aviso{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:12px;border:1px solid var(--border,#e8e8ef);background:var(--bg-surface,transparent);margin-bottom:14px;font-size:13px}
      .crm-aviso b{font-size:14px}
      .crm-vacio{font-size:12.5px;color:var(--text-muted,#71717a);font-style:italic;padding:8px 0}
      .crm-pl{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border,#e8e8ef);font-size:12.5px}
      .crm-pl div{min-width:0;overflow-wrap:anywhere}
      @media (max-width:420px){ .crm-fila{grid-template-columns:1fr} }`;
    document.head.appendChild(s);
  }
  function ventana(id, titulo, cuerpo, pie) {
    estilos();
    let ov = document.getElementById(id);
    if (!ov) {
      ov = document.createElement('div'); ov.id = id; ov.className = 'crm-ov';
      ov.innerHTML = `<div class="crm-caja" role="dialog" aria-labelledby="${id}-t"><div class="crm-cab"><span id="${id}-t"></span><button type="button" aria-label="Cerrar" data-crm-cerrar>✕</button></div>
        <div class="crm-cuerpo"></div><div class="crm-pie"></div></div>`;
      ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-crm-cerrar]')) cerrar(id); });
      document.body.appendChild(ov);
    }
    else document.body.appendChild(ov);   // la última ventana abierta siempre queda encima
    ov.querySelector(`#${id}-t`).textContent = titulo;
    ov.querySelector('.crm-cuerpo').innerHTML = cuerpo;
    ov.querySelector('.crm-pie').innerHTML = pie;
    ov.classList.add('abierto');
    return ov;
  }
  function cerrar(id) { const ov = document.getElementById(id); if (ov) ov.classList.remove('abierto'); }
  function aviso(m, tipo) { if (typeof window.showToast === 'function') window.showToast(m, tipo || 'success'); }

  // ── Interacciones (tabla existente cliente_interacciones) ──
  async function registrar(cli, tipo, titulo, descripcion) {
    const { error } = await C.sb.from('cliente_interacciones').insert({
      auth_user_id: C.userId, cliente_id: cli.id, tipo, fecha: new Date().toISOString(),
      titulo: titulo || null, descripcion: descripcion || null, registrado_por: C.usuario || null,
    });
    if (error) throw error;
  }

  // ── Tareas ──
  async function crearTarea(t) {
    const fila = { auth_user_id: C.userId, cliente_id: t.cliente_id || null, titulo: String(t.titulo || '').trim().slice(0, 200), notas: t.notas || null,
      tipo: TIPOS_TAREA[t.tipo] ? t.tipo : 'seguimiento', vence_en: t.vence_en || hoy(), hora: t.hora || null, hecha: false, creado_por: C.usuario || null };
    const { error } = await C.sb.from('crm_tareas').insert(fila);
    if (error) throw error;
  }
  async function marcar(id, hecha) {
    const { error } = await C.sb.from('crm_tareas').update({ hecha, hecha_en: hecha ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', id).eq('auth_user_id', C.userId);
    if (error) throw error;
  }
  async function listar({ clienteId, pendientes = true, hasta } = {}) {
    let q = C.sb.from('crm_tareas').select('*').eq('auth_user_id', C.userId);
    if (clienteId) q = q.eq('cliente_id', clienteId);
    if (pendientes) q = q.eq('hecha', false);
    if (hasta) q = q.lte('vence_en', hasta);
    const { data, error } = await q.order('vence_en').order('created_at');
    if (error) throw error;
    return data || [];
  }
  function claseVence(f) { const h = hoy(); return f < h ? 'atrasada' : f === h ? 'hoy' : 'prox'; }
  function textoVence(f) { const h = hoy(); if (f < h) { const d = Math.round((new Date(h) - new Date(f)) / 86400000); return d === 1 ? 'Ayer' : `Hace ${d} días`; } if (f === h) return 'Hoy'; if (f === masDias(1)) return 'Mañana'; return fechaCorta(f); }
  // Lista de tareas (con casilla para marcar hecha). nombres: { cliente_id: {nombre, whatsapp, telefono} }
  function htmlTareas(lista, { nombres = {}, conCliente = false } = {}) {
    if (!lista.length) return '<div class="crm-vacio">Nada pendiente. 🎉</div>';
    return lista.map(t => {
      const ti = TIPOS_TAREA[t.tipo] || TIPOS_TAREA.seguimiento, cli = t.cliente_id ? nombres[t.cliente_id] : null;
      const wa = cli && numeroWhatsApp(cli);
      return `<div class="crm-tarea ${t.hecha ? 'hecha' : ''}" data-tarea="${esc(t.id)}">
        <input type="checkbox" ${t.hecha ? 'checked' : ''} aria-label="Marcar como hecha: ${esc(t.titulo)}" data-crm-hecha="${esc(t.id)}"/>
        <div class="crm-t-txt"><b>${ti.i} ${esc(t.titulo)}</b>
          <small>${conCliente && cli ? `<button type="button" class="crm-link" data-crm-cliente="${esc(t.cliente_id)}">${esc(cli.nombre)}</button> · ` : ''}${t.hora ? esc(String(t.hora).slice(0, 5)) + ' · ' : ''}${t.notas ? esc(t.notas) : ''}</small></div>
        <div class="crm-t-der"><span class="crm-vence ${claseVence(t.vence_en)}">${esc(textoVence(t.vence_en))}</span>
          ${wa ? `<button type="button" class="crm-mini" title="Escribir por WhatsApp" data-crm-wa="${esc(t.cliente_id)}">💬</button>` : ''}</div>
      </div>`;
    }).join('');
  }
  // Conecta casillas / WhatsApp / nombre de cliente dentro de un contenedor.
  function conectarLista(cont, { nombres = {}, alCambiar, alAbrirCliente } = {}) {
    if (cont.__crmConectado) { cont.__crmOpc = { nombres, alCambiar, alAbrirCliente }; return; }
    cont.__crmConectado = true; cont.__crmOpc = { nombres, alCambiar, alAbrirCliente };
    cont.addEventListener('change', async e => {
      const id = e.target.getAttribute && e.target.getAttribute('data-crm-hecha'); if (!id) return;
      e.target.disabled = true;
      try { await marcar(id, e.target.checked); aviso(e.target.checked ? '✅ Hecho' : 'Vuelve a quedar pendiente'); cont.__crmOpc.alCambiar && cont.__crmOpc.alCambiar(); }
      catch (err) { console.error('crm marcar:', err); e.target.checked = !e.target.checked; aviso('No se pudo guardar', 'error'); }
      finally { e.target.disabled = false; }
    });
    cont.addEventListener('click', e => {
      const w = e.target.closest('[data-crm-wa]'), c = e.target.closest('[data-crm-cliente]');
      if (w) { const id = w.getAttribute('data-crm-wa'); const cli = cont.__crmOpc.nombres[id]; if (cli) abrirWhatsApp({ ...cli, id }, { alGuardar: cont.__crmOpc.alCambiar }); }
      if (c && cont.__crmOpc.alAbrirCliente) cont.__crmOpc.alAbrirCliente(c.getAttribute('data-crm-cliente'));
    });
  }
  async function nombresClientes(ids) {
    const u = [...new Set(ids.filter(Boolean))]; if (!u.length) return {};
    const out = {};
    for (let i = 0; i < u.length; i += 150) {
      const { data } = await C.sb.from('clientes').select('id,nombre,apellido,whatsapp,telefono').in('id', u.slice(i, i + 150));
      (data || []).forEach(c => { out[c.id] = { nombre: [c.nombre, c.apellido].filter(Boolean).join(' '), whatsapp: c.whatsapp, telefono: c.telefono }; });
    }
    return out;
  }

  // ── Ventana: nuevo recordatorio ──
  function abrirTarea(cli, { alGuardar, tipo = 'llamar', titulo } = {}) {
    const ops = Object.entries(TIPOS_TAREA).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v.i} ${v.t}</option>`).join('');
    const nombre = cli ? cli.nombre : '';
    const ov = ventana('crm-v-tarea', '⏰ Nuevo recordatorio',
      `${cli ? `<div class="crm-ayuda">Cliente: <b>${esc(nombre)}</b></div>` : ''}
       <label class="crm-campo">¿Qué hay que hacer? *<input id="crm-t-titulo" maxlength="200" value="${esc(titulo || (cli ? (TIPOS_TAREA[tipo] || TIPOS_TAREA.seguimiento).t + ' a ' + nombre : ''))}"/></label>
       <div class="crm-fila"><label class="crm-campo">Tipo<select id="crm-t-tipo">${ops}</select></label>
         <label class="crm-campo">Hora (opcional)<input id="crm-t-hora" type="time"/></label></div>
       <div class="crm-campo">¿Cuándo?<div class="crm-chips" id="crm-t-cuando">
         <button type="button" class="crm-chip" data-d="0">Hoy</button><button type="button" class="crm-chip on" data-d="1">Mañana</button>
         <button type="button" class="crm-chip" data-d="3">En 3 días</button><button type="button" class="crm-chip" data-d="7">En una semana</button>
         <button type="button" class="crm-chip" data-d="30">En un mes</button></div>
         <input id="crm-t-fecha" type="date" value="${masDias(1)}" aria-label="Fecha del recordatorio"/></div>
       <label class="crm-campo">Notas (opcional)<input id="crm-t-notas" maxlength="300" placeholder="Ej: preguntar por el pedido grande"/></label>
       <p class="crm-err" id="crm-t-err" role="alert"></p>`,
      `<button type="button" class="crm-btn" data-crm-cerrar>Cancelar</button><button type="button" class="crm-btn prim" id="crm-t-ok">Guardar recordatorio</button>`);
    ov.querySelector('#crm-t-cuando').onclick = e => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      ov.querySelectorAll('#crm-t-cuando .crm-chip').forEach(x => x.classList.toggle('on', x === b));
      ov.querySelector('#crm-t-fecha').value = masDias(Number(b.dataset.d));
    };
    ov.querySelector('#crm-t-fecha').oninput = () => ov.querySelectorAll('#crm-t-cuando .crm-chip').forEach(x => x.classList.remove('on'));
    const ok = ov.querySelector('#crm-t-ok');
    ok.onclick = async () => {
      const err = ov.querySelector('#crm-t-err'); err.textContent = '';
      const t = ov.querySelector('#crm-t-titulo').value.trim(), f = ov.querySelector('#crm-t-fecha').value;
      if (!t) { err.textContent = 'Escribe qué hay que hacer.'; return; }
      if (!f) { err.textContent = 'Elige la fecha.'; return; }
      ok.disabled = true;
      try {
        await crearTarea({ cliente_id: cli && cli.id, titulo: t, tipo: ov.querySelector('#crm-t-tipo').value, vence_en: f,
          hora: ov.querySelector('#crm-t-hora').value || null, notas: ov.querySelector('#crm-t-notas').value.trim() || null });
        cerrar('crm-v-tarea'); aviso(`⏰ Recordatorio para ${textoVence(f).toLowerCase()}`);
        alGuardar && alGuardar();
      } catch (e) { console.error('crm tarea:', e); err.textContent = 'No se pudo guardar. Intenta de nuevo.'; }
      finally { ok.disabled = false; }
    };
    setTimeout(() => { const el = ov.querySelector('#crm-t-titulo'); el.focus(); el.select(); }, 50);
  }

  // ── Ventana: registro rápido (Llamé / Nota / Visita) con recordatorio opcional ──
  const RAPIDO = { llamada: { t: '📞 Llamé', q: '¿Qué te dijo?', ph: 'Ej: va a pasar el viernes por el pedido' },
    otro: { t: '📝 Nota', q: 'Nota', ph: 'Ej: prefiere que le escribamos por la tarde' },
    visita: { t: '🚗 Visita', q: '¿Cómo te fue?', ph: 'Ej: le mostré los productos nuevos' } };
  function abrirRapido(cli, tipo, { alGuardar } = {}) {
    const r = RAPIDO[tipo] || RAPIDO.otro;
    const ov = ventana('crm-v-rapido', `${r.t} — ${cli.nombre}`,
      `<label class="crm-campo">${r.q}<textarea id="crm-r-texto" maxlength="2000" placeholder="${esc(r.ph)}"></textarea></label>
       <div class="crm-campo">¿Volver a contactarlo?<div class="crm-chips" id="crm-r-cuando">
         <button type="button" class="crm-chip on" data-d="">No</button><button type="button" class="crm-chip" data-d="1">Mañana</button>
         <button type="button" class="crm-chip" data-d="3">En 3 días</button><button type="button" class="crm-chip" data-d="7">En una semana</button>
         <button type="button" class="crm-chip" data-d="30">En un mes</button></div></div>
       <p class="crm-err" id="crm-r-err" role="alert"></p>`,
      `<button type="button" class="crm-btn" data-crm-cerrar>Cancelar</button><button type="button" class="crm-btn prim" id="crm-r-ok">Guardar</button>`);
    let dias = '';
    ov.querySelector('#crm-r-cuando').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; dias = b.dataset.d; ov.querySelectorAll('#crm-r-cuando .crm-chip').forEach(x => x.classList.toggle('on', x === b)); };
    const ok = ov.querySelector('#crm-r-ok');
    ok.onclick = async () => {
      const err = ov.querySelector('#crm-r-err'); err.textContent = '';
      const texto = ov.querySelector('#crm-r-texto').value.trim();
      if (tipo === 'otro' && !texto) { err.textContent = 'Escribe la nota.'; return; }
      ok.disabled = true;
      try {
        await registrar(cli, tipo, tipo === 'llamada' ? 'Llamada' : tipo === 'visita' ? 'Visita' : 'Nota', texto || null);
        if (dias !== '') await crearTarea({ cliente_id: cli.id, titulo: `Volver a contactar a ${cli.nombre}`, tipo: 'seguimiento', vence_en: masDias(Number(dias)), notas: texto ? texto.slice(0, 300) : null });
        cerrar('crm-v-rapido'); aviso(dias !== '' ? 'Guardado, con recordatorio' : 'Guardado');
        alGuardar && alGuardar();
      } catch (e) { console.error('crm rápido:', e); err.textContent = 'No se pudo guardar. Intenta de nuevo.'; }
      finally { ok.disabled = false; }
    };
    setTimeout(() => ov.querySelector('#crm-r-texto').focus(), 50);
  }

  // ── WhatsApp con mensajes guardados ──
  async function cargarPlantillas(forzar) {
    if (C.plantillas && !forzar) return C.plantillas;
    try {
      const { data } = await C.sb.from('crm_plantillas').select('*').eq('auth_user_id', C.userId).order('orden').order('created_at');
      C.plantillas = data || [];
    } catch (e) { C.plantillas = []; }
    return C.plantillas;
  }
  function rellenar(texto, cli) {
    const negocio = C.negocio || 'nuestro negocio';
    return String(texto).replace(/\{nombre\}/gi, String(cli.nombre || '').split(' ')[0] || '').replace(/\{negocio\}/gi, negocio);
  }
  async function abrirWhatsApp(cli, { alGuardar } = {}) {
    const numero = numeroWhatsApp(cli);
    if (!numero) { aviso('Este cliente no tiene número de WhatsApp ni teléfono guardado', 'error'); return; }
    const propias = await cargarPlantillas();
    const lista = propias.length ? propias : PLANTILLAS_BASE;
    const ov = ventana('crm-v-wa', `💬 WhatsApp a ${cli.nombre}`,
      `<div class="crm-campo">Mensaje guardado<div class="crm-chips" id="crm-w-pl">${lista.map((p, i) => `<button type="button" class="crm-chip" data-i="${i}">${esc(p.nombre)}</button>`).join('')}</div></div>
       <label class="crm-campo">Mensaje<textarea id="crm-w-texto" maxlength="1000"></textarea><span class="crm-ayuda">Se abre WhatsApp con el mensaje listo; tú lo envías. Queda anotado en el cliente.</span></label>
       <button type="button" class="crm-link" id="crm-w-gest" style="align-self:flex-start">⚙️ Mis mensajes guardados</button>`,
      `<button type="button" class="crm-btn" data-crm-cerrar>Cancelar</button><button type="button" class="crm-btn wa" id="crm-w-ok">Abrir WhatsApp</button>`);
    const ta = ov.querySelector('#crm-w-texto');
    ov.querySelector('#crm-w-pl').onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; ta.value = rellenar(lista[Number(b.dataset.i)].texto, cli); ov.querySelectorAll('#crm-w-pl .crm-chip').forEach(x => x.classList.toggle('on', x === b)); };
    ov.querySelector('#crm-w-gest').onclick = () => { cerrar('crm-v-wa'); gestionarPlantillas({ alCerrar: () => abrirWhatsApp(cli, { alGuardar }) }); };
    ov.querySelector('#crm-w-ok').onclick = async () => {
      const texto = ta.value.trim();
      window.open(`https://wa.me/${numero}${texto ? '?text=' + encodeURIComponent(texto) : ''}`, '_blank', 'noopener');
      cerrar('crm-v-wa');
      try { await registrar(cli, 'mensaje', 'WhatsApp', texto || null); } catch (e) { console.warn('crm wa registro:', e); }
      alGuardar && alGuardar();
    };
    setTimeout(() => ta.focus(), 50);
  }
  async function gestionarPlantillas({ alCerrar } = {}) {
    const propias = await cargarPlantillas(true);
    const pintar = () => propias.length ? propias.map(p => `<div class="crm-pl"><div><b>${esc(p.nombre)}</b><br>${esc(p.texto)}</div>
        <button type="button" class="crm-mini" title="Quitar" data-crm-quitar="${esc(p.id)}">🗑️</button></div>`).join('')
      : `<div class="crm-vacio">Todavía no tienes mensajes propios; se usan los de ejemplo.</div>`;
    const ov = ventana('crm-v-pl', '⚙️ Mis mensajes guardados',
      `<div id="crm-pl-lista">${pintar()}</div>
       <label class="crm-campo">Nombre del mensaje<input id="crm-pl-nombre" maxlength="80" placeholder="Ej: Promoción del mes"/></label>
       <label class="crm-campo">Mensaje<textarea id="crm-pl-texto" maxlength="1000" placeholder="Hola {nombre}, …"></textarea>
         <span class="crm-ayuda">{nombre} se cambia por el nombre del cliente y {negocio} por el de tu negocio.</span></label>
       ${!propias.length ? `<button type="button" class="crm-link" id="crm-pl-base" style="align-self:flex-start">Empezar con los mensajes de ejemplo</button>` : ''}
       <p class="crm-err" id="crm-pl-err" role="alert"></p>`,
      `<button type="button" class="crm-btn" id="crm-pl-listo">Listo</button><button type="button" class="crm-btn prim" id="crm-pl-ok">Agregar mensaje</button>`);
    const recargar = async () => { await cargarPlantillas(true); propias.splice(0, propias.length, ...C.plantillas); ov.querySelector('#crm-pl-lista').innerHTML = pintar(); };
    ov.querySelector('#crm-pl-listo').onclick = () => { cerrar('crm-v-pl'); alCerrar && alCerrar(); };
    ov.querySelector('#crm-pl-lista').onclick = async e => {
      const b = e.target.closest('[data-crm-quitar]'); if (!b) return;
      try { const { error } = await C.sb.from('crm_plantillas').delete().eq('id', b.dataset.crmQuitar).eq('auth_user_id', C.userId); if (error) throw error; await recargar(); }
      catch (err) { aviso('No se pudo quitar', 'error'); }
    };
    const base = ov.querySelector('#crm-pl-base');
    if (base) base.onclick = async () => {
      try { const { error } = await C.sb.from('crm_plantillas').insert(PLANTILLAS_BASE.map((p, i) => ({ auth_user_id: C.userId, nombre: p.nombre, texto: p.texto, orden: i }))); if (error) throw error; base.remove(); await recargar(); }
      catch (err) { aviso('No se pudo guardar', 'error'); }
    };
    ov.querySelector('#crm-pl-ok').onclick = async () => {
      const err = ov.querySelector('#crm-pl-err'); err.textContent = '';
      const n = ov.querySelector('#crm-pl-nombre').value.trim(), t = ov.querySelector('#crm-pl-texto').value.trim();
      if (!n || !t) { err.textContent = 'Escribe el nombre y el mensaje.'; return; }
      try {
        const { error } = await C.sb.from('crm_plantillas').insert({ auth_user_id: C.userId, nombre: n, texto: t, orden: propias.length });
        if (error) throw error;
        ov.querySelector('#crm-pl-nombre').value = ''; ov.querySelector('#crm-pl-texto').value = ''; await recargar(); aviso('Mensaje guardado');
      } catch (e) { err.textContent = 'No se pudo guardar.'; }
    };
  }

  // ── Barra de acciones de la ficha del cliente + sus pendientes ──
  function htmlAcciones() {
    return `<div class="crm-acciones">
      <button type="button" class="crm-accion" data-crm-accion="llamada">📞 Llamé</button>
      <button type="button" class="crm-accion" data-crm-accion="whatsapp">💬 WhatsApp</button>
      <button type="button" class="crm-accion" data-crm-accion="otro">📝 Nota</button>
      <button type="button" class="crm-accion" data-crm-accion="visita">🚗 Visita</button>
      <button type="button" class="crm-accion" data-crm-accion="tarea">⏰ Recordatorio</button>
      ${window.N360Opor ? '<button type="button" class="crm-accion" data-crm-accion="oportunidad">🎯 Oportunidad</button>' : ''}</div>`;
  }
  async function montarFicha(cont, cli, { alCambiar } = {}) {
    estilos();
    if (!cont) return;
    const recargar = async () => { await pintarPendientes(cont, cli, alCambiar); alCambiar && alCambiar(); };
    cont.innerHTML = htmlAcciones() + `<div class="crm-grupo" style="margin-top:10px"><span>⏰ Pendiente con este cliente</span></div><div data-crm-pend><div class="crm-vacio">Cargando…</div></div>`;
    cont.querySelector('.crm-acciones').onclick = e => {
      const b = e.target.closest('[data-crm-accion]'); if (!b) return;
      const a = b.dataset.crmAccion;
      if (a === 'whatsapp') abrirWhatsApp(cli, { alGuardar: recargar });
      else if (a === 'tarea') abrirTarea(cli, { alGuardar: recargar });
      else if (a === 'oportunidad') window.N360Opor.abrirEditor(null, { cliente: cli, alGuardar: recargar });
      else abrirRapido(cli, a, { alGuardar: recargar });
    };
    await pintarPendientes(cont, cli, alCambiar);
  }
  async function pintarPendientes(cont, cli, alCambiar) {
    const zona = cont.querySelector('[data-crm-pend]'); if (!zona) return;
    try {
      const l = await listar({ clienteId: cli.id });
      const nombres = { [cli.id]: { nombre: cli.nombre, whatsapp: cli.whatsapp, telefono: cli.telefono } };
      zona.innerHTML = htmlTareas(l, { nombres });
      conectarLista(zona, { nombres, alCambiar: () => { pintarPendientes(cont, cli, alCambiar); alCambiar && alCambiar(); } });
    } catch (e) { console.error('crm pendientes:', e); zona.innerHTML = '<div class="crm-vacio">No se pudieron cargar los pendientes.</div>'; }
  }

  // ── Ventana "Seguimiento" de un cliente: registrar todo de primera mano ──
  const ICO_INT = { llamada: '📞', visita: '🚗', reunion: '🤝', mensaje: '💬', correo: '✉️', cotizacion: '📄', reclamo: '⚠️', otro: '📝' };
  async function ultimasInteracciones(zona, cli) {
    if (!zona) return;
    try {
      const { data, error } = await C.sb.from('cliente_interacciones').select('id,tipo,fecha,titulo,descripcion').eq('auth_user_id', C.userId).eq('cliente_id', cli.id).order('fecha', { ascending: false }).limit(8);
      if (error) throw error;
      zona.innerHTML = `<div class="crm-grupo"><span>🗂️ Lo último registrado</span></div>` + ((data || []).length ? data.map(i => `<div class="crm-tarea"><span style="flex:none">${ICO_INT[i.tipo] || '📝'}</span>
        <div class="crm-t-txt"><b>${esc(i.titulo || 'Nota')}</b><small>${esc(fechaCorta(i.fecha))}${i.descripcion ? ' · ' + esc(String(i.descripcion).slice(0, 140)) : ''}</small></div></div>`).join('')
        : '<div class="crm-vacio">Todavía no hay nada registrado. Usa los botones de arriba.</div>');
    } catch (e) { zona.innerHTML = ''; }
  }
  async function abrirPanelCliente(cli, { historial, alCambiar } = {}) {
    const ov = ventana('crm-v-panel', `📝 Seguimiento — ${cli.nombre}`,
      `<div class="crm-ayuda">Registra aquí llamadas, mensajes, notas, visitas, recordatorios y oportunidades. Todo queda en el historial del cliente.</div>
       <div data-panel-ficha></div><div data-panel-opor></div><div data-panel-ult></div>`,
      `${historial ? `<a class="crm-btn" href="${esc(historial)}" style="text-decoration:none">📊 Ver historial completo</a>` : ''}<button type="button" class="crm-btn prim" data-crm-cerrar>Listo</button>`);
    ov.querySelector('.crm-caja').style.maxWidth = '560px';
    const fic = ov.querySelector('[data-panel-ficha]'), op = ov.querySelector('[data-panel-opor]'), ult = ov.querySelector('[data-panel-ult]');
    const refrescar = () => { ultimasInteracciones(ult, cli); if (window.N360Opor) window.N360Opor.montarDeCliente(op, cli, { alCambiar }); alCambiar && alCambiar(); };
    await montarFicha(fic, cli, { alCambiar: refrescar });
    if (window.N360Opor) window.N360Opor.montarDeCliente(op, cli, { alCambiar });
    ultimasInteracciones(ult, cli);
  }

  // ── Pestaña "Seguimientos" (todos los clientes) ──
  async function montarSeguimientos(cont, { alAbrirCliente, alCambiar } = {}) {
    estilos();
    if (!cont) return;
    cont.innerHTML = '<div class="crm-vacio">Cargando seguimientos…</div>';
    let l = [];
    try { l = await listar({}); } catch (e) { console.error('crm seguimientos:', e); cont.innerHTML = '<div class="crm-vacio">No se pudieron cargar los seguimientos.</div>'; return; }
    const nombres = await nombresClientes(l.map(t => t.cliente_id));
    const h = hoy(), sem = masDias(7);
    const grupos = [['⚠️ Atrasados', l.filter(t => t.vence_en < h)], ['📌 Hoy', l.filter(t => t.vence_en === h)],
      ['📅 Próximos 7 días', l.filter(t => t.vence_en > h && t.vence_en <= sem)], ['🗓️ Más adelante', l.filter(t => t.vence_en > sem)]];
    cont.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
        <div class="crm-ayuda" style="font-size:12.5px">Tus llamadas, mensajes, visitas y cobros por hacer. Marca la casilla cuando lo hagas.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="crm-btn" data-crm-pl>⚙️ Mensajes guardados</button><button type="button" class="crm-btn prim" data-crm-nueva>⏰ Nuevo recordatorio</button></div></div>
      ${l.length ? grupos.filter(g => g[1].length).map(([t, x]) => `<div class="crm-grupo"><span>${t}</span><span>${x.length}</span></div><div>${htmlTareas(x, { nombres, conCliente: true })}</div>`).join('')
        : '<div class="crm-vacio" style="margin-top:10px">No tienes seguimientos pendientes. Ábrelos desde la ficha de un cliente con "⏰ Recordatorio".</div>'}`;
    const recargar = () => { montarSeguimientos(cont, { alAbrirCliente, alCambiar }); alCambiar && alCambiar(); };
    cont.querySelector('[data-crm-nueva]').onclick = () => abrirTarea(null, { alGuardar: recargar, tipo: 'seguimiento' });
    cont.querySelector('[data-crm-pl]').onclick = () => gestionarPlantillas({});
    conectarLista(cont, { nombres, alCambiar: recargar, alAbrirCliente });
  }

  // ── Aviso para el Panel principal ──
  async function contarPendientesHoy() {
    const { count, error } = await C.sb.from('crm_tareas').select('id', { count: 'exact', head: true })
      .eq('auth_user_id', C.userId).eq('hecha', false).lte('vence_en', hoy());
    if (error) throw error;
    return count || 0;
  }
  async function montarAvisoPanel(cont) {
    estilos();
    if (!cont) return;
    try {
      const l = await listar({ hasta: hoy() });
      if (!l.length) { cont.innerHTML = ''; return; }
      const atras = l.filter(t => t.vence_en < hoy()).length;
      cont.innerHTML = `<div class="crm-aviso"><div><b>⏰ Hoy tienes ${l.length} seguimiento${l.length === 1 ? '' : 's'}</b>${atras ? ` <span class="crm-vence atrasada">${atras} atrasado${atras === 1 ? '' : 's'}</span>` : ''}
        <div class="crm-ayuda">${l.slice(0, 3).map(t => esc(t.titulo)).join(' · ')}${l.length > 3 ? ' …' : ''}</div></div>
        <a class="crm-btn prim" href="clientes.html?tab=seguimientos" style="text-decoration:none">Ver seguimientos</a></div>`;
    } catch (e) { cont.innerHTML = ''; }
  }

  window.N360CRM = {
    init({ sb, userId, usuario, negocio }) { C.sb = sb; C.userId = userId; C.usuario = usuario || null; C.negocio = negocio || null; C.plantillas = null; estilos(); },
    montarFicha, montarSeguimientos, montarAvisoPanel, contarPendientesHoy,
    abrirTarea, abrirWhatsApp, abrirRapido, gestionarPlantillas, abrirPanelCliente, listar, marcar, crearTarea, numeroWhatsApp,
    // Piezas de pantalla compartidas con crm-oportunidades.js (mismas ventanas y colores)
    ui: { ventana, cerrar, estilos, esc, aviso, hoy, masDias, fechaCorta, registrar, contexto: () => C },
  };
})();
