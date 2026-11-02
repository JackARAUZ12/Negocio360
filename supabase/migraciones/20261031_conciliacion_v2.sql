-- =====================================================================
-- CONCILIACIÓN BANCARIA v2 · 31-oct-2026 · Solo AGREGA (columnas y funciones nuevas).
-- Como los sistemas especializados (QuickBooks, Xero, Alegra):
--   * se concilia contra el estado de cuenta: fecha de corte + saldo final;
--   * lo que no aparece todavía en el banco queda "en tránsito" (sin conciliar);
--   * la diferencia se explica con registros REALES, nunca con un "ajuste" suelto:
--       - asignar a este banco transferencias/tarjetas que quedaron sin banco (no mueve dinero);
--       - retiro del banco a efectivo o depósito de efectivo (registrar_transferencia_interna: Caja total igual);
--       - comisión o cargo del banco = GASTO con su egreso (y por eso con su asiento contable);
--   * se puede cerrar con diferencia pendiente (con nota): NO toca ningún dinero, solo deja el registro.
-- Las funciones de antes (conciliacion_cerrar, empresa_conciliacion_cerrar) no se tocan.
-- =====================================================================

alter table public.conciliaciones_bancarias add column if not exists nota text;
alter table public.conciliaciones_bancarias add column if not exists fecha_corte date;
alter table public.empresa_conciliaciones add column if not exists diferencia numeric(14,2) not null default 0;
alter table public.empresa_conciliaciones add column if not exists nota text;
alter table public.empresa_conciliaciones add column if not exists fecha_corte date;

