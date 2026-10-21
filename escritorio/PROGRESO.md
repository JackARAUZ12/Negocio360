# Progreso — Negocio360 Escritorio

| Fase | Estado | Fecha | Notas |
|---|---|---|---|
| 0 — Preparación | ✅ Terminada | 2026-10-21 | Estructura, inventario de la venta, interruptor y dispositivos en la base, versiones fijas |
| 1 — Programa v2 en línea | ✅ Terminada | 2026-10-21 | Páginas empaquetadas, impresión RAW segura, una instancia, 🟢🟠🔴, actualizador preparado, instalador de Windows fabricado desde Linux |
| 2 — Venta completa en el servidor | ✅ Terminada | 2026-10-21 | `offline_registrar_venta` todo-o-nada e idempotente; 8 ventas reales de la web comparadas centavo por centavo |
| 3 — Modo sin conexión de ventas | Pendiente | | |
| 4 — Pruebas de fuego | Pendiente | | |
| 5 — Piloto listo | Pendiente | | |

## Fase 0 — Preparación (2026-10-21)

### Hecho
- **Estructura** del proyecto en `escritorio/` (ver `LEEME.md`): `package.json`
  con versiones **exactas** y `package-lock.json`, carpetas `src/`,
  `herramientas/`, `docs/`, `pruebas/`.
- **Código del instalador 1.0.1 recuperado** desde el propio
  `Negocio360-Setup.exe` (no estaba en el repositorio) →
  `referencia-v1.0.1/`. Confirma la interfaz que usa la web para imprimir
  (`window.negocio360Print.listarImpresoras / imprimir`) y la técnica RAW por
  WinSpool. Se encontró un **riesgo de seguridad** en la 1.0.1 (el nombre de la
  impresora se mete dentro del script de PowerShell) que la v2 corrige
  (detalle en `referencia-v1.0.1/LEEME.md`).
- **Inventario de la venta** → `docs/INVENTARIO-VENTA.md`: cálculo del
  resumen, cada fila que escriben Nueva venta y Venta rápida (venta, detalle,
  lotes, stock, combos, promociones, caja con saldo encadenado por el
  servidor, pago dividido con reparto exacto, bancos/moneda, comisión
  bancaria, IVA y otros impuestos, retención IR, cliente, garantías), los
  triggers que corren solos, cómo lo lee Contabilidad y cómo se anula. Incluye
  8 observaciones del flujo actual (p. ej. no hay transacción, stock no
  atómico, posible doble descuento de lotes, anulación que no devuelve el
  stock de combos) — **no se tocan en `main`**, quedan para decisión del dueño.
- **Base de datos** (migración `supabase/migraciones/20261021_offline_fase0_interruptor_dispositivos.sql`,
  aplicada como `offline_fase0_interruptor_dispositivos`). Solo agrega:
  - `offline_cuentas_habilitadas` (interruptor; **una sola fila: la cuenta
    piloto**, `tamano_bloque` 50, máximo 5 equipos).
  - `offline_dispositivos` (equipos con el programa).
  - `offline_estado()` y `offline_registrar_dispositivo(...)`: `security
    definer`, `search_path=public`, verifican `auth.uid()`, el interruptor y
    que no sea cuenta demo. Sin permiso para `anon`. Tablas con RLS y solo
    permiso de lectura (las escrituras pasan por las funciones).
- **Versiones fijas** de todo lo que hoy se baja de internet
  (`herramientas/librerias.json`, verificado por `npm run librerias` sobre las
  114 páginas): supabase-js 2.117.2 (la web pide "@2"), lucide 1.52.0 (la web
  pide "@latest"), jspdf 2.5.1, jspdf-autotable 3.7.1, xlsx 0.18.5, chart.js
  4.4.0, jsbarcode 3.11.6, html2canvas 1.4.1, leaflet 1.9.4, @zxing/browser
  0.1.5; fuentes Plus Jakarta Sans y JetBrains Mono 5.2.8. Programa: Electron
  44.6.0, electron-builder 26.15.3, electron-updater 6.8.10, Playwright 1.56.1
  (coincide con el Chromium instalado en `/opt/pw-browsers`). Todas con más de
  2 semanas de publicadas.
