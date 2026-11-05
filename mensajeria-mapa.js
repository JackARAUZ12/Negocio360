/* =====================================================
   MENSAJERIA-MAPA.JS — NEGOCIO360 · Mensajería: Mapa en vivo (Despacho)
   Mapa real y gratis (Leaflet + OpenStreetMap, sin cuenta ni pago).
   Muestra a cada repartidor donde mandó su ubicación por última vez
   (verde: reciente, ámbar: hace rato, gris: vieja) y los envíos que
   tienen ubicación (📍 por asignar, 🛵 en camino, ⚠️ no entregado).
   Tocar un envío por asignar lo marca para asignar en el tablero.
   Se refresca solo con el Despacho (cada minuto) sin mover la vista.
===================================================== */
'use strict';
const TM = { mapa: null, capa: null, cargando: null, ajustado: false, oculto: false, firma: '' };
const TM_GUARDADO = 'n360_msj_mapa_oculto';
try { TM.oculto = localStorage.getItem(TM_GUARDADO) === '1'; } catch (_) {}

// Leaflet se carga solo cuando se va a ver el mapa (la pantalla abre igual de rápido).
function tmLeaflet() {
  if (window.L && window.L.map) return Promise.resolve();
  if (TM.cargando) return TM.cargando;
  TM.cargando = new Promise((ok, mal) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => (window.L && window.L.map ? ok() : mal(new Error('leaflet')));
    s.onerror = () => { TM.cargando = null; mal(new Error('leaflet')); };
    document.head.appendChild(s);
  });
  return TM.cargando;
}
const tmMin = d => d ? (Date.now() - new Date(d).getTime()) / 60000 : Infinity;
const tmColor = d => { const m = tmMin(d); return m <= 10 ? 'vivo' : m <= 60 ? 'rato' : 'viejo'; };
const tmTieneUbic = o => o && o.lat != null && o.lng != null && isFinite(o.lat) && isFinite(o.lng);

