/* ============================================================
   PANADERIA.JS — NEGOCIO360 · Panel de Panadería (Fase 1)
   Hoy · Plan de horneado · Cierre del día · Vitrina por día.
   CANDADOS:
   * Esta pantalla NO escribe en ninguna tabla: todo cambio pasa por funciones del servidor
     (panaderia_hornear, panaderia_cerrar_dia, panaderia_vitrina_guardar) que validan todo.
   * Hornear reutiliza Producción (todo o nada; nunca stock negativo; no toca Caja).
   * Cada "Hornear" lleva una clave única: aunque se toque dos veces o se corte el internet
     y se reintente, el servidor no produce dos veces.
   * El cierre del día es uno por fecha.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const PD = { userId: null, empresaConfig: {}, nombre: 'Usuario', tab: 'hoy', plan: null, ocupado: false, horno: {}, cierre: {}, vitrina: {} };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function n2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function n3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }
function num(v) { return Number(v || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }
function sym() {
  const m = PD.empresaConfig?.moneda;
  if (typeof monedaParaMostrar === 'function') { try { return monedaParaMostrar(m); } catch (_) {} }
  return m === 'USD' ? '$' : 'C$';
}
function fmt(v) {
  let x = Number(v || 0);
  if (typeof convertirParaMostrar === 'function') { try { x = convertirParaMostrar(x, PD.empresaConfig?.moneda); } catch (_) {} }
  return sym() + ' ' + x.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fechaLarga(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString('es-NI', { weekday: 'long', day: 'numeric', month: 'long' });
}
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
}
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MOTIVOS = { no_vendido: 'No se vendió (se bota)', danado: 'Dañado / quemado', vencido: 'Vencido', donacion: 'Donación', consumo_personal: 'Consumo del personal' };

/* ---------- tema / menú (igual que los demás módulos) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('n360_theme', t); } catch (_) {}
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = t === 'dark' ? 'block' : 'none';
  if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
let sidebarCollapsed = false;
function isMobileView() { return window.innerWidth <= 768; }
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar'); if (!sidebar) return;
  if (isMobileView()) {
    const open = sidebar.classList.toggle('mobile-open');
    const ov = document.getElementById('sidebar-overlay'); if (ov) ov.classList.toggle('active', open);
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('main').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }
}
function closeMobileSidebar() {
  const s = document.getElementById('sidebar'), o = document.getElementById('sidebar-overlay');
  if (s) s.classList.remove('mobile-open'); if (o) o.classList.remove('active');
}
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
let _toastT = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type} show`;
  clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.remove('show'), 4000);
}

/* ---------- servidor ---------- */
const PD_MOTIVOS = {
  desactivado: 'La Panadería está apagada. Actívala en Configuración.',
  datos: 'Los datos no son válidos. Recarga la pantalla e intenta de nuevo.',
  cantidad: 'Revisa las cantidades: deben ser 0 o más, y lo que se bota no puede ser más de lo que sobró.',
  sin_lineas: 'No hay nada para guardar.', repetida: 'Un pan aparece dos veces. Recarga la pantalla.',
  receta: 'Una receta ya no está activa o no existe. Revisa Producción → Recetas.',
  producto: 'Un producto ya no existe. Recarga la pantalla.', motivo: 'Elige un motivo válido.',
  ya_procesado: 'Ese horneado ya se había registrado (no se repitió).',
  ya_cerrado: 'El cierre de ese día ya está hecho. No se puede repetir.',
  fecha: 'Solo se puede cerrar hoy o hasta 3 días atrás.',
  cantidad_buena: 'La cantidad no es válida.', unidad: 'Una materia prima de la receta tiene una unidad que no se puede convertir. Revisa la receta.',
  materia_no_existe: 'Una materia prima de la receta ya no existe. Revisa la receta.', terminado_no_existe: 'El pan de una receta ya no existe. Revisa la receta.',
  sin_existencia: 'No hay suficiente existencia para dar de baja esa cantidad.',
};
function pdMensaje(r) {
  if (!r) return 'No se pudo completar la acción.';
  if (r.motivo === 'falta_materia') {
    const f = Array.isArray(r.faltantes) ? r.faltantes.map(x => `${x.nombre} (necesitas ${num(x.necesario)}, hay ${num(x.disponible)})`).join(', ') : '';
    return `No alcanza la materia prima para ${r.producto || 'un pan'}${f ? ': ' + f : ''}. No se horneó nada.`;
  }
  if (r.motivo === 'desecho_mayor') return `En ${r.producto} se quiere botar más de lo que hay (${num(r.hay)}). No se cerró nada.`;
  return (r.producto ? r.producto + ': ' : '') + (PD_MOTIVOS[r.motivo] || 'No se pudo completar la acción.');
}
async function pdRpc(nombre, args) {
  try {
    const { data, error } = await sb.rpc(nombre, args);
    if (error) { console.warn(nombre, error); return { ok: false, msg: 'No se pudo completar. Revisa tu conexión e intenta de nuevo (no se guardó nada a medias).' }; }
    if (!data || data.ok !== true) return { ...(data || {}), ok: false, msg: pdMensaje(data) };
    return data;
  } catch (e) { console.warn(nombre, e); return { ok: false, msg: 'No se pudo completar. Revisa tu conexión e intenta de nuevo.' }; }
}

