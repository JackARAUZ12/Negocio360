-- =====================================================================
-- CONTABILIDAD AUTOMÁTICA DESDE EL SERVIDOR (17-nov-2026)
-- Hoy los asientos automáticos solo se generan cuando alguien abre el sistema en un navegador. Esta migración
-- agrega la MISMA lógica de contabilidad.js (generarAsientosAutomaticosInterno + anularAsientosDeOrigenAnulado)
-- como función de la base de datos, para que corra sola cada 5 minutos.
--
-- SOLO AGREGA, y arranca APAGADO:
--   · 2 columnas nuevas en configuracion_empresa (contabilidad_servidor_auto = false, contabilidad_servidor_desde)
--   · 1 tabla de bitácora (contabilidad_servidor_log)
--   · funciones _conta_srv_asiento, contabilidad_generar_servidor, contabilidad_generar_servidor_todas
--   · 1 tarea programada (pg_cron) que no hace nada mientras ninguna cuenta tenga el interruptor encendido
-- Reglas que respeta igual que el navegador: mismo mapeo de cuentas, mismos montos (IVA, retenciones, costo de
-- ventas), nunca duplica (revisa tipo+documento), todo asiento se registra por registrar_asiento_contable y solo
-- se crea si Debe = Haber. Cuentas que son central de un grupo (bodegas/sucursales) se omiten: siguen por el navegador.
-- =====================================================================
alter table public.configuracion_empresa
  add column if not exists contabilidad_servidor_auto boolean not null default false,
  add column if not exists contabilidad_servidor_desde date;

create table if not exists public.contabilidad_servidor_log (
  id bigserial primary key,
  auth_user_id uuid not null,
  ejecutado_en timestamptz not null default now(),
  creados integer not null default 0,
  anulados integer not null default 0,
  sin_configurar integer not null default 0,
  omitidos_desbalance integer not null default 0,
  error text,
  nota text
);
alter table public.contabilidad_servidor_log enable row level security;
create index if not exists contabilidad_servidor_log_idx on public.contabilidad_servidor_log(auth_user_id, ejecutado_en desc);

-- ---------------------------------------------------------------------
-- Crea UN asiento (borrador -> líneas -> registrado). Devuelve 1 si lo creó, 0 si ya existía / no cuadra.
-- p: tipo, ref, fecha, concepto, monto, debe, haber, lado('haber'|'debe'), partes[{monto,cuenta,desc}],
--    debe_ex[{monto,cuenta,desc}], haber_ex[...], extra[{cuenta,debe,haber,desc}]  ó  lineas[{c,d,h,o,desc}] (directas)
-- Las líneas se arman EXACTAMENTE como en contabilidad.js (mismos órdenes y la misma división del monto).
-- ---------------------------------------------------------------------
create or replace function public._conta_srv_asiento(u uuid, p jsonb) returns integer
language plpgsql security definer set search_path = public as $f$
declare
  v_tipo text := p ->> 'tipo'; v_ref uuid := (p ->> 'ref')::uuid;
  monto numeric := round(coalesce((p ->> 'monto')::numeric, 0), 2);
  debe_id uuid := (p ->> 'debe')::uuid; haber_id uuid := (p ->> 'haber')::uuid;
  lado text := p ->> 'lado';
  partes jsonb := coalesce(p -> 'partes', '[]'::jsonb);
  debe_ex jsonb := coalesce(p -> 'debe_ex', '[]'::jsonb);
  haber_ex jsonb := coalesce(p -> 'haber_ex', '[]'::jsonb);
  extra jsonb := coalesce(p -> 'extra', '[]'::jsonb);
  lineas jsonb := '[]'::jsonb; x jsonb; i integer;
  suma numeric := 0; neto numeric; sum_d numeric; sum_h numeric; idx_h integer := 1;
  v_as uuid; v_num text; td numeric := 0; th numeric := 0;
