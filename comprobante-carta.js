/* =====================================================
   COMPROBANTE TAMAÑO CARTA — compartido entre Ventas y Créditos.
   Mismo estilo visual que ya usan Proformas/Compras/Reportes
   (franja de color de marca, logo ajustable, tabla de ítems,
   totales, mensaje de pie personalizable). No es un documento
   fiscal — es un comprobante formal para el cliente, alternativa
   al ticket térmico de 58/80mm.

   Requiere que el archivo que lo use ya tenga cargado: jsPDF +
   jspdf-autotable, un cliente de Supabase (sb / supabaseClient /
   sbClient — se detecta solo), y las funciones fmt()/esc()/sym()
   ya usadas en el resto del sistema.
===================================================== */

async function _cc_clienteSupabase() {
  return window.sbClient || window.supabaseClient || window.sb || window.supabase;
}

async function _cc_cargarConfigDocumentos(userId) {
  const sb = await _cc_clienteSupabase();
  const { data } = await sb.from('configuracion_documentos').select('*').eq('auth_user_id', userId).maybeSingle();
  return data || {};
}

async function _cc_cargarLogo(userId) {
  try {
    const sb = await _cc_clienteSupabase();
    const { data: cfg } = await sb.from('configuracion_empresa').select('logo_url').eq('auth_user_id', userId).maybeSingle();
    if (!cfg?.logo_url) return null;
    const resp = await fetch(cfg.logo_url);
    const blob = await resp.blob();
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    const formato = blob.type.includes('png') ? 'PNG' : 'JPEG';
    const img = new Image();
    await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = dataUrl; });
    return { dataUrl, formato, anchoNatural: img.naturalWidth || 200, altoNatural: img.naturalHeight || 200 };
  } catch (e) { return null; }
}

function _cc_ajustarLogo(anchoNatural, altoNatural, maxAncho, maxAlto) {
  const escala = Math.min(maxAncho / anchoNatural, maxAlto / altoNatural, 1) || 1;
  return { w: anchoNatural * escala, h: altoNatural * escala };
}

