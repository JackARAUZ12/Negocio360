-- CAByS EN LAS LÍNEAS DE VENTA (solo cuentas de Costa Rica que venden en colones).
-- La línea guarda su PROPIA copia del CAByS del producto en el momento de vender, para que un cambio posterior
-- del producto no altere ventas ya hechas. Columna nueva y opcional: todo lo existente queda en NULL.
-- Un trigger la llena en cualquier camino que guarde líneas (venta rápida, créditos, delivery, fiados...), sin
-- modificar ninguna función de venta. Si la cuenta no es CR/CRC, o el producto no tiene CAByS, no hace nada.
-- Nunca bloquea una venta: cualquier error interno se ignora.
alter table public.venta_detalles add column if not exists cabys text;

create or replace function public._n360_cabys_linea()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare v_cabys text;
begin
  begin
    if new.cabys is null and new.producto_id is not null then
      if exists (select 1 from public.configuracion_empresa c
                 where c.auth_user_id = new.auth_user_id and c.pais = 'CR' and c.moneda = 'CRC') then
        select p.cabys into v_cabys from public.productos p
         where p.id = new.producto_id and p.auth_user_id = new.auth_user_id;
        if v_cabys is not null and v_cabys ~ '^[0-9]{13}$' then new.cabys := v_cabys; end if;
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end
$f$;
revoke all on function public._n360_cabys_linea() from public, anon, authenticated;

drop trigger if exists trg_n360_cabys_linea on public.venta_detalles;
create trigger trg_n360_cabys_linea before insert on public.venta_detalles
  for each row execute function public._n360_cabys_linea();
