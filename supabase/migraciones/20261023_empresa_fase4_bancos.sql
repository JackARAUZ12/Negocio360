-- =====================================================================
-- EMPRESA VINCULADA · FASE 4: BANCOS COMPARTIDOS · Fecha: 23-oct-2026
-- Solo AGREGA. No cambia ningún movimiento, saldo ni banco existente.
--
-- Cada banco real (mismo número de cuenta y moneda) existe hoy dos veces:
-- una en cada negocio. Cada negocio sigue con SU banco y SUS movimientos
-- (su contabilidad no cambia). Encima se crea el "banco de la empresa",
-- que junta las dos partes:
--   * saldo real del banco = parte de Comercial + parte de Mayorista;
--   * ver los movimientos de los dos (cada uno con su negocio);
--   * conciliar contra el estado de cuenta UNA sola vez para el banco
--     completo (se marcan los movimientos de los dos negocios en una
--     sola operación, y cada negocio guarda su parte en su historial).
-- =====================================================================

create table if not exists public.empresa_bancos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas_vinculadas(id),
  nombre text not null,
  numero_cuenta text not null,
  moneda text not null default 'NIO',
  created_at timestamptz not null default now(),
  unique (empresa_id, numero_cuenta, moneda)
);
create table if not exists public.empresa_bancos_cuentas (
  id uuid primary key default gen_random_uuid(),
  empresa_banco_id uuid not null references public.empresa_bancos(id),
  banco_id uuid not null unique,              -- banco de cada negocio (sin llave foránea: si un negocio quita su banco, aquí no estorba)
  auth_user_id uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.empresa_conciliaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_banco_id uuid not null references public.empresa_bancos(id),
  periodo_desde date, periodo_hasta date,
  saldo_banco_declarado numeric not null,
  saldo_sistema_calculado numeric not null,
  partes jsonb not null default '[]'::jsonb,
  creado_por uuid,
  created_at timestamptz not null default now()
);
-- Enlace opcional de la conciliación de cada negocio con la de la empresa
alter table public.conciliaciones_bancarias add column if not exists empresa_conciliacion_id uuid references public.empresa_conciliaciones(id);

alter table public.empresa_bancos enable row level security;
alter table public.empresa_bancos_cuentas enable row level security;
alter table public.empresa_conciliaciones enable row level security;
create policy empresa_bancos_ver on public.empresa_bancos for select to authenticated
  using (empresa_id = public.empresa_id_de_mi_negocio());
create policy empresa_bancos_cuentas_ver on public.empresa_bancos_cuentas for select to authenticated
  using (exists (select 1 from public.empresa_bancos e where e.id = empresa_banco_id and e.empresa_id = public.empresa_id_de_mi_negocio()));
create policy empresa_conciliaciones_ver on public.empresa_conciliaciones for select to authenticated
  using (exists (select 1 from public.empresa_bancos e where e.id = empresa_banco_id and e.empresa_id = public.empresa_id_de_mi_negocio()));
-- (sin políticas de escritura: con RLS activo nadie escribe desde la página; solo las funciones de abajo)

-- Saldo de UN banco (misma fórmula que bancos_saldos / la tarjeta del banco), con la
-- moneda base y la tasa del negocio dueño del banco. Uso interno.
create or replace function public._banco_saldo_detalle(p_banco_id uuid)
returns table(saldo numeric, saldo_conciliado numeric, pendientes integer)
language plpgsql stable security definer set search_path = public as $$
declare b record; v_base text; v_tasa numeric;
begin
  select * into b from bancos where id = p_banco_id;
  if not found then return; end if;
  select case when c.moneda = 'USD' then 'USD' else 'NIO' end, coalesce(c.tasa_cambio_usd, 0)
    into v_base, v_tasa from configuracion_empresa c where c.auth_user_id = b.auth_user_id limit 1;
  v_base := coalesce(v_base, 'NIO'); v_tasa := coalesce(v_tasa, 0);
  return query
  select
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
  from movimientos_financieros m
  where m.banco_id = b.id and m.auth_user_id = b.auth_user_id and m.estado = 'completado';
end $$;
revoke all on function public._banco_saldo_detalle(uuid) from public, anon, authenticated;

