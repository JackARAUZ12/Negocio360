-- =====================================================================
-- CAJA / PAGOS → BANCOS · Fecha: 23-oct-2026 · Solo AGREGA (no cambia datos).
--
-- PROBLEMAS (auditoría 23-oct):
--  1) La tarjeta de cada banco sumaba los movimientos en la página, pero la
--     base entrega máximo 1,000 filas por consulta: en negocios con más de
--     1,000 movimientos (All Plastic Comercial y Mayorista, Salumed,
--     OrtXclean) el saldo mostrado salía incompleto.
--  2) Cerrar una conciliación se guardaba en dos pasos (si se cortaba la red
--     quedaba la conciliación sin sus movimientos marcados).
--
-- AHORA:
--  * bancos_saldos(): saldo de cada banco calculado en la base, con la MISMA
--    fórmula de la página (saldo inicial + cobros/pagos por tarjeta o
--    transferencia + transferencias internas, en la moneda del banco),
--    además de lo ya conciliado y cuántos movimientos faltan por conciliar.
--  * bancos_sin_asignar(): cobros por tarjeta/transferencia sin banco.
--  * conciliacion_cerrar(): guarda la conciliación y marca sus movimientos
--    en UNA operación, y vuelve a comprobar que la diferencia sea 0.
-- =====================================================================

-- Monto de un movimiento en la moneda del banco (igual que _montoMonedaBanco de caja.js)
create or replace function public._monto_en_moneda_banco(p_monto numeric, p_monto_banco numeric, p_moneda_banco text, p_moneda_base text, p_tasa numeric)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_moneda_banco, 'NIO') = p_moneda_base then p_monto
    when p_monto_banco is not null then p_monto_banco
    when coalesce(p_tasa, 0) = 0 then p_monto
    when p_moneda_base = 'NIO' then round(p_monto / p_tasa, 2)
    else round(p_monto * p_tasa, 2) end;
$$;

create or replace function public.bancos_saldos()
returns table(banco_id uuid, saldo numeric, saldo_conciliado numeric, pendientes integer)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_base text; v_tasa numeric;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  select case when c.moneda = 'USD' then 'USD' else 'NIO' end, coalesce(c.tasa_cambio_usd, 0)
    into v_base, v_tasa from configuracion_empresa c where c.auth_user_id = v_uid limit 1;
  v_base := coalesce(v_base, 'NIO'); v_tasa := coalesce(v_tasa, 0);
  return query
  select b.id,
    round(coalesce(b.saldo_inicial, 0) + coalesce(sum(
      case when (lower(coalesce(m.metodo_pago_nombre, '')) like '%tarjeta%' or lower(coalesce(m.metodo_pago_nombre, '')) like '%transferencia%'
                 or m.tipo_movimiento = 'TRANSFERENCIA')
           then case when m.tipo_flujo = 'INGRESO' then 1 else -1 end
                * public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, b.moneda, v_base, v_tasa)
           else 0 end), 0), 2),
    round(coalesce(b.saldo_inicial, 0) + coalesce(sum(
      case when m.conciliado then case when m.tipo_flujo = 'INGRESO' then 1 else -1 end
                * public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, b.moneda, v_base, v_tasa)
           else 0 end), 0), 2),
    count(m.id) filter (where not coalesce(m.conciliado, false))::integer
  from bancos b
  left join movimientos_financieros m on m.banco_id = b.id and m.auth_user_id = v_uid and m.estado = 'completado'
  where b.auth_user_id = v_uid
  group by b.id;
end $$;
revoke all on function public.bancos_saldos() from public, anon;
grant execute on function public.bancos_saldos() to authenticated;

create or replace function public.bancos_sin_asignar()
returns table(id uuid, fecha date, concepto text, metodo_pago_nombre text, tipo_flujo text, monto numeric)
language sql stable security definer set search_path = public as $$
  select m.id, m.fecha, m.concepto, m.metodo_pago_nombre, m.tipo_flujo, m.monto
    from movimientos_financieros m
   where m.auth_user_id = auth.uid() and m.estado = 'completado' and m.banco_id is null
     and (lower(coalesce(m.metodo_pago_nombre, '')) like '%tarjeta%' or lower(coalesce(m.metodo_pago_nombre, '')) like '%transferencia%')
   order by m.fecha desc, m.created_at desc, m.id;
