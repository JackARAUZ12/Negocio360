/* =====================================================
   PERFIL.JS — NEGOCIO360
   Edición del perfil del negocio (fuera del asistente de bienvenida
   de personalizacion.html — este es para editar en cualquier momento).
   Guarda en la MISMA tabla configuracion_empresa que ya usa todo el
   sistema, así que cualquier cambio aquí se refleja de inmediato en
   el logo/color del menú de todos los módulos, y en nombre/logo de
   reportes y comprobantes — sin tocar la moneda (eso sigue siendo
   exclusivo de Configuración, nunca se edita desde aquí).
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let STATE = { userId: null, userEmail: null, empresaConfig: {}, currentUser: {} };
let logoFiles = { principal: null, alternativo: null };

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

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showToast(msg, type='success') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type} toast-show`;
  clearTimeout(el._timer); el._timer = setTimeout(()=>el.classList.remove('toast-show'), 3500);
}

/* =====================================================
   CONFIG EMPRESA / PERFIL / ADMIN (idéntico al resto del sistema,
   más la aplicación en vivo del logo/color en ESTA misma página)
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
   LLENAR EL FORMULARIO CON LO YA GUARDADO
===================================================== */
function llenarFormularioPerfil(c) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('pf-nombre-comercial', c.nombre_comercial);
  set('pf-razon-social', c.razon_social);
  set('pf-descripcion', c.descripcion);
  set('pf-vacaciones-dias-anio', c.vacaciones_dias_anio ?? 15);
  set('pf-indemnizacion-dias-anio', c.indemnizacion_dias_por_anio ?? 30);
  set('pf-pdf-mensaje-pie', c.pdf_mensaje_pie);
  const chkRuc = document.getElementById('pf-pdf-mostrar-ruc'); if (chkRuc) chkRuc.checked = c.pdf_mostrar_ruc !== false;
  const chkDir = document.getElementById('pf-pdf-mostrar-direccion'); if (chkDir) chkDir.checked = c.pdf_mostrar_direccion !== false;
  const chkTel = document.getElementById('pf-pdf-mostrar-telefono'); if (chkTel) chkTel.checked = c.pdf_mostrar_telefono !== false;
  set('pf-departamento', c.departamento);
  set('pf-ciudad', c.ciudad);
  set('pf-direccion', c.direccion);
  set('pf-whatsapp', c.whatsapp);
  set('pf-telefono', c.telefono);
  set('pf-email-empresa', c.email_empresa);
  set('pf-sitio-web', c.sitio_web);
  set('pf-facebook', c.facebook);
  set('pf-instagram', c.instagram);

  const colPrincipal  = c.color_principal  || c.color_primario || '#6C63FF';
  const colSecundario = c.color_secundario || '#3B82F6';
  const colAcento     = c.color_acento     || '#F59E0B';
  set('pf-color-principal', colPrincipal);  set('pf-hex-principal', colPrincipal);
  set('pf-color-secundario', colSecundario); set('pf-hex-secundario', colSecundario);
  set('pf-color-acento', colAcento);        set('pf-hex-acento', colAcento);

  const logoUrl = c.logo_principal_url || c.logo_url;
  if (logoUrl) {
    const zone = document.getElementById('pf-zone-logo-content');
    if (zone) zone.innerHTML = `<img src="${logoUrl}" class="pf-preview" alt="Logo actual">`;
  }
  if (c.logo_alternativo_url) {
    const zone2 = document.getElementById('pf-zone-logo2-content');
    if (zone2) zone2.innerHTML = `<img src="${c.logo_alternativo_url}" class="pf-preview" alt="Logo alterno actual">`;
  }
}

/* =====================================================
   COLOR PICKERS
===================================================== */
function pfSyncColor(colorId, hexId) {
  const val = document.getElementById(colorId).value;
  document.getElementById(hexId).value = val;
}
function pfSyncHex(hexId, colorId) {
  const val = document.getElementById(hexId).value;
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) document.getElementById(colorId).value = val;
}

/* =====================================================
   SUBIDA DE LOGOS (drag&drop + selector)
===================================================== */
function pfPreviewLogo(input, zoneId, key) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('La imagen no puede pesar más de 2MB', 'error'); return; }
  logoFiles[key] = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const zone = document.getElementById(zoneId + '-content');
    if (zone) zone.innerHTML = `<img src="${e.target.result}" class="pf-preview" alt="Preview">`;
  };
  reader.readAsDataURL(file);
}
function pfDragOver(e, zoneId) { e.preventDefault(); document.getElementById(zoneId)?.classList.add('dragging'); }
function pfDragLeave(zoneId) { document.getElementById(zoneId)?.classList.remove('dragging'); }
function pfDropFile(e, inputId, zoneId, key) {
  e.preventDefault();
  pfDragLeave(zoneId);
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    const input = document.getElementById(inputId);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    pfPreviewLogo(input, zoneId, key);
  }
}
async function uploadLogoPerfil(file, key) {
  if (!file || !STATE.userId) return { url: null, error: null };
  const ext = file.name.split('.').pop();
  const path = `${STATE.userId}/logo_${key}.${ext}`;
  const bucket = 'logos_empresa';
  await sbClient.storage.from(bucket).remove([path]);
  const { error } = await sbClient.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });
  if (error) {
    console.error(`Error subiendo logo ${key}:`, error.message);
    return { url: null, error: error.message };
  }
  const { data } = sbClient.storage.from(bucket).getPublicUrl(path);
  return { url: data?.publicUrl ?? null, error: null };
}

