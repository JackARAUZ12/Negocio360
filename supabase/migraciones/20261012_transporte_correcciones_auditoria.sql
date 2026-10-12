-- Transporte · correcciones de auditoría (ya aplicadas en la base).
-- 1) La evidencia de incidencias guarda entidad_tipo = 'incidencia': se amplía la restricción existente.
alter table public.transporte_documentos drop constraint if exists transporte_documentos_entidad_tipo_check;
alter table public.transporte_documentos add constraint transporte_documentos_entidad_tipo_check
  check (entidad_tipo = any (array['unidad'::text,'conductor'::text,'orden'::text,'incidencia'::text]));
-- 2) Las políticas de las tablas de Fases 11 y 12 pasan a rol authenticated (igual que el resto de Transporte).
alter policy p_transporte_entregas_all on public.transporte_entregas to authenticated;
alter policy p_transporte_incidencias_all on public.transporte_incidencias to authenticated;
alter policy p_transporte_llantas_all on public.transporte_llantas to authenticated;
alter policy p_transporte_llantas_movs_all on public.transporte_llantas_movs to authenticated;
alter policy p_transporte_mant_ordenes_all on public.transporte_mant_ordenes to authenticated;
alter policy p_transporte_mant_planes_all on public.transporte_mant_planes to authenticated;
