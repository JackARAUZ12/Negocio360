-- =====================================================================
-- COMISIONES · módulo propio (separado de Salarios)
-- SOLO AGREGA: una opción apagada por defecto, tres tablas y funciones nuevas.
-- No cambia ninguna tabla ni función existente (Salarios, Freelancers, Ventas y Caja quedan igual).
--
-- QUÉ HACE
--  * Personas con regla de comisión: % de la venta (sin IVA), % de la ganancia, o monto fijo por venta.
--  * Una fila de comisión POR CADA VENTA (comision_movimientos). Se calcula con el % vigente ese día y ya
--    no cambia si luego se cambia la regla.
--  * Se paga desde aquí: varias comisiones juntas, con egreso en Caja en la misma operación.
-- SEGURIDAD
--  * Lectura solo del dueño (RLS). Nadie escribe directo: todo pasa por funciones que validan sesión,
--    dueño, opción encendida, montos y estados.
-- ANTI-DUPLICADO
--  * Una venta genera UNA sola comisión por persona (índice único). Generar se puede repetir sin duplicar.
--  * Pagar es todo-o-nada y una comisión pagada no se puede pagar ni anular otra vez.
-- =====================================================================

alter table public.configuracion_empresa
  add column if not exists usa_modulo_comisiones boolean not null default false;

create table if not exists public.comision_beneficiarios (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  nombre         text not null check (char_length(btrim(nombre)) between 2 and 120),
  vendedor_nombre text check (vendedor_nombre is null or char_length(vendedor_nombre) <= 120),
  base           text not null default 'venta' check (base in ('venta','ganancia','fijo')),
  valor          numeric(12,4) not null check (valor >= 0),
  fecha_inicio   date not null default current_date,
  freelancer_id  uuid,
  telefono       text check (telefono is null or char_length(telefono) <= 40),
  notas          text check (notas is null or char_length(notas) <= 500),
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (base <> 'venta' and base <> 'ganancia' or valor <= 100)
);
create unique index if not exists comision_benef_nombre_unico on public.comision_beneficiarios(auth_user_id, lower(btrim(nombre)));
create unique index if not exists comision_benef_freelancer_unico on public.comision_beneficiarios(auth_user_id, freelancer_id) where freelancer_id is not null;

create table if not exists public.comision_pagos (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null references auth.users(id) on delete cascade,
  beneficiario_id  uuid not null references public.comision_beneficiarios(id) on delete restrict,
  total            numeric(14,2) not null check (total > 0),
  cantidad         integer not null check (cantidad > 0),
  fecha            date not null default current_date,
  metodo_pago_id   uuid,
  metodo_pago_nombre text,
  banco_id         uuid,
  caja_mov_id      uuid,
  observaciones    text check (observaciones is null or char_length(observaciones) <= 500),
  creado_por       text check (creado_por is null or char_length(creado_por) <= 120),
  created_at       timestamptz not null default now()
);
create index if not exists comision_pagos_user_idx on public.comision_pagos(auth_user_id, fecha desc);

