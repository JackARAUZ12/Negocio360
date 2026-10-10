/* ============================================================
   CONDUCTORES.JS — NEGOCIO360 (Transporte · Fase 3)
   Conductores y ayudantes: foto, datos, documentos con vencimiento
   (licencia, pasaporte, visa, certificado médico…), disponibilidad
   y unidad asignada. Se conecta (solo lectura) con Empleados y Flota.
   No modifica ningún otro módulo.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, fmtFecha } = TX;

const CD = {
  lista: [], docs: {}, unidades: [], empleados: [],
  filtro: { q: '', estado: '', rol: '', vinculo: '' },
  editando: null, fotoForm: null, detalleId: null, detalleTab: 'resumen',
};
const ROLES = { conductor: { t: 'Conductor', ico: '🧑‍✈️' }, ayudante: { t: 'Ayudante', ico: '🧑‍🔧' } };
const VINCULOS = { empleado: 'Empleado', subcontratado: 'Subcontratado' };

/* ---------- carga ---------- */
async function cargarTodo() {
  const [lista, docs] = await Promise.all([
    TX.paginar(() => sb.from('transporte_conductores').select('*').eq('auth_user_id', TX.userId).order('nombre')),
    TX.cargarDocs('conductor'),
  ]);
  CD.lista = lista; CD.docs = TX.agruparDocs(docs);
  try {
    const { data } = await sb.from('transporte_unidades').select('id,nombre,placa,tipo,rol,estado').eq('auth_user_id', TX.userId).order('nombre');
    CD.unidades = data || [];
  } catch (_) { CD.unidades = []; }
}
async function cargarEmpleados() {
  try {
    const { data } = await sb.from('empleados').select('id,nombre,cargo,cedula,telefono,correo,direccion,estado,contacto_emergencia_nombre,contacto_emergencia_telefono')
      .eq('auth_user_id', TX.userId).order('nombre');
    CD.empleados = (data || []).filter(e => !['inactivo', 'despedido', 'liquidado'].includes(String(e.estado || '').toLowerCase()));
  } catch (_) { CD.empleados = []; }
}

