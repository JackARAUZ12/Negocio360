-- =====================================================================
-- CIERRE DE MES CONFIGURABLE + "EMPEZAR DE CERO" · 24-oct-2026 · OPCIONAL
--
-- * configuracion_empresa.dia_cierre_mensual (1..28; null = último día
--   del mes, como siempre). Con 20, cada período va del 21 al 20.
-- * configuracion_empresa.cierre_empezar_cero: al cerrar el mes, el saldo
--   de Caja se registra como RETIRO (a dónde se fue el dinero), y el nuevo
--   período empieza en 0. Nada se borra ni se esconde: son movimientos
--   reales y se anulan si se deshace el cierre.
-- * caja_cierre_periodo(): hace el cierre en UNA operación: resumen,
--   arqueo opcional (faltante/sobrante) y retiro opcional.
-- * caja_cierre_deshacer(): borra el cierre y anula los movimientos que
--   ese cierre creó.
-- * Arreglo: al agregar un movimiento en la fecha de un cierre MENSUAL, la
--   base recalculaba ese cierre con un solo día. Ahora el mensual se
--   recalcula con todo su período; el diario queda igual que antes.
-- * Cierre automático: respeta el día elegido por cada negocio.
-- Negocios que no configuran nada: todo sigue exactamente igual.
-- =====================================================================

alter table public.configuracion_empresa add column if not exists dia_cierre_mensual smallint;
alter table public.configuracion_empresa add column if not exists cierre_empezar_cero boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'configuracion_empresa_dia_cierre_chk') then
    alter table public.configuracion_empresa add constraint configuracion_empresa_dia_cierre_chk check (dia_cierre_mensual is null or dia_cierre_mensual between 1 and 28);
  end if;
end $$;

alter table public.cierres_caja add column if not exists efectivo_contado numeric(14,2);
alter table public.cierres_caja add column if not exists diferencia_arqueo numeric(14,2);
alter table public.cierres_caja add column if not exists monto_retirado numeric(14,2);
alter table public.cierres_caja add column if not exists movimientos_cierre uuid[];

-- Período (desde, hasta) del mes que termina en p_hasta, según el día de cierre
create or replace function public._periodo_cierre(p_dia smallint, p_hasta date)
returns table(desde date, hasta date) language sql immutable set search_path = public as $$
  select case when p_dia is null then date_trunc('month', p_hasta)::date
              else ((p_hasta - interval '1 month')::date + 1) end,
         p_hasta;
$$;

-- Fin del último período que ya terminó (o termina hoy) para un día de cierre
create or replace function public._fin_periodo_actual(p_dia smallint, p_hoy date)
returns date language sql immutable set search_path = public as $$
  select case
    when p_dia is null then (date_trunc('month', p_hoy) + interval '1 month - 1 day')::date
    when extract(day from p_hoy) >= p_dia then make_date(extract(year from p_hoy)::int, extract(month from p_hoy)::int, p_dia)
    else (make_date(extract(year from p_hoy)::int, extract(month from p_hoy)::int, p_dia) - interval '1 month')::date end;
$$;

