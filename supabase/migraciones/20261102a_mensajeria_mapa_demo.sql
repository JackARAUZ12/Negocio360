-- Mensajería · Mapa en vivo en la cuenta demo (solo afecta a la demo "Envíos Express Managua").
-- msj_demo_preparar ahora, además de los 8 envíos del día: mueve a los repartidores de la demo a puntos
-- de Managua con ubicación reciente y pone ubicación a los envíos activos de la demo que no la tienen.
-- No toca dinero (ventas, Caja, impuestos) ni cuentas reales: sigue revisando que sea la demo pública.

create or replace function public.msj_demo_preparar()
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_hoy date := public._msj_hoy(); n integer := 0; i integer; z uuid[]; c uuid[]; r record; v_res jsonb; k integer := 0; b integer;
  -- Coordenadas aproximadas de cada barrio (mismo orden que "barrios"), para el mapa en vivo de la demo.
  plat numeric[] := array[12.1427, 12.1238, 12.1100, 12.1440, 12.0920, 12.1420, 12.1210, 12.1380, 12.1180, 12.1460];
  plng numeric[] := array[-86.2338, -86.2639, -86.2670, -86.3010, -86.2370, -86.2500, -86.2610, -86.2800, -86.2650, -86.2960];
  nombres text[] := array['María Gutiérrez','José Martínez','Karla Rivas','Luis Obando','Ana Pérez','Carlos López','Sofía Cruz','Pedro Arias','Daniela Vega','Jorge Sandino'];
  barrios text[] := array['Bello Horizonte, casa D-14','Altamira, de la Vicky 2c al sur','Villa Fontana, casa 35','Linda Vista, frente al parque','Las Colinas, calle 3',
                          'Ciudad Jardín, módulo G-12','Reparto San Juan, casa 210','Bolonia, del canal 2 1/2c abajo','Los Robles, casa 48','Monseñor Lezcano, de la iglesia 1c norte'];
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not exists (select 1 from public.cuentas_prueba where auth_user_id = v_uid and tipo = 'demo_publica')
     or not exists (select 1 from public.configuracion_empresa where auth_user_id = v_uid and metadata ->> 'mensajeria_demo' = 'true') then
    return jsonb_build_object('ok', false, 'motivo', 'solo_demo'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('msj_demo_' || v_uid::text));
  -- Mapa en vivo (solo demo): los repartidores aparecen en distintos puntos de Managua, con ubicación reciente
  -- (el último, de hace más de una hora, para que se vea la diferencia de colores).
  for r in select id from public.mensajeria_repartidores where auth_user_id = v_uid and activo order by nombre loop
    k := k + 1;
    update public.mensajeria_repartidores set ubic_lat = round((12.128 + (random() - 0.5) * 0.05)::numeric, 6), ubic_lng = round((-86.262 + (random() - 0.5) * 0.06)::numeric, 6),
      ubic_precision = 8 + floor(random() * 20)::int, ubic_at = case when k >= 4 then now() - interval '75 minutes' else now() - make_interval(secs => floor(random() * 300)::int) end
    where id = r.id;
  end loop;
  -- Envíos activos de la demo sin ubicación: se les pone la del barrio (o una cercana) para verlos en el mapa.
  for r in select id, direccion from public.mensajeria_envios where auth_user_id = v_uid and lat is null and estado in ('por_recoger','en_bodega','asignado','en_ruta','no_entregado') loop
    b := coalesce((select p from generate_subscripts(barrios, 1) p where r.direccion like split_part(barrios[p], ',', 1) || '%' limit 1), 1 + abs(hashtext(r.id::text)) % 10);
    update public.mensajeria_envios set lat = round((plat[b] + (random() - 0.5) * 0.004)::numeric, 6), lng = round((plng[b] + (random() - 0.5) * 0.004)::numeric, 6) where id = r.id;
  end loop;
  if exists (select 1 from public.mensajeria_envios where auth_user_id = v_uid and (created_at at time zone 'America/Managua')::date = v_hoy and creado_por = 'Demo · del día') then
    return jsonb_build_object('ok', true, 'creados', 0); end if;
  select array_agg(id order by nombre) into z from public.mensajeria_zonas where auth_user_id = v_uid and activo;
  select array_agg(id order by nombre) into c from public.clientes where auth_user_id = v_uid and activo;
  for i in 1 .. 8 loop
    v_res := public._msj_envio_insertar(v_uid, jsonb_build_object('comercio_id', c[1 + (i % greatest(cardinality(c), 1))], 'destinatario_nombre', nombres[1 + ((i * 3 + extract(doy from v_hoy)::int) % 10)],
      'destinatario_telefono', '8' || lpad(((i * 7919 + extract(doy from v_hoy)::int * 31) % 10000000)::text, 7, '0'), 'direccion', barrios[1 + ((i + extract(doy from v_hoy)::int) % 10)],
      'zona_id', z[1 + (i % greatest(cardinality(z), 1))], 'monto_cobrar', case when i % 3 = 0 then 0 else 250 + (i * 115) % 900 end,
      'envio_lo_paga', case when i % 2 = 0 then 'destinatario' else 'comercio' end, 'urgente', i = 2, 'descripcion', 'Pedido en línea',
      'en_bodega', i > 4, 'fecha_programada', v_hoy), 'Demo · del día');
    b := 1 + ((i + extract(doy from v_hoy)::int) % 10);   -- barrio usado arriba, para su ubicación
    update public.mensajeria_envios set lat = round((plat[b] + (random() - 0.5) * 0.004)::numeric, 6), lng = round((plng[b] + (random() - 0.5) * 0.004)::numeric, 6) where id = (v_res ->> 'id')::uuid;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'creados', n);
end $f$;
revoke all on function public.msj_demo_preparar() from public, anon;
grant execute on function public.msj_demo_preparar() to authenticated;
