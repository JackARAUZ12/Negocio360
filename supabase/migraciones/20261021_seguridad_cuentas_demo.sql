-- ============================================================
-- SEGURIDAD — Auditoría de cuentas demo (20/10/2026)
-- Ya aplicado en producción (ver también 20261021_seguridad_vistas.sql).
-- ============================================================

-- ------------------------------------------------------------
-- 1) ¿Es una cuenta demo? (la demo pública o una sucursal/bodega de ella)
-- ------------------------------------------------------------
create or replace function public._es_cuenta_demo(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    exists (select 1 from public.cuentas_prueba cp where cp.auth_user_id = p_uid and cp.tipo = 'demo_publica')
    or exists (select 1 from public.sucursales s
                 join public.cuentas_prueba cp on cp.auth_user_id = s.auth_user_id_central and cp.tipo = 'demo_publica'
                where s.auth_user_id_sucursal = p_uid)
  );
$$;
revoke all on function public._es_cuenta_demo(uuid) from public, anon, authenticated;

-- Para la interfaz: solo responde por la sesión actual.
create or replace function public.soy_cuenta_demo()
returns boolean language sql stable security definer set search_path = public as $$
  select public._es_cuenta_demo(auth.uid());
$$;
revoke all on function public.soy_cuenta_demo() from public, anon;
grant execute on function public.soy_cuenta_demo() to authenticated;

-- ------------------------------------------------------------
-- 2) auth.users: una demo no se puede eliminar ni cambiarle contraseña,
--    correo o teléfono (dejaría la demo inservible para todos).
--    Mantenimiento del dueño: en una transacción,
--      set local n360.mantenimiento_demo = 'on';
-- ------------------------------------------------------------
create or replace function public._proteger_cuentas_demo_auth()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('n360.mantenimiento_demo', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not public._es_cuenta_demo(old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Las cuentas de demostración no se pueden eliminar.';
  end if;
  if new.encrypted_password is distinct from old.encrypted_password
     or new.email is distinct from old.email
     or new.phone is distinct from old.phone
     or (coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change)
     or (coalesce(new.phone_change, '') <> '' and new.phone_change is distinct from old.phone_change) then
    raise exception 'En la cuenta de demostración no se puede cambiar la contraseña, el correo ni el teléfono.';
  end if;
  return new;
end $$;

create trigger trg_proteger_cuentas_demo
  before update or delete on auth.users
  for each row execute function public._proteger_cuentas_demo_auth();

-- ------------------------------------------------------------
-- 3) usuarios: nadie (salvo el admin o procesos internos) puede tocar
--    su propio plan, estado, vencimiento, precio, límites o pago.
--    Antes cualquier usuario podía darse "premium" y "activa" para
--    siempre, o generar comisiones falsas de freelancer.
--    En demos tampoco se puede activar el multiusuario (PIN).
-- ------------------------------------------------------------
create or replace function public._proteger_campos_usuarios()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin_activo() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'No autorizado.';
  end if;
  new.id                   := old.id;
  new.auth_user_id         := old.auth_user_id;
  new.email                := old.email;
  new.estado_cuenta        := old.estado_cuenta;
  new.plan                 := old.plan;
  new.fecha_vencimiento    := old.fecha_vencimiento;
  new.fecha_ultimo_pago    := old.fecha_ultimo_pago;
  new.ciclo_facturacion    := old.ciclo_facturacion;
  new.precio_personalizado := old.precio_personalizado;
  new.limite_perfiles      := old.limite_perfiles;
  new.limite_negocios      := old.limite_negocios;
  new.created_at           := old.created_at;
  if public._es_cuenta_demo(old.auth_user_id) then
    new.multiusuario_activo := old.multiusuario_activo;
  end if;
  return new;
end $$;

create trigger trg_proteger_campos_usuarios
  before insert or update on public.usuarios
  for each row execute function public._proteger_campos_usuarios();

-- Una demo no puede borrar su fila de usuarios ni su configuración de empresa.
create or replace function public._proteger_borrado_demo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin_activo()
     and coalesce(current_setting('n360.mantenimiento_demo', true), '') <> 'on'
     and public._es_cuenta_demo(old.auth_user_id) then
    raise exception 'En la cuenta de demostración no se puede borrar esto.';
  end if;
  return old;
end $$;

create trigger trg_proteger_borrado_demo before delete on public.usuarios
  for each row execute function public._proteger_borrado_demo();
create trigger trg_proteger_borrado_demo before delete on public.configuracion_empresa
  for each row execute function public._proteger_borrado_demo();

-- ------------------------------------------------------------
-- 4) Funciones que no verificaban quién las llamaba
-- ------------------------------------------------------------
create or replace function public.incrementar_stock_producto(p_producto_id uuid, p_auth_user_id uuid, p_cantidad numeric)
returns table(id uuid, stock_actual numeric) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> p_auth_user_id then raise exception 'No autorizado'; end if;
  return query
  update public.productos
  set stock_actual = productos.stock_actual + p_cantidad, updated_at = now()
  where productos.id = p_producto_id and productos.auth_user_id = p_auth_user_id
  returning productos.id, productos.stock_actual;