-- Une los bancos que tienen el mismo número de cuenta y moneda en los negocios de la empresa.
-- Repetible: lo ya unido no se toca. No cambia ningún banco ni movimiento.
create or replace function public.empresa_bancos_vincular_auto()
returns integer language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.empresa_id_de_mi_negocio(); g record; v_eb uuid; n integer := 0;
begin
  if auth.uid() is null or v_emp is null then raise exception 'Tu negocio no es parte de una empresa'; end if;
  for g in
    select regexp_replace(b.numero_cuenta, '\D', '', 'g') num, b.moneda, min(b.nombre) nombre,
           array_agg(b.id) bancos, count(*) cuantos, count(distinct b.auth_user_id) negocios
      from bancos b join empresa_miembros em on em.auth_user_id = b.auth_user_id and em.empresa_id = v_emp and em.activo
     where b.activo and length(regexp_replace(coalesce(b.numero_cuenta, ''), '\D', '', 'g')) >= 5
     group by 1, 2
    having count(*) >= 2 and count(*) = count(distinct b.auth_user_id)   -- uno por negocio, sin repetidos
  loop
    insert into empresa_bancos (empresa_id, nombre, numero_cuenta, moneda) values (v_emp, g.nombre, g.num, g.moneda)
      on conflict (empresa_id, numero_cuenta, moneda) do nothing;
    select id into v_eb from empresa_bancos where empresa_id = v_emp and numero_cuenta = g.num and moneda = g.moneda;
    insert into empresa_bancos_cuentas (empresa_banco_id, banco_id, auth_user_id)
      select v_eb, b.id, b.auth_user_id from bancos b where b.id = any(g.bancos)
      on conflict (banco_id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.empresa_bancos_vincular_auto() from public, anon;
grant execute on function public.empresa_bancos_vincular_auto() to authenticated;

-- Bancos de la empresa con el saldo total y la parte de cada negocio (solo lectura).
create or replace function public.empresa_bancos_resumen()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.empresa_id_de_mi_negocio(); r jsonb;
begin
  if auth.uid() is null or v_emp is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(x order by x->>'nombre', x->>'moneda'), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', eb.id, 'nombre', eb.nombre, 'numero_cuenta', eb.numero_cuenta, 'moneda', eb.moneda,
      'saldo', round(sum(d.saldo), 2), 'saldo_conciliado', round(sum(d.saldo_conciliado), 2), 'pendientes', sum(d.pendientes),
      'partes', jsonb_agg(jsonb_build_object('auth_user_id', c.auth_user_id, 'negocio', coalesce(em.nombre_negocio, ''), 'banco_id', c.banco_id,
                          'saldo', d.saldo, 'saldo_conciliado', d.saldo_conciliado, 'pendientes', d.pendientes) order by em.orden)) x
      from empresa_bancos eb
      join empresa_bancos_cuentas c on c.empresa_banco_id = eb.id
      left join empresa_miembros em on em.auth_user_id = c.auth_user_id and em.empresa_id = eb.empresa_id
      cross join lateral public._banco_saldo_detalle(c.banco_id) d
     where eb.empresa_id = v_emp
     group by eb.id) t;
  return r;
end $$;
revoke all on function public.empresa_bancos_resumen() from public, anon;
grant execute on function public.empresa_bancos_resumen() to authenticated;

