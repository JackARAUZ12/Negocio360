/* ============================================================
   MICROFINANCIERA.JS — NEGOCIO360 · Panel Microfinanciera (Nivel 1 + Nivel 2: trabajo en equipo)
   Vender al crédito (productos o efectivo), ruta de cobro del día, cobrar con recibo,
   tarjeta del cliente y resumen. Nivel 2 (opcional, apagado por defecto): cada persona entra
   con SU PIN; el servidor le da una llave del día y valida qué puede hacer (cobrador solo su
   cartera, no anula; dueño/supervisor reciben la entrega del día con cuadre en Caja).
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
  venta: null, cobro: null, filtroCli: '', filtroRuta: '', rutaOrden: 'zona', rutaZona: '', ocultarVisitados: false,
  ses: null, perfiles: [], equipo: [], selAsig: {}, cola: [], enviando: false,
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
// Días de cobro: 'todos' | 'lun_sab' (sin domingo) | 'lun_vie' (sin sábado ni domingo). Mismo cálculo que el servidor.
const DIAS_COBRO = { lun_vie: 'Lunes a viernes', lun_sab: 'Lunes a sábado', todos: 'Todos los días' };
function diasCobroNegocio() { const d = MF.cfg?.mf_dias_cobro; return DIAS_COBRO[d] ? d : 'lun_sab'; }
function seCobra(iso, dias) { const w = new Date(iso + 'T12:00:00').getDay(); return dias === 'lun_vie' ? (w >= 1 && w <= 5) : dias === 'lun_sab' ? w !== 0 : true; }
function siguienteCobro(iso, dias) { let d = iso, g = 0; while (!seCobra(d, dias) && g++ < 7) d = masDias(d, 1); return d; }
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
  sesion: 'Tu sesión del Panel terminó. Entra otra vez con tu PIN.', permiso: 'Tu usuario no tiene permiso para hacer eso.',
  no_es_tuyo: 'Ese crédito no está en tu cartera.', entregado: 'Ese cobro ya fue entregado y cuadrado: ya no se puede anular.',
  nada: 'Esa persona no tiene cobros pendientes de entregar.', propia: 'No puedes recibir tu propia entrega: que la reciba otra persona.',
  cobrador: 'Esa persona no está en el equipo (o está desactivada).', perfil: 'Ese usuario no existe o está desactivado.',
  sin_acceso: 'Ese usuario no está en el equipo del Panel. Pídele al dueño que lo agregue.', formato: 'El PIN debe tener al menos 4 dígitos.',
  admin: 'Elige un administrador.', admin_pin: 'El administrador entra con su PIN.', sin_pin: 'Todavía no tienes PIN del Panel. Pídele al dueño que te ponga uno en “Equipo y mora”.',
  pin_falta: 'Ponle un PIN del Panel (4 a 8 números) a esta persona.', pin_debil: 'Ese PIN es muy fácil de adivinar (ej. 1234 o 7777). Usa 4 a 8 números distintos.',
  version: 'Tu Panel está desactualizado. Recarga la página y vuelve a intentar.',
  mora_regla: 'Revisa la regla de mora: el valor debe ser mayor que cero (y el % por día máximo 10), gracia de 0 a 60 días y tope de 0 a 100%.',
  motivo: 'Escribe el motivo (mínimo 3 letras).', ya_anulado: 'Ese cobro ya estaba anulado.', de_creditos: 'Ese pago se hizo en Créditos: anúlalo allá.', nota: 'Escribe la nota.',
};
function mensaje(d) {
  if (!d) return 'No se pudo completar.';
  if (d.motivo === 'sin_stock') return `No hay suficiente "${d.producto}": hay ${Number(d.hay)} y necesitas ${Number(d.necesita)}.`;
  if (d.motivo === 'fondos') return `No hay suficiente dinero en Caja para prestar. Caja tiene ${fmt(d.caja)}.`;
  if (d.motivo === 'excede') return `Es más de lo que debe. Saldo: ${fmt(d.saldo)}.`;
  if (d.motivo === 'incorrecto') return `PIN incorrecto.${d.restantes != null ? ' Te quedan ' + d.restantes + ' intento(s).' : ''}`;
  if (d.motivo === 'bloqueado') return `Demasiados intentos. Espera ${Math.max(1, Math.ceil((d.bloqueado_seg || 900) / 60))} minuto(s).`;
  if (d.motivo === 'mora_excede') return `La mora cambió: ahora es ${fmt(d.mora)}. Revisa y vuelve a cobrar.`;
  if (d.motivo === 'perdon') return `No tienes permiso para perdonar mora: debes cobrar ${fmt(d.mora)} de mora. Si el cliente no puede, avisa al dueño.`;
  if (d.motivo === 'cambio') return `Llegaron cobros nuevos mientras contabas. Ahora debe entregar ${fmt(d.esperado)} en efectivo: vuelve a contar.`;
  return MOTIVOS[d.motivo] || 'No se pudo completar.';
}
async function rpc(n, a) {
  try {
    const { data, error } = await sb.rpc(n, a);
    if (error) {
      console.warn(n, error);
      if (esFallaRed(error)) return { ok: false, red: true, msg: 'Sin señal. Intenta de nuevo (no se cobra dos veces).' };
      const rv = String(error.message || '').match(/MF_REVISION:(\w+):([\d.]*):([\d.]*):(\d*)/);
      if (rv) {
        const d = { motivo: 'revision', tipo: rv[1], deuda: Number(rv[2]), limite: rv[3] === '' ? null : Number(rv[3]), dias: Number(rv[4] || 0) };
        d.msg = d.tipo === 'limite' ? `No se guardó: pasa el límite de crédito del cliente. Quedaría debiendo ${fmt(d.deuda)} y su límite es ${fmt(d.limite)}.`
          : `No se guardó: el cliente tiene ${d.dias} días de atraso. Primero debe ponerse al día.`;
        if (puedeAdministrar()) d.msg += ' Si quieres, autoriza una excepción (queda anotado).'; else d.msg += ' Pide autorización al dueño o supervisor.';
        return { ok: false, ...d };
      }
      return { ok: false, msg: 'El servidor no aceptó la operación: ' + String(error.message || 'error').slice(0, 160) };
    }
    if (!data || data.ok !== true) {
      if (data && data.motivo === 'sesion' && n !== 'mf_sesion_abrir') { sesBorrar(); setTimeout(async () => { cerrarModal(true); if (await autoEntrar()) await recargar(); else pantallaEntrar(); }, 50); }
      return { ...(data || {}), ok: false, msg: mensaje(data) };
    }
    return data;
  } catch (e) { return { ok: false, red: true, msg: 'Sin señal. Intenta de nuevo (no se cobra dos veces).' }; }
}
function esFallaRed(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = String((err && (err.message || err.details)) || '');
  return !err.code && /fetch|network|load failed|timeout|abort|conex/i.test(m);
}
async function leerTodo(fn) {
  const out = [];
  for (let i = 0; i < 30; i++) { const { data, error } = await fn().range(i * 1000, i * 1000 + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break; }
  return out;
}

/* ---------- datos ---------- */
async function cargarDatos() {
  const u = MF.userId, hoy = hoyISO();
  let [cli, cred, met, ban, prod, pagos] = await Promise.all([
    leerTodo(() => sb.from('clientes').select('id,nombre,apellido,telefono,whatsapp,direccion,zona,ruc').eq('auth_user_id', u).eq('activo', true).order('nombre').order('id')),
    leerTodo(() => sb.from('creditos').select('id,numero_credito,cliente_id,tipo,total_financiado,saldo_pendiente,frecuencia,valor_cuota_aprox,estado,created_at,observaciones,mf_ref,mf_cobrador_id,mf_cobrador_nombre')
      .eq('auth_user_id', u).in('estado', ['activo', 'al_dia', 'con_atraso', 'en_proceso']).gt('saldo_pendiente', 0.004).order('id')),
    sb.from('metodos_pago').select('id,nombre').eq('auth_user_id', u).eq('activo', true).order('nombre'),
    sb.from('bancos').select('id,nombre,moneda').eq('auth_user_id', u).eq('activo', true).order('nombre'),
    leerTodo(() => sb.from('productos').select('id,nombre,precio,stock_actual,tipo,sku,codigo_barras').eq('auth_user_id', u).eq('activo', true).in('tipo', ['producto', 'servicio']).order('nombre').order('id')),
    sb.from('creditos_pagos').select('id,credito_id,monto,fecha,estado,comprobante_numero,mf_cobrador_id').eq('auth_user_id', u).eq('estado', 'completado').gte('fecha', masDias(hoy, -6)).limit(5000),
  ]);
  MF.clientes = cli;
  // Cobrador: solo ve SU cartera y SUS cobros (el servidor además rechaza cobrar lo ajeno)
  if (esCobrador()) { const yo = MF.ses.perfil_id; cred = cred.filter(c => c.mf_cobrador_id === yo); if (pagos.data) pagos.data = pagos.data.filter(p => p.mf_cobrador_id === yo); }
  MF.creditos = cred;
  MF.metodos = (met.data || []); MF.bancos = (ban.data || []).filter(b => (b.moneda || 'NIO') === (MF.cfg.moneda || 'NIO'));
  MF.productos = prod;
  MF.pagosSemana = pagos.data || []; MF.pagosHoy = MF.pagosSemana.filter(p => String(p.fecha).slice(0, 10) === hoy);
  MF.cuotas = {};
  const ids = cred.map(c => c.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from('creditos_cuotas').select('credito_id,numero,fecha_vencimiento,monto_total,monto_pagado,estado,mf_mora_hasta')
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
  const hoy = hoyISO(), qs = MF.cuotas[cr.id] || [], enCola = colaMonto(cr.id);
  let atrasado = 0, hoyMonto = 0, primeraVencida = null, prox = null, resto = enCola;
  qs.forEach(q => {
    const f = String(q.fecha_vencimiento).slice(0, 10); let falta = r2(Number(q.monto_total) - Number(q.monto_pagado || 0));
    if (resto > 0.004 && falta > 0) { const a = Math.min(resto, falta); falta = r2(falta - a); resto = r2(resto - a); }
    if (falta <= 0.004) return;
    if (f < hoy) { atrasado = r2(atrasado + falta); if (!primeraVencida || f < primeraVencida) primeraVencida = f; }
    else if (f === hoy) hoyMonto = r2(hoyMonto + falta);
    else if (!prox) prox = { fecha: f, monto: falta };
  });
  const dias = primeraVencida ? diasEntre(primeraVencida, hoy) : 0;
  const cuota = r2(cr.valor_cuota_aprox || (qs[0] ? qs[0].monto_total : 0));
  return { atrasado, hoy: hoyMonto, dias, prox, cuota, pagarHoy: r2(atrasado + hoyMonto), saldo: r2(Math.max(0, cr.saldo_pendiente - enCola)), enCola };
}

/* ---------- pestañas ---------- */
async function mfTab(t) {
  MF.tab = t;
  if (conEquipo() && !MF.ses && !(await autoEntrar())) return pantallaEntrar();
  if (!tabPermitida(t)) t = MF.tab = 'ruta';
  pintarBarraEquipo(); pintarBarraCola();
  document.querySelectorAll('.pd-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === t));
  try { history.replaceState(null, '', '#' + t); } catch (_) {}
  const v = document.getElementById('pd-vista');
  if (t === 'ruta') return pintarRuta(v);
  if (t === 'vender') return pintarVender(v);
  if (t === 'clientes') return pintarClientes(v);
  if (t === 'caja') return pintarCajaDia(v);
  if (t === 'cierre') return pintarCierre(v);
  if (t === 'reportes') return pintarReportes(v);
  if (t === 'equipo') return pintarEquipo(v);
  return pintarResumen(v);
}
async function recargar() { try { await cargarDatos(); } catch (e) { console.error(e); showToast('No se pudieron cargar los datos. Revisa tu conexión.', 'error'); } mfTab(MF.tab); }

/* ---------- 🛵 RUTA DE HOY ---------- */
function zonaDe(c) { return String(c?.zona || '').trim(); }
function visitadoHoy(x, cobradosIds) {
  if (cobradosIds.has(x.cr.id)) return true;
  const g = x.g; return !!(g && g.created_at && ymd(new Date(g.created_at)) === hoyISO());
}
function pintarRuta(v) {
  const hoy = hoyISO();
  const lista = MF.creditos.map(cr => ({ cr, s: situacion(cr), c: cliPorId(cr.cliente_id), g: MF.promesas[cr.id] }))
    .filter(x => x.s.pagarHoy > 0.004 || x.s.enCola > 0 || (x.g && x.g.tipo === 'promesa' && x.g.fecha_promesa === hoy));
  const cobradosIds = new Set(MF.pagosHoy.map(p => p.credito_id).concat(colaPendientes().map(c => c.credito_id)));
  lista.forEach(x => { x.visto = visitadoHoy(x, cobradosIds); x.zona = zonaDe(x.c); });
  const zonas = [...new Set(lista.map(x => x.zona).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (MF.rutaZona && MF.rutaZona !== '__sin' && !zonas.includes(MF.rutaZona)) MF.rutaZona = '';
  const f = MF.filtroRuta.trim().toLowerCase();
  const vis = lista.filter(x => (!f || nombreCli(x.c).toLowerCase().includes(f) || String(x.c?.direccion || '').toLowerCase().includes(f) || x.zona.toLowerCase().includes(f) || String(x.cr.numero_credito).toLowerCase().includes(f))
      && (!MF.rutaZona || (MF.rutaZona === '__sin' ? !x.zona : x.zona === MF.rutaZona)) && (!MF.ocultarVisitados || !x.visto))
    .sort((a, b) => MF.rutaOrden === 'zona'
      ? ((a.visto - b.visto) || (!a.zona - !b.zona) || a.zona.localeCompare(b.zona) || String(a.c?.direccion || '').localeCompare(String(b.c?.direccion || '')) || nombreCli(a.c).localeCompare(nombreCli(b.c)))
      : MF.rutaOrden === 'nombre' ? ((a.visto - b.visto) || nombreCli(a.c).localeCompare(nombreCli(b.c)))
      : ((a.visto - b.visto) || (b.s.dias - a.s.dias) || nombreCli(a.c).localeCompare(nombreCli(b.c))));
  const esperado = r2(lista.reduce((s, x) => s + x.s.pagarHoy, 0)), cobrado = r2(MF.pagosHoy.reduce((s, p) => s + Number(p.monto || 0), 0) + colaPendientes().reduce((s, c) => s + c.monto, 0));
  const vistos = lista.filter(x => x.visto).length, pct = lista.length ? Math.round(vistos / lista.length * 100) : 0;
  let html = '', zonaAct = null;
  vis.forEach(x => {
    if (MF.rutaOrden === 'zona' && !x.visto && x.zona !== zonaAct) {
      zonaAct = x.zona; const enZ = lista.filter(y => y.zona === x.zona), faltan = enZ.filter(y => !y.visto);
      html += `<div class="mf-zona-tit">📍 ${esc(x.zona || 'Sin zona')} <span class="tl-muted">· faltan ${faltan.length} de ${enZ.length} · ${fmt(faltan.reduce((a, y) => a + y.s.pagarHoy, 0))}</span></div>`;
    }
    if (x.visto && zonaAct !== '__vistos') { zonaAct = '__vistos'; html += `<div class="mf-zona-tit">✅ Ya visitados hoy <span class="tl-muted">· ${vistos}</span></div>`; }
    html += tarjetaRuta(x, cobradosIds.has(x.cr.id));
  });
  v.innerHTML = `<div class="pd-kpis">
      <div class="pd-kpi"><div class="pd-kpi-l">💵 Cobrado hoy</div><div class="pd-kpi-v pd-verde">${fmt(cobrado)}</div><div class="pd-kpi-s">${MF.pagosHoy.length} recibo(s)${colaPendientes().length ? ' + ' + colaPendientes().length + ' sin enviar' : ''}</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">🛵 Por cobrar hoy</div><div class="pd-kpi-v">${fmt(esperado)}</div><div class="pd-kpi-s">${lista.length} cliente(s) en la ruta</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">🚶 Visitados</div><div class="pd-kpi-v">${vistos} de ${lista.length}</div><div class="vd-barra" style="margin-top:6px"><i style="width:${pct}%"></i></div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">⏰ Atrasados</div><div class="pd-kpi-v pd-rojo">${lista.filter(x => x.s.dias > 0).length}</div><div class="pd-kpi-s">con cuotas vencidas</div></div></div>
    <div class="vd-filtros"><input type="search" class="tl-inp" style="flex:1;min-width:0" placeholder="🔎 Buscar cliente, zona, dirección o crédito" value="${esc(MF.filtroRuta)}" oninput="MF.filtroRuta=this.value;pintarRuta(document.getElementById('pd-vista'))" aria-label="Buscar en la ruta">
      <button class="btn-secondary" onclick="recargar()">🔄 Actualizar</button></div>
    <div class="vd-filtros mf-ruta-op">
      <select class="tl-sel" aria-label="Ordenar la ruta" onchange="MF.rutaOrden=this.value;guardarPrefRuta();pintarRuta(document.getElementById('pd-vista'))">
        <option value="zona" ${MF.rutaOrden === 'zona' ? 'selected' : ''}>📍 Por zona</option><option value="atraso" ${MF.rutaOrden === 'atraso' ? 'selected' : ''}>⏰ Más atrasados primero</option><option value="nombre" ${MF.rutaOrden === 'nombre' ? 'selected' : ''}>🔤 Por nombre</option></select>
      <select class="tl-sel" aria-label="Ver una zona" onchange="MF.rutaZona=this.value;guardarPrefRuta();pintarRuta(document.getElementById('pd-vista'))">
        <option value="">Todas las zonas</option>${zonas.map(z => `<option value="${esc(z)}" ${MF.rutaZona === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}<option value="__sin" ${MF.rutaZona === '__sin' ? 'selected' : ''}>Sin zona</option></select>
      <label class="mf-chk"><input type="checkbox" ${MF.ocultarVisitados ? 'checked' : ''} onchange="MF.ocultarVisitados=this.checked;guardarPrefRuta();pintarRuta(document.getElementById('pd-vista'))"> Ocultar visitados</label></div>
    ${!zonas.length && lista.length ? '<p class="tl-muted" style="margin:0 0 8px">💡 Ponle <b>zona</b> a tus clientes (en su tarjeta 📒) para recorrer la ruta barrio por barrio.</p>' : ''}
    ${vis.length ? `<div class="mf-lista">${html}</div>`
      : `<div class="pd-vacio"><div class="ico">🎉</div><b>${lista.length ? (MF.ocultarVisitados && vistos === lista.length ? '¡Ya visitaste a todos!' : 'Nadie con ese filtro en la ruta.') : 'Nadie tiene que pagar hoy.'}</b><p class="tl-muted">Aquí salen los clientes con cuota de hoy, atrasados o que prometieron pagar hoy.</p></div>`}`;
  if (document.activeElement && document.activeElement.type === 'search') { const i = v.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function guardarPrefRuta() { try { localStorage.setItem('n360_mf_ruta_' + MF.userId, JSON.stringify({ o: MF.rutaOrden, z: MF.rutaZona, v: MF.ocultarVisitados })); } catch (_) {} }
function leerPrefRuta() { try { const p = JSON.parse(localStorage.getItem('n360_mf_ruta_' + MF.userId) || 'null'); if (p) { if (['zona', 'atraso', 'nombre'].includes(p.o)) MF.rutaOrden = p.o; MF.rutaZona = typeof p.z === 'string' ? p.z : ''; MF.ocultarVisitados = !!p.v; } } catch (_) {} }
function tarjetaRuta(x, cobradoHoy) {
  const { cr, s, c, g } = x, tel = c?.whatsapp || c?.telefono || '';
  const est = s.enCola > 0 && s.pagarHoy <= 0.004 ? '<span class="pd-pill ambar">⏳ Cobrado sin señal</span>' : s.dias > 0 ? `<span class="pd-pill mal">⏰ ${s.dias} día${s.dias === 1 ? '' : 's'} de atraso</span>` : s.hoy > 0 ? '<span class="pd-pill ambar">📅 Le toca hoy</span>' : '<span class="pd-pill">🤝 Prometió hoy</span>';
  return `<div class="mf-card${cobradoHoy || x.visto ? ' cobrado' : ''}">
    <div class="mf-card-cab"><div style="min-width:0"><b class="mf-nom">${esc(nombreCli(c))}</b>
      <div class="tl-muted">${esc(cr.numero_credito)}${zonaDe(c) ? ' · 🏘️ ' + esc(zonaDe(c)) : ''}${c?.direccion ? ' · 📍 ' + esc(c.direccion) : ''}</div></div>${est}</div>
    ${moraEstimada(cr) > 0 && !cobradoHoy ? `<div class="tl-muted" style="color:var(--danger,#dc2626)">⏰ + mora aprox. ${fmt(moraEstimada(cr))}</div>` : ''}
    <div class="mf-montos"><div><span>Cobrar hoy</span><b>${fmt(s.pagarHoy)}</b></div><div><span>Cuota</span><b>${fmt(s.cuota)}</b></div><div><span>Debe en total</span><b>${fmt(s.saldo)}</b></div></div>
    ${g ? `<div class="tl-muted">📝 ${g.tipo === 'promesa' ? 'Prometió pagar el ' + fCorta(g.fecha_promesa) : g.tipo === 'no_estaba' ? 'No estaba (' + fCorta(ymd(new Date(g.created_at))) + ')' : esc(g.nota || '')}${g.tipo !== 'nota' && g.nota ? ' · ' + esc(g.nota) : ''}</div>` : ''}
    ${x.visto && !cobradoHoy ? `<div class="tl-aviso ok">🚶 Visitado hoy${g && g.tipo === 'no_estaba' ? ' (no estaba)' : g && g.tipo === 'promesa' ? ' (prometió)' : ''}</div>` : ''}
    ${s.enCola > 0 ? `<div class="tl-aviso">⏳ Cobro de ${fmt(s.enCola)} guardado sin señal: se envía solo al volver la señal.</div>` : cobradoHoy ? '<div class="tl-aviso ok">✅ Ya pagó hoy</div>' : ''}
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
      <div id="mf-mora-w"></div>
      <div class="tl-f"><label for="mf-nota">Nota (opcional)</label><input class="tl-inp" id="mf-nota" maxlength="300" placeholder="Ej. pagó la vecina"></div>
      <div id="mf-prev"></div><div class="tl-aviso" id="mf-err" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="cerrarModal()">Cancelar</button><button class="btn-primary mf-grande" id="mf-ok" onclick="confirmarCobro()">✅ Cobrar</button></div>`);
  previewCobro();
  cargarMoraCobro();
  setTimeout(() => { const i = document.getElementById('mf-monto'); if (i) { i.focus(); i.select(); } }, 60);
}
// Mora del crédito: la calcula el servidor. Sin señal no se cobra mora (queda para la próxima visita, sin perderse).
async function cargarMoraCobro() {
  const k = MF.cobro; if (!k || !moraActiva()) return;
  const w = document.getElementById('mf-mora-w'); if (!w) return;
  if (moraEstimada(k.cr) <= 0) return;
  w.innerHTML = '<p class="tl-muted">Calculando la mora…</p>';
  const r = await rpc('mf_mora_ver', { p: { credito_id: k.cr.id, token: tk() } });
  if (MF.cobro !== k || !document.getElementById('mf-mora-w')) return;
  if (!r.ok) { w.innerHTML = r.red ? '<div class="tl-aviso">📡 Sin señal: la mora no se calcula ahora; queda pendiente para la próxima visita (no se pierde).</div>' : ''; return; }
  const mo = r2(r.mora); k.moraCalc = mo;
  if (!(mo > 0)) { w.innerHTML = ''; previewCobro(); return; }
  const puede = puedeAdministrar() || MF.cfg.mf_mora_perdona_cobrador === true;
  w.innerHTML = `<div class="tl-f"><label for="mf-mora">⏰ Mora por atraso${Number(r.dias) > 0 ? ` (${r.dias} día${Number(r.dias) === 1 ? '' : 's'})` : ''}</label>
      <input class="tl-inp" id="mf-mora" type="number" inputmode="decimal" min="0" max="${mo}" step="0.01" value="${mo}" ${puede ? '' : 'readonly'} oninput="previewCobro()"></div>
    <p class="tl-muted" style="margin:-4px 0 8px">${puede ? 'Puedes bajarla o ponerla en 0 para perdonarla (queda anotado).' : 'La mora la fija el negocio.'} No cambia lo que debe del crédito.</p>`;
  previewCobro();
}
function moraDelModal() {
  const k = MF.cobro; if (!k || k.moraCalc == null || !(k.moraCalc > 0)) return null;
  const i = document.getElementById('mf-mora'); if (!i) return null;
  return r2(Math.min(Math.max(0, Number(i.value) || 0), k.moraCalc));
}
function previewCobro() {
  const k = MF.cobro; if (!k) return;
  const s = situacion(k.cr), m = r2(document.getElementById('mf-monto').value), met = MF.metodos.find(x => x.id === k.metodoId);
  const bw = document.getElementById('mf-banco-w'); if (bw) bw.style.display = met && necesitaBanco(met.nombre) && MF.bancos.length ? '' : 'none';
  const prev = document.getElementById('mf-prev'), ok = document.getElementById('mf-ok');
  if (!(m > 0)) { prev.innerHTML = ''; ok.disabled = true; return; }
  if (m > s.saldo + 0.004) { prev.innerHTML = `<div class="tl-aviso">Es más de lo que debe (${fmt(s.saldo)}).</div>`; ok.disabled = true; return; }
  const mo = moraDelModal() || 0, mi = document.getElementById('mf-mora');
  if (mi && Number(mi.value) > k.moraCalc + 0.004) { prev.innerHTML = `<div class="tl-aviso">La mora no puede ser más de ${fmt(k.moraCalc)}.</div>`; ok.disabled = true; return; }
  ok.disabled = false; ok.textContent = `✅ Cobrar ${fmt(r2(m + mo))}`;
  prev.innerHTML = `<div class="tl-aviso ok">${mo > 0 ? `Recibe <b>${fmt(r2(m + mo))}</b> (${fmt(m)} del crédito + ${fmt(mo)} de mora). ` : ''}Queda debiendo <b>${fmt(r2(s.saldo - m))}</b>${r2(s.saldo - m) <= 0.004 ? ' · 🎉 ¡termina de pagar!' : ''}${k.moraCalc > 0 && mo < k.moraCalc ? ` · se perdonan ${fmt(r2(k.moraCalc - mo))} de mora` : ''}</div>`;
}
async function confirmarCobro() {
  const k = MF.cobro; if (!k || MF.ocupado) return;
  const err = document.getElementById('mf-err'); err.style.display = 'none';
  const m = r2(document.getElementById('mf-monto').value), met = MF.metodos.find(x => x.id === k.metodoId) || null;
  const bancoW = document.getElementById('mf-banco-w'), banco = bancoW && bancoW.style.display !== 'none' ? document.getElementById('mf-banco').value : '';
  if (!(m > 0)) return;
  if (bancoW && bancoW.style.display !== 'none' && !banco) { err.textContent = 'Elige a qué banco entró.'; err.style.display = ''; return; }
  const mora = moraDelModal();
  if (mora != null && mora < k.moraCalc - 0.004 && !confirm(`¿Perdonar ${fmt(r2(k.moraCalc - mora))} de mora? Queda anotado a tu nombre.`)) return;
  MF.ocupado = true; const ok = document.getElementById('mf-ok'); ok.disabled = true; ok.textContent = 'Cobrando…';
  const pc = { credito_id: k.cr.id, monto: m, metodo_pago_id: met ? met.id : null, metodo_pago_nombre: met ? met.nombre : 'Efectivo',
    banco_id: banco || null, nota: document.getElementById('mf-nota').value.trim(), ref: k.ref, creado_por: perfilNombre(), token: tk() };
  if (mora != null) pc.mora = mora;
  const r = await rpc('mf_cobrar', { p: pc });
  MF.ocupado = false;
  if (!r.ok && r.red) {
    const item = { ref: k.ref, credito_id: k.cr.id, monto: m, metodo_pago_id: met ? met.id : null, metodo_pago_nombre: met ? met.nombre : 'Efectivo', banco_id: banco || null,
      nota: document.getElementById('mf-nota').value.trim(), creado_por: perfilNombre(), perfil_id: conEquipo() ? (MF.ses?.perfil_id || null) : null,
      cobrador: conEquipo() ? (MF.ses?.nombre || '') : '', cliente: nombreCli(cliPorId(k.cr.cliente_id)), numero_credito: k.cr.numero_credito, hora: new Date().toISOString(), estado: 'pendiente' };
    if (mora != null) item.mora = mora;
    if (colaAgregar(item)) { mostrarGuardadoSinSenal(item, k.cr); return; }
    err.textContent = 'No hay señal y este teléfono no deja guardar el cobro. NO se cobró: anótalo en papel y regístralo al volver la señal.'; err.style.display = ''; ok.disabled = false; ok.textContent = `✅ Cobrar ${fmt(m)}`; return;
  }
  if (!r.ok) { err.textContent = r.msg; err.style.display = ''; ok.disabled = false; ok.textContent = `✅ Cobrar ${fmt(m)}`; if (r.motivo === 'mora_excede') cargarMoraCobro(); return; }
  mostrarRecibo(r, k.cr, met ? met.nombre : 'Efectivo');
  await cargarDatos().catch(() => {});
}
function mostrarRecibo(r, cr, metodo) {
  const c = cliPorId(cr.cliente_id), tel = c?.whatsapp || c?.telefono || '', neg = MF.cfg.nombre_comercial || 'Mi negocio';
  const txt = `🧾 *Recibo ${r.recibo}* — ${neg}${conEquipo() && r.cobrador ? '\nCobró: ' + r.cobrador : ''}\nCliente: ${nombreCli(c)}\nCrédito: ${r.numero_credito || cr.numero_credito}\nFecha: ${new Date().toLocaleDateString('es-NI')}\nPagó: ${fmt(r.monto)} (${metodo})${Number(r.mora) > 0 ? `\nMora por atraso: ${fmt(r.mora)}\nTotal recibido: ${fmt(r2(Number(r.monto) + Number(r.mora)))}` : ''}\nDebía: ${fmt(r.saldo_anterior)}\nAhora debe: ${fmt(r.saldo)}${r.proxima_fecha ? `\nPróximo pago: ${fCorta(r.proxima_fecha)} · ${fmt(r.proxima_monto)}` : ''}${r.cancelado ? '\n🎉 ¡Crédito pagado completo! Gracias.' : '\n¡Gracias por su pago!'}`;
  MF.ultimoRecibo = { txt, r, cr, metodo };
  modal(`<div class="tl-modal-cab"><h2>✅ Cobrado</h2><button class="tl-x" onclick="cerrarModal();mfTab(MF.tab)" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo"><div class="mf-recibo">
      <div class="mf-recibo-num">${esc(r.recibo)}${r.repetido ? ' <span class="pd-pill">ya estaba registrado</span>' : ''}</div>
      <div class="mf-recibo-monto">${fmt(r2(Number(r.monto) + Number(r.mora || 0)))}</div>${Number(r.mora) > 0 ? `<div class="tl-muted">${fmt(r.monto)} del crédito + ${fmt(r.mora)} de mora</div>` : ''}<div>${esc(nombreCli(c))} · ${esc(metodo)}${conEquipo() && r.cobrador ? ' · Cobró: ' + esc(r.cobrador) : ''}</div>
      <div class="mf-montos" style="margin-top:10px"><div><span>Debía</span><b>${fmt(r.saldo_anterior)}</b></div><div><span>Ahora debe</span><b>${fmt(r.saldo)}</b></div>
        <div><span>Próximo pago</span><b>${r.proxima_fecha ? fCorta(r.proxima_fecha) + ' · ' + fmt(r.proxima_monto) : '—'}</b></div></div>
      ${r.cancelado ? '<div class="tl-aviso ok">🎉 ¡Terminó de pagar este crédito!</div>' : ''}
      ${Number(r.mora_perdonada) > 0 ? `<div class="tl-muted">Mora perdonada: ${fmt(r.mora_perdonada)}</div>` : ''}${Number(r.mora_pendiente) > 0 ? `<div class="tl-muted">Mora pendiente: ${fmt(r.mora_pendiente)} (se cobra en la próxima visita)</div>` : ''}</div></div>
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
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="cerrarModal()">Cancelar</button><button class="btn-primary" id="mf-gok" onclick="guardarGestion('${creditoId}','${tipo}','${ref()}')">Guardar</button></div>`);
}
async function guardarGestion(creditoId, tipo, gref) {
  if (MF.ocupado) return; MF.ocupado = true;
  const b = document.getElementById('mf-gok'); b.disabled = true;
  const r = await rpc('mf_gestion', { p: { credito_id: creditoId, tipo, fecha_promesa: tipo === 'promesa' ? document.getElementById('mf-gf').value : null, nota: document.getElementById('mf-gn').value.trim(), ref: gref, creado_por: perfilNombre(), token: tk() } });
  MF.ocupado = false;
  if (!r.ok) { const e = document.getElementById('mf-gerr'); e.textContent = r.msg; e.style.display = ''; b.disabled = false; return; }
  cerrarModal(); showToast('Anotado.'); await recargar();
}

/* ---------- 🛒 VENDER AL CRÉDITO ---------- */
function ventaNueva() {
  const hoy = hoyISO();
  MF.venta = { ref: ref(), tipo: 'productos', clienteId: '', items: [], monto: '', interes: '', recargo: '', prima: '', primaMetodo: (MF.metodos.find(m => /efectivo/i.test(m.nombre)) || MF.metodos[0] || {}).id || '',
    frec: 'semanal', n: 4, primera: masDias(hoy, 7), dias: diasCobroNegocio(), nota: '', busca: '', buscaCli: '', cobrador: '' };
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
  const dias = V.dias || 'lun_sab';
  if (V.frec === 'diaria') { let d = siguienteCobro(V.primera, dias); for (let k = 0; k < i; k++) d = siguienteCobro(masDias(d, 1), dias); return d; }
  const base = V.frec === 'semanal' ? masDias(V.primera, 7 * i) : V.frec === 'quincenal' ? masDias(V.primera, 15 * i) : masMeses(V.primera, i);
  return dias === 'lun_vie' ? siguienteCobro(base, dias) : base;   // con lunes a viernes, si cae fin de semana pasa al lunes
}
function pintarVender(v) {
  if (!MF.venta) ventaNueva();
  const V = MF.venta, c = cliPorId(V.clienteId);
  v.innerHTML = `<div class="pd-card"><h3>1. ¿A quién?</h3>
      ${c ? `<div class="mf-elegido"><div><b>${esc(nombreCli(c))}</b><div class="tl-muted">${esc(c.telefono || c.whatsapp || 'Sin teléfono')}${c.direccion ? ' · 📍 ' + esc(c.direccion) : ''}</div></div><button class="btn-secondary" onclick="MF.venta.clienteId='';pintarVender(document.getElementById('pd-vista'))">Cambiar</button></div>`
        : `<div class="vd-filtros"><input type="search" class="tl-inp" style="flex:1;min-width:0" id="mf-bcli" placeholder="🔎 Buscar cliente por nombre o teléfono" value="${esc(V.buscaCli)}" oninput="MF.venta.buscaCli=this.value;pintarCliOpc()" aria-label="Buscar cliente">
          <button class="btn-secondary" onclick="abrirNuevoCliente()">＋ Nuevo cliente</button></div><div id="mf-cli-opc"></div>`}</div>
    ${c ? '<div id="mf-rev"></div>' : ''}
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
        <div class="tl-f full"><label>Días de cobro</label><div class="pd-tabs" style="margin:0">${['lun_vie', 'lun_sab', 'todos'].map(k => `<button type="button" class="pd-tab ${(V.dias || 'lun_sab') === k ? 'activa' : ''}" onclick="MF.venta.dias='${k}';pintarVender(document.getElementById('pd-vista'))">${DIAS_COBRO[k]}</button>`).join('')}</div>
          <span class="tl-muted" style="font-size:12px">${V.dias === 'lun_vie' ? (V.frec === 'diaria' ? 'Nunca se cobra sábado ni domingo.' : 'Si una cuota cae sábado o domingo, se cobra el lunes.') : V.dias === 'todos' ? 'Se cobra cualquier día.' : (V.frec === 'diaria' ? 'No se cobra el domingo.' : 'Las cuotas caen el día que toca.')} El atraso cuenta solo días de cobro.</span></div>
        ${conEquipo() && MF.ses?.rol === 'dueno' && MF.equipo.some(e => e.activo) ? `<div class="tl-f full"><label for="mf-vcob">¿Quién lo cobra?</label><select class="tl-sel" id="mf-vcob" onchange="MF.venta.cobrador=this.value">
          <option value="">Sin cobrador (lo cobra el dueño)</option>${MF.equipo.filter(e => e.activo).map(e => `<option value="${e.perfil_id}" ${V.cobrador === e.perfil_id ? 'selected' : ''}>${esc(e.nombre)} · ${e.rol === 'supervisor' ? 'Supervisor' : 'Cobrador'}</option>`).join('')}</select></div>` : ''}
        <div class="tl-f full"><label for="mf-vnota">Nota (opcional)</label><input class="tl-inp" id="mf-vnota" maxlength="300" value="${esc(V.nota)}" oninput="MF.venta.nota=this.value"></div></div></div>
    <div class="pd-card mf-resumen-card" id="mf-resumen"></div>`;
  if (!c) pintarCliOpc(); else cargarRevision(c.id);
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
  const prob = problemaRevision(k);
  const firmaProb = JSON.stringify(prob); if (firmaProb !== MF._revProb) { MF._revProb = firmaProb; pintarRevision(); }
  if (prob && !(V.autoriza && (V.autMotivo || '').trim().length >= 3)) faltas.push(puedeAdministrar() ? 'autoriza la excepción (abajo del cliente) o cambia el monto' : 'el cliente no cumple la revisión: pide autorización al dueño');
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
  const cada = V.frec === 'semanal' && V.primera ? 'cada ' + diaSemana(V.primera) : V.frec === 'diaria' ? (V.dias === 'lun_vie' ? 'de lunes a viernes' : V.dias === 'todos' ? 'cada día' : 'cada día (menos domingo)') : V.frec === 'quincenal' ? 'cada 15 días' : 'cada mes';
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
  if (problemaRevision(k) && V.autoriza) {
    const a = await rpc('mf_autorizar', { p: { token: tk(), cliente_id: V.clienteId, motivo: (V.autMotivo || '').trim(), por: perfilNombre() } });
    if (!a.ok) { const e = document.getElementById('mf-verr'); e.textContent = a.msg; e.style.display = ''; return; }
  }
  MF.ocupado = true; const b = document.getElementById('mf-vok'); b.disabled = true; b.textContent = 'Guardando…';
  const p = { tipo: V.tipo, cliente_id: V.clienteId, frecuencia: V.frec, num_cuotas: k.n, primera_fecha: V.primera, sin_domingos: V.frec === 'diaria' ? (V.dias || 'lun_sab') !== 'todos' : false, dias_cobro: V.dias || 'lun_sab',
    nota: V.nota, ref: V.ref, creado_por: perfilNombre(), token: tk() };
  if (conEquipo() && MF.ses?.rol === 'dueno' && V.cobrador) p.cobrador_id = V.cobrador;
  if (V.tipo === 'productos') Object.assign(p, { items: V.items.map(i => ({ producto_id: i.producto_id, cantidad: r2(i.cantidad), precio: r2(i.precio) })), recargo_pct: Number(V.recargo) || 0,
    prima: k.prima, prima_metodo_id: met ? met.id : null, prima_metodo_nombre: met ? met.nombre : 'Efectivo' });
  else Object.assign(p, { monto: k.cap, interes_pct: Number(V.interes) || 0 });
  const r = await rpc('mf_credito_crear', { p });
  MF.ocupado = false;
  if (!r.ok) { const e = document.getElementById('mf-verr'); e.textContent = r.msg; e.style.display = ''; b.disabled = false; b.textContent = '✅ Intentar de nuevo'; if (r.motivo === 'revision') { MF.rev = null; await cargarRevision(V.clienteId); const e2 = document.getElementById('mf-verr'); if (e2) { e2.textContent = r.msg; e2.style.display = ''; } } return; }
  const tel = c.whatsapp || c.telefono || '', neg = MF.cfg.nombre_comercial || 'Mi negocio';
  const txt = `🧾 *${neg}*\nHola ${nombreCli(c).split(' ')[0]} 👋, este es su plan de pago:\nCrédito: ${r.numero_credito}${r.numero_venta ? ' (venta ' + r.numero_venta + ')' : ''}\nTotal: ${fmt(r.total)}${Number(r.prima) > 0 ? `\nPrima pagada: ${fmt(r.prima)} (recibo ${r.recibo_prima})` : ''}\nCuotas: ${r.cuotas} de ${fmt(r.cuota)} (${FREC[V.frec].toLowerCase()})\nPrimer pago: ${fCorta(V.primera)}\n¡Gracias por su preferencia!`;
  ventaNueva(); MF.rev = null;
  await cargarDatos().catch(() => {});
  if (!r.repetido && r.credito_id && prefDocsAuto()) {
    return abrirDocumentos(r.credito_id, c.id, { nuevo: true, titulo: `✅ ${r.numero_credito} guardado`, waPlan: tel ? `https://wa.me/${waNum(tel)}?text=${encodeURIComponent(txt)}` : '' });
  }
  modal(`<div class="tl-modal-cab"><h2>✅ ${r.repetido ? 'Ya estaba registrado' : 'Listo'}</h2><button class="tl-x" onclick="cerrarModal();mfTab('vender')">✕</button></div>
    <div class="tl-modal-cuerpo"><div class="mf-recibo"><div class="mf-recibo-num">${esc(r.numero_credito || '')}</div>
      ${r.repetido ? '<p>Este crédito ya se había guardado (no se duplicó).</p>' : `<div class="mf-recibo-monto">${fmt(r.total)}</div><div>${esc(nombreCli(c))}</div>
      <div class="mf-montos" style="margin-top:10px"><div><span>Cuotas</span><b>${r.cuotas} de ${fmt(r.cuota)}</b></div><div><span>Debe</span><b>${fmt(r.saldo)}</b></div>${Number(r.prima) > 0 ? `<div><span>Prima</span><b>${fmt(r.prima)}</b></div>` : ''}</div>`}</div></div>
    <div class="tl-modal-pie">${tel && !r.repetido ? `<a class="btn-secondary" href="https://wa.me/${waNum(tel)}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">💬 Enviar plan por WhatsApp</a>` : ''}
      ${!r.repetido && r.credito_id ? `<button class="btn-secondary" onclick="abrirDocumentos('${r.credito_id}','${c.id}')">🖨️ Contrato y pagaré</button>` : ''}
      <button class="btn-secondary" onclick="cerrarModal();abrirTarjeta('${c.id}')">📒 Ver tarjeta</button><button class="btn-primary" onclick="cerrarModal();mfTab('vender')">Nueva venta</button></div>`);
}
function abrirNuevoCliente() {
  modal(`<div class="tl-modal-cab"><h2>＋ Nuevo cliente</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
    <div class="tl-modal-cuerpo"><div class="tl-grid"><div class="tl-f full"><label for="nc-nom">Nombre completo *</label><input class="tl-inp" id="nc-nom" maxlength="120" value="${esc(MF.venta?.buscaCli || '')}"></div>
      <div class="tl-f"><label for="nc-tel">Teléfono / WhatsApp</label><input class="tl-inp" id="nc-tel" inputmode="tel" maxlength="30"></div>
      <div class="tl-f"><label for="nc-ced">Cédula (opcional)</label><input class="tl-inp" id="nc-ced" maxlength="30"></div>
      <div class="tl-f"><label for="nc-zona">Zona / barrio</label><input class="tl-inp" id="nc-zona" maxlength="60" list="mf-zonas-dl" placeholder="Ej. San Judas"></div>${datalistZonas()}
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
    const ced = document.getElementById('nc-ced').value.trim(); if (ced) fila.ruc = ced.slice(0, 30);
    const zona = limpiarZona(document.getElementById('nc-zona').value); if (zona) fila.zona = MF.clientes.map(zonaDe).find(x => x && x.toLowerCase() === zona.toLowerCase()) || zona;
    let { data, error } = await sb.from('clientes').insert(fila).select('id,nombre,apellido,telefono,whatsapp,direccion,zona,ruc').single();
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
    let { data: creds, error } = await sb.from('creditos').select('id,numero_credito,tipo,total_financiado,saldo_pendiente,estado,frecuencia,valor_cuota_aprox,created_at,venta_id,mf_cobrador_id,mf_cobrador_nombre')
      .eq('auth_user_id', MF.userId).eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    if (esCobrador()) creds = (creds || []).filter(x => x.mf_cobrador_id === MF.ses.perfil_id);
    const ids = (creds || []).map(x => x.id);
    const [cu, pa] = ids.length ? await Promise.all([
      sb.from('creditos_cuotas').select('credito_id,numero,fecha_vencimiento,monto_total,monto_pagado,estado,mf_mora_hasta').in('credito_id', ids).order('numero'),
      sb.from('creditos_pagos').select('id,credito_id,fecha,monto,estado,comprobante_numero,metodo_pago_nombre,observaciones,anulado_motivo,created_at,mf_cobrador_nombre,mf_entrega_id').in('credito_id', ids).order('created_at', { ascending: false }),
    ]) : [{ data: [] }, { data: [] }];
    const hoy = hoyISO();
    const html = (creds || []).map(cr => {
      const qs = (cu.data || []).filter(q => q.credito_id === cr.id), ps = (pa.data || []).filter(p => p.credito_id === cr.id);
      const pagado = r2(Number(cr.total_financiado) - Number(cr.saldo_pendiente)), pct = cr.total_financiado > 0 ? Math.round(pagado / cr.total_financiado * 100) : 0;
      const activo = Number(cr.saldo_pendiente) > 0.004 && !['cancelado', 'refinanciado'].includes(cr.estado);
      return `<div class="pd-card" style="margin-bottom:10px"><div class="mf-card-cab"><div><b>${esc(cr.numero_credito)}</b> <span class="tl-muted">${cr.tipo === 'venta' ? '🛍️ Productos' : '💵 Préstamo'} · ${esc(FREC[cr.frecuencia] || cr.frecuencia || '')} · ${fCorta(String(cr.created_at).slice(0, 10))}</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn-secondary" onclick="abrirDocumentos('${cr.id}','${clienteId}')">🖨️ Documentos</button>
          ${activo ? `<button class="btn-primary" onclick="cerrarModal();abrirCobroDesdeTarjeta('${cr.id}')">💵 Cobrar</button>` : '<span class="pd-pill ok">✅ Pagado</span>'}</div></div>
        <div class="mf-montos"><div><span>Total</span><b>${fmt(cr.total_financiado)}</b></div><div><span>Pagado</span><b class="pd-verde">${fmt(pagado)}</b></div><div><span>Debe</span><b>${fmt(cr.saldo_pendiente)}</b></div></div>
        <div class="vd-barra" style="margin:8px 0"><i style="width:${Math.min(100, pct)}%"></i></div>
        ${conEquipo() ? (puedeAdministrar() && activo ? `<div class="tl-f" style="margin-bottom:8px"><label>👤 Lo cobra</label><select class="tl-sel" onchange="asignarUno('${cr.id}',this.value,'${clienteId}')">
            <option value="">Sin cobrador (dueño)</option>${MF.equipo.filter(e => e.activo || e.perfil_id === cr.mf_cobrador_id).map(e => `<option value="${e.perfil_id}" ${cr.mf_cobrador_id === e.perfil_id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></div>`
          : `<div class="tl-muted" style="margin-bottom:6px">👤 Lo cobra: ${esc(cr.mf_cobrador_nombre || 'el dueño')}</div>`) : ''}
        <details><summary class="tl-muted" style="cursor:pointer">Ver cuotas (${qs.length})</summary><div class="pd-tw"><table class="tl-tabla"><thead><tr><th>#</th><th>Fecha</th><th class="tl-num">Cuota</th><th class="tl-num">Pagado</th><th>Estado</th></tr></thead><tbody>
          ${qs.map(q => { const vencida = q.estado !== 'pagada' && String(q.fecha_vencimiento).slice(0, 10) < hoy;
            return `<tr><td data-t="#">${q.numero}</td><td data-t="Fecha">${fCorta(q.fecha_vencimiento)}</td><td class="tl-num" data-t="Cuota">${fmt(q.monto_total)}</td><td class="tl-num" data-t="Pagado">${fmt(q.monto_pagado)}</td>
              <td data-t="Estado">${q.estado === 'pagada' ? '<span class="pd-pill ok">Pagada</span>' : vencida ? '<span class="pd-pill mal">Atrasada</span>' : q.estado === 'parcial' ? '<span class="pd-pill ambar">Parcial</span>' : '<span class="pd-pill">Pendiente</span>'}</td></tr>`; }).join('')}</tbody></table></div></details>
        <details open><summary class="tl-muted" style="cursor:pointer">Pagos (${ps.length})</summary>${ps.length ? `<div class="pd-tw"><table class="tl-tabla"><tbody>${ps.map(p => `<tr${p.estado === 'anulado' ? ' style="opacity:.55"' : ''}>
          <td data-t="Recibo"><b>${esc(p.comprobante_numero || '—')}</b>${p.estado === 'anulado' ? ' <span class="pd-pill mal">Anulado</span>' : ''}<div class="tl-muted">${esc(p.observaciones || '')}${p.anulado_motivo ? ' · ' + esc(p.anulado_motivo) : ''}${conEquipo() && p.mf_cobrador_nombre ? ' · Cobró: ' + esc(p.mf_cobrador_nombre) : ''}${p.mf_entrega_id ? ' · <span class="pd-pill ok">entregado</span>' : ''}</div></td>
          <td data-t="Fecha">${fCorta(p.fecha)}</td><td class="tl-num" data-t="Monto">${fmt(p.monto)}</td><td data-t="Cómo">${esc(p.metodo_pago_nombre || '')}</td>
          <td class="tl-ac">${p.estado !== 'anulado' && !p.mf_entrega_id && puedeAdministrar() && String(p.comprobante_numero || '').startsWith('R-') ? `<button class="btn-secondary" style="padding:5px 9px;font-size:12px" onclick="anularCobro('${p.id}','${esc(p.comprobante_numero)}','${clienteId}')">Anular</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tl-muted">Sin pagos todavía.</p>'}</details></div>`;
    }).join('');
    const tel = c.whatsapp || c.telefono || '';
    document.getElementById('pd-modal-box').innerHTML = `<div class="tl-modal-cab"><h2>📒 ${esc(nombreCli(c))}</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
      <div class="tl-modal-cuerpo"><div class="tl-muted">${esc(c.telefono || '')}${c.direccion ? ' · 📍 ' + esc(c.direccion) : ''}${tel ? ` · <a href="https://wa.me/${waNum(tel)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div>
      ${cliPorId(clienteId) ? `<div class="vd-filtros" style="margin:8px 0"><label for="tz-zona" style="font-weight:600;font-size:13px">🏘️ Zona</label><input class="tl-inp" style="flex:1;min-width:0" id="tz-zona" maxlength="60" list="mf-zonas-dl" value="${esc(zonaDe(c))}" placeholder="Ej. San Judas">${datalistZonas()}
        <button class="btn-secondary" id="tz-ok" onclick="guardarZona('${clienteId}')">Guardar zona</button></div>` : ''}
      <div id="mf-ficha"></div>
      ${html || '<div class="pd-vacio"><b>Sin créditos.</b></div>'}</div>`;
    pintarFicha(clienteId);
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
  const r = await rpc('mf_anular_pago', { p_pago_id: pagoId, p_motivo: motivo.trim(), p_token: tk() });
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

/* ---------- 📋 CIERRE DEL DÍA (dueño / supervisor) ----------
   Solo lee: no cambia dinero. Junta en una hoja lo cobrado (por persona y forma de pago), lo anulado,
   lo vendido/prestado, las visitas y las entregas del día elegido. */
function rangoDia(iso) { const a = new Date(iso + 'T00:00:00'), b = new Date(a); b.setDate(b.getDate() + 1); return [a.toISOString(), b.toISOString()]; }
async function pintarCierre(v) {
  const dia = MF.cierreDia || hoyISO(); MF.cierreDia = dia;
  v.innerHTML = '<p class="tln-sub">Armando el cierre…</p>';
  const u = MF.userId, [ini, fin] = rangoDia(dia);
  let pagos = [], creds = [], gest = [], ents = [], moras = [];
  try {
    const [p1, c1, g1, e1] = await Promise.all([
      leerTodo(() => sb.from('creditos_pagos').select('id,credito_id,cliente_id,monto,estado,comprobante_numero,metodo_pago_id,metodo_pago_nombre,mf_cobrador_nombre,created_at').eq('auth_user_id', u).eq('fecha', dia).order('created_at').order('id')),
      leerTodo(() => sb.from('creditos').select('id,numero_credito,tipo,cliente_id,total_financiado,capital_financiado,mf_cobrador_nombre,mf_ref,created_at').eq('auth_user_id', u).gte('created_at', ini).lt('created_at', fin).order('created_at').order('id')),
      sb.from('mf_gestiones').select('tipo,creado_por,credito_id,created_at').eq('auth_user_id', u).gte('created_at', ini).lt('created_at', fin).limit(5000),
      sb.from('mf_entregas').select('cobrador_nombre,cobros,esperado,entregado,diferencia,recibido_por,created_at').eq('auth_user_id', u).gte('created_at', ini).lt('created_at', fin).order('created_at'),
    ]);
    pagos = p1; creds = c1.filter(c => c.mf_ref); gest = g1.data || []; ents = e1.data || [];
    try { const { data } = await sb.from('mf_moras').select('cobrada,perdonada,estado,cobrador_nombre').eq('auth_user_id', u).eq('fecha', dia).eq('estado', 'completado').limit(5000); moras = data || []; } catch (_) { moras = []; }
  } catch (e) { console.error(e); v.innerHTML = '<div class="tl-aviso">No se pudo armar el cierre. Revisa tu conexión.</div>'; return; }
  const ok = pagos.filter(p => p.estado === 'completado'), anul = pagos.filter(p => p.estado === 'anulado');
  const esEf = p => esEfectivo(p.metodo_pago_id, p.metodo_pago_nombre);
  const suma = l => r2(l.reduce((a, p) => a + Number(p.monto || 0), 0));
  const quien = p => p.mf_cobrador_nombre || 'Dueño / módulo Créditos';
  const personas = {};
  const P = n => personas[n] || (personas[n] = { cobros: 0, ef: 0, ot: 0, noEstaba: 0, promesa: 0 });
  ok.forEach(p => { const k = P(quien(p)); k.cobros++; if (esEf(p)) k.ef = r2(k.ef + Number(p.monto)); else k.ot = r2(k.ot + Number(p.monto)); });
  gest.forEach(g => { const k = P(g.creado_por || 'Usuario'); if (g.tipo === 'no_estaba') k.noEstaba++; if (g.tipo === 'promesa') k.promesa++; });
  const ventas = creds.filter(c => c.tipo === 'venta'), prest = creds.filter(c => c.tipo !== 'venta');
  const totV = r2(ventas.reduce((a, c) => a + Number(c.total_financiado || 0), 0)), totP = r2(prest.reduce((a, c) => a + Number(c.capital_financiado || 0), 0));
  const difs = r2(ents.reduce((a, e) => a + Number(e.diferencia || 0), 0));
  const moraC = r2(moras.reduce((a, m) => a + Number(m.cobrada || 0), 0)), moraP = r2(moras.reduce((a, m) => a + Number(m.perdonada || 0), 0));
  const esHoy = dia === hoyISO();
  let ruta = null;
  if (esHoy) {
    const cobr = new Set(MF.pagosHoy.map(p => p.credito_id));
    const l = MF.creditos.map(cr => ({ cr, s: situacion(cr), g: MF.promesas[cr.id] })).filter(x => x.s.pagarHoy > 0.004 || x.s.enCola > 0 || (x.g && x.g.tipo === 'promesa' && x.g.fecha_promesa === dia));
    l.forEach(x => { x.visto = visitadoHoy(x, cobr); });
    ruta = { total: l.length, vistos: l.filter(x => x.visto).length, falta: r2(l.filter(x => !x.visto).reduce((a, x) => a + x.s.pagarHoy, 0)) };
  }
  const neg = MF.cfg.nombre_comercial || 'Mi negocio', fechaTxt = new Date(dia + 'T12:00:00').toLocaleDateString('es-NI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const filasP = Object.entries(personas).sort((a, b) => (b[1].ef + b[1].ot) - (a[1].ef + a[1].ot));
  MF.cierreTxt = `📋 *Cierre del día — ${neg}*\n${fechaTxt}\n\n💵 Cobrado: ${fmt(suma(ok))} (${ok.length} recibos)\n   Efectivo: ${fmt(suma(ok.filter(esEf)))} · Otros: ${fmt(suma(ok.filter(p => !esEf(p))))}`
    + (moraC || moraP ? `\n⏰ Mora cobrada: ${fmt(moraC)}${moraP ? ' · perdonada: ' + fmt(moraP) : ''}` : '')
    + (anul.length ? `\n❌ Anulados: ${anul.length} (${fmt(suma(anul))})` : '')
    + (filasP.length ? '\n\n👤 Por persona:' + filasP.map(([n, k]) => `\n• ${n}: ${k.cobros} cobro(s) ${fmt(k.ef + k.ot)}${k.noEstaba ? ` · ${k.noEstaba} no estaba` : ''}${k.promesa ? ` · ${k.promesa} promesa(s)` : ''}`).join('') : '')
    + (creds.length ? `\n\n🛒 Nuevos: ${ventas.length} venta(s) al crédito ${fmt(totV)} · ${prest.length} préstamo(s) ${fmt(totP)}` : '')
    + (ents.length ? `\n\n🧾 Entregas: ${ents.length} · ${difs === 0 ? 'todo cuadró ✅' : (difs < 0 ? 'faltante ' : 'sobrante ') + fmt(Math.abs(difs))}` : '')
    + (ruta ? `\n\n🛵 Ruta: visitados ${ruta.vistos} de ${ruta.total} · quedó por cobrar ${fmt(ruta.falta)}` : '');
  v.innerHTML = `<div class="vd-filtros"><label for="ci-dia" style="font-weight:600">Día</label><input type="date" class="tl-inp" id="ci-dia" value="${dia}" max="${hoyISO()}" onchange="MF.cierreDia=this.value||hoyISO();pintarCierre(document.getElementById('pd-vista'))">
      <button class="btn-secondary" onclick="imprimirCierre()">🖨️ Imprimir</button><a class="btn-secondary" href="https://wa.me/?text=${encodeURIComponent(MF.cierreTxt)}" target="_blank" rel="noopener">💬 Enviar por WhatsApp</a></div>
    <div class="pd-kpis">
      <div class="pd-kpi"><div class="pd-kpi-l">💵 Cobrado</div><div class="pd-kpi-v pd-verde">${fmt(suma(ok))}</div><div class="pd-kpi-s">${ok.length} recibo(s)</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">💵 En efectivo</div><div class="pd-kpi-v">${fmt(suma(ok.filter(esEf)))}</div><div class="pd-kpi-s">Otros: ${fmt(suma(ok.filter(p => !esEf(p))))}</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">❌ Anulados</div><div class="pd-kpi-v ${anul.length ? 'pd-rojo' : ''}">${anul.length}</div><div class="pd-kpi-s">${fmt(suma(anul))}</div></div>
      ${moraC || moraP || moraActiva() ? `<div class="pd-kpi"><div class="pd-kpi-l">⏰ Mora cobrada</div><div class="pd-kpi-v">${fmt(moraC)}</div><div class="pd-kpi-s">perdonada: ${fmt(moraP)}</div></div>` : ''}
      ${ruta ? `<div class="pd-kpi"><div class="pd-kpi-l">🛵 Ruta de hoy</div><div class="pd-kpi-v">${ruta.vistos} de ${ruta.total}</div><div class="pd-kpi-s">visitados · faltó ${fmt(ruta.falta)}</div></div>` : ''}</div>
    <div class="pd-card"><h3>👤 Por persona</h3>${filasP.length ? `<div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Quién</th><th class="tl-num">Cobros</th><th class="tl-num">Efectivo</th><th class="tl-num">Otros</th><th class="tl-num">No estaba</th><th class="tl-num">Promesas</th></tr></thead><tbody>
      ${filasP.map(([n, k]) => `<tr><td data-t="Quién"><b>${esc(n)}</b></td><td class="tl-num" data-t="Cobros">${k.cobros}</td><td class="tl-num" data-t="Efectivo">${fmt(k.ef)}</td><td class="tl-num" data-t="Otros">${fmt(k.ot)}</td><td class="tl-num" data-t="No estaba">${k.noEstaba}</td><td class="tl-num" data-t="Promesas">${k.promesa}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tl-muted">Sin cobros ni visitas este día.</p>'}</div>
    <div class="pd-card"><h3>🛒 Vendido y prestado</h3>${creds.length ? `<div class="mf-montos"><div><span>Ventas al crédito (${ventas.length})</span><b>${fmt(totV)}</b></div><div><span>Préstamos entregados (${prest.length})</span><b>${fmt(totP)}</b></div></div>
      <div class="pd-tw" style="margin-top:8px"><table class="tl-tabla"><tbody>${creds.map(c => `<tr><td data-t="Crédito"><b>${esc(c.numero_credito)}</b> <span class="tl-muted">${c.tipo === 'venta' ? '🛍️ Venta' : '💵 Préstamo'}</span></td><td data-t="Cliente">${esc(nombreCli(cliPorId(c.cliente_id)))}</td><td class="tl-num" data-t="Total">${fmt(c.tipo === 'venta' ? c.total_financiado : c.capital_financiado)}</td><td data-t="Lo cobra">${esc(c.mf_cobrador_nombre || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tl-muted">Nada nuevo este día.</p>'}</div>
    <div class="pd-card"><h3>🧾 Entregas de cobradores</h3>${ents.length ? `<div class="pd-tw"><table class="tl-tabla"><tbody>${ents.map(e => `<tr><td data-t="Cobrador"><b>${esc(e.cobrador_nombre || '')}</b><div class="tl-muted">recibió ${esc(e.recibido_por || '')}</div></td><td class="tl-num" data-t="Debía">${fmt(e.esperado)}</td><td class="tl-num" data-t="Entregó">${fmt(e.entregado)}</td>
      <td class="tl-num ${Number(e.diferencia) < 0 ? 'pd-rojo' : ''}" data-t="Diferencia">${Number(e.diferencia) === 0 ? '✅ Cuadró' : (Number(e.diferencia) < 0 ? 'Faltó ' : 'Sobró ') + fmt(Math.abs(e.diferencia))}</td></tr>`).join('')}</tbody></table></div>` : `<p class="tl-muted">${conEquipo() ? 'Nadie entregó este día.' : 'Las entregas se usan con el trabajo en equipo encendido.'}</p>`}</div>
    ${anul.length ? `<div class="pd-card"><h3>❌ Cobros anulados</h3><div class="pd-tw"><table class="tl-tabla"><tbody>${anul.map(p => `<tr><td data-t="Recibo">${esc(p.comprobante_numero || '—')}</td><td data-t="Cliente">${esc(nombreCli(cliPorId(p.cliente_id)))}</td><td class="tl-num" data-t="Monto">${fmt(p.monto)}</td><td data-t="Cobró">${esc(quien(p))}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    ${esHoy && colaPendientes().length ? `<div class="tl-aviso">⏳ Hay ${colaPendientes().length} cobro(s) guardados sin señal en este teléfono que todavía no aparecen aquí.</div>` : ''}
    <p class="tl-muted">Incluye también los pagos registrados desde el módulo Créditos. ${moraC ? 'La mora va aparte del cobro (Caja la suma como ingreso).' : ''}</p>`;
}
function imprimirCierre() {
  if (!MF.cierreTxt) return;
  const w = window.open('', '_blank', 'width=420,height=700'); if (!w) { showToast('Permite las ventanas emergentes para imprimir.', 'error'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cierre ${esc(MF.cierreDia)}</title><style>body{font-family:monospace;font-size:13px;width:72mm;margin:0 auto;padding:6px}pre{white-space:pre-wrap;font-family:inherit}</style></head>
    <body><pre>${esc(MF.cierreTxt.replace(/\*/g, ''))}</pre><p style="text-align:center">_____________________<br>Revisado por</p><script>window.onload=()=>{window.print()}<\/script></body></html>`);
  w.document.close();
}

/* ---------- ⏰ MORA POR ATRASO ----------
   La que vale es la del SERVIDOR (al cobrar). Aquí solo se estima para mostrarla en la ruta. */
const MORA_TXT = { ninguna: 'Sin mora', fija_dia: 'Monto fijo por cada día de atraso', pct_dia: '% por día sobre lo atrasado', fija_cuota: 'Monto fijo por cada cuota atrasada' };
function moraActiva() { return MF.cfg.mf_mora_tipo && MF.cfg.mf_mora_tipo !== 'ninguna' && Number(MF.cfg.mf_mora_valor) > 0; }
function moraEstimada(cr) {
  if (!moraActiva()) return 0;
  const t = MF.cfg.mf_mora_tipo, v = Number(MF.cfg.mf_mora_valor), g = Number(MF.cfg.mf_mora_gracia || 0), tp = MF.cfg.mf_mora_tope_pct == null ? 100 : Number(MF.cfg.mf_mora_tope_pct), hoy = hoyISO();
  let m = 0, atr = 0, maxd = 0;
  (MF.cuotas[cr.id] || []).slice().sort((a, b) => a.numero - b.numero).forEach(q => {
    const venc = String(q.fecha_vencimiento).slice(0, 10), lim = masDias(venc, g), falta = r2(Number(q.monto_total) - Number(q.monto_pagado || 0));
    if (q.estado === 'pagada' || falta <= 0.005 || !(lim < hoy)) return;
    atr = r2(atr + falta);
    const desde = q.mf_mora_hasta && String(q.mf_mora_hasta).slice(0, 10) > lim ? String(q.mf_mora_hasta).slice(0, 10) : lim, d = diasEntre(desde, hoy);
    if (t === 'fija_cuota') { if (!q.mf_mora_hasta) m += v; }
    else if (d > 0) { if (t === 'pct_dia') m += falta * v / 100 * d; maxd = Math.max(maxd, d); }
  });
  if (t === 'fija_dia') m = v * maxd;
  return r2(Math.min(m, atr * tp / 100));
}
function metodosEf() { const c = MF.cfg.mf_metodos_efectivo; return Array.isArray(c) && c.length ? c : null; }
function esEfectivo(metId, nombre) { const c = metodosEf(); return c && metId ? c.includes(metId) : /efectivo/i.test(nombre || 'Efectivo'); }
function tarjetaDiasCobro() {
  if (!esDueno()) return '';
  const d = diasCobroNegocio();
  return `<div class="pd-card"><h3>📅 Días de cobro: <span class="pd-pill ok">${DIAS_COBRO[d]}</span></h3>
    <p class="tl-muted">Los días en que tu negocio cobra. Cada crédito nuevo ya viene así (se puede cambiar en un crédito puntual). Las cuotas no caen en los días que no cobras y el atraso cuenta <b>solo días de cobro</b>: si un cliente no paga el viernes, el lunes lleva 1 día de atraso, no 3. Los créditos que ya existen no cambian.</p>
    <div class="pd-tabs">${['lun_vie', 'lun_sab', 'todos'].map(k => `<button type="button" class="pd-tab ${d === k ? 'activa' : ''}" ${d === k ? 'disabled' : ''} onclick="guardarDiasCobro('${k}')">${DIAS_COBRO[k]}</button>`).join('')}</div></div>`;
}
async function guardarDiasCobro(dias) {
  if (MF.ocupado) return;
  MF.ocupado = true;
  const r = await rpc('mf_dias_cobro_config', { p: { token: tk(), dias } });
  MF.ocupado = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  MF.cfg.mf_dias_cobro = r.dias;
  if (MF.venta) MF.venta.dias = r.dias;
  showToast('Guardado: ' + DIAS_COBRO[r.dias] + '.');
  pintarEquipo(document.getElementById('pd-vista'));
}
function tarjetaEfectivo() {
  if (!esDueno()) return '';
  const c = metodosEf();
  return `<div class="pd-card"><h3>💵 ¿Qué cuenta como efectivo?</h3>
    <p class="tl-muted">Marca los métodos que son dinero en mano. Eso es lo que cada cobrador debe entregar al final del día. ${c ? '' : 'Ahora se usa el nombre: los que dicen “efectivo”.'}</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px">${MF.metodos.map(m => `<label class="mf-chk" style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="mf-ef-chk" value="${m.id}" ${esEfectivo(m.id, m.nombre) ? 'checked' : ''} style="width:17px;height:17px"> ${esc(m.nombre)}</label>`).join('')}</div>
    <div class="pd-acciones"><button class="btn-primary" id="mf-ef-ok" onclick="guardarEfectivoCfg()">Guardar</button></div></div>`;
}
async function guardarEfectivoCfg() {
  if (MF.ocupado) return;
  const ids = [...document.querySelectorAll('.mf-ef-chk:checked')].map(x => x.value);
  if (!ids.length && !confirm('No marcaste ninguno. Se volverá a usar el nombre (los que dicen “efectivo”). ¿Seguir?')) return;
  MF.ocupado = true; const b = document.getElementById('mf-ef-ok'); if (b) b.disabled = true;
  const r = await rpc('mf_efectivo_config', { p: { token: tk(), metodos: ids } });
  MF.ocupado = false; if (b) b.disabled = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  MF.cfg.mf_metodos_efectivo = r.metodos || null; showToast('Guardado.');
  pintarEquipo(document.getElementById('pd-vista'));
}
function tarjetaMora() {
  const c = MF.cfg, t = c.mf_mora_tipo || 'ninguna';
  return `<div class="pd-card"><h3>⏰ Mora por atraso: ${t === 'ninguna' ? '<span class="pd-pill">Sin mora</span>' : '<span class="pd-pill ok">Activa</span>'}</h3>
    <p class="tl-muted">Recargo que se cobra junto con la cuota cuando el cliente se atrasa. Entra a Caja como ingreso aparte y <b>no cambia lo que el cliente debe</b>. Nunca se cobra dos veces el mismo día de atraso.</p>
    <div class="tl-grid"><div class="tl-f"><label for="mo-tipo">Cómo se cobra</label><select class="tl-sel" id="mo-tipo" onchange="previewMoraCfg()">${Object.entries(MORA_TXT).map(([k, x]) => `<option value="${k}" ${k === t ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="tl-f"><label for="mo-valor" id="mo-valor-l">Valor</label><input class="tl-inp" id="mo-valor" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(c.mf_mora_valor || 0) || ''}" oninput="previewMoraCfg()"></div>
      <div class="tl-f"><label for="mo-gracia">Días de gracia</label><input class="tl-inp" id="mo-gracia" type="number" inputmode="numeric" min="0" max="60" step="1" value="${Number(c.mf_mora_gracia || 0)}" oninput="previewMoraCfg()"></div>
      <div class="tl-f"><label for="mo-tope">Tope (% de lo atrasado)</label><input class="tl-inp" id="mo-tope" type="number" inputmode="decimal" min="0" max="100" step="1" value="${c.mf_mora_tope_pct == null ? 20 : Number(c.mf_mora_tope_pct)}" oninput="previewMoraCfg()"></div>
      <label class="tl-f full mf-chk"><input type="checkbox" id="mo-perdona" ${c.mf_mora_perdona_cobrador ? 'checked' : ''}> Los cobradores pueden bajar o perdonar la mora (queda anotado quién)</label></div>
    <div id="mo-prev" style="margin-top:8px"></div>
    <div class="pd-acciones"><button class="btn-primary" id="mo-ok" onclick="guardarMoraCfg()">Guardar regla de mora</button></div></div>`;
}
function previewMoraCfg() {
  const t = document.getElementById('mo-tipo')?.value, v = Number(document.getElementById('mo-valor').value) || 0, g = parseInt(document.getElementById('mo-gracia').value) || 0, tp = Number(document.getElementById('mo-tope').value);
  const lbl = document.getElementById('mo-valor-l'); if (lbl) lbl.textContent = t === 'pct_dia' ? 'Porcentaje por día (%)' : t === 'fija_cuota' ? `Monto por cuota (${sym()})` : `Monto por día (${sym()})`;
  ['mo-valor', 'mo-gracia', 'mo-tope', 'mo-perdona'].forEach(id => { const e = document.getElementById(id); if (e) e.disabled = t === 'ninguna'; });
  const el = document.getElementById('mo-prev'); if (!el) return;
  if (t === 'ninguna') { el.innerHTML = '<div class="tl-aviso ok">No se cobra mora.</div>'; return; }
  // Ejemplo con una cuota de 100 atrasada 10 días
  const d = Math.max(0, 10 - g), base = t === 'fija_dia' ? v * d : t === 'pct_dia' ? 100 * v / 100 * d : (10 > g ? v : 0), ej = r2(Math.min(base, 100 * (isNaN(tp) ? 100 : tp) / 100));
  el.innerHTML = `<div class="tl-aviso ok">Ejemplo: una cuota de ${fmt(100)} con 10 días de atraso paga <b>${fmt(ej)}</b> de mora${g ? ` (los primeros ${g} día${g === 1 ? '' : 's'} no cuentan)` : ''}${!isNaN(tp) && tp < 100 ? `; nunca más del ${tp}% de lo atrasado` : ''}.</div>`;
}
async function guardarMoraCfg() {
  if (MF.ocupado) return;
  const p = { token: tk(), tipo: document.getElementById('mo-tipo').value, valor: Number(document.getElementById('mo-valor').value) || 0, gracia: parseInt(document.getElementById('mo-gracia').value) || 0,
    tope_pct: document.getElementById('mo-tope').value === '' ? 100 : Number(document.getElementById('mo-tope').value), perdona_cobrador: document.getElementById('mo-perdona').checked };
  if (p.tipo !== 'ninguna' && !(p.valor > 0)) { showToast('Escribe el valor de la mora.', 'error'); return; }
  MF.ocupado = true; const b = document.getElementById('mo-ok'); b.disabled = true;
  const r = await rpc('mf_mora_config', { p });
  MF.ocupado = false; b.disabled = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  Object.assign(MF.cfg, { mf_mora_tipo: p.tipo, mf_mora_valor: p.valor, mf_mora_gracia: p.gracia, mf_mora_tope_pct: p.tope_pct, mf_mora_perdona_cobrador: p.perdona_cobrador });
  showToast(p.tipo === 'ninguna' ? 'Mora desactivada.' : 'Regla de mora guardada.');
  pintarEquipo(document.getElementById('pd-vista'));
}

/* ---------- 🖨️ DOCUMENTOS: plan de pagos, pagaré y contrato ----------
   Solo lee e imprime: no cambia ningún dato de dinero. Modelo de uso general (revisar con un abogado). */
function numLetras(n) {
  const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
    'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  const menos100 = x => x < 30 ? U[x] : D[Math.floor(x / 10)] + (x % 10 ? ' y ' + U[x % 10] : '');
  const menos1000 = x => x === 100 ? 'cien' : (x >= 100 ? C[Math.floor(x / 100)] + (x % 100 ? ' ' + menos100(x % 100) : '') : menos100(x));
  const apoc = t => t.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
  const ent = x => {
    if (x === 0) return 'cero';
    let t = '';
    const mill = Math.floor(x / 1e6), mil = Math.floor((x % 1e6) / 1000), r = x % 1000;
    if (mill) t += (mill === 1 ? 'un millón' : apoc(ent(mill)) + ' millones') + ' ';
    if (mil) t += (mil === 1 ? 'mil' : apoc(menos1000(mil)) + ' mil') + ' ';
    if (r) t += menos1000(r);
    return t.trim();
  };
  const v = Math.round((Number(n) || 0) * 100), e = Math.floor(v / 100), c = v % 100;
  const t = apoc(ent(e));
  return (t.charAt(0).toUpperCase() + t.slice(1)) + ' con ' + String(c).padStart(2, '0') + '/100';
}
function monedaLarga() { const m = MF.cfg.moneda || 'NIO'; return m === 'USD' ? 'dólares' : m === 'CRC' ? 'colones' : 'córdobas'; }
function fLarga(iso) { return iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' }) : '____'; }
function textoMora() {
  if (!moraActiva()) return null;
  const c = MF.cfg, v = Number(c.mf_mora_valor), g = Number(c.mf_mora_gracia || 0), tp = c.mf_mora_tope_pct == null ? 100 : Number(c.mf_mora_tope_pct);
  const base = c.mf_mora_tipo === 'fija_dia' ? `${fmt(v)} por cada día de atraso` : c.mf_mora_tipo === 'pct_dia' ? `el ${v}% diario sobre el monto atrasado` : `${fmt(v)} por cada cuota pagada con atraso`;
  return `${base}${g ? `, contado después de ${g} día${g === 1 ? '' : 's'} de gracia` : ''}${tp < 100 ? `, sin exceder el ${tp}% de lo atrasado` : ''}`;
}
async function abrirDocumentos(creditoId, clienteId, opt) {
  const c = cliPorId(clienteId) || { id: clienteId, nombre: 'Cliente' };
  modal(`<div class="tl-modal-cab"><h2>🖨️ Documentos</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div><div class="tl-modal-cuerpo"><p class="tl-muted">Cargando…</p></div>`);
  try {
    const { data: cr, error } = await sb.from('creditos').select('id,numero_credito,tipo,total_financiado,capital_financiado,total_intereses,monto_original,frecuencia,num_cuotas,fecha_inicio,created_at,venta_id,saldo_pendiente')
      .eq('id', creditoId).eq('auth_user_id', MF.userId).maybeSingle();
    if (error || !cr) throw error || new Error('no existe');
    const [cu, pa, det] = await Promise.all([
      sb.from('creditos_cuotas').select('numero,fecha_vencimiento,monto_total,monto_pagado,estado').eq('credito_id', cr.id).order('numero'),
      sb.from('creditos_pagos').select('monto,observaciones,estado,fecha,comprobante_numero,metodo_pago_nombre').eq('credito_id', cr.id).eq('estado', 'completado').order('fecha'),
      cr.venta_id ? sb.from('venta_detalles').select('producto_nombre,cantidad,precio,subtotal').eq('venta_id', cr.venta_id) : Promise.resolve({ data: [] }),
    ]);
    const prima = r2((pa.data || []).filter(p => /prima/i.test(p.observaciones || '')).reduce((a, p) => a + Number(p.monto || 0), 0));
    let ficha = null; try { ficha = (await sb.from('mf_clientes_ficha').select('*').eq('cliente_id', clienteId).maybeSingle()).data; } catch (_) {}
    const hoyD = hoyISO(), venc = (cu.data || []).filter(q => q.estado !== 'pagada' && Number(q.monto_total) - Number(q.monto_pagado || 0) > 0.004 && String(q.fecha_vencimiento).slice(0, 10) < hoyD);
    MF.doc = { cr, c, cuotas: cu.data || [], prima, items: det.data || [], pagos: pa.data || [], ficha, atrasado: r2(venc.reduce((a, q) => a + Number(q.monto_total) - Number(q.monto_pagado || 0), 0)),
      diasAtraso: venc.length ? diasEntre(String(venc[0].fecha_vencimiento).slice(0, 10), hoyD) : 0 };
    let guard = {}; try { guard = JSON.parse(localStorage.getItem('n360_mf_doc_' + cr.id) || '{}') || {}; } catch (_) {}
    if (ficha) { guard.fnom = guard.fnom || ficha.fiador_nombre || ''; guard.fced = guard.fced || ficha.fiador_cedula || ''; guard.fdir = guard.fdir || ficha.fiador_direccion || ''; }
    const pagado = Number(cr.saldo_pendiente) <= 0.004, extra = typeof opt === 'object' && opt ? opt : {};
    const docsLista = [['plan', '📅 Plan de pagos', !pagado], ['pagare', '✍️ Pagaré', !pagado && !!extra.nuevo], ['contrato', '📄 Contrato', !pagado && !!extra.nuevo], ['estado', '📊 Estado de cuenta', !extra.nuevo && !pagado && !MF.doc.atrasado]]
      .concat(MF.doc.atrasado > 0 ? [['carta', '⚠️ Carta de cobro', true]] : []).concat(pagado ? [['constancia', '✅ Constancia de cancelación', true]] : []);
    document.getElementById('pd-modal-box').innerHTML = `<div class="tl-modal-cab"><h2>${extra.titulo ? esc(extra.titulo) + ' · 🖨️ Documentos' : '🖨️ Documentos · ' + esc(cr.numero_credito)}</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
      <div class="tl-modal-cuerpo">
        <div class="tl-grid"><div class="tl-f"><label for="dc-ced">Cédula del cliente</label><input class="tl-inp" id="dc-ced" maxlength="30" value="${esc(c.ruc || guard.ced || '')}"></div>
          <div class="tl-f"><label for="dc-dir">Domicilio del cliente</label><input class="tl-inp" id="dc-dir" maxlength="250" value="${esc(c.direccion || guard.dir || '')}"></div>
          <div class="tl-f"><label for="dc-lugar">Lugar de firma</label><input class="tl-inp" id="dc-lugar" maxlength="80" value="${esc(guard.lugar || MF.cfg.ciudad || '')}"></div>
          <div class="tl-f"><label for="dc-inc">Vencer todo después de</label><select class="tl-sel" id="dc-inc">${[2, 3, 4].map(n => `<option value="${n}" ${Number(guard.inc || 3) === n ? 'selected' : ''}>${n} cuotas atrasadas</option>`).join('')}</select></div></div>
        <details ${guard.fnom ? 'open' : ''}><summary style="cursor:pointer;font-weight:600;margin:6px 0">👥 Fiador (opcional)</summary>
          <div class="tl-grid"><div class="tl-f"><label for="dc-fnom">Nombre del fiador</label><input class="tl-inp" id="dc-fnom" maxlength="120" value="${esc(guard.fnom || '')}"></div>
            <div class="tl-f"><label for="dc-fced">Cédula del fiador</label><input class="tl-inp" id="dc-fced" maxlength="30" value="${esc(guard.fced || '')}"></div>
            <div class="tl-f full"><label for="dc-fdir">Domicilio del fiador</label><input class="tl-inp" id="dc-fdir" maxlength="250" value="${esc(guard.fdir || '')}"></div></div></details>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin:10px 0">${docsLista.map(([k, t, on]) => `<label class="mf-chk"><input type="checkbox" class="dc-doc" value="${k}" ${on ? 'checked' : ''}> ${t}</label>`).join('')}</div>
        <div class="tl-aviso">Modelo de uso general. Revísalo con un abogado antes de usarlo como documento legal.</div></div>
      <div class="tl-modal-pie">${extra.waPlan ? `<a class="btn-secondary" href="${esc(extra.waPlan)}" target="_blank" rel="noopener">💬 Plan por WhatsApp</a>` : ''}<button class="btn-secondary" onclick="abrirTarjeta('${clienteId}')">📒 Tarjeta</button>${extra.nuevo ? `<button class="btn-secondary" onclick="cerrarModal();mfTab('vender')">🛒 Nueva venta</button>` : ''}<button class="btn-primary" onclick="imprimirDocumentos()">🖨️ Imprimir</button></div>`;
  } catch (e) {
    console.error(e);
    const ex = typeof opt === 'object' && opt ? opt : {};
    document.getElementById('pd-modal-box').innerHTML = `<div class="tl-modal-cab"><h2>${ex.titulo ? esc(ex.titulo) : '🖨️ Documentos'}</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
      <div class="tl-modal-cuerpo">${ex.titulo ? '<div class="tl-aviso ok">El crédito quedó guardado.</div>' : ''}<div class="tl-aviso">No se pudieron cargar los documentos. Revisa tu conexión e intenta de nuevo.</div></div>
      <div class="tl-modal-pie">${ex.waPlan ? `<a class="btn-secondary" href="${esc(ex.waPlan)}" target="_blank" rel="noopener">💬 Plan por WhatsApp</a>` : ''}
        <button class="btn-secondary" onclick='abrirDocumentos(${JSON.stringify(creditoId)}, ${JSON.stringify(clienteId)}, ${esc(JSON.stringify(ex))})'>🔄 Reintentar</button>${ex.nuevo ? `<button class="btn-secondary" onclick="cerrarModal();mfTab('vender')">🛒 Nueva venta</button>` : ''}<button class="btn-primary" onclick="cerrarModal()">Cerrar</button></div>`;
  }
}
function htmlDocumentos(o) {
  const { cr, c, cuotas, prima, items, pagos, ficha } = MF.doc, cfg = MF.cfg;
  const acreedor = cfg.razon_social || cfg.nombre_comercial || 'El negocio', ruc = cfg.ruc ? ` (RUC ${esc(cfg.ruc)})` : '';
  const cli = nombreCli(c), ced = o.ced || '______________', dom = o.dir || '______________________', lugar = o.lugar || '__________';
  const fechaDoc = String(cr.created_at).slice(0, 10), frec = (FREC[cr.frecuencia] || cr.frecuencia || '').toLowerCase();
  const qs = cuotas.filter(q => !(prima > 0 && q.numero === 1)), deuda = r2(Number(cr.total_financiado) - prima);
  const primera = qs[0]?.fecha_vencimiento, ultima = qs[qs.length - 1]?.fecha_vencimiento;
  const mora = textoMora(), esVenta = cr.tipo === 'venta';
  const L = x => `${numLetras(x)} ${monedaLarga()} (${fmt(x)})`;
  const firma = (quien, nombre, cedula) => `<div class="firma"><div class="linea"></div><b>${esc(nombre)}</b>${quien ? '<br>' + quien : ''}${cedula ? '<br>Cédula: ' + esc(cedula) : ''}</div>`;
  const firmas = `<div class="firmas">${firma('Deudor', cli, o.ced)}${o.fnom ? firma('Fiador solidario', o.fnom, o.fced) : ''}${firma('Por el acreedor', acreedor, '')}</div>`;
  const cab = t => `<div class="cab"><div><b>${esc(cfg.nombre_comercial || acreedor)}</b>${cfg.ruc ? '<br>RUC ' + esc(cfg.ruc) : ''}${cfg.direccion ? '<br>' + esc(cfg.direccion) : ''}${cfg.telefono ? '<br>Tel. ' + esc(cfg.telefono) : ''}</div><div class="der"><h1>${t}</h1>No. ${esc(cr.numero_credito)}</div></div>`;
  const docs = [];
  if (o.docs.includes('plan')) docs.push(`${cab('PLAN DE PAGOS')}
    <p><b>Cliente:</b> ${esc(cli)} · <b>Cédula:</b> ${esc(ced)}<br><b>Fecha:</b> ${fLarga(fechaDoc)} · <b>Forma de pago:</b> ${esc(frec)}</p>
    <table><tr><td>${esVenta ? 'Valor de la compra' : 'Monto prestado'}</td><td class="n">${fmt(esVenta ? cr.total_financiado : cr.capital_financiado)}</td></tr>
      ${!esVenta && Number(cr.total_intereses) > 0 ? `<tr><td>Intereses</td><td class="n">${fmt(cr.total_intereses)}</td></tr>` : ''}
      <tr><td><b>Total del crédito</b></td><td class="n"><b>${fmt(cr.total_financiado)}</b></td></tr>
      ${prima > 0 ? `<tr><td>Prima pagada</td><td class="n">${fmt(prima)}</td></tr><tr><td><b>Saldo a pagar en cuotas</b></td><td class="n"><b>${fmt(deuda)}</b></td></tr>` : ''}</table>
    <table class="tab"><thead><tr><th>#</th><th>Fecha</th><th class="n">Cuota</th><th>Firma / sello de recibido</th></tr></thead><tbody>
      ${qs.map((q, i) => `<tr><td>${i + 1}</td><td>${fLarga(q.fecha_vencimiento)}</td><td class="n">${fmt(q.monto_total)}</td><td></td></tr>`).join('')}</tbody></table>
    ${mora ? `<p class="peq">Pago atrasado: se cobra mora de ${esc(mora)}.</p>` : ''}<p class="peq">Solo son válidos los recibos emitidos por ${esc(cfg.nombre_comercial || acreedor)}.</p>${firmas}`);
  if (o.docs.includes('pagare')) docs.push(`${cab('PAGARÉ')}<p class="monto">Por ${fmt(deuda)}</p>
    <p>Yo, <b>${esc(cli)}</b>, mayor de edad, identificado(a) con cédula No. <b>${esc(ced)}</b>, con domicilio en ${esc(dom)}, por medio del presente <b>PAGARÉ</b> me obligo a pagar
    incondicionalmente a la orden de <b>${esc(acreedor)}</b>${ruc}, la cantidad de <b>${L(deuda)}</b>, en ${qs.length} cuota${qs.length === 1 ? '' : 's'} de forma ${esc(frec)},
    según el plan de pagos de esta misma fecha, la primera el ${fLarga(primera)} y la última el ${fLarga(ultima)}.</p>
    ${mora ? `<p>En caso de atraso en cualquiera de las cuotas, pagaré además un recargo por mora de ${esc(mora)}.</p>` : ''}
    <p>La falta de pago de ${o.inc} cuotas dará derecho al acreedor a dar por vencido el plazo y exigir de inmediato el pago total del saldo pendiente. Puedo pagar antes de las fechas acordadas.</p>
    ${o.fnom ? `<p>Yo, <b>${esc(o.fnom)}</b>, mayor de edad, cédula No. <b>${esc(o.fced || '______________')}</b>, con domicilio en ${esc(o.fdir || '______________')}, me constituyo <b>fiador solidario</b> del deudor por todas las obligaciones de este pagaré.</p>` : ''}
    <p>${esc(lugar)}, ${fLarga(fechaDoc)}.</p>${firmas}`);
  if (o.docs.includes('contrato')) docs.push(`${cab(esVenta ? 'CONTRATO DE VENTA AL CRÉDITO' : 'CONTRATO DE PRÉSTAMO')}
    <p>En ${esc(lugar)}, el ${fLarga(fechaDoc)}, comparecen: por una parte <b>${esc(acreedor)}</b>${ruc}, en adelante <b>EL ACREEDOR</b>; y por otra <b>${esc(cli)}</b>, mayor de edad, cédula No. <b>${esc(ced)}</b>, con domicilio en ${esc(dom)}, en adelante <b>EL DEUDOR</b>${o.fnom ? `; y <b>${esc(o.fnom)}</b>, cédula No. ${esc(o.fced || '______')}, en adelante <b>EL FIADOR</b>` : ''}, quienes acuerdan:</p>
    <p><b>PRIMERA. Objeto.</b> ${esVenta ? `EL ACREEDOR vende al crédito a EL DEUDOR lo siguiente, que recibe en buen estado: ${items.filter(i => !/^Recargo/i.test(i.producto_nombre || '')).map(i => `${Number(i.cantidad)} × ${esc(i.producto_nombre)}`).join('; ') || 'los productos detallados en la venta'}.` : `EL ACREEDOR entrega en préstamo a EL DEUDOR la cantidad de ${L(cr.capital_financiado)}, que EL DEUDOR declara recibir en este acto.`}</p>
    <p><b>SEGUNDA. Monto.</b> El total del crédito es de ${L(cr.total_financiado)}${!esVenta && Number(cr.total_intereses) > 0 ? `, que incluye intereses por ${fmt(cr.total_intereses)}` : ''}.${prima > 0 ? ` EL DEUDOR paga hoy una prima de ${fmt(prima)}, quedando un saldo de ${fmt(deuda)}.` : ''}</p>
    <p><b>TERCERA. Forma de pago.</b> EL DEUDOR pagará ${fmt(deuda)} en ${qs.length} cuota${qs.length === 1 ? '' : 's'} de forma ${esc(frec)}, del ${fLarga(primera)} al ${fLarga(ultima)}, según el plan de pagos que forma parte de este contrato. Cada pago se aplica primero a la cuota más antigua.</p>
    <p><b>CUARTA. Mora.</b> ${mora ? `Si EL DEUDOR se atrasa, pagará un recargo por mora de ${esc(mora)}.` : 'No se cobra recargo por mora.'}</p>
    <p><b>QUINTA. Pago anticipado.</b> EL DEUDOR puede adelantar pagos o cancelar el total en cualquier momento.</p>
    <p><b>SEXTA. Incumplimiento.</b> Si EL DEUDOR deja de pagar ${o.inc} cuotas, EL ACREEDOR podrá dar por vencido el plazo y exigir el total del saldo pendiente${o.fnom ? ', también a EL FIADOR, quien responde solidariamente' : ''}.</p>
    <p><b>SÉPTIMA. Recibos.</b> Solo son válidos los recibos emitidos por EL ACREEDOR con su número.</p>
    ${ficha && ficha.garantia ? `<p><b>OCTAVA. Garantía.</b> En respaldo de este crédito, EL DEUDOR deja en garantía: ${esc(ficha.garantia)}${Number(ficha.garantia_valor) > 0 ? ` (valor estimado ${fmt(ficha.garantia_valor)})` : ''}, que le será devuelta al cancelar el total.</p>` : ''}
    <p>Leído el presente contrato, las partes lo aceptan y firman.</p>${firmas}`);
  const pagadoTot = r2(pagos.reduce((a, p) => a + Number(p.monto || 0), 0)), hoyD = hoyISO();
  if (o.docs.includes('estado')) docs.push(`${cab('ESTADO DE CUENTA')}
    <p><b>Cliente:</b> ${esc(cli)} · <b>Al:</b> ${fLarga(hoyD)}</p>
    <table><tr><td>Total del crédito</td><td class="n">${fmt(cr.total_financiado)}</td></tr><tr><td>Pagado</td><td class="n">${fmt(pagadoTot)}</td></tr>
      <tr><td><b>Saldo</b></td><td class="n"><b>${fmt(cr.saldo_pendiente)}</b></td></tr>${MF.doc.atrasado > 0 ? `<tr><td>Atrasado (${MF.doc.diasAtraso} días)</td><td class="n">${fmt(MF.doc.atrasado)}</td></tr>` : ''}</table>
    <table class="tab"><thead><tr><th>#</th><th>Vence</th><th class="n">Cuota</th><th class="n">Pagado</th><th>Estado</th></tr></thead><tbody>
      ${cuotas.map(q => { const f = String(q.fecha_vencimiento).slice(0, 10), falta = Number(q.monto_total) - Number(q.monto_pagado || 0);
        return `<tr><td>${q.numero}</td><td>${fLarga(f)}</td><td class="n">${fmt(q.monto_total)}</td><td class="n">${fmt(q.monto_pagado)}</td><td>${q.estado === 'pagada' || falta <= 0.004 ? 'Pagada' : f < hoyD ? 'ATRASADA' : Number(q.monto_pagado) > 0 ? 'Parcial' : 'Pendiente'}</td></tr>`; }).join('')}</tbody></table>
    ${pagos.length ? `<p><b>Pagos recibidos</b></p><table><tbody>${pagos.map(p => `<tr><td>${fLarga(p.fecha)}</td><td>${esc(p.comprobante_numero || '')}</td><td>${esc(p.metodo_pago_nombre || '')}</td><td class="n">${fmt(p.monto)}</td></tr>`).join('')}</tbody></table>` : ''}`);
  if (o.docs.includes('carta')) docs.push(`${cab('AVISO DE COBRO')}
    <p>${esc(lugar)}, ${fLarga(hoyD)}</p><p>Señor(a) <b>${esc(cli)}</b><br>${esc(dom)}</p>
    <p>Por este medio le recordamos que su crédito No. <b>${esc(cr.numero_credito)}</b> tiene <b>${MF.doc.diasAtraso} días de atraso</b>, con un monto vencido de <b>${L(MF.doc.atrasado)}</b>.
    Su saldo total es de ${fmt(cr.saldo_pendiente)}.</p>
    ${mora ? `<p>Le recordamos que el atraso genera un recargo por mora de ${esc(mora)}.</p>` : ''}
    <p>Le pedimos ponerse al día a la mayor brevedad o comunicarse con nosotros${cfg.telefono ? ' al ' + esc(cfg.telefono) : ''} para acordar una forma de pago.${o.fnom ? ` Se envía copia a su fiador, ${esc(o.fnom)}.` : ''}</p>
    <p>Si ya realizó su pago, por favor ignore este aviso.</p><p>Atentamente,</p><div class="firmas">${firma('', acreedor, '')}</div>`);
  if (o.docs.includes('constancia')) docs.push(`${cab('CONSTANCIA DE CANCELACIÓN')}
    <p>${esc(acreedor)}${ruc} hace constar que <b>${esc(cli)}</b>, cédula No. <b>${esc(ced)}</b>, <b>canceló en su totalidad</b> el crédito No. <b>${esc(cr.numero_credito)}</b>
    por un total de ${L(cr.total_financiado)}, y que a la fecha no adeuda ningún saldo por este crédito.${ficha && ficha.garantia ? ` Se devuelve la garantía: ${esc(ficha.garantia)}.` : ''}</p>
    <p>Se extiende la presente a solicitud del interesado en ${esc(lugar)}, el ${fLarga(hoyD)}.</p><div class="firmas">${firma('Por el acreedor', acreedor, '')}</div>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cr.numero_credito)} · Documentos</title><style>
    @page{size:letter;margin:18mm 16mm}body{font-family:Georgia,'Times New Roman',serif;font-size:12.5px;line-height:1.55;color:#111;margin:0}
    .doc{page-break-after:always}.doc:last-child{page-break-after:auto}.cab{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px;font-size:11.5px}
    .der{text-align:right}h1{font-size:17px;margin:0 0 2px;letter-spacing:.5px}p{margin:8px 0;text-align:justify}.peq{font-size:11px;color:#333}.monto{font-size:16px;font-weight:bold;text-align:right}
    table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #999;padding:4px 6px;text-align:left}.n{text-align:right;white-space:nowrap}.tab td:last-child{width:40%}
    .firmas{display:flex;gap:24px;flex-wrap:wrap;margin-top:46px}.firma{flex:1;min-width:150px;text-align:center;font-size:11.5px}.linea{border-top:1px solid #111;margin-bottom:4px}
  </style></head><body>${docs.map(d => `<div class="doc">${d}</div>`).join('')}<script>window.onload=()=>{window.print()}<\/script></body></html>`;
}
async function imprimirDocumentos() {
  if (!MF.doc) return;
  const v = id => (document.getElementById(id)?.value || '').trim();
  const o = { ced: v('dc-ced'), dir: v('dc-dir'), lugar: v('dc-lugar'), inc: Number(v('dc-inc')) || 3, fnom: v('dc-fnom'), fced: v('dc-fced'), fdir: v('dc-fdir'),
    docs: [...document.querySelectorAll('.dc-doc:checked')].map(x => x.value) };
  if (!o.docs.length) { showToast('Marca al menos un documento.', 'error'); return; }
  try { localStorage.setItem('n360_mf_doc_' + MF.doc.cr.id, JSON.stringify({ ced: o.ced, dir: o.dir, lugar: o.lugar, inc: o.inc, fnom: o.fnom, fced: o.fced, fdir: o.fdir })); } catch (_) {}
  const w = window.open('', '_blank'); if (!w) { showToast('Permite las ventanas emergentes para imprimir.', 'error'); return; }
  w.document.write(htmlDocumentos(o)); w.document.close();
  // Si el cliente no tenía cédula o dirección guardada, se guarda (solo esos datos del cliente)
  const c = MF.doc.c, cambios = {};
  if (o.ced && !c.ruc) cambios.ruc = o.ced.slice(0, 30);
  if (o.dir && !c.direccion) cambios.direccion = o.dir.slice(0, 250);
  if (Object.keys(cambios).length && cliPorId(c.id)) {
    try { const { error } = await sb.from('clientes').update(cambios).eq('id', c.id).eq('auth_user_id', MF.userId); if (!error) Object.assign(cliPorId(c.id), cambios); } catch (_) {}
  }
}

/* ---------- 🛡️ ANTES DE PRESTAR: revisión del cliente y ficha de crédito ----------
   La revisión que vale es la de la BASE al guardar; aquí se muestra antes para que nadie se lleve sorpresas. */
async function cargarRevision(clienteId) {
  const el = document.getElementById('mf-rev'); if (!el) return;
  if (MF.rev && MF.rev.cliente === clienteId) { pintarRevision(); return; }
  if (MF.venta) { MF.venta.autoriza = false; MF.venta.autMotivo = ''; }
  el.innerHTML = '<p class="tl-muted">Revisando al cliente…</p>';
  const r = await rpc('mf_revision_ver', { p: { token: tk(), cliente_id: clienteId } });
  if (!MF.venta || MF.venta.clienteId !== clienteId) return;
  MF.rev = r.ok ? { ...r, cliente: clienteId } : null;
  pintarRevision(); pintarResumenVenta();
}
function problemaRevision(k) {
  const R = MF.rev, V = MF.venta; if (!R || !V || R.cliente !== V.clienteId) return null;
  const nueva = r2((k.total || 0) - (k.prima || 0));
  if (R.limite != null && r2(Number(R.deuda) + nueva) > Number(R.limite) + 0.004) return { tipo: 'limite', quedaria: r2(Number(R.deuda) + nueva) };
  if (R.bloq_dias != null && Number(R.atraso_dias) > Number(R.bloq_dias)) return { tipo: 'atrasado' };
  return null;
}
function pintarRevision() {
  const el = document.getElementById('mf-rev'); if (!el) return;
  const R = MF.rev, V = MF.venta; if (!R) { el.innerHTML = ''; return; }
  const k = calcVenta(), p = problemaRevision(k);
  el.innerHTML = `<div class="pd-card mf-rev ${p ? 'mal' : ''}"><h3>🛡️ Revisión del cliente</h3>
    <div class="mf-montos"><div><span>Debe hoy</span><b>${fmt(R.deuda)}</b></div><div><span>Límite</span><b>${R.limite == null ? 'Sin límite' : fmt(R.limite)}</b></div>
      ${R.limite != null ? `<div><span>Disponible</span><b class="${Number(R.disponible) <= 0 ? 'pd-rojo' : 'pd-verde'}">${fmt(Math.max(0, R.disponible))}</b></div>` : ''}
      <div><span>Atraso</span><b class="${Number(R.atraso_dias) > 0 ? 'pd-rojo' : ''}">${Number(R.atraso_dias) > 0 ? R.atraso_dias + ' días' : 'Al día'}</b></div></div>
    ${p ? `<div class="tl-aviso" style="margin-top:8px">${p.tipo === 'limite' ? `⚠️ Con este crédito quedaría debiendo ${fmt(p.quedaria)}: pasa su límite.` : `⚠️ Tiene ${R.atraso_dias} días de atraso (el negocio no presta con más de ${R.bloq_dias}).`}</div>
      ${puedeAdministrar() ? `<label class="mf-chk tl-f" style="margin-top:8px"><input type="checkbox" ${V.autoriza ? 'checked' : ''} onchange="MF.venta.autoriza=this.checked;pintarRevision();pintarResumenVenta()"> Autorizo esta excepción (queda anotado a mi nombre)</label>
        ${V.autoriza ? `<div class="tl-f"><label for="mf-autm">Motivo</label><input class="tl-inp" id="mf-autm" maxlength="200" value="${esc(V.autMotivo || '')}" placeholder="Ej. cliente de confianza, paga el viernes" oninput="MF.venta.autMotivo=this.value;pintarResumenVenta()"></div>` : ''}`
        : '<p class="tl-muted">Pide al dueño o supervisor que lo autorice.</p>'}`
      : Number(R.atraso_dias) > 0 ? `<p class="tl-muted" style="margin-top:6px">Ojo: tiene cuotas atrasadas.</p>` : ''}</div>`;
}
async function pintarFicha(clienteId) {
  const el = document.getElementById('mf-ficha'); if (!el || !cliPorId(clienteId)) return;
  let f = null; try { f = (await sb.from('mf_clientes_ficha').select('*').eq('cliente_id', clienteId).maybeSingle()).data; } catch (_) {}
  const edita = puedeAdministrar(), v = x => esc(x == null ? '' : x), ro = edita ? '' : 'readonly';
  el.innerHTML = `<details class="pd-card" style="margin:8px 0" ${f ? '' : ''}><summary style="cursor:pointer;font-weight:700">🛡️ Ficha de crédito ${f && f.limite != null ? '· límite ' + fmt(f.limite) : ''}${f && f.fiador_nombre ? ' · fiador ' + esc(f.fiador_nombre) : ''}${f && f.garantia ? ' · con garantía' : ''}</summary>
    <div class="tl-grid" style="margin-top:8px"><div class="tl-f"><label for="fi-lim">Límite de crédito</label><input class="tl-inp" id="fi-lim" type="number" inputmode="decimal" min="0" step="0.01" value="${v(f?.limite)}" placeholder="${MF.cfg.mf_limite_defecto != null ? 'Por defecto ' + fmt(MF.cfg.mf_limite_defecto) : 'Sin límite'}" ${ro}></div>
      <div class="tl-f"><label for="fi-gar">Garantía</label><input class="tl-inp" id="fi-gar" maxlength="300" value="${v(f?.garantia)}" placeholder="Ej. moto Honda placa M123" ${ro}></div>
      <div class="tl-f"><label for="fi-garv">Valor de la garantía</label><input class="tl-inp" id="fi-garv" type="number" inputmode="decimal" min="0" step="0.01" value="${v(f?.garantia_valor)}" ${ro}></div>
      <div class="tl-f"><label for="fi-fnom">Fiador</label><input class="tl-inp" id="fi-fnom" maxlength="120" value="${v(f?.fiador_nombre)}" ${ro}></div>
      <div class="tl-f"><label for="fi-fced">Cédula del fiador</label><input class="tl-inp" id="fi-fced" maxlength="30" value="${v(f?.fiador_cedula)}" ${ro}></div>
      <div class="tl-f"><label for="fi-ftel">Teléfono del fiador</label><input class="tl-inp" id="fi-ftel" maxlength="30" inputmode="tel" value="${v(f?.fiador_telefono)}" ${ro}></div>
      <div class="tl-f full"><label for="fi-fdir">Domicilio del fiador</label><input class="tl-inp" id="fi-fdir" maxlength="250" value="${v(f?.fiador_direccion)}" ${ro}></div>
      <div class="tl-f full"><label for="fi-not">Notas</label><input class="tl-inp" id="fi-not" maxlength="300" value="${v(f?.notas)}" ${ro}></div></div>
    ${f && f.actualizado_por ? `<p class="tl-muted">Actualizado por ${esc(f.actualizado_por)} · ${new Date(f.updated_at).toLocaleDateString('es-NI')}</p>` : ''}
    ${edita ? `<div class="pd-acciones"><button class="btn-primary" id="fi-ok" onclick="guardarFicha('${clienteId}')">Guardar ficha</button></div>` : '<p class="tl-muted">Solo el dueño o supervisor cambian la ficha.</p>'}</details>`;
}
async function guardarFicha(clienteId) {
  if (MF.ocupado) return;
  const v = id => document.getElementById(id).value.trim();
  const p = { token: tk(), cliente_id: clienteId, limite: v('fi-lim'), garantia: v('fi-gar'), garantia_valor: v('fi-garv'), fiador_nombre: v('fi-fnom'), fiador_cedula: v('fi-fced'),
    fiador_telefono: v('fi-ftel'), fiador_direccion: v('fi-fdir'), notas: v('fi-not'), por: perfilNombre() };
  if ((p.limite !== '' && !(Number(p.limite) >= 0)) || (p.garantia_valor !== '' && !(Number(p.garantia_valor) >= 0))) { showToast('Revisa los montos.', 'error'); return; }
  MF.ocupado = true; const b = document.getElementById('fi-ok'); b.disabled = true;
  const r = await rpc('mf_ficha_guardar', { p });
  MF.ocupado = false; b.disabled = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  MF.rev = null; showToast('Ficha guardada.'); pintarFicha(clienteId);
}
function prefDocsAuto() { try { return localStorage.getItem('n360_mf_docs_auto_' + MF.userId) !== '0'; } catch (_) { return true; } }
function tarjetaPrestar() {
  const c = MF.cfg;
  return `<div class="pd-card"><h3>🛡️ Antes de prestar</h3>
    <p class="tl-muted">El sistema revisa a cada cliente al vender o prestar. Si pasa su límite o tiene demasiado atraso, <b>no deja guardar</b> salvo que el dueño o supervisor autorice la excepción (queda anotado). Cada cliente puede tener su propio límite en su ficha 📒.</p>
    <div class="tl-grid"><div class="tl-f"><label for="pr-lim">Límite por cliente (por defecto)</label><input class="tl-inp" id="pr-lim" type="number" inputmode="decimal" min="0" step="0.01" value="${c.mf_limite_defecto ?? ''}" placeholder="Vacío = sin límite"></div>
      <div class="tl-f"><label for="pr-dias">No prestar si tiene más de … días de atraso</label><input class="tl-inp" id="pr-dias" type="number" inputmode="numeric" min="1" max="365" step="1" value="${c.mf_bloq_atraso_dias ?? ''}" placeholder="Vacío = solo avisar"></div>
      <label class="tl-f full mf-chk"><input type="checkbox" id="pr-docs" ${prefDocsAuto() ? 'checked' : ''}> Al terminar cada venta o préstamo, abrir de una vez el contrato, pagaré y plan de pagos para imprimir (en este teléfono)</label></div>
    <div class="pd-acciones"><button class="btn-primary" id="pr-ok" onclick="guardarPrestarCfg()">Guardar</button></div></div>`;
}
async function guardarPrestarCfg() {
  if (MF.ocupado) return;
  const lim = document.getElementById('pr-lim').value.trim(), dias = document.getElementById('pr-dias').value.trim();
  try { localStorage.setItem('n360_mf_docs_auto_' + MF.userId, document.getElementById('pr-docs').checked ? '1' : '0'); } catch (_) {}
  if ((lim !== '' && !(Number(lim) >= 0)) || (dias !== '' && !(parseInt(dias) >= 1 && parseInt(dias) <= 365))) { showToast('Revisa el límite y los días (1 a 365).', 'error'); return; }
  MF.ocupado = true; const b = document.getElementById('pr-ok'); b.disabled = true;
  const r = await rpc('mf_prestar_config', { p: { token: tk(), limite_defecto: lim, bloq_atraso_dias: dias } });
  MF.ocupado = false; b.disabled = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  MF.cfg.mf_limite_defecto = lim === '' ? null : Number(lim); MF.cfg.mf_bloq_atraso_dias = dias === '' ? null : parseInt(dias); MF.rev = null;
  showToast('Guardado.');
}

/* ---------- 📈 REPORTES DE CARTERA (dueño / supervisor) ----------
   Solo leen: no cambian nada. Cartera por antigüedad del atraso, por cobrador, lo que viene y la colocación. */
const TRAMOS = [['al_dia', 'Al día', 0, 0], ['t1', '1 a 30 días', 1, 30], ['t2', '31 a 60 días', 31, 60], ['t3', '61 a 90 días', 61, 90], ['t4', 'Más de 90 días', 91, 1e9]];
function tramoDe(d) { return (TRAMOS.find(t => d >= t[2] && d <= t[3]) || TRAMOS[4])[0]; }
function rangoReporte() {
  const h = hoyISO(), d = new Date(h + 'T12:00:00'), p = MF.repPeriodo || 'mes';
  if (p === 'semana') { const w = (d.getDay() + 6) % 7; return [masDias(h, -w), h]; }
  if (p === 'mes_ant') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); return [ymd(a), ymd(b)]; }
  if (p === 'otro' && MF.repDesde && MF.repHasta) return [MF.repDesde, MF.repHasta];
  return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), h];
}
async function pintarReportes(v) {
  v.innerHTML = '<p class="tln-sub">Armando los reportes…</p>';
  const u = MF.userId, [desde, hasta] = rangoReporte(), hoy = hoyISO();
  let pagos = [], moras = [], cuotasP = [], nuevos = [], credMap = {};
  try {
    [pagos, cuotasP, nuevos] = await Promise.all([
      leerTodo(() => sb.from('creditos_pagos').select('id,credito_id,monto,fecha,mf_cobrador_nombre').eq('auth_user_id', u).eq('estado', 'completado').gte('fecha', desde).lte('fecha', hasta).order('id')),
      leerTodo(() => sb.from('creditos_cuotas').select('credito_id,monto_total,monto_pagado,fecha_vencimiento').eq('auth_user_id', u).gte('fecha_vencimiento', desde).lte('fecha_vencimiento', hasta).order('credito_id')),
      leerTodo(() => sb.from('creditos').select('id,tipo,total_financiado,capital_financiado,created_at,mf_cobrador_nombre,mf_ref,estado').eq('auth_user_id', u).gte('created_at', new Date(desde + 'T00:00:00').toISOString()).lte('created_at', new Date(hasta + 'T23:59:59').toISOString()).order('id')),
    ]);
    try { moras = (await sb.from('mf_moras').select('cobrada,perdonada,cobrador_nombre,fecha').eq('auth_user_id', u).eq('estado', 'completado').gte('fecha', desde).lte('fecha', hasta).limit(10000)).data || []; } catch (_) { moras = []; }
    MF.creditos.forEach(c => { credMap[c.id] = c; });
    const faltan = [...new Set(cuotasP.map(q => q.credito_id).concat(pagos.map(p => p.credito_id)))].filter(id => !credMap[id]);
    for (let i = 0; i < faltan.length; i += 150) {
      const { data } = await sb.from('creditos').select('id,cliente_id,mf_cobrador_id,mf_cobrador_nombre,estado').in('id', faltan.slice(i, i + 150));
      (data || []).forEach(c => { credMap[c.id] = c; });
    }
  } catch (e) { console.error(e); v.innerHTML = '<div class="tl-aviso">No se pudieron armar los reportes. Revisa tu conexión.</div>'; return; }
  // 1) Antigüedad de la cartera (créditos vigentes)
  const sit = MF.creditos.map(cr => ({ cr, s: situacion(cr), c: cliPorId(cr.cliente_id) }));
  const tot = r2(sit.reduce((a, x) => a + x.s.saldo, 0));
  const porTramo = {}; TRAMOS.forEach(t => { porTramo[t[0]] = { n: 0, saldo: 0, atr: 0, lista: [] }; });
  sit.forEach(x => { const k = porTramo[tramoDe(x.s.dias)]; k.n++; k.saldo = r2(k.saldo + x.s.saldo); k.atr = r2(k.atr + x.s.atrasado); k.lista.push(x); });
  const enMora = r2(tot - porTramo.al_dia.saldo), pctMora = tot > 0 ? Math.round(enMora / tot * 1000) / 10 : 0;
  // 2) Por cobrador
  const nomCob = cr => (cr && cr.mf_cobrador_nombre) || 'Sin cobrador (dueño)';
  const cob = {}; const C = n => cob[n] || (cob[n] = { creditos: 0, saldo: 0, atr: 0, enMora: 0, esperado: 0, cobradoCuotas: 0, cobrado: 0, mora: 0 });
  sit.forEach(x => { const k = C(nomCob(x.cr)); k.creditos++; k.saldo = r2(k.saldo + x.s.saldo); k.atr = r2(k.atr + x.s.atrasado); if (x.s.dias > 0) k.enMora = r2(k.enMora + x.s.saldo); });
  cuotasP.forEach(q => { const k = C(nomCob(credMap[q.credito_id])); k.esperado = r2(k.esperado + Number(q.monto_total)); k.cobradoCuotas = r2(k.cobradoCuotas + Math.min(Number(q.monto_pagado || 0), Number(q.monto_total))); });
  pagos.forEach(p => { const k = C(p.mf_cobrador_nombre || nomCob(credMap[p.credito_id])); k.cobrado = r2(k.cobrado + Number(p.monto)); });
  moras.forEach(m => { const k = C(m.cobrador_nombre || 'Sin cobrador (dueño)'); k.mora = r2(k.mora + Number(m.cobrada || 0)); });
  const filasCob = Object.entries(cob).sort((a, b) => b[1].saldo - a[1].saldo);
  // 3) Lo que viene (cuotas pendientes)
  const prox = []; for (let i = 0; i < 7; i++) prox.push({ f: masDias(hoy, i), m: 0, n: 0 });
  let p30 = 0;
  MF.creditos.forEach(cr => (MF.cuotas[cr.id] || []).forEach(q => {
    const f = String(q.fecha_vencimiento).slice(0, 10), falta = r2(Number(q.monto_total) - Number(q.monto_pagado || 0)); if (falta <= 0.004 || f < hoy) return;
    const d = prox.find(x => x.f === f); if (d) { d.m = r2(d.m + falta); d.n++; }
    if (f <= masDias(hoy, 29)) p30 = r2(p30 + falta);
  }));
  const vencidoHoy = r2(sit.reduce((a, x) => a + x.s.atrasado, 0));
  // 4) Riesgo: muy atrasados o con promesa incumplida
  const riesgo = sit.filter(x => x.s.dias > 60 || (x.s.dias > 0 && MF.promesas[x.cr.id] && MF.promesas[x.cr.id].tipo === 'promesa' && MF.promesas[x.cr.id].fecha_promesa < hoy))
    .sort((a, b) => b.s.dias - a.s.dias).slice(0, 30);
  // 5) Colocación
  const colV = nuevos.filter(c => c.tipo === 'venta'), colP = nuevos.filter(c => c.tipo !== 'venta');
  const esperadoTot = r2(filasCob.reduce((a, [, k]) => a + k.esperado, 0)), cobCuotasTot = r2(filasCob.reduce((a, [, k]) => a + k.cobradoCuotas, 0));
  const efect = esperadoTot > 0 ? Math.round(cobCuotasTot / esperadoTot * 100) : null;
  MF.repCSV = [['Cliente', 'Crédito', 'Cobrador', 'Tramo', 'Días de atraso', 'Atrasado', 'Saldo']].concat(sit.sort((a, b) => b.s.dias - a.s.dias)
    .map(x => [nombreCli(x.c), x.cr.numero_credito, nomCob(x.cr), (TRAMOS.find(t => t[0] === tramoDe(x.s.dias)) || [])[1], x.s.dias, x.s.atrasado, x.s.saldo]));
  const barra = (val, max, mal) => `<div class="vd-barra" style="margin-top:4px"><i style="width:${max > 0 ? Math.min(100, Math.round(val / max * 100)) : 0}%;${mal ? 'background:var(--danger,#dc2626)' : ''}"></i></div>`;
  v.innerHTML = `<div class="vd-filtros mf-ruta-op">
      <select class="tl-sel" aria-label="Período" onchange="MF.repPeriodo=this.value;pintarReportes(document.getElementById('pd-vista'))">
        ${[['semana', 'Esta semana'], ['mes', 'Este mes'], ['mes_ant', 'Mes pasado'], ['otro', 'Otras fechas']].map(([k, t]) => `<option value="${k}" ${(MF.repPeriodo || 'mes') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${(MF.repPeriodo === 'otro') ? `<input type="date" class="tl-inp" value="${desde}" max="${hoy}" onchange="MF.repDesde=this.value;pintarReportes(document.getElementById('pd-vista'))" aria-label="Desde">
        <input type="date" class="tl-inp" value="${hasta}" max="${hoy}" onchange="MF.repHasta=this.value;pintarReportes(document.getElementById('pd-vista'))" aria-label="Hasta">` : ''}
      <button class="btn-secondary" onclick="descargarCartera()">⬇️ Cartera en Excel (CSV)</button><button class="btn-secondary" onclick="window.print()">🖨️ Imprimir</button></div>
    <p class="tl-muted">Período: ${fCorta(desde)} al ${fCorta(hasta)}. La cartera y la antigüedad son de hoy.</p>
    <div class="pd-kpis">
      <div class="pd-kpi"><div class="pd-kpi-l">💰 Cartera total</div><div class="pd-kpi-v">${fmt(tot)}</div><div class="pd-kpi-s">${MF.creditos.length} crédito(s) vigentes</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">⏰ Cartera en mora</div><div class="pd-kpi-v pd-rojo">${pctMora}%</div><div class="pd-kpi-s">${fmt(enMora)} con algún atraso</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">💵 Cobrado en el período</div><div class="pd-kpi-v pd-verde">${fmt(r2(pagos.reduce((a, p) => a + Number(p.monto), 0)))}</div><div class="pd-kpi-s">+ mora ${fmt(r2(moras.reduce((a, m) => a + Number(m.cobrada || 0), 0)))}</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">🎯 Efectividad</div><div class="pd-kpi-v">${efect == null ? '—' : efect + '%'}</div><div class="pd-kpi-s">de lo que vencía en el período</div></div></div>
    <div class="pd-card"><h3>⏳ Cartera por antigüedad del atraso</h3><div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Tramo</th><th class="tl-num">Créditos</th><th class="tl-num">Saldo</th><th class="tl-num">% cartera</th><th class="tl-num">Atrasado</th><th></th></tr></thead><tbody>
      ${TRAMOS.map(([k, t]) => { const x = porTramo[k]; return `<tr><td data-t="Tramo"><b>${t}</b>${barra(x.saldo, tot, k !== 'al_dia')}</td><td class="tl-num" data-t="Créditos">${x.n}</td><td class="tl-num" data-t="Saldo">${fmt(x.saldo)}</td>
        <td class="tl-num" data-t="% cartera">${tot > 0 ? Math.round(x.saldo / tot * 1000) / 10 : 0}%</td><td class="tl-num ${x.atr > 0 ? 'pd-rojo' : ''}" data-t="Atrasado">${fmt(x.atr)}</td>
        <td class="tl-ac">${x.n && k !== 'al_dia' ? `<button class="btn-secondary" style="padding:5px 9px;font-size:12px" onclick="verTramo('${k}')">Ver</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div><div id="rep-tramo"></div></div>
    <div class="pd-card"><h3>👤 Por cobrador</h3><div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Cobrador</th><th class="tl-num">Créditos</th><th class="tl-num">Cartera</th><th class="tl-num">% en mora</th><th class="tl-num">Vencía</th><th class="tl-num">Cobrado</th><th class="tl-num">Mora cobrada</th><th class="tl-num">Efectividad</th></tr></thead><tbody>
      ${filasCob.map(([n, k]) => `<tr><td data-t="Cobrador"><b>${esc(n)}</b></td><td class="tl-num" data-t="Créditos">${k.creditos}</td><td class="tl-num" data-t="Cartera">${fmt(k.saldo)}</td>
        <td class="tl-num ${k.enMora > 0 ? 'pd-rojo' : ''}" data-t="% en mora">${k.saldo > 0 ? Math.round(k.enMora / k.saldo * 100) : 0}%</td><td class="tl-num" data-t="Vencía">${fmt(k.esperado)}</td>
        <td class="tl-num" data-t="Cobrado">${fmt(k.cobrado)}</td><td class="tl-num" data-t="Mora cobrada">${fmt(k.mora)}</td><td class="tl-num" data-t="Efectividad">${k.esperado > 0 ? Math.round(k.cobradoCuotas / k.esperado * 100) + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="tl-muted">Sin datos.</td></tr>'}</tbody></table></div>
      <p class="tl-muted">Efectividad = de las cuotas que vencían en el período, cuánto ya está pagado.</p></div>
    <div class="pd-card"><h3>📅 Lo que viene</h3><div class="mf-montos"><div><span>Vencido sin pagar (hoy)</span><b class="pd-rojo">${fmt(vencidoHoy)}</b></div><div><span>Próximos 7 días</span><b>${fmt(r2(prox.reduce((a, x) => a + x.m, 0)))}</b></div><div><span>Próximos 30 días</span><b>${fmt(p30)}</b></div></div>
      <div class="pd-tw" style="margin-top:8px"><table class="tl-tabla"><tbody>${prox.map(x => `<tr><td data-t="Día">${x.f === hoy ? '<b>Hoy</b>' : fCorta(x.f)}</td><td class="tl-num" data-t="Cuotas">${x.n} cuota(s)</td><td class="tl-num" data-t="Monto">${fmt(x.m)}</td><td style="width:40%">${barra(x.m, Math.max(...prox.map(y => y.m)), false)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="pd-card"><h3>🚩 En riesgo</h3><p class="tl-muted">Más de 60 días de atraso o que prometieron pagar y no cumplieron.</p>
      ${riesgo.length ? `<div class="pd-tw"><table class="tl-tabla"><tbody>${riesgo.map(x => { const g = MF.promesas[x.cr.id]; return `<tr><td data-t="Cliente"><b>${esc(nombreCli(x.c))}</b><div class="tl-muted">${esc(x.cr.numero_credito)} · ${esc(nomCob(x.cr))}${x.c?.telefono ? ' · ' + esc(x.c.telefono) : ''}</div></td>
        <td class="tl-num pd-rojo" data-t="Días">${x.s.dias} días</td><td class="tl-num" data-t="Debe">${fmt(x.s.saldo)}</td><td data-t="Nota">${g && g.tipo === 'promesa' && g.fecha_promesa < hoy ? '🤝 No cumplió (' + fCorta(g.fecha_promesa) + ')' : ''}</td>
        <td class="tl-ac"><button class="btn-secondary" style="padding:5px 9px;font-size:12px" onclick="abrirTarjeta('${x.cr.cliente_id}')">📒</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="tl-muted">🎉 Nadie en riesgo.</p>'}</div>
    <div class="pd-card"><h3>🛒 Colocación en el período</h3><div class="mf-montos"><div><span>Ventas al crédito</span><b>${colV.length} · ${fmt(r2(colV.reduce((a, c) => a + Number(c.total_financiado || 0), 0)))}</b></div>
      <div><span>Préstamos en efectivo</span><b>${colP.length} · ${fmt(r2(colP.reduce((a, c) => a + Number(c.capital_financiado || 0), 0)))}</b></div>
      <div><span>Ya pagados (de esos)</span><b>${nuevos.filter(c => c.estado === 'cancelado').length}</b></div></div></div>`;
  MF.repTramos = porTramo;
}
function verTramo(k) {
  const x = MF.repTramos && MF.repTramos[k], el = document.getElementById('rep-tramo'); if (!x || !el) return;
  el.innerHTML = `<h4 style="margin:10px 0 4px">${esc((TRAMOS.find(t => t[0] === k) || [])[1])}</h4><div class="pd-tw"><table class="tl-tabla"><tbody>${x.lista.sort((a, b) => b.s.dias - a.s.dias).map(y => `<tr>
    <td data-t="Cliente"><b>${esc(nombreCli(y.c))}</b><div class="tl-muted">${esc(y.cr.numero_credito)}${y.cr.mf_cobrador_nombre ? ' · ' + esc(y.cr.mf_cobrador_nombre) : ''}</div></td><td class="tl-num" data-t="Días">${y.s.dias} días</td>
    <td class="tl-num" data-t="Atrasado">${fmt(y.s.atrasado)}</td><td class="tl-num" data-t="Saldo">${fmt(y.s.saldo)}</td><td class="tl-ac"><button class="btn-primary" style="padding:5px 9px;font-size:12px" onclick="abrirCobro('${y.cr.id}')">💵</button></td></tr>`).join('')}</tbody></table></div>`;
}
function descargarCartera() {
  const filas = MF.repCSV || []; if (filas.length < 2) { showToast('No hay cartera para descargar.', 'error'); return; }
  const csv = '﻿' + filas.map(f => f.map(c => { const t = String(c == null ? '' : c); return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `cartera_${hoyISO()}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- 🏘️ ZONAS (para ordenar la ruta) ---------- */
function limpiarZona(z) { return String(z || '').trim().replace(/\s+/g, ' ').slice(0, 60); }
function datalistZonas() { const zs = [...new Set(MF.clientes.map(zonaDe).filter(Boolean))].sort((a, b) => a.localeCompare(b)); return `<datalist id="mf-zonas-dl">${zs.map(z => `<option value="${esc(z)}">`).join('')}</datalist>`; }
async function guardarZona(clienteId) {
  if (MF.ocupado) return;
  const c = cliPorId(clienteId); if (!c) return;
  let z = limpiarZona(document.getElementById('tz-zona').value);
  const igual = MF.clientes.map(zonaDe).find(x => x && x.toLowerCase() === z.toLowerCase()); if (igual) z = igual;
  MF.ocupado = true; const b = document.getElementById('tz-ok'); b.disabled = true;
  try {
    const { error } = await sb.from('clientes').update({ zona: z || null }).eq('id', clienteId).eq('auth_user_id', MF.userId);
    if (error) throw error;
    c.zona = z || null; document.getElementById('tz-zona').value = z;
    showToast(z ? `Zona guardada: ${z}.` : 'Zona quitada.');
  } catch (e) { console.error(e); showToast('No se pudo guardar la zona. Revisa tu conexión.', 'error'); }
  finally { MF.ocupado = false; b.disabled = false; }
}

/* ---------- 👥 NIVEL 2: TRABAJO EN EQUIPO ----------
   Si está apagado, nada de esto aparece y el Panel funciona igual que siempre.
   Encendido: cada persona entra con SU PIN. La llave de sesión la da y la valida el SERVIDOR;
   esta pantalla solo la guarda mientras la pestaña está abierta. */
const ROL_TXT = { dueno: 'Dueño', supervisor: 'Supervisor', cobrador: 'Cobrador' };
function conEquipo() { return MF.cfg.mf_con_equipo === true; }
function tk() { return conEquipo() && MF.ses ? MF.ses.token : null; }
function esCobrador() { return conEquipo() && MF.ses?.rol === 'cobrador'; }
function puedeAdministrar() { return !conEquipo() || ['dueno', 'supervisor'].includes(MF.ses?.rol); }
function esDueno() { return !conEquipo() || MF.ses?.rol === 'dueno'; }
function tabPermitida(t) {
  if (t === 'caja') return conEquipo();
  if (t === 'cierre' || t === 'reportes') return puedeAdministrar();
  if (t === 'equipo') return esDueno();
  if (t === 'vender') return !esCobrador() || MF.ses?.puede_vender === true;
  return true;
}
function sesKey() { return 'n360_mf_ses_' + MF.userId; }
// Usuario elegido en el sistema multiusuario (arriba a la derecha). La sesión del Panel queda atada a él:
// si alguien cambia de usuario en el sistema, la sesión del Panel anterior se cierra sola.
function perfilSis() { try { const p = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); return p && p.id ? p : null; } catch (_) { return null; } }
function sesLeer() {
  MF.ses = null;
  try {
    const s = JSON.parse(sessionStorage.getItem(sesKey()) || 'null');
    if (s && s.token && new Date(s.expira) > new Date()) {
      if ((s.perfilSis || null) === (perfilSis()?.id || null)) MF.ses = s;
      else { sessionStorage.removeItem(sesKey()); sb.rpc('mf_sesion_cerrar', { p_token: s.token }).then(() => {}, () => {}); }
    }
  } catch (_) {}
}
function sesGuardar(s) { s.perfilSis = perfilSis()?.id || null; MF.ses = s; try { sessionStorage.setItem(sesKey(), JSON.stringify(s)); } catch (_) {} }
// Vigila el cambio de usuario del sistema mientras el Panel está abierto
let mfPerfilVisto;
async function vigilarPerfil() {
  const id = perfilSis()?.id || null;
  if (mfPerfilVisto === undefined) { mfPerfilVisto = id; return; }
  if (id === mfPerfilVisto) return;
  mfPerfilVisto = id; cerrarModal(true); MF.venta = null;
  sesLeer();
  if (conEquipo() && !MF.ses && !(await autoEntrar())) { pantallaEntrar(); return; }
  await cargarEquipo(); await recargar();
}
// Cobradores y supervisores entran solos con el usuario elegido en el sistema (sin otro PIN).
// El dueño/administrador entra con su PIN de administrador de siempre.
let mfAutoMotivo = '';
async function autoEntrar() {
  mfAutoMotivo = '';
  const ps = perfilSis(); if (!ps || ps.tipo === 'admin') return false;
  try {
    const { data, error } = await sb.rpc('mf_sesion_perfil', { p_perfil_id: ps.id });
    if (error || !data) { mfAutoMotivo = 'red'; return false; }
    if (!data.ok) { mfAutoMotivo = data.motivo || ''; return false; }
    sesGuardar({ token: data.token, rol: data.rol, nombre: data.nombre, perfil_id: data.perfil_id, puede_vender: data.puede_vender === true, expira: data.expira, auto: true });
    return true;
  } catch (_) { mfAutoMotivo = 'red'; return false; }
}
function sesBorrar() { MF.ses = null; try { sessionStorage.removeItem(sesKey()); } catch (_) {} }
async function cargarEquipo() {
  try {
    let { data, error } = await sb.rpc('listar_perfiles_del_grupo_v2');
    if (error) ({ data, error } = await sb.rpc('listar_perfiles_del_grupo'));
    MF.perfiles = (data || []).filter(p => p.activo !== false).map(p => ({ id: p.id, nombre: p.nombre, tipo: p.tipo, color: p.avatar_color, modulos: Array.isArray(p.modulos) ? p.modulos : [] }));
  } catch (_) { MF.perfiles = []; }
  try {
    const { data } = await sb.from('mf_equipo').select('perfil_id,rol,puede_vender,activo,pin_puesto').eq('auth_user_id', MF.userId);
    MF.equipo = (data || []).map(e => ({ ...e, nombre: (MF.perfiles.find(p => p.id === e.perfil_id) || {}).nombre || 'Usuario' }));
  } catch (_) { MF.equipo = []; }
}
async function releerCfg() {
  const { data } = await sb.from('configuracion_empresa').select('mf_con_equipo').eq('auth_user_id', MF.userId).maybeSingle();
  MF.cfg.mf_con_equipo = data?.mf_con_equipo === true;
}
function pintarBarraEquipo() {
  const tabs = document.querySelector('.pd-tabs[role=tablist]'); if (tabs) tabs.style.display = '';
  document.querySelectorAll('.pd-tab[data-tab]').forEach(b => { b.style.display = tabPermitida(b.dataset.tab) ? '' : 'none'; });
  const bar = document.getElementById('mf-barra-eq'); if (!bar) return;
  const ps = perfilSis();
  if (!conEquipo() && ps && ps.tipo !== 'admin') {
    bar.style.display = '';
    bar.innerHTML = `<span>⚠️ Estás como <b>${esc(ps.nombre || '')}</b>, pero el trabajo en equipo está apagado: el Panel no separa usuarios y todos pueden hacer todo. El dueño lo enciende en “Equipo y mora”.</span>`;
    return;
  }
  if (!conEquipo() || !MF.ses) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = '';
  bar.innerHTML = `<span>👤 <b>${esc(MF.ses.nombre)}</b> · ${ROL_TXT[MF.ses.rol] || ''}${esCobrador() ? ' · ves solo tu cartera' : ''}</span>
    ${MF.ses.auto ? '<span class="tl-muted" style="font-size:12px">Para cambiar de usuario usa el menú de usuarios del sistema.</span>' : '<button class="btn-secondary" style="padding:5px 10px;font-size:12.5px" onclick="salirPanel()">🔒 Salir</button>'}`;
}
function pantallaEntrar() {
  const tabs = document.querySelector('.pd-tabs[role=tablist]'); if (tabs) tabs.style.display = 'none';
  const bar = document.getElementById('mf-barra-eq'); if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  const v = document.getElementById('pd-vista');
  const enEq = new Set(MF.equipo.filter(e => e.activo).map(e => e.perfil_id));
  const lista = MF.perfiles.filter(p => p.tipo === 'admin' || enEq.has(p.id));
  const ps = perfilSis(), actual = ps?.id || null;
  if (ps && ps.tipo !== 'admin') {
    const txt = mfAutoMotivo === 'red' ? 'No se pudo conectar. Revisa tu señal y recarga la página.'
      : `Estás como <b>${esc(ps.nombre || 'otro usuario')}</b> y ese usuario no está en el equipo del Panel. Pídele al dueño que lo agregue en “Equipo y mora”, o cambia de usuario arriba.`;
    v.innerHTML = `<div class="pd-card mf-entrar"><h3>🔐 Panel Microfinanciera</h3><div class="tl-aviso">${txt}</div></div>`;
    return;
  }
  // Sin usuario elegido en el sistema, aquí solo entra un administrador (los demás eligen su usuario arriba).
  for (let i = lista.length - 1; i >= 0; i--) if (lista[i].tipo !== 'admin') lista.splice(i, 1);
  // Con un usuario elegido en el sistema, solo esa persona puede entrar aquí (no se elige a otro).
  if (ps) { const p = lista.find(x => x.id === actual); lista.length = 0; lista.push(p); }
  const sel = lista.find(p => p.id === actual) ? actual : '';
  v.innerHTML = `<div class="pd-card mf-entrar"><h3>🔐 ¿Quién eres?</h3>
      <p class="tl-muted">El trabajo en equipo está encendido. El dueño entra con su <b>PIN de administrador</b>. Cobradores y supervisores: elijan su usuario arriba (menú de usuarios del sistema) y entran solos.</p>
      ${lista.length ? `<div class="tl-f"><label for="mf-quien">Tu nombre</label><select class="tl-sel" id="mf-quien"><option value="">Elige tu nombre</option>
        ${lista.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}${p.tipo === 'admin' ? ' · Dueño' : ' · ' + (ROL_TXT[(MF.equipo.find(e => e.perfil_id === p.id) || {}).rol] || '')}</option>`).join('')}</select></div>
      <div class="tl-f"><label for="mf-pin">PIN de administrador</label><input class="tl-inp mf-monto-inp" id="mf-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="32" onkeydown="if(event.key==='Enter')entrarPanel()"></div>
      <div class="tl-aviso" id="mf-eerr" style="display:none"></div>
      <div class="pd-acciones"><button class="btn-primary mf-grande" id="mf-eok" onclick="entrarPanel()">Entrar</button></div>`
      : '<div class="tl-aviso">No hay administradores con PIN. Configura el PIN de administrador en el sistema.</div>'}</div>`;
  setTimeout(() => document.getElementById(sel ? 'mf-pin' : 'mf-quien')?.focus(), 60);
}
async function entrarPanel() {
  if (MF.ocupado) return;
  const id = document.getElementById('mf-quien').value, pin = document.getElementById('mf-pin').value.trim(), err = document.getElementById('mf-eerr');
  err.style.display = 'none';
  if (!id) { err.textContent = 'Elige tu nombre.'; err.style.display = ''; return; }
  if (pin.length < 4) { err.textContent = 'Escribe tu PIN (mínimo 4 dígitos).'; err.style.display = ''; return; }
  MF.ocupado = true; const b = document.getElementById('mf-eok'); b.disabled = true; b.textContent = 'Entrando…';
  const r = await rpc('mf_sesion_abrir', { p_perfil_id: id, p_pin: pin });
  MF.ocupado = false;
  if (!r.ok) { err.textContent = r.msg; err.style.display = ''; b.disabled = false; b.textContent = 'Entrar'; document.getElementById('mf-pin').value = ''; return; }
  sesGuardar({ token: r.token, rol: r.rol, nombre: r.nombre, perfil_id: r.perfil_id, puede_vender: r.puede_vender === true, expira: r.expira });
  MF.venta = null;
  document.getElementById('pd-vista').innerHTML = '<p class="tln-sub">Cargando…</p>';
  await cargarEquipo(); await recargar();
  showToast(`Hola, ${r.nombre}.`);
  if (colaPendientes().length) enviarCola();
}
async function salirPanel() {
  const t = tk(); sesBorrar(); MF.venta = null;
  if (t) { try { await sb.rpc('mf_sesion_cerrar', { p_token: t }); } catch (_) {} }
  pantallaEntrar();
}

/* ---------- 🧾 CAJA DEL DÍA (entregas de los cobradores) ---------- */
async function pintarCajaDia(v) {
  v.innerHTML = '<p class="tln-sub">Cargando la caja del día…</p>';
  const r = await rpc('mf_caja_pendiente', { p: { token: tk() } });
  if (!r.ok) { v.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  MF.pendiente = r.pendiente || [];
  let hist = [];
  try { let q = sb.from('mf_entregas').select('created_at,cobrador_id,cobrador_nombre,cobros,esperado,otros,entregado,diferencia,recibido_por,nota').eq('auth_user_id', MF.userId).order('created_at', { ascending: false }).limit(20);
    if (esCobrador()) q = q.eq('cobrador_id', MF.ses.perfil_id); hist = (await q).data || []; } catch (_) {}
  const yo = MF.ses?.perfil_id;
  const tarjetas = MF.pendiente.map(x => {
    const ef = r2(x.efectivo), ot = r2(x.otros), propia = x.cobrador_id === yo;
    const det = (x.detalle || []).map(d => `<tr><td data-t="Recibo">${esc(d.recibo || '—')}</td><td data-t="Hora">${new Date(d.hora).toLocaleString('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td><td data-t="Cómo">${esc(d.metodo || 'Efectivo')}</td><td class="tl-num" data-t="Monto">${fmt(d.monto)}</td></tr>`).join('');
    return `<div class="pd-card"><div class="mf-card-cab"><div><b class="mf-nom">${esc(x.nombre || 'Cobrador')}</b><div class="tl-muted">${x.cobros} cobro(s) sin entregar · desde ${fCorta(String(x.desde).slice(0, 10))}</div></div></div>
      <div class="mf-montos"><div><span>💵 Debe entregar en efectivo</span><b class="pd-verde">${fmt(ef)}</b></div><div><span>🏦 Otros (banco/tarjeta)</span><b>${fmt(ot)}</b></div></div>
      <details><summary class="tl-muted" style="cursor:pointer">Ver los cobros</summary><div class="pd-tw"><table class="tl-tabla"><tbody>${det}</tbody></table></div></details>
      ${esCobrador() ? '<div class="tl-aviso ok" style="margin-top:8px">Entrega este efectivo al dueño o supervisor. Él lo recibe aquí y el sistema cuadra.</div>'
        : propia ? '<div class="tl-aviso" style="margin-top:8px">Es tu propia entrega: la debe recibir otra persona (dueño u otro supervisor).</div>'
        : `<div class="tl-grid" style="margin-top:8px"><div class="tl-f"><label for="ent-${x.cobrador_id}">¿Cuánto efectivo entregó?</label><input class="tl-inp mf-monto-inp" id="ent-${x.cobrador_id}" type="number" inputmode="decimal" min="0" step="0.01" value="${ef}" oninput="previewEntrega('${x.cobrador_id}')"></div>
            <div class="tl-f"><label for="entn-${x.cobrador_id}">Nota (opcional)</label><input class="tl-inp" id="entn-${x.cobrador_id}" maxlength="300" placeholder="Ej. faltó porque…"></div></div>
          <div id="entp-${x.cobrador_id}"></div>
          <div class="pd-acciones"><button class="btn-primary mf-grande" id="entb-${x.cobrador_id}" onclick="recibirEntrega('${x.cobrador_id}')">✅ Recibir entrega</button></div>`}</div>`;
  }).join('');
  const sinEnviar = colaPendientes();
  v.innerHTML = `${sinEnviar.length ? `<div class="tl-aviso" style="margin-bottom:10px">⏳ Hay ${sinEnviar.length} cobro(s) guardados sin señal (${fmt(sinEnviar.reduce((a, c) => a + c.monto, 0))}) que todavía NO están aquí. Se suman cuando se envíen.</div>` : ''}${tarjetas || `<div class="pd-vacio"><div class="ico">✅</div><b>${esCobrador() ? 'No tienes cobros pendientes de entregar.' : 'Nadie tiene cobros pendientes de entregar.'}</b><p class="tl-muted">Aquí sale lo que cada cobrador ha cobrado y todavía no ha entregado.</p></div>`}
    <div class="pd-card"><h3>📜 Últimas entregas</h3>${hist.length ? `<div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Fecha</th><th>Cobrador</th><th class="tl-num">Debía</th><th class="tl-num">Entregó</th><th class="tl-num">Diferencia</th><th>Recibió</th></tr></thead><tbody>
      ${hist.map(h => `<tr><td data-t="Fecha">${new Date(h.created_at).toLocaleString('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td><td data-t="Cobrador">${esc(h.cobrador_nombre || '')}</td>
        <td class="tl-num" data-t="Debía">${fmt(h.esperado)}</td><td class="tl-num" data-t="Entregó">${fmt(h.entregado)}</td>
        <td class="tl-num ${Number(h.diferencia) < 0 ? 'pd-rojo' : Number(h.diferencia) > 0 ? 'pd-verde' : ''}" data-t="Diferencia">${Number(h.diferencia) === 0 ? '✅ Cuadró' : (Number(h.diferencia) < 0 ? 'Faltó ' : 'Sobró ') + fmt(Math.abs(h.diferencia))}</td>
        <td data-t="Recibió">${esc(h.recibido_por || '')}${h.nota ? '<div class="tl-muted">' + esc(h.nota) + '</div>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tl-muted">Todavía no hay entregas.</p>'}</div>`;
  MF.pendiente.forEach(x => previewEntrega(x.cobrador_id));
}
function previewEntrega(id) {
  const x = (MF.pendiente || []).find(p => p.cobrador_id === id), inp = document.getElementById('ent-' + id), el = document.getElementById('entp-' + id);
  if (!x || !inp || !el) return;
  const ent = r2(inp.value), dif = r2(ent - r2(x.efectivo)), b = document.getElementById('entb-' + id);
  if (!(inp.value !== '' && ent >= 0)) { el.innerHTML = '<div class="tl-aviso">Escribe cuánto entregó.</div>'; if (b) b.disabled = true; return; }
  if (b) b.disabled = false;
  el.innerHTML = dif === 0 ? '<div class="tl-aviso ok">✅ Cuadra exacto.</div>'
    : dif < 0 ? `<div class="tl-aviso">⚠️ Faltan <b>${fmt(-dif)}</b>. Al recibir, Caja baja ${fmt(-dif)} (queda anotado como faltante de ${esc(x.nombre)}).</div>`
    : `<div class="tl-aviso ok">Sobran <b>${fmt(dif)}</b>. Al recibir, Caja sube ${fmt(dif)} (queda anotado como sobrante).</div>`;
}
async function recibirEntrega(id) {
  if (MF.ocupado) return;
  const x = (MF.pendiente || []).find(p => p.cobrador_id === id); if (!x) return;
  const ent = r2(document.getElementById('ent-' + id).value), dif = r2(ent - r2(x.efectivo));
  if (!(ent >= 0)) return;
  if (!confirm(`¿Recibir ${fmt(ent)} en efectivo de ${x.nombre}?${dif !== 0 ? `\n${dif < 0 ? 'Faltante' : 'Sobrante'}: ${fmt(Math.abs(dif))} (se registra en Caja).` : '\nCuadra exacto.'}\nDespués de esto esos cobros ya no se pueden anular.`)) return;
  MF.ocupado = true; const b = document.getElementById('entb-' + id); b.disabled = true; b.textContent = 'Guardando…';
  const r = await rpc('mf_entrega_registrar', { p: { token: tk(), cobrador_id: id, entregado: ent, esperado_visto: r2(x.efectivo), nota: document.getElementById('entn-' + id).value.trim() } });
  MF.ocupado = false;
  if (!r.ok) { showToast(r.msg, 'error'); if (r.motivo === 'cambio' || r.motivo === 'nada') pintarCajaDia(document.getElementById('pd-vista')); else { b.disabled = false; b.textContent = '✅ Recibir entrega'; } return; }
  showToast(r.diferencia === 0 ? `Entrega de ${r.cobrador} recibida: cuadró.` : `Entrega recibida. ${r.diferencia < 0 ? 'Faltante' : 'Sobrante'} ${fmt(Math.abs(r.diferencia))} registrado en Caja.`);
  pintarCajaDia(document.getElementById('pd-vista'));
}

/* ---------- 👥 EQUIPO (solo el dueño) ---------- */
function pintarEquipo(v) {
  const on = conEquipo();
  const admins = MF.perfiles.filter(p => p.tipo === 'admin'), otros = MF.perfiles.filter(p => p.tipo !== 'admin');
  const fila = p => { const e = MF.equipo.find(x => x.perfil_id === p.id), rol = e && e.activo ? e.rol : '';
    return `<div class="mf-item" style="flex-wrap:wrap"><div class="mf-item-n"><b>${esc(p.nombre)}</b></div>
      <select class="tl-sel" style="max-width:170px" id="eq-rol-${p.id}" aria-label="Rol de ${esc(p.nombre)}"><option value="" ${!rol ? 'selected' : ''}>🚫 No entra</option><option value="cobrador" ${rol === 'cobrador' ? 'selected' : ''}>🛵 Cobrador</option><option value="supervisor" ${rol === 'supervisor' ? 'selected' : ''}>🧑‍💼 Supervisor</option></select>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="eq-ven-${p.id}" ${!e || e.puede_vender ? 'checked' : ''} style="width:17px;height:17px"> Puede vender</label>
      <button class="btn-secondary" style="padding:6px 10px;font-size:12.5px" onclick="guardarMiembro('${p.id}')">Guardar</button>
      ${rol ? (otrosModulos(p).length ? `<div class="tl-aviso" style="flex-basis:100%;margin:4px 0 0">⚠️ También entra a: ${esc(otrosModulos(p).map(nombreModulo).join(', '))}. Ahí podría ver lo de otros.
          <button class="btn-secondary" style="padding:5px 9px;font-size:12px;margin-left:6px" onclick="soloPanel('${p.id}')">🔒 Dejar solo el Panel</button></div>`
        : '<div class="tl-muted" style="flex-basis:100%">🔒 Solo entra al Panel</div>') : ''}</div>`; };
  const sinAsig = MF.creditos.filter(c => !c.mf_cobrador_id).length;
  const porCob = MF.equipo.filter(e => e.activo).map(e => { const cs = MF.creditos.filter(c => c.mf_cobrador_id === e.perfil_id); return { e, n: cs.length, saldo: r2(cs.reduce((a, c) => a + Number(c.saldo_pendiente || 0), 0)) }; });
  v.innerHTML = tarjetaPrestar() + tarjetaDiasCobro() + tarjetaMora() + tarjetaEfectivo() + `<div class="pd-card"><h3>👥 Trabajo en equipo: ${on ? '<span class="pd-pill ok">Encendido</span>' : '<span class="pd-pill">Apagado</span>'}</h3>
      <p class="tl-muted">${on ? 'Cada persona entra al Panel con su usuario del sistema. Los cobradores ven y cobran solo su cartera, no pueden anular, y al final del día entregan el efectivo en “Caja del día”.'
        : 'Enciéndelo si tienes cobradores o vendedores. Cada uno entrará con su usuario del sistema, cobrará solo su cartera y cada cobro quedará a su nombre. Mientras esté apagado, el Panel funciona como siempre.'}</p>
      <div class="pd-acciones"><button class="${on ? 'btn-secondary' : 'btn-primary'}" onclick="abrirEncender(${!on})">${on ? 'Apagar trabajo en equipo' : '✅ Encender trabajo en equipo'}</button></div>
      <p class="tl-muted" style="margin-top:6px">🔐 Encender o apagar pide el PIN de un administrador.</p></div>
    ${on ? `<div class="pd-card"><h3>Personas del equipo</h3>
      <p class="tl-muted">Los usuarios y sus PIN se crean en el menú de <b>usuarios / perfiles</b> del sistema. Aquí decides quién entra al Panel y qué hace.
        <b>Cobrador</b>: solo su cartera, no anula. <b>Supervisor</b>: ve todo, anula, asigna y recibe entregas. Los administradores entran como <b>Dueño</b>.</p>
      ${otros.length ? `<div class="mf-items">${otros.map(fila).join('')}</div>` : '<div class="tl-aviso">Todavía no hay usuarios (perfiles) que no sean administradores. Créalos primero en el menú de perfiles.</div>'}
      ${admins.length ? `<p class="tl-muted" style="margin-top:8px">Dueños: ${admins.map(a => esc(a.nombre)).join(', ')}</p>` : ''}</div>
    <div class="pd-card"><h3>🗂️ Cartera de cada cobrador</h3>
      <div class="mf-montos">${porCob.map(x => `<div><span>${esc(x.e.nombre)}</span><b>${x.n} crédito(s) · ${fmt(x.saldo)}</b></div>`).join('')}<div><span>Sin cobrador</span><b>${sinAsig} crédito(s)</b></div></div>
      ${MF.equipo.some(e => e.activo) && MF.creditos.length ? `<div class="tl-grid" style="margin-top:10px"><div class="tl-f"><label for="eq-filtro">Mostrar</label><select class="tl-sel" id="eq-filtro" onchange="pintarListaAsig()"><option value="sin">Sin cobrador</option><option value="todos">Todos</option></select></div>
        <div class="tl-f"><label for="eq-dest">Pasar los marcados a</label><select class="tl-sel" id="eq-dest"><option value="">Sin cobrador (dueño)</option>${MF.equipo.filter(e => e.activo).map(e => `<option value="${e.perfil_id}">${esc(e.nombre)}</option>`).join('')}</select></div></div>
        <div id="eq-lista"></div>
        <div class="pd-acciones"><button class="btn-primary" id="eq-asig" onclick="asignarSeleccion()">Asignar marcados</button></div>` : '<p class="tl-muted">Agrega primero cobradores al equipo para repartir la cartera.</p>'}</div>` : ''}`;
  if (on) pintarListaAsig();
  previewMoraCfg();
}
function pintarListaAsig() {
  const el = document.getElementById('eq-lista'); if (!el) return;
  const todos = document.getElementById('eq-filtro')?.value === 'todos';
  const l = MF.creditos.filter(c => todos || !c.mf_cobrador_id).map(c => ({ c, cli: cliPorId(c.cliente_id) })).sort((a, b) => nombreCli(a.cli).localeCompare(nombreCli(b.cli)));
  MF.selAsig = {};
  el.innerHTML = l.length ? `<label style="display:flex;gap:8px;align-items:center;margin:8px 0;font-weight:600"><input type="checkbox" onchange="document.querySelectorAll('.eq-chk').forEach(x=>{x.checked=this.checked})" style="width:17px;height:17px"> Marcar todos (${l.length})</label>
    <div class="mf-items" style="max-height:340px;overflow:auto">${l.map(x => `<label class="mf-item" style="cursor:pointer"><input type="checkbox" class="eq-chk" value="${x.c.id}" style="width:17px;height:17px">
      <div class="mf-item-n"><b>${esc(nombreCli(x.cli))}</b><div class="tl-muted">${esc(x.c.numero_credito)} · debe ${fmt(x.c.saldo_pendiente)}${x.c.mf_cobrador_nombre ? ' · 👤 ' + esc(x.c.mf_cobrador_nombre) : ''}${x.cli?.direccion ? ' · 📍 ' + esc(x.cli.direccion) : ''}</div></div></label>`).join('')}</div>`
    : '<p class="tl-muted">No hay créditos para mostrar.</p>';
}
async function asignarSeleccion() {
  if (MF.ocupado) return;
  const ids = [...document.querySelectorAll('.eq-chk:checked')].map(x => x.value);
  if (!ids.length) { showToast('Marca al menos un crédito.', 'error'); return; }
  const dest = document.getElementById('eq-dest').value, nom = dest ? (MF.equipo.find(e => e.perfil_id === dest) || {}).nombre : 'nadie (los cobra el dueño)';
  if (!confirm(`¿Pasar ${ids.length} crédito(s) a ${nom}? Solo cambia quién los cobra; no cambia lo que deben.`)) return;
  MF.ocupado = true; const b = document.getElementById('eq-asig'); b.disabled = true;
  const r = await rpc('mf_asignar', { p: { token: tk(), credito_ids: ids, cobrador_id: dest || null } });
  MF.ocupado = false; b.disabled = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast(`${r.asignados} crédito(s) asignados.`);
  await recargar();
}
async function asignarUno(creditoId, dest, clienteId) {
  if (MF.ocupado) return; MF.ocupado = true;
  const r = await rpc('mf_asignar', { p: { token: tk(), credito_ids: [creditoId], cobrador_id: dest || null } });
  MF.ocupado = false;
  if (!r.ok) { showToast(r.msg, 'error'); abrirTarjeta(clienteId); return; }
  showToast('Listo: cambió quién lo cobra.');
  await cargarDatos().catch(() => {});
}
function otrosModulos(p) { return (p.modulos || []).filter(k => k !== 'microfinanciera' && k !== 'chat'); }
function nombreModulo(k) { const m = Object.values(window.NEGOCIO360_MODULOS || {}).find(x => x.key === k); return m ? String(m.label || k).replace(/ · .*/, '') : k; }
async function soloPanel(perfilId, sinPreguntar) {
  const p = MF.perfiles.find(x => x.id === perfilId); if (!p || MF.ocupado) return;
  if (!sinPreguntar && !confirm(`¿Dejar a ${p.nombre} con acceso SOLO al Panel Microfinanciera? Ya no podrá abrir: ${otrosModulos(p).map(nombreModulo).join(', ')}.`)) return;
  MF.ocupado = true;
  const r = await rpc('mf_solo_panel', { p: { token: tk(), perfil_id: perfilId } });
  MF.ocupado = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  p.modulos = ['microfinanciera']; showToast(`${p.nombre} ahora solo entra al Panel.`);
  pintarEquipo(document.getElementById('pd-vista'));
}
async function guardarMiembro(perfilId) {
  if (MF.ocupado) return;
  const rol = document.getElementById('eq-rol-' + perfilId).value, vende = document.getElementById('eq-ven-' + perfilId).checked;
  const pin = (document.getElementById('eq-pin-' + perfilId)?.value || '').trim();
  if (pin && !/^[0-9]{4,8}$/.test(pin)) { showToast('El PIN debe tener de 4 a 8 números.', 'error'); return; }
  const e = MF.equipo.find(x => x.perfil_id === perfilId);
  if (!rol && !e) { showToast('Esa persona no está en el equipo.', 'error'); return; }
  if (!rol && e && MF.creditos.some(c => c.mf_cobrador_id === perfilId) && !confirm('Esta persona tiene créditos asignados. Si la sacas, no podrá cobrarlos hasta que los pases a otro. ¿Sacarla del equipo?')) return;
  MF.ocupado = true;
  const r = await rpc('mf_equipo_guardar', { p: { token: tk(), perfil_id: perfilId, rol: rol || (e ? e.rol : 'cobrador'), puede_vender: vende, activo: !!rol, pin: rol ? pin : '' } });
  MF.ocupado = false;
  if (!r.ok) { showToast(r.msg, 'error'); return; }
  showToast(rol ? 'Guardado. Entra eligiendo su usuario en el sistema.' : 'Ya no entra al Panel.');
  await cargarEquipo();
  const pf = MF.perfiles.find(x => x.id === perfilId);
  if (rol && !e && pf && otrosModulos(pf).length && confirm(`Recomendado: ¿dejar a ${pf.nombre} con acceso SOLO al Panel? Así no ve Caja, Créditos ni lo de otros cobradores.`)) { await soloPanel(perfilId, true); return; }
  pintarEquipo(document.getElementById('pd-vista'));
}
function abrirEncender(activar) {
  const admins = MF.perfiles.filter(p => p.tipo === 'admin');
  modal(`<div class="tl-modal-cab"><h2>${activar ? '✅ Encender' : 'Apagar'} trabajo en equipo</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
    <div class="tl-modal-cuerpo"><p class="tl-muted">${activar ? 'Desde ahora cada persona entrará al Panel con su usuario del sistema. Tú entrarás como Dueño.' : 'El Panel volverá a funcionar sin usuarios: cualquiera que lo abra podrá cobrar y anular. Las sesiones abiertas se cierran.'}</p>
      ${admins.length ? `<div class="tl-f"><label for="en-adm">Administrador</label><select class="tl-sel" id="en-adm">${admins.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></div>
      <div class="tl-f"><label for="en-pin">PIN del administrador</label><input class="tl-inp" id="en-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="32" onkeydown="if(event.key==='Enter')confirmarEncender(${activar})"></div>` : '<div class="tl-aviso">No hay administradores con PIN. Configura el PIN de administrador primero.</div>'}
      <div class="tl-aviso" id="en-err" style="display:none"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="cerrarModal()">Cancelar</button>${admins.length ? `<button class="btn-primary" id="en-ok" onclick="confirmarEncender(${activar})">${activar ? 'Encender' : 'Apagar'}</button>` : ''}</div>`);
  setTimeout(() => document.getElementById('en-pin')?.focus(), 60);
}
async function confirmarEncender(activar) {
  if (MF.ocupado) return;
  const adm = document.getElementById('en-adm').value, pin = document.getElementById('en-pin').value.trim(), err = document.getElementById('en-err');
  if (pin.length < 4) { err.textContent = 'Escribe el PIN.'; err.style.display = ''; return; }
  MF.ocupado = true; const b = document.getElementById('en-ok'); b.disabled = true;
  const r = await rpc('mf_equipo_config', { p_activo: !!activar, p_perfil_id: adm, p_pin: pin });
  MF.ocupado = false;
  if (!r.ok) { err.textContent = r.msg; err.style.display = ''; b.disabled = false; document.getElementById('en-pin').value = ''; return; }
  cerrarModal(true);
  await releerCfg();
  if (activar) {
    // El administrador que lo encendió entra de una vez como Dueño (con su mismo PIN, validado por el servidor)
    const s = await rpc('mf_sesion_abrir', { p_perfil_id: adm, p_pin: pin });
    if (s.ok) sesGuardar({ token: s.token, rol: s.rol, nombre: s.nombre, perfil_id: s.perfil_id, puede_vender: true, expira: s.expira });
    showToast('Trabajo en equipo encendido. Agrega a tus cobradores.');
    if (!MF.ses) return pantallaEntrar();
    await recargar(); mfTab('equipo');
  } else { sesBorrar(); showToast('Trabajo en equipo apagado.'); await recargar(); mfTab('equipo'); }
}

/* ---------- 📡 COBRAR SIN SEÑAL ----------
   Si no hay señal al cobrar, el cobro se guarda en ESTE teléfono (con su referencia única) y se
   envía solo cuando vuelve la señal. El servidor reconoce la referencia: aunque se envíe dos
   veces, se registra UNA sola vez. Nada se borra sin confirmación: si el servidor rechaza un
   cobro guardado (ej. ya lo pagó en otro lado), queda marcado para que el dueño lo revise. */
function colaKey() { return 'n360_mf_cola_' + MF.userId; }
function colaLeer() { try { const c = JSON.parse(localStorage.getItem(colaKey()) || '[]'); MF.cola = Array.isArray(c) ? c : []; } catch (_) { MF.cola = []; } }
function colaGuardar() { try { localStorage.setItem(colaKey(), JSON.stringify(MF.cola)); return true; } catch (_) { return false; } }
function colaPendientes() { return (MF.cola || []).filter(c => c.estado === 'pendiente'); }
function colaMonto(creditoId) { return r2(colaPendientes().filter(c => c.credito_id === creditoId).reduce((a, c) => a + Number(c.monto || 0), 0)); }
function colaAgregar(item) {
  if (MF.cola.length >= 300) return false;
  MF.cola.push(item);
  if (!colaGuardar()) { MF.cola.pop(); return false; }
  // Comprobación: se vuelve a leer lo guardado para estar seguros de que quedó en el teléfono
  try { const c = JSON.parse(localStorage.getItem(colaKey()) || '[]'); if (!c.some(x => x.ref === item.ref)) { MF.cola.pop(); return false; } } catch (_) { MF.cola.pop(); return false; }
  return true;
}
function mostrarGuardadoSinSenal(item, cr) {
  const s = situacion(cr), neg = MF.cfg.nombre_comercial || 'Mi negocio';
  const txt = `🧾 Comprobante provisional — ${neg}\nCliente: ${item.cliente}\nCrédito: ${item.numero_credito}\nFecha: ${new Date(item.hora).toLocaleString('es-NI')}\nPagó: ${fmt(item.monto)} (${item.metodo_pago_nombre})${item.mora > 0 ? '\nMora: ' + fmt(item.mora) : ''}\nAhora debe: ${fmt(s.saldo)}${item.cobrador ? '\nCobró: ' + item.cobrador : ''}\nCódigo: ${item.ref.slice(0, 8).toUpperCase()}\n(El recibo oficial llega al volver la señal.)`;
  MF.ultimoRecibo = { txt, r: { recibo: 'Provisional ' + item.ref.slice(0, 8).toUpperCase() } };
  modal(`<div class="tl-modal-cab"><h2>📡 Guardado sin señal</h2><button class="tl-x" onclick="cerrarModal(true);mfTab(MF.tab)" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo"><div class="mf-recibo">
      <div class="mf-recibo-num">Código ${esc(item.ref.slice(0, 8).toUpperCase())} <span class="pd-pill ambar">pendiente de enviar</span></div>
      <div class="mf-recibo-monto">${fmt(r2(item.monto + (item.mora || 0)))}</div>${item.mora > 0 ? `<div class="tl-muted">${fmt(item.monto)} + ${fmt(item.mora)} de mora</div>` : ''}<div>${esc(item.cliente)} · ${esc(item.metodo_pago_nombre)}</div>
      <div class="mf-montos" style="margin-top:10px"><div><span>Ahora debe</span><b>${fmt(s.saldo)}</b></div></div></div>
      <div class="tl-aviso ok" style="margin-top:10px">El cobro quedó guardado en este teléfono. Se envía solo cuando vuelva la señal y ahí sale el recibo oficial.
        <b>No cierres sesión ni borres los datos del navegador</b> hasta que se envíe.</div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="imprimirRecibo()">🖨️ Comprobante provisional</button><button class="btn-primary" onclick="cerrarModal(true);mfTab(MF.tab)">Listo</button></div>`);
  pintarBarraCola();
}
function pintarBarraCola() {
  const el = document.getElementById('mf-cola'); if (!el) return;
  const pend = colaPendientes(), rech = (MF.cola || []).filter(c => c.estado === 'rechazado'), sinRed = navigator.onLine === false;
  if (!pend.length && !rech.length && !sinRed) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const ajenos = conEquipo() ? pend.filter(c => c.perfil_id && c.perfil_id !== MF.ses?.perfil_id) : [];
  el.style.display = '';
  el.innerHTML = `<div>${sinRed ? '📡 <b>Sin señal.</b> Puedes seguir cobrando: los cobros se guardan en este teléfono. ' : ''}
      ${pend.length ? `⏳ <b>${pend.length} cobro(s) sin enviar</b> (${fmt(pend.reduce((a, c) => a + c.monto, 0))}).${sinRed ? '' : ' Se están enviando…'}` : ''}
      ${ajenos.length ? `<div class="tl-muted">${ajenos.length} son de ${esc([...new Set(ajenos.map(a => a.cobrador || 'otra persona'))].join(', '))}: se envían cuando esa persona entre al Panel con su usuario.</div>` : ''}
      ${rech.length ? `<div style="color:var(--danger,#dc2626)">⚠️ <b>${rech.length} cobro(s) guardado(s) no se pudieron registrar.</b> Revísalos.</div>` : ''}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${pend.length && !sinRed ? `<button class="btn-secondary" style="padding:5px 10px;font-size:12.5px" onclick="enviarCola(true)" ${MF.enviando ? 'disabled' : ''}>📤 Enviar ahora</button>` : ''}
      ${pend.length || rech.length ? `<button class="btn-secondary" style="padding:5px 10px;font-size:12.5px" onclick="verCola()">Ver</button>` : ''}</div>`;
}
async function enviarCola(manual) {
  if (MF.enviando) return;
  const pend = colaPendientes(); if (!pend.length) { pintarBarraCola(); return; }
  if (navigator.onLine === false) { if (manual) showToast('Todavía no hay señal.', 'error'); pintarBarraCola(); return; }
  MF.enviando = true; pintarBarraCola();
  let enviados = 0, rechazados = 0, saltados = 0, sinRed = false;
  try {
    for (const it of pend) {
      // Con equipo: cada cobro se envía con la llave de QUIEN lo cobró (si es otra persona, espera a que ella entre)
      if (conEquipo() && (!MF.ses || (it.perfil_id && it.perfil_id !== MF.ses.perfil_id))) { saltados++; continue; }
      const r = await rpc('mf_cobrar', { p: { credito_id: it.credito_id, monto: it.monto, metodo_pago_id: it.metodo_pago_id, metodo_pago_nombre: it.metodo_pago_nombre,
        banco_id: it.banco_id, nota: [it.nota, 'cobrado sin señal ' + new Date(it.hora).toLocaleString('es-NI')].filter(Boolean).join(' · ').slice(0, 300), ref: it.ref, creado_por: it.creado_por, token: tk(),
        ...(it.mora != null ? { mora: it.mora } : {}) } });
      const x = MF.cola.find(c => c.ref === it.ref); if (!x) continue;
      if (r.ok) { MF.cola = MF.cola.filter(c => c.ref !== it.ref); enviados++; }
      else if (r.red) { sinRed = true; break; }
      else if (r.motivo === 'sesion') { break; }
      else { x.estado = 'rechazado'; x.msg = r.msg; x.revisado = new Date().toISOString(); rechazados++; }
      colaGuardar();
    }
  } finally { MF.enviando = false; }
  colaGuardar();
  if (enviados) { showToast(`📤 Se enviaron ${enviados} cobro(s) guardados sin señal.`); await cargarDatos().catch(() => {}); if (!document.getElementById('pd-modal').classList.contains('abierto')) mfTab(MF.tab); }
  if (rechazados) showToast(`⚠️ ${rechazados} cobro(s) guardado(s) no se pudieron registrar. Toca "Ver".`, 'error');
  if (manual && !enviados && !rechazados) showToast(sinRed ? 'Todavía no hay señal.' : saltados ? 'Los cobros pendientes son de otra persona: se envían cuando ella entre al Panel con su usuario.' : 'Nada que enviar.', sinRed || saltados ? 'error' : 'success');
  pintarBarraCola();
}
function verCola() {
  const l = MF.cola || [];
  modal(`<div class="tl-modal-cab"><h2>📡 Cobros guardados en este teléfono</h2><button class="tl-x" onclick="cerrarModal()">✕</button></div>
    <div class="tl-modal-cuerpo">${l.length ? `<div class="pd-tw"><table class="tl-tabla"><tbody>${l.map(c => `<tr>
      <td data-t="Cliente"><b>${esc(c.cliente)}</b><div class="tl-muted">${esc(c.numero_credito)} · ${new Date(c.hora).toLocaleString('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${c.cobrador ? ' · ' + esc(c.cobrador) : ''} · código ${esc(c.ref.slice(0, 8).toUpperCase())}</div>
        ${c.estado === 'rechazado' ? `<div style="color:var(--danger,#dc2626);font-size:12.5px">No se registró: ${esc(c.msg || '')}<br>El dinero lo tiene quien cobró: regístralo en Créditos o devuélveselo al cliente, y luego quítalo de aquí.</div>` : ''}</td>
      <td class="tl-num" data-t="Monto">${fmt(c.monto)}</td><td data-t="Estado">${c.estado === 'pendiente' ? '<span class="pd-pill ambar">Sin enviar</span>' : '<span class="pd-pill mal">No se registró</span>'}</td>
      <td class="tl-ac">${c.estado === 'rechazado' && puedeAdministrar() ? `<button class="btn-secondary" style="padding:5px 9px;font-size:12px" onclick="quitarDeCola('${c.ref}')">Ya lo resolví</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="tl-muted">No hay cobros guardados.</p>'}
      <p class="tl-muted" style="margin-top:8px">Los cobros “sin enviar” no se pueden borrar: se envían solos. El servidor no deja que un cobro se registre dos veces.</p></div>
    <div class="tl-modal-pie"><button class="btn-primary" onclick="cerrarModal()">Cerrar</button></div>`);
}
function quitarDeCola(refId) {
  const c = (MF.cola || []).find(x => x.ref === refId); if (!c || c.estado !== 'rechazado' || !puedeAdministrar()) return;
  if (!confirm(`¿Ya resolviste el cobro de ${fmt(c.monto)} de ${c.cliente}? Se quita de este teléfono (no cambia nada en Caja ni en Créditos).`)) return;
  MF.cola = MF.cola.filter(x => x.ref !== refId); colaGuardar(); verCola(); pintarBarraCola();
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
    sesLeer(); colaLeer(); leerPrefRuta(); vigilarPerfil();
    setInterval(vigilarPerfil, 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) vigilarPerfil(); });
    window.addEventListener('online', () => { pintarBarraCola(); enviarCola(); });
    window.addEventListener('offline', pintarBarraCola);
    setInterval(() => { if (colaPendientes().length) enviarCola(); }, 30000);
    await cargarEquipo();
    if (conEquipo() && !MF.ses && !(await autoEntrar())) { pantallaEntrar(); return; }
    await cargarDatos();
    const ini = (location.hash || '').replace('#', '');
    await mfTab(['ruta', 'vender', 'clientes', 'resumen', 'caja', 'cierre', 'reportes', 'equipo'].includes(ini) ? ini : 'ruta');
    if (colaPendientes().length) enviarCola();
  } catch (e) {
    console.error('mfInit:', e);
    document.getElementById('loader').classList.add('hidden'); document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando el panel. Revisa tu conexión.', 'error');
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', mfInit);
