-- ⚠ PENDIENTE DE APLICAR: este archivo NO está aplicado todavía en la base (la herramienta esperó una confirmación que no llegó). No asumir que existe.
-- 1) IVA POR DEFECTO SEGÚN EL PAÍS. Hasta hoy toda cuenta nacía con IVA 15% (el de Nicaragua), también las de Costa Rica (13%).
--    Ahora, cuando una cuenta se crea o cambia a un país VERIFICADO de paises_config cuyo IVA es distinto de 15, y su IVA por defecto
--    sigue siendo el 15 original (nadie lo tocó), se pone el del país. Nicaragua (15) no cambia. Nunca bloquea el guardado.
create or replace function public._n360_iva_defecto_pais()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare v numeric;
begin
  begin
    if new.pais is not null and (tg_op = 'INSERT' or old.pais is distinct from new.pais) then
      select p.iva_porcentaje into v from public.paises_config p
       where p.codigo = new.pais and p.verificado is true and p.iva_porcentaje is not null;
      if v is not null and v <> 15 and coalesce(new.iva_porcentaje_default, 15) = 15 then
        new.iva_porcentaje_default := v;
        update public.impuestos set valor = v
         where auth_user_id = new.auth_user_id and categoria = 'iva' and valor = 15 and es_base is true;
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end
$f$;
revoke all on function public._n360_iva_defecto_pais() from public, anon, authenticated;
drop trigger if exists trg_n360_iva_defecto_pais on public.configuracion_empresa;
create trigger trg_n360_iva_defecto_pais before insert or update of pais on public.configuracion_empresa
  for each row execute function public._n360_iva_defecto_pais();

-- Cuenta(s) de Costa Rica ya creadas con el 15 original y SIN ventas: se corrigen a 13 (autorizado por el dueño del sistema).
update public.configuracion_empresa c set iva_porcentaje_default = 13
 where c.pais = 'CR' and c.iva_porcentaje_default = 15
   and not exists (select 1 from public.ventas v where v.auth_user_id = c.auth_user_id);
update public.impuestos i set valor = 13
 where i.categoria = 'iva' and i.valor = 15 and i.es_base is true
   and exists (select 1 from public.configuracion_empresa c where c.auth_user_id = i.auth_user_id and c.pais = 'CR' and c.iva_porcentaje_default = 13)
   and not exists (select 1 from public.ventas v where v.auth_user_id = i.auth_user_id);

-- 2) IVA POR PRODUCTO (OPCIONAL, apagado por defecto). Columnas nuevas y vacías en todo lo existente.
alter table public.venta_detalles add column if not exists iva_tarifa numeric(5,2);
alter table public.venta_detalles add column if not exists iva_monto numeric(14,2);
alter table public.configuracion_empresa add column if not exists iva_por_producto boolean not null default false;
