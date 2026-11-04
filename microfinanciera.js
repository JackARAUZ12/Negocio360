/* ============================================================
   MICROFINANCIERA.JS — NEGOCIO360 · Panel Microfinanciera (Nivel 1)
   Vender al crédito (productos o efectivo), ruta de cobro del día, cobrar con recibo,
   tarjeta del cliente y resumen.
   CANDADOS: esta pantalla NO escribe dinero directamente. Vender, cobrar y anular pasan
   por funciones del servidor (mf_credito_crear, mf_cobrar, mf_anular_pago, mf_gestion) que
   validan todo y guardan en UNA operación (venta, inventario, crédito, cuotas, Caja, pago).
   Cada operación lleva una referencia única: un doble toque o un reintento nunca la duplica.
   Todo queda en las tablas de siempre: lo ven Créditos, Ventas, Caja, Contabilidad y Agenda.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const MF = {
  userId: null, cfg: {}, tab: 'ruta', ocupado: false,
  clientes: [], creditos: [], cuotas: {}, metodos: [], bancos: [], productos: [], pagosHoy: [], pagosSemana: [], promesas: {},
  venta: null, cobro: null, filtroCli: '', filtroRuta: '',
};

/* ---------- utilidades ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sym() { const m = MF.cfg?.moneda; if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} } return m === 'USD' ? '$' : 'C$'; }
function fmt(v) { return sym() + ' ' + Number(v || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function hoyISO() { return ymd(new Date()); }
function masDias(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
function masMeses(iso, n) { const d = new Date(iso + 'T12:00:00'); const dia = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(dia, ult)); return ymd(d); }
function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
function fCorta(iso) { if (!iso) return '—'; return new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-NI', { weekday: 'short', day: 'numeric', month: 'short' }); }
function diaSemana(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { weekday: 'long' }); }
function ref() { try { return crypto.randomUUID(); } catch (_) { return 'r' + Date.now() + Math.random().toString(36).slice(2); } }
function nombreCli(c) { return c ? `${c.nombre || ''} ${c.apellido || ''}`.trim() || 'Cliente' : 'Cliente'; }
function waNum(t) { const d = String(t || '').replace(/\D/g, ''); if (!d) return ''; return d.length === 8 ? '505' + d : d; }
function perfilNombre() { try { const p = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (p && p.nombre) return String(p.nombre).slice(0, 100); } catch (_) {} return document.getElementById('header-name')?.textContent || 'Usuario'; }
const necesitaBanco = n => /tarjeta|transferencia|dep[oó]sito/i.test(n || '');
const FREC = { diaria: 'Diario', semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };

/* ---------- tema / menú (igual que el resto del sistema) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('n360_theme', t); } catch (_) {}
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = t === 'dark' ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
let sidebarCollapsed = false;
function toggleSidebar() {
  const s = document.getElementById('sidebar'); if (!s) return;
  if (window.innerWidth <= 768) { const o = s.classList.toggle('mobile-open'); const ov = document.getElementById('sidebar-overlay'); if (ov) ov.classList.toggle('active', o); }
  else { sidebarCollapsed = !sidebarCollapsed; s.classList.toggle('collapsed', sidebarCollapsed); document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed); }
}
function closeMobileSidebar() { const s = document.getElementById('sidebar'), o = document.getElementById('sidebar-overlay'); if (s) s.classList.remove('mobile-open'); if (o) o.classList.remove('active'); }
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
let _tt = null;
function showToast(msg, type = 'success') { const el = document.getElementById('toast'); if (!el) return; el.textContent = msg; el.className = `toast toast-${type} show`; clearTimeout(_tt); _tt = setTimeout(() => el.classList.remove('show'), 4200); }

/* ---------- servidor ---------- */
const MOTIVOS = {
  desactivado: 'El Panel Microfinanciera está apagado. Actívalo en Configuración.', datos: 'Algún dato no es válido. Revisa y vuelve a intentar.',
  cliente: 'Ese cliente no existe en tu negocio.', frecuencia: 'Elige cada cuánto paga.', cuotas: 'El número de cuotas debe ser de 1 a 365.',
  fecha: 'La fecha del primer pago no es válida.', porcentaje: 'El porcentaje no es válido (0 a 300).', prima: 'La prima debe ser menor que el total.',
  prima_prestamo: 'Un préstamo en efectivo no lleva prima.', sin_items: 'Agrega al menos un producto.', producto: 'Uno de los productos ya no existe o está inactivo.',
  cantidad: 'Revisa las cantidades.', precio: 'Revisa los precios.', total_cero: 'El total debe ser mayor que cero.', monto: 'Escribe un monto válido.',
  metodo: 'Elige cómo pagó.', banco: 'Ese banco no existe en tu negocio.', banco_moneda: 'Ese banco es de otra moneda: ese cobro regístralo en Créditos.',
  no_existe: 'No se encontró. Recarga la pantalla.', pagado: 'Ese crédito ya está pagado.', con_impuestos: 'Este crédito tiene impuestos: cóbralo en el módulo Créditos.',
  motivo: 'Escribe el motivo (mínimo 3 letras).', ya_anulado: 'Ese cobro ya estaba anulado.', de_creditos: 'Ese pago se hizo en Créditos: anúlalo allá.', nota: 'Escribe la nota.',
};
function mensaje(d) {
  if (!d) return 'No se pudo completar.';
  if (d.motivo === 'sin_stock') return `No hay suficiente "${d.producto}": hay ${Number(d.hay)} y necesitas ${Number(d.necesita)}.`;
  if (d.motivo === 'fondos') return `No hay suficiente dinero en Caja para prestar. Caja tiene ${fmt(d.caja)}.`;
  if (d.motivo === 'excede') return `Es más de lo que debe. Saldo: ${fmt(d.saldo)}.`;
  return MOTIVOS[d.motivo] || 'No se pudo completar.';
}
async function rpc(n, a) {
  try {
    const { data, error } = await sb.rpc(n, a);
    if (error) { console.warn(n, error); return { ok: false, red: true, msg: 'No se pudo completar. Revisa tu conexión e intenta de nuevo (no se cobra dos veces).' }; }
    if (!data || data.ok !== true) return { ...(data || {}), ok: false, msg: mensaje(data) };
    return data;
  } catch (e) { return { ok: false, red: true, msg: 'Sin conexión. Intenta de nuevo (no se cobra dos veces).' }; }
}
async function leerTodo(fn) {
  const out = [];
  for (let i = 0; i < 30; i++) { const { data, error } = await fn().range(i * 1000, i * 1000 + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break; }
  return out;
}

/* ---------- datos ---------- */
async function cargarDatos() {
  const u = MF.userId, hoy = hoyISO();
  const [cli, cred, met, ban, prod, pagos] = await Promise.all([
    leerTodo(() => sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp,direccion').eq('auth_user_id', u).eq('activo', true).order('nombre').order('id')),
    leerTodo(() => sb.from('creditos').select('id,numero_credito,cliente_id,tipo,total_financiado,saldo_pendiente,frecuencia,valor_cuota_aprox,estado,created_at,observaciones,mf_ref')
      .eq('auth_user_id', u).in('estado', ['activo', 'al_dia', 'con_atraso', 'en_proceso']).gt('saldo_pendiente', 0.004).order('id')),
    sb.from('metodos_pago').select('id,nombre').eq('auth_user_id', u).eq('activo', true).order('nombre'),
    sb.from('bancos').select('id,nombre,moneda').eq('auth_user_id', u).eq('activo', true).order('nombre'),
    leerTodo(() => sb.from('productos').select('id,nombre,precio,stock_actual,tipo,sku,codigo_barras').eq('auth_user_id', u).eq('activo', true).in('tipo', ['producto', 'servicio']).order('nombre').order('id')),
    sb.from('creditos_pagos').select('id,credito_id,monto,fecha,estado,comprobante_numero').eq('auth_user_id', u).eq('estado', 'completado').gte('fecha', masDias(hoy, -6)).limit(5000),
  ]);
  MF.clientes = cli; MF.creditos = cred;
  MF.metodos = (met.data || []); MF.bancos = (ban.data || []).filter(b => (b.moneda || 'NIO') === (MF.cfg.moneda || 'NIO'));
  MF.productos = prod;
  MF.pagosSemana = pagos.data || []; MF.pagosHoy = MF.pagosSemana.filter(p => String(p.fecha).slice(0, 10) === hoy);
  MF.cuotas = {};
  const ids = cred.map(c => c.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from('creditos_cuotas').select('credito_id,numero,fecha_vencimiento,monto_total,monto_pagado,estado')
      .in('credito_id', ids.slice(i, i + 150)).neq('estado', 'pagada').order('numero');
    if (error) throw error;
    (data || []).forEach(q => { (MF.cuotas[q.credito_id] = MF.cuotas[q.credito_id] || []).push(q); });
  }
  MF.promesas = {};
  try {
    const { data } = await sb.from('mf_gestiones').select('credito_id,tipo,fecha_promesa,nota,created_at').eq('auth_user_id', u).gte('created_at', masDias(hoy, -30) + 'T00:00:00').order('created_at', { ascending: false }).limit(3000);
    (data || []).forEach(g => { if (!MF.promesas[g.credito_id]) MF.promesas[g.credito_id] = g; });
  } catch (_) {}
}
const cliPorId = id => MF.clientes.find(c => c.id === id);
// Situación de un crédito hoy: cuánto está atrasado, cuánto le toca hoy, días de atraso y próxima cuota.
function situacion(cr) {
  const hoy = hoyISO(), qs = MF.cuotas[cr.id] || [];
  let atrasado = 0, hoyMonto = 0, primeraVencida = null, prox = null;
  qs.forEach(q => {
    const f = String(q.fecha_vencimiento).slice(0, 10), falta = r2(Number(q.monto_total) - Number(q.monto_pagado || 0));
    if (falta <= 0.004) return;
    if (f < hoy) { atrasado = r2(atrasado + falta); if (!primeraVencida || f < primeraVencida) primeraVencida = f; }
    else if (f === hoy) hoyMonto = r2(hoyMonto + falta);
    else if (!prox) prox = { fecha: f, monto: falta };
  });
  const dias = primeraVencida ? diasEntre(primeraVencida, hoy) : 0;
  const cuota = r2(cr.valor_cuota_aprox || (qs[0] ? qs[0].monto_total : 0));
  return { atrasado, hoy: hoyMonto, dias, prox, cuota, pagarHoy: r2(atrasado + hoyMonto), saldo: r2(cr.saldo_pendiente) };
}

/* ---------- pestañas ---------- */
async function mfTab(t) {
  MF.tab = t;
  document.querySelectorAll('.pd-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === t));
  try { history.replaceState(null, '', '#' + t); } catch (_) {}
  const v = document.getElementById('pd-vista');
  if (t === 'ruta') return pintarRuta(v);
  if (t === 'vender') return pintarVender(v);
  if (t === 'clientes') return pintarClientes(v);
  return pintarResumen(v);
}
async function recargar() { try { await cargarDatos(); } catch (e) { console.error(e); showToast('No se pudieron cargar los datos. Revisa tu conexión.', 'error'); } mfTab(MF.tab); }

/* ---------- 🛵 RUTA DE HOY ---------- */
function pintarRuta(v) {
  const hoy = hoyISO();
  const lista = MF.creditos.map(cr => ({ cr, s: situacion(cr), c: cliPorId(cr.cliente_id), g: MF.promesas[cr.id] }))
    .filter(x => x.s.pagarHoy > 0.004 || (x.g && x.g.tipo === 'promesa' && x.g.fecha_promesa === hoy));
  const f = MF.filtroRuta.trim().toLowerCase();
  const vis = lista.filter(x => !f || nombreCli(x.c).toLowerCase().includes(f) || String(x.c?.direccion || '').toLowerCase().includes(f) || String(x.cr.numero_credito).toLowerCase().includes(f))
    .sort((a, b) => (b.s.dias - a.s.dias) || nombreCli(a.c).localeCompare(nombreCli(b.c)));
  const esperado = r2(lista.reduce((s, x) => s + x.s.pagarHoy, 0)), cobrado = r2(MF.pagosHoy.reduce((s, p) => s + Number(p.monto || 0), 0));
  const cobradosIds = new Set(MF.pagosHoy.map(p => p.credito_id));
  v.innerHTML = `<div class="pd-kpis">
      <div class="pd-kpi"><div class="pd-kpi-l">💵 Cobrado hoy</div><div class="pd-kpi-v pd-verde">${fmt(cobrado)}</div><div class="pd-kpi-s">${MF.pagosHoy.length} recibo(s)</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">🛵 Por cobrar hoy</div><div class="pd-kpi-v">${fmt(esperado)}</div><div class="pd-kpi-s">${lista.length} cliente(s) en la ruta</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">⏰ Atrasados</div><div class="pd-kpi-v pd-rojo">${lista.filter(x => x.s.dias > 0).length}</div><div class="pd-kpi-s">con cuotas vencidas</div></div></div>
    <div class="vd-filtros"><input type="search" class="tl-inp" style="flex:1;min-width:0" placeholder="🔎 Buscar cliente, barrio o crédito" value="${esc(MF.filtroRuta)}" oninput="MF.filtroRuta=this.value;pintarRuta(document.getElementById('pd-vista'))" aria-label="Buscar en la ruta">
      <button class="btn-secondary" onclick="recargar()">🔄 Actualizar</button></div>
    ${vis.length ? `<div class="mf-lista">${vis.map(x => tarjetaRuta(x, cobradosIds.has(x.cr.id))).join('')}</div>`
      : `<div class="pd-vacio"><div class="ico">🎉</div><b>${lista.length ? 'Nadie con ese nombre en la ruta.' : 'Nadie tiene que pagar hoy.'}</b><p class="tl-muted">Aquí salen los clientes con cuota de hoy, atrasados o que prometieron pagar hoy.</p></div>`}`;
  if (document.activeElement && document.activeElement.type === 'search') { const i = v.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function tarjetaRuta(x, cobradoHoy) {
  const { cr, s, c, g } = x, tel = c?.whatsapp || c?.telefono || '';
  const est = s.dias > 0 ? `<span class="pd-pill mal">⏰ ${s.dias} día${s.dias === 1 ? '' : 's'} de atraso</span>` : s.hoy > 0 ? '<span class="pd-pill ambar">📅 Le toca hoy</span>' : '<span class="pd-pill">🤝 Prometió hoy</span>';
  return `<div class="mf-card${cobradoHoy ? ' cobrado' : ''}">
    <div class="mf-card-cab"><div style="min-width:0"><b class="mf-nom">${esc(nombreCli(c))}</b>
      <div class="tl-muted">${esc(cr.numero_credito)}${c?.direccion ? ' · 📍 ' + esc(c.direccion) : ''}</div></div>${est}</div>
    <div class="mf-montos"><div><span>Cobrar hoy</span><b>${fmt(s.pagarHoy)}</b></div><div><span>Cuota</span><b>${fmt(s.cuota)}</b></div><div><span>Debe en total</span><b>${fmt(s.saldo)}</b></div></div>
    ${g ? `<div class="tl-muted">📝 ${g.tipo === 'promesa' ? 'Prometió pagar el ' + fCorta(g.fecha_promesa) : g.tipo === 'no_estaba' ? 'No estaba (' + fCorta(String(g.created_at).slice(0, 10)) + ')' : esc(g.nota || '')}${g.tipo !== 'nota' && g.nota ? ' · ' + esc(g.nota) : ''}</div>` : ''}
    ${cobradoHoy ? '<div class="tl-aviso ok">✅ Ya pagó hoy</div>' : ''}
    <div class="mf-acc">
      <button class="btn-primary mf-grande" onclick="abrirCobro('${cr.id}')">💵 Cobrar</button>
      <button class="btn-secondary" onclick="abrirGestion('${cr.id}','no_estaba')">🚪 No estaba</button>
      <button class="btn-secondary" onclick="abrirGestion('${cr.id}','promesa')">🤝 Promete</button>
      ${tel ? `<a class="btn-secondary" href="https://wa.me/${waNum(tel)}?text=${encodeURIComponent(`Hola ${nombreCli(c).split(' ')[0]} 👋, le saludamos de ${MF.cfg.nombre_comercial || 'nuestro negocio'}. Le recordamos su pago de ${fmt(s.pagarHoy || s.cuota)}. ¡Gracias!`)}" target="_blank" rel="noopener">💬</a>
        <a class="btn-secondary" href="tel:${esc(String(tel).replace(/[^\d+]/g, ''))}">📞</a>` : ''}
      <button class="btn-secondary" onclick="abrirTarjeta('${cr.cliente_id}')">📒</button></div></div>`;
}

/* ---------- 💵 COBRAR ---------- */
function opcionesMetodo(sel) { return MF.metodos.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.nombre)}</option>`).join(''); }
function abrirCobro(creditoId) {
  const cr = MF.creditos.find(x => x.id === creditoId); if (!cr) return;
  const s = situacion(cr), c = cliPorId(cr.cliente_id);
  const ef = MF.metodos.find(m => /efectivo/i.test(m.nombre)) || MF.metodos[0] || null;
  MF.cobro = { cr, ref: ref(), metodoId: ef ? ef.id : '' };
  const sugerido = s.pagarHoy > 0 ? Math.min(s.pagarHoy, s.saldo) : Math.min(s.cuota || s.saldo, s.saldo);
  const rapidos = [[`Cuota ${fmt(Math.min(s.cuota, s.saldo))}`, Math.min(s.cuota, s.saldo)]];
  if (s.atrasado > 0) rapidos.push([`Lo atrasado ${fmt(Math.min(s.atrasado, s.saldo))}`, Math.min(s.atrasado, s.saldo)]);
  if (s.pagarHoy > 0 && s.pagarHoy !== s.atrasado) rapidos.push([`Atrasado + hoy ${fmt(Math.min(s.pagarHoy, s.saldo))}`, Math.min(s.pagarHoy, s.saldo)]);
  rapidos.push([`Todo ${fmt(s.saldo)}`, s.saldo]);
  modal(`<div class="tl-modal-cab"><h2>💵 Cobrar a ${esc(nombreCli(c))}</h2><button class="tl-x" onclick="cerrarModal()" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo">
      <div class="mf-montos"><div><span>Debe en total</span><b>${fmt(s.saldo)}</b></div><div><span>Atrasado</span><b class="${s.atrasado > 0 ? 'pd-rojo' : ''}">${fmt(s.atrasado)}</b></div><div><span>Le toca hoy</span><b>${fmt(s.hoy)}</b></div></div>
      <div class="tl-f"><label for="mf-monto">¿Cuánto pagó?</label><input class="tl-inp mf-monto-inp" id="mf-monto" type="number" inputmode="decimal" min="0.01" step="0.01" value="${r2(sugerido)}" oninput="previewCobro()"></div>
      <div class="mf-rapidos">${rapidos.map(([t, m]) => `<button type="button" class="pd-tab" onclick="document.getElementById('mf-monto').value='${r2(m)}';previewCobro()">${esc(t)}</button>`).join('')}</div>
      <div class="tl-grid"><div class="tl-f"><label for="mf-met">¿Cómo pagó?</label><select class="tl-sel" id="mf-met" onchange="MF.cobro.metodoId=this.value;previewCobro()">${opcionesMetodo(MF.cobro.metodoId) || '<option value="">Efectivo</option>'}</select></div>
        <div class="tl-f" id="mf-banco-w" style="display:none"><label for="mf-banco">¿A qué banco?</label><select class="tl-sel" id="mf-banco"><option value="">Elige el banco</option>${MF.bancos.map(b => `<option value="${b.id}">🏦 ${esc(b.nombre)}</option>`).join('')}</select></div></div>
      <div class="tl-f"><label for="mf-nota">Nota (opcional)</label><input class="tl-inp" id="mf-nota" maxlength="300" placeholder="Ej. pagó la vecina"></div>
      <div id="mf-prev"></div><div class="tl-aviso" id="mf-err" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="cerrarModal()">Cancelar</button><button class="btn-primary mf-grande" id="mf-ok" onclick="confirmarCobro()">✅ Cobrar</button></div>`);
  previewCobro();
  setTimeout(() => { const i = document.getElementById('mf-monto'); if (i) { i.focus(); i.select(); } }, 60);
}
function previewCobro() {
  const k = MF.cobro; if (!k) return;
  const s = situacion(k.cr), m = r2(document.getElementById('mf-monto').value), met = MF.metodos.find(x => x.id === k.metodoId);
  const bw = document.getElementById('mf-banco-w'); if (bw) bw.style.display = met && necesitaBanco(met.nombre) && MF.bancos.length ? '' : 'none';
  const prev = document.getElementById('mf-prev'), ok = document.getElementById('mf-ok');
  if (!(m > 0)) { prev.innerHTML = ''; ok.disabled = true; return; }
  if (m > s.saldo + 0.004) { prev.innerHTML = `<div class="tl-aviso">Es más de lo que debe (${fmt(s.saldo)}).</div>`; ok.disabled = true; return; }
  ok.disabled = false; ok.textContent = `✅ Cobrar ${fmt(m)}`;
  prev.innerHTML = `<div class="tl-aviso ok">Queda debiendo <b>${fmt(r2(s.saldo - m))}</b>${r2(s.saldo - m) <= 0.004 ? ' · 🎉 ¡termina de pagar!' : ''}</div>`;
}
async function confirmarCobro() {
  const k = MF.cobro; if (!k || MF.ocupado) return;
  const err = document.getElementById('mf-err'); err.style.display = 'none';
  const m = r2(document.getElementById('mf-monto').value), met = MF.metodos.find(x => x.id === k.metodoId) || null;
  const bancoW = document.getElementById('mf-banco-w'), banco = bancoW && bancoW.style.display !== 'none' ? document.getElementById('mf-banco').value : '';
  if (!(m > 0)) return;
  if (bancoW && bancoW.style.display !== 'none' && !banco) { err.textContent = 'Elige a qué banco entró.'; err.style.display = ''; return; }
  MF.ocupado = true; const ok = document.getElementById('mf-ok'); ok.disabled = true; ok.textContent = 'Cobrando…';
  const r = await rpc('mf_cobrar', { p: { credito_id: k.cr.id, monto: m, metodo_pago_id: met ? met.id : null, metodo_pago_nombre: met ? met.nombre : 'Efectivo',
    banco_id: banco || null, nota: document.getElementById('mf-nota').value.trim(), ref: k.ref, creado_por: perfilNombre() } });
  MF.ocupado = false;
  if (!r.ok) { err.textContent = r.msg; err.style.display = ''; ok.disabled = false; ok.textContent = `✅ Cobrar ${fmt(m)}`; return; }
  mostrarRecibo(r, k.cr, met ? met.nombre : 'Efectivo');
  await cargarDatos().catch(() => {});
}
function mostrarRecibo(r, cr, metodo) {
  const c = cliPorId(cr.cliente_id), tel = c?.whatsapp || c?.telefono || '', neg = MF.cfg.nombre_comercial || 'Mi negocio';
  const txt = `🧾 *Recibo ${r.recibo}* — ${neg}\nCliente: ${nombreCli(c)}\nCrédito: ${r.numero_credito || cr.numero_credito}\nFecha: ${new Date().toLocaleDateString('es-NI')}\nPagó: ${fmt(r.monto)} (${metodo})\nDebía: ${fmt(r.saldo_anterior)}\nAhora debe: ${fmt(r.saldo)}${r.proxima_fecha ? `\nPróximo pago: ${fCorta(r.proxima_fecha)} · ${fmt(r.proxima_monto)}` : ''}${r.cancelado ? '\n🎉 ¡Crédito pagado completo! Gracias.' : '\n¡Gracias por su pago!'}`;
  MF.ultimoRecibo = { txt, r, cr, metodo };
  modal(`<div class="tl-modal-cab"><h2>✅ Cobrado</h2><button class="tl-x" onclick="cerrarModal();mfTab(MF.tab)" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo"><div class="mf-recibo">
      <div class="mf-recibo-num">${esc(r.recibo)}${r.repetido ? ' <span class="pd-pill">ya estaba registrado</span>' : ''}</div>
      <div class="mf-recibo-monto">${fmt(r.monto)}</div><div>${esc(nombreCli(c))} · ${esc(metodo)}</div>
      <div class="mf-montos" style="margin-top:10px"><div><span>Debía</span><b>${fmt(r.saldo_anterior)}</b></div><div><span>Ahora debe</span><b>${fmt(r.saldo)}</b></div>
        <div><span>Próximo pago</span><b>${r.proxima_fecha ? fCorta(r.proxima_fecha) + ' · ' + fmt(r.proxima_monto) : '—'}</b></div></div>
      ${r.cancelado ? '<div class="tl-aviso ok">🎉 ¡Terminó de pagar este crédito!</div>' : ''}</div></div>
    <div class="tl-modal-pie">${tel ? `<a class="btn-secondary" href="https://wa.me/${waNum(tel)}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">💬 Recibo por WhatsApp</a>` : ''}
      <button class="btn-secondary" onclick="imprimirRecibo()">🖨️ Imprimir</button><button class="btn-primary" onclick="cerrarModal();mfTab(MF.tab)">Listo</button></div>`);
}
function imprimirRecibo() {
  const u = MF.ultimoRecibo; if (!u) return;
  const w = window.open('', '_blank', 'width=380,height=600'); if (!w) { showToast('Permite las ventanas emergentes para imprimir.', 'error'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(u.r.recibo)}</title><style>body{font-family:monospace;font-size:13px;width:58mm;margin:0 auto;padding:6px}h3{text-align:center;margin:4px 0}pre{white-space:pre-wrap;font-family:inherit}</style></head>
    <body><h3>${esc(MF.cfg.nombre_comercial || '')}</h3><pre>${esc(u.txt.replace(/\*/g, ''))}</pre><p style="text-align:center">_____________________<br>Firma</p><script>window.onload=()=>{window.print()}<\/script></body></html>`);
  w.document.close();
}

/* ---------- 🚪 no estaba / 🤝 promesa ---------- */
function abrirGestion(creditoId, tipo) {
  const cr = MF.creditos.find(x => x.id === creditoId); if (!cr) return;
  const c = cliPorId(cr.cliente_id);
  modal(`<div class="tl-modal-cab"><h2>${tipo === 'promesa' ? '🤝 Promete pagar' : '🚪 No estaba'} · ${esc(nombreCli(c))}</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
    <div class="tl-modal-cuerpo">${tipo === 'promesa' ? `<div class="tl-f"><label for="mf-gf">¿Qué día va a pagar?</label><input class="tl-inp" id="mf-gf" type="date" min="${hoyISO()}" value="${masDias(hoyISO(), 1)}"></div>` : '<p class="tl-muted">Queda anotado que lo visitaste y no estaba. No cambia lo que debe.</p>'}
      <div class="tl-f"><label for="mf-gn">Nota (opcional)</label><input class="tl-inp" id="mf-gn" maxlength="300" placeholder="${tipo === 'promesa' ? 'Ej. cobra el viernes' : 'Ej. casa cerrada'}"></div><div class="tl-aviso" id="mf-gerr" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="cerrarModal()">Cancelar</button><button class="btn-primary" id="mf-gok" onclick="guardarGestion('${creditoId}','${tipo}')">Guardar</button></div>`);
}
async function guardarGestion(creditoId, tipo) {
  if (MF.ocupado) return; MF.ocupado = true;
  const b = document.getElementById('mf-gok'); b.disabled = true;
  const r = await rpc('mf_gestion', { p: { credito_id: creditoId, tipo, fecha_promesa: tipo === 'promesa' ? document.getElementById('mf-gf').value : null, nota: document.getElementById('mf-gn').value.trim(), creado_por: perfilNombre() } });
  MF.ocupado = false;
  if (!r.ok) { const e = document.getElementById('mf-gerr'); e.textContent = r.msg; e.style.display = ''; b.disabled = false; return; }
  cerrarModal(); showToast('Anotado.'); await recargar();
}

/* ---------- 🛒 VENDER AL CRÉDITO ---------- */
function ventaNueva() {
  const hoy = hoyISO();
  MF.venta = { ref: ref(), tipo: 'productos', clienteId: '', items: [], monto: '', interes: '', recargo: '', prima: '', primaMetodo: (MF.metodos.find(m => /efectivo/i.test(m.nombre)) || MF.metodos[0] || {}).id || '',
    frec: 'semanal', n: 4, primera: masDias(hoy, 7), sinDom: true, nota: '', busca: '', buscaCli: '' };
}
function primeraPorFrec(f) { const h = hoyISO(); return f === 'diaria' ? masDias(h, 1) : f === 'semanal' ? masDias(h, 7) : f === 'quincenal' ? masDias(h, 15) : masMeses(h, 1); }
function calcVenta() {
  const V = MF.venta;
  if (V.tipo === 'productos') {
    const sub = r2(V.items.reduce((s, i) => s + r2(i.cantidad * i.precio), 0)), rec = r2(sub * (Number(V.recargo) || 0) / 100), total = r2(sub + rec);
    const prima = r2(V.prima), cap = r2(total - prima), n = Math.max(1, parseInt(V.n) || 1), cuota = r2(cap / n), ultima = r2(cap - cuota * (n - 1));
    return { sub, rec, total, prima, cap, interes: 0, n, cuota, ultima };
  }
  const cap = r2(V.monto), int = r2(cap * (Number(V.interes) || 0) / 100), total = r2(cap + int), n = Math.max(1, parseInt(V.n) || 1);
  const cuota = r2(r2(cap / n) + r2(int / n)), ultima = r2(total - cuota * (n - 1));
  return { sub: cap, rec: 0, total, prima: 0, cap, interes: int, n, cuota, ultima };
}
function fechaCuota(i) {
  const V = MF.venta;
  if (V.frec === 'diaria') { let d = V.primera; if (V.sinDom && new Date(d + 'T12:00:00').getDay() === 0) d = masDias(d, 1); for (let k = 0; k < i; k++) { d = masDias(d, 1); if (V.sinDom && new Date(d + 'T12:00:00').getDay() === 0) d = masDias(d, 1); } return d; }
  if (V.frec === 'semanal') return masDias(V.primera, 7 * i);
  if (V.frec === 'quincenal') return masDias(V.primera, 15 * i);
  return masMeses(V.primera, i);
}
function pintarVender(v) {
  if (!MF.venta) ventaNueva();
  const V = MF.venta, c = cliPorId(V.clienteId);
  v.innerHTML = `<div class="pd-card"><h3>1. ¿A quién?</h3>
      ${c ? `<div class="mf-elegido"><div><b>${esc(nombreCli(c))}</b><div class="tl-muted">${esc(c.telefono || c.whatsapp || 'Sin teléfono')}${c.direccion ? ' · 📍 ' + esc(c.direccion) : ''}</div></div><button class="btn-secondary" onclick="MF.venta.clienteId='';pintarVender(document.getElementById('pd-vista'))">Cambiar</button></div>`
        : `<div class="vd-filtros"><input type="search" class="tl-inp" style="flex:1;min-width:0" id="mf-bcli" placeholder="🔎 Buscar cliente por nombre o teléfono" value="${esc(V.buscaCli)}" oninput="MF.venta.buscaCli=this.value;pintarCliOpc()" aria-label="Buscar cliente">
          <button class="btn-secondary" onclick="abrirNuevoCliente()">＋ Nuevo cliente</button></div><div id="mf-cli-opc"></div>`}</div>
    <div class="pd-card"><h3>2. ¿Qué se lleva?</h3>
      <div class="pd-tabs" style="margin-bottom:10px"><button class="pd-tab ${V.tipo === 'productos' ? 'activa' : ''}" onclick="MF.venta.tipo='productos';pintarVender(document.getElementById('pd-vista'))">🛍️ Productos</button>
        <button class="pd-tab ${V.tipo === 'efectivo' ? 'activa' : ''}" onclick="MF.venta.tipo='efectivo';pintarVender(document.getElementById('pd-vista'))">💵 Préstamo en efectivo</button></div>
      ${V.tipo === 'productos' ? `<input type="search" class="tl-inp" id="mf-bprod" placeholder="🔎 Buscar producto por nombre o código" value="${esc(V.busca)}" oninput="MF.venta.busca=this.value;pintarProdOpc()" aria-label="Buscar producto">
        <div id="mf-prod-opc"></div><div id="mf-items"></div>
        <div class="tl-grid" style="margin-top:10px"><div class="tl-f"><label for="mf-rec">Recargo por crédito % (opcional)</label><input class="tl-inp" id="mf-rec" type="number" inputmode="decimal" min="0" max="300" step="0.01" value="${esc(V.recargo)}" placeholder="0" oninput="MF.venta.recargo=this.value;pintarResumenVenta()"></div>
          <div class="tl-f"><label for="mf-prima">Prima hoy (opcional)</label><input class="tl-inp" id="mf-prima" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(V.prima)}" placeholder="0.00" oninput="MF.venta.prima=this.value;pintarResumenVenta()"></div>
          <div class="tl-f" id="mf-pmet-w"><label for="mf-pmet">¿Cómo pagó la prima?</label><select class="tl-sel" id="mf-pmet" onchange="MF.venta.primaMetodo=this.value">${opcionesMetodo(V.primaMetodo)}</select></div></div>`
      : `<div class="tl-grid"><div class="tl-f"><label for="mf-monto-p">¿Cuánto le prestas?</label><input class="tl-inp mf-monto-inp" id="mf-monto-p" type="number" inputmode="decimal" min="1" step="0.01" value="${esc(V.monto)}" placeholder="0.00" oninput="MF.venta.monto=this.value;pintarResumenVenta()"></div>
          <div class="tl-f"><label for="mf-int">Interés total %</label><input class="tl-inp" id="mf-int" type="number" inputmode="decimal" min="0" max="300" step="0.01" value="${esc(V.interes)}" placeholder="0" oninput="MF.venta.interes=this.value;pintarResumenVenta()"></div></div>
        <p class="tl-muted" style="margin-top:6px">El dinero sale de <b>Caja</b>. El interés se cobra repartido en las cuotas.</p>`}</div>
    <div class="pd-card"><h3>3. ¿Cómo va a pagar?</h3>
      <div class="pd-tabs">${Object.entries(FREC).map(([k, t]) => `<button class="pd-tab ${V.frec === k ? 'activa' : ''}" onclick="MF.venta.frec='${k}';MF.venta.primera=primeraPorFrec('${k}');pintarVender(document.getElementById('pd-vista'))">${t}</button>`).join('')}</div>
      <div class="tl-grid"><div class="tl-f"><label for="mf-n">¿Cuántas cuotas?</label><input class="tl-inp" id="mf-n" type="number" inputmode="numeric" min="1" max="365" step="1" value="${esc(V.n)}" oninput="MF.venta.n=this.value;pintarResumenVenta()"></div>
        <div class="tl-f"><label for="mf-pf">Primer pago</label><input class="tl-inp" id="mf-pf" type="date" min="${hoyISO()}" value="${esc(V.primera)}" onchange="MF.venta.primera=this.value;pintarResumenVenta()"></div>
        ${V.frec === 'diaria' ? `<label class="tl-f full" style="flex-direction:row;align-items:center;gap:8px;font-weight:600"><input type="checkbox" ${V.sinDom ? 'checked' : ''} onchange="MF.venta.sinDom=this.checked;pintarResumenVenta()" style="width:18px;height:18px"> No cobrar los domingos</label>` : ''}
        <div class="tl-f full"><label for="mf-vnota">Nota (opcional)</label><input class="tl-inp" id="mf-vnota" maxlength="300" value="${esc(V.nota)}" oninput="MF.venta.nota=this.value"></div></div></div>
    <div class="pd-card mf-resumen-card" id="mf-resumen"></div>`;
  if (!c) pintarCliOpc();
  if (V.tipo === 'productos') { pintarProdOpc(); pintarItems(); }
  pintarResumenVenta();
}
function pintarCliOpc() {
  const el = document.getElementById('mf-cli-opc'); if (!el) return;
  const f = MF.venta.buscaCli.trim().toLowerCase();
  if (!f) { el.innerHTML = '<p class="tl-muted">Escribe para buscar, o crea uno nuevo.</p>'; return; }
  const l = MF.clientes.filter(c => nombreCli(c).toLowerCase().includes(f) || String(c.telefono || '').includes(f)).slice(0, 8);
  el.innerHTML = l.length ? l.map(c => `<button type="button" class="mf-opc" onclick="MF.venta.clienteId='${c.id}';MF.venta.buscaCli='';pintarVender(document.getElementById('pd-vista'))"><b>${esc(nombreCli(c))}</b><span class="tl-muted">${esc(c.telefono || '')}</span></button>`).join('')
    : '<p class="tl-muted">No se encontró. Usa “＋ Nuevo cliente”.</p>';
}
function pintarProdOpc() {
  const el = document.getElementById('mf-prod-opc'); if (!el) return;
  const f = MF.venta.busca.trim().toLowerCase();
  if (!f) { el.innerHTML = ''; return; }
  const l = MF.productos.filter(p => p.nombre.toLowerCase().includes(f) || String(p.sku || '').toLowerCase() === f || String(p.codigo_barras || '') === f).slice(0, 8);
  el.innerHTML = l.length ? l.map(p => `<button type="button" class="mf-opc" onclick="agregarItem('${p.id}')"><b>${esc(p.nombre)}</b><span class="tl-muted">${fmt(p.precio)}${p.tipo === 'producto' ? ' · hay ' + Number(p.stock_actual || 0) : ''}</span></button>`).join('') : '<p class="tl-muted">No se encontró ese producto.</p>';
}
function agregarItem(id) {
  const p = MF.productos.find(x => x.id === id); if (!p) return;
  const ex = MF.venta.items.find(i => i.producto_id === id);
  if (ex) ex.cantidad = r2(ex.cantidad + 1); else MF.venta.items.push({ producto_id: id, nombre: p.nombre, cantidad: 1, precio: r2(p.precio), stock: p.tipo === 'producto' ? Number(p.stock_actual || 0) : null });
  MF.venta.busca = ''; const b = document.getElementById('mf-bprod'); if (b) b.value = '';
  pintarProdOpc(); pintarItems(); pintarResumenVenta();
}
function pintarItems() {
  const el = document.getElementById('mf-items'); if (!el) return;
  const it = MF.venta.items;
  el.innerHTML = it.length ? `<div class="mf-items">${it.map((i, k) => `<div class="mf-item"><div class="mf-item-n"><b>${esc(i.nombre)}</b>${i.stock != null && i.cantidad > i.stock ? `<span class="pd-pill mal">solo hay ${i.stock}</span>` : ''}</div>
      <input class="pd-inp mini" type="number" inputmode="decimal" min="0.01" step="any" value="${i.cantidad}" aria-label="Cantidad" oninput="MF.venta.items[${k}].cantidad=Number(this.value)||0;pintarResumenVenta()">
      <span class="tl-muted">×</span><input class="pd-inp" type="number" inputmode="decimal" min="0" step="0.01" value="${i.precio}" aria-label="Precio" oninput="MF.venta.items[${k}].precio=Number(this.value)||0;pintarResumenVenta()">
      <button class="tl-x" title="Quitar" onclick="MF.venta.items.splice(${k},1);pintarItems();pintarResumenVenta()">✕</button></div>`).join('')}</div>`
    : '<p class="tl-muted" style="margin-top:6px">Busca y toca un producto para agregarlo.</p>';
}
function pintarResumenVenta() {
  const el = document.getElementById('mf-resumen'); if (!el) return;
  const V = MF.venta, k = calcVenta(), c = cliPorId(V.clienteId);
  const faltas = [];
  if (!c) faltas.push('elige el cliente');
  if (V.tipo === 'productos' && !V.items.length) faltas.push('agrega productos');
  if (V.tipo === 'productos' && V.items.some(i => !(i.cantidad > 0) || i.precio < 0)) faltas.push('revisa cantidades y precios');
  if (V.tipo === 'productos' && V.items.some(i => i.stock != null && i.cantidad > i.stock)) faltas.push('hay productos sin suficientes existencias');
  if (V.tipo === 'efectivo' && !(k.cap > 0)) faltas.push('escribe cuánto le prestas');
  if (!(k.total > 0)) faltas.push('el total debe ser mayor que cero');
  if (k.prima < 0 || (k.prima > 0 && k.prima >= k.total)) faltas.push('la prima debe ser menor que el total');
  if (!(k.n >= 1 && k.n <= 365)) faltas.push('las cuotas van de 1 a 365');
  if (!V.primera) faltas.push('elige el primer pago');
  const pw = document.getElementById('mf-pmet-w'); if (pw) pw.style.display = k.prima > 0 ? '' : 'none';
  const ult = V.primera ? fechaCuota(k.n - 1) : null;
  const cada = V.frec === 'semanal' && V.primera ? 'cada ' + diaSemana(V.primera) : V.frec === 'diaria' ? (V.sinDom ? 'cada día (menos domingo)' : 'cada día') : V.frec === 'quincenal' ? 'cada 15 días' : 'cada mes';
  el.innerHTML = `<h3>4. Resumen</h3>
    <div class="mf-montos">${V.tipo === 'productos' ? `<div><span>Productos</span><b>${fmt(k.sub)}</b></div>${k.rec > 0 ? `<div><span>Recargo</span><b>${fmt(k.rec)}</b></div>` : ''}`
      : `<div><span>Prestas</span><b>${fmt(k.cap)}</b></div><div><span>Interés</span><b>${fmt(k.interes)}</b></div>`}
      <div><span>Total del crédito</span><b>${fmt(k.total)}</b></div>${k.prima > 0 ? `<div><span>Prima hoy</span><b class="pd-verde">${fmt(k.prima)}</b></div>` : ''}</div>
    ${k.total > 0 && k.n >= 1 ? `<div class="mf-plan">💳 <b>${k.n} cuota${k.n === 1 ? '' : 's'} de ${fmt(k.cuota)}</b> ${esc(cada)}${Math.abs(k.ultima - k.cuota) > 0.004 && k.n > 1 ? ` <span class="tl-muted">(la última de ${fmt(k.ultima)})</span>` : ''}<br>
      <span class="tl-muted">Primer pago: ${fCorta(V.primera)} · Último: ${fCorta(ult)}</span></div>` : ''}
    ${faltas.length ? `<div class="tl-aviso">Falta: ${esc(faltas.join(', '))}.</div>` : `<div class="tl-aviso ok">${V.tipo === 'productos' ? 'Se registra la venta a crédito: baja el inventario' + (k.prima > 0 ? ', la prima entra a Caja' : '') + ' y queda en Créditos.' : 'El dinero sale de Caja y queda el crédito en Créditos.'}</div>`}
    <div class="pd-acciones"><button class="btn-primary mf-grande" id="mf-vok" ${faltas.length ? 'disabled' : ''} onclick="confirmarVenta()">✅ ${V.tipo === 'productos' ? 'Vender al crédito' : 'Prestar'} ${k.total > 0 ? fmt(k.total) : ''}</button>
      <button class="btn-secondary" onclick="if(confirm('¿Empezar de nuevo? Se borra lo que llevas.')){ventaNueva();pintarVender(document.getElementById('pd-vista'))}">Empezar de nuevo</button></div>
    <div class="tl-aviso" id="mf-verr" style="display:none;margin-top:8px"></div>`;
}
async function confirmarVenta() {
  const V = MF.venta; if (!V || MF.ocupado) return;
  const k = calcVenta(), c = cliPorId(V.clienteId); if (!c) return;
  const met = MF.metodos.find(m => m.id === V.primaMetodo) || null;
  const pregunta = V.tipo === 'productos'
    ? `¿Vender al crédito a ${nombreCli(c)} por ${fmt(k.total)}${k.prima > 0 ? ' (prima ' + fmt(k.prima) + ')' : ''}, en ${k.n} cuotas de ${fmt(k.cuota)}?`
    : `¿Prestar ${fmt(k.cap)} a ${nombreCli(c)}? Sale de Caja. Devuelve ${fmt(k.total)} en ${k.n} cuotas de ${fmt(k.cuota)}.`;
  if (!confirm(pregunta)) return;
  MF.ocupado = true; const b = document.getElementById('mf-vok'); b.disabled = true; b.textContent = 'Guardando…';
  const p = { tipo: V.tipo, cliente_id: V.clienteId, frecuencia: V.frec, num_cuotas: k.n, primera_fecha: V.primera, sin_domingos: V.frec === 'diaria' ? !!V.sinDom : false,
    nota: V.nota, ref: V.ref, creado_por: perfilNombre() };
  if (V.tipo === 'productos') Object.assign(p, { items: V.items.map(i => ({ producto_id: i.producto_id, cantidad: r2(i.cantidad), precio: r2(i.precio) })), recargo_pct: Number(V.recargo) || 0,
    prima: k.prima, prima_metodo_id: met ? met.id : null, prima_metodo_nombre: met ? met.nombre : 'Efectivo' });
  else Object.assign(p, { monto: k.cap, interes_pct: Number(V.interes) || 0 });
  const r = await rpc('mf_credito_crear', { p });
  MF.ocupado = false;
  if (!r.ok) { const e = document.getElementById('mf-verr'); e.textContent = r.msg; e.style.display = ''; b.disabled = false; b.textContent = '✅ Intentar de nuevo'; return; }
  const tel = c.whatsapp || c.telefono || '', neg = MF.cfg.nombre_comercial || 'Mi negocio';
  const txt = `🧾 *${neg}*\nHola ${nombreCli(c).split(' ')[0]} 👋, este es su plan de pago:\nCrédito: ${r.numero_credito}${r.numero_venta ? ' (venta ' + r.numero_venta + ')' : ''}\nTotal: ${fmt(r.total)}${Number(r.prima) > 0 ? `\nPrima pagada: ${fmt(r.prima)} (recibo ${r.recibo_prima})` : ''}\nCuotas: ${r.cuotas} de ${fmt(r.cuota)} (${FREC[V.frec].toLowerCase()})\nPrimer pago: ${fCorta(V.primera)}\n¡Gracias por su preferencia!`;
  ventaNueva();
  await cargarDatos().catch(() => {});
  modal(`<div class="tl-modal-cab"><h2>✅ ${r.repetido ? 'Ya estaba registrado' : 'Listo'}</h2><button class="tl-x" onclick="cerrarModal();mfTab('vender')">✕</button></div>
    <div class="tl-modal-cuerpo"><div class="mf-recibo"><div class="mf-recibo-num">${esc(r.numero_credito || '')}</div>
      ${r.repetido ? '<p>Este crédito ya se había guardado (no se duplicó).</p>' : `<div class="mf-recibo-monto">${fmt(r.total)}</div><div>${esc(nombreCli(c))}</div>
      <div class="mf-montos" style="margin-top:10px"><div><span>Cuotas</span><b>${r.cuotas} de ${fmt(r.cuota)}</b></div><div><span>Debe</span><b>${fmt(r.saldo)}</b></div>${Number(r.prima) > 0 ? `<div><span>Prima</span><b>${fmt(r.prima)}</b></div>` : ''}</div>`}</div></div>
    <div class="tl-modal-pie">${tel && !r.repetido ? `<a class="btn-secondary" href="https://wa.me/${waNum(tel)}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">💬 Enviar plan por WhatsApp</a>` : ''}
      <button class="btn-secondary" onclick="cerrarModal();abrirTarjeta('${c.id}')">📒 Ver tarjeta</button><button class="btn-primary" onclick="cerrarModal();mfTab('vender')">Nueva venta</button></div>`);
}
function abrirNuevoCliente() {
  modal(`<div class="tl-modal-cab"><h2>＋ Nuevo cliente</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
    <div class="tl-modal-cuerpo"><div class="tl-grid"><div class="tl-f full"><label for="nc-nom">Nombre completo *</label><input class="tl-inp" id="nc-nom" maxlength="120" value="${esc(MF.venta?.buscaCli || '')}"></div>
      <div class="tl-f"><label for="nc-tel">Teléfono / WhatsApp</label><input class="tl-inp" id="nc-tel" inputmode="tel" maxlength="30"></div>
      <div class="tl-f"><label for="nc-ced">Cédula (opcional)</label><input class="tl-inp" id="nc-ced" maxlength="30"></div>
      <div class="tl-f full"><label for="nc-dir">Dirección (para la ruta)</label><input class="tl-inp" id="nc-dir" maxlength="250" placeholder="Barrio, de la iglesia 2c al sur…"></div></div>
      <div class="tl-aviso" id="nc-err" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="cerrarModal()">Cancelar</button><button class="btn-primary" id="nc-ok" onclick="guardarNuevoCliente()">Guardar cliente</button></div>`);
  setTimeout(() => document.getElementById('nc-nom')?.focus(), 60);
}
async function guardarNuevoCliente() {
  if (MF.ocupado) return;
  const nom = document.getElementById('nc-nom').value.trim().replace(/\s+/g, ' '), err = document.getElementById('nc-err');
  if (nom.length < 2) { err.textContent = 'Escribe el nombre.'; err.style.display = ''; return; }
  const tel = document.getElementById('nc-tel').value.trim();
  const dup = MF.clientes.find(c => nombreCli(c).toLowerCase() === nom.toLowerCase() || (tel && String(c.telefono || '').replace(/\D/g, '') === tel.replace(/\D/g, '')));
  if (dup && !confirm(`Ya tienes a "${nombreCli(dup)}"${dup.telefono ? ' (' + dup.telefono + ')' : ''}. ¿Crear otro cliente igual?`)) { MF.venta.clienteId = dup.id; cerrarModal(); pintarVender(document.getElementById('pd-vista')); return; }
  MF.ocupado = true; document.getElementById('nc-ok').disabled = true;
  try {
    const fila = { auth_user_id: MF.userId, nombre: nom, telefono: tel || null, direccion: document.getElementById('nc-dir').value.trim() || null, activo: true };
    const ced = document.getElementById('nc-ced').value.trim(); if (ced) fila.cedula = ced;
    let { data, error } = await sb.from('clientes').insert(fila).select('id,nombre,apellido,telefono,whatsapp,direccion').single();
    if (error && /cedula/.test(error.message || '')) { delete fila.cedula; ({ data, error } = await sb.from('clientes').insert(fila).select('id,nombre,apellido,telefono,whatsapp,direccion').single()); }
    if (error) throw error;
    MF.clientes.push(data); MF.venta.clienteId = data.id; MF.venta.buscaCli = '';
    cerrarModal(true); showToast('Cliente guardado.'); pintarVender(document.getElementById('pd-vista'));
  } catch (e) { console.error(e); err.textContent = 'No se pudo guardar el cliente. Intenta de nuevo.'; err.style.display = ''; document.getElementById('nc-ok').disabled = false; }
  finally { MF.ocupado = false; }
}

/* ---------- 📒 CLIENTES y TARJETA ---------- */
function pintarClientes(v) {
  const porCli = {};
  MF.creditos.forEach(cr => { const s = situacion(cr), k = porCli[cr.cliente_id] || (porCli[cr.cliente_id] = { saldo: 0, atrasado: 0, dias: 0, n: 0 }); k.saldo = r2(k.saldo + s.saldo); k.atrasado = r2(k.atrasado + s.atrasado); k.dias = Math.max(k.dias, s.dias); k.n++; });
  const f = MF.filtroCli.trim().toLowerCase();
  const l = Object.entries(porCli).map(([id, k]) => ({ c: cliPorId(id) || { id, nombre: 'Cliente' }, k }))
    .filter(x => !f || nombreCli(x.c).toLowerCase().includes(f) || String(x.c.telefono || '').includes(f)).sort((a, b) => (b.k.dias - a.k.dias) || (b.k.saldo - a.k.saldo));
  v.innerHTML = `<div class="vd-filtros"><input type="search" class="tl-inp" style="flex:1;min-width:0" placeholder="🔎 Buscar cliente" value="${esc(MF.filtroCli)}" oninput="MF.filtroCli=this.value;pintarClientes(document.getElementById('pd-vista'))" aria-label="Buscar cliente"></div>
    ${l.length ? `<div class="mf-lista">${l.map(x => `<button type="button" class="mf-card mf-cli" onclick="abrirTarjeta('${x.c.id}')">
      <div class="mf-card-cab"><div style="min-width:0;text-align:left"><b class="mf-nom">${esc(nombreCli(x.c))}</b><div class="tl-muted">${x.k.n} crédito${x.k.n === 1 ? '' : 's'}${x.c.telefono ? ' · ' + esc(x.c.telefono) : ''}</div></div>
      ${x.k.dias > 0 ? `<span class="pd-pill mal">⏰ ${x.k.dias} días</span>` : '<span class="pd-pill ok">Al día</span>'}</div>
      <div class="mf-montos"><div><span>Debe</span><b>${fmt(x.k.saldo)}</b></div><div><span>Atrasado</span><b class="${x.k.atrasado > 0 ? 'pd-rojo' : ''}">${fmt(x.k.atrasado)}</b></div></div></button>`).join('')}</div>`
      : `<div class="pd-vacio"><div class="ico">📒</div><b>${f ? 'No se encontró.' : 'Todavía no hay clientes con crédito.'}</b><p class="tl-muted">Vende al crédito en la pestaña “Vender”.</p></div>`}`;
  if (document.activeElement && document.activeElement.type === 'search') { const i = v.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
async function abrirTarjeta(clienteId) {
  const c = cliPorId(clienteId) || { id: clienteId, nombre: 'Cliente' };
  modal(`<div class="tl-modal-cab"><h2>📒 ${esc(nombreCli(c))}</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div><div class="tl-modal-cuerpo"><p class="tl-muted">Cargando la tarjeta…</p></div>`);
  try {
    const { data: creds, error } = await sb.from('creditos').select('id,numero_credito,tipo,total_financiado,saldo_pendiente,estado,frecuencia,valor_cuota_aprox,created_at,venta_id')
      .eq('auth_user_id', MF.userId).eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const ids = (creds || []).map(x => x.id);
    const [cu, pa] = ids.length ? await Promise.all([
      sb.from('creditos_cuotas').select('credito_id,numero,fecha_vencimiento,monto_total,monto_pagado,estado').in('credito_id', ids).order('numero'),
      sb.from('creditos_pagos').select('id,credito_id,fecha,monto,estado,comprobante_numero,metodo_pago_nombre,observaciones,anulado_motivo,created_at').in('credito_id', ids).order('created_at', { ascending: false }),
    ]) : [{ data: [] }, { data: [] }];
    const hoy = hoyISO();
    const html = (creds || []).map(cr => {
      const qs = (cu.data || []).filter(q => q.credito_id === cr.id), ps = (pa.data || []).filter(p => p.credito_id === cr.id);
      const pagado = r2(Number(cr.total_financiado) - Number(cr.saldo_pendiente)), pct = cr.total_financiado > 0 ? Math.round(pagado / cr.total_financiado * 100) : 0;
      const activo = Number(cr.saldo_pendiente) > 0.004 && !['cancelado', 'refinanciado'].includes(cr.estado);
      return `<div class="pd-card" style="margin-bottom:10px"><div class="mf-card-cab"><div><b>${esc(cr.numero_credito)}</b> <span class="tl-muted">${cr.tipo === 'venta' ? '🛍️ Productos' : '💵 Préstamo'} · ${esc(FREC[cr.frecuencia] || cr.frecuencia || '')} · ${fCorta(String(cr.created_at).slice(0, 10))}</span></div>
          ${activo ? `<button class="btn-primary" onclick="cerrarModal();abrirCobroDesdeTarjeta('${cr.id}')">💵 Cobrar</button>` : '<span class="pd-pill ok">✅ Pagado</span>'}</div>
        <div class="mf-montos"><div><span>Total</span><b>${fmt(cr.total_financiado)}</b></div><div><span>Pagado</span><b class="pd-verde">${fmt(pagado)}</b></div><div><span>Debe</span><b>${fmt(cr.saldo_pendiente)}</b></div></div>
        <div class="vd-barra" style="margin:8px 0"><i style="width:${Math.min(100, pct)}%"></i></div>
        <details><summary class="tl-muted" style="cursor:pointer">Ver cuotas (${qs.length})</summary><div class="pd-tw"><table class="tl-tabla"><thead><tr><th>#</th><th>Fecha</th><th class="tl-num">Cuota</th><th class="tl-num">Pagado</th><th>Estado</th></tr></thead><tbody>
          ${qs.map(q => { const vencida = q.estado !== 'pagada' && String(q.fecha_vencimiento).slice(0, 10) < hoy;
            return `<tr><td data-t="#">${q.numero}</td><td data-t="Fecha">${fCorta(q.fecha_vencimiento)}</td><td class="tl-num" data-t="Cuota">${fmt(q.monto_total)}</td><td class="tl-num" data-t="Pagado">${fmt(q.monto_pagado)}</td>
              <td data-t="Estado">${q.estado === 'pagada' ? '<span class="pd-pill ok">Pagada</span>' : vencida ? '<span class="pd-pill mal">Atrasada</span>' : q.estado === 'parcial' ? '<span class="pd-pill ambar">Parcial</span>' : '<span class="pd-pill">Pendiente</span>'}</td></tr>`; }).join('')}</tbody></table></div></details>
        <details open><summary class="tl-muted" style="cursor:pointer">Pagos (${ps.length})</summary>${ps.length ? `<div class="pd-tw"><table class="tl-tabla"><tbody>${ps.map(p => `<tr${p.estado === 'anulado' ? ' style="opacity:.55"' : ''}>
          <td data-t="Recibo"><b>${esc(p.comprobante_numero || '—')}</b>${p.estado === 'anulado' ? ' <span class="pd-pill mal">Anulado</span>' : ''}<div class="tl-muted">${esc(p.observaciones || '')}${p.anulado_motivo ? ' · ' + esc(p.anulado_motivo) : ''}</div></td>
          <td data-t="Fecha">${fCorta(p.fecha)}</td><td class="tl-num" data-t="Monto">${fmt(p.monto)}</td><td data-t="Cómo">${esc(p.metodo_pago_nombre || '')}</td>
          <td class="tl-ac">${p.estado !== 'anulado' && String(p.comprobante_numero || '').startsWith('R-') ? `<button class="btn-secondary" style="padding:5px 9px;font-size:12px" onclick="anularCobro('${p.id}','${esc(p.comprobante_numero)}','${clienteId}')">Anular</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tl-muted">Sin pagos todavía.</p>'}</details></div>`;
    }).join('');
    const tel = c.whatsapp || c.telefono || '';
    document.getElementById('pd-modal-box').innerHTML = `<div class="tl-modal-cab"><h2>📒 ${esc(nombreCli(c))}</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
      <div class="tl-modal-cuerpo"><div class="tl-muted">${esc(c.telefono || '')}${c.direccion ? ' · 📍 ' + esc(c.direccion) : ''}${tel ? ` · <a href="https://wa.me/${waNum(tel)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div>
      ${html || '<div class="pd-vacio"><b>Sin créditos.</b></div>'}</div>`;
  } catch (e) { console.error(e); document.getElementById('pd-modal-box').innerHTML = '<div class="tl-modal-cuerpo"><div class="tl-aviso">No se pudo cargar la tarjeta. Revisa tu conexión.</div><button class="btn-secondary" onclick="cerrarModal()">Cerrar</button></div>'; }
}
function abrirCobroDesdeTarjeta(creditoId) {
  if (!MF.creditos.find(x => x.id === creditoId)) { showToast('Ese crédito ya no tiene saldo. Actualiza la pantalla.', 'error'); return; }
  abrirCobro(creditoId);
}
async function anularCobro(pagoId, recibo, clienteId) {
  const motivo = prompt(`¿Por qué se anula el cobro ${recibo}?\nSe resta de Caja y vuelve al saldo del cliente. No se puede deshacer.`);
  if (motivo == null) return;
  if (motivo.trim().length < 3) { showToast('Escribe el motivo (mínimo 3 letras).', 'error'); return; }
  if (MF.ocupado) return; MF.ocupado = true;
  const r = await rpc('mf_anular_pago', { p_pago_id: pagoId, p_motivo: motivo.trim() });
  MF.ocupado = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast(`Cobro ${r.recibo} anulado. Saldo: ${fmt(r.saldo)}.`);
  await cargarDatos().catch(() => {});
  abrirTarjeta(clienteId);
}

/* ---------- 📊 RESUMEN ---------- */
function pintarResumen(v) {
  const sit = MF.creditos.map(cr => ({ cr, s: situacion(cr) }));
  const debe = r2(sit.reduce((a, x) => a + x.s.saldo, 0)), atr = r2(sit.reduce((a, x) => a + x.s.atrasado, 0));
  const cliAtr = new Set(sit.filter(x => x.s.dias > 0).map(x => x.cr.cliente_id)).size;
  const hoy = r2(MF.pagosHoy.reduce((a, p) => a + Number(p.monto || 0), 0)), sem = r2(MF.pagosSemana.reduce((a, p) => a + Number(p.monto || 0), 0));
  const pctAtr = debe > 0 ? Math.round(atr / debe * 100) : 0;
  const top = sit.filter(x => x.s.dias > 0).sort((a, b) => b.s.dias - a.s.dias || b.s.atrasado - a.s.atrasado).slice(0, 10);
  v.innerHTML = `<div class="pd-kpis">
      <div class="pd-kpi"><div class="pd-kpi-l">💰 Te deben</div><div class="pd-kpi-v">${fmt(debe)}</div><div class="pd-kpi-s">${MF.creditos.length} crédito(s) vigentes</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">⏰ Atrasado</div><div class="pd-kpi-v pd-rojo">${fmt(atr)}</div><div class="pd-kpi-s">${cliAtr} cliente(s) · ${pctAtr}% de lo que te deben</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">💵 Cobrado hoy</div><div class="pd-kpi-v pd-verde">${fmt(hoy)}</div><div class="pd-kpi-s">${MF.pagosHoy.length} recibo(s)</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">📅 Cobrado 7 días</div><div class="pd-kpi-v">${fmt(sem)}</div><div class="pd-kpi-s">${MF.pagosSemana.length} recibo(s)</div></div></div>
    <div class="pd-card"><h3>⏰ Los más atrasados</h3>${top.length ? `<div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Cliente</th><th>Crédito</th><th class="tl-num">Días</th><th class="tl-num">Atrasado</th><th class="tl-num">Debe</th><th></th></tr></thead><tbody>
      ${top.map(x => { const c = cliPorId(x.cr.cliente_id); return `<tr><td data-t="Cliente"><b>${esc(nombreCli(c))}</b></td><td data-t="Crédito">${esc(x.cr.numero_credito)}</td><td class="tl-num pd-rojo" data-t="Días">${x.s.dias}</td>
        <td class="tl-num" data-t="Atrasado">${fmt(x.s.atrasado)}</td><td class="tl-num" data-t="Debe">${fmt(x.s.saldo)}</td><td class="tl-ac"><button class="btn-primary" style="padding:6px 10px;font-size:12.5px" onclick="abrirCobro('${x.cr.id}')">💵 Cobrar</button></td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="tl-muted">🎉 Nadie está atrasado.</p>'}</div>
    <p class="tl-muted">Todo esto también está en <a href="creditos.html">Créditos</a>, <a href="caja.html">Caja</a> y <a href="ventas.html">Ventas</a>, como siempre.</p>`;
}

/* ---------- ventana ---------- */
function modal(html) { document.getElementById('pd-modal-box').innerHTML = html; document.getElementById('pd-modal').classList.add('abierto'); }
function cerrarModal(forzar) { if (MF.ocupado && !forzar) return; document.getElementById('pd-modal').classList.remove('abierto'); MF.cobro = null; }
function pdCerrarModal() { cerrarModal(); }

/* ---------- arranque ---------- */
async function mfInit() {
  applyTheme((() => { try { return localStorage.getItem('n360_theme') || 'light'; } catch (_) { return 'light'; } })());
  const f = document.getElementById('header-fecha'); if (f) f.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user; MF.userId = user.id;
    const { data: cfg } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', user.id).maybeSingle();
    MF.cfg = cfg || {};
    if (cfg?.color_principal) { document.documentElement.style.setProperty('--accent', cfg.color_principal); document.documentElement.style.setProperty('--accent-soft', cfg.color_principal + '22'); }
    const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const { data: perfil } = await sb.from('usuarios').select('*').eq('auth_user_id', user.id).maybeSingle();
    let nombre = perfil ? (`${perfil.nombre || ''} ${perfil.apellido || ''}`.trim() || user.email?.split('@')[0]) : user.email?.split('@')[0];
    try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.nombre) nombre = String(pf.nombre).slice(0, 100); } catch (_) {}
    const hn = document.getElementById('header-name'); if (hn) hn.textContent = nombre || 'Usuario';
    const hb = document.getElementById('header-biz'); if (hb) hb.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const ha = document.getElementById('header-avatar'); if (ha) ha.textContent = ((nombre || 'U')[0] || 'U').toUpperCase();
    const pt = document.getElementById('plan-text'); if (pt) pt.textContent = perfil?.plan ? String(perfil.plan).charAt(0).toUpperCase() + String(perfil.plan).slice(1) : 'Plan';
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    if (MF.cfg.usa_modulo_microfinanciera !== true) {
      document.getElementById('content').innerHTML = `<div class="tl-apagado"><div style="font-size:42px">💼</div><h2>El Panel Microfinanciera está apagado</h2>
        <p>Actívalo en <b>Configuración → Panel Microfinanciera</b> para vender al crédito, cobrar en ruta y llevar la tarjeta de cada cliente.</p>
        <button class="btn-primary" onclick="navigate('configuracion.html')">Ir a Configuración</button></div>`;
      return;
    }
    await cargarDatos();
    const ini = (location.hash || '').replace('#', '');
    await mfTab(['ruta', 'vender', 'clientes', 'resumen'].includes(ini) ? ini : 'ruta');
  } catch (e) {
    console.error('mfInit:', e);
    document.getElementById('loader').classList.add('hidden'); document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando el panel. Revisa tu conexión.', 'error');
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', mfInit);
