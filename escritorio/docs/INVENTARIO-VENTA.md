# Inventario: qué hace hoy una venta (para replicarlo exacto en el servidor)

Fuente: `ventas.js` de la rama `main` al 2026-10-21 (`ventas.js?v=20261021a`),
`caja-segura.js`, y la base de producción (triggers y funciones leídos en solo
lectura). Esta es la referencia obligatoria de la Fase 2
(`offline_registrar_venta`): cada fila que hoy escribe el navegador debe salir
**idéntica** (mismas columnas, mismos textos, mismos redondeos) para que Caja,
Bancos, Impuestos, Reportes y Contabilidad no noten la diferencia.

Hay dos flujos que guardan ventas de contado:

| Flujo | Función | Pantalla |
|---|---|---|
| **Nueva venta** (asistente) | `_confirmarVentaInterno()` (ventas.js ~5697) | botón "Cerrar venta" / "Cerrar venta e imprimir" |
| **Venta rápida** (escáner) | `_confirmarVentaRapidaInterno()` (ventas.js ~7301) | botón "Cobrar y cerrar venta" |

El modo sin conexión cubre **solo contado y pago dividido** (plan, "Reglas de
negocio"). Fiado, crédito, cliente nuevo, corrección de venta, viajes de
Transporte, recetas, consultas veterinarias, canje de puntos y Stock
Compartido **no** van sin conexión: la pantalla los bloquea cuando no hay
internet.

---

## 1. Cálculo del resumen (antes de guardar)

### Nueva venta — `calcularResumen()` (~4592)
Redondeo: `round2(n) = Math.round(n*100)/100` (siempre a 2 decimales).

Por línea (`recalcItem`): si el descuento es por %, `descuento = round2(cant·precio·pct/100)`;
`subtotal = round2(cant·precio − descuento)`; `ganancia = round2(cant·(precio − costo) − descuento)`.

| Campo | Fórmula |
|---|---|
| `subtotal` | `round2(Σ cant·precio)` |
| `descuentoManual` | `round2(Σ descuento de línea)` |
| `descuentoPromociones` | promociones aplicadas a mano (nunca automáticas) |
| `descuentoPuntos` | canje (no aplica sin conexión) |
| `descuento` | `round2(manual + promos + puntos)` |
| `baseImponible` | `max(subtotal − descuento, 0)` |
| `ivaMonto` | `ivaActivo ? round2(base·iva%/100) : 0` |
| `otros[]` | cada impuesto extra: `round2(base·%/100)`, solo los > 0 |
| `impuestos` | `round2(ivaMonto + Σ otros)` |
| `total` | `round2(subtotal − descuento + impuestos)` |
| `retencionIr` | `retIr.activo ? round2(base·%/100) : 0` (no cambia el total) |
| `cobrar` | `round2(total − retencionIr)` |
| `ganancia` | `round2(Σ ganancia de línea) − promos − puntos` |
| `costoTotal` | `round2(Σ cant·costo)` |

### Venta rápida — `calcularResumenVR()` (~7052)
Sin descuentos manuales, sin otros impuestos, sin retención IR.
`base = max(subtotal − promos, 0)`; `impuesto = iva ? round2(base·%/100) : 0`;
`total = round2(subtotal − promos + impuesto)`. IVA según
`configuracion_venta_rapida.iva_activo/iva_porcentaje`.

---

## 2. Escrituras en la base, en orden

> Hoy son **llamadas separadas desde el navegador, sin transacción**: si se
> corta internet a la mitad puede quedar la venta sin caja, o el stock sin
> descontar. `offline_registrar_venta` hará **todo o nada** en una sola
> transacción del servidor.

### Paso A — Cliente rápido (solo Nueva venta, opción "nuevo")
`clientes` insert `{auth_user_id, nombre, telefono, correo, ruc}` (antes busca
uno con el mismo nombre). **Sin conexión: no aplica** (clientes nuevos quedan
para después del piloto). Sin conexión se permite elegir un cliente ya
existente del catálogo local o "Consumidor Final".

### Paso B — Número de venta
`rpc generar_numero_venta(p_user_id)` → `'V-' || lpad(n,6,'0')` usando el
contador `ventas_numeracion.ultimo_numero` (un `insert … on conflict do update
+1`). Si falla: `V-<milisegundos>`.
Trigger `trg_ventas_numero_unico` (`ventas_numero_unico_chk`): rechaza
(`23505`) una venta **completada** con un `numero_venta` ya usado por otra
completada de la misma cuenta → el navegador lo traduce a "La venta … ya
está guardada". **Sin conexión:** bloque reservado por dispositivo (Fase 3,
función nueva que sube `ultimo_numero` en N de una sola vez); si el bloque se
agota, número provisional que el servidor reemplaza.

