// Edge Function: empresa-cambiar-negocio
// Pasa de un negocio a otro de la MISMA empresa vinculada (empresa_miembros)
// sin pedir correo ni contraseña. Solo entrega un pase de un solo uso para el
// negocio destino si quien llama y el destino están activos en la misma
// empresa. No guarda contraseñas, no cambia nada de ninguna cuenta y deja
// constancia en empresa_cambios_log (si la constancia falla, no hay pase).
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

    // 1) Quien llama: usuario con sesión válida.
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: eu } = await userClient.auth.getUser();
    if (eu || !user) return json({ error: 'No autorizado' }, 401);

    const body = await req.json().catch(() => ({}));
    const destino = typeof body?.destino === 'string' ? body.destino : '';
    const perfil = typeof body?.perfil === 'string' ? body.perfil.slice(0, 80) : null;
    if (!/^[0-9a-f-]{36}$/i.test(destino) || destino === user.id) return json({ error: 'Negocio destino no válido' }, 400);

    const admin = createClient(url, service);

    // 2) Los dos negocios, activos y en la MISMA empresa activa.
    const { data: filas, error: em } = await admin.from('empresa_miembros')
      .select('empresa_id, auth_user_id, nombre_negocio, activo, empresas_vinculadas!inner(activa)')
      .in('auth_user_id', [user.id, destino]);
    if (em) return json({ error: 'No se pudo revisar la empresa' }, 500);
    const yo = (filas || []).find((f: any) => f.auth_user_id === user.id);
    const otro = (filas || []).find((f: any) => f.auth_user_id === destino);
    const ok = (f: any) => f && f.activo && f.empresas_vinculadas?.activa;
    if (!ok(yo) || !ok(otro) || yo.empresa_id !== otro.empresa_id) {
      return json({ error: 'Ese negocio no es parte de tu empresa' }, 403);
    }

    // 3) Cuenta destino: debe existir, estar activa y no ser de administrador.
    const { data: ud, error: eud } = await admin.auth.admin.getUserById(destino);
    const email = ud?.user?.email;
    if (eud || !email) return json({ error: 'No se encontró el negocio destino' }, 404);
    const { data: cuenta } = await admin.from('usuarios').select('estado_cuenta').eq('auth_user_id', destino).maybeSingle();
    if (cuenta && ['suspendida', 'cancelada'].includes(cuenta.estado_cuenta)) {
      return json({ error: 'El negocio destino está suspendido' }, 403);
    }
    const { data: esAdm } = await admin.from('administradores').select('id').eq('email', email).eq('activo', true).maybeSingle();
    if (esAdm) return json({ error: 'No permitido' }, 403);

    // 4) Constancia primero: sin constancia no hay pase.
    const { error: el } = await admin.from('empresa_cambios_log').insert({
      empresa_id: yo.empresa_id, desde_auth_user_id: user.id, hacia_auth_user_id: destino, perfil_nombre: perfil,
    });
    if (el) return json({ error: 'No se pudo registrar el cambio' }, 500);

    // 5) Pase de un solo uso (no envía correo, no cambia la contraseña).
    const { data: enlace, error: ee } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const token_hash = enlace?.properties?.hashed_token;
    if (ee || !token_hash) return json({ error: 'No se pudo preparar el acceso' }, 500);

    return json({ ok: true, token_hash, destino, nombre_negocio: otro.nombre_negocio });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