-- Núcleo del cierre (lo usan el botón y el cierre automático)
create or replace function public._caja_cierre_periodo(p_uid uuid, p_hasta date, p_efectivo_contado numeric,
                                                      p_retirar boolean, p_automatico boolean, p_nota text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dia smallint; v_desde date; v_hasta date; v_ini numeric; v_ing numeric; v_egr numeric; v_cnt integer;
  v_final numeric; v_dif numeric := null; v_ret numeric := 0; v_id uuid; v_mov uuid; v_movs uuid[] := '{}';
  v_fecha_mov date; v_txt text;
begin
  select dia_cierre_mensual into v_dia from configuracion_empresa where auth_user_id = p_uid;
  select desde, hasta into v_desde, v_hasta from _periodo_cierre(v_dia, p_hasta);
  if v_dia is not null and extract(day from v_hasta) <> v_dia then
    raise exception 'La fecha de cierre no coincide con tu día de cierre (%).', v_dia using errcode = 'P0001'; end if;
  if exists (select 1 from cierres_caja where auth_user_id = p_uid and fecha = v_hasta and tipo = 'mensual') then
    raise exception 'Ya existe el cierre del período que termina el %.', to_char(v_hasta, 'DD/MM/YYYY') using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtextextended('mov_fin:' || p_uid::text, 0));
  select coalesce(sum(case when tipo_flujo = 'INGRESO' then monto else -monto end), 0) into v_ini
    from movimientos_financieros where auth_user_id = p_uid and estado = 'completado' and fecha < v_desde;
  select coalesce(sum(monto) filter (where tipo_flujo = 'INGRESO' and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
         coalesce(sum(monto) filter (where tipo_flujo = 'EGRESO'  and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
         count(*)
    into v_ing, v_egr, v_cnt
    from movimientos_financieros where auth_user_id = p_uid and estado = 'completado' and fecha between v_desde and v_hasta;
  v_ini := round(v_ini, 2); v_final := round(v_ini + v_ing - v_egr, 2);
  v_fecha_mov := least(v_hasta, _hoy_managua());
  v_txt := to_char(v_desde, 'DD/MM/YYYY') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY');

  insert into cierres_caja (auth_user_id, fecha, tipo, periodo_inicio, periodo_fin, saldo_inicial, total_ingresos, total_egresos,
                            saldo_final, movimientos_count, automatico, notas)
  values (p_uid, v_hasta, 'mensual', v_desde, v_hasta, v_ini, v_ing, v_egr, v_final, v_cnt, coalesce(p_automatico, false), nullif(trim(coalesce(p_nota,'')), ''))
  returning id into v_id;

  -- Arqueo: lo que de verdad había contra lo que dice el sistema
  if p_efectivo_contado is not null then
    if p_efectivo_contado < 0 then raise exception 'El dinero contado no puede ser negativo.' using errcode = 'P0001'; end if;
    v_dif := round(p_efectivo_contado - v_final, 2);
    if v_dif <> 0 then
      insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                           metodo_pago_nombre, observaciones, fecha, estado)
      values (p_uid, case when v_dif > 0 then 'INGRESO' else 'EGRESO' end, case when v_dif > 0 then 'OTRO_INGRESO' else 'OTRO_EGRESO' end,
              case when v_dif > 0 then 'Sobrante en arqueo de cierre (' else 'Faltante en arqueo de cierre (' end || v_txt || ')',
              abs(v_dif), 0, 0, 'Efectivo', 'Contado: ' || round(p_efectivo_contado, 2) || ' · Sistema: ' || v_final, v_fecha_mov, 'completado')
      returning id into v_mov;
      v_movs := v_movs || v_mov;
    end if;
  end if;

  -- Empezar de cero: todo el saldo del cierre sale como retiro
  if coalesce(p_retirar, false) then
    v_ret := round(coalesce(p_efectivo_contado, v_final), 2);
    if v_ret > 0 then
      insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                           metodo_pago_nombre, referencia_tipo, referencia_id, observaciones, fecha, estado)
      values (p_uid, 'EGRESO', 'RETIRO', 'Retiro por cierre de mes (' || v_txt || ')', v_ret, 0, 0, 'Efectivo', 'cierre_mes', v_id,
              'La Caja empieza de cero en el nuevo período', v_fecha_mov, 'completado')
      returning id into v_mov;
      v_movs := v_movs || v_mov;
    else v_ret := 0; end if;
  end if;

  update cierres_caja set efectivo_contado = p_efectivo_contado, diferencia_arqueo = v_dif, monto_retirado = nullif(v_ret, 0),
                          movimientos_cierre = nullif(v_movs, '{}') where id = v_id;
  return jsonb_build_object('cierre_id', v_id, 'desde', v_desde, 'hasta', v_hasta, 'saldo_inicial', v_ini, 'ingresos', v_ing,
                            'egresos', v_egr, 'saldo_sistema', v_final, 'diferencia', v_dif, 'retirado', v_ret);
end $$;
revoke all on function public._caja_cierre_periodo(uuid, date, numeric, boolean, boolean, text) from public, anon, authenticated;

create or replace function public.caja_cierre_periodo(p_hasta date, p_efectivo_contado numeric default null, p_retirar boolean default false, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sin sesión activa'; end if;
  if p_hasta is null then raise exception 'Falta la fecha de cierre.' using errcode = 'P0001'; end if;
  return public._caja_cierre_periodo(auth.uid(), p_hasta, p_efectivo_contado, p_retirar, false, p_nota);
end $$;
revoke all on function public.caja_cierre_periodo(date, numeric, boolean, text) from public, anon;
grant execute on function public.caja_cierre_periodo(date, numeric, boolean, text) to authenticated;

-- Deshacer un cierre: anula los movimientos que creó y borra el resumen
create or replace function public.caja_cierre_deshacer(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c record; v_n integer := 0;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  select * into c from cierres_caja where id = p_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Cierre no encontrado.' using errcode = 'P0001'; end if;
  if c.movimientos_cierre is not null then
    update movimientos_financieros set estado = 'anulado', updated_at = now()
     where id = any(c.movimientos_cierre) and auth_user_id = v_uid and estado = 'completado';
    get diagnostics v_n = row_count;
  end if;
  delete from cierres_caja where id = c.id;
  return jsonb_build_object('movimientos_anulados', v_n);
end $$;
revoke all on function public.caja_cierre_deshacer(uuid) from public, anon;
grant execute on function public.caja_cierre_deshacer(uuid) to authenticated;

-- Arreglo: el cierre MENSUAL se recalcula con todo su período (antes, con un solo día)
create or replace function public.fn_actualizar_cierres_al_agregar_movimiento()
returns trigger language plpgsql as $$
begin
  if new.estado <> 'completado' or new.fecha is null then
    return new;
  end if;
  -- Diarios: igual que siempre (solo el día del cierre)
  update cierres_caja cc
  set
    total_ingresos = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cc.auth_user_id and fecha = cc.fecha and estado = 'completado' and tipo_flujo = 'INGRESO'
        and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
    total_egresos = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cc.auth_user_id and fecha = cc.fecha and estado = 'completado' and tipo_flujo = 'EGRESO'
        and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
    movimientos_count = (select count(*) from movimientos_financieros
      where auth_user_id = cc.auth_user_id and fecha = cc.fecha and estado = 'completado')
  where cc.auth_user_id = new.auth_user_id and cc.fecha = new.fecha and cc.tipo is distinct from 'mensual';
  -- Mensuales: todo el período al que pertenece la fecha del movimiento
  update cierres_caja cc
  set
    total_ingresos = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cc.auth_user_id and fecha between cc.periodo_inicio and cc.periodo_fin and estado = 'completado'
        and tipo_flujo = 'INGRESO' and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
    total_egresos = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cc.auth_user_id and fecha between cc.periodo_inicio and cc.periodo_fin and estado = 'completado'
        and tipo_flujo = 'EGRESO' and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
    movimientos_count = (select count(*) from movimientos_financieros
      where auth_user_id = cc.auth_user_id and fecha between cc.periodo_inicio and cc.periodo_fin and estado = 'completado')
  where cc.auth_user_id = new.auth_user_id and cc.tipo = 'mensual'
    and cc.periodo_inicio is not null and cc.periodo_fin is not null and new.fecha between cc.periodo_inicio and cc.periodo_fin;

  update cierres_caja set saldo_final = saldo_inicial + total_ingresos - total_egresos
  where auth_user_id = new.auth_user_id
    and ((fecha = new.fecha and tipo is distinct from 'mensual')
      or (tipo = 'mensual' and periodo_inicio is not null and new.fecha between periodo_inicio and periodo_fin));

  update caja_chica_sesiones cs
  set
    total_ingresos = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cs.auth_user_id and fecha = cs.fecha and estado = 'completado' and tipo_flujo = 'INGRESO'
        and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
    total_egresos = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cs.auth_user_id and fecha = cs.fecha and estado = 'completado' and tipo_flujo = 'EGRESO'
        and tipo_movimiento is distinct from 'TRANSFERENCIA'), 0),
    total_ingresos_efectivo = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cs.auth_user_id and fecha = cs.fecha and estado = 'completado' and tipo_flujo = 'INGRESO'
        and (case when tipo_movimiento in ('TRANSFERENCIA','CAPITAL_AGREGADO') then origen_caja = 'chica'
                  else lower(coalesce(metodo_pago_nombre, 'Efectivo')) like '%efectivo%' end)), 0),
    total_egresos_efectivo = coalesce((select sum(monto) from movimientos_financieros
      where auth_user_id = cs.auth_user_id and fecha = cs.fecha and estado = 'completado' and tipo_flujo = 'EGRESO'
        and (case when tipo_movimiento = 'TRANSFERENCIA' then origen_caja = 'chica'
                  when origen_caja = 'general' then false
                  when origen_caja = 'chica' then true
                  else lower(coalesce(metodo_pago_nombre, 'Efectivo')) like '%efectivo%' end)), 0),
    movimientos_count = (select count(*) from movimientos_financieros
      where auth_user_id = cs.auth_user_id and fecha = cs.fecha and estado = 'completado')
  where cs.auth_user_id = new.auth_user_id and cs.fecha = new.fecha and cs.estado = 'cerrada';

  update caja_chica_sesiones
  set monto_cierre_teorico = monto_apertura + total_ingresos_efectivo - total_egresos_efectivo,
      diferencia = monto_cierre_real - (monto_apertura + total_ingresos_efectivo - total_egresos_efectivo)
  where auth_user_id = new.auth_user_id and fecha = new.fecha and estado = 'cerrada';
  return new;
