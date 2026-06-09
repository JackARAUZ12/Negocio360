/* ============================================================
   NEGOCIO360 - admin.js
   Panel de Administración — lógica completa
   ============================================================ */

// ── SUPABASE INIT ──────────────────────────────────────────
// REEMPLAZA CON TUS CREDENCIALES
const SUPABASE_URL      = 'TU_SUPABASE_URL';      // ← reemplazar
const SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY'; // ← reemplazar

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── ESTADO GLOBAL ──────────────────────────────────────────
let currentUser   = null;
let adminRecord   = null;
let allUsers      = [];
let allCodes      = [];
let userFilter    = 'all';
let confirmAction = null;  // función pendiente de confirmación

// ── HELPERS DOM ────────────────────────────────────────────
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── LOADER ─────────────────────────────────────────────────
function showLoader()  { document.getElementById('page-loader').classList.remove('hidden'); }
function hideLoader()  { document.getElementById('page-loader').classList.add('hidden'); }

// ── TOAST ──────────────────────────────────────────────────
function toast(title, msg = '', type = 'success') {
  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ',
  };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <div class="toast-icon ${type}">${icons[type] || icons.info}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('transitionend', () => el.remove());
  }, 3800);
}

// ── MODAL HELPERS ──────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
function closeAllModals() {
  $$('.modal-overlay').forEach(m => m.classList.remove('open'));
}

// ── NAVEGACIÓN ─────────────────────────────────────────────
function navigate(section) {
  $$('.page-content').forEach(p => p.classList.remove('active'));
  $$('.nav-item[data-section]').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${section}`);
  const nav  = $(`.nav-item[data-section="${section}"]`);

  if (page) page.classList.add('active');
  if (nav)  nav.classList.add('active');

  // Cerrar sidebar en móvil
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');

  // Cargar datos según sección
  if (section === 'dashboard') loadDashboardStats();
  if (section === 'users')     loadUsers();
  if (section === 'codes')     loadCodes();
}

// ── AUTENTICACIÓN & VERIFICACIÓN ADMIN ────────────────────
async function verifyAdmin() {
  try {
    const { data: { user }, error } = await sb.auth.getUser();

    if (error || !user) {
      window.location.href = 'login.html';
      return false;
    }

    // Verificar en tabla administradores
    const { data: admin, error: adminError } = await sb
      .from('administradores')
      .select('*')
      .eq('email', user.email)
      .eq('activo', true)
      .single();

    if (adminError || !admin) {
      window.location.href = 'dashboard.html';
      return false;
    }

    currentUser = user;
    adminRecord = admin;
    return true;

  } catch (e) {
    window.location.href = 'login.html';
    return false;
  }
}

// ── POBLAR HEADER ──────────────────────────────────────────
function populateHeader() {
  const nombreCompleto = adminRecord.nombre || currentUser.email;
  const initials = nombreCompleto.charAt(0).toUpperCase();

  document.getElementById('header-admin-name').textContent = nombreCompleto;
  document.getElementById('header-admin-email').textContent = currentUser.email;
  document.getElementById('admin-avatar').textContent = initials;

  // Fecha actual
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('header-date').textContent =
    now.toLocaleDateString('es-ES', opts);
}

// ── DARK MODE ──────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('n360_admin_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('n360_admin_theme', next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  document.getElementById('theme-icon').innerHTML =
    theme === 'dark'
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
           <line x1="12" y1="21" x2="12" y2="23"/>
           <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
           <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
           <line x1="1" y1="12" x2="3" y2="12"/>
           <line x1="21" y1="12" x2="23" y2="12"/>
           <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
           <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
         </svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
         </svg>`;
}

// ── CERRAR SESIÓN ──────────────────────────────────────────
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

