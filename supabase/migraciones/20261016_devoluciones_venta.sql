-- ============================================================
-- DEVOLUCIONES DE VENTA (DEV-000001…)
--
-- Una devolución es distinta de anular: la venta SÍ ocurrió y queda
-- intacta en su fecha; la devolución es un documento NUEVO, con su
-- propia fecha, que revierte solo lo devuelto (total o parcial):
--   - Inventario: vuelve el stock de lo que regresa en buen estado
--     (combos: sus componentes; lotes: a su lote). Lo dañado no vuelve.
--   - Dinero:
--       contado -> egreso de Caja/banco (neto del IVA, igual que entró)
--                  + reverso del IVA en Impuestos
--       crédito -> se rebaja lo que el cliente debe (cuotas desde la
--                  última); si ya pagó de más, la diferencia sale de Caja
--       fiado   -> se rebaja el fiado; si ya pagó de más, sale de Caja
--   - Cliente: baja su total comprado. Puntos: se descuentan en proporción.
--   - Contabilidad: su asiento lo genera Contabilidad (referencia
--     'devolucion_venta'), como el resto de documentos.
--
-- TODO ocurre en UNA sola transacción (función registrar_devolucion_venta):
-- o se registra completo, o no se registra nada. Así siempre cuadra.
--
-- Candados:
--   - Nadie puede escribir estas tablas directamente: solo la función.
--   - No se devuelve más de lo vendido (contando devoluciones anteriores),
--     ni de ventas anuladas, ni dos veces en paralelo (bloqueo de la venta).
--   - Una venta con devoluciones ya no se puede anular ni cambiar sus
--     montos, cliente o productos (eso descuadraría lo ya devuelto).
-- Todo es aditivo: no se modifica ninguna tabla ni dato existente.
-- ============================================================

create table if not exists public.devoluciones_venta (
  id                       uuid primary key default gen_random_uuid(),
  auth_user_id             uuid not null references auth.users(id) on delete cascade,
  numero                   text not null,
  venta_id                 uuid not null references public.ventas(id) on delete restrict,
  fecha                    date not null default current_date,
  motivo                   text not null,
  tipo_venta               text not null check (tipo_venta in ('contado','credito','fiado')),
  total                    numeric not null check (total >= 0),       -- valor devuelto (con IVA, como lo pagó el cliente)
  impuesto                 numeric not null default 0,                -- IVA/impuestos dentro de ese valor
  neto                     numeric not null default 0,                -- total - impuesto
  costo_reingresado        numeric not null default 0,                -- costo de lo que volvió al inventario
  costo_no_reingresado     numeric not null default 0,                -- costo de lo dañado (no vuelve)
  monto_credito            numeric not null default 0,                -- rebajado de la deuda (crédito o fiado)
  deuda_condonada          numeric not null default 0,                -- devolución TOTAL de un crédito: intereses que ya no se cobran
  monto_dinero             numeric not null default 0,                -- devuelto en dinero al cliente
  monto_caja               numeric not null default 0,                -- egreso registrado en Caja
  impuesto_revertido       numeric not null default 0,                -- reverso registrado en Impuestos
  credito_id               uuid,
  fiado_id                 uuid,
  metodo_pago_id           uuid,
  metodo_pago_nombre       text,
  banco_id                 uuid,
  monto_moneda_banco       numeric,
  movimiento_financiero_id uuid,
  usuario_nombre           text,
  estado                   text not null default 'registrada' check (estado in ('registrada')),
  created_at               timestamptz not null default now(),
  constraint devoluciones_venta_numero_unico unique (auth_user_id, numero),
  constraint devoluciones_venta_cuadre check (abs(monto_credito + monto_dinero - total) < 0.005)
);
create index if not exists idx_devoluciones_venta_venta on public.devoluciones_venta(venta_id);
create index if not exists idx_devoluciones_venta_user_fecha on public.devoluciones_venta(auth_user_id, fecha);

create table if not exists public.devolucion_venta_detalles (
  id                   uuid primary key default gen_random_uuid(),
  auth_user_id         uuid not null references auth.users(id) on delete cascade,
  devolucion_id        uuid not null references public.devoluciones_venta(id) on delete restrict,
  venta_detalle_id     uuid not null references public.venta_detalles(id) on delete restrict,
  producto_id          uuid,
  combo_id             uuid,
  promocion_id         uuid,
  lote_id              uuid,
  producto_nombre      text,
  tipo_item            text,
  cantidad             numeric not null check (cantidad > 0),   -- en la misma unidad en que se vendió la línea
  unidades_inventario  numeric not null default 0,             -- unidades de inventario (cantidad × presentación)
  monto                numeric not null default 0,             -- parte del valor devuelto
  costo_unitario       numeric not null default 0,
  costo_total          numeric not null default 0,
  reingresa            boolean not null default true,          -- false = dañado / no vuelve al inventario
  created_at           timestamptz not null default now()
);
create index if not exists idx_dev_venta_det_dev on public.devolucion_venta_detalles(devolucion_id);
create index if not exists idx_dev_venta_det_vd  on public.devolucion_venta_detalles(venta_detalle_id);

