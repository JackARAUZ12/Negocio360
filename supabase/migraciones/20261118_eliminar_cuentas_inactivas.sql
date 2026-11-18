-- ============================================================================
-- 20261118 · Eliminación de 10 cuentas principales inactivas (> 3 meses)
-- Autorizado expresamente por el dueño de la plataforma (Jack) el 2026-11-18.
-- SOLO estas 10 cuentas (por ID y por correo). No toca a ningún otro cliente.
--
-- Orden: 1) candados de seguridad  2) respaldo completo (JSON) en un esquema
-- privado  3) eliminación  4) verificación de que NADA de otros clientes cambió.
-- Si cualquier candado o verificación falla, se cancela TODO (nada se borra).
-- Respaldo: respaldos_privados.cuentas_eliminadas_20261118 (no expuesto por la API).
-- ============================================================================
create schema if not exists respaldos_privados;
revoke all on schema respaldos_privados from anon, authenticated;

create table if not exists respaldos_privados.cuentas_eliminadas_20261118 (
  id bigserial primary key,
  tabla text not null,
  auth_user_id uuid,
  fila jsonb not null,
  respaldado_en timestamptz not null default now()
);
alter table respaldos_privados.cuentas_eliminadas_20261118 enable row level security;
revoke all on respaldos_privados.cuentas_eliminadas_20261118 from anon, authenticated;

do $elim$
declare
  dry boolean := false;   -- true = ensayo: hace todo y al final revierte
  ids uuid[] := array[
    '66c8c2ed-bec6-44f1-b34e-cc981721444f','f5eb48b3-ee1a-4033-ad5d-951db7f92c6d',
    '3d14ed1a-5d3c-45b9-92dd-e2e1af8bea66','c4fae26b-1e6c-413a-a4f9-570ab5f0f907',
    'cb846fe5-4f0b-452c-ac30-90ad806e3d99','f8c90b8f-3b46-4969-80e4-9621fb68f35f',
    '42bcfd44-0825-483b-9dac-0fc5a9d25f13','6e14ccf4-b2cd-401a-b1cc-226286b6166a',
    '32609f25-a480-4806-a3fc-5f2876033455','e0205bd7-b42d-44bd-b64f-6e44579e7e68']::uuid[];
  emails text[] := array[
    'klifford10@gmail.com','admin@atheneascollective.com','vjhurbeeth.castro@gmail.com',
    'ruteo1.hispamer@gmail.com','moralesnathalia352@gmail.com','ericklreyesaverruz@gmail.com',
    'briesshopnicaragua@gmail.com','darvincenteno97@outlook.com','sericolorpublicidad03@gmail.com',
    'ferreteriatrujillo24@gmail.com'];
  chequeo text[] := array['ventas','productos','clientes','configuracion_empresa','compras','gastos',
    'creditos','venta_detalles','movimientos_financieros','usuarios','cuentas_contables','proveedores',
    'asientos_contables','metodos_pago','perfiles_acceso','sucursales'];
  t record; tb text; n bigint; antes jsonb := '{}'; propias jsonb := '{}'; despues jsonb := '{}';
  borrado jsonb := '{}'; respaldadas bigint := 0; k bigint; total bigint;
