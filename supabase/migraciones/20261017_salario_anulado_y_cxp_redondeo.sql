-- =====================================================================
-- SALARIOS + CUENTAS POR PAGAR — 17-oct-2026 · Solo agrega, no borra nada
--
-- 1) PROBLEMA REAL (auditoría Mayorista): un pago de salario anulado desde
--    Caja (la única forma de anularlo) dejaba el pago del empleado como
--    "pagado" para siempre: Salarios, Reportes y el historial del empleado
--    seguían mostrando un pago que no se hizo (3 casos, C$13,500).
--    AHORA: al anular en Caja el egreso de un salario, el pago del empleado
--    queda "anulado", sus adelantos descontados vuelven a "pendiente" y sus
--    asientos (salario y aportes) se anulan. Todo en la misma transacción
--    que la anulación de Caja.
--    · Solo actúa si el egreso apunta a un pago de empleados_pagos y ya no
--      queda ningún otro egreso vivo de ese mismo pago.
--
-- 2) PROBLEMA REAL: algunas cuentas por pagar guardaban montos con 3 o más
--    decimales (ej. 90,835.395 · 45,327.70999999999) y Contabilidad
--    (2 decimales) quedaba C$0.01 distinta. AHORA la base redondea a 2
--    decimales los montos de cuentas por pagar, sus cuotas y sus pagos al
--    guardarlos (igual que ya hacen compras y asientos).
-- =====================================================================

-- ---------- 1) Salario anulado ----------
alter table public.empleados_pagos drop constraint if exists empleados_pagos_estado_check;
alter table public.empleados_pagos add constraint empleados_pagos_estado_check
  check (estado = any (array['pagado'::text, 'pendiente'::text, 'anulado'::text]));

create or replace function public.salario_anular_desde_caja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  if new.estado <> 'anulado' or old.estado <> 'completado'
     or new.referencia_tipo is distinct from 'salario' or new.referencia_id is null then
    return null;
  end if;

  select * into p from public.empleados_pagos
   where id = new.referencia_id and auth_user_id = new.auth_user_id and estado = 'pagado'
   for update;
  if not found then return null; end if;

  -- Si ese pago todavía tiene otro egreso vivo, no se toca.
  if exists (select 1 from public.movimientos_financieros m
              where m.referencia_tipo = 'salario' and m.referencia_id = p.id
                and m.auth_user_id = new.auth_user_id and m.estado = 'completado' and m.id <> new.id) then
    return null;
  end if;

  update public.empleados_pagos
     set estado = 'anulado',
         observaciones = trim(both ' ' from coalesce(observaciones, '') || ' [Anulado desde Caja: ' || coalesce(new.anulado_motivo, 'sin motivo') || ']')
   where id = p.id;

  update public.empleados_adelantos
     set estado = 'pendiente', pago_id = null
   where pago_id = p.id and auth_user_id = new.auth_user_id and estado = 'descontado';

  update public.asientos_contables
     set estado = 'anulado', anulado_en = now(), anulado_motivo = 'Pago de salario anulado en Caja (anulado automáticamente)'
   where auth_user_id = new.auth_user_id and referencia_id = p.id and origen = 'automatico'
     and referencia_tipo in ('pago_salario', 'aporte_patronal') and estado = 'registrado';

  return null;
end;
$$;

drop trigger if exists trg_mf_salario_anulado on public.movimientos_financieros;
create trigger trg_mf_salario_anulado
  after update of estado on public.movimientos_financieros
  for each row when (old.estado is distinct from new.estado and new.estado = 'anulado')
  execute function public.salario_anular_desde_caja();

-- ---------- 2) Redondeo a 2 decimales en cuentas por pagar ----------
create or replace function public.cxp_redondear_montos()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'cuentas_por_pagar' then
    new.monto_total     := round(new.monto_total, 2);
    new.monto_pagado    := round(new.monto_pagado, 2);
    new.saldo_pendiente := round(new.saldo_pendiente, 2);
    new.monto_original  := round(new.monto_original, 2);
    new.prima_monto     := round(new.prima_monto, 2);
  elsif tg_table_name = 'cuentas_por_pagar_cuotas' then
    new.monto_total  := round(new.monto_total, 2);
    new.monto_pagado := round(new.monto_pagado, 2);
    new.saldo        := round(new.saldo, 2);
  elsif tg_table_name = 'cuentas_por_pagar_pagos' then
    new.monto          := round(new.monto, 2);
    new.saldo_anterior := round(new.saldo_anterior, 2);
    new.saldo_nuevo    := round(new.saldo_nuevo, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cxp_redondear on public.cuentas_por_pagar;
create trigger trg_cxp_redondear before insert or update on public.cuentas_por_pagar
  for each row execute function public.cxp_redondear_montos();
drop trigger if exists trg_cxp_cuotas_redondear on public.cuentas_por_pagar_cuotas;
create trigger trg_cxp_cuotas_redondear before insert or update on public.cuentas_por_pagar_cuotas
  for each row execute function public.cxp_redondear_montos();
drop trigger if exists trg_cxp_pagos_redondear on public.cuentas_por_pagar_pagos;
create trigger trg_cxp_pagos_redondear before insert or update on public.cuentas_por_pagar_pagos
  for each row execute function public.cxp_redondear_montos();
