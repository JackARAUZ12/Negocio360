/* =====================================================
   TALLER-PANEL.JS — NEGOCIO360 · Panel de Taller mecánico
   Un solo lugar para todo el taller (igual que los demás paneles):
   el inicio (cómo funciona, el ciclo de la orden, preparar y
   pendientes) y cada parte (Órdenes, Vehículos) se abre DENTRO
   del panel, sin salir de él.
   Las pantallas internas son las mismas de siempre: solo se les
   oculta su menú y su encabezado (los del panel quedan).
   Si una pantalla interna lleva a otra, también queda dentro.
   Requiere de la página: sb, TL, esc, fmt, showToast (taller-base.js).
===================================================== */
'use strict';

// En orden de trabajo: el ciclo del viaje, el cierre y lo que se prepara una vez.
const TPN_SUBS = [
  { id: 'ordenes', archivo: 'taller-ordenes.html', key: 'taller_ordenes', icono: '📋', nombre: 'Órdenes y presupuestos', grupo: 'dia', desc: 'Recibe el vehículo, diagnostica, arma el presupuesto (mano de obra y repuestos), el cliente aprueba línea por línea, repara y entrega con cobro.' },
  { id: 'vehiculos', archivo: 'taller-vehiculos.html', key: 'taller_vehiculos', icono: '🚗', nombre: 'Vehículos y flotas', grupo: 'base', desc: 'Autos, camionetas, motos, camiones, buses y pesados con placa, VIN, kilometraje y su dueño. Sin placas repetidas.' },
];
const TPN_GRUPOS = { dia: '☀️ Día a día (el ciclo de la orden)', base: '🧰 Lo que preparas una vez' };
// El ciclo de cada vehículo, en orden.
const TPN_CICLO = [
  { n: 1, sub: 'ordenes', icono: '🚗', nombre: 'Recepción', ayuda: 'Vehículo, falla y kilometraje' },
  { n: 2, sub: 'ordenes', icono: '🔍', nombre: 'Diagnóstico', ayuda: 'Qué tiene y qué necesita' },
  { n: 3, sub: 'ordenes', icono: '✅', nombre: 'Presupuesto aprobado', ayuda: 'El cliente aprueba línea por línea' },
  { n: 4, sub: 'ordenes', icono: '🔧', nombre: 'Reparación', ayuda: 'Trabajo y trabajos adicionales' },
  { n: 5, sub: 'ordenes', icono: '🛡️', nombre: 'Control de calidad', ayuda: 'Revisar antes de marcarlo Listo' },
  { n: 6, sub: 'ordenes', icono: '💳', nombre: 'Entrega y cobro', ayuda: 'Se cobra solo lo aprobado' },
];
// Otras pantallas del sistema a las que se puede ir sin salir del panel.
const TPN_OTRAS = { 'ventas.html': '💰 Ventas', 'creditos.html': '🧾 Créditos', 'clientes.html': '👥 Clientes', 'gastos.html': '💸 Gastos', 'caja.html': '🏦 Caja',
  'productos.html': '📦 Repuestos e inventario', 'proformas.html': '📄 Proformas', 'reportes.html': '📊 Reportes', 'agenda.html': '📅 Agenda', 'configuracion.html': '⚙️ Configuración' };

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
    ${sig && tpnSub(sig.sub) ? `<button type="button" class="btn-primary tln-sig" onclick="tpnIrPaso(${sig.n})">${sig.n === 1 ? '🔁 Nuevo viaje' : 'Siguiente paso'}: ${esc(sig.nombre)} →</button>` : ''}`;
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
// Desde el inicio (indicadores, accesos): una parte del taller o cualquier otra pantalla, siempre dentro del panel.
function tpIr(href) {
  const [archivo, q] = String(href).split('?');
  const s = TPN.subs.find(x => x.archivo === archivo);
  if (s) { if (q) { location.hash = s.id + '?' + q; } else tpnIrSub(s.id); return; }
  if (TPN_SUBS.some(x => x.archivo === archivo)) { showToast('No tienes acceso a esa parte del taller.', 'warning'); return; }
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
const TPN_CSS_DENTRO = `#sidebar,#sidebar-overlay,#header,.mobile-menu-btn,#n360-asistente-btn,.asis-fab,.chat-fab,a[href="taller.html"]{display:none!important}
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
  if (archivo === 'taller.html') { fr.src = 'about:blank'; tpnIrInicio(); return; }
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
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const [rec, dia, apr, rep, lis, atras, vehiculos, clientes, repuestos, metodos, mes] = await Promise.all([
      contar('taller_ordenes', q => q.eq('estado', 'recibido')),
      contar('taller_ordenes', q => q.eq('estado', 'diagnostico')),
      contar('taller_ordenes', q => q.eq('estado', 'esperando_aprobacion')),
      contar('taller_ordenes', q => q.eq('estado', 'en_reparacion')),
      contar('taller_ordenes', q => q.eq('estado', 'listo')),
      contar('taller_ordenes', q => q.not('estado', 'in', '(entregado,cancelado)').lt('fecha_prometida', hoy)),
      contar('taller_vehiculos', q => q.eq('activo', true)),
      contar('clientes', q => q.eq('activo', true)),
      contar('productos', q => q.eq('tipo', 'producto').eq('activo', true)),
      contar('metodos_pago'),
      sb.from('taller_ordenes').select('total').eq('auth_user_id', uid).eq('estado', 'entregado').gte('fecha_entrega', hoy.slice(0, 8) + '01').then(r => (r.data || []).reduce((a, x) => a + Number(x.total || 0), 0)).catch(() => 0),
    ]);
    TPN.datos = { rec, dia, apr, rep, lis, atras, vehiculos, clientes, repuestos, metodos, mes };
  } catch (e) { console.warn('inicio taller:', e); TPN.datos = {}; }
  tpnPintarCiclo(); tpnPintarPreparar(); tpnPintarPendientes(); tpnPintarChips();
}
function tpnContar() {
  const d = TPN.datos || {};
  return { 1: d.rec || 0, 2: d.dia || 0, 3: d.apr || 0, 4: d.rep || 0, 5: null, 6: d.lis || 0 };
}
function tpnPintarChips() {
  const d = TPN.datos || {}, ab = (d.rec || 0) + (d.dia || 0) + (d.apr || 0) + (d.rep || 0) + (d.lis || 0);
  $t('tl-chips').innerHTML = `<span class="tl-chip">🚗 ${d.vehiculos || 0} vehículo${d.vehiculos === 1 ? '' : 's'}</span><span class="tl-chip">📋 ${ab} orden${ab === 1 ? '' : 'es'} abierta${ab === 1 ? '' : 's'}</span><span class="tl-chip">💳 Entregado este mes: ${fmt(d.mes || 0)}</span>`;
}
function tpnPintarCiclo() {
  const n = tpnContar();
  const txt = { 1: k => `${k} por diagnosticar`, 2: k => `${k} en diagnóstico`, 3: k => `${k} esperando al cliente`, 4: k => `${k} en reparación`, 5: () => 'Revisa y marca Listo', 6: k => `${k} lista${k === 1 ? '' : 's'} para entregar` };
  $t('tln-ciclo').innerHTML = TPN_CICLO.map(p => `<button type="button" class="tln-ciclo-paso" onclick="tpnIrPaso(${p.n})" ${tpnSub(p.sub) ? '' : 'disabled title="No tienes acceso a esta parte"'}>
      <span class="tln-ciclo-num">Paso ${p.n}</span><span class="tln-ciclo-ico" aria-hidden="true">${p.icono}</span>
      <span class="tln-ciclo-nom">${esc(p.nombre)}</span><span class="tln-ciclo-ayuda">${esc(p.ayuda)}</span>
      <span class="tln-badge ${n[p.n] ? 'ambar' : ''}">${esc(txt[p.n](n[p.n]))}</span></button>`).join('<span class="tln-ciclo-flecha" aria-hidden="true">➜</span>')
    + '<div class="tln-ciclo-vuelta" aria-hidden="true">🔁 Y vuelve a empezar con el próximo vehículo</div>';
}
function tpnPintarPreparar() {
  const d = TPN.datos || {};
  const items = [
    { ok: (d.metodos || 0) > 0, t: 'Métodos de pago', d: d.metodos ? `${d.metodos} método${d.metodos === 1 ? '' : 's'}.` : 'Crea al menos uno (efectivo, tarjeta…) para poder cobrar la entrega.', ir: "tpnIrOtra('configuracion.html')", btn: 'Configuración' },
    { ok: (d.vehiculos || 0) > 0, t: 'Tus vehículos', d: d.vehiculos ? `${d.vehiculos} vehículo${d.vehiculos === 1 ? '' : 's'}.` : 'Registra el primer vehículo (placa, marca, dueño). También puedes hacerlo al recibirlo.', ir: "tpnIrSub('vehiculos')", btn: 'Vehículos' },
    { ok: (d.clientes || 0) > 0, opc: true, t: 'Tus clientes', d: d.clientes ? `${d.clientes} cliente${d.clientes === 1 ? '' : 's'}.` : 'Opcional: así cada vehículo queda ligado a su dueño y su historial de compras.', ir: "tpnIrOtra('clientes.html')", btn: 'Clientes' },
    { ok: (d.repuestos || 0) > 0, opc: true, t: 'Repuestos en inventario', d: d.repuestos ? `${d.repuestos} producto${d.repuestos === 1 ? '' : 's'}.` : 'Opcional: crea tus repuestos en Productos para que se descuenten al entregar.', ir: "tpnIrOtra('productos.html')", btn: 'Productos' },
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
  if (d.lis && tpnSub('ordenes')) items.push({ t: `💳 ${d.lis} vehículo${d.lis === 1 ? '' : 's'} listo${d.lis === 1 ? '' : 's'} para entregar y cobrar`, ir: 'tpnIrPaso(6)' });
  if (d.apr && tpnSub('ordenes')) items.push({ t: `✅ ${d.apr} presupuesto${d.apr === 1 ? '' : 's'} esperando respuesta del cliente`, ir: 'tpnIrPaso(3)' });
  if (d.atras && tpnSub('ordenes')) items.push({ t: `⏰ ${d.atras} orden${d.atras === 1 ? '' : 'es'} pasada${d.atras === 1 ? '' : 's'} de la fecha prometida`, ir: 'tpnIrPaso(4)' });
  if (d.rec && tpnSub('ordenes')) items.push({ t: `🚗 ${d.rec} vehículo${d.rec === 1 ? '' : 's'} recibido${d.rec === 1 ? '' : 's'} sin diagnosticar`, ir: 'tpnIrPaso(1)' });
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
  { icono: '🔧', titulo: 'Panel de Taller mecánico', texto: 'Todo el taller está aquí. Arriba tienes cada parte y el botón "🔧 Panel" para volver a este inicio. Nunca sales del panel.' },
  { icono: '🚗', titulo: '1. Recepción', texto: 'Registra el vehículo (placa, marca, dueño) y abre la orden con la falla que cuenta el cliente y el kilometraje. Un vehículo solo puede tener una orden abierta.' },
  { icono: '🔍', titulo: '2. Diagnóstico', texto: 'Anota qué tiene el vehículo y arma el presupuesto: mano de obra y repuestos de tu inventario.' },
  { icono: '✅', titulo: '3. Presupuesto aprobado', texto: 'El cliente aprueba o rechaza cada línea. Solo se cobra lo aprobado; lo rechazado no se cobra.' },
  { icono: '🔧', titulo: '4. Reparación', texto: 'Si aparece algo más, agrega un trabajo adicional: queda pendiente hasta que el cliente lo apruebe.' },
  { icono: '🛡️', titulo: '5. Control de calidad', texto: 'Revisa el trabajo y marca la orden como Listo. No se puede marcar Listo con líneas sin decidir.' },
  { icono: '💳', titulo: '6. Entrega y cobro', texto: 'Elige el método de pago y entrega: se crea la venta (con IVA si aplica), entra el dinero a Caja y los repuestos salen del inventario, todo en un solo paso. No se puede cobrar dos veces la misma orden.' },
];
function tpnRecorrido(forzar) {
  try {
    if (!window.Negocio360Tutorial) return;
    if (forzar) Negocio360Tutorial.mostrar('taller_panel', TPN_RECORRIDO);
    else Negocio360Tutorial.verificarYMostrar('taller_panel', TPN_RECORRIDO);
  } catch (e) { console.warn('recorrido taller:', e); }
}

// Arranque: taller-base.js llama a esta función cuando la sesión y la opción del taller están listas.
window.tallerListo = function () { tpnIniciar(); };
