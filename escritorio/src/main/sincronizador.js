// Sube al servidor, una por una, las ventas guardadas en el equipo.
// Corre en el proceso principal: sigue aunque se cambie de pantalla.
//   - Usa la sesión que le pasa la página (nunca la renueva él mismo: de eso
//     se encarga la librería de Supabase de la página).
//   - Antes de subir: confirma que la cuenta tiene el modo sin conexión,
//     registra el equipo y aparta números de venta cuando quedan pocos.
//   - Cada venta viaja con su UUID: si se corta a mitad, reintentar no duplica.
//   - Errores de red: espera creciente. Errores de contenido: la venta queda
//     "con error" para revisarla en la pantalla Sincronización (nunca se borra).
'use strict';

const ESPERAS_MS = [5000, 15000, 60000, 300000];
const NUMEROS_MINIMOS = 15;
const MARGEN_TOKEN_S = 30;
const TIEMPO_MAXIMO_MS = 20000;

// Errores del servidor que no se arreglan reintentando la MISMA venta.
const ERRORES_DE_CONTENIDO = new Set(['formato', 'uuid_invalido', 'uuid_reutilizado', 'tipo_invalido', 'tipo_no_permitido', 'linea_invalida']);
// Errores que frenan todo (la cuenta o el equipo no pueden subir ahora).
const ERRORES_DE_CUENTA = new Set(['no_autorizado', 'cuenta_demo', 'no_habilitado', 'dispositivo_no_autorizado']);

const TEXTOS_ERROR = {
  formato: 'La venta tiene un formato que el servidor no reconoce.',
  uuid_invalido: 'La venta tiene un identificador inválido.',
  uuid_reutilizado: 'Ya existe en el servidor otra venta con el mismo identificador.',
  tipo_invalido: 'Tipo de venta no reconocido.',
  tipo_no_permitido: 'Fiado o crédito no se pueden registrar sin conexión.',
  linea_invalida: 'Una línea de la venta tiene datos inválidos.',
  no_autorizado: 'La sesión no es válida. Vuelve a iniciar sesión.',
  cuenta_demo: 'Las cuentas de demostración no usan el modo sin conexión.',
  no_habilitado: 'El modo sin conexión no está activo para esta cuenta.',
  dispositivo_no_autorizado: 'Este equipo no está autorizado para la cuenta.',
};