begin
  if exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = v_tipo and a.referencia_id = v_ref) then
    return 0;
  end if;

  if p ? 'lineas' then
    lineas := p -> 'lineas';
  else
    -- partes a separar del monto (IVA / otros impuestos): solo las de monto > 0
    select coalesce(jsonb_agg(e), '[]'::jsonb), coalesce(sum(round((e ->> 'monto')::numeric, 2)), 0) into partes, suma
      from jsonb_array_elements(partes) e where (e ->> 'monto')::numeric > 0;
    if jsonb_array_length(partes) > 0 and round(suma, 2) < monto then
      neto := round(monto - suma, 2);
      if lado = 'haber' then
        lineas := jsonb_build_array(jsonb_build_object('c', debe_id, 'd', monto, 'h', 0, 'o', 0), jsonb_build_object('c', haber_id, 'd', 0, 'h', neto, 'o', 1));
        for i in 0 .. jsonb_array_length(partes) - 1 loop
          x := partes -> i;
          lineas := lineas || jsonb_build_array(jsonb_build_object('c', x ->> 'cuenta', 'd', 0, 'h', (x ->> 'monto')::numeric, 'o', 2 + i, 'desc', x ->> 'desc'));
        end loop;
        idx_h := 1;
      else
        lineas := jsonb_build_array(jsonb_build_object('c', debe_id, 'd', neto, 'h', 0, 'o', 0));
        for i in 0 .. jsonb_array_length(partes) - 1 loop
          x := partes -> i;
          lineas := lineas || jsonb_build_array(jsonb_build_object('c', x ->> 'cuenta', 'd', (x ->> 'monto')::numeric, 'h', 0, 'o', 1 + i, 'desc', x ->> 'desc'));
        end loop;
        lineas := lineas || jsonb_build_array(jsonb_build_object('c', haber_id, 'd', 0, 'h', monto, 'o', 9));
        idx_h := jsonb_array_length(lineas) - 1;
      end if;
    else
      lineas := jsonb_build_array(jsonb_build_object('c', debe_id, 'd', monto, 'h', 0, 'o', 0), jsonb_build_object('c', haber_id, 'd', 0, 'h', monto, 'o', 1));
      idx_h := 1;
    end if;

    -- retenciones que REDUCEN la línea principal (a favor en Debe / por pagar en Haber)
    select coalesce(jsonb_agg(e), '[]'::jsonb) into debe_ex from jsonb_array_elements(debe_ex) e where (e ->> 'monto')::numeric > 0;
    select coalesce(jsonb_agg(e), '[]'::jsonb) into haber_ex from jsonb_array_elements(haber_ex) e where (e ->> 'monto')::numeric > 0;
    if jsonb_array_length(debe_ex) > 0 then
      select round(sum((e ->> 'monto')::numeric), 2) into sum_d from jsonb_array_elements(debe_ex) e;
      if (lineas -> 0 ->> 'd')::numeric > 0 and (lineas -> 0 ->> 'd')::numeric - sum_d > 0.004 then
        lineas := jsonb_set(lineas, '{0,d}', to_jsonb(round((lineas -> 0 ->> 'd')::numeric - sum_d, 2)));
        for i in 0 .. jsonb_array_length(debe_ex) - 1 loop
          x := debe_ex -> i;
          lineas := lineas || jsonb_build_array(jsonb_build_object('c', x ->> 'cuenta', 'd', (x ->> 'monto')::numeric, 'h', 0, 'o', 4 + i, 'desc', coalesce(x ->> 'desc', 'Retención')));
        end loop;
      end if;
    end if;
    if jsonb_array_length(haber_ex) > 0 then
      select round(sum((e ->> 'monto')::numeric), 2) into sum_h from jsonb_array_elements(haber_ex) e;
      if (lineas -> idx_h ->> 'h')::numeric > 0 and (lineas -> idx_h ->> 'h')::numeric - sum_h > 0.004 then
        lineas := jsonb_set(lineas, array[idx_h::text, 'h'], to_jsonb(round((lineas -> idx_h ->> 'h')::numeric - sum_h, 2)));
        for i in 0 .. jsonb_array_length(haber_ex) - 1 loop
          x := haber_ex -> i;
          lineas := lineas || jsonb_build_array(jsonb_build_object('c', x ->> 'cuenta', 'd', 0, 'h', (x ->> 'monto')::numeric, 'o', 6 + i, 'desc', coalesce(x ->> 'desc', 'Retención')));
        end loop;
      end if;
    end if;
    for i in 0 .. jsonb_array_length(extra) - 1 loop
      x := extra -> i;
      lineas := lineas || jsonb_build_array(jsonb_build_object('c', x ->> 'cuenta', 'd', coalesce((x ->> 'debe')::numeric, 0), 'h', coalesce((x ->> 'haber')::numeric, 0), 'o', 10 + i, 'desc', x ->> 'desc'));
    end loop;
  end if;

  -- Debe = Haber antes de gastar un número: si no cuadra, no se crea nada (queda para revisión)
  select coalesce(sum(round((e ->> 'd')::numeric, 2)), 0), coalesce(sum(round((e ->> 'h')::numeric, 2)), 0) into td, th from jsonb_array_elements(lineas) e;
  if td <= 0 or round(td, 2) <> round(th, 2) then return -1; end if;

  v_num := public.generar_numero_asiento(u);
  insert into public.asientos_contables(auth_user_id, numero, fecha, concepto, estado, origen, referencia_tipo, referencia_id, usuario_nombre)
  values (u, v_num, (p ->> 'fecha')::date, left(btrim(p ->> 'concepto'), 500), 'borrador', 'automatico', v_tipo, v_ref, 'Contabilidad automática (servidor)')
  returning id into v_as;
  insert into public.asientos_detalle(auth_user_id, asiento_id, cuenta_id, debe, haber, orden, descripcion)
  select u, v_as, (e ->> 'c')::uuid, round((e ->> 'd')::numeric, 2), round((e ->> 'h')::numeric, 2), (e ->> 'o')::integer, e ->> 'desc'
    from jsonb_array_elements(lineas) e;
  perform public.registrar_asiento_contable(v_as);
  return 1;
