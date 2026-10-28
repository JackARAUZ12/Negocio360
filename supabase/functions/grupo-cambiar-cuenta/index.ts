// Edge Function: grupo-cambiar-cuenta
// Pasa de una cuenta del grupo (Central, sucursal o bodega) a otra del MISMO grupo
// sin pedir contraseñas ni leerlas. Entrega un pase de un solo uso para la cuenta
// destino. Condiciones: quien llama pertenece al grupo y el destino es una
// sucursal/bodega activa de ese mismo grupo. Sin constancia en la bitácora no hay pase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: eu } = await userClient.auth.getUser();
    if (eu || !user) return json({ error: 'No autorizado' }, 401);

    const body = await req.json().catch(() => ({}));
    const sucursalId = typeof body?.sucursal_id === 'string' ? body.sucursal_id : '';
    if (!/^[0-9a-f-]{36}$/i.test(sucursalId)) return json({ error: 'Destino no válido' }, 400);

    const admin = createClient(url, service);

    // Grupo de quien llama: es la Central, o una sucursal/bodega de una Central.
    let central: string | null = null;
    const { data: comoCentral } = await admin.from('sucursales').select('auth_user_id_central')
      .eq('auth_user_id_central', user.id).limit(1).maybeSingle();
    if (comoCentral) central = comoCentral.auth_user_id_central;
    if (!central) {
      const { data: comoHija } = await admin.from('sucursales').select('auth_user_id_central')
        .eq('auth_user_id_sucursal', user.id).eq('es_central', false).limit(1).maybeSingle();
      if (comoHija) central = comoHija.auth_user_id_central;
    }
    if (!central) return json({ error: 'Tu cuenta no pertenece a un grupo' }, 403);

    // Destino: sucursal/bodega activa, del mismo grupo, que no sea la Central ni yo.
    const { data: dest } = await admin.from('sucursales')
      .select('id, nombre, tipo, activa, es_central, auth_user_id_central, auth_user_id_sucursal')
      .eq('id', sucursalId).maybeSingle();
    if (!dest || dest.auth_user_id_central !== central || dest.es_central || !dest.activa
        || !dest.auth_user_id_sucursal || dest.auth_user_id_sucursal === user.id) {
      return json({ error: 'Esa cuenta no es parte de tu grupo' }, 403);
    }

    const { data: ud, error: eud } = await admin.auth.admin.getUserById(dest.auth_user_id_sucursal);
    const email = ud?.user?.email;
    if (eud || !email) return json({ error: 'No se encontró la cuenta destino' }, 404);
    const { data: cuenta } = await admin.from('usuarios').select('estado_cuenta')
      .eq('auth_user_id', dest.auth_user_id_sucursal).maybeSingle();
    if (cuenta && ['suspendida', 'cancelada'].includes(cuenta.estado_cuenta)) {
      return json({ error: 'La cuenta destino está suspendida' }, 403);
    }
    const { data: esAdm } = await admin.from('administradores').select('id').eq('email', email).eq('activo', true).maybeSingle();
    if (esAdm) return json({ error: 'No permitido' }, 403);

    const { error: el } = await admin.from('grupo_cambios_log').insert({
      central_auth_id: central, desde_auth_id: user.id,
      hacia_auth_id: dest.auth_user_id_sucursal, hacia_nombre: dest.nombre,
    });
    if (el) return json({ error: 'No se pudo registrar el cambio' }, 500);

    const { data: enlace, error: ee } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const token_hash = enlace?.properties?.hashed_token;
    if (ee || !token_hash) return json({ error: 'No se pudo preparar el acceso' }, 500);

    return json({ ok: true, token_hash, destino_auth_id: dest.auth_user_id_sucursal, nombre: dest.nombre, tipo: dest.tipo });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