/* ---------- lista ---------- */
function licenciaDe(c) { return (CD.docs[c.id] || []).filter(d => d.tipo === 'licencia').sort((a, b) => String(b.vencimiento || '').localeCompare(String(a.vencimiento || '')))[0] || null; }
function filtradas() {
  const q = TX.quitarTildes(CD.filtro.q);
  return CD.lista.filter(c => {
    if (CD.filtro.estado && c.estado !== CD.filtro.estado) return false;
    if (CD.filtro.rol && c.rol !== CD.filtro.rol) return false;
    if (CD.filtro.vinculo && c.vinculo !== CD.filtro.vinculo) return false;
    if (q && !TX.quitarTildes([c.nombre, c.cedula, c.telefono].join(' ')).includes(q)) return false;
    return true;
  });
}
function renderKpis() {
  const n = est => CD.lista.filter(c => c.estado === est).length;
  const docs = Object.values(CD.docs).flat().filter(d => CD.lista.some(c => c.id === d.entidad_id));
  const venc = docs.filter(d => TX.estadoDoc(d.vencimiento).clave === 'vencido').length;
  const porv = docs.filter(d => TX.estadoDoc(d.vencimiento).clave === 'por_vencer').length;
  document.getElementById('cd-kpis').innerHTML = `
    <div class="tx-kpi"><span>Personas</span><b>${CD.lista.length}</b><small>${CD.lista.filter(c => c.rol === 'conductor').length} conductores · ${CD.lista.filter(c => c.rol === 'ayudante').length} ayudantes</small></div>
    <div class="tx-kpi"><span>🟢 Disponibles</span><b>${n('disponible')}</b><small>listos para un viaje</small></div>
    <div class="tx-kpi"><span>🔵 En viaje</span><b>${n('en_viaje')}</b><small>en ruta</small></div>
    <div class="tx-kpi"><span>🟠 En descanso</span><b>${n('descanso')}</b><small>vacaciones o permiso</small></div>
    <div class="tx-kpi ${venc ? 'alerta' : ''}"><span>⛔ Docs vencidos</span><b>${venc}</b><small>${venc ? 'requieren atención' : 'todo en orden'}</small></div>
    <div class="tx-kpi ${porv ? 'aviso' : ''}"><span>⚠️ Por vencer</span><b>${porv}</b><small>en ${TX.DIAS_AVISO} días</small></div>`;
}
function renderAvisos() {
  const el = document.getElementById('cd-avisos');
  const items = [];
  CD.lista.forEach(c => (CD.docs[c.id] || []).forEach(d => {
    const e = TX.estadoDoc(d.vencimiento);
    if (e.clave === 'vencido' || e.clave === 'por_vencer') items.push({ c, d, e });
  }));
  items.sort((a, b) => a.e.dias - b.e.dias);
  if (!items.length) { el.innerHTML = ''; return; }
  const hayVenc = items.some(i => i.e.clave === 'vencido');
  el.innerHTML = `<div class="tx-aviso-banda ${hayVenc ? 'rojo' : ''}"><div style="font-size:22px">${hayVenc ? '⛔' : '⚠️'}</div><div>
    <b>${hayVenc ? 'Hay documentos vencidos' : 'Documentos por vencer'}</b>
    ${items.slice(0, 4).map(i => `<div><a href="#" data-cd-abrir="${esc(i.c.id)}" data-tab="docs" style="color:inherit;font-weight:700">${esc(i.c.nombre)}</a> · ${esc(TX.etiquetaDoc('conductor', i.d.tipo).t)} · ${esc(i.e.texto)}</div>`).join('')}
    ${items.length > 4 ? `<div style="color:var(--text-secondary)">…y ${items.length - 4} más</div>` : ''}</div></div>`;
}
function renderLista() {
  const cont = document.getElementById('cd-lista');
  const lista = filtradas();
  if (!lista.length) {
    cont.innerHTML = CD.lista.length
      ? `<div class="tx-vacio"><div class="tx-vacio-i">🔎</div><b>No hay personas con ese filtro</b><p>Prueba con otra búsqueda.</p></div>`
      : `<div class="tx-vacio"><div class="tx-vacio-i">🧑‍✈️</div><b>Aún no has registrado conductores</b><p>Agrega a tus conductores y ayudantes con su licencia, documentos y fotografía.</p>
         <button type="button" class="tx-btn tx-btn-primary" data-cd-nuevo>＋ Agregar el primero</button></div>`;
    return;
  }
  cont.innerHTML = `<div class="tx-grid">${lista.map(c => {
    const est = TX.ESTADOS_CONDUCTOR[c.estado] || TX.ESTADOS_CONDUCTOR.disponible, lic = licenciaDe(c), le = lic ? TX.estadoDoc(lic.vencimiento) : null;
    const salud = TX.saludDocs(CD.docs[c.id]), rol = ROLES[c.rol] || ROLES.conductor;
    const unidad = c.unidad_asignada_id ? CD.unidades.find(u => u.id === c.unidad_asignada_id) : null;
    return `<div class="tx-card" data-cd-abrir="${esc(c.id)}">
      <div class="tx-foto">${c.foto_url ? `<img src="${esc(c.foto_url)}" alt="${esc(c.nombre)}" loading="lazy"/>` : `<div class="tx-av">${esc((c.nombre || '?')[0].toUpperCase())}</div>`}
        <span class="tx-chip ${est.clase}">${est.ico} ${esc(est.t)}</span></div>
      <div class="tx-card-body"><b>${esc(c.nombre)}</b>
        <div class="tx-fila-chips"><span class="tx-chip">${rol.ico} ${esc(rol.t)}</span><span class="tx-chip ${c.vinculo === 'empleado' ? 'azul' : ''}">${esc(VINCULOS[c.vinculo])}</span></div>
        ${c.rol === 'conductor' ? `<div class="tx-fila-chips"><span class="tx-chip ${le ? le.clase : 'gris'}">🪪 ${lic ? esc(le.texto) : 'Sin licencia registrada'}</span></div>` : ''}
        <small>${unidad ? '🚛 ' + esc(unidad.nombre) + (unidad.placa ? ' · ' + esc(unidad.placa) : '') : (c.telefono ? '📞 ' + esc(c.telefono) : '&nbsp;')}</small>
        ${salud.clave === 'vencido' || salud.clave === 'por_vencer' ? `<span class="tx-chip ${salud.clase}">${esc(salud.texto)}</span>` : ''}
      </div></div>`;
  }).join('')}</div>`;
}
function renderTodo() { renderKpis(); renderAvisos(); renderLista(); }

