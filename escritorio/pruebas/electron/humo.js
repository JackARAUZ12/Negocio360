// Prueba de humo: Electron arranca en este entorno y su SQLite integrado
// funciona en modo WAL con synchronous=FULL (lo que usará la base local).
'use strict';
const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, 'humo-main.js'), '--no-sandbox'],
  });
  const r = await app.evaluate(async () => globalThis.__resultadoHumo);
  const win = await app.firstWindow();
  const titulo = await win.title();
  await app.close();
  if (!r || r.journal !== 'wal' || r.sync !== 2 || r.filas !== 3 || titulo !== 'Humo') {
    console.error('FALLO', r, titulo); process.exit(1);
  }
  console.log('OK electron', r.electron, 'node', r.node, 'sqlite', r.sqlite);
})().catch((e) => { console.error(e); process.exit(1); });
