# Negocio360 Escritorio — modo sin conexión

Proyecto aparte, en la rama `escritorio-sin-conexion`. **La rama `main` es la que
se publica en negocio360oficial.com; esta rama no se publica y no afecta a los
clientes.** Piloto con la cuenta del dueño: `jackarauz2008@gmail.com`
(auth_user_id `b699660c-b808-4f0a-9b24-d0df60a92e83`, cuenta central con 4
sucursales/bodegas).

## Objetivo
Un programa de Windows (Electron) que funcione igual que el sistema web y que,
para lo más importante (ventas/facturación), **siga funcionando sin internet o
tras un corte de luz**, y sincronice todo con Supabase al volver la conexión,
**sin perder, duplicar ni descuadrar nada** (caja, bancos, caja chica, stock,
impuestos, contabilidad, reportes).

El instalador anterior (`Negocio360-Setup.exe` 1.0.1, en `main`) no tiene su
código fuente en el repositorio. Este proyecto lo rehace: misma impresión
directa ESC/POS a Windows (RAW vía WinSpool, EPSON TM-U220) y mejoras.

## Reglas obligatorias (no negociables)
1. **Nunca** hacer push, merge ni cambios en `main`. Todo se trabaja en
   `escritorio-sin-conexion`. Nunca tocar GitHub Pages ni el dominio.
2. **Base de datos de producción (Supabase `zvlincmqmmoclqhykejv`): solo
   agregar.** Tablas, funciones y columnas NUEVAS. Prohibido modificar o borrar
   tablas, funciones, triggers, políticas o datos existentes. Si una función
   existente necesitara cambiar, se crea una nueva al lado.
3. Todo lo nuevo en la base queda **apagado para todos** salvo la cuenta piloto,
   mediante un interruptor (`configuracion_empresa`-independiente: tabla nueva
   `offline_cuentas_habilitadas`). Las demás cuentas no notan ningún cambio.
4. Tablas nuevas siempre con RLS (cada usuario solo lo suyo); funciones nuevas
   `security definer` con `set search_path = public`, verificando `auth.uid()`
   y el interruptor. Nada ejecutable por `anon`.
5. Cada cambio de base se prueba primero dentro de una transacción que se
   revierte (DO ... raise exception con los resultados) antes de aplicarlo.
   (La herramienta SQL se cuelga con las palabras DROP/DELETE/TRUNCATE escritas
   literalmente: construirlas con `'de'||'lete'` dentro de `execute`.)
6. No modificar datos de ningún cliente. Las pruebas con datos se hacen en
   transacciones revertidas o con datos de prueba propios que se eliminan.
7. Cada fase termina con: pruebas automáticas (unitarias, navegador con
   Playwright y SQL revertido), una **auto-revisión** de código (seguridad,
   errores, casos borde) y la actualización de `escritorio/PROGRESO.md`.
   Commit y push a esta rama. Recién entonces se pasa a la siguiente fase.
8. La publicación final a clientes NO se hace sola: al terminar todo se deja
   el instalador listo como **versión piloto** y el informe final. Reemplazar
   la descarga oficial en `main` requiere la autorización explícita del dueño.
9. Commits con el pie de autoría indicado por el entorno. Textos y mensajes al
   usuario en español, claros y sin tecnicismos.

## Arquitectura
| Capa | Decisión |
|---|---|
| Programa | Electron + electron-builder (instalador NSIS), una sola instancia abierta |
| Pantallas | Las mismas páginas del sistema web, **empaquetadas dentro** del programa (abren sin internet) |
| Base local | SQLite **integrado en Electron** (`node:sqlite`, Electron 44.6.0 / Node 24.21) en la carpeta de datos del usuario, modo WAL + `synchronous=FULL`, cifrada si es viable. (Decidido en Fase 0 en lugar de better-sqlite3: no necesita compilar nada nativo, así el instalador de Windows se puede fabricar desde Linux.) |
| Bandeja de salida | Cada operación sin conexión se guarda **completa en una sola transacción local** con un UUID (clave de idempotencia) antes de imprimir el ticket |
| Sincronizador | En el proceso principal de Electron (sigue aunque se cambie de pantalla), reintentos con espera creciente, un solo envío a la vez |
| Servidor | Función nueva `offline_registrar_venta(payload jsonb)`: registra venta, detalle, stock, caja, impuestos y pago dividido **completo o nada**, idempotente por UUID |
| Numeración | Cada dispositivo reserva un **bloque de números** de factura con anticipación; si se agota, número provisional que el servidor reemplaza al sincronizar |
| Sesión | Token guardado con `safeStorage` de Electron; se renueva al reconectar |
| Actualizaciones | electron-updater con proveedor genérico (archivos de actualización servidos desde una carpeta del sitio, solo al publicar) |
| Respaldo | Copia diaria de la base local + botón "Exportar ventas pendientes" |

## Reglas de negocio sin conexión (decididas)
- **Numeración:** bloques reservados por dispositivo (p. ej. 50).
- **Dos cajas venden la última unidad:** se aceptan ambas ventas (ya se
  cobraron), el stock queda negativo marcado "vendido sin stock" y se crea una
  **alerta de conflicto de inventario**. Nunca se rechaza una venta cobrada.
- El mismo dispositivo no vende más de su stock local (respetando "Vender sin
  stock" de la cuenta).
- Precio cambiado mientras estaba sin conexión: se respeta el precio cobrado
  y queda nota.
- Producto desactivado mientras tanto: se acepta con aviso.
- Saldos de caja: los recalcula el servidor al sincronizar; fecha y hora
  reales de la venta; si el reloj del equipo difiere mucho del servidor, se
  marca para revisión.
- Cierre de caja: no se permite con ventas pendientes de subir.
- Anular sin conexión: solo ventas aún no subidas.
- Stock compartido entre sucursales: desactivado sin conexión.
- Sin conexión **solo** ventas (contado y pago dividido) y consultas. Créditos,
  fiados y clientes nuevos sin conexión quedan para después del piloto.
- Cuentas demo: nunca modo sin conexión.

## Fases
- **Fase 0 — Preparación:** estructura del proyecto en `escritorio/`;
  inventario de lo que hace hoy una venta (ventas.js: venta, detalle, stock,
  lotes FEFO, caja con saldo encadenado, impuestos, pago dividido, cliente,
  garantías) para replicarlo exacto en el servidor; tabla interruptor y tabla
  de dispositivos; fijar versiones de librerías externas dentro del programa.
- **Fase 1 — Programa v2 en línea:** Electron con las páginas empaquetadas,
  impresión ESC/POS RAW a Windows, una instancia, indicador 🟢🟠🔴,
  actualización automática preparada. Con internet funciona igual que la web;
  sin internet muestra "Requiere conexión".
- **Fase 2 — Venta completa en el servidor:** `offline_registrar_venta`
  idempotente; pruebas comparando centavo por centavo contra el flujo actual
  (caja, bancos, stock, lotes, impuestos, contabilidad) y anulación.
- **Fase 3 — Modo sin conexión de ventas:** catálogo local, bandeja,
  sincronizador, numeración por bloques, alertas, pantalla "Sincronización".
- **Fase 4 — Pruebas de fuego:** cortar internet a mitad de venta y de subida,
  matar el proceso (apagón), dos equipos con la misma última unidad, 500
  ventas sin conexión, reloj mal puesto, precio/producto cambiado, sesión
  vencida, actualización con pendientes. Cuadre final contra lo esperado.
- **Fase 5 — Piloto listo:** instalador piloto, guía de instalación y de uso,
  informe final con todo lo probado y lo pendiente.