-- Solo lectura para el dueño; escribir, únicamente con la función de abajo.
alter table public.devoluciones_venta        enable row level security;
alter table public.devolucion_venta_detalles enable row level security;
create policy devoluciones_venta_select on public.devoluciones_venta for select using (auth.uid() = auth_user_id);
create policy devolucion_venta_detalles_select on public.devolucion_venta_detalles for select using (auth.uid() = auth_user_id);

create table if not exists public.devoluciones_venta_numeracion (
  auth_user_id  uuid primary key references auth.users(id) on delete cascade,
  ultimo_numero integer not null default 0
);
alter table public.devoluciones_venta_numeracion enable row level security;

-- ------------------------------------------------------------
-- Candados sobre ventas que ya tienen devoluciones
-- ------------------------------------------------------------
create or replace function public.ventas_candado_devoluciones()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r numeric;
begin
  if not exists (select 1 from devoluciones_venta where venta_id = old.id) then return new; end if;
  -- "Convertir moneda" del negocio (llamada real a convertir_moneda_negocio): se permite y
  -- sus devoluciones se convierten con el mismo factor, para que sigan cuadrando.
  if current_query() ~* 'convertir_moneda_negocio"?\s*\(' then
    if coalesce(old.total, 0) <> 0 and new.total is distinct from old.total then
      r := new.total / old.total;
      update devoluciones_venta set
        total = round(total * r, 2), impuesto = round(impuesto * r, 2), neto = round(total * r, 2) - round(impuesto * r, 2),
        costo_reingresado = round(costo_reingresado * r, 2), costo_no_reingresado = round(costo_no_reingresado * r, 2),
        monto_credito = round(monto_credito * r, 2), monto_dinero = round(total * r, 2) - round(monto_credito * r, 2), deuda_condonada = round(deuda_condonada * r, 2),
        monto_caja = round(monto_caja * r, 2), impuesto_revertido = round(impuesto_revertido * r, 2)
       where venta_id = old.id;
      update devolucion_venta_detalles d set monto = round(d.monto * r, 2), costo_unitario = round(d.costo_unitario * r, 4), costo_total = round(d.costo_total * r, 2)
        from devoluciones_venta x where x.id = d.devolucion_id and x.venta_id = old.id;
    end if;
    return new;
  end if;
  if new.estado is distinct from old.estado and new.estado = 'anulada' then
    raise exception 'Esta venta tiene devoluciones registradas: ya no se puede anular. Si hace falta devolver más, usa "Devolución".' using errcode = 'P0001';
  end if;
  if new.total is distinct from old.total or new.subtotal is distinct from old.subtotal
     or new.impuesto is distinct from old.impuesto or new.costo_total is distinct from old.costo_total
     or new.cliente_id is distinct from old.cliente_id or new.metodo_pago is distinct from old.metodo_pago then
    raise exception 'Esta venta tiene devoluciones registradas: ya no se pueden cambiar sus montos, su cliente ni su forma de pago.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.ventas_candado_devoluciones() from public, anon, authenticated;
create trigger trg_ventas_candado_devoluciones
  before update on public.ventas
  for each row execute function public.ventas_candado_devoluciones();

create or replace function public.venta_detalles_candado_devoluciones()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_venta uuid := coalesce(old.venta_id, new.venta_id);
begin
  if current_query() ~* 'convertir_moneda_negocio"?\s*\(' then return coalesce(new, old); end if;
  if exists (select 1 from devoluciones_venta where venta_id = v_venta) then
    if tg_op = 'DELETE' or new.cantidad is distinct from old.cantidad or new.subtotal is distinct from old.subtotal
       or new.costo is distinct from old.costo or new.precio is distinct from old.precio or new.venta_id is distinct from old.venta_id then
      raise exception 'Esta venta tiene devoluciones registradas: ya no se pueden cambiar sus productos.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.venta_detalles_candado_devoluciones() from public, anon, authenticated;
create trigger trg_venta_detalles_candado_devoluciones
  before update or delete on public.venta_detalles
  for each row execute function public.venta_detalles_candado_devoluciones();

