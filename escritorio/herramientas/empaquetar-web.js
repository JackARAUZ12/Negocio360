#!/usr/bin/env node
// Empaqueta las páginas del sistema web dentro del programa de escritorio.
//
// Copia las páginas de la raíz del repositorio (html/js/css/imágenes/plantillas)
// a build/web/ y, SOLO en la copia:
//   1. cambia cada librería de internet (CDN) por su copia local con versión
//      fija (herramientas/librerias.json) -> las pantallas abren sin internet;
//   2. cambia las fuentes de Google del sistema por copias locales;
//   3. aplica unos pocos ajustes puntuales y listados (PARCHES) que solo
//      hacen falta dentro del programa. Si el texto original de un parche ya
//      no existe, el empaquetado FALLA (nunca se aplica a ciegas).
// Los archivos originales del repositorio no se tocan.
//
// Uso: node herramientas/empaquetar-web.js [origen] [destino]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const MANIFIESTO = require('./librerias.json');
const { clasificarUrl, urlsCargadas } = require('./inventario-librerias');

const RAIZ_ESCRITORIO = path.join(__dirname, '..');
const EXTENSIONES = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.xlsx', '.wav']);
const EXCLUIR = new Set(['Negocio360-Setup.exe', 'app-debug.apk', 'CNAME', 'README.md', 'deployment-test.txt']);
const SUBCONJUNTOS_FUENTE = ['latin', 'latin-ext'];
const FUENTE_CSS = 'vendor/fuentes/fuentes.css';

// Ajustes puntuales. `veces`: cuántas veces debe aparecer el texto original.
const PARCHES = [
  {
    archivo: 'login.html',
    motivo: 'El enlace de "olvidé mi contraseña" llega por correo: debe apuntar al sitio web, no al programa (app://).',
    buscar: "redirectTo: window.location.origin + '/reset-password.html'",
    reemplazo: "redirectTo: (/^https?:$/.test(window.location.protocol) ? window.location.origin : 'https://negocio360oficial.com') + '/reset-password.html'",
    veces: 1,
  },
];