end $$;

create or replace function public.generar_numero_garantia(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'No autorizado'; end if;
  select count(*) into v_count from public.garantias_clientes where auth_user_id = p_user_id;
  return 'GT-' || lpad((v_count + 1)::text, 6, '0');
end $$;

create or replace function public.generar_numero_orden_produccion(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'No autorizado'; end if;
  select count(*) into v_count from public.ordenes_produccion where auth_user_id = p_user_id;
  return 'OP-' || lpad((v_count + 1)::text, 6, '0');
end $$;

create or replace function public.generar_numero_ticket_servicio(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'No autorizado'; end if;
  select count(*) into v_count from public.servicio_postventa where auth_user_id = p_user_id;
  return 'ST-' || lpad((v_count + 1)::text, 6, '0');
end $$;

create or replace function public.catalogo_obtener_limites(p_auth_user_id uuid)
returns table(plan_key text, catalogos_max integer, productos_por_catalogo_max integer, fotos_por_producto_max integer, productos_adicionales integer)
language sql security definer set search_path = public as $$
  select cp.plan_key, cp.catalogos_max, cp.productos_por_catalogo_max, cp.fotos_por_producto_max,
         coalesce(cs.productos_adicionales, 0)
  from public.catalogo_planes cp
  left join public.catalogo_suscripciones cs on cs.auth_user_id = p_auth_user_id
  where (p_auth_user_id = auth.uid() or public.is_admin_activo())
    and cp.plan_key = coalesce((select plan_key from public.catalogo_suscripciones where auth_user_id = p_auth_user_id), 'basico')
  limit 1;
$$;

-- Solo la tarea programada (cron) genera los cierres automáticos.
revoke execute on function public.generar_cierres_automaticos() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5) Storage: nadie puede LISTAR los archivos de otros. Los enlaces
--    públicos (fotos, logos, catálogos, adjuntos del chat) siguen
--    funcionando igual. En el chat solo se sube a la carpeta propia
--    (o el admin a la del cliente).
-- ------------------------------------------------------------
drop policy if exists chat_archivos_select on storage.objects;
create policy chat_archivos_select on storage.objects for select using (
  bucket_id = 'chat-archivos' and ((storage.foldername(name))[1] = (auth.uid())::text or public.is_admin_activo()));
drop policy if exists chat_archivos_insert on storage.objects;
create policy chat_archivos_insert on storage.objects for insert with check (
  bucket_id = 'chat-archivos' and auth.role() = 'authenticated'
  and ((storage.foldername(name))[1] = (auth.uid())::text or public.is_admin_activo()));

drop policy if exists inventario_fotos_lectura_publica on storage.objects;
create policy inventario_fotos_lectura_publica on storage.objects for select using (
  bucket_id = 'inventario_fotos' and (storage.foldername(name))[1] = (auth.uid())::text);
drop policy if exists catalogo360_lectura_publica on storage.objects;
create policy catalogo360_lectura_publica on storage.objects for select using (
  bucket_id = 'catalogo360' and (storage.foldername(name))[1] = (auth.uid())::text);
drop policy if exists public_read_logos on storage.objects;
create policy public_read_logos on storage.objects for select using (
  bucket_id = 'logos_empresa' and (storage.foldername(name))[1] = (auth.uid())::text);

-- ------------------------------------------------------------
-- 6) Funciones de sesión: un visitante sin iniciar sesión (anon) ya no
--    puede ejecutarlas (antes podía crear perfiles "basura" sin dueño).
-- ------------------------------------------------------------
revoke execute on function
  public.actualizar_codigo_perfil_grupo(uuid, text), public.crear_perfil_grupo(text, text, text[]),
  public.editar_perfil_grupo(uuid, text, text[]), public.eliminar_perfil_grupo(uuid),
  public.establecer_stock_compartido(boolean, text, uuid, uuid[]), public.obtener_stock_compartido(),
  public.obtener_stock_compartido_config(), public.stock_grupo_por_nombre(text), public.consume_codigo_acceso(uuid),
  public.incrementar_stock_producto(uuid, uuid, numeric), public.generar_numero_garantia(uuid),
  public.generar_numero_orden_produccion(uuid), public.generar_numero_ticket_servicio(uuid),
  public.catalogo_obtener_limites(uuid)
from public, anon;
-- (y se mantiene grant execute ... to authenticated, service_role)