### Paso C — `ventas` (1 fila)

| Columna | Nueva venta | Venta rápida |
|---|---|---|
| `auth_user_id` | cuenta | cuenta |
| `numero_venta` | Paso B | Paso B |
| `cliente_id` / `cliente_nombre` | elegido / nombre | `null` / `'Consumidor Final'` |
| `fecha` | fecha elegida (por defecto hoy, `YYYY-MM-DD` local) | igual |
| `subtotal`, `descuento` | resumen | `subtotal`, `descuentoPromociones` |
| `impuesto` | `impuestos` (IVA + otros) | `impuesto` |
| `total`, `costo_total` | resumen | resumen |
| `metodo_pago_id` | id del método (null si separado) | igual |
| `metodo_pago_nombre` | nombre, o `Pago separado (Efectivo + Tarjeta)` | igual |
| `creado_por_nombre` | perfil activo (`obtenerNombrePerfilActivo()`) | igual |
| `estado` | `'completada'` | `'completada'` |
| `observaciones` | texto libre o `null` | `'Venta rápida (escáner)'` |
| `categoria` | — | `'venta_rapida'` |
| `iva_activo`, `iva_porcentaje` | sí (`0` si no hay IVA) | sí |
| `retencion_ir_monto`, `retencion_ir_porcentaje` | solo si retención > 0 | — |

Reintento: si el insert con columnas de IVA falla, se reintenta sin ellas
(compatibilidad vieja; en producción las columnas existen).

Triggers de `ventas` que corren solos al insertar (el servidor los hereda
sin hacer nada extra): `trg_puntos_venta_insert` (acumula puntos si la cuenta
usa puntos y hay cliente; nunca rompe la venta), `trg_ventas_numero_unico`,
`trg_ventas_updated_at`/`trg_updated_at`, `trg_ventas_una_activa_por_proforma`,
`trg_ventas_candado_devoluciones`, `trg_ventas_ajustar_asiento_al_editar`
(solo en UPDATE), `trg_ventas_no_anular_credito_con_abonos` (solo UPDATE).

### Paso D — `venta_detalles` (1 fila por línea del carrito)

| Columna | Valor |
|---|---|
| `producto_id` | id del producto; `null` si es combo o promoción |
| `combo_id` / `promocion_id` | id si la línea es combo / promoción |
| `producto_nombre`, `producto_sku` | nombre, sku o `null` |
| `tipo_item` | `'producto'`/`'servicio'` (combo y promoción se guardan como `'producto'`) |
| `cantidad`, `precio`, `costo` | de la línea |
| `descuento`, `subtotal`, `ganancia` | Nueva venta: de `recalcItem`; Venta rápida: `0`, `round2(cant·precio)`, `round2(cant·(precio−costo))` |
| `escala_id`, `escala_nombre` | escala de precio usada o `null` |
| `vendido_sin_stock` | `true` si se vendió por encima del disponible |
| `es_regalia` | `true/false` |
| `presentacion_id/_nombre/_factor` | presentación (caja, docena…) o `null` |
| `lote_id` | solo Nueva venta (lote FEFO elegido) |
| `cantidad_pedida`, `unidad_pedida` | cuando se pidió en unidad menor |

Si el insert falla → `anularVentaIncompleta()` (marca la venta como anulada) y
error. Triggers: `trg_venta_detalles_candado_insert_devoluciones`.

