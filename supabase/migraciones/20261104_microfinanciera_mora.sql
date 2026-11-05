-- =====================================================================
-- PANEL MICROFINANCIERA · MORA POR ATRASO (4-nov-2026)
-- Apagada por defecto ("Sin mora"): nada cambia hasta que el dueño la configure.
-- SIN DESCUADRES:
--   * La mora NO se suma a la deuda del crédito (Créditos y Cuentas por Cobrar no cambian).
--     Se cobra junto con un pago y entra a Caja como ingreso aparte ("Mora por atraso").
--   * La calcula el SERVIDOR al cobrar; no se puede cobrar más de lo calculado.
--   * Perdonar mora: dueño/supervisor siempre; cobrador solo si el dueño lo permite. Queda anotado quién.
--   * Cada cuota guarda hasta qué día ya se le cobró/perdonó mora: nunca se cobra dos veces el mismo día.
--   * Anular el cobro anula también su mora (sale de Caja) y esas cuotas vuelven a contar mora.
--   * La entrega del cobrador incluye la mora en efectivo que cobró.
--   * Reglas: "C$ por día de atraso", "% por día sobre lo atrasado" o "C$ por cuota atrasada";
--     días de gracia; tope (% de lo atrasado). Solo el dueño las cambia (candado en la base).
-- =====================================================================
alter table public.configuracion_empresa add column if not exists mf_mora_tipo text not null default 'ninguna';
alter table public.configuracion_empresa add column if not exists mf_mora_valor numeric(14,4) not null default 0;
alter table public.configuracion_empresa add column if not exists mf_mora_gracia integer not null default 0;
alter table public.configuracion_empresa add column if not exists mf_mora_tope_pct numeric(6,2) not null default 20;
alter table public.configuracion_empresa add column if not exists mf_mora_perdona_cobrador boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cfg_mf_mora_chk') then
    alter table public.configuracion_empresa add constraint cfg_mf_mora_chk check (mf_mora_tipo in ('ninguna', 'fija_dia', 'pct_dia', 'fija_cuota')
      and mf_mora_valor >= 0 and mf_mora_gracia between 0 and 60 and mf_mora_tope_pct between 0 and 100);
  end if;
end $$;
alter table public.creditos_cuotas add column if not exists mf_mora_hasta date;

create table if not exists public.mf_moras (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  credito_id uuid not null references public.creditos(id) on delete cascade,
  cliente_id uuid,
  pago_id uuid references public.creditos_pagos(id) on delete set null,
  fecha date not null,
  calculada numeric(14,2) not null default 0,
  cobrada numeric(14,2) not null default 0 check (cobrada >= 0),
  perdonada numeric(14,2) not null default 0 check (perdonada >= 0),
  dias integer not null default 0,
  movimiento_id uuid,
  cuotas_antes jsonb not null default '[]'::jsonb,
  cobrador_id uuid,
  cobrador_nombre text,
  estado text not null default 'completado' check (estado in ('completado', 'anulado')),
  anulado_en timestamptz,
  anulado_motivo text,
  created_at timestamptz not null default now()
);
create index if not exists mf_moras_idx on public.mf_moras (auth_user_id, fecha);
create index if not exists mf_moras_pago_idx on public.mf_moras (pago_id);
alter table public.mf_moras enable row level security;
drop policy if exists mf_moras_ver on public.mf_moras;
create policy mf_moras_ver on public.mf_moras for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.mf_moras from anon, authenticated;
grant select on public.mf_moras to authenticated;

