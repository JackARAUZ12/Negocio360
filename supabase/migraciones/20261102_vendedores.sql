-- =====================================================================
-- VENDEDORES (2-nov-2026) — "¿Quién vendió?" aunque no tenga usuario + reporte por vendedor.
-- Solo AGREGA. Apagado por defecto (configuracion_empresa.usa_vendedores).
-- CANDADOS:
--   * El vendedor es solo un DATO de la venta: no cambia montos, Caja, inventario, créditos ni contabilidad.
--   * Nunca bloquea una venta: si el vendedor elegido no es válido (de otro negocio, inactivo o borrado),
--     la venta se guarda igual, sin vendedor.
--   * El nombre del vendedor lo pone la base (no la pantalla), así no se puede falsificar.
--   * Los vendedores no se borran: se desactivan (el historial queda intacto).
--   * La lista y el reporte solo se escriben/leen por funciones del servidor del propio negocio.
-- =====================================================================

alter table public.configuracion_empresa add column if not exists usa_vendedores boolean not null default false;
alter table public.configuracion_empresa add column if not exists vendedor_obligatorio boolean not null default false;

create table if not exists public.vendedores (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  nombre text not null check (length(btrim(nombre)) between 2 and 80),
  telefono text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vendedores_nombre_unico on public.vendedores (auth_user_id, lower(btrim(nombre)));
alter table public.vendedores enable row level security;
drop policy if exists vendedores_ver on public.vendedores;
create policy vendedores_ver on public.vendedores for select to authenticated using (auth_user_id = auth.uid());
revoke insert, update, delete on public.vendedores from anon, authenticated;
grant select on public.vendedores to authenticated;

alter table public.ventas add column if not exists vendedor_id uuid references public.vendedores(id) on delete set null;
alter table public.ventas add column if not exists vendedor_nombre text;
create index if not exists ventas_vendedor_idx on public.ventas (auth_user_id, vendedor_id) where vendedor_id is not null;

-- El vendedor de una venta: lo valida y le pone el nombre la base. Nunca bloquea la venta.
create or replace function public._ventas_vendedor_chk()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if tg_op = 'UPDATE' and new.vendedor_id is not distinct from old.vendedor_id and new.vendedor_nombre is not distinct from old.vendedor_nombre then
    return new;
  end if;
  if new.vendedor_id is null then new.vendedor_nombre := null; return new; end if;
  select nombre, activo into v from vendedores where id = new.vendedor_id and auth_user_id = new.auth_user_id;
  if not found or (not v.activo and (tg_op = 'INSERT' or new.vendedor_id is distinct from old.vendedor_id)) then
    new.vendedor_id := null; new.vendedor_nombre := null; return new;
  end if;
  new.vendedor_nombre := v.nombre;
  return new;
end $$;
drop trigger if exists trg_ventas_vendedor_chk on public.ventas;
create trigger trg_ventas_vendedor_chk before insert or update of vendedor_id, vendedor_nombre on public.ventas
  for each row execute function public._ventas_vendedor_chk();

-- Crear / editar / activar / desactivar un vendedor (nunca se borra)
create or replace function public.vendedor_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_nom text; v_tel text; v_act boolean;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not coalesce((select usa_vendedores from configuracion_empresa where auth_user_id = v_uid limit 1), false) then
    return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  begin v_id := nullif(p->>'id', '')::uuid; exception when others then return jsonb_build_object('ok', false, 'motivo', 'datos'); end;
  v_nom := regexp_replace(btrim(coalesce(p->>'nombre', '')), '\s+', ' ', 'g');
  v_tel := left(nullif(btrim(coalesce(p->>'telefono', '')), ''), 30);
  v_act := coalesce((p->>'activo')::boolean, true);
  if length(v_nom) < 2 or length(v_nom) > 80 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if exists (select 1 from vendedores where auth_user_id = v_uid and lower(btrim(nombre)) = lower(v_nom) and id is distinct from v_id) then
    return jsonb_build_object('ok', false, 'motivo', 'nombre_duplicado'); end if;
  if v_id is null then
    insert into vendedores (auth_user_id, nombre, telefono, activo) values (v_uid, v_nom, v_tel, v_act) returning id into v_id;
  else
    update vendedores set nombre = v_nom, telefono = v_tel, activo = v_act, updated_at = now() where id = v_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
    -- El nombre guardado en las ventas sigue al vendedor (solo ese dato; nada de montos)
    update ventas set vendedor_nombre = v_nom where auth_user_id = v_uid and vendedor_id = v_id and vendedor_nombre is distinct from v_nom;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Opciones del negocio (pedir vendedor obligatorio en Ventas)
create or replace function public.vendedores_opciones(p_obligatorio boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  update configuracion_empresa set vendedor_obligatorio = coalesce(p_obligatorio, false) where auth_user_id = v_uid and usa_vendedores;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Cambiar o quitar el vendedor de una venta ya hecha (solo ese dato)
create or replace function public.venta_asignar_vendedor(p_venta_id uuid, p_vendedor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v record;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if not coalesce((select usa_vendedores from configuracion_empresa where auth_user_id = v_uid limit 1), false) then
    return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  select id, estado into v from ventas where id = p_venta_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v.estado <> 'completada' then return jsonb_build_object('ok', false, 'motivo', 'anulada'); end if;
  if p_vendedor_id is not null and not exists (select 1 from vendedores where id = p_vendedor_id and auth_user_id = v_uid and activo) then
    return jsonb_build_object('ok', false, 'motivo', 'vendedor'); end if;
  update ventas set vendedor_id = p_vendedor_id where id = p_venta_id and auth_user_id = v_uid;
  return jsonb_build_object('ok', true, 'vendedor_nombre', (select vendedor_nombre from ventas where id = p_venta_id));
end $$;

-- Reporte por vendedor (solo LEE). Ventas completadas del rango; devoluciones aparte.
create or replace function public.reporte_vendedores(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_res jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta - p_desde > 400 then
    return jsonb_build_object('ok', false, 'motivo', 'fechas'); end if;
  with v as (
    select v.id, v.vendedor_id, v.vendedor_nombre, coalesce(v.total, 0) total, coalesce(v.impuesto, 0) impuesto,
           coalesce(v.costo_total, 0) costo, coalesce(v.descuento, 0) descuento, v.estado_pago
      from ventas v
     where v.auth_user_id = v_uid and v.estado = 'completada'
       and public._n360_dia_venta(v.fecha) between p_desde and p_hasta
  ),
  dev as (
    select d.venta_id, sum(coalesce(d.total, 0)) devuelto from devoluciones_venta d
     where d.auth_user_id = v_uid and d.venta_id in (select id from v) group by 1
  ),
  g as (
    select v.vendedor_id, max(coalesce(vd.nombre, v.vendedor_nombre)) nombre, bool_or(coalesce(vd.activo, true)) activo,
           count(*) ventas, round(sum(v.total), 2) total, round(sum(v.total - v.impuesto), 2) sin_iva,
           round(sum(v.total - v.impuesto - v.costo), 2) ganancia, round(sum(v.descuento), 2) descuentos,
           count(*) filter (where v.estado_pago = 'credito') a_credito, round(coalesce(sum(dev.devuelto), 0), 2) devuelto
      from v left join vendedores vd on vd.id = v.vendedor_id left join dev on dev.venta_id = v.id
     group by v.vendedor_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('vendedor_id', vendedor_id, 'nombre', coalesce(nombre, 'Sin vendedor'), 'activo', activo,
           'ventas', ventas, 'total', total, 'sin_iva', sin_iva, 'ganancia', ganancia, 'descuentos', descuentos,
           'a_credito', a_credito, 'devuelto', devuelto, 'ticket', case when ventas > 0 then round(total / ventas, 2) else 0 end)
         order by (vendedor_id is null), total desc), '[]'::jsonb)
    into v_res from g;
  return jsonb_build_object('ok', true, 'desde', p_desde, 'hasta', p_hasta, 'filas', v_res);
end $$;

revoke all on function public._ventas_vendedor_chk() from public, anon, authenticated;
revoke all on function public.vendedor_guardar(jsonb) from public, anon;
revoke all on function public.vendedores_opciones(boolean) from public, anon;
revoke all on function public.venta_asignar_vendedor(uuid, uuid) from public, anon;
revoke all on function public.reporte_vendedores(date, date) from public, anon;
grant execute on function public.vendedor_guardar(jsonb) to authenticated;
grant execute on function public.vendedores_opciones(boolean) to authenticated;
grant execute on function public.venta_asignar_vendedor(uuid, uuid) to authenticated;
grant execute on function public.reporte_vendedores(date, date) to authenticated;
