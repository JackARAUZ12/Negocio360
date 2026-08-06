/* =====================================================
   RUTAS.JS — NEGOCIO360 — FASE 1
   Rutas de Cobro y Venta en Ruta, sobre mapa (Leaflet + OpenStreetMap,
   sin ningún costo). Nunca duplica la lógica de Créditos/Ventas: al
   registrar un cobro o una venta desde una parada, abre la MISMA
   pantalla de siempre — cero riesgo de que los números se desincronicen.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  clientes: [], clientesCobro: [], rutas: [],
  mapaGeneral: null, mapaNuevaRuta: null, mapaVerRuta: null,
  clienteSeleccionadoParaUbicar: null,
  seleccionRuta: new Map(), // id (cliente o cuota) -> objeto elegido
  ordenCalculado: null,
  tipoRutaActual: 'preventa',
};

let CAMPO = { ruta: null, paradas: [], indice: 0 };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function nombreCompleto(c) { return `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Cliente'; }
function fmt(amount) {
  const sym = STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$';
  return `${sym} ${Number(amount||0).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

/* =====================================================
   SHELL: TEMA, SIDEBAR, NAVEGACIÓN
===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('n360_theme', theme);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}
function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme');
  applyTheme(curr === 'dark' ? 'light' : 'dark');
}
function isMobileViewport() { return window.innerWidth <= 860; }
function toggleSidebar() {
  if (isMobileViewport()) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
  } else {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('main').classList.toggle('sidebar-collapsed');
  }
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}
function navigate(url) { closeMobileSidebar(); window.location.href = url; }

/* =====================================================
   DISTANCIA Y ORDEN POR CERCANÍA (Haversine)
===================================================== */
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function ordenarPorCercania(paradas) {
  if (paradas.length <= 1) return paradas.slice();
  const restantes = paradas.slice();
  const ordenado = [restantes.shift()];
  while (restantes.length) {
    const actual = ordenado[ordenado.length - 1];
    let idxMasCercano = 0, distMin = Infinity;
    restantes.forEach((c, i) => {
      const d = distanciaKm(actual.latitud, actual.longitud, c.latitud, c.longitud);
      if (d < distMin) { distMin = d; idxMasCercano = i; }
    });
    ordenado.push(restantes.splice(idxMasCercano, 1)[0]);
  }
  return ordenado;
}

/* =====================================================
   CARGA DE DATOS
===================================================== */
async function cargarClientes() {
  try {
    const { data } = await sb.from('clientes').select('id,nombre,apellido,telefono,direccion,latitud,longitud')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.clientes = data || [];
  } catch (e) { console.warn('cargarClientes:', e); STATE.clientes = []; }
}

async function cargarClientesCobro() {
  try {
    const { data, error } = await sb.rpc('clientes_con_cobro_pendiente');
    if (error) throw error;
    STATE.clientesCobro = data || [];
  } catch (e) { console.warn('cargarClientesCobro:', e); STATE.clientesCobro = []; }
}

async function cargarRutas() {
  try {
    const { data } = await sb.from('rutas').select('*, ruta_clientes(id, estado_parada)')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending: false });
    STATE.rutas = data || [];
    renderRutas();
  } catch (e) { console.warn('cargarRutas:', e); }
}

const TIPO_LABEL = { cobro: '💰 Cobro', preventa: '🛒 Venta en ruta', reparto: '📦 Reparto', reabastecimiento: '🏬 Reabastecimiento', reactivacion: '🔁 Reactivación', visita: '📋 Visita' };
const ESTADO_LABEL = { planificada: 'Planificada', en_progreso: 'En progreso', completada: 'Completada' };
const ESTADO_BADGE = { planificada: 'badge-pendiente', en_progreso: 'badge-activo', completada: 'badge-inactivo' };
const DIAS_LABEL = { lunes:'Lunes',martes:'Martes',miercoles:'Miércoles',jueves:'Jueves',viernes:'Viernes',sabado:'Sábado',domingo:'Domingo' };

