-- =====================================================================
-- CONFIGURACIÓN DE MÓDULO POR USUARIO (primer uso: Ventas -> "Ver las ventas de todo el negocio")
-- Fecha: 21-oct-2026 · Tabla NUEVA. No cambia ningún dato ni función existente.
--
-- Sin filas, TODO sigue exactamente como hoy (cada usuario ve solo sus propias ventas).
--   perfil_id NULL       = regla para TODOS los usuarios que no son administradores
--   perfil_id = <perfil> = regla solo para ese usuario (tiene prioridad sobre la general)
-- 'opciones' guarda las opciones del módulo, ej. {"ver_todas_las_ventas": true}.
-- Sirve para futuras opciones de otros módulos (columna 'modulo').
-- =====================================================================
create table if not exists public.config_modulo_perfiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  modulo text not null,
  perfil_id uuid null references public.perfiles_acceso(id) on delete cascade,
  opciones jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists config_modulo_perfiles_general_uk on public.config_modulo_perfiles (auth_user_id, modulo) where perfil_id is null;
create unique index if not exists config_modulo_perfiles_perfil_uk on public.config_modulo_perfiles (auth_user_id, modulo, perfil_id) where perfil_id is not null;
alter table public.config_modulo_perfiles enable row level security;
create policy config_modulo_perfiles_select_own on public.config_modulo_perfiles for select using ((select auth.uid()) = auth_user_id);
create policy config_modulo_perfiles_insert_own on public.config_modulo_perfiles for insert with check ((select auth.uid()) = auth_user_id);
create policy config_modulo_perfiles_update_own on public.config_modulo_perfiles for update using ((select auth.uid()) = auth_user_id) with check ((select auth.uid()) = auth_user_id);
create policy config_modulo_perfiles_delete_own on public.config_modulo_perfiles for delete using ((select auth.uid()) = auth_user_id);
