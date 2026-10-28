-- =====================================================================
-- CRM · Fase 3: grupos de clientes y puntaje (SOLO AGREGA una función de lectura)
--   crm_resumen_clientes(): por cada cliente del negocio, cuántas veces compró,
--   cuánto (ventas completadas menos devoluciones), primera y última compra,
--   y lo mismo en los últimos 12 meses. Con eso la pantalla arma los grupos
--   (Campeones, Leales, En riesgo…) y el puntaje. SOLO LEE: no guarda ni cambia nada.
--   security invoker: corre con los permisos del usuario, así que cada negocio
--   solo ve sus propias ventas (las mismas reglas RLS de siempre).
-- =====================================================================
create or replace function public.crm_resumen_clientes()
returns table (
  cliente_id uuid,
  compras integer,
  monto numeric,
  compras_12m integer,
  monto_12m numeric,
  primera date,
  ultima date
)
language sql
stable
security invoker
set search_path = public
as $$
  with v as (
    select ve.id, ve.cliente_id, ve.total, coalesce(ve.fecha::date, ve.created_at::date) as dia
    from public.ventas ve
    where ve.auth_user_id = auth.uid() and ve.cliente_id is not null and coalesce(ve.estado, 'completada') <> 'anulada'
  ),
  d as (
    select dv.venta_id, sum(dv.total) as devuelto
    from public.devoluciones_venta dv
    where dv.auth_user_id = auth.uid() and coalesce(dv.estado, 'registrada') <> 'anulada'
    group by dv.venta_id
  )
  select v.cliente_id,
         count(*)::int,
         round(sum(greatest(coalesce(v.total, 0) - coalesce(d.devuelto, 0), 0)), 2),
         (count(*) filter (where v.dia >= current_date - 365))::int,
         round(coalesce(sum(greatest(coalesce(v.total, 0) - coalesce(d.devuelto, 0), 0)) filter (where v.dia >= current_date - 365), 0), 2),
         min(v.dia),
         max(v.dia)
  from v left join d on d.venta_id = v.id
  group by v.cliente_id
$$;

revoke all on function public.crm_resumen_clientes() from public, anon;
grant execute on function public.crm_resumen_clientes() to authenticated;
comment on function public.crm_resumen_clientes() is 'CRM: resumen de compras por cliente (solo lectura, con RLS del usuario) para grupos y puntaje.';
