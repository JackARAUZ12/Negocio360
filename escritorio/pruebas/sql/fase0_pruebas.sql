  -- ===== PRUEBAS (se pegan después de la migración, dentro del mismo DO) =====
  select id into v_otro from auth.users u
   where id <> v_piloto and not public._es_cuenta_demo(id) limit 1;
  select auth_user_id into v_demo from public.cuentas_prueba where tipo = 'demo_publica' limit 1;

  -- 1) Sin sesión (anon): no puede ejecutar las funciones
  perform set_config('role', 'anon', true);
  begin perform public.offline_estado(); r := r || jsonb_build_object('anon_estado', 'FALLO: ejecutó');
  exception when insufficient_privilege then r := r || jsonb_build_object('anon_estado', 'ok bloqueado'); end;
  begin perform count(*) from public.offline_dispositivos; r := r || jsonb_build_object('anon_tabla', 'FALLO: leyó');
  exception when insufficient_privilege then r := r || jsonb_build_object('anon_tabla', 'ok bloqueado'); end;

  -- 2) Cuenta piloto
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_piloto, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('piloto_estado', public.offline_estado()->'habilitado');
  v := public.offline_registrar_dispositivo('11111111-2222-3333-4444-555555555555', 'Caja 1', '2.0.0', 'win32');
  r := r || jsonb_build_object('piloto_alta', v ? 'dispositivo_id', 'bloque', v->'tamano_bloque');
  v2 := public.offline_registrar_dispositivo('11111111-2222-3333-4444-555555555555', 'Caja 1b', null, null);
  r := r || jsonb_build_object('piloto_mismo_id', (v->>'dispositivo_id') = (v2->>'dispositivo_id'));
  r := r || jsonb_build_object('piloto_ve_sus_equipos', (select count(*) from public.offline_dispositivos));
  begin perform public.offline_registrar_dispositivo('x; select 1', null, null, null); r := r || jsonb_build_object('uid_invalido', 'FALLO');
  exception when others then r := r || jsonb_build_object('uid_invalido', 'ok rechazado'); end;
  begin insert into public.offline_dispositivos(auth_user_id, dispositivo_uid) values (v_piloto, '99999999-2222-3333-4444-555555555555');
        r := r || jsonb_build_object('insert_directo', 'FALLO');
  exception when insufficient_privilege then r := r || jsonb_build_object('insert_directo', 'ok bloqueado'); end;
  begin update public.offline_cuentas_habilitadas set tamano_bloque = 400; r := r || jsonb_build_object('update_interruptor', 'FALLO');
  exception when insufficient_privilege then r := r || jsonb_build_object('update_interruptor', 'ok bloqueado'); end;
  -- límite de equipos
  begin
    for i in 1..5 loop perform public.offline_registrar_dispositivo(gen_random_uuid()::text, 'extra', null, null); end loop;
    r := r || jsonb_build_object('limite_equipos', 'FALLO');
  exception when others then r := r || jsonb_build_object('limite_equipos', 'ok: ' || sqlerrm); end;

  -- 3) Otra cuenta (no piloto): nada cambia para ella
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('otro_estado', public.offline_estado()->'habilitado');
  r := r || jsonb_build_object('otro_ve_equipos', (select count(*) from public.offline_dispositivos));
  r := r || jsonb_build_object('otro_ve_interruptor', (select count(*) from public.offline_cuentas_habilitadas));
  begin perform public.offline_registrar_dispositivo(gen_random_uuid()::text, 'x', null, null); r := r || jsonb_build_object('otro_alta', 'FALLO');
  exception when others then r := r || jsonb_build_object('otro_alta', 'ok: ' || sqlerrm); end;

  -- 4) Cuenta demo
  perform set_config('request.jwt.claims', json_build_object('sub', v_demo, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('demo_estado', public.offline_estado());

  raise exception 'RESULTADO_PRUEBA %', r;
