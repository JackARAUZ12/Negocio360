/* ============================================================
   TRANSPORTE-PORTAL.JS — NEGOCIO360 (Transporte · Portal de clientes)
   El dueño da acceso a cada cliente con UN toque: el sistema crea solo
   el enlace privado, el PIN de 6 dígitos y el código QR.
   - Todo pasa por funciones del servidor (tx_portal_lista / tx_portal_gestionar).
   - El PIN se guarda cifrado: solo se muestra al crearlo o cambiarlo.
   - SOLO acceso de lectura para el cliente. No toca órdenes, cobros ni Caja.
   ============================================================ */
'use strict';

const sb = TX.sb;
const { esc } = TX;
const $ = id => document.getElementById(id);
const PC = { clientes: [], ordenes: [], accesos: [], filtro: 'todos', q: '', pinRecien: {} };

const urlPortal = tok => new URL('portal-transporte.html#t=' + tok, location.href).href;
const nombreCli = c => [c?.nombre, c?.apellido].filter(Boolean).join(' ').trim() || c?.empresa || 'Cliente';
const telDigitos = t => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 8) d = '505' + d; return d; };
const accesoDe = id => PC.accesos.find(a => a.cliente_id === id);
const negocio = () => TX.empresaConfig?.nombre_comercial || 'nuestra empresa';
function hace(d) {
  if (!d) return ''; const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`; if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const n = Math.round(s / 86400); return n === 1 ? 'ayer' : `hace ${n} días`;
}
function qrSvg(texto, celda) {
  try { if (typeof qrcode === 'undefined') return ''; const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag(celda || 5, 0); } catch (_) { return ''; }
}
const MOTIVOS = { sesion: 'Tu sesión venció. Vuelve a entrar.', desactivado: 'El módulo de Transporte está apagado en esta cuenta.',
  cliente: 'Ese cliente no pertenece a esta cuenta.', sin_acceso: 'Este cliente todavía no tiene acceso.', pin_formato: 'El PIN debe tener de 4 a 6 números.' };

async function rpc(nombre, args) {
  try {
    const { data, error } = await sb.rpc(nombre, args || {});
    if (error) throw error;
    if (!data || data.ok !== true) return { ok: false, msg: MOTIVOS[data?.motivo] || 'No se pudo completar. Intenta de nuevo.' };
    return data;
  } catch (e) { console.warn(nombre, e); return { ok: false, msg: 'No se pudo completar. Revisa tu conexión e intenta de nuevo.' }; }
}

/* ---------------- carga ---------------- */
async function cargarTodo() {
  const [cli, ords, acc] = await Promise.all([
    TX.paginar(() => sb.from('clientes').select('id,nombre,apellido,empresa,telefono,whatsapp,email,activo').eq('auth_user_id', TX.userId).order('nombre')),
    TX.paginar(() => sb.from('transporte_ordenes').select('id,cliente_id,estado').eq('auth_user_id', TX.userId)),
    rpc('tx_portal_lista'),
  ]);
  PC.clientes = cli || []; PC.ordenes = ords || []; PC.accesos = acc.ok ? (acc.accesos || []) : [];
  if (!acc.ok) TX.toast(acc.msg, 'error');
}
const viajesDe = id => PC.ordenes.filter(o => o.cliente_id === id && o.estado !== 'cancelada');
const enCurso = id => viajesDe(id).filter(o => ['pendiente', 'asignada', 'en_ruta'].includes(o.estado)).length;

/* ---------------- pintado ---------------- */
function renderKpis() {
  const act = PC.accesos.filter(a => a.activo), sem = act.filter(a => a.ultimo_ingreso && Date.now() - new Date(a.ultimo_ingreso) < 7 * 864e5);
  const visibles = act.reduce((s, a) => s + enCurso(a.cliente_id), 0);
  $('pc-kpis').innerHTML = `
    <div class="tx-kpi"><span>🟢 Clientes con acceso</span><b>${act.length}</b><small>pueden ver sus viajes</small></div>
    <div class="tx-kpi"><span>👀 Entraron esta semana</span><b>${sem.length}</b><small>de ${act.length} con acceso</small></div>
    <div class="tx-kpi"><span>🚚 Viajes en curso visibles</span><b>${visibles}</b><small>se actualizan solos</small></div>`;
}
function renderComo() {
  const abierto = !PC.accesos.length;   // la guía se muestra abierta solo hasta dar el primer acceso
  $('pc-como').innerHTML = `<details class="pc-guia" ${abierto ? 'open' : ''}><summary>💡 ¿Cómo funciona? (3 pasos)</summary><div class="pc-pasos">
    <div><span>1</span><b>Toca “Dar acceso”</b><small>El sistema crea solo el enlace, el PIN y el código QR.</small></div>
    <div><span>2</span><b>Envíalo por WhatsApp</b><small>Un toque: el mensaje ya va escrito, o imprime la tarjeta con el QR.</small></div>
    <div><span>3</span><b>Tu cliente ve sus viajes</b><small>Todos sus viajes, el tracking y la entrega, en vivo. Solo puede mirar.</small></div>
  </div>
  <div class="pc-ve"><span>✅ Ve: número de viaje, ruta, estado, tracking (fecha, hora, país), entrega y quién recibió.</span>
    <span>🚫 Nunca ve: precios, costos, cobros, otros clientes ni tus notas internas.</span></div></details>`;
}
function estadoHtml(a) {
  if (!a) return '<span class="tx-chip gris">Sin acceso</span>';
  if (!a.activo) return '<span class="tx-chip rojo">🔴 Apagado</span>';
  if (a.bloqueado) return '<span class="tx-chip naranja">⛔ Pausado por PIN equivocado</span>';
  return `<span class="tx-chip verde">🟢 Activo</span> <small class="pc-ult">${a.ultimo_ingreso ? 'Entró ' + esc(hace(a.ultimo_ingreso)) : 'Aún no ha entrado'}</small>`;
}
function renderLista() {
  document.querySelectorAll('[data-pc-f]').forEach(b => b.classList.toggle('on', b.dataset.pcF === PC.filtro));
  const q = TX.quitarTildes ? TX.quitarTildes(PC.q) : PC.q.toLowerCase();
  // Primero los que tienen viajes (más en curso arriba); los que nunca han viajado van al final.
  let l = PC.clientes.filter(c => c.activo !== false || accesoDe(c.id));
  l = l.filter(c => {
    const a = accesoDe(c.id);
    if (PC.filtro === 'con' && !(a && a.activo)) return false;
    if (PC.filtro === 'sin' && a && a.activo) return false;
    if (q && !(TX.quitarTildes ? TX.quitarTildes(nombreCli(c) + ' ' + (c.empresa || '')) : nombreCli(c).toLowerCase()).includes(q)) return false;
    return true;
  }).sort((a, b) => (enCurso(b.id) - enCurso(a.id)) || (viajesDe(b.id).length - viajesDe(a.id).length) || nombreCli(a).localeCompare(nombreCli(b)));
  const conViajes = l.filter(c => viajesDe(c.id).length || accesoDe(c.id)), sinViajes = l.filter(c => !viajesDe(c.id).length && !accesoDe(c.id));
  const fila = c => {
    const a = accesoDe(c.id), v = viajesDe(c.id).length, cur = enCurso(c.id);
    const acciones = !a ? `<button type="button" class="tx-btn tx-btn-primary" data-pc-dar="${esc(c.id)}">🔗 Dar acceso</button>`
      : !a.activo ? `<button type="button" class="tx-btn" data-pc-encender="${esc(c.id)}">Encender acceso</button>`
      : `<button type="button" class="tx-btn tx-btn-primary" data-pc-enviar="${esc(c.id)}">📲 Enviar acceso</button><button type="button" class="tx-btn" data-pc-opc="${esc(c.id)}" aria-label="Opciones">⚙️ Opciones</button>`;
    return `<div class="pc-fila">
      <div class="pc-av" aria-hidden="true">${esc(nombreCli(c).slice(0, 1).toUpperCase())}</div>
      <div class="pc-info"><b>${esc(nombreCli(c))}</b>
        <small>${v ? `${cur ? `<b class="pc-cur">${cur} en curso</b> · ` : ''}${v} viaje${v === 1 ? '' : 's'} en total` : 'Sin viajes todavía'}</small>
        <div class="pc-est">${estadoHtml(a)}</div></div>
      <div class="pc-acc">${acciones}</div></div>`;
  };
  if (!l.length) {
    $('pc-lista').innerHTML = `<div class="tx-vacio"><div class="tx-vacio-i">👥</div><b>${PC.clientes.length ? 'No hay clientes con ese filtro' : 'Aún no tienes clientes'}</b>
      <p>${PC.clientes.length ? 'Cambia la búsqueda o el filtro.' : 'Cuando crees una orden con un cliente, aparecerá aquí.'}</p></div>`;
    return;
  }
  $('pc-lista').innerHTML = `<div class="pc-lista">${conViajes.map(fila).join('')}</div>` +
    (sinViajes.length ? `<details class="pc-otros" ${conViajes.length ? '' : 'open'}><summary>Otros clientes sin viajes (${sinViajes.length})</summary><div class="pc-lista">${sinViajes.map(fila).join('')}</div></details>` : '');
}
function renderTodo() { renderKpis(); renderComo(); renderLista(); }

/* ---------------- tarjeta para enviar (enlace + PIN + QR) ---------------- */
function mensaje(c, tok, pin) {
  return `Hola ${nombreCli(c)} 👋\nDesde ahora puede ver el seguimiento de sus viajes con ${negocio()}, en vivo, desde su teléfono o computadora:\n\n` +
    `🔗 ${urlPortal(tok)}\n${pin ? `🔑 Su PIN: ${pin}\n` : ''}\nGuarde este mensaje. ¡Gracias por confiar en nosotros!`;
}
function mostrarAcceso(clienteId, tok, pin, titulo) {
  const c = PC.clientes.find(x => x.id === clienteId) || {}, url = urlPortal(tok), tel = telDigitos(c.whatsapp || c.telefono);
  if (pin) PC.pinRecien[clienteId] = pin;
  const pinMostrar = pin || PC.pinRecien[clienteId] || '';
  const msg = mensaje(c, tok, pinMostrar);
  PC.ultimo = { c, tok, pin: pinMostrar, msg, url };
  $('pa-titulo').textContent = titulo || `Acceso de ${nombreCli(c)}`;
  $('pa-cuerpo').innerHTML = `
    <div class="pa-tarjeta">
      <div class="pa-qr">${qrSvg(url, 5)}</div>
      <div class="pa-datos">
        <small>Cliente</small><b>${esc(nombreCli(c))}</b>
        <small>PIN</small>${pinMostrar ? `<div class="pa-pin">${esc(pinMostrar)}</div>` : `<div class="pa-sinpin">🔒 Guardado en secreto<br><button type="button" class="tx-btn tx-btn-sm" data-pc-pin="${esc(clienteId)}">🔑 Crear PIN nuevo</button></div>`}
        <small>Enlace</small><div class="pa-url">${esc(url)}</div>
      </div>
    </div>
    ${pin ? '<div class="pa-aviso">⚠️ Envíalo ahora: por seguridad el PIN no se vuelve a mostrar. Si se pierde, crea uno nuevo con un toque.</div>' : ''}
    <div class="pa-botones">
      ${tel ? `<a class="tx-btn tx-btn-ok pa-wa" href="https://wa.me/${tel}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">📲 Enviar por WhatsApp</a>`
            : `<a class="tx-btn tx-btn-ok pa-wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">📲 Elegir chat de WhatsApp</a>`}
      <button type="button" class="tx-btn" data-pc-copiar>📋 Copiar mensaje</button>
      <button type="button" class="tx-btn" data-pc-imprimir>🖨️ Imprimir tarjeta con QR</button>
      <a class="tx-btn" href="${esc(url)}" target="_blank" rel="noopener">👁 Ver como mi cliente</a>
    </div>
    ${tel ? '' : '<div class="tx-ayuda" style="margin-top:8px">Este cliente no tiene teléfono guardado: WhatsApp te dejará elegir el chat.</div>'}`;
  TX.abrir('pc-modal-acceso');
}
function imprimirTarjeta() {
  const u = PC.ultimo; if (!u) return;
  const logo = TX.empresaConfig?.logo_principal_url;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Acceso · ${esc(nombreCli(u.c))}</title><style>
    body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:0;display:flex;justify-content:center;padding:30px;color:#111}
    .t{width:340px;border:2px solid #111;border-radius:20px;padding:24px;text-align:center}
    img.l{max-width:120px;max-height:60px;object-fit:contain}.n{font-size:18px;font-weight:800;margin:6px 0 2px}.s{color:#555;font-size:13px}
    .q svg{width:220px;height:220px;margin:16px auto 6px;display:block}.p{font-size:30px;font-weight:900;letter-spacing:.3em;margin:6px 0}
    .c{font-size:12px;color:#555;word-break:break-all;margin-top:10px}.k{font-size:13px;font-weight:700;margin-top:6px}
    @media print{body{padding:0}}</style></head><body><div class="t">
    ${logo ? `<img class="l" src="${esc(logo)}" alt="">` : ''}<div class="n">${esc(negocio())}</div><div class="s">Seguimiento de sus viajes · ${esc(nombreCli(u.c))}</div>
    <div class="q">${qrSvg(u.url, 6)}</div><div class="k">Escanee el código y escriba su PIN</div>
    ${u.pin ? `<div class="p">${esc(u.pin)}</div>` : '<div class="s">PIN: el que le enviamos</div>'}
    <div class="c">${esc(u.url)}</div></div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { TX.toast('Tu navegador bloqueó la ventana. Usa “Copiar mensaje” o WhatsApp.', 'error'); return; }
  w.document.write(html); w.document.close();
}

/* ---------------- acciones ---------------- */
async function darAcceso(clienteId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }
  const r = await rpc('tx_portal_gestionar', { p_cliente: clienteId, p_accion: 'crear' });
  if (!r.ok) { TX.toast(r.msg, 'error'); if (btn) { btn.disabled = false; btn.textContent = '🔗 Dar acceso'; } return; }
  await recargarAccesos();
  mostrarAcceso(clienteId, r.token, r.pin, '✅ ¡Acceso listo! Envíaselo a tu cliente');
}
async function recargarAccesos() { const acc = await rpc('tx_portal_lista'); if (acc.ok) PC.accesos = acc.accesos || []; renderKpis(); renderLista(); }
async function accion(clienteId, acc, extra) {
  const r = await rpc('tx_portal_gestionar', Object.assign({ p_cliente: clienteId, p_accion: acc }, extra || {}));
  if (!r.ok) { const e = $('po-error'); if (e && $('pc-modal-opc').classList.contains('open')) e.textContent = r.msg; else TX.toast(r.msg, 'error'); return null; }
  await recargarAccesos(); return r;
}
function abrirOpciones(clienteId) {
  const c = PC.clientes.find(x => x.id === clienteId), a = accesoDe(clienteId); if (!c || !a) return;
  $('po-titulo').textContent = `Acceso de ${nombreCli(c)}`; $('po-error').textContent = '';
  $('po-cuerpo').innerHTML = `
    <div class="po-est">${estadoHtml(a)}${a.ingresos ? ` <small class="pc-ult">· ${a.ingresos} visita${a.ingresos === 1 ? '' : 's'}</small>` : ''}</div>
    <div class="po-sec">Qué ve este cliente</div>
    <label class="po-sw"><input type="checkbox" id="po-placa" ${a.mostrar_placa ? 'checked' : ''}><span><b>Placa de la unidad</b><small>Cabezal y furgón del viaje</small></span></label>
    <label class="po-sw"><input type="checkbox" id="po-cond" ${a.mostrar_conductor ? 'checked' : ''}><span><b>Nombre del conductor</b><small>Quién maneja su viaje</small></span></label>
    <div class="po-sec">PIN y enlace</div>
    <div class="po-fila"><input class="tx-in" id="po-pin" inputmode="numeric" maxlength="6" placeholder="PIN propio (opcional, 4–6 números)"><button type="button" class="tx-btn" data-pc-pin="${esc(clienteId)}">🔑 Nuevo PIN</button></div>
    <div class="tx-ayuda">Déjalo vacío y el sistema crea uno al azar. El PIN anterior deja de servir.</div>
    <button type="button" class="tx-btn po-ancho" data-pc-enlace="${esc(clienteId)}">🔄 Cambiar enlace (el anterior deja de servir)</button>
    <button type="button" class="tx-btn tx-btn-danger po-ancho" data-pc-apagar="${esc(clienteId)}">⏻ Apagar acceso</button>`;
  const guardarOpc = async () => {
    await accion(clienteId, 'opciones', { p_opciones: { mostrar_placa: $('po-placa').checked, mostrar_conductor: $('po-cond').checked } });
    TX.toast('Listo: se actualizó lo que ve tu cliente');
  };
  $('po-placa').addEventListener('change', guardarOpc); $('po-cond').addEventListener('change', guardarOpc);
  $('po-pin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
  TX.abrir('pc-modal-opc');
}
async function nuevoPin(clienteId) {
  const propio = $('pc-modal-opc').classList.contains('open') ? ($('po-pin')?.value || '').trim() : '';
  if (propio && !/^\d{4,6}$/.test(propio)) { $('po-error').textContent = 'El PIN debe tener de 4 a 6 números.'; return; }
  const r = await accion(clienteId, 'nuevo_pin', propio ? { p_pin: propio } : null); if (!r) return;
  TX.cerrar('pc-modal-opc');
  mostrarAcceso(clienteId, r.token, r.pin, '🔑 PIN nuevo listo: envíaselo a tu cliente');
}
async function nuevoEnlace(clienteId) {
  if (!await TX.confirmar('¿Cambiar el enlace?', 'El enlace anterior dejará de funcionar al instante. Tendrás que enviarle el nuevo a tu cliente (el PIN sigue igual).', 'Cambiar enlace')) return;
  const r = await accion(clienteId, 'nuevo_enlace'); if (!r) return;
  TX.cerrar('pc-modal-opc'); mostrarAcceso(clienteId, r.token, null, '🔄 Enlace nuevo listo');
}
async function apagar(clienteId) {
  if (!await TX.confirmar('¿Apagar el acceso?', 'Tu cliente ya no podrá ver sus viajes. Puedes volver a encenderlo cuando quieras.', 'Apagar', true)) return;
  if (await accion(clienteId, 'apagar')) { TX.cerrar('pc-modal-opc'); TX.toast('Acceso apagado'); }
}

function enlazar() {
  $('pc-q').addEventListener('input', e => { PC.q = e.target.value; renderLista(); });
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-pc-f],[data-pc-dar],[data-pc-enviar],[data-pc-opc],[data-pc-encender],[data-pc-pin],[data-pc-enlace],[data-pc-apagar],[data-pc-copiar],[data-pc-imprimir]');
    if (!t) return; const d = t.dataset;
    if (d.pcF) { PC.filtro = d.pcF; renderLista(); }
    else if (d.pcDar) darAcceso(d.pcDar, t);
    else if (d.pcEnviar) { const a = accesoDe(d.pcEnviar); if (a) mostrarAcceso(d.pcEnviar, a.token, null); }
    else if (d.pcOpc) abrirOpciones(d.pcOpc);
    else if (d.pcEncender) { const r = await accion(d.pcEncender, 'encender'); if (r) { TX.toast('Acceso encendido'); mostrarAcceso(d.pcEncender, r.token, null); } }
    else if (d.pcPin) { if ($('pc-modal-acceso').classList.contains('open') && !$('pc-modal-opc').classList.contains('open')) TX.cerrar('pc-modal-acceso'); nuevoPin(d.pcPin); }
    else if (d.pcEnlace) nuevoEnlace(d.pcEnlace);
    else if (d.pcApagar) apagar(d.pcApagar);
    else if ('pcCopiar' in d) {
      try { await navigator.clipboard.writeText(PC.ultimo.msg); TX.toast('Mensaje copiado: pégalo en WhatsApp o correo'); }
      catch (_) { TX.toast('No se pudo copiar. Mantén presionado el enlace para copiarlo.', 'error'); }
    }
    else if ('pcImprimir' in d) imprimirTarjeta();
  });
}

/* estilos propios (solo de esta pantalla) */
(function estilos() {
  const css = `
  .pc-pasos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:10px}
  .pc-pasos>div{background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;padding:14px 14px 12px;position:relative;min-width:0}
  .pc-pasos span{display:inline-flex;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;font-size:13px;align-items:center;justify-content:center;margin-bottom:6px}
  .pc-pasos b{display:block;font-size:14px;color:var(--text-primary)}.pc-pasos small{display:block;font-size:12.5px;color:var(--text-secondary);margin-top:2px;line-height:1.45}
  .pc-ve{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--text-secondary);background:var(--accent-soft);border-radius:12px;padding:10px 12px;margin-bottom:16px}
  .pc-barra{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.pc-barra .tx-in{flex:1;min-width:200px}
  .pc-lista{display:flex;flex-direction:column;gap:10px}
  .pc-fila{display:flex;align-items:center;gap:12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;padding:12px 14px}
  .pc-av{width:42px;height:42px;border-radius:12px;background:var(--accent-soft);color:var(--accent);font-weight:800;font-size:17px;display:flex;align-items:center;justify-content:center;flex:none}
  .pc-info{flex:1;min-width:0}.pc-info>b{display:block;font-size:14.5px;color:var(--text-primary);overflow-wrap:anywhere}
  .pc-info>small{display:block;font-size:12.5px;color:var(--text-secondary)}.pc-cur{color:var(--accent);font-weight:700}
  .pc-est{margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.pc-ult{font-size:12px;color:var(--text-muted)}
  .pc-acc{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  .pc-otros{margin-top:14px}.pc-otros summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--text-secondary);padding:8px 2px;margin-bottom:8px}
  .pa-tarjeta{display:flex;gap:16px;align-items:center;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:16px;padding:14px}
  .pa-qr{background:#fff;border-radius:12px;padding:8px;flex:none;line-height:0}.pa-qr svg{width:150px;height:150px}
  .pa-datos{min-width:0;display:flex;flex-direction:column;gap:2px}.pa-datos small{font-size:11.5px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:6px}
  .pa-datos b{font-size:15px;overflow-wrap:anywhere}.pa-pin{font-size:30px;font-weight:900;letter-spacing:.28em;color:var(--accent);font-variant-numeric:tabular-nums}
  .pa-sinpin{font-size:13px;color:var(--text-secondary);display:flex;flex-direction:column;gap:6px;align-items:flex-start}
  .pa-url{font-size:12px;color:var(--text-secondary);word-break:break-all;font-family:'JetBrains Mono',monospace}
  .pa-aviso{margin-top:10px;font-size:12.5px;background:var(--warning-soft);color:var(--warning);border-radius:10px;padding:8px 11px;font-weight:600}
  .pa-botones{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.pa-botones .tx-btn{justify-content:center;text-decoration:none;min-height:44px}.pa-wa{grid-column:1/-1;font-size:15px;background:#16a34a!important;border-color:#16a34a!important;color:#fff!important;font-weight:800}
  .po-est{margin-bottom:6px}.po-sec{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin:16px 0 8px}
  .po-sw{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:12px;margin-bottom:8px;cursor:pointer}
  .po-sw input{width:20px;height:20px;accent-color:var(--accent);flex:none}.po-sw b{display:block;font-size:14px}.po-sw small{display:block;font-size:12px;color:var(--text-secondary)}
  .po-fila{display:flex;gap:8px}.po-fila .tx-in{flex:1;min-width:0}.po-ancho{width:100%;justify-content:center;margin-top:8px;min-height:42px}
  .pc-guia>summary{cursor:pointer;font-size:13.5px;font-weight:700;color:var(--text-secondary);padding:6px 2px 10px;list-style-position:inside}
  @media (max-width:720px){.pc-pasos{grid-template-columns:1fr;gap:8px}.pc-pasos>div{display:grid;grid-template-columns:26px 1fr;column-gap:10px;padding:10px 12px}.pc-pasos span{grid-row:span 2;margin:0}.pc-fila{flex-wrap:wrap}.pc-acc{width:100%;justify-content:stretch}.pc-acc .tx-btn{flex:1;justify-content:center;min-height:42px}
    .pa-tarjeta{flex-direction:column;text-align:center}.pa-datos{align-items:center}.pa-botones{grid-template-columns:1fr}}`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();

window.PC = PC;
document.addEventListener('DOMContentLoaded', () => {
  TX.init(async () => {
    enlazar(); await cargarTodo(); renderTodo();
    const c = new URLSearchParams(location.search).get('cliente');
    if (c) { const a = accesoDe(c); if (a && a.activo) mostrarAcceso(c, a.token, null); else if (!a) darAcceso(c); }
  });
});
