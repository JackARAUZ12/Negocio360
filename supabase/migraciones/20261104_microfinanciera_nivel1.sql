-- =====================================================================
-- PANEL MICROFINANCIERA · NIVEL 1 (4-nov-2026)
-- Vender al crédito (productos o préstamo en efectivo), ruta de cobro, cobrar con recibo,
-- tarjeta del cliente y gestiones (no estaba / promesa de pago).
--
-- CONECTADO AL SISTEMA: escribe en las MISMAS tablas de siempre, con la misma forma que Créditos:
--   ventas + venta_detalles (venta "a crédito" → Contabilidad: Cuentas por Cobrar / Ventas),
--   creditos + creditos_cuotas (lo ven Créditos, Agenda y Recordatorios),
--   creditos_pagos (Contabilidad: Caja / Cuentas por Cobrar) y movimientos_financieros (Caja).
--
-- CANDADOS:
--   * Apagado por defecto (configuracion_empresa.usa_modulo_microfinanciera).
--   * Cada operación es UNA transacción del servidor: o queda todo (venta, inventario, crédito,
--     cuotas, Caja, pago) o no queda nada.
--   * Montos, costos y stock los calcula/valida el servidor; no deja vender sin existencias.
--   * La prima es la cuota #1 ya pagada (entra a Caja y a Contabilidad; las cuotas suman exacto).
--   * Cobro: nunca más que el saldo; el mismo cobro (ref) nunca se cuenta dos veces.
--   * Recibos numerados R-000001 sin saltos (por negocio).
--   * Anular un cobro: con motivo; revierte Caja, cuotas y saldo; nunca se borra nada.
--   * No cobra aquí créditos con impuestos ni a bancos de otra moneda (esos siguen en Créditos).
-- =====================================================================

alter table public.configuracion_empresa add column if not exists usa_modulo_microfinanciera boolean not null default false;

-- Referencia única por operación (evita duplicados por doble toque o reintento sin señal)
alter table public.creditos add column if not exists mf_ref text;
create unique index if not exists creditos_mf_ref_uq on public.creditos (auth_user_id, mf_ref) where mf_ref is not null;
alter table public.creditos_pagos add column if not exists mf_ref text;
create unique index if not exists creditos_pagos_mf_ref_uq on public.creditos_pagos (auth_user_id, mf_ref) where mf_ref is not null;

-- Numeración de recibos por negocio (solo la usan las funciones del servidor)
create table if not exists public.mf_numeracion (
  auth_user_id uuid primary key,
  ultimo_recibo integer not null default 0
);
alter table public.mf_numeracion enable row level security;
revoke all on public.mf_numeracion from anon, authenticated;

-- Gestiones de cobro (no estaba, promesa de pago, nota)
create table if not exists public.mf_gestiones (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  credito_id uuid not null references public.creditos(id) on delete cascade,
  cliente_id uuid,
  tipo text not null check (tipo in ('no_estaba', 'promesa', 'nota')),
  fecha_promesa date,
  nota text check (nota is null or length(nota) <= 300),
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists mf_gestiones_idx on public.mf_gestiones (auth_user_id, credito_id, created_at desc);
alter table public.mf_gestiones enable row level security;
drop policy if exists mf_gestiones_ver on public.mf_gestiones;
create policy mf_gestiones_ver on public.mf_gestiones for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.mf_gestiones from anon, authenticated;
grant select on public.mf_gestiones to authenticated;

create or replace function public._mf_activo(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select usa_modulo_microfinanciera from public.configuracion_empresa where auth_user_id = p_uid limit 1), false);
$$;

