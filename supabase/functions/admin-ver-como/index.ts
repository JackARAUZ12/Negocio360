// Edge Function: admin-ver-como
// Permite a un ADMINISTRADOR (tabla administradores) abrir la cuenta de un cliente
// en modo SOLO LECTURA. Esta funcion solo entrega un pase de un solo uso para
// iniciar una sesion aparte; el bloqueo de escritura lo aplica ver-como.js en el
// navegador. No modifica datos del cliente y deja constancia en admin_vistas_cliente.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';

    // 1) Quien llama debe ser un usuario autenticado...
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: eu } = await userClient.auth.getUser();
    if (eu || !user || !user.email) return json({ error: 'No autorizado' }, 401);

    const admin = createClient(url, service);

    // 2) ...y ser administrador activo.
    const { data: adm } = await admin.from('administradores').select('id')
      .eq('email', user.email).eq('activo', true).maybeSingle();
    if (!adm) return json({ error: 'Solo administradores' }, 403);

    // 3) Cliente a ver
    const { auth_user_id } = await req.json().catch(() => ({}));
    if (!auth_user_id || typeof auth_user_id !== 'string') return json({ error: 'Falta el cliente' }, 400);

    const { data: fila } = await admin.from('usuarios')
      .select('auth_user_id,email,nombre_negocio').eq('auth_user_id', auth_user_id).maybeSingle();
    if (!fila || !fila.email) return json({ error: 'Cliente no encontrado' }, 404);

    // No se permite abrir otra cuenta de administrador.
    const { data: esAdm } = await admin.from('administradores').select('id')
      .eq('email', fila.email).eq('activo', true).maybeSingle();
    if (esAdm) return json({ error: 'No se puede abrir una cuenta de administrador' }, 403);

    // 4) Pase de un solo uso (no envia correo, no cambia la contrasena del cliente).
    const { data: enlace, error: ee } = await admin.auth.admin.generateLink({ type: 'magiclink', email: fila.email });
    const token_hash = enlace?.properties?.hashed_token;
    if (ee || !token_hash) return json({ error: 'No se pudo preparar el acceso' }, 500);

    // 5) Bitacora (si falla, no se entrega el pase: siempre debe quedar constancia).
    const { error: eb } = await admin.from('admin_vistas_cliente').insert({
      admin_email: user.email, cliente_auth_id: fila.auth_user_id,
      cliente_email: fila.email, cliente_negocio: fila.nombre_negocio ?? null,
    });
    if (eb) return json({ error: 'No se pudo registrar la bitácora' }, 500);

    return json({ ok: true, token_hash, email: fila.email, negocio: fila.nombre_negocio ?? '' });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