$$;
revoke all on function public.bancos_sin_asignar() from public, anon;
grant execute on function public.bancos_sin_asignar() to authenticated;

create or replace function public.conciliacion_cerrar(p_banco_id uuid, p_ids uuid[], p_saldo_banco numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); b record; v_base text; v_tasa numeric;
  v_previo numeric; v_marcado numeric; v_calc numeric; v_dif numeric;
  v_n integer; v_pedidos integer; v_desde date; v_hasta date; v_id uuid;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if p_saldo_banco is null then raise exception 'Escribe el saldo que dice tu banco.'; end if;
  select * into b from bancos where id = p_banco_id and auth_user_id = v_uid for update;   -- una conciliación a la vez por banco
  if not found then raise exception 'Banco no encontrado'; end if;
  select coalesce(array_length(array(select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x), 1), 0) into v_pedidos;
  if v_pedidos = 0 then raise exception 'Marca al menos un movimiento, o agrega un ajuste.'; end if;

  select case when c.moneda = 'USD' then 'USD' else 'NIO' end, coalesce(c.tasa_cambio_usd, 0)
    into v_base, v_tasa from configuracion_empresa c where c.auth_user_id = v_uid limit 1;
  v_base := coalesce(v_base, 'NIO'); v_tasa := coalesce(v_tasa, 0);

  -- Lo ya conciliado antes (mismo cálculo que la ventana)
  select round(coalesce(b.saldo_inicial, 0) + coalesce(sum(case when m.tipo_flujo = 'INGRESO' then 1 else -1 end
           * public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, b.moneda, v_base, v_tasa)), 0), 2)
    into v_previo
    from movimientos_financieros m
   where m.auth_user_id = v_uid and m.banco_id = p_banco_id and m.estado = 'completado' and m.conciliado;

  -- Lo marcado ahora: deben seguir pendientes y ser de este banco
  select count(*), coalesce(sum(case when m.tipo_flujo = 'INGRESO' then 1 else -1 end
           * public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, b.moneda, v_base, v_tasa)), 0),
         min(m.fecha), max(m.fecha)
    into v_n, v_marcado, v_desde, v_hasta
    from movimientos_financieros m
   where m.id = any(p_ids) and m.auth_user_id = v_uid and m.banco_id = p_banco_id
     and m.estado = 'completado' and not coalesce(m.conciliado, false);
  if v_n <> v_pedidos then
    raise exception 'Algunos movimientos marcados ya no están pendientes (alguien los concilió o anuló). Cierra y vuelve a abrir la conciliación.' using errcode = 'P0001';
  end if;

  v_calc := round(v_previo + v_marcado, 2);
  v_dif := round(p_saldo_banco - v_calc, 2);
  if abs(v_dif) >= 0.005 then
    raise exception 'Todavía no cuadra: hay una diferencia de %.', to_char(abs(v_dif), 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;

  insert into conciliaciones_bancarias (auth_user_id, banco_id, periodo_desde, periodo_hasta, saldo_banco_declarado, saldo_sistema_calculado, diferencia)
  values (v_uid, p_banco_id, coalesce(v_desde, (now() at time zone 'America/Managua')::date), coalesce(v_hasta, (now() at time zone 'America/Managua')::date),
          round(p_saldo_banco, 2), v_calc, 0)
  returning id into v_id;

  update movimientos_financieros set conciliado = true, conciliacion_id = v_id
   where id = any(p_ids) and auth_user_id = v_uid and banco_id = p_banco_id and estado = 'completado' and not coalesce(conciliado, false);

  return jsonb_build_object('conciliacion_id', v_id, 'movimientos', v_n, 'saldo_conciliado', v_calc);
end $$;
revoke all on function public.conciliacion_cerrar(uuid, uuid[], numeric) from public, anon;
grant execute on function public.conciliacion_cerrar(uuid, uuid[], numeric) to authenticated;
