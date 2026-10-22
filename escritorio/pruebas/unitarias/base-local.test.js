'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { abrirBase, MAX_FALLOS_PIN } = require('../../src/main/base-local');

const C = 'cuenta-a';
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'n360-base-'));
function nueva(opts) { const dir = carpeta(); return { dir, b: abrirBase(path.join(dir, 'local.db'), opts) }; }
const venta = (extra = {}) => ({
  uuid: crypto.randomUUID(), numero: 'V-000458', total: 100,
  payload: { version: 1, venta: { numero_venta: 'V-000458', total: 100 } },
  filasLocales: [{ tabla: 'ventas', fila: { id: 'local-1', numero_venta: 'V-000458' } }],
  deltas: [{ tabla: 'productos', id: 'p1', campo: 'stock_actual', delta: -2 }],
  ...extra,
});

test('el identificador del equipo se crea una vez y no cambia', () => {
  const { dir, b } = nueva();
  const uid = b.dispositivoUid();
  assert.match(uid, /^[0-9a-f-]{36}$/);
  b.cerrar();
  const b2 = abrirBase(path.join(dir, 'local.db'));
  assert.strictEqual(b2.dispositivoUid(), uid);
  b2.cerrar();
});

test('catálogo: reemplazar vuelve a aplicar las ventas aún no subidas', () => {
  const { b } = nueva();
  b.catalogoReemplazar(C, 'productos', [{ id: 'p1', stock_actual: 10 }, { id: 'p2', stock_actual: 5 }]);
  const v = venta();
  b.ventaGuardar(C, v);
  assert.strictEqual(b.catalogoLeer(C, ['productos']).productos.find((p) => p.id === 'p1').stock_actual, 8);
  // El servidor todavía no tiene la venta: su copia dice 10; la local debe seguir en 8.
  b.catalogoReemplazar(C, 'productos', [{ id: 'p1', stock_actual: 10 }]);
  assert.strictEqual(b.catalogoLeer(C, ['productos']).productos[0].stock_actual, 8);
  b.catalogoReemplazar(C, 'ventas', []);
  assert.deepStrictEqual(b.catalogoLeer(C, ['ventas']).ventas.map((x) => x.id), ['local-1']);
  // Ya subida: el servidor manda 8 y no se resta otra vez.
  b.marcarSubida(v.uuid, { ok: true });
  b.catalogoReemplazar(C, 'productos', [{ id: 'p1', stock_actual: 8 }]);
  assert.strictEqual(b.catalogoLeer(C, ['productos']).productos[0].stock_actual, 8);
  b.catalogoReemplazar(C, 'ventas', [{ id: 'srv-1' }]);
  assert.deepStrictEqual(b.catalogoLeer(C, ['ventas']).ventas.map((x) => x.id), ['srv-1']);
  b.cerrar();
});

test('las cuentas no se mezclan', () => {
  const { b } = nueva();
  b.catalogoReemplazar(C, 'productos', [{ id: 'p1', stock_actual: 10 }]);
  b.ventaGuardar(C, venta());
  assert.deepStrictEqual(b.catalogoLeer('otra', ['productos']).productos, []);
  assert.strictEqual(b.contar('otra').pendientes, 0);
  assert.strictEqual(b.ventasListar('otra').length, 0);
  assert.strictEqual(b.totalSinSubir(), 1);
  assert.strictEqual(b.ventaAnular('otra', b.ventasListar(C)[0].uuid).ok, false);
  b.cerrar();
});

test('guardar la misma venta dos veces no la duplica; mismo uuid con otro contenido se rechaza', () => {
  const { b } = nueva();
  b.catalogoReemplazar(C, 'productos', [{ id: 'p1', stock_actual: 10 }]);
  const v = venta();
  assert.strictEqual(b.ventaGuardar(C, v).repetida, false);
  assert.strictEqual(b.ventaGuardar(C, v).repetida, true);
  assert.strictEqual(b.catalogoLeer(C, ['productos']).productos[0].stock_actual, 8);
  assert.throws(() => b.ventaGuardar(C, { ...v, payload: { version: 1, otra: true } }), /otro contenido/);
  assert.throws(() => b.ventaGuardar(C, { ...v, uuid: 'x' }), /uuid/);
  b.cerrar();
});

test('bandeja: orden de subida, reintentos, errores y corte a mitad de subida', () => {
  let t = 1000;
  const { dir, b } = nueva({ ahora: () => t });
  const v1 = venta(); t += 10; const v2 = venta();
  b.ventaGuardar(C, v1); t += 10; b.ventaGuardar(C, v2);
  assert.strictEqual(b.siguienteParaSubir(C).uuid, v1.uuid);
  b.marcarEnviando(v1.uuid);
  assert.strictEqual(b.siguienteParaSubir(C).uuid, v2.uuid);
  assert.strictEqual(b.contar(C).pendientes, 2);
  // apagón: al abrir de nuevo, "enviando" vuelve a pendiente
  b.cerrar();
  const b2 = abrirBase(path.join(dir, 'local.db'), { ahora: () => t });
  assert.strictEqual(b2.ventasListar(C, { estados: ['pendiente'] }).length, 2);
  b2.marcarReintento(v1.uuid, 'sin red', 5000);
  assert.strictEqual(b2.siguienteParaSubir(C).uuid, v2.uuid);
  b2.marcarError(v2.uuid, 'formato');
  assert.strictEqual(b2.siguienteParaSubir(C), undefined);
  t += 6000;
  assert.strictEqual(b2.siguienteParaSubir(C).uuid, v1.uuid);
  assert.strictEqual(b2.contar(C).errores, 1);
  assert.ok(b2.reintentar(C, v2.uuid));
  assert.strictEqual(b2.contar(C).errores, 0);
  assert.strictEqual(b2.exportar(C).length, 2);
  assert.ok(b2.exportar(C)[0].payload.venta);
  b2.cerrar();
});

