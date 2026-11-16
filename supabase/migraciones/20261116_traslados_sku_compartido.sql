-- =====================================================================
-- TRASLADOS ENTRE SUCURSALES · SKU compartido por varios productos
-- Problema (Novacell, 16-nov): en la tienda 2 el SKU "A04E-70" lo usan 4 productos distintos
-- (VARÓN, DAMA, SILICON, TRANSPARENTE). Se envió "VARÓN"; en la tienda 1 solo existía "DAMA" con ese
-- SKU y la regla "SKU único en el destino" lo tomó como el mismo producto: la unidad cayó en DAMA.
-- Ahora el SKU (o el código de barras) solo sirve para emparejar con OTRO nombre si en la tienda que
-- envía ese SKU/código también es de un solo producto. Si no hay coincidencia clara, se crea el
-- producto en el destino con su nombre y SKU (como ya se hacía).
-- NO cambia datos existentes: solo la forma de elegir el destino en los traslados futuros.
-- =====================================================================
create or replace function public._traslado_producto_destino(
  p_dest uuid, p_tipo text, p_nombre text, p_sku text, p_barras text, p_origen uuid) returns uuid
language plpgsql stable security definer set search_path = public as $f$
declare
  v_id uuid; v_n integer; v_nn text := public._traslado_nombre_norm(p_nombre);
  v_sku text := nullif(lower(trim(coalesce(p_sku, ''))), ''); v_bar text := nullif(trim(coalesce(p_barras, '')), '');
  v_unico_origen boolean;
begin
  -- 1) Mismo nombre (sin tildes ni signos) Y mismo SKU: es el mismo producto
  if v_sku is not null then
    select p.id into v_id from public.productos p
     where p.auth_user_id = p_dest and p.tipo = p_tipo and lower(trim(p.sku)) = v_sku and public._traslado_nombre_norm(p.nombre) = v_nn
     order by (trim(p.nombre) = trim(p_nombre)) desc, p.created_at, p.id limit 1;
    if v_id is not null then return v_id; end if;
    -- 2) Mismo SKU, ÚNICO en el destino y TAMBIÉN único en la tienda que envía (p. ej. le cambiaron el nombre).
    --    Si en el origen varios productos comparten el SKU, el SKU no identifica al producto: no se usa.
    select count(*) = 1 into v_unico_origen from public.productos p
     where p.auth_user_id = p_origen and p.tipo = p_tipo and lower(trim(p.sku)) = v_sku;
    if v_unico_origen then
      select count(*), (array_agg(p.id order by p.created_at, p.id))[1] into v_n, v_id from public.productos p
       where p.auth_user_id = p_dest and p.tipo = p_tipo and lower(trim(p.sku)) = v_sku;
      if v_n = 1 then return v_id; end if;
    end if;
  end if;
  -- 3) Mismo código de barras (único en el destino y en el origen)
  if v_bar is not null then
    select count(*) = 1 into v_unico_origen from public.productos p
     where p.auth_user_id = p_origen and p.tipo = p_tipo and trim(p.codigo_barras) = v_bar;
    if v_unico_origen then
      select count(*), (array_agg(p.id order by p.created_at, p.id))[1] into v_n, v_id from public.productos p
       where p.auth_user_id = p_dest and p.tipo = p_tipo and trim(p.codigo_barras) = v_bar;
      if v_n = 1 then return v_id; end if;
    end if;
  end if;
  -- 4) Solo por nombre, y únicamente cuando el nombre identifica al producto sin duda (único en origen y en destino)
  select count(*) = 1 into v_unico_origen from public.productos p
   where p.auth_user_id = p_origen and p.tipo = p_tipo and public._traslado_nombre_norm(p.nombre) = v_nn;
  if v_unico_origen then
    select count(*), (array_agg(p.id order by p.created_at, p.id))[1] into v_n, v_id from public.productos p
     where p.auth_user_id = p_dest and p.tipo = p_tipo and public._traslado_nombre_norm(p.nombre) = v_nn;
    if v_n = 1 then return v_id; end if;
  end if;
  return null;
end $f$;
revoke all on function public._traslado_producto_destino(uuid, text, text, text, text, uuid) from public, anon, authenticated;
