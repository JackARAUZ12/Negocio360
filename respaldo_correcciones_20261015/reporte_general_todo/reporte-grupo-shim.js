/* =====================================================
   REPORTE-GRUPO-SHIM.JS — Negocio360
   Adaptador para el Reporte General (general.html). Hace que el MISMO
   código de reportes.js funcione sin cambiarle ni una línea de su
   lógica de cálculo, pero trayendo los datos combinados de TODO el
   grupo (Central + sucursales + bodegas) en vez de solo la cuenta
   actual — reutiliza la función obtener_datos_grupo() ya protegida
   en la base de datos.

   Cómo funciona: crearClienteGrupo(clienteReal) devuelve un objeto que
   se comporta como el cliente normal de Supabase. Para las tablas de
   reportes (ventas, productos, gastos, etc.) responde con datos del
   grupo completo, imitando .select().eq().gte()... como si fuera una
   consulta normal. Para cualquier otra tabla (usuarios, configuracion_
   empresa, etc.) usa el cliente real sin ningún cambio.
===================================================== */

const TABLAS_REPORTE_GRUPO = [
  'ventas','venta_detalles','productos','gastos','gastos_programados','compras','detalle_compras',
  'clientes','creditos','creditos_cuotas','cuentas_por_pagar','cuentas_por_pagar_cuotas',
  'empleados','empleados_pagos','proformas','proforma_detalles','combos',
  'movimientos_financieros','movimientos_impuestos','caja','movimientos_inventario',
  'impuestos','capital_negocio','precios_escala',
];

// ── REPORTE UNIFICADO (general.html?unificado=1) ─────────────────────
// Junta varios grupos del mismo dueño (ej. ALL PLASTIC Comercial + Mayorista).
// Solo se activa en general.html con ?unificado=1; en cualquier otra página
// o sin ese parámetro, este archivo se comporta EXACTAMENTE igual que antes.
// El servidor (obtener_datos_grupo_pag) decide qué cuentas entran: solo las
// del grupo unificado de quien consulta. Lee por páginas de 1000 filas.
const N360_UNIFICADO = (() => {
  try { return /\/general\.html$/.test(location.pathname) && new URLSearchParams(location.search).get('unificado') === '1'; }
  catch (e) { return false; }
})();
// Avance de lectura (para la barra de carga): N360ProgresoGrupo(tabla, filasLeidas, terminado)
function _avisarProgresoGrupo(tabla, filas, fin) {
  try { if (typeof window.N360ProgresoGrupo === 'function') window.N360ProgresoGrupo(tabla, filas, fin); } catch (e) {}
}
async function _leerTablaUnificada(clienteReal, tabla) {
  const PAG = 1000, filas = [];
  for (let desde = 0; desde < 5000000; desde += PAG) {
    let pagina = null, ultimo = null;
    for (let intento = 0; intento < 3 && pagina === null; intento++) {
      if (intento) await new Promise(r => setTimeout(r, intento * 700));
      const { data, error } = await clienteReal.rpc('obtener_datos_grupo_pag', { p_tabla: tabla, p_unificado: true, p_offset: desde, p_limit: PAG });
      if (error) ultimo = error; else pagina = data || [];
    }
    if (pagina === null) throw (ultimo || new Error('Lectura incompleta'));   // nunca datos a medias
    for (let i = 0; i < pagina.length; i++) filas.push(pagina[i]);
    _avisarProgresoGrupo(tabla, filas.length, false);
    if (pagina.length < PAG) break;
  }
  _avisarProgresoGrupo(tabla, filas.length, true);
  return filas;
}
let _infoUnificadoPromesa = null;
function infoGrupoUnificado(clienteReal) {
  if (!_infoUnificadoPromesa) {
    _infoUnificadoPromesa = clienteReal.rpc('grupo_unificado_info').then(({ data, error }) => {
      if (error) throw error;
      if (!data) return null;
      // Lista plana de cuentas (con el negocio al que pertenece cada una)
      const cuentas = [];
      (data.negocios || []).forEach(n => {
        const lista = Array.isArray(n.cuentas) ? n.cuentas : [];
        if (!lista.some(c => c.auth_user_id === n.central)) lista.unshift({ id: n.central, auth_user_id: n.central, nombre: n.etiqueta, tipo: 'sucursal', es_central: true, activa: true });
        lista.forEach(c => cuentas.push(Object.assign({}, c, { negocio: n.etiqueta, central: n.central })));
      });
      data.cuentas = cuentas;
      return data;
    });
  }
  return _infoUnificadoPromesa;
}
// Nombre legible de la cuenta dueña de una fila: "NEGOCIO" o "NEGOCIO · Bodega X"
function nombreCuentaUnificada(info, authUserId) {
  const c = info && info.cuentas && info.cuentas.find(x => x.auth_user_id === authUserId);
  if (!c) return '';
  return c.es_central ? c.negocio : `${c.negocio} · ${c.nombre}`;
}

