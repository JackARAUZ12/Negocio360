-- Transporte · Fase 11 (Mantenimiento y llantas) y Fase 12 (Entrega, incidencias y reportes).
-- Solo tablas nuevas y aditivas: no se modifica ninguna tabla existente.

create table if not exists public.transporte_mant_planes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  unidad_id uuid not null,
  nombre text not null,
  cada_km numeric null,
  cada_dias integer null,
  ultimo_km numeric null,
  ultima_fecha date null,
  aviso_km numeric not null default 500,
  aviso_dias integer not null default 15,
  activo boolean not null default true,
  notas text null,
  created_at timestamptz not null default now()
);
create table if not exists public.transporte_mant_ordenes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  numero text not null,
  unidad_id uuid not null,
  plan_id uuid null,
  tipo text not null default 'preventivo',
  descripcion text not null,
  taller text null,
  fecha date not null default current_date,
  odometro_km numeric null,
  mano_obra numeric not null default 0,
  repuestos numeric not null default 0,
  total numeric not null default 0,
  estado text not null default 'abierta',
  unidad_estado_previo text null,
  gasto_id uuid null,
  movimiento_caja_id uuid null,
  cerrada_en timestamptz null,
  notas text null,
  created_at timestamptz not null default now()
);
create table if not exists public.transporte_llantas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  codigo text not null,
  marca text null,
  modelo text null,
  medida text null,
  estado text not null default 'nueva',
  unidad_id uuid null,
  posicion text null,
  km_montaje numeric null,
  fecha_montaje date null,
  km_previos numeric not null default 0,
  vida_util_km numeric not null default 80000,
  costo numeric not null default 0,
  fecha_compra date null,
  proveedor text null,
  notas text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.transporte_llantas_movs (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  llanta_id uuid not null,
  tipo text not null,
  unidad_id uuid null,
  posicion text null,
  odometro_km numeric null,
  fecha date not null default current_date,
  notas text null,
  created_at timestamptz not null default now()
);
create table if not exists public.transporte_entregas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  orden_id uuid not null,
  receptor text not null,
  receptor_documento text null,
  recibido_en timestamptz not null default now(),
  conforme boolean not null default true,
  bultos_recibidos numeric null,
  observaciones text null,
  firma_url text null,
  firma_path text null,
  created_at timestamptz not null default now()
);
create table if not exists public.transporte_incidencias (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  numero text not null,
  orden_id uuid null,
  unidad_id uuid null,
  conductor_id uuid null,
  tipo text not null default 'otro',
  gravedad text not null default 'media',
  descripcion text not null,
  fecha date not null default current_date,
  estado text not null default 'abierta',
  costo_estimado numeric not null default 0,
  monto_reclamado numeric not null default 0,
  resolucion text null,
  resuelta_en timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tmp_unidad on public.transporte_mant_planes(auth_user_id, unidad_id);
create index if not exists idx_tmo_unidad on public.transporte_mant_ordenes(auth_user_id, unidad_id);
create index if not exists idx_tll_user on public.transporte_llantas(auth_user_id, estado);
create index if not exists idx_tllm_llanta on public.transporte_llantas_movs(llanta_id);
create unique index if not exists uq_tent_orden on public.transporte_entregas(auth_user_id, orden_id);
create index if not exists idx_tinc_user on public.transporte_incidencias(auth_user_id, estado);

do $$
declare t text; p text;
begin
  foreach t in array array['transporte_mant_planes','transporte_mant_ordenes','transporte_llantas','transporte_llantas_movs','transporte_entregas','transporte_incidencias'] loop
    execute format('alter table public.%I enable row level security', t);
    p := 'p_' || t;
    execute format('create policy %I on public.%I for all using ((select auth.uid()) = auth_user_id) with check ((select auth.uid()) = auth_user_id)', p||'_all', t);
  end loop;
end $$;
