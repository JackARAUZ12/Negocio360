// Convierte una dirección app://negocio360/<página> en el archivo
// empaquetado correspondiente, sin dejar salir de la carpeta de páginas.
'use strict';
const path = require('path');
const { ESQUEMA, HOST, PAGINA_INICIO } = require('./config');

function resolverArchivo(raizWeb, direccion) {
  let u;
  try { u = new URL(direccion); } catch (_) { return { error: 400 }; }
  if (u.protocol !== `${ESQUEMA}:` || u.hostname !== HOST) return { error: 403 };
  let relativo;
  try { relativo = decodeURIComponent(u.pathname); } catch (_) { return { error: 400 }; }
  if (relativo.includes('\0') || relativo.includes('\\')) return { error: 400 };
  if (relativo === '/' || relativo === '') relativo = '/' + PAGINA_INICIO;
  const raiz = path.resolve(raizWeb);
  const ruta = path.resolve(raiz, '.' + path.posix.normalize(relativo));
  if (ruta !== raiz && !ruta.startsWith(raiz + path.sep)) return { error: 403 };
  return { ruta };
}

module.exports = { resolverArchivo };
