/* demo-salir.js — botón "Cerrar sesión" SOLO en las cuentas de demostración.
 *
 * Quien prueba la demo no tiene que ir hasta Configuración para salir: en cada
 * módulo aparece un botón pequeño y discreto (abajo a la izquierda) que pide
 * confirmar y cierra la sesión igual que el resto del sistema (signOut → login).
 * En una cuenta real no aparece nunca: se pregunta al servidor (soy_cuenta_demo)
 * y la respuesta se recuerda durante la pestaña. No guarda ni cambia datos.
 * No se muestra dentro de pantallas incrustadas (paneles, cobros), solo en la ventana principal.
 */
(function () {
  'use strict';
  if (window.__n360DemoSalir) return;
  window.__n360DemoSalir = true;

  // El cliente de Supabase de la página (con sesión guardada), sin cambiar cómo se crea.
  var cliente = null;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    var crearOrig = window.supabase.createClient;
    window.supabase.createClient = function (url, clave, opciones) {
      var c = crearOrig.apply(this, arguments);
      try { if (!cliente && !(opciones && opciones.auth && opciones.auth.persistSession === false)) cliente = c; } catch (e) {}
      return c;
    };
  }

  var CACHE = 'n360_demo_salir';
  var pagina = (location.pathname.split('/').pop() || '').toLowerCase();
  if (window.self !== window.top) return;                                     // dentro de un panel o un cobro: no
  if (['', 'index.html', 'login.html', 'registro.html', 'recuperar.html', 'restablecer.html'].indexOf(pagina) >= 0) return;

  function leerCache(uid) {
    try { var c = JSON.parse(sessionStorage.getItem(CACHE) || 'null'); return c && c.uid === uid ? c.demo : null; } catch (e) { return null; }
  }
  function guardarCache(uid, demo) { try { sessionStorage.setItem(CACHE, JSON.stringify({ uid: uid, demo: demo })); } catch (e) {} }

  function pintar() {
    if (document.getElementById('n360-demo-salir')) return;
    var st = document.createElement('style');
    st.textContent =
      '#n360-demo-salir{position:fixed;left:12px;bottom:12px;z-index:950;display:inline-flex;align-items:center;gap:6px;' +
      'padding:7px 12px;border-radius:999px;border:1px solid var(--border,rgba(127,127,127,.35));' +
      'background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-secondary,#4b5563);font-size:12.5px;font-weight:600;line-height:1.2;' +
      'font-family:inherit;cursor:pointer;opacity:.82;box-shadow:0 4px 14px rgba(0,0,0,.12);transition:opacity .15s,border-color .15s}' +
      '#n360-demo-salir:hover,#n360-demo-salir:focus-visible{opacity:1;border-color:var(--danger,#dc2626);color:var(--danger,#dc2626)}' +
      '#n360-demo-salir .n360-ds-tag{font-size:10px;font-weight:800;letter-spacing:.3px;padding:1px 6px;border-radius:999px;' +
      'background:rgba(22,163,74,.14);color:#16a34a}' +
      '#sidebar .sidebar-nav,#sidebar nav{padding-bottom:58px!important}' +                // el último módulo del menú nunca queda debajo del botón
      '@media print{#n360-demo-salir{display:none!important}}' +
      '@media (max-width:480px){#n360-demo-salir{padding:6px 10px;font-size:12px;left:8px;bottom:8px}#n360-demo-salir .n360-ds-tag{display:none}}';
    document.head.appendChild(st);
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'n360-demo-salir';
    b.title = 'Salir de la cuenta de demostración';
    b.setAttribute('aria-label', 'Cerrar sesión de la cuenta de demostración');
    b.innerHTML = '<span aria-hidden="true">🚪</span> Cerrar sesión <span class="n360-ds-tag">DEMO</span>';
    b.addEventListener('click', salir);
    document.body.appendChild(b);
  }

  function salir() {
    if (!confirm('¿Salir de la cuenta de demostración?')) return;
    var b = document.getElementById('n360-demo-salir');
    if (b) { b.disabled = true; b.textContent = 'Cerrando sesión…'; }
    try { sessionStorage.removeItem(CACHE); sessionStorage.removeItem('n360_perfil_activo'); } catch (e) {}
    Promise.resolve(cliente ? cliente.auth.signOut() : null).catch(function () {}).then(function () { window.location.href = 'login.html'; });
  }

  function revisar() {
    if (!cliente) return;
    cliente.auth.getSession().then(function (r) {
      var uid = r && r.data && r.data.session && r.data.session.user && r.data.session.user.id;
      if (!uid) return;
      var c = leerCache(uid);
      if (c === true) return pintar();
      if (c === false) return;
      return cliente.rpc('soy_cuenta_demo').then(function (x) {
        var demo = !!(x && x.data === true);
        guardarCache(uid, demo);
        if (demo) pintar();
      });
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(revisar, 600); });
  else setTimeout(revisar, 600);
})();
