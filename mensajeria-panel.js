/* =====================================================
   MENSAJERIA-PANEL.JS — NEGOCIO360 · Panel de Mensajería / Delivery
   Un solo lugar para toda la empresa de delivery (igual que los
   demás paneles): el inicio (cómo funciona, el ciclo del envío,
   preparar y pendientes) y cada parte se abre DENTRO del panel.
   Las pantallas internas son las mismas de siempre: solo se les
   oculta su menú y su encabezado (los del panel quedan).
   Requiere: taller-base.js (sb, TL, esc, fmt, showToast) y mensajeria-base.js.
===================================================== */
'use strict';

// En orden de trabajo: el ciclo del viaje, el cierre y lo que se prepara una vez.
const TPN_SUBS = [
  { id: 'envios', archivo: 'mensajeria-envios.html', key: 'mensajeria_envios', icono: '📦', nombre: 'Envíos', grupo: 'dia', desc: 'Registra cada envío: quién manda, a quién va, dirección, cuánto cobrar contra entrega. La tarifa por zona sale sola. Imprime la etiqueta.' },
  { id: 'despacho', archivo: 'mensajeria-despacho.html', key: 'mensajeria_despacho', icono: '🗂️', nombre: 'Despacho', grupo: 'dia', desc: 'Tablero por estado: asigna uno o varios envíos a un repartidor y sigue cada entrega.' },
  { id: 'repartidor', archivo: 'mensajeria-repartidor.html', key: 'mensajeria_repartidor', icono: '🛵', nombre: 'Mis entregas', grupo: 'dia', desc: 'La pantalla del repartidor en su celular: Waze o Maps, llamar o WhatsApp, y marcar entregado con foto y quién recibió.' },
  { id: 'cuadre', archivo: 'mensajeria-cuadre.html', key: 'mensajeria_cuadre', icono: '💵', nombre: 'Cuadre', grupo: 'dia', desc: 'Al final del día: cuánto efectivo debe entregar cada repartidor. Las tarifas entran a Caja como venta; lo de productos queda para los comercios.' },
  { id: 'liquidar', archivo: 'mensajeria-liquidaciones.html', key: 'mensajeria_liquidaciones', icono: '🤝', nombre: 'Liquidar comercios', grupo: 'dia', desc: 'Entrega a cada comercio lo cobrado a su nombre menos tus tarifas, con su estado de cuenta para imprimir o mandar por WhatsApp.' },
  { id: 'pagos', archivo: 'mensajeria-pagos.html', key: 'mensajeria_pagos', icono: '💼', nombre: 'Pago a repartidores', grupo: 'cierre', desc: 'Lo que ganó cada repartidor por entrega o por porcentaje, descontando su deuda si tiene. Queda como gasto.' },
  { id: 'reportes', archivo: 'mensajeria-reportes.html', key: 'mensajeria_reportes', icono: '📊', nombre: 'Reportes', grupo: 'cierre', desc: 'Envíos recibidos y entregados, porcentaje a la primera, tiempo de entrega, tarifas y detalle por repartidor, zona y comercio. Exporta a Excel.' },
  { id: 'ajustes', archivo: 'mensajeria-ajustes.html', key: 'mensajeria_ajustes', icono: '🗺️', nombre: 'Zonas, tarifas y repartidores', grupo: 'base', desc: 'Zonas con su precio, precios especiales por comercio, recargos (urgente, grande, reintento), tope de efectivo, tus repartidores y el portal de comercios.' },
];
const TPN_GRUPOS = { dia: '☀️ Día a día (el ciclo del envío)', cierre: '📅 Cada semana o quincena', base: '🧰 Lo que preparas una vez' };
// El ciclo de cada envío, en orden.
const TPN_CICLO = [
  { n: 1, sub: 'envios', icono: '📦', nombre: 'Recibir envío', ayuda: 'Datos, zona y cobro' },
  { n: 2, sub: 'despacho', icono: '🗂️', nombre: 'Despachar', ayuda: 'Asignar al repartidor' },
  { n: 3, sub: 'repartidor', icono: '🛵', nombre: 'Entregar', ayuda: 'Foto, quién recibió y cobro' },
  { n: 4, sub: 'cuadre', icono: '💵', nombre: 'Cuadrar repartidor', ayuda: 'Efectivo que debe entregar' },
  { n: 5, sub: 'liquidar', icono: '🤝', nombre: 'Liquidar comercio', ayuda: 'Su dinero menos tus tarifas' },
];
// Otras pantallas del sistema a las que se puede ir sin salir del panel.
const TPN_OTRAS = { 'clientes.html': '👥 Clientes (comercios)', 'ventas.html': '💰 Ventas', 'caja.html': '🏦 Caja', 'gastos.html': '💸 Gastos', 'salarios.html': '💼 Salarios', 'reportes.html': '📊 Reportes', 'configuracion.html': '⚙️ Configuración' };

