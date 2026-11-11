-- =====================================================================
-- FINANCIERA · Cuenta de demostración "Crédito Fácil Nicaragua" (10-nov-2026)
-- SOLO AGREGA: una cuenta demo con el Panel Microfinanciera encendido:
-- 3 cobradores, 15 clientes, 14 préstamos (diarios, semanales, quincenales y
-- mensuales) en distintos estados: al día, atrasados (con mora), uno ya
-- cancelado y dos que todavía no empiezan a pagar.
-- Los préstamos y cobros se hacen con las MISMAS funciones del sistema
-- (mf_credito_crear / mf_cobrar): caja, cuotas, saldos y reportes cuadran
-- igual que en una cuenta real. No toca ninguna otra cuenta.
-- =====================================================================
create or replace function public._financiera_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-financiera@negocio360oficial.com';
  v_hoy date := (now() at time zone 'America/Managua')::date;
  clis uuid[]; cobs uuid[]; v_pid uuid; r record; res jsonb; v_cred uuid; v_pagar numeric; v_venc integer; v_n integer; k integer := 0;
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Financiera ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoFinanciera#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Crédito Fácil', 'email_verified', true, 'nombre_negocio', 'Crédito Fácil Nicaragua', 'phone_verified', false),
    now() - interval '32 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Crédito Fácil Nicaragua', 'demo_publica', 'financiera', 'Demo de financiera / préstamos: Panel Microfinanciera con 3 cobradores, 15 clientes y 14 préstamos (al día, atrasados con mora, cancelado y por empezar). Sin multiusuario.', 24);
  update public.usuarios set nombre = 'Demo', apellido = 'Crédito Fácil', nombre_negocio = 'Crédito Fácil Nicaragua', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  perform set_config('n360.mf_ok', '1', true);
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, direccion, telefono, whatsapp,
    control_inventario, alerta_stock_bajo, gestiona_clientes, historial_compras, usa_modelo_producto, usa_modulo_microfinanciera, mf_dias_cobro, mf_mora_tipo)
  values (u, 'Crédito Fácil Nicaragua', 'financiera', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false}}'::jsonb, false, true, 'Mercado Roberto Huembes, módulo 14, Managua', '2249-6060', '88006060',
    false, false, true, true, false, true, 'lun_sab', 'ninguna')
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, direccion = excluded.direccion, telefono = excluded.telefono,
    whatsapp = excluded.whatsapp, control_inventario = false, gestiona_clientes = true, historial_compras = true, usa_modelo_producto = false,
    usa_modulo_microfinanciera = true, mf_dias_cobro = 'lun_sab', mf_mora_tipo = 'ninguna';
  perform set_config('n360.mf_ok', '', true);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into public.metodos_pago(auth_user_id, nombre, activo, es_default, orden)
  select u, m.n, true, m.o = 1, m.o from (values ('Efectivo', 1), ('Transferencia', 2)) m(n, o)
   where not exists (select 1 from public.metodos_pago x where x.auth_user_id = u and lower(x.nombre) = lower(m.n));
  insert into public.bancos(auth_user_id, nombre, activo, saldo_inicial, moneda) values (u, 'Banpro', true, 0, 'NIO');

  -- Capital con el que arranca la financiera (lo que el dueño mete a caja para prestar)
  insert into public.movimientos_financieros(auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, metodo_pago_nombre, fecha, estado)
  values (u, 'INGRESO', 'CAPITAL_AGREGADO', 'Capital inicial para préstamos', 150000, 0, 0, 'Efectivo', v_hoy - 31, 'completado');

  -- Cobradores (para ver la cartera y la ruta por cobrador)
  for r in select * from (values ('Juan Carlos Pérez', '#16a34a', 1), ('Marvin Soza', '#2563eb', 2), ('Yolanda Ruiz', '#db2777', 3)) t(f1, f2, o) order by o loop
    insert into public.perfiles_acceso(auth_user_id, nombre, tipo, avatar_color, activo, modulos) values (u, r.f1, 'restringido', r.f2, true, '[]'::jsonb) returning id into v_pid;
    insert into public.mf_equipo(perfil_id, auth_user_id, rol, puede_vender, activo) values (v_pid, u, 'cobrador', true, true);
    cobs := array_append(cobs, v_pid);
  end loop;

  insert into public.clientes(auth_user_id, nombre, apellido, telefono, direccion, ciudad, activo) values
    (u, 'Rosa', 'Mendoza', '88112233', 'Mercado Huembes, tramo de verduras', 'Managua', true),
    (u, 'Francisco', 'Úbeda', '87223344', 'Barrio Riguero, casa 45', 'Managua', true),
    (u, 'Martha', 'Castillo', '86334455', 'Mercado Oriental, tienda La Esquina', 'Managua', true),
    (u, 'Julio', 'Zeledón', '85445566', 'Colonia Centroamérica, G-120', 'Managua', true),
    (u, 'Ana', 'Gaitán', '84556677', 'Barrio San Judas, de la cruz 2c. abajo', 'Managua', true),
    (u, 'Roberto', 'Lacayo', '88667788', 'Villa Libertad, casa B-33', 'Managua', true),
    (u, 'Carmen', 'Espinoza', '87778899', 'Ciudad Sandino, zona 5', 'Ciudad Sandino', true),
    (u, 'Denis', 'Montoya', '86889900', 'Barrio Monseñor Lezcano', 'Managua', true),
    (u, 'Ligia', 'Sequeira', '85990011', 'Reparto Schick, 4ta etapa', 'Managua', true),
    (u, 'Óscar', 'Aguilar', '84001122', 'Mercado Iván Montenegro', 'Managua', true),
    (u, 'Patricia', 'Rocha', '88113355', 'Barrio Altagracia, costado norte', 'Managua', true),
    (u, 'Henry', 'Blandón', '87224466', 'Tipitapa, barrio Rolando Rodríguez', 'Tipitapa', true),
    (u, 'Maribel', 'Torrez', '86335577', 'Barrio Jorge Dimitrov', 'Managua', true),
    (u, 'Wilmer', 'Obregón', '85446688', 'Mercado Mayoreo, bodega 7', 'Managua', true),
    (u, 'Elena', 'Cruz', '84557799', 'Barrio Larreynaga', 'Managua', true);
  select array_agg(id order by nombre, apellido) into clis from public.clientes where auth_user_id = u;

  -- Préstamos: cliente, monto, % interés, frecuencia, cuotas, días desde la 1ª cuota (negativo = ya empezó), estado a dejar, cobrador
  for r in select * from (values
      (1, 3000, 20, 'diaria', 24, -20, 'al_dia', 1),
      (2, 5000, 20, 'diaria', 30, -25, 'atrasado', 1),
      (3, 2000, 20, 'diaria', 20, -27, 'cancelado', 1),
      (4, 8000, 30, 'semanal', 12, -28, 'al_dia', 2),
      (5, 10000, 30, 'semanal', 12, -21, 'atrasado', 2),
      (6, 6000, 25, 'semanal', 8, -14, 'al_dia', 2),
      (7, 15000, 35, 'quincenal', 8, -30, 'al_dia', 3),
      (8, 12000, 35, 'quincenal', 6, -16, 'atrasado', 3),
      (9, 25000, 40, 'mensual', 6, -29, 'al_dia', 3),
      (10, 20000, 40, 'mensual', 6, 5, 'nuevo', 1),
      (11, 4000, 25, 'semanal', 8, 2, 'nuevo', 2),
      (12, 3500, 20, 'diaria', 24, -10, 'al_dia', 3),
      (13, 7000, 30, 'semanal', 10, -7, 'al_dia', 1),
      (14, 2500, 20, 'diaria', 20, -15, 'atrasado', 2)
    ) t(cli, monto, ipct, frec, ncuotas, inicio, estado, cob) loop
    k := k + 1;
    res := public.mf_credito_crear(jsonb_build_object('tipo', 'efectivo', 'cliente_id', clis[r.cli], 'monto', r.monto, 'interes_pct', r.ipct,
      'frecuencia', r.frec, 'num_cuotas', r.ncuotas, 'primera_fecha', v_hoy + r.inicio, 'dias_cobro', 'lun_sab',
      'cobrador_id', cobs[r.cob], 'ref', 'demo-fin-' || k, 'creado_por', 'Demo'));
    if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Préstamo demo % no se creó: %', k, res; end if;
    v_cred := (res ->> 'credito_id')::uuid;

    if r.estado = 'cancelado' then
      select saldo_pendiente into v_pagar from public.creditos where id = v_cred;
    elsif r.estado in ('al_dia', 'atrasado') then
      select count(*) into v_venc from public.creditos_cuotas where credito_id = v_cred and fecha_vencimiento <= v_hoy;
      v_n := case when r.estado = 'al_dia' then v_venc else greatest(0, v_venc - case when r.frec = 'diaria' then 4 else 2 end) end;
      select coalesce(sum(monto_total), 0) into v_pagar from (select monto_total from public.creditos_cuotas where credito_id = v_cred order by numero limit v_n) x;
    else
      v_pagar := 0;
    end if;
    if v_pagar > 0 then
      res := public.mf_cobrar(jsonb_build_object('credito_id', v_cred, 'monto', v_pagar, 'metodo_pago_nombre', 'Efectivo',
        'ref', 'demo-fin-pago-' || k, 'creado_por', 'Demo'));
      if not coalesce((res ->> 'ok')::boolean, false) then raise exception 'Cobro demo % no se registró: %', k, res; end if;
    end if;
  end loop;

  -- Mora por atraso: C$10 por día de atraso, 1 día de gracia, tope 20% de lo atrasado (se activa al final,
  -- así los atrasados la muestran pendiente y los que están al día no tienen nada).
  perform set_config('n360.mf_ok', '1', true);
  update public.configuracion_empresa set mf_mora_tipo = 'fija_dia', mf_mora_valor = 10, mf_mora_gracia = 1, mf_mora_tope_pct = 20 where auth_user_id = u;
  perform set_config('n360.mf_ok', '', true);
  return u;
end $f$;
revoke all on function public._financiera_demo_crear() from public, anon, authenticated;

select public._financiera_demo_crear();
