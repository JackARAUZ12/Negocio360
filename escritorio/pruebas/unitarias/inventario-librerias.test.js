'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { clasificarUrl, urlsCargadas, inventario, verificarArchivosLocales } = require('../../herramientas/inventario-librerias');

test('clasifica las librerías conocidas con su versión fija', () => {
  assert.strictEqual(clasificarUrl('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2').lib.version, '2.117.2');
  assert.strictEqual(clasificarUrl('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js').tipo, 'libreria');
  assert.strictEqual(clasificarUrl('https://unpkg.com/lucide@latest/dist/umd/lucide.js').lib.nombre, 'lucide');
  assert.strictEqual(clasificarUrl('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5').lib.nombre, 'zxing-browser');
  assert.strictEqual(clasificarUrl('https://fonts.googleapis.com/css2?family=Inter').tipo, 'fuente');
  assert.strictEqual(clasificarUrl('https://wa.me/50581294177').tipo, 'enlace');
});

test('una versión distinta a la fijada NO se acepta en silencio', () => {
  assert.strictEqual(clasificarUrl('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js').tipo, 'sin_mapear');
  assert.strictEqual(clasificarUrl('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@3').tipo, 'sin_mapear');
  assert.strictEqual(clasificarUrl('https://evil.example.com/supabase-js@2').tipo, 'sin_mapear');
});

test('solo cuenta lo que la página carga (script src y link href)', () => {
  const html = '<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">' +
    '<a href="https://wa.me/1">wa</a><script>const u="https://x.com/a.js"</script>';
  assert.deepStrictEqual(urlsCargadas(html), ['https://unpkg.com/lucide@latest/dist/umd/lucide.js', 'https://fonts.googleapis.com/css2?family=X']);
});

test('todas las páginas reales del sistema quedan cubiertas', () => {
  const inv = inventario(path.join(__dirname, '..', '..', '..'));
  assert.ok(inv.htmls > 50);
  assert.deepStrictEqual(inv.sin_mapear, []);
  assert.ok(inv.librerias['supabase-js'].paginas.has('ventas.html'));
});

test('las copias locales existen con la versión exacta', () => {
  assert.deepStrictEqual(verificarArchivosLocales(path.join(__dirname, '..', '..')), []);
});
