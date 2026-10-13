-- Transporte: cabezal + furgón/remolque (dos placas) y tipo de unidad.
-- Solo AGREGA columnas vacías; no cambia ningún dato existente. Ya aplicada.
--   transporte_subcontratistas.placa_habitual  = placa del cabezal (ya existía)
--   transporte_subcontratistas.tipo_unidad     = tipo del cabezal (ya existía, sin usar)
alter table public.transporte_subcontratistas add column if not exists placa_furgon text;
alter table public.transporte_subcontratistas add column if not exists tipo_furgon text;
--   transporte_subcontrataciones.placa         = placa del cabezal (ya existía)
alter table public.transporte_subcontrataciones add column if not exists placa_furgon text;
alter table public.transporte_subcontrataciones add column if not exists tipo_unidad text;
alter table public.transporte_subcontrataciones add column if not exists tipo_furgon text;
-- Conductor: furgón/remolque asignado además de su cabezal (unidad_asignada_id)
alter table public.transporte_conductores add column if not exists remolque_asignado_id uuid;