class GrupoQueryBuilder {
  constructor(cache, clienteReal, tabla) {
    this._cache = cache;
    this._real = clienteReal;
    this._tabla = tabla;
    this._filtros = [];
    this._orden = null;
    this._limite = null;
    this._modo = 'lista'; // 'lista' | 'single' | 'maybeSingle'
  }
  select() { return this; } // siempre se trae la fila completa
  eq(col, val)  {
    // Reporte unificado: el servidor ya entregó SOLO las cuentas permitidas; el filtro
    // "auth_user_id = mi cuenta" de las consultas se ignora para que entren todas.
    if (N360_UNIFICADO && col === 'auth_user_id') return this;
    this._filtros.push(r => r[col] === val); return this;
  }
  neq(col, val) { this._filtros.push(r => r[col] !== val); return this; }
  gt(col, val)  { this._filtros.push(r => r[col] > val); return this; }
  gte(col, val) { this._filtros.push(r => r[col] >= val); return this; }
  lt(col, val)  { this._filtros.push(r => r[col] < val); return this; }
  lte(col, val) { this._filtros.push(r => r[col] <= val); return this; }
  in(col, arr)  { this._filtros.push(r => Array.isArray(arr) && arr.includes(r[col])); return this; }
  is(col, val)  { this._filtros.push(r => (val === null ? (r[col] === null || r[col] === undefined) : r[col] === val)); return this; }
  order(col, opts) { this._orden = { col, asc: !(opts && opts.ascending === false) }; return this; }
  limit(n) { this._limite = n; return this; }
  single() { this._modo = 'single'; return this; }
  maybeSingle() { this._modo = 'maybeSingle'; return this; }

  async _traer() {
    if (!this._cache[this._tabla]) {
      this._cache[this._tabla] = N360_UNIFICADO
        ? _leerTablaUnificada(this._real, this._tabla)
        : this._real.rpc('obtener_datos_grupo', { p_tabla: this._tabla })
            .then(({ data, error }) => { if (error) throw error; return data || []; });
      // Si falla, se borra del caché para que el siguiente intento vuelva a leer (no queda un error pegado).
      if (N360_UNIFICADO) { const t = this._tabla, c = this._cache, pr = c[t]; pr.catch(() => { if (c[t] === pr) delete c[t]; }); }
    }
    return this._cache[this._tabla];
  }

  // Hace que "await grupoClient.from(x)...encadenado" funcione igual
  // que una consulta normal de Supabase (que también es "thenable").
  then(onResolve, onReject) {
    this._traer()
      .then(filas => {
        let out = filas.filter(r => this._filtros.every(f => f(r)));
        if (this._orden) {
          const { col, asc } = this._orden;
          out = out.slice().sort((a, b) => {
            const av = a[col], bv = b[col];
            if (av == null && bv == null) return 0;
            if (av == null) return asc ? -1 : 1;
            if (bv == null) return asc ? 1 : -1;
            if (av < bv) return asc ? -1 : 1;
            if (av > bv) return asc ? 1 : -1;
            return 0;
          });
        }
        if (this._limite != null) out = out.slice(0, this._limite);

        if (this._modo === 'single') {
          if (out.length !== 1) return onResolve({ data: null, error: { message: 'No se encontró exactamente una fila' } });
          return onResolve({ data: out[0], error: null });
        }
        if (this._modo === 'maybeSingle') {
          return onResolve({ data: out[0] || null, error: null });
        }
        onResolve({ data: out, error: null });
      })
      .catch(err => onResolve({ data: null, error: err }));
  }
}

function crearClienteGrupo(clienteReal) {
  const cache = {};
  return {
    from(tabla) {
      if (TABLAS_REPORTE_GRUPO.includes(tabla)) {
        return new GrupoQueryBuilder(cache, clienteReal, tabla);
      }
      // Cualquier otra tabla (usuarios, configuracion_empresa, etc.)
      // se comporta exactamente igual que siempre, sin cambios.
      return clienteReal.from(tabla);
    },
    auth: clienteReal.auth,
    rpc: (...args) => {
      // Reporte unificado: la lista de cuentas incluye las de todos los negocios del grupo unificado.
      if (N360_UNIFICADO && args[0] === 'listar_sucursales_grupo') {
        return infoGrupoUnificado(clienteReal)
          .then(info => ({ data: info ? info.cuentas : [], error: null }))
          .catch(error => ({ data: null, error }));
      }
      return clienteReal.rpc(...args);
    },
  };
}
