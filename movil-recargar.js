/* ============================================================
   MOVIL-RECARGAR.JS — NEGOCIO360
   En celulares se desactivó "jalar hacia abajo para recargar"
   (ver movil-sin-zoom.css), porque al subir la página se recargaba
   sin querer. Este botón ↻ del encabezado es la forma de actualizar
   la página cuando la persona SÍ lo quiere.
   Solo aparece en pantallas táctiles: en computadora no existe.
   No toca datos ni lógica de ningún módulo.
   ============================================================ */
(function () {
  'use strict';
  if (window.__n360BtnRecargar) return;
  window.__n360BtnRecargar = true;

  const TACTIL = '(hover: none) and (pointer: coarse)';

  function estilos() {
    if (document.getElementById('n360-recargar-css')) return;
    const st = document.createElement('style');
    st.id = 'n360-recargar-css';
    st.textContent = `
      .n360-btn-recargar { display: none; }
      @media ${TACTIL} {
        .n360-btn-recargar {
          display: inline-flex; align-items: center; justify-content: center;
          flex: 0 0 auto; width: 36px; height: 36px; margin: 0 4px; padding: 0;
          border: 1px solid var(--border, rgba(127,127,127,.25)); border-radius: 10px;
          background: transparent; color: var(--text-secondary, currentColor);
          cursor: pointer; -webkit-tap-highlight-color: transparent;
          transition: background .15s ease, transform .1s ease;
        }
        .n360-btn-recargar:active { transform: scale(.92); background: var(--bg-hover, rgba(127,127,127,.12)); }
        .n360-btn-recargar svg { width: 17px; height: 17px; display: block; }
        .n360-btn-recargar.girando svg { animation: n360-girar .7s linear infinite; }
        /* Encabezados muy llenos: versión compacta para no partirlos en dos líneas */
        .n360-btn-recargar.compacto { width: 30px; height: 30px; margin: 0; border-radius: 8px; }
        .n360-btn-recargar.compacto svg { width: 15px; height: 15px; }
        .n360-btn-recargar.sin-espacio { display: none; }
      }
      /* Dashboard en celulares angostos (360 px): el selector de fecha cede
         un poco de espacio (ya corta su texto con "…") para que quepa el ↻. */
      @media ${TACTIL} and (max-width: 370px) {
        #header:has(.n360-btn-recargar) .date-selector { max-width: 104px; }
      }
      @keyframes n360-girar { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(st);
  }

  function crearBoton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'n360-btn-recargar';
    b.title = 'Actualizar página';
    b.setAttribute('aria-label', 'Actualizar página');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
    b.addEventListener('click', () => {
      if (b.classList.contains('girando')) return;
      b.classList.add('girando');
      setTimeout(() => window.location.reload(), 120);
    });
    return b;
  }

  function insertar() {
    if (document.querySelector('.n360-btn-recargar')) return;
    const header = document.getElementById('header') || document.querySelector('header.header, .main-content > header, main > header');
    if (!header) return;
    // Junto al botón del menú (☰): siempre visible en celular y no
    // depende del resto del encabezado de cada módulo. Las pantallas sin
    // menú (asistente de bienvenida) se quedan como están.
    const menu = header.querySelector('.header-toggle, .header-menu-btn, .menu-toggle');
    if (!menu || !menu.parentNode) return;
    estilos();
    const btn = crearBoton();
    menu.parentNode.insertBefore(btn, menu.nextSibling);
    ajustar(btn, header);
    // El encabezado de algunos módulos se llena después (fecha, plan,
    // interruptores): se vuelve a revisar al terminar de cargar y al girar.
    window.addEventListener('load', () => { ajustar(btn, header); setTimeout(() => ajustar(btn, header), 2000); });
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => ajustar(btn, header), 200); });
  }

  // Nunca debe partir el encabezado en dos líneas ni sacarlo de la
  // pantalla: si no cabe, se usa la versión compacta; si ni así cabe, se
  // oculta (el encabezado queda exactamente como estaba).
  function ajustar(btn, header) {
    if (!window.matchMedia(TACTIL).matches) return;
    btn.classList.remove('compacto', 'sin-espacio');
    const medir = () => ({ h: header.getBoundingClientRect().height, w: header.scrollWidth });
    btn.style.display = 'none';
    const base = medir();
    btn.style.display = '';
    if (!base.h) return; // encabezado oculto en este momento
    const cabe = () => { const m = medir(); return m.h <= base.h + 1 && m.w <= base.w + 1; };
    if (cabe()) return;
    btn.classList.add('compacto');
    if (cabe()) return;
    btn.classList.remove('compacto');
    btn.classList.add('sin-espacio');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', insertar);
  else insertar();
})();
