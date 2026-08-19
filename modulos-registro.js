/* ============================================================
   MODULOS-REGISTRO.JS — NEGOCIO360
   ------------------------------------------------------------
   ÚNICA fuente de verdad de todos los módulos del sistema. Se
   carga ANTES que perfiles-guard.js y modulos-guard.js (por eso
   va justo después del SDK de Supabase en el <head> de cada
   página) para que ambos lean de aquí en vez de tener cada uno
   su propia lista por separado.

   A partir de ahora, agregar un módulo nuevo a Negocio360 es UNA
   sola línea aquí:
     - El sistema de permisos por perfil (perfiles-guard.js) lo
       detecta solo.
     - El interruptor de "Editar módulos" en Configuración
       (modulos-guard.js) lo detecta solo, si no es obligatorio.
     - El registro de auditoría (auditoria-guard.js) ya audita
       cualquier módulo automáticamente, sin tocar nada aquí.
   Lo ÚNICO que sigue siendo manual es agregar el enlace visual
   en el <nav> de cada página (ícono + texto) y, si aplica, la
   tarjeta de acceso rápido del Dashboard — como cualquier
   cambio de diseño, eso no se puede inventar solo.

   Campos de cada módulo:
     key         identificador corto (usado por perfiles-guard)
     label       nombre visible
     icon        emoji (usado por modulos-guard y menús)
     obligatorio true = siempre disponible, nunca se puede
                 desactivar ni asignar/quitar por perfil
     soloAdmin   true = el módulo tiene su propio candado de
                 código de administrador (Configuración,
                 Auditoría) — por eso NO se ofrece como algo
                 asignable a perfiles restringidos: aunque se
                 marcara, el candado igual los bloquearía.
   ============================================================ */
'use strict';

(function () {
  const MODULOS = {
    // ---- Obligatorios (siempre visibles, nunca se desactivan) ----
    'dashboard.html':        { key: 'dashboard',        label: 'Dashboard',           icon: '🏠', obligatorio: true },
    'ventas.html':           { key: 'ventas',           label: 'Ventas',              icon: '💰', obligatorio: true },
    'clientes.html':         { key: 'clientes',         label: 'Clientes',            icon: '👥', obligatorio: true },
    'productos.html':        { key: 'productos',        label: 'Productos/Servicios', icon: '📦', obligatorio: true },
    'compras.html':          { key: 'compras',          label: 'Compras',             icon: '🛒', obligatorio: true },
    'gastos.html':           { key: 'gastos',           label: 'Gastos',              icon: '💸', obligatorio: true },
    'caja.html':             { key: 'caja',             label: 'Caja / Pagos',        icon: '🏦', obligatorio: true },
    'reportes.html':         { key: 'reportes',         label: 'Reportes',            icon: '📊', obligatorio: true },
    'chat.html':             { key: 'chat',             label: 'Chat con Negocio360', icon: '💬', obligatorio: true },
    'configuracion.html':    { key: 'configuracion',    label: 'Configuración',       icon: '⚙️', obligatorio: true, soloAdmin: true },

    // ---- Opcionales (se pueden activar/desactivar desde Configuración) ----
    'creditos.html':         { key: 'creditos',         label: 'Créditos',            icon: '🧾', obligatorio: false,
                               desc: 'Ventas y préstamos a crédito, cuotas y cobros.' },
    'estadisticas.html':     { key: 'estadisticas',     label: 'Estadísticas',        icon: '📈', obligatorio: false,
                               desc: 'Gráficas y tendencias adicionales del negocio.' },
    'notificaciones.html':   { key: 'notificaciones',   label: 'Notificaciones',      icon: '🔔', obligatorio: false,
                               desc: 'Centro de avisos y alertas del sistema.' },
    'impuestos.html':        { key: 'impuestos',        label: 'Impuestos',           icon: '🧮', obligatorio: false,
                               desc: 'Catálogo de impuestos aplicados a ventas y créditos.' },
    'cuentas-por-pagar.html':{ key: 'cuentas_por_pagar',label: 'Cuentas por Pagar',   icon: '📇', obligatorio: false,
                               desc: 'Compras a crédito a proveedores y sus pagos.' },
    'salarios.html':         { key: 'salarios',         label: 'Salarios',            icon: '🧑‍💼', obligatorio: false,
                               desc: 'Empleados, pagos, adelantos y bonificaciones.' },
    'auditoria.html':        { key: 'auditoria',        label: 'Auditoría',           icon: '🕵️', obligatorio: false, soloAdmin: true,
                               desc: 'Registro de movimientos por usuario, con fecha y hora. Requiere código de administrador.' },
    'personalizacion.html':  { key: 'personalizacion',  label: 'Personalización',     icon: '🎨', obligatorio: false,
                               desc: 'Colores, logo y tema visual del negocio.' },
    'proformas.html':        { key: 'proformas',        label: 'Proformas',           icon: '📄', obligatorio: false,
                               desc: 'Cotizaciones para clientes, convertibles a venta con un clic.' },
    'codigos-barras.html':   { key: 'codigos_barras',    label: 'Códigos de Barras',   icon: '📊', obligatorio: false,
                               desc: 'Crear, administrar e imprimir códigos de barras (Code 128), de forma independiente.' },
    'sucursales.html':       { key: 'sucursales',        label: 'Sucursales',          icon: '🏬', obligatorio: false,
                               desc: 'Entrar a las sucursales permitidas. Crear, configurar y eliminar sigue siendo exclusivo de la Central.' },
    'consulta-inventario.html': { key: 'consulta_inventario', label: 'Consulta/Inventario', icon: '🔎', obligatorio: false,
                               desc: 'Busca cualquier producto o servicio (por nombre/SKU o escaneando su código) y ve cómo está repartido entre todas tus sucursales y bodegas.' },
    'rutas.html':              { key: 'rutas',              label: 'Rutas',               icon: '🗺️', obligatorio: false,
                               desc: 'Ubica a tus clientes en el mapa y arma rutas de cobro o venta en ruta, conectadas con Créditos y Ventas.' },
    'delivery.html':           { key: 'delivery',           label: 'Delivery',            icon: '🛵', obligatorio: false,
                               desc: 'Pedidos de entrega individuales, con repartidor propio o servicio externo — para negocios donde cada entrega es su propio caso, no una ronda planificada.' },
    'activos.html':            { key: 'activos',            label: 'Activos Fijos',       icon: '🏭', obligatorio: false,
                               desc: 'Vehículos, herramientas, maquinaria y todo lo que el negocio posee para operar (no para vender) — con depreciación automática según la ley nicaragüense y asientos contables generados solos.' },
    'contabilidad.html':       { key: 'contabilidad',       label: 'Contabilidad',        icon: '📒', obligatorio: false,
                               desc: 'Catálogo de cuentas y asientos contables con partida doble real (Debe = Haber siempre). Libro Mayor y Balance de Comprobación.' },
  };

  window.NEGOCIO360_MODULOS = MODULOS;
})();
