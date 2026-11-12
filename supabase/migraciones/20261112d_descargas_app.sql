-- =====================================================================
-- DESCARGAS DESDE LA APP DE ANDROID (12-nov-2026)
-- Dentro de la app (ventana web de Capacitor) los PDF/Excel generados en el
-- navegador (blob:) no se pueden guardar. La página sube el archivo un momento
-- a esta carpeta PRIVADA de la persona y lo abre en Chrome, que sí lo guarda.
-- Cada persona solo ve/borra lo suyo (carpeta = su usuario). Enlace de 5 min.
-- Solo AGREGA un bucket nuevo. No toca ventas, Caja ni inventario.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('descargas-app', 'descargas-app', false, 26214400)
on conflict (id) do nothing;

drop policy if exists descargas_app_subir on storage.objects;
create policy descargas_app_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'descargas-app' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists descargas_app_leer on storage.objects;
create policy descargas_app_leer on storage.objects for select to authenticated
  using (bucket_id = 'descargas-app' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists descargas_app_borrar on storage.objects;
create policy descargas_app_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'descargas-app' and (storage.foldername(name))[1] = auth.uid()::text);
