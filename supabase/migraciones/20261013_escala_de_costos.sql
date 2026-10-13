-- Escala de costos por producto (opcional). Un producto sigue con costo fijo por defecto.
alter table public.productos add column if not exists tipo_costo text not null default 'fijo';

create table if not exists public.costos_escala (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  producto_id uuid not null references public.productos(id) on delete cascade,
  nombre text not null,
  costo numeric not null default 0,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists costos_escala_producto_idx on public.costos_escala (producto_id);
create index if not exists costos_escala_user_idx on public.costos_escala (auth_user_id);

alter table public.costos_escala enable row level security;
create policy costos_escala_select on public.costos_escala for select to authenticated using ((select auth.uid()) = auth_user_id);
create policy costos_escala_insert on public.costos_escala for insert to authenticated with check ((select auth.uid()) = auth_user_id);
create policy costos_escala_update on public.costos_escala for update to authenticated using ((select auth.uid()) = auth_user_id) with check ((select auth.uid()) = auth_user_id);
create policy costos_escala_delete on public.costos_escala for delete to authenticated using ((select auth.uid()) = auth_user_id);