/* ---------- modal ---------- */
function pdModal(html) {
  const m = document.getElementById('pd-modal');
  document.getElementById('pd-modal-box').innerHTML = html;
  m.classList.add('abierto');
}
function pdCerrarModal() { if (PD.ocupado) return; document.getElementById('pd-modal').classList.remove('abierto'); }

/* ---------- pestañas ---------- */
async function pdTab(t) {
  PD.tab = t;
  document.querySelectorAll('.pd-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === t));
  try { history.replaceState(null, '', '#' + t); } catch (_) {}
  const v = document.getElementById('pd-vista');
  v.innerHTML = '<p class="tln-sub">Cargando…</p>';
  if (t === 'vitrina') return pdVitrina();
  const r = await pdRpc('panaderia_plan', { p_fecha: null });
  if (!r.ok) { v.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  PD.plan = r;
  if (!r.productos.length) { v.innerHTML = pdSinRecetas(); return; }
  if (t === 'hoy') pdHoy(); else if (t === 'plan') pdPlan(); else if (t === 'cierre') pdCierre();
}
function pdSinRecetas() {
  return `<div class="pd-card pd-vacio"><div class="ico">📋</div><h3>Primero, la receta de cada pan</h3>
    <p class="pd-ayuda">El panel trabaja con las recetas de <b>Producción</b>: cada pan (producto terminado) con sus ingredientes y cuánto rinde una tanda.
    Crea la materia prima (harina, azúcar, levadura…) en Productos, y luego la receta en Producción → Recetas.</p>
    <button class="btn-primary" onclick="navigate('produccion.html')">Ir a Producción</button></div>`;
}

/* ---------- HOY ---------- */
function pdHoy() {
  const p = PD.plan, ps = p.productos;
  const horn = ps.reduce((s, x) => s + Number(x.horneado_hoy || 0), 0);
  const vend = ps.reduce((s, x) => s + Number(x.vendido_hoy || 0), 0);
  const falta = ps.reduce((s, x) => s + Number(x.a_hornear || 0), 0);
  const uc = p.ultimo_cierre;
  const filas = ps.map(x => {
    const base = Number(x.horneado_7d || 0), perd = Number(x.desecho_7d || 0) + Number(x.faltante_7d || 0);
    const pct = base > 0 ? Math.round(perd / base * 100) : null;
    return `<tr>
      <td data-t="Pan"><b>${esc(x.nombre)}</b></td>
      <td data-t="Hay ahora" class="tl-num">${num(x.stock)}</td>
      <td data-t="Debe haber hoy" class="tl-num">${Number(x.objetivo) ? num(x.objetivo) : '<span class="tln-sub">—</span>'}</td>
      <td data-t="Horneado hoy" class="tl-num">${num(x.horneado_hoy)}</td>
      <td data-t="Vendido hoy" class="tl-num">${num(x.vendido_hoy)}</td>
      <td data-t="Falta hornear" class="tl-num">${Number(x.a_hornear) > 0 ? `<span class="pd-pill ambar">${num(x.a_hornear)}</span>` : '<span class="pd-pill ok">listo</span>'}</td>
      <td data-t="Pérdida 7 días" class="tl-num">${pct == null ? '<span class="tln-sub">—</span>' : `<span class="pd-pill ${pct >= 15 ? 'mal' : pct >= 7 ? 'ambar' : 'ok'}">${pct}%</span>`}</td>
    </tr>`;
  }).join('');
  const sinObj = ps.every(x => !Number(x.objetivo));
  document.getElementById('pd-vista').innerHTML = `
    <div class="pd-kpis">
      <div class="pd-kpi"><div class="pd-kpi-l">🔥 Horneado hoy</div><div class="pd-kpi-v">${num(horn)}</div><div class="pd-kpi-s">unidades</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">🛒 Vendido hoy</div><div class="pd-kpi-v">${num(vend)}</div><div class="pd-kpi-s">unidades de pan</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">⏳ Falta hornear</div><div class="pd-kpi-v">${num(falta)}</div><div class="pd-kpi-s">para llegar a la vitrina de hoy</div></div>
      <div class="pd-kpi"><div class="pd-kpi-l">🌙 Último cierre</div><div class="pd-kpi-v" style="font-size:16px">${uc ? esc(fechaLarga(uc.fecha)) : 'Ninguno'}</div>
        <div class="pd-kpi-s">${uc ? `Pérdida ${fmt(uc.total_costo)} (${num(Number(uc.total_desecho) + Number(uc.total_faltante))} unid.)` : 'Haz el cierre al final del día'}</div></div>
    </div>
    ${sinObj ? `<div class="tl-aviso" style="margin-bottom:12px">Aún no dijiste cuánto pan debe haber en vitrina cada día. Hazlo en <b>🧺 Vitrina por día</b> y el plan te dirá cuánto hornear.</div>` : ''}
    <div class="pd-card"><h3>${esc(fechaLarga(p.fecha))}</h3>
      <div class="pd-ayuda">“Pérdida 7 días” = lo que se botó o faltó en los cierres de la última semana, sobre lo horneado. Si sube, hornea menos de ese pan.</div>
      <div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Pan</th><th class="tl-num">Hay ahora</th><th class="tl-num">Debe haber hoy</th><th class="tl-num">Horneado hoy</th><th class="tl-num">Vendido hoy</th><th class="tl-num">Falta hornear</th><th class="tl-num">Pérdida 7 días</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
      <div class="pd-acciones">
        <button class="btn-primary" onclick="pdTab('plan')">🔥 Ir al plan de horneado</button>
        ${p.cierre_hoy ? '<span class="pd-pill ok">✓ Cierre de hoy hecho</span>' : `<button class="btn-secondary" onclick="pdTab('cierre')">🌙 Cierre del día</button>`}
      </div>
    </div>`;
}

/* ---------- PLAN DE HORNEADO ---------- */
function pdPlan() {
  const ps = PD.plan.productos;
  PD.horno = {};
  ps.forEach(x => { PD.horno[x.receta_id] = Number(x.a_hornear || 0); });
  const filas = ps.map(x => `<tr>
      <td data-t="Pan"><b>${esc(x.nombre)}</b><div class="tln-sub">Receta: ${esc(x.receta_nombre)} · rinde ${num(x.rinde)} por tanda</div></td>
      <td data-t="Hay ahora" class="tl-num">${num(x.stock)}</td>
      <td data-t="Debe haber hoy" class="tl-num">${num(x.objetivo)}</td>
      <td data-t="Se vende (promedio)" class="tl-num" title="Promedio de los últimos 4 ${esc(DIAS[PD.plan.dia_semana])}">${num(x.sugerido)}</td>
      <td data-t="Hornear" class="tl-num"><input class="pd-inp" type="number" min="0" step="1" inputmode="numeric" id="ph-${x.receta_id}" value="${Number(x.a_hornear) || 0}" oninput="pdCambioHorno('${x.receta_id}', this.value)" aria-label="Cuánto hornear de ${esc(x.nombre)}"></td>
    </tr>`).join('');
  document.getElementById('pd-vista').innerHTML = `
    <div class="pd-card"><h3>🔥 Plan de horneado · ${esc(fechaLarga(PD.plan.fecha))}</h3>
      <div class="pd-ayuda"><b>Hornear</b> ya viene calculado: lo que <b>debe haber hoy</b> en vitrina menos lo que <b>hay ahora</b>. Puedes cambiarlo.
        “Se vende (promedio)” es lo que vendiste en promedio los últimos 4 ${esc(DIAS[PD.plan.dia_semana].toLowerCase())}.</div>
      <div class="pd-acciones" style="margin:0 0 10px">
        <button class="btn-secondary tln-btn-sm" onclick="pdUsar('objetivo')">Usar “debe haber − hay”</button>
        <button class="btn-secondary tln-btn-sm" onclick="pdUsar('sugerido')">Usar lo que se vende</button>
        <button class="btn-secondary tln-btn-sm" onclick="pdUsar('cero')">Poner todo en 0</button>
      </div>
      <div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Pan</th><th class="tl-num">Hay ahora</th><th class="tl-num">Debe haber hoy</th><th class="tl-num">Se vende (promedio)</th><th class="tl-num">Hornear</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
      <div id="pd-ingr"></div>
      <div class="pd-acciones">
        <button class="btn-secondary" onclick="pdVerIngredientes()">🧾 Ver ingredientes que se van a usar</button>
        <button class="btn-primary" id="pd-btn-hornear" onclick="pdPrepararHornear()">🔥 Hornear ahora</button>
      </div>
    </div>`;
}
function pdCambioHorno(rid, v) { const x = Math.max(0, Math.floor(Number(v) || 0)); PD.horno[rid] = x; const c = document.getElementById('pd-ingr'); if (c) c.innerHTML = ''; }
function pdUsar(modo) {
  PD.plan.productos.forEach(x => {
    const v = modo === 'cero' ? 0 : modo === 'sugerido' ? Math.max(0, Math.ceil(Number(x.sugerido || 0) - Number(x.stock || 0))) : Number(x.a_hornear || 0);
    PD.horno[x.receta_id] = v; const i = document.getElementById('ph-' + x.receta_id); if (i) i.value = v;
  });
  const c = document.getElementById('pd-ingr'); if (c) c.innerHTML = '';
}
function pdLineasHorno() {
  return Object.entries(PD.horno).filter(([, c]) => Number(c) > 0).map(([receta_id, cantidad]) => ({ receta_id, cantidad: Number(cantidad) }));
}
async function pdVerIngredientes(silencioso) {
  const lineas = pdLineasHorno(), c = document.getElementById('pd-ingr');
  if (!lineas.length) { if (c) c.innerHTML = '<div class="tl-aviso" style="margin-top:10px">Escribe cuánto hornear de al menos un pan.</div>'; return null; }
  if (c) c.innerHTML = '<p class="tln-sub" style="margin-top:10px">Calculando…</p>';
  const r = await pdRpc('panaderia_ingredientes', { p_lineas: lineas });
  if (!r.ok) { if (c) c.innerHTML = `<div class="tl-aviso" style="margin-top:10px">${esc(r.msg)}</div>`; return null; }
  const ing = r.ingredientes || [], faltan = ing.filter(i => Number(i.falta) > 0 || i.unidad_mala), costo = ing.reduce((s, i) => s + Number(i.costo || 0), 0);
  if (c && !silencioso) c.innerHTML = `<div style="margin-top:12px">
    ${faltan.length ? `<div class="tl-aviso">⚠️ Falta materia prima: ${faltan.map(i => esc(i.nombre)).join(', ')}. Cómprala o baja la cantidad antes de hornear.</div>` : '<div class="tl-aviso ok">✅ Alcanza toda la materia prima.</div>'}
    <div class="pd-tw" style="margin-top:8px"><table class="tl-tabla"><thead><tr><th>Ingrediente</th><th class="tl-num">Se usa</th><th class="tl-num">Hay</th><th class="tl-num">Falta</th></tr></thead><tbody>
    ${ing.map(i => `<tr><td data-t="Ingrediente">${Number(i.falta) > 0 || i.unidad_mala ? '⚠️' : '✅'} ${esc(i.nombre)}</td><td data-t="Se usa" class="tl-num">${num(i.necesario)}</td><td data-t="Hay" class="tl-num">${num(i.disponible)}</td>
      <td data-t="Falta" class="tl-num">${i.unidad_mala ? '<span class="pd-rojo">unidad</span>' : Number(i.falta) > 0 ? `<span class="pd-rojo">${num(i.falta)}</span>` : '—'}</td></tr>`).join('')}
    </tbody></table></div><div class="pd-resumen"><span>Costo de ingredientes: <b>${fmt(costo)}</b></span></div></div>`;
  return { ing, faltan, costo };
}
async function pdPrepararHornear() {
  if (PD.ocupado) return;
  const lineas = pdLineasHorno();
  if (!lineas.length) { showToast('Escribe cuánto hornear de al menos un pan.', 'error'); return; }
  const info = await pdVerIngredientes();
  if (!info) return;
  if (info.faltan.length) { showToast('Falta materia prima: revisa la lista.', 'error'); return; }
  const nombres = Object.fromEntries(PD.plan.productos.map(x => [x.receta_id, x.nombre]));
  const clave = uuid();   // misma clave para todos los intentos de ESTE horneado
  pdModal(`<div class="tl-modal-cab"><h2>🔥 Confirmar horneado</h2><button type="button" class="tl-x" onclick="pdCerrarModal()" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo">
      <div>Se van a producir:</div>
      <ul style="margin:0 0 0 18px;font-size:14px">${lineas.map(l => `<li><b>${num(l.cantidad)}</b> × ${esc(nombres[l.receta_id] || 'pan')}</li>`).join('')}</ul>
      <div class="pd-ayuda" style="margin:0">Se descuentan los ingredientes (${fmt(info.costo)}) y entra el pan al inventario con su costo real. <b>No toca Caja.</b>
      Si algo no alcanza, <b>no se produce nada</b> (todo o nada).</div>
      <div id="pd-h-err"></div>
    </div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="pdCerrarModal()">Cancelar</button><button class="btn-primary" id="pd-h-ok">Sí, hornear</button></div>`);
  document.getElementById('pd-h-ok').onclick = () => pdHornear(clave, lineas);
}
async function pdHornear(clave, lineas) {
  if (PD.ocupado) return;
  PD.ocupado = true;
  const b = document.getElementById('pd-h-ok'); if (b) { b.disabled = true; b.textContent = 'Horneando…'; }
  try {
    const r = await pdRpc('panaderia_hornear', { p_clave: clave, p_lineas: lineas, p_usuario: PD.nombre });
    if (!r.ok && r.motivo !== 'ya_procesado') {
      const e = document.getElementById('pd-h-err'); if (e) e.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`;
      if (b) { b.disabled = false; b.textContent = 'Reintentar'; }
      return;
    }
    PD.ocupado = false; pdCerrarModal();
    showToast(r.ok ? `🔥 Listo: ${r.cantidad_recetas} pan(es) producido(s). Costo ${fmt(r.costo_total)}.` : 'Ese horneado ya estaba registrado (no se repitió).');
    pdTab('hoy');
  } finally { PD.ocupado = false; }
}

/* ---------- CIERRE DEL DÍA ---------- */
async function pdCierre() {
  const v = document.getElementById('pd-vista'), p = PD.plan;
  const hist = await sb.from('panaderia_cierres').select('id,fecha,total_desecho,total_faltante,total_costo,usuario_nombre,nota')
    .eq('auth_user_id', PD.userId).order('fecha', { ascending: false }).limit(14);
  const histHtml = (hist.data || []).length ? `<div class="pd-card"><h3>Cierres anteriores</h3><div class="pd-tw"><table class="tl-tabla">
      <thead><tr><th>Día</th><th class="tl-num">Se botó / donó</th><th class="tl-num">Faltó</th><th class="tl-num">Costo perdido</th><th>Quién</th></tr></thead><tbody>
      ${(hist.data || []).map(c => `<tr><td data-t="Día">${esc(fechaLarga(c.fecha))}</td><td data-t="Se botó / donó" class="tl-num">${num(c.total_desecho)}</td>
        <td data-t="Faltó" class="tl-num">${Number(c.total_faltante) ? `<span class="pd-rojo">${num(c.total_faltante)}</span>` : '0'}</td>
        <td data-t="Costo perdido" class="tl-num">${fmt(c.total_costo)}</td><td data-t="Quién">${esc(c.usuario_nombre || '—')}</td></tr>`).join('')}
      </tbody></table></div></div>` : '';
  if (p.cierre_hoy) {
    v.innerHTML = `<div class="pd-card"><div class="tl-aviso ok">✓ El cierre de hoy (${esc(fechaLarga(p.fecha))}) ya está hecho. Mañana puedes hacer el siguiente.</div></div>${histHtml}`;
    return;
  }
  PD.cierre = {};
  p.productos.forEach(x => { PD.cierre[x.producto_id] = { stock: Number(x.stock || 0), sobro: Number(x.stock || 0), desecho: 0, motivo: 'no_vendido', costo: Number(x.costo || 0), nombre: x.nombre }; });
  const filas = p.productos.map(x => `<tr>
      <td data-t="Pan"><b>${esc(x.nombre)}</b></td>
      <td data-t="El sistema dice" class="tl-num">${num(x.stock)}</td>
      <td data-t="Sobró (contado)" class="tl-num"><input class="pd-inp" type="number" min="0" step="1" inputmode="numeric" value="${Number(x.stock) || 0}" oninput="pdCambioCierre('${x.producto_id}','sobro',this.value)" aria-label="Cuánto sobró de ${esc(x.nombre)}"></td>
      <td data-t="Se bota / dona" class="tl-num"><input class="pd-inp mini" type="number" min="0" step="1" inputmode="numeric" value="0" oninput="pdCambioCierre('${x.producto_id}','desecho',this.value)" aria-label="Cuánto se bota de ${esc(x.nombre)}"></td>
      <td data-t="Motivo"><select class="pd-sel" onchange="pdCambioCierre('${x.producto_id}','motivo',this.value)">${Object.entries(MOTIVOS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></td>
      <td data-t="Queda para mañana" class="tl-num" id="pc-queda-${x.producto_id}">${num(x.stock)}</td>
      <td data-t="Faltó" class="tl-num" id="pc-falta-${x.producto_id}">—</td>
    </tr>`).join('');
  v.innerHTML = `<div class="pd-card"><h3>🌙 Cierre del día · ${esc(fechaLarga(p.fecha))}</h3>
      <div class="pd-ayuda">Cuenta lo que <b>sobró</b> de cada pan y di cuánto se <b>bota o dona</b>. Lo demás queda para mañana.
        Si contaste <b>menos</b> de lo que dice el sistema, la diferencia sale como <b>faltante</b> (pan que se fue sin venta registrada).
        Todo se da de baja del inventario con su costo y llega a Contabilidad. <b>No toca Caja.</b> Solo se hace una vez por día.</div>
      <div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Pan</th><th class="tl-num">El sistema dice</th><th class="tl-num">Sobró (contado)</th><th class="tl-num">Se bota / dona</th><th>Motivo</th><th class="tl-num">Queda para mañana</th><th class="tl-num">Faltó</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
      <div class="tl-f" style="margin-top:10px"><label for="pc-nota" style="font-size:12.5px;font-weight:700">Nota (opcional)</label><input class="tl-inp" id="pc-nota" maxlength="300" placeholder="Ej: se fue la luz en la tarde"></div>
      <div class="pd-resumen" id="pc-resumen"></div>
      <div class="pd-acciones"><button class="btn-primary" id="pd-btn-cierre" onclick="pdPrepararCierre()">🌙 Cerrar el día</button></div>
    </div>${histHtml}`;
  pdResumenCierre();
}
function pdCambioCierre(pid, campo, valor) {
  const c = PD.cierre[pid]; if (!c) return;
  if (campo === 'motivo') c.motivo = valor; else c[campo] = Math.max(0, n3(valor));
  pdResumenCierre();
}
function pdCalcLinea(c) {
  const faltante = Math.max(0, n3(c.stock - c.sobro));
  const extra = c.sobro > c.stock;
  const maxDes = Math.min(c.sobro, c.stock - faltante);
  return { faltante, extra, maxDes, malo: c.desecho > c.sobro || c.desecho > maxDes + 0.0005, queda: n3(Math.min(c.sobro, c.stock) - c.desecho) };
}
function pdResumenCierre() {
  let tf = 0, td = 0, costo = 0, malos = 0;
  Object.entries(PD.cierre).forEach(([pid, c]) => {
    const l = pdCalcLinea(c);
    const q = document.getElementById('pc-queda-' + pid), f = document.getElementById('pc-falta-' + pid);
    if (q) q.innerHTML = l.malo ? '<span class="pd-rojo">revisa</span>' : num(Math.max(0, l.queda));
    if (f) f.innerHTML = l.extra ? '<span class="pd-pill ambar" title="Se contó más de lo que dice el sistema: no se agrega nada">contaste de más</span>' : l.faltante > 0 ? `<span class="pd-rojo">${num(l.faltante)}</span>` : '—';
    if (l.malo) malos++;
    tf += l.faltante; td += c.desecho; costo += (l.faltante + c.desecho) * c.costo;
  });
  const r = document.getElementById('pc-resumen');
  if (r) r.innerHTML = `<span>Se bota / dona: <b>${num(td)}</b></span><span>Faltó: <b class="${tf > 0 ? 'pd-rojo' : ''}">${num(tf)}</b></span><span>Costo que se pierde: <b>${fmt(costo)}</b></span>
    ${malos ? '<span class="pd-rojo">Lo que se bota no puede ser más de lo que sobró.</span>' : ''}`;
  const b = document.getElementById('pd-btn-cierre'); if (b) b.disabled = malos > 0;
  return { tf, td, costo, malos };
}
function pdPrepararCierre() {
  if (PD.ocupado) return;
  const s = pdResumenCierre(); if (s.malos) return;
  const lineas = Object.entries(PD.cierre).map(([producto_id, c]) => ({ producto_id, sobro: c.sobro, desecho: c.desecho, motivo: c.motivo }));
  const nota = (document.getElementById('pc-nota')?.value || '').trim();
  const faltantes = Object.values(PD.cierre).map(c => ({ c, l: pdCalcLinea(c) })).filter(x => x.l.faltante > 0);
  pdModal(`<div class="tl-modal-cab"><h2>🌙 Confirmar cierre del día</h2><button type="button" class="tl-x" onclick="pdCerrarModal()" aria-label="Cerrar">✕</button></div>
    <div class="tl-modal-cuerpo">
      <div class="pd-resumen" style="margin:0"><span>Se bota / dona: <b>${num(s.td)}</b></span><span>Faltó: <b class="${s.tf > 0 ? 'pd-rojo' : ''}">${num(s.tf)}</b></span><span>Costo que se pierde: <b>${fmt(s.costo)}</b></span></div>
      ${faltantes.length ? `<div class="tl-aviso">Faltante: ${faltantes.map(x => `${esc(x.c.nombre)} (${num(x.l.faltante)})`).join(', ')}. Es pan que no está y no tiene venta registrada. Revisa el conteo antes de confirmar.</div>` : ''}
      <div class="pd-ayuda" style="margin:0">Todo se da de baja del inventario con su costo. <b>No toca Caja.</b> El cierre de hoy <b>no se puede repetir</b>.</div>
      <div id="pd-c-err"></div>
    </div>
    <div class="tl-modal-pie"><button class="btn-secondary" onclick="pdCerrarModal()">Revisar otra vez</button><button class="btn-primary" id="pd-c-ok">Sí, cerrar el día</button></div>`);
  document.getElementById('pd-c-ok').onclick = () => pdCerrarDia(lineas, nota);
}
async function pdCerrarDia(lineas, nota) {
  if (PD.ocupado) return;
  PD.ocupado = true;
  const b = document.getElementById('pd-c-ok'); if (b) { b.disabled = true; b.textContent = 'Cerrando…'; }
  try {
    const r = await pdRpc('panaderia_cerrar_dia', { p_fecha: PD.plan.fecha, p_lineas: lineas, p_nota: nota || null, p_usuario: PD.nombre });
    if (!r.ok) {
      const e = document.getElementById('pd-c-err'); if (e) e.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`;
      if (b) { b.disabled = r.motivo === 'ya_cerrado'; b.textContent = 'Reintentar'; }
      if (r.motivo === 'ya_cerrado') { PD.ocupado = false; setTimeout(() => { pdCerrarModal(); pdTab('cierre'); }, 1200); }
      return;
    }
    PD.ocupado = false; pdCerrarModal();
    showToast(`🌙 Día cerrado. Pérdida: ${fmt(r.costo)}.`);
    pdTab('cierre');
  } finally { PD.ocupado = false; }
}

/* ---------- VITRINA POR DÍA ---------- */
async function pdVitrina() {
  const v = document.getElementById('pd-vista');
  const r = await pdRpc('panaderia_plan', { p_fecha: null });
  if (!r.ok) { v.innerHTML = `<div class="tl-aviso">${esc(r.msg)}</div>`; return; }
  PD.plan = r;
  if (!r.productos.length) { v.innerHTML = pdSinRecetas(); return; }
  const { data, error } = await sb.from('panaderia_vitrina').select('producto_id,dia_semana,cantidad').eq('auth_user_id', PD.userId);
  if (error) { v.innerHTML = '<div class="tl-aviso">No se pudo cargar. Recarga la pantalla.</div>'; return; }
  PD.vitrina = {}; PD.vitrinaOrig = {};
  r.productos.forEach(x => { PD.vitrina[x.producto_id] = [0, 0, 0, 0, 0, 0, 0]; });
  (data || []).forEach(f => { if (PD.vitrina[f.producto_id]) PD.vitrina[f.producto_id][f.dia_semana] = Number(f.cantidad || 0); });
  Object.entries(PD.vitrina).forEach(([k, a]) => { PD.vitrinaOrig[k] = a.slice(); });
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const filas = r.productos.map(x => `<tr><td data-t="Pan"><b>${esc(x.nombre)}</b><div class="tln-sub">Se vende ~${num(x.sugerido)} los ${esc(DIAS[r.dia_semana].toLowerCase())}</div></td>
      ${orden.map(d => `<td data-t="${DIAS[d]}" class="tl-num"><input class="pd-inp mini" id="pv-${x.producto_id}-${d}" type="number" min="0" step="1" inputmode="numeric" value="${PD.vitrina[x.producto_id][d]}" oninput="pdCambioVitrina('${x.producto_id}',${d},this.value)" aria-label="${esc(x.nombre)} ${DIAS[d]}"></td>`).join('')}
      <td class="tl-num"><button class="btn-secondary tln-btn-sm" onclick="pdCopiarLunes('${x.producto_id}')" title="Copiar el lunes a todos los días">↔ Lunes a todos</button></td></tr>`).join('');
  v.innerHTML = `<div class="pd-card"><h3>🧺 Cuánto pan debe haber en vitrina cada día</h3>
      <div class="pd-ayuda">Con esto el plan calcula cuánto hornear: <b>lo que debe haber − lo que hay</b>. Pon 0 los días que no haces ese pan.</div>
      <div class="pd-tw"><table class="tl-tabla"><thead><tr><th>Pan</th>${orden.map(d => `<th class="tl-num">${DIAS[d].slice(0, 3)}</th>`).join('')}<th></th></tr></thead><tbody>${filas}</tbody></table></div>
      <div class="pd-acciones"><button class="btn-primary" id="pd-btn-vit" onclick="pdGuardarVitrina()">💾 Guardar</button><span class="tln-sub" id="pd-vit-est"></span></div></div>`;
}
function pdCambioVitrina(pid, d, val) { PD.vitrina[pid][d] = Math.max(0, n2(val)); const e = document.getElementById('pd-vit-est'); if (e) e.textContent = 'Hay cambios sin guardar'; }
function pdCopiarLunes(pid) {
  const l = PD.vitrina[pid][1];
  for (let d = 0; d < 7; d++) PD.vitrina[pid][d] = l;
  pdVitrinaPintarFila(pid);
  const e = document.getElementById('pd-vit-est'); if (e) e.textContent = 'Hay cambios sin guardar';
}
function pdVitrinaPintarFila(pid) {
  for (let d = 0; d < 7; d++) { const inp = document.getElementById(`pv-${pid}-${d}`); if (inp) inp.value = PD.vitrina[pid][d]; }
}
async function pdGuardarVitrina() {
  if (PD.ocupado) return;
  const items = [];
  Object.entries(PD.vitrina).forEach(([pid, a]) => a.forEach((c, d) => { if (Number(PD.vitrinaOrig[pid][d]) !== Number(c)) items.push({ producto_id: pid, dia: d, cantidad: c }); }));
  if (!items.length) { showToast('No hay cambios.'); return; }
  PD.ocupado = true; const b = document.getElementById('pd-btn-vit'); if (b) b.disabled = true;
  try {
    const r = await pdRpc('panaderia_vitrina_guardar', { p_items: items });
    if (!r.ok) { showToast(r.msg, 'error'); return; }
    Object.entries(PD.vitrina).forEach(([k, a]) => { PD.vitrinaOrig[k] = a.slice(); });
    const e = document.getElementById('pd-vit-est'); if (e) e.textContent = '✓ Guardado';
    showToast('Vitrina guardada.');
  } finally { PD.ocupado = false; if (b) b.disabled = false; }
}

/* ---------- arranque ---------- */
async function pdInit() {
  applyTheme((() => { try { return localStorage.getItem('n360_theme') || 'light'; } catch (_) { return 'light'; } })());
  const f = document.getElementById('header-fecha'); if (f) f.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { window.location.href = 'login.html'; return; }
    const user = session.user; PD.userId = user.id;
    const { data: cfg } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', user.id).maybeSingle();
    PD.empresaConfig = cfg || {};
    if (cfg?.color_principal) { document.documentElement.style.setProperty('--accent', cfg.color_principal); document.documentElement.style.setProperty('--accent-soft', cfg.color_principal + '22'); }
    const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const { data: perfil } = await sb.from('usuarios').select('*').eq('auth_user_id', user.id).maybeSingle();
    PD.nombre = perfil ? (`${perfil.nombre || ''} ${perfil.apellido || ''}`.trim() || user.email?.split('@')[0] || 'Usuario') : (user.email?.split('@')[0] || 'Usuario');
    try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (pf && pf.nombre) PD.nombre = String(pf.nombre).slice(0, 100); } catch (_) {}
    const hn = document.getElementById('header-name'); if (hn) hn.textContent = PD.nombre;
    const hb = document.getElementById('header-biz'); if (hb) hb.textContent = cfg?.nombre_comercial || 'Mi negocio';
    const ha = document.getElementById('header-avatar'); if (ha) ha.textContent = (PD.nombre[0] || 'U').toUpperCase();
    const pt = document.getElementById('plan-text'); if (pt) pt.textContent = perfil?.plan ? String(perfil.plan).charAt(0).toUpperCase() + String(perfil.plan).slice(1) : 'Plan';
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    if (PD.empresaConfig.usa_modulo_panaderia !== true) {
      document.getElementById('content').innerHTML = `<div class="tl-apagado"><div style="font-size:42px">🥖</div><h2>La Panadería está apagada</h2>
        <p>Actívala en <b>Configuración → Panadería</b> para usar el plan de horneado y el cierre del día.</p>
        <button class="btn-primary" onclick="navigate('configuracion.html')">Ir a Configuración</button></div>`;
      return;
    }
    const inicial = (location.hash || '').replace('#', '');
    await pdTab(['hoy', 'plan', 'cierre', 'vitrina'].includes(inicial) ? inicial : 'hoy');
  } catch (e) {
    console.error('pdInit:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    showToast('Ocurrió un problema cargando la Panadería.', 'error');
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') pdCerrarModal(); });
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });
document.addEventListener('DOMContentLoaded', () => { pdInit(); if (window.lucide) lucide.createIcons(); });
