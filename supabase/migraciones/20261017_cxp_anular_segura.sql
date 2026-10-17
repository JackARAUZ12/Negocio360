-- =====================================================================
-- CUENTAS POR PAGAR: "Eliminar" ahora ANULA de forma segura (todo o nada)
-- Fecha: 17-oct-2026 · No cambia ningún dato existente
--
-- PROBLEMA REAL (auditoría): el botón Eliminar borraba la cuenta pero dejaba
-- vivo su asiento contable "Cuenta por pagar" (ej. AS-000534, C$96,100) y su
-- IVA en Impuestos; además restaba del inventario aunque ya se hubiera vendido.
--
-- QUÉ HACE anular_cuenta_por_pagar(p_cuenta_id):
--  - Solo el dueño de la cuenta; solo si NO tiene pagos ni está anulada.
--  - Si hay compra con productos: devuelve el inventario SOLO si hay
--    existencia suficiente (si ya se vendió, no deja y explica).
--  - Marca la cuenta "anulado" (saldo 0, cuotas en 0), la compra "anulada",
--    anula su asiento y reversa el IVA de la compra en Impuestos.
--  - Todo en una sola transacción: o se hace completo o no se hace nada.
--  Nada se borra (queda el historial).
-- =====================================================================
create or replace function public.anular_cuenta_por_pagar(p_cuenta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  l record;
  v_stock numeric;
  v_iva numeric := 0;
  v_num text;
  v_ant numeric;
begin
  select * into c from public.cuentas_por_pagar where id = p_cuenta_id for update;
  if not found then raise exception 'La cuenta no existe'; end if;
  if c.auth_user_id is distinct from auth.uid() then raise exception 'No tienes permiso sobre esta cuenta'; end if;
  if c.estado = 'anulado' then raise exception 'Esta cuenta ya está anulada'; end if;
  if coalesce(c.monto_pagado, 0) > 0
     or exists (select 1 from public.cuentas_por_pagar_pagos x where x.cuenta_id = c.id) then
    raise exception 'No se puede anular: ya tiene pagos registrados';
  end if;

  if c.compra_id is not null then
    -- 1) verificar existencia suficiente ANTES de tocar nada
    for l in select producto_id, sum(cantidad) cant from public.detalle_compras
              where compra_id = c.compra_id and producto_id is not null group by producto_id loop
      select stock_actual into v_stock from public.productos where id = l.producto_id and auth_user_id = c.auth_user_id for update;
      if found and coalesce(v_stock, 0) < l.cant then
        raise exception 'No se puede anular: parte de lo comprado ya se vendió o salió del inventario (existencia actual menor a lo comprado)';
      end if;
    end loop;
    -- 2) devolver inventario
    for l in select producto_id, sum(cantidad) cant from public.detalle_compras
              where compra_id = c.compra_id and producto_id is not null group by producto_id loop
      update public.productos set stock_actual = stock_actual - l.cant, updated_at = now()
       where id = l.producto_id and auth_user_id = c.auth_user_id;
    end loop;
    select iva_monto, numero into v_iva, v_num from public.compras where id = c.compra_id;
    update public.compras set estado = 'anulada' where id = c.compra_id;   -- (su trigger también anula la cuenta; es idempotente)
  end if;

  update public.cuentas_por_pagar
     set estado = 'anulado', saldo_pendiente = 0, updated_at = now(),
         observaciones = trim(coalesce(observaciones, '') || ' [Anulada por el usuario]')
   where id = c.id;
  update public.cuentas_por_pagar_cuotas set saldo = 0, updated_at = now() where cuenta_id = c.id;

  update public.asientos_contables
     set estado = 'anulado', anulado_en = now(),
         anulado_motivo = 'Cuenta por pagar ' || coalesce(c.numero, '') || ' anulada por el usuario'
   where referencia_tipo = 'cxp_generada' and referencia_id = c.id and estado <> 'anulado';

  if coalesce(v_iva, 0) > 0 then
    select saldo_resultante into v_ant from public.movimientos_impuestos
     where auth_user_id = c.auth_user_id order by created_at desc limit 1;
    insert into public.movimientos_impuestos (auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, fecha)
    values (c.auth_user_id, 'IVA_COMPRA', 'Reverso de IVA por anular cuenta ' || coalesce(c.numero, '') || ' (compra ' || coalesce(v_num, '') || ')',
            -v_iva, coalesce(v_ant, 0), round(coalesce(v_ant, 0) + v_iva, 2), (now() at time zone 'America/Managua')::date);
  end if;

  return jsonb_build_object('ok', true, 'numero', c.numero);
end;
$$;
revoke all on function public.anular_cuenta_por_pagar(uuid) from public, anon;
grant execute on function public.anular_cuenta_por_pagar(uuid) to authenticated;
