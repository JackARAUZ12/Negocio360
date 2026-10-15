-- Caja: un movimiento que pertenece a una venta, gasto, compra o pago de
-- crédito ya no se anula suelto desde Caja. Se anula el DOCUMENTO desde
-- su módulo (Ventas, Gastos, Compras, Créditos), que ya anula su
-- movimiento de caja. Así no vuelve a pasar que el dinero se anule y la
-- venta siga activa (sumando en reportes y descontando inventario).
--
-- Única diferencia con la versión anterior: el bloque "Documento con
-- su propio Anular". Todo lo demás queda idéntico. Los otros tipos
-- (pagos a proveedor, salarios, fiados, producción, convenios,
-- movimientos manuales) se siguen anulando igual que antes.
CREATE OR REPLACE FUNCTION public.anular_movimiento_caja(p_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); m movimientos_financieros%rowtype; d numeric; n int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'mensaje', 'Sin sesión activa'); end if;
  select * into m from movimientos_financieros where id = p_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'mensaje', 'No se encontró el movimiento a anular'); end if;
  if m.estado = 'anulado' then return jsonb_build_object('ok', false, 'mensaje', 'Ese movimiento ya estaba anulado'); end if;
  if m.transferencia_id is not null then
    return jsonb_build_object('ok', false, 'mensaje', 'Las transferencias no se anulan una por una: usa "Revertir" en la pestaña Transferencias.');
  end if;

  -- Documento con su propio Anular: se anula desde su módulo.
  if m.referencia_id is not null and m.referencia_tipo in ('venta', 'gasto', 'compra', 'credito') then
    return jsonb_build_object('ok', false, 'mensaje',
      'Este movimiento pertenece a ' ||
      case m.referencia_tipo when 'venta' then 'una venta: anúlala desde Ventas'
                             when 'gasto' then 'un gasto: cancélalo desde Gastos'
                             when 'compra' then 'una compra: anúlala desde Compras'
                             else 'un pago de crédito: anúlalo desde Créditos' end ||
      '. Así se anula también este movimiento y todo queda cuadrado.');
  end if;

  update movimientos_financieros
     set estado = 'anulado', anulado_en = now(), anulado_motivo = coalesce(nullif(trim(p_motivo), ''), 'Anulado manualmente')
   where id = m.id;

  -- Los movimientos POSTERIORES arrastran el saldo del anulado: se corrigen por su monto exacto.
  -- (No se recalcula nada anterior ni se "arreglan" historiales viejos: el cambio es predecible.)
  if m.estado = 'completado' then
    d := case when m.tipo_flujo = 'INGRESO' then -m.monto else m.monto end;
    update movimientos_financieros
       set saldo_anterior = round(saldo_anterior + d, 2), saldo_resultante = round(saldo_resultante + d, 2)
     where auth_user_id = v_uid and estado = 'completado' and (created_at, id) > (m.created_at, m.id);
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('ok', true, 'ajustados', n);
end $function$;
