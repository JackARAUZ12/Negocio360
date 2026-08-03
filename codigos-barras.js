/* =====================================================
   CODIGOS-BARRAS.JS — NEGOCIO360
   Módulo TOTALMENTE INDEPIENDIENTE: no lee ni escribe en productos,
   servicios, inventario, ventas ni ningún otro módulo. Su única
   función es crear, administrar e imprimir códigos de barras
   (Code 128) — nada más.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},

  codigos: [],
  search: '',
  page: 1,
  perPage: 15,

  codigoActual: null,   // registro abierto en Ver/Editar/Imprimir
  modoEdicion: false,
};

// Tamaños de etiqueta disponibles (preparado para agregar más adelante
// sin tocar el resto de la lógica de impresión).
const TAMANOS_ETIQUETA = {
  '25x15': { anchoMM: 25, altoMM: 15, label: '25 × 15 mm (mini, joyería/accesorios)' },
  '30x20': { anchoMM: 30, altoMM: 20, label: '30 × 20 mm (pequeña)' },
  '40x30': { anchoMM: 40, altoMM: 30, label: '40 × 30 mm (estándar, la más común)' },
  '50x25': { anchoMM: 50, altoMM: 25, label: '50 × 25 mm (rectangular, impresoras Zebra/DYMO)' },
  '60x40': { anchoMM: 60, altoMM: 40, label: '60 × 40 mm (grande)' },
  '100x50': { anchoMM: 100, altoMM: 50, label: '100 × 50 mm (tipo envío/caja)' },
};

/* =====================================================
   HELPERS
===================================================== */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-NI', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtNum(v) { return Number(v || 0).toLocaleString('es-NI'); }

// Solo letras, números, guiones, guion bajo y espacios — lo que
// cualquier lector Code 128 estándar puede leer sin problema, y evita
// caracteres que rompan el SVG/PDF generado.
function codigoValido(c) {
  return /^[A-Za-z0-9\- _]{3,40}$/.test((c || '').trim());
}

/* =====================================================
   THEME / SIDEBAR / NAV (idéntico al resto del sistema)
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

/* =====================================================
   CONFIG EMPRESA / PERFIL / ADMIN (idéntico al resto del sistema)
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbClient.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || data.nombre || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      if (data.color_principal || data.color_primario) {
        const col = data.color_principal || data.color_primario;
        document.documentElement.style.setProperty('--accent', col);
        document.documentElement.style.setProperty('--accent-soft', col + '22');
        document.documentElement.style.setProperty('--border-focus', col);
      }
      if (data.logo_principal_url || data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_principal_url || data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sbClient.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { console.warn('loadUserProfile:', e); return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const biz  = STATE.empresaConfig?.nombre_comercial || 'Mi negocio';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hBiz  = document.getElementById('header-biz');  if (hBiz)  hBiz.textContent  = biz;
  const hAv   = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name || 'U')[0].toUpperCase();
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sbClient.from('administradores').select('email, activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const nav = document.getElementById('nav-admin'); if (nav) nav.style.display = 'flex'; }
  } catch (e) { /* silencioso */ }
}

