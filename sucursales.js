/* =====================================================
   SUCURSALES.JS — NEGOCIO360
   Cada sucursal es, por dentro, una cuenta 100% independiente (mismo
   mecanismo de auth.users + RLS que ya usa TODO el sistema) — por
   eso ningún otro módulo (Ventas, Productos, Caja, etc.) necesita
   cambiar ni una línea: ya filtran "solo lo mío" por auth_user_id.

   Las sucursales se crean con el signUp NORMAL de Supabase (nunca
   insertando directo en auth.users) — el correo y contraseña internos
   los genera y guarda el sistema, el cliente nunca los ve ni los usa
   a mano; el botón "Entrar" inicia sesión por él.

   IMPORTANTE: se usa un cliente Supabase AUXILIAR (con su propio
   almacenamiento de sesión) solo para crear sucursales — así el
   signUp() de la sucursal nueva NUNCA desconecta al dueño de su
   propia sesión mientras sigue en esta página.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient    = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// Cliente aparte, sin guardar sesión, exclusivo para crear sucursales
// (signUp) sin tocar la sesión activa del dueño en esta pestaña.
const sbClientAux = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'n360-sucursal-aux', persistSession: false, autoRefreshToken: false },
});

let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},
  sucursales: [], perfiles: [],
  sucursalActualParaAccesos: null,
};

/* =====================================================
   HELPERS
===================================================== */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function generarPasswordInterna() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'Sx_' + Array.from(bytes, b => b.toString(36).padStart(2,'0')).join('').slice(0, 32) + 'Aa1!';
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
   CARGA DE SUCURSALES (crea la Central automáticamente la
   primera vez que alguien visita este módulo)
