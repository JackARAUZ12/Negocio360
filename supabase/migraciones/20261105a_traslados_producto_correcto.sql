-- =====================================================================
-- TRASLADOS ENTRE SUCURSALES · el producto de destino se busca bien
-- Problema: "Mover producto" y "Traslado en lote" buscaban el producto en la sucursal destino SOLO por el nombre y
-- tomaban el primero que coincidía. Con productos de nombre repetido (p. ej. 33 "GLASS", uno por modelo de celular)
-- el stock caía en OTRO modelo y en la sucursal no aparecía lo enviado.
-- Ahora: 1) mismo nombre + mismo SKU, 2) SKU único, 3) código de barras único, 4) nombre solo si identifica al producto sin duda.
-- Si no hay coincidencia clara, se CREA el producto en el destino (con su SKU), como ya se hacía cuando no existía.
-- NO cambia datos existentes: solo la forma de elegir el destino en los traslados futuros.
-- =====================================================================
create or replace function public._traslado_nombre_norm(p text) returns text
language sql immutable set search_path = public as $f$
  select trim(regexp_replace(translate(lower(coalesce(p, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', ' ', 'g'));
$f$;
revoke all on function public._traslado_nombre_norm(text) from public, anon, authenticated;

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
    -- 2) Mismo SKU y es el ÚNICO con ese SKU en el destino (p. ej. si le cambiaron el nombre)
    select count(*), (array_agg(p.id order by p.created_at, p.id))[1] into v_n, v_id from public.productos p
     where p.auth_user_id = p_dest and p.tipo = p_tipo and lower(trim(p.sku)) = v_sku;
    if v_n = 1 then return v_id; end if;
  end if;
  -- 3) Mismo código de barras (si es el único con ese código)
  if v_bar is not null then
    select count(*), (array_agg(p.id order by p.created_at, p.id))[1] into v_n, v_id from public.productos p
     where p.auth_user_id = p_dest and p.tipo = p_tipo and trim(p.codigo_barras) = v_bar;
    if v_n = 1 then return v_id; end if;
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

create or replace function public.mover_stock_producto(p_producto_id uuid, p_sucursal_destino_id uuid, p_cantidad numeric)
 returns void
 language plpgsql
 security definer
as $function$
declare
  v_origen uuid := auth.uid();
  v_grupo_origen uuid;
  v_grupo_destino uuid;
  v_auth_destino uuid;
  v_producto record;
  v_existente_id uuid;
  v_existente_stock numeric;
  v_escala record;
begin
  if v_origen is null then
    raise exception 'No hay sesión activa.';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a mover debe ser mayor a cero.';
  end if;

  select s.auth_user_id_central into v_grupo_origen
    from public.sucursales s where s.auth_user_id_central = v_origen limit 1;
  if v_grupo_origen is null then
    select s.auth_user_id_central into v_grupo_origen
      from public.sucursales s where s.auth_user_id_sucursal = v_origen and s.es_central = false limit 1;
  end if;

  select s.auth_user_id_central, s.auth_user_id_sucursal into v_grupo_destino, v_auth_destino
    from public.sucursales s where s.id = p_sucursal_destino_id;

  if v_grupo_origen is null or v_grupo_destino is null or v_grupo_origen <> v_grupo_destino then
    raise exception 'No autorizado: el destino no pertenece a tu mismo grupo de sucursales.';
  end if;
  if v_auth_destino = v_origen then
    raise exception 'No puedes mover un producto hacia la misma cuenta desde la que lo envías.';
  end if;

  select * into v_producto from public.productos where id = p_producto_id and auth_user_id = v_origen;
  if v_producto is null then
    raise exception 'Producto no encontrado en tu inventario.';
  end if;
  if v_producto.tipo <> 'producto' then
    raise exception 'Solo se pueden mover productos físicos, los servicios no aplican.';
  end if;
  if coalesce(v_producto.stock_actual, 0) < p_cantidad then
    raise exception 'Stock insuficiente: solo tienes % disponibles.', coalesce(v_producto.stock_actual,0);
  end if;

  update public.productos set stock_actual = stock_actual - p_cantidad, updated_at = now()
    where id = p_producto_id;

  insert into public.movimientos_inventario
    (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
  values
    (v_origen, p_producto_id, 'salida', 'transferencia_sucursal', p_cantidad,
     v_producto.stock_actual, v_producto.stock_actual - p_cantidad, 'Enviado a otra sucursal/bodega del grupo');

  -- El producto de destino se busca por SKU, luego código de barras y, si no hay duda, por nombre
  v_existente_id := public._traslado_producto_destino(v_auth_destino, 'producto', v_producto.nombre, v_producto.sku, v_producto.codigo_barras, v_origen);
  if v_existente_id is not null then
    select stock_actual into v_existente_stock from public.productos where id = v_existente_id;
  end if;

  if v_existente_id is not null then
    update public.productos set stock_actual = coalesce(stock_actual,0) + p_cantidad, updated_at = now()
      where id = v_existente_id;
    insert into public.movimientos_inventario
      (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
    values
      (v_auth_destino, v_existente_id, 'entrada', 'transferencia_sucursal', p_cantidad,
       coalesce(v_existente_stock,0), coalesce(v_existente_stock,0) + p_cantidad, 'Recibido de otra sucursal/bodega del grupo');

    if v_producto.tipo_precio = 'escala' then
      for v_escala in select * from public.precios_escala where producto_id = p_producto_id loop
        if not exists (
          select 1 from public.precios_escala pe
          where pe.producto_id = v_existente_id and lower(pe.nombre) = lower(v_escala.nombre)
        ) then
          insert into public.precios_escala (auth_user_id, producto_id, nombre, precio, orden, cantidad_minima)
          values (v_auth_destino, v_existente_id, v_escala.nombre, v_escala.precio, v_escala.orden, v_escala.cantidad_minima);
        end if;
      end loop;
      update public.productos set tipo_precio = 'escala' where id = v_existente_id;
    end if;
  else
    insert into public.productos
      (auth_user_id, nombre, sku, codigo_barras, tipo, categoria, descripcion, costo, precio, stock_actual, stock_minimo, activo, tipo_precio)
    values
      (v_auth_destino, v_producto.nombre, v_producto.sku, v_producto.codigo_barras, 'producto', v_producto.categoria,
       v_producto.descripcion, v_producto.costo, v_producto.precio, p_cantidad, v_producto.stock_minimo, true, coalesce(v_producto.tipo_precio,'fijo'))
    returning id into v_existente_id;
    insert into public.movimientos_inventario
      (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
    values
      (v_auth_destino, v_existente_id, 'entrada', 'transferencia_sucursal', p_cantidad,
       0, p_cantidad, 'Producto nuevo recibido de otra sucursal/bodega del grupo');

    if v_producto.tipo_precio = 'escala' then
      for v_escala in select * from public.precios_escala where producto_id = p_producto_id loop
        insert into public.precios_escala (auth_user_id, producto_id, nombre, precio, orden, cantidad_minima)
        values (v_auth_destino, v_existente_id, v_escala.nombre, v_escala.precio, v_escala.orden, v_escala.cantidad_minima);
      end loop;
    end if;
  end if;
end;
$function$;

create or replace function public.trasladar_stock_lote(p_sucursal_destino_id uuid, p_items jsonb, p_nota text DEFAULT NULL::text, p_copiar_servicios boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_origen uuid := auth.uid();
  v_grupo_origen uuid; v_grupo_destino uuid; v_auth_destino uuid; v_dest_nombre text;
  v_item record; v_prod record; v_dest_id uuid; v_dest_stock numeric; v_creado boolean;
  v_escala record; v_numero text; v_tid uuid;
  v_n integer := 0; v_unidades numeric := 0; v_costo numeric := 0; v_serv integer := 0;
begin
  if v_origen is null then raise exception 'No hay sesión activa.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige al menos un producto para trasladar.';
  end if;
  if jsonb_array_length(p_items) > 3000 then
    raise exception 'Demasiados productos en un solo traslado (máximo 3000). Divídelo en dos.';
  end if;

  select s.auth_user_id_central into v_grupo_origen from public.sucursales s where s.auth_user_id_central = v_origen limit 1;
  if v_grupo_origen is null then
    select s.auth_user_id_central into v_grupo_origen from public.sucursales s
      where s.auth_user_id_sucursal = v_origen and s.es_central = false limit 1;
  end if;
  select s.auth_user_id_central, s.auth_user_id_sucursal, s.nombre
    into v_grupo_destino, v_auth_destino, v_dest_nombre
    from public.sucursales s where s.id = p_sucursal_destino_id;
  if v_grupo_origen is null or v_grupo_destino is null or v_grupo_origen <> v_grupo_destino then
    raise exception 'No autorizado: el destino no pertenece a tu mismo grupo de sucursales.';
  end if;
  if v_auth_destino is null or v_auth_destino = v_origen then
    raise exception 'No puedes trasladar hacia la misma cuenta desde la que envías.';
  end if;

  if exists (select 1 from jsonb_array_elements(p_items) e group by e->>'producto_id' having count(*) > 1) then
    raise exception 'Hay productos repetidos en la lista del traslado.';
  end if;

  perform pg_advisory_xact_lock(hashtext('traslado:' || v_origen::text));

  -- PASO 1: validar TODO antes de mover nada (y bloquear las filas en orden fijo)
  for v_item in
    select (e->>'producto_id')::uuid as pid, coalesce((e->>'cantidad')::numeric, 0) as cant
    from jsonb_array_elements(p_items) e order by 1
  loop
    select * into v_prod from public.productos where id = v_item.pid and auth_user_id = v_origen for update;
    if not found then raise exception 'Un producto de la lista no existe en tu inventario.'; end if;
    if v_prod.tipo = 'producto' then
      if v_item.cant <= 0 then raise exception 'La cantidad de "%" debe ser mayor a cero.', v_prod.nombre; end if;
      if coalesce(v_prod.stock_actual, 0) < v_item.cant then
        raise exception 'Stock insuficiente de "%": tienes % y quieres trasladar %.', v_prod.nombre, coalesce(v_prod.stock_actual,0), v_item.cant;
      end if;
      if coalesce(v_prod.requiere_numero_serie, false) then
        raise exception '"%" maneja números de serie; todavía no se puede trasladar en lote.', v_prod.nombre;
      end if;
      if coalesce(v_prod.es_sustancia_controlada, false) then
        raise exception '"%" es sustancia controlada; no se puede trasladar en lote.', v_prod.nombre;
      end if;
      if exists (select 1 from public.producto_lotes l where l.producto_id = v_prod.id and coalesce(l.activo, true) and coalesce(l.cantidad_actual, 0) > 0) then
        raise exception '"%" maneja lotes con vencimiento; todavía no se puede trasladar.', v_prod.nombre;
      end if;
    elsif v_prod.tipo = 'servicio' then
      if not coalesce(p_copiar_servicios, false) then
        raise exception 'Los servicios no tienen stock. Activa "copiar servicios al catálogo del destino" o quítalos de la lista.';
      end if;
    else
      raise exception '"%" no es un producto ni un servicio trasladable.', v_prod.nombre;
    end if;
  end loop;

  -- Encabezado del traslado
  v_numero := 'TR-' || lpad(((select count(*) from public.traslados_inventario where auth_user_id = v_origen) + 1)::text, 4, '0');
  insert into public.traslados_inventario
    (auth_user_id, numero, sucursal_destino_id, auth_user_destino, destino_nombre, nota)
  values (v_origen, v_numero, p_sucursal_destino_id, v_auth_destino, v_dest_nombre, nullif(trim(coalesce(p_nota,'')), ''))
  returning id into v_tid;

  -- PASO 2: aplicar
  for v_item in
    select (e->>'producto_id')::uuid as pid, coalesce((e->>'cantidad')::numeric, 0) as cant
    from jsonb_array_elements(p_items) e order by 1
  loop
    select * into v_prod from public.productos where id = v_item.pid and auth_user_id = v_origen;

    -- El producto de destino se busca por SKU, luego código de barras y, si no hay duda, por nombre
    v_dest_id := public._traslado_producto_destino(v_auth_destino, v_prod.tipo, v_prod.nombre, v_prod.sku, v_prod.codigo_barras, v_origen);
    v_dest_stock := null;
    if v_dest_id is not null then
      select stock_actual into v_dest_stock from public.productos where id = v_dest_id;
    end if;
    v_creado := false;

    if v_prod.tipo = 'servicio' then
      if v_dest_id is null then
        insert into public.productos
          (auth_user_id, tipo, nombre, descripcion, categoria, sku, codigo_barras, costo, precio, stock_actual, stock_minimo,
           activo, tipo_precio, garantia_meses, modelo, unidad_medida, unidad_codigo, permite_fraccion, imagen_url)
        values
          (v_auth_destino, 'servicio', v_prod.nombre, v_prod.descripcion, v_prod.categoria, v_prod.sku, v_prod.codigo_barras,
           v_prod.costo, v_prod.precio, 0, 0, true, coalesce(v_prod.tipo_precio,'fijo'), v_prod.garantia_meses, v_prod.modelo,
           v_prod.unidad_medida, v_prod.unidad_codigo, v_prod.permite_fraccion, v_prod.imagen_url)
        returning id into v_dest_id;
        if v_prod.tipo_precio = 'escala' then
          for v_escala in select * from public.precios_escala where producto_id = v_prod.id loop
            insert into public.precios_escala (auth_user_id, producto_id, nombre, precio, orden, cantidad_minima)
            values (v_auth_destino, v_dest_id, v_escala.nombre, v_escala.precio, v_escala.orden, v_escala.cantidad_minima);
          end loop;
        end if;
        v_creado := true;
      end if;
      insert into public.traslados_inventario_items
        (traslado_id, auth_user_id, auth_user_destino, producto_id, producto_destino_id, nombre, tipo, cantidad, costo, creado_destino)
      values (v_tid, v_origen, v_auth_destino, v_prod.id, v_dest_id, v_prod.nombre, 'servicio', 0, coalesce(v_prod.costo,0), v_creado);
      v_serv := v_serv + 1;
      continue;
    end if;

    -- Producto físico: salida en origen
    update public.productos set stock_actual = stock_actual - v_item.cant, updated_at = now() where id = v_prod.id;
    insert into public.movimientos_inventario (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
    values (v_origen, v_prod.id, 'salida', 'transferencia_sucursal', v_item.cant, v_prod.stock_actual, v_prod.stock_actual - v_item.cant,
            'Traslado ' || v_numero || ' hacia ' || coalesce(v_dest_nombre,'otra sucursal/bodega'));

    if v_dest_id is not null then
      update public.productos set stock_actual = coalesce(stock_actual,0) + v_item.cant, updated_at = now() where id = v_dest_id;
      insert into public.movimientos_inventario (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
      values (v_auth_destino, v_dest_id, 'entrada', 'transferencia_sucursal', v_item.cant, coalesce(v_dest_stock,0), coalesce(v_dest_stock,0) + v_item.cant,
              'Traslado ' || v_numero || ' recibido de otra sucursal/bodega');
      if v_prod.tipo_precio = 'escala' then
        for v_escala in select * from public.precios_escala where producto_id = v_prod.id loop
          if not exists (select 1 from public.precios_escala pe where pe.producto_id = v_dest_id and lower(pe.nombre) = lower(v_escala.nombre)) then
            insert into public.precios_escala (auth_user_id, producto_id, nombre, precio, orden, cantidad_minima)
            values (v_auth_destino, v_dest_id, v_escala.nombre, v_escala.precio, v_escala.orden, v_escala.cantidad_minima);
          end if;
        end loop;
        update public.productos set tipo_precio = 'escala' where id = v_dest_id;
      end if;
    else
      insert into public.productos
        (auth_user_id, tipo, nombre, descripcion, categoria, sku, codigo_barras, costo, precio, stock_actual, stock_minimo, stock_maximo,
         activo, tipo_precio, garantia_meses, es_materia_prima, unidad_medida, modelo, imagen_url, proveedor_nombre,
         presentacion, concentracion, principio_activo, unidad_codigo, permite_fraccion, unidad_compra_codigo,
         factor_compra, contenido_cantidad, contenido_unidad_codigo)
      values
        (v_auth_destino, 'producto', v_prod.nombre, v_prod.descripcion, v_prod.categoria, v_prod.sku, v_prod.codigo_barras,
         v_prod.costo, v_prod.precio, v_item.cant, v_prod.stock_minimo, v_prod.stock_maximo,
         true, coalesce(v_prod.tipo_precio,'fijo'), v_prod.garantia_meses, v_prod.es_materia_prima, v_prod.unidad_medida, v_prod.modelo,
         v_prod.imagen_url, v_prod.proveedor_nombre, v_prod.presentacion, v_prod.concentracion, v_prod.principio_activo,
         v_prod.unidad_codigo, v_prod.permite_fraccion, v_prod.unidad_compra_codigo, v_prod.factor_compra,
         v_prod.contenido_cantidad, v_prod.contenido_unidad_codigo)
      returning id into v_dest_id;
      v_dest_stock := 0; v_creado := true;
      insert into public.movimientos_inventario (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
      values (v_auth_destino, v_dest_id, 'entrada', 'transferencia_sucursal', v_item.cant, 0, v_item.cant,
              'Traslado ' || v_numero || ': producto nuevo recibido de otra sucursal/bodega');
      if v_prod.tipo_precio = 'escala' then
        for v_escala in select * from public.precios_escala where producto_id = v_prod.id loop
          insert into public.precios_escala (auth_user_id, producto_id, nombre, precio, orden, cantidad_minima)
          values (v_auth_destino, v_dest_id, v_escala.nombre, v_escala.precio, v_escala.orden, v_escala.cantidad_minima);
        end loop;
      end if;
    end if;

    insert into public.traslados_inventario_items
      (traslado_id, auth_user_id, auth_user_destino, producto_id, producto_destino_id, nombre, tipo, cantidad, costo,
       stock_antes_origen, stock_antes_destino, creado_destino)
    values (v_tid, v_origen, v_auth_destino, v_prod.id, v_dest_id, v_prod.nombre, 'producto', v_item.cant, coalesce(v_prod.costo,0),
            v_prod.stock_actual, coalesce(v_dest_stock,0), v_creado);

    v_n := v_n + 1;
    v_unidades := v_unidades + v_item.cant;
    v_costo := v_costo + v_item.cant * coalesce(v_prod.costo, 0);
  end loop;

  update public.traslados_inventario
     set total_productos = v_n, total_unidades = v_unidades, total_costo = round(v_costo, 2)
   where id = v_tid;

  return jsonb_build_object('traslado_id', v_tid, 'numero', v_numero, 'productos', v_n, 'servicios', v_serv,
                            'unidades', v_unidades, 'costo', round(v_costo, 2));
end;
$function$;
