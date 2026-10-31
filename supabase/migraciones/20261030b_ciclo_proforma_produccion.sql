-- =====================================================================
-- Ciclo opcional: Proforma aprobada -> Producción -> Inventario -> Venta   (Fase 1)
-- (SOLO AGREGA: una columna con valor por defecto APAGADO, una tabla, dos funciones y una
--  regla nueva. No cambia ninguna función, tabla ni dato existente. Las cuentas que no
--  activen la opción no notan ningún cambio.)
--
-- 1) configuracion_empresa.usa_ciclo_produccion_pedidos (apagada por defecto).
-- 2) proforma_produccion: vínculo entre una proforma y las órdenes de producción que salieron de ella.
-- 3) proforma_pasar_a_produccion(): crea las órdenes PENDIENTES (nunca produce ni mueve inventario).
--    Candados: solo con la opción activa, solo proformas 'aprobada' de la propia cuenta, un producto
--    de la proforma no genera dos órdenes vivas (se bloquea la proforma mientras se crea), solo productos
--    con UNA receta normal activa que no sea de las que se descuentan al vender.
-- 4) Regla en ventas: una venta que viene de una proforma con producción sin terminar
--    (pendiente / en proceso) NO se puede guardar. Así el inventario nunca se descuadra:
--    la venta descuenta lo que producción ya sumó. Con la orden completada o cancelada, pasa normal.
-- =====================================================================

alter table public.configuracion_empresa
  add column if not exists usa_ciclo_produccion_pedidos boolean not null default false;
comment on column public.configuracion_empresa.usa_ciclo_produccion_pedidos is
  'Activa el botón "Pasar a producción" en proformas aprobadas (ciclo proforma -> producción -> inventario -> venta).';

create table if not exists public.proforma_produccion (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  proforma_id  uuid not null references public.proformas(id) on delete cascade,
  producto_id  uuid not null,
  orden_id     uuid not null references public.ordenes_produccion(id) on delete cascade,
  cantidad     numeric not null check (cantidad > 0),
  creado_por   text,
  created_at   timestamptz not null default now()
);
create unique index if not exists proforma_produccion_orden_uq on public.proforma_produccion(orden_id);
create index if not exists proforma_produccion_proforma_idx on public.proforma_produccion(proforma_id);
create index if not exists proforma_produccion_user_idx on public.proforma_produccion(auth_user_id);

alter table public.proforma_produccion enable row level security;
drop policy if exists proforma_produccion_ver on public.proforma_produccion;
create policy proforma_produccion_ver on public.proforma_produccion
  for select using (auth_user_id = (select auth.uid()));
-- Sin políticas de escritura: solo las funciones de abajo escriben aquí.

