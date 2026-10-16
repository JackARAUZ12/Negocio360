-- ============================================================
-- Dos candados contables en la base (cubren cualquier pantalla):
--
-- 1) No se puede ANULAR una venta a crédito que ya tiene abonos.
--    Problema real (All Plastic, V-000830 y V-001066): la venta a crédito
--    se pagó completa y después se anuló desde Ventas. La deuda salió de
--    los libros pero los abonos (y su dinero en Caja) se quedaron:
--    Cuentas por Cobrar quedó en negativo y nadie devolvió el dinero.
--    Créditos ya lo bloqueaba ("Anula cada pago primero"); Ventas no.
--    Ahora la base lo rechaza con el mismo mensaje, venga de donde venga.
--
-- 2) Si una venta YA contabilizada cambia de total o de costo (ej.
--    "Editar productos" de un crédito), su asiento automático se ajusta
--    solo al monto nuevo. Problema real (CR-000012): el crédito bajó de
--    5,401.20 a 5,041.20 pero su asiento siguió en 5,401.20 (C$360 de más
--    en Ventas y en Cuentas por Cobrar).
--    - Las líneas de la venta (y su IVA/retenciones, si las hay) se
--      ajustan en proporción al total nuevo; las de costo, al costo real
--      de sus productos (se reconocen tanto en asientos nuevos como en
--      los de versiones anteriores del generador). El asiento sigue
--      cuadrando o NO se toca.
--    - No se dispara durante "Convertir moneda" (esa función no convierte
--      asientos y este ajuste no debe cambiar ese comportamiento).
--    - Nunca bloquea la edición: si algo no cuadra, simplemente no ajusta.
-- ============================================================

-- ---------- 1) Candado: venta a crédito con abonos ----------
create or replace function public.ventas_no_anular_credito_con_abonos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_cred text; v_n int;
begin
  select k.numero_credito, count(p.id) into v_cred, v_n
    from creditos k join creditos_pagos p on p.credito_id = k.id and coalesce(p.estado, 'completado') <> 'anulado'
   where k.venta_id = new.id
   group by k.numero_credito
   limit 1;
  if coalesce(v_n, 0) > 0 then
    raise exception 'Esta venta a crédito ya tiene % abono(s) registrado(s) en el crédito %. Primero anula esos abonos en Créditos (así el dinero sale de Caja) y después anula la venta.', v_n, v_cred
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.ventas_no_anular_credito_con_abonos() from public, anon, authenticated;

create trigger trg_ventas_no_anular_credito_con_abonos
  before update of estado on public.ventas
  for each row
  when (new.estado = 'anulada' and old.estado is distinct from 'anulada')
  execute function public.ventas_no_anular_credito_con_abonos();

