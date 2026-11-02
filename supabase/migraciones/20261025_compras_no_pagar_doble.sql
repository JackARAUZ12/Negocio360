-- =====================================================================
-- COMPRAS A CRÉDITO: NO PAGAR DOS VECES · 25-oct-2026 · Solo AGREGA.
-- Una compra con cuenta por pagar viva se paga desde Cuentas por pagar.
-- El botón "Completar — ya se pagó" de Compras descontaba además el total
-- de Caja, y luego el pago al proveedor lo descontaba otra vez (pasó en
-- All Plastic Mayorista: C-000114, C-000118, C-000129).
-- Este candado rechaza ese egreso de "Compra" cuando la compra ya tiene
-- cuenta por pagar. Las compras de contado no tienen cuenta por pagar
-- al registrar su egreso, así que no cambian en nada.
-- =====================================================================
create or replace function public._compras_no_pagar_doble()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cxp text;
begin
  if new.referencia_tipo = 'compra' and new.tipo_movimiento = 'COMPRA' and new.tipo_flujo = 'EGRESO'
     and coalesce(new.estado, 'completado') = 'completado' and new.referencia_id is not null then
    select numero into v_cxp from cuentas_por_pagar
     where compra_id = new.referencia_id and auth_user_id = new.auth_user_id and estado <> 'anulado' limit 1;
    if found then
      raise exception using errcode = 'P0001',
        message = format('Esta compra es a crédito (%s). Págala desde Cuentas por pagar para que no se descuente dos veces de Caja.', coalesce(v_cxp, 'cuenta por pagar'));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_compras_no_pagar_doble on public.movimientos_financieros;
create trigger trg_compras_no_pagar_doble
  before insert on public.movimientos_financieros
  for each row execute function public._compras_no_pagar_doble();
