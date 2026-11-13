-- =====================================================================
-- PERFILES · Permiso "Ver costos y ganancias" (13-nov-2026)
-- Pedido de JKSELECTIVOS: la cajera no debe ver la ganancia al vender.
-- Solo AGREGA una columna. Los perfiles que ya existen quedan en TRUE
-- (siguen viendo todo, como hoy). El Administrador siempre ve todo.
-- No cambia ventas, costos ni reportes: solo qué muestra la pantalla.
-- =====================================================================
alter table public.perfiles_acceso add column if not exists ver_costos boolean not null default true;

-- ¿El perfil puede ver costos? (resuelve la Central aunque se llame desde una sucursal)
create or replace function public.perfil_puede_ver_costos(p_id uuid) returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare v_central uuid; v boolean; t text;
begin
  v_central := public._auth_id_central_del_grupo();
  select ver_costos, tipo into v, t from public.perfiles_acceso where id = p_id and auth_user_id = v_central;
  if not found then return true; end if;
  if t = 'admin' then return true; end if;
  return coalesce(v, true);
end $$;

-- Lista (id, ver_costos) de los perfiles del grupo, para el formulario de usuarios
create or replace function public.listar_ver_costos_grupo() returns table(id uuid, ver_costos boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_central uuid;
begin
  v_central := public._auth_id_central_del_grupo();
  return query select p.id, (p.tipo = 'admin' or p.ver_costos) from public.perfiles_acceso p where p.auth_user_id = v_central and p.activo = true;
end $$;

-- Cambiar el permiso (nunca a un administrador)
create or replace function public.perfil_set_ver_costos(p_id uuid, p_valor boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_central uuid;
begin
  v_central := public._auth_id_central_del_grupo();
  update public.perfiles_acceso set ver_costos = coalesce(p_valor, true), updated_at = now()
   where id = p_id and auth_user_id = v_central and tipo <> 'admin';
end $$;

revoke all on function public.perfil_puede_ver_costos(uuid) from public, anon;
revoke all on function public.listar_ver_costos_grupo() from public, anon;
revoke all on function public.perfil_set_ver_costos(uuid, boolean) from public, anon;
grant execute on function public.perfil_puede_ver_costos(uuid) to authenticated;
grant execute on function public.listar_ver_costos_grupo() to authenticated;
grant execute on function public.perfil_set_ver_costos(uuid, boolean) to authenticated;