- **Decisión técnica:** la base local usa el SQLite que ya trae Electron
  (`node:sqlite`) en vez de better-sqlite3 → nada que compilar, el instalador
  de Windows se puede fabricar desde Linux. `PLAN.md` actualizado.

### Pruebas
- SQL en transacción revertida (`pruebas/sql/fase0_pruebas.sql`): 16
  comprobaciones OK — sin sesión bloqueado (funciones y tabla); piloto
  habilitado, alta de equipo, repetir alta devuelve el mismo equipo,
  identificador inválido rechazado, escritura directa a las tablas
  bloqueada, límite de 5 equipos; otra cuenta: `habilitado:false`, no ve
  nada, no puede dar de alta; cuenta demo: `habilitado:false`. Después de
  revertir se confirmó que no quedó nada; luego se aplicó la migración.
- Revisor de seguridad de Supabase: solo los avisos esperados ("función
  security definer ejecutable por usuarios con sesión", igual que las demás
  funciones del sistema). Nada expuesto a `anon`, ninguna tabla sin RLS.
- Unitarias (`npm run pruebas`): 5/5 OK (clasificación de librerías, versión
  distinta rechazada, todas las páginas reales cubiertas, copias locales con
  versión exacta).
- Humo Electron con Playwright (`npm run humo`): Electron 44.6.0 arranca y su
  SQLite 3.53.4 funciona en WAL + `synchronous=FULL`.

### Auto-revisión
- Seguridad de la base: funciones sin SQL dinámico, parámetros truncados y
  validados (UUID estricto), candado por cuenta al dar de alta equipos, nada
  para `anon`. Ninguna tabla/función existente modificada.
- Casos borde anotados para fases siguientes: un equipo desactivado
  (`activo=false`) debe dejar de vender sin conexión (Fase 3); el nombre del
  equipo es texto libre → escaparlo al mostrarlo; las **4 sucursales** de la
  cuenta piloto tienen usuario propio y **no** están habilitadas (si se quiere
  probar con una sucursal, se agrega su fila al interruptor).

### Notas para el entorno
- `npm install` no logra bajar el binario de Electron tras el proxy; se usa
  `npm run instalar-electron` (descarga directa con verificación SHA-256).

### Sigue
Fase 1 — programa v2 en línea: Electron con las páginas empaquetadas
(librerías locales), impresión RAW segura, una sola instancia, indicador
🟢🟠🔴, actualización automática preparada, y prueba de fabricar el
instalador de Windows desde Linux.

## Fase 1 — Programa v2 en línea (2026-10-21)

### Hecho
- **Programa Electron 44.6.0** (`src/main/`, `src/preload/`): abre las MISMAS
  páginas del sistema web, empaquetadas dentro del programa en
  `app://negocio360/…` (abren sin internet). Pantalla de bienvenida de la
  1.0.1, menú simple sin herramientas de desarrollador, **una sola
  instancia** (abrirlo otra vez trae al frente la ventana abierta).
- **Empaquetador** (`herramientas/empaquetar-web.js`): copia las 114 páginas
  y cambia en la copia cada librería de internet por la local con versión
  fija, y las fuentes de Google de las pantallas del sistema (Plus Jakarta
  Sans, JetBrains Mono, Sora, DM Sans, Inter) por copias locales. Ajustes
  puntuales solo dentro del programa, con verificación (si el texto original
  cambia, el empaquetado falla en vez de aplicarse a ciegas):
  - "Olvidé mi contraseña": el enlace del correo apunta al sitio web.
  - 27 enlaces "para compartir" en 22 archivos (catálogos, invitaciones de
    freelancers) apuntan a `https://negocio360oficial.com` en vez de la
    dirección interna del programa. Las comprobaciones de seguridad
    (`ev.origin !== location.origin`) no se tocan.
  - Los archivos originales del repositorio nunca se modifican.
