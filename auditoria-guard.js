/* ============================================================
   AUDITORIA-GUARD.JS — NEGOCIO360
   ------------------------------------------------------------
   Registra automáticamente cada movimiento (crear/editar/borrar)
   que ocurre en CUALQUIER módulo del sistema, sin que ese módulo
   tenga que llamar a nada ni saber que esto existe.

   CÓMO FUNCIONA (la "señal" que pediste):
   Todos los módulos de Negocio360 crean su conexión a Supabase
   exactamente igual:
     const sb = window.supabase.createClient(URL, KEY)
   Este script se carga en el <head>, ANTES que el script propio
   de cada módulo, y "envuelve" window.supabase.createClient antes
   de que nadie lo use. Así, sin importar qué módulo se cree hoy o
   mañana, en cuanto llama a createClient() recibe automáticamente
   una versión que audita sola cada .insert()/.update()/.delete().

   Por eso, un módulo nuevo NUNCA necesita agregar código de
   auditoría — con que use el mismo patrón de siempre para conectar
   a Supabase (que ya usan todos), queda auditado desde el día uno.

   Nunca bloquea ni retrasa la operación original: el registro de
   auditoría se dispara en segundo plano (fire-and-forget) y
   cualquier error suyo se ignora en silencio — jamás puede romper
   el módulo que lo originó.
   ============================================================ */
'use strict';

(function () {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') return;

  // Tablas que NUNCA se auditan: la propia bitácora (evita bucles),
  // y tablas con datos sensibles de autenticación que no aportan
  // nada útil a un rastro de auditoría de negocio.
  // 'usuarios' se excluye porque perfiles-guard.js la actualiza cada ~45s
  // (latido de presencia / última conexión) — eso no es un "movimiento"
  // que le importe al dueño del negocio, solo ensuciaría el registro.
  const TABLAS_EXCLUIDAS = new Set(['auditoria_log', 'perfiles_acceso', 'codigos_acceso', 'admin_usuarios', 'usuarios']);

  // Campos que sí sirven como "resumen" legible de un movimiento.
  // Deliberadamente NO se incluye el payload completo (podría traer
  // datos sensibles o simplemente ser muy grande) — solo un par de
  // pistas útiles para identificar de qué registro se trataba.
  const CAMPOS_RESUMEN = ['nombre', 'titulo', 'numero', 'numero_venta', 'nombre_comercial',
    'concepto', 'descripcion', 'estado', 'total', 'monto', 'cargo'];

  function currentFile() {
    const f = location.pathname.split('/').pop() || 'dashboard.html';
    return f.includes('.') ? f : 'dashboard.html';
  }

  function getPerfilActivo() {
    try {
      const raw = sessionStorage.getItem('n360_perfil_activo');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function resumirPayload(datos) {
    if (!datos) return null;
    if (Array.isArray(datos)) return `${datos.length} registro${datos.length === 1 ? '' : 's'}`;
    if (typeof datos !== 'object') return null;
    const partes = [];
    for (const campo of CAMPOS_RESUMEN) {
      if (datos[campo] !== undefined && datos[campo] !== null && datos[campo] !== '') {
        partes.push(`${campo}: ${String(datos[campo]).slice(0, 60)}`);
      }
      if (partes.length >= 3) break;
    }
    return partes.join(' · ') || null;
  }

  async function registrar(client, authUserId, tabla, accion, datos) {
    try {
      const perfil = getPerfilActivo();
      // Se usa el MISMO cliente que ya hizo la operación real — ya está
      // autenticado, sin depender de que un cliente nuevo alcance a
      // restaurar la sesión a tiempo. 'auditoria_log' está en
      // TABLAS_EXCLUIDAS, así que este .from() no vuelve a envolverse
      // (sin riesgo de bucle).
      await client.from('auditoria_log').insert({
        auth_user_id: authUserId,
        perfil_nombre: perfil?.nombre || 'Admin',
        perfil_tipo: perfil?.tipo === 'restringido' ? 'restringido' : 'admin',
        modulo: currentFile(),
        tabla,
        accion,
        resumen: resumirPayload(datos),
      });
    } catch (_) { /* la auditoría nunca debe afectar al módulo original */ }
  }

  // Envuelve el resultado de client.from(tabla) para interceptar
  // insert/update/delete SIN alterar su comportamiento ni su valor
  // de retorno — cada método sigue siendo encadenable exactamente
  // igual (.insert(x).select().single(), etc.).
  function envolverQueryBuilder(client, tabla, qb) {
    if (TABLAS_EXCLUIDAS.has(tabla)) return qb;

    ['insert', 'update', 'delete'].forEach(metodo => {
      const original = qb[metodo];
      if (typeof original !== 'function') return;
      qb[metodo] = function (...args) {
        const resultado = original.apply(qb, args);
        // Fire-and-forget: no se espera ni se bloquea nada del módulo.
        // getSession() lee de memoria/local storage (sin red), así no se
        // suma una llamada extra de red a cada escritura del sistema.
        client.auth.getSession().then(({ data }) => {
          const uid = data?.session?.user?.id;
          if (uid) registrar(client, uid, tabla, metodo.toUpperCase(), args[0]);
        }).catch(() => {});
        return resultado;
      };
    });
    return qb;
  }

  function envolverCliente(client) {
    if (client.__n360Auditado) return client; // ya envuelto: nunca dos veces el mismo cliente
    client.__n360Auditado = true;
    const originalFrom = client.from.bind(client);
    client.from = function (tabla) {
      return envolverQueryBuilder(client, tabla, originalFrom(tabla));
    };
    return client;
  }

  const originalCreateClient = window.supabase.createClient;
  window.supabase.createClient = function (...args) {
    const client = originalCreateClient.apply(window.supabase, args);
    try { return envolverCliente(client); } catch (_) { return client; }
  };
})();
