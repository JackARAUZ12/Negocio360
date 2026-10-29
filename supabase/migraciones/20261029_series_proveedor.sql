-- =====================================================================
-- SERIES AL COMPRAR + GARANTÍA Y RECLAMOS DE PROVEEDOR
-- Fecha: 29-oct-2026 · Solo agrega columnas/tablas nuevas · No cambia ni borra datos
--
-- QUÉ AGREGA (todo opcional; solo lo usan los negocios con "números de serie" activado):
--  1. numeros_serie: columnas nuevas (estado, compra, proveedor, garantía del proveedor).
--     Las filas que ya existen NO se tocan (estado queda vacío = "vendida", como siempre).
--  2. Candado: la misma serie de un mismo producto no puede estar dos veces "en stock".
--  3. productos.garantia_proveedor_meses: garantía que suele dar el proveedor (recordatorio).
--  4. series_compra_pendientes: series que faltan por registrar de una compra ("completar después").
--  5. reclamos_proveedor: reclamos de garantía al proveedor (solo registro; no mueve caja ni inventario).
--  6. Si una venta se anula o se elimina, las series que vinieron de una compra vuelven a "en stock"
--     (en vez de quedar vendidas o borrarse con la venta).
-- =====================================================================

alter table public.numeros_serie
  add column if not exists estado text,
  add column if not exists compra_id uuid,
  add column if not exists compra_detalle_id uuid,
  add column if not exists proveedor_id uuid,
  add column if not exists proveedor_nombre text,
  add column if not exists fecha_compra date,
  add column if not exists garantia_proveedor_meses numeric,
  add column if not exists garantia_proveedor_vence date,
  add column if not exists notas text,
  add column if not exists updated_at timestamptz;

create unique index if not exists uq_numeros_serie_en_stock
  on public.numeros_serie (auth_user_id, producto_id, lower(numero_serie))
  where estado = 'en_stock';
create index if not exists idx_numeros_serie_estado on public.numeros_serie (auth_user_id, estado);
create index if not exists idx_numeros_serie_compra on public.numeros_serie (compra_id) where compra_id is not null;

alter table public.productos add column if not exists garantia_proveedor_meses numeric;

create table if not exists public.series_compra_pendientes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  compra_id uuid not null,
  compra_detalle_id uuid,
  numero_compra text,
  fecha_compra date,
  producto_id uuid not null,
  producto_nombre text,
  proveedor_id uuid,
  proveedor_nombre text,
  cantidad_faltante integer not null check (cantidad_faltante > 0),
  created_at timestamptz not null default now(),
  unique (compra_detalle_id)
);
create index if not exists idx_series_pend_user on public.series_compra_pendientes (auth_user_id);
alter table public.series_compra_pendientes enable row level security;
drop policy if exists series_compra_pendientes_all_own on public.series_compra_pendientes;
create policy series_compra_pendientes_all_own on public.series_compra_pendientes
  for all using (auth_user_id = (select auth.uid())) with check (auth_user_id = (select auth.uid()));

create table if not exists public.reclamos_proveedor (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  numero text,
  numero_serie_id uuid,
  numero_serie text,
  producto_id uuid,
  producto_nombre text,
  proveedor_id uuid,
  proveedor_nombre text,
  compra_id uuid,
  numero_compra text,
  cliente_id uuid,
  cliente_nombre text,
  fecha_reclamo date not null default current_date,
  descripcion text,
  estado text not null default 'abierto',
  resultado text,
  resultado_nota text,
  serie_reemplazo text,
  monto_credito numeric,
  fecha_cierre date,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reclamos_prov_user on public.reclamos_proveedor (auth_user_id, estado);
alter table public.reclamos_proveedor enable row level security;
drop policy if exists reclamos_proveedor_all_own on public.reclamos_proveedor;
create policy reclamos_proveedor_all_own on public.reclamos_proveedor
  for all using (auth_user_id = (select auth.uid())) with check (auth_user_id = (select auth.uid()));

-- Venta anulada o eliminada: las series que vinieron de una compra vuelven a "en stock".
-- (Las series escritas a mano en la venta, sin compra, siguen igual que siempre.)
create or replace function public.series_proveedor_liberar_anulada()
returns trigger language plpgsql as $$
begin
  if new.estado = 'anulada' and coalesce(old.estado, '') <> 'anulada' then
    begin
      update public.numeros_serie
         set estado = 'en_stock', venta_id = null, cliente_id = null, fecha_venta = null, updated_at = now()
       where venta_id = new.id and compra_id is not null and estado = 'vendida';
    exception when others then
      null; -- nunca debe impedir anular una venta
    end;
  end if;
  return new;
end $$;
drop trigger if exists trg_series_proveedor_liberar_anulada on public.ventas;
create trigger trg_series_proveedor_liberar_anulada
  after update of estado on public.ventas
  for each row execute function public.series_proveedor_liberar_anulada();

create or replace function public.series_proveedor_liberar_eliminada()
returns trigger language plpgsql as $$
begin
  begin
    update public.numeros_serie
       set estado = 'en_stock', venta_id = null, cliente_id = null, fecha_venta = null, updated_at = now()
     where venta_id = old.id and compra_id is not null;
  exception when others then
    null;
  end;
  return old;
end $$;
drop trigger if exists trg_series_proveedor_liberar_eliminada on public.ventas;
create trigger trg_series_proveedor_liberar_eliminada
  before delete on public.ventas
  for each row execute function public.series_proveedor_liberar_eliminada();
