/* ============================================================
   PERFILES-GUARD.JS — Sistema multiusuario con PIN por módulo
   ------------------------------------------------------------
   Se incluye con una sola línea en cada página protegida:
     <script src="perfiles-guard.js"></script>
   No modifica ni depende de la lógica propia de cada módulo
   (productos.js, ventas.js, etc.) — corre de forma independiente
   usando su propia conexión a Supabase.

   IMPORTANTE (seguridad): las restricciones de módulo aquí son
   una capa de UX para equipos de trabajo, no un límite de
   seguridad a nivel de datos — eso lo sigue garantizando RLS
   (cada fila pertenece a auth_user_id, el dueño de la cuenta).
   Todos los perfiles de una cuenta comparten la misma sesión de
   Supabase Auth; el PIN sólo decide qué ve la interfaz.
   ============================================================ */
'use strict';

(function () {

  const PG_SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const PG_SUPABASE_KEY  = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  const PG_SESSION_KEY   = 'n360_perfil_activo';

  // Módulos reconocidos por archivo. ÚNICA fuente de verdad:
  // modulos-registro.js (se carga antes que este archivo). Se excluyen
  // los "soloAdmin" (Configuración, Auditoría) porque tienen su propio
  // candado de código de administrador — nunca tiene sentido asignarlos
  // por perfil, el candado los bloquearía de todas formas.
  const MODULOS = {};
  Object.entries(window.NEGOCIO360_MODULOS || {}).forEach(([archivo, m]) => {
    if (!m.soloAdmin) MODULOS[archivo] = { key: m.key, label: m.label, icon: m.icon };
  });
  const MODULO_ORDEN = Object.values(MODULOS).map(m => m.key);
  const AVATAR_COLORS = ['#6C63FF','#F59E0B','#10B981','#EF4444','#3B82F6','#EC4899','#14B8A6','#8B5CF6'];

  function colorFor(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function currentFile() {
    const f = location.pathname.split('/').pop() || 'dashboard.html';
    return f.includes('.') ? f : 'dashboard.html';
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function hashPin(pin, perfilId) {
    return sha256(`n360:${perfilId}:${pin}`);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------
  const PG = {
    client: null,
    authUserId: null,
    authEmail: null,
    perfiles: [],
    overlayEl: null,
  };

  function getSesion() {
    try {
      const raw = sessionStorage.getItem(PG_SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s.authUserId !== PG.authUserId) return null;
      return s;
    } catch (_) { return null; }
  }
  function setSesion(perfil) {
    sessionStorage.setItem(PG_SESSION_KEY, JSON.stringify({
      authUserId: PG.authUserId,
      id: perfil.id,
      nombre: perfil.nombre,
      tipo: perfil.tipo,
      modulos: perfil.modulos || [],
    }));
  }
  function limpiarSesion() { sessionStorage.removeItem(PG_SESSION_KEY); }

  // ------------------------------------------------------------
  // Datos
  // ------------------------------------------------------------
  async function cargarPerfiles() {
    const { data, error } = await PG.client
      .from('perfiles_acceso')
      .select('*')
      .eq('auth_user_id', PG.authUserId)
      .eq('activo', true)
      .order('created_at', { ascending: true });
    if (error) { console.error('perfiles-guard cargarPerfiles:', error); return []; }
    let perfiles = data || [];

    // Garantiza que siempre exista el perfil Admin
    if (!perfiles.some(p => p.tipo === 'admin')) {
      const { data: nuevo, error: errIns } = await PG.client
        .from('perfiles_acceso')
        .insert([{ auth_user_id: PG.authUserId, nombre: 'Admin', tipo: 'admin', modulos: [], codigo_configurado: false }])
        .select().single();
      if (!errIns && nuevo) perfiles = [nuevo, ...perfiles];
    }
    perfiles.sort((a, b) => (a.tipo === 'admin' ? -1 : b.tipo === 'admin' ? 1 : 0));
    return perfiles;
  }

  // ------------------------------------------------------------
  // Overlay base
  // ------------------------------------------------------------
  function ensureOverlay() {
    if (PG.overlayEl) return PG.overlayEl;
    const div = document.createElement('div');
    div.id = 'pg-overlay';
    div.innerHTML = '<div class="pg-card" id="pg-card"></div>';
    document.body.appendChild(div);
    PG.overlayEl = div;
    return div;
  }
  function showOverlay() {
    const ov = ensureOverlay();
    requestAnimationFrame(() => ov.classList.add('pg-visible'));
    document.documentElement.style.overflow = 'hidden';
  }
  function hideOverlay() {
    if (!PG.overlayEl) return;
    PG.overlayEl.classList.remove('pg-visible');
    document.documentElement.style.overflow = '';
    setTimeout(() => { if (PG.overlayEl) PG.overlayEl.remove(); PG.overlayEl = null; }, 200);
  }
  function card() { return document.getElementById('pg-card'); }

  // ------------------------------------------------------------
  // Vista: selector de perfiles ("Elige usuario")
  // ------------------------------------------------------------
  function renderSelector() {
    const c = card();
    const tiles = PG.perfiles.map(p => `
      <button class="pg-profile" data-id="${p.id}">
        <div class="pg-avatar" style="background:${p.tipo === 'admin' ? '#1A1D2E' : colorFor(p.nombre)}">
          ${p.tipo === 'admin' ? '👑' : esc((p.nombre || '?').trim().charAt(0).toUpperCase())}
        </div>
        <div class="pg-profile-name">${esc(p.nombre)}</div>
        ${p.tipo === 'admin' ? '<div class="pg-profile-badge">Admin</div>' : ''}
      </button>
    `).join('');

    c.innerHTML = `
      <div class="pg-title">¿Quién eres?</div>
      <div class="pg-subtitle">Elige tu usuario para continuar</div>
      <div class="pg-grid">
        ${tiles}
        <button class="pg-profile" id="pg-add-tile">
          <div class="pg-avatar pg-avatar-add">＋</div>
          <div class="pg-profile-name" style="color:var(--text-muted,#9CA3AF)">Agregar usuario</div>
        </button>
      </div>
      <div class="pg-manage-link" id="pg-manage-link">⚙ Gestionar usuarios</div>
    `;

    c.querySelectorAll('.pg-profile[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const perfil = PG.perfiles.find(p => p.id === btn.dataset.id);
        if (perfil) renderPin(perfil, { onSuccess: onLoginExitoso });
      });
    });
    const addTile = document.getElementById('pg-add-tile');
    if (addTile) addTile.addEventListener('click', requerirAdminYGestionar);
    const manageLink = document.getElementById('pg-manage-link');
    if (manageLink) manageLink.addEventListener('click', requerirAdminYGestionar);
  }

  function requerirAdminYGestionar() {
    const admin = PG.perfiles.find(p => p.tipo === 'admin');
    if (!admin) return;
    renderPin(admin, { onSuccess: renderGestionUsuarios, tituloExtra: 'Se requiere el código de administrador' });
  }

  // ------------------------------------------------------------
  // Vista: PIN (establecer o ingresar)
  // ------------------------------------------------------------
  function renderPin(perfil, { onSuccess, tituloExtra, forzarNuevo } = {}) {
    const c = card();
    const esNuevo = !!forzarNuevo || (perfil.tipo === 'admin' && !perfil.codigo_configurado);
    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-back">← Volver</div>
      <div class="pg-pin-wrap">
        <div class="pg-pin-avatar" style="background:${perfil.tipo === 'admin' ? '#1A1D2E' : colorFor(perfil.nombre)}">
          ${perfil.tipo === 'admin' ? '👑' : esc((perfil.nombre || '?').trim().charAt(0).toUpperCase())}
        </div>
        <div class="pg-title" style="margin-bottom:2px">${esc(perfil.nombre)}</div>
        <div class="pg-subtitle" style="margin-bottom:4px">
          ${esNuevo ? (tituloExtra || 'Crea tu nuevo código de acceso') : (tituloExtra || 'Ingresa tu código de acceso')}
        </div>
        <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
               class="pg-pin-input" id="pg-pin-1" placeholder="••••"
               autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false"
               data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-codigo-1" />
        ${esNuevo ? `<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
               class="pg-pin-input" id="pg-pin-2" placeholder="Confirmar código"
               autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false"
               data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-codigo-2" />` : ''}
        <div class="pg-hint">${esNuevo ? 'Usa entre 4 y 6 dígitos. No lo olvides.' : ''}</div>
        <div class="pg-error" id="pg-pin-error"></div>
        <div class="pg-btn-row">
          <button class="pg-btn pg-btn-ghost" id="pg-pin-cancel">Cancelar</button>
          <button class="pg-btn pg-btn-primary" id="pg-pin-ok">${esNuevo ? 'Crear código' : 'Entrar'}</button>
        </div>
        ${!esNuevo ? '<div class="pg-manage-link" id="pg-forgot">¿Olvidaste tu código?</div>' : ''}
      </div>
    `;
    document.getElementById('pg-back').addEventListener('click', renderSelector);
    document.getElementById('pg-pin-cancel').addEventListener('click', renderSelector);
    const forgotEl = document.getElementById('pg-forgot');
    if (forgotEl) forgotEl.addEventListener('click', () => renderOlvideCodigo(perfil, { onSuccess }));

    const input1 = document.getElementById('pg-pin-1');
    const input2 = document.getElementById('pg-pin-2');
    const errEl  = document.getElementById('pg-pin-error');
    input1.focus();

    async function intentar() {
      errEl.textContent = '';
      const pin1 = (input1.value || '').trim();
      if (pin1.length < 4) { errEl.textContent = 'El código debe tener al menos 4 dígitos'; return; }

      if (esNuevo) {
        const pin2 = (input2.value || '').trim();
        if (pin1 !== pin2) { errEl.textContent = 'Los códigos no coinciden'; return; }
        const hash = await hashPin(pin1, perfil.id);
        const { error } = await PG.client.from('perfiles_acceso')
          .update({ codigo_hash: hash, codigo_configurado: true, updated_at: new Date().toISOString() })
          .eq('id', perfil.id);
        if (error) { errEl.textContent = 'No se pudo guardar el código. Intenta de nuevo.'; return; }
        perfil.codigo_configurado = true;
        perfil.codigo_hash = hash;
        onSuccess && onSuccess(perfil);
        return;
      }

      const hash = await hashPin(pin1, perfil.id);
      if (hash !== perfil.codigo_hash) {
        errEl.textContent = 'Código incorrecto';
        input1.value = '';
        input1.focus();
        return;
      }
      onSuccess && onSuccess(perfil);
    }

    document.getElementById('pg-pin-ok').addEventListener('click', intentar);
    [input1, input2].forEach(el => {
      if (!el) return;
      el.addEventListener('keydown', e => { if (e.key === 'Enter') intentar(); });
    });
  }

  // ------------------------------------------------------------
  // Vista: "¿Olvidaste tu código?" — restablecimiento seguro
  // ------------------------------------------------------------
  // Admin: solo puede restablecer su propio código si confirma la
  //        contraseña de su cuenta (Supabase Auth) — es la credencial
  //        más fuerte del sistema y solo la conoce el dueño de la cuenta.
  // Restringido: requiere que un administrador ingrese SU código para
  //        autorizar el cambio, igual que ya ocurre en "Gestionar usuarios".
  // En ningún caso se revela el código anterior ni se debilita RLS:
  // solo se reemplaza codigo_hash tras una verificación explícita.
  // ------------------------------------------------------------
  function renderOlvideCodigo(perfil, { onSuccess } = {}) {
    const c = card();

    if (perfil.tipo === 'admin') {
      c.innerHTML = `
        <div class="pg-back-arrow" id="pg-back">← Volver</div>
        <div class="pg-title">Recuperar código de administrador</div>
        <div class="pg-subtitle">Confirma la contraseña de tu cuenta para crear un nuevo código</div>
        <div class="pg-field">
          <label>Correo</label>
          <input type="email" id="pg-of-email" value="${esc(PG.authEmail || '')}" disabled />
        </div>
        <div class="pg-field">
          <label>Contraseña de tu cuenta</label>
          <input type="password" id="pg-of-pass" placeholder="••••••••" autocomplete="current-password" />
        </div>
        <div class="pg-error" id="pg-of-error"></div>
        <div class="pg-btn-row">
          <button class="pg-btn pg-btn-ghost" id="pg-of-cancel">Cancelar</button>
          <button class="pg-btn pg-btn-primary" id="pg-of-ok">Verificar</button>
        </div>
      `;
      document.getElementById('pg-back').addEventListener('click', () => renderPin(perfil, { onSuccess }));
      document.getElementById('pg-of-cancel').addEventListener('click', () => renderPin(perfil, { onSuccess }));
      const passEl = document.getElementById('pg-of-pass');
      const errEl  = document.getElementById('pg-of-error');
      const okBtn  = document.getElementById('pg-of-ok');
      passEl.focus();

      async function verificar() {
        errEl.textContent = '';
        const pass = passEl.value || '';
        if (!pass) { errEl.textContent = 'Ingresa tu contraseña'; return; }
        if (!PG.authEmail) { errEl.textContent = 'No se pudo confirmar tu correo. Recarga la página e intenta de nuevo.'; return; }
        okBtn.disabled = true; okBtn.textContent = 'Verificando…';
        try {
          const { error } = await PG.client.auth.signInWithPassword({ email: PG.authEmail, password: pass });
          if (error) {
            errEl.textContent = 'Contraseña incorrecta';
            okBtn.disabled = false; okBtn.textContent = 'Verificar';
            return;
          }
          renderPin(perfil, { onSuccess, forzarNuevo: true, tituloExtra: 'Crea tu nuevo código de acceso' });
        } catch (e) {
          console.error('renderOlvideCodigo (admin):', e);
          errEl.textContent = 'No se pudo verificar. Intenta de nuevo.';
          okBtn.disabled = false; okBtn.textContent = 'Verificar';
        }
      }
      okBtn.addEventListener('click', verificar);
      passEl.addEventListener('keydown', e => { if (e.key === 'Enter') verificar(); });
      return;
    }

    // Perfil restringido
    const admin = PG.perfiles.find(p => p.tipo === 'admin');
    if (!admin || !admin.codigo_configurado) {
      // Sin administrador configurado no hay a quién pedirle autorización
      renderPin(perfil, { onSuccess });
      return;
    }
    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-back">← Volver</div>
      <div class="pg-title">Restablecer código</div>
      <div class="pg-subtitle">Pide al administrador que ingrese su código para autorizar el cambio de "${esc(perfil.nombre)}"</div>
      <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
             class="pg-pin-input" id="pg-of-admin-pin" placeholder="Código de administrador"
             autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false"
             data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-codigo-admin" />
      <div class="pg-error" id="pg-of-error"></div>
      <div class="pg-btn-row">
        <button class="pg-btn pg-btn-ghost" id="pg-of-cancel">Cancelar</button>
        <button class="pg-btn pg-btn-primary" id="pg-of-ok">Autorizar</button>
      </div>
    `;
    document.getElementById('pg-back').addEventListener('click', () => renderPin(perfil, { onSuccess }));
    document.getElementById('pg-of-cancel').addEventListener('click', () => renderPin(perfil, { onSuccess }));
    const pinEl = document.getElementById('pg-of-admin-pin');
    const errEl = document.getElementById('pg-of-error');
    pinEl.focus();

    async function autorizar() {
      errEl.textContent = '';
      const val = (pinEl.value || '').trim();
      if (!val) { errEl.textContent = 'Ingresa el código de administrador'; return; }
      const hash = await hashPin(val, admin.id);
      if (hash !== admin.codigo_hash) {
        errEl.textContent = 'Código de administrador incorrecto';
        pinEl.value = ''; pinEl.focus();
        return;
      }
      renderPin(perfil, { onSuccess, forzarNuevo: true, tituloExtra: `Crea el nuevo código para ${esc(perfil.nombre)}` });
    }
    document.getElementById('pg-of-ok').addEventListener('click', autorizar);
    pinEl.addEventListener('keydown', e => { if (e.key === 'Enter') autorizar(); });
  }

  function onLoginExitoso(perfil) {
    setSesion(perfil);
    hideOverlay();
    aplicarRestricciones(perfil);
    redirigirSiHaceFalta(perfil);
  }

  // ------------------------------------------------------------
  // Vista: Gestión de usuarios (crear / editar / eliminar)
  // ------------------------------------------------------------
  function renderGestionUsuarios() {
    const c = card();
    const restringidos = PG.perfiles.filter(p => p.tipo === 'restringido');
    const filas = restringidos.map(p => `
      <div class="pg-user-row" data-id="${p.id}">
        <div class="pg-avatar" style="background:${colorFor(p.nombre)}">${esc((p.nombre||'?').trim().charAt(0).toUpperCase())}</div>
        <div class="pg-user-row-info">
          <div class="pg-user-row-name">${esc(p.nombre)}</div>
          <div class="pg-user-row-mods">${(p.modulos||[]).map(m => MODULOS['dashboard.html'] && Object.values(MODULOS).find(x=>x.key===m)?.label).filter(Boolean).join(', ') || 'Sin módulos asignados'}</div>
        </div>
        <button class="pg-icon-btn pg-edit" title="Editar">✏️</button>
        <button class="pg-icon-btn pg-icon-danger pg-del" title="Eliminar">🗑️</button>
      </div>
    `).join('') || '<p style="text-align:center;color:var(--text-muted,#9CA3AF);font-size:12.5px;margin:14px 0">Aún no has agregado usuarios.</p>';

    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-back">← Volver</div>
      <div class="pg-title">Gestionar usuarios</div>
      <div class="pg-subtitle">Crea perfiles con acceso limitado a ciertos módulos</div>
      <div class="pg-section-title">Usuarios con acceso restringido</div>
      ${filas}
      <button class="pg-btn pg-btn-primary" id="pg-nuevo-usuario" style="width:100%;margin-top:6px">+ Nuevo usuario</button>
    `;

    document.getElementById('pg-back').addEventListener('click', renderSelector);
    document.getElementById('pg-nuevo-usuario').addEventListener('click', () => renderFormUsuario(null));
    c.querySelectorAll('.pg-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.pg-user-row').dataset.id;
        renderFormUsuario(PG.perfiles.find(p => p.id === id));
      });
    });
    c.querySelectorAll('.pg-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.pg-user-row').dataset.id;
        const p = PG.perfiles.find(x => x.id === id);
        if (!p) return;
        if (!confirm(`¿Eliminar al usuario "${p.nombre}"? Ya no podrá ingresar con su código.`)) return;
        await PG.client.from('perfiles_acceso').delete().eq('id', id);
        PG.perfiles = await cargarPerfiles();
        renderGestionUsuarios();
      });
    });
  }

  function renderFormUsuario(perfilExistente) {
    const c = card();
    const editando = !!perfilExistente;
    const modulosActuales = new Set(editando ? (perfilExistente.modulos || []) : []);

    const checks = Object.values(MODULOS).map(m => `
      <label class="pg-mod-check ${modulosActuales.has(m.key) ? 'pg-mod-checked' : ''}" data-mod="${m.key}">
        <input type="checkbox" value="${m.key}" ${modulosActuales.has(m.key) ? 'checked' : ''} />
        ${m.icon} ${m.label}
      </label>
    `).join('');

    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-back">← Volver</div>
      <div class="pg-title">${editando ? 'Editar usuario' : 'Nuevo usuario'}</div>
      <div class="pg-subtitle">Define su nombre, código de acceso y a qué módulos puede entrar</div>

      <div class="pg-field">
        <label>Nombre</label>
        <input type="text" id="pg-f-nombre" placeholder="Ej: Vendedor, Cajera, Bodega..." value="${editando ? esc(perfilExistente.nombre) : ''}" maxlength="60" />
      </div>
      <div class="pg-field">
        <label>${editando ? 'Nuevo código (déjalo vacío para no cambiarlo)' : 'Código de acceso (4 a 6 dígitos)'}</label>
        <input type="password" inputmode="numeric" id="pg-f-pin" placeholder="••••" maxlength="6" />
      </div>
      <div class="pg-field">
        <label>Módulos permitidos</label>
        <div class="pg-mods-grid">${checks}</div>
      </div>
      <div class="pg-error" id="pg-f-error"></div>
      <div class="pg-btn-row">
        ${editando ? '<button class="pg-btn pg-btn-danger" id="pg-f-eliminar">Eliminar</button>' : '<button class="pg-btn pg-btn-ghost" id="pg-f-cancelar">Cancelar</button>'}
        <button class="pg-btn pg-btn-primary" id="pg-f-guardar">Guardar</button>
      </div>
    `;

    document.getElementById('pg-back').addEventListener('click', renderGestionUsuarios);
    const cancelBtn = document.getElementById('pg-f-cancelar');
    if (cancelBtn) cancelBtn.addEventListener('click', renderGestionUsuarios);
    const delBtn = document.getElementById('pg-f-eliminar');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar al usuario "${perfilExistente.nombre}"?`)) return;
      await PG.client.from('perfiles_acceso').delete().eq('id', perfilExistente.id);
      PG.perfiles = await cargarPerfiles();
      renderGestionUsuarios();
    });

    c.querySelectorAll('.pg-mod-check').forEach(lbl => {
      lbl.addEventListener('click', () => {
        setTimeout(() => {
          const checked = lbl.querySelector('input').checked;
          lbl.classList.toggle('pg-mod-checked', checked);
        }, 0);
      });
    });

    document.getElementById('pg-f-guardar').addEventListener('click', async () => {
      const errEl  = document.getElementById('pg-f-error');
      errEl.textContent = '';
      const nombre = (document.getElementById('pg-f-nombre').value || '').trim();
      const pin    = (document.getElementById('pg-f-pin').value || '').trim();
      const modulosSel = Array.from(c.querySelectorAll('.pg-mod-check input:checked')).map(i => i.value);

      if (!nombre) { errEl.textContent = 'El nombre es obligatorio'; return; }
      if (!editando && pin.length < 4) { errEl.textContent = 'Define un código de al menos 4 dígitos'; return; }
      if (pin && pin.length > 0 && pin.length < 4) { errEl.textContent = 'El código debe tener al menos 4 dígitos'; return; }
      if (!modulosSel.length) { errEl.textContent = 'Selecciona al menos un módulo permitido'; return; }

      try {
        if (editando) {
          const payload = { nombre, modulos: modulosSel, updated_at: new Date().toISOString() };
          if (pin) {
            payload.codigo_hash = await hashPin(pin, perfilExistente.id);
            payload.codigo_configurado = true;
          }
          const { error } = await PG.client.from('perfiles_acceso').update(payload).eq('id', perfilExistente.id);
          if (error) throw error;
        } else {
          const { data: nuevo, error: errIns } = await PG.client.from('perfiles_acceso').insert([{
            auth_user_id: PG.authUserId, nombre, tipo: 'restringido',
            modulos: modulosSel, codigo_configurado: true,
          }]).select().single();
          if (errIns) throw errIns;
          const hash = await hashPin(pin, nuevo.id);
          await PG.client.from('perfiles_acceso').update({ codigo_hash: hash }).eq('id', nuevo.id);
        }
        PG.perfiles = await cargarPerfiles();
        renderGestionUsuarios();
      } catch (e) {
        console.error('guardar usuario:', e);
        errEl.textContent = e.message?.includes('duplicate') || e.code === '23505'
          ? 'Ya existe un usuario con ese nombre'
          : 'No se pudo guardar. Intenta de nuevo.';
      }
    });
  }

  // ------------------------------------------------------------
  // Restricciones en pantalla (sidebar + acceso a la página actual)
  // ------------------------------------------------------------
  function primerModuloPermitido(perfil) {
    const permitido = MODULO_ORDEN.find(k => (perfil.modulos || []).includes(k));
    const entry = Object.entries(MODULOS).find(([, v]) => v.key === permitido);
    return entry ? entry[0] : 'dashboard.html';
  }

  function redirigirSiHaceFalta(perfil) {
    if (perfil.tipo === 'admin') return;
    const file = currentFile();
    const mod  = MODULOS[file];
    if (mod && !(perfil.modulos || []).includes(mod.key)) {
      location.href = primerModuloPermitido(perfil);
    }
  }

  function aplicarRestricciones(perfil) {
    inyectarBotonCambiarUsuario(perfil);
    forzarNombrePerfilEnUI(perfil);
    if (perfil.tipo === 'admin') return;

    const permitidos = new Set(perfil.modulos || []);
    // Cubre ambos patrones de sidebar usados en el proyecto:
    //  <div onclick="navigate('ventas.html')">  y  <a href="ventas.html">
    const nodos = document.querySelectorAll('[onclick*="navigate("], a[href$=".html"], a[href*=".html?"]');
    nodos.forEach(el => {
      let href = el.getAttribute('href');
      if (!href) {
        const m = (el.getAttribute('onclick') || '').match(/navigate\(['"]([^'"?]+)/);
        href = m ? m[1] : null;
      }
      if (!href) return;
      const file = href.split('?')[0].split('/').pop();
      const mod  = MODULOS[file];
      if (!mod) return; // páginas no controladas (login, etc.) se dejan intactas
      if (!permitidos.has(mod.key)) {
        const item = el.closest('.nav-item') || el;
        item.style.display = 'none';
      }
    });

    // Oculta títulos de sección de sidebar que quedaron sin items visibles
    document.querySelectorAll('.nav-section-title, .sidebar-section-label').forEach(title => {
      let n = title.nextElementSibling;
      let algunoVisible = false;
      while (n && !n.classList.contains('nav-section-title') && !n.classList.contains('sidebar-section-label')) {
        if (n.style.display !== 'none') algunoVisible = true;
        n = n.nextElementSibling;
      }
      title.style.display = algunoVisible ? '' : 'none';
    });
  }

  // ------------------------------------------------------------
  // Corrige el saludo ("¡Buenas noches, ...!") y el nombre del
  // encabezado para que muestren el PERFIL que entró por PIN, no
  // siempre el dueño de la cuenta. Solo aplica a perfiles
  // restringidos: el perfil "Admin" ES el dueño de la cuenta, así
  // que su nombre real (el que ya muestra cada módulo) es correcto
  // tal cual y no se toca.
  //
  // Usa MutationObserver en vez de fijar el texto una sola vez,
  // porque cada módulo carga sus propios datos de forma asíncrona
  // y podría "pisar" el nombre después de que este script corra.
  // Así, sin importar el orden de carga, el nombre correcto siempre
  // queda como última palabra — y esto funciona en CUALQUIER módulo
  // nuevo que use los mismos IDs, sin tener que tocarlo nunca.
  // ------------------------------------------------------------
  function forzarNombrePerfilEnUI(perfil) {
    if (!perfil || perfil.tipo === 'admin' || !perfil.nombre) return;
    const nombre = perfil.nombre;

    function vigilar(selector, calcularTexto) {
      const el = document.querySelector(selector);
      if (!el) return;
      let aplicando = false;
      const aplicar = () => {
        if (aplicando) return;
        const deseado = calcularTexto(el.textContent || '');
        if (deseado != null && el.textContent !== deseado) {
          aplicando = true;
          el.textContent = deseado;
          aplicando = false;
        }
      };
      aplicar();
      new MutationObserver(aplicar).observe(el, { childList: true, characterData: true, subtree: true });
    }

    // "¡Buenas noches, Carlos! 👋" → "¡Buenas noches, María! 👋"
    vigilar('#greeting-text', (actual) => {
      if (!/,/.test(actual)) return null; // formato inesperado: no tocar
      return actual.replace(/,\s*[^!,]+!/, `, ${nombre}!`);
    });
    // Nombre en el encabezado (avatar/menú de usuario)
    vigilar('#header-name', () => nombre);
  }

  function inyectarBotonCambiarUsuario(perfil) {
    if (document.getElementById('pg-switch-btn')) document.getElementById('pg-switch-btn').remove();
    const btn = document.createElement('button');
    btn.id = 'pg-switch-btn';
    btn.innerHTML = `
      <span class="pg-switch-avatar" style="background:${perfil.tipo === 'admin' ? '#6C63FF' : colorFor(perfil.nombre)}">
        ${perfil.tipo === 'admin' ? '👑' : esc((perfil.nombre||'?').trim().charAt(0).toUpperCase())}
      </span>
      <span class="pg-switch-label">${esc(perfil.nombre)} · cambiar</span>
    `;
    btn.addEventListener('click', () => {
      limpiarSesion();
      location.href = 'dashboard.html';
    });
    document.body.appendChild(btn);
  }

  // ------------------------------------------------------------
  // Presencia: marca "ultima_conexion" en usuarios cada cierto
  // tiempo mientras la pestaña esté abierta, para que admin.html
  // pueda mostrar "en línea" / "última conexión" por usuario.
  // ------------------------------------------------------------
  const PG_HEARTBEAT_MS = 45000; // 45s

  async function latirPresencia() {
    try {
      if (!PG.client || !PG.authUserId) return;
      await PG.client
        .from('usuarios')
        .update({ ultima_conexion: new Date().toISOString() })
        .eq('auth_user_id', PG.authUserId);
    } catch (e) { /* best-effort: nunca interrumpe la página */ }
  }

  function iniciarHeartbeat() {
    if (PG._heartbeatIniciado) return;
    PG._heartbeatIniciado = true;
    latirPresencia();
    setInterval(() => {
      if (document.visibilityState === 'visible') latirPresencia();
    }, PG_HEARTBEAT_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') latirPresencia();
    });
  }

  // ------------------------------------------------------------
  // Badge flotante de notificaciones: cuenta cuántos avisos
  // publicados por el admin (tabla notificaciones) aún no ha
  // leído este usuario, y enlaza a notificaciones.html.
  // No se muestra en notificaciones.html (ya está ahí adentro).
  // ------------------------------------------------------------
  const PG_NOTIF_POLL_MS = 60000; // 60s

  async function contarNoLeidas() {
    if (!PG.client || !PG.authUserId) return 0;
    const { data: todas, error: e1 } = await PG.client
      .from('notificaciones')
      .select('id')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    if (e1 || !todas) return 0;
    if (todas.length === 0) return 0;
    const { data: leidas, error: e2 } = await PG.client
      .from('notificaciones_leidas')
      .select('notificacion_id')
      .eq('auth_user_id', PG.authUserId);
    if (e2) return 0;
    const idsLeidas = new Set((leidas || []).map(l => l.notificacion_id));
    return todas.filter(n => !idsLeidas.has(n.id)).length;
  }

  function renderBadge(count) {
    let btn = document.getElementById('pg-notif-badge');
    if (!btn) {
      btn = document.createElement('div');
      btn.id = 'pg-notif-badge';
      btn.title = 'Notificaciones';
      btn.style.cssText = `
        position:fixed; bottom:22px; right:22px; z-index:9998;
        width:52px; height:52px; border-radius:50%;
        background:#5a5af4; color:#fff; display:flex;
        align-items:center; justify-content:center;
        box-shadow:0 6px 20px rgba(90,90,244,0.35);
        cursor:pointer; font-size:22px; user-select:none;
        transition:transform .15s ease;
      `;
      btn.onmouseenter = () => btn.style.transform = 'scale(1.08)';
      btn.onmouseleave = () => btn.style.transform = 'scale(1)';
      btn.innerHTML = `
        <span style="pointer-events:none;">🔔</span>
        <span id="pg-notif-count" style="
          position:absolute; top:-4px; right:-4px;
          background:#ef4444; color:#fff; font-size:11px;
          font-weight:700; line-height:1; padding:4px 6px;
          border-radius:999px; display:none;
        "></span>
      `;
      btn.addEventListener('click', () => { location.href = 'notificaciones.html'; });
      document.body.appendChild(btn);
    }
    const countEl = btn.querySelector('#pg-notif-count');
    if (count > 0) {
      countEl.textContent = count > 99 ? '99+' : String(count);
      countEl.style.display = 'block';
    } else {
      countEl.style.display = 'none';
    }
  }

  async function actualizarBadge() {
    try {
      const n = await contarNoLeidas();
      renderBadge(n);
    } catch (e) { /* best-effort */ }
  }

  function iniciarBadgeNotificaciones() {
    if (currentFile() === 'notificaciones.html') return; // no se muestra dentro del propio módulo
    if (PG._badgeIniciado) return;
    PG._badgeIniciado = true;
    actualizarBadge();
    setInterval(actualizarBadge, PG_NOTIF_POLL_MS);
  }

  // ------------------------------------------------------------
  // API pública: candado de "Configuración" con el código de
  // administrador (el MISMO código que ya protege "Gestionar
  // usuarios" — perfiles_acceso.tipo = 'admin'). No crea ningún
  // sistema nuevo, solo reutiliza el existente para una página más.
  //
  // Uso desde configuracion.html:
  //   PerfilesGuardConfig.requerirCodigoAdmin(() => { ...mostrar la página... });
  //
  // Si el administrador aún no tiene código configurado, se le
  // pide crearlo en ese momento (mismo flujo que ya existe). Una
  // vez desbloqueado, no se vuelve a pedir en la misma pestaña
  // del navegador (sessionStorage), igual que el resto del
  // sistema de perfiles.
  // ------------------------------------------------------------
  const PG_CFG_KEY = 'n360_cfg_desbloqueado';

  window.PerfilesGuardConfig = {
    async requerirCodigoAdmin(onDesbloqueado) {
      try {
        if (typeof onDesbloqueado !== 'function') return;
        if (!window.supabase) { onDesbloqueado(); return; }
        if (!PG.client) PG.client = window.supabase.createClient(PG_SUPABASE_URL, PG_SUPABASE_KEY);

        const { data: { session } } = await PG.client.auth.getSession();
        if (!session) { onDesbloqueado(); return; } // el checkAuth propio de la página manda a login

        PG.authUserId = session.user.id;
        PG.authEmail  = session.user.email || null;

        // Ya se desbloqueó antes en esta misma pestaña: no se vuelve a pedir.
        try {
          const raw = sessionStorage.getItem(PG_CFG_KEY);
          if (raw) {
            const s = JSON.parse(raw);
            if (s && s.authUserId === PG.authUserId) { onDesbloqueado(); return; }
          }
        } catch (_) { /* ignorar y seguir pidiendo el código */ }

        PG.perfiles = await cargarPerfiles();
        const admin = PG.perfiles.find(p => p.tipo === 'admin');
        if (!admin) { onDesbloqueado(); return; } // no debería pasar: cargarPerfiles siempre crea uno

        showOverlay();
        renderPin(admin, {
          tituloExtra: 'Ingresa el código de administrador para entrar a Configuración',
          onSuccess: () => {
            try { sessionStorage.setItem(PG_CFG_KEY, JSON.stringify({ authUserId: PG.authUserId })); } catch (_) {}
            hideOverlay();
            onDesbloqueado();
          },
        });
      } catch (e) {
        console.error('PerfilesGuardConfig.requerirCodigoAdmin:', e);
        onDesbloqueado(); // nunca bloquear el acceso del dueño por un error de red/consulta
      }
    },
  };

  // ------------------------------------------------------------
  // Arranque
  // ------------------------------------------------------------
  async function init() {
    if (!window.supabase) return; // la página no cargó el SDK de Supabase
    PG.client = window.supabase.createClient(PG_SUPABASE_URL, PG_SUPABASE_KEY);

    const { data: { session } } = await PG.client.auth.getSession();
    if (!session) return; // el propio checkAuth() de cada página se encargará del login

    PG.authUserId = session.user.id;
    PG.authEmail  = session.user.email || null;

    // Presencia (última conexión / en línea) y badge de notificaciones:
    // corren siempre que haya sesión, independientemente del sistema de
    // perfiles/PIN. Best-effort: cualquier fallo se ignora en silencio.
    iniciarHeartbeat();
    iniciarBadgeNotificaciones();

    // Si el dueño de la cuenta desactivó el sistema multiusuario en
    // configuración.html, no se pide selector ni PIN: se entra directo.
    const { data: cfgUsuario } = await PG.client
      .from('usuarios')
      .select('multiusuario_activo')
      .eq('auth_user_id', PG.authUserId)
      .maybeSingle();
    if (cfgUsuario && cfgUsuario.multiusuario_activo === false) return;

    PG.perfiles = await cargarPerfiles();

    const sesionActiva = getSesion();
    if (sesionActiva) {
      const perfilVivo = PG.perfiles.find(p => p.id === sesionActiva.id) || sesionActiva;
      aplicarRestricciones(perfilVivo);
      redirigirSiHaceFalta(perfilVivo);
      return;
    }

    // Sin perfil elegido en esta pestaña: si no estamos en dashboard,
    // se manda primero ahí para completar la elección obligatoria.
    // EXCEPCIÓN: personalizacion.html es el asistente de bienvenida que
    // ve un usuario recién registrado — ahí todavía no existe ninguna
    // cuenta configurada, así que no tiene sentido (ni debe) mandarlo
    // al dashboard antes de que termine de configurar su negocio.
    if (currentFile() !== 'dashboard.html' && currentFile() !== 'personalizacion.html') {
      location.href = 'dashboard.html';
      return;
    }

    showOverlay();
    renderSelector();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
