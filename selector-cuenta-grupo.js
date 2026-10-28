/* ============================================================
   SELECTOR-CUENTA-GRUPO.JS — NEGOCIO360
   Menú "Cambiar de cuenta": pasa entre la Central, las sucursales y las
   bodegas del MISMO grupo con un clic, sin correo ni contraseñas
   (usa la función del servidor grupo-cambiar-cuenta, pase de un solo uso).
   - Para volver a la Central se usa el mismo acceso con código que ya existía.
   - Aparece en la Central y en cada sucursal/bodega de cualquier grupo con 2 o más cuentas.
   - Al cambiar se lleva el perfil activo (sin pedir el código otra vez). Para volver
     a la Central sin código, el perfil activo debe ser de administrador; si no, se
     pide el código como siempre.
   - En "Ver como cliente" (solo lectura) no hace nada.
   ============================================================ */
(function () {
  'use strict';
  var URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co';
  var KEY_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  var CLAVE_PERFIL = 'n360_perfil_activo';
  var CLAVE_RESPALDO = 'n360_central_session_backup';
  var CLAVE_RESPALDO_LS = 'n360_central_session_backup_ls';

  if (window.N360SelectorCuenta) return;
  if (window.N360VerComo && window.N360VerComo.activo) return;

  var sb = null, yo = null, lista = null, esHija = false, miFilaId = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  async function iniciar() {
    try {
      if (!window.supabase) return;
      sb = window.supabase.createClient(URL_SB, KEY_SB);
      var r = await sb.auth.getSession();
      yo = r && r.data && r.data.session && r.data.session.user;
      if (!yo) return;
      esHija = /@negocio360\.internal$/i.test(yo.email || '');
      var l = await sb.rpc('listar_sucursales_grupo');
      if (l.error || !Array.isArray(l.data) || l.data.length < 2) return;
      lista = l.data;
      if (esHija) {
        try {
          var mi = await sb.from('sucursales').select('id').eq('auth_user_id_sucursal', yo.id).eq('es_central', false).maybeSingle();
          miFilaId = mi && mi.data ? mi.data.id : null;
        } catch (_) { miFilaId = null; }
      }
      ponerBoton(0);
    } catch (e) { /* si algo falla, simplemente no aparece el menú */ }
  }

  function ponerBoton(intento) {
    var nav = document.querySelector('#sidebar .sidebar-nav, .sidebar-nav');
    if (document.getElementById('n360-selector-cuenta')) return;
    if (!nav) {
      if (intento < 20) { setTimeout(function () { ponerBoton(intento + 1); }, 250); return; }
      // Sin menú lateral en esta página: botón flotante.
      var f = document.createElement('button');
      f.id = 'n360-selector-cuenta';
      f.textContent = 'Cambiar de cuenta';
      f.style.cssText = 'position:fixed;left:16px;bottom:56px;z-index:400;padding:7px 12px;border-radius:20px;border:1px solid var(--border,#d6d6d6);background:var(--bg-surface,#fff);color:var(--text-primary,#111);font:12px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.1)';
      f.addEventListener('click', abrir);
      document.body.appendChild(f);
      return;
    }
    var it = document.createElement('div');
    it.id = 'n360-selector-cuenta';
    it.className = 'nav-item';
    it.setAttribute('data-tooltip', 'Cambiar de cuenta');
    it.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span class="nav-label">Cambiar de cuenta</span>';
    it.addEventListener('click', abrir);
    nav.insertBefore(it, nav.firstChild);
  }

  function inyectarEstilos() {
    if (document.getElementById('n360-sel-css')) return;
    var st = document.createElement('style');
    st.id = 'n360-sel-css';
    st.textContent =
      '#n360-sel-modal{position:fixed;inset:0;background:rgba(15,18,32,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;animation:n360selF .15s ease}' +
      '@keyframes n360selF{from{opacity:0}to{opacity:1}}@keyframes n360selU{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}' +
      '#n360-sel-box{background:var(--bg-surface,#fff);color:var(--text-primary,#161a2b);border:1px solid var(--border,transparent);border-radius:18px;max-width:460px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.35);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;animation:n360selU .2s ease;overflow:hidden}' +
      '#n360-sel-head{padding:18px 20px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px}' +
      '#n360-sel-head h2{margin:0;font-size:18px;font-weight:700}' +
      '#n360-sel-head p{margin:3px 0 0;font-size:13px;color:var(--text-secondary,#6b7080)}' +
      '#n360-sel-x{border:0;background:var(--bg-hover,rgba(120,120,140,.14));color:var(--text-primary,#161a2b);width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer;line-height:1;flex-shrink:0}' +
      '#n360-sel-x:hover{filter:brightness(.92)}' +
      '#n360-sel-q{margin:0 20px 8px;padding:9px 12px;border-radius:10px;border:1px solid var(--border,#dfe1ea);background:transparent;color:var(--text-primary,#161a2b);font-size:14px;outline:none}' +
      '#n360-sel-q:focus{border-color:var(--accent,#6C63FF)}' +
      '#n360-sel-list{overflow:auto;padding:4px 14px 16px}' +
      '.n360-sel-sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-secondary,#6b7080);margin:12px 6px 6px}' +
      '.n360-sel-item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:11px 12px;margin-bottom:6px;border:1px solid var(--border,#e3e5ee);border-radius:14px;background:transparent;color:var(--text-primary,#161a2b);cursor:pointer;font:inherit;transition:transform .12s,border-color .12s,box-shadow .12s}' +
      '.n360-sel-item:hover:not(:disabled){border-color:var(--accent,#6C63FF);box-shadow:0 4px 14px rgba(108,99,255,.18);transform:translateY(-1px)}' +
      '.n360-sel-item:disabled{cursor:default}' +
      '.n360-sel-item.actual{border-color:var(--accent,#6C63FF);background:rgba(108,99,255,.09)}' +
      '.n360-sel-item.off{opacity:.5}' +
      '.n360-sel-ico{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0}' +
      '.n360-sel-ico.c{background:rgba(108,99,255,.16)}.n360-sel-ico.s{background:rgba(16,185,129,.16)}.n360-sel-ico.b{background:rgba(245,158,11,.18)}' +
      '.n360-sel-info{flex:1;min-width:0}' +
      '.n360-sel-nom{font-weight:650;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.n360-sel-tipo{font-size:12px;color:var(--text-secondary,#6b7080);margin-top:1px}' +
      '.n360-sel-tag{font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;white-space:nowrap;background:rgba(108,99,255,.14);color:var(--text-accent,var(--accent,#6C63FF))}' +
      '.n360-sel-item.actual .n360-sel-tag{background:var(--accent,#6C63FF);color:#fff}' +
      '.n360-sel-item.off .n360-sel-tag{background:rgba(120,120,140,.2);color:var(--text-secondary,#6b7080)}' +
      '.n360-sel-item.cargando .n360-sel-tag::after{content:"…"}' +
      '#n360-sel-err{margin:0 20px 14px;color:var(--danger,#dc2626);font-size:13px;min-height:0}#n360-sel-err:empty{display:none}' +
      '#n360-sel-vacio{padding:18px;text-align:center;color:var(--text-secondary,#6b7080);font-size:14px}' +
      '@media (max-width:520px){#n360-sel-modal{align-items:flex-end;padding:0}#n360-sel-box{max-width:none;border-radius:20px 20px 0 0;max-height:90vh}}' +
      '@media (prefers-reduced-motion:reduce){#n360-sel-modal,#n360-sel-box{animation:none}.n360-sel-item{transition:none}}';
    document.head.appendChild(st);
  }

  function nombreActual() {
    var a = lista.find(esActual);
    return a ? a.nombre : (esHija ? 'esta cuenta' : '');
  }

  function itemHtml(s) {
    var actual = esActual(s), off = s.activa === false;
    var clase = s.es_central ? 'c' : (s.tipo === 'bodega' ? 'b' : 's');
    var icono = s.es_central ? '🏢' : (s.tipo === 'bodega' ? '📦' : '🏬');
    var tipo = s.es_central ? 'Cuenta principal' : (s.tipo === 'bodega' ? 'Bodega · inventario' : 'Sucursal');
    var tag = actual ? '✓ Aquí estás' : (off ? 'Inactiva' : 'Entrar');
    return '<button class="n360-sel-item' + (actual ? ' actual' : '') + (off ? ' off' : '') + '" data-id="' + esc(s.id) + '" data-q="' + esc((s.nombre || '').toLowerCase()) + '"' + (actual || off ? ' disabled' : '') + '>' +
      '<span class="n360-sel-ico ' + clase + '">' + icono + '</span>' +
      '<span class="n360-sel-info"><div class="n360-sel-nom">' + esc(s.nombre) + '</div><div class="n360-sel-tipo">' + tipo + '</div></span>' +
      '<span class="n360-sel-tag">' + tag + '</span></button>';
  }

  function abrir() {
    if (!lista) return;
    inyectarEstilos();
    var viejo = document.getElementById('n360-sel-modal'); if (viejo) viejo.remove();
    var grupos = [
      ['Cuenta principal', lista.filter(function (s) { return s.es_central; })],
      ['Sucursales', lista.filter(function (s) { return !s.es_central && s.tipo !== 'bodega'; })],
      ['Bodegas', lista.filter(function (s) { return !s.es_central && s.tipo === 'bodega'; })],
    ];
    var cuerpo = grupos.map(function (g) {
      if (!g[1].length) return '';
      return '<div class="n360-sel-sec">' + g[0] + '</div>' + g[1].map(itemHtml).join('');
    }).join('');
    var m = document.createElement('div');
    m.id = 'n360-sel-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Cambiar de cuenta');
    var aqui = nombreActual();
    m.innerHTML = '<div id="n360-sel-box">' +
      '<div id="n360-sel-head"><div><h2>¿A dónde quieres ir?</h2><p>' + (aqui ? 'Ahora estás en <strong>' + esc(aqui) + '</strong>' : 'Elige una cuenta de tu grupo') + '</p></div>' +
      '<button id="n360-sel-x" aria-label="Cerrar">×</button></div>' +
      (lista.length > 7 ? '<input id="n360-sel-q" type="search" placeholder="Buscar por nombre…" autocomplete="off">' : '') +
      '<div id="n360-sel-list">' + cuerpo + '<div id="n360-sel-vacio" style="display:none">No hay cuentas con ese nombre.</div></div>' +
      '<p id="n360-sel-err"></p></div>';
    document.body.appendChild(m);
    var q = document.getElementById('n360-sel-q');
    if (q) q.addEventListener('input', function () {
      var t = q.value.trim().toLowerCase(), hay = 0;
      m.querySelectorAll('.n360-sel-item').forEach(function (b) {
        var ok = !t || (b.getAttribute('data-q') || '').indexOf(t) >= 0;
        b.style.display = ok ? '' : 'none'; if (ok) hay++;
      });
      document.getElementById('n360-sel-vacio').style.display = hay ? 'none' : '';
    });
    function cerrar() { m.remove(); document.removeEventListener('keydown', tecla); }
    function tecla(ev) { if (ev.key === 'Escape') cerrar(); }
    document.addEventListener('keydown', tecla);
    m.addEventListener('click', function (ev) {
      if (ev.target === m || ev.target.id === 'n360-sel-x') { cerrar(); return; }
      var b = ev.target.closest && ev.target.closest('button.n360-sel-item');
      if (b && !b.disabled) { b.classList.add('cargando'); cambiar(b.getAttribute('data-id'), b); }
    });
  }

  // La fila "actual": la Central si no soy cuenta hija; si soy hija, la de mi nombre.
  function esActual(s) {
    if (!esHija) return !!s.es_central;
    return !!miFilaId && s.id === miFilaId;
  }


  function perfilActual() {
    try {
      var raw = sessionStorage.getItem(CLAVE_PERFIL);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return (p && p.authUserId === yo.id) ? p : null;
    } catch (_) { return null; }
  }
  function llevarPerfil(p, authId) {
    if (!p) return;
    sessionStorage.setItem(CLAVE_PERFIL, JSON.stringify({
      authUserId: authId, id: p.id, nombre: p.nombre, tipo: p.tipo, modulos: p.modulos || [],
    }));
  }
  function leerRespaldo() {
    var raw = sessionStorage.getItem(CLAVE_RESPALDO);
    if (!raw) {
      try {
        var ls = JSON.parse(localStorage.getItem(CLAVE_RESPALDO_LS) || 'null');
        if (ls && ls.sucursal_auth_id === yo.id && (Date.now() - (ls.guardado || 0)) < 30 * 86400000) raw = JSON.stringify(ls);
      } catch (_) { raw = null; }
    }
    try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }

  // Vuelve a la Central con la sesión guardada, sin pedir el código (solo si el perfil
  // activo es administrador). Devuelve true si ya se está navegando; false => usar el código.
  async function volverSinCodigo() {
    try {
      var perfil = perfilActual();
      var bk = leerRespaldo();
      if (!perfil || !bk) return false;
      var r = await sb.auth.setSession({ access_token: bk.access_token, refresh_token: bk.refresh_token });
      if (r.error || !r.data || !r.data.session) return false;
      var centralId = r.data.session.user.id;
      sessionStorage.removeItem(CLAVE_RESPALDO);
      try { localStorage.removeItem(CLAVE_RESPALDO_LS); } catch (_) {}
      sessionStorage.removeItem('n360_sucursal_modulos');
      llevarPerfil(perfil, centralId);
      location.href = 'dashboard.html';
      return true;
    } catch (_) { return false; }
  }

  function error(msg) { var e = document.getElementById('n360-sel-err'); if (e) e.textContent = msg; if (msg) document.querySelectorAll('.n360-sel-item.cargando').forEach(function (b) { b.classList.remove('cargando'); }); }

  async function cambiar(sucursalId, boton) {
    var s = lista.find(function (x) { return x.id === sucursalId; });
    if (!s) return;
    // Volver a la Central: el mismo acceso con código de siempre.
    if (s.es_central) {
      if (!esHija) return;
      if (perfilActual() && perfilActual().tipo === 'admin' && await volverSinCodigo()) return;
      var cfg = window.PerfilesGuardConfig;
      if (cfg && cfg.volverACentral) { var mm = document.getElementById('n360-sel-modal'); if (mm) mm.remove(); cfg.volverACentral(s.nombre); }
      else error('No se pudo abrir el acceso a la Central.');
      return;
    }
    boton.disabled = true; error('');
    try {
      // Si soy un perfil con PIN (no administrador), se respeta su permiso por sucursal.
      var modulos = null;
      var raw = sessionStorage.getItem('n360_perfil_activo');
      if (raw) {
        var perfil = JSON.parse(raw);
        if (perfil && perfil.tipo !== 'admin') {
          var p = await sb.from('sucursal_permisos').select('modulos_permitidos').eq('sucursal_id', s.id).eq('perfil_id', perfil.id).maybeSingle();
          if (!p || !p.data) { boton.disabled = false; return error('Tu perfil no tiene acceso a "' + s.nombre + '".'); }
          modulos = p.data.modulos_permitidos || [];
        }
      }
      var perfilLlevar = perfilActual();
      var resp = await sb.functions.invoke('grupo-cambiar-cuenta', { body: { sucursal_id: s.id } });
      if (resp.error || !resp.data || !resp.data.token_hash) {
        var msg = resp.data && resp.data.error;
        try { if (!msg && resp.error && resp.error.context) msg = (await resp.error.context.json()).error; } catch (_) {}
        boton.disabled = false; return error(msg || 'No se pudo abrir esa cuenta.');
      }
      // Desde la Central se guarda su sesión para poder volver (igual que Sucursales).
      var ses = await sb.auth.getSession();
      if (!esHija && ses.data && ses.data.session) {
        sessionStorage.setItem('n360_central_session_backup', JSON.stringify({
          access_token: ses.data.session.access_token, refresh_token: ses.data.session.refresh_token,
          nombre_negocio: (lista.find(function (x) { return x.es_central; }) || {}).nombre || 'tu cuenta principal',
        }));
      }
      var viejoBk = esHija ? leerRespaldo() : null;
      var v = await sb.auth.verifyOtp({ token_hash: resp.data.token_hash, type: 'magiclink' });
      if (v.error || !v.data || !v.data.session || v.data.session.user.id !== resp.data.destino_auth_id) {
        // Seguridad: se vuelve a comprobar de quién es la sesión real.
        var chk = await sb.auth.getSession();
        if (!chk.data || !chk.data.session || chk.data.session.user.id !== yo.id) { location.href = 'login.html'; return; }
        boton.disabled = false; return error('No se pudo abrir esa cuenta.');
      }
      // Copia que sobrevive si se cierra la pestaña (solo desde la Central), para ESTA cuenta.
      try {
        var bk = sessionStorage.getItem(CLAVE_RESPALDO);
        if (!bk && esHija && viejoBk) bk = JSON.stringify(viejoBk);
        if (bk) {
          var b = JSON.parse(bk);
          localStorage.setItem('n360_central_session_backup_ls', JSON.stringify({
            access_token: b.access_token, refresh_token: b.refresh_token, nombre_negocio: b.nombre_negocio,
            sucursal_auth_id: resp.data.destino_auth_id, guardado: Date.now(),
          }));
        }
      } catch (_) {}
      if (viejoBk && !sessionStorage.getItem(CLAVE_RESPALDO)) sessionStorage.setItem(CLAVE_RESPALDO, JSON.stringify(viejoBk));
      llevarPerfil(perfilLlevar, resp.data.destino_auth_id);
      if (modulos) sessionStorage.setItem('n360_sucursal_modulos', JSON.stringify(modulos));
      else sessionStorage.removeItem('n360_sucursal_modulos');
      location.href = (resp.data.tipo === 'bodega') ? 'bodega.html' : 'dashboard.html';
    } catch (e) {
      boton.disabled = false; error('No se pudo cambiar de cuenta. Revisa tu internet e intenta de nuevo.');
    }
  }

  window.N360SelectorCuenta = { abrir: abrir, listo: function () { return !!lista; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
