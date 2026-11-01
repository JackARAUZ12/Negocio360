-- APLICADA el 2026-11-01 (verificada: devolución parcial de venta con IVA mixto bloqueada; completa exacta; ventas normales sin cambios).
-- PROTECCIÓN: una venta cuyo IVA se cobró con tarifas distintas por producto (líneas con iva_monto) solo se puede devolver COMPLETA.
-- Motivo: la devolución parcial reparte el IVA en proporción al total de la venta, y con tarifas mixtas devolvería de más o de menos.
-- (Anular la venta y la devolución completa sí son exactas.) Las ventas SIN iva_monto en sus líneas (todas las existentes y las de una
-- sola tarifa) no cambian en absoluto. La devolución parcial exacta por línea queda para una etapa posterior con sus propias pruebas.
-- Se inserta el control dentro de la función existente sin reescribirla; es idempotente (si ya está puesto, no hace nada).
do $m$
declare d text; ancla text; guarda text; nuevo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_devolucion_venta';
  if d is null then raise exception 'No existe registrar_devolucion_venta'; end if;
  if position('iva_monto is not null' in d) > 0 then return; end if;
  ancla := E'raise exception ''Hay un producto repetido en la devolución.'';\n  end if;\n';
  if position(ancla in d) = 0 then
    ancla := E'raise exception ''Hay un producto repetido en la devolución.'';\nend if;\n';
  end if;
  if position(ancla in d) = 0 or (length(d) - length(replace(d, ancla, ''))) <> length(ancla) then
    raise exception 'No se encontró el punto exacto (o no es único) para insertar la protección; no se cambió nada';
  end if;
  guarda := $g$
  if exists (select 1 from venta_detalles dd where dd.venta_id = v.id and dd.iva_monto is not null) then
    if exists (select 1 from venta_detalles dd where dd.venta_id = v.id
                 and not exists (select 1 from jsonb_array_elements(v_lineas) xx
                                  where xx->>'venta_detalle_id' = dd.id::text
                                    and round(coalesce(nullif(xx->>'cantidad', '')::numeric, 0), 3)
                                        >= round(coalesce(dd.cantidad, 0) - coalesce((select sum(yy.cantidad) from devolucion_venta_detalles yy where yy.venta_detalle_id = dd.id), 0), 3) - 0.0005)) then
      raise exception 'Esta venta cobró IVA con tarifas distintas por producto: por ahora solo se puede devolver completa (todos los productos). Para devolver solo una parte, anula la venta y regístrala de nuevo.';
    end if;
  end if;
$g$;
  nuevo := replace(d, ancla, ancla || guarda);
  if nuevo = d then raise exception 'La protección no se insertó; no se cambió nada'; end if;
  execute nuevo;
end
$m$;
