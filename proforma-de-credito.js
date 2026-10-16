/* ============================================================
   PROFORMA DE CADA CRÉDITO (solo lectura, solo visual)
   ------------------------------------------------------------
   Muchos créditos nacen de una proforma (PR-000123). El número
   interno del crédito (CR-000045) NO cambia — sigue siendo el que
   usan la contabilidad, Caja, los pagos y los comprobantes ya
   emitidos —, pero en pantalla se muestra primero el número de la
   proforma, que es el que el cliente conoce, y se puede buscar por él.

   Un crédito viene de una proforma si:
     - proformas.credito_id = crédito  (Pago parcial / a crédito), o
     - proformas.venta_id   = creditos.venta_id  (convertida a venta a crédito).

   Uso:
     const mapa = await N360ProformaCredito.mapa(sb, userId, creditos); // Map(creditoId -> 'PR-000123')
     const ids  = await N360ProformaCredito.buscarCreditos(sb, userId, 'PR-0001'); // ids de créditos
     N360ProformaCredito.etiquetaHTML('CR-000045', 'PR-000123', esc)
     N360ProformaCredito.texto('CR-000045', 'PR-000123') -> 'PR-000123 (crédito CR-000045)'
   ============================================================ */
(function () {
  'use strict';
  if (window.N360ProformaCredito) return;

  var cache = {}; // creditoId -> numero_proforma | null

  function lotes(arr, n) { var r = []; for (var i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; }

  async function mapa(sb, userId, creditos) {
    var res = new Map();
    var lista = (creditos || []).filter(function (c) { return c && c.id; });
    var faltan = lista.filter(function (c) { return !(c.id in cache); });
    if (faltan.length) {
      try {
        var ids = faltan.map(function (c) { return c.id; });
        var ventaACredito = {};
        faltan.forEach(function (c) { if (c.venta_id) ventaACredito[c.venta_id] = c.id; });
        var ventaIds = Object.keys(ventaACredito);
        var encontrados = {};
        for (var a of lotes(ids, 150)) {
          var r1 = await sb.from('proformas').select('numero_proforma, credito_id').eq('auth_user_id', userId).in('credito_id', a);
          (r1.data || []).forEach(function (p) { if (p.credito_id && p.numero_proforma) encontrados[p.credito_id] = p.numero_proforma; });
        }
        for (var b of lotes(ventaIds, 150)) {
          var r2 = await sb.from('proformas').select('numero_proforma, venta_id').eq('auth_user_id', userId).in('venta_id', b);
          (r2.data || []).forEach(function (p) {
            var cid = ventaACredito[p.venta_id];
            if (cid && p.numero_proforma && !encontrados[cid]) encontrados[cid] = p.numero_proforma;
          });
        }
        faltan.forEach(function (c) { cache[c.id] = encontrados[c.id] || null; });
      } catch (e) { console.warn('N360ProformaCredito.mapa:', e); }
    }
    lista.forEach(function (c) { if (cache[c.id]) res.set(c.id, cache[c.id]); });
    return res;
  }

  // Ids de créditos cuya proforma de origen coincide con el texto buscado.
  async function buscarCreditos(sb, userId, texto) {
    var t = String(texto || '').trim();
    if (!t || t.length < 2) return [];
    try {
      var r = await sb.from('proformas').select('credito_id, venta_id').eq('auth_user_id', userId)
        .ilike('numero_proforma', '%' + t.replace(/[%,()]/g, '') + '%').limit(200);
      var filas = r.data || [];
      var ids = filas.map(function (p) { return p.credito_id; }).filter(Boolean);
      var ventas = filas.map(function (p) { return p.venta_id; }).filter(Boolean);
      if (ventas.length) {
        var r2 = await sb.from('creditos').select('id').eq('auth_user_id', userId).in('venta_id', ventas);
        (r2.data || []).forEach(function (c) { ids.push(c.id); });
      }
      return Array.from(new Set(ids));
    } catch (e) { console.warn('N360ProformaCredito.buscarCreditos:', e); return []; }
  }

  function escDef(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // PR grande y el CR chiquito debajo. Sin proforma: solo el CR, igual que antes.
  function etiquetaHTML(numCredito, numProforma, esc) {
    esc = esc || escDef;
    if (!numProforma) return '<span style="font-family:var(--font-mono);font-weight:700">' + esc(numCredito || '') + '</span>';
    return '<span style="font-family:var(--font-mono);font-weight:700" title="Crédito creado desde la proforma ' + esc(numProforma) + '">' + esc(numProforma) + '</span>' +
      '<div style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);white-space:nowrap">crédito ' + esc(numCredito || '') + '</div>';
  }
  function texto(numCredito, numProforma) {
    return numProforma ? numProforma + ' (crédito ' + (numCredito || '') + ')' : (numCredito || '');
  }

  window.N360ProformaCredito = { mapa: mapa, buscarCreditos: buscarCreditos, etiquetaHTML: etiquetaHTML, texto: texto, _cache: cache };
})();
