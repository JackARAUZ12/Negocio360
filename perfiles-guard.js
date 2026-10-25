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
    limitePerfiles: 5,
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
  // Se guarda una sola vez por carga de página: ¿esta cuenta es en
  // realidad una sucursal? Se usa para no intentar crear/editar
  // perfiles aquí — eso sigue siendo exclusivo de la Central.
  PG.soyUnaSucursal = null;
  async function esUnaSucursal() {
    if (PG.soyUnaSucursal !== null) return PG.soyUnaSucursal;
    try {
      const { data } = await PG.client.from('sucursales')
        .select('id').eq('auth_user_id_sucursal', PG.authUserId).eq('es_central', false).maybeSingle();
      PG.soyUnaSucursal = !!data;
    } catch (_) { PG.soyUnaSucursal = false; }
    return PG.soyUnaSucursal;
  }

  async function cargarPerfiles() {
    // Mismos perfiles (mismos nombres, mismo código) sin importar si
    // esto corre en la Central o en cualquiera de sus sucursales — la
    // función siempre resuelve a los perfiles reales de la Central.
    let { data, error } = await PG.client.rpc('listar_perfiles_del_grupo_v2');
    if (error) ({ data, error } = await PG.client.rpc('listar_perfiles_del_grupo'));
    if (error) { console.error('perfiles-guard cargarPerfiles:', error); return []; }
    let perfiles = data || [];

    // Garantiza que siempre exista el perfil Admin (principal) — pero
    // crearlo solo es posible desde la propia Central (una sucursal no
    // tiene permiso de escribir en la tabla de perfiles de otra cuenta,
    // a propósito). La creación pasa por una función segura de la base
    // de datos: el navegador ya no escribe perfiles de administrador.
    if (!perfiles.some(p => p.tipo === 'admin') && !(await esUnaSucursal())) {
      const { error: errAs } = await PG.client.rpc('admin_asegurar_principal');
      if (!errAs) {
        const r2 = await PG.client.rpc('listar_perfiles_del_grupo_v2');
        if (!r2.error && r2.data) perfiles = r2.data;
      }
    }
    perfiles.sort((a, b) => (a.tipo === 'admin' ? -1 : b.tipo === 'admin' ? 1 : 0) || (b.es_principal ? 1 : 0) - (a.es_principal ? 1 : 0));
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
    asegurarContrasteCard(div.firstElementChild);
    return div;
  }

  // Las paginas del sistema tienen temas distintos (claro/oscuro): el panel de usuarios toma
  // --bg-card y --text-primary de la pagina, y en algunas quedaba fondo blanco con letras
  // blancas. Aqui se mira el fondo REAL del panel y se fijan colores de texto/campos que
  // siempre contrasten con ese fondo, sin cambiar el fondo que ya tenia.
  function asegurarContrasteCard(el) {
    try {
      const m = (getComputedStyle(el).backgroundColor || '').match(/rgba?\(([^)]+)\)/);
      let claro = true;
      if (m) {
        const p = m[1].split(',').map(v => parseFloat(v));
        const alfa = p.length > 3 ? p[3] : 1;
        if (alfa < 0.9) { el.style.background = '#fff'; }
        else claro = (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) > 150;
      } else { el.style.background = '#fff'; }
      const v = claro
        ? { '--text-primary': '#1A1D2E', '--text-secondary': '#4B5563', '--text-muted': '#6B7280', '--border': '#E5E7EB', '--bg-app': '#F0F2F5', '--bg-input': '#fff' }
        : { '--text-primary': '#F0F0FA', '--text-secondary': '#C7CAD9', '--text-muted': '#9CA3AF', '--border': 'rgba(255,255,255,.16)', '--bg-app': 'rgba(255,255,255,.07)', '--bg-input': 'rgba(255,255,255,.07)' };
      Object.keys(v).forEach(k => el.style.setProperty(k, v[k]));
    } catch (_) { /* nunca debe impedir que se vea el selector */ }
  }
  // Bloqueo total de pantalla — funciona en CUALQUIER página, sin
  // depender de ningún estilo propio de esa página (por eso todo va
  // con estilos en línea). Cubre absolutamente todo, no deja pasar
  // ningún clic ni scroll hacia lo que esté debajo.
  function mostrarBloqueoCuenta(estado) {
    document.documentElement.style.overflow = 'hidden';
    const esCancelada = estado === 'cancelada';
    const div = document.createElement('div');
    div.id = 'pg-bloqueo-cuenta';
    div.style.cssText = `
      position:fixed; inset:0; z-index:2147483647; background:#0b0d14;
      display:flex; align-items:center; justify-content:center; padding:24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    `;
    div.innerHTML = `
      <div style="max-width:380px; text-align:center; background:#161923; border:1px solid #2a2f3d; border-radius:16px; padding:36px 28px; box-shadow:0 20px 60px rgba(0,0,0,.5)">
        <div style="font-size:44px; margin-bottom:12px">${esCancelada ? '❌' : '🔒'}</div>
        <div style="font-size:19px; font-weight:800; color:#fff; margin-bottom:8px">
          ${esCancelada ? 'Cuenta cancelada' : 'Cuenta suspendida'}
        </div>
        <div style="font-size:13.5px; color:#9CA3AF; line-height:1.6; margin-bottom:22px">
          ${esCancelada
            ? 'Tu cuenta ha sido cancelada. Puedes reactivarla eligiendo un plan.'
            : 'Tu cuenta ha sido suspendida temporalmente. Contacta a soporte para reactivarla.'}
        </div>
        <button id="pg-bloqueo-btn" style="width:100%; padding:12px; border:none; border-radius:10px; background:#5A5AF4; color:#fff; font-size:14px; font-weight:700; cursor:pointer; margin-bottom:10px">
          ${esCancelada ? 'Ver planes' : 'Contactar soporte'}
        </button>
        <button id="pg-bloqueo-salir" style="width:100%; padding:12px; border:1px solid #2a2f3d; border-radius:10px; background:transparent; color:#9CA3AF; font-size:13px; font-weight:600; cursor:pointer">
          Cerrar sesión
        </button>
      </div>
    `;
    document.body.appendChild(div);
    document.getElementById('pg-bloqueo-btn').addEventListener('click', () => {
      window.location.href = esCancelada ? 'planes.html' : 'mailto:soporte@negocio360.app';
    });
    document.getElementById('pg-bloqueo-salir').addEventListener('click', async () => {
      try { await PG.client.auth.signOut(); } catch (e) {}
      window.location.href = 'login.html';
    });
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
        ${p.tipo === 'admin' ? `<div class="pg-profile-badge">Admin${p.es_principal && PG.perfiles.filter(x => x.tipo === 'admin').length > 1 ? ' · Principal' : ''}</div>` : ''}
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
    pedirCodigoAdmin({ onSuccess: () => renderGestionUsuarios(), tituloExtra: 'Se requiere el código de administrador' });
  }

  // Pide "el código de administrador": con un solo admin se comporta
  // exactamente igual que siempre; con varios admins basta el código de
  // CUALQUIERA de ellos y el sistema detecta cuál es (se verifica en la
  // base de datos, con bloqueo tras intentos fallidos).
  function pedirCodigoAdmin({ onSuccess, tituloExtra } = {}) {
    const admins = PG.perfiles.filter(p => p.tipo === 'admin');
    if (!admins.length) return;
    const sinCodigo = admins.find(a => !a.codigo_configurado);
    if (admins.length === 1 || sinCodigo) { renderPin(sinCodigo || admins[0], { onSuccess, tituloExtra }); return; }
    renderPin({ tipo: 'admin', id: null, nombre: 'Administrador', codigo_configurado: true },
      { onSuccess, tituloExtra: tituloExtra || 'Ingresa el código de administrador', cualquierAdmin: true });
  }
  function textoErrorCodigoAdmin(r) {
    if (!r) return 'No se pudo verificar el código. Intenta de nuevo.';
    if (r.motivo === 'bloqueado') { const m = Math.max(1, Math.ceil((r.bloqueado_seg || 60) / 60)); return `Demasiados intentos fallidos. Espera ${m} minuto${m === 1 ? '' : 's'} e intenta de nuevo.`; }
    if (r.motivo === 'incorrecto') return r.restantes > 0 && r.restantes <= 3 ? `Código incorrecto (te quedan ${r.restantes} intento${r.restantes === 1 ? '' : 's'})` : 'Código incorrecto';
    return 'Código incorrecto';
  }
  async function verificarCodigoAdmin(pin, perfilId, motivo, cliente) {
    try {
      const { data, error } = await (cliente || PG.client).rpc('admin_verificar_codigo', { p_pin: pin, p_perfil_id: perfilId || null, p_motivo: motivo || 'acceso' });
      if (error) throw error;
      return data;
    } catch (e) { console.error('verificarCodigoAdmin:', e); return null; }
  }

  // ------------------------------------------------------------
  // Vista: PIN (establecer o ingresar)
  // ------------------------------------------------------------
  function renderPin(perfil, { onSuccess, tituloExtra, forzarNuevo, cualquierAdmin } = {}) {
    const c = card();
    const necesitaCrearCodigo = !!forzarNuevo || (perfil.tipo === 'admin' && !perfil.codigo_configurado);
    // Configurar un código por primera vez solo se puede hacer desde la
    // propia Central (ahí sí tiene permiso de escribir su propia tabla
    // de perfiles) — nunca desde dentro de una sucursal.
    if (necesitaCrearCodigo && PG.soyUnaSucursal) {
      c.innerHTML = `
        <div class="pg-back-arrow" id="pg-back">← Volver</div>
        <div class="pg-pin-wrap">
          <div class="pg-pin-avatar" style="background:#1A1D2E">👑</div>
          <div class="pg-title" style="margin-bottom:2px">${esc(perfil.nombre)}</div>
          <div class="pg-subtitle">Este perfil todavía no tiene un código configurado. Pídele al administrador que lo configure desde la cuenta principal.</div>
        </div>`;
      document.getElementById('pg-back').addEventListener('click', renderSelector);
      return;
    }
    const esNuevo = necesitaCrearCodigo;
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
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-codigo-1" />
        ${esNuevo ? `<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
               class="pg-pin-input" id="pg-pin-2" placeholder="Confirmar código"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
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
    if (forgotEl) forgotEl.addEventListener('click', () => renderOlvideCodigo(cualquierAdmin ? (PG.perfiles.find(x => x.tipo === 'admin' && x.es_principal) || PG.perfiles.find(x => x.tipo === 'admin')) : perfil, { onSuccess }));

    const input1 = document.getElementById('pg-pin-1');
    const input2 = document.getElementById('pg-pin-2');
    const errEl  = document.getElementById('pg-pin-error');
    input1.focus();

    async function intentar() {
      errEl.textContent = '';
      const pin1 = (input1.value || '').trim();
      if (pin1.length < 4) { errEl.textContent = 'El código debe tener al menos 4 dígitos'; return; }

      const okBtn = document.getElementById('pg-pin-ok');
      if (esNuevo) {
        const pin2 = (input2.value || '').trim();
        if (pin1 !== pin2) { errEl.textContent = 'Los códigos no coinciden'; return; }
        if (perfil.tipo === 'admin') {
          // Los códigos de administrador se guardan SOLO en la base de datos (función segura)
          okBtn.disabled = true;
          try {
            const { data: r, error } = await PG.client.rpc('admin_definir_codigo', { p_perfil_id: perfil.id, p_pin: pin1, p_modo: forzarNuevo ? 'recuperacion' : 'inicial' });
            if (error || !r) throw error || new Error('sin respuesta');
            if (!r.ok) {
              errEl.textContent = r.motivo === 'codigo_en_uso' ? 'Ese código ya lo usa otro administrador. Elige uno distinto.'
                : r.motivo === 'sesion_antigua' ? 'Por seguridad, vuelve a confirmar tu contraseña e intenta de nuevo.'
                : r.motivo === 'formato' ? 'Usa solo números (de 4 a 6 dígitos).'
                : 'No se pudo guardar el código. Intenta de nuevo.';
              okBtn.disabled = false; return;
            }
          } catch (e) { console.error('admin_definir_codigo:', e); errEl.textContent = 'No se pudo guardar el código. Intenta de nuevo.'; okBtn.disabled = false; return; }
          perfil.codigo_configurado = true;
          PG.adminActual = { id: perfil.id, nombre: perfil.nombre, principal: !!perfil.es_principal };
          onSuccess && onSuccess(perfil);
          return;
        }
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

      if (perfil.tipo === 'admin') {
        // Verificación en la base de datos (con bloqueo tras intentos fallidos)
        okBtn.disabled = true;
        const r = await verificarCodigoAdmin(pin1, cualquierAdmin ? null : perfil.id, 'acceso');
        okBtn.disabled = false;
        if (!r || !r.ok) {
          errEl.textContent = textoErrorCodigoAdmin(r);
          input1.value = ''; input1.focus();
          return;
        }
        const quien = PG.perfiles.find(x => x.id === r.perfil_id) || perfil;
        PG.adminActual = { id: r.perfil_id, nombre: r.nombre, principal: !!r.principal };
        onSuccess && onSuccess(quien);
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
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
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
      const r = await verificarCodigoAdmin(val, null, 'restablecer_codigo');
      if (!r || !r.ok) {
        errEl.textContent = r && r.motivo === 'bloqueado' ? textoErrorCodigoAdmin(r) : 'Código de administrador incorrecto';
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
  function renderGestionUsuarios(mensajeExito) {
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
      ${mensajeExito ? `<div style="background:rgba(34,197,94,.15);color:#16a34a;font-size:12.5px;font-weight:600;text-align:center;border-radius:8px;padding:8px;margin-bottom:10px">✅ ${esc(mensajeExito)}</div>` : ''}
      <div class="pg-subtitle">Crea perfiles con acceso limitado a ciertos módulos</div>
      <div class="pg-section-title">Usuarios con acceso restringido</div>
      ${filas}
      <button class="pg-btn pg-btn-primary" id="pg-nuevo-usuario" style="width:100%;margin-top:6px">+ Nuevo usuario</button>
      ${bloqueAdministradores()}
    `;
    enlazarBloqueAdministradores(c);

    document.getElementById('pg-back').addEventListener('click', renderSelector);
    document.getElementById('pg-nuevo-usuario').addEventListener('click', () => {
      if (PG.perfiles.length >= PG.limitePerfiles) { renderPaywallUsuarios(); return; }
      renderFormUsuario(null);
    });
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
        await PG.client.rpc('eliminar_perfil_grupo', { p_id: id });
        PG.perfiles = await cargarPerfiles();
        renderGestionUsuarios();
      });
    });
  }

  // ------------------------------------------------------------
  // Administradores adicionales — solo el administrador PRINCIPAL
  // puede crearlos o quitarlos (y siempre confirmando su código, que
  // se verifica en la base de datos). Va en una sección plegada para
  // no estorbar a quien solo usa un administrador.
  // ------------------------------------------------------------
  function bloqueAdministradores() {
    const admins = PG.perfiles.filter(p => p.tipo === 'admin');
    const soyPrincipal = !!(PG.adminActual && PG.adminActual.principal);
    const filas = admins.map(a => `
      <div class="pg-user-row" data-id="${a.id}">
        <div class="pg-avatar" style="background:#1A1D2E">👑</div>
        <div class="pg-user-row-info">
          <div class="pg-user-row-name">${esc(a.nombre)}</div>
          <div class="pg-user-row-mods">${a.es_principal ? 'Administrador principal' : 'Administrador'}</div>
        </div>
        ${soyPrincipal && !a.es_principal ? '<button class="pg-icon-btn pg-icon-danger pg-del-admin" title="Quitar administrador">🗑️</button>' : ''}
      </div>`).join('');
    return `
      <details style="margin-top:14px" id="pg-admins-det">
        <summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text-muted,#9CA3AF)">👑 Administradores (${admins.length})</summary>
        <div style="margin-top:8px">
          ${filas}
          ${soyPrincipal
            ? '<button class="pg-btn pg-btn-ghost" id="pg-nuevo-admin" style="width:100%;margin-top:6px">+ Nuevo administrador</button><div id="pg-admin-eventos" style="margin-top:10px;font-size:11.5px;color:var(--text-muted,#9CA3AF)"></div>'
            : '<p style="font-size:11.5px;color:var(--text-muted,#9CA3AF);margin:8px 0 0">Solo el administrador principal puede crear o quitar administradores.</p>'}
        </div>
      </details>`;
  }
  function enlazarBloqueAdministradores(c) {
    const nuevo = c.querySelector('#pg-nuevo-admin');
    if (nuevo) nuevo.addEventListener('click', () => {
      if (PG.perfiles.length >= PG.limitePerfiles) { renderPaywallUsuarios(); return; }
      renderFormAdmin();
    });
    c.querySelectorAll('.pg-del-admin').forEach(btn => btn.addEventListener('click', () => {
      const a = PG.perfiles.find(x => x.id === btn.closest('.pg-user-row').dataset.id);
      if (a) renderEliminarAdmin(a);
    }));
    const ev = c.querySelector('#pg-admin-eventos');
    if (ev) {
      PG.client.from('perfiles_admin_eventos').select('perfil_nombre,accion,detalle,created_at')
        .eq('auth_user_id', PG.authUserId).order('created_at', { ascending: false }).limit(8)
        .then(({ data }) => {
          const nombres = { codigo_ok: 'Código correcto', codigo_incorrecto: 'Código incorrecto', bloqueo: 'Bloqueo por intentos', admin_creado: 'Administrador creado', admin_eliminado: 'Administrador quitado', codigo_definido: 'Código definido' };
          if (!data || !data.length) return;
          ev.innerHTML = '<b>Actividad reciente</b>' + data.map(e => `<div>${esc(new Date(e.created_at).toLocaleString('es-NI', { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(nombres[e.accion] || e.accion)}${e.perfil_nombre ? ' · ' + esc(e.perfil_nombre) : ''}${e.detalle ? ' (' + esc(e.detalle) + ')' : ''}</div>`).join('');
        }).catch(() => {});
    }
  }
  function textoErrorAdmin(r) {
    if (!r) return 'No se pudo completar. Intenta de nuevo.';
    const m = { bloqueado: textoErrorCodigoAdmin(r), incorrecto: 'Tu código de administrador principal es incorrecto', formato: 'El código debe tener de 4 a 6 números', nombre: 'Escribe un nombre válido', nombre_repetido: 'Ya existe un usuario con ese nombre', codigo_en_uso: 'Ese código ya lo usa otro administrador. Elige uno distinto.', solo_central: 'Esto solo se puede hacer desde la cuenta principal', es_principal: 'El administrador principal no se puede quitar' };
    return m[r.motivo] || 'No se pudo completar. Intenta de nuevo.';
  }
  function renderFormAdmin() {
    const c = card();
    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-back">← Volver</div>
      <div class="pg-title">Nuevo administrador</div>
      <div class="pg-subtitle">Tendrá acceso total y su propio código. Solo tú, como administrador principal, puedes crearlo o quitarlo.</div>
      <div class="pg-field"><label>Nombre</label><input type="text" id="pg-na-nombre" maxlength="40" autocomplete="off" /></div>
      <div class="pg-field"><label>Código del nuevo administrador (4 a 6 números)</label>
        <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" id="pg-na-pin" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-na-pin" /></div>
      <div class="pg-field"><label>Tu código de administrador principal</label>
        <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" id="pg-na-auth" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-na-auth" /></div>
      <div class="pg-error" id="pg-na-error"></div>
      <div class="pg-btn-row"><button class="pg-btn pg-btn-ghost" id="pg-na-cancel">Cancelar</button><button class="pg-btn pg-btn-primary" id="pg-na-ok">Crear administrador</button></div>`;
    document.getElementById('pg-back').addEventListener('click', () => renderGestionUsuarios());
    document.getElementById('pg-na-cancel').addEventListener('click', () => renderGestionUsuarios());
    document.getElementById('pg-na-ok').addEventListener('click', async () => {
      const err = document.getElementById('pg-na-error'); err.textContent = '';
      const nombre = document.getElementById('pg-na-nombre').value.trim(), pin = document.getElementById('pg-na-pin').value.trim(), auth = document.getElementById('pg-na-auth').value.trim();
      if (!nombre) { err.textContent = 'Escribe el nombre'; return; }
      if (!/^[0-9]{4,6}$/.test(pin)) { err.textContent = 'El código debe tener de 4 a 6 números'; return; }
      if (auth.length < 4) { err.textContent = 'Escribe tu código de administrador principal'; return; }
      const btn = document.getElementById('pg-na-ok'); btn.disabled = true;
      try {
        const { data: r, error } = await PG.client.rpc('admin_crear_admin', { p_nombre: nombre, p_pin: pin, p_pin_principal: auth });
        if (error) throw error;
        if (r && r.motivo === 'limite') { renderPaywallUsuarios(); return; }
        if (!r || !r.ok) { err.textContent = textoErrorAdmin(r); btn.disabled = false; return; }
        PG.perfiles = await cargarPerfiles();
        renderGestionUsuarios(`Administrador "${nombre}" creado correctamente`);
      } catch (e) { console.error('admin_crear_admin:', e); err.textContent = 'No se pudo crear. Intenta de nuevo.'; btn.disabled = false; }
    });
  }
  function renderEliminarAdmin(a) {
    const c = card();
    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-back">← Volver</div>
      <div class="pg-title">Quitar administrador</div>
      <div class="pg-subtitle">"${esc(a.nombre)}" ya no podrá entrar con su código. Confirma con tu código de administrador principal.</div>
      <div class="pg-field"><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" id="pg-ea-auth" placeholder="Tu código de administrador principal" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-ea-auth" /></div>
      <div class="pg-error" id="pg-ea-error"></div>
      <div class="pg-btn-row"><button class="pg-btn pg-btn-ghost" id="pg-ea-cancel">Cancelar</button><button class="pg-btn pg-btn-primary" id="pg-ea-ok">Quitar</button></div>`;
    document.getElementById('pg-back').addEventListener('click', () => renderGestionUsuarios());
    document.getElementById('pg-ea-cancel').addEventListener('click', () => renderGestionUsuarios());
    document.getElementById('pg-ea-ok').addEventListener('click', async () => {
      const err = document.getElementById('pg-ea-error'); err.textContent = '';
      const auth = document.getElementById('pg-ea-auth').value.trim();
      if (auth.length < 4) { err.textContent = 'Escribe tu código de administrador principal'; return; }
      const btn = document.getElementById('pg-ea-ok'); btn.disabled = true;
      try {
        const { data: r, error } = await PG.client.rpc('admin_eliminar_admin', { p_perfil_id: a.id, p_pin_principal: auth });
        if (error) throw error;
        if (!r || !r.ok) { err.textContent = textoErrorAdmin(r); btn.disabled = false; return; }
        PG.perfiles = await cargarPerfiles();
        renderGestionUsuarios(`Administrador "${a.nombre}" quitado`);
      } catch (e) { console.error('admin_eliminar_admin:', e); err.textContent = 'No se pudo quitar. Intenta de nuevo.'; btn.disabled = false; }
    });
  }

  // Se muestra cuando la cuenta ya alcanzo su limite de perfiles
  // (5 por defecto, ajustable por cuenta desde el panel admin).
  // No bloquea nada de lo ya existente -- solo impide crear MAS
  // usuarios de los permitidos, ofreciendo el precio real y un
  // camino directo a WhatsApp para ampliarlo.
  function renderPaywallUsuarios() {
    const c = card();
    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-back">← Volver</div>
      <div class="pg-title">Llegaste al límite de tu plan</div>
      <div class="pg-subtitle">Tu cuenta permite hasta ${PG.limitePerfiles} usuario${PG.limitePerfiles===1?'':'s'}. Para agregar más, cada usuario adicional tiene un costo simple:</div>
      <div class="pg-paywall-price">
        <div class="pg-paywall-price-tag">$1<span>USD / usuario / mes</span></div>
        <ul class="pg-paywall-list">
          <li>✅ Su propio código de acceso (PIN)</li>
          <li>✅ Permisos por módulo, a tu medida</li>
          <li>✅ Se activa el mismo día</li>
        </ul>
      </div>
      <button class="pg-btn pg-paywall-wa" id="pg-paywall-wa">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.7.2-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-1.8-.9-3-1.6-4.2-3.6-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3.1.8.8-3-.2-.3a8.2 8.2 0 1 1 7.2 3.9z"/></svg>
        Ampliar por WhatsApp
      </button>
    `;
    document.getElementById('pg-back').addEventListener('click', () => renderGestionUsuarios());
    document.getElementById('pg-paywall-wa').addEventListener('click', () => {
      const nombreNegocio = document.title || 'mi negocio';
      const msg = encodeURIComponent(`Hola, ya llegué al límite de ${PG.limitePerfiles} usuarios en mi cuenta de Negocio360 y quiero agregar más usuarios ($1/usuario).`);
      window.open(`https://wa.me/50581294177?text=${msg}`, '_blank', 'noopener');
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

    document.getElementById('pg-back').addEventListener('click', () => renderGestionUsuarios());
    const cancelBtn = document.getElementById('pg-f-cancelar');
    if (cancelBtn) cancelBtn.addEventListener('click', () => renderGestionUsuarios());
    const delBtn = document.getElementById('pg-f-eliminar');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar al usuario "${perfilExistente.nombre}"?`)) return;
      await PG.client.rpc('eliminar_perfil_grupo', { p_id: perfilExistente.id });
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

      // Si el formulario falla la validación, el aviso rojo siempre se
      // desplaza a la vista y queda resaltado un momento — antes, si el
      // formulario era largo (muchos módulos), el mensaje de error podía
      // quedar fuera de la pantalla y la persona pensaba que "no pasó
      // nada" al presionar Guardar.
      const mostrarError = (msg) => {
        errEl.textContent = msg;
        errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        errEl.style.transition = 'none';
        errEl.style.background = 'rgba(239,68,68,.15)';
        setTimeout(() => { errEl.style.transition = 'background .6s'; errEl.style.background = 'transparent'; }, 50);
      };

      if (!nombre) { mostrarError('El nombre es obligatorio'); return; }
      if (!editando && pin.length < 4) { mostrarError('Define un código de al menos 4 dígitos'); return; }
      if (pin && pin.length > 0 && pin.length < 4) { mostrarError('El código debe tener al menos 4 dígitos'); return; }
      if (!modulosSel.length) { mostrarError('Selecciona al menos un módulo permitido'); return; }

      try {
        if (editando) {
          const { error } = await PG.client.rpc('editar_perfil_grupo', {
            p_id: perfilExistente.id, p_nombre: nombre, p_modulos: modulosSel,
          });
          if (error) throw error;
          if (pin) {
            const hash = await hashPin(pin, perfilExistente.id);
            const { error: errHash } = await PG.client.rpc('actualizar_codigo_perfil_grupo', {
              p_id: perfilExistente.id, p_hash: hash,
            });
            if (errHash) throw errHash;
          }
        } else {
          // Se crea SIEMPRE en la Central real del grupo — sin importar
          // si el formulario se está usando desde la Central, una
          // sucursal o una bodega. Antes esto se guardaba en la cuenta
          // donde se estaba parado, invisible para el resto del grupo.
          const { data: creado, error: errIns } = await PG.client.rpc('crear_perfil_grupo', {
            p_nombre: nombre, p_tipo: 'restringido', p_modulos: modulosSel,
          });
          if (errIns && /limite_perfiles/.test(errIns.message || '')) { renderPaywallUsuarios(); return; }
          if (errIns) throw errIns;
          const nuevo = Array.isArray(creado) ? creado[0] : creado;
          if (!nuevo) throw new Error('No se pudo crear el usuario.');
          const hash = await hashPin(pin, nuevo.id);
          const { error: errHash } = await PG.client.rpc('actualizar_codigo_perfil_grupo', {
            p_id: nuevo.id, p_hash: hash,
          });
          if (errHash) throw errHash;
        }
        PG.perfiles = await cargarPerfiles();
        renderGestionUsuarios(editando ? 'Usuario actualizado' : `Usuario "${nombre}" creado correctamente`);
      } catch (e) {
        console.error('guardar usuario:', e);
        mostrarError(e.message?.includes('duplicate') || e.code === '23505'
          ? 'Ya existe un usuario con ese nombre'
          : 'No se pudo guardar. Intenta de nuevo.');
      }
    });
  }

  // ------------------------------------------------------------
  // Restricciones en pantalla (sidebar + acceso a la página actual)
  // ------------------------------------------------------------
  // Oculta absolutamente todo el menu lateral excepto Catalogo360 --
  // usado solo para cuentas INDEPENDIENTES (nunca para clientes
  // completos de Negocio360, ni siquiera con sub-perfiles restringidos,
  // que usan aplicarRestricciones() en vez de esta funcion).
  function restringirSoloACatalogo360() {
    const nodos = document.querySelectorAll('[onclick*="navigate("], a[href$=".html"], a[href*=".html?"]');
    nodos.forEach(el => {
      let href = el.getAttribute('href');
      if (!href) {
        const m = (el.getAttribute('onclick') || '').match(/navigate\(['"]([^'"?]+)/);
        href = m ? m[1] : null;
      }
      if (!href) return;
      const file = href.split('?')[0].split('/').pop();
      if (file !== 'catalogo360.html') {
        const item = el.closest('.nav-item') || el;
        item.style.display = 'none';
        item.classList.add('mg-oculto-modulo'); // el buscador del sidebar nunca lo vuelve a mostrar
      }
    });

    // Oculta títulos de sección que quedaron sin items visibles (ej.
    // "ACCESOS RÁPIDOS" completo, ya que ninguno de esos accesos es
    // Catálogo360).
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

  function primerModuloPermitido(perfil) {
    const permitido = MODULO_ORDEN.find(k => (perfil.modulos || []).includes(k));
    const entry = Object.entries(MODULOS).find(([, v]) => v.key === permitido);
    return entry ? entry[0] : 'dashboard.html';
  }

  function redirigirSiHaceFalta(perfil) {
    if (perfil.tipo === 'admin') return;
    const file = currentFile();
    const mod  = MODULOS[file];
    const panelOk = window.NEGOCIO360_PANEL_PERMITIDO && window.NEGOCIO360_PANEL_PERMITIDO(file, new Set(perfil.modulos || []));
    if (mod && mod.key !== 'chat' && !(perfil.modulos || []).includes(mod.key) && !panelOk) {
      location.href = primerModuloPermitido(perfil);
    }
  }

  function aplicarRestricciones(perfil) {
    inyectarBotonCambiarUsuario(perfil);
    forzarNombrePerfilEnUI(perfil);
    if (perfil.tipo === 'admin') { vigilarRestricciones(perfil); return; }

    ocultarNoPermitidos(perfil);
    vigilarRestricciones(perfil);
  }

  // Oculta todo enlace/acceso a un módulo que el perfil NO tiene asignado:
  // menú lateral, accesos rápidos del dashboard y los módulos especializados
  // (Transporte, Hotel, etc.) que otros scripts agregan después. Un perfil
  // restringido solo ve lo que el administrador le asignó (más Chat y Tutoriales).
  function ocultarNoPermitidos(perfil) {
    if (!perfil || perfil.tipo === 'admin') return;
    if (!document.getElementById('pg-css-ocultos')) {
      const st = document.createElement('style'); st.id = 'pg-css-ocultos';
      st.textContent = '.mg-oculto-modulo{display:none!important}';
      document.head.appendChild(st);
    }
    const permitidos = new Set(perfil.modulos || []);
    permitidos.add('chat'); // el Chat con Negocio360 (y Tutoriales) lo ven todos los usuarios
    // Cubre los patrones de sidebar/accesos del proyecto:
    //  <div onclick="navigate('ventas.html')">, <a href="ventas.html"> y onclick con location
    const nodos = document.querySelectorAll('[onclick*="navigate("], [onclick*=".html"], a[href$=".html"], a[href*=".html?"]');
    nodos.forEach(el => {
      let href = el.getAttribute('href');
      if (!href) {
        const m = (el.getAttribute('onclick') || '').match(/(?:navigate\(|location(?:\.href)?\s*=\s*|open\()\s*['"]([^'"?#]+\.html)/);
        href = m ? m[1] : null;
      }
      if (!href) return;
      const file = href.split('?')[0].split('/').pop();
      const mod  = MODULOS[file];
      const soloAdmin = (window.NEGOCIO360_MODULOS || {})[file]?.soloAdmin === true;
      if (!mod && !soloAdmin) return; // páginas no controladas (login, etc.) se dejan intactas
      const panelOk = window.NEGOCIO360_PANEL_PERMITIDO && window.NEGOCIO360_PANEL_PERMITIDO(file, permitidos);
      if (soloAdmin || (!permitidos.has(mod.key) && !panelOk)) { // Configuración y Auditoría son solo del administrador
        const item = el.closest('.nav-item') || el;
        item.style.display = 'none';
        item.classList.add('mg-oculto-modulo'); // el buscador del sidebar nunca lo vuelve a mostrar
      }
    });

    // Oculta títulos de sección de sidebar que quedaron sin items visibles
    document.querySelectorAll('.nav-section-title, .sidebar-section-label').forEach(title => {
      let n = title.nextElementSibling;
      let algunoVisible = false;
      while (n && !n.classList.contains('nav-section-title') && !n.classList.contains('sidebar-section-label')) {
        if (n.style.display !== 'none' && !n.classList.contains('mg-oculto-modulo')) algunoVisible = true;
        n = n.nextElementSibling;
      }
      title.style.display = algunoVisible ? '' : 'none';
    });
  }

  // Los módulos especializados y accesos rápidos se agregan a la página
  // DESPUÉS de cargar (cuando llega la configuración de la cuenta). Se vuelve
  // a aplicar la restricción cada vez que aparecen elementos nuevos.
  function vigilarRestricciones(perfil) {
    if (PG._vigia) { try { PG._vigia.disconnect(); } catch (_) {} PG._vigia = null; }
    if (!perfil || perfil.tipo === 'admin' || !window.MutationObserver || !document.body) return;
    let pendiente = false;
    PG._vigia = new MutationObserver(() => {
      if (pendiente) return; pendiente = true;
      setTimeout(() => { pendiente = false; try { ocultarNoPermitidos(perfil); } catch (_) {} }, 60);
    });
    PG._vigia.observe(document.body, { childList: true, subtree: true });
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
      // Se usa una funcion RPC que calcula la hora DENTRO del propio
      // servidor (now() de Postgres) en vez de mandar la hora del
      // reloj del dispositivo -- un celular con la fecha/hora mal
      // configurada podia dejar "ultima_conexion" en el pasado,
      // incluso antes de la propia fecha de creacion de la cuenta
      // (bug real confirmado en produccion).
      await PG.client.rpc('actualizar_ultima_conexion');
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
        if (window.N360VerComo && window.N360VerComo.activo) { onDesbloqueado(); return; } // Ver como cliente: sin código
        if (!PG.client) PG.client = window.supabase.createClient(PG_SUPABASE_URL, PG_SUPABASE_KEY);

        const { data: { session } } = await PG.client.auth.getSession();
        if (!session) { onDesbloqueado(); return; } // el checkAuth propio de la página manda a login

        PG.authUserId = session.user.id;
        PG.authEmail  = session.user.email || null;

        // Si el dueño desactivó el sistema multiusuario en Configuración,
        // no tiene sentido seguir pidiéndole un código de administrador
        // para entrar ahí. Antes esta verificación faltaba en este flujo
        // (solo estaba en el guardia general), y como el desbloqueo se
        // guardaba en sessionStorage -- que se borra al cerrar el
        // navegador -- el código se volvía a pedir en cada sesión nueva
        // aunque el multiusuario estuviera apagado.
        try {
          const { data: cfgUsuario } = await PG.client
            .from('usuarios')
            .select('multiusuario_activo')
            .eq('auth_user_id', PG.authUserId)
            .maybeSingle();
          if (cfgUsuario && cfgUsuario.multiusuario_activo === false) { onDesbloqueado(); return; }
        } catch (_) { /* si falla la consulta, se sigue pidiendo el código (más seguro) */ }

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
        pedirCodigoAdmin({
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

    // Reutilizado desde el módulo Sucursales: dispara el mismo flujo de
    // "volver a Central con tu código" (pide PIN, verifica contra los
    // perfiles reales de Central, restaura la sesión guardada).
    volverACentral(nombreSucursal) {
      if (!window.supabase) return;
      if (!PG.client) PG.client = window.supabase.createClient(PG_SUPABASE_URL, PG_SUPABASE_KEY);
      renderVolverACentral(nombreSucursal || 'tu sucursal actual');
    },

    // Como requerirCodigoAdmin(), pero SIEMPRE pide el código — nunca usa
    // la memoria de "ya desbloqueado en esta pestaña" que comparten
    // Configuración/Auditoría. Se usa para acciones más sensibles, como
    // otorgar accesos a una sucursal.
    async requerirCodigoAdminSiempre(onDesbloqueado) {
      try {
        if (typeof onDesbloqueado !== 'function') return;
        if (!window.supabase) { onDesbloqueado(); return; }
        if (window.N360VerComo && window.N360VerComo.activo) { onDesbloqueado(); return; } // Ver como cliente: sin código
        if (!PG.client) PG.client = window.supabase.createClient(PG_SUPABASE_URL, PG_SUPABASE_KEY);

        const { data: { session } } = await PG.client.auth.getSession();
        if (!session) { onDesbloqueado(); return; }
        PG.authUserId = session.user.id;
        PG.authEmail  = session.user.email || null;

        // Mismo criterio que requerirCodigoAdmin: con el multiusuario
        // apagado no hay perfiles que proteger, así que no se pide código.
        try {
          const { data: cfgUsuario } = await PG.client
            .from('usuarios')
            .select('multiusuario_activo')
            .eq('auth_user_id', PG.authUserId)
            .maybeSingle();
          if (cfgUsuario && cfgUsuario.multiusuario_activo === false) { onDesbloqueado(); return; }
        } catch (_) { /* si falla, se sigue pidiendo el código (más seguro) */ }

        PG.perfiles = await cargarPerfiles();
        const admin = PG.perfiles.find(p => p.tipo === 'admin');
        if (!admin) { onDesbloqueado(); return; }

        showOverlay();
        pedirCodigoAdmin({
          tituloExtra: 'Ingresa el código de administrador para continuar',
          onSuccess: () => { hideOverlay(); onDesbloqueado(); },
        });
      } catch (e) {
        console.error('PerfilesGuardConfig.requerirCodigoAdminSiempre:', e);
        onDesbloqueado();
      }
    },
  };

  // ------------------------------------------------------------
  // Indicador discreto "estás en la sucursal X" — visible en
  // cualquier página, pero pequeño y con los mismos colores/estilo
  // del resto del sistema (no una notificación llamativa). Al tocarlo
  // se abre el MISMO overlay/tarjeta de código que ya usa todo el
  // sistema de perfiles — nunca un prompt() del navegador.
  // ------------------------------------------------------------
  async function mostrarAvisoSucursalSiAplica() {
    try {
      const { data } = await PG.client.from('sucursales')
        .select('nombre').eq('auth_user_id_sucursal', PG.authUserId).eq('es_central', false).maybeSingle();
      if (!data) return;

      if (document.getElementById('pg-badge-sucursal')) return; // ya está puesto
      const style = document.createElement('style');
      style.textContent = `
        #pg-badge-sucursal{position:fixed;left:16px;bottom:16px;z-index:400;
          display:flex;align-items:center;gap:7px;background:var(--bg-surface,#fff);
          color:var(--text-secondary,#555);border:1px solid var(--border,#e4e4ea);
          padding:7px 12px;border-radius:100px;box-shadow:0 2px 10px rgba(0,0,0,.08);
          font-size:12px;font-weight:600;cursor:pointer;transition:box-shadow .15s,border-color .15s}
        #pg-badge-sucursal:hover{box-shadow:0 4px 14px rgba(0,0,0,.12);border-color:var(--accent,#6C63FF)}
        #pg-badge-sucursal .pg-badge-dot{width:6px;height:6px;border-radius:50%;background:var(--accent,#6C63FF);flex-shrink:0}
        @media (max-width:600px){#pg-badge-sucursal{left:8px;bottom:8px;max-width:calc(100vw - 16px)}
          #pg-badge-sucursal span.pg-badge-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
      `;
      document.head.appendChild(style);

      const badge = document.createElement('div');
      badge.id = 'pg-badge-sucursal';
      badge.innerHTML = `<span class="pg-badge-dot"></span><span class="pg-badge-txt">${esc(data.nombre)}</span>`;
      document.body.appendChild(badge);
      badge.addEventListener('click', () => renderVolverACentral(data.nombre));
    } catch (e) { /* si falla, simplemente no se muestra el indicador — nunca bloquea la página */ }
  }

  // Misma tarjeta visual que el resto del sistema de perfiles (avatar +
  // título + pg-pin-input con puntitos) — solo que en vez de comparar
  // contra un perfil ya cargado, verifica contra los perfiles reales
  // de la cuenta Central antes de restaurar esa sesión.
  function renderVolverACentral(nombreSucursal) {
    showOverlay();
    const c = card();
    c.innerHTML = `
      <div class="pg-back-arrow" id="pg-vc-back">← Volver</div>
      <div class="pg-pin-wrap">
        <div class="pg-pin-avatar" style="background:#1A1D2E">🏬</div>
        <div class="pg-title" style="margin-bottom:2px">Volver a tu cuenta principal</div>
        <div class="pg-subtitle" style="margin-bottom:4px">Sales de "${esc(nombreSucursal)}" — ingresa tu código de acceso</div>
        <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
               class="pg-pin-input" id="pg-vc-pin" placeholder="••••"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="pg-vc-codigo" />
        <div class="pg-error" id="pg-vc-error"></div>
        <div class="pg-btn-row">
          <button class="pg-btn pg-btn-ghost" id="pg-vc-cancel">Cancelar</button>
          <button class="pg-btn pg-btn-primary" id="pg-vc-ok">Entrar</button>
        </div>
      </div>
    `;
    document.getElementById('pg-vc-back').addEventListener('click', hideOverlay);
    document.getElementById('pg-vc-cancel').addEventListener('click', hideOverlay);
    const input = document.getElementById('pg-vc-pin');
    const errEl = document.getElementById('pg-vc-error');
    input.focus();

    async function intentar() {
      errEl.textContent = '';
      const pin = (input.value || '').trim();
      if (pin.length < 4) { errEl.textContent = 'El código debe tener al menos 4 dígitos'; return; }
      const okBtn = document.getElementById('pg-vc-ok');
      okBtn.disabled = true;
      const ok = await volverACentralConCodigo(pin);
      okBtn.disabled = false;
      if (!ok) { errEl.textContent = 'Código incorrecto'; input.value = ''; input.focus(); }
    }
    document.getElementById('pg-vc-ok').addEventListener('click', intentar);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') intentar(); });
  }

  // Pide el código de perfil (el mismo PIN de siempre) y, si coincide con
  // CUALQUIER perfil de la cuenta Central (el admin u otro autorizado),
  // restaura al instante la sesión de Central que se guardó justo antes
  // de entrar a la sucursal — sin volver a escribir correo ni contraseña.
  // Devuelve true/false para que la tarjeta de arriba muestre el error.
  async function volverACentralConCodigo(pin) {
    // Respaldo normal (esta pestaña) y, si ya no existe, la copia que sobrevive
    // al cierre de la pestaña/navegador -- solo si fue guardada para ESTA
    // sucursal y hace menos de 30 días.
    let raw = sessionStorage.getItem('n360_central_session_backup');
    if (!raw) {
      try {
        const ls = JSON.parse(localStorage.getItem('n360_central_session_backup_ls') || 'null');
        if (ls && ls.sucursal_auth_id === PG.authUserId && (Date.now() - (ls.guardado || 0)) < 30 * 86400000) {
          raw = JSON.stringify({ access_token: ls.access_token, refresh_token: ls.refresh_token, nombre_negocio: ls.nombre_negocio });
        }
      } catch (_) { raw = null; }
    }
    if (!raw) {
      alert('No se encontró el acceso guardado de tu cuenta principal (se pierde si cierras la pestaña o el navegador). Te llevaremos a iniciar sesión con tu correo y contraseña de la cuenta principal; desde ahí entras de nuevo a la bodega con Sucursales.');
      try { localStorage.removeItem('n360_central_session_backup_ls'); } catch (_) {}
      await PG.client.auth.signOut();
      window.location.href = 'login.html';
      return true; // ya se está navegando fuera, no hace falta mostrar error
    }
    const backup = JSON.parse(raw);

    try {
      // Se usa un cliente APARTE (nunca el de esta página) para validar
      // el código contra los perfiles reales de Central, sin tocar
      // todavía la sesión activa de la sucursal.
      const clienteCentral = window.supabase.createClient(PG_SUPABASE_URL, PG_SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: errSesion } = await clienteCentral.auth.setSession({
        access_token: backup.access_token, refresh_token: backup.refresh_token,
      });
      if (errSesion) throw errSesion;

      const { data: { user: userCentral } } = await clienteCentral.auth.getUser();
      const { data: perfilesCentral } = await clienteCentral.from('perfiles_acceso')
        .select('id, nombre, tipo').eq('auth_user_id', userCentral.id).eq('activo', true);

      let perfilValido = null;
      // Administradores (cualquiera): se verifica en la base de datos
      const rAdm = await verificarCodigoAdmin(pin, null, 'volver_a_central', clienteCentral);
      if (rAdm && rAdm.ok) perfilValido = { id: rAdm.perfil_id, nombre: rAdm.nombre, tipo: 'admin' };
      for (const p of (perfilValido ? [] : (perfilesCentral || []).filter(x => x.tipo !== 'admin'))) {
        const hash = await hashPin(pin, p.id);
        const { data: coincide } = await clienteCentral.from('perfiles_acceso')
          .select('id').eq('id', p.id).eq('codigo_hash', hash).maybeSingle();
        if (coincide) { perfilValido = p; break; }
      }

      if (!perfilValido) return false;

      // Código válido (es el admin u otro perfil autorizado de Central):
      // ahora sí se restaura esa sesión como la activa de esta pestaña.
      const { error: errFinal } = await PG.client.auth.setSession({
        access_token: backup.access_token, refresh_token: backup.refresh_token,
      });
      if (errFinal) throw errFinal;

      sessionStorage.removeItem('n360_central_session_backup');
      try { localStorage.removeItem('n360_central_session_backup_ls'); } catch (_) {}
      sessionStorage.removeItem('n360_sucursal_modulos');
      window.location.href = 'dashboard.html';
      return true;
    } catch (e) {
      console.error('volverACentralConCodigo:', e);
      // Si el acceso guardado ya no sirve (venció o se usó en otro lado), se
      // descarta para no quedar atrapado, y se explica qué hacer.
      const vencido = /refresh|token|session|jwt/i.test(String(e && (e.message || e.code) || ''));
      if (vencido) {
        sessionStorage.removeItem('n360_central_session_backup');
        try { localStorage.removeItem('n360_central_session_backup_ls'); } catch (_) {}
        alert('El acceso guardado de tu cuenta principal venció. Inicia sesión con tu correo y contraseña de la cuenta principal y entra de nuevo a la bodega desde Sucursales.');
        try { await PG.client.auth.signOut(); } catch (_) {}
        window.location.href = 'login.html';
        return true;
      }
      alert('No se pudo volver a Central: ' + (e.message || 'intenta de nuevo'));
      return true; // ya se mostró el error arriba, no repetir "código incorrecto"
    }
  }

  // ------------------------------------------------------------
  // EMPRESA VINCULADA (fase 1): pasar a otro negocio de la misma empresa
  // ------------------------------------------------------------
  // Solo aparece si esta cuenta pertenece a una empresa vinculada
  // (tabla empresa_miembros). Para todas las demás cuentas
  // empresa_mis_negocios() devuelve vacío y no se agrega nada.
  // El paso lo autoriza la función del servidor empresa-cambiar-negocio
  // (pase de un solo uso, sin contraseñas guardadas). Si en el otro
  // negocio hay un perfil activo con el MISMO nombre, se entra directo
  // con ese perfil; si no, se pide elegir perfil con su PIN como siempre.
  function normNombrePerfil(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  async function iniciarEmpresaVinculada() {
    try {
      // En "Ver como cliente" (solo lectura, soporte) el botón se muestra para
      // que se vea igual que lo ve el cliente, pero no cambia de negocio.
      PG.empresaSoloLectura = !!(window.N360VerComo && window.N360VerComo.activo);
      const { data, error } = await PG.client.rpc('empresa_mis_negocios');
      if (error || !Array.isArray(data) || !data.length) return;
      PG.empresaNegocios = data;
      if (!PG.empresaSoloLectura) vigilarCambioDeCuentaEnOtraPestana();
      ponerBotonesEmpresa(data, 0);
    } catch (_) { /* si falla, simplemente no aparece el botón */ }
  }

  function ponerBotonesEmpresa(negocios, intento) {
    const nav = document.querySelector('#sidebar .sidebar-nav, .sidebar-nav');
    if (!nav) {
      if (intento < 20) setTimeout(() => ponerBotonesEmpresa(negocios, intento + 1), 250);
      return;
    }
    if (document.getElementById('pg-empresa-ir')) return;
    const cont = document.createElement('div');
    cont.id = 'pg-empresa-ir';
    negocios.forEach(n => {
      const item = document.createElement('div');
      item.className = 'nav-item pg-empresa-item';
      item.setAttribute('data-tooltip', 'Ir a ' + n.nombre_negocio);
      item.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
        + '<span class="nav-label">Ir a ' + esc(n.nombre_negocio) + '</span>';
      item.addEventListener('click', () => confirmarCambioNegocio(n));
      cont.appendChild(item);
    });
    nav.insertBefore(cont, nav.firstChild);
  }

  function confirmarCambioNegocio(n) {
    showOverlay();
    if (PG.empresaSoloLectura) {
      card().innerHTML = `
        <div class="pg-pin-wrap">
          <div class="pg-pin-avatar" style="background:#1A1D2E">👁️</div>
          <div class="pg-title" style="margin-bottom:2px">Modo solo lectura</div>
          <div class="pg-subtitle" style="margin-bottom:4px">Se abre ${esc(n.nombre_negocio)} también en solo lectura, en esta misma pestaña. No se guarda nada en ningún negocio.</div>
          <div class="pg-btn-row">
            <button class="pg-btn pg-btn-ghost" id="pg-emp-cancel">Cancelar</button>
            <button class="pg-btn pg-btn-primary" id="pg-emp-ok">Ir ahora</button>
          </div>
        </div>`;
      document.getElementById('pg-emp-cancel').addEventListener('click', hideOverlay);
      document.getElementById('pg-emp-ok').addEventListener('click', () => {
        // Se termina la vista actual (solo vive en esta pestaña) y la página
        // ver-como-cambiar.html abre el otro negocio con el pase de administrador.
        try { sessionStorage.clear(); } catch (_) {}
        location.href = 'ver-como-cambiar.html#u=' + encodeURIComponent(n.auth_user_id) + '&n=' + encodeURIComponent(n.nombre_negocio);
      });
      return;
    }
    card().innerHTML = `
      <div class="pg-pin-wrap">
        <div class="pg-pin-avatar" style="background:#1A1D2E">🔁</div>
        <div class="pg-title" style="margin-bottom:2px">Ir a ${esc(n.nombre_negocio)}</div>
        <div class="pg-subtitle" style="margin-bottom:4px">Esta ventana pasa a ${esc(n.nombre_negocio)} (${esc(n.empresa)}). Lo que no hayas guardado aquí se pierde.</div>
        <div class="pg-error" id="pg-emp-error"></div>
        <div class="pg-btn-row">
          <button class="pg-btn pg-btn-ghost" id="pg-emp-cancel">Cancelar</button>
          <button class="pg-btn pg-btn-primary" id="pg-emp-ok">Ir ahora</button>
        </div>
      </div>`;
    document.getElementById('pg-emp-cancel').addEventListener('click', hideOverlay);
    document.getElementById('pg-emp-ok').addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      ev.currentTarget.textContent = 'Abriendo…';
      const err = await cambiarANegocio(n);
      if (err) {
        document.getElementById('pg-emp-error').textContent = err;
        const b = document.getElementById('pg-emp-ok');
        if (b) { b.disabled = false; b.textContent = 'Reintentar'; }
      }
    });
  }

  // Devuelve un mensaje de error, o nada si ya se está navegando al otro negocio.
  async function cambiarANegocio(n) {
    const perfilActual = getSesion();
    let resp;
    try {
      resp = await PG.client.functions.invoke('empresa-cambiar-negocio', {
        body: { destino: n.auth_user_id, perfil: perfilActual ? perfilActual.nombre : null },
      });
    } catch (e) { return 'No se pudo conectar. Revisa tu internet e intenta de nuevo.'; }
    if (resp.error || !resp.data || !resp.data.token_hash) {
      let msg = resp.data && resp.data.error;
      try { if (!msg && resp.error && resp.error.context) msg = (await resp.error.context.json()).error; } catch (_) {}
      return msg || 'No se pudo abrir el otro negocio.';
    }
    const origen = PG.authUserId;
    PG.cambiandoNegocio = true;
    const { data: v, error: ev } = await PG.client.auth.verifyOtp({ token_hash: resp.data.token_hash, type: 'magiclink' });
    if (ev || !v || !v.session || v.session.user.id !== n.auth_user_id) {
      PG.cambiandoNegocio = false;
      // Seguridad: si algo no salió como se esperaba, se vuelve a revisar la sesión real.
      const { data: { session } } = await PG.client.auth.getSession();
      if (!session || session.user.id !== origen) { location.href = 'login.html'; return 'Inicia sesión de nuevo.'; }
      return 'No se pudo abrir el otro negocio.';
    }

    // Sesión ya es del otro negocio. Se limpian datos de la pestaña que eran del negocio anterior.
    limpiarSesion();
    ['n360_central_session_backup', 'n360_sucursal_modulos'].forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });

    // Perfil con el mismo nombre en el otro negocio: se entra directo con él.
    if (perfilActual && perfilActual.nombre) {
      try {
        const { data: perfilesDestino } = await PG.client.from('perfiles_acceso')
          .select('id, nombre, tipo, modulos, activo').eq('auth_user_id', n.auth_user_id).eq('activo', true);
        const iguales = (perfilesDestino || []).filter(p => normNombrePerfil(p.nombre) === normNombrePerfil(perfilActual.nombre));
        if (iguales.length === 1) {
          PG.authUserId = n.auth_user_id;
          setSesion(iguales[0]);
        }
      } catch (_) { /* sin perfil elegido: el otro negocio pedirá elegirlo con su PIN */ }
    }
    location.href = 'dashboard.html';
    return null;
  }

  // Protección: si en OTRA pestaña se cambia de negocio (o de cuenta), esta
  // pestaña ya no puede seguir trabajando con los datos del negocio anterior
  // (lo que se guarde iría al negocio equivocado). Se bloquea y se pide recargar.
  function vigilarCambioDeCuentaEnOtraPestana() {
    window.addEventListener('storage', (e) => {
      try {
        if (!e.key || !/^sb-.*-auth-token$/.test(e.key) || PG.cambiandoNegocio) return;
        const nuevo = e.newValue ? JSON.parse(e.newValue) : null;
        const uid = nuevo && (nuevo.user ? nuevo.user.id : (nuevo.currentSession && nuevo.currentSession.user && nuevo.currentSession.user.id));
        if (!uid || uid === PG.authUserId) return;
        if (document.getElementById('pg-cambio-cuenta')) return;
        const d = document.createElement('div');
        d.id = 'pg-cambio-cuenta';
        d.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,15,25,.72);display:flex;align-items:center;justify-content:center;padding:16px';
        d.innerHTML = '<div style="background:var(--bg-surface,#fff);color:var(--text-primary,#111);max-width:380px;border-radius:14px;padding:22px;text-align:center;font-family:inherit">'
          + '<div style="font-size:16px;font-weight:700;margin-bottom:8px">Se cambió de negocio en otra pestaña</div>'
          + '<div style="font-size:13.5px;color:var(--text-secondary,#555);margin-bottom:16px">Para no guardar nada en el negocio equivocado, esta pestaña se debe recargar.</div>'
          + '<button type="button" style="padding:10px 16px;border-radius:10px;border:0;background:var(--accent,#6C63FF);color:#fff;font-weight:600;cursor:pointer">Recargar</button></div>';
        d.querySelector('button').addEventListener('click', () => { location.href = 'dashboard.html'; });
        document.body.appendChild(d);
      } catch (_) {}
    });
  }

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

    // BLOQUEO UNIVERSAL: si la cuenta está suspendida o cancelada, se
    // corta aquí mismo — antes, solo dashboard.html revisaba esto, así
    // que alguien ya adentro de otro módulo (Ventas, Productos, etc.)
    // podía seguir usando el sistema con total normalidad aunque el
    // administrador ya lo hubiera suspendido. Esto corre en TODAS las
    // páginas porque perfiles-guard.js se carga en todas.
    const { data: cuentaEstado } = await PG.client
      .from('usuarios').select('estado_cuenta, limite_perfiles').eq('auth_user_id', PG.authUserId).maybeSingle();
    const estado = cuentaEstado?.estado_cuenta || 'activa';
    PG.limitePerfiles = cuentaEstado?.limite_perfiles || 5;
    if (estado === 'suspendida' || estado === 'cancelada') {
      mostrarBloqueoCuenta(estado);
      return;
    }

    // CUENTAS INDEPENDIENTES DE CATÁLOGO360: si esta cuenta se registró
    // solo para Catálogo360 (nunca fue ni será cliente completo de
    // Negocio360), se restringe a SOLO Catálogo360 en cualquier
    // página -- nunca debe poder usar Ventas, Clientes, Compras, etc.
    // Corre ANTES que el sistema de perfiles/multiusuario porque es
    // una restricción de TIPO DE CUENTA, no de sub-usuario dentro de
    // una cuenta ya completa.
    const { data: suscripcionC360 } = await PG.client
      .from('catalogo_suscripciones').select('es_independiente').eq('auth_user_id', PG.authUserId).maybeSingle();
    if (suscripcionC360?.es_independiente) {
      if (currentFile() !== 'catalogo360.html') {
        location.href = 'catalogo360.html';
        return;
      }
      restringirSoloACatalogo360();
      return; // el sistema de perfiles/multiusuario normal no aplica a cuentas independientes
    }

    // Si esta cuenta es en realidad una SUCURSAL (creada desde el módulo
    // Sucursales de otra cuenta Central), se muestra un aviso fijo en
    // toda página con un botón para salir — si no, quien entra a una
    // sucursal se queda sin ninguna forma de volver a su cuenta principal.
    mostrarAvisoSucursalSiAplica();
    iniciarEmpresaVinculada();

    // Presencia (última conexión / en línea): corre siempre que haya
    // sesión, independientemente del sistema de perfiles/PIN.
    // Best-effort: cualquier fallo se ignora en silencio.
    iniciarHeartbeat();
    // Botón flotante de notificaciones DESACTIVADO: chocaba visualmente
    // con el botón del Asistente Inteligente (misma esquina, mismo
    // tamaño) -- ya existe el enlace "Notificaciones" en el menú
    // lateral, así que no se pierde ningún acceso al quitarlo.
    // iniciarBadgeNotificaciones();

    // Si el dueño de la cuenta desactivó el sistema multiusuario en
    // configuración.html, no se pide selector ni PIN: se entra directo.
    const { data: cfgUsuario } = await PG.client
      .from('usuarios')
      .select('multiusuario_activo')
      .eq('auth_user_id', PG.authUserId)
      .maybeSingle();
    if (cfgUsuario && cfgUsuario.multiusuario_activo === false) return;

    // Modo "Ver como cliente" (solo lectura, desde el panel de administrador):
    // se entra directo, sin selector de usuario ni PIN y sin restricciones de
    // perfil, para que el administrador vea todo. No cambia nada del cliente:
    // su configuración de multiusuario queda igual y esta omisión solo ocurre
    // en esa pestaña.
    if (window.N360VerComo && window.N360VerComo.activo) return;

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
    // EXCEPCIÓN 1: personalizacion.html es el asistente de bienvenida que
    // ve un usuario recién registrado — ahí todavía no existe ninguna
    // cuenta configurada, así que no tiene sentido (ni debe) mandarlo
    // al dashboard antes de que termine de configurar su negocio.
    // EXCEPCIÓN 2: bodega.html es la página propia de una cuenta de
    // bodega — nunca tiene Dashboard completo ni necesita elegir perfil
    // ahí primero (rebotarla a dashboard.html la mandaría, de rebote,
    // directo a Personalización, que una bodega nunca debe ver).
    // EXCEPCIÓN 3: catalogo360.html tambien recibe cuentas INDEPENDIENTES
    // (clientes que se registraron solo para Catalogo360, nunca pasaron
    // por dashboard.html ni por Personalizacion) -- igual que bodega,
    // rebotarlas a dashboard.html las manda, de rebote, a login.html
    // porque esa cuenta no tiene todo lo que Dashboard espera. Un
    // cliente Negocio360 normal que entra directo a Catalogo360 sigue
    // funcionando igual -- esto solo evita el rebote, nunca bloquea a
    // nadie que ya tenia acceso.
    if (currentFile() !== 'dashboard.html' && currentFile() !== 'personalizacion.html' && currentFile() !== 'bodega.html' && currentFile() !== 'catalogo360.html') {
      location.href = 'dashboard.html';
      return;
    }

    // Personalización es la primera pantalla que ve una cuenta recién
    // registrada — todavía no ha configurado nada de su negocio, así
    // que jamás debe pedirle elegir un perfil ni un código de PIN/admin
    // (aunque ya exista un "Admin" recién auto-creado en segundo plano).
    // Eso solo tiene sentido después de terminar el asistente.
    if (currentFile() === 'personalizacion.html') return;

    showOverlay();
    renderSelector();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
