/* pais-config.js — datos por país (moneda, zona horaria, formato, IVA, documentos fiscales).
 * La fuente es la tabla `paises_config` (solo lectura). Si no se puede leer, se usa un respaldo mínimo
 * embebido (moneda + zona horaria) para que el registro nunca se bloquee. Todo lo que este módulo propone
 * son valores PREDETERMINADOS: la persona siempre puede cambiarlos. */
(function () {
  'use strict';
  if (window.N360Pais) return;
  var RESPALDO = {
    NI: { nombre: 'Nicaragua', moneda: 'NIO', simbolo: 'C$', locale: 'es-NI', zona_horaria: 'America/Managua' },
    GT: { nombre: 'Guatemala', moneda: 'GTQ', simbolo: 'Q', locale: 'es-GT', zona_horaria: 'America/Guatemala' },
    SV: { nombre: 'El Salvador', moneda: 'USD', simbolo: '$', locale: 'es-SV', zona_horaria: 'America/El_Salvador' },
    HN: { nombre: 'Honduras', moneda: 'HNL', simbolo: 'L', locale: 'es-HN', zona_horaria: 'America/Tegucigalpa' },
    CR: { nombre: 'Costa Rica', moneda: 'CRC', simbolo: '₡', locale: 'es-CR', zona_horaria: 'America/Costa_Rica' },
    PA: { nombre: 'Panamá', moneda: 'PAB', simbolo: 'B/', locale: 'es-PA', zona_horaria: 'America/Panama' },
    MX: { nombre: 'México', moneda: 'MXN', simbolo: '$', locale: 'es-MX', zona_horaria: 'America/Mexico_City' },
    CO: { nombre: 'Colombia', moneda: 'COP', simbolo: '$', locale: 'es-CO', zona_horaria: 'America/Bogota' },
    PE: { nombre: 'Perú', moneda: 'PEN', simbolo: 'S/', locale: 'es-PE', zona_horaria: 'America/Lima' },
    CL: { nombre: 'Chile', moneda: 'CLP', simbolo: '$', locale: 'es-CL', zona_horaria: 'America/Santiago' },
    AR: { nombre: 'Argentina', moneda: 'ARS', simbolo: '$', locale: 'es-AR', zona_horaria: 'America/Argentina/Buenos_Aires' },
    DO: { nombre: 'República Dominicana', moneda: 'DOP', simbolo: 'RD$', locale: 'es-DO', zona_horaria: 'America/Santo_Domingo' },
    ES: { nombre: 'España', moneda: 'EUR', simbolo: '€', locale: 'es-ES', zona_horaria: 'Europe/Madrid' },
    US: { nombre: 'Estados Unidos', moneda: 'USD', simbolo: '$', locale: 'en-US', zona_horaria: 'America/New_York' }
  };
  var cache = null;

  // Devuelve { CODIGO: fila } leyendo la tabla; si falla, el respaldo.
  async function cargar(db) {
    if (cache) return cache;
    try {
      var r = await db.from('paises_config').select('*').order('orden');
      if (!r.error && r.data && r.data.length) {
        var m = {}; r.data.forEach(function (f) { m[f.codigo] = f; });
        cache = m; return cache;
      }
    } catch (e) { /* respaldo */ }
    cache = JSON.parse(JSON.stringify(RESPALDO));
    return cache;
  }
  async function obtener(db, codigo) { var m = await cargar(db); return m[String(codigo || '').toUpperCase()] || null; }

  // Texto corto de lo que se propone al elegir un país.
  function resumen(p) {
    if (!p) return '';
    var t = [p.moneda ? ((p.simbolo ? p.simbolo + ' ' : '') + p.moneda) : null];
    if (p.iva_porcentaje != null) t.push((p.iva_nombre || 'IVA') + ' ' + Number(p.iva_porcentaje) + '%');
    return t.filter(Boolean).join(' · ');
  }
  window.N360Pais = { cargar: cargar, obtener: obtener, resumen: resumen, RESPALDO: RESPALDO };
})();
