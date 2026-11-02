-- =====================================================================
-- MENSAJERÍA · Cuenta de demostración "Envíos Express Managua"
-- SOLO AGREGA: una cuenta demo pública (como las demás demos) con datos de ejemplo. Todo se registra con
-- las MISMAS funciones del módulo (envíos, entregas, cuadres con su venta, liquidación y pago), así el
-- dinero de la demo cuadra igual que en una cuenta real. Cada día msj_demo_preparar() le agrega envíos.
-- No toca ninguna otra cuenta.
-- =====================================================================
create or replace function public._msj_demo_crear() returns uuid
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := gen_random_uuid(); correo text := 'demo-mensajeria@negocio360oficial.com'; x jsonb; d integer; i integer; k integer := 0;
  z uuid[]; com uuid[]; reps uuid[]; bco uuid; e uuid; v_ids uuid[]; r record; v_hoy date := (now() at time zone 'America/Managua')::date;
  nombres text[] := array['María Gutiérrez','José Martínez','Karla Rivas','Luis Obando','Ana Pérez','Carlos López','Sofía Cruz','Pedro Arias','Daniela Vega','Jorge Sandino','Valeria Ortiz','Rodrigo Mena'];
  barrios text[] := array['Bello Horizonte, casa D-14','Altamira, de la Vicky 2c al sur','Villa Fontana, casa 35','Linda Vista, frente al parque','Las Colinas, calle 3',
                          'Ciudad Jardín, módulo G-12','Reparto San Juan, casa 210','Bolonia, del canal 2 1/2c abajo','Los Robles, casa 48','Monseñor Lezcano, de la iglesia 1c norte'];
