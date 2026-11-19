-- Panel admin: (1) Salud de los datos de cada negocio y (2) Errores de los clientes en vivo.
-- Todo es ADITIVO: tablas nuevas, solo el administrador las lee. Los chequeos solo LEEN datos.

-- ===================== 1) SALUD DE LOS DATOS =====================
create table if not exists public.admin_salud_corridas (
  id uuid primary key default gen_random_uuid(),
  creado_en timestamptz not null default now(),
  origen text not null default 'manual',
  duracion_ms integer,
  total_hallazgos integer not null default 0
);
create table if not exists public.admin_salud_hallazgos (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null references public.admin_salud_corridas(id) on delete cascade,
  auth_user_id uuid,
  negocio text,
  chequeo text not null,
  nivel text not null check (nivel in ('rojo','amarillo')),
  ref_id uuid,
  referencia text,
  monto numeric,
  fecha date,
  detalle text,
  nuevo boolean not null default false
);
create index if not exists admin_salud_hallazgos_corrida_idx on public.admin_salud_hallazgos(corrida_id);
create table if not exists public.admin_salud_revisados (
  chequeo text not null,
  ref_id uuid not null,
  nota text,
  revisado_por text,
  creado_en timestamptz not null default now(),
  primary key (chequeo, ref_id)
);
alter table public.admin_salud_corridas enable row level security;
alter table public.admin_salud_hallazgos enable row level security;
alter table public.admin_salud_revisados enable row level security;
drop policy if exists admin_lee on public.admin_salud_corridas;
create policy admin_lee on public.admin_salud_corridas for select to authenticated using (public.is_admin_activo());
drop policy if exists admin_lee on public.admin_salud_hallazgos;
create policy admin_lee on public.admin_salud_hallazgos for select to authenticated using (public.is_admin_activo());
drop policy if exists admin_todo on public.admin_salud_revisados;
create policy admin_todo on public.admin_salud_revisados for all to authenticated using (public.is_admin_activo()) with check (public.is_admin_activo());
revoke all on public.admin_salud_corridas, public.admin_salud_hallazgos, public.admin_salud_revisados from anon;

