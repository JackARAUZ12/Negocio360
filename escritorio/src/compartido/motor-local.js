// Motor de consultas local: responde a las consultas de la librería de
// Supabase (from('tabla').select().eq()…) usando la copia del catálogo que
// está en el equipo, con la MISMA forma de respuesta ({data, error, count}).
// Lo usan las páginas cuando no hay internet y mientras se "graba" una venta.
// Las escrituras se aplican en memoria para que las lecturas siguientes las
// vean (como haría la base real).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.N360MotorLocal = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPERACIONES = new Set(['insert', 'upsert', 'update', 'delete']);
  const copia = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const FECHA = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
  const NUM = /^-?\d+(\.\d+)?$/;

  function comparar(a, b) {
    if (a == null || b == null) return a == null && b == null ? 0 : (a == null ? -1 : 1);
    if (typeof a === 'number' || typeof b === 'number' || (NUM.test(String(a)) && NUM.test(String(b)))) {
      const x = Number(a); const y = Number(b);
      if (!Number.isNaN(x) && !Number.isNaN(y)) return x < y ? -1 : x > y ? 1 : 0;
    }
    if (typeof a === 'string' && typeof b === 'string' && FECHA.test(a) && FECHA.test(b)) {
      const norm = (s) => (s.length === 10 ? s + 'T00:00:00Z' : (/(Z|[+-]\d{2}(:?\d{2})?)$/.test(s) ? s : s + 'Z')).replace(' ', 'T');
      const x = Date.parse(norm(a)); const y = Date.parse(norm(b));
      if (!Number.isNaN(x) && !Number.isNaN(y)) return x < y ? -1 : x > y ? 1 : 0;
    }
    const x = String(a); const y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const igual = (a, b) => {
    if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
    return comparar(a, b) === 0;
  };
  function patron(p, sinMayusculas) {
    const re = '^' + String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.') + '$';
    return new RegExp(re, sinMayusculas ? 'is' : 's');
  }
  function valorDe(fila, col) {
    if (fila == null) return undefined;
    if (col in fila) return fila[col];
    const m = String(col).match(/^(\w+)->>?(\w+)$/); // columna json: datos->>campo
    if (m && fila[m[1]] && typeof fila[m[1]] === 'object') return fila[m[1]][m[2]];
    return undefined;
  }
  function listaPostgrest(v) {
    if (Array.isArray(v)) return v;
    return String(v).replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
  }

  function cumple(fila, op, col, val) {
    if (String(col).includes('.')) return true; // filtro sobre tabla relacionada: no se aplica localmente
    const v = valorDe(fila, col);
    switch (op) {
      case 'eq': return val === null ? v == null : igual(v, val);
      case 'neq': return val === null ? v != null : !igual(v, val);
      case 'gt': return v != null && comparar(v, val) > 0;
      case 'gte': return v != null && comparar(v, val) >= 0;
      case 'lt': return v != null && comparar(v, val) < 0;
      case 'lte': return v != null && comparar(v, val) <= 0;
      case 'like': return v != null && patron(val, false).test(String(v));
      case 'ilike': return v != null && patron(val, true).test(String(v));
      case 'is': return val === null || val === 'null' ? v == null : String(v) === String(val);
      case 'in': return listaPostgrest(val).some((x) => igual(v, x));
      case 'cs': case 'contains': {
        if (Array.isArray(v)) return listaPostgrest(Array.isArray(val) ? val : String(val).replace(/^\{|\}$/g, '')).every((x) => v.some((y) => igual(y, x)));
        if (v && typeof v === 'object' && val && typeof val === 'object') return Object.keys(val).every((k) => igual(v[k], val[k]));
        return false;
      }
      case 'fts': case 'plfts': case 'phfts': case 'wfts': return true;
      default: return true;
    }
  }

  // "a.eq.1,b.ilike.*x*,and(c.gt.2,d.is.null)" -> función
  function separarNivel(texto) {
    const partes = []; let prof = 0; let actual = ''; let comillas = false;
    for (const ch of texto) {
      if (ch === '"') comillas = !comillas;
      if (!comillas && ch === '(') prof++;
      if (!comillas && ch === ')') prof--;
      if (!comillas && ch === ',' && prof === 0) { partes.push(actual); actual = ''; continue; }
      actual += ch;
    }
    if (actual) partes.push(actual);
    return partes.map((p) => p.trim()).filter(Boolean);
  }
  function condicionDeTexto(c) {
    const grupo = c.match(/^(not\.)?(and|or)\((.*)\)$/s);
    if (grupo) {
      const subs = separarNivel(grupo[3]).map(condicionDeTexto);
      const f = grupo[2] === 'and' ? (fila) => subs.every((s) => s(fila)) : (fila) => subs.some((s) => s(fila));
      return grupo[1] ? (fila) => !f(fila) : f;
    }
    const i = c.indexOf('.');
    const col = c.slice(0, i);
    let resto = c.slice(i + 1);
    let negar = false;
    if (resto.startsWith('not.')) { negar = true; resto = resto.slice(4); }
    const j = resto.indexOf('.');
    const op = resto.slice(0, j);
    let val = resto.slice(j + 1);
    if (val === 'null') val = null;
    else if (val === 'true' || val === 'false') val = val === 'true';
    const f = (fila) => cumple(fila, op, col, val);
    return negar ? (fila) => !f(fila) : f;
  }

  // ---- select con relaciones: "*, productos(stock_actual), promocion_productos(producto_id)"
  function analizarSelect(texto) {
    const rel = [];
    for (const parte of separarNivel(String(texto || '*').replace(/\s+/g, ' '))) {
      const m = parte.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\s*\((.*)\)$/s);
      if (m) rel.push({ alias: m[1] || m[2], tabla: m[2], interna: m[3] === 'inner', cols: m[4] });
    }
    return rel;
  }
  const singulares = (t) => [...new Set([t.replace(/es$/, ''), t.replace(/s$/, ''), t])];

  function crearMotor(tablasIniciales, { nuevoId, ahora } = {}) {
    const tablas = {};
    for (const [t, filas] of Object.entries(tablasIniciales || {})) tablas[t] = copia(filas || []);
    const generarId = nuevoId || (() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(16).slice(2)));
    const reloj = ahora || (() => new Date().toISOString());

    function incrustar(tabla, filas, relaciones) {
      if (!relaciones.length) return filas;
      return filas.map((f) => {
        const fila = Object.assign({}, f);
        for (const r of relaciones) {
          const destino = tablas[r.tabla] || [];
          let valor = null; let resuelto = false;
          for (const s of singulares(r.tabla)) {
            const fk = `${s}_id`;
            if (fk in fila) {
              const hallado = destino.find((x) => x.id != null && String(x.id) === String(fila[fk]));
              valor = hallado ? incrustar(r.tabla, [hallado], analizarSelect(r.cols))[0] : null;
              resuelto = true; break;
            }
          }
          if (!resuelto) {
            const fks = singulares(tabla).map((s) => `${s}_id`);
            const fk = fks.find((k) => destino.some((x) => k in x)) || fks[0];
            valor = incrustar(r.tabla, destino.filter((x) => fila.id != null && String(x[fk]) === String(fila.id)), analizarSelect(r.cols));
          }
          fila[r.alias] = copia(valor);
        }
        return fila;
      }).filter((fila) => relaciones.every((r) => !r.interna || (Array.isArray(fila[r.alias]) ? fila[r.alias].length : fila[r.alias])));
    }

    // pasos: [[metodo, args], ...] tal como los encadenó la página.
    function ejecutar(tabla, pasos) {
      const q = { op: 'select', filtros: [], orden: [], limite: null, desde: null, hasta: null, unica: null, cols: '*', cuenta: false, cabeza: false, devolver: false, valores: null, opciones: {}, lanzar: false };
      for (const [m, a] of pasos) {
        const args = a || [];
        if (OPERACIONES.has(m)) { q.op = m; q.valores = args[0]; q.opciones = args[1] || {}; continue; }
        switch (m) {
          case 'select':
            if (q.op === 'select') { q.cols = args[0] || '*'; if (args[1] && args[1].count) { q.cuenta = true; q.cabeza = !!args[1].head; } } else { q.devolver = true; q.cols = args[0] || '*'; }
            break;
          case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': case 'like': case 'ilike': case 'is': case 'in': case 'contains':
            q.filtros.push((f) => cumple(f, m, args[0], args[1])); break;
          case 'match': for (const [c, v] of Object.entries(args[0] || {})) q.filtros.push((f) => cumple(f, 'eq', c, v)); break;
          case 'not': q.filtros.push((f) => !cumple(f, args[1], args[0], args[2])); break;
          case 'filter': q.filtros.push((f) => cumple(f, String(args[1]).replace(/^not\./, ''), args[0], args[2]) !== String(args[1]).startsWith('not.')); break;
          case 'or': if (!(args[1] && (args[1].foreignTable || args[1].referencedTable))) { const c = condicionDeTexto(`or(${args[0]})`); q.filtros.push(c); } break;
          case 'order': if (!(args[1] && (args[1].foreignTable || args[1].referencedTable))) q.orden.push({ col: args[0], asc: !(args[1] && args[1].ascending === false), nulosPrimero: args[1] && args[1].nullsFirst }); break;
          case 'limit': if (!(args[1] && (args[1].foreignTable || args[1].referencedTable))) q.limite = Number(args[0]); break;
          case 'range': q.desde = Number(args[0]); q.hasta = Number(args[1]); break;
          case 'single': q.unica = 'single'; break;
          case 'maybeSingle': q.unica = 'maybe'; break;
          case 'throwOnError': q.lanzar = true; break;
          default: break; // abortSignal, returns, csv, textSearch…
        }
      }
      const r = resolver(tabla, q);
      if (q.lanzar && r.error) throw Object.assign(new Error(r.error.message), r.error);
      return r;
    }

    function resolver(tabla, q) {
      const ok = (data, extra) => Object.assign({ data, error: null, count: null, status: 200, statusText: 'OK' }, extra || {});
      const falla = (message, code) => ({ data: null, error: { message, code: code || 'N360_LOCAL', details: null, hint: null }, count: null, status: 400, statusText: 'Bad Request' });
      const filasTabla = tablas[tabla] || (tablas[tabla] = []);
      const filtrar = () => filasTabla.filter((f) => q.filtros.every((c) => c(f)));
      let afectadas = [];

      if (q.op === 'insert' || q.op === 'upsert') {
        const lista = Array.isArray(q.valores) ? q.valores : [q.valores];
        for (const v of lista) {
          const conflicto = q.op === 'upsert' ? String(q.opciones.onConflict || 'id').split(',').map((s) => s.trim()) : null;
          const existente = conflicto && filasTabla.find((f) => conflicto.every((c) => v[c] != null && igual(f[c], v[c])));
          if (existente) {
            if (!q.opciones.ignoreDuplicates) Object.assign(existente, copia(v));
            afectadas.push(existente);
          } else {
            const fila = Object.assign({ id: generarId(), created_at: reloj() }, copia(v));
            filasTabla.push(fila);
            afectadas.push(fila);
          }
        }
      } else if (q.op === 'update') {
        afectadas = filtrar();
        for (const f of afectadas) Object.assign(f, copia(q.valores));
      } else if (q.op === 'delete') {
        afectadas = filtrar();
        tablas[tabla] = filasTabla.filter((f) => !afectadas.includes(f));
      }
      if (q.op !== 'select') {
        if (!q.devolver) return ok(null, { status: q.op === 'insert' ? 201 : 204 });
        let data = incrustar(tabla, copia(afectadas), analizarSelect(q.cols));
        if (q.unica) {
          if (data.length !== 1 && (q.unica === 'single' || data.length > 1)) return falla('Se esperaba una sola fila', 'PGRST116');
          return ok(data[0] || null);
        }
        return ok(data);
      }

      let filas = incrustar(tabla, filtrar(), analizarSelect(q.cols));
      if (q.orden.length) {
        filas.sort((a, b) => {
          for (const o of q.orden) {
            const x = valorDe(a, o.col); const y = valorDe(b, o.col);
            if (x == null || y == null) {
              if (x == null && y == null) continue;
              const nulos = o.nulosPrimero == null ? !o.asc : o.nulosPrimero; // como Postgres: nulos al final en ascendente
              return (x == null ? -1 : 1) * (nulos ? 1 : -1);
            }
            const c = comparar(x, y);
            if (c) return o.asc ? c : -c;
          }
          return 0;
        });
      }
      const total = filas.length;
      if (q.desde != null) filas = filas.slice(q.desde, q.hasta + 1);
      if (q.limite != null && !Number.isNaN(q.limite)) filas = filas.slice(0, q.limite);
      if (q.cabeza) return ok(null, { count: total });
      if (q.unica) {
        if (filas.length > 1 || (q.unica === 'single' && !filas.length)) return falla(filas.length ? 'Se esperaba una sola fila' : 'No se encontró la fila', 'PGRST116');
        return ok(copia(filas[0] || null), { count: q.cuenta ? total : null });
      }
      return ok(copia(filas), { count: q.cuenta ? total : null });
    }

    return {
      ejecutar,
      tiene: (t) => Object.prototype.hasOwnProperty.call(tablas, t),
      filas: (t) => tablas[t] || [],
      buscar: (t, id) => (tablas[t] || []).find((f) => String(f.id) === String(id)) || null,
      reemplazar(t, filas) { tablas[t] = copia(filas || []); },
    };
  }

  return { crearMotor, comparar, condicionDeTexto, analizarSelect };
});
