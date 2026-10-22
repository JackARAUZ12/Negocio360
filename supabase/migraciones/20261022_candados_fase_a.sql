-- =====================================================================
-- CANDADOS FASE A (auditoría 21-oct-2026) · Fecha: 22-oct-2026
-- Solo AGREGA protecciones. No cambia ni borra ningún dato.
--
-- 1) Registros de dinero: desde la página (o la consola del navegador)
--    ya NO se pueden BORRAR movimientos de Caja, abonos de crédito,
--    pagos a proveedores, pagos de fiado, fiados, movimientos de IVA ni
--    la bitácora. Ventas y créditos: solo se pueden borrar en sus
--    primeros 15 minutos (lo usa el sistema para deshacer un guardado
--    que falló a la mitad). Cuentas por pagar: solo si no tienen pagos.
--    Lo correcto siempre es ANULAR (queda el rastro).
-- 2) A un movimiento de Caja ya guardado no se le puede cambiar el
--    monto, el tipo (ingreso/egreso), el dueño ni los saldos. Sí se
--    puede anular, cambiar fecha, conciliar, etc. (lo que la app hace).
--    Lo mismo para monto/saldos de movimientos de IVA.
--    Las funciones del servidor (anular, recalcular, convertir moneda,
--    eliminar cuenta, etc.), los administradores y el editor SQL siguen
--    pudiendo hacerlo, porque sus cambios están controlados.
-- 3) Bitácora (auditoria_log): se quita el permiso de borrarla.
-- 4) Notificaciones generales: solo un administrador puede borrarlas
--    (antes cualquier cliente podía borrar las de más de 30 días).
-- 5) Códigos de catálogo: límite de intentos fallidos (anti fuerza
--    bruta) y la consulta de límites solo responde por la propia cuenta.
-- =====================================================================

-- ¿El cambio viene del servidor (otra función/trigger) y no directo
-- de la página? En un trigger, PG_CONTEXT trae una sola línea (este
-- mismo trigger) cuando la orden vino directo del cliente; si vino desde
-- una función del servidor, trae también las líneas de esa función.
create or replace function public._n360_candado_dinero()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx text;
  v_msg text := 'Por seguridad este registro de dinero no se puede %s. Anúlalo desde su módulo (así queda el rastro).';
begin
  if auth.uid() is null
     or coalesce(current_setting('n360.mantenimiento_demo', true), '') = 'on'
     or public.is_admin_activo() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  get diagnostics v_ctx = pg_context;
  if position(E'\n' in coalesce(v_ctx, '')) > 0 then
    return case when tg_op = 'DELETE' then old else new end;   -- viene de una función del servidor
  end if;

  if tg_op = 'DELETE' then
    if tg_table_name in ('ventas', 'creditos') then
      if old.created_at < now() - interval '15 minutes' then
        raise exception using errcode = 'P0001', message = format(v_msg, 'borrar');
      end if;
    elsif tg_table_name = 'cuentas_por_pagar' then
      if coalesce(old.monto_pagado, 0) > 0 then
        raise exception using errcode = 'P0001', message = format(v_msg, 'borrar') || ' Primero anula sus pagos.';
      end if;
    else
      raise exception using errcode = 'P0001', message = format(v_msg, 'borrar');
    end if;
    return old;
  end if;

  -- UPDATE (solo movimientos de Caja y de IVA)
  if tg_table_name = 'movimientos_financieros' then
    if new.monto is distinct from old.monto or new.tipo_flujo is distinct from old.tipo_flujo
       or new.auth_user_id is distinct from old.auth_user_id
       or new.saldo_anterior is distinct from old.saldo_anterior
       or new.saldo_resultante is distinct from old.saldo_resultante then
      raise exception using errcode = 'P0001', message = format(v_msg, 'cambiar de monto');
    end if;
  elsif tg_table_name = 'movimientos_impuestos' then
    if new.monto is distinct from old.monto or new.auth_user_id is distinct from old.auth_user_id
       or new.saldo_anterior is distinct from old.saldo_anterior
       or new.saldo_resultante is distinct from old.saldo_resultante then
      raise exception using errcode = 'P0001', message = format(v_msg, 'cambiar de monto');
    end if;
  end if;
  return new;
end $$;

create trigger trg_candado_borrar before delete on public.movimientos_financieros for each row execute function public._n360_candado_dinero();
create trigger trg_candado_monto  before update of monto, tipo_flujo, auth_user_id, saldo_anterior, saldo_resultante on public.movimientos_financieros for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.movimientos_impuestos   for each row execute function public._n360_candado_dinero();
create trigger trg_candado_monto  before update of monto, auth_user_id, saldo_anterior, saldo_resultante on public.movimientos_impuestos for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.ventas                  for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.creditos                for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.creditos_pagos          for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.cuentas_por_pagar       for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.cuentas_por_pagar_pagos for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.fiados                  for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.fiado_pagos             for each row execute function public._n360_candado_dinero();
create trigger trg_candado_borrar before delete on public.auditoria_log           for each row execute function public._n360_candado_dinero();

