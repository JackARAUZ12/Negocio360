/* ============================================================
   FLOTA.JS — NEGOCIO360 (Transporte · Fase 2)
   Unidades de carga (cabezales, camiones, furgones, plataformas…)
   con fotos, documentos con vencimiento, ciclo de estados e
   historial. Se conecta (solo lectura) con Activos fijos y
   Conductores. No modifica ningún otro módulo.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc, fmtFecha, num } = TX;

const FL = {
  unidades: [], docs: {}, activos: [], conductores: [],
  filtro: { q: '', estado: '', tipo: '', propiedad: '' },
  editando: null, fotosForm: [], detalleId: null, detalleTab: 'resumen', galeriaIdx: 0,
};
const PROPIEDADES = { propia: 'Propia', subcontratada: 'Subcontratada', arrendada: 'Arrendada' };
const COMBUSTIBLES = ['Diésel', 'Gasolina', 'Gas', 'Eléctrico', 'Híbrido'];
const MAX_FOTOS = 6;

/* ============================================================
   CARGA
   ============================================================ */
async function cargarTodo() {
  const [unidades, docs] = await Promise.all([
    TX.paginar(() => sb.from('transporte_unidades').select('*').eq('auth_user_id', TX.userId).order('created_at', { ascending: false })),
    TX.cargarDocs('unidad'),
  ]);
  FL.unidades = unidades; FL.docs = TX.agruparDocs(docs);
  try {
    const { data } = await sb.from('transporte_conductores').select('id,nombre,rol,unidad_asignada_id,estado').eq('auth_user_id', TX.userId);
    FL.conductores = data || [];
  } catch (_) { FL.conductores = []; }
}
async function cargarActivos() {
  try {
    const { data } = await sb.from('activos_fijos').select('id,nombre,placa,foto_url,estado,categoria,costo_adquisicion,fecha_adquisicion,numero')
      .eq('auth_user_id', TX.userId).neq('estado', 'baja').order('nombre');
    FL.activos = data || [];
  } catch (_) { FL.activos = []; }
}

/* ============================================================
   LISTA
   ============================================================ */
function filtradas() {
  const q = TX.quitarTildes(FL.filtro.q);
  return FL.unidades.filter(u => {
    if (FL.filtro.estado && u.estado !== FL.filtro.estado) return false;
    if (FL.filtro.tipo && u.tipo !== FL.filtro.tipo) return false;
    if (FL.filtro.propiedad && u.propiedad !== FL.filtro.propiedad) return false;
    if (q && !TX.quitarTildes([u.nombre, u.placa, u.marca, u.modelo, u.codigo].join(' ')).includes(q)) return false;
    return true;
  });
}
const portada = u => u.foto_url || (Array.isArray(u.fotos) && u.fotos[0]?.url) || null;

function renderKpis() {
  const c = est => FL.unidades.filter(u => u.estado === est).length;
  const todosDocs = Object.values(FL.docs).flat().filter(d => FL.unidades.some(u => u.id === d.entidad_id));
  const venc = todosDocs.filter(d => TX.estadoDoc(d.vencimiento).clave === 'vencido').length;
  const porv = todosDocs.filter(d => TX.estadoDoc(d.vencimiento).clave === 'por_vencer').length;
  document.getElementById('fl-kpis').innerHTML = `
    <div class="tx-kpi"><span>Unidades</span><b>${FL.unidades.length}</b><small>${FL.unidades.filter(u => u.rol === 'motriz').length} motrices · ${FL.unidades.filter(u => u.rol === 'arrastre').length} de arrastre</small></div>
    <div class="tx-kpi"><span>🟢 Disponibles</span><b>${c('disponible')}</b><small>listas para un viaje</small></div>
    <div class="tx-kpi"><span>🔵 En viaje</span><b>${c('en_viaje')}</b><small>en ruta</small></div>
    <div class="tx-kpi"><span>🟠 En taller</span><b>${c('taller')}</b><small>mantenimiento</small></div>
    <div class="tx-kpi ${venc ? 'alerta' : ''}"><span>⛔ Docs vencidos</span><b>${venc}</b><small>${venc ? 'requieren atención' : 'todo en orden'}</small></div>
    <div class="tx-kpi ${porv ? 'aviso' : ''}"><span>⚠️ Por vencer</span><b>${porv}</b><small>en ${TX.DIAS_AVISO} días</small></div>`;
}

