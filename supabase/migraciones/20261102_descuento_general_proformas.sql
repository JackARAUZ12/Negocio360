-- =====================================================================
-- DESCUENTO GENERAL en Proformas y Cotizaciones (2-nov-2026) — el mismo de Ventas.
-- Solo AGREGA 4 columnas (vacías para todo lo que ya existe) y un candado que SOLO
-- revisa los documentos que traen descuento general (lo demás se guarda igual que siempre).
-- Candado: tipo válido (monto / porcentaje 0–100), el descuento general no pasa del descuento
-- total, el descuento no pasa del subtotal, y total = subtotal − descuento + impuestos (±0.05).
-- Al convertir la proforma en venta pasa con ella (la venta ya tiene su propio candado igual).
-- =====================================================================

alter table public.proformas add column if not exists descuento_general numeric(14,2) not null default 0;
alter table public.proformas add column if not exists descuento_general_modo text;
alter table public.proformas add column if not exists descuento_general_valor numeric(14,2);
alter table public.proformas add column if not exists descuento_general_motivo text;
alter table public.cotizaciones add column if not exists descuento_general numeric(14,2) not null default 0;
alter table public.cotizaciones add column if not exists descuento_general_modo text;
alter table public.cotizaciones add column if not exists descuento_general_valor numeric(14,2);
alter table public.cotizaciones add column if not exists descuento_general_motivo text;

create or replace function public._doc_descuento_general_chk()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(new.descuento_general, 0) <= 0 then
    if new.descuento_general is not null and new.descuento_general < 0 then
      raise exception 'El descuento general no puede ser negativo.' using errcode = 'P0001';
    end if;
    new.descuento_general := 0; new.descuento_general_modo := null; new.descuento_general_valor := null; new.descuento_general_motivo := null;
    return new;
  end if;
  if new.descuento_general_modo is null or new.descuento_general_modo not in ('monto', 'porcentaje') then
    raise exception 'Descuento general: tipo inválido.' using errcode = 'P0001';
  end if;
  if new.descuento_general_modo = 'porcentaje'
     and (new.descuento_general_valor is null or new.descuento_general_valor <= 0 or new.descuento_general_valor > 100) then
    raise exception 'Descuento general: el porcentaje debe estar entre 0 y 100.' using errcode = 'P0001';
  end if;
  if new.descuento_general > coalesce(new.descuento, 0) + 0.005 then
    raise exception 'Descuento general: no puede ser mayor que el descuento total.' using errcode = 'P0001';
  end if;
  if coalesce(new.descuento, 0) > coalesce(new.subtotal, 0) + 0.005 then
    raise exception 'Descuento general: el descuento no puede ser mayor que el subtotal.' using errcode = 'P0001';
  end if;
  if abs(coalesce(new.total, 0) - (coalesce(new.subtotal, 0) - coalesce(new.descuento, 0) + coalesce(new.impuesto, 0))) > 0.05 then
    raise exception 'Descuento general: los montos no cuadran (subtotal, descuento, impuestos y total). No se guardó.' using errcode = 'P0001';
  end if;
  new.descuento_general_motivo := left(nullif(btrim(coalesce(new.descuento_general_motivo, '')), ''), 80);
  return new;
end $$;

drop trigger if exists trg_proformas_descuento_general_chk on public.proformas;
create trigger trg_proformas_descuento_general_chk before insert or update on public.proformas
  for each row execute function public._doc_descuento_general_chk();
drop trigger if exists trg_cotizaciones_descuento_general_chk on public.cotizaciones;
create trigger trg_cotizaciones_descuento_general_chk before insert or update on public.cotizaciones
  for each row execute function public._doc_descuento_general_chk();
revoke all on function public._doc_descuento_general_chk() from public, anon, authenticated;
