/* ============================================================
   MODULOS-GUARD.JS — NEGOCIO360
   ------------------------------------------------------------
   Sistema de módulos OPCIONALES que el dueño del negocio puede
   activar/desactivar desde Configuración → "Editar módulos".

   Se incluye con una sola línea en cada página:
     <script src="modulos-guard.js"></script>

   Qué hace:
   1) Oculta del sidebar los módulos opcionales desactivados
      (cubre los dos patrones de sidebar del proyecto: divs
      "nav-item" con onclick="navigate(...)" y enlaces <a
      class="sidebar-item" href="...">).
   2) Si alguien entra por URL directa a un módulo opcional que
      está desactivado, lo redirige al dashboard.

   Los módulos OBLIGATORIOS (Dashboard, Ventas, Clientes,
   Productos/Servicios, Compras, Gastos, Caja/Pagos, Reportes,
   Chat con Negocio360, Configuración) NUNCA aparecen aquí: este
   script no sabe nada de ellos y jamás los toca.

   Cómo agregar un módulo opcional nuevo en el futuro:
   agregar UNA línea al objeto MODULOS_OPCIONALES de abajo. Ni el
   sidebar de cada página ni Configuración necesitan tocarse: el
   interruptor en Configuración → "Editar módulos" se genera solo
   a partir de este mismo objeto (ver configuracion.html).

   No depende de perfiles-guard.js ni de ningún módulo propio
   (creditos.js, reportes.js, etc.) — corre de forma
   independiente, con su propia conexión a Supabase, igual que
   perfiles-guard.js. No reemplaza ni modifica nada existente.
   ============================================================ */
'use strict';

