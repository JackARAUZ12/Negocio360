-- =====================================================================
-- CONTABILIDAD: "Cuentas de dinero" — ubicar el dinero en Caja Chica y Bancos
-- Fecha: 20-oct-2026 · Opcional por negocio · No edita ni borra ningún asiento
--
-- PROBLEMA: todos los asientos automáticos mandan el dinero a una sola cuenta
-- (la de la regla, normalmente "Caja General"), sin importar si entró en
-- efectivo, por tarjeta o por transferencia a un banco. En el Libro Mayor,
-- Caja Chica y Bancos nunca tenían movimientos.
--
-- QUÉ HACE (solo si el negocio lo configura; sin configurar, nada cambia):
--  * contabilidad_cuentas_dinero: qué cuenta es "Caja General" (de donde se
--    ubica el dinero), cuál recibe el EFECTIVO (Caja Chica) y qué cuenta
--    corresponde a cada BANCO del módulo Caja.
--  * contabilidad_ubicar_dinero(p_aplicar): por cada día, un asiento NUEVO
--    "Ubicación del dinero" que pasa de Caja General a Caja Chica / Bancos
--    exactamente lo que el módulo Caja demuestra (mismas reglas que Caja:
--    efectivo = cajón; tarjeta/transferencia con banco = ese banco), más las
--    transferencias internas entre Caja Chica y bancos. Lo que Caja no puede
--    demostrar se queda en Caja General ("sin ubicar") y se informa el motivo.
--    - Nunca edita ni borra asientos existentes: si un día cambió (venta
--      editada o anulada, método corregido), anula el asiento de ese día y
--      crea uno nuevo. Se corrige sola en cada ejecución.
--    - Todo en UNA transacción: o se aplica completo y cuadrado, o nada.
--    - Debe = Haber por construcción, validado otra vez antes de registrar.
--    - p_aplicar = false solo calcula (vista previa), no escribe nada.
--  * contabilidad_quitar_ubicacion_dinero(): anula todos esos asientos (vuelve
--    todo a como estaba antes).
--  * contabilidad_bancos_del_grupo(): bancos de la central y de sus
--    bodegas/sucursales, para configurarlos (solo lectura).
-- =====================================================================

