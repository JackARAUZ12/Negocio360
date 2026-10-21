'use strict';
const { app, BrowserWindow } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const fs = require('fs');
app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-humo-'));
  const db = new DatabaseSync(path.join(dir, 'prueba.db'));
  const journal = db.prepare('pragma journal_mode=wal').get().journal_mode;
  db.exec('pragma synchronous=full; create table t(id integer primary key, v text)');
  const ins = db.prepare('insert into t(v) values (?)');
  db.exec('begin'); for (const v of ['a', 'b', 'c']) ins.run(v); db.exec('commit');
  globalThis.__resultadoHumo = {
    journal, sync: db.prepare('pragma synchronous').get().synchronous,
    filas: db.prepare('select count(*) n from t').get().n,
    sqlite: db.prepare('select sqlite_version() v').get().v,
    electron: process.versions.electron, node: process.versions.node,
  };
  db.close();
  const w = new BrowserWindow({ show: false });
  w.loadURL('data:text/html,<title>Humo</title>');
});
