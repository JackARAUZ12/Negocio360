-- Normaliza ventas.fecha de las ventas guardadas con HORA REAL (el módulo Créditos no enviaba la fecha y la base ponía now()).
-- La convención del sistema es: ventas.fecha = el DÍA de la venta a medianoche UTC. Con hora real, una venta de noche (hora de
-- Managua) caía en el día —y a veces el mes— siguiente en los reportes.
-- SOLO cambia la columna fecha de esas ventas, al día que tenía en Managua. No toca montos, estados, Caja, IVA, fiados ni nada más.
-- Respaldo: cada fecha anterior queda guardada en ventas_fecha_respaldo (se puede revertir). Repetirla no hace nada.
create table if not exists public.ventas_fecha_respaldo (
  venta_id       uuid primary key,
  auth_user_id   uuid not null,
  fecha_anterior timestamptz not null,
  fecha_nueva    timestamptz not null,
  creado_at      timestamptz not null default now()
);
alter table public.ventas_fecha_respaldo enable row level security;
revoke all on public.ventas_fecha_respaldo from anon, authenticated;

insert into public.ventas_fecha_respaldo(venta_id, auth_user_id, fecha_anterior, fecha_nueva)
select v.id, v.auth_user_id, v.fecha, ((v.fecha at time zone 'America/Managua')::date)::timestamp at time zone 'UTC'
  from public.ventas v
 where (v.fecha at time zone 'UTC')::time <> time '00:00'
on conflict (venta_id) do nothing;

update public.ventas v set fecha = r.fecha_nueva
  from public.ventas_fecha_respaldo r
 where r.venta_id = v.id and v.fecha = r.fecha_anterior and r.fecha_anterior <> r.fecha_nueva;
