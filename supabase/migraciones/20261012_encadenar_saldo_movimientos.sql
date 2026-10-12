-- Aplicada en produccion el 2026-10-12 (via migracion "encadenar_saldo_movimientos_en_servidor").
-- Respaldo previo: tabla public.respaldo_movimientos_financieros_20261012 (10,937 filas, RLS activo, sin politicas).
-- Que hace: al insertar un movimiento COMPLETADO (INGRESO/EGRESO) en movimientos_financieros, el servidor
--   1) toma un candado por cuenta (pg_advisory_xact_lock) para que dos pantallas no se pisen,
--   2) calcula saldo_anterior = saldo_resultante del ultimo movimiento completado,
--   3) calcula saldo_resultante = saldo_anterior +/- monto.
-- No modifica filas existentes. No toca movimientos pendientes/anulados ni UPDATE.
-- Para desactivar al instante:
--   alter table public.movimientos_financieros disable trigger trg_00_encadenar_saldo;

create or replace function public.fn_encadenar_saldo_movimiento() returns trigger
language plpgsql security definer set search_path = public as $b$
declare v_prev numeric;
begin
  if new.estado is distinct from 'completado' or new.auth_user_id is null or new.tipo_flujo not in ('INGRESO','EGRESO') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mov_fin:' || new.auth_user_id::text, 0));
  if new.created_at = now() then new.created_at := clock_timestamp(); end if;
  select saldo_resultante into v_prev from public.movimientos_financieros
    where auth_user_id = new.auth_user_id and estado = 'completado'
    order by created_at desc, id desc limit 1;
  v_prev := coalesce(v_prev, 0);
  new.saldo_anterior := v_prev;
  new.saldo_resultante := case when new.tipo_flujo = 'INGRESO' then v_prev + new.monto else v_prev - new.monto end;
  return new;
end;
$b$;

create trigger trg_00_encadenar_saldo before insert on public.movimientos_financieros
for each row execute function public.fn_encadenar_saldo_movimiento();