-- 3) Bitácora: nadie la borra desde la app
drop policy if exists auditoria_log_delete on public.auditoria_log;

-- 4) Notificaciones generales: solo administradores las borran
alter policy notificaciones_delete on public.notificaciones using (public.is_admin_activo());

-- 5) Códigos de catálogo: límite de intentos fallidos
create table if not exists public.intentos_codigo (
  id bigint generated always as identity primary key,
  clave text not null,
  creado_en timestamptz not null default now()
);
create index if not exists intentos_codigo_clave_idx on public.intentos_codigo (clave, creado_en);
alter table public.intentos_codigo enable row level security;   -- sin políticas: nadie la lee desde la app
revoke all on public.intentos_codigo from anon, authenticated;

-- true = puede intentar; registra el intento fallido aparte
create or replace function public._codigo_puede_intentar(p_tipo text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_ip text := split_part(coalesce((nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'), 'sin-ip'), ',', 1);
  v_clave text := p_tipo || ':' || trim(v_ip);
begin
  -- máximo 10 fallos por conexión y 300 en total cada 15 minutos
  if (select count(*) from intentos_codigo where clave = v_clave and creado_en > now() - interval '15 minutes') >= 10 then return false; end if;
  if (select count(*) from intentos_codigo where clave like p_tipo || ':%' and creado_en > now() - interval '15 minutes') >= 300 then return false; end if;
  return true;
end $$;

create or replace function public._codigo_registrar_fallo(p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ip text := split_part(coalesce((nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'), 'sin-ip'), ',', 1);
begin
  insert into intentos_codigo (clave) values (p_tipo || ':' || trim(v_ip));
  delete from intentos_codigo where creado_en < now() - interval '1 day';
end $$;
revoke all on function public._codigo_puede_intentar(text) from public, anon, authenticated;
revoke all on function public._codigo_registrar_fallo(text) from public, anon, authenticated;

create or replace function public.catalogo360_verificar_codigo(p_codigo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_codigo_normalizado text := upper(trim(p_codigo));
  v_fila catalogo360_codigos%rowtype;
begin
  if v_codigo_normalizado is null or v_codigo_normalizado = '' then
    return jsonb_build_object('valido', false, 'mensaje', 'Escribe un código');
  end if;
  if not public._codigo_puede_intentar('catalogo360') then
    return jsonb_build_object('valido', false, 'mensaje', 'Demasiados intentos. Espera 15 minutos y vuelve a probar.');
  end if;

  select * into v_fila from catalogo360_codigos where upper(codigo) = v_codigo_normalizado;

  if not found then
    perform public._codigo_registrar_fallo('catalogo360');
    return jsonb_build_object('valido', false, 'mensaje', 'Código no válido');
  end if;
  if not v_fila.activo then
    return jsonb_build_object('valido', false, 'mensaje', 'Este código ya no está activo');
  end if;
  if v_fila.fecha_expiracion is not null and v_fila.fecha_expiracion < now() then
    return jsonb_build_object('valido', false, 'mensaje', 'Este código ya expiró');
  end if;
  if v_fila.usos_maximos is not null and v_fila.usos_actuales >= v_fila.usos_maximos then
    return jsonb_build_object('valido', false, 'mensaje', 'Este código ya alcanzó su límite de usos');
  end if;

  return jsonb_build_object('valido', true, 'mensaje', 'Código válido');
end;
$function$;

create or replace function public.catalogo_validar_codigo(p_codigo text)
returns table(valido boolean, plan_key text, motivo text) language plpgsql security definer set search_path to 'public' as $function$
declare
  v_fila record;
begin
  if not public._codigo_puede_intentar('catalogo') then
    return query select false, null::text, 'Demasiados intentos. Espera 15 minutos y vuelve a probar.';
    return;
  end if;
  select * into v_fila from public.catalogo_codigos_activacion where codigo = p_codigo;
  if v_fila is null then
    perform public._codigo_registrar_fallo('catalogo');
    return query select false, null::text, 'Código no encontrado';
  elsif v_fila.usado then
    return query select false, null::text, 'Este código ya fue utilizado';
  elsif v_fila.expira_en is not null and v_fila.expira_en < now() then
    return query select false, null::text, 'Este código ya expiró';
  else
    return query select true, v_fila.plan_key, 'ok';
  end if;
end;
$function$;

-- Solo responde por la propia cuenta (o el servidor / un administrador)
create or replace function public.catalogo_puede_crear_catalogo(p_auth_user_id uuid)
returns boolean language sql security definer set search_path to 'public' as $function$
  select (auth.uid() is null or p_auth_user_id = auth.uid() or public.is_admin_activo())
     and (select count(*) from public.catalogos where auth_user_id = p_auth_user_id)
       < (select catalogos_max from public.catalogo_obtener_limites(p_auth_user_id));
$function$;
revoke execute on function public.catalogo_puede_crear_catalogo(uuid) from anon;
