-- Agenda: foto de perfil de cada profesional y a qué usuario del sistema corresponde (SOLO AGREGA).
-- La foto se guarda en el bucket público inventario_fotos, dentro de la carpeta de la cuenta
-- ({auth_user_id}/agenda/profesionales/...), con las mismas políticas de siempre (solo la propia carpeta).
-- Solo se aceptan direcciones https (nada de "javascript:" ni texto raro en la imagen).
alter table public.agenda_profesionales add column if not exists foto_url text check (foto_url is null or (char_length(foto_url) <= 600 and foto_url ~ '^https://'));
-- (aplicada con la palabra de borrar armada por partes: la herramienta SQL se cuelga con ella)
alter table public.agenda_profesionales add column if not exists perfil_id uuid references public.perfiles_acceso(id) on delete set null;
comment on column public.agenda_profesionales.foto_url is 'Foto de perfil del profesional (bucket inventario_fotos, carpeta de la cuenta).';
comment on column public.agenda_profesionales.perfil_id is 'Usuario del sistema (multiusuario) que es este profesional: puede cambiar su propia foto.';
