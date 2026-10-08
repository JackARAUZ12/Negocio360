-- Exportar toda mi informacion (segundo plano) -- Negocio360
-- Ejecutar UNA vez en Supabase > SQL Editor. Solo agrega una tabla y un almacenamiento
-- privado nuevos; no modifica nada existente.
begin;

create table if not exists public.exportaciones (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null default auth.uid(),
  grupos        text[] not null default '{}',
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','procesando','listo','error')),
  tablas_total  int  not null default 0,
  tablas_hechas int  not null default 0,
  filas_total   bigint not null default 0,
  archivo_path  text,
  tamano_bytes  bigint,
  error_msg     text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  expira_at     timestamptz
);

create index if not exists exportaciones_usuario_idx on public.exportaciones (auth_user_id, created_at desc);

alter table public.exportaciones enable row level security;

drop policy if exists exportaciones_select_propio on public.exportaciones;
create policy exportaciones_select_propio on public.exportaciones
  for select to authenticated using (auth_user_id = auth.uid());

-- El usuario solo puede PEDIR una exportacion (estado pendiente); el servidor
-- es quien la marca como lista, con error, etc.
drop policy if exists exportaciones_insert_propio on public.exportaciones;
create policy exportaciones_insert_propio on public.exportaciones
  for insert to authenticated
  with check (auth_user_id = auth.uid() and estado = 'pendiente' and archivo_path is null);

drop policy if exists exportaciones_delete_propio on public.exportaciones;
create policy exportaciones_delete_propio on public.exportaciones
  for delete to authenticated using (auth_user_id = auth.uid() and estado in ('pendiente','error'));

-- Almacenamiento PRIVADO: cada quien solo puede leer su propia carpeta
insert into storage.buckets (id, name, public)
values ('exportaciones', 'exportaciones', false)
on conflict (id) do nothing;

drop policy if exists exportaciones_leer_propio on storage.objects;
create policy exportaciones_leer_propio on storage.objects
  for select to authenticated
  using (bucket_id = 'exportaciones' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
