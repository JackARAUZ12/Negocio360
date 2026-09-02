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
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  setTimeout(() => t.classList.remove('show'), 3200);
}

/* =====================================================
   COMPRESIÓN DE IMÁGENES — nunca se sube una foto sin comprimir.
   Se reduce a un ancho máximo razonable para catálogo (1200px) y se
   convierte a WebP con buena calidad -- esto baja el peso real de
   una foto de celular (3-8MB) a normalmente menos de 200KB, sin que
   se note la diferencia visual en un catálogo.
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

// Sube una imagen YA comprimida al bucket catalogo360, dentro de la
// carpeta del usuario (obligatorio para que la política de Storage
// permita la escritura) -- devuelve la URL pública final.
async function subirImagenCatalogo(blob, carpeta) {
  const nombreArchivo = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.webp`;
  const ruta = `${STATE.userId}/${carpeta}/${nombreArchivo}`;
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
   DASHBOARD PRINCIPAL — todo con datos reales: nada de numeros
   inventados. Las metricas de visitas/clics vienen de
   catalogo_eventos (registrado de verdad desde c360.html); lo demas
   se calcula en vivo desde los catalogos/productos/fotos reales.
===================================================== */
async function cargarListaCatalogos() {
  try {
    const { data } = await sb.from('catalogos').select('*').eq('auth_user_id', STATE.userId).order('created_at', { ascending:false });
    STATE.catalogos = data || [];
  } catch (e) { STATE.catalogos = []; }

  // Saludo con el nombre real del negocio
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

  // Visitas reales del mes (desde catalogo_eventos, vía RPC)
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
  let visitasMes = 0;
  let visitasPorCatalogo = {};
  try {
    const { data: resumen } = await sb.rpc('catalogo_resumen_eventos', { p_auth_user_id: STATE.userId, p_desde: inicioMes.toISOString() });
    visitasMes = (resumen || []).find(r => r.tipo_evento === 'visita')?.total || 0;
    const { data: visitasCat } = await sb.rpc('catalogo_visitas_por_catalogo', { p_auth_user_id: STATE.userId });
    (visitasCat || []).forEach(v => { visitasPorCatalogo[v.catalogo_id] = v.visitas; });
  } catch (e) { /* best-effort, nunca bloquea el dashboard */ }

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
  // Actividad REAL derivada de fechas ya existentes -- catalogos
  // creados/actualizados + productos agregados. Nunca inventada.
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
  const catalogoObjetivo = STATE.catalogos[0]; // el mas reciente
  if (tipo === 'producto') { abrirEditorCatalogo(catalogoObjetivo.id).then(() => { cambiarTabEditor('productos'); abrirModalProductoCatalogo(); }); }
  else if (tipo === 'fotos') { abrirEditorCatalogo(catalogoObjetivo.id).then(() => cambiarTabEditor('productos')); }
  else if (tipo === 'ver') {
    if (catalogoObjetivo.slug_publico && catalogoObjetivo.estado === 'publicado') window.open(`c360.html?c=${catalogoObjetivo.slug_publico}`, '_blank');
    else window.open(`c360.html?preview=${catalogoObjetivo.id}`, '_blank');
  }
  else if (tipo === 'compartir') {
    if (catalogoObjetivo.slug_publico) { navigator.clipboard?.writeText(`${window.location.origin}/c360.html?c=${catalogoObjetivo.slug_publico}`); showToast('🔗 Enlace copiado'); }
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
  await cargarTabProductos();
}

function renderEstadoPublicacion() {
  const c = STATE.catalogoActual;
  const estadoTexto = document.getElementById('c360-editor-estado-texto');
  const panel = document.getElementById('c360-panel-publicado');
  const btnPublicar = document.getElementById('c360-btn-publicar');

  if (c.estado === 'publicado' && c.slug_publico) {
    estadoTexto.textContent = 'Publicado y visible al público.';
    panel.style.display = 'block';
    const url = `${window.location.origin}/c360.html?c=${c.slug_publico}`;
    document.getElementById('c360-url-publica').textContent = url;
    btnPublicar.textContent = '🔄 Actualizar publicación';
  } else {
    estadoTexto.textContent = 'Todavía en borrador — nadie más puede verlo hasta que lo publiques.';
    panel.style.display = 'none';
    btnPublicar.textContent = '🚀 Publicar';
  }
}

function cambiarTabEditor(tab) {
  document.querySelectorAll('.c360-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['info','productos','apariencia'].forEach(t => {
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
  const logoImg = document.getElementById('c360-i-logo-preview');
  if (c.logo_url) { logoImg.src = c.logo_url; logoImg.style.display = 'block'; } else { logoImg.style.display = 'none'; }
}

async function subirLogoCatalogo(archivo) {
  if (!archivo) return;
  showToast('Subiendo logo…');
  try {
    const { blob, ancho, alto } = await comprimirImagen(archivo, 400, 0.85);
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

async function guardarInfoCatalogo() {
  const payload = {
    nombre_comercial: document.getElementById('c360-i-nombre-comercial').value.trim() || null,
    descripcion: document.getElementById('c360-i-descripcion').value.trim() || null,
    whatsapp: document.getElementById('c360-i-whatsapp').value.trim() || null,
    telefono: document.getElementById('c360-i-telefono').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  try {
    // BUG REAL CORREGIDO: Supabase NUNCA lanza una excepcion por un
    // error de base de datos -- devuelve { error } en la respuesta.
    // Antes no se revisaba esto, asi que un guardado fallido (ej. por
    // sesion vencida) igual mostraba "guardado" con exito, sin haber
    // guardado nada de verdad.
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
function cargarTabApariencia() {
  const c = STATE.catalogoActual;
  document.getElementById('c360-a-color').value = c.color_acento || '#6366f1';
  elegirTemaCatalogo(c.tema_default || 'claro', false);
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
    return `
    <div class="c360-card-producto">
      ${principal ? `<img src="${esc(principal.url)}" alt="">` : `<div style="height:130px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;background:var(--bg-app)">Sin foto</div>`}
      <div style="padding:10px 12px">
        <div style="font-weight:700;font-size:13.5px">${esc(p.nombre)}</div>
        <div style="font-family:var(--font-mono);color:var(--accent);font-weight:700;font-size:13px;margin-top:2px">${fmtC(p.precio)}</div>
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
    document.getElementById('cp-categoria').value = p.categoria || '';
    document.getElementById('cp-descripcion').value = p.descripcion || '';
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
    document.getElementById('cp-categoria').value = '';
    document.getElementById('cp-descripcion').value = '';
    document.getElementById('cp-fotos-contador').textContent = `(0/${STATE.limites.fotos_por_producto_max})`;
    document.getElementById('cp-btn-agregar-foto').disabled = false;
  }
  openModal('modal-producto-catalogo');
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
  errEl.textContent = '';

  const payload = {
    nombre, precio,
    categoria: document.getElementById('cp-categoria').value.trim() || null,
    descripcion: document.getElementById('cp-descripcion').value.trim() || null,
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
  const idProducto = document.getElementById('cp-id').value;
  if (!idProducto) { showToast('Guarda el producto primero antes de agregar fotos', 'error'); return; }
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
      // BUG REAL CORREGIDO: este insert nunca revisaba si Supabase
      // rechazaba la foto (ej. por el limite de fotos del plan,
      // aplicado tambien a nivel de base de datos) -- el codigo
      // seguia como si nada, y al final mostraba "Fotos agregadas"
      // aunque en realidad ninguna foto se hubiera guardado. Ahora se
      // revisa el error real de cada insert antes de seguir.
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
  return `${window.location.origin}/c360.html?c=${STATE.catalogoActual.slug_publico}`;
}
function copiarEnlaceCatalogo() {
  navigator.clipboard?.writeText(urlPublicaActual());
  showToast('🔗 Enlace copiado');
}
function abrirVistaPrevia() {
  // BUG REAL CORREGIDO: antes exigia estar publicado, lo cual no
  // tiene sentido -- la vista previa debe funcionar ANTES de publicar.
  // Ahora siempre se puede ver, usando el modo de vista previa del
  // dueño (requiere sesion, funciona sin importar el estado).
  window.open(`c360.html?preview=${STATE.catalogoActual.id}`, '_blank');
}
function mostrarQR() {
  if (!STATE.catalogoActual.slug_publico) { showToast('Publica el catálogo primero', 'error'); return; }
  const cont = document.getElementById('qr-catalogo-canvas');
  cont.innerHTML = '';
  QRCode.toCanvas(urlPublicaActual(), { width: 220, margin: 1 }, (err, canvas) => {
    if (err) { cont.textContent = 'No se pudo generar el QR'; return; }
    cont.appendChild(canvas);
  });
  openModal('modal-qr-catalogo');
}
function descargarQR() {
  const canvas = document.querySelector('#qr-catalogo-canvas canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `QR_${STATE.catalogoActual.nombre.replace(/[^\w\-]/g,'_')}.png`;
  link.href = canvas.toDataURL();
  link.click();
}

/* =====================================================
   MODAL DE MONEDA DE VISUALIZACIÓN — mismo patrón usado en todo el
   sistema (no afecta los precios propios del catálogo, solo cómo se
   muestran los montos internos de Negocio360 en esta página).
===================================================== */
function abrirModalMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  document.getElementById('mv-moneda-oficial').textContent = oficial;
  document.getElementById('mv-select-moneda').value = monedaVisualizacionActiva() || '';
  document.getElementById('mv-tasa').value = tasaVisualizacionActiva() || '';
  document.getElementById('mv-error').textContent = '';
  onCambiarSelectMonedaVis();
  document.getElementById('modal-moneda-vis').style.display = 'flex';
}
function onCambiarSelectMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  document.getElementById('mv-wrap-tasa').style.display = (elegida && elegida !== oficial) ? '' : 'none';
}
function guardarMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  const errEl = document.getElementById('mv-error');
  errEl.textContent = '';
  if (!elegida || elegida === oficial) {
    desactivarMonedaVisualizacion();
  } else {
    const tasa = parseFloat(document.getElementById('mv-tasa').value);
    if (!tasa || tasa <= 0) { errEl.textContent = 'Escribe tu tasa de cambio (cordobas por 1 dolar).'; return; }
    activarMonedaVisualizacion(elegida, tasa);
  }
  location.reload();
}
