-- Transporte · Fase 2 del tracking: cobro de la demora.
-- 1) Tarifa por día de demora (opcional) en la orden. Aditivo: las órdenes existentes quedan en NULL.
-- 2) Candado: un viaje ya cobrado (venta no anulada) no puede cambiar flete, recargos ni total.
alter table public.transporte_ordenes add column if not exists demora_tarifa_dia numeric(14,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transporte_ordenes_demora_tarifa_chk') then
    alter table public.transporte_ordenes add constraint transporte_ordenes_demora_tarifa_chk
      check (demora_tarifa_dia is null or (demora_tarifa_dia >= 0 and demora_tarifa_dia <= 100000000));
  end if;
end $$;

create or replace function public.tx_orden_cobrada_no_cambia_monto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.venta_id is not null
     and (new.total is distinct from old.total or new.flete is distinct from old.flete or new.recargos is distinct from old.recargos)
     and exists (select 1 from public.ventas v where v.id = old.venta_id and v.estado <> 'anulada') then
    raise exception 'Este viaje ya está cobrado: su monto no se puede cambiar. Anula la venta primero si necesitas corregirlo.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_tx_orden_cobrada_no_cambia_monto on public.transporte_ordenes;
create trigger trg_tx_orden_cobrada_no_cambia_monto before update on public.transporte_ordenes
  for each row execute function public.tx_orden_cobrada_no_cambia_monto();
