const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// La URL real de Negocio360 — este programa NUNCA copia ni modifica
// el sistema en sí, solo abre esta misma dirección dentro de una
// ventana de escritorio en vez de un navegador normal. Apunta directo
// al login (no a la página de mercadeo), ya que quien instala esta
// app de escritorio ya es cliente, no un visitante nuevo.
const NEGOCIO360_URL = 'https://negocio360oficial.com/login.html';

let mainWindow = null;
let splashWindow = null;

// Cualquier ventana nueva que la app intente abrir (enlaces externos,
// WhatsApp, sitio web, etc.) se abre en el navegador normal de
// Windows, no dentro de esta app — aplica a TODAS las ventanas
// (principal, Términos, Privacidad, Acerca de) de una sola vez.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

function crearSplash() {
  splashWindow = new BrowserWindow({
    width: 380,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function crearVentanaPrincipal() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 980,
    minHeight: 600,
    title: 'Negocio360',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#0f0f14',
    show: false, // se muestra recién cuando ya cargó, con una aparición suave
    opacity: 0,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const mostrarConTransicion = async () => {
    if (!mainWindow) return;
    if (splashWindow) {
      // Se desvanece el splash suavemente (en vez de cerrarlo de
      // golpe) — la animación ya terminó su recorrido completo para
      // este punto, así que se siente como un cierre intencional.
      try {
        await splashWindow.webContents.executeJavaScript("document.getElementById('fondo').classList.add('saliendo')");
      } catch (e) { /* si falla, simplemente se cierra sin el efecto */ }
      await new Promise(resolve => setTimeout(resolve, 480));
      if (splashWindow) { splashWindow.close(); splashWindow = null; }
    }
    mainWindow.show();
    // Aparición suave (fade-in) en vez de que la ventana aparezca de
    // golpe — sube la opacidad en pasos cortos.
    let op = 0;
    const paso = setInterval(() => {
      if (!mainWindow) { clearInterval(paso); return; }
      op += 0.10;
      mainWindow.setOpacity(Math.min(op, 1));
      if (op >= 1) clearInterval(paso);
    }, 16);
  };

  // Se espera lo que tarde más: que la página termine de cargar, o el
  // recorrido COMPLETO de la animación de bienvenida (2.6s) — así la
  // animación nunca se corta a la mitad, sin importar qué tan rápido
  // cargue la página real por detrás.
  const tiempoMinimo = new Promise(resolve => setTimeout(resolve, 2600));
  const cargaTerminada = new Promise(resolve => {
    mainWindow.webContents.once('did-finish-load', resolve);
    mainWindow.webContents.once('did-fail-load', resolve);
  });
  Promise.all([tiempoMinimo, cargaTerminada]).then(mostrarConTransicion);

  mainWindow.loadURL(NEGOCIO360_URL);

  // Si no hay internet (o el sitio no responde), se muestra una
  // pantalla propia con botón de reintentar, en vez del error feo
  // por defecto del navegador.
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return; // ignora fallas de recursos secundarios (imágenes, etc.)
    if (errorCode === -3) return; // ERR_ABORTED — pasa normal al navegar rápido entre páginas, no es un error real
    mainWindow.loadFile(path.join(__dirname, 'offline.html'));
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function abrirVentanaAuxiliar(archivo, opciones) {
  const win = new BrowserWindow({
    width: opciones.width || 720,
    height: opciones.height || 640,
    title: opciones.title,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#0f0f14',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, archivo));
}

// Menú simplificado — sin las opciones técnicas por defecto de
// Electron (Ver código fuente, DevTools, etc.) que no tienen sentido
// para un negocio, solo lo esencial.
function crearMenu() {
  const plantilla = [
    {
      label: 'Negocio360',
      submenu: [
        { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.loadURL(NEGOCIO360_URL) },
        { label: 'Ir al inicio', click: () => mainWindow && mainWindow.loadURL(NEGOCIO360_URL) },
        { type: 'separator' },
        { label: 'Pantalla completa', accelerator: 'F11', click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { label: 'Acercar', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Zoom normal', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' },
      ],
    },
    {
      label: 'Ayuda y legal',
      submenu: [
        { label: 'Términos y Condiciones', click: () => abrirVentanaAuxiliar('terminos.html', { title:'Términos y Condiciones — Negocio360' }) },
        { label: 'Política de Privacidad', click: () => abrirVentanaAuxiliar('privacidad.html', { title:'Política de Privacidad — Negocio360' }) },
        { type: 'separator' },
        { label: 'Hablar por WhatsApp', click: () => shell.openExternal('https://wa.me/50512345678') },
        { type: 'separator' },
        { label: 'Acerca de Negocio360', click: () => abrirVentanaAuxiliar('acerca.html', { title:'Acerca de Negocio360', width:420, height:420 }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(plantilla));
}

// =====================================================
// IMPRESIÓN DIRECTA (RAW) — envía los bytes ESC/POS directo al
// controlador de impresora YA INSTALADO en Windows, en modo RAW (sin
// que Windows intente reinterpretar o reformatear nada). Usa la API
// nativa de impresión de Windows (WinSpool) via un script PowerShell
// embebido -- sin ninguna dependencia npm nueva, sin compilar nada,
// para no arriesgar el empaquetado de la app.
//
// Esta tecnica (OpenPrinter/StartDocPrinter/WritePrinter en modo RAW)
// es la forma estandar y bien documentada de mandar ESC/POS crudo a
// cualquier impresora de recibos desde Windows.
// =====================================================

function listarImpresorasWindows() {
  return new Promise((resolve) => {
    exec('powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
      { windowsHide: true }, (err, stdout) => {
        if (err) { resolve({ ok: false, motivo: 'No se pudo listar las impresoras instaladas.', impresoras: [] }); return; }
        const impresoras = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        resolve({ ok: true, impresoras });
      });
  });
}

function imprimirRawWindows(nombreImpresora, bytesBase64) {
  return new Promise((resolve) => {
    try {
      const bytes = Buffer.from(bytesBase64, 'base64');
      const carpetaTmp = os.tmpdir();
      const archivoTicket = path.join(carpetaTmp, `n360_ticket_${Date.now()}.bin`);
      const archivoScript = path.join(carpetaTmp, `n360_print_${Date.now()}.ps1`);
      fs.writeFileSync(archivoTicket, bytes);

      // Escapado simple para que el nombre de la impresora (que puede
      // traer espacios) no rompa el script de PowerShell.
      const nombreEscapado = String(nombreImpresora).replace(/"/g, '`"');
      const rutaTicketEscapada = archivoTicket.replace(/\\/g, '\\\\');

      const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Negocio360RawPrint {
  [StructLayout(LayoutKind.Sequential)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static bool EnviarBytes(string nombreImpresora, byte[] datos) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "Negocio360 - Ticket";
    di.pDataType = "RAW";
    bool exito = false;
    if (!OpenPrinter(nombreImpresora, out hPrinter, IntPtr.Zero)) return false;
    try {
      if (!StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!StartPagePrinter(hPrinter)) return false;
        try {
          IntPtr pDatos = Marshal.AllocCoTaskMem(datos.Length);
          try {
            Marshal.Copy(datos, 0, pDatos, datos.Length);
            int escritos;
            exito = WritePrinter(hPrinter, pDatos, datos.Length, out escritos);
          } finally { Marshal.FreeCoTaskMem(pDatos); }
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
    return exito;
  }
}
"@
$datos = [System.IO.File]::ReadAllBytes("${rutaTicketEscapada}")
$resultado = [Negocio360RawPrint]::EnviarBytes("${nombreEscapado}", $datos)
if ($resultado) { Write-Output "NEGOCIO360_OK" } else { Write-Output "NEGOCIO360_ERROR" }
`;
      fs.writeFileSync(archivoScript, script);

      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${archivoScript}"`,
        { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
          try { fs.unlinkSync(archivoTicket); } catch (e) {}
          try { fs.unlinkSync(archivoScript); } catch (e) {}

          if (err) { resolve({ ok: false, motivo: 'No se pudo ejecutar la impresión: ' + err.message }); return; }
          if (String(stdout).includes('NEGOCIO360_OK')) { resolve({ ok: true }); return; }
          resolve({ ok: false, motivo: 'La impresora rechazó los datos (revisa que esté encendida y con papel).' });
        });
    } catch (e) {
      resolve({ ok: false, motivo: 'Error preparando la impresión: ' + e.message });
    }
  });
}

ipcMain.handle('n360-listar-impresoras', async () => listarImpresorasWindows());
ipcMain.handle('n360-imprimir-escpos', async (_event, { nombreImpresora, bytesBase64 }) => {
  if (!nombreImpresora) return { ok: false, motivo: 'No se indicó qué impresora usar.' };
  return imprimirRawWindows(nombreImpresora, bytesBase64);
});

app.whenReady().then(() => {
  crearMenu();
  crearSplash();
  crearVentanaPrincipal();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentanaPrincipal();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
