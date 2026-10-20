-- ============================================================
-- REGISTRO SOLO CON CÓDIGO (21/10/2026)
-- Antes el código se revisaba solo en la página: llamando al registro
-- de Supabase directamente se creaba una cuenta "premium / activa" sin
-- código (y el plan lo mandaba el navegador). Ahora lo exige el servidor
-- en el trigger de alta (handle_new_user), que corre con CADA registro:
--   * Cliente normal  -> código de acceso válido (se consume aquí).
--   * Catálogo360     -> código C360 válido (se consume y desbloquea aquí).
--   * Freelancer      -> invitación válida (igual que antes).
--   * Sucursal / bodega / negocio vinculado (correo @negocio360.internal)
--                     -> autorización previa de un solo uso, pedida por el
--                        dueño con su sesión (autorizar_cuenta_interna).
--   * Cualquier otro caso -> se rechaza: la cuenta NO se crea.
-- El plan nunca sale del navegador.
-- Alta manual del administrador por SQL:
--   begin; set local n360.alta_directa = 'on'; insert into auth.users ...; commit;
-- ============================================================

create table if not exists public.registro_autorizaciones (
  email              text primary key,
  auth_user_id_dueno uuid not null,
  tipo               text not null,
  creado_en          timestamptz not null default now(),
  expira_en          timestamptz not null,
  usado_en           timestamptz,
  usado_por          uuid
);
alter table public.registro_autorizaciones enable row level security;
revoke all on public.registro_autorizaciones from public, anon, authenticated;

-- El dueño (con sesión) reserva el correo interno justo antes de crear la
-- sucursal/bodega/negocio. Vale 15 minutos y un solo uso.
create or replace function public.autorizar_cuenta_interna(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_mi_email text;
  v_tipo text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'mensaje', 'Sin sesión activa'); end if;
  if v_email !~ '^(sucursal|bodega|negocio)-[0-9a-f]{8}@negocio360\.internal$' then
    return jsonb_build_object('ok', false, 'mensaje', 'Correo interno no válido');
  end if;
  select lower(email) into v_mi_email from auth.users where id = v_uid;
  if v_mi_email is null or v_mi_email like '%@negocio360.internal' then
    return jsonb_build_object('ok', false, 'mensaje', 'Solo la cuenta principal puede crear sucursales, bodegas o negocios');
  end if;
  if (select count(*) from public.registro_autorizaciones
       where auth_user_id_dueno = v_uid and creado_en > now() - interval '24 hours') >= 15 then
    return jsonb_build_object('ok', false, 'mensaje', 'Límite diario alcanzado. Intenta mañana o contacta a soporte.');
  end if;
  v_tipo := split_part(v_email, '-', 1);
  insert into public.registro_autorizaciones (email, auth_user_id_dueno, tipo, expira_en)
  values (v_email, v_uid, v_tipo, now() + interval '15 minutes')
  on conflict (email) do nothing;
  if not found then return jsonb_build_object('ok', false, 'mensaje', 'Ese correo interno ya se usó'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.autorizar_cuenta_interna(text) from public, anon;
grant execute on function public.autorizar_cuenta_interna(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_plan text := 'premium';
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_codigo text := nullif(btrim(coalesce(v_meta->>'codigo_acceso', '')), '');
  v_c360 text := nullif(upper(btrim(coalesce(v_meta->>'codigo_c360', ''))), '');
  c360 public.catalogo360_codigos;
  v_es_c360 boolean := false;
begin
  -- Cuenta de freelancer invitado: no se le crea negocio
  if v_meta->>'tipo_cuenta' = 'freelancer' then
    perform public._fl_vincular_registro(new.id, new.email, v_meta->>'invitacion');
    return new;
  end if;

  if coalesce(current_setting('n360.alta_directa', true), '') = 'on' then
    -- Alta manual del administrador directo en la base de datos.
    v_plan := coalesce(v_meta->>'plan', 'premium');
    if v_codigo is not null then v_plan := public._fl_consumir_codigo(new.id, v_codigo); end if;

  elsif v_codigo is not null then
    -- Registro normal: el código se valida y se consume aquí (atómico).
    v_plan := public._fl_consumir_codigo(new.id, v_codigo);

  elsif v_c360 is not null then
    -- Registro de Catálogo360: el código se valida, se consume y desbloquea aquí.
    select * into c360 from public.catalogo360_codigos where upper(codigo) = v_c360 for update;
    if c360.id is null or not c360.activo
       or (c360.fecha_expiracion is not null and c360.fecha_expiracion < now())
       or (c360.usos_maximos is not null and c360.usos_actuales >= c360.usos_maximos) then
      raise exception 'N360_CODIGO_INVALIDO';
    end if;
    update public.catalogo360_codigos set usos_actuales = usos_actuales + 1 where id = c360.id;
    v_plan := 'catalogo360';
    v_es_c360 := true;

  else
    -- Sucursal / bodega / negocio vinculado: solo con autorización previa del dueño.
    update public.registro_autorizaciones
       set usado_en = now(), usado_por = new.id
     where email = v_email and usado_en is null and expira_en > now();
    if not found then raise exception 'N360_CODIGO_REQUERIDO'; end if;
    v_plan := 'premium';
  end if;

  insert into public.usuarios (
    auth_user_id, email, onboarding_completado, nombre, apellido,
    nombre_negocio, telefono, estado_cuenta, plan, created_at, updated_at
  ) values (
    new.id, new.email, false,
    coalesce(v_meta->>'nombre', ''), coalesce(v_meta->>'apellido', ''),
    coalesce(v_meta->>'nombre_negocio', ''), v_meta->>'whatsapp', 'activa',
    v_plan, now(), now()
  ) on conflict (auth_user_id) do nothing;

  insert into public.metodos_pago (auth_user_id, nombre, es_default, activo, orden) values
    (new.id, 'Efectivo', true, true, 1), (new.id, 'Tarjeta', false, true, 2),
    (new.id, 'Transferencia', false, true, 3), (new.id, 'PayPal', false, true, 4),
    (new.id, 'Otro', false, true, 5)
  on conflict (auth_user_id, nombre) do nothing;

  if v_es_c360 then
    insert into public.configuracion_empresa (auth_user_id, nombre_comercial, whatsapp,
      catalogo360_desbloqueado, catalogo360_desbloqueado_en, catalogo360_codigo_usado)
    values (new.id, nullif(v_meta->>'nombre_negocio', ''), v_meta->>'whatsapp', true, now(), c360.codigo)
    on conflict (auth_user_id) do update set catalogo360_desbloqueado = true,
      catalogo360_desbloqueado_en = now(), catalogo360_codigo_usado = c360.codigo;
    insert into public.catalogo_suscripciones (auth_user_id, plan_key, estado, es_independiente)
    values (new.id, coalesce(c360.plan_key, 'basico'), 'activa', c360.es_independiente)
    on conflict (auth_user_id) do update set plan_key = coalesce(c360.plan_key, 'basico'),
      estado = 'activa', es_independiente = c360.es_independiente, updated_at = now();
  end if;

  return new;
end $function$;
