-- =====================================================================
-- NOVACELL · corrección del stock de 7 traslados que cayeron en el producto equivocado (2 al 5 de nov 2026)
-- Autorizado por el dueño del sistema. Hace un RESPALDO previo y solo mueve unidades entre productos de la misma
-- cuenta (el total de cada nombre no cambia); cada ajuste deja su movimiento de inventario ('correccion_traslado').
--   Principal : GLASS IP 11 PM-15 -2 · GLASS A15-15 +2 · PROTECTOR VARÓN SMART 9-80 -3 · PROTECTOR VARÓN SMART 9-70 +3
--   Novacell 2: GLASS IP 14PLUS-15 -2 · GLASS RM A3-15 (no existía) se crea con 2 unidades
-- Si el stock actual ya no coincide con lo esperado, NO hace nada y avisa.
-- =====================================================================
create table if not exists public.respaldo_traslados_novacell_20261105 as
  select now() as respaldado_en, p.* from public.productos p
   where p.id in ('91fc6989-cb73-4653-8eb4-53e9d2257c92', '3bccfd4c-08c2-469c-b01e-945664b2b7f0', '58b51fe8-f3f6-4bae-b4af-397786874fa1',
                  'aed99e8c-13f6-43e2-b267-d6033dc989e1', 'ec91705b-6a32-4934-b3c5-beea72951a59', '677bb5cf-b90c-4758-87f3-28fa9e72f270');
alter table public.respaldo_traslados_novacell_20261105 enable row level security;

do $c$
declare
  c uuid := '0b4d695b-8433-452c-bd68-d078276e707a'; s2 uuid := '0650ecbf-a523-4ff6-a329-73b1c6fe627f';
  v_nuevo uuid; v_orig record; x record; v_antes numeric;
begin
  if exists (select 1 from public.productos where auth_user_id = s2 and sku = 'RM A3-15') then
    raise exception 'Ya existe GLASS RM A3-15 en Novacell 2: no se aplica la corrección.';
  end if;
  -- ajustes entre productos existentes: (id, cuenta, cambio)
  for x in select * from (values
      ('91fc6989-cb73-4653-8eb4-53e9d2257c92'::uuid, c, -2::numeric), ('3bccfd4c-08c2-469c-b01e-945664b2b7f0'::uuid, c, 2::numeric),
      ('58b51fe8-f3f6-4bae-b4af-397786874fa1'::uuid, c, -3::numeric), ('aed99e8c-13f6-43e2-b267-d6033dc989e1'::uuid, c, 3::numeric),
      ('ec91705b-6a32-4934-b3c5-beea72951a59'::uuid, s2, -2::numeric)) t(pid, uid, delta) loop
    select stock_actual into v_antes from public.productos where id = x.pid and auth_user_id = x.uid for update;
    if v_antes is null then raise exception 'No se encontró el producto % de la cuenta esperada.', x.pid; end if;
    if x.delta < 0 and v_antes < -x.delta then raise exception 'El stock actual (%) de % ya no permite restar %. No se aplica.', v_antes, x.pid, -x.delta; end if;
    update public.productos set stock_actual = stock_actual + x.delta, updated_at = now() where id = x.pid;
    insert into public.movimientos_inventario(auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
    values (x.uid, x.pid, 'ajuste_manual', 'correccion_traslado', x.delta, v_antes, v_antes + x.delta,
            'Corrección de traslado enviado al producto equivocado (nov 2026)');
  end loop;
  -- GLASS RM A3-15 en Novacell 2: se crea con las 2 unidades que se enviaron
  select * into v_orig from public.productos where id = '677bb5cf-b90c-4758-87f3-28fa9e72f270' and auth_user_id = c;
  if v_orig.id is null then raise exception 'No se encontró GLASS RM A3-15 en la cuenta principal.'; end if;
  insert into public.productos
    (auth_user_id, tipo, nombre, descripcion, categoria, sku, codigo_barras, costo, precio, stock_actual, stock_minimo, stock_maximo,
     activo, tipo_precio, garantia_meses, es_materia_prima, unidad_medida, modelo, imagen_url, proveedor_nombre,
     presentacion, concentracion, principio_activo, unidad_codigo, permite_fraccion, unidad_compra_codigo,
     factor_compra, contenido_cantidad, contenido_unidad_codigo)
  values
    (s2, 'producto', v_orig.nombre, v_orig.descripcion, v_orig.categoria, v_orig.sku, v_orig.codigo_barras, v_orig.costo, v_orig.precio, 2,
     v_orig.stock_minimo, v_orig.stock_maximo, true, coalesce(v_orig.tipo_precio, 'fijo'), v_orig.garantia_meses, v_orig.es_materia_prima,
     v_orig.unidad_medida, v_orig.modelo, v_orig.imagen_url, v_orig.proveedor_nombre, v_orig.presentacion, v_orig.concentracion,
     v_orig.principio_activo, v_orig.unidad_codigo, v_orig.permite_fraccion, v_orig.unidad_compra_codigo, v_orig.factor_compra,
     v_orig.contenido_cantidad, v_orig.contenido_unidad_codigo)
  returning id into v_nuevo;
  insert into public.movimientos_inventario(auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota)
  values (s2, v_nuevo, 'entrada', 'correccion_traslado', 2, 0, 2, 'Corrección: 2 traslados de GLASS RM A3-15 que habían caído en otro producto (nov 2026)');
end $c$;
