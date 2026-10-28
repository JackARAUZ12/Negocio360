/* ============================================================
   CRM-OPORTUNIDADES.JS — Negocio360 (CRM · Fase 2)
   Prospectos y tablero de oportunidades ("posibles ventas"):
     Nuevo → Contactado → Cotizado → Negociando → Ganado / Perdido.
   · Un prospecto es alguien interesado que todavía no es cliente; al ganar
     se puede guardar como cliente (misma tabla clientes de siempre).
   · El valor es solo un ESTIMADO: no es venta, no entra a Caja, contabilidad,
     impuestos ni inventario. La venta real se sigue haciendo en Ventas.
   Depende de crm-seguimiento.js (N360CRM.ui: ventanas y colores).
   Uso: N360Opor.init({ sb, userId, usuario, fmt }) y N360Opor.montarTablero(cont, …)
   ============================================================ */
(function () {
  'use strict';
  const O = { sb: null, userId: null, usuario: null, fmt: n => 'C$ ' + (Number(n) || 0).toFixed(2), lista: [], etapaMovil: 'nuevo', verCerradas: '', busca: '' };
  const U = () => window.N360CRM.ui;
  const esc = s => U().esc(s);

  const ETAPAS = [
    { k: 'nuevo', t: 'Nuevo', i: '🌱', ayuda: 'Acaba de mostrar interés' },
    { k: 'contactado', t: 'Contactado', i: '📞', ayuda: 'Ya hablaste con él' },
    { k: 'cotizado', t: 'Cotizado', i: '📄', ayuda: 'Le enviaste precio o cotización' },
    { k: 'negociando', t: 'Negociando', i: '🤝', ayuda: 'Está por decidir' },
  ];
  const ABIERTAS = ETAPAS.map(e => e.k);
  const ORIGENES = { referido: 'Recomendado por alguien', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', tiktok: 'TikTok', visita: 'Llegó al negocio', llamada: 'Llamó', web: 'Página web', feria: 'Feria / evento', otro: 'Otro' };
  // Mismos motivos que el embudo de cotizaciones, para que los reportes hablen igual.
  const MOTIVOS = { precio: 'Precio muy alto', competencia: 'Se fue con la competencia', sin_presupuesto: 'Sin presupuesto', cambio_idea: 'Cambió de idea', sin_respuesta: 'No respondió', otro: 'Otro motivo' };
  const DIAS_QUIETA = 14;

  function estilos() {
    U().estilos();
    if (document.getElementById('opor-estilos')) return;
    const s = document.createElement('style'); s.id = 'opor-estilos';
    s.textContent = `
      .op-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .op-kpi{border:1px solid var(--border,#e8e8ef);border-radius:12px;padding:10px 12px;background:var(--bg-surface-2,transparent);min-width:0}
      .op-kpi small{display:block;font-size:11.5px;color:var(--text-muted,#71717a)}
      .op-kpi b{display:block;font-size:17px;overflow-wrap:anywhere}
      .op-barra{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
      .op-barra input{flex:1;min-width:160px;padding:9px 10px;border:1px solid var(--border,#e8e8ef);border-radius:8px;font:inherit;font-size:13px;background:var(--bg-surface-2,transparent);color:inherit}
      .op-tablero{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:start}
      .op-col{background:var(--bg-surface-2,rgba(127,127,127,.06));border:1px solid var(--border,#e8e8ef);border-radius:12px;padding:8px;min-height:120px;min-width:0}
      .op-col.sobre{outline:2px dashed var(--accent,#5a5af4);outline-offset:-4px}
      .op-col-cab{display:flex;justify-content:space-between;gap:6px;font-weight:800;font-size:13px;padding:2px 4px 8px}
      .op-col-cab small{font-weight:600;color:var(--text-muted,#71717a);font-size:11.5px;white-space:nowrap}
      .op-card{background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,inherit);border:1px solid var(--border,#e8e8ef);border-radius:10px;padding:9px 10px;margin-bottom:8px;cursor:grab;font-size:12.5px;min-width:0}
      .op-card.quieta{border-left:3px solid #d97706}
      .op-card b.op-tit{display:block;font-size:13px;overflow-wrap:anywhere;cursor:pointer}
      .op-card .op-quien{color:var(--text-muted,#71717a);overflow-wrap:anywhere}
      .op-card .op-valor{font-weight:800;margin-top:4px}
      .op-card .op-meta{font-size:11px;color:var(--text-muted,#71717a);margin-top:2px}
      .op-card .op-meta.alerta{color:#d97706;font-weight:700}
      .op-card .op-btns{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
      .op-card .op-btns button{padding:4px 7px;border-radius:7px;border:1px solid var(--border,#e8e8ef);background:transparent;color:inherit;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}
      .op-card .op-btns .gana{border-color:#16a34a;color:#16a34a}
      .op-card .op-btns .pierde{color:var(--danger,#dc2626)}
      .op-tag{display:inline-block;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:999px;background:rgba(90,90,244,.13);color:var(--accent,#5a5af4);margin-left:4px}
      .op-chips{display:none;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px}
      .op-chips button{flex:none}
      .op-cerradas{margin-top:14px}
      .op-fila{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border,#e8e8ef);font-size:12.5px}
      .op-fila div{min-width:0;overflow-wrap:anywhere}
      @media (max-width:1100px){ .op-kpis{grid-template-columns:repeat(2,minmax(0,1fr))} }
      @media (max-width:760px){
        .op-chips{display:flex}
        .op-tablero{grid-template-columns:1fr}
        .op-col{display:none}
        .op-col.visible{display:block}
        .op-card{cursor:default}
      }`;
    document.head.appendChild(s);
  }

  const nombreDe = o => o.cliente_id ? (o._cliente ? o._cliente.nombre : 'Cliente') : (o.prospecto_nombre || 'Prospecto');
  const diasEn = o => Math.max(0, Math.floor((Date.now() - new Date(o.etapa_desde || o.created_at).getTime()) / 86400000));
  const inicioMes = () => U().hoy().slice(0, 8) + '01';

  async function cargar() {
    const { data, error } = await O.sb.from('crm_oportunidades').select('*').eq('auth_user_id', O.userId).order('updated_at', { ascending: false });
    if (error) throw error;
    const l = data || [];
    const ids = [...new Set(l.map(o => o.cliente_id).filter(Boolean))];
    const cli = {};
    for (let i = 0; i < ids.length; i += 150) {
      const { data: c } = await O.sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp').in('id', ids.slice(i, i + 150));
      (c || []).forEach(x => { cli[x.id] = { id: x.id, nombre: [x.nombre, x.apellido].filter(Boolean).join(' '), telefono: x.telefono, whatsapp: x.whatsapp }; });
    }
    l.forEach(o => { o._cliente = o.cliente_id ? cli[o.cliente_id] || null : null; });
    O.lista = l;
    return l;
  }
  async function guardar(id, cambios) {
    const fila = { ...cambios, updated_at: new Date().toISOString() };
    const q = id ? O.sb.from('crm_oportunidades').update(fila).eq('id', id).eq('auth_user_id', O.userId)
      : O.sb.from('crm_oportunidades').insert({ auth_user_id: O.userId, etapa: 'nuevo', valor_estimado: 0, etapa_desde: new Date().toISOString(), creado_por: O.usuario || null, ...fila });
    const { error } = await q;
    if (error) throw error;
  }
  async function moverA(o, etapa, extra = {}) {
    if (o.etapa === etapa && !Object.keys(extra).length) return;
    const cerrada = etapa === 'ganado' || etapa === 'perdido';
    await guardar(o.id, { etapa, etapa_desde: new Date().toISOString(), cerrada_en: cerrada ? new Date().toISOString() : null, motivo_perdida: etapa === 'perdido' ? (extra.motivo_perdida || 'otro') : null, ...extra });
  }

  // ── Ventana: nueva / editar oportunidad ──
  async function abrirEditor(o, { cliente, alGuardar } = {}) {
    estilos();
    const nueva = !o;
    o = o || { etapa: 'nuevo', valor_estimado: '', cliente_id: cliente ? cliente.id : null, _cliente: cliente || null };
    const conCliente = !!o.cliente_id;
    const opsOrigen = `<option value="">— Sin indicar —</option>` + Object.entries(ORIGENES).map(([k, v]) => `<option value="${k}" ${o.origen === k ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const opsEtapa = ETAPAS.map(e => `<option value="${e.k}" ${o.etapa === e.k ? 'selected' : ''}>${e.i} ${e.t}</option>`).join('');
    const ov = U().ventana('opor-v-editar', nueva ? '🎯 Nueva oportunidad' : '🎯 Oportunidad',
      `<div class="crm-chips" id="op-e-quien" ${cliente ? 'style="display:none"' : ''}>
         <button type="button" class="crm-chip ${conCliente ? '' : 'on'}" data-q="prospecto">Persona nueva (prospecto)</button>
         <button type="button" class="crm-chip ${conCliente ? 'on' : ''}" data-q="cliente">Cliente que ya tengo</button></div>
       <div id="op-e-cli" style="${conCliente ? '' : 'display:none'}">
         <label class="crm-campo">Cliente<input id="op-e-cbusca" placeholder="Escribe el nombre o teléfono" value="${esc(o._cliente ? o._cliente.nombre : '')}" autocomplete="off" ${cliente ? 'disabled' : ''}/></label>
         <div id="op-e-cres" style="display:flex;flex-direction:column;gap:2px"></div></div>
       <div id="op-e-pros" style="display:${conCliente ? 'none' : 'flex'};flex-direction:column;gap:10px">
         <div class="crm-fila"><label class="crm-campo">Nombre *<input id="op-e-pnom" maxlength="150" value="${esc(o.prospecto_nombre || '')}" placeholder="Ej: Ana López"/></label>
           <label class="crm-campo">Teléfono / WhatsApp<input id="op-e-ptel" maxlength="40" inputmode="tel" value="${esc(o.prospecto_telefono || '')}"/></label></div>
         <div class="crm-fila"><label class="crm-campo">Empresa (opcional)<input id="op-e-pemp" maxlength="150" value="${esc(o.prospecto_empresa || '')}"/></label>
           <label class="crm-campo">Correo (opcional)<input id="op-e-pcor" maxlength="150" type="email" value="${esc(o.prospecto_correo || '')}"/></label></div></div>
       <label class="crm-campo">¿Qué le quieres vender? *<input id="op-e-tit" maxlength="200" value="${esc(o.titulo || '')}" placeholder="Ej: 50 uniformes para su empresa"/></label>
       <div class="crm-fila"><label class="crm-campo">Valor aproximado<input id="op-e-val" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(o.valor_estimado === '' ? '' : Number(o.valor_estimado) || '')}" placeholder="0.00"/></label>
         <label class="crm-campo">¿Para cuándo cierra?<input id="op-e-cierre" type="date" value="${esc(o.cierre_estimado || '')}"/></label></div>
       <div class="crm-fila"><label class="crm-campo">¿Cómo te encontró?<select id="op-e-origen">${opsOrigen}</select></label>
         ${nueva || ABIERTAS.includes(o.etapa) ? `<label class="crm-campo">Etapa<select id="op-e-etapa">${opsEtapa}</select></label>` : `<div class="crm-campo">Etapa<b>${o.etapa === 'ganado' ? '🏆 Ganada' : '✖ Perdida'}</b></div>`}</div>
       <label class="crm-campo">Notas (opcional)<textarea id="op-e-notas" maxlength="2000" style="min-height:60px">${esc(o.notas || '')}</textarea></label>
       <span class="crm-ayuda">El valor es solo un estimado para tu tablero: no es una venta ni entra a Caja. La venta la haces en Ventas como siempre.</span>
       <p class="crm-err" id="op-e-err" role="alert"></p>`,
      `${!nueva && !o.cliente_id ? `<button type="button" class="crm-btn" id="op-e-acli">👤 Guardar como cliente</button>` : ''}
       ${!nueva ? `<button type="button" class="crm-btn" id="op-e-borrar" style="color:var(--danger,#dc2626)">Quitar</button>` : ''}
       <button type="button" class="crm-btn" data-crm-cerrar>Cancelar</button><button type="button" class="crm-btn prim" id="op-e-ok">Guardar</button>`);
    let modo = conCliente ? 'cliente' : 'prospecto', clienteSel = o._cliente || null;
    ov.querySelector('#op-e-quien').onclick = e => {
      const b = e.target.closest('[data-q]'); if (!b) return; modo = b.dataset.q;
      ov.querySelectorAll('#op-e-quien .crm-chip').forEach(x => x.classList.toggle('on', x === b));
      ov.querySelector('#op-e-cli').style.display = modo === 'cliente' ? '' : 'none';
      ov.querySelector('#op-e-pros').style.display = modo === 'cliente' ? 'none' : 'flex';
    };
    // Buscador de clientes existentes
    const busca = ov.querySelector('#op-e-cbusca'), res = ov.querySelector('#op-e-cres');
    let t = null;
    busca.oninput = () => {
      clienteSel = null; clearTimeout(t);
      const q = busca.value.trim(); if (q.length < 2) { res.innerHTML = ''; return; }
      t = setTimeout(async () => {
        const limpio = q.replace(/[\\%_,()]/g, ' ').trim();
        const { data } = await O.sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp').eq('auth_user_id', O.userId).eq('activo', true)
          .or(`nombre.ilike.%${limpio}%,apellido.ilike.%${limpio}%,telefono.ilike.%${limpio}%`).limit(8);
        res.innerHTML = (data || []).length ? data.map(c => `<button type="button" class="crm-chip" style="text-align:left;border-radius:8px" data-c="${esc(c.id)}">${esc([c.nombre, c.apellido].filter(Boolean).join(' '))}${c.telefono ? ' · ' + esc(c.telefono) : ''}</button>`).join('')
          : '<div class="crm-ayuda">No se encontró. Elige "Persona nueva".</div>';
        res.__datos = data || [];
      }, 250);
    };
    res.onclick = e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const c = (res.__datos || []).find(x => x.id === b.dataset.c); if (!c) return;
      clienteSel = { id: c.id, nombre: [c.nombre, c.apellido].filter(Boolean).join(' '), telefono: c.telefono, whatsapp: c.whatsapp };
      busca.value = clienteSel.nombre; res.innerHTML = '';
    };
    const borrar = ov.querySelector('#op-e-borrar');
    if (borrar) borrar.onclick = async () => {
      if (!confirm('¿Quitar esta oportunidad del tablero? (No afecta ventas ni clientes)')) return;
      try { const { error } = await O.sb.from('crm_oportunidades').delete().eq('id', o.id).eq('auth_user_id', O.userId); if (error) throw error; U().cerrar('opor-v-editar'); U().aviso('Oportunidad quitada'); alGuardar && alGuardar(); }
      catch (e) { U().aviso('No se pudo quitar', 'error'); }
    };
    const aCli = ov.querySelector('#op-e-acli');
    if (aCli) aCli.onclick = async () => {
      try { const c = await convertirEnCliente(o); if (c) { U().cerrar('opor-v-editar'); alGuardar && alGuardar(); } }
      catch (e) { ov.querySelector('#op-e-err').textContent = 'No se pudo guardar el cliente.'; }
    };
    const ok = ov.querySelector('#op-e-ok');
    ok.onclick = async () => {
      const err = ov.querySelector('#op-e-err'); err.textContent = '';
      const titulo = ov.querySelector('#op-e-tit').value.trim();
      const val = ov.querySelector('#op-e-val').value === '' ? 0 : Number(ov.querySelector('#op-e-val').value);
      const fila = { titulo, valor_estimado: Math.round(val * 100) / 100, cierre_estimado: ov.querySelector('#op-e-cierre').value || null,
        origen: ov.querySelector('#op-e-origen').value || null, notas: ov.querySelector('#op-e-notas').value.trim() || null };
      if (modo === 'cliente') {
        if (!clienteSel) { err.textContent = 'Elige el cliente de la lista.'; return; }
        Object.assign(fila, { cliente_id: clienteSel.id });
      } else {
        const n = ov.querySelector('#op-e-pnom').value.trim();
        if (!n) { err.textContent = 'Escribe el nombre de la persona.'; return; }
        Object.assign(fila, { cliente_id: null, prospecto_nombre: n, prospecto_telefono: ov.querySelector('#op-e-ptel').value.trim() || null,
          prospecto_empresa: ov.querySelector('#op-e-pemp').value.trim() || null, prospecto_correo: ov.querySelector('#op-e-pcor').value.trim() || null });
      }
      if (!titulo) { err.textContent = 'Escribe qué le quieres vender.'; return; }
      if (!isFinite(val) || val < 0) { err.textContent = 'El valor no puede ser negativo.'; return; }
      const selEt = ov.querySelector('#op-e-etapa');
      if (selEt && selEt.value !== o.etapa) { fila.etapa = selEt.value; fila.etapa_desde = new Date().toISOString(); }
      ok.disabled = true;
      try { await guardar(nueva ? null : o.id, fila); U().cerrar('opor-v-editar'); U().aviso(nueva ? '🎯 Oportunidad agregada' : 'Guardado'); alGuardar && alGuardar(); }
      catch (e) { console.error('opor guardar:', e); err.textContent = 'No se pudo guardar. Intenta de nuevo.'; }
      finally { ok.disabled = false; }
    };
    setTimeout(() => { const el = ov.querySelector(conCliente ? '#op-e-tit' : '#op-e-pnom'); el && el.focus(); }, 50);
  }

  // Prospecto → cliente (tabla clientes de siempre). Si ya existe alguien con ese teléfono, se usa ese.
  async function convertirEnCliente(o) {
    if (o.cliente_id) return o._cliente;
    const tel = (o.prospecto_telefono || '').trim();
    let cli = null;
    if (tel) {
      const { data } = await O.sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp').eq('auth_user_id', O.userId).eq('activo', true).eq('telefono', tel).limit(1);
      if (data && data.length) cli = data[0];
    }
    if (!cli) {
      const { data, error } = await O.sb.from('clientes').insert({ auth_user_id: O.userId, nombre: o.prospecto_nombre, telefono: tel || null, empresa: o.prospecto_empresa || null,
        correo: o.prospecto_correo || null, canal_adquisicion: o.origen ? ORIGENES[o.origen] : null }).select('id,nombre,apellido,telefono,whatsapp').single();
      if (error) throw error;
      cli = data;
      U().aviso(`👤 ${o.prospecto_nombre} ya está en tus clientes`);
    } else U().aviso(`Se ligó con el cliente que ya tenías: ${cli.nombre}`);
    await guardar(o.id, { cliente_id: cli.id });
    return { id: cli.id, nombre: [cli.nombre, cli.apellido].filter(Boolean).join(' '), telefono: cli.telefono, whatsapp: cli.whatsapp };
  }

  // ── Ganar / perder ──
  function abrirGanar(o, { alGuardar } = {}) {
    const ov = U().ventana('opor-v-ganar', '🏆 ¡Oportunidad ganada!',
      `<div><b>${esc(o.titulo)}</b><div class="crm-ayuda">${esc(nombreDe(o))} · ${esc(O.fmt(o.valor_estimado))} (estimado)</div></div>
       ${!o.cliente_id ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="op-g-cli" checked style="width:18px;height:18px"/> Guardar a ${esc(o.prospecto_nombre)} como cliente</label>` : ''}
       <span class="crm-ayuda">Esto solo la marca como ganada en tu tablero. Para cobrar, haz la venta en Ventas como siempre (así cuadra Caja e inventario).</span>
       <p class="crm-err" id="op-g-err" role="alert"></p>`,
      `<button type="button" class="crm-btn" data-crm-cerrar>Cancelar</button><button type="button" class="crm-btn prim" id="op-g-ok">Marcar ganada</button>`);
    const ok = ov.querySelector('#op-g-ok');
    ok.onclick = async () => {
      ok.disabled = true;
      try {
        const chk = ov.querySelector('#op-g-cli');
        if (chk && chk.checked) await convertirEnCliente(o);
        await moverA(o, 'ganado');
        U().ventana('opor-v-ganar', '🏆 ¡Felicidades!', `<div style="font-size:13.5px">Quedó como <b>ganada</b>. ¿Quieres hacer la venta ahora?</div>`,
          `<button type="button" class="crm-btn" data-crm-cerrar>Después</button><a class="crm-btn prim" href="ventas.html" style="text-decoration:none">Ir a Ventas</a>`);
        alGuardar && alGuardar();
      } catch (e) { console.error('opor ganar:', e); ov.querySelector('#op-g-err').textContent = 'No se pudo guardar. Intenta de nuevo.'; ok.disabled = false; }
    };
  }
  function abrirPerder(o, { alGuardar } = {}) {
    const ov = U().ventana('opor-v-perder', '✖ Oportunidad perdida',
      `<div><b>${esc(o.titulo)}</b><div class="crm-ayuda">${esc(nombreDe(o))}</div></div>
       <div class="crm-campo">¿Por qué no se dio?<div class="crm-chips" id="op-p-mot">${Object.entries(MOTIVOS).map(([k, v]) => `<button type="button" class="crm-chip" data-m="${k}">${esc(v)}</button>`).join('')}</div></div>
       <span class="crm-ayuda">Saber por qué pierdes ventas te ayuda a mejorar precios y seguimiento.</span>
       <p class="crm-err" id="op-p-err" role="alert"></p>`,
      `<button type="button" class="crm-btn" data-crm-cerrar>Cancelar</button><button type="button" class="crm-btn prim" id="op-p-ok">Guardar</button>`);
    let mot = '';
    ov.querySelector('#op-p-mot').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; mot = b.dataset.m; ov.querySelectorAll('#op-p-mot .crm-chip').forEach(x => x.classList.toggle('on', x === b)); };
    const ok = ov.querySelector('#op-p-ok');
    ok.onclick = async () => {
      if (!mot) { ov.querySelector('#op-p-err').textContent = 'Elige el motivo.'; return; }
      ok.disabled = true;
      try { await moverA(o, 'perdido', { motivo_perdida: mot }); U().cerrar('opor-v-perder'); U().aviso('Guardado'); alGuardar && alGuardar(); }
      catch (e) { ov.querySelector('#op-p-err').textContent = 'No se pudo guardar.'; }
      finally { ok.disabled = false; }
    };
  }

  // ── Tablero ──
  function htmlTarjeta(o) {
    const d = diasEn(o), quieta = d >= DIAS_QUIETA, i = ABIERTAS.indexOf(o.etapa);
    const contacto = o._cliente || { nombre: o.prospecto_nombre, telefono: o.prospecto_telefono };
    const wa = window.N360CRM.numeroWhatsApp(contacto);
    const vence = o.cierre_estimado && o.cierre_estimado < U().hoy();
    return `<div class="op-card ${quieta ? 'quieta' : ''}" draggable="true" data-op="${esc(o.id)}">
      <b class="op-tit" data-op-editar="${esc(o.id)}">${esc(o.titulo)}</b>
      <div class="op-quien">${esc(nombreDe(o))}${o.cliente_id ? '' : '<span class="op-tag">Prospecto</span>'}${o.origen ? ' · ' + esc(ORIGENES[o.origen] || '') : ''}</div>
      <div class="op-valor">${esc(O.fmt(o.valor_estimado))}</div>
      <div class="op-meta ${quieta ? 'alerta' : ''}">${d === 0 ? 'Hoy en esta etapa' : `${d} día${d === 1 ? '' : 's'} en esta etapa`}${quieta ? ' — ¡dale seguimiento!' : ''}</div>
      ${o.cierre_estimado ? `<div class="op-meta ${vence ? 'alerta' : ''}">Cierre: ${esc(U().fechaCorta(o.cierre_estimado))}${vence ? ' (ya pasó)' : ''}</div>` : ''}
      <div class="op-btns">
        ${i > 0 ? `<button type="button" title="Regresar a ${esc(ETAPAS[i - 1].t)}" aria-label="Regresar a ${esc(ETAPAS[i - 1].t)}" data-op-mover="${esc(ETAPAS[i - 1].k)}">◀</button>` : ''}
        ${i < ABIERTAS.length - 1 ? `<button type="button" title="Pasar a ${esc(ETAPAS[i + 1].t)}" data-op-mover="${esc(ETAPAS[i + 1].k)}">${esc(ETAPAS[i + 1].t)} ▶</button>` : ''}
        <button type="button" class="gana" data-op-ganar>🏆 Ganada</button>
        <button type="button" class="pierde" data-op-perder>✖ Perdida</button>
        ${wa ? `<button type="button" title="Escribir por WhatsApp" aria-label="Escribir por WhatsApp" data-op-wa>💬</button>` : ''}
        <button type="button" title="Recordatorio" aria-label="Crear recordatorio" data-op-tarea>⏰</button>
      </div></div>`;
  }
  function kpis(l) {
    const abiertas = l.filter(o => ABIERTAS.includes(o.etapa)), mes = inicioMes();
    const ganMes = l.filter(o => o.etapa === 'ganado' && String(o.cerrada_en || '').slice(0, 10) >= mes);
    const desde90 = U().masDias(-90);
    const cerr90 = l.filter(o => (o.etapa === 'ganado' || o.etapa === 'perdido') && String(o.cerrada_en || '').slice(0, 10) >= desde90);
    const tasa = cerr90.length ? Math.round(cerr90.filter(o => o.etapa === 'ganado').length / cerr90.length * 100) : null;
    const suma = a => a.reduce((s, o) => s + (Number(o.valor_estimado) || 0), 0);
    return `<div class="op-kpis">
      <div class="op-kpi"><small>En juego (${abiertas.length})</small><b>${esc(O.fmt(suma(abiertas)))}</b></div>
      <div class="op-kpi"><small>Ganadas este mes (${ganMes.length})</small><b>${esc(O.fmt(suma(ganMes)))}</b></div>
      <div class="op-kpi"><small>De cada 10 cierres, ganas</small><b>${tasa == null ? '—' : Math.round(tasa / 10) + ' (' + tasa + '%)'}</b></div>
      <div class="op-kpi"><small>Sin movimiento +${DIAS_QUIETA} días</small><b>${abiertas.filter(o => diasEn(o) >= DIAS_QUIETA).length}</b></div></div>`;
  }
  async function montarTablero(cont, { alAbrirCliente } = {}) {
    estilos();
    if (!cont) return;
    if (!cont.innerHTML.trim()) cont.innerHTML = '<div class="crm-vacio">Cargando oportunidades…</div>';
    let l;
    try { l = await cargar(); } catch (e) { console.error('opor cargar:', e); cont.innerHTML = '<div class="crm-vacio">No se pudieron cargar las oportunidades.</div>'; return; }
    const q = O.busca.toLowerCase();
    const filtra = o => !q || [o.titulo, nombreDe(o), o.prospecto_telefono, o.prospecto_empresa].some(x => String(x || '').toLowerCase().includes(q));
    const vis = l.filter(filtra);
    const suma = a => a.reduce((s, o) => s + (Number(o.valor_estimado) || 0), 0);
    const cols = ETAPAS.map(e => { const x = vis.filter(o => o.etapa === e.k); return { e, x }; });
    const cerradas = vis.filter(o => o.etapa === O.verCerradas).sort((a, b) => String(b.cerrada_en || '').localeCompare(String(a.cerrada_en || ''))).slice(0, 50);
    const nG = vis.filter(o => o.etapa === 'ganado').length, nP = vis.filter(o => o.etapa === 'perdido').length;
    cont.innerHTML = `${kpis(l)}
      <div class="op-barra"><input type="search" id="op-busca" placeholder="Buscar por nombre, teléfono o producto" value="${esc(O.busca)}" aria-label="Buscar oportunidades"/>
        <button type="button" class="crm-btn prim" data-op-nueva>🎯 Nueva oportunidad</button></div>
      <div class="op-chips" role="tablist">${cols.map(({ e, x }) => `<button type="button" class="crm-chip ${O.etapaMovil === e.k ? 'on' : ''}" data-op-etapa="${e.k}">${e.i} ${e.t} (${x.length})</button>`).join('')}</div>
      <div class="op-tablero">${cols.map(({ e, x }) => `<div class="op-col ${O.etapaMovil === e.k ? 'visible' : ''}" data-op-col="${e.k}">
          <div class="op-col-cab"><span title="${esc(e.ayuda)}">${e.i} ${e.t} · ${x.length}</span><small>${esc(O.fmt(suma(x)))}</small></div>
          ${x.length ? x.map(htmlTarjeta).join('') : `<div class="crm-vacio" style="padding:6px 4px">${esc(e.ayuda)}</div>`}</div>`).join('')}</div>
      ${!l.length ? `<div class="crm-vacio" style="margin-top:10px">Aquí anotas a las personas interesadas y lo que les quieres vender, y las vas pasando de etapa hasta ganar la venta. Empieza con "🎯 Nueva oportunidad".</div>` : ''}
      <div class="op-cerradas"><div class="crm-chips"><button type="button" class="crm-chip ${O.verCerradas === 'ganado' ? 'on' : ''}" data-op-cerr="ganado">🏆 Ganadas (${nG})</button>
        <button type="button" class="crm-chip ${O.verCerradas === 'perdido' ? 'on' : ''}" data-op-cerr="perdido">✖ Perdidas (${nP})</button></div>
        ${O.verCerradas ? (cerradas.length ? cerradas.map(o => `<div class="op-fila"><div><b>${esc(o.titulo)}</b><br><span class="crm-ayuda">${esc(nombreDe(o))} · ${esc(O.fmt(o.valor_estimado))}${o.etapa === 'perdido' && o.motivo_perdida ? ' · ' + esc(MOTIVOS[o.motivo_perdida] || '') : ''} · ${esc(U().fechaCorta(o.cerrada_en))}</span></div>
            <button type="button" class="crm-btn" data-op-reabrir="${esc(o.id)}">Reabrir</button></div>`).join('') : '<div class="crm-vacio">Ninguna todavía.</div>') : ''}</div>`;
    const recargar = () => montarTablero(cont, { alAbrirCliente });
    const porId = id => O.lista.find(o => o.id === id);
    const b = cont.querySelector('#op-busca');
    b.oninput = () => { O.busca = b.value; clearTimeout(b.__t); b.__t = setTimeout(async () => { await recargar(); const nb = cont.querySelector('#op-busca'); nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); }, 300); };
    if (cont.__opConectado) return;
    cont.__opConectado = true;
    cont.addEventListener('click', async e => {
      const t = e.target, card = t.closest('[data-op]'), o = card ? porId(card.dataset.op) : null;
      const rec = () => montarTablero(cont, { alAbrirCliente });
      if (t.closest('[data-op-nueva]')) return abrirEditor(null, { alGuardar: rec });
      const et = t.closest('[data-op-etapa]'); if (et) { O.etapaMovil = et.dataset.opEtapa; cont.querySelectorAll('[data-op-etapa]').forEach(x => x.classList.toggle('on', x === et)); cont.querySelectorAll('[data-op-col]').forEach(c => c.classList.toggle('visible', c.dataset.opCol === O.etapaMovil)); return; }
      const ce = t.closest('[data-op-cerr]'); if (ce) { O.verCerradas = O.verCerradas === ce.dataset.opCerr ? '' : ce.dataset.opCerr; return rec(); }
      const re = t.closest('[data-op-reabrir]'); if (re) { const x = porId(re.dataset.opReabrir); if (x) { try { await moverA(x, 'negociando'); U().aviso('Volvió a Negociando'); } catch (er) { U().aviso('No se pudo', 'error'); } return rec(); } }
      if (!o) return;
      if (t.closest('[data-op-editar]')) return abrirEditor(o, { alGuardar: rec });
      const mv = t.closest('[data-op-mover]');
      if (mv) { mv.disabled = true; try { await moverA(o, mv.dataset.opMover); O.etapaMovil = mv.dataset.opMover; U().aviso(`Pasó a ${ETAPAS.find(x => x.k === mv.dataset.opMover).t}`); } catch (er) { U().aviso('No se pudo mover', 'error'); } return rec(); }
      if (t.closest('[data-op-ganar]')) return abrirGanar(o, { alGuardar: rec });
      if (t.closest('[data-op-perder]')) return abrirPerder(o, { alGuardar: rec });
      if (t.closest('[data-op-wa]')) {
        const c = o._cliente || { id: null, nombre: o.prospecto_nombre, telefono: o.prospecto_telefono };
        if (c.id) return window.N360CRM.abrirWhatsApp(c, { alGuardar: rec });
        const n = window.N360CRM.numeroWhatsApp(c);
        if (n) window.open(`https://wa.me/${n}?text=${encodeURIComponent(`Hola ${String(c.nombre || '').split(' ')[0]}, te escribimos por ${o.titulo}.`)}`, '_blank', 'noopener');
        return;
      }
      if (t.closest('[data-op-tarea]')) return window.N360CRM.abrirTarea(o._cliente || null, { tipo: 'seguimiento', titulo: `${o.titulo} — ${nombreDe(o)}` });
    });
    // Arrastrar tarjetas entre columnas (computadora)
    cont.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('[data-op]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.op); e.dataTransfer.effectAllowed = 'move'; } });
    cont.addEventListener('dragover', e => { const col = e.target.closest && e.target.closest('[data-op-col]'); if (col) { e.preventDefault(); cont.querySelectorAll('.op-col.sobre').forEach(x => x !== col && x.classList.remove('sobre')); col.classList.add('sobre'); } });
    cont.addEventListener('dragleave', e => { const col = e.target.closest && e.target.closest('[data-op-col]'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('sobre'); });
    cont.addEventListener('drop', async e => {
      const col = e.target.closest && e.target.closest('[data-op-col]'); if (!col) return;
      e.preventDefault(); col.classList.remove('sobre');
      const o = porId(e.dataTransfer.getData('text/plain')); if (!o || o.etapa === col.dataset.opCol) return;
      try { await moverA(o, col.dataset.opCol); U().aviso(`Pasó a ${ETAPAS.find(x => x.k === col.dataset.opCol).t}`); } catch (er) { U().aviso('No se pudo mover', 'error'); }
      montarTablero(cont, { alAbrirCliente });
    });
  }

  // Oportunidades abiertas de un cliente (para su ficha)
  async function montarDeCliente(cont, cli, { alCambiar } = {}) {
    estilos();
    if (!cont) return;
    const pintar = async () => {
      let l = [];
      try { const { data } = await O.sb.from('crm_oportunidades').select('*').eq('auth_user_id', O.userId).eq('cliente_id', cli.id).order('updated_at', { ascending: false }); l = data || []; } catch (e) { l = []; }
      l.forEach(o => { o._cliente = cli; });
      const ab = l.filter(o => ABIERTAS.includes(o.etapa));
      cont.innerHTML = `<div class="crm-grupo"><span>🎯 Oportunidades abiertas</span><button type="button" class="crm-link" data-opc-nueva>+ Nueva</button></div>
        ${ab.length ? ab.map(o => { const e = ETAPAS.find(x => x.k === o.etapa); return `<div class="op-fila"><div><b>${esc(o.titulo)}</b><br><span class="crm-ayuda">${e.i} ${e.t} · ${esc(O.fmt(o.valor_estimado))}</span></div>
          <button type="button" class="crm-btn" data-opc-ver="${esc(o.id)}">Ver</button></div>`; }).join('') : '<div class="crm-vacio">Ninguna. Usa "+ Nueva" si le quieres vender algo.</div>'}`;
      cont.onclick = e => {
        if (e.target.closest('[data-opc-nueva]')) return abrirEditor(null, { cliente: cli, alGuardar: () => { pintar(); alCambiar && alCambiar(); } });
        const v = e.target.closest('[data-opc-ver]'); if (v) { const o = l.find(x => x.id === v.dataset.opcVer); if (o) abrirEditor(o, { alGuardar: () => { pintar(); alCambiar && alCambiar(); } }); }
      };
    };
    await pintar();
  }

  window.N360Opor = {
    init({ sb, userId, usuario, fmt }) { O.sb = sb; O.userId = userId; O.usuario = usuario || null; if (fmt) O.fmt = fmt; },
    montarTablero, montarDeCliente, abrirEditor, convertirEnCliente, ETAPAS, MOTIVOS, ORIGENES,
  };
})();
