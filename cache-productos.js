/* ============================================================
   CACHE-PRODUCTOS.JS — NEGOCIO360
   Para no bajar el catálogo completo cada vez que se abre una pantalla.
   Guarda la última lista leída en esta pestaña y, al volver a pedirla,
   pregunta solo "¿qué cambió desde la última lectura?" (fecha de cambio
   que la base de datos pone sola en cada modificación, incluidas las de
   stock) y mezcla esos cambios en el mismo lugar de la lista.

   REGLA DE ORO: ante CUALQUIER duda se lee la lista completa, exactamente
   como se hacía antes. Se lee completa cuando:
     - no hay copia guardada, está dañada o tiene más de 10 minutos;
     - cambió algo que podría cambiar el orden o el contenido de la lista
       (producto nuevo, producto desactivado, cambio de nombre);
     - la cantidad de productos ya no coincide (alguien borró o agregó);
     - cualquier consulta falla.
   Apagado de emergencia: en la consola del navegador,
     localStorage.setItem('n360_sin_cache','1')   (y recargar).
   ============================================================ */
(function () {
  'use strict';
  const EDAD_MAX_MS = 10 * 60 * 1000;
  function apagado() {
    try { return window.N360_SIN_CACHE === true || localStorage.getItem('n360_sin_cache') === '1'; } catch (_) { return false; }
  }
  function leer(k) {
    try {
      const raw = sessionStorage.getItem(k);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !Array.isArray(c.data) || typeof c.t !== 'number' || !c.max) return null;
      return c;
    } catch (_) { return null; }
  }
  function guardar(k, data, max) {
    try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), max, data })); }
    catch (_) { try { sessionStorage.removeItem(k); } catch (__) {} } // sin espacio o sin permiso: simplemente no se guarda
  }
  function maxActualizado(filas) {
    let m = '';
    for (let i = 0; i < filas.length; i++) { const u = filas[i] && filas[i].updated_at; if (!u) return ''; if (u > m) m = u; }
    return m;
  }
  async function completa(op, k) {
    const r = await op.completo();
    if (r && !r.error && Array.isArray(r.data)) {
      const m = maxActualizado(r.data);
      if (m) guardar(k, r.data, m); else { try { sessionStorage.removeItem(k); } catch (_) {} }
    }
    return r;
  }
  /* op = { clave, userId, completo(), delta(desdeISO), contar(), filtro?(fila), camposOrden?[] } */
  async function lista(op) {
    if (!op || !op.userId || apagado()) return op.completo();
    const k = 'n360_cl_' + op.clave + '_' + op.userId;
    try {
      const c = leer(k);
      if (!c || Date.now() - c.t > EDAD_MAX_MS || !c.data.length) return completa(op, k);
      const [d, n] = await Promise.all([op.delta(c.max), op.contar()]);
      if (!d || d.error || !Array.isArray(d.data) || !n || n.error || typeof n.count !== 'number') return completa(op, k);
      const pos = new Map();
      for (let i = 0; i < c.data.length; i++) pos.set(c.data[i].id, i);
      const out = c.data.slice();
      const orden = op.camposOrden || [];
      for (let i = 0; i < d.data.length; i++) {
        const f = d.data[i];
        const p = pos.get(f.id);
        const pertenece = !op.filtro || op.filtro(f);
        if (p === undefined) { if (pertenece) return completa(op, k); continue; } // producto nuevo (si no pertenece a la lista, no importa)
        if (!pertenece) return completa(op, k);                            // salió de la lista (p. ej. desactivado)
        for (let j = 0; j < orden.length; j++) if (out[p][orden[j]] !== f[orden[j]]) return completa(op, k); // podría cambiar el orden
        out[p] = f;
      }
      if (n.count !== out.length) return completa(op, k);                  // se borró o agregó alguno
      const m = maxActualizado(out);
      if (!m) return completa(op, k);
      guardar(k, out, m > c.max ? m : c.max);
      // se conserva la hora de la última lectura completa para que cada 10 minutos se haga una completa
      try { const x = JSON.parse(sessionStorage.getItem(k)); x.t = c.t; sessionStorage.setItem(k, JSON.stringify(x)); } catch (_) {}
      return { data: out, error: null, count: out.length };
    } catch (_) {
      return completa(op, k);
    }
  }
  window.N360Cache = { lista, borrar: function (clave, userId) { try { sessionStorage.removeItem('n360_cl_' + clave + '_' + userId); } catch (_) {} } };
})();