-- ---------- 2) Ajuste del asiento al editar una venta ya contabilizada ----------
create or replace function public.ventas_ajustar_asiento_al_editar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
-- Línea de COSTO = con descripción de costo, o sin descripción fuera de las 2 principales (versión vieja del generador).
-- Todo lo demás es la parte de la VENTA (principal + IVA/retenciones).
declare a record; d0 numeric; f numeric; c numeric; dif numeric; td numeric; th numeric; v_serv boolean; m_costo record; id_mayor uuid; n_cd int; n_ch int;
begin
  if coalesce(current_setting('n360.sin_ajuste_asientos', true), '') = '1' then return null; end if;
  -- Solo una LLAMADA real a la función de conversión de moneda (su nombre seguido de paréntesis), no un script que solo la mencione.
  if current_query() ~* 'convertir_moneda_negocio"?\s*\(' then return null; end if;
  for a in select * from asientos_contables where referencia_id = new.id and referencia_tipo in ('venta','credito_otorgado')
             and origen = 'automatico' and estado = 'registrado' loop
    begin
      -- 1) Parte de la VENTA: en proporción al total nuevo
      select coalesce(sum(d.debe), 0) into d0 from asientos_detalle d
       where d.asiento_id = a.id
         and not (coalesce(d.descripcion, '') in ('Costo de lo vendido', 'Salida de inventario') or (d.descripcion is null and d.orden >= 2));
      if d0 > 0 and abs(d0 - new.total) > 0.004 and new.total > 0 then
        f := new.total / d0;
        update asientos_detalle d set debe = round(d.debe * f, 2), haber = round(d.haber * f, 2)
         where d.asiento_id = a.id
           and not (coalesce(d.descripcion, '') in ('Costo de lo vendido', 'Salida de inventario') or (d.descripcion is null and d.orden >= 2));
        select coalesce(sum(d.debe), 0) - coalesce(sum(d.haber), 0) into dif from asientos_detalle d
         where d.asiento_id = a.id
           and not (coalesce(d.descripcion, '') in ('Costo de lo vendido', 'Salida de inventario') or (d.descripcion is null and d.orden >= 2));
        if abs(dif) >= 0.005 then
          select d.id into id_mayor from asientos_detalle d
           where d.asiento_id = a.id and d.haber > 0
             and not (coalesce(d.descripcion, '') in ('Costo de lo vendido', 'Salida de inventario') or (d.descripcion is null and d.orden >= 2))
           order by d.haber desc limit 1;
          update asientos_detalle set haber = round(haber + dif, 2) where id = id_mayor;
        end if;
      end if;

      -- 2) COSTO de lo vendido = costo real de sus productos (igual que al generar el asiento)
      select exists (select 1 from contabilidad_mapeo_cuentas mc where mc.auth_user_id = a.auth_user_id and mc.tipo_transaccion = 'costo_servicios' and mc.cuenta_debe_id is not null) into v_serv;
      select round(coalesce(sum(coalesce(vd.cantidad, 0) * coalesce(vd.costo, 0)), 0), 2) into c
        from venta_detalles vd where vd.venta_id = new.id and not (coalesce(v_serv, false) and vd.tipo_item = 'servicio');
      select count(*) filter (where cc.tipo in ('costo', 'gasto')), count(*) filter (where cc.tipo = 'activo') into n_cd, n_ch
        from asientos_detalle d join cuentas_contables cc on cc.id = d.cuenta_id
       where d.asiento_id = a.id
         and (coalesce(d.descripcion, '') in ('Costo de lo vendido', 'Salida de inventario') or (d.descripcion is null and d.orden >= 2));
      if n_cd = 1 and n_ch = 1 then
        update asientos_detalle d set debe = c, haber = 0 from cuentas_contables cc
         where cc.id = d.cuenta_id and d.asiento_id = a.id and cc.tipo in ('costo', 'gasto')
           and (coalesce(d.descripcion, '') in ('Costo de lo vendido', 'Salida de inventario') or (d.descripcion is null and d.orden >= 2));
        update asientos_detalle d set haber = c, debe = 0 from cuentas_contables cc
         where cc.id = d.cuenta_id and d.asiento_id = a.id and cc.tipo = 'activo'
           and (coalesce(d.descripcion, '') in ('Costo de lo vendido', 'Salida de inventario') or (d.descripcion is null and d.orden >= 2));
      elsif n_cd = 0 and n_ch = 0 and c > 0 then
        select * into m_costo from contabilidad_mapeo_cuentas where auth_user_id = a.auth_user_id and tipo_transaccion = 'costo_ventas' limit 1;
        if m_costo.cuenta_debe_id is not null and m_costo.cuenta_haber_id is not null then
          insert into asientos_detalle(auth_user_id, asiento_id, cuenta_id, debe, haber, orden, descripcion) values
            (a.auth_user_id, a.id, m_costo.cuenta_debe_id, c, 0, 10, 'Costo de lo vendido'), (a.auth_user_id, a.id, m_costo.cuenta_haber_id, 0, c, 11, 'Salida de inventario');
        end if;
      end if;   -- otro caso raro: el costo no se toca

      select coalesce(sum(debe), 0), coalesce(sum(haber), 0) into td, th from asientos_detalle where asiento_id = a.id;
      if round(td, 2) <> round(th, 2) then raise exception 'no cuadra (debe %, haber %)', td, th; end if;
      update asientos_contables set total_debe = td, total_haber = th where id = a.id and (total_debe is distinct from td or total_haber is distinct from th);
    exception when others then
      -- En la autoprueba (n360.ajuste_estricto = 1) el error se muestra; en uso normal nunca bloquea la edición.
      if coalesce(current_setting('n360.ajuste_estricto', true), '') = '1' then raise; end if;
      raise warning 'ventas_ajustar_asiento_al_editar: no se ajustó el asiento % (%)', a.id, sqlerrm;
    end;
  end loop;
  return null;
end $$;

revoke all on function public.ventas_ajustar_asiento_al_editar() from public, anon, authenticated;

create trigger trg_ventas_ajustar_asiento_al_editar
  after update of total, costo_total on public.ventas
  for each row
  when ((old.total is distinct from new.total or old.costo_total is distinct from new.costo_total) and new.estado = 'completada')
  execute function public.ventas_ajustar_asiento_al_editar();
