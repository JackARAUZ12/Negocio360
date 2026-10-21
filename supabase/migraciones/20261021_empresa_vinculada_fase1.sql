-- =====================================================================
-- EMPRESA VINCULADA — FASE 1: vínculo entre negocios y cambio de negocio
-- Fecha: 21-oct-2026 · Solo AGREGA tablas y funciones nuevas.
--
-- Para negocios que son la MISMA empresa pero se manejan como cuentas
-- separadas (ej. All Plastic Comercial y All Plastic Mayorista):
--  * empresas_vinculadas / empresa_miembros: qué negocios forman la empresa.
--    Cada negocio conserva su correo, contraseña, usuarios y datos; nada
--    de lo existente cambia ni se mueve.
--  * empresa_cambios_log: constancia de cada vez que alguien pasó de un
--    negocio al otro (lo escribe solo la función del servidor).
--  * empresa_mis_negocios(): los OTROS negocios de mi empresa (para el
--    botón "Ir a …"). Cuentas que no están en una empresa: lista vacía,
--    nada cambia para ellas.
-- El paso de un negocio a otro lo hace la Edge Function
-- "empresa-cambiar-negocio" (pase de un solo uso, sin guardar contraseñas).
-- Los vínculos los crea por ahora el equipo de Negocio360 (con autorización
-- del dueño); los clientes no pueden crearlos ni modificarlos.
-- =====================================================================

create table if not exists public.empresas_vinculadas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.empresas_vinculadas is
  'Empresa formada por varios negocios (cuentas) que trabajan en conjunto. Cada negocio sigue siendo una cuenta independiente.';

create table if not exists public.empresa_miembros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas_vinculadas(id) on delete cascade,
  auth_user_id uuid not null,
  nombre_negocio text not null,
  orden smallint not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint empresa_miembros_un_negocio_una_empresa unique (auth_user_id)
);
create index if not exists empresa_miembros_empresa_idx on public.empresa_miembros (empresa_id);
comment on table public.empresa_miembros is
  'Negocios (auth_user_id) que forman cada empresa vinculada. Un negocio pertenece a lo sumo a una empresa.';

create table if not exists public.empresa_cambios_log (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  desde_auth_user_id uuid not null,
  hacia_auth_user_id uuid not null,
  perfil_nombre text,
  created_at timestamptz not null default now()
);
comment on table public.empresa_cambios_log is
  'Constancia de cada paso de un negocio a otro de la misma empresa (lo escribe la función empresa-cambiar-negocio).';

-- RLS: nadie escribe desde la app. Cada negocio solo LEE lo de su propia empresa.
alter table public.empresas_vinculadas enable row level security;
alter table public.empresa_miembros   enable row level security;
alter table public.empresa_cambios_log enable row level security;

create or replace function public.empresa_id_de_mi_negocio()
returns uuid language sql stable security definer set search_path = public as $$
  select m.empresa_id from empresa_miembros m join empresas_vinculadas e on e.id = m.empresa_id
   where m.auth_user_id = auth.uid() and m.activo and e.activa
$$;
revoke all on function public.empresa_id_de_mi_negocio() from public, anon;
grant execute on function public.empresa_id_de_mi_negocio() to authenticated;

drop policy if exists empresas_vinculadas_leer on public.empresas_vinculadas;
create policy empresas_vinculadas_leer on public.empresas_vinculadas
  for select to authenticated using (id = public.empresa_id_de_mi_negocio());
drop policy if exists empresa_miembros_leer on public.empresa_miembros;
create policy empresa_miembros_leer on public.empresa_miembros
  for select to authenticated using (empresa_id = public.empresa_id_de_mi_negocio());
drop policy if exists empresa_cambios_log_leer on public.empresa_cambios_log;
create policy empresa_cambios_log_leer on public.empresa_cambios_log
  for select to authenticated using (empresa_id = public.empresa_id_de_mi_negocio());

-- Los OTROS negocios de mi empresa (para el botón "Ir a …").
create or replace function public.empresa_mis_negocios()
returns table (auth_user_id uuid, nombre_negocio text, empresa text)
language sql stable security definer set search_path = public as $$
  select m.auth_user_id, m.nombre_negocio, e.nombre
    from empresa_miembros m join empresas_vinculadas e on e.id = m.empresa_id
   where m.empresa_id = public.empresa_id_de_mi_negocio()
     and m.activo and m.auth_user_id <> auth.uid()
   order by m.orden, m.nombre_negocio
$$;
revoke all on function public.empresa_mis_negocios() from public, anon;
grant execute on function public.empresa_mis_negocios() to authenticated;
