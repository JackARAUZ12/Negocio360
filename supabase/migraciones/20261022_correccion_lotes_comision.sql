-- ============================================================
-- Correcciones (2026-10-22), SOLO AGREGA en tablas existentes:
--  1. gastos.venta_id (columna nueva, opcional): liga la comisión bancaria
--     a su venta, para anularla junto con la venta.
--  2. descontar_lote_venta (función nueva): descuenta el lote elegido en la
--     venta UNA sola vez; si no alcanza, el resto del siguiente que vence.
--     Corrige el doble descuento de lotes de Nueva venta.
--  3. Funciones propias del modo sin conexión (creadas por este proyecto,
--     solo las usa la cuenta piloto): misma regla de lotes y la comisión
--     bancaria como gasto real, solo para tarjeta.
-- ============================================================

alter table public.gastos add column if not exists venta_id uuid;
create index if not exists gastos_venta_id_idx on public.gastos (auth_user_id, venta_id) where venta_id is not null;

create or replace function public.descontar_lote_venta(p_lote_id uuid, p_producto_id uuid, p_cantidad numeric)
returns numeric language plpgsql security definer set search_path = public as $f$
-- Devuelve lo que no se pudo asignar a ningún lote (0 si todo quedó en lotes).
declare v_uid uuid := auth.uid(); v_restante numeric := p_cantidad; v_lote record; v_tomar numeric;
begin
  if v_uid is null or p_producto_id is null or p_cantidad is null or p_cantidad <= 0 then return 0; end if;
  if not exists (select 1 from public.productos where id = p_producto_id and auth_user_id = v_uid) then return p_cantidad; end if;
  -- 1) El lote elegido en la venta (si es de esta cuenta y de este producto)
  if p_lote_id is not null then
    select id, cantidad_actual into v_lote from public.producto_lotes
     where id = p_lote_id and auth_user_id = v_uid and producto_id = p_producto_id for update;
    if found and v_lote.cantidad_actual > 0 then
      v_tomar := least(v_restante, v_lote.cantidad_actual);
      update public.producto_lotes set cantidad_actual = cantidad_actual - v_tomar, updated_at = now() where id = v_lote.id;
      v_restante := v_restante - v_tomar;
    end if;
  end if;
  -- 2) Lo que falte, del siguiente que vence (FEFO)
  for v_lote in select id, cantidad_actual from public.producto_lotes
                 where auth_user_id = v_uid and producto_id = p_producto_id and activo = true and cantidad_actual > 0
                   and id is distinct from p_lote_id
                 order by fecha_vencimiento asc, created_at asc for update loop
    exit when v_restante <= 0;
    v_tomar := least(v_restante, v_lote.cantidad_actual);
    update public.producto_lotes set cantidad_actual = cantidad_actual - v_tomar, updated_at = now() where id = v_lote.id;
    v_restante := v_restante - v_tomar;
  end loop;
  return greatest(v_restante, 0);
end $f$;
revoke all on function public.descontar_lote_venta(uuid, uuid, numeric) from public, anon;
grant execute on function public.descontar_lote_venta(uuid, uuid, numeric) to authenticated;

create or replace function public._offline_insertar(p_tabla text, p_fila jsonb, p_permitidas text[])
returns uuid language plpgsql security definer set search_path = public as $f$
declare v_cols text; v_id uuid;
begin
  if p_tabla not in ('ventas','venta_detalles','movimientos_financieros','movimientos_impuestos',
                     'venta_impuestos','retenciones_ir','garantias_clientes','auditoria_log','gastos') then
    raise exception 'N360_OFFLINE:tabla_no_permitida';
  end if;
  select string_agg(quote_ident(k), ', ' order by k) into v_cols
    from jsonb_object_keys(p_fila) k where k = any(p_permitidas);
  if v_cols is null then raise exception 'N360_OFFLINE:fila_vacia'; end if;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                 p_tabla, v_cols, v_cols, p_tabla)
    into v_id using p_fila;
  return v_id;
