-- Costa Rica · datos fiscales OPCIONALES (todo nullable, sin valor por defecto): no cambia ninguna fila ni ningún cálculo.
-- Solo las cuentas de Costa Rica ven y llenan estos campos desde la app. Las cuentas de Nicaragua no los usan (quedan en blanco).
--  clientes.tipo_identificacion      01 cédula física · 02 cédula jurídica · 03 DIMEX · 04 NITE
--  productos.cabys                   código CAByS de 13 dígitos (se usará en la factura electrónica)
--  productos.iva_tarifa              tarifa de IVA propia del producto (se usará al activar la factura electrónica; hoy NO cambia el cálculo de las ventas)
--  configuracion_empresa.actividad_economica        código de actividad económica del emisor
--  configuracion_empresa.emisor_tipo_identificacion tipo de identificación del emisor (mismos códigos 01-04)
alter table public.clientes            add column if not exists tipo_identificacion text;
alter table public.productos           add column if not exists cabys text;
alter table public.productos           add column if not exists iva_tarifa numeric(5,2);
alter table public.configuracion_empresa add column if not exists actividad_economica text;
alter table public.configuracion_empresa add column if not exists emisor_tipo_identificacion text;

do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_tipo_identificacion_chk') then
    alter table public.clientes add constraint clientes_tipo_identificacion_chk check (tipo_identificacion is null or tipo_identificacion in ('01','02','03','04')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_cabys_chk') then
    alter table public.productos add constraint productos_cabys_chk check (cabys is null or cabys ~ '^[0-9]{13}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_iva_tarifa_chk') then
    alter table public.productos add constraint productos_iva_tarifa_chk check (iva_tarifa is null or (iva_tarifa >= 0 and iva_tarifa <= 100)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'config_actividad_economica_chk') then
    alter table public.configuracion_empresa add constraint config_actividad_economica_chk check (actividad_economica is null or actividad_economica ~ '^[0-9]{4,8}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'config_emisor_tipo_id_chk') then
    alter table public.configuracion_empresa add constraint config_emisor_tipo_id_chk check (emisor_tipo_identificacion is null or emisor_tipo_identificacion in ('01','02','03','04')) not valid;
  end if;
end $c$;
