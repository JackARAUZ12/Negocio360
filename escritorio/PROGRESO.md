# Progreso — Negocio360 Escritorio

| Fase | Estado | Fecha | Notas |
|---|---|---|---|
| 0 — Preparación | ✅ Terminada | 2026-10-21 | Estructura, inventario de la venta, interruptor y dispositivos en la base, versiones fijas |
| 1 — Programa v2 en línea | Pendiente | | |
| 2 — Venta completa en el servidor | Pendiente | | |
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

## Bitácora
- 2026-10-21: creada la rama `escritorio-sin-conexion` con el plan (`PLAN.md`).
- 2026-10-21: Fase 0 terminada (ver arriba).
