-- =====================================================================
-- EMPRESA VINCULADA — Consulta de inventario de la empresa (solo lectura)
-- Fecha: 21-oct-2026 · Solo AGREGA una función que LEE.
-- Cada negocio sigue con su inventario aparte; esto solo suma lo de todos
-- los negocios de la empresa (y sus bodegas/sucursales) para verlo junto.
-- Valor = existencias × costo (solo existencias positivas), igual que siempre.
-- =====================================================================
create or replace function public.empresa_inventario_resumen()
returns table (negocio text, lugar text, auth_user_id uuid, es_negocio boolean, orden smallint,
               productos_con_stock bigint, unidades numeric, valor numeric)
language sql stable security definer set search_path = public as $$
  with mi as (select public.empresa_id_de_mi_negocio() as e),
  miembros as (select m.auth_user_id, m.nombre_negocio, m.orden from empresa_miembros m, mi where m.empresa_id = mi.e and m.activo),
  lugares as (
    select mb.nombre_negocio as negocio, mb.nombre_negocio as lugar, mb.auth_user_id, true as es_negocio, mb.orden from miembros mb
    union all
    select mb.nombre_negocio, s.nombre, s.auth_user_id_sucursal, false, mb.orden
      from miembros mb join sucursales s on s.auth_user_id_central = mb.auth_user_id
     where not coalesce(s.es_central, false) and s.auth_user_id_sucursal is not null and s.auth_user_id_sucursal <> mb.auth_user_id)
  select l.negocio, l.lugar, l.auth_user_id, l.es_negocio, l.orden,
         count(p.id) filter (where p.stock_actual > 0),
         coalesce(round(sum(p.stock_actual) filter (where p.stock_actual > 0), 3), 0),
         coalesce(round(sum(p.stock_actual * p.costo) filter (where p.stock_actual > 0), 2), 0)
    from lugares l left join productos p on p.auth_user_id = l.auth_user_id and p.tipo = 'producto'
   group by l.negocio, l.lugar, l.auth_user_id, l.es_negocio, l.orden
   order by l.orden, l.es_negocio desc, l.lugar
$$;
revoke all on function public.empresa_inventario_resumen() from public, anon;
grant execute on function public.empresa_inventario_resumen() to authenticated;
