-- =====================================================================
-- CERTIFICADOS DE REGALO (gift cards) · Fecha: 23-oct-2026 · Solo AGREGA.
--
-- Monto libre. Cada certificado elige:
--   * modo:
--       'anticipo'  cobrado por adelantado: el dinero entra a Caja HOY como
--                   ingreso ligado al certificado (no es venta todavía); la
--                   venta se reconoce cuando se USA, y ahí NO entra dinero
--                   otra vez (el certificado funciona como forma de pago).
--       'venta'     se cobra como VENTA en Ventas al emitirlo (cuenta como
--                   venta ese día); al usarlo funciona como DESCUENTO, para
--                   no contar la venta dos veces.
--       'cortesia'  regalo del negocio: no entra dinero; al usarlo funciona
--                   como DESCUENTO.
--   * uso_parcial: true = se puede usar por partes; false = se usa una sola
--     vez (lo que sobre se pierde, y la pantalla lo avisa antes).
--   * fecha_vence: null = no vence.
--
-- Sin descuadres:
--   * El saldo del certificado SOLO lo cambia la base (funciones y
--     disparadores); la página no puede escribirlo.
--   * Usar un certificado va DENTRO de la misma operación que guarda la
--     venta (disparador en ventas): o se guarda todo o nada. Si la venta se
--     anula, el saldo vuelve al certificado.
--   * Caja guarda las ventas SIN IVA (el IVA va a Impuestos). Si un
--     certificado cobrado por adelantado paga una venta con IVA, la parte de
--     IVA sale de Caja hacia Impuestos con un movimiento propio, para que la
--     suma Caja + Impuestos sea igual al dinero real.
--   * Los movimientos de Caja del certificado van ligados (referencia_tipo
--     'certificado' / 'certificado_venta'): Reportes no los cuenta como
--     "otros ingresos" y la anulación de ventas no los duplica.
-- =====================================================================

alter table public.configuracion_empresa add column if not exists usa_modulo_certificados boolean not null default false;
alter table public.ventas add column if not exists certificados_aplicados jsonb;   -- [{certificado_id, monto}]
alter table public.ventas add column if not exists certificado_emision_id uuid;    -- venta que cobra un certificado (modo 'venta')

create table if not exists public.certificados_regalo (
  id                      uuid primary key default gen_random_uuid(),
  auth_user_id            uuid not null default auth.uid(),
  codigo                  text not null check (codigo ~ '^[A-Z0-9-]{4,30}$'),
  monto_original          numeric(14,2) not null check (monto_original > 0),
  saldo                   numeric(14,2) not null check (saldo >= 0),
  modo                    text not null check (modo in ('anticipo','venta','cortesia')),
  uso_parcial             boolean not null default true,
  fecha_emision           date not null default ((now() at time zone 'America/Managua')::date),
  fecha_vence             date,
  comprador_nombre        text,
  comprador_cliente_id    uuid references public.clientes(id) on delete set null,
  beneficiario_nombre     text,
  beneficiario_cliente_id uuid references public.clientes(id) on delete set null,
  mensaje                 text,
  estado                  text not null default 'activo' check (estado in ('pendiente_cobro','activo','agotado','anulado')),
  metodo_pago_id          uuid,
  metodo_pago_nombre      text,
  banco_id                uuid,
  movimiento_caja_id      uuid,
  venta_emision_id        uuid references public.ventas(id) on delete set null,
  creado_por              text,
  anulado_motivo          text,
  anulado_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (auth_user_id, codigo),
  check (saldo <= monto_original)
);
create index if not exists certificados_regalo_user_idx on public.certificados_regalo(auth_user_id, created_at desc);

create table if not exists public.certificados_regalo_movimientos (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid not null,
  certificado_id uuid not null references public.certificados_regalo(id) on delete cascade,
  tipo           text not null check (tipo in ('emision','activacion','canje','reverso_canje','anulacion')),
  monto          numeric(14,2) not null default 0,   -- lo aplicado a la venta
  consumido      numeric(14,2) not null default 0,   -- lo que bajó (o subió) el saldo
  saldo_antes    numeric(14,2),
  saldo_despues  numeric(14,2),
  venta_id       uuid references public.ventas(id) on delete set null,
  venta_numero   text,
  observacion    text,
  creado_por     text,
  created_at     timestamptz not null default now()
);
create index if not exists certificados_mov_cert_idx  on public.certificados_regalo_movimientos(certificado_id, created_at);
create index if not exists certificados_mov_venta_idx on public.certificados_regalo_movimientos(venta_id) where venta_id is not null;

