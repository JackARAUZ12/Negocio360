// Escenarios de venta: cada uno se arma con las funciones REALES de
// ventas.js (las mismas que usa el cajero al tocar los botones) y se cierra
// con la confirmación real. Lo que la web habría guardado queda anotado.
'use strict';
const { IDS } = require('./fixtures');

const escenarios = [
  {
    nombre: 'nueva-efectivo-cliente-iva-descuento',
    tipo: 'nueva',
    pasos: async (I) => {
      await abrirNuevaVenta();
      seleccionarCliente(I.cliente); S.clienteOpcion = 'existente';
      await agregarAlCarritoConPrecio(I.martillo, 'producto', null);
      cambiarCantidad(I.martillo, 2);
      await agregarAlCarritoConPrecio(I.clavos, 'producto', null);
      cambiarCantidad(I.clavos, 3);
      cambiarDescuento(I.clavos, 6.5);
      if (!S.ivaActivo) toggleIva();
      cambiarIvaPorcentaje(15);
      seleccionarMetodoPago(I.efectivo, 'Efectivo');
      calcularResumen();
    },
  },
  {
    nombre: 'nueva-tarjeta-banco-comision-garantia',
    tipo: 'nueva',
    pasos: async (I) => {
      await abrirNuevaVenta();
      await agregarAlCarritoConPrecio(I.taladro, 'producto', null);
      await agregarAlCarritoConPrecio(I.instalacion, 'servicio', null);
      calcularResumen();
      seleccionarMetodoPago(I.tarjeta, 'Tarjeta');
      await cargarBancosDisponibles();
      elegirBancoVenta(I.bac, 'BAC', 'NIO');
      calcularResumen();
    },
  },
  {
    nombre: 'nueva-pago-separado-iva',
    tipo: 'nueva',
    pasos: async (I) => {
      await abrirNuevaVenta();
      await agregarAlCarritoConPrecio(I.cable, 'producto', null);
      cambiarCantidad(I.cable, 7);
      await agregarAlCarritoConPrecio(I.martillo, 'producto', null);
      if (!S.ivaActivo) toggleIva();
      cambiarIvaPorcentaje(15);
      calcularResumen();
      await seleccionarPagoSeparado();
      const total = S._resumen.cobrar;
      const iEf = S.pagoSeparadoLineas.findIndex((l) => l.metodoNombre === 'Efectivo');
      const iTr = S.pagoSeparadoLineas.findIndex((l) => l.metodoNombre === 'Transferencia');
      actualizarMontoPagoSeparado(iEf, 100.01);
      actualizarMontoPagoSeparado(iTr, Math.round((total - 100.01) * 100) / 100);
      elegirBancoLineaSeparada(iTr, I.lafise, 'LAFISE', 'NIO');
      calcularResumen();
    },
  },
  {
    nombre: 'nueva-combo-promocion-servicio',
    tipo: 'nueva',
    pasos: async (I) => {
      await abrirNuevaVenta();
      await agregarAlCarritoConPrecio(I.kit, 'producto', null);
      const promo = S.promociones.find((p) => p.id === I.promo) || { id: I.promo, nombre: '3x2 Clavos' };
      agregarPromocionComoLineaUnica(S.carrito, promo, [{ producto_id: I.clavos, cantidad: 3 }], 91, 60);
      await agregarAlCarritoConPrecio(I.instalacion, 'servicio', null);
      seleccionarMetodoPago(I.efectivo, 'Efectivo');
      calcularResumen();
    },
  },
  {
    nombre: 'nueva-otros-impuestos-retencion',
    tipo: 'nueva',
    pasos: async (I) => {
      await abrirNuevaVenta();
      await agregarAlCarritoConPrecio(I.clavos, 'producto', null);
      cambiarCantidad(I.clavos, 33);
      if (!S.ivaActivo) toggleIva();
      cambiarIvaPorcentaje(15);
      await agregarOtroImpuesto(I.ir);
      toggleRetIr(true); cambiarRetIrPct(2);
      seleccionarMetodoPago(I.efectivo, 'Efectivo');
      calcularResumen();
    },
  },
  {
    nombre: 'nueva-farmacia-lote-presentacion',
    tipo: 'nueva',
    pasos: async (I) => {
      await abrirNuevaVenta();
      await agregarAlCarritoConPrecio(I.paracetamol, 'producto', null);
      cambiarCantidad(I.paracetamol, 4);
      await agregarAlCarritoConPrecio(I.clavos, 'producto', null);
      cambiarPresentacion(I.clavos, I.presentacionCaja);
      seleccionarMetodoPago(I.efectivo, 'Efectivo');
      calcularResumen();
    },
  },
  {
    nombre: 'rapida-efectivo-iva',
    tipo: 'rapida',
    pasos: async (I) => {
      await abrirVentaRapida();
      const p = (id) => S.productosCache.find((x) => x.id === id);
      agregarAlCarritoVR(p(I.cable)); agregarAlCarritoVR(p(I.cable)); agregarAlCarritoVR(p(I.cable));
      agregarAlCarritoVR(p(I.paracetamol));
      seleccionarMetodoPagoVR(I.efectivo, 'Efectivo');
    },
  },
  {
    nombre: 'rapida-pago-separado',
    tipo: 'rapida',
    pasos: async (I) => {
      await abrirVentaRapida();
      const p = (id) => S.productosCache.find((x) => x.id === id);
      agregarAlCarritoVR(p(I.martillo)); agregarAlCarritoVR(p(I.clavos));
      await seleccionarPagoSeparadoVR();
      const total = calcularResumenVR().total;
      const iEf = VR.pagoSeparadoLineas.findIndex((l) => l.metodoNombre === 'Efectivo');
      const iTa = VR.pagoSeparadoLineas.findIndex((l) => l.metodoNombre === 'Tarjeta');
      VR.pagoSeparadoLineas[iEf].monto = 50;
      VR.pagoSeparadoLineas[iTa].monto = Math.round((total - 50) * 100) / 100;
      VR.pagoSeparadoLineas[iTa].bancoId = I.bac; VR.pagoSeparadoLineas[iTa].bancoNombre = 'BAC'; VR.pagoSeparadoLineas[iTa].bancoMoneda = 'NIO';
    },
  },
  {
    // Transferencia a un banco que SÍ tiene comisión configurada (BAC 3%):
    // la comisión es del POS de tarjeta, en transferencias no se cobra.
    nombre: 'nueva-transferencia-banco-sin-comision',
    tipo: 'nueva',
    pasos: async (I) => {
      await abrirNuevaVenta();
      await agregarAlCarritoConPrecio(I.martillo, 'producto', null);
      calcularResumen();
      seleccionarMetodoPago(I.transferencia, 'Transferencia');
      await cargarBancosDisponibles();
      elegirBancoVenta(I.bac, 'BAC', 'NIO');
      calcularResumen();
    },
  },
  {
    // Venta rápida con tarjeta: comisión del banco como gasto + egreso ligado.
    nombre: 'rapida-tarjeta-comision',
    tipo: 'rapida',
    pasos: async (I) => {
      await abrirVentaRapida();
      const p = (id) => S.productosCache.find((x) => x.id === id);
      agregarAlCarritoVR(p(I.martillo)); agregarAlCarritoVR(p(I.cable));
      seleccionarMetodoPagoVR(I.tarjeta, 'Tarjeta');
      await cargarBancosDisponibles();
      elegirBancoVentaVR(I.bac, 'BAC', 'NIO');
    },
  },
];

module.exports = { escenarios, IDS };