end $f$;
revoke all on function public._conta_srv_asiento(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Genera los asientos pendientes de UNA cuenta. Solo si su interruptor está encendido y tiene fecha de inicio.
-- ---------------------------------------------------------------------
create or replace function public.contabilidad_generar_servidor(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare
  u uuid := p_uid;
  cfg record; v_desde date; v_desde_ts timestamptz;
  creados integer := 0; anulados integer := 0; sin_conf integer := 0; desbal integer := 0; r integer; fila record;
  m_venta record; m_cred record; m_pc record; m_costo record; m_costoserv record; m_iva_v record; m_otros_v record; m_ret_cli record;
  m_iva_g record; m_ret_ir record; m_pago_imp record; m_ded record; m_m record; m_m2 record;
  tp text; m_tp record; v_costo numeric; v_iva numeric; v_sumex numeric; v_ret numeric; v_monto numeric; v_partes jsonb; v_debe_ex jsonb; v_extra jsonb;
  v_bloq boolean; v_debe uuid; v_haber uuid; v_det jsonb; v_serv boolean;
  c_inicio_caja date := '2026-10-13';
  v_V numeric := 0; v_C numeric := 0; v_consumido numeric := 0; v_pagado numeric := 0; v_A numeric; offsets jsonb := '{}'::jsonb; mv record;
  v_hay_prest boolean; v_tot numeric; v_cr record;
begin
  select contabilidad_servidor_auto, contabilidad_servidor_desde into cfg from public.configuracion_empresa where auth_user_id = u;
  if not found or cfg.contabilidad_servidor_auto is not true then return jsonb_build_object('omitido', 'apagado'); end if;
  if cfg.contabilidad_servidor_desde is null then return jsonb_build_object('omitido', 'sin fecha de inicio'); end if;
  -- central de un grupo (bodegas/sucursales): su libro incluye a los miembros y sigue por el navegador
  if exists (select 1 from public.sucursales s where s.auth_user_id_central = u and coalesce(s.es_central, false) = false and coalesce(s.activa, true) = true
              and s.auth_user_id_sucursal is not null and s.auth_user_id_sucursal <> u) then
    return jsonb_build_object('omitido', 'central de grupo');
  end if;
  if not exists (select 1 from public.contabilidad_mapeo_cuentas where auth_user_id = u) then return jsonb_build_object('omitido', 'sin mapeo'); end if;

  if not pg_try_advisory_xact_lock(hashtextextended('conta_srv:' || u::text, 0)) then return jsonb_build_object('omitido', 'ya en curso'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  v_desde := cfg.contabilidad_servidor_desde;
  v_desde_ts := (v_desde::timestamp at time zone 'UTC');

  select * into m_venta from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'venta';
  select * into m_cred from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'credito_otorgado';
  select * into m_pc from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'pago_credito';
  select * into m_costo from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'costo_ventas';
  select * into m_costoserv from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'costo_servicios';
  select * into m_iva_v from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'iva_ventas';
  select * into m_otros_v from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'impuesto_ventas_otros';
  select * into m_ret_cli from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'retencion_ir_clientes';
  select * into m_iva_g from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'iva_gastos';
  select * into m_ret_ir from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'retencion_ir';
  select * into m_pago_imp from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'pago_impuestos';
  select * into m_ded from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'nomina_deducciones_ley';

  -- Empresa vinculada: traslados entre negocios pendientes de asentar (no hace nada si no aplica)
  begin perform public.empresa_traslados_asentar_pendientes(); exception when others then null; end;

  -- ===================== VENTAS y CRÉDITOS OTORGADOS =====================
  foreach tp in array array['venta', 'credito_otorgado'] loop
    if tp = 'venta' then m_tp := m_venta; else m_tp := m_cred; end if;
    if m_tp.cuenta_debe_id is null or m_tp.cuenta_haber_id is null then sin_conf := sin_conf + 1; continue; end if;
    for fila in
      select v.* from public.ventas v
       where v.auth_user_id = u and v.estado = 'completada' and v.fecha >= v_desde_ts
         and ((tp = 'venta' and v.metodo_pago <> 'credito' and v.metodo_pago <> 'fiado') or (tp = 'credito_otorgado' and v.metodo_pago in ('credito', 'fiado')))
         and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = tp and a.referencia_id = v.id)
       order by v.fecha, v.created_at
    loop
      v_monto := round(coalesce(fila.total, 0), 2);
      continue when v_monto <= 0;
      -- IVA y otros impuestos de la venta
      select coalesce(sum(round(coalesce(monto, 0), 2)), 0) into v_sumex from public.venta_impuestos where venta_id = fila.id and auth_user_id = u and round(coalesce(monto, 0), 2) > 0;
      v_iva := greatest(0, round(coalesce(fila.impuesto, 0) - v_sumex, 2));
      v_bloq := false; v_partes := '[]'::jsonb; v_debe_ex := '[]'::jsonb;
      if v_sumex > 0 and m_otros_v.cuenta_haber_id is null then v_bloq := true;
      else
        if m_iva_v.cuenta_haber_id is not null and v_iva > 0 then v_partes := v_partes || jsonb_build_array(jsonb_build_object('monto', v_iva, 'cuenta', m_iva_v.cuenta_haber_id, 'desc', 'IVA')); end if;
        if v_sumex > 0 then
          select v_partes || coalesce(jsonb_agg(jsonb_build_object('monto', round(monto, 2), 'cuenta', m_otros_v.cuenta_haber_id, 'desc', coalesce(nombre, 'Impuesto'))), '[]'::jsonb) into v_partes
            from public.venta_impuestos where venta_id = fila.id and auth_user_id = u and round(coalesce(monto, 0), 2) > 0;
        end if;
      end if;
      v_ret := round(coalesce(fila.retencion_ir_monto, 0), 2);
      if not v_bloq and v_ret > 0 then
        if m_ret_cli.cuenta_debe_id is null then v_bloq := true;
        else v_debe_ex := jsonb_build_array(jsonb_build_object('monto', v_ret, 'cuenta', m_ret_cli.cuenta_debe_id, 'desc', 'Retención de IR a favor')); end if;
      end if;
      if v_bloq then sin_conf := sin_conf + 1; continue; end if;
      -- costo de lo vendido (2 líneas más dentro del mismo asiento)
      v_extra := '[]'::jsonb;
      if m_costo.cuenta_debe_id is not null and m_costo.cuenta_haber_id is not null then
        v_serv := m_costoserv.cuenta_debe_id is not null;
        select round(coalesce(sum(coalesce(cantidad, 0) * coalesce(costo, 0)), 0), 2) into v_costo from public.venta_detalles
         where venta_id = fila.id and auth_user_id = u and not (v_serv and tipo_item = 'servicio');
        if v_costo > 0 then
          v_extra := jsonb_build_array(jsonb_build_object('cuenta', m_costo.cuenta_debe_id, 'debe', v_costo, 'haber', 0, 'desc', 'Costo de lo vendido'),
                                       jsonb_build_object('cuenta', m_costo.cuenta_haber_id, 'debe', 0, 'haber', v_costo, 'desc', 'Salida de inventario'));
        end if;
      end if;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', tp, 'ref', fila.id, 'fecha', (fila.fecha at time zone 'UTC')::date,
        'concepto', case when tp = 'venta' then 'Venta ' else 'Crédito otorgado — venta ' end || coalesce(fila.numero_venta, ''),
        'monto', v_monto, 'debe', m_tp.cuenta_debe_id, 'haber', m_tp.cuenta_haber_id, 'lado', 'haber', 'partes', v_partes, 'debe_ex', v_debe_ex, 'extra', v_extra));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end loop;

  -- ===================== COBROS DE CRÉDITO y FIADO =====================
  if m_pc.cuenta_debe_id is null or m_pc.cuenta_haber_id is null then sin_conf := sin_conf + 2;
  else
    for fila in select p.* from public.creditos_pagos p where p.auth_user_id = u and p.estado = 'completado' and p.fecha >= v_desde
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'pago_credito' and a.referencia_id = p.id)
                 order by p.fecha, p.created_at loop
      continue when round(coalesce(fila.monto, 0), 2) <= 0;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'pago_credito', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', 'Pago de crédito recibido',
        'monto', fila.monto, 'debe', m_pc.cuenta_debe_id, 'haber', m_pc.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
    for fila in select p.* from public.fiado_pagos p where p.auth_user_id = u and p.created_at >= v_desde_ts
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'pago_fiado' and a.referencia_id = p.id)
                 order by p.created_at loop
      continue when round(coalesce(fila.monto, 0), 2) <= 0;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'pago_fiado', 'ref', fila.id, 'fecha', (fila.created_at at time zone 'UTC')::date, 'concepto', 'Cobro de fiado',
        'monto', fila.monto, 'debe', m_pc.cuenta_debe_id, 'haber', m_pc.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== DESCUENTOS A CRÉDITOS =====================
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'descuento_credito';
  if m_m.id is not null then
    if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
    else
      for fila in select h.* from public.creditos_historial h where h.auth_user_id = u and h.tipo_evento = 'editado' and (h.data ->> 'descuento') is not null and h.created_at >= v_desde_ts
                     and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'descuento_credito' and a.referencia_id = h.id)
                   order by h.created_at loop
        v_monto := case when (fila.data ->> 'descuento') ~ '^[0-9]+(\.[0-9]+)?$' then round((fila.data ->> 'descuento')::numeric, 2) else 0 end;
        continue when v_monto <= 0;
        r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'descuento_credito', 'ref', fila.id, 'fecha', (fila.created_at at time zone 'UTC')::date,
          'concepto', 'Descuento concedido — ' || coalesce(nullif(fila.data ->> 'numeroCredito', ''), 'crédito')
                      || case when coalesce(fila.data ->> 'motivoDescuento', '') <> '' then ' (' || left(fila.data ->> 'motivoDescuento', 80) || ')' else '' end,
          'monto', v_monto, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
        if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
      end loop;
    end if;
  end if;

  -- ===================== DEVOLUCIONES DE VENTA =====================
  if (coalesce(m_venta.cuenta_haber_id, m_cred.cuenta_haber_id)) is not null or true then
    declare ctaV uuid := coalesce(m_venta.cuenta_haber_id, m_cred.cuenta_haber_id); ctaCaja uuid := m_venta.cuenta_debe_id; ctaCxC uuid := m_cred.cuenta_debe_id;
            v_tot2 numeric; v_din numeric; v_deu numeric; v_ivad numeric; v_cre numeric; ls jsonb;
    begin
      for fila in select d.*, (select numero_venta from public.ventas vv where vv.id = d.venta_id) as num_venta
                    from public.devoluciones_venta d where d.auth_user_id = u and d.fecha >= v_desde
                     and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'devolucion_venta' and a.referencia_id = d.id)
                   order by d.fecha loop
        v_tot2 := round(coalesce(fila.total, 0), 2); v_din := round(coalesce(fila.monto_dinero, 0), 2); v_deu := round(coalesce(fila.monto_credito, 0), 2);
        continue when v_tot2 <= 0 and not (coalesce(fila.costo_reingresado, 0) > 0);
        if ctaV is null or (v_din > 0 and ctaCaja is null) or (v_deu > 0 and ctaCxC is null) then sin_conf := sin_conf + 1; continue; end if;
        v_ivad := case when m_iva_v.cuenta_haber_id is not null then least(round(coalesce(fila.impuesto, 0), 2), v_tot2) else 0 end;
        v_cre := case when m_costo.cuenta_debe_id is not null and m_costo.cuenta_haber_id is not null then round(coalesce(fila.costo_reingresado, 0), 2) else 0 end;
        ls := '[]'::jsonb;
        if round(v_tot2 - v_ivad, 2) > 0 then ls := ls || jsonb_build_array(jsonb_build_object('c', ctaV, 'd', v_tot2 - v_ivad, 'h', 0, 'o', 0, 'desc', 'Devolución de venta')); end if;
        if v_ivad > 0 then ls := ls || jsonb_build_array(jsonb_build_object('c', m_iva_v.cuenta_haber_id, 'd', v_ivad, 'h', 0, 'o', 1, 'desc', 'IVA de lo devuelto')); end if;
        if v_din > 0 then ls := ls || jsonb_build_array(jsonb_build_object('c', ctaCaja, 'd', 0, 'h', v_din, 'o', 2, 'desc', 'Dinero devuelto al cliente')); end if;
        if v_deu > 0 then ls := ls || jsonb_build_array(jsonb_build_object('c', ctaCxC, 'd', 0, 'h', v_deu, 'o', 3, 'desc', 'Rebajado de lo que debía el cliente')); end if;
        if v_cre > 0 then
          ls := ls || jsonb_build_array(jsonb_build_object('c', m_costo.cuenta_haber_id, 'd', v_cre, 'h', 0, 'o', 10, 'desc', 'Mercadería devuelta al inventario'),
                                        jsonb_build_object('c', m_costo.cuenta_debe_id, 'd', 0, 'h', v_cre, 'o', 11, 'desc', 'Costo de lo vendido (devolución)'));
        end if;
        r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'devolucion_venta', 'ref', fila.id, 'fecha', fila.fecha,
          'concepto', 'Devolución ' || coalesce(fila.numero, '') || ' de venta ' || coalesce(fila.num_venta, ''), 'monto', 0, 'lineas', ls));
        if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
      end loop;
    end;
  end if;

  -- ===================== GASTOS =====================
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'gasto';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select g.* from public.gastos g where g.auth_user_id = u and g.estado = 'activo' and g.fecha >= v_desde
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'gasto' and a.referencia_id = g.id)
                 order by g.fecha, g.created_at loop
      continue when round(coalesce(fila.monto, 0), 2) <= 0;
      v_partes := '[]'::jsonb; v_extra := '[]'::jsonb; v_bloq := false;
      if m_iva_g.cuenta_debe_id is not null and round(coalesce(fila.impuesto, 0), 2) > 0 then
        v_partes := jsonb_build_array(jsonb_build_object('monto', round(fila.impuesto, 2), 'cuenta', m_iva_g.cuenta_debe_id, 'desc', 'IVA'));
      end if;
      v_ret := round(coalesce(fila.retencion_ir_monto, 0), 2);
      if v_ret > 0 then
        if m_ret_ir.cuenta_haber_id is null then v_bloq := true;
        else v_extra := jsonb_build_array(jsonb_build_object('monto', v_ret, 'cuenta', m_ret_ir.cuenta_haber_id, 'desc', 'Retención de IR por pagar')); end if;
      end if;
      if v_bloq then sin_conf := sin_conf + 1; continue; end if;
      v_haber := case when coalesce(fila.concepto, '') ~* '^merma de inventario' and coalesce(fila.metodo_pago_nombre, '') = '' and m_costo.cuenta_haber_id is not null
                      then m_costo.cuenta_haber_id else m_m.cuenta_haber_id end;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'gasto', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', 'Gasto: ' || coalesce(fila.concepto, ''),
        'monto', fila.monto, 'debe', m_m.cuenta_debe_id, 'haber', v_haber, 'lado', 'debe', 'partes', v_partes, 'haber_ex', v_extra));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== COMPRAS =====================
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'compra';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select c.* from public.compras c where c.auth_user_id = u and c.estado = 'completada' and c.fecha >= v_desde
                   and not (c.movimiento_caja_id is null and exists (select 1 from public.cuentas_por_pagar x where x.compra_id = c.id))
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'compra' and a.referencia_id = c.id)
                 order by c.fecha, c.created_at loop
      continue when round(coalesce(fila.total, 0), 2) <= 0;
      if fila.clase_costo = 'servicio' then v_debe := m_costoserv.cuenta_debe_id; else v_debe := m_m.cuenta_debe_id; end if;
      if v_debe is null then sin_conf := sin_conf + 1; continue; end if;
      v_partes := '[]'::jsonb; v_extra := '[]'::jsonb; v_bloq := false;
      if m_iva_g.cuenta_debe_id is not null and round(coalesce(fila.iva_monto, 0), 2) > 0 then
        v_partes := jsonb_build_array(jsonb_build_object('monto', round(fila.iva_monto, 2), 'cuenta', m_iva_g.cuenta_debe_id, 'desc', 'IVA'));
      end if;
      v_ret := round(coalesce(fila.retencion_ir_monto, 0), 2);
      if v_ret > 0 then
        if m_ret_ir.cuenta_haber_id is null then v_bloq := true;
        else v_extra := jsonb_build_array(jsonb_build_object('monto', v_ret, 'cuenta', m_ret_ir.cuenta_haber_id, 'desc', 'Retención de IR por pagar')); end if;
      end if;
      if v_bloq then sin_conf := sin_conf + 1; continue; end if;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'compra', 'ref', fila.id, 'fecha', fila.fecha,
        'concepto', 'Compra ' || coalesce(nullif(fila.concepto, ''), fila.numero, ''), 'monto', fila.total, 'debe', v_debe, 'haber', m_m.cuenta_haber_id,
        'lado', 'debe', 'partes', v_partes, 'haber_ex', v_extra));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== PAGO DE RETENCIONES DE IR A LA DGI =====================
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'pago_retenciones_ir';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select p.* from public.retenciones_ir_pagos p where p.auth_user_id = u and p.estado = 'activo' and p.fecha >= v_desde
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'pago_retenciones_ir' and a.referencia_id = p.id)
                 order by p.fecha loop
      continue when round(coalesce(fila.monto, 0), 2) <= 0;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'pago_retenciones_ir', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', 'Pago de retenciones de IR a la DGI',
        'monto', fila.monto, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== PAGO DE IMPUESTOS (con liquidación de IVA acreditable) =====================
  if m_pago_imp.cuenta_debe_id is null or m_pago_imp.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for mv in select id, tipo_movimiento, monto, impuesto_id from public.movimientos_impuestos where auth_user_id = u order by created_at, id loop
      continue when mv.impuesto_id is not null;
      if mv.tipo_movimiento = 'IVA_VENTA' then v_V := round(v_V + coalesce(mv.monto, 0), 2);
      elsif mv.tipo_movimiento = 'IVA_COMPRA' then v_C := round(v_C + coalesce(mv.monto, 0), 2);
      elsif mv.tipo_movimiento = 'PAGO_IMPUESTO' and coalesce(mv.monto, 0) > 0 then
        v_A := 0;
        if m_iva_v.cuenta_haber_id is not null and m_iva_g.cuenta_debe_id is not null then
          v_A := greatest(0, round(least(v_C, v_V) - v_consumido, 2));
          v_A := least(v_A, greatest(0, round(v_V - v_pagado - mv.monto, 2)));
        end if;
        v_consumido := round(v_consumido + v_A, 2); v_pagado := round(v_pagado + mv.monto + v_A, 2);
        if v_A > 0 then offsets := offsets || jsonb_build_object(mv.id::text, v_A); end if;
      end if;
    end loop;
    for fila in select p.* from public.movimientos_impuestos p where p.auth_user_id = u and p.tipo_movimiento = 'PAGO_IMPUESTO' and p.fecha >= v_desde
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'pago_impuesto' and a.referencia_id = p.id)
                 order by p.fecha, p.created_at loop
      continue when round(coalesce(fila.monto, 0), 2) <= 0;
      if fila.impuesto_id is not null then v_debe := coalesce(m_otros_v.cuenta_haber_id, m_pago_imp.cuenta_debe_id);
      else v_debe := coalesce(m_iva_v.cuenta_haber_id, m_pago_imp.cuenta_debe_id); end if;
      v_A := coalesce((offsets ->> fila.id::text)::numeric, 0);
      v_extra := case when v_A > 0 then jsonb_build_array(jsonb_build_object('cuenta', m_iva_v.cuenta_haber_id, 'debe', v_A, 'haber', 0, 'desc', 'Liquidación de IVA: se aplica el IVA acreditable'),
                                                           jsonb_build_object('cuenta', m_iva_g.cuenta_debe_id, 'debe', 0, 'haber', v_A, 'desc', 'IVA acreditable aplicado')) else '[]'::jsonb end;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'pago_impuesto', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', coalesce(fila.concepto, ''),
        'monto', fila.monto, 'debe', v_debe, 'haber', m_pago_imp.cuenta_haber_id, 'extra', v_extra));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== SALARIOS y APORTES PATRONALES =====================
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'pago_salario';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select p.* from public.empleados_pagos p where p.auth_user_id = u and p.estado = 'pagado' and p.fecha >= v_desde
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'pago_salario' and a.referencia_id = p.id)
                 order by p.fecha, p.created_at loop
      v_ret := 0;
      if m_ded.cuenta_haber_id is not null and jsonb_typeof(fila.deducciones_detalle) = 'array' then
        select round(coalesce(sum(case when (d ->> 'monto') ~ '^-?[0-9]+(\.[0-9]+)?$' then (d ->> 'monto')::numeric else 0 end), 0), 2) into v_ret
          from jsonb_array_elements(fila.deducciones_detalle) d
         where jsonb_typeof(d) = 'object' and ((d ->> 'esConcepto') = 'true' or coalesce(d ->> 'descripcion', '') ~* '\(autom[aá]tico\)');
      end if;
      v_monto := round(coalesce(fila.total_pagado, 0) + v_ret, 2);
      continue when v_monto <= 0;
      v_partes := case when v_ret > 0 then jsonb_build_array(jsonb_build_object('monto', v_ret, 'cuenta', m_ded.cuenta_haber_id, 'desc', 'Deducciones de ley por pagar')) else '[]'::jsonb end;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'pago_salario', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', 'Pago de salario',
        'monto', v_monto, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id, 'lado', 'haber', 'partes', v_partes));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'aporte_patronal';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select p.* from public.empleados_pagos p where p.auth_user_id = u and p.estado = 'pagado' and p.fecha >= v_desde and coalesce(p.aportes_patronales, 0) > 0
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'aporte_patronal' and a.referencia_id = p.id)
                 order by p.fecha, p.created_at loop
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'aporte_patronal', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', 'Aportes patronales',
        'monto', fila.aportes_patronales, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== FALTANTES / SOBRANTES (Caja Chica y entregas del Panel Microfinanciera) =====================
  foreach tp in array array['faltante_caja', 'sobrante_caja'] loop
    select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = tp;
    continue when m_m.id is null;
    if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1; continue; end if;
    for fila in select s.* from public.caja_chica_sesiones s where s.auth_user_id = u and s.estado = 'cerrada' and s.fecha >= v_desde
                   and ((tp = 'faltante_caja' and s.diferencia < 0) or (tp = 'sobrante_caja' and s.diferencia > 0))
                   and (coalesce((s.cerrada_en at time zone 'UTC')::date, s.fecha) >= c_inicio_caja)
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = tp and a.referencia_id = s.id)
                 order by s.fecha loop
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', tp, 'ref', fila.id, 'fecha', fila.fecha,
        'concepto', case when tp = 'faltante_caja' then 'Faltante de caja — cierre de Caja Chica' else 'Sobrante de caja — cierre de Caja Chica' end,
        'monto', abs(fila.diferencia), 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end loop;
  -- mora cobrada
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'mora_credito';
  if m_m.id is not null then
    if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
    else
      for fila in select s.* from public.mf_moras s where s.auth_user_id = u and s.estado = 'completado' and s.fecha >= v_desde
                     and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'mora_credito' and a.referencia_id = s.id)
                   order by s.fecha loop
        continue when round(coalesce(fila.cobrada, 0), 2) <= 0;
        r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'mora_credito', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', 'Mora por atraso cobrada — Panel Microfinanciera',
          'monto', fila.cobrada, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
        if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
      end loop;
    end if;
  end if;
  foreach tp in array array['faltante_caja', 'sobrante_caja'] loop
    select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = tp;
    continue when m_m.id is null or m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null;
    for fila in select s.* from public.mf_entregas s where s.auth_user_id = u and s.created_at >= v_desde_ts
                   and ((tp = 'faltante_caja' and s.diferencia < 0) or (tp = 'sobrante_caja' and s.diferencia > 0))
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = tp and a.referencia_id = s.id)
                 order by s.created_at loop
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', tp, 'ref', fila.id, 'fecha', (fila.created_at at time zone 'UTC')::date,
        'concepto', case when tp = 'faltante_caja' then 'Faltante en entrega de cobros — ' else 'Sobrante en entrega de cobros — ' end || coalesce(nullif(fila.cobrador_nombre, ''), 'cobrador'),
        'monto', abs(fila.diferencia), 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end loop;

  -- ===================== PRÉSTAMOS EN EFECTIVO e INTERESES =====================
  select exists (select 1 from public.movimientos_financieros where auth_user_id = u and tipo_movimiento = 'CREDITO_OTORGADO' and referencia_tipo = 'credito' and estado = 'completado') into v_hay_prest;
  if v_hay_prest then
    if m_pc.cuenta_debe_id is not null and m_pc.cuenta_haber_id is not null then
      for fila in select mf.id, mf.fecha, mf.monto, cr.numero_credito from public.movimientos_financieros mf
                    join public.creditos cr on cr.id = mf.referencia_id and cr.auth_user_id = u and cr.tipo = 'financiero' and cr.es_existente is not true
                   where mf.auth_user_id = u and mf.tipo_movimiento = 'CREDITO_OTORGADO' and mf.referencia_tipo = 'credito' and mf.estado = 'completado' and mf.fecha >= v_desde
                     and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'prestamo_otorgado' and a.referencia_id = mf.id)
                   order by mf.fecha, mf.created_at loop
        continue when round(coalesce(fila.monto, 0), 2) <= 0;
        r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'prestamo_otorgado', 'ref', fila.id, 'fecha', fila.fecha,
          'concepto', 'Préstamo entregado — ' || coalesce(nullif(fila.numero_credito, ''), 'crédito'), 'monto', fila.monto, 'debe', m_pc.cuenta_haber_id, 'haber', m_pc.cuenta_debe_id));
        if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
      end loop;
    else sin_conf := sin_conf + 1; end if;
    select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'interes_prestamo';
    if m_m.id is not null then
      if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
      else
        for fila in select mf.id, mf.fecha, cr.total_intereses, cr.numero_credito from public.movimientos_financieros mf
                      join public.creditos cr on cr.id = mf.referencia_id and cr.auth_user_id = u and cr.tipo = 'financiero' and cr.es_existente is not true
                     where mf.auth_user_id = u and mf.tipo_movimiento = 'CREDITO_OTORGADO' and mf.referencia_tipo = 'credito' and mf.estado = 'completado' and mf.fecha >= v_desde
                       and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'interes_prestamo' and a.referencia_id = mf.id)
                     order by mf.fecha, mf.created_at loop
          continue when round(coalesce(fila.total_intereses, 0), 2) <= 0;
          r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'interes_prestamo', 'ref', fila.id, 'fecha', fila.fecha,
            'concepto', 'Intereses del préstamo — ' || coalesce(nullif(fila.numero_credito, ''), 'crédito'), 'monto', fila.total_intereses, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
          if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
        end loop;
      end if;
    end if;
  end if;

  -- ===================== CUENTAS POR PAGAR y sus pagos =====================
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'cxp_generada';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select x.*, (select iva_monto from public.compras c where c.id = x.compra_id and c.auth_user_id = u) as iva_compra from public.cuentas_por_pagar x
                 where x.auth_user_id = u and x.estado <> 'anulado' and x.fecha_compra >= v_desde
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'cxp_generada' and a.referencia_id = x.id)
                 order by x.fecha_compra, x.created_at loop
      continue when round(coalesce(fila.monto_total, 0), 2) <= 0;
      if fila.clase_costo = 'servicio' then v_debe := m_costoserv.cuenta_debe_id; else v_debe := m_m.cuenta_debe_id; end if;
      if v_debe is null then sin_conf := sin_conf + 1; continue; end if;
      v_partes := '[]'::jsonb;
      if m_iva_g.cuenta_debe_id is not null and round(coalesce(fila.iva_compra, 0), 2) > 0 then
        v_partes := jsonb_build_array(jsonb_build_object('monto', round(fila.iva_compra, 2), 'cuenta', m_iva_g.cuenta_debe_id, 'desc', 'IVA'));
      end if;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'cxp_generada', 'ref', fila.id, 'fecha', fila.fecha_compra, 'concepto', 'Cuenta por pagar — ' || coalesce(fila.numero, ''),
        'monto', fila.monto_total, 'debe', v_debe, 'haber', m_m.cuenta_haber_id, 'lado', 'debe', 'partes', v_partes));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'pago_cxp';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select p.* from public.cuentas_por_pagar_pagos p where p.auth_user_id = u and p.created_at >= v_desde_ts
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'pago_cxp' and a.referencia_id = p.id)
                 order by p.created_at loop
      continue when round(coalesce(fila.monto, 0), 2) <= 0;
      v_ret := round(coalesce(fila.retencion_monto, 0), 2); v_partes := '[]'::jsonb;
      if v_ret > 0 then
        if m_ret_ir.cuenta_haber_id is null then sin_conf := sin_conf + 1; continue; end if;
        v_partes := jsonb_build_array(jsonb_build_object('monto', v_ret, 'cuenta', m_ret_ir.cuenta_haber_id, 'desc', 'IVA'));
      end if;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'pago_cxp', 'ref', fila.id, 'fecha', (fila.created_at at time zone 'UTC')::date, 'concepto', 'Pago a proveedor',
        'monto', fila.monto, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id, 'lado', 'haber', 'partes', v_partes));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== AJUSTES DE EXISTENCIA (con motivo y costo) =====================
  foreach tp in array array['ajuste_inventario_inicial', 'ajuste_inventario_entrada', 'ajuste_inventario_salida'] loop
    select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u
       and tipo_transaccion = case tp when 'ajuste_inventario_inicial' then 'inventario_inicial' else tp end;
    continue when m_m.id is null;
    if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1; continue; end if;
    for fila in select i.* from public.movimientos_inventario i
                 where i.auth_user_id = u and i.tipo = 'ajuste_manual' and i.razon <> 'edicion_producto' and i.costo_total is not null and i.created_at >= v_desde_ts
                   and ((tp = 'ajuste_inventario_inicial' and i.razon = 'inventario_inicial' and i.cantidad > 0)
                     or (tp = 'ajuste_inventario_entrada' and i.razon <> 'inventario_inicial' and i.cantidad > 0)
                     or (tp = 'ajuste_inventario_salida' and i.cantidad < 0))
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = tp and a.referencia_id = i.id)
                 order by i.created_at loop
      continue when round(abs(coalesce(fila.costo_total, 0)), 2) <= 0;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', tp, 'ref', fila.id, 'fecha', (fila.created_at at time zone 'UTC')::date,
        'concepto', case tp when 'ajuste_inventario_inicial' then 'Inventario inicial (cargado desde el producto)' when 'ajuste_inventario_entrada' then 'Ajuste de existencia (sube)' else 'Ajuste de existencia (baja)' end,
        'monto', abs(fila.costo_total), 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end loop;

  -- ===================== SALDOS DE APERTURA (siempre completos, sin rango) =====================
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'capital_inicial';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select mf.* from public.movimientos_financieros mf where mf.auth_user_id = u and mf.tipo_movimiento = 'CAPITAL_AGREGADO' and mf.estado = 'completado'
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'capital_inicial' and a.referencia_id = mf.id)
                 order by mf.fecha loop
      continue when round(coalesce(fila.monto, 0), 2) <= 0;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'capital_inicial', 'ref', fila.id, 'fecha', fila.fecha, 'concepto', 'Aporte de capital: ' || coalesce(fila.concepto, ''),
        'monto', fila.monto, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;
  select * into m_m from public.contabilidad_mapeo_cuentas where auth_user_id = u and tipo_transaccion = 'credito_existente';
  if m_m.cuenta_debe_id is null or m_m.cuenta_haber_id is null then sin_conf := sin_conf + 1;
  else
    for fila in select c.* from public.creditos c where c.auth_user_id = u and c.es_existente = true and c.estado <> 'anulado'
                   and not exists (select 1 from public.asientos_contables a where a.auth_user_id = u and a.origen = 'automatico' and a.referencia_tipo = 'credito_existente' and a.referencia_id = c.id)
                 order by c.created_at loop
      select round(coalesce(fila.saldo_pendiente, 0) + coalesce((select sum(p.monto) from public.creditos_pagos p where p.credito_id = fila.id and p.auth_user_id = u and p.estado = 'completado'), 0), 2) into v_tot;
      continue when v_tot <= 0;
      r := public._conta_srv_asiento(u, jsonb_build_object('tipo', 'credito_existente', 'ref', fila.id, 'fecha', (fila.created_at at time zone 'UTC')::date,
        'concepto', 'Saldo inicial de crédito existente ' || coalesce(fila.numero_credito, ''), 'monto', v_tot, 'debe', m_m.cuenta_debe_id, 'haber', m_m.cuenta_haber_id));
      if r = 1 then creados := creados + 1; elsif r = -1 then desbal := desbal + 1; end if;
    end loop;
  end if;

  -- ===================== ANULACIÓN AUTOMÁTICA (documentos anulados después del 14-oct-2026) =====================
  with a as (
    update public.asientos_contables ac set estado = 'anulado', anulado_en = now(), anulado_motivo = t.motivo || ' (anulado automáticamente)'
      from (values
        ('venta', 'ventas', 'Venta anulada'), ('credito_otorgado', 'ventas', 'Venta anulada'),
        ('gasto', 'gastos', 'Gasto cancelado'), ('compra', 'compras', 'Compra anulada'),
        ('cxp_generada', 'cuentas_por_pagar', 'Cuenta por pagar anulada (su compra se anuló)'),
        ('prestamo_otorgado', 'movimientos_financieros', 'Préstamo anulado (su salida de Caja se anuló)'),
        ('interes_prestamo', 'movimientos_financieros', 'Préstamo anulado (su salida de Caja se anuló)'),
        ('mora_credito', 'mf_moras', 'Mora anulada (se anuló su cobro)')) t(tipo, tabla, motivo)
     where ac.auth_user_id = u and ac.origen = 'automatico' and ac.estado = 'registrado' and ac.referencia_tipo = t.tipo
       and (
         (t.tabla = 'ventas' and exists (select 1 from public.ventas x where x.id = ac.referencia_id and x.auth_user_id = u and x.estado = 'anulada' and x.updated_at >= '2026-10-14T00:00:00Z'))
      or (t.tabla = 'gastos' and exists (select 1 from public.gastos x where x.id = ac.referencia_id and x.auth_user_id = u and x.estado = 'cancelado' and x.cancelado_en >= '2026-10-14T00:00:00Z'))
      or (t.tabla = 'compras' and exists (select 1 from public.compras x where x.id = ac.referencia_id and x.auth_user_id = u and x.estado = 'anulada' and x.anulada_en >= '2026-10-14T00:00:00Z'))
      or (t.tabla = 'cuentas_por_pagar' and exists (select 1 from public.cuentas_por_pagar x where x.id = ac.referencia_id and x.auth_user_id = u and x.estado = 'anulado'))
      or (t.tabla = 'movimientos_financieros' and exists (select 1 from public.movimientos_financieros x where x.id = ac.referencia_id and x.auth_user_id = u and x.tipo_movimiento = 'CREDITO_OTORGADO' and x.estado = 'anulado'))
      or (t.tabla = 'mf_moras' and exists (select 1 from public.mf_moras x where x.id = ac.referencia_id and x.auth_user_id = u and x.estado = 'anulado')))
    returning 1)
  select count(*) into anulados from a;

  -- Cuentas de dinero (Caja Chica y Bancos): si el negocio lo configuró, se vuelve a ubicar (no hace nada si no)
  begin perform public.contabilidad_ubicar_dinero(true); exception when others then null; end;

  insert into public.contabilidad_servidor_log(auth_user_id, creados, anulados, sin_configurar, omitidos_desbalance) values (u, creados, anulados, sin_conf, desbal);
  return jsonb_build_object('creados', creados, 'anulados', anulados, 'sin_configurar', sin_conf, 'omitidos_desbalance', desbal);