// Enlaces que se comparten (catálogos, invitaciones): dentro del programa la
// dirección es app://negocio360, que no sirve fuera de él. Solo se cambian
// los que están dentro de un texto (`${location.origin}`); las comparaciones
// de seguridad (ev.origin !== location.origin) no se tocan.
const ORIGEN_WEB_EXPR = "(/^https?:$/.test(location.protocol) ? location.origin : 'https://negocio360oficial.com')";
function enlacesCompartibles(texto) {
  let n = 0;
  const salida = texto.replace(/\$\{\s*(?:window\.)?location\.origin\s*\}/g, () => { n++; return '${' + ORIGEN_WEB_EXPR + '}'; });
  return { texto: salida, n };
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function familiasDeGoogleFonts(url) {
  try {
    const u = new URL(url.replace(/&amp;/g, '&'));
    if (u.hostname !== 'fonts.googleapis.com') return null;
    return u.searchParams.getAll('family').map((f) => f.split(':')[0].replace(/\+/g, ' '));
  } catch (_) { return null; }
}

// Reescribe un HTML. Devuelve { html, cambios, sinMapear }.
function reescribirHtml(html, manifiesto = MANIFIESTO) {
  const empaquetadas = new Set(manifiesto.fuentes.empaquetadas.map((f) => f.familia));
  const cambios = [];
  const sinMapear = [];
  // Librerías: <script src="https://..."> y <link href="https://...">
  html = html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)\s*=\s*["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi, (todo, ini, url, fin) => {
    const c = clasificarUrl(url, manifiesto);
    if (c.tipo === 'libreria') { cambios.push(`${c.lib.nombre}@${c.lib.version}`); return ini + c.lib.destino + fin; }
    if (c.tipo === 'fuente') {
      const fam = familiasDeGoogleFonts(url);
      if (fam && fam.length && fam.every((f) => empaquetadas.has(f))) { cambios.push('fuentes-locales'); return ini + FUENTE_CSS + fin; }
      return todo; // otras fuentes (plantillas de catálogo): quedan en línea, opcionales
    }
    if (c.tipo === 'sin_mapear' && /^<script/i.test(todo)) sinMapear.push(url);
    return todo;
  });
  // preconnect a Google Fonts: sin uso si las fuentes son locales; se quita solo si ya no queda ninguna fuente en línea
  if (!/fonts\.googleapis\.com\/css/.test(html)) {
    html = html.replace(/<link\b[^>]*rel=["']preconnect["'][^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/gi, () => { cambios.push('preconnect-quitado'); return ''; });
  }
  return { html, cambios, sinMapear };
}

function aplicarParches(nombre, texto, parches = PARCHES) {
  const aplicados = [];
  for (const p of parches.filter((x) => x.archivo === nombre)) {
    const n = texto.split(p.buscar).length - 1;
    if (n !== p.veces) throw new Error(`Parche de ${nombre}: se esperaba ${p.veces} coincidencia(s) y hay ${n}. Revisar el parche (${p.motivo}).`);
    texto = texto.split(p.buscar).join(p.reemplazo);
    aplicados.push(p.motivo);
  }
  return { texto, aplicados };
}

// CSS de las fuentes locales: solo woff2 y solo latin/latin-ext.
function construirFuentes(destino, manifiesto = MANIFIESTO) {
  const carpeta = path.join(destino, 'vendor', 'fuentes');
  fs.mkdirSync(path.join(carpeta, 'files'), { recursive: true });
  let css = '/* Fuentes locales de Negocio360 Escritorio (generado por empaquetar-web.js) */\n';
  for (const f of manifiesto.fuentes.empaquetadas) {
    const base = path.join(RAIZ_ESCRITORIO, 'node_modules', f.paquete);
    const version = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')).version;
    if (version !== f.version) throw new Error(`${f.paquete}: instalada ${version}, se esperaba ${f.version}`);
    for (const peso of f.pesos) {
      const original = fs.readFileSync(path.join(base, `${peso}.css`), 'utf8');
      for (const bloque of original.match(/\/\*[^*]*\*\/\s*@font-face\s*{[^}]*}/g) || []) {
        const nombreBloque = (bloque.match(/\/\*\s*([a-z0-9-]+)\s*\*\//) || [])[1] || '';
        const sub = (nombreBloque.match(/-(latin-ext|latin)-\d+-normal$/) || [])[1];
        if (!SUBCONJUNTOS_FUENTE.includes(sub)) continue;
        const woff2 = (bloque.match(/url\(\.\/files\/([^)]+\.woff2)\)/) || [])[1];
        if (!woff2) continue;
        fs.copyFileSync(path.join(base, 'files', woff2), path.join(carpeta, 'files', woff2));
        css += bloque.replace(/src:[^;]+;/, `src: url(./files/${woff2}) format('woff2');`) + '\n';
      }
    }
  }
  fs.writeFileSync(path.join(carpeta, 'fuentes.css'), css);
}

function versionGit(origen) {
  try { return execFileSync('git', ['-C', origen, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { return null; }
}

function empaquetar(origen, destino) {
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true });
  const archivos = fs.readdirSync(origen, { withFileTypes: true })
    .filter((d) => d.isFile() && !EXCLUIR.has(d.name) && EXTENSIONES.has(path.extname(d.name).toLowerCase()))
    .map((d) => d.name).sort();
  const informe = { origen_git: versionGit(origen), generado: new Date().toISOString(), paginas: 0, librerias: {}, parches: [], enlaces_compartibles: {}, sin_mapear: [], archivos: {} };
  const parchesPendientes = new Set(PARCHES.map((p) => p.archivo));
  for (const nombre of archivos) {
    let contenido = fs.readFileSync(path.join(origen, nombre));
    if (nombre.endsWith('.html')) {
      informe.paginas++;
      const r = reescribirHtml(contenido.toString('utf8'));
      r.cambios.forEach((c) => { informe.librerias[c] = (informe.librerias[c] || 0) + 1; });
      r.sinMapear.forEach((u) => informe.sin_mapear.push({ archivo: nombre, url: u }));
      const p = aplicarParches(nombre, r.html);
      p.aplicados.forEach((m) => informe.parches.push({ archivo: nombre, motivo: m }));
      parchesPendientes.delete(nombre);
      const e = enlacesCompartibles(p.texto);
      if (e.n) informe.enlaces_compartibles[nombre] = e.n;
      contenido = Buffer.from(e.texto, 'utf8');
    } else if (nombre.endsWith('.js') || nombre.endsWith('.css')) {
      const p = aplicarParches(nombre, contenido.toString('utf8'));
      p.aplicados.forEach((m) => informe.parches.push({ archivo: nombre, motivo: m }));
      parchesPendientes.delete(nombre);
      const e = enlacesCompartibles(p.texto);
      if (e.n) informe.enlaces_compartibles[nombre] = e.n;
      if (p.aplicados.length || e.n) contenido = Buffer.from(e.texto, 'utf8');
    }
    fs.writeFileSync(path.join(destino, nombre), contenido);
    informe.archivos[nombre] = sha256(contenido);
  }
  if (parchesPendientes.size) throw new Error('Parches para archivos que no existen: ' + [...parchesPendientes].join(', '));
  if (informe.sin_mapear.length) throw new Error('Librerías sin copia local: ' + JSON.stringify(informe.sin_mapear));
  // Librerías con versión fija
  for (const lib of MANIFIESTO.librerias) {
    const desde = path.join(RAIZ_ESCRITORIO, 'node_modules', lib.archivo);
    const hacia = path.join(destino, lib.destino);
    fs.mkdirSync(path.dirname(hacia), { recursive: true });
    fs.copyFileSync(desde, hacia);
    informe.archivos[lib.destino] = sha256(fs.readFileSync(hacia));
  }
  // Imágenes que usa leaflet.css (marcadores)
  const imgLeaflet = path.join(RAIZ_ESCRITORIO, 'node_modules', 'leaflet', 'dist', 'images');
  if (fs.existsSync(imgLeaflet)) fs.cpSync(imgLeaflet, path.join(destino, 'vendor', 'leaflet', 'images'), { recursive: true });
  construirFuentes(destino);
  // Comprobación final: ninguna página debe cargar scripts de internet
  for (const nombre of archivos.filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(destino, nombre), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*?\ssrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
    if (scripts.length) throw new Error(`${nombre} todavía carga scripts de internet: ${scripts.join(', ')}`);
  }
  fs.writeFileSync(path.join(destino, 'empaquetado.json'), JSON.stringify(informe, null, 2));
  return informe;
}

module.exports = { reescribirHtml, aplicarParches, familiasDeGoogleFonts, enlacesCompartibles, empaquetar, PARCHES };

if (require.main === module) {
  const origen = path.resolve(process.argv[2] || path.join(RAIZ_ESCRITORIO, '..'));
  const destino = path.resolve(process.argv[3] || path.join(RAIZ_ESCRITORIO, 'build', 'web'));
  const inf = empaquetar(origen, destino);
  console.log(`Empaquetadas ${inf.paginas} páginas y ${Object.keys(inf.archivos).length} archivos en ${destino}`);
  console.log('Reemplazos:', inf.librerias);
  console.log('Parches:', inf.parches.map((p) => `${p.archivo}: ${p.motivo}`));
  console.log('Enlaces para compartir ajustados:', Object.values(inf.enlaces_compartibles).reduce((a, b) => a + b, 0), 'en', Object.keys(inf.enlaces_compartibles).length, 'archivos');
}