(function () {

  const MG_SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const MG_SUPABASE_KEY  = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

  // ---- ÚNICA fuente de verdad de los módulos OPCIONALES ----
  const MODULOS_OPCIONALES = {
    creditos:       { key: 'creditos',       archivo: 'creditos.html',       label: 'Créditos',       icon: '🧾',
                      desc: 'Ventas y préstamos a crédito, cuotas y cobros.' },
    estadisticas:   { key: 'estadisticas',   archivo: 'estadisticas.html',   label: 'Estadísticas',   icon: '📈',
                      desc: 'Gráficas y tendencias adicionales del negocio.' },
    notificaciones: { key: 'notificaciones', archivo: 'notificaciones.html', label: 'Notificaciones', icon: '🔔',
                      desc: 'Centro de avisos y alertas del sistema.' },
    impuestos:      { key: 'impuestos',      archivo: 'impuestos.html',      label: 'Impuestos',      icon: '🧮',
                      desc: 'Catálogo de impuestos aplicados a ventas y créditos.' },
  };
  const MODULOS_POR_ARCHIVO = {};
  Object.values(MODULOS_OPCIONALES).forEach(m => { MODULOS_POR_ARCHIVO[m.archivo] = m; });

  function currentFile() {
    const f = location.pathname.split('/').pop() || 'dashboard.html';
    return f.includes('.') ? f : 'dashboard.html';
  }

  // Trae metadata.modulosOpcionales de configuracion_empresa. Si el dueño
  // nunca ha tocado nada, se devuelve {} y TODOS los módulos opcionales
  // quedan activos por defecto (comportamiento idéntico al de siempre).
  async function cargarConfigModulos(client, authUserId) {
    try {
      const { data } = await client.from('configuracion_empresa')
        .select('metadata').eq('auth_user_id', authUserId).maybeSingle();
      return (data?.metadata && typeof data.metadata === 'object' && data.metadata.modulosOpcionales) || {};
    } catch (e) {
      console.warn('modulos-guard cargarConfigModulos:', e);
      return {};
    }
  }

  function estaActivo(cfg, key) { return cfg[key] !== false; }

  // Oculta del sidebar los módulos opcionales desactivados. Mismo patrón de
  // detección que perfiles-guard.js, para cubrir ambos estilos de sidebar
  // usados en el proyecto.
  function ocultarEnSidebar(cfg) {
    const nodos = document.querySelectorAll('[onclick*="navigate("], a[href$=".html"], a[href*=".html?"]');
    nodos.forEach(el => {
      let href = el.getAttribute('href');
      if (!href) {
        const m = (el.getAttribute('onclick') || '').match(/navigate\(['"]([^'"?]+)/);
        href = m ? m[1] : null;
      }
      if (!href) return;
      const file = href.split('?')[0].split('/').pop();
      const mod = MODULOS_POR_ARCHIVO[file];
      if (!mod) return; // módulos obligatorios y otras páginas: intactos
      if (!estaActivo(cfg, mod.key)) {
        const item = el.closest('.nav-item') || el;
        item.style.display = 'none';
        item.classList.add('mg-oculto-modulo'); // el buscador del sidebar nunca lo vuelve a mostrar
      }
    });

    recalcularTitulosSidebar();
  }

  // Oculta/muestra títulos de sección de sidebar según si les queda algún
  // item visible. Se usa tanto al desactivar módulos como al buscar, para
  // que ambos comportamientos queden siempre consistentes entre sí.
  function recalcularTitulosSidebar() {
    document.querySelectorAll('.nav-section-title, .sidebar-section-label').forEach(title => {
      let n = title.nextElementSibling;
      let algunoVisible = false;
      while (n && !n.classList.contains('nav-section-title') && !n.classList.contains('sidebar-section-label')) {
        if (n.style.display !== 'none') algunoVisible = true;
        n = n.nextElementSibling;
      }
      title.style.display = algunoVisible ? '' : 'none';
    });
  }

  /* ============================================================
     BUSCADOR DE MÓDULOS EN EL SIDEBAR
     Cada vez hay más módulos (obligatorios + opcionales), así que
     se agrega un campo de búsqueda arriba del menú para filtrar por
     nombre en vez de tener que desplazarse por toda la lista. No
     toca nunca los items ya ocultos por un módulo desactivado.
     ============================================================ */
  function inyectarBuscadorSidebar() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav || !nav.parentElement || document.getElementById('mg-sidebar-search')) return;

    // Estilos del buscador (inyectados una sola vez; así no hace falta
    // tocar el <style> de cada una de las páginas del sistema).
    if (!document.getElementById('mg-sidebar-search-style')) {
      const style = document.createElement('style');
      style.id = 'mg-sidebar-search-style';
      style.textContent = `
        .mg-sidebar-search-wrap{padding:0 16px 10px}
        .mg-sidebar-search-wrap input{width:100%;padding:8px 10px;font-size:12.5px;
          border:1px solid var(--border,#e8e8ef);border-radius:8px;background:var(--bg-surface,#fff);
          color:var(--text-primary,#0d0d14);outline:none;transition:border-color .15s}
        .mg-sidebar-search-wrap input:focus{border-color:var(--border-focus,var(--accent,#5a5af4))}
        #sidebar.collapsed .mg-sidebar-search-wrap{display:none}
        .sidebar-nav{max-height:calc(100vh - 160px);overflow-y:auto}
      `;
      document.head.appendChild(style);
    }

    const wrap = document.createElement('div');
    wrap.className = 'mg-sidebar-search-wrap';
    wrap.innerHTML = `<input type="text" id="mg-sidebar-search" placeholder="🔎 Buscar módulo…" autocomplete="off" />`;
    nav.parentElement.insertBefore(wrap, nav);
    wrap.querySelector('#mg-sidebar-search').addEventListener('input', e => filtrarSidebarPorTexto(e.target.value));
  }

  function filtrarSidebarPorTexto(q) {
    const query = (q || '').trim().toLowerCase();
    const items = document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-nav .sidebar-item');
    items.forEach(el => {
      if (el.classList.contains('mg-oculto-modulo')) return; // módulo desactivado: nunca se muestra
      const label = (el.querySelector('.nav-label, .sidebar-label')?.textContent || el.textContent || '').trim().toLowerCase();
      el.style.display = (!query || label.includes(query)) ? '' : 'none';
    });
    recalcularTitulosSidebar();
  }

  // Si la página actual ES un módulo opcional desactivado, no se deja
  // entrar por URL directa (favoritos guardados, enlaces viejos, etc.).
  function protegerPaginaActual(cfg) {
    const mod = MODULOS_POR_ARCHIVO[currentFile()];
    if (mod && !estaActivo(cfg, mod.key)) {
      location.href = 'dashboard.html';
      return true;
    }
    return false;
  }

  async function init() {
    if (!window.supabase) return; // la página no cargó el SDK de Supabase
    const client = window.supabase.createClient(MG_SUPABASE_URL, MG_SUPABASE_KEY);
    const { data: { session } } = await client.auth.getSession();
    if (!session) return; // el checkAuth propio de cada página se encarga del login

    const cfg = await cargarConfigModulos(client, session.user.id);
    if (protegerPaginaActual(cfg)) return;
    ocultarEnSidebar(cfg);
    inyectarBuscadorSidebar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // API pública de solo lectura: la usa configuracion.html para pintar los
  // interruptores de "Editar módulos" sin tener que repetir la lista.
  window.ModulosGuard = {
    MODULOS_OPCIONALES,
    cargarConfigModulos,
    estaActivo,
    ocultarEnSidebar,
  };

})();