/* ---------- detalle ---------- */
function abrirDetalle(id, tab) {
  if (!CD.lista.find(x => x.id === id)) return;
  CD.detalleId = id; CD.detalleTab = tab || 'resumen'; renderDetalle(); TX.abrir('cd-modal-detalle');
}
function renderDetalle() {
  const c = CD.lista.find(x => x.id === CD.detalleId); if (!c) { TX.cerrar('cd-modal-detalle'); return; }
  const est = TX.ESTADOS_CONDUCTOR[c.estado] || TX.ESTADOS_CONDUCTOR.disponible, docs = CD.docs[c.id] || [], salud = TX.saludDocs(docs), rol = ROLES[c.rol];
  const tabs = [['resumen', 'Resumen'], ['docs', `Documentos (${docs.length})`], ['ciclo', 'Disponibilidad']];
  document.getElementById('cd-detalle-cuerpo').innerHTML = `
    <div class="tx-fila-chips" style="justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div style="min-width:0"><h3 style="margin:0">${rol.ico} ${esc(c.nombre)}</h3>
        <div class="tx-fila-chips" style="margin-top:6px"><span class="tx-chip ${est.clase}">${est.ico} ${esc(est.t)}</span><span class="tx-chip">${esc(rol.t)}</span><span class="tx-chip ${salud.clase}">${esc(salud.texto)}</span></div></div>
      <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-sm" data-cd-editar="${esc(c.id)}">✏️ Editar</button><button type="button" class="tx-btn tx-btn-sm" onclick="TXcerrar('cd-modal-detalle')">Cerrar</button></div>
    </div>
    <div class="tx-tabs">${tabs.map(([k, l]) => `<button type="button" class="tx-tab ${CD.detalleTab === k ? 'on' : ''}" data-cd-tab="${k}">${l}</button>`).join('')}</div>
    <div class="tx-panel ${CD.detalleTab === 'resumen' ? 'on' : ''}">${htmlResumen(c)}</div>
    <div class="tx-panel ${CD.detalleTab === 'docs' ? 'on' : ''}">${TX.htmlDocs('conductor', c.id, docs)}</div>
    <div class="tx-panel ${CD.detalleTab === 'ciclo' ? 'on' : ''}">${htmlCiclo(c)}</div>`;
  if (CD.detalleTab === 'ciclo') cargarHistorialUI(c);
}
function htmlResumen(c) {
  const lic = licenciaDe(c), le = lic ? TX.estadoDoc(lic.vencimiento) : null;
  const unidad = c.unidad_asignada_id ? CD.unidades.find(u => u.id === c.unidad_asignada_id) : null;
  const emp = c.empleado_id ? CD.empleados.find(e => e.id === c.empleado_id) : null;
  const d = (l, v) => v == null || v === '' ? '' : `<div class="tx-dato"><span>${l}</span><b>${esc(v)}</b></div>`;
  return `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:6px 0 4px">
      <div style="width:96px;height:96px;border-radius:50%;overflow:hidden;flex:0 0 auto;background:var(--bg-hover)">${c.foto_url ? `<img src="${esc(c.foto_url)}" alt="${esc(c.nombre)}" style="width:100%;height:100%;object-fit:cover"/>` : `<div class="tx-av" style="font-size:38px">${esc((c.nombre || '?')[0].toUpperCase())}</div>`}</div>
      <div style="min-width:0;flex:1 1 200px">${c.telefono ? `<a class="tx-btn tx-btn-sm" href="tel:${esc(c.telefono)}">📞 ${esc(c.telefono)}</a> <a class="tx-btn tx-btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(whatsappNum(c.telefono))}">💬 WhatsApp</a>` : '<small style="color:var(--text-muted)">Sin teléfono registrado</small>'}</div>
    </div>
    <div class="tx-datos">
      ${d('Vínculo', VINCULOS[c.vinculo])}${d('Cédula / ID', c.cedula)}${d('Nacionalidad', c.nacionalidad)}${d('Correo', c.correo)}${d('Dirección', c.direccion)}
      ${c.rol === 'conductor' ? d('Tipo de licencia', c.licencia_tipo) : ''}
      ${c.rol === 'conductor' ? `<div class="tx-dato"><span>Licencia</span><b>${lic ? esc(fmtFecha(lic.vencimiento)) : 'Sin registrar'}</b>${le ? `<div style="margin-top:4px"><span class="tx-chip ${le.clase}">${esc(le.texto)}</span></div>` : ''}</div>` : ''}
      ${d('Contacto de emergencia', [c.contacto_emergencia_nombre, c.contacto_emergencia_telefono].filter(Boolean).join(' · '))}
    </div>
    ${c.notas ? `<div class="tx-dato" style="margin-bottom:10px"><span>Notas</span><b style="font-weight:500">${esc(c.notas)}</b></div>` : ''}
    <div class="tx-sec">Conexiones</div>
    <div class="tx-datos">
      <div class="tx-dato"><span>Unidad asignada</span><b>${unidad ? '🚛 ' + esc(unidad.nombre) + (unidad.placa ? ' · ' + esc(unidad.placa) : '') : 'Ninguna'}</b><a class="tx-btn tx-btn-sm" style="margin-top:6px" href="flota.html">Ir a Flota</a></div>
      <div class="tx-dato"><span>Ficha de empleado</span><b>${emp ? '🧑‍💼 ' + esc(emp.nombre) + (emp.cargo ? ' · ' + esc(emp.cargo) : '') : (c.vinculo === 'empleado' ? 'No vinculado' : 'Subcontratado')}</b>${c.vinculo === 'empleado' ? '<a class="tx-btn tx-btn-sm" style="margin-top:6px" href="salarios.html">Ir a Salarios</a>' : ''}</div>
    </div>
    <div class="tx-pie" style="justify-content:space-between"><button type="button" class="tx-btn tx-btn-borrar" data-cd-borrar="${esc(c.id)}">🗑 Eliminar</button></div>`;
}
function whatsappNum(t) { let n = String(t || '').replace(/\D/g, ''); if (n.length === 8) n = '505' + n; return n; }
function htmlCiclo(c) {
  return `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px">Marca si está listo para un viaje, en ruta o descansando. Más adelante se actualizará solo con los viajes.</div>
    ${TX.htmlCiclo(TX.ESTADOS_CONDUCTOR, c.estado)}
    <div class="tx-campo"><label for="cd-ciclo-nota">Nota del cambio (opcional)</label><input class="tx-in" id="cd-ciclo-nota" maxlength="150" placeholder="Ej: vacaciones hasta el lunes"/></div>
    <div class="tx-sec">Historial</div><div id="cd-historial"><div style="font-size:13px;color:var(--text-muted)">Cargando…</div></div>`;
}
async function cargarHistorialUI(c) {
  const el = document.getElementById('cd-historial'); if (!el) return;
  try { el.innerHTML = TX.htmlHistorial(await TX.cargarHistorial('conductor', c.id), TX.ESTADOS_CONDUCTOR); } catch (_) { el.textContent = 'No se pudo cargar el historial.'; }
}
async function cambiarEstado(nuevo) {
  const c = CD.lista.find(x => x.id === CD.detalleId); if (!c || c.estado === nuevo) return;
  try {
    await TX.cambiarEstado('conductor', c, nuevo, document.getElementById('cd-ciclo-nota')?.value.trim() || null);
    TX.toast(`${c.nombre}: ${TX.ESTADOS_CONDUCTOR[nuevo].t}`); renderTodo(); renderDetalle();
  } catch (e) { console.error(e); TX.toast('No se pudo cambiar el estado.', 'error'); }
}

