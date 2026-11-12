-- =====================================================================
-- ADMIN · Historial de estado de cuenta (12-nov-2026)
-- Guarda cada vez que una cuenta pasa de activa a suspendida (o al revés),
-- para que Estadísticas de clientes muestre suspensiones y reactivaciones
-- por mes con fechas reales. Solo AGREGA: una tabla y un registro automático.
-- Si guardar el historial fallara, el cambio de estado sigue igual (nunca bloquea).
-- Solo administradores activos pueden leerlo.
-- =====================================================================
create table if not exists public.admin_estado_cuenta_historial (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  estado_anterior text,
  estado_nuevo text,
  cambiado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_aech_fecha on public.admin_estado_cuenta_historial (created_at desc);
alter table public.admin_estado_cuenta_historial enable row level security;
drop policy if exists aech_admin_select on public.admin_estado_cuenta_historial;
create policy aech_admin_select on public.admin_estado_cuenta_historial for select to authenticated using (public.is_admin_activo());

create or replace function public._aech_registrar() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    insert into public.admin_estado_cuenta_historial (auth_user_id, estado_anterior, estado_nuevo, cambiado_por)
    values (new.auth_user_id, old.estado_cuenta, new.estado_cuenta, coalesce(auth.email(), 'sistema'));
  exception when others then
    raise warning 'historial estado cuenta: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public._aech_registrar() from public, anon, authenticated;
drop trigger if exists trg_aech_registrar on public.usuarios;
create trigger trg_aech_registrar after update of estado_cuenta on public.usuarios
  for each row when (old.estado_cuenta is distinct from new.estado_cuenta)
  execute function public._aech_registrar();
