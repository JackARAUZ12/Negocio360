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

  // Clientes de Supabase de la página (para renovar la sesión con la propia librería).
  var clientes = [];
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    var crearOrig = window.supabase.createClient;
    window.supabase.createClient = function (url, clave, opciones) {
      var c = crearOrig.apply(this, arguments);
      try { if (!(opciones && opciones.auth && opciones.auth.persistSession === false)) clientes.push(c); } catch (e) {}
      return c;
    };
  }

  // Si la hora del equipo cambia, la diferencia medida ya no sirve: se olvida y la
  // sesión se marca para renovarse (al renovarla se vuelve a medir con la hora nueva).
  function olvidarDesfase() {
    try {
      setOrig.call(localStorage, DESFASE, JSON.stringify({ seg: 0, medido: 0 }));
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!CLAVE.test(k)) continue;
        var ses = JSON.parse(getOrig.call(localStorage, k) || 'null');
        if (ses && ses.expires_at) { ses.expires_at = Math.round(Date.now() / 1000) - 1; setOrig.call(localStorage, k, JSON.stringify(ses)); }
      }
    } catch (e) {}
  }

  function sesionGuardada() {
    try {
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (CLAVE.test(k)) { var s = JSON.parse(getOrig.call(localStorage, k) || 'null'); if (s && s.access_token) return s.access_token; } }
    } catch (e) {}
    return null;
  }
  // Sesión para repetir una acción rechazada: si ya hay una más nueva guardada se usa
  // esa; si no, se renueva UNA vez aunque fallen varias acciones a la vez.
  var renovando = null;
  function sesionNueva(vencido) {
    var g = sesionGuardada();
    if (g && g !== vencido) return Promise.resolve(g);
    if (renovando) return renovando;
    var c = clientes[clientes.length - 1];
    if (!c) return Promise.resolve(null);
    renovando = c.auth.refreshSession().then(function (r) { return r && r.data && r.data.session ? r.data.session.access_token : null; }, function () { return null; })
      .then(function (t) { renovando = null; return t; });
    return renovando;
  }

  if (typeof window.fetch === 'function') {
    var fetchOrig = window.fetch;
    window.fetch = function (entrada, init) {
      var p = fetchOrig.apply(this, arguments);
      try {
        var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        if (url.indexOf('/auth/v1/token') !== -1) p.then(function (r) { if (r && r.ok) ultimaEntrega = Date.now(); }, function () {});
        // Acción rechazada porque la sesión ya venció ("JWT expired"): se renueva la
        // sesión y se repite la MISMA acción una sola vez, sin mostrar error a la persona.
        else if (typeof entrada === 'string' && /\.supabase\.co\//.test(url) && init && init.headers) {
          var h = new Headers(init.headers), aut = h.get('Authorization') || '';
          var cl = claims(aut.replace(/^Bearer\s+/i, ''));
          if (cl && cl.role === 'authenticated') {
            var self = this;
            p = p.then(function (r) {
              if (!r || r.status !== 401) return r;
              return r.clone().text().then(function (txt) {
                if (!/jwt expired/i.test(txt)) return r;
                var vencido = aut.replace(/^Bearer\s+/i, '');
                // La diferencia guardada ya no sirve (la hora cambió); la renovación la vuelve a medir.
                try { setOrig.call(localStorage, DESFASE, JSON.stringify({ seg: 0, medido: 0 })); } catch (e) {}
                return sesionNueva(vencido).then(function (nuevo) {
                  if (!nuevo || nuevo === vencido) return r;
                  var h2 = new Headers(init.headers); h2.set('Authorization', 'Bearer ' + nuevo);
                  var init2 = {}; for (var x in init) init2[x] = init[x]; init2.headers = h2;
                  return fetchOrig.call(self, entrada, init2);
                });
              }, function () { return r; });
            });
          }
        }
      } catch (e) {}
      return p;
    };
  }

  // Cambio de hora con el sistema abierto: el reloj del equipo salta y el contador
  // interno del navegador no; si se separan más de 2 minutos, se vuelve a medir.
  try {
    if (window.performance && performance.now) {
      var base0 = Date.now() - performance.now();
      setInterval(function () {
        var base = Date.now() - performance.now();
        if (Math.abs(base - base0) > MIN_SEG * 1000) { base0 = base; olvidarDesfase(); }
      }, 20000);
    }
  } catch (e) {}

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