function renderRutas() {
  const tbody = document.getElementById('rutas-tbody');
  if (!tbody) return;
  if (!STATE.rutas.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Todavía no has creado ninguna ruta</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.rutas.map(r => {
    const paradas = r.ruta_clientes || [];
    const completadas = paradas.filter(p => p.estado_parada === 'completada').length;
    return `
    <tr>
      <td style="font-weight:600">${esc(r.nombre)}</td>
      <td>${TIPO_LABEL[r.tipo] || r.tipo}</td>
      <td>${r.dia_semana ? DIAS_LABEL[r.dia_semana] : '—'}</td>
      <td>${completadas}/${paradas.length}</td>
      <td><span class="status-badge ${ESTADO_BADGE[r.estado]||''}">${ESTADO_LABEL[r.estado]||r.estado}</span></td>
      <td class="td-actions">
        <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn-secondary" style="padding:6px 12px;font-size:12px" onclick="verRuta('${r.id}')">Ver ruta</button>
          <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="eliminarRuta('${r.id}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* =====================================================
   MAPA GENERAL
===================================================== */
function cargarMapaGeneral() {
  const el = document.getElementById('mapa-general');
  if (!el || STATE.mapaGeneral) return;
  const conUbicacion = STATE.clientes.filter(c => c.latitud != null && c.longitud != null);
  const centro = conUbicacion.length ? [conUbicacion[0].latitud, conUbicacion[0].longitud] : [12.1364, -86.2514];

  STATE.mapaGeneral = L.map(el).setView(centro, conUbicacion.length ? 12 : 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
  }).addTo(STATE.mapaGeneral);

  conUbicacion.forEach(c => {
    L.marker([c.latitud, c.longitud]).addTo(STATE.mapaGeneral)
      .bindPopup(`<strong>${esc(nombreCompleto(c))}</strong><br>${esc(c.direccion||'')}<br>${esc(c.telefono||'')}`);
  });
}

/* =====================================================
   NUEVA RUTA — Paso 0: elegir tipo
===================================================== */
function abrirNuevaRuta() {
  openModal('modal-tipo-ruta');
}

async function seleccionarTipoRuta(tipo) {
  closeModal('modal-tipo-ruta');
  STATE.tipoRutaActual = tipo;
  STATE.seleccionRuta = new Map();
  STATE.ordenCalculado = null;
  STATE.clienteSeleccionadoParaUbicar = null;

  document.getElementById('nr-titulo').textContent = tipo === 'cobro' ? 'Nueva ruta de Cobro' : 'Nueva ruta — Venta en Ruta';
  document.getElementById('nr-lista-titulo').textContent = tipo === 'cobro'
    ? 'Clientes con cuotas vencidas o por vencer (7 días)'
    : 'Elige los clientes de esta ruta';
  document.getElementById('nr-nombre').value = '';
  document.getElementById('nr-dia').value = '';
  document.getElementById('nr-buscar-cliente').value = '';
  document.getElementById('nr-orden-preview').style.display = 'none';

  if (tipo === 'cobro') await cargarClientesCobro();
  renderListaClientesRuta();
  openModal('modal-nueva-ruta');

  setTimeout(() => {
    if (!STATE.mapaNuevaRuta) {
      STATE.mapaNuevaRuta = L.map('mapa-nueva-ruta').setView([12.1364, -86.2514], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(STATE.mapaNuevaRuta);
      STATE.mapaNuevaRuta.on('click', onClickMapaNuevaRuta);
    } else {
      STATE.mapaNuevaRuta.invalidateSize();
    }
    dibujarMarcadoresNuevaRuta();
  }, 150);
}

function renderListaClientesRuta() {
  const cont = document.getElementById('nr-lista-clientes');
  const q = (document.getElementById('nr-buscar-cliente')?.value || '').toLowerCase().trim();

  if (STATE.tipoRutaActual === 'cobro') {
    const lista = STATE.clientesCobro.filter(c => !q || (c.cliente_nombre||'').toLowerCase().includes(q));
    if (!lista.length) { cont.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:12.5px">No hay cuotas vencidas ni próximas a vencer en los próximos 7 días 🎉</div>'; return; }
    cont.innerHTML = lista.map(c => {
      const key = c.cuota_id;
      const marcado = STATE.seleccionRuta.has(key);
      const tieneUbicacion = c.latitud != null;
      const atraso = c.dias_atraso > 0 ? `<span style="color:var(--danger);font-size:11px;font-weight:700">${c.dias_atraso}d atraso</span>` : `<span style="color:var(--text-muted);font-size:11px">vence ${fmtFecha(c.fecha_vencimiento)}</span>`;
      return `
      <label style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px">
        <input type="checkbox" ${marcado?'checked':''} onchange="toggleClienteRuta('${key}', this.checked, ${JSON.stringify(c).replace(/"/g,'&quot;')})"/>
        <span style="flex:1">
          <div>${esc(c.cliente_nombre)} ${!tieneUbicacion ? '<span style="font-size:10.5px;color:var(--warning)">sin ubicación</span>' : ''}</div>
          <div style="font-size:11px;color:var(--text-muted)">Cuota #${c.numero_cuota} · ${fmt(c.saldo_cuota)} · ${atraso}</div>
        </span>
        ${!tieneUbicacion ? `<button type="button" class="btn-secondary" style="padding:3px 8px;font-size:10.5px" onclick="event.preventDefault();seleccionarParaUbicarCobro('${c.cliente_id}')">Marcar en mapa</button>` : ''}
      </label>`;
    }).join('');
    return;
  }

  // Preventa: lista normal de clientes
  const lista = STATE.clientes.filter(c => !q || nombreCompleto(c).toLowerCase().includes(q));
  if (!lista.length) { cont.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:12.5px">Sin resultados</div>'; return; }
  cont.innerHTML = lista.map(c => {
    const tieneUbicacion = c.latitud != null && c.longitud != null;
    const marcado = STATE.seleccionRuta.has(c.id);
    return `
    <label style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;${STATE.clienteSeleccionadoParaUbicar===c.id?'background:var(--accent-soft)':''}">
      <input type="checkbox" ${marcado?'checked':''} onchange="toggleClienteRuta('${c.id}', this.checked, ${JSON.stringify(c).replace(/"/g,'&quot;')})"/>
      <span style="flex:1">${esc(nombreCompleto(c))}</span>
      ${tieneUbicacion
        ? '<span style="font-size:11px;color:var(--success)">📍 ubicado</span>'
        : `<button type="button" class="btn-secondary" style="padding:3px 8px;font-size:10.5px" onclick="event.preventDefault();seleccionarParaUbicar('${c.id}')">Marcar en mapa</button>`}
    </label>`;
  }).join('');
}

function filtrarClientesRuta() { renderListaClientesRuta(); }

function toggleClienteRuta(key, marcado, datos) {
  if (marcado) STATE.seleccionRuta.set(key, datos); else STATE.seleccionRuta.delete(key);
  document.getElementById('nr-orden-preview').style.display = 'none';
  dibujarMarcadoresNuevaRuta();
}

function seleccionarParaUbicar(id) {
  STATE.clienteSeleccionadoParaUbicar = id;
  const c = STATE.clientes.find(x => x.id === id);
  document.getElementById('nr-mapa-hint').innerHTML = `📍 Haz clic en el mapa para marcar la ubicación de <strong>${esc(nombreCompleto(c))}</strong>`;
  renderListaClientesRuta();
}
function seleccionarParaUbicarCobro(clienteId) {
  STATE.clienteSeleccionadoParaUbicar = clienteId;
  document.getElementById('nr-mapa-hint').textContent = '📍 Haz clic en el mapa para marcar la ubicación de este cliente';
}

async function onClickMapaNuevaRuta(e) {
  const id = STATE.clienteSeleccionadoParaUbicar;
  if (!id) { showToast('Primero elige "Marcar en mapa" junto al cliente que quieres ubicar', 'error'); return; }
  const { lat, lng } = e.latlng;
  try {
    const { error } = await sb.from('clientes').update({ latitud: lat, longitud: lng })
      .eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    const c = STATE.clientes.find(x => x.id === id);
    if (c) { c.latitud = lat; c.longitud = lng; }
    const cCobro = STATE.clientesCobro.find(x => x.cliente_id === id);
    if (cCobro) { cCobro.latitud = lat; cCobro.longitud = lng; }
    STATE.clienteSeleccionadoParaUbicar = null;
    document.getElementById('nr-mapa-hint').textContent = 'Ubicación guardada. Selecciona otro cliente sin ubicación si hace falta.';
    renderListaClientesRuta();
    dibujarMarcadoresNuevaRuta();
    showToast('Ubicación guardada');
  } catch (err) {
    showToast('No se pudo guardar la ubicación', 'error');
  }
}

function dibujarMarcadoresNuevaRuta() {
  if (!STATE.mapaNuevaRuta) return;
  if (STATE._capaMarcadoresNR) STATE.mapaNuevaRuta.removeLayer(STATE._capaMarcadoresNR);
  STATE._capaMarcadoresNR = L.layerGroup().addTo(STATE.mapaNuevaRuta);

  const seleccionados = Array.from(STATE.seleccionRuta.values()).filter(c => c.latitud != null);
  seleccionados.forEach((c, i) => {
    L.marker([c.latitud, c.longitud]).addTo(STATE._capaMarcadoresNR)
      .bindPopup(`<strong>${i+1}. ${esc(c.cliente_nombre || nombreCompleto(c))}</strong>`);
  });
  if (seleccionados.length) {
    const bounds = L.latLngBounds(seleccionados.map(c => [c.latitud, c.longitud]));
    STATE.mapaNuevaRuta.fitBounds(bounds, { padding: [30,30], maxZoom: 14 });
  }
}

function calcularOrdenRuta() {
  const seleccionados = Array.from(STATE.seleccionRuta.values());
  const sinUbicacion = seleccionados.filter(c => c.latitud == null);
  if (sinUbicacion.length) { showToast(`${sinUbicacion.length} parada(s) todavía no tienen ubicación marcada`, 'error'); return; }
  if (seleccionados.length < 2) { showToast('Elige al menos 2 paradas para calcular un orden', 'error'); return; }

  STATE.ordenCalculado = ordenarPorCercania(seleccionados);
  document.getElementById('nr-orden-preview').style.display = 'block';
  document.getElementById('nr-orden-lista').innerHTML = STATE.ordenCalculado.map((c,i) => `
    <div style="display:flex;gap:10px;padding:6px 0;font-size:13px;${i>0?'border-top:1px solid var(--border)':''}">
      <strong style="color:var(--accent)">${i+1}.</strong> ${esc(c.cliente_nombre || nombreCompleto(c))}
    </div>`).join('');

  if (STATE._lineaRuta) STATE.mapaNuevaRuta.removeLayer(STATE._lineaRuta);
  STATE._lineaRuta = L.polyline(STATE.ordenCalculado.map(c => [c.latitud, c.longitud]), { color: '#6366f1', weight: 3, dashArray: '6,6' }).addTo(STATE.mapaNuevaRuta);
}

async function guardarRuta() {
  const nombre = document.getElementById('nr-nombre').value.trim();
  if (!nombre) { showToast('Escribe un nombre para la ruta', 'error'); return; }
  const seleccionados = Array.from(STATE.seleccionRuta.values());
  if (seleccionados.length < 1) { showToast('Elige al menos un cliente', 'error'); return; }
  const dia = document.getElementById('nr-dia').value || null;
  const listaFinal = STATE.ordenCalculado && STATE.ordenCalculado.length === seleccionados.length ? STATE.ordenCalculado : seleccionados;

  setBtnLoading('btn-guardar-ruta', true);
  try {
    const { data: ruta, error: errRuta } = await sb.from('rutas').insert({
      auth_user_id: STATE.userId, nombre, dia_semana: dia, activa: true,
      tipo: STATE.tipoRutaActual, estado: 'planificada',
    }).select().single();
    if (errRuta) throw errRuta;

    const payload = listaFinal.map((c, i) => ({
      auth_user_id: STATE.userId, ruta_id: ruta.id,
      cliente_id: STATE.tipoRutaActual === 'cobro' ? c.cliente_id : c.id,
      orden: i,
      credito_id: STATE.tipoRutaActual === 'cobro' ? c.credito_id : null,
      cuota_id: STATE.tipoRutaActual === 'cobro' ? c.cuota_id : null,
    }));
    const { error: errRC } = await sb.from('ruta_clientes').insert(payload);
    if (errRC) throw errRC;

    showToast(`Ruta "${nombre}" guardada con ${listaFinal.length} parada(s)`);
    closeModal('modal-nueva-ruta');
    await cargarRutas();
  } catch (e) {
    console.error('guardarRuta:', e);
    showToast('Error al guardar la ruta: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-guardar-ruta', false);
  }
}

/* =====================================================
   VER RUTA (oficina) / IMPRIMIR
===================================================== */
let RUTA_ACTUAL = null;
async function verRuta(rutaId) {
  try {
    const { data: ruta } = await sb.from('rutas').select('*').eq('id', rutaId).eq('auth_user_id', STATE.userId).maybeSingle();
    if (!ruta) { showToast('Ruta no encontrada', 'error'); return; }
    const { data: paradas } = await sb.from('ruta_clientes')
      .select('id, orden, estado_parada, resultado_monto, resultado_nota, cliente_id, credito_id, cuota_id, clientes(id,nombre,apellido,telefono,direccion,latitud,longitud)')
      .eq('ruta_id', rutaId).order('orden');

    const lista = (paradas||[]).map(p => ({ ...p, cliente: p.clientes })).filter(p => p.cliente);
    RUTA_ACTUAL = { ruta, lista };

    document.getElementById('vr-titulo').textContent = `${TIPO_LABEL[ruta.tipo]||''} — ${ruta.nombre}`;
    document.getElementById('vr-lista-paradas').innerHTML = lista.map((p, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;${i>0?'border-top:1px solid var(--border)':''}">
        <div>
          <div style="font-weight:700;font-size:13.5px">${i+1}. ${esc(nombreCompleto(p.cliente))} ${p.estado_parada==='completada'?'✅':''}</div>
          <div style="font-size:12px;color:var(--text-muted)">${esc(p.cliente.direccion||'Sin dirección')} ${p.cliente.telefono ? '· '+esc(p.cliente.telefono) : ''}</div>
        </div>
        ${p.cliente.latitud != null ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${p.cliente.latitud},${p.cliente.longitud}" target="_blank" class="btn-secondary" style="padding:6px 12px;font-size:12px;white-space:nowrap">🧭 Cómo llegar</a>` : ''}
      </div>`).join('');

    openModal('modal-ver-ruta');
    setTimeout(() => {
      const el = document.getElementById('mapa-ver-ruta');
      if (STATE.mapaVerRuta) { STATE.mapaVerRuta.remove(); STATE.mapaVerRuta = null; }
      const conUbic = lista.filter(p => p.cliente.latitud != null).map(p => p.cliente);
      if (!conUbic.length) return;
      STATE.mapaVerRuta = L.map(el).setView([conUbic[0].latitud, conUbic[0].longitud], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(STATE.mapaVerRuta);
      conUbic.forEach((c,i) => L.marker([c.latitud,c.longitud]).addTo(STATE.mapaVerRuta).bindPopup(`${i+1}. ${esc(nombreCompleto(c))}`));
      if (conUbic.length > 1) L.polyline(conUbic.map(c=>[c.latitud,c.longitud]), { color:'#6366f1', weight:3, dashArray:'6,6' }).addTo(STATE.mapaVerRuta);
      STATE.mapaVerRuta.fitBounds(L.latLngBounds(conUbic.map(c=>[c.latitud,c.longitud])), { padding:[30,30] });
    }, 150);
  } catch (e) {
    console.error('verRuta:', e);
    showToast('Error al cargar la ruta', 'error');
  }
}

function imprimirListaRuta() {
  if (!RUTA_ACTUAL) return;
  const { ruta, lista } = RUTA_ACTUAL;
  const filas = lista.map((p,i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd">${i+1}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${esc(nombreCompleto(p.cliente))}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${esc(p.cliente.direccion||'—')}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${esc(p.cliente.telefono||'—')}</td>
    </tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<html><head><meta charset="UTF-8"><title>${esc(ruta.nombre)}</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;padding:24px}h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:14px}th{text-align:left;padding:8px;background:#f0f0f0}</style>
    </head><body>
    <h1>${esc(TIPO_LABEL[ruta.tipo]||'')} — ${esc(ruta.nombre)}</h1>
    <p style="color:#666;font-size:13px">${esc(STATE.empresaConfig?.nombre_comercial || '')} — ${lista.length} parada(s)</p>
    <table><thead><tr><th>#</th><th>Cliente</th><th>Dirección</th><th>Teléfono</th></tr></thead><tbody>${filas}</tbody></table>
    <script>window.print();</script>
    </body></html>`);
  w.document.close();
}

