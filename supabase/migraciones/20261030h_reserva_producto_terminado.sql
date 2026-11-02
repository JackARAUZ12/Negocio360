-- =====================================================================
-- Ciclo opcional (Fase 3d): RESERVA del producto terminado para el pedido.
-- SOLO AGREGA: una opción apagada, una tabla, tres funciones y un candado en venta_detalles.
--
-- Qué hace: cuando termina la producción de un pedido, el producto queda RESERVADO para esa proforma.
-- Otra venta no puede llevarse esas unidades: puede vender solo (existencia - reservado por otros pedidos).
-- La reserva NO mueve inventario, Caja ni costos; solo limita ventas de otras personas.
--
-- Candados:
--  * Una reserva cuenta mientras la proforma NO esté convertida/rechazada/a crédito (al convertir, el stock se
--    descuenta de verdad y la reserva deja de contar sola, sin riesgo de contarla dos veces).
--  * Nunca se reserva más que lo disponible (existencia menos lo ya reservado por otros pedidos).
--  * El candado de venta_detalles revisa ANTES de que se descuente el stock (así lo hace venta_registrar_atomica),
--    suma las líneas del mismo producto de la misma venta, y no interviene en la venta de la propia proforma.
--  * Sin la opción encendida, o sin ninguna reserva activa, el candado no hace nada.
-- =====================================================================

alter table public.configuracion_empresa
  add column if not exists usa_reserva_producto_terminado boolean not null default false;

create table if not exists public.producto_reservas (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  proforma_id  uuid not null references public.proformas(id) on delete cascade,
  producto_id  uuid not null references public.productos(id) on delete cascade,
  cantidad     numeric(14,3) not null check (cantidad > 0),
  estado       text not null default 'activa' check (estado in ('activa', 'liberada')),
  created_at   timestamptz not null default now(),
  liberada_at  timestamptz
);
create unique index if not exists producto_reservas_unica_activa on public.producto_reservas(proforma_id, producto_id) where estado = 'activa';
create index if not exists producto_reservas_prod_idx on public.producto_reservas(producto_id) where estado = 'activa';
create index if not exists producto_reservas_user_idx on public.producto_reservas(auth_user_id);
alter table public.producto_reservas enable row level security;
drop policy if exists producto_reservas_ver on public.producto_reservas;
create policy producto_reservas_ver on public.producto_reservas for select using (auth_user_id = (select auth.uid()));

