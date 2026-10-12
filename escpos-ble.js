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
let ESCPOS_BT_MANUAL = false;   // true = el usuario la desconectó a propósito
let ESCPOS_BT_OCUPADO = false;  // true mientras se envía un ticket
let ESCPOS_BT_RECONECTANDO = false;
let ESCPOS_BT_KA = null;        // temporizador de mantener-viva

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
    ESCPOS_BT_MANUAL = false;
    escposBTGuardarUltimo(device);
    escposBTVigilar(device);
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
  ESCPOS_BT_MANUAL = true;       // desconexión a propósito: no reconectar sola
  escposBTDetenerKeepAlive();
  try { if (ESCPOS_BT_DEVICE?.gatt?.connected) ESCPOS_BT_DEVICE.gatt.disconnect(); } catch (e) {}
  ESCPOS_BT_DEVICE = null;
  ESCPOS_BT_CHAR = null;
  escposBTAvisar();
}

// Si la conexión se durmió, reintenta una vez sin pedir permiso de nuevo.
async function escposBTReconectar() {
  if (!ESCPOS_BT_DEVICE) return false;
  if (escposBTConectado()) return true;
  for (let intento = 0; intento < 2; intento++) {
    try {
      if (await escposBTAbrirCanal(ESCPOS_BT_DEVICE)) return true;
    } catch (e) { /* reintenta */ }
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}

async function enviarBytesImpresoraBT(bytes) {
  if (!(await escposBTReconectar())) return { ok: false, motivo: 'La impresora Bluetooth no está conectada.' };
  ESCPOS_BT_OCUPADO = true;
  try {
    // Si falla ANTES de que salga el primer trozo, se reconecta y se reenvía una vez
    // (seguro: no se imprimió nada). Si falla a la mitad no se reenvía, para no duplicar el ticket.
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      let enviados = 0;
      try {
        const TAM = 100; // trozos chicos: los BLE aceptan pocos bytes por escritura
        for (let i = 0; i < bytes.length; i += TAM) {
          const trozo = bytes.slice(i, i + TAM);
          if (ESCPOS_BT_CHAR.properties.writeWithoutResponse) await ESCPOS_BT_CHAR.writeValueWithoutResponse(trozo);
          else await ESCPOS_BT_CHAR.writeValue(trozo);
          enviados++;
          await new Promise(r => setTimeout(r, 25));
        }
        return { ok: true };
      } catch (e) {
        console.error('enviarBytesImpresoraBT:', e);
        if (enviados > 0 || vuelta === 1) throw e;
        try { ESCPOS_BT_DEVICE?.gatt?.disconnect(); } catch (e2) {}
        if (!(await escposBTReconectar())) throw e;
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: 'Error al enviar los datos a la impresora Bluetooth.' };
  } finally {
    ESCPOS_BT_OCUPADO = false;
    if (!escposBTConectado() && !ESCPOS_BT_MANUAL && ESCPOS_BT_DEVICE) escposBTReconectarConEspera();
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

/* =====================================================
   RECONEXIÓN AUTOMÁTICA (mejor esfuerzo)
   Chrome puede "recordar" las impresoras que el usuario ya autorizó
   (navigator.bluetooth.getDevices). Si esta versión de Chrome lo
   soporta, al abrir Ventas se reconecta sola a la última impresora,
   sin tocar nada. Si no lo soporta, o la impresora está apagada o
   lejos, no pasa nada: se queda como antes (botón "Conectar").
   Solo lee/conecta lo que el usuario ya autorizó; nunca pide
   permisos nuevos ni abre diálogos.
===================================================== */
const ESCPOS_BT_LS_ID = 'n360_bt_ultimo_id';

function escposBTGuardarUltimo(device) {
  try { localStorage.setItem(ESCPOS_BT_LS_ID, device.id || ''); } catch (e) {}
}

function escposBTConTimeout(promesa, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promesa.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function escposBTAbrirCanal(device) {
  const server = await escposBTConTimeout(device.gatt.connect(), 8000);
  const caracteristica = await escposBTBuscarCaracteristica(server);
  if (!caracteristica) { try { device.gatt.disconnect(); } catch (e) {} return false; }
  ESCPOS_BT_DEVICE = device;
  ESCPOS_BT_CHAR = caracteristica;
  ESCPOS_BT_MANUAL = false;
  escposBTVigilar(device);
  return true;
}

let ESCPOS_BT_AUTO_EN_CURSO = null;
// Devuelve {ok:true,nombre} si quedó conectada; {ok:false,motivo} si no (sin molestar al usuario).
function reconectarBluetoothAutomatico() {
  if (escposBTConectado()) return Promise.resolve({ ok: true, nombre: ESCPOS_BT_DEVICE.name });
  if (ESCPOS_BT_AUTO_EN_CURSO) return ESCPOS_BT_AUTO_EN_CURSO;
  ESCPOS_BT_AUTO_EN_CURSO = (async () => {
    try {
      if (!escposBTSoportado()) return { ok: false, motivo: 'sin Bluetooth' };
      // Si ya teníamos el dispositivo en memoria (p. ej. se durmió), basta reconectar.
      if (ESCPOS_BT_DEVICE && await escposBTAbrirCanal(ESCPOS_BT_DEVICE)) return { ok: true, nombre: ESCPOS_BT_DEVICE.name };
      if (typeof navigator.bluetooth.getDevices !== 'function') return { ok: false, motivo: 'Chrome no recuerda dispositivos' };
      const lista = await navigator.bluetooth.getDevices();
      if (!lista || !lista.length) return { ok: false, motivo: 'sin impresoras recordadas' };
      let ultimoId = ''; try { ultimoId = localStorage.getItem(ESCPOS_BT_LS_ID) || ''; } catch (e) {}
      const ordenada = [...lista].sort((a, b) => (b.id === ultimoId) - (a.id === ultimoId));
      for (const dev of ordenada) {
        try {
          if (await escposBTAbrirCanal(dev)) return { ok: true, nombre: dev.name };
        } catch (e) {
          // Sin conexión directa: se espera a que la impresora "se anuncie" (hasta 10 s)
          if (typeof dev.watchAdvertisements === 'function') {
            try {
              const ctl = new AbortController();
              await dev.watchAdvertisements({ signal: ctl.signal });
              await escposBTConTimeout(new Promise(res => dev.addEventListener('advertisementreceived', res, { once: true })), 10000);
              ctl.abort();
              if (await escposBTAbrirCanal(dev)) return { ok: true, nombre: dev.name };
            } catch (e2) { /* siguiente */ }
          }
        }
      }
      return { ok: false, motivo: 'no se pudo reconectar' };
    } catch (e) {
      return { ok: false, motivo: 'no se pudo reconectar' };
    } finally {
      ESCPOS_BT_AUTO_EN_CURSO = null;
    }
  })();
  return ESCPOS_BT_AUTO_EN_CURSO;
}


/* =====================================================
   MANTENER VIVA + RECONEXIÓN AUTOMÁTICA
   Muchas impresoras BLE se duermen o sueltan la conexión tras unos
   segundos sin recibir datos. Aquí:
   - se envía cada ~12 s un comando vacío e inofensivo (ESC @) mientras
     la impresora esté conectada y libre, para que no se duerma;
   - si aun así se cae, se reintenta sola en silencio (1, 3, 6, 12 s)
     sin pedir permisos (solo si no fue una desconexión a propósito).
   Es solo para quien ya activó el Bluetooth y conectó una impresora.
===================================================== */
function escposBTEstado() {
  if (escposBTConectado()) return 'conectada';
  if (ESCPOS_BT_RECONECTANDO) return 'reconectando';
  return 'desconectada';
}
function escposBTAvisar() {
  try { window.dispatchEvent(new CustomEvent('n360-bt-estado', { detail: escposBTEstado() })); } catch (e) {}
}
function escposBTDetenerKeepAlive() {
  if (ESCPOS_BT_KA) { clearInterval(ESCPOS_BT_KA); ESCPOS_BT_KA = null; }
}
function escposBTIniciarKeepAlive() {
  escposBTDetenerKeepAlive();
  ESCPOS_BT_KA = setInterval(async () => {
    if (ESCPOS_BT_OCUPADO || !escposBTConectado()) return;
    try {
      const nop = new Uint8Array([0x1B, 0x40]); // ESC @ = inicializar (no imprime nada)
      if (ESCPOS_BT_CHAR.properties.writeWithoutResponse) await ESCPOS_BT_CHAR.writeValueWithoutResponse(nop);
      else await ESCPOS_BT_CHAR.writeValue(nop);
    } catch (e) { /* si falla, el evento de desconexión se encarga */ }
  }, 12000);
}
async function escposBTReconectarConEspera() {
  if (ESCPOS_BT_RECONECTANDO || ESCPOS_BT_MANUAL || !ESCPOS_BT_DEVICE) return;
  ESCPOS_BT_RECONECTANDO = true; escposBTAvisar();
  try {
    for (const espera of [1000, 3000, 6000, 12000]) {
      await new Promise(r => setTimeout(r, espera));
      if (ESCPOS_BT_MANUAL || !ESCPOS_BT_DEVICE) return;
      if (escposBTConectado()) return;
      try { if (await escposBTAbrirCanal(ESCPOS_BT_DEVICE)) return; } catch (e) { /* siguiente intento */ }
    }
  } finally {
    ESCPOS_BT_RECONECTANDO = false; escposBTAvisar();
  }
}
function escposBTVigilar(device) {
  try {
    if (!device._n360Vigilado) {
      device._n360Vigilado = true;
      device.addEventListener('gattserverdisconnected', () => {
        escposBTDetenerKeepAlive();
        escposBTAvisar();
        if (!ESCPOS_BT_MANUAL && ESCPOS_BT_DEVICE === device && !ESCPOS_BT_OCUPADO) escposBTReconectarConEspera();
      });
    }
  } catch (e) { /* sin eventos: queda el reintento al imprimir */ }
  escposBTIniciarKeepAlive();
  escposBTAvisar();
}
