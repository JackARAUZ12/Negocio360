-- Reporte de anulaciones y devoluciones (06-nov-2026): guardar CUÁNDO, QUIÉN y POR QUÉ se anuló una venta.
alter table public.ventas add column if not exists anulada_en timestamptz;
alter table public.ventas add column if not exists anulada_por text;
alter table public.ventas add column if not exists anulado_motivo text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ventas_anulado_motivo_largo') then
    alter table public.ventas add constraint ventas_anulado_motivo_largo check (anulado_motivo is null or length(anulado_motivo) <= 300);
  end if;
end $$;
create or replace function public._venta_marca_anulacion()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'anulada' and old.estado is distinct from 'anulada' then
    new.anulada_en := coalesce(new.anulada_en, now());
  end if;
  return new;
end $$;
revoke all on function public._venta_marca_anulacion() from public, anon, authenticated;
drop trigger if exists trg_venta_marca_anulacion on public.ventas;
create trigger trg_venta_marca_anulacion before update of estado on public.ventas for each row execute function public._venta_marca_anulacion();