-- Reservado vigente de un producto, sin contar la proforma indicada (puede ser null).
create or replace function public._reservado_otros(p_uid uuid, p_producto uuid, p_excluir_proforma uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $f$
  select coalesce(sum(r.cantidad), 0)
    from public.producto_reservas r join public.proformas pf on pf.id = r.proforma_id
   where r.auth_user_id = p_uid and r.producto_id = p_producto and r.estado = 'activa'
     and pf.estado not in ('convertida', 'rechazada', 'pago_parcial')
     and r.proforma_id is distinct from p_excluir_proforma;
$f$;
revoke all on function public._reservado_otros(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._proforma_reservar_calc(p_uid uuid, p_proforma_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare l record; v_disp numeric; v_q numeric; v_creadas jsonb := '[]'::jsonb; v_parciales jsonb := '[]'::jsonb;
begin
  for l in
    select d.producto_id, sum(d.cantidad) q, max(d.producto_nombre) nombre
      from public.proforma_detalles d
     where d.proforma_id = p_proforma_id and d.auth_user_id = p_uid and d.tipo_item = 'producto' and d.producto_id is not null
       and exists (select 1 from public.proforma_produccion x join public.ordenes_produccion o on o.id = x.orden_id
                    where x.proforma_id = d.proforma_id and x.producto_id = d.producto_id and o.estado = 'completada')
     group by d.producto_id order by max(d.producto_nombre)
  loop
    if exists (select 1 from public.producto_reservas where proforma_id = p_proforma_id and producto_id = l.producto_id and estado = 'activa') then continue; end if;
    select greatest(0, coalesce(stock_actual, 0) - public._reservado_otros(p_uid, l.producto_id, p_proforma_id)) into v_disp
      from public.productos where id = l.producto_id and auth_user_id = p_uid;
    v_q := least(l.q, coalesce(v_disp, 0));
    if v_q <= 0 then v_parciales := v_parciales || jsonb_build_object('producto', l.nombre, 'pedido', l.q, 'reservado', 0); continue; end if;
    insert into public.producto_reservas(auth_user_id, proforma_id, producto_id, cantidad) values (p_uid, p_proforma_id, l.producto_id, v_q);
    v_creadas := v_creadas || jsonb_build_object('producto', l.nombre, 'cantidad', v_q);
    if v_q < l.q then v_parciales := v_parciales || jsonb_build_object('producto', l.nombre, 'pedido', l.q, 'reservado', v_q); end if;
  end loop;
  return jsonb_build_object('creadas', v_creadas, 'parciales', v_parciales);
end;
$f$;
revoke all on function public._proforma_reservar_calc(uuid, uuid) from public, anon, authenticated;

create or replace function public.proforma_reservar(p_proforma_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_uid uuid := auth.uid(); v_a boolean; v_b boolean; pf record; r jsonb;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_reserva:' || v_uid::text, 0));
  select coalesce(usa_ciclo_produccion_pedidos, false), coalesce(usa_reserva_producto_terminado, false) into v_a, v_b
    from public.configuracion_empresa where auth_user_id = v_uid;
  if not (coalesce(v_a, false) and coalesce(v_b, false)) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  select * into pf from public.proformas where id = p_proforma_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if pf.estado in ('convertida', 'rechazada', 'pago_parcial') then return jsonb_build_object('ok', false, 'motivo', 'estado', 'estado', pf.estado); end if;
  r := public._proforma_reservar_calc(v_uid, pf.id);
  return jsonb_build_object('ok', true) || r;
end;
$f$;
revoke all on function public.proforma_reservar(uuid) from public, anon;
grant execute on function public.proforma_reservar(uuid) to authenticated;

-- Al completar una orden de producción: reserva para las proformas que la pidieron.
create or replace function public.proforma_reservar_por_orden(p_orden_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_uid uuid := auth.uid(); x record; r jsonb; v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  for x in select distinct l.proforma_id from public.proforma_produccion l
            where l.orden_id = p_orden_id and l.auth_user_id = v_uid loop
    r := public.proforma_reservar(x.proforma_id);
    if (r ->> 'ok')::boolean then v_out := v_out || (r || jsonb_build_object('proforma_id', x.proforma_id)); end if;
  end loop;
  return jsonb_build_object('ok', true, 'proformas', v_out);
end;
$f$;
revoke all on function public.proforma_reservar_por_orden(uuid) from public, anon;
grant execute on function public.proforma_reservar_por_orden(uuid) to authenticated;

create or replace function public.proforma_liberar_reserva(p_proforma_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_reserva:' || v_uid::text, 0));
  update public.producto_reservas set estado = 'liberada', liberada_at = now()
   where proforma_id = p_proforma_id and auth_user_id = v_uid and estado = 'activa';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'liberadas', n);
end;
$f$;
revoke all on function public.proforma_liberar_reserva(uuid) from public, anon;
grant execute on function public.proforma_liberar_reserva(uuid) to authenticated;

-- Candado: una venta no puede llevarse lo reservado para otros pedidos.
create or replace function public._venta_detalles_candado_reserva()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_on boolean; v_prof uuid; v_res numeric; v_stock numeric; v_ya numeric; v_det text;
begin
  if new.producto_id is null or coalesce(new.cantidad, 0) <= 0 then return new; end if;
  if not exists (select 1 from public.producto_reservas where producto_id = new.producto_id and estado = 'activa') then return new; end if;
  select coalesce(usa_reserva_producto_terminado, false) into v_on from public.configuracion_empresa where auth_user_id = new.auth_user_id;
  if not coalesce(v_on, false) then return new; end if;
  if coalesce(new.vendido_sin_stock, false) then return new; end if;
  select proforma_id into v_prof from public.ventas where id = new.venta_id;
  v_res := public._reservado_otros(new.auth_user_id, new.producto_id, v_prof);
  if v_res <= 0 then return new; end if;
  select coalesce(stock_actual, 0) into v_stock from public.productos where id = new.producto_id and auth_user_id = new.auth_user_id;
  select coalesce(sum(cantidad), 0) into v_ya from public.venta_detalles where venta_id = new.venta_id and producto_id = new.producto_id;
  if v_ya + new.cantidad > v_stock - v_res + 0.0001 then
    select string_agg(distinct pf.numero_proforma, ', ') into v_det
      from public.producto_reservas r join public.proformas pf on pf.id = r.proforma_id
     where r.producto_id = new.producto_id and r.estado = 'activa' and r.auth_user_id = new.auth_user_id
       and pf.estado not in ('convertida', 'rechazada', 'pago_parcial') and r.proforma_id is distinct from v_prof;
    raise exception 'No hay suficiente disponible de "%": % unidades están reservadas para pedidos (%). Disponible para vender: %.',
      coalesce(new.producto_nombre, 'producto'), v_res, v_det, greatest(0, v_stock - v_res) using errcode = 'P0001';
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_venta_detalles_candado_reserva on public.venta_detalles;
create trigger trg_venta_detalles_candado_reserva before insert on public.venta_detalles
  for each row execute function public._venta_detalles_candado_reserva();