-- Candado: reglas de mora y "mora cobrada hasta" solo cambian por las funciones del Panel
create or replace function public._mf_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('n360.mf_ok', true) is not distinct from '1' then return new; end if;
  if tg_table_name = 'configuracion_empresa' then
    if new.mf_con_equipo is distinct from old.mf_con_equipo then
      raise exception 'El trabajo en equipo se enciende o apaga desde el Panel Microfinanciera (con PIN de administrador).' using errcode = 'P0001';
    end if;
    if new.mf_mora_tipo is distinct from old.mf_mora_tipo or new.mf_mora_valor is distinct from old.mf_mora_valor or new.mf_mora_gracia is distinct from old.mf_mora_gracia
       or new.mf_mora_tope_pct is distinct from old.mf_mora_tope_pct or new.mf_mora_perdona_cobrador is distinct from old.mf_mora_perdona_cobrador then
      raise exception 'Las reglas de mora se cambian desde el Panel Microfinanciera.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos' then
    if new.mf_cobrador_id is distinct from old.mf_cobrador_id or new.mf_cobrador_nombre is distinct from old.mf_cobrador_nombre then
      raise exception 'La cartera del cobrador se asigna desde el Panel Microfinanciera.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos_pagos' then
    if new.mf_cobrador_id is distinct from old.mf_cobrador_id or new.mf_cobrador_nombre is distinct from old.mf_cobrador_nombre or new.mf_entrega_id is distinct from old.mf_entrega_id then
      raise exception 'Quién cobró y la entrega del cobrador no se pueden cambiar a mano.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'creditos_cuotas' then
    if new.mf_mora_hasta is distinct from old.mf_mora_hasta then
      raise exception 'La mora de una cuota solo se cobra o perdona desde el Panel Microfinanciera.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_mf_guard on public.configuracion_empresa;
create trigger trg_mf_guard before update of mf_con_equipo, mf_mora_tipo, mf_mora_valor, mf_mora_gracia, mf_mora_tope_pct, mf_mora_perdona_cobrador
  on public.configuracion_empresa for each row execute function public._mf_guard();
drop trigger if exists trg_mf_guard on public.creditos_cuotas;
create trigger trg_mf_guard before update of mf_mora_hasta on public.creditos_cuotas for each row execute function public._mf_guard();

