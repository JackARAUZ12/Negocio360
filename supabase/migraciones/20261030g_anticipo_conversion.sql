-- =====================================================================
-- Ciclo opcional (Fase 3c, parte 2): usar el ANTICIPO al convertir la proforma en venta.
-- SOLO AGREGA tres funciones/disparador. No cambia proforma_finalizar_conversion ni ninguna tabla.
--
-- Contabilidad (sin descuadre): el anticipo ya está en Caja como ingreso ligado al certificado (no es venta).
-- Al convertir, la venta se paga en parte con ese certificado (lo valida y descuenta el disparador que ya existe
-- en ventas). Caja registra de la venta SOLO lo que falta cobrar: (total - IVA - anticipo aplicado). Así
-- Caja = total - IVA y el IVA va a Impuestos, igual que una venta normal, sin contar el anticipo dos veces.
-- Tope: el anticipo aplicado nunca llega a cubrir todo el neto (queda al menos 0.01 por cobrar); lo que
-- sobre queda como saldo del certificado para el cliente.
--
-- Candado: si la proforma tiene un anticipo sin usar, NO se puede crear su venta sin aplicarlo
-- (evitaría contar el dinero dos veces).
-- =====================================================================

create or replace function public.proforma_anticipo_resumen(p_proforma_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_uid uuid := auth.uid(); pf record; v_ciclo boolean; v_ant boolean; v_tope numeric; v_certs jsonb; v_saldo numeric;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  select coalesce(usa_ciclo_produccion_pedidos, false), coalesce(usa_anticipo_pedidos, false)
    into v_ciclo, v_ant from public.configuracion_empresa where auth_user_id = v_uid;
  select * into pf from public.proformas where id = p_proforma_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  v_tope := greatest(0, round(coalesce(pf.total, 0) - coalesce(pf.impuesto, 0) - 0.01, 2));
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo, 'saldo', c.saldo, 'monto', a.monto, 'estado', c.estado) order by a.created_at), '[]'::jsonb),
         coalesce(sum(case when c.estado = 'activo' and c.saldo > 0 then c.saldo else 0 end), 0)
    into v_certs, v_saldo
    from public.proforma_anticipos a join public.certificados_regalo c on c.id = a.certificado_id
   where a.proforma_id = pf.id and a.auth_user_id = v_uid and c.estado <> 'anulado';
  return jsonb_build_object('ok', true, 'activo', (coalesce(v_ciclo, false) and coalesce(v_ant, false)),
    'certificados', v_certs, 'saldo_total', v_saldo, 'tope', v_tope, 'aplicable', least(v_saldo, v_tope));
end;
$f$;
revoke all on function public.proforma_anticipo_resumen(uuid) from public, anon;
grant execute on function public.proforma_anticipo_resumen(uuid) to authenticated;

