-- Crear un negocio adicional (cuando el administrador permite 2 o más negocios) — 05-nov-2026
-- Antes el navegador insertaba directo en negocios_vinculados y la base lo rechazaba (403: no hay permiso de insertar).
-- Ahora lo hace el servidor, con candados: solo la cuenta principal, solo la cuenta interna que ESA cuenta autorizó,
-- respetando el límite de negocios que dio el administrador, y sin poder vincular dos veces la misma cuenta.
create or replace function public.crear_negocio_vinculado(p_nuevo uuid, p_nombre text, p_password text, p_nombre_principal text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_mi_email text; v_email text; v_lim integer; v_n integer; v_id uuid;
  v_nombre text := left(btrim(coalesce(p_nombre, '')), 120);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'mensaje', 'Sin sesión activa'); end if;
  if v_nombre = '' then return jsonb_build_object('ok', false, 'mensaje', 'Escribe un nombre para el negocio.'); end if;
  if p_password is null or length(p_password) < 12 then return jsonb_build_object('ok', false, 'mensaje', 'Datos no válidos.'); end if;
  select lower(email) into v_mi_email from auth.users where id = v_uid;
  if v_mi_email is null or v_mi_email like '%@negocio360.internal' then
    return jsonb_build_object('ok', false, 'mensaje', 'Solo la cuenta principal puede crear negocios.'); end if;
  select lower(email) into v_email from auth.users where id = p_nuevo;
  if v_email is null or v_email !~ '^negocio-[0-9a-f]{8}@negocio360\.internal$' then
    return jsonb_build_object('ok', false, 'mensaje', 'La cuenta del negocio nuevo no es válida.'); end if;
  if not exists (select 1 from registro_autorizaciones where email = v_email and auth_user_id_dueno = v_uid and tipo = 'negocio') then
    return jsonb_build_object('ok', false, 'mensaje', 'Ese negocio no fue autorizado por tu cuenta.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_negocio_vinc:' || v_uid::text, 0));
  if exists (select 1 from negocios_vinculados where auth_user_id_negocio = p_nuevo) then
    return jsonb_build_object('ok', false, 'mensaje', 'Ese negocio ya estaba creado.'); end if;
  select coalesce(limite_negocios, 1) into v_lim from usuarios where auth_user_id = v_uid;
  select 1 + count(*) into v_n from negocios_vinculados where auth_user_id_principal = v_uid and not es_principal and activo;
  if v_n >= coalesce(v_lim, 1) then
    return jsonb_build_object('ok', false, 'mensaje', 'Tu cuenta ya llegó al límite de negocios (' || coalesce(v_lim, 1) || ').'); end if;
  if not exists (select 1 from negocios_vinculados where auth_user_id_principal = v_uid and es_principal) then
    insert into negocios_vinculados (auth_user_id_principal, auth_user_id_negocio, nombre_negocio, es_principal, email_interno, password_interno)
    values (v_uid, v_uid, coalesce(nullif(left(btrim(coalesce(p_nombre_principal, '')), 120), ''),
                                   (select nombre_comercial from configuracion_empresa where auth_user_id = v_uid), 'Mi negocio'), true, null, null);
  end if;
  insert into negocios_vinculados (auth_user_id_principal, auth_user_id_negocio, nombre_negocio, es_principal, email_interno, password_interno)
  values (v_uid, p_nuevo, v_nombre, false, v_email, p_password)
  returning id into v_id;
  insert into configuracion_empresa (auth_user_id, nombre_comercial, onboarding_completado, onboarding_step)
  values (p_nuevo, v_nombre, true, 5)
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, onboarding_completado = true, onboarding_step = 5;
  update usuarios set onboarding_completado = true where auth_user_id = p_nuevo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.crear_negocio_vinculado(uuid, text, text, text) from public, anon;
grant execute on function public.crear_negocio_vinculado(uuid, text, text, text) to authenticated;
