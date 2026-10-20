-- =====================================================================
-- MÓDULO ESPECIAL DE DISEÑO · MARCA DE AGUA
-- Fecha: 21-oct-2026
--
-- Las FOTOS nunca se guardan: la marca de agua se aplica en el navegador
-- y la persona descarga el resultado. Aquí solo se guarda la
-- CONFIGURACIÓN de cada marca de agua (texto o logo) para reutilizarla.
-- El logo de una marca de tipo "logo" se guarda en el bucket
-- inventario_fotos, en la carpeta propia de la cuenta:
--   <auth_user_id>/diseno/marcas/<archivo>
--
-- No cambia ni borra ningún dato existente. Interruptor apagado por
-- defecto para todas las cuentas.
-- =====================================================================

alter table public.configuracion_empresa add column if not exists usa_modulo_diseno boolean not null default false;

create table if not exists public.diseno_marcas_agua (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid() references auth.users(id),
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  tipo text not null check (tipo in ('texto','logo')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and length(config::text) <= 4000),
  logo_path text check (logo_path is null or (length(logo_path) <= 300 and split_part(logo_path, '/', 1) = auth_user_id::text)),
  predeterminada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diseno_logo_requerido check (tipo <> 'logo' or logo_path is not null)
);
create index if not exists diseno_marcas_agua_user_idx on public.diseno_marcas_agua (auth_user_id);
create unique index if not exists diseno_marcas_agua_pred_uk on public.diseno_marcas_agua (auth_user_id) where predeterminada;

alter table public.diseno_marcas_agua enable row level security;
create policy diseno_marcas_select on public.diseno_marcas_agua for select to authenticated using (auth_user_id = auth.uid());
create policy diseno_marcas_insert on public.diseno_marcas_agua for insert to authenticated with check (auth_user_id = auth.uid());
create policy diseno_marcas_update on public.diseno_marcas_agua for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy diseno_marcas_delete on public.diseno_marcas_agua for delete to authenticated using (auth_user_id = auth.uid());

-- Máximo 50 marcas de agua guardadas por cuenta (evita abusos)
create or replace function public._diseno_marcas_limite()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.diseno_marcas_agua where auth_user_id = new.auth_user_id) >= 50 then
    raise exception 'Límite de 50 marcas de agua guardadas';
  end if;
  return new;
end $$;
create trigger trg_diseno_marcas_limite before insert on public.diseno_marcas_agua
  for each row execute function public._diseno_marcas_limite();
