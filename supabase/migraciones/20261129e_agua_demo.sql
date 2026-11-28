-- =====================================================================
-- PANEL AGUA · Cuenta de demostración "Agua Pozo Las Brisas" (29-nov-2026)
-- SOLO AGREGA: una cuenta demo nueva con el Panel Agua encendido. No toca ninguna otra cuenta.
-- 18 abonados con código (residenciales y 3 comerciales con IVA), cobros de septiembre, octubre y
-- noviembre, pagos hechos con la venta del sistema (Caja, IVA y reportes cuadran), mora, un pago parcial,
-- saldo a favor, meses por adelantado, un arreglo de pago, un cortado y un pausado.
-- Todo se registra con las MISMAS funciones del panel, como lo haría la persona en la pantalla.
-- =====================================================================

-- Ayudante interno (solo para esta demo): cobra a un abonado con la venta del sistema y aplica el pago.
create or replace function public._agua_demo_pagar(u uuid, p_ab uuid, p_cargos uuid[], p_monto numeric, p_fecha date,
                                                   p_metodo text, p_bco uuid, p_adelanto int default 0)
returns void language plpgsql security definer set search_path = public, extensions as $f$
declare res jsonb; v jsonb; mp record; v_num text; v_base numeric; v_iva numeric; v_prod uuid; v_venta uuid; v_det jsonb; v_ant numeric; v_ts timestamptz;
begin
  res := public.agua_preparar_cobro(p_ab, p_cargos, p_monto, p_adelanto, 'Oficina');
  v_base := (res->>'base')::numeric; v_iva := (res->>'iva')::numeric;
  select id into v_prod from public.productos where auth_user_id = u and nombre = 'Servicio de agua' and tipo = 'servicio' limit 1;
  select * into mp from public.metodos_pago where auth_user_id = u and nombre = p_metodo;
  v_num := public.generar_numero_venta(u);
  v_det := jsonb_build_object('producto_id', v_prod, 'producto_nombre', left(res->>'concepto', 240), 'producto_sku', null, 'tipo_item', 'servicio',
             'cantidad', 1, 'precio', v_base, 'costo', 0, 'descuento', 0, 'subtotal', v_base, 'ganancia', v_base);
  if v_iva > 0 then v_det := v_det || jsonb_build_object('iva_tarifa', (res->>'iva_pct')::numeric, 'iva_monto', v_iva); end if;
  v := public.venta_registrar_atomica(
    jsonb_build_object('numero_venta', v_num, 'cliente_id', (res->>'cliente_id')::uuid, 'cliente_nombre',
        (select trim(nombre || ' ' || coalesce(apellido, '')) from public.agua_abonados where id = p_ab), 'fecha', p_fecha,
      'subtotal', v_base, 'descuento', 0, 'impuesto', v_iva, 'total', p_monto, 'costo_total', 0,
      'metodo_pago_id', mp.id, 'metodo_pago_nombre', mp.nombre, 'creado_por_nombre', 'Oficina', 'estado', 'completada',
      'observaciones', 'Abonado ' || (res->>'codigo'), 'iva_activo', v_iva > 0, 'iva_porcentaje', case when v_iva > 0 then (res->>'iva_pct')::numeric else 0 end),
    jsonb_build_array(v_det), '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('concepto', 'Venta ' || v_num || case when v_iva > 0 then ' (neto de IVA)' else '' end,
      'monto', round(p_monto - v_iva, 2), 'metodo_pago_id', mp.id, 'metodo_pago_nombre', mp.nombre,
      'banco_id', case when mp.nombre = 'Transferencia' then p_bco end,
      'monto_moneda_banco', case when mp.nombre = 'Transferencia' then round(p_monto - v_iva, 2) end, 'fecha', p_fecha)),
    p_monto, null);
  v_venta := (v->>'venta_id')::uuid;
  if v_venta is null then raise exception 'Demo agua: la venta no se guardó: %', v; end if;
  if v_iva > 0 then
    select coalesce((select saldo_resultante from public.movimientos_impuestos where auth_user_id = u order by created_at desc limit 1), 0) into v_ant;
    insert into public.movimientos_impuestos(auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, referencia_venta_id, fecha)
    values (u, 'IVA_VENTA', 'IVA de venta ' || v_num, v_iva, v_ant, v_ant + v_iva, v_venta, p_fecha);
  end if;
  v := public.agua_confirmar_cobro((res->>'cobro_id')::uuid, v_venta);
  if not coalesce((v->>'ok')::boolean, false) then raise exception 'Demo agua: el pago no se aplicó: %', v; end if;
  -- Fecha real del pago (para que el historial se vea como en la vida real)
  v_ts := (p_fecha + time '10:30') at time zone 'America/Managua';
  update public.agua_cobros set created_at = v_ts, aplicado_en = v_ts where id = (res->>'cobro_id')::uuid;
  update public.agua_eventos set created_at = v_ts where auth_user_id = u and data->>'cobro_id' = res->>'cobro_id';
