-- =====================================================================
-- SINCRONIZACIÓN DE PRODUCTOS ENTRE SUCURSALES · ya no pisa productos de nombre repetido
-- Problema: al editar un producto (nombre, precio, costo, SKU...), el disparador trg_sincronizar_producto_grupo copiaba los
-- cambios a TODOS los productos de las otras sucursales con el mismo nombre. Con nombres repetidos (33 "GLASS", uno por modelo)
-- una sola edición dejó los 33 con el mismo SKU (5 nov 2026, Novacell).
-- Ahora: si el producto comparte nombre con otros de su propia cuenta, solo se sincroniza con el de SKU igual (y si no tiene
-- SKU, no se sincroniza); y en cada otra cuenta se actualiza únicamente cuando el equivalente es UNO solo, nunca varios.
-- Los productos de nombre único se sincronizan exactamente como antes. No cambia datos existentes.
-- (La definición completa de la función está aplicada en la base de datos con el nombre de migración
--  "sincronizar_producto_en_grupo_seguro".)
-- =====================================================================

create or replace function public.sincronizar_producto_en_grupo()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  v_central uuid;
  v_cuentas uuid[];
  v_nn text := lower(regexp_replace(trim(OLD.nombre), '\s+', ' ', 'g'));
  v_ambiguo boolean;
begin
  if pg_trigger_depth() > 1 then
    return NEW;
  end if;

  select s.auth_user_id_central into v_central from public.sucursales s
    where s.auth_user_id_central = NEW.auth_user_id limit 1;
  if v_central is null then
    select s.auth_user_id_central into v_central from public.sucursales s
      where s.auth_user_id_sucursal = NEW.auth_user_id and s.es_central = false limit 1;
  end if;

  if v_central is null then
    return NEW;
  end if;

  select array_agg(distinct coalesce(s.auth_user_id_sucursal, v_central))
    into v_cuentas
    from public.sucursales s where s.auth_user_id_central = v_central;
  v_cuentas := array_append(v_cuentas, v_central);

  select exists (select 1 from public.productos q
                  where q.auth_user_id = NEW.auth_user_id and q.tipo = NEW.tipo and q.id <> NEW.id
                    and lower(regexp_replace(trim(q.nombre), '\s+', ' ', 'g')) = v_nn) into v_ambiguo;
  if v_ambiguo and nullif(trim(coalesce(OLD.sku, '')), '') is null then
    return NEW;
  end if;

  update public.productos p set
    nombre        = NEW.nombre,
    precio        = NEW.precio,
    costo         = NEW.costo,
    sku           = NEW.sku,
    codigo_barras = NEW.codigo_barras,
    descripcion   = NEW.descripcion,
    categoria     = NEW.categoria,
    tipo_precio   = NEW.tipo_precio,
    updated_at    = now()
  where p.id in (
    select c.id from public.productos c
     where c.auth_user_id = any(v_cuentas)
       and c.auth_user_id <> NEW.auth_user_id
       and c.tipo = NEW.tipo
       and lower(regexp_replace(trim(c.nombre), '\s+', ' ', 'g')) = v_nn
       and (not v_ambiguo or lower(trim(coalesce(c.sku, ''))) = lower(trim(coalesce(OLD.sku, ''))))
       and (select count(*) from public.productos c2
             where c2.auth_user_id = c.auth_user_id and c2.tipo = NEW.tipo
               and lower(regexp_replace(trim(c2.nombre), '\s+', ' ', 'g')) = v_nn
               and (not v_ambiguo or lower(trim(coalesce(c2.sku, ''))) = lower(trim(coalesce(OLD.sku, ''))))) = 1
  );

  return NEW;
end;
$function$;