create or replace function public.venta_detalles_candado_insert_devoluciones()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from devoluciones_venta where venta_id = new.venta_id) then
    raise exception 'Esta venta tiene devoluciones registradas: ya no se le pueden agregar productos.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.venta_detalles_candado_insert_devoluciones() from public, anon, authenticated;
create trigger trg_venta_detalles_candado_insert_devoluciones
  before insert on public.venta_detalles
  for each row execute function public.venta_detalles_candado_insert_devoluciones();

-- ------------------------------------------------------------
-- La función: registra la devolución completa en una transacción
--   p = { venta_id, motivo, fecha?, usuario_nombre?,
--         lineas: [{ venta_detalle_id, cantidad, reingresa }],
--         metodo_pago_id?, metodo_pago_nombre?, banco_id?, monto_moneda_banco?,
--         simular? (true = calcula y devuelve el resultado SIN guardar nada) }
-- ------------------------------------------------------------
create or replace function public.registrar_devolucion_venta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v ventas%rowtype;
  v_motivo text := btrim(coalesce(p->>'motivo', ''));
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, current_date);
  v_simular boolean := coalesce((p->>'simular')::boolean, false);
  v_lineas jsonb := coalesce(p->'lineas', '[]'::jsonb);
  v_metodo_id uuid := nullif(p->>'metodo_pago_id', '')::uuid;
  v_metodo_nombre text := nullif(btrim(coalesce(p->>'metodo_pago_nombre', '')), '');
  v_banco_id uuid := nullif(p->>'banco_id', '')::uuid;
  v_monto_banco numeric := nullif(p->>'monto_moneda_banco', '')::numeric;
  v_usuario text := nullif(btrim(coalesce(p->>'usuario_nombre', '')), '');
  el jsonb; vd venta_detalles%rowtype;
  v_q numeric; v_ya numeric; v_reing boolean; v_unid numeric; v_monto numeric; v_costo numeric;
  v_sum_sub numeric; v_n_det int;
  v_prev_total numeric; v_prev_imp numeric; v_completa boolean;
  v_total numeric := 0; v_imp numeric := 0; v_neto numeric;
  v_costo_re numeric := 0; v_costo_no numeric := 0;
  v_tipo text; c creditos%rowtype; f fiados%rowtype;
  v_cred numeric := 0; v_cond numeric := 0; v_din numeric := 0; v_caja numeric := 0; v_imp_rev numeric := 0; v_imp_reg numeric;
  v_dev_id uuid := gen_random_uuid(); v_numero text; v_num int; v_mov_id uuid;
  v_rest numeric; cu record; v_x numeric; v_fac numeric; v_nuevo_total numeric;
  v_items jsonb := '[]'::jsonb; it jsonb; comp record; v_stock numeric; v_pts int; v_acum int;
  v_sal numeric; g record; v_parte numeric; v_asignado numeric; v_cnt int; v_i int;
