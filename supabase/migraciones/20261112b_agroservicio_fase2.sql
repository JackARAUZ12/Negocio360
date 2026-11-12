-- =====================================================================
-- AGROSERVICIO · Fase 2 (12-nov-2026) — Solo AGREGA; todo apagado fuera de cuentas Agro.
--  1. Interés por mora (opcional, % mensual; 0 = apagado). Se carga a mano por productor
--     desde Cobros: queda como una venta de servicio "Interés por mora" fiada al productor,
--     así cuenta como ingreso y su cobro entra a Caja por Fiados (sin cuentas paralelas).
--     No se cobra dos veces el mismo período (fecha "cargada hasta").
--  2. Pago de la cosecha en 2 partes (segunda fecha y % de la primera parte).
--  3. Recomendación con "repetir en N días" (para el recordatorio de la próxima aplicación).
--  4. Recordatorios: registro de "enviado" para no repetir el mismo aviso.
-- =====================================================================
alter table public.configuracion_empresa add column if not exists agro_mora_pct_mensual numeric not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ce_agro_mora_pct_chk') then
    alter table public.configuracion_empresa add constraint ce_agro_mora_pct_chk check (agro_mora_pct_mensual >= 0 and agro_mora_pct_mensual <= 10) not valid;
  end if;
end $$;
alter table public.agro_productores add column if not exists fecha_cosecha_2 date;
alter table public.agro_productores add column if not exists pago1_pct numeric not null default 50;
alter table public.agro_productores add column if not exists mora_cargada_hasta date;
alter table public.agro_recomendaciones add column if not exists intervalo_dias integer;

create table if not exists public.agro_recordatorios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  tipo text not null check (tipo in ('cobro', 'aplicacion')),
  ref text not null,
  cliente_id uuid,
  enviado_por text,
  enviado_at timestamptz not null default now(),
  unique (auth_user_id, tipo, ref)
);
alter table public.agro_recordatorios enable row level security;
drop policy if exists agro_recordatorios_ver on public.agro_recordatorios;
create policy agro_recordatorios_ver on public.agro_recordatorios for select using (auth_user_id = auth.uid());

