-- =====================================================================
-- Ciclo opcional (Fase 3c): ANTICIPO al pasar un pedido a producción.
-- SOLO AGREGA. No se crea contabilidad nueva: el anticipo usa el Certificado de regalo en modo
-- 'anticipo' (ya existente y auditado): el dinero entra a Caja HOY como ingreso ligado al certificado
-- (NO es venta); la venta se reconoce cuando el cliente "usa" el certificado como forma de pago, con el
-- IVA ya resuelto por esa misma lógica. Esta función solo lo emite desde la proforma y deja el vínculo.
--
-- Candados: opción propia apagada por defecto; exige "Pedidos con producción" y "Certificados" activos;
-- solo proformas aprobadas y propias; la suma de anticipos vigentes nunca pasa del total de la proforma;
-- una sola operación a la vez por proforma; no se borra una proforma con anticipo sin usar.
-- =====================================================================

alter table public.configuracion_empresa
  add column if not exists usa_anticipo_pedidos boolean not null default false;

create table if not exists public.proforma_anticipos (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  proforma_id    uuid not null references public.proformas(id) on delete cascade,
  certificado_id uuid not null references public.certificados_regalo(id) on delete cascade,
  monto          numeric(14,2) not null check (monto > 0),
  created_at     timestamptz not null default now(),
  unique (certificado_id)
);
create index if not exists proforma_anticipos_prof_idx on public.proforma_anticipos(proforma_id);
create index if not exists proforma_anticipos_user_idx on public.proforma_anticipos(auth_user_id);
alter table public.proforma_anticipos enable row level security;
drop policy if exists proforma_anticipos_ver on public.proforma_anticipos;
create policy proforma_anticipos_ver on public.proforma_anticipos
  for select using (auth_user_id = (select auth.uid()));

create or replace function public.proforma_cobrar_anticipo(p_proforma_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_uid uuid := auth.uid(); pf record; v_ciclo boolean; v_ant boolean; v_cert boolean;
  v_monto numeric; v_previo numeric; v_res jsonb; v_cid uuid; v_pp jsonb;
begin
  if v_uid is null then raise exception 'no autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('n360_prof_ant:' || p_proforma_id::text, 0));

  select coalesce(usa_ciclo_produccion_pedidos, false), coalesce(usa_anticipo_pedidos, false), coalesce(usa_modulo_certificados, false)
    into v_ciclo, v_ant, v_cert from public.configuracion_empresa where auth_user_id = v_uid;
  if not (coalesce(v_ciclo, false) and coalesce(v_ant, false)) then return jsonb_build_object('ok', false, 'motivo', 'desactivado'); end if;
  if not coalesce(v_cert, false) then return jsonb_build_object('ok', false, 'motivo', 'sin_certificados'); end if;

  select * into pf from public.proformas where id = p_proforma_id and auth_user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if pf.estado <> 'aprobada' then return jsonb_build_object('ok', false, 'motivo', 'estado', 'estado', pf.estado); end if;

  v_monto := round(coalesce(nullif(p ->> 'monto', '')::numeric, 0), 2);
  if v_monto <= 0 then return jsonb_build_object('ok', false, 'motivo', 'monto'); end if;

  select coalesce(sum(a.monto), 0) into v_previo
    from public.proforma_anticipos a join public.certificados_regalo c on c.id = a.certificado_id
   where a.proforma_id = pf.id and a.auth_user_id = v_uid and c.estado <> 'anulado';
  if v_previo + v_monto > coalesce(pf.total, 0) then
    return jsonb_build_object('ok', false, 'motivo', 'excede', 'total', pf.total, 'ya_cobrado', v_previo);
  end if;

  v_pp := jsonb_build_object(
    'monto', v_monto, 'modo', 'anticipo', 'uso_parcial', true,
    'comprador_cliente_id', pf.cliente_id, 'comprador_nombre', pf.cliente_nombre,
    'beneficiario_cliente_id', pf.cliente_id, 'beneficiario_nombre', pf.cliente_nombre,
    'mensaje', 'Anticipo de la proforma ' || pf.numero_proforma,
    'metodo_pago_id', p -> 'metodo_pago_id', 'metodo_pago_nombre', p -> 'metodo_pago_nombre',
    'banco_id', p -> 'banco_id', 'creado_por', p -> 'creado_por');
  v_res := public.certificado_emitir(v_pp);
  v_cid := (v_res ->> 'id')::uuid;

  insert into public.proforma_anticipos(auth_user_id, proforma_id, certificado_id, monto)
  values (v_uid, pf.id, v_cid, v_monto);

  return jsonb_build_object('ok', true, 'codigo', v_res ->> 'codigo', 'certificado_id', v_cid, 'monto', v_monto);
end;
$f$;
revoke all on function public.proforma_cobrar_anticipo(uuid, jsonb) from public, anon;
grant execute on function public.proforma_cobrar_anticipo(uuid, jsonb) to authenticated;

-- Candado: no se borra una proforma con anticipo cobrado y sin usar (el dinero quedaría sin dueño visible).
create or replace function public._proforma_candado_anticipo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
begin
  if exists (select 1 from public.proforma_anticipos a join public.certificados_regalo c on c.id = a.certificado_id
              where a.proforma_id = old.id and c.estado = 'activo' and c.saldo > 0) then
    raise exception 'Esta proforma tiene un anticipo cobrado sin usar. Úsalo en la venta o anula el certificado antes de eliminarla.' using errcode = 'P0001';
  end if;
  return old;
end;
$f$;
drop trigger if exists trg_proforma_candado_anticipo on public.proformas;
create trigger trg_proforma_candado_anticipo before delete on public.proformas
  for each row execute function public._proforma_candado_anticipo();
