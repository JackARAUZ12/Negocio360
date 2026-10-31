/* =====================================================
   TALLER-VEHICULOS.JS — NEGOCIO360 · Vehículos y flotas
   Autos, camionetas, motos, camiones, buses y pesados. Se leen con
   permisos del dueño; guardar y archivar pasan por el servidor, que
   impide placas repetidas y clientes ajenos.
===================================================== */
'use strict';
const TIPOS_VEH = { auto: '🚗 Auto', camioneta: '🛻 Camioneta', moto: '🏍️ Moto', camion: '🚚 Camión', bus: '🚌 Bus', pesado: '🚜 Pesado', otro: '🔧 Otro' };
const ESTADO_ORD = { recibido: 'Recibido', diagnostico: 'Diagnóstico', esperando_aprobacion: 'Esperando aprobación', en_reparacion: 'En reparación', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };

const TV = { veh: [], clientes: [], abiertas: {}, editId: null, guardando: false };

window.tallerListo = async function () {
  $('f-tipo').innerHTML = Object.entries(TIPOS_VEH).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('v-tipo').innerHTML = '<option value="">Todos los tipos</option>' + Object.entries(TIPOS_VEH).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  await TV.cargar();
  const q = new URLSearchParams(location.search);
  if (q.get('nuevo') === '1') TV.nuevo();
};
const $ = id => document.getElementById(id);

TV.cargar = async function () {
  const uid = TL.userId;
  try {
    const [v, c, o] = await Promise.all([
      sb.from('taller_vehiculos').select('*').eq('auth_user_id', uid).order('created_at', { ascending: false }).limit(2000),
      sb.from('clientes').select('id,nombre').eq('auth_user_id', uid).eq('activo', true).order('nombre').limit(2000),
      sb.from('taller_ordenes').select('id,numero,vehiculo_id,estado').eq('auth_user_id', uid).not('estado', 'in', '(entregado,cancelado)'),
    ]);
    if (v.error) throw v.error;
    TV.veh = v.data || []; TV.clientes = c.data || [];
    TV.abiertas = {}; (o.data || []).forEach(x => { TV.abiertas[x.vehiculo_id] = x; });
  } catch (e) { console.warn(e); $('v-lista').innerHTML = '<div class="tl-vacio">No se pudieron cargar los vehículos. Recarga la pantalla.</div>'; return; }
  $('f-cliente').innerHTML = '<option value="">Sin cliente</option>' + TV.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  TV.pintar();
};
TV.cliente = id => (TV.clientes.find(c => c.id === id) || {}).nombre || '';
TV.pintar = function () {
  const q = ($('v-buscar').value || '').trim().toLowerCase(), t = $('v-tipo').value, arch = $('v-arch').checked;
  const lista = TV.veh.filter(v => (arch ? true : v.activo) && (!t || v.tipo === t) &&
    (!q || [v.placa, v.marca, v.modelo, v.vin, TV.cliente(v.cliente_id)].some(x => String(x || '').toLowerCase().includes(q))));
  $('v-lista').innerHTML = lista.length ? lista.map(v => {
    const ab = TV.abiertas[v.id];
    return `<div class="tl-card">
      <h3><span><span class="tl-placa">${esc(v.placa || 'SIN PLACA')}</span></span><span class="tl-muted">${esc(TIPOS_VEH[v.tipo] || '')}</span></h3>
      <div><b>${esc([v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || 'Sin datos')}</b>${v.color ? ` · ${esc(v.color)}` : ''}</div>
      <div class="tl-muted">${v.cliente_id ? '👤 ' + esc(TV.cliente(v.cliente_id) || 'Cliente') : 'Sin dueño asignado'}${v.km_actual != null ? ` · ${Number(v.km_actual).toLocaleString('es-NI')} km` : ''}</div>
      ${v.vin ? `<div class="tl-muted">VIN: ${esc(v.vin)}</div>` : ''}
      ${!v.activo ? '<span class="badge badge-neutral" style="align-self:flex-start">Archivado</span>' : ''}
      ${ab ? `<span class="badge badge-warning" style="align-self:flex-start">En taller · ${esc(ab.numero)} · ${esc(ESTADO_ORD[ab.estado] || '')}</span>` : ''}
      <div class="tl-acc">
        ${v.activo ? (ab ? `<button class="btn-primary" onclick="TV.verOrden('${ab.id}')">Ver orden</button>` : `<button class="btn-primary" onclick="TV.nuevaOrden('${v.id}')">Nueva orden</button>`) : ''}
        <button class="btn-secondary" onclick="TV.editar('${v.id}')">Editar</button>
        <button class="btn-secondary" onclick="TV.archivar('${v.id}', ${v.activo ? 'false' : 'true'})">${v.activo ? 'Archivar' : 'Reactivar'}</button>
      </div></div>`;
  }).join('') : `<div class="tl-vacio" style="grid-column:1/-1">${TV.veh.length ? 'Ningún vehículo coincide con la búsqueda.' : 'Aún no hay vehículos. Toca “+ Nuevo vehículo” para registrar el primero.'}</div>`;
};
TV.nuevaOrden = id => { location.href = 'taller-ordenes.html?nuevo=' + encodeURIComponent(id); };
TV.verOrden = id => { location.href = 'taller-ordenes.html?ot=' + encodeURIComponent(id); };

