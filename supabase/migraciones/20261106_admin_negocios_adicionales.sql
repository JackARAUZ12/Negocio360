-- Panel de administrador: lista de negocios adicionales ("Mis negocios") con los datos de su dueño,
-- para mostrarlos como una cuenta más (con su nombre real), no con el correo interno. (06-nov-2026)
create or replace function public.admin_negocios_adicionales()
returns table (auth_user_id uuid, nombre_negocio text, principal_id uuid, principal_email text, principal_nombre text, principal_apellido text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_activo() then raise exception 'No autorizado.'; end if;
  return query
    select n.auth_user_id_negocio, n.nombre_negocio, n.auth_user_id_principal, u.email, u.nombre, u.apellido
      from negocios_vinculados n left join usuarios u on u.auth_user_id = n.auth_user_id_principal
     where not n.es_principal and n.activo;
end $$;
revoke all on function public.admin_negocios_adicionales() from public, anon;
grant execute on function public.admin_negocios_adicionales() to authenticated;