end $f$;
revoke all on function public.contabilidad_generar_servidor(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Recorre las cuentas con el interruptor encendido. Cada cuenta va aislada: si una falla, las demás siguen.
-- ---------------------------------------------------------------------
create or replace function public.contabilidad_generar_servidor_todas() returns integer
language plpgsql security definer set search_path = public as $f$
declare c record; n integer := 0;
begin
  for c in select auth_user_id from public.configuracion_empresa where contabilidad_servidor_auto = true and contabilidad_servidor_desde is not null loop
    begin
      perform public.contabilidad_generar_servidor(c.auth_user_id);
      n := n + 1;
    exception when others then
      insert into public.contabilidad_servidor_log(auth_user_id, error) values (c.auth_user_id, left(sqlerrm, 500));
    end;
  end loop;
  return n;
end $f$;
revoke all on function public.contabilidad_generar_servidor_todas() from public, anon, authenticated;

-- Tarea programada: cada 5 minutos. Mientras ninguna cuenta tenga el interruptor encendido, no hace nada.
do $c$ begin
  if not exists (select 1 from cron.job where jobname = 'contabilidad-automatica-servidor') then
    perform cron.schedule('contabilidad-automatica-servidor', '*/5 * * * *', 'select public.contabilidad_generar_servidor_todas()');
  end if;
end $c$;
