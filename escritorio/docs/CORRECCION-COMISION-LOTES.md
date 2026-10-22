# Corrección: comisión bancaria y doble descuento de lotes (2026-10-22)

Pedido del dueño: corregir las dos fallas encontradas en la web, revisando que
no descuadre nada (Caja, bancos, Gastos, Contabilidad, reportes, inventario).
La comisión debe aplicar **solo a pagos con tarjeta**, nunca a transferencias.

## 1. Comisión bancaria

### Qué pasaba
- La web intentaba guardar la comisión en Gastos con `tipo: 'operativo'`, que
  la base rechaza (solo acepta `inmediato`/`programado`). El error se ignoraba:
  la comisión quedaba solo como egreso en Caja, ligado a la venta.
- Consecuencias:
  - **Contabilidad** arma los asientos de gastos desde la tabla `gastos`, así
    que nunca registraba la comisión. La Caja contable quedaba más alta que la
    real y el Estado de resultados la omitía.
  - **Reportes, Estadísticas y Dashboard** suman la tabla `gastos` más los
    egresos de Caja *sin* referencia. La comisión tenía referencia y no estaba
    en `gastos`, así que la ganancia no la descontaba.
  - **Cancelar o anular:** no había forma de anular la comisión junto con la
    venta.
- Se cobraba también en **transferencias** (cualquier venta con banco elegido).

### Qué hace ahora
- Solo si el método es **tarjeta** (`nombre` contiene "tarjeta") y el banco
  tiene comisión. En transferencias no se muestra ni se guarda.
- El monto se recalcula al cerrar la venta sobre el total final, salvo que el
  vendedor lo haya ajustado a mano.
- Se guarda igual que un gasto del módulo Gastos:
  1. fila en `gastos` (`tipo: 'inmediato'`, categoría "Comisiones bancarias",
     `venta_id` = la venta);
  2. egreso en Caja `EGRESO/GASTO` ligado **al gasto** (`referencia_tipo:
     'gasto'`), en el banco donde entró el pago. En bancos en dólares lleva
     `monto_moneda_banco`.
  3. `gastos.movimiento_financiero_id` y `ventas.comision_*`.
  - Los dos (gasto + egreso) van juntos: si el gasto no se guarda, tampoco se
    toca Caja, y se avisa para registrarla a mano.
- **Anular la venta** (con "descontar de Caja") anula también su comisión: el
  gasto queda `cancelado` y su egreso `anulado`, como al cancelar un gasto en
  Gastos. Contabilidad anula sola el asiento del gasto cancelado
  (`cancelado_en`). Cubre también comisiones antiguas ligadas a la venta.

### Por qué cuadra
| Lugar | Antes | Ahora |
|---|---|---|
| Caja / saldo del banco | − comisión | − comisión (igual) |
| Gastos | no aparecía | aparece una vez |
| Contabilidad (Caja contable, Estado de resultados) | sin la comisión: descuadre con Caja real | Debe Gastos / Haber Caja: igual a Caja real |
| Reportes, ganancia, Dashboard | no la restaban | la restan una vez (el egreso tiene referencia, no se suma otra vez) |
| Flujo de efectivo | − comisión | − comisión (igual) |
| Cancelar el gasto en Gastos | no anulaba el egreso (estaba ligado a la venta) | anula el egreso (ligado al gasto) |
| Anular la venta | la comisión quedaba | se anula gasto, egreso y asiento |

## 2. Lotes descontados dos veces

### Qué pasaba
En Nueva venta, una línea con lote elegido (FEFO de Farmacia / Veterinaria /
Insumos) se descontaba dos veces:
- del lote elegido, por `cantidad` y sin multiplicar por la presentación;
- además, por `descontar_lote_fefo`, por las unidades reales.

Ejemplo: 4 unidades dejaban el lote en 12 de 20, en vez de 16.