-- Cálculo de la mora de un crédito HOY (solo lee)
create or replace function public._mf_mora_calc(p_cred uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg record; v_hoy date := (now() at time zone 'America/Managua')::date; q record; v_d integer; v_m numeric := 0; v_atr numeric := 0; v_maxd integer := 0;
  v_cu jsonb := '[]'::jsonb; v_falta numeric;
begin
  select mf_mora_tipo t, mf_mora_valor v, mf_mora_gracia g, mf_mora_tope_pct tp into cfg from configuracion_empresa where auth_user_id = p_uid limit 1;
  if cfg.t is null or cfg.t = 'ninguna' or coalesce(cfg.v, 0) <= 0 then
    return jsonb_build_object('mora', 0, 'dias', 0, 'atrasado', 0, 'cuotas', '[]'::jsonb, 'tipo', coalesce(cfg.t, 'ninguna')); end if;
  for q in select id, fecha_vencimiento, round(monto_total - coalesce(monto_pagado, 0), 2) falta, mf_mora_hasta
             from creditos_cuotas where credito_id = p_cred and auth_user_id = p_uid and estado <> 'pagada'
              and fecha_vencimiento + coalesce(cfg.g, 0) < v_hoy order by numero loop
    continue when q.falta <= 0.005;
    v_atr := v_atr + q.falta;
    v_d := v_hoy - greatest(q.fecha_vencimiento + coalesce(cfg.g, 0), coalesce(q.mf_mora_hasta, date '1900-01-01'));
    if cfg.t = 'fija_cuota' then
      if q.mf_mora_hasta is null then v_m := v_m + cfg.v; v_cu := v_cu || jsonb_build_object('id', q.id, 'antes', q.mf_mora_hasta); end if;
    elsif v_d > 0 then
      v_cu := v_cu || jsonb_build_object('id', q.id, 'antes', q.mf_mora_hasta);
      if cfg.t = 'pct_dia' then v_m := v_m + q.falta * cfg.v / 100 * v_d; end if;
      v_maxd := greatest(v_maxd, v_d);
    end if;
  end loop;
  if cfg.t = 'fija_dia' then v_m := cfg.v * v_maxd; end if;
  v_m := round(least(v_m, v_atr * coalesce(cfg.tp, 100) / 100), 2);
  if v_m <= 0 then v_cu := '[]'::jsonb; end if;
  return jsonb_build_object('mora', v_m, 'dias', v_maxd, 'atrasado', round(v_atr, 2), 'cuotas', v_cu, 'tipo', cfg.t);
end $$;

-- Ver la mora de un crédito (para mostrarla antes de cobrar)
create or replace function public.mf_mora_ver(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_cid uuid; c record; r jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  begin v_cid := (p ->> 'credito_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  select id, mf_cobrador_id into c from creditos where id = v_cid and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_act ->> 'rol' = 'cobrador' and c.mf_cobrador_id is distinct from nullif(v_act ->> 'perfil_id', '')::uuid then return jsonb_build_object('ok', false, 'motivo', 'no_es_tuyo'); end if;
  r := public._mf_mora_calc(c.id, v_uid);
  return jsonb_build_object('ok', true, 'mora', r -> 'mora', 'dias', r -> 'dias', 'atrasado', r -> 'atrasado', 'tipo', r -> 'tipo');
end $$;

-- Reglas de mora (solo el dueño)
create or replace function public.mf_mora_config(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_t text := coalesce(p ->> 'tipo', 'ninguna'); v_v numeric; v_g integer; v_tp numeric; v_pc boolean;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' <> 'dueno' then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  begin
    v_v := round(coalesce(nullif(p ->> 'valor', '')::numeric, 0), 4); v_g := coalesce(nullif(p ->> 'gracia', '')::integer, 0);
    v_tp := round(coalesce(nullif(p ->> 'tope_pct', '')::numeric, 20), 2); v_pc := coalesce((p ->> 'perdona_cobrador')::boolean, false);
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_t not in ('ninguna', 'fija_dia', 'pct_dia', 'fija_cuota') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  if v_v < 0 or v_v > 1000000 or (v_t = 'pct_dia' and v_v > 10) or v_g < 0 or v_g > 60 or v_tp < 0 or v_tp > 100 then return jsonb_build_object('ok', false, 'motivo', 'mora_regla'); end if;
  if v_t <> 'ninguna' and v_v <= 0 then return jsonb_build_object('ok', false, 'motivo', 'mora_regla'); end if;
  perform set_config('n360.mf_ok', '1', true);
  update configuracion_empresa set mf_mora_tipo = v_t, mf_mora_valor = v_v, mf_mora_gracia = v_g, mf_mora_tope_pct = v_tp, mf_mora_perdona_cobrador = v_pc where auth_user_id = v_uid;
  perform set_config('n360.mf_ok', '', true);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mf_cobrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date;
  v_cid uuid; v_monto numeric; v_met uuid; v_banco uuid; v_bmon text; v_emon text;
  v_metn text := left(coalesce(nullif(btrim(coalesce(p ->> 'metodo_pago_nombre', '')), ''), 'Efectivo'), 120);
  v_ref text := left(nullif(btrim(coalesce(p ->> 'ref', '')), ''), 80);
  v_nota text := left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300);
  v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120);
  c record; q record; v_rest numeric; v_apl numeric; v_debe numeric; v_saldo_nuevo numeric; v_estado text;
  v_mov uuid; v_recibo text; v_pago uuid; v_pf date; v_pm numeric;
  v_act jsonb; v_rol text; v_yo uuid; v_yon text;
  v_hay_mora boolean := p ? 'mora'; v_mora numeric := 0; v_mc jsonb; v_mcalc numeric := 0; v_perd numeric := 0; v_mmov uuid; v_mid uuid; v_mperd boolean;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  v_rol := v_act ->> 'rol'; v_yo := nullif(v_act ->> 'perfil_id', '')::uuid; v_yon := v_act ->> 'nombre';
  begin
    v_cid := (p ->> 'credito_id')::uuid; v_monto := round((p ->> 'monto')::numeric, 2);
    v_met := nullif(p ->> 'metodo_pago_id', '')::uuid; v_banco := nullif(p ->> 'banco_id', '')::uuid;
    if v_hay_mora then v_mora := round(coalesce(nullif(p ->> 'mora', '')::numeric, 0), 2); end if;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended('n360_mf_pago:' || v_uid::text || ':' || v_ref, 0));
    select id, comprobante_numero, saldo_nuevo into q from creditos_pagos where auth_user_id = v_uid and mf_ref = v_ref;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'pago_id', q.id, 'recibo', q.comprobante_numero, 'saldo', q.saldo_nuevo,
      'mora', coalesce((select sum(cobrada) from mf_moras where pago_id = q.id and estado = 'completado'), 0)); end if;
  end if;
  select * into c from creditos where id = v_cid and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_rol = 'cobrador' and c.mf_cobrador_id is distinct from v_yo then return jsonb_build_object('ok', false, 'motivo', 'no_es_tuyo'); end if;
  if c.estado in ('cancelado', 'refinanciado') or coalesce(c.saldo_pendiente, 0) <= 0.005 then return jsonb_build_object('ok', false, 'motivo', 'pagado'); end if;
  if v_monto is null or v_monto <= 0 then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;
  if v_monto > c.saldo_pendiente + 0.005 then return jsonb_build_object('ok', false, 'motivo', 'excede', 'saldo', c.saldo_pendiente); end if;
  if exists (select 1 from creditos_cuotas where credito_id = c.id and estado <> 'pagada' and coalesce(impuesto, 0) - coalesce(impuesto_acreditado, 0) > 0.005) then
    return jsonb_build_object('ok', false, 'motivo', 'con_impuestos'); end if;
  if v_met is not null and not exists (select 1 from metodos_pago where id = v_met and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  if v_banco is not null then
    select moneda into v_bmon from bancos where id = v_banco and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
    select moneda into v_emon from configuracion_empresa where auth_user_id = v_uid limit 1;
    if coalesce(v_bmon, 'NIO') <> coalesce(v_emon, 'NIO') then return jsonb_build_object('ok', false, 'motivo', 'banco_moneda'); end if;
  end if;

  -- Se aplica a las cuotas en orden (la más antigua primero), igual que Créditos
  -- Mora por atraso: la calcula el SERVIDOR (antes de aplicar el pago). Si la pantalla no la manda, queda pendiente.
  v_mc := public._mf_mora_calc(c.id, v_uid);
  v_mcalc := coalesce((v_mc ->> 'mora')::numeric, 0);
  if v_hay_mora then
    if v_mora < 0 or v_mora > v_mcalc + 0.005 then return jsonb_build_object('ok', false, 'motivo', 'mora_excede', 'mora', v_mcalc); end if;
    v_perd := round(greatest(0, v_mcalc - v_mora), 2);
    select coalesce(mf_mora_perdona_cobrador, false) into v_mperd from configuracion_empresa where auth_user_id = v_uid limit 1;
    if v_perd > 0.005 and v_rol = 'cobrador' and not coalesce(v_mperd, false) then return jsonb_build_object('ok', false, 'motivo', 'perdon', 'mora', v_mcalc); end if;
  end if;
  v_rest := v_monto;
  for q in select * from creditos_cuotas where credito_id = c.id and estado <> 'pagada' order by numero for update loop
    exit when v_rest <= 0.005;
    v_debe := round(q.monto_total - coalesce(q.monto_pagado, 0), 2);
    continue when v_debe <= 0;
    v_apl := least(v_rest, v_debe);
    update creditos_cuotas set monto_pagado = round(coalesce(monto_pagado, 0) + v_apl, 2),
           estado = case when round(coalesce(monto_pagado, 0) + v_apl, 2) >= monto_total - 0.01 then 'pagada' else 'parcial' end, updated_at = now()
     where id = q.id;
    v_rest := round(v_rest - v_apl, 2);
  end loop;
  if v_rest > 0.01 then raise exception 'El cobro no cupo en las cuotas del crédito. No se guardó nada.'; end if;

  v_saldo_nuevo := round(greatest(0, c.saldo_pendiente - v_monto), 2);
  v_estado := case when v_saldo_nuevo <= 0.01 then 'cancelado' when c.estado = 'en_proceso' then 'activo' else c.estado end;
  update creditos set saldo_pendiente = v_saldo_nuevo, estado = v_estado, updated_at = now() where id = c.id;

  v_recibo := public._mf_recibo(v_uid);
  insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                       metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
  values (v_uid, 'INGRESO', 'PAGO_CREDITO', 'Pago crédito ' || c.numero_credito || ' · recibo ' || v_recibo, v_monto, 0, 0, v_met, v_metn, v_banco, 'credito', c.id, v_nota, v_hoy, 'completado')
  returning id into v_mov;
  insert into creditos_pagos (auth_user_id, credito_id, cliente_id, fecha, monto, metodo_pago_id, metodo_pago_nombre, observaciones,
                              saldo_anterior, saldo_nuevo, movimiento_financiero_id, comprobante_numero, estado, mf_ref, mf_cobrador_id, mf_cobrador_nombre)
  values (v_uid, c.id, c.cliente_id, v_hoy, v_monto, v_met, v_metn, v_nota, c.saldo_pendiente, v_saldo_nuevo, v_mov, v_recibo, 'completado', v_ref, v_yo, coalesce(v_yon, v_por))
  returning id into v_pago;
  -- Mora: entra a Caja aparte (no cambia lo que debe del crédito) y las cuotas quedan "al día" de mora hasta hoy
  if v_hay_mora and v_mcalc > 0.005 then
    if v_mora > 0 then
      insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                           metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
      values (v_uid, 'INGRESO', 'OTRO_INGRESO', 'Mora por atraso — crédito ' || c.numero_credito || ' · recibo ' || v_recibo, v_mora, 0, 0, v_met, v_metn, v_banco, 'mf_mora', c.id, v_nota, v_hoy, 'completado')
      returning id into v_mmov;
    end if;
    insert into mf_moras (auth_user_id, credito_id, cliente_id, pago_id, fecha, calculada, cobrada, perdonada, dias, movimiento_id, cuotas_antes, cobrador_id, cobrador_nombre, estado)
    values (v_uid, c.id, c.cliente_id, v_pago, v_hoy, v_mcalc, v_mora, v_perd, coalesce((v_mc ->> 'dias')::int, 0), v_mmov, coalesce(v_mc -> 'cuotas', '[]'::jsonb), v_yo, coalesce(v_yon, v_por), 'completado')
    returning id into v_mid;
    if v_mmov is not null then update movimientos_financieros set referencia_id = v_mid where id = v_mmov; end if;
    perform set_config('n360.mf_ok', '1', true);
    update creditos_cuotas set mf_mora_hasta = v_hoy where credito_id = c.id and id in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(v_mc -> 'cuotas', '[]'::jsonb)) x);
    perform set_config('n360.mf_ok', '', true);
    insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
    values (c.id, v_uid, 'mora', 'Mora por atraso: cobrada ' || v_mora || case when v_perd > 0 then ', perdonada ' || v_perd else '' end || ' (recibo ' || v_recibo || ')',
            jsonb_build_object('calculada', v_mcalc, 'cobrada', v_mora, 'perdonada', v_perd, 'por', coalesce(v_yon, v_por)));
  end if;
  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (c.id, v_uid, 'pago', 'Pago de ' || v_monto || ' registrado (recibo ' || v_recibo || ', Panel Microfinanciera)', jsonb_build_object('monto', v_monto, 'saldoNuevo', v_saldo_nuevo, 'por', v_por));
  if v_estado = 'cancelado' then
    insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data) values (c.id, v_uid, 'cancelado', 'Crédito cancelado — saldo en cero', '{}'::jsonb);
  end if;
  select fecha_vencimiento, round(monto_total - coalesce(monto_pagado, 0), 2) into v_pf, v_pm
    from creditos_cuotas where credito_id = c.id and estado <> 'pagada' order by numero limit 1;
  return jsonb_build_object('ok', true, 'pago_id', v_pago, 'recibo', v_recibo, 'monto', v_monto, 'saldo_anterior', c.saldo_pendiente, 'saldo', v_saldo_nuevo,
    'cancelado', v_estado = 'cancelado', 'numero_credito', c.numero_credito, 'cobrador', coalesce(v_yon, v_por), 'mora', case when v_hay_mora then v_mora else 0 end, 'mora_perdonada', case when v_hay_mora then v_perd else 0 end, 'mora_pendiente', case when v_hay_mora then 0 else v_mcalc end,
    'proxima_fecha', v_pf, 'proxima_monto', v_pm);