TV.abrir = function (v) {
  TV.editId = v ? v.id : null;
  $('v-titulo').textContent = v ? 'Editar vehículo' : 'Nuevo vehículo';
  const set = (id, val) => { $(id).value = val == null ? '' : val; };
  set('f-placa', v?.placa); set('f-tipo', v?.tipo || 'auto'); set('f-marca', v?.marca); set('f-modelo', v?.modelo); set('f-anio', v?.anio);
  set('f-color', v?.color); set('f-vin', v?.vin); set('f-km', v?.km_actual); set('f-cliente', v?.cliente_id || ''); set('f-notas', v?.notas);
  $('v-aviso').innerHTML = ''; $('v-historial').innerHTML = '';
  $('v-modal').classList.add('abierto'); document.body.style.overflow = 'hidden';
  if (v) TV.historial(v.id);
  setTimeout(() => $('f-placa').focus(), 50);
};
TV.nuevo = () => TV.abrir(null);
TV.editar = id => TV.abrir(TV.veh.find(x => x.id === id));
TV.cerrar = function () { $('v-modal').classList.remove('abierto'); document.body.style.overflow = ''; TV.editId = null; };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('v-modal')?.classList.contains('abierto')) TV.cerrar(); });

TV.historial = async function (id) {
  try {
    const { data } = await sb.from('taller_ordenes').select('numero,estado,fecha_ingreso,total,falla_reportada').eq('auth_user_id', TL.userId).eq('vehiculo_id', id).order('fecha_ingreso', { ascending: false }).limit(15);
    $('v-historial').innerHTML = data && data.length ? `<div class="tl-sec"><b>Historial en el taller</b>${data.map(o => `<div class="tl-muted">${esc(o.numero)} · ${tlFecha(o.fecha_ingreso)} · ${esc(ESTADO_ORD[o.estado] || '')} · ${esc(String(o.falla_reportada || '').slice(0, 60))}${o.estado === 'entregado' ? ' · ' + fmt(o.total) : ''}</div>`).join('')}</div>` : '';
  } catch (_) {}
};
TV.guardar = async function () {
  if (TV.guardando) return;
  const val = id => $(id).value.trim();
  const p = { id: TV.editId || null, placa: val('f-placa'), tipo: $('f-tipo').value, marca: val('f-marca'), modelo: val('f-modelo'), anio: val('f-anio'), color: val('f-color'),
    vin: val('f-vin'), km_actual: val('f-km'), cliente_id: $('f-cliente').value, notas: val('f-notas'), creado_por: TL.nombre };
  if (!p.placa && !p.vin) { $('v-aviso').innerHTML = '<div class="tl-aviso">Escribe la placa o el número de chasis (VIN).</div>'; return; }
  TV.guardando = true; $('v-guardar').disabled = true; $('v-guardar').textContent = 'Guardando…';
  const r = await tlRpc('taller_vehiculo_guardar', { p });
  TV.guardando = false; $('v-guardar').disabled = false; $('v-guardar').textContent = 'Guardar vehículo';
  if (!r.ok) { $('v-aviso').innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  showToast('✅ Vehículo guardado');
  TV.cerrar(); await TV.cargar();
};
TV.archivar = async function (id, activo) {
  if (!activo && !confirm('¿Archivar este vehículo? Dejará de aparecer en la lista (puedes reactivarlo).')) return;
  const r = await tlRpc('taller_vehiculo_archivar', { p_id: id, p_activo: activo });
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast(activo ? '✅ Vehículo reactivado' : '✅ Vehículo archivado'); await TV.cargar();
};

TV.clienteNuevo = function () {
  tlCrearCliente(c => {
    TV.clientes.push({ id: c.id, nombre: c.nombre });
    const sel = $('f-cliente'); const op = document.createElement('option'); op.value = c.id; op.textContent = c.nombre; sel.appendChild(op); sel.value = c.id;
  });
};
