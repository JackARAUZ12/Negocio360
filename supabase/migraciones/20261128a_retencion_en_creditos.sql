-- Retención que el CLIENTE le hace al negocio al pagar un crédito (IR 2% / Alcaldía IMI 1%).
-- Aditiva: tablas nuevas, columnas nuevas opcionales, funciones nuevas y un trigger nuevo.
-- Lo retenido baja el saldo del crédito, NO entra a Caja y queda "a favor" en Impuestos.

-- 1) Operación de retención (una por cada vez que se aplica)
create table if not exists public.creditos_retenciones (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  credito_id uuid not null references public.creditos(id) on delete cascade,
  fecha date not null default current_date,
  base numeric not null default 0,
  pct_ir numeric not null default 0,
  monto_ir numeric not null default 0 check (monto_ir >= 0),
  pct_imi numeric not null default 0,
  monto_imi numeric not null default 0 check (monto_imi >= 0),
  monto_total numeric not null check (monto_total > 0),
  saldo_anterior numeric not null,
  saldo_nuevo numeric not null,
  estado_credito_antes text,
  aplicacion jsonb not null default '[]'::jsonb,   -- [{cuota_id, monto, impuesto, impuestos:[{nombre,id,monto}]}]
  notas text,
  usuario_nombre text,
  estado text not null default 'activa' check (estado in ('activa','anulada')),
  anulada_en timestamptz,
  anulado_motivo text,
  created_at timestamptz not null default now()
);
create index if not exists creditos_retenciones_credito_idx on public.creditos_retenciones(credito_id);
alter table public.creditos_retenciones enable row level security;
drop policy if exists creditos_retenciones_leer on public.creditos_retenciones;
create policy creditos_retenciones_leer on public.creditos_retenciones for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.creditos_retenciones from anon, authenticated;
grant select on public.creditos_retenciones to authenticated;

