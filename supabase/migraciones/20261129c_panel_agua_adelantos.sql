-- Panel Agua, ajuste (29-nov-2026):
-- * Un cobro con "meses por adelantado" que no se termina anula las mensualidades futuras que creó (sin pagos).
-- * Si el abonado lleva IVA, la mora, la reconexión, otros cargos y la deuda importada también lo llevan
--   (así la venta cuadra exacto); no se mezclan en un mismo cobro cargos con y sin IVA.

alter table public.agua_cobros add column if not exists cargos_creados uuid[] not null default '{}'::uuid[];

-- Un cobro que no se terminó: queda "abandonado" y las mensualidades por adelantado que creó (sin pagos) se anulan.
create or replace function public._agua_abandonar(p_cobro_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare k record;
begin
  select * into k from agua_cobros where id = p_cobro_id for update;
  if k.id is null or k.estado <> 'pendiente' then return; end if;
  update agua_cobros set estado = 'abandonado' where id = k.id;
  update agua_cargos set estado = 'anulado', anulado_motivo = 'Cobro por adelantado no terminado'
   where id = any(k.cargos_creados) and pagado = 0 and estado = 'pendiente';
end $$;
create or replace function public.agua_cancelar_cobro(p_cobro_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not exists (select 1 from agua_cobros where id = p_cobro_id and auth_user_id = v_uid) then return jsonb_build_object('ok', false); end if;
  perform public._agua_abandonar(p_cobro_id);
  return jsonb_build_object('ok', true);
end $$;


create or replace function public.agua_importar(p_filas jsonb, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); v_ivad numeric; f jsonb; i int := 0; errores jsonb := '[]'::jsonb; r jsonb; v_id uuid; v_deuda numeric; v_favor numeric;
  vistos text[] := array[]::text[]; v_cod text; n_ok int := 0;
begin
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'No hay filas para importar'; end if;
  if jsonb_array_length(p_filas) > 5000 then raise exception 'Máximo 5000 abonados por archivo'; end if;
  -- 1) revisar todo
  for f in select * from jsonb_array_elements(p_filas) loop
    i := i + 1;
    v_cod := upper(regexp_replace(trim(coalesce(f->>'codigo', '')), '\s+', '', 'g'));
    if v_cod = '' then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Falta el código'));
    elsif v_cod = any(vistos) then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Código repetido en el archivo: ' || v_cod));
    elsif exists (select 1 from agua_abonados where auth_user_id = v_uid and upper(codigo) = v_cod) then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'El código ya existe en el sistema: ' || v_cod));
    end if;
    vistos := vistos || v_cod;
    if trim(coalesce(f->>'nombre', '')) = '' then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Falta el nombre')); end if;
    begin
      if coalesce(nullif(f->>'cuota', '')::numeric, -1) < 0 then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Falta la cuota mensual')); end if;
      if nullif(f->>'dia_cobro', '') is not null and (f->>'dia_cobro')::int not between 1 and 28 then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Día de cobro fuera de 1-28')); end if;
      if coalesce(nullif(f->>'deuda', '')::numeric, 0) < 0 or coalesce(nullif(f->>'saldo_favor', '')::numeric, 0) < 0 then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Montos negativos')); end if;
    exception when others then errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Número no válido en cuota, día o montos'));
    end;
    if coalesce(nullif(f->>'estado', ''), 'activo') not in ('activo','pausado','suspendido','cortado') then
      errores := errores || jsonb_build_array(jsonb_build_object('fila', i, 'error', 'Estado no válido (Activo, Pausado, Suspendido o Cortado)'));
    end if;
  end loop;
  if jsonb_array_length(errores) > 0 then return jsonb_build_object('ok', false, 'errores', errores); end if;
  -- 2) guardar
  for f in select * from jsonb_array_elements(p_filas) loop
    r := public.agua_guardar_abonado(f - 'id', p_usuario);
    v_id := (r->>'id')::uuid; n_ok := n_ok + 1;
    v_deuda := round(coalesce(nullif(f->>'deuda', '')::numeric, 0), 2);
    v_favor := round(coalesce(nullif(f->>'saldo_favor', '')::numeric, 0), 2);
    if v_deuda > 0 then
      v_ivad := case when coalesce((f->>'cobra_iva')::boolean, false) then round(v_deuda - v_deuda / (1 + (cfg->>'iva_pct')::numeric / 100), 2) else 0 end;
      insert into agua_cargos (auth_user_id, abonado_id, tipo, concepto, base, iva, monto, vence)
      values (v_uid, v_id, 'deuda_inicial', 'Deuda anterior' || coalesce(' (' || nullif(f->>'meses_atrasados', '') || ' meses)', ''), v_deuda - v_ivad, v_ivad, v_deuda, current_date - 1);
    end if;
    if v_favor > 0 then update agua_abonados set saldo_favor = v_favor where id = v_id; end if;
  end loop;
  perform _agua_evento(v_uid, null, 'importacion', n_ok || ' abonados importados', '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true, 'importados', n_ok);
end $$;

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
        v_iva := case when a.cobra_iva then round(v_mora * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
        insert into agua_cargos (auth_user_id, abonado_id, tipo, periodo, concepto, base, iva, monto, vence)
        values (v_uid, a.id, 'mora', v_per, 'Recargo por mora ' || _agua_mes_txt(v_per), v_mora, v_iva, v_mora + v_iva, current_date);
        n_mora := n_mora + 1;
      end if;
    end loop;
  end if;
  perform _agua_evento(v_uid, null, 'generar_mes', 'Cobro de ' || _agua_mes_txt(v_per) || ': ' || n_new || ' nuevos, ' || n_ya || ' ya estaban, ' || n_mora || ' con mora',
                       jsonb_build_object('periodo', v_per, 'nuevos', n_new, 'total', v_total), p_usuario);
  return jsonb_build_object('ok', true, 'periodo', v_per, 'nuevos', n_new, 'ya_estaban', n_ya, 'mora', n_mora, 'saldo_favor', n_favor, 'total', v_total);
end $$;

create or replace function public.agua_preparar_cobro(p_abonado_id uuid, p_cargo_ids uuid[], p_monto numeric, p_meses_adelanto int default 0, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); a record; c record; v_rest numeric; v_apl numeric; v_aplic jsonb := '[]'::jsonb;
  v_base numeric := 0; v_iva numeric := 0; v_pend numeric; v_ids uuid[] := coalesce(p_cargo_ids, array[]::uuid[]); v_per date; v_k int; v_id uuid;
  v_conceptos text[] := array[]::text[]; v_cobro uuid; v_iva_pct numeric; v_creados uuid[] := array[]::uuid[]; k record; v_con int; v_sin int;
begin
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Abonado no encontrado'; end if;
  -- Un cobro anterior que quedó a medias se cancela primero (y sus meses por adelantado sin pagar se anulan)
  for k in select id from agua_cobros where abonado_id = a.id and estado = 'pendiente' loop perform public._agua_abandonar(k.id); end loop;
  if coalesce(p_meses_adelanto, 0) < 0 or coalesce(p_meses_adelanto, 0) > 24 then raise exception 'Meses por adelantado: de 0 a 24'; end if;
  -- Meses por adelantado: se crean las mensualidades que siguen a la última que ya existe
  if coalesce(p_meses_adelanto, 0) > 0 then
    if a.cuota <= 0 then raise exception 'El abonado no tiene cuota para cobrar meses por adelantado'; end if;
    select coalesce(max(periodo), (date_trunc('month', current_date) - interval '1 month')::date) into v_per
      from agua_cargos where abonado_id = a.id and tipo = 'mensualidad' and estado <> 'anulado';
    for v_k in 1..p_meses_adelanto loop
      v_per := (v_per + interval '1 month')::date;
      v_iva := case when a.cobra_iva then round(a.cuota * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
      insert into agua_cargos (auth_user_id, abonado_id, tipo, periodo, concepto, base, iva, monto, vence)
      values (v_uid, a.id, 'mensualidad', v_per, 'Agua ' || _agua_mes_txt(v_per), a.cuota, v_iva, a.cuota + v_iva, v_per + (a.dia_cobro - 1))
      returning id into v_id;
      v_ids := v_ids || v_id; v_creados := v_creados || v_id;
    end loop;
    v_iva := 0;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Elige qué meses o cargos se pagan'; end if;
  select count(*) filter (where iva > 0), count(*) filter (where iva = 0) into v_con, v_sin
    from agua_cargos where id = any(v_ids) and abonado_id = a.id and estado in ('pendiente','parcial');
  if v_con > 0 and v_sin > 0 then raise exception 'Cobra por separado lo que lleva IVA y lo que no lleva IVA'; end if;
  select coalesce(sum(monto - pagado), 0) into v_pend from agua_cargos where id = any(v_ids) and abonado_id = a.id and estado in ('pendiente','parcial');
  if round(coalesce(p_monto, 0), 2) <= 0 then raise exception 'El monto a cobrar debe ser mayor que 0'; end if;
  if round(p_monto, 2) > round(v_pend, 2) + 0.01 then raise exception 'El monto (%) es más de lo que se debe en lo elegido (%)', round(p_monto, 2), round(v_pend, 2); end if;
  v_rest := round(p_monto, 2);
  for c in select * from agua_cargos where id = any(v_ids) and abonado_id = a.id and estado in ('pendiente','parcial')
             order by case tipo when 'deuda_inicial' then 0 else 1 end, vence, periodo nulls first, created_at for update loop
    exit when v_rest <= 0;
    v_apl := least(v_rest, round(c.monto - c.pagado, 2));
    continue when v_apl <= 0;
    v_aplic := v_aplic || jsonb_build_array(jsonb_build_object('cargo_id', c.id, 'monto', v_apl));
    v_conceptos := v_conceptos || (c.concepto || case when v_apl < round(c.monto - c.pagado, 2) then ' (abono)' else '' end);
    v_iva := v_iva + round(v_apl * c.iva / c.monto, 2);
    v_rest := round(v_rest - v_apl, 2);
  end loop;
  v_base := round(p_monto - v_iva, 2);
  v_iva_pct := case when v_iva > 0 then (cfg->>'iva_pct')::numeric else 0 end;
  insert into agua_cobros (auth_user_id, abonado_id, monto, aplicaciones, usuario, cargos_creados)
  values (v_uid, a.id, round(p_monto, 2), v_aplic, nullif(trim(coalesce(p_usuario, '')), ''), v_creados) returning id into v_cobro;
  return jsonb_build_object('ok', true, 'cobro_id', v_cobro, 'monto', round(p_monto, 2), 'base', v_base, 'iva', round(v_iva, 2), 'iva_pct', v_iva_pct,
                            'cliente_id', a.cliente_id, 'codigo', a.codigo,
                            'concepto', 'Agua ' || a.codigo || ': ' || array_to_string(v_conceptos, ', '));
end $$;

create or replace function public.agua_cargo_extra(p_abonado_id uuid, p_tipo text, p_concepto text, p_monto numeric, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); a record; v_id uuid; v_m numeric := round(coalesce(p_monto, 0), 2); v_iva numeric;
begin
  if p_tipo not in ('reconexion','otro') then raise exception 'Tipo de cargo no válido'; end if;
  if round(coalesce(p_monto, 0), 2) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;
  if trim(coalesce(p_concepto, '')) = '' then raise exception 'Escribe el concepto'; end if;
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid;
  if not found then raise exception 'Abonado no encontrado'; end if;
  v_iva := case when a.cobra_iva then round(v_m * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
  insert into agua_cargos (auth_user_id, abonado_id, tipo, concepto, base, iva, monto, vence)
  values (v_uid, a.id, p_tipo, trim(p_concepto), v_m, v_iva, v_m + v_iva, current_date) returning id into v_id;
  perform _agua_evento(v_uid, a.id, 'cargo', 'Cargo: ' || trim(p_concepto) || ' ' || to_char(round(p_monto, 2), 'FM999,999,990.00'), '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.agua_cambiar_estado(p_abonado_id uuid, p_estado text, p_motivo text default null, p_cobrar_reconexion boolean default false, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public._agua_check(); cfg jsonb := public._agua_cfg(v_uid); a record; v_rec numeric := 0; v_iva numeric := 0;
begin
  if p_estado not in ('activo','pausado','suspendido','cortado') then raise exception 'Estado no válido'; end if;
  select * into a from agua_abonados where id = p_abonado_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Abonado no encontrado'; end if;
  if a.estado = p_estado then return jsonb_build_object('ok', true, 'ya', true); end if;
  update agua_abonados set estado = p_estado, updated_at = now() where id = a.id;
  if a.estado = 'cortado' and p_estado = 'activo' and coalesce(p_cobrar_reconexion, false) then
    v_rec := round(coalesce((cfg->>'reconexion')::numeric, 0), 2);
    if v_rec > 0 then
      v_iva := case when a.cobra_iva then round(v_rec * (cfg->>'iva_pct')::numeric / 100, 2) else 0 end;
      insert into agua_cargos (auth_user_id, abonado_id, tipo, concepto, base, iva, monto, vence)
      values (v_uid, a.id, 'reconexion', 'Reconexión del servicio', v_rec, v_iva, v_rec + v_iva, current_date);
    end if;
  end if;
  perform _agua_evento(v_uid, a.id, 'estado', initcap(a.estado) || ' → ' || initcap(p_estado)
                       || case when v_rec > 0 then ' · cargo de reconexión ' || to_char(v_rec, 'FM999,999,990.00') else '' end
                       || coalesce(' — ' || nullif(trim(p_motivo), ''), ''), '{}'::jsonb, p_usuario);
  return jsonb_build_object('ok', true, 'reconexion', v_rec);
end $$;

revoke all on function public._agua_abandonar(uuid) from public, anon, authenticated;
revoke all on function public.agua_cancelar_cobro(uuid) from public, anon;
grant execute on function public.agua_cancelar_cobro(uuid) to authenticated;
