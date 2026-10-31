-- Ciclo opcional (Fase 3b): crear las órdenes de producción solas al aprobar una proforma.
-- SOLO AGREGA una opción apagada por defecto. Usa la misma función de servidor de siempre
-- (proforma_pasar_a_produccion), que ya evita duplicados y exige "Pedidos con producción" activo.
alter table public.configuracion_empresa
  add column if not exists usa_orden_auto_al_aprobar boolean not null default false;
