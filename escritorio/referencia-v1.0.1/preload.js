// Puente seguro entre la página web y Node.js — solo expone
// funciones específicas de impresión, nunca acceso general a Node.
// La página web (Negocio360) puede llamar a window.negocio360Print,
// pero no puede tocar el sistema de archivos ni ejecutar comandos
// directamente por su cuenta.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('negocio360Print', {
  // Presencia de esta bandera es como el sistema web sabe que está
  // corriendo dentro de la app de escritorio, y no en un navegador
  // normal -- así puede ofrecer la impresión directa cuando aplique.
  disponible: true,

  listarImpresoras: () => ipcRenderer.invoke('n360-listar-impresoras'),

  // bytes: Uint8Array ya armado (ESC/POS) por el propio sistema web.
  // nombreImpresora: el nombre exacto tal como aparece en Windows.
  imprimir: (nombreImpresora, bytes) => {
    const bytesBase64 = Buffer.from(bytes).toString('base64');
    return ipcRenderer.invoke('n360-imprimir-escpos', { nombreImpresora, bytesBase64 });
  },
});
