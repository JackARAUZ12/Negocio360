-- Fase 4 — "un día completo" en el servidor, con cuadre final.
-- Dos equipos de la misma cuenta, cada uno con sus bloques de números,
-- 500 ventas sin conexión que suben intercaladas, la web numerando en medio,
-- reenvíos (cortes a mitad de respuesta) y los dos equipos vendiendo la
-- última unidad. Al final se cuadra: ventas, números, stock, Caja, bitácora.
-- Un solo DO que se revierte (raise exception). Cuenta FALSA de prueba.
do $prueba$
declare
  U constant uuid := '0ff11e00-0000-4000-8000-000000000004';
  P1 constant uuid := '0ff11e00-0000-4000-8000-000000000411';  -- 500 unidades
  P2 constant uuid := '0ff11e00-0000-4000-8000-000000000412';  -- la última unidad
  D1 constant text := '0ff11e00-dddd-4ddd-8ddd-000000000041';
  D2 constant text := '0ff11e00-dddd-4ddd-8ddd-000000000042';
  r jsonb := '{}'; v jsonb; b jsonb; i int; n int; t0 timestamptz; ms numeric;
  num1 int[] := '{}'; num2 int[] := '{}'; web_nums text[] := '{}'; uuids text[] := '{}';
  repetidas int := 0; total_esperado numeric := 0;