create or replace function public._mf_recibo(p_uid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.mf_numeracion (auth_user_id, ultimo_recibo) values (p_uid, 1)
  on conflict (auth_user_id) do update set ultimo_recibo = public.mf_numeracion.ultimo_recibo + 1
  returning ultimo_recibo into v;
  return 'R-' || lpad(v::text, 6, '0');
end $$;

-- Fecha de la cuota i (0 = la primera). Diaria puede saltarse los domingos.
create or replace function public._mf_fecha_cuota(p_inicio date, p_frec text, p_i integer, p_sin_domingos boolean)
returns date language plpgsql immutable as $$
declare d date := p_inicio; k integer := 0;
begin
  if p_frec = 'diaria' then
    if p_sin_domingos and extract(isodow from d) = 7 then d := d + 1; end if;
    while k < p_i loop
      d := d + 1;
      if p_sin_domingos and extract(isodow from d) = 7 then d := d + 1; end if;
      k := k + 1;
    end loop;
    return d;
  elsif p_frec = 'semanal' then return p_inicio + (7 * p_i);
  elsif p_frec = 'quincenal' then return p_inicio + (15 * p_i);
  else return (p_inicio + make_interval(months => p_i))::date;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- VENDER AL CRÉDITO (productos) o PRESTAR EFECTIVO — todo en una operación
-- p: { tipo:'productos'|'efectivo', cliente_id, items:[{producto_id,cantidad,precio}], recargo_pct,
--      monto (efectivo), interes_pct (efectivo), prima, prima_metodo_id, prima_metodo_nombre, prima_banco_id,
--      frecuencia:'diaria'|'semanal'|'quincenal'|'mensual', num_cuotas, primera_fecha, sin_domingos, nota, ref, creado_por }
-- ---------------------------------------------------------------------
create or replace function public.mf_credito_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_hoy date := (now() at time zone 'America/Managua')::date;
  v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'productos');
  v_cli uuid; v_cnom text; v_frec text := coalesce(nullif(p ->> 'frecuencia', ''), 'semanal');
  v_n integer; v_inicio date; v_sindom boolean := coalesce(nullif(p ->> 'sin_domingos', '')::boolean, true);
  v_ref text := left(nullif(btrim(coalesce(p ->> 'ref', '')), ''), 80);
  v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120);
  v_nota text := left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300);
  v_rpct numeric; v_ipct numeric; v_prima numeric; v_capital numeric := 0; v_interes numeric := 0;
  v_subtotal numeric := 0; v_costo numeric := 0; v_recargo numeric := 0; v_total numeric; v_fin numeric;
  v_cap_tot numeric; v_ncu integer; v_cap_c numeric; v_int_c numeric; v_acum_cap numeric := 0; v_acum_int numeric := 0;
  v_acum numeric := 0; v_mon numeric; v_fecha date; v_off integer;
  it record; pr record; v_venta uuid; v_numv text; v_cred uuid; v_numc text; v_prodfin uuid; v_caja numeric;
  v_mov uuid; v_recibo text; v_met uuid; v_metn text; v_banco uuid; v_bmon text; v_emon text; i integer;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if v_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended('n360_mf_ref:' || v_uid::text || ':' || v_ref, 0));
    select id, numero_credito into v_cred, v_numc from creditos where auth_user_id = v_uid and mf_ref = v_ref;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'credito_id', v_cred, 'numero_credito', v_numc); end if;
  end if;
  begin
    v_cli := nullif(p ->> 'cliente_id', '')::uuid;
    v_n := nullif(p ->> 'num_cuotas', '')::integer;
    v_inicio := coalesce(nullif(p ->> 'primera_fecha', '')::date, v_hoy);
    v_rpct := coalesce(nullif(p ->> 'recargo_pct', '')::numeric, 0);
    v_ipct := coalesce(nullif(p ->> 'interes_pct', '')::numeric, 0);
    v_prima := round(coalesce(nullif(p ->> 'prima', '')::numeric, 0), 2);
    v_met := nullif(p ->> 'prima_metodo_id', '')::uuid; v_banco := nullif(p ->> 'prima_banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  v_metn := left(coalesce(nullif(btrim(coalesce(p ->> 'prima_metodo_nombre', '')), ''), 'Efectivo'), 120);

  if v_tipo not in ('productos', 'efectivo') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  select btrim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) into v_cnom from clientes where id = v_cli and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  if v_frec not in ('diaria', 'semanal', 'quincenal', 'mensual') then return jsonb_build_object('ok', false, 'motivo', 'frecuencia'); end if;
  if v_n is null or v_n < 1 or v_n > 365 then return jsonb_build_object('ok', false, 'motivo', 'cuotas'); end if;
  if v_inicio < v_hoy - 31 or v_inicio > v_hoy + 366 then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end if;
  if v_rpct < 0 or v_rpct > 300 or v_ipct < 0 or v_ipct > 300 then return jsonb_build_object('ok', false, 'motivo', 'porcentaje'); end if;
  if v_prima < 0 then return jsonb_build_object('ok', false, 'motivo', 'prima'); end if;

  if v_tipo = 'productos' then
    if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 or jsonb_array_length(p -> 'items') > 100 then
      return jsonb_build_object('ok', false, 'motivo', 'sin_items'); end if;
    begin
      -- Existencias por producto (sumando si se repite), con el producto bloqueado
      for it in select x.producto_id, sum(x.cantidad) q from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric)
                 group by x.producto_id order by x.producto_id loop
        select id, nombre, tipo, stock_actual, activo into pr from productos where id = it.producto_id and auth_user_id = v_uid for update;
        if not found or pr.activo is false or pr.tipo not in ('producto', 'servicio') then return jsonb_build_object('ok', false, 'motivo', 'producto'); end if;
        if pr.tipo = 'producto' and coalesce(pr.stock_actual, 0) < it.q then
          return jsonb_build_object('ok', false, 'motivo', 'sin_stock', 'producto', pr.nombre, 'hay', coalesce(pr.stock_actual, 0), 'necesita', it.q);
        end if;
      end loop;
      for it in select x.* from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric) loop
        if it.cantidad is null or it.cantidad <= 0 or it.cantidad > 1000000 then return jsonb_build_object('ok', false, 'motivo', 'cantidad'); end if;
        if it.precio is null or it.precio < 0 or it.precio > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'precio'); end if;
        select costo into pr from productos where id = it.producto_id and auth_user_id = v_uid;
        v_subtotal := v_subtotal + round(it.cantidad * it.precio, 2);
        v_costo := v_costo + it.cantidad * coalesce(pr.costo, 0);
      end loop;
    exception when invalid_text_representation or datatype_mismatch then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    v_subtotal := round(v_subtotal, 2);
    if v_subtotal <= 0 then return jsonb_build_object('ok', false, 'motivo', 'total_cero'); end if;
    v_recargo := round(v_subtotal * v_rpct / 100, 2);
    v_total := v_subtotal + v_recargo;
    if v_prima >= v_total then return jsonb_build_object('ok', false, 'motivo', 'prima'); end if;
    v_cap_tot := v_total - v_prima;       -- lo que se reparte en cuotas
    v_fin := v_total;                     -- el crédito completo (la prima es la cuota #1 ya pagada)
  else
    begin v_capital := round(coalesce(nullif(p ->> 'monto', '')::numeric, 0), 2); exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
    if v_capital <= 0 or v_capital > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;
    if v_prima > 0 then return jsonb_build_object('ok', false, 'motivo', 'prima_prestamo'); end if;
    select saldo_resultante into v_caja from movimientos_financieros where auth_user_id = v_uid and estado = 'completado' order by created_at desc limit 1;
    if v_capital > coalesce(v_caja, 0) + 0.01 then return jsonb_build_object('ok', false, 'motivo', 'fondos', 'caja', coalesce(v_caja, 0)); end if;
    v_interes := round(v_capital * v_ipct / 100, 2);
    v_total := v_capital + v_interes;
    v_cap_tot := v_capital; v_fin := v_total;
  end if;

  if v_prima > 0 then
    if v_met is not null and not exists (select 1 from metodos_pago where id = v_met and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
    if v_banco is not null then
      select moneda into v_bmon from bancos where id = v_banco and auth_user_id = v_uid;
      if not found then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
      select moneda into v_emon from configuracion_empresa where auth_user_id = v_uid limit 1;
      if coalesce(v_bmon, 'NIO') <> coalesce(v_emon, 'NIO') then return jsonb_build_object('ok', false, 'motivo', 'banco_moneda'); end if;
    end if;
  end if;

  -- 1) Venta a crédito (solo productos): queda en Ventas y en Contabilidad como "Crédito otorgado"
  if v_tipo = 'productos' then
    v_numv := public.generar_numero_venta(v_uid);
    insert into ventas (auth_user_id, numero_venta, cliente_id, cliente_nombre, fecha, subtotal, descuento, impuesto, total, costo_total,
                        metodo_pago, estado_pago, estado, categoria, iva_activo, iva_porcentaje, observaciones, creado_por_nombre)
    values (v_uid, v_numv, v_cli, coalesce(nullif(v_cnom, ''), 'Cliente'), (v_hoy::timestamp at time zone 'UTC'), v_total, 0, 0, v_total, round(v_costo, 2),
            'credito', 'credito', 'completada', 'credito', false, 0, left('Panel Microfinanciera · venta al crédito' || coalesce(' · ' || v_nota, ''), 1000), v_por)
    returning id into v_venta;
    for it in select x.* from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric) loop
      select id, nombre, tipo, sku, costo into pr from productos where id = it.producto_id and auth_user_id = v_uid;
      insert into venta_detalles (venta_id, auth_user_id, producto_id, producto_nombre, producto_sku, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia, es_regalia, vendido_sin_stock)
      values (v_venta, v_uid, pr.id, pr.nombre, pr.sku, pr.tipo, it.cantidad, it.precio, coalesce(pr.costo, 0), 0,
              round(it.cantidad * it.precio, 2), round(it.cantidad * it.precio - it.cantidad * coalesce(pr.costo, 0), 2), false, false);
    end loop;
    if v_recargo > 0 then
      insert into venta_detalles (venta_id, auth_user_id, producto_id, producto_nombre, tipo_item, cantidad, precio, costo, descuento, subtotal, ganancia, es_regalia, vendido_sin_stock)
      values (v_venta, v_uid, null, 'Recargo por venta al crédito (' || trim(to_char(v_rpct, 'FM999990.##')) || '%)', 'servicio', 1, v_recargo, 0, 0, v_recargo, v_recargo, false, false);
    end if;
    for it in select x.producto_id, sum(x.cantidad) q from jsonb_to_recordset(p -> 'items') as x(producto_id uuid, cantidad numeric, precio numeric) group by x.producto_id loop
      update productos set stock_actual = round(coalesce(stock_actual, 0) - it.q, 3) where id = it.producto_id and auth_user_id = v_uid and tipo = 'producto';
    end loop;
    update clientes set total_compras = coalesce(total_compras, 0) + v_total, num_compras = coalesce(num_compras, 0) + 1 where id = v_cli and auth_user_id = v_uid;
  else
    select id into v_prodfin from productos where auth_user_id = v_uid and tipo = 'financiero' and lower(btrim(nombre)) = 'préstamo en efectivo' limit 1;
    if v_prodfin is null then
      insert into productos (auth_user_id, tipo, nombre, activo) values (v_uid, 'financiero', 'Préstamo en efectivo', true) returning id into v_prodfin;
    end if;
  end if;

  -- 2) Crédito y cuotas (si hay prima, es la cuota #1 y queda pagada abajo)
  v_numc := public.generar_numero_credito(v_uid);
  v_ncu := v_n + case when v_prima > 0 then 1 else 0 end;
  insert into creditos (auth_user_id, numero_credito, tipo, cliente_id, venta_id, producto_financiero_id, monto_original, prima_tipo, prima_valor, prima_monto,
                        capital_financiado, tipo_financiamiento, tasa_interes, tipo_interes, metodo_amortizacion, frecuencia, num_cuotas, fecha_inicio,
                        total_intereses, total_financiado, valor_cuota_aprox, saldo_pendiente, estado, observaciones, modalidad_pago, mf_ref)
  values (v_uid, v_numc, case when v_tipo = 'productos' then 'venta' else 'financiero' end, v_cli, v_venta, v_prodfin,
          case when v_tipo = 'productos' then v_total else v_capital end, 'ninguna', 0, 0,
          case when v_tipo = 'productos' then v_total else v_capital end,
          case when v_interes > 0 then 'con_interes' else 'sin_interes' end, case when v_interes > 0 then v_ipct end, case when v_interes > 0 then 'simple' end,
          'simple', v_frec, v_ncu, v_inicio, v_interes, v_fin, round((v_cap_tot + v_interes) / v_n, 2), v_fin, 'activo',
          left('Panel Microfinanciera' || case when v_prima > 0 then ' · prima ' || v_prima || ' (cuota 1)' else '' end || coalesce(' · ' || v_nota, ''), 1000), 'cuotas', v_ref)
  returning id into v_cred;

  v_off := 0;
  if v_prima > 0 then
    insert into creditos_cuotas (auth_user_id, credito_id, numero, fecha_vencimiento, capital, interes, impuesto, impuestos_detalle, monto_total, monto_pagado, saldo, estado, impuesto_acreditado)
    values (v_uid, v_cred, 1, v_hoy, v_prima, 0, 0, '[]'::jsonb, v_prima, 0, round(v_fin - v_prima, 2), 'pendiente', 0);
    v_acum := v_prima; v_off := 1;
  end if;
  for i in 1 .. v_n loop
    if i = v_n then v_cap_c := round(v_cap_tot - v_acum_cap, 2); v_int_c := round(v_interes - v_acum_int, 2);
    else v_cap_c := round(v_cap_tot / v_n, 2); v_int_c := round(v_interes / v_n, 2); end if;
    v_acum_cap := v_acum_cap + v_cap_c; v_acum_int := v_acum_int + v_int_c;
    v_mon := v_cap_c + v_int_c; v_acum := v_acum + v_mon;
    v_fecha := public._mf_fecha_cuota(v_inicio, v_frec, i - 1, v_sindom);
    insert into creditos_cuotas (auth_user_id, credito_id, numero, fecha_vencimiento, capital, interes, impuesto, impuestos_detalle, monto_total, monto_pagado, saldo, estado, impuesto_acreditado)
    values (v_uid, v_cred, i + v_off, v_fecha, v_cap_c, v_int_c, 0, '[]'::jsonb, v_mon, 0, round(v_fin - v_acum, 2), 'pendiente', 0);
  end loop;
  if round(v_acum, 2) <> round(v_fin, 2) then raise exception 'Las cuotas no suman el total del crédito. No se guardó nada.'; end if;

  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (v_cred, v_uid, 'creado', 'Crédito ' || v_numc || ' creado desde el Panel Microfinanciera por ' || v_fin,
          jsonb_build_object('numeroCredito', v_numc, 'tipo', v_tipo, 'totalFinanciado', v_fin, 'por', v_por));

  -- 3) Caja: el préstamo sale de Caja; la prima entra a Caja (como pago de la cuota #1)
  if v_tipo = 'efectivo' then
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_nombre, referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, 'EGRESO', 'CREDITO_OTORGADO', 'Préstamo otorgado — crédito ' || v_numc, v_capital, 0, 0, 'Efectivo', 'credito', v_cred, v_nota, v_hoy, 'completado');
    insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
    values (v_cred, v_uid, 'desembolso', 'Se entregaron ' || v_capital || ' de Caja por el préstamo', '{}'::jsonb);
  end if;
  if v_prima > 0 then
    v_recibo := public._mf_recibo(v_uid);
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, 'INGRESO', 'PAGO_CREDITO', 'Prima crédito ' || v_numc || ' · recibo ' || v_recibo, v_prima, 0, 0, v_met, v_metn, v_banco, 'credito', v_cred, null, v_hoy, 'completado')
    returning id into v_mov;
    update creditos_cuotas set monto_pagado = v_prima, estado = 'pagada', updated_at = now() where credito_id = v_cred and numero = 1;
    update creditos set saldo_pendiente = round(v_fin - v_prima, 2), updated_at = now() where id = v_cred;
    insert into creditos_pagos (auth_user_id, credito_id, cliente_id, fecha, monto, metodo_pago_id, metodo_pago_nombre, observaciones,
                                saldo_anterior, saldo_nuevo, movimiento_financiero_id, comprobante_numero, estado)
    values (v_uid, v_cred, v_cli, v_hoy, v_prima, v_met, v_metn, 'Prima (pago inicial)', v_fin, round(v_fin - v_prima, 2), v_mov, v_recibo, 'completado');
  end if;

  return jsonb_build_object('ok', true, 'credito_id', v_cred, 'numero_credito', v_numc, 'venta_id', v_venta, 'numero_venta', v_numv,
    'total', v_fin, 'prima', v_prima, 'saldo', round(v_fin - v_prima, 2), 'cuotas', v_n, 'cuota', round((v_cap_tot + v_interes) / v_n, 2),
    'recargo', v_recargo, 'interes', v_interes, 'recibo_prima', v_recibo);
