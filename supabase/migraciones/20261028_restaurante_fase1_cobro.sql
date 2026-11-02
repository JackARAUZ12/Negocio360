-- =====================================================================
-- Restaurante · Fase 1 — cobro con candados (SOLO AGREGA; no cambia ni borra datos)
--   * La cuenta de una mesa se cobra como una VENTA real (motor de Ventas): Caja, inventario,
--     impuestos, contabilidad y reportes cuadran igual que una venta directa.
--   * Candado de servidor: una mesa solo se puede estar cobrando una vez a la vez, y un platillo
--     ya cobrado no se vuelve a cobrar, ni se cancela, ni se cambia.
--   * Pago dividido real: se cobran solo los platillos (o parte de la cantidad) elegidos; la mesa
--     se cierra sola cuando todo está pagado.
--   * Propina aparte de la venta (no es ingreso por ventas).
--   * Rondas: lo que se pide después de enviar a cocina también llega a cocina.
--   * Quitar un platillo que ya está en cocina queda registrado con su motivo.
-- Las comandas viejas (cobradas antes de esto) no se tocan.
-- =====================================================================

alter table public.restaurante_comanda_items add column if not exists venta_id uuid references public.ventas(id) on delete set null;
alter table public.restaurante_comanda_items add column if not exists cobro_id uuid;
alter table public.restaurante_comanda_items add column if not exists ronda int not null default 1;
alter table public.restaurante_comanda_items add column if not exists motivo_cancelacion text;
alter table public.restaurante_comanda_items add column if not exists cancelado_por text;
alter table public.restaurante_comandas add column if not exists ronda_actual int not null default 1;
create index if not exists restaurante_comanda_items_venta_idx on public.restaurante_comanda_items(venta_id) where venta_id is not null;

-- Cada cobro (total o parcial) de una mesa
create table if not exists public.restaurante_cobros (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  comanda_id uuid not null references public.restaurante_comandas(id) on delete cascade,
  estado text not null default 'reservado' check (estado in ('reservado', 'cobrado', 'liberado')),
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(14,2) not null default 0,
  venta_id uuid references public.ventas(id) on delete set null,
  propina numeric(14,2) not null default 0 check (propina >= 0),
  propina_metodo text,
  creado_por text,
  created_at timestamptz not null default now(),
  cobrado_en timestamptz
);
create index if not exists restaurante_cobros_comanda_idx on public.restaurante_cobros(comanda_id, estado);
create unique index if not exists restaurante_cobros_venta_uniq on public.restaurante_cobros(venta_id) where venta_id is not null;
alter table public.restaurante_cobros enable row level security;
create policy restaurante_cobros_ver_propios on public.restaurante_cobros for select to authenticated using (auth_user_id = (select auth.uid()));
-- Escribir solo por las funciones de abajo (sin políticas de insert/update/delete).

-- ---------------------------------------------------------------------
-- Candado: un platillo cobrado (o en cobro) no se cancela, ni se borra, ni cambia de cantidad o precio.
-- ---------------------------------------------------------------------
create or replace function public._restaurante_item_candado() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_en_cobro boolean;
begin
  if tg_op = 'DELETE' then
    if old.venta_id is not null then raise exception 'restaurante_item_cobrado' using hint = 'Ese platillo ya se cobró.'; end if;
    if old.cobro_id is not null and exists (select 1 from public.restaurante_cobros k where k.id = old.cobro_id and k.estado = 'reservado') then
      raise exception 'restaurante_item_en_cobro' using hint = 'Ese platillo se está cobrando en este momento.'; end if;
    return old;
  end if;
  if new.cantidad is distinct from old.cantidad or new.precio_unitario is distinct from old.precio_unitario
     or new.producto_id is distinct from old.producto_id or (new.estado = 'cancelado' and old.estado <> 'cancelado') then
    if old.venta_id is not null then raise exception 'restaurante_item_cobrado' using hint = 'Ese platillo ya se cobró.'; end if;
    v_en_cobro := old.cobro_id is not null and exists (select 1 from public.restaurante_cobros k where k.id = old.cobro_id and k.estado = 'reservado');
    -- La propia reserva parte una línea (cantidad) antes de marcarla: eso sí se permite.
    if v_en_cobro and current_setting('n360.restaurante_cobro', true) is distinct from 'on' then
      raise exception 'restaurante_item_en_cobro' using hint = 'Ese platillo se está cobrando en este momento.'; end if;
  end if;
  if old.venta_id is not null and new.venta_id is distinct from old.venta_id and current_setting('n360.restaurante_cobro', true) is distinct from 'on' then
    raise exception 'restaurante_item_cobrado' using hint = 'Ese platillo ya se cobró.';
  end if;
  return new;