end $$;

create or replace function public.mf_anular_pago(p_pago_id uuid, p_motivo text, p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); pg record; c record; q record; v_rest numeric; v_quitar numeric; v_pag numeric; v_saldo numeric;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 200); v_act jsonb; m record; v_mora numeric := 0;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p_token);
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  if v_motivo is null or length(v_motivo) < 3 then return jsonb_build_object('ok', false, 'motivo', 'motivo'); end if;
  select * into pg from creditos_pagos where id = p_pago_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if pg.estado = 'anulado' then return jsonb_build_object('ok', false, 'motivo', 'ya_anulado'); end if;
  if pg.mf_entrega_id is not null then return jsonb_build_object('ok', false, 'motivo', 'entregado'); end if;
  if pg.movimiento_financiero_id is null or coalesce(pg.comprobante_numero, '') not like 'R-%' then return jsonb_build_object('ok', false, 'motivo', 'de_creditos'); end if;
  select * into c from creditos where id = pg.credito_id and auth_user_id = v_uid for update;
  -- 1) Caja: el movimiento queda anulado (la base recalcula el saldo)
  update movimientos_financieros set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Cobro ' || pg.comprobante_numero || ' anulado: ' || v_motivo
   where id = pg.movimiento_financiero_id and auth_user_id = v_uid and estado = 'completado';
  -- 2) Cuotas: se descuenta de la última hacia atrás (igual que Créditos)
  v_rest := pg.monto;
  for q in select * from creditos_cuotas where credito_id = c.id order by numero desc for update loop
    exit when v_rest <= 0.005;
    v_pag := coalesce(q.monto_pagado, 0);
    continue when v_pag <= 0;
    v_quitar := least(v_pag, v_rest);
    update creditos_cuotas set monto_pagado = round(v_pag - v_quitar, 2),
           estado = case when round(v_pag - v_quitar, 2) <= 0.01 then 'pendiente' when round(v_pag - v_quitar, 2) >= monto_total - 0.01 then 'pagada' else 'parcial' end,
           updated_at = now() where id = q.id;
    v_rest := round(v_rest - v_quitar, 2);
  end loop;
  -- 3) Saldo del crédito (nunca más allá del total)
  v_saldo := round(least(coalesce(c.total_financiado, c.capital_financiado, 0), coalesce(c.saldo_pendiente, 0) + pg.monto), 2);
  update creditos set saldo_pendiente = v_saldo, estado = case when v_saldo > 0.01 and estado = 'cancelado' then 'activo' else estado end, updated_at = now() where id = c.id;
  -- 4) El cobro queda anulado (con rastro)
  update creditos_pagos set estado = 'anulado', anulado_en = now(), anulado_motivo = v_motivo where id = pg.id;
  -- La mora cobrada con ese recibo también se anula (sale de Caja) y esas cuotas vuelven a contar mora desde antes
  for m in select * from mf_moras where pago_id = pg.id and auth_user_id = v_uid and estado = 'completado' for update loop
    if m.movimiento_id is not null then
      update movimientos_financieros set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Mora del cobro ' || pg.comprobante_numero || ' anulada: ' || v_motivo
       where id = m.movimiento_id and auth_user_id = v_uid and estado = 'completado';
    end if;
    perform set_config('n360.mf_ok', '1', true);
    update creditos_cuotas cq set mf_mora_hasta = nullif(x ->> 'antes', '')::date
      from jsonb_array_elements(m.cuotas_antes) x
     where cq.id = (x ->> 'id')::uuid and cq.credito_id = m.credito_id and cq.mf_mora_hasta is not distinct from m.fecha;
    perform set_config('n360.mf_ok', '', true);
    update mf_moras set estado = 'anulado', anulado_en = now(), anulado_motivo = v_motivo where id = m.id;
    v_mora := v_mora + m.cobrada;
  end loop;
  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (c.id, v_uid, 'pago_anulado', 'Se anuló el cobro ' || pg.comprobante_numero || ' de ' || pg.monto || ': ' || v_motivo, jsonb_build_object('por', coalesce(v_act ->> 'nombre', 'Dueño')));
  return jsonb_build_object('ok', true, 'saldo', v_saldo, 'recibo', pg.comprobante_numero, 'monto', pg.monto, 'mora', v_mora);
