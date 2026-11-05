/* restaurante-modo.js — Modo HELADERÍA para las pantallas del Restaurante (05-nov-2026)
   Si el negocio tiene encendido "usa_modulo_heladeria", se usan los mismos módulos del Restaurante
   (mesas, comandas, cobro: nada cambia por dentro) pero con nombres de heladería:
   Cocina → Barra, Restaurante → Heladería, platillo → producto, 🍳 → 🍨.
   Solo cambia lo que se VE en pantalla; los datos y el funcionamiento quedan igual. */
(function () {
  const CAMBIOS = [
    [/Restaurante/g, 'Heladería'], [/RESTAURANTE/g, 'HELADERÍA'],
    [/Cocina/g, 'Barra'], [/cocina/g, 'barra'], [/COCINA/g, 'BARRA'],
    [/Platillos/g, 'Productos'], [/platillos/g, 'productos'], [/Platillo/g, 'Producto'], [/platillo/g, 'producto'],
    [/🍳/g, '🍨'], [/🧑‍🍳/g, '🍨'],
  ];
  let activo = false;
  function cambiarTexto(t) { let s = t; CAMBIOS.forEach(([re, v]) => { s = s.replace(re, v); }); return s; }
  function recorrer(nodo) {
    if (!activo || !nodo) return;
    if (nodo.nodeType === 3) { const v = cambiarTexto(nodo.nodeValue); if (v !== nodo.nodeValue) nodo.nodeValue = v; return; }
    if (nodo.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT)$/.test(nodo.nodeName)) {
      if (nodo.nodeName === 'INPUT' && nodo.placeholder) nodo.placeholder = cambiarTexto(nodo.placeholder);
      return;
    }
    ['placeholder', 'title', 'data-tooltip', 'aria-label'].forEach(a => { const v = nodo.getAttribute && nodo.getAttribute(a); if (v) { const n = cambiarTexto(v); if (n !== v) nodo.setAttribute(a, n); } });
    nodo.childNodes.forEach(recorrer);
  }
  function encender() {
    if (activo) return;
    activo = true;
    document.title = cambiarTexto(document.title);
    recorrer(document.body);
    new MutationObserver(ms => ms.forEach(m => {
      if (m.type === 'characterData') recorrer(m.target);
      m.addedNodes && m.addedNodes.forEach(recorrer);
    })).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  window.N360ModoHeladeria = { activo: () => activo, texto: cambiarTexto };
  async function revisar() {
    try {
      const c = (typeof sb !== 'undefined' && sb) || null; if (!c) return;
      const { data: { user } } = await c.auth.getUser(); if (!user) return;
      const k = 'n360_heladeria_' + user.id;
      try { if (sessionStorage.getItem(k) === '1') encender(); } catch (_) {}
      const { data } = await c.from('configuracion_empresa').select('usa_modulo_heladeria').eq('auth_user_id', user.id).maybeSingle();
      const si = data && data.usa_modulo_heladeria === true;
      try { sessionStorage.setItem(k, si ? '1' : '0'); } catch (_) {}
      if (si) encender();
    } catch (_) { /* si falla, la pantalla queda como Restaurante: nada se rompe */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revisar); else revisar();
})();
