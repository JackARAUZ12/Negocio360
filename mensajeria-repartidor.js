/* =====================================================
   MENSAJERIA-REPARTIDOR.JS — NEGOCIO360 · Mensajería: Mis entregas
   La pantalla del repartidor (celular primero). Si el usuario que
   entró con su código está ligado a un repartidor, ve SOLO sus
   entregas; si no (administración), elige el repartidor.
   Waze / Google Maps, llamar, WhatsApp, "Salir a ruta", "Entregado"
   (foto, quién recibió, cómo pagó) y "No se pudo" (motivo).
   "Compartir mi ubicación": usa el GPS del celular (gratis) y la
   oficina lo ve en el mapa en vivo de Despacho.
===================================================== */
'use strict';
const TR = { reps: [], cfg: {}, rep: null, fijo: false, lista: [], hoy: [], mano: 0, ocupado: false, gps: null, gpsUlt: 0, gpsEstado: '' };
const $r = id => document.getElementById(id);
const TR_GUARDADO = 'n360_msj_repartidor';
const TR_GPS = 'n360_msj_gps';   // si la dejó encendida, se vuelve a encender sola al abrir la pantalla

TR.elegirRepartidor = function () {
  const pf = msPerfil();
  const ligado = pf && TR.reps.find(r => r.perfil_id === pf.id && r.activo);
  if (ligado) { TR.rep = ligado; TR.fijo = true; return; }
  TR.fijo = false;
  let guardado = null; try { guardado = localStorage.getItem(TR_GUARDADO); } catch (_) {}
  TR.rep = TR.reps.find(r => r.id === guardado && r.activo) || null;
};
TR.pintarQuien = function () {
  const act = TR.reps.filter(r => r.activo);
  if (TR.fijo) { $r('r-quien').innerHTML = `<div class="tl-chip" style="background:var(--accent-soft);color:var(--accent);padding:8px 14px;border-radius:999px;font-weight:800">${esc(MS_VEHICULOS[TR.rep.vehiculo]?.split(' ')[0] || '🛵')} ${esc(TR.rep.nombre)}</div>`; return; }
  $r('r-quien').innerHTML = act.length
    ? `<select class="tl-sel" id="r-rep" aria-label="Repartidor" onchange="TR.cambiar(this.value)"><option value="">¿Quién eres? Elige el repartidor…</option>${act.map(r => `<option value="${r.id}" ${TR.rep && TR.rep.id === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select>`
    : '<div class="tl-aviso">Aún no hay repartidores. Regístralos en “Zonas, tarifas y repartidores”.</div>';
};
TR.pintarGps = function () {
  const el = $r('r-gps'); if (!el) return;
  if (!TR.rep || !('geolocation' in navigator)) { el.innerHTML = ''; return; }
  const on = !!TR.gps;
  el.innerHTML = `<button type="button" class="${on ? 'btn-primary' : 'btn-secondary'}" style="min-height:44px" aria-pressed="${on}" onclick="TR.gpsCambiar()">📍 ${on ? 'Compartiendo mi ubicación' : 'Compartir mi ubicación'}</button>
    <span class="tl-muted" style="font-size:13px">${esc(TR.gpsEstado || (on ? 'Buscando señal…' : 'La oficina ve dónde vas. Solo mientras esta pantalla esté abierta.'))}</span>`;
};
TR.gpsCambiar = function () {
  if (TR.gps) { navigator.geolocation.clearWatch(TR.gps); TR.gps = null; TR.gpsEstado = 'Ubicación apagada.'; try { localStorage.setItem(TR_GPS, '0'); } catch (_) {} TR.pintarGps(); return; }
  try { localStorage.setItem(TR_GPS, '1'); } catch (_) {}
  TR.gpsEstado = 'Buscando señal…'; TR.gpsUlt = 0;
  TR.gps = navigator.geolocation.watchPosition(TR.gpsLlego, err => {
    TR.gpsEstado = err && err.code === 1 ? 'Permite la ubicación en tu celular para compartirla.' : 'No se pudo leer el GPS. Intenta al aire libre.';
    if (err && err.code === 1 && TR.gps) { navigator.geolocation.clearWatch(TR.gps); TR.gps = null; try { localStorage.setItem(TR_GPS, '0'); } catch (_) {} }
    TR.pintarGps();
  }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
  TR.pintarGps();
};
TR.gpsLlego = async function (p) {
  if (!TR.rep || Date.now() - TR.gpsUlt < 60000) return; // cada minuto basta (cuida datos y batería)
  TR.gpsUlt = Date.now();
  const r = await msRpc('msj_ubicacion_enviar', { p_repartidor: TR.rep.id, p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_precision: Math.round(p.coords.accuracy || 0) });
  TR.gpsEstado = r.ok ? `✅ Enviada a las ${new Date().toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}` : 'No se pudo enviar. Se reintenta solo.';
  if (!r.ok) TR.gpsUlt = 0;
  TR.pintarGps();
};
TR.cambiar = function (id) { TR.rep = TR.reps.find(r => r.id === id) || null; TR.gpsUlt = 0; try { localStorage.setItem(TR_GUARDADO, id || ''); } catch (_) {} TR.cargar(); };

TR.cargar = async function () {
  TR.pintarQuien(); TR.pintarGps();
  if (!TR.rep) { $r('r-lista').innerHTML = '<div class="tl-vacio">Elige el repartidor para ver sus entregas.</div>'; $r('r-resumen').innerHTML = ''; $r('r-salir').innerHTML = ''; $r('r-hoy').innerHTML = ''; $r('r-hoy-n').textContent = ''; return; }
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [pend, ent, mano] = await Promise.all([
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).eq('repartidor_id', TR.rep.id).in('estado', ['asignado', 'en_ruta']).order('created_at').limit(300),
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).eq('repartidor_id', TR.rep.id).eq('estado', 'entregado').gte('entregado_at', hoy.toISOString()).order('entregado_at', { ascending: false }).limit(300),
    msEfectivoEnMano(),
  ]);
  TR.lista = (pend.data || []).sort((a, b) => (b.urgente - a.urgente) || (a.estado === 'en_ruta' ? -1 : 0) - (b.estado === 'en_ruta' ? -1 : 0) || String(a.zona_nombre || '').localeCompare(String(b.zona_nombre || '')));
  TR.hoy = ent.data || []; TR.mano = mano[TR.rep.id] || 0;
  TR.pintar();
};
TR.pintar = function () {
  const porCobrar = TR.lista.reduce((a, e) => a + msPorCobrar(e), 0), tope = msTope(TR.rep, TR.cfg), pasa = tope > 0 && TR.mano > tope;
  $r('r-resumen').innerHTML = `<div><b>${TR.lista.length}</b><span>por entregar</span></div><div><b>${TR.hoy.length}</b><span>entregados hoy</span></div>
    <div class="${pasa ? 'alerta' : ''}"><b>${fmt(TR.mano)}</b><span>efectivo en mano${tope ? ' (tope ' + fmt(tope) + ')' : ''}</span></div><div><b>${fmt(porCobrar)}</b><span>por cobrar</span></div>`
    + (pasa ? '<div class="alerta" style="grid-column:1/-1"><b style="font-size:14px">⚠️ Llevas más efectivo que tu tope</b><span>Pasa por la oficina a cuadrar antes de seguir.</span></div>' : '');
  const asignados = TR.lista.filter(e => e.estado === 'asignado').length;
  $r('r-salir').innerHTML = asignados > 1 ? `<button type="button" class="btn-primary" style="width:100%;min-height:46px;margin-bottom:12px;font-weight:800" onclick="TR.salirTodos()">🛵 Salir a ruta con los ${asignados} envíos</button>` : '';
  $r('r-lista').innerHTML = TR.lista.length ? TR.lista.map(TR.tarjeta).join('') : '<div class="tl-vacio" style="padding:24px">🎉 No tienes entregas pendientes.</div>';
  $r('r-hoy-n').textContent = TR.hoy.length ? `${TR.hoy.length}` : '';
  $r('r-hoy').innerHTML = TR.hoy.map(e => `<div class="ms-linea">✅ <span><b>${esc(e.numero)}</b> · ${esc(e.destinatario_nombre)} · ${msHora(e.entregado_at)}${e.metodo_cobro ? ' · ' + fmt(Number(e.cobrado_cod) + Number(e.cobrado_envio)) + (e.metodo_cobro === 'efectivo' ? ' 💵' : ' 🏦') : ''}</span></div>`).join('') || '<span class="tl-muted">Todavía nada hoy.</span>';
};
TR.tarjeta = function (e) {
  const c = msPorCobrar(e), tel = e.destinatario_telefono;
  const wa = tel ? msWa(tel, `Hola ${e.destinatario_nombre}, soy ${TR.rep.nombre}, repartidor de ${TL.empresaConfig?.nombre_comercial || ''}. Voy en camino con su envío ${e.numero}.${c > 0 ? ' Monto a pagar: ' + fmt(c) + '.' : ''}${msRastreoUrl(e) ? ' Sígalo aquí: ' + msRastreoUrl(e) : ''}`) : '';
  return `<div class="ms-ent${e.urgente ? ' urg' : ''}">
    <h3><span>${esc(e.destinatario_nombre)}</span><span>${e.urgente ? '<span class="ms-chip urg">🚨 Urgente</span> ' : ''}${msChip(e.estado)}</span></h3>
    <div class="ms-dir">📍 ${esc(e.direccion)}</div>
    ${e.referencia ? `<div class="tl-muted">🔎 ${esc(e.referencia)}</div>` : ''}
    <div class="tl-muted"><span class="ms-num">${esc(e.numero)}</span>${e.zona_nombre ? ' · ' + esc(e.zona_nombre) : ''} · De: ${esc(e.remitente_nombre)} · ${Number(e.paquetes)} paquete${Number(e.paquetes) === 1 ? '' : 's'}</div>
    ${e.descripcion ? `<div class="tl-muted">📦 ${esc(e.descripcion)}</div>` : ''}
    ${e.notas ? `<div class="tl-aviso" style="font-weight:600">📝 ${esc(e.notas)}</div>` : ''}
    <div>${c > 0 ? `<span class="ms-cobrar" style="font-size:16px">💵 Cobrar ${fmt(c)}</span>` : '<span class="ms-chip entregado">No se cobra nada</span>'}</div>
    <div class="ms-ir">
      <a href="${esc(msWaze(e))}" target="_blank" rel="noopener"><span>🚗</span>Waze</a>
      <a href="${esc(msMaps(e))}" target="_blank" rel="noopener"><span>🧭</span>Maps</a>
      <a href="${tel ? 'tel:' + esc(String(tel).replace(/[^\d+]/g, '')) : '#'}" class="${tel ? '' : 'off'}"><span>📞</span>Llamar</a>
      <a href="${esc(wa || '#')}" target="_blank" rel="noopener" class="${wa ? '' : 'off'}"><span>💬</span>WhatsApp</a>
    </div>
    <div class="ms-acc-grande">
      ${e.estado === 'asignado' ? `<button type="button" class="btn-primary" onclick="TR.salir('${e.id}')">🛵 Voy en camino</button>` : `<button type="button" class="btn-primary" onclick="TR.entregar('${e.id}')">✅ Entregado</button>`}
      <button type="button" class="btn-secondary" style="color:var(--danger)" onclick="TR.noEntregado('${e.id}')">⚠️ No se pudo</button>
    </div></div>`;
};
TR.salir = async function (id) {
  if (TR.ocupado) return; TR.ocupado = true;
  const r = await msRpc('msj_envio_estado', { p_id: id, p_nuevo: 'en_ruta', p_motivo: null, p_por: msPor() });
  TR.ocupado = false;
  if (!r.ok) showToast(r.msg, 'error'); else showToast('🛵 En camino');
  TR.cargar();
};
TR.salirTodos = async function () {
  if (TR.ocupado) return; TR.ocupado = true;
  let ok = 0;
  for (const e of TR.lista.filter(x => x.estado === 'asignado')) { const r = await msRpc('msj_envio_estado', { p_id: e.id, p_nuevo: 'en_ruta', p_motivo: null, p_por: msPor() }); if (r.ok) ok++; }
  TR.ocupado = false; showToast(`🛵 ${ok} envío${ok === 1 ? '' : 's'} en ruta`); TR.cargar();
};
TR.entregar = function (id) { const e = TR.lista.find(x => x.id === id); if (e) msEntregar(e, TR.cargar); };
TR.noEntregado = function (id) { const e = TR.lista.find(x => x.id === id); if (e) msNoEntregado(e, TR.cargar); };

window.tallerListo = async function () {
  const [reps, cfg] = await Promise.all([msRepartidores(false), msConfig()]);
  TR.reps = reps; TR.cfg = cfg; TR.elegirRepartidor();
  await TR.cargar();
  let seguir = false; try { seguir = localStorage.getItem(TR_GPS) === '1'; } catch (_) {}
  if (seguir && TR.rep && !TR.gps && 'geolocation' in navigator) TR.gpsCambiar();
  setInterval(() => { if (!document.hidden && !document.querySelector('.tl-modal.abierto') && !TR.ocupado) TR.cargar(); }, 60000);
};
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('.tl-modal.abierto').forEach(m => m.classList.remove('abierto')); });