TM.puntos = function () {
  const reps = TD.reps.filter(r => r.activo && r.ubic_lat != null && r.ubic_lng != null && tmMin(r.ubic_at) <= 24 * 60);
  const envs = TD.lista.filter(e => ['por_recoger', 'en_bodega', 'asignado', 'en_ruta', 'no_entregado'].includes(e.estado) && tmTieneUbic(e));
  return { reps, envs };
};
TM.pintar = async function () {
  const caja = $d('d-mapa'); if (!caja) return;
  const { reps, envs } = TM.puntos(), hay = reps.length + envs.length > 0;
  const vivos = reps.filter(r => tmColor(r.ubic_at) === 'vivo').length;
  $d('d-mapa-cab').innerHTML = `<b>🗺️ Mapa en vivo</b><span class="tl-muted ms-mapa-res">${reps.length ? `🛵 ${reps.length} repartidor${reps.length === 1 ? '' : 'es'}${vivos ? ` · ${vivos} en línea` : ''}` : 'Sin repartidores con ubicación'}${envs.length ? ` · 📍 ${envs.length} envío${envs.length === 1 ? '' : 's'}` : ''}</span>
    ${hay && !TM.oculto ? '<button type="button" class="btn-secondary tln-btn-sm" onclick="TM.verTodo()">🎯 Ver todo</button>' : ''}
    <button type="button" class="btn-secondary tln-btn-sm" onclick="TM.alternar()" aria-expanded="${!TM.oculto}">${TM.oculto ? '👁 Ver mapa' : '▴ Ocultar'}</button>`;
  if (TM.oculto) { caja.style.display = 'none'; return; }
  caja.style.display = '';
  if (!hay) {
    if (TM.mapa) { TM.mapa.remove(); TM.mapa = null; TM.capa = null; TM.ajustado = false; }
    caja.classList.add('vacio');
    caja.innerHTML = '<div><b>📍 Aquí verás a tus repartidores en el mapa</b><span>Cuando un repartidor abra “Mis entregas” y toque <b>“Compartir mi ubicación”</b>, aparece aquí y se mueve solo. Los envíos con ubicación también se ven.</span></div>';
    return;
  }
  caja.classList.remove('vacio');
  try { await tmLeaflet(); } catch (_) { caja.classList.add('vacio'); caja.innerHTML = '<div><b>No se pudo cargar el mapa</b><span>Revisa tu conexión y toca 🔄 Actualizar.</span></div>'; return; }
  if (!TM.mapa) {
    caja.innerHTML = '';
    TM.mapa = L.map(caja, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(TM.mapa);
    TM.capa = L.layerGroup().addTo(TM.mapa);
    TM.mapa.on('click', () => TM.mapa.scrollWheelZoom.enable());   // la rueda del mouse acerca solo después de tocar el mapa (no estorba al bajar la página)
    TM.ajustado = false;
  }
  // No redibujar si nada cambió (el mapa no parpadea ni cierra la ventanita abierta).
  const firma = JSON.stringify([reps.map(r => [r.id, r.ubic_lat, r.ubic_lng, tmColor(r.ubic_at), Math.round(tmMin(r.ubic_at)), TD.carga(r.id), (TD.mano || {})[r.id] || 0]), envs.map(e => [e.id, e.estado, e.repartidor_id, TD.sel.has(e.id)])]);
  if (firma === TM.firma && TM.ajustado) { TM.mapa.invalidateSize(); return; }
  TM.firma = firma; TM.capa.clearLayers();
  envs.forEach(e => {
    const marcable = ['por_recoger', 'en_bodega', 'asignado', 'no_entregado'].includes(e.estado), r = TD.rep(e.repartidor_id), sel = TD.sel.has(e.id);
    const ico = e.estado === 'en_ruta' ? '🛵' : e.estado === 'no_entregado' ? '⚠️' : e.estado === 'asignado' ? '🧑' : '📦';
    const m = L.marker([Number(e.lat), Number(e.lng)], { title: e.numero, icon: L.divIcon({ className: '', html: `<div class="ms-pin ${e.estado}${sel ? ' sel' : ''}${e.urgente ? ' urg' : ''}">${ico}</div>`, iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26] }) });
    m.bindPopup(`<div class="ms-pop"><b>${esc(e.numero)}</b> ${msChip(e.estado)}${e.urgente ? ' <span class="ms-chip urg">🚨</span>' : ''}<br><b>${esc(e.destinatario_nombre)}</b><br><span class="tl-muted">${esc(e.direccion)}${e.zona_nombre ? ' · ' + esc(e.zona_nombre) : ''}</span>
      ${r ? `<br>🛵 ${esc(r.nombre)}` : ''}${msPorCobrar(e) > 0 ? `<br>💵 Cobrar ${fmt(msPorCobrar(e))}` : ''}
      <div class="ms-pop-acc">${marcable ? `<button type="button" class="${sel ? 'btn-secondary' : 'btn-primary'}" onclick="TM.marcar('${e.id}')">${sel ? '☐ Quitar de la selección' : '☑ Marcar para asignar'}</button>` : ''}
      <a class="btn-secondary" href="${esc(msMaps(e))}" target="_blank" rel="noopener">🧭 Cómo llegar</a></div></div>`, { maxWidth: 260 });
    m.addTo(TM.capa);
  });
  reps.forEach(r => {
    const c = tmColor(r.ubic_at), mano = (TD.mano || {})[r.id] || 0, tel = String(r.telefono || '').replace(/[^\d+]/g, '');
    const nom = String(r.nombre || '').trim().split(/\s+/)[0];
    const m = L.marker([Number(r.ubic_lat), Number(r.ubic_lng)], { title: r.nombre, zIndexOffset: 1000, icon: L.divIcon({ className: '', html: `<div class="ms-moto ${c}"><span>${esc(MS_VEHICULOS[r.vehiculo]?.split(' ')[0] || '🛵')}</span><b>${esc(nom)}</b></div>`, iconSize: null, iconAnchor: [20, 20], popupAnchor: [0, -18] }) });
    m.bindPopup(`<div class="ms-pop"><b>${esc(r.nombre)}</b><br><span class="ms-ubic-hace ${c}">● ${esc(msHace(r.ubic_at))}</span>${r.ubic_precision ? ` <span class="tl-muted">(±${Math.round(r.ubic_precision)} m)</span>` : ''}
      <br>${TD.carga(r.id)} por entregar · 💵 en mano ${fmt(mano)}
      <div class="ms-pop-acc">${tel ? `<a class="btn-secondary" href="tel:${esc(tel)}">📞 Llamar</a><a class="btn-secondary" href="${esc(msWa(tel, 'Hola ' + nom))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      <button type="button" class="btn-primary" onclick="TM.elegirRep('${r.id}')">Asignarle envíos</button></div></div>`, { maxWidth: 260 });
    m.addTo(TM.capa); r.__marca = m;
  });
  if (!TM.ajustado) { TM.verTodo(); TM.ajustado = true; }
  setTimeout(() => TM.mapa && TM.mapa.invalidateSize(), 50);
};
TM.verTodo = function () {
  if (!TM.mapa) return;
  const { reps, envs } = TM.puntos();
  const pts = [...reps.map(r => [Number(r.ubic_lat), Number(r.ubic_lng)]), ...envs.map(e => [Number(e.lat), Number(e.lng)])];
  if (!pts.length) return;
  if (pts.length === 1) TM.mapa.setView(pts[0], 15); else TM.mapa.fitBounds(pts, { padding: [36, 36], maxZoom: 16 });
};
// Ver a un repartidor en el mapa (desde su tarjeta de arriba).
TM.verRep = function (id) {
  if (TM.oculto) { TM.alternar(); }
  setTimeout(() => {
    const r = TD.reps.find(x => x.id === id); if (!TM.mapa || !r || r.ubic_lat == null) return;
    $d('d-mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
    TM.mapa.setView([Number(r.ubic_lat), Number(r.ubic_lng)], 16);
    if (r.__marca) r.__marca.openPopup();
  }, TM.mapa ? 0 : 400);
};
TM.marcar = function (id) {
  if (TD.sel.has(id)) TD.sel.delete(id); else TD.sel.add(id);
  TM.mapa && TM.mapa.closePopup(); TD.pintar();
};
TM.elegirRep = function (id) {
  const s = $d('d-rep'); if (s) s.value = id;
  TM.mapa && TM.mapa.closePopup();
  if (!TD.sel.size) showToast('Marca los envíos (en el mapa o en el tablero) y toca “Asignar”.');
  else $d('d-asignar').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
TM.alternar = function () {
  TM.oculto = !TM.oculto; try { localStorage.setItem(TM_GUARDADO, TM.oculto ? '1' : '0'); } catch (_) {}
  TM.pintar();
};
