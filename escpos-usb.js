/* =====================================================
   ESCPOS-USB.JS — NEGOCIO360
   Impresión ESC/POS real, directo a la impresora por USB (WebUSB),
   sin pasar por el dialogo de impresion de Windows. Pensado
   especificamente para la EPSON TM-U220 (Font A: 7x9, 40 columnas
   a 76mm), confirmado contra la documentacion oficial de Epson.

   Esto es SIEMPRE una opcion ADICIONAL — nunca reemplaza la
   impresion normal (CSS + dialogo de impresion) que ya existe. Si
   WebUSB no esta disponible, o el usuario no ha conectado la
   impresora, o cualquier paso fallara, el codigo que llama a esto
   debe seguir cayendo en la impresion normal de siempre.
===================================================== */

let ESCPOS_DEVICE = null;
let ESCPOS_ENDPOINT_OUT = null;

function escposSoportado() {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

function escposConectado() {
  return !!ESCPOS_DEVICE && ESCPOS_DEVICE.opened;
}

// Pide permiso al usuario UNA vez para hablar directo con la
// impresora por USB. Debe llamarse desde un clic real del usuario
// (los navegadores no permiten pedir este permiso en automatico).
async function conectarImpresoraUSB() {
  if (!escposSoportado()) {
    return { ok: false, motivo: 'Tu navegador no soporta impresión USB directa. Usa Chrome o Edge.' };
  }
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);

    // Buscar el endpoint de salida (OUT) real de esta impresora --
    // nunca se asume un numero fijo, se busca en la configuracion
    // real del dispositivo conectado.
    const iface = device.configuration.interfaces[0];
    const alt = iface.alternate || iface.alternates[0];
    const endpointOut = alt.endpoints.find(e => e.direction === 'out');
    if (!endpointOut) {
      await device.close();
      return { ok: false, motivo: 'Este dispositivo USB no tiene un canal de impresión reconocible.' };
    }

    ESCPOS_DEVICE = device;
    ESCPOS_ENDPOINT_OUT = endpointOut.endpointNumber;
    return { ok: true };
  } catch (e) {
    console.error('conectarImpresoraUSB:', e);
    return { ok: false, motivo: 'No se pudo conectar con la impresora (¿cancelaste el permiso?).' };
  }
}

function desconectarImpresoraUSB() {
  if (ESCPOS_DEVICE) { try { ESCPOS_DEVICE.close(); } catch (e) {} }
  ESCPOS_DEVICE = null;
  ESCPOS_ENDPOINT_OUT = null;
}

// Envia los bytes ya armados directo a la impresora. Devuelve
// {ok:true} o {ok:false, motivo} — nunca lanza un error sin control,
// para que quien lo llame pueda caer de vuelta a la impresion normal.
async function enviarBytesImpresoraUSB(bytes) {
  if (!escposConectado()) return { ok: false, motivo: 'La impresora no está conectada.' };
  try {
    await ESCPOS_DEVICE.transferOut(ESCPOS_ENDPOINT_OUT, bytes);
    return { ok: true };
  } catch (e) {
    console.error('enviarBytesImpresoraUSB:', e);
    return { ok: false, motivo: 'Error al enviar los datos a la impresora.' };
  }
}

/* =====================================================
   CODIFICACIÓN CP437 — confirmada como la codepage por defecto en
   la mayoría de impresoras de recibos, con soporte completo para
   acentos y ñ en español. Á/Í/Ó/Ú mayúsculas (excepto É) no existen
   en CP437 -- se usan sin acento como respaldo seguro, nunca basura.
===================================================== */
const ESCPOS_MAPA_CP437 = {
  'á':0xA0, 'é':0x82, 'í':0xA1, 'ó':0xA2, 'ú':0xA3,
  'ñ':0xA4, 'Ñ':0xA5, 'ü':0x81, 'Ü':0x9A,
  '¿':0xA8, '¡':0xAD, 'É':0x90,
};
const ESCPOS_RESPALDO_SIN_ACENTO = { 'Á':'A', 'Í':'I', 'Ó':'O', 'Ú':'U' };

