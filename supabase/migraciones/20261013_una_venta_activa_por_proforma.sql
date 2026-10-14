-- Candado en la base de datos: una proforma solo puede tener UNA venta activa.
-- Aunque dos pestañas/dispositivos conviertan a la vez, la segunda es rechazada y
-- proformas.js avisa "ya tiene una venta activa" sin crear nada.
--
-- Seguridad:
--  * No modifica ni borra ninguna venta existente.
--  * Solo aplica a ventas creadas desde 2026-10-13: hay ventas duplicadas viejas
--    (sep/2026) en ALL PLASTIC que se revisan aparte con el cliente.
--  * Una venta ANULADA no cuenta (estado <> 'completada'), así que anular y volver a
--    convertir sigue funcionando.
create unique index if not exists ventas_una_activa_por_proforma
  on public.ventas (auth_user_id, proforma_id)
  where proforma_id is not null
    and estado = 'completada'
    and created_at >= timestamptz '2026-10-13 00:00:00+00';