end $$;

-- ---------------------------------------------------------------------
-- COBRAR (abono a un crédito) — todo en una operación, con recibo numerado
-- p: { credito_id, monto, metodo_pago_id, metodo_pago_nombre, banco_id, nota, ref, creado_por }
-- ---------------------------------------------------------------------
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
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin
    v_cid := (p ->> 'credito_id')::uuid; v_monto := round((p ->> 'monto')::numeric, 2);
    v_met := nullif(p ->> 'metodo_pago_id', '')::uuid; v_banco := nullif(p ->> 'banco_id', '')::uuid;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended('n360_mf_pago:' || v_uid::text || ':' || v_ref, 0));
    select id, comprobante_numero, saldo_nuevo into q from creditos_pagos where auth_user_id = v_uid and mf_ref = v_ref;
    if found then return jsonb_build_object('ok', true, 'repetido', true, 'pago_id', q.id, 'recibo', q.comprobante_numero, 'saldo', q.saldo_nuevo); end if;
  end if;
  select * into c from creditos where id = v_cid and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
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
                              saldo_anterior, saldo_nuevo, movimiento_financiero_id, comprobante_numero, estado, mf_ref)
  values (v_uid, c.id, c.cliente_id, v_hoy, v_monto, v_met, v_metn, v_nota, c.saldo_pendiente, v_saldo_nuevo, v_mov, v_recibo, 'completado', v_ref)
  returning id into v_pago;
  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (c.id, v_uid, 'pago', 'Pago de ' || v_monto || ' registrado (recibo ' || v_recibo || ', Panel Microfinanciera)', jsonb_build_object('monto', v_monto, 'saldoNuevo', v_saldo_nuevo, 'por', v_por));
  if v_estado = 'cancelado' then
    insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data) values (c.id, v_uid, 'cancelado', 'Crédito cancelado — saldo en cero', '{}'::jsonb);
  end if;
  select fecha_vencimiento, round(monto_total - coalesce(monto_pagado, 0), 2) into v_pf, v_pm
    from creditos_cuotas where credito_id = c.id and estado <> 'pagada' order by numero limit 1;
  return jsonb_build_object('ok', true, 'pago_id', v_pago, 'recibo', v_recibo, 'monto', v_monto, 'saldo_anterior', c.saldo_pendiente, 'saldo', v_saldo_nuevo,
    'cancelado', v_estado = 'cancelado', 'numero_credito', c.numero_credito,
    'proxima_fecha', v_pf, 'proxima_monto', v_pm);