end $f$;
create trigger restaurante_item_candado before update or delete on public.restaurante_comanda_items
  for each row execute function public._restaurante_item_candado();

-- Una mesa con algo ya cobrado no se puede "cancelar" (se perdería el rastro de lo cobrado).
create or replace function public._restaurante_comanda_candado() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada'
     and exists (select 1 from public.restaurante_comanda_items i where i.comanda_id = old.id and i.venta_id is not null) then
    raise exception 'restaurante_comanda_con_cobros' using hint = 'Esta mesa ya tiene platillos cobrados: no se puede cancelar.';
  end if;
  return new;
end $f$;
create trigger restaurante_comanda_candado before update on public.restaurante_comandas
  for each row execute function public._restaurante_comanda_candado();

-- ---------------------------------------------------------------------
-- 1) Reservar el cobro: aparta los platillos elegidos (parte la línea si se paga solo una parte).
--    p_items: [{"item_id": uuid, "cantidad": n}]  (vacío o null = todo lo pendiente)
-- ---------------------------------------------------------------------
create or replace function public.restaurante_cobro_reservar(p_comanda_id uuid, p_items jsonb default null, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); c record; r record; it jsonb; v_pedidos jsonb := '[]'::jsonb; v_cobro uuid; v_id uuid; v_cant numeric;
  v_lineas jsonb := '[]'::jsonb; v_sub numeric := 0; v_vistos uuid[] := '{}'; v_mesa text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  select * into c from public.restaurante_comandas where id = p_comanda_id and auth_user_id = v_uid for update;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if c.estado not in ('abierta', 'enviada', 'lista') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  -- Reservas olvidadas (más de 15 min sin cobrar) se sueltan solas.
  update public.restaurante_cobros set estado = 'liberado' where comanda_id = c.id and estado = 'reservado' and created_at < now() - interval '15 minutes';
  if exists (select 1 from public.restaurante_cobros where comanda_id = c.id and estado = 'reservado') then
    return jsonb_build_object('ok', false, 'motivo', 'en_cobro');
  end if;
  perform set_config('n360.restaurante_cobro', 'on', true);
  update public.restaurante_comanda_items set cobro_id = null where comanda_id = c.id and cobro_id is not null and venta_id is null;
  -- Qué se cobra (todo lo pendiente si no se dice)
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'cantidad', cantidad) order by created_at), '[]'::jsonb) into v_pedidos
      from public.restaurante_comanda_items where comanda_id = c.id and estado <> 'cancelado' and venta_id is null;
  else v_pedidos := p_items; end if;
  -- Primero se revisa TODO (si algo no se puede, no se toca nada)
  for it in select * from jsonb_array_elements(v_pedidos) loop
    v_id := nullif(it->>'item_id', '')::uuid; v_cant := coalesce(nullif(it->>'cantidad', '')::numeric, 0);
    if v_id is null or v_id = any(v_vistos) then perform set_config('n360.restaurante_cobro', '', true); return jsonb_build_object('ok', false, 'motivo', 'items_invalidos'); end if;
    v_vistos := v_vistos || v_id;
    select * into r from public.restaurante_comanda_items where id = v_id and comanda_id = c.id and auth_user_id = v_uid for update;
    if r.id is null or r.estado = 'cancelado' or r.venta_id is not null then perform set_config('n360.restaurante_cobro', '', true); return jsonb_build_object('ok', false, 'motivo', 'item_no_disponible'); end if;
    if r.producto_id is null then perform set_config('n360.restaurante_cobro', '', true); return jsonb_build_object('ok', false, 'motivo', 'sin_producto', 'nombre', r.nombre_producto); end if;
    if v_cant <= 0 or v_cant > r.cantidad then perform set_config('n360.restaurante_cobro', '', true); return jsonb_build_object('ok', false, 'motivo', 'cantidad_invalida', 'nombre', r.nombre_producto); end if;
  end loop;
  if jsonb_array_length(v_pedidos) = 0 then perform set_config('n360.restaurante_cobro', '', true); return jsonb_build_object('ok', false, 'motivo', 'nada_por_cobrar'); end if;
  insert into public.restaurante_cobros(auth_user_id, comanda_id, creado_por) values (v_uid, c.id, left(p_quien, 120)) returning id into v_cobro;
  for it in select * from jsonb_array_elements(v_pedidos) loop
    select * into r from public.restaurante_comanda_items where id = (it->>'item_id')::uuid;
    v_cant := (it->>'cantidad')::numeric;
    if v_cant < r.cantidad then              -- se paga solo una parte: la línea se parte en dos
      update public.restaurante_comanda_items set cantidad = r.cantidad - v_cant, updated_at = now() where id = r.id;
      insert into public.restaurante_comanda_items(auth_user_id, comanda_id, producto_id, nombre_producto, cantidad, precio_unitario, modificadores, estado, ronda, created_at, updated_at, cobro_id)
      values (r.auth_user_id, r.comanda_id, r.producto_id, r.nombre_producto, v_cant, r.precio_unitario, r.modificadores, r.estado, r.ronda, r.created_at, now(), v_cobro)
      returning id into v_id;
    else
      update public.restaurante_comanda_items set cobro_id = v_cobro where id = r.id; v_id := r.id;
    end if;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('item_id', v_id, 'producto_id', r.producto_id, 'nombre', r.nombre_producto,
      'cantidad', v_cant, 'precio', r.precio_unitario, 'total', round(v_cant * r.precio_unitario, 2)));
    v_sub := v_sub + round(v_cant * r.precio_unitario, 2);
  end loop;
  update public.restaurante_cobros set items = v_lineas, subtotal = round(v_sub, 2) where id = v_cobro;
  perform set_config('n360.restaurante_cobro', '', true);
  select numero into v_mesa from public.restaurante_mesas where id = c.mesa_id;
  return jsonb_build_object('ok', true, 'cobro_id', v_cobro, 'lineas', v_lineas, 'subtotal', round(v_sub, 2), 'mesa', v_mesa);
