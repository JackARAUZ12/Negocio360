-- ============================================================================
-- Portal de clientes: el dueño puede VER el PIN de cada cliente cuando quiera.
-- El PIN se guarda cifrado con una clave del Vault (no en texto plano) y solo
-- lo devuelve tx_portal_lista / tx_portal_gestionar al dueño de la cuenta.
-- La entrada del cliente sigue validando contra el hash (sin cambios).
-- ============================================================================
do $c$ begin
  if not exists (select 1 from vault.secrets where name = 'tx_portal_pin_clave') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tx_portal_pin_clave', 'Clave para cifrar los PIN del Portal de clientes de Transporte');
  end if;
end $c$;

alter table public.transporte_portal_accesos add column if not exists pin_cifrado bytea;

create or replace function public._tx_pin_clave() returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'tx_portal_pin_clave' limit 1 $$;
revoke all on function public._tx_pin_clave() from public, anon, authenticated;

create or replace function public.tx_portal_lista()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'accesos', coalesce((
    select jsonb_agg(jsonb_build_object('cliente_id', a.cliente_id, 'token', a.token, 'activo', a.activo,
             'mostrar_placa', a.mostrar_placa, 'mostrar_conductor', a.mostrar_conductor,
             'ultimo_ingreso', a.ultimo_ingreso, 'ingresos', a.ingresos,
             'pin', case when a.pin_cifrado is not null then extensions.pgp_sym_decrypt(a.pin_cifrado, public._tx_pin_clave()) end,
             'bloqueado', a.bloqueado_hasta is not null and a.bloqueado_hasta > now(), 'creado', a.created_at))
      from public.transporte_portal_accesos a where a.auth_user_id = v_uid), '[]'::jsonb));
end $$;

-- 4) Dueño de la cuenta: crear / nuevo PIN / nuevo enlace / apagar / encender / opciones
create or replace function public.tx_portal_gestionar(p_cliente uuid, p_accion text, p_pin text default null, p_opciones jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); a record; v_pin text; v_tok text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not coalesce((select usa_modulo_transporte from public.configuracion_empresa where auth_user_id = v_uid), false) then
    return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if not exists (select 1 from public.clientes where id = p_cliente and auth_user_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  if p_accion not in ('crear', 'nuevo_pin', 'nuevo_enlace', 'apagar', 'encender', 'opciones') then
    return jsonb_build_object('ok', false, 'motivo', 'accion'); end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'motivo', 'pin_formato'); end if;

  perform pg_advisory_xact_lock(hashtext('tx_portal_' || p_cliente::text));
  select * into a from public.transporte_portal_accesos where auth_user_id = v_uid and cliente_id = p_cliente;

  if p_accion = 'crear' then
    if found then  -- ya existe: lo enciende y conserva su PIN (si no se puede leer, crea uno nuevo)
      if a.pin_cifrado is not null and p_pin is null then
        update public.transporte_portal_accesos set activo = true, updated_at = now() where id = a.id;
        return jsonb_build_object('ok', true, 'token', a.token, 'pin', pgp_sym_decrypt(a.pin_cifrado, public._tx_pin_clave()));
      end if;
      v_pin := coalesce(p_pin, public._tx_portal_pin());
      update public.transporte_portal_accesos set activo = true, pin_hash = crypt(v_pin, gen_salt('bf', 8)), pin_cifrado = pgp_sym_encrypt(v_pin, public._tx_pin_clave()),
             intentos_fallidos = 0, bloqueado_hasta = null, updated_at = now() where id = a.id;
      return jsonb_build_object('ok', true, 'token', a.token, 'pin', v_pin);
    end if;
    v_pin := coalesce(p_pin, public._tx_portal_pin()); v_tok := public._tx_portal_token();
    insert into public.transporte_portal_accesos(auth_user_id, cliente_id, token, pin_hash, pin_cifrado)
      values (v_uid, p_cliente, v_tok, crypt(v_pin, gen_salt('bf', 8)), pgp_sym_encrypt(v_pin, public._tx_pin_clave()));
    return jsonb_build_object('ok', true, 'token', v_tok, 'pin', v_pin, 'nuevo', true);
  end if;

  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_acceso'); end if;

  if p_accion = 'nuevo_pin' then
    v_pin := coalesce(p_pin, public._tx_portal_pin());
    update public.transporte_portal_accesos set pin_hash = crypt(v_pin, gen_salt('bf', 8)), pin_cifrado = pgp_sym_encrypt(v_pin, public._tx_pin_clave()), intentos_fallidos = 0,
           bloqueado_hasta = null, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', a.token, 'pin', v_pin);
  elsif p_accion = 'nuevo_enlace' then
    v_tok := public._tx_portal_token();
    update public.transporte_portal_accesos set token = v_tok, intentos_fallidos = 0, bloqueado_hasta = null, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', v_tok, 'pin', case when a.pin_cifrado is not null then pgp_sym_decrypt(a.pin_cifrado, public._tx_pin_clave()) end);
  elsif p_accion = 'apagar' then
    update public.transporte_portal_accesos set activo = false, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true);
  elsif p_accion = 'encender' then
    update public.transporte_portal_accesos set activo = true, updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', a.token, 'pin', case when a.pin_cifrado is not null then pgp_sym_decrypt(a.pin_cifrado, public._tx_pin_clave()) end);
  else -- opciones
    update public.transporte_portal_accesos set
      mostrar_placa = coalesce((p_opciones->>'mostrar_placa')::boolean, mostrar_placa),
      mostrar_conductor = coalesce((p_opciones->>'mostrar_conductor')::boolean, mostrar_conductor),
      updated_at = now() where id = a.id;
    return jsonb_build_object('ok', true);
  end if;
end $$;