function renderAvisos() {
  const el = document.getElementById('fl-avisos');
  const items = [];
  FL.unidades.forEach(u => (FL.docs[u.id] || []).forEach(d => {
    const e = TX.estadoDoc(d.vencimiento);
    if (e.clave === 'vencido' || e.clave === 'por_vencer') items.push({ u, d, e });
  }));
  items.sort((a, b) => a.e.dias - b.e.dias);
  if (!items.length) { el.innerHTML = ''; return; }
  const hayVenc = items.some(i => i.e.clave === 'vencido');
  el.innerHTML = `<div class="tx-aviso-banda ${hayVenc ? 'rojo' : ''}"><div style="font-size:22px">${hayVenc ? '⛔' : '⚠️'}</div><div>
    <b>${hayVenc ? 'Hay documentos vencidos' : 'Documentos por vencer'}</b>
    ${items.slice(0, 4).map(i => `<div><a href="#" data-fl-abrir="${esc(i.u.id)}" data-tab="docs" style="color:inherit;font-weight:700">${esc(i.u.nombre)}${i.u.placa ? ' (' + esc(i.u.placa) + ')' : ''}</a> · ${esc(TX.etiquetaDoc('unidad', i.d.tipo).t)} · ${esc(i.e.texto)}</div>`).join('')}
    ${items.length > 4 ? `<div style="color:var(--text-secondary)">…y ${items.length - 4} más</div>` : ''}</div></div>`;
}

function renderLista() {
  const cont = document.getElementById('fl-lista');
  const lista = filtradas();
  if (!lista.length) {
    cont.innerHTML = FL.unidades.length
      ? `<div class="tx-vacio"><div class="tx-vacio-i">🔎</div><b>No hay unidades con ese filtro</b><p>Prueba con otra búsqueda.</p></div>`
      : `<div class="tx-vacio"><div class="tx-vacio-i">🚛</div><b>Aún no has registrado tu flota</b><p>Agrega tus cabezales, camiones, furgones y plataformas, con fotos y documentos.</p>
         <button type="button" class="tx-btn tx-btn-primary" data-fl-nueva>＋ Agregar la primera unidad</button></div>`;
    return;
  }
  cont.innerHTML = `<div class="tx-grid">${lista.map(u => {
    const t = TX.TIPOS_UNIDAD[u.tipo] || TX.TIPOS_UNIDAD.otro, est = TX.ESTADOS_UNIDAD[u.estado] || TX.ESTADOS_UNIDAD.disponible;
    const salud = TX.saludDocs(FL.docs[u.id]), foto = portada(u);
    const nf = (Array.isArray(u.fotos) ? u.fotos.length : 0);
    return `<div class="tx-card" data-fl-abrir="${esc(u.id)}">
      <div class="tx-foto">${foto ? `<img src="${esc(foto)}" alt="${esc(u.nombre)}" loading="lazy"/>` : t.ico}
        <span class="tx-chip ${est.clase}">${est.ico} ${esc(est.t)}</span>${nf > 1 ? `<span class="tx-nfotos">📷 ${nf}</span>` : ''}</div>
      <div class="tx-card-body">
        <b>${esc(u.nombre)}</b>
        <div class="tx-fila-chips">${u.placa ? `<span class="tx-placa">${esc(u.placa)}</span>` : ''}<small>${esc(t.t)}</small></div>
        <small>${[u.marca, u.modelo, u.anio].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}${u.capacidad_ton ? ' · ' + esc(u.capacidad_ton) + ' t' : ''}</small>
        <div class="tx-fila-chips"><span class="tx-chip ${salud.clase}">${salud.clave === 'sin_docs' ? '📄' : salud.clave === 'vigente' ? '✅' : salud.clave === 'por_vencer' ? '⚠️' : '⛔'} ${esc(salud.texto)}</span>
          ${u.propiedad !== 'propia' ? `<span class="tx-chip">${esc(PROPIEDADES[u.propiedad])}</span>` : ''}</div>
      </div></div>`;
  }).join('')}</div>`;
}
function renderTodo() { renderKpis(); renderAvisos(); renderLista(); }

