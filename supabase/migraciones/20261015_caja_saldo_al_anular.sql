-- ============================================================
-- Caja: el saldo corrido se corrige SIEMPRE al anular un movimiento,
-- sin importar desde qué módulo se anule.
--
-- Problema real (15 cuentas afectadas): el saldo de Caja es el
-- saldo_resultante del último movimiento completado y se encadena al
-- insertar (trg_00_encadenar_saldo). Si un movimiento se anula
-- marcándolo estado='anulado' (Compras, Gastos, Delivery, Transporte),
-- los movimientos POSTERIORES seguían arrastrando su monto y el saldo
-- mostrado quedaba mal. Solo "Anular" desde Caja lo corregía.
--
-- Ahora: un trigger en la base hace esa misma corrección exacta para
-- cualquier cambio de estado (completado -> anulado, y también si se
-- reactiva). La función anular_movimiento_caja ya no la hace por su
-- cuenta (si no, se corregiría dos veces).
--
-- Aditivo: no cambia montos ni movimientos; solo los saldos corridos de
-- los movimientos posteriores, por el monto exacto. No toca historiales
-- viejos ya descuadrados (eso se recalcula aparte, cuenta por cuenta,
-- con autorización).
-- ============================================================

create or replace function public.fn_mf_saldo_al_cambiar_estado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare d numeric; v_prev numeric;
begin
  if new.auth_user_id is null or new.tipo_flujo not in ('INGRESO','EGRESO') then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('mov_fin:' || new.auth_user_id::text, 0));

  if old.estado = 'completado' and new.estado is distinct from 'completado' then
    -- Sale de la cadena: los posteriores dejan de arrastrar su monto.
    d := case when new.tipo_flujo = 'INGRESO' then -new.monto else new.monto end;
  elsif old.estado is distinct from 'completado' and new.estado = 'completado' then
    -- Vuelve a la cadena: su saldo se calcula desde el anterior y los posteriores lo arrastran.
    select saldo_resultante into v_prev from movimientos_financieros
      where auth_user_id = new.auth_user_id and estado = 'completado' and id <> new.id
        and (created_at, id) < (new.created_at, new.id)
      order by created_at desc, id desc limit 1;
    v_prev := coalesce(v_prev, 0);
    update movimientos_financieros
       set saldo_anterior = v_prev,
           saldo_resultante = case when new.tipo_flujo = 'INGRESO' then v_prev + new.monto else v_prev - new.monto end
     where id = new.id;
    d := case when new.tipo_flujo = 'INGRESO' then new.monto else -new.monto end;
  else
    return null;
  end if;

  update movimientos_financieros
     set saldo_anterior = round(saldo_anterior + d, 2), saldo_resultante = round(saldo_resultante + d, 2)
   where auth_user_id = new.auth_user_id and estado = 'completado' and id <> new.id
     and (created_at, id) > (new.created_at, new.id);
  return null;
end $$;

revoke all on function public.fn_mf_saldo_al_cambiar_estado() from public, anon, authenticated;

create trigger trg_mf_saldo_al_cambiar_estado
  after update of estado on public.movimientos_financieros
  for each row
  when (old.estado is distinct from new.estado)
  execute function public.fn_mf_saldo_al_cambiar_estado();

-- Caja > Anular: igual que antes, pero la corrección del saldo la hace el trigger.
create or replace function public.anular_movimiento_caja(p_id uuid, p_motivo text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); m movimientos_financieros%rowtype; n int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'mensaje', 'Sin sesión activa'); end if;
  select * into m from movimientos_financieros where id = p_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'mensaje', 'No se encontró el movimiento a anular'); end if;
  if m.estado = 'anulado' then return jsonb_build_object('ok', false, 'mensaje', 'Ese movimiento ya estaba anulado'); end if;
  if m.transferencia_id is not null then
    return jsonb_build_object('ok', false, 'mensaje', 'Las transferencias no se anulan una por una: usa "Revertir" en la pestaña Transferencias.');
  end if;

  -- Documento con su propio Anular: se anula desde su módulo.
  if m.referencia_id is not null and m.referencia_tipo in ('venta', 'gasto', 'compra', 'credito') then
    return jsonb_build_object('ok', false, 'mensaje',
      'Este movimiento pertenece a ' ||
      case m.referencia_tipo when 'venta' then 'una venta: anúlala desde Ventas'
                             when 'gasto' then 'un gasto: cancélalo desde Gastos'
                             when 'compra' then 'una compra: anúlala desde Compras'
                             else 'un pago de crédito: anúlalo desde Créditos' end ||
      '. Así se anula también este movimiento y todo queda cuadrado.');
  end if;

  if m.estado = 'completado' then
    select count(*) into n from movimientos_financieros
     where auth_user_id = v_uid and estado = 'completado' and (created_at, id) > (m.created_at, m.id);
  end if;

  -- El trigger trg_mf_saldo_al_cambiar_estado corrige el saldo de los posteriores.
  update movimientos_financieros
     set estado = 'anulado', anulado_en = now(), anulado_motivo = coalesce(nullif(trim(p_motivo), ''), 'Anulado manualmente')
   where id = m.id;

  return jsonb_build_object('ok', true, 'ajustados', n);
end $function$;
