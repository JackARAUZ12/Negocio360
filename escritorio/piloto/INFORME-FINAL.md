# Negocio360 Escritorio con modo sin conexión — Informe final del piloto

Fecha: 2026-10-22 · Rama: `escritorio-sin-conexion` (no publicada; `main` no se tocó)

## Resumen
Se rehízo el programa de escritorio para Windows (el 1.0.1 no tenía código
fuente) y se le agregó un **modo sin conexión para Ventas**. Si se cae el
internet o se va la luz, se puede seguir vendiendo de contado o con pago
dividido. Cada venta se guarda completa en la computadora antes de imprimir el
ticket y sube sola al servidor cuando vuelve la conexión, sin perder,
duplicar ni descuadrar nada.

El modo sin conexión está **encendido solo para la cuenta piloto**. Para todas
las demás cuentas el programa funciona exactamente como la web.

**Entregables** (carpeta `escritorio/piloto/`):
- `Negocio360-Escritorio-Piloto-2.0.0-piloto.2.exe` (96 MB, Windows 64 bits);
- `SHA256.txt`;
- `GUIA-PILOTO.md` (instalación y uso);
- este informe.

## Qué hace el programa
| Tema | Cómo quedó |
|---|---|
| Pantallas | Las mismas 114 páginas del sistema web, dentro del programa. Abren sin internet; las librerías van con versión fija |
| Impresión | Directa a Windows en modo RAW (EPSON TM-U220), con la misma interfaz que usaba el 1.0.1. Se corrigió una falla de seguridad del 1.0.1 (inyección de comandos con el nombre de la impresora) |
| Indicador | 🟢 en línea · 🟠 inestable o "N venta(s) por subir" · 🔴 sin conexión |
| Ventas sin internet | Venta normal y venta rápida, de contado o con pago dividido; búsqueda de productos y clientes; ventas recientes |
| Necesita internet | Fiado, crédito, cliente nuevo, stock de otra sucursal, recetas, veterinaria, transporte, números de serie, canje de puntos. El programa avisa y no guarda nada |
| Otras pantallas sin internet | Aviso "Requiere conexión" con botón "Ir a Ventas" |
| Numeración | Cada computadora aparta bloques de 50 números del mismo contador de la web. Si se acaban sin internet, el servidor le pone a la venta el siguiente número libre y deja aviso |
| Bandeja | Cada venta se guarda en una sola transacción local. Recién entonces se imprime. Sube una por una, con reintentos crecientes; un reintento nunca duplica |
| Servidor | Función nueva `offline_registrar_venta`. Registra todo o nada: venta, detalle, stock, lotes, Caja (con su saldo encadenado), impuestos, comisión bancaria, garantías y bitácora |
| Conflictos | Dos cajas vendieron la última unidad: se aceptan ambas, el stock queda negativo marcado "vendido sin stock" y sale una alerta. Precio cambiado: se respeta lo cobrado y queda aviso. Producto desactivado: se acepta con aviso. Reloj mal puesto: se corrige la hora y queda aviso |
| Cierre de caja | No se permite mientras haya ventas de esa computadora sin subir |
| Anular | Desde "Sincronización", solo ventas aún no subidas. Las ya subidas se anulan como siempre |
| Sesión | La sesión guardada sirve sin internet. Al volver la conexión se renueva sola |
| Códigos de perfil | Los de administrador funcionan sin internet si ya se usaron una vez con internet en esa computadora. Se guardan solo como huella cifrada |
| Respaldo | Copia diaria de la base local (se guardan 7), más el botón "Exportar ventas pendientes" |
| Actualizaciones | Preparadas (no se publicó nada). Nunca se instalan con ventas sin subir |

