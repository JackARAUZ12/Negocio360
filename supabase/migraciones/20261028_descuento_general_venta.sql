-- =====================================================================
-- DESCUENTO GENERAL DE LA FACTURA (Ventas)
-- ---------------------------------------------------------------------
-- Aditivo: 4 columnas nuevas en ventas (todas opcionales) y un candado.
--   * ventas.descuento SIGUE siendo el descuento TOTAL de la venta
--     (líneas + promociones + puntos + certificado + descuento general),
--     así que caja, contabilidad, devoluciones, anulaciones y reportes
--     siguen leyendo exactamente lo mismo que siempre.
--   * descuento_general / _modo / _valor / _motivo solo dejan constancia
--     de cuánto de ese descuento fue el "descuento general" y cómo se puso.
-- El candado SOLO actúa cuando una venta trae descuento_general > 0: las
-- ventas normales (sin descuento general) no se revisan ni se tocan.
-- =====================================================================

alter table public.ventas add column if not exists descuento_general        numeric;
alter table public.ventas add column if not exists descuento_general_modo   text;
alter table public.ventas add column if not exists descuento_general_valor  numeric;
alter table public.ventas add column if not exists descuento_general_motivo text;

create or replace function public.ventas_descuento_general_chk()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    -- Una vez guardada la venta, el descuento general no se puede cambiar
    -- (cualquier ajuste se hace con devolución o anulación, que cuadran Caja).
    if new.descuento_general        is distinct from old.descuento_general
    or new.descuento_general_modo   is distinct from old.descuento_general_modo
    or new.descuento_general_valor  is distinct from old.descuento_general_valor
    or new.descuento_general_motivo is distinct from old.descuento_general_motivo then
      raise exception 'El descuento general de una venta guardada no se puede cambiar. Usa anulación o devolución.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- INSERT: sin descuento general no se revisa nada (ventas de siempre).
  if coalesce(new.descuento_general, 0) <= 0 then
    if new.descuento_general is not null and new.descuento_general < 0 then
      raise exception 'El descuento general no puede ser negativo.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.descuento_general_modo is null or new.descuento_general_modo not in ('monto', 'porcentaje') then
    raise exception 'Descuento general: tipo inválido.' using errcode = 'P0001';
  end if;
  if new.descuento_general_modo = 'porcentaje'
     and (new.descuento_general_valor is null or new.descuento_general_valor <= 0 or new.descuento_general_valor > 100) then
    raise exception 'Descuento general: el porcentaje debe estar entre 0 y 100.' using errcode = 'P0001';
  end if;
  -- El descuento general es PARTE del descuento total y este no puede pasar del subtotal.
  if new.descuento_general > coalesce(new.descuento, 0) + 0.005 then
    raise exception 'Descuento general: no puede ser mayor que el descuento total de la venta.' using errcode = 'P0001';
  end if;
  if coalesce(new.descuento, 0) > coalesce(new.subtotal, 0) + 0.005 then
    raise exception 'Descuento general: el descuento no puede ser mayor que el subtotal.' using errcode = 'P0001';
  end if;
  -- Cuadre: total = subtotal - descuento + impuestos (tolerancia de redondeo)
  if abs(coalesce(new.total, 0) - (coalesce(new.subtotal, 0) - coalesce(new.descuento, 0) + coalesce(new.impuesto, 0))) > 0.05 then
    raise exception 'Descuento general: los montos de la venta no cuadran (subtotal, descuento, impuestos y total). No se guardó.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_ventas_descuento_general_chk on public.ventas;
create trigger trg_ventas_descuento_general_chk
  before insert or update on public.ventas
  for each row execute function public.ventas_descuento_general_chk();
