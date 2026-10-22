// Puente seguro entre las páginas del sistema y el programa. Solo expone
// funciones concretas (imprimir, estado de conexión); las páginas nunca
// tienen acceso a archivos ni a comandos del equipo.
//
// window.negocio360Print: MISMA interfaz que la versión 1.0.1, la que ya usa
// ventas.js (disponible, listarImpresoras, imprimir).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Mientras una venta sin conexión se está guardando en el equipo, los tickets
// esperan: se imprimen solo cuando la venta ya quedó guardada (si algo falla,
// no sale un ticket de una venta que no existe).
let retenerTickets = false;
let ticketsRetenidos = [];
const mandarTicket = (datos) => ipcRenderer.invoke('n360-imprimir-escpos', datos);

contextBridge.exposeInMainWorld('negocio360Print', {
  disponible: true,
  listarImpresoras: () => ipcRenderer.invoke('n360-listar-impresoras'),
  // bytes: Uint8Array con el ticket ESC/POS armado por la página.
  imprimir: (nombreImpresora, bytes) => {
    const datos = {
      nombreImpresora: String(nombreImpresora || ''),
      bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []),
    };
    if (retenerTickets) { ticketsRetenidos.push(datos); return Promise.resolve({ ok: true, retenido: true }); }
    return mandarTicket(datos);
  },
});

// Modo sin conexión: bandeja de ventas, catálogo local y números (todo en el
// proceso principal; la página nunca toca archivos).
const oyentesSinConexion = new Set();
ipcRenderer.on('n360so-evento', (_e, ev) => {
  for (const fn of oyentesSinConexion) { try { fn(ev); } catch (_) { /* oyente de la página */ } }
  if (ev && ev.tipo === 'estado' && ev.estado) { ultimoSinConexion = ev.estado; if (ultimoEstado) pintar(ultimoEstado); }
});
let ultimoSinConexion = null;
const so = (canal) => (...args) => ipcRenderer.invoke(canal, ...args);
contextBridge.exposeInMainWorld('negocio360SinConexion', {
  estado: so('n360so-estado'),
  fijarSesion: so('n360so-sesion'),
  catalogoLeer: so('n360so-catalogo-leer'),
  catalogoReemplazar: so('n360so-catalogo-reemplazar'),
  catalogoInfo: so('n360so-catalogo-info'),
  rpcGuardar: so('n360so-rpc-guardar'),
  rpcLeer: so('n360so-rpc-leer'),
  numeroTomar: so('n360so-numero'),
  ventaGuardar: so('n360so-venta-guardar'),
  ventasListar: so('n360so-ventas-listar'),
  ventaAnular: so('n360so-venta-anular'),
  ventaReintentar: so('n360so-venta-reintentar'),
  subirAhora: so('n360so-subir-ahora'),
  exportar: so('n360so-exportar'),
  pinGuardar: so('n360so-pin-guardar'),
  pinVerificar: so('n360so-pin-verificar'),
  alCambiar: (fn) => {
    if (typeof fn !== 'function') return () => {};
    oyentesSinConexion.add(fn);
    return () => oyentesSinConexion.delete(fn);
  },
  retenerImpresion: () => { retenerTickets = true; ticketsRetenidos = []; },
  liberarImpresion: () => {
    retenerTickets = false;
    const lista = ticketsRetenidos; ticketsRetenidos = [];
    return Promise.all(lista.map((d) => mandarTicket(d).catch((e) => ({ ok: false, motivo: String(e && e.message) }))));
  },
  descartarImpresion: () => { retenerTickets = false; ticketsRetenidos = []; },
});

const oyentes = new Set();
let ultimoEstado = null;
ipcRenderer.on('n360-conexion', (_e, estado) => {
  ultimoEstado = estado;
  pintar(estado);
  for (const fn of oyentes) { try { fn(estado); } catch (_) { /* oyente de la página */ } }
});

contextBridge.exposeInMainWorld('negocio360Escritorio', {
  esEscritorio: true,
  info: () => ipcRenderer.invoke('n360-info'),
  estadoConexion: () => ipcRenderer.invoke('n360-estado-conexion'),
  reintentarConexion: () => ipcRenderer.invoke('n360-reintentar-conexion'),
  alCambiarConexion: (fn) => {
    if (typeof fn !== 'function') return () => {};
    oyentes.add(fn);
    if (ultimoEstado) { try { fn(ultimoEstado); } catch (_) { /* nada */ } }
    return () => oyentes.delete(fn);
  },
});

// ---------- Indicador 🟢🟠🔴 y aviso "Requiere conexión" ----------
// Se dibuja dentro de un "shadow DOM": los estilos de la página no lo
// afectan y él no afecta a la página.
const TEXTOS = {
  en_linea: { punto: '#22c55e', texto: 'En línea' },
  inestable: { punto: '#f59e0b', texto: 'Conexión inestable' },
  verificando: { punto: '#f59e0b', texto: 'Verificando conexión…' },
  sin_conexion: { punto: '#ef4444', texto: 'Sin conexión' },
};
let host = null; let raiz = null;