create or replace function public.admin_salud_ejecutar(p_origen text default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ini timestamptz := clock_timestamp(); v_prev uuid; v_n int;
begin
  -- Con sesión de usuario: solo administradores. Sin usuario: solo la tarea nocturna (anon no tiene permiso).
  if auth.uid() is not null and not public.is_admin_activo() then
    raise exception 'Solo el administrador';
  end if;
  select id into v_prev from admin_salud_corridas order by creado_en desc limit 1;
  insert into admin_salud_corridas(origen) values (coalesce(p_origen,'manual')) returning id into v_id;

  create temp table _h (auth_user_id uuid, chequeo text, nivel text, ref_id uuid, referencia text, monto numeric, fecha date, detalle text) on commit drop;

  -- Movimientos de Caja de ventas, agrupados una sola vez
  create temp table _mv on commit drop as
    select referencia_id vid,
      sum(monto) filter (where tipo_flujo='INGRESO') ing,
      sum(monto) filter (where tipo_flujo='EGRESO' and tipo_movimiento<>'GASTO') egr
    from movimientos_financieros where referencia_tipo='venta' and estado='completado' group by 1;

  -- a) Venta de contado sin su ingreso en Caja
  insert into _h select v.auth_user_id,'venta_sin_caja','rojo',v.id,v.numero_venta,v.total,v.created_at::date,'Venta pagada sin entrada en Caja'
    from ventas v left join _mv m on m.vid=v.id
    where v.estado='completada' and coalesce(v.estado_pago,'pagado')='pagado' and v.total>0 and coalesce(m.ing,0)=0
      and not exists(select 1 from fiados f where f.venta_id=v.id);
  -- b) Venta con ingreso distinto a su total
  insert into _h select v.auth_user_id,'venta_caja_distinta','rojo',v.id,v.numero_venta,v.total,v.created_at::date,'Caja registró '||m.ing||' para una venta de '||v.total
    from ventas v join _mv m on m.vid=v.id
    where v.estado='completada' and coalesce(v.estado_pago,'pagado')='pagado' and m.ing>0
      and abs(m.ing-(v.total-coalesce(v.impuesto,0)))>0.01 and abs(m.ing-(v.total-coalesce(v.impuesto,0)-coalesce(v.retencion_ir_monto,0)))>0.01 and abs(m.ing-v.total)>0.01
      and not exists(select 1 from fiados f where f.venta_id=v.id);
  -- c) Venta anulada que sigue sumando en Caja
  insert into _h select v.auth_user_id,'anulada_en_caja','rojo',v.id,v.numero_venta,round(m.ing-coalesce(m.egr,0),2),coalesce(v.anulada_en,v.updated_at)::date,'Anulada, pero su dinero sigue en Caja'
    from ventas v join _mv m on m.vid=v.id where v.estado='anulada' and m.ing>coalesce(m.egr,0)+0.01;
  -- d) Ingreso de una venta registrado dos veces (mismo monto y método)
  insert into _h select m.auth_user_id,'ingreso_doble','rojo',m.referencia_id,max(v.numero_venta),max(m.monto),max(m.fecha),'El mismo cobro entró '||count(*)||' veces a Caja'
    from movimientos_financieros m join ventas v on v.id=m.referencia_id
    where m.referencia_tipo='venta' and m.tipo_flujo='INGRESO' and m.estado='completado'
    group by m.auth_user_id, m.referencia_id, m.monto, coalesce(m.metodo_pago_nombre,'') having count(*)>1;
  -- e) Crédito cuyo saldo no es lo financiado menos lo abonado
  insert into _h select c.auth_user_id,'credito_saldo','rojo',c.id,c.numero_credito,c.saldo_pendiente,c.created_at::date,
      'Saldo '||c.saldo_pendiente||' pero debería ser '||round(coalesce(c.total_financiado,c.monto_original)-coalesce(p.s,0),2)
    from creditos c left join (select credito_id, sum(monto) s from creditos_pagos where coalesce(estado,'completado')<>'anulado' group by 1) p on p.credito_id=c.id
    where c.estado not in ('cancelado','anulado') and abs(c.saldo_pendiente-(coalesce(c.total_financiado,c.monto_original)-coalesce(p.s,0)))>0.01;
  -- f) Crédito cuyo saldo no coincide con sus cuotas pendientes
  insert into _h select c.auth_user_id,'credito_cuotas','amarillo',c.id,c.numero_credito,c.saldo_pendiente,c.created_at::date,
      'Saldo '||c.saldo_pendiente||', cuotas pendientes '||round(q.p,2)
    from creditos c join (select credito_id, sum(monto_total-monto_pagado) p from creditos_cuotas group by 1) q on q.credito_id=c.id
    where c.estado not in ('cancelado','anulado') and abs(c.saldo_pendiente-q.p)>0.01;
  -- g) Abono de crédito repetido (mismo monto, menos de 90 segundos)
  insert into _h select b.auth_user_id,'abono_doble','rojo',b.id,c.numero_credito,b.monto,b.fecha,'Dos abonos iguales con '||abs(extract(epoch from b.created_at-a.created_at))::int||' s de diferencia'
    from creditos_pagos a join creditos_pagos b on a.credito_id=b.credito_id and a.id<b.id and a.monto=b.monto
      and abs(extract(epoch from b.created_at-a.created_at))<90
    join creditos c on c.id=a.credito_id
    where coalesce(a.estado,'completado')<>'anulado' and coalesce(b.estado,'completado')<>'anulado';
  -- h) Gasto cancelado que sigue restando en Caja
  insert into _h select g.auth_user_id,'gasto_cancelado_en_caja','rojo',g.id,left(g.concepto,60),g.monto,g.fecha,'Gasto cancelado con su salida de Caja activa'
    from gastos g where g.estado='cancelado' and exists(select 1 from movimientos_financieros m where m.referencia_tipo='gasto' and m.referencia_id=g.id and m.estado='completado');
  -- i) Fiado con saldo o abonos que no cuadran
  insert into _h select f.auth_user_id,'fiado_saldo','rojo',f.id,coalesce(f.cliente_nombre,'Fiado'),f.saldo,f.fecha::date,'Saldo '||f.saldo||', total '||f.monto_total||', pagado '||f.monto_pagado
    from fiados f left join (select fiado_id, sum(monto) s from fiado_pagos group by 1) p on p.fiado_id=f.id
    where f.eliminado_at is null and (abs(f.saldo-(f.monto_total-f.monto_pagado))>0.01 or abs(f.monto_pagado-coalesce(p.s,0))>0.01);
  -- j) Ficha del cliente ("total comprado") distinta a sus ventas reales
  insert into _h select c.auth_user_id,'ficha_cliente','amarillo',c.id,c.nombre,coalesce(c.total_compras,0),null,
      'Ficha '||coalesce(c.total_compras,0)||' ('||coalesce(c.num_compras,0)||' compras), ventas reales '||coalesce(e.t,0)||' ('||coalesce(e.n,0)||')'
    from clientes c left join (
      select w.cliente_id, round(sum(w.total)-sum(coalesce(d.s,0)),2) t, count(*) filter (where coalesce(d.s,0) < w.total-0.01) n
      from ventas w left join (select venta_id, sum(total) s from devoluciones_venta where coalesce(estado,'registrada')<>'anulada' group by 1) d on d.venta_id=w.id
      where w.estado='completada' and w.cliente_id is not null group by 1) e on e.cliente_id=c.id
    where (abs(coalesce(c.total_compras,0)-coalesce(e.t,0))>0.01 or coalesce(c.num_compras,0)<>coalesce(e.n,0))
      and not exists(select 1 from fiados fi where fi.cliente_id=c.id and fi.venta_id is null)
      and not exists(select 1 from creditos k where k.cliente_id=c.id and k.venta_id is null and k.tipo='venta');
  -- k) Producto con existencia negativa
  insert into _h select p.auth_user_id,'stock_negativo','amarillo',p.id,p.nombre,p.stock_actual,null,'Existencia '||p.stock_actual
    from productos p where p.stock_actual<0;

  -- Quitar lo ya revisado por el administrador
  delete from _h h using admin_salud_revisados r where r.chequeo=h.chequeo and r.ref_id=h.ref_id;

  insert into admin_salud_hallazgos(corrida_id,auth_user_id,negocio,chequeo,nivel,ref_id,referencia,monto,fecha,detalle,nuevo)
  select v_id,h.auth_user_id,coalesce(ce.nombre_comercial,'(sin nombre)'),h.chequeo,h.nivel,h.ref_id,h.referencia,h.monto,h.fecha,left(h.detalle,300),
    (v_prev is not null and not exists(select 1 from admin_salud_hallazgos x where x.corrida_id=v_prev and x.chequeo=h.chequeo and x.ref_id is not distinct from h.ref_id))
  from _h h left join configuracion_empresa ce on ce.auth_user_id=h.auth_user_id;
  get diagnostics v_n = row_count;

  update admin_salud_corridas set duracion_ms = (extract(epoch from clock_timestamp()-v_ini)*1000)::int, total_hallazgos=v_n where id=v_id;
  delete from admin_salud_corridas where creado_en < now() - interval '60 days';
  return jsonb_build_object('corrida_id', v_id, 'hallazgos', v_n);
