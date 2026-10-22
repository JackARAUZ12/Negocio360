// Negocio360 Escritorio — proceso principal.
// Abre las MISMAS páginas del sistema web, pero empaquetadas dentro del
// programa (app://negocio360/...), con impresión directa a Windows,
// una sola instancia abierta e indicador de conexión.
'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain, protocol, net, session, dialog, safeStorage } = require('electron');
const os = require('os');
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
const { abrirBase } = require('./base-local');
const { crearSincronizador } = require('./sincronizador');

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
let base = null;
let sinc = null;
let temporizadorRespaldo = null;

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
      { label: 'Ventas', click: () => irA('ventas.html') },
      { label: 'Sincronización', click: () => irA('sincronizacion.html') },
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
  registrarMensajesSinConexion(solo);
}

// Modo sin conexión. Todo se guarda bajo la cuenta de la sesión que pasó la
// página (verificada contra su token); sin sesión no se lee ni se guarda nada.
function registrarMensajesSinConexion(solo) {
  const conCuenta = (fn) => solo((...args) => {
    const c = sinc.cuenta();
    if (!c) throw new Error('No hay una sesión iniciada en el programa.');
    return fn(c, ...args);
  });
  const texto = (x, max = 200) => String(x == null ? '' : x).slice(0, max);
  ipcMain.handle('n360so-estado', solo(() => sinc.obtener()));
  ipcMain.handle('n360so-sesion', solo((s) => sinc.fijarSesion(s && {
    access_token: texto(s.access_token, 8000), user_id: texto(s.user_id, 64), email: s.email ? texto(s.email, 200) : null,
  })));
  ipcMain.handle('n360so-catalogo-leer', conCuenta((c, tablas) => base.catalogoLeer(c, (Array.isArray(tablas) ? tablas : []).map((t) => texto(t, 64)).slice(0, 60))));
  ipcMain.handle('n360so-catalogo-reemplazar', conCuenta((c, tabla, filas) => base.catalogoReemplazar(c, texto(tabla, 64), Array.isArray(filas) ? filas : [])));
  ipcMain.handle('n360so-catalogo-info', conCuenta((c) => base.catalogoInfo(c)));
  ipcMain.handle('n360so-rpc-guardar', conCuenta((c, clave, datos) => base.rpcGuardar(c, texto(clave, 100), datos)));
  ipcMain.handle('n360so-rpc-leer', conCuenta((c, clave) => base.rpcLeer(c, texto(clave, 100))));
  ipcMain.handle('n360so-numero', conCuenta((c) => {
    const n = base.numeroTomar(c);
    if (base.numerosLibres(c) < 15) sinc.despertar(0);
    return n;
  }));
  ipcMain.handle('n360so-venta-guardar', conCuenta((c, v) => {
    if (!sinc.estadoCuenta(c).habilitado) throw new Error('El modo sin conexión no está activo para esta cuenta.');
    const r = base.ventaGuardar(c, v);
    sinc.publicar();
    sinc.despertar(0);
    return r;
  }));
  ipcMain.handle('n360so-ventas-listar', conCuenta((c, opciones) => base.ventasListar(c, opciones || {})));
  ipcMain.handle('n360so-venta-anular', conCuenta((c, uuid) => { const r = base.ventaAnular(c, texto(uuid, 40)); sinc.publicar(); return r; }));
  ipcMain.handle('n360so-venta-reintentar', conCuenta((c, uuid) => { const r = base.reintentar(c, texto(uuid, 40)); sinc.despertar(0); return r; }));
  ipcMain.handle('n360so-subir-ahora', solo(async () => { await sinc.subirAhora(); return sinc.obtener(); }));
  ipcMain.handle('n360so-exportar', conCuenta(async (c) => {
    const ventas = base.exportar(c);
    const destino = await dialog.showSaveDialog(ventanaPrincipal || undefined, {
      title: 'Exportar ventas pendientes',
      defaultPath: path.join(app.getPath('documents'), `ventas-pendientes-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Archivo de ventas', extensions: ['json'] }],
    });
    if (destino.canceled || !destino.filePath) return { ok: false, cancelado: true };
    fs.writeFileSync(destino.filePath, JSON.stringify({ cuenta: c, equipo: base.dispositivoUid(), exportado: new Date().toISOString(), ventas }, null, 2));
    return { ok: true, ruta: destino.filePath, cantidad: ventas.length };
  }));
  ipcMain.handle('n360so-pin-guardar', conCuenta((c, d) => base.pinGuardar(c, {
    perfil_id: texto(d && d.perfil_id, 64), pin: texto(d && d.pin, 64), nombre: d && d.nombre ? texto(d.nombre, 120) : null, principal: !!(d && d.principal),
  })));
  ipcMain.handle('n360so-pin-verificar', conCuenta((c, pin, perfilId) => base.pinVerificar(c, texto(pin, 64), perfilId ? texto(perfilId, 64) : null)));
}

function cifradorDelEquipo() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return {
      cifrar: (buf) => safeStorage.encryptString(buf.toString('utf8')),
      descifrar: (buf) => Buffer.from(safeStorage.decryptString(buf), 'utf8'),
    };
  } catch (_) { return null; }
}

function iniciarSinConexion() {
  const carpeta = path.join(app.getPath('userData'), 'local');
  base = abrirBase(path.join(carpeta, 'negocio360.db'), { cifrador: cifradorDelEquipo() });
  const respaldar = () => { try { base.respaldar(path.join(carpeta, 'respaldos')); } catch (e) { console.warn('Respaldo local:', e.message); } };
  respaldar();
  temporizadorRespaldo = setInterval(respaldar, 6 * 3600 * 1000);
  temporizadorRespaldo.unref();
  sinc = crearSincronizador({
    base, fetch: net.fetch, url: CFG.urlServidor, clave: SUPABASE_CLAVE_PUBLICA,
    dispositivo: { nombre: os.hostname(), version: app.getVersion(), plataforma: `${process.platform}-${process.arch}` },
    avisar: (ev) => difundir('n360so-evento', ev),
    fijarPendientes: (n) => monitor && monitor.fijarPendientes(n),
    hayConexion: () => !monitor || monitor.obtener().conexion !== 'sin_conexion',
  });
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
    alCambiar: (estado) => {
      difundir('n360-conexion', estado);
      if (sinc && estado.conexion !== 'sin_conexion') sinc.despertar(0);
    },
    ...(CFG.intervaloConexionMs ? { intervaloEnLinea: CFG.intervaloConexionMs, intervaloSinConexion: CFG.intervaloConexionMs } : {}),
  });
  iniciarSinConexion();
  registrarMensajes(impresion);
  crearMenu();
  if (!CFG.sinSplash) crearSplash();
  crearVentanaPrincipal();
  monitor.iniciar();
  sinc.iniciar();

  try {
    const { autoUpdater } = require('electron-updater');
    actualizador = iniciarActualizador({
      autoUpdater, empaquetado: app.isPackaged,
      puedeInstalar: () => !base || base.totalSinSubir() === 0, // nunca con ventas sin subir
      avisar: (msg) => ventanaPrincipal && dialog.showMessageBox(ventanaPrincipal, { type: 'info', message: msg, buttons: ['Entendido'] }),
    });
  } catch (e) { console.warn('Actualizador no disponible:', e.message); }
}

app.on('will-quit', () => {
  if (monitor) monitor.detener();
  if (sinc) sinc.detener();
  if (temporizadorRespaldo) clearInterval(temporizadorRespaldo);
  if (base) { try { base.cerrar(); } catch (_) { /* ya cerrada */ } }
  if (actualizador.activo) actualizador.alSalir();
});
app.on('window-all-closed', () => app.quit());