// ============================================================
// SECCIÓN 1 — DASHBOARD STATS
// ============================================================
async function loadDashboardStats() {
  // Re-verificar sesión antes de cargar
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  showSkeletons();

  try {
    const { data: usuarios, error } = await sb
      .from('usuarios')
      .select('id, estado_cuenta, plan');

    if (error) throw error;

    const total     = usuarios.length;
    const activos   = usuarios.filter(u => u.estado_cuenta === 'activa').length;
    const suspendidos = usuarios.filter(u => u.estado_cuenta === 'suspendida').length;
    const cancelados  = usuarios.filter(u => u.estado_cuenta === 'cancelada').length;
    const prueba    = usuarios.filter(u => u.plan === 'prueba').length;
    const premium   = usuarios.filter(u => u.plan === 'premium').length;

    document.getElementById('stat-total').textContent       = total;
    document.getElementById('stat-activos').textContent     = activos;
    document.getElementById('stat-suspendidos').textContent = suspendidos;
    document.getElementById('stat-cancelados').textContent  = cancelados;
    document.getElementById('stat-prueba').textContent      = prueba;
    document.getElementById('stat-premium').textContent     = premium;

  } catch (e) {
    toast('Error al cargar estadísticas', e.message, 'error');
  }
}

function showSkeletons() {
  ['stat-total','stat-activos','stat-suspendidos','stat-cancelados','stat-prueba','stat-premium']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; }
    });
}

// ============================================================
// SECCIÓN 2 — USUARIOS
// ============================================================
async function loadUsers() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  showUsersLoader();

  try {
    const { data, error } = await sb
      .from('usuarios')
      .select('id, auth_user_id, nombre, apellido, nombre_negocio, email, telefono, estado_cuenta, plan, fecha_vencimiento, onboarding_completado, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allUsers = data || [];
    renderUsersTable(allUsers);

  } catch (e) {
    toast('Error al cargar usuarios', e.message, 'error');
    renderUsersEmpty();
  }
}

function showUsersLoader() {
  document.getElementById('users-tbody').innerHTML = `
    <tr><td colspan="9" style="text-align:center; padding:48px; color:var(--text-muted)">
      <div class="loader-spinner" style="margin:0 auto 12px"></div>
      <div>Cargando usuarios...</div>
    </td></tr>`;
}

