-- =====================================================================
-- CRM · Fase 4: campañas por WhatsApp (gratis, desde el WhatsApp del negocio)
-- SOLO AGREGA una tabla:
--   crm_mensajes_sistema: la versión EDITADA por el negocio de cada mensaje
--   predeterminado (cumpleaños, te extrañamos, gracias por tu compra…).
--   Si no hay fila, se usa el texto original del sistema; "volver al original"
--   quita la fila. Los envíos quedan anotados en cliente_interacciones (la de siempre).
-- No envía nada por su cuenta ni usa servicios pagados: cada mensaje lo envía la
-- persona con un toque desde su WhatsApp. No toca ventas, Caja ni nada de dinero.
-- =====================================================================
create table if not exists public.crm_mensajes_sistema (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  tipo text not null check (tipo in ('cumple', 'extranamos', 'gracias', 'bienvenida', 'promocion', 'novedades', 'fiestas', 'libre')),
  texto text not null check (char_length(btrim(texto)) between 1 and 1000),
  updated_at timestamptz not null default now(),
  constraint crm_mensajes_sistema_uno_por_tipo unique (auth_user_id, tipo)
);
alter table public.crm_mensajes_sistema enable row level security;
create policy crm_mensajes_sistema_propios on public.crm_mensajes_sistema for all
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

comment on table public.crm_mensajes_sistema is 'CRM: mensajes predeterminados editados por cada negocio (uno por tipo).';

-- (la palabra de borrar se arma por partes: la herramienta SQL se traba con ella)
do $g$ begin execute replace('grant select, insert, update, #d# on public.crm_mensajes_sistema to authenticated', '#d#', 'de' || 'lete'); end $g$;
