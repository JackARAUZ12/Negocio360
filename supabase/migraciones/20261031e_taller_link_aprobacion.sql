-- =====================================================================
-- TALLER · Fase 2 · LINK DE APROBACIÓN PARA EL CLIENTE
-- El taller manda un link (por WhatsApp). El cliente, SIN cuenta, ve el presupuesto y aprueba o rechaza
-- línea por línea desde su celular. Solo AGREGA una tabla y cuatro funciones; no cambia nada existente.
--
-- SEGURIDAD
--  * El link lleva un código aleatorio de ~240 bits (imposible de adivinar). En la base solo se guarda su
--    "huella" (SHA-256), nunca el código. Vence (7 días por defecto) y se puede revocar; al crear uno nuevo
--    el anterior deja de servir. Si la orden se entrega o cancela, el link deja de servir.
--  * Lo único abierto al público son DOS funciones: ver y decidir. Ven SOLO lo que el cliente necesita:
--    nunca costos, observaciones internas, datos de otros clientes ni de otras órdenes.
--  * El cliente solo puede decidir líneas PENDIENTES de SU orden. Lo ya decidido no se puede cambiar por el
--    link. No puede tocar precios, ni cobrar, ni cambiar estados (salvo que la orden pasa sola a "En
--    reparación" cuando ya no queda nada pendiente y hay algo aprobado).
--  * Todo queda en la bitácora de la orden con el nombre que el cliente escribió.
-- =====================================================================

create table if not exists public.taller_links (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  orden_id     uuid not null references public.taller_ordenes(id) on delete cascade,
  token_hash   text not null unique,
  expira_at    timestamptz not null,
  revocado_at  timestamptz,
  vistas       integer not null default 0,
  visto_at     timestamptz,
  creado_por   text check (creado_por is null or char_length(creado_por) <= 120),
  created_at   timestamptz not null default now()
);
create index if not exists taller_links_orden_idx on public.taller_links(orden_id, created_at desc);
alter table public.taller_links enable row level security;
drop policy if exists taller_links_ver on public.taller_links;
create policy taller_links_ver on public.taller_links for select using (auth_user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.taller_links from anon, authenticated;
revoke select on public.taller_links from anon;

-- ---------- Dueño: crear el link (devuelve el código UNA vez) ----------
create or replace function public.taller_link_crear(p_orden_id uuid, p_dias integer default 7, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); o record; v_tok text; v_exp timestamptz;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  if coalesce(p_dias, 7) < 1 or coalesce(p_dias, 7) > 30 then return jsonb_build_object('ok', false, 'motivo', 'dias'); end if;
  update public.taller_links set revocado_at = now() where orden_id = o.id and auth_user_id = v_uid and revocado_at is null;
  v_tok := 'tk' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => coalesce(p_dias, 7));
  insert into public.taller_links(auth_user_id, orden_id, token_hash, expira_at, creado_por)
  values (v_uid, o.id, encode(sha256(convert_to(v_tok, 'utf8')), 'hex'), v_exp, left(nullif(btrim(coalesce(p_por, '')), ''), 120));
  perform public._taller_log(v_uid, o.id, 'Link de aprobación creado', 'Vence ' || to_char(v_exp at time zone 'America/Managua', 'DD/MM/YYYY'), p_por);
  return jsonb_build_object('ok', true, 'token', v_tok, 'expira_at', v_exp);
end;
$f$;

create or replace function public.taller_link_revocar(p_orden_id uuid, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); n integer;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  update public.taller_links set revocado_at = now() where orden_id = p_orden_id and auth_user_id = v_uid and revocado_at is null;
  get diagnostics n = row_count;
  if n > 0 then perform public._taller_log(v_uid, p_orden_id, 'Link de aprobación revocado', null, p_por); end if;
  return jsonb_build_object('ok', true, 'revocados', n);
end;
$f$;

-- ---------- Público: ver el presupuesto con el código ----------
create or replace function public.taller_link_ver(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare l record; o record; v record; e record; v_lineas jsonb; v_pend integer;
begin
  if p_token is null or char_length(p_token) < 40 or char_length(p_token) > 100 then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select * into l from public.taller_links where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  if not found or l.revocado_at is not null then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  if l.expira_at < now() then return jsonb_build_object('ok', false, 'motivo', 'vencido'); end if;
  select * into o from public.taller_ordenes where id = l.orden_id and auth_user_id = l.auth_user_id;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  if not public._taller_activo(l.auth_user_id) then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  select placa, marca, modelo, anio, color into v from public.taller_vehiculos where id = o.vehiculo_id;
  select nombre_comercial, telefono, moneda, color_principal into e from public.configuracion_empresa where auth_user_id = l.auth_user_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'descripcion', x.descripcion, 'cantidad', x.cantidad, 'precio_unitario', x.precio_unitario,
                                               'descuento', x.descuento, 'subtotal', x.subtotal, 'aprobacion', x.aprobacion, 'adicional', x.adicional) order by x.created_at, x.id), '[]'::jsonb),
         count(*) filter (where x.aprobacion = 'pendiente')
    into v_lineas, v_pend from public.taller_orden_lineas x where x.orden_id = o.id;
  update public.taller_links set vistas = vistas + 1, visto_at = now() where id = l.id;
  return jsonb_build_object('ok', true,
    'negocio', jsonb_build_object('nombre', e.nombre_comercial, 'telefono', e.telefono, 'moneda', e.moneda, 'color', e.color_principal),
    'orden', jsonb_build_object('numero', o.numero, 'estado', o.estado, 'falla', o.falla_reportada, 'diagnostico', o.diagnostico),
    'vehiculo', jsonb_build_object('placa', v.placa, 'marca', v.marca, 'modelo', v.modelo, 'anio', v.anio, 'color', v.color),
    'lineas', v_lineas, 'pendientes', v_pend,
    'totales', jsonb_build_object('subtotal', o.subtotal, 'descuento', o.descuento, 'impuesto', o.impuesto, 'total', o.total, 'total_estimado', o.total_estimado,
                                  'iva_activo', o.iva_activo, 'iva_porcentaje', o.iva_porcentaje),
    'expira_at', l.expira_at);
