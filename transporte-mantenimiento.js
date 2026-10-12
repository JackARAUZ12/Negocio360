/* ============================================================
   TRANSPORTE-MANTENIMIENTO.JS — NEGOCIO360 (Transporte · Fase 11)
   Mantenimiento y llantas.
   - Plan preventivo por unidad: cada X km y/o cada X días, con aviso.
   - Órdenes de trabajo del taller (preventivas o correctivas). Al cerrarlas se
     actualiza el plan, el kilometraje de la unidad y, si quieres, el costo sale
     de Caja como Gasto (categoría Mantenimiento, Contabilidad lo asienta).
   - Llantas: inventario, montaje por unidad y posición, rotación, desmontaje,
     recapado y descarte, con km rodados y aviso de fin de vida útil.
   Solo usa tablas transporte_* nuevas; no cambia ningún dato de otros módulos
   (salvo el estado/odómetro de la unidad y el gasto/caja si se marca pagarlo).
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, num } = TX;
const $ = id => document.getElementById(id);
const money = n => TX.fmtMoneda(n);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fmtKm = n => (n == null || n === '' ? '—' : Number(n).toLocaleString('es-NI', { maximumFractionDigits: 0 }) + ' km');

const MT = { vista: 'preventivo', unidades: [], planes: [], ots: [], llantas: [], movs: [], metodos: [], bancos: [], filtroUnidad: '', filtroOT: 'abierta', filtroLlanta: '', agrupar: false, edit: null };
const ESTADO_OT = {
  abierta:   { t: 'En taller', clase: 'naranja', ico: '🛠️' },
  cerrada:   { t: 'Cerrada', clase: 'verde', ico: '✅' },
  cancelada: { t: 'Cancelada', clase: 'gris', ico: '⛔' },
};
const ESTADO_LL = {
  nueva:      { t: 'Nueva', clase: 'azul', ico: '🆕' },
  en_uso:     { t: 'En uso', clase: 'verde', ico: '🚛' },
  almacen:    { t: 'En almacén', clase: 'gris', ico: '📦' },
  recapada:   { t: 'Recapada', clase: 'naranja', ico: '♻️' },
  descartada: { t: 'Descartada', clase: 'rojo', ico: '🗑️' },
};
const MOV_TXT = { alta: 'Alta', montaje: 'Montada', desmontaje: 'Desmontada', rotacion: 'Rotada', recapado: 'Recapada', descarte: 'Descartada' };

async function cargarTodo() {
  const [unidades, planes, ots, llantas, movs] = await Promise.all([
    TX.paginar(() => sb.from('transporte_unidades').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_mant_planes').select('*').eq('auth_user_id', TX.userId).order('created_at')),
    TX.paginar(() => sb.from('transporte_mant_ordenes').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.paginar(() => sb.from('transporte_llantas').select('*').eq('auth_user_id', TX.userId).order('codigo')),
    TX.paginar(() => sb.from('transporte_llantas_movs').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
  ]);
  MT.unidades = unidades; MT.planes = planes; MT.ots = ots; MT.llantas = llantas; MT.movs = movs;
  try { const { data } = await sb.from('metodos_pago').select('*').eq('auth_user_id', TX.userId).eq('activo', true).order('orden'); MT.metodos = data || []; } catch (_) { MT.metodos = []; }
  try { const { data } = await sb.from('bancos').select('id,nombre').eq('auth_user_id', TX.userId).eq('activo', true).order('nombre'); MT.bancos = data || []; } catch (_) { MT.bancos = []; }
}
const uni = id => MT.unidades.find(u => u.id === id);
const nomU = id => { const u = uni(id); return u ? `${u.nombre}${u.placa ? ' · ' + u.placa : ''}` : 'Unidad eliminada'; };
const plan = id => MT.planes.find(p => p.id === id);
const ot = id => MT.ots.find(o => o.id === id);
const lla = id => MT.llantas.find(l => l.id === id);
function sumarDias(iso, n) { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + Number(n)); return TX.ymd(d); }

/* ---------------- Cálculos ---------------- */
function estadoPlan(p) {
  const u = uni(p.unidad_id);
  let kmRest = null, diasRest = null, venceEl = null;
  if (Number(p.cada_km) > 0 && p.ultimo_km != null && u?.odometro_km != null) kmRest = Number(p.ultimo_km) + Number(p.cada_km) - Number(u.odometro_km);
  if (Number(p.cada_dias) > 0 && p.ultima_fecha) { venceEl = sumarDias(p.ultima_fecha, p.cada_dias); diasRest = TX.diasPara(venceEl); }
  if (kmRest == null && diasRest == null) return { clave: 'sin_base', clase: 'gris', texto: 'Falta registrar el último servicio', rank: 2, kmRest, diasRest, venceEl };
  const venc = (kmRest != null && kmRest <= 0) || (diasRest != null && diasRest < 0);
  const porV = (kmRest != null && kmRest <= Number(p.aviso_km || 0)) || (diasRest != null && diasRest <= Number(p.aviso_dias || 0));
  if (venc) return { clave: 'vencido', clase: 'rojo', texto: 'Vencido', rank: 0, kmRest, diasRest, venceEl };
  if (porV) return { clave: 'por_vencer', clase: 'naranja', texto: 'Por vencer', rank: 1, kmRest, diasRest, venceEl };
  return { clave: 'al_dia', clase: 'verde', texto: 'Al día', rank: 3, kmRest, diasRest, venceEl };
}
function detallePlan(p, e) {
  const t = [];
  if (e.kmRest != null) t.push(e.kmRest > 0 ? `faltan ${fmtKm(e.kmRest)}` : `pasado por ${fmtKm(Math.abs(e.kmRest))}`);
  if (e.diasRest != null) t.push(e.diasRest > 0 ? `vence ${TX.fmtFecha(e.venceEl)} (en ${e.diasRest} día${e.diasRest === 1 ? '' : 's'})` : e.diasRest === 0 ? 'vence hoy' : `venció hace ${Math.abs(e.diasRest)} día${Math.abs(e.diasRest) === 1 ? '' : 's'}`);
  return t.join(' · ');
}
const planesActivos = () => MT.planes.filter(p => p.activo !== false && uni(p.unidad_id));
const kmRodados = l => Number(l.km_previos || 0) + (l.estado === 'en_uso' && l.km_montaje != null ? Math.max(0, (Number(uni(l.unidad_id)?.odometro_km) || Number(l.km_montaje)) - Number(l.km_montaje)) : 0);
const pctLlanta = l => (Number(l.vida_util_km) > 0 ? kmRodados(l) / Number(l.vida_util_km) : 0);
const llantasEnUso = () => MT.llantas.filter(l => l.estado === 'en_uso');
const llantasAlerta = () => llantasEnUso().filter(l => pctLlanta(l) >= 0.85);

