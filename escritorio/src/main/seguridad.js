// Reglas de qué puede abrir y a dónde puede ir cada ventana.
// - Las páginas del sistema viven en app://negocio360 (empaquetadas).
// - Enlaces de internet (WhatsApp, mapas, sitio web…) se abren en el
//   navegador normal de Windows, nunca dentro del programa.
// - Ventanas en blanco (about:blank) y PDFs generados (blob:) se permiten
//   porque el sistema las usa para imprimir tickets y ver comprobantes.
'use strict';
const { ESQUEMA, HOST } = require('./config');

function esUrlInterna(direccion) {
  try {
    const u = new URL(direccion);
    return u.protocol === `${ESQUEMA}:` && u.hostname === HOST;
  } catch (_) { return false; }
}

function esExternaPermitida(direccion) {
  try {
    const u = new URL(direccion);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol);
  } catch (_) { return false; }
}

function esBlobInterno(direccion) {
  return typeof direccion === 'string' && direccion.startsWith(`blob:${ESQUEMA}://${HOST}/`);
}

// Qué hacer cuando una página pide abrir una ventana nueva.
//   'ventana-sistema': página del sistema en otra ventana del programa
//   'ventana-auxiliar': ventana en blanco o PDF (tickets, comprobantes), sin puente
//   'navegador': abrir en el navegador de Windows
//   'bloquear': nada
function decidirVentanaNueva(direccion) {
  if (!direccion || direccion === 'about:blank') return 'ventana-auxiliar';
  if (esUrlInterna(direccion)) return 'ventana-sistema';
  if (esBlobInterno(direccion)) return 'ventana-auxiliar';
  if (esExternaPermitida(direccion)) return 'navegador';
  return 'bloquear';
}

// Qué hacer cuando una página intenta navegar a otra dirección.
function decidirNavegacion(direccion) {
  if (esUrlInterna(direccion)) return 'permitir';
  if (esExternaPermitida(direccion)) return 'navegador';
  return 'bloquear';
}

// Permisos del navegador: solo cámara (lector de códigos) y portapapeles,
// y solo para las páginas del sistema.
const PERMISOS_PERMITIDOS = new Set(['media', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);
function permisoPermitido(permiso, origen) {
  return PERMISOS_PERMITIDOS.has(permiso) && esUrlInterna(origen || '');
}

// Los mensajes al programa (imprimir, estado) solo se aceptan de páginas del sistema.
function remitenteValido(evento) {
  const url = evento && evento.senderFrame && evento.senderFrame.url;
  return !!url && esUrlInterna(url);
}

module.exports = { esUrlInterna, esExternaPermitida, esBlobInterno, decidirVentanaNueva, decidirNavegacion, permisoPermitido, remitenteValido };
