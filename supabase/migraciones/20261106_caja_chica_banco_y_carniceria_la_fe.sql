-- 06-nov-2026 — Caja Chica: un egreso pagado desde un banco nunca cuenta como efectivo de la gaveta,
-- y corrección confirmada por Carnicería La Fe (8cbc7dc9-…):
--  * Compra C-000036 (C$1,690, 04-nov) pagada por transferencia LAFISE quedó marcada "sale de Caja Chica" → origen 'general'.
--  * Caja Chica 04-nov recalculada: teórico 2,689.30 = contado 2,689.30, diferencia 0 (el "sobrante" de 1,690 no existía).
--  * Cierre diario 05-nov: saldo inicial 7,190.03 (antes 19,122.03) y final 6,226.66 (antes 18,158.66).
-- Aplicada con apply_migration "carniceria_la_fe_correccion_y_candado_caja_chica" (mismo contenido).
do $$
declare d text := pg_get_functiondef('public.fn_actualizar_cierres_al_agregar_movimiento()'::regprocedure);
  v_viejo text := $q$                  when origen_caja = 'chica' then true
                  else lower(coalesce(metodo_pago_nombre, 'Efectivo')) like '%efectivo%' end)), 0),$q$;
  v_nuevo text := $q$                  when banco_id is not null then false
                  when origen_caja = 'chica' then true
                  else lower(coalesce(metodo_pago_nombre, 'Efectivo')) like '%efectivo%' end)), 0),$q$;
begin
  if position('when banco_id is not null then false' in d) > 0 then return; end if;
  if position(v_viejo in d) = 0 then raise exception 'texto no encontrado; no se cambió nada'; end if;
  execute replace(d, v_viejo, v_nuevo);
end $$;
