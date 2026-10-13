-- Costo promedio ponderado (opcional, apagado por defecto). Solo agrega columnas con valor por defecto;
-- no cambia ningun dato existente.
alter table public.configuracion_empresa add column if not exists costo_promedio_activo boolean not null default false;
alter table public.detalle_compras add column if not exists costo_antes numeric;
alter table public.detalle_compras add column if not exists costo_despues numeric;