// Lee la parte pública del token (sin verificar la firma: eso lo hace el servidor).
function leerToken(token) {
  try {
    const parte = String(token).split('.')[1];
    return JSON.parse(Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (_) { return null; }
}

function codigoDeError(cuerpo) {
  const msg = String((cuerpo && (cuerpo.message || cuerpo.msg || cuerpo.error)) || '');
  const m = msg.match(/N360_OFFLINE:([a-z_]+)/);
  return m ? m[1] : null;
}

function crearSincronizador({
  base, fetch, url, clave, dispositivo = {},
  avisar = () => {},             // (evento) => void: cambios para las pantallas
  fijarPendientes = () => {},    // (n) => void: indicador 🟠
  hayConexion = () => true,
  reloj = { setTimeout, clearTimeout, ahora: () => Date.now() },
}) {
  let sesion = null;        // { token, cuenta, email, exp }
  let tokenRechazado = null;
  let enCurso = null;
  let temporizador = null;
  let fallosSeguidos = 0;
  let detenido = false;
  let ultimoError = null;
  let ultimaSubida = null;
  const verificadas = new Set(); // cuentas ya comprobadas/registradas en esta sesión

  const uidEquipo = base.dispositivoUid();

  function cuenta() { return sesion && sesion.cuenta; }

  function tokenUsable() {
    if (!sesion || sesion.token === tokenRechazado) return false;
    return !sesion.exp || sesion.exp - MARGEN_TOKEN_S > reloj.ahora() / 1000;
  }

  // s: { access_token, user_id, email } desde la página. Solo se acepta si el
  // token es de esa misma cuenta.
  function fijarSesion(s) {
    if (!s || !s.access_token) { sesion = null; publicar(); return { ok: true, cuenta: null }; }
    const datos = leerToken(s.access_token);
    if (!datos || !datos.sub || datos.sub !== s.user_id) return { ok: false, motivo: 'La sesión no corresponde a la cuenta.' };
    const cambio = !sesion || sesion.token !== s.access_token;
    sesion = { token: s.access_token, cuenta: datos.sub, email: s.email || datos.email || null, exp: Number(datos.exp) || null };
    if (cambio) { tokenRechazado = null; fallosSeguidos = 0; despertar(0); }
    publicar();
    return { ok: true, cuenta: sesion.cuenta };
  }

  async function llamar(funcion, cuerpo) {
    const res = await fetch(`${url}/rest/v1/rpc/${funcion}`, {
      method: 'POST',
      headers: { apikey: clave, Authorization: `Bearer ${sesion.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(cuerpo || {}),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    let datos = null;
    const texto = await res.text();
    try { datos = texto ? JSON.parse(texto) : null; } catch (_) { datos = { message: texto }; }
    if (res.status === 401 || (datos && /JWT|jwt/.test(String(datos.message || '')) && res.status >= 400 && res.status < 500)) {
      tokenRechazado = sesion.token;
      const e = new Error('sesion'); e.tipo = 'sesion'; throw e;
    }
    if (res.status >= 500) { const e = new Error(`servidor ${res.status}`); e.tipo = 'red'; throw e; }
    if (res.status >= 400) { const e = new Error(codigoDeError(datos) || String((datos && datos.message) || res.status)); e.tipo = 'contenido'; e.codigo = codigoDeError(datos); throw e; }
    return datos;
  }

  function estadoCuenta(c = cuenta()) {
    if (!c) return { habilitado: false };
    return base.metaLeer(`estado:${c}`, { habilitado: false });
  }

  async function prepararCuenta(c) {
    if (verificadas.has(c)) return estadoCuenta(c);
    const est = await llamar('offline_estado', {});
    base.metaGuardar(`estado:${c}`, { habilitado: !!(est && est.habilitado), tamano_bloque: est && est.tamano_bloque, verificado: reloj.ahora() });
    if (est && est.habilitado) {
      const d = await llamar('offline_registrar_dispositivo', {
        p_dispositivo_uid: uidEquipo, p_nombre: dispositivo.nombre || null, p_version: dispositivo.version || null, p_plataforma: dispositivo.plataforma || null,
      });
      base.metaGuardar(`dispositivo:${c}`, d);
    }
    verificadas.add(c);
    return estadoCuenta(c);
  }

  async function asegurarNumeros(c) {
    if (base.numerosLibres(c) >= NUMEROS_MINIMOS) return;
    const b = await llamar('offline_reservar_numeros', { p_dispositivo_uid: uidEquipo, p_cantidad: null });
    if (b && b.desde != null) base.numerosAgregarBloque(c, b);
  }

  async function subirUna(c, v) {
    const payload = base.ventaPayload(v.uuid);
    base.marcarEnviando(v.uuid);
    try {
      const r = await llamar('offline_registrar_venta', { p: { ...payload, reloj_envio: new Date(reloj.ahora()).toISOString() } });
      base.marcarSubida(v.uuid, r);
      ultimaSubida = reloj.ahora();
      return { subida: true, resultado: r };
    } catch (e) {
      if (e.tipo === 'contenido' && ERRORES_DE_CONTENIDO.has(e.codigo)) {
        base.marcarError(v.uuid, TEXTOS_ERROR[e.codigo] || e.message);
        return { subida: false, error: e };
      }
      base.marcarReintento(v.uuid, e.tipo === 'red' ? 'Sin conexión con el servidor' : (TEXTOS_ERROR[e.codigo] || e.message), 0);
      throw e;
    }
  }

  async function ciclo() {
    const c = cuenta();
    if (!c || !tokenUsable() || !hayConexion()) return { hecho: false };
    const subidas = [];
    try {
      const est = await prepararCuenta(c);
      if (!est.habilitado) return { hecho: true, subidas };
      for (;;) {
        const v = base.siguienteParaSubir(c, reloj.ahora());
        if (!v) break;
        const r = await subirUna(c, v);
        if (r.subida) subidas.push({ uuid: v.uuid, ...r.resultado });
        publicar();
      }
      await asegurarNumeros(c);
      fallosSeguidos = 0;
      ultimoError = null;
      return { hecho: true, subidas };
    } catch (e) {
      if (e.tipo !== 'sesion') fallosSeguidos++;
      if (e.tipo === 'sesion') ultimoError = 'La sesión venció: se reintenta al renovarse.';
      else if (e.tipo === 'contenido' && ERRORES_DE_CUENTA.has(e.codigo)) {
        ultimoError = TEXTOS_ERROR[e.codigo];
        verificadas.delete(c); // se vuelve a comprobar en el próximo intento
        if (e.codigo === 'no_habilitado' || e.codigo === 'cuenta_demo') base.metaGuardar(`estado:${c}`, { ...estadoCuenta(c), habilitado: false });
      } else if (e.tipo === 'contenido') ultimoError = TEXTOS_ERROR[e.codigo] || e.message;
      else ultimoError = 'Sin conexión con el servidor.';
      return { hecho: false, subidas, error: e };
    } finally {
      if (subidas.length) avisar({ tipo: 'subidas', subidas });
      publicar();
    }
  }

  function correr() {
    if (enCurso) return enCurso;
    enCurso = ciclo().finally(() => { enCurso = null; programar(); });
    return enCurso;
  }

  function programar() {
    if (detenido) return;
    const c = cuenta();
    const hay = c ? base.contar(c).pendientes : 0;
    const espera = fallosSeguidos ? ESPERAS_MS[Math.min(fallosSeguidos - 1, ESPERAS_MS.length - 1)] : (hay ? 10000 : 60000);
    despertar(espera);
  }

  function despertar(ms = 0) {
    if (detenido) return;
    if (temporizador) reloj.clearTimeout(temporizador);
    temporizador = reloj.setTimeout(() => { temporizador = null; correr(); }, ms);
    if (temporizador && temporizador.unref) temporizador.unref();
  }

  function obtener() {
    const c = cuenta();
    const conteo = c ? base.contar(c) : { pendientes: 0, errores: 0, subidas: 0, anuladas: 0 };
    const est = estadoCuenta(c);
    return {
      cuenta: c, email: sesion && sesion.email, habilitado: !!est.habilitado, dispositivo_uid: uidEquipo,
      dispositivo: c ? base.metaLeer(`dispositivo:${c}`, null) : null,
      ...conteo, numeros_libres: c ? base.numerosLibres(c) : 0, sin_subir_equipo: base.totalSinSubir(),
      sesion_valida: tokenUsable(), ultimo_error: ultimoError, ultima_subida: ultimaSubida, subiendo: !!enCurso,
    };
  }

  function publicar() {
    const e = obtener();
    fijarPendientes(e.sin_subir_equipo);
    avisar({ tipo: 'estado', estado: e });
  }

  return {
    fijarSesion, obtener, estadoCuenta, cuenta,
    subirAhora() { const c = cuenta(); if (c) base.despertarTodas(c); fallosSeguidos = 0; return correr(); },
    despertar, publicar,
    iniciar() { detenido = false; publicar(); despertar(0); },
    detener() { detenido = true; if (temporizador) reloj.clearTimeout(temporizador); temporizador = null; },
  };
}

module.exports = { crearSincronizador, leerToken, codigoDeError, ERRORES_DE_CONTENIDO, ESPERAS_MS, NUMEROS_MINIMOS };
