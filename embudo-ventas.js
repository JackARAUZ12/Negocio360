/* ============================================================
   EMBUDO DE VENTAS — Negocio360
   Cotizaciones (proformas) vs Ventas: cuántas se cotizan, cuántas
   avanzan, cuántas se venden, cuántas se pierden y por qué.
   Módulo de SOLO LECTURA: calcula todo con lo que ya existe
   (proformas, proforma_detalles, ventas, clientes). Se monta igual
   en Proformas y en Estadísticas:
     N360Embudo.montar('id-contenedor', { sb, userId, fmt, onAbrir })
   ============================================================ */
(function () {
  const PERIODOS = [
    ['hoy', 'Hoy'], ['7d', 'Últimos 7 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'],
    ['90d', 'Últimos 90 días'], ['anio', 'Este año'], ['rango', 'Rango de fechas…'],
  ];
  const MOTIVOS = {
    precio: 'Precio muy alto', competencia: 'Se fue con la competencia', sin_presupuesto: 'Sin presupuesto',
    cambio_idea: 'Cambió de idea', sin_respuesta: 'No respondió', otro: 'Otro motivo',
  };

  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoyISO = () => ymd(new Date());
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => Number(v) || 0;
  const r2 = n => Math.round(num(n) * 100) / 100;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  function rangoDe(clave, d1, d2) {
    const h = new Date(); const fin = ymd(h);
    if (clave === 'hoy') return { desde: fin, hasta: fin };
    if (clave === '7d') { const d = new Date(h); d.setDate(d.getDate() - 6); return { desde: ymd(d), hasta: fin }; }
    if (clave === '90d') { const d = new Date(h); d.setDate(d.getDate() - 89); return { desde: ymd(d), hasta: fin }; }
    if (clave === 'anio') return { desde: `${h.getFullYear()}-01-01`, hasta: fin };
    if (clave === 'mesant') {
      const a = new Date(h.getFullYear(), h.getMonth() - 1, 1), b = new Date(h.getFullYear(), h.getMonth(), 0);
      return { desde: ymd(a), hasta: ymd(b) };
    }
    if (clave === 'rango') return { desde: d1 || fin, hasta: d2 || fin };
    return { desde: ymd(new Date(h.getFullYear(), h.getMonth(), 1)), hasta: fin }; // 'mes'
  }

  /* ---------- Carga (paginada: la base entrega máx. 1000 filas por consulta) ---------- */
  async function paginar(construir) {
    const salida = []; const TAM = 1000;
    for (let desde = 0; desde < 50000; desde += TAM) {
      const { data, error } = await construir().range(desde, desde + TAM - 1);
      if (error) throw error;
      salida.push(...(data || []));
      if (!data || data.length < TAM) break;
    }
    return salida;
  }
  const trozos = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

  async function cargarDatos(sb, userId, desde, hasta) {
    const proformas = await paginar(() => sb.from('proformas')
      .select('id,numero_proforma,cliente_id,cliente_nombre,fecha,fecha_vencimiento,total,estado,venta_id,fecha_conversion,usuario_nombre,created_at,motivo_perdida,enviada_at')
      .eq('auth_user_id', userId).gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }));

    // Ventas enlazadas a esas proformas (para saber si de verdad se vendió, se anuló o se cobró)
    const idsVenta = [...new Set(proformas.map(p => p.venta_id).filter(Boolean))];
    let ventasEnlazadas = [];
    for (const lote of trozos(idsVenta, 150)) {
      const { data, error } = await sb.from('ventas').select('id,total,estado,estado_pago,proforma_id').in('id', lote);
      if (error) throw error;
      ventasEnlazadas.push(...(data || []));
    }

    // Todas las ventas del período: cuántas vinieron de una cotización y cuántas fueron directas
    const ventasPeriodo = await paginar(() => sb.from('ventas')
      .select('id,total,estado,proforma_id').eq('auth_user_id', userId).gte('fecha', desde).lte('fecha', hasta));

    // Productos cotizados
    const idsProf = proformas.filter(p => p.estado !== 'borrador').map(p => p.id);
    let detalles = [];
    for (const lote of trozos(idsProf, 100)) {
      const filas = await paginar(() => sb.from('proforma_detalles').select('proforma_id,producto_nombre,cantidad,subtotal').in('proforma_id', lote));
      detalles.push(...filas);
    }
    return { proformas, ventasEnlazadas, ventasPeriodo, detalles };
  }

  /* ---------- Cálculo ---------- */
  function calcular(datos) {
    const hoy = hoyISO();
    const ventaPorId = {}; datos.ventasEnlazadas.forEach(v => { ventaPorId[v.id] = v; });

    // Estado efectivo: una cotización abierta con fecha vencida cuenta como vencida.
    const efectivo = p => {
      if (['pendiente', 'enviada'].includes(p.estado) && p.fecha_vencimiento && p.fecha_vencimiento < hoy) return 'vencida';
      return p.estado;
    };
    const vendida = p => {
      if (!['convertida', 'pago_parcial'].includes(p.estado)) return false;
      const v = p.venta_id ? ventaPorId[p.venta_id] : null;
      return !(v && v.estado === 'anulada');
    };
    const cobrada = p => {
      if (p.estado !== 'convertida') return false;
      const v = p.venta_id ? ventaPorId[p.venta_id] : null;
      return !v || (v.estado !== 'anulada' && v.estado_pago !== 'credito');
    };
    const montoVendido = p => {
      const v = p.venta_id ? ventaPorId[p.venta_id] : null;
      return v && v.total != null ? num(v.total) : num(p.total);
    };

    const cotizadas = datos.proformas.filter(p => p.estado !== 'borrador');
    const borradores = datos.proformas.length - cotizadas.length;
    const sum = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));
    const montoCot = p => num(p.total);

    const avanzadas = cotizadas.filter(p => ['enviada', 'aprobada', 'convertida', 'pago_parcial'].includes(p.estado) || p.enviada_at);
    const aceptadas = cotizadas.filter(p => p.estado === 'aprobada' || vendida(p));
    const vendidas = cotizadas.filter(vendida);
    const cobradas = cotizadas.filter(cobrada);
    const perdidas = cotizadas.filter(p => ['rechazada'].includes(p.estado) || efectivo(p) === 'vencida' || (['convertida', 'pago_parcial'].includes(p.estado) && !vendida(p)));
    const abiertas = cotizadas.filter(p => ['pendiente', 'enviada', 'aprobada'].includes(p.estado) && efectivo(p) !== 'vencida');

    const etapas = [
      { clave: 'cotizadas', titulo: 'Cotizadas', ayuda: 'Cotizaciones emitidas (sin borradores)', n: cotizadas.length, monto: sum(cotizadas, montoCot) },
      { clave: 'avanzadas', titulo: 'Enviadas o aceptadas', ayuda: 'Ya llegaron al cliente', n: avanzadas.length, monto: sum(avanzadas, montoCot) },
      { clave: 'aceptadas', titulo: 'Aceptadas', ayuda: 'Aprobadas o ya compradas', n: aceptadas.length, monto: sum(aceptadas, montoCot) },
      { clave: 'vendidas', titulo: 'Vendidas', ayuda: 'Convertidas en venta (completa o con pago parcial)', n: vendidas.length, monto: sum(vendidas, montoVendido) },
      { clave: 'cobradas', titulo: 'Cobradas completas', ayuda: 'Venta pagada completa', n: cobradas.length, monto: sum(cobradas, montoVendido) },
    ];

    // Tiempo de cierre (días entre emitir y convertir)
    const dias = vendidas.map(p => {
      const a = new Date((p.fecha || '') + 'T12:00:00'), b = new Date(String(p.fecha_conversion || '').slice(0, 10) + 'T12:00:00');
      const d = Math.round((b - a) / 86400000);
      return isFinite(d) && d >= 0 ? d : null;
    }).filter(d => d != null);
    const diasProm = dias.length ? Math.round((dias.reduce((s, d) => s + d, 0) / dias.length) * 10) / 10 : null;

    const cerradas = vendidas.length + perdidas.length;
    const kpis = {
      tasaCantidad: pct(vendidas.length, cotizadas.length),
      tasaMonto: pct(sum(vendidas, montoVendido), sum(cotizadas, montoCot)),
      tasaGanadas: pct(vendidas.length, cerradas),
      diasProm,
      enElAire: sum(abiertas, montoCot), nEnElAire: abiertas.length,
      montoCotizado: sum(cotizadas, montoCot), montoVendido: sum(vendidas, montoVendido),
    };

    // Ventas del período: desde cotización vs directas
    const ventasOk = datos.ventasPeriodo.filter(v => v.estado !== 'anulada');
    const deCot = ventasOk.filter(v => v.proforma_id);
    const directas = ventasOk.filter(v => !v.proforma_id);
    const origen = {
      total: ventasOk.length, montoTotal: sum(ventasOk, v => num(v.total)),
      nCot: deCot.length, montoCot: sum(deCot, v => num(v.total)),
      nDirectas: directas.length, montoDirectas: sum(directas, v => num(v.total)),
    };

    // Motivos de pérdida
    const rechazadas = cotizadas.filter(p => p.estado === 'rechazada');
    const motivos = {};
    rechazadas.forEach(p => { const k = p.motivo_perdida && MOTIVOS[p.motivo_perdida] ? p.motivo_perdida : (p.motivo_perdida ? 'otro' : 'sin_dato'); motivos[k] = (motivos[k] || 0) + 1; });
    const nVencidas = cotizadas.filter(p => efectivo(p) === 'vencida').length;

    // Agrupar
    const agrupar = (clave) => {
      const m = {};
      cotizadas.forEach(p => {
        const k = clave(p) || '—';
        const o = m[k] || (m[k] = { nombre: k, cot: 0, vend: 0, montoCot: 0, montoVend: 0 });
        o.cot++; o.montoCot += montoCot(p);
        if (vendida(p)) { o.vend++; o.montoVend += montoVendido(p); }
      });
      return Object.values(m).map(o => ({ ...o, montoCot: r2(o.montoCot), montoVend: r2(o.montoVend), tasa: pct(o.vend, o.cot) }));
    };
    const porVendedor = agrupar(p => p.usuario_nombre).sort((a, b) => b.montoVend - a.montoVend || b.cot - a.cot);
    const sinVenta = agrupar(p => p.cliente_nombre).filter(o => o.vend === 0).sort((a, b) => b.montoCot - a.montoCot).slice(0, 10);

    // Productos cotizados vs vendidos
    const estadoPorId = {}; cotizadas.forEach(p => { estadoPorId[p.id] = vendida(p); });
    const prod = {};
    datos.detalles.forEach(d => {
      if (!(d.proforma_id in estadoPorId)) return;
      const o = prod[d.producto_nombre] || (prod[d.producto_nombre] = { nombre: d.producto_nombre || '—', cot: 0, vend: 0 });
      o.cot += num(d.subtotal); if (estadoPorId[d.proforma_id]) o.vend += num(d.subtotal);
    });
    const porProducto = Object.values(prod).map(o => ({ ...o, cot: r2(o.cot), vend: r2(o.vend), tasa: pct(o.vend, o.cot) })).sort((a, b) => b.cot - a.cot).slice(0, 10);

    // Seguimiento: abiertas con tiempo sin cerrar + vencidas recientes
    const antiguedad = p => { const d = Math.round((new Date(hoy + 'T12:00:00') - new Date((p.fecha || hoy) + 'T12:00:00')) / 86400000); return isFinite(d) ? d : 0; };
    const seguimiento = cotizadas
      .filter(p => ['pendiente', 'enviada'].includes(p.estado) || efectivo(p) === 'vencida')
      .filter(p => !['rechazada', 'convertida', 'pago_parcial', 'aprobada'].includes(p.estado))
      .map(p => ({ id: p.id, numero: p.numero_proforma, cliente_id: p.cliente_id, cliente: p.cliente_nombre || 'Cliente', total: num(p.total), dias: antiguedad(p), vencida: efectivo(p) === 'vencida', estado: p.estado }))
      .sort((a, b) => b.total - a.total).slice(0, 15);

    return {
      etapas, kpis, origen, borradores, motivos, nVencidas, nRechazadas: rechazadas.length,
      perdidas: { n: perdidas.length, monto: sum(perdidas, montoCot) }, abiertas: { n: abiertas.length, monto: sum(abiertas, montoCot) },
      porVendedor, sinVenta, porProducto, seguimiento,
    };
  }

  /* ---------- Presentación ---------- */
  function estilos() {
    if (document.getElementById('ev-estilos')) return;
    const s = document.createElement('style'); s.id = 'ev-estilos';
    s.textContent = `
      .ev-wrap{display:flex;flex-direction:column;gap:16px;min-width:0}
      .ev-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .ev-toolbar select,.ev-toolbar input{padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--bg-surface);color:var(--text-primary);font-family:inherit;font-size:13px}
      .ev-nota{font-size:12px;color:var(--text-muted)}
      .ev-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
      .ev-kpi{background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px;min-width:0}
      .ev-kpi b{display:block;font-size:22px;font-weight:800;color:var(--text-primary);line-height:1.15;overflow-wrap:anywhere}
      .ev-kpi span{display:block;font-size:12px;color:var(--text-secondary);margin-top:4px}
      .ev-kpi small{display:block;font-size:11px;color:var(--text-muted);margin-top:2px}
      .ev-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;min-width:0}
      .ev-card h3{font-size:14px;font-weight:800;color:var(--text-primary);margin:0 0 12px}
      .ev-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .ev-etapa{margin-bottom:12px}
      .ev-etapa-top{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px;margin-bottom:5px}
      .ev-etapa-top b{color:var(--text-primary)}
      .ev-etapa-top span{color:var(--text-secondary);font-size:12px}
      .ev-barra{height:26px;border-radius:8px;background:var(--bg-hover,#f0f0f5);overflow:hidden}
      .ev-barra i{display:block;height:100%;border-radius:8px;background:var(--accent);min-width:3px;transition:width .4s}
      .ev-paso{font-size:11px;color:var(--text-muted);margin:3px 0 0 2px}
      .ev-perdidas i{background:var(--danger,#ef4444)}.ev-abiertas i{background:var(--warning,#f59e0b)}
      .ev-tabla-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
      .ev-tabla{width:100%;border-collapse:collapse;font-size:13px}
      .ev-tabla th{text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
      .ev-tabla td{padding:8px;border-bottom:1px solid var(--border);color:var(--text-primary)}
      .ev-tabla td.r,.ev-tabla th.r{text-align:right;white-space:nowrap}
      .ev-vacio{font-size:13px;color:var(--text-muted);padding:6px 0}
      .ev-fila{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:7px 0;border-bottom:1px solid var(--border)}
      .ev-fila:last-child{border-bottom:none}
      .ev-btn{padding:5px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface);color:var(--text-primary);font-size:12px;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-block}
      .ev-btn:hover{border-color:var(--accent);color:var(--accent)}
      .ev-etq{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--bg-hover,#f0f0f5);color:var(--text-secondary)}
      .ev-etq.rojo{background:var(--danger-soft,#fef2f2);color:var(--danger,#ef4444)}
      @media (max-width:760px){.ev-grid2{grid-template-columns:1fr}.ev-card{padding:14px}.ev-kpi b{font-size:19px}}
    `;
    document.head.appendChild(s);
  }

  function html(r, fmt, rango) {
    const E = r.etapas;
    const base = E[0].n || 0;
    const funnel = E.map((e, i) => {
      const w = base > 0 ? Math.max(2, Math.round((e.n / base) * 100)) : 0;
      const paso = i === 0 ? '' : `<div class="ev-paso">↳ ${pct(e.n, E[i - 1].n)}% de la etapa anterior · ${pct(e.n, base)}% del total</div>`;
      return `<div class="ev-etapa"><div class="ev-etapa-top"><b>${esc(e.titulo)}</b><span>${e.n} · ${esc(fmt(e.monto))}</span></div>
        <div class="ev-barra" title="${esc(e.ayuda)}"><i style="width:${w}%"></i></div>${paso}</div>`;
    }).join('');
    const lado = (clase, titulo, o) => `<div class="ev-etapa"><div class="ev-etapa-top"><b>${titulo}</b><span>${o.n} · ${esc(fmt(o.monto))}</span></div>
      <div class="ev-barra ${clase}"><i style="width:${base > 0 ? Math.max(o.n ? 2 : 0, Math.round((o.n / base) * 100)) : 0}%"></i></div></div>`;

    const k = r.kpis;
    const kpis = `
      <div class="ev-kpi"><b>${k.tasaCantidad}%</b><span>Tasa de cierre</span><small>${E[3].n} de ${E[0].n} cotizaciones</small></div>
      <div class="ev-kpi"><b>${k.tasaMonto}%</b><span>Cierre en dinero</span><small>${esc(fmt(k.montoVendido))} de ${esc(fmt(k.montoCotizado))}</small></div>
      <div class="ev-kpi"><b>${k.tasaGanadas}%</b><span>Ganadas vs perdidas</span><small>solo cotizaciones ya resueltas</small></div>
      <div class="ev-kpi"><b>${k.diasProm == null ? '—' : k.diasProm + ' d'}</b><span>Días promedio para cerrar</span><small>de emitir a vender</small></div>
      <div class="ev-kpi"><b>${esc(fmt(k.enElAire))}</b><span>En el aire</span><small>${k.nEnElAire} cotizaciones esperando respuesta</small></div>`;

    const o = r.origen;
    const origen = `
      <div class="ev-fila"><span>Ventas del período</span><b>${o.total} · ${esc(fmt(o.montoTotal))}</b></div>
      <div class="ev-fila"><span>Vinieron de una cotización</span><b>${o.nCot} · ${esc(fmt(o.montoCot))} (${pct(o.montoCot, o.montoTotal)}%)</b></div>
      <div class="ev-fila"><span>Ventas directas</span><b>${o.nDirectas} · ${esc(fmt(o.montoDirectas))} (${pct(o.montoDirectas, o.montoTotal)}%)</b></div>`;

    const filasMotivo = Object.entries(r.motivos).sort((a, b) => b[1] - a[1])
      .map(([k2, n]) => `<div class="ev-fila"><span>${esc(k2 === 'sin_dato' ? 'Sin motivo registrado' : MOTIVOS[k2])}</span><b>${n}</b></div>`).join('');
    const motivos = `${filasMotivo || '<div class="ev-vacio">Ninguna cotización rechazada en este período.</div>'}
      <div class="ev-fila"><span>Vencidas sin respuesta</span><b>${r.nVencidas}</b></div>`;

    const tabla = (cab, filas, vacio) => filas.length
      ? `<div class="ev-tabla-wrap"><table class="ev-tabla"><thead><tr>${cab.map((c, i) => `<th class="${i ? 'r' : ''}">${c}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody></table></div>`
      : `<div class="ev-vacio">${vacio}</div>`;

    const vend = tabla(['Vendedor', 'Cotizó', 'Vendió', 'Cierre', 'Cotizado', 'Vendido'],
      r.porVendedor.map(v => `<tr><td>${esc(v.nombre)}</td><td class="r">${v.cot}</td><td class="r">${v.vend}</td><td class="r">${v.tasa}%</td><td class="r">${esc(fmt(v.montoCot))}</td><td class="r">${esc(fmt(v.montoVend))}</td></tr>`),
      'Sin cotizaciones en este período.');
    const sinv = tabla(['Cliente', 'Cotizaciones', 'Monto'],
      r.sinVenta.map(v => `<tr><td>${esc(v.nombre)}</td><td class="r">${v.cot}</td><td class="r">${esc(fmt(v.montoCot))}</td></tr>`),
      'Todos los clientes que cotizaron ya compraron algo. 🎉');
    const prods = tabla(['Producto', 'Cotizado', 'Vendido', 'Cierre'],
      r.porProducto.map(v => `<tr><td>${esc(v.nombre)}</td><td class="r">${esc(fmt(v.cot))}</td><td class="r">${esc(fmt(v.vend))}</td><td class="r">${v.tasa}%</td></tr>`),
      'Sin productos cotizados en este período.');
    const seg = r.seguimiento.length
      ? `<div class="ev-tabla-wrap"><table class="ev-tabla"><thead><tr><th>Cotización</th><th>Cliente</th><th class="r">Monto</th><th class="r">Días</th><th></th></tr></thead><tbody>${
        r.seguimiento.map(s => `<tr><td>${esc(s.numero || '')} ${s.vencida ? '<span class="ev-etq rojo">vencida</span>' : ''}</td><td>${esc(s.cliente)}</td><td class="r">${esc(fmt(s.total))}</td><td class="r">${s.dias}</td>
          <td class="r"><button type="button" class="ev-btn" data-ev-abrir="${esc(s.id)}">Abrir</button> <button type="button" class="ev-btn" data-ev-wa="${esc(s.id)}">WhatsApp</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="ev-vacio">No hay cotizaciones pendientes de seguimiento. ✅</div>';

    return `
      <div class="ev-nota">Cotizaciones creadas del ${esc(rango.desde)} al ${esc(rango.hasta)}${r.borradores ? ` · ${r.borradores} borrador(es) no cuentan` : ''}. Las ventas se miden por la cotización de origen.</div>
      <div class="ev-kpis">${kpis}</div>
      <div class="ev-card"><h3>Embudo: de cotización a venta</h3>${funnel}
        <div class="ev-grid2" style="margin-top:6px">${lado('ev-abiertas', 'Abiertas (esperando)', r.abiertas)}${lado('ev-perdidas', 'Perdidas (rechazadas o vencidas)', r.perdidas)}</div></div>
      <div class="ev-grid2">
        <div class="ev-card"><h3>Ventas: con cotización vs directas</h3>${origen}</div>
        <div class="ev-card"><h3>Por qué se pierden</h3>${motivos}</div>
      </div>
      <div class="ev-card"><h3>Por vendedor</h3>${vend}</div>
      <div class="ev-grid2">
        <div class="ev-card"><h3>Cotizan pero no compran</h3>${sinv}</div>
        <div class="ev-card"><h3>Productos: cotizado vs vendido</h3>${prods}</div>
      </div>
      <div class="ev-card"><h3>Para dar seguimiento</h3>${seg}</div>`;
  }

  async function montar(idContenedor, opts) {
    const cont = document.getElementById(idContenedor);
    if (!cont) return;
    estilos();
    const sb = opts.sb, userId = opts.userId;
    const fmt = opts.fmt || (n => String(n));
    const estado = { clave: 'mes', d1: '', d2: '', seq: 0, ultimo: null };

    cont.innerHTML = `<div class="ev-wrap">
      <div class="ev-toolbar">
        <select data-ev-periodo>${PERIODOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        <input type="date" data-ev-d1 style="display:none"/><input type="date" data-ev-d2 style="display:none"/>
        <button type="button" class="ev-btn" data-ev-refrescar>↻ Actualizar</button>
      </div>
      <div data-ev-cuerpo><div class="ev-vacio">Calculando…</div></div></div>`;
    const $ = s => cont.querySelector(s);

    async function recargar() {
      const miSeq = ++estado.seq;
      const rg = rangoDe(estado.clave, estado.d1, estado.d2);
      $('[data-ev-cuerpo]').innerHTML = '<div class="ev-vacio">Calculando…</div>';
      try {
        const datos = await cargarDatos(sb, userId, rg.desde, rg.hasta);
        if (miSeq !== estado.seq) return;
        const res = calcular(datos);
        estado.ultimo = { res, datos };
        $('[data-ev-cuerpo]').innerHTML = html(res, fmt, rg);
      } catch (e) {
        console.error('embudo:', e);
        if (miSeq === estado.seq) $('[data-ev-cuerpo]').innerHTML = '<div class="ev-vacio">No se pudo calcular el embudo. Revisa tu conexión e inténtalo de nuevo.</div>';
      }
    }

    $('[data-ev-periodo]').addEventListener('change', e => {
      estado.clave = e.target.value;
      const esRango = estado.clave === 'rango';
      $('[data-ev-d1]').style.display = $('[data-ev-d2]').style.display = esRango ? '' : 'none';
      if (!esRango) recargar();
    });
    $('[data-ev-d1]').addEventListener('change', e => { estado.d1 = e.target.value; if (estado.d2) recargar(); });
    $('[data-ev-d2]').addEventListener('change', e => { estado.d2 = e.target.value; if (estado.d1) recargar(); });
    $('[data-ev-refrescar]').addEventListener('click', recargar);

    cont.addEventListener('click', async ev => {
      const ab = ev.target.closest('[data-ev-abrir]');
      if (ab && opts.onAbrir) { opts.onAbrir(ab.getAttribute('data-ev-abrir')); return; }
      const wa = ev.target.closest('[data-ev-wa]');
      if (wa && estado.ultimo) {
        const s = estado.ultimo.res.seguimiento.find(x => x.id === wa.getAttribute('data-ev-wa'));
        if (!s) return;
        let tel = '';
        try {
          if (s.cliente_id) {
            const { data } = await sb.from('clientes').select('telefono,whatsapp').eq('id', s.cliente_id).maybeSingle();
            tel = String(data?.whatsapp || data?.telefono || '').replace(/\D/g, '');
          }
        } catch (_) { /* sin teléfono: se abre WhatsApp sin número */ }
        if (tel && tel.length === 8) tel = '505' + tel; // Nicaragua
        const texto = `Hola ${s.cliente}, te escribo para dar seguimiento a la cotización ${s.numero || ''} por ${fmt(s.total)}. ¿Pudiste revisarla? Quedo atento.`;
        window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      }
    });

    await recargar();
  }

  /* Tarjeta compacta para el Dashboard: tasa de cierre del mes. Se oculta sola si no hay cotizaciones. */
  async function resumen(idContenedor, opts) {
    const cont = document.getElementById(idContenedor);
    if (!cont) return;
    try {
      const rg = rangoDe('mes');
      const datos = await cargarDatos(opts.sb, opts.userId, rg.desde, rg.hasta);
      const r = calcular(datos);
      if (!r.etapas[0].n) { cont.style.display = 'none'; return; }
      const fmt = opts.fmt || (n => String(n));
      cont.innerHTML = `<div class="kpi-card kpi-card-clickable" style="margin-top:14px" onclick="location.href='estadisticas.html'">
        <div class="kpi-body">
          <div class="kpi-label">Cotizaciones vs ventas · este mes</div>
          <div class="kpi-value">${r.kpis.tasaCantidad}% <span style="font-size:13px;font-weight:600;color:var(--text-secondary)">de cierre</span></div>
          <div class="kpi-delta neutral">${r.etapas[3].n} vendidas de ${r.etapas[0].n} cotizadas · ${r.abiertas.n} en el aire (${esc(fmt(r.abiertas.monto))})</div>
        </div></div>`;
      cont.style.display = '';
    } catch (e) { cont.style.display = 'none'; }
  }

  window.N360Embudo = { montar, resumen, calcular, rangoDe, MOTIVOS };
})();