function escposTextoACp437(texto) {
  const bytes = [];
  for (const ch of String(texto ?? '')) {
    if (ESCPOS_MAPA_CP437[ch] !== undefined) { bytes.push(ESCPOS_MAPA_CP437[ch]); continue; }
    if (ESCPOS_RESPALDO_SIN_ACENTO[ch] !== undefined) { bytes.push(ESCPOS_RESPALDO_SIN_ACENTO[ch].charCodeAt(0)); continue; }
    const code = ch.charCodeAt(0);
    bytes.push(code < 128 ? code : 0x3F);
  }
  return bytes;
}

/* =====================================================
   CONSTRUCTOR DE RECIBO — arma los bytes ESC/POS completos a partir
   de datos ya simples (nombre del negocio, lineas de texto, total).
   No sabe nada de Ventas/Creditos/Proformas especificamente -- cada
   modulo arma sus propias lineas de texto y se las pasa a esto.
===================================================== */
const ESCPOS_ESC = 0x1B, ESCPOS_GS = 0x1D;

function construirReciboESCPOS({ nombreNegocio, encabezadoLineas = [], items = [], totalTexto, piePagina }) {
  let bytes = [];
  bytes.push(ESCPOS_ESC, 0x40);                 // ESC @  — inicializar
  bytes.push(ESCPOS_ESC, 0x74, 0x00);           // ESC t 0 — codepage CP437
  bytes.push(ESCPOS_ESC, 0x61, 0x01);           // ESC a 1 — centrado
  bytes.push(ESCPOS_ESC, 0x21, 0x30);           // ESC ! — negrita + doble alto/ancho
  bytes.push(...escposTextoACp437(nombreNegocio + '\n'));
  bytes.push(ESCPOS_ESC, 0x21, 0x00);           // ESC ! 0 — normal

  encabezadoLineas.forEach(linea => bytes.push(...escposTextoACp437(linea + '\n')));

  bytes.push(ESCPOS_ESC, 0x61, 0x00);           // ESC a 0 — alineado a la izquierda
  bytes.push(...escposTextoACp437('-'.repeat(40) + '\n'));
  items.forEach(linea => bytes.push(...escposTextoACp437(linea + '\n')));
  bytes.push(...escposTextoACp437('-'.repeat(40) + '\n'));

  bytes.push(ESCPOS_ESC, 0x45, 0x01);           // ESC E 1 — negrita ON
  bytes.push(...escposTextoACp437(totalTexto + '\n'));
  bytes.push(ESCPOS_ESC, 0x45, 0x00);           // ESC E 0 — negrita OFF

  if (piePagina) {
    bytes.push(ESCPOS_ESC, 0x61, 0x01);         // centrado
    bytes.push(...escposTextoACp437('\n' + piePagina + '\n'));
  }

  bytes.push(0x0A, 0x0A, 0x0A);                 // avance de papel
  bytes.push(ESCPOS_GS, 0x56, 0x00);            // GS V 0 — corte total de papel

  return new Uint8Array(bytes);
}

// Atajo: arma el recibo y lo manda directo, con manejo de errores
// completo. Devuelve {ok, motivo} — quien lo llame decide si cae de
// vuelta a la impresion normal cuando ok=false.
async function imprimirReciboESCPOS(datosRecibo) {
  if (!escposConectado()) return { ok: false, motivo: 'La impresora USB no está conectada.' };
  try {
    const bytes = construirReciboESCPOS(datosRecibo);
    return await enviarBytesImpresoraUSB(bytes);
  } catch (e) {
    console.error('imprimirReciboESCPOS:', e);
    return { ok: false, motivo: 'No se pudo armar el recibo.' };
  }
}
