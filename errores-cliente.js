/* errores-cliente.js — Registro de errores para soporte (panel de administrador).
 *
 * Cuando a un cliente le falla algo en pantalla (un error de la página o un aviso
 * rojo de "No se pudo…"), se guarda en silencio para que el administrador lo vea
 * en "Errores en vivo" y lo arregle antes de que el cliente tenga que llamar.
 *
 * - Solo guarda: página, tipo, mensaje y detalle técnico (sin datos del negocio).
 * - Nunca interrumpe a la persona ni cambia nada de la página: si falla, se calla.
 * - Frenos: máx. 30 envíos por página abierta, el mismo error una sola vez por
 *   página, y el servidor acepta máx. 200 errores distintos por cuenta al día.
 */
(function () {
  'use strict';
  if (window.__n360Errores) return;
  window.__n360Errores = true;

  var VERSION = '20261118a', MAX_ENVIOS = 30;
  var enviados = {}, totalEnvios = 0, enviando = false;

  function pagina() { return ((location.pathname || '').split('/').pop() || 'index.html').slice(0, 80); }

  // Errores que no son del sistema (extensiones del navegador, internet caído, avisos del navegador)
  var RUIDO = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|safari-(web-)?extension|Non-Error promise rejection|AbortError|The user aborted|signal is aborted|Failed to fetch|NetworkError|Load failed|network error|ERR_INTERNET_DISCONNECTED|cancelad[oa]/i;

  function cliente() {
    var cs = window.__n360SbClientes || [];
    for (var i = 0; i < cs.length; i++) if (cs[i] && typeof cs[i].rpc === 'function') return cs[i];
    return null;
  }

  function texto(x) {
    try {
      if (x == null) return '';
      if (typeof x === 'string') return x;
      if (x.message) return String(x.message);
      return JSON.stringify(x).slice(0, 500);
    } catch (e) { return String(x); }
  }

  function reportar(tipo, mensaje, detalle) {
    try {
      mensaje = texto(mensaje).replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!mensaje || RUIDO.test(mensaje) || (detalle && RUIDO.test(String(detalle)))) return;
      var clave = tipo + '|' + mensaje;
      if (enviados[clave] || totalEnvios >= MAX_ENVIOS || enviando) return;
      var c = cliente(); if (!c) return;
      enviados[clave] = true; totalEnvios++;
      enviando = true;
      var p = c.rpc('reportar_error_cliente', {
        p_pagina: pagina(), p_tipo: tipo, p_mensaje: mensaje,
        p_detalle: detalle ? String(detalle).slice(0, 2000) : null,
        p_ua: (navigator.userAgent || '').slice(0, 300), p_version: VERSION,
      });
      Promise.resolve(p).then(function () { enviando = false; }, function () { enviando = false; });
      setTimeout(function () { enviando = false; }, 4000);
    } catch (e) { enviando = false; }
  }

  // Errores que ya pasaron antes de que este archivo cargara (los guarda reloj-sesion.js)
  var cola = window.__n360ErrQ || [];
  for (var i = 0; i < cola.length; i++) reportar(cola[i][0], cola[i][1], cola[i][2]);
  window.__n360ErrQ = [];

  window.addEventListener('error', function (e) {
    if (!e || (e.target && e.target !== window && !e.message)) return; // imagen/recurso que no cargó: no es error del sistema
    var donde = (e.filename || '').split('/').pop() + (e.lineno ? ':' + e.lineno + ':' + (e.colno || 0) : '');
    reportar('js', e.message, [donde, e.error && e.error.stack].filter(Boolean).join('\n'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    reportar('promesa', texto(r), r && r.stack);
  });

  // Avisos rojos que ve la persona ("No se pudo guardar…"). Cada página tiene su
  // propio showToast con distintos parámetros: se registra si alguno dice 'error'.
  function engancharToast() {
    var f = window.showToast;
    if (typeof f !== 'function' || f.__n360Err) return;
    var envuelto = function () {
      try {
        var args = Array.prototype.slice.call(arguments);
        if (args.indexOf('error') !== -1) {
          var msg = args.filter(function (a) { return typeof a === 'string' && a !== 'error'; }).join(' — ');
          reportar('aviso', msg, null);
        }
      } catch (e) {}
      return f.apply(this, arguments);
    };
    envuelto.__n360Err = true;
    try { window.showToast = envuelto; } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', engancharToast);
  else engancharToast();
  setTimeout(engancharToast, 2000);
  setTimeout(engancharToast, 6000);
})();
