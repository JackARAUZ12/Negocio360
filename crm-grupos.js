/* ============================================================
   CRM-GRUPOS.JS — Negocio360 (CRM · Fase 3)
   Grupos de clientes y puntaje, calculados con sus compras reales
   (función crm_resumen_clientes: ventas completadas menos devoluciones).
     · Qué tan reciente compró (R), cada cuánto (F, últimos 12 meses) y cuánto (M)
       → nota de 1 a 5 cada una → puntaje de 0 a 100 → grupo.
   SOLO LEE: no guarda grupos ni cambia clientes, ventas, Caja ni nada de dinero.
   Depende de crm-seguimiento.js (N360CRM.ui).
   Uso: N360Grupos.init({ sb, userId, fmt }) · montar(cont, …) · insignia(clienteId)
   ============================================================ */
(function () {
  'use strict';
  const G = { sb: null, userId: null, fmt: n => 'C$ ' + (Number(n) || 0).toFixed(2), datos: null, cargando: null, sel: null };
  const U = () => window.N360CRM.ui;
  const esc = s => U().esc(s);

  const GRUPOS = {
    campeon: { t: 'Campeones', i: '🏆', c: '#16a34a', d: 'Compran seguido, hace poco y gastan bien.', a: 'Agradéceles y dales trato especial; pídeles que te recomienden.', msg: '¡Hola {nombre}! Gracias por ser de nuestros mejores clientes 🙌. Tenemos algo especial para ti en {negocio}.' },
    leal: { t: 'Leales', i: '💎', c: '#0891b2', d: 'Vuelven una y otra vez.', a: 'Ofréceles algo más (productos nuevos o un combo).', msg: 'Hola {nombre}, gracias por tu preferencia. Te cuento que en {negocio} tenemos novedades que te pueden gustar.' },
    nuevo: { t: 'Nuevos', i: '🌱', c: '#5a5af4', d: 'Compraron por primera vez hace poco.', a: 'Dales la bienvenida para que vuelvan.', msg: '¡Hola {nombre}! Gracias por tu primera compra en {negocio}. Cualquier cosa que necesites, aquí estamos.' },
    prometedor: { t: 'Prometedores', i: '🙂', c: '#7c3aed', d: 'Compraron hace poco, pero todavía pocas veces.', a: 'Dales seguimiento para que se vuelvan frecuentes.', msg: 'Hola {nombre}, ¿cómo te fue con tu compra? En {negocio} queremos verte pronto de nuevo.' },
    en_riesgo: { t: 'En riesgo', i: '⚠️', c: '#d97706', d: 'Compraban seguido o gastaban bien, pero hace rato no vienen.', a: 'Escríbeles YA: pregúntales cómo están o dales un motivo para volver.', msg: 'Hola {nombre}, ¡te extrañamos en {negocio}! ¿Todo bien? Pasa a vernos, tenemos algo para ti.' },
    dormido: { t: 'Dormidos', i: '😴', c: '#64748b', d: 'Compraron poco y hace tiempo.', a: 'Un mensaje con una promoción puede despertarlos.', msg: 'Hola {nombre}, hace tiempo no te vemos por {negocio}. Esta semana tenemos promociones, ¡te esperamos!' },
    perdido: { t: 'Perdidos', i: '💤', c: '#94a3b8', d: 'No compran desde hace más de un año.', a: 'Inténtalo una vez; si no responden, no gastes más tiempo.', msg: 'Hola {nombre}, ¡cuánto tiempo! En {negocio} nos encantaría volver a atenderte.' },
    sin_compras: { t: 'Sin compras', i: '📇', c: '#a1a1aa', d: 'Están registrados pero nunca les has vendido.', a: 'Pregúntales qué necesitan.', msg: 'Hola {nombre}, te escribimos de {negocio}. ¿En qué te podemos ayudar?' },
  };
  const ORDEN = ['campeon', 'leal', 'nuevo', 'prometedor', 'en_riesgo', 'dormido', 'perdido', 'sin_compras'];

  // ── Cálculo (puro, sin pantalla: se prueba aparte) ──
  const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  function notaR(dias) { return dias <= 15 ? 5 : dias <= 30 ? 4 : dias <= 60 ? 3 : dias <= 120 ? 2 : 1; }
  function notaF(n) { return n >= 10 ? 5 : n >= 5 ? 4 : n >= 3 ? 3 : n >= 2 ? 2 : 1; }
  // M: comparado con los demás clientes del mismo negocio (cada negocio maneja montos distintos).
  function notasM(montos) {
    const pos = montos.filter(m => m > 0).sort((a, b) => a - b), n = pos.length;
    return m => {
      if (!(m > 0) || !n) return 1;
      let menos = 0, iguales = 0;
      for (const x of pos) { if (x < m) menos++; else if (x === m) iguales++; }
      return Math.min(5, Math.max(1, Math.ceil(((menos + iguales / 2) / n) * 5)));
    };
  }
  function grupoDe({ R, F, M, compras, diasPrimera, diasUltima }) {
    if (!compras) return 'sin_compras';
    if (compras <= 2 && diasPrimera <= 45) return 'nuevo';
    if (R >= 4 && F >= 4) return 'campeon';
    if (R >= 3 && F >= 3) return 'leal';
    if (diasUltima > 365) return 'perdido';
    if (R <= 2 && (F >= 3 || M >= 4)) return 'en_riesgo';
    if (R <= 2) return 'dormido';
    return 'prometedor';
  }
  // resumen: filas de crm_resumen_clientes · clientes: [{id,…}] · hoy: 'YYYY-MM-DD'
  function calcular(resumen, clientes, hoy) {
    const por = {}; (resumen || []).forEach(r => { por[r.cliente_id] = r; });
    const nm = notasM((resumen || []).map(r => Number(r.monto_12m) || 0));
    return (clientes || []).map(c => {
      const r = por[c.id];
      if (!r || !r.compras) return { ...c, compras: 0, monto: 0, compras_12m: 0, monto_12m: 0, R: 0, F: 0, M: 0, puntaje: 0, grupo: 'sin_compras', diasUltima: null };
      const dU = Math.max(0, diasEntre(r.ultima, hoy)), dP = Math.max(0, diasEntre(r.primera, hoy));
      const R = notaR(dU), F = notaF(Number(r.compras_12m) || 0), M = nm(Number(r.monto_12m) || 0);
      const puntaje = Math.round(((R * 0.4 + F * 0.35 + M * 0.25) - 1) / 4 * 100);
      return { ...c, compras: r.compras, monto: Number(r.monto) || 0, compras_12m: r.compras_12m, monto_12m: Number(r.monto_12m) || 0, ultima: r.ultima, primera: r.primera,
        R, F, M, puntaje, diasUltima: dU, grupo: grupoDe({ R, F, M, compras: r.compras, diasPrimera: dP, diasUltima: dU }) };
    });
  }

  // ── Datos ──
  async function cargar(forzar) {
    if (G.datos && !forzar) return G.datos;
    if (G.cargando && !forzar) return G.cargando;
    G.cargando = (async () => {
      const { data: res, error } = await G.sb.rpc('crm_resumen_clientes');
      if (error) throw error;
      const clientes = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error: e2 } = await G.sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp,empresa').eq('auth_user_id', G.userId).eq('activo', true).order('nombre').range(desde, desde + 999);
        if (e2) throw e2;
        clientes.push(...(data || []).map(c => ({ ...c, nombre: [c.nombre, c.apellido].filter(Boolean).join(' ') })));
        if (!data || data.length < 1000) break;
      }
      G.datos = calcular(res || [], clientes, U().hoy());
      return G.datos;
    })();
    try { return await G.cargando; } finally { G.cargando = null; }
  }

  function estilos() {
    U().estilos();
    if (document.getElementById('grupos-estilos')) return;
    const s = document.createElement('style'); s.id = 'grupos-estilos';
    s.textContent = `
      .gr-tarjetas{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0 14px}
      .gr-t{border:1px solid var(--border,#e8e8ef);border-left:4px solid var(--gr-c);border-radius:12px;padding:10px 12px;background:var(--bg-surface-2,transparent);color:var(--text-primary,inherit);text-align:left;font:inherit;cursor:pointer;min-width:0}
      .gr-t.on{outline:2px solid var(--gr-c);outline-offset:1px}
      .gr-t b{display:flex;justify-content:space-between;gap:6px;font-size:13.5px}
      .gr-t .gr-n{font-size:20px;font-weight:800;display:block;margin-top:2px}
      .gr-t small{display:block;font-size:11.5px;color:var(--text-muted,#71717a);overflow-wrap:anywhere}
      .gr-cab{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start;padding:10px 12px;border-radius:12px;background:var(--bg-surface-2,rgba(127,127,127,.06));border:1px solid var(--border,#e8e8ef);margin-bottom:8px}
      .gr-cab div{min-width:0;font-size:12.5px}
      .gr-fila{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border,#e8e8ef);font-size:12.5px}
      .gr-fila .gr-txt{flex:1;min-width:0}
      .gr-fila .gr-txt b{display:block;overflow-wrap:anywhere;cursor:pointer}
      .gr-fila .gr-txt small{color:var(--text-muted,#71717a)}
      .gr-pts{flex:none;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;border:3px solid var(--gr-c);color:var(--text-primary,inherit)}
      .gr-acc{display:flex;gap:4px;flex:none}
      .gr-insignia{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid var(--gr-c);color:var(--text-primary,inherit);margin-bottom:8px}
      @media (max-width:1100px){ .gr-tarjetas{grid-template-columns:repeat(2,minmax(0,1fr))} }
      @media (max-width:420px){ .gr-fila{flex-wrap:wrap} .gr-acc{width:100%;justify-content:flex-end} }`;
    document.head.appendChild(s);
  }

  function textoDias(d) { return d == null ? 'Nunca ha comprado' : d === 0 ? 'Compró hoy' : d === 1 ? 'Compró ayer' : `Última compra hace ${d} días`; }

  async function montar(cont, { alAbrirCliente } = {}) {
    estilos();
    if (!cont) return;
    cont.innerHTML = '<div class="crm-vacio">Calculando grupos con tus ventas…</div>';
    let l;
    try { l = await cargar(true); } catch (e) { console.error('grupos:', e); cont.innerHTML = '<div class="crm-vacio">No se pudieron calcular los grupos.</div>'; return; }
    const cuenta = {}, suma = {};
    ORDEN.forEach(k => { cuenta[k] = 0; suma[k] = 0; });
    l.forEach(c => { cuenta[c.grupo]++; suma[c.grupo] += c.monto_12m; });
    if (!G.sel) G.sel = ['en_riesgo', 'campeon', 'leal', 'nuevo', 'prometedor', 'dormido', 'perdido', 'sin_compras'].find(k => cuenta[k]) || 'campeon';
    const pintar = () => {
      const g = GRUPOS[G.sel], lista = l.filter(c => c.grupo === G.sel).sort((a, b) => b.puntaje - a.puntaje || b.monto_12m - a.monto_12m);
      cont.innerHTML = `<div class="crm-ayuda" style="font-size:12.5px">El sistema separa solo a tus clientes según <b>qué tan reciente</b> compraron, <b>cada cuánto</b> y <b>cuánto</b> (últimos 12 meses, con sus ventas reales). Se actualiza cada vez que abres esta pestaña.</div>
        <div class="gr-tarjetas">${ORDEN.map(k => `<button type="button" class="gr-t ${k === G.sel ? 'on' : ''}" style="--gr-c:${GRUPOS[k].c}" data-gr="${k}">
          <b><span>${GRUPOS[k].i} ${GRUPOS[k].t}</span></b><span class="gr-n">${cuenta[k]}</span>
          <small>${k === 'sin_compras' ? esc(GRUPOS[k].d) : esc(G.fmt(suma[k])) + ' en 12 meses'}</small></button>`).join('')}</div>
        <div class="gr-cab" style="--gr-c:${g.c}"><div><b style="font-size:14px">${g.i} ${g.t} · ${lista.length}</b><br>${esc(g.d)}<br><b>Qué hacer:</b> ${esc(g.a)}</div>
          ${lista.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="crm-btn" data-gr-tareas>⏰ Recordatorio para todos</button><button type="button" class="crm-btn" data-gr-excel>📥 Excel</button></div>` : ''}</div>
        <div>${lista.length ? lista.slice(0, 300).map(c => `<div class="gr-fila" style="--gr-c:${g.c}">
            <div class="gr-pts" title="Puntaje de 0 a 100">${c.puntaje}</div>
            <div class="gr-txt"><b data-gr-ficha="${esc(c.id)}">${esc(c.nombre)}</b>
              <small>${esc(textoDias(c.diasUltima))}${c.compras ? ` · ${c.compras_12m} compra${c.compras_12m === 1 ? '' : 's'} en 12 meses · ${esc(G.fmt(c.monto_12m))}` : ''}</small></div>
            <div class="gr-acc">${window.N360CRM.numeroWhatsApp(c) ? `<button type="button" class="crm-mini" title="WhatsApp" aria-label="WhatsApp a ${esc(c.nombre)}" data-gr-wa="${esc(c.id)}">💬</button>` : ''}
              <button type="button" class="crm-mini" title="Recordatorio" aria-label="Recordatorio para ${esc(c.nombre)}" data-gr-tarea="${esc(c.id)}">⏰</button></div></div>`).join('')
          + (lista.length > 300 ? `<div class="crm-vacio">Se muestran los primeros 300. Descarga el Excel para verlos todos.</div>` : '')
          : '<div class="crm-vacio">Ningún cliente en este grupo.</div>'}</div>`;
    };
    pintar();
    const porId = id => l.find(c => c.id === id);
    cont.onclick = async e => {
      const t = e.target;
      const gb = t.closest('[data-gr]'); if (gb) { G.sel = gb.dataset.gr; pintar(); return; }
      const f = t.closest('[data-gr-ficha]'); if (f && alAbrirCliente) return alAbrirCliente(f.dataset.grFicha);
      const w = t.closest('[data-gr-wa]'); if (w) { const c = porId(w.dataset.grWa); if (c) abrirWhatsAppGrupo(c); return; }
      const ta = t.closest('[data-gr-tarea]'); if (ta) { const c = porId(ta.dataset.grTarea); if (c) window.N360CRM.abrirTarea(c, { tipo: 'whatsapp', titulo: `${GRUPOS[c.grupo].i} Contactar a ${c.nombre} (${GRUPOS[c.grupo].t})` }); return; }
      if (t.closest('[data-gr-tareas]')) return tareasParaTodos(l.filter(c => c.grupo === G.sel), t.closest('[data-gr-tareas]'));
      if (t.closest('[data-gr-excel]')) return excel(l.filter(c => c.grupo === G.sel));
    };
  }

  // WhatsApp con el mensaje sugerido del grupo ya escrito (se puede cambiar antes de enviar).
  function abrirWhatsAppGrupo(c) {
    window.N360CRM.abrirWhatsApp(c, {});
    setTimeout(() => {
      const ta = document.getElementById('crm-w-texto');
      if (ta && !ta.value) { const ctx = U().contexto(); ta.value = GRUPOS[c.grupo].msg.replace(/\{nombre\}/gi, String(c.nombre || '').split(' ')[0]).replace(/\{negocio\}/gi, ctx.negocio || 'nuestro negocio'); }
    }, 300);
  }

  async function tareasParaTodos(lista, btn) {
    const g = GRUPOS[G.sel], n = Math.min(lista.length, 300);
    if (!confirm(`¿Crear un recordatorio para hoy para ${n} cliente${n === 1 ? '' : 's'} de "${g.t}"?\n\nLos verás en la pestaña Seguimientos.`)) return;
    btn.disabled = true;
    try {
      const ctx = U().contexto(), hoy = U().hoy();
      const filas = lista.slice(0, 300).map(c => ({ auth_user_id: G.userId, cliente_id: c.id, titulo: `${g.i} Contactar a ${c.nombre} (${g.t})`.slice(0, 200), notas: g.a, tipo: 'whatsapp', vence_en: hoy, hecha: false, creado_por: ctx.usuario || null }));
      for (let i = 0; i < filas.length; i += 100) { const { error } = await G.sb.from('crm_tareas').insert(filas.slice(i, i + 100)); if (error) throw error; }
      U().aviso(`⏰ ${filas.length} recordatorio${filas.length === 1 ? '' : 's'} para hoy`);
    } catch (e) { console.error('grupos tareas:', e); U().aviso('No se pudieron crear los recordatorios', 'error'); }
    finally { btn.disabled = false; }
  }

  function excel(lista) {
    if (!window.XLSX) { U().aviso('No se pudo preparar el Excel', 'error'); return; }
    const g = GRUPOS[G.sel];
    const filas = lista.map(c => ({ Cliente: c.nombre, Teléfono: c.telefono || c.whatsapp || '', Grupo: g.t, Puntaje: c.puntaje,
      'Última compra': c.ultima || '', 'Días sin comprar': c.diasUltima == null ? '' : c.diasUltima, 'Compras 12 meses': c.compras_12m, 'Monto 12 meses': c.monto_12m, 'Compras total': c.compras, 'Monto total': c.monto }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), g.t.slice(0, 30));
    XLSX.writeFile(wb, `clientes-${G.sel}-${U().hoy()}.xlsx`);
  }

  // Insignia para la ficha del cliente: "🏆 Campeones · 87 pts"
  async function insignia(cont, clienteId) {
    estilos();
    if (!cont) return;
    try {
      const l = await cargar();
      const c = l.find(x => x.id === clienteId);
      if (!c) { cont.innerHTML = ''; return; }
      const g = GRUPOS[c.grupo];
      cont.innerHTML = `<span class="gr-insignia" style="--gr-c:${g.c}" title="${esc(g.d + ' ' + g.a)}">${g.i} ${esc(g.t)}${c.compras ? ` · ${c.puntaje} pts` : ''}</span>`;
    } catch (e) { cont.innerHTML = ''; }
  }

  window.N360Grupos = {
    init({ sb, userId, fmt }) { G.sb = sb; G.userId = userId; if (fmt) G.fmt = fmt; G.datos = null; },
    montar, insignia, calcular, GRUPOS, refrescar: () => { G.datos = null; },
  };
})();
