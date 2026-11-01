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
  // Para PDF y CSV: las fuentes estándar de los PDF no dibujan "₡", así que ahí se usa "CRC".
  function arreglarPlano(s) { return arreglar(s).replace(/₡\s?/g, 'CRC '); }
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
    var els = raiz.querySelectorAll ? raiz.querySelectorAll('[placeholder],[title],[aria-label],a[href]') : [];
    var lista = [raiz].concat(Array.prototype.slice.call(els));
    lista.forEach(function (e) {
      if (e.nodeName === 'A') {
        var hr = e.getAttribute('href');
        if (hr && ESMENSAJE.test(hr)) { var nh = arreglarUrl(hr); if (nh !== hr) e.setAttribute('href', nh); }
      }
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

  // ---------- Salidas: impresión, PDF, Excel/CSV, WhatsApp, portapapeles ----------
  var ESMENSAJE = /^(https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)|whatsapp:|mailto:|sms:)/i;
  function arreglarUrl(u) {
    if (typeof u !== 'string' || !ESMENSAJE.test(u)) return u;
    var i = u.indexOf('?'); if (i < 0) return u;
    var q = u.slice(i + 1).split('&').map(function (kv) {
      var j = kv.indexOf('='); if (j < 0) return kv;
      var k = kv.slice(0, j); if (!/^(text|body|subject)$/i.test(k)) return kv;
      var v; try { v = decodeURIComponent(kv.slice(j + 1).replace(/\+/g, ' ')); } catch (e) { return kv; }
      return k + '=' + encodeURIComponent(arreglar(v));
    }).join('&');
    return u.slice(0, i + 1) + q;
  }
  // Solo el TEXTO visible del HTML (nunca scripts, estilos ni atributos).
  function arreglarHtml(h) {
    if (typeof h !== 'string' || !PRUEBA.test(h)) return h;
    return h.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>)/i).map(function (p) {
      if (/^<(script|style)/i.test(p)) return p;
      return ('>' + p + '<').replace(/>([^<>]+)</g, function (m, t) { return '>' + arreglar(t) + '<'; }).slice(1, -1);
    }).join('');
  }
  function parchearDoc(d) {
    if (!d || d.__n360cr) return; d.__n360cr = true;
    ['write', 'writeln'].forEach(function (m) {
      var o = d[m]; if (typeof o !== 'function') return;
      d[m] = function () { var a = Array.prototype.map.call(arguments, function (x) { return typeof x === 'string' ? arreglarHtml(x) : x; }); return o.apply(d, a); };
    });
  }
  function arreglarLibro(wb) {
    var Sh = wb && wb.Sheets; if (!Sh) return;
    Object.keys(Sh).forEach(function (n) {
      var ws = Sh[n]; if (!ws) return;
      Object.keys(ws).forEach(function (k) {
        if (k.charAt(0) === '!') return; var c = ws[k]; if (!c || typeof c !== 'object') return;
        if (c.t === 's' && typeof c.v === 'string' && PRUEBA.test(c.v)) { c.v = arreglar(c.v); if (typeof c.w === 'string') c.w = arreglar(c.w); }
        if (typeof c.z === 'string' && PRUEBA.test(c.z)) c.z = arreglar(c.z);
      });
    });
  }
  function fixTxt(t) { return typeof t === 'string' ? arreglarPlano(t) : (Array.isArray(t) ? t.map(fixTxt) : t); }
  function fixCelda(c) { if (typeof c === 'string') return arreglarPlano(c); if (c && typeof c === 'object' && typeof c.content === 'string') { var o = Object.assign({}, c); o.content = arreglarPlano(c.content); return o; } return c; }
  function fixTabla(o) {
    var r = Object.assign({}, o);
    ['head', 'body', 'foot'].forEach(function (k) { if (Array.isArray(r[k])) r[k] = r[k].map(function (f) { return Array.isArray(f) ? f.map(fixCelda) : (f && typeof f === 'object' ? Object.keys(f).reduce(function (a, kk) { a[kk] = fixCelda(f[kk]); return a; }, {}) : f); }); });
    if (Array.isArray(r.columns)) r.columns = r.columns.map(function (c) { return (c && typeof c === 'object' && typeof c.header === 'string') ? Object.assign({}, c, { header: arreglarPlano(c.header) }) : c; });
    return r;
  }
  var salidasListas = false;
  function instalarSalidas() {
    if (salidasListas) return; salidasListas = true;
    try { // ventanas de impresión
      var wo = window.open;
      window.open = function () {
        var a = Array.prototype.slice.call(arguments);
        if (activo() && typeof a[0] === 'string') a[0] = arreglarUrl(a[0]);
        var w = wo.apply(this, a);
        if (activo() && w) { try { parchearDoc(w.document); } catch (_) {} }
        return w;
      };
    } catch (_) {}
    try { // iframes de impresión
      ['contentDocument', 'contentWindow'].forEach(function (p) {
        var d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, p); if (!d || !d.get) return;
        Object.defineProperty(HTMLIFrameElement.prototype, p, { configurable: true, enumerable: d.enumerable, get: function () {
          var v = d.get.call(this); try { if (activo() && v) parchearDoc(p === 'contentDocument' ? v : v.document); } catch (_) {} return v; } });
      });
      var sd = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
      if (sd && sd.set) Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', { configurable: true, enumerable: sd.enumerable, get: sd.get, set: function (v) { sd.set.call(this, activo() ? arreglarHtml(v) : v); } });
    } catch (_) {}
    try { // archivos CSV y HTML
      var OB = window.Blob;
      var B = function (parts, opts) {
        var t = (opts && opts.type) || '';
        if (activo() && Array.isArray(parts) && /text\/(csv|html)/i.test(t)) {
          var csv = /csv/i.test(t);
          parts = parts.map(function (x) { return typeof x === 'string' ? (csv ? arreglarPlano(x) : arreglarHtml(x)) : x; });
        }
        return new OB(parts, opts);
      };
      B.prototype = OB.prototype; window.Blob = B;
    } catch (_) {}
    try { // WhatsApp, correo y portapapeles
      if (navigator.clipboard && navigator.clipboard.writeText) {
        var cw = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = function (t) { return cw(activo() && typeof t === 'string' ? arreglar(t) : t); };
      }
      if (navigator.share) {
        var ns = navigator.share.bind(navigator);
        navigator.share = function (d) { if (activo() && d && typeof d === 'object') { d = Object.assign({}, d); if (typeof d.text === 'string') d.text = arreglar(d.text); if (typeof d.title === 'string') d.title = arreglar(d.title); } return ns(d); };
      }
    } catch (_) {}
    // Librerías que se cargan después (Excel y PDF): se engancha en cuanto aparecen.
    var intentos = 0, t = null;
    function chequear() {
      intentos++; var hecho = true;
      try {
        if (window.XLSX && !window.XLSX.__n360cr) {
          window.XLSX.__n360cr = true;
          ['writeFile', 'writeFileXLSX', 'write'].forEach(function (m) {
            var o = window.XLSX[m]; if (typeof o !== 'function') return;
            window.XLSX[m] = function (wb) { if (activo()) { try { arreglarLibro(wb); } catch (_) {} } return o.apply(this, arguments); };
          });
        }
        if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && !window.jspdf.jsPDF.API.__n360cr) {
          var API = window.jspdf.jsPDF.API; API.__n360cr = true;
          // jsPDF avisa antes de dibujar cada texto: ahí se corrige (solo vale para PDFs creados después de este momento).
          if (API.events && typeof API.events.push === 'function') API.events.push(['preProcessText', function (payload) { if (activo() && payload) payload.text = fixTxt(payload.text); }]);
        }
        if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && typeof window.jspdf.jsPDF.API.autoTable === 'function' && !window.jspdf.jsPDF.API.autoTable.__n360cr) {
          var API2 = window.jspdf.jsPDF.API, oa = API2.autoTable;
          API2.autoTable = function () { var a = Array.prototype.slice.call(arguments); if (activo() && a[0] && typeof a[0] === 'object' && !a[0].internal) a[0] = fixTabla(a[0]); return oa.apply(this, a); };
          API2.autoTable.__n360cr = true;
        }
        hecho = !!(window.XLSX && window.XLSX.__n360cr) && !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable && window.jspdf.jsPDF.API.autoTable.__n360cr);
      } catch (_) {}
      if (hecho) clearInterval(t);
      else if (intentos === 40) { clearInterval(t); t = setInterval(chequear, 4000); }  // páginas que cargan Excel/PDF más tarde
    }
    t = setInterval(chequear, 700);
  }
  function arrancar() {
    if (!activo()) return;
    instalarSalidas();
    if (obs || !document.body) return;
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
  // ---------- CAByS en las líneas de los comprobantes (solo cuentas CR/CRC) ----------
  // Devuelve las líneas con el CAByS: el guardado en la línea, o (ventas anteriores / proformas) el del producto.
  // Lo agrega al nombre como una línea más ("CAByS: 1234567890123"), igual que el detalle de los combos, para que
  // salga en CUALQUIER ticket o comprobante que ya sepa imprimir ese detalle. Si no hay CAByS, no cambia nada.
  async function conCabys(items) {
    try {
      if (!activo() || !Array.isArray(items) || !items.length) return items;
      var yaTiene = function (it) { return /CAByS:/.test(String((it && (it.nombre || it.producto_nombre)) || '')); };
      var idDe = function (it) { return it && (it.producto_id || it.id); };
      var faltan = items.filter(function (it) { return it && !it.cabys && idDe(it) && !yaTiene(it); });
      var mapa = {};
      if (faltan.length && window.supabase) {
        var cli = window.__n360PeriodoCli || (window.__n360PeriodoCli = window.supabase.createClient(URL_SB, KEY_SB));
        var ids = []; faltan.forEach(function (it) { if (ids.indexOf(idDe(it)) < 0) ids.push(idDe(it)); });
        var r = await cli.from('productos').select('id, cabys').in('id', ids);
        ((r && r.data) || []).forEach(function (p) { if (p.cabys) mapa[p.id] = p.cabys; });
      }
      return items.map(function (it) {
        if (!it || yaTiene(it)) return it;
        var c = it.cabys || mapa[idDe(it)];
        if (!c) return it;
        var o = Object.assign({}, it, { cabys: c }), suf = '\nCAByS: ' + c;
        if (it.nombre) o.nombre = it.nombre + suf;
        if (it.producto_nombre) o.producto_nombre = it.producto_nombre + suf;
        return o;
      });
    } catch (_) { return items; }
  }

  window.N360CR = { activo: activo, refrescar: refrescar, guardar: guardar, arreglar: arreglar, arreglarPlano: arreglarPlano, arreglarHtml: arreglarHtml, conCabys: conCabys };
  window.N360CR.listo = refrescar().then(function () { if (document.readyState !== 'loading') arrancar(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
