/* =====================================================
   TRANSPORTE-PANEL.JS — NEGOCIO360 · Panel de Transporte
   Un solo lugar para todo el transporte (igual que el Panel de
   Clínica): el inicio (cómo funciona, el ciclo del viaje con lo
   que hay en cada paso, preparar el módulo y pendientes) y cada
   parte (Órdenes, Fronteras, Entregas, Cobros, Liquidaciones,
   Subcontratistas, Mantenimiento, Reportes, Flota, Conductores,
   Rutas) se abre DENTRO del panel, sin salir de él.
   Las pantallas internas son las mismas de siempre: solo se les
   oculta su menú y su encabezado (los del panel quedan).
   Si una pantalla interna lleva a otra, también queda dentro.
   Requiere de la página: sb, TP, esc, showToast (transporte.js).
===================================================== */
'use strict';

// En orden de trabajo: el ciclo del viaje, el cierre y lo que se prepara una vez.
const TPN_SUBS = [
  { id: 'ordenes', archivo: 'transporte-ordenes.html', key: 'transporte_ordenes', icono: '📋', nombre: 'Órdenes y despacho', grupo: 'dia', desc: 'Crea la orden (cliente, ruta, carga y precio), asigna unidad y conductor, inicia el viaje y registra la entrega.' },
  { id: 'fronteras', archivo: 'transporte-fronteras.html', key: 'transporte_fronteras', icono: '🛂', nombre: 'Fronteras y documentos', grupo: 'dia', desc: 'Cruces de frontera, trámites aduaneros con su costo, carta de porte y papeles de cada viaje.' },
  { id: 'entregas', archivo: 'transporte-entregas.html', key: 'transporte_entregas', icono: '📦', nombre: 'Entregas e incidencias', grupo: 'dia', desc: 'Prueba de entrega con firma y foto, y reclamos o incidencias del viaje.' },
  { id: 'cobros', archivo: 'transporte-facturacion.html', key: 'transporte_facturacion', icono: '💳', nombre: 'Cobros', grupo: 'dia', desc: 'Cobra aquí mismo cada viaje entregado (contado o crédito) y sigue lo que te deben.' },
  { id: 'liquidaciones', archivo: 'transporte-liquidaciones.html', key: 'transporte_liquidaciones', icono: '💵', nombre: 'Pago a conductores', grupo: 'cierre', desc: 'Liquida a conductores y ayudantes por viaje, km o comisión, con anticipos y descuentos.' },
  { id: 'subcontratistas', archivo: 'transporte-subcontratistas.html', key: 'transporte_subcontratistas', icono: '🤝', nombre: 'Subcontratistas', grupo: 'cierre', desc: 'Viajes que hace otro transportista: su flete se paga de contado o queda en Cuentas por Pagar.' },
  { id: 'mantenimiento', archivo: 'transporte-mantenimiento.html', key: 'transporte_mantenimiento', icono: '🔧', nombre: 'Mantenimiento y llantas', grupo: 'cierre', desc: 'Servicios por km o fecha con aviso, órdenes del taller y control de llantas.' },
  { id: 'reportes', archivo: 'transporte-reportes.html', key: 'transporte_reportes', icono: '📈', nombre: 'Reportes', grupo: 'cierre', desc: 'Viajes, ingresos, costos y utilidad por cliente, ruta, unidad y conductor.' },
  { id: 'flota', archivo: 'flota.html', key: 'transporte_flota', icono: '🚛', nombre: 'Flota', grupo: 'base', desc: 'Cabezales, camiones, furgones y plataformas con fotos y documentos con vencimiento.' },
  { id: 'conductores', archivo: 'conductores.html', key: 'transporte_conductores', icono: '🧑‍✈️', nombre: 'Conductores', grupo: 'base', desc: 'Conductores y ayudantes con licencias, pasaporte y disponibilidad.' },
  { id: 'rutas', archivo: 'transporte-rutas.html', key: 'transporte_rutas', icono: '🗺️', nombre: 'Rutas y tarifas', grupo: 'base', desc: 'Tus recorridos con distancia y fronteras, y cuánto cobras por viaje, km o tonelada.' },
];
const TPN_GRUPOS = { dia: '☀️ Día a día (el ciclo del viaje)', cierre: '📆 Cierre (semana o mes)', base: '🧰 Lo que preparas una vez' };
// El ciclo de cada viaje, en orden.
const TPN_CICLO = [
  { n: 1, sub: 'ordenes', icono: '📋', nombre: 'Orden', ayuda: 'Cliente, ruta, carga y precio' },
  { n: 2, sub: 'ordenes', icono: '🧑‍✈️', nombre: 'Despacho', ayuda: 'Asignar unidad y conductor' },
  { n: 3, sub: 'fronteras', icono: '🚦', nombre: 'En ruta', ayuda: 'Viaje, fronteras y documentos' },
  { n: 4, sub: 'entregas', icono: '📦', nombre: 'Entrega', ayuda: 'Firma de quien recibe' },
  { n: 5, sub: 'cobros', icono: '💳', nombre: 'Cobrar', ayuda: 'Contado o crédito, aquí mismo' },
  { n: 6, sub: 'liquidaciones', icono: '💵', nombre: 'Pagar al conductor', ayuda: 'Liquidación del viaje' },
];
// Otras pantallas del sistema a las que se puede ir sin salir del panel.
const TPN_OTRAS = { 'ventas.html': '💰 Ventas', 'creditos.html': '🧾 Créditos', 'clientes.html': '👥 Clientes', 'gastos.html': '💸 Gastos', 'caja.html': '🏦 Caja',
  'cuentas-por-pagar.html': '📇 Cuentas por pagar', 'activos.html': '🏭 Activos fijos', 'salarios.html': '🧑‍💼 Salarios', 'proformas.html': '📄 Proformas',
  'productos.html': '📦 Productos/Servicios', 'reportes.html': '📊 Reportes', 'agenda.html': '📅 Agenda', 'rutas.html': '🗺️ Rutas', 'configuracion.html': '⚙️ Configuración' };

