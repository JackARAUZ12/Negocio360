-- La contabilidad del grupo (central que lee a sus sucursales) ahora puede leer las tablas del Panel Microfinanciera.
-- Antes daba: "Tabla no permitida para la contabilidad del grupo: mf_moras". Solo lectura, mismas reglas de siempre.
do $$
declare d text := pg_get_functiondef('public.contabilidad_filas_miembro(uuid,text)'::regprocedure);
  v_viejo text := $q$'creditos_historial','devoluciones_venta'$q$;
begin
  if position('mf_moras' in d) > 0 then return; end if;
  if position(v_viejo in d) = 0 then raise exception 'texto no encontrado; no se cambió nada'; end if;
  execute replace(d, v_viejo, v_viejo || $q$,
    -- 05-nov-2026: Panel Microfinanciera (mora cobrada y faltantes/sobrantes de entregas)
    'mf_moras','mf_entregas'$q$);
end $$;
