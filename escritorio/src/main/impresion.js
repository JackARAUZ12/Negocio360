// Impresión directa (RAW) a impresoras de Windows: misma interfaz que la
// versión 1.0.1 (window.negocio360Print), pero:
//  - el nombre de la impresora debe existir en Windows (se valida contra la
//    lista real) y viaja como variable de entorno, nunca dentro del código;
//  - archivos temporales con nombre aleatorio en una carpeta propia, que se
//    borran siempre;
//  - un ticket a la vez (no se mezclan si se imprimen dos seguidos).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 512 * 1024;
const MAX_NOMBRE = 256;
const TIEMPO_MAXIMO_MS = 20000;

const ERRORES_WINDOWS = {
  1801: 'Windows no encuentra esa impresora. Revisa que siga instalada con el mismo nombre.',
  5: 'Windows no dio permiso para usar esa impresora.',
  1722: 'La impresora no responde (¿está apagada o desconectada?).',
};

function aBytes(datos) {
  if (datos instanceof Uint8Array) return Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength);
  if (datos instanceof ArrayBuffer) return Buffer.from(datos);
  if (Array.isArray(datos) && datos.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return Buffer.from(datos);
  return null;
}

function crearImpresion({ obtenerImpresoras, ejecutar, plataforma = process.platform, carpetaTmp, rutaScript }) {
  let cola = Promise.resolve();
  let carpeta = null;

  async function listar() {
    try {
      const lista = await obtenerImpresoras();
      const impresoras = [...new Set((lista || []).map((p) => p && p.name).filter((n) => typeof n === 'string' && n))];
      return { ok: true, impresoras };
    } catch (_) {
      return { ok: false, motivo: 'No se pudo leer la lista de impresoras de Windows.', impresoras: [] };
    }
  }

  async function imprimirAhora(nombre, datos) {
    if (typeof nombre !== 'string' || !nombre || nombre.length > MAX_NOMBRE) return { ok: false, motivo: 'No se indicó qué impresora usar.' };
    const bytes = aBytes(datos);
    if (!bytes || bytes.length === 0) return { ok: false, motivo: 'El ticket llegó vacío.' };
    if (bytes.length > MAX_BYTES) return { ok: false, motivo: 'El ticket es demasiado grande para imprimirse directo.' };
    if (plataforma !== 'win32') return { ok: false, motivo: 'La impresión directa solo funciona en Windows.' };
    const { impresoras } = await listar();
    if (!impresoras.includes(nombre)) return { ok: false, motivo: `La impresora "${nombre}" ya no aparece en Windows. Elígela de nuevo en la configuración del ticket.` };

    if (!carpeta) carpeta = fs.mkdtempSync(path.join(carpetaTmp, 'n360-tickets-'));
    const archivo = path.join(carpeta, `${crypto.randomUUID()}.bin`);
    fs.writeFileSync(archivo, bytes, { mode: 0o600, flag: 'wx' });
    try {
      const { stdout } = await ejecutar('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', rutaScript,
      ], { windowsHide: true, timeout: TIEMPO_MAXIMO_MS, env: { ...process.env, N360_IMPRESORA: nombre, N360_ARCHIVO: archivo } });
      const salida = String(stdout || '');
      if (salida.includes('NEGOCIO360_OK')) return { ok: true };
      const codigo = Number((salida.match(/NEGOCIO360_ERROR:(-?\d+)/) || [])[1]);
      return { ok: false, motivo: ERRORES_WINDOWS[codigo] || 'La impresora rechazó los datos (revisa que esté encendida y con papel).' };
    } catch (e) {
      if (e && (e.killed || e.signal === 'SIGTERM')) return { ok: false, motivo: 'La impresora tardó demasiado en responder.' };
      return { ok: false, motivo: 'No se pudo ejecutar la impresión directa.' };
    } finally {
      try { fs.unlinkSync(archivo); } catch (_) { /* ya no existe */ }
    }
  }

  function imprimir(nombre, datos) {
    const tarea = cola.then(() => imprimirAhora(nombre, datos));
    cola = tarea.catch(() => {});
    return tarea;
  }

  return { listar, imprimir };
}

module.exports = { crearImpresion, MAX_BYTES };
