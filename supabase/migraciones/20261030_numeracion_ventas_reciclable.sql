-- ============================================================================
-- Numeración de ventas sin huecos nuevos (30-oct-2026)
--
-- PROBLEMA: generar_numero_venta() subía el contador cada vez que se ABRÍA la
-- pantalla de venta. Si la persona cerraba sin cobrar, el número se perdía.
--
-- SOLUCIÓN (solo aditiva, no toca ventas ya guardadas ni sus números):
--   1) Cada número entregado queda anotado como 'reservado'.
--   2) liberar_numero_venta() lo marca 'libre' si la venta no se guardó.
--   3) generar_numero_venta() entrega primero un número 'libre'; si no hay,
--      uno 'reservado' abandonado hace más de 6 horas (cerró el navegador);
--      y solo si no hay ninguno, sube el contador como antes.
--   Los huecos viejos NO se reutilizan (para no desordenar facturas ya emitidas).
-- ============================================================================

create table if not exists public.ventas_numeros_reservados (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  numero       integer not null,
  estado       text not null default 'reservado' check (estado in ('reservado', 'libre')),
  reservado_at timestamptz not null default now(),
  liberado_at  timestamptz,
  primary key (auth_user_id, numero)
);

alter table public.ventas_numeros_reservados enable row level security;

drop policy if exists ventas_numeros_reservados_propia on public.ventas_numeros_reservados;
create policy ventas_numeros_reservados_propia on public.ventas_numeros_reservados
  for select using (auth_user_id = (select auth.uid()));

-- Para comprobar rápido si un número ya lo usa una venta.
create index if not exists idx_ventas_user_numero_venta on public.ventas (auth_user_id, numero_venta);

create or replace function public.generar_numero_venta(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_numero integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'No autorizado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_numvta:' || p_user_id::text, 0));

  -- Limpieza: reservas viejas cuyo número ya quedó en una venta guardada.
  delete from public.ventas_numeros_reservados r
   where r.auth_user_id = p_user_id and r.reservado_at < now() - interval '1 day'
     and exists (select 1 from public.ventas v
                  where v.auth_user_id = p_user_id and v.numero_venta = 'V-' || lpad(r.numero::text, 6, '0'));

  -- 1) Un número que se liberó (se cerró la ventana sin cobrar).
  select r.numero into v_numero from public.ventas_numeros_reservados r
   where r.auth_user_id = p_user_id and r.estado = 'libre'
     and not exists (select 1 from public.ventas v
                      where v.auth_user_id = p_user_id and v.numero_venta = 'V-' || lpad(r.numero::text, 6, '0'))
   order by r.numero limit 1;

  -- 2) Un número reservado hace más de 6 horas que nunca llegó a ser venta.
  if v_numero is null then
    select r.numero into v_numero from public.ventas_numeros_reservados r
     where r.auth_user_id = p_user_id and r.estado = 'reservado' and r.reservado_at < now() - interval '6 hours'
       and not exists (select 1 from public.ventas v
                        where v.auth_user_id = p_user_id and v.numero_venta = 'V-' || lpad(r.numero::text, 6, '0'))
     order by r.numero limit 1;
  end if;

  if v_numero is not null then
    update public.ventas_numeros_reservados
       set estado = 'reservado', reservado_at = now(), liberado_at = null
     where auth_user_id = p_user_id and numero = v_numero;
  else
    -- 3) Ninguno disponible: número nuevo, como siempre.
    insert into public.ventas_numeracion(auth_user_id, ultimo_numero) values (p_user_id, 1)
      on conflict (auth_user_id) do update set ultimo_numero = ventas_numeracion.ultimo_numero + 1
      returning ultimo_numero into v_numero;
    insert into public.ventas_numeros_reservados(auth_user_id, numero) values (p_user_id, v_numero)
      on conflict (auth_user_id, numero) do update set estado = 'reservado', reservado_at = now(), liberado_at = null;
  end if;

  return 'V-' || lpad(v_numero::text, 6, '0');
end;
$function$;

create or replace function public.liberar_numero_venta(p_user_id uuid, p_numero text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer; v_ultimo integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'No autorizado'; end if;
  v_n := nullif(substring(coalesce(p_numero, '') from '^V-(\d{1,9})$'), '')::integer;
  if v_n is null or v_n < 1 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_numvta:' || p_user_id::text, 0));

  -- Si ya hay una venta con ese número (de cualquier estado), jamás se libera.
  if exists (select 1 from public.ventas v where v.auth_user_id = p_user_id and v.numero_venta = p_numero) then
    return false;
  end if;

  select ultimo_numero into v_ultimo from public.ventas_numeracion where auth_user_id = p_user_id;
  if v_ultimo is null or v_n > v_ultimo then return false; end if;

  insert into public.ventas_numeros_reservados(auth_user_id, numero, estado, liberado_at)
  values (p_user_id, v_n, 'libre', now())
  on conflict (auth_user_id, numero) do update set estado = 'libre', liberado_at = now();
  return true;
end;
$function$;

revoke all on function public.liberar_numero_venta(uuid, text) from public, anon;
grant execute on function public.liberar_numero_venta(uuid, text) to authenticated;