### Paso D-2 — Lote específico (solo Nueva venta, cuentas con farmacia/vet/insumos)
Si la línea trae `loteId`: `producto_lotes.cantidad_actual = max(0, actual − cantidad)`.

### Paso D-3 — Vínculos opcionales (no aplican sin conexión)
`farmacia_recetas.venta_id`, `vet_consultas.venta_id`, `vet_estancias.venta_id`,
`transporte_ordenes.venta_id/facturada_en`, `numeros_serie` (si la cuenta usa
números de serie: `registrarNumerosDeSerie`).

### Paso E — Stock
- **Producto normal** (`tipo='producto'`, no combo): `productos.stock_actual =
  max(0, stock_en_caché − unidadesInventario)` donde `unidadesInventario =
  cantidad × presentacion_factor` (o la cantidad si no hay presentación).
  Nueva venta usa el stock del caché de la pantalla; Venta rápida usa
  `item.stockDisponible`. **Nunca deja stock negativo** (lo topa en 0).
- Si `configuracion_empresa.maneja_lotes_vencimiento = true`:
  `rpc descontar_lote_fefo(producto, unidades)` (descuenta de los lotes que
  vencen primero, sin esperar el resultado).
- **Stock Compartido** (`origenStockId`): `rpc descontar_stock_remoto` en otra
  sucursal; el stock local no se toca. **Desactivado sin conexión.**
- **Combo**: por cada componente (`combo_items`), `stock = max(0, stock_actual
  − cantidad_componente × cantidad_combos)` leyendo el stock actual de la base.
- **Promoción como línea**: por cada `componentesPromo`, `stock = max(0,
  stock_actual − cantidad)` (solo si el componente es `producto`).

Triggers de `productos`: `trg_productos_stock_alerta` (crea/cierra alerta de
stock bajo en `dashboard_alertas`), `trg_sincronizar_producto_grupo` (copia
nombre/precio/costo… a las sucursales; no toca stock), `trg_productos_updated_at`.

### Paso F — Caja (`movimientos_financieros`), excepto fiado
`montoCaja = round2(total − impuestos − retencionIr)` (Venta rápida:
`total − impuesto`, **sin** `round2`).

- **Un solo método:** 1 fila `{tipo_flujo:'INGRESO', tipo_movimiento:'VENTA',
  concepto, monto: montoCaja, metodo_pago_id, metodo_pago_nombre, banco_id
  (si Tarjeta/Transferencia con banco elegido), monto_moneda_banco (monto
  convertido si el banco es de otra moneda), referencia_tipo:'venta',
  referencia_id: venta, observaciones, fecha}`.
  - Concepto Nueva venta: `Venta V-000123` o `Venta V-000123 (neto de IVA)`,
    `(neto de retención IR)`, `(neto de IVA y retención IR)`.
  - Concepto Venta rápida: `Venta rápida V-000123` o `… (neto de IVA)`.
- **Pago dividido:** 1 fila por método con monto > 0. Reparto:
  `ratio = montoCaja / base` (base = `cobrar` en Nueva venta, `total` en
  Venta rápida); cada línea `round2(monto_linea × ratio)` y la **última se
  lleva el resto** (`round2(montoCaja − asignado)`) para cuadrar exacto.
  Concepto: `Venta V-000123 — Tarjeta (pago separado)` /
  `Venta rápida V-000123 — Tarjeta (pago separado)`. `monto_moneda_banco =
  _psMontoBanco(linea)`; observación con `_psNota(linea)` si pagó en otra
  moneda (`Efectivo: pagó USD 10.00 (tasa C$ 36.62)`).
- `saldo_anterior/saldo_resultante`: el navegador manda un valor de cortesía,
  pero el **servidor lo recalcula** (trigger `trg_00_encadenar_saldo`, con
  candado por cuenta). Otros triggers: `trg_actualizar_cierres_al_agregar_movimiento`,
  `trg_mf_saldo_al_cambiar_estado`, `trg_movimientos_updated_at`.