-- ---------- Cerrar (banco propio) ----------
create or replace function public.conciliacion_cerrar_v2(p_banco_id uuid, p_ids uuid[], p_saldo_banco numeric,
  p_fecha_corte date default null, p_con_diferencia boolean default false, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); b record; v_base text; v_tasa numeric;
  v_previo numeric; v_marcado numeric; v_calc numeric; v_dif numeric;
  v_n integer; v_pedidos integer; v_desde date; v_hasta date; v_id uuid;
  v_hoy date := (now() at time zone 'America/Managua')::date;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if p_saldo_banco is null then raise exception 'Escribe el saldo que dice tu estado de cuenta.'; end if;
  select * into b from bancos where id = p_banco_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Banco no encontrado'; end if;
  select coalesce(array_length(array(select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x), 1), 0) into v_pedidos;
  if v_pedidos = 0 and not coalesce(p_con_diferencia, false) then
    raise exception 'Marca al menos un movimiento que aparezca en tu estado de cuenta.' using errcode = 'P0001'; end if;
  select case when c.moneda = 'USD' then 'USD' else 'NIO' end, coalesce(c.tasa_cambio_usd, 0)
    into v_base, v_tasa from configuracion_empresa c where c.auth_user_id = v_uid limit 1;
  v_base := coalesce(v_base, 'NIO'); v_tasa := coalesce(v_tasa, 0);
  select round(coalesce(b.saldo_inicial, 0) + coalesce(sum(case when m.tipo_flujo = 'INGRESO' then 1 else -1 end
           * public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, b.moneda, v_base, v_tasa)), 0), 2)
    into v_previo from movimientos_financieros m
   where m.auth_user_id = v_uid and m.banco_id = p_banco_id and m.estado = 'completado' and m.conciliado;
  select count(*), coalesce(sum(case when m.tipo_flujo = 'INGRESO' then 1 else -1 end
           * public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, b.moneda, v_base, v_tasa)), 0), min(m.fecha), max(m.fecha)
    into v_n, v_marcado, v_desde, v_hasta
    from movimientos_financieros m
   where m.id = any(coalesce(p_ids, '{}'::uuid[])) and m.auth_user_id = v_uid and m.banco_id = p_banco_id
     and m.estado = 'completado' and not coalesce(m.conciliado, false);
  if v_n <> v_pedidos then
    raise exception 'Algunos movimientos marcados ya no están pendientes (alguien los concilió o anuló). Cierra y vuelve a abrir la conciliación.' using errcode = 'P0001';
  end if;
  v_calc := round(v_previo + v_marcado, 2);
  v_dif := round(p_saldo_banco - v_calc, 2);
  if abs(v_dif) >= 0.005 and not coalesce(p_con_diferencia, false) then
    raise exception 'Todavía no cuadra: hay una diferencia de %.', to_char(abs(v_dif), 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;
  if abs(v_dif) >= 0.005 and nullif(trim(coalesce(p_nota, '')), '') is null then
    raise exception 'Escribe una nota que explique la diferencia (por ejemplo: "faltan retiros de septiembre, revisar").' using errcode = 'P0001';
  end if;
  if abs(v_dif) < 0.005 then v_dif := 0; end if;
  insert into conciliaciones_bancarias (auth_user_id, banco_id, periodo_desde, periodo_hasta, saldo_banco_declarado, saldo_sistema_calculado, diferencia, nota, fecha_corte)
  values (v_uid, p_banco_id, coalesce(v_desde, p_fecha_corte, v_hoy), coalesce(p_fecha_corte, v_hasta, v_hoy),
          round(p_saldo_banco, 2), v_calc, v_dif, nullif(trim(coalesce(p_nota, '')), ''), p_fecha_corte)
  returning id into v_id;
  if v_pedidos > 0 then
    update movimientos_financieros set conciliado = true, conciliacion_id = v_id
     where id = any(p_ids) and auth_user_id = v_uid and banco_id = p_banco_id and estado = 'completado' and not coalesce(conciliado, false);
  end if;
  return jsonb_build_object('conciliacion_id', v_id, 'movimientos', v_n, 'saldo_conciliado', v_calc, 'diferencia', v_dif);
end $$;

-- ---------- Cerrar (banco compartido de la empresa: se concilia el banco completo) ----------
create or replace function public.empresa_conciliacion_cerrar_v2(p_empresa_banco_id uuid, p_ids uuid[], p_saldo_banco numeric,
  p_fecha_corte date default null, p_con_diferencia boolean default false, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.empresa_id_de_mi_negocio(); eb record; c record; d record;
  v_pedidos integer; v_n integer := 0; v_previo numeric := 0; v_marcado numeric := 0; v_calc numeric; v_dif numeric;
  v_desde date; v_hasta date; v_ec uuid; v_cb uuid; v_partes jsonb := '[]'::jsonb;
  p_n integer; p_marc numeric; p_desde date; p_hasta date;
  v_hoy date := (now() at time zone 'America/Managua')::date;
begin
  if auth.uid() is null or v_emp is null then raise exception 'Tu negocio no es parte de una empresa'; end if;
  if p_saldo_banco is null then raise exception 'Escribe el saldo que dice tu estado de cuenta.'; end if;
  select * into eb from empresa_bancos where id = p_empresa_banco_id and empresa_id = v_emp for update;
  if not found then raise exception 'Banco de la empresa no encontrado'; end if;
  perform 1 from bancos b join empresa_bancos_cuentas x on x.banco_id = b.id where x.empresa_banco_id = eb.id for update of b;
  select coalesce(array_length(array(select distinct y from unnest(coalesce(p_ids, '{}'::uuid[])) y), 1), 0) into v_pedidos;
  if v_pedidos = 0 and not coalesce(p_con_diferencia, false) then
    raise exception 'Marca al menos un movimiento que aparezca en tu estado de cuenta.' using errcode = 'P0001'; end if;
  select count(*) into v_n
    from movimientos_financieros m join empresa_bancos_cuentas x on x.banco_id = m.banco_id and x.auth_user_id = m.auth_user_id
   where x.empresa_banco_id = eb.id and m.id = any(coalesce(p_ids, '{}'::uuid[])) and m.estado = 'completado' and not coalesce(m.conciliado, false);
  if v_n <> v_pedidos then
    raise exception 'Algunos movimientos marcados ya no están pendientes (alguien los concilió o anuló). Cierra y vuelve a abrir la conciliación.' using errcode = 'P0001';
  end if;
  for c in select x.banco_id, x.auth_user_id, b.moneda, coalesce(em.nombre_negocio, '') negocio,
                  coalesce((select case when ce.moneda = 'USD' then 'USD' else 'NIO' end from configuracion_empresa ce where ce.auth_user_id = x.auth_user_id limit 1), 'NIO') base,
                  coalesce((select ce.tasa_cambio_usd from configuracion_empresa ce where ce.auth_user_id = x.auth_user_id limit 1), 0) tasa
             from empresa_bancos_cuentas x join bancos b on b.id = x.banco_id
             left join empresa_miembros em on em.auth_user_id = x.auth_user_id and em.empresa_id = v_emp
            where x.empresa_banco_id = eb.id loop
    select dd.saldo_conciliado into d from public._banco_saldo_detalle(c.banco_id) dd;
    select count(*), coalesce(sum(case when m.tipo_flujo = 'INGRESO' then 1 else -1 end * public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, c.moneda, c.base, c.tasa)), 0),
           min(m.fecha), max(m.fecha)
      into p_n, p_marc, p_desde, p_hasta
      from movimientos_financieros m
     where m.banco_id = c.banco_id and m.auth_user_id = c.auth_user_id and m.id = any(coalesce(p_ids, '{}'::uuid[])) and m.estado = 'completado' and not coalesce(m.conciliado, false);
    v_previo := v_previo + coalesce(d.saldo_conciliado, 0);
    v_marcado := v_marcado + p_marc;
    v_desde := least(v_desde, p_desde); v_hasta := greatest(v_hasta, p_hasta);
    v_partes := v_partes || jsonb_build_object('auth_user_id', c.auth_user_id, 'negocio', c.negocio, 'banco_id', c.banco_id, 'movimientos', p_n,
                                               'saldo_conciliado', round(coalesce(d.saldo_conciliado, 0) + p_marc, 2));
  end loop;
  v_calc := round(v_previo + v_marcado, 2);
  v_dif := round(p_saldo_banco - v_calc, 2);
  if abs(v_dif) >= 0.005 and not coalesce(p_con_diferencia, false) then
    raise exception 'Todavía no cuadra: hay una diferencia de %.', to_char(abs(v_dif), 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;
  if abs(v_dif) >= 0.005 and nullif(trim(coalesce(p_nota, '')), '') is null then
    raise exception 'Escribe una nota que explique la diferencia (por ejemplo: "faltan retiros de septiembre, revisar").' using errcode = 'P0001';
  end if;
  if abs(v_dif) < 0.005 then v_dif := 0; end if;
  v_desde := coalesce(v_desde, p_fecha_corte, v_hoy);
  v_hasta := coalesce(p_fecha_corte, v_hasta, v_hoy);
  insert into empresa_conciliaciones (empresa_banco_id, periodo_desde, periodo_hasta, saldo_banco_declarado, saldo_sistema_calculado, partes, creado_por, diferencia, nota, fecha_corte)
  values (eb.id, v_desde, v_hasta, round(p_saldo_banco, 2), v_calc, v_partes, auth.uid(), v_dif, nullif(trim(coalesce(p_nota, '')), ''), p_fecha_corte)
  returning id into v_ec;
  for c in select (e->>'auth_user_id')::uuid uid, (e->>'banco_id')::uuid banco_id, (e->>'saldo_conciliado')::numeric parte, (e->>'movimientos')::integer n
             from jsonb_array_elements(v_partes) e loop
    if c.n > 0 then
      insert into conciliaciones_bancarias (auth_user_id, banco_id, periodo_desde, periodo_hasta, saldo_banco_declarado, saldo_sistema_calculado, diferencia, empresa_conciliacion_id, fecha_corte)
      values (c.uid, c.banco_id, v_desde, v_hasta, c.parte, c.parte, 0, v_ec, p_fecha_corte)
      returning id into v_cb;
      update movimientos_financieros set conciliado = true, conciliacion_id = v_cb
       where banco_id = c.banco_id and auth_user_id = c.uid and id = any(p_ids) and estado = 'completado' and not coalesce(conciliado, false);
    end if;
  end loop;
  return jsonb_build_object('empresa_conciliacion_id', v_ec, 'movimientos', v_n, 'saldo_conciliado', v_calc, 'diferencia', v_dif, 'partes', v_partes);
end $$;

-- ---------- Transferencias/tarjetas que quedaron SIN banco: decir en qué banco están ----------
-- No mueve dinero (Caja total igual); solo completa el dato del banco. Solo movimientos propios,
-- vigentes, sin conciliar, cobrados/pagados por transferencia o tarjeta, y a un banco en la moneda del negocio.
create or replace function public.conciliacion_movs_sin_banco(p_desde date default null, p_hasta date default null)
returns table(id uuid, fecha date, concepto text, tipo_flujo text, monto numeric, metodo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sin sesión activa'; end if;
  return query
  select m.id, m.fecha, m.concepto, m.tipo_flujo, m.monto, m.metodo_pago_nombre
    from movimientos_financieros m
   where m.auth_user_id = auth.uid() and m.estado = 'completado' and m.banco_id is null
     and not coalesce(m.conciliado, false) and coalesce(m.tipo_movimiento, '') <> 'TRANSFERENCIA'
     and (lower(coalesce(m.metodo_pago_nombre, '')) like '%transferencia%' or lower(coalesce(m.metodo_pago_nombre, '')) like '%tarjeta%')
     and (p_desde is null or m.fecha >= p_desde) and (p_hasta is null or m.fecha <= p_hasta)
   order by m.fecha desc, m.created_at desc
   limit 2000;
end $$;

create or replace function public.conciliacion_asignar_banco(p_banco_id uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); b record; v_base text; v_n integer;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  select * into b from bancos where id = p_banco_id and auth_user_id = v_uid;
  if not found then raise exception 'Banco no encontrado'; end if;
  select case when c.moneda = 'USD' then 'USD' else 'NIO' end into v_base from configuracion_empresa c where c.auth_user_id = v_uid limit 1;
  if coalesce(b.moneda, 'NIO') <> coalesce(v_base, 'NIO') then
    raise exception 'Solo se pueden asignar movimientos a un banco en la moneda del negocio.' using errcode = 'P0001'; end if;
  update movimientos_financieros m set banco_id = p_banco_id, updated_at = now()
   where m.id = any(coalesce(p_ids, '{}'::uuid[])) and m.auth_user_id = v_uid and m.estado = 'completado' and m.banco_id is null
     and not coalesce(m.conciliado, false) and coalesce(m.tipo_movimiento, '') <> 'TRANSFERENCIA'
     and (lower(coalesce(m.metodo_pago_nombre, '')) like '%transferencia%' or lower(coalesce(m.metodo_pago_nombre, '')) like '%tarjeta%');
  get diagnostics v_n = row_count;
  return jsonb_build_object('asignados', v_n);
end $$;

-- ---------- Comisión o cargo del banco: GASTO real + su egreso del banco (todo o nada) ----------
create or replace function public.conciliacion_cargo_bancario(p_banco_id uuid, p_monto_banco numeric, p_fecha date, p_concepto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); b record; v_base text; v_tasa numeric; v_monto numeric; v_mb numeric; v_g uuid; v_m uuid; v_conc text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if coalesce(p_monto_banco, 0) <= 0 then raise exception 'El monto debe ser mayor que 0.' using errcode = 'P0001'; end if;
  if p_fecha is null then raise exception 'Elige la fecha del cargo.' using errcode = 'P0001'; end if;
  select * into b from bancos where id = p_banco_id and auth_user_id = v_uid;
  if not found then raise exception 'Banco no encontrado'; end if;
  select case when c.moneda = 'USD' then 'USD' else 'NIO' end, coalesce(c.tasa_cambio_usd, 0)
    into v_base, v_tasa from configuracion_empresa c where c.auth_user_id = v_uid limit 1;
  v_base := coalesce(v_base, 'NIO');
  if coalesce(b.moneda, 'NIO') = v_base then v_monto := round(p_monto_banco, 2); v_mb := null;
  else
    if coalesce(v_tasa, 0) <= 0 then raise exception 'Configura tu tasa de cambio antes de registrar un cargo en otra moneda.' using errcode = 'P0001'; end if;
    v_mb := round(p_monto_banco, 2);
    v_monto := round(case when v_base = 'NIO' then p_monto_banco * v_tasa else p_monto_banco / v_tasa end, 2);
  end if;
  v_conc := 'Cargo bancario ' || b.nombre || ': ' || coalesce(nullif(trim(p_concepto), ''), 'comisión');
  insert into gastos (auth_user_id, tipo, concepto, categoria, monto, fecha, metodo_pago_nombre, estado, origen_tipo, observaciones)
  values (v_uid, 'inmediato', v_conc, 'Comisiones bancarias', v_monto, p_fecha, 'Transferencia', 'activo', 'conciliacion',
          'Registrado desde la conciliación del banco ' || b.nombre)
  returning id into v_g;
  insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                       metodo_pago_nombre, banco_id, monto_moneda_banco, referencia_tipo, referencia_id, fecha, estado)
  values (v_uid, 'EGRESO', 'GASTO', v_conc, v_monto, 0, 0, 'Transferencia', p_banco_id, v_mb, 'gasto', v_g, p_fecha, 'completado')
  returning id into v_m;
  update gastos set movimiento_financiero_id = v_m where id = v_g;
  return jsonb_build_object('gasto_id', v_g, 'movimiento_id', v_m, 'monto', v_monto);
end $$;

revoke all on function public.conciliacion_cerrar_v2(uuid, uuid[], numeric, date, boolean, text) from public, anon;
revoke all on function public.empresa_conciliacion_cerrar_v2(uuid, uuid[], numeric, date, boolean, text) from public, anon;
revoke all on function public.conciliacion_movs_sin_banco(date, date) from public, anon;
revoke all on function public.conciliacion_asignar_banco(uuid, uuid[]) from public, anon;
revoke all on function public.conciliacion_cargo_bancario(uuid, numeric, date, text) from public, anon;
grant execute on function public.conciliacion_cerrar_v2(uuid, uuid[], numeric, date, boolean, text) to authenticated;
grant execute on function public.empresa_conciliacion_cerrar_v2(uuid, uuid[], numeric, date, boolean, text) to authenticated;
grant execute on function public.conciliacion_movs_sin_banco(date, date) to authenticated;
grant execute on function public.conciliacion_asignar_banco(uuid, uuid[]) to authenticated;
grant execute on function public.conciliacion_cargo_bancario(uuid, numeric, date, text) to authenticated;
