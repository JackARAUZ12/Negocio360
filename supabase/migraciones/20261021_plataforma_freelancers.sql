-- =====================================================================
-- SISTEMA DE FREELANCERS DE NEGOCIO360 (nivel plataforma)
-- Fecha: 21-oct-2026
--
-- No confundir con la tabla "freelancers" (módulo Salarios de cada
-- negocio): todo lo de aquí es de la PLATAFORMA y lleva prefijo
-- "plataforma_".
--
-- Reutiliza lo que ya existe:
--   - administradores / is_admin_activo()  -> admin principal
--   - codigos_acceso                       -> los códigos de registro
--   - handle_new_user (trigger de alta)    -> donde se valida el código
--   - usuarios.fecha_ultimo_pago           -> pagos confirmados por el admin
--
-- Reglas de seguridad:
--   - RLS activo en todas las tablas nuevas; solo SELECT para el admin.
--     Nadie escribe directo: todo pasa por funciones SECURITY DEFINER que
--     validan quién llama (admin activo o freelancer activo + permiso).
--   - Los freelancers leen SOLO a través de freelancer_mi_panel() (sus
--     propios datos), nunca las tablas.
--   - El código de acceso se valida y se consume EN EL SERVIDOR, dentro
--     del trigger de alta, con bloqueo de fila (dos registros simultáneos
--     no pueden gastar el mismo código de un uso).
--   - La auditoría es de solo inserción (trigger que impide modificarla).
--   - No cambia ni borra datos existentes. Ningún cliente existente queda
--     atribuido a nadie.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------
create table if not exists public.plataforma_freelancers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id),
  email text not null check (length(email) between 5 and 120),
  nombre text not null check (length(btrim(nombre)) between 2 and 80),
  telefono text check (telefono is null or length(telefono) <= 30),
  identificacion text check (identificacion is null or length(identificacion) <= 40),
  estado text not null default 'pendiente' check (estado in ('pendiente','activo','suspendido','desactivado')),
  -- permisos (los decide el admin; por defecto lo mínimo)
  puede_generar_codigos boolean not null default false,
  planes_permitidos text[] not null default array['prueba']::text[],
  max_usos_por_codigo int not null default 1 check (max_usos_por_codigo between 1 and 50),
  max_codigos_mes int not null default 20 check (max_codigos_mes between 0 and 500),
  max_dias_expiracion int not null default 30 check (max_dias_expiracion between 1 and 365),
  puede_ver_estado_clientes boolean not null default true,
  puede_editar_perfil boolean not null default true,
  politica_suspension text not null default 'revocar' check (politica_suspension in ('revocar','conservar')),
  -- comisiones: apagadas hasta que el admin defina la regla
  comision_pct numeric(5,2) check (comision_pct is null or (comision_pct > 0 and comision_pct <= 100)),
  comision_activa boolean not null default false,
  -- invitación (token secreto; solo se guarda su hash)
  invitacion_hash text,
  invitacion_expira timestamptz,
  notas_admin text check (notas_admin is null or length(notas_admin) <= 2000),
  ultima_actividad timestamptz,
  ultimo_acceso timestamptz,
  estado_cambiado_en timestamptz,
  motivo_estado text,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pf_comision_requiere_pct check (not comision_activa or comision_pct is not null)
);
create unique index if not exists plataforma_freelancers_email_uk on public.plataforma_freelancers (lower(email));
create unique index if not exists plataforma_freelancers_inv_uk on public.plataforma_freelancers (invitacion_hash) where invitacion_hash is not null;

alter table public.codigos_acceso add column if not exists freelancer_id uuid references public.plataforma_freelancers(id);
alter table public.codigos_acceso add column if not exists revocado_en timestamptz;
alter table public.codigos_acceso add column if not exists revocado_por text;
alter table public.codigos_acceso add column if not exists notas_admin text;
create index if not exists codigos_acceso_freelancer_idx on public.codigos_acceso (freelancer_id) where freelancer_id is not null;
create index if not exists codigos_acceso_upper_idx on public.codigos_acceso (upper(codigo));

-- Qué cuenta usó qué código (una cuenta = un uso). Sin FK al código para
-- no impedir que el admin elimine códigos viejos ni perder el historial.
create table if not exists public.plataforma_codigo_usos (
  id uuid primary key default gen_random_uuid(),
  codigo_id uuid not null,
  codigo text not null,
  auth_user_id uuid not null unique,
  freelancer_id uuid references public.plataforma_freelancers(id),
  usado_en timestamptz not null default now()
);
create index if not exists plataforma_codigo_usos_fl_idx on public.plataforma_codigo_usos (freelancer_id);

-- Atribución comercial: una por cuenta cliente. freelancer_id null = retirada.
create table if not exists public.plataforma_atribuciones (
  auth_user_id uuid primary key,
  freelancer_id uuid references public.plataforma_freelancers(id),
  codigo_id uuid,
  codigo text,
  origen text not null check (origen in ('codigo','manual')),
  captado_en timestamptz not null default now(),
  notas_admin text,
  actualizado_en timestamptz not null default now()
);
create index if not exists plataforma_atribuciones_fl_idx on public.plataforma_atribuciones (freelancer_id);

create table if not exists public.plataforma_atribuciones_historial (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null,
  freelancer_anterior uuid,
  freelancer_nuevo uuid,
  motivo text not null,
  cambiado_por text,
  created_at timestamptz not null default now()
);

-- Pagos de la plataforma confirmados por un admin (uno por cliente y ciclo)
create table if not exists public.plataforma_pagos (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  ciclo date not null,
  monto numeric(12,2) not null check (monto >= 0),
  moneda text not null default 'USD',
  registrado_por text,
  created_at timestamptz not null default now(),
  unique (auth_user_id, ciclo)
);

create table if not exists public.plataforma_freelancer_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references public.plataforma_freelancers(id),
  total numeric(12,2) not null check (total >= 0),
  cantidad int not null,
  nota text,
  creado_por text,
  created_at timestamptz not null default now()
);

