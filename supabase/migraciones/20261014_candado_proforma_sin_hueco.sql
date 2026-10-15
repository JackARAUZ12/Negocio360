-- Candado de "una venta activa por proforma", sin hueco.
--
-- El índice único del 13-oct (ventas_una_activa_por_proforma) solo
-- compara ventas creadas desde esa fecha, porque había duplicados viejos
-- que impedían crearlo sobre toda la tabla. Eso dejaba un hueco: una
-- proforma que ya tenía una venta ANTERIOR al 13-oct podía convertirse
-- otra vez.
--
-- Este control revisa TODAS las ventas activas de la proforma, sin
-- importar la fecha. No toca ni borra ninguna venta existente; solo
-- impide crear (o reactivar) una segunda venta activa. Responde con el
-- mismo código de error (23505) que el índice, así la app ya muestra su
-- aviso "Esta proforma ya tiene una venta activa".
CREATE OR REPLACE FUNCTION public.ventas_una_activa_por_proforma_chk()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if NEW.proforma_id is null or coalesce(NEW.estado, 'completada') <> 'completada' then
    return NEW;
  end if;
  -- En UPDATE solo importa si la venta pasa a activa o cambia de proforma.
  if TG_OP = 'UPDATE' and OLD.estado is not distinct from NEW.estado
     and OLD.proforma_id is not distinct from NEW.proforma_id then
    return NEW;
  end if;
  if exists (
    select 1 from ventas v
     where v.auth_user_id = NEW.auth_user_id
       and v.proforma_id = NEW.proforma_id
       and v.estado = 'completada'
       and v.id <> NEW.id
  ) then
    raise exception 'Esta proforma ya tiene una venta activa (proforma duplicada)'
      using errcode = '23505';
  end if;
  return NEW;
end $function$;

DROP TRIGGER IF EXISTS trg_ventas_una_activa_por_proforma ON public.ventas;
CREATE TRIGGER trg_ventas_una_activa_por_proforma
  BEFORE INSERT OR UPDATE OF estado, proforma_id ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.ventas_una_activa_por_proforma_chk();