async function eliminarRuta(rutaId) {
  if (!confirm('¿Eliminar esta ruta? Los clientes, créditos y ventas no se afectan, solo se borra la ruta guardada.')) return;
  try {
    const { error } = await sb.from('rutas').delete().eq('id', rutaId).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Ruta eliminada');
    await cargarRutas();
  } catch (e) { showToast('Error al eliminar', 'error'); }
}

/* =====================================================
   VISTA DE CAMPO — pantalla completa, mobile-first, una parada
   a la vez. Nunca calcula dinero ni cuotas: cuando toca cobrar o
   vender, ABRE Créditos/Ventas de verdad (misma pantalla de siempre).
===================================================== */
async function iniciarVistaCampo() {
  if (!RUTA_ACTUAL) return;
  CAMPO.ruta = RUTA_ACTUAL.ruta;
  CAMPO.paradas = RUTA_ACTUAL.lista;
  CAMPO.indice = CAMPO.paradas.findIndex(p => p.estado_parada !== 'completada');
  if (CAMPO.indice < 0) CAMPO.indice = 0;

  if (CAMPO.ruta.estado === 'planificada') {
    await sb.from('rutas').update({ estado: 'en_progreso' }).eq('id', CAMPO.ruta.id).eq('auth_user_id', STATE.userId);
    CAMPO.ruta.estado = 'en_progreso';
  }

  closeModal('modal-ver-ruta');
  document.getElementById('vc-nombre-ruta').textContent = CAMPO.ruta.nombre;
  document.getElementById('vista-campo').style.display = 'flex';
  renderParadaCampo();
}