-- La página solo puede LEER; todo cambio pasa por las funciones de abajo.
alter table public.certificados_regalo enable row level security;
alter table public.certificados_regalo_movimientos enable row level security;
drop policy if exists certificados_regalo_leer on public.certificados_regalo;
create policy certificados_regalo_leer on public.certificados_regalo for select using (auth_user_id = auth.uid());
drop policy if exists certificados_mov_leer on public.certificados_regalo_movimientos;
create policy certificados_mov_leer on public.certificados_regalo_movimientos for select using (auth_user_id = auth.uid());
grant select on public.certificados_regalo, public.certificados_regalo_movimientos to authenticated;

create or replace function public._hoy_managua() returns date language sql stable as $$ select (now() at time zone 'America/Managua')::date $$;

-- Fecha calendario de una venta (las ventas guardan el día como medianoche universal)
create or replace function public._fecha_de_venta(p timestamptz) returns date language sql immutable as $$
  select case when (p at time zone 'UTC')::time = '00:00' then (p at time zone 'UTC')::date else (p at time zone 'America/Managua')::date end
$$;

-- ---------------------------------------------------------------------
-- Emitir un certificado
-- p: {monto, modo, uso_parcial, fecha_vence, codigo?, comprador_nombre, comprador_cliente_id,
--     beneficiario_nombre, beneficiario_cliente_id, mensaje, creado_por,
--     metodo_pago_id, metodo_pago_nombre, banco_id, monto_moneda_banco}   (método solo en 'anticipo')
-- ---------------------------------------------------------------------
create or replace function public.certificado_emitir(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_monto numeric; v_modo text; v_codigo text; v_vence date; v_id uuid; v_mov uuid;
  v_metodo_id uuid; v_metodo text; v_banco uuid; v_i integer := 0;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  v_monto := round(coalesce(nullif(p->>'monto','')::numeric, 0), 2);
  v_modo  := coalesce(p->>'modo', '');
  if v_monto <= 0 then raise exception 'Escribe el monto del certificado.' using errcode = 'P0001'; end if;
  if v_monto > 10000000 then raise exception 'El monto es demasiado alto.' using errcode = 'P0001'; end if;
  if v_modo not in ('anticipo','venta','cortesia') then raise exception 'Elige cómo se registra el certificado.' using errcode = 'P0001'; end if;
  v_vence := nullif(p->>'fecha_vence','')::date;
  if v_vence is not null and v_vence < _hoy_managua() then raise exception 'La fecha de vencimiento ya pasó.' using errcode = 'P0001'; end if;
  if nullif(p->>'comprador_cliente_id','') is not null and not exists (select 1 from clientes where id = (p->>'comprador_cliente_id')::uuid and auth_user_id = v_uid) then
    raise exception 'Cliente no encontrado.' using errcode = 'P0001'; end if;
  if nullif(p->>'beneficiario_cliente_id','') is not null and not exists (select 1 from clientes where id = (p->>'beneficiario_cliente_id')::uuid and auth_user_id = v_uid) then
    raise exception 'Cliente no encontrado.' using errcode = 'P0001'; end if;

  v_codigo := upper(trim(coalesce(p->>'codigo','')));
  if v_codigo <> '' then
    if v_codigo !~ '^[A-Z0-9-]{4,30}$' then raise exception 'El código solo puede tener letras, números y guiones (de 4 a 30).' using errcode = 'P0001'; end if;
    if exists (select 1 from certificados_regalo where auth_user_id = v_uid and codigo = v_codigo) then
      raise exception 'Ya existe un certificado con el código %.', v_codigo using errcode = 'P0001'; end if;
  else
    loop
      v_i := v_i + 1;
      v_codigo := 'GC-' || upper(substr(md5(random()::text || clock_timestamp()::text || v_uid::text), 1, 6));
      exit when length(v_codigo) = 9 and not exists (select 1 from certificados_regalo where auth_user_id = v_uid and codigo = v_codigo);
      if v_i > 50 then raise exception 'No se pudo generar el código, intenta de nuevo.'; end if;
    end loop;
  end if;

  if v_modo = 'anticipo' then
    v_metodo := nullif(trim(coalesce(p->>'metodo_pago_nombre','')), '');
    v_metodo_id := nullif(p->>'metodo_pago_id','')::uuid;
    v_banco := nullif(p->>'banco_id','')::uuid;
    if v_metodo is null then raise exception 'Elige con qué pagó el cliente.' using errcode = 'P0001'; end if;
    if v_metodo_id is not null and not exists (select 1 from metodos_pago where id = v_metodo_id and auth_user_id = v_uid) then
      raise exception 'Método de pago no encontrado.' using errcode = 'P0001'; end if;
    if v_banco is not null and not exists (select 1 from bancos where id = v_banco and auth_user_id = v_uid) then
      raise exception 'Banco no encontrado.' using errcode = 'P0001'; end if;
  end if;

  insert into certificados_regalo (auth_user_id, codigo, monto_original, saldo, modo, uso_parcial, fecha_vence,
        comprador_nombre, comprador_cliente_id, beneficiario_nombre, beneficiario_cliente_id, mensaje, estado,
        metodo_pago_id, metodo_pago_nombre, banco_id, creado_por)
  values (v_uid, v_codigo, v_monto, v_monto, v_modo, coalesce((p->>'uso_parcial')::boolean, true), v_vence,
        nullif(trim(coalesce(p->>'comprador_nombre','')),''), nullif(p->>'comprador_cliente_id','')::uuid,
        nullif(trim(coalesce(p->>'beneficiario_nombre','')),''), nullif(p->>'beneficiario_cliente_id','')::uuid,
        nullif(trim(coalesce(p->>'mensaje','')),''),
        case when v_modo = 'venta' then 'pendiente_cobro' else 'activo' end,
        v_metodo_id, v_metodo, v_banco, nullif(p->>'creado_por',''))
  returning id into v_id;

  if v_modo = 'anticipo' then
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_id, metodo_pago_nombre, banco_id, monto_moneda_banco,
                                         referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, 'INGRESO', 'OTRO_INGRESO', 'Certificado de regalo ' || v_codigo || ' — cobrado por adelantado', v_monto, 0, 0,
            v_metodo_id, v_metodo, v_banco, case when v_banco is not null then nullif(p->>'monto_moneda_banco','')::numeric end,
            'certificado', v_id, 'Se reconoce como venta cuando el cliente lo use', _hoy_managua(), 'completado')
    returning id into v_mov;
    update certificados_regalo set movimiento_caja_id = v_mov where id = v_id;
  end if;

  insert into certificados_regalo_movimientos (auth_user_id, certificado_id, tipo, monto, consumido, saldo_antes, saldo_despues, observacion, creado_por)
  values (v_uid, v_id, 'emision', v_monto, 0, 0, v_monto,
          case v_modo when 'anticipo' then 'Cobrado por adelantado (' || v_metodo || ')' when 'venta' then 'Pendiente de cobrar en Ventas' else 'Cortesía del negocio' end,
          nullif(p->>'creado_por',''));

  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'estado', case when v_modo = 'venta' then 'pendiente_cobro' else 'activo' end);
