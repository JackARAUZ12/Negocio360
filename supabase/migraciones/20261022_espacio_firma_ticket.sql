-- Espacio para la firma del cliente en la factura de crédito (ticket).
-- Columna nueva, opcional: null = "normal" (como estaba). No toca datos existentes.
alter table public.configuracion_venta_rapida
  add column if not exists espacio_firma_ticket text;
-- Valores usados por la pantalla: 'normal' | 'amplio' | 'extra'
