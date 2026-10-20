/* =====================================================
   CONTABILIDAD DEL GRUPO — "un solo libro en la central"
   ------------------------------------------------------------
   Las bodegas y sucursales son cuentas aparte, pero NINGUNA lleva
   contabilidad propia. La central lleva el libro de todo su grupo:
   el mismo motor de siempre procesa primero a la central (igual que
   antes) y después a cada bodega/sucursal, y escribe esos asientos en
   los libros de la central, marcados con el nombre del lugar.

   Este archivo solo LEE. Trae los documentos de los miembros por medio
   de la función segura de la base de datos contabilidad_filas_miembro,
   que solo responde a la central de ese grupo.

   - N360ContaGrupo.miembros(cliente)  -> [{sucursal_id, nombre, tipo, auth_user_id}]
     (vacío si la cuenta no es central de un grupo: todo sigue igual)
   - N360ContaGrupo.lector(cliente, uid) -> objeto que se usa igual que
     cliente.from(tabla).select().eq()...range(), pero lee al miembro.
   ===================================================== */
(function () {
  'use strict';

  // ¿Parece fecha/fecha-hora? Para comparar '2026-10-14' con '2026-10-14T13:00:00+00:00'
  // correctamente (como texto, la 'T' y el espacio darían resultados falsos).
  var RE_FECHA = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;
  function valorComparable(v) {
    if (typeof v === 'string' && RE_FECHA.test(v)) {
      var s = v.length === 10 ? v + 'T00:00:00' : v.replace(' ', 'T');
      var t = Date.parse(s);
      if (!isNaN(t)) return t;
    }
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
    return v;
  }
  function cmp(a, b) {
    var x = valorComparable(a), y = valorComparable(b);
    if (x === y) return 0;
    if (x === null || x === undefined) return -1;
    if (y === null || y === undefined) return 1;
    return x < y ? -1 : 1;
  }

  function Consulta(cache, cliente, uid, tabla) {
    this._cache = cache; this._cliente = cliente; this._uid = uid; this._tabla = tabla;
    this._f = []; this._orden = []; this._desde = null; this._hasta = null; this._lim = null; this._modo = 'lista';
  }
  Consulta.prototype.select = function () { return this; };
  // Valor de una columna; entiende también un campo dentro de un JSON ('data->>descuento'),
  // igual que la base de datos (como texto).
  function val(r, c) {
    var i = String(c).indexOf('->>');
    if (i < 0) return r[c];
    var o = r[c.slice(0, i)], k = c.slice(i + 3);
    if (o == null || typeof o !== 'object' || o[k] == null) return null;
    return typeof o[k] === 'object' ? JSON.stringify(o[k]) : String(o[k]);
  }
  Consulta.prototype.eq = function (c, v) { this._f.push(function (r) { return val(r, c) === v || (val(r, c) != null && v != null && String(val(r, c)) === String(v)); }); return this; };
  Consulta.prototype.neq = function (c, v) { this._f.push(function (r) { return !(val(r, c) === v || (val(r, c) != null && v != null && String(val(r, c)) === String(v))); }); return this; };
  Consulta.prototype.gt = function (c, v) { this._f.push(function (r) { return val(r, c) != null && cmp(val(r, c), v) > 0; }); return this; };
  Consulta.prototype.gte = function (c, v) { this._f.push(function (r) { return val(r, c) != null && cmp(val(r, c), v) >= 0; }); return this; };
  Consulta.prototype.lt = function (c, v) { this._f.push(function (r) { return val(r, c) != null && cmp(val(r, c), v) < 0; }); return this; };
  Consulta.prototype.lte = function (c, v) { this._f.push(function (r) { return val(r, c) != null && cmp(val(r, c), v) <= 0; }); return this; };
  Consulta.prototype.in = function (c, arr) { var s = (arr || []).map(String); this._f.push(function (r) { return val(r, c) != null && s.indexOf(String(val(r, c))) >= 0; }); return this; };
  Consulta.prototype.is = function (c, v) { this._f.push(function (r) { return v === null ? val(r, c) == null : val(r, c) === v; }); return this; };
  Consulta.prototype.not = function (c, op, v) {
    if (op === 'is' && v === null) this._f.push(function (r) { return val(r, c) != null; });
    else if (op === 'eq') this._f.push(function (r) { return String(val(r, c)) !== String(v); });
    else throw new Error('Contabilidad del grupo: filtro no soportado not(' + op + ')');
    return this;
  };
  Consulta.prototype.order = function (c, o) { this._orden.push({ c: c, asc: !(o && o.ascending === false) }); return this; };
  Consulta.prototype.range = function (a, b) { this._desde = a; this._hasta = b; return this; };
  Consulta.prototype.limit = function (n) { this._lim = n; return this; };
  Consulta.prototype.single = function () { this._modo = 'single'; return this; };
  Consulta.prototype.maybeSingle = function () { this._modo = 'maybe'; return this; };
  // Escribir a través del lector nunca está permitido.
  ['insert', 'update', 'upsert', 'delete'].forEach(function (m) {
    Consulta.prototype[m] = function () { throw new Error('Contabilidad del grupo: el lector de bodegas/sucursales es solo de lectura'); };
  });

  Consulta.prototype._traer = function () {
    var k = this._tabla, self = this;
    if (!this._cache[k]) {
      this._cache[k] = this._cliente.rpc('contabilidad_filas_miembro', { p_miembro: this._uid, p_tabla: k })
        .then(function (res) { if (res.error) throw res.error; return res.data || []; });
    }
    return this._cache[k];
  };
  Consulta.prototype.then = function (ok, mal) {
    var self = this;
    return this._traer().then(function (filas) {
      var r = filas.filter(function (f) { return self._f.every(function (fn) { return fn(f); }); });
      if (self._orden.length) {
        r = r.slice().sort(function (a, b) {
          for (var i = 0; i < self._orden.length; i++) {
            var o = self._orden[i], d = cmp(a[o.c], b[o.c]);
            if (d) return o.asc ? d : -d;
          }
          return 0;
        });
      }
      if (self._desde !== null) r = r.slice(self._desde, self._hasta + 1);
      if (self._lim !== null) r = r.slice(0, self._lim);
      if (self._modo === 'single') return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'Se esperaba una sola fila' } };
      if (self._modo === 'maybe') return { data: r[0] || null, error: null };
      return { data: r, error: null, count: r.length };
    }).then(ok, mal);
  };

  function lector(cliente, uid) {
    var cache = {};
    return { from: function (tabla) { return new Consulta(cache, cliente, uid, tabla); } };
  }

  async function miembros(cliente) {
    try {
      var res = await cliente.rpc('contabilidad_miembros_grupo');
      if (res.error) { console.warn('contabilidad_miembros_grupo:', res.error); return []; }
      return (res.data || []).filter(function (m) { return m && m.auth_user_id; });
    } catch (e) { console.warn('contabilidad_miembros_grupo:', e); return []; }
  }

  // Valor de la mercadería (existencias × costo) de cada lugar del grupo.
  async function inventarioPorLugar(cliente, uidCentral, nombreCentral) {
    var lugares = [{ nombre: nombreCentral || 'Central', tipo: 'central', uid: uidCentral, lector: cliente }];
    (await miembros(cliente)).forEach(function (m) { lugares.push({ nombre: m.nombre, tipo: m.tipo, uid: m.auth_user_id, lector: lector(cliente, m.auth_user_id) }); });
    var out = [];
    for (var i = 0; i < lugares.length; i++) {
      var L = lugares[i], prods = [];
      for (var desde = 0; ; desde += 1000) {
        var res = await L.lector.from('productos').select('stock_actual, costo, tipo, activo').eq('auth_user_id', L.uid).range(desde, desde + 999);
        var pg = (res && res.data) || [];
        prods = prods.concat(pg);
        if (pg.length < 1000) break;
      }
      var fisicos = prods.filter(function (p) { return p.tipo === 'producto'; });
      // Misma fórmula que ya usa la conciliación de inventario inicial (existencias × costo).
      var valor = fisicos.reduce(function (t, p) { return t + Number(p.stock_actual || 0) * Number(p.costo || 0); }, 0);
      out.push({ nombre: L.nombre, tipo: L.tipo, uid: L.uid, valor: Math.round(valor * 100) / 100,
                 conExistencia: fisicos.filter(function (p) { return Number(p.stock_actual || 0) > 0; }).length });
    }
    return out;
  }

  window.N360ContaGrupo = { miembros: miembros, lector: lector, inventarioPorLugar: inventarioPorLugar, _cmp: cmp };
})();
