// Edge Function: clinica-adjuntos (Módulo Clínica — Fase 2)
// El bucket "clinica-adjuntos" es PRIVADO y no tiene políticas: el navegador no puede leer ni
// escribir ahí. Esta función valida al usuario Y su sesión clínica (llamando a las funciones
// clinica_adjunto_* COMO ese usuario, así el servidor aplica el candado, el registro en la
// bitácora y las reglas de tipo y tamaño) y solo entonces entrega un enlace firmado temporal.
//   accion 'subir'     -> registra el adjunto y devuelve un enlace de subida (de un solo uso)
//   accion 'confirmar' -> verifica que el archivo llegó (y su tamaño) y lo deja disponible
//   accion 'ver'       -> enlace de lectura válido 2 minutos (queda en la bitácora)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'clinica-adjuntos';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, motivo: 'metodo' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';
    const usuario = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: eu } = await usuario.auth.getUser();
    if (eu || !user) return json({ ok: false, motivo: 'no_autenticado' }, 401);

    const b = await req.json().catch(() => ({}));
    const token = String(b.token || '');
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, motivo: 'sesion' }, 403);
    const admin = createClient(url, service);
    const errorSesion = (e: { message?: string } | null) => e && String(e.message || '').includes('clinica_sesion_invalida');

    if (b.accion === 'subir') {
      if (!esUuid(b.paciente_id) || (b.consulta_id && !esUuid(b.consulta_id))) return json({ ok: false, motivo: 'datos' }, 400);
      const { data: r, error } = await usuario.rpc('clinica_adjunto_preparar', {
        p_token: token, p_paciente_id: b.paciente_id, p_consulta_id: b.consulta_id || null,
        p_nombre: String(b.nombre || '').slice(0, 150), p_mime: String(b.mime || ''), p_tamano: Number(b.tamano) | 0,
        p_descripcion: b.descripcion ? String(b.descripcion).slice(0, 300) : null,
      });
      if (error) return json({ ok: false, motivo: errorSesion(error) ? 'sesion' : 'error' }, errorSesion(error) ? 403 : 400);
      if (!r?.ok) return json(r, 400);
      const { data: s, error: es } = await admin.storage.from(BUCKET).createSignedUploadUrl(r.ruta);
      if (es || !s) return json({ ok: false, motivo: 'almacen' }, 500);
      return json({ ok: true, id: r.id, ruta: r.ruta, subida: s.token });
    }

    if (b.accion === 'confirmar' || b.accion === 'ver') {
      if (!esUuid(b.id)) return json({ ok: false, motivo: 'datos' }, 400);
      const { data: r, error } = await usuario.rpc('clinica_adjunto_ruta', { p_token: token, p_id: b.id, p_para: b.accion === 'ver' ? 'ver' : 'subir' });
      if (error) return json({ ok: false, motivo: errorSesion(error) ? 'sesion' : 'error' }, errorSesion(error) ? 403 : 400);
      if (!r?.ok) return json(r, 404);
      if (b.accion === 'ver') {
        const { data: s, error: es } = await admin.storage.from(BUCKET).createSignedUrl(r.ruta, 120);
        if (es || !s) return json({ ok: false, motivo: 'almacen' }, 500);
        return json({ ok: true, url: s.signedUrl, nombre: r.nombre, mime: r.mime });
      }
      // confirmar: el archivo debe existir de verdad en el almacén (y respetar el límite)
      const carpeta = r.ruta.slice(0, r.ruta.lastIndexOf('/'));
      const nombre = r.ruta.slice(r.ruta.lastIndexOf('/') + 1);
      const { data: lista } = await admin.storage.from(BUCKET).list(carpeta, { search: nombre, limit: 5 });
      const obj = (lista || []).find((o: { name: string }) => o.name === nombre) as { metadata?: { size?: number } } | undefined;
      if (!obj) return json({ ok: false, motivo: 'archivo_no_llego' }, 409);
      if ((obj.metadata?.size ?? 0) > 10485760) return json({ ok: false, motivo: 'tamano' }, 400);
      const { data: c, error: ec } = await usuario.rpc('clinica_adjunto_confirmar', { p_token: token, p_id: b.id });
      if (ec || !c?.ok) return json({ ok: false, motivo: 'error' }, 400);
      return json({ ok: true });
    }
    return json({ ok: false, motivo: 'accion' }, 400);
  } catch (_e) {
    return json({ ok: false, motivo: 'error' }, 500);
  }
});
