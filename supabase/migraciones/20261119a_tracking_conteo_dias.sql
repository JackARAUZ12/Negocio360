-- Tracking: forma de contar los días libres por orden (pedido de Bryan).
-- 'calendario' = cada fecha nueva es un día nuevo; 'horas' = bloques de 24 h (como antes).
-- Aditivo. Las órdenes que ya tenían días libres quedan fijas en 'horas' (no cambian solas).
alter table public.transporte_ordenes add column if not exists conteo_dias text;
alter table public.transporte_ordenes add column if not exists libres_horas numeric(8,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='transporte_ordenes_conteo_dias_chk') then
    alter table public.transporte_ordenes add constraint transporte_ordenes_conteo_dias_chk check (conteo_dias is null or conteo_dias in ('calendario','horas'));
  end if;
  if not exists (select 1 from pg_constraint where conname='transporte_ordenes_libres_horas_chk') then
    alter table public.transporte_ordenes add constraint transporte_ordenes_libres_horas_chk check (libres_horas is null or (libres_horas >= 0 and libres_horas <= 8760));
  end if;
end $$;
update public.transporte_ordenes set conteo_dias = 'horas' where dias_libres is not null and conteo_dias is null;
