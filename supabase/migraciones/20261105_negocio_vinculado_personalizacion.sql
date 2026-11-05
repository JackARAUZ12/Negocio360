-- Negocio adicional: pasa por Personalización como la primera vez (05-nov-2026)
-- crear_negocio_vinculado ya no marca el inicio como terminado: deja el nombre escrito y onboarding pendiente,
-- y pone el nombre de la persona (o del negocio) para que no salude con el correo interno.
do $$
declare d text := pg_get_functiondef('public.crear_negocio_vinculado(uuid,text,text,text)'::regprocedure);
  v_viejo text := $q$  insert into configuracion_empresa (auth_user_id, nombre_comercial, onboarding_completado, onboarding_step)
  values (p_nuevo, v_nombre, true, 5)
  on conflict (auth_user_id) do update set nombre_comercial = excluded.nombre_comercial, onboarding_completado = true, onboarding_step = 5;
  update usuarios set onboarding_completado = true where auth_user_id = p_nuevo;$q$;
  v_nuevo text := $q$  -- El negocio nuevo pasa por Personalización (como la primera vez), con su nombre ya escrito.
  insert into configuracion_empresa (auth_user_id, nombre_comercial, onboarding_completado, onboarding_step)
  values (p_nuevo, v_nombre, false, 1)
  on conflict (auth_user_id) do nothing;
  -- Que salude con el nombre de la persona (o del negocio), no con el correo interno.
  update usuarios set nombre = coalesce(nullif(btrim((select u2.nombre from usuarios u2 where u2.auth_user_id = v_uid)), ''), v_nombre)
   where auth_user_id = p_nuevo and coalesce(btrim(nombre), '') = '';$q$;
begin
  if position('values (p_nuevo, v_nombre, false, 1)' in d) > 0 then return; end if;
  if position(v_viejo in d) = 0 then raise exception 'texto no encontrado; no se cambió nada'; end if;
  execute replace(d, v_viejo, v_nuevo);
end $$;

-- "CREDITOS" (cuenta guisselap1990): su cuenta interna fue borrada el mismo día; se quitó el vínculo
-- que quedó apuntando a una cuenta inexistente (si no, contaba para el límite de negocios).
delete from negocios_vinculados n where n.auth_user_id_principal = 'ef3ea426-b7b8-4b78-91a3-5dfa1890595a' and not n.es_principal
  and not exists (select 1 from auth.users a where a.id = n.auth_user_id_negocio);