end;
$$;

-- Cierre automático: cada negocio en su día (null = día 1, como siempre)
create or replace function public.generar_cierres_automaticos()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ayer date := (current_date - 1);
  v_diarios int := 0;
  v_mensuales int := 0;
  r record;
  v_ini numeric; v_ing numeric; v_egr numeric; v_cnt int;
begin
  -- ===== CIERRE DIARIO AUTOMATICO (igual que antes) =====
  for r in select ce.auth_user_id from configuracion_empresa ce where ce.cierre_auto_diario = true loop
    if exists (select 1 from cierres_caja where auth_user_id = r.auth_user_id and fecha = v_ayer and tipo = 'diario') then continue; end if;
    select coalesce((select saldo_anterior from movimientos_financieros
                     where auth_user_id = r.auth_user_id and estado='completado' and fecha = v_ayer
                     order by created_at limit 1), 0),
           coalesce(sum(monto) filter (where tipo_flujo='INGRESO'), 0),
           coalesce(sum(monto) filter (where tipo_flujo='EGRESO'), 0),
           count(*)
      into v_ini, v_ing, v_egr, v_cnt
      from movimientos_financieros
     where auth_user_id = r.auth_user_id and estado='completado' and fecha = v_ayer;
    if v_cnt = 0 then continue; end if;
    insert into cierres_caja (auth_user_id, fecha, tipo, saldo_inicial, total_ingresos, total_egresos, saldo_final, movimientos_count, automatico)
    values (r.auth_user_id, v_ayer, 'diario', v_ini, v_ing, v_egr, v_ini + v_ing - v_egr, v_cnt, true);
    v_diarios := v_diarios + 1;
  end loop;

  -- ===== CIERRE MENSUAL AUTOMATICO: el día siguiente al día de cierre de cada negocio =====
  for r in select ce.auth_user_id, ce.dia_cierre_mensual, ce.cierre_empezar_cero from configuracion_empresa ce where ce.cierre_auto_mensual = true loop
    -- ¿Ayer terminó su período?
    if not ((r.dia_cierre_mensual is null and extract(day from current_date) = 1)
         or (r.dia_cierre_mensual is not null and extract(day from v_ayer) = r.dia_cierre_mensual)) then
      continue;
    end if;
    if exists (select 1 from cierres_caja where auth_user_id = r.auth_user_id and fecha = v_ayer and tipo = 'mensual') then continue; end if;
    if not exists (select 1 from movimientos_financieros m, _periodo_cierre(r.dia_cierre_mensual, v_ayer) p
                    where m.auth_user_id = r.auth_user_id and m.estado = 'completado' and m.fecha between p.desde and p.hasta) then
      continue;
    end if;
    begin
      perform public._caja_cierre_periodo(r.auth_user_id, v_ayer, null, coalesce(r.cierre_empezar_cero, false), true, 'Cierre automático');
      v_mensuales := v_mensuales + 1;
    exception when others then
      raise warning 'cierre automático % : %', r.auth_user_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('diarios_creados', v_diarios, 'mensuales_creados', v_mensuales, 'fecha', current_date);
end $$;
revoke execute on function public.generar_cierres_automaticos() from public, anon, authenticated;
