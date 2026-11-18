/* ============================================================
   TRANSPORTE-TRACKING.JS — NEGOCIO360 · Tracking de cada orden
   (pedido de Bryan).

   - Cada orden tiene su línea de tiempo: no hay que crearla aparte.
   - Se llena sola con lo que ya existe (orden creada, salida, cruces de
     frontera, entrega) y con las actualizaciones a mano: fecha y hora,
     estatus (lista + personalizados), país y nota.
   - Días libres vs. días usados (bloques de 24 h) desde "Cargando"
     hasta "Descarga completa" → demora.
   - Reporte "Tracking de la unidad" en PDF y Excel.

   Escribe SOLO en transporte_tracking (y dias_libres de la orden desde
   el formulario de la orden). No toca cobros, facturas ni liquidaciones.
   ============================================================ */
(function () {
  'use strict';
  if (window.TXTrack) return;
  const esc = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const $ = id => document.getElementById(id);
  const H = 3600000;

  // Estatus base. "hito" marca desde/hasta cuándo se cuentan los días (no se pueden quitar).
  const ESTATUS_BASE = [
    { n: 'Cargando', ico: '📦', hito: 'inicio_carga' },
    { n: 'Carga completa', ico: '✅' },
    { n: 'En tránsito', ico: '🚚' },
    { n: 'En frontera', ico: '🛂' },
    { n: 'En aduana', ico: '🏛️' },
    { n: 'Detenido', ico: '⏸️' },
    { n: 'Descargando', ico: '📥' },
    { n: 'Descarga completa', ico: '🏁', hito: 'fin_descarga' },
    { n: 'Entregado', ico: '🤝' },
  ];
  const PAISES_BASE = ['México', 'Guatemala', 'El Salvador', 'Honduras', 'Nicaragua', 'Costa Rica', 'Panamá'];

  const ST = { filas: [], cruces: [], editando: null, ordenId: null, sel: { estatus: null, pais: null } };

  /* ---------------- configuración (estatus y países extra) ---------------- */
  function cfg() {
    const m = (window.TX && TX.empresaConfig && TX.empresaConfig.metadata) || {};
    const c = (m && typeof m === 'object' && m.transporteTracking) || {};
    return { estatus: Array.isArray(c.estatus) ? c.estatus.filter(x => typeof x === 'string' && x.trim()) : [],
             paises: Array.isArray(c.paises) ? c.paises.filter(x => typeof x === 'string' && x.trim()) : null };
  }
  function listaEstatus() {
    const extra = cfg().estatus.filter(n => !ESTATUS_BASE.some(b => b.n.toLowerCase() === n.toLowerCase()));
    return ESTATUS_BASE.concat(extra.map(n => ({ n, ico: '📍', propio: true })));
  }
  function listaPaises() { return cfg().paises || PAISES_BASE; }
  function infoEstatus(n) { return listaEstatus().find(e => e.n.toLowerCase() === String(n || '').toLowerCase()) || { n, ico: '📍' }; }

  /* ---------------- carga ---------------- */
  async function cargar() {
    try {
      ST.filas = await TX.paginar(() => TX.sb.from('transporte_tracking').select('*').eq('auth_user_id', TX.userId).order('fecha_hora', { ascending: true }));
    } catch (e) { console.warn('Tracking: no se pudo cargar', e); ST.filas = []; }
    try {
      ST.cruces = await TX.paginar(() => TX.sb.from('transporte_cruces').select('*').eq('auth_user_id', TX.userId));
    } catch (_) { ST.cruces = []; }
  }
  const filasDe = id => ST.filas.filter(f => f.orden_id === id);

  /* ---------------- línea de tiempo (manual + automático) ---------------- */
  function eventos(o) {
    const ev = filasDe(o.id).map(f => ({ id: f.id, t: f.fecha_hora, estatus: f.estatus, ico: infoEstatus(f.estatus).ico, pais: f.pais || '', nota: f.nota || '', hito: f.hito || null, por: f.creado_por_nombre || '', manual: true }));
    const auto = (t, estatus, ico, nota, pais) => { if (t) ev.push({ t, estatus, ico, nota: nota || '', pais: pais || '', manual: false }); };
    auto(o.created_at, 'Orden creada', '📋', '');
    auto(o.salida_real, 'Salida — inicio del viaje', '🚦', o.odometro_salida != null ? `Km ${Number(o.odometro_salida).toLocaleString('es-NI')}` : '');
    ST.cruces.filter(c => c.orden_id === o.id).forEach(c => {
      auto(c.llegada_en, `Llegó a frontera ${c.frontera || ''}`.trim(), '🛂', c.referencia ? 'Ref. ' + c.referencia : '');
      auto(c.cruce_en, `Cruzó frontera ${c.frontera || ''}`.trim(), '✅', c.agente_aduanal ? 'Agente: ' + c.agente_aduanal : '');
    });
    auto(o.entrega_real, 'Entrega registrada', '✅', o.receptor ? 'Recibió: ' + o.receptor : '');
    return ev.sort((a, b) => new Date(a.t) - new Date(b.t));
  }

  /* ---------------- días libres y demora (bloques de 24 h) ---------------- */
  function demora(o, ahora) {
    const fs = filasDe(o.id);
    const ini = fs.filter(f => f.hito === 'inicio_carga').map(f => new Date(f.fecha_hora)).sort((a, b) => a - b)[0] || null;
    const fin = ini ? (fs.filter(f => f.hito === 'fin_descarga' && new Date(f.fecha_hora) >= ini).map(f => new Date(f.fecha_hora)).sort((a, b) => a - b)[0] || null) : null;
    const libres = o.dias_libres == null || o.dias_libres === '' ? null : Number(o.dias_libres);
    const r = { ini, fin, libres, horas: 0, excesoH: 0, demoraDias: 0, demoraFraccion: 0, estado: 'sin_inicio', clase: 'gris' };
    if (!ini) return r;
    const hasta = fin || (['cancelada'].includes(o.estado) ? ini : (ahora || new Date()));
    r.horas = Math.max(0, (hasta - ini) / H);
    r.estado = fin ? 'terminado' : 'en_curso';
    if (libres == null) { r.clase = 'azul'; return r; }
    r.excesoH = r.horas - libres * 24;
    if (r.excesoH > 0) {
      r.demoraDias = Math.floor(r.excesoH / 24);                // días completos de demora
      r.demoraFraccion = Math.ceil(r.excesoH / 24 - 1e-9);      // contando día o fracción
      r.clase = 'rojo';
    } else r.clase = (libres * 24 - r.horas) <= 24 ? 'naranja' : 'verde';
    return r;
  }
  const durTxt = h => { const d = Math.floor(h / 24), hr = Math.floor(h - d * 24); return `${d} día${d === 1 ? '' : 's'}${hr ? ` ${hr} h` : ''}`; };
  function demoraTexto(d) {
    if (d.estado === 'sin_inicio') return { titulo: 'Aún no inicia la carga', det: 'Los días se cuentan desde el estatus “Cargando” hasta “Descarga completa”.' };
    const usados = durTxt(d.horas);
    if (d.libres == null) return { titulo: `${d.estado === 'terminado' ? 'Usó' : 'Lleva'} ${usados}`, det: 'Pon los días libres en la orden (✏️ Editar) para calcular la demora.' };
    if (d.excesoH > 0) return { titulo: `Demora: ${durTxt(d.excesoH)}`, det: `Usados ${usados} de ${d.libres} día${d.libres === 1 ? '' : 's'} libre${d.libres === 1 ? '' : 's'} · ${d.demoraFraccion} día${d.demoraFraccion === 1 ? '' : 's'} de demora contando día o fracción` };
    const dia = Math.min(d.libres, Math.floor(d.horas / 24) + 1);
    return { titulo: d.estado === 'terminado' ? `Sin demora · usó ${usados}` : `Día ${dia} de ${d.libres} libre${d.libres === 1 ? '' : 's'}`,
             det: `${d.estado === 'terminado' ? 'Terminó' : 'Le quedan'} ${durTxt(Math.max(0, d.libres * 24 - d.horas))} ${d.estado === 'terminado' ? 'antes de agotar los días libres' : 'de días libres'}` };
  }
  // Chip para las tarjetas del tablero
  function chip(o) {
    if (o.estado === 'cancelada') return '';
    const d = demora(o); if (d.estado === 'sin_inicio') return '';
    if (d.libres == null) return d.estado === 'en_curso' ? `<span class="tx-chip azul">⏱ ${esc(durTxt(d.horas))}</span>` : '';
    if (d.excesoH > 0) return `<span class="tx-chip rojo">⏱ Demora ${esc(durTxt(d.excesoH))}</span>`;
    if (d.estado === 'terminado') return `<span class="tx-chip verde">⏱ Sin demora</span>`;
    return `<span class="tx-chip ${d.clase}">⏱ Día ${Math.min(d.libres, Math.floor(d.horas / 24) + 1)}/${esc(d.libres)}</span>`;
  }

  /* ---------------- pestaña ---------------- */
  const fh = iso => { const d = new Date(iso); return { f: d.toLocaleDateString('es-NI', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }), h: d.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }) }; };
  function tab(o) {
    const ev = eventos(o), d = demora(o), dt = demoraTexto(d), puede = o.estado !== 'cancelada';
    const ult = [...ev].reverse().find(e => e.manual);
    return `
    <div class="trk-cab">
      <div class="trk-dem ${d.clase}"><b>⏱ ${esc(dt.titulo)}</b><small>${esc(dt.det)}</small>
        ${d.ini ? `<small>Inicio de carga: ${esc(fh(d.ini).f)} ${esc(fh(d.ini).h)}${d.fin ? ` · Fin de descarga: ${esc(fh(d.fin).f)} ${esc(fh(d.fin).h)}` : ''}</small>` : ''}</div>
      <div class="trk-acc">
        ${puede ? `<button type="button" class="tx-btn tx-btn-primary" data-trk-nuevo="${esc(o.id)}">＋ Actualizar tracking</button>` : ''}
        <button type="button" class="tx-btn tx-btn-sm" data-trk-pdf="${esc(o.id)}">📄 PDF</button>
        <button type="button" class="tx-btn tx-btn-sm" data-trk-xlsx="${esc(o.id)}">📊 Excel</button>
        <button type="button" class="tx-btn tx-btn-sm" data-trk-config="1" title="Agregar estatus o países propios">⚙️</button>
      </div>
    </div>
    ${ult ? `<div class="trk-ultimo">Último estatus: <b>${esc(ult.ico)} ${esc(ult.estatus)}</b>${ult.pais ? ' · ' + esc(ult.pais) : ''} · ${esc(fh(ult.t).f)} ${esc(fh(ult.t).h)}</div>` : ''}
    <div class="trk-lista">${ev.length ? ev.slice().reverse().map(e => `
      <div class="trk-ev ${e.manual ? '' : 'auto'} ${e.hito ? 'hito' : ''}">
        <div class="trk-ico">${esc(e.ico)}</div>
        <div class="trk-info"><b>${esc(e.estatus)}${e.pais ? ` <span class="tx-chip">${esc(e.pais)}</span>` : ''}${e.hito === 'inicio_carga' ? ' <span class="tx-chip azul">inicia el conteo</span>' : e.hito === 'fin_descarga' ? ' <span class="tx-chip azul">termina el conteo</span>' : ''}</b>
          <small>${esc(fh(e.t).f)} · ${esc(fh(e.t).h)}${e.manual ? (e.por ? ' · ' + esc(e.por) : '') : ' · automático'}</small>
          ${e.nota ? `<small class="trk-nota">📝 ${esc(e.nota)}</small>` : ''}</div>
        ${e.manual && puede ? `<div class="tx-doc-acc"><button type="button" class="tx-btn tx-btn-sm" data-trk-editar="${esc(e.id)}" aria-label="Editar">✏️</button><button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-trk-borrar="${esc(e.id)}" aria-label="Borrar">🗑</button></div>` : ''}
      </div>`).join('') : '<div class="tx-vacio" style="padding:24px 12px"><div class="tx-vacio-i">📍</div><b>Sin movimientos todavía</b><p>Toca “Actualizar tracking” para anotar el estatus de la unidad.</p></div>'}</div>`;
  }

  /* ---------------- modal: actualizar ---------------- */
  function asegurarModal() {
    if ($('trk-modal')) return;
    const st = document.createElement('style');
    st.textContent = `
.trk-cab{display:flex;gap:12px;align-items:stretch;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}
.trk-dem{flex:1 1 280px;display:flex;flex-direction:column;gap:3px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg-surface)}
.trk-dem b{font-size:16px}.trk-dem small{font-size:12px;color:var(--text-secondary)}
.trk-dem.verde{border-color:var(--success);background:var(--success-soft)}.trk-dem.verde b{color:var(--success)}
.trk-dem.naranja{border-color:var(--warning);background:var(--warning-soft)}.trk-dem.naranja b{color:var(--warning)}
.trk-dem.rojo{border-color:var(--danger);background:var(--danger-soft)}.trk-dem.rojo b{color:var(--danger)}
.trk-dem.azul{border-color:var(--accent);background:var(--accent-soft)}.trk-dem.azul b{color:var(--accent)}
.trk-acc{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.trk-ultimo{font-size:13px;color:var(--text-secondary);margin:2px 0 10px}
.trk-lista{position:relative;padding-left:4px}
.trk-ev{display:flex;gap:12px;align-items:flex-start;padding:10px 4px;border-bottom:1px solid var(--border)}
.trk-ev.auto{opacity:.85}.trk-ev.hito .trk-ico{box-shadow:0 0 0 3px var(--accent-soft)}
.trk-ico{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--bg-hover);font-size:17px}
.trk-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.trk-info b{font-size:14px}.trk-info small{font-size:12px;color:var(--text-muted)}
.trk-nota{color:var(--text-secondary)!important}
.trk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
.trk-op{min-height:44px;border:1.5px solid var(--border);border-radius:10px;background:var(--bg-surface);color:var(--text-primary);font:inherit;font-size:13px;font-weight:700;cursor:pointer;padding:6px 8px;text-align:left}
.trk-op.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
.trk-op small{display:block;font-size:10.5px;font-weight:600;color:var(--text-muted)}
@media (max-width:600px){.trk-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
    document.head.appendChild(st);
    const m = document.createElement('div');
    m.className = 'tx-modal'; m.id = 'trk-modal';
    m.innerHTML = `<div class="tx-box ancho">
      <h3 id="trk-titulo">Actualizar tracking</h3>
      <div class="tx-sec">Estatus</div><div class="trk-grid" id="trk-estatus"></div>
      <div class="tx-campo" style="margin-top:8px"><label for="trk-otro">…u otro estatus (escríbelo)</label><input class="tx-in" id="trk-otro" maxlength="60" placeholder="Ej: Esperando documentos"/></div>
      <div class="tx-sec">País donde va</div><div class="trk-grid" id="trk-paises"></div>
      <div class="tx-cols" style="margin-top:8px">
        <div class="tx-campo"><label for="trk-fecha">Fecha y hora</label><input type="datetime-local" class="tx-in" id="trk-fecha"/></div>
        <div class="tx-campo"><label for="trk-nota">Nota (opcional)</label><input class="tx-in" id="trk-nota" maxlength="300" placeholder="Ej: Km 45, lluvia, en fila de aduana"/></div>
      </div>
      <div class="tx-err" id="trk-error"></div>
      <div class="tx-pie"><button type="button" class="tx-btn" onclick="TXcerrar('trk-modal')">Cancelar</button><button type="button" class="tx-btn tx-btn-primary" id="trk-guardar">Guardar</button></div>
    </div>`;
    document.body.appendChild(m);
    const c = document.createElement('div');
    c.className = 'tx-modal'; c.id = 'trk-modal-config';
    c.innerHTML = `<div class="tx-box">
      <h3>Tracking · estatus y países propios</h3>
      <div class="tx-ayuda">Los estatus base siempre están (“Cargando” y “Descarga completa” marcan el conteo de días). Aquí agregas los tuyos, uno por línea.</div>
      <div class="tx-campo"><label for="trk-cfg-estatus">Estatus propios</label><textarea class="tx-in" id="trk-cfg-estatus" rows="4" placeholder="Esperando documentos&#10;En báscula"></textarea></div>
      <div class="tx-campo"><label for="trk-cfg-paises">Países (uno por línea)</label><textarea class="tx-in" id="trk-cfg-paises" rows="6"></textarea></div>
      <div class="tx-err" id="trk-cfg-error"></div>
      <div class="tx-pie"><button type="button" class="tx-btn" onclick="TXcerrar('trk-modal-config')">Cancelar</button><button type="button" class="tx-btn tx-btn-primary" id="trk-cfg-guardar">Guardar</button></div></div>`;
    document.body.appendChild(c);
    $('trk-guardar').addEventListener('click', guardar);
    $('trk-cfg-guardar').addEventListener('click', guardarConfig);
    $('trk-otro').addEventListener('input', () => { if ($('trk-otro').value.trim()) { ST.sel.estatus = null; pintarOpciones(); } });
    m.addEventListener('click', ev => {
      const b = ev.target.closest('[data-trk-est],[data-trk-pais]'); if (!b) return;
      if (b.dataset.trkEst != null) { ST.sel.estatus = b.dataset.trkEst; $('trk-otro').value = ''; }
      else ST.sel.pais = ST.sel.pais === b.dataset.trkPais ? null : b.dataset.trkPais;
      pintarOpciones();
    });
  }
  function pintarOpciones() {
    $('trk-estatus').innerHTML = listaEstatus().map(e => `<button type="button" class="trk-op ${ST.sel.estatus === e.n ? 'on' : ''}" data-trk-est="${esc(e.n)}">${esc(e.ico)} ${esc(e.n)}${e.hito === 'inicio_carga' ? '<small>inicia conteo de días</small>' : e.hito === 'fin_descarga' ? '<small>termina conteo de días</small>' : ''}</button>`).join('');
    const ps = listaPaises().slice(); if (ST.sel.pais && !ps.includes(ST.sel.pais)) ps.push(ST.sel.pais);
    $('trk-paises').innerHTML = ps.map(p => `<button type="button" class="trk-op ${ST.sel.pais === p ? 'on' : ''}" data-trk-pais="${esc(p)}">${esc(p)}</button>`).join('');
  }
  const aLocal = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
  function abrirNuevo(ordenId, filaId) {
    asegurarModal();
    const f = filaId ? ST.filas.find(x => x.id === filaId) : null;
    ST.ordenId = ordenId; ST.editando = f;
    const prev = [...filasDe(ordenId)].reverse()[0];
    ST.sel = { estatus: f ? (listaEstatus().some(e => e.n === f.estatus) ? f.estatus : null) : null, pais: f ? (f.pais || null) : (prev && prev.pais) || null };
    $('trk-otro').value = f && !listaEstatus().some(e => e.n === f.estatus) ? f.estatus : '';
    $('trk-fecha').value = aLocal(f ? new Date(f.fecha_hora) : new Date());
    $('trk-nota').value = f ? (f.nota || '') : '';
    $('trk-titulo').textContent = f ? 'Corregir movimiento' : 'Actualizar tracking';
    $('trk-error').textContent = '';
    pintarOpciones();
    TX.abrir('trk-modal');
  }
  async function guardar() {
    const err = t => { $('trk-error').textContent = t; };
    const estatus = ($('trk-otro').value.trim() || ST.sel.estatus || '').trim();
    if (!estatus) return err('Elige un estatus o escríbelo.');
    if (estatus.length > 60) return err('El estatus es muy largo (máximo 60 letras).');
    const v = $('trk-fecha').value; const fecha = v ? new Date(v) : null;
    if (!fecha || isNaN(fecha)) return err('Indica la fecha y hora.');
    if (fecha.getTime() > Date.now() + 10 * 60000) return err('La fecha y hora no puede estar en el futuro.');
    const o = (window.OT && OT.ordenes || []).find(x => x.id === ST.ordenId);
    if (!o) return err('No se encontró la orden. Recarga la página.');
    if (o.estado === 'cancelada') return err('La orden está cancelada.');
    const hito = (listaEstatus().find(e => e.n.toLowerCase() === estatus.toLowerCase()) || {}).hito || null;
    const p = { fecha_hora: fecha.toISOString(), estatus, hito, pais: ST.sel.pais || null, nota: $('trk-nota').value.trim() || null };
    const btn = $('trk-guardar'); btn.disabled = true;
    try {
      if (ST.editando) {
        const { data, error } = await TX.sb.from('transporte_tracking').update(p).eq('id', ST.editando.id).eq('auth_user_id', TX.userId).select().single();
        if (error) throw error; Object.assign(ST.editando, data || p);
      } else {
        const { data, error } = await TX.sb.from('transporte_tracking').insert({ ...p, orden_id: o.id, auth_user_id: TX.userId, creado_por_nombre: TX.nombrePerfilActivo ? TX.nombrePerfilActivo() : null }).select().single();
        if (error) throw error; ST.filas.push(data);
      }
      ST.filas.sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora));
      TX.cerrar('trk-modal'); TX.toast('Tracking actualizado');
      if (typeof api.alCambiar === 'function') api.alCambiar();
    } catch (e) { console.error(e); err('No se pudo guardar. Revisa tu conexión e intenta de nuevo.'); }
    finally { btn.disabled = false; }
  }
  async function borrar(id) {
    const f = ST.filas.find(x => x.id === id); if (!f) return;
    const ok = await TX.confirmar('Borrar movimiento', `¿Borrar “${f.estatus}” del ${new Date(f.fecha_hora).toLocaleString('es-NI')}? Esto no se puede deshacer.`, 'Borrar', true);
    if (!ok) return;
    try {
      const { error } = await TX.sb.from('transporte_tracking').delete().eq('id', id).eq('auth_user_id', TX.userId);
      if (error) throw error;
      ST.filas = ST.filas.filter(x => x.id !== id); TX.toast('Movimiento borrado');
      if (typeof api.alCambiar === 'function') api.alCambiar();
    } catch (e) { console.error(e); TX.toast('No se pudo borrar. Intenta de nuevo.', 'error'); }
  }

  /* ---------------- configuración ---------------- */
  function abrirConfig() {
    asegurarModal();
    const c = cfg();
    $('trk-cfg-estatus').value = c.estatus.join('\n');
    $('trk-cfg-paises').value = (c.paises || PAISES_BASE).join('\n');
    $('trk-cfg-error').textContent = '';
    TX.abrir('trk-modal-config');
  }
  async function guardarConfig() {
    const limpiar = t => [...new Set(t.split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 40);
    const estatus = limpiar($('trk-cfg-estatus').value).filter(x => x.length <= 60);
    const paises = limpiar($('trk-cfg-paises').value).filter(x => x.length <= 60);
    if (!paises.length) { $('trk-cfg-error').textContent = 'Deja al menos un país.'; return; }
    const btn = $('trk-cfg-guardar'); btn.disabled = true;
    try {
      // Lee la metadata fresca para no pisar otras configuraciones guardadas ahí.
      const { data, error: e1 } = await TX.sb.from('configuracion_empresa').select('metadata').eq('auth_user_id', TX.userId).maybeSingle();
      if (e1) throw e1;
      const meta = (data && data.metadata && typeof data.metadata === 'object') ? data.metadata : {};
      const nueva = { ...meta, transporteTracking: { estatus, paises } };
      const { error } = await TX.sb.from('configuracion_empresa').update({ metadata: nueva }).eq('auth_user_id', TX.userId);
      if (error) throw error;
      TX.empresaConfig = { ...(TX.empresaConfig || {}), metadata: nueva };
      TX.cerrar('trk-modal-config'); TX.toast('Listo: estatus y países guardados');
      if (typeof api.alCambiar === 'function') api.alCambiar();
    } catch (e) { console.error(e); $('trk-cfg-error').textContent = 'No se pudo guardar. Intenta de nuevo.'; }
    finally { btn.disabled = false; }
  }

  /* ---------------- reportes ---------------- */
  function cargarScript(src) {
    return new Promise((ok, no) => {
      if (document.querySelector(`script[src="${src}"]`)) { const t = setInterval(() => { if ((src.includes('jspdf') && window.jspdf) || (src.includes('xlsx') && window.XLSX)) { clearInterval(t); ok(); } }, 50); setTimeout(() => { clearInterval(t); ok(); }, 8000); return; }
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('No se pudo cargar ' + src)); document.head.appendChild(s);
    });
  }
  function datosReporte(o) {
    const u = o.unidad_id && window.OT ? OT.unidades.find(x => x.id === o.unidad_id) : null;
    const rem = o.remolque_id && window.OT ? OT.unidades.find(x => x.id === o.remolque_id) : null;
    const c = o.conductor_id && window.OT ? OT.conductores.find(x => x.id === o.conductor_id) : null;
    const ruta = o.ruta_id && window.OT ? OT.rutas.find(x => x.id === o.ruta_id) : null;
    const d = demora(o), dt = demoraTexto(d);
    const filas = eventos(o).map(e => { const x = fh(e.t); return [x.f, x.h, `${e.estatus}${e.manual ? '' : ' (automático)'}`, e.pais || '', e.nota || '']; });
    const cab = [
      ['Orden', o.numero || ''], ['Cliente', o.cliente_nombre || ''], ['Ruta', ruta ? ruta.nombre : `${o.origen || ''} → ${o.destino || ''}`],
      ['Unidad', u ? `${u.nombre}${u.placa ? ' · ' + u.placa : ''}` : '—'], ['Remolque / furgón', rem ? `${rem.nombre}${rem.placa ? ' · ' + rem.placa : ''}` : '—'],
      ['Conductor', c ? c.nombre : '—'], ['Carga', o.carga_descripcion || '—'],
    ];
    const res = [
      ['Inicio de carga', d.ini ? `${fh(d.ini).f} ${fh(d.ini).h}` : '—'], ['Fin de descarga', d.fin ? `${fh(d.fin).f} ${fh(d.fin).h}` : (d.ini ? 'En curso' : '—')],
      ['Días libres', d.libres == null ? 'No indicados' : String(d.libres)], ['Tiempo usado', d.ini ? durTxt(d.horas) : '—'],
      ['Demora', d.libres == null || !d.ini ? '—' : (d.excesoH > 0 ? `${durTxt(d.excesoH)} (${d.demoraFraccion} día${d.demoraFraccion === 1 ? '' : 's'} contando día o fracción)` : 'Sin demora')],
    ];
    return { cab, res, filas, titulo: `Tracking de la unidad · ${o.numero || ''}`, resumen: dt.titulo };
  }
  async function pdf(o) {
    try {
      await cargarScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
      await cargarScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.7.1/dist/jspdf.plugin.autotable.min.js');
      const R = datosReporte(o); const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const neg = (TX.empresaConfig && (TX.empresaConfig.nombre_comercial || TX.empresaConfig.nombre_negocio)) || 'Negocio360';
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(R.titulo, 40, 46);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110); doc.text(`${neg} · generado ${new Date().toLocaleString('es-NI')}`, 40, 62); doc.setTextColor(0);
      const pdfTxt = v => String(v == null ? '' : v).replace(/→/g, '-').replace(/[^\x00-\xFF]/g, '');   // la fuente del PDF no tiene flechas ni emojis
      R.cab = R.cab.map(r => r.map(pdfTxt)); R.filas = R.filas.map(r => r.map(pdfTxt)); R.res = R.res.map(r => r.map(pdfTxt));
      doc.autoTable({ startY: 76, body: R.cab, theme: 'plain', styles: { fontSize: 10, cellPadding: 3 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 } } });
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 10, head: [['Fecha', 'Hora', 'Estatus', 'País', 'Nota']], body: R.filas.length ? R.filas : [['—', '', 'Sin movimientos', '', '']],
        styles: { fontSize: 9.5, cellPadding: 4 }, headStyles: { fillColor: [90, 90, 244] }, columnStyles: { 0: { cellWidth: 96 }, 1: { cellWidth: 66 }, 3: { cellWidth: 80 } } });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Días libres y demora', 40, doc.lastAutoTable.finalY + 24);
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 30, body: R.res, theme: 'grid', styles: { fontSize: 10, cellPadding: 4 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 140 } } });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(120);
      doc.text('Días contados en bloques de 24 horas desde el estatus "Cargando" hasta "Descarga completa".', 40, doc.lastAutoTable.finalY + 16);
      doc.save(`Tracking_${(o.numero || 'orden').replace(/[^\w-]/g, '_')}.pdf`);
    } catch (e) { console.error(e); TX.toast('No se pudo generar el PDF. Revisa tu conexión.', 'error'); }
  }
  async function excel(o) {
    try {
      await cargarScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      const R = datosReporte(o);
      const aoa = [[R.titulo], [], ...R.cab, [], ['Fecha', 'Hora', 'Estatus', 'País', 'Nota'], ...R.filas, [], ['Días libres y demora'], ...R.res,
        [], ['Días contados en bloques de 24 horas desde "Cargando" hasta "Descarga completa".']];
      const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 34 }, { wch: 16 }, { wch: 40 }];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Tracking');
      XLSX.writeFile(wb, `Tracking_${(o.numero || 'orden').replace(/[^\w-]/g, '_')}.xlsx`);
    } catch (e) { console.error(e); TX.toast('No se pudo generar el Excel. Revisa tu conexión.', 'error'); }
  }

  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-trk-nuevo],[data-trk-editar],[data-trk-borrar],[data-trk-pdf],[data-trk-xlsx],[data-trk-config]'); if (!t) return;
    const d = t.dataset, orden = id => (window.OT && OT.ordenes || []).find(x => x.id === id);
    if (d.trkNuevo) abrirNuevo(d.trkNuevo);
    else if (d.trkEditar) { const f = ST.filas.find(x => x.id === d.trkEditar); if (f) abrirNuevo(f.orden_id, f.id); }
    else if (d.trkBorrar) borrar(d.trkBorrar);
    else if (d.trkPdf) { const o = orden(d.trkPdf); if (o) pdf(o); }
    else if (d.trkXlsx) { const o = orden(d.trkXlsx); if (o) excel(o); }
    else if (d.trkConfig) abrirConfig();
  });

  const api = { cargar, eventos, demora, demoraTexto, chip, tab, abrirNuevo, abrirConfig, pdf, excel, cuantos: o => filasDe(o.id).length, _st: ST, alCambiar: null };
  window.TXTrack = api;
})();