end $$;
revoke all on function public.certificado_emitir(jsonb) from public, anon;
grant execute on function public.certificado_emitir(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Anular un certificado que NO se ha usado.
-- p_devolver: en 'anticipo', true = se devuelve el dinero (sale de Caja).
-- ---------------------------------------------------------------------
create or replace function public.certificado_anular(p_id uuid, p_motivo text, p_devolver boolean default false, p_creado_por text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c record; v_num text; v_dev uuid;
begin
  if v_uid is null then raise exception 'Sin sesión activa'; end if;
  select * into c from certificados_regalo where id = p_id and auth_user_id = v_uid for update;
  if not found then raise exception 'Certificado no encontrado.' using errcode = 'P0001'; end if;
  if c.estado = 'anulado' then return jsonb_build_object('ya_anulado', true); end if;
  if trim(coalesce(p_motivo,'')) = '' then raise exception 'Escribe el motivo.' using errcode = 'P0001'; end if;
  if c.saldo < c.monto_original or exists (select 1 from certificados_regalo_movimientos m where m.certificado_id = c.id and m.tipo = 'canje'
        and not exists (select 1 from certificados_regalo_movimientos r where r.certificado_id = c.id and r.tipo = 'reverso_canje' and r.venta_id = m.venta_id)) then
    raise exception 'Este certificado ya se usó; no se puede anular.' using errcode = 'P0001';
  end if;
  if c.modo = 'venta' and c.estado = 'activo' then
    select numero_venta into v_num from ventas where id = c.venta_emision_id;
    raise exception 'Este certificado se cobró como venta (%): anula esa venta en Ventas y el certificado se anula solo.', coalesce(v_num, '—') using errcode = 'P0001';
  end if;
  if c.modo = 'anticipo' and coalesce(p_devolver, false) then
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_id, metodo_pago_nombre, banco_id, referencia_tipo, referencia_id, observaciones, fecha, estado)
    values (v_uid, 'EGRESO', 'OTRO_EGRESO', 'Devolución del certificado de regalo ' || c.codigo, c.saldo, 0, 0,
            c.metodo_pago_id, c.metodo_pago_nombre, c.banco_id, 'certificado', c.id, trim(p_motivo), _hoy_managua(), 'completado')
    returning id into v_dev;
  end if;
  update certificados_regalo set estado = 'anulado', saldo = 0, anulado_motivo = trim(p_motivo), anulado_at = now(), updated_at = now() where id = c.id;
  insert into certificados_regalo_movimientos (auth_user_id, certificado_id, tipo, monto, consumido, saldo_antes, saldo_despues, observacion, creado_por)
  values (v_uid, c.id, 'anulacion', 0, c.saldo, c.saldo, 0,
          trim(p_motivo) || case when v_dev is not null then ' · dinero devuelto' when c.modo = 'anticipo' then ' · sin devolución de dinero' else '' end, p_creado_por);
  return jsonb_build_object('ya_anulado', false, 'devuelto', v_dev is not null);
end $$;
revoke all on function public.certificado_anular(uuid, text, boolean, text) from public, anon;
grant execute on function public.certificado_anular(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Disparador: al GUARDAR una venta (misma operación que la venta)
-- ---------------------------------------------------------------------
create or replace function public._certificados_al_insertar_venta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := new.auth_user_id; e jsonb; c record; v_monto numeric; v_cons numeric;
  v_anticipo numeric := 0; v_desc numeric := 0; v_caja numeric; v_def numeric; v_hoy date := _hoy_managua();
  v_vistos uuid[] := '{}';
begin
  -- 1) Venta que COBRA un certificado (modo 'venta'): lo activa
  if new.certificado_emision_id is not null then
    select * into c from certificados_regalo where id = new.certificado_emision_id and auth_user_id = v_uid for update;
    if not found then raise exception 'Certificado de regalo no encontrado.' using errcode = 'P0001'; end if;
    if c.estado <> 'pendiente_cobro' then raise exception 'El certificado % ya fue cobrado o anulado.', c.codigo using errcode = 'P0001'; end if;
    if round(coalesce(new.total,0), 2) < c.monto_original - 0.005 then
      raise exception 'La venta (%) es menor que el certificado % (%).', round(coalesce(new.total,0),2), c.codigo, c.monto_original using errcode = 'P0001'; end if;
    update certificados_regalo set estado = 'activo', venta_emision_id = new.id, updated_at = now() where id = c.id;
    insert into certificados_regalo_movimientos (auth_user_id, certificado_id, tipo, monto, consumido, saldo_antes, saldo_despues, venta_id, venta_numero, observacion, creado_por)
    values (v_uid, c.id, 'activacion', c.monto_original, 0, c.saldo, c.saldo, new.id, new.numero_venta, 'Cobrado como venta', new.creado_por_nombre);
  end if;

  -- 2) Venta PAGADA (en todo o en parte) con certificados
  if new.certificados_aplicados is not null and jsonb_typeof(new.certificados_aplicados) = 'array' then
    for e in select * from jsonb_array_elements(new.certificados_aplicados) loop
      v_monto := round(coalesce(nullif(e->>'monto','')::numeric, 0), 2);
      if v_monto <= 0 then continue; end if;
      select * into c from certificados_regalo where id = nullif(e->>'certificado_id','')::uuid and auth_user_id = v_uid for update;
      if not found then raise exception 'Certificado de regalo no encontrado.' using errcode = 'P0001'; end if;
      if c.id = any(v_vistos) then raise exception 'El certificado % está dos veces en la venta.', c.codigo using errcode = 'P0001'; end if;
      v_vistos := v_vistos || c.id;
      if c.estado = 'anulado' then raise exception 'El certificado % fue anulado.', c.codigo using errcode = 'P0001'; end if;
      if c.estado = 'pendiente_cobro' then raise exception 'El certificado % todavía no se ha cobrado.', c.codigo using errcode = 'P0001'; end if;
      if c.estado = 'agotado' or c.saldo <= 0 then raise exception 'El certificado % ya no tiene saldo.', c.codigo using errcode = 'P0001'; end if;
      if c.fecha_vence is not null and c.fecha_vence < v_hoy then raise exception 'El certificado % venció el %.', c.codigo, to_char(c.fecha_vence, 'DD/MM/YYYY') using errcode = 'P0001'; end if;
      if v_monto > c.saldo + 0.005 then raise exception 'El certificado % solo tiene % de saldo.', c.codigo, c.saldo using errcode = 'P0001'; end if;
      v_monto := least(v_monto, c.saldo);
      v_cons := case when c.uso_parcial then v_monto else c.saldo end;
      update certificados_regalo set saldo = round(saldo - v_cons, 2), estado = case when round(saldo - v_cons, 2) <= 0 then 'agotado' else 'activo' end, updated_at = now()
       where id = c.id;
      insert into certificados_regalo_movimientos (auth_user_id, certificado_id, tipo, monto, consumido, saldo_antes, saldo_despues, venta_id, venta_numero, observacion, creado_por)
      values (v_uid, c.id, 'canje', v_monto, v_cons, c.saldo, round(c.saldo - v_cons, 2), new.id, new.numero_venta,
              case when v_cons > v_monto then 'Uso único: se perdió el saldo restante (' || round(v_cons - v_monto, 2) || ')' end, new.creado_por_nombre);
      if c.modo = 'anticipo' then v_anticipo := v_anticipo + v_monto; else v_desc := v_desc + v_monto; end if;
    end loop;

    -- Los certificados de venta/cortesía deben estar dentro del descuento de la venta
    if v_desc > coalesce(new.descuento, 0) + 0.01 then
      raise exception 'El certificado de regalo debe aplicarse como descuento de la venta.' using errcode = 'P0001'; end if;
    if v_anticipo > coalesce(new.total, 0) + 0.01 then
      raise exception 'El certificado no puede pagar más que el total de la venta.' using errcode = 'P0001'; end if;

    -- IVA/retención de la parte pagada con certificado cobrado por adelantado: ese dinero
    -- ya está en Caja completo; la parte de impuestos pasa a Impuestos (sale de Caja).
    v_caja := round(coalesce(new.total,0) - coalesce(new.impuesto,0) - coalesce(new.retencion_ir_monto,0), 2);
    v_def := round(v_anticipo - v_caja, 2);
    if v_def > 0.005 then
      insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                           metodo_pago_nombre, referencia_tipo, referencia_id, observaciones, fecha, estado)
      values (v_uid, 'EGRESO', 'OTRO_EGRESO', 'Impuestos de la venta ' || coalesce(new.numero_venta,'') || ' pagada con certificado de regalo', v_def, 0, 0,
              'Certificado de regalo', 'certificado_venta', new.id, 'El dinero entró a Caja al vender el certificado; esta parte corresponde a impuestos',
              coalesce(_fecha_de_venta(new.fecha), v_hoy), 'completado');
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Disparador: al ANULAR una venta (misma operación que la anulación)
-- ---------------------------------------------------------------------
create or replace function public._certificados_al_anular_venta()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := new.auth_user_id; m record; c record; x record;
begin
  -- a) La venta usó certificados: el saldo vuelve
  for m in select * from certificados_regalo_movimientos mv
            where mv.venta_id = new.id and mv.auth_user_id = v_uid and mv.tipo = 'canje'
              and not exists (select 1 from certificados_regalo_movimientos r where r.certificado_id = mv.certificado_id and r.venta_id = new.id and r.tipo = 'reverso_canje')
  loop
    select * into c from certificados_regalo where id = m.certificado_id for update;
    if c.estado = 'anulado' then continue; end if;
    update certificados_regalo set saldo = least(monto_original, round(saldo + m.consumido, 2)), estado = 'activo', updated_at = now() where id = c.id;
    insert into certificados_regalo_movimientos (auth_user_id, certificado_id, tipo, monto, consumido, saldo_antes, saldo_despues, venta_id, venta_numero, observacion)
    values (v_uid, c.id, 'reverso_canje', m.monto, m.consumido, c.saldo, least(c.monto_original, round(c.saldo + m.consumido, 2)), new.id, new.numero_venta, 'Venta anulada: el saldo vuelve al certificado');
  end loop;
  -- b) Movimiento de impuestos de esa venta: se compensa (una sola vez)
  for x in select * from movimientos_financieros
            where auth_user_id = v_uid and referencia_tipo = 'certificado_venta' and referencia_id = new.id and tipo_flujo = 'EGRESO' and estado = 'completado'
              and not exists (select 1 from movimientos_financieros y where y.auth_user_id = v_uid and y.referencia_tipo = 'certificado_venta' and y.referencia_id = new.id and y.tipo_flujo = 'INGRESO')
  loop
    insert into movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante,
                                         metodo_pago_nombre, referencia_tipo, referencia_id, fecha, estado)
    values (v_uid, 'INGRESO', 'OTRO_INGRESO', 'Reverso: impuestos de la venta ' || coalesce(new.numero_venta,'') || ' (venta anulada)', x.monto, 0, 0,
            'Certificado de regalo', 'certificado_venta', new.id, _hoy_managua(), 'completado');
  end loop;
  -- c) La venta COBRÓ un certificado: se anula el certificado (si no se ha usado)
  for c in select * from certificados_regalo where venta_emision_id = new.id and auth_user_id = v_uid and estado <> 'anulado' for update loop
    if c.saldo < c.monto_original then
      raise exception 'No se puede anular: el certificado de regalo % de esta venta ya se usó.', c.codigo using errcode = 'P0001'; end if;
    update certificados_regalo set estado = 'anulado', saldo = 0, anulado_motivo = 'Se anuló la venta ' || coalesce(new.numero_venta,''), anulado_at = now(), updated_at = now() where id = c.id;
    insert into certificados_regalo_movimientos (auth_user_id, certificado_id, tipo, monto, consumido, saldo_antes, saldo_despues, venta_id, venta_numero, observacion)
    values (v_uid, c.id, 'anulacion', 0, c.saldo, c.saldo, 0, new.id, new.numero_venta, 'Se anuló la venta con que se cobró');
  end loop;
  return new;
end $$;

drop trigger if exists trg_certificados_venta_insert on public.ventas;
create trigger trg_certificados_venta_insert after insert on public.ventas
  for each row when (new.certificados_aplicados is not null or new.certificado_emision_id is not null)
  execute function public._certificados_al_insertar_venta();

drop trigger if exists trg_certificados_venta_anulada on public.ventas;
create trigger trg_certificados_venta_anulada after update of estado on public.ventas
  for each row when (new.estado = 'anulada' and old.estado is distinct from 'anulada')
  execute function public._certificados_al_anular_venta();

revoke all on function public._certificados_al_insertar_venta() from public, anon, authenticated;
revoke all on function public._certificados_al_anular_venta() from public, anon, authenticated;

-- Revisión de seguridad (advisor): ruta de búsqueda fija en las funciones de fecha
alter function public._hoy_managua() set search_path = public;
alter function public._fecha_de_venta(timestamptz) set search_path = public;