create or replace function public.agro_recordatorio_marcar(p_tipo text, p_ref text, p_cliente_id uuid, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._agro_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if p_tipo not in ('cobro', 'aplicacion') or nullif(trim(coalesce(p_ref, '')), '') is null then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  insert into public.agro_recordatorios (auth_user_id, tipo, ref, cliente_id, enviado_por)
  values (v_uid, p_tipo, left(p_ref, 200), p_cliente_id, left(p_usuario, 100))
  on conflict (auth_user_id, tipo, ref) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.agro_recordatorio_marcar(text, text, uuid, text) from public, anon;
grant execute on function public.agro_recordatorio_marcar(text, text, uuid, text) to authenticated;

-- 🔒 Límite / cosecha vencida: con pago en 2 partes cuenta la ÚLTIMA fecha. El interés por mora
-- (carga controlada por la función de abajo) no se bloquea.
create or replace function public._agro_fiado_limite() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_lim numeric; v_deuda numeric; v_cosecha date; v_nom text;
begin
  if new.cliente_id is null or coalesce(new.estado, 'pendiente') <> 'pendiente' or not public._agro_activo(new.auth_user_id) then
    return new;
  end if;
  if current_setting('n360.agro_mora', true) = '1' then return new; end if;
  select coalesce(c.limite_credito, 0), trim(coalesce(c.nombre, '') || ' ' || coalesce(c.apellido, ''))
    into v_lim, v_nom from public.clientes c where c.id = new.cliente_id and c.auth_user_id = new.auth_user_id;
  select coalesce(sum(f.saldo), 0) into v_deuda from public.fiados f
   where f.auth_user_id = new.auth_user_id and f.cliente_id = new.cliente_id and f.estado = 'pendiente';
  select coalesce(p.fecha_cosecha_2, p.fecha_cosecha) into v_cosecha from public.agro_productores p
   where p.cliente_id = new.cliente_id and p.auth_user_id = new.auth_user_id;
  if v_deuda > 0.004 and v_cosecha is not null and v_cosecha < (now() at time zone 'America/Managua')::date then
    raise exception 'No se puede fiar a %: tiene C$ % pendiente y su fecha de pago (%) ya pasó. Primero debe abonar o actualiza su fecha de cosecha en el panel Agroservicio.',
      v_nom, to_char(v_deuda, 'FM999G999G990D00'), to_char(v_cosecha, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  if v_lim > 0 and v_deuda + coalesce(new.saldo, 0) > v_lim + 0.004 then
    raise exception 'No se puede fiar a %: con esta venta su deuda sería C$ % y su límite es C$ %. Cobra un abono o sube su límite en el panel Agroservicio.',
      v_nom, to_char(v_deuda + coalesce(new.saldo, 0), 'FM999G999G990D00'), to_char(v_lim, 'FM999G999G990D00') using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Cálculo del interés (sin guardar nada): base = saldo pendiente SIN intereses anteriores (interés simple).
create or replace function public.agro_mora_calcular(p_cliente_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_pct numeric; v_p record; v_venc date; v_desde date; v_hoy date := (now() at time zone 'America/Managua')::date; v_base numeric; v_dias int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select coalesce(agro_mora_pct_mensual, 0) into v_pct from public.configuracion_empresa where auth_user_id = v_uid and usa_modulo_agro;
  if coalesce(v_pct, 0) <= 0 then return jsonb_build_object('ok', false, 'motivo', 'mora_apagada'); end if;
  select * into v_p from public.agro_productores where cliente_id = p_cliente_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  v_venc := coalesce(v_p.fecha_cosecha_2, v_p.fecha_cosecha);
  if v_venc is null or v_venc >= v_hoy then return jsonb_build_object('ok', false, 'motivo', 'no_vencido'); end if;
  v_desde := greatest(v_venc, coalesce(v_p.mora_cargada_hasta, v_venc));
  v_dias := v_hoy - v_desde;
  select coalesce(sum(saldo), 0) into v_base from public.fiados
   where auth_user_id = v_uid and cliente_id = p_cliente_id and estado = 'pendiente' and coalesce(descripcion, '') not like 'Interés por mora%';
  if v_dias < 1 or v_base <= 0.004 then return jsonb_build_object('ok', false, 'motivo', 'nada'); end if;
  return jsonb_build_object('ok', true, 'base', v_base, 'dias', v_dias, 'pct', v_pct, 'desde', v_desde, 'hasta', v_hoy,
    'monto', round(v_base * v_pct / 100 * v_dias / 30.0, 2));
end $$;
revoke all on function public.agro_mora_calcular(uuid) from public, anon;
grant execute on function public.agro_mora_calcular(uuid) to authenticated;

-- Cargar el interés: venta de servicio fiada (atómica) + marca "cargada hasta hoy".
create or replace function public.agro_mora_cargar(p_cliente_id uuid, p_clave uuid, p_monto_visto numeric, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); c jsonb; v_ya uuid; v_num text; v_nom text; v_res jsonb; v_vid uuid; v_m numeric; v_hoy date := (now() at time zone 'America/Managua')::date;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if p_clave is null then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  perform pg_advisory_xact_lock(hashtextextended('agro_mora:' || v_uid::text, 0));
  select venta_id into v_ya from public.agro_ventas_claves where clave = p_clave and auth_user_id = v_uid;
  if found then return jsonb_build_object('ok', true, 'venta_id', v_ya, 'ya_existia', true); end if;
  perform 1 from public.agro_productores where cliente_id = p_cliente_id and auth_user_id = v_uid for update;
  c := public.agro_mora_calcular(p_cliente_id);
  if not coalesce((c->>'ok')::boolean, false) then return c; end if;
  v_m := (c->>'monto')::numeric;
  if v_m < 0.01 then return jsonb_build_object('ok', false, 'motivo', 'nada'); end if;
  if p_monto_visto is null or abs(p_monto_visto - v_m) > 0.009 then return jsonb_build_object('ok', false, 'motivo', 'cambio', 'monto', v_m); end if;
  select trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_nom from public.clientes where id = p_cliente_id and auth_user_id = v_uid;
  v_num := public.generar_numero_venta(v_uid);
  perform set_config('n360.agro_mora', '1', true);
  v_res := public.venta_registrar_atomica(
    jsonb_build_object('numero_venta', v_num, 'cliente_id', p_cliente_id, 'cliente_nombre', v_nom, 'fecha', now(),
      'subtotal', v_m, 'descuento', 0, 'impuesto', 0, 'total', v_m, 'costo_total', 0, 'estado', 'completada',
      'metodo_pago', 'fiado', 'estado_pago', 'credito', 'metodo_pago_nombre', 'Fiado', 'categoria', 'Interés por mora',
      'creado_por_nombre', left(coalesce(p_usuario, ''), 100),
      'observaciones', 'Interés por mora ' || (c->>'pct') || '% mensual, ' || (c->>'dias') || ' día(s) sobre C$ ' || (c->>'base') || ' (del ' || to_char((c->>'desde')::date, 'DD/MM/YYYY') || ' al ' || to_char(v_hoy, 'DD/MM/YYYY') || ')'),
    jsonb_build_array(jsonb_build_object('producto_nombre', 'Interés por mora', 'tipo_item', 'servicio', 'cantidad', 1, 'precio', v_m, 'costo', 0,
      'descuento', 0, 'subtotal', v_m, 'ganancia', v_m)),
    '[]'::jsonb, '[]'::jsonb, v_m,
    jsonb_build_object('cliente_id', p_cliente_id, 'cliente_nombre', v_nom, 'tipo', 'monto',
      'descripcion', 'Interés por mora (' || (c->>'dias') || ' días)', 'monto_total', v_m, 'monto_pagado', 0, 'saldo', v_m,
      'estado', 'pendiente', 'fecha', v_hoy, 'creado_por_nombre', left(coalesce(p_usuario, ''), 100)));
  perform set_config('n360.agro_mora', '', true);
  v_vid := (v_res->>'venta_id')::uuid;
  if v_vid is null then raise exception 'No se pudo registrar el interés'; end if;
  update public.agro_productores set mora_cargada_hasta = v_hoy, updated_at = now() where cliente_id = p_cliente_id and auth_user_id = v_uid;
  insert into public.agro_ventas_claves (clave, auth_user_id, venta_id) values (p_clave, v_uid, v_vid);
  return jsonb_build_object('ok', true, 'venta_id', v_vid, 'numero_venta', v_num, 'monto', v_m);
end $$;
revoke all on function public.agro_mora_cargar(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.agro_mora_cargar(uuid, uuid, numeric, text) to authenticated;

-- Ficha del productor: ahora con segunda fecha de pago y % de la primera parte
create or replace function public.agro_productor_guardar(p_cliente_id uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid := p_cliente_id; v_nom text; v_lim numeric; v_cos date; v_cos2 date; v_pct1 numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._agro_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_nom := nullif(trim(coalesce(p_datos->>'nombre', '')), '');
  begin v_lim := round(coalesce(nullif(p_datos->>'limite_credito', '')::numeric, 0), 2); exception when others then return jsonb_build_object('ok', false, 'motivo', 'limite'); end;
  if v_lim < 0 or v_lim > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;
  begin v_cos := nullif(p_datos->>'fecha_cosecha', '')::date; exception when others then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end;
  begin v_cos2 := nullif(p_datos->>'fecha_cosecha_2', '')::date; exception when others then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end;
  begin v_pct1 := coalesce(nullif(p_datos->>'pago1_pct', '')::numeric, 50); exception when others then return jsonb_build_object('ok', false, 'motivo', 'partes'); end;
  if v_cos2 is not null and (v_cos is null or v_cos2 <= v_cos) then return jsonb_build_object('ok', false, 'motivo', 'fecha2'); end if;
  if v_pct1 <= 0 or v_pct1 >= 100 then return jsonb_build_object('ok', false, 'motivo', 'partes'); end if;
  if jsonb_typeof(coalesce(p_datos->'cultivos', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_datos->'ganado', '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  if v_id is null then
    if v_nom is null then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
    insert into public.clientes (auth_user_id, nombre, telefono, whatsapp, ruc, direccion, zona, limite_credito, activo)
    values (v_uid, left(v_nom, 150), nullif(trim(p_datos->>'telefono'), ''), nullif(trim(p_datos->>'telefono'), ''),
            nullif(trim(p_datos->>'cedula'), ''),
            nullif(trim(p_datos->>'direccion'), ''), nullif(trim(p_datos->>'comunidad'), ''), v_lim, true)
    returning id into v_id;
  else
    if not exists (select 1 from public.clientes where id = v_id and auth_user_id = v_uid) then
      return jsonb_build_object('ok', false, 'motivo', 'cliente');
    end if;
    update public.clientes set limite_credito = v_lim,
      telefono = coalesce(nullif(trim(p_datos->>'telefono'), ''), telefono),
      ruc = coalesce(nullif(trim(p_datos->>'cedula'), ''), ruc),
      direccion = coalesce(nullif(trim(p_datos->>'direccion'), ''), direccion),
      updated_at = now()
     where id = v_id and auth_user_id = v_uid;
  end if;
  insert into public.agro_productores (cliente_id, auth_user_id, finca, comunidad, municipio, cultivos, ganado, fecha_cosecha, fecha_cosecha_2, pago1_pct, notas, updated_at)
  values (v_id, v_uid, left(nullif(trim(p_datos->>'finca'), ''), 150), left(nullif(trim(p_datos->>'comunidad'), ''), 150),
          left(nullif(trim(p_datos->>'municipio'), ''), 150), coalesce(p_datos->'cultivos', '[]'::jsonb), coalesce(p_datos->'ganado', '[]'::jsonb),
          v_cos, v_cos2, round(v_pct1, 2), left(nullif(trim(p_datos->>'notas'), ''), 1000), now())
  on conflict (cliente_id) do update set finca = excluded.finca, comunidad = excluded.comunidad, municipio = excluded.municipio,
    cultivos = excluded.cultivos, ganado = excluded.ganado, fecha_cosecha = excluded.fecha_cosecha, fecha_cosecha_2 = excluded.fecha_cosecha_2,
    pago1_pct = excluded.pago1_pct, notas = excluded.notas, updated_at = now()
  where agro_productores.auth_user_id = v_uid;
  return jsonb_build_object('ok', true, 'cliente_id', v_id);
end $$;


-- Recomendación: ahora con 'repetir en N días'
create or replace function public.agro_recomendacion_guardar(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_int int; v_mz numeric; v_cli uuid; v_nom text; it jsonb; v_items jsonb := '[]'::jsonb; v_d numeric; v_p record; v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._agro_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if nullif(trim(coalesce(p_datos->>'cultivo', '')), '') is null then return jsonb_build_object('ok', false, 'motivo', 'cultivo'); end if;
  begin v_mz := round((p_datos->>'manzanas')::numeric, 2); exception when others then return jsonb_build_object('ok', false, 'motivo', 'manzanas'); end;
  if v_mz is null or v_mz <= 0 or v_mz > 100000 then return jsonb_build_object('ok', false, 'motivo', 'manzanas'); end if;
  begin v_int := nullif(p_datos->>'intervalo_dias', '')::int; exception when others then return jsonb_build_object('ok', false, 'motivo', 'intervalo'); end;
  if v_int is not null and (v_int < 1 or v_int > 365) then return jsonb_build_object('ok', false, 'motivo', 'intervalo'); end if;
  v_cli := nullif(p_datos->>'cliente_id', '')::uuid;
  if v_cli is not null then
    select trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_nom from public.clientes where id = v_cli and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  else
    v_nom := nullif(trim(coalesce(p_datos->>'cliente_nombre', '')), '');
  end if;
  if jsonb_typeof(p_datos->'items') <> 'array' or jsonb_array_length(p_datos->'items') = 0 or jsonb_array_length(p_datos->'items') > 30 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_productos');
  end if;
  for it in select * from jsonb_array_elements(p_datos->'items') loop
    begin v_d := round((it->>'dosis_mz')::numeric, 4); exception when others then return jsonb_build_object('ok', false, 'motivo', 'dosis'); end;
    if v_d is null or v_d <= 0 or v_d > 100000 then return jsonb_build_object('ok', false, 'motivo', 'dosis'); end if;
    select id, nombre, coalesce(unidad_codigo, 'unidad') unidad into v_p from public.productos where id = (it->>'producto_id')::uuid and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
    v_items := v_items || jsonb_build_object('producto_id', v_p.id, 'nombre', v_p.nombre, 'unidad', v_p.unidad, 'dosis_mz', v_d,
      'total', round(v_d * v_mz, 3), 'sugerido', left(coalesce(it->>'sugerido', ''), 200));
  end loop;
  insert into public.agro_recomendaciones (auth_user_id, cliente_id, cliente_nombre, cultivo, manzanas, objetivo, tecnico, notas, items, creado_por, intervalo_dias)
  values (v_uid, v_cli, left(v_nom, 150), left(trim(p_datos->>'cultivo'), 100), v_mz, left(nullif(trim(p_datos->>'objetivo'), ''), 200),
          left(nullif(trim(p_datos->>'tecnico'), ''), 150), left(nullif(trim(p_datos->>'notas'), ''), 1000), v_items, left(nullif(p_datos->>'usuario', ''), 100), v_int)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
