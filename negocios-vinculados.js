/* =====================================================
   NEGOCIOS-VINCULADOS.JS — NEGOCIO360
   Varios negocios bajo el MISMO correo y contraseña -- cada
   negocio es una cuenta Auth real e independiente por debajo
   (mismo mecanismo ya probado en produccion por Sucursales), solo
   que aqui no hay jerarquia Central/sucursal: son negocios
   completamente aparte, uno junto al otro.

   El negocio "principal" (la cuenta original de siempre) NO
   necesita ninguna fila en la base de datos hasta que la persona
   realmente cree un segundo negocio -- asi las cuentas que nunca
   usan esta funcion (la gran mayoria) no generan ningun dato
   nuevo de la nada.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// Cliente aparte, sin guardar sesion -- exclusivo para crear el
// negocio nuevo (signUp) sin tocar la sesion activa de quien esta
// usando el sistema ahora mismo. Mismo patron ya probado en
// Sucursales.
const sbAux = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'n360-negocio-aux', persistSession: false, autoRefreshToken: false },
});

let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},
  negocios: [], limiteNegocios: 1,
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function generarPasswordInterna() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'Sx_' + Array.from(bytes, b => b.toString(36).padStart(2,'0')).join('').slice(0, 32) + 'Aa1!';
}

/* =====================================================
   SHELL: TEMA, SIDEBAR, NAVEGACIÓN (idéntico al resto del sistema)
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
function setBtnLoading(id, loading) { const btn = document.getElementById(id); if (btn) { btn.disabled = loading; btn.style.opacity = loading ? '.6' : ''; } }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
    return data;
  } catch (e) { return null; }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    STATE.limiteNegocios = data?.limite_negocios || 1;
    return data;
  } catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hAv = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name||'U')[0].toUpperCase();
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;
    STATE.userEmail = user.email;

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarNegocios();
  } catch (e) {
    console.error('init negocios-vinculados:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* =====================================================
   CARGAR Y RENDERIZAR -- el negocio principal (la cuenta de
   siempre) se representa de forma "virtual" si nunca se ha creado
   ningun negocio adicional -- no necesita fila en la base de
   datos para eso.
===================================================== */
async function cargarNegocios() {
  try {
    const { data, error } = await sb.from('negocios_vinculados')
      .select('*').eq('auth_user_id_principal', STATE.userId).eq('activo', true).order('created_at');
    if (error) throw error;

    const vinculados = data || [];
    const yaTienePrincipalMaterializado = vinculados.some(n => n.es_principal);

    STATE.negocios = yaTienePrincipalMaterializado ? vinculados : [
      {
        id: null, es_principal: true,
        nombre_negocio: STATE.empresaConfig?.nombre_comercial || STATE.empresaConfig?.nombre_negocio || 'Mi negocio',
        auth_user_id_negocio: STATE.userId,
      },
      ...vinculados,
    ];
    renderNegocios();
  } catch (e) {
    console.error('cargarNegocios:', e);
    showToast('No se pudieron cargar tus negocios', 'error');
  }
}

function renderNegocios() {
  const cont = document.getElementById('neg-grid');
  cont.innerHTML = STATE.negocios.map(n => `
    <div class="hab-card ${n.es_principal ? 'neg-card-central' : ''}">
      <div class="hab-card-head">
        <div class="hab-card-titulo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
          ${esc(n.nombre_negocio)}
        </div>
        ${n.es_principal ? '<span class="neg-badge-principal">Principal</span>' : ''}
      </div>
      ${n.auth_user_id_negocio === STATE.userId
        ? `<button class="btn-secondary" style="width:100%" disabled>✅ Estás aquí</button>`
        : `<button class="btn-primary" style="width:100%" onclick="entrarANegocio('${n.id}')">Entrar a este negocio</button>`}
    </div>`).join('');
}

/* =====================================================
   AGREGAR NEGOCIO -- verifica el limite antes de abrir el
   formulario; si ya se alcanzo, muestra el paywall en vez.
===================================================== */
function intentarAgregarNegocio() {
  if (STATE.negocios.length >= STATE.limiteNegocios) {
    document.getElementById('pw-subtitulo').textContent =
      `Tu cuenta permite hasta ${STATE.limiteNegocios} negocio${STATE.limiteNegocios===1?'':'s'}. Para agregar otro, elige una opción:`;
    openModal('modal-paywall-negocio');
    return;
  }
  document.getElementById('nn-error').textContent = '';
  document.getElementById('nn-nombre').value = '';
  openModal('modal-nuevo-negocio');
}