const TPN = { subs: [], actual: null, paso: null, datos: null, cargandoMarco: false };
const $t = id => document.getElementById(id);
const tpnArchivo = href => { try { return new URL(href, location.href).pathname.split('/').pop().toLowerCase(); } catch (_) { return ''; } };

function tpnIniciar() {
  TPN.subs = tpnPermitidos();
  tpnBarra();
  $t('tpn-marco').addEventListener('load', tpnAlCargar);
  window.addEventListener('hashchange', tpnSegunHash);
  window.addEventListener('popstate', tpnSegunHash);
  window.addEventListener('resize', tpnAlto);
  window.addEventListener('message', ev => {
    if (ev.source === $t('tpn-marco').contentWindow && ev.data?.tipo === 'n360_operacion_completada') showToast('✅ ' + (ev.data.nota || 'Registrado'));
  });
  tpnSegunHash();
  tpnRecorrido(false);
}
// Un usuario con permisos limitados solo ve en el panel las partes que el administrador le dio.
function tpnPermitidos() {
  let permitidos = null;
  try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.tipo !== 'admin') permitidos = new Set(pf.modulos || []); } catch (_) {}
  return TPN_SUBS.filter(s => !permitidos || permitidos.has(s.key));
}
const tpnSub = id => TPN.subs.find(s => s.id === id);

