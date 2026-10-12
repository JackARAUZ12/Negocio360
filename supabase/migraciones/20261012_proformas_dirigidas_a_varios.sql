-- Proformas dirigidas a varios clientes (aditivo: las proformas existentes quedan igual).
alter table public.proformas add column if not exists dirigida_a_varios boolean not null default false;

create table if not exists public.proforma_destinatarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  proforma_id uuid not null references public.proformas(id) on delete cascade,
  cliente_id uuid null,
  nombre text not null,
  telefono text null,
  correo text null,
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_prof_dest_proforma on public.proforma_destinatarios(proforma_id);
create index if not exists idx_prof_dest_user on public.proforma_destinatarios(auth_user_id);
alter table public.proforma_destinatarios enable row level security;
create policy prof_dest_select on public.proforma_destinatarios for select using (auth.uid() = auth_user_id);
create policy prof_dest_insert on public.proforma_destinatarios for insert with check (auth.uid() = auth_user_id);
create policy prof_dest_update on public.proforma_destinatarios for update using (auth.uid() = auth_user_id);
create policy prof_dest_delete on public.proforma_destinatarios for delete using (auth.uid() = auth_user_id);
