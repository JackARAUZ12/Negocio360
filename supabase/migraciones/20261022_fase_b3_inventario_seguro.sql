-- =====================================================================
-- FASE B3 (auditoría 21-oct-2026) · Fecha: 22-oct-2026 · Solo AGREGA.
-- Inventario seguro en los módulos que todavía escribían la existencia
-- con un número calculado en la página ("había 100, guardo 95"). Si dos
-- personas movían el mismo producto a la vez, una pisaba a la otra.
-- Estas funciones cambian la existencia DENTRO de la base, sobre el valor
-- real del momento y con el producto bloqueado mientras tanto.
--   * ajustar_stock_producto: suma/resta y devuelve antes/después
--     (para mermas, lotes, anulación de compras, etc.).
--   * stock_fijar: el usuario escribe "hay N" (editar producto). Si nadie
--     movió el producto mientras editaba, queda N; si hubo una venta en
--     ese rato, se aplica la diferencia que el usuario hizo sobre lo real
--     (no se pierde la venta).
--   * stock_entrada_costo: entrada de mercadería con costo promedio
--     ponderado calculado sobre la existencia y el costo REALES.
-- Ya existía: ajustar_stock_relativo (varios productos/combos a la vez).
-- =====================================================================

create or replace function public.ajustar_stock_producto(p_producto_id uuid, p_delta numeric, p_exigir_existencia boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_antes numeric; v_despues numeric;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  select coalesce(stock_actual, 0) into v_antes from productos
   where id = p_producto_id and auth_user_id = v_uid and tipo = 'producto' for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if p_exigir_existencia and v_antes + coalesce(p_delta, 0) < -0.0005 then
    raise exception 'No hay suficiente existencia: hay % disponibles.', round(v_antes, 3) using errcode = 'P0001';
  end if;
  v_despues := greatest(0, round(v_antes + coalesce(p_delta, 0), 3));
  update productos set stock_actual = v_despues, updated_at = now() where id = p_producto_id;
  return jsonb_build_object('antes', v_antes, 'despues', v_despues);
end $$;
revoke all on function public.ajustar_stock_producto(uuid, numeric, boolean) from public, anon;
grant execute on function public.ajustar_stock_producto(uuid, numeric, boolean) to authenticated;

create or replace function public.stock_fijar(p_producto_id uuid, p_esperado numeric, p_nuevo numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_antes numeric; v_despues numeric; v_cambio boolean;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if p_nuevo is null or p_nuevo < 0 then raise exception 'La existencia no puede ser negativa'; end if;
  select coalesce(stock_actual, 0) into v_antes from productos
   where id = p_producto_id and auth_user_id = v_uid and tipo = 'producto' for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  v_cambio := p_esperado is not null and abs(v_antes - p_esperado) > 0.0005;
  v_despues := case when v_cambio then greatest(0, round(v_antes + (p_nuevo - p_esperado), 3)) else round(p_nuevo, 3) end;
  if v_despues is distinct from v_antes then
    update productos set stock_actual = v_despues, updated_at = now() where id = p_producto_id;
  end if;
  return jsonb_build_object('antes', v_antes, 'despues', v_despues, 'hubo_movimiento_en_medio', v_cambio);
end $$;
revoke all on function public.stock_fijar(uuid, numeric, numeric) from public, anon;
grant execute on function public.stock_fijar(uuid, numeric, numeric) to authenticated;

create or replace function public.stock_entrada_costo(p_producto_id uuid, p_cantidad numeric, p_costo_unitario numeric, p_promediar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p record; v_antes numeric; v_despues numeric; v_costo_antes numeric; v_costo numeric;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if coalesce(p_cantidad, 0) <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select * into p from productos where id = p_producto_id and auth_user_id = v_uid and tipo = 'producto' for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  v_antes := coalesce(p.stock_actual, 0);
  v_costo_antes := coalesce(p.costo, 0);
  v_despues := round(v_antes + p_cantidad, 3);
  -- Misma fórmula que usaba la página: (stock_antes×costo_antes + cantidad×costo_compra) / stock_después
  v_costo := case
    when not p_promediar or p.tipo_costo = 'escala' then v_costo_antes
    when v_despues > 0 then round((v_antes * v_costo_antes + p_cantidad * coalesce(p_costo_unitario, 0)) / v_despues, 2)
    else coalesce(p_costo_unitario, v_costo_antes) end;
  update productos set stock_actual = v_despues, costo = v_costo, updated_at = now() where id = p_producto_id;
  return jsonb_build_object('antes', v_antes, 'despues', v_despues, 'costo_antes', v_costo_antes, 'costo_nuevo', v_costo);
end $$;
revoke all on function public.stock_entrada_costo(uuid, numeric, numeric, boolean) from public, anon;
grant execute on function public.stock_entrada_costo(uuid, numeric, numeric, boolean) to authenticated;