### Qué hace ahora
- Función nueva `descontar_lote_venta(lote, producto, unidades)`, en el
  servidor, atómica. Descuenta **una sola vez** del lote elegido y, si no
  alcanza, el resto del siguiente que vence. Usa las unidades reales: 1 caja
  de 12 = 12. Devuelve lo que no cupo en ningún lote.
- Las líneas con lote ya no pasan por `descontar_lote_fefo`. Las líneas sin
  lote elegido siguen igual (FEFO).
- El stock del producto (`stock_actual`) no cambia: lo sigue descontando la
  venta como siempre.

## Base de datos (solo agrega; aplicada)
Migración `supabase/migraciones/20261022_correccion_lotes_comision.sql`:
- `gastos.venta_id`: columna nueva opcional, con índice y sin restricciones.
  El resto del sistema no la usa, así que no cambia nada para nadie.
- `descontar_lote_venta`: función nueva (sin acceso para `anon`).
- Funciones propias del modo sin conexión (`offline_registrar_venta`,
  `_offline_insertar`), que solo usa la cuenta piloto, actualizadas a las
  mismas dos reglas.

## Pruebas
- **Base real, en una transacción que se revierte:**
  - 10/10 casos de lotes (elegido, no alcanza, FEFO, otra cuenta, anon) y de
    comisión (tarjeta, Caja, transferencia, anular, reenvío).
  - 5 ventas reales de la web corregida comparadas fila por fila contra el
    servidor: **idénticas**. Son tarjeta, farmacia con lote y presentación,
    transferencia, venta rápida con tarjeta y venta rápida con lotes.
  - Resultados: Caja 5,000 + 2,799.99 − 84 = 7,715.99; lote 20 → 16 (antes
    12); transferencia sin comisión.
- **Pantalla real de Ventas** (Chromium), en la versión de esta rama **y en
  la versión actual de `main`** (con venta atómica): comisión con tarjeta
  ligada a venta y gasto; transferencia sin comisión ni en pantalla; anular
  anula gasto y egreso; lote una sola vez.
- **Programa de escritorio:** las 10 ventas sin internet dan el mismo paquete
  que la web; pruebas del programa real sin cambios (21/21).

## Publicar en la web — autorizado por el dueño, pendiente de un paso manual
El 2026-10-22 el dueño autorizó publicar. La protección automática del
entorno bloqueó subir a `main` desde esta sesión (despliegue a producción).
La corrección quedó probada sobre `main` actual: 10 ventas sin errores, y la
venta atómica de `main` + la comisión + la anulación cuadran en la base real.
Para publicarla, desde una copia de `main`:
`main` cambió después de crear esta rama: ahora la venta se guarda con
`venta_registrar_atomica`. La comisión y los lotes siguen igual que antes
allí, con la misma falla. La corrección para `main` está lista en
`docs/publicar-main-comisiones.patch`. Se probó sobre `main` (`e32bc49`)
y aplica limpio:
```
git checkout main && git apply escritorio/docs/publicar-main-comisiones.patch
```
La base ya tiene lo necesario; no hace falta otra migración.

## Datos anteriores — CORREGIDOS el 2026-10-22 con autorización del dueño
Se probó primero en una transacción revertida y luego se aplicó:
- las 3 comisiones sobre transferencias quedaron anuladas en Caja (C$ 15,023);
- en esas 3 ventas se quitó el campo `comision_*`;
- a la de tarjeta (V-000357, C$ 5) se le creó su gasto, y su egreso quedó
  ligado al gasto;
- en la bitácora quedaron 2 registros "Soporte (corrección autorizada)".

Resultado:
- el saldo de Caja pasó de C$ 308,918.90 a **C$ 323,941.90**;
- la cadena de saldos está correcta fila por fila;
- ningún cierre de caja cambió (ninguno era de esos días).

La próxima vez que se generen los asientos, Contabilidad registrará la
comisión de C$ 5.

### Detalle original
En la cuenta piloto hay 4 comisiones antiguas (todas en BAC, 5 %):

