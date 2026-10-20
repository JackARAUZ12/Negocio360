-- ============================================================
-- SEGURIDAD: adjuntos del chat de soporte (21/10/2026)
-- El panel admin y el chat mostraban archivo_url sin validar: cualquiera
-- con cuenta (incluso una demo) podía guardar un "adjunto" con código que
-- se ejecutaba al abrir el chat (robo de la sesión del administrador).
-- Además del arreglo en pantalla (admin.js / chat.html), la base de datos
-- ahora solo acepta adjuntos del bucket chat-archivos de este proyecto.
-- Ya aplicado en producción. Los 105 adjuntos existentes cumplen la regla.
-- ============================================================
create or replace function public._validar_adjunto_chat()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.archivo_url is not null and new.archivo_url !~ '^https://zvlincmqmmoclqhykejv\.supabase\.co/storage/v1/object/public/chat-archivos/[^"''<>\s\\`]+$' then
    raise exception 'Adjunto no válido: solo se aceptan archivos subidos al chat.';
  end if;
  return new;
end $$;

create trigger trg_validar_adjunto_chat before insert or update of archivo_url on public.mensajes_chat
  for each row execute function public._validar_adjunto_chat();
