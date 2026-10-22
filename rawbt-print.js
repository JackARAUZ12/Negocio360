/* =====================================================
   IMPRESIÓN DIRECTA CON RAWBT (Android, papel de 80 mm)
   RawBT es una app de Android que recibe la orden de impresión
   directamente (texto ESC/POS) y la manda a la impresora Bluetooth/USB.
   Así el ticket sale a 48 columnas, con letra normal y centrado, sin
   pasar por la conversión de página web a imagen (que lo encogía y
   lo dejaba pegado a la izquierda).

   Solo se usa si el negocio activó "Imprimir directo con RawBT" en la
   configuración del ticket Y el equipo es Android. En cualquier otro
   caso no hace nada y todo sigue imprimiendo como siempre.
   No toca ventas, caja, contabilidad ni ningún dato.
===================================================== */
(function () {
  'use strict';
  var COLS = 48;                       // papel de 80 mm, letra normal
  var ESC = 0x1B, GS = 0x1D;

  function esAndroid() { return /Android/i.test(navigator.userAgent || ''); }
  // ¿Esta configuración pide RawBT y el equipo puede usarlo?
  function rawbtActivo(cfg) {
    return !!(cfg && cfg.imprimir_rawbt && cfg.ancho_ticket !== 'carta' && esAndroid());
  }

  /* ---------- texto → bytes CP437 (la tabla que usa la impresora) ---------- */
  var MAPA = {
    'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5, 'ü': 0x81, 'Ü': 0x9A,
    '¿': 0xA8, '¡': 0xAD, 'É': 0x90, 'ä': 0x84, 'ö': 0x94, '°': 0xF8, '±': 0xF1
  };
  var SIN_ACENTO = { 'Á': 'A', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
    'À': 'A', 'È': 'E', 'Ì': 'I', 'Ò': 'O', 'Ù': 'U', 'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u',
    '·': '-', '—': '-', '–': '-', '×': 'x', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '•': '*', ' ': ' ' };
  function aBytes(texto) {
    var out = [];
    var s = String(texto == null ? '' : texto);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (MAPA[ch] !== undefined) { out.push(MAPA[ch]); continue; }
      if (SIN_ACENTO[ch] !== undefined) { var r = SIN_ACENTO[ch]; for (var k = 0; k < r.length; k++) out.push(r.charCodeAt(k)); continue; }
      var c = ch.charCodeAt(0);
      if (c >= 32 && c < 127) out.push(c);
      else if (c === 10) out.push(10);
      else if (c >= 0xD800 && c <= 0xDFFF) { /* emoji: se omite */ }
      else out.push(0x3F);
    }
    return out;
  }
  // Largo visible de un texto (lo que se imprime, no lo que ocupa en memoria)
  function largo(t) { return aBytes(t).length; }

  function limpiar(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }

  // Parte un texto en líneas de máximo n caracteres, sin cortar palabras si se puede
  function envolver(texto, n) {
    var palabras = limpiar(texto).split(' ').filter(Boolean);
    var lineas = [], act = '';
    palabras.forEach(function (p) {
      while (largo(p) > n) {            // palabra más larga que la línea
        if (act) { lineas.push(act); act = ''; }
        lineas.push(p.slice(0, n)); p = p.slice(n);
      }
      if (!act) act = p;
      else if (largo(act) + 1 + largo(p) <= n) act += ' ' + p;
      else { lineas.push(act); act = p; }
    });
    if (act) lineas.push(act);
    return lineas.length ? lineas : [''];
  }

  /* ---------- elementos del ticket ----------
     {t:'centro', texto, negrita, grande}   texto centrado
     {t:'texto', texto, negrita}            texto a la izquierda (se envuelve)
     {t:'fila', izq, der, negrita, grande}  etiqueta a la izquierda y valor a la derecha
     {t:'linea'}                            raya de separación
     {t:'espacio', n}                       n líneas en blanco
  */
  function armarBytes(elementos) {
    var b = [];
    function push(arr) { for (var i = 0; i < arr.length; i++) b.push(arr[i]); }
    function linea(texto) { push(aBytes(texto)); b.push(10); }
    function pad(n) { return n > 0 ? new Array(n + 1).join(' ') : ''; }

    b.push(ESC, 0x40);                 // inicializar
    b.push(ESC, 0x74, 0x00);           // tabla de caracteres CP437
    b.push(ESC, 0x61, 0x00);           // alineado a la izquierda

    elementos.forEach(function (e) {
      if (!e) return;
      var neg = !!e.negrita;
      if (e.t === 'linea') { linea(new Array(COLS + 1).join('-')); return; }
      if (e.t === 'espacio') { for (var i = 0; i < (e.n || 1); i++) b.push(10); return; }

      b.push(ESC, 0x45, neg ? 1 : 0);                          // negrita
      b.push(GS, 0x21, e.grande ? 0x01 : 0x00);                // doble alto (no doble ancho: no cambia las columnas)

      if (e.t === 'centro') {
        envolver(e.texto, COLS).forEach(function (l) {
          linea(pad(Math.floor((COLS - largo(l)) / 2)) + l);
        });
      } else if (e.t === 'texto') {
        envolver(e.texto, COLS).forEach(function (l) { linea(l); });
      } else if (e.t === 'fila') {
        var izq = limpiar(e.izq), der = limpiar(e.der);
        if (!der) { envolver(izq, COLS).forEach(function (l) { linea(l); }); }
        else if (largo(izq) + 1 + largo(der) <= COLS) {
          linea(izq + pad(COLS - largo(izq) - largo(der)) + der);
        } else {
          // no cabe en una línea: la etiqueta se envuelve y el valor va a la derecha en la última
          var ls = envolver(izq, COLS - largo(der) - 1);
          ls.forEach(function (l, idx) {
            if (idx < ls.length - 1) linea(l);
            else linea(l + pad(COLS - largo(l) - largo(der)) + der);
          });
        }
      }
      b.push(ESC, 0x45, 0); b.push(GS, 0x21, 0x00);
    });

    b.push(10, 10, 10, 10);            // espacio para poder cortar
    b.push(GS, 0x56, 0x42, 0x00);      // corte parcial (si la impresora no corta, lo ignora)
    return b;
  }

  /* ---------- enviar a RawBT ---------- */
  function aBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.slice(i, i + 0x8000));
    return btoa(s);
  }
  function enviarARawBT(bytes) {
    var url = 'intent:base64,' + aBase64(bytes) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
    window.location.href = url;
  }
  function imprimirElementos(elementos) {
    try {
      enviarARawBT(armarBytes(elementos));
      return { ok: true };
    } catch (e) {
      console.error('RawBT:', e);
      if (typeof showToast === 'function') showToast('No se pudo enviar el ticket a RawBT', 'error');
      return { ok: false };
    }
  }

  /* ---------- convertir un ticket ya armado en pantalla (Créditos / Proformas) ---------- */
  var FILAS = ['tp-row', 'fila-dato'];
  function tieneClase(el, c) { return el.classList && el.classList.contains(c); }
  function estilo(el) { return (el.getAttribute && el.getAttribute('style')) || ''; }
  function esNegrita(el) {
    var st = estilo(el);
    return /font-weight\s*:\s*(bold|[6-9]00)/i.test(st) || tieneClase(el, 'negrita') || /^(B|STRONG)$/.test(el.tagName);
  }
  function esCentrado(el) { return /text-align\s*:\s*center/i.test(estilo(el)) || tieneClase(el, 'centro'); }
  function filaDe(el) {
    var hijos = Array.prototype.filter.call(el.children, function (h) { return limpiar(h.textContent) !== '' || h.tagName === 'SPAN' || h.tagName === 'B'; });
    if (hijos.length >= 2) return { izq: hijos[0].textContent, der: hijos[hijos.length - 1].textContent };
    return { izq: el.textContent, der: '' };
  }
  var LINEAS_FIRMA = { normal: 6, amplio: 8, extra: 12 };

  function desdeContenedor(cont, opciones) {
    opciones = opciones || {};
    var els = [];
    var lineasFirma = LINEAS_FIRMA[opciones.espacioFirma] || LINEAS_FIRMA.normal;
    var primerTexto = true;
    Array.prototype.forEach.call(cont.children, function (el) {
      var tag = el.tagName;
      if (tag === 'IMG' || tag === 'SCRIPT' || tag === 'STYLE') return;
      if (tag === 'HR' || tieneClase(el, 'linea')) { els.push({ t: 'linea' }); return; }
      var txt = limpiar(el.textContent);
      if (FILAS.some(function (c) { return tieneClase(el, c); })) {
        var f = filaDe(el);
        els.push({ t: 'fila', izq: f.izq, der: f.der, negrita: esNegrita(el) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(estilo(el.children[0] || el)) });
        return;
      }
      if (/^Firma del cliente$/i.test(txt)) {
        els.push({ t: 'espacio', n: lineasFirma });
        els.push({ t: 'centro', texto: new Array(33).join('_') });
        els.push({ t: 'centro', texto: 'Firma del cliente' });
        return;
      }
      if (!txt) return;
      if (el.children.length > 1 && el.querySelector && el.querySelector('.tp-row, .fila-dato, hr')) {
        desdeContenedor(el, opciones).forEach(function (x) { els.push(x); });
        return;
      }
      if (esCentrado(el)) {
        // el primer texto centrado del ticket es el nombre del negocio: se resalta
        els.push({ t: 'centro', texto: txt, negrita: esNegrita(el), grande: primerTexto && esNegrita(el) });
        primerTexto = false;
      } else {
        els.push({ t: 'texto', texto: txt, negrita: esNegrita(el) });
      }
    });
    return els;
  }

  function imprimirDesdeContenedor(cont, opciones) {
    if (!cont) { if (typeof showToast === 'function') showToast('No hay ticket para imprimir', 'error'); return { ok: false }; }
    return imprimirElementos(desdeContenedor(cont, opciones));
  }

  window.rawbtActivo = rawbtActivo;
  window.rawbtImprimirElementos = imprimirElementos;
  window.rawbtImprimirDesdeContenedor = imprimirDesdeContenedor;
  window.rawbtArmarBytes = armarBytes;            // para pruebas
  window.rawbtDesdeContenedor = desdeContenedor;  // para pruebas
})();