/* ---------- Barra: botón al inicio + partes en orden ---------- */
function tpnBarra() {
  $t('tpn-tabs').innerHTML = TPN.subs.map((s, i) => {
    const sep = i > 0 && TPN.subs[i - 1].grupo !== s.grupo ? '<span class="tpn-sep" aria-hidden="true"></span>' : '';
    return `${sep}<a class="tpn-tab" href="#${s.id}" data-sub="${s.id}" onclick="return tpnIrSub('${s.id}')"><span aria-hidden="true">${s.icono}</span> ${esc(s.nombre)}</a>`;
  }).join('');
}
function tpnMarcar(id, extra) {
  document.querySelectorAll('.tpn-tab').forEach(a => a.classList.toggle('activa', a.dataset.sub === id));
  $t('tpn-inicio').classList.toggle('activa', !id && !extra);
  $t('tpn-extra').textContent = extra || ''; $t('tpn-extra').style.display = extra ? '' : 'none';
  const act = document.querySelector('.tpn-tab.activa'); if (act) act.scrollIntoView({ block: 'nearest', inline: 'center' });
}
// Pasos del ciclo arriba de la pantalla interna, con "Siguiente paso".
function tpnPasos(subId, pasoN) {
  const enCiclo = TPN_CICLO.filter(p => p.sub === subId);
  if (!enCiclo.length) { $t('tpn-pasos').style.display = 'none'; return; }
  const act = TPN_CICLO.find(p => p.n === pasoN && p.sub === subId) || enCiclo[0];
  TPN.paso = act.n;
  const sig = TPN_CICLO.find(p => p.n === (act.n % TPN_CICLO.length) + 1);
  $t('tpn-pasos').style.display = '';
  $t('tpn-pasos').innerHTML = `<div class="tpn-pasos-lista">${TPN_CICLO.map(p => `<button type="button" class="tpn-paso${p.n === act.n ? ' activo' : ''}${p.n < act.n ? ' hecho' : ''}" onclick="tpnIrPaso(${p.n})" ${tpnSub(p.sub) ? '' : 'disabled'}>
      <b>${p.n}</b><span>${esc(p.nombre)}</span></button>`).join('<span class="tpn-flecha" aria-hidden="true">›</span>')}</div>
    ${sig && tpnSub(sig.sub) ? `<button type="button" class="btn-primary tpn-sig" onclick="tpnIrPaso(${sig.n})">${sig.n === 1 ? '🔁 Nuevo viaje' : 'Siguiente paso'}: ${esc(sig.nombre)} →</button>` : ''}`;
}
function tpnIrPaso(n) {
  const p = TPN_CICLO.find(x => x.n === n); if (!p || !tpnSub(p.sub)) return;
  TPN.paso = n;
  if (TPN.actual === p.sub && !TPN.cargandoMarco) { tpnPasos(p.sub, n); return; }
  if (location.hash === '#' + p.sub) tpnAbrir(p.sub, true); else location.hash = p.sub;
}

