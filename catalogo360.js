/* =====================================================
   CATALOGO360.JS — NEGOCIO360
   App de gestión de catálogos digitales. Reutiliza los productos ya
   existentes de Negocio360 (opcional) o permite crear productos
   propios de Catálogo360, con fotos comprimidas del lado del
   navegador antes de subirlas (nunca se sube una foto sin comprimir).
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const sbClient = sb;

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  catalogos: [], limites: null,
  catalogoActual: null,     // fila completa del catálogo que se está editando
  productosActual: [],      // productos de ese catálogo (con sus fotos)
  fotosSubiendo: false,
  productosNegocio360: [],  // cache de productos reales, para "agregar desde mi inventario"
  seleccionImportar: new Set(),
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtC(n) { return 'C$' + Number(n||0).toLocaleString('es-NI', {minimumFractionDigits:2, maximumFractionDigits:2}); }

/* =====================================================
   SHELL: TEMA, SIDEBAR, NAVEGACIÓN, MODALES (idéntico al resto del sistema)
===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('n360_theme', theme);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}
function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme');
  applyTheme(curr === 'dark' ? 'light' : 'dark');
}
function isMobileViewport() { return window.innerWidth <= 860; }
function toggleSidebar() {
  if (isMobileViewport()) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
  } else {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('main').classList.toggle('sidebar-collapsed');
  }
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}
function navigate(url) { closeMobileSidebar(); window.location.href = url; }
function openModal(id) { const el = document.getElementById(id); if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; } }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = 'toast toast-' + (type === 'error' ? 'error' : 'success') + ' toast-show';
  setTimeout(() => t.classList.remove('toast-show'), 3200);
}

/* =====================================================
   COMPRESIÓN DE IMÁGENES
===================================================== */
function comprimirImagen(archivo, anchoMax = 1200, calidad = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > anchoMax) { h = Math.round(h * (anchoMax / w)); w = anchoMax; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('No se pudo comprimir la imagen')); return; }
        resolve({ blob, ancho: w, alto: h });
      }, 'image/webp', calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

async function subirImagenCatalogo(blob, carpeta) {
  const nombreArchivo = Date.now() + '_' + Math.random().toString(36).slice(2,8) + '.webp';
  const ruta = STATE.userId + '/' + carpeta + '/' + nombreArchivo;
  const { error } = await sb.storage.from('catalogo360').upload(ruta, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from('catalogo360').getPublicUrl(ruta);
  return { url: data.publicUrl, ruta };
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
  } catch (e) {}
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hAv = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name||'U')[0].toUpperCase();
}