/* ============================================================
   DETALLE
   ============================================================ */
function abrirDetalle(id, tab) {
  const u = FL.unidades.find(x => x.id === id); if (!u) return;
  FL.detalleId = id; FL.detalleTab = tab || 'resumen'; FL.galeriaIdx = 0;
  renderDetalle(); TX.abrir('fl-modal-detalle');
}
function fotosDe(u) {
  const arr = Array.isArray(u.fotos) ? u.fotos.map(f => f.url).filter(Boolean) : [];
  if (!arr.length && u.foto_url) arr.push(u.foto_url);
  return arr;
}
function renderDetalle() {
  const u = FL.unidades.find(x => x.id === FL.detalleId); if (!u) { TX.cerrar('fl-modal-detalle'); return; }
  const t = TX.TIPOS_UNIDAD[u.tipo] || TX.TIPOS_UNIDAD.otro, est = TX.ESTADOS_UNIDAD[u.estado] || TX.ESTADOS_UNIDAD.disponible;
  const docs = FL.docs[u.id] || [], salud = TX.saludDocs(docs);
  const tabs = [['resumen', 'Resumen'], ['docs', `Documentos (${docs.length})`], ['ciclo', 'Ciclo y estados']];
  document.getElementById('fl-detalle-cuerpo').innerHTML = `
    <div class="tx-fila-chips" style="justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div style="min-width:0"><h3 style="margin:0">${t.ico} ${esc(u.nombre)}</h3>
        <div class="tx-fila-chips" style="margin-top:6px">${u.placa ? `<span class="tx-placa">${esc(u.placa)}</span>` : ''}<span class="tx-chip ${est.clase}">${est.ico} ${esc(est.t)}</span><span class="tx-chip ${salud.clase}">${esc(salud.texto)}</span>${u.codigo ? `<span class="tx-chip">${esc(u.codigo)}</span>` : ''}</div></div>
      <div class="tx-fila-chips"><button type="button" class="tx-btn tx-btn-sm" data-fl-editar="${esc(u.id)}">✏️ Editar</button><button type="button" class="tx-btn tx-btn-sm" onclick="TXcerrar('fl-modal-detalle')">Cerrar</button></div>
    </div>
    <div class="tx-tabs">${tabs.map(([k, l]) => `<button type="button" class="tx-tab ${FL.detalleTab === k ? 'on' : ''}" data-fl-tab="${k}">${l}</button>`).join('')}</div>
    <div class="tx-panel ${FL.detalleTab === 'resumen' ? 'on' : ''}">${htmlResumen(u)}</div>
    <div class="tx-panel ${FL.detalleTab === 'docs' ? 'on' : ''}">${TX.htmlDocs('unidad', u.id, docs)}</div>
    <div class="tx-panel ${FL.detalleTab === 'ciclo' ? 'on' : ''}" id="fl-panel-ciclo">${htmlCicloBase(u)}</div>`;
  if (FL.detalleTab === 'ciclo') cargarHistorialUI(u);
}

