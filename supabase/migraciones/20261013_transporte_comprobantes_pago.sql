-- Transporte: comprobantes de pago (foto o PDF) en anticipos/costos del viaje, liquidaciones de conductores
-- y pagos a transportistas externos. Reutilizan transporte_documentos; solo se amplía la lista de
-- tipos de registro permitidos. No cambia ni borra ningún documento existente. Ya aplicada.
alter table public.transporte_documentos drop constraint if exists transporte_documentos_entidad_tipo_check;
alter table public.transporte_documentos add constraint transporte_documentos_entidad_tipo_check
  check (entidad_tipo = any (array['unidad','conductor','orden','incidencia','costo','liquidacion','subcontratacion']::text[]));
