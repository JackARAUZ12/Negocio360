-- =====================================================================
-- MENSAJERÍA / DELIVERY · Fase 3: rastreo para el cliente final y carga desde Excel
-- SOLO AGREGA: una columna (código de rastreo de cada envío) y dos funciones nuevas.
-- No cambia ninguna tabla ni función existente; no toca dinero, Caja ni Ventas.
--
-- RASTREO (página pública rastreo.html#t=CÓDIGO, sin cuenta)
--  * Cada envío tiene un código aleatorio de 40 caracteres (~160 bits): imposible de adivinar.
--  * La única función abierta al público (msj_rastreo) muestra SOLO lo que quien espera el paquete necesita:
--    estado, pasos con hora, zona, fecha, cuánto pagar al recibir y el nombre del negocio. Nunca la dirección
--    completa, teléfonos, datos del remitente, repartidor, costos ni otros envíos. Si el módulo está apagado,
--    el link no muestra nada.
-- CARGA DESDE EXCEL
--  * msj_envios_importar crea hasta 300 envíos con las MISMAS reglas que uno por uno (msj_envio_guardar):
--    todo o nada. Si una fila tiene un error, no se crea ninguno y se dice cuál fila y por qué.
-- =====================================================================

alter table public.mensajeria_envios
  add column if not exists rastreo_token text not null
    default (replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
create unique index if not exists mensajeria_envios_rastreo_unico on public.mensajeria_envios(rastreo_token);

create or replace function public.msj_rastreo(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare e record; c record; v_pagar numeric;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{40}$' then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select * into e from public.mensajeria_envios where rastreo_token = p_token;
  if not found or not public._msj_activo(e.auth_user_id) then return jsonb_build_object('ok', false, 'motivo', 'invalido'); end if;
  select nombre_comercial, whatsapp, telefono, moneda, logo_principal_url, color_principal into c from public.configuracion_empresa where auth_user_id = e.auth_user_id;
  v_pagar := case when e.estado in ('por_recoger','en_bodega','asignado','en_ruta','no_entregado')
                  then e.monto_cobrar + case when e.envio_lo_paga = 'destinatario' then e.tarifa + e.recargo_reintentos else 0 end else 0 end;
  return jsonb_build_object('ok', true,
    'negocio', coalesce(c.nombre_comercial, 'Mensajería'), 'whatsapp', coalesce(nullif(c.whatsapp, ''), nullif(c.telefono, '')), 'moneda', coalesce(c.moneda, 'NIO'),
    'logo', c.logo_principal_url, 'color', c.color_principal,
    'numero', e.numero, 'estado', e.estado, 'para', split_part(btrim(e.destinatario_nombre), ' ', 1), 'zona', e.zona_nombre,
    'fecha_programada', e.fecha_programada, 'paquetes', e.paquetes, 'urgente', e.urgente, 'pagar', v_pagar,
    'entregado_at', e.entregado_at, 'recibio', split_part(btrim(coalesce(e.recibio_nombre, '')), ' ', 1), 'creado_at', e.created_at,
    'pasos', coalesce((select jsonb_agg(jsonb_build_object('evento', v.evento, 'hora', v.created_at) order by v.created_at)
                         from public.mensajeria_envio_eventos v
                        where v.envio_id = e.id and v.evento in ('creado','en_bodega','asignado','reintento','en_ruta','entregado','no_entregado','devuelto','cancelado')), '[]'::jsonb));
end $f$;
revoke all on function public.msj_rastreo(text) from public;
grant execute on function public.msj_rastreo(text) to anon, authenticated;

create or replace function public.msj_envios_importar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); n integer; i integer; r jsonb; v_por text; v_nums text[] := '{}'; v_fila integer := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if not public._msj_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if jsonb_typeof(p -> 'envios') <> 'array' then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  n := jsonb_array_length(p -> 'envios');
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_filas'); end if;
  if n > 300 then return jsonb_build_object('ok', false, 'motivo', 'muchas_filas'); end if;
  v_por := left(nullif(btrim(coalesce(p ->> 'por', '')), ''), 120);
  begin
    for i in 0 .. n - 1 loop
      v_fila := i + 1;
      if jsonb_typeof(p -> 'envios' -> i) <> 'object' then raise exception 'MSJIMP:valor'; end if;
      r := public.msj_envio_guardar(((p -> 'envios' -> i) - 'id') || jsonb_build_object('por', v_por));
      if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'MSJIMP:%', coalesce(r ->> 'motivo', 'valor'); end if;
      v_nums := v_nums || (r ->> 'numero');
    end loop;
  exception when others then
    if sqlerrm like 'MSJIMP:%' then return jsonb_build_object('ok', false, 'motivo', 'fila', 'fila', v_fila, 'detalle', substr(sqlerrm, 8)); end if;
    raise;
  end;
  return jsonb_build_object('ok', true, 'creados', n, 'desde', v_nums[1], 'hasta', v_nums[n]);
end $f$;
revoke all on function public.msj_envios_importar(jsonb) from public, anon;
grant execute on function public.msj_envios_importar(jsonb) to authenticated;
