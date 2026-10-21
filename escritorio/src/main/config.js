// Configuración fija del programa. Lo que se puede cambiar para pruebas
// (variables N360_*) solo se acepta cuando el programa NO está instalado
// (app.isPackaged = false), nunca en el instalador que usan los negocios.
'use strict';
const path = require('path');

const ESQUEMA = 'app';
const HOST = 'negocio360';
const ORIGEN = `${ESQUEMA}://${HOST}`;
const PAGINA_INICIO = 'login.html';
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
// Clave pública (la misma que ya usan todas las páginas del sistema web).
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const SITIO_WEB = 'https://negocio360oficial.com';

function crearConfig({ empaquetado, rutaRecursos, env = process.env }) {
  const prueba = !empaquetado && env.N360_PRUEBA === '1';
  const raizProyecto = path.join(__dirname, '..', '..');
  return {
    ESQUEMA, HOST, ORIGEN, PAGINA_INICIO, SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, SITIO_WEB,
    prueba,
    raizWeb: (prueba && env.N360_WEB_DIR) || (empaquetado ? path.join(rutaRecursos, 'web') : path.join(raizProyecto, 'build', 'web')),
    carpetaRecursos: empaquetado ? rutaRecursos : path.join(raizProyecto, 'recursos'),
    urlSalud: (prueba && env.N360_URL_SALUD) || `${SUPABASE_URL}/auth/v1/health`,
    sinSplash: prueba && env.N360_SIN_SPLASH === '1',
    carpetaDatos: (prueba && env.N360_DATOS_DIR) || null,
    // Solo pruebas: en vez de mandar a Windows, guarda cada ticket en esta carpeta.
    impresionSimulada: (prueba && env.N360_IMPRESION_SIMULADA) || null,
  };
}

module.exports = { crearConfig, ESQUEMA, HOST, ORIGEN, PAGINA_INICIO, SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, SITIO_WEB };