function renderUsersEmpty() {
  document.getElementById('users-tbody').innerHTML = `
    <tr><td colspan="9">
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <p>No se encontraron usuarios</p>
        <span>Intenta cambiar los filtros de búsqueda</span>
      </div>
    </td></tr>`;
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');

  if (!users.length) { renderUsersEmpty(); return; }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${escHtml(u.nombre || '—')}</td>
      <td>${escHtml(u.apellido || '—')}</td>
      <td>${escHtml(u.nombre_negocio || '—')}</td>
      <td>${escHtml(u.email || '—')}</td>
      <td>${escHtml(u.telefono || '—')}</td>
      <td>${planBadge(u.plan)}</td>
      <td>${estadoBadge(u.estado_cuenta)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td>
        <div class="td-actions">
          <button class="btn-icon btn-ghost btn-sm" onclick="viewUser('${u.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Ver
          </button>
          ${u.estado_cuenta !== 'activa'
            ? `<button class="btn-icon btn-success btn-sm" onclick="confirmAction('activar', '${u.id}', '${escHtml(u.nombre || u.email)}')">Activar</button>`
            : ''}
          ${u.estado_cuenta !== 'suspendida'
            ? `<button class="btn-icon btn-warning btn-sm" onclick="confirmAction('suspender', '${u.id}', '${escHtml(u.nombre || u.email)}')">Suspender</button>`
            : ''}
          ${u.estado_cuenta !== 'cancelada'
            ? `<button class="btn-icon btn-danger btn-sm" onclick="confirmAction('cancelar', '${u.id}', '${escHtml(u.nombre || u.email)}')">Cancelar</button>`
            : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

// Filtrar tabla usuarios
function applyUserFilter(filter) {
  userFilter = filter;
  $$('#page-users .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === filter));
  filterAndSearch();
}

function filterAndSearch() {
  const query = (document.getElementById('user-search').value || '').toLowerCase().trim();
  let filtered = allUsers;

  if (userFilter !== 'all') {
    if (userFilter === 'prueba' || userFilter === 'premium') {
      filtered = filtered.filter(u => u.plan === userFilter);
    } else {
      const estadoMap = { activos: 'activa', suspendidos: 'suspendida', cancelados: 'cancelada' };
      filtered = filtered.filter(u => u.estado_cuenta === estadoMap[userFilter]);
    }
  }

  if (query) {
    filtered = filtered.filter(u =>
      [u.nombre, u.apellido, u.email, u.nombre_negocio, u.telefono]
        .join(' ').toLowerCase().includes(query));
  }

  renderUsersTable(filtered);
}

// Ver usuario — modal detalle
function viewUser(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;

  document.getElementById('detail-nombre').textContent     = u.nombre || '—';
  document.getElementById('detail-apellido').textContent   = u.apellido || '—';
  document.getElementById('detail-negocio').textContent    = u.nombre_negocio || '—';
  document.getElementById('detail-email').textContent      = u.email || '—';
  document.getElementById('detail-telefono').textContent   = u.telefono || '—';
  document.getElementById('detail-plan').innerHTML         = planBadge(u.plan);
  document.getElementById('detail-estado').innerHTML       = estadoBadge(u.estado_cuenta);
  document.getElementById('detail-registro').textContent   = formatDate(u.created_at);
  document.getElementById('detail-onboarding').innerHTML   = u.onboarding_completado
    ? '<span class="badge badge-success">Completado</span>'
    : '<span class="badge badge-warning">Pendiente</span>';

  openModal('modal-view-user');
}

// Confirmar acción sobre usuario
function confirmAction(accion, userId, nombre) {
  const msgs = {
    activar:   { title: '¿Activar esta cuenta?',   sub: `Se activará la cuenta de <strong>${nombre}</strong>.`,   icon: '✓', cls: 'success', btn: 'btn-success', label: 'Sí, activar'    },
    suspender: { title: '¿Suspender esta cuenta?', sub: `Se suspenderá la cuenta de <strong>${nombre}</strong>.`, icon: '⚠', cls: 'warn',    btn: 'btn-warning', label: 'Sí, suspender' },
    cancelar:  { title: '¿Cancelar esta cuenta?',  sub: `Se cancelará la cuenta de <strong>${nombre}</strong>.`,  icon: '✕', cls: 'danger',  btn: 'btn-danger',  label: 'Sí, cancelar'  },
  };
  const m = msgs[accion];
  if (!m) return;

  document.getElementById('confirm-icon').className = `confirm-icon ${m.cls}`;
  document.getElementById('confirm-icon').textContent = m.icon;
  document.getElementById('confirm-title').textContent = m.title;
  document.getElementById('confirm-sub').innerHTML = m.sub;

  const btnConfirm = document.getElementById('btn-confirm-action');
  btnConfirm.className = `btn-icon ${m.btn}`;
  btnConfirm.textContent = m.label;

  // Guardar acción pendiente
  window._pendingAction = { accion, userId };

  openModal('modal-confirm');
}

async function executeConfirmAction() {
  const { accion, userId } = window._pendingAction || {};
  if (!accion || !userId) return;

  const estadoMap = { activar: 'activa', suspender: 'suspendida', cancelar: 'cancelada' };
  const nuevoEstado = estadoMap[accion];
  if (!nuevoEstado) return;

  // Re-verificar sesión
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const btn = document.getElementById('btn-confirm-action');
  btn.innerHTML = '<span class="btn-spinner"></span>';
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('usuarios')
      .update({ estado_cuenta: nuevoEstado, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;

    closeModal('modal-confirm');

    const toastMsgs = {
      activa:     'Cuenta activada correctamente',
      suspendida: 'Cuenta suspendida correctamente',
      cancelada:  'Cuenta cancelada correctamente',
    };
    const toastTypes = { activa: 'success', suspendida: 'warning', cancelada: 'error' };

    toast(toastMsgs[nuevoEstado], '', toastTypes[nuevoEstado]);

    // Actualizar local
    const idx = allUsers.findIndex(u => u.id === userId);
    if (idx !== -1) allUsers[idx].estado_cuenta = nuevoEstado;

    filterAndSearch();
    loadDashboardStats();

  } catch (e) {
    toast('Error al actualizar cuenta', e.message, 'error');
  } finally {
    btn.innerHTML = 'Confirmar';
    btn.disabled = false;
    window._pendingAction = null;
  }
}

// ============================================================
// SECCIÓN 3 — CÓDIGOS DE ACCESO
// ============================================================
async function loadCodes() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  showCodesLoader();

  try {
    const { data, error } = await sb
      .from('codigos_acceso')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allCodes = data || [];
    renderCodesTable(allCodes);

  } catch (e) {
    toast('Error al cargar códigos', e.message, 'error');
    renderCodesEmpty();
  }
}

function showCodesLoader() {
  document.getElementById('codes-tbody').innerHTML = `
    <tr><td colspan="7" style="text-align:center; padding:48px; color:var(--text-muted)">
      <div class="loader-spinner" style="margin:0 auto 12px"></div>
      <div>Cargando códigos...</div>
    </td></tr>`;
}

function renderCodesEmpty() {
  document.getElementById('codes-tbody').innerHTML = `
    <tr><td colspan="7">
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
        <p>No hay códigos de acceso</p>
        <span>Crea el primer código con el botón "Crear Código"</span>
      </div>
    </td></tr>`;
}

function renderCodesTable(codes) {
  const tbody = document.getElementById('codes-tbody');
  if (!codes.length) { renderCodesEmpty(); return; }

  tbody.innerHTML = codes.map(c => `
    <tr>
      <td>
        <span style="font-family:monospace;font-weight:600;letter-spacing:.5px;color:var(--accent)">${escHtml(c.codigo)}</span>
      </td>
      <td>${escHtml(c.descripcion || '—')}</td>
      <td>${planBadge(c.plan)}</td>
      <td>
        ${c.activo
          ? '<span class="badge badge-success badge-dot">Activo</span>'
          : '<span class="badge badge-danger badge-dot">Inactivo</span>'}
      </td>
      <td>
        <span style="font-weight:600">${c.usos_actuales}</span>
        <span style="color:var(--text-muted)"> / ${c.usos_maximos}</span>
      </td>
      <td>${formatDate(c.created_at)}</td>
      <td>
        <div class="td-actions">
          <button class="btn-copy" onclick="copyCode('${escHtml(c.codigo)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copiar
          </button>
          ${c.activo
            ? `<button class="btn-icon btn-warning btn-sm" onclick="toggleCode('${c.id}', false)">Desactivar</button>`
            : `<button class="btn-icon btn-success btn-sm" onclick="toggleCode('${c.id}', true)">Activar</button>`}
          <button class="btn-icon btn-danger btn-sm" onclick="confirmDeleteCode('${c.id}', '${escHtml(c.codigo)}')">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Copiar código
function copyCode(codigo) {
  navigator.clipboard.writeText(codigo).then(() => {
    toast('Código copiado', codigo, 'info');
  }).catch(() => {
    toast('No se pudo copiar', 'Copia manualmente el código', 'warning');
  });
}

// Activar / desactivar código
async function toggleCode(id, nuevoEstado) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  try {
    const { error } = await sb
      .from('codigos_acceso')
      .update({ activo: nuevoEstado })
      .eq('id', id);

    if (error) throw error;

    toast(nuevoEstado ? 'Código activado' : 'Código desactivado', '', nuevoEstado ? 'success' : 'warning');
    loadCodes();

  } catch (e) {
    toast('Error al actualizar código', e.message, 'error');
  }
}

// Confirmar eliminar código
function confirmDeleteCode(id, codigo) {
  document.getElementById('confirm-icon').className = 'confirm-icon danger';
  document.getElementById('confirm-icon').textContent = '✕';
  document.getElementById('confirm-title').textContent = '¿Eliminar este código?';
  document.getElementById('confirm-sub').innerHTML = `Se eliminará el código <strong>${codigo}</strong>. Esta acción no se puede deshacer.`;

  const btn = document.getElementById('btn-confirm-action');
  btn.className = 'btn-icon btn-danger';
  btn.textContent = 'Sí, eliminar';

  window._pendingAction = { accion: 'delete-code', codeId: id };
  openModal('modal-confirm');
}

async function executeConfirmDeleteCode(codeId) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const btn = document.getElementById('btn-confirm-action');
  btn.innerHTML = '<span class="btn-spinner"></span>';
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('codigos_acceso')
      .delete()
      .eq('id', codeId);

    if (error) throw error;

    closeModal('modal-confirm');
    toast('Código eliminado', '', 'error');
    loadCodes();

  } catch (e) {
    toast('Error al eliminar código', e.message, 'error');
  } finally {
    btn.innerHTML = 'Confirmar';
    btn.disabled = false;
    window._pendingAction = null;
  }
}

// Modal crear código
function openCreateCodeModal() {
  document.getElementById('form-create-code').reset();
  document.getElementById('code-preview-text').textContent = '';
  openModal('modal-create-code');
}

// Generador automático de código
function generateCode() {
  const chars   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const plan    = document.getElementById('new-plan').value;
  const code    = plan === 'premium'
    ? `NEG360-PREM-${segment(6)}`
    : `NEG360-${segment(4)}${segment(4)}`;

  document.getElementById('new-codigo').value = code;
  document.getElementById('code-preview-text').textContent = code;
}

// Crear código
async function createCode() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const codigo      = document.getElementById('new-codigo').value.trim();
  const descripcion = document.getElementById('new-descripcion').value.trim();
  const plan        = document.getElementById('new-plan').value;
  const usosMax     = parseInt(document.getElementById('new-usos').value, 10) || 1;

  if (!codigo) { toast('Campo requerido', 'El código no puede estar vacío', 'warning'); return; }

  const btn = document.getElementById('btn-save-code');
  btn.innerHTML = '<span class="btn-spinner"></span> Guardando...';
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('codigos_acceso')
      .insert({
        codigo,
        descripcion: descripcion || null,
        plan,
        activo: true,
        usos_maximos: usosMax,
        usos_actuales: 0,
      });

    if (error) throw error;

    closeModal('modal-create-code');
    toast('Código creado correctamente', codigo, 'success');
    loadCodes();

  } catch (e) {
    if (e.code === '23505') {
      toast('Código duplicado', 'Ya existe un código con ese nombre', 'warning');
    } else {
      toast('Error al crear código', e.message, 'error');
    }
  } finally {
    btn.innerHTML = 'Guardar Código';
    btn.disabled = false;
  }
}

// ── CONFIRM DISPATCHER ─────────────────────────────────────
async function dispatchConfirm() {
  const pending = window._pendingAction;
  if (!pending) return;

  if (pending.accion === 'delete-code') {
    await executeConfirmDeleteCode(pending.codeId);
  } else {
    await executeConfirmAction();
  }
}

// ── UTILIDADES ─────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  } catch { return '—'; }
}

function estadoBadge(estado) {
  const map = {
    activa:     '<span class="badge badge-success badge-dot">Activa</span>',
    suspendida: '<span class="badge badge-warning badge-dot">Suspendida</span>',
    cancelada:  '<span class="badge badge-danger badge-dot">Cancelada</span>',
  };
  return map[estado] || `<span class="badge">${escHtml(estado || '—')}</span>`;
}

function planBadge(plan) {
  const map = {
    prueba:  '<span class="badge badge-info">Prueba</span>',
    premium: '<span class="badge badge-purple">Premium</span>',
  };
  return map[plan] || `<span class="badge">${escHtml(plan || '—')}</span>`;
}

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  const ok = await verifyAdmin();
  if (!ok) return;

  populateHeader();

  // Evento: cerrar sesión
  document.getElementById('btn-logout').addEventListener('click', signOut);

  // Evento: toggle theme
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Evento: toggle sidebar mobile
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  });

  // Evento: navegación
  $$('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.section));
  });

  // Evento: búsqueda usuarios
  document.getElementById('user-search').addEventListener('input', filterAndSearch);

  // Evento: filtros usuarios
  $$('#page-users .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => applyUserFilter(btn.dataset.filter));
  });

  // Evento: cerrar modales con X
  $$('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.remove('open'));
  });

  // Evento: cerrar modal al hacer clic fuera
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Evento: confirmar acción
  document.getElementById('btn-confirm-action').addEventListener('click', dispatchConfirm);

  // Evento: cancelar confirmación
  document.getElementById('btn-cancel-confirm').addEventListener('click', () => {
    closeModal('modal-confirm');
    window._pendingAction = null;
  });

  // Evento: botón crear código
  document.getElementById('btn-new-code').addEventListener('click', openCreateCodeModal);

  // Evento: generar código automático
  document.getElementById('btn-generate-code').addEventListener('click', generateCode);

  // Evento: preview de código al escribir
  document.getElementById('new-codigo').addEventListener('input', (e) => {
    document.getElementById('code-preview-text').textContent = e.target.value.trim();
  });

  // Evento: guardar código
  document.getElementById('btn-save-code').addEventListener('click', createCode);

  // Cargar página inicial
  navigate('dashboard');

  // Ocultar loader
  hideLoader();
});
