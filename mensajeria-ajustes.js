/* =====================================================
   MENSAJERIA-AJUSTES.JS — NEGOCIO360 · Mensajería: Zonas, tarifas y repartidores
   Zonas con su precio, precios especiales por comercio, recargos
   (urgente, grande, reintento), tope de efectivo, y repartidores
   (con su usuario del sistema para que cada uno vea solo lo suyo).
   Todo cambio pasa por funciones del servidor (msj_*).
===================================================== */
'use strict';
const TA = { tabActual: 'zonas', zonas: [], reps: [], cfg: {}, comercios: [], usuarios: [], ocupado: false };
const $a = id => document.getElementById(id);

TA.tab = function (t) {
  TA.tabActual = t;
  document.querySelectorAll('#a-tabs .ms-tab').forEach(b => { const si = b.dataset.tab === t; b.classList.toggle('activa', si); b.setAttribute('aria-selected', si ? 'true' : 'false'); });
  ({ zonas: TA.pintarZonas, precios: TA.pintarPrecios, recargos: TA.pintarRecargos, repartidores: TA.pintarReps })[t]();
};
TA.recargar = async function () {
  const [z, r, c] = await Promise.all([msZonas(false), msRepartidores(false), msConfig()]);
  TA.zonas = z; TA.reps = r; TA.cfg = c; TA.tab(TA.tabActual);
};

/* ---------- Zonas ---------- */
TA.pintarZonas = function () {
  $a('a-cuerpo').innerHTML = `<div class="tl-bar"><span class="tl-muted" style="flex:1 1 220px">Cada zona tiene su precio de envío. Al registrar un envío eliges la zona y la tarifa sale sola.</span>
      <button type="button" class="btn-primary" onclick="TA.zona()">+ Nueva zona</button></div>
    <div class="tl-cards">${TA.zonas.map(z => `<div class="tl-card" style="${z.activo ? '' : 'opacity:.6'}"><h3><span>${esc(z.nombre)}</span><span class="ms-monto">${fmt(z.tarifa)}</span></h3>
      ${z.notas ? `<div class="tl-muted">${esc(z.notas)}</div>` : ''}${z.activo ? '' : '<span class="ms-chip cancelado">Desactivada</span>'}
      <div class="tl-acc"><button type="button" class="btn-secondary" onclick="TA.zona('${z.id}')">✏️ Editar</button>
        <button type="button" class="btn-secondary" onclick="TA.zonaActivar('${z.id}',${!z.activo})">${z.activo ? '⏸ Desactivar' : '▶ Activar'}</button></div></div>`).join('')
      || '<div class="tl-vacio" style="grid-column:1/-1">Aún no tienes zonas. Ejemplo: “Managua centro” C$ 80, “Ciudad Sandino” C$ 120.</div>'}</div>`;
};
TA.zona = function (id) {
  const z = TA.zonas.find(x => x.id === id) || {};
  const m = msVentana('a-zona', id ? 'Editar zona' : 'Nueva zona', `<div class="tl-f"><label for="z-nom">Nombre de la zona *</label><input class="tl-inp" id="z-nom" maxlength="80" autocomplete="off" value="${esc(z.nombre || '')}" placeholder="Ej. Managua centro"></div>
    <div class="tl-f"><label for="z-tar">Precio del envío *</label><input class="tl-inp" id="z-tar" type="number" inputmode="decimal" min="0" step="0.01" value="${z.tarifa ?? ''}"></div>
    <div class="tl-f"><label for="z-notas">Barrios que incluye / notas</label><input class="tl-inp" id="z-notas" maxlength="300" autocomplete="off" value="${esc(z.notas || '')}"></div><div id="z-av"></div>`,
    '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="z-ok">Guardar zona</button>', 460);
  m.querySelector('#z-ok').onclick = async () => {
    const nom = m.querySelector('#z-nom').value.trim(), t = m.querySelector('#z-tar').value, av = m.querySelector('#z-av');
    if (nom.length < 2) { av.innerHTML = '<div class="tl-aviso">Escribe el nombre de la zona.</div>'; return; }
    if (t === '' || !(Number(t) >= 0)) { av.innerHTML = '<div class="tl-aviso">Escribe el precio del envío (puede ser 0).</div>'; return; }
    const r = await msRpc('msj_zona_guardar', { p: { id: id || null, nombre: nom, tarifa: Number(t), notas: m.querySelector('#z-notas').value.trim() } });
    if (!r.ok) { av.innerHTML = `<div class="tl-aviso">${esc(r.motivo === 'nombre_duplicado' ? 'Ya tienes una zona con ese nombre.' : r.msg)}</div>`; return; }
    m.classList.remove('abierto'); showToast('✅ Zona guardada'); TA.recargar();
  };
  setTimeout(() => { if (!m.contains(document.activeElement)) m.querySelector('#z-nom').focus(); }, 60);
};
TA.zonaActivar = async function (id, activo) {
  const r = await msRpc('msj_zona_activar', { p_id: id, p_activo: activo });
  if (!r.ok) showToast(r.msg, 'error'); else showToast(activo ? 'Zona activada' : 'Zona desactivada: ya no aparece al registrar envíos');
  TA.recargar();
};

