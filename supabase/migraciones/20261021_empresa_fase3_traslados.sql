-- =====================================================================
-- EMPRESA VINCULADA — FASE 3: traslados de mercadería entre negocios
-- Fecha: 21-oct-2026 · Solo AGREGA tablas y funciones nuevas.
--
-- Un traslado (ET-000001…) saca mercadería de un negocio y la mete al
-- otro, convertida con la equivalencia del vínculo (fase 2), y deja su
-- asiento en LOS DOS libros en la misma operación (todo o nada):
--   Origen : Debe Cuenta corriente entre negocios / Haber Inventario  (a costo del origen)
--   Destino: Debe Inventario (a costo del destino) / Haber Cuenta corriente (mismo valor que el origen)
--            y la diferencia de costo, si la hay, a "Diferencia de costo en traslados".
-- Así cada libro sigue igual a su sistema (inventario = existencias × costo)
-- y, sumando los dos negocios, las cuentas corrientes se cancelan (dan 0).
-- No cambia precios ni costos de ningún producto. No toca Caja.
-- Anulación: el mismo día y solo si el destino todavía tiene esa mercadería.
-- =====================================================================

-- ---------- Cuentas contables que usa cada negocio para traslados ----------
create table if not exists public.empresa_cuentas_traslado (
  auth_user_id uuid primary key,
  cuenta_inventario uuid not null references public.cuentas_contables(id),
  cuenta_corriente uuid not null references public.cuentas_contables(id),
  cuenta_diferencia uuid not null references public.cuentas_contables(id),
  updated_at timestamptz not null default now()
);
alter table public.empresa_cuentas_traslado enable row level security;
drop policy if exists ect_leer on public.empresa_cuentas_traslado;
create policy ect_leer on public.empresa_cuentas_traslado for select to authenticated using (auth_user_id = auth.uid());

-- ---------- Documento ----------
create table if not exists public.empresa_traslados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas_vinculadas(id),
  numero text not null,
  origen uuid not null,
  destino uuid not null,
  estado text not null default 'aplicado' check (estado in ('aplicado', 'anulado')),
  fecha date not null,
  nota text,
  usuario_nombre text,
  valor_origen numeric(14,2) not null,
  valor_destino numeric(14,2) not null,
  asiento_origen uuid,
  asiento_destino uuid,
  created_at timestamptz not null default now(),
  anulado_en timestamptz,
  anulado_por text,
  anulado_motivo text,
  constraint empresa_traslados_numero_unico unique (empresa_id, numero)
);
create index if not exists empresa_traslados_origen_idx on public.empresa_traslados (origen, created_at desc);
create index if not exists empresa_traslados_destino_idx on public.empresa_traslados (destino, created_at desc);

create table if not exists public.empresa_traslados_items (
  id uuid primary key default gen_random_uuid(),
  traslado_id uuid not null references public.empresa_traslados(id) on delete cascade,
  producto_origen uuid not null,
  producto_destino uuid not null,
  nombre_origen text not null,
  nombre_destino text not null,
  factor numeric(14,6) not null,
  cantidad_origen numeric(14,3) not null check (cantidad_origen > 0),
  cantidad_destino numeric(14,3) not null check (cantidad_destino > 0),
  costo_origen numeric(14,4) not null,
  costo_destino numeric(14,4) not null
);
create index if not exists empresa_traslados_items_t_idx on public.empresa_traslados_items (traslado_id);

create table if not exists public.empresa_traslados_numeracion (
  empresa_id uuid primary key,
  ultimo integer not null default 0
);

alter table public.empresa_traslados enable row level security;
alter table public.empresa_traslados_items enable row level security;
alter table public.empresa_traslados_numeracion enable row level security;
drop policy if exists et_leer on public.empresa_traslados;
create policy et_leer on public.empresa_traslados for select to authenticated
  using (origen = auth.uid() or destino = auth.uid());
drop policy if exists eti_leer on public.empresa_traslados_items;
create policy eti_leer on public.empresa_traslados_items for select to authenticated
  using (exists (select 1 from empresa_traslados t where t.id = traslado_id and (t.origen = auth.uid() or t.destino = auth.uid())));

