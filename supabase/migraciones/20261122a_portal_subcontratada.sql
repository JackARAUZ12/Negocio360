-- Portal de clientes: viajes subcontratados muestran placas/conductor de la subcontratación (si el dueño lo permite).
create or replace function public.tx_portal_ver(p_token text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; e record; c record; v_ok boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{40}$' then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select * into a from public.transporte_portal_accesos where token = p_token for update;
  if not found or not a.activo then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select nombre_comercial, whatsapp, telefono, logo_principal_url, color_principal, usa_modulo_transporte
    into e from public.configuracion_empresa where auth_user_id = a.auth_user_id;
  if not coalesce(e.usa_modulo_transporte, false)
     or exists (select 1 from public.usuarios u where u.auth_user_id = a.auth_user_id and u.estado_cuenta in ('suspendida', 'cancelada')) then
    return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;

  -- datos públicos de la empresa (para la pantalla del PIN)
  if p_pin is null then
    return jsonb_build_object('ok', false, 'motivo', 'pin', 'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'),
      'logo', e.logo_principal_url, 'color', e.color_principal);
  end if;

  if a.bloqueado_hasta is not null and a.bloqueado_hasta > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'minutos', ceil(extract(epoch from (a.bloqueado_hasta - now())) / 60),
      'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal);
  end if;
  v_ok := p_pin ~ '^[0-9]{4,6}$' and crypt(p_pin, a.pin_hash) = a.pin_hash;
  if not v_ok then
    if a.intentos_fallidos + 1 >= 5 then
      update public.transporte_portal_accesos set intentos_fallidos = 0, bloqueado_hasta = now() + interval '15 minutes' where id = a.id;
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'minutos', 15,
        'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal);
    end if;
    update public.transporte_portal_accesos set intentos_fallidos = intentos_fallidos + 1 where id = a.id;
    return jsonb_build_object('ok', false, 'motivo', 'pin_malo', 'restantes', 4 - a.intentos_fallidos,
      'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal);
  end if;

  update public.transporte_portal_accesos set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_ingreso = now(),
         ingresos = ingresos + case when ultimo_ingreso is null or ultimo_ingreso < now() - interval '30 minutes' then 1 else 0 end
   where id = a.id;
  select nombre, apellido into c from public.clientes where id = a.cliente_id;

  return jsonb_build_object('ok', true,
    'negocio', coalesce(nullif(e.nombre_comercial, ''), 'Transporte'), 'logo', e.logo_principal_url, 'color', e.color_principal,
    'whatsapp', coalesce(nullif(e.whatsapp, ''), nullif(e.telefono, '')),
    'cliente', btrim(coalesce(c.nombre, '') || ' ' || coalesce(c.apellido, '')),
    'ahora', now(),
    'viajes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', o.numero, 'ref', o.ref_cliente, 'origen', o.origen, 'destino', o.destino, 'estado', o.estado,
        'programada', o.fecha_programada, 'salida', o.salida_real, 'entrega', o.entrega_real, 'recibio', o.receptor,
        'carga', o.carga_descripcion, 'bultos', o.bultos, 'peso', o.peso_ton, 'creada', o.created_at,
        -- flota propia; si el viaje está subcontratado, los datos de la subcontratación activa (sin el nombre del transportista)
        'placa', case when a.mostrar_placa then coalesce((select u.placa from public.transporte_unidades u where u.id = o.unidad_id),
                   case when o.subcontratada then (select s.placa from public.transporte_subcontrataciones s where s.orden_id = o.id and s.auth_user_id = a.auth_user_id and s.estado = 'activa' order by s.created_at desc limit 1) end) end,
        'remolque', case when a.mostrar_placa then coalesce((select u.placa from public.transporte_unidades u where u.id = o.remolque_id),
                   case when o.subcontratada then (select s.placa_furgon from public.transporte_subcontrataciones s where s.orden_id = o.id and s.auth_user_id = a.auth_user_id and s.estado = 'activa' order by s.created_at desc limit 1) end) end,
        'conductor', case when a.mostrar_conductor then coalesce((select d.nombre from public.transporte_conductores d where d.id = o.conductor_id),
                   case when o.subcontratada then (select s.conductor_nombre from public.transporte_subcontrataciones s where s.orden_id = o.id and s.auth_user_id = a.auth_user_id and s.estado = 'activa' order by s.created_at desc limit 1) end) end,
        'eventos', coalesce((select jsonb_agg(ev order by ev->>'t') from (
            select jsonb_build_object('t', t.fecha_hora, 'estatus', t.estatus, 'hito', t.hito, 'pais', t.pais,
                     'nota', case when t.visible_cliente then t.nota end) ev
              from public.transporte_tracking t where t.orden_id = o.id and t.auth_user_id = a.auth_user_id
            union all
            select jsonb_build_object('t', x.llegada_en, 'estatus', 'Llegó a frontera ' || coalesce(x.frontera, ''), 'auto', 'frontera')
              from public.transporte_cruces x where x.orden_id = o.id and x.auth_user_id = a.auth_user_id and x.llegada_en is not null
            union all
            select jsonb_build_object('t', x.cruce_en, 'estatus', 'Cruzó frontera ' || coalesce(x.frontera, ''), 'auto', 'cruce')
              from public.transporte_cruces x where x.orden_id = o.id and x.auth_user_id = a.auth_user_id and x.cruce_en is not null
          ) q), '[]'::jsonb)
      ) order by coalesce(o.salida_real, o.fecha_programada::timestamptz, o.created_at) desc)
      from (select * from public.transporte_ordenes
             where auth_user_id = a.auth_user_id and cliente_id = a.cliente_id and coalesce(estado, '') <> 'cancelada'
               and (estado in ('pendiente', 'asignada', 'en_ruta') or coalesce(entrega_real, created_at) > now() - interval '365 days')
             order by created_at desc limit 300) o), '[]'::jsonb));
end $$;

