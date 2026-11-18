-- =====================================================================
-- Sucursales y bodegas NUEVAS: solo entran el administrador que la creó,
-- el administrador principal y los usuarios a los que se les dé acceso
-- (Sucursales › Accesos). Las sucursales/bodegas que ya existían quedan
-- EXACTAMENTE como estaban (acceso_restringido = false).
-- El límite de usuarios no cambia: sigue siendo uno solo por grupo.
-- =====================================================================

alter table public.sucursales add column if not exists acceso_restringido boolean not null default false;
alter table public.sucursales add column if not exists creado_por_perfil_id uuid;

-- Toda sucursal/bodega creada desde hoy nace restringida; el creador solo se
-- acepta si de verdad es un administrador activo de esa cuenta principal.
create or replace function public._sucursal_nueva_restringida() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if coalesce(new.es_central, false) = false then
    new.acceso_restringido := true;
    if new.creado_por_perfil_id is not null and not exists (
      select 1 from public.perfiles_acceso p
       where p.id = new.creado_por_perfil_id and p.auth_user_id = new.auth_user_id_central
         and p.tipo = 'admin' and p.activo = true) then
      new.creado_por_perfil_id := null;
    end if;
  end if;
  return new;
end $f$;
drop trigger if exists trg_sucursal_nueva_restringida on public.sucursales;
create trigger trg_sucursal_nueva_restringida before insert on public.sucursales
  for each row execute function public._sucursal_nueva_restringida();

-- ¿Puede este perfil usar esta sucursal? (sucursales antiguas: siempre sí)
create or replace function public._perfil_permitido_en_sucursal(p_sucursal_id uuid, p_perfil uuid) returns boolean
language plpgsql stable security definer set search_path = public as $f$
declare r record;
begin
  select s.id, s.auth_user_id_central, s.acceso_restringido, s.creado_por_perfil_id into r
    from public.sucursales s where s.id = p_sucursal_id and s.es_central = false;
  if not found or not coalesce(r.acceso_restringido, false) then return true; end if;
  if p_perfil is null then return false; end if;
  return p_perfil = r.creado_por_perfil_id
      or exists (select 1 from public.perfiles_acceso p where p.id = p_perfil and p.auth_user_id = r.auth_user_id_central
                   and p.tipo = 'admin' and p.es_principal = true)
      or exists (select 1 from public.sucursal_permisos sp where sp.sucursal_id = r.id and sp.perfil_id = p_perfil);
end $f$;

-- Lo mismo, visto desde la cuenta que está usando el sistema ahora mismo
create or replace function public._perfil_permitido_aqui(p_perfil uuid) returns boolean
language plpgsql stable security definer set search_path = public as $f$
declare v_suc uuid;
begin
  select s.id into v_suc from public.sucursales s where s.auth_user_id_sucursal = auth.uid() and s.es_central = false limit 1;
  if v_suc is null then return true; end if;   -- cuenta principal: sin cambios
  return public._perfil_permitido_en_sucursal(v_suc, p_perfil);
end $f$;

-- Para el selector de cuentas / botón "Entrar": se puede preguntar desde cualquier cuenta del mismo grupo
create or replace function public.perfil_puede_entrar_sucursal(p_sucursal_id uuid, p_perfil_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $f$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from public.sucursales s where s.id = p_sucursal_id
                  and s.auth_user_id_central = public._auth_id_central_del_grupo()) then return false; end if;
  return public._perfil_permitido_en_sucursal(p_sucursal_id, p_perfil_id);
end $f$;
revoke all on function public.perfil_puede_entrar_sucursal(uuid, uuid) from public, anon;
grant execute on function public.perfil_puede_entrar_sucursal(uuid, uuid) to authenticated;
revoke all on function public._perfil_permitido_en_sucursal(uuid, uuid) from public, anon, authenticated;
revoke all on function public._perfil_permitido_aqui(uuid) from public, anon, authenticated;
revoke all on function public._sucursal_nueva_restringida() from public, anon, authenticated;

-- "¿Quién eres?" dentro de una sucursal: solo los perfiles permitidos ahí
create or replace function public.listar_perfiles_del_grupo()
 returns table(id uuid, nombre text, tipo text, codigo_hash text, codigo_configurado boolean, modulos jsonb, avatar_color text, activo boolean)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_central uuid;
begin
  select s.auth_user_id_central into v_central from public.sucursales s
    where s.auth_user_id_sucursal = auth.uid() and s.es_central = false limit 1;
  if v_central is null then v_central := auth.uid(); end if;
  return query
    select p.id, p.nombre, p.tipo, case when p.tipo = 'admin' then null else p.codigo_hash end, p.codigo_configurado, p.modulos, p.avatar_color, p.activo
    from public.perfiles_acceso p where p.auth_user_id = v_central and p.activo = true
      and public._perfil_permitido_aqui(p.id)
    order by (p.tipo = 'admin') desc, p.nombre;
end $function$;

create or replace function public.listar_perfiles_del_grupo_v2()
 returns table(id uuid, nombre text, tipo text, codigo_hash text, codigo_configurado boolean, modulos jsonb, avatar_color text, activo boolean, es_principal boolean)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_central uuid;
begin
  select s.auth_user_id_central into v_central from public.sucursales s
    where s.auth_user_id_sucursal = auth.uid() and s.es_central = false limit 1;
  if v_central is null then v_central := auth.uid(); end if;
  return query
    select p.id, p.nombre, p.tipo, case when p.tipo = 'admin' then null else p.codigo_hash end, p.codigo_configurado, p.modulos, p.avatar_color, p.activo, p.es_principal
    from public.perfiles_acceso p where p.auth_user_id = v_central and p.activo = true
      and public._perfil_permitido_aqui(p.id)
    order by (p.tipo = 'admin') desc, p.es_principal desc, p.nombre;
end $function$;

-- Código de administrador dentro de una sucursal nueva: un administrador sin acceso a ella no pasa
create or replace function public.admin_verificar_codigo(p_pin text, p_perfil_id uuid default null::uuid, p_motivo text default 'acceso'::text)
 returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_r jsonb;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if p_perfil_id is not null and not public._perfil_permitido_aqui(p_perfil_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sin_acceso');
  end if;
  v_r := public._admin_verificar(public._auth_id_central_del_grupo(), p_pin, p_perfil_id, p_motivo);
  if coalesce((v_r ->> 'ok')::boolean, false) and not public._perfil_permitido_aqui((v_r ->> 'perfil_id')::uuid) then
    return jsonb_build_object('ok', false, 'motivo', 'sin_acceso');
  end if;
  return v_r;
end $function$;
