/* ============================================================
   PAGINAR-LECTURA.JS — NEGOCIO360
   El servidor devuelve como máximo 1000 filas por consulta. Este
   ayudante lee TODAS las filas en páginas de 1000 y devuelve el mismo
   formato que Supabase ({ data, error }), así una consulta existente
   solo se envuelve:  N360Leer.todo(() => sb.from('ventas').select('*')...)
   - Orden estable (se agrega "id" como desempate) para no repetir ni
     saltar filas entre páginas.
   - Reintenta 3 veces; si aún falla devuelve { data:null, error } igual
     que Supabase y avisa en pantalla (nunca devuelve datos a medias).
   ============================================================ */
(function () {
  'use strict';
  const PAG = 1000;
  let _avisoMs = 0;
  function avisar(etiqueta) {
    const ahora = Date.now();
    if (ahora - _avisoMs < 4000) return;
    _avisoMs = ahora;
    const msg = `No se pudieron leer todos los datos${etiqueta ? ' (' + etiqueta + ')' : ''}. Revisa tu conexión y recarga.`;
    try {
      const t = window.showToast || window.toast || window.mostrarToast;
      if (typeof t === 'function') t(msg, 'error'); else console.error(msg);
    } catch { console.error(msg); }
  }
  async function todo(construir, etiqueta, opts) {
    const ordenId = !(opts && opts.ordenId === false);
    const filas = [];
    for (let desde = 0; desde < 5000000; desde += PAG) {
      let pagina = null, ultimo = null;
      for (let intento = 0; intento < 3; intento++) {
        if (intento) await new Promise(r => setTimeout(r, intento * 700));
        try {
          let q = construir();
          if (ordenId) q = q.order('id', { ascending: true });
          const x = await q.range(desde, desde + PAG - 1);
          if (!x.error) { pagina = x.data || []; ultimo = null; break; }
          ultimo = x.error;
        } catch (e) { ultimo = e; }
      }
      if (pagina === null) {
        avisar(etiqueta);
        return { data: null, error: ultimo || new Error('Lectura incompleta'), count: null };
      }
      for (let i = 0; i < pagina.length; i++) filas.push(pagina[i]);
      if (pagina.length < PAG) break;
    }
    return { data: filas, error: null, count: filas.length };
  }
  // Para listas largas de identificadores (.in): reparte en lotes de 80.
  async function porIds(ids, construir, etiqueta, opts) {
    const out = [];
    for (let i = 0; i < ids.length; i += 80) {
      const r = await todo(() => construir(ids.slice(i, i + 80)), etiqueta, opts);
      if (r.error) return { data: null, error: r.error, count: null };
      for (let k = 0; k < r.data.length; k++) out.push(r.data[k]);
    }
    return { data: out, error: null, count: out.length };
  }
  window.N360Leer = { todo, porIds };
})();
