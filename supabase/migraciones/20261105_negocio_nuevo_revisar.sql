-- Antes de crear la cuenta de un negocio nuevo, revisar permiso y límite (05-nov-2026).
-- Así, si no se puede, falla ANTES de crear la cuenta y no quedan cuentas sueltas.
create or replace function public.negocio_nuevo_revisar()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_mi_email text; v_lim integer; v_n integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'mensaje', 'Sin sesión activa'); end if;
  select lower(email) into v_mi_email from auth.users where id = v_uid;
  if v_mi_email is null or v_mi_email like '%@negocio360.internal' then
    return jsonb_build_object('ok', false, 'mensaje', 'Solo la cuenta principal puede crear negocios.'); end if;
  select coalesce(limite_negocios, 1) into v_lim from usuarios where auth_user_id = v_uid;
  select 1 + count(*) into v_n from negocios_vinculados where auth_user_id_principal = v_uid and not es_principal and activo;
  if v_n >= coalesce(v_lim, 1) then
    return jsonb_build_object('ok', false, 'mensaje', 'Tu cuenta ya llegó al límite de negocios (' || coalesce(v_lim, 1) || ').'); end if;
  return jsonb_build_object('ok', true, 'disponibles', coalesce(v_lim, 1) - v_n);
end $$;
revoke all on function public.negocio_nuevo_revisar() from public, anon;
grant execute on function public.negocio_nuevo_revisar() to authenticated;
