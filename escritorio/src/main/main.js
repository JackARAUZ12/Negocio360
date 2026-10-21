// Negocio360 Escritorio — proceso principal.
// Abre las MISMAS páginas del sistema web, pero empaquetadas dentro del
// programa (app://negocio360/...), con impresión directa a Windows,
// una sola instancia abierta e indicador de conexión.
'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain, protocol, net, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { crearConfig, ESQUEMA, ORIGEN, PAGINA_INICIO, SUPABASE_CLAVE_PUBLICA, SITIO_WEB } = require('./config');
const { resolverArchivo } = require('./rutas');
const seg = require('./seguridad');
const { crearImpresion } = require('./impresion');
const { crearMonitor, crearComprobador } = require('./conexion');
const { iniciarActualizador } = require('./actualizador');

const CFG = crearConfig({ empaquetado: app.isPackaged, rutaRecursos: process.resourcesPath });
if (CFG.carpetaDatos) app.setPath('userData', CFG.carpetaDatos);

protocol.registerSchemesAsPrivileged([{
  scheme: ESQUEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// El programa instalado no se deja abrir en modo de depuración remota.
if (app.isPackaged && process.argv.some((a) => /^--(remote-debugging-(port|pipe)|inspect)/.test(a))) {
  app.exit(1);
}

// ---------- Una sola instancia ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (ventanaPrincipal) {
      if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
      ventanaPrincipal.show();
      ventanaPrincipal.focus();
    }
  });
  app.whenReady().then(iniciar);
}

let ventanaPrincipal = null;
let splash = null;
let monitor = null;
let actualizador = { activo: false };

const PREFS_SISTEMA = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,
  preload: path.join(__dirname, '..', 'preload', 'preload.js'),
};
const PREFS_AUXILIAR = { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true };

function urlPagina(pagina) { return `${ORIGEN}/${pagina}`; }

// ---------- Páginas empaquetadas ----------
function registrarProtocolo() {
  protocol.handle(ESQUEMA, async (req) => {
    const r = resolverArchivo(CFG.raizWeb, req.url);
    if (r.error) return new Response('No permitido', { status: r.error });
    try {
      const st = await fs.promises.stat(r.ruta);
      if (!st.isFile()) return new Response('No encontrado', { status: 404 });
    } catch (_) { return new Response('No encontrado', { status: 404 }); }
    const res = await net.fetch(pathToFileURL(r.ruta).toString());
    const cabeceras = new Headers(res.headers);
    cabeceras.set('Cache-Control', 'no-cache');
    cabeceras.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers: cabeceras });
  });
}

// ---------- Reglas de seguridad para todas las ventanas ----------
function aplicarReglas(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    const d = seg.decidirVentanaNueva(url);
    if (d === 'navegador') { shell.openExternal(url); return { action: 'deny' }; }
    if (d === 'ventana-sistema') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 780, autoHideMenuBar: true, webPreferences: PREFS_SISTEMA } };
    }
    if (d === 'ventana-auxiliar') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 420, height: 640, autoHideMenuBar: true, webPreferences: PREFS_AUXILIAR } };
    }
    return { action: 'deny' };
  });
  contents.on('will-navigate', (ev, url) => {
    const d = seg.decidirNavegacion(url);
    if (d === 'permitir') return;
    ev.preventDefault();
    if (d === 'navegador') shell.openExternal(url);
  });
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
}

function configurarSesion() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permiso, cb, detalles) => cb(seg.permisoPermitido(permiso, (detalles && detalles.requestingUrl) || wc.getURL())));
  ses.setPermissionCheckHandler((wc, permiso, origen) => seg.permisoPermitido(permiso, origen));
}

// ---------- Ventanas ----------
function crearSplash() {
  splash = new BrowserWindow({
    width: 380, height: 320, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    center: true, skipTaskbar: true, show: true,
    webPreferences: { ...PREFS_AUXILIAR, autoplayPolicy: 'no-user-gesture-required' },
  });
  splash.loadFile(path.join(CFG.carpetaRecursos, 'splash.html'));
  splash.on('closed', () => { splash = null; });
}

function crearVentanaPrincipal() {
  ventanaPrincipal = new BrowserWindow({
    width: 1360, height: 850, minWidth: 980, minHeight: 600,
    title: 'Negocio360', backgroundColor: '#0f0f14', show: false,
    icon: path.join(CFG.carpetaRecursos, 'icono.png'),
    webPreferences: PREFS_SISTEMA,
  });
  const minimo = new Promise((r) => setTimeout(r, CFG.sinSplash ? 0 : 2600));
  const cargada = new Promise((r) => {
    ventanaPrincipal.webContents.once('did-finish-load', r);
    ventanaPrincipal.webContents.once('did-fail-load', r);
  });
  Promise.all([minimo, cargada]).then(async () => {
    if (splash) {
      try { await splash.webContents.executeJavaScript("document.getElementById('fondo').classList.add('saliendo')"); } catch (_) { /* sin efecto */ }
      await new Promise((r) => setTimeout(r, 450));
      if (splash) splash.close();
    }
    if (ventanaPrincipal) ventanaPrincipal.show();
  });
  ventanaPrincipal.loadURL(urlPagina(PAGINA_INICIO));
  ventanaPrincipal.on('closed', () => { ventanaPrincipal = null; });
}

