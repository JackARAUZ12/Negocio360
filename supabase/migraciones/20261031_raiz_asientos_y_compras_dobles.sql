-- =====================================================================
-- 31-oct-2026 · Corrección DE RAÍZ (solo agrega dos triggers; no cambia datos existentes)
--
-- 1) Asiento de un documento anulado: hasta hoy, si se anulaba una venta, un gasto o una
--    compra, su asiento automático seguía vigente HASTA que alguien presionara
--    "Generar asientos" en Contabilidad (anularAsientosDeOrigenAnulado en contabilidad.js).
--    Mientras tanto los libros quedaban desfasados (caso real: V-000940 de José Rosales,
--    C$124,512, anulada el 30-oct con su asiento AS-001928 todavía activo).
--    Ahora la base lo anula EN EL MISMO MOMENTO, con la misma regla que ya usaba el sistema:
--    solo asientos automáticos, en estado "registrado", del tipo que corresponde al documento.
--    Nunca borra: queda "anulado" con su motivo. No toca dinero, stock ni el documento.
--
-- 2) Compra guardada dos veces por doble clic: el 29-oct C-000315 (C$49,720) quedó dos veces
--    a 0.14 s y sacó el dinero dos veces de Caja. La pantalla ya se corrigió; esto es la
--    segunda barrera en la base: rechaza una compra IDÉNTICA (mismo negocio, mismo número,
--    mismo proveedor y mismo total) guardada hace menos de 2 minutos y no anulada.
--    Una compra distinta nunca se bloquea.
-- =====================================================================

create or replace function public._asientos_anular_por_documento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipos text[]; v_motivo text;
begin
  if tg_table_name = 'ventas' then
    if new.estado is distinct from 'anulada' or old.estado is not distinct from 'anulada' then return new; end if;
    v_tipos := array['venta', 'credito_otorgado'];
    v_motivo := 'Venta ' || coalesce(new.numero_venta, '') || ' anulada (anulado automáticamente)';
  elsif tg_table_name = 'gastos' then
    if coalesce(new.estado, '') not in ('cancelado', 'anulado') or coalesce(old.estado, '') in ('cancelado', 'anulado') then return new; end if;
    v_tipos := array['gasto'];
    v_motivo := 'Gasto cancelado (anulado automáticamente)';
  elsif tg_table_name = 'compras' then
    if coalesce(new.estado, '') not in ('anulada', 'anulado') or coalesce(old.estado, '') in ('anulada', 'anulado') then return new; end if;
    v_tipos := array['compra'];
    v_motivo := 'Compra ' || coalesce(new.numero, '') || ' anulada (anulado automáticamente)';
  else
    return new;
  end if;
  update asientos_contables
     set estado = 'anulado', anulado_en = now(), anulado_motivo = v_motivo
   where referencia_id = new.id and origen = 'automatico' and estado = 'registrado'
     and referencia_tipo = any(v_tipos);
  return new;
end $$;

drop trigger if exists trg_asientos_anular_venta on public.ventas;
create trigger trg_asientos_anular_venta after update of estado on public.ventas
  for each row execute function public._asientos_anular_por_documento();
drop trigger if exists trg_asientos_anular_gasto on public.gastos;
create trigger trg_asientos_anular_gasto after update of estado on public.gastos
  for each row execute function public._asientos_anular_por_documento();
drop trigger if exists trg_asientos_anular_compra on public.compras;
create trigger trg_asientos_anular_compra after update of estado on public.compras
  for each row execute function public._asientos_anular_por_documento();

create or replace function public._compras_no_duplicar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if new.numero is null then return new; end if;
  select c.numero into v_num from compras c
   where c.auth_user_id = new.auth_user_id and c.numero = new.numero
     and coalesce(c.proveedor_id::text, c.proveedor_nombre, '') = coalesce(new.proveedor_id::text, new.proveedor_nombre, '')
     and c.total = new.total
     and coalesce(c.estado, '') not in ('anulada', 'anulado')
     and c.created_at > now() - interval '2 minutes'
   limit 1;
  if found then
    raise exception 'Esta compra (%) ya se guardó hace unos segundos. No se guardó otra vez: revisa la lista de compras.', v_num
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_compras_no_duplicar on public.compras;
create trigger trg_compras_no_duplicar before insert on public.compras
  for each row execute function public._compras_no_duplicar();

revoke all on function public._asientos_anular_por_documento() from public, anon, authenticated;
revoke all on function public._compras_no_duplicar() from public, anon, authenticated;
