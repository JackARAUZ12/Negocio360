/* =====================================================
   MENU-GARANTIAS-PROVEEDOR.JS — Negocio360
   Agrega "Garantías de proveedor" al menú lateral, justo debajo de Compras,
   SOLO si el negocio activó "números de serie" en Configuración.
   Abre Compras directamente en el panel de series y garantías.
   Si el negocio no usa números de serie (o algo falla) no hace nada:
   el menú queda exactamente como estaba.
===================================================== */
(function () {
  'use strict';
  if (window.__n360MenuGarProv) return;
  window.__n360MenuGarProv = true;
  var URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co';
  var KEY_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  var DESTINO = 'compras.html?garantias=1';

  function itemCompras() {
    var nav = document.querySelector('.sidebar-nav'); if (!nav) return null;
    var els = nav.querySelectorAll('.nav-item, a.sidebar-item');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], oc = el.getAttribute('onclick') || '', hr = el.getAttribute('href') || '';
      if ((oc.indexOf("'compras.html'") >= 0 || hr === 'compras.html') && !el.hasAttribute('data-menu-garprov')) return el;
    }
    return null;
  }

  function insertar() {
    try {
      if (document.querySelector('[data-menu-garprov]')) return;
      var base = itemCompras(); if (!base) return;
      if (getComputedStyle(base).display === 'none') return;   // Compras oculto para este perfil: no se agrega
      var nuevo = base.cloneNode(true);
      nuevo.setAttribute('data-menu-garprov', '1');
      nuevo.classList.remove('active');
      if (nuevo.tagName === 'A') nuevo.setAttribute('href', DESTINO); else nuevo.setAttribute('onclick', "window.location.href='" + DESTINO + "'");
      nuevo.removeAttribute('id');
      if (nuevo.hasAttribute('data-tooltip')) nuevo.setAttribute('data-tooltip', 'Garantías de proveedor');
      var svg = nuevo.querySelector('svg');
      if (svg) svg.innerHTML = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>';
      var lbl = nuevo.querySelector('.nav-label, .sidebar-label, span:last-child');
      if (lbl) lbl.textContent = 'Garantías de proveedor';
      else nuevo.appendChild(document.createTextNode(' Garantías de proveedor'));
      base.parentNode.insertBefore(nuevo, base.nextSibling);
    } catch (e) { /* nunca debe afectar la página */ }
  }

  async function usaSeries() {
    try {
      if (!window.supabase || !window.supabase.createClient) return false;
      var cli = window.supabase.createClient(URL_SB, KEY_SB);
      var ses = await cli.auth.getSession();
      var u = ses && ses.data && ses.data.session && ses.data.session.user; if (!u) return false;
      var k = 'n360_usa_serie_' + u.id, c = null;
      try { c = JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) {}
      if (c && Date.now() - c.t < 600000) return c.v === true;
      var r = await cli.from('configuracion_empresa').select('usa_numero_serie').eq('auth_user_id', u.id).maybeSingle();
      var v = !!(r && r.data && r.data.usa_numero_serie === true);
      try { sessionStorage.setItem(k, JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
      return v;
    } catch (e) { return false; }
  }

  async function iniciar() {
    if (!(await usaSeries())) return;
    insertar(); setTimeout(insertar, 1500); setTimeout(insertar, 4000);   // perfiles-guard puede tardar en mostrar/ocultar items
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(iniciar, 400); }); else setTimeout(iniciar, 400);
})();