-- Una comisión por pago (unique pago_id): los reintentos no duplican.
create table if not exists public.plataforma_freelancer_comisiones (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references public.plataforma_freelancers(id),
  auth_user_id uuid not null,
  pago_id uuid not null unique references public.plataforma_pagos(id),
  base numeric(12,2) not null,
  porcentaje numeric(5,2) not null,
  monto numeric(12,2) not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','pagada','anulada','revertida')),
  liquidacion_id uuid references public.plataforma_freelancer_liquidaciones(id),
  motivo text,
  created_at timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists plataforma_fl_comisiones_fl_idx on public.plataforma_freelancer_comisiones (freelancer_id, estado);

-- Auditoría (solo inserción)
create table if not exists public.plataforma_freelancer_auditoria (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_auth_id uuid,
  actor_email text,
  actor_tipo text not null,
  freelancer_id uuid,
  accion text not null,
  entidad text,
  entidad_id text,
  resultado text not null default 'ok' check (resultado in ('ok','denegado','error')),
  detalle jsonb
);
create index if not exists plataforma_fl_auditoria_fl_idx on public.plataforma_freelancer_auditoria (freelancer_id, created_at desc);
create index if not exists plataforma_fl_auditoria_fecha_idx on public.plataforma_freelancer_auditoria (created_at desc);

-- Límite de intentos (validación de códigos e invitaciones)
create table if not exists public.plataforma_codigo_intentos (
  clave text primary key,
  fallos int not null default 0,
  ventana_desde timestamptz,
  bloqueado_hasta timestamptz
);

-- ---------------------------------------------------------------------
-- 2. RLS: solo lectura para el admin; nadie escribe directo
-- ---------------------------------------------------------------------
alter table public.plataforma_freelancers enable row level security;
alter table public.plataforma_codigo_usos enable row level security;
alter table public.plataforma_atribuciones enable row level security;
alter table public.plataforma_atribuciones_historial enable row level security;
alter table public.plataforma_pagos enable row level security;
alter table public.plataforma_freelancer_liquidaciones enable row level security;
alter table public.plataforma_freelancer_comisiones enable row level security;
alter table public.plataforma_freelancer_auditoria enable row level security;
alter table public.plataforma_codigo_intentos enable row level security;

create policy pf_admin_select on public.plataforma_freelancers for select to authenticated using (public.is_admin_activo());
create policy pcu_admin_select on public.plataforma_codigo_usos for select to authenticated using (public.is_admin_activo());
create policy pa_admin_select on public.plataforma_atribuciones for select to authenticated using (public.is_admin_activo());
create policy pah_admin_select on public.plataforma_atribuciones_historial for select to authenticated using (public.is_admin_activo());
create policy pp_admin_select on public.plataforma_pagos for select to authenticated using (public.is_admin_activo());
create policy pfl_admin_select on public.plataforma_freelancer_liquidaciones for select to authenticated using (public.is_admin_activo());
create policy pfc_admin_select on public.plataforma_freelancer_comisiones for select to authenticated using (public.is_admin_activo());
create policy pfa_admin_select on public.plataforma_freelancer_auditoria for select to authenticated using (public.is_admin_activo());
-- plataforma_codigo_intentos: sin políticas (nadie la lee desde el navegador)

-- Problema previo corregido: cualquiera (incluso sin sesión) podía leer
-- TODOS los códigos de acceso. Ahora solo el admin los lee; el registro
-- valida con validar_codigo_acceso() (con límite de intentos).
alter policy codigos_acceso_anon_select on public.codigos_acceso using (false);
alter policy codigos_acceso_select_authenticated on public.codigos_acceso using (false);

-- ---------------------------------------------------------------------
-- 3. AYUDANTES INTERNOS (no ejecutables desde el navegador)
-- ---------------------------------------------------------------------
create or replace function public._fl_aleatorio(n int)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(n); r text := ''; i int;
begin
  for i in 0 .. n - 1 loop r := r || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;  -- 256/32: sin sesgo
  return r;
end $$;

create or replace function public._fl_hash(t text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(upper(btrim(coalesce(t, ''))), 'sha256'), 'hex')
$$;

create or replace function public._fl_log(p_fl uuid, p_accion text, p_entidad text, p_entidad_id text, p_resultado text, p_detalle jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  v_tipo := case
    when auth.uid() is null and coalesce(auth.jwt()->>'role', '') = 'anon' then 'anonimo'
    when auth.uid() is null then 'sistema'
    when public.is_admin_activo() then 'admin'
    when exists (select 1 from public.plataforma_freelancers where auth_user_id = auth.uid()) then 'freelancer'
    else 'usuario' end;
  insert into public.plataforma_freelancer_auditoria(actor_auth_id, actor_email, actor_tipo, freelancer_id, accion, entidad, entidad_id, resultado, detalle)
  values (auth.uid(), auth.email(), v_tipo, p_fl, p_accion, p_entidad, p_entidad_id, coalesce(p_resultado, 'ok'), p_detalle);
end $$;

-- Sin datos secretos: lo que se puede mostrar de un freelancer
create or replace function public._fl_json(f public.plataforma_freelancers)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(f) - 'invitacion_hash'
$$;

-- Estado de un código (disponible / utilizado / expirado / revocado)
create or replace function public._fl_estado_codigo(c public.codigos_acceso)
returns text language sql stable set search_path = public as $$
  select case
    when c.revocado_en is not null then 'revocado'
    when c.usos_actuales >= coalesce(c.usos_maximos, 1) then 'utilizado'
    when c.fecha_expiracion is not null and c.fecha_expiracion < now() then 'expirado'
    when not c.activo then 'revocado'
    else 'disponible' end
$$;

-- Aplica y valida permisos (lanza excepción PERMISO:<campo> si algo no es válido)
create or replace function public._fl_aplicar_permisos(f public.plataforma_freelancers, p jsonb)
returns public.plataforma_freelancers language plpgsql stable set search_path = public as $$
declare v_planes text[]; k text;
begin
  p := coalesce(p, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k not in ('puede_generar_codigos','planes_permitidos','max_usos_por_codigo','max_codigos_mes','max_dias_expiracion',
                 'puede_ver_estado_clientes','puede_editar_perfil','politica_suspension','comision_pct','comision_activa') then
      raise exception 'PERMISO:%', k;
    end if;
  end loop;
  if p ? 'puede_generar_codigos' then f.puede_generar_codigos := (p->>'puede_generar_codigos')::boolean; end if;
  if p ? 'puede_ver_estado_clientes' then f.puede_ver_estado_clientes := (p->>'puede_ver_estado_clientes')::boolean; end if;
  if p ? 'puede_editar_perfil' then f.puede_editar_perfil := (p->>'puede_editar_perfil')::boolean; end if;
  if p ? 'planes_permitidos' then
    select coalesce(array_agg(distinct x), array[]::text[]) into v_planes from jsonb_array_elements_text(p->'planes_permitidos') x;
    if exists (select 1 from unnest(v_planes) x where x not in ('prueba','premium')) then raise exception 'PERMISO:planes_permitidos'; end if;
    f.planes_permitidos := v_planes;
  end if;
  if p ? 'max_usos_por_codigo' then f.max_usos_por_codigo := (p->>'max_usos_por_codigo')::int; end if;
  if p ? 'max_codigos_mes' then f.max_codigos_mes := (p->>'max_codigos_mes')::int; end if;
  if p ? 'max_dias_expiracion' then f.max_dias_expiracion := (p->>'max_dias_expiracion')::int; end if;
  if p ? 'politica_suspension' then f.politica_suspension := p->>'politica_suspension'; end if;
  if p ? 'comision_pct' then f.comision_pct := nullif(p->>'comision_pct', '')::numeric; end if;
  if p ? 'comision_activa' then f.comision_activa := (p->>'comision_activa')::boolean; end if;
  if f.max_usos_por_codigo is null or f.max_usos_por_codigo not between 1 and 50 then raise exception 'PERMISO:max_usos_por_codigo'; end if;
  if f.max_codigos_mes is null or f.max_codigos_mes not between 0 and 500 then raise exception 'PERMISO:max_codigos_mes'; end if;
  if f.max_dias_expiracion is null or f.max_dias_expiracion not between 1 and 365 then raise exception 'PERMISO:max_dias_expiracion'; end if;
  if f.politica_suspension is null or f.politica_suspension not in ('revocar','conservar') then raise exception 'PERMISO:politica_suspension'; end if;
  if f.comision_pct is not null and (f.comision_pct <= 0 or f.comision_pct > 100) then raise exception 'PERMISO:comision_pct'; end if;
  if f.comision_activa and f.comision_pct is null then raise exception 'PERMISO:comision_pct'; end if;
  if f.puede_generar_codigos is null or f.puede_ver_estado_clientes is null or f.puede_editar_perfil is null or f.comision_activa is null then raise exception 'PERMISO:booleano'; end if;
  return f;
end $$;

-- Límite de intentos genérico: devuelve segundos de bloqueo (0 = libre)
create or replace function public._fl_intento(p_clave text, p_fallo boolean, p_max int, p_minutos int)
returns int language plpgsql security definer set search_path = public as $$
declare i public.plataforma_codigo_intentos;
begin
  insert into public.plataforma_codigo_intentos(clave, ventana_desde) values (p_clave, now()) on conflict (clave) do nothing;
  select * into i from public.plataforma_codigo_intentos where clave = p_clave for update;
  if i.bloqueado_hasta is not null and i.bloqueado_hasta > now() then
    return ceil(extract(epoch from (i.bloqueado_hasta - now())))::int;
  end if;
  if not p_fallo then return 0; end if;
  if i.ventana_desde is null or i.ventana_desde < now() - make_interval(mins => p_minutos) then
    update public.plataforma_codigo_intentos set fallos = 1, ventana_desde = now(), bloqueado_hasta = null where clave = p_clave;
    return 0;
  end if;
  update public.plataforma_codigo_intentos set fallos = fallos + 1,
    bloqueado_hasta = case when fallos + 1 >= p_max then now() + make_interval(mins => p_minutos) else null end
  where clave = p_clave;
  return 0;
end $$;

create or replace function public._fl_ip()
returns text language plpgsql stable set search_path = public as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  return coalesce(nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1)), ''), 'sin-ip');
end $$;