function cerrarVistaCampo() {
  document.getElementById('vista-campo').style.display = 'none';
  cargarRutas(); // refresca la tabla por si se completaron paradas
}

function renderParadaCampo() {
  const total = CAMPO.paradas.length;
  const p = CAMPO.paradas[CAMPO.indice];
  document.getElementById('vc-progreso').textContent = `Parada ${CAMPO.indice+1} de ${total}`;
  if (!p) return;
  const c = p.cliente;
  const completada = p.estado_parada === 'completada';
  const noEncontrado = p.estado_parada === 'no_encontrado';

  let accionesHtml = '';
  if (CAMPO.ruta.tipo === 'cobro') {
    accionesHtml = `
      <button class="vc-btn-grande" style="background:var(--success);color:#fff" onclick="irARegistrarPago('${p.credito_id}','${p.id}')">💰 Registrar pago (abre Créditos)</button>`;
  } else if (CAMPO.ruta.tipo === 'preventa') {
    accionesHtml = `
      <button class="vc-btn-grande" style="background:var(--accent);color:#fff" onclick="irAVenderAqui('${c.id}','${p.id}')">🛒 Vender aquí (abre Ventas)</button>`;
  }

  document.getElementById('vc-tarjeta-parada').innerHTML = `
    <div class="panel-card" style="text-align:center">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700">${TIPO_LABEL[CAMPO.ruta.tipo]||''}</div>
      <div style="font-size:20px;font-weight:800;margin:6px 0">${esc(nombreCompleto(c))}</div>
      <div style="font-size:13px;color:var(--text-secondary)">${esc(c.direccion||'Sin dirección')}</div>
      ${c.telefono ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:2px">📞 ${esc(c.telefono)}</div>` : ''}
      ${completada ? `<div style="margin-top:10px;color:var(--success);font-weight:700">✅ Parada completada</div>` : ''}
      ${noEncontrado ? `<div style="margin-top:10px;color:var(--warning);font-weight:700">⚠️ Marcado como "no encontrado"</div>` : ''}

      ${c.latitud != null ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${c.latitud},${c.longitud}" target="_blank" class="vc-btn-grande" style="background:var(--bg-app);color:var(--text-primary);border:1px solid var(--border);display:block;text-decoration:none">🧭 Cómo llegar</a>` : ''}

      ${!completada ? accionesHtml : ''}
      ${!completada ? `
        <button class="vc-btn-grande" style="background:var(--bg-app);border:1px solid var(--border);color:var(--text-primary)" onclick="marcarParadaCompletadaManual('${p.id}')">✅ Marcar como hecha</button>
        <button class="vc-btn-grande" style="background:var(--bg-app);border:1px solid var(--warning);color:var(--warning)" onclick="marcarParadaNoEncontrado('${p.id}')">⚠️ No encontrado / reagendar</button>
      ` : ''}
    </div>`;
}

function paradaAnterior() { if (CAMPO.indice > 0) { CAMPO.indice--; renderParadaCampo(); } }
function paradaSiguiente() { if (CAMPO.indice < CAMPO.paradas.length - 1) { CAMPO.indice++; renderParadaCampo(); } }

async function marcarParadaEstado(paradaId, estado, monto, nota) {
  try {
    await sb.from('ruta_clientes').update({
      estado_parada: estado, completada_en: new Date().toISOString(),
      resultado_monto: monto ?? null, resultado_nota: nota ?? null,
    }).eq('id', paradaId).eq('auth_user_id', STATE.userId);
    const p = CAMPO.paradas.find(x => x.id === paradaId);
    if (p) p.estado_parada = estado;
    renderParadaCampo();

    // Si ya no quedan paradas pendientes, se marca la ruta como completada.
    if (CAMPO.paradas.every(x => x.estado_parada === 'completada' || x.estado_parada === 'no_encontrado')) {
      await sb.from('rutas').update({ estado: 'completada' }).eq('id', CAMPO.ruta.id).eq('auth_user_id', STATE.userId);
      CAMPO.ruta.estado = 'completada';
    }
  } catch (e) { showToast('No se pudo actualizar la parada', 'error'); }
}
function marcarParadaCompletadaManual(paradaId) { marcarParadaEstado(paradaId, 'completada'); }
function marcarParadaNoEncontrado(paradaId) {
  const nota = prompt('¿Alguna nota? (opcional)') || null;
  marcarParadaEstado(paradaId, 'no_encontrado', null, nota);
}

// El truco central de todo el diseño: NUNCA se calcula el pago ni la
// venta aquí — se manda a la pantalla real de Créditos/Ventas, que
// sigue siendo la única fuente de verdad para ese dinero.
function irARegistrarPago(creditoId, paradaId) {
  if (!creditoId) { showToast('Esta parada no tiene un crédito vinculado', 'error'); return; }
  try { sessionStorage.setItem('n360_ruta_parada_pendiente', paradaId); } catch(e) {}
  window.open(`creditos.html?abrir_pago=${creditoId}`, '_blank');
}
function irAVenderAqui(clienteId, paradaId) {
  try { sessionStorage.setItem('n360_ruta_parada_pendiente', paradaId); } catch(e) {}
  window.open(`ventas.html?ruta_cliente=${clienteId}`, '_blank');
}

/* =====================================================
   HELPERS DE MODAL Y TOAST
===================================================== */
function openModal(id) { const el = document.getElementById(id); if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; } }
function setBtnLoading(id, loading) { const btn = document.getElementById(id); if (btn) { btn.disabled = loading; btn.style.opacity = loading ? '.6' : ''; } }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-NI', { day:'2-digit', month:'short' });
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
  } catch (e) {}
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hAv = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name||'U')[0].toUpperCase();
}

async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarClientes();
    cargarMapaGeneral();
    await cargarRutas();
  } catch (e) {
    console.error('init rutas:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});