/* =====================================================
   CARGA / TABLA / BÚSQUEDA
===================================================== */
async function cargarCodigos() {
  const tbody = document.getElementById('cb-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Cargando códigos…</td></tr>`;
  try {
    const { data, error } = await sbClient.from('codigos_barras').select('*')
      .eq('auth_user_id', STATE.userId).order('created_at', { ascending:false });
    if (error) throw error;
    STATE.codigos = data || [];
    STATE.page = 1;
    renderTablaCodigos();
    renderKPIsCodigos();
  } catch (e) {
    console.error('cargarCodigos:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No se pudieron cargar los códigos</td></tr>`;
  }
}

function codigosFiltrados() {
  const q = STATE.search.toLowerCase().trim();
  if (!q) return STATE.codigos;
  return STATE.codigos.filter(c =>
    (c.nombre||'').toLowerCase().includes(q) || (c.codigo||'').toLowerCase().includes(q)
  );
}

function renderTablaCodigos() {
  const tbody = document.getElementById('cb-tbody');
  if (!tbody) return;
  const filtrados = codigosFiltrados();
  const totalPag = Math.max(1, Math.ceil(filtrados.length / STATE.perPage));
  STATE.page = Math.min(STATE.page, totalPag);
  const inicio = (STATE.page-1)*STATE.perPage;
  const pagina = filtrados.slice(inicio, inicio+STATE.perPage);

  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">${STATE.codigos.length ? 'No hay resultados para esta búsqueda' : 'Todavía no has creado ningún código de barras'}</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(c => `
      <tr>
        <td style="font-weight:500">${esc(c.nombre)}</td>
        <td style="font-family:var(--font-mono);font-weight:600;color:var(--accent)">${esc(c.codigo)}</td>
        <td><span class="status-badge badge-activo">CODE 128</span></td>
        <td>${fmtFechaHora(c.created_at)}</td>
        <td class="td-actions">
          <button class="btn-icon" title="Ver" onclick="verCodigo('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="btn-icon" title="Editar" onclick="abrirEditarCodigo('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>
          <button class="btn-icon" title="Imprimir" onclick="abrirImprimirCodigo('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
          <button class="btn-icon" title="Descargar" onclick="descargarCodigo('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="confirmarEliminarCodigo('${c.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`).join('');
  }

  const info = document.getElementById('paginacion-info');
  if (info) info.textContent = filtrados.length ? `${inicio+1}–${Math.min(inicio+STATE.perPage,filtrados.length)} de ${filtrados.length}` : '—';
  const prev = document.getElementById('btn-pag-prev'); if (prev) prev.disabled = STATE.page<=1;
  const next = document.getElementById('btn-pag-next'); if (next) next.disabled = STATE.page>=totalPag;
}
function buscarCodigos() { STATE.search = document.getElementById('cb-search')?.value || ''; STATE.page = 1; renderTablaCodigos(); }
function paginaAnterior() { if (STATE.page>1) { STATE.page--; renderTablaCodigos(); } }
function paginaSiguiente() { STATE.page++; renderTablaCodigos(); }

function renderKPIsCodigos() {
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const esteMes = STATE.codigos.filter(c => new Date(c.created_at) >= inicioMes).length;
  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('kpi-total', fmtNum(STATE.codigos.length));
  set('kpi-mes', fmtNum(esteMes));
}

/* =====================================================
   NUEVO / EDITAR
===================================================== */
function abrirNuevoCodigo() {
  STATE.codigoActual = null;
  STATE.modoEdicion = false;
  document.getElementById('cb-modal-title').textContent = 'Nuevo código de barras';
  document.getElementById('cb-id').value = '';
  document.getElementById('cb-nombre').value = '';
  document.getElementById('cb-codigo').value = '';
  document.getElementById('cb-codigo').disabled = false;
  document.getElementById('cb-btn-generar').style.display = '';
  document.getElementById('cb-error').textContent = '';
  document.getElementById('cb-preview-wrap').style.display = 'none';
  openModal('modal-codigo');
}

function abrirEditarCodigo(id) {
  const c = STATE.codigos.find(x => x.id === id);
  if (!c) return;
  STATE.codigoActual = c;
  STATE.modoEdicion = true;
  document.getElementById('cb-modal-title').textContent = `Editar — ${c.nombre}`;
  document.getElementById('cb-id').value = c.id;
  document.getElementById('cb-nombre').value = c.nombre;
  document.getElementById('cb-codigo').value = c.codigo;
  // "Editar únicamente la información del registro": el código en sí
  // (lo que ya está impreso/pegado en algún lado) no se puede tocar.
  document.getElementById('cb-codigo').disabled = true;
  document.getElementById('cb-btn-generar').style.display = 'none';
  document.getElementById('cb-error').textContent = '';
  renderPreviewCodigo(c.codigo, 'cb-preview-svg');
  document.getElementById('cb-preview-wrap').style.display = '';
  openModal('modal-codigo');
}

async function generarCodigoAutomatico() {
  try {
    const { data, error } = await sbClient.rpc('generar_codigo_barras_auto', { p_user_id: STATE.userId });
    if (error) throw error;
    document.getElementById('cb-codigo').value = data;
    renderPreviewCodigo(data, 'cb-preview-svg');
    document.getElementById('cb-preview-wrap').style.display = '';
  } catch (e) {
    console.error('generarCodigoAutomatico:', e);
    showToast('No se pudo generar el código automático', 'error');
  }
}

function renderPreviewCodigo(codigo, svgId) {
  try {
    JsBarcode(`#${svgId}`, codigo, { format: 'CODE128', width: 2, height: 60, displayValue: true, margin: 8, fontSize: 14 });
  } catch (e) { console.warn('No se pudo dibujar el código:', e); }
}

async function guardarCodigo() {
  const errEl = document.getElementById('cb-error');
  errEl.textContent = '';
  const nombre = document.getElementById('cb-nombre').value.trim();
  const codigo = document.getElementById('cb-codigo').value.trim();

  if (!nombre) { errEl.textContent = 'El nombre o descripción es obligatorio.'; return; }
  if (!codigo) { errEl.textContent = 'Escribe un código o genera uno automático.'; return; }
  if (!STATE.modoEdicion && !codigoValido(codigo)) {
    errEl.textContent = 'El código solo puede tener letras, números, espacios y guiones (3 a 40 caracteres).';
    return;
  }

  setBtnLoading('btn-guardar-codigo', true);
  try {
    if (STATE.modoEdicion) {
      // Solo se actualiza la información (nombre) — el código nunca cambia al editar.
      const { error } = await sbClient.from('codigos_barras')
        .update({ nombre, updated_at: new Date().toISOString() })
        .eq('id', STATE.codigoActual.id).eq('auth_user_id', STATE.userId);
      if (error) throw error;
      showToast('Código actualizado');
    } else {
      const { error } = await sbClient.from('codigos_barras').insert({
        auth_user_id: STATE.userId, nombre, codigo, tipo: 'code128',
      });
      if (error) {
        if (error.code === '23505') throw new Error('Ese código ya existe — no se permiten duplicados.');
        throw error;
      }
      showToast('Código de barras creado');
    }
    closeModal('modal-codigo');
    await cargarCodigos();
  } catch (e) {
    console.error('guardarCodigo:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message||'');
  } finally {
    setBtnLoading('btn-guardar-codigo', false);
  }
}

/* =====================================================
   VER DETALLE
===================================================== */
function verCodigo(id) {
  const c = STATE.codigos.find(x => x.id === id);
  if (!c) return;
  STATE.codigoActual = c;
  document.getElementById('ver-codigo-nombre').textContent = c.nombre;
  document.getElementById('ver-codigo-fecha').textContent = fmtFechaHora(c.created_at);
  renderPreviewCodigo(c.codigo, 'ver-codigo-svg');
  openModal('modal-ver-codigo');
}

/* =====================================================
   DESCARGAR (imagen PNG del código)
===================================================== */
function svgAPngDataUrl(svgEl, callback) {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const escala = 3; // más nitidez para imprimir/pegar
    canvas.width = img.width * escala;
    canvas.height = img.height * escala;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    // Se devuelve también el ancho/alto reales de la imagen — sin esto,
    // el PDF de etiquetas forzaba el código a un tamaño fijo sin
    // respetar su proporción real, y en códigos largos terminaba
    // "cortado" (las barras de más a la derecha quedaban fuera del
    // recuadro visible de la etiqueta).
    callback(canvas.toDataURL('image/png'), { width: img.width, height: img.height });
  };
  img.src = url;
}

function descargarCodigo(id) {
  const c = STATE.codigos.find(x => x.id === id);
  if (!c) return;
  STATE.codigoActual = c;
  descargarCodigoActual();
}
function descargarCodigoActual() {
  const c = STATE.codigoActual;
  if (!c) return;
  const svgTmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgTmp.id = 'tmp-download-svg';
  document.body.appendChild(svgTmp);
  try {
    JsBarcode(svgTmp, c.codigo, { format: 'CODE128', width: 2, height: 70, displayValue: true, margin: 10, fontSize: 16 });
    svgAPngDataUrl(svgTmp, (dataUrl) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `Codigo_${(c.nombre||c.codigo).replace(/[^\w\-]/g,'_')}.png`;
      a.click();
      document.body.removeChild(svgTmp);
    });
  } catch (e) {
    console.error('descargarCodigoActual:', e);
    showToast('No se pudo descargar el código', 'error');
    document.body.removeChild(svgTmp);
  }
}

/* =====================================================
   IMPRIMIR ETIQUETAS (PDF, 40x30mm, N copias)
===================================================== */
function abrirImprimirCodigo(id) {
  const c = STATE.codigos.find(x => x.id === id);
  if (!c) return;
  STATE.codigoActual = c;
  document.getElementById('imp-codigo-nombre').textContent = `${c.nombre} — ${c.codigo}`;
  document.getElementById('imp-cantidad').value = 1;
  document.getElementById('imp-error').textContent = '';
  openModal('modal-imprimir-codigo');
}
function abrirImprimirDesdeVer() {
  const c = STATE.codigoActual;
  closeModal('modal-ver-codigo');
  if (c) abrirImprimirCodigo(c.id);
}

async function generarPDFEtiquetas() {
  const errEl = document.getElementById('imp-error');
  errEl.textContent = '';
  const c = STATE.codigoActual;
  if (!c) return;

  const tamanoKey = document.getElementById('imp-tamano').value;
  const tamano = TAMANOS_ETIQUETA[tamanoKey];
  const cantidad = parseInt(document.getElementById('imp-cantidad').value, 10);
  if (!tamano) { errEl.textContent = 'Selecciona un tamaño de etiqueta válido.'; return; }
  if (!cantidad || cantidad < 1 || cantidad > 200) { errEl.textContent = 'La cantidad debe ser entre 1 y 200.'; return; }

  try {
    // Generar la imagen del código UNA sola vez y reutilizarla en todas las copias.
    const svgTmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgTmp.id = 'tmp-pdf-svg';
    document.body.appendChild(svgTmp);
    JsBarcode(svgTmp, c.codigo, { format: 'CODE128', width: 1.4, height: 34, displayValue: false, margin: 0 });

    const { dataUrl, dimensiones } = await new Promise((resolve, reject) => {
      svgAPngDataUrl(svgTmp, (url, dim) => resolve({ dataUrl: url, dimensiones: dim }));
      setTimeout(() => reject(new Error('Tiempo de espera agotado generando la imagen')), 5000);
    });
    document.body.removeChild(svgTmp);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: [tamano.anchoMM, tamano.altoMM] });

    for (let i = 0; i < cantidad; i++) {
      if (i > 0) doc.addPage([tamano.anchoMM, tamano.altoMM]);
      dibujarEtiqueta(doc, tamano, c, dataUrl, dimensiones);
    }

    doc.save(`Etiquetas_${(c.nombre||c.codigo).replace(/[^\w\-]/g,'_')}.pdf`);
    closeModal('modal-imprimir-codigo');
    showToast(`PDF generado con ${cantidad} etiqueta${cantidad===1?'':'s'}`);
  } catch (e) {
    console.error('generarPDFEtiquetas:', e);
    errEl.textContent = 'No se pudo generar el PDF: ' + (e.message||'');
  }
}

