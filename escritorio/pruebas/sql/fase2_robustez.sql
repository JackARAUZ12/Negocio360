-- Fase 2 — robustez y seguridad de offline_registrar_venta.
-- Se corre como un solo DO que al final se revierte (raise exception).
-- Cuenta FALSA de prueba; ninguna cuenta real se toca.
do $prueba$
declare
  U constant uuid := '0ff11e00-0000-4000-8000-000000000002';
  OTRO constant uuid := '0ff11e00-0000-4000-8000-000000000003';
  P1 constant uuid := '0ff11e00-0000-4000-8000-000000000311';
  P2 constant uuid := '0ff11e00-0000-4000-8000-000000000312';
  PX constant uuid := '0ff11e00-0000-4000-8000-000000000399';  -- producto de OTRA cuenta
  DISP constant text := '0ff11e00-dddd-4ddd-8ddd-000000000002';
  r jsonb := '{}'; v jsonb; v2 jsonb; n int; s numeric; t text; v_demo uuid;
begin
  -- ---------- Preparación ----------
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
    (U, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prueba-offline-2@negocio360.test', '{}', '{}', now(), now()),
    (OTRO, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prueba-offline-3@negocio360.test', '{}', '{}', now(), now());
  insert into public.configuracion_empresa (auth_user_id, nombre_comercial) values (U, 'Prueba 2'), (OTRO, 'Prueba 3');
  insert into public.productos (id, auth_user_id, nombre, tipo, precio, costo, stock_actual, activo) values
    (P1, U, 'Arroz', 'producto', 30, 20, 5, true),
    (P2, U, 'Aceite', 'producto', 80, 60, 10, false),
    (PX, OTRO, 'Ajeno', 'producto', 1, 1, 100, true);
  insert into public.offline_cuentas_habilitadas (auth_user_id, habilitado) values (U, true);
  insert into public.offline_dispositivos (auth_user_id, dispositivo_uid, nombre) values (U, DISP, 'Caja prueba');
  select auth_user_id into v_demo from public.cuentas_prueba where tipo = 'demo_publica' limit 1;

  -- Paquete mínimo de una venta (lo arma el programa con el código de la web)
  create function pg_temp.paquete(p_uuid text, p_num text, p_prod uuid, p_cant numeric, p_precio numeric,
                                  p_cat numeric default null, p_reloj text default null) returns jsonb language sql as $fn$
    select jsonb_build_object('version', 1, 'uuid', p_uuid, 'dispositivo_uid', '0ff11e00-dddd-4ddd-8ddd-000000000002', 'tipo', 'nueva',
      'fecha_hoy', current_date, 'vendida_en', now() - interval '5 minutes', 'reloj_envio', coalesce(p_reloj, now()::text),
      'venta', jsonb_build_object('numero_venta', p_num, 'cliente_nombre', 'Consumidor Final', 'fecha', current_date,
               'subtotal', p_cant * p_precio, 'descuento', 0, 'impuesto', 0, 'total', p_cant * p_precio, 'costo_total', 0,
               'metodo_pago_nombre', 'Efectivo', 'creado_por_nombre', 'Admin', 'estado', 'completada', 'observaciones', null,
               'iva_activo', false, 'iva_porcentaje', 0),
      'detalles', jsonb_build_array(jsonb_build_object('producto_id', p_prod, 'producto_nombre', 'X', 'tipo_item', 'producto',
               'cantidad', p_cant, 'precio', p_precio, 'costo', 0, 'descuento', 0, 'subtotal', p_cant * p_precio, 'ganancia', 0,
               'vendido_sin_stock', false, 'es_regalia', false)),
      'caja', jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || p_num, 'monto', p_cant * p_precio,
               'metodo_pago_nombre', 'Efectivo', 'fecha', current_date)),
      'auditoria', jsonb_build_array(jsonb_build_object('tabla', 'ventas', 'accion', 'INSERT', 'resumen', 'numero_venta: ' || p_num)),
      'precios_catalogo', case when p_cat is null then '{}'::jsonb else jsonb_build_object('0', p_cat) end)
  $fn$;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);

  -- 1) Venta normal
  v := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000001', 'V-900001', P1, 2, 30));
  r := r || jsonb_build_object('1_normal', v->>'ok' = 'true' and v->>'numero_venta' = 'V-900001' and jsonb_array_length(v->'alertas') = 0);

  -- 2) La MISMA venta enviada otra vez (corte de internet a mitad de la respuesta): no se duplica
  v2 := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000001', 'V-900001', P1, 2, 30) || jsonb_build_object('reloj_envio', now()::text));
  select count(*) into n from public.ventas where auth_user_id = U and numero_venta = 'V-900001';
  select stock_actual into s from public.productos where id = P1;
  r := r || jsonb_build_object('2_idempotente', (v2->>'repetida')::boolean and v2->>'venta_id' = v->>'venta_id' and n = 1 and s = 3);

  -- 3) Mismo UUID con otro contenido: se rechaza
  begin
    perform public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000001', 'V-900001', P1, 9, 30));
    r := r || jsonb_build_object('3_uuid_reutilizado', 'FALLO');
  exception when others then r := r || jsonb_build_object('3_uuid_reutilizado', sqlerrm = 'N360_OFFLINE:uuid_reutilizado'); end;

  -- 4) Número ya usado por otra venta: el servidor asigna uno nuevo y lo cambia en los textos
  v := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000002', 'V-900001', P1, 1, 30));
  select concepto into t from public.movimientos_financieros where referencia_id = (v->>'venta_id')::uuid;
  r := r || jsonb_build_object('4_numero_reemplazado', (v->>'numero_reemplazado')::boolean and v->>'numero_venta' <> 'V-900001'
        and t = 'Venta ' || (v->>'numero_venta') and v->'alertas'->0->>'tipo' = 'numero_reemplazado'
        and exists (select 1 from public.auditoria_log where auth_user_id = U and resumen = 'numero_venta: ' || (v->>'numero_venta')));

  -- 5) Número provisional (bloque agotado sin internet): se reemplaza
  v := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000003', 'P-ABC-0001', P1, 1, 30));
  r := r || jsonb_build_object('5_provisional', (v->>'numero_reemplazado')::boolean and v->>'numero_venta' ~ '^V-[0-9]{6}$');

  -- 6) Dos cajas venden la última unidad: stock negativo marcado + alerta (nunca se rechaza)
  v := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000004', 'V-900004', P1, 5, 30));
  select stock_actual into s from public.productos where id = P1;
  r := r || jsonb_build_object('6_stock_negativo', s = -4 and v->'alertas'->0->>'tipo' = 'stock_negativo'
        and (select vendido_sin_stock from public.venta_detalles where venta_id = (v->>'venta_id')::uuid));

  -- 7) Precio cambiado y producto desactivado mientras no había internet: se respeta lo cobrado, con aviso
  v := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000005', 'V-900005', P2, 1, 75, 75));
  r := r || jsonb_build_object('7_precio_y_desactivado', (select array_agg(a->>'tipo' order by a->>'tipo') from jsonb_array_elements(v->'alertas') a) = array['precio_distinto', 'producto_inactivo']
        and (select total from public.ventas where id = (v->>'venta_id')::uuid) = 75);

  -- 8) Reloj del equipo atrasado 40 minutos: alerta y hora corregida
  v := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000006', 'V-900006', P2, 1, 80, null, (now() - interval '40 minutes')::text));
  r := r || jsonb_build_object('8_reloj', v->'alertas'->0->>'tipo' = 'reloj_desfasado'
        and (select created_at from public.ventas where id = (v->>'venta_id')::uuid) between now() - interval '6 minutes' and now());

  -- 9) Producto de OTRA cuenta: no se toca su stock y la línea queda sin vínculo
  v := public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000007', 'V-900007', PX, 3, 1));
  perform set_config('role', 'postgres', true);   -- para poder mirar el producto de la otra cuenta
  r := r || jsonb_build_object('9_referencia_ajena', (select stock_actual from public.productos where id = PX) = 100
        and (select producto_id from public.venta_detalles where venta_id = (v->>'venta_id')::uuid) is null);
  perform set_config('role', 'authenticated', true);

  -- 10) Todo o nada: si una parte falla (concepto de Caja vacío) no queda NADA de la venta
  begin
    perform public.offline_registrar_venta(jsonb_set(pg_temp.paquete('11111111-0000-4000-8000-000000000008', 'V-900008', P2, 1, 80), '{caja,0,concepto}', 'null'));
    r := r || jsonb_build_object('10_todo_o_nada', 'FALLO');
  exception when others then
    r := r || jsonb_build_object('10_todo_o_nada', not exists (select 1 from public.ventas where auth_user_id = U and numero_venta = 'V-900008')
          and not exists (select 1 from public.offline_ventas_recibidas where uuid = '11111111-0000-4000-8000-000000000008')
          and (select stock_actual from public.productos where id = P2) = 8);
  end;

  -- 11) Formatos y tipos no permitidos
  begin perform public.offline_registrar_venta(jsonb_set(pg_temp.paquete('11111111-0000-4000-8000-000000000009', 'V-900009', P2, 1, 80), '{venta,metodo_pago}', '"fiado"'));
    r := r || jsonb_build_object('11_fiado', 'FALLO');
  exception when others then r := r || jsonb_build_object('11_fiado', sqlerrm = 'N360_OFFLINE:tipo_no_permitido'); end;
  begin perform public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000010', 'V-900010', P2, -1, 80));
    r := r || jsonb_build_object('11_cantidad_negativa', 'FALLO');
  exception when others then r := r || jsonb_build_object('11_cantidad_negativa', sqlerrm = 'N360_OFFLINE:linea_invalida'); end;
  begin perform public.offline_registrar_venta(pg_temp.paquete('no-es-uuid', 'V-900011', P2, 1, 80));
    r := r || jsonb_build_object('11_uuid_malo', 'FALLO');
  exception when others then r := r || jsonb_build_object('11_uuid_malo', sqlerrm = 'N360_OFFLINE:uuid_invalido'); end;
  begin perform public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000012', 'V-900012', P2, 1, 80) - 'detalles');
    r := r || jsonb_build_object('11_sin_detalle', 'FALLO');
  exception when others then r := r || jsonb_build_object('11_sin_detalle', sqlerrm = 'N360_OFFLINE:formato'); end;

  -- 12) Equipo no registrado / desactivado
  begin perform public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000013', 'V-900013', P2, 1, 80) || '{"dispositivo_uid":"0ff11e00-dddd-4ddd-8ddd-00000000dead"}');
    r := r || jsonb_build_object('12_equipo_desconocido', 'FALLO');
  exception when others then r := r || jsonb_build_object('12_equipo_desconocido', sqlerrm = 'N360_OFFLINE:dispositivo_no_autorizado'); end;
  perform set_config('role', 'postgres', true);
  update public.offline_dispositivos set activo = false where auth_user_id = U;
  perform set_config('role', 'authenticated', true);
  begin perform public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000014', 'V-900014', P2, 1, 80));
    r := r || jsonb_build_object('12_equipo_desactivado', 'FALLO');
  exception when others then r := r || jsonb_build_object('12_equipo_desactivado', sqlerrm = 'N360_OFFLINE:dispositivo_no_autorizado'); end;

  -- 13) Lo que ve el usuario: sus ventas recibidas y alertas, nada más
  r := r || jsonb_build_object('13_ve_lo_suyo', (select count(*) from public.offline_ventas_recibidas) = 7
        and (select count(*) from public.offline_alertas) >= 5);
  perform public.offline_marcar_alerta_revisada((select id from public.offline_alertas limit 1));
  r := r || jsonb_build_object('13_marcar_revisada', (select count(*) from public.offline_alertas where revisada) = 1);

  -- 14) Otra cuenta (sin interruptor): bloqueada y no ve nada
  perform set_config('request.jwt.claims', json_build_object('sub', OTRO, 'role', 'authenticated')::text, true);
  begin perform public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000015', 'V-900015', PX, 1, 1));
    r := r || jsonb_build_object('14_otra_cuenta', 'FALLO');
  exception when others then r := r || jsonb_build_object('14_otra_cuenta', sqlerrm = 'N360_OFFLINE:no_habilitado'); end;
  r := r || jsonb_build_object('14_otra_no_ve', (select count(*) from public.offline_ventas_recibidas) = 0 and (select count(*) from public.offline_alertas) = 0
        and not public.offline_marcar_alerta_revisada((select id from public.offline_alertas limit 1)));

  -- 15) Cuenta demo y sin sesión
  perform set_config('request.jwt.claims', json_build_object('sub', v_demo, 'role', 'authenticated')::text, true);
  begin perform public.offline_registrar_venta(pg_temp.paquete('11111111-0000-4000-8000-000000000016', 'V-900016', P1, 1, 1));
    r := r || jsonb_build_object('15_demo', 'FALLO');
  exception when others then r := r || jsonb_build_object('15_demo', sqlerrm = 'N360_OFFLINE:cuenta_demo'); end;
  perform set_config('role', 'anon', true);
  begin perform public.offline_registrar_venta('{}');
    r := r || jsonb_build_object('15_anon', 'FALLO');
  exception when insufficient_privilege then r := r || jsonb_build_object('15_anon', true); end;
  begin perform public._offline_insertar('ventas', '{}', '{}');
    r := r || jsonb_build_object('15_interna_bloqueada', 'FALLO');
  exception when insufficient_privilege then r := r || jsonb_build_object('15_interna_bloqueada', true); end;
  perform set_config('role', 'authenticated', true);
  begin perform public._offline_insertar('ventas', '{}', '{}');
    r := r || jsonb_build_object('15_interna_bloqueada_auth', 'FALLO');
  exception when insufficient_privilege then r := r || jsonb_build_object('15_interna_bloqueada_auth', true); end;

  raise exception 'RESULTADO_PRUEBA %', r;
end $prueba$;
