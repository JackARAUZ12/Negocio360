// Base de datos local del equipo (SQLite integrado en Electron, node:sqlite).
// Guarda, separado por cuenta:
//   - copia del catálogo (productos, clientes, métodos de pago…) para vender sin internet;
//   - la "bandeja de salida": cada venta hecha en el equipo, completa, en UNA
//     transacción, antes de imprimir el ticket; queda ahí hasta que el servidor
//     confirma que la recibió;
//   - los números de venta apartados por bloques;
//   - respuestas guardadas de funciones del servidor (lista de perfiles);
//   - códigos de administrador ya verificados en línea (solo su huella cifrada).
// Modo WAL + synchronous=FULL: si se va la luz, lo confirmado no se pierde.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ESQUEMA = `
create table if not exists meta (clave text primary key, valor text);
create table if not exists filas (
  cuenta text not null, tabla text not null, id text not null, datos text not null,
  local_uuid text, primary key (cuenta, tabla, id));
create index if not exists filas_local on filas (cuenta, local_uuid);
create table if not exists tablas (
  cuenta text not null, tabla text not null, actualizado integer not null, filas integer not null,
  primary key (cuenta, tabla));
create table if not exists rpc_cache (
  cuenta text not null, clave text not null, datos text, actualizado integer not null,
  primary key (cuenta, clave));
create table if not exists ventas_pendientes (
  uuid text primary key, cuenta text not null, estado text not null,
  creada integer not null, numero text, total real, resumen text, payload text not null,
  filas_locales text not null default '[]', deltas text not null default '[]',
  intentos integer not null default 0, proximo_intento integer not null default 0,
  resultado text, error text, subida integer, anulada integer);
create index if not exists ventas_pendientes_estado on ventas_pendientes (cuenta, estado, creada);
create table if not exists numeros (
  cuenta text not null, numero integer not null, prefijo text not null, digitos integer not null,
  estado text not null, usado integer, primary key (cuenta, numero));
create table if not exists pines (
  cuenta text not null, perfil_id text not null, datos blob not null, actualizado integer not null,
  primary key (cuenta, perfil_id));
create table if not exists pin_intentos (
  cuenta text not null primary key, fallos integer not null, bloqueado_hasta integer not null);
`;

// Estados de una venta en la bandeja
const ESTADOS = ['pendiente', 'enviando', 'subida', 'error', 'anulada'];
const ACTIVAS = "('pendiente','enviando','error')"; // aún no están en el servidor
const PBKDF2_ITER = 210000;
const MAX_FALLOS_PIN = 5;
const BLOQUEO_PIN_MS = 5 * 60 * 1000;
const RESPALDOS_A_GUARDAR = 7;

const idDeFila = (f, i) => String(f && (f.id ?? f.auth_user_id ?? f.clave) != null ? (f.id ?? f.auth_user_id ?? f.clave) : `#${i}`);
const json = (x) => JSON.stringify(x === undefined ? null : x);
const leer = (t, def) => { try { return t == null ? def : JSON.parse(t); } catch (_) { return def; } };

