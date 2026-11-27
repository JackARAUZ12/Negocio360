-- Reporte UNIFICADO de dos (o más) grupos de un mismo dueño (ej. ALL PLASTIC Comercial + Mayorista).
-- Aditiva: tablas nuevas + funciones nuevas. No cambia obtener_datos_grupo ni ningún dato existente.
-- Los grupos unificados los crea solo el administrador del sistema (sin acceso desde la app).

create table if not exists public.grupos_unificados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.grupos_unificados_miembros (
  grupo_id uuid not null references public.grupos_unificados(id) on delete cascade,
  auth_user_id_central uuid not null references auth.users(id) on delete cascade,
  etiqueta text,
  orden int not null default 0,
  primary key (grupo_id, auth_user_id_central)
);
create unique index if not exists grupos_unificados_miembros_central_uk on public.grupos_unificados_miembros(auth_user_id_central);
alter table public.grupos_unificados enable row level security;
alter table public.grupos_unificados_miembros enable row level security;
revoke all on public.grupos_unificados, public.grupos_unificados_miembros from anon, authenticated;

-- Central del grupo de una cuenta (misma regla que obtener_datos_grupo).
create or replace function public._grupo_central_de(p_uid uuid)
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid;
begin
  select s.auth_user_id_central into v from public.sucursales s where s.auth_user_id_central = p_uid limit 1;
  if v is null then
    select s.auth_user_id_central into v from public.sucursales s where s.auth_user_id_sucursal = p_uid and s.es_central = false limit 1;
  end if;
  return coalesce(v, p_uid);
end $$;

-- Cuentas (central + sucursales + bodegas) de un grupo.
create or replace function public._grupo_ids_de_central(p_central uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select array(select distinct x from (
    select p_central as x
    union all select s.auth_user_id_sucursal from public.sucursales s where s.auth_user_id_central = p_central and s.auth_user_id_sucursal is not null
  ) q);
$$;

-- Información del grupo unificado de quien llama (null si no pertenece a ninguno).
create or replace function public.grupo_unificado_info()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_central uuid; v_grupo uuid; v_nombre text; r jsonb;
begin
  if auth.uid() is null then return null; end if;
  v_central := public._grupo_central_de(auth.uid());
  select m.grupo_id into v_grupo from public.grupos_unificados_miembros m where m.auth_user_id_central = v_central;
  if v_grupo is null then return null; end if;
  select g.nombre into v_nombre from public.grupos_unificados g where g.id = v_grupo;
  select jsonb_agg(jsonb_build_object(
           'central', m.auth_user_id_central,
           'etiqueta', coalesce(m.etiqueta, (select u.nombre_negocio from public.usuarios u where u.auth_user_id = m.auth_user_id_central)),
           'cuentas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'auth_user_id', s.auth_user_id_sucursal, 'nombre', s.nombre,
                                  'tipo', s.tipo, 'es_central', (s.auth_user_id_sucursal = m.auth_user_id_central), 'activa', s.activa, 'created_at', s.created_at)
                                  order by (s.auth_user_id_sucursal = m.auth_user_id_central) desc, s.tipo, s.created_at)
                                from public.sucursales s where s.auth_user_id_central = m.auth_user_id_central),
                               jsonb_build_array(jsonb_build_object('id', m.auth_user_id_central, 'auth_user_id', m.auth_user_id_central,
                                  'nombre', (select u.nombre_negocio from public.usuarios u where u.auth_user_id = m.auth_user_id_central),
                                  'tipo', 'sucursal', 'es_central', true, 'activa', true)))
         ) order by m.orden, m.etiqueta) into r
    from public.grupos_unificados_miembros m where m.grupo_id = v_grupo;
  return jsonb_build_object('id', v_grupo, 'nombre', v_nombre, 'negocios', r);
end $$;

-- Datos para el Reporte General, POR PÁGINAS (el servidor entrega máx. 1000 filas por consulta).
-- p_unificado = false: el grupo propio (igual que obtener_datos_grupo).
-- p_unificado = true : todos los grupos del grupo unificado de quien llama.
create or replace function public.obtener_datos_grupo_pag(p_tabla text, p_unificado boolean, p_offset integer, p_limit integer)
returns setof jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_central uuid; v_grupo uuid; v_ids uuid[]; c uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if p_tabla not in (
    'ventas','venta_detalles','productos','gastos','gastos_programados','compras','detalle_compras',
    'clientes','creditos','creditos_cuotas','cuentas_por_pagar','cuentas_por_pagar_cuotas',
    'empleados','empleados_pagos','proformas','proforma_detalles','combos',
    'movimientos_financieros','movimientos_impuestos','caja','movimientos_inventario',
    'impuestos','capital_negocio','precios_escala'
  ) then
    raise exception 'Tabla no permitida para el Reporte General: %', p_tabla;
  end if;
  v_central := public._grupo_central_de(auth.uid());
  if coalesce(p_unificado, false) then
    select m.grupo_id into v_grupo from public.grupos_unificados_miembros m where m.auth_user_id_central = v_central;
    if v_grupo is null then raise exception 'Esta cuenta no tiene reporte unificado'; end if;
    v_ids := array[]::uuid[];
    for c in select m.auth_user_id_central from public.grupos_unificados_miembros m where m.grupo_id = v_grupo loop
      v_ids := v_ids || public._grupo_ids_de_central(c);
    end loop;
  else
    v_ids := public._grupo_ids_de_central(v_central);
  end if;
  return query execute format(
    'select to_jsonb(t) from public.%I t where t.auth_user_id = any($1) order by t.id offset $2 limit $3', p_tabla
  ) using v_ids, greatest(coalesce(p_offset, 0), 0), least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;

revoke all on function public._grupo_central_de(uuid), public._grupo_ids_de_central(uuid) from public, anon, authenticated;
revoke all on function public.grupo_unificado_info(), public.obtener_datos_grupo_pag(text, boolean, integer, integer) from public, anon;
grant execute on function public.grupo_unificado_info(), public.obtener_datos_grupo_pag(text, boolean, integer, integer) to authenticated;

-- ALL PLASTIC: Comercial + Mayorista (pedido del 26-11-2026)
insert into public.grupos_unificados (id, nombre)
values ('a11a0000-0000-4000-8000-000000000001', 'ALL PLASTIC (Comercial + Mayorista)')
on conflict (id) do nothing;
insert into public.grupos_unificados_miembros (grupo_id, auth_user_id_central, etiqueta, orden) values
  ('a11a0000-0000-4000-8000-000000000001', '46521033-5d43-40d5-844d-33ca2ff59c14', 'ALL PLASTIC COMERCIAL', 1),
  ('a11a0000-0000-4000-8000-000000000001', '90e89966-68e9-486d-a9c4-9d9000cb76ae', 'ALL PLASTIC MAYORISTA', 2)
on conflict do nothing;