function abrirAuxiliar(archivo, titulo, consulta) {
  const w = new BrowserWindow({ width: 440, height: 440, title: titulo, autoHideMenuBar: true, backgroundColor: '#0f0f14', webPreferences: PREFS_AUXILIAR });
  w.loadFile(path.join(CFG.carpetaRecursos, archivo), consulta ? { query: consulta } : undefined);
}

function crearMenu() {
  const irA = (p) => ventanaPrincipal && ventanaPrincipal.loadURL(urlPagina(p));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Negocio360', submenu: [
      { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => ventanaPrincipal && ventanaPrincipal.webContents.reload() },
      { label: 'Ir al inicio', click: () => irA('dashboard.html') },
      { label: 'Atrás', accelerator: 'Alt+Left', click: () => ventanaPrincipal && ventanaPrincipal.webContents.navigationHistory.canGoBack() && ventanaPrincipal.webContents.navigationHistory.goBack() },
      { type: 'separator' },
      { label: 'Pantalla completa', accelerator: 'F11', click: () => ventanaPrincipal && ventanaPrincipal.setFullScreen(!ventanaPrincipal.isFullScreen()) },
      { label: 'Acercar', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
      { label: 'Alejar', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      { label: 'Zoom normal', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Salir', role: 'quit' },
    ] },
    { label: 'Ayuda y legal', submenu: [
      { label: 'Términos y Condiciones', click: () => irA('terminos.html') },
      { label: 'Política de Privacidad', click: () => irA('privacidad.html') },
      { type: 'separator' },
      { label: 'Hablar por WhatsApp', click: () => shell.openExternal('https://wa.me/50512345678') },
      { label: 'Sitio web', click: () => shell.openExternal(SITIO_WEB) },
      { type: 'separator' },
      { label: 'Acerca de Negocio360', click: () => abrirAuxiliar('acerca.html', 'Acerca de Negocio360', { v: app.getVersion() }) },
    ] },
  ]));
}

// ---------- Mensajes de las páginas ----------
function registrarMensajes(impresion) {
  const solo = (fn) => async (ev, ...args) => {
    if (!seg.remitenteValido(ev)) return { ok: false, motivo: 'No permitido.' };
    return fn(...args);
  };
  ipcMain.handle('n360-listar-impresoras', solo(() => impresion.listar()));
  ipcMain.handle('n360-imprimir-escpos', solo((datos) => impresion.imprimir(datos && datos.nombreImpresora, datos && datos.bytes)));
  ipcMain.handle('n360-estado-conexion', solo(() => monitor.obtener()));
  ipcMain.handle('n360-reintentar-conexion', solo(() => monitor.revisarAhora().then(() => monitor.obtener())));
  ipcMain.handle('n360-info', solo(() => ({ version: app.getVersion(), plataforma: process.platform, prueba: CFG.prueba })));
}

function difundir(canal, dato) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && seg.esUrlInterna(w.webContents.getURL())) w.webContents.send(canal, dato);
  }
}

// Solo en pruebas (nunca en el instalador): una impresora falsa que guarda
// los bytes de cada ticket en una carpeta, para revisar la cadena completa.
function impresoraSimulada(carpeta) {
  let n = 0;
  return {
    obtenerImpresoras: async () => [{ name: 'EPSON TM-U220 (simulada)' }],
    ejecutar: async (_cmd, _args, opts) => {
      fs.mkdirSync(carpeta, { recursive: true });
      fs.copyFileSync(opts.env.N360_ARCHIVO, path.join(carpeta, `ticket-${++n}.bin`));
      fs.writeFileSync(path.join(carpeta, `ticket-${n}.impresora.txt`), opts.env.N360_IMPRESORA);
      return { stdout: 'NEGOCIO360_OK' };
    },
    plataforma: 'win32',
    carpetaTmp: app.getPath('temp'),
    rutaScript: 'simulada.ps1',
  };
}

function iniciar() {
  registrarProtocolo();
  configurarSesion();
  app.on('web-contents-created', (_e, contents) => aplicarReglas(contents));

  const impresion = crearImpresion(CFG.impresionSimulada ? impresoraSimulada(CFG.impresionSimulada) : {
    obtenerImpresoras: async () => {
      const w = ventanaPrincipal || BrowserWindow.getAllWindows()[0];
      return w ? w.webContents.getPrintersAsync() : [];
    },
    ejecutar: promisify(execFile),
    carpetaTmp: app.getPath('temp'),
    rutaScript: path.join(CFG.carpetaRecursos, 'imprimir-raw.ps1'),
  });
  monitor = crearMonitor({
    comprobar: crearComprobador({ fetch: net.fetch, url: CFG.urlSalud, clave: SUPABASE_CLAVE_PUBLICA }),
    hayRed: () => net.isOnline(),
    alCambiar: (estado) => difundir('n360-conexion', estado),
  });
  registrarMensajes(impresion);
  crearMenu();
  if (!CFG.sinSplash) crearSplash();
  crearVentanaPrincipal();
  monitor.iniciar();

  try {
    const { autoUpdater } = require('electron-updater');
    actualizador = iniciarActualizador({
      autoUpdater, empaquetado: app.isPackaged,
      puedeInstalar: () => true, // Fase 3: false si hay ventas sin subir
      avisar: (msg) => ventanaPrincipal && dialog.showMessageBox(ventanaPrincipal, { type: 'info', message: msg, buttons: ['Entendido'] }),
    });
  } catch (e) { console.warn('Actualizador no disponible:', e.message); }
}

app.on('will-quit', () => {
  if (monitor) monitor.detener();
  if (actualizador.activo) actualizador.alSalir();
});
app.on('window-all-closed', () => app.quit());
