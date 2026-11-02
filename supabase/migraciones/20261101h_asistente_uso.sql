-- Registro del uso del asistente de IA, solo para poner un tope de preguntas por usuario (evita gastar la cuenta de Anthropic).
-- Tabla NUEVA y privada: solo el servidor (service_role) la lee y escribe; los usuarios no la ven ni la tocan. No cambia nada existente.
-- ESTADO: APLICADA.
create table if not exists public.asistente_uso (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null,
  creado_at timestamptz not null default now()
);
create index if not exists asistente_uso_usuario_fecha on public.asistente_uso (auth_user_id, creado_at desc);
alter table public.asistente_uso enable row level security;
revoke all on public.asistente_uso from anon, authenticated;