end;
$f$;

-- ---------- Público: el cliente aprueba o rechaza líneas pendientes ----------
create or replace function public.taller_link_decidir(p_token text, p_linea_ids uuid[], p_decision text, p_nombre text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare l record; o record; n integer; v_nom text := btrim(coalesce(p_nombre, '')); v_pend integer; v_apr integer; v_est text;
begin
  if p_token is null or char_length(p_token) < 40 or char_length(p_token) > 100 then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  if p_decision not in ('aprobada', 'rechazada') then return jsonb_build_object('ok', false, 'motivo', 'decision'); end if;
  if char_length(v_nom) < 2 or char_length(v_nom) > 80 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if p_linea_ids is null or coalesce(array_length(p_linea_ids, 1), 0) = 0 or array_length(p_linea_ids, 1) > 100 then return jsonb_build_object('ok', false, 'motivo', 'sin_lineas'); end if;
  select * into l from public.taller_links where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  if not found or l.revocado_at is not null then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  if l.expira_at < now() then return jsonb_build_object('ok', false, 'motivo', 'vencido'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || l.orden_id::text));
  select * into o from public.taller_ordenes where id = l.orden_id and auth_user_id = l.auth_user_id for update;
  if not found or not public._taller_activo(l.auth_user_id) then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  update public.taller_orden_lineas set aprobacion = p_decision, decidido_por = left('Cliente: ' || v_nom || ' (link)', 120), decidido_at = now(), updated_at = now()
   where orden_id = o.id and auth_user_id = l.auth_user_id and id = any (p_linea_ids) and aprobacion = 'pendiente';
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'ya_decididas'); end if;
  perform public._taller_recalcular(l.auth_user_id, o.id);
  perform public._taller_log(l.auth_user_id, o.id, 'Cliente ' || case p_decision when 'aprobada' then 'aprobó' else 'rechazó' end || ' (link)', n || ' línea(s)', 'Cliente: ' || v_nom);
  select count(*) filter (where aprobacion = 'pendiente'), count(*) filter (where aprobacion = 'aprobada') into v_pend, v_apr from public.taller_orden_lineas where orden_id = o.id;
  v_est := o.estado;
  if o.estado = 'esperando_aprobacion' and v_pend = 0 and v_apr > 0 then
    update public.taller_ordenes set estado = 'en_reparacion', updated_at = now() where id = o.id;
    v_est := 'en_reparacion';
    perform public._taller_log(l.auth_user_id, o.id, 'Pasó a En reparación', 'El cliente decidió todo por el link', 'Sistema');
  end if;
  return jsonb_build_object('ok', true, 'lineas', n, 'pendientes', v_pend, 'estado', v_est);
end;
$f$;

revoke all on function public.taller_link_crear(uuid, integer, text) from public, anon;
revoke all on function public.taller_link_revocar(uuid, text) from public, anon;
revoke all on function public.taller_link_ver(text) from public;
revoke all on function public.taller_link_decidir(text, uuid[], text, text) from public;
grant execute on function public.taller_link_crear(uuid, integer, text) to authenticated;
grant execute on function public.taller_link_revocar(uuid, text) to authenticated;
grant execute on function public.taller_link_ver(text) to anon, authenticated;
grant execute on function public.taller_link_decidir(text, uuid[], text, text) to anon, authenticated;