- Inserción con `N360CajaSegura.insertarMovimiento`: hasta 3 intentos,
  revisando antes de reintentar si ya existe (mismo `referencia_id`,
  `tipo_flujo`, `concepto`); si no se pudo, queda en una cola del navegador.
- Luego `ventas.referencia_caja = id del último movimiento`.
- **Comisión bancaria** (`registrarComisionBancaria`): solo si hay banco
  elegido (`bancoElegidoId`) y comisión > 0:
  1. `gastos` `{concepto: 'Comisión bancaria 3% — BAC (Venta V-000123)',
     categoria:'Comisiones bancarias', monto, fecha, tipo:'operativo',
     estado:'activo', observaciones:'Generado automáticamente por la venta …'}`;
  2. `movimientos_financieros` EGRESO/`GASTO` con el mismo concepto, banco y
     `referencia_tipo:'venta'`;
  3. `ventas.comision_porcentaje / comision_monto`.

### Paso F-2 — Impuestos (`movimientos_impuestos`), si `impuestos > 0`
- IVA: `{tipo_movimiento:'IVA_VENTA', concepto:'IVA de venta V-000123',
  monto: ivaMonto, saldo_anterior, saldo_resultante (= anterior + monto, leído
  del último movimiento de la cuenta, **sin** candado ni trigger),
  referencia_venta_id, fecha: hoy}` (ojo: `fecha` = **hoy**, no la fecha de
  la venta).
- Cada impuesto extra: igual con `concepto: '<Nombre> de venta V-000123'`,
  `impuesto_id`, `impuesto_nombre`; y además `venta_impuestos` (1 fila por
  impuesto: `impuesto_id, nombre, porcentaje, monto`).
- Venta rápida: solo IVA.

### Paso F-3 — Retención IR a favor (Nueva venta, no fiado)
`retenciones_ir` `{lado:'a_favor', origen:'venta', venta_id, estado:'pendiente',
contraparte_nombre, fecha, base: round2(max(subtotal − descuento, 0)),
porcentaje, monto}`.

### Paso G — Cliente (Nueva venta con cliente)
`clientes.total_compras += total`, `num_compras += 1` (lee y escribe; no atómico).

### Paso H — Fiado (no aplica sin conexión)
`fiados` insert enlazado a la venta; sin movimiento de caja.

### Después de guardar (no bloquea)
- **Garantías** (`registrarGarantiasAutomaticas`): por cada línea cuyo
  producto/promoción tenga `garantia_meses > 0`: `rpc generar_numero_garantia`
  (`GT-` + conteo+1, no atómico) y `garantias_clientes` `{numero, cliente_id,
  cliente_nombre, producto_id, producto_nombre, venta_id, fecha_compra: hoy,
  garantia_meses, fecha_vencimiento: hoy + meses, origen:'automatica',
  numero_serie}`.
- Puntos ganados (solo muestra), recibo PDF, ticket impreso, recarga de listas,
  aviso al Dashboard por `localStorage('n360_venta_nueva')`.
- **Contabilidad**: no se escribe nada al vender. El generador de
  `contabilidad.js` lee después las ventas `completada` (no crédito/fiado),
  sus detalles (costo de venta) y `movimientos_impuestos` (división del IVA);
  el índice único `asientos_auto_sin_duplicados_sep` evita duplicados. Una
  venta registrada por el servidor con las mismas filas sale igual en
  Contabilidad sin hacer nada adicional.

---

## 3. Anular una venta hoy (`anularVenta`, ~1022)
1. Bloqueos: ya anulada; devoluciones registradas; crédito con abonos; fiado con pagos.
2. Fiado vinculado → `estado:'eliminado'`.
3. Stock: por cada detalle `tipo_item='producto'` con `producto_id`: `stock += cantidad`.
4. `ventas.estado = 'anulada'`.
5. Cliente: `total_compras −= total`, `num_compras −= 1` (mínimo 0).
6. Impuestos: por cada `IVA_VENTA` positivo de la venta, fila de reverso con
   monto negativo y concepto `Reverso de <IVA|nombre> por anulación de venta …`.