end $f$;
revoke all on function public._offline_insertar(text, jsonb, text[]) from public, anon, authenticated;

create or replace function public.offline_registrar_venta(p jsonb)
returns jsonb language plpgsql security definer set search_path = public set "TimeZone" = 'UTC' as $f$
declare
  v_uid uuid := auth.uid();
  v_uuid uuid; v_disp public.offline_dispositivos%rowtype; v_cfg public.configuracion_empresa%rowtype;
  v_huella text; v_prev public.offline_ventas_recibidas%rowtype;
  v_venta jsonb; v_det jsonb; v_fila jsonb; v_item jsonb; v_comp record; v_i int;
  v_tipo text; v_num_disp text; v_num_texto text; v_numero text; v_reemplazado boolean := false; v_nombre text;
  v_venta_id uuid; v_mov_id uuid; v_ultimo_mov uuid; v_cliente uuid;
  v_vendida timestamptz; v_reloj timestamptz; v_desfase int := 0; v_creada timestamptz;
  v_alertas jsonb := '[]'::jsonb; v_res jsonb;
  v_stock numeric; v_prod record; v_unid numeric; v_restante numeric; v_lote record; v_tomar numeric;
  v_sin_stock boolean[] := '{}'; v_total numeric; v_suma_caja numeric := 0; v_neto numeric;
  v_saldo_imp numeric; v_monto numeric; v_fecha_hoy date; v_garantia_num text;
  c_venta constant text[] := array['numero_venta','cliente_id','cliente_nombre','fecha','subtotal','descuento','impuesto',
    'total','costo_total','metodo_pago_id','metodo_pago_nombre','categoria','creado_por_nombre','estado',
    'observaciones','iva_activo','iva_porcentaje','retencion_ir_monto','retencion_ir_porcentaje','auth_user_id','created_at'];
  c_det constant text[] := array['auth_user_id','venta_id','producto_id','combo_id','promocion_id','producto_nombre',
    'producto_sku','tipo_item','cantidad','precio','costo','descuento','subtotal','ganancia','escala_id','escala_nombre',
    'vendido_sin_stock','es_regalia','presentacion_id','presentacion_nombre','presentacion_factor','lote_id',
    'cantidad_pedida','unidad_pedida'];
  c_mov constant text[] := array['auth_user_id','tipo_flujo','tipo_movimiento','concepto','monto','saldo_anterior',
    'saldo_resultante','metodo_pago_id','metodo_pago_nombre','banco_id','monto_moneda_banco','referencia_tipo',
    'referencia_id','observaciones','fecha'];
  c_imp constant text[] := array['auth_user_id','tipo_movimiento','concepto','monto','saldo_anterior','saldo_resultante',
    'referencia_venta_id','impuesto_id','impuesto_nombre','fecha','created_at'];
  c_vimp constant text[] := array['auth_user_id','venta_id','impuesto_id','nombre','porcentaje','monto'];
  c_ret constant text[] := array['auth_user_id','lado','origen','venta_id','estado','contraparte_nombre','fecha','base',
    'porcentaje','monto'];
  c_gar constant text[] := array['auth_user_id','numero','cliente_id','cliente_nombre','producto_id','producto_nombre',
    'venta_id','fecha_compra','garantia_meses','fecha_vencimiento','origen','numero_serie'];
  c_gasto constant text[] := array['auth_user_id','tipo','concepto','categoria','monto','fecha','metodo_pago_id',
    'metodo_pago_nombre','observaciones','estado','venta_id'];
  v_gasto_id uuid;
  c_aud constant text[] := array['auth_user_id','perfil_nombre','perfil_tipo','modulo','tabla','accion','resumen','created_at'];
