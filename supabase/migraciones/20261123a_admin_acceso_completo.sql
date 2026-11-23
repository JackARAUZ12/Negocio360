-- Acceso completo (lectura y escritura) desde el panel de administrador, SOLO para
-- las cuentas que el dueño del sistema marque aquí (cuentas propias). Aditiva:
-- tabla nueva + columna nueva con valor por defecto; no cambia datos existentes.
create table if not exists public.admin_acceso_completo (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  etiqueta text,
  creado_por text,
  created_at timestamptz not null default now()
);
alter table public.admin_acceso_completo enable row level security;
revoke all on public.admin_acceso_completo from anon;
drop policy if exists admin_acceso_completo_lectura_admin on public.admin_acceso_completo;
create policy admin_acceso_completo_lectura_admin on public.admin_acceso_completo
  for select to authenticated
  using (exists (select 1 from public.administradores a
                 where a.email = (auth.jwt() ->> 'email') and a.activo));

-- La bitácora distingue "solo lectura" de "acceso completo". Las filas viejas quedan como 'lectura'.
alter table public.admin_vistas_cliente add column if not exists modo text not null default 'lectura';

-- Cuenta de ingresos del dueño (sin nombre de negocio), pedida el 23-11-2026.
insert into public.admin_acceso_completo (auth_user_id, etiqueta, creado_por)
select id, 'Cuenta de ingresos (Hazel)', 'dueño del sistema'
from auth.users where id = 'ef3ea426-b7b8-4b78-91a3-5dfa1890595a'
on conflict (auth_user_id) do nothing;