/* ---------- Navegación: #ordenes, #cobros... (el botón Atrás del teléfono también funciona) ---------- */
function tpnIrSub(id) { if (location.hash === '#' + id) tpnAbrir(id, true); else location.hash = id; return false; }
function tpnIrInicio() { if (!location.hash || location.hash === '#') tpnInicio(); else location.hash = ''; return false; }
// Desde el inicio (indicadores, accesos): una parte del transporte o cualquier otra pantalla, siempre dentro del panel.
function tpIr(href) {
  const [archivo, q] = String(href).split('?');
  const s = TPN.subs.find(x => x.archivo === archivo);
  if (s) { if (q) { location.hash = s.id + '?' + q; } else tpnIrSub(s.id); return; }
  if (TPN_SUBS.some(x => x.archivo === archivo)) { showToast('No tienes acceso a esa parte del transporte.', 'warning'); return; }
  tpnIrOtra(href);
}
function tpnSegunHash() {
  const [id, q] = decodeURIComponent(location.hash.replace(/^#/, '')).split('?');
  if (id && tpnSub(id)) tpnAbrir(id, false, q);
  else if (id !== '__otra' || TPN.actual !== '__otra') tpnInicio();
}
function tpnInicio() {
  TPN.actual = null; $t('content')?.classList.remove('tpn-dentro');
  $t('tpn-marco-wrap').style.display = 'none'; $t('tpn-pasos').style.display = 'none';
  $t('tpn-inicio-vista').style.display = '';
  tpnMarcar(null);
  tpnCargarInicio();
}
function tpnAbrir(id, forzar, consulta) {
  const s = tpnSub(id); if (!s) return tpnInicio();
  if (TPN.actual === id && !forzar && !consulta) return;
  TPN.actual = id; $t('content')?.classList.add('tpn-dentro');
  $t('tpn-inicio-vista').style.display = 'none'; $t('tpn-marco-wrap').style.display = '';
  tpnMarcar(id);
  tpnPasos(id, TPN_CICLO.some(p => p.n === TPN.paso && p.sub === id) ? TPN.paso : null);
  tpnCargando(true);
  tpnCargarMarco(s.archivo + (consulta ? '?' + consulta.replace(/^[?]/, '') : ''));
  tpnVigilar();
  tpnAlto();
}
function tpnIrOtra(archivo) {
  TPN.actual = '__otra'; $t('content')?.classList.add('tpn-dentro'); if (location.hash !== '#__otra') history.pushState(null, '', '#__otra');
  $t('tpn-inicio-vista').style.display = 'none'; $t('tpn-marco-wrap').style.display = ''; $t('tpn-pasos').style.display = 'none';
  tpnMarcar(null, TPN_OTRAS[tpnArchivo(archivo)] || '');
  tpnCargando(true); tpnCargarMarco(archivo); tpnVigilar(); tpnAlto();
}

/* ---------- La pantalla interna: se le quita su menú, su encabezado y el botón de volver al panel ---------- */
const TPN_CSS_DENTRO = `#sidebar,#sidebar-overlay,#header,.mobile-menu-btn,#n360-asistente-btn,.asis-fab,.chat-fab,a[href="transporte.html"]{display:none!important}
#main{margin-left:0!important;width:100%!important;min-height:0!important}
html,body{overflow-x:hidden}`;
function tpnPrepararDentro(doc) {
  if (!doc || !doc.documentElement || doc.documentElement.dataset.tpnDentro === '1') return false;
  doc.documentElement.dataset.tpnDentro = '1';
  const st = doc.createElement('style'); st.id = 'tpn-css-dentro'; st.textContent = TPN_CSS_DENTRO;
  (doc.head || doc.documentElement).appendChild(st);
  return true;
}
function tpnVigilar() {
  const fr = $t('tpn-marco'); let vueltas = 0;
  clearInterval(TPN.vigia);
  TPN.vigia = setInterval(() => {
    vueltas++;
    try { const doc = fr.contentDocument; if (doc && doc.location.href !== 'about:blank' && doc.documentElement) tpnPrepararDentro(doc); } catch (_) {}
    if (vueltas > 400) clearInterval(TPN.vigia);
  }, 25);
}
function tpnAlCargar() {
  const fr = $t('tpn-marco');
  let win, archivo;
  try { win = fr.contentWindow; archivo = tpnArchivo(win.location.href); } catch (_) { tpnCargando(false); return; }
  if (!archivo || win.location.href === 'about:blank') return;
  if (archivo === 'login.html' || archivo === 'index.html' || archivo === 'dashboard.html') { window.location.href = archivo === 'dashboard.html' ? 'dashboard.html' : 'login.html'; return; }
  // Si desde adentro se pidió el panel mismo, se vuelve al inicio (no un panel dentro del panel).
  if (archivo === 'transporte.html') { fr.src = 'about:blank'; tpnIrInicio(); return; }
  try { tpnPrepararDentro(fr.contentDocument); } catch (_) {}
  clearInterval(TPN.vigia);
  tpnCargando(false);
  const s = TPN.subs.find(x => x.archivo === archivo);
  if (s) {
    if (TPN.actual !== s.id) { TPN.actual = s.id; history.replaceState(null, '', '#' + s.id); tpnPasos(s.id, null); }
    tpnMarcar(s.id);
  } else { TPN.actual = '__otra'; tpnMarcar(null, TPN_OTRAS[archivo] || ''); $t('tpn-pasos').style.display = 'none'; }
  try { win.addEventListener('pagehide', () => { tpnCargando(true); tpnVigilar(); }); } catch (_) {}
  tpnAlto();
}
function tpnCargarMarco(url) {
  const fr = $t('tpn-marco');
  try { if (fr.contentWindow && fr.contentWindow.location.href !== 'about:blank') { fr.contentWindow.location.replace(url); return; } } catch (_) {}
  fr.src = url;
}
function tpnCargando(si) { TPN.cargandoMarco = si; $t('tpn-cargando').style.display = si ? 'flex' : 'none'; }
function tpnAlto() {
  const wrap = $t('tpn-marco-wrap'); if (!wrap || wrap.style.display === 'none') return;
  const top = wrap.getBoundingClientRect().top;
  wrap.style.height = Math.max(420, window.innerHeight - Math.max(0, top) - 8) + 'px';
}

/* ---------- Inicio: ciclo del viaje, preparar y pendientes ---------- */
async function tpnCargarInicio() {
  tpnPintarSubs();
  const uid = TP.userId;
  const contar = (tabla, f) => { let q = sb.from(tabla).select('id', { count: 'exact', head: true }).eq('auth_user_id', uid); q = f ? f(q) : q; return q.then(r => r.count || 0).catch(() => 0); };
  try {
    const [pend, asig, ruta, entregadasSinCobro, unidades, conductores, rutas, clientes] = await Promise.all([
      contar('transporte_ordenes', q => q.eq('estado', 'pendiente')),
      contar('transporte_ordenes', q => q.eq('estado', 'asignada')),
      contar('transporte_ordenes', q => q.eq('estado', 'en_ruta')),
      contar('transporte_ordenes', q => q.eq('estado', 'entregada').is('venta_id', null).gt('total', 0)),
      contar('transporte_unidades'), contar('transporte_conductores'), contar('transporte_rutas'),
      contar('clientes', q => q.eq('activo', true)),
    ]);
    TPN.datos = { pend, asig, ruta, entregadasSinCobro, unidades, conductores, rutas, clientes };
  } catch (e) { console.warn('inicio transporte:', e); TPN.datos = {}; }
  tpnPintarCiclo(); tpnPintarPreparar(); tpnPintarPendientes();
}
function tpnContar() {
  const d = TPN.datos || {};
  return { 1: d.pend || 0, 2: d.asig || 0, 3: d.ruta || 0, 4: d.ruta || 0, 5: d.entregadasSinCobro || 0, 6: null };
}
function tpnPintarCiclo() {
  const n = tpnContar();
  const txt = { 1: k => `${k} por asignar`, 2: k => `${k} listas para salir`, 3: k => `${k} en ruta`, 4: k => `${k} por entregar`, 5: k => `${k} por cobrar`, 6: () => 'Al cerrar el viaje' };
  $t('tpn-ciclo').innerHTML = TPN_CICLO.map(p => `<button type="button" class="tpn-ciclo-paso" onclick="tpnIrPaso(${p.n})" ${tpnSub(p.sub) ? '' : 'disabled title="No tienes acceso a esta parte"'}>
      <span class="tpn-ciclo-num">Paso ${p.n}</span><span class="tpn-ciclo-ico" aria-hidden="true">${p.icono}</span>
      <span class="tpn-ciclo-nom">${esc(p.nombre)}</span><span class="tpn-ciclo-ayuda">${esc(p.ayuda)}</span>
      <span class="tpn-badge ${n[p.n] ? 'ambar' : ''}">${esc(txt[p.n](n[p.n]))}</span></button>`).join('<span class="tpn-ciclo-flecha" aria-hidden="true">➜</span>')
    + '<div class="tpn-ciclo-vuelta" aria-hidden="true">🔁 Y vuelve a empezar con el próximo viaje</div>';
}
function tpnPintarPreparar() {
  const d = TPN.datos || {}, soloSub = TP.conf?.operacion === 'subcontratada';
  const items = [
    { ok: (d.clientes || 0) > 0, t: 'Tus clientes (los que te dan carga)', d: d.clientes ? `${d.clientes} cliente${d.clientes === 1 ? '' : 's'}.` : 'Créalos en Clientes: cada viaje se cobra a un cliente.', ir: "tpnIrOtra('clientes.html')", btn: 'Clientes' },
    { ok: soloSub || (d.unidades || 0) > 0, opc: soloSub, t: 'Tu flota', d: d.unidades ? `${d.unidades} unidad${d.unidades === 1 ? '' : 'es'}.` : soloSub ? 'Trabajas solo con subcontratistas: no hace falta.' : 'Registra tus cabezales, camiones o furgones.', ir: "tpnIrSub('flota')", btn: 'Flota' },
    { ok: soloSub || (d.conductores || 0) > 0, opc: soloSub, t: 'Tus conductores', d: d.conductores ? `${d.conductores} conductor${d.conductores === 1 ? '' : 'es'}.` : 'Registra a tus conductores y ayudantes con su licencia.', ir: "tpnIrSub('conductores')", btn: 'Conductores' },
    { ok: (d.rutas || 0) > 0, opc: true, t: 'Rutas y tarifas', d: d.rutas ? `${d.rutas} ruta${d.rutas === 1 ? '' : 's'}.` : 'Opcional: así la orden sugiere el precio solo.', ir: "tpnIrSub('rutas')", btn: 'Rutas' },
  ].filter(i => !i.ir.includes("tpnIrSub('") || tpnSub(i.ir.match(/tpnIrSub\('([^']+)'/)[1]));
  const oblig = items.filter(i => !i.opc), listos = oblig.filter(i => i.ok).length, todo = listos === oblig.length;
  $t('tpn-preparar-estado').textContent = todo ? '✅ Listo para trabajar' : `${listos} de ${oblig.length} pasos listos`;
  $t('tpn-preparar').open = !todo;
  $t('tpn-preparar-lista').innerHTML = items.map((i, k) => `<div class="tpn-prep${i.ok ? ' ok' : ''}">
      <span class="tpn-prep-ico" aria-hidden="true">${i.ok ? '✅' : i.opc ? '➖' : '⬜'}</span>
      <div class="tpn-prep-txt"><b>${k + 1}. ${esc(i.t)}${i.opc ? ' <span class="tpn-sub">(opcional)</span>' : ''}</b><span class="tpn-sub">${esc(i.d)}</span></div>
      <button type="button" class="${i.ok ? 'btn-secondary' : 'btn-primary'} tpn-btn-sm" onclick="${i.ir}">${esc(i.btn)}</button></div>`).join('');
}
function tpnPintarPendientes() {
  const n = tpnContar(), items = [];
  if (n[5] && tpnSub('cobros')) items.push({ t: `💳 ${n[5]} viaje${n[5] === 1 ? '' : 's'} entregado${n[5] === 1 ? '' : 's'} sin cobrar`, ir: 'tpnIrPaso(5)' });
  if (n[1] && tpnSub('ordenes')) items.push({ t: `📋 ${n[1]} orden${n[1] === 1 ? '' : 'es'} sin unidad ni conductor`, ir: 'tpnIrPaso(1)' });
  if (n[3] && tpnSub('entregas')) items.push({ t: `🚦 ${n[3]} viaje${n[3] === 1 ? '' : 's'} en ruta: registra la entrega al llegar`, ir: 'tpnIrPaso(4)' });
  $t('tpn-pendientes').innerHTML = items.length ? items.map(i => `<button type="button" class="tpn-pend" onclick="${i.ir}">${esc(i.t)} <span aria-hidden="true">→</span></button>`).join('')
    : '<div class="tpn-sub" style="padding:8px 0">Nada pendiente por ahora. 👍</div>';
}
function tpnPintarSubs() {
  $t('tpn-subs').innerHTML = Object.entries(TPN_GRUPOS).map(([g, titulo]) => {
    const lista = TPN.subs.filter(s => s.grupo === g); if (!lista.length) return '';
    return `<div class="tpn-seccion">${esc(titulo)}</div><div class="tpn-subs-grid">${lista.map(s => `<a class="tpn-subcard" href="#${s.id}" onclick="return tpnIrSub('${s.id}')">
      <span class="tpn-subcard-ico" aria-hidden="true">${s.icono}</span><span><b>${esc(s.nombre)}</b><span class="tpn-sub">${esc(s.desc)}</span></span></a>`).join('')}</div>`;
  }).join('');
}

/* ---------- Recorrido guiado (la primera vez, y con "¿Cómo funciona?") ---------- */
const TPN_RECORRIDO = [
  { icono: '🚛', titulo: 'Panel de Transporte', texto: 'Todo el transporte está aquí. Arriba tienes cada parte en orden y el botón "🚛 Panel" para volver a este inicio. Nunca sales del panel.' },
  { icono: '🧰', titulo: 'Prepara (una sola vez)', texto: 'Registra tus clientes, tu flota y tus conductores. Si quieres, tus rutas con su tarifa para que el precio salga solo.' },
  { icono: '📋', titulo: '1. Orden', texto: 'Crea la orden: cliente, origen y destino, la carga y el precio del flete.' },
  { icono: '🧑‍✈️', titulo: '2. Despacho', texto: 'Asigna la unidad y el conductor (o un subcontratista) e inicia el viaje.' },
  { icono: '🚦', titulo: '3. En ruta', texto: 'Anota fronteras, trámites y costos del viaje (combustible, peajes). Los que pagas salen de Caja como gasto.' },
  { icono: '📦', titulo: '4. Entrega', texto: 'Registra la entrega con la firma de quien recibe. Si hubo un problema, anota la incidencia.' },
  { icono: '💳', titulo: '5. Cobrar', texto: 'Cobra aquí mismo, sin ir a Ventas: queda como venta en Ventas y en Caja (o en Créditos si es a crédito), con su retención de IR. Nunca se cobra dos veces el mismo viaje.' },
  { icono: '💵', titulo: '6. Pagar al conductor', texto: 'Liquida al conductor por el viaje; el pago sale de Caja y se resta de la utilidad del viaje.' },
  { icono: '📆', titulo: 'Cierre', texto: 'Cada semana o mes revisa Reportes (utilidad por viaje, cliente y unidad) y el Mantenimiento de tus unidades.' },
];
function tpnRecorrido(forzar) {
  try {
    if (!window.Negocio360Tutorial) return;
    if (forzar) Negocio360Tutorial.mostrar('transporte_panel', TPN_RECORRIDO);
    else Negocio360Tutorial.verificarYMostrar('transporte_panel', TPN_RECORRIDO);
  } catch (e) { console.warn('recorrido transporte:', e); }
}