create table if not exists public.comision_movimientos (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null references auth.users(id) on delete cascade,
  beneficiario_id  uuid not null references public.comision_beneficiarios(id) on delete restrict,
  origen           text not null default 'venta' check (origen in ('venta','manual','taller')),
  venta_id         uuid references public.ventas(id) on delete set null,
  venta_numero     text,
  fecha            date not null default current_date,
  base_monto       numeric(14,2) not null default 0,
  porcentaje       numeric(9,4) not null default 0,
  monto            numeric(14,2) not null check (monto >= 0),
  estado           text not null default 'pendiente' check (estado in ('pendiente','pagada','anulada')),
  pago_id          uuid references public.comision_pagos(id) on delete set null,
  nota             text check (nota is null or char_length(nota) <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists comision_mov_venta_unica on public.comision_movimientos(beneficiario_id, venta_id) where venta_id is not null;
create index if not exists comision_mov_user_idx on public.comision_movimientos(auth_user_id, estado, fecha desc);
create index if not exists comision_mov_benef_idx on public.comision_movimientos(beneficiario_id, estado);

do $$
declare t text;
begin
  foreach t in array array['comision_beneficiarios','comision_pagos','comision_movimientos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select using (auth_user_id = (select auth.uid()))', t || '_ver', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

create or replace function public._comision_activo(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce((select usa_modulo_comisiones from public.configuracion_empresa where auth_user_id = p_uid), false);
$f$;
revoke all on function public._comision_activo(uuid) from public, anon, authenticated;

-- ---------- Personas y reglas ----------
create or replace function public.comision_beneficiario_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); v_id uuid := nullif(p ->> 'id', '')::uuid; v_nombre text := btrim(coalesce(p ->> 'nombre', ''));
  v_vend text := nullif(btrim(coalesce(p ->> 'vendedor_nombre', '')), ''); v_base text := coalesce(nullif(p ->> 'base', ''), 'venta');
  v_valor numeric := nullif(p ->> 'valor', '')::numeric; v_ini date := coalesce(nullif(p ->> 'fecha_inicio', '')::date, current_date);
  v_tel text := left(nullif(btrim(coalesce(p ->> 'telefono', '')), ''), 40); v_notas text := left(nullif(btrim(coalesce(p ->> 'notas', '')), ''), 500);
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._comision_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 120 then return jsonb_build_object('ok', false, 'motivo', 'nombre'); end if;
  if v_base not in ('venta', 'ganancia', 'fijo') then return jsonb_build_object('ok', false, 'motivo', 'base'); end if;
  if v_valor is null or v_valor < 0 or (v_base <> 'fijo' and v_valor > 100) or v_valor > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  if v_vend is not null and char_length(v_vend) > 120 then return jsonb_build_object('ok', false, 'motivo', 'vendedor'); end if;
  if v_id is null then
    insert into public.comision_beneficiarios(auth_user_id, nombre, vendedor_nombre, base, valor, fecha_inicio, telefono, notas)
    values (v_uid, v_nombre, v_vend, v_base, v_valor, v_ini, v_tel, v_notas) returning id into v_id;
  else
    update public.comision_beneficiarios set nombre = v_nombre, vendedor_nombre = v_vend, base = v_base, valor = v_valor, fecha_inicio = v_ini, telefono = v_tel, notas = v_notas, updated_at = now()
     where id = v_id and auth_user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'motivo', 'nombre_duplicado');
end;
$f$;

create or replace function public.comision_beneficiario_archivar(p_id uuid, p_activo boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._comision_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  update public.comision_beneficiarios set activo = coalesce(p_activo, true), updated_at = now() where id = p_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end;
$f$;

-- Copia (no mueve) a quienes ya tienes en Freelancers con comisión por porcentaje.
-- Empiezan DESPUÉS de su último pago registrado en Salarios, para no pagar dos veces lo mismo.
create or replace function public.comision_importar_freelancers()
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); f record; v_n integer := 0; v_fijo integer := 0; v_ini date;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._comision_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  for f in select * from public.freelancers where auth_user_id = v_uid and coalesce(estado, 'activo') = 'activo' loop
    if f.tipo_comision <> 'porcentaje' or coalesce(f.porcentaje_comision, 0) <= 0 or f.porcentaje_comision > 100 then v_fijo := v_fijo + 1; continue; end if;
    if exists (select 1 from public.comision_beneficiarios where auth_user_id = v_uid and (freelancer_id = f.id or lower(btrim(nombre)) = lower(btrim(f.nombre)))) then continue; end if;
    select max(periodo_fin) + 1 into v_ini from public.freelancers_pagos where freelancer_id = f.id and auth_user_id = v_uid;
    insert into public.comision_beneficiarios(auth_user_id, nombre, vendedor_nombre, base, valor, fecha_inicio, freelancer_id, telefono, notas)
    values (v_uid, left(btrim(f.nombre), 120), left(nullif(btrim(coalesce(f.perfil_vendedor_nombre, '')), ''), 120), 'venta', f.porcentaje_comision, coalesce(v_ini, current_date), f.id, left(f.telefono, 40), 'Importado de Freelancers');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'importados', v_n, 'omitidos_fijo', v_fijo);
end;
$f$;

-- ---------- Una comisión por venta (se puede repetir sin duplicar) ----------
create or replace function public.comision_generar(p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); b record; v_desde date := coalesce(p_desde, current_date - 60); v_hasta date := coalesce(p_hasta, current_date);
  v_nuevas integer := 0; v_n integer; v_anul integer := 0;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._comision_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if v_desde > v_hasta or v_hasta - v_desde > 400 then return jsonb_build_object('ok', false, 'motivo', 'fechas'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_comision_gen:' || v_uid::text));
  for b in select * from public.comision_beneficiarios where auth_user_id = v_uid and activo and vendedor_nombre is not null loop
    insert into public.comision_movimientos(auth_user_id, beneficiario_id, origen, venta_id, venta_numero, fecha, base_monto, porcentaje, monto)
    select v_uid, b.id, 'venta', v.id, v.numero_venta, (v.fecha at time zone 'America/Managua')::date,
           case b.base when 'venta' then greatest(round(coalesce(v.subtotal, 0) - coalesce(v.descuento, 0), 2), 0)
                       when 'ganancia' then greatest(round(coalesce(v.total, 0) - coalesce(v.impuesto, 0) - coalesce(v.costo_total, 0), 2), 0)
                       else 0 end,
           case when b.base = 'fijo' then 0 else b.valor end,
           case b.base when 'venta' then round(greatest(coalesce(v.subtotal, 0) - coalesce(v.descuento, 0), 0) * b.valor / 100, 2)
                       when 'ganancia' then round(greatest(coalesce(v.total, 0) - coalesce(v.impuesto, 0) - coalesce(v.costo_total, 0), 0) * b.valor / 100, 2)
                       else round(b.valor, 2) end
      from public.ventas v
     where v.auth_user_id = v_uid and v.estado = 'completada' and v.creado_por_nombre = b.vendedor_nombre
       and (v.fecha at time zone 'America/Managua')::date between greatest(v_desde, b.fecha_inicio) and v_hasta
    on conflict (beneficiario_id, venta_id) where venta_id is not null do nothing;
    get diagnostics v_n = row_count; v_nuevas := v_nuevas + v_n;
  end loop;
  -- Si una venta se anuló y su comisión seguía pendiente, se anula también (lo ya pagado no se toca).
  update public.comision_movimientos m set estado = 'anulada', nota = coalesce(m.nota, 'Venta anulada'), updated_at = now()
   where m.auth_user_id = v_uid and m.estado = 'pendiente' and m.origen = 'venta'
     and exists (select 1 from public.ventas v where v.id = m.venta_id and v.estado = 'anulada');
  get diagnostics v_anul = row_count;
  return jsonb_build_object('ok', true, 'nuevas', v_nuevas, 'anuladas', v_anul);
end;
$f$;

create or replace function public.comision_manual_agregar(p_beneficiario_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_monto numeric := nullif(p ->> 'monto', '')::numeric; v_fecha date := coalesce(nullif(p ->> 'fecha', '')::date, current_date);
        v_nota text := left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300); v_id uuid;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._comision_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if not exists (select 1 from public.comision_beneficiarios where id = p_beneficiario_id and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_monto is null or v_monto <= 0 or v_monto > 100000000 then return jsonb_build_object('ok', false, 'motivo', 'valor'); end if;
  insert into public.comision_movimientos(auth_user_id, beneficiario_id, origen, fecha, monto, nota)
  values (v_uid, p_beneficiario_id, 'manual', v_fecha, round(v_monto, 2), v_nota) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$f$;

create or replace function public.comision_anular(p_mov_id uuid, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); m record;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._comision_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  select * into m from public.comision_movimientos where id = p_mov_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if m.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'motivo', 'no_pendiente'); end if;
  update public.comision_movimientos set estado = 'anulada', nota = coalesce(left(nullif(btrim(coalesce(p_nota, '')), ''), 300), nota), updated_at = now() where id = m.id;
  return jsonb_build_object('ok', true);
end;
$f$;

-- ---------- Pagar: varias comisiones de una persona, con egreso en Caja, todo o nada ----------
create or replace function public.comision_pagar(p_beneficiario_id uuid, p_mov_ids uuid[], p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  v_uid uuid := auth.uid(); b record; v_ids uuid[]; v_n integer; v_total numeric; v_pago uuid; v_mov uuid;
  v_metodo_id uuid := nullif(p ->> 'metodo_pago_id', '')::uuid; v_metodo text := nullif(btrim(coalesce(p ->> 'metodo_pago_nombre', '')), '');
  v_banco uuid := nullif(p ->> 'banco_id', '')::uuid; v_fecha date := coalesce(nullif(p ->> 'fecha', '')::date, (now() at time zone 'America/Managua')::date);
  v_obs text := left(nullif(btrim(coalesce(p ->> 'observaciones', '')), ''), 500); v_por text := left(coalesce(nullif(btrim(coalesce(p ->> 'por', '')), ''), 'Usuario'), 120);
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  if not public._comision_activo(v_uid) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if v_metodo is null then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  if v_metodo_id is not null and not exists (select 1 from public.metodos_pago where id = v_metodo_id and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'metodo'); end if;
  if v_banco is not null and not exists (select 1 from public.bancos where id = v_banco and auth_user_id = v_uid) then return jsonb_build_object('ok', false, 'motivo', 'banco'); end if;
  if p_mov_ids is null or coalesce(array_length(p_mov_ids, 1), 0) = 0 or array_length(p_mov_ids, 1) > 500 then return jsonb_build_object('ok', false, 'motivo', 'sin_seleccion'); end if;
  perform pg_advisory_xact_lock(hashtext('n360_comision_pago:' || p_beneficiario_id::text));
  select * into b from public.comision_beneficiarios where id = p_beneficiario_id and auth_user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  select array_agg(id order by fecha, created_at), count(*), coalesce(sum(monto), 0) into v_ids, v_n, v_total
    from (select id, fecha, created_at, monto from public.comision_movimientos
           where id = any (p_mov_ids) and auth_user_id = v_uid and beneficiario_id = b.id and estado = 'pendiente' for update) s;
  if v_n <> (select count(distinct x) from unnest(p_mov_ids) x) then return jsonb_build_object('ok', false, 'motivo', 'cambiaron'); end if;
  if v_total <= 0 then return jsonb_build_object('ok', false, 'motivo', 'total_cero'); end if;
  insert into public.comision_pagos(auth_user_id, beneficiario_id, total, cantidad, fecha, metodo_pago_id, metodo_pago_nombre, banco_id, observaciones, creado_por)
  values (v_uid, b.id, v_total, v_n, v_fecha, v_metodo_id, v_metodo, v_banco, v_obs, v_por) returning id into v_pago;
  insert into public.movimientos_financieros(auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                             metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
  values (v_uid, 'EGRESO', 'PAGO_COMISION', 'Comisión a ' || b.nombre || ' (' || v_n || (case when v_n = 1 then ' venta)' else ' ventas)' end), v_total, 0, 0,
          v_metodo_id, v_metodo, v_banco, 'comision_pago', v_pago, v_obs, v_fecha, 'completado')
  returning id into v_mov;
  update public.comision_pagos set caja_mov_id = v_mov where id = v_pago;
  update public.comision_movimientos set estado = 'pagada', pago_id = v_pago, updated_at = now() where id = any (v_ids);
  return jsonb_build_object('ok', true, 'pago_id', v_pago, 'total', v_total, 'cantidad', v_n);
end;
$f$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'comision_beneficiario_guardar(jsonb)', 'comision_beneficiario_archivar(uuid, boolean)', 'comision_importar_freelancers()',
    'comision_generar(date, date)', 'comision_manual_agregar(uuid, jsonb)', 'comision_anular(uuid, text)', 'comision_pagar(uuid, uuid[], jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