end $$;
revoke all on function public.admin_salud_ejecutar(text) from public, anon;
grant execute on function public.admin_salud_ejecutar(text) to authenticated;

-- ===================== 2) ERRORES DE LOS CLIENTES =====================
create table if not exists public.errores_cliente (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  dia date not null default (now() at time zone 'America/Managua')::date,
  firma text not null,
  pagina text, tipo text, mensaje text, detalle text, user_agent text, version text,
  veces integer not null default 1,
  primera_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  resuelto boolean not null default false,
  unique (auth_user_id, firma, dia)
);
create index if not exists errores_cliente_ultima_idx on public.errores_cliente(ultima_vez desc);
alter table public.errores_cliente enable row level security;
drop policy if exists admin_lee on public.errores_cliente;
create policy admin_lee on public.errores_cliente for select to authenticated using (public.is_admin_activo());
drop policy if exists admin_marca on public.errores_cliente;
create policy admin_marca on public.errores_cliente for update to authenticated using (public.is_admin_activo()) with check (public.is_admin_activo());
revoke all on public.errores_cliente from anon;

create or replace function public.reportar_error_cliente(p_pagina text, p_tipo text, p_mensaje text, p_detalle text default null, p_ua text default null, p_version text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_dia date := (now() at time zone 'America/Managua')::date; v_firma text; v_msg text;
begin
  if v_uid is null or coalesce(trim(p_mensaje),'') = '' then return; end if;
  -- Freno: máximo 200 errores distintos por cuenta al día
  if (select count(*) from errores_cliente where auth_user_id=v_uid and dia=v_dia) >= 200 then return; end if;
  v_msg := left(p_mensaje, 500);
  v_firma := md5(coalesce(left(p_pagina,80),'') || '|' || coalesce(left(p_tipo,20),'') || '|' || regexp_replace(v_msg, '[0-9]+', '#', 'g'));
  insert into errores_cliente(auth_user_id, dia, firma, pagina, tipo, mensaje, detalle, user_agent, version)
  values (v_uid, v_dia, v_firma, left(p_pagina,80), left(p_tipo,20), v_msg, left(p_detalle,2000), left(p_ua,300), left(p_version,40))
  on conflict (auth_user_id, firma, dia) do update set veces = errores_cliente.veces + 1, ultima_vez = now(),
    resuelto = false;
end $$;
revoke all on function public.reportar_error_cliente(text,text,text,text,text,text) from public, anon;
grant execute on function public.reportar_error_cliente(text,text,text,text,text,text) to authenticated;

-- ===================== Tareas automáticas =====================
select cron.unschedule(jobid) from cron.job where jobname in ('admin-salud-datos-noche','limpiar-errores-cliente-30d');
select cron.schedule('admin-salud-datos-noche', '35 8 * * *', $$select public.admin_salud_ejecutar('auto')$$);
select cron.schedule('limpiar-errores-cliente-30d', '45 8 * * *', $$delete from public.errores_cliente where ultima_vez < now() - interval '30 days'$$);