| Venta | Fecha | Método | Comisión |
|---|---|---|---|
| V-000357 | 2026-09-18 | Tarjeta | C$ 5.00 |
| V-000368 | 2026-09-23 | Transferencia | C$ 18.00 |
| V-000392 | 2026-09-28 | Transferencia | C$ 5.00 |
| V-000454 | 2026-10-19 | Transferencia | C$ 15,000.00 |

Propuesta:
- las 3 de transferencia (C$ 15,023): anular su egreso en Caja;
- la de tarjeta: crearle su gasto.

Con eso, Caja, Gastos y Contabilidad quedan iguales. Los lotes ya descontados
de más en ventas antiguas se pueden revisar con un ajuste de inventario.


## 3. Comisión OPCIONAL al pagar con tarjeta (egresos) — 2026-10-22
Pedido del dueño: cuando el negocio **paga** con tarjeta normalmente no hay
comisión, pero a veces el proveedor la cobra. En todo egreso debe ser
**opcional**.

### Qué hace
- En **Gastos** (gasto pagado al momento y pago de gasto programado),
  **Compras** (compra normal, compra directa, completar una compra pendiente,
  orden convertida en compra) y **Cuentas por pagar** (pago a proveedor y
  prima), si el método es **tarjeta** aparece la casilla "El proveedor me
  cobra una comisión por pagar con tarjeta (opcional)":
  - viene **apagada**;
  - con transferencia o efectivo no aparece;
  - marcada, se escribe el % (calcula el monto) o el monto directo.
- Se registra como en Ventas:
  - un gasto aparte "Comisiones bancarias";
  - su egreso de Caja del **mismo banco**, ligado al gasto;
  - el gasto queda ligado a la operación que lo originó (`gastos.origen_tipo`
    / `origen_id`: `gasto`, `compra`, `pago_cxp`, `prima_cxp`).
  - El egreso del pago original no cambia: la comisión va aparte. Así cuadran
    Caja, el banco, Gastos, Contabilidad y los reportes.
- Gasto y egreso van juntos: si el egreso no se pudo registrar, el gasto se
  cancela solo y se avisa.
- **Cancelar el gasto** original o **anular la compra** cancela también su
  comisión (gasto y egreso). Los pagos de Cuentas por pagar no se anulan en
  el sistema, así que su comisión se cancela desde Gastos si hiciera falta.
- Pieza común: `comision-pago-tarjeta.js` (una sola lógica para los tres
  módulos).

### Base (solo agrega; aplicada)
Migración `20261022_comision_pago_tarjeta_egresos.sql`: columnas opcionales
`gastos.origen_tipo` y `gastos.origen_id`, con índice.

### Pruebas
- **Base real (revertida):** gasto con tarjeta de C$ 200 más comisión de
  C$ 6.
  - Caja pasa de 1,000 a 794 y Gastos suma 206.
  - Al cancelar el gasto vuelve a 1,000, sin nada activo.
- **Pantallas reales sobre `main` (Chromium):** 4 pruebas.
  - En Gastos, la comisión está apagada por defecto; marcada se guarda
    ligada al gasto; cancelar el gasto la cancela; con transferencia no
    aparece.
  - Compra directa con comisión de 2.5 %, anulada después.
  - Pago de Cuentas por pagar con comisión de 3 %.
  - Compra normal, completar compra, prima y pago de gasto programado: la
    opción solo aparece con tarjeta.
  - Junto con las 5 pruebas de Ventas: 9 de 9.

## Paquete para publicar en `main`
`docs/publicar-main-comisiones.patch` trae todo junto: corrección de Ventas,
comisión opcional en egresos y las dos migraciones (ya aplicadas en la base).
Se verificó que aplica limpio sobre `main` (`e32bc49`). Desde una copia de
`main`:
```
git apply escritorio/docs/publicar-main-comisiones.patch
git add -A && git commit -m "Comisiones bancarias: ventas solo con tarjeta; opcional en egresos; lotes una vez"
git push origin main
```