/* ---------------- Pintado ---------------- */
function renderKpis() {
  const es = planesActivos().map(estadoPlan), v = es.filter(e => e.clave === 'vencido').length, pv = es.filter(e => e.clave === 'por_vencer').length;
  const ab = MT.ots.filter(o => o.estado === 'abierta').length, mes = TX.hoyISO().slice(0, 7);
  const gasto = MT.ots.filter(o => o.estado === 'cerrada' && String(o.fecha || '').slice(0, 7) === mes).reduce((s, o) => s + Number(o.total || 0), 0);
  const la = llantasAlerta().length;
  $('mm-kpis').innerHTML = `
    <div class="tx-kpi ${v ? 'alerta' : ''}"><span>Servicios vencidos</span><b>${v}</b><small>preventivos pasados</small></div>
    <div class="tx-kpi ${pv ? 'aviso' : ''}"><span>Por vencer</span><b>${pv}</b><small>próximos servicios</small></div>
    <div class="tx-kpi"><span>Órdenes en taller</span><b>${ab}</b><small>abiertas ahora</small></div>
    <div class="tx-kpi"><span>Mantenimiento del mes</span><b>${esc(money(gasto))}</b><small>órdenes cerradas</small></div>
    <div class="tx-kpi ${la ? 'aviso' : ''}"><span>Llantas por cambiar</span><b>${la}</b><small>85 % o más de su vida útil</small></div>`;
}
function sinUnidades() {
  return `<div class="tx-vacio"><div class="tx-vacio-i">🚛</div><b>Primero registra tus unidades</b><p>El mantenimiento y las llantas se llevan por unidad. Agrega tus cabezales, camiones y furgones en Flota.</p><a class="tx-btn tx-btn-primary" href="flota.html">Ir a Flota</a></div>`;
}
function vistaPreventivo() {
  if (!MT.unidades.length) return sinUnidades();
  const sel = `<select class="tx-in" id="mm-f-unidad" style="width:auto"><option value="">Todas las unidades</option>${MT.unidades.map(u => `<option value="${esc(u.id)}" ${MT.filtroUnidad === u.id ? 'selected' : ''}>${esc(nomU(u.id))}</option>`).join('')}</select>`;
  const lista = planesActivos().filter(p => !MT.filtroUnidad || p.unidad_id === MT.filtroUnidad).map(p => ({ p, e: estadoPlan(p) }))
    .sort((a, b) => a.e.rank - b.e.rank || (a.e.kmRest ?? 1e12) - (b.e.kmRest ?? 1e12));
  const vencidos = lista.filter(x => x.e.clave === 'vencido');
  let h = `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-primary" data-mm-plan-nuevo>＋ Nuevo plan preventivo</button>${sel}</div>`;
  if (vencidos.length) h += `<div class="tx-aviso-banda rojo"><div style="font-size:22px">⛔</div><div><b>${vencidos.length} servicio${vencidos.length === 1 ? '' : 's'} preventivo${vencidos.length === 1 ? '' : 's'} vencido${vencidos.length === 1 ? '' : 's'}</b>Programa la orden de trabajo para no dañar la unidad ni arriesgar un viaje.</div></div>`;
  if (!lista.length) return h + `<div class="tx-vacio"><div class="tx-vacio-i">🔧</div><b>Sin planes de mantenimiento</b><p>Crea un plan por unidad (por ejemplo cambio de aceite cada 10,000 km o 180 días) y el sistema te avisa antes de que toque.</p></div>`;
  return h + lista.map(({ p, e }) => `<div class="tx-doc"><div class="tx-doc-info"><b>🔧 ${esc(p.nombre)} <span class="tx-chip ${e.clase}">${esc(e.texto)}</span></b>
      <small>${esc(nomU(p.unidad_id))}${Number(p.cada_km) > 0 ? ' · cada ' + esc(fmtKm(p.cada_km)) : ''}${Number(p.cada_dias) > 0 ? ' · cada ' + p.cada_dias + ' días' : ''}</small>
      <small>${esc(detallePlan(p, e) || '')}${p.ultima_fecha || p.ultimo_km != null ? ` · último: ${p.ultima_fecha ? esc(TX.fmtFecha(p.ultima_fecha)) : ''}${p.ultimo_km != null ? ' a ' + esc(fmtKm(p.ultimo_km)) : ''}` : ''}</small></div>
    <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-mm-ot-plan="${esc(p.id)}">Registrar servicio</button>
      <button type="button" class="tx-btn tx-btn-sm" data-mm-plan-editar="${esc(p.id)}">✏️</button><button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-mm-plan-borrar="${esc(p.id)}">🗑</button></div></div>`).join('');
}
function filaOT(o) {
  const e = ESTADO_OT[o.estado] || ESTADO_OT.abierta, id = esc(o.id), id2 = o.id;
  const acc = o.estado === 'abierta' ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-ok" data-mm-ot-cerrar="${id}">Cerrar orden</button><button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-mm-ot-cancelar="${id}">Cancelar</button>`
    : o.estado === 'cerrada' ? `<button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-mm-ot-anular="${id}">Anular</button>`
    : `<button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-mm-ot-borrar="${id}">🗑</button>`;
  return `<div class="tx-doc"><div class="tx-doc-info"><b>🛠️ ${esc(o.numero)} · ${esc(o.descripcion)} <span class="tx-chip ${e.clase}">${e.ico} ${esc(e.t)}</span></b>
    <small>${esc(nomU(o.unidad_id))} · ${o.tipo === 'correctivo' ? 'Correctivo' : 'Preventivo'}${o.taller ? ' · ' + esc(o.taller) : ''} · ${esc(TX.fmtFecha(o.fecha))}${o.odometro_km != null ? ' · ' + esc(fmtKm(o.odometro_km)) : ''}</small>
    <small>${Number(o.total) > 0 ? `Costo ${esc(money(o.total))} (mano de obra ${esc(money(o.mano_obra))} · repuestos ${esc(money(o.repuestos))})` : 'Sin costo registrado'}${o.gasto_id ? ' · pagado desde Caja' : ''}${o.notas ? ' · ' + esc(o.notas) : ''}</small></div>
    <div class="tx-fila-chips">${acc}</div></div>`;
}
function vistaOrdenes() {
  if (!MT.unidades.length) return sinUnidades();
  const f = MT.filtroOT;
  const lista = MT.ots.filter(o => !f || o.estado === f);
  return `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-primary" data-mm-ot-nueva>＋ Nueva orden de trabajo</button>
    <select class="tx-in" id="mm-f-ot" style="width:auto"><option value="">Todas</option>${Object.entries(ESTADO_OT).map(([k, v]) => `<option value="${k}" ${f === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select></div>`
    + (lista.length ? lista.map(filaOT).join('') : `<div class="tx-vacio"><div class="tx-vacio-i">🛠️</div><b>Sin órdenes de trabajo</b><p>Abre una orden cuando una unidad entre al taller. Al cerrarla se actualizan el plan preventivo y el kilometraje.</p></div>`);
}
function barraLlanta(l) {
  const p = pctLlanta(l), c = p >= 1 ? 'rojo' : p >= 0.85 ? 'naranja' : 'verde';
  return `<div style="height:6px;background:var(--bg-hover);border-radius:999px;overflow:hidden;margin:4px 0"><div style="height:100%;width:${Math.min(100, Math.round(p * 100))}%;background:var(--${c === 'rojo' ? 'danger' : c === 'naranja' ? 'warning' : 'success'})"></div></div>`;
}
function filaLlanta(l) {
  const e = ESTADO_LL[l.estado] || ESTADO_LL.nueva, id = esc(l.id), p = pctLlanta(l), km = kmRodados(l), cpk = km > 0 && Number(l.costo) > 0 ? Number(l.costo) / km : null;
  const aviso = l.estado === 'en_uso' && p >= 1 ? '<span class="tx-chip rojo">Cambiar ya</span>' : l.estado === 'en_uso' && p >= 0.85 ? '<span class="tx-chip naranja">Por cambiar</span>' : '';
  const acc = [];
  if (['nueva', 'almacen', 'recapada'].includes(l.estado)) acc.push(`<button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-mm-ll-montar="${id}">Montar</button>`);
  if (l.estado === 'en_uso') acc.push(`<button type="button" class="tx-btn tx-btn-sm" data-mm-ll-rotar="${id}">Rotar</button><button type="button" class="tx-btn tx-btn-sm" data-mm-ll-desmontar="${id}">Desmontar</button>`);
  if (['almacen'].includes(l.estado)) acc.push(`<button type="button" class="tx-btn tx-btn-sm" data-mm-ll-recapar="${id}">Recapar</button><button type="button" class="tx-btn tx-btn-sm" data-mm-ll-descartar="${id}">Descartar</button>`);
  acc.push(`<button type="button" class="tx-btn tx-btn-sm" data-mm-ll-hist="${id}">Historial</button><button type="button" class="tx-btn tx-btn-sm" data-mm-ll-editar="${id}">✏️</button>`);
  if (l.estado !== 'en_uso') acc.push(`<button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-mm-ll-borrar="${id}">🗑</button>`);
  return `<div class="tx-doc"><div class="tx-doc-info"><b>🛞 ${esc(l.codigo)}${l.marca ? ' · ' + esc(l.marca) : ''}${l.medida ? ' · ' + esc(l.medida) : ''} <span class="tx-chip ${e.clase}">${e.ico} ${esc(e.t)}</span> ${aviso}</b>
    <small>${l.estado === 'en_uso' ? `${esc(nomU(l.unidad_id))} · ${esc(l.posicion || 'sin posición')}` : 'Sin unidad'} · ${esc(fmtKm(km))} de ${esc(fmtKm(l.vida_util_km))} (${Math.round(p * 100)} %)${cpk != null ? ' · ' + esc(money(cpk)) + ' por km' : ''}</small>${barraLlanta(l)}</div>
    <div class="tx-fila-chips">${acc.join('')}</div></div>`;
}
function vistaLlantas() {
  if (!MT.unidades.length) return sinUnidades();
  const f = MT.filtroLlanta;
  const lista = MT.llantas.filter(l => !f || l.estado === f);
  let h = `<div class="tx-fila-chips" style="margin-bottom:10px"><button type="button" class="tx-btn tx-btn-primary" data-mm-ll-nueva>＋ Nueva llanta</button>
    <select class="tx-in" id="mm-f-ll" style="width:auto"><option value="">Todas</option>${Object.entries(ESTADO_LL).map(([k, v]) => `<option value="${k}" ${f === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select>
    <label style="display:flex;gap:6px;align-items:center;font-size:13px;white-space:nowrap;width:auto"><input type="checkbox" style="width:auto;flex:none" id="mm-ll-agrupar" ${MT.agrupar ? 'checked' : ''}/> Agrupar por unidad</label></div>`;
  if (!lista.length) return h + `<div class="tx-vacio"><div class="tx-vacio-i">🛞</div><b>Sin llantas registradas</b><p>Registra tus llantas, móntalas en cada unidad y el sistema calcula los km rodados y avisa cuando se acerquen al fin de su vida útil.</p></div>`;
  if (MT.agrupar) {
    const grupos = [...MT.unidades.map(u => ({ t: nomU(u.id), l: lista.filter(x => x.estado === 'en_uso' && x.unidad_id === u.id) })), { t: 'Sin unidad (almacén, nuevas, recapadas, descartadas)', l: lista.filter(x => x.estado !== 'en_uso') }].filter(g => g.l.length);
    return h + grupos.map(g => `<div class="tx-sec">${esc(g.t)}</div>${g.l.sort((a, b) => String(a.posicion || '').localeCompare(String(b.posicion || ''))).map(filaLlanta).join('')}`).join('');
  }
  return h + lista.map(filaLlanta).join('');
}
function renderVista() {
  document.querySelectorAll('[data-mm-vista]').forEach(b => b.classList.toggle('on', b.dataset.mmVista === MT.vista));
  $('mm-vista').innerHTML = MT.vista === 'ordenes' ? vistaOrdenes() : MT.vista === 'llantas' ? vistaLlantas() : vistaPreventivo();
}
function renderTodo() { renderKpis(); renderVista(); }

/* ---------------- Planes preventivos ---------------- */
function abrirPlan(id, unidadId) {
  if (!MT.unidades.length) { TX.toast('Primero registra una unidad en Flota.', 'error'); return; }
  const p = id ? plan(id) : null; MT.edit = id || null;
  $('mp-titulo').textContent = p ? 'Editar plan de mantenimiento' : 'Nuevo plan de mantenimiento';
  $('mp-unidad').innerHTML = MT.unidades.map(u => `<option value="${esc(u.id)}">${esc(nomU(u.id))}</option>`).join('');
  $('mp-unidad').value = p?.unidad_id || unidadId || MT.filtroUnidad || MT.unidades[0].id;
  $('mp-nombre').value = p?.nombre || ''; $('mp-cadakm').value = p?.cada_km ?? ''; $('mp-cadadias').value = p?.cada_dias ?? '';
  $('mp-ultkm').value = p?.ultimo_km ?? uni($('mp-unidad').value)?.odometro_km ?? ''; $('mp-ultfecha').value = p?.ultima_fecha || (p ? '' : TX.hoyISO());
  $('mp-avkm').value = p?.aviso_km ?? 500; $('mp-avdias').value = p?.aviso_dias ?? 15; $('mp-notas').value = p?.notas || ''; $('mp-error').textContent = '';
  TX.abrir('mm-modal-plan');
}
async function guardarPlan() {
  const err = m => { $('mp-error').textContent = m; };
  const nombre = $('mp-nombre').value.trim(); if (!nombre) return err('Escribe el nombre del servicio.');
  const ckm = num($('mp-cadakm').value), cd = num($('mp-cadadias').value);
  if (!(ckm > 0) && !(cd > 0)) return err('Indica cada cuántos km o cada cuántos días se repite.');
  if ((ckm != null && ckm < 0) || (cd != null && cd < 0)) return err('Los valores no pueden ser negativos.');
  const fila = {
    unidad_id: $('mp-unidad').value, nombre, cada_km: ckm > 0 ? ckm : null, cada_dias: cd > 0 ? Math.round(cd) : null,
    ultimo_km: num($('mp-ultkm').value), ultima_fecha: $('mp-ultfecha').value || null,
    aviso_km: num($('mp-avkm').value) ?? 500, aviso_dias: Math.round(num($('mp-avdias').value) ?? 15), notas: $('mp-notas').value.trim() || null,
  };
  const btn = $('mp-guardar'); btn.disabled = true;
  try {
    const q = MT.edit ? sb.from('transporte_mant_planes').update(fila).eq('id', MT.edit).eq('auth_user_id', TX.userId) : sb.from('transporte_mant_planes').insert({ ...fila, auth_user_id: TX.userId });
    const { error } = await q; if (error) throw error;
    TX.cerrar('mm-modal-plan'); TX.toast('Plan guardado'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); err('No se pudo guardar el plan.'); } finally { btn.disabled = false; }
}
async function borrarPlan(id) {
  const p = plan(id); if (!p) return;
  if (!await TX.confirmar('¿Eliminar este plan?', 'Se quita el aviso de este servicio. Las órdenes de trabajo ya hechas se conservan.', 'Eliminar', true)) return;
  try { const { error } = await sb.from('transporte_mant_planes').delete().eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error; TX.toast('Plan eliminado'); await cargarTodo(); renderTodo(); }
  catch (e) { console.error(e); TX.toast('No se pudo eliminar el plan.', 'error'); }
}

/* ---------------- Órdenes de trabajo ---------------- */
function siguienteNumeroOT() {
  const n = MT.ots.reduce((m, o) => { const x = parseInt(String(o.numero).replace(/\D/g, ''), 10); return isFinite(x) && x > m ? x : m; }, 0);
  return 'MNT-' + String(n + 1).padStart(4, '0');
}
function llenarPlanesOT() {
  const uid = $('mo-unidad').value, ps = planesActivos().filter(p => p.unidad_id === uid);
  $('mo-plan').innerHTML = '<option value="">— Ninguno —</option>' + ps.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('');
  const u = uni(uid); if (!$('mo-odo').dataset.manual) $('mo-odo').value = u?.odometro_km ?? '';
  $('mo-taller-wrap').style.display = u && u.estado === 'disponible' ? 'flex' : 'none';
}
function cambiaTipoOT() { $('mo-plan-wrap').style.display = $('mo-tipo').value === 'preventivo' ? '' : 'none'; if ($('mo-tipo').value !== 'preventivo') $('mo-plan').value = ''; }
function abrirOT(planId) {
  if (!MT.unidades.length) { TX.toast('Primero registra una unidad en Flota.', 'error'); return; }
  const p = planId ? plan(planId) : null;
  $('mo-unidad').innerHTML = MT.unidades.map(u => `<option value="${esc(u.id)}">${esc(nomU(u.id))}</option>`).join('');
  $('mo-unidad').value = p?.unidad_id || MT.filtroUnidad || MT.unidades[0].id;
  $('mo-odo').dataset.manual = ''; $('mo-tipo').value = 'preventivo'; cambiaTipoOT(); llenarPlanesOT();
  if (p) $('mo-plan').value = p.id;
  $('mo-desc').value = p?.nombre || ''; $('mo-taller').value = ''; $('mo-fecha').value = TX.hoyISO(); $('mo-notas').value = ''; $('mo-mano').value = ''; $('mo-rep').value = '';
  $('mo-poner-taller').checked = true; $('mo-error').textContent = '';
  TX.abrir('mm-modal-ot');
}
async function guardarOT() {
  const err = m => { $('mo-error').textContent = m; };
  const u = uni($('mo-unidad').value); if (!u) return err('Elige la unidad.');
  const desc = $('mo-desc').value.trim(); if (!desc) return err('Escribe qué se va a hacer.');
  const mano = num($('mo-mano').value) || 0, rep = num($('mo-rep').value) || 0;
  if (mano < 0 || rep < 0) return err('Los costos no pueden ser negativos.');
  const odo = num($('mo-odo').value);
  if (odo != null && odo < 0) return err('El kilometraje no puede ser negativo.');
  const abrirTaller = u.estado === 'disponible' && $('mo-poner-taller').checked;
  const numero = siguienteNumeroOT();
  const btn = $('mo-guardar'); btn.disabled = true;
  try {
    const { error } = await sb.from('transporte_mant_ordenes').insert({
      auth_user_id: TX.userId, numero, unidad_id: u.id, plan_id: $('mo-plan').value || null, tipo: $('mo-tipo').value, descripcion: desc,
      taller: $('mo-taller').value.trim() || null, fecha: $('mo-fecha').value || TX.hoyISO(), odometro_km: odo, mano_obra: r2(mano), repuestos: r2(rep), total: r2(mano + rep),
      estado: 'abierta', unidad_estado_previo: abrirTaller ? u.estado : null, notas: $('mo-notas').value.trim() || null,
    });
    if (error) throw error;
    if (abrirTaller) { try { await TX.cambiarEstado('unidad', u, 'taller', `Orden de trabajo ${numero}`); } catch (e) { console.warn(e); } }
    TX.cerrar('mm-modal-ot'); TX.toast(`Orden ${numero} abierta`); MT.vista = 'ordenes'; MT.filtroOT = 'abierta'; await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); err('No se pudo abrir la orden.'); } finally { btn.disabled = false; }
}
async function devolverUnidad(o, nota) {
  const u = uni(o.unidad_id);
  if (u && o.unidad_estado_previo && u.estado === 'taller') { try { await TX.cambiarEstado('unidad', u, o.unidad_estado_previo, nota); } catch (e) { console.warn(e); } }
}
async function ultimoMovimientoId() {
  try { const { data } = await sb.from('movimientos_financieros').select('id').eq('auth_user_id', TX.userId).order('created_at', { ascending: false }).limit(1).maybeSingle(); return data?.id || null; } catch (_) { return null; }
}
async function anularGasto(gastoId, motivo) {
  await sb.from('movimientos_financieros').update({ estado: 'anulado', anulado_en: new Date().toISOString(), anulado_motivo: motivo })
    .eq('referencia_tipo', 'gasto').eq('referencia_id', gastoId).eq('auth_user_id', TX.userId).eq('estado', 'completado');
  await sb.from('gastos').update({ estado: 'cancelado', cancelado_en: new Date().toISOString(), cancelado_motivo: motivo }).eq('id', gastoId).eq('auth_user_id', TX.userId);
}
function abrirCerrar(id) {
  const o = ot(id); if (!o) return; MT.edit = id;
  $('mc-titulo').textContent = `Cerrar ${o.numero}`; $('mc-resumen').textContent = `${nomU(o.unidad_id)} · ${o.descripcion}`;
  $('mc-mano').value = Number(o.mano_obra) || ''; $('mc-rep').value = Number(o.repuestos) || ''; $('mc-odo').value = o.odometro_km ?? uni(o.unidad_id)?.odometro_km ?? ''; $('mc-fecha').value = TX.hoyISO(); $('mc-error').textContent = '';
  $('mc-metodo').innerHTML = MT.metodos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
  $('mc-caja-wrap').style.display = MT.metodos.length > 0 && !!window.CajaAPI ? '' : 'none'; $('mc-caja').checked = false; $('mc-metodo-wrap').style.display = 'none';
  cambiaMetodo(); TX.abrir('mm-modal-cerrar');
}
function cambiaMetodo() {
  const n = ($('mc-metodo').selectedOptions[0]?.textContent || '').toLowerCase();
  const nec = $('mc-caja').checked && (n.includes('tarjeta') || n.includes('transferencia')) && MT.bancos.length > 0;
  $('mc-banco-wrap').style.display = nec ? '' : 'none';
  if (nec) $('mc-banco').innerHTML = '<option value="">Selecciona un banco…</option>' + MT.bancos.map(b => `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`).join('');
}
async function guardarCierre() {
  const err = m => { $('mc-error').textContent = m; };
  const o = ot(MT.edit); if (!o || o.estado !== 'abierta') return err('Esta orden ya no está abierta.');
  const u = uni(o.unidad_id);
  const mano = num($('mc-mano').value) || 0, rep = num($('mc-rep').value) || 0, total = r2(mano + rep), odo = num($('mc-odo').value), fecha = $('mc-fecha').value || TX.hoyISO();
  if (mano < 0 || rep < 0) return err('Los costos no pueden ser negativos.');
  if (odo != null && u?.odometro_km != null && odo < Number(u.odometro_km)) return err(`El kilometraje no puede ser menor al actual de la unidad (${fmtKm(u.odometro_km)}).`);
  const caja = total > 0 && $('mc-caja-wrap').style.display !== 'none' && $('mc-caja').checked;
  let metodo = null, bancoId = null;
  if (caja) {
    metodo = MT.metodos.find(m => m.id === $('mc-metodo').value); if (!metodo) return err('Elige el método de pago.');
    if ($('mc-banco-wrap').style.display !== 'none') { bancoId = $('mc-banco').value; if (!bancoId) return err('Selecciona de qué banco sale el dinero.'); }
  }
  const btn = $('mc-guardar'); btn.disabled = true;
  let gastoId = null, movId = null, cerrada = false;
  try {
    if (caja) {
      const concepto = `Mantenimiento ${o.numero} · ${o.descripcion}`, obs = `Orden de trabajo ${o.numero} · ${nomU(o.unidad_id)}${o.taller ? ' · ' + o.taller : ''}`;
      const { data: g, error: eg } = await sb.from('gastos').insert({
        auth_user_id: TX.userId, tipo: 'inmediato', concepto, categoria: 'Mantenimiento', monto: total, fecha, metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre,
        impuesto: 0, observaciones: obs, estado: 'activo',
      }).select().single();
      if (eg) throw eg; gastoId = g.id;
      const mov = await window.CajaAPI.registrarMovimiento({
        auth_user_id: TX.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'GASTO', concepto: `Mantenimiento: ${concepto}`, monto: total,
        metodo_pago_id: metodo.id, metodo_pago_nombre: metodo.nombre, origen_caja: null, banco_id: bancoId || null,
        referencia_tipo: 'gasto', referencia_id: g.id, observaciones: obs, fecha,
      });
      if (!mov.ok) { await sb.from('gastos').delete().eq('id', g.id).eq('auth_user_id', TX.userId); gastoId = null; throw new Error('Caja: ' + mov.error); }
      movId = await ultimoMovimientoId();
      if (movId) await sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', g.id).eq('auth_user_id', TX.userId);
    }
    const plan = o.plan_id ? MT.planes.find(x => x.id === o.plan_id) : null;
    const { error } = await sb.from('transporte_mant_ordenes').update({
      estado: 'cerrada', mano_obra: r2(mano), repuestos: r2(rep), total, odometro_km: odo, fecha, cerrada_en: new Date().toISOString(), gasto_id: gastoId, movimiento_caja_id: movId,
      ...(plan ? { plan_prev_set: true, plan_prev_km: plan.ultimo_km ?? null, plan_prev_fecha: plan.ultima_fecha || null } : {}),
    }).eq('id', o.id).eq('auth_user_id', TX.userId).eq('estado', 'abierta');
    if (error) throw error;
    cerrada = true;
    // Efectos secundarios (no deben impedir el cierre): plan preventivo y kilometraje/estado de la unidad.
    try {
      if (o.plan_id) await sb.from('transporte_mant_planes').update({ ultimo_km: odo ?? u?.odometro_km ?? null, ultima_fecha: fecha }).eq('id', o.plan_id).eq('auth_user_id', TX.userId);
      if (u && odo != null && (u.odometro_km == null || odo > Number(u.odometro_km))) await sb.from('transporte_unidades').update({ odometro_km: odo }).eq('id', u.id).eq('auth_user_id', TX.userId);
    } catch (e) { console.warn('cierre OT:', e); TX.toast('La orden se cerró, pero no se pudo actualizar el plan o el kilometraje.', 'error'); }
    await devolverUnidad(o, `Terminó la orden ${o.numero}`);
    TX.cerrar('mm-modal-cerrar'); TX.toast(caja ? 'Orden cerrada y pago registrado en Caja' : 'Orden cerrada'); await cargarTodo(); renderTodo();
  } catch (e) {
    console.error(e);
    if (cerrada) { TX.cerrar('mm-modal-cerrar'); try { await cargarTodo(); renderTodo(); } catch (_) {} TX.toast('La orden se cerró, pero hubo un problema al refrescar la pantalla. Recarga la página.', 'error'); return; }
    try { if (gastoId) await anularGasto(gastoId, 'No se pudo cerrar la orden de trabajo'); } catch (_) {}
    err('No se pudo cerrar la orden. No se registró nada en Caja.');
  } finally { btn.disabled = false; }
}
async function cancelarOT(id) {
  const o = ot(id); if (!o) return;
  if (!await TX.confirmar('¿Cancelar esta orden?', 'La unidad vuelve a su estado anterior y la orden queda como cancelada.', 'Cancelar orden', true)) return;
  try {
    const { error } = await sb.from('transporte_mant_ordenes').update({ estado: 'cancelada' }).eq('id', id).eq('auth_user_id', TX.userId).eq('estado', 'abierta'); if (error) throw error;
    await devolverUnidad(o, `Se canceló la orden ${o.numero}`); TX.toast('Orden cancelada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo cancelar la orden.', 'error'); }
}
async function anularOT(id) {
  const o = ot(id); if (!o) return;
  const txt = (o.gasto_id ? 'El dinero vuelve a Caja y el gasto se anula. ' : '') + 'El plan preventivo vuelve a su último servicio anterior.';
  if (!await TX.confirmar('¿Anular esta orden cerrada?', txt, 'Anular', true)) return;
  try {
    if (o.gasto_id) await anularGasto(o.gasto_id, `Orden de trabajo ${o.numero} anulada`);
    const { error } = await sb.from('transporte_mant_ordenes').update({ estado: 'cancelada', gasto_id: null, movimiento_caja_id: null }).eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error;
    // Revierte el plan solo si esta orden fue el último servicio registrado (no hay otra cerrada posterior del mismo plan).
    try {
      const plan = o.plan_id ? MT.planes.find(x => x.id === o.plan_id) : null;
      const posterior = MT.ots.some(x => x.id !== o.id && x.plan_id === o.plan_id && x.estado === 'cerrada' && (x.cerrada_en || '') > (o.cerrada_en || ''));
      if (plan && o.plan_prev_set && !posterior) await sb.from('transporte_mant_planes').update({ ultimo_km: o.plan_prev_km ?? null, ultima_fecha: o.plan_prev_fecha || null }).eq('id', plan.id).eq('auth_user_id', TX.userId);
    } catch (e) { console.warn('revertir plan:', e); }
    TX.toast('Orden anulada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo anular la orden.', 'error'); }
}
async function borrarOT(id) {
  if (!await TX.confirmar('¿Eliminar esta orden?', 'Se quita de la lista de órdenes canceladas.', 'Eliminar', true)) return;
  try { const { error } = await sb.from('transporte_mant_ordenes').delete().eq('id', id).eq('auth_user_id', TX.userId).eq('estado', 'cancelada'); if (error) throw error; TX.toast('Orden eliminada'); await cargarTodo(); renderTodo(); }
  catch (e) { console.error(e); TX.toast('No se pudo eliminar la orden.', 'error'); }
}

/* ---------------- Llantas ---------------- */
async function movLlanta(l, tipo, extra) {
  try { await sb.from('transporte_llantas_movs').insert({ auth_user_id: TX.userId, llanta_id: l.id, tipo, fecha: TX.hoyISO(), ...extra }); } catch (e) { console.warn('mov llanta:', e); }
}
function abrirLlanta(id) {
  const l = id ? lla(id) : null; MT.edit = id || null;
  $('ml-titulo').textContent = l ? 'Editar llanta' : 'Nueva llanta';
  $('ml-codigo').value = l?.codigo || ''; $('ml-medida').value = l?.medida || ''; $('ml-marca').value = l?.marca || ''; $('ml-modelo').value = l?.modelo || '';
  $('ml-vida').value = l?.vida_util_km ?? 80000; $('ml-costo').value = l && Number(l.costo) > 0 ? l.costo : ''; $('ml-fecha').value = l?.fecha_compra || ''; $('ml-prov').value = l?.proveedor || '';
  $('ml-km0').value = l?.km_previos ?? 0; $('ml-notas').value = l?.notas || ''; $('ml-error').textContent = '';
  TX.abrir('mm-modal-llanta');
}
async function guardarLlanta() {
  const err = m => { $('ml-error').textContent = m; };
  const codigo = $('ml-codigo').value.trim(); if (!codigo) return err('Escribe el código o serie de la llanta.');
  if (MT.llantas.some(x => x.id !== MT.edit && String(x.codigo).toLowerCase() === codigo.toLowerCase())) return err('Ya hay una llanta con ese código.');
  const vida = num($('ml-vida').value), costo = num($('ml-costo').value) || 0, km0 = num($('ml-km0').value) || 0;
  if (!(vida > 0)) return err('La vida útil debe ser mayor a cero.'); if (costo < 0 || km0 < 0) return err('Los valores no pueden ser negativos.');
  const fila = { codigo, medida: $('ml-medida').value.trim() || null, marca: $('ml-marca').value.trim() || null, modelo: $('ml-modelo').value.trim() || null, vida_util_km: vida, costo: r2(costo),
    fecha_compra: $('ml-fecha').value || null, proveedor: $('ml-prov').value.trim() || null, km_previos: km0, notas: $('ml-notas').value.trim() || null, updated_at: new Date().toISOString() };
  const btn = $('ml-guardar'); btn.disabled = true;
  try {
    if (MT.edit) { const { error } = await sb.from('transporte_llantas').update(fila).eq('id', MT.edit).eq('auth_user_id', TX.userId); if (error) throw error; }
    else {
      const { data, error } = await sb.from('transporte_llantas').insert({ ...fila, auth_user_id: TX.userId, estado: km0 > 0 ? 'almacen' : 'nueva' }).select().single(); if (error) throw error;
      await movLlanta(data, 'alta', { notas: km0 > 0 ? `Ingresó con ${fmtKm(km0)}` : null });
    }
    TX.cerrar('mm-modal-llanta'); TX.toast('Llanta guardada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); err('No se pudo guardar la llanta.'); } finally { btn.disabled = false; }
}
function ocupante(unidadId, pos, exceptoId) {
  const p = String(pos || '').trim().toLowerCase(); if (!p) return null;
  return MT.llantas.find(x => x.id !== exceptoId && x.estado === 'en_uso' && x.unidad_id === unidadId && String(x.posicion || '').trim().toLowerCase() === p) || null;
}
function abrirMontar(id, rotar) {
  const l = lla(id); if (!l) return; MT.edit = id; MT.rotar = !!rotar;
  $('mt-titulo').textContent = rotar ? `Rotar ${l.codigo}` : `Montar ${l.codigo}`;
  $('mt-unidad-wrap').style.display = rotar ? 'none' : '';
  $('mt-odo-wrap').style.display = rotar ? 'none' : '';
  $('mt-unidad').innerHTML = MT.unidades.map(u => `<option value="${esc(u.id)}">${esc(nomU(u.id))}</option>`).join('');
  $('mt-unidad').value = l.unidad_id || MT.unidades[0]?.id || '';
  $('mt-pos').value = rotar ? '' : (l.posicion || ''); $('mt-error').textContent = ''; $('mt-ocupada').textContent = '';
  $('mt-odo').value = uni($('mt-unidad').value)?.odometro_km ?? '';
  TX.abrir('mm-modal-montar');
}
function avisoOcupada() {
  const l = lla(MT.edit); if (!l) return;
  const uid = MT.rotar ? l.unidad_id : $('mt-unidad').value, o = ocupante(uid, $('mt-pos').value, l.id);
  $('mt-ocupada').textContent = o ? (MT.rotar ? `Esa posición la ocupa ${o.codigo}: se intercambiarán de lugar.` : `Esa posición ya la ocupa ${o.codigo}. Desmóntala o rótala primero.`) : '';
}
async function guardarMontar() {
  const err = m => { $('mt-error').textContent = m; };
  const l = lla(MT.edit); if (!l) return;
  const pos = $('mt-pos').value.trim(); if (!pos) return err('Indica la posición de la llanta.');
  const btn = $('mt-guardar'); btn.disabled = true;
  try {
    if (MT.rotar) {
      const otra = ocupante(l.unidad_id, pos, l.id), posAnt = l.posicion;
      if (otra) {
        await sb.from('transporte_llantas').update({ posicion: posAnt, updated_at: new Date().toISOString() }).eq('id', otra.id).eq('auth_user_id', TX.userId);
        await movLlanta(otra, 'rotacion', { unidad_id: otra.unidad_id, posicion: posAnt, odometro_km: uni(otra.unidad_id)?.odometro_km ?? null, notas: `Intercambio con ${l.codigo}` });
      }
      const { error } = await sb.from('transporte_llantas').update({ posicion: pos, updated_at: new Date().toISOString() }).eq('id', l.id).eq('auth_user_id', TX.userId); if (error) throw error;
      await movLlanta(l, 'rotacion', { unidad_id: l.unidad_id, posicion: pos, odometro_km: uni(l.unidad_id)?.odometro_km ?? null, notas: `Antes: ${posAnt || '—'}` });
    } else {
      const uid = $('mt-unidad').value; if (!uid) return err('Elige la unidad.');
      const o = ocupante(uid, pos, l.id); if (o) return err(`Esa posición ya la ocupa ${o.codigo}. Desmóntala o rótala primero.`);
      const odoU = uni(uid)?.odometro_km, odo = num($('mt-odo').value) ?? (odoU != null ? Number(odoU) : 0);
      if (odo < 0) return err('El kilometraje no puede ser negativo.');
      const { error } = await sb.from('transporte_llantas').update({ estado: 'en_uso', unidad_id: uid, posicion: pos, km_montaje: odo || 0, fecha_montaje: TX.hoyISO(), updated_at: new Date().toISOString() }).eq('id', l.id).eq('auth_user_id', TX.userId); if (error) throw error;
      await movLlanta(l, 'montaje', { unidad_id: uid, posicion: pos, odometro_km: odo });
    }
    TX.cerrar('mm-modal-montar'); TX.toast(MT.rotar ? 'Llanta rotada' : 'Llanta montada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); err('No se pudo guardar el cambio.'); } finally { btn.disabled = false; }
}
function abrirDesmontar(id) {
  const l = lla(id); if (!l) return; MT.edit = id;
  $('md-titulo').textContent = `Desmontar ${l.codigo}`; $('md-destino').value = 'almacen'; $('md-odo').value = uni(l.unidad_id)?.odometro_km ?? ''; $('md-nota').value = ''; $('md-error').textContent = '';
  TX.abrir('mm-modal-desmontar');
}
async function guardarDesmontar() {
  const err = m => { $('md-error').textContent = m; };
  const l = lla(MT.edit); if (!l) return;
  const odo = num($('md-odo').value); if (odo != null && l.km_montaje != null && odo < Number(l.km_montaje)) return err('El kilometraje no puede ser menor al que tenía al montarla.');
  const destino = $('md-destino').value, recorrido = odo != null && l.km_montaje != null ? Math.max(0, odo - Number(l.km_montaje)) : Math.max(0, kmRodados(l) - Number(l.km_previos || 0));
  const acumulado = Number(l.km_previos || 0) + recorrido;
  const btn = $('md-guardar'); btn.disabled = true;
  try {
    const patch = { estado: destino, unidad_id: null, posicion: null, km_montaje: null, fecha_montaje: null, km_previos: destino === 'recapada' ? 0 : acumulado, updated_at: new Date().toISOString() };
    const { error } = await sb.from('transporte_llantas').update(patch).eq('id', l.id).eq('auth_user_id', TX.userId); if (error) throw error;
    await movLlanta(l, destino === 'descartada' ? 'descarte' : destino === 'recapada' ? 'recapado' : 'desmontaje', { unidad_id: l.unidad_id, posicion: l.posicion, odometro_km: odo,
      notas: [`Rodó ${fmtKm(recorrido)} en esta unidad (acumulado ${fmtKm(acumulado)})`, $('md-nota').value.trim()].filter(Boolean).join(' · ') });
    TX.cerrar('mm-modal-desmontar'); TX.toast('Llanta desmontada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); err('No se pudo desmontar la llanta.'); } finally { btn.disabled = false; }
}
async function accionAlmacen(id, destino) {
  const l = lla(id); if (!l) return;
  const txt = destino === 'recapada' ? 'Se marca como recapada y el conteo de km empieza de nuevo (el historial se conserva).' : 'Se marca como descartada y ya no se podrá montar.';
  if (!await TX.confirmar(destino === 'recapada' ? '¿Recapar esta llanta?' : '¿Descartar esta llanta?', txt, destino === 'recapada' ? 'Recapar' : 'Descartar', destino === 'descartada')) return;
  try {
    const patch = destino === 'recapada' ? { estado: 'recapada', km_previos: 0, updated_at: new Date().toISOString() } : { estado: 'descartada', updated_at: new Date().toISOString() };
    const { error } = await sb.from('transporte_llantas').update(patch).eq('id', id).eq('auth_user_id', TX.userId); if (error) throw error;
    await movLlanta(l, destino === 'recapada' ? 'recapado' : 'descarte', { notas: destino === 'recapada' ? `Tenía ${fmtKm(l.km_previos)} acumulados` : null });
    TX.toast(destino === 'recapada' ? 'Llanta recapada' : 'Llanta descartada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo guardar el cambio.', 'error'); }
}
function verHistorial(id) {
  const l = lla(id); if (!l) return;
  const ms = MT.movs.filter(m => m.llanta_id === id);
  $('mh-titulo').textContent = `Historial de ${l.codigo}`;
  $('mh-cuerpo').innerHTML = `<div class="tx-datos"><div class="tx-dato"><span>Km rodados</span><b>${esc(fmtKm(kmRodados(l)))}</b></div><div class="tx-dato"><span>Vida útil</span><b>${esc(fmtKm(l.vida_util_km))}</b></div><div class="tx-dato"><span>Costo</span><b>${esc(money(l.costo))}</b></div></div>`
    + (ms.length ? ms.map(m => `<div class="tx-linea"><b>${esc(MOV_TXT[m.tipo] || m.tipo)}${m.unidad_id ? ' · ' + esc(nomU(m.unidad_id)) : ''}${m.posicion ? ' · ' + esc(m.posicion) : ''}</b>${m.notas ? ' · ' + esc(m.notas) : ''}<small>${esc(TX.fmtFecha(m.fecha))}${m.odometro_km != null ? ' · ' + esc(fmtKm(m.odometro_km)) : ''}</small></div>`).join('') : '<div style="font-size:13px;color:var(--text-muted)">Sin movimientos todavía.</div>');
  TX.abrir('mm-modal-hist');
}
async function borrarLlanta(id) {
  const l = lla(id); if (!l) return;
  if (!await TX.confirmar('¿Eliminar esta llanta?', 'Se elimina la llanta con todo su historial.', 'Eliminar', true)) return;
  try {
    await sb.from('transporte_llantas_movs').delete().eq('llanta_id', id).eq('auth_user_id', TX.userId);
    const { error } = await sb.from('transporte_llantas').delete().eq('id', id).eq('auth_user_id', TX.userId).neq('estado', 'en_uso'); if (error) throw error;
    TX.toast('Llanta eliminada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo eliminar la llanta.', 'error'); }
}

/* ---------------- Eventos ---------------- */
function enlazar() {
  $('mp-guardar').addEventListener('click', guardarPlan);
  $('mo-guardar').addEventListener('click', guardarOT);
  $('mc-guardar').addEventListener('click', guardarCierre);
  $('ml-guardar').addEventListener('click', guardarLlanta);
  $('mt-guardar').addEventListener('click', guardarMontar);
  $('md-guardar').addEventListener('click', guardarDesmontar);
  $('mo-unidad').addEventListener('change', () => { $('mo-odo').dataset.manual = ''; llenarPlanesOT(); });
  $('mo-odo').addEventListener('input', () => { $('mo-odo').dataset.manual = '1'; });
  $('mo-tipo').addEventListener('change', cambiaTipoOT);
  $('mo-plan').addEventListener('change', () => { const p = plan($('mo-plan').value); if (p && !$('mo-desc').value.trim()) $('mo-desc').value = p.nombre; });
  $('mc-caja').addEventListener('change', () => { $('mc-metodo-wrap').style.display = $('mc-caja').checked ? '' : 'none'; cambiaMetodo(); });
  $('mc-metodo').addEventListener('change', cambiaMetodo);
  $('mt-pos').addEventListener('input', avisoOcupada);
  $('mt-unidad').addEventListener('change', () => { $('mt-odo').value = uni($('mt-unidad').value)?.odometro_km ?? ''; avisoOcupada(); });
  document.addEventListener('change', e => {
    if (e.target.id === 'mm-f-unidad') { MT.filtroUnidad = e.target.value; renderVista(); }
    else if (e.target.id === 'mm-f-ot') { MT.filtroOT = e.target.value; renderVista(); }
    else if (e.target.id === 'mm-f-ll') { MT.filtroLlanta = e.target.value; renderVista(); }
    else if (e.target.id === 'mm-ll-agrupar') { MT.agrupar = e.target.checked; renderVista(); }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-mm-vista],[data-mm-plan-nuevo],[data-mm-plan-editar],[data-mm-plan-borrar],[data-mm-ot-plan],[data-mm-ot-nueva],[data-mm-ot-cerrar],[data-mm-ot-cancelar],[data-mm-ot-anular],[data-mm-ot-borrar],[data-mm-ll-nueva],[data-mm-ll-editar],[data-mm-ll-borrar],[data-mm-ll-montar],[data-mm-ll-rotar],[data-mm-ll-desmontar],[data-mm-ll-recapar],[data-mm-ll-descartar],[data-mm-ll-hist]');
    if (!t) return; const d = t.dataset;
    if (d.mmVista) { MT.vista = d.mmVista; renderVista(); }
    else if ('mmPlanNuevo' in d) abrirPlan(null);
    else if (d.mmPlanEditar) abrirPlan(d.mmPlanEditar);
    else if (d.mmPlanBorrar) borrarPlan(d.mmPlanBorrar);
    else if (d.mmOtPlan) abrirOT(d.mmOtPlan);
    else if ('mmOtNueva' in d) abrirOT(null);
    else if (d.mmOtCerrar) abrirCerrar(d.mmOtCerrar);
    else if (d.mmOtCancelar) cancelarOT(d.mmOtCancelar);
    else if (d.mmOtAnular) anularOT(d.mmOtAnular);
    else if (d.mmOtBorrar) borrarOT(d.mmOtBorrar);
    else if ('mmLlNueva' in d) abrirLlanta(null);
    else if (d.mmLlEditar) abrirLlanta(d.mmLlEditar);
    else if (d.mmLlBorrar) borrarLlanta(d.mmLlBorrar);
    else if (d.mmLlMontar) abrirMontar(d.mmLlMontar, false);
    else if (d.mmLlRotar) abrirMontar(d.mmLlRotar, true);
    else if (d.mmLlDesmontar) abrirDesmontar(d.mmLlDesmontar);
    else if (d.mmLlRecapar) accionAlmacen(d.mmLlRecapar, 'recapada');
    else if (d.mmLlDescartar) accionAlmacen(d.mmLlDescartar, 'descartada');
    else if (d.mmLlHist) verHistorial(d.mmLlHist);
  });
}

window.MT = MT;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => {
    enlazar(); await cargarTodo();
    const v = new URLSearchParams(location.search).get('vista');
    if (['preventivo', 'ordenes', 'llantas'].includes(v)) MT.vista = v;
    const u = new URLSearchParams(location.search).get('unidad'); if (u && uni(u)) MT.filtroUnidad = u;
    renderTodo();
  });
});
