-- Mis negocios: ver todos los negocios desde cualquiera de ellos y pasar rápido de uno a otro (05-nov-2026)
-- * Los negocios creados en "Mis negocios" quedan también como una "empresa vinculada" (igual que All Plastic),
--   así se usa el mismo paso seguro entre negocios (pase de un solo uso, sin contraseñas).
-- * solo_admin: en estas empresas solo el administrador puede pasar de un negocio a otro (All Plastic sigue igual).
-- * mis_negocios_grupo(): lista principal + adicionales vista desde cualquiera de ellos (sin contraseñas).
alter table public.empresas_vinculadas add column if not exists solo_admin boolean not null default false;

create or replace function public._negocio_a_empresa(p_principal uuid, p_negocio uuid, p_nombre_principal text, p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_orden smallint;
begin
  select empresa_id into v_emp from empresa_miembros where auth_user_id = p_principal;
  if v_emp is null then
    insert into empresas_vinculadas (nombre, solo_admin) values (coalesce(nullif(btrim(p_nombre_principal), ''), 'Mis negocios'), true) returning id into v_emp;
    insert into empresa_miembros (empresa_id, auth_user_id, nombre_negocio, orden) values (v_emp, p_principal, coalesce(nullif(btrim(p_nombre_principal), ''), 'Principal'), 0);
  end if;
  if exists (select 1 from empresa_miembros where auth_user_id = p_negocio) then return; end if;
  select coalesce(max(orden), 0) + 1 into v_orden from empresa_miembros where empresa_id = v_emp;
  insert into empresa_miembros (empresa_id, auth_user_id, nombre_negocio, orden) values (v_emp, p_negocio, p_nombre, v_orden);
end $$;
revoke all on function public._negocio_a_empresa(uuid, uuid, text, text) from public, anon, authenticated;

do $$
declare d text := pg_get_functiondef('public.crear_negocio_vinculado(uuid,text,text,text)'::regprocedure);
  v_viejo text := $q$  returning id into v_id;$q$;
  v_nuevo text := $q$  returning id into v_id;
  perform public._negocio_a_empresa(v_uid, p_nuevo,
    (select nombre_negocio from negocios_vinculados where auth_user_id_principal = v_uid and es_principal limit 1), v_nombre);$q$;
begin
  if position('_negocio_a_empresa' in d) > 0 then return; end if;
  if position(v_viejo in d) = 0 then raise exception 'texto no encontrado; no se cambió nada'; end if;
  execute replace(d, v_viejo, v_nuevo);
end $$;

-- Negocios ya creados antes de este cambio: se agregan a su empresa (no toca datos de los negocios)
do $$
declare r record;
begin
  for r in select n.auth_user_id_principal p, n.auth_user_id_negocio x, n.nombre_negocio nom,
                  (select np.nombre_negocio from negocios_vinculados np where np.auth_user_id_principal = n.auth_user_id_principal and np.es_principal limit 1) nomp
             from negocios_vinculados n
            where not n.es_principal and n.activo and exists (select 1 from auth.users a where a.id = n.auth_user_id_negocio)
              and not exists (select 1 from empresa_miembros m where m.auth_user_id = n.auth_user_id_negocio)
  loop
    perform public._negocio_a_empresa(r.p, r.x, r.nomp, r.nom);
  end loop;
end $$;

create or replace function public.mis_negocios_grupo()
returns table (id uuid, auth_user_id_negocio uuid, nombre_negocio text, es_principal boolean)
language sql stable security definer set search_path = public as $$
  with p as (select coalesce((select auth_user_id_principal from negocios_vinculados where auth_user_id_negocio = auth.uid() and activo limit 1), auth.uid()) pid)
  select n.id, n.auth_user_id_negocio, n.nombre_negocio, n.es_principal
    from negocios_vinculados n, p
   where n.auth_user_id_principal = p.pid and n.activo
   order by n.es_principal desc, n.created_at
$$;
revoke all on function public.mis_negocios_grupo() from public, anon;
grant execute on function public.mis_negocios_grupo() to authenticated;

create or replace function public.empresa_solo_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select e.solo_admin from empresas_vinculadas e where e.id = public.empresa_id_de_mi_negocio()), false)
$$;
revoke all on function public.empresa_solo_admin() from public, anon;
grant execute on function public.empresa_solo_admin() to authenticated;
