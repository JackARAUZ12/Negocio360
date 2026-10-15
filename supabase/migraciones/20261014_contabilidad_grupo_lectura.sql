-- Contabilidad del grupo ("un solo libro en la central").
--
-- La central lleva la contabilidad de todo su grupo: sus bodegas y
-- sucursales son cuentas aparte, así que la central necesita LEER sus
-- documentos (ventas, gastos, compras, ajustes de inventario, etc.)
-- para registrar los asientos en sus propios libros.
--
-- Estas dos funciones son SOLO DE LECTURA. No escriben, no borran y no
-- cambian nada. Solo responden a la cuenta CENTRAL del grupo, y solo
-- sobre sus propios miembros; para cualquier otra cuenta no devuelven
-- nada. Las tablas que se pueden leer están en una lista cerrada.

-- 1) Miembros del grupo de la cuenta que llama (solo si es la central).
CREATE OR REPLACE FUNCTION public.contabilidad_miembros_grupo()
 RETURNS TABLE (sucursal_id uuid, nombre text, tipo text, auth_user_id uuid)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.nombre, s.tipo, s.auth_user_id_sucursal
    from public.sucursales s
   where auth.uid() is not null
     and s.auth_user_id_central = auth.uid()
     and coalesce(s.es_central, false) = false
     and coalesce(s.activa, true) = true
     and s.auth_user_id_sucursal is not null
     and s.auth_user_id_sucursal <> auth.uid()
   order by s.tipo, s.created_at;
$function$;

-- 2) Filas de UNA tabla de UN miembro (solo si la cuenta que llama es su central).
CREATE OR REPLACE FUNCTION public.contabilidad_filas_miembro(p_miembro uuid, p_tabla text)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión activa';
  end if;
  if p_tabla not in (
    'ventas','venta_detalles','venta_impuestos','creditos','creditos_pagos','fiado_pagos',
    'gastos','compras','cuentas_por_pagar','cuentas_por_pagar_pagos','retenciones_ir_pagos',
    'movimientos_impuestos','empleados_pagos','caja_chica_sesiones','movimientos_financieros',
    'movimientos_inventario','productos'
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

REVOKE ALL ON FUNCTION public.contabilidad_miembros_grupo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contabilidad_filas_miembro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contabilidad_miembros_grupo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.contabilidad_filas_miembro(uuid, text) TO authenticated;
