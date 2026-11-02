/* =====================================================
   MENSAJERIA-DESPACHO.JS — NEGOCIO360 · Mensajería: Despacho
   Tablero por estado. Se marcan envíos y se asignan a un repartidor
   (uno o varios a la vez). Muestra la carga de cada repartidor y el
   efectivo que anda en la calle (aviso si pasa su tope).
   Todo cambio pasa por funciones del servidor (msj_*).
===================================================== */
'use strict';
const TD = { lista: [], reps: [], zonas: [], cfg: {}, mano: {}, sel: new Set(), ocupado: false };
const $d = id => document.getElementById(id);
const TD_COLS = [['sin', '📦 Por asignar', ['por_recoger', 'en_bodega']], ['asignado', '🧑 Asignados', ['asignado']], ['en_ruta', '🛵 En ruta', ['en_ruta']],
  ['no_entregado', '⚠️ No entregados', ['no_entregado']], ['hoy', '✅ Entregados hoy', ['entregado']]];

TD.cargar = async function () {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [act, ent, reps, cfg, mano] = await Promise.all([
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).in('estado', MS_ACTIVOS).order('created_at').limit(2000),
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).eq('estado', 'entregado').gte('entregado_at', hoy.toISOString()).order('entregado_at', { ascending: false }).limit(500),
    msRepartidores(false), msConfig(), msEfectivoEnMano(),
  ]);
  TD.lista = [...(act.data || []), ...(ent.data || [])]; TD.reps = reps; TD.cfg = cfg; TD.mano = mano;
  const vivos = new Set(TD.lista.filter(e => ['por_recoger', 'en_bodega', 'asignado', 'no_entregado'].includes(e.estado)).map(e => e.id));
  TD.sel.forEach(id => { if (!vivos.has(id)) TD.sel.delete(id); });
  TD.pintarReps(); TD.pintar();
};
TD.rep = id => TD.reps.find(r => r.id === id);
TD.carga = id => TD.lista.filter(e => e.repartidor_id === id && ['asignado', 'en_ruta'].includes(e.estado)).length;
TD.pintarReps = function () {
  const act = TD.reps.filter(r => r.activo);
  $d('d-reps').innerHTML = act.length ? act.map(r => {
    const mano = TD.mano[r.id] || 0, tope = msTope(r, TD.cfg), pasa = tope > 0 && mano > tope;
    return `<div class="ms-rep${pasa ? ' alerta' : ''}"><b>${esc(MS_VEHICULOS[r.vehiculo]?.split(' ')[0] || '🛵')} ${esc(r.nombre)}</b>
      <span>${TD.carga(r.id)} por entregar · ${TD.lista.filter(e => e.repartidor_id === r.id && e.estado === 'entregado').length} hoy</span>
      <span>💵 En mano: <b>${fmt(mano)}</b>${tope ? ' / ' + fmt(tope) : ''}</span>${msUbicLink(r)}${pasa ? '<span style="color:var(--danger);font-weight:800">⚠️ Pasó su tope: que venga a cuadrar</span>' : ''}</div>`;
  }).join('') : '<div class="tl-aviso">No tienes repartidores activos. Regístralos en “Zonas, tarifas y repartidores”.</div>';
  $d('d-rep').innerHTML = '<option value="">Elige el repartidor…</option>' + act.map(r => `<option value="${r.id}">${esc(r.nombre)} (${TD.carga(r.id)} por entregar)</option>`).join('');
  const zs = [...new Set(TD.lista.map(e => e.zona_nombre).filter(Boolean))].sort();
  const z = $d('d-zona').value; $d('d-zona').innerHTML = '<option value="">Todas las zonas</option>' + zs.map(n => `<option>${esc(n)}</option>`).join(''); $d('d-zona').value = zs.includes(z) ? z : '';
};
TD.visibles = function () {
  const q = ($d('d-buscar').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(), z = $d('d-zona').value;
  return TD.lista.filter(e => {
    if (z && e.zona_nombre !== z) return false;
    if (!q) return true;
    const t = [e.numero, e.destinatario_nombre, e.direccion, e.referencia, e.zona_nombre, e.remitente_nombre].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return q.split(/\s+/).every(p => t.includes(p));
  });
};
TD.pintar = function () {
  const l = TD.visibles();
  $d('d-tablero').innerHTML = TD_COLS.map(([k, titulo, est]) => {
    const items = l.filter(e => est.includes(e.estado)).sort((a, b) => (b.urgente - a.urgente) || String(a.created_at).localeCompare(String(b.created_at)));
    const marcable = ['sin', 'asignado', 'no_entregado'].includes(k);
    return `<div class="tl-col"><h3><span>${titulo}</span><span class="ms-chip">${items.length}</span></h3>
      ${marcable && items.length ? `<button type="button" class="btn-secondary tln-btn-sm" onclick="TD.marcarCol('${k}')">☑ Marcar todos</button>` : ''}
      ${items.map(e => TD.tarjeta(e, marcable)).join('') || '<div class="tl-vacio">Nada aquí.</div>'}</div>`;
  }).join('');
  TD.barra();
};
TD.tarjeta = function (e, marcable) {
  const r = TD.rep(e.repartidor_id), c = msPorCobrar(e);
  return `<div class="tl-ot ms-ot${e.urgente ? ' urg' : ''}" style="cursor:default">
    <div class="ms-ot-cab"><label style="display:flex;gap:8px;align-items:center;cursor:pointer">${marcable ? `<input type="checkbox" class="ms-sel" ${TD.sel.has(e.id) ? 'checked' : ''} onchange="TD.marcar('${e.id}',this.checked)" aria-label="Marcar ${esc(e.numero)}">` : ''}<span class="ms-num">${esc(e.numero)}</span></label>
      ${e.urgente ? '<span class="ms-chip urg">🚨</span>' : ''}${e.estado === 'por_recoger' ? '<span class="ms-chip por_recoger">📍 recoger</span>' : ''}</div>
    <b>${esc(e.destinatario_nombre)}</b><span class="tl-muted">${esc(e.direccion)}${e.zona_nombre ? ' · ' + esc(e.zona_nombre) : ''}</span>
    ${r ? `<span class="tl-muted">🛵 ${esc(r.nombre)}</span>` : ''}
    ${c > 0 && e.estado !== 'entregado' ? `<span class="ms-cobrar" style="align-self:flex-start;font-size:12.5px">💵 ${fmt(c)}</span>` : ''}
    ${e.estado === 'no_entregado' && e.motivo_no_entrega ? `<span class="tl-muted" style="color:var(--danger)">⚠️ ${esc(e.motivo_no_entrega)} · intento ${Number(e.intentos)}</span>` : ''}
    ${e.estado === 'entregado' ? `<span class="tl-muted">✅ ${msHora(e.entregado_at)} · recibió ${esc(e.recibio_nombre || '')}</span>` : ''}
    <div class="tl-lin-acc" style="margin-top:4px">${TD.acciones(e)}</div></div>`;
};
TD.acciones = function (e) {
  const b = (t, f, peligro) => `<button type="button" class="btn-secondary"${peligro ? ' style="color:var(--danger)"' : ''} onclick="${f}">${t}</button>`;
  switch (e.estado) {
    case 'por_recoger': return b('🏬 Llegó a bodega', `TD.estado('${e.id}','en_bodega')`);
    case 'asignado': return b('🛵 Salió a ruta', `TD.estado('${e.id}','en_ruta')`) + b('↩ Quitar repartidor', `TD.estado('${e.id}','en_bodega')`);
    case 'en_ruta': return b('✅ Entregado', `TD.entregar('${e.id}')`) + b('⚠️ No se pudo', `TD.noEntregado('${e.id}')`, true);
    case 'no_entregado': return b('🏬 Volvió a bodega', `TD.estado('${e.id}','en_bodega')`) + b('↩️ Devolver', `TD.devolver('${e.id}')`);
    default: return '';
  }
};
TD.marcar = function (id, si) { if (si) TD.sel.add(id); else TD.sel.delete(id); TD.barra(); };
TD.marcarCol = function (k) {
  const est = TD_COLS.find(c => c[0] === k)[2];
  const ids = TD.visibles().filter(e => est.includes(e.estado)).map(e => e.id);
  const todos = ids.every(id => TD.sel.has(id));
  ids.forEach(id => todos ? TD.sel.delete(id) : TD.sel.add(id)); TD.pintar();
};
TD.limpiar = function () { TD.sel.clear(); TD.pintar(); };
TD.barra = function () {
  const n = TD.sel.size; $d('d-asignar').style.display = n ? 'flex' : 'none';
  $d('d-cuantos').textContent = `${n} envío${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'}`;
};
// Sugiere al repartidor activo con menos entregas pendientes (y que no pasó su tope de efectivo).
TD.sugerir = function () {
  const act = TD.reps.filter(r => r.activo); if (!act.length) { showToast('No tienes repartidores activos.', 'warning'); return; }
  const libre = act.filter(r => { const t = msTope(r, TD.cfg); return !t || (TD.mano[r.id] || 0) <= t; });
  const pool = libre.length ? libre : act;
  pool.sort((a, b) => TD.carga(a.id) - TD.carga(b.id) || a.nombre.localeCompare(b.nombre));
  $d('d-rep').value = pool[0].id; showToast(`Sugerido: ${pool[0].nombre} (${TD.carga(pool[0].id)} por entregar)`);
};
TD.asignar = async function () {
  if (TD.ocupado) return;
  const rep = $d('d-rep').value; if (!rep) { showToast('Elige el repartidor.', 'warning'); $d('d-rep').focus(); return; }
  const ids = [...TD.sel]; if (!ids.length) return;
  TD.ocupado = true; $d('d-ok').disabled = true;
  const r = await msRpc('msj_envios_asignar', { p_ids: ids, p_repartidor: rep, p_por: msPor() });
  TD.ocupado = false; $d('d-ok').disabled = false;
  if (!r.ok) { showToast(r.msg, 'error'); TD.cargar(); return; }
  showToast(`✅ ${r.asignados} envío${r.asignados === 1 ? '' : 's'} asignado${r.asignados === 1 ? '' : 's'} a ${TD.rep(rep)?.nombre || 'el repartidor'}`);
  TD.sel.clear(); TD.cargar();
};
TD.estado = async function (id, nuevo) {
  const r = await msRpc('msj_envio_estado', { p_id: id, p_nuevo: nuevo, p_motivo: null, p_por: msPor() });
  if (!r.ok) { showToast(r.msg, 'error'); } else showToast(`${MS_ESTADOS[nuevo].i} ${MS_ESTADOS[nuevo].t}`);
  TD.cargar();
};
TD.devolver = async function (id) {
  const e = TD.lista.find(x => x.id === id); if (!e) return;
  const motivo = prompt(`¿Por qué se devuelve el envío ${e.numero} al remitente?`, e.motivo_no_entrega || ''); if (motivo === null) return;
  if (motivo.trim().length < 3) { showToast('Escribe el motivo (mínimo 3 letras).', 'error'); return; }
  const r = await msRpc('msj_envio_estado', { p_id: id, p_nuevo: 'devuelto', p_motivo: motivo, p_por: msPor() });
  if (!r.ok) showToast(r.msg, 'error'); else showToast(`↩️ ${e.numero} devuelto al remitente`);
  TD.cargar();
};
TD.entregar = function (id) { const e = TD.lista.find(x => x.id === id); if (e) msEntregar(e, TD.cargar); };
TD.noEntregado = function (id) { const e = TD.lista.find(x => x.id === id); if (e) msNoEntregado(e, TD.cargar); };

window.tallerListo = async function () {
  await TD.cargar();
  setInterval(() => { if (!document.hidden && !document.querySelector('.tl-modal.abierto') && !TD.ocupado) TD.cargar(); }, 60000);
};
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('.tl-modal.abierto').forEach(m => m.classList.remove('abierto')); });
