-- ESTADO: APLICADA y probada con rollback (tarifa>100, monto sin tarifa, IVA excesivo, negativo y suma mayor se rechazan; venta mixta, con otros impuestos y normal pasan).
-- CANDADOS del IVA por línea (columnas iva_tarifa / iva_monto de venta_detalles). Solo actúan cuando una línea trae esos datos
-- (únicamente ventas con tarifas distintas por producto); las líneas sin ellos (todo lo existente) no se revisan ni cambian.
--  1) Por línea: tarifa y monto van juntos; tarifa entre 0 y 100; monto no negativo y no mayor que (subtotal × tarifa).
--  2) Por venta (se revisa al terminar de guardar): la suma del IVA de las líneas no puede ser mayor que el impuesto de la venta.
create or replace function public._n360_chk_iva_linea()
returns trigger language plpgsql security definer set search_path = public as $f$
begin
  if new.iva_tarifa is null and new.iva_monto is null then return new; end if;
  if new.iva_tarifa is null or new.iva_monto is null then
    raise exception 'IVA de la línea incompleto: la tarifa y el monto van juntos';
  end if;
  if new.iva_tarifa < 0 or new.iva_tarifa > 100 then raise exception 'La tarifa de IVA de una línea debe estar entre 0 y 100'; end if;
  if new.iva_monto < 0 then raise exception 'El IVA de una línea no puede ser negativo'; end if;
  if coalesce(new.subtotal, 0) >= 0 and new.iva_monto > round(coalesce(new.subtotal, 0) * new.iva_tarifa / 100, 2) + 0.02 then
    raise exception 'El IVA de una línea (%) es mayor que su tarifa (%) sobre su subtotal', new.iva_monto, new.iva_tarifa;
  end if;
  return new;
end $f$;
revoke all on function public._n360_chk_iva_linea() from public, anon, authenticated;
drop trigger if exists trg_n360_chk_iva_linea on public.venta_detalles;
create trigger trg_n360_chk_iva_linea before insert or update of iva_tarifa, iva_monto, subtotal on public.venta_detalles
  for each row execute function public._n360_chk_iva_linea();

create or replace function public._n360_chk_iva_suma()
returns trigger language plpgsql security definer set search_path = public as $f$
declare s numeric; imp numeric;
begin
  select coalesce(sum(iva_monto), 0) into s from public.venta_detalles where venta_id = new.venta_id;
  select coalesce(impuesto, 0) into imp from public.ventas where id = new.venta_id;
  if s > imp + 0.01 then
    raise exception 'El IVA de las líneas (%) es mayor que el impuesto de la venta (%)', s, imp;
  end if;
  return null;
end $f$;
revoke all on function public._n360_chk_iva_suma() from public, anon, authenticated;
drop trigger if exists trg_n360_chk_iva_suma on public.venta_detalles;
create constraint trigger trg_n360_chk_iva_suma after insert or update of iva_monto on public.venta_detalles
  deferrable initially deferred for each row when (new.iva_monto is not null)
  execute function public._n360_chk_iva_suma();