## Cambios en la base de datos (todos solo AGREGAN; nada existente se modificó)
- **Tablas nuevas:** `offline_cuentas_habilitadas` (el interruptor: solo la cuenta piloto), `offline_dispositivos`, `offline_ventas_recibidas`, `offline_alertas` y `offline_bloques_numeracion`. Todas tienen RLS.
- **Funciones nuevas:** `offline_estado`, `offline_registrar_dispositivo`, `offline_registrar_venta`, `offline_marcar_alerta_revisada` y `offline_reservar_numeros`. Todas son `security definer`, verifican `auth.uid()`, el interruptor y que no sea una cuenta demo, y ninguna se puede llamar sin sesión.
- **Migraciones:** `supabase/migraciones/20261021_offline_*.sql`.

## Pruebas
| Tipo | Cantidad | Resultado |
|---|---|---|
| Unitarias (base local, sincronizador, motor de consultas, impresión, conexión, seguridad, empaquetado) | 59 | ✅ |
| Navegador con la pantalla real de Ventas | 15 | ✅ Los 8 tipos de venta sin internet dan **el mismo paquete** que la web |
| Programa real (Electron) con servidor simulado | 21 | ✅ Incluye cortes, apagón, sesión vencida y 500 ventas |
| SQL en la base real, en transacciones que se revierten (cuentas falsas) | Fases 0, 2, 3 y 4 | ✅ 8 ventas reales comparadas centavo por centavo; 24 pruebas de robustez y seguridad; un día completo con 2 cajas y 500 ventas, 13/13 en el cuadre |

Rendimiento medido:
- en el servidor, unos 7 milésimos de segundo por venta;
- en el programa, 500 ventas se guardan en 0,8 s y suben en unos 3 s (con el servidor simulado).

## Hallazgos en el sistema web (corregidos el 2026-10-22; falta publicarlos en `main`)
Ver `escritorio/docs/CORRECCION-COMISION-LOTES.md`. La comisión ahora aplica
solo a tarjeta y se guarda como gasto real. El lote se descuenta una sola vez.

1. **Lotes descontados dos veces:** en cuentas de farmacia con FEFO, la web descuenta el lote dos veces en algunas ventas. La versión sin conexión lo descuenta una sola vez.
2. **Comisión bancaria que no llega a Gastos:** la comisión de tarjeta nunca se guarda en Gastos porque usa `tipo: 'operativo'`, un tipo que la tabla no acepta. Sí queda en Caja: en la cuenta piloto hay 4 comisiones en Caja y 0 en Gastos.

Detalle en `escritorio/docs/INVENTARIO-VENTA.md`.

## Lo que falta / límites conocidos
- **Prueba en Windows con el servidor real.** Desde este entorno no hay conexión directa por internet a Supabase. La base real se probó con SQL, y el programa con un servidor simulado. Hay que hacer la primera prueba en la computadora del negocio siguiendo la guía.
- **Bajo wine** el programa de Windows arranca y crea su base local y su respaldo, pero no se pudo ver la ventana. Falta verlo en un Windows real.
- **Sin firma digital.** Windows mostrará "editor desconocido", igual que en el 1.0.1.
- **Números apartados:** la web pide un número al abrir cada venta, así que un día muy largo sin internet puede gastar los 50. Si pasa seguido, se sube el tamaño del bloque de la cuenta piloto (es un dato de la tabla del interruptor).
- **Sucursales:** las 4 sucursales/bodegas de la cuenta piloto tienen usuario propio y **no** tienen el modo encendido. Se encienden agregando su fila al interruptor, cuando el dueño lo decida.
- **Ventas anuladas antes de subir:** no llegan al servidor. Quedan en la computadora como "Anulada" y su número queda sin usar.

## Para publicar a clientes (requiere tu autorización)
Nada se publicó. Cuando lo autorices:
1. reemplazar `Negocio360-Setup.exe` en `main` (o enlazar el nuevo instalador);
2. crear la carpeta de actualizaciones en el sitio;
3. si se quiere, encender el modo para otras cuentas en `offline_cuentas_habilitadas`.
