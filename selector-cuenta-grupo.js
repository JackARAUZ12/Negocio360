/* ============================================================
   SELECTOR-CUENTA-GRUPO.JS — NEGOCIO360
   Menú "Cambiar de cuenta": pasa entre la Central, las sucursales y las
   bodegas del MISMO grupo con un clic, sin correo ni contraseñas
   (usa la función del servidor grupo-cambiar-cuenta, pase de un solo uso).
   - Para volver a la Central se usa el mismo acceso con código que ya existía.
   - FASE PILOTO: solo aparece en las cuentas listadas en PILOTO.
   - En "Ver como cliente" (solo lectura) no hace nada.
   ============================================================ */
(function () {
  'use strict';
  var URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co';
  var KEY_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  // Cuenta de pruebas NEGOCIO360 (Central) y sus 2 bodegas.
  var PILOTO = ['b699660c-b808-4f0a-9b24-d0df60a92e83', '9d4f7f0f-4747-4142-ab01-bfa1794739fb', '71b37c58-3687-4294-8eee-b65ba87c2fca'];

  if (window.N360SelectorCuenta) return;
  if (window.N360VerComo && window.N360VerComo.activo) return;

  var sb = null, yo = null, lista = null, esHija = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  async function iniciar() {
    try {
      if (!window.supabase) return;
      sb = window.supabase.createClient(URL_SB, KEY_SB);
      var r = await sb.auth.getSession();
      yo = r && r.data && r.data.session && r.data.session.user;
      if (!yo || PILOTO.indexOf(yo.id) < 0) return;
      esHija = /@negocio360\.internal$/i.test(yo.email || '');
      var l = await sb.rpc('listar_sucursales_grupo');
      if (l.error || !Array.isArray(l.data) || l.data.length < 2) return;
      lista = l.data;
      ponerBoton(0);
    } catch (e) { /* si algo falla, simplemente no aparece el menú */ }
  }

  function ponerBoton(intento) {
    var nav = document.querySelector('#sidebar .sidebar-nav, .sidebar-nav');
    if (!nav) { if (intento < 20) setTimeout(function () { ponerBoton(intento + 1); }, 250); return; }
    if (document.getElementById('n360-selector-cuenta')) return;
    var it = document.createElement('div');
    it.id = 'n360-selector-cuenta';
    it.className = 'nav-item';
    it.setAttribute('data-tooltip', 'Cambiar de cuenta');
    it.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span class="nav-label">Cambiar de cuenta</span>';
    it.addEventListener('click', abrir);
    nav.insertBefore(it, nav.firstChild);
  }

  function abrir() {
    var viejo = document.getElementById('n360-sel-modal'); if (viejo) viejo.remove();
    var m = document.createElement('div');
    m.id = 'n360-sel-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
    var filas = lista.map(function (s) {
      var tipo = s.es_central ? 'Central' : (s.tipo === 'bodega' ? 'Bodega' : 'Sucursal');
      var actual = esActual(s);
      return '<button data-id="' + esc(s.id) + '" ' + (actual || s.activa === false ? 'disabled' : '') +
        ' style="display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;padding:10px 12px;margin-bottom:6px;border:1px solid #d6d6d6;border-radius:8px;background:' + (actual ? '#eef4ff' : '#fff') + ';color:#111;cursor:' + (actual ? 'default' : 'pointer') + ';font:14px system-ui">' +
        '<span><strong>' + esc(s.nombre) + '</strong> <span style="color:#666;font-size:12px">· ' + tipo + (s.activa === false ? ' · inactiva' : '') + '</span></span>' +
        '<span style="font-size:12px;color:#2563eb">' + (actual ? 'Estás aquí' : 'Entrar') + '</span></button>';
    }).join('');
    m.innerHTML = '<div style="background:#fff;color:#111;border-radius:12px;max-width:420px;width:100%;max-height:80vh;overflow:auto;padding:16px;font-family:system-ui">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><strong style="font-size:16px">Cambiar de cuenta</strong>' +
      '<button id="n360-sel-x" style="border:0;background:none;font-size:20px;cursor:pointer;color:#111" aria-label="Cerrar">×</button></div>' +
      filas + '<p id="n360-sel-err" style="color:#b91c1c;font-size:13px;margin:8px 0 0"></p></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (ev) {
      if (ev.target === m || ev.target.id === 'n360-sel-x') { m.remove(); return; }
      var b = ev.target.closest && ev.target.closest('button[data-id]');
      if (b && !b.disabled) cambiar(b.getAttribute('data-id'), b);
    });
  }

  // La fila "actual": la Central si no soy cuenta hija; si soy hija, la de mi nombre.
  function esActual(s) {
    if (!esHija) return !!s.es_central;
    return false; // la cuenta hija no sabe su fila: el servidor rechaza si es ella misma
  }

  function error(msg) { var e = document.getElementById('n360-sel-err'); if (e) e.textContent = msg; }

  async function cambiar(sucursalId, boton) {
    var s = lista.find(function (x) { return x.id === sucursalId; });
    if (!s) return;
    // Volver a la Central: el mismo acceso con código de siempre.
    if (s.es_central) {
      if (!esHija) return;
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
      var v = await sb.auth.verifyOtp({ token_hash: resp.data.token_hash, type: 'magiclink' });
      if (v.error || !v.data || !v.data.session || v.data.session.user.id !== resp.data.destino_auth_id) {
        // Seguridad: se vuelve a comprobar de quién es la sesión real.
        var chk = await sb.auth.getSession();
        if (!chk.data || !chk.data.session || chk.data.session.user.id !== yo.id) { location.href = 'login.html'; return; }
        boton.disabled = false; return error('No se pudo abrir esa cuenta.');
      }
      // Copia que sobrevive si se cierra la pestaña (solo desde la Central), para ESTA cuenta.
      try {
        var bk = sessionStorage.getItem('n360_central_session_backup');
        if (bk) {
          var b = JSON.parse(bk);
          localStorage.setItem('n360_central_session_backup_ls', JSON.stringify({
            access_token: b.access_token, refresh_token: b.refresh_token, nombre_negocio: b.nombre_negocio,
            sucursal_auth_id: resp.data.destino_auth_id, guardado: Date.now(),
          }));
        }
      } catch (_) {}
      if (modulos) sessionStorage.setItem('n360_sucursal_modulos', JSON.stringify(modulos));
      else sessionStorage.removeItem('n360_sucursal_modulos');
      location.href = (resp.data.tipo === 'bodega') ? 'bodega.html' : 'dashboard.html';
    } catch (e) {
      boton.disabled = false; error('No se pudo cambiar de cuenta. Revisa tu internet e intenta de nuevo.');
    }
  }

  window.N360SelectorCuenta = { abrir: abrir };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