end $f$;

-- ---------------------------------------------------------------------
-- 2) Confirmar: la venta YA registrada queda ligada a esos platillos. Si ya no queda nada por
--    pagar, la mesa se cierra y pasa a limpieza. Se puede llamar dos veces (no duplica nada).
-- ---------------------------------------------------------------------
create or replace function public.restaurante_cobro_confirmar(p_cobro_id uuid, p_venta_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); k record; c record; v record; v_ids uuid[]; v_cerrada boolean := false; v_ocupados int;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  select * into k from public.restaurante_cobros where id = p_cobro_id and auth_user_id = v_uid for update;
  if k.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  select * into c from public.restaurante_comandas where id = k.comanda_id for update;
  if k.estado = 'cobrado' then
    return jsonb_build_object('ok', k.venta_id = p_venta_id, 'ya', true, 'cerrada', c.estado = 'cerrada', 'motivo', case when k.venta_id <> p_venta_id then 'otra_venta' end);
  end if;
  select id, total, estado, metodo_pago_nombre into v from public.ventas where id = p_venta_id and auth_user_id = v_uid;
  if v.id is null or v.estado = 'anulada' then return jsonb_build_object('ok', false, 'motivo', 'venta_invalida'); end if;
  if exists (select 1 from public.restaurante_cobros where venta_id = p_venta_id and id <> k.id) then return jsonb_build_object('ok', false, 'motivo', 'otra_venta'); end if;
  select array_agg((x->>'item_id')::uuid) into v_ids from jsonb_array_elements(k.items) x;
  -- Si la reserva se soltó (por tiempo) pero la venta sí se hizo: vale solo si esos platillos siguen sin cobrar.
  select count(*) into v_ocupados from public.restaurante_comanda_items where id = any(v_ids) and venta_id is not null and venta_id <> p_venta_id;
  if v_ocupados > 0 then return jsonb_build_object('ok', false, 'motivo', 'conflicto'); end if;
  perform set_config('n360.restaurante_cobro', 'on', true);
  update public.restaurante_comanda_items set venta_id = p_venta_id, cobro_id = k.id, updated_at = now() where id = any(v_ids) and venta_id is null;
  perform set_config('n360.restaurante_cobro', '', true);
  update public.restaurante_cobros set estado = 'cobrado', venta_id = p_venta_id, cobrado_en = now() where id = k.id;
  if not exists (select 1 from public.restaurante_comanda_items where comanda_id = c.id and estado <> 'cancelado' and venta_id is null) then
    update public.restaurante_comandas set estado = 'cerrada', cerrada_at = now(), updated_at = now(),
      total_cobrado = (select coalesce(sum(vv.total), 0) from public.ventas vv where vv.id in (select venta_id from public.restaurante_cobros where comanda_id = c.id and estado = 'cobrado'))
                    + (select coalesce(sum(propina), 0) from public.restaurante_cobros where comanda_id = c.id and estado = 'cobrado'),
      propina_monto = (select coalesce(sum(propina), 0) from public.restaurante_cobros where comanda_id = c.id and estado = 'cobrado'),
      metodo_pago = (select case when count(distinct vv.metodo_pago_nombre) > 1 then 'Varios' else max(vv.metodo_pago_nombre) end
                       from public.ventas vv where vv.id in (select venta_id from public.restaurante_cobros where comanda_id = c.id and estado = 'cobrado'))
     where id = c.id and estado in ('abierta', 'enviada', 'lista');
    update public.restaurante_mesas set estado = 'limpieza', en_este_estado_desde = now(), updated_at = now() where id = c.mesa_id and auth_user_id = v_uid;
    v_cerrada := true;
  end if;
  return jsonb_build_object('ok', true, 'cerrada', v_cerrada);
