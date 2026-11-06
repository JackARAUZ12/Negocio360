/* ============================================================
   REPORTE DE ANULACIONES Y DEVOLUCIONES (06-nov-2026)
   Pestaña "Anulaciones y devoluciones" de Reportes.
   - Solo ventas ANULADAS y DEVOLUCIONES (DEV-…) del período elegido.
   - Sin tope de 1,000: todo se lee por páginas con leerTodo / leerPorIds
     (si una página falla, se avisa y el reporte NO se muestra a medias).
   - Totales calculados de las mismas filas que se ven: lo que suma la tabla
     es lo que dicen las tarjetas, el PDF y el Excel.
   Usa lo que ya existe en reportes.js: sb, R, getDateRange, periodLabel,
   leerTodo, leerPorIds, diaSiguienteISO, fmt, esc, sym, showToast.
   ============================================================ */
(function () {
  'use strict';
  const A = { datos: null, filtro: 'todo', buscar: '' };
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const suma = (arr, k) => r2(arr.reduce((s, x) => s + (Number(typeof k === 'function' ? k(x) : x[k]) || 0), 0));
  const f10 = x => (x ? String(x).slice(0, 10) : '');
  const fechaCorta = x => { if (!x) return '—'; const d = new Date(String(x).length <= 10 ? x + 'T12:00:00' : x); return isNaN(d) ? String(x).slice(0, 10) : d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const fechaHora = x => { if (!x) return '—'; const d = new Date(x); return isNaN(d) ? '—' : d.toLocaleString('es-NI', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const $ = id => document.getElementById(id);

  function motivoAnulacion(v) {
    if (v.anulado_motivo) return v.anulado_motivo;
    const o = String(v.observaciones || v.notas || '');
    if (/anulad/i.test(o)) return o;
    return 'No registrado (anulada antes de que se pidiera el motivo)';
  }

  async function cargar() {
    const { from, to } = getDateRange();
    // 1) Ventas anuladas del período (por la fecha de la venta)
    const anuladas = await leerTodo(() => sb.from('ventas')
      .select('id,numero_venta,fecha,cliente_nombre,subtotal,descuento,impuesto,total,metodo_pago_nombre,metodo_pago,estado_pago,observaciones,notas,creado_por_nombre,anulada_en,anulada_por,anulado_motivo,updated_at,proforma_id')
      .eq('auth_user_id', R.userId).eq('estado', 'anulada')
      .gte('fecha', from).lt('fecha', diaSiguienteISO(to))
      .order('fecha', { ascending: false }).order('id'), 'ventas anuladas');
    const idsAn = anuladas.map(v => v.id);
    // Productos y dinero de las anuladas
    const [detAn, movAn] = idsAn.length ? await Promise.all([
      leerPorIds(idsAn, ch => sb.from('venta_detalles').select('id,venta_id,producto_nombre,cantidad,subtotal')
        .eq('auth_user_id', R.userId).in('venta_id', ch).order('id'), 'productos de anuladas'),
      leerPorIds(idsAn, ch => sb.from('movimientos_financieros').select('id,referencia_id,tipo_flujo,monto')
        .eq('auth_user_id', R.userId).eq('estado', 'completado').in('referencia_id', ch).order('id'), 'caja de anuladas'),
    ]) : [[], []];
    const detPorVenta = {}; detAn.forEach(d => (detPorVenta[d.venta_id] = detPorVenta[d.venta_id] || []).push(d));
    const caja = {}; movAn.forEach(m => { const c = caja[m.referencia_id] = caja[m.referencia_id] || { entro: 0, salio: 0 }; c[m.tipo_flujo === 'INGRESO' ? 'entro' : 'salio'] += Number(m.monto) || 0; });
    anuladas.forEach(v => {
      const d = detPorVenta[v.id] || [];
      v._productos = d; v._nProd = d.length;
      v._unidades = r2(d.reduce((s, x) => s + (Number(x.cantidad) || 0), 0));
      const c = caja[v.id] || { entro: 0, salio: 0 };
      v._devueltoCaja = r2(Math.min(c.salio, c.entro || c.salio));
      v._motivo = motivoAnulacion(v);
      v._cuando = v.anulada_en || null;
    });

    // 2) Devoluciones del período (por la fecha de la devolución)
    let devs = await leerTodo(() => sb.from('devoluciones_venta')
      .select('id,numero,venta_id,fecha,motivo,tipo_venta,total,impuesto,neto,costo_reingresado,costo_no_reingresado,monto_credito,deuda_condonada,monto_dinero,monto_caja,metodo_pago_nombre,usuario_nombre,estado,created_at')
      .eq('auth_user_id', R.userId).gte('fecha', from).lte('fecha', to)
      .order('fecha', { ascending: false }).order('id'), 'devoluciones');
    devs = devs.filter(d => !/anulad/i.test(d.estado || ''));
    const idsDev = devs.map(d => d.id), idsVentaDev = [...new Set(devs.map(d => d.venta_id).filter(Boolean))];
    const [detDev, ventasDev] = await Promise.all([
      idsDev.length ? leerPorIds(idsDev, ch => sb.from('devolucion_venta_detalles').select('id,devolucion_id,producto_nombre,cantidad,monto,costo_total,reingresa')
        .eq('auth_user_id', R.userId).in('devolucion_id', ch).order('id'), 'productos devueltos') : [],
      idsVentaDev.length ? leerPorIds(idsVentaDev, ch => sb.from('ventas').select('id,numero_venta,fecha,cliente_nombre,total')
        .eq('auth_user_id', R.userId).in('id', ch).order('id'), 'ventas de las devoluciones') : [],
    ]);
    const ventaPorId = {}; ventasDev.forEach(v => { ventaPorId[v.id] = v; });
    const detPorDev = {}; detDev.forEach(d => (detPorDev[d.devolucion_id] = detPorDev[d.devolucion_id] || []).push(d));
    devs.forEach(d => {
      const v = ventaPorId[d.venta_id] || {};
      d._venta = v; d._productos = detPorDev[d.id] || [];
      d._unidades = r2(d._productos.reduce((s, x) => s + (Number(x.cantidad) || 0), 0));
      d._esTotal = v.total != null && Math.abs(Number(v.total) - Number(d.total)) < 0.01;
      const formas = [];
      if (Number(d.monto_dinero) > 0) formas.push(`Dinero ${fmt(d.monto_dinero)}${d.metodo_pago_nombre ? ' (' + d.metodo_pago_nombre + ')' : ''}`);
      if (Number(d.monto_credito) > 0) formas.push(`Rebajado del crédito ${fmt(d.monto_credito)}`);
      if (Number(d.deuda_condonada) > 0) formas.push(`Deuda perdonada ${fmt(d.deuda_condonada)}`);
      d._como = formas.join(' · ') || '—';
    });
    A.datos = { anuladas, devs, desde: from, hasta: to, generado: new Date() };
  }

  function totales(d) {
    const an = d.anuladas, dv = d.devs;
    return {
      nAn: an.length, totalAn: suma(an, 'total'), impAn: suma(an, 'impuesto'), devueltoAn: suma(an, '_devueltoCaja'), unidAn: suma(an, '_unidades'),
      nDev: dv.length, totalDev: suma(dv, 'total'), impDev: suma(dv, 'impuesto'), netoDev: suma(dv, 'neto'),
      dineroDev: suma(dv, 'monto_dinero'), creditoDev: suma(dv, 'monto_credito'), condonadoDev: suma(dv, 'deuda_condonada'),
      costoReing: suma(dv, 'costo_reingresado'), costoNoReing: suma(dv, 'costo_no_reingresado'), unidDev: suma(dv, '_unidades'),
      nTotDev: dv.filter(x => x._esTotal).length,
    };
  }

  function filtrar() {
    const q = A.buscar.trim().toLowerCase();
    const ok = (...c) => !q || c.some(x => String(x || '').toLowerCase().includes(q));
    return {
      anuladas: A.filtro === 'devoluciones' ? [] : A.datos.anuladas.filter(v => ok(v.numero_venta, v.cliente_nombre, v._motivo, v.anulada_por, v.creado_por_nombre, ...v._productos.map(p => p.producto_nombre))),
      devs: A.filtro === 'anuladas' ? [] : A.datos.devs.filter(d => ok(d.numero, d._venta.numero_venta, d._venta.cliente_nombre, d.motivo, d.usuario_nombre, ...d._productos.map(p => p.producto_nombre))),
    };
  }

  function listaProductos(ps, campoMonto) {
    if (!ps.length) return '<span style="color:var(--text-muted)">—</span>';
    const prim = ps.slice(0, 3).map(p => `${esc(p.producto_nombre)} ×${Number(p.cantidad).toLocaleString('es-NI', { maximumFractionDigits: 3 })}`).join(', ');
    return prim + (ps.length > 3 ? ` <span style="color:var(--text-muted)">y ${ps.length - 3} más</span>` : '');
  }

  function pintar() {
    const cont = $('an-contenido'); if (!cont || !A.datos) return;
    const vis = filtrar(), t = totales(vis);
    const kp = (lbl, val, sub, color) => `<div class="kpi-card"><div class="kpi-body"><div class="kpi-label">${lbl}</div><div class="kpi-value" style="${color ? 'color:' + color : ''}">${val}</div><div class="kpi-sub">${sub}</div></div></div>`;
    $('an-kpis').innerHTML =
      kp('Ventas anuladas', fmt(t.totalAn), `${t.nAn} venta${t.nAn !== 1 ? 's' : ''} · ${fmtNum(t.unidAn)} u.`, 'var(--danger)') +
      kp('Devoluciones', fmt(t.totalDev), `${t.nDev} devolución${t.nDev !== 1 ? 'es' : ''} (${t.nTotDev} total${t.nTotDev !== 1 ? 'es' : ''}) · ${fmtNum(t.unidDev)} u.`, '#b45309') +
      kp('Dinero que salió de Caja', fmt(r2(t.devueltoAn + t.dineroDev)), `Anuladas ${fmt(t.devueltoAn)} · Devoluciones ${fmt(t.dineroDev)}`) +
      kp('Total afectado', fmt(r2(t.totalAn + t.totalDev)), `Rebajado de créditos ${fmt(t.creditoDev)}${t.condonadoDev ? ' · perdonado ' + fmt(t.condonadoDev) : ''}`);

    const filasAn = vis.anuladas.map(v => `<tr>
        <td><b>${esc(v.numero_venta || '—')}</b><div class="an-sub">${fechaCorta(v.fecha)}</div></td>
        <td>${esc(v.cliente_nombre || 'Consumidor final')}<div class="an-sub">${esc(v.metodo_pago_nombre || v.metodo_pago || '')}</div></td>
        <td class="an-prod">${listaProductos(v._productos)}</td>
        <td class="an-motivo">${esc(v._motivo)}</td>
        <td>${v._cuando ? fechaHora(v._cuando) : '<span class="an-sub">Sin fecha</span>'}<div class="an-sub">${esc(v.anulada_por || '')}</div></td>
        <td class="td-right">${v._devueltoCaja ? fmt(v._devueltoCaja) : '<span class="an-sub">No</span>'}</td>
        <td class="td-right td-money">${fmt(v.total)}</td></tr>`).join('');
    const filasDev = vis.devs.map(d => `<tr>
        <td><b>${esc(d.numero || '—')}</b><div class="an-sub">${fechaCorta(d.fecha)}</div></td>
        <td>${esc(d._venta.numero_venta || '—')}<div class="an-sub">${esc(d._venta.cliente_nombre || 'Consumidor final')}</div></td>
        <td><span class="an-badge ${d._esTotal ? 'tot' : 'par'}">${d._esTotal ? 'Total' : 'Parcial'}</span><div class="an-sub">${d.tipo_venta === 'credito' ? 'Venta al crédito' : d.tipo_venta === 'fiado' ? 'Fiado' : 'Contado'}</div></td>
        <td class="an-prod">${listaProductos(d._productos)}</td>
        <td class="an-motivo">${esc(d.motivo || '—')}<div class="an-sub">${esc(d.usuario_nombre || '')}</div></td>
        <td class="an-como">${esc(d._como)}</td>
        <td class="td-right td-money">${fmt(d.total)}</td></tr>`).join('');

    cont.innerHTML = `
      ${A.filtro !== 'devoluciones' ? `<div class="panel-card"><div class="panel-header"><div><div class="panel-title">🚫 Ventas anuladas</div><div class="panel-subtitle">Por la fecha de la venta · ${vis.anuladas.length} de ${A.datos.anuladas.length}</div></div></div>
        <div class="panel-body"><div class="table-wrap"><table class="an-tabla">
          <thead><tr><th>Venta</th><th>Cliente / pago</th><th>Productos</th><th>Motivo</th><th>Anulada</th><th class="td-right">Devuelto en Caja</th><th class="td-right">Total</th></tr></thead>
          <tbody>${filasAn || '<tr><td colspan="7" class="empty-cell">No hay ventas anuladas en este período</td></tr>'}</tbody>
          ${vis.anuladas.length ? `<tfoot><tr><td colspan="5"><b>Total anuladas (${t.nAn})</b></td><td class="td-right"><b>${fmt(t.devueltoAn)}</b></td><td class="td-right td-money"><b>${fmt(t.totalAn)}</b></td></tr></tfoot>` : ''}
        </table></div></div></div>` : ''}
      ${A.filtro !== 'anuladas' ? `<div class="panel-card"><div class="panel-header"><div><div class="panel-title">↩️ Devoluciones</div><div class="panel-subtitle">Por la fecha de la devolución · ${vis.devs.length} de ${A.datos.devs.length}</div></div></div>
        <div class="panel-body"><div class="table-wrap"><table class="an-tabla">
          <thead><tr><th>Devolución</th><th>Venta original</th><th>Tipo</th><th>Productos devueltos</th><th>Motivo / quién</th><th>Cómo se devolvió</th><th class="td-right">Total</th></tr></thead>
          <tbody>${filasDev || '<tr><td colspan="7" class="empty-cell">No hay devoluciones en este período</td></tr>'}</tbody>
          ${vis.devs.length ? `<tfoot><tr><td colspan="6"><b>Total devoluciones (${t.nDev})</b> <span class="an-sub">· sin impuesto ${fmt(t.netoDev)} · impuesto ${fmt(t.impDev)} · costo que volvió al inventario ${fmt(t.costoReing)}</span></td><td class="td-right td-money"><b>${fmt(t.totalDev)}</b></td></tr></tfoot>` : ''}
        </table></div></div></div>` : ''}`;
  }

  async function loadAnulacionesTab() {
    const cont = $('an-contenido'); if (!cont) return;
    $('an-periodo') && ($('an-periodo').textContent = periodLabel());
    cont.innerHTML = '<div class="section-loading"><div class="mini-spinner"></div><br>Leyendo todas las anulaciones y devoluciones…</div>';
    $('an-kpis').innerHTML = '';
    try { await cargar(); pintar(); }
    catch (e) {
      console.error('anulaciones:', e); A.datos = null;
      cont.innerHTML = '<div class="empty-cell" style="padding:30px;color:var(--danger)">No se pudo leer todo. Para no mostrar números incompletos, el reporte no se muestra. Revisa tu conexión y vuelve a intentar.</div>';
    }
  }

  /* ---------- Exportar ---------- */
  function nombreArchivo(ext) { return `anulaciones_devoluciones_${A.datos.desde}_${A.datos.hasta}.${ext}`; }
  function negocio() { return (R.empresaConfig && (R.empresaConfig.nombre_comercial || R.empresaConfig.nombre_negocio)) || 'Mi negocio'; }
  const prodTxt = ps => ps.map(p => `${p.producto_nombre} x${Number(p.cantidad).toLocaleString('es-NI', { maximumFractionDigits: 3 })}`).join(', ');

  function exportarPDF() {
    if (!A.datos) return showToast('Primero carga el reporte.', 'error');
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const vis = filtrar(), t = totales(vis), W = doc.internal.pageSize.getWidth(), m = 36;
    const money = n => `${sym()} ${Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // Encabezado con franja de color
    doc.setFillColor(30, 41, 59); doc.rect(0, 0, W, 64, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Reporte de anulaciones y devoluciones', m, 30);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.text(`${negocio()}   ·   Período: ${A.datos.desde} al ${A.datos.hasta}   ·   Generado: ${fechaHora(A.datos.generado)}`, m, 48);
    // Tarjetas de totales
    const tarjetas = [['Ventas anuladas', money(t.totalAn), `${t.nAn} venta(s)`, [185, 28, 28]], ['Devoluciones', money(t.totalDev), `${t.nDev} devolución(es)`, [180, 83, 9]],
      ['Salió de Caja', money(t.devueltoAn + t.dineroDev), 'anuladas + devoluciones', [30, 41, 59]], ['Total afectado', money(t.totalAn + t.totalDev), `${t.nAn + t.nDev} documento(s)`, [30, 41, 59]]];
    const anchoT = (W - 2 * m - 3 * 10) / 4;
    tarjetas.forEach(([lbl, val, sub, col], i) => {
      const x = m + i * (anchoT + 10), y = 78;
      doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252); doc.roundedRect(x, y, anchoT, 50, 6, 6, 'FD');
      doc.setFillColor(col[0], col[1], col[2]); doc.rect(x, y + 6, 3, 38, 'F');
      doc.setTextColor(100, 116, 139); doc.setFontSize(8.5); doc.text(lbl.toUpperCase(), x + 12, y + 16);
      doc.setTextColor(col[0], col[1], col[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(val, x + 12, y + 33);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.text(sub, x + 12, y + 44);
    });
    doc.setTextColor(0);
    doc.autoTable({ startY: 142, margin: { left: m, right: m }, theme: 'grid', styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: [30, 41, 59] },
      head: [['Resumen', 'Cantidad', 'Monto']],
      body: [['Ventas anuladas', String(t.nAn), money(t.totalAn)], ['   de eso, devuelto en Caja', '', money(t.devueltoAn)],
             ['Devoluciones', String(t.nDev), money(t.totalDev)], ['   devuelto en dinero', '', money(t.dineroDev)], ['   rebajado de créditos', '', money(t.creditoDev)],
             ['   impuesto revertido', '', money(t.impDev)], ['   costo que volvió al inventario', '', money(t.costoReing)],
             [{ content: 'TOTAL AFECTADO', styles: { fontStyle: 'bold' } }, String(t.nAn + t.nDev), { content: money(t.totalAn + t.totalDev), styles: { fontStyle: 'bold' } }]],
      columnStyles: { 1: { halign: 'right', cellWidth: 80 }, 2: { halign: 'right', cellWidth: 120 } },
      didParseCell: c => { if (c.section === 'head' && c.column.index > 0) c.cell.styles.halign = 'right'; } });
    if (A.filtro !== 'devoluciones') {
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 18, margin: { left: m, right: m }, theme: 'striped', styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
        headStyles: { fillColor: [185, 28, 28] }, head: [['Venta', 'Fecha', 'Cliente', 'Productos', 'Motivo', 'Anulada (cuándo / quién)', 'Devuelto Caja', 'Total']],
        body: vis.anuladas.map(v => [v.numero_venta || '', f10(v.fecha), v.cliente_nombre || 'Consumidor final', prodTxt(v._productos), v._motivo, (v._cuando ? fechaHora(v._cuando) : 'Sin fecha') + (v.anulada_por ? ' / ' + v.anulada_por : ''), money(v._devueltoCaja), money(v.total)]),
        foot: [[{ content: `Total anuladas (${t.nAn})`, colSpan: 6 }, money(t.devueltoAn), money(t.totalAn)]],
        footStyles: { fillColor: [254, 226, 226], textColor: 20, fontStyle: 'bold' }, columnStyles: { 6: { halign: 'right' }, 7: { halign: 'right' } } });
    }
    if (A.filtro !== 'anuladas') {
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 18, margin: { left: m, right: m }, theme: 'striped', styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
        headStyles: { fillColor: [180, 83, 9] }, head: [['Devolución', 'Fecha', 'Venta / cliente', 'Tipo', 'Productos devueltos', 'Motivo / quién', 'Cómo se devolvió', 'Total']],
        body: vis.devs.map(d => [d.numero || '', f10(d.fecha), `${d._venta.numero_venta || ''} / ${d._venta.cliente_nombre || 'Consumidor final'}`, d._esTotal ? 'Total' : 'Parcial', prodTxt(d._productos), `${d.motivo || ''}${d.usuario_nombre ? ' / ' + d.usuario_nombre : ''}`, d._como, money(d.total)]),
        foot: [[{ content: `Total devoluciones (${t.nDev})`, colSpan: 7 }, money(t.totalDev)]],
        footStyles: { fillColor: [254, 243, 199], textColor: 20, fontStyle: 'bold' }, columnStyles: { 7: { halign: 'right' } } });
    }
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Página ${i} de ${n}`, W - m, doc.internal.pageSize.getHeight() - 16, { align: 'right' }); }
    doc.save(nombreArchivo('pdf'));
  }

  // Excel con formato profesional (colores, bordes, montos con moneda, totales, encabezado fijo, filtros,
  // listo para imprimir). Usa ExcelJS, que se carga solo cuando se pide el Excel.
  function cargarExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload = () => window.ExcelJS ? ok(window.ExcelJS) : mal(new Error('ExcelJS no cargó'));
      s.onerror = () => mal(new Error('No se pudo descargar el generador de Excel'));
      document.head.appendChild(s);
    });
  }

  async function exportarExcel() {
    if (!A.datos) return showToast('Primero carga el reporte.', 'error');
    let ExcelJS;
    try { ExcelJS = await cargarExcelJS(); } catch (e) { return showToast('No se pudo preparar el Excel. Revisa tu conexión e intenta de nuevo.', 'error'); }
    const vis = filtrar(), t = totales(vis);
    const wb = new ExcelJS.Workbook(); wb.creator = 'Negocio360'; wb.created = new Date();
    const MON = `"${sym()}" #,##0.00;[Red]-"${sym()}" #,##0.00`, NUM = '#,##0.###';
    const C = { oscuro: 'FF1E293B', rojo: 'FFB91C1C', rojoSuave: 'FFFEE2E2', ambar: 'FFB45309', ambarSuave: 'FFFEF3C7', gris: 'FFF8FAFC', borde: 'FFD1D5DB', blanco: 'FFFFFFFF', texto: 'FF0F172A', sub: 'FF64748B' };
    const borde = { top: { style: 'thin', color: { argb: C.borde } }, left: { style: 'thin', color: { argb: C.borde } }, bottom: { style: 'thin', color: { argb: C.borde } }, right: { style: 'thin', color: { argb: C.borde } } };
    const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

    // Hoja con título, subtítulo, tabla y fila de total.
    function hoja(nombre, color, colorSuave, titulo, cols, filas, total) {
      const ws = wb.addWorksheet(nombre, {
        views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 1, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }, printTitlesRow: '4:4' },
        headerFooter: { oddFooter: '&L&8' + negocio() + '&R&8Página &P de &N' },
      });
      ws.columns = cols.map(c => ({ key: c.k, width: c.w }));
      const n = cols.length, ultima = ws.getColumn(n).letter;
      ws.mergeCells(`A1:${ultima}1`); ws.mergeCells(`A2:${ultima}2`);
      const t1 = ws.getCell('A1'); t1.value = titulo; t1.font = { name: 'Calibri', size: 16, bold: true, color: { argb: C.blanco } }; t1.fill = relleno(color); t1.alignment = { vertical: 'middle', indent: 1 };
      ws.getRow(1).height = 30;
      const t2 = ws.getCell('A2'); t2.value = `${negocio()}   ·   Período: ${A.datos.desde} al ${A.datos.hasta}   ·   Generado: ${fechaHora(A.datos.generado)}`;
      t2.font = { size: 10, color: { argb: C.sub } }; t2.alignment = { indent: 1 }; ws.getRow(2).height = 18;
      const enc = ws.getRow(4); enc.values = cols.map(c => c.t); enc.height = 22;
      enc.eachCell(c => { c.font = { bold: true, color: { argb: C.blanco }, size: 10.5 }; c.fill = relleno(C.oscuro); c.border = borde; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
      filas.forEach((f, i) => {
        const r = ws.addRow(f);
        r.eachCell({ includeEmpty: true }, (c, ci) => {
          const col = cols[ci - 1]; if (!col) return;
          c.border = borde; c.font = { size: 10, color: { argb: C.texto } };
          c.alignment = { vertical: 'top', wrapText: !!col.wrap, horizontal: col.f === 'mon' || col.f === 'num' ? 'right' : col.centro ? 'center' : 'left' };
          if (col.f === 'mon') c.numFmt = MON; else if (col.f === 'num') c.numFmt = NUM;
          if (i % 2 === 1) c.fill = relleno(C.gris);
        });
      });
      if (filas.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + filas.length, column: n } };
      if (total) {
        const r = ws.addRow(total); r.height = 20;
        r.eachCell({ includeEmpty: true }, (c, ci) => {
          const col = cols[ci - 1]; if (!col) return;
          c.font = { bold: true, size: 10.5, color: { argb: C.texto } }; c.fill = relleno(colorSuave);
          c.border = { ...borde, top: { style: 'medium', color: { argb: color } } };
          c.alignment = { vertical: 'middle', horizontal: col.f === 'mon' || col.f === 'num' ? 'right' : 'left' };
          if (col.f === 'mon') c.numFmt = MON; else if (col.f === 'num') c.numFmt = NUM;
        });
      }
      if (!filas.length) { const r = ws.addRow(['Sin registros en este período']); ws.mergeCells(`A${r.number}:${ultima}${r.number}`); r.getCell(1).font = { italic: true, color: { argb: C.sub } }; }
      return ws;
    }

    // HOJA PRINCIPAL "Reporte": TODO en una sola hoja (resumen + anuladas + devoluciones con productos,
    // motivo, fechas y quién), igual que el PDF. Así se ve completo aunque solo se abra la primera hoja.
    const wsP = wb.addWorksheet('Reporte', {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 1, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: '&L&8' + negocio() + '&R&8Página &P de &N' },
    });
    wsP.columns = [14, 12, 26, 14, 44, 34, 22, 24, 15].map(w => ({ width: w }));
    const UL = 'I';
    const banda = (texto, color, alto, tam) => { const r = wsP.addRow([texto]); wsP.mergeCells(`A${r.number}:${UL}${r.number}`); const c = r.getCell(1); c.font = { size: tam || 13, bold: true, color: { argb: C.blanco } }; c.fill = relleno(color); c.alignment = { vertical: 'middle', indent: 1 }; r.height = alto || 24; return r; };
    banda('Reporte de anulaciones y devoluciones', C.oscuro, 32, 16);
    { const r = wsP.addRow([`${negocio()}   ·   Período: ${A.datos.desde} al ${A.datos.hasta}   ·   Generado: ${fechaHora(A.datos.generado)}`]); wsP.mergeCells(`A${r.number}:${UL}${r.number}`); r.getCell(1).font = { size: 10, color: { argb: C.sub } }; r.getCell(1).alignment = { indent: 1 }; }
    wsP.addRow([]);
    // Resumen: concepto (A:G) · cantidad (H) · monto (I)
    const filaRes = (concepto, cant, monto, est) => {
      const r = wsP.addRow([concepto, '', '', '', '', '', '', cant, monto]); wsP.mergeCells(`A${r.number}:G${r.number}`);
      for (const ci of [1, 8, 9]) { const c = r.getCell(ci); c.border = borde; c.font = { size: 10.5, bold: !!est?.bold, color: { argb: est?.color || C.texto } }; if (est?.fill) c.fill = relleno(est.fill); }
      r.getCell(1).alignment = { indent: est?.sub ? 3 : 1 }; r.getCell(8).alignment = { horizontal: 'right' }; r.getCell(9).alignment = { horizontal: 'right' }; r.getCell(9).numFmt = MON;
      if (est?.top) for (const ci of [1, 8, 9]) r.getCell(ci).border = { ...borde, top: { style: 'medium', color: { argb: C.oscuro } } };
      return r;
    };
    { const r = wsP.addRow(['Resumen', '', '', '', '', '', '', 'Cantidad', 'Monto']); wsP.mergeCells(`A${r.number}:G${r.number}`);
      for (const ci of [1, 8, 9]) { const c = r.getCell(ci); c.font = { bold: true, color: { argb: C.blanco } }; c.fill = relleno(C.oscuro); c.border = borde; c.alignment = ci === 1 ? { horizontal: 'left', indent: 1 } : { horizontal: 'right' }; } }
    filaRes('Ventas anuladas', t.nAn, t.totalAn, { bold: true, fill: C.rojoSuave, color: C.rojo });
    filaRes('de eso, devuelto en Caja', '', t.devueltoAn, { sub: true });
    filaRes('Devoluciones', t.nDev, t.totalDev, { bold: true, fill: C.ambarSuave, color: C.ambar });
    filaRes('devuelto en dinero', '', t.dineroDev, { sub: true });
    filaRes('rebajado de créditos', '', t.creditoDev, { sub: true });
    if (t.condonadoDev) filaRes('deuda perdonada', '', t.condonadoDev, { sub: true });
    filaRes('impuesto revertido', '', t.impDev, { sub: true });
    filaRes('costo que volvió al inventario', '', t.costoReing, { sub: true });
    filaRes('TOTAL AFECTADO', t.nAn + t.nDev, r2(t.totalAn + t.totalDev), { bold: true, fill: 'FFE2E8F0', top: true });
    filaRes('Dinero que salió de Caja en total', '', r2(t.devueltoAn + t.dineroDev), { bold: true });

    // Bloque de tabla dentro de la hoja principal
    function bloque(titulo, color, suave, encabezados, formatos, filas, total) {
      wsP.addRow([]); banda(titulo, color, 24, 13);
      const e = wsP.addRow(encabezados); e.height = 22;
      e.eachCell(c => { c.font = { bold: true, color: { argb: C.blanco }, size: 10 }; c.fill = relleno(C.oscuro); c.border = borde; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
      if (!filas.length) { const r = wsP.addRow(['Sin registros en este período']); wsP.mergeCells(`A${r.number}:${UL}${r.number}`); r.getCell(1).font = { italic: true, color: { argb: C.sub } }; return; }
      filas.forEach((f, i) => {
        const r = wsP.addRow(f);
        for (let ci = 1; ci <= 9; ci++) {
          const c = r.getCell(ci), fm = formatos[ci - 1];
          c.border = borde; c.font = { size: 10, color: { argb: C.texto } };
          c.alignment = { vertical: 'top', wrapText: true, horizontal: fm === 'mon' ? 'right' : fm === 'centro' ? 'center' : 'left' };
          if (fm === 'mon') c.numFmt = MON;
          if (i % 2 === 1) c.fill = relleno(C.gris);
        }
      });
      const r = wsP.addRow(total); r.height = 20;
      for (let ci = 1; ci <= 9; ci++) {
        const c = r.getCell(ci), fm = formatos[ci - 1];
        c.font = { bold: true, size: 10.5 }; c.fill = relleno(suave); c.border = { ...borde, top: { style: 'medium', color: { argb: color } } };
        c.alignment = { vertical: 'middle', horizontal: fm === 'mon' ? 'right' : 'left' }; if (fm === 'mon') c.numFmt = MON;
      }
    }
    if (A.filtro !== 'devoluciones') bloque('Ventas anuladas', C.rojo, C.rojoSuave,
      ['Venta', 'Fecha venta', 'Cliente', 'Forma de pago', 'Productos', 'Motivo', 'Anulada (cuándo / quién)', 'Devuelto en Caja', 'Total'],
      ['', 'centro', '', '', '', '', '', 'mon', 'mon'],
      vis.anuladas.map(v => [v.numero_venta || '', f10(v.fecha), v.cliente_nombre || 'Consumidor final', v.metodo_pago_nombre || v.metodo_pago || '', prodTxt(v._productos), v._motivo,
        (v._cuando ? fechaHora(v._cuando) : 'Sin fecha') + (v.anulada_por ? '\n' + v.anulada_por : ''), v._devueltoCaja, r2(v.total)]),
      [`Total anuladas (${t.nAn})`, '', '', '', '', '', '', t.devueltoAn, t.totalAn]);
    if (A.filtro !== 'anuladas') bloque('Devoluciones', C.ambar, C.ambarSuave,
      ['Devolución', 'Fecha', 'Venta original / cliente', 'Tipo', 'Productos devueltos', 'Motivo', 'Registró', 'Cómo se devolvió', 'Total'],
      ['', 'centro', '', 'centro', '', '', '', '', 'mon'],
      vis.devs.map(d => [d.numero || '', f10(d.fecha), `${d._venta.numero_venta || ''}\n${d._venta.cliente_nombre || 'Consumidor final'}`, d._esTotal ? 'Total' : 'Parcial', prodTxt(d._productos), d.motivo || '', d.usuario_nombre || '', d._como, r2(d.total)]),
      [`Total devoluciones (${t.nDev})`, '', '', '', '', '', '', '', t.totalDev]);

    // ANULADAS
    hoja('Anuladas', C.rojo, C.rojoSuave, 'Ventas anuladas', [
      { k: 'v', t: 'Venta', w: 14 }, { k: 'f', t: 'Fecha venta', w: 12, centro: true }, { k: 'c', t: 'Cliente', w: 24, wrap: true }, { k: 'm', t: 'Forma de pago', w: 14 },
      { k: 'p', t: 'Productos', w: 42, wrap: true }, { k: 'u', t: 'Unidades', w: 10, f: 'num' }, { k: 'mo', t: 'Motivo', w: 36, wrap: true },
      { k: 'ae', t: 'Anulada el', w: 19, centro: true }, { k: 'ap', t: 'Anulada por', w: 16 }, { k: 'dc', t: 'Devuelto en Caja', w: 16, f: 'mon' }, { k: 'tt', t: 'Total', w: 15, f: 'mon' },
    ], vis.anuladas.map(v => [v.numero_venta || '', f10(v.fecha), v.cliente_nombre || 'Consumidor final', v.metodo_pago_nombre || v.metodo_pago || '', prodTxt(v._productos), v._unidades, v._motivo,
      v._cuando ? fechaHora(v._cuando) : 'Sin fecha', v.anulada_por || '', v._devueltoCaja, r2(v.total)]),
      vis.anuladas.length ? [`Total (${t.nAn})`, '', '', '', '', t.unidAn, '', '', '', t.devueltoAn, t.totalAn] : null);

    // DEVOLUCIONES
    hoja('Devoluciones', C.ambar, C.ambarSuave, 'Devoluciones', [
      { k: 'd', t: 'Devolución', w: 13 }, { k: 'f', t: 'Fecha', w: 12, centro: true }, { k: 'v', t: 'Venta original', w: 14 }, { k: 'c', t: 'Cliente', w: 22, wrap: true },
      { k: 'ti', t: 'Tipo', w: 9, centro: true }, { k: 'p', t: 'Productos devueltos', w: 38, wrap: true }, { k: 'u', t: 'Unid.', w: 8, f: 'num' }, { k: 'mo', t: 'Motivo', w: 30, wrap: true },
      { k: 'q', t: 'Registró', w: 14 }, { k: 'di', t: 'Dinero devuelto', w: 15, f: 'mon' }, { k: 'cr', t: 'Rebajado crédito', w: 15, f: 'mon' }, { k: 'im', t: 'Impuesto', w: 12, f: 'mon' },
      { k: 'co', t: 'Costo reingresado', w: 15, f: 'mon' }, { k: 'tt', t: 'Total', w: 14, f: 'mon' },
    ], vis.devs.map(d => [d.numero || '', f10(d.fecha), d._venta.numero_venta || '', d._venta.cliente_nombre || 'Consumidor final', d._esTotal ? 'Total' : 'Parcial', prodTxt(d._productos), d._unidades,
      d.motivo || '', d.usuario_nombre || '', r2(d.monto_dinero), r2(d.monto_credito), r2(d.impuesto), r2(d.costo_reingresado), r2(d.total)]),
      vis.devs.length ? [`Total (${t.nDev})`, '', '', '', '', '', t.unidDev, '', '', t.dineroDev, t.creditoDev, t.impDev, t.costoReing, t.totalDev] : null);

    // PRODUCTOS (una línea por producto)
    const prods = [];
    vis.anuladas.forEach(v => v._productos.forEach(p => prods.push(['Anulada', v.numero_venta || '', f10(v.fecha), p.producto_nombre, Number(p.cantidad) || 0, r2(p.subtotal), 'Sí'])));
    vis.devs.forEach(d => d._productos.forEach(p => prods.push(['Devolución', d.numero || '', f10(d.fecha), p.producto_nombre, Number(p.cantidad) || 0, r2(p.monto), p.reingresa === false ? 'No (dañado)' : 'Sí'])));
    hoja('Productos', C.oscuro, 'FFE2E8F0', 'Productos anulados y devueltos', [
      { k: 'o', t: 'Origen', w: 12 }, { k: 'd', t: 'Documento', w: 14 }, { k: 'f', t: 'Fecha', w: 12, centro: true }, { k: 'p', t: 'Producto', w: 44, wrap: true },
      { k: 'c', t: 'Cantidad', w: 11, f: 'num' }, { k: 'm', t: 'Monto', w: 15, f: 'mon' }, { k: 'r', t: 'Volvió al inventario', w: 18, centro: true },
    ], prods, prods.length ? [`Total (${prods.length} líneas)`, '', '', '', r2(prods.reduce((s, x) => s + x[4], 0)), r2(prods.reduce((s, x) => s + x[5], 0)), ''] : null);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombreArchivo('xlsx');
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  window.N360Anulaciones = {
    cargar: loadAnulacionesTab,
    filtro(v) { A.filtro = v; document.querySelectorAll('.an-filtro').forEach(b => b.classList.toggle('active', b.dataset.v === v)); if (A.datos) pintar(); },
    buscar(v) { A.buscar = v || ''; if (A.datos) pintar(); },
    pdf: exportarPDF, excel: exportarExcel,
  };
})();