-- 2) Retenciones municipales (IMI) a favor — aparte del IR para no mezclarlas
create table if not exists public.retenciones_municipales (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  origen text not null default 'credito' check (origen in ('credito','manual')),
  credito_id uuid references public.creditos(id) on delete set null,
  venta_id uuid,
  operacion_id uuid references public.creditos_retenciones(id) on delete set null,
  contraparte_nombre text,
  fecha date not null default current_date,
  base numeric not null default 0,
  porcentaje numeric not null default 0,
  monto numeric not null check (monto >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','acreditada','anulada')),
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists retenciones_municipales_user_idx on public.retenciones_municipales(auth_user_id, estado);
alter table public.retenciones_municipales enable row level security;
drop policy if exists retenciones_municipales_leer on public.retenciones_municipales;
create policy retenciones_municipales_leer on public.retenciones_municipales for select to authenticated using (auth_user_id = auth.uid());
-- Solo se puede marcar como acreditada desde la app (estado), el resto lo hacen las funciones.
drop policy if exists retenciones_municipales_acreditar on public.retenciones_municipales;
create policy retenciones_municipales_acreditar on public.retenciones_municipales for update to authenticated
  using (auth_user_id = auth.uid() and estado = 'pendiente') with check (auth_user_id = auth.uid() and estado in ('pendiente','acreditada'));
revoke insert, delete on public.retenciones_municipales from anon, authenticated;
revoke update on public.retenciones_municipales from anon, authenticated;
grant select on public.retenciones_municipales to authenticated;
grant update (estado) on public.retenciones_municipales to authenticated;

-- 3) retenciones_ir: enlace opcional al crédito y a la operación; nuevo origen 'credito'
alter table public.retenciones_ir add column if not exists credito_id uuid references public.creditos(id) on delete set null;
alter table public.retenciones_ir add column if not exists operacion_id uuid references public.creditos_retenciones(id) on delete set null;
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.retenciones_ir'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%origen%';
  if c is not null then execute format('alter table public.retenciones_ir drop constraint %I', c); end if;
  alter table public.retenciones_ir add constraint retenciones_ir_origen_check
    check (origen = any (array['venta','compra','cxp_pago','gasto','manual','credito']));
end $$;

-- 4) Aplicar retención a un crédito (todo o nada)
create or replace function public.credito_aplicar_retencion(
  p_credito_id uuid, p_base numeric, p_pct_ir numeric, p_monto_ir numeric, p_pct_imi numeric, p_monto_imi numeric,
  p_fecha date default current_date, p_notas text default null, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); k record; q record; d jsonb;
  v_ir numeric := round(coalesce(p_monto_ir, 0), 2); v_imi numeric := round(coalesce(p_monto_imi, 0), 2);
  v_total numeric; v_rest numeric; v_debe numeric; v_apl numeric; v_nuevo numeric; v_imp_pend numeric; v_imp numeric;
  v_parte numeric; v_imps jsonb; v_aplic jsonb := '[]'::jsonb; v_saldo_nuevo numeric; v_estado text; v_op uuid; v_cli text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if v_ir < 0 or v_imi < 0 then raise exception 'Los montos retenidos no pueden ser negativos'; end if;
  v_total := round(v_ir + v_imi, 2);
  if v_total <= 0 then raise exception 'Escribe cuánto te retuvo el cliente'; end if;

  select * into k from creditos where id = p_credito_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Crédito no encontrado'; end if;
  if k.estado = 'cancelado' or coalesce(k.saldo_pendiente, 0) <= 0.01 then raise exception 'Este crédito ya no tiene saldo pendiente'; end if;
  if v_total > round(k.saldo_pendiente, 2) + 0.01 then
    raise exception 'Lo retenido (%) es más que el saldo pendiente (%)', v_total, round(k.saldo_pendiente, 2);
  end if;

  -- Cuotas en orden (igual que un abono), con su parte de impuesto (IVA) acreditada en proporción
  v_rest := v_total;
  for q in select * from creditos_cuotas where credito_id = k.id and estado <> 'pagada' order by numero for update loop
    exit when v_rest <= 0;
    v_debe := round(q.monto_total - q.monto_pagado, 2);
    continue when v_debe <= 0;
    v_apl := least(v_rest, v_debe);
    v_nuevo := round(q.monto_pagado + v_apl, 2);
    v_imp_pend := round(coalesce(q.impuesto, 0) - coalesce(q.impuesto_acreditado, 0), 2);
    v_imp := case when v_imp_pend > 0 then round(v_imp_pend * (v_apl / v_debe), 2) else 0 end;
    v_imps := '[]'::jsonb;
    if v_imp > 0 and jsonb_typeof(q.impuestos_detalle) = 'array' and jsonb_array_length(q.impuestos_detalle) > 0 and coalesce(q.impuesto, 0) > 0 then
      for d in select * from jsonb_array_elements(q.impuestos_detalle) loop
        v_parte := round(v_imp * (coalesce((d->>'monto')::numeric, 0) / q.impuesto), 2);
        if v_parte > 0 then
          insert into movimientos_impuestos (auth_user_id, tipo_movimiento, concepto, monto, impuesto_id, impuesto_nombre, referencia_venta_id, fecha)
          values (v_uid, 'IVA_VENTA', coalesce(d->>'nombre', 'Impuesto') || ' cobrado en cuota de crédito ' || k.numero_credito || ' (con retención)',
                  v_parte, nullif(d->>'impuesto_id', '')::uuid, d->>'nombre', k.venta_id, coalesce(p_fecha, current_date));
          v_imps := v_imps || jsonb_build_array(jsonb_build_object('nombre', d->>'nombre', 'id', d->>'impuesto_id', 'monto', v_parte));
        end if;
      end loop;
    end if;
    update creditos_cuotas set monto_pagado = v_nuevo,
           estado = case when v_nuevo >= q.monto_total - 0.01 then 'pagada' else 'parcial' end,
           impuesto_acreditado = round(coalesce(impuesto_acreditado, 0) + v_imp, 2), updated_at = now()
     where id = q.id;
    v_aplic := v_aplic || jsonb_build_array(jsonb_build_object('cuota_id', q.id, 'monto', v_apl, 'impuesto', v_imp, 'impuestos', v_imps,
                                                                'estado_antes', q.estado));
    v_rest := round(v_rest - v_apl, 2);
  end loop;

  v_saldo_nuevo := round(greatest(0, k.saldo_pendiente - v_total), 2);
  v_estado := case when v_saldo_nuevo <= 0.01 then 'cancelado' when k.estado = 'en_proceso' then 'activo' else k.estado end;
  update creditos set saldo_pendiente = v_saldo_nuevo, estado = v_estado, updated_at = now() where id = k.id;

  select nullif(trim(coalesce(c.nombre, '') || ' ' || coalesce(c.apellido, '')), '') into v_cli from clientes c where c.id = k.cliente_id;

  insert into creditos_retenciones (auth_user_id, credito_id, fecha, base, pct_ir, monto_ir, pct_imi, monto_imi, monto_total,
                                    saldo_anterior, saldo_nuevo, estado_credito_antes, aplicacion, notas, usuario_nombre)
  values (v_uid, k.id, coalesce(p_fecha, current_date), round(coalesce(p_base, 0), 2), coalesce(p_pct_ir, 0), v_ir, coalesce(p_pct_imi, 0), v_imi, v_total,
          round(k.saldo_pendiente, 2), v_saldo_nuevo, k.estado, v_aplic, nullif(trim(p_notas), ''), nullif(trim(p_usuario), ''))
  returning id into v_op;

  if v_ir > 0 then
    insert into retenciones_ir (auth_user_id, lado, origen, venta_id, credito_id, operacion_id, contraparte_nombre, fecha, base, porcentaje, monto, estado, notas)
    values (v_uid, 'a_favor', 'credito', k.venta_id, k.id, v_op, coalesce(v_cli, 'Cliente'), coalesce(p_fecha, current_date),
            round(coalesce(p_base, 0), 2), coalesce(p_pct_ir, 0), v_ir, 'pendiente', 'Crédito ' || k.numero_credito);
  end if;
  if v_imi > 0 then
    insert into retenciones_municipales (auth_user_id, origen, credito_id, venta_id, operacion_id, contraparte_nombre, fecha, base, porcentaje, monto, notas)
    values (v_uid, 'credito', k.id, k.venta_id, v_op, coalesce(v_cli, 'Cliente'), coalesce(p_fecha, current_date),
            round(coalesce(p_base, 0), 2), coalesce(p_pct_imi, 0), v_imi, 'Crédito ' || k.numero_credito);
  end if;

  insert into creditos_historial (auth_user_id, credito_id, tipo_evento, descripcion, data)
  values (v_uid, k.id, 'retencion', 'El cliente retuvo ' || to_char(v_total, 'FM999,999,990.00')
          || case when v_ir > 0 and v_imi > 0 then ' (IR ' || to_char(v_ir, 'FM999,999,990.00') || ' + Alcaldía ' || to_char(v_imi, 'FM999,999,990.00') || ')'
                  when v_imi > 0 then ' (Alcaldía)' else ' (IR)' end || ' — no entra a Caja',
          jsonb_build_object('operacion_id', v_op, 'monto', v_total, 'saldoNuevo', v_saldo_nuevo));
  if v_estado = 'cancelado' then
    insert into creditos_historial (auth_user_id, credito_id, tipo_evento, descripcion, data)
    values (v_uid, k.id, 'cancelado', 'Crédito cancelado — saldo en cero', '{}'::jsonb);
  end if;

  return jsonb_build_object('ok', true, 'operacion_id', v_op, 'monto_total', v_total, 'saldo_anterior', round(k.saldo_pendiente, 2),
                            'saldo_nuevo', v_saldo_nuevo, 'estado', v_estado);