async function crearNegocioVinculado() {
  const errEl = document.getElementById('nn-error');
  errEl.textContent = '';

  const nombre = document.getElementById('nn-nombre').value.trim();
  if (!nombre) { errEl.textContent = 'Escribe un nombre para el negocio.'; return; }

  // Ultima verificacion del limite, justo antes de crear -- por si
  // el usuario dejo la pestaña abierta mucho tiempo y algo cambio.
  if (STATE.negocios.length >= STATE.limiteNegocios) {
    closeModal('modal-nuevo-negocio');
    intentarAgregarNegocio();
    return;
  }

  setBtnLoading('nn-btn-crear', true);
  try {
    const idInterno = crypto.randomUUID().slice(0, 8);
    const emailInterno = `negocio-${idInterno}@negocio360.internal`;
    const passwordInterna = generarPasswordInterna();

    const { data: signUpData, error: errSignUp } = await sbAux.auth.signUp({
      email: emailInterno, password: passwordInterna,
    });
    if (errSignUp) throw errSignUp;
    const nuevoUserId = signUpData?.user?.id;
    if (!nuevoUserId) throw new Error('No se pudo crear el negocio nuevo.');

    // Si este es el PRIMER negocio adicional que se crea, se
    // materializa tambien la fila del negocio principal (antes solo
    // existia de forma virtual) -- para que ambos queden listados
    // igual de ahora en adelante.
    const yaMaterializado = STATE.negocios.some(n => n.id !== null && n.es_principal);
    if (!yaMaterializado) {
      await sb.from('negocios_vinculados').insert({
        auth_user_id_principal: STATE.userId, auth_user_id_negocio: STATE.userId,
        nombre_negocio: STATE.negocios.find(n => n.es_principal)?.nombre_negocio || 'Mi negocio',
        es_principal: true, email_interno: null, password_interno: null,
      });
    }

    const { error: errInsert } = await sb.from('negocios_vinculados').insert({
      auth_user_id_principal: STATE.userId, auth_user_id_negocio: nuevoUserId,
      nombre_negocio: nombre, es_principal: false,
      email_interno: emailInterno, password_interno: passwordInterna,
    });
    if (errInsert) throw errInsert;

    // El negocio nuevo nace con su propio nombre configurado, y ya
    // con el onboarding marcado como completo -- se creo desde aqui
    // con un nombre real, no debe pasar por el asistente inicial.
    await sb.from('configuracion_empresa').upsert({
      auth_user_id: nuevoUserId, nombre_comercial: nombre, onboarding_completado: true, onboarding_step: 5,
    }, { onConflict: 'auth_user_id' });
    await sb.from('usuarios').update({ onboarding_completado: true }).eq('auth_user_id', nuevoUserId);

    showToast(`Negocio "${nombre}" creado`);
    closeModal('modal-nuevo-negocio');
    await cargarNegocios();
  } catch (e) {
    console.error('crearNegocioVinculado:', e);
    errEl.textContent = 'No se pudo crear el negocio. Intenta de nuevo.';
  } finally {
    setBtnLoading('nn-btn-crear', false);
  }
}

/* =====================================================
   ENTRAR A OTRO NEGOCIO -- pide las credenciales internas por RPC
   segura (nunca se leen directo de la tabla desde el cliente), y
   cambia la sesion activa con un signInWithPassword real.
===================================================== */
async function entrarANegocio(negocioId) {
  const n = STATE.negocios.find(x => x.id === negocioId);
  if (!n) return;
  if (!confirm(`Vas a entrar a "${n.nombre_negocio}". ¿Continuar?`)) return;

  try {
    const { data: cred, error: errCred } = await sb.rpc('obtener_credenciales_negocio', { p_negocio_id: negocioId });
    const credencial = Array.isArray(cred) ? cred[0] : cred;
    if (errCred || !credencial?.email_interno) throw new Error('No autorizado para entrar a ese negocio.');

    const { error: errLogin } = await sb.auth.signInWithPassword({
      email: credencial.email_interno, password: credencial.password_interno,
    });
    if (errLogin) throw errLogin;

    window.location.href = 'dashboard.html';
  } catch (e) {
    console.error('entrarANegocio:', e);
    showToast('No se pudo entrar a ese negocio. Intenta de nuevo.', 'error');
  }
}

/* =====================================================
   PAYWALL -- botón de WhatsApp
===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const btnWa = document.getElementById('pw-btn-wa');
  if (btnWa) btnWa.addEventListener('click', () => {
    const msg = encodeURIComponent(`Hola, ya llegué al límite de ${STATE.limiteNegocios} negocio${STATE.limiteNegocios===1?'':'s'} en mi cuenta de Negocio360 y quiero ampliar mi plan para agregar otro negocio.`);
    window.open(`https://wa.me/50581294177?text=${msg}`, '_blank', 'noopener');
  });
});