const TPN = { subs: [], actual: null, paso: null, datos: null, cargandoMarco: false };
const $t = id => document.getElementById(id);
const tpnArchivo = href => { try { return new URL(href, location.href).pathname.split('/').pop().toLowerCase(); } catch (_) { return ''; } };

function tpnIniciar() {
  TPN.subs = tpnPermitidos();
  tpnBarra();
  $t('tln-marco').addEventListener('load', tpnAlCargar);
  window.addEventListener('hashchange', tpnSegunHash);
  window.addEventListener('popstate', tpnSegunHash);
  window.addEventListener('resize', tpnAlto);
  window.addEventListener('message', ev => {
    if (ev.source === $t('tln-marco').contentWindow && ev.data?.tipo === 'n360_operacion_completada') showToast('✅ ' + (ev.data.nota || 'Registrado'));
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
  $t('tln-tabs').innerHTML = TPN.subs.map((s, i) => {
    const sep = i > 0 && TPN.subs[i - 1].grupo !== s.grupo ? '<span class="tln-sep" aria-hidden="true"></span>' : '';
    return `${sep}<a class="tln-tab" href="#${s.id}" data-sub="${s.id}" onclick="return tpnIrSub('${s.id}')"><span aria-hidden="true">${s.icono}</span> ${esc(s.nombre)}</a>`;
  }).join('');
}
function tpnMarcar(id, extra) {
  document.querySelectorAll('.tln-tab').forEach(a => a.classList.toggle('activa', a.dataset.sub === id));
  $t('tln-inicio').classList.toggle('activa', !id && !extra);
  $t('tln-extra').textContent = extra || ''; $t('tln-extra').style.display = extra ? '' : 'none';
  const act = document.querySelector('.tln-tab.activa'); if (act) act.scrollIntoView({ block: 'nearest', inline: 'center' });
}
// Pasos del ciclo arriba de la pantalla interna, con "Siguiente paso".
function tpnPasos(subId, pasoN) {
  const enCiclo = TPN_CICLO.filter(p => p.sub === subId);
  if (!enCiclo.length) { $t('tln-pasos').style.display = 'none'; return; }
  const act = TPN_CICLO.find(p => p.n === pasoN && p.sub === subId) || enCiclo[0];
  TPN.paso = act.n;
  const sig = TPN_CICLO.find(p => p.n === (act.n % TPN_CICLO.length) + 1);
  $t('tln-pasos').style.display = '';
  $t('tln-pasos').innerHTML = `<div class="tln-pasos-lista">${TPN_CICLO.map(p => `<button type="button" class="tln-paso${p.n === act.n ? ' activo' : ''}${p.n < act.n ? ' hecho' : ''}" onclick="tpnIrPaso(${p.n})" ${tpnSub(p.sub) ? '' : 'disabled'}>
      <b>${p.n}</b><span>${esc(p.nombre)}</span></button>`).join('<span class="tln-flecha" aria-hidden="true">›</span>')}</div>
    ${sig && tpnSub(sig.sub) ? `<button type="button" class="btn-primary tln-sig" onclick="tpnIrPaso(${sig.n})">${sig.n === 1 ? '🔁 Nuevo envío' : 'Siguiente paso'}: ${esc(sig.nombre)} →</button>` : ''}`;
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
// Desde el inicio (indicadores, accesos): una parte de Mensajería o cualquier otra pantalla, siempre dentro del panel.
function tpIr(href) {
  const [archivo, q] = String(href).split('?');
  const s = TPN.subs.find(x => x.archivo === archivo);
  if (s) { if (q) { location.hash = s.id + '?' + q; } else tpnIrSub(s.id); return; }
  if (TPN_SUBS.some(x => x.archivo === archivo)) { showToast('No tienes acceso a esa parte de Mensajería.', 'warning'); return; }
  tpnIrOtra(href);
}
function tpnSegunHash() {
  const [id, q] = decodeURIComponent(location.hash.replace(/^#/, '')).split('?');
  if (id && tpnSub(id)) tpnAbrir(id, false, q);
  else if (id !== '__otra' || TPN.actual !== '__otra') tpnInicio();
}
function tpnInicio() {
  TPN.actual = null; $t('content')?.classList.remove('tln-dentro');
  $t('tln-marco-wrap').style.display = 'none'; $t('tln-pasos').style.display = 'none';
  $t('tln-inicio-vista').style.display = '';
  tpnMarcar(null);
  tpnCargarInicio();
}
function tpnAbrir(id, forzar, consulta) {
  const s = tpnSub(id); if (!s) return tpnInicio();
  if (TPN.actual === id && !forzar && !consulta) return;
  TPN.actual = id; $t('content')?.classList.add('tln-dentro');
  $t('tln-inicio-vista').style.display = 'none'; $t('tln-marco-wrap').style.display = '';
  tpnMarcar(id);
  tpnPasos(id, TPN_CICLO.some(p => p.n === TPN.paso && p.sub === id) ? TPN.paso : null);
  tpnCargando(true);
  tpnCargarMarco(s.archivo + (consulta ? '?' + consulta.replace(/^[?]/, '') : ''));
  tpnVigilar();
  tpnAlto();
}
function tpnIrOtra(archivo) {
  TPN.actual = '__otra'; $t('content')?.classList.add('tln-dentro'); if (location.hash !== '#__otra') history.pushState(null, '', '#__otra');
  $t('tln-inicio-vista').style.display = 'none'; $t('tln-marco-wrap').style.display = ''; $t('tln-pasos').style.display = 'none';
  tpnMarcar(null, TPN_OTRAS[tpnArchivo(archivo)] || '');
  tpnCargando(true); tpnCargarMarco(archivo); tpnVigilar(); tpnAlto();
}

/* ---------- La pantalla interna: se le quita su menú, su encabezado y el botón de volver al panel ---------- */
const TPN_CSS_DENTRO = `#sidebar,#sidebar-overlay,#header,.mobile-menu-btn,#n360-asistente-btn,.asis-fab,.chat-fab,a[href="mensajeria.html"]{display:none!important}
#main{margin-left:0!important;width:100%!important;min-height:0!important}
html,body{overflow-x:hidden}`;
function tpnPrepararDentro(doc) {
  if (!doc || !doc.documentElement || doc.documentElement.dataset.tpnDentro === '1') return false;
  doc.documentElement.dataset.tpnDentro = '1';
  const st = doc.createElement('style'); st.id = 'tln-css-dentro'; st.textContent = TPN_CSS_DENTRO;
  (doc.head || doc.documentElement).appendChild(st);
  return true;
}
function tpnVigilar() {
  const fr = $t('tln-marco'); let vueltas = 0;
  clearInterval(TPN.vigia);
  TPN.vigia = setInterval(() => {
    vueltas++;
    try { const doc = fr.contentDocument; if (doc && doc.location.href !== 'about:blank' && doc.documentElement) tpnPrepararDentro(doc); } catch (_) {}
    if (vueltas > 400) clearInterval(TPN.vigia);
  }, 25);
}
function tpnAlCargar() {
  const fr = $t('tln-marco');
  let win, archivo;
  try { win = fr.contentWindow; archivo = tpnArchivo(win.location.href); } catch (_) { tpnCargando(false); return; }
  if (!archivo || win.location.href === 'about:blank') return;
  if (archivo === 'login.html' || archivo === 'index.html' || archivo === 'dashboard.html') { window.location.href = archivo === 'dashboard.html' ? 'dashboard.html' : 'login.html'; return; }
  // Si desde adentro se pidió el panel mismo, se vuelve al inicio (no un panel dentro del panel).
  if (archivo === 'mensajeria.html') { fr.src = 'about:blank'; tpnIrInicio(); return; }
  try { tpnPrepararDentro(fr.contentDocument); } catch (_) {}
  clearInterval(TPN.vigia);
  tpnCargando(false);
  const s = TPN.subs.find(x => x.archivo === archivo);
  if (s) {
    if (TPN.actual !== s.id) { TPN.actual = s.id; history.replaceState(null, '', '#' + s.id); tpnPasos(s.id, null); }
    tpnMarcar(s.id);
  } else { TPN.actual = '__otra'; tpnMarcar(null, TPN_OTRAS[archivo] || ''); $t('tln-pasos').style.display = 'none'; }
  try { win.addEventListener('pagehide', () => { tpnCargando(true); tpnVigilar(); }); } catch (_) {}
  tpnAlto();
}
function tpnCargarMarco(url) {
  const fr = $t('tln-marco');
  try { if (fr.contentWindow && fr.contentWindow.location.href !== 'about:blank') { fr.contentWindow.location.replace(url); return; } } catch (_) {}
  fr.src = url;
}
function tpnCargando(si) { TPN.cargandoMarco = si; $t('tln-cargando').style.display = si ? 'flex' : 'none'; }
function tpnAlto() {
  const wrap = $t('tln-marco-wrap'); if (!wrap || wrap.style.display === 'none') return;
  const top = wrap.getBoundingClientRect().top;
  wrap.style.height = Math.max(420, window.innerHeight - Math.max(0, top) - 8) + 'px';
}

/* ---------- Inicio: ciclo, preparar y pendientes ---------- */
async function tpnCargarInicio() {
  tpnPintarSubs();
  const uid = TL.userId;
  const contar = (tabla, f) => { let q = sb.from(tabla).select('id', { count: 'exact', head: true }).eq('auth_user_id', uid); q = f ? f(q) : q; return q.then(r => r.count || 0).catch(() => 0); };
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  try {
    const [sinAsignar, urgentes, asignados, enRuta, noEnt, hoyEnt, sinCuadrar, zonas, reps, comercios, cfg] = await Promise.all([
      contar('mensajeria_envios', q => q.in('estado', ['por_recoger', 'en_bodega'])),
      contar('mensajeria_envios', q => q.in('estado', ['por_recoger', 'en_bodega']).eq('urgente', true)),
      contar('mensajeria_envios', q => q.eq('estado', 'asignado')),
      contar('mensajeria_envios', q => q.eq('estado', 'en_ruta')),
      contar('mensajeria_envios', q => q.eq('estado', 'no_entregado')),
      contar('mensajeria_envios', q => q.eq('estado', 'entregado').gte('entregado_at', hoy.toISOString())),
      contar('mensajeria_envios', q => q.eq('estado', 'entregado').is('cuadre_id', null).or('cobrado_cod.gt.0,cobrado_envio.gt.0')),
      contar('mensajeria_zonas', q => q.eq('activo', true)),
      contar('mensajeria_repartidores', q => q.eq('activo', true)),
      contar('clientes', q => q.eq('activo', true)),
      sb.from('mensajeria_config').select('auth_user_id').eq('auth_user_id', uid).maybeSingle().then(r => !!r.data).catch(() => false),
    ]);
    const liq = await sb.rpc('msj_liquidaciones_resumen').then(r => (r.data && r.data.ok ? r.data.comercios : []) || []).catch(() => []);
    const porLiquidar = liq.filter(c => Number(c.listos) > 0).length, deComercios = liq.reduce((a, c) => a + Number(c.cod || 0) + Number(c.en_calle || 0), 0);
    TPN.datos = { sinAsignar, urgentes, asignados, enRuta, noEnt, hoyEnt, sinCuadrar, zonas, reps, comercios, cfg, porLiquidar, deComercios };
  } catch (e) { console.warn('inicio mensajeria:', e); TPN.datos = {}; }
  tpnPintarCiclo(); tpnPintarPreparar(); tpnPintarPendientes(); tpnPintarChips();
}
const tpnS = (k, uno, varios) => `${k} ${k === 1 ? uno : varios}`;
function tpnPintarChips() {
  const d = TPN.datos || {}, act = (d.sinAsignar || 0) + (d.asignados || 0) + (d.enRuta || 0) + (d.noEnt || 0);
  $t('tl-chips').innerHTML = `<span class="tl-chip">📦 ${tpnS(act, 'envío activo', 'envíos activos')}</span><span class="tl-chip">🛵 ${tpnS(d.enRuta || 0, 'en ruta', 'en ruta')}</span><span class="tl-chip">✅ ${tpnS(d.hoyEnt || 0, 'entregado hoy', 'entregados hoy')}</span><span class="tl-chip">🤝 De comercios por liquidar: ${fmt(d.deComercios || 0)}</span>`;
}
function tpnPintarCiclo() {
  const d = TPN.datos || {};
  const n = { 1: d.sinAsignar || 0, 2: (d.sinAsignar || 0) + (d.noEnt || 0), 3: (d.asignados || 0) + (d.enRuta || 0), 4: d.sinCuadrar || 0, 5: d.porLiquidar || 0 };
  const txt = { 1: k => tpnS(k, 'sin asignar', 'sin asignar'), 2: k => tpnS(k, 'por despachar', 'por despachar'), 3: k => tpnS(k, 'por entregar', 'por entregar'), 4: k => tpnS(k, 'entrega por cuadrar', 'entregas por cuadrar'), 5: k => tpnS(k, 'comercio por liquidar', 'comercios por liquidar') };
  $t('tln-ciclo').innerHTML = TPN_CICLO.map(p => `<button type="button" class="tln-ciclo-paso" onclick="tpnIrPaso(${p.n})" ${tpnSub(p.sub) ? '' : 'disabled title="No tienes acceso a esta parte"'}>
      <span class="tln-ciclo-num">Paso ${p.n}</span><span class="tln-ciclo-ico" aria-hidden="true">${p.icono}</span>
      <span class="tln-ciclo-nom">${esc(p.nombre)}</span><span class="tln-ciclo-ayuda">${esc(p.ayuda)}</span>
      <span class="tln-badge ${n[p.n] ? 'ambar' : ''}">${esc(txt[p.n](n[p.n]))}</span></button>`).join('<span class="tln-ciclo-flecha" aria-hidden="true">➜</span>')
    + '<div class="tln-ciclo-vuelta" aria-hidden="true">🔁 Y vuelve a empezar con el próximo envío</div>';
}
function tpnPintarPreparar() {
  const d = TPN.datos || {};
  const items = [
    { ok: (d.zonas || 0) > 0, t: 'Zonas y tarifas', d: d.zonas ? `${tpnS(d.zonas, 'zona', 'zonas')} con su precio.` : 'Crea tus zonas (barrios o municipios) con el precio de cada una: la tarifa de cada envío sale sola.', ir: "tpnIrSub('ajustes')", btn: 'Zonas' },
    { ok: (d.reps || 0) > 0, t: 'Tus repartidores', d: d.reps ? `${tpnS(d.reps, 'repartidor', 'repartidores')}.` : 'Registra a tus repartidores. Si les das un usuario del sistema, cada uno ve solo sus entregas.', ir: "tpnIrSub('ajustes')", btn: 'Repartidores' },
    { ok: (d.comercios || 0) > 0, opc: true, t: 'Tus comercios (clientes)', d: d.comercios ? `${tpnS(d.comercios, 'cliente', 'clientes')}.` : 'Opcional: los comercios que te mandan paquetes, para tener su historial y precios especiales.', ir: "tpnIrOtra('clientes.html')", btn: 'Clientes' },
    { ok: !!d.cfg, opc: true, t: 'Recargos y tope de efectivo', d: d.cfg ? 'Configurados.' : 'Opcional: cobro extra por urgente, paquete grande o reintento, y aviso cuando un repartidor anda con mucho efectivo.', ir: "tpIr('mensajeria-ajustes.html?tab=recargos')", btn: 'Recargos' },
  ];
  const oblig = items.filter(i => !i.opc), listos = oblig.filter(i => i.ok).length, todo = listos === oblig.length;
  $t('tln-preparar-estado').textContent = todo ? '✅ Listo para trabajar' : `${listos} de ${oblig.length} pasos listos`;
  $t('tln-preparar').open = !todo;
  $t('tln-preparar-lista').innerHTML = items.map((i, k) => `<div class="tln-prep${i.ok ? ' ok' : ''}">
      <span class="tln-prep-ico" aria-hidden="true">${i.ok ? '✅' : i.opc ? '➖' : '⬜'}</span>
      <div class="tln-prep-txt"><b>${k + 1}. ${esc(i.t)}${i.opc ? ' <span class="tln-sub">(opcional)</span>' : ''}</b><span class="tln-sub">${esc(i.d)}</span></div>
      <button type="button" class="${i.ok ? 'btn-secondary' : 'btn-primary'} tln-btn-sm" onclick="${i.ir}">${esc(i.btn)}</button></div>`).join('');
}
function tpnPintarPendientes() {
  const d = TPN.datos || {}, items = [];
  if (d.urgentes && tpnSub('despacho')) items.push({ t: `🚨 ${tpnS(d.urgentes, 'envío urgente sin asignar', 'envíos urgentes sin asignar')}`, ir: 'tpnIrPaso(2)' });
  if (d.noEnt && tpnSub('despacho')) items.push({ t: `⚠️ ${tpnS(d.noEnt, 'envío no entregado', 'envíos no entregados')}: reintentar o devolver`, ir: 'tpnIrPaso(2)' });
  if (d.sinAsignar && tpnSub('despacho')) items.push({ t: `📦 ${tpnS(d.sinAsignar, 'envío esperando repartidor', 'envíos esperando repartidor')}`, ir: 'tpnIrPaso(2)' });
  if (d.sinCuadrar && tpnSub('cuadre')) items.push({ t: `💵 ${tpnS(d.sinCuadrar, 'entrega con cobro sin cuadrar', 'entregas con cobro sin cuadrar')}`, ir: 'tpnIrPaso(4)' });
  if (d.porLiquidar && tpnSub('liquidar')) items.push({ t: `🤝 ${tpnS(d.porLiquidar, 'comercio listo para liquidar', 'comercios listos para liquidar')}`, ir: 'tpnIrPaso(5)' });
  $t('tln-pendientes').innerHTML = items.length ? items.map(i => `<button type="button" class="tln-pend" onclick="${i.ir}">${esc(i.t)} <span aria-hidden="true">→</span></button>`).join('')
    : '<div class="tln-sub" style="padding:8px 0">Nada pendiente por ahora. 👍</div>';
}
function tpnPintarSubs() {
  $t('tln-subs').innerHTML = Object.entries(TPN_GRUPOS).map(([g, titulo]) => {
    const lista = TPN.subs.filter(s => s.grupo === g); if (!lista.length) return '';
    return `<div class="tln-seccion">${esc(titulo)}</div><div class="tln-subs-grid">${lista.map(s => `<a class="tln-subcard" href="#${s.id}" onclick="return tpnIrSub('${s.id}')">
      <span class="tln-subcard-ico" aria-hidden="true">${s.icono}</span><span><b>${esc(s.nombre)}</b><span class="tln-sub">${esc(s.desc)}</span></span></a>`).join('')}</div>`;
  }).join('');
}

/* ---------- Recorrido guiado (la primera vez, y con "Ver recorrido") ---------- */
const TPN_RECORRIDO = [
  { icono: '🛵', titulo: 'Panel de Mensajería', texto: 'Toda tu empresa de delivery está aquí. Arriba tienes cada parte y el botón "🛵 Panel" para volver a este inicio. Nunca sales del panel.' },
  { icono: '📦', titulo: '1. Recibir envío', texto: 'Registra quién manda (un comercio o una persona), a quién va, la dirección y cuánto hay que cobrar contra entrega. La tarifa se calcula sola según la zona. Imprime la etiqueta para el paquete.' },
  { icono: '🗂️', titulo: '2. Despachar', texto: 'En el tablero eliges uno o varios envíos y se los asignas a un repartidor. Ves cuánto efectivo anda cada uno en la calle.' },
  { icono: '🛵', titulo: '3. Entregar', texto: 'El repartidor abre "Mis entregas" en su celular: va con Waze o Google Maps, llama o escribe por WhatsApp, y marca Entregado con foto, quién recibió y cómo pagó. Si no pudo, elige el motivo.' },
  { icono: '💵', titulo: '4. Cuadrar repartidor', texto: 'Al final del día el sistema dice cuánto efectivo debe entregar cada repartidor. Las tarifas que cobró entran a Caja como venta; lo de productos es de los comercios y queda aparte. Si falta dinero, queda como deuda del repartidor.' },
  { icono: '🤝', titulo: '5. Liquidar comercio', texto: 'Le entregas al comercio lo cobrado a su nombre menos tus tarifas. Tus tarifas entran a Ventas y Caja. Imprime o manda por WhatsApp su estado de cuenta. Cada envío se liquida una sola vez.' },
  { icono: '🔗', titulo: 'Rastreo y Excel', texto: 'Cada envío tiene un enlace para que quien espera el paquete vea en qué paso va, sin cuenta (va en el WhatsApp y en el QR de la etiqueta). Si un comercio manda muchos envíos, cárgalos desde Excel.' },
  { icono: '🌐', titulo: 'Portal de comercios y ubicación', texto: 'Dale a cada comercio su enlace privado (en Zonas, tarifas y repartidores → Portal): desde su celular pide envíos, los sigue y ve cuánto le toca. El repartidor puede tocar "Compartir mi ubicación" y en Despacho ves dónde va en Google Maps. Todo gratis.' },
  { icono: '💼', titulo: 'Pago a repartidores', texto: 'Cada semana o quincena pagas a los repartidores que cobran por entrega o por porcentaje. Queda como gasto, y se les puede descontar su deuda.' },
];
function tpnRecorrido(forzar) {
  try {
    if (!window.Negocio360Tutorial) return;
    if (forzar) Negocio360Tutorial.mostrar('mensajeria_panel', TPN_RECORRIDO);
    else Negocio360Tutorial.verificarYMostrar('mensajeria_panel', TPN_RECORRIDO);
  } catch (e) { console.warn('recorrido mensajeria:', e); }
}

// Arranque: taller-base.js llama a esta función cuando la sesión y la opción de Mensajería están listas.
// En la cuenta demo, cada día aparecen envíos nuevos (en una cuenta real no hace nada).
window.tallerListo = async function () {
  try { const r = await sb.rpc('msj_demo_preparar'); if (r && r.data && r.data.creados > 0) TPN.demoNuevos = r.data.creados; } catch (_) {}
  tpnIniciar();
  if (TPN.demoNuevos && typeof showToast === 'function') showToast(`🛵 Cuenta demo: llegaron ${TPN.demoNuevos} envíos nuevos de hoy`);
};
