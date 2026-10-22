-- =====================================================================
-- PRODUCTOS · Importar Excel: si el SKU ya existe, se COMPLETA ese producto
-- Fecha: 21-oct-2026 · Función NUEVA. No modifica importar_productos_masivo ni datos.
--
-- Antes: un SKU que ya existía daba error "SKU duplicado" y frenaba todo el archivo.
-- Ahora la pantalla muestra esas filas para revisar y aprobar, y al aprobar
-- esta función (UNA transacción: todo o nada) hace:
--   1) crea los productos nuevos con la función de siempre (importar_productos_masivo);
--   2) COMPLETA los productos existentes con el mismo SKU:
--        - descripción, categoría, código de barras: solo si el archivo trae dato (nunca se borra nada);
--        - marca/proveedor: la crea si no existe y la asigna, solo si el archivo la trae;
--        - costo: se actualiza (salvo productos con "escala de costos", que se respetan);
--        - stock mínimo: solo si el archivo lo trae (productos);
--        - precio: solo si el producto usa el mismo tipo de precio que el archivo
--          (fijo con fijo / escala con escala); las escalas se actualizan por posición y no se borra ninguna;
--        - NO cambia: nombre, tipo, SKU, activo, ni imagen.
--        - Existencia (stock): NO se toca, salvo que el usuario marque "sumar el stock del archivo":
--          entonces se suma y queda un movimiento de inventario con costo (igual que un ajuste manual),
--          para que Inventario y Contabilidad sigan cuadrando.
-- =====================================================================
create or replace function public.importar_productos_con_actualizaciones(
  p_registros jsonb,
  p_modo_duplicados text default 'crear_nuevos',
  p_actualizaciones jsonb default '[]'::jsonb,
  p_sumar_stock boolean default false
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb := jsonb_build_object('ok', true, 'productos', 0, 'servicios', 0, 'marcas_creadas', 0, 'actualizados', 0, 'omitidos', 0);
  a jsonb;
  e jsonb;
  p public.productos%rowtype;
  v_marca text;
  v_prov uuid;
  v_marcas_nuevas int := 0;
  v_act int := 0;
  v_noenc int := 0;
  v_stock_sumado int := 0;
  v_sumar numeric;
  v_costo_nuevo numeric;
  v_orden int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  if p_registros is not null and jsonb_typeof(p_registros) = 'array' and jsonb_array_length(p_registros) > 0 then
    v_res := public.importar_productos_masivo(p_registros, p_modo_duplicados);
  end if;

  if p_actualizaciones is not null and jsonb_typeof(p_actualizaciones) = 'array' then
    for a in select * from jsonb_array_elements(p_actualizaciones) loop
      select * into p from public.productos
       where id = (a->>'producto_id')::uuid and auth_user_id = v_uid for update;
      if not found then v_noenc := v_noenc + 1; continue; end if;

      v_prov := null;
      v_marca := nullif(trim(coalesce(a->>'marca_proveedor','')), '');
      if v_marca is not null then
        select id into v_prov from public.proveedores where auth_user_id = v_uid and lower(nombre) = lower(v_marca) limit 1;
        if v_prov is null then
          insert into public.proveedores (auth_user_id, nombre, activo) values (v_uid, v_marca, true) returning id into v_prov;
          v_marcas_nuevas := v_marcas_nuevas + 1;
        end if;
      end if;

      v_costo_nuevo := case when p.tipo_costo is distinct from 'escala' and nullif(a->>'costo','') is not null
                            then (a->>'costo')::numeric else p.costo end;

      update public.productos set
        descripcion      = coalesce(nullif(trim(coalesce(a->>'descripcion','')), ''), descripcion),
        categoria        = coalesce(nullif(trim(coalesce(a->>'categoria','')), ''), categoria),
        codigo_barras    = coalesce(nullif(trim(coalesce(a->>'codigo_barras','')), ''), codigo_barras),
        proveedor_id     = case when v_marca is not null then v_prov else proveedor_id end,
        proveedor_nombre = case when v_marca is not null then v_marca else proveedor_nombre end,
        costo            = v_costo_nuevo,
        stock_minimo     = case when p.tipo = 'producto' and nullif(a->>'stock_minimo','') is not null
                                then (a->>'stock_minimo')::numeric else stock_minimo end,
        precio           = case when p.tipo_precio = 'fijo' and coalesce(a->>'tipo_precio','fijo') = 'fijo' and nullif(a->>'precio','') is not null
                                then (a->>'precio')::numeric else precio end,
        updated_at       = now()
      where id = p.id;

      if p.tipo_precio = 'escala' and a->>'tipo_precio' = 'escala' and jsonb_typeof(a->'escalas') = 'array' then
        for e in select * from jsonb_array_elements(a->'escalas') loop
          v_orden := coalesce((e->>'orden')::int, 0);
          update public.precios_escala
             set nombre = e->>'nombre', precio = (e->>'precio')::numeric, updated_at = now()
           where producto_id = p.id and auth_user_id = v_uid and orden = v_orden;
          if not found then
            insert into public.precios_escala (auth_user_id, producto_id, nombre, precio, cantidad_minima, orden)
            values (v_uid, p.id, e->>'nombre', (e->>'precio')::numeric, nullif(e->>'cantidad','')::numeric, v_orden);
          end if;
        end loop;
      end if;

      v_sumar := coalesce(nullif(a->>'stock_sumar','')::numeric, 0);
      if coalesce(p_sumar_stock, false) and p.tipo = 'producto' and v_sumar > 0 then
        update public.productos set stock_actual = coalesce(stock_actual, 0) + v_sumar, updated_at = now() where id = p.id;
        insert into public.movimientos_inventario (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota, costo_unitario, costo_total, descuenta_caja)
        values (v_uid, p.id, 'ajuste_manual', 'importacion_excel', v_sumar, coalesce(p.stock_actual, 0), coalesce(p.stock_actual, 0) + v_sumar,
                'Existencia sumada al importar Excel (mismo SKU: ' || coalesce(p.sku, '') || ')',
                v_costo_nuevo, round(v_sumar * coalesce(v_costo_nuevo, 0), 2), false);
        v_stock_sumado := v_stock_sumado + 1;
      end if;

      v_act := v_act + 1;
    end loop;
  end if;

  return v_res || jsonb_build_object('actualizados_sku', v_act, 'no_encontrados_sku', v_noenc,
                                     'stock_sumado_sku', v_stock_sumado,
                                     'marcas_creadas', coalesce((v_res->>'marcas_creadas')::int, 0) + v_marcas_nuevas);
end;
$$