// cifrador: { cifrar(Buffer)->Buffer, descifrar(Buffer)->Buffer } (safeStorage de Electron).
function abrirBase(ruta, { cifrador = null, ahora = () => Date.now() } = {}) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on; pragma busy_timeout = 3000;');
  db.exec(ESQUEMA);
  // Al arrancar: lo que quedó "enviando" (corte a mitad de subida) vuelve a la fila;
  // la subida es idempotente, si ya había llegado el servidor no la duplica.
  db.prepare("update ventas_pendientes set estado = 'pendiente' where estado = 'enviando'").run();

  function transaccion(fn) {
    db.exec('begin immediate');
    try { const r = fn(); db.exec('commit'); return r; } catch (e) { try { db.exec('rollback'); } catch (_) { /* nada */ } throw e; }
  }

  // ---------- meta ----------
  function metaLeer(clave, def = null) {
    const r = db.prepare('select valor from meta where clave = ?').get(clave);
    return r ? leer(r.valor, def) : def;
  }
  function metaGuardar(clave, valor) {
    db.prepare('insert into meta (clave, valor) values (?, ?) on conflict (clave) do update set valor = excluded.valor').run(clave, json(valor));
  }
  function dispositivoUid() {
    let uid = metaLeer('dispositivo_uid');
    if (!uid) { uid = crypto.randomUUID(); metaGuardar('dispositivo_uid', uid); }
    return uid;
  }

  // ---------- catálogo ----------
  // Reemplaza la copia de una tabla con lo que mandó el servidor y vuelve a
  // aplicar encima lo de las ventas que aún no subieron (filas nuevas y restas
  // de stock), así la copia local nunca "devuelve" stock ya vendido.
  function catalogoReemplazar(cuenta, tabla, filasServidor) {
    if (!Array.isArray(filasServidor)) throw new Error('filas inválidas');
    return transaccion(() => {
      db.prepare('delete from filas where cuenta = ? and tabla = ?').run(cuenta, tabla);
      const ins = db.prepare('insert or replace into filas (cuenta, tabla, id, datos, local_uuid) values (?, ?, ?, ?, null)');
      filasServidor.forEach((f, i) => ins.run(cuenta, tabla, idDeFila(f, i), json(f)));
      for (const v of db.prepare(`select uuid, filas_locales, deltas from ventas_pendientes where cuenta = ? and estado in ${ACTIVAS} order by creada`).all(cuenta)) {
        for (const fl of leer(v.filas_locales, [])) if (fl.tabla === tabla) ins.run(cuenta, tabla, idDeFila(fl.fila, 0), json(fl.fila));
        db.prepare('update filas set local_uuid = ? where cuenta = ? and tabla = ? and id in (select value from json_each(?))')
          .run(v.uuid, cuenta, tabla, json(leer(v.filas_locales, []).filter((x) => x.tabla === tabla).map((x) => idDeFila(x.fila, 0))));
        aplicarDeltas(cuenta, leer(v.deltas, []).filter((d) => d.tabla === tabla), 1);
      }
      db.prepare('insert into tablas (cuenta, tabla, actualizado, filas) values (?, ?, ?, ?) on conflict (cuenta, tabla) do update set actualizado = excluded.actualizado, filas = excluded.filas')
        .run(cuenta, tabla, ahora(), filasServidor.length);
      return { tabla, filas: filasServidor.length };
    });
  }

  function aplicarDeltas(cuenta, deltas, signo) {
    const sel = db.prepare('select datos from filas where cuenta = ? and tabla = ? and id = ?');
    const upd = db.prepare('update filas set datos = ? where cuenta = ? and tabla = ? and id = ?');
    for (const d of deltas || []) {
      const r = sel.get(cuenta, d.tabla, String(d.id));
      if (!r) continue;
      const fila = leer(r.datos, {});
      const actual = Number(fila[d.campo]);
      if (!Number.isFinite(actual) || !Number.isFinite(Number(d.delta))) continue;
      fila[d.campo] = Math.round((actual + signo * Number(d.delta)) * 1e6) / 1e6;
      upd.run(json(fila), cuenta, d.tabla, String(d.id));
    }
  }

  function catalogoLeer(cuenta, tablasPedidas) {
    const salida = {};
    const sel = db.prepare('select datos from filas where cuenta = ? and tabla = ?');
    for (const t of tablasPedidas) salida[t] = sel.all(cuenta, t).map((r) => leer(r.datos, null)).filter(Boolean);
    return salida;
  }

  function catalogoInfo(cuenta) {
    return db.prepare('select tabla, actualizado, filas from tablas where cuenta = ? order by tabla').all(cuenta);
  }

  // ---------- respuestas guardadas de funciones ----------
  function rpcGuardar(cuenta, clave, datos) {
    db.prepare('insert into rpc_cache (cuenta, clave, datos, actualizado) values (?, ?, ?, ?) on conflict (cuenta, clave) do update set datos = excluded.datos, actualizado = excluded.actualizado')
      .run(cuenta, clave, json(datos), ahora());
  }
  function rpcLeer(cuenta, clave) {
    const r = db.prepare('select datos, actualizado from rpc_cache where cuenta = ? and clave = ?').get(cuenta, clave);
    return r ? { datos: leer(r.datos, null), actualizado: r.actualizado } : null;
  }

  // ---------- números de venta ----------
  function numerosAgregarBloque(cuenta, { desde, hasta, prefijo = 'V-', digitos = 6 }) {
    desde = Number(desde); hasta = Number(hasta);
    if (!Number.isInteger(desde) || !Number.isInteger(hasta) || hasta < desde || hasta - desde > 1000) throw new Error('bloque inválido');
    return transaccion(() => {
      const ins = db.prepare("insert or ignore into numeros (cuenta, numero, prefijo, digitos, estado) values (?, ?, ?, ?, 'libre')");
      for (let n = desde; n <= hasta; n++) ins.run(cuenta, n, String(prefijo), Number(digitos));
      return numerosLibres(cuenta);
    });
  }
  function numerosLibres(cuenta) {
    return db.prepare("select count(*) as n from numeros where cuenta = ? and estado = 'libre'").get(cuenta).n;
  }
  // Entrega el siguiente número libre (queda usado aunque la venta no se
  // cierre: igual que la web, que también salta números de ventas abandonadas).
  function numeroTomar(cuenta) {
    return transaccion(() => {
      const r = db.prepare("select numero, prefijo, digitos from numeros where cuenta = ? and estado = 'libre' order by numero limit 1").get(cuenta);
      if (!r) return null;
      db.prepare("update numeros set estado = 'usado', usado = ? where cuenta = ? and numero = ?").run(ahora(), cuenta, r.numero);
      return r.prefijo + String(r.numero).padStart(r.digitos, '0');
    });
  }

  // ---------- bandeja de salida ----------
  // venta: { uuid, payload, numero, total, resumen, filasLocales:[{tabla,fila}], deltas:[{tabla,id,campo,delta}] }
  function ventaGuardar(cuenta, v) {
    if (!v || !/^[0-9a-f-]{36}$/i.test(String(v.uuid || ''))) throw new Error('uuid inválido');
    if (!v.payload || typeof v.payload !== 'object') throw new Error('venta sin datos');
    return transaccion(() => {
      const ya = db.prepare('select cuenta, payload from ventas_pendientes where uuid = ?').get(v.uuid);
      if (ya) {
        if (ya.cuenta !== cuenta || ya.payload !== json(v.payload)) throw new Error('uuid repetido con otro contenido');
        return { guardada: true, repetida: true };
      }
      db.prepare(`insert into ventas_pendientes (uuid, cuenta, estado, creada, numero, total, resumen, payload, filas_locales, deltas)
                  values (?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?)`)
        .run(v.uuid, cuenta, ahora(), v.numero || null, Number(v.total) || 0, json(v.resumen || {}), json(v.payload),
          json(v.filasLocales || []), json(v.deltas || []));
      const ins = db.prepare('insert or replace into filas (cuenta, tabla, id, datos, local_uuid) values (?, ?, ?, ?, ?)');
      for (const fl of v.filasLocales || []) ins.run(cuenta, fl.tabla, idDeFila(fl.fila, 0), json(fl.fila), v.uuid);
      aplicarDeltas(cuenta, v.deltas, 1);
      return { guardada: true, repetida: false };
    });
  }

  const fila = (r) => r && ({
    uuid: r.uuid, cuenta: r.cuenta, estado: r.estado, creada: r.creada, numero: r.numero, total: r.total,
    resumen: leer(r.resumen, {}), intentos: r.intentos, proximo_intento: r.proximo_intento,
    resultado: leer(r.resultado, null), error: r.error, subida: r.subida, anulada: r.anulada,
  });

  function ventasListar(cuenta, { estados = null, limite = 500 } = {}) {
    const est = (estados || ESTADOS).filter((e) => ESTADOS.includes(e));
    const marcas = est.map(() => '?').join(',');
    return db.prepare(`select * from ventas_pendientes where cuenta = ? and estado in (${marcas}) order by creada desc limit ?`)
      .all(cuenta, ...est, Math.min(Number(limite) || 500, 5000)).map(fila);
  }
  function ventaPayload(uuid) {
    const r = db.prepare('select payload from ventas_pendientes where uuid = ?').get(uuid);
    return r ? leer(r.payload, null) : null;
  }
  function siguienteParaSubir(cuenta, momento = ahora()) {
    return fila(db.prepare("select * from ventas_pendientes where cuenta = ? and estado = 'pendiente' and proximo_intento <= ? order by creada limit 1").get(cuenta, momento));
  }
  function contar(cuenta) {
    const r = {};
    for (const x of db.prepare('select estado, count(*) as n from ventas_pendientes where cuenta = ? group by estado').all(cuenta)) r[x.estado] = x.n;
    return { pendientes: (r.pendiente || 0) + (r.enviando || 0), errores: r.error || 0, subidas: r.subida || 0, anuladas: r.anulada || 0 };
  }
  // Ventas aún no subidas de TODAS las cuentas del equipo (para no instalar
  // una actualización ni dejar cerrar caja con algo pendiente).
  function totalSinSubir() {
    return db.prepare(`select count(*) as n from ventas_pendientes where estado in ${ACTIVAS}`).get().n;
  }
  function marcarEnviando(uuid) {
    db.prepare("update ventas_pendientes set estado = 'enviando', intentos = intentos + 1 where uuid = ? and estado = 'pendiente'").run(uuid);
  }
  function marcarSubida(uuid, resultado) {
    return transaccion(() => {
      db.prepare("update ventas_pendientes set estado = 'subida', subida = ?, resultado = ?, error = null where uuid = ?").run(ahora(), json(resultado), uuid);
      // Las filas locales quedan hasta que llegue la copia del servidor, pero ya no se re-aplican.
      return true;
    });
  }
  function marcarReintento(uuid, error, esperaMs) {
    db.prepare("update ventas_pendientes set estado = 'pendiente', error = ?, proximo_intento = ? where uuid = ?").run(String(error || '').slice(0, 500), ahora() + esperaMs, uuid);
  }
  function marcarError(uuid, error) {
    db.prepare("update ventas_pendientes set estado = 'error', error = ? where uuid = ?").run(String(error || '').slice(0, 500), uuid);
  }
  // Volver a intentar una venta con error (desde la pantalla Sincronización).
  function reintentar(cuenta, uuid) {
    return db.prepare("update ventas_pendientes set estado = 'pendiente', proximo_intento = 0 where uuid = ? and cuenta = ? and estado in ('error','pendiente')").run(uuid, cuenta).changes > 0;
  }
  function despertarTodas(cuenta) {
    db.prepare("update ventas_pendientes set proximo_intento = 0 where cuenta = ? and estado = 'pendiente'").run(cuenta);
  }
  // Anular: SOLO ventas que aún no llegaron al servidor. Se devuelve el stock
  // a la copia local y se quitan sus filas locales.
  function ventaAnular(cuenta, uuid) {
    return transaccion(() => {
      const r = db.prepare('select estado, deltas from ventas_pendientes where uuid = ? and cuenta = ?').get(uuid, cuenta);
      if (!r) return { ok: false, motivo: 'No se encontró la venta.' };
      if (!['pendiente', 'error'].includes(r.estado)) {
        return { ok: false, motivo: r.estado === 'subida' ? 'Esta venta ya está en el servidor: anúlala desde Ventas, con internet.' : 'La venta se está subiendo en este momento. Intenta en unos segundos.' };
      }
      db.prepare("update ventas_pendientes set estado = 'anulada', anulada = ? where uuid = ?").run(ahora(), uuid);
      aplicarDeltas(cuenta, leer(r.deltas, []), -1);
      db.prepare('delete from filas where cuenta = ? and local_uuid = ?').run(cuenta, uuid);
      return { ok: true };
    });
  }
  function exportar(cuenta) {
    return db.prepare(`select * from ventas_pendientes where cuenta = ? and estado in ${ACTIVAS} order by creada`).all(cuenta)
      .map((r) => ({ ...fila(r), payload: leer(r.payload, null) }));
  }

  // ---------- códigos de administrador ----------
  function sellar(obj) {
    const b = Buffer.from(json(obj), 'utf8');
    return cifrador ? Buffer.concat([Buffer.from('C1'), cifrador.cifrar(b)]) : Buffer.concat([Buffer.from('P1'), b]);
  }
  function abrirSello(buf) {
    const b = Buffer.from(buf);
    const tipo = b.subarray(0, 2).toString();
    if (tipo === 'C1') { if (!cifrador) return null; return leer(cifrador.descifrar(b.subarray(2)).toString('utf8'), null); }
    if (tipo === 'P1') return leer(b.subarray(2).toString('utf8'), null);
    return null;
  }
  function huellaPin(pin, sal) { return crypto.pbkdf2Sync(String(pin), sal, PBKDF2_ITER, 32, 'sha256'); }

  // Solo después de que el servidor aceptó el código (en línea).
  function pinGuardar(cuenta, { perfil_id, pin, nombre = null, principal = false }) {
    if (!perfil_id || !pin) return false;
    const sal = crypto.randomBytes(16);
    const datos = sellar({ sal: sal.toString('base64'), huella: huellaPin(pin, sal).toString('base64'), nombre, principal: !!principal });
    db.prepare('insert into pines (cuenta, perfil_id, datos, actualizado) values (?, ?, ?, ?) on conflict (cuenta, perfil_id) do update set datos = excluded.datos, actualizado = excluded.actualizado')
      .run(cuenta, String(perfil_id), datos, ahora());
    return true;
  }
  // Misma forma de respuesta que admin_verificar_codigo del servidor.
  function pinVerificar(cuenta, pin, perfilId) {
    const t = ahora();
    const intento = db.prepare('select fallos, bloqueado_hasta from pin_intentos where cuenta = ?').get(cuenta) || { fallos: 0, bloqueado_hasta: 0 };
    if (intento.bloqueado_hasta > t) return { ok: false, motivo: 'bloqueado', bloqueado_seg: Math.ceil((intento.bloqueado_hasta - t) / 1000) };
    const filasPin = perfilId
      ? db.prepare('select perfil_id, datos from pines where cuenta = ? and perfil_id = ?').all(cuenta, String(perfilId))
      : db.prepare('select perfil_id, datos from pines where cuenta = ?').all(cuenta);
    for (const r of filasPin) {
      const d = abrirSello(r.datos);
      if (!d) continue;
      const esperado = Buffer.from(d.huella, 'base64');
      const dado = huellaPin(pin, Buffer.from(d.sal, 'base64'));
      if (esperado.length === dado.length && crypto.timingSafeEqual(esperado, dado)) {
        db.prepare('delete from pin_intentos where cuenta = ?').run(cuenta);
        return { ok: true, perfil_id: r.perfil_id, nombre: d.nombre, principal: !!d.principal, sin_conexion: true };
      }
    }
    const fallos = intento.fallos + 1;
    const bloqueo = fallos >= MAX_FALLOS_PIN ? t + BLOQUEO_PIN_MS : 0;
    db.prepare('insert into pin_intentos (cuenta, fallos, bloqueado_hasta) values (?, ?, ?) on conflict (cuenta) do update set fallos = excluded.fallos, bloqueado_hasta = excluded.bloqueado_hasta')
      .run(cuenta, bloqueo ? 0 : fallos, bloqueo);
    if (bloqueo) return { ok: false, motivo: 'bloqueado', bloqueado_seg: BLOQUEO_PIN_MS / 1000 };
    if (!filasPin.length) return { ok: false, motivo: 'incorrecto', restantes: MAX_FALLOS_PIN - fallos, sin_datos_locales: true };
    return { ok: false, motivo: 'incorrecto', restantes: MAX_FALLOS_PIN - fallos };
  }

  // ---------- respaldo diario ----------
  function respaldar(carpeta, fecha = new Date(ahora())) {
    fs.mkdirSync(carpeta, { recursive: true });
    const dia = fecha.toISOString().slice(0, 10);
    const destino = path.join(carpeta, `negocio360-local-${dia}.db`);
    if (fs.existsSync(destino)) return { ruta: destino, nuevo: false };
    db.prepare('vacuum into ?').run(destino);
    const viejos = fs.readdirSync(carpeta).filter((n) => /^negocio360-local-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort().reverse().slice(RESPALDOS_A_GUARDAR);
    for (const n of viejos) fs.rmSync(path.join(carpeta, n), { force: true });
    return { ruta: destino, nuevo: true };
  }

  return {
    db, transaccion, cerrar: () => db.close(),
    metaLeer, metaGuardar, dispositivoUid,
    catalogoReemplazar, catalogoLeer, catalogoInfo,
    rpcGuardar, rpcLeer,
    numerosAgregarBloque, numerosLibres, numeroTomar,
    ventaGuardar, ventasListar, ventaPayload, siguienteParaSubir, contar, totalSinSubir,
    marcarEnviando, marcarSubida, marcarReintento, marcarError, reintentar, despertarTodas, ventaAnular, exportar,
    pinGuardar, pinVerificar,
    respaldar,
  };
}

module.exports = { abrirBase, ESTADOS, MAX_FALLOS_PIN, BLOQUEO_PIN_MS };
