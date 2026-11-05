-- =====================================================================
-- LÁCTEOS DON MODESTO (info@lacteosdonmodesto.com) · reinicio "de cero" pedido por el cliente
-- Se conserva: lista de clientes (72), catálogo de 9 productos (stock 0), 2 proveedores, configuración y usuarios.
-- Se pone en cero/borra: ventas, créditos y pagos, compras, gastos, movimientos de caja, movimientos de inventario,
-- stock, saldos/acumulados de clientes y proveedores; la numeración de ventas y créditos vuelve a empezar en 1.
-- Antes de tocar nada guarda copia en tablas respaldo_donmodesto_20261105_* (se pueden consultar para restaurar).
-- =====================================================================
do $r$
declare
  u uuid := '6620492e-8e02-4929-923a-076e2986ccc8';
  t text; n bigint;
  tablas_borrar text[] := array['creditos_historial','creditos_cuotas','creditos_pagos','creditos','venta_detalles','ventas_fecha_respaldo','ventas','detalle_compras','compras','gastos','movimientos_financieros','movimientos_inventario','dashboard_alertas'];
  tablas_resp text[] := array['clientes','proveedores','productos','ventas_numeracion','creditos_numeracion','creditos_historial','creditos_cuotas','creditos_pagos','creditos','venta_detalles','ventas_fecha_respaldo','ventas','detalle_compras','compras','gastos','movimientos_financieros','movimientos_inventario','dashboard_alertas'];
begin
  if not exists (select 1 from auth.users where id = u and email = 'info@lacteosdonmodesto.com') then
    raise exception 'La cuenta no coincide: no se hace nada.';
  end if;
  -- 1) RESPALDO completo de lo que se va a tocar
  foreach t in array tablas_resp loop
    execute format('create table if not exists public.%I as select now() as respaldado_en, x.* from public.%I x where x.auth_user_id = %L', 'respaldo_donmodesto_20261105_'||t, t, u);
    execute format('alter table public.%I enable row level security', 'respaldo_donmodesto_20261105_'||t);
  end loop;
  -- 2) Borrar movimientos de dinero e inventario (el cliente y todo lo demás se conserva)

  foreach t in array tablas_borrar loop
    execute format('delete from public.%I where auth_user_id = %L', t, u);
  end loop;
  -- 3) Saldos y acumulados en cero
  update public.productos set stock_actual = 0 where auth_user_id = u and stock_actual <> 0;
  update public.clientes set total_compras = 0, num_compras = 0, saldo_pendiente = 0, ultima_compra = null, primera_compra = null, fecha_ultimo_pago = null
   where auth_user_id = u and (coalesce(total_compras,0)<>0 or coalesce(num_compras,0)<>0 or coalesce(saldo_pendiente,0)<>0 or ultima_compra is not null or primera_compra is not null or fecha_ultimo_pago is not null);
  update public.proveedores set monto_acumulado = 0, total_compras = 0, ultima_compra = null where auth_user_id = u;
  -- 4) Numeración desde 1
  update public.ventas_numeracion set ultimo_numero = 0 where auth_user_id = u;
  update public.creditos_numeracion set ultimo_numero = 0 where auth_user_id = u;
end $r$;
