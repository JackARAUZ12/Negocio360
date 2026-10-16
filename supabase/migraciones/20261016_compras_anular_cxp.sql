-- =====================================================================
-- COMPRAS: al anular una compra a crédito, su cuenta por pagar también se anula
-- Fecha: 16-oct-2026 · Todas las cuentas · No cambia ningún dato existente
--
-- PROBLEMA REAL: el botón "Anular" de Compras devolvía el inventario y el
-- dinero de Caja, pero la deuda con el proveedor (cuenta por pagar) seguía
-- viva y su asiento seguía en Contabilidad. Ej.: All Plastic Mayorista,
-- compra C-000080 anulada el 14-ago y su CXP-000074 (C$3,900) seguía "vencida".
--
-- QUÉ HACE:
--  1. Agrega el estado "anulado" a las cuentas por pagar.
--  2. Cuando una compra pasa a "anulada", su cuenta por pagar SIN pagos
--     queda "anulado", con saldo 0 (y sus cuotas en 0), y su asiento
--     "Cuenta por pagar" se anula con el motivo. Nada se borra.
--     Si la cuenta ya tiene pagos, no se toca (la pantalla de Compras ya
--     no deja anular esa compra: primero hay que resolver esos pagos).
-- =====================================================================

alter table public.cuentas_por_pagar drop constraint if exists cuentas_por_pagar_estado_check;
alter table public.cuentas_por_pagar add constraint cuentas_por_pagar_estado_check
  check (estado = any (array['pendiente'::text, 'vencido'::text, 'pagado'::text, 'anulado'::text]));

create or replace function public.compras_anular_cxp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
begin
  select array_agg(p.id) into ids
    from public.cuentas_por_pagar p
   where p.compra_id = new.id
     and p.auth_user_id = new.auth_user_id
     and p.estado <> 'anulado'
     and coalesce(p.monto_pagado, 0) <= 0
     and not exists (select 1 from public.cuentas_por_pagar_pagos x where x.cuenta_id = p.id);

  if ids is null then return new; end if;

  update public.cuentas_por_pagar
     set estado = 'anulado', saldo_pendiente = 0, updated_at = now(),
         observaciones = trim(coalesce(observaciones, '') || ' [Anulada: la compra ' || coalesce(new.numero, '') || ' se anuló]')
   where id = any(ids);

  update public.cuentas_por_pagar_cuotas
     set saldo = 0, updated_at = now()
   where cuenta_id = any(ids);

  update public.asientos_contables
     set estado = 'anulado', anulado_en = now(),
         anulado_motivo = 'Compra ' || coalesce(new.numero, '') || ' anulada: su cuenta por pagar ya no existe (anulado automáticamente)'
   where referencia_tipo = 'cxp_generada'
     and referencia_id = any(ids)
     and estado <> 'anulado';

  return new;
end;
$$;

drop trigger if exists trg_compras_anular_cxp on public.compras;
create trigger trg_compras_anular_cxp
  after update of estado on public.compras
  for each row
  when (new.estado = 'anulada' and old.estado is distinct from 'anulada')
  execute function public.compras_anular_cxp();
