/* =====================================================
   MENSAJERIA-BASE.JS — NEGOCIO360 · Mensajería / Delivery (lo común)
   Se carga DESPUÉS de taller-base.js (conexión, tema, menú, avisos,
   arranque) y le indica que la opción a revisar es la de Mensajería.
   Aquí: estados, mensajes claros, llamadas al servidor (msj_*),
   enlaces de Waze / Google Maps / WhatsApp, y las ventanas
   "Entregado" (con foto) y "No se pudo entregar" que usan el
   despacho y la pantalla del repartidor.
   Todo cambio de datos pasa por funciones del servidor (msj_*).
===================================================== */
'use strict';
window.TL_FLAG = 'usa_modulo_mensajeria';
window.TL_APAGADO = { i: '🛵', t: 'Mensajería está apagada', d: 'Actívala en <b>Configuración → Mensajería / Delivery</b> para empezar a registrar envíos.' };

const MS_ESTADOS = {
  por_recoger: { t: 'Por recoger', i: '📍' }, en_bodega: { t: 'En bodega', i: '🏬' }, asignado: { t: 'Asignado', i: '🧑' },
  en_ruta: { t: 'En ruta', i: '🛵' }, entregado: { t: 'Entregado', i: '✅' }, no_entregado: { t: 'No entregado', i: '⚠️' },
  devuelto: { t: 'Devuelto', i: '↩️' }, cancelado: { t: 'Cancelado', i: '✖️' },
};
const MS_ACTIVOS = ['por_recoger', 'en_bodega', 'asignado', 'en_ruta', 'no_entregado'];
const MS_TAMANOS = { pequeno: 'Pequeño', mediano: 'Mediano', grande: 'Grande' };
const MS_VEHICULOS = { moto: '🏍️ Moto', bicicleta: '🚲 Bicicleta', carro: '🚗 Carro', camioneta: '🛻 Camioneta', a_pie: '🚶 A pie' };
const MS_MOTIVOS_NO = ['No estaba nadie', 'No contesta el teléfono', 'Dirección incorrecta o incompleta', 'Rechazó el paquete', 'Pidió otra fecha'];

