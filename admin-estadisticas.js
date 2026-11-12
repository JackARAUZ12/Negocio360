/* ============================================================
   ADMIN-ESTADISTICAS.JS — Negocio360 · Panel de administración
   Sección "Estadísticas de clientes": activos vs suspendidos, clientes
   nuevos por mes (y cuántos de ellos siguen activos), cobros de
   suscripción, qué tan seguido entran, suspendidos por tiempo sin pagar
   e historial de suspensiones/reactivaciones.
   SOLO LEE datos. No cambia cuentas, pagos ni estados.
   Usa las mismas exclusiones que el Dashboard (sucursales/bodegas
   internas y cuentas independientes de Catálogo360 no son clientes).
   ============================================================ */
(function () {
  'use strict';
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = n => Number(n || 0).toLocaleString('es-NI');
  const usd = n => '$' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;
  const DIA = 86400000;
  const claveMes = d => d.getFullYear() * 12 + d.getMonth();
  const nombreMes = (k, largo) => largo ? `${MESES_L[k % 12]} ${Math.floor(k / 12)}` : `${MESES[k % 12]} ${String(Math.floor(k / 12)).slice(2)}`;

  const E = { datos: null, rango: 6, cargando: false, buscar: '', orden: 'dias' };
  let tip = null;

  /* ---------------- Datos ---------------- */
  async function obtener() {
    const [uRes, pRes, hRes] = await Promise.all([
      sb.from('usuarios').select('auth_user_id, nombre, apellido, nombre_negocio, email, estado_cuenta, plan, created_at, fecha_ultimo_pago, ultima_conexion, ciclo_facturacion'),
      sb.from('plataforma_pagos').select('auth_user_id, ciclo, monto, moneda, created_at'),
      sb.from('admin_estado_cuenta_historial').select('auth_user_id, estado_anterior, estado_nuevo, created_at').order('created_at', { ascending: false }).limit(500),
    ]);
    if (uRes.error) throw uRes.error;
    const shadow = await obtenerIdsSucursalesShadow();
    const c360 = await obtenerIdsClientesC360Independientes();
    const clientes = (uRes.data || []).filter(u => u.auth_user_id && !shadow.has(u.auth_user_id) && !c360.has(u.auth_user_id)
      && !/@negocio360\.internal$/i.test(u.email || ''));
    const ids = new Set(clientes.map(u => u.auth_user_id));
    const pagos = (pRes.error ? [] : (pRes.data || [])).filter(p => ids.has(p.auth_user_id));
    const historial = (hRes.error ? [] : (hRes.data || [])).filter(h => ids.has(h.auth_user_id));
    return { clientes, pagos, historial, pagosOk: !pRes.error, historialOk: !hRes.error, hora: new Date() };
  }

  function calcular(D) {
    const hoy = new Date();
    const kHoy = claveMes(hoy);
    const C = D.clientes;
    const activos = C.filter(u => u.estado_cuenta === 'activa');
    const suspendidos = C.filter(u => u.estado_cuenta === 'suspendida');
    const cancelados = C.filter(u => u.estado_cuenta === 'cancelada');
    const otros = C.length - activos.length - suspendidos.length - cancelados.length;
    const fecha = s => s ? new Date(s) : null;

    // Clientes nuevos por mes (cohorte): cuántos entraron y cómo están HOY
    const primerMes = C.reduce((m, u) => { const d = fecha(u.created_at); return d ? Math.min(m, claveMes(d)) : m; }, kHoy);
    const desde = E.rango === 0 ? primerMes : Math.max(primerMes, kHoy - E.rango + 1);
    const meses = [];
    for (let k = desde; k <= kHoy; k++) meses.push({ k, activos: 0, suspendidos: 0, otros: 0, total: 0, cobrado: 0, cobros: 0 });
    const idxMes = k => k - desde;
    C.forEach(u => {
      const d = fecha(u.created_at); if (!d) return;
      const m = meses[idxMes(claveMes(d))]; if (!m) return;
      m.total++;
      if (u.estado_cuenta === 'activa') m.activos++; else if (u.estado_cuenta === 'suspendida') m.suspendidos++; else m.otros++;
    });
    D.pagos.forEach(p => {
      const d = fecha(p.created_at); if (!d) return;
      const m = meses[idxMes(claveMes(d))]; if (!m) return;
      m.cobrado += Number(p.monto) || 0; m.cobros++;
    });

    const nuevosMes = C.filter(u => { const d = fecha(u.created_at); return d && claveMes(d) === kHoy; }).length;
    const nuevosAnt = C.filter(u => { const d = fecha(u.created_at); return d && claveMes(d) === kHoy - 1; }).length;
    const cobradoMes = D.pagos.filter(p => { const d = fecha(p.created_at); return d && claveMes(d) === kHoy; }).reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const cobradoAnt = D.pagos.filter(p => { const d = fecha(p.created_at); return d && claveMes(d) === kHoy - 1; }).reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const pagaronMes = new Set(D.pagos.filter(p => { const d = fecha(p.created_at); return d && claveMes(d) === kHoy; }).map(p => p.auth_user_id)).size;

    // Retención: de los que ya tienen más de 30 días, cuántos siguen activos
    const maduros = C.filter(u => { const d = fecha(u.created_at); return d && (hoy - d) > 30 * DIA; });
    const madurosAct = maduros.filter(u => u.estado_cuenta === 'activa').length;

    // Qué tan seguido entran los ACTIVOS
    const act = [
      { id: 'hoy', nombre: 'Hoy', n: 0 }, { id: '1-3', nombre: 'Hace 1 a 3 días', n: 0 }, { id: '4-7', nombre: 'Hace 4 a 7 días', n: 0 },
      { id: '8-30', nombre: 'Hace 8 a 30 días', n: 0 }, { id: '30+', nombre: 'Hace más de 30 días', n: 0 }, { id: 'nunca', nombre: 'Nunca han entrado', n: 0, neutro: true },
    ];
    activos.forEach(u => {
      const d = fecha(u.ultima_conexion);
      if (!d) { act[5].n++; return; }
      const dias = Math.floor((hoy - d) / DIA);
      if (d.toDateString() === hoy.toDateString()) act[0].n++;
      else if (dias <= 3) act[1].n++; else if (dias <= 7) act[2].n++; else if (dias <= 30) act[3].n++; else act[4].n++;
    });

    // Suspendidos: tiempo desde su último pago (o desde que se registraron si nunca pagaron)
    const listaSus = suspendidos.map(u => {
      const base = fecha(u.fecha_ultimo_pago) || fecha(u.created_at);
      const dias = base ? Math.max(0, Math.floor((hoy - base) / DIA)) : null;
      const ultCon = fecha(u.ultima_conexion);
      return { u, dias, nuncaPago: !u.fecha_ultimo_pago, diasCon: ultCon ? Math.floor((hoy - ultCon) / DIA) : null };
    });
    const sus = [
      { nombre: 'Menos de 30 días', n: 0 }, { nombre: '30 a 60 días', n: 0 }, { nombre: '61 a 90 días', n: 0 }, { nombre: 'Más de 90 días', n: 0 },
    ];
    listaSus.forEach(s => { const d = s.dias ?? 0; sus[d < 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3].n++; });
    const susNuncaPago = listaSus.filter(s => s.nuncaPago).length;

    // Historial (desde que existe el registro)
    const hist = D.historial;
    const suspMes = hist.filter(h => h.estado_nuevo === 'suspendida' && claveMes(new Date(h.created_at)) === kHoy).length;
    const reacMes = hist.filter(h => h.estado_anterior === 'suspendida' && h.estado_nuevo === 'activa' && claveMes(new Date(h.created_at)) === kHoy).length;

    // Mejor mes de clientes nuevos (en el rango)
    const mejor = meses.reduce((b, m) => (m.total > (b ? b.total : -1) ? m : b), null);

    return { total: C.length, activos, suspendidos, cancelados, otros, meses, nuevosMes, nuevosAnt, cobradoMes, cobradoAnt, pagaronMes,
      maduros: maduros.length, madurosAct, act, sus, listaSus, susNuncaPago, hist, suspMes, reacMes, mejor, kHoy };
  }

  /* ---------------- Gráficos (SVG a la medida del contenedor) ---------------- */
  function ancho(el) { return Math.max(260, Math.floor(el.clientWidth || 600)); }

  function barrasApiladas(el, R) {
    const W = ancho(el), movil = W < 520;
    const H = movil ? 230 : 270, padL = 34, padR = 8, padT = 22, padB = 30;
    const meses = R.meses, n = meses.length;
    const max = Math.max(1, ...meses.map(m => m.total));
    const paso = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
    const tope = Math.ceil(max / paso) * paso;
    const iw = W - padL - padR, ih = H - padT - padB;
    const col = iw / n, bw = Math.min(46, col * 0.62);
    const y = v => padT + ih - (v / tope) * ih;
    let g = '';
    for (let v = 0; v <= tope; v += paso) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="est-grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="est-eje" text-anchor="end">${v}</text>`;
    let b = '';
    const cadaEtiqueta = n > 8 && movil ? 2 : 1;
    meses.forEach((m, i) => {
      const cx = padL + col * i + col / 2, x = cx - bw / 2;
      const hA = (m.activos / tope) * ih, hS = ((m.suspendidos + m.otros) / tope) * ih;
      const yBase = padT + ih;
      const gap = hA > 0 && hS > 0 ? 2 : 0;
      // segmento inferior: siguen activos; superior: hoy suspendidos/cancelados
      if (hA > 0) b += rectRedondo(x, yBase - hA, bw, hA, hS > 0 ? 0 : 4, 'est-act');
      if (hS > 0) b += rectRedondo(x, yBase - hA - gap - hS, bw, hS, 4, 'est-sus');
      if (m.total > 0) b += `<text x="${cx}" y="${yBase - hA - gap - hS - 6}" class="est-valor" text-anchor="middle">${m.total}</text>`;
      if (i % cadaEtiqueta === 0 || i === n - 1) b += `<text x="${cx}" y="${H - 10}" class="est-eje" text-anchor="middle">${esc(nombreMes(m.k))}</text>`;
      b += `<rect x="${padL + col * i}" y="${padT}" width="${col}" height="${ih}" class="est-hit" data-i="${i}"/>`;
    });
    el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Clientes nuevos por mes">${g}<line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" class="est-base"/>${b}</svg>`;
    el.querySelectorAll('.est-hit').forEach(h => conTip(h, () => {
      const m = meses[+h.dataset.i];
      return `<b>${esc(nombreMes(m.k, true))}</b><div class="est-tip-fila"><i class="est-sw est-act-bg"></i>Siguen activos <b>${m.activos}</b></div>` +
        `<div class="est-tip-fila"><i class="est-sw est-sus-bg"></i>Hoy suspendidos${m.otros ? ' o cancelados' : ''} <b>${m.suspendidos + m.otros}</b></div>` +
        `<div class="est-tip-total">Entraron <b>${m.total}</b>${m.total ? ` · ${pct(m.activos, m.total)}% siguen activos` : ''}</div>`;
    }));
  }

  function barrasCobro(el, R) {
    const W = ancho(el), movil = W < 520;
    const H = movil ? 210 : 240, padL = 44, padR = 8, padT = 22, padB = 30;
    const meses = R.meses, n = meses.length;
    const max = Math.max(1, ...meses.map(m => m.cobrado));
    const paso = max <= 50 ? 10 : max <= 250 ? 50 : max <= 500 ? 100 : Math.ceil(max / 5 / 100) * 100;
    const tope = Math.ceil(max / paso) * paso;
    const iw = W - padL - padR, ih = H - padT - padB, col = iw / n, bw = Math.min(46, col * 0.62);
    const y = v => padT + ih - (v / tope) * ih;
    let g = '';
    for (let v = 0; v <= tope; v += paso) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="est-grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="est-eje" text-anchor="end">$${v}</text>`;
    let b = '';
    const cadaEtiqueta = n > 8 && movil ? 2 : 1;
    meses.forEach((m, i) => {
      const cx = padL + col * i + col / 2, h = (m.cobrado / tope) * ih;
      if (h > 0) { b += rectRedondo(cx - bw / 2, padT + ih - h, bw, h, 4, 'est-act'); b += `<text x="${cx}" y="${padT + ih - h - 6}" class="est-valor" text-anchor="middle">${usd(m.cobrado)}</text>`; }
      if (i % cadaEtiqueta === 0 || i === n - 1) b += `<text x="${cx}" y="${H - 10}" class="est-eje" text-anchor="middle">${esc(nombreMes(m.k))}</text>`;
      b += `<rect x="${padL + col * i}" y="${padT}" width="${col}" height="${ih}" class="est-hit" data-i="${i}"/>`;
    });
    el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Cobros de suscripción por mes">${g}<line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" class="est-base"/>${b}</svg>`;
    el.querySelectorAll('.est-hit').forEach(h => conTip(h, () => {
      const m = meses[+h.dataset.i];
      return `<b>${esc(nombreMes(m.k, true))}</b><div class="est-tip-fila">Cobrado <b>${usd(m.cobrado)}</b></div><div class="est-tip-fila">Pagos marcados <b>${m.cobros}</b></div>`;
    }));
  }

  // Barras horizontales (categorías con nombre largo: se leen bien en el teléfono)
  function barrasH(el, filas, clase, sufijo) {
    const total = filas.reduce((s, f) => s + f.n, 0);
    const max = Math.max(1, ...filas.map(f => f.n));
    el.innerHTML = filas.map(f => `
      <div class="est-hb" tabindex="0" data-tip="${esc(f.nombre)}: ${f.n} ${sufijo}${total ? ` (${pct(f.n, total)}%)` : ''}">
        <div class="est-hb-nom">${esc(f.nombre)}</div>
        <div class="est-hb-pista"><div class="est-hb-barra ${f.neutro ? 'est-neu-bg' : clase}" style="width:${f.n ? Math.max(2, (f.n / max) * 100) : 0}%"></div></div>
        <div class="est-hb-val">${f.n}<span>${total ? pct(f.n, total) + '%' : ''}</span></div>
      </div>`).join('');
    el.querySelectorAll('.est-hb').forEach(h => conTip(h, () => esc(h.dataset.tip)));
  }

  function rectRedondo(x, y, w, h, r, clase) {
    r = Math.min(r, w / 2, h);
    if (r <= 0) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${clase}"/>`;
    return `<path class="${clase}" d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z"/>`;
  }

  /* ---------------- Tooltip (ratón y toque) ---------------- */
  function conTip(nodo, html) {
    const mostrar = ev => {
      if (!tip) { tip = document.createElement('div'); tip.className = 'est-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
      tip.innerHTML = html(); tip.style.display = 'block';
      const r = nodo.getBoundingClientRect(), t = tip.getBoundingClientRect();
      let x = (ev && ev.clientX != null ? ev.clientX : r.left + r.width / 2) - t.width / 2;
      x = Math.max(8, Math.min(window.innerWidth - t.width - 8, x));
      let y = r.top - t.height - 8; if (y < 8) y = r.bottom + 8;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      nodo.classList.add('est-hover');
    };
    const ocultar = () => { if (tip) tip.style.display = 'none'; nodo.classList.remove('est-hover'); };
    nodo.addEventListener('mouseenter', mostrar); nodo.addEventListener('mousemove', mostrar);
    nodo.addEventListener('mouseleave', ocultar); nodo.addEventListener('focus', mostrar); nodo.addEventListener('blur', ocultar);
    nodo.addEventListener('click', ev => { mostrar(ev); setTimeout(() => document.addEventListener('click', ocultar, { once: true }), 0); });
  }

  /* ---------------- Pintar la sección ---------------- */
  function delta(a, b, fmt) {
    const d = a - b; if (!b && !a) return '<span class="est-neutro">Sin datos el mes pasado</span>';
    const f = fmt || (v => v);
    const cls = d > 0 ? 'est-sube' : d < 0 ? 'est-baja' : 'est-neutro';
    const fl = d > 0 ? '▲' : d < 0 ? '▼' : '＝';
    return `<span class="${cls}">${fl} ${d > 0 ? '+' : d < 0 ? '−' : ''}${f(Math.abs(d))}</span> <span class="est-neutro">vs ${f(b)} el mes pasado</span>`;
  }

  function resumen(R) {
    const L = [];
    const base = R.activos.length + R.suspendidos.length;
    L.push(`De <b>${R.total}</b> clientes, <b>${R.activos.length} están activos</b> y <b>${R.suspendidos.length} suspendidos</b>${R.cancelados.length ? ` (${R.cancelados.length} cancelados)` : ''}: el <b>${pct(R.activos.length, base)}%</b> sigue usando el sistema.`);
    const d = R.nuevosMes - R.nuevosAnt;
    L.push(`En ${MESES_L[R.kHoy % 12]} van <b>${R.nuevosMes} clientes nuevos</b>${R.nuevosAnt || R.nuevosMes ? `, ${d > 0 ? `<b>${d} más</b> que` : d < 0 ? `<b>${-d} menos</b> que` : 'igual que'} en ${MESES_L[(R.kHoy - 1) % 12]} (${R.nuevosAnt})` : ''}.`);
    if (R.maduros) L.push(`De los clientes con más de 30 días en el sistema, el <b>${pct(R.madurosAct, R.maduros)}%</b> se quedó activo (${R.madurosAct} de ${R.maduros}).`);
    if (R.suspendidos.length) {
      const mas90 = R.sus[3].n;
      L.push(`Hay <b>${R.suspendidos.length} cuentas suspendidas</b>${R.susNuncaPago ? `, ${R.susNuncaPago} nunca registraron un pago` : ''}${mas90 ? `; ${mas90} llevan más de 90 días sin pagar` : ''}. Las de menos de 60 días son las más fáciles de recuperar.`);
    }
    const nunca = R.act[5].n, lejos = R.act[4].n;
    if (nunca || lejos) L.push(`Ojo: ${nunca ? `<b>${nunca}</b> clientes activos nunca han entrado` : ''}${nunca && lejos ? ' y ' : ''}${lejos ? `<b>${lejos}</b> no entran hace más de 30 días` : ''} — están en riesgo de irse.`);
    return L.map(t => `<li>${t}</li>`).join('');
  }

  function tablaMeses(R) {
    return `<table class="est-tabla"><thead><tr><th>Mes</th><th>Entraron</th><th>Siguen activos</th><th>Hoy suspendidos</th><th>% activos</th><th>Cobrado</th></tr></thead><tbody>` +
      R.meses.slice().reverse().map(m => `<tr><td>${esc(nombreMes(m.k, true))}</td><td>${m.total}</td><td>${m.activos}</td><td>${m.suspendidos + m.otros}</td><td>${m.total ? pct(m.activos, m.total) + '%' : '—'}</td><td>${usd(m.cobrado)}</td></tr>`).join('') +
      `</tbody></table>`;
  }

  function listaSuspendidos(R) {
    const q = E.buscar.trim().toLowerCase();
    let L = R.listaSus.filter(s => !q || [s.u.nombre, s.u.apellido, s.u.nombre_negocio].join(' ').toLowerCase().includes(q));
    L.sort(E.orden === 'nombre'
      ? (a, b) => String(a.u.nombre_negocio || a.u.nombre || '').localeCompare(String(b.u.nombre_negocio || b.u.nombre || ''))
      : (a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9));
    if (!L.length) return `<div class="est-vacio">${q ? 'Ningún suspendido coincide con la búsqueda.' : 'No hay cuentas suspendidas. 🎉'}</div>`;
    const f = s => s ? new Date(s).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    return `<div class="est-sus-lista">` + L.map(s => {
      const nivel = s.dias == null ? '' : s.dias < 30 ? 'est-chip-ok' : s.dias <= 60 ? 'est-chip-med' : 'est-chip-alto';
      return `<div class="est-sus-item">
        <div class="est-sus-nom"><b>${esc(s.u.nombre_negocio || '(sin nombre de negocio)')}</b><span>${esc([s.u.nombre, s.u.apellido].filter(Boolean).join(' '))}</span></div>
        <div class="est-sus-dat"><span>Registrado <b>${f(s.u.created_at)}</b></span><span>Pagado hasta <b>${s.nuncaPago ? 'nunca pagó' : f(s.u.fecha_ultimo_pago)}</b></span><span>Última entrada <b>${s.diasCon == null ? 'nunca' : s.diasCon === 0 ? 'hoy' : 'hace ' + s.diasCon + ' d'}</b></span></div>
        <div class="est-chip ${nivel}">${s.dias == null ? '—' : (s.dias === 0 && !s.nuncaPago) ? 'Al día' : s.dias + ' días'}<small>${s.nuncaPago ? 'desde registro' : (s.dias === 0 ? 'pagado' : 'vencido')}</small></div>
      </div>`;
    }).join('') + `</div>`;
  }

  function historialHTML(R) {
    if (!R.hist.length) return `<div class="est-vacio">Todavía no hay cambios registrados. Desde el <b>12 de noviembre de 2026</b> el sistema guarda la fecha exacta cada vez que suspendes o reactivas una cuenta, y aquí verás el conteo por mes.</div>`;
    const nombres = new Map(E.datos.clientes.map(u => [u.auth_user_id, u.nombre_negocio || [u.nombre, u.apellido].filter(Boolean).join(' ')]));
    const txt = { activa: 'Activa', suspendida: 'Suspendida', cancelada: 'Cancelada' };
    return `<div class="est-mini-kpis"><div><b>${R.suspMes}</b><span>suspendidas este mes</span></div><div><b>${R.reacMes}</b><span>reactivadas este mes</span></div></div>
      <div class="est-hist">` + R.hist.slice(0, 15).map(h => {
      const sube = h.estado_nuevo === 'activa';
      return `<div class="est-hist-item"><span class="est-hist-ico ${sube ? 'est-act-bg' : 'est-sus-bg'}">${sube ? '↑' : '↓'}</span>
        <div><b>${esc(nombres.get(h.auth_user_id) || 'Cliente')}</b><span>${esc(txt[h.estado_anterior] || h.estado_anterior || '—')} → ${esc(txt[h.estado_nuevo] || h.estado_nuevo)}</span></div>
        <time>${new Date(h.created_at).toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>`;
    }).join('') + `</div>`;
  }

  function pintar() {
    const raiz = document.getElementById('est-contenido'); if (!raiz || !E.datos) return;
    const R = calcular(E.datos);
    const base = R.activos.length + R.suspendidos.length + R.cancelados.length + R.otros;
    const pA = pct(R.activos.length, base), pS = pct(R.suspendidos.length, base);
    raiz.innerHTML = `
      <div class="card est-resumen"><div class="card-body">
        <div class="est-res-tit">📌 En pocas palabras</div><ul>${resumen(R)}</ul>
      </div></div>

      <div class="est-kpis">
        <div class="est-kpi"><div class="est-kpi-lbl">Clientes en total</div><div class="est-kpi-val">${nf(R.total)}</div><div class="est-kpi-sub">Negocios registrados (sin sucursales ni bodegas internas)</div></div>
        <div class="est-kpi"><div class="est-kpi-lbl"><i class="est-sw est-act-bg"></i>Activos</div><div class="est-kpi-val">${nf(R.activos.length)} <small>${pA}%</small></div><div class="est-kpi-sub">Pueden entrar y usar el sistema</div></div>
        <div class="est-kpi"><div class="est-kpi-lbl"><i class="est-sw est-sus-bg"></i>Suspendidos</div><div class="est-kpi-val">${nf(R.suspendidos.length)} <small>${pS}%</small></div><div class="est-kpi-sub">${R.susNuncaPago} nunca registraron pago</div></div>
        <div class="est-kpi"><div class="est-kpi-lbl">Nuevos este mes</div><div class="est-kpi-val">${nf(R.nuevosMes)}</div><div class="est-kpi-sub">${delta(R.nuevosMes, R.nuevosAnt)}</div></div>
        <div class="est-kpi"><div class="est-kpi-lbl">Cobrado este mes</div><div class="est-kpi-val">${usd(R.cobradoMes)}</div><div class="est-kpi-sub">${R.pagaronMes} clientes pagaron · ${delta(R.cobradoMes, R.cobradoAnt, usd)}</div></div>
        <div class="est-kpi"><div class="est-kpi-lbl">Se quedan</div><div class="est-kpi-val">${R.maduros ? pct(R.madurosAct, R.maduros) + '%' : '—'}</div><div class="est-kpi-sub">De los que llevan +30 días, ${R.madurosAct} de ${R.maduros} siguen activos</div></div>
      </div>

      <div class="card est-card"><div class="card-header"><div><div class="card-title">Activos vs suspendidos</div><div class="card-subtitle">Cómo están hoy todas las cuentas</div></div></div>
        <div class="card-body">
          <div class="est-100" role="img" aria-label="${R.activos.length} activos, ${R.suspendidos.length} suspendidos">
            ${R.activos.length ? `<div class="est-100-seg est-act-bg" style="flex:${R.activos.length}" data-tip="Activos: ${R.activos.length} (${pA}%)"></div>` : ''}
            ${R.suspendidos.length ? `<div class="est-100-seg est-sus-bg" style="flex:${R.suspendidos.length}" data-tip="Suspendidos: ${R.suspendidos.length} (${pS}%)"></div>` : ''}
            ${R.cancelados.length + R.otros ? `<div class="est-100-seg est-neu-bg" style="flex:${R.cancelados.length + R.otros}" data-tip="Cancelados u otros: ${R.cancelados.length + R.otros}"></div>` : ''}
          </div>
          <div class="est-ley">
            <span><i class="est-sw est-act-bg"></i>Activos <b>${R.activos.length}</b> · ${pA}%</span>
            <span><i class="est-sw est-sus-bg"></i>Suspendidos <b>${R.suspendidos.length}</b> · ${pS}%</span>
            ${R.cancelados.length + R.otros ? `<span><i class="est-sw est-neu-bg"></i>Cancelados u otros <b>${R.cancelados.length + R.otros}</b></span>` : ''}
          </div>
          <p class="est-ayuda">💡 Por cada 10 clientes, ${Math.round(pA / 10)} están activos. La meta es que la parte azul crezca mes a mes.</p>
        </div></div>

      <div class="card est-card"><div class="card-header"><div><div class="card-title">Clientes nuevos por mes</div><div class="card-subtitle">Cuántos entraron cada mes y cuántos de ellos siguen activos hoy</div></div>
          <button type="button" class="btn-icon btn-ghost btn-sm est-ver-tabla" data-t="t-meses">Ver como tabla</button></div>
        <div class="card-body">
          <div class="est-ley"><span><i class="est-sw est-act-bg"></i>Siguen activos</span><span><i class="est-sw est-sus-bg"></i>Hoy suspendidos</span></div>
          <div class="est-graf" id="est-g-nuevos"></div>
          <div class="est-tabla-wrap" id="t-meses" hidden>${tablaMeses(R)}</div>
          <p class="est-ayuda">💡 La altura es cuántos clientes entraron ese mes. Si la parte naranja es grande, muchos de ese mes dejaron de pagar. ${R.mejor && R.mejor.total ? `Tu mejor mes en este período: <b>${esc(nombreMes(R.mejor.k, true))}</b> con ${R.mejor.total}.` : ''} Toca una barra para ver el detalle.</p>
        </div></div>

      <div class="est-2col">
        <div class="card est-card"><div class="card-header"><div><div class="card-title">¿Qué tan seguido entran los activos?</div><div class="card-subtitle">Última vez que cada cliente activo entró al sistema</div></div></div>
          <div class="card-body"><div id="est-g-uso"></div>
          <p class="est-ayuda">💡 Un cliente que no entra hace más de 30 días o que nunca entró probablemente no va a renovar. Escríbele antes de su fecha de pago.</p></div></div>
        <div class="card est-card"><div class="card-header"><div><div class="card-title">Suspendidos: tiempo sin pagar</div><div class="card-subtitle">Días desde que venció lo último que pagó (o desde que se registró si nunca pagó)</div></div></div>
          <div class="card-body"><div id="est-g-sus"></div>
          <p class="est-ayuda">💡 Mientras menos días lleven, más fácil es recuperarlos. Los de más de 90 días casi siempre ya no regresan.</p></div></div>
      </div>

      <div class="card est-card"><div class="card-header"><div><div class="card-title">Cobros de suscripción por mes</div><div class="card-subtitle">Pagos marcados como "Pagado" en Usuarios (en dólares)</div></div></div>
        <div class="card-body"><div class="est-graf" id="est-g-cobros"></div>
        <p class="est-ayuda">💡 Se cuenta cada pago marcado en el mes en que lo marcaste. El registro de cobros empezó en <b>octubre 2026</b>: los meses anteriores salen en cero aunque sí hayan pagado.</p></div></div>

      <div class="est-2col">
        <div class="card est-card"><div class="card-header"><div><div class="card-title">Lista de suspendidos (${R.suspendidos.length})</div><div class="card-subtitle">Para saber a quién llamar primero</div></div></div>
          <div class="card-body">
            <div class="est-filtros"><input type="search" id="est-buscar" placeholder="Buscar negocio o nombre…" value="${esc(E.buscar)}" aria-label="Buscar suspendido">
              <select id="est-orden" aria-label="Ordenar"><option value="dias"${E.orden === 'dias' ? ' selected' : ''}>Más recientes primero</option><option value="nombre"${E.orden === 'nombre' ? ' selected' : ''}>Por nombre</option></select></div>
            <div id="est-lista-sus">${listaSuspendidos(R)}</div>
          </div></div>
        <div class="card est-card"><div class="card-header"><div><div class="card-title">Suspensiones y reactivaciones</div><div class="card-subtitle">Últimos cambios de estado de cuenta</div></div></div>
          <div class="card-body">${historialHTML(R)}</div></div>
      </div>
      <p class="est-pie">Actualizado ${E.datos.hora.toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · No incluye sucursales/bodegas internas ni cuentas solo de Catálogo360. Esta sección solo lee datos: no cambia nada.</p>`;

    dibujarGraficos(R);
    raiz.querySelectorAll('.est-100-seg').forEach(s => conTip(s, () => esc(s.dataset.tip)));
    raiz.querySelectorAll('.est-ver-tabla').forEach(b => b.addEventListener('click', () => {
      const t = document.getElementById(b.dataset.t); t.hidden = !t.hidden; b.textContent = t.hidden ? 'Ver como tabla' : 'Ocultar tabla';
    }));
    const inp = document.getElementById('est-buscar');
    inp.addEventListener('input', () => { E.buscar = inp.value; document.getElementById('est-lista-sus').innerHTML = listaSuspendidos(R); });
    document.getElementById('est-orden').addEventListener('change', ev => { E.orden = ev.target.value; document.getElementById('est-lista-sus').innerHTML = listaSuspendidos(R); });
    E._R = R;
  }

  function dibujarGraficos(R) {
    const g1 = document.getElementById('est-g-nuevos'), g2 = document.getElementById('est-g-cobros');
    if (g1) barrasApiladas(g1, R);
    if (g2) barrasCobro(g2, R);
    const g3 = document.getElementById('est-g-uso'), g4 = document.getElementById('est-g-sus');
    if (g3) barrasH(g3, R.act, 'est-act-bg', 'clientes');
    if (g4) barrasH(g4, R.sus, 'est-sus-bg', 'cuentas');
  }

  let timerRes = null, anchoPrevio = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timerRes);
    timerRes = setTimeout(() => {
      const pag = document.getElementById('page-estadisticas-clientes');
      if (!pag || !pag.classList.contains('active') || !E._R) return;
      const w = window.innerWidth; if (w === anchoPrevio) return; anchoPrevio = w;
      const g1 = document.getElementById('est-g-nuevos'), g2 = document.getElementById('est-g-cobros');
      if (g1) barrasApiladas(g1, E._R); if (g2) barrasCobro(g2, E._R);
    }, 150);
  });

  async function cargar(forzar) {
    const raiz = document.getElementById('est-contenido'); if (!raiz) return;
    if (E.cargando) return;
    if (E.datos && !forzar) { pintar(); return; }
    E.cargando = true;
    raiz.innerHTML = `<div class="est-cargando"><div class="est-skel"></div><div class="est-skel"></div><div class="est-skel est-skel-alto"></div></div>`;
    try {
      E.datos = await obtener();
      pintar();
    } catch (e) {
      console.error('Estadísticas de clientes:', e);
      raiz.innerHTML = `<div class="card"><div class="card-body est-vacio">No se pudieron cargar las estadísticas. Revisa tu internet y toca <b>Actualizar</b>.</div></div>`;
    } finally { E.cargando = false; }
  }

  document.addEventListener('click', ev => {
    const r = ev.target.closest && ev.target.closest('[data-est-rango]');
    if (r) {
      E.rango = +r.dataset.estRango;
      document.querySelectorAll('[data-est-rango]').forEach(b => b.classList.toggle('activo', b === r));
      pintar();
    }
    if (ev.target.closest && ev.target.closest('#est-actualizar')) cargar(true);
  });

  window.AdminEst = { cargar, _calcular: calcular, _estado: E };
})();
