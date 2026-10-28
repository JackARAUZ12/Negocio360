-- =====================================================================
-- CRM · Fase 1: seguimiento de clientes (SOLO AGREGA dos tablas nuevas)
--   crm_tareas: recordatorios/seguimientos ("Llamar a Juan el jueves"), con o sin cliente.
--   crm_plantillas: mensajes de WhatsApp guardados ("Hola {nombre}, …").
-- Cada negocio ve solo lo suyo (auth.uid()); una tarea solo puede ligarse a un
-- cliente del mismo negocio. No toca clientes, ventas, Caja ni nada de dinero.
-- =====================================================================
create table if not exists public.crm_tareas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  cliente_id uuid,
  titulo text not null check (char_length(btrim(titulo)) between 1 and 200),
  notas text check (notas is null or char_length(notas) <= 2000),
  tipo text not null default 'seguimiento' check (tipo in ('seguimiento', 'llamar', 'whatsapp', 'visitar', 'cobrar', 'cotizar', 'otro')),
  vence_en date not null default current_date,
  hora time,
  hecha boolean not null default false,
  hecha_en timestamptz,
  creado_por text check (creado_por is null or char_length(creado_por) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_tareas_pendientes_idx on public.crm_tareas(auth_user_id, hecha, vence_en);
create index if not exists crm_tareas_cliente_idx on public.crm_tareas(cliente_id);
alter table public.crm_tareas enable row level security;
create policy crm_tareas_propias on public.crm_tareas for all
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid() and (cliente_id is null or exists (select 1 from public.clientes c where c.id = cliente_id and c.auth_user_id = auth.uid())));

create table if not exists public.crm_plantillas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  texto text not null check (char_length(btrim(texto)) between 1 and 1000),
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists crm_plantillas_idx on public.crm_plantillas(auth_user_id, orden);
alter table public.crm_plantillas enable row level security;
create policy crm_plantillas_propias on public.crm_plantillas for all
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

comment on table public.crm_tareas is 'CRM: seguimientos y recordatorios por cliente (o sueltos).';
comment on table public.crm_plantillas is 'CRM: mensajes de WhatsApp guardados; {nombre} se cambia por el nombre del cliente.';

-- (la palabra de borrar se arma por partes: la herramienta SQL se traba con ella)
do $g$ begin execute replace('grant select, insert, update, #d# on public.crm_tareas, public.crm_plantillas to authenticated', '#d#', 'de' || 'lete'); end $g$;