function htmlResumen(u) {
  const t = TX.TIPOS_UNIDAD[u.tipo] || TX.TIPOS_UNIDAD.otro, fotos = fotosDe(u);
  const idx = Math.min(FL.galeriaIdx, Math.max(0, fotos.length - 1));
  const activo = u.activo_id ? FL.activos.find(a => a.id === u.activo_id) : null;
  const conds = FL.conductores.filter(c => c.unidad_asignada_id === u.id);
  const d = (l, v) => v == null || v === '' ? '' : `<div class="tx-dato"><span>${l}</span><b>${esc(v)}</b></div>`;
  return `
    <div class="tx-galeria">${fotos.length ? `<img src="${esc(fotos[idx])}" alt="Foto ${idx + 1}"/>${fotos.length > 1 ? `<button type="button" class="ant" data-fl-galeria="-1" aria-label="Anterior">‹</button><button type="button" class="sig" data-fl-galeria="1" aria-label="Siguiente">›</button>` : ''}` : t.ico}</div>
    ${fotos.length > 1 ? `<div class="tx-miniaturas">${fotos.map((f, i) => `<img src="${esc(f)}" class="${i === idx ? 'on' : ''}" data-fl-foto="${i}" alt="Miniatura ${i + 1}"/>`).join('')}</div>` : ''}
    <div class="tx-datos">
      ${d('Tipo', t.t)}${d('Función', u.rol === 'motriz' ? 'Motriz (jala o se maneja)' : 'Arrastre (se acopla)')}${d('Marca', u.marca)}${d('Modelo', u.modelo)}${d('Año', u.anio)}${d('Color', u.color)}
      ${d('Ejes', u.ejes)}${d('Capacidad', u.capacidad_ton != null ? u.capacidad_ton + ' toneladas' : '')}${d('Volumen', u.capacidad_m3 != null ? u.capacidad_m3 + ' m³' : '')}
      ${d('Combustible', u.combustible)}${d('Kilometraje', u.odometro_km != null ? Number(u.odometro_km).toLocaleString('es-NI') + ' km' : '')}
      ${d('VIN / Chasis', u.vin)}${d('N° de motor', u.numero_motor)}${d('Propiedad', PROPIEDADES[u.propiedad])}
      ${u.propiedad !== 'propia' ? d('Dueño / transportista', u.propietario_nombre) + d('Teléfono del dueño', u.propietario_telefono) : ''}
    </div>
    ${u.notas ? `<div class="tx-dato" style="margin-bottom:10px"><span>Notas</span><b style="font-weight:500">${esc(u.notas)}</b></div>` : ''}
    <div class="tx-sec">Conexiones</div>
    <div class="tx-datos">
      <div class="tx-dato"><span>Activo fijo</span><b>${activo ? '🏭 ' + esc(activo.nombre) + (activo.placa ? ' (' + esc(activo.placa) + ')' : '') : 'No vinculado'}</b>
        ${activo ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">Costo ${esc(TX.fmtMoneda(activo.costo_adquisicion))} · adquirido ${esc(fmtFecha(activo.fecha_adquisicion))}</div><a class="tx-btn tx-btn-sm" style="margin-top:6px" href="activos.html">Ver en Activos fijos</a>` : ''}</div>
      <div class="tx-dato"><span>Conductor asignado</span><b>${conds.length ? conds.map(c => '🧑‍✈️ ' + esc(c.nombre)).join('<br>') : 'Ninguno'}</b>
        <a class="tx-btn tx-btn-sm" style="margin-top:6px" href="conductores.html">Ir a Conductores</a></div>
    </div>
    <div class="tx-pie" style="justify-content:space-between"><button type="button" class="tx-btn tx-btn-borrar" data-fl-borrar="${esc(u.id)}">🗑 Eliminar unidad</button></div>`;
}

function htmlCicloBase(u) {
  return `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px">El estado cambia con el ciclo de la unidad. Más adelante se actualizará solo con los viajes y el mantenimiento.</div>
    ${TX.htmlCiclo(TX.ESTADOS_UNIDAD, u.estado)}
    <div class="tx-campo"><label for="fl-ciclo-nota">Nota del cambio (opcional)</label><input class="tx-in" id="fl-ciclo-nota" maxlength="150" placeholder="Ej: cambio de aceite y frenos"/></div>
    <div class="tx-sec">Historial</div><div id="fl-historial"><div style="font-size:13px;color:var(--text-muted)">Cargando…</div></div>`;
}
async function cargarHistorialUI(u) {
  const el = document.getElementById('fl-historial'); if (!el) return;
  try { el.innerHTML = TX.htmlHistorial(await TX.cargarHistorial('unidad', u.id), TX.ESTADOS_UNIDAD); }
  catch (_) { el.textContent = 'No se pudo cargar el historial.'; }
}
async function cambiarEstadoUnidad(nuevo) {
  const u = FL.unidades.find(x => x.id === FL.detalleId); if (!u || u.estado === nuevo) return;
  const nota = document.getElementById('fl-ciclo-nota')?.value.trim() || null;
  try {
    await TX.cambiarEstado('unidad', u, nuevo, nota);
    TX.toast(`${u.nombre}: ${TX.ESTADOS_UNIDAD[nuevo].t}`);
    renderTodo(); renderDetalle();
  } catch (e) { console.error(e); TX.toast('No se pudo cambiar el estado.', 'error'); }
}

/* ============================================================
   FORMULARIO (crear / editar)
   ============================================================ */
function opcionesTipo() { return Object.entries(TX.TIPOS_UNIDAD).map(([k, v]) => `<option value="${k}">${v.ico} ${esc(v.t)}</option>`).join(''); }

async function abrirForm(id) {
  const u = id ? FL.unidades.find(x => x.id === id) : null;
  FL.editando = u || null;
  await cargarActivos();
  const set = (k, v) => { document.getElementById(k).value = v == null ? '' : v; };
  document.getElementById('fu-tipo').innerHTML = opcionesTipo();
  document.getElementById('fu-comb').innerHTML = '<option value="">—</option>' + COMBUSTIBLES.map(c => `<option>${c}</option>`).join('');
  set('fu-nombre', u?.nombre); set('fu-tipo', u?.tipo || 'cabezal'); set('fu-placa', u?.placa); set('fu-marca', u?.marca); set('fu-modelo', u?.modelo);
  set('fu-anio', u?.anio); set('fu-color', u?.color); set('fu-vin', u?.vin); set('fu-motor', u?.numero_motor); set('fu-ejes', u?.ejes);
  set('fu-ton', u?.capacidad_ton); set('fu-m3', u?.capacidad_m3); set('fu-comb', u?.combustible || ''); set('fu-odo', u?.odometro_km);
  set('fu-propiedad', u?.propiedad || 'propia'); set('fu-prop-nombre', u?.propietario_nombre); set('fu-prop-tel', u?.propietario_telefono); set('fu-notas', u?.notas);
  renderSelectActivos(u?.activo_id || '');
  actualizarPropiedad();
  FL.fotosForm = u ? fotosDe(u).map(url => ({ url, nuevo: false })) : [];
  renderFotosForm();
  document.getElementById('fu-error').textContent = '';
  document.getElementById('fl-form-titulo').textContent = u ? 'Editar unidad' : 'Nueva unidad';
  TX.cerrar('fl-modal-detalle');
  TX.abrir('fl-modal-form');
}
function renderSelectActivos(sel) {
  const s = document.getElementById('fu-activo');
  s.innerHTML = '<option value="">Sin vincular</option>' + FL.activos.map(a => `<option value="${esc(a.id)}">${esc(a.nombre)}${a.placa ? ' · ' + esc(a.placa) : ''} (${esc(a.categoria || 'activo')})</option>`).join('');
  s.value = sel || '';
}
function actualizarPropiedad() {
  document.getElementById('fu-bloque-dueno').style.display = document.getElementById('fu-propiedad').value === 'propia' ? 'none' : '';
}
function renderFotosForm() {
  const cont = document.getElementById('fu-fotos');
  cont.innerHTML = FL.fotosForm.map((f, i) => `<div class="tx-foto-mini"><img src="${esc(f.preview || f.url)}" alt="Foto ${i + 1}" data-fl-portada="${i}" title="Tocar para usar como portada"/>
      ${i === 0 ? '<span class="tx-portada">Portada</span>' : ''}<button type="button" data-fl-quitar-foto="${i}" aria-label="Quitar foto">✕</button></div>`).join('')
    + (FL.fotosForm.length < MAX_FOTOS ? `<label class="tx-foto-add">📷<span>Agregar</span><input type="file" id="fu-foto-input" accept="image/*" multiple style="display:none"/></label>` : '');
  const inp = document.getElementById('fu-foto-input');
  if (inp) inp.onchange = async () => {
    const err = document.getElementById('fu-error'); err.textContent = '';
    for (const file of [...inp.files]) {
      if (FL.fotosForm.length >= MAX_FOTOS) break;
      if (!/^image\//.test(file.type)) { err.textContent = 'Solo se aceptan imágenes.'; continue; }
      try { const blob = await TX.comprimirImagen(file); FL.fotosForm.push({ blob, preview: URL.createObjectURL(blob), nuevo: true }); }
      catch (e) { err.textContent = 'No se pudo leer una de las imágenes.'; }
    }
    renderFotosForm();
  };
}

async function guardarForm() {
  const err = document.getElementById('fu-error'); err.textContent = '';
  const nombre = document.getElementById('fu-nombre').value.trim();
  if (!nombre) { err.textContent = 'Ponle un nombre a la unidad (ej: Cabezal 01 o Volvo FH).'; return; }
  const anio = num(document.getElementById('fu-anio').value);
  if (anio != null && (anio < 1950 || anio > new Date().getFullYear() + 1)) { err.textContent = 'Revisa el año de la unidad.'; return; }
  const nums = { ejes: num(document.getElementById('fu-ejes').value), capacidad_ton: num(document.getElementById('fu-ton').value), capacidad_m3: num(document.getElementById('fu-m3').value), odometro_km: num(document.getElementById('fu-odo').value) };
  if (Object.values(nums).some(v => v != null && v < 0)) { err.textContent = 'Los números no pueden ser negativos.'; return; }
  const tipo = document.getElementById('fu-tipo').value;
  const btn = document.getElementById('fu-guardar'); btn.disabled = true;
  const subidas = [];
  try {
    // Fotos: subir las nuevas (en orden), conservar las existentes
    const finales = [];
    for (const f of FL.fotosForm) {
      if (f.nuevo) { const blobFile = f.blob; const s = await TX.subirArchivo(blobFile, 'unidades', 'webp', 'image/webp'); subidas.push(s.path); finales.push({ url: s.url, path: s.path }); }
      else finales.push({ url: f.url, path: TX.rutaDeUrl(f.url) });
    }
    const fila = {
      nombre, tipo, rol: (TX.TIPOS_UNIDAD[tipo] || TX.TIPOS_UNIDAD.otro).rol,
      placa: (document.getElementById('fu-placa').value.trim().toUpperCase()) || null,
      marca: document.getElementById('fu-marca').value.trim() || null, modelo: document.getElementById('fu-modelo').value.trim() || null,
      anio: anio != null ? Math.round(anio) : null, color: document.getElementById('fu-color').value.trim() || null,
      vin: document.getElementById('fu-vin').value.trim() || null, numero_motor: document.getElementById('fu-motor').value.trim() || null,
      ejes: nums.ejes != null ? Math.round(nums.ejes) : null, capacidad_ton: nums.capacidad_ton, capacidad_m3: nums.capacidad_m3,
      combustible: document.getElementById('fu-comb').value || null, odometro_km: nums.odometro_km,
      propiedad: document.getElementById('fu-propiedad').value,
      propietario_nombre: document.getElementById('fu-prop-nombre').value.trim() || null, propietario_telefono: document.getElementById('fu-prop-tel').value.trim() || null,
      activo_id: document.getElementById('fu-activo').value || null,
      notas: document.getElementById('fu-notas').value.trim() || null,
      fotos: finales, foto_url: finales[0]?.url || null, updated_at: new Date().toISOString(),
    };
    if (fila.propiedad === 'propia') { fila.propietario_nombre = null; fila.propietario_telefono = null; }
    let error, id = FL.editando?.id;
    if (FL.editando) {
      ({ error } = await sb.from('transporte_unidades').update(fila).eq('id', id).eq('auth_user_id', TX.userId));
    } else {
      const maxN = FL.unidades.reduce((m, u) => Math.max(m, Number(String(u.codigo || '').replace(/\D/g, '')) || 0), 0);
      const { data, error: e2 } = await sb.from('transporte_unidades').insert({ ...fila, estado: 'disponible', auth_user_id: TX.userId, codigo: 'U-' + String(maxN + 1).padStart(3, '0') }).select('id').single();
      error = e2; id = data?.id;
    }
    if (error) throw error;
    // Borrar del almacenamiento las fotos que se quitaron
    if (FL.editando) {
      const quedan = new Set(finales.map(f => f.url));
      for (const url of fotosDe(FL.editando)) if (!quedan.has(url)) await TX.borrarArchivo(url);
    }
    TX.cerrar('fl-modal-form');
    TX.toast(FL.editando ? 'Unidad actualizada' : 'Unidad agregada a tu flota');
    await cargarTodo(); renderTodo();
    abrirDetalle(id, FL.editando ? 'resumen' : 'docs');
  } catch (e) {
    console.error('guardarForm:', e);
    for (const p of subidas) await TX.borrarArchivo(p);
    err.textContent = 'No se pudo guardar: ' + (e.message || 'intenta de nuevo');
  } finally { btn.disabled = false; }
}

async function eliminarUnidad(id) {
  const u = FL.unidades.find(x => x.id === id); if (!u) return;
  const ok = await TX.confirmar('¿Eliminar esta unidad?', `Se eliminará ${u.nombre}${u.placa ? ' (' + u.placa + ')' : ''} con sus fotos, documentos e historial. Si solo quieres sacarla de operación, mejor márcala como Inactiva.`, 'Sí, eliminar', true);
  if (!ok) return;
  try {
    for (const d of (FL.docs[id] || [])) if (d.archivo_url) await TX.borrarArchivo(d.archivo_path || d.archivo_url);
    await sb.from('transporte_documentos').delete().eq('entidad_tipo', 'unidad').eq('entidad_id', id).eq('auth_user_id', TX.userId);
    await sb.from('transporte_estados_historial').delete().eq('entidad_tipo', 'unidad').eq('entidad_id', id).eq('auth_user_id', TX.userId);
    await sb.from('transporte_conductores').update({ unidad_asignada_id: null }).eq('unidad_asignada_id', id).eq('auth_user_id', TX.userId);
    for (const url of fotosDe(u)) await TX.borrarArchivo(url);
    const { error } = await sb.from('transporte_unidades').delete().eq('id', id).eq('auth_user_id', TX.userId);
    if (error) throw error;
    TX.cerrar('fl-modal-detalle'); TX.toast('Unidad eliminada');
    await cargarTodo(); renderTodo();
  } catch (e) { console.error(e); TX.toast('No se pudo eliminar la unidad.', 'error'); }
}

/* ============================================================
   EVENTOS E INICIO
   ============================================================ */
function enlazar() {
  const f = FL.filtro;
  document.getElementById('fl-buscar').addEventListener('input', e => { f.q = e.target.value; renderLista(); });
  document.getElementById('fl-f-estado').addEventListener('change', e => { f.estado = e.target.value; renderLista(); });
  document.getElementById('fl-f-tipo').addEventListener('change', e => { f.tipo = e.target.value; renderLista(); });
  document.getElementById('fl-f-prop').addEventListener('change', e => { f.propiedad = e.target.value; renderLista(); });
  document.getElementById('fu-propiedad').addEventListener('change', actualizarPropiedad);
  document.getElementById('fu-activo').addEventListener('change', e => {
    const a = FL.activos.find(x => x.id === e.target.value);
    if (a && a.placa && !document.getElementById('fu-placa').value.trim()) document.getElementById('fu-placa').value = a.placa;
    if (a && !document.getElementById('fu-nombre').value.trim()) document.getElementById('fu-nombre').value = a.nombre;
  });
  document.getElementById('fu-activo-refrescar').addEventListener('click', async () => { const v = document.getElementById('fu-activo').value; await cargarActivos(); renderSelectActivos(v); TX.toast('Lista de activos actualizada'); });
  document.getElementById('fu-guardar').addEventListener('click', guardarForm);

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-fl-abrir],[data-fl-nueva],[data-fl-editar],[data-fl-borrar],[data-fl-tab],[data-fl-galeria],[data-fl-foto],[data-fl-portada],[data-fl-quitar-foto],[data-tx-doc-nuevo],[data-tx-doc-editar],[data-tx-doc-borrar],[data-tx-estado]');
    if (!t) return;
    const d = t.dataset;
    if (d.flAbrir) { e.preventDefault(); abrirDetalle(d.flAbrir, d.tab); }
    else if ('flNueva' in d) abrirForm(null);
    else if (d.flEditar) abrirForm(d.flEditar);
    else if (d.flBorrar) eliminarUnidad(d.flBorrar);
    else if (d.flTab) { FL.detalleTab = d.flTab; renderDetalle(); }
    else if (d.flGaleria) { const u = FL.unidades.find(x => x.id === FL.detalleId); const n = fotosDe(u).length; FL.galeriaIdx = (FL.galeriaIdx + Number(d.flGaleria) + n) % n; renderDetalle(); }
    else if (d.flFoto != null) { FL.galeriaIdx = Number(d.flFoto); renderDetalle(); }
    else if (d.flPortada != null) { const i = Number(d.flPortada); if (i > 0) { const [x] = FL.fotosForm.splice(i, 1); FL.fotosForm.unshift(x); renderFotosForm(); } }
    else if (d.flQuitarFoto != null) { const [x] = FL.fotosForm.splice(Number(d.flQuitarFoto), 1); if (x?.preview) URL.revokeObjectURL(x.preview); renderFotosForm(); }
    else if (d.txDocNuevo) TX.abrirDoc('unidad', d.txDocNuevo, null, refrescarDocs);
    else if (d.txDocEditar) { const doc = (FL.docs[FL.detalleId] || []).find(x => x.id === d.txDocEditar); if (doc) TX.abrirDoc('unidad', FL.detalleId, doc, refrescarDocs); }
    else if (d.txDocBorrar) { const doc = (FL.docs[FL.detalleId] || []).find(x => x.id === d.txDocBorrar); if (doc) TX.quitarDoc(doc, refrescarDocs); }
    else if (d.txEstado) cambiarEstadoUnidad(d.txEstado);
  });
}
async function refrescarDocs() {
  const docs = await TX.cargarDocs('unidad'); FL.docs = TX.agruparDocs(docs);
  renderTodo(); if (FL.detalleId) renderDetalle();
}

function iniciar() {
  document.getElementById('fl-f-tipo').innerHTML = '<option value="">Todos los tipos</option>' + Object.entries(TX.TIPOS_UNIDAD).map(([k, v]) => `<option value="${k}">${v.ico} ${esc(v.t)}</option>`).join('');
  document.getElementById('fl-f-estado').innerHTML = '<option value="">Todos los estados</option>' + Object.entries(TX.ESTADOS_UNIDAD).map(([k, v]) => `<option value="${k}">${v.ico} ${esc(v.t)}</option>`).join('');
  document.getElementById('fl-f-prop').innerHTML = '<option value="">Toda propiedad</option>' + Object.entries(PROPIEDADES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  document.getElementById('fu-propiedad').innerHTML = Object.entries(PROPIEDADES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
}

window.FL = FL;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => {
    iniciar(); enlazar();
    await cargarTodo(); renderTodo();
    cargarActivos();
  });
});