-- Movimientos de un banco de la empresa (de los dos negocios). p_pendientes = solo los que faltan por conciliar.
create or replace function public.empresa_banco_movimientos(p_empresa_banco_id uuid, p_pendientes boolean default false)
returns table(id uuid, auth_user_id uuid, negocio text, banco_id uuid, fecha date, concepto text, tipo_flujo text, monto numeric, monto_banco numeric, conciliado boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.empresa_id_de_mi_negocio();
begin
  if auth.uid() is null or v_emp is null then raise exception 'Tu negocio no es parte de una empresa'; end if;
  if not exists (select 1 from empresa_bancos e where e.id = p_empresa_banco_id and e.empresa_id = v_emp) then raise exception 'Banco de la empresa no encontrado'; end if;
  return query
  select m.id, m.auth_user_id, coalesce(em.nombre_negocio, ''), m.banco_id, m.fecha, m.concepto, m.tipo_flujo, m.monto,
         public._monto_en_moneda_banco(m.monto, m.monto_moneda_banco, b.moneda,
           coalesce((select case when ce.moneda = 'USD' then 'USD' else 'NIO' end from configuracion_empresa ce where ce.auth_user_id = b.auth_user_id limit 1), 'NIO'),
           coalesce((select ce.tasa_cambio_usd from configuracion_empresa ce where ce.auth_user_id = b.auth_user_id limit 1), 0)),
         coalesce(m.conciliado, false)
    from empresa_bancos_cuentas c
    join bancos b on b.id = c.banco_id
    join movimientos_financieros m on m.banco_id = b.id and m.auth_user_id = b.auth_user_id and m.estado = 'completado'
    left join empresa_miembros em on em.auth_user_id = c.auth_user_id and em.empresa_id = v_emp
   where c.empresa_banco_id = p_empresa_banco_id
     and (not p_pendientes or not coalesce(m.conciliado, false))
   order by m.fecha, m.created_at, m.id;
end $$;
revoke all on function public.empresa_banco_movimientos(uuid, boolean) from public, anon;
grant execute on function public.empresa_banco_movimientos(uuid, boolean) to authenticated;

-- Conciliar el banco COMPLETO (los dos negocios) en UNA operación.
create or replace function public.empresa_conciliacion_cerrar(p_empresa_banco_id uuid, p_ids uuid[], p_saldo_banco numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.empresa_id_de_mi_negocio(); eb record; c record; d record;
  v_pedidos integer; v_n integer := 0; v_previo numeric := 0; v_marcado numeric := 0; v_calc numeric; v_dif numeric;
  v_desde date; v_hasta date; v_ec uuid; v_cb uuid; v_partes jsonb := '[]'::jsonb;
  p_n integer; p_marc numeric; p_desde date; p_hasta date;
begin
  if auth.uid() is null or v_emp is null then raise exception 'Tu negocio no es parte de una empresa'; end if;
  if p_saldo_banco is null then raise exception 'Escribe el saldo que dice tu banco.'; end if;
  select * into eb from empresa_bancos where id = p_empresa_banco_id and empresa_id = v_emp for update;
  if not found then raise exception 'Banco de la empresa no encontrado'; end if;
  -- Bloquea los bancos de cada negocio (así no choca con una conciliación individual al mismo tiempo)
  perform 1 from bancos b join empresa_bancos_cuentas x on x.banco_id = b.id where x.empresa_banco_id = eb.id for update of b;
  select coalesce(array_length(array(select distinct y from unnest(coalesce(p_ids, '{}'::uuid[])) y), 1), 0) into v_pedidos;
  if v_pedidos = 0 then raise exception 'Marca al menos un movimiento, o agrega un ajuste.'; end if;

  -- Lo que se marca debe estar pendiente y ser de algún banco de este banco de la empresa
  select count(*) into v_n
    from movimientos_financieros m join empresa_bancos_cuentas x on x.banco_id = m.banco_id and x.auth_user_id = m.auth_user_id
   where x.empresa_banco_id = eb.id and m.id = any(p_ids) and m.estado = 'completado' and not coalesce(m.conciliado, false);
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
     where m.banco_id = c.banco_id and m.auth_user_id = c.auth_user_id and m.id = any(p_ids) and m.estado = 'completado' and not coalesce(m.conciliado, false);
    v_previo := v_previo + coalesce(d.saldo_conciliado, 0);
    v_marcado := v_marcado + p_marc;
    v_desde := least(v_desde, p_desde); v_hasta := greatest(v_hasta, p_hasta);
    v_partes := v_partes || jsonb_build_object('auth_user_id', c.auth_user_id, 'negocio', c.negocio, 'banco_id', c.banco_id, 'movimientos', p_n,
                                               'saldo_conciliado', round(coalesce(d.saldo_conciliado, 0) + p_marc, 2));
  end loop;

  v_calc := round(v_previo + v_marcado, 2);
  v_dif := round(p_saldo_banco - v_calc, 2);
  if abs(v_dif) >= 0.005 then
    raise exception 'Todavía no cuadra: hay una diferencia de %.', to_char(abs(v_dif), 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;

  v_desde := coalesce(v_desde, (now() at time zone 'America/Managua')::date);
  v_hasta := coalesce(v_hasta, (now() at time zone 'America/Managua')::date);
  insert into empresa_conciliaciones (empresa_banco_id, periodo_desde, periodo_hasta, saldo_banco_declarado, saldo_sistema_calculado, partes, creado_por)
  values (eb.id, v_desde, v_hasta, round(p_saldo_banco, 2), v_calc, v_partes, auth.uid())
  returning id into v_ec;

  -- Cada negocio guarda SU parte en su propio historial y sus movimientos quedan marcados
  for c in select (e->>'auth_user_id')::uuid uid, (e->>'banco_id')::uuid banco_id, (e->>'saldo_conciliado')::numeric parte, (e->>'movimientos')::integer n
             from jsonb_array_elements(v_partes) e loop
    if c.n > 0 then
      insert into conciliaciones_bancarias (auth_user_id, banco_id, periodo_desde, periodo_hasta, saldo_banco_declarado, saldo_sistema_calculado, diferencia, empresa_conciliacion_id)
      values (c.uid, c.banco_id, v_desde, v_hasta, c.parte, c.parte, 0, v_ec)
      returning id into v_cb;
      update movimientos_financieros set conciliado = true, conciliacion_id = v_cb
       where banco_id = c.banco_id and auth_user_id = c.uid and id = any(p_ids) and estado = 'completado' and not coalesce(conciliado, false);
    end if;
  end loop;

  return jsonb_build_object('empresa_conciliacion_id', v_ec, 'movimientos', v_n, 'saldo_conciliado', v_calc, 'partes', v_partes);
end $$;
revoke all on function public.empresa_conciliacion_cerrar(uuid, uuid[], numeric) from public, anon;
grant execute on function public.empresa_conciliacion_cerrar(uuid, uuid[], numeric) to authenticated;