end $f$;

-- ---------------------------------------------------------------------
-- 3) Propina del cobro: se anota UNA sola vez (antes de registrarla en Caja aparte de la venta).
--    p_monto = 0 la quita (si el registro en Caja falló).
-- ---------------------------------------------------------------------
create or replace function public.restaurante_cobro_propina(p_cobro_id uuid, p_monto numeric, p_metodo text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); k record;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if p_monto is null or p_monto < 0 or p_monto > 1000000 then return jsonb_build_object('ok', false, 'motivo', 'monto_invalido'); end if;
  select * into k from public.restaurante_cobros where id = p_cobro_id and auth_user_id = v_uid for update;
  if k.id is null or k.estado <> 'cobrado' then return jsonb_build_object('ok', false, 'motivo', 'no_cobrado'); end if;
  if p_monto > 0 and k.propina > 0 then return jsonb_build_object('ok', false, 'motivo', 'ya_tiene_propina'); end if;
  update public.restaurante_cobros set propina = round(p_monto, 2), propina_metodo = case when p_monto > 0 then left(p_metodo, 60) end where id = k.id;
  update public.restaurante_comandas set propina_monto = (select coalesce(sum(propina), 0) from public.restaurante_cobros where comanda_id = k.comanda_id and estado = 'cobrado'),
         total_cobrado = case when estado = 'cerrada' then coalesce(total_cobrado, 0) - coalesce(k.propina, 0) + round(p_monto, 2) else total_cobrado end
   where id = k.comanda_id;
  return jsonb_build_object('ok', true);
end $f$;

-- ---------------------------------------------------------------------
-- 4) Soltar un cobro que no se terminó (se cerró la ventana sin cobrar).
-- ---------------------------------------------------------------------
create or replace function public.restaurante_cobro_liberar(p_cobro_id uuid default null, p_comanda_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  update public.restaurante_cobros set estado = 'liberado'
   where auth_user_id = v_uid and estado = 'reservado' and ((p_cobro_id is not null and id = p_cobro_id) or (p_cobro_id is null and comanda_id = p_comanda_id));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'liberados', n);
end $f$;

revoke all on function public._restaurante_item_candado() from public, anon, authenticated;
revoke all on function public._restaurante_comanda_candado() from public, anon, authenticated;
revoke all on function public.restaurante_cobro_reservar(uuid, jsonb, text) from public, anon;
revoke all on function public.restaurante_cobro_confirmar(uuid, uuid) from public, anon;
revoke all on function public.restaurante_cobro_propina(uuid, numeric, text) from public, anon;
revoke all on function public.restaurante_cobro_liberar(uuid, uuid) from public, anon;
grant execute on function public.restaurante_cobro_reservar(uuid, jsonb, text) to authenticated;
grant execute on function public.restaurante_cobro_confirmar(uuid, uuid) to authenticated;
grant execute on function public.restaurante_cobro_propina(uuid, numeric, text) to authenticated;
grant execute on function public.restaurante_cobro_liberar(uuid, uuid) to authenticated;
grant select on public.restaurante_cobros to authenticated;