function crearIndicador() {
  if (host || !document.body) return;
  host = document.createElement('div');
  host.setAttribute('data-n360-escritorio', '');
  host.style.cssText = 'all:initial;position:fixed;left:10px;bottom:10px;z-index:2147483646;';
  raiz = host.attachShadow({ mode: 'open' });
  raiz.innerHTML = `
    <style>
      .pildora{display:flex;align-items:center;gap:6px;font:600 11px/1 "Segoe UI",system-ui,sans-serif;
        color:#e8e8ee;background:rgba(15,15,20,.82);padding:5px 9px;border-radius:999px;
        box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:default;user-select:none;opacity:.85}
      .pildora:hover{opacity:1}
      .punto{width:8px;height:8px;border-radius:50%}
      .velo{position:fixed;inset:0;display:none;align-items:center;justify-content:center;
        background:rgba(10,10,16,.72);backdrop-filter:blur(2px);z-index:2147483647}
      .velo.visible{display:flex}
      .caja{background:#15151d;color:#e8e8ee;border-radius:14px;padding:28px 30px;max-width:380px;text-align:center;
        font:14px/1.5 "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.4)}
      .caja h2{font-size:18px;margin:8px 0}
      .caja p{color:#a8a8b8;margin:0 0 18px}
      .caja button{background:#6C63FF;color:#fff;border:0;border-radius:10px;padding:10px 22px;font-weight:600;cursor:pointer;font-size:14px;margin:4px}
      .caja button.secundario{background:transparent;color:#c8c4ff;border:1px solid #4b46a8;display:none}
      .pildora.tocable{cursor:pointer}
    </style>
    <div class="pildora" id="pildora" role="status" aria-live="polite"><span class="punto" id="punto"></span><span id="texto"></span></div>
    <div class="velo" id="velo" role="alertdialog" aria-labelledby="velo-titulo">
      <div class="caja">
        <div style="font-size:42px">📡</div>
        <h2 id="velo-titulo">Requiere conexión</h2>
        <p>Esta pantalla necesita internet. Cuando vuelva la conexión, todo sigue normal; no se perdió nada.</p>
        <button type="button" id="velo-reintentar">Reintentar</button>
        <button type="button" id="velo-ventas" class="secundario">Ir a Ventas</button>
      </div>
    </div>`;
  raiz.getElementById('velo-reintentar').addEventListener('click', () => ipcRenderer.invoke('n360-reintentar-conexion'));
  raiz.getElementById('velo-ventas').addEventListener('click', () => { location.href = 'ventas.html'; });
  raiz.getElementById('pildora').addEventListener('click', () => {
    if (ultimoSinConexion && ultimoSinConexion.habilitado) location.href = 'sincronizacion.html';
  });
  document.body.appendChild(host);
  if (ultimoEstado) pintar(ultimoEstado);
}

// Una página puede declarar que funciona sin conexión con
// <html data-n360-sin-conexion="permitido"> (Fase 3: Ventas).
function paginaFuncionaSinConexion() {
  return document.documentElement && document.documentElement.getAttribute('data-n360-sin-conexion') === 'permitido';
}

function pintar(estado) {
  if (!raiz || !estado) return;
  const visible = estado.visible || estado.conexion;
  const t = TEXTOS[visible] || TEXTOS.verificando;
  raiz.getElementById('punto').style.background = t.punto;
  let texto = t.texto;
  if (estado.pendientes > 0) texto = `${estado.pendientes} venta(s) por subir`;
  raiz.getElementById('texto').textContent = texto;
  raiz.getElementById('pildora').title = estado.ultimoContacto
    ? `Último contacto con el servidor: ${new Date(estado.ultimoContacto).toLocaleTimeString()}` : '';
  const habilitado = !!(ultimoSinConexion && ultimoSinConexion.habilitado);
  raiz.getElementById('pildora').classList.toggle('tocable', habilitado);
  if (habilitado) raiz.getElementById('pildora').title += (raiz.getElementById('pildora').title ? ' · ' : '') + 'Toca para ver la sincronización';
  raiz.getElementById('velo-ventas').style.display = habilitado ? 'inline-block' : 'none';
  raiz.getElementById('velo').classList.toggle('visible', estado.conexion === 'sin_conexion' && !paginaFuncionaSinConexion());
}

window.addEventListener('DOMContentLoaded', () => {
  // Solo en páginas del sistema (no en ventanas de ticket ni comprobantes).
  if (location.origin !== 'app://negocio360') return;
  crearIndicador();
  ipcRenderer.invoke('n360-estado-conexion').then((e) => { ultimoEstado = e; pintar(e); }).catch(() => {});
  ipcRenderer.invoke('n360so-estado').then((e) => { ultimoSinConexion = e; if (ultimoEstado) pintar(ultimoEstado); }).catch(() => {});
});