begin
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
    (U, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prueba-offline-4@negocio360.test', '{}', '{}', now(), now());
  insert into public.configuracion_empresa (auth_user_id, nombre_comercial) values (U, 'Prueba día completo');
  insert into public.productos (id, auth_user_id, nombre, tipo, precio, costo, stock_actual, activo) values
    (P1, U, 'Arroz', 'producto', 30, 20, 500, true),
    (P2, U, 'Última unidad', 'producto', 80, 60, 1, true);
  insert into public.offline_cuentas_habilitadas (auth_user_id, habilitado, tamano_bloque) values (U, true, 50);

  create function pg_temp.paquete(p_uuid text, p_disp text, p_num text, p_prod uuid, p_cant numeric, p_precio numeric) returns jsonb language sql as $fn$
    select jsonb_build_object('version', 1, 'uuid', p_uuid, 'dispositivo_uid', p_disp, 'tipo', 'rapida',
      'fecha_hoy', current_date, 'vendida_en', now() - interval '2 hours', 'reloj_envio', now()::text,
      'venta', jsonb_build_object('numero_venta', p_num, 'cliente_nombre', 'Consumidor Final', 'fecha', current_date,
               'subtotal', p_cant * p_precio, 'descuento', 0, 'impuesto', 0, 'total', p_cant * p_precio, 'costo_total', 0,
               'metodo_pago_nombre', 'Efectivo', 'creado_por_nombre', 'Caja', 'estado', 'completada', 'observaciones', null,
               'iva_activo', false, 'iva_porcentaje', 0),
      'detalles', jsonb_build_array(jsonb_build_object('producto_id', p_prod, 'producto_nombre', 'X', 'tipo_item', 'producto',
               'cantidad', p_cant, 'precio', p_precio, 'costo', 0, 'descuento', 0, 'subtotal', p_cant * p_precio, 'ganancia', 0,
               'vendido_sin_stock', false, 'es_regalia', false)),
      'caja', jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || p_num, 'monto', p_cant * p_precio,
               'metodo_pago_nombre', 'Efectivo', 'fecha', current_date)),
      'auditoria', jsonb_build_array(jsonb_build_object('tabla', 'ventas', 'accion', 'INSERT', 'resumen', 'numero_venta: ' || p_num)))
  $fn$;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);

  -- Mañana con internet: se registran los dos equipos y cada uno aparta sus números;
  -- la web sigue numerando en medio.
  perform public.offline_registrar_dispositivo(D1, 'Caja 1', 'piloto', 'win32-x64');
  perform public.offline_registrar_dispositivo(D2, 'Caja 2', 'piloto', 'win32-x64');
  for i in 1..6 loop
    b := public.offline_reservar_numeros(D1);
    num1 := num1 || array(select generate_series((b->>'desde')::int, (b->>'hasta')::int));
    web_nums := web_nums || public.generar_numero_venta(U);
    b := public.offline_reservar_numeros(D2);
    num2 := num2 || array(select generate_series((b->>'desde')::int, (b->>'hasta')::int));
  end loop;
  r := r || jsonb_build_object('1_bloques_sin_cruce',
    (select count(*) from (select unnest(num1) union select unnest(num2) union select regexp_replace(unnest(web_nums), '\D', '', 'g')::int) x) = 600 + 6);

  -- Sin internet todo el día: 250 ventas por equipo. Al volver suben intercaladas.
  t0 := clock_timestamp();
  for i in 1..250 loop
    v := public.offline_registrar_venta(pg_temp.paquete(gen_random_uuid()::text, D1, 'V-' || lpad(num1[i]::text, 6, '0'), P1, 1, 30));
    uuids := uuids || (v->>'venta_id');
    v := public.offline_registrar_venta(pg_temp.paquete(gen_random_uuid()::text, D2, 'V-' || lpad(num2[i]::text, 6, '0'), P1, 1, 30));
    uuids := uuids || (v->>'venta_id');
    total_esperado := total_esperado + 60;
  end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  r := r || jsonb_build_object('2_500_ventas_ms', round(ms), '2_ms_por_venta', round(ms / 500, 1));

  -- Los dos equipos vendieron la última unidad (cada uno tenía 1 en su copia).
  v := public.offline_registrar_venta(pg_temp.paquete('44444444-0000-4000-8000-000000000001', D1, 'V-' || lpad(num1[251]::text, 6, '0'), P2, 1, 80));
  b := public.offline_registrar_venta(pg_temp.paquete('44444444-0000-4000-8000-000000000002', D2, 'V-' || lpad(num2[251]::text, 6, '0'), P2, 1, 80));
  total_esperado := total_esperado + 160;
  r := r || jsonb_build_object('3_ultima_unidad_ambas_aceptadas', v->>'ok' = 'true' and b->>'ok' = 'true'
    and jsonb_array_length(v->'alertas') = 0 and b->'alertas'->0->>'tipo' = 'stock_negativo'
    and (select stock_actual from public.productos where id = P2) = -1);

  -- Cortes a mitad de respuesta: las mismas dos ventas llegan otra vez (y otra).
  for i in 1..3 loop
    v := public.offline_registrar_venta(pg_temp.paquete('44444444-0000-4000-8000-000000000001', D1, 'V-' || lpad(num1[251]::text, 6, '0'), P2, 1, 80));
    if (v->>'repetida')::boolean then repetidas := repetidas + 1; end if;
  end loop;
  r := r || jsonb_build_object('4_reenvios_no_duplican', repetidas = 3);

  -- ---------- Cuadre final ----------
  select count(*) into n from public.ventas where auth_user_id = U and estado = 'completada';
  r := r || jsonb_build_object('5_ventas', n = 502);
  r := r || jsonb_build_object('6_numeros_unicos_y_del_equipo',
    (select count(distinct numero_venta) from public.ventas where auth_user_id = U) = 502
    and not exists (select 1 from public.offline_ventas_recibidas where auth_user_id = U and numero_reemplazado));
  r := r || jsonb_build_object('7_stock', (select stock_actual from public.productos where id = P1) = 0);
  r := r || jsonb_build_object('8_caja_total',
    (select sum(monto) from public.movimientos_financieros where auth_user_id = U and tipo_flujo = 'INGRESO' and tipo_movimiento = 'VENTA') = total_esperado
    and (select sum(total) from public.ventas where auth_user_id = U) = total_esperado);
  r := r || jsonb_build_object('9_caja_saldo_encadenado',
    (select count(*) from public.movimientos_financieros where auth_user_id = U and saldo_resultante <> saldo_anterior + monto) = 0
    and (select max(saldo_resultante) from public.movimientos_financieros where auth_user_id = U) = total_esperado);
  r := r || jsonb_build_object('10_detalles', (select count(*) from public.venta_detalles d join public.ventas v2 on v2.id = d.venta_id where v2.auth_user_id = U) = 502);
  r := r || jsonb_build_object('11_bitacora', (select count(*) from public.auditoria_log where auth_user_id = U and tabla = 'ventas') = 502);
  r := r || jsonb_build_object('12_alertas', (select count(*) from public.offline_alertas where auth_user_id = U) = 1);
  r := r || jsonb_build_object('13_hora_real_conservada',
    (select bool_and(created_at < now() - interval '1 hour') from public.ventas where auth_user_id = U));

  raise exception 'RESULTADO_PRUEBA %', r;
end $prueba$;
