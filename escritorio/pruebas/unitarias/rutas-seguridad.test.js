'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolverArchivo } = require('../../src/main/rutas');
const seg = require('../../src/main/seguridad');

const RAIZ = path.resolve('/tmp/web');

test('resuelve páginas dentro de la carpeta empaquetada', () => {
  assert.strictEqual(resolverArchivo(RAIZ, 'app://negocio360/ventas.html').ruta, path.join(RAIZ, 'ventas.html'));
  assert.strictEqual(resolverArchivo(RAIZ, 'app://negocio360/').ruta, path.join(RAIZ, 'login.html'));
  assert.strictEqual(resolverArchivo(RAIZ, 'app://negocio360/vendor/fuentes/fuentes.css?x=1#y').ruta, path.join(RAIZ, 'vendor/fuentes/fuentes.css'));
  assert.strictEqual(resolverArchivo(RAIZ, 'app://negocio360/mi%20archivo.html').ruta, path.join(RAIZ, 'mi archivo.html'));
});

test('nunca sale de la carpeta de páginas', () => {
  for (const u of ['app://negocio360/../../etc/passwd', 'app://negocio360/%2e%2e/%2e%2e/etc/passwd', 'app://negocio360/..%2f..%2fsecreto']) {
    const r = resolverArchivo(RAIZ, u);
    assert.ok(r.error || r.ruta.startsWith(RAIZ + path.sep), u);
  }
  assert.strictEqual(resolverArchivo(RAIZ, 'app://negocio360/a%00.html').error, 400);
  assert.strictEqual(resolverArchivo(RAIZ, 'app://negocio360/..%5c..%5cwin.ini').error, 400);
  assert.strictEqual(resolverArchivo(RAIZ, 'app://otro/ventas.html').error, 403);
  assert.strictEqual(resolverArchivo(RAIZ, 'file:///etc/passwd').error, 403);
  assert.strictEqual(resolverArchivo(RAIZ, 'app://negocio360/%E0%A4%A').error, 400);
});

test('ventanas nuevas: internas, tickets, externas y bloqueadas', () => {
  assert.strictEqual(seg.decidirVentanaNueva('about:blank'), 'ventana-auxiliar');
  assert.strictEqual(seg.decidirVentanaNueva(''), 'ventana-auxiliar');
  assert.strictEqual(seg.decidirVentanaNueva('app://negocio360/reportes.html'), 'ventana-sistema');
  assert.strictEqual(seg.decidirVentanaNueva('blob:app://negocio360/1234-abcd'), 'ventana-auxiliar');
  assert.strictEqual(seg.decidirVentanaNueva('https://wa.me/505'), 'navegador');
  assert.strictEqual(seg.decidirVentanaNueva('blob:https://malo.com/1'), 'bloquear');
  assert.strictEqual(seg.decidirVentanaNueva('file:///C:/Windows/system32/calc.exe'), 'bloquear');
  assert.strictEqual(seg.decidirVentanaNueva('javascript:alert(1)'), 'bloquear');
  assert.strictEqual(seg.decidirVentanaNueva('data:text/html,hola'), 'bloquear');
});

test('navegación: solo dentro del programa; lo externo va al navegador', () => {
  assert.strictEqual(seg.decidirNavegacion('app://negocio360/dashboard.html'), 'permitir');
  assert.strictEqual(seg.decidirNavegacion('https://negocio360oficial.com/'), 'navegador');
  assert.strictEqual(seg.decidirNavegacion('file:///etc/passwd'), 'bloquear');
  assert.strictEqual(seg.decidirNavegacion('ms-settings:'), 'bloquear');
});

test('permisos y remitentes', () => {
  assert.ok(seg.permisoPermitido('media', 'app://negocio360/productos.html'));
  assert.ok(!seg.permisoPermitido('media', 'https://malo.com'));
  assert.ok(!seg.permisoPermitido('geolocation', 'app://negocio360/'));
  assert.ok(seg.remitenteValido({ senderFrame: { url: 'app://negocio360/ventas.html' } }));
  assert.ok(!seg.remitenteValido({ senderFrame: { url: 'about:blank' } }));
  assert.ok(!seg.remitenteValido({ senderFrame: null }));
  assert.ok(!seg.remitenteValido({}));
});
