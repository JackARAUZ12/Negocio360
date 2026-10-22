-- =====================================================================
-- VENTAS: registrar la venta en UNA sola operación (todo o nada) y
-- descontar el inventario sobre la existencia REAL del momento.
-- Fecha: 21-oct-2026 · Solo AGREGA dos funciones nuevas.
--
-- PROBLEMAS (auditoría 21-oct):
--  1) La página guardaba la venta, sus productos, el inventario producto
--     por producto, la Caja, el cliente y el fiado en pasos separados. Si
--     la página se cerraba o se caía el internet a la mitad, quedaba la
--     venta a medias (3 ventas de contado sin Caja desde septiembre).
--  2) El inventario se descontaba con la existencia que la página cargó
--     al abrirse ("hay 100, vendí 5 → guardo 95"). Si otra persona vendía
--     el mismo producto en ese rato, una venta pisaba a la otra y el
--     sistema quedaba con MÁS inventario del real.
--
-- AHORA:
--  * venta_registrar_atomica(): venta + productos + inventario (incluye
--    combos, promociones y stock compartido) + Caja + historial del
--    cliente + fiado, en UNA transacción. O se guarda todo, o nada.
--    Repetible: si la misma venta (mismo número) ya se guardó, devuelve
--    esa misma sin duplicar (sirve para reintentar si se cortó la red).
--  * El inventario se descuenta restando sobre la existencia real en la
--    base (stock = stock - cantidad), nunca con un número calculado en la
--    página. Mismas reglas de siempre: nunca baja de 0.
--  * ajustar_stock_relativo(): sumar/restar existencias de forma segura
--    (lo usa la anulación de ventas para devolver el inventario).
-- Lo demás de la venta (IVA, retenciones, comisión bancaria, series,
-- lotes, garantías, recibo) sigue igual en la página, después.
-- =====================================================================

