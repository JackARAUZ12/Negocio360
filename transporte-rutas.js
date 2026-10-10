/* ============================================================
   TRANSPORTE-RUTAS.JS — NEGOCIO360 (Transporte · Fase 4)
   Rutas habituales y tarifas (generales o por cliente).
   Solo usa tablas transporte_* y lee Clientes.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, num } = TX;

const RT = {
  rutas: [], tarifas: [], clientes: [], ordenes: [],
  filtro: { q: '', tipo: '' }, editando: null, detalleId: null, tarifaEdit: null,
};
const COBRO = { viaje: 'por viaje', km: 'por km', tonelada: 'por tonelada' };

async function cargarTodo() {
  const [rutas, tarifas, ordenes] = await Promise.all([
    TX.paginar(() => sb.from('transporte_rutas').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_tarifas').select('*').eq('auth_user_id', TX.userId).order('created_at')),
    TX.paginar(() => sb.from('transporte_ordenes').select('id,ruta_id,estado,total').eq('auth_user_id', TX.userId)),
  ]);
  RT.rutas = rutas; RT.tarifas = tarifas; RT.ordenes = ordenes;
  try {
    const { data } = await sb.from('clientes').select('id,nombre').eq('auth_user_id', TX.userId).eq('activo', true).order('nombre');
    RT.clientes = data || [];
  } catch (_) { RT.clientes = []; }
}

const tarifasDe = id => RT.tarifas.filter(t => t.ruta_id === id);
const ordenesDe = id => RT.ordenes.filter(o => o.ruta_id === id);

function filtradas() {
  const q = TX.quitarTildes(RT.filtro.q);
  return RT.rutas.filter(r => {
    const t = RT.filtro.tipo;
    if (t === 'frontera' && !r.cruza_frontera) return false;
    if (t === 'nacional' && r.cruza_frontera) return false;
    if (t === 'inactiva' && r.activa) return false;
    if (q && !TX.quitarTildes([r.nombre, r.origen, r.destino].join(' ')).includes(q)) return false;
    return true;
  });
}

function renderKpis() {
  const act = RT.rutas.filter(r => r.activa);
  const con = act.filter(r => tarifasDe(r.id).some(t => t.activa)).length;
  document.getElementById('rt-kpis').innerHTML = `
    <div class="tx-kpi"><span>Rutas activas</span><b>${act.length}</b><small>${RT.rutas.length - act.length} inactivas</small></div>
    <div class="tx-kpi"><span>Con tarifa</span><b>${con}</b><small>precio automático en órdenes</small></div>
    <div class="tx-kpi ${act.length - con ? 'aviso' : ''}"><span>Sin tarifa</span><b>${act.length - con}</b><small>${act.length - con ? 'ponles precio' : 'todo cubierto'}</small></div>
    <div class="tx-kpi"><span>Cruzan frontera</span><b>${act.filter(r => r.cruza_frontera).length}</b><small>rutas internacionales</small></div>`;
}

function renderLista() {
  const cont = document.getElementById('rt-lista');
  const lista = filtradas();
  if (!lista.length) {
    cont.innerHTML = RT.rutas.length
      ? `<div class="tx-vacio"><div class="tx-vacio-i">🔎</div><b>No hay rutas con ese filtro</b><p>Prueba con otra búsqueda.</p></div>`
      : `<div class="tx-vacio"><div class="tx-vacio-i">🗺️</div><b>Aún no tienes rutas</b><p>Registra tus recorridos habituales (ej. Managua – Corinto) y cuánto cobras por cada uno.</p>
         <button type="button" class="tx-btn tx-btn-primary" data-rt-nueva>＋ Crear la primera ruta</button></div>`;
    return;
  }
  cont.innerHTML = `<div class="tx-grid">${lista.map(r => {
    const ts = tarifasDe(r.id).filter(t => t.activa), g = ts.find(t => !t.cliente_id);
    return `<div class="tx-card" data-rt-abrir="${esc(r.id)}"><div class="tx-card-body" style="padding:14px 16px">
      <div class="tx-fila-chips">${r.cruza_frontera ? '<span class="tx-chip azul">🛂 Frontera</span>' : '<span class="tx-chip">Nacional</span>'}${r.activa ? '' : '<span class="tx-chip gris">Inactiva</span>'}</div>
      <b>${esc(r.nombre)}</b>
      <small>📍 ${esc(r.origen)} → ${esc(r.destino)}</small>
      <small>${r.distancia_km != null ? Number(r.distancia_km).toLocaleString('es-NI') + ' km' : 'Distancia sin definir'}${r.tiempo_horas != null ? ' · ' + esc(r.tiempo_horas) + ' h' : ''}</small>
      <div class="tx-fila-chips"><span class="tx-chip ${ts.length ? 'verde' : 'naranja'}">${g ? '💲 ' + esc(TX.fmtMoneda(g.precio)) + ' ' + COBRO[g.tipo_cobro] : ts.length ? '💲 ' + ts.length + ' tarifa(s)' : 'Sin tarifa'}</span>
        <span class="tx-chip">${ordenesDe(r.id).length} orden(es)</span></div>
    </div></div>`;
  }).join('')}</div>`;
}
const renderTodo = () => { renderKpis(); renderLista(); };

/* ---------------- Detalle ---------------- */
function abrirDetalle(id) {
  if (!RT.rutas.find(r => r.id === id)) return;
  RT.detalleId = id; renderDetalle(); TX.abrir('rt-modal-detalle');
}
function renderDetalle() {
  const r = RT.rutas.find(x => x.id === RT.detalleId); if (!r) { TX.cerrar('rt-modal-detalle'); return; }
  const ts = tarifasDe(r.id), ords = ordenesDe(r.id), ent = ords.filter(o => o.estado === 'entregada');
  const d = (l, v) => v ? `<div class="tx-dato"><span>${l}</span><b>${esc(v)}</b></div>` : '';
  document.getElementById('rt-detalle-cuerpo').innerHTML = `
    <div class="tx-fila-chips" style="justify-content:space-between;align-items:flex-start">
      <div><h3 style="margin:0">🗺️ ${esc(r.nombre)}</h3><small style="color:var(--text-secondary)">${esc(r.origen)} → ${esc(r.destino)}</small></div>
      <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-sm" data-rt-editar="${esc(r.id)}">✏️ Editar</button><button type="button" class="tx-btn tx-btn-sm" onclick="TXcerrar('rt-modal-detalle')">Cerrar</button></div>
    </div>
    <div class="tx-datos">
      ${d('Distancia', r.distancia_km != null ? Number(r.distancia_km).toLocaleString('es-NI') + ' km' : '')}${d('Tiempo estimado', r.tiempo_horas != null ? r.tiempo_horas + ' h' : '')}
      ${d('Países', [r.pais_origen, r.pais_destino].filter(Boolean).join(' → '))}${d('Fronteras', r.cruza_frontera ? (r.fronteras || 'Sí') : '')}
      ${d('Peajes estimados', Number(r.peajes_estimados) ? TX.fmtMoneda(r.peajes_estimados) : '')}${d('Órdenes', ords.length + ' (' + ent.length + ' entregadas)')}
      ${d('Estado', r.activa ? 'Activa' : 'Inactiva')}
    </div>
    ${r.notas ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">📝 ${esc(r.notas)}</div>` : ''}
    <div class="tx-sec">Tarifas de esta ruta</div>
    ${ts.length ? ts.map(t => `<div class="tx-doc"><div class="tx-doc-info"><b>${esc(t.cliente_id ? (t.cliente_nombre || 'Cliente') : 'Tarifa general')} · ${esc(TX.fmtMoneda(t.precio))} ${COBRO[t.tipo_cobro]}</b>
        <small>${t.activa ? '' : 'Inactiva · '}${esc(t.notas || (t.cliente_id ? 'Solo para este cliente' : 'Aplica a cualquier cliente'))}</small></div>
        <div class="tx-doc-acc"><button type="button" class="tx-btn tx-btn-sm" data-rt-tarifa-editar="${esc(t.id)}">✏️</button><button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-rt-tarifa-borrar="${esc(t.id)}">🗑</button></div></div>`).join('')
      : '<div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Aún no hay tarifas. Agrega una para que las órdenes se llenen solas.</div>'}
    <button type="button" class="tx-btn tx-btn-primary tx-btn-sm" data-rt-tarifa-nueva="${esc(r.id)}">＋ Agregar tarifa</button>
    <div class="tx-pie" style="justify-content:space-between"><button type="button" class="tx-btn tx-btn-borrar" data-rt-borrar="${esc(r.id)}">🗑 Eliminar ruta</button>
      <a class="tx-btn" href="transporte-ordenes.html">📋 Ir a Órdenes</a></div>`;
}

/* ---------------- Formulario de ruta ---------------- */
const $ = id => document.getElementById(id);
function abrirForm(id) {
  const r = id ? RT.rutas.find(x => x.id === id) : null; RT.editando = r;
  $('rt-form-titulo').textContent = r ? 'Editar ruta' : 'Nueva ruta';
  const v = (i, x) => { $(i).value = x == null ? '' : x; };
  v('rf-nombre', r?.nombre); v('rf-origen', r?.origen); v('rf-destino', r?.destino);
  v('rf-pais-o', r?.pais_origen); v('rf-pais-d', r?.pais_destino); v('rf-km', r?.distancia_km);
  v('rf-horas', r?.tiempo_horas); v('rf-peajes', Number(r?.peajes_estimados) || ''); v('rf-fronteras', r?.fronteras); v('rf-notas', r?.notas);
  $('rf-frontera').checked = !!r?.cruza_frontera; $('rf-activa').checked = r ? !!r.activa : true;
  $('rf-front-wrap').style.display = $('rf-frontera').checked ? '' : 'none';
  $('rf-error').textContent = '';
  TX.abrir('rt-modal-form');
}
async function guardarRuta() {
  const nombre = $('rf-nombre').value.trim(), origen = $('rf-origen').value.trim(), destino = $('rf-destino').value.trim();
  const err = m => { $('rf-error').textContent = m; };
  if (!nombre) return err('Escribe un nombre para la ruta.');
  if (!origen || !destino) return err('Indica el origen y el destino.');
  const km = num($('rf-km').value), h = num($('rf-horas').value), pe = num($('rf-peajes').value) || 0;
  if ((km != null && km < 0) || (h != null && h < 0) || pe < 0) return err('Los valores no pueden ser negativos.');
  const fr = $('rf-frontera').checked;
  const p = {
    nombre, origen, destino, pais_origen: $('rf-pais-o').value.trim() || null, pais_destino: $('rf-pais-d').value.trim() || null,
    distancia_km: km, tiempo_horas: h, peajes_estimados: pe, cruza_frontera: fr, fronteras: fr ? ($('rf-fronteras').value.trim() || null) : null,
    notas: $('rf-notas').value.trim() || null, activa: $('rf-activa').checked,
  };
  const btn = $('rf-guardar'); btn.disabled = true;
  try {
    if (RT.editando) {
      const { error } = await sb.from('transporte_rutas').update(p).eq('id', RT.editando.id).eq('auth_user_id', TX.userId);
      if (error) throw error;
    } else {
      const { error } = await sb.from('transporte_rutas').insert({ ...p, auth_user_id: TX.userId });
      if (error) throw error;
    }
    TX.cerrar('rt-modal-form'); TX.toast('Ruta guardada');
    await cargarTodo(); renderTodo(); if (RT.detalleId) renderDetalle();
  } catch (e) { console.error(e); err('No se pudo guardar. Intenta de nuevo.'); }
  finally { btn.disabled = false; }
}
async function eliminarRuta(id) {
  const r = RT.rutas.find(x => x.id === id); if (!r) return;
  const n = ordenesDe(id).length;
  if (n) {
    if (!await TX.confirmar('Esta ruta ya tiene órdenes', `Tiene ${n} orden(es), así que no se borra para no perder el historial. ¿Desactivarla? Dejará de ofrecerse en nuevas órdenes.`, 'Desactivar')) return;
    await sb.from('transporte_rutas').update({ activa: false }).eq('id', id).eq('auth_user_id', TX.userId);
    TX.toast('Ruta desactivada');
  } else {
    if (!await TX.confirmar('¿Eliminar la ruta?', `Se borrará “${r.nombre}” y sus tarifas.`, 'Eliminar', true)) return;
    const { error } = await sb.from('transporte_rutas').delete().eq('id', id).eq('auth_user_id', TX.userId);
    if (error) { TX.toast('No se pudo eliminar', 'error'); return; }
    TX.toast('Ruta eliminada'); RT.detalleId = null; TX.cerrar('rt-modal-detalle');
  }
  await cargarTodo(); renderTodo(); if (RT.detalleId) renderDetalle();
}

/* ---------------- Tarifas ---------------- */
function abrirTarifa(rutaId, tarifaId) {
  const t = tarifaId ? RT.tarifas.find(x => x.id === tarifaId) : null;
  RT.tarifaEdit = { rutaId, t };
  $('rtf-titulo').textContent = t ? 'Editar tarifa' : 'Nueva tarifa';
  $('rtf-cliente').innerHTML = '<option value="">Tarifa general (cualquier cliente)</option>' + RT.clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('');
  $('rtf-cliente').value = t?.cliente_id || ''; $('rtf-tipo').value = t?.tipo_cobro || 'viaje';
  $('rtf-precio').value = t ? t.precio : ''; $('rtf-notas').value = t?.notas || ''; $('rtf-error').textContent = '';
  TX.abrir('rt-modal-tarifa');
}
async function guardarTarifa() {
  const { rutaId, t } = RT.tarifaEdit; const err = m => { $('rtf-error').textContent = m; };
  const precio = num($('rtf-precio').value);
  if (precio == null || precio <= 0) return err('Escribe un precio mayor a 0.');
  const cid = $('rtf-cliente').value || null, cli = cid ? RT.clientes.find(c => c.id === cid) : null;
  const dup = RT.tarifas.find(x => x.ruta_id === rutaId && (x.cliente_id || null) === cid && x.tipo_cobro === $('rtf-tipo').value && x.activa && x.id !== t?.id);
  if (dup) return err('Ya existe una tarifa activa igual para esta ruta y cliente. Edítala en lugar de crear otra.');
  const p = { cliente_id: cid, cliente_nombre: cli?.nombre || null, tipo_cobro: $('rtf-tipo').value, precio, notas: $('rtf-notas').value.trim() || null, activa: t ? t.activa : true };
  const btn = $('rtf-guardar'); btn.disabled = true;
  try {
    const q = t ? sb.from('transporte_tarifas').update(p).eq('id', t.id).eq('auth_user_id', TX.userId)
      : sb.from('transporte_tarifas').insert({ ...p, ruta_id: rutaId, auth_user_id: TX.userId });
    const { error } = await q; if (error) throw error;
    TX.cerrar('rt-modal-tarifa'); TX.toast('Tarifa guardada');
    await cargarTodo(); renderTodo(); renderDetalle();
  } catch (e) { console.error(e); err('No se pudo guardar la tarifa.'); }
  finally { btn.disabled = false; }
}
async function borrarTarifa(id) {
  if (!await TX.confirmar('¿Eliminar la tarifa?', 'Las órdenes ya creadas conservan su precio.', 'Eliminar', true)) return;
  const { error } = await sb.from('transporte_tarifas').delete().eq('id', id).eq('auth_user_id', TX.userId);
  if (error) { TX.toast('No se pudo eliminar', 'error'); return; }
  TX.toast('Tarifa eliminada'); await cargarTodo(); renderTodo(); renderDetalle();
}

function enlazar() {
  $('rt-buscar').addEventListener('input', e => { RT.filtro.q = e.target.value; renderLista(); });
  $('rt-f-tipo').addEventListener('change', e => { RT.filtro.tipo = e.target.value; renderLista(); });
  $('rf-frontera').addEventListener('change', () => { $('rf-front-wrap').style.display = $('rf-frontera').checked ? '' : 'none'; });
  $('rf-guardar').addEventListener('click', guardarRuta);
  $('rtf-guardar').addEventListener('click', guardarTarifa);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-rt-abrir],[data-rt-nueva],[data-rt-editar],[data-rt-borrar],[data-rt-tarifa-nueva],[data-rt-tarifa-editar],[data-rt-tarifa-borrar]');
    if (!t) return; const d = t.dataset;
    if (d.rtAbrir) abrirDetalle(d.rtAbrir);
    else if ('rtNueva' in d) abrirForm(null);
    else if (d.rtEditar) abrirForm(d.rtEditar);
    else if (d.rtBorrar) eliminarRuta(d.rtBorrar);
    else if (d.rtTarifaNueva) abrirTarifa(d.rtTarifaNueva, null);
    else if (d.rtTarifaEditar) abrirTarifa(RT.detalleId, d.rtTarifaEditar);
    else if (d.rtTarifaBorrar) borrarTarifa(d.rtTarifaBorrar);
  });
}

window.RT = RT;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => { enlazar(); await cargarTodo(); renderTodo(); });
});
