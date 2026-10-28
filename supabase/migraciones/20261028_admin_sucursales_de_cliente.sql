-- Panel de administrador: lista las bodegas y sucursales de un cliente
-- (solo nombre/tipo/estado; NUNCA credenciales). Solo administradores activos.
-- Cambio aditivo: no modifica ninguna tabla ni función existente.
create or replace function public.admin_sucursales_de_cliente(p_central uuid)
returns table(auth_user_id uuid, nombre text, tipo text, activa boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_activo() then
    raise exception 'Solo administradores';
  end if;
  return query
    select s.auth_user_id_sucursal, s.nombre, s.tipo, s.activa
    from public.sucursales s
    where s.auth_user_id_central = p_central
      and s.auth_user_id_sucursal is distinct from p_central
    order by s.tipo, s.nombre;
end;
$$;
revoke all on function public.admin_sucursales_de_cliente(uuid) from public, anon;
grant execute on function public.admin_sucursales_de_cliente(uuid) to authenticated;
