-- =====================================================================
-- CONTABILIDAD › Contabilización automática — la base acepta TODAS las reglas
-- que ofrece la pantalla. 17-oct-2026 · Solo amplía una lista; no cambia datos.
--
-- PROBLEMA REAL: la base solo aceptaba 14 tipos de regla, pero la pantalla
-- ofrece 27. Las otras 13 (IVA/impuestos, retenciones de IR, aportes
-- patronales, faltantes/sobrantes de caja, ajustes de inventario, costo de
-- servicios…) NUNCA se guardaban, y la pantalla decía "Configuración
-- guardada" igual. También agrega la regla nueva 'descuento_credito'
-- (descuentos/rebajas a créditos de clientes).
-- =====================================================================
alter table public.contabilidad_mapeo_cuentas drop constraint if exists contabilidad_mapeo_cuentas_tipo_transaccion_check;
alter table public.contabilidad_mapeo_cuentas add constraint contabilidad_mapeo_cuentas_tipo_transaccion_check
  check (tipo_transaccion = any (array[
    'venta', 'iva_ventas', 'impuesto_ventas_otros', 'retencion_ir_clientes', 'pago_retenciones_ir', 'pago_impuestos',
    'nomina_deducciones_ley', 'aporte_patronal', 'credito_otorgado', 'pago_credito', 'descuento_credito',
    'costo_ventas', 'costo_servicios', 'retencion_ir', 'gasto', 'iva_gastos', 'compra', 'cxp_generada', 'pago_cxp',
    'pago_salario', 'capital_inicial', 'credito_existente', 'inventario_inicial',
    'ajuste_inventario_entrada', 'ajuste_inventario_salida', 'faltante_caja', 'sobrante_caja'
  ]::text[]));