- **Impresión directa** (`window.negocio360Print`, misma interfaz que la
  1.0.1, así `ventas.js` no cambia): RAW a Windows por WinSpool
  (`recursos/imprimir-raw.ps1`, ahora con la versión Unicode de la API, así
  sirven nombres de impresora con acentos). **Corregido el riesgo de
  seguridad de la 1.0.1**: el nombre de la impresora se valida contra la
  lista real de Windows y viaja como variable de entorno (dato), nunca dentro
  del código; archivos temporales con nombre aleatorio que siempre se
  borran; un ticket a la vez; mensajes claros (impresora no encontrada,
  apagada, tardó demasiado). La lista de impresoras se lee con la función de
  Electron (sin PowerShell).
- **Indicador 🟢🟠🔴** en la esquina inferior izquierda de cada pantalla
  (En línea / Conexión inestable / Sin conexión). El vigilante corre en el
  proceso principal (sigue aunque se cambie de pantalla): revisa el servidor
  cada 15 s (cada 5 s si no hay conexión); 1 falla = 🟠, 2 seguidas = 🔴.
  **Sin internet**: aviso "Requiere conexión" sobre la pantalla con botón
  Reintentar; se quita solo al volver la conexión. Ya está preparado para la
  Fase 3: una página puede marcarse como "funciona sin conexión" y las ventas
  pendientes ponen el indicador en 🟠.
- **Seguridad de ventanas**: las páginas no tienen acceso a Node ni a
  archivos; enlaces de internet (WhatsApp, mapas, sitio) se abren en el
  navegador de Windows; se permiten las ventanas en blanco que usa el sistema
  para imprimir tickets (sin puente ni indicador); bloqueado `file://`,
  `javascript:`, `data:`; permisos solo cámara (lector de códigos) y
  portapapeles; mensajes al programa solo desde páginas del sistema; el
  programa instalado no acepta modos de depuración (fusibles de Electron).
- **Actualización automática preparada** (`electron-updater`, proveedor
  genérico en `https://negocio360oficial.com/escritorio/actualizaciones/`,
  canal `piloto`). Esa carpeta NO existe y no se crea sin autorización del
  dueño; mientras tanto el programa no encuentra nada y sigue igual. Nunca
  instala con ventas sin subir (gancho listo para la Fase 3).
- **Instalador de Windows fabricado desde Linux** (`npm run instalador-win`,
  NSIS, con wine 64+32 bits): `Negocio360-Escritorio-Piloto-2.0.0-piloto.1.exe`.
  Se comprobó que el programa de Windows arranca bajo wine y que la segunda
  apertura se cierra sola (una instancia). No va firmado digitalmente.

### Pruebas
- Unitarias: **30/30** (rutas que no salen de la carpeta de páginas,
  reglas de ventanas y navegación, permisos, impresión: bytes exactos,
  nombre malicioso nunca ejecutado, impresora inexistente rechazada sin
  ejecutar nada, límites de tamaño, errores de Windows traducidos, orden de
  tickets; vigilante de conexión 🟢/🟠/🔴 y pendientes; empaquetador:
  librerías, fuentes, parches que fallan si cambia el original, enlaces para
  compartir; actualizador que no instala con pendientes).
- Programa real con Playwright (`npm run e2e`): **9/9** — login empaquetado
  sin pedir nada a los CDN; cada librería fijada carga y funciona (supabase,
  lucide, jsPDF + autotable generando un PDF, xlsx, chart.js, JsBarcode,
  html2canvas, leaflet, zxing) y las fuentes locales se aplican; las páginas
  no ven Node; no se puede leer fuera de la carpeta de páginas; impresión de
  un ticket real armado con `escpos-usb.js` (con Ñ, ½ y ¡) llega byte por
  byte a la impresora simulada; impresora inventada rechazada; indicador
  🟢 → 🔴 con "Requiere conexión" → 🟢 con Reintentar; enlaces externos al
  navegador; ventana de ticket sin puente; una sola instancia.
