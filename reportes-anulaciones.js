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
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Reporte de anulaciones y devoluciones', m, 44);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`${negocio()}  ·  Período: ${A.datos.desde} al ${A.datos.hasta}  ·  Generado: ${fechaHora(A.datos.generado)}`, m, 62);
    doc.autoTable({ startY: 76, margin: { left: m, right: m }, theme: 'grid', styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: [30, 41, 59] },
      head: [['Resumen', 'Cantidad', 'Monto']],
      body: [['Ventas anuladas', String(t.nAn), money(t.totalAn)], ['   de eso, devuelto en Caja', '', money(t.devueltoAn)],
             ['Devoluciones', String(t.nDev), money(t.totalDev)], ['   devuelto en dinero', '', money(t.dineroDev)], ['   rebajado de créditos', '', money(t.creditoDev)],
             ['   impuesto revertido', '', money(t.impDev)], ['   costo que volvió al inventario', '', money(t.costoReing)],
             [{ content: 'TOTAL AFECTADO', styles: { fontStyle: 'bold' } }, String(t.nAn + t.nDev), { content: money(t.totalAn + t.totalDev), styles: { fontStyle: 'bold' } }]],
      columnStyles: { 1: { halign: 'right', cellWidth: 80 }, 2: { halign: 'right', cellWidth: 120 } } });
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

  function exportarExcel() {
    if (!A.datos) return showToast('Primero carga el reporte.', 'error');
    const X = window.XLSX, vis = filtrar(), t = totales(vis), wb = X.utils.book_new();
    const hoja = (filas, anchos) => { const ws = X.utils.aoa_to_sheet(filas); ws['!cols'] = anchos.map(w => ({ wch: w })); return ws; };
    X.utils.book_append_sheet(wb, hoja([
      ['Reporte de anulaciones y devoluciones'], [negocio()], [`Período: ${A.datos.desde} al ${A.datos.hasta}`], [`Moneda: ${sym()}`], [],
      ['Concepto', 'Cantidad', 'Monto'],
      ['Ventas anuladas', t.nAn, t.totalAn], ['  devuelto en Caja', '', t.devueltoAn],
      ['Devoluciones', t.nDev, t.totalDev], ['  devuelto en dinero', '', t.dineroDev], ['  rebajado de créditos', '', t.creditoDev], ['  deuda perdonada', '', t.condonadoDev],
      ['  impuesto revertido', '', t.impDev], ['  sin impuesto', '', t.netoDev], ['  costo que volvió al inventario', '', t.costoReing], ['  costo que no volvió (dañado)', '', t.costoNoReing],
      ['TOTAL AFECTADO', t.nAn + t.nDev, r2(t.totalAn + t.totalDev)]], [34, 12, 16]), 'Resumen');
    X.utils.book_append_sheet(wb, hoja([['Venta', 'Fecha venta', 'Cliente', 'Método', 'Productos', 'Unidades', 'Motivo', 'Anulada en', 'Anulada por', 'Vendió', 'Devuelto en Caja', 'Impuesto', 'Total']]
      .concat(vis.anuladas.map(v => [v.numero_venta || '', f10(v.fecha), v.cliente_nombre || 'Consumidor final', v.metodo_pago_nombre || v.metodo_pago || '', prodTxt(v._productos), v._unidades, v._motivo,
        v._cuando ? fechaHora(v._cuando) : '', v.anulada_por || '', v.creado_por_nombre || '', v._devueltoCaja, r2(v.impuesto), r2(v.total)]))
      .concat([['TOTAL', '', '', '', '', t.unidAn, '', '', '', '', t.devueltoAn, t.impAn, t.totalAn]]), [14, 11, 24, 14, 50, 9, 40, 18, 16, 16, 14, 11, 13]), 'Anuladas');
    X.utils.book_append_sheet(wb, hoja([['Devolución', 'Fecha', 'Venta original', 'Cliente', 'Tipo', 'Venta', 'Productos', 'Unidades', 'Motivo', 'Registró', 'Dinero devuelto', 'Método', 'Rebajado de crédito', 'Deuda perdonada', 'Impuesto', 'Sin impuesto', 'Costo reingresado', 'Total']]
      .concat(vis.devs.map(d => [d.numero || '', f10(d.fecha), d._venta.numero_venta || '', d._venta.cliente_nombre || 'Consumidor final', d._esTotal ? 'Total' : 'Parcial', d.tipo_venta || '', prodTxt(d._productos), d._unidades,
        d.motivo || '', d.usuario_nombre || '', r2(d.monto_dinero), d.metodo_pago_nombre || '', r2(d.monto_credito), r2(d.deuda_condonada), r2(d.impuesto), r2(d.neto), r2(d.costo_reingresado), r2(d.total)]))
      .concat([['TOTAL', '', '', '', '', '', '', t.unidDev, '', '', t.dineroDev, '', t.creditoDev, t.condonadoDev, t.impDev, t.netoDev, t.costoReing, t.totalDev]]),
      [12, 11, 13, 24, 9, 10, 50, 9, 36, 16, 14, 13, 16, 14, 11, 13, 15, 13]), 'Devoluciones');
    const prods = [['Origen', 'Documento', 'Fecha', 'Producto', 'Cantidad', 'Monto', 'Volvió al inventario']];
    vis.anuladas.forEach(v => v._productos.forEach(p => prods.push(['Anulada', v.numero_venta || '', f10(v.fecha), p.producto_nombre, Number(p.cantidad), r2(p.subtotal), 'Sí'])));
    vis.devs.forEach(d => d._productos.forEach(p => prods.push(['Devolución', d.numero || '', f10(d.fecha), p.producto_nombre, Number(p.cantidad), r2(p.monto), p.reingresa === false ? 'No (dañado)' : 'Sí'])));
    X.utils.book_append_sheet(wb, hoja(prods, [11, 14, 11, 40, 10, 13, 18]), 'Productos');
    X.writeFile(wb, nombreArchivo('xlsx'));
  }

  window.N360Anulaciones = {
    cargar: loadAnulacionesTab,
    filtro(v) { A.filtro = v; document.querySelectorAll('.an-filtro').forEach(b => b.classList.toggle('active', b.dataset.v === v)); if (A.datos) pintar(); },
    buscar(v) { A.buscar = v || ''; if (A.datos) pintar(); },
    pdf: exportarPDF, excel: exportarExcel,
  };
})();
