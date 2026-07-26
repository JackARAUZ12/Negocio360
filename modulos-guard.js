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
      }
    });

    // Igual que perfiles-guard.js: oculta/muestra títulos de sección según
    // si les queda algún item visible (recalcula sobre el DOM actual, así
    // que da igual si perfiles-guard.js corrió antes o después).
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