end $$;

create or replace function public.mf_caja_pendiente(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_res jsonb; v_solo uuid;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then v_solo := (v_act ->> 'perfil_id')::uuid; end if;
  select coalesce(jsonb_agg(x order by x ->> 'nombre'), '[]'::jsonb) into v_res from (
    select jsonb_build_object('cobrador_id', cp.mf_cobrador_id, 'nombre', max(cp.mf_cobrador_nombre), 'cobros', count(*),
           'efectivo', round(sum(cp.monto + coalesce(mo.m, 0)) filter (where lower(coalesce(cp.metodo_pago_nombre, 'efectivo')) like '%efectivo%'), 2),
           'otros', round(sum(cp.monto + coalesce(mo.m, 0)) filter (where lower(coalesce(cp.metodo_pago_nombre, 'efectivo')) not like '%efectivo%'), 2),
           'desde', min(cp.created_at), 'hasta', max(cp.created_at),
           'detalle', jsonb_agg(jsonb_build_object('recibo', cp.comprobante_numero, 'monto', cp.monto + coalesce(mo.m, 0), 'mora', coalesce(mo.m, 0), 'metodo', cp.metodo_pago_nombre, 'hora', cp.created_at, 'credito_id', cp.credito_id) order by cp.created_at)) x
      from creditos_pagos cp
      left join (select pago_id, sum(cobrada) m from mf_moras where auth_user_id = v_uid and estado = 'completado' group by pago_id) mo on mo.pago_id = cp.id
     where cp.auth_user_id = v_uid and cp.estado = 'completado' and cp.mf_cobrador_id is not null and cp.mf_entrega_id is null
       and (v_solo is null or cp.mf_cobrador_id = v_solo)
       and exists (select 1 from mf_equipo e where e.perfil_id = cp.mf_cobrador_id and e.auth_user_id = v_uid)
     group by cp.mf_cobrador_id) t;
  return jsonb_build_object('ok', true, 'pendiente', v_res);
end $$;

create or replace function public.mf_entrega_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date; v_act jsonb; v_cob uuid; v_nom text;
  v_ent numeric; v_visto numeric; v_esp numeric; v_otros numeric; v_n integer; v_dif numeric; v_id uuid; v_mov uuid;
  v_nota text := left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300);
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' not in ('dueno', 'supervisor') then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  begin
    v_cob := (p ->> 'cobrador_id')::uuid; v_ent := round((p ->> 'entregado')::numeric, 2); v_visto := round((p ->> 'esperado_visto')::numeric, 2);
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_ent is null or v_ent < 0 or v_ent > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;
  if v_cob = nullif(v_act ->> 'perfil_id', '')::uuid then return jsonb_build_object('ok', false, 'motivo', 'propia'); end if;
  select pa.nombre into v_nom from mf_equipo e join perfiles_acceso pa on pa.id = e.perfil_id where e.perfil_id = v_cob and e.auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'cobrador'); end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_mf_entrega:' || v_uid::text || ':' || v_cob::text, 0));
  perform 1 from creditos_pagos where auth_user_id = v_uid and mf_cobrador_id = v_cob and mf_entrega_id is null and estado = 'completado' for update;
  select count(*), coalesce(round(sum(cp.monto + coalesce(mo.m, 0)) filter (where lower(coalesce(cp.metodo_pago_nombre, 'efectivo')) like '%efectivo%'), 2), 0),
         coalesce(round(sum(cp.monto + coalesce(mo.m, 0)) filter (where lower(coalesce(cp.metodo_pago_nombre, 'efectivo')) not like '%efectivo%'), 2), 0)
    into v_n, v_esp, v_otros
    from creditos_pagos cp
    left join (select pago_id, sum(cobrada) m from mf_moras where auth_user_id = v_uid and estado = 'completado' group by pago_id) mo on mo.pago_id = cp.id
   where cp.auth_user_id = v_uid and cp.mf_cobrador_id = v_cob and cp.mf_entrega_id is null and cp.estado = 'completado';
  if v_n = 0 then return jsonb_build_object('ok', false, 'motivo', 'nada'); end if;
  if v_visto is null or v_visto <> v_esp then return jsonb_build_object('ok', false, 'motivo', 'cambio', 'esperado', v_esp); end if;
  v_dif := round(v_ent - v_esp, 2);
  insert into mf_entregas (auth_user_id, cobrador_id, cobrador_nombre, cobros, esperado, otros, entregado, diferencia, nota, recibido_por)
  values (v_uid, v_cob, v_nom, v_n, v_esp, v_otros, v_ent, v_dif, v_nota, coalesce(v_act ->> 'nombre', 'Dueño'))
  returning id into v_id;
  perform set_config('n360.mf_ok', '1', true);
  update creditos_pagos set mf_entrega_id = v_id where auth_user_id = v_uid and mf_cobrador_id = v_cob and mf_entrega_id is null and estado = 'completado';
  perform set_config('n360.mf_ok', '', true);
  -- Faltante o sobrante: Caja se ajusta para quedar igual al dinero real recibido
  if v_dif <> 0 then
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_nombre, referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, case when v_dif < 0 then 'EGRESO' else 'INGRESO' end, case when v_dif < 0 then 'OTRO_EGRESO' else 'OTRO_INGRESO' end,
            case when v_dif < 0 then 'Faltante en entrega de cobros — ' else 'Sobrante en entrega de cobros — ' end || coalesce(v_nom, 'cobrador'),
            abs(v_dif), 0, 0, 'Efectivo', 'mf_entrega', v_id, v_nota, v_hoy, 'completado')
    returning id into v_mov;
    update mf_entregas set movimiento_id = v_mov where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'entrega_id', v_id, 'cobros', v_n, 'esperado', v_esp, 'otros', v_otros, 'entregado', v_ent, 'diferencia', v_dif, 'cobrador', v_nom);
end $$;

revoke all on function public._mf_mora_calc(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mf_mora_ver(jsonb) from public, anon;
revoke all on function public.mf_mora_config(jsonb) from public, anon;
revoke all on function public.mf_cobrar(jsonb) from public, anon;
revoke all on function public.mf_anular_pago(uuid, text, text) from public, anon;
revoke all on function public.mf_caja_pendiente(jsonb) from public, anon;
revoke all on function public.mf_entrega_registrar(jsonb) from public, anon;
grant execute on function public.mf_mora_ver(jsonb) to authenticated;
grant execute on function public.mf_mora_config(jsonb) to authenticated;
grant execute on function public.mf_cobrar(jsonb) to authenticated;
grant execute on function public.mf_anular_pago(uuid, text, text) to authenticated;
grant execute on function public.mf_caja_pendiente(jsonb) to authenticated;
grant execute on function public.mf_entrega_registrar(jsonb) to authenticated;
