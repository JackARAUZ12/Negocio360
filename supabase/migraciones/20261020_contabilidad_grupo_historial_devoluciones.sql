-- =====================================================================
-- CONTABILIDAD DEL GRUPO: la central puede leer el historial de créditos
-- y las devoluciones de venta de sus bodegas/sucursales
-- Fecha: 20-oct-2026 · Solo lectura · No cambia ni borra ningún dato
--
-- PROBLEMA REAL: desde el 17-oct, "Generar asientos" en una central con
-- bodegas/sucursales se cortaba con error ("Tabla no permitida para la
-- contabilidad del grupo: creditos_historial") al revisar los descuentos de
-- créditos de cada sucursal; lo que se generaba después quedaba pendiente.
-- Las devoluciones de venta de las sucursales (desde el 15-oct) nunca se
-- leían por la misma razón (sin error: simplemente se saltaban).
--
-- QUÉ HACE: agrega 'creditos_historial' y 'devoluciones_venta' a la lista de
-- tablas que la central puede LEER de sus miembros. Mismas reglas de siempre:
-- solo la central de ese grupo, solo lectura.
-- =====================================================================

create or replace function public.contabilidad_filas_miembro(p_miembro uuid, p_tabla text)
 returns setof jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión activa';
  end if;
  if p_tabla not in (
    'ventas','venta_detalles','venta_impuestos','creditos','creditos_pagos','fiado_pagos',
    'gastos','compras','cuentas_por_pagar','cuentas_por_pagar_pagos','retenciones_ir_pagos',
    'movimientos_impuestos','empleados_pagos','caja_chica_sesiones','movimientos_financieros',
    'movimientos_inventario','productos',
    -- 20-oct-2026: descuentos a créditos (historial) y devoluciones de venta de bodegas/sucursales
    'creditos_historial','devoluciones_venta'
  ) then
    raise exception 'Tabla no permitida para la contabilidad del grupo: %', p_tabla;
  end if;
  if not exists (
    select 1 from public.sucursales s
     where s.auth_user_id_central = auth.uid()
       and s.auth_user_id_sucursal = p_miembro
       and coalesce(s.es_central, false) = false
       and p_miembro <> auth.uid()
  ) then
    raise exception 'No autorizado: esa cuenta no es una bodega o sucursal de tu grupo';
  end if;
  return query execute format('select to_jsonb(t) from public.%I t where t.auth_user_id = $1', p_tabla) using p_miembro;
end;
$function$;
