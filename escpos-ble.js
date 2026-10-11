/* =====================================================
   ESCPOS-BLE.JS — NEGOCIO360
   Impresión ESC/POS directo por BLUETOOTH desde el navegador
   (Web Bluetooth: Chrome/Edge en Android y en computadora), para
   impresoras térmicas de tickets. Sin apps ni WiFi.

   Limitaciones reales:
   - Solo impresoras Bluetooth de baja energía (BLE). Las de Bluetooth
     "clásico" (SPP) no las puede usar ningún navegador.
   - No funciona en iPhone/Safari.
   - El permiso se pide con un toque en "Conectar" cada vez que se
     abre la página (el navegador no permite hacerlo en automático).

   Es SIEMPRE una vía ADICIONAL: si algo falla, quien llama cae a la
   impresión normal de siempre. Reutiliza construirReciboESCPOS de
   escpos-usb.js (no cambia nada de ese archivo salvo el ancho).
===================================================== */

let ESCPOS_BT_DEVICE = null;
let ESCPOS_BT_CHAR = null;

// Servicios típicos de impresoras térmicas BLE (el navegador exige declararlos).
const ESCPOS_BT_SERVICIOS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
];

function escposBTSoportado() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

function escposBTConectado() {
  return !!ESCPOS_BT_DEVICE && !!ESCPOS_BT_DEVICE.gatt && ESCPOS_BT_DEVICE.gatt.connected && !!ESCPOS_BT_CHAR;
}

async function escposBTBuscarCaracteristica(server) {
  const servicios = await server.getPrimaryServices();
  let fallback = null;
  for (const s of servicios) {
    let chars = [];
    try { chars = await s.getCharacteristics(); } catch (e) { continue; }
    for (const c of chars) {
      if (c.properties.writeWithoutResponse) return c;
      if (c.properties.write && !fallback) fallback = c;
    }
  }
  return fallback;
}

// Debe llamarse desde un toque real del usuario.
async function conectarImpresoraBluetooth() {
  if (!escposBTSoportado()) {
    return { ok: false, motivo: 'Este navegador no soporta Bluetooth directo. Usa Chrome en Android o en computadora (no funciona en iPhone).' };
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ESCPOS_BT_SERVICIOS,
    });
    const server = await device.gatt.connect();
    const caracteristica = await escposBTBuscarCaracteristica(server);
    if (!caracteristica) {
      try { device.gatt.disconnect(); } catch (e) {}
      return { ok: false, motivo: 'Ese dispositivo no tiene un canal de impresión compatible. Puede ser una impresora Bluetooth clásica (no BLE).' };
    }
    ESCPOS_BT_DEVICE = device;
    ESCPOS_BT_CHAR = caracteristica;
    return { ok: true, nombre: device.name || 'Impresora' };
  } catch (e) {
    console.error('conectarImpresoraBluetooth:', e);
    const cancelo = e && (e.name === 'NotFoundError' || e.name === 'NotAllowedError');
    return { ok: false, motivo: cancelo
      ? 'No se eligió ninguna impresora. Si no aparece en la lista, enciéndela, activa la ubicación del teléfono y revisa que sea Bluetooth BLE.'
      : 'No se pudo conectar con la impresora por Bluetooth.' };
  }
}

function desconectarImpresoraBluetooth() {
  try { if (ESCPOS_BT_DEVICE?.gatt?.connected) ESCPOS_BT_DEVICE.gatt.disconnect(); } catch (e) {}
  ESCPOS_BT_DEVICE = null;
  ESCPOS_BT_CHAR = null;
}

// Si la conexión se durmió, reintenta una vez sin pedir permiso de nuevo.
async function escposBTReconectar() {
  if (!ESCPOS_BT_DEVICE) return false;
  if (escposBTConectado()) return true;
  try {
    const server = await ESCPOS_BT_DEVICE.gatt.connect();
    ESCPOS_BT_CHAR = await escposBTBuscarCaracteristica(server);
    return !!ESCPOS_BT_CHAR;
  } catch (e) { return false; }
}

async function enviarBytesImpresoraBT(bytes) {
  if (!(await escposBTReconectar())) return { ok: false, motivo: 'La impresora Bluetooth no está conectada.' };
  try {
    const TAM = 100; // trozos chicos: los BLE aceptan pocos bytes por escritura
    for (let i = 0; i < bytes.length; i += TAM) {
      const trozo = bytes.slice(i, i + TAM);
      if (ESCPOS_BT_CHAR.properties.writeWithoutResponse) await ESCPOS_BT_CHAR.writeValueWithoutResponse(trozo);
      else await ESCPOS_BT_CHAR.writeValue(trozo);
      await new Promise(r => setTimeout(r, 25));
    }
    return { ok: true };
  } catch (e) {
    console.error('enviarBytesImpresoraBT:', e);
    return { ok: false, motivo: 'Error al enviar los datos a la impresora Bluetooth.' };
  }
}

async function imprimirReciboBluetooth(datosRecibo) {
  try {
    return await enviarBytesImpresoraBT(construirReciboESCPOS(datosRecibo));
  } catch (e) {
    console.error('imprimirReciboBluetooth:', e);
    return { ok: false, motivo: 'No se pudo armar el recibo.' };
  }
}