/* =====================================================
   GUARDAR PERFIL
===================================================== */
async function guardarPerfil() {
  const errEl = document.getElementById('pf-error');
  errEl.textContent = '';
  const nombreComercial = document.getElementById('pf-nombre-comercial')?.value.trim();
  if (!nombreComercial) { errEl.textContent = 'El nombre comercial es obligatorio.'; return; }

  const btn = document.getElementById('btn-guardar-perfil');
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Guardando…';

  try {
    // Subir logos solo si el usuario eligió uno nuevo — si no, se
    // conserva el que ya estaba guardado (nunca se borra sin querer).
    // Si la subida falla por CUALQUIER motivo, ahora se avisa
    // claramente en vez de guardar todo lo demás en silencio sin el
    // logo nuevo (eso hacía parecer que "no se guardaba" sin razón).
    const [resLogo, resLogoAlt] = await Promise.all([
      uploadLogoPerfil(logoFiles.principal, 'principal'),
      uploadLogoPerfil(logoFiles.alternativo, 'alternativo'),
    ]);
    if (logoFiles.principal && resLogo.error) {
      errEl.textContent = `El logo principal no se pudo subir: ${resLogo.error}. El resto de los cambios sí se guardó.`;
    }
    if (logoFiles.alternativo && resLogoAlt.error) {
      errEl.textContent = (errEl.textContent ? errEl.textContent + ' ' : '') + `El logo alternativo no se pudo subir: ${resLogoAlt.error}.`;
    }
    const logoUrl = resLogo.url, logoAltUrl = resLogoAlt.url;

    const g = id => document.getElementById(id)?.value.trim() || null;
    const payload = {
      auth_user_id: STATE.userId,
      nombre_comercial: nombreComercial,
      razon_social: g('pf-razon-social'),
      descripcion: g('pf-descripcion'),
      vacaciones_dias_anio: parseFloat(document.getElementById('pf-vacaciones-dias-anio')?.value) || 15,
      indemnizacion_dias_por_anio: parseFloat(document.getElementById('pf-indemnizacion-dias-anio')?.value) || 30,
      pdf_mensaje_pie: document.getElementById('pf-pdf-mensaje-pie')?.value.trim() || null,
      pdf_mostrar_ruc: document.getElementById('pf-pdf-mostrar-ruc')?.checked ?? true,
      pdf_mostrar_direccion: document.getElementById('pf-pdf-mostrar-direccion')?.checked ?? true,
      pdf_mostrar_telefono: document.getElementById('pf-pdf-mostrar-telefono')?.checked ?? true,
      departamento: g('pf-departamento'),
      ciudad: g('pf-ciudad'),
      direccion: g('pf-direccion'),
      whatsapp: g('pf-whatsapp'),
      telefono: g('pf-telefono'),
      email_empresa: g('pf-email-empresa'),
      sitio_web: g('pf-sitio-web'),
      facebook: g('pf-facebook'),
      instagram: g('pf-instagram'),
      color_principal: document.getElementById('pf-color-principal').value,
      color_secundario: document.getElementById('pf-color-secundario').value,
      color_acento: document.getElementById('pf-color-acento').value,
    };
    if (logoUrl) payload.logo_principal_url = logoUrl;
    if (logoAltUrl) payload.logo_alternativo_url = logoAltUrl;
    // NOTA: moneda, onboarding_step y onboarding_completado NUNCA se
    // tocan desde aquí a propósito — este formulario no los incluye.

    const { error } = await sbClient.from('configuracion_empresa').upsert(payload, { onConflict: 'auth_user_id' });
    if (error) throw error;

    showToast('✅ Perfil actualizado — los cambios ya se ven en todo el sistema');
    await loadEmpresaConfig(STATE.userId); // refresca el logo/color en esta misma página
    logoFiles = { principal: null, alternativo: null };
  } catch (e) {
    console.error('guardarPerfil:', e);
    errEl.textContent = 'Error al guardar: ' + (e.message || 'intenta de nuevo');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

/* =====================================================
   INIT
===================================================== */
async function initPerfil() {
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
    llenarFormularioPerfil(STATE.empresaConfig);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  } catch (err) {
    console.error('initPerfil:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initPerfil();
  if (window.lucide) lucide.createIcons();
});
