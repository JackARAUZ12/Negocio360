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

  // ÚNICA fuente de verdad: modulos-registro.js (se carga antes que este
  // archivo). Cualquier módulo marcado obligatorio:false aparece aquí
  // solo con agregarlo allá — nada que tocar en este archivo nunca más.
  //
  // flagPropio (opcional, en el registro): para módulos secundarios que
  // YA tienen su propio interruptor dedicado en Configuración (como
  // "Módulo de Hotel" o "Módulo de Restaurante", apagados por defecto
  // para toda cuenta nueva) -- estos NUNCA se muestran en el listado
  // generico "Editar módulos" (serían un segundo control redundante
  // para lo mismo), pero SÍ quedan protegidos igual contra acceso
  // directo por URL, y SÍ los reconoce perfiles-guard.js para poder
  // asignarlos/quitarlos por perfil una vez que la cuenta ya activó su
  // interruptor propio.
  const TODOS_MODULOS_OPCIONALES = {};
  Object.entries(window.NEGOCIO360_MODULOS || {}).forEach(([archivo, m]) => {
    if (!m.obligatorio) {
      TODOS_MODULOS_OPCIONALES[m.key] = { key: m.key, archivo, label: m.label, icon: m.icon, desc: m.desc || '', flagPropio: m.flagPropio || null,
        flagsAlternos: m.flagsAlternos || [], etiquetasPorFlag: m.etiquetasPorFlag || null };
    }
  });
  const MODULOS_OPCIONALES = {};
  Object.entries(TODOS_MODULOS_OPCIONALES).forEach(([key, m]) => {
    if (!m.flagPropio) MODULOS_OPCIONALES[key] = m;
  });
  const MODULOS_POR_ARCHIVO = {};
  Object.values(TODOS_MODULOS_OPCIONALES).forEach(m => { MODULOS_POR_ARCHIVO[m.archivo] = m; });

  function currentFile() {
    const f = location.pathname.split('/').pop() || 'dashboard.html';
    return f.includes('.') ? f : 'dashboard.html';
  }

  // Trae metadata.modulosOpcionales de configuracion_empresa. Si el dueño
  // nunca ha tocado nada, se devuelve {} y TODOS los módulos opcionales
  // quedan activos por defecto (comportamiento idéntico al de siempre).
  //
  // Ademas trae los flags propios de los modulos secundarios (Hotel,
  // Restaurante, Mis Negocios...) en _flagsPropios -- estos SIEMPRE
  // empiezan en false para cualquier cuenta, y solo el interruptor
  // dedicado de cada uno (no este sistema generico) los enciende.
  async function cargarConfigModulos(client, authUserId) {
    try {
      const { data } = await client.from('configuracion_empresa')
        .select('metadata, usa_modulo_hotel, usa_modulo_restaurante, usa_negocios_vinculados, usa_modulo_farmacia, usa_farmacia_fase2, usa_puntos, usa_modulo_veterinaria')
        .eq('auth_user_id', authUserId).maybeSingle();
      const cfg = (data?.metadata && typeof data.metadata === 'object' && data.metadata.modulosOpcionales) || {};
      cfg._flagsPropios = {
        usa_modulo_hotel: data?.usa_modulo_hotel === true,
        usa_modulo_restaurante: data?.usa_modulo_restaurante === true,
        usa_negocios_vinculados: data?.usa_negocios_vinculados === true,
        usa_modulo_farmacia: data?.usa_modulo_farmacia === true,
        usa_farmacia_fase2: data?.usa_farmacia_fase2 === true,
        usa_puntos: data?.usa_puntos === true,
        usa_modulo_veterinaria: data?.usa_modulo_veterinaria === true,
      };
      return cfg;
    } catch (e) {
      console.warn('modulos-guard cargarConfigModulos:', e);
      return { _flagsPropios: {} };
    }
  }

  function estaActivo(cfg, key, flagPropio, flagsAlternos) {
    // Modulo secundario con su propio interruptor dedicado (Hotel,
    // Restaurante, Mis Negocios...): sin ese interruptor encendido,
    // SIEMPRE se considera inactivo, sin importar nada mas -- asi
    // ninguna cuenta nueva lo ve jamas hasta que lo active a proposito.
    const flagsPosibles = [flagPropio, ...(flagsAlternos || [])].filter(Boolean);
    if (flagsPosibles.length && !flagsPosibles.some(f => cfg._flagsPropios && cfg._flagsPropios[f] === true)) return false;
    if (cfg[key] === false) return false;
    // Restricción de Sucursales: si el perfil entró con una lista de
    // módulos permitidos para ESTA sucursal específica, se respeta
    // además de la config normal de módulos opcionales.
    const restriccion = obtenerRestriccionSucursal();
    if (restriccion && !restriccion.includes(key)) return false;
    return true;
  }

  function obtenerRestriccionSucursal() {
    try {
      const raw = sessionStorage.getItem('n360_sucursal_modulos');
      if (!raw) return null;
      const lista = JSON.parse(raw);
      if (!Array.isArray(lista)) return null;

      // Solo aplica si en este momento hay de verdad un perfil restringido
      // activo (no el admin) — si no, es un rastro viejo de otra visita a
      // una sucursal y NUNCA debe seguir bloqueando nada.
      const perfilRaw = sessionStorage.getItem('n360_perfil_activo');
      if (!perfilRaw) { sessionStorage.removeItem('n360_sucursal_modulos'); return null; }
      const perfil = JSON.parse(perfilRaw);
      if (!perfil || perfil.tipo === 'admin') { sessionStorage.removeItem('n360_sucursal_modulos'); return null; }

      return lista;
    } catch (_) { return null; }
  }

  // Oculta del sidebar los módulos opcionales desactivados. Mismo patrón de
  // detección que perfiles-guard.js, para cubrir ambos estilos de sidebar
  // usados en el proyecto.
  function ocultarEnSidebar(cfg) {
    const restriccionSuc = obtenerRestriccionSucursal();
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
      if (!mod) {
        // Modulo obligatorio (o pagina fuera del registro): sigue sin
        // tocarse por el sistema normal de modulos opcionales, pero SI
        // se oculta cuando la sucursal/bodega actual lo tiene
        // restringido -- mismo motivo que protegerPaginaActual().
        const info = (window.NEGOCIO360_MODULOS || {})[file];
        if (info && info.key !== 'dashboard' && restriccionSuc && !restriccionSuc.includes(info.key)) {
          const item = el.closest('.nav-item') || el;
          item.style.display = 'none';
          item.classList.add('mg-oculto-modulo');
        }
        return;
      }
      if (!estaActivo(cfg, mod.key, mod.flagPropio, mod.flagsAlternos)) {
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
          color:var(--text-primary,#0d0d14);outline:none;transition:border-color .15s;
          -webkit-appearance:none;appearance:none}
        .mg-sidebar-search-wrap input::-webkit-search-cancel-button,
        .mg-sidebar-search-wrap input::-webkit-search-decoration{-webkit-appearance:none;appearance:none}
        .mg-sidebar-search-wrap input:focus{border-color:var(--border-focus,var(--accent,#5a5af4))}
        #sidebar.collapsed .mg-sidebar-search-wrap{display:none}
        .sidebar-nav{max-height:calc(100vh - 160px);overflow-y:auto}
      `;
      document.head.appendChild(style);
    }

    const wrap = document.createElement('div');
    wrap.className = 'mg-sidebar-search-wrap';
    wrap.innerHTML = `<input type="search" id="mg-sidebar-search" placeholder="🔎 Buscar módulo…"
      autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
      data-lpignore="true" data-1p-ignore="true" data-form-type="other" name="mg-buscador-no-autofill" />`;
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
    if (mod && !estaActivo(cfg, mod.key, mod.flagPropio, mod.flagsAlternos)) {
      location.href = 'dashboard.html';
      return true;
    }

    // La restriccion de sucursal/bodega (que modulos puede ver ESE
    // perfil en ESA sucursal especifica) debe aplicar a CUALQUIER
    // modulo, incluidos los obligatorios (Ventas, Caja, Clientes,
    // Compras, Gastos, Reportes...). Antes, arriba de esto SOLO se
    // revisaban los modulos opcionales (los unicos indexados en
    // MODULOS_POR_ARCHIVO) -- un modulo obligatorio jamas se
    // bloqueaba aqui, asi que desmarcarlo para un empleado de bodega
    // (o de cualquier sucursal) nunca tenia efecto real: siempre
    // podia entrar de todos modos. "dashboard" queda afuera a
    // proposito -- es el destino al que se redirige cuando algo se
    // bloquea, bloquearlo tambien causaria un loop de redireccion.
    const infoCompleta = (window.NEGOCIO360_MODULOS || {})[currentFile()];
    if (infoCompleta && infoCompleta.key !== 'dashboard') {
      const restriccion = obtenerRestriccionSucursal();
      if (restriccion && !restriccion.includes(infoCompleta.key)) {
        location.href = 'dashboard.html';
        return true;
      }
    }
    return false;
  }

  // Inyecta en el sidebar de CUALQUIER pagina del sistema (donde este
  // script ya esta cargado) los enlaces a los modulos secundarios que
  // la cuenta SI tiene activos (Hotel, Restaurante, Mis Negocios...) --
  // agrupados en su propia seccion, al final del menu. Si esa cuenta
  // nunca activo ninguno, esta funcion no agrega absolutamente nada:
  // el sidebar de las 62 cuentas actuales queda exactamente igual que
  // siempre. Tampoco duplica un enlace si la pagina actual YA tiene uno
  // real hacia ese mismo archivo (por ejemplo, si en el futuro se
  // agrega navegacion cruzada manual dentro de las propias paginas de
  // Hotel entre si).
  function inyectarModulosSecundariosEnSidebar(cfg) {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return; // esta pagina no usa el sidebar estandar -- no se toca nada

    // El sistema tiene 2 plantillas de sidebar distintas en uso real:
    // "nav-item" (div + onclick="navigate(...)" + span.nav-label, usada
    // por Dashboard, Hotel, Restaurante...) y "sidebar-item" (a href=...
    // + span.sidebar-icon + texto suelto, usada por Productos y otras
    // paginas "core"). Se detecta cual usa la pagina actual mirando el
    // primer item real del propio sidebar, para generar el HTML con la
    // estructura y clases correctas en ambos casos.
    const usaPatronSidebarItem = !!nav.querySelector('.sidebar-item') && !nav.querySelector('.nav-item');

    const porFlag = {};
    Object.values(TODOS_MODULOS_OPCIONALES).forEach(m => {
      if (!m.flagPropio) return;
      const flagActivo = [m.flagPropio, ...(m.flagsAlternos || [])].find(f => cfg._flagsPropios && cfg._flagsPropios[f] === true);
      if (!flagActivo) return;
      const yaExiste = document.querySelector(`[onclick*="navigate('${m.archivo}')"], a[href="${m.archivo}"]`);
      if (yaExiste) return;
      // Un modulo compartido (p. ej. Lotes: Farmacia y Veterinaria) se muestra UNA sola vez, bajo el
      // primer flag activo y con la etiqueta de ese flag.
      const etiqueta = (m.etiquetasPorFlag && m.etiquetasPorFlag[flagActivo]) || m.label;
      (porFlag[flagActivo] = porFlag[flagActivo] || []).push({ ...m, label: etiqueta, compartido: flagActivo !== m.flagPropio });
    });
    // Dentro de cada seccion, lo propio primero y lo compartido al final.
    Object.values(porFlag).forEach(lista => lista.sort((a, b) => (a.compartido ? 1 : 0) - (b.compartido ? 1 : 0)));

    Object.values(porFlag).forEach(mods => {
      if (!mods.length) return;
      const nombreSeccion = mods[0].label.includes(' · ') ? mods[0].label.split(' · ')[0] : 'Más';

      if (usaPatronSidebarItem) {
        const titulo = document.createElement('div');
        titulo.className = 'sidebar-section-label';
        titulo.textContent = nombreSeccion;
        nav.appendChild(titulo);

        mods.forEach(m => {
          const nombreCorto = m.label.includes(' · ') ? m.label.split(' · ')[1] : m.label;
          const a = document.createElement('a');
          a.href = m.archivo;
          a.className = 'sidebar-item';
          const icono = document.createElement('span');
          icono.className = 'sidebar-icon';
          icono.textContent = m.icon;
          a.appendChild(icono);
          a.appendChild(document.createTextNode(nombreCorto));
          nav.appendChild(a);
        });
        return;
      }

      const titulo = document.createElement('div');
      titulo.className = 'nav-section-title';
      titulo.textContent = nombreSeccion.toUpperCase();
      nav.appendChild(titulo);

      mods.forEach(m => {
        const nombreCorto = m.label.includes(' · ') ? m.label.split(' · ')[1] : m.label;
        const item = document.createElement('div');
        item.className = 'nav-item';
        item.setAttribute('onclick', `navigate('${m.archivo}')`);
        item.setAttribute('data-tooltip', nombreCorto);
        const icono = document.createElement('span');
        icono.style.cssText = 'font-size:16px;width:18px;flex-shrink:0;text-align:center;display:inline-block';
        icono.textContent = m.icon;
        const label = document.createElement('span');
        label.className = 'nav-label';
        label.textContent = nombreCorto;
        item.appendChild(icono);
        item.appendChild(label);
        nav.appendChild(item);
      });
    });
  }

  // El Chat con Negocio360 es OBLIGATORIO (por ahi se envian los comprobantes a los
  // clientes) y debe verse en TODAS las paginas. Su enlace esta escrito a mano en el
  // menu de cada pagina y algunas (Ventas, Productos, Caja, Clientes, Compras, Gastos,
  // Reportes, Creditos...) nunca lo tuvieron. Aqui se agrega SOLO si falta, con el mismo
  // estilo de menu que use la pagina; si ya existe, no se toca nada.
  function asegurarChatEnSidebar() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    if (document.querySelector('[onclick*="navigate(\'chat.html\')"], a[href="chat.html"], [data-mg-chat]')) return;
    const usaSidebarItem = !!nav.querySelector('.sidebar-item') && !nav.querySelector('.nav-item');
    const referencia = nav.querySelector('[onclick*="navigate(\'notificaciones.html\')"], a[href="notificaciones.html"]');
    let item;
    if (usaSidebarItem) {
      item = document.createElement('a');
      item.href = 'chat.html';
      item.className = 'sidebar-item';
      const icono = document.createElement('span');
      icono.className = 'sidebar-icon';
      icono.textContent = '💬';
      item.appendChild(icono);
      item.appendChild(document.createTextNode('Chat con Negocio360'));
    } else {
      item = document.createElement('div');
      item.className = 'nav-item';
      item.setAttribute('onclick', "navigate('chat.html')");
      item.setAttribute('data-tooltip', 'Chat con Negocio360');
      const icono = document.createElement('span');
      icono.style.cssText = 'font-size:16px;width:18px;flex-shrink:0;text-align:center;display:inline-block';
      icono.textContent = '💬';
      const label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = 'Chat con Negocio360';
      item.appendChild(icono);
      item.appendChild(label);
    }
    item.setAttribute('data-mg-chat', '1');
    if (referencia && referencia.parentElement === nav) referencia.insertAdjacentElement('afterend', item);
    else if (referencia && referencia.closest('.nav-item, .sidebar-item')) referencia.closest('.nav-item, .sidebar-item').insertAdjacentElement('afterend', item);
    else nav.appendChild(item);
  }

  // "Tutoriales": igual que el Chat, el enlace se agrega solo a la lista de
  // modulos de CUALQUIER pagina que tenga sidebar, sin tocar cada HTML.
  // Va justo despues del Chat (o de Notificaciones, o al final). No esta en
  // el registro de modulos a proposito: es una ayuda para todos, no un
  // modulo que se active/desactive ni se asigne por perfil.
  function asegurarTutorialesEnSidebar() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    if (document.querySelector('[onclick*="navigate(\'tutoriales.html\')"], a[href="tutoriales.html"], [data-mg-tutoriales]')) return;
    const usaSidebarItem = !!nav.querySelector('.sidebar-item') && !nav.querySelector('.nav-item');
    const referencia = nav.querySelector('[data-mg-chat], [onclick*="navigate(\'chat.html\')"], a[href="chat.html"], [onclick*="navigate(\'notificaciones.html\')"], a[href="notificaciones.html"]');
    const activo = (location.pathname.split('/').pop() || '') === 'tutoriales.html';
    let item;
    if (usaSidebarItem) {
      item = document.createElement('a');
      item.href = 'tutoriales.html';
      item.className = 'sidebar-item' + (activo ? ' active' : '');
      const icono = document.createElement('span');
      icono.className = 'sidebar-icon';
      icono.textContent = '🎓';
      item.appendChild(icono);
      item.appendChild(document.createTextNode('Tutoriales'));
    } else {
      item = document.createElement('div');
      item.className = 'nav-item' + (activo ? ' active' : '');
      item.setAttribute('onclick', "navigate('tutoriales.html')");
      item.setAttribute('data-tooltip', 'Tutoriales');
      const icono = document.createElement('span');
      icono.style.cssText = 'font-size:16px;width:18px;flex-shrink:0;text-align:center;display:inline-block';
      icono.textContent = '🎓';
      const label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = 'Tutoriales';
      item.appendChild(icono);
      item.appendChild(label);
    }
    item.setAttribute('data-mg-tutoriales', '1');
    if (referencia && referencia.parentElement === nav) referencia.insertAdjacentElement('afterend', item);
    else if (referencia && referencia.closest('.nav-item, .sidebar-item')) referencia.closest('.nav-item, .sidebar-item').insertAdjacentElement('afterend', item);
    else nav.appendChild(item);
  }

  // Boton "Tutoriales" en el encabezado de cada modulo: lleva directo a los
  // videos de ESE modulo. Solo aparece si el modulo ya tiene al menos un
  // video visible, asi nadie ve un boton que lleva a una pagina vacia.
  // Totalmente aislado: si algo falla (sin red, sin tabla), simplemente no
  // se muestra y la pagina sigue exactamente igual.
  async function inyectarBotonTutorial(client) {
    const archivo = currentFile();
    if (archivo === 'tutoriales.html') return;
    const info = (window.NEGOCIO360_MODULOS || {})[archivo];
    if (!info || !info.key || info.key === 'dashboard') return;
    const header = document.getElementById('header');
    const ancla = header && header.querySelector('.theme-btn');
    if (!ancla || document.querySelector('[data-mg-tut-btn]')) return;
    const { count, error } = await client.from('tutoriales_videos')
      .select('id', { count: 'exact', head: true }).eq('modulo_key', info.key).eq('visible', true);
    if (error || !count) return;
    if (document.querySelector('[data-mg-tut-btn]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-mg-tut-btn', '1');
    b.title = 'Ver tutoriales de este módulo';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;border:1px solid var(--border,#e8e8ef);background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap';
    b.innerHTML = '🎓 <span class="mg-tut-txt">Tutoriales</span>';
    b.addEventListener('click', () => { window.location.href = 'tutoriales.html?modulo=' + encodeURIComponent(info.key); });
    // En telefono el encabezado ya va justo de espacio: el acceso a Tutoriales
    // queda en el menu lateral y no se agrega este boton.
    if (window.innerWidth <= 768) return;
    ancla.insertAdjacentElement('beforebegin', b);
    // Si por cualquier razon desborda el encabezado, se retira: nunca debe
    // empujar fuera de pantalla los botones que ya existian.
    if (header.scrollWidth > header.clientWidth + 1) b.remove();
  }

  // Encabezado en telefono: en varias paginas (Ventas, Creditos, Proformas...)
  // el encabezado tiene mas botones de los que caben en una fila y los de la
  // derecha (moneda, modo claro/oscuro, usuario) quedaban fuera de la pantalla.
  // Esta regla SOLO aplica en pantallas angostas: el encabezado pasa a dos filas
  // (los interruptores van abajo), se oculta la fecha y se compactan los botones.
  function inyectarEstiloEncabezadoMovil() {
    if (document.getElementById('mg-estilo-header-movil')) return;
    const st = document.createElement('style');
    st.id = 'mg-estilo-header-movil';
    st.textContent = `
      @media (max-width:768px){
        #header{height:auto!important;min-height:var(--header-h,64px);flex-wrap:wrap;row-gap:4px;padding-top:6px;padding-bottom:6px}
        #stock-compartido-wrap,#sc-btn-editar,#vender-sin-stock-wrap{order:30;flex-basis:100%;margin-right:0!important}
      }
      @media (max-width:480px){
        #header{padding-left:10px!important;padding-right:10px!important;gap:6px!important}
        #header-fecha{display:none!important}
        #header .plan-badge{padding:6px 8px!important}
        #header .user-menu{padding:3px 6px 3px 3px!important;gap:4px!important}
      }`;
    document.head.appendChild(st);
  }

  async function init() {
    try { inyectarEstiloEncabezadoMovil(); } catch (e) { /* solo estetico */ }
    if (!window.supabase) return; // la página no cargó el SDK de Supabase
    const client = window.supabase.createClient(MG_SUPABASE_URL, MG_SUPABASE_KEY);
    const { data: { session } } = await client.auth.getSession();
    if (!session) return; // el checkAuth propio de cada página se encarga del login

    const cfg = await cargarConfigModulos(client, session.user.id);
    if (protegerPaginaActual(cfg)) return;
    ocultarEnSidebar(cfg);
    inyectarModulosSecundariosEnSidebar(cfg);
    asegurarChatEnSidebar();
    try { asegurarTutorialesEnSidebar(); } catch (e) { console.warn("modulos-guard tutoriales:", e); }
    inyectarBotonTutorial(client).catch(e => console.warn("modulos-guard boton tutorial:", e));
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