test('anular solo ventas no subidas; devuelve el stock local', () => {
  const { b } = nueva();
  b.catalogoReemplazar(C, 'productos', [{ id: 'p1', stock_actual: 10 }]);
  const v = venta(); const w = venta({ filasLocales: [], deltas: [] });
  b.ventaGuardar(C, v); b.ventaGuardar(C, w);
  assert.ok(b.ventaAnular(C, v.uuid).ok);
  assert.strictEqual(b.catalogoLeer(C, ['productos']).productos[0].stock_actual, 10);
  assert.deepStrictEqual(b.catalogoLeer(C, ['ventas']).ventas, []);
  assert.strictEqual(b.siguienteParaSubir(C).uuid, w.uuid);
  b.marcarEnviando(w.uuid);
  assert.match(b.ventaAnular(C, w.uuid).motivo, /subiendo/);
  b.marcarSubida(w.uuid, {});
  assert.match(b.ventaAnular(C, w.uuid).motivo, /servidor/);
  assert.strictEqual(b.totalSinSubir(), 0);
  b.cerrar();
});

test('números por bloque: en orden, sin repetir, y nada si se acaban', () => {
  const { b } = nueva();
  assert.strictEqual(b.numeroTomar(C), null);
  assert.strictEqual(b.numerosAgregarBloque(C, { desde: 458, hasta: 460 }), 3);
  b.numerosAgregarBloque(C, { desde: 458, hasta: 460 }); // repetido: no duplica
  assert.deepStrictEqual([b.numeroTomar(C), b.numeroTomar(C), b.numeroTomar(C), b.numeroTomar(C)], ['V-000458', 'V-000459', 'V-000460', null]);
  assert.strictEqual(b.numeroTomar('otra'), null);
  assert.throws(() => b.numerosAgregarBloque(C, { desde: 10, hasta: 5 }));
  b.cerrar();
});

test('códigos: solo verifica los guardados, con bloqueo tras varios fallos', () => {
  let t = 0;
  const cifrador = { cifrar: (x) => Buffer.from(x).reverse(), descifrar: (x) => Buffer.from(x).reverse() };
  const { b } = nueva({ ahora: () => t, cifrador });
  assert.strictEqual(b.pinVerificar(C, '1234', null).sin_datos_locales, true);
  b.pinGuardar(C, { perfil_id: 'adm1', pin: '1234', nombre: 'Jack', principal: true });
  const ok = b.pinVerificar(C, '1234', null);
  assert.deepStrictEqual([ok.ok, ok.perfil_id, ok.nombre, ok.principal], [true, 'adm1', 'Jack', true]);
  assert.strictEqual(b.pinVerificar(C, '1234', 'otro').ok, false);
  assert.strictEqual(b.pinVerificar('otra', '1234', null).ok, false);
  // la huella no se guarda en claro
  const crudo = b.db.prepare('select datos from pines').get().datos;
  assert.ok(!Buffer.from(crudo).toString().includes('huella'));
  for (let i = 0; i < MAX_FALLOS_PIN - 2; i++) assert.strictEqual(b.pinVerificar(C, '0000', null).motivo, 'incorrecto');
  // el fallo anterior en "otro" ya contó: este ya bloquea
  const bloq = b.pinVerificar(C, '0000', null);
  assert.strictEqual(bloq.motivo, 'bloqueado');
  assert.strictEqual(b.pinVerificar(C, '1234', null).motivo, 'bloqueado');
  t += 5 * 60 * 1000 + 1;
  assert.strictEqual(b.pinVerificar(C, '1234', null).ok, true);
  b.cerrar();
});

test('respaldo diario: una copia por día y solo las últimas 7', () => {
  const { dir, b } = nueva();
  b.ventaGuardar(C, venta());
  const resp = path.join(dir, 'respaldos');
  for (let d = 1; d <= 9; d++) b.respaldar(resp, new Date(Date.UTC(2026, 9, d)));
  assert.strictEqual(b.respaldar(resp, new Date(Date.UTC(2026, 9, 9))).nuevo, false);
  const archivos = fs.readdirSync(resp).sort();
  assert.strictEqual(archivos.length, 7);
  assert.strictEqual(archivos[0], 'negocio360-local-2026-10-03.db');
  const copia = abrirBase(path.join(resp, archivos[6]));
  assert.strictEqual(copia.totalSinSubir(), 1);
  copia.cerrar();
  b.cerrar();
});
