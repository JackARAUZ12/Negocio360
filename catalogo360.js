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
  const nombresPlan = { basico:'Básico', profesional:'Profesional', premium:'Premium' };
  const planEl = document.getElementById('c360-plan-nombre');
  if (planEl) planEl.textContent = nombresPlan[STATE.limites.plan_key] || STATE.limites.plan_key;
  const fotosEl = document.getElementById('c360-uso-fotos');
  if (fotosEl) fotosEl.textContent = `Hasta ${STATE.limites.fotos_por_producto_max}`;
}

/* =====================================================
   LISTA DE CATÁLOGOS
===================================================== */
async function cargarListaCatalogos() {
  try {
    const { data } = await sb.from('catalogos').select('*').eq('auth_user_id', STATE.userId).order('created_at', { ascending:false });
    STATE.catalogos = data || [];
  } catch (e) { STATE.catalogos = []; }

  const catEl = document.getElementById('c360-uso-catalogos');
  if (catEl) catEl.textContent = `${STATE.catalogos.length} / ${STATE.limites.catalogos_max}`;

  const onboarding = document.getElementById('c360-onboarding');
  const grid = document.getElementById('c360-grid-catalogos');
  const btnCrear = document.getElementById('c360-btn-crear');

  if (!STATE.catalogos.length) {
    onboarding.style.display = 'block';
    grid.innerHTML = '';
  } else {
    onboarding.style.display = 'none';
    grid.innerHTML = STATE.catalogos.map(c => `
      <div class="c360-card-catalogo" onclick="abrirEditorCatalogo('${c.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="font-weight:700;font-size:15px">${esc(c.nombre)}</div>
          <span class="c360-badge ${c.estado}">${c.estado === 'publicado' ? 'Publicado' : c.estado === 'pausado' ? 'Pausado' : 'Borrador'}</span>
        </div>
        <div style="font-size:12.5px;color:var(--text-muted);margin-top:6px">${esc(c.nombre_comercial || 'Sin nombre comercial todavía')}</div>
      </div>
    `).join('');
  }
  if (btnCrear) btnCrear.disabled = STATE.catalogos.length >= STATE.limites.catalogos_max;
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
    await sb.from('catalogos').update({ logo_url: url, updated_at: new Date().toISOString() }).eq('id', STATE.catalogoActual.id);
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
    await sb.from('catalogos').update(payload).eq('id', STATE.catalogoActual.id).eq('auth_user_id', STATE.userId);
    Object.assign(STATE.catalogoActual, payload);
    showToast('✅ Información guardada');
  } catch (e) { showToast('No se pudo guardar', 'error'); }
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
    await sb.from('catalogos').update(payload).eq('id', STATE.catalogoActual.id).eq('auth_user_id', STATE.userId);
    Object.assign(STATE.catalogoActual, payload);
    showToast('✅ Apariencia guardada');
  } catch (e) { showToast('No se pudo guardar', 'error'); }
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
      await sb.from('catalogo_productos').update(payload).eq('id', id).eq('auth_user_id', STATE.userId);
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
    await sb.from('catalogo_productos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    showToast('Producto eliminado');
    await cargarTabProductos();
  } catch (e) { showToast('No se pudo eliminar', 'error'); }
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
      await sb.from('catalogo_producto_fotos').insert({
        catalogo_producto_id: idProducto, auth_user_id: STATE.userId,
        storage_path: ruta, url, orden: (existentes||[]).length, es_principal: esPrincipal,
        ancho, alto, tamano_bytes: blob.size,
      });
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
    await sb.from('catalogo_producto_fotos').delete().eq('id', idFoto).eq('auth_user_id', STATE.userId);
    if (foto?.storage_path) await sb.storage.from('catalogo360').remove([foto.storage_path]);
    const idProducto = document.getElementById('cp-id').value;
    const { data: fotosAhora } = await sb.from('catalogo_producto_fotos').select('*').eq('catalogo_producto_id', idProducto).order('orden');
    renderFotosEnModal(fotosAhora || []);
    document.getElementById('cp-fotos-contador').textContent = `(${(fotosAhora||[]).length}/${STATE.limites.fotos_por_producto_max})`;
    await cargarTabProductos();
  } catch (e) { showToast('No se pudo quitar la foto', 'error'); }
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
  if (STATE.catalogoActual.slug_publico) window.open(urlPublicaActual(), '_blank');
  else showToast('Publica el catálogo primero para ver la vista previa real', 'error');
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
