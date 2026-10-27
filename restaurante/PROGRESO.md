# Restaurante — avance

## Auditoría (2026-10-27)
Tres pantallas (Mesas, Comandas, Cocina). Hallazgos principales: el cobro no creaba venta (iba directo a
Caja, inventario e IVA, sin pasar por Ventas), podía cobrarse dos veces, no era atómico, la propina
entraba como venta, "dividir" solo calculaba, lo pedido después de enviar no llegaba a cocina, y se podían
borrar platillos ya en cocina sin rastro. Plan por fases: 1) dinero, 2) Panel con plano del salón y
tiempo real, 3) comodidades (menú por categorías, notas, cambiar/unir mesas, para llevar, reportes).

## Fase 1 — cobro con candados (2026-10-27)
- **Cobro como venta real** con el motor de Ventas (`ventas.html?rest_cobro=1&motor=1`, mismo de Clínica):
  pantalla propia `restaurante-cobro.js`. Ventas solo lo activa con `usa_modulo_restaurante`.
- **Servidor** (`supabase/migraciones/20261028_restaurante_fase1_cobro.sql`, solo agrega):
  `restaurante_cobros`; columnas `venta_id`, `cobro_id`, `ronda`, `motivo_cancelacion`, `cancelado_por`
  en platillos y `ronda_actual` en comandas; funciones `restaurante_cobro_reservar` (aparta y parte
  líneas), `_confirmar` (liga la venta, cierra la mesa y la pasa a limpieza), `_propina` (una sola vez),
  `_liberar`; candados por trigger (platillo cobrado o en cobro no se cambia ni se quita; mesa con cobros
  no se cancela). Probado en transacción revertida (dos cobros 380 + 430 = Caja 810, propina 50 aparte,
  inventario exacto, todos los candados) y aplicado.
- **Ventas**: `aplicarCobroRestaurante`, candado antes de registrar y ligado después (aislado).
- **Propina**: Caja · OTRO_INGRESO "Propina — Mesa N (para el personal)", referencia `restaurante_propina`.
- **Rondas** a cocina y **quitar con motivo** (Comandas y Cocina).
- Las 3 comandas cobradas antes (sin venta) no se tocaron.
- Pruebas: `restaurante/pruebas/navegador.js` 85 en verde (computadora y 360 px, pago dividido, propina,
  cierre, candados, rondas, motivo, **cuadre idéntico a una venta directa**, módulo apagado); Clínica 615 y
  72 unitarias en verde con regresión de Ventas contra `main`. Asesor de seguridad: solo el aviso esperado.
