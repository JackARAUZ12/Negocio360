/* cr-modo.js — ajustes para negocios de COSTA RICA que venden en COLONES.
 * Se activa SOLO si la cuenta tiene pais = CR y moneda = CRC. En cualquier otra cuenta (Nicaragua, etc.) no hace NADA
 * en pantalla: no cambia textos, no toca cálculos ni datos.
 *  - Muestra "₡" y "colones" donde el sistema decía "C$" y "córdobas" (solo lo que se VE; los montos y la base no cambian).
 *  - Avisa a las pantallas (clientes, productos, configuración) si deben mostrar los campos de Costa Rica: N360CR.activo().
 * El país y la moneda se guardan en este navegador (por cuenta) y se vuelven a leer de la base cada 6 horas. */
(function () {
  'use strict';
  if (window.N360CR) return;
  var CLAVE = 'n360_ctx_pais', TTL = 6 * 3600 * 1000;
  var URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co', KEY_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

  function uidSesion() {
    try {
      for (var k of Object.keys(localStorage)) {
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        var v = JSON.parse(localStorage.getItem(k) || 'null');
        var id = v && ((v.user && v.user.id) || (v.currentSession && v.currentSession.user && v.currentSession.user.id));
        if (id) return id;
      }
    } catch (_) {}
    return null;
  }
  function leer() {
    try {
      var c = JSON.parse(localStorage.getItem(CLAVE) || 'null'), u = uidSesion();
      if (c && u && c.uid === u) return c;
    } catch (_) {}
    return null;
  }
  function guardar(uid, pais, moneda) { try { localStorage.setItem(CLAVE, JSON.stringify({ uid: uid, pais: pais || null, moneda: moneda || null, t: Date.now() })); } catch (_) {} }
  function activo() { var c = leer(); return !!(c && c.pais === 'CR' && c.moneda === 'CRC'); }

  // ---------- Textos: C$ → ₡ , córdobas → colones (solo lo que se ve) ----------
  var PRUEBA = /C\$|[Cc]ordoba|[Cc]órdoba|\bNIO\b/;
  function arreglar(s) {
    return s.replace(/C\$/g, '₡')
      .replace(/Córdobas|Cordobas/g, 'Colones').replace(/córdobas|cordobas/g, 'colones')
      .replace(/Córdoba\b|Cordoba\b/g, 'Colón').replace(/córdoba\b|cordoba\b/g, 'colón')
      .replace(/\bNIO\b/g, 'CRC');
  }
  var OMITIR = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1, CODE: 1 };
  function enNodoTexto(n) {
    var p = n.parentNode;
    if (!p || OMITIR[p.nodeName] || (p.isContentEditable)) return;
    var v = n.nodeValue;
    if (v && PRUEBA.test(v)) { var nv = arreglar(v); if (nv !== v) n.nodeValue = nv; }
  }
  var ATRS = ['placeholder', 'title', 'aria-label'];
  function recorrer(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) { enNodoTexto(raiz); return; }
    if (raiz.nodeType !== 1 || OMITIR[raiz.nodeName]) return;
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) enNodoTexto(n);
    var els = raiz.querySelectorAll ? raiz.querySelectorAll('[placeholder],[title],[aria-label]') : [];
    var lista = [raiz].concat(Array.prototype.slice.call(els));
    lista.forEach(function (e) {
      ATRS.forEach(function (a) {
        var v = e.getAttribute && e.getAttribute(a);
        if (v && PRUEBA.test(v)) { var nv = arreglar(v); if (nv !== v) e.setAttribute(a, nv); }
      });
    });
  }
  var cola = [], programado = false, obs = null;
  function vaciar() {
    programado = false; var l = cola; cola = [];
    for (var i = 0; i < l.length; i++) { try { recorrer(l[i]); } catch (_) {} }
  }
  function encolar(n) { cola.push(n); if (!programado) { programado = true; setTimeout(vaciar, 40); } }
  function arrancar() {
    if (obs || !activo() || !document.body) return;
    recorrer(document.body);
    obs = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'characterData') encolar(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) encolar(m.addedNodes[j]);
      }
    });
    obs.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  // ---------- Leer país y moneda de la cuenta (como máximo cada 6 horas) ----------
  async function refrescar() {
    try {
      var c = leer();
      if (c && Date.now() - (c.t || 0) < ((c.pais && c.moneda) ? TTL : 60000)) return;
      if (!window.supabase) return;
      var cli = window.__n360PeriodoCli || (window.__n360PeriodoCli = window.supabase.createClient(URL_SB, KEY_SB));
      var s = await cli.auth.getSession(); var uid = s && s.data && s.data.session && s.data.session.user && s.data.session.user.id;
      if (!uid) return;
      var r = await cli.from('configuracion_empresa').select('pais, moneda').eq('auth_user_id', uid).maybeSingle();
      if (r && r.data) guardar(uid, r.data.pais, r.data.moneda);
    } catch (_) { /* sin red: se queda lo guardado */ }
  }
  window.N360CR = { activo: activo, refrescar: refrescar, guardar: guardar, arreglar: arreglar };
  window.N360CR.listo = refrescar().then(function () { if (document.readyState !== 'loading') arrancar(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