create or replace function public.proforma_finalizar_conversion_anticipo(
  p_venta_id uuid, p_proforma_id uuid, p_metodo_id uuid default null, p_metodo_nombre text default null,
  p_banco_id uuid default null, p_convertido_por text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_uid uuid := auth.uid(); v record; pf record; e jsonb; v_aplic numeric := 0; v_monto numeric; v_mov uuid; v_codigos text := '';
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  perform pg_advisory_xact_lock(hashtext('n360_conv_proforma:' || p_proforma_id::text));
  select * into v from public.ventas where id = p_venta_id and auth_user_id = v_uid;
  select * into pf from public.proformas where id = p_proforma_id and auth_user_id = v_uid;
  if v.id is null or pf.id is null then raise exception 'No se encontró la venta o la proforma'; end if;
  if v.proforma_id is distinct from pf.id then raise exception 'Esa venta no es de esa proforma'; end if;

  -- Cuánto de la venta se pagó con certificados de ANTICIPO de esta proforma.
  if v.certificados_aplicados is not null and jsonb_typeof(v.certificados_aplicados) = 'array' then
    for e in select * from jsonb_array_elements(v.certificados_aplicados) loop
      if exists (select 1 from public.proforma_anticipos a where a.proforma_id = pf.id and a.certificado_id = nullif(e ->> 'certificado_id', '')::uuid) then
        v_aplic := v_aplic + round(coalesce(nullif(e ->> 'monto', '')::numeric, 0), 2);
        v_codigos := v_codigos || ' ' || coalesce((select codigo from public.certificados_regalo where id = (e ->> 'certificado_id')::uuid), '');
      end if;
    end loop;
  end if;

  if v_aplic > 0 then
    if v_aplic > round(coalesce(pf.total, 0) - coalesce(pf.impuesto, 0) - 0.01, 2) then
      raise exception 'El anticipo aplicado no puede cubrir todo el valor de la venta sin IVA.' using errcode = 'P0001';
    end if;
    if round(coalesce(v.total, 0), 2) <> round(coalesce(pf.total, 0), 2) then
      raise exception 'El total de la venta no coincide con el de la proforma.' using errcode = 'P0001';
    end if;
    -- Solo lo que falta cobrar entra a Caja como venta (el anticipo ya entró antes).
    v_monto := round(coalesce(pf.total, 0) - coalesce(pf.impuesto, 0) - v_aplic, 2);
    select m.id into v_mov from public.movimientos_financieros m
     where m.auth_user_id = v_uid and m.referencia_tipo = 'venta' and m.referencia_id = v.id and m.tipo_flujo = 'INGRESO' and m.estado = 'completado' limit 1;
    if v_mov is null and v_monto > 0 then
      insert into public.movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                                  metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
      values (v_uid, 'INGRESO', 'VENTA',
              'Venta ' || v.numero_venta || ' (desde proforma ' || pf.numero_proforma || ', saldo después del anticipo' || btrim(v_codigos) || ')',
              v_monto, 0, 0, p_metodo_id, coalesce(p_metodo_nombre, v.metodo_pago_nombre, 'Efectivo'), p_banco_id,
              'venta', v.id, 'Anticipo aplicado: ' || v_aplic, (now() at time zone 'America/Managua')::date, 'completado');
    end if;
  end if;

  -- El resto (inventario, IVA, cliente, marcar la proforma) lo hace la función de siempre, que respeta el movimiento ya creado.
  return public.proforma_finalizar_conversion(p_venta_id, p_proforma_id, p_metodo_id, p_metodo_nombre, p_banco_id, p_convertido_por);
end;
$f$;
revoke all on function public.proforma_finalizar_conversion_anticipo(uuid, uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.proforma_finalizar_conversion_anticipo(uuid, uuid, uuid, text, uuid, text) to authenticated;

-- Candado: una venta de una proforma con anticipo sin usar debe aplicarlo.
create or replace function public._ventas_candado_anticipo_proforma()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare c record; ok boolean;
begin
  if new.proforma_id is null then return new; end if;
  for c in select cr.id, cr.codigo from public.proforma_anticipos a join public.certificados_regalo cr on cr.id = a.certificado_id
            where a.proforma_id = new.proforma_id and cr.estado = 'activo' and cr.saldo > 0 loop
    select exists (select 1 from jsonb_array_elements(case when jsonb_typeof(new.certificados_aplicados) = 'array' then new.certificados_aplicados else '[]'::jsonb end) x
                    where x ->> 'certificado_id' = c.id::text and coalesce(nullif(x ->> 'monto', '')::numeric, 0) > 0) into ok;
    if not ok then
      raise exception 'Esta proforma tiene el anticipo % sin usar. Aplícalo en la venta, o anula el certificado antes.', c.codigo using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$f$;
drop trigger if exists trg_ventas_candado_anticipo_proforma on public.ventas;
create trigger trg_ventas_candado_anticipo_proforma before insert on public.ventas
  for each row execute function public._ventas_candado_anticipo_proforma();