function _cc_hexARgb(hex) {
  if (!hex) return null;
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Genera el PDF del comprobante tamaño carta.
 * @param {'venta'|'credito'} tipo
 * @param {object} datos - { numero, fecha, cliente_nombre, cliente_telefono, cliente_direccion,
 *                            subtotal, descuento, impuesto, iva_porcentaje, total, metodo_pago,
 *                            observaciones, userId, empresaNombre, empresaDireccion,
 *                            empresaTelefono, empresaRuc, moneda_simbolo }
 * @param {Array}  items  - [{ nombre, cantidad, precio, descuento, subtotal }]
 */
async function generarComprobanteCartaPDF(tipo, datos, items) {
  if (!window.jspdf) throw new Error('jsPDF no está disponible');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;

  const cfg  = await _cc_cargarConfigDocumentos(datos.userId);
  const logo = await _cc_cargarLogo(datos.userId);

  const TITULOS = { venta: 'Comprobante de Venta', credito: 'Comprobante de Crédito' };
  const titulo = TITULOS[tipo] || 'Comprobante';
  const moneda = datos.moneda_simbolo || 'C$';
  const fmtM = (n) => `${moneda} ${Number(n||0).toLocaleString('es-NI', { minimumFractionDigits: 2 })}`;

  const [rC, gC, bC] = _cc_hexARgb(cfg.color_principal) || [108, 99, 255];
  doc.setFillColor(rC, gC, bC);
  doc.rect(0, 0, W, 38, 'F');

  let textoX = M;
  const TAMANOS_LOGO = { pequeno: {ancho:32, alto:22}, mediano: {ancho:45, alto:28}, grande: {ancho:58, alto:34} };
  const cajaLogo = TAMANOS_LOGO[cfg.logo_tamano] || TAMANOS_LOGO.mediano;
  if (logo) {
    try {
      const { w, h } = _cc_ajustarLogo(logo.anchoNatural, logo.altoNatural, cajaLogo.ancho, cajaLogo.alto);
      doc.addImage(logo.dataUrl, logo.formato, M, (38-h)/2, w, h);
      textoX = M + w + 6;
    } catch (e) { /* si falla, se sigue sin logo */ }
  }

  doc.setTextColor(255,255,255);
  const anchoDisponibleNombre = (W - M - 40) - textoX;
  let tamanoNombre = 20;
  doc.setFont(undefined, 'bold');
  while (tamanoNombre > 12) {
    doc.setFontSize(tamanoNombre);
    if (doc.getTextWidth(datos.empresaNombre || '') <= anchoDisponibleNombre) break;
    tamanoNombre -= 1;
  }
  doc.text(datos.empresaNombre || 'Mi Negocio', textoX, 20);
  doc.setFontSize(11); doc.setFont(undefined, 'normal');
  doc.text(titulo, textoX, 29);
  doc.setFontSize(9);
  doc.text(`N.º ${datos.numero || '—'}`, W - M, 18, { align: 'right' });
  doc.text(`Fecha: ${datos.fecha || '—'}`, W - M, 24, { align: 'right' });

  let y = 50;
  doc.setTextColor(20,20,30);

  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
  const infoNegocio = [
    cfg.mostrar_direccion !== false ? datos.empresaDireccion : '',
    cfg.mostrar_telefono !== false && datos.empresaTelefono ? `Tel: ${datos.empresaTelefono}` : '',
    cfg.mostrar_ruc !== false && datos.empresaRuc ? `RUC: ${datos.empresaRuc}` : '',
  ].filter(Boolean);
  infoNegocio.forEach((linea, i) => doc.text(linea, M, y + i*5));

  doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(20,20,30);
  doc.text('Cliente', W - M - 70, y);
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
  const infoCliente = [
    datos.cliente_nombre || 'Consumidor final',
    datos.cliente_telefono ? `Tel: ${datos.cliente_telefono}` : '',
    datos.cliente_direccion || '',
  ].filter(Boolean);
  infoCliente.forEach((linea, i) => doc.text(linea, W - M - 70, y + 5 + i*5));

  y += Math.max(infoNegocio.length, infoCliente.length + 1) * 5 + 10;
  doc.setDrawColor(230,230,235);
  doc.line(M, y, W - M, y);
  y += 8;

  if (datos.metodo_pago) {
    doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(rC, gC, bC);
    doc.text(`Método de pago: ${datos.metodo_pago}`, M, y);
    y += 10;
  }

  const filas = (items||[]).map(it => [
    it.nombre || 'Ítem',
    Number(it.cantidad).toLocaleString('es-NI', { maximumFractionDigits: 2 }),
    fmtM(it.precio),
    Number(it.descuento) > 0 ? fmtM(it.descuento) : '—',
    fmtM(it.subtotal),
  ]);
  doc.autoTable({
    startY: y,
    head: [['Descripción', 'Cant.', 'Precio unit.', 'Descuento', 'Subtotal']],
    body: filas,
    theme: 'striped',
    headStyles: { fillColor: _cc_hexARgb(cfg.color_tabla_usa_mismo !== false ? cfg.color_principal : cfg.color_tabla) || [108,99,255] },
    styles: { fontSize: 9.5, cellPadding: 3.5 },
    columnStyles: { 1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'} },
    margin: { left: M, right: M },
  });

  let finalY = doc.lastAutoTable.finalY + 10;
  const anchoTotales = 75;
  const xEtiqueta = W - M - anchoTotales, xValor = W - M;
  const filaTotal = (label, val, big) => {
    doc.setFontSize(big ? 13 : 10);
    doc.setFont(undefined, big ? 'bold' : 'normal');
    doc.setTextColor(big ? rC : 90, big ? gC : 90, big ? bC : 110);
    doc.text(label, xEtiqueta, finalY);
    doc.text(val, xValor, finalY, { align: 'right' });
    finalY += big ? 8 : 6.5;
  };
  filaTotal('Subtotal:', fmtM(datos.subtotal));
  if (Number(datos.descuento) > 0) filaTotal('Descuento:', '-' + fmtM(datos.descuento));
  if (Number(datos.impuesto) > 0) filaTotal(`Impuesto${datos.iva_porcentaje?` (${Number(datos.iva_porcentaje)}%)`:''}:`, fmtM(datos.impuesto));
  doc.setDrawColor(230,230,235);
  doc.line(xEtiqueta, finalY - 4, xValor, finalY - 4);
  filaTotal('TOTAL:', fmtM(datos.total), true);

  finalY += 6;
  doc.setTextColor(20,20,30);

  if (datos.observaciones) {
    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text('Observaciones', M, finalY);
    finalY += 6;
    doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
    doc.splitTextToSize(datos.observaciones, W - M*2).forEach(ln => { doc.text(ln, M, finalY); finalY += 5; });
    finalY += 4;
  }

  const alturaPagina = doc.internal.pageSize.getHeight();
  let yPie = alturaPagina - 16;
  if (cfg.mensaje_pie) {
    doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90,90,110);
    const lineasPie = doc.splitTextToSize(cfg.mensaje_pie, W - M*2);
    yPie -= (lineasPie.length - 1) * 4.5;
    lineasPie.forEach(ln => { doc.text(ln, M, yPie); yPie += 4.5; });
    yPie += 5;
  }
  doc.setFontSize(8.5); doc.setTextColor(150,150,170);
  doc.text(`Comprobante generado por Negocio360 · ${moneda}`, M, yPie);

  return doc;
}
