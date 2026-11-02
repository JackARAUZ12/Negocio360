/* ============================================================
   VENDEDORES.JS — NEGOCIO360 · Lista de vendedores y reporte por vendedor
   CANDADOS: esta pantalla no escribe en ninguna tabla. Todo pasa por funciones del
   servidor (vendedor_guardar, vendedores_opciones, reporte_vendedores) que validan
   todo. Los vendedores no se borran: se desactivan (el historial queda intacto).
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const VD = { userId: null, cfg: {}, tab: 'reporte', lista: [], rango: 'mes', desde: null, hasta: null, filas: [], ocupado: false, editId: null };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sym() { const m = VD.cfg?.moneda; if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} } return m === 'USD' ? '$' : 'C$'; }
function fmt(v) {
  let x = Number(v || 0);
  if (typeof convertirParaMostrar === 'function') { try { x = convertirParaMostrar(x, VD.cfg?.moneda); } catch (_) {} }
  return sym() + ' ' + x.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(v) { return Number(v || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fechaCorta(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short', year: 'numeric' }); }

/* tema / menú */
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
function showToast(msg, type = 'success') { const el = document.getElementById('toast'); if (!el) return; el.textContent = msg; el.className = `toast toast-${type} show`; clearTimeout(_tt); _tt = setTimeout(() => el.classList.remove('show'), 3800); }

const MOTIVOS = { desactivado: 'Vendedores está apagado. Actívalo en Configuración.', nombre: 'Escribe el nombre (de 2 a 80 letras).',
  nombre_duplicado: 'Ya tienes un vendedor con ese nombre.', no_existe: 'No se encontró. Recarga la pantalla.', datos: 'Datos no válidos. Recarga la pantalla.', fechas: 'Revisa las fechas (máximo 400 días).' };
async function vdRpc(n, a) {
  try {
    const { data, error } = await sb.rpc(n, a);
    if (error) { console.warn(n, error); return { ok: false, msg: 'No se pudo completar. Revisa tu conexión e intenta de nuevo.' }; }
    if (!data || data.ok !== true) return { ...(data || {}), ok: false, msg: MOTIVOS[data && data.motivo] || 'No se pudo completar.' };
    return data;
  } catch (e) { return { ok: false, msg: 'No se pudo completar. Revisa tu conexión.' }; }
}
function vdModal(html) { document.getElementById('pd-modal-box').innerHTML = html; document.getElementById('pd-modal').classList.add('abierto'); }
function vdCerrarModal() { if (VD.ocupado) return; document.getElementById('pd-modal').classList.remove('abierto'); }
function pdCerrarModal() { vdCerrarModal(); }

