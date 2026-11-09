-- =====================================================================
-- Panel Microfinanciera: DÍAS DE COBRO (9-nov-2026)
-- Opciones: 'todos' | 'lun_sab' (sin domingo, lo de siempre) | 'lun_vie' (sin sábado ni domingo)
-- * Solo afecta créditos NUEVOS: los existentes no tienen mf_dias_cobro (null) y
--   siguen calculando exactamente igual que antes (fechas, atraso y mora).
-- * Con lun_vie: diarios nunca caen sábado ni domingo; semanal/quincenal/mensual
--   que caiga en fin de semana pasa al lunes siguiente.
-- * Atraso y mora de los créditos nuevos cuentan SOLO días de cobro
--   (viernes sin pagar -> el lunes es 1 día de atraso, no 3).
-- =====================================================================

alter table public.configuracion_empresa add column if not exists mf_dias_cobro text not null default 'lun_sab';
do $$ begin
  alter table public.configuracion_empresa add constraint configuracion_empresa_mf_dias_cobro_chk check (mf_dias_cobro in ('todos','lun_sab','lun_vie'));
exception when duplicate_object then null; end $$;
alter table public.creditos add column if not exists mf_dias_cobro text;
do $$ begin
  alter table public.creditos add constraint creditos_mf_dias_cobro_chk check (mf_dias_cobro is null or mf_dias_cobro in ('todos','lun_sab','lun_vie'));
exception when duplicate_object then null; end $$;

-- ¿Ese día se cobra?
create or replace function public._mf_dia_cobra(p_d date, p_dias text) returns boolean language sql immutable as $$
  select case p_dias when 'lun_vie' then extract(isodow from p_d) < 6
                     when 'lun_sab' then extract(isodow from p_d) <> 7
                     else true end $$;

-- Fecha de la cuota i según los días de cobro
create or replace function public._mf_fecha_cuota2(p_inicio date, p_frec text, p_i integer, p_dias text)
returns date language plpgsql immutable as $$
declare d date := p_inicio; k integer := 0; g integer := 0;
begin
  if p_frec = 'diaria' then
    while not public._mf_dia_cobra(d, p_dias) and g < 7 loop d := d + 1; g := g + 1; end loop;
    while k < p_i loop
      d := d + 1; g := 0;
      while not public._mf_dia_cobra(d, p_dias) and g < 7 loop d := d + 1; g := g + 1; end loop;
      k := k + 1;
    end loop;
    return d;
  end if;
  d := public._mf_fecha_cuota(p_inicio, p_frec, p_i, false);
  if p_dias = 'lun_vie' then
    while not public._mf_dia_cobra(d, p_dias) and g < 7 loop d := d + 1; g := g + 1; end loop;
  end if;
  return d;
end $$;

-- Días de cobro entre dos fechas: cuenta los días de (desde, hasta] en que se cobra.
-- Sin regla (créditos viejos) = días de calendario, como siempre.
create or replace function public._mf_dias_habiles(p_desde date, p_hasta date, p_dias text) returns integer language sql immutable as $$
  select case when p_hasta <= p_desde then 0
              when p_dias is null then p_hasta - p_desde
              else (select count(*)::int from generate_series(p_desde + 1, p_hasta, interval '1 day') g(d) where public._mf_dia_cobra(g.d::date, p_dias)) end $$;

