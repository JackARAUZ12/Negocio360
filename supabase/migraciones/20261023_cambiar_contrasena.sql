-- =====================================================================
-- CONFIGURACIÓN → "Cambiar contraseña" · Fecha: 23-oct-2026 · Solo AGREGA.
-- Dice si la cuenta en sesión puede cambiar su contraseña desde la app.
-- NO se ofrece en:
--   * cuentas de prueba (cuentas_prueba: demo pública e internas) ni sus sucursales;
--   * cuentas internas de sucursal o bodega, ni negocios vinculados secundarios
--     (su clave la usa el sistema para cambiar entre negocios; si se cambiara
--     a mano, dejaría de funcionar ese cambio);
--   * administradores de la plataforma.
-- =====================================================================
create or replace function public.cuenta_puede_cambiar_contrasena()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('puede', false, 'motivo', 'sin_sesion');
  end if;
  if exists (select 1 from cuentas_prueba where auth_user_id = v_uid)
     or exists (select 1 from sucursales s join cuentas_prueba cp on cp.auth_user_id = s.auth_user_id_central
                 where s.auth_user_id_sucursal = v_uid) then
    return jsonb_build_object('puede', false, 'motivo', 'cuenta_prueba');
  end if;
  if exists (select 1 from sucursales s where s.auth_user_id_sucursal = v_uid and s.es_central is not true
                                         and s.auth_user_id_sucursal is distinct from s.auth_user_id_central) then
    return jsonb_build_object('puede', false, 'motivo', 'cuenta_sucursal');
  end if;
  if exists (select 1 from negocios_vinculados n where n.auth_user_id_negocio = v_uid
                                                   and n.es_principal is not true and n.password_interno is not null) then
    return jsonb_build_object('puede', false, 'motivo', 'negocio_vinculado');
  end if;
  if public.is_admin_activo() then
    return jsonb_build_object('puede', false, 'motivo', 'administrador');
  end if;
  return jsonb_build_object('puede', true, 'motivo', null);
end $$;
revoke all on function public.cuenta_puede_cambiar_contrasena() from public, anon;
grant execute on function public.cuenta_puede_cambiar_contrasena() to authenticated;
