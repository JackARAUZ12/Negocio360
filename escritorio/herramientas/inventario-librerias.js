#!/usr/bin/env node
// Inventario de librerías externas que cargan las páginas del sistema web.
// Revisa cada <script src> y <link href> de los .html de la raíz del
// repositorio y los clasifica según herramientas/librerias.json:
//   - libreria: tiene copia local con versión fija (se empaqueta)
//   - fuente:   Google Fonts
//   - enlace:   enlace que el usuario abre (no se carga en la página)
//   - sin_mapear: URL externa desconocida -> ERROR (hay que agregarla)
// Uso: node herramientas/inventario-librerias.js [carpeta-web]
'use strict';
const fs = require('fs');
const path = require('path');

const MANIFIESTO = require('./librerias.json');

function clasificarUrl(url, manifiesto = MANIFIESTO) {
  for (const lib of manifiesto.librerias) {
    if (new RegExp(lib.patron).test(url)) return { tipo: 'libreria', lib };
  }
  if (new RegExp(manifiesto.fuentes.patron).test(url)) return { tipo: 'fuente' };
  if (manifiesto.enlaces_externos.patrones.some((p) => new RegExp(p).test(url))) return { tipo: 'enlace' };
  return { tipo: 'sin_mapear' };
}

// Solo lo que la página CARGA: <script src="..."> y <link ... href="...">.
function urlsCargadas(html) {
  const urls = [];
  const reScript = /<script\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  const reLink = /<link\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = reScript.exec(html))) urls.push(m[1]);
  while ((m = reLink.exec(html))) urls.push(m[1]);
  return urls;
}

function inventario(carpetaWeb) {
  const resultado = { librerias: {}, fuentes: 0, enlaces: 0, sin_mapear: [] };
  const htmls = fs.readdirSync(carpetaWeb).filter((f) => f.endsWith('.html')).sort();
  for (const archivo of htmls) {
    const html = fs.readFileSync(path.join(carpetaWeb, archivo), 'utf8');
    for (const url of urlsCargadas(html)) {
      const c = clasificarUrl(url);
      if (c.tipo === 'libreria') {
        const r = (resultado.librerias[c.lib.nombre] ||= { version: c.lib.version, paginas: new Set() });
        r.paginas.add(archivo);
      } else if (c.tipo === 'fuente') resultado.fuentes++;
      else if (c.tipo === 'enlace') resultado.enlaces++;
      else resultado.sin_mapear.push({ archivo, url });
    }
  }
  return { htmls: htmls.length, ...resultado };
}

function verificarArchivosLocales(raizEscritorio, manifiesto = MANIFIESTO) {
  const faltan = [];
  for (const lib of manifiesto.librerias) {
    const ruta = path.join(raizEscritorio, 'node_modules', lib.archivo);
    if (!fs.existsSync(ruta)) { faltan.push(`${lib.nombre}: ${lib.archivo}`); continue; }
    const pkg = path.join(raizEscritorio, 'node_modules', lib.archivo.startsWith('@') ? lib.archivo.split('/').slice(0, 2).join('/') : lib.archivo.split('/')[0], 'package.json');
    const v = JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
    if (v !== lib.version) faltan.push(`${lib.nombre}: instalada ${v}, se esperaba ${lib.version}`);
  }
  return faltan;
}

module.exports = { clasificarUrl, urlsCargadas, inventario, verificarArchivosLocales };

if (require.main === module) {
  const raizEscritorio = path.join(__dirname, '..');
  const carpetaWeb = process.argv[2] || path.join(raizEscritorio, '..');
  const inv = inventario(carpetaWeb);
  console.log(`Páginas revisadas: ${inv.htmls}`);
  for (const [nombre, r] of Object.entries(inv.librerias)) {
    console.log(`  ${nombre}@${r.version}: ${r.paginas.size} página(s)`);
  }
  console.log(`  Fuentes de Google: ${inv.fuentes} referencias; enlaces externos: ${inv.enlaces}`);
  const faltan = verificarArchivosLocales(raizEscritorio);
  let error = false;
  if (inv.sin_mapear.length) {
    error = true;
    console.error('URL externas SIN copia local (agregarlas a librerias.json):');
    for (const s of inv.sin_mapear) console.error(`  ${s.archivo}: ${s.url}`);
  }
  if (faltan.length) {
    error = true;
    console.error('Copias locales que faltan o con otra versión (correr npm install):');
    for (const f of faltan) console.error('  ' + f);
  }
  if (!error) console.log('OK: todas las librerías tienen copia local con versión fija.');
  process.exit(error ? 1 : 0);
}