- Revisión visual (capturas) del login y del aviso sin conexión.

### Auto-revisión
- Riesgos cubiertos: lectura de archivos fuera de la carpeta (`..`, `%2e`,
  `%00`, `\`), ejecución de comandos por el nombre de impresora, ventanas a
  sitios externos dentro del programa, permisos del navegador.
- Igual que la 1.0.1: las páginas incrustadas en un marco (p. ej. la venta
  abierta dentro de Rutas o Proformas) no tienen impresión directa; se
  imprime con la vía normal. Se revisará en la Fase 3 si hace falta.
- La sesión del programa es independiente de la del navegador: se inicia
  sesión una vez en el programa.

### Pendiente / limitaciones de este entorno
- **Desde aquí no hay conexión a Supabase por internet** (el proxy del
  entorno la bloquea; solo hay acceso por la herramienta SQL). Por eso
  "con internet funciona igual que la web" se probó con un servidor
  simulado; la prueba real de iniciar sesión y vender con internet queda para
  el piloto en Windows (Fase 5, guía de prueba).
- Bajo wine la ventana no se dibuja ni deja conectarse por dentro: la prueba
  visual del programa de Windows también queda para la computadora real.
- **Tamaño del instalador: 108,6 MB** (Electron 44 es más grande que la 30 de
  la 1.0.1; ya se quitaron idiomas no usados y se usa compresión máxima).
  GitHub no acepta archivos de más de 100 MB en el repositorio: se resolverá
  en la Fase 5 (entrega).

### Sigue
Fase 2 — función del servidor `offline_registrar_venta` (todo o nada,
idempotente), comparada centavo por centavo con el flujo actual.

## Fase 2 — Venta completa en el servidor (2026-10-21)

### Hecho
- **Migración** `supabase/migraciones/20261021_offline_fase2_registrar_venta.sql`
  (aplicada como `offline_fase2_registrar_venta`, solo agrega):
  - `offline_ventas_recibidas` (control e idempotencia por UUID) y
    `offline_alertas` (avisos para revisar), con RLS y solo lectura.
  - `offline_registrar_venta(payload)`: registra la venta COMPLETA en una sola
    transacción (venta, detalle, stock, lotes, Caja con saldo encadenado por el
    trigger existente, pago dividido, comisión bancaria, IVA y otros
    impuestos con su saldo, retención IR, cliente, garantías y bitácora de
    auditoría). Todo o nada. Si la misma venta llega dos veces, devuelve el
    primer resultado sin duplicar.
  - `offline_marcar_alerta_revisada(id)`; ayudantes internos sin permiso
    para nadie (`_offline_insertar` con lista blanca de columnas, `_offline_ref`
    que solo acepta referencias de la propia cuenta).
- **Cómo se garantiza que es igual a la web**: el paquete lo arma el código
  REAL de `ventas.js` (con un Supabase "grabador"), convertido por
  `src/compartido/registro-a-payload.js` — la misma pieza que usará el
  programa en la Fase 3. Contrato en `docs/PAQUETE-VENTA.md`.
- **Arnés de comparación** (`pruebas/referencia-web/`): abre la pantalla real
  de Ventas en Chromium con un Supabase simulado fiel (las lecturas ven lo
  escrito, orden y relaciones), ejecuta 8 ventas con los mismos botones del
  cajero y genera la prueba SQL (`npm run referencia`).
- Reglas del plan aplicadas en el servidor: número del bloque del equipo si
  está libre, si no uno nuevo (y se corrige en conceptos, observaciones y
  bitácora); provisional → número definitivo; dos equipos con la última
  unidad → stock negativo marcado "vendido sin stock" + alerta, nunca se
  rechaza; precio cambiado → se respeta lo cobrado + alerta; producto
  desactivado → se acepta + alerta; reloj del equipo con más de 10 min de
  diferencia → alerta y hora corregida; fecha y hora reales de la venta;
  crédito/fiado rechazados (no van sin conexión); equipo desactivado o no
  registrado rechazado.

### Pruebas (todas en transacciones que se revierten, con cuentas FALSAS)
- **Centavo por centavo contra la web real — 8 escenarios**: Nueva venta en
  efectivo con cliente, IVA y descuento; tarjeta con banco, comisión y
  garantía; pago dividido con IVA; combo + promoción + servicio; IVA + otro
  impuesto + retención IR; farmacia con lote y presentación (Caja x12);
  Venta rápida con IVA; Venta rápida con pago dividido. Se compararon venta,
  detalle, movimientos de Caja y saldos, saldo final de Caja, Impuestos y
  saldos, detalle de impuestos, retenciones, garantías, gastos, stock de
  todos los productos, lotes, cliente, bitácora y alertas de stock.
  **Resultado: 7 idénticos; el de farmacia solo difiere en el lote, porque la
  web lo descuenta DOS veces (20 − 4 − 4 = 12) y la función nueva una (16).**
- **Robustez y seguridad — 24 comprobaciones OK**: venta normal; la misma
  venta reenviada no se duplica (ni descuenta stock dos veces); mismo UUID
  con otro contenido rechazado; número repetido reemplazado y corregido en
  los textos; número provisional reemplazado; stock negativo con marca y
  alerta; precio cambiado + producto desactivado con alertas y total
  respetado; reloj atrasado 40 min con alerta y hora corregida; producto,
  cliente y banco de OTRA cuenta no se tocan ni se vinculan; **todo o nada**
  (si una parte falla no queda ni la venta ni el stock descontado); fiado,
  cantidad negativa, UUID malo y paquete sin detalle rechazados; equipo
  desconocido o desactivado rechazado; cada cuenta ve solo lo suyo; otra
  cuenta sin interruptor bloqueada; cuenta demo bloqueada; sin sesión
  bloqueado; ayudantes internos sin permiso para nadie.
- Unitarias: **34/34** (se agregaron las del convertidor: las 8 capturas sin
  nada prohibido y con Caja = total neto; lo no permitido sin conexión se
  detecta: cliente nuevo, fiado, stock compartido, números de serie,
  transporte, tablas desconocidas; stock/lotes/cliente no viajan).
- Revisor de seguridad de Supabase: solo el aviso esperado de funciones
  `security definer` para usuarios con sesión; nada para `anon`.

### Hallazgos para el dueño (no se tocan en `main`)
- **Doble descuento de lotes** en Nueva venta (cuentas con farmacia y lotes,
  como la tuya): confirmado con la base real.
- **La comisión bancaria nunca se guarda en Gastos** (la web usa un tipo de
  gasto que la base no acepta): confirmado; en producción hay 4 comisiones en
  Caja y 0 en Gastos.

### Anulación
Las filas que deja la venta sin conexión son idénticas a las de la web, así que
una venta ya subida se anula con el botón de siempre y produce lo mismo. Anular
una venta que todavía no subió (solo en el equipo) es parte de la Fase 3.

### Sigue
Fase 3 — modo sin conexión de ventas en el programa: catálogo local, bandeja
de salida en SQLite, sincronizador, numeración por bloques, alertas y
pantalla "Sincronización".

## Bitácora
- 2026-10-21: creada la rama `escritorio-sin-conexion` con el plan (`PLAN.md`).
- 2026-10-21: Fase 0 terminada (ver arriba).
- 2026-10-21: Fase 1 terminada (ver arriba).
- 2026-10-21: Fase 2 terminada (ver arriba).
