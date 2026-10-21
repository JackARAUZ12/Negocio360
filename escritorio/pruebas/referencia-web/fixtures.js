// Datos de prueba compartidos: los usa la web simulada (supabase-falso) y la
// base de datos (dentro de una transacción que se revierte). Cuenta FALSA,
// nunca la de un cliente.
'use strict';

const U = '0ff11e00-0000-4000-8000-000000000001';
const id = (n) => `0ff11e00-0000-4000-8000-${String(n).padStart(12, '0')}`;

const IDS = {
  usuario: U,
  efectivo: id(101), tarjeta: id(102), transferencia: id(103),
  bac: id(201), lafise: id(202),
  martillo: id(301), clavos: id(302), taladro: id(303), instalacion: id(304), paracetamol: id(305), cable: id(306),
  kit: id(401), promo: id(501),
  cliente: id(601),
  iva: id(701), ir: id(702),
  lote1: id(801), lote2: id(802),
  presentacionCaja: id(901),
  dispositivo: '0ff11e00-dddd-4ddd-8ddd-000000000001',
};

const productos = [
  { id: IDS.martillo, nombre: 'Martillo', sku: 'MAR-1', tipo: 'producto', precio: 150, costo: 90, stock_actual: 10, activo: true, garantia_meses: 0, tipo_precio: 'fijo' },
  { id: IDS.clavos, nombre: 'Clavos ½"', sku: 'CLA-1', tipo: 'producto', precio: 45.5, costo: 20, stock_actual: 100, activo: true, garantia_meses: 0, tipo_precio: 'fijo' },
  { id: IDS.taladro, nombre: 'Taladro', sku: 'TAL-1', tipo: 'producto', precio: 2499.99, costo: 1800, stock_actual: 3, activo: true, garantia_meses: 12, tipo_precio: 'fijo' },
  { id: IDS.instalacion, nombre: 'Instalación', sku: null, tipo: 'servicio', precio: 300, costo: 0, stock_actual: 0, activo: true, garantia_meses: 0, tipo_precio: 'fijo' },
  { id: IDS.paracetamol, nombre: 'Paracetamol 500mg', sku: 'PAR-500', tipo: 'producto', precio: 12.35, costo: 5, stock_actual: 50, activo: true, garantia_meses: 0, tipo_precio: 'fijo' },
  { id: IDS.cable, nombre: 'Cable eléctrico (metro)', sku: 'CAB-1', tipo: 'producto', precio: 18.75, costo: 9.4, stock_actual: 200, activo: true, garantia_meses: 0, tipo_precio: 'fijo' },
];

const tablas = {
  usuarios: [{ auth_user_id: U, multiusuario_activo: false, nombre: 'Prueba', email: 'prueba-offline@negocio360.test' }],
  configuracion_empresa: [{ auth_user_id: U, nombre_comercial: 'Ferretería Prueba Offline', moneda: 'NIO', maneja_presentaciones: true, maneja_lotes_vencimiento: true, usa_farmacia_fase2: true, fefo_activo: true, vender_sin_stock: true }],
  metodos_pago: [
    { id: IDS.efectivo, auth_user_id: U, nombre: 'Efectivo', activo: true, orden: 1, es_default: true },
    { id: IDS.tarjeta, auth_user_id: U, nombre: 'Tarjeta', activo: true, orden: 2, es_default: false },
    { id: IDS.transferencia, auth_user_id: U, nombre: 'Transferencia', activo: true, orden: 3, es_default: false },
  ],
  bancos: [
    { id: IDS.bac, auth_user_id: U, nombre: 'BAC', moneda: 'NIO', activo: true, comision_porcentaje: 3 },
    { id: IDS.lafise, auth_user_id: U, nombre: 'LAFISE', moneda: 'NIO', activo: true, comision_porcentaje: 0 },
  ],
  productos: productos.map((p) => ({ auth_user_id: U, ...p })),
  combos: [{ id: IDS.kit, auth_user_id: U, nombre: 'Kit carpintero', precio: 600, costo: 290, activo: true, garantia_meses: 0 }],
  combo_items: [
    { id: id(411), auth_user_id: U, combo_id: IDS.kit, producto_id: IDS.martillo, cantidad: 1, precio_unitario: 150 },
    { id: id(412), auth_user_id: U, combo_id: IDS.kit, producto_id: IDS.clavos, cantidad: 10, precio_unitario: 45.5 },
  ],
  promociones: [{ id: IDS.promo, auth_user_id: U, nombre: '3x2 Clavos', tipo: 'nxm_grupo', activo: true, n_compra: 3, m_paga: 2, garantia_meses: 0, precio_promocion: null }],
  clientes: [{ id: IDS.cliente, auth_user_id: U, nombre: 'Juan', apellido: 'Pérez', telefono: '88888888', correo: null, total_compras: 1000, num_compras: 3, activo: true }],
  impuestos: [
    { id: IDS.iva, auth_user_id: U, nombre: 'IVA', categoria: 'iva', tipo_valor: 'porcentaje', valor: 15, estado: true },
    { id: IDS.ir, auth_user_id: U, nombre: 'Impuesto municipal', categoria: 'otro', tipo_valor: 'porcentaje', valor: 1, estado: true },
  ],
  producto_lotes: [
    { id: IDS.lote1, auth_user_id: U, producto_id: IDS.paracetamol, numero_lote: 'L-A', fecha_vencimiento: '2027-01-31', cantidad_inicial: 20, cantidad_actual: 20, activo: true },
    { id: IDS.lote2, auth_user_id: U, producto_id: IDS.paracetamol, numero_lote: 'L-B', fecha_vencimiento: '2027-06-30', cantidad_inicial: 30, cantidad_actual: 30, activo: true },
  ],
  producto_presentaciones: [{ id: IDS.presentacionCaja, auth_user_id: U, producto_id: IDS.clavos, nombre: 'Caja x12', factor: 12, precio: 500, activo: true }],
  // Saldos de partida: Caja 5,000.00 e Impuestos 100.00
  movimientos_financieros: [{ id: id(1001), auth_user_id: U, saldo_resultante: 5000, estado: 'completado', created_at: '2026-01-01T00:00:00.000Z' }],
  movimientos_impuestos: [{ id: id(1002), auth_user_id: U, saldo_resultante: 100, created_at: '2026-01-01T00:00:00.000Z' }],
  configuracion_venta_rapida: [{ auth_user_id: U, configurado: true, iva_activo: true, iva_porcentaje: 15, imprimir_automatico: false, ancho_ticket: '80mm' }],
};

module.exports = { U, IDS, tablas, id };
