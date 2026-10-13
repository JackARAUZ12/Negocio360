-- ============================================================
-- Cuentas de prueba (submódulo "Pruebas" del panel de administración)
-- Registro APARTE: no toca la tabla usuarios ni ninguna otra.
-- Las cuentas listadas aquí se excluyen de Usuarios / estadísticas /
-- Clientes por período del panel admin y se muestran en "Pruebas".
-- ============================================================
create table if not exists public.cuentas_prueba (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  etiqueta     text not null,
  tipo         text not null default 'interna' check (tipo in ('demo_publica','interna')),
  rubro        text,
  nota         text,
  orden        integer not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.cuentas_prueba enable row level security;

drop policy if exists cuentas_prueba_admin_select on public.cuentas_prueba;
drop policy if exists cuentas_prueba_admin_insert on public.cuentas_prueba;
drop policy if exists cuentas_prueba_admin_update on public.cuentas_prueba;
drop policy if exists cuentas_prueba_admin_delete on public.cuentas_prueba;
create policy cuentas_prueba_admin_select on public.cuentas_prueba for select to authenticated using ((select public.is_admin_activo()));
create policy cuentas_prueba_admin_insert on public.cuentas_prueba for insert to authenticated with check ((select public.is_admin_activo()));
create policy cuentas_prueba_admin_update on public.cuentas_prueba for update to authenticated using ((select public.is_admin_activo())) with check ((select public.is_admin_activo()));
create policy cuentas_prueba_admin_delete on public.cuentas_prueba for delete to authenticated using ((select public.is_admin_activo()));

-- Cuentas de prueba que ya existían
insert into public.cuentas_prueba (auth_user_id, etiqueta, tipo, rubro, nota, orden) values
 ('64b4804b-7b2b-44d8-a365-bc04ec5950ec','Cuenta de prueba (Juan Pérez)','demo_publica','ferreteria','Cuenta de demostración original (botón del login).',1),
 ('b699660c-b808-4f0a-9b24-d0df60a92e83','Mi cuenta (Jack Arauz)','interna',null,'Cuenta propia del dueño del sistema.',2),
 ('f456c148-d363-4a1d-ba98-6266d169e148','Hazel Giselle (Techworld)','interna',null,'Cuenta de Catálogo360 de prueba.',3),
 ('0a367694-8472-4da4-bf25-65a95ce672eb','TechWorld Studio','interna','farmacia','Cuenta de prueba de TechWorld.',4)
on conflict (auth_user_id) do nothing;