/* ---------- Precios especiales por comercio ---------- */
TA.pintarPrecios = async function () {
  if (!TA.comercios.length) TA.comercios = await msComercios();
  const zs = TA.zonas.filter(z => z.activo);
  $a('a-cuerpo').innerHTML = `<div class="tl-muted" style="margin-bottom:10px">Si un comercio tiene un precio distinto (por ejemplo, porque manda muchos envíos), ponlo aquí. Deja en blanco para usar el precio normal de la zona.</div>
    ${!zs.length ? '<div class="tl-aviso">Primero crea tus zonas.</div>' : !TA.comercios.length ? '<div class="tl-aviso">Aún no tienes comercios. Regístralos en Clientes o al crear un envío.</div>' : `
    <div class="tl-bar"><select class="tl-sel" id="p-com" onchange="TA.cargarPrecios()" aria-label="Comercio"><option value="">Elige el comercio…</option>${TA.comercios.map(c => `<option value="${c.id}">${esc(c.completo)}</option>`).join('')}</select></div>
    <div id="p-tabla"></div>`}`;
};
TA.cargarPrecios = async function () {
  const com = $a('p-com').value; if (!com) { $a('p-tabla').innerHTML = ''; return; }
  const { data } = await sb.from('mensajeria_tarifas_comercio').select('*').eq('auth_user_id', TL.userId).eq('comercio_id', com).eq('activo', true);
  const esp = {}; (data || []).forEach(t => { esp[t.zona_id] = t.tarifa; });
  $a('p-tabla').innerHTML = `<table class="tl-tabla"><thead><tr><th>Zona</th><th class="tl-num">Precio normal</th><th>Precio para este comercio</th><th></th></tr></thead><tbody>
    ${TA.zonas.filter(z => z.activo).map(z => `<tr><td data-t="Zona"><b>${esc(z.nombre)}</b></td><td data-t="Normal" class="tl-num">${fmt(z.tarifa)}</td>
      <td data-t="Especial"><input class="tl-inp" style="max-width:150px" type="number" inputmode="decimal" min="0" step="0.01" id="p-${z.id}" value="${esp[z.id] ?? ''}" placeholder="Normal" aria-label="Precio especial en ${esc(z.nombre)}"></td>
      <td class="tl-ac"><button type="button" class="btn-secondary" onclick="TA.guardarPrecio('${z.id}')">Guardar</button></td></tr>`).join('')}</tbody></table>`;
};
TA.guardarPrecio = async function (zona) {
  const com = $a('p-com').value, v = $a('p-' + zona).value.trim();
  if (v !== '' && !(Number(v) >= 0)) { showToast('El precio no es válido.', 'error'); return; }
  const r = await msRpc('msj_tarifa_comercio_guardar', { p_comercio: com, p_zona: zona, p_tarifa: v === '' ? null : Number(v) });
  if (!r.ok) showToast(r.msg, 'error'); else showToast(v === '' ? 'Vuelve al precio normal de la zona' : '✅ Precio especial guardado');
};

