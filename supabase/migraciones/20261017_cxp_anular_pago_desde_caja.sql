-- =====================================================================
-- CUENTAS POR PAGAR — anular en Caja un pago a proveedor ahora lo deshace
-- también en Cuentas por pagar. 17-oct-2026 · Solo agrega, no cambia datos existentes.
--
-- PROBLEMA REAL (All Plastic Comercial, 2-oct): se registró 3 veces un pago de C$812
-- y dos se anularon en Caja; pero las cuentas CXP-000010 y CXP-000011 siguieron
-- "pagadas" (anular en Caja no tocaba Cuentas por pagar) y después se pagaron
-- saldos que ya restaban esos C$812 → al proveedor se le quedaron debiendo C$1,624
-- sin que el sistema lo mostrara.
--
-- AHORA, al anular en Caja un EGRESO de un pago a proveedor (referencia_tipo
-- 'cuenta_por_pagar'), en la MISMA transacción:
--   · se ubica su pago (misma cuenta, mismo monto o monto neto de retención,
--     guardado a menos de 2 minutos del egreso);
--   · la deuda vuelve a subir por ese pago (cuenta y cuotas), la cuenta vuelve a
--     pendiente/vencido y su compra a "pendiente";
--   · se anula su asiento de pago y su retención de IR si aún estaba pendiente;
--   · el pago pasa al historial cuentas_por_pagar_pagos_anulados (no se pierde).
-- Si no se puede identificar el pago con seguridad, NO deja anular y lo explica.
-- =====================================================================

create table if not exists public.cuentas_por_pagar_pagos_anulados (
  id uuid primary key,
  auth_user_id uuid not null,
  cuenta_id uuid,
  monto numeric,
  pago jsonb not null,
  movimiento_caja_id uuid,
  motivo text,
  anulado_en timestamptz not null default now()
);
alter table public.cuentas_por_pagar_pagos_anulados enable row level security;
drop policy if exists cxp_pagos_anulados_propios on public.cuentas_por_pagar_pagos_anulados;
create policy cxp_pagos_anulados_propios on public.cuentas_por_pagar_pagos_anulados
  for select using (auth_user_id = auth.uid());

create or replace function public.cxp_pago_anular_desde_caja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record; p record; cu record; n int;
  resto numeric; quitar numeric; hoy date := (now() at time zone 'America/Managua')::date;
  nuevo_saldo numeric; nuevo_pagado numeric; nuevo_estado text;
begin
  if new.estado <> 'anulado' or old.estado <> 'completado' or new.tipo_flujo <> 'EGRESO'
     or new.referencia_tipo is distinct from 'cuenta_por_pagar' or new.referencia_id is null then
    return null;
  end if;

  select * into c from public.cuentas_por_pagar
   where id = new.referencia_id and auth_user_id = new.auth_user_id for update;
  if not found or c.estado = 'anulado' then return null; end if;

  -- El pago de este egreso: misma cuenta, monto igual (o neto de retención), guardado cerca del egreso
  select count(*) into n from public.cuentas_por_pagar_pagos x
   where x.cuenta_id = c.id and x.auth_user_id = new.auth_user_id
     and (round(x.monto, 2) = round(new.monto, 2) or round(x.monto - coalesce(x.retencion_monto, 0), 2) = round(new.monto, 2))
     and x.created_at between new.created_at - interval '2 minutes' and new.created_at + interval '2 minutes';
  if n <> 1 then
    raise exception 'No se puede anular este pago desde Caja: no se pudo identificar con seguridad su pago en Cuentas por pagar (%). Avisa a soporte.', c.numero
      using errcode = 'P0001';
  end if;
  select * into p from public.cuentas_por_pagar_pagos x
   where x.cuenta_id = c.id and x.auth_user_id = new.auth_user_id
     and (round(x.monto, 2) = round(new.monto, 2) or round(x.monto - coalesce(x.retencion_monto, 0), 2) = round(new.monto, 2))
     and x.created_at between new.created_at - interval '2 minutes' and new.created_at + interval '2 minutes'
   for update;

  -- 1) La deuda vuelve a subir por el monto del pago
  nuevo_pagado := greatest(0, round(coalesce(c.monto_pagado, 0) - p.monto, 2));
  nuevo_saldo  := round(coalesce(c.saldo_pendiente, 0) + p.monto, 2);
  nuevo_estado := case when nuevo_saldo <= 0.01 then 'pagado'
                       when c.fecha_vencimiento is not null and c.fecha_vencimiento < hoy then 'vencido'
                       else 'pendiente' end;
  update public.cuentas_por_pagar
     set monto_pagado = nuevo_pagado, saldo_pendiente = nuevo_saldo, estado = nuevo_estado, updated_at = now()
   where id = c.id;

  -- 2) Cuotas: se devuelve lo pagado empezando por la cuota más reciente
  resto := p.monto;
  for cu in select * from public.cuentas_por_pagar_cuotas
             where cuenta_id = c.id and coalesce(monto_pagado, 0) > 0 order by numero desc for update loop
    exit when resto <= 0;
    quitar := least(resto, cu.monto_pagado);
    update public.cuentas_por_pagar_cuotas
       set monto_pagado = round(cu.monto_pagado - quitar, 2),
           saldo = round(cu.monto_total - (cu.monto_pagado - quitar), 2),
           estado = case when cu.monto_pagado - quitar <= 0.01 then 'pendiente' else 'parcial' end,
           updated_at = now()
     where id = cu.id;
    resto := round(resto - quitar, 2);
  end loop;

  -- 3) La compra deja de verse "completada" si la deuda ya no está pagada
  if c.compra_id is not null and nuevo_estado <> 'pagado' then
    update public.compras set estado = 'pendiente', updated_at = now()
     where id = c.compra_id and estado = 'completada';
  end if;

  -- 4) Asiento del pago y retención de IR pendiente
  update public.asientos_contables
     set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Pago a proveedor anulado en Caja (anulado automáticamente)'
   where auth_user_id = new.auth_user_id and referencia_tipo = 'pago_cxp' and referencia_id = p.id
     and origen = 'automatico' and estado = 'registrado';
  update public.retenciones_ir set estado = 'anulada'
   where cxp_pago_id = p.id and auth_user_id = new.auth_user_id and estado = 'pendiente';

  -- 5) El pago pasa al historial de anulados
  insert into public.cuentas_por_pagar_pagos_anulados(id, auth_user_id, cuenta_id, monto, pago, movimiento_caja_id, motivo)
  values (p.id, p.auth_user_id, p.cuenta_id, p.monto, to_jsonb(p), new.id, coalesce(new.anulado_motivo, 'Anulado en Caja'));
  delete from public.cuentas_por_pagar_pagos where id = p.id;

  return null;
end;
$$;

drop trigger if exists trg_mf_cxp_pago_anulado on public.movimientos_financieros;
create trigger trg_mf_cxp_pago_anulado
  after update of estado on public.movimientos_financieros
  for each row when (old.estado is distinct from new.estado and new.estado = 'anulado')
  execute function public.cxp_pago_anular_desde_caja();