end $$;

-- 5) Anular una retención (devuelve el saldo; solo si no se acreditó todavía)
create or replace function public.credito_anular_retencion(p_operacion_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); o record; k record; a jsonb; i jsonb; q record; v_nuevo numeric; v_saldo numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  select * into o from creditos_retenciones where id = p_operacion_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Retención no encontrada'; end if;
  if o.estado = 'anulada' then return jsonb_build_object('ok', true, 'ya_anulada', true); end if;
  if exists (select 1 from retenciones_ir where operacion_id = o.id and estado in ('acreditada','pagada'))
     or exists (select 1 from retenciones_municipales where operacion_id = o.id and estado = 'acreditada') then
    raise exception 'Esta retención ya se marcó como acreditada en Impuestos; no se puede anular.';
  end if;
  select * into k from creditos where id = o.credito_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Crédito no encontrado'; end if;

  for a in select * from jsonb_array_elements(o.aplicacion) loop
    select * into q from creditos_cuotas where id = (a->>'cuota_id')::uuid and credito_id = k.id for update;
    continue when not found;
    v_nuevo := round(greatest(0, q.monto_pagado - (a->>'monto')::numeric), 2);
    update creditos_cuotas set monto_pagado = v_nuevo,
           estado = case when v_nuevo <= 0.01 then 'pendiente' when v_nuevo >= q.monto_total - 0.01 then 'pagada' else 'parcial' end,
           impuesto_acreditado = round(greatest(0, coalesce(impuesto_acreditado, 0) - coalesce((a->>'impuesto')::numeric, 0)), 2),
           updated_at = now()
     where id = q.id;
    for i in select * from jsonb_array_elements(coalesce(a->'impuestos', '[]'::jsonb)) loop
      insert into movimientos_impuestos (auth_user_id, tipo_movimiento, concepto, monto, impuesto_id, impuesto_nombre, referencia_venta_id, fecha)
      values (v_uid, 'IVA_VENTA', 'Reverso: ' || coalesce(i->>'nombre', 'Impuesto') || ' de retención anulada en crédito ' || k.numero_credito,
              -((i->>'monto')::numeric), nullif(i->>'id', '')::uuid, i->>'nombre', k.venta_id, current_date);
    end loop;
  end loop;

  v_saldo := round(least(coalesce(nullif(k.total_financiado, 0), k.capital_financiado, 0), coalesce(k.saldo_pendiente, 0) + o.monto_total), 2);
  update creditos set saldo_pendiente = v_saldo,
         estado = case when v_saldo > 0.01 and k.estado = 'cancelado'
                       then case when o.estado_credito_antes in ('activo','al_dia','con_atraso','en_proceso') then o.estado_credito_antes else 'activo' end
                       else k.estado end, updated_at = now()
   where id = k.id;

  update creditos_retenciones set estado = 'anulada', anulada_en = now(), anulado_motivo = nullif(trim(p_motivo), '') where id = o.id;
  update retenciones_ir set estado = 'anulada' where operacion_id = o.id and estado = 'pendiente';
  update retenciones_municipales set estado = 'anulada' where operacion_id = o.id and estado = 'pendiente';
  insert into creditos_historial (auth_user_id, credito_id, tipo_evento, descripcion, data)
  values (v_uid, k.id, 'retencion_anulada', 'Se anuló una retención de ' || to_char(o.monto_total, 'FM999,999,990.00') || coalesce(' — ' || nullif(trim(p_motivo), ''), ''),
          jsonb_build_object('operacion_id', o.id));
  return jsonb_build_object('ok', true, 'saldo_nuevo', v_saldo);
