-- ============================================================
-- Comisión OPCIONAL por pagar con tarjeta en egresos (Gastos, Compras,
-- Cuentas por pagar). SOLO AGREGA: dos columnas opcionales en "gastos"
-- para ligar la comisión con la operación que la originó, así se anula
-- junto con ella (gasto cancelado, compra anulada).
--   origen_tipo: 'gasto' | 'compra' | 'pago_cxp' | 'prima_cxp'
--   origen_id:   id de esa operación
-- Nada existente cambia: para el resto del sistema son columnas vacías.
-- ============================================================
alter table public.gastos add column if not exists origen_tipo text;
alter table public.gastos add column if not exists origen_id uuid;
create index if not exists gastos_origen_idx on public.gastos (auth_user_id, origen_tipo, origen_id) where origen_id is not null;
