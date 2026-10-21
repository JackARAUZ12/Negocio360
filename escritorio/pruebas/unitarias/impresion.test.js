'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearImpresion, MAX_BYTES } = require('../../src/main/impresion');

function preparar({ salida = 'NEGOCIO360_OK', fallo = null, plataforma = 'win32', impresoras = ['EPSON TM-U220 Receipt', 'Otra $(calc)'] } = {}) {
  const carpetaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-imp-'));
  const llamadas = [];
  const imp = crearImpresion({
    obtenerImpresoras: async () => impresoras.map((name) => ({ name })),
    ejecutar: async (cmd, args, opts) => {
      llamadas.push({ cmd, args, opts, existe: fs.existsSync(opts.env.N360_ARCHIVO), contenido: fs.readFileSync(opts.env.N360_ARCHIVO) });
      if (fallo) throw fallo;
      return { stdout: salida };
    },
    plataforma, carpetaTmp, rutaScript: 'C:/n360/imprimir-raw.ps1',
  });
  return { imp, llamadas, carpetaTmp };
}

test('imprime: manda los bytes exactos y borra el archivo temporal', async () => {
  const { imp, llamadas } = preparar();
  const bytes = new Uint8Array([0x1b, 0x40, 0x48, 0x6f, 0x6c, 0x61, 0x0a]);
  assert.deepStrictEqual(await imp.imprimir('EPSON TM-U220 Receipt', bytes), { ok: true });
  assert.strictEqual(llamadas.length, 1);
  assert.ok(llamadas[0].existe);
  assert.deepStrictEqual([...llamadas[0].contenido], [...bytes]);
  assert.ok(!fs.existsSync(llamadas[0].opts.env.N360_ARCHIVO), 'el archivo se borra');
});

test('el nombre de la impresora nunca va en los argumentos ni en el script', async () => {
  const { imp, llamadas } = preparar();
  await imp.imprimir('Otra $(calc)', new Uint8Array([1, 2, 3]));
  const c = llamadas[0];
  assert.strictEqual(c.cmd, 'powershell.exe');
  assert.ok(!c.args.join(' ').includes('calc'));
  assert.deepStrictEqual(c.args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:/n360/imprimir-raw.ps1']);
  assert.strictEqual(c.opts.env.N360_IMPRESORA, 'Otra $(calc)');
  assert.ok(c.opts.timeout > 0 && c.opts.windowsHide);
});

test('rechaza impresoras que no existen en Windows (sin ejecutar nada)', async () => {
  const { imp, llamadas } = preparar();
  const r = await imp.imprimir('"; Start-Process calc; "', new Uint8Array([1]));
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /ya no aparece/);
  assert.strictEqual(llamadas.length, 0);
});

test('valida los datos del ticket', async () => {
  const { imp, llamadas } = preparar();
  assert.strictEqual((await imp.imprimir('', new Uint8Array([1]))).ok, false);
  assert.strictEqual((await imp.imprimir(123, new Uint8Array([1]))).ok, false);
  assert.strictEqual((await imp.imprimir('EPSON TM-U220 Receipt', new Uint8Array([]))).ok, false);
  assert.strictEqual((await imp.imprimir('EPSON TM-U220 Receipt', 'texto')).ok, false);
  assert.strictEqual((await imp.imprimir('EPSON TM-U220 Receipt', [1, 300])).ok, false);
  assert.strictEqual((await imp.imprimir('EPSON TM-U220 Receipt', new Uint8Array(MAX_BYTES + 1))).ok, false);
  assert.strictEqual(llamadas.length, 0);
  assert.strictEqual((await imp.imprimir('EPSON TM-U220 Receipt', [27, 64])).ok, true);
});

test('fuera de Windows avisa claro', async () => {
  const { imp } = preparar({ plataforma: 'linux' });
  const r = await imp.imprimir('EPSON TM-U220 Receipt', new Uint8Array([1]));
  assert.deepStrictEqual(r, { ok: false, motivo: 'La impresión directa solo funciona en Windows.' });
});

test('errores de la impresora y de tiempo se traducen y el temporal se borra', async () => {
  let p = preparar({ salida: 'NEGOCIO360_ERROR:1801' });
  let r = await p.imp.imprimir('EPSON TM-U220 Receipt', new Uint8Array([1]));
  assert.match(r.motivo, /no encuentra esa impresora/);
  p = preparar({ salida: 'basura' });
  assert.match((await p.imp.imprimir('EPSON TM-U220 Receipt', new Uint8Array([1]))).motivo, /rechazó/);
  p = preparar({ fallo: Object.assign(new Error('t'), { killed: true }) });
  r = await p.imp.imprimir('EPSON TM-U220 Receipt', new Uint8Array([1]));
  assert.match(r.motivo, /tardó demasiado/);
  assert.ok(!fs.existsSync(p.llamadas[0].opts.env.N360_ARCHIVO));
});

test('dos tickets seguidos se imprimen en orden, uno a la vez', async () => {
  const orden = [];
  let activos = 0; let maxActivos = 0;
  const carpetaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-imp-'));
  const imp = crearImpresion({
    obtenerImpresoras: async () => [{ name: 'P' }],
    ejecutar: async (_c, _a, opts) => {
      activos++; maxActivos = Math.max(maxActivos, activos);
      const b = fs.readFileSync(opts.env.N360_ARCHIVO)[0];
      await new Promise((r) => setTimeout(r, b === 1 ? 30 : 1));
      orden.push(b); activos--;
      return { stdout: 'NEGOCIO360_OK' };
    },
    plataforma: 'win32', carpetaTmp, rutaScript: 'x.ps1',
  });
  await Promise.all([imp.imprimir('P', [1]), imp.imprimir('P', [2]), imp.imprimir('P', [3])]);
  assert.deepStrictEqual(orden, [1, 2, 3]);
  assert.strictEqual(maxActivos, 1);
});

test('lista de impresoras sin repetidos y con error controlado', async () => {
  const { imp } = preparar({ impresoras: ['A', 'A', 'B'] });
  assert.deepStrictEqual(await imp.listar(), { ok: true, impresoras: ['A', 'B'] });
  const mala = crearImpresion({ obtenerImpresoras: async () => { throw new Error('x'); }, ejecutar: null, carpetaTmp: os.tmpdir(), rutaScript: '' });
  assert.strictEqual((await mala.listar()).ok, false);
});
