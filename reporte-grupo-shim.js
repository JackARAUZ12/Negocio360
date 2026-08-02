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
  'impuestos','capital_negocio',
];

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
  eq(col, val)  { this._filtros.push(r => r[col] === val); return this; }
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
      this._cache[this._tabla] = this._real.rpc('obtener_datos_grupo', { p_tabla: this._tabla })
        .then(({ data, error }) => { if (error) throw error; return data || []; });
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
    rpc: (...args) => clienteReal.rpc(...args),
  };
}
