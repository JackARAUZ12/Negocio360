'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reescribirHtml, aplicarParches, familiasDeGoogleFonts, empaquetar } = require('../../herramientas/empaquetar-web');
const { iniciarActualizador } = require('../../src/main/actualizador');
const { EventEmitter } = require('events');

test('reescribe librerías y fuentes del sistema; deja las demás fuentes', () => {
  const html = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>`;
  const r = reescribirHtml(html);
  assert.ok(r.html.includes('src="vendor/supabase.js"'));
  assert.ok(r.html.includes('src="vendor/lucide.js"'));
  assert.ok(r.html.includes('href="vendor/fuentes/fuentes.css"'));
  assert.ok(!r.html.includes('preconnect'));
  const otra = reescribirHtml('<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400&display=swap" rel="stylesheet">');
  assert.ok(otra.html.includes('family=Caveat'));
  assert.ok(otra.html.includes('preconnect'));
  assert.deepStrictEqual(reescribirHtml('<script src="https://evil.com/x.js"></script>').sinMapear, ['https://evil.com/x.js']);
  assert.deepStrictEqual(familiasDeGoogleFonts('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300&amp;family=Inter'), ['Plus Jakarta Sans', 'Inter']);
});

test('un parche cuyo texto original cambió hace FALLAR el empaquetado', () => {
  const p = [{ archivo: 'x.html', motivo: 'm', buscar: 'AAA', reemplazo: 'BBB', veces: 1 }];
  assert.strictEqual(aplicarParches('x.html', 'hola AAA', p).texto, 'hola BBB');
  assert.throws(() => aplicarParches('x.html', 'hola', p), /se esperaba 1/);
  assert.throws(() => aplicarParches('x.html', 'AAA AAA', p), /hay 2/);
});

test('empaquetado real: no queda ningún script de internet y los originales no cambian', () => {
  const origen = path.join(__dirname, '..', '..', '..');
  const antes = fs.readFileSync(path.join(origen, 'ventas.html'));
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'n360-web-'));
  const inf = empaquetar(origen, destino);
  assert.ok(inf.paginas > 100);
  assert.deepStrictEqual(fs.readFileSync(path.join(origen, 'ventas.html')), antes);
  for (const f of fs.readdirSync(destino).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(destino, f), 'utf8');
    assert.ok(!/<script\b[^>]*?\ssrc\s*=\s*["']https?:/i.test(html), f);
  }
  assert.ok(fs.existsSync(path.join(destino, 'vendor/supabase.js')));
  assert.ok(!fs.existsSync(path.join(destino, 'Negocio360-Setup.exe')));
  assert.match(fs.readFileSync(path.join(destino, 'login.html'), 'utf8'), /https:\/\/negocio360oficial\.com'\) \+ '\/reset-password\.html'/);
  const css = fs.readFileSync(path.join(destino, 'vendor/fuentes/fuentes.css'), 'utf8');
  for (const m of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(destino, 'vendor/fuentes/files', m[1])), m[1]);
  fs.rmSync(destino, { recursive: true, force: true });
});

test('actualizador: apagado fuera del instalador; no instala con ventas pendientes', () => {
  assert.strictEqual(iniciarActualizador({ autoUpdater: {}, empaquetado: false }).activo, false);
  const au = Object.assign(new EventEmitter(), { checkForUpdates: async () => {}, instalado: 0, quitAndInstall() { this.instalado++; } });
  let pendientes = 2;
  const a = iniciarActualizador({ autoUpdater: au, empaquetado: true, puedeInstalar: () => pendientes === 0, registro: { warn() {} } });
  assert.strictEqual(au.autoInstallOnAppQuit, false);
  assert.strictEqual(a.alSalir(), false); // nada descargado
  au.emit('update-downloaded', { version: '2.0.1' });
  assert.strictEqual(a.alSalir(), false);
  assert.strictEqual(au.instalado, 0);
  pendientes = 0;
  assert.strictEqual(a.alSalir(), true);
  assert.strictEqual(au.instalado, 1);
});

test('enlaces para compartir apuntan al sitio; las comparaciones de seguridad no cambian', () => {
  const { enlacesCompartibles } = require('../../herramientas/empaquetar-web');
  const src = 'const a = `${location.origin}/x?c=1`; const b = `${ window.location.origin }/y`; if (ev.origin !== location.origin) {} postMessage(1, location.origin);';
  const r = enlacesCompartibles(src);
  assert.strictEqual(r.n, 2);
  assert.ok(r.texto.includes('if (ev.origin !== location.origin)'));
  assert.ok(r.texto.includes('postMessage(1, location.origin)'));
  const location = { protocol: 'app:', origin: 'app://negocio360' };
  const a = new Function('location', 'ev', 'postMessage', r.texto + '; return [a, b];')(location, { origin: 'x' }, () => {});
  assert.deepStrictEqual(a, ['https://negocio360oficial.com/x?c=1', 'https://negocio360oficial.com/y']);
  const enWeb = new Function('location', 'ev', 'postMessage', r.texto + '; return a;')({ protocol: 'https:', origin: 'https://negocio360oficial.com' }, { origin: 'x' }, () => {});
  assert.strictEqual(enWeb, 'https://negocio360oficial.com/x?c=1');
});
