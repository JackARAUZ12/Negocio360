-- Bitácora del selector de cuenta (Central / sucursales / bodegas del mismo grupo).
-- Aditivo: tabla nueva, con seguridad por filas y SIN políticas (solo el servidor escribe/lee).
create table if not exists public.grupo_cambios_log (
  id uuid primary key default gen_random_uuid(),
  central_auth_id uuid not null,
  desde_auth_id uuid not null,
  hacia_auth_id uuid not null,
  hacia_nombre text,
  created_at timestamptz not null default now()
);
alter table public.grupo_cambios_log enable row level security;