-- ---------- Interno: número de asiento de CUALQUIER libro de la empresa ----------
create or replace function public.empresa_numero_asiento_interno(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into asientos_numeracion(auth_user_id, ultimo_numero) values (p_user, 1)
    on conflict (auth_user_id) do update set ultimo_numero = asientos_numeracion.ultimo_numero + 1
    returning ultimo_numero into v;
  return 'AS-' || lpad(v::text, 6, '0');
end $$;
revoke all on function public.empresa_numero_asiento_interno(uuid) from public, anon, authenticated;

-- ---------- Interno: asiento de un traslado en UN libro ----------
-- p_lado = 'origen' | 'destino'. Devuelve el id del asiento (o el que ya existía).
create or replace function public.empresa_traslado_asentar_interno(p_traslado uuid, p_lado text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t record; c record; v_uid uuid; v_otro text; v_as uuid; v_dif numeric; v_td numeric; v_th numeric;
begin
  select * into t from empresa_traslados where id = p_traslado;
  if t.id is null then raise exception 'Traslado no encontrado'; end if;
  v_uid := case p_lado when 'origen' then t.origen when 'destino' then t.destino end;
  if v_uid is null then raise exception 'Lado no válido'; end if;

  select a.id into v_as from asientos_contables a
   where a.auth_user_id = v_uid and a.origen = 'automatico' and a.referencia_tipo = 'traslado_empresa' and a.referencia_id = t.id
   order by (a.estado = 'registrado') desc limit 1;
  if v_as is not null then return v_as; end if;

  select * into c from empresa_cuentas_traslado where auth_user_id = v_uid;
  if c.auth_user_id is null then raise exception 'Falta configurar las cuentas contables de traslados en uno de los negocios'; end if;
  if (select count(*) from cuentas_contables cc where cc.id in (c.cuenta_inventario, c.cuenta_corriente, c.cuenta_diferencia)
        and cc.auth_user_id = v_uid and coalesce(cc.activa, true) and coalesce(cc.permite_movimientos, true)) <> 3 then
    raise exception 'Las cuentas contables de traslados de un negocio no son válidas (desactivadas o de otro negocio)';
  end if;

  select m.nombre_negocio into v_otro from empresa_miembros m
   where m.auth_user_id = case p_lado when 'origen' then t.destino else t.origen end;

  insert into asientos_contables (auth_user_id, numero, fecha, concepto, estado, origen, referencia_tipo, referencia_id,
                                  total_debe, total_haber, usuario_nombre, registrado_en)
  values (v_uid, empresa_numero_asiento_interno(v_uid), t.fecha,
          'Traslado ' || t.numero || case p_lado when 'origen' then ' enviado a ' else ' recibido de ' end || coalesce(v_otro, 'otro negocio'),
          'borrador', 'automatico', 'traslado_empresa', t.id, 0, 0, coalesce(t.usuario_nombre, 'Sistema'), null)
  returning id into v_as;

  if p_lado = 'origen' then
    insert into asientos_detalle (auth_user_id, asiento_id, cuenta_id, debe, haber, descripcion, orden) values
      (v_uid, v_as, c.cuenta_corriente, t.valor_origen, 0, 'Mercadería enviada (a costo)', 0),
      (v_uid, v_as, c.cuenta_inventario, 0, t.valor_origen, 'Salida de inventario', 1);
  else
    v_dif := round(t.valor_destino - t.valor_origen, 2);
    insert into asientos_detalle (auth_user_id, asiento_id, cuenta_id, debe, haber, descripcion, orden) values
      (v_uid, v_as, c.cuenta_inventario, t.valor_destino, 0, 'Entrada de inventario (a costo de este negocio)', 0),
      (v_uid, v_as, c.cuenta_corriente, 0, t.valor_origen, 'Mercadería recibida (a costo del que envía)', 1);
    if v_dif <> 0 then
      insert into asientos_detalle (auth_user_id, asiento_id, cuenta_id, debe, haber, descripcion, orden) values
        (v_uid, v_as, c.cuenta_diferencia, greatest(-v_dif, 0), greatest(v_dif, 0), 'Diferencia entre el costo de los dos negocios', 2);
    end if;
  end if;

  select coalesce(sum(debe), 0), coalesce(sum(haber), 0) into v_td, v_th from asientos_detalle where asiento_id = v_as;
  if round(v_td, 2) <> round(v_th, 2) or v_td = 0 then
    raise exception 'El asiento del traslado % no cuadra (Debe %, Haber %). No se hizo nada.', t.numero, v_td, v_th;
  end if;
  update asientos_contables set estado = 'registrado', total_debe = v_td, total_haber = v_th, registrado_en = now() where id = v_as;
  return v_as;
end $$;
revoke all on function public.empresa_traslado_asentar_interno(uuid, text) from public, anon, authenticated;

-- ---------- Trasladar (o calcular la vista previa) ----------
-- p_items = [{"producto_id": uuid (de MI negocio), "cantidad": n}, …]
create or replace function public.empresa_trasladar(p_destino uuid, p_items jsonb, p_nota text default null,
                                                    p_usuario text default null, p_aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_emp uuid := public.empresa_id_de_mi_negocio();
  it jsonb; po record; pd record; v record; f numeric; qo numeric; qd numeric;
  v_valor_o numeric := 0; v_valor_d numeric := 0; v_lineas jsonb := '[]'::jsonb;
  v_id uuid; v_num integer; v_numero text; v_fecha date := (now() at time zone 'America/Managua')::date;
  v_nom_o text; v_nom_d text; v_ao uuid; v_ad uuid; n integer := 0;
begin
  if v_uid is null or v_emp is null then raise exception 'Tu negocio no es parte de una empresa'; end if;
  if p_destino = v_uid or not public.empresa_es_de_mi_empresa(p_destino) then raise exception 'El negocio destino no es parte de tu empresa'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'No hay productos para trasladar'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'Máximo 500 productos por traslado'; end if;
  if (select count(distinct x->>'producto_id') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'Un producto está repetido en la lista';
  end if;
  if not exists (select 1 from empresa_cuentas_traslado where auth_user_id = v_uid)
     or not exists (select 1 from empresa_cuentas_traslado where auth_user_id = p_destino) then
    raise exception 'Falta configurar las cuentas contables de traslados en uno de los negocios. No se trasladó nada.';
  end if;

  if p_aplicar then perform pg_advisory_xact_lock(hashtext('n360_empresa_traslado:' || v_emp::text)); end if;

  for it in select * from jsonb_array_elements(p_items) loop
    qo := round((it->>'cantidad')::numeric, 3);
    if qo is null or qo <= 0 then raise exception 'Cantidad no válida'; end if;
    select p.* into po from productos p where p.id = (it->>'producto_id')::uuid and p.auth_user_id = v_uid for update;
    if po.id is null then raise exception 'Un producto no es de este negocio'; end if;
    if po.tipo <> 'producto' then raise exception '% no es un producto', po.nombre; end if;
    if coalesce(po.requiere_numero_serie, false) or coalesce(po.es_sustancia_controlada, false)
       or exists (select 1 from producto_lotes l where l.producto_id = po.id and coalesce(l.activo, true) and l.cantidad_actual > 0) then
      raise exception '% maneja series, lotes o es controlado: no se puede trasladar entre negocios', po.nombre;
    end if;
    select * into v from empresa_productos_vinculo w where w.empresa_id = v_emp and (w.producto_a = po.id or w.producto_b = po.id);
    if v.id is null then raise exception '% no está vinculado con un producto del otro negocio', po.nombre; end if;
    if v.producto_a = po.id then f := v.factor; select p.* into pd from productos p where p.id = v.producto_b for update;
    else f := 1 / v.factor; select p.* into pd from productos p where p.id = v.producto_a for update; end if;
    if pd.id is null or pd.auth_user_id <> p_destino then raise exception '% está vinculado con un producto de otro negocio, no del destino', po.nombre; end if;
    if coalesce(po.stock_actual, 0) < qo then
      raise exception 'No hay suficiente %: hay %, se quieren trasladar %', po.nombre, coalesce(po.stock_actual, 0), qo;
    end if;
    if coalesce(pd.stock_actual, 0) < 0 then
      raise exception '% en el negocio destino tiene existencia negativa (%). Corrígela primero con un ajuste.', pd.nombre, pd.stock_actual;
    end if;
    qd := round(qo * f, 3);
    if qd <= 0 then raise exception 'La cantidad de % es muy pequeña para el otro negocio', po.nombre; end if;
    if not coalesce(po.permite_fraccion, false) and qo <> trunc(qo) then
      raise exception '% se maneja en unidades enteras: no se puede trasladar %', po.nombre, qo;
    end if;
    if not coalesce(pd.permite_fraccion, false) and qd <> trunc(qd) then
      raise exception '% da % en el otro negocio (1 = % allá). Traslada una cantidad que dé unidades enteras.', po.nombre, qd, round(f, 4);
    end if;
    v_valor_o := v_valor_o + round(qo * coalesce(po.costo, 0), 2);
    v_valor_d := v_valor_d + round(qd * coalesce(pd.costo, 0), 2);
    v_lineas := v_lineas || jsonb_build_object('producto_origen', po.id, 'nombre_origen', po.nombre, 'cantidad_origen', qo,
      'costo_origen', coalesce(po.costo, 0), 'stock_origen', po.stock_actual, 'producto_destino', pd.id, 'nombre_destino', pd.nombre,
      'cantidad_destino', qd, 'costo_destino', coalesce(pd.costo, 0), 'stock_destino', pd.stock_actual, 'factor', round(f, 6));
  end loop;

  if not p_aplicar then
    return jsonb_build_object('aplicado', false, 'lineas', v_lineas, 'valor_origen', v_valor_o, 'valor_destino', v_valor_d,
                              'diferencia', round(v_valor_d - v_valor_o, 2));
  end if;
  if v_valor_o <= 0 then raise exception 'Los productos no tienen costo: no se puede valorar el traslado'; end if;

  insert into empresa_traslados_numeracion(empresa_id, ultimo) values (v_emp, 1)
    on conflict (empresa_id) do update set ultimo = empresa_traslados_numeracion.ultimo + 1 returning ultimo into v_num;
  v_numero := 'ET-' || lpad(v_num::text, 6, '0');
  select nombre_negocio into v_nom_o from empresa_miembros where auth_user_id = v_uid;
  select nombre_negocio into v_nom_d from empresa_miembros where auth_user_id = p_destino;

  insert into empresa_traslados (empresa_id, numero, origen, destino, fecha, nota, usuario_nombre, valor_origen, valor_destino)
  values (v_emp, v_numero, v_uid, p_destino, v_fecha, nullif(trim(coalesce(p_nota, '')), ''), p_usuario, v_valor_o, v_valor_d)
  returning id into v_id;

  for it in select * from jsonb_array_elements(v_lineas) loop
    insert into empresa_traslados_items (traslado_id, producto_origen, producto_destino, nombre_origen, nombre_destino, factor,
                                         cantidad_origen, cantidad_destino, costo_origen, costo_destino)
    values (v_id, (it->>'producto_origen')::uuid, (it->>'producto_destino')::uuid, it->>'nombre_origen', it->>'nombre_destino',
            (it->>'factor')::numeric, (it->>'cantidad_origen')::numeric, (it->>'cantidad_destino')::numeric,
            (it->>'costo_origen')::numeric, (it->>'costo_destino')::numeric);
    update productos set stock_actual = stock_actual - (it->>'cantidad_origen')::numeric, updated_at = now()
     where id = (it->>'producto_origen')::uuid;
    update productos set stock_actual = coalesce(stock_actual, 0) + (it->>'cantidad_destino')::numeric, updated_at = now()
     where id = (it->>'producto_destino')::uuid;
    insert into movimientos_inventario (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota, costo_unitario, costo_total)
    values (v_uid, (it->>'producto_origen')::uuid, 'salida', 'traslado_empresa', (it->>'cantidad_origen')::numeric,
            (it->>'stock_origen')::numeric, (it->>'stock_origen')::numeric - (it->>'cantidad_origen')::numeric,
            'Traslado ' || v_numero || ' enviado a ' || coalesce(v_nom_d, 'otro negocio'),
            (it->>'costo_origen')::numeric, round((it->>'cantidad_origen')::numeric * (it->>'costo_origen')::numeric, 2)),
           (p_destino, (it->>'producto_destino')::uuid, 'entrada', 'traslado_empresa', (it->>'cantidad_destino')::numeric,
            coalesce((it->>'stock_destino')::numeric, 0), coalesce((it->>'stock_destino')::numeric, 0) + (it->>'cantidad_destino')::numeric,
            'Traslado ' || v_numero || ' recibido de ' || coalesce(v_nom_o, 'otro negocio'),
            (it->>'costo_destino')::numeric, round((it->>'cantidad_destino')::numeric * (it->>'costo_destino')::numeric, 2));
    n := n + 1;
  end loop;

  v_ao := public.empresa_traslado_asentar_interno(v_id, 'origen');
  v_ad := public.empresa_traslado_asentar_interno(v_id, 'destino');
  update empresa_traslados set asiento_origen = v_ao, asiento_destino = v_ad where id = v_id;

  return jsonb_build_object('aplicado', true, 'id', v_id, 'numero', v_numero, 'productos', n,
                            'valor_origen', v_valor_o, 'valor_destino', v_valor_d, 'diferencia', round(v_valor_d - v_valor_o, 2));
end $$;
revoke all on function public.empresa_trasladar(uuid, jsonb, text, text, boolean) from public, anon;
grant execute on function public.empresa_trasladar(uuid, jsonb, text, text, boolean) to authenticated;

-- ---------- Anular (el mismo día, si el destino aún tiene la mercadería) ----------
create or replace function public.empresa_anular_traslado(p_traslado uuid, p_motivo text, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); t record; it record; pd record; po record; v_hoy date := (now() at time zone 'America/Managua')::date;
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación'; end if;
  select * into t from empresa_traslados where id = p_traslado for update;
  if t.id is null or (t.origen <> v_uid and t.destino <> v_uid) then raise exception 'Traslado no encontrado'; end if;
  if t.estado = 'anulado' then raise exception 'Este traslado ya estaba anulado'; end if;
  if t.fecha <> v_hoy then raise exception 'Solo se puede anular el mismo día. Para devolver mercadería de otro día, haz un traslado de regreso.'; end if;
  perform pg_advisory_xact_lock(hashtext('n360_empresa_traslado:' || t.empresa_id::text));

  for it in select * from empresa_traslados_items where traslado_id = t.id loop
    select * into pd from productos where id = it.producto_destino for update;
    if pd.id is null or coalesce(pd.stock_actual, 0) < it.cantidad_destino then
      raise exception 'No se puede anular: % ya se usó en el negocio destino (hay %, se recibieron %). Haz un traslado de regreso.',
        it.nombre_destino, coalesce(pd.stock_actual, 0), it.cantidad_destino;
    end if;
    select * into po from productos where id = it.producto_origen for update;
    if po.id is null then raise exception 'El producto % ya no existe en el negocio que envió', it.nombre_origen; end if;
    if coalesce(po.stock_actual, 0) < 0 then
      raise exception 'No se puede anular: % tiene existencia negativa en el negocio que envió.', it.nombre_origen;
    end if;
  end loop;

  for it in select * from empresa_traslados_items where traslado_id = t.id loop
    select stock_actual into pd from productos where id = it.producto_destino;
    update productos set stock_actual = stock_actual - it.cantidad_destino, updated_at = now() where id = it.producto_destino;
    insert into movimientos_inventario (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota, costo_unitario, costo_total)
    values (t.destino, it.producto_destino, 'salida', 'traslado_empresa_anulado', it.cantidad_destino, pd.stock_actual, pd.stock_actual - it.cantidad_destino,
            'Anulación del traslado ' || t.numero, it.costo_destino, round(it.cantidad_destino * it.costo_destino, 2));
    select stock_actual into po from productos where id = it.producto_origen;
    update productos set stock_actual = coalesce(stock_actual, 0) + it.cantidad_origen, updated_at = now() where id = it.producto_origen;
    insert into movimientos_inventario (auth_user_id, producto_id, tipo, razon, cantidad, stock_antes, stock_despues, nota, costo_unitario, costo_total)
    values (t.origen, it.producto_origen, 'entrada', 'traslado_empresa_anulado', it.cantidad_origen, coalesce(po.stock_actual, 0), coalesce(po.stock_actual, 0) + it.cantidad_origen,
            'Anulación del traslado ' || t.numero, it.costo_origen, round(it.cantidad_origen * it.costo_origen, 2));
  end loop;

  update asientos_contables set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Traslado ' || t.numero || ' anulado: ' || trim(p_motivo)
   where referencia_tipo = 'traslado_empresa' and referencia_id = t.id and auth_user_id in (t.origen, t.destino) and estado <> 'anulado';
  update empresa_traslados set estado = 'anulado', anulado_en = now(), anulado_por = p_usuario, anulado_motivo = trim(p_motivo) where id = t.id;
  return jsonb_build_object('anulado', true, 'numero', t.numero);
end $$;
revoke all on function public.empresa_anular_traslado(uuid, text, text) from public, anon;
grant execute on function public.empresa_anular_traslado(uuid, text, text) to authenticated;

-- ---------- Autocorrección: asientos de traslados que falten en MI libro ----------
-- (por ejemplo, después de "Reiniciar contabilidad"). La llama "Generar asientos".
create or replace function public.empresa_traslados_asentar_pendientes()
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); t record; n integer := 0; v_as uuid;
begin
  if v_uid is null then return 0; end if;
  if not exists (select 1 from empresa_cuentas_traslado where auth_user_id = v_uid) then return 0; end if;
  for t in select * from empresa_traslados x where (x.origen = v_uid or x.destino = v_uid) and x.estado = 'aplicado'
             and not exists (select 1 from asientos_contables a where a.auth_user_id = v_uid and a.referencia_tipo = 'traslado_empresa'
                               and a.referencia_id = x.id and a.origen = 'automatico')
           order by x.created_at loop
    v_as := public.empresa_traslado_asentar_interno(t.id, case when t.origen = v_uid then 'origen' else 'destino' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.empresa_traslados_asentar_pendientes() from public, anon;
grant execute on function public.empresa_traslados_asentar_pendientes() to authenticated;
