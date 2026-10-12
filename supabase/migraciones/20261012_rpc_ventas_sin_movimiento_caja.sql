-- Aplicada en produccion el 2026-10-12 (migracion "rpc_ventas_sin_movimiento_caja").
-- Solo lectura. Lista las ventas cobradas (no a credito, no anuladas) de la cuenta del usuario que NO tienen
-- movimiento de ingreso en caja. La usa el boton "Revisar Caja" de Ventas.
create or replace function public.ventas_sin_movimiento_caja(p_dias integer default 3)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select v.id, v.numero_venta, v.fecha, v.total, coalesce(v.impuesto,0) as impuesto,
           coalesce(v.retencion_ir_monto,0) as retencion_ir_monto,
           v.metodo_pago_id, v.metodo_pago_nombre, v.creado_por_nombre, v.created_at
    from public.ventas v
    where v.auth_user_id = auth.uid()
      and v.estado <> 'anulada'
      and coalesce(v.estado_pago,'') not in ('credito','pendiente','fiado')
      and coalesce(v.metodo_pago,'') <> 'credito'
      and coalesce(v.metodo_pago_nombre,'') not ilike '%credito%'
      and coalesce(v.total,0) > 0
      and v.created_at >= now() - make_interval(days => greatest(p_dias,1))
      and not exists (
        select 1 from public.movimientos_financieros m
        where m.auth_user_id = v.auth_user_id and m.referencia_tipo = 'venta'
          and m.referencia_id = v.id and m.tipo_flujo = 'INGRESO')
    order by v.created_at desc
    limit 300
  ) x;
$$;
grant execute on function public.ventas_sin_movimiento_caja(integer) to authenticated;