begin
  -- 1) CANDADOS
  if (select count(*) from auth.users where id = any(ids) and email = any(emails)) <> 10 then
    raise exception 'Candado: las 10 cuentas (ID + correo) no coinciden. No se borra nada.'; end if;
  if exists (select 1 from auth.users where id = any(ids) and last_sign_in_at > now() - interval '3 months') then
    raise exception 'Candado: alguna cuenta tuvo ingreso reciente. No se borra nada.'; end if;
  if exists (select 1 from public.ventas where auth_user_id = any(ids) and created_at > now() - interval '3 months') then
    raise exception 'Candado: alguna cuenta tuvo ventas recientes. No se borra nada.'; end if;
  if exists (select 1 from public.sucursales where (auth_user_id_central = any(ids) or auth_user_id_sucursal = any(ids))
             and auth_user_id_central <> auth_user_id_sucursal) then
    raise exception 'Candado: alguna cuenta está vinculada a otra (sucursal). No se borra nada.'; end if;
  if exists (select 1 from public.cuentas_prueba where auth_user_id = any(ids)) then
    raise exception 'Candado: alguna cuenta es de demostración. No se borra nada.'; end if;

  -- Fotografía de lo que NO es de estas cuentas (debe quedar idéntico)
  foreach tb in array chequeo loop
    execute format('select count(*) from public.%I', tb) into total;
    antes := antes || jsonb_build_object(tb, total);
    if tb = 'sucursales' then
      execute 'select count(*) from public.sucursales where auth_user_id_central = any($1) or auth_user_id_sucursal = any($1)' into n using ids;
    else
      execute format('select count(*) from public.%I where auth_user_id = any($1)', tb) into n using ids;
    end if;
    propias := propias || jsonb_build_object(tb, n);
  end loop;

  -- 2) RESPALDO (todas las filas de estas cuentas, en JSON)
  insert into respaldos_privados.cuentas_eliminadas_20261118 (tabla, auth_user_id, fila)
    select 'auth.users', u.id, to_jsonb(u) - 'encrypted_password' from auth.users u where u.id = any(ids);
  insert into respaldos_privados.cuentas_eliminadas_20261118 (tabla, auth_user_id, fila)
    select 'auth.identities', i.user_id, to_jsonb(i) from auth.identities i where i.user_id = any(ids);
  insert into respaldos_privados.cuentas_eliminadas_20261118 (tabla, auth_user_id, fila)
    select 'public.sucursales', s.auth_user_id_central, to_jsonb(s) from public.sucursales s
     where s.auth_user_id_central = any(ids) or s.auth_user_id_sucursal = any(ids);
  insert into respaldos_privados.cuentas_eliminadas_20261118 (tabla, auth_user_id, fila)
    select 'storage.objects', o.owner_id::uuid, to_jsonb(o) - 'user_metadata' from storage.objects o
     where split_part(o.name,'/',1) = any(array(select unnest(ids)::text)) or o.owner_id = any(array(select unnest(ids)::text));
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables x on x.table_schema='public' and x.table_name=c.table_name and x.table_type='BASE TABLE'
           where c.table_schema='public' and c.column_name='auth_user_id' order by 1 loop
    execute format('insert into respaldos_privados.cuentas_eliminadas_20261118 (tabla, auth_user_id, fila) select %L, x.auth_user_id, to_jsonb(x) from public.%I x where x.auth_user_id = any($1)', 'public.'||t.table_name, t.table_name) using ids;
    get diagnostics k = row_count; respaldadas := respaldadas + k;
  end loop;

  -- 3) ELIMINACIÓN
  delete from public.sucursales where auth_user_id_central = any(ids) or auth_user_id_sucursal = any(ids);
  delete from auth.users where id = any(ids);                       -- borra en cascada casi todo
  get diagnostics n = row_count;
  if n <> 10 then raise exception 'Se esperaba borrar 10 usuarios y fueron %', n; end if;
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables x on x.table_schema='public' and x.table_name=c.table_name and x.table_type='BASE TABLE'
           where c.table_schema='public' and c.column_name='auth_user_id' order by 1 loop
    execute format('delete from public.%I where auth_user_id = any($1)', t.table_name) using ids;
    get diagnostics k = row_count;
    if k > 0 then borrado := borrado || jsonb_build_object(t.table_name, k); end if;
  end loop;

  -- 4) VERIFICACIÓN: nada quedó de estas cuentas y nada de los demás cambió
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables x on x.table_schema='public' and x.table_name=c.table_name and x.table_type='BASE TABLE'
           where c.table_schema='public' and c.column_name='auth_user_id' loop
    execute format('select count(*) from public.%I where auth_user_id = any($1)', t.table_name) into n using ids;
    if n > 0 then raise exception 'Quedaron % filas en % — se cancela todo.', n, t.table_name; end if;
  end loop;
  foreach tb in array chequeo loop
    execute format('select count(*) from public.%I', tb) into total;
    if total <> (antes->>tb)::bigint - (propias->>tb)::bigint then
      raise exception 'La tabla % cambió de forma inesperada (antes %, propias %, ahora %) — se cancela todo.', tb, antes->>tb, propias->>tb, total;
    end if;
  end loop;

  if dry then
    raise exception 'ENSAYO_OK respaldadas=% | borrado=% | usuarios_restantes_de_las_10=%', respaldadas, borrado::text,
      (select count(*) from auth.users where id = any(ids));
  end if;
  raise notice 'Eliminación completa. Filas respaldadas: %. Detalle: %', respaldadas, borrado;
end
$elim$;
