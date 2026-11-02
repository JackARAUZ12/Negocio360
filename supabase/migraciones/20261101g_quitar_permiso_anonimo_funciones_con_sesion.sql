-- SEGURIDAD: quitar el permiso de ejecutar a las visitas SIN sesión (rol anon / PUBLIC) en funciones que ya exigen sesión.
-- Estas 49 funciones ya comprueban auth.uid() por dentro, por lo que sin sesión no hacían nada útil; ahora ni siquiera se pueden llamar.
-- NO se tocan: las funciones públicas por diseño (validar_codigo_acceso, msj_*, taller_link_*, catalogo360_verificar_codigo,
-- catalogo_validar_codigo, catalogo_registrar_evento) ni las usadas dentro de políticas de acceso (is_admin_activo,
-- es_miembro_chat_grupal, catalogo_puede_*), porque quitarles el permiso rompería consultas.
-- Los usuarios con sesión (authenticated) y el servidor (service_role) conservan el permiso, ahora de forma explícita.
-- DESHACER (si algo fallara): para cada función: grant execute on function public.<nombre>(<args>) to anon, public;
-- ESTADO: APLICADA y probada con rollback: anon bloqueado en las funciones (permission denied), authenticated y service_role siguen pudiendo, las 14 funciones públicas o de políticas siguen abiertas a anon, y consultas anon a tablas con políticas no dan error.
do $mig$
declare r record; v_n int := 0;
begin
  for r in
    select p.oid::regprocedure as f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and pg_get_function_result(p.oid) <> 'trigger'
       and p.proname = any(array[
    '_auth_id_central_del_grupo',
    'actualizar_ultima_conexion',
    'admin_catalogo360_listar_clientes',
    'asegurar_impuestos_base',
    'catalogo360_activar_regalo_fidelidad',
    'catalogo360_canjear_codigo',
    'catalogo_publicar',
    'catalogo_usar_codigo',
    'clientes_con_cobro_pendiente',
    'clientes_inactivos',
    'completar_onboarding',
    'contar_grupo',
    'convenio_anular_consumo',
    'convenio_anular_pago',
    'convenio_registrar_consumo',
    'convenio_registrar_pago',
    'convertir_moneda_negocio',
    'descontar_lote_fefo',
    'descontar_stock_remoto',
    'eliminar_mi_cuenta',
    'generar_codigo_barras_auto',
    'generar_numero_asiento',
    'generar_numero_credito',
    'generar_numero_cxp',
    'generar_numero_proforma',
    'generar_numero_venta',
    'get_clientes_kpi',
    'get_dashboard_metrics',
    'listar_auth_ids_sucursales_shadow',
    'listar_perfiles_del_grupo',
    'listar_proveedores_grupo',
    'listar_sucursales_grupo',
    'mover_stock_producto',
    'nombres_miembros_chat_grupal',
    'obtener_credenciales_negocio',
    'obtener_credenciales_sucursal',
    'obtener_datos_grupo',
    'puntos_ajustar_manual',
    'recalcular_stats_cliente',
    'registrar_asiento_contable',
    'registrar_gasto_caja_grupo',
    'siguiente_numero_activo',
    'siguiente_numero_compra',
    'siguiente_numero_delivery',
    'siguiente_numero_orden_compra',
    'sincronizar_concepto_a_impuestos',
    'sincronizar_todos_clientes',
    'sucursales_para_reabastecer',
    'ventas_pendientes_entrega'
       ])
  loop
    execute format('revoke execute on function %s from public, anon', r.f);
    execute format('grant execute on function %s to authenticated, service_role', r.f);
    v_n := v_n + 1;
  end loop;
  raise notice 'Funciones ajustadas: %', v_n;
end
$mig$;