async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarLimitesYUso();
    await cargarListaCatalogos();
  } catch (e) {
    console.error('init catalogo360:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   LÍMITES Y USO
===================================================== */
async function cargarLimitesYUso() {
  try {
    const { data: limites } = await sb.rpc('catalogo_obtener_limites', { p_auth_user_id: STATE.userId });
    STATE.limites = limites?.[0] || { plan_key:'basico', catalogos_max:1, productos_por_catalogo_max:100, fotos_por_producto_max:3 };
  } catch (e) {
    STATE.limites = { plan_key:'basico', catalogos_max:1, productos_por_catalogo_max:100, fotos_por_producto_max:3 };
  }
  try {
    const { data: plan } = await sb.from('catalogo_planes').select('nombre, precio_mensual').eq('plan_key', STATE.limites.plan_key).maybeSingle();
    STATE.limites.nombre_plan = plan?.nombre || STATE.limites.plan_key;
    STATE.limites.precio_mensual = plan?.precio_mensual || 0;
  } catch (e) { STATE.limites.nombre_plan = STATE.limites.plan_key; STATE.limites.precio_mensual = 0; }
}

/* =====================================================
   DASHBOARD PRINCIPAL
===================================================== */
async function cargarListaCatalogos() {
  try {
    const { data } = await sb.from('catalogos').select('*').eq('auth_user_id', STATE.userId).order('created_at', { ascending:false });
    STATE.catalogos = data || [];
  } catch (e) { STATE.catalogos = []; }

  const nombreNegocio = STATE.empresaConfig?.nombre_comercial || STATE.empresaConfig?.nombre_negocio || STATE.currentUser?.nombre || '';
  const saludoEl = document.getElementById('c360-saludo');
  if (saludoEl && nombreNegocio) saludoEl.textContent = `¡Bienvenido, ${nombreNegocio}! 👋`;

  const idsC = STATE.catalogos.map(c => c.id);
  let productosTotal = 0, fotosTotal = 0, todosLosProductos = [];
  if (idsC.length) {
    const { data: productos } = await sb.from('catalogo_productos').select('id, catalogo_id, nombre, precio, categoria, activo, created_at').in('catalogo_id', idsC).order('created_at', { ascending:false });
    todosLosProductos = productos || [];
    productosTotal = todosLosProductos.length;
    const idsProd = todosLosProductos.map(p => p.id);
    if (idsProd.length) {
      const { count } = await sb.from('catalogo_producto_fotos').select('id', { count:'exact', head:true }).in('catalogo_producto_id', idsProd);
      fotosTotal = count || 0;
    }
  }

  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
  let visitasMes = 0;
  let visitasPorCatalogo = {};
  try {
    const { data: resumen } = await sb.rpc('catalogo_resumen_eventos', { p_auth_user_id: STATE.userId, p_desde: inicioMes.toISOString() });
    visitasMes = (resumen || []).find(r => r.tipo_evento === 'visita')?.total || 0;
    const { data: visitasCat } = await sb.rpc('catalogo_visitas_por_catalogo', { p_auth_user_id: STATE.userId });
    (visitasCat || []).forEach(v => { visitasPorCatalogo[v.catalogo_id] = v.visitas; });
  } catch (e) {}

  const publicados = STATE.catalogos.filter(c => c.estado === 'publicado').length;
  const borradores = STATE.catalogos.length - publicados;

  renderKpis({ productosTotal, fotosTotal, visitasMes, publicados, borradores });
  renderPlanYUso(productosTotal, fotosTotal);
  renderCatalogosCards(visitasPorCatalogo);
  renderProductosRecientes(todosLosProductos.slice(0, 5));
  renderActividadReciente(todosLosProductos);

  const btnCrear = document.getElementById('c360-btn-crear');
  if (btnCrear) btnCrear.disabled = STATE.catalogos.length >= STATE.limites.catalogos_max;
}

function renderKpis({ productosTotal, fotosTotal, visitasMes, publicados, borradores }) {
  const L = STATE.limites;
  const promedioProd = STATE.catalogos.length ? Math.round(productosTotal / STATE.catalogos.length) : 0;
  const promedioFotos = productosTotal ? (fotosTotal / productosTotal).toFixed(1) : '0.0';
  const kpis = [
    { icono:'📁', color:'#a855f7', valor:`${STATE.catalogos.length} / ${L.catalogos_max}`, label:'Catálogos',
      sub: STATE.catalogos.length >= L.catalogos_max ? 'Límite alcanzado' : `${L.catalogos_max - STATE.catalogos.length} disponible(s)` },
    { icono:'📦', color:'#10b981', valor:`${productosTotal} / ${STATE.catalogos.length * L.productos_por_catalogo_max}`, label:'Productos totales',
      sub: `${promedioProd} por catálogo (promedio)` },
    { icono:'🖼', color:'#3b82f6', valor:`${fotosTotal}`, label:'Fotos subidas',
      sub: `Promedio: ${promedioFotos} por producto` },
    { icono:'👁', color:'#f59e0b', valor:`${visitasMes}`, label:'Visitas este mes',
      sub: visitasMes ? 'Total registrado' : 'Aún sin visitas' },
    { icono:'📈', color:'#ec4899', valor:`${publicados}`, label:'Catálogos publicados',
      sub: borradores ? `${borradores} en borrador` : 'Todos publicados' },
  ];
  document.getElementById('c360-kpis').innerHTML = kpis.map(k => `
    <div class="c360-kpi-card">
      <div class="c360-kpi-icono" style="background:${k.color}22;color:${k.color}">${k.icono}</div>
      <div class="c360-kpi-valor">${k.valor}</div>
      <div class="c360-kpi-label">${k.label}</div>
      <div class="c360-kpi-sub">${k.sub}</div>
    </div>
  `).join('');
}

function renderPlanYUso(productosTotal, fotosTotal) {
  const L = STATE.limites;
  document.getElementById('c360-plan-nombre').textContent = L.nombre_plan;
  document.getElementById('c360-plan-precio').textContent = L.precio_mensual > 0 ? `$${L.precio_mensual}/mes` : 'Gratis';

  const features = [
    `${L.catalogos_max} catálogo${L.catalogos_max===1?'':'s'} incluido${L.catalogos_max===1?'':'s'}`,
    `${L.productos_por_catalogo_max} productos por catálogo`,
    `${L.fotos_por_producto_max} fotos por producto`,
  ];
  document.getElementById('c360-plan-features').innerHTML = features.map(f => `<div>✓ ${esc(f)}</div>`).join('');

  const promedioFotosPorProducto = productosTotal ? Math.round(fotosTotal / productosTotal) : 0;
  const barras = [
    { label:'Catálogos', actual: STATE.catalogos.length, max: L.catalogos_max },
    { label:'Productos por catálogo (promedio)', actual: STATE.catalogos.length ? Math.round(productosTotal/STATE.catalogos.length) : 0, max: L.productos_por_catalogo_max },
    { label:'Fotos por producto (promedio)', actual: promedioFotosPorProducto, max: L.fotos_por_producto_max },
  ];
  document.getElementById('c360-barras-uso').innerHTML = barras.map(b => {
    const pct = Math.min(100, Math.round((b.actual / (b.max||1)) * 100));
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px"><span>${esc(b.label)}</span><span style="font-weight:700">${b.actual} de ${b.max}</span></div>
      <div class="c360-barra-uso-track"><div class="c360-barra-uso-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderCatalogosCards(visitasPorCatalogo) {
  const onboarding = document.getElementById('c360-onboarding');
  const grid = document.getElementById('c360-grid-catalogos');
  if (!STATE.catalogos.length) { onboarding.style.display = 'block'; grid.innerHTML = ''; return; }
  onboarding.style.display = 'none';
  grid.innerHTML = STATE.catalogos.map(c => `
    <div class="c360-mini-card-catalogo" onclick="abrirEditorCatalogo('${c.id}')">
      ${c.logo_url ? `<img src="${esc(c.logo_url)}">` : `<div style="height:90px;background:linear-gradient(135deg,var(--accent),${c.color_acento||'#6366f1'});display:flex;align-items:center;justify-content:center;font-size:26px">📇</div>`}
      <span class="c360-badge ${c.estado}" style="position:absolute;top:8px;left:8px">${c.estado === 'publicado' ? 'PUBLICADO' : c.estado === 'pausado' ? 'PAUSADO' : 'BORRADOR'}</span>
      <span style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px">👁 ${visitasPorCatalogo[c.id] || 0}</span>
      <div style="padding:10px 12px;background:var(--bg-surface)">
        <div style="font-weight:700;font-size:13.5px">${esc(c.nombre)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${tiempoRelativo(c.updated_at)}</div>
      </div>
    </div>
  `).join('');
}

function tiempoRelativo(fechaISO) {
  if (!fechaISO) return '';
  const diffMs = Date.now() - new Date(fechaISO).getTime();
  const horas = Math.floor(diffMs / 3600000);
  if (horas < 1) return 'Hace instantes';
  if (horas < 24) return `Actualizado hace ${horas} hora${horas===1?'':'s'}`;
  const dias = Math.floor(horas / 24);
  return `Actualizado hace ${dias} día${dias===1?'':'s'}`;
}

function renderProductosRecientes(productos) {
  const cont = document.getElementById('c360-productos-recientes');
  if (!productos.length) { cont.innerHTML = `<p style="color:var(--text-muted);font-size:13px">Todavía no has agregado productos.</p>`; return; }
  cont.innerHTML = productos.map(p => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="width:40px;height:40px;border-radius:8px;background:var(--bg-app);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📦</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nombre)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${esc(p.categoria || 'Sin categoría')}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;font-size:13px;color:var(--accent)">${fmtC(p.precio)}</div>
        <div style="font-size:10.5px;color:${p.activo?'var(--success)':'var(--text-muted)'}">${p.activo?'Activo':'Inactivo'}</div>
      </div>
    </div>
  `).join('');
}

function renderActividadReciente(todosLosProductos) {
  const eventos = [];
  STATE.catalogos.forEach(c => {
    eventos.push({ icono: c.estado==='publicado'?'✅':'📁', texto: c.estado==='publicado' ? `${c.nombre} fue publicado` : `${c.nombre} creado`, fecha: c.estado==='publicado' && c.published_at ? c.published_at : c.created_at });
  });
  todosLosProductos.slice(0, 5).forEach(p => {
    eventos.push({ icono:'➕', texto: `Nuevo producto agregado "${p.nombre}"`, fecha: p.created_at });
  });
  eventos.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  const cont = document.getElementById('c360-actividad-reciente');
  if (!eventos.length) { cont.innerHTML = `<p style="color:var(--text-muted);font-size:13px">Sin actividad todavía.</p>`; return; }
  cont.innerHTML = eventos.slice(0, 6).map(e => `
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="width:26px;height:26px;border-radius:50%;background:var(--bg-app);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">${e.icono}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;line-height:1.35">${esc(e.texto)}</div>
        <div style="font-size:10.5px;color:var(--text-muted)">${tiempoRelativo(e.fecha)}</div>
      </div>
    </div>
  `).join('');
}

function accionRapida(tipo) {
  if (!STATE.catalogos.length) { showToast('Primero crea un catálogo', 'error'); return; }
  const catalogoObjetivo = STATE.catalogos[0];
  if (tipo === 'producto') { abrirEditorCatalogo(catalogoObjetivo.id).then(() => { cambiarTabEditor('productos'); abrirModalProductoCatalogo(); }); }
  else if (tipo === 'fotos') { abrirEditorCatalogo(catalogoObjetivo.id).then(() => cambiarTabEditor('productos')); }
  else if (tipo === 'ver') {
    const archivo = archivoDePlantilla(catalogoObjetivo.plantilla);
    if (catalogoObjetivo.slug_publico && catalogoObjetivo.estado === 'publicado') window.open(`${archivo}?c=${catalogoObjetivo.slug_publico}`, '_blank');
    else window.open(`${archivo}?preview=${catalogoObjetivo.id}`, '_blank');
  }
  else if (tipo === 'compartir') {
    if (catalogoObjetivo.slug_publico) { navigator.clipboard?.writeText(`${window.location.origin}/${archivoDePlantilla(catalogoObjetivo.plantilla)}?c=${catalogoObjetivo.slug_publico}`); showToast('🔗 Enlace copiado'); }
    else showToast('Publica el catálogo primero para poder compartirlo', 'error');
  }
}

function abrirModalCrearCatalogo() {
  if (STATE.catalogos.length >= STATE.limites.catalogos_max) {
    showToast(`Tu plan permite hasta ${STATE.limites.catalogos_max} catálogo(s). Mejora tu plan para crear más.`, 'error');
    return;
  }
  document.getElementById('cc-nombre').value = '';
  document.getElementById('cc-error').textContent = '';
  openModal('modal-crear-catalogo');
}

async function crearCatalogo() {
  const nombre = document.getElementById('cc-nombre').value.trim();
  const errEl = document.getElementById('cc-error');
  if (!nombre) { errEl.textContent = 'Escribe un nombre para tu catálogo.'; return; }
  errEl.textContent = '';
  try {
    const { data, error } = await sb.from('catalogos').insert({ auth_user_id: STATE.userId, nombre }).select().single();
    if (error) throw error;
    closeModal('modal-crear-catalogo');
    showToast('✅ Catálogo creado');
    await cargarListaCatalogos();
    abrirEditorCatalogo(data.id);
  } catch (e) {
    errEl.textContent = e.message?.includes('row-level security') ? 'Alcanzaste el límite de catálogos de tu plan.' : 'No se pudo crear el catálogo, intenta de nuevo.';
  }
}

function volverAListaCatalogos() {
  document.getElementById('c360-vista-editor').style.display = 'none';
  document.getElementById('c360-vista-lista').style.display = 'block';
  STATE.catalogoActual = null;
  cargarListaCatalogos();
}

/* =====================================================
   EDITOR DE UN CATÁLOGO
===================================================== */
async function abrirEditorCatalogo(id) {
  const { data, error } = await sb.from('catalogos').select('*').eq('id', id).eq('auth_user_id', STATE.userId).maybeSingle();
  if (error || !data) { showToast('No se pudo abrir el catálogo', 'error'); return; }
  STATE.catalogoActual = data;

  document.getElementById('c360-vista-lista').style.display = 'none';
  document.getElementById('c360-vista-editor').style.display = 'block';
  document.getElementById('c360-editor-titulo').textContent = data.nombre;

  renderEstadoPublicacion();
  cargarTabInfo();
  cargarTabApariencia();
  cambiarTabEditor('info');
  await cargarTabCategorias();
  await cargarTabProductos();
}

function renderEstadoPublicacion() {
  const c = STATE.catalogoActual;
  const estadoTexto = document.getElementById('c360-editor-estado-texto');
  const panel = document.getElementById('c360-panel-publicado');
  const btnPublicar = document.getElementById('c360-btn-publicar');
  const btnPausar = document.getElementById('c360-btn-pausar');

  if (c.estado === 'publicado' && c.slug_publico) {
    estadoTexto.textContent = 'Publicado y visible al público.';
    panel.style.display = 'block';
    const url = `${window.location.origin}/${archivoDePlantilla(c.plantilla)}?c=${c.slug_publico}`;
    document.getElementById('c360-url-publica').textContent = url;
    btnPublicar.textContent = '🔄 Actualizar publicación';
    btnPausar.style.display = '';
    btnPausar.textContent = '⏸ Desactivar';
  } else if (c.estado === 'pausado' && c.slug_publico) {
    estadoTexto.textContent = 'Desactivado — el enlace no muestra el catálogo hasta que lo reactives.';
    panel.style.display = 'none';
    btnPublicar.textContent = '🚀 Publicar';
    btnPausar.style.display = '';
    btnPausar.textContent = '▶ Reactivar';
  } else {
    estadoTexto.textContent = 'Todavía en borrador — nadie más puede verlo hasta que lo publiques.';
    panel.style.display = 'none';
    btnPublicar.textContent = '🚀 Publicar';
    btnPausar.style.display = 'none';
  }
}

async function togglePausarCatalogo() {
  const c = STATE.catalogoActual;
  const nuevoEstado = c.estado === 'publicado' ? 'pausado' : 'publicado';
  try {
    const { error } = await sb.from('catalogos').update({ estado: nuevoEstado, updated_at: new Date().toISOString() }).eq('id', c.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    c.estado = nuevoEstado;
    renderEstadoPublicacion();
    showToast(nuevoEstado === 'pausado' ? '⏸ Catálogo desactivado' : '✅ Catálogo reactivado');
  } catch (e) {
    console.error('togglePausarCatalogo:', e);
    showToast('No se pudo cambiar el estado: ' + (e.message || 'intenta de nuevo'), 'error');
  }
}

function abrirEliminarCatalogo() {
  const c = STATE.catalogoActual;
  document.getElementById('ec-nombre-catalogo').textContent = c.nombre;
  document.getElementById('ec-aviso-publicado').style.display = (c.estado === 'publicado') ? 'block' : 'none';
  document.getElementById('ec-conteo-productos').textContent = `Este catálogo tiene ${STATE.productosActual.length} producto${STATE.productosActual.length===1?'':'s'} — se eliminarán junto con el catálogo.`;
  document.getElementById('ec-error').textContent = '';
  openModal('modal-eliminar-catalogo');
}

function rutaDesdeUrlStorage(url) {
  if (!url) return null;
  const marcador = '/catalogo360/';
  const idx = url.indexOf(marcador);
  return idx === -1 ? null : url.slice(idx + marcador.length);
}

async function confirmarEliminarCatalogo() {
  const c = STATE.catalogoActual;
  const errEl = document.getElementById('ec-error');
  const btn = document.getElementById('btn-confirmar-eliminar-catalogo');
  errEl.textContent = '';
  btn.disabled = true; const textoOriginalBtn = btn.textContent; btn.textContent = 'Eliminando…';
  try {
    const idsProductos = STATE.productosActual.map(p => p.id);
    let rutas = [];
    if (idsProductos.length) {
      const { data: fotos } = await sb.from('catalogo_producto_fotos').select('storage_path').in('catalogo_producto_id', idsProductos);
      rutas = (fotos || []).map(f => f.storage_path).filter(Boolean);
    }
    const rutaLogo = rutaDesdeUrlStorage(c.logo_url);
    const rutaBanner = rutaDesdeUrlStorage(c.banner_url);
    if (rutaLogo) rutas.push(rutaLogo);
    if (rutaBanner) rutas.push(rutaBanner);

    const { error } = await sb.from('catalogos').delete().eq('id', c.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;

    if (rutas.length) {
      try { await sb.storage.from('catalogo360').remove(rutas); }
      catch (eStorage) { console.warn('No se pudieron borrar todos los archivos de Storage (best-effort):', eStorage); }
    }

    closeModal('modal-eliminar-catalogo');
    showToast('Catálogo eliminado');
    volverAListaCatalogos();
  } catch (e) {
    console.error('confirmarEliminarCatalogo:', e);
    errEl.textContent = 'Error al eliminar: ' + (e.message || 'intenta de nuevo');
  } finally {
    btn.disabled = false; btn.textContent = textoOriginalBtn;
  }
}

function cambiarTabEditor(tab) {
  document.querySelectorAll('.c360-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['info','categorias','productos','apariencia'].forEach(t => {
    document.getElementById(`c360-tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
}

/* ---------- TAB: INFORMACIÓN ---------- */
function cargarTabInfo() {
  const c = STATE.catalogoActual;
  document.getElementById('c360-i-nombre-comercial').value = c.nombre_comercial || '';
  document.getElementById('c360-i-descripcion').value = c.descripcion || '';
  document.getElementById('c360-i-whatsapp').value = c.whatsapp || '';
  document.getElementById('c360-i-telefono').value = c.telefono || '';
  document.getElementById('c360-i-email').value = c.email || '';
  document.getElementById('c360-i-ubicacion').value = c.ubicacion || '';
  const logoImg = document.getElementById('c360-i-logo-preview');
  if (c.logo_url) { logoImg.src = c.logo_url; logoImg.style.display = 'block'; } else { logoImg.style.display = 'none'; }
}

async function subirLogoCatalogo(archivo) {
  if (!archivo) return;
  showToast('Subiendo logo…');
  try {
    const { blob } = await comprimirImagen(archivo, 400, 0.85);
    const { url } = await subirImagenCatalogo(blob, 'logo');
    const { error } = await sb.from('catalogos').update({ logo_url: url, updated_at: new Date().toISOString() }).eq('id', STATE.catalogoActual.id);
    if (error) throw error;
    STATE.catalogoActual.logo_url = url;
    const logoImg = document.getElementById('c360-i-logo-preview');
    logoImg.src = url; logoImg.style.display = 'block';
    showToast('✅ Logo actualizado');
  } catch (e) {
    console.error('subirLogoCatalogo:', e);
    showToast('No se pudo subir el logo', 'error');
  }
}

async function subirBannerCatalogo(archivo) {
  if (!archivo) return;
  showToast('Subiendo banner…');
  try {
    const { blob } = await comprimirImagen(archivo, 1600, 0.82);
    const { url } = await subirImagenCatalogo(blob, 'banner');
    const { error } = await sb.from('catalogos').update({ banner_url: url, updated_at: new Date().toISOString() }).eq('id', STATE.catalogoActual.id);
    if (error) throw error;
    STATE.catalogoActual.banner_url = url;
    const banEl = document.getElementById('c360-a-banner-preview');
    banEl.src = url; banEl.style.display = 'block';
    showToast('✅ Banner actualizado');
  } catch (e) {
    console.error('subirBannerCatalogo:', e);
    showToast('No se pudo subir el banner', 'error');
  }
}

async function guardarInfoCatalogo() {
  const payload = {
    nombre_comercial: document.getElementById('c360-i-nombre-comercial').value.trim() || null,
    descripcion: document.getElementById('c360-i-descripcion').value.trim() || null,
    whatsapp: document.getElementById('c360-i-whatsapp').value.trim() || null,
    telefono: document.getElementById('c360-i-telefono').value.trim() || null,
    email: document.getElementById('c360-i-email').value.trim() || null,
    ubicacion: document.getElementById('c360-i-ubicacion').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  try {
    const { error } = await sb.from('catalogos').update(payload).eq('id', STATE.catalogoActual.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    Object.assign(STATE.catalogoActual, payload);
    showToast('✅ Información guardada');
  } catch (e) {
    console.error('guardarInfoCatalogo:', e);
    showToast('No se pudo guardar: ' + (e.message || 'intenta de nuevo'), 'error');
  }
}

/* ---------- TAB: APARIENCIA ---------- */
const PALETAS_CATALOGO360 = [
  { nombre: 'Índigo',       color: '#6366f1' },
  { nombre: 'Esmeralda',    color: '#10b981' },
  { nombre: 'Rosa',         color: '#ec4899' },
  { nombre: 'Ámbar',        color: '#f59e0b' },
  { nombre: 'Coral',        color: '#ef4444' },
  { nombre: 'Azul océano',  color: '#3b82f6' },
  { nombre: 'Púrpura',      color: '#a855f7' },
  { nombre: 'Grafito',      color: '#475569' },
];

const PLANTILLAS_CATALOGO360 = [
  { key:'profesional', nombre:'Boutique', icono:'💎', desc:'Oscura, editorial, con vitrina de producto destacado.', disponible:true, archivo:'c360.html' },
  { key:'plantilla2', nombre:'Vibrante', icono:'✨', desc:'Clara, colorida, con degradados y burbujas animadas.', disponible:true, archivo:'c360-vibrante.html' },
  { key:'navidad', nombre:'Navidad', icono:'🎄', desc:'Cálida y editorial -- vino, verde pino, crema y dorado.', disponible:true, archivo:'c360-navidad.html' },
  { key:'valentin', nombre:'San Valentín', icono:'❤️', desc:'Romántica y sofisticada -- borgoña, rosa empolvado, crema y dorado.', disponible:true, archivo:'c360-valentin.html' },
  { key:'halloween', nombre:'Halloween', icono:'🎃', desc:'Misteriosa y oscura -- púrpura profundo, naranja vibrante y detalles espeluznantes.', disponible:true, archivo:'c360-halloween.html' },
];

function archivoDePlantilla(key) {
  return PLANTILLAS_CATALOGO360.find(p => p.key === key)?.archivo || 'c360.html';
}

function cargarTabApariencia() {
  const c = STATE.catalogoActual;
  renderPlantillasApariencia(c.plantilla || 'profesional');
  document.getElementById('c360-a-color').value = c.color_acento || '#6366f1';
  renderPaletasApariencia(c.color_acento || '#6366f1');
  elegirTemaCatalogo(c.tema_default || 'claro', false);
  const banEl = document.getElementById('c360-a-banner-preview');
  if (c.banner_url) { banEl.src = c.banner_url; banEl.style.display = 'block'; } else { banEl.style.display = 'none'; }
}

function renderPlantillasApariencia(plantillaActiva) {
  document.getElementById('c360-a-plantillas').innerHTML = PLANTILLAS_CATALOGO360.map(p => `
    <div class="c360-plantilla-card ${p.key===plantillaActiva?'activa':''} ${!p.disponible?'deshabilitada':''}"
         onclick="${p.disponible ? `elegirPlantilla('${p.key}')` : ''}">
      <div class="c360-plantilla-preview" style="background:${p.disponible?'linear-gradient(135deg,#14161f,#1b1f29)':'var(--bg-app)'};color:${p.disponible?'#fff':'inherit'}">${p.icono}</div>
      <div class="c360-plantilla-info">
        <div class="c360-plantilla-nombre">${esc(p.nombre)} ${p.key===plantillaActiva?'<span class="c360-plantilla-badge">Activa</span>':(!p.disponible?'<span class="c360-plantilla-badge proximamente">Próximamente</span>':'')}</div>
        <div class="c360-plantilla-desc">${esc(p.desc)}</div>
      </div>
    </div>
  `).join('');
}

async function elegirPlantilla(key) {
  try {
    const { error } = await sb.from('catalogos').update({ plantilla: key, updated_at: new Date().toISOString() }).eq('id', STATE.catalogoActual.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    STATE.catalogoActual.plantilla = key;
    renderPlantillasApariencia(key);
    showToast('✅ Plantilla aplicada — tus productos ya se acomodaron en ella');
  } catch (e) {
    console.error('elegirPlantilla:', e);
    showToast('No se pudo cambiar la plantilla: ' + (e.message || 'intenta de nuevo'), 'error');
  }
}

function renderPaletasApariencia(colorActivo) {
  document.getElementById('c360-a-paletas').innerHTML = PALETAS_CATALOGO360.map(p => `
    <button type="button" class="c360-paleta-btn ${p.color === colorActivo ? 'active' : ''}" onclick="elegirPaletaApariencia('${p.color}')">
      <span class="c360-paleta-swatch" style="background:${p.color}"></span>${p.nombre}
    </button>
  `).join('');
}
function elegirPaletaApariencia(color) {
  document.getElementById('c360-a-color').value = color;
  renderPaletasApariencia(color);
}

function elegirTemaCatalogo(tema, marcarCambio = true) {
  document.getElementById('c360-a-tema-claro').classList.toggle('active', tema === 'claro');
  document.getElementById('c360-a-tema-oscuro').classList.toggle('active', tema === 'oscuro');
  STATE._temaElegido = tema;
}
async function guardarApariencia() {
  const payload = {
    color_acento: document.getElementById('c360-a-color').value,
    tema_default: STATE._temaElegido || STATE.catalogoActual.tema_default || 'claro',
    updated_at: new Date().toISOString(),
  };
  try {
    const { error } = await sb.from('catalogos').update(payload).eq('id', STATE.catalogoActual.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    Object.assign(STATE.catalogoActual, payload);
    showToast('✅ Apariencia guardada');
  } catch (e) {
    console.error('guardarApariencia:', e);
    showToast('No se pudo guardar: ' + (e.message || 'intenta de nuevo'), 'error');
  }
}

/* ---------- TAB: CATEGORÍAS ---------- */
async function cargarTabCategorias() {
  try {
    const { data } = await sb.from('catalogo_categorias').select('*').eq('catalogo_id', STATE.catalogoActual.id).order('orden').order('created_at');
    STATE.categorias = data || [];
  } catch (e) { STATE.categorias = []; }
  renderTabCategorias();
}

function renderTabCategorias() {
  const cont = document.getElementById('c360-lista-categorias');
  if (!STATE.categorias.length) {
    cont.innerHTML = `<p style="color:var(--text-muted);font-size:13px;grid-column:1/-1">Aún no has creado ninguna categoría — tus productos se muestran directo en el catálogo.</p>`;
    return;
  }
  const conteo = {};
  (STATE.productosActual || []).forEach(p => { if (p.categoria_id) conteo[p.categoria_id] = (conteo[p.categoria_id]||0) + 1; });

  cont.innerHTML = STATE.categorias.map(cat => `
    <div class="c360-card-producto">
      ${cat.imagen_url ? `<img src="${esc(cat.imagen_url)}" style="height:100px;width:100%;object-fit:cover">` : `<div style="height:100px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;background:var(--bg-app)">Sin imagen</div>`}
      <div style="padding:10px 12px">
        <div style="font-weight:700;font-size:13.5px">${esc(cat.nombre)}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${conteo[cat.id]||0} producto${(conteo[cat.id]||0)===1?'':'s'}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn-secondary btn-sm" style="flex:1" onclick="abrirModalCategoria('${cat.id}')">Editar</button>
          <button class="btn-icon btn-icon-danger" onclick="eliminarCategoria('${cat.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function abrirModalCategoria(id) {
  document.getElementById('cat-error').textContent = '';
  document.getElementById('cat-imagen-preview').style.display = 'none';
  if (id) {
    const cat = STATE.categorias.find(c => c.id === id);
    if (!cat) return;
    document.getElementById('cat-titulo').textContent = 'Editar categoría';
    document.getElementById('cat-id').value = cat.id;
    document.getElementById('cat-nombre').value = cat.nombre;
    document.getElementById('cat-descripcion').value = cat.descripcion || '';
    if (cat.imagen_url) { const img = document.getElementById('cat-imagen-preview'); img.src = cat.imagen_url; img.style.display = 'block'; }
  } else {
    document.getElementById('cat-titulo').textContent = 'Nueva categoría';
    document.getElementById('cat-id').value = '';
    document.getElementById('cat-nombre').value = '';
    document.getElementById('cat-descripcion').value = '';
  }
  openModal('modal-categoria');
}

async function subirImagenCategoria(archivo) {
  if (!archivo) return;
  const idCat = document.getElementById('cat-id').value;
  try {
    const { blob } = await comprimirImagen(archivo, 800, 0.82);
    const { url } = await subirImagenCatalogo(blob, 'categorias');
    const img = document.getElementById('cat-imagen-preview');
    img.src = url; img.style.display = 'block';
    STATE._imagenCategoriaTemp = url;
    if (idCat) {
      const { error } = await sb.from('catalogo_categorias').update({ imagen_url: url }).eq('id', idCat).eq('auth_user_id', STATE.userId);
      if (error) throw error;
    }
    showToast('✅ Imagen subida');
  } catch (e) {
    console.error('subirImagenCategoria:', e);
    showToast('No se pudo subir la imagen', 'error');
  }
}

async function guardarCategoria() {
  const id = document.getElementById('cat-id').value;
  const nombre = document.getElementById('cat-nombre').value.trim();
  const errEl = document.getElementById('cat-error');
  if (!nombre) { errEl.textContent = 'Escribe un nombre.'; return; }
  errEl.textContent = '';
  const payload = { nombre, descripcion: document.getElementById('cat-descripcion').value.trim() || null };
  try {
    if (id) {
      const { error } = await sb.from('catalogo_categorias').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
      if (error) throw error;
    } else {
      const { error } = await sb.from('catalogo_categorias').insert({
        ...payload, catalogo_id: STATE.catalogoActual.id, auth_user_id: STATE.userId,
        imagen_url: STATE._imagenCategoriaTemp || null,
      });
      if (error) throw error;
    }
    STATE._imagenCategoriaTemp = null;
    closeModal('modal-categoria');
    showToast('✅ Categoría guardada');
    await cargarTabCategorias();
  } catch (e) {
    console.error('guardarCategoria:', e);
    errEl.textContent = 'No se pudo guardar: ' + (e.message || 'intenta de nuevo');
  }
}

async function eliminarCategoria(id) {
  if (!confirm('¿Eliminar esta categoría? Los productos que tenía no se borran, solo dejan de estar agrupados.')) return;
  try {
    const { error } = await sb.from('catalogo_categorias').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Categoría eliminada');
    await cargarTabCategorias();
    await cargarTabProductos();
  } catch (e) { console.error('eliminarCategoria:', e); showToast('No se pudo eliminar', 'error'); }
}

function poblarSelectorCategorias(categoriaIdActual) {
  const sel = document.getElementById('cp-categoria-id');
  sel.innerHTML = '<option value="">Sin categoría (aparece directo)</option>' +
    STATE.categorias.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  sel.value = categoriaIdActual || '';
}

/* ---------- TAB: PRODUCTOS ---------- */
async function cargarTabProductos() {
  try {
    const { data: productos } = await sb.from('catalogo_productos').select('*')
      .eq('catalogo_id', STATE.catalogoActual.id).order('orden').order('created_at');
    const ids = (productos || []).map(p => p.id);
    let fotosPorProducto = {};
    if (ids.length) {
      const { data: fotos } = await sb.from('catalogo_producto_fotos').select('*')
        .in('catalogo_producto_id', ids).order('orden');
      (fotos || []).forEach(f => {
        (fotosPorProducto[f.catalogo_producto_id] ||= []).push(f);
      });
    }
    STATE.productosActual = (productos || []).map(p => ({ ...p, fotos: fotosPorProducto[p.id] || [] }));
  } catch (e) { STATE.productosActual = []; }
  renderTabProductos();
  renderTabCategorias();
}

function renderTabProductos() {
  const contador = document.getElementById('c360-productos-contador');
  contador.textContent = `${STATE.productosActual.length} / ${STATE.limites.productos_por_catalogo_max} productos`;

  const cont = document.getElementById('c360-lista-productos');
  if (!STATE.productosActual.length) {
    cont.innerHTML = `<p style="color:var(--text-muted);font-size:13px;grid-column:1/-1">Todavía no has agregado productos a este catálogo.</p>`;
    return;
  }
  cont.innerHTML = STATE.productosActual.map(p => {
    const principal = p.fotos.find(f => f.es_principal) || p.fotos[0];
    const etiquetas = { nuevo: {texto:'🆕 Nuevo', color:'#3b82f6'}, oferta: {texto:'🔥 Oferta', color:'#ef4444'}, agotado: {texto:'⛔ Agotado', color:'#6b7280'} };
    const et = etiquetas[p.etiqueta];
    return `
    <div class="c360-card-producto" style="position:relative">
      ${p.destacado ? `<span style="position:absolute;top:8px;left:8px;background:#f59e0b;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;z-index:1">⭐ Destacado</span>` : ''}
      ${et ? `<span style="position:absolute;top:8px;right:8px;background:${et.color};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;z-index:1">${et.texto}</span>` : ''}
      ${principal ? `<img src="${esc(principal.url)}" alt="">` : `<div style="height:130px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;background:var(--bg-app)">Sin foto</div>`}
      <div style="padding:10px 12px">
        <div style="font-weight:700;font-size:13.5px">${esc(p.nombre)}</div>
        <div style="margin-top:2px">
          ${p.etiqueta==='oferta' && p.precio_oferta ? `<span style="font-family:var(--font-mono);color:var(--text-muted);text-decoration:line-through;font-size:11.5px;margin-right:6px">${fmtC(p.precio)}</span><span style="font-family:var(--font-mono);color:#ef4444;font-weight:700;font-size:13px">${fmtC(p.precio_oferta)}</span>` : `<span style="font-family:var(--font-mono);color:var(--accent);font-weight:700;font-size:13px">${fmtC(p.precio)}</span>`}
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn-secondary btn-sm" style="flex:1" onclick="abrirModalProductoCatalogo('${p.id}')">Editar</button>
          <button class="btn-icon btn-icon-danger" onclick="eliminarProductoCatalogo('${p.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function abrirModalProductoCatalogo(id) {
  document.getElementById('cp-error').textContent = '';
  document.getElementById('cp-fotos-lista').innerHTML = '';
  if (id) {
    const p = STATE.productosActual.find(x => x.id === id);
    if (!p) return;
    document.getElementById('cp-titulo').textContent = 'Editar producto';
    document.getElementById('cp-id').value = p.id;
    document.getElementById('cp-nombre').value = p.nombre;
    document.getElementById('cp-precio').value = p.precio;
    poblarSelectorCategorias(p.categoria_id);
    document.getElementById('cp-descripcion').value = p.descripcion || '';
    document.getElementById('cp-etiqueta').value = p.etiqueta || '';
    document.getElementById('cp-precio-oferta').value = p.precio_oferta || '';
    document.getElementById('cp-destacado').checked = !!p.destacado;
    onCambiarEtiquetaProducto();
    renderFotosEnModal(p.fotos);
    document.getElementById('cp-fotos-contador').textContent = `(${p.fotos.length}/${STATE.limites.fotos_por_producto_max})`;
    document.getElementById('cp-btn-agregar-foto').disabled = p.fotos.length >= STATE.limites.fotos_por_producto_max;
  } else {
    if (STATE.productosActual.length >= STATE.limites.productos_por_catalogo_max) {
      showToast(`Tu plan permite hasta ${STATE.limites.productos_por_catalogo_max} productos por catálogo.`, 'error');
      return;
    }
    document.getElementById('cp-titulo').textContent = 'Nuevo producto';
    document.getElementById('cp-id').value = '';
    document.getElementById('cp-nombre').value = '';
    document.getElementById('cp-precio').value = '';
    poblarSelectorCategorias(null);
    document.getElementById('cp-descripcion').value = '';
    document.getElementById('cp-etiqueta').value = '';
    document.getElementById('cp-precio-oferta').value = '';
    document.getElementById('cp-destacado').checked = false;
    onCambiarEtiquetaProducto();
    document.getElementById('cp-fotos-contador').textContent = `(0/${STATE.limites.fotos_por_producto_max})`;
    document.getElementById('cp-btn-agregar-foto').disabled = false;
  }
  openModal('modal-producto-catalogo');
}

function onCambiarEtiquetaProducto() {
  const esOferta = document.getElementById('cp-etiqueta').value === 'oferta';
  document.getElementById('cp-wrap-precio-oferta').style.display = esOferta ? '' : 'none';
}

function renderFotosEnModal(fotos) {
  document.getElementById('cp-fotos-lista').innerHTML = (fotos||[]).map(f => `
    <div style="position:relative">
      <img src="${esc(f.url)}" class="c360-foto-mini"/>
      <button onclick="eliminarFotoProducto('${f.id}')" title="Quitar" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--danger);color:#fff;border:none;font-size:11px;cursor:pointer;line-height:1">✕</button>
    </div>
  `).join('');
}

async function guardarProductoCatalogo() {
  const id = document.getElementById('cp-id').value;
  const nombre = document.getElementById('cp-nombre').value.trim();
  const precio = parseFloat(document.getElementById('cp-precio').value);
  const errEl = document.getElementById('cp-error');
  if (!nombre) { errEl.textContent = 'Escribe un nombre.'; return; }
  if (isNaN(precio) || precio < 0) { errEl.textContent = 'Escribe un precio válido.'; return; }
  const etiqueta = document.getElementById('cp-etiqueta').value || null;
  const precioOfertaTexto = document.getElementById('cp-precio-oferta').value;
  const precioOferta = etiqueta === 'oferta' && precioOfertaTexto ? parseFloat(precioOfertaTexto) : null;
  if (etiqueta === 'oferta' && (!precioOferta || precioOferta <= 0 || precioOferta >= precio)) {
    errEl.textContent = 'El precio de oferta debe ser mayor a 0 y menor al precio normal.';
    return;
  }
  errEl.textContent = '';

  const payload = {
    nombre, precio,
    categoria_id: document.getElementById('cp-categoria-id').value || null,
    descripcion: document.getElementById('cp-descripcion').value.trim() || null,
    etiqueta, precio_oferta: precioOferta,
    destacado: document.getElementById('cp-destacado').checked,
    updated_at: new Date().toISOString(),
  };

  try {
    if (id) {
      const { error } = await sb.from('catalogo_productos').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
      if (error) throw error;
    } else {
      const { error } = await sb.from('catalogo_productos').insert({
        ...payload, catalogo_id: STATE.catalogoActual.id, auth_user_id: STATE.userId,
      });
      if (error) throw error;
    }
    closeModal('modal-producto-catalogo');
    showToast('✅ Producto guardado');
    await cargarTabProductos();
  } catch (e) {
    errEl.textContent = e.message?.includes('row-level security') ? 'Alcanzaste el límite de productos de tu plan.' : 'No se pudo guardar, intenta de nuevo.';
  }
}

async function eliminarProductoCatalogo(id) {
  if (!confirm('¿Eliminar este producto del catálogo?')) return;
  try {
    const { error } = await sb.from('catalogo_productos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Producto eliminado');
    await cargarTabProductos();
  } catch (e) { console.error('eliminarProductoCatalogo:', e); showToast('No se pudo eliminar', 'error'); }
}

async function subirFotosProducto(archivos) {
  let idProducto = document.getElementById('cp-id').value;

  if (!idProducto) {
    const nombre = document.getElementById('cp-nombre').value.trim();
    const precio = parseFloat(document.getElementById('cp-precio').value);
    if (!nombre || isNaN(precio) || precio < 0) {
      showToast('Escribe primero el nombre y el precio del producto', 'error');
      return;
    }
    if (STATE.productosActual.length >= STATE.limites.productos_por_catalogo_max) {
      showToast(`Tu plan permite hasta ${STATE.limites.productos_por_catalogo_max} productos por catálogo.`, 'error');
      return;
    }
    try {
      const { data, error } = await sb.from('catalogo_productos').insert({
        catalogo_id: STATE.catalogoActual.id, auth_user_id: STATE.userId,
        nombre, precio,
        categoria_id: document.getElementById('cp-categoria-id').value || null,
        descripcion: document.getElementById('cp-descripcion').value.trim() || null,
      }).select().single();
      if (error) throw error;
      idProducto = data.id;
      document.getElementById('cp-id').value = idProducto;
      document.getElementById('cp-titulo').textContent = 'Editar producto';
      showToast('✅ Producto guardado, agregando foto…');
    } catch (e) {
      console.error('Guardado automático antes de subir foto:', e);
      showToast('No se pudo guardar el producto: ' + (e.message?.includes('row-level security') ? 'alcanzaste el límite de tu plan' : 'intenta de nuevo'), 'error');
      return;
    }
  }

  if (STATE.fotosSubiendo) return;
  STATE.fotosSubiendo = true;
  const btn = document.getElementById('cp-btn-agregar-foto');
  btn.disabled = true; btn.textContent = 'Subiendo…';

  try {
    for (const archivo of archivos) {
      const { data: existentes } = await sb.from('catalogo_producto_fotos').select('id').eq('catalogo_producto_id', idProducto);
      if ((existentes||[]).length >= STATE.limites.fotos_por_producto_max) {
        showToast(`Máximo ${STATE.limites.fotos_por_producto_max} fotos por producto en tu plan`, 'error');
        break;
      }
      const { blob, ancho, alto } = await comprimirImagen(archivo);
      const { url, ruta } = await subirImagenCatalogo(blob, `productos/${idProducto}`);
      const esPrincipal = (existentes||[]).length === 0;
      const { error: errorFoto } = await sb.from('catalogo_producto_fotos').insert({
        catalogo_producto_id: idProducto, auth_user_id: STATE.userId,
        storage_path: ruta, url, orden: (existentes||[]).length, es_principal: esPrincipal,
        ancho, alto, tamano_bytes: blob.size,
      });
      if (errorFoto) {
        console.error('Error al guardar la foto en la base de datos:', errorFoto);
        showToast('No se pudo guardar una foto: ' + (errorFoto.message?.includes('row-level security') ? 'alcanzaste el límite de tu plan' : 'intenta de nuevo'), 'error');
        break;
      }
    }
    const { data: fotosAhora } = await sb.from('catalogo_producto_fotos').select('*').eq('catalogo_producto_id', idProducto).order('orden');
    renderFotosEnModal(fotosAhora || []);
    document.getElementById('cp-fotos-contador').textContent = `(${(fotosAhora||[]).length}/${STATE.limites.fotos_por_producto_max})`;
    showToast('✅ Fotos agregadas');
    await cargarTabProductos();
  } catch (e) {
    console.error('subirFotosProducto:', e);
    showToast('No se pudieron subir todas las fotos', 'error');
  } finally {
    STATE.fotosSubiendo = false;
    btn.disabled = false; btn.textContent = '+ Agregar foto';
    document.getElementById('cp-fotos-input').value = '';
  }
}

async function eliminarFotoProducto(idFoto) {
  try {
    const { data: foto } = await sb.from('catalogo_producto_fotos').select('storage_path').eq('id', idFoto).maybeSingle();
    const { error } = await sb.from('catalogo_producto_fotos').delete().eq('id', idFoto).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    if (foto?.storage_path) await sb.storage.from('catalogo360').remove([foto.storage_path]);
    const idProducto = document.getElementById('cp-id').value;
    const { data: fotosAhora } = await sb.from('catalogo_producto_fotos').select('*').eq('catalogo_producto_id', idProducto).order('orden');
    renderFotosEnModal(fotosAhora || []);
    document.getElementById('cp-fotos-contador').textContent = `(${(fotosAhora||[]).length}/${STATE.limites.fotos_por_producto_max})`;
    await cargarTabProductos();
  } catch (e) { console.error('eliminarFotoProducto:', e); showToast('No se pudo quitar la foto', 'error'); }
}

/* ---------- IMPORTAR DESDE NEGOCIO360 ---------- */
async function abrirImportarDeNegocio360() {
  STATE.seleccionImportar = new Set();
  const mensaje = document.getElementById('ip-mensaje');
  const lista = document.getElementById('ip-lista');
  lista.innerHTML = 'Buscando tus productos…';
  openModal('modal-importar-productos');

  try {
    const { data } = await sb.from('productos').select('id, nombre, precio, categoria, descripcion')
      .eq('auth_user_id', STATE.userId).eq('activo', true).eq('tipo', 'producto').order('nombre');
    const yaAgregados = new Set(STATE.productosActual.filter(p => p.producto_id).map(p => p.producto_id));
    STATE.productosNegocio360 = (data || []).filter(p => !yaAgregados.has(p.id));

    if (!STATE.productosNegocio360.length) {
      mensaje.textContent = 'No encontramos productos disponibles para agregar (puede que ya estén todos en este catálogo).';
      lista.innerHTML = '';
      return;
    }
    mensaje.textContent = `Elige cuáles productos de tu inventario quieres mostrar en este catálogo:`;
    lista.innerHTML = STATE.productosNegocio360.map(p => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" onchange="toggleSeleccionImportar('${p.id}',this.checked)"/>
        <span style="flex:1">${esc(p.nombre)}</span>
        <span style="font-family:var(--font-mono);color:var(--text-muted)">${fmtC(p.precio)}</span>
      </label>
    `).join('');
  } catch (e) {
    mensaje.textContent = 'No se pudo cargar tu inventario, intenta de nuevo.';
    lista.innerHTML = '';
  }
}
function toggleSeleccionImportar(id, marcado) {
  if (marcado) STATE.seleccionImportar.add(id); else STATE.seleccionImportar.delete(id);
}
async function confirmarImportarProductos() {
  const seleccionados = STATE.productosNegocio360.filter(p => STATE.seleccionImportar.has(p.id));
  if (!seleccionados.length) { closeModal('modal-importar-productos'); return; }

  const espacioDisponible = STATE.limites.productos_por_catalogo_max - STATE.productosActual.length;
  if (seleccionados.length > espacioDisponible) {
    showToast(`Solo puedes agregar ${espacioDisponible} más (límite de tu plan)`, 'error');
    return;
  }
  try {
    const filas = seleccionados.map(p => ({
      catalogo_id: STATE.catalogoActual.id, auth_user_id: STATE.userId, producto_id: p.id,
      nombre: p.nombre, precio: p.precio, categoria: p.categoria, descripcion: p.descripcion,
    }));
    const { error } = await sb.from('catalogo_productos').insert(filas);
    if (error) throw error;
    closeModal('modal-importar-productos');
    showToast(`✅ ${seleccionados.length} producto(s) agregado(s)`);
    await cargarTabProductos();
  } catch (e) {
    showToast('No se pudieron agregar todos — revisa el límite de tu plan', 'error');
  }
}

/* ---------- PUBLICAR / QR / VISTA PREVIA ---------- */
async function publicarCatalogoActual() {
  if (!STATE.productosActual.length) {
    showToast('Agrega al menos un producto antes de publicar', 'error');
    return;
  }
  try {
    const { data: slug, error } = await sb.rpc('catalogo_publicar', { p_catalogo_id: STATE.catalogoActual.id });
    if (error) throw error;
    STATE.catalogoActual.slug_publico = slug;
    STATE.catalogoActual.estado = 'publicado';
    renderEstadoPublicacion();
    showToast('🚀 ¡Catálogo publicado!');
  } catch (e) {
    console.error('publicarCatalogoActual:', e);
    showToast('No se pudo publicar, intenta de nuevo', 'error');
  }
}

function urlPublicaActual() {
  return `${window.location.origin}/${archivoDePlantilla(STATE.catalogoActual.plantilla)}?c=${STATE.catalogoActual.slug_publico}`;
}
function verCatalogoPublicado() {
  window.open(urlPublicaActual(), '_blank');
}
function copiarEnlaceCatalogo() {
  navigator.clipboard?.writeText(urlPublicaActual());
  showToast('🔗 Enlace copiado');
}
function abrirVistaPrevia() {
  window.open(`${archivoDePlantilla(STATE.catalogoActual.plantilla)}?preview=${STATE.catalogoActual.id}`, '_blank');
}
function mostrarQR() {
  if (!STATE.catalogoActual.slug_publico) { showToast('Publica el catálogo primero', 'error'); return; }
  dibujarQRConDiseno();
  openModal('modal-qr-catalogo');
}

function dibujarQRConDiseno() {
  const cont = document.getElementById('qr-catalogo-canvas');
  if (typeof qrcode === 'undefined') {
    cont.innerHTML = 'No se pudo cargar el generador de QR. Recarga la página e intenta de nuevo.';
    return;
  }
  cont.innerHTML = 'Generando…';

  try {
    const qr = qrcode(0, 'M');
    qr.addData(urlPublicaActual());
    qr.make();

    const modulos = qr.getModuleCount();
    const c = STATE.catalogoActual;
    const titulo = c.nombre_comercial || c.nombre;
    const ancho = 340, alto = 460;
    const tamanoQR = 220;
    const celda = tamanoQR / modulos;

    const final = document.createElement('canvas');
    final.width = ancho; final.height = alto;
    const ctx = final.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, ancho-2, alto-2);

    ctx.fillStyle = c.color_acento || '#6366f1';
    ctx.fillRect(0, 0, ancho, 10);

    ctx.fillStyle = '#111827';
    ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ajustarTextoEnCanvas(ctx, titulo, ancho/2, 60, ancho - 40, 26);

    ctx.fillStyle = '#6b7280';
    ctx.font = '400 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Escanea para ver el catálogo', ancho/2, 92);

    const qrX = (ancho - tamanoQR) / 2, qrY = 115;
    ctx.fillStyle = '#111827';
    for (let r = 0; r < modulos; r++) {
      for (let cCol = 0; cCol < modulos; cCol++) {
        if (qr.isDark(r, cCol)) ctx.fillRect(qrX + cCol*celda, qrY + r*celda, celda+0.5, celda+0.5);
      }
    }

    ctx.fillStyle = '#9ca3af';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Creado con Catálogo360', ancho/2, alto - 20);

    cont.innerHTML = '';
    cont.appendChild(final);
    STATE._qrCanvasFinal = final;
  } catch (e) {
    console.error('dibujarQRConDiseno:', e);
    cont.textContent = 'No se pudo generar el QR';
  }
}

function ajustarTextoEnCanvas(ctx, texto, x, yInicial, anchoMax, salto) {
  const palabras = texto.split(' ');
  let linea = '', y = yInicial;
  for (const palabra of palabras) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > anchoMax && linea) {
      ctx.fillText(linea, x, y);
      linea = palabra; y += salto;
    } else { linea = prueba; }
  }
  ctx.fillText(linea, x, y);
}

function descargarQR() {
  const canvas = STATE._qrCanvasFinal;
  if (!canvas) { showToast('Espera a que se genere el QR', 'error'); return; }
  const link = document.createElement('a');
  link.download = `QR_${STATE.catalogoActual.nombre.replace(/[^\w\-]/g,'_')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('✅ QR descargado');
}