const MS_MOTIVOS = {
  sesion: 'Tu sesión terminó. Vuelve a entrar.', desactivado: 'Mensajería está apagada. Actívala en Configuración.',
  valor: 'Revisa los números: no pueden ser negativos.', nombre: 'Escribe el nombre (mínimo 2 letras).',
  nombre_duplicado: 'Ya existe uno con ese nombre.', no_existe: 'No se encontró el registro. Recarga la pantalla.',
  cliente: 'Ese comercio no existe en tu negocio.', zona: 'Esa zona no existe.', perfil: 'Ese usuario no existe en tu negocio.',
  perfil_usado: 'Ese usuario ya está ligado a otro repartidor.', con_envios: 'Ese repartidor tiene envíos asignados o en ruta. Reasígnalos primero.',
  remitente: 'Escribe quién envía (o elige el comercio).', destinatario: 'Escribe a quién va el envío.', direccion: 'Escribe la dirección de entrega.',
  ubicacion: 'La ubicación no es válida. Pega el enlace de Google Maps o escribe “latitud, longitud”.',
  no_editable: 'Ese envío ya salió a ruta o terminó: ya no se puede cambiar.', sin_seleccion: 'Elige al menos un envío.',
  repartidor: 'Elige un repartidor.', repartidor_inactivo: 'Ese repartidor está desactivado.',
  cambiaron: 'Algo cambió desde otra pantalla. Actualiza e intenta de nuevo.',
  transicion: 'Ese cambio no está permitido desde el estado actual del envío.', falta_motivo: 'Escribe el motivo.',
  usar_entregar: 'Usa el botón “Entregado”.', sin_repartidor: 'El envío no tiene repartidor.', recibio: 'Escribe quién recibió el paquete.',
  foto: 'La foto no se pudo usar. Tómala de nuevo.', metodo: 'Elige cómo pagó: efectivo o transferencia.',
  nada_por_cuadrar: 'Ese repartidor no tiene entregas pendientes de cuadrar.', abono_mayor: 'El abono es mayor que lo que debe.',
  cod_sin_comercio: 'Para cobrar contra entrega, quien envía debe estar registrado como comercio (cliente): así se le liquida su dinero.',
  ya_cobrado: 'Ese envío ya se cobró: no se puede cancelar. Si hay que devolver el dinero, anula la venta en Ventas.',
  no_cobrable: 'Ese envío no se puede cobrar aquí (lo paga quien recibe, ya se liquidó o está cancelado).', total_cero: 'El monto a cobrar es cero.',
  banco: 'Elige el banco donde entró la transferencia.', banco_transfer: 'Hay envíos pagados por transferencia: elige el banco donde entraron.',
  nada_por_liquidar: 'Ese comercio no tiene envíos listos para liquidar.', nada_por_pagar: 'Ese repartidor no tiene entregas por pagar.',
  sin_forma_pago: 'Ese repartidor no tiene forma de pago. Configúrala en Repartidores.', pago: 'La forma de pago no es válida (el porcentaje va de 0 a 100).',
  descuento: 'Lo que se descuenta no puede pasar de lo que debe ni de lo que se le paga.', version: 'Actualiza la página (hay una versión nueva).',
  sin_filas: 'El archivo no tiene envíos.', muchas_filas: 'Máximo 300 envíos por carga. Divide el archivo.',
};
function msMensaje(r) {
  if (!r) return 'No se pudo completar la acción.';
  if (r.motivo === 'no_asignable') return `El envío ${r.numero} ya no se puede asignar (salió a ruta o terminó).`;
  if (r.motivo === 'abono_mayor') return `El abono es mayor que lo que debe (${fmt(r.deuda)}).`;
  if (r.motivo === 'fila') return `Fila ${r.fila}: ${MS_MOTIVOS[r.detalle] || 'tiene un dato que no es válido.'} No se cargó ningún envío.`;
  if (r.motivo === 'descuento') return `Lo que se descuenta no puede pasar de lo que debe (${fmt(r.deuda)}) ni de lo que se le paga.`;
  return MS_MOTIVOS[r.motivo] || 'No se pudo completar la acción.';
}
// Llama una función del servidor. Devuelve {ok:true,...} o {ok:false,msg}. Nunca lanza.
async function msRpc(nombre, args) {
  try {
    const { data, error } = await sb.rpc(nombre, args);
    if (error) { console.warn(nombre, error); return { ok: false, msg: 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.' }; }
    if (!data || data.ok !== true) return { ...(data || {}), ok: false, msg: msMensaje(data) };
    return data;
  } catch (e) { console.warn(nombre, e); return { ok: false, msg: 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.' }; }
}
// Quién hace la acción: el usuario que entró con su código, o el nombre de la cuenta.
function msPerfil() { try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); return pf && pf.id ? pf : null; } catch (_) { return null; } }
function msPor() { const pf = msPerfil(); return String((pf && pf.nombre) || TL.nombre || 'Usuario').slice(0, 120); }

function msChip(estado) { const e = MS_ESTADOS[estado] || { t: estado, i: '' }; return `<span class="ms-chip ${esc(estado)}">${e.i} ${esc(e.t)}</span>`; }
// Lo que el repartidor debe cobrar al entregar: contra entrega + la tarifa si la paga quien recibe.
function msPorCobrar(e) { return Number(e.monto_cobrar || 0) + (e.envio_lo_paga === 'destinatario' ? Number(e.tarifa || 0) + Number(e.recargo_reintentos || 0) : 0); }
function msTelDigitos(t) { let d = String(t || '').replace(/\D/g, ''); if (d.length === 8) d = '505' + d; return d; }
function msWa(tel, texto) { const d = msTelDigitos(tel); return d ? `https://wa.me/${d}${texto ? '?text=' + encodeURIComponent(texto) : ''}` : ''; }
function msMaps(e) {
  if (e.lat != null && e.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.direccion, e.referencia, e.zona_nombre].filter(Boolean).join(', '))}`;
}
function msWaze(e) {
  if (e.lat != null && e.lng != null) return `https://waze.com/ul?ll=${e.lat},${e.lng}&navigate=yes`;
  return `https://waze.com/ul?q=${encodeURIComponent([e.direccion, e.zona_nombre].filter(Boolean).join(', '))}&navigate=yes`;
}
// Ubicación: acepta "12.13, -86.25" o un enlace de Google Maps que la traiga.
function msLeerUbicacion(txt) {
  const s = String(txt || '').trim(); if (!s) return { lat: null, lng: null, ok: true };
  const m = s.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || s.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return { ok: false };
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return { ok: false };
  return { lat, lng, ok: true };
}
const msHora = d => d ? new Date(d).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }) : '';
function msHoyISO() { return ymd(new Date()); }

