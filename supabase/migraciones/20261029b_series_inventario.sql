-- Series registradas desde inventario existente (sin compra): también vuelven a "en stock"
-- cuando la venta se anula o se elimina. Antes solo aplicaba a las que tenían compra_id.
-- Las series viejas (estado vacío) siguen sin tocarse.
create or replace function public.series_proveedor_liberar_anulada()
returns trigger language plpgsql as $$
begin
  if new.estado = 'anulada' and coalesce(old.estado, '') <> 'anulada' then
    begin
      update public.numeros_serie
         set estado = 'en_stock', venta_id = null, cliente_id = null, fecha_venta = null, updated_at = now()
       where venta_id = new.id and estado = 'vendida';
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

create or replace function public.series_proveedor_liberar_eliminada()
returns trigger language plpgsql as $$
begin
  begin
    update public.numeros_serie
       set estado = 'en_stock', venta_id = null, cliente_id = null, fecha_venta = null, updated_at = now()
     where venta_id = old.id and estado is not null;
  exception when others then
    null;
  end;
  return old;
end $$;
