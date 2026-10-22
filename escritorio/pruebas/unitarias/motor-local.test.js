'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { crearMotor, condicionDeTexto } = require('../../src/compartido/motor-local');

// Mismo encadenado que la librería de Supabase: q('t').select().eq()…
function cliente(motor) {
  return (tabla) => {
    const pasos = [];
    const b = new Proxy({}, {
      get(_, k) {
        if (k === 'then') return (ok, mal) => Promise.resolve().then(() => motor.ejecutar(tabla, pasos)).then(ok, mal);
        return (...a) => { pasos.push([k, a]); return b; };
      },
    });
    return b;
  };
}

const datos = () => ({
  productos: [
    { id: 'p1', nombre: 'Martillo', precio: 150, stock_actual: 10, activo: true, auth_user_id: 'u', created_at: '2026-10-01T10:00:00+00:00' },
    { id: 'p2', nombre: 'Clavos 1"', precio: '2.50', stock_actual: 0, activo: true, auth_user_id: 'u', created_at: '2026-10-02T10:00:00+00:00' },
    { id: 'p3', nombre: 'Taladro', precio: 2500, stock_actual: 3, activo: false, auth_user_id: 'u', created_at: null },
  ],
  combo_items: [{ id: 'ci1', combo_id: 'c1', producto_id: 'p1', cantidad: 2 }],
  promociones: [{ id: 'pr1', nombre: '3x2' }],
  promocion_productos: [{ id: 'pp1', promocion_id: 'pr1', producto_id: 'p2' }, { id: 'pp2', promocion_id: 'otra', producto_id: 'p1' }],
  ventas: [
    { id: 'v1', fecha: '2026-10-21T00:00:00+00:00', total: 100, estado: 'completada', created_at: '2026-10-21T06:00:00Z' },
    { id: 'v2', fecha: '2026-10-21T22:15:00.123+00:00', total: 50, estado: 'anulada', created_at: '2026-10-21T22:15:00Z' },
    { id: 'v3', fecha: '2026-10-20T23:59:59+00:00', total: 70, estado: 'completada', created_at: '2026-10-21T05:59:59Z' },
  ],
});

test('filtros, orden, límites y una sola fila', async () => {
  const q = cliente(crearMotor(datos()));
  assert.deepStrictEqual((await q('productos').select('*').eq('activo', true).order('nombre')).data.map((p) => p.id), ['p2', 'p1']);
  assert.deepStrictEqual((await q('productos').select('id').gt('stock_actual', 0).order('precio', { ascending: false })).data.map((p) => p.id), ['p3', 'p1']);
  assert.deepStrictEqual((await q('productos').select('id').in('id', ['p1', 'p3']).limit(1)).data.map((p) => p.id), ['p1']);
  assert.deepStrictEqual((await q('productos').select('id').ilike('nombre', '%CLAVO%')).data.map((p) => p.id), ['p2']);
  assert.strictEqual((await q('productos').select('id').eq('precio', 2.5).single()).data.id, 'p2');
  const nada = await q('productos').select('id').eq('id', 'zz').single();
  assert.strictEqual(nada.error.code, 'PGRST116');
  assert.strictEqual((await q('productos').select('id').eq('id', 'zz').maybeSingle()).data, null);
  const c = await q('productos').select('*', { count: 'exact', head: true }).eq('activo', true);
  assert.deepStrictEqual([c.data, c.count], [null, 2]);
  assert.deepStrictEqual((await q('productos').select('id').order('created_at', { ascending: false })).data.map((p) => p.id), ['p3', 'p2', 'p1']);
  assert.deepStrictEqual((await q('productos').select('id').range(1, 2).order('id')).data.map((p) => p.id), ['p2', 'p3']);
  assert.deepStrictEqual((await q('productos').select('id').is('created_at', null)).data.map((p) => p.id), ['p3']);
  assert.deepStrictEqual((await q('noexiste').select('*')).data, []);
});

test('fechas: hoy hasta antes de mañana, como hace ventas.js', async () => {
  const q = cliente(crearMotor(datos()));
  const r = await q('ventas').select('*').gte('fecha', '2026-10-21').lt('fecha', '2026-10-22').neq('estado', 'anulada');
  assert.deepStrictEqual(r.data.map((v) => v.id), ['v1']);
  assert.deepStrictEqual((await q('ventas').select('id').lte('fecha', '2026-10-21T00:00:00.000Z')).data.map((v) => v.id), ['v1', 'v3']);
});

test('or y not al estilo de PostgREST', async () => {
  const q = cliente(crearMotor(datos()));
  assert.deepStrictEqual((await q('productos').select('id').or('nombre.ilike.*taladro*,precio.lt.10')).data.map((p) => p.id), ['p2', 'p3']);
  assert.deepStrictEqual((await q('productos').select('id').or('and(activo.eq.true,stock_actual.gt.5),id.eq.p3')).data.map((p) => p.id), ['p1', 'p3']);
  assert.deepStrictEqual((await q('productos').select('id').not('created_at', 'is', null)).data.map((p) => p.id), ['p1', 'p2']);
  assert.ok(condicionDeTexto('id.in.(p1,p2)')({ id: 'p2' }));
});

test('relaciones: productos(...) en combo_items y promocion_productos(...) en promociones', async () => {
  const q = cliente(crearMotor(datos()));
  const ci = await q('combo_items').select('combo_id, cantidad, productos(stock_actual, costo)').in('combo_id', ['c1']);
  assert.strictEqual(ci.data[0].productos.stock_actual, 10);
  const pr = await q('promociones').select('*, promocion_productos(producto_id)');
  assert.deepStrictEqual(pr.data[0].promocion_productos.map((x) => x.producto_id), ['p2']);
});

test('escrituras en memoria: lo insertado y actualizado se ve después', async () => {
  let n = 0;
  const m = crearMotor(datos(), { nuevoId: () => `nuevo-${++n}`, ahora: () => '2026-10-22T12:00:00Z' });
  const q = cliente(m);
  const ins = await q('ventas').insert({ total: 30, estado: 'completada', fecha: '2026-10-21' }).select('id').single();
  assert.strictEqual(ins.data.id, 'nuevo-1');
  assert.strictEqual((await q('venta_detalles').insert([{ venta_id: 'nuevo-1' }, { venta_id: 'nuevo-1' }])).data, null);
  assert.strictEqual(m.filas('venta_detalles').length, 2);
  await q('productos').update({ stock_actual: 8 }).eq('id', 'p1');
  assert.strictEqual(m.buscar('productos', 'p1').stock_actual, 8);
  const ultimo = await q('ventas').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
  assert.strictEqual(ultimo.data.id, 'nuevo-1');
  await q('productos').upsert({ id: 'p1', precio: 155 });
  assert.deepStrictEqual([m.buscar('productos', 'p1').precio, m.filas('productos').length], [155, 3]);
  await q('productos').delete().eq('id', 'p3');
  assert.strictEqual(m.filas('productos').length, 2);
  // lo devuelto es una copia: cambiarlo no altera la memoria
  const r = await q('productos').select('*').eq('id', 'p1').single();
  r.data.stock_actual = 999;
  assert.strictEqual(m.buscar('productos', 'p1').stock_actual, 8);
});

test('throwOnError lanza en vez de devolver el error', async () => {
  const q = cliente(crearMotor(datos()));
  await assert.rejects(async () => q('productos').select('*').eq('id', 'zz').single().throwOnError());
});
