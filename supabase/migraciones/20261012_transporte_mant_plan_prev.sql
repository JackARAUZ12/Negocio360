-- Transporte · Mantenimiento: guarda el último servicio previo del plan para poder revertirlo al anular una orden cerrada.
-- Solo agrega columnas (no modifica datos existentes).
alter table public.transporte_mant_ordenes
  add column if not exists plan_prev_set boolean not null default false,
  add column if not exists plan_prev_km numeric,
  add column if not exists plan_prev_fecha date;