function dibujarEtiqueta(doc, tamano, c, dataUrlBarcode, dimensionesImg) {
  const W = tamano.anchoMM, H = tamano.altoMM;
  doc.setDrawColor(200,200,200);
  doc.rect(0.5, 0.5, W-1, H-1); // guía de corte, tenue

  const margenLat = Math.max(1.5, W * 0.05); // margen lateral proporcional al tamaño de la etiqueta
  const anchoUtil = W - margenLat * 2;

  // Nombre del producto arriba — se ajusta al ancho útil, máximo 2 líneas
  doc.setFontSize(Math.min(6.5, W / 6)); doc.setFont(undefined, 'bold'); doc.setTextColor(20,20,30);
  const nombreLineas = doc.splitTextToSize(c.nombre || '', anchoUtil);
  let y = H * 0.14 + 1;
  const lineHeight = Math.max(2.2, H * 0.11);
  nombreLineas.slice(0, 2).forEach(ln => { doc.text(ln, W/2, y, { align: 'center' }); y += lineHeight; });

  // Espacio reservado abajo para el texto del código (nunca se solapa
  // ni se recorta, aunque el código sea largo).
  doc.setFontSize(Math.min(6, W / 7));
  const codigoTexto = String(c.codigo || '');
  const alturaTextoCodigo = 3.2;

  // Imagen del código: se calcula su proporción REAL (ancho/alto de la
  // imagen generada) y se ajusta ("contain") dentro del espacio
  // disponible, sin forzarla nunca a un tamaño fijo — así nunca queda
  // ni estirada ni cortada, sin importar cuántos dígitos tenga el código
  // ni el tamaño de etiqueta elegido.
  const espacioDisponibleAlto = Math.max(6, H - y - alturaTextoCodigo - 2);
  const espacioDisponibleAncho = anchoUtil;
  let imgAnchoMM = espacioDisponibleAncho;
  let imgAltoMM = espacioDisponibleAlto;
  if (dimensionesImg && dimensionesImg.width && dimensionesImg.height) {
    const ratioImg = dimensionesImg.width / dimensionesImg.height;
    const ratioDisponible = espacioDisponibleAncho / espacioDisponibleAlto;
    if (ratioImg > ratioDisponible) {
      // La imagen es proporcionalmente más ancha que el espacio: se
      // limita por el ancho, y la altura se reduce en la misma proporción.
      imgAnchoMM = espacioDisponibleAncho;
      imgAltoMM = imgAnchoMM / ratioImg;
    } else {
      // Se limita por la altura disponible.
      imgAltoMM = espacioDisponibleAlto;
      imgAnchoMM = imgAltoMM * ratioImg;
    }
  }
  const imgX = (W - imgAnchoMM) / 2;
  const imgY = y + (espacioDisponibleAlto - imgAltoMM) / 2;
  doc.addImage(dataUrlBarcode, 'PNG', imgX, imgY, imgAnchoMM, imgAltoMM);

  // Código en texto, siempre dentro del ancho útil — si es largo, se
  // reduce el tamaño de letra automáticamente en vez de recortarlo.
  doc.setFont(undefined, 'normal');
  let fs = Math.min(6, W / 7);
  doc.setFontSize(fs);
  while (doc.getTextWidth(codigoTexto) > anchoUtil && fs > 3) {
    fs -= 0.3;
    doc.setFontSize(fs);
  }
  doc.text(codigoTexto, W/2, H - 1.8, { align: 'center', maxWidth: anchoUtil });
}

