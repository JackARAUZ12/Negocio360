-- Opción "Imprimir directo con RawBT (Android, papel 80 mm)".
-- Columna nueva con valor por defecto false: nadie cambia hasta que la active. No toca datos existentes.
alter table public.configuracion_venta_rapida
  add column if not exists imprimir_rawbt boolean not null default false;
