-- Pruebas de la corrección de lotes y comisión (se corre DESPUÉS de la
-- migración, dentro del mismo DO que se revierte). Cuenta FALSA.
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
    (U, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prueba-correccion@negocio360.test', '{}', '{}', now(), now()),
    (OTRO, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prueba-correccion-2@negocio360.test', '{}', '{}', now(), now());
  insert into public.configuracion_empresa (auth_user_id, nombre_comercial, maneja_lotes_vencimiento) values (U, 'Prueba corrección', true), (OTRO, 'Otra', true);
  insert into public.productos (id, auth_user_id, nombre, tipo, precio, costo, stock_actual, activo) values
    (P1, U, 'Paracetamol', 'producto', 10, 5, 30, true), (PX, OTRO, 'Ajeno', 'producto', 1, 1, 10, true);
  insert into public.producto_lotes (id, auth_user_id, producto_id, numero_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, activo) values
    (L1, U, P1, 'L-1', current_date + 30, 10, 10, true),
    (L2, U, P1, 'L-2', current_date + 60, 10, 10, true),
    (L3, U, P1, 'L-3', current_date + 90, 10, 10, true),
    (LX, OTRO, PX, 'L-X', current_date + 30, 10, 10, true);
  insert into public.bancos (id, auth_user_id, nombre, moneda, comision_porcentaje) values (B1, U, 'BAC', 'NIO', 3);
  insert into public.offline_cuentas_habilitadas (auth_user_id, habilitado) values (U, true);
  insert into public.offline_dispositivos (auth_user_id, dispositivo_uid, nombre) values (U, DISP, 'Caja prueba');
  insert into public.movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, fecha, created_at)
    values (U, 'INGRESO', 'CAPITAL_AGREGADO', 'Saldo inicial', 1000, current_date, now() - interval '1 hour');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);

  -- 1) Lote elegido: se descuenta UNA vez, del lote elegido (L2, no el que vence primero)
  n := public.descontar_lote_venta(L2, P1, 4);
  r := r || jsonb_build_object('1_lote_elegido', n = 0 and (select cantidad_actual from public.producto_lotes where id = L2) = 6
        and (select cantidad_actual from public.producto_lotes where id = L1) = 10);
  -- 2) No alcanza: lo que falta sale del siguiente que vence (L1 luego L3)
  n := public.descontar_lote_venta(L2, P1, 9);
  r := r || jsonb_build_object('2_no_alcanza_fefo', n = 0 and (select cantidad_actual from public.producto_lotes where id = L2) = 0
        and (select cantidad_actual from public.producto_lotes where id = L1) = 7 and (select cantidad_actual from public.producto_lotes where id = L3) = 10);
  -- 3) Sin lote elegido = FEFO puro; lo que no cabe en lotes se devuelve
  n := public.descontar_lote_venta(null, P1, 20);
  r := r || jsonb_build_object('3_fefo_y_sobrante', n = 3 and (select sum(cantidad_actual) from public.producto_lotes where auth_user_id = U) = 0);
  -- 4) Lote o producto de OTRA cuenta: no se toca
  n := public.descontar_lote_venta(LX, PX, 5);
  perform set_config('role', 'postgres', true);
  r := r || jsonb_build_object('4_otra_cuenta', n = 5 and (select cantidad_actual from public.producto_lotes where id = LX) = 10);
  update public.producto_lotes set cantidad_actual = 10 where auth_user_id = U;
  perform set_config('role', 'authenticated', true);
  -- 5) anon no puede
  perform set_config('role', 'anon', true);
  begin perform public.descontar_lote_venta(L1, P1, 1); r := r || jsonb_build_object('5_anon', 'FALLO');
  exception when insufficient_privilege then r := r || jsonb_build_object('5_anon', true); end;
  perform set_config('role', 'authenticated', true);

  -- 6) Venta sin conexión con TARJETA y comisión: gasto ligado a la venta + egreso ligado al gasto
  v := public.offline_registrar_venta(pg_temp.paquete('22222222-0000-4000-8000-000000000001', 'V-910001', 'Tarjeta', 4, L2));
  r := r || jsonb_build_object('6_tarjeta',
        (select count(*) from public.gastos g where g.auth_user_id = U and g.venta_id = (v->>'venta_id')::uuid and g.tipo = 'inmediato'
           and g.categoria = 'Comisiones bancarias' and g.monto = 3 and g.estado = 'activo' and g.metodo_pago_nombre = 'Tarjeta'
           and exists (select 1 from public.movimientos_financieros m where m.id = g.movimiento_financiero_id and m.referencia_tipo = 'gasto'
                        and m.referencia_id = g.id and m.tipo_flujo = 'EGRESO' and m.tipo_movimiento = 'GASTO' and m.monto = 3 and m.banco_id = B1)) = 1
        and (select comision_monto from public.ventas where id = (v->>'venta_id')::uuid) = 3
        -- lote: una sola vez, del elegido
        and (select cantidad_actual from public.producto_lotes where id = L2) = 6
        and (select sum(cantidad_actual) from public.producto_lotes where auth_user_id = U) = 26);
  -- 7) Caja cuadra: 1000 + 100 de la venta − 3 de comisión
  r := r || jsonb_build_object('7_caja', (select saldo_resultante from public.movimientos_financieros where auth_user_id = U and estado = 'completado'
        order by created_at desc, id desc limit 1) = 1097);
  -- 8) TRANSFERENCIA con el mismo banco: sin comisión (ni gasto, ni egreso)
  v2 := public.offline_registrar_venta(pg_temp.paquete('22222222-0000-4000-8000-000000000002', 'V-910002', 'Transferencia', 4, null));
  r := r || jsonb_build_object('8_transferencia_sin_comision',
        not exists (select 1 from public.gastos where venta_id = (v2->>'venta_id')::uuid)
        and (select comision_monto from public.ventas where id = (v2->>'venta_id')::uuid) is null
        and (select count(*) from public.movimientos_financieros where auth_user_id = U and tipo_flujo = 'EGRESO') = 1);
  -- 9) Anular la venta con tarjeta como lo hace la web: gasto cancelado y su egreso anulado -> Caja neta 1000 + 100 (transferencia)
  update public.movimientos_financieros set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Venta anulada'
   where referencia_tipo = 'gasto' and referencia_id in (select id from public.gastos where venta_id = (v->>'venta_id')::uuid) and estado = 'completado';
  update public.gastos set estado = 'cancelado', cancelado_en = now(), cancelado_motivo = 'Venta anulada' where venta_id = (v->>'venta_id')::uuid;
  r := r || jsonb_build_object('9_anular_comision',
        (select coalesce(sum(case when tipo_flujo = 'INGRESO' then monto else -monto end), 0) from public.movimientos_financieros
          where auth_user_id = U and estado = 'completado') = 1200
        and (select saldo_resultante from public.movimientos_financieros where auth_user_id = U and estado = 'completado'
              order by created_at desc, id desc limit 1) = 1200);
  -- 10) Reenvío de la misma venta: no duplica gasto
  v := public.offline_registrar_venta(pg_temp.paquete('22222222-0000-4000-8000-000000000001', 'V-910001', 'Tarjeta', 4, L2));
  r := r || jsonb_build_object('10_reenvio', (v->>'repetida')::boolean and (select count(*) from public.gastos where auth_user_id = U) = 1);