begin
  -- 1. Quién, interruptor, equipo
  if v_uid is null then raise exception 'N360_OFFLINE:no_autorizado'; end if;
  if public._es_cuenta_demo(v_uid) then raise exception 'N360_OFFLINE:cuenta_demo'; end if;
  if not exists (select 1 from public.offline_cuentas_habilitadas where auth_user_id = v_uid and habilitado) then
    raise exception 'N360_OFFLINE:no_habilitado';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or coalesce((p->>'version')::int, 0) <> 1 then
    raise exception 'N360_OFFLINE:formato';
  end if;
  begin v_uuid := (p->>'uuid')::uuid; exception when others then raise exception 'N360_OFFLINE:uuid_invalido'; end;
  if v_uuid is null then raise exception 'N360_OFFLINE:uuid_invalido'; end if;
  select * into v_disp from public.offline_dispositivos
   where auth_user_id = v_uid and dispositivo_uid = lower(coalesce(p->>'dispositivo_uid', ''));
  if not found or not v_disp.activo then raise exception 'N360_OFFLINE:dispositivo_no_autorizado'; end if;

  -- 2. Idempotencia: la misma venta nunca se registra dos veces
  v_huella := encode(sha256(convert_to((p - 'reloj_envio')::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('offline_venta:' || v_uuid::text, 0));
  select * into v_prev from public.offline_ventas_recibidas where uuid = v_uuid;
  if found then
    if v_prev.auth_user_id <> v_uid or v_prev.huella <> v_huella then
      raise exception 'N360_OFFLINE:uuid_reutilizado';
    end if;
    return v_prev.resultado || jsonb_build_object('repetida', true);
  end if;

  -- 3. Validación del contenido (contado o pago dividido; nunca crédito/fiado)
  v_tipo := p->>'tipo';
  if v_tipo not in ('nueva', 'rapida') then raise exception 'N360_OFFLINE:tipo_invalido'; end if;
  v_venta := p->'venta';
  v_det := p->'detalles';
  if jsonb_typeof(v_venta) <> 'object' or jsonb_typeof(v_det) <> 'array'
     or jsonb_array_length(v_det) = 0 or jsonb_array_length(v_det) > 500 then
    raise exception 'N360_OFFLINE:formato';
  end if;
  if lower(coalesce(v_venta->>'metodo_pago', '')) in ('fiado', 'credito')
     or lower(coalesce(v_venta->>'estado_pago', '')) = 'credito' then
    raise exception 'N360_OFFLINE:tipo_no_permitido';
  end if;
  if jsonb_typeof(coalesce(p->'caja', '[]'::jsonb)) <> 'array' then raise exception 'N360_OFFLINE:formato'; end if;
  begin
    v_total := (v_venta->>'total')::numeric;
    v_fecha_hoy := coalesce((p->>'fecha_hoy')::date, (v_venta->>'fecha')::date);
    perform (v_venta->>'fecha')::date;
    for v_i in 0 .. jsonb_array_length(v_det) - 1 loop
      if not ((v_det->v_i->>'cantidad')::numeric > 0) or (v_det->v_i->>'precio')::numeric < 0 then
        raise exception 'N360_OFFLINE:linea_invalida';
      end if;
    end loop;
  exception
    when raise_exception then raise;
    when others then raise exception 'N360_OFFLINE:formato';
  end;
  select * into v_cfg from public.configuracion_empresa where auth_user_id = v_uid;

  -- 4. Hora real de la venta y reloj del equipo
  begin
    v_vendida := (p->>'vendida_en')::timestamptz;
    v_reloj := (p->>'reloj_envio')::timestamptz;
  exception when others then v_vendida := null; v_reloj := null; end;
  if v_reloj is not null then v_desfase := extract(epoch from (now() - v_reloj))::int; end if;
  v_creada := coalesce(v_vendida + make_interval(secs => v_desfase), now());
  if v_creada > now() or v_creada < now() - interval '90 days' then v_creada := now(); end if;
  if abs(v_desfase) > 600 then
    v_alertas := v_alertas || jsonb_build_object('tipo', 'reloj_desfasado',
      'mensaje', format('El reloj del equipo estaba %s minutos %s. Se usó la hora del servidor.',
                        abs(v_desfase) / 60, case when v_desfase > 0 then 'atrasado' else 'adelantado' end),
      'detalle', jsonb_build_object('desfase_segundos', v_desfase, 'equipo', v_disp.nombre));
  end if;
  if (v_venta->>'fecha')::date > current_date + 1 or (v_venta->>'fecha')::date < current_date - 60 then
    v_alertas := v_alertas || jsonb_build_object('tipo', 'fecha_fuera_de_rango',
      'mensaje', 'La fecha de la venta está lejos de la fecha de hoy. Revísala.',
      'detalle', jsonb_build_object('fecha', v_venta->>'fecha'));
  end if;

  -- 5. Número de venta: el del equipo si está libre; si no, uno nuevo
  perform pg_advisory_xact_lock(hashtextextended('ventas_num:' || v_uid::text, 0));
  v_num_texto := nullif(btrim(coalesce(v_venta->>'numero_venta', '')), '');   -- el número que traen los textos
  v_num_disp := v_num_texto;
  if v_num_disp is not null and v_num_disp !~ '^V-[0-9]{6,}$' then v_num_disp := null; end if;
  if v_num_disp is not null and not exists (select 1 from public.ventas where auth_user_id = v_uid
         and numero_venta = v_num_disp and estado = 'completada') then
    v_numero := v_num_disp;
  else
    v_numero := public.generar_numero_venta(v_uid);
    v_reemplazado := true;
    v_alertas := v_alertas || jsonb_build_object('tipo', 'numero_reemplazado',
      'mensaje', format('La venta %s del equipo quedó registrada como %s.', coalesce(v_num_disp, '(sin número)'), v_numero),
      'detalle', jsonb_build_object('numero_equipo', v_num_disp, 'numero_final', v_numero));
  end if;

  -- 6. Stock y lotes (lo calcula el servidor a partir del detalle)
  for v_i in 0 .. jsonb_array_length(v_det) - 1 loop
    v_item := v_det->v_i;
    v_sin_stock := v_sin_stock || coalesce((v_item->>'vendido_sin_stock')::boolean, false);
    -- 6a. Combo: cada componente × cantidad de combos
    if public._offline_ref(v_uid, 'combos', v_item->>'combo_id') is not null then
      for v_comp in select ci.producto_id, ci.cantidad from public.combo_items ci
                     where ci.combo_id = (v_item->>'combo_id')::uuid and ci.auth_user_id = v_uid loop
        update public.productos set stock_actual = coalesce(stock_actual, 0) - v_comp.cantidad * (v_item->>'cantidad')::numeric
         where id = v_comp.producto_id and auth_user_id = v_uid returning stock_actual, nombre into v_stock, v_nombre;
        if found and v_stock < 0 then
          v_sin_stock[v_i + 1] := true;
          v_alertas := v_alertas || jsonb_build_object('tipo', 'stock_negativo', 'mensaje',
            format('"%s" quedó con stock %s (vendido sin conexión en el combo "%s").', v_nombre, v_stock, v_item->>'producto_nombre'),
            'detalle', jsonb_build_object('producto_id', v_comp.producto_id, 'stock', v_stock));
        end if;
      end loop;
    -- 6b. Promoción: sus componentes (los manda el equipo, como en la web)
    elsif public._offline_ref(v_uid, 'promociones', v_item->>'promocion_id') is not null then
      for v_comp in select (c->>'producto_id') pid, (c->>'cantidad')::numeric cant
                      from jsonb_array_elements(coalesce(p->'componentes_promo'->(v_i::text), '[]'::jsonb)) c loop
        if public._offline_ref(v_uid, 'productos', v_comp.pid) is null or not (v_comp.cant > 0) then continue; end if;
        update public.productos set stock_actual = coalesce(stock_actual, 0) - v_comp.cant
         where id = v_comp.pid::uuid and auth_user_id = v_uid and tipo = 'producto' returning stock_actual, nombre into v_stock, v_nombre;
        if found and v_stock < 0 then
          v_sin_stock[v_i + 1] := true;
          v_alertas := v_alertas || jsonb_build_object('tipo', 'stock_negativo', 'mensaje',
            format('"%s" quedó con stock %s (vendido sin conexión en una promoción).', v_nombre, v_stock),
            'detalle', jsonb_build_object('producto_id', v_comp.pid, 'stock', v_stock));
        end if;
      end loop;
    -- 6c. Producto normal
    elsif public._offline_ref(v_uid, 'productos', v_item->>'producto_id') is not null then
      select id, nombre, tipo, activo, precio into v_prod from public.productos
       where id = (v_item->>'producto_id')::uuid and auth_user_id = v_uid;
      if v_prod.activo is false then
        v_alertas := v_alertas || jsonb_build_object('tipo', 'producto_inactivo', 'mensaje',
          format('Se vendió "%s" aunque estaba desactivado.', v_prod.nombre), 'detalle', jsonb_build_object('producto_id', v_prod.id));
      end if;
      if (p->'precios_catalogo'->>(v_i::text)) is not null and v_prod.precio is distinct from (p->'precios_catalogo'->>(v_i::text))::numeric then
        v_alertas := v_alertas || jsonb_build_object('tipo', 'precio_distinto', 'mensaje',
          format('"%s" cambió de precio (%s → %s) mientras el equipo estaba sin conexión. Se respetó el precio cobrado (%s).',
                 v_prod.nombre, p->'precios_catalogo'->>(v_i::text), v_prod.precio, v_item->>'precio'),
          'detalle', jsonb_build_object('producto_id', v_prod.id, 'precio_equipo', p->'precios_catalogo'->>(v_i::text),
                                        'precio_actual', v_prod.precio, 'precio_cobrado', v_item->>'precio'));
      end if;
      if v_prod.tipo = 'producto' then
        v_unid := (v_item->>'cantidad')::numeric *
                  case when coalesce((v_item->>'presentacion_factor')::numeric, 0) > 0 then (v_item->>'presentacion_factor')::numeric else 1 end;
        update public.productos set stock_actual = coalesce(stock_actual, 0) - v_unid
         where id = v_prod.id returning stock_actual into v_stock;
        if v_stock < 0 then
          v_sin_stock[v_i + 1] := true;
          v_alertas := v_alertas || jsonb_build_object('tipo', 'stock_negativo', 'mensaje',
            format('"%s" quedó con stock %s: se vendió sin conexión más de lo que había (posiblemente en dos equipos a la vez). Revisa el inventario.', v_prod.nombre, v_stock),
            'detalle', jsonb_build_object('producto_id', v_prod.id, 'stock', v_stock));
        end if;
        -- Lotes (una sola vez, igual que la web): del lote indicado y, si no
        -- alcanza, del siguiente que vence; sin lote indicado, FEFO si la
        -- cuenta maneja lotes.
        if public._offline_ref(v_uid, 'producto_lotes', v_item->>'lote_id') is not null then
          perform public.descontar_lote_venta((v_item->>'lote_id')::uuid, v_prod.id, v_unid);
        elsif v_cfg.maneja_lotes_vencimiento is true then
          perform public.descontar_lote_venta(null, v_prod.id, v_unid);
        end if;
      end if;
    end if;
  end loop;

  -- 7. Venta
  v_cliente := public._offline_ref(v_uid, 'clientes', v_venta->>'cliente_id');
  v_fila := (v_venta - 'id' - 'auth_user_id' - 'estado' - 'created_at' - 'referencia_caja')
    || jsonb_build_object('auth_user_id', v_uid, 'estado', 'completada', 'numero_venta', v_numero,
                          'cliente_id', v_cliente, 'created_at', v_creada,
                          'metodo_pago_id', public._offline_ref(v_uid, 'metodos_pago', v_venta->>'metodo_pago_id'));
  if v_fila->>'observaciones' is not null then
    v_fila := v_fila || jsonb_build_object('observaciones', public._offline_numero_en_texto(v_fila->>'observaciones', v_num_texto, v_numero));
  end if;
  v_venta_id := public._offline_insertar('ventas', v_fila, c_venta);

  -- 8. Detalle
  for v_i in 0 .. jsonb_array_length(v_det) - 1 loop
    v_item := v_det->v_i;
    v_fila := (v_item - 'id' - 'auth_user_id' - 'venta_id' - 'created_at')
      || jsonb_build_object('auth_user_id', v_uid, 'venta_id', v_venta_id,
           'producto_id', public._offline_ref(v_uid, 'productos', v_item->>'producto_id'),
           'combo_id', public._offline_ref(v_uid, 'combos', v_item->>'combo_id'),
           'promocion_id', public._offline_ref(v_uid, 'promociones', v_item->>'promocion_id'),
           'escala_id', public._offline_ref(v_uid, 'precios_escala', v_item->>'escala_id'),
           'presentacion_id', public._offline_ref(v_uid, 'producto_presentaciones', v_item->>'presentacion_id'),
           'lote_id', public._offline_ref(v_uid, 'producto_lotes', v_item->>'lote_id'),
           'vendido_sin_stock', v_sin_stock[v_i + 1]);
    if v_item->>'tipo_item' not in ('producto', 'servicio') then v_fila := v_fila || '{"tipo_item":"producto"}'; end if;
    perform public._offline_insertar('venta_detalles', v_fila, c_det);
  end loop;

  -- 9. Caja (ingresos; el saldo lo encadena el trigger existente)
  for v_item in select * from jsonb_array_elements(coalesce(p->'caja', '[]'::jsonb)) loop
    begin v_monto := (v_item->>'monto')::numeric; exception when others then v_monto := null; end;
    continue when v_monto is null or v_monto <= 0;   -- la web tampoco logra guardar montos en 0
    v_suma_caja := v_suma_caja + v_monto;
    v_fila := v_item || jsonb_build_object('auth_user_id', v_uid, 'tipo_flujo', 'INGRESO', 'tipo_movimiento', 'VENTA',
      'referencia_tipo', 'venta', 'referencia_id', v_venta_id, 'saldo_anterior', 0, 'saldo_resultante', 0,
      'metodo_pago_id', public._offline_ref(v_uid, 'metodos_pago', v_item->>'metodo_pago_id'),
      'banco_id', public._offline_ref(v_uid, 'bancos', v_item->>'banco_id'),
      'concepto', public._offline_numero_en_texto(v_item->>'concepto', v_num_texto, v_numero),
      'observaciones', public._offline_numero_en_texto(v_item->>'observaciones', v_num_texto, v_numero));
    v_ultimo_mov := public._offline_insertar('movimientos_financieros', v_fila, c_mov);
  end loop;
  if v_ultimo_mov is not null then
    update public.ventas set referencia_caja = v_ultimo_mov where id = v_venta_id;
  end if;
  v_neto := v_total - coalesce((v_venta->>'impuesto')::numeric, 0) - coalesce((v_venta->>'retencion_ir_monto')::numeric, 0);
  if abs(v_suma_caja - v_neto) > 0.011 then
    v_alertas := v_alertas || jsonb_build_object('tipo', 'totales_distintos', 'mensaje',
      format('Lo registrado en Caja (%s) no coincide con el total neto de la venta (%s). Revísala.', v_suma_caja, v_neto),
      'detalle', jsonb_build_object('caja', v_suma_caja, 'neto', v_neto));
  end if;

  -- 10. Comisión bancaria (solo con ingreso en Caja y solo pagos con TARJETA,
  --     como en la web): un gasto ligado a la venta + su egreso de Caja
  --     ligado al gasto, igual que un gasto del módulo Gastos.
  if v_ultimo_mov is not null and jsonb_typeof(p->'comision') = 'object'
     and coalesce((p->'comision'->>'monto')::numeric, 0) > 0
     and lower(coalesce(p->'comision'->'movimiento'->>'metodo_pago_nombre', '')) like '%tarjeta%'
     and public._offline_ref(v_uid, 'bancos', p->'comision'->>'banco_id') is not null then
    v_gasto_id := public._offline_insertar('gastos', jsonb_build_object('auth_user_id', v_uid, 'tipo', 'inmediato',
      'concepto', public._offline_numero_en_texto(p->'comision'->'movimiento'->>'concepto', v_num_texto, v_numero),
      'categoria', 'Comisiones bancarias', 'monto', (p->'comision'->>'monto')::numeric,
      'fecha', coalesce(p->'comision'->'movimiento'->>'fecha', v_venta->>'fecha'),
      'metodo_pago_id', public._offline_ref(v_uid, 'metodos_pago', p->'comision'->'movimiento'->>'metodo_pago_id'),
      'metodo_pago_nombre', p->'comision'->'movimiento'->>'metodo_pago_nombre', 'estado', 'activo', 'venta_id', v_venta_id,
      'observaciones', public._offline_numero_en_texto(coalesce(p->'comision'->'gasto'->>'observaciones',
                         'Generado automáticamente por la venta ' || coalesce(v_num_texto, v_numero)), v_num_texto, v_numero)), c_gasto);
    v_fila := coalesce(p->'comision'->'movimiento', '{}'::jsonb) || jsonb_build_object('auth_user_id', v_uid, 'tipo_flujo', 'EGRESO',
      'tipo_movimiento', 'GASTO', 'referencia_tipo', 'gasto', 'referencia_id', v_gasto_id, 'saldo_anterior', 0, 'saldo_resultante', 0,
      'monto', (p->'comision'->>'monto')::numeric,
      'metodo_pago_id', public._offline_ref(v_uid, 'metodos_pago', p->'comision'->'movimiento'->>'metodo_pago_id'),
      'banco_id', public._offline_ref(v_uid, 'bancos', p->'comision'->>'banco_id'),
      'concepto', public._offline_numero_en_texto(p->'comision'->'movimiento'->>'concepto', v_num_texto, v_numero));
    v_mov_id := public._offline_insertar('movimientos_financieros', v_fila, c_mov);
    update public.gastos set movimiento_financiero_id = v_mov_id where id = v_gasto_id;
    update public.ventas set comision_porcentaje = (p->'comision'->>'porcentaje')::numeric,
                             comision_monto = (p->'comision'->>'monto')::numeric
     where id = v_venta_id;
  end if;

  -- 11. Impuestos (saldo encadenado aquí, con candado por cuenta)
  perform pg_advisory_xact_lock(hashtextextended('mov_imp:' || v_uid::text, 0));
  for v_item in select * from jsonb_array_elements(coalesce(p->'impuestos', '[]'::jsonb)) loop
    begin v_monto := (v_item->>'monto')::numeric; exception when others then v_monto := null; end;
    continue when v_monto is null or v_monto <= 0;
    select saldo_resultante into v_saldo_imp from public.movimientos_impuestos
     where auth_user_id = v_uid order by created_at desc, id desc limit 1;
    v_saldo_imp := coalesce(v_saldo_imp, 0);
    v_fila := v_item || jsonb_build_object('auth_user_id', v_uid, 'tipo_movimiento', 'IVA_VENTA',
      'referencia_venta_id', v_venta_id, 'saldo_anterior', v_saldo_imp, 'saldo_resultante', v_saldo_imp + v_monto,
      'impuesto_id', public._offline_ref(v_uid, 'impuestos', v_item->>'impuesto_id'), 'created_at', clock_timestamp(),
      'concepto', public._offline_numero_en_texto(v_item->>'concepto', v_num_texto, v_numero));
    perform public._offline_insertar('movimientos_impuestos', v_fila, c_imp);
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p->'venta_impuestos', '[]'::jsonb)) loop
    perform public._offline_insertar('venta_impuestos', v_item || jsonb_build_object('auth_user_id', v_uid,
      'venta_id', v_venta_id, 'impuesto_id', public._offline_ref(v_uid, 'impuestos', v_item->>'impuesto_id')), c_vimp);
  end loop;

  -- 12. Retención IR a favor
  if jsonb_typeof(p->'retencion') = 'object' and coalesce((p->'retencion'->>'monto')::numeric, 0) > 0 then
    perform public._offline_insertar('retenciones_ir', (p->'retencion') || jsonb_build_object('auth_user_id', v_uid,
      'lado', 'a_favor', 'origen', 'venta', 'venta_id', v_venta_id, 'estado', 'pendiente'), c_ret);
  end if;

  -- 13. Cliente (suma atómica)
  if v_cliente is not null then
    update public.clientes set total_compras = coalesce(total_compras, 0) + v_total, num_compras = coalesce(num_compras, 0) + 1
     where id = v_cliente and auth_user_id = v_uid;
  end if;

  -- 14. Garantías (número y vencimiento como en la web)
  for v_item in select * from jsonb_array_elements(coalesce(p->'garantias', '[]'::jsonb)) loop
    continue when coalesce((v_item->>'garantia_meses')::numeric, 0) <= 0;
    v_garantia_num := public.generar_numero_garantia(v_uid);
    perform public._offline_insertar('garantias_clientes', (v_item - 'numero') || jsonb_build_object(
      'auth_user_id', v_uid, 'venta_id', v_venta_id, 'origen', 'automatica', 'numero', v_garantia_num,
      'cliente_id', v_cliente, 'cliente_nombre', case when v_cliente is not null then v_item->>'cliente_nombre' end,
      'producto_id', public._offline_ref(v_uid, 'productos', v_item->>'producto_id'),
      'fecha_compra', coalesce((v_item->>'fecha_compra')::date, v_fecha_hoy),
      'fecha_vencimiento', public._offline_sumar_meses_js(coalesce((v_item->>'fecha_compra')::date, v_fecha_hoy), (v_item->>'garantia_meses')::numeric)), c_gar);
  end loop;

  -- 15. Bitácora de auditoría: las mismas filas que deja auditoria-guard.js en la web
  if jsonb_typeof(p->'auditoria') = 'array' and jsonb_array_length(p->'auditoria') <= 200 then
    for v_item in select * from jsonb_array_elements(p->'auditoria') loop
      continue when jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'tabla', '') = '' or coalesce(v_item->>'accion', '') = '';
      perform public._offline_insertar('auditoria_log', jsonb_build_object(
        'auth_user_id', v_uid, 'created_at', v_creada,
        'perfil_nombre', coalesce(left(v_item->>'perfil_nombre', 120), 'Admin'), 'perfil_tipo', coalesce(left(v_item->>'perfil_tipo', 40), 'admin'),
        'modulo', coalesce(left(v_item->>'modulo', 120), 'ventas.html'), 'tabla', left(v_item->>'tabla', 80), 'accion', left(v_item->>'accion', 20),
        'resumen', public._offline_numero_en_texto(left(v_item->>'resumen', 500), v_num_texto, v_numero)), c_aud);
    end loop;
  end if;

  -- 16. Alertas y control
  insert into public.offline_alertas (auth_user_id, venta_id, venta_uuid, numero_venta, tipo, mensaje, detalle)
  select v_uid, v_venta_id, v_uuid, v_numero, a->>'tipo', a->>'mensaje', coalesce(a->'detalle', '{}'::jsonb)
    from jsonb_array_elements(v_alertas) a;
  v_res := jsonb_build_object('ok', true, 'venta_id', v_venta_id, 'numero_venta', v_numero,
    'numero_reemplazado', v_reemplazado, 'alertas', v_alertas, 'repetida', false);
  insert into public.offline_ventas_recibidas (uuid, auth_user_id, dispositivo_id, venta_id, numero_venta, numero_dispositivo,
    numero_reemplazado, huella, vendida_en, desfase_reloj_seg, resultado)
  values (v_uuid, v_uid, v_disp.id, v_venta_id, v_numero, v_num_disp, v_reemplazado, v_huella, v_creada, v_desfase, v_res);
  update public.offline_dispositivos set ultimo_contacto = now() where id = v_disp.id;
  return v_res;
end $f$;
revoke all on function public.offline_registrar_venta(jsonb) from public, anon;
grant execute on function public.offline_registrar_venta(jsonb) to authenticated;