end $$;

-- ---------------------------------------------------------------------
-- ANULAR UN COBRO (con motivo). Revierte Caja, cuotas y saldo. Nunca se borra.
-- Solo cobros hechos por el Panel (los de Créditos se anulan en Créditos).
-- ---------------------------------------------------------------------
create or replace function public.mf_anular_pago(p_pago_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); pg record; c record; q record; v_rest numeric; v_quitar numeric; v_pag numeric; v_saldo numeric;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 200);
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if v_motivo is null or length(v_motivo) < 3 then return jsonb_build_object('ok', false, 'motivo', 'motivo'); end if;
  select * into pg from creditos_pagos where id = p_pago_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if pg.estado = 'anulado' then return jsonb_build_object('ok', false, 'motivo', 'ya_anulado'); end if;
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
  insert into creditos_historial (credito_id, auth_user_id, tipo_evento, descripcion, data)
  values (c.id, v_uid, 'pago_anulado', 'Se anuló el cobro ' || pg.comprobante_numero || ' de ' || pg.monto || ': ' || v_motivo, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'saldo', v_saldo, 'recibo', pg.comprobante_numero, 'monto', pg.monto);
end $$;

-- ---------------------------------------------------------------------
-- GESTIÓN DE COBRO (no estaba / promesa de pago / nota). Solo anota; no toca dinero.
-- ---------------------------------------------------------------------
create or replace function public.mf_gestion(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cid uuid; v_tipo text := p ->> 'tipo'; v_fecha date; c record; v_id uuid;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not public._mf_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin v_cid := (p ->> 'credito_id')::uuid; v_fecha := nullif(p ->> 'fecha_promesa', '')::date;
  exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  if v_tipo not in ('no_estaba', 'promesa', 'nota') then return jsonb_build_object('ok', false, 'motivo', 'datos'); end if;
  if v_tipo = 'promesa' and (v_fecha is null or v_fecha < (now() at time zone 'America/Managua')::date) then return jsonb_build_object('ok', false, 'motivo', 'fecha'); end if;
  if v_tipo = 'nota' and length(btrim(coalesce(p ->> 'nota', ''))) < 2 then return jsonb_build_object('ok', false, 'motivo', 'nota'); end if;
  select id, cliente_id into c from creditos where id = v_cid and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  insert into mf_gestiones (auth_user_id, credito_id, cliente_id, tipo, fecha_promesa, nota, creado_por)
  values (v_uid, c.id, c.cliente_id, v_tipo, case when v_tipo = 'promesa' then v_fecha end, left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300),
          left(coalesce(nullif(btrim(coalesce(p ->> 'creado_por', '')), ''), 'Usuario'), 120))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public._mf_activo(uuid) from public, anon, authenticated;
revoke all on function public._mf_recibo(uuid) from public, anon, authenticated;
revoke all on function public.mf_credito_crear(jsonb) from public, anon;
revoke all on function public.mf_cobrar(jsonb) from public, anon;
revoke all on function public.mf_anular_pago(uuid, text) from public, anon;
revoke all on function public.mf_gestion(jsonb) from public, anon;
grant execute on function public.mf_credito_crear(jsonb) to authenticated;
grant execute on function public.mf_cobrar(jsonb) to authenticated;
grant execute on function public.mf_anular_pago(uuid, text) to authenticated;
grant execute on function public.mf_gestion(jsonb) to authenticated;