begin
  if v_uid is null then raise exception 'No autorizado'; end if;

  select * into v from ventas where id = nullif(p->>'venta_id', '')::uuid for update;
  if not found or v.auth_user_id <> v_uid then raise exception 'Venta no encontrada'; end if;
  if v.estado <> 'completada' then raise exception 'Solo se pueden devolver ventas completadas (esta venta está %).', v.estado; end if;
  if coalesce(v.retencion_ir_monto, 0) > 0 then
    raise exception 'Esta venta tiene retención de IR: para devolverla, anúlala y vuelve a registrar lo que corresponda.';
  end if;
  if length(v_motivo) < 3 then raise exception 'Escribe el motivo de la devolución.'; end if;
  if v_fecha < (v.fecha at time zone 'America/Managua')::date then raise exception 'La fecha de la devolución no puede ser anterior a la venta.'; end if;
  if v_fecha > current_date + 1 then raise exception 'La fecha de la devolución no puede ser futura.'; end if;
  if jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then raise exception 'Elige al menos un producto a devolver.'; end if;
  if (select count(distinct x->>'venta_detalle_id') from jsonb_array_elements(v_lineas) x) <> jsonb_array_length(v_lineas) then
    raise exception 'Hay un producto repetido en la devolución.';
  end if;

  select coalesce(sum(greatest(subtotal, 0)), 0), count(*) into v_sum_sub, v_n_det from venta_detalles where venta_id = v.id;
  select coalesce(sum(total), 0), coalesce(sum(impuesto), 0) into v_prev_total, v_prev_imp from devoluciones_venta where venta_id = v.id;

  -- ---- Líneas: validar cantidades y calcular su parte del valor ----
  for el in select * from jsonb_array_elements(v_lineas) loop
    select * into vd from venta_detalles where id = nullif(el->>'venta_detalle_id', '')::uuid and venta_id = v.id;
    if not found then raise exception 'Un producto elegido no pertenece a esta venta.'; end if;
    v_q := round(coalesce(nullif(el->>'cantidad', '')::numeric, 0), 3);
    if v_q <= 0 then raise exception 'La cantidad a devolver de "%" debe ser mayor a cero.', vd.producto_nombre; end if;
    select coalesce(sum(cantidad), 0) into v_ya from devolucion_venta_detalles where venta_detalle_id = vd.id;
    if v_q > coalesce(vd.cantidad, 0) - v_ya + 0.0005 then
      raise exception 'De "%" solo quedan % por devolver (se vendieron %, ya se devolvieron %).',
        vd.producto_nombre, round(coalesce(vd.cantidad, 0) - v_ya, 3), round(coalesce(vd.cantidad, 0), 3), round(v_ya, 3);
    end if;
    v_reing := coalesce((el->>'reingresa')::boolean, true);
    -- Servicios no tienen inventario; las promociones no guardan qué productos llevaban.
    if vd.tipo_item = 'servicio' or vd.promocion_id is not null then v_reing := false; end if;
    if vd.producto_id is null and vd.combo_id is null then v_reing := false; end if;
    v_unid := round(v_q * coalesce(nullif(vd.presentacion_factor, 0), 1), 3);
    v_monto := case when v_sum_sub > 0 and coalesce(vd.cantidad, 0) > 0
                    then round(v.total * (greatest(vd.subtotal, 0) * v_q / vd.cantidad) / v_sum_sub, 2) else 0 end;
    v_costo := round(coalesce(vd.costo, 0) * v_q, 2);
    v_total := v_total + v_monto;
    if v_reing then v_costo_re := v_costo_re + v_costo; else v_costo_no := v_costo_no + v_costo; end if;
    v_items := v_items || jsonb_build_object('vd', vd.id, 'q', v_q, 'unid', v_unid, 'monto', v_monto, 'costo', v_costo,
      'cu', coalesce(vd.costo, 0), 'reing', v_reing, 'producto_id', vd.producto_id, 'combo_id', vd.combo_id,
      'promocion_id', vd.promocion_id, 'lote_id', vd.lote_id, 'nombre', vd.producto_nombre, 'tipo', vd.tipo_item);
  end loop;

  -- ¿Con esta devolución queda devuelta TODA la venta? Entonces el valor es exactamente lo que faltaba.
  select bool_and(coalesce(d.cantidad, 0) <= coalesce((select sum(x.cantidad) from devolucion_venta_detalles x where x.venta_detalle_id = d.id), 0)
                  + coalesce((select (i->>'q')::numeric from jsonb_array_elements(v_items) i where (i->>'vd')::uuid = d.id), 0) + 0.0005)
    into v_completa from venta_detalles d where d.venta_id = v.id;
  if coalesce(v_completa, false) then
    v_x := round(v.total - v_prev_total, 2) - v_total;     -- diferencia de redondeo
    if abs(v_x) >= 0.005 then
      -- se aplica a la línea de mayor valor
      select ordinality - 1 into v_i from jsonb_array_elements(v_items) with ordinality e order by (e->>'monto')::numeric desc limit 1;
      v_items := jsonb_set(v_items, array[v_i::text, 'monto'], to_jsonb(round(((v_items->v_i->>'monto')::numeric + v_x), 2)));
      v_total := v_total + v_x;
    end if;
    v_imp := round(coalesce(v.impuesto, 0) - v_prev_imp, 2);
  else
    v_imp := case when v.total > 0 then round(coalesce(v.impuesto, 0) * v_total / v.total, 2) else 0 end;
  end if;
  v_total := round(v_total, 2);
  if v_total < 0 or v_total > round(v.total - v_prev_total, 2) + 0.005 then
    raise exception 'El valor a devolver (%) supera lo que queda de la venta (%).', v_total, round(v.total - v_prev_total, 2);
  end if;
  v_imp := least(greatest(v_imp, 0), v_total);
  v_neto := round(v_total - v_imp, 2);

  -- ---- ¿Cómo se pagó la venta? ----
  select * into c from creditos where venta_id = v.id order by created_at desc limit 1 for update;
  if found then v_tipo := 'credito';
  elsif v.metodo_pago = 'fiado' then
    select * into f from fiados where venta_id = v.id and estado <> 'eliminado' order by created_at desc limit 1 for update;
    if not found then raise exception 'No se encontró el fiado de esta venta.'; end if;
    v_tipo := 'fiado';
  elsif v.metodo_pago = 'credito' or v.estado_pago = 'credito' then
    raise exception 'No se encontró el crédito de esta venta.';
  else v_tipo := 'contado';
  end if;

  -- IVA ya registrado en Impuestos para esta venta (neto de reversos anteriores)
  select coalesce(sum(monto), 0) into v_imp_reg from movimientos_impuestos
   where auth_user_id = v_uid and referencia_venta_id = v.id and tipo_movimiento = 'IVA_VENTA';
  v_imp_reg := greatest(v_imp_reg, 0);

  if v_tipo = 'contado' then
    v_din := v_total;
    v_imp_rev := least(v_imp, v_imp_reg);
    v_caja := round(v_din - v_imp_rev, 2);            -- igual que entró: el IVA estaba aparte en Impuestos
  elsif v_tipo = 'credito' then
    v_cred := least(v_total, greatest(round(coalesce(c.saldo_pendiente, 0), 2), 0));
    v_din := round(v_total - v_cred, 2);
    -- Si se devuelve TODO y aún queda deuda (intereses no pagados), ya no hay producto que cobrar: se condona.
    if coalesce(v_completa, false) then v_cond := greatest(round(coalesce(c.saldo_pendiente, 0) - v_cred, 2), 0); end if;
    -- En créditos el IVA se registra al cobrar: se revierte el que corresponde al dinero devuelto.
    v_imp_rev := least(case when v.total > 0 then round(coalesce(v.impuesto, 0) * v_din / v.total, 2) else 0 end, v_imp_reg);
    v_caja := v_din;                                  -- los abonos entraron completos a Caja
  else
    v_cred := least(v_total, greatest(round(coalesce(f.saldo, 0), 2), 0));
    v_din := round(v_total - v_cred, 2);
    v_imp_rev := least(v_imp, v_imp_reg);             -- el fiado registró su IVA al venderse
    v_caja := v_din;                                  -- los pagos del fiado entraron completos a Caja
  end if;
  v_imp_rev := greatest(round(v_imp_rev, 2), 0);
  v_caja := greatest(round(v_caja, 2), 0);

  if v_din > 0 and v_metodo_nombre is null then raise exception 'Elige cómo se le devuelve el dinero al cliente.'; end if;
  if v_din > 0 and v_banco_id is not null and not exists (select 1 from bancos where id = v_banco_id and auth_user_id = v_uid) then
    raise exception 'Banco no encontrado.';
  end if;

  if v_simular then
    return jsonb_build_object('simulado', true, 'tipo_venta', v_tipo, 'total', v_total, 'impuesto', v_imp, 'neto', v_neto,
      'monto_credito', v_cred, 'deuda_condonada', v_cond, 'monto_dinero', v_din, 'monto_caja', v_caja, 'impuesto_revertido', v_imp_rev,
      'costo_reingresado', round(v_costo_re, 2), 'costo_no_reingresado', round(v_costo_no, 2), 'completa', coalesce(v_completa, false));
  end if;

  -- ---- Número DEV- ----
  insert into devoluciones_venta_numeracion(auth_user_id, ultimo_numero) values (v_uid, 1)
    on conflict (auth_user_id) do update set ultimo_numero = devoluciones_venta_numeracion.ultimo_numero + 1
    returning ultimo_numero into v_num;
  v_numero := 'DEV-' || lpad(v_num::text, 6, '0');

  insert into devoluciones_venta(id, auth_user_id, numero, venta_id, fecha, motivo, tipo_venta, total, impuesto, neto,
    costo_reingresado, costo_no_reingresado, monto_credito, deuda_condonada, monto_dinero, monto_caja, impuesto_revertido,
    credito_id, fiado_id, metodo_pago_id, metodo_pago_nombre, banco_id, monto_moneda_banco, usuario_nombre)
  values (v_dev_id, v_uid, v_numero, v.id, v_fecha, v_motivo, v_tipo, v_total, v_imp, v_neto,
    round(v_costo_re, 2), round(v_costo_no, 2), v_cred, v_cond, v_din, v_caja, v_imp_rev,
    case when v_tipo = 'credito' then c.id end, case when v_tipo = 'fiado' then f.id end,
    case when v_din > 0 then v_metodo_id end, case when v_din > 0 then v_metodo_nombre end,
    case when v_caja > 0 then v_banco_id end, case when v_caja > 0 and v_banco_id is not null then v_monto_banco end, v_usuario);

  -- ---- Líneas + inventario ----
  for it in select * from jsonb_array_elements(v_items) loop
    insert into devolucion_venta_detalles(auth_user_id, devolucion_id, venta_detalle_id, producto_id, combo_id, promocion_id, lote_id,
      producto_nombre, tipo_item, cantidad, unidades_inventario, monto, costo_unitario, costo_total, reingresa)
    values (v_uid, v_dev_id, (it->>'vd')::uuid, nullif(it->>'producto_id', '')::uuid, nullif(it->>'combo_id', '')::uuid,
      nullif(it->>'promocion_id', '')::uuid, nullif(it->>'lote_id', '')::uuid, it->>'nombre', it->>'tipo',
      (it->>'q')::numeric, (it->>'unid')::numeric, (it->>'monto')::numeric, (it->>'cu')::numeric, (it->>'costo')::numeric,
      (it->>'reing')::boolean);

    if (it->>'reing')::boolean then
      if nullif(it->>'combo_id', '') is not null then
        for comp in select ci.producto_id, ci.cantidad from combo_items ci where ci.combo_id = (it->>'combo_id')::uuid and ci.auth_user_id = v_uid loop
          v_x := round(coalesce(comp.cantidad, 0) * (it->>'unid')::numeric, 3);
          if v_x <= 0 then continue; end if;
          update productos set stock_actual = round(coalesce(stock_actual, 0) + v_x, 3)
           where id = comp.producto_id and auth_user_id = v_uid returning stock_actual into v_stock;
          if found then
            insert into movimientos_inventario(auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota, descuenta_caja, costo_unitario, costo_total)
            select v_uid, comp.producto_id, 'devolucion_venta', 'devolucion', v_x, v_stock - v_x, v_stock,
                   'Devolución ' || v_numero || ' de venta ' || coalesce(v.numero_venta, '') || ' (combo ' || coalesce(it->>'nombre', '') || ')',
                   false, pr.costo, round(coalesce(pr.costo, 0) * v_x, 2)
              from productos pr where pr.id = comp.producto_id;
          end if;
        end loop;
      elsif nullif(it->>'producto_id', '') is not null then
        v_x := (it->>'unid')::numeric;
        update productos set stock_actual = round(coalesce(stock_actual, 0) + v_x, 3)
         where id = (it->>'producto_id')::uuid and auth_user_id = v_uid returning stock_actual into v_stock;
        if found then
          insert into movimientos_inventario(auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota, descuenta_caja, costo_unitario, costo_total)
          values (v_uid, (it->>'producto_id')::uuid, 'devolucion_venta', 'devolucion', v_x, v_stock - v_x, v_stock,
                  'Devolución ' || v_numero || ' de venta ' || coalesce(v.numero_venta, ''), false,
                  (it->>'cu')::numeric, (it->>'costo')::numeric);
          if nullif(it->>'lote_id', '') is not null then
            update producto_lotes set cantidad_actual = coalesce(cantidad_actual, 0) + v_x, updated_at = now()
             where id = (it->>'lote_id')::uuid and auth_user_id = v_uid and producto_id = (it->>'producto_id')::uuid;
          end if;
        end if;
      end if;
    end if;
  end loop;

  -- ---- Crédito: se rebaja la deuda, empezando por la última cuota ----
  if v_tipo = 'credito' and (v_cred + v_cond) > 0 then
    v_rest := v_cred + v_cond;
    for cu in select * from creditos_cuotas where credito_id = c.id
               and round(coalesce(monto_total, 0) - coalesce(monto_pagado, 0), 2) > 0
               order by numero desc for update loop
      exit when v_rest <= 0;
      v_x := least(v_rest, round(cu.monto_total - coalesce(cu.monto_pagado, 0), 2));
      v_nuevo_total := round(cu.monto_total - v_x, 2);
      v_fac := case when cu.monto_total > 0 then v_nuevo_total / cu.monto_total else 0 end;
      update creditos_cuotas set
        monto_total = v_nuevo_total,
        interes  = round(coalesce(interes, 0) * v_fac, 2),
        impuesto = greatest(round(coalesce(impuesto, 0) * v_fac, 2), coalesce(impuesto_acreditado, 0)),
        impuestos_detalle = case when jsonb_typeof(impuestos_detalle) = 'array' then
            (select coalesce(jsonb_agg(case when e ? 'monto' then jsonb_set(e, '{monto}', to_jsonb(round(coalesce((e->>'monto')::numeric, 0) * v_fac, 2))) else e end), '[]'::jsonb)
               from jsonb_array_elements(impuestos_detalle) e)
          else impuestos_detalle end,
        saldo = greatest(round(v_nuevo_total - coalesce(monto_pagado, 0), 2), 0),
        estado = case when round(v_nuevo_total - coalesce(monto_pagado, 0), 2) <= 0.004 then 'pagada'
                      when coalesce(monto_pagado, 0) > 0 then 'parcial' else estado end,
        updated_at = now()
      where id = cu.id;
      -- capital = lo que queda (así capital + interés + impuesto = cuota)
      update creditos_cuotas set capital = greatest(round(monto_total - coalesce(interes, 0) - coalesce(impuesto, 0), 2), 0) where id = cu.id;
      v_rest := round(v_rest - v_x, 2);
    end loop;
    if v_rest > 0.004 then raise exception 'No se pudo rebajar el crédito completo (faltaron %).', v_rest; end if;
    update creditos set
      total_financiado = round(coalesce(total_financiado, 0) - v_cred - v_cond, 2),
      saldo_pendiente  = greatest(round(coalesce(saldo_pendiente, 0) - v_cred - v_cond, 2), 0),
      estado = case when round(coalesce(saldo_pendiente, 0) - v_cred - v_cond, 2) <= 0.01 then 'cancelado' else estado end,
      updated_at = now()
    where id = c.id;
    insert into creditos_historial(auth_user_id, credito_id, tipo_evento, descripcion, data)
    values (v_uid, c.id, 'devolucion', 'Devolución ' || v_numero || ': se rebajaron ' || to_char(v_cred, 'FM999G999G990D00') || ' de la deuda' ||
            case when v_din > 0 then ' y se devolvieron ' || to_char(v_din, 'FM999G999G990D00') || ' en dinero' else '' end ||
            case when v_cond > 0 then '; se condonaron ' || to_char(v_cond, 'FM999G999G990D00') || ' de intereses (se devolvió todo)' else '' end,
            jsonb_build_object('devolucion_id', v_dev_id, 'numero', v_numero, 'monto_credito', v_cred, 'deuda_condonada', v_cond, 'monto_dinero', v_din));
  elsif v_tipo = 'credito' and v_din > 0 then
    insert into creditos_historial(auth_user_id, credito_id, tipo_evento, descripcion, data)
    values (v_uid, c.id, 'devolucion', 'Devolución ' || v_numero || ': se devolvieron ' || to_char(v_din, 'FM999G999G990D00') || ' en dinero (el crédito ya estaba pagado)',
            jsonb_build_object('devolucion_id', v_dev_id, 'numero', v_numero, 'monto_credito', 0, 'monto_dinero', v_din));
  end if;

  -- ---- Fiado: se rebaja la deuda ----
  if v_tipo = 'fiado' and v_cred > 0 then
    if round(f.monto_total - v_cred, 2) <= 0.004 then
      update fiados set saldo = 0, estado = 'eliminado', eliminado_at = now(), updated_at = now(),
        descripcion = left(coalesce(descripcion, '') || ' [Devuelto: ' || v_numero || ']', 500)
       where id = f.id;
    else
      update fiados set monto_total = round(monto_total - v_cred, 2), saldo = greatest(round(saldo - v_cred, 2), 0),
        estado = case when round(saldo - v_cred, 2) <= 0.004 then 'pagado' else estado end,
        pagado_at = case when round(saldo - v_cred, 2) <= 0.004 then now() else pagado_at end,
        updated_at = now()
       where id = f.id;
    end if;
  end if;

  -- ---- Caja / banco ----
  if v_caja > 0 then
    insert into movimientos_financieros(auth_user_id, tipo_flujo, tipo_movimiento, concepto, observaciones, monto,
      metodo_pago_id, metodo_pago_nombre, banco_id, monto_moneda_banco, referencia_tipo, referencia_id, estado, fecha)
    values (v_uid, 'EGRESO', 'OTRO_EGRESO',
      'Devolución ' || v_numero || ' de venta ' || coalesce(v.numero_venta, '') ||
        case when v_tipo = 'contado' and v_imp_rev > 0 then ' (neto de IVA)' else '' end,
      v_motivo, v_caja, v_metodo_id, v_metodo_nombre, v_banco_id,
      case when v_banco_id is not null then v_monto_banco end,
      'devolucion_venta', v_dev_id, 'completado', v_fecha)
    returning id into v_mov_id;
    update devoluciones_venta set movimiento_financiero_id = v_mov_id where id = v_dev_id;
  end if;

  -- ---- Impuestos: reverso (repartido entre los impuestos que tuvo la venta) ----
  if v_imp_rev > 0 then
    perform pg_advisory_xact_lock(hashtextextended('mov_imp:' || v_uid::text, 0));
    select count(*) into v_cnt from (
      select impuesto_id from movimientos_impuestos where auth_user_id = v_uid and referencia_venta_id = v.id and tipo_movimiento = 'IVA_VENTA'
      group by impuesto_id having sum(monto) > 0) s;
    v_asignado := 0; v_i := 0;
    for g in select impuesto_id, max(impuesto_nombre) as nombre, sum(monto) as neto_reg
               from movimientos_impuestos where auth_user_id = v_uid and referencia_venta_id = v.id and tipo_movimiento = 'IVA_VENTA'
              group by impuesto_id having sum(monto) > 0 order by impuesto_id nulls first loop
      v_i := v_i + 1;
      v_parte := case when v_i = v_cnt then round(v_imp_rev - v_asignado, 2) else round(v_imp_rev * g.neto_reg / v_imp_reg, 2) end;
      v_parte := least(v_parte, g.neto_reg);
      if v_parte <= 0 then continue; end if;
      v_asignado := v_asignado + v_parte;
      select saldo_resultante into v_sal from movimientos_impuestos where auth_user_id = v_uid order by created_at desc, id desc limit 1;
      v_sal := coalesce(v_sal, 0);
      insert into movimientos_impuestos(auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
        referencia_venta_id, fecha, impuesto_id, impuesto_nombre, created_at)
      values (v_uid, 'IVA_VENTA', 'Reverso de ' || coalesce(g.nombre, 'IVA') || ' por devolución ' || v_numero || ' de venta ' || coalesce(v.numero_venta, ''),
        -v_parte, v_sal, round(v_sal - v_parte, 2), v.id, v_fecha, g.impuesto_id, g.nombre, clock_timestamp());
    end loop;
    update devoluciones_venta set impuesto_revertido = round(v_asignado, 2) where id = v_dev_id;
    -- lo no revertido en Impuestos (redondeo) se devuelve igual por Caja en contado
    if v_tipo = 'contado' and round(v_imp_rev - v_asignado, 2) <> 0 and v_mov_id is not null then
      update movimientos_financieros set monto = round(monto + (v_imp_rev - v_asignado), 2) where id = v_mov_id;
      update devoluciones_venta set monto_caja = round(monto_caja + (v_imp_rev - v_asignado), 2) where id = v_dev_id;
    end if;
  end if;

  -- ---- Cliente: total comprado ----
  if v.cliente_id is not null then
    update clientes set total_compras = greatest(round(coalesce(total_compras, 0) - v_total, 2), 0),
      num_compras = case when coalesce(v_completa, false) then greatest(coalesce(num_compras, 0) - 1, 0) else num_compras end
     where id = v.cliente_id and auth_user_id = v_uid;
  end if;

  -- ---- Puntos: se descuentan en proporción a lo devuelto ----
  begin
    select coalesce(sum(puntos), 0) into v_acum from puntos_movimientos where venta_id = v.id and tipo = 'acumulacion';
    if v_acum > 0 and v.total > 0 and v.cliente_id is not null then
      v_pts := floor(v_acum * v_total / v.total);
      if v_pts > 0 then
        insert into puntos_movimientos(auth_user_id, cliente_id, tipo, puntos, venta_id, nota)
        values (v_uid, v.cliente_id, 'ajuste', -v_pts, v.id, 'Devolución ' || v_numero || ' de venta ' || coalesce(v.numero_venta, ''));
      end if;
    end if;
  exception when others then null;  -- los puntos nunca bloquean una devolución
  end;

  -- ---- Auditoría ----
  begin
    insert into auditoria_log(auth_user_id, perfil_nombre, perfil_tipo, modulo, tabla, accion, resumen)
    values (v_uid, coalesce(v_usuario, 'Admin'), case when p->>'perfil_tipo' = 'restringido' then 'restringido' else 'admin' end, 'ventas', 'devoluciones_venta', 'INSERT',
      'Devolución ' || v_numero || ' de venta ' || coalesce(v.numero_venta, '') || ' por ' || v_total || ' — ' || v_motivo);
  exception when others then null;
  end;

  return jsonb_build_object('id', v_dev_id, 'numero', v_numero, 'tipo_venta', v_tipo, 'total', v_total, 'impuesto', v_imp,
    'monto_credito', v_cred, 'deuda_condonada', v_cond, 'monto_dinero', v_din,
    'monto_caja', (select monto_caja from devoluciones_venta where id = v_dev_id),
    'impuesto_revertido', (select impuesto_revertido from devoluciones_venta where id = v_dev_id),
    'completa', coalesce(v_completa, false));
end $$;

revoke all on function public.registrar_devolucion_venta(jsonb) from public, anon;
grant execute on function public.registrar_devolucion_venta(jsonb) to authenticated;
