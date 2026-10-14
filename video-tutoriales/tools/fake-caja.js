/* Supabase simulado SOLO para grabar el tutorial: devuelve datos de demostración. */
(function () {
  const UID = 'demo-user-0001';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const now = new Date();

  const PRODUCTOS = [
    ['Aceite Clover 1L', 78], ['Arroz Faisán 1 qq', 2650], ['Azúcar Montelimar fardo', 1150], ['Frijol rojo 1 qq', 3100],
    ['Café Presto 200g', 145], ['Harina Maseca 1kg', 42], ['Jabón Xedex 1kg', 68], ['Gaseosa Rojita 3L', 65],
    ['Leche Parmalat caja 12', 420], ['Pasta Roma 400g', 28], ['Sardina Pacífico', 38], ['Papel higiénico 12 rollos', 165],
  ];
  // ---- ventas (últimos 75 días)
  const ventas = [], detalles = [];
  let vid = 1;
  for (let i = 74; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const base = 8 + Math.round(rnd() * 5) + (d.getDay() === 6 ? 4 : 0) + Math.round((74 - i) / 8) + (i < 7 ? Math.round((7 - i) * 1.6) : 0);
    const nVentas = i === 0 ? 22 : base;
    for (let k = 0; k < nVentas; k++) {
      const h = 7 + Math.floor(rnd() * 11), m = Math.floor(rnd() * 60);
      const hh = i === 0 ? 7 + Math.floor(rnd() * 3) : h;
      let total = 0; const items = [];
      const nItems = 1 + Math.floor(rnd() * 2);
      for (let j = 0; j < nItems; j++) {
        const pi = Math.floor(Math.pow(rnd(), 1.6) * PRODUCTOS.length);
        const [nombre, precio] = PRODUCTOS[pi];
        const cant = precio > 1000 ? 1 : 1 + Math.floor(rnd() * 5);
        const sub = cant * precio; total += sub;
        items.push({ venta_id: vid, auth_user_id: UID, producto_nombre: nombre, cantidad: cant, subtotal: sub, tipo_item: 'producto' });
      }
      if (rnd() < .3) { const sv = rnd() < .5 ? ['Flete', 1800] : ['Entrega a domicilio', 350]; items.push({ venta_id: vid, auth_user_id: UID, producto_nombre: sv[0], cantidad: 1, subtotal: sv[1], tipo_item: 'servicio' }); total += sv[1]; }
      const impuesto = Math.round(total * 0.15 * (rnd() < .5 ? 1 : 0) * 100) / 100;
      ventas.push({ id: vid, auth_user_id: UID, fecha: `${ymd(d)}T${pad(hh)}:${pad(m)}:00`, total: total + impuesto, impuesto,
        costo_total: Math.round(total * (0.66 + rnd() * 0.08)), estado: 'completada',
        estado_pago: (i < 20 && rnd() < .02) ? 'pendiente' : 'pagado', creado_por_nombre: 'Admin' });
      detalles.push(...items); vid++;
    }
  }
  // Tendencia suave al alza en los últimos 7 días (para que la gráfica se vea clara en el tutorial)
  const TARGET = [16800, 18100, 17600, 19300, 20400, 21900, 23650];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); const day = ymd(d);
    const vs = ventas.filter(v => v.fecha.startsWith(day)); const sum = vs.reduce((s, v) => s + v.total, 0);
    const k = TARGET[6 - i] / sum;
    vs.forEach(v => { v.total = Math.round(v.total * k); v.impuesto = Math.round(v.impuesto * k * 100) / 100; v.costo_total = Math.round(v.costo_total * k);
      detalles.filter(x => x.venta_id === v.id).forEach(x => x.subtotal = Math.round(x.subtotal * k)); });
  }
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const productos = [];
  const CATS = ['Abarrotes', 'Granos', 'Abarrotes', 'Granos', 'Bebidas', 'Abarrotes', 'Limpieza', 'Bebidas', 'Lácteos', 'Abarrotes', 'Enlatados', 'Higiene'];
  PRODUCTOS.forEach(([n, pr], i) => productos.push({ id: i + 1, auth_user_id: UID, nombre: n, sku: 'DT-' + (1001 + i), categoria: CATS[i], precio: pr, costo: Math.round(pr * .72), tipo_precio: 'fijo', activo: true, unidad_medida: 'unidad', created_at: '2026-0' + (1 + i % 9) + '-10T10:00:00', tipo: 'producto', stock_actual: [4, 120, 85, 3, 240, 310, 160, 2, 95, 400, 5, 130][i], stock_minimo: [10, 20, 15, 10, 30, 40, 20, 12, 15, 50, 12, 20][i] }));
  for (let i = 0; i < 26; i++) productos.push({ id: 100 + i, auth_user_id: UID, nombre: ['Galletas Pozuelo','Atún Sardimar','Salsa de tomate','Detergente Ace','Cloro Magia Blanca','Mantequilla','Huevos cartón 30','Queso seco lb','Pan molde','Café molido 400g','Avena Quaker','Margarina','Fideos Maggi','Sopa Knorr','Leche en polvo','Jugo Del Valle','Agua 600ml','Refresco 12oz','Toallas cocina','Desinfectante','Shampoo','Pasta dental','Jabón tocador','Cereal','Chocolate','Harina trigo'][i], sku: 'DT-' + (2001 + i), categoria: 'Abarrotes', precio: 25 + Math.floor(rnd() * 200), costo: 0, tipo_precio: 'fijo', activo: true, unidad_medida: 'unidad', created_at: '2026-01-01T00:00:00', tipo: 'producto', stock_actual: 40 + Math.floor(rnd() * 300), stock_minimo: 10 });
  ['Entrega a domicilio', 'Instalación', 'Flete'].forEach((n, i) => productos.push({ id: 200 + i, auth_user_id: UID, nombre: n, tipo: 'servicio', activo: true, precio: [350, 500, 1800][i], created_at: '2026-01-01T00:00:00' }));
  const BIZ = ['Pulpería Doña Rosa', 'Abarrotes El Sol', 'Mini Súper Jireh', 'Tienda Don Carlos', 'Pulpería La Bendición', 'Comedor Mary', 'Ferretería Ruiz', 'Farmacia Central', 'Distribuidora Masaya', 'Panadería Lupita', 'Cafetería El Buen Sabor', 'Taller Hermanos López', 'Hotel Las Brisas', 'Restaurante La Terraza', 'Librería Escolar', 'Bodega San Judas', 'Súper Express León', 'Pulpería El Carmen', 'Abarrotería Ortiz', 'Tienda La Económica'];
  const FN = ['María', 'José', 'Ana', 'Luis', 'Carmen', 'Jorge', 'Rosa', 'Pedro', 'Martha', 'Juan', 'Elena', 'Carlos'], LN = ['López', 'Martínez', 'García', 'Rodríguez', 'Pérez', 'Hernández', 'Gutiérrez', 'Castillo', 'Rivas', 'Mendoza', 'Ortega', 'Sánchez'];
  const ymd0 = k => { const d = new Date(now); d.setDate(d.getDate() - k); return ymd(d); };
  const clientes = Array.from({ length: 148 }, (_, i) => { const nombre = i < BIZ.length ? BIZ[i] : FN[i % 12] + ' ' + LN[Math.floor(i / 12) % 12];
    const nc = i < 20 ? 6 + ((i * 7) % 18) : 1 + ((i * 5) % 9); const ago = i % 9 === 4 ? 35 + (i % 70) : (i * 3) % 25;
    return { id: i + 1, auth_user_id: UID, nombre, telefono: '8' + String(2200000 + i * 4129).slice(0, 7), correo: i < 20 ? nombre.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/ /g, '') + '@gmail.com' : null,
      empresa: i < 20 ? nombre : null, activo: true, tipo_cliente: 'normal', estado: nc >= 5 ? 'frecuente' : 'activo', num_compras: nc, total_compras: Math.round(nc * (900 + (i * 37) % 2600)),
      ultima_compra: ymd0(ago), primera_compra: ymd0(i >= 140 ? 2 + i % 7 : 120 + i), created_at: ymd0(i >= 140 ? 2 + i % 7 : 130 + i) + 'T10:00:00', ...(i >= 140 ? { estado: 'nuevo', num_compras: 1 } : {}) }; });
  Object.assign(clientes[3], { empresa: 'Mini Súper Jireh', correo: 'compras@minisuperjireh.com', ruc: 'J0310000123456', direccion: 'Barrio San José, de la iglesia 2 c. al sur, Managua', direccion_factura: 'Km 7 Carretera Norte, Bodega 3', fecha_aniversario: '2019-03-15', observaciones: 'Prefiere entregas por la mañana.', contactos: [{ nombre: 'Rosa Pérez', cargo: 'Dueña', contacto: '8888-1234' }, { nombre: 'Luis Pérez', cargo: 'Compras', contacto: '8777-5678' }] });
  // ---- Gastos (tutorial de Gastos). Hoy = 2026-10-10
  const GRows = [
    ['g01','2026-10-10','Combustible camión de reparto','Combustible','inmediato',2300,'activo',null,null,'10:05'],
    ['g02','2026-10-10','Recibo de luz de septiembre','Electricidad','inmediato',4850,'activo',null,'Unión Fenosa · NIS 2210345','09:12'],
    ['g03','2026-10-09','Publicidad en Facebook e Instagram','Publicidad','inmediato',1500,'activo',null,null,'16:40'],
    ['g04','2026-10-08','Agua potable ENACAL','Agua','inmediato',780,'activo',null,null,'11:20'],
    ['g05','2026-10-07','Mantenimiento del montacargas','Mantenimiento','inmediato',3200,'activo',null,'Cambio de aceite y frenos','15:02'],
    ['g06','2026-10-05','Alquiler de bodega','Alquiler','programado',12000,'activo',null,null,'08:00','gp1'],
    ['g07','2026-10-05','Internet fibra 100 Mb','Internet','programado',1350,'activo',null,null,'08:01','gp2'],
    ['g08','2026-10-03','Recolección de basura','Servicios','inmediato',450,'activo',null,null,'09:30'],
    ['g09','2026-09-30','Salario quincena','Salarios','programado',9500,'activo','Luis Hernández',null,'17:00','gp3'],
    ['g10','2026-09-30','Salario quincena','Salarios','programado',8000,'activo','Ana Gutiérrez',null,'17:01','gp4'],
    ['g11','2026-09-28','Papelería de oficina','Otros','inmediato',650,'cancelado',null,'Registrado dos veces','12:10'],
    ['g12','2026-09-25','Hosting de la tienda en línea','Hosting','inmediato',1100,'activo',null,null,'10:00'],
    ['g13','2026-09-20','Combustible camión de reparto','Combustible','inmediato',2150,'activo',null,null,'10:00'],
    ['g14','2026-09-15','Salario quincena','Salarios','programado',9500,'activo','Luis Hernández',null,'17:00','gp3'],
  ];
  const gastos = GRows.map(([id,f,c,cat,tipo,m,est,emp,obs,h,gp]) => ({ id, auth_user_id: UID, fecha: f, concepto: c, categoria: cat, tipo, monto: m, estado: est, empleado: emp, observaciones: obs, metodo_pago: tipo==='programado'?'Transferencia':'Efectivo', created_at: f+'T'+h+':00-06:00', gasto_programado_id: gp||null }));
  // meses anteriores (para el KPI del año), fuera de la primera página
  const MES = [[1,61200],[2,58400],[3,63900],[4,60100],[5,66750],[6,62300],[7,64800],[8,65950]];
  MES.forEach(([mm,tot]) => gastos.push({ id:'gm'+mm, auth_user_id: UID, fecha:`2026-${pad(mm)}-28`, concepto:'Gastos del mes', categoria:'Otros', tipo:'inmediato', monto: tot, estado:'activo', created_at:`2026-${pad(mm)}-28T10:00:00-06:00` }));
  const gastos_programados = [
    ['gp1','Alquiler de bodega','Alquiler',12000,'mensual','2026-11-05',true,null],
    ['gp2','Internet fibra 100 Mb','Internet',1350,'mensual','2026-10-11',true,null],
    ['gp3','Salario quincena','Salarios',9500,'quincenal','2026-10-10',true,'Luis Hernández'],
    ['gp4','Salario quincena','Salarios',8000,'quincenal','2026-10-09',true,'Ana Gutiérrez'],
    ['gp5','Seguro del camión de reparto','Servicios',2400,'trimestral','2026-10-13',true,null],
    ['gp6','Recolección de basura','Servicios',450,'mensual','2026-10-08',true,null],
    ['gp7','Licencia del software contable','Licencias',900,'anual','2027-02-01',true,null],
    ['gp8','Publicidad en radio','Publicidad',2000,'mensual','2026-10-20',false,null],
  ].map(([id,n,cat,m,fr,fp,act,emp]) => ({ id, auth_user_id: UID, nombre: n, categoria: cat, monto: m, frecuencia: fr, fecha_proxima: fp, activo: act, empleado: emp, metodo_pago: 'Transferencia', created_at: '2026-01-05' }));
  const historial_gastos = [{ auth_user_id: UID, gasto_programado_id: 'gp1', monto: 12000, fecha_pago: '2026-10-05' }, { auth_user_id: UID, gasto_programado_id: 'gp1', monto: 12000, fecha_pago: '2026-09-05' }];
  const d20 = new Date(now); d20.setDate(d20.getDate() + 18);

  const PROV = ['Distribuidora La Fe', 'Molinos de Nicaragua', 'Lácteos Centroamericanos', 'Café Soluble S.A.', 'Productos de Limpieza Xedex', 'Comercial El Granero'];
  const proveedores = PROV.map((n, i) => ({ id: 'pv' + (i + 1), auth_user_id: UID, nombre: n, activo: i !== 5, telefono: '8' + (1234567 + i * 1111), email: ['ventas@lafe.com.ni', 'pedidos@molinosnic.com', 'ventas@lacteosca.com', 'distribucion@cafesoluble.com.ni', 'ventas@xedex.com.ni', 'elgranero@gmail.com'][i], direccion: ['Managua, Carretera Norte km 6', 'Managua, Pista Suburbana', 'Matagalpa', 'Managua, Km 9 Carretera a Masaya', 'Managua, Zona Franca Las Mercedes', 'Masaya'][i], contacto: ['Luis', 'Ana', 'Pedro', 'María', 'José', 'Mario'][i], created_at: '2026-01-0' + (i + 1) + 'T00:00:00' }));
  const ymdB = k => { const d = new Date(now); d.setDate(d.getDate() - k); return ymd(d); };
  // [diasAtrás, proveedor, estado, método, [[productoId, cantidad, costo], ...], directa]
  const CMP = [[0, 0, 'completada', 'Efectivo', [[1, 48, 56], [10, 120, 20]]], [0, 3, 'completada', 'Transferencia', [[5, 60, 104]]],
    [1, 1, 'completada', 'Transferencia', [[2, 8, 1908], [6, 100, 30]]], [2, 2, 'pendiente', 'Transferencia', [[9, 20, 302]]],
    [3, 4, 'completada', 'Efectivo', [[7, 80, 49], [12, 30, 119]]], [4, 0, 'completada', 'Tarjeta', [[11, 144, 27], [8, 48, 47]]],
    [5, 1, 'anulada', 'Efectivo', [[4, 2, 2232]]], [6, 0, 'completada', 'Efectivo', [], 'Reparación de estantería de bodega', 3500],
    [7, 2, 'completada', 'Transferencia', [[9, 15, 302]]], [8, 4, 'completada', 'Efectivo', [[7, 60, 49]]], [9, 1, 'completada', 'Transferencia', [[3, 6, 828], [2, 4, 1908]]],
    [12, 0, 'completada', 'Efectivo', [[1, 36, 56]]], [16, 3, 'completada', 'Transferencia', [[5, 48, 104]]], [21, 2, 'completada', 'Tarjeta', [[9, 24, 302]]], [27, 1, 'completada', 'Transferencia', [[2, 10, 1908]]]];
  const detalle_compras = [];
  const compras = CMP.map(([k, pv, estado, mp, items, concepto, montoDir], i) => {
    const id = 'cmp' + (i + 1); let sub = 0;
    items.forEach(([pid, q, c], j) => { const P = PRODUCTOS[pid - 1]; sub += q * c; detalle_compras.push({ id: id + '-' + j, auth_user_id: UID, compra_id: id, producto_id: pid, producto_nombre: P[0], producto_sku: 'DT-' + (1000 + pid), cantidad: q, costo_unitario: c, descuento: 0, iva_porcentaje: 0, subtotal: q * c }); });
    if (montoDir) sub = montoDir;
    return { id, auth_user_id: UID, numero: 'C-' + String(240 - i).padStart(5, '0'), fecha: ymdB(k), created_at: ymdB(k) + 'T' + pad(15 - (i % 7)) + ':15:00', proveedor_id: proveedores[pv].id, proveedor_nombre: PROV[pv], subtotal: sub, descuento_total: 0, iva_monto: 0, iva_porcentaje: 0, total: sub, estado, metodo_pago_nombre: mp, usuario_nombre: 'Carlos Torres', es_directa: !!montoDir, concepto: concepto || null };
  });
  proveedores.forEach(p => { const cs = compras.filter(c => c.proveedor_id === p.id && c.estado !== 'anulada'); p.ultima_compra = cs.length ? cs[0].fecha : (p.id === 'pv6' ? '2026-05-14' : null); p.monto_acumulado = cs.reduce((s, c) => s + c.total, 0) + [212400, 386900, 148300, 96750, 74200, 18600][+p.id.slice(2) - 1]; });
  const OC = [['oc1', 'OC-0012', 0, 0, 'pendiente', [[1, 60, 56], [3, 10, 828], [10, 200, 20]]], ['oc2', 'OC-0011', 2, 2, 'pendiente', [[9, 30, 302]]], ['oc3', 'OC-0010', 5, 1, 'convertida', [[2, 8, 1908]]], ['oc4', 'OC-0009', 11, 3, 'cancelada', [[5, 24, 104]]]];
  const orden_compra_detalles = [];
  const ordenes_compra = OC.map(([id, numero, k, pv, estado, items]) => { const det = items.map(([pid, q, c], j) => ({ id: id + '-' + j, orden_compra_id: id, producto_id: pid, producto_nombre: PRODUCTOS[pid - 1][0], cantidad: q, costo_unitario: c, subtotal: q * c })); orden_compra_detalles.push(...det);
    return { id, auth_user_id: UID, numero, fecha: ymdB(k), created_at: ymdB(k) + 'T08:30:00', proveedor_id: proveedores[pv].id, proveedor_nombre: PROV[pv], total: det.reduce((s, d) => s + d.subtotal, 0), subtotal: det.reduce((s, d) => s + d.subtotal, 0), estado, orden_compra_detalles: det.map(d => ({ id: d.id })) }; });
  const DEN = (o) => o;
  const caja_chica_sesiones = [
    { id: 'cc0', auth_user_id: UID, fecha: '2026-10-10', estado: 'abierta', monto_apertura: 3000, abierta_por: 'Carlos Torres', abierta_en: '2026-10-10T07:55:00-06:00', denominacion_apertura: { NIO: { '1000': 1, '500': 2, '200': 3, '100': 3, '50': 2, '20': 5 } } },
  ];
  [['2026-10-09',3000,4200,4200],['2026-10-08',3000,5150,5100],['2026-10-07',2500,3880,3880],['2026-10-06',2500,4310,4350],['2026-10-05',2500,2950,2950],['2026-10-03',2500,3720,3720],['2026-10-02',2000,3105,3105]].forEach(([f,ap,te,re],i)=>caja_chica_sesiones.push({ id:'cch'+i, auth_user_id: UID, fecha:f, estado:'cerrada', monto_apertura:ap, monto_cierre_teorico:te, monto_cierre_real:re, diferencia: re-te, total_ingresos: Math.round((te-ap)*2.6+ap*1.9), total_egresos: Math.round((te-ap)*1.1+ap*1.4), total_ingresos_efectivo: te-ap+1200, total_egresos_efectivo: 1200, cantidad_movimientos: 9+i, abierta_por:'Carlos Torres', cerrada_por:'Carlos Torres', abierta_en: f+'T07:50:00-06:00', cerrada_en: f+'T18:30:00-06:00', denominacion_apertura: { NIO: { '1000': 1, '500': 2, '200': 2, '100': 3, '50': 2, '20': 5 } }, denominacion_cierre: { NIO: { '1000': 2, '500': 2, '200': 4, '100': 3, '50': 2, '20': 5, '10': 2, '5': 2 } } }));
  // ---- movimientos financieros (saldo encadenado)
  const MV = [
    ['2026-09-30','19:00','INGRESO','VENTA','Ventas del día',9400,'Efectivo','venta',null,null],
    ['2026-10-01','10:00','INGRESO','VENTA','Venta V-01431',5200,'Efectivo','venta'],
    ['2026-10-01','15:00','EGRESO','COMPRA','Compra C-00231 — Lácteos Centroamericanos',18600,'Transferencia','compra','b2','general'],
    ['2026-10-03','09:30','EGRESO','GASTO','Servicios: Recolección de basura',450,'Efectivo','gasto',null,'chica'],
    ['2026-10-03','12:00','INGRESO','VENTA','Venta V-01440',6300,'Efectivo','venta'],
    ['2026-10-05','08:00','EGRESO','GASTO','Alquiler: Alquiler de bodega',12000,'Transferencia','gasto','b1','general'],
    ['2026-10-05','08:01','EGRESO','GASTO','Internet: Internet fibra 100 Mb',1350,'Transferencia','gasto','b1','general'],
    ['2026-10-05','13:00','INGRESO','VENTA','Venta V-01447',9870,'Efectivo','venta'],
    ['2026-10-06','11:00','INGRESO','VENTA','Venta V-01452',8900,'Efectivo','venta'],
    ['2026-10-06','16:00','EGRESO','TRANSFERENCIA','Transferencia hacia LAFISE Bancentro — Fondos para pagos',5000,'Transferencia',null,'b1',null,'t2'],
    ['2026-10-06','16:00','INGRESO','TRANSFERENCIA','Transferencia desde BANPRO — Fondos para pagos',5000,'Transferencia',null,'b2',null,'t2'],
    ['2026-10-07','10:00','INGRESO','VENTA','Venta V-01458',7450,'Efectivo','venta'],
    ['2026-10-07','15:02','EGRESO','GASTO','Mantenimiento: Mantenimiento del montacargas',3200,'Efectivo','gasto',null,'chica'],
    ['2026-10-07','17:00','INGRESO','VENTA','Venta V-01461',4100,'Tarjeta','venta','b1'],
    ['2026-10-08','09:00','INGRESO','VENTA','Venta V-01466',6200,'Efectivo','venta'],
    ['2026-10-08','11:20','EGRESO','PAGO','Pago a proveedor — Molinos de Nicaragua',12500,'Transferencia','cuenta_por_pagar','b2','general'],
    ['2026-10-08','17:30','EGRESO','RETIRO','Retiro de caja — gastos del dueño',3000,'Efectivo',null,null,'general'],
    ['2026-10-09','09:15','INGRESO','VENTA','Venta V-01475',5640,'Efectivo','venta'],
    ['2026-10-09','10:40','INGRESO','VENTA','Venta V-01476',2950,'Tarjeta','venta','b3'],
    ['2026-10-09','12:00','INGRESO','PAGO_CREDITO','Abono de crédito — Mini Súper Jireh',3500,'Transferencia','credito','b1'],
    ['2026-10-09','14:00','INGRESO','CAPITAL_AGREGADO','Aporte del dueño',10000,'Efectivo',null,null,'general'],
    ['2026-10-09','17:00','EGRESO','PAGO_SALARIO','Pago de salario — Ana Gutiérrez',8000,'Transferencia','salario','b1','general'],
    ['2026-10-09','18:00','EGRESO','TRANSFERENCIA','Transferencia hacia BANPRO — Depósito de efectivo del día',15000,'Efectivo',null,null,'chica','t1'],
    ['2026-10-09','18:00','INGRESO','TRANSFERENCIA','Transferencia desde Caja Chica — Depósito de efectivo del día',15000,'Transferencia',null,'b1',null,'t1'],
    ['2026-10-10','08:30','INGRESO','VENTA','Venta V-01482',2300,'Efectivo','venta'],
    ['2026-10-10','09:10','INGRESO','VENTA','Venta V-01483',4850,'Tarjeta','venta','b1'],
    ['2026-10-10','09:12','EGRESO','GASTO','Electricidad: Recibo de luz de septiembre',4850,'Transferencia','gasto','b1','general'],
    ['2026-10-10','09:40','INGRESO','COBRO','Fiado cobrado — Pulpería Doña Rosa',1200,'Efectivo','fiado'],
    ['2026-10-10','10:05','EGRESO','GASTO','Combustible: Combustible camión de reparto',2300,'Efectivo','gasto',null,'chica'],
    ['2026-10-10','10:15','EGRESO','COMPRA','Compra C-00240 — Distribuidora La Fe',6240,'Efectivo','compra',null,'general'],
    ['2026-10-10','10:20','INGRESO','VENTA','Venta V-01484',3180,'Transferencia','venta','b2'],
  ];
  let saldoCadena = 132600;
  const movimientos_financieros = MV.map(([f,h,fl,tm,c,m,met,ref,bk,org,tid],i) => { const ant = saldoCadena; saldoCadena += fl==='INGRESO'?m:-m;
    return { id:'mf'+i, auth_user_id: UID, fecha:f, created_at:f+'T'+h+':00-06:00', tipo_flujo:fl, tipo_movimiento:tm, concepto:c, monto:m, metodo_pago_nombre:met, referencia_tipo:ref||null, banco_id:bk||null, origen_caja:org||null, transferencia_id:tid||null, es_reverso:false, estado:'completado', saldo_anterior:ant, saldo_resultante:saldoCadena, conciliado: i<12, monto_moneda_banco: bk==='b3'? Math.round(m/36.62*100)/100 : null }; });
  const cierres_caja = [['2026-10-09',152990,25090,23000],['2026-10-08',157290,6200,15500],['2026-10-07',149040,11550,3200],['2026-10-06',140140,8900,0],['2026-10-05',143620,9870,13350],['2026-10-03',137770,6300,450],['2026-10-01',142000,5200,18600]].map(([f,si,ing,eg],i)=>({ id:'cz'+i, auth_user_id: UID, fecha:f, tipo:'diario', saldo_inicial:si, total_ingresos:ing, total_egresos:eg, saldo_final:si+ing-eg, movimientos_count: 3+(i%4), automatico: i>2 }));
  cierres_caja.unshift({ id:'czm', auth_user_id: UID, fecha:'2026-09-30', tipo:'mensual', periodo_inicio:'2026-09-01', periodo_fin:'2026-09-30', saldo_inicial:118400, total_ingresos:248600, total_egresos:225000, saldo_final:142000, movimientos_count: 186, automatico: true });
  const conciliaciones_bancarias = [{ id:'cb1', auth_user_id: UID, banco_id:'b1', fecha:'2026-09-30', saldo_banco:85000, saldo_sistema:85000, diferencia:0, created_at:'2026-09-30T18:00:00-06:00' }];
  ventas.forEach((v, i) => { v.numero_venta = 'V-' + String(v.id).padStart(5, '0'); v.cliente_nombre = i % 4 ? ['Pulpería Doña Rosa', 'Abarrotes El Sol', 'Mini Súper Jireh', 'Tienda Don Carlos'][i % 4] : 'Consumidor Final'; v.metodo_pago = ['Efectivo', 'Tarjeta', 'Transferencia'][i % 3]; v.created_at = v.fecha; v.subtotal = v.total - v.impuesto; v.descuento = 0; });
  detalles.forEach(x => { x.precio = Math.round(x.subtotal / x.cantidad * 100) / 100; x.ganancia = Math.round(x.subtotal * .28); x.descuento = 0; });
  ventas.forEach(v => { v.metodo_pago_nombre = v.metodo_pago; v.ganancia = v.total - v.impuesto - v.costo_total; });
  const metodos_pago = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta']].map(([id, n], i) => ({ id, auth_user_id: UID, nombre: n, activo: true, orden: i, es_default: i === 0 }));
  const bancos = [['b1','BANPRO','NIO','1001-2203-4456',85000,2.5],['b2','LAFISE Bancentro','NIO','2104-8890-1123',40000,2.8],['b3','BAC Credomatic','USD','3200-5541-0098',2500,3]].map(([id,n,mon,cta,si,com],i)=>({ id, auth_user_id: UID, nombre: n, activo: true, moneda: mon, numero_cuenta: cta, saldo_inicial: si, comision_pos_pct: com, created_at: '2026-01-0'+(i+1) }));
  const precios_escala = [['e1', 'Detalle', 145], ['e2', 'Mayorista', 132], ['e3', 'Distribuidor', 125]].map(([id, n, pr], i) => ({ id, auth_user_id: UID, producto_id: 5, nombre: n, precio: pr, orden: i }));
  productos.find(x => x.id === 5).tipo_precio = 'escala';
  productos.find(x => x.id === 2).permite_fraccion = true;
  const ymdOff = k => { const d = new Date(now); d.setDate(d.getDate() + k); return ymd(d); };
  [[0, 'Comedor Mary', 2500, -3], [1, 'Ferretería Ruiz', 1800, 4], [2, 'Farmacia Central', 3200, 9], [3, 'Mini Súper Jireh', 1500, 15]].forEach(([i, n, m, k]) => Object.assign(clientes[i], { nombre: n, tipo_cliente: 'recurrente', frecuencia_pago: 'mensual', monto_recurrente: m, dia_pago: 5, fecha_proxima_pago: ymdOff(k), fecha_ultimo_pago: ymdOff(k - 30), saldo_pendiente: 0, telefono: '8' + (5550000 + i * 1234) }));
  productos.forEach(x => { if (x.tipo === 'producto' && !x.costo) x.costo = Math.round(x.precio * (.68 + rnd() * .1)); });
  const PRD = id => productos.find(x => x.id === id);
  const combos = [['cb1', 'Combo Desayuno', 'CB-001', 560], ['cb2', 'Paquete Limpieza Hogar', 'CB-002', 290], ['cb3', 'Canasta Básica', 'CB-003', 5690]].map(([id, n, sku, pr], i) => ({ id, auth_user_id: UID, nombre: n, sku, codigo_barras: '75012345' + (6780 + i), precio: pr, tipo_precio: 'fijo', activo: true, created_at: '2026-09-0' + (i + 1) + 'T10:00:00' }));
  const combo_items = [['cb1', 5, 1], ['cb1', 9, 1], ['cb1', 6, 1], ['cb2', 7, 2], ['cb2', 12, 1], ['cb3', 2, 1], ['cb3', 4, 1], ['cb3', 1, 2]].map(([c, pid, q], i) => ({ id: 'ci' + i, auth_user_id: UID, combo_id: c, producto_id: pid, cantidad: q, precio_unitario: PRD(pid).precio, productos: { nombre: PRD(pid).nombre, costo: PRD(pid).costo, activo: true } }));
  const promociones = [
    { id: 'pr1', auth_user_id: UID, nombre: '2x1 Gaseosa Rojita 3L', tipo: 'nxm_mismo', producto_id: 8, n_compra: 2, m_paga: 1, activo: true, fecha_inicio: ymd(now), fecha_fin: ymdOff(20), created_at: '2026-10-01' },
    { id: 'pr2', auth_user_id: UID, nombre: '3x2 Jabón Xedex', tipo: 'nxm_mismo', producto_id: 7, n_compra: 3, m_paga: 2, activo: true, fecha_inicio: null, fecha_fin: null, created_at: '2026-09-20' },
    { id: 'pr3', auth_user_id: UID, nombre: 'Arroz: 5% llevando 5 qq', tipo: 'descuento_cantidad', producto_id: 2, cantidad_minima: 5, descuento_porcentaje: 5, activo: true, fecha_inicio: ymd(now), fecha_fin: ymdOff(45), created_at: '2026-09-15' }];
  const producto_lotes = [[9, 'L-0815', 12, 18], [6, 'M-2290', 26, 40], [5, 'CP-551', 48, 22], [11, 'S-1011', 75, 60], [9, 'L-0902', 140, 30]].map(([pid, nl, d, q], i) => ({ id: 'lt' + i, auth_user_id: UID, producto_id: pid, numero_lote: nl, fecha_vencimiento: ymdOff(d), cantidad_actual: q, cantidad_inicial: q, activo: true, created_at: '2026-09-01', productos: { nombre: PRD(pid).nombre, sku: PRD(pid).sku } }));
  ventas.forEach(v => { v.id = String(v.id); }); detalles.forEach(d => { d.venta_id = String(d.venta_id); });
  const cliByName = {}; clientes.forEach(c => { if (!cliByName[c.nombre]) cliByName[c.nombre] = c.id; });
  ventas.forEach(v => { v.cliente_id = cliByName[v.cliente_nombre] || null; });
  const cliente_interacciones = [['mensaje', 'Pedido semanal confirmado', 'Confirmó 10 qq de arroz para el lunes.', 1], ['llamada', 'Consulta de precios mayoristas', 'Pidió lista de precios de aceite y azúcar.', 4], ['visita', 'Visita de ruta', 'Se cobró la factura V-01188.', 9], ['cotizacion', 'Cotización enviada', 'Proforma P-0045 por C$ 18,400.', 15]].map(([tipo, titulo, descripcion, k], i) => ({ id: 'in' + i, auth_user_id: UID, cliente_id: 4, tipo, titulo, descripcion, fecha: ymd0(k) + 'T10:30:00', registrado_por: 'Carlos Torres', created_at: ymd0(k) }));
  const puntos_saldos = [{ auth_user_id: UID, cliente_id: 4, saldo: 340 }];
  const DB = {
    cliente_interacciones, puntos_saldos,
    combos, combo_items, promociones, producto_lotes,
    metodos_pago, bancos, precios_escala,
    proveedores, compras, detalle_compras, ordenes_compra, orden_compra_detalles, caja_chica_sesiones,
    configuracion_empresa: [{ auth_user_id: UID, nombre_negocio: 'Distribuidora Torres', nombre_comercial: 'Distribuidora Torres', moneda: 'NIO',
      onboarding_completado: true, catalogo360_regalo_mostrado: true, maneja_lotes_vencimiento: true, usa_puntos: true, maneja_presentaciones: true, usa_numero_serie: true, tipo_negocio: 'distribuidora', tasa_cambio_usd: 36.62, metadata: {} }],
    usuarios: [{ auth_user_id: UID, nombre: 'Carlos', apellido: 'Torres', plan: 'premium', estado_cuenta: 'activa' }],
    ventas, venta_detalles: detalles, productos, clientes, gastos, gastos_programados, historial_gastos, categorias_gasto_personalizadas: [], retenciones_ir: [],
    movimientos_impuestos: [{ auth_user_id: UID, saldo_resultante: 4180.5, created_at: now.toISOString() }],
    movimientos_financieros, cierres_caja, conciliaciones_bancarias, capital_negocio: [{ auth_user_id: UID, monto: 120000, is_current: true }],
    activos_fijos: [{ id: 1, auth_user_id: UID, estado: 'activo', nombre: 'Camión Hino 2019', fecha_adquisicion: '2023-01-15', costo_adquisicion: 900000, valor_residual: 100000, vida_util_anos: 8, garantia_vencimiento: ymd(d20) }],
    tutoriales_vistos: [{ auth_user_id: UID, modulo_key: 'dashboard' }],
    notificaciones: [{ id: 1, created_at: now.toISOString() }, { id: 2, created_at: now.toISOString() }],
  };

  function Q(table) { this.t = table; this.f = []; this.opts = {}; this.single = 0; this.lim = null; this.ord = null; this.write = false; }
  const P = Q.prototype;
  const add = op => function (col, val) { this.f.push([op, col, val]); return this; };
  ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'like', 'ilike'].forEach(op => P[op] = add(op));
  P.select = function (_c, o) { if (o) this.opts = o; return this; };
  P.order = function (c, o) { this.ord = [c, o && o.ascending === false]; return this; };
  P.limit = function (n) { this.lim = n; return this; };
  P.range = function () { return this; };
  P.not = P.or = P.filter = P.match = P.contains = P.textSearch = function () { return this; };
  P.maybeSingle = function () { this.single = 1; return this; };
  P.single = function () { this.single = 2; return this; };
  P.insert = P.upsert = P.update = P.delete = function () { this.write = true; return this; };
  P.then = function (res, rej) { return Promise.resolve(this.run()).then(res, rej); };
  P.run = function () {
    if (this.write) return { data: null, error: null };
    if (this.t === 'tutoriales_vistos') return { data: this.single ? { modulo_key: 'visto' } : [{ modulo_key: 'visto' }], error: null };
    let rows = (DB[this.t] || []).filter(r => this.f.every(([op, c, v]) => {
      const x = r[c];
      if (x === undefined && c !== 'auth_user_id') return true;
      switch (op) {
        case 'eq': return x === undefined ? (c === 'auth_user_id') : (x === v || (x != null && v != null && String(x) === String(v)));
        case 'neq': return x !== v; case 'gte': return x >= v; case 'lte': return x <= v;
        case 'gt': return x > v; case 'lt': return x < v; case 'in': return v.includes(x);
        case 'is': return (x ?? null) === v; case 'ilike': return String(x ?? '').toLowerCase().includes(String(v).replace(/%/g,'').toLowerCase()); default: return true;
      }
    }));
    if (this.ord) { const [c, desc] = this.ord; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : -1) * (desc ? -1 : 1)); }
    if (this.lim) rows = rows.slice(0, this.lim);
    const count = rows.length;
    if (this.opts.head) return { data: null, count, error: null };
    if (this.single) return { data: rows[0] || null, error: null, count };
    return { data: rows, error: null, count };
  };
  const user = { id: UID, email: 'demo@negocio360oficial.com' };
  const session = { user, access_token: 'demo', expires_at: 9999999999 };
  const client = {
    from: t => new Q(t),
    rpc: name => Promise.resolve({ data: name === 'listar_perfiles_del_grupo' ? [{ id: 'p1', nombre: 'Admin', tipo: 'admin', modulos: [], codigo_configurado: false }] : null, error: null }),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }), signInWithPassword: async () => ({ data: { user, session }, error: null }),
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({}) }) },
  };
  window.supabase = { createClient: () => client };
  try {
    sessionStorage.setItem('n360_perfil_activo', JSON.stringify({ authUserId: UID, id: 'p1', nombre: 'Admin', tipo: 'admin', modulos: [] }));
    sessionStorage.setItem('n360_welcome_visto', '1');
    localStorage.setItem('n360_theme', 'light');
  } catch (_) {}
})();
