/* ============================================================
   DESCARGAS-APP.JS — NEGOCIO360 · Descargas dentro de la app de Android
   La app de Android es una ventana web (Capacitor). Los recibos, reportes y
   Excel se generan en el navegador como archivo en memoria (enlace blob:) y
   esa ventana NO sabe guardarlos: "no se pudo completar la descarga".
   Aquí, SOLO dentro de la app, el archivo se sube un momento a la carpeta
   PRIVADA de la persona (bucket descargas-app, enlace válido 5 minutos) y se
   abre en Chrome del teléfono, que sí lo guarda en Descargas.
   En computadora y en Chrome normal NO hace nada: todo sigue igual.
   No toca ventas, Caja, inventario ni montos: solo entrega el archivo.
   ============================================================ */
(function () {
  'use strict';
  if (window.__n360DescargasApp) return;
  window.__n360DescargasApp = true;

  var URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co';
  var CLAVE_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  var BUCKET = 'descargas-app';

  function enApp() {
    try {
      if (window.__n360ForzarDescargasApp === true) return true;
      var C = window.Capacitor;
      if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return true;
      var ua = navigator.userAgent || '';
      return /Android/i.test(ua) && /; wv\)/.test(ua);
    } catch (_) { return false; }
  }
  if (!enApp()) return;

  // Guarda los archivos en memoria que crea la página, para no tener que leerlos de nuevo.
  var blobs = new Map();
  var crearOrig = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    var u = crearOrig.apply(URL, arguments);
    try { if (obj instanceof Blob) { blobs.set(u, obj); setTimeout(function () { blobs.delete(u); }, 180000); } } catch (_) {}
    return u;
  };

  function esArchivoLocal(href) { return /^(blob:|data:)/i.test(String(href || '')); }

  function sesion() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!/^sb-[a-z0-9]+-auth-token$/.test(k)) continue;
        var s = JSON.parse(localStorage.getItem(k) || 'null');
        if (s && s.access_token && s.user && s.user.id) return { token: s.access_token, uid: s.user.id };
      }
    } catch (_) {}
    return null;
  }

  function nombreSeguro(n) {
    n = String(n || '').trim() || 'archivo';
    n = n.normalize ? n.normalize('NFD').replace(/[̀-ͯ]/g, '') : n;
    n = n.replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
    return n || 'archivo';
  }

  /* ---------- Ventanita de estado (siempre clara, se entiende a la primera) ---------- */
  var ov = null;
  function mostrar(html, botones) {
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'n360-descarga-app';
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;color-scheme:light';
      document.body.appendChild(ov);
    }
    ov.innerHTML = '<div style="background:#fff;color:#111;border-radius:14px;max-width:380px;width:100%;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">' +
      html + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap">' + (botones || '') + '</div></div>';
    var x = ov.querySelector('[data-cerrar]'); if (x) x.onclick = cerrar;
    return ov;
  }
  function cerrar() { try { ov && ov.remove(); } catch (_) {} ov = null; }
  var BTN = 'border:none;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer;';

  function abrirEnlace(url) {
    // Capacitor manda los enlaces de otro sitio a Chrome del teléfono, que guarda el archivo.
    try { window.location.href = url; } catch (_) {}
  }

  async function limpiarViejos(s) {
    try {
      var r = await fetch(URL_SB + '/storage/v1/object/list/' + BUCKET, {
        method: 'POST', headers: { Authorization: 'Bearer ' + s.token, apikey: CLAVE_SB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: s.uid + '/', limit: 100, sortBy: { column: 'created_at', order: 'asc' } })
      });
      if (!r.ok) return;
      var lista = await r.json(), limite = Date.now() - 30 * 60000;
      var viejos = (lista || []).filter(function (f) { return f && f.name && f.created_at && Date.parse(f.created_at) < limite; })
        .map(function (f) { return s.uid + '/' + f.name; });
      if (!viejos.length) return;
      await fetch(URL_SB + '/storage/v1/object/' + BUCKET, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + s.token, apikey: CLAVE_SB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: viejos })
      });
    } catch (_) {}
  }

  var ocupado = false;
  async function entregar(href, nombre) {
    if (ocupado) return;
    ocupado = true;
    var archivo = nombreSeguro(nombre);
    mostrar('<b style="font-size:15px">⏳ Preparando la descarga…</b><div style="color:#555;margin-top:6px">' + archivo.replace(/[<>&]/g, '') + '</div>');
    try {
      var blob = blobs.get(href);
      if (!blob) blob = await (await fetch(href)).blob();
      if (!blob || !blob.size) throw new Error('archivo vacío');
      var s = sesion();
      if (!s) throw new Error('sin sesión');
      var ruta = s.uid + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + archivo;
      var rutaUrl = ruta.split('/').map(encodeURIComponent).join('/');
      var sub = await fetch(URL_SB + '/storage/v1/object/' + BUCKET + '/' + rutaUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + s.token, apikey: CLAVE_SB, 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'false' },
        body: blob
      });
      if (!sub.ok) throw new Error('subida ' + sub.status);
      var fir = await fetch(URL_SB + '/storage/v1/object/sign/' + BUCKET + '/' + rutaUrl, {
        method: 'POST', headers: { Authorization: 'Bearer ' + s.token, apikey: CLAVE_SB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 300 })
      });
      if (!fir.ok) throw new Error('enlace ' + fir.status);
      var j = await fir.json();
      var firmado = j.signedURL || j.signedUrl;
      if (!firmado) throw new Error('sin enlace');
      var url = URL_SB + '/storage/v1' + firmado + (firmado.indexOf('?') >= 0 ? '&' : '?') + 'download=' + encodeURIComponent(archivo);
      mostrar('<b style="font-size:15px">✅ Descarga lista</b><div style="color:#444;margin-top:6px">Se abrirá Chrome y el archivo <b>' + archivo.replace(/[<>&]/g, '') +
        '</b> quedará en <b>Descargas</b> del teléfono. Luego regresa a la app.</div>',
        '<button type="button" data-cerrar style="' + BTN + 'background:#eee;color:#111">Cerrar</button>' +
        '<button type="button" data-abrir style="' + BTN + 'background:#5a5af4;color:#fff">⬇️ Descargar de nuevo</button>');
      ov.querySelector('[data-abrir]').onclick = function () { abrirEnlace(url); };
      abrirEnlace(url);
      limpiarViejos(s);
    } catch (e) {
      console.warn('Descarga en la app:', e);
      mostrar('<b style="font-size:15px;color:#b91c1c">No se pudo descargar</b><div style="color:#444;margin-top:6px">' +
        (String(e && e.message) === 'sin sesión' ? 'Tu sesión venció. Cierra sesión, vuelve a entrar e intenta de nuevo.' : 'Revisa tu internet e intenta de nuevo.') + '</div>',
        '<button type="button" data-cerrar style="' + BTN + 'background:#5a5af4;color:#fff">Entendido</button>');
    } finally { ocupado = false; }
  }

  function interceptar(a) {
    try {
      if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
      var href = a.getAttribute('href') || a.href;
      if (!esArchivoLocal(href)) return false;
      entregar(a.href || href, a.getAttribute('download') || 'archivo');
      return true;
    } catch (_) { return false; }
  }

  // a.click() (Excel y la mayoría de descargas)
  var clickOrig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (interceptar(this)) return;
    return clickOrig.apply(this, arguments);
  };
  // a.dispatchEvent(new MouseEvent('click')) (así descarga jsPDF: doc.save)
  var dispOrig = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && interceptar(this)) return false;
    return dispOrig.apply(this, arguments);
  };
  // Toques reales sobre un enlace de descarga
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[download]') : null;
    if (a && interceptar(a)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);
  // window.open(blob:) (PDF abierto para imprimir): en la app también se entrega como descarga
  var openOrig = window.open;
  window.open = function (u) {
    if (esArchivoLocal(u)) { entregar(String(u), 'documento.pdf'); return null; }
    return openOrig.apply(window, arguments);
  };

  window.N360DescargasApp = { entregar: entregar, activo: true };
})();
