-- Bitácora del modo "Ver como cliente" (solo lectura) del panel de administrador.
-- Aditiva: tabla nueva, no toca ninguna tabla existente. Solo la escribe la
-- función admin-ver-como (con la llave de servicio); solo la leen los administradores.
create table if not exists public.admin_vistas_cliente (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  cliente_auth_id uuid not null,
  cliente_email text,
  cliente_negocio text,
  created_at timestamptz not null default now()
);

alter table public.admin_vistas_cliente enable row level security;

drop policy if exists admin_vistas_cliente_lectura_admin on public.admin_vistas_cliente;
create policy admin_vistas_cliente_lectura_admin on public.admin_vistas_cliente
  for select to authenticated
  using (exists (select 1 from public.administradores a
                 where a.email = (auth.jwt() ->> 'email') and a.activo));

create index if not exists admin_vistas_cliente_fecha_idx on public.admin_vistas_cliente (created_at desc);