/* ---------- Recargos y tope de efectivo ---------- */
TA.pintarRecargos = function () {
  const c = TA.cfg, v = x => Number(x || 0) ? Number(x) : '';
  $a('a-cuerpo').innerHTML = `<div class="tl-sec" style="max-width:560px"><b>➕ Recargos que se suman a la tarifa</b>
    <div class="tl-grid">
      <div class="tl-f"><label for="r-urg">🚨 Envío urgente</label><input class="tl-inp" id="r-urg" type="number" inputmode="decimal" min="0" step="0.01" value="${v(c.recargo_urgente)}" placeholder="0.00"></div>
      <div class="tl-f"><label for="r-gra">📦 Paquete grande</label><input class="tl-inp" id="r-gra" type="number" inputmode="decimal" min="0" step="0.01" value="${v(c.recargo_grande)}" placeholder="0.00"></div>
      <div class="tl-f"><label for="r-rei">🔁 Cada reintento</label><input class="tl-inp" id="r-rei" type="number" inputmode="decimal" min="0" step="0.01" value="${v(c.recargo_reintento)}" placeholder="0.00"><span class="tl-muted">Se suma cuando un envío no entregado se vuelve a asignar.</span></div>
    </div>
    <b>💵 Tope de efectivo por repartidor</b>
    <div class="tl-f"><label for="r-tope">Avisar cuando un repartidor ande con más de</label><input class="tl-inp" id="r-tope" type="number" inputmode="decimal" min="0" step="0.01" value="${v(c.tope_efectivo)}" placeholder="Sin tope"><span class="tl-muted">Por seguridad: si lo pasa, se le avisa que venga a cuadrar. Cada repartidor puede tener su propio tope.</span></div>
    <div id="r-av"></div><div><button type="button" class="btn-primary" id="r-ok" onclick="TA.guardarRecargos()">Guardar</button></div></div>`;
};
TA.guardarRecargos = async function () {
  const g = id => $a(id).value.trim() === '' ? 0 : Number($a(id).value);
  const p = { recargo_urgente: g('r-urg'), recargo_grande: g('r-gra'), recargo_reintento: g('r-rei'), tope_efectivo: g('r-tope') };
  if (Object.values(p).some(x => !(x >= 0))) { $a('r-av').innerHTML = '<div class="tl-aviso">Los montos no pueden ser negativos.</div>'; return; }
  const r = await msRpc('msj_config_guardar', { p });
  if (!r.ok) { $a('r-av').innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  showToast('✅ Recargos guardados'); TA.recargar();
};

/* ---------- Repartidores ---------- */
TA.pintarReps = function () {
  const nomU = id => TA.usuarios.find(u => u.id === id)?.nombre;
  $a('a-cuerpo').innerHTML = `<div class="tl-bar"><span class="tl-muted" style="flex:1 1 220px">Si le das a un repartidor su <b>usuario del sistema</b>, al entrar con su código ve solo sus entregas en “Mis entregas”.</span>
      <button type="button" class="btn-primary" onclick="TA.rep()">+ Nuevo repartidor</button></div>
    <div class="tl-cards">${TA.reps.map(r => `<div class="tl-card" style="${r.activo ? '' : 'opacity:.6'}"><h3><span>${esc(MS_VEHICULOS[r.vehiculo]?.split(' ')[0] || '🛵')} ${esc(r.nombre)}</span>${r.activo ? '' : '<span class="ms-chip cancelado">Desactivado</span>'}</h3>
      <div class="ms-linea">${r.telefono ? '📞 ' + esc(r.telefono) + ' · ' : ''}${r.tipo === 'independiente' ? 'Independiente (por entrega)' : 'Empleado'}${r.placa ? ' · ' + esc(r.placa) : ''}</div>
      <div class="ms-linea">👤 <span>${nomU(r.perfil_id) ? 'Usuario: <b>' + esc(nomU(r.perfil_id)) + '</b>' : 'Sin usuario del sistema'}</span></div>
      ${r.tope_efectivo != null ? `<div class="ms-linea">💵 Tope propio: <b>${fmt(r.tope_efectivo)}</b></div>` : ''}
      <div class="tl-acc"><button type="button" class="btn-secondary" onclick="TA.rep('${r.id}')">✏️ Editar</button>
        <button type="button" class="btn-secondary" onclick="TA.repActivar('${r.id}',${!r.activo})">${r.activo ? '⏸ Desactivar' : '▶ Activar'}</button></div></div>`).join('')
      || '<div class="tl-vacio" style="grid-column:1/-1">Aún no tienes repartidores.</div>'}</div>`;
};
TA.rep = function (id) {
  const r = TA.reps.find(x => x.id === id) || {};
  const usados = new Set(TA.reps.filter(x => x.id !== id && x.perfil_id).map(x => x.perfil_id));
  const ops = TA.usuarios.filter(u => !usados.has(u.id));
  const m = msVentana('a-rep', id ? 'Editar repartidor' : 'Nuevo repartidor', `<div class="tl-grid">
      <div class="tl-f"><label for="rp-nom">Nombre *</label><input class="tl-inp" id="rp-nom" maxlength="120" autocomplete="off" value="${esc(r.nombre || '')}"></div>
      <div class="tl-f"><label for="rp-tel">Teléfono</label><input class="tl-inp" id="rp-tel" type="tel" inputmode="tel" maxlength="30" autocomplete="off" value="${esc(r.telefono || '')}"></div>
      <div class="tl-f"><label for="rp-tipo">Tipo</label><select class="tl-sel" id="rp-tipo"><option value="empleado">Empleado</option><option value="independiente">Independiente (se le paga por entrega)</option></select></div>
      <div class="tl-f"><label for="rp-veh">Vehículo</label><select class="tl-sel" id="rp-veh">${Object.entries(MS_VEHICULOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <div class="tl-f"><label for="rp-placa">Placa</label><input class="tl-inp" id="rp-placa" maxlength="20" autocomplete="off" value="${esc(r.placa || '')}"></div>
      <div class="tl-f"><label for="rp-tope">Tope de efectivo propio</label><input class="tl-inp" id="rp-tope" type="number" inputmode="decimal" min="0" step="0.01" value="${r.tope_efectivo ?? ''}" placeholder="El general"></div>
      <div class="tl-f full"><label for="rp-usr">Usuario del sistema</label><select class="tl-sel" id="rp-usr"><option value="">Sin usuario (lo maneja la oficina)</option>${ops.map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select>
        <span class="tl-muted">Los usuarios se crean en Configuración → Usuarios. Dale acceso a “Mensajería · Mis entregas”.</span></div>
      <div class="tl-f full"><label for="rp-notas">Notas</label><input class="tl-inp" id="rp-notas" maxlength="500" autocomplete="off" value="${esc(r.notas || '')}"></div></div><div id="rp-av"></div>`,
    '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="rp-ok">Guardar repartidor</button>', 620);
  m.querySelector('#rp-tipo').value = r.tipo || 'empleado'; m.querySelector('#rp-veh').value = r.vehiculo || 'moto';
  if (r.perfil_id && !ops.some(u => u.id === r.perfil_id)) m.querySelector('#rp-usr').insertAdjacentHTML('beforeend', `<option value="${r.perfil_id}">Usuario actual</option>`);
  m.querySelector('#rp-usr').value = r.perfil_id || '';
  m.querySelector('#rp-ok').onclick = async () => {
    if (TA.ocupado) return;
    const g = s => m.querySelector(s).value.trim(), av = m.querySelector('#rp-av');
    if (g('#rp-nom').length < 2) { av.innerHTML = '<div class="tl-aviso">Escribe el nombre del repartidor.</div>'; return; }
    if (g('#rp-tope') !== '' && !(Number(g('#rp-tope')) >= 0)) { av.innerHTML = '<div class="tl-aviso">El tope no es válido.</div>'; return; }
    TA.ocupado = true;
    const x = await msRpc('msj_repartidor_guardar', { p: { id: id || null, nombre: g('#rp-nom'), telefono: g('#rp-tel'), tipo: g('#rp-tipo'), vehiculo: g('#rp-veh'), placa: g('#rp-placa'),
      tope_efectivo: g('#rp-tope') === '' ? null : Number(g('#rp-tope')), perfil_id: g('#rp-usr') || null, notas: g('#rp-notas') } });
    TA.ocupado = false;
    if (!x.ok) { av.innerHTML = `<div class="tl-aviso">${esc(x.motivo === 'nombre_duplicado' ? 'Ya tienes un repartidor con ese nombre.' : x.msg)}</div>`; return; }
    m.classList.remove('abierto'); showToast('✅ Repartidor guardado'); TA.recargar();
  };
  setTimeout(() => { if (!m.contains(document.activeElement)) m.querySelector('#rp-nom').focus(); }, 60);
};
TA.repActivar = async function (id, activo) {
  const r = await msRpc('msj_repartidor_activar', { p_id: id, p_activo: activo });
  if (!r.ok) showToast(r.msg, 'error'); else showToast(activo ? 'Repartidor activado' : 'Repartidor desactivado');
  TA.recargar();
};

window.tallerListo = async function () {
  try {
    let { data, error } = await sb.rpc('listar_perfiles_del_grupo_v2');
    if (error) ({ data, error } = await sb.rpc('listar_perfiles_del_grupo'));
    TA.usuarios = (data || []).filter(u => u.activo !== false).map(u => ({ id: u.id, nombre: u.nombre, tipo: u.tipo }));
  } catch (_) { TA.usuarios = []; }
  try { const t = new URLSearchParams(location.search).get('tab'); if (['zonas', 'precios', 'recargos', 'repartidores'].includes(t)) TA.tabActual = t; } catch (_) {}
  await TA.recargar();
};
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('.tl-modal.abierto').forEach(m => m.classList.remove('abierto')); });
