-- "¿Con cuánto paga?" en Venta rápida: abierto / cerrado (un toque) / apagado. Por defecto cerrado.
alter table public.configuracion_venta_rapida add column if not exists vuelto_modo text not null default 'cerrado';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'configuracion_venta_rapida_vuelto_modo_chk') then
    alter table public.configuracion_venta_rapida add constraint configuracion_venta_rapida_vuelto_modo_chk check (vuelto_modo in ('abierto','cerrado','apagado'));
  end if;
end $$;