// Listas que usan varias pantallas.
async function msZonas(soloActivas) {
  let q = sb.from('mensajeria_zonas').select('id,nombre,tarifa,notas,activo').eq('auth_user_id', TL.userId).order('nombre');
  if (soloActivas) q = q.eq('activo', true);
  const { data } = await q; return data || [];
}
// Ubicación del repartidor (GPS del celular, gratis): "hace X min". El mapa en vivo está en mensajeria-mapa.js.
function msHace(d) {
  if (!d) return ''; const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : `hace ${Math.floor(m / 1440)} d`;
}
async function msRepartidores(soloActivos) {
  let q = sb.from('mensajeria_repartidores').select('*').eq('auth_user_id', TL.userId).order('nombre');
  if (soloActivos) q = q.eq('activo', true);
  const { data } = await q; return data || [];
}
async function msComercios() {
  const out = [];
  for (let desde = 0; desde < 5000; desde += 1000) {
    const { data } = await sb.from('clientes').select('id,nombre,apellido,telefono,direccion').eq('auth_user_id', TL.userId).eq('activo', true).order('nombre').range(desde, desde + 999);
    out.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return out.map(c => ({ ...c, completo: [c.nombre, c.apellido].filter(Boolean).join(' ') }));
}
async function msConfig() {
  const { data } = await sb.from('mensajeria_config').select('*').eq('auth_user_id', TL.userId).maybeSingle();
  return data || { recargo_urgente: 0, recargo_grande: 0, recargo_reintento: 0, tope_efectivo: 0 };
}
// Efectivo en la calle por repartidor: lo cobrado en efectivo en entregas aún sin cuadrar.
async function msEfectivoEnMano() {
  const { data } = await sb.from('mensajeria_envios').select('repartidor_id,cobrado_cod,cobrado_envio').eq('auth_user_id', TL.userId)
    .eq('estado', 'entregado').is('cuadre_id', null).eq('metodo_cobro', 'efectivo').limit(5000);
  const m = {}; (data || []).forEach(e => { m[e.repartidor_id] = (m[e.repartidor_id] || 0) + Number(e.cobrado_cod || 0) + Number(e.cobrado_envio || 0); });
  return m;
}
function msTope(rep, cfg) { const t = rep && rep.tope_efectivo != null ? Number(rep.tope_efectivo) : Number(cfg?.tope_efectivo || 0); return t > 0 ? t : 0; }

/* ---------- Bancos y el selector "¿Cómo se pagó?" (efectivo o transferencia a un banco) ---------- */
let MS_BANCOS = null;
async function msBancos() {
  if (MS_BANCOS) return MS_BANCOS;
  const { data } = await sb.from('bancos').select('id,nombre,moneda').eq('auth_user_id', TL.userId).eq('activo', true).order('nombre');
  MS_BANCOS = data || []; return MS_BANCOS;
}
// Devuelve el HTML de un selector; leer con msMetodoLeer(contenedor, id).
function msMetodoHTML(id, titulo, opciones = {}) {
  const bancos = MS_BANCOS || [];
  return `<div class="tl-f ms-metodo" data-metodo="${id}"><label>${titulo}</label>
    <div class="ms-opciones" role="radiogroup" aria-label="${esc(titulo.replace(/<[^>]+>/g, ''))}">
      <button type="button" class="ms-opcion${opciones.inicial !== 'transferencia' ? ' activa' : ''}" data-m="efectivo" role="radio">💵 Efectivo</button>
      <button type="button" class="ms-opcion${opciones.inicial === 'transferencia' ? ' activa' : ''}" data-m="transferencia" role="radio">🏦 Transferencia</button></div>
    <select class="tl-sel" data-banco style="margin-top:6px;${opciones.inicial === 'transferencia' ? '' : 'display:none'}" aria-label="Banco">
      <option value="">${bancos.length ? 'Elige el banco…' : 'No tienes bancos: créalos en Caja → Bancos'}</option>${bancos.map(b => `<option value="${b.id}">${esc(b.nombre)}${b.moneda && b.moneda !== 'NIO' ? ' (' + esc(b.moneda) + ')' : ''}</option>`).join('')}</select></div>`;
}
function msMetodoActivar(cont) {
  cont.querySelectorAll('.ms-metodo').forEach(w => w.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    w.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('activa', x === b));
    w.querySelector('[data-banco]').style.display = b.dataset.m === 'transferencia' ? '' : 'none';
  }));
}
function msMetodoLeer(cont, id) {
  const w = cont.querySelector(`.ms-metodo[data-metodo="${id}"]`); if (!w) return { metodo: 'efectivo', banco_id: null };
  const m = w.querySelector('[data-m].activa')?.dataset.m || 'efectivo';
  return { metodo: m, banco_id: m === 'transferencia' ? (w.querySelector('[data-banco]').value || null) : null };
}
// Abre una hoja para imprimir o guardar como PDF.
function msImprimir(titulo, cuerpo) {
  const w = window.open('', '_blank', 'width=720,height=860');
  if (!w) { showToast('Permite las ventanas emergentes para imprimir.', 'warning'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:20px;font-size:13px}h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:16px 0 6px}
    table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#555}
    .n{text-align:right;white-space:nowrap}.tot td{font-weight:700;border-top:2px solid #111}.muted{color:#666;font-size:12px}.caja{border:2px solid #111;border-radius:8px;padding:10px;margin-top:12px;font-size:15px;font-weight:700}
    @media print{button{display:none}}</style></head><body>${cuerpo}<p><button onclick="window.print()">Imprimir / Guardar PDF</button></p></body></html>`);
  w.document.close();
}

/* ---------- Ventana genérica ---------- */
function msVentana(id, titulo, cuerpo, pie, ancho) {
  let m = document.getElementById(id);
  if (!m) { m = document.createElement('div'); m.id = id; m.className = 'tl-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); document.body.appendChild(m); }
  m.innerHTML = `<div class="tl-modal-box" style="max-width:${ancho || 560}px"><div class="tl-modal-cab"><h2>${titulo}</h2><button type="button" class="tl-x" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo">${cuerpo}</div><div class="tl-modal-pie">${pie}</div></div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => m.classList.remove('abierto'));
  m.classList.add('abierto');
  return m;
}

/* ---------- Foto de entrega: se achica en el teléfono y se guarda en la carpeta privada del negocio ---------- */
function msAchicarFoto(file, lado = 1100) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('foto')), 'image/webp', 0.78);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('foto')); };
    img.src = url;
  });
}
async function msSubirFoto(envioId, blob) {
  const ruta = `${TL.userId}/${envioId}_${Date.now()}.webp`;
  const { error } = await sb.storage.from('mensajeria-pruebas').upload(ruta, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  return ruta;
}
async function msVerFoto(ruta) {
  try { const { data } = await sb.storage.from('mensajeria-pruebas').createSignedUrl(ruta, 600); return data?.signedUrl || ''; } catch (_) { return ''; }
}

/* ---------- Entregado: quién recibió, cómo pagó y foto (opcional) ---------- */
function msEntregar(e, alTerminar) {
  const cobrar = msPorCobrar(e);
  const st = { metodo: cobrar > 0 ? null : '', foto: null, ocupado: false };
  const cuerpo = `<div class="ms-linea">📦 <span><b>${esc(e.numero)}</b> · ${esc(e.destinatario_nombre)}<br>${esc(e.direccion)}</span></div>
    ${cobrar > 0 ? `<div class="tl-sec"><b>💵 Cobrar ${fmt(cobrar)}</b>
      <span class="tl-muted">${Number(e.monto_cobrar) > 0 ? 'Producto (contra entrega): ' + fmt(e.monto_cobrar) : ''}${Number(e.monto_cobrar) > 0 && cobrar > Number(e.monto_cobrar) ? ' · ' : ''}${cobrar > Number(e.monto_cobrar) ? 'Envío: ' + fmt(cobrar - Number(e.monto_cobrar)) : ''}</span>
      <div class="ms-opciones" role="radiogroup" aria-label="Cómo pagó"><button type="button" class="ms-opcion" data-met="efectivo" role="radio" aria-checked="false">💵 Efectivo</button><button type="button" class="ms-opcion" data-met="transferencia" role="radio" aria-checked="false">🏦 Transferencia</button></div></div>`
      : '<div class="tl-aviso ok">Este envío no lleva cobro.</div>'}
    <div class="tl-f"><label for="msx-rec">¿Quién recibió? *</label><input class="tl-inp" id="msx-rec" maxlength="160" autocomplete="off" value="${esc(e.destinatario_nombre)}"></div>
    <div class="tl-f"><label for="msx-foto">📷 Foto de la entrega <span class="tl-muted">(opcional, recomendada)</span></label>
      <input class="tl-inp" id="msx-foto" type="file" accept="image/*" capture="environment"><img id="msx-prev" class="ms-foto-prev" alt="Foto de la entrega" style="display:none"></div>
    <div id="msx-av"></div>`;
  const m = msVentana('msx-entregar', '✅ Entregado', cuerpo, '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="msx-ok">Confirmar entrega</button>', 520);
  m.querySelectorAll('[data-met]').forEach(b => b.onclick = () => {
    st.metodo = b.dataset.met; m.querySelectorAll('[data-met]').forEach(x => { x.classList.toggle('activa', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
  });
  m.querySelector('#msx-foto').onchange = async ev => {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    try { st.foto = await msAchicarFoto(f); const p = m.querySelector('#msx-prev'); p.src = URL.createObjectURL(st.foto); p.style.display = ''; }
    catch (_) { st.foto = null; m.querySelector('#msx-av').innerHTML = '<div class="tl-aviso">No se pudo leer esa foto. Intenta con otra.</div>'; }
  };
  m.querySelector('#msx-ok').onclick = async () => {
    if (st.ocupado) return;
    const av = m.querySelector('#msx-av'), rec = m.querySelector('#msx-rec').value.trim();
    if (rec.length < 2) { av.innerHTML = '<div class="tl-aviso">Escribe quién recibió el paquete.</div>'; return; }
    if (cobrar > 0 && !st.metodo) { av.innerHTML = '<div class="tl-aviso">Elige cómo pagó: efectivo o transferencia.</div>'; return; }
    st.ocupado = true; const btn = m.querySelector('#msx-ok'); btn.disabled = true; btn.textContent = 'Guardando…';
    let ruta = null;
    if (st.foto) { try { ruta = await msSubirFoto(e.id, st.foto); } catch (err) { console.warn(err); av.innerHTML = '<div class="tl-aviso">No se pudo subir la foto. Se guarda la entrega sin foto.</div>'; } }
    const r = await msRpc('msj_envio_entregar', { p_id: e.id, p: { recibio_nombre: rec, metodo_cobro: st.metodo || null, foto_path: ruta, por: msPor() } });
    st.ocupado = false; btn.disabled = false; btn.textContent = 'Confirmar entrega';
    if (!r.ok) { av.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
    m.classList.remove('abierto'); showToast(r.ya ? 'Ese envío ya estaba entregado.' : `✅ ${e.numero} entregado`);
    alTerminar && alTerminar();
  };
  setTimeout(() => { const i = m.querySelector('#msx-rec'); if (i && !m.contains(document.activeElement)) i.focus(); }, 60);
}

/* ---------- No se pudo entregar: motivo ---------- */
function msNoEntregado(e, alTerminar) {
  const cuerpo = `<div class="ms-linea">📦 <span><b>${esc(e.numero)}</b> · ${esc(e.destinatario_nombre)}</span></div>
    <div class="ms-opciones">${MS_MOTIVOS_NO.map(t => `<button type="button" class="ms-opcion" data-mot="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="tl-f"><label for="msn-otro">Otro motivo o detalle</label><input class="tl-inp" id="msn-otro" maxlength="250" autocomplete="off"></div>
    <div class="tl-muted">El envío vuelve a la oficina para reintentar o devolverlo al remitente.</div><div id="msn-av"></div>`;
  const m = msVentana('msn-no', '⚠️ No se pudo entregar', cuerpo, '<button type="button" class="btn-secondary" data-cerrar>Cancelar</button><button type="button" class="btn-primary" id="msn-ok">Guardar</button>', 520);
  let elegido = '';
  m.querySelectorAll('[data-mot]').forEach(b => b.onclick = () => { elegido = b.dataset.mot; m.querySelectorAll('[data-mot]').forEach(x => x.classList.toggle('activa', x === b)); });
  m.querySelector('#msn-ok').onclick = async () => {
    const otro = m.querySelector('#msn-otro').value.trim(); const motivo = [elegido, otro].filter(Boolean).join(' · ');
    if (motivo.length < 3) { m.querySelector('#msn-av').innerHTML = '<div class="tl-aviso">Elige o escribe el motivo.</div>'; return; }
    const btn = m.querySelector('#msn-ok'); btn.disabled = true;
    let r = { ok: true };
    if (e.estado === 'asignado') r = await msRpc('msj_envio_estado', { p_id: e.id, p_nuevo: 'en_ruta', p_motivo: null, p_por: msPor() });
    if (r.ok) r = await msRpc('msj_envio_estado', { p_id: e.id, p_nuevo: 'no_entregado', p_motivo: motivo, p_por: msPor() });
    btn.disabled = false;
    if (!r.ok) { m.querySelector('#msn-av').innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
    m.classList.remove('abierto'); showToast(`⚠️ ${e.numero}: no entregado`);
    alTerminar && alTerminar();
  };
}

/* ---------- Etiqueta para pegar en el paquete ---------- */
// Enlace público para que quien espera el paquete vea dónde va (sin cuenta).
function msRastreoUrl(e) { return e && e.rastreo_token ? new URL('rastreo.html#t=' + e.rastreo_token, location.href).href : ''; }
// QR como dibujo (SVG) hecho en el equipo: el enlace no se manda a ningún servicio de afuera.
function msQrSvg(texto, celda = 3) {
  try { if (typeof qrcode === 'undefined' || !texto) return ''; const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag(celda, 0); } catch (_) { return ''; }
}
function msEtiquetaHTML(e) {
  const cobrar = msPorCobrar(e), qr = msQrSvg(msRastreoUrl(e));
  return `<div class="et"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="n">${esc(e.numero)}</span><span style="text-align:right">${esc(TL.empresaConfig?.nombre_comercial || '')}</span></div>
    <div class="t">Para</div><div class="v">${esc(e.destinatario_nombre)}${e.destinatario_telefono ? ' · ' + esc(e.destinatario_telefono) : ''}</div>
    <div class="t">Dirección</div><div class="v">${esc(e.direccion)}${e.referencia ? '<br><span style="font-weight:400">' + esc(e.referencia) + '</span>' : ''}</div>
    ${e.zona_nombre ? `<div class="t">Zona</div><div class="v">${esc(e.zona_nombre)}</div>` : ''}
    <div class="t">De</div><div class="v">${esc(e.remitente_nombre)}${e.remitente_telefono ? ' · ' + esc(e.remitente_telefono) : ''}</div>
    <div style="display:flex;gap:10px;align-items:flex-end;justify-content:space-between"><div><div class="t">Paquetes</div><div class="v">${Number(e.paquetes || 1)} · ${esc(MS_TAMANOS[e.tamano] || '')}${e.urgente ? ' · URGENTE' : ''}</div></div>
      ${qr ? `<div class="qr">${qr}<div style="font-size:9px;text-align:center">Rastrear</div></div>` : ''}</div>
    <div class="c">${cobrar > 0 ? 'COBRAR ' + esc(fmt(cobrar)) : 'NO COBRAR'}</div></div>`;
}
// Imprime una o varias etiquetas (una por página).
function msEtiquetas(lista) {
  if (!lista || !lista.length) { showToast('No hay envíos para imprimir.', 'warning'); return; }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas (${lista.length})</title><style>
    body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:12px;color:#000}.et{border:2px solid #000;border-radius:8px;padding:12px;max-width:380px;margin-bottom:14px;page-break-after:always;break-after:page}
    .et:last-of-type{page-break-after:auto;break-after:auto}.n{font-size:26px;font-weight:800;letter-spacing:1px}.t{font-size:11px;text-transform:uppercase;color:#444;margin-top:8px}.v{font-size:15px;font-weight:700}
    .qr svg{width:84px;height:84px;display:block}.c{margin-top:10px;border:2px dashed #000;padding:8px;font-size:18px;font-weight:800;text-align:center}@media print{button{display:none}}</style></head><body>
    ${lista.map(msEtiquetaHTML).join('')}
    <p><button onclick="window.print()">Imprimir</button></p><script>setTimeout(function(){window.print()},300)<\/script></body></html>`;
  const w = window.open('', '_blank', 'width=460,height=640');
  if (!w) { showToast('Permite las ventanas emergentes para imprimir las etiquetas.', 'warning'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
function msEtiqueta(e) { msEtiquetas([e]); }
