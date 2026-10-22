-- =====================================================================
-- PRODUCTOS/SERVICIOS: permisos por usuario (qué acciones puede hacer cada usuario)
-- Fecha: 21-oct-2026 · Tabla NUEVA. No cambia ningún dato ni función existente.
--
-- Sin filas en esta tabla, TODO sigue exactamente como hoy (todos pueden todo).
--   perfil_id NULL      = regla para TODOS los usuarios que no son administradores
--   perfil_id = <perfil> = regla solo para ese usuario (tiene prioridad sobre la general)
-- 'acciones' guarda solo lo que se configuró, ej. {"eliminar": false, "importar": false};
-- lo que no aparece queda permitido. Los administradores nunca se bloquean.
-- =====================================================================
create table if not exists public.permisos_inventario (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  perfil_id uuid null references public.perfiles_acceso(id) on delete cascade,
  acciones jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists permisos_inventario_general_uk on public.permisos_inventario (auth_user_id) where perfil_id is null;
create unique index if not exists permisos_inventario_perfil_uk on public.permisos_inventario (auth_user_id, perfil_id) where perfil_id is not null;
alter table public.permisos_inventario enable row level security;
create policy permisos_inventario_select_own on public.permisos_inventario for select using ((select auth.uid()) = auth_user_id);
create policy permisos_inventario_insert_own on public.permisos_inventario for insert with check ((select auth.uid()) = auth_user_id);
create policy permisos_inventario_update_own on public.permisos_inventario for update using ((select auth.uid()) = auth_user_id) with check ((select auth.uid()) = auth_user_id);
create policy permisos_inventario_delete_own on public.permisos_inventario for delete using ((select auth.uid()) = auth_user_id);
