-- =====================================================================
-- TALLER MECÁNICO · cobro con el motor de Ventas + cliente de la orden
-- SOLO AGREGA dos funciones. No cambia tablas ni funciones existentes.
--
--  * taller_orden_vincular_venta: cuando la venta se registra con el motor de Ventas (ticket, comprobante,
--    crédito, retención de IR...), esta función cierra la orden como entregada y la liga a esa venta.
--    Candados: dueño de la orden y de la venta, orden en "Listo", sin líneas sin decidir, venta no anulada,
--    venta posterior a la orden, una venta no puede cerrar dos órdenes y repetirlo es inofensivo (idempotente).
--    NO mueve dinero ni inventario: eso ya lo hizo Ventas dentro de su propia operación.
--  * taller_orden_cliente: cambia (o quita) el cliente de una orden abierta, validando que sea del mismo negocio.
-- =====================================================================
create or replace function public.taller_orden_vincular_venta(p_orden_id uuid, p_venta_id uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); o record; v record; v_pend integer; v_apr integer; v_km numeric := nullif(p ->> 'km_salida', '')::numeric;
  v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'por', '')), ''), 'Usuario'), 120); v_dif numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.venta_id is not null then
    if o.venta_id = p_venta_id then return jsonb_build_object('ok', true, 'ya_entregada', true, 'venta_id', o.venta_id); end if;
    return jsonb_build_object('ok', false, 'motivo', 'ya_tiene_venta');
  end if;
  if o.estado <> 'listo' then return jsonb_build_object('ok', false, 'motivo', 'estado', 'estado', o.estado); end if;
  if v_km is not null and v_km < 0 then return jsonb_build_object('ok', false, 'motivo', 'km'); end if;
  select count(*) filter (where aprobacion = 'pendiente'), count(*) filter (where aprobacion = 'aprobada') into v_pend, v_apr from public.taller_orden_lineas where orden_id = o.id;
  if v_pend > 0 then return jsonb_build_object('ok', false, 'motivo', 'lineas_pendientes', 'pendientes', v_pend); end if;
  if v_apr = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_lineas'); end if;
  select * into v from public.ventas where id = p_venta_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'venta'); end if;
  if v.estado = 'anulada' then return jsonb_build_object('ok', false, 'motivo', 'venta_anulada'); end if;
  if v.created_at < o.fecha_ingreso then return jsonb_build_object('ok', false, 'motivo', 'venta_antigua'); end if;
  if exists (select 1 from public.taller_ordenes where venta_id = p_venta_id) then return jsonb_build_object('ok', false, 'motivo', 'venta_usada'); end if;
  v_dif := round(coalesce(v.total, 0) - o.total, 2);
  update public.taller_vehiculos set km_actual = greatest(coalesce(km_actual, 0), coalesce(v_km, o.km_ingreso, 0)), updated_at = now() where id = o.vehiculo_id and auth_user_id = v_uid;
  update public.taller_ordenes set estado = 'entregado', venta_id = p_venta_id, fecha_entrega = now(), km_salida = coalesce(v_km, km_salida), updated_at = now() where id = o.id;
  perform public._taller_log(v_uid, o.id, 'Entregado y cobrado', 'Venta ' || coalesce(v.numero_venta, '') || case when abs(v_dif) > 0.05 then ' · el total de la venta difiere de la orden en ' || v_dif else '' end, v_por);
  return jsonb_build_object('ok', true, 'venta_id', p_venta_id, 'numero_venta', v.numero_venta, 'diferencia', v_dif);
end;
$f$;
revoke all on function public.taller_orden_vincular_venta(uuid, uuid, jsonb) from public, anon;
grant execute on function public.taller_orden_vincular_venta(uuid, uuid, jsonb) to authenticated;

create or replace function public.taller_orden_cliente(p_orden_id uuid, p_cliente_id uuid, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); o record; v_nom text;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._taller_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_taller_o:' || p_orden_id::text));
  select * into o from public.taller_ordenes where id = p_orden_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if o.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  if p_cliente_id is not null then
    select nombre into v_nom from public.clientes where id = p_cliente_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'cliente'); end if;
  end if;
  update public.taller_ordenes set cliente_id = p_cliente_id, cliente_nombre = v_nom, updated_at = now() where id = o.id;
  update public.taller_vehiculos set cliente_id = p_cliente_id, updated_at = now() where id = o.vehiculo_id and auth_user_id = v_uid and cliente_id is null and p_cliente_id is not null;
  perform public._taller_log(v_uid, o.id, 'Cliente de la orden', coalesce(v_nom, 'Sin cliente'), p_por);
  return jsonb_build_object('ok', true, 'cliente_nombre', v_nom);
end;
$f$;
revoke all on function public.taller_orden_cliente(uuid, uuid, text) from public, anon;
grant execute on function public.taller_orden_cliente(uuid, uuid, text) to authenticated;
