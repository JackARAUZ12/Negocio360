/* Prueba de ancho de ticket: imprime una regla con barras de 58, 76 y 80 mm
   para ver qué ancho llega de verdad a la impresora. Solo imprime una hoja de
   prueba; no guarda nada ni toca ventas, caja ni contabilidad. */
function imprimirPruebaAnchoTicket(nombreRadio) {
  var r = document.querySelector('input[name="' + nombreRadio + '"]:checked');
  var v = r ? r.value : '80mm';
  var ancho = (v === '58mm' || v === '76mm' || v === '80mm') ? v : (v === 'epson_tmu220' ? '76mm' : '80mm');
  var barras = [58, 76, 80].map(function (mm) {
    return '<div class="b" style="width:' + mm + 'mm">&#9668; ' + mm + ' mm &#9658;</div>';
  }).join('');
  var w = window.open('', '_blank', 'width=380,height=600');
  if (!w) { if (typeof showToast === 'function') showToast('Permite las ventanas emergentes para imprimir la prueba', 'error'); return; }
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Prueba de ancho</title><style>' +
    '@page{size:' + ancho + ' auto;margin:0}*{box-sizing:border-box}' +
    'body{margin:0;padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;width:' + ancho + '}' +
    '.b{border:2px solid #000;text-align:center;font-weight:700;padding:6px 0;margin:6px 0;white-space:nowrap}' +
    'p{margin:6px 4px;line-height:1.35}</style></head><body>' +
    '<p><b>PRUEBA DE ANCHO</b><br>Configurado: ' + ancho + '</p>' + barras +
    '<p>Si la barra de 80 mm sale cortada, la impresora está usando papel de 58 mm: cambia el tamaño de papel en el cuadro de imprimir o en las Preferencias de la impresora.</p>' +
    '<script>window.onload=function(){window.print();}<\/script></body></html>');
  w.document.close();
}
window.imprimirPruebaAnchoTicket = imprimirPruebaAnchoTicket;
