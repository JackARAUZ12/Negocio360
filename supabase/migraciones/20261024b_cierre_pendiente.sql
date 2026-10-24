-- =====================================================================
-- CIERRE DE MES PENDIENTE · 24-oct-2026 · Solo AGREGA (solo lectura).
-- Para negocios que eligieron su día de cierre: dice si el último período
-- que YA terminó (ayer o antes) quedó sin cerrar, con cuánto había en Caja
-- al final de ese período. Así la pantalla pregunta al entrar si seguir con
-- ese saldo o cerrar y empezar el nuevo período en cero.
-- También avisa de cierres mensuales viejos (del mes calendario) que ya no
-- corresponden al día de cierre elegido, para ofrecer deshacerlos.
-- Negocios sin día de cierre: siempre "no hay pendiente".
-- =====================================================================
create or replace function public.caja_cierre_pendiente()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_dia smallint; v_cero boolean; v_hasta date; v_desde date; v_saldo numeric; v_movs integer; v_viejos jsonb;
begin
  if v_uid is null then return jsonb_build_object('pendiente', false); end if;
  select dia_cierre_mensual, cierre_empezar_cero into v_dia, v_cero from configuracion_empresa where auth_user_id = v_uid;
  if v_dia is null then return jsonb_build_object('pendiente', false); end if;
  v_hasta := _fin_periodo_actual(v_dia, _hoy_managua() - 1);          -- último período que ya terminó
  select desde into v_desde from _periodo_cierre(v_dia, v_hasta);
  if exists (select 1 from cierres_caja where auth_user_id = v_uid and tipo = 'mensual' and fecha = v_hasta) then
    return jsonb_build_object('pendiente', false, 'hasta', v_hasta);
  end if;
  select count(*) into v_movs from movimientos_financieros where auth_user_id = v_uid and estado = 'completado' and fecha between v_desde and v_hasta;
  if v_movs = 0 then return jsonb_build_object('pendiente', false, 'hasta', v_hasta); end if;
  select round(coalesce(sum(case when tipo_flujo = 'INGRESO' then monto else -monto end), 0), 2) into v_saldo
    from movimientos_financieros where auth_user_id = v_uid and estado = 'completado' and fecha <= v_hasta;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'desde', periodo_inicio, 'hasta', periodo_fin) order by fecha), '[]'::jsonb) into v_viejos
    from cierres_caja where auth_user_id = v_uid and tipo = 'mensual' and periodo_fin is not null
     and extract(day from periodo_fin) <> v_dia and periodo_fin >= v_desde and movimientos_cierre is null;
  return jsonb_build_object('pendiente', true, 'desde', v_desde, 'hasta', v_hasta, 'dia', v_dia, 'saldo', v_saldo,
                            'movimientos', v_movs, 'empezar_cero', coalesce(v_cero, false), 'no_corresponden', v_viejos);
end $$;
revoke all on function public.caja_cierre_pendiente() from public, anon;
grant execute on function public.caja_cierre_pendiente() to authenticated;