/* =====================================================
   ELIMINAR
===================================================== */
function confirmarEliminarCodigo(id) {
  const c = STATE.codigos.find(x => x.id === id);
  if (!c) return;
  STATE.codigoActual = c;
  openModal('modal-confirmar-eliminar-cb');
}
async function eliminarCodigo() {
  const c = STATE.codigoActual;
  if (!c) return;
  setBtnLoading('btn-confirmar-eliminar-cb', true);
  try {
    const { error } = await sbClient.from('codigos_barras').delete().eq('id', c.id).eq('auth_user_id', STATE.userId);
    if (error) throw error;
    showToast('Código eliminado');
    closeModal('modal-confirmar-eliminar-cb');
    await cargarCodigos();
  } catch (e) {
    console.error('eliminarCodigo:', e);
    showToast('Error al eliminar: ' + (e.message||''), 'error');
  } finally {
    setBtnLoading('btn-confirmar-eliminar-cb', false);
  }
}

/* =====================================================
   MODAL / TOAST / UI HELPERS (idénticos al resto del sistema)
===================================================== */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; }
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) { e.target.style.display='none'; document.body.style.overflow=''; }
});
function showToast(msg, type='success') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type} toast-show`;
  clearTimeout(el._timer); el._timer = setTimeout(()=>el.classList.remove('toast-show'), 3500);
}
function setBtnLoading(id, loading) {
  const el = document.getElementById(id); if (!el) return;
  el.disabled = loading; el.style.opacity = loading ? '0.6' : '1';
}

/* =====================================================
   INIT
===================================================== */
async function initCodigosBarras() {
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id; STATE.userEmail = user.email;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarCodigos();
  } catch (err) {
    console.error('initCodigosBarras:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initCodigosBarras();
  if (window.lucide) lucide.createIcons();
});