-- Mora: créditos nuevos cuentan solo días de cobro; los viejos, igual que antes.
create or replace function public._mf_mora_calc(p_cred uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg record; v_hoy date := (now() at time zone 'America/Managua')::date; q record; v_d integer; v_m numeric := 0; v_atr numeric := 0; v_maxd integer := 0;
  v_cu jsonb := '[]'::jsonb; v_dias text; v_late integer;
begin
  select mf_mora_tipo t, mf_mora_valor v, mf_mora_gracia g, mf_mora_tope_pct tp into cfg from configuracion_empresa where auth_user_id = p_uid limit 1;
  if cfg.t is null or cfg.t = 'ninguna' or coalesce(cfg.v, 0) <= 0 then
    return jsonb_build_object('mora', 0, 'dias', 0, 'atrasado', 0, 'cuotas', '[]'::jsonb, 'tipo', coalesce(cfg.t, 'ninguna')); end if;
  select mf_dias_cobro into v_dias from creditos where id = p_cred and auth_user_id = p_uid;
  for q in select id, fecha_vencimiento, round(monto_total - coalesce(monto_pagado, 0), 2) falta, mf_mora_hasta
             from creditos_cuotas where credito_id = p_cred and auth_user_id = p_uid and estado <> 'pagada'
              and fecha_vencimiento < v_hoy order by numero loop
    continue when q.falta <= 0.005;
    if v_dias is null then
      continue when not (q.fecha_vencimiento + coalesce(cfg.g, 0) < v_hoy);
      v_d := v_hoy - greatest(q.fecha_vencimiento + coalesce(cfg.g, 0), coalesce(q.mf_mora_hasta, date '1900-01-01'));
    else
      v_late := public._mf_dias_habiles(q.fecha_vencimiento, v_hoy, v_dias) - coalesce(cfg.g, 0);
      continue when v_late <= 0;
      v_d := case when q.mf_mora_hasta is null then v_late else least(v_late, public._mf_dias_habiles(q.mf_mora_hasta, v_hoy, v_dias)) end;
    end if;
    v_atr := v_atr + q.falta;
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
revoke all on function public._mf_mora_calc(uuid, uuid) from public, anon, authenticated;

-- Guardar los días de cobro del negocio (solo el dueño, desde el Panel)
create or replace function public.mf_dias_cobro_config(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_act jsonb; v_d text := p ->> 'dias';
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  v_act := public._mf_actor(v_uid, p ->> 'token');
  if v_act is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_act ->> 'rol' <> 'dueno' then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  if v_d is null or v_d not in ('todos','lun_sab','lun_vie') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  perform set_config('n360.mf_ok', '1', true);
  update configuracion_empresa set mf_dias_cobro = v_d where auth_user_id = v_uid;
  perform set_config('n360.mf_ok', '', true);
  return jsonb_build_object('ok', true, 'dias', v_d);
end $$;
revoke all on function public.mf_dias_cobro_config(jsonb) from public, anon;
grant execute on function public.mf_dias_cobro_config(jsonb) to authenticated;

-- Candado: los días de cobro solo se cambian desde el Panel (como las demás reglas)
do $$ declare d text;
begin
  d := pg_get_functiondef('public._mf_guard'::regproc);
  if position('mf_dias_cobro' in d) = 0 then
    if position('or new.mf_metodos_efectivo is distinct from old.mf_metodos_efectivo then' in d) = 0 then raise exception 'guard: ancla no encontrada'; end if;
    d := replace(d, 'or new.mf_metodos_efectivo is distinct from old.mf_metodos_efectivo then',
                    'or new.mf_metodos_efectivo is distinct from old.mf_metodos_efectivo or new.mf_dias_cobro is distinct from old.mf_dias_cobro then');
    execute d;
  end if;
end $$;
drop trigger if exists trg_mf_guard on public.configuracion_empresa;
create trigger trg_mf_guard before update of mf_con_equipo, mf_mora_tipo, mf_mora_valor, mf_mora_gracia, mf_mora_tope_pct,
  mf_mora_perdona_cobrador, mf_limite_defecto, mf_bloq_atraso_dias, mf_metodos_efectivo, mf_dias_cobro
  on public.configuracion_empresa for each row execute function public._mf_guard();

-- Crear crédito: usa los días de cobro (si no llegan, se comporta como siempre)
do $$ declare d text;
begin
  d := pg_get_functiondef('public.mf_credito_crear'::regproc);
  if position('_mf_fecha_cuota2' in d) > 0 then return; end if;
  if position($a$v_sindom boolean := coalesce(nullif(p ->> 'sin_domingos', '')::boolean, true);$a$ in d) = 0
     or position('v_fecha := public._mf_fecha_cuota(v_inicio, v_frec, i - 1, v_sindom);' in d) = 0
     or position($a$if round(v_acum, 2) <> round(v_fin, 2) then raise exception$a$ in d) = 0 then
    raise exception 'mf_credito_crear: ancla no encontrada';
  end if;
  d := replace(d, $a$v_sindom boolean := coalesce(nullif(p ->> 'sin_domingos', '')::boolean, true);$a$,
                  $a$v_sindom boolean := coalesce(nullif(p ->> 'sin_domingos', '')::boolean, true);
  v_dias text := case when p ->> 'dias_cobro' in ('todos','lun_sab','lun_vie') then p ->> 'dias_cobro'
                      when coalesce(nullif(p ->> 'sin_domingos', '')::boolean, true) then 'lun_sab' else 'todos' end;$a$);
  d := replace(d, 'v_fecha := public._mf_fecha_cuota(v_inicio, v_frec, i - 1, v_sindom);',
                  'v_fecha := public._mf_fecha_cuota2(v_inicio, v_frec, i - 1, v_dias);');
  d := replace(d, $a$if round(v_acum, 2) <> round(v_fin, 2) then raise exception$a$,
                  $a$update creditos set mf_dias_cobro = v_dias where id = v_cred;
  if round(v_acum, 2) <> round(v_fin, 2) then raise exception$a$);
  execute d;
end $$;

-- Bloqueo por atraso (revisión del cliente): créditos nuevos cuentan solo días de cobro
do $$ declare d text;
begin
  d := pg_get_functiondef('public._mf_revision_cliente'::regproc);
  if position('_mf_dias_habiles' in d) > 0 then return; end if;
  if position('select coalesce(max(v_hoy - q.fecha_vencimiento), 0) into v_dias' in d) = 0 then raise exception 'revision: ancla no encontrada'; end if;
  d := replace(d, 'select coalesce(max(v_hoy - q.fecha_vencimiento), 0) into v_dias',
                  'select coalesce(max(public._mf_dias_habiles(q.fecha_vencimiento, v_hoy, c.mf_dias_cobro)), 0) into v_dias');
  execute d;
end $$;
