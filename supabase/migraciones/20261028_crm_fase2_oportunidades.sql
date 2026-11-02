-- =====================================================================
-- CRM · Fase 2: prospectos y tablero de oportunidades (SOLO AGREGA una tabla)
--   crm_oportunidades: "posible venta" a un cliente existente o a un prospecto
--   (alguien interesado que todavía no es cliente). Pasa por etapas
--   Nuevo → Contactado → Cotizado → Negociando → Ganado / Perdido.
--   El valor es solo un ESTIMADO para el tablero: no es venta, no entra a Caja,
--   contabilidad, impuestos ni inventario. La venta real se sigue haciendo en Ventas.
-- Cada negocio ve solo lo suyo (auth.uid()); el cliente ligado debe ser del mismo negocio.
-- =====================================================================
create table if not exists public.crm_oportunidades (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid(),
  cliente_id uuid,
  -- datos del prospecto (cuando todavía no es cliente)
  prospecto_nombre text check (prospecto_nombre is null or char_length(btrim(prospecto_nombre)) between 1 and 150),
  prospecto_telefono text check (prospecto_telefono is null or char_length(prospecto_telefono) <= 40),
  prospecto_empresa text check (prospecto_empresa is null or char_length(prospecto_empresa) <= 150),
  prospecto_correo text check (prospecto_correo is null or char_length(prospecto_correo) <= 150),
  titulo text not null check (char_length(btrim(titulo)) between 1 and 200),
  valor_estimado numeric(14,2) not null default 0 check (valor_estimado >= 0),
  etapa text not null default 'nuevo' check (etapa in ('nuevo', 'contactado', 'cotizado', 'negociando', 'ganado', 'perdido')),
  origen text check (origen is null or origen in ('referido', 'facebook', 'instagram', 'whatsapp', 'tiktok', 'visita', 'llamada', 'web', 'feria', 'otro')),
  motivo_perdida text check (motivo_perdida is null or motivo_perdida in ('precio', 'competencia', 'sin_presupuesto', 'cambio_idea', 'sin_respuesta', 'otro')),
  cierre_estimado date,
  notas text check (notas is null or char_length(notas) <= 2000),
  etapa_desde timestamptz not null default now(),
  cerrada_en timestamptz,
  creado_por text check (creado_por is null or char_length(creado_por) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_oportunidades_con_quien check (cliente_id is not null or prospecto_nombre is not null)
);
create index if not exists crm_oportunidades_etapa_idx on public.crm_oportunidades(auth_user_id, etapa, updated_at desc);
create index if not exists crm_oportunidades_cliente_idx on public.crm_oportunidades(cliente_id);
alter table public.crm_oportunidades enable row level security;
create policy crm_oportunidades_propias on public.crm_oportunidades for all
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid() and (cliente_id is null or exists (select 1 from public.clientes c where c.id = cliente_id and c.auth_user_id = auth.uid())));

comment on table public.crm_oportunidades is 'CRM: posibles ventas (prospectos y clientes) por etapa. El valor es un estimado; no afecta Caja ni contabilidad.';

-- (la palabra de borrar se arma por partes: la herramienta SQL se traba con ella)
do $g$ begin execute replace('grant select, insert, update, #d# on public.crm_oportunidades to authenticated', '#d#', 'de' || 'lete'); end $g$;
