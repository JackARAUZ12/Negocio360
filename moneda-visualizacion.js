/* ============================================================
   MONEDA DE VISUALIZACIÓN — nunca toca los datos reales, solo
   convierte lo que se MUESTRA en pantalla. La moneda oficial del
   negocio (donde vive todo, siempre, en la base de datos) nunca
   cambia -- esto es puramente un lente de visualización, guardado
   por dispositivo (localStorage), no en el servidor.
   ============================================================ */
const N360_CLAVE_MONEDA_VIS = 'n360_moneda_visualizacion';
const N360_CLAVE_TASA_VIS   = 'n360_tasa_visualizacion';

// null = sin conversión activa, se muestra la moneda oficial tal cual.
function monedaVisualizacionActiva() {
  return localStorage.getItem(N360_CLAVE_MONEDA_VIS) || null;
}
function tasaVisualizacionActiva() {
  const t = parseFloat(localStorage.getItem(N360_CLAVE_TASA_VIS));
  return t > 0 ? t : null;
}

// La tasa SIEMPRE se guarda como "cuántos NIO equivalen a 1 USD",
// sin importar cuál sea la moneda oficial del negocio -- así el
// dueño solo piensa en un solo número, el que ya conoce de memoria.
function activarMonedaVisualizacion(monedaDestino, tasaNioPorUsd) {
  localStorage.setItem(N360_CLAVE_MONEDA_VIS, monedaDestino);
  localStorage.setItem(N360_CLAVE_TASA_VIS, String(tasaNioPorUsd));
}
function desactivarMonedaVisualizacion() {
  localStorage.removeItem(N360_CLAVE_MONEDA_VIS);
  localStorage.removeItem(N360_CLAVE_TASA_VIS);
}

// Convierte un monto que vive en la moneda OFICIAL del negocio a la
// moneda de visualización elegida. Si no hay ninguna activa, o
// coincide con la oficial, el monto vuelve exactamente igual --
// nunca se pierde precisión del dato real, solo se calcula al vuelo.
function convertirParaMostrar(montoOriginal, monedaOficial) {
  const monedaVis = monedaVisualizacionActiva();
  const tasa = tasaVisualizacionActiva();
  const oficial = monedaOficial || 'NIO';
  if (!monedaVis || !tasa || monedaVis === oficial) return Number(montoOriginal) || 0;
  if (oficial === 'NIO' && monedaVis === 'USD') return (Number(montoOriginal) || 0) / tasa;
  if (oficial === 'USD' && monedaVis === 'NIO') return (Number(montoOriginal) || 0) * tasa;
  return Number(montoOriginal) || 0;
}

// Qué moneda se debe MOSTRAR ahora mismo (la de visualización si
// hay una activa, si no, la oficial de siempre).
function monedaParaMostrar(monedaOficial) {
  return monedaVisualizacionActiva() || monedaOficial || 'NIO';
}
