-- =====================================================================
-- CANDADO: una venta no se puede guardar dos veces con el mismo número
-- Fecha: 16-oct-2026 · Todas las cuentas · No cambia ni borra ningún dato
--
-- PROBLEMA REAL: un doble clic en "Confirmar venta" (o volver a darle
-- mientras la primera todavía se guardaba) registraba DOS ventas con el
-- mismo número, cada una con su dinero en Caja y su salida de inventario.
-- Casos: All Plastic Comercial V-000894 y V-000960 (agosto), NOSSA
-- V-000205 (8-oct) y Leon Pharma V-000176 (15-oct, en "Corregir venta").
--
-- QUÉ HACE:
--  1. Aviso claro (trigger): si ya hay una venta COMPLETADA con ese número
--     en la misma cuenta, no deja guardar otra y explica por qué.
--  2. Candado firme (índice único): aunque las dos lleguen al mismo
--     instante, la base de datos solo acepta una.
--  Solo cuenta las ventas COMPLETADAS: si una venta quedó anulada (por
--  ejemplo, se anuló sola porque sus productos no se guardaron), se puede
--  volver a registrar con ese número, igual que hoy.
--
--  Las 3 copias viejas que ya existen quedan fuera del candado (no se
--  tocan; se revisan con cada cliente): no se anula ni se cambia nada.
-- =====================================================================

create or replace function public.ventas_numero_unico_chk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'completada' and new.numero_venta is not null
     and (tg_op = 'INSERT'
          or old.estado is distinct from new.estado
          or old.numero_venta is distinct from new.numero_venta)
     and exists (select 1 from public.ventas v
                  where v.auth_user_id = new.auth_user_id
                    and v.numero_venta = new.numero_venta
                    and v.estado = 'completada'
                    and v.id <> new.id) then
    raise exception 'La venta % ya está guardada, no se registró otra vez. Revisa la lista de Ventas antes de volver a intentarlo.', new.numero_venta
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ventas_numero_unico on public.ventas;
create trigger trg_ventas_numero_unico
  before insert or update of estado, numero_venta on public.ventas
  for each row execute function public.ventas_numero_unico_chk();

create unique index if not exists ventas_numero_unico_completada
  on public.ventas (auth_user_id, numero_venta)
  where estado = 'completada'
    and numero_venta is not null
    and id not in ('bc4a3890-36ac-49c4-848b-e24245a4bd26',   -- All Plastic Comercial V-000894 (copia)
                   '44a19e99-2579-4339-b344-60314b61d7d3',   -- All Plastic Comercial V-000960 (la vacía)
                   'd496920b-f366-4d70-8ae8-f9afaa0088b2');  -- Leon Pharma V-000176 (copia)
