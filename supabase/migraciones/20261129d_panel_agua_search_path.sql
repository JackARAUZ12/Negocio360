-- Panel Agua: search_path fijo en las funciones auxiliares y las funciones de trigger no se pueden llamar desde la app.
alter function public._agua_mes_txt(date) set search_path = public;
alter function public._agua_estado_cargo(numeric, numeric) set search_path = public;
revoke all on function public.agua_revertir_por_venta() from public, anon, authenticated;
revoke all on function public.ventas_no_anular_credito_con_retencion() from public, anon, authenticated;