begin
  if exists (select 1 from auth.users where email = correo) then raise exception 'La demo de Mensajería ya existe.'; end if;
  perform set_config('n360.alta_directa', 'on', true);
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo, extensions.crypt('DemoMensajeria#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', u, 'plan', 'premium', 'email', correo, 'nombre', 'Demo', 'apellido', 'Envíos Express', 'email_verified', true, 'nombre_negocio', 'Envíos Express Managua', 'phone_verified', false),
    now() - interval '20 days', now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (u::text, u, jsonb_build_object('sub', u, 'email', correo, 'email_verified', false, 'phone_verified', false), 'email', now(), now(), now());
  perform set_config('n360.alta_directa', '', true);

  insert into public.cuentas_prueba(auth_user_id, etiqueta, tipo, rubro, nota, orden)
  values (u, 'Demo Envíos Express Managua', 'demo_publica', 'mensajeria', 'Demo pública de Mensajería / Delivery con datos de ejemplo; cada día se le agregan envíos (msj_demo_preparar). Sin multiusuario.', 20);
  update public.usuarios set nombre = 'Demo', apellido = 'Envíos Express', nombre_negocio = 'Envíos Express Managua', plan = 'premium', estado_cuenta = 'activa',
         onboarding_completado = true, multiusuario_activo = false where auth_user_id = u;
  insert into public.configuracion_empresa(auth_user_id, nombre_comercial, tipo_negocio, pais, ciudad, zona_horaria, moneda, onboarding_completado, onboarding_step,
    modulos_habilitados, metadata, catalogo360_desbloqueado, catalogo360_regalo_mostrado, usa_modulo_mensajeria, direccion, telefono, whatsapp)
  values (u, 'Envíos Express Managua', 'mensajeria', 'NI', 'Managua', 'America/Managua', 'NIO', true, 5,
    '{"caja":true,"gastos":true,"ventas":true,"compras":true,"clientes":true,"reportes":true,"inventario":true}'::jsonb,
    '{"modulosOpcionales":{"catalogo360":false},"mensajeria_demo":"true"}'::jsonb, false, true, true, 'Km 4 Carretera a Masaya, Managua', '2278-5500', '88005500')
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, tipo_negocio = excluded.tipo_negocio, onboarding_completado = true, onboarding_step = 5,
    metadata = excluded.metadata, catalogo360_desbloqueado = false, catalogo360_regalo_mostrado = true, usa_modulo_mensajeria = true,
    direccion = excluded.direccion, telefono = excluded.telefono, whatsapp = excluded.whatsapp;
  -- Todo lo que sigue se registra como lo haría la persona que usa la demo (auth.uid() = la demo)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into public.metodos_pago(auth_user_id, nombre, activo) select u, m, true from unnest(array['Efectivo', 'Transferencia']) m
   where not exists (select 1 from public.metodos_pago p where p.auth_user_id = u and lower(p.nombre) = lower(m));
  insert into public.bancos(auth_user_id, nombre, activo, saldo_inicial, moneda) values (u, 'BAC Credomatic', true, 0, 'NIO') returning id into bco;

  x := public.msj_config_guardar('{"recargo_urgente":30,"recargo_grande":40,"recargo_reintento":20,"tope_efectivo":3000,"cobrar_devueltos":true}');
  for r in select * from (values ('Managua Centro', 80), ('Managua Sur', 90), ('Managua Norte', 90), ('Carretera a Masaya', 110), ('Ciudad Sandino', 120), ('Tipitapa', 130)) t(n, p) loop
    x := public.msj_zona_guardar(jsonb_build_object('nombre', r.n, 'tarifa', r.p));
  end loop;
  select array_agg(id order by tarifa, nombre) into z from public.mensajeria_zonas where auth_user_id = u;
  insert into public.clientes(auth_user_id, nombre, telefono, direccion, activo) values
    (u, 'Boutique Valeria', '88123456', 'Galerías Santo Domingo, local 12', true), (u, 'Tecno Store NI', '87654321', 'Metrocentro, módulo 45', true),
    (u, 'Dulcería La Abuela', '89001122', 'Barrio San Judas, de la iglesia 1c al sur', true), (u, 'Farmacia San Lucas', '22663344', 'Reparto Schick, frente al parque', true),
    (u, 'Zapatería Paso Firme', '86557788', 'Mercado Roberto Huembes, módulo B-7', true);
  select array_agg(id order by nombre) into com from public.clientes where auth_user_id = u;
  x := public.msj_tarifa_comercio_guardar(com[4], z[1], 70);   -- Tecno Store NI (4.º por nombre): precio especial en Managua Centro
  for r in select * from (values ('Kevin Rocha', '88771100', 'independiente', 'moto', 'por_entrega', 35), ('Marlon Aguirre', '87223344', 'independiente', 'moto', 'por_entrega', 35),
                                 ('Yader López', '85339911', 'independiente', 'moto', 'porcentaje', 40), ('Ervin Téllez', '84112299', 'empleado', 'carro', 'ninguno', 0)) t(n, tel, tp, veh, pt, pv) loop
    x := public.msj_repartidor_guardar(jsonb_build_object('nombre', r.n, 'telefono', r.tel, 'tipo', r.tp, 'vehiculo', r.veh, 'pago_tipo', r.pt, 'pago_valor', r.pv, 'tope_efectivo', null));
  end loop;
  select array_agg(id order by nombre) into reps from public.mensajeria_repartidores where auth_user_id = u;   -- Ervin, Kevin, Marlon, Yader

  -- Nueve días de trabajo: cada envío se crea, se asigna, sale a ruta y se entrega (o no) con las funciones del módulo
  for d in reverse 9 .. 1 loop
    v_ids := '{}';
    for i in 1 .. 5 + (d % 3) loop
      k := k + 1;
      x := public._msj_envio_insertar(u, jsonb_build_object('comercio_id', com[1 + (k % 5)], 'destinatario_nombre', nombres[1 + (k % 12)],
        'destinatario_telefono', '8' || lpad(((k * 7919) % 10000000)::text, 7, '0'), 'direccion', barrios[1 + (k % 10)], 'zona_id', z[1 + (k % 6)],
        'monto_cobrar', case when k % 4 = 0 then 0 else 300 + (k * 137) % 1200 end, 'envio_lo_paga', case when k % 3 = 0 then 'destinatario' else 'comercio' end,
        'urgente', k % 9 = 0, 'tamano', case when k % 7 = 0 then 'grande' else 'pequeno' end, 'descripcion', 'Pedido en línea', 'en_bodega', true), 'Demo');
      e := (x ->> 'id')::uuid; v_ids := v_ids || e;
      x := public.msj_envios_asignar(array[e], reps[2 + (k % 3)], 'Demo');
      x := public.msj_envio_estado(e, 'en_ruta', null, 'Demo');
      if k % 11 = 0 then
        x := public.msj_envio_estado(e, 'no_entregado', 'No estaba nadie', 'Demo');
        if k % 2 = 0 then x := public.msj_envio_estado(e, 'devuelto', 'No contestó en dos intentos', 'Demo'); end if;
      else
        x := public.msj_envio_entregar(e, jsonb_build_object('recibio_nombre', nombres[1 + (k % 12)], 'metodo_cobro', case when k % 5 = 0 then 'transferencia' else 'efectivo' end, 'por', 'Demo'));
      end if;
    end loop;
    -- Fechas de ese día (solo los envíos y su historial; el dinero queda con la fecha en que se registra)
    update public.mensajeria_envios set created_at = created_at - make_interval(days => d, hours => 3), entregado_at = entregado_at - make_interval(days => d, hours => 1),
           updated_at = updated_at - make_interval(days => d) where id = any(v_ids);
    update public.mensajeria_envio_eventos set created_at = created_at - make_interval(days => d, hours => 2) where envio_id = any(v_ids);
  end loop;

  -- Cuadre de cada repartidor (Marlon entrega 50 de menos: queda debiendo)
  for r in select id, nombre from public.mensajeria_repartidores where auth_user_id = u and id = any(reps[2:4]) loop
    x := public.msj_cuadre_pendiente(r.id);
    if jsonb_array_length(x -> 'envios') > 0 then
      x := public.msj_cuadre_cerrar(jsonb_build_object('repartidor_id', r.id, 'envio_ids', (select jsonb_agg(v -> 'id') from jsonb_array_elements(x -> 'envios') v),
             'entregado', (x ->> 'esperado_cod')::numeric + (x ->> 'esperado_envio')::numeric - case when r.nombre = 'Marlon Aguirre' then 50 else 0 end, 'banco_id', bco, 'por', 'Demo'));
    end if;
  end loop;
  -- Liquidación de dos comercios y pago a un repartidor
  for i in 1 .. 2 loop
    x := public.msj_liquidacion_pendiente(com[i]);
    if jsonb_array_length(x -> 'envios') > 0 then
      x := public.msj_liquidacion_registrar(jsonb_build_object('comercio_id', com[i], 'envio_ids', (select jsonb_agg(v -> 'id') from jsonb_array_elements(x -> 'envios') v),
             'tarifas_metodo', 'efectivo', 'pago_metodo', 'transferencia', 'pago_banco_id', bco, 'por', 'Demo'));
    end if;
  end loop;
  x := public.msj_pago_pendiente(reps[2]);
  if jsonb_array_length(x -> 'envios') > 0 then
    x := public.msj_pago_registrar(jsonb_build_object('repartidor_id', reps[2], 'envio_ids', (select jsonb_agg(v -> 'id') from jsonb_array_elements(x -> 'envios') v), 'metodo', 'efectivo', 'por', 'Demo'));
  end if;
  -- Hoy: envíos nuevos, algunos ya en camino, y la última ubicación de Kevin
  x := public.msj_demo_preparar();
  select array_agg(id order by numero) into v_ids from public.mensajeria_envios where auth_user_id = u and creado_por = 'Demo · del día';
  if cardinality(v_ids) >= 3 then
    x := public.msj_envios_asignar(v_ids[1:3], reps[2], 'Demo');
    x := public.msj_envio_estado(v_ids[1], 'en_ruta', null, 'Demo');
  end if;
  x := public.msj_ubicacion_enviar(reps[2], 12.1287, -86.2652, 20);
  x := public.msj_portal_link(com[1]);
  return u;
end $f$;
revoke all on function public._msj_demo_crear() from public, anon, authenticated;

select public._msj_demo_crear();
