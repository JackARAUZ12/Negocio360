-- Ajuste del Panel Agua (29-nov-2026): la mora se cobra solo por meses ANTERIORES al que se genera
-- (no al mes recién creado) y el arreglo de pago incluye lo que vence hoy. Mismas funciones, misma firma.

create or replace function public.agua_generar_mes(p_periodo date, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); v_per date := date_trunc('month', p_periodo)::date;
  a record; v_base numeric; v_iva numeric; v_id uuid; n_new int := 0; n_ya int := 0; n_mora int := 0; n_favor int := 0; v_total numeric := 0;
  v_mora numeric; v_aplic numeric; v_fin date;
begin
  if v_per > (date_trunc('month', current_date) + interval '1 month')::date then raise exception 'Solo se puede generar hasta el mes que viene'; end if;
  v_fin := (v_per + interval '1 month - 1 day')::date;
  for a in select * from agua_abonados where auth_user_id = v_uid and estado = 'activo' and fecha_inicio <= v_fin and cuota > 0 order by codigo for update loop
    if exists (select 1 from agua_cargos where abonado_id = a.id and tipo = 'mensualidad' and periodo = v_per and estado <> 'anulado') then n_ya := n_ya + 1; continue; end if;
    v_base := round(a.cuota, 2);
    v_iva := case when a.cobra_iva then round(v_base * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
    insert into agua_cargos (auth_user_id, abonado_id, tipo, periodo, concepto, base, iva, monto, vence)
    values (v_uid, a.id, 'mensualidad', v_per, 'Agua ' || _agua_mes_txt(v_per), v_base, v_iva, v_base + v_iva, v_per + (a.dia_cobro - 1))
    returning id into v_id;
    n_new := n_new + 1; v_total := v_total + v_base + v_iva;
    if a.saldo_favor > 0 then
      v_aplic := least(a.saldo_favor, v_base + v_iva);
      update agua_cargos set pagado = v_aplic, estado = _agua_estado_cargo(monto, v_aplic) where id = v_id;
      update agua_abonados set saldo_favor = round(saldo_favor - v_aplic, 2), updated_at = now() where id = a.id;
      perform _agua_evento(v_uid, a.id, 'saldo_favor', 'Saldo a favor aplicado a ' || _agua_mes_txt(v_per) || ': ' || v_aplic, '{}'::jsonb, p_usuario);
      n_favor := n_favor + 1;
    end if;
  end loop;
  -- Mora: una vez por mes a quien tenga algo vencido (pasados los días de gracia) y sin arreglo de pago vigente
  if coalesce(cfg->>'mora_tipo', 'ninguno') in ('fijo','porcentaje') and coalesce((cfg->>'mora_valor')::numeric, 0) > 0 then
    for a in select ab.* from agua_abonados ab where ab.auth_user_id = v_uid and ab.estado in ('activo','suspendido','cortado')
               and exists (select 1 from agua_cargos c where c.abonado_id = ab.id and c.estado in ('pendiente','parcial') and c.arreglo_id is null
                             and c.tipo in ('mensualidad','deuda_inicial') and (c.tipo = 'deuda_inicial' or c.periodo < v_per)
                             and c.vence + coalesce((cfg->>'dias_gracia')::int, 0) < current_date)
               and not exists (select 1 from agua_cargos c where c.abonado_id = ab.id and c.tipo = 'mora' and c.periodo = v_per and c.estado <> 'anulado') loop
      v_mora := case when cfg->>'mora_tipo' = 'fijo' then round((cfg->>'mora_valor')::numeric, 2)
                     else round(a.cuota * (cfg->>'mora_valor')::numeric / 100, 2) end;
      if v_mora > 0 then
        insert into agua_cargos (auth_user_id, abonado_id, tipo, periodo, concepto, base, iva, monto, vence)
        values (v_uid, a.id, 'mora', v_per, 'Recargo por mora ' || _agua_mes_txt(v_per), v_mora, 0, v_mora, current_date);
        n_mora := n_mora + 1;
      end if;
    end loop;
  end if;
  perform _agua_evento(v_uid, null, 'generar_mes', 'Cobro de ' || _agua_mes_txt(v_per) || ': ' || n_new || ' nuevos, ' || n_ya || ' ya estaban, ' || n_mora || ' con mora',
                       jsonb_build_object('periodo', v_per, 'nuevos', n_new, 'total', v_total), p_usuario);
  return jsonb_build_object('ok', true, 'periodo', v_per, 'nuevos', n_new, 'ya_estaban', n_ya, 'mora', n_mora, 'saldo_favor', n_favor, 'total', v_total);
end $$;

create or replace function public.agua_crear_arreglo(p_abonado_id uuid, p_cuotas jsonb, p_notas text default null, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); a record; v_deuda numeric; v_suma numeric := 0; q jsonb; v_id uuid; n int := 0; v_ult date;
begin
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Abonado no encontrado'; end if;
  if exists (select 1 from agua_arreglos where abonado_id = a.id and estado = 'vigente') then raise exception 'Este abonado ya tiene un arreglo vigente'; end if;
  select coalesce(sum(monto - pagado), 0) into v_deuda from agua_cargos
   where abonado_id = a.id and estado in ('pendiente','parcial') and arreglo_id is null and vence <= current_date;
  v_deuda := round(v_deuda, 2);
  if v_deuda <= 0 then raise exception 'No tiene deuda vencida para hacer un arreglo'; end if;
  if jsonb_typeof(p_cuotas) <> 'array' or jsonb_array_length(p_cuotas) = 0 then raise exception 'Agrega al menos una cuota'; end if;
  if jsonb_array_length(p_cuotas) > 24 then raise exception 'Máximo 24 cuotas'; end if;
  for q in select * from jsonb_array_elements(p_cuotas) loop
    n := n + 1;
    if nullif(q->>'fecha', '') is null or (q->>'fecha')::date < current_date then raise exception 'La cuota % necesita una fecha de hoy en adelante', n; end if;
    if v_ult is not null and (q->>'fecha')::date < v_ult then raise exception 'Las fechas de las cuotas deben ir en orden'; end if;
    v_ult := (q->>'fecha')::date;
    if round(coalesce((q->>'monto')::numeric, 0), 2) <= 0 then raise exception 'La cuota % debe tener monto', n; end if;
    v_suma := v_suma + round((q->>'monto')::numeric, 2);
  end loop;
  if abs(v_suma - v_deuda) > 0.01 then raise exception 'Las cuotas suman % y la deuda vencida es %', v_suma, v_deuda; end if;
  insert into agua_arreglos (auth_user_id, abonado_id, monto, cuotas, notas, usuario)
  values (v_uid, a.id, v_deuda, p_cuotas, nullif(trim(p_notas), ''), nullif(trim(coalesce(p_usuario, '')), '')) returning id into v_id;
  update agua_cargos set arreglo_id = v_id where abonado_id = a.id and estado in ('pendiente','parcial') and arreglo_id is null and vence <= current_date;
  perform _agua_evento(v_uid, a.id, 'arreglo', 'Arreglo de pago: ' || to_char(v_deuda, 'FM999,999,990.00') || ' en ' || n || ' cuota(s)', jsonb_build_object('arreglo_id', v_id), p_usuario);
  return jsonb_build_object('ok', true, 'id', v_id, 'monto', v_deuda);
end $$;
