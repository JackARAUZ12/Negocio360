/* =====================================================
   CONTRASTE-ACENTO.JS — Negocio360
   Si el color principal que eligió el negocio es casi igual al fondo (por ejemplo
   blanco sobre fondo blanco), el módulo activo del menú lateral "desaparece".
   Este archivo detecta ese caso y SOLO ENTONCES muestra el módulo activo con un
   tono legible y una barra lateral. También pone texto oscuro en los botones
   principales si el color es muy claro. Con cualquier otro color no hace nada:
   no cambia ningún color elegido ni ningún dato.
===================================================== */
(function () {
  'use strict';
  if (window.__n360ContrasteAcento) return;
  window.__n360ContrasteAcento = true;
  var UMBRAL = 1.35;      // por debajo de esta razón de contraste el color es prácticamente invisible
  var ID = 'n360-contraste-acento';

  function parse(c) {
    c = String(c || '').trim();
    var m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1];
    if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
    if ((m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/i.exec(c))) { var a = m[4] === undefined ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return [+m[1], +m[2], +m[3], a]; }
    return null;
  }
  function lum(rgb) { var v = rgb.slice(0, 3).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  function ratio(a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  function fondo() {
    var els = [document.querySelector('.sidebar'), document.body, document.documentElement];
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      var c = parse(getComputedStyle(els[i]).backgroundColor);
      if (c && c[3] > 0.5) return c;
    }
    return document.documentElement.getAttribute('data-theme') === 'dark' ? [19, 19, 31, 1] : [255, 255, 255, 1];
  }

  function aplicar() {
    try {
      var acento = parse(getComputedStyle(document.documentElement).getPropertyValue('--accent'));
      var st = document.getElementById(ID);
      if (!acento) { if (st) st.remove(); return; }
      var bg = fondo(), claroBg = lum(bg) > 0.4;
      var css = '';
      if (ratio(acento, bg) < UMBRAL) {
        var fg = claroBg ? '#1e293b' : '#f8fafc', fondoAct = claroBg ? 'rgba(15,23,42,.09)' : 'rgba(255,255,255,.14)';
        css += 'html .nav-item.active{color:' + fg + ' !important;background:' + fondoAct + ' !important;box-shadow:inset 3px 0 0 ' + fg + ' !important}';
      }
      if (ratio(acento, [255, 255, 255, 1]) < UMBRAL) {   // botón principal: texto blanco sobre color casi blanco
        css += 'html .btn-primary,html .btn-primary:hover{color:#1e293b !important}';
      }
      if (!css) { if (st) st.remove(); return; }
      if (!st) { st = document.createElement('style'); st.id = ID; document.head.appendChild(st); }
      if (st.textContent !== css) st.textContent = css;
    } catch (e) { /* nunca debe afectar la página */ }
  }

  var t = null;
  function pronto() { clearTimeout(t); t = setTimeout(function () { aplicar(); setTimeout(aplicar, 600); }, 120); }  // 2da pasada: el fondo cambia con una transición al cambiar de tema
  function iniciar() {
    aplicar(); setTimeout(aplicar, 800); setTimeout(aplicar, 2500);
    try { new MutationObserver(pronto).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] }); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
