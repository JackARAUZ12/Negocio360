// Actualización automática (preparada). Usa electron-updater con un
// "proveedor genérico": los archivos de la nueva versión se publican en una
// carpeta del sitio (ver "publish" en electron-builder.yml) SOLO cuando el
// dueño autoriza publicar. Mientras esa carpeta no exista, el programa
// simplemente no encuentra nada y sigue igual.
//
// Nunca instala con ventas sin subir: antes de instalar pregunta
// puedeInstalar() (Fase 3: false si hay ventas pendientes en el equipo).
'use strict';

const CADA_MS = 6 * 60 * 60 * 1000;

function iniciarActualizador({ autoUpdater, empaquetado, puedeInstalar = () => true, avisar = () => {}, registro = console }) {
  if (!empaquetado || !autoUpdater) return { activo: false };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // se decide al salir, según puedeInstalar()
  autoUpdater.allowPrerelease = false;
  let lista = false;

  autoUpdater.on('error', (e) => registro.warn('Actualización: no disponible ahora', e && e.message));
  autoUpdater.on('update-downloaded', (info) => {
    lista = true;
    avisar(`Hay una versión nueva (${info && info.version}). Se instalará al cerrar el programa.`);
  });

  const buscar = () => autoUpdater.checkForUpdates().catch((e) => registro.warn('Actualización:', e && e.message));
  const primera = setTimeout(buscar, 60 * 1000);
  const intervalo = setInterval(buscar, CADA_MS);
  if (primera.unref) primera.unref();
  if (intervalo.unref) intervalo.unref();

  return {
    activo: true,
    // Llamar al cerrar el programa.
    alSalir() {
      clearTimeout(primera);
      clearInterval(intervalo);
      if (!lista) return false;
      if (!puedeInstalar()) { registro.warn('Actualización pospuesta: hay ventas sin subir.'); return false; }
      autoUpdater.quitAndInstall(true, false);
      return true;
    },
  };
}

module.exports = { iniciarActualizador };
