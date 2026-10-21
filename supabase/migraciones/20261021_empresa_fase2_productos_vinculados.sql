-- =====================================================================
-- EMPRESA VINCULADA — FASE 2: productos vinculados entre negocios
-- Fecha: 21-oct-2026 · Solo AGREGA una tabla y funciones nuevas.
-- No cambia stock, precios, costos ni nombres de ningún producto.
--
-- empresa_productos_vinculo: "este producto de un negocio es el mismo que
-- este otro producto del otro negocio" + la equivalencia:
--   1 unidad de producto_a = factor unidades de producto_b
--   (ej. 1 bulto VASO #12 de Mayorista = 40 paquetes de Comercial)
-- Cada producto puede estar en UN solo vínculo. La usan los traslados
-- entre negocios (fase 3) y la consulta de inventario de la empresa.
-- Solo se escribe por medio de las funciones (validan que los dos
-- productos sean de negocios activos de TU empresa).
-- =====================================================================

create table if not exists public.empresa_productos_vinculo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas_vinculadas(id) on delete cascade,
  producto_a uuid not null references public.productos(id) on delete cascade,
  negocio_a uuid not null,
  producto_b uuid not null references public.productos(id) on delete cascade,
  negocio_b uuid not null,
  factor numeric(14,4) not null check (factor > 0),
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epv_productos_distintos check (producto_a <> producto_b and negocio_a <> negocio_b),
  constraint epv_a_unico unique (producto_a),
  constraint epv_b_unico unique (producto_b)
);
create index if not exists epv_empresa_idx on public.empresa_productos_vinculo (empresa_id);
comment on table public.empresa_productos_vinculo is
  'Producto de un negocio = producto de otro negocio de la misma empresa. 1 de producto_a = factor de producto_b.';

-- Un producto no puede estar como "a" en un vínculo y como "b" en otro.
create or replace function public.epv_un_vinculo_por_producto()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from empresa_productos_vinculo v where v.id <> new.id
               and (v.producto_a in (new.producto_a, new.producto_b) or v.producto_b in (new.producto_a, new.producto_b))) then
    raise exception 'Uno de los productos ya está vinculado con otro producto.';
  end if;
  return new;
end $$;
drop trigger if exists trg_epv_un_vinculo on public.empresa_productos_vinculo;
create trigger trg_epv_un_vinculo before insert or update on public.empresa_productos_vinculo
  for each row execute function public.epv_un_vinculo_por_producto();

alter table public.empresa_productos_vinculo enable row level security;
drop policy if exists epv_leer on public.empresa_productos_vinculo;
create policy epv_leer on public.empresa_productos_vinculo
  for select to authenticated using (empresa_id = public.empresa_id_de_mi_negocio());

-- ¿Este negocio es miembro activo de MI empresa? (incluye al propio)
create or replace function public.empresa_es_de_mi_empresa(p_negocio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from empresa_miembros m
                  where m.auth_user_id = p_negocio and m.activo
                    and m.empresa_id = public.empresa_id_de_mi_negocio())
$$;
revoke all on function public.empresa_es_de_mi_empresa(uuid) from public, anon;
grant execute on function public.empresa_es_de_mi_empresa(uuid) to authenticated;

-- Productos (solo lectura) de un negocio de mi empresa.
create or replace function public.empresa_productos_negocio(p_negocio uuid)
returns table (id uuid, nombre text, sku text, categoria text, costo numeric, precio numeric,
               stock_actual numeric, unidad_medida text, activo boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.empresa_es_de_mi_empresa(p_negocio) then
    raise exception 'Ese negocio no es parte de tu empresa';
  end if;
  return query
    select p.id, p.nombre, p.sku, p.categoria, p.costo, p.precio, p.stock_actual, p.unidad_medida, coalesce(p.activo, true)
      from productos p where p.auth_user_id = p_negocio and p.tipo = 'producto'
     order by p.nombre;
end $$;
revoke all on function public.empresa_productos_negocio(uuid) from public, anon;
grant execute on function public.empresa_productos_negocio(uuid) to authenticated;

-- Guardar vínculos (todo o nada). p_items = [{"producto_a":uuid,"producto_b":uuid,"factor":n}, …]
-- Si el mismo par ya estaba vinculado, solo se actualiza la equivalencia.
create or replace function public.empresa_vincular_productos(p_items jsonb, p_usuario text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.empresa_id_de_mi_negocio();
  it jsonb; a record; b record; f numeric; n integer := 0; v_id uuid;
begin
  if auth.uid() is null or v_emp is null then raise exception 'Tu negocio no es parte de una empresa'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'No hay vínculos para guardar'; end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'Demasiados vínculos en una sola vez (máximo 2000)'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    f := round((it->>'factor')::numeric, 4);
    if f is null or f <= 0 or f > 1000000 then raise exception 'Equivalencia no válida: %', coalesce(it->>'factor', 'vacía'); end if;
    select p.id, p.auth_user_id, p.nombre, p.tipo into a from productos p where p.id = (it->>'producto_a')::uuid;
    select p.id, p.auth_user_id, p.nombre, p.tipo into b from productos p where p.id = (it->>'producto_b')::uuid;
    if a.id is null or b.id is null then raise exception 'Un producto ya no existe'; end if;
    if a.tipo <> 'producto' or b.tipo <> 'producto' then raise exception 'Solo se vinculan productos (no servicios): %', a.nombre; end if;
    if a.auth_user_id = b.auth_user_id then raise exception 'Los dos productos son del mismo negocio: %', a.nombre; end if;
    if not public.empresa_es_de_mi_empresa(a.auth_user_id) or not public.empresa_es_de_mi_empresa(b.auth_user_id) then
      raise exception 'Un producto no es de un negocio de tu empresa';
    end if;
    select v.id into v_id from empresa_productos_vinculo v
     where (v.producto_a = a.id and v.producto_b = b.id) or (v.producto_a = b.id and v.producto_b = a.id);
    if v_id is not null then
      update empresa_productos_vinculo set producto_a = a.id, negocio_a = a.auth_user_id, producto_b = b.id, negocio_b = b.auth_user_id,
             factor = f, creado_por = coalesce(p_usuario, creado_por), updated_at = now()
       where id = v_id;
    else
      insert into empresa_productos_vinculo (empresa_id, producto_a, negocio_a, producto_b, negocio_b, factor, creado_por)
      values (v_emp, a.id, a.auth_user_id, b.id, b.auth_user_id, f, p_usuario);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.empresa_vincular_productos(jsonb, text) from public, anon;
grant execute on function public.empresa_vincular_productos(jsonb, text) to authenticated;

-- Quitar vínculos (solo los de mi empresa). No toca los productos.
create or replace function public.empresa_desvincular_productos(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.empresa_id_de_mi_negocio(); n integer;
begin
  if auth.uid() is null or v_emp is null then raise exception 'Tu negocio no es parte de una empresa'; end if;
  delete from empresa_productos_vinculo where id = any(p_ids) and empresa_id = v_emp;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.empresa_desvincular_productos(uuid[]) from public, anon;
grant execute on function public.empresa_desvincular_productos(uuid[]) to authenticated;