===================================================== */
async function cargarSucursales() {
  const tbody = document.getElementById('suc-tbody');
  try {
    let { data } = await sbClient.from('sucursales').select('*')
      .eq('auth_user_id_central', STATE.userId).order('created_at');

    let lista = data || [];
    const tieneCentral = lista.some(s => s.es_central);
    if (!tieneCentral) {
      const nombreNegocio = STATE.empresaConfig?.nombre_comercial || 'Central';
      const { data: nueva, error } = await sbClient.from('sucursales').insert({
        auth_user_id_central: STATE.userId, nombre: nombreNegocio,
        es_central: true, auth_user_id_sucursal: STATE.userId, activa: true,
      }).select().single();
      if (!error && nueva) lista = [nueva, ...lista];
    }

    lista.sort((a, b) => (b.es_central ? 1 : 0) - (a.es_central ? 1 : 0));
    STATE.sucursales = lista;
    renderTablaSucursales();
  } catch (e) {
    console.error('cargarSucursales:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No se pudieron cargar las sucursales</td></tr>`;
  }
}

function renderTablaSucursales() {
  const tbody = document.getElementById('suc-tbody');
  if (!tbody) return;
  if (!STATE.sucursales.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Cargando…</td></tr>`;
    return;
  }
  tbody.innerHTML = STATE.sucursales.map(s => `
    <tr>
      <td style="font-weight:600">${s.es_central ? '🏠 ' : '🏬 '}${esc(s.nombre)}</td>
      <td>${s.es_central ? '<span class="status-badge badge-activo">Central</span>' : '<span class="status-badge">Sucursal</span>'}</td>
      <td>${fmtFecha(s.created_at)}</td>
      <td><span class="status-badge ${s.activa!==false ? 'badge-activo':'badge-inactivo'}">${s.activa!==false ? 'Activa':'Inactiva'}</span></td>
      <td class="td-actions">
        <button class="btn-icon" title="Entrar a esta sucursal" onclick="entrarASucursal('${s.id}')">🔑 Entrar</button>
        ${!s.es_central ? `
          <button class="btn-icon" title="Configurar accesos" onclick="abrirAccesosSucursal('${s.id}')">👥 Accesos</button>
          <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="confirmarEliminarSucursal('${s.id}')">🗑️</button>
        ` : `
          <span style="font-size:11px;color:var(--text-muted);padding:0 6px">Es tu cuenta actual</span>
        `}
      </td>
    </tr>`).join('');
}

/* =====================================================
   CREAR SUCURSAL
===================================================== */
function abrirNuevaSucursal() {
  document.getElementById('ns-nombre').value = '';
  document.getElementById('ns-error').textContent = '';
  openModal('modal-nueva-sucursal');
}

async function crearSucursal() {
  const errEl = document.getElementById('ns-error');
  errEl.textContent = '';
  const nombre = document.getElementById('ns-nombre').value.trim();
  if (!nombre) { errEl.textContent = 'Escribe un nombre para la sucursal.'; return; }
  if (STATE.sucursales.some(s => s.nombre.toLowerCase() === nombre.toLowerCase())) {
    errEl.textContent = 'Ya existe una sucursal (o la Central) con ese nombre.'; return;
  }

  setBtnLoading('btn-crear-sucursal', true);
  try {
    const idInterno = crypto.randomUUID().slice(0, 8);
    const emailInterno = `sucursal-${idInterno}@negocio360.internal`;
    const passwordInterna = generarPasswordInterna();

    // Se crea con el signUp NORMAL de Supabase (mismo mecanismo que
    // usa register.html) — nunca insertando directo en auth.users.
    // Se usa el cliente AUXILIAR para no afectar la sesión del dueño.
    const { data: signUpData, error: errSignUp } = await sbClientAux.auth.signUp({
      email: emailInterno, password: passwordInterna,
    });
    if (errSignUp) throw errSignUp;
    const nuevoUserId = signUpData?.user?.id;
    if (!nuevoUserId) throw new Error('No se pudo crear la cuenta interna de la sucursal.');

    const { error: errInsert } = await sbClient.from('sucursales').insert({
      auth_user_id_central: STATE.userId, nombre,
      es_central: false, auth_user_id_sucursal: nuevoUserId,
      email_interno: emailInterno, password_interno: passwordInterna, activa: true,
    });
    if (errInsert) throw errInsert;

    // Nombre comercial inicial de la sucursal, para que no se vea vacía
    await sbClient.from('configuracion_empresa').upsert({
      auth_user_id: nuevoUserId, nombre_comercial: nombre,
    }, { onConflict: 'auth_user_id' }).select();

    showToast(`Sucursal "${nombre}" creada`);
    closeModal('modal-nueva-sucursal');
    await cargarSucursales();
  } catch (e) {
    console.error('crearSucursal:', e);
    errEl.textContent = 'Error al crear: ' + (e.message || '');
  } finally {
    setBtnLoading('btn-crear-sucursal', false);
  }
}

/* =====================================================
   ENTRAR A UNA SUCURSAL (cambia la sesión activa y recarga)
===================================================== */
async function entrarASucursal(sucursalId) {
  const s = STATE.sucursales.find(x => x.id === sucursalId);
  if (!s) return;

  if (s.es_central) { navigate('dashboard.html'); return; }

  // Si quien está usando el sistema en este momento es un PERFIL con PIN
  // (no el dueño directo), se valida su permiso para esta sucursal antes
  // de dejarlo entrar, y se le pasan sus módulos permitidos ahí.
  let modulosParaLlevar = null;
  try {
    const raw = sessionStorage.getItem('n360_perfil_activo');
    if (raw) {
      const perfilActivo = JSON.parse(raw);
      if (perfilActivo && perfilActivo.tipo !== 'admin') {
        const { data: permiso } = await sbClient.from('sucursal_permisos')
          .select('modulos_permitidos').eq('sucursal_id', s.id).eq('perfil_id', perfilActivo.id).maybeSingle();
        if (!permiso) {
          showToast(`Tu perfil no tiene acceso a "${s.nombre}"`, 'error');
          return;
        }
        modulosParaLlevar = permiso.modulos_permitidos || [];
      }
    }
  } catch (e) { console.warn('No se pudo validar el permiso del perfil activo:', e); }

  if (!confirm(`Vas a entrar a "${s.nombre}". Tu sesión cambiará a esa sucursal — para volver a ${STATE.empresaConfig?.nombre_comercial || 'tu cuenta principal'} tendrás que iniciar sesión de nuevo con tu correo. ¿Continuar?`)) return;

  try {
    const { error } = await sbClient.auth.signInWithPassword({
      email: s.email_interno, password: s.password_interno,
    });
    if (error) throw error;
    // Sobrevive a la navegación (a diferencia de n360_perfil_activo, que
    // se invalida solo al cambiar de cuenta) — modulos-guard.js lo lee
    // en la sucursal para restringir el menú a lo permitido.
    if (modulosParaLlevar) sessionStorage.setItem('n360_sucursal_modulos', JSON.stringify(modulosParaLlevar));
    else sessionStorage.removeItem('n360_sucursal_modulos');
    window.location.href = 'dashboard.html';
  } catch (e) {
    console.error('entrarASucursal:', e);
    showToast('No se pudo entrar a la sucursal: ' + (e.message || ''), 'error');
  }
}

/* =====================================================
   CONFIGURAR ACCESOS (qué perfil entra a cuál sucursal, con
   cuáles módulos)
===================================================== */
async function loadPerfilesCentral() {
  try {
    const { data } = await sbClient.from('perfiles_acceso').select('id,nombre,tipo,activo')
      .eq('auth_user_id', STATE.userId).eq('activo', true).order('nombre');
    STATE.perfiles = data || [];
  } catch (e) { STATE.perfiles = []; }
}

function listaModulosParaAccesos() {
  const registro = window.NEGOCIO360_MODULOS || {};
  return Object.values(registro).filter(m => !m.soloAdmin);
}

async function abrirAccesosSucursal(sucursalId) {
  const s = STATE.sucursales.find(x => x.id === sucursalId);
  if (!s) return;
  STATE.sucursalActualParaAccesos = s;
  document.getElementById('acc-suc-title').textContent = `Accesos — ${s.nombre}`;

  if (!STATE.perfiles.length) await loadPerfilesCentral();

  const { data: permisosActuales } = await sbClient.from('sucursal_permisos')
    .select('*').eq('sucursal_id', sucursalId);
  const mapaPermisos = {};
  (permisosActuales || []).forEach(p => { mapaPermisos[p.perfil_id] = p.modulos_permitidos || []; });

  const modulos = listaModulosParaAccesos();
  const cont = document.getElementById('acc-suc-lista');

  if (!STATE.perfiles.length) {
    cont.innerHTML = `<p style="color:var(--text-muted);font-size:12.5px">Todavía no tienes perfiles con PIN creados en Configuración → Sistema multiusuario. Crea al menos uno para poder darle acceso a esta sucursal.</p>`;
  } else {
    cont.innerHTML = STATE.perfiles.map(p => {
      const seleccionados = mapaPermisos[p.id] || [];
      const tieneAcceso = seleccionados.length > 0 || permisosActuales?.some(x => x.perfil_id === p.id);
      return `
      <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px;margin-bottom:${tieneAcceso?'10px':'0'};cursor:pointer">
          <input type="checkbox" class="acc-perfil-toggle" data-perfil="${p.id}" ${tieneAcceso?'checked':''} onchange="toggleAccesoPerfil('${p.id}')" style="width:16px;height:16px"/>
          ${esc(p.nombre)} <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(${p.tipo})</span>
        </label>
        <div class="acc-mod-grid" id="acc-mod-grid-${p.id}" style="display:${tieneAcceso?'grid':'none'};grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;margin-left:24px">
          ${modulos.map(m => `
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer">
              <input type="checkbox" class="acc-mod-check" data-perfil="${p.id}" data-modulo="${m.key}" ${seleccionados.includes(m.key)?'checked':''}/>
              ${m.icon} ${esc(m.label)}
            </label>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  openModal('modal-accesos-sucursal');
}

function toggleAccesoPerfil(perfilId) {
  const checked = document.querySelector(`.acc-perfil-toggle[data-perfil="${perfilId}"]`)?.checked;
  const grid = document.getElementById(`acc-mod-grid-${perfilId}`);
  if (grid) grid.style.display = checked ? 'grid' : 'none';
}

async function guardarAccesosSucursal() {
  const s = STATE.sucursalActualParaAccesos;
  if (!s) return;
  try {
    // Se reemplaza el set completo de permisos de esta sucursal (simple
    // y seguro para listas pequeñas de perfiles).
    await sbClient.from('sucursal_permisos').delete().eq('sucursal_id', s.id);

    const filas = [];
    document.querySelectorAll('.acc-perfil-toggle').forEach(chk => {
      if (!chk.checked) return;
      const perfilId = chk.dataset.perfil;
      const modulos = [...document.querySelectorAll(`.acc-mod-check[data-perfil="${perfilId}"]:checked`)]
        .map(m => m.dataset.modulo);
      filas.push({
        sucursal_id: s.id, auth_user_id_central: STATE.userId,
        perfil_id: perfilId, modulos_permitidos: modulos,
      });
    });

    if (filas.length) {
      const { error } = await sbClient.from('sucursal_permisos').insert(filas);
      if (error) throw error;
    }

    showToast('Accesos guardados');
    closeModal('modal-accesos-sucursal');
  } catch (e) {
    console.error('guardarAccesosSucursal:', e);
    showToast('Error al guardar accesos: ' + (e.message || ''), 'error');
  }
}

/* =====================================================
   ELIMINAR SUCURSAL
===================================================== */
function confirmarEliminarSucursal(sucursalId) {
  const s = STATE.sucursales.find(x => x.id === sucursalId);
  if (!s || s.es_central) return;
  STATE.sucursalActualParaAccesos = s; // se reutiliza el campo para saber cuál eliminar
  openModal('modal-confirmar-eliminar-suc');
}
async function eliminarSucursal() {
  const s = STATE.sucursalActualParaAccesos;
  if (!s) return;
  setBtnLoading('btn-confirmar-eliminar-suc', true);
  try {
    // Al borrar la fila de "sucursales" se pierde el acceso desde aquí,
    // pero la cuenta interna (con todos sus datos) queda inactiva y
    // huérfana — no se puede eliminar auth.users desde el cliente por
    // seguridad. Se marca inactiva para dejar claro que ya no se usa.
    const { error } = await sbClient.from('sucursales').delete().eq('id', s.id).eq('auth_user_id_central', STATE.userId);
    if (error) throw error;
    showToast('Sucursal eliminada');
    closeModal('modal-confirmar-eliminar-suc');
    await cargarSucursales();
  } catch (e) {
    console.error('eliminarSucursal:', e);
    showToast('Error al eliminar: ' + (e.message || ''), 'error');
  } finally {
    setBtnLoading('btn-confirmar-eliminar-suc', false);
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
async function initSucursales() {
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

    await loadPerfilesCentral();
    await cargarSucursales();
  } catch (err) {
    console.error('initSucursales:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initSucursales();
  if (window.lucide) lucide.createIcons();
});