-- Inserta una fila (jsonb) en una tabla usando solo las columnas que
-- existen y no son calculadas (así no falla por columnas opcionales).
create or replace function public._insertar_fila_jsonb(p_tabla text, p_fila jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cols text; v_id uuid;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_tabla and c.is_generated = 'NEVER'
     and coalesce(c.is_identity, 'NO') = 'NO' and p_fila ? c.column_name;
  if v_cols is null then raise exception 'Fila vacía para %', p_tabla; end if;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id', p_tabla, v_cols, v_cols, p_tabla)
    using p_fila into v_id;
  return v_id;
end $$;
revoke all on function public._insertar_fila_jsonb(text, jsonb) from public, anon, authenticated;

create or replace function public.venta_registrar_atomica(
  p_venta jsonb,       -- columnas de "ventas" (como las arma la página)
  p_detalles jsonb,    -- [ {columnas de "venta_detalles"} ]
  p_stock jsonb,       -- [ {"tipo":"producto","producto_id":..,"cantidad":..} | {"tipo":"remoto","sucursal_id":..,"nombre":..,"cantidad":..}
                       --   | {"tipo":"combo","combo_id":..,"cantidad":..} | {"tipo":"componente","producto_id":..,"cantidad":..} ]
  p_caja jsonb,        -- [ {concepto, monto, metodo_pago_id, metodo_pago_nombre, banco_id, monto_moneda_banco, observaciones, fecha} ]  (vacío en fiado)
  p_cliente_total numeric default null,  -- suma a total_compras del cliente (null = no tocar)
  p_fiado jsonb default null             -- columnas de "fiados" (sin venta_id) o null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_num text := nullif(trim(p_venta->>'numero_venta'), '');
  v_id uuid; v_existente record; it jsonb; ci record; v_mov uuid; v_movs uuid[] := '{}'; v_avisos text[] := '{}';
  v_cant numeric; v_tipo text;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if v_num is null then raise exception 'La venta no tiene número'; end if;
  if jsonb_typeof(p_detalles) <> 'array' or jsonb_array_length(p_detalles) = 0 then raise exception 'La venta no tiene productos'; end if;
  perform pg_advisory_xact_lock(hashtext('n360_venta:' || v_uid::text || ':' || v_num));

  -- Repetible: si esta venta ya se guardó (reintento tras corte de red), se devuelve la misma.
  select v.id, v.referencia_caja into v_existente from ventas v
   where v.auth_user_id = v_uid and v.numero_venta = v_num and v.estado = 'completada'
     and v.created_at > now() - interval '2 hours'
     -- solo si es la MISMA venta (mismo total y mismas líneas); si no, se deja que la base
     -- rechace el número repetido como siempre (no se pierde una venta distinta)
     and round(coalesce(v.total, 0), 2) = round(coalesce((p_venta->>'total')::numeric, 0), 2)
     and (select count(*) from venta_detalles d where d.venta_id = v.id) = jsonb_array_length(p_detalles)
   order by v.created_at desc limit 1;
  if v_existente.id is not null then
    return jsonb_build_object('venta_id', v_existente.id, 'ya_existia', true,
      'caja_ids', coalesce((select jsonb_agg(m.id order by m.created_at) from movimientos_financieros m
                             where m.auth_user_id = v_uid and m.referencia_tipo = 'venta' and m.referencia_id = v_existente.id and m.tipo_flujo = 'INGRESO'), '[]'::jsonb),
      'avisos', '[]'::jsonb);
  end if;

  -- 1) Venta (el dueño SIEMPRE es quien está en sesión)
  v_id := public._insertar_fila_jsonb('ventas', (p_venta - 'id' - 'created_at' - 'updated_at' - 'ganancia') || jsonb_build_object('auth_user_id', v_uid));

  -- 2) Productos de la venta
  for it in select * from jsonb_array_elements(p_detalles) loop
    perform public._insertar_fila_jsonb('venta_detalles', (it - 'id' - 'created_at') || jsonb_build_object('auth_user_id', v_uid, 'venta_id', v_id));
  end loop;

  -- 3) Inventario sobre la existencia REAL (nunca baja de 0)
  for it in select * from jsonb_array_elements(coalesce(p_stock, '[]'::jsonb)) loop
    v_tipo := it->>'tipo';
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then continue; end if;
    if v_tipo in ('producto', 'componente') then
      update productos set stock_actual = greatest(0, coalesce(stock_actual, 0) - v_cant)
       where id = (it->>'producto_id')::uuid and auth_user_id = v_uid and tipo = 'producto';
    elsif v_tipo = 'combo' then
      for ci in select * from combo_items where combo_id = (it->>'combo_id')::uuid and auth_user_id = v_uid loop
        update productos set stock_actual = greatest(0, coalesce(stock_actual, 0) - ci.cantidad * v_cant)
         where id = ci.producto_id and auth_user_id = v_uid and tipo = 'producto';
      end loop;
    elsif v_tipo = 'remoto' then
      begin
        perform public.descontar_stock_remoto((it->>'sucursal_id')::uuid, it->>'nombre', v_cant);
      exception when others then
        v_avisos := v_avisos || ('Stock compartido de ' || coalesce(it->>'nombre', '') || ': ' || sqlerrm);
      end;
    end if;
  end loop;

  -- 4) Caja (el saldo lo encadena la base). Cada línea queda ligada a la venta.
  for it in select * from jsonb_array_elements(coalesce(p_caja, '[]'::jsonb)) loop
    if coalesce((it->>'monto')::numeric, 0) <= 0 then continue; end if;
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_id, metodo_pago_nombre, banco_id, monto_moneda_banco, referencia_tipo, referencia_id,
                                         observaciones, fecha, estado)
    values (v_uid, 'INGRESO', 'VENTA', it->>'concepto', round((it->>'monto')::numeric, 2), 0, 0,
            nullif(it->>'metodo_pago_id', '')::uuid, it->>'metodo_pago_nombre', nullif(it->>'banco_id', '')::uuid,
            nullif(it->>'monto_moneda_banco', '')::numeric, 'venta', v_id, nullif(it->>'observaciones', ''),
            coalesce(nullif(it->>'fecha', '')::date, (now() at time zone 'America/Managua')::date), 'completado')
    returning id into v_mov;
    v_movs := v_movs || v_mov;
  end loop;
  if array_length(v_movs, 1) > 0 then update ventas set referencia_caja = v_movs[array_length(v_movs, 1)] where id = v_id; end if;

  -- 5) Historial del cliente
  if p_cliente_total is not null and nullif(p_venta->>'cliente_id', '') is not null then
    update clientes set total_compras = coalesce(total_compras, 0) + p_cliente_total, num_compras = coalesce(num_compras, 0) + 1
     where id = (p_venta->>'cliente_id')::uuid and auth_user_id = v_uid;
  end if;

  -- 6) Fiado ligado a la venta
  if p_fiado is not null and jsonb_typeof(p_fiado) = 'object' then
    perform public._insertar_fila_jsonb('fiados', (p_fiado - 'id') || jsonb_build_object('auth_user_id', v_uid, 'venta_id', v_id));
  end if;

  return jsonb_build_object('venta_id', v_id, 'ya_existia', false, 'caja_ids', to_jsonb(v_movs), 'avisos', to_jsonb(v_avisos));
end $$;
revoke all on function public.venta_registrar_atomica(jsonb, jsonb, jsonb, jsonb, numeric, jsonb) from public, anon;
grant execute on function public.venta_registrar_atomica(jsonb, jsonb, jsonb, jsonb, numeric, jsonb) to authenticated;

-- Sumar/restar existencias sobre el valor REAL (todo o nada). Solo productos de quien está en sesión.
-- p_items = [ {"producto_id":uuid, "delta":n} | {"combo_id":uuid, "delta":n} ]   (delta + suma, - resta; nunca baja de 0)
create or replace function public.ajustar_stock_relativo(p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); it jsonb; ci record; n integer := 0; d numeric;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    d := (it->>'delta')::numeric;
    if d is null or d = 0 then continue; end if;
    if nullif(it->>'combo_id', '') is not null then
      for ci in select * from combo_items where combo_id = (it->>'combo_id')::uuid and auth_user_id = v_uid loop
        update productos set stock_actual = greatest(0, round(coalesce(stock_actual, 0) + ci.cantidad * d, 3))
         where id = ci.producto_id and auth_user_id = v_uid and tipo = 'producto';
        n := n + 1;
      end loop;
    else
      update productos set stock_actual = greatest(0, round(coalesce(stock_actual, 0) + d, 3))
       where id = (it->>'producto_id')::uuid and auth_user_id = v_uid and tipo = 'producto';
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ajustar_stock_relativo(jsonb) from public, anon;
grant execute on function public.ajustar_stock_relativo(jsonb) to authenticated;
