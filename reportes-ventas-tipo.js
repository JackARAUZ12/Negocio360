/* ============================================================
   REPORTES-VENTAS-TIPO.JS — Negocio360 · Reportes
   Ventas divididas por TIPO: Productos, Servicios, Combos (y
   Promociones si las hay), con cantidad, ingreso sin IVA, costo,
   ganancia y margen. En pantalla (pestaña Ventas), Excel y PDF.

   CUADRE: la tabla siempre suma EXACTO lo mismo que el total de
   ventas del reporte (ventas netas sin IVA, costo y ganancia):
     Productos + Servicios + Combos + Promociones
     + Ajustes (ventas sin detalle, canjes de puntos, redondeo)
     + Devoluciones del período
     = TOTAL del reporte.
   Todo se suma en centavos enteros (sin errores de decimales).
   Solo LEE datos ya cargados por reportes.js. No modifica nada.

   Cómo se reconoce cada tipo en venta_detalles:
     combo_id con valor      -> Combo
     promocion_id con valor  -> Promoción
     tipo_item = 'servicio'  -> Servicio
     lo demás                -> Producto
   ============================================================ */
(function () {
  'use strict';
  const CLASES = [
    { id: 'producto',  label: 'Productos',   icono: '📦', siempre: true,  rgb: [90, 90, 244] },
    { id: 'servicio',  label: 'Servicios',   icono: '🛠️', siempre: true,  rgb: [16, 185, 129] },
    { id: 'combo',     label: 'Combos',      icono: '🎁', siempre: true,  rgb: [234, 88, 12] },
    { id: 'promocion', label: 'Promociones', icono: '🏷️', siempre: false, rgb: [168, 85, 247] },
  ];
  const ETIQ_AJUSTE = 'Ajustes (ventas sin detalle, canjes y redondeo)';
  const ETIQ_DEVOL = 'Devoluciones del período';

  const cent = n => Math.round((Number(n) || 0) * 100);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = c => (typeof fmt === 'function' ? fmt(c / 100) : (c / 100).toFixed(2));
  const num = n => (typeof fmtNum === 'function' ? fmtNum(n) : String(n));
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const pctTxt = (a, b) => b ? pct(a, b).toLocaleString('es-NI', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
  const xMoneda = c => (typeof convertirParaMostrar === 'function' ? convertirParaMostrar(c / 100, R.moneda) : c / 100);

  function clase(d) {
    if (d.combo_id) return 'combo';
    if (d.promocion_id) return 'promocion';
    if (d.tipo_item === 'servicio') return 'servicio';
    return 'producto';
  }

  /* ---------- Cálculo (centavos enteros) ---------- */
  function calcular(ventas, detalles) {
    ventas = ventas || []; detalles = detalles || [];
    const porVenta = {};
    detalles.forEach(d => { (porVenta[d.venta_id] = porVenta[d.venta_id] || []).push(d); });
    const acc = {};
    CLASES.forEach(k => { acc[k.id] = { ventas: new Set(), lineas: 0, cant: 0, ing: 0, cos: 0 }; });
    const art = {};
    let ajI = 0, ajC = 0, sinDet = 0, devI = 0, devC = 0, nDev = 0, totI = 0, totC = 0;

    ventas.forEach(v => {
      const ingV = cent(v.total) - cent(v.impuesto);
      const cosV = cent(v.costo_total);
      totI += ingV; totC += cosV;
      if (v.es_devolucion) { devI += ingV; devC += cosV; nDev++; return; }
      const ls = porVenta[v.id] || [];
      if (!ls.length) sinDet++;
      let sI = 0, sC = 0;
      ls.forEach(d => {
        const k = clase(d);
        const cant = Number(d.cantidad) || 0;
        const li = cent(d.subtotal);
        const lc = Math.round((Number(d.costo) || 0) * cant * 100);
        sI += li; sC += lc;
        const a = acc[k]; a.ventas.add(v.id); a.lineas++; a.cant += cant; a.ing += li; a.cos += lc;
        const idRef = d.combo_id || d.promocion_id || d.producto_id || null;
        const nombre = (d.producto_nombre || '').trim() || CLASES.find(c => c.id === k).label.replace(/s$/, '');
        const key = k + ':' + (idRef || 'n:' + nombre.toUpperCase());
        const it = art[key] || (art[key] = { clase: k, id: idRef, nombre, cant: 0, ing: 0, cos: 0, regalia: 0 });
        it.cant += cant; it.ing += li; it.cos += lc;
        if (d.es_regalia) it.regalia += cant;
      });
      ajI += ingV - sI; ajC += cosV - sC;
    });

    const filas = CLASES.filter(k => k.siempre || acc[k.id].lineas > 0).map(k => {
      const a = acc[k.id];
      return { id: k.id, label: k.label, icono: k.icono, rgb: k.rgb, ventas: a.ventas.size, cant: a.cant, ing: a.ing, cos: a.cos, gan: a.ing - a.cos };
    });
    const articulos = Object.values(art).map(a => ({ ...a, gan: a.ing - a.cos }))
      .sort((x, y) => CLASES.findIndex(c => c.id === x.clase) - CLASES.findIndex(c => c.id === y.clase) || y.ing - x.ing || x.nombre.localeCompare(y.nombre));
    const res = {
      filas, articulos,
      ajuste: { ing: ajI, cos: ajC, gan: ajI - ajC, sinDetalle: sinDet },
      devol: { ing: devI, cos: devC, gan: devI - devC, n: nDev },
      total: { ing: totI, cos: totC, gan: totI - totC, ventas: ventas.filter(v => !v.es_devolucion).length },
    };
    // Candado de cuadre: la suma de las partes debe ser igual al total.
    const sI = filas.reduce((s, f) => s + f.ing, 0) + ajI + devI;
    const sC = filas.reduce((s, f) => s + f.cos, 0) + ajC + devC;
    res.cuadra = sI === totI && sC === totC;
    return res;
  }

  /* ---------- Contenido de los combos (opcional: si falla, no rompe nada) ---------- */
  const contenidoCombos = {};
  async function cargarContenidoCombos(detalles) {
    try {
      const ids = [...new Set((detalles || []).map(d => d.combo_id).filter(Boolean))].filter(id => !(id in contenidoCombos));
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await sb.from('combo_items').select('combo_id, cantidad, productos(nombre)')
          .eq('auth_user_id', R.userId).in('combo_id', ids.slice(i, i + 150));
        if (error) return;
        ids.slice(i, i + 150).forEach(id => { contenidoCombos[id] = ''; });
        const map = {};
        (data || []).forEach(ci => { (map[ci.combo_id] = map[ci.combo_id] || []).push(`${ci.productos?.nombre || 'Producto'} x${num(Number(ci.cantidad) || 0)}`); });
        Object.keys(map).forEach(id => { contenidoCombos[id] = map[id].join(', '); });
      }
    } catch (e) { console.warn('Contenido de combos:', e); }
  }
  const contenido = a => (a.clase === 'combo' && a.id && contenidoCombos[a.id]) || '';

  /* ---------- Pantalla (pestaña Ventas) ---------- */
  function renderPantalla(ventas, detalles) {
    const cont = document.getElementById('ventas-por-tipo');
    if (!cont) return;
    const r = calcular(ventas, detalles);
    const T = r.total;
    const fila = (ico, label, f, extra) => `<tr${extra || ''}>
        <td style="font-weight:600">${ico ? ico + ' ' : ''}${esc(label)}</td>
        <td class="td-right td-mono">${f.ventas != null ? num(f.ventas) : '—'}</td>
        <td class="td-right td-mono">${f.cant != null ? num(f.cant) : '—'}</td>
        <td class="td-right td-mono">${money(f.ing)}</td>
        <td class="td-right td-mono">${money(f.cos)}</td>
        <td class="td-right td-mono" style="font-weight:700;color:${f.gan < 0 ? 'var(--danger)' : 'var(--success)'}">${money(f.gan)}</td>
        <td class="td-right td-mono">${f.sinMargen ? '—' : pctTxt(f.gan, f.ing)}</td>
        <td class="td-right td-mono">${pctTxt(f.ing, T.ing)}</td></tr>`;
    let body = r.filas.map(f => fila(f.icono, f.label, f)).join('');
    if (r.ajuste.ing || r.ajuste.cos) body += fila('⚖️', ETIQ_AJUSTE, { ...r.ajuste, ventas: r.ajuste.sinDetalle || null, cant: null, sinMargen: true }, ' style="color:var(--text-muted)"');
    if (r.devol.n) body += fila('↩️', ETIQ_DEVOL, { ...r.devol, ventas: r.devol.n, cant: null, sinMargen: true }, ' style="color:var(--text-muted)"');
    const barra = T.ing > 0 ? r.filas.filter(f => f.ing > 0).map(f =>
      `<div title="${esc(f.label)}: ${pctTxt(f.ing, T.ing)}" style="flex:${f.ing};background:rgb(${f.rgb.join(',')});min-width:3px"></div>`).join('') : '';
    cont.innerHTML = `
      ${barra ? `<div style="display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden;margin:0 0 10px">${barra}</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        ${r.filas.filter(f => f.ing > 0).map(f => `<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:3px;background:rgb(${f.rgb.join(',')});display:inline-block"></i>${esc(f.label)} ${pctTxt(f.ing, T.ing)}</span>`).join('')}
      </div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Tipo</th><th class="th-right">Ventas</th><th class="th-right">Cantidad</th><th class="th-right">Ingreso (sin IVA)</th><th class="th-right">Costo</th><th class="th-right">Ganancia</th><th class="th-right">Margen</th><th class="th-right">% del total</th></tr></thead>
        <tbody>${body}
        <tr style="font-weight:800;background:var(--bg-tertiary,rgba(90,90,244,.06))">
          <td style="font-weight:800">TOTAL</td><td class="td-right td-mono">${num(T.ventas)}</td><td></td>
          <td class="td-right td-mono">${money(T.ing)}</td><td class="td-right td-mono">${money(T.cos)}</td>
          <td class="td-right td-mono">${money(T.gan)}</td><td class="td-right td-mono">${pctTxt(T.gan, T.ing)}</td><td class="td-right td-mono">${T.ing ? '100.0%' : '—'}</td></tr></tbody>
      </table></div>
      <p style="font-size:12px;color:var(--text-muted);margin:8px 2px 0">${r.cuadra ? '✅ Cuadra exacto con el total de ventas del período.' : '⚠️ No cuadra con el total de ventas: avisa a soporte.'}
        "Ventas" = cuántas transacciones incluyeron ese tipo (una venta puede tener varios tipos). El detalle por artículo sale en el Excel y el PDF.</p>`;
  }

  /* ---------- Excel ---------- */
  function hojasXLSX(wb) {
    const r = calcular(R.cache.ventas, R.cache.ventasDetalles);
    const T = r.total;
    const ratio = (a, b) => (b ? a / b : '');
    const filaX = (label, f) => [label, f.ventas == null ? '' : f.ventas, f.cant == null ? '' : f.cant, xMoneda(f.ing), xMoneda(f.cos), xMoneda(f.gan), f.sinMargen ? '' : ratio(f.gan, f.ing), ratio(f.ing, T.ing)];
    const rows = r.filas.map(f => filaX(f.label, f));
    if (r.ajuste.ing || r.ajuste.cos) rows.push(filaX(ETIQ_AJUSTE, { ...r.ajuste, ventas: r.ajuste.sinDetalle || null, cant: null, sinMargen: true }));
    if (r.devol.n) rows.push(filaX(ETIQ_DEVOL, { ...r.devol, ventas: r.devol.n, cant: null, sinMargen: true }));
    const s = sym();
    const head = ['Tipo', 'Ventas (transacciones)', 'Cantidad', `Ingreso sin IVA (${s})`, `Costo (${s})`, `Ganancia (${s})`, 'Margen', '% de las ventas'];
    const formatos = [null, NUM_ENTERO, NUM_CANT, NUM_MONEDA, NUM_MONEDA, NUM_MONEDA, '0.0%', '0.0%'];
    appendSheetXLSX(wb, 'Ventas por tipo', head, rows, formatos,
      { fija: ['TOTAL', T.ventas, '', xMoneda(T.ing), xMoneda(T.cos), xMoneda(T.gan), ratio(T.gan, T.ing), T.ing ? 1 : ''] });

    const det = r.articulos.map(a => [CLASES.find(c => c.id === a.clase).label, a.nombre + (a.regalia ? ` (incluye ${num(a.regalia)} de regalía)` : ''), contenido(a),
      a.cant, a.cant ? xMoneda(Math.round(a.ing / a.cant)) : '', xMoneda(a.ing), xMoneda(a.cos), xMoneda(a.gan), ratio(a.gan, a.ing)]);
    const headD = ['Tipo', 'Artículo', 'Contenido del combo', 'Cantidad', `Precio promedio (${s})`, `Ingreso sin IVA (${s})`, `Costo (${s})`, `Ganancia (${s})`, 'Margen'];
    const fmtD = [null, null, null, NUM_CANT, NUM_MONEDA, NUM_MONEDA, NUM_MONEDA, NUM_MONEDA, '0.0%'];
    appendSheetXLSX(wb, 'Detalle por tipo', headD,
      det.length ? det : [['Sin ventas en este período', '', '', '', '', '', '', '', '']], fmtD,
      det.length ? { sumas: [null, null, null, true, null, true, true, true, null], colEtiqueta: 1, etiqueta: 'TOTAL ARTÍCULOS (sin ajustes ni devoluciones)' } : null);
  }

  /* ---------- PDF ---------- */
  function pdf(doc, startY, h) {
    const r = calcular(R.cache.ventas, R.cache.ventasDetalles);
    const T = r.total;
    h.tituloSeccion('Ventas por tipo: productos, servicios y combos');
    const filaP = (label, f) => [label, f.ventas == null ? '—' : num(f.ventas), f.cant == null ? '—' : num(f.cant), money(f.ing), money(f.cos), money(f.gan), f.sinMargen ? '—' : pctTxt(f.gan, f.ing), pctTxt(f.ing, T.ing)];
    const body = r.filas.map(f => filaP(f.label, f));
    if (r.ajuste.ing || r.ajuste.cos) body.push(filaP(ETIQ_AJUSTE, { ...r.ajuste, ventas: r.ajuste.sinDetalle || null, cant: null, sinMargen: true }));
    if (r.devol.n) body.push(filaP(ETIQ_DEVOL, { ...r.devol, ventas: r.devol.n, cant: null, sinMargen: true }));
    const num8 = { halign: 'right' };
    doc.autoTable({
      startY, head: [['Tipo', 'Ventas', 'Cantidad', 'Ingreso (sin IVA)', 'Costo', 'Ganancia', 'Margen', '% del total']], body,
      foot: [['TOTAL', num(T.ventas), '', money(T.ing), money(T.cos), money(T.gan), pctTxt(T.gan, T.ing), T.ing ? '100.0%' : '—']],
      theme: 'grid', headStyles: { fillColor: [31, 56, 100], halign: 'center' },
      footStyles: { fillColor: [220, 230, 244], textColor: [31, 56, 100], fontStyle: 'bold' },
      columnStyles: { 1: num8, 2: num8, 3: num8, 4: num8, 5: num8, 6: num8, 7: num8 },
      margin: { left: 10, right: 10 }, styles: { fontSize: 9, cellPadding: 2 },
    });
    startY = doc.lastAutoTable.finalY + 4;
    doc.setFontSize(8); doc.setTextColor(r.cuadra ? 21 : 185, r.cuadra ? 128 : 28, r.cuadra ? 61 : 28);
    doc.text(r.cuadra ? 'Cuadra exacto con el total de ventas del período (ventas netas sin IVA, costo y ganancia).'
      : 'ATENCIÓN: no cuadra con el total de ventas. Avise a soporte.', 10, startY + 2);
    doc.setTextColor(110, 110, 120);
    doc.text('"Ventas" = transacciones que incluyeron ese tipo (una venta puede tener varios tipos).', 10, startY + 6);
    startY += 14;

    // Detalle por artículo, una tabla por tipo
    CLASES.forEach(k => {
      const lista = r.articulos.filter(a => a.clase === k.id);
      if (!lista.length) return;
      const esCombo = k.id === 'combo';
      const fil = lista.map(a => {
        const base = [a.nombre + (a.regalia ? ` (${num(a.regalia)} regalía)` : '')];
        if (esCombo) base.push(contenido(a) || '—');
        return base.concat([num(a.cant), a.cant ? money(Math.round(a.ing / a.cant)) : '—', money(a.ing), money(a.cos), money(a.gan), pctTxt(a.gan, a.ing)]);
      });
      const tot = lista.reduce((s, a) => ({ cant: s.cant + a.cant, ing: s.ing + a.ing, cos: s.cos + a.cos }), { cant: 0, ing: 0, cos: 0 });
      const head = ['Artículo'].concat(esCombo ? ['Contenido'] : [], ['Cantidad', 'Precio prom.', 'Ingreso', 'Costo', 'Ganancia', 'Margen']);
      const foot = [`SUBTOTAL ${k.label.toUpperCase()}`].concat(esCombo ? [''] : [], [num(tot.cant), '', money(tot.ing), money(tot.cos), money(tot.ing - tot.cos), pctTxt(tot.ing - tot.cos, tot.ing)]);
      const off = esCombo ? 1 : 0;
      const cs = {}; for (let i = 1 + off; i < head.length; i++) cs[i] = num8;
      if (esCombo) cs[1] = { cellWidth: 70 };
      if (startY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); h.pintarCabecera(); startY = 28; }
      doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(...k.rgb);
      doc.text(`${k.label} — detalle por artículo (${lista.length})`, 10, startY); doc.setFont(undefined, 'normal');
      doc.autoTable({
        startY: startY + 2, head: [head], body: fil, foot: [foot], showFoot: 'lastPage',
        theme: 'striped', headStyles: { fillColor: k.rgb }, footStyles: { fillColor: [235, 238, 245], textColor: [30, 30, 40], fontStyle: 'bold' },
        columnStyles: cs, margin: { left: 10, right: 10 }, styles: { fontSize: 8, overflow: 'linebreak' },
      });
      startY = doc.lastAutoTable.finalY + 8;
    });
    return startY;
  }

  window.N360VentasTipo = { clase, calcular, cargarContenidoCombos, renderPantalla, hojasXLSX, pdf, CLASES };
})();
