# Paquete de una venta sin conexión (`offline_registrar_venta`, versión 1)

Contrato entre el programa (Fase 3) y el servidor (Fase 2).

## Cómo se arma
El programa ejecuta el **código real de `ventas.js`** (el mismo botón
"Cerrar venta" / "Cobrar") con un cliente de Supabase "grabador" que, en vez de
mandar cada escritura por internet, la anota. `src/compartido/registro-a-payload.js`
convierte esas anotaciones en este paquete. Así la venta lleva exactamente las
filas que habría guardado la web.

## Campos
| Campo | Qué es |
|---|---|
| `version` | `1` |
| `uuid` | identificador único de la venta en el equipo (clave para no duplicar) |
| `dispositivo_uid` | equipo registrado con `offline_registrar_dispositivo` |
| `tipo` | `nueva` o `rapida` |
| `fecha_hoy` | fecha del equipo al vender (la web la usa para IVA y garantías) |
| `vendida_en` | hora del equipo al vender |
| `reloj_envio` | hora del equipo al enviar (para corregir un reloj mal puesto); no cuenta para la huella |
| `venta` | la fila de `ventas` tal como la arma la web (sin `id`, `auth_user_id`, `referencia_caja`) |
| `detalles[]` | filas de `venta_detalles` |
| `caja[]` | ingresos de Caja (uno por método en pago dividido): concepto, monto, método, banco, monto en moneda del banco, observaciones, fecha |
| `comision` | `{banco_id, porcentaje, monto, gasto, movimiento}` si hubo comisión bancaria (solo pagos con tarjeta). El servidor guarda un gasto ligado a la venta y su egreso de Caja ligado al gasto |
| `impuestos[]` | movimientos de Impuestos (IVA y otros): concepto, monto, impuesto, fecha |
| `venta_impuestos[]` | detalle de otros impuestos de la venta |
| `retencion` | retención de IR a favor, si aplica |
| `garantias[]` | garantías automáticas (sin número: lo pone el servidor) |
| `auditoria[]` | filas de la bitácora que deja `auditoria-guard.js` |
| `componentes_promo{}` | por índice de línea: productos y cantidades de una promoción |
| `precios_catalogo{}` | por índice de línea: precio que tenía el catálogo del equipo (para avisar si cambió) |

## Lo que decide el servidor
Cuenta (`auth.uid()`), estado `completada`, número de venta (si el del equipo
ya existe o es provisional, asigna uno nuevo y lo cambia también en conceptos,
observaciones y bitácora), stock (resta atómica; negativo = "vendido sin
stock" + alerta), lotes (una vez: el indicado o FEFO), saldos de Caja (trigger
existente) e Impuestos, total del cliente, número de garantía, hora real de la
venta. Toda referencia (cliente, producto, combo, promoción, método, banco,
impuesto, lote, presentación, escala) que no sea de la cuenta se deja vacía.

## Respuestas
- Éxito: `{ok, venta_id, numero_venta, numero_reemplazado, alertas[], repetida}`.
  Si la misma venta llega otra vez, devuelve el resultado de la primera con
  `repetida: true` (no se duplica nada).
- Errores (`N360_OFFLINE:<código>`): `no_autorizado`, `cuenta_demo`,
  `no_habilitado`, `formato`, `uuid_invalido`, `uuid_reutilizado` (mismo UUID
  con otro contenido), `dispositivo_no_autorizado`, `tipo_invalido`,
  `tipo_no_permitido` (fiado/crédito), `linea_invalida`. Con cualquier error
  **no queda nada** guardado (todo o nada) y la venta sigue en el equipo.

## Alertas (`offline_alertas`)
`stock_negativo`, `precio_distinto`, `producto_inactivo`, `reloj_desfasado`
(más de 10 min), `numero_reemplazado`, `totales_distintos` (Caja ≠ total neto),
`fecha_fuera_de_rango`. Se marcan como revisadas con
`offline_marcar_alerta_revisada(id)`.
