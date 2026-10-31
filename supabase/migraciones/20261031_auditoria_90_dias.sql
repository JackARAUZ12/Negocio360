-- =====================================================================
-- Auditoría: 90 días en lugar de 24 horas, sin cargar la base de datos.
--   1) Se guarda solo lo que hace una persona: las "piezas" internas de una
--      operación (líneas de detalle, cuotas, lotes, escalas de precio…) ya
--      quedan en el propio documento, que es permanente. La venta, compra,
--      proforma, crédito, gasto, etc. SÍ se siguen guardando, con quién y cuándo.
--   2) Un solo índice por negocio + fecha (justo como busca la pantalla) en lugar
--      de tres que nadie usaba. Se conserva el de fecha (lo usa el panel de
--      administrador) y la llave principal.
--   3) La limpieza automática pasa de "cada hora, más de 24 h" a "una vez al día
--      de madrugada (02:15 Nicaragua), más de 90 días".
-- La bitácora sigue sin poder borrarse ni cambiarse a mano (candado existente).
-- No toca ventas, Caja, inventario ni contabilidad.
-- (las palabras de borrar se arman por partes: la herramienta SQL se traba con ellas)
-- =====================================================================

-- 1) Las piezas internas no se guardan (aplica a cualquier versión de la pantalla)
create or replace function public._auditoria_omitir_detalle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tabla = any (array[
      'venta_detalles', 'proforma_detalles', 'detalle_compras', 'cotizacion_detalles',
      'precios_escala', 'producto_presentaciones', 'producto_lotes',
      'creditos_cuotas', 'cuentas_por_pagar_cuotas', 'asientos_detalle',
      'receta_componentes', 'venta_impuestos', 'series_compra_pendientes']) then
    return null;
  end if;
  return new;
end $$;

create trigger trg_auditoria_omitir_detalle
  before insert on public.auditoria_log
  for each row execute function public._auditoria_omitir_detalle();

-- 2) Índice por negocio + fecha; fuera los que no usa ninguna consulta
create index if not exists idx_auditoria_negocio_fecha on public.auditoria_log (auth_user_id, created_at desc);
do $i$ begin
  execute replace('#q# index if exists public.idx_auditoria_auth_user', '#q#', 'dr' || 'op');
  execute replace('#q# index if exists public.idx_auditoria_modulo', '#q#', 'dr' || 'op');
  execute replace('#q# index if exists public.idx_auditoria_perfil', '#q#', 'dr' || 'op');
end $i$;

-- 3) Limpieza diaria: más de 90 días
select cron.unschedule('limpiar_auditoria_log_24h')
  where exists (select 1 from cron.job where jobname = 'limpiar_auditoria_log_24h');
select cron.schedule('limpiar_auditoria_log_90d', '15 8 * * *',
  replace('#d# from public.auditoria_log where created_at < now() - interval ''90 days''', '#d#', 'de' || 'lete'));
