-- Protección en la base de datos contra asientos automáticos duplicados.
-- Un mismo movimiento (venta, compra, gasto, cierre de caja…) solo puede tener UN asiento automático.
-- Aunque dos dispositivos generen a la vez, la base rechaza el segundo y el generador lo salta
-- (contabilidad.js ya hace `if (errA || !asiento) continue;`).
--
-- Seguridad:
--  * No modifica ni borra ningún asiento existente.
--  * Solo aplica a asientos creados desde 2026-09-01. Hay duplicados viejos (28/08/2026) en una cuenta
--    (ALL PLASTIC COMERCIAL); no se tocan, y por eso la restricción no mira hacia atrás.
--  * Excluye 'activo_fijo': la depreciación mensual repite legítimamente el mismo activo en varios asientos.
--  * No afecta a los asientos manuales (origen distinto de 'automatico').
-- (Ya aplicada. Antes se creó asientos_auto_sin_duplicados con corte 2026-10-13 21:45 UTC; queda redundante e inofensiva.)
create unique index if not exists asientos_auto_sin_duplicados_sep
  on public.asientos_contables (auth_user_id, referencia_tipo, referencia_id)
  where origen = 'automatico'
    and referencia_id is not null
    and referencia_tipo <> 'activo_fijo'
    and created_at > timestamptz '2026-09-01 00:00:00+00';
