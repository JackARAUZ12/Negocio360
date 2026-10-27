/* reloj-sesion.js — la sesión funciona aunque la hora del equipo esté mal.
 *
 * Supabase guarda cuándo vence la sesión con la hora del SERVIDOR y la compara
 * con la hora del EQUIPO. Si la computadora va una hora (o más) adelantada, la
 * sesión recién creada "ya venció": el navegador la renueva sin parar, el
 * servidor lo frena por exceso de intentos y la persona vuelve al login.
 *
 * Aquí, al guardar la sesión, se mide la diferencia entre la hora del equipo y
 * la hora en que el servidor creó la sesión (iat), SOLO cuando el servidor la
 * acaba de entregar (respuesta de /auth/v1/token hace segundos; una sesión
 * vieja restaurada no sirve para medir), y se pasa el vencimiento a la hora del equipo. El acceso real lo sigue
 * revisando el servidor con su propia hora: esto solo evita las renovaciones
 * en cadena. Con la hora bien (diferencia menor a 2 minutos) no cambia NADA.
 */
(function () {
  'use strict';
  if (window.__n360RelojSesion || typeof Storage === 'undefined') return;
  window.__n360RelojSesion = true;
  var CLAVE = /^sb-[a-z0-9]+-auth-token$/, DESFASE = 'n360_reloj_desfase', MIN_SEG = 120;
  var proto = Storage.prototype, setOrig = proto.setItem, getOrig = proto.getItem;

  // Momento (hora del equipo) en que llegó la última sesión nueva del servidor.
  var ultimaEntrega = 0;
  if (typeof window.fetch === 'function') {
    var fetchOrig = window.fetch;
    window.fetch = function (entrada) {
      var p = fetchOrig.apply(this, arguments);
      try {
        var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        if (url.indexOf('/auth/v1/token') !== -1) p.then(function (r) { if (r && r.ok) ultimaEntrega = Date.now(); }, function () {});
      } catch (e) {}
      return p;
    };
  }

  function claims(tok) {
    try {
      var b = String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b + '==='.slice((b.length + 3) % 4)));
    } catch (e) { return null; }
  }
  function leerDesfase(st) {
    try { var d = JSON.parse(getOrig.call(st, DESFASE) || 'null'); return d && typeof d.seg === 'number' ? d.seg : 0; } catch (e) { return 0; }
  }
  // Vencimiento según la hora del equipo (solo si el reloj está realmente desfasado).
  function ajustar(ses, seg) {
    if (!ses || !ses.access_token || Math.abs(seg) < MIN_SEG) return false;
    var c = claims(ses.access_token);
    if (!c || typeof c.exp !== 'number') return false;
    var nuevo = c.exp + seg;
    if (ses.expires_at === nuevo) return false;
    ses.expires_at = nuevo;
    return true;
  }

  proto.setItem = function (k, v) {
    try {
      if (CLAVE.test(k)) {
        var ses = JSON.parse(v), seg = leerDesfase(this);
        var antes = null; try { antes = JSON.parse(getOrig.call(this, k) || 'null'); } catch (e) {}
        // Sesión recién entregada por el servidor (distinta de la guardada): se mide el desfase.
        if (ses && ses.access_token && (!antes || antes.access_token !== ses.access_token) && Date.now() - ultimaEntrega < 15000) {
          var c = claims(ses.access_token);
          if (c && typeof c.iat === 'number') {
            seg = Math.round(Date.now() / 1000) - c.iat;
            if (Math.abs(seg) < MIN_SEG) seg = 0;
            setOrig.call(this, DESFASE, JSON.stringify({ seg: seg, medido: c.iat }));
          }
        }
        if (ajustar(ses, seg)) v = JSON.stringify(ses);
      }
    } catch (e) { /* ante cualquier duda se guarda tal cual, como siempre */ }
    return setOrig.call(this, k, v);
  };

  // Una sesión guardada antes (sin ajustar) se entrega ya ajustada.
  proto.getItem = function (k) {
    var v = getOrig.call(this, k);
    try {
      if (v && CLAVE.test(k)) {
        var ses = JSON.parse(v);
        if (ajustar(ses, leerDesfase(this))) return JSON.stringify(ses);
      }
    } catch (e) {}
    return v;
  };
})();
