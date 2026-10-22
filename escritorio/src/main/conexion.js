// Vigila si hay conexión con el servidor de Negocio360 (Supabase).
// Estados (lo que ve el usuario en el indicador):
//   'en_linea'     🟢  el servidor responde
//   'inestable'    🟠  responde lento, falló una vez, o hay ventas por subir
//   'sin_conexion' 🔴  sin red, o el servidor no responde 2 veces seguidas
//   'verificando'  🟠  al arrancar, antes de la primera respuesta
// Corre en el proceso principal: sigue vigilando aunque se cambie de pantalla.
'use strict';

const LENTO_MS = 3000;
const FALLOS_PARA_SIN_CONEXION = 2;

function crearMonitor({
  comprobar,               // async () => { ok: boolean, ms: number }
  hayRed = () => true,     // net.isOnline() de Electron
  alCambiar = () => {},    // (estado) => void
  intervaloEnLinea = 15000,
  intervaloSinConexion = 5000,
  reloj = { setTimeout, clearTimeout, ahora: () => Date.now() },
}) {
  let estado = { conexion: 'verificando', ultimoContacto: null, pendientes: 0, desde: reloj.ahora() };
  let fallos = 0;
  let temporizador = null;
  let enCurso = null;
  let detenido = false;

  let pendientesAvisados = 0;
  function publicar(conexion, extra = {}) {
    const visible = conexion === 'en_linea' && estado.pendientes > 0 ? 'inestable' : conexion;
    const cambio = visible !== estado.visible || conexion !== estado.conexion;
    estado = { ...estado, ...extra, conexion, visible, desde: cambio ? reloj.ahora() : estado.desde };
    if (cambio || estado.pendientes !== pendientesAvisados) { pendientesAvisados = estado.pendientes; alCambiar(obtener()); }
  }

  function obtener() { return { ...estado, visible: estado.visible || estado.conexion }; }

  async function revisar() {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      if (!hayRed()) { fallos = FALLOS_PARA_SIN_CONEXION; publicar('sin_conexion'); return; }
      let r;
      try { r = await comprobar(); } catch (_) { r = { ok: false }; }
      if (r && r.ok) {
        fallos = 0;
        publicar(r.ms > LENTO_MS ? 'inestable' : 'en_linea', { ultimoContacto: reloj.ahora() });
      } else {
        fallos++;
        publicar(fallos >= FALLOS_PARA_SIN_CONEXION ? 'sin_conexion' : 'inestable');
      }
    })();
    try { await enCurso; } finally { enCurso = null; }
    programar();
  }

  function programar() {
    if (detenido) return;
    if (temporizador) reloj.clearTimeout(temporizador);
    const espera = estado.conexion === 'en_linea' ? intervaloEnLinea : intervaloSinConexion;
    temporizador = reloj.setTimeout(revisar, espera);
  }

  return {
    iniciar() { detenido = false; return revisar(); },
    detener() { detenido = true; if (temporizador) reloj.clearTimeout(temporizador); temporizador = null; },
    revisarAhora: revisar,
    obtener,
    // Fase 3: ventas guardadas en el equipo que aún no suben -> 🟠
    fijarPendientes(n) { estado.pendientes = Math.max(0, Number(n) || 0); publicar(estado.conexion); },
  };
}

// Comprobación real contra el servidor: cualquier respuesta HTTP < 500
// significa que hay camino hasta el servidor.
function crearComprobador({ fetch, url, clave, tiempoMaximoMs = 6000, ahora = () => Date.now() }) {
  return async () => {
    const inicio = ahora();
    try {
      const res = await fetch(url, { method: 'GET', headers: { apikey: clave }, signal: AbortSignal.timeout(tiempoMaximoMs), cache: 'no-store' });
      return { ok: res.status < 500, ms: ahora() - inicio };
    } catch (_) {
      return { ok: false, ms: ahora() - inicio };
    }
  };
}

module.exports = { crearMonitor, crearComprobador, LENTO_MS, FALLOS_PARA_SIN_CONEXION };
