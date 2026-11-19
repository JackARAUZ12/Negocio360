-- 20261119 · Reconstruye en plataforma_pagos los cobros de jul–oct 2026 (antes del 20 oct)
-- Motivo: el libro de pagos empezó el 20-oct-2026; "Ingresos Negocio360" mostraba casi nada
-- para meses anteriores aunque sí se marcaron pagos (cada uno envió un comprobante por el chat).
-- Fuente: mensajes del chat "¡Gracias por tu pago! ... comprobante ..." enviados por el admin.
-- Monto = precio personalizado del cliente o US$10 (igual que el registro automático).
-- Aditivo e idempotente: solo INSERT, marcado 'reconstruido', ON CONFLICT DO NOTHING.
-- No hay triggers en plataforma_pagos ni clientes atribuidos a freelancers: no genera comisiones.
do $r$
declare corte timestamptz; n int;
begin
  select min(created_at) into corte from public.plataforma_pagos where registrado_por is distinct from 'reconstruido (comprobante del chat)';
  if corte is null then raise exception 'Sin punto de corte'; end if;
  insert into public.plataforma_pagos (auth_user_id, ciclo, monto, moneda, registrado_por, created_at)
  select m.auth_user_id, (m.created_at at time zone 'America/Managua')::date,
         coalesce(u.precio_personalizado, 10.00), 'USD', 'reconstruido (comprobante del chat)', m.created_at
  from public.mensajes_chat m join public.usuarios u on u.auth_user_id = m.auth_user_id
  where m.remitente = 'admin' and m.contenido like '¡Gracias por tu pago!%' and m.created_at < corte
  on conflict (auth_user_id, ciclo) do nothing;
  get diagnostics n = row_count;
  if n > 150 then raise exception 'Demasiadas filas (%), se cancela', n; end if;
end $r$;
