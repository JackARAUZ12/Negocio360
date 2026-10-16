-- Activa el módulo Cotizaciones SOLO en las 2 cuentas de All Plastic
-- (autorizado por el dueño). Todas las demás cuentas siguen apagadas.
-- Solo cambia el interruptor; no toca ningún otro dato.
update public.configuracion_empresa
   set usa_modulo_cotizaciones = true
 where auth_user_id in ('46521033-5d43-40d5-844d-33ca2ff59c14',   -- ALL PLASTIC COMERCIAL
                        '90e89966-68e9-486d-a9c4-9d9000cb76ae');  -- ALL PLASTIC COMERCIAL MAYORISTA
