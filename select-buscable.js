/* ============================================================
   SELECT BUSCABLE (compartido)
   ------------------------------------------------------------
   Convierte una lista desplegable (<select>) larga en un buscador:
   se escribe y la lista se va filtrando (sin importar mayúsculas ni
   tildes; también busca por teléfono si la opción lo trae en
   data-buscar).

   El <select> original SIGUE existiendo (oculto) y sigue siendo el que
   guarda el valor: todo el código que ya lee o pone su valor funciona
   igual, y se dispara su evento "change" como siempre. Si el código
   vuelve a llenar las opciones o cambia el valor, el buscador se
   actualiza solo.

   Uso: N360SelectBuscable.mejorar(selectElement, { placeholder })
   ============================================================ */
(function () {
  'use strict';
  if (window.N360SelectBuscable) return;

  var MAX_VISIBLES = 60;
  var descValor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mejorar(sel, opciones) {
    if (!sel || sel.dataset.buscable === '1') return;
    sel.dataset.buscable = '1';
    opciones = opciones || {};
    // Listas de selects que ya no existen (ej. un modal que se volvió a pintar): se quitan.
    Array.prototype.forEach.call(document.querySelectorAll('.sb-lista'), function (l) { if (l._sbSel && !l._sbSel.isConnected) l.remove(); });

    var envoltura = document.createElement('div');
    envoltura.className = 'sb-envoltura';
    envoltura.style.position = 'relative';
    var input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.className = 'sb-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.placeholder = opciones.placeholder || 'Escribe para buscar…';
    // Opcionales (no cambian a quien no los pide): misma clase/estilo que el <select>, ancho completo.
    if (opciones.copiarClase && sel.className) input.className += ' ' + sel.className;
    if (opciones.anchoCompleto) { input.style.width = '100%'; input.style.boxSizing = 'border-box'; }
    var lista = document.createElement('div');
    lista.className = 'sb-lista';
    lista.setAttribute('role', 'listbox');
    lista._sbSel = sel;
    lista.style.cssText = 'display:none;position:fixed;z-index:100000;max-height:280px;overflow-y:auto;' +
      'background:var(--bg-surface,#fff);color:var(--text-primary,#111);border:1px solid var(--border,#e5e7eb);' +
      'border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:4px';

    sel.parentNode.insertBefore(envoltura, sel);
    envoltura.appendChild(input);
    envoltura.appendChild(sel);
    document.body.appendChild(lista);
    sel.style.display = 'none';
    if (sel.id) { var lab = document.querySelector('label[for="' + sel.id + '"]'); if (lab) lab.setAttribute('for', ''); }

    var items = [];      // [{value, texto, buscar}]
    var filtrados = [];
    var activo = -1;

    function leerOpciones() {
      // incluirVacio: la opción vacía (ej. "Consumidor Final", "Tarifa general") también se puede elegir de la lista.
      items = Array.prototype.filter.call(sel.options, function (o) { return o.value !== '' || opciones.incluirVacio; }).map(function (o) {
        return { value: o.value, texto: o.textContent.replace(/\s+/g, ' ').trim(), buscar: norm(o.textContent + ' ' + (o.dataset.buscar || '')) };
      });
    }
    function etiquetaActual() {
      var v = descValor.get.call(sel);
      if (!v) return '';
      var it = items.find(function (x) { return x.value === v; });
      return it ? it.texto : '';
    }
    function mostrarSeleccion() { input.value = etiquetaActual(); }

    function posicionar() {
      var r = input.getBoundingClientRect();
      lista.style.left = r.left + 'px';
      lista.style.width = r.width + 'px';
      var abajo = window.innerHeight - r.bottom, arriba = r.top;
      if (abajo < 220 && arriba > abajo) { lista.style.top = ''; lista.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
      else { lista.style.bottom = ''; lista.style.top = (r.bottom + 4) + 'px'; }
    }
    function pintar() {
      if (!filtrados.length) {
        lista.innerHTML = '<div style="padding:10px 12px;font-size:13px;color:var(--text-muted,#888)">Sin resultados</div>';
        return;
      }
      var v = descValor.get.call(sel);
      var html = filtrados.slice(0, MAX_VISIBLES).map(function (it, i) {
        var marcado = i === activo, elegido = it.value === v;
        return '<div class="sb-op" role="option" data-i="' + i + '" style="padding:8px 12px;border-radius:7px;cursor:pointer;font-size:13.5px;' +
          (marcado ? 'background:var(--accent-soft,#eef);' : '') + (elegido ? 'font-weight:700;' : '') + '">' + esc(it.texto) + '</div>';
      }).join('');
      if (filtrados.length > MAX_VISIBLES) {
        html += '<div style="padding:6px 12px;font-size:12px;color:var(--text-muted,#888)">… y ' + (filtrados.length - MAX_VISIBLES) + ' más. Sigue escribiendo para encontrarlo.</div>';
      }
      lista.innerHTML = html;
      var m = lista.querySelector('[data-i="' + activo + '"]');
      if (m) m.scrollIntoView({ block: 'nearest' });
    }
    function filtrar(texto) {
      var t = norm(texto);
      var palabras = t ? t.split(' ') : [];
      filtrados = palabras.length ? items.filter(function (it) { return palabras.every(function (p) { return it.buscar.indexOf(p) >= 0; }); }) : items.slice();
      activo = filtrados.length ? 0 : -1;
      pintar();
    }
    function abrir() {
      if (lista.style.display === 'block') return;
      leerOpciones();
      // Al abrir con un cliente ya elegido, se muestra la lista completa (no solo ese).
      filtrar(input.value === etiquetaActual() ? '' : input.value);
      posicionar();
      lista.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');
    }
    function cerrar() {
      lista.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
    }
    function elegir(it) {
      var antes = descValor.get.call(sel);
      descValor.set.call(sel, it ? it.value : '');
      mostrarSeleccion();
      cerrar();
      if (descValor.get.call(sel) !== antes) sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.addEventListener('focus', function () { input.select(); abrir(); });
    input.addEventListener('click', abrir);
    input.addEventListener('input', function () { if (lista.style.display !== 'block') abrir(); filtrar(input.value); posicionar(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (lista.style.display !== 'block') { abrir(); return; }
        var n = Math.min(filtrados.length, MAX_VISIBLES);
        if (!n) return;
        activo = e.key === 'ArrowDown' ? (activo + 1) % n : (activo - 1 + n) % n;
        pintar();
      } else if (e.key === 'Enter') {
        if (lista.style.display === 'block') {
          e.preventDefault();
          if (activo >= 0 && filtrados[activo]) elegir(filtrados[activo]);
        }
      } else if (e.key === 'Escape') {
        if (lista.style.display === 'block') { e.preventDefault(); e.stopPropagation(); mostrarSeleccion(); cerrar(); }
      } else if (e.key === 'Tab') {
        if (lista.style.display === 'block') { mostrarSeleccion(); cerrar(); }
      }
    });
    // mousedown (no click) para elegir antes de que el campo pierda el foco
    lista.addEventListener('mousedown', function (e) {
      var op = e.target.closest('.sb-op');
      e.preventDefault();
      if (op) elegir(filtrados[Number(op.getAttribute('data-i'))]);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        if (document.activeElement === input) return;
        // Si borró todo el texto, se quita la selección; si escribió algo sin elegir, se vuelve a lo elegido.
        if (!input.value.trim() && descValor.get.call(sel)) elegir(null);
        else mostrarSeleccion();
        cerrar();
      }, 120);
    });
    window.addEventListener('resize', function () { if (lista.style.display === 'block') posicionar(); });
    document.addEventListener('scroll', function () { if (lista.style.display === 'block') posicionar(); }, true);

    // Si el código cambia el valor del <select> (ej. al abrir un crédito ya hecho), el buscador lo refleja.
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get: function () { return descValor.get.call(sel); },
      set: function (v) { descValor.set.call(sel, v); leerOpciones(); mostrarSeleccion(); },
    });
    sel.addEventListener('change', function () { mostrarSeleccion(); });
    // Si el código vuelve a llenar las opciones, también.
    new MutationObserver(function () { leerOpciones(); mostrarSeleccion(); if (lista.style.display === 'block') filtrar(input.value); })
      .observe(sel, { childList: true, subtree: true });

    leerOpciones();
    mostrarSeleccion();
  }

  window.N360SelectBuscable = { mejorar: mejorar, _norm: norm };
})();
