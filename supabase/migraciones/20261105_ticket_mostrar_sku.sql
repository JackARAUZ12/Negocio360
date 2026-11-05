-- Ticket: mostrar el SKU (código) de cada producto debajo de su nombre (05-nov-2026). Apagado por defecto.
alter table public.configuracion_venta_rapida add column if not exists mostrar_sku_ticket boolean not null default false;
