-- 20261119b · El libro de pagos de Negocio360 conserva el cliente aunque se elimine su cuenta
-- 1) Guarda nombre/negocio/correo del cliente en cada pago (copia permanente, aditivo).
-- 2) Rellena esa copia en los pagos existentes.
-- 3) Recupera los pagos de las 10 cuentas eliminadas el 18-nov (desde el respaldo privado).
-- 4) Agrega 3 pagos de meses distintos hechos el mismo día (no entraron por la regla 1 pago/cliente/fecha).
-- plataforma_pagos NO tiene llave foránea a auth.users: borrar una cuenta no borra sus pagos.
alter table public.plataforma_pagos
  add column if not exists cliente_nombre text,
  add column if not exists cliente_negocio text,
  add column if not exists cliente_email text;

create or replace function public._pago_copiar_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_email is null and new.cliente_negocio is null then
    select nullif(trim(coalesce(u.nombre,'')||' '||coalesce(u.apellido,'')),''), u.nombre_negocio, u.email
      into new.cliente_nombre, new.cliente_negocio, new.cliente_email
    from public.usuarios u where u.auth_user_id = new.auth_user_id limit 1;
  end if;
  return new;
exception when others then
  return new;   -- nunca bloquea el registro del pago
end $$;
drop trigger if exists trg_pago_copiar_cliente on public.plataforma_pagos;
create trigger trg_pago_copiar_cliente before insert on public.plataforma_pagos
  for each row execute function public._pago_copiar_cliente();

do $p$
declare corte timestamptz; n1 int; n2 int; meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  select min(created_at) into corte from public.plataforma_pagos where registrado_por not like 'reconstruido%';
  -- 3) cuentas eliminadas (respaldo privado)
  insert into public.plataforma_pagos (auth_user_id, ciclo, monto, moneda, registrado_por, created_at, cliente_nombre, cliente_negocio, cliente_email)
  select (m.fila->>'auth_user_id')::uuid, ((m.fila->>'created_at')::timestamptz at time zone 'America/Managua')::date,
         coalesce((u.fila->>'precio_personalizado')::numeric, 10.00), 'USD', 'reconstruido (comprobante del chat)',
         (m.fila->>'created_at')::timestamptz,
         nullif(trim(coalesce(u.fila->>'nombre','')||' '||coalesce(u.fila->>'apellido','')),''), u.fila->>'nombre_negocio', u.fila->>'email'
  from respaldos_privados.cuentas_eliminadas_20261118 m
  left join respaldos_privados.cuentas_eliminadas_20261118 u on u.tabla='public.usuarios' and u.auth_user_id=m.auth_user_id
  where m.tabla='public.mensajes_chat' and m.fila->>'remitente'='admin' and m.fila->>'contenido' like '¡Gracias por tu pago!%'
    and (m.fila->>'created_at')::timestamptz < corte
  on conflict (auth_user_id, ciclo) do nothing;
  get diagnostics n1 = row_count;
  if n1 > 11 then raise exception 'Cuentas eliminadas: demasiadas filas (%)', n1; end if;

  -- 4) pagos de meses distintos el mismo día
  with c as (
    select m.auth_user_id, m.created_at, (m.created_at at time zone 'America/Managua')::date d,
           substring(m.contenido from 'correspondiente a (.*)\.$') txt,
           row_number() over (partition by m.auth_user_id, (m.created_at at time zone 'America/Managua')::date order by m.created_at) rn
    from public.mensajes_chat m where m.remitente='admin' and m.contenido like '¡Gracias por tu pago!%' and m.created_at < corte),
  primero as (select auth_user_id, d, txt from c where rn = 1),
  extra as (select distinct on (c.auth_user_id, c.txt) c.* from c join primero p on p.auth_user_id=c.auth_user_id and p.d=c.d
            where c.rn > 1 and c.txt <> p.txt order by c.auth_user_id, c.txt, c.created_at)
  insert into public.plataforma_pagos (auth_user_id, ciclo, monto, moneda, registrado_por, created_at)
  select e.auth_user_id,
         make_date(split_part(e.txt,' de ',2)::int, array_position(meses, lower(split_part(e.txt,' de ',1))), 1),
         coalesce(u.precio_personalizado, 10.00), 'USD', 'reconstruido (comprobante del chat)', e.created_at
  from extra e join public.usuarios u on u.auth_user_id = e.auth_user_id
  on conflict (auth_user_id, ciclo) do nothing;
  get diagnostics n2 = row_count;
  if n2 > 3 then raise exception 'Pagos extra: demasiadas filas (%)', n2; end if;

  -- 2) copia permanente del cliente en los pagos que no la tienen
  update public.plataforma_pagos p set
    cliente_nombre = nullif(trim(coalesce(u.nombre,'')||' '||coalesce(u.apellido,'')),''), cliente_negocio = u.nombre_negocio, cliente_email = u.email
  from public.usuarios u where u.auth_user_id = p.auth_user_id and p.cliente_email is null and p.cliente_negocio is null;
end $p$;