7. `retenciones_ir` pendientes → `anulada`.
8. Proforma vinculada vuelve a su estado anterior; crédito vinculado → cancelado.
9. Caja (si la casilla "descontar de Caja" está marcada, por defecto sí):
   `reversarVentaEnCaja` → 1 EGRESO `OTRO_EGRESO` por cada ingreso completado,
   concepto `Reverso por anulación de venta V-000123` (con ` — <método>` si
   eran varias líneas); no duplica si ya existe un reverso.

**Sin conexión** solo se anulan ventas que **aún no subieron** (se borran de
la bandeja local y se devuelve el stock local). Una venta ya subida se anula
con internet, con el flujo de siempre.

---

## 4. Observaciones del flujo actual (no se tocan en `main`)
Detectadas al hacer este inventario. Se documentan para que el dueño decida;
la regla del proyecto es no cambiar `main`.

1. **Sin transacción**: la venta, su caja, el stock y el IVA son llamadas
   separadas; un corte a mitad puede dejar la venta sin caja (CajaSegura lo
   mitiga con una cola local) o sin descontar stock. → `offline_registrar_venta`
   lo hace todo o nada.
2. **Stock no atómico**: se calcula `stock_en_caché − cantidad` y se escribe
   el resultado; si dos cajas venden a la vez, una puede pisar a la otra. →
   el servidor usará `stock_actual = stock_actual − cantidad`.
3. **Posible doble descuento de lotes**: en Nueva venta, si la línea trae un
   lote FEFO (`loteId`) **y** la cuenta tiene `maneja_lotes_vencimiento`,
   se descuenta el lote específico (Paso D-2) y además `descontar_lote_fefo`
   (Paso E). Además D-2 descuenta `cantidad` sin multiplicar por la
   presentación.
4. **Anulación incompleta**: combos y promociones se guardan con
   `tipo_item='producto'` y `producto_id = null`, así que al anular **no**
   se devuelve el stock de sus componentes; tampoco se aplica el factor de
   presentación al devolver, ni se devuelven los lotes, ni se revierte la
   comisión bancaria.
5. **Fecha del IVA**: `movimientos_impuestos.fecha` usa la fecha de hoy aunque
   la venta tenga otra fecha elegida.
6. **Saldo de impuestos** encadenado desde el navegador sin candado (dos cajas
   a la vez pueden calcular el mismo saldo anterior).
7. **Número de garantía** por conteo (`count+1`), puede repetirse si dos
   ventas se guardan a la vez.
8. Venta rápida: `montoCaja` sin `round2` (con IVA puede llevar más de 2
   decimales; el trigger de saldo lo acepta tal cual).
9. **La comisión bancaria nunca se guarda en Gastos** (confirmado en la base
   real y en la Fase 2): la web inserta el gasto con `tipo: 'operativo'`, que
   la restricción `gastos_tipo_check` rechaza (solo acepta `inmediato` o
   `programado`); el error se ignora. Sí queda el egreso en Caja y los campos
   de comisión en la venta. En producción hay 4 comisiones en Caja y 0 en
   Gastos.

**Confirmados en la Fase 2** (comparando la web real contra la base real): el
punto 3 (una venta de 4 unidades de un producto con lote dejó el lote en
12 de 20 en vez de 16) y el punto 9. La bitácora de auditoría de la web anota
también las operaciones que fallan (p. ej. el gasto de comisión).

Para que las ventas sin conexión cuadren **centavo por centavo** con las de la
web, la Fase 2 guarda las MISMAS filas (las arma el propio código de
`ventas.js`) y solo cambia lo necesario para no perder ni duplicar:
transacción única, idempotencia por UUID, descuentos de stock atómicos, la
regla de "vendido sin stock" del plan (stock negativo marcado + alerta, nunca
rechazar una venta cobrada), saldo de Impuestos con candado y lotes
descontados una sola vez (punto 3). El punto 9 se replica igual que la web
real (sin gasto). Ver `docs/PAQUETE-VENTA.md`.