/* ---------- formulario ---------- */
async function abrirForm(id) {
  const c = id ? CD.lista.find(x => x.id === id) : null;
  CD.editando = c || null;
  await Promise.all([cargarEmpleados(), cargarTodoUnidades()]);
  const set = (k, v) => { document.getElementById(k).value = v == null ? '' : v; };
  document.getElementById('fc-rol').innerHTML = Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v.ico} ${v.t}</option>`).join('');
  document.getElementById('fc-vinculo').innerHTML = Object.entries(VINCULOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  set('fc-nombre', c?.nombre); set('fc-rol', c?.rol || 'conductor'); set('fc-vinculo', c?.vinculo || 'empleado');
  set('fc-cedula', c?.cedula); set('fc-tel', c?.telefono); set('fc-correo', c?.correo); set('fc-nac', c?.nacionalidad || 'Nicaragüense'); set('fc-dir', c?.direccion);
  set('fc-em-nombre', c?.contacto_emergencia_nombre); set('fc-em-tel', c?.contacto_emergencia_telefono); set('fc-lic-tipo', c?.licencia_tipo); set('fc-notas', c?.notas);
  document.getElementById('fc-empleado').innerHTML = '<option value="">Sin vincular</option>' + CD.empleados.map(e => `<option value="${esc(e.id)}">${esc(e.nombre)}${e.cargo ? ' · ' + esc(e.cargo) : ''}</option>`).join('');
  set('fc-empleado', c?.empleado_id || '');
  document.getElementById('fc-unidad').innerHTML = '<option value="">Sin asignar</option>' + CD.unidades.filter(u => u.estado !== 'inactiva').map(u => `<option value="${esc(u.id)}">${esc(u.nombre)}${u.placa ? ' · ' + esc(u.placa) : ''}</option>`).join('');
  set('fc-unidad', c?.unidad_asignada_id || '');
  CD.fotoForm = c?.foto_url ? { url: c.foto_url, nuevo: false } : null;
  renderFotoForm(); actualizarForm();
  document.getElementById('fc-error').textContent = '';
  document.getElementById('cd-form-titulo').textContent = c ? 'Editar persona' : 'Nuevo conductor o ayudante';
  TX.cerrar('cd-modal-detalle'); TX.abrir('cd-modal-form');
}
async function cargarTodoUnidades() {
  try { const { data } = await sb.from('transporte_unidades').select('id,nombre,placa,tipo,rol,estado').eq('auth_user_id', TX.userId).order('nombre'); CD.unidades = data || []; } catch (_) {}
}
function actualizarForm() {
  const esEmp = document.getElementById('fc-vinculo').value === 'empleado';
  document.getElementById('fc-bloque-emp').style.display = esEmp ? '' : 'none';
  document.getElementById('fc-bloque-lic').style.display = document.getElementById('fc-rol').value === 'conductor' ? '' : 'none';
}
function renderFotoForm() {
  const cont = document.getElementById('fc-foto');
  const f = CD.fotoForm;
  cont.innerHTML = (f ? `<div class="tx-foto-mini" style="width:84px;height:84px;border-radius:50%"><img src="${esc(f.preview || f.url)}" alt="Foto"/><button type="button" data-cd-quitar-foto aria-label="Quitar foto">✕</button></div>` : '')
    + `<label class="tx-foto-add" style="height:84px">📷<span>${f ? 'Cambiar' : 'Agregar foto'}</span><input type="file" id="fc-foto-input" accept="image/*" style="display:none"/></label>`;
  document.getElementById('fc-foto-input').onchange = async ev => {
    const file = ev.target.files?.[0]; if (!file) return;
    if (!/^image\//.test(file.type)) { document.getElementById('fc-error').textContent = 'Solo se aceptan imágenes.'; return; }
    try { const blob = await TX.comprimirImagen(file, 600); CD.fotoForm = { blob, preview: URL.createObjectURL(blob), nuevo: true }; renderFotoForm(); }
    catch (_) { document.getElementById('fc-error').textContent = 'No se pudo leer la imagen.'; }
  };
}
function precargarDeEmpleado() {
  const e = CD.empleados.find(x => x.id === document.getElementById('fc-empleado').value); if (!e) return;
  const rel = (id, v) => { const el = document.getElementById(id); if (v && !el.value.trim()) el.value = v; };
  rel('fc-nombre', e.nombre); rel('fc-cedula', e.cedula); rel('fc-tel', e.telefono); rel('fc-correo', e.correo); rel('fc-dir', e.direccion);
  rel('fc-em-nombre', e.contacto_emergencia_nombre); rel('fc-em-tel', e.contacto_emergencia_telefono);
}

async function guardarForm() {
  const err = document.getElementById('fc-error'); err.textContent = '';
  const nombre = document.getElementById('fc-nombre').value.trim();
  if (!nombre) { err.textContent = 'Escribe el nombre completo.'; return; }
  const btn = document.getElementById('fc-guardar'); btn.disabled = true;
  let subida = null;
  try {
    let foto_url = CD.editando?.foto_url || null;
    if (CD.fotoForm?.nuevo) { const s = await TX.subirArchivo(CD.fotoForm.blob, 'conductores', 'webp', 'image/webp'); subida = s.path; foto_url = s.url; }
    else if (!CD.fotoForm) foto_url = null;
    const vinculo = document.getElementById('fc-vinculo').value, rol = document.getElementById('fc-rol').value;
    const fila = {
      nombre, rol, vinculo, empleado_id: vinculo === 'empleado' ? (document.getElementById('fc-empleado').value || null) : null,
      cedula: document.getElementById('fc-cedula').value.trim() || null, telefono: document.getElementById('fc-tel').value.trim() || null,
      correo: document.getElementById('fc-correo').value.trim() || null, nacionalidad: document.getElementById('fc-nac').value.trim() || null,
      direccion: document.getElementById('fc-dir').value.trim() || null,
      contacto_emergencia_nombre: document.getElementById('fc-em-nombre').value.trim() || null, contacto_emergencia_telefono: document.getElementById('fc-em-tel').value.trim() || null,
      licencia_tipo: rol === 'conductor' ? (document.getElementById('fc-lic-tipo').value.trim() || null) : null,
      unidad_asignada_id: document.getElementById('fc-unidad').value || null,
      notas: document.getElementById('fc-notas').value.trim() || null, foto_url, updated_at: new Date().toISOString(),
    };
    let error, id = CD.editando?.id;
    if (CD.editando) ({ error } = await sb.from('transporte_conductores').update(fila).eq('id', id).eq('auth_user_id', TX.userId));
    else { const { data, error: e2 } = await sb.from('transporte_conductores').insert({ ...fila, estado: 'disponible', auth_user_id: TX.userId }).select('id').single(); error = e2; id = data?.id; }
    if (error) throw error;
    if (CD.editando?.foto_url && CD.editando.foto_url !== foto_url) await TX.borrarArchivo(CD.editando.foto_url);
    const eraEdicion = !!CD.editando;
    TX.cerrar('cd-modal-form'); TX.toast(eraEdicion ? 'Datos actualizados' : 'Persona agregada');
    await cargarTodo(); renderTodo();
    abrirDetalle(id, eraEdicion ? 'resumen' : 'docs');
  } catch (e) {
    console.error('guardarForm:', e);
    if (subida) await TX.borrarArchivo(subida);
    err.textContent = 'No se pudo guardar: ' + (e.message || 'intenta de nuevo');
  } finally { btn.disabled = false; }
}

async function eliminar(id) {
  const c = CD.lista.find(x => x.id === id); if (!c) return;
  const ok = await TX.confirmar('¿Eliminar a esta persona?', `Se eliminará a ${c.nombre} con su foto, documentos e historial. Si ya no trabaja con ustedes, mejor márcala como Inactiva.`, 'Sí, eliminar', true);
  if (!ok) return;
  try {
    for (const d of (CD.docs[id] || [])) if (d.archivo_url) await TX.borrarArchivo(d.archivo_path || d.archivo_url);
    await sb.from('transporte_documentos').delete().eq('entidad_tipo', 'conductor').eq('entidad_id', id).eq('auth_user_id', TX.userId);
    await sb.from('transporte_estados_historial').delete().eq('entidad_tipo', 'conductor').eq('entidad_id', id).eq('auth_user_id', TX.userId);
    if (c.foto_url) await TX.borrarArchivo(c.foto_url);
    const { error } = await sb.from('transporte_conductores').delete().eq('id', id).eq('auth_user_id', TX.userId);
    if (error) throw error;
    TX.cerrar('cd-modal-detalle'); TX.toast('Persona eliminada'); await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo eliminar.', 'error'); }
}

/* ---------- eventos / inicio ---------- */
async function refrescarDocs() { CD.docs = TX.agruparDocs(await TX.cargarDocs('conductor')); renderTodo(); if (CD.detalleId) renderDetalle(); }
function enlazar() {
  const f = CD.filtro;
  document.getElementById('cd-buscar').addEventListener('input', e => { f.q = e.target.value; renderLista(); });
  document.getElementById('cd-f-estado').addEventListener('change', e => { f.estado = e.target.value; renderLista(); });
  document.getElementById('cd-f-rol').addEventListener('change', e => { f.rol = e.target.value; renderLista(); });
  document.getElementById('cd-f-vinculo').addEventListener('change', e => { f.vinculo = e.target.value; renderLista(); });
  document.getElementById('fc-vinculo').addEventListener('change', actualizarForm);
  document.getElementById('fc-rol').addEventListener('change', actualizarForm);
  document.getElementById('fc-empleado').addEventListener('change', precargarDeEmpleado);
  document.getElementById('fc-guardar').addEventListener('click', guardarForm);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-cd-abrir],[data-cd-nuevo],[data-cd-editar],[data-cd-borrar],[data-cd-tab],[data-cd-quitar-foto],[data-tx-doc-nuevo],[data-tx-doc-editar],[data-tx-doc-borrar],[data-tx-estado]');
    if (!t) return; const d = t.dataset;
    if (d.cdAbrir) { e.preventDefault(); abrirDetalle(d.cdAbrir, d.tab); }
    else if ('cdNuevo' in d) abrirForm(null);
    else if (d.cdEditar) abrirForm(d.cdEditar);
    else if (d.cdBorrar) eliminar(d.cdBorrar);
    else if (d.cdTab) { CD.detalleTab = d.cdTab; renderDetalle(); }
    else if ('cdQuitarFoto' in d) { CD.fotoForm = null; renderFotoForm(); }
    else if (d.txDocNuevo) TX.abrirDoc('conductor', d.txDocNuevo, null, refrescarDocs);
    else if (d.txDocEditar) { const doc = (CD.docs[CD.detalleId] || []).find(x => x.id === d.txDocEditar); if (doc) TX.abrirDoc('conductor', CD.detalleId, doc, refrescarDocs); }
    else if (d.txDocBorrar) { const doc = (CD.docs[CD.detalleId] || []).find(x => x.id === d.txDocBorrar); if (doc) TX.quitarDoc(doc, refrescarDocs); }
    else if (d.txEstado) cambiarEstado(d.txEstado);
  });
}
function iniciar() {
  document.getElementById('cd-f-estado').innerHTML = '<option value="">Todos los estados</option>' + Object.entries(TX.ESTADOS_CONDUCTOR).map(([k, v]) => `<option value="${k}">${v.ico} ${esc(v.t)}</option>`).join('');
  document.getElementById('cd-f-rol').innerHTML = '<option value="">Conductores y ayudantes</option>' + Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v.ico} ${v.t}</option>`).join('');
  document.getElementById('cd-f-vinculo').innerHTML = '<option value="">Empleados y subcontratados</option>' + Object.entries(VINCULOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
}
window.CD = CD;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => { iniciar(); enlazar(); await cargarTodo(); await cargarEmpleados(); renderTodo(); });
});
