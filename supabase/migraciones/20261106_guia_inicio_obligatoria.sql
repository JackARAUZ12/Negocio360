-- Guía de inicio OBLIGATORIA (solo la primera vez, solo cuentas NUEVAS)
-- Pasos: caja (dinero inicial) -> producto (primer producto/servicio) -> tutoriales -> listo
-- Cuentas existentes: columna NULL = no aplica (nada les cambia).
-- Solo LEE para decidir; la única escritura es la propia columna guia_inicio_paso.

alter table public.configuracion_empresa
  add column if not exists guia_inicio_paso text
  check (guia_inicio_paso is null or guia_inicio_paso in ('caja','producto','tutoriales','listo'));

-- Cuenta nueva -> empieza en 'caja'
create or replace function public._guia_inicio_nueva() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.guia_inicio_paso is null then new.guia_inicio_paso := 'caja'; end if;
  return new;
end $$;
drop trigger if exists trg_guia_inicio_nueva on public.configuracion_empresa;
create trigger trg_guia_inicio_nueva before insert on public.configuracion_empresa
  for each row execute function public._guia_inicio_nueva();

-- Candado: el navegador no puede saltarse pasos cambiando la columna a mano.
-- (No da error, simplemente conserva el valor anterior: nunca rompe otro guardado.)
create or replace function public._guia_inicio_candado() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.guia_inicio_paso is distinct from old.guia_inicio_paso
     and coalesce(current_setting('n360.guia_ok', true), '') <> '1'
     and auth.uid() is not null and not public.is_admin_activo() then
    new.guia_inicio_paso := old.guia_inicio_paso;
  end if;
  return new;
end $$;
drop trigger if exists trg_guia_inicio_candado on public.configuracion_empresa;
create trigger trg_guia_inicio_candado before update of guia_inicio_paso on public.configuracion_empresa
  for each row execute function public._guia_inicio_candado();

-- Estado y avance: el servidor comprueba que cada paso esté HECHO de verdad.
create or replace function public.guia_inicio_estado(p_tutoriales_visto boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_paso text; v_onb boolean; v_multi boolean; v_nuevo text;
begin
  if v_uid is null then return jsonb_build_object('paso','listo'); end if;
  select multiusuario_activo into v_multi from usuarios where auth_user_id = v_uid limit 1;
  if public._es_cuenta_demo(v_uid) then
    return jsonb_build_object('paso','demo','multiusuario', coalesce(v_multi, true));
  end if;
  select guia_inicio_paso, onboarding_completado into v_paso, v_onb
    from configuracion_empresa where auth_user_id = v_uid limit 1;
  if v_paso is null or v_paso = 'listo' then return jsonb_build_object('paso','listo'); end if;
  -- Sucursales y cuentas solo-Catálogo360 no pasan por la guía
  if exists (select 1 from sucursales where auth_user_id_sucursal = v_uid and es_central = false)
     or exists (select 1 from catalogo_suscripciones where auth_user_id = v_uid and es_independiente) then
    return jsonb_build_object('paso','listo');
  end if;
  if not coalesce(v_onb, false) then return jsonb_build_object('paso','espera'); end if;

  v_nuevo := v_paso;
  if v_nuevo = 'caja' and (exists (select 1 from movimientos_financieros where auth_user_id = v_uid)
                           or exists (select 1 from capital_negocio where auth_user_id = v_uid)) then
    v_nuevo := 'producto';
  end if;
  if v_nuevo = 'producto' and exists (select 1 from productos where auth_user_id = v_uid) then
    v_nuevo := 'tutoriales';
  end if;
  if v_nuevo = 'tutoriales' and coalesce(p_tutoriales_visto, false) then
    v_nuevo := 'listo';
  end if;
  if v_nuevo <> v_paso then
    perform set_config('n360.guia_ok', '1', true);
    update configuracion_empresa set guia_inicio_paso = v_nuevo where auth_user_id = v_uid;
  end if;
  return jsonb_build_object('paso', v_nuevo, 'multiusuario', coalesce(v_multi, true));
end $$;
revoke all on function public.guia_inicio_estado(boolean) from public, anon;
grant execute on function public.guia_inicio_estado(boolean) to authenticated;
