-- Permisos de acceso entre negocios: qué usuarios (perfiles) de ESTE negocio pueden pasar a los otros negocios del grupo.
-- El administrador siempre puede. Vacío = solo administrador. (05-nov-2026)
alter table public.configuracion_empresa add column if not exists empresa_perfiles_cambio jsonb;