end $f$;
revoke all on function public._agua_demo_pagar(uuid, uuid, uuid[], numeric, date, text, uuid, int) from public, anon, authenticated;

create or replace function public._agua_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-agua@negocio360oficial.com';
  bco uuid; r record; res jsonb; filas jsonb := '[]'::jsonb; per date; m int; k int; v_ab record; v_ids uuid[]; v_monto numeric; v_plan text; v_dia int;
  meses date[] := array['2026-09-01'::date, '2026-10-01'::date, '2026-11-01'::date];
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Agua Pozo Las Brisas ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoAgua#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Las Brisas', 'email_verified', true, 'nombre_negocio', 'Agua Pozo Las Brisas', 'phone_verified', false),
    now() - interval '90 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Agua Pozo Las Brisas', 'demo_publica', 'agua',
          'Demo de venta de agua de pozo por mensualidad: abonados con código, cobro del mes, mora, arreglos de pago, cortes y reconexión, todo cobrado con Ventas (Caja e IVA cuadran).', 61);
  update public.usuarios set nombre = 'Demo', apellido = 'Las Brisas', nombre_negocio = 'Agua Pozo Las Brisas', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto)
  values (u, 'Agua Pozo Las Brisas', 'servicios', 'NI', 'Masaya', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Residencial Las Brisas, de la entrada 300 m al sur, Masaya', '2522-4040', '88404040',
    false, false, true, true, false)
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, direccion = excluded.direccion, telefono = excluded.telefono,
    whatsapp = excluded.whatsapp, control_inventario = false, alerta_stock_bajo = false, gestiona_clientes = true, historial_compras = true, usa_modelo_producto = false;

  -- Todo lo que sigue se registra como lo haría la persona que usa la demo (auth.uid() = la demo)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into public.metodos_pago(auth_user_id, nombre, activo, es_default, orden)
  select u, m.n, true, m.o = 1, m.o from (values ('Efectivo', 1), ('Transferencia', 2), ('Tarjeta', 3)) m(n, o)
   where not exists (select 1 from public.metodos_pago x where x.auth_user_id = u and lower(x.nombre) = lower(m.n));
  insert into public.bancos(auth_user_id, nombre, activo, saldo_inicial, moneda) values (u, 'Banpro', true, 0, 'NIO') returning id into bco;

  -- Panel Agua encendido, con mora fija de C$50 a los 5 días, corte a los 2 meses y reconexión de C$150
  update public.configuracion_empresa set usa_modulo_agua = true where auth_user_id = u;
  res := public.agua_guardar_config(jsonb_build_object('dias_gracia', 5, 'mora_tipo', 'fijo', 'mora_valor', 50, 'meses_corte', 2,
           'reconexion', 150, 'iva_pct', 15, 'prefijo', 'AB-', 'dia_cobro', 5, 'menu_exclusivo', true));
  insert into public.productos(auth_user_id, tipo, nombre, precio, costo, stock_actual, activo, categoria)
  values (u, 'servicio', 'Servicio de agua', 0, 0, 0, true, 'Agua');

  -- Abonados (como si se importaran desde la plantilla de Excel)
  -- plan por mes (sep, oct, nov): P = pagó el mes · H = pagó la mitad · A = pagó y adelantó 2 meses · - = no pagó · Z = se pausa después de pagar
  for r in select * from (values
    ('AB-0001', 'María José', 'López', '8811-2001', 'Las Brisas', 'Casa 12, calle principal', 250, 5, false, 0, 0, 'PPP'),
    ('AB-0002', 'Juan Carlos', 'Pérez', '8811-2002', 'Las Brisas', 'Casa 15, calle principal', 250, 5, false, 0, 0, 'PPP'),
    ('AB-0003', 'Ana Lucía', 'Martínez', '8811-2003', 'Las Brisas', 'Casa 21, frente al parque', 250, 10, false, 0, 0, 'PP-'),
    ('AB-0004', 'Pedro Antonio', 'Gómez', '8811-2004', 'Las Brisas', 'Casa 30, pasaje 2', 250, 5, false, 0, 0, 'P--'),
    ('AB-0005', 'Rosa Elena', 'Castillo', '8811-2005', 'Los Laureles', 'Lote 4, andén 1', 250, 28, false, 0, 0, 'PP-'),
    ('AB-0006', 'Luis Alberto', 'Rivera', '8811-2006', 'Los Laureles', 'Lote 9, andén 2', 300, 28, false, 0, 0, 'PP-'),
    ('AB-0007', 'Carmen Sofía', 'Ruiz', '8811-2007', 'Los Laureles', 'Lote 11, andén 2', 250, 15, false, 0, 0, 'PPH'),
    ('AB-0008', 'José Ramón', 'Herrera', '8811-2008', 'Los Laureles', 'Lote 17, andén 3', 250, 5, false, 0, 0, '---'),
    ('AB-0009', 'Martha Isabel', 'Flores', '8811-2009', 'El Calvario', 'Del pozo 1 c. al este', 250, 5, false, 0, 0, 'PPP'),
    ('AB-0010', 'Francisco Javier', 'Mendoza', '8811-2010', 'El Calvario', 'Del pozo 2 c. al este', 350, 5, false, 0, 0, 'P--'),
    ('AB-0011', 'Yessenia del Carmen', 'Ortiz', '8811-2011', 'El Calvario', 'Del pozo 1 c. al sur', 250, 5, false, 0, 900, '...'),
    ('AB-0012', 'Roberto Carlos', 'Sánchez', '8811-2012', 'El Calvario', 'Del pozo 3 c. al sur', 250, 5, false, 0, 0, 'Z..'),
    ('AB-0013', 'Pulpería La Bendición', null, '8811-2013', 'Comercial', 'Esquina del parque', 600, 5, true, 0, 0, 'PPP'),
    ('AB-0014', 'Comedor Doña Tere', null, '8811-2014', 'Comercial', 'Frente a la escuela', 600, 28, true, 0, 0, 'PP-'),
    ('AB-0015', 'Taller Hermanos Ríos', null, '8811-2015', 'Comercial', 'Carretera, km 2', 450, 10, true, 0, 0, 'PP-'),
    ('AB-0016', 'Lucía Fernanda', 'Torres', '8811-2016', 'Las Brisas', 'Casa 40, pasaje 3', 250, 5, false, 500, 0, 'PPP'),
    ('AB-0017', 'Gladys Margarita', 'Vega', '8811-2017', 'Los Laureles', 'Lote 22, andén 4', 250, 5, false, 0, 0, 'PPA'),
    ('AB-0018', 'Karla Vanessa', 'Morales', '8811-2018', 'El Calvario', 'Del pozo 4 c. al norte', 250, 20, false, 0, 0, 'PPP')
  ) t(cod, nom, ape, tel, sector, dir, cuota, dia, iva, deuda, favor, plan) loop
    filas := filas || jsonb_build_array(jsonb_build_object('codigo', r.cod, 'nombre', r.nom, 'apellido', r.ape, 'telefono', r.tel, 'whatsapp', r.tel,
      'sector', r.sector, 'direccion', r.dir, 'cuota', r.cuota, 'dia_cobro', r.dia, 'cobra_iva', r.iva, 'estado', 'activo',
      'fecha_inicio', '2026-09-01', 'deuda', r.deuda, 'meses_atrasados', case when r.deuda > 0 then '2' end, 'saldo_favor', r.favor,
      'notas', r.plan));
  end loop;
  res := public.agua_importar(filas, 'Oficina');
  if not coalesce((res->>'ok')::boolean, false) then raise exception 'Demo agua, importar: %', res; end if;
  update public.agua_eventos set created_at = timestamptz '2026-09-01 09:00-06' where auth_user_id = u and tipo = 'importacion';

  -- Mes por mes: se genera el cobro y se registran los pagos de ese mes
  for m in 1 .. 3 loop
    per := meses[m];
    res := public.agua_generar_mes(per, 'Oficina');
    update public.agua_eventos set created_at = (per + time '08:00') at time zone 'America/Managua'
     where auth_user_id = u and tipo = 'generar_mes' and data->>'periodo' = per::text;
    for v_ab in select * from public.agua_abonados where auth_user_id = u order by codigo loop
      v_plan := substr(v_ab.notas, m, 1);
      continue when v_plan not in ('P', 'H', 'A', 'Z');
      select array_agg(id), sum(monto - pagado) into v_ids, v_monto from public.agua_cargos
       where abonado_id = v_ab.id and tipo = 'mensualidad' and periodo = per and estado in ('pendiente', 'parcial');
      continue when v_ids is null;
      v_dia := least(v_ab.dia_cobro + (ascii(right(v_ab.codigo, 1)) % 4), 27);
      if v_plan = 'H' then v_monto := round(v_monto / 2, 2); end if;
      k := case when v_plan = 'A' then 2 else 0 end;
      if k > 0 then v_monto := v_monto + v_ab.cuota * k; end if;
      perform public._agua_demo_pagar(u, v_ab.id, v_ids, v_monto, least(per + v_dia - 1, current_date),
                                      case when v_ab.cobra_iva or right(v_ab.codigo, 1) in ('2', '9') then 'Transferencia' else 'Efectivo' end, bco, k);
      if v_plan = 'Z' then
        res := public.agua_cambiar_estado(v_ab.id, 'pausado', 'Casa sola, la familia salió del país', false, 'Oficina');
      end if;
    end loop;
  end loop;

  -- Cortado: José Ramón (AB-0008) no pagó ningún mes
  select * into v_ab from public.agua_abonados where auth_user_id = u and codigo = 'AB-0008';
  res := public.agua_cambiar_estado(v_ab.id, 'cortado', 'Corte por 3 meses sin pagar', false, 'Oficina');
  -- Arreglo de pago: Francisco Javier (AB-0010) paga lo atrasado en 3 cuotas
  select * into v_ab from public.agua_abonados where auth_user_id = u and codigo = 'AB-0010';
  select round(sum(monto - pagado), 2) into v_monto from public.agua_cargos
   where abonado_id = v_ab.id and estado in ('pendiente', 'parcial') and arreglo_id is null and vence <= current_date;
  res := public.agua_crear_arreglo(v_ab.id, jsonb_build_array(
           jsonb_build_object('fecha', current_date + 7, 'monto', round(v_monto - 2 * round(v_monto / 3, 2), 2)),
           jsonb_build_object('fecha', current_date + 22, 'monto', round(v_monto / 3, 2)),
           jsonb_build_object('fecha', current_date + 37, 'monto', round(v_monto / 3, 2))),
         'Se comprometió a pagar en 3 partes', 'Oficina');
  -- Las notas solo servían para armar la demo
  update public.agua_abonados set notas = case codigo when 'AB-0012' then 'Casa sola hasta enero' when 'AB-0013' then 'Factura con IVA'
                                                    when 'AB-0014' then 'Factura con IVA' when 'AB-0015' then 'Factura con IVA' else null end
   where auth_user_id = u;
  return u;
end $f$;
revoke all on function public._agua_demo_crear() from public, anon, authenticated;

select public._agua_demo_crear();
