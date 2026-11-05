-- Resumen de stock para el Dashboard calculado en la base de datos (solo lectura).
-- Mismas reglas que el cálculo que hacía el navegador:
--   total = suma de stock_actual de productos tipo 'producto'
--   bajo  = con stock_minimo: stock <= minimo ; sin stock_minimo: stock < 5
-- SECURITY INVOKER: respeta RLS igual que la consulta anterior.
create or replace function public.resumen_stock_dashboard(p_user uuid)
returns table(total_stock numeric, productos_bajos bigint, num_productos bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(coalesce(stock_actual,0)),0)::numeric,
         count(*) filter (where case when stock_minimo is not null
                                     then coalesce(stock_actual,0) <= coalesce(stock_minimo,0)
                                     else coalesce(stock_actual,0) < 5 end),
         count(*)
  from public.productos
  where auth_user_id = p_user and tipo = 'producto';
$$;
revoke all on function public.resumen_stock_dashboard(uuid) from public, anon;
grant execute on function public.resumen_stock_dashboard(uuid) to authenticated;