end $$;

revoke all on function public.credito_aplicar_retencion(uuid, numeric, numeric, numeric, numeric, numeric, date, text, text) from public, anon;
revoke all on function public.credito_anular_retencion(uuid, text) from public, anon;
grant execute on function public.credito_aplicar_retencion(uuid, numeric, numeric, numeric, numeric, numeric, date, text, text) to authenticated;
grant execute on function public.credito_anular_retencion(uuid, text) to authenticated;

-- 6) Candado: una venta a crédito con retención activa no se anula (primero se anula la retención)
create or replace function public.ventas_no_anular_credito_con_retencion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_cred text;
begin
  select k.numero_credito into v_cred from creditos k join creditos_retenciones r on r.credito_id = k.id and r.estado = 'activa'
   where k.venta_id = new.id limit 1;
  if v_cred is not null then
    raise exception 'Esta venta a crédito tiene una retención del cliente registrada en el crédito %. Primero anula esa retención en Créditos y después anula la venta.', v_cred using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_ventas_no_anular_credito_con_retencion on public.ventas;
create trigger trg_ventas_no_anular_credito_con_retencion before update of estado on public.ventas
  for each row when (new.estado = 'anulada' and old.estado is distinct from 'anulada')
  execute function public.ventas_no_anular_credito_con_retencion();
