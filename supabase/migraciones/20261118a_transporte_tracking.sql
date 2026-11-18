-- =====================================================================
-- Transporte · TRACKING de cada orden (pedido de Bryan)
--   - Línea de tiempo por orden: fecha/hora, estatus, país y nota.
--   - "hito" marca el inicio de carga y el fin de descarga para calcular
--     días usados vs. días libres (demora), en bloques de 24 h.
--   - Días libres por orden (opcional).
-- Solo agrega: no cambia órdenes, cobros, facturas ni liquidaciones.
-- =====================================================================
create table if not exists public.transporte_tracking (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  orden_id uuid not null references public.transporte_ordenes(id) on delete cascade,
  fecha_hora timestamptz not null,
  estatus text not null check (char_length(btrim(estatus)) between 1 and 60),
  hito text check (hito in ('inicio_carga', 'fin_descarga')),
  pais text check (pais is null or char_length(pais) <= 60),
  nota text check (nota is null or char_length(nota) <= 300),
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists transporte_tracking_orden_idx on public.transporte_tracking (orden_id, fecha_hora);
create index if not exists transporte_tracking_user_idx on public.transporte_tracking (auth_user_id);
alter table public.transporte_tracking enable row level security;
drop policy if exists ttk_sel on public.transporte_tracking;
drop policy if exists ttk_ins on public.transporte_tracking;
drop policy if exists ttk_upd on public.transporte_tracking;
drop policy if exists ttk_del on public.transporte_tracking;
create policy ttk_sel on public.transporte_tracking for select using ((select auth.uid()) = auth_user_id);
create policy ttk_ins on public.transporte_tracking for insert with check ((select auth.uid()) = auth_user_id);
create policy ttk_upd on public.transporte_tracking for update using ((select auth.uid()) = auth_user_id) with check ((select auth.uid()) = auth_user_id);
create policy ttk_del on public.transporte_tracking for delete using ((select auth.uid()) = auth_user_id);

-- Candado: el registro solo puede colgar de una orden de la MISMA cuenta
create or replace function public._transporte_tracking_chk() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if not exists (select 1 from public.transporte_ordenes o where o.id = new.orden_id and o.auth_user_id = new.auth_user_id) then
    raise exception 'La orden no pertenece a esta cuenta';
  end if;
  new.estatus := btrim(new.estatus);
  return new;
end $f$;
drop trigger if exists trg_transporte_tracking_chk on public.transporte_tracking;
create trigger trg_transporte_tracking_chk before insert or update on public.transporte_tracking
  for each row execute function public._transporte_tracking_chk();
revoke all on function public._transporte_tracking_chk() from public, anon, authenticated;

alter table public.transporte_ordenes add column if not exists dias_libres numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transporte_ordenes_dias_libres_chk') then
    alter table public.transporte_ordenes add constraint transporte_ordenes_dias_libres_chk check (dias_libres is null or (dias_libres >= 0 and dias_libres <= 365));
  end if;
end $$;
