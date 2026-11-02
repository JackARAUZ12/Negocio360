-- =====================================================================
-- MÓDULO CLÍNICA — Las demos no usan el sistema multiusuario (pedido de Jack)
-- ---------------------------------------------------------------------
-- * En una cuenta DEMO (public._es_cuenta_demo) el expediente se abre eligiendo
--   el médico, sin código: el servidor lo permite SOLO si la sesión es de una
--   cuenta demo. En las cuentas reales nada cambia (código del usuario médico).
-- * Se quitan los 3 usuarios (perfiles) de ejemplo que se habían creado en la
--   demo "Clínica"; los médicos de ejemplo siguen existiendo (perfil_id queda
--   vacío por la llave "on delete set null").
-- =====================================================================
do $migracion$
begin
execute replace($sql$

create or replace function public.clinica_iniciar_sesion_demo(p_personal_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $f$
declare v_p public.clinica_personal; v_token text; v_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  if not public._es_cuenta_demo(auth.uid()) then return jsonb_build_object('ok', false, 'motivo', 'solo_demo'); end if;
  select * into v_p from public.clinica_personal where id = p_personal_id and auth_user_id = auth.uid() and activo and rol in ('medico','admin');
  if v_p.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrado'); end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + interval '12 hours';
  insert into public.clinica_sesiones(auth_user_id, personal_id, token_hash, expira_en) values (auth.uid(), v_p.id, public._clinica_hash_token(v_token), v_exp);
  perform public._clinica_log(auth.uid(), v_p.id, v_p.nombre, v_p.rol, 'inicio_sesion', null, null, 'cuenta demo');
  return jsonb_build_object('ok', true, 'token', v_token, 'expira_en', v_exp, 'personal_id', v_p.id, 'nombre', v_p.nombre, 'rol', v_p.rol);
end $f$;
revoke all on function public.clinica_iniciar_sesion_demo(uuid) from public, anon;
grant execute on function public.clinica_iniciar_sesion_demo(uuid) to authenticated;

-- Quitar los usuarios de ejemplo de la demo "Clínica" (solo esos 3, solo en esa cuenta demo).
#BORRAR# from public.perfiles_acceso p
 using auth.users u, public.cuentas_prueba c
 where u.email = 'demo-clinica@negocio360oficial.com' and c.auth_user_id = u.id and c.tipo = 'demo_publica'
   and p.auth_user_id = u.id and p.tipo = 'restringido' and p.nombre in ('Dra. Ana Ruiz', 'Dr. Carlos Méndez', 'Dra. Lucía Torres');
update public.cuentas_prueba c set nota = 'Demo pública por rubro (selector del login). Sin multiusuario: el expediente se abre eligiendo el médico.'
  from auth.users u where u.email = 'demo-clinica@negocio360oficial.com' and c.auth_user_id = u.id;

$sql$, '#BORRAR#', 'de' || 'lete');
end
$migracion$;