create or replace function public.proforma_pasar_a_produccion(
  p_proforma_id uuid, p_fecha_entrega date default null, p_usuario text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_uid uuid := auth.uid();
  pf record; l record; r record; v_recs uuid[]; v_activo boolean;
  v_num text; v_n int; v_id uuid; v_mo numeric; v_hoy date := (now() at time zone 'America/Managua')::date;
  v_creadas jsonb := '[]'::jsonb; v_omit jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_pf_prod:' || p_proforma_id::text, 0));

  select * into pf from public.proformas where id = p_proforma_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;

  select coalesce(usa_ciclo_produccion_pedidos, false) into v_activo
    from public.configuracion_empresa where auth_user_id = v_uid;
  if not coalesce(v_activo, false) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;

  if pf.estado <> 'aprobada' then
    return jsonb_build_object('ok', false, 'motivo', 'estado', 'estado', pf.estado);
  end if;

  for l in
    select d.producto_id, sum(d.cantidad) as q, max(d.producto_nombre) as nombre
      from public.proforma_detalles d
     where d.proforma_id = pf.id and d.auth_user_id = v_uid
       and d.tipo_item = 'producto' and d.producto_id is not null
     group by d.producto_id
     order by max(d.producto_nombre)
  loop
    if coalesce(l.q, 0) <= 0 then continue; end if;

    if exists (select 1 from public.proforma_produccion x join public.ordenes_produccion o on o.id = x.orden_id
                where x.proforma_id = pf.id and x.producto_id = l.producto_id and o.estado <> 'cancelada') then
      v_omit := v_omit || jsonb_build_object('producto', l.nombre, 'motivo', 'ya_tiene');
      continue;
    end if;

    if not exists (select 1 from public.productos where id = l.producto_id and auth_user_id = v_uid and tipo = 'producto') then
      v_omit := v_omit || jsonb_build_object('producto', l.nombre, 'motivo', 'sin_producto');
      continue;
    end if;

    select array_agg(id) into v_recs from public.recetas_produccion
     where auth_user_id = v_uid and producto_terminado_id = l.producto_id
       and coalesce(activa, true) and coalesce(tipo, 'normal') = 'normal' and coalesce(al_vender, false) = false;
    if v_recs is null or array_length(v_recs, 1) = 0 then
      v_omit := v_omit || jsonb_build_object('producto', l.nombre, 'motivo', 'sin_receta');
      continue;
    end if;
    if array_length(v_recs, 1) > 1 then
      v_omit := v_omit || jsonb_build_object('producto', l.nombre, 'motivo', 'varias_recetas');
      continue;
    end if;

    select * into r from public.recetas_produccion where id = v_recs[1];
    v_mo := round(coalesce(r.costo_extra_tanda, 0) * l.q / nullif(coalesce(r.cantidad_producida, 1), 0), 2);

    -- Número de orden: el de siempre; si por casualidad ya existe, se sigue al siguiente libre.
    v_num := public.generar_numero_orden_produccion(v_uid);
    v_n := coalesce(nullif(substring(v_num from '(\d+)$'), '')::int, 0);
    while exists (select 1 from public.ordenes_produccion where auth_user_id = v_uid and numero = v_num) loop
      v_n := v_n + 1;
      v_num := 'OP-' || lpad(v_n::text, 6, '0');
    end loop;

    insert into public.ordenes_produccion(auth_user_id, numero, tipo, receta_id, producto_terminado_id,
      cantidad_planificada, fecha_planificada, fecha_entrega, costo_mano_obra, costo_indirecto, merma_cantidad,
      usuario_nombre, estado, observaciones)
    values (v_uid, v_num, 'normal', r.id, r.producto_terminado_id, l.q, v_hoy, p_fecha_entrega,
      coalesce(v_mo, 0), 0, 0, left(coalesce(nullif(btrim(p_usuario), ''), 'Usuario'), 120), 'pendiente',
      left('Proforma ' || pf.numero_proforma || ' · ' || coalesce(pf.cliente_nombre, 'Cliente final'), 300))
    returning id into v_id;

    insert into public.proforma_produccion(auth_user_id, proforma_id, producto_id, orden_id, cantidad, creado_por)
    values (v_uid, pf.id, l.producto_id, v_id, l.q, left(nullif(btrim(p_usuario), ''), 120));

    v_creadas := v_creadas || jsonb_build_object('orden_id', v_id, 'numero', v_num, 'producto', l.nombre, 'cantidad', l.q);
  end loop;

  return jsonb_build_object('ok', true, 'creadas', v_creadas, 'omitidas', v_omit);
end;
$f$;

revoke all on function public.proforma_pasar_a_produccion(uuid, date, text) from public, anon;
grant execute on function public.proforma_pasar_a_produccion(uuid, date, text) to authenticated;

-- Candado: no se convierte en venta una proforma cuya producción no ha terminado.
create or replace function public.ventas_candado_produccion_proforma()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
begin
  if new.proforma_id is not null and coalesce(new.estado, 'completada') = 'completada' then
    if exists (select 1 from public.proforma_produccion l
                 join public.ordenes_produccion o on o.id = l.orden_id
                where l.proforma_id = new.proforma_id and o.estado in ('pendiente', 'en_proceso')) then
      raise exception 'Esta proforma tiene producción sin terminar. Completa o cancela la orden de producción antes de convertirla en venta.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_ventas_candado_produccion_proforma on public.ventas;
create trigger trg_ventas_candado_produccion_proforma
  before insert on public.ventas
  for each row execute function public.ventas_candado_produccion_proforma();