-- ---------- Configuración ----------
create table if not exists public.contabilidad_cuentas_dinero (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  clave text not null,
  cuenta_id uuid not null references public.cuentas_contables(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contabilidad_cuentas_dinero_clave_chk
    check (clave in ('caja_general', 'efectivo') or clave ~ '^banco:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint contabilidad_cuentas_dinero_unica unique (auth_user_id, clave)
);
comment on table public.contabilidad_cuentas_dinero is
  'Contabilidad › Cuentas de dinero: caja_general (origen), efectivo (Caja Chica) y banco:<id> (cuenta de cada banco del módulo Caja).';
alter table public.contabilidad_cuentas_dinero enable row level security;
create policy contabilidad_cuentas_dinero_own on public.contabilidad_cuentas_dinero
  for all to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- ---------- Control: un asiento de ubicación por día ----------
create table if not exists public.contabilidad_ubicacion_dinero (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  fecha date not null,
  asiento_id uuid not null references public.asientos_contables(id) on delete cascade,
  firma text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contabilidad_ubicacion_dinero_dia unique (auth_user_id, fecha)
);
comment on table public.contabilidad_ubicacion_dinero is
  'Asiento vigente de "Ubicación del dinero" por día (lo escribe solo contabilidad_ubicar_dinero). Si el asiento se borra (Reiniciar contabilidad), esta fila se borra sola.';
alter table public.contabilidad_ubicacion_dinero enable row level security;
create policy contabilidad_ubicacion_dinero_leer on public.contabilidad_ubicacion_dinero
  for select to authenticated using (auth_user_id = auth.uid());

-- ---------- Bancos del grupo (solo lectura) ----------
create or replace function public.contabilidad_bancos_del_grupo()
returns table (banco_id uuid, nombre text, numero_cuenta text, moneda text, activo boolean, lugar text, es_central boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  return query
    select b.id, b.nombre, b.numero_cuenta, coalesce(b.moneda, 'NIO'), coalesce(b.activo, true), null::text, true
      from bancos b where b.auth_user_id = v_uid
    union all
    select b.id, b.nombre, b.numero_cuenta, coalesce(b.moneda, 'NIO'), coalesce(b.activo, true), s.nombre, false
      from sucursales s join bancos b on b.auth_user_id = s.auth_user_id_sucursal
     where s.auth_user_id_central = v_uid and not coalesce(s.es_central, false)
       and s.auth_user_id_sucursal is not null and s.auth_user_id_sucursal <> v_uid;
end $$;

-- ---------- Ubicar el dinero ----------
create or replace function public.contabilidad_ubicar_dinero(p_aplicar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cg uuid; v_ef uuid; v_malas int;
  r record; v_asiento uuid; v_numero text; v_td numeric; v_th numeric;
  v_crear int := 0; v_reemplazar int := 0; v_anular int := 0; v_huerfanos int := 0; v_iguales int := 0;
  v_resumen jsonb;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;

  select cuenta_id into v_cg from contabilidad_cuentas_dinero where auth_user_id = v_uid and clave = 'caja_general';
  select cuenta_id into v_ef from contabilidad_cuentas_dinero where auth_user_id = v_uid and clave = 'efectivo';

  -- Una sola ejecución por transacción (cada llamada desde la app es su propia transacción).
  if to_regclass('pg_temp._cd_mf') is not null then
    raise exception 'La ubicación del dinero ya se está calculando en esta misma operación.';
  end if;
  create temp table _cd_banco on commit drop as
    select substr(clave, 7)::uuid as banco_id, cuenta_id from contabilidad_cuentas_dinero
     where auth_user_id = v_uid and clave like 'banco:%';

  if v_cg is null or (v_ef is null and not exists (select 1 from _cd_banco)) then
    return jsonb_build_object('configurado', false);
  end if;

  -- Todas las cuentas deben ser del negocio, de Activo, aceptar movimientos y ser distintas de Caja General.
  select count(*) into v_malas from (
    select v_cg as c union all select v_ef where v_ef is not null union all select cuenta_id from _cd_banco) x
   left join cuentas_contables cc on cc.id = x.c and cc.auth_user_id = v_uid and cc.tipo = 'activo' and coalesce(cc.permite_movimientos, true) and coalesce(cc.activa, true)
   where cc.id is null;
  if v_malas > 0 then raise exception 'Cuentas de dinero: hay una cuenta que no es de Activo, está desactivada, no acepta movimientos o no es de este negocio. Revisa la configuración.'; end if;
  if v_ef = v_cg or exists (select 1 from _cd_banco where cuenta_id = v_cg) then
    raise exception 'Cuentas de dinero: Caja Chica y los bancos deben ser cuentas distintas de Caja General.';
  end if;

  if p_aplicar then perform pg_advisory_xact_lock(hashtext('n360_ubicar_dinero:' || v_uid::text)); end if;

  -- Lugares: el negocio y, si es central de un grupo, sus bodegas/sucursales (un solo libro en la central).
  create temp table _cd_lugar on commit drop as
    select v_uid as uid
    union
    select s.auth_user_id_sucursal from sucursales s
     where s.auth_user_id_central = v_uid and not coalesce(s.es_central, false)
       and s.auth_user_id_sucursal is not null and s.auth_user_id_sucursal <> v_uid;

  -- Movimientos de Caja vigentes y a qué cuenta va cada uno (mismas reglas que el módulo Caja).
  -- (Sin UPDATE: las llamadas desde la app pasan por "safeupdate", que rechaza UPDATE sin WHERE.)
  create temp table _cd_mf on commit drop as
    select x.*, case
      when x.banco_id is not null and (x.metodo like '%tarjeta%' or x.metodo like '%transferencia%' or x.tipo_movimiento = 'TRANSFERENCIA')
        then bb.cuenta_id
      when x.tipo_flujo = 'INGRESO' and (case when x.tipo_movimiento in ('TRANSFERENCIA', 'CAPITAL_AGREGADO') then coalesce(x.origen_caja, '') = 'chica'
                                              else x.metodo like '%efectivo%' end)
        then v_ef
      when x.tipo_flujo = 'EGRESO' and (case when x.tipo_movimiento = 'TRANSFERENCIA' then coalesce(x.origen_caja, '') = 'chica'
                                             when x.origen_caja = 'general' then false
                                             when x.origen_caja = 'chica' then true
                                             else x.metodo like '%efectivo%' end)
        then v_ef
      else null end as dest
    from (select m.id, m.auth_user_id, m.tipo_flujo, round(m.monto::numeric, 2) as monto, m.referencia_tipo, m.referencia_id,
                 m.tipo_movimiento, m.fecha, m.created_at, m.concepto, m.banco_id, m.origen_caja,
                 lower(coalesce(nullif(m.metodo_pago_nombre, ''), 'Efectivo')) as metodo
            from movimientos_financieros m
           where m.auth_user_id in (select uid from _cd_lugar) and m.estado = 'completado' and m.monto > 0) x
    left join _cd_banco bb on bb.banco_id = x.banco_id;
  create index on _cd_mf (referencia_id);
  create index on _cd_mf (id);

  -- Asientos automáticos registrados que tocan Caja General (los de ubicación nunca entran aquí).
  create temp table _cd_orig on commit drop as
    select a.id as asiento_id, a.fecha, a.concepto, a.referencia_tipo, a.referencia_id, round(sum(d.debe - d.haber), 2) as l
      from asientos_contables a
      join asientos_detalle d on d.asiento_id = a.id and d.cuenta_id = v_cg and d.auth_user_id = v_uid
     where a.auth_user_id = v_uid and a.estado = 'registrado' and a.origen = 'automatico'
       and a.referencia_tipo in ('venta', 'gasto', 'compra', 'pago_salario', 'capital_inicial', 'pago_retenciones_ir',
                                 'devolucion_venta', 'pago_credito', 'pago_cxp', 'pago_fiado', 'faltante_caja', 'sobrante_caja')
     group by 1, 2, 3, 4, 5
    having abs(round(sum(d.debe - d.haber), 2)) >= 0.01;

  -- Enlace de cada asiento con su(s) movimiento(s) de Caja.
  create temp table _cd_link0 (asiento_id uuid, mf_id uuid) on commit drop;
  insert into _cd_link0 select o.asiento_id, m.id from _cd_orig o
    join _cd_mf m on m.referencia_tipo = 'venta' and m.referencia_id = o.referencia_id and m.tipo_flujo = 'INGRESO'
   where o.referencia_tipo = 'venta';
  insert into _cd_link0 select o.asiento_id, m.id from _cd_orig o
    join gastos g on g.id = o.referencia_id and g.auth_user_id in (select uid from _cd_lugar)
    join _cd_mf m on (g.movimiento_financiero_id is not null and m.id = g.movimiento_financiero_id)
                  or (g.movimiento_financiero_id is null and m.referencia_tipo = 'gasto' and m.referencia_id = g.id and m.tipo_flujo = 'EGRESO')
   where o.referencia_tipo = 'gasto';
  insert into _cd_link0 select o.asiento_id, m.id from _cd_orig o
    join compras c on c.id = o.referencia_id and c.auth_user_id in (select uid from _cd_lugar)
    join _cd_mf m on (c.movimiento_caja_id is not null and m.id = c.movimiento_caja_id)
                  or (c.movimiento_caja_id is null and m.referencia_tipo = 'compra' and m.referencia_id = c.id and m.tipo_flujo = 'EGRESO')
   where o.referencia_tipo = 'compra';
  insert into _cd_link0 select o.asiento_id, m.id from _cd_orig o
    join _cd_mf m on m.referencia_id = o.referencia_id and m.tipo_flujo = 'EGRESO' and m.referencia_tipo = 'salario'
   where o.referencia_tipo = 'pago_salario';
  insert into _cd_link0 select o.asiento_id, m.id from _cd_orig o
    join _cd_mf m on m.id = o.referencia_id
   where o.referencia_tipo = 'capital_inicial';
  insert into _cd_link0 select o.asiento_id, m.id from _cd_orig o
    join retenciones_ir_pagos rp on rp.id = o.referencia_id and rp.auth_user_id in (select uid from _cd_lugar)
    join _cd_mf m on m.id = rp.movimiento_financiero_id
   where o.referencia_tipo = 'pago_retenciones_ir';
  insert into _cd_link0 select o.asiento_id, m.id from _cd_orig o
    join devoluciones_venta dv on dv.id = o.referencia_id and dv.auth_user_id in (select uid from _cd_lugar)
    join _cd_mf m on m.id = dv.movimiento_financiero_id
   where o.referencia_tipo = 'devolucion_venta';
  -- Abonos de crédito, pagos a proveedor y cobros de fiado: el movimiento apunta al documento "padre";
  -- se toma el del mismo monto más cercano en el tiempo (máximo 1 día de diferencia).
  insert into _cd_link0 select o.asiento_id, x.id from _cd_orig o
    join creditos_pagos p on p.id = o.referencia_id and p.auth_user_id in (select uid from _cd_lugar)
    cross join lateral (select m.id from _cd_mf m
       where m.referencia_tipo = 'credito' and m.referencia_id = p.credito_id and m.auth_user_id = p.auth_user_id
         and m.tipo_flujo = 'INGRESO' and abs(m.monto - p.monto) < 0.01
         and abs(extract(epoch from (m.created_at - p.created_at))) <= 86400
       order by abs(extract(epoch from (m.created_at - p.created_at))) limit 1) x
   where o.referencia_tipo = 'pago_credito';
  insert into _cd_link0 select o.asiento_id, x.id from _cd_orig o
    join cuentas_por_pagar_pagos p on p.id = o.referencia_id and p.auth_user_id in (select uid from _cd_lugar)
    cross join lateral (select m.id from _cd_mf m
       where m.referencia_tipo = 'cuenta_por_pagar' and m.referencia_id = p.cuenta_id and m.auth_user_id = p.auth_user_id
         and m.tipo_flujo = 'EGRESO'
         and (abs(m.monto - p.monto) < 0.01 or abs(m.monto - (p.monto - coalesce(p.retencion_monto, 0))) < 0.01)
         and abs(extract(epoch from (m.created_at - p.created_at))) <= 86400
       order by abs(extract(epoch from (m.created_at - p.created_at))) limit 1) x
   where o.referencia_tipo = 'pago_cxp';
  insert into _cd_link0 select o.asiento_id, x.id from _cd_orig o
    join fiado_pagos p on p.id = o.referencia_id and p.auth_user_id in (select uid from _cd_lugar)
    cross join lateral (select m.id from _cd_mf m
       where m.referencia_id = p.fiado_id and m.auth_user_id = p.auth_user_id
         and m.tipo_flujo = 'INGRESO' and abs(m.monto - p.monto) < 0.01
         and abs(extract(epoch from (m.created_at - p.created_at))) <= 86400
       order by abs(extract(epoch from (m.created_at - p.created_at))) limit 1) x
   where o.referencia_tipo = 'pago_fiado';
  -- Un mismo movimiento nunca se usa para dos asientos: si pasa, se descarta (queda sin ubicar).
  create temp table _cd_link on commit drop as
    select * from _cd_link0 where mf_id not in (select mf_id from _cd_link0 group by mf_id having count(distinct asiento_id) > 1);

  -- Cuánto de cada asiento va a cada cuenta: lo que Caja demuestra, nunca más que lo asentado.
  create temp table _cd_alloc on commit drop as
  with lk as (
    select o.asiento_id, o.fecha, o.concepto, o.l, m.id as mf_id, m.dest, m.monto
      from _cd_orig o join _cd_link k on k.asiento_id = o.asiento_id join _cd_mf m on m.id = k.mf_id
     where (o.l > 0 and m.tipo_flujo = 'INGRESO') or (o.l < 0 and m.tipo_flujo = 'EGRESO')),
  s as (select asiento_id, sum(monto) as s from lk group by asiento_id),
  b as (select lk.*, s.s,
               case when s.s <= abs(lk.l) + 0.005 then lk.monto else round(lk.monto * abs(lk.l) / s.s, 2) end as a,
               row_number() over (partition by lk.asiento_id order by lk.monto desc, lk.mf_id) as rn
          from lk join s on s.asiento_id = lk.asiento_id)
  select asiento_id, fecha, concepto, l, mf_id, dest, monto, s,
         a + case when s > abs(l) + 0.005 and rn = 1
                  then abs(l) - sum(a) over (partition by asiento_id) else 0 end as a
    from b;

  -- Líneas de cada día (sin la de Caja General): monto con signo, + = Debe, - = Haber.
  create temp table _cd_lin0 (fecha date, cuenta_id uuid, monto numeric, descripcion text) on commit drop;
  insert into _cd_lin0
    select fecha, dest, sign(l) * sum(a), left(concepto, 240) from _cd_alloc
     where dest is not null and a > 0 group by asiento_id, fecha, dest, l, concepto;
  -- Faltantes/sobrantes de Caja Chica: son efectivo del cajón.
  if v_ef is not null then
    insert into _cd_lin0 select fecha, v_ef, l, left(concepto, 240) from _cd_orig where referencia_tipo in ('faltante_caja', 'sobrante_caja');
  end if;
  -- Transferencias internas entre Caja Chica y bancos (no tenían asiento: solo cambian el dinero de lugar).
  insert into _cd_lin0
    select fecha, dest, case when tipo_flujo = 'INGRESO' then monto else -monto end, left(coalesce(concepto, 'Transferencia interna'), 240)
      from _cd_mf where tipo_movimiento = 'TRANSFERENCIA' and dest is not null;
  create temp table _cd_lin on commit drop as select * from _cd_lin0 where round(monto, 2) <> 0;

  -- Firma esperada por día (incluye la línea de Caja General = - suma del resto).
  create temp table _cd_dia on commit drop as
  with t as (
    select fecha, cuenta_id, round(monto, 2) as monto, descripcion from _cd_lin
    union all
    select fecha, v_cg, round(-sum(monto), 2), 'Ubicación del dinero del día' from _cd_lin group by fecha having round(sum(monto), 2) <> 0)
  select fecha, md5(string_agg(cuenta_id::text || ':' || to_char(monto, 'FM9999999999990.00') || ':' || coalesce(descripcion, ''), '|'
                    order by cuenta_id::text, monto, descripcion)) as firma
    from t group by fecha;

  -- Lo que hay hoy registrado por día.
  create temp table _cd_actual on commit drop as
    select u.fecha, u.asiento_id, a.estado,
           (select md5(string_agg(d.cuenta_id::text || ':' || to_char(round(d.debe - d.haber, 2), 'FM9999999999990.00') || ':' || coalesce(d.descripcion, ''), '|'
                    order by d.cuenta_id::text, round(d.debe - d.haber, 2), d.descripcion))
              from asientos_detalle d where d.asiento_id = u.asiento_id) as firma
      from contabilidad_ubicacion_dinero u join asientos_contables a on a.id = u.asiento_id
     where u.auth_user_id = v_uid;

  select count(*) filter (where a.fecha is null),
         count(*) filter (where a.fecha is not null and (a.estado <> 'registrado' or a.firma is distinct from e.firma)),
         count(*) filter (where a.fecha is not null and a.estado = 'registrado' and a.firma = e.firma)
    into v_crear, v_reemplazar, v_iguales
    from _cd_dia e left join _cd_actual a on a.fecha = e.fecha;
  select count(*) into v_anular from _cd_actual a where a.estado = 'registrado' and not exists (select 1 from _cd_dia e where e.fecha = a.fecha);
  select count(*) into v_huerfanos from asientos_contables a
   where a.auth_user_id = v_uid and a.referencia_tipo = 'ubicacion_dinero' and a.estado <> 'anulado'
     and not exists (select 1 from contabilidad_ubicacion_dinero u where u.asiento_id = a.id);

  -- Resumen (también para la vista previa).
  v_resumen := jsonb_build_object(
    'configurado', true,
    'dias', (select count(*) from _cd_dia),
    'dias_crear', v_crear, 'dias_reemplazar', v_reemplazar, 'dias_sin_cambio', v_iguales,
    'dias_anular', v_anular, 'huerfanos', v_huerfanos,
    'por_cuenta', coalesce((select jsonb_agg(jsonb_build_object('cuenta_id', cuenta_id, 'neto', neto) order by cuenta_id)
                              from (select cuenta_id, round(sum(monto), 2) as neto from _cd_lin group by cuenta_id) z), '[]'::jsonb),
    'asientos_con_dinero', (select count(*) from _cd_orig),
    'sin_movimiento_caja', (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(round(sum(abs(o.l)), 2), 0)) from _cd_orig o
                             where o.referencia_tipo not in ('faltante_caja', 'sobrante_caja')
                               and not exists (select 1 from _cd_alloc x where x.asiento_id = o.asiento_id)),
    'sin_banco_asignado', (select jsonb_build_object('cantidad', count(distinct asiento_id), 'monto', coalesce(round(sum(a), 2), 0)) from _cd_alloc where dest is null),
    'monto_distinto', (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(round(sum(dif), 2), 0)) from (
                         select asiento_id, abs(max(l)) - sum(a) as dif from _cd_alloc group by asiento_id having abs(max(l)) - sum(a) >= 0.01) z),
    'transferencias', (select count(*) from _cd_mf where tipo_movimiento = 'TRANSFERENCIA' and dest is not null));

  if not p_aplicar then return v_resumen; end if;

  -- ===== Aplicar (todo dentro de esta misma transacción) =====
  -- 1) Días que ya no tienen nada que ubicar: se anula su asiento.
  for r in select a.fecha, a.asiento_id from _cd_actual a
            where a.estado = 'registrado' and not exists (select 1 from _cd_dia e where e.fecha = a.fecha) loop
    update asientos_contables set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Ubicación del dinero recalculada: ese día ya no tiene dinero por ubicar'
     where id = r.asiento_id and auth_user_id = v_uid and estado <> 'anulado';
    update contabilidad_ubicacion_dinero set firma = 'sin dinero por ubicar', updated_at = now() where auth_user_id = v_uid and fecha = r.fecha;
  end loop;

  -- 2) Días nuevos o que cambiaron: asiento nuevo (y se anula el anterior).
  for r in select e.fecha, e.firma, a.asiento_id as anterior from _cd_dia e left join _cd_actual a on a.fecha = e.fecha
            where a.fecha is null or a.estado <> 'registrado' or a.firma is distinct from e.firma
            order by e.fecha loop
    v_numero := generar_numero_asiento(v_uid);
    insert into asientos_contables (auth_user_id, numero, fecha, concepto, estado, origen, referencia_tipo, referencia_id, usuario_nombre)
    values (v_uid, v_numero, r.fecha,
            'Ubicación del dinero del día ' || to_char(r.fecha, 'DD/MM/YYYY') || ' (Caja Chica y Bancos)',
            'borrador', 'automatico', 'ubicacion_dinero', null, 'Sistema')
    returning id into v_asiento;
    insert into asientos_detalle (auth_user_id, asiento_id, cuenta_id, debe, haber, orden, descripcion)
    select v_uid, v_asiento, t.cuenta_id,
           case when t.monto > 0 then t.monto else 0 end, case when t.monto < 0 then -t.monto else 0 end,
           row_number() over (order by t.es_cg desc, t.cuenta_id::text, t.monto, t.descripcion), t.descripcion
      from (select cuenta_id, round(monto, 2) as monto, descripcion, false as es_cg from _cd_lin where fecha = r.fecha
            union all
            select v_cg, round(-sum(monto), 2), 'Ubicación del dinero del día', true from _cd_lin where fecha = r.fecha
             having round(sum(monto), 2) <> 0) t;
    select coalesce(sum(debe), 0), coalesce(sum(haber), 0) into v_td, v_th from asientos_detalle where asiento_id = v_asiento;
    if round(v_td, 2) <> round(v_th, 2) or v_td = 0 then
      raise exception 'Ubicación del dinero: el asiento del % no cuadra (Debe %, Haber %). No se aplicó nada.', r.fecha, v_td, v_th;
    end if;
    update asientos_contables set estado = 'registrado', total_debe = v_td, total_haber = v_th, registrado_en = now() where id = v_asiento;

    if r.anterior is not null then
      update asientos_contables set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Reemplazado: la ubicación del dinero de ese día se recalculó'
       where id = r.anterior and auth_user_id = v_uid and estado <> 'anulado';
      update contabilidad_ubicacion_dinero set asiento_id = v_asiento, firma = r.firma, updated_at = now()
       where auth_user_id = v_uid and fecha = r.fecha;
    else
      insert into contabilidad_ubicacion_dinero (auth_user_id, fecha, asiento_id, firma) values (v_uid, r.fecha, v_asiento, r.firma);
    end if;
  end loop;

  -- 3) Asientos de ubicación sueltos (sin control): se anulan.
  update asientos_contables a set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Ubicación del dinero sin control (duplicado): anulado automáticamente'
   where a.auth_user_id = v_uid and a.referencia_tipo = 'ubicacion_dinero' and a.estado <> 'anulado'
     and not exists (select 1 from contabilidad_ubicacion_dinero u where u.asiento_id = a.id);

  return v_resumen || jsonb_build_object('aplicado', true);