-- ---------------------------------------------------------------------
-- 4. REGISTRO: validar y consumir el código en el servidor
-- ---------------------------------------------------------------------
-- Usado por el trigger de alta. Lanza excepción si el código no sirve,
-- con lo que la cuenta NO se crea (nada queda a medias).
create or replace function public._fl_consumir_codigo(p_uid uuid, p_codigo text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.codigos_acceso; f public.plataforma_freelancers; v_est text;
begin
  select * into c from public.codigos_acceso where upper(codigo) = upper(btrim(p_codigo)) for update;
  if c.id is null then raise exception 'N360_CODIGO_INVALIDO'; end if;
  v_est := public._fl_estado_codigo(c);
  if v_est <> 'disponible' then raise exception 'N360_CODIGO_%', upper(v_est); end if;
  if c.freelancer_id is not null then
    select * into f from public.plataforma_freelancers where id = c.freelancer_id;
    if f.id is null or not (f.estado = 'activo' or (f.estado = 'suspendido' and f.politica_suspension = 'conservar')) then
      raise exception 'N360_CODIGO_REVOCADO';
    end if;
  end if;
  update public.codigos_acceso
     set usos_actuales = usos_actuales + 1,
         activo = case when usos_actuales + 1 >= coalesce(usos_maximos, 1) then false else activo end
   where id = c.id;
  insert into public.plataforma_codigo_usos(codigo_id, codigo, auth_user_id, freelancer_id) values (c.id, c.codigo, p_uid, c.freelancer_id);
  if c.freelancer_id is not null then
    insert into public.plataforma_atribuciones(auth_user_id, freelancer_id, codigo_id, codigo, origen)
    values (p_uid, c.freelancer_id, c.id, c.codigo, 'codigo') on conflict (auth_user_id) do nothing;
    perform public._fl_log(c.freelancer_id, 'cliente_captado', 'cuenta', p_uid::text, 'ok', jsonb_build_object('codigo_id', c.id, 'plan', c.plan));
  end if;
  perform public._fl_log(c.freelancer_id, 'codigo_usado', 'codigo', c.id::text, 'ok', jsonb_build_object('cuenta', p_uid, 'usos', c.usos_actuales + 1, 'maximo', c.usos_maximos));
  return coalesce(c.plan, 'prueba');
end $$;

-- Alta de la cuenta de un freelancer invitado (sin negocio)
create or replace function public._fl_vincular_registro(p_uid uuid, p_email text, p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers;
begin
  select * into f from public.plataforma_freelancers where invitacion_hash = public._fl_hash(p_token) for update;
  if f.id is null or f.auth_user_id is not null or f.estado <> 'pendiente'
     or f.invitacion_expira is null or f.invitacion_expira < now() or lower(f.email) <> lower(btrim(p_email)) then
    raise exception 'N360_INVITACION_INVALIDA';
  end if;
  update public.plataforma_freelancers
     set auth_user_id = p_uid, estado = 'activo', invitacion_hash = null, invitacion_expira = null,
         estado_cambiado_en = now(), updated_at = now()
   where id = f.id;
  perform public._fl_log(f.id, 'cuenta_activada', 'freelancer', f.id::text, 'ok', jsonb_build_object('via', 'registro'));
end $$;

-- Trigger de alta: mismo comportamiento de siempre + código/invitación
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_plan text := coalesce(new.raw_user_meta_data->>'plan', 'premium');
begin
  -- Cuenta de freelancer invitado: no se le crea negocio
  if v_meta->>'tipo_cuenta' = 'freelancer' then
    perform public._fl_vincular_registro(new.id, new.email, v_meta->>'invitacion');
    return new;
  end if;
  -- Registro con código: se valida y se consume aquí (atómico). El plan
  -- sale del código, no de lo que mande el navegador.
  if nullif(btrim(coalesce(v_meta->>'codigo_acceso', '')), '') is not null then
    v_plan := public._fl_consumir_codigo(new.id, v_meta->>'codigo_acceso');
  end if;

  INSERT INTO public.usuarios (
    auth_user_id, email, onboarding_completado, nombre, apellido,
    nombre_negocio, telefono, estado_cuenta, plan, created_at, updated_at
  )
  VALUES (
    NEW.id, NEW.email, FALSE,
    COALESCE(NEW.raw_user_meta_data->>'nombre', ''),
    COALESCE(NEW.raw_user_meta_data->>'apellido', ''),
    COALESCE(NEW.raw_user_meta_data->>'nombre_negocio', ''),
    NEW.raw_user_meta_data->>'whatsapp', 'activa',
    v_plan, NOW(), NOW()
  )
  ON CONFLICT (auth_user_id) DO NOTHING;

  INSERT INTO public.metodos_pago (auth_user_id, nombre, es_default, activo, orden)
  VALUES
    (NEW.id, 'Efectivo',      true,  true, 1),
    (NEW.id, 'Tarjeta',       false, true, 2),
    (NEW.id, 'Transferencia', false, true, 3),
    (NEW.id, 'PayPal',        false, true, 4),
    (NEW.id, 'Otro',          false, true, 5)
  ON CONFLICT (auth_user_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Validación previa (paso 1 de register.html). Con límite de intentos por IP.
create or replace function public.validar_codigo_acceso(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_clave text := 'ip:' || public._fl_ip(); v_seg int; c public.codigos_acceso; f public.plataforma_freelancers; v_est text;
begin
  v_seg := public._fl_intento(v_clave, false, 10, 15);
  if v_seg > 0 then return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'segundos', v_seg); end if;
  if p_codigo is null or length(btrim(p_codigo)) not between 4 and 40 then
    perform public._fl_intento(v_clave, true, 10, 15);
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  select * into c from public.codigos_acceso where upper(codigo) = upper(btrim(p_codigo));
  if c.id is null then
    perform public._fl_intento(v_clave, true, 10, 15);
    perform public._fl_log(null, 'codigo_rechazado', 'codigo', null, 'denegado', jsonb_build_object('motivo', 'no_existe', 'ip', v_clave));
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  v_est := public._fl_estado_codigo(c);
  if v_est = 'disponible' and c.freelancer_id is not null then
    select * into f from public.plataforma_freelancers where id = c.freelancer_id;
    if f.id is null or not (f.estado = 'activo' or (f.estado = 'suspendido' and f.politica_suspension = 'conservar')) then v_est := 'revocado'; end if;
  end if;
  if v_est <> 'disponible' then
    perform public._fl_intento(v_clave, true, 10, 15);
    perform public._fl_log(c.freelancer_id, 'codigo_rechazado', 'codigo', c.id::text, 'denegado', jsonb_build_object('motivo', v_est));
    return jsonb_build_object('ok', false, 'motivo', v_est);
  end if;
  return jsonb_build_object('ok', true, 'plan', coalesce(c.plan, 'prueba'));
end $$;

-- La función vieja consumía el código desde el navegador (se podía
-- saltar o usar para "quemar" códigos ajenos). Ahora el consumo ocurre en
-- el trigger de alta; esta queda sin efecto por compatibilidad.
create or replace function public.consume_codigo_acceso(p_codigo_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  return;
end $$;

-- ---------------------------------------------------------------------
-- 5. PAGOS CONFIRMADOS Y COMISIONES
-- ---------------------------------------------------------------------
-- Cuando un ADMIN marca un ciclo como pagado (usuarios.fecha_ultimo_pago),
-- queda en el libro de pagos. Si el cliente está atribuido a un freelancer
-- con comisión activa, nace UNA comisión "pendiente" (unique por pago).
-- Si el que cambia la fecha no es admin, no cuenta como pago confirmado.
-- Nunca bloquea el pago: cualquier fallo aquí solo deja un aviso.
create or replace function public._fl_registrar_pago()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pago uuid; v_monto numeric; a public.plataforma_atribuciones; f public.plataforma_freelancers;
begin
  if not public.is_admin_activo() then return new; end if;
  begin
    v_monto := coalesce(new.precio_personalizado, 10.00);
    insert into public.plataforma_pagos(auth_user_id, ciclo, monto, registrado_por)
    values (new.auth_user_id, new.fecha_ultimo_pago, v_monto, auth.email())
    on conflict (auth_user_id, ciclo) do nothing
    returning id into v_pago;
    if v_pago is null then return new; end if;  -- reintento del mismo ciclo: nada nuevo
    select * into a from public.plataforma_atribuciones where auth_user_id = new.auth_user_id;
    if a.freelancer_id is null then return new; end if;
    select * into f from public.plataforma_freelancers where id = a.freelancer_id;
    if f.comision_activa and f.comision_pct is not null then
      insert into public.plataforma_freelancer_comisiones(freelancer_id, auth_user_id, pago_id, base, porcentaje, monto)
      values (f.id, new.auth_user_id, v_pago, v_monto, f.comision_pct, round(v_monto * f.comision_pct / 100, 2))
      on conflict (pago_id) do nothing;
      perform public._fl_log(f.id, 'comision_generada', 'pago', v_pago::text, 'ok', jsonb_build_object('base', v_monto, 'pct', f.comision_pct));
    end if;
  exception when others then
    raise warning 'plataforma_pagos: %', sqlerrm;
  end;
  return new;
end $$;

create trigger trg_plataforma_pago
  after update of fecha_ultimo_pago on public.usuarios
  for each row
  when (new.fecha_ultimo_pago is not null and new.fecha_ultimo_pago is distinct from old.fecha_ultimo_pago)
  execute function public._fl_registrar_pago();

-- ---------------------------------------------------------------------
-- 6. FUNCIONES DEL ADMINISTRADOR
-- ---------------------------------------------------------------------
create or replace function public._fl_no_admin(p_accion text, p_fl uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._fl_log(p_fl, p_accion, 'admin', null, 'denegado', jsonb_build_object('motivo', 'no_es_admin'));
  return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
end $$;

create or replace function public.admin_fl_crear(p_nombre text, p_email text, p_telefono text default null, p_identificacion text default null, p_permisos jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; v_tok text; v_email text := lower(btrim(coalesce(p_email, ''))); v_nombre text := btrim(coalesce(p_nombre, ''));
begin
  if not public.is_admin_activo() then return public._fl_no_admin('crear_freelancer', null); end if;
  if length(v_nombre) not between 2 and 80 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 120 then return jsonb_build_object('ok', false, 'motivo', 'email'); end if;
  if exists (select 1 from public.plataforma_freelancers where lower(email) = v_email) then return jsonb_build_object('ok', false, 'motivo', 'email_repetido'); end if;
  if exists (select 1 from public.administradores where lower(email) = v_email) then return jsonb_build_object('ok', false, 'motivo', 'es_admin'); end if;
  f.id := gen_random_uuid(); f.email := v_email; f.nombre := v_nombre;
  f.telefono := nullif(left(btrim(coalesce(p_telefono, '')), 30), '');
  f.identificacion := nullif(left(btrim(coalesce(p_identificacion, '')), 40), '');
  f.estado := 'pendiente'; f.puede_generar_codigos := false; f.planes_permitidos := array['prueba'];
  f.max_usos_por_codigo := 1; f.max_codigos_mes := 20; f.max_dias_expiracion := 30;
  f.puede_ver_estado_clientes := true; f.puede_editar_perfil := true; f.politica_suspension := 'revocar'; f.comision_activa := false;
  begin
    f := public._fl_aplicar_permisos(f, p_permisos);
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'permiso_invalido', 'detalle', sqlerrm);
  end;
  v_tok := 'INV-' || public._fl_aleatorio(4) || '-' || public._fl_aleatorio(4) || '-' || public._fl_aleatorio(4) || '-' || public._fl_aleatorio(4);
  insert into public.plataforma_freelancers(id, email, nombre, telefono, identificacion, estado, puede_generar_codigos, planes_permitidos,
    max_usos_por_codigo, max_codigos_mes, max_dias_expiracion, puede_ver_estado_clientes, puede_editar_perfil, politica_suspension,
    comision_pct, comision_activa, invitacion_hash, invitacion_expira, creado_por)
  values (f.id, f.email, f.nombre, f.telefono, f.identificacion, 'pendiente', f.puede_generar_codigos, f.planes_permitidos,
    f.max_usos_por_codigo, f.max_codigos_mes, f.max_dias_expiracion, f.puede_ver_estado_clientes, f.puede_editar_perfil, f.politica_suspension,
    f.comision_pct, f.comision_activa, public._fl_hash(v_tok), now() + interval '7 days', auth.email());
  select * into f from public.plataforma_freelancers where id = f.id;
  perform public._fl_log(f.id, 'freelancer_creado', 'freelancer', f.id::text, 'ok', jsonb_build_object('despues', public._fl_json(f)));
  return jsonb_build_object('ok', true, 'id', f.id, 'invitacion', v_tok, 'expira', now() + interval '7 days');
end $$;

create or replace function public.admin_fl_nueva_invitacion(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; v_tok text;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('nueva_invitacion', p_id); end if;
  select * into f from public.plataforma_freelancers where id = p_id for update;
  if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if f.auth_user_id is not null or f.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', 'ya_tiene_cuenta'); end if;
  v_tok := 'INV-' || public._fl_aleatorio(4) || '-' || public._fl_aleatorio(4) || '-' || public._fl_aleatorio(4) || '-' || public._fl_aleatorio(4);
  update public.plataforma_freelancers set invitacion_hash = public._fl_hash(v_tok), invitacion_expira = now() + interval '7 days', updated_at = now() where id = p_id;
  perform public._fl_log(p_id, 'invitacion_generada', 'freelancer', p_id::text, 'ok', null);
  return jsonb_build_object('ok', true, 'invitacion', v_tok, 'expira', now() + interval '7 days');
end $$;

create or replace function public.admin_fl_actualizar(p_id uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; n public.plataforma_freelancers; k text;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('editar_freelancer', p_id); end if;
  select * into f from public.plataforma_freelancers where id = p_id for update;
  if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  n := f;
  for k in select jsonb_object_keys(coalesce(p_datos, '{}'::jsonb)) loop
    if k not in ('nombre','telefono','identificacion','notas_admin') then return jsonb_build_object('ok', false, 'motivo', 'campo_no_permitido', 'campo', k); end if;
  end loop;
  if p_datos ? 'nombre' then n.nombre := btrim(coalesce(p_datos->>'nombre', '')); end if;
  if p_datos ? 'telefono' then n.telefono := nullif(btrim(coalesce(p_datos->>'telefono', '')), ''); end if;
  if p_datos ? 'identificacion' then n.identificacion := nullif(btrim(coalesce(p_datos->>'identificacion', '')), ''); end if;
  if p_datos ? 'notas_admin' then n.notas_admin := nullif(btrim(coalesce(p_datos->>'notas_admin', '')), ''); end if;
  if length(n.nombre) not between 2 and 80 or length(coalesce(n.telefono, '')) > 30 or length(coalesce(n.identificacion, '')) > 40 or length(coalesce(n.notas_admin, '')) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  update public.plataforma_freelancers set nombre = n.nombre, telefono = n.telefono, identificacion = n.identificacion, notas_admin = n.notas_admin, updated_at = now() where id = p_id;
  perform public._fl_log(p_id, 'perfil_editado', 'freelancer', p_id::text, 'ok',
    jsonb_build_object('antes', jsonb_build_object('nombre', f.nombre, 'telefono', f.telefono, 'identificacion', f.identificacion),
                       'despues', jsonb_build_object('nombre', n.nombre, 'telefono', n.telefono, 'identificacion', n.identificacion)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_fl_permisos(p_id uuid, p_permisos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; n public.plataforma_freelancers;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('cambiar_permisos', p_id); end if;
  select * into f from public.plataforma_freelancers where id = p_id for update;
  if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  begin
    n := public._fl_aplicar_permisos(f, p_permisos);
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'permiso_invalido', 'detalle', sqlerrm);
  end;
  update public.plataforma_freelancers set
    puede_generar_codigos = n.puede_generar_codigos, planes_permitidos = n.planes_permitidos,
    max_usos_por_codigo = n.max_usos_por_codigo, max_codigos_mes = n.max_codigos_mes, max_dias_expiracion = n.max_dias_expiracion,
    puede_ver_estado_clientes = n.puede_ver_estado_clientes, puede_editar_perfil = n.puede_editar_perfil,
    politica_suspension = n.politica_suspension, comision_pct = n.comision_pct, comision_activa = n.comision_activa, updated_at = now()
  where id = p_id;
  perform public._fl_log(p_id, 'permisos_cambiados', 'freelancer', p_id::text, 'ok', jsonb_build_object(
    'antes', jsonb_build_object('puede_generar_codigos', f.puede_generar_codigos, 'planes_permitidos', f.planes_permitidos, 'max_usos_por_codigo', f.max_usos_por_codigo,
      'max_codigos_mes', f.max_codigos_mes, 'max_dias_expiracion', f.max_dias_expiracion, 'puede_ver_estado_clientes', f.puede_ver_estado_clientes,
      'puede_editar_perfil', f.puede_editar_perfil, 'politica_suspension', f.politica_suspension, 'comision_pct', f.comision_pct, 'comision_activa', f.comision_activa),
    'despues', jsonb_build_object('puede_generar_codigos', n.puede_generar_codigos, 'planes_permitidos', n.planes_permitidos, 'max_usos_por_codigo', n.max_usos_por_codigo,
      'max_codigos_mes', n.max_codigos_mes, 'max_dias_expiracion', n.max_dias_expiracion, 'puede_ver_estado_clientes', n.puede_ver_estado_clientes,
      'puede_editar_perfil', n.puede_editar_perfil, 'politica_suspension', n.politica_suspension, 'comision_pct', n.comision_pct, 'comision_activa', n.comision_activa)));
  return jsonb_build_object('ok', true);
end $$;

-- Suspender / reactivar / desactivar
create or replace function public.admin_fl_estado(p_id uuid, p_estado text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; v_rev int := 0;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('cambiar_estado', p_id); end if;
  if p_estado not in ('activo','suspendido','desactivado') then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
  select * into f from public.plataforma_freelancers where id = p_id for update;
  if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if f.estado = p_estado then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  if p_estado = 'activo' and f.auth_user_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_cuenta'); end if;
  if p_estado in ('suspendido','desactivado') and length(btrim(coalesce(p_motivo, ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido'); end if;
  update public.plataforma_freelancers set estado = p_estado, motivo_estado = nullif(btrim(coalesce(p_motivo, '')), ''), estado_cambiado_en = now(), updated_at = now(),
    invitacion_hash = case when p_estado = 'desactivado' then null else invitacion_hash end,
    invitacion_expira = case when p_estado = 'desactivado' then null else invitacion_expira end
  where id = p_id;
  -- Códigos pendientes según la política (al desactivar se revocan siempre)
  if p_estado = 'desactivado' or (p_estado = 'suspendido' and f.politica_suspension = 'revocar') then
    update public.codigos_acceso set activo = false, revocado_en = now(), revocado_por = 'admin:' || coalesce(auth.email(), '') || ' (' || p_estado || ')'
     where freelancer_id = p_id and revocado_en is null and usos_actuales < coalesce(usos_maximos, 1);
    get diagnostics v_rev = row_count;
  end if;
  perform public._fl_log(p_id, case p_estado when 'activo' then 'reactivado' when 'suspendido' then 'suspendido' else 'desactivado' end,
    'freelancer', p_id::text, 'ok', jsonb_build_object('antes', f.estado, 'despues', p_estado, 'motivo', p_motivo, 'codigos_revocados', v_rev));
  return jsonb_build_object('ok', true, 'codigos_revocados', v_rev);
end $$;

create or replace function public.admin_fl_revocar_codigo(p_codigo_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.codigos_acceso;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('revocar_codigo', null); end if;
  select * into c from public.codigos_acceso where id = p_codigo_id for update;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  if c.revocado_en is not null then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  update public.codigos_acceso set activo = false, revocado_en = now(), revocado_por = 'admin:' || coalesce(auth.email(), ''),
    notas_admin = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), notas_admin) where id = p_codigo_id;
  perform public._fl_log(c.freelancer_id, 'codigo_revocado', 'codigo', c.id::text, 'ok', jsonb_build_object('motivo', p_motivo, 'por', 'admin'));
  return jsonb_build_object('ok', true);
end $$;

-- Cambiar (o retirar, con p_freelancer_id null) el responsable de un cliente
create or replace function public.admin_fl_atribuir(p_auth_user_id uuid, p_freelancer_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.plataforma_atribuciones; f public.plataforma_freelancers;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('cambiar_atribucion', p_freelancer_id); end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido'); end if;
  if not exists (select 1 from public.usuarios where auth_user_id = p_auth_user_id) then return jsonb_build_object('ok', false, 'motivo', 'cliente_no_existe'); end if;
  if p_freelancer_id is not null then
    select * into f from public.plataforma_freelancers where id = p_freelancer_id;
    if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'freelancer_no_existe'); end if;
    if f.auth_user_id = p_auth_user_id then return jsonb_build_object('ok', false, 'motivo', 'propia_cuenta'); end if;
  end if;
  select * into a from public.plataforma_atribuciones where auth_user_id = p_auth_user_id for update;
  if a.auth_user_id is not null and a.freelancer_id is not distinct from p_freelancer_id then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  if a.auth_user_id is null then
    if p_freelancer_id is null then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
    insert into public.plataforma_atribuciones(auth_user_id, freelancer_id, origen, notas_admin) values (p_auth_user_id, p_freelancer_id, 'manual', btrim(p_motivo));
  else
    update public.plataforma_atribuciones set freelancer_id = p_freelancer_id, actualizado_en = now(), notas_admin = btrim(p_motivo) where auth_user_id = p_auth_user_id;
  end if;
  insert into public.plataforma_atribuciones_historial(auth_user_id, freelancer_anterior, freelancer_nuevo, motivo, cambiado_por)
  values (p_auth_user_id, a.freelancer_id, p_freelancer_id, btrim(p_motivo), auth.email());
  perform public._fl_log(coalesce(p_freelancer_id, a.freelancer_id), 'atribucion_cambiada', 'cuenta', p_auth_user_id::text, 'ok',
    jsonb_build_object('antes', a.freelancer_id, 'despues', p_freelancer_id, 'motivo', btrim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

-- Comisiones: aprobar / anular / revertir (pagar solo vía liquidación)
create or replace function public.admin_fl_comisiones_estado(p_ids uuid[], p_estado text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('comision_estado', null); end if;
  if p_estado not in ('aprobada','anulada','revertida') then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
  if p_estado in ('anulada','revertida') and length(btrim(coalesce(p_motivo, ''))) < 3 then return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido'); end if;
  for r in select * from public.plataforma_freelancer_comisiones where id = any(coalesce(p_ids, array[]::uuid[])) for update loop
    if (p_estado = 'aprobada' and r.estado = 'pendiente')
       or (p_estado = 'anulada' and r.estado in ('pendiente','aprobada'))
       or (p_estado = 'revertida' and r.estado = 'pagada') then
      update public.plataforma_freelancer_comisiones set estado = p_estado, motivo = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), motivo), actualizado_en = now() where id = r.id;
      perform public._fl_log(r.freelancer_id, 'comision_' || p_estado, 'comision', r.id::text, 'ok', jsonb_build_object('antes', r.estado, 'despues', p_estado, 'monto', r.monto, 'motivo', p_motivo));
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'cambiadas', v_n);
end $$;

create or replace function public.admin_fl_liquidar(p_freelancer_id uuid, p_ids uuid[], p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_liq uuid; v_total numeric := 0; v_n int := 0;
begin
  if not public.is_admin_activo() then return public._fl_no_admin('liquidar_comisiones', p_freelancer_id); end if;
  perform 1 from public.plataforma_freelancer_comisiones where id = any(coalesce(p_ids, array[]::uuid[])) for update;
  if exists (select 1 from public.plataforma_freelancer_comisiones where id = any(p_ids) and (freelancer_id <> p_freelancer_id or estado <> 'aprobada')) then
    return jsonb_build_object('ok', false, 'motivo', 'solo_aprobadas_del_freelancer');
  end if;
  select coalesce(sum(monto), 0), count(*) into v_total, v_n from public.plataforma_freelancer_comisiones where id = any(p_ids);
  if v_n = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_comisiones'); end if;
  insert into public.plataforma_freelancer_liquidaciones(freelancer_id, total, cantidad, nota, creado_por)
  values (p_freelancer_id, v_total, v_n, nullif(btrim(coalesce(p_nota, '')), ''), auth.email()) returning id into v_liq;
  update public.plataforma_freelancer_comisiones set estado = 'pagada', liquidacion_id = v_liq, actualizado_en = now() where id = any(p_ids);
  perform public._fl_log(p_freelancer_id, 'liquidacion_pagada', 'liquidacion', v_liq::text, 'ok', jsonb_build_object('total', v_total, 'cantidad', v_n));
  return jsonb_build_object('ok', true, 'liquidacion_id', v_liq, 'total', v_total, 'cantidad', v_n);
end $$;

-- Listado con estadísticas por freelancer
create or replace function public.admin_fl_listar()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_activo() then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  return jsonb_build_object('ok', true, 'freelancers', coalesce((
    select jsonb_agg(public._fl_json(f) || jsonb_build_object(
      'tiene_cuenta', f.auth_user_id is not null,
      'invitacion_vigente', f.invitacion_hash is not null and f.invitacion_expira > now(),
      'codigos_total', (select count(*) from public.codigos_acceso c where c.freelancer_id = f.id),
      'codigos_usados', (select count(*) from public.codigos_acceso c where c.freelancer_id = f.id and c.usos_actuales > 0),
      'codigos_disponibles', (select count(*) from public.codigos_acceso c where c.freelancer_id = f.id and public._fl_estado_codigo(c) = 'disponible'),
      'clientes_total', (select count(*) from public.plataforma_atribuciones a where a.freelancer_id = f.id),
      'clientes_activos', (select count(*) from public.plataforma_atribuciones a join public.usuarios u on u.auth_user_id = a.auth_user_id where a.freelancer_id = f.id and u.estado_cuenta = 'activa'),
      'clientes_suspendidos', (select count(*) from public.plataforma_atribuciones a join public.usuarios u on u.auth_user_id = a.auth_user_id where a.freelancer_id = f.id and coalesce(u.estado_cuenta, '') <> 'activa'),
      'pagos_confirmados', (select count(*) from public.plataforma_pagos p join public.plataforma_atribuciones a on a.auth_user_id = p.auth_user_id where a.freelancer_id = f.id),
      'pagos_monto', (select coalesce(sum(p.monto), 0) from public.plataforma_pagos p join public.plataforma_atribuciones a on a.auth_user_id = p.auth_user_id where a.freelancer_id = f.id),
      'comision_pendiente', (select coalesce(sum(monto), 0) from public.plataforma_freelancer_comisiones k where k.freelancer_id = f.id and k.estado = 'pendiente'),
      'comision_aprobada', (select coalesce(sum(monto), 0) from public.plataforma_freelancer_comisiones k where k.freelancer_id = f.id and k.estado = 'aprobada'),
      'comision_pagada', (select coalesce(sum(monto), 0) from public.plataforma_freelancer_comisiones k where k.freelancer_id = f.id and k.estado = 'pagada')
    ) order by f.created_at desc) from public.plataforma_freelancers f), '[]'::jsonb));
end $$;

-- Dashboard global (periodo [p_desde, p_hasta])
create or replace function public.admin_fl_resumen(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d timestamptz := coalesce(p_desde, date '2000-01-01'); h timestamptz := coalesce(p_hasta, current_date) + interval '1 day';
begin
  if not public.is_admin_activo() then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  return jsonb_build_object('ok', true,
    'freelancers', (select jsonb_build_object('total', count(*), 'activos', count(*) filter (where estado = 'activo'), 'suspendidos', count(*) filter (where estado = 'suspendido'),
                      'pendientes', count(*) filter (where estado = 'pendiente'), 'desactivados', count(*) filter (where estado = 'desactivado')) from public.plataforma_freelancers),
    'codigos_generados', (select count(*) from public.codigos_acceso where freelancer_id is not null and created_at >= d and created_at < h),
    'codigos_usados', (select count(*) from public.plataforma_codigo_usos where freelancer_id is not null and usado_en >= d and usado_en < h),
    'clientes_nuevos', (select count(*) from public.plataforma_atribuciones where freelancer_id is not null and captado_en >= d and captado_en < h),
    'clientes_activos', (select count(*) from public.plataforma_atribuciones a join public.usuarios u on u.auth_user_id = a.auth_user_id where a.freelancer_id is not null and u.estado_cuenta = 'activa'),
    'clientes_no_activos', (select count(*) from public.plataforma_atribuciones a join public.usuarios u on u.auth_user_id = a.auth_user_id where a.freelancer_id is not null and coalesce(u.estado_cuenta, '') <> 'activa'),
    'pagos', (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(p.monto), 0),
                'renovaciones', count(*) filter (where exists (select 1 from public.plataforma_pagos p2 where p2.auth_user_id = p.auth_user_id and p2.ciclo < p.ciclo)))
              from public.plataforma_pagos p join public.plataforma_atribuciones a on a.auth_user_id = p.auth_user_id
              where a.freelancer_id is not null and p.created_at >= d and p.created_at < h),
    'comisiones', (select jsonb_build_object('pendiente', coalesce(sum(monto) filter (where estado = 'pendiente'), 0), 'aprobada', coalesce(sum(monto) filter (where estado = 'aprobada'), 0),
                     'pagada', coalesce(sum(monto) filter (where estado = 'pagada'), 0)) from public.plataforma_freelancer_comisiones),
    'ranking', coalesce((select jsonb_agg(x order by x.clientes desc, x.pagos_monto desc) from (
        select f.id, f.nombre, f.estado, f.ultima_actividad,
          (select count(*) from public.plataforma_atribuciones a where a.freelancer_id = f.id and a.captado_en >= d and a.captado_en < h) clientes,
          (select count(*) from public.codigos_acceso c where c.freelancer_id = f.id and c.created_at >= d and c.created_at < h) codigos,
          (select coalesce(sum(p.monto), 0) from public.plataforma_pagos p join public.plataforma_atribuciones a on a.auth_user_id = p.auth_user_id
             where a.freelancer_id = f.id and p.created_at >= d and p.created_at < h) pagos_monto
        from public.plataforma_freelancers f) x), '[]'::jsonb),
    'ultima_actividad', (select max(ultima_actividad) from public.plataforma_freelancers));
end $$;

-- Ficha completa de un freelancer
create or replace function public.admin_fl_detalle(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f public.plataforma_freelancers;
begin
  if not public.is_admin_activo() then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  select * into f from public.plataforma_freelancers where id = p_id;
  if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  return jsonb_build_object('ok', true,
    'freelancer', public._fl_json(f) || jsonb_build_object('tiene_cuenta', f.auth_user_id is not null, 'invitacion_vigente', f.invitacion_hash is not null and f.invitacion_expira > now()),
    'codigos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo, 'plan', c.plan, 'estado', public._fl_estado_codigo(c), 'usos_actuales', c.usos_actuales,
        'usos_maximos', c.usos_maximos, 'fecha_expiracion', c.fecha_expiracion, 'created_at', c.created_at, 'descripcion', c.descripcion, 'revocado_en', c.revocado_en, 'revocado_por', c.revocado_por,
        'cuentas', (select coalesce(jsonb_agg(jsonb_build_object('auth_user_id', u.auth_user_id, 'negocio', us.nombre_negocio, 'usado_en', u.usado_en)), '[]'::jsonb)
                    from public.plataforma_codigo_usos u left join public.usuarios us on us.auth_user_id = u.auth_user_id where u.codigo_id = c.id))
        order by c.created_at desc) from public.codigos_acceso c where c.freelancer_id = f.id), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('auth_user_id', a.auth_user_id, 'negocio', u.nombre_negocio, 'nombre', trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')),
        'email', u.email, 'telefono', u.telefono, 'estado_cuenta', u.estado_cuenta, 'plan', u.plan, 'alta', u.created_at, 'captado_en', a.captado_en, 'codigo', a.codigo, 'origen', a.origen,
        'notas_admin', a.notas_admin, 'ultima_conexion', u.ultima_conexion, 'fecha_vencimiento', u.fecha_vencimiento,
        'pagos', (select count(*) from public.plataforma_pagos p where p.auth_user_id = a.auth_user_id),
        'pagos_monto', (select coalesce(sum(monto), 0) from public.plataforma_pagos p where p.auth_user_id = a.auth_user_id),
        'ultimo_pago', (select max(ciclo) from public.plataforma_pagos p where p.auth_user_id = a.auth_user_id))
        order by a.captado_en desc) from public.plataforma_atribuciones a left join public.usuarios u on u.auth_user_id = a.auth_user_id where a.freelancer_id = f.id), '[]'::jsonb),
    'actividad', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.plataforma_freelancer_auditoria where freelancer_id = f.id order by created_at desc limit 300) x), '[]'::jsonb),
    'comisiones', coalesce((select jsonb_agg(to_jsonb(k) || jsonb_build_object('negocio', u.nombre_negocio, 'ciclo', p.ciclo) order by k.created_at desc)
        from public.plataforma_freelancer_comisiones k join public.plataforma_pagos p on p.id = k.pago_id left join public.usuarios u on u.auth_user_id = k.auth_user_id where k.freelancer_id = f.id), '[]'::jsonb),
    'liquidaciones', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.plataforma_freelancer_liquidaciones l where l.freelancer_id = f.id), '[]'::jsonb),
    'historial_atribuciones', coalesce((select jsonb_agg(to_jsonb(hh) order by hh.created_at desc) from public.plataforma_atribuciones_historial hh where hh.freelancer_anterior = f.id or hh.freelancer_nuevo = f.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 7. FUNCIONES DEL FREELANCER (solo sus propios datos)
-- ---------------------------------------------------------------------
create or replace function public.freelancer_estado()
returns text language sql stable security definer set search_path = public as $$
  select estado from public.plataforma_freelancers where auth_user_id = auth.uid()
$$;

-- Para quien YA tiene cuenta en Negocio360 y fue invitado como freelancer
create or replace function public.freelancer_activar_invitacion(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; v_clave text; v_seg int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'motivo', 'sin_sesion'); end if;
  v_clave := 'inv:' || auth.uid()::text;
  v_seg := public._fl_intento(v_clave, false, 5, 30);
  if v_seg > 0 then return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'segundos', v_seg); end if;
  if exists (select 1 from public.plataforma_freelancers where auth_user_id = auth.uid()) then return jsonb_build_object('ok', false, 'motivo', 'ya_es_freelancer'); end if;
  if public.is_admin_activo() then return jsonb_build_object('ok', false, 'motivo', 'es_admin'); end if;
  select * into f from public.plataforma_freelancers where invitacion_hash = public._fl_hash(p_token) for update;
  if f.id is null or f.auth_user_id is not null or f.estado <> 'pendiente' or f.invitacion_expira < now() or lower(f.email) <> lower(coalesce(auth.email(), '')) then
    perform public._fl_intento(v_clave, true, 5, 30);
    perform public._fl_log(f.id, 'invitacion_rechazada', 'freelancer', null, 'denegado', jsonb_build_object('motivo', case when f.id is null then 'no_existe' else 'no_coincide' end));
    return jsonb_build_object('ok', false, 'motivo', 'invitacion_invalida');
  end if;
  update public.plataforma_freelancers set auth_user_id = auth.uid(), estado = 'activo', invitacion_hash = null, invitacion_expira = null,
    estado_cambiado_en = now(), ultimo_acceso = now(), updated_at = now() where id = f.id;
  perform public._fl_log(f.id, 'cuenta_activada', 'freelancer', f.id::text, 'ok', jsonb_build_object('via', 'cuenta_existente'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.freelancer_evento(p_tipo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers;
begin
  if p_tipo not in ('inicio_sesion','cierre_sesion') then return jsonb_build_object('ok', false, 'motivo', 'tipo'); end if;
  select * into f from public.plataforma_freelancers where auth_user_id = auth.uid();
  if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_es_freelancer'); end if;
  if p_tipo = 'inicio_sesion' then
    update public.plataforma_freelancers set ultimo_acceso = now(), ultima_actividad = now() where id = f.id;
  end if;
  perform public._fl_log(f.id, p_tipo, 'sesion', null, case when f.estado = 'activo' then 'ok' else 'denegado' end, jsonb_build_object('estado', f.estado));
  return jsonb_build_object('ok', true, 'estado', f.estado);
end $$;

create or replace function public.freelancer_mi_panel()
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers;
begin
  select * into f from public.plataforma_freelancers where auth_user_id = auth.uid();
  if f.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_es_freelancer'); end if;
  if f.estado <> 'activo' then
    perform public._fl_log(f.id, 'consulta_panel', 'freelancer', f.id::text, 'denegado', jsonb_build_object('estado', f.estado));
    return jsonb_build_object('ok', false, 'motivo', f.estado, 'nombre', f.nombre);
  end if;
  update public.plataforma_freelancers set ultima_actividad = now() where id = f.id;
  -- Consulta de datos comerciales (máx. un registro cada 30 min)
  if not exists (select 1 from public.plataforma_freelancer_auditoria where freelancer_id = f.id and accion = 'consulta_panel' and created_at > now() - interval '30 minutes') then
    perform public._fl_log(f.id, 'consulta_panel', 'freelancer', f.id::text, 'ok', null);
  end if;
  return jsonb_build_object('ok', true,
    'perfil', jsonb_build_object('nombre', f.nombre, 'email', f.email, 'telefono', f.telefono, 'identificacion', f.identificacion, 'estado', f.estado, 'desde', f.created_at),
    'permisos', jsonb_build_object('puede_generar_codigos', f.puede_generar_codigos, 'planes_permitidos', f.planes_permitidos, 'max_usos_por_codigo', f.max_usos_por_codigo,
       'max_codigos_mes', f.max_codigos_mes, 'max_dias_expiracion', f.max_dias_expiracion, 'puede_ver_estado_clientes', f.puede_ver_estado_clientes,
       'puede_editar_perfil', f.puede_editar_perfil, 'comision_activa', f.comision_activa, 'comision_pct', case when f.comision_activa then f.comision_pct end),
    'codigos_mes', (select count(*) from public.codigos_acceso c where c.freelancer_id = f.id and c.created_at >= date_trunc('month', now())),
    'codigos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo, 'plan', c.plan, 'estado', public._fl_estado_codigo(c), 'usos_actuales', c.usos_actuales,
        'usos_maximos', c.usos_maximos, 'fecha_expiracion', c.fecha_expiracion, 'created_at', c.created_at, 'nota', c.descripcion) order by c.created_at desc)
        from public.codigos_acceso c where c.freelancer_id = f.id), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('negocio', u.nombre_negocio, 'nombre', trim(coalesce(u.nombre, '') || ' ' || left(coalesce(u.apellido, ''), 1)),
        'captado_en', a.captado_en, 'codigo', a.codigo,
        'estado_cuenta', case when f.puede_ver_estado_clientes then u.estado_cuenta end,
        'plan', case when f.puede_ver_estado_clientes then u.plan end,
        'pagos', case when f.puede_ver_estado_clientes then (select count(*) from public.plataforma_pagos p where p.auth_user_id = a.auth_user_id) end)
        order by a.captado_en desc) from public.plataforma_atribuciones a left join public.usuarios u on u.auth_user_id = a.auth_user_id where a.freelancer_id = f.id), '[]'::jsonb),
    'comisiones', coalesce((select jsonb_agg(jsonb_build_object('monto', k.monto, 'base', k.base, 'porcentaje', k.porcentaje, 'estado', k.estado, 'ciclo', p.ciclo,
        'negocio', u.nombre_negocio, 'created_at', k.created_at) order by k.created_at desc)
        from public.plataforma_freelancer_comisiones k join public.plataforma_pagos p on p.id = k.pago_id left join public.usuarios u on u.auth_user_id = k.auth_user_id
        where k.freelancer_id = f.id), '[]'::jsonb),
    'actividad', coalesce((select jsonb_agg(jsonb_build_object('fecha', x.created_at, 'accion', x.accion, 'resultado', x.resultado, 'por', x.actor_tipo) order by x.created_at desc)
        from (select * from public.plataforma_freelancer_auditoria where freelancer_id = f.id order by created_at desc limit 100) x), '[]'::jsonb));
end $$;

create or replace function public.freelancer_generar_codigo(p_plan text, p_dias int default null, p_usos int default 1, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; v_cod text; v_mes int; v_id uuid; v_dias int; i int := 0;
begin
  select * into f from public.plataforma_freelancers where auth_user_id = auth.uid() for update;  -- serializa la cuota del mes
  if f.id is null then
    perform public._fl_log(null, 'generar_codigo', 'codigo', null, 'denegado', jsonb_build_object('motivo', 'no_es_freelancer'));
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if f.estado <> 'activo' then
    perform public._fl_log(f.id, 'generar_codigo', 'codigo', null, 'denegado', jsonb_build_object('motivo', 'cuenta_' || f.estado));
    return jsonb_build_object('ok', false, 'motivo', 'cuenta_' || f.estado);
  end if;
  if not f.puede_generar_codigos then
    perform public._fl_log(f.id, 'generar_codigo', 'codigo', null, 'denegado', jsonb_build_object('motivo', 'sin_permiso'));
    return jsonb_build_object('ok', false, 'motivo', 'sin_permiso');
  end if;
  if p_plan is null or not (p_plan = any(f.planes_permitidos)) then
    perform public._fl_log(f.id, 'generar_codigo', 'codigo', null, 'denegado', jsonb_build_object('motivo', 'plan_no_permitido', 'plan', left(coalesce(p_plan, ''), 20)));
    return jsonb_build_object('ok', false, 'motivo', 'plan_no_permitido');
  end if;
  if p_usos is null or p_usos < 1 or p_usos > f.max_usos_por_codigo then return jsonb_build_object('ok', false, 'motivo', 'usos', 'maximo', f.max_usos_por_codigo); end if;
  v_dias := coalesce(p_dias, f.max_dias_expiracion);
  if v_dias < 1 or v_dias > f.max_dias_expiracion then return jsonb_build_object('ok', false, 'motivo', 'dias', 'maximo', f.max_dias_expiracion); end if;
  select count(*) into v_mes from public.codigos_acceso where freelancer_id = f.id and created_at >= date_trunc('month', now());
  if v_mes >= f.max_codigos_mes then
    perform public._fl_log(f.id, 'generar_codigo', 'codigo', null, 'denegado', jsonb_build_object('motivo', 'limite_mes', 'limite', f.max_codigos_mes));
    return jsonb_build_object('ok', false, 'motivo', 'limite_mes', 'limite', f.max_codigos_mes);
  end if;
  loop
    i := i + 1;
    v_cod := 'FL-' || public._fl_aleatorio(5) || '-' || public._fl_aleatorio(5);
    exit when not exists (select 1 from public.codigos_acceso where upper(codigo) = v_cod);
    if i > 5 then return jsonb_build_object('ok', false, 'motivo', 'reintentar'); end if;
  end loop;
  insert into public.codigos_acceso(codigo, descripcion, activo, usos_maximos, usos_actuales, fecha_expiracion, creado_por, plan, freelancer_id)
  values (v_cod, nullif(left(btrim(coalesce(p_nota, '')), 200), ''), true, p_usos, 0, now() + make_interval(days => v_dias), 'freelancer:' || f.email, p_plan, f.id)
  returning id into v_id;
  update public.plataforma_freelancers set ultima_actividad = now() where id = f.id;
  perform public._fl_log(f.id, 'codigo_generado', 'codigo', v_id::text, 'ok', jsonb_build_object('plan', p_plan, 'usos', p_usos, 'dias', v_dias));
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_cod, 'expira', now() + make_interval(days => v_dias));
end $$;

create or replace function public.freelancer_revocar_codigo(p_codigo_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; c public.codigos_acceso;
begin
  select * into f from public.plataforma_freelancers where auth_user_id = auth.uid();
  if f.id is null or f.estado <> 'activo' then
    perform public._fl_log(f.id, 'revocar_codigo', 'codigo', p_codigo_id::text, 'denegado', jsonb_build_object('motivo', coalesce('cuenta_' || f.estado, 'no_es_freelancer')));
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select * into c from public.codigos_acceso where id = p_codigo_id for update;
  if c.id is null or c.freelancer_id is distinct from f.id then
    perform public._fl_log(f.id, 'revocar_codigo', 'codigo', p_codigo_id::text, 'denegado', jsonb_build_object('motivo', 'codigo_ajeno'));
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if public._fl_estado_codigo(c) <> 'disponible' then return jsonb_build_object('ok', false, 'motivo', 'no_disponible'); end if;
  update public.codigos_acceso set activo = false, revocado_en = now(), revocado_por = 'freelancer:' || f.email where id = c.id;
  perform public._fl_log(f.id, 'codigo_revocado', 'codigo', c.id::text, 'ok', jsonb_build_object('por', 'freelancer'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.freelancer_actualizar_perfil(p_nombre text, p_telefono text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.plataforma_freelancers; v_n text := btrim(coalesce(p_nombre, '')); v_t text := nullif(btrim(coalesce(p_telefono, '')), '');
begin
  select * into f from public.plataforma_freelancers where auth_user_id = auth.uid() for update;
  if f.id is null or f.estado <> 'activo' or not f.puede_editar_perfil then
    perform public._fl_log(f.id, 'editar_perfil', 'freelancer', f.id::text, 'denegado', jsonb_build_object('motivo', case when f.id is null then 'no_es_freelancer' when f.estado <> 'activo' then 'cuenta_' || f.estado else 'sin_permiso' end));
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if length(v_n) not between 2 and 80 or length(coalesce(v_t, '')) > 30 then return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos'); end if;
  update public.plataforma_freelancers set nombre = v_n, telefono = v_t, ultima_actividad = now(), updated_at = now() where id = f.id;
  perform public._fl_log(f.id, 'perfil_editado', 'freelancer', f.id::text, 'ok',
    jsonb_build_object('antes', jsonb_build_object('nombre', f.nombre, 'telefono', f.telefono), 'despues', jsonb_build_object('nombre', v_n, 'telefono', v_t)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 8. PERMISOS DE EJECUCIÓN
-- ---------------------------------------------------------------------
-- Ayudantes internos: nadie los llama desde el navegador
revoke execute on function public._fl_aleatorio(int) from public, anon, authenticated;
revoke execute on function public._fl_hash(text) from public, anon, authenticated;
revoke execute on function public._fl_log(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._fl_json(public.plataforma_freelancers) from public, anon, authenticated;
revoke execute on function public._fl_estado_codigo(public.codigos_acceso) from public, anon, authenticated;
revoke execute on function public._fl_aplicar_permisos(public.plataforma_freelancers, jsonb) from public, anon, authenticated;
revoke execute on function public._fl_intento(text, boolean, int, int) from public, anon, authenticated;
revoke execute on function public._fl_ip() from public, anon, authenticated;
revoke execute on function public._fl_consumir_codigo(uuid, text) from public, anon, authenticated;
revoke execute on function public._fl_vincular_registro(uuid, text, text) from public, anon, authenticated;
revoke execute on function public._fl_registrar_pago() from public, anon, authenticated;
revoke execute on function public._fl_no_admin(text, uuid) from public, anon, authenticated;
-- Admin y freelancer: solo con sesión (cada función valida además quién es)
revoke execute on function public.admin_fl_crear(text, text, text, text, jsonb) from public, anon;
revoke execute on function public.admin_fl_nueva_invitacion(uuid) from public, anon;
revoke execute on function public.admin_fl_actualizar(uuid, jsonb) from public, anon;
revoke execute on function public.admin_fl_permisos(uuid, jsonb) from public, anon;
revoke execute on function public.admin_fl_estado(uuid, text, text) from public, anon;
revoke execute on function public.admin_fl_revocar_codigo(uuid, text) from public, anon;
revoke execute on function public.admin_fl_atribuir(uuid, uuid, text) from public, anon;
revoke execute on function public.admin_fl_comisiones_estado(uuid[], text, text) from public, anon;
revoke execute on function public.admin_fl_liquidar(uuid, uuid[], text) from public, anon;
revoke execute on function public.admin_fl_listar() from public, anon;
revoke execute on function public.admin_fl_resumen(date, date) from public, anon;
revoke execute on function public.admin_fl_detalle(uuid) from public, anon;
revoke execute on function public.freelancer_estado() from public, anon;
revoke execute on function public.freelancer_activar_invitacion(text) from public, anon;
revoke execute on function public.freelancer_evento(text) from public, anon;
revoke execute on function public.freelancer_mi_panel() from public, anon;
revoke execute on function public.freelancer_generar_codigo(text, int, int, text) from public, anon;
revoke execute on function public.freelancer_revocar_codigo(uuid) from public, anon;
revoke execute on function public.freelancer_actualizar_perfil(text, text) from public, anon;
grant execute on function public.admin_fl_crear(text, text, text, text, jsonb), public.admin_fl_nueva_invitacion(uuid), public.admin_fl_actualizar(uuid, jsonb),
  public.admin_fl_permisos(uuid, jsonb), public.admin_fl_estado(uuid, text, text), public.admin_fl_revocar_codigo(uuid, text), public.admin_fl_atribuir(uuid, uuid, text),
  public.admin_fl_comisiones_estado(uuid[], text, text), public.admin_fl_liquidar(uuid, uuid[], text), public.admin_fl_listar(), public.admin_fl_resumen(date, date),
  public.admin_fl_detalle(uuid), public.freelancer_estado(), public.freelancer_activar_invitacion(text), public.freelancer_evento(text), public.freelancer_mi_panel(),
  public.freelancer_generar_codigo(text, int, int, text), public.freelancer_revocar_codigo(uuid), public.freelancer_actualizar_perfil(text, text) to authenticated;
-- Validación del código: pública (con límite de intentos)
grant execute on function public.validar_codigo_acceso(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. AUDITORÍA INMUTABLE: ni siquiera una función puede modificarla
-- ---------------------------------------------------------------------
create or replace function public._fl_auditoria_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'La auditoría de freelancers es de solo lectura';
end $$;
create trigger trg_fl_auditoria_inmutable
  before update or delete or truncate on public.plataforma_freelancer_auditoria
  for each statement execute function public._fl_auditoria_inmutable();
revoke update, delete, truncate on public.plataforma_freelancer_auditoria from anon, authenticated;
