-- ============================================================
-- Módulo COTIZACIONES (nuevo, independiente de Proformas)
--
-- Una cotización solo muestra productos/servicios y precios a un
-- cliente. NO crea ventas ni créditos, NO toca Caja, inventario,
-- impuestos ni contabilidad. Por eso tiene sus PROPIAS tablas y su
-- PROPIA numeración (COT-000001…): nada de Proformas cambia.
--
-- Módulo opcional, APAGADO para todas las cuentas
-- (configuracion_empresa.usa_modulo_cotizaciones = false por defecto).
-- Todo es aditivo: no se modifica ninguna tabla ni dato existente,
-- solo se agrega una columna con valor por defecto false.
-- ============================================================

-- Interruptor del módulo (apagado por defecto para toda cuenta)
alter table public.configuracion_empresa
  add column if not exists usa_modulo_cotizaciones boolean not null default false;

-- ---------- Cotizaciones ----------
create table if not exists public.cotizaciones (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid not null references auth.users(id) on delete cascade,
  numero_cotizacion  text,
  cliente_id         uuid references public.clientes(id) on delete set null,
  cliente_nombre     text,
  fecha              date default current_date,
  fecha_vencimiento  date,
  subtotal           numeric default 0,
  descuento          numeric default 0,
  impuesto           numeric default 0,
  iva_activo         boolean default false,
  iva_porcentaje     numeric default 0,
  total              numeric default 0,
  costo_total        numeric default 0,
  estado             text not null default 'borrador'
                     check (estado in ('borrador','pendiente','enviada','aprobada','rechazada','vencida')),
  observaciones      text,
  usuario_nombre     text,
  mostrar_proveedor  boolean default false,
  motivo_perdida     text,
  enviada_at         timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create index if not exists idx_cotizaciones_auth_user on public.cotizaciones(auth_user_id);
create index if not exists idx_cotizaciones_cliente   on public.cotizaciones(cliente_id);

-- ---------- Líneas de la cotización ----------
create table if not exists public.cotizacion_detalles (
  id                  uuid primary key default gen_random_uuid(),
  auth_user_id        uuid not null references auth.users(id) on delete cascade,
  cotizacion_id       uuid not null references public.cotizaciones(id) on delete cascade,
  producto_id         uuid,
  producto_nombre     text,
  producto_sku        text,
  tipo_item           text,
  cantidad            numeric,
  precio              numeric default 0,
  costo               numeric default 0,
  descuento           numeric default 0,
  subtotal            numeric default 0,
  ganancia            numeric default 0,
  escala_id           uuid,
  escala_nombre       text,
  combo_id            uuid references public.combos(id) on delete set null,
  origen_stock_id     uuid,
  origen_stock_nombre text,
  es_regalia          boolean default false,
  proveedor_id        uuid,
  proveedor_nombre    text,
  cantidad_pedida     numeric,
  unidad_pedida       text
);
create index if not exists idx_cotizacion_detalles_cot on public.cotizacion_detalles(cotizacion_id);

-- ---------- Seguridad: cada negocio solo ve y toca lo suyo ----------
alter table public.cotizaciones        enable row level security;
alter table public.cotizacion_detalles enable row level security;

create policy cotizaciones_select on public.cotizaciones for select using (auth.uid() = auth_user_id);
create policy cotizaciones_insert on public.cotizaciones for insert with check (auth.uid() = auth_user_id);
create policy cotizaciones_update on public.cotizaciones for update using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);
create policy cotizaciones_delete on public.cotizaciones for delete using (auth.uid() = auth_user_id);

create policy cotizacion_detalles_select on public.cotizacion_detalles for select using (auth.uid() = auth_user_id);
create policy cotizacion_detalles_insert on public.cotizacion_detalles for insert with check (auth.uid() = auth_user_id);
create policy cotizacion_detalles_update on public.cotizacion_detalles for update using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);
create policy cotizacion_detalles_delete on public.cotizacion_detalles for delete using (auth.uid() = auth_user_id);

-- ---------- Numeración propia: COT-000001, COT-000002… ----------
create table if not exists public.cotizaciones_numeracion (
  auth_user_id  uuid primary key references auth.users(id) on delete cascade,
  ultimo_numero integer not null default 0
);
alter table public.cotizaciones_numeracion enable row level security;  -- solo la función de abajo la usa

create or replace function public.generar_numero_cotizacion(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_numero integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'No autorizado'; end if;
  insert into public.cotizaciones_numeracion(auth_user_id, ultimo_numero) values (p_user_id, 1)
    on conflict (auth_user_id) do update set ultimo_numero = cotizaciones_numeracion.ultimo_numero + 1
    returning ultimo_numero into v_numero;
  return 'COT-' || lpad(v_numero::text, 6, '0');
end $$;

revoke all on function public.generar_numero_cotizacion(uuid) from public, anon;
grant execute on function public.generar_numero_cotizacion(uuid) to authenticated;