async function vdTab(t) {
  VD.tab = t;
  document.querySelectorAll('.pd-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === t));
  try { history.replaceState(null, '', '#' + t); } catch (_) {}
  if (t === 'lista') return vdLista();
  return vdReporte();
}

/* ---------- REPORTE ---------- */
function vdRango(r) {
  const h = new Date(); let d = new Date(h), a = new Date(h);
  if (r === 'hoy') {}
  else if (r === 'semana') { const dw = (h.getDay() + 6) % 7; d.setDate(h.getDate() - dw); }
  else if (r === 'mes') { d = new Date(h.getFullYear(), h.getMonth(), 1); }
  else if (r === 'mes_pasado') { d = new Date(h.getFullYear(), h.getMonth() - 1, 1); a = new Date(h.getFullYear(), h.getMonth(), 0); }
  else if (r === 'anio') { d = new Date(h.getFullYear(), 0, 1); }
  VD.rango = r; VD.desde = ymd(d); VD.hasta = ymd(a);
}
async function vdReporte() {
  const v = document.getElementById('pd-vista');
  if (!VD.desde) vdRango('mes');
  const chip = (k, t) => `<button type="button" class="pd-tab${VD.rango === k ? ' activa' : ''}" style="padding:6px 12px;font-size:12.5px" onclick="vdRango('${k}');vdReporte()">${t}</button>`;
  v.innerHTML = `<div class="pd-card">
    <div class="vd-filtros">${chip('hoy', 'Hoy')}${chip('semana', 'Esta semana')}${chip('mes', 'Este mes')}${chip('mes_pasado', 'Mes pasado')}${chip('anio', 'Este año')}
      <span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"><input type="date" id="vd-desde" value="${VD.desde}" aria-label="Desde"> a <input type="date" id="vd-hasta" value="${VD.hasta}" aria-label="Hasta">
      <button type="button" class="btn-secondary tln-btn-sm" onclick="vdPersonalizado()">Ver</button></span></div>
    <div id="vd-rep"><p class="tln-sub">Cargando…</p></div></div>`;
  const r = await vdRpc('reporte_vendedores', { p_desde: VD.desde, p_hasta: VD.hasta });
  const c = document.getElementById('vd-rep');
  if (!r.ok) { c.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  VD.filas = r.filas || [];
  if (!VD.filas.length) { c.innerHTML = `<div class="pd-vacio"><div class="ico">📭</div><p>No hay ventas entre el ${esc(fechaCorta(VD.desde))} y el ${esc(fechaCorta(VD.hasta))}.</p></div>`; return; }
  const tot = VD.filas.reduce((s, f) => s + Number(f.total || 0), 0), gan = VD.filas.reduce((s, f) => s + Number(f.ganancia || 0), 0);
  const nv = VD.filas.reduce((s, f) => s + Number(f.ventas || 0), 0), sinV = VD.filas.find(f => !f.vendedor_id);
  const pctCon = tot > 0 ? Math.round((tot - Number(sinV?.total || 0)) / tot * 100) : 0;
  c.innerHTML = `
    <div class="pd-kpis">
      <div class="pd-kpi"><div class="pd-kpi-l">💰 Vendido</div><div class="pd-kpi-v">${fmt(tot)}</div><div class="pd-kpi-s">${num(nv)} ventas</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">📈 Ganancia</div><div class="pd-kpi-v">${fmt(gan)}</div><div class="pd-kpi-s">venta sin IVA − costo</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">🧑‍💼 Con vendedor</div><div class="pd-kpi-v">${pctCon}%</div><div class="pd-kpi-s">de lo vendido tiene vendedor</div></div>
    </div>
    <div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Vendedor</th><th class="tl-num">Ventas</th><th class="tl-num">Vendido</th><th>Del total</th><th class="tl-num">Ganancia</th><th class="tl-num">Ticket promedio</th><th class="tl-num">Descuentos</th><th class="tl-num">Devuelto</th></tr></thead><tbody>
    ${VD.filas.map(f => { const p = tot > 0 ? Math.round(Number(f.total) / tot * 100) : 0; return `<tr>
      <td data-t="Vendedor"><b>${f.vendedor_id ? esc(f.nombre) : '<span style="color:var(--text-muted)">Sin vendedor</span>'}</b>${f.vendedor_id && f.activo === false ? ' <span class="pd-pill">inactivo</span>' : ''}${Number(f.a_credito) ? `<div class="tln-sub">${num(f.a_credito)} a crédito</div>` : ''}</td>
      <td data-t="Ventas" class="tl-num">${num(f.ventas)}</td>
      <td data-t="Vendido" class="tl-num"><b>${fmt(f.total)}</b></td>
      <td data-t="Del total"><div style="display:flex;align-items:center;gap:6px"><div class="vd-barra" style="flex:1"><i style="width:${p}%"></i></div><span class="tln-sub">${p}%</span></div></td>
      <td data-t="Ganancia" class="tl-num">${fmt(f.ganancia)}</td>
      <td data-t="Ticket promedio" class="tl-num">${fmt(f.ticket)}</td>
      <td data-t="Descuentos" class="tl-num">${Number(f.descuentos) ? fmt(f.descuentos) : '—'}</td>
      <td data-t="Devuelto" class="tl-num">${Number(f.devuelto) ? `<span class="pd-rojo">${fmt(f.devuelto)}</span>` : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="pd-acciones"><button class="btn-secondary" onclick="vdCsv()">⬇ Descargar (Excel)</button>
      <span class="tln-sub">Ventas completadas del ${esc(fechaCorta(VD.desde))} al ${esc(fechaCorta(VD.hasta))}. Las anuladas no cuentan.</span></div>`;
}
function vdPersonalizado() {
  const d = document.getElementById('vd-desde').value, a = document.getElementById('vd-hasta').value;
  if (!d || !a || d > a) { showToast('Revisa las fechas.', 'error'); return; }
  VD.rango = 'custom'; VD.desde = d; VD.hasta = a; vdReporte();
}
function vdCsv() {
  const enc = ['Vendedor', 'Ventas', 'Vendido', 'Sin IVA', 'Ganancia', 'Ticket promedio', 'Descuentos', 'A crédito', 'Devuelto'];
  const filas = VD.filas.map(f => [f.vendedor_id ? f.nombre : 'Sin vendedor', f.ventas, f.total, f.sin_iva, f.ganancia, f.ticket, f.descuentos, f.a_credito, f.devuelto]);
  const csv = '﻿' + [enc, ...filas].map(r => r.map(x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `vendedores_${VD.desde}_${VD.hasta}.csv`; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- LISTA DE VENDEDORES ---------- */
async function vdLista() {
  const v = document.getElementById('pd-vista');
  v.innerHTML = '<p class="tln-sub">Cargando…</p>';
  const { data, error } = await sb.from('vendedores').select('id,nombre,telefono,activo').eq('auth_user_id', VD.userId).order('activo', { ascending: false }).order('nombre');
  if (error) { v.innerHTML = '<div class="tl-aviso">No se pudo cargar. Recarga la pantalla.</div>'; return; }
  VD.lista = data || [];
  v.innerHTML = `<div class="pd-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div><h3>Tus vendedores</h3><div class="pd-ayuda" style="margin:0">No necesitan usuario. Al vender se elige en <b>“¿Quién vendió?”</b>. No se borran: se desactivan y su historial queda.</div></div>
        <button class="btn-primary" onclick="vdEditar(null)">➕ Nuevo vendedor</button>
      </div>
      ${VD.lista.length ? `<div class="pd-tw" style="margin-top:12px"><table class="tl-tabla"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Estado</th><th></th></tr></thead><tbody>
        ${VD.lista.map(x => `<tr><td data-t="Nombre"><b>${esc(x.nombre)}</b></td><td data-t="Teléfono">${esc(x.telefono || '—')}</td>
          <td data-t="Estado">${x.activo ? '<span class="pd-pill ok">Activo</span>' : '<span class="pd-pill">Inactivo</span>'}</td>
          <td class="tl-num" style="white-space:nowrap"><button class="btn-secondary tln-btn-sm" onclick="vdEditar('${x.id}')">Editar</button>
            <button class="btn-secondary tln-btn-sm" onclick="vdActivar('${x.id}', ${!x.activo})">${x.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="pd-vacio"><div class="ico">🧑‍💼</div><p>Aún no tienes vendedores. Agrega el primero.</p></div>'}
    </div>
    <div class="pd-card"><h3>Opciones</h3>
      <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:14px">
        <input type="checkbox" id="vd-oblig" ${VD.cfg.vendedor_obligatorio ? 'checked' : ''} onchange="vdObligatorio(this.checked)" style="margin-top:3px;width:18px;height:18px">
        <span><b>Pedir el vendedor en cada venta</b><br><span class="tln-sub">En Ventas no se podrá confirmar sin elegir quién vendió. (Las ventas que nacen de otros módulos, como Créditos o Proformas, no se bloquean.)</span></span>
      </label></div>`;
}
function vdEditar(id) {
  const x = id ? VD.lista.find(v => v.id === id) : null; VD.editId = id;
  vdModal(`<div class="tl-modal-cab"><h2>${x ? 'Editar vendedor' : '➕ Nuevo vendedor'}</h2><button type="button" class="tl-x" onclick="vdCerrarModal()" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo">
      <div class="tl-f"><label for="vd-nom" style="font-size:13px;font-weight:700">Nombre *</label><input class="tl-inp" id="vd-nom" maxlength="80" autocomplete="off" value="${x ? esc(x.nombre) : ''}" placeholder="Ej: María López"></div>
      <div class="tl-f"><label for="vd-tel" style="font-size:13px;font-weight:700">Teléfono (opcional)</label><input class="tl-inp" id="vd-tel" type="tel" inputmode="tel" maxlength="30" autocomplete="off" value="${x ? esc(x.telefono || '') : ''}"></div>
      ${x ? '<div class="pd-ayuda" style="margin:0">Si cambias el nombre, también cambia en sus ventas anteriores (solo el nombre; nada de montos).</div>' : ''}
      <div id="vd-err"></div></div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="vdCerrarModal()">Cancelar</button><button class="btn-primary" id="vd-ok" onclick="vdGuardar()">Guardar</button></div>`);
  setTimeout(() => document.getElementById('vd-nom')?.focus(), 50);
}
async function vdGuardar() {
  if (VD.ocupado) return;
  const nombre = document.getElementById('vd-nom').value.trim(), telefono = document.getElementById('vd-tel').value.trim();
  const err = document.getElementById('vd-err');
  if (nombre.length < 2) { err.innerHTML = '<div class="tl-aviso">Escribe el nombre del vendedor.</div>'; return; }
  const x = VD.editId ? VD.lista.find(v => v.id === VD.editId) : null;
  VD.ocupado = true; const b = document.getElementById('vd-ok'); if (b) b.disabled = true;
  try {
    const r = await vdRpc('vendedor_guardar', { p: { id: VD.editId, nombre, telefono, activo: x ? x.activo : true } });
    if (!r.ok) { err.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
    VD.ocupado = false; vdCerrarModal(); showToast('✅ Vendedor guardado'); vdLista();
  } finally { VD.ocupado = false; if (b) b.disabled = false; }
}
async function vdActivar(id, activo) {
  if (VD.ocupado) return;
  const x = VD.lista.find(v => v.id === id); if (!x) return;
  VD.ocupado = true;
  try {
    const r = await vdRpc('vendedor_guardar', { p: { id, nombre: x.nombre, telefono: x.telefono, activo } });
    if (!r.ok) { showToast(r.msg, 'error'); return; }
    showToast(activo ? 'Vendedor activado' : 'Vendedor desactivado (sus ventas anteriores no cambian)');
  } finally { VD.ocupado = false; vdLista(); }
}
async function vdObligatorio(v) {
  const r = await vdRpc('vendedores_opciones', { p_obligatorio: v });
  if (!r.ok) { showToast(r.msg, 'error'); const c = document.getElementById('vd-oblig'); if (c) c.checked = !v; return; }
  VD.cfg.vendedor_obligatorio = v;
  showToast(v ? 'Ahora en Ventas se pedirá el vendedor.' : 'El vendedor vuelve a ser opcional.');
}

/* ---------- arranque ---------- */
async function vdInit() {
  applyTheme((() => { try { return localStorage.getItem('n360_theme') || 'light'; } catch (_) { return 'light'; } })());
  const f = document.getElementById('header-fecha'); if (f) f.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user; VD.userId = user.id;
    const { data: cfg } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', user.id).maybeSingle();
    VD.cfg = cfg || {};
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
    if (VD.cfg.usa_vendedores !== true) {
      document.getElementById('content').innerHTML = `<div class="tl-apagado"><div style="font-size:42px">🧑‍💼</div><h2>Vendedores está apagado</h2>
        <p>Actívalo en <b>Configuración → Vendedores</b> para elegir quién vendió en cada venta y ver el reporte por vendedor.</p>
        <button class="btn-primary" onclick="navigate('configuracion.html')">Ir a Configuración</button></div>`;
      return;
    }
    const ini = (location.hash || '').replace('#', '');
    await vdTab(ini === 'lista' ? 'lista' : 'reporte');
  } catch (e) {
    console.error('vdInit:', e);
    document.getElementById('loader').classList.add('hidden'); document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando Vendedores.', 'error');
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') vdCerrarModal(); });
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', vdInit);