end $$;

-- ---------- Quitar la ubicación (vuelve todo a Caja General) ----------
create or replace function public.contabilidad_quitar_ubicacion_dinero()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  perform pg_advisory_xact_lock(hashtext('n360_ubicar_dinero:' || v_uid::text));
  update asientos_contables set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Se desactivó la ubicación del dinero en Caja Chica y Bancos'
   where auth_user_id = v_uid and referencia_tipo = 'ubicacion_dinero' and estado <> 'anulado';
  get diagnostics v_n = row_count;
  -- El control de cada día se conserva (apunta a su asiento ya anulado): si se vuelve a activar, se crean asientos nuevos.
  update contabilidad_ubicacion_dinero set firma = 'desactivado', updated_at = now() where auth_user_id = v_uid;
  return v_n;
end $$;

revoke all on function public.contabilidad_ubicar_dinero(boolean) from public, anon;
revoke all on function public.contabilidad_quitar_ubicacion_dinero() from public, anon;
revoke all on function public.contabilidad_bancos_del_grupo() from public, anon;
grant execute on function public.contabilidad_ubicar_dinero(boolean) to authenticated;
grant execute on function public.contabilidad_quitar_ubicacion_dinero() to authenticated;
grant execute on function public.contabilidad_bancos_del_grupo() to authenticated;
