/* ============================================================
   ADMIN-INGRESOS.JS — Negocio360 · Panel de administración
   "Ingresos Negocio360": lo que TÚ cobras por las suscripciones.
   - Cobrado: esta semana, este mes, mes pasado y este año (pagos
     marcados como "Pagado" en Usuarios → tabla plataforma_pagos, en US$).
   - Recurrente esperado, lo que te deben hoy y lo que falta cobrar este mes,
     con las MISMAS reglas de vencimiento del Dashboard (getPaymentInfo).
   SOLO LEE. No cambia pagos, cuentas ni estados.
   ============================================================ */
(function () {
  'use strict';
  const TZ = 'America/Managua';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = n => 'US$ ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usdC = n => '$' + Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 0 });
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const $ = id => document.getElementById(id);
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // Fecha calendario de Managua (YYYY-MM-DD) de un instante
  const diaLocal = d => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
  const aFecha = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sumarDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return iso(d); };
  const lunesDe = s => { const d = aFecha(s); const dw = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dw); return iso(d); };
  const fechaCorta = s => { const d = aFecha(s); return `${d.getDate()} ${MESC[d.getMonth()]}`; };

  const I = { pagos: [], usuarios: [], cargando: false, vista: 'semanal', periodo: 'mes' };
  let tip = null;

  async function cargar() {
    if (I.cargando) return; I.cargando = true;
    const b = $('in-actualizar'); if (b) b.disabled = true;
    try {
      const [pRes, uRes] = await Promise.all([
        sb.from('plataforma_pagos').select('id, auth_user_id, ciclo, monto, moneda, created_at').order('created_at', { ascending: false }).limit(10000),
        sb.from('usuarios').select('auth_user_id, nombre, apellido, nombre_negocio, email, estado_cuenta, plan, created_at, fecha_ultimo_pago, ciclo_facturacion, precio_personalizado'),
      ]);
      if (pRes.error) throw pRes.error;
      if (uRes.error) throw uRes.error;
      const shadow = await obtenerIdsSucursalesShadow();
      const c360 = await obtenerIdsClientesC360Independientes();
      I.todos = uRes.data || [];   // para nombres (incluye sucursales)
      I.usuarios = (uRes.data || []).filter(u => u.auth_user_id && !shadow.has(u.auth_user_id) && !c360.has(u.auth_user_id) && !/@negocio360\.internal$/i.test(u.email || ''));
      I.pagos = (pRes.data || []).map(p => ({ ...p, dia: diaLocal(p.created_at), monto: Number(p.monto) || 0 }));
      pintar();
    } catch (e) {
      console.error('Ingresos:', e);
      (window.toast || console.log)('No se pudieron cargar los ingresos', e.message || '', 'error');
    } finally { I.cargando = false; if (b) b.disabled = false; }
  }

  const nombreDe = id => {
    const u = (I.todos || []).find(x => x.auth_user_id === id);
    if (!u) return 'Cuenta eliminada';
    const n = u.nombre_negocio || [u.nombre, u.apellido].filter(Boolean).join(' ') || 'Cliente';
    return I.usuarios.some(x => x.auth_user_id === id) ? n : n + ' (sucursal)';
  };
  const suma = (desde, hasta) => {
    const l = I.pagos.filter(p => p.dia >= desde && p.dia <= hasta);
    return { total: r2(l.reduce((s, p) => s + p.monto, 0)), n: l.length, lista: l };
  };

  // Período del negocio: del día 20 de un mes al 19 del siguiente (ambos incluidos).
  // off = 0 → el período que contiene "hoy"; 1 → el anterior; etc.
  function periodo(hoy, off) {
    const d = aFecha(hoy), m0 = d.getMonth() - (d.getDate() >= 20 ? 0 : 1) - off;
    const ini = new Date(d.getFullYear(), m0, 20), fin = new Date(d.getFullYear(), m0 + 1, 19);
    return [iso(ini), iso(fin)];
  }
  const diasEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 864e5);
  const etPeriodo = ([a, b]) => `${fechaCorta(a)} – ${fechaCorta(b)}`;

  function rangos() {
    const hoy = diaLocal(Date.now()), d = aFecha(hoy);
    const lun = lunesDe(hoy), diasSemana = (d.getDay() + 6) % 7; // 0 = lunes
    const iniMes = iso(new Date(d.getFullYear(), d.getMonth(), 1));
    const iniMesPas = iso(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    const finMesPas = iso(new Date(d.getFullYear(), d.getMonth(), 0));
    const finMesPasMismoDia = iso(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth(), 0).getDate())));
    return {
      hoy, d,
      semana: [lun, hoy], semanaPas: [sumarDias(lun, -7), sumarDias(lun, diasSemana - 7)],
      mes: [iniMes, hoy], mesPasMismo: [iniMesPas, finMesPasMismoDia], mesPas: [iniMesPas, finMesPas],
      anio: [`${d.getFullYear()}-01-01`, hoy],
      per: [periodo(hoy, 0)[0], hoy], perCompleto: periodo(hoy, 0), perPas: periodo(hoy, 1),
      perPasMismo: (() => { const p = periodo(hoy, 1), f = sumarDias(p[0], diasEntre(periodo(hoy, 0)[0], hoy)); return [p[0], f < p[1] ? f : p[1]]; })(),
      nombreMes: MES[d.getMonth()], nombreMesPas: MES[(d.getMonth() + 11) % 12], anioN: d.getFullYear(),
    };
  }

  // Precio mensual equivalente (anual → /12; pago único no es recurrente)
  const mensualDe = u => u.ciclo_facturacion === 'anual' ? precioDe(u) / 12 : (u.ciclo_facturacion === 'unico' ? 0 : precioDe(u));

  function cartera(R) {
    const hoyD = new Date(); hoyD.setHours(0, 0, 0, 0);
    const premium = I.usuarios.filter(u => u.plan === 'premium' && u.estado_cuenta !== 'cancelada');
    const activos = premium.filter(u => u.estado_cuenta === 'activa');
    const suspendidos = premium.filter(u => u.estado_cuenta === 'suspendida');
    const mrr = r2(activos.reduce((s, u) => s + mensualDe(u), 0));
    const enRiesgo = r2(suspendidos.reduce((s, u) => s + mensualDe(u), 0));
    // Te deben hoy: mismas reglas que "Pendientes de pago" + "Pago atrasado" del Dashboard
    const deben = [];
    premium.forEach(u => {
      const info = typeof getPaymentInfo === 'function' ? getPaymentInfo(u, hoyD) : null;
      if (info && (info.status === 'pendiente' || info.status === 'atrasado')) deben.push({ u, info, monto: precioDe(u) });
    });
    // Falta cobrar este mes: ciclos que vencen este mes y todavía no están pagados
    const faltaMes = [];
    premium.forEach(u => {
      if (u.ciclo_facturacion === 'unico') return;
      const due = getCurrentCycleDueDate(u, hoyD);
      if (!due || due.getMonth() !== hoyD.getMonth() || due.getFullYear() !== hoyD.getFullYear()) return;
      const pagado = u.fecha_ultimo_pago && cicloIndexOf(u, new Date(u.fecha_ultimo_pago + 'T00:00:00')) >= cicloIndexOf(u, due);
      if (!pagado) faltaMes.push({ u, due, monto: precioDe(u) });
    });
    return {
      activos: activos.length, suspendidos: suspendidos.length, mrr, enRiesgo,
      deben, debenTotal: r2(deben.reduce((s, x) => s + x.monto, 0)),
      faltaMes, faltaTotal: r2(faltaMes.reduce((s, x) => s + x.monto, 0)),
    };
  }

  const variacion = (a, b, texto) => {
    if (!b && !a) return `<span class="in-var neutra">Sin cobros ${texto} tampoco</span>`;
    if (!b) return `<span class="in-var sube">▲ ${texto}: US$ 0</span>`;
    const p = Math.round(((a - b) / b) * 100);
    return `<span class="in-var ${p > 0 ? 'sube' : p < 0 ? 'baja' : 'neutra'}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}% vs ${texto} (${usd(b)})</span>`;
  };

  function pintar() {
    const R = rangos();
    const sem = suma(...R.semana), semP = suma(...R.semanaPas);
    const mes = suma(...R.mes), mesPM = suma(...R.mesPasMismo), mesP = suma(...R.mesPas);
    const anio = suma(...R.anio);
    const per = suma(...R.per), perP = suma(...R.perPas), perPM = suma(...R.perPasMismo);
    const mesesConCobro = new Set(anio.lista.map(p => p.dia.slice(0, 7))).size;
    const C = cartera(R);
    const primer = I.pagos.length ? I.pagos.reduce((m, p) => p.dia < m ? p.dia : m, I.pagos[0].dia) : null;

    $('in-aviso').innerHTML = primer
      ? `Se cuentan los pagos que marcas como <b>"Pagado"</b> en Usuarios, el día que los marcas, en dólares. El registro empezó el <b>${fechaCorta(primer)} ${aFecha(primer).getFullYear()}</b>: antes de esa fecha sale en cero aunque sí te hayan pagado.`
      : 'Todavía no hay pagos registrados. Se cuentan los pagos que marcas como "Pagado" en Usuarios.';

    $('in-k-semana').textContent = usd(sem.total);
    $('in-k-semana-sub').innerHTML = `${sem.n} pago${sem.n === 1 ? '' : 's'} · lunes ${fechaCorta(R.semana[0])} a hoy<br>${variacion(sem.total, semP.total, 'mismos días semana pasada')}`;
    $('in-k-mes').textContent = usd(mes.total);
    $('in-k-mes-sub').innerHTML = `${mes.n} pago${mes.n === 1 ? '' : 's'} en ${R.nombreMes}<br>${variacion(mes.total, mesPM.total, `mismos días de ${R.nombreMesPas}`)}`;
    $('in-k-mespas').textContent = usd(mesP.total);
    $('in-k-mespas-sub').innerHTML = `${mesP.n} pago${mesP.n === 1 ? '' : 's'} en todo ${R.nombreMesPas}`;
    $('in-k-anio').textContent = usd(anio.total);
    $('in-k-anio-sub').innerHTML = `${anio.n} pagos en ${R.anioN}${mesesConCobro ? `<br>Promedio ${usd(anio.total / mesesConCobro)} por mes con cobros` : ''}`;

    $('in-k-per-t').textContent = `Período actual · ${etPeriodo(R.perCompleto)}`;
    $('in-k-per').textContent = usd(per.total);
    $('in-k-per-sub').innerHTML = `${per.n} pago${per.n === 1 ? '' : 's'} del ${fechaCorta(R.per[0])} a hoy (cierra el ${fechaCorta(R.perCompleto[1])})<br>${variacion(per.total, perPM.total, 'mismos días del período anterior')}`;
    $('in-k-perpas-t').textContent = `Período anterior · ${etPeriodo(R.perPas)}`;
    $('in-k-perpas').textContent = usd(perP.total);
    $('in-k-perpas-sub').innerHTML = `${perP.n} pago${perP.n === 1 ? '' : 's'} en todo el período`;

    $('in-k-mrr').textContent = usd(C.mrr);
    $('in-k-mrr-sub').innerHTML = `${C.activos} cliente${C.activos === 1 ? '' : 's'} activo${C.activos === 1 ? '' : 's'} pagando (los anuales cuentan su precio ÷ 12)`;
    $('in-k-deben').textContent = usd(C.debenTotal);
    $('in-k-deben-sub').innerHTML = `${C.deben.length} cliente${C.deben.length === 1 ? '' : 's'} con pago vencido hoy`;
    $('in-k-falta').textContent = usd(C.faltaTotal);
    $('in-k-falta-sub').innerHTML = `${C.faltaMes.length} cliente${C.faltaMes.length === 1 ? '' : 's'} vence${C.faltaMes.length === 1 ? '' : 'n'} en ${R.nombreMes} sin pagar<br>Si pagan todos, cierras ${R.nombreMes} en <b>${usd(mes.total + C.faltaTotal)}</b>`;
    $('in-k-riesgo').textContent = usd(C.enRiesgo);
    $('in-k-riesgo-sub').innerHTML = `${C.suspendidos} cliente${C.suspendidos === 1 ? '' : 's'} suspendido${C.suspendidos === 1 ? '' : 's'} (ingreso mensual detenido)`;

    pintarGrafico(R);
    pintarDeben(C);
    pintarTabla(R);
  }

  /* ---------------- Gráfico (una serie, barras) ---------------- */
  function datosGrafico(R) {
    if (I.vista === 'semanal') {
      const out = [], lun = lunesDe(R.hoy);
      for (let i = 11; i >= 0; i--) {
        const ini = sumarDias(lun, -7 * i), fin = sumarDias(ini, 6);
        const s = suma(ini, fin < R.hoy ? fin : R.hoy);
        out.push({ et: fechaCorta(ini), largo: `Semana del ${fechaCorta(ini)} al ${fechaCorta(fin)}`, v: s.total, n: s.n, actual: i === 0 });
      }
      return out;
    }
    if (I.vista === 'periodo') {
      const out = [];
      for (let i = 11; i >= 0; i--) {
        const [ini, fin] = periodo(R.hoy, i);
        const s = suma(ini, fin < R.hoy ? fin : R.hoy);
        out.push({ et: fechaCorta(ini), largo: `Período ${fechaCorta(ini)} ${aFecha(ini).getFullYear()} – ${fechaCorta(fin)} ${aFecha(fin).getFullYear()}`, v: s.total, n: s.n, actual: i === 0 });
      }
      return out;
    }
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(R.d.getFullYear(), R.d.getMonth() - i, 1);
      const ini = iso(d), fin = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const s = suma(ini, fin);
      out.push({ et: `${MESC[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, largo: `${MES[d.getMonth()]} ${d.getFullYear()}`, v: s.total, n: s.n, actual: i === 0 });
    }
    return out;
  }

  function rect(x, y, w, h, r, clase) {
    r = Math.min(r, w / 2, h);
    if (r <= 0) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${clase}"/>`;
    return `<path class="${clase}" d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z"/>`;
  }

  function pintarGrafico(R) {
    const el = $('in-grafico'); if (!el) return;
    document.querySelectorAll('[data-in-vista]').forEach(b => b.classList.toggle('activo', b.dataset.inVista === I.vista));
    const datos = datosGrafico(R);
    el.innerHTML = '';   // se vacía antes de medir: si no, el gráfico anterior impide que se achique
    const W = Math.max(260, el.clientWidth || 600), movil = W < 520;
    const H = movil ? 210 : 240, padL = 46, padR = 8, padT = 22, padB = 30;
    const max = Math.max(1, ...datos.map(x => x.v));
    const paso = max <= 50 ? 10 : max <= 250 ? 50 : max <= 500 ? 100 : Math.ceil(max / 5 / 100) * 100;
    const tope = Math.ceil(max / paso) * paso;
    const iw = W - padL - padR, ih = H - padT - padB, col = iw / datos.length, bw = Math.min(40, col * 0.62);
    const y = v => padT + ih - (v / tope) * ih;
    let g = '';
    for (let v = 0; v <= tope; v += paso) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="in-grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="in-eje" text-anchor="end">${usdC(v)}</text>`;
    let b = '';
    const cada = movil ? 2 : 1;
    datos.forEach((x, i) => {
      const cx = padL + col * i + col / 2, h = (x.v / tope) * ih;
      if (h > 0) {
        b += rect(cx - bw / 2, padT + ih - h, bw, h, 4, x.actual ? 'in-barra actual' : 'in-barra');
        if (!movil || x.actual) b += `<text x="${cx}" y="${padT + ih - h - 6}" class="in-valor" text-anchor="middle">${usdC(x.v)}</text>`;
      }
      if (i % cada === (datos.length - 1) % cada) b += `<text x="${cx}" y="${H - 10}" class="in-eje" text-anchor="middle">${esc(x.et)}</text>`;
      b += `<rect x="${padL + col * i}" y="${padT}" width="${col}" height="${ih}" class="in-hit" data-i="${i}" tabindex="0"/>`;
    });
    el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Cobros por ${I.vista === 'semanal' ? 'semana' : I.vista === 'periodo' ? 'período' : 'mes'}">${g}<line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" class="in-base"/>${b}</svg>`;
    if (!tip) { tip = document.createElement('div'); tip.className = 'in-tip'; document.body.appendChild(tip); }
    el.querySelectorAll('.in-hit').forEach(h => {
      const x = datos[+h.dataset.i];
      const mostrar = ev => {
        tip.innerHTML = `<b>${esc(x.largo)}</b>${x.actual ? ' <small>(en curso)</small>' : ''}<div class="in-tip-fila">Cobrado <b>${usd(x.v)}</b></div><div class="in-tip-fila">Pagos <b>${x.n}</b></div>`;
        tip.style.display = 'block';
        const r = (ev && ev.clientX != null) ? { x: ev.clientX, y: ev.clientY } : (() => { const b2 = h.getBoundingClientRect(); return { x: b2.left + b2.width / 2, y: b2.top }; })();
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        tip.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.x - tw / 2)) + 'px';
        tip.style.top = Math.max(8, r.y - th - 12) + 'px';
        h.classList.add('in-hover');
      };
      const ocultar = () => { tip.style.display = 'none'; h.classList.remove('in-hover'); };
      h.addEventListener('mousemove', mostrar); h.addEventListener('mouseleave', ocultar);
      h.addEventListener('focus', () => mostrar()); h.addEventListener('blur', ocultar);
      h.addEventListener('touchstart', ev => { mostrar(ev.touches[0]); setTimeout(ocultar, 2500); }, { passive: true });
    });
  }

  /* ---------------- Quién te debe hoy ---------------- */
  function pintarDeben(C) {
    const el = $('in-deben'); if (!el) return;
    if (!C.deben.length) { el.innerHTML = '<div class="in-vacio">✅ Nadie tiene pagos vencidos hoy.</div>'; return; }
    const l = C.deben.slice().sort((a, b) => b.info.diffDays - a.info.diffDays);
    el.innerHTML = `<div class="table-responsive"><table class="data-table"><thead><tr><th>Cliente</th><th>Venció</th><th>Atraso</th><th style="text-align:right">Monto</th></tr></thead><tbody>${l.map(x => `<tr>
      <td><b>${esc(nombreDe(x.u.auth_user_id))}</b>${x.u.estado_cuenta === 'suspendida' ? ' <span class="badge badge-warning">Suspendido</span>' : ''}</td>
      <td style="white-space:nowrap">${x.info.dueDate ? x.info.dueDate.toLocaleDateString('es-NI', { day: '2-digit', month: 'short' }) : '—'}</td>
      <td>${x.info.diffDays > 0 ? `${x.info.diffDays} día${x.info.diffDays === 1 ? '' : 's'}` : 'Hoy'}</td>
      <td style="text-align:right;white-space:nowrap">${usd(x.monto)}</td></tr>`).join('')}
      <tr class="in-total"><td colspan="3">Total</td><td style="text-align:right">${usd(C.debenTotal)}</td></tr></tbody></table></div>`;
  }

  /* ---------------- Detalle de cobros del período ---------------- */
  function pintarTabla(R) {
    const el = $('in-tabla'); if (!el) return;
    document.querySelectorAll('[data-in-periodo]').forEach(b => b.classList.toggle('activo', b.dataset.inPeriodo === I.periodo));
    const r = { semana: R.semana, mes: R.mes, mespas: R.mesPas, anio: R.anio, per: R.per, perpas: R.perPas }[I.periodo];
    const s = suma(...r);
    if (!s.lista.length) { el.innerHTML = '<div class="in-vacio">No hay cobros en este período.</div>'; return; }
    const l = s.lista.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    el.innerHTML = `<div class="table-responsive"><table class="data-table"><thead><tr><th>Fecha del cobro</th><th>Cliente</th><th>Ciclo pagado</th><th style="text-align:right">Monto</th></tr></thead><tbody>${l.map(p => `<tr>
      <td style="white-space:nowrap">${fechaCorta(p.dia)} ${aFecha(p.dia).getFullYear()}</td>
      <td><b>${esc(nombreDe(p.auth_user_id))}</b></td>
      <td style="white-space:nowrap">${p.ciclo ? (() => { const d = aFecha(String(p.ciclo).slice(0, 10)); return `${MES[d.getMonth()]} ${d.getFullYear()}`; })() : '—'}</td>
      <td style="text-align:right;white-space:nowrap">${usd(p.monto)}</td></tr>`).join('')}
      <tr class="in-total"><td colspan="3">${s.n} pago${s.n === 1 ? '' : 's'}</td><td style="text-align:right">${usd(s.total)}</td></tr></tbody></table></div>`;
    I._ultimaLista = l;
  }

  function descargarCSV() {
    const l = I._ultimaLista || [];
    if (!l.length) return;
    const filas = [['Fecha', 'Cliente', 'Ciclo pagado', 'Monto USD']].concat(l.map(p => [p.dia, nombreDe(p.auth_user_id), p.ciclo ? String(p.ciclo).slice(0, 10) : '', p.monto.toFixed(2)]));
    const csv = '﻿' + filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ingresos-negocio360-${I.periodo}-${diaLocal(Date.now())}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  document.addEventListener('click', ev => {
    const t = ev.target.closest && ev.target.closest('[data-in-vista],[data-in-periodo],#in-actualizar,#in-csv');
    if (!t) return;
    if (t.id === 'in-actualizar') return cargar();
    if (t.id === 'in-csv') return descargarCSV();
    if (t.dataset.inVista) { I.vista = t.dataset.inVista; return pintarGrafico(rangos()); }
    if (t.dataset.inPeriodo) { I.periodo = t.dataset.inPeriodo; return pintarTabla(rangos()); }
  });
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (I.pagos.length && $('page-ingresos')?.classList.contains('active')) pintarGrafico(rangos()); }, 200); });

  window.AdminIngresos = { cargar, _I: I, _rangos: rangos };
})();
