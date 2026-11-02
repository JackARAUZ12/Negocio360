/* =====================================================
   MENSAJERIA-REPORTES.JS — NEGOCIO360 · Mensajería: Reportes
   Cuántos envíos llegaron y cuántos se entregaron, qué porcentaje se
   entregó a la primera, cuánto tardan, tarifas, dinero cobrado para
   los comercios, y el detalle por repartidor, zona y comercio, más los
   motivos de no entrega. Solo lee; exporta a Excel.
===================================================== */
'use strict';
const TR2 = { per: '7', recibidos: [], entregados: [], motivos: [], reps: {} };
const $r2 = id => document.getElementById(id);
const r2pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : 0;
const r2horas = ms => { const h = ms / 3600000; return h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? (Math.round(h * 10) / 10) + ' h' : (Math.round(h / 2.4) / 10) + ' días'; };

TR2.periodo = function (p) {
  TR2.per = p; const hoy = new Date(); let d = new Date(hoy), h = new Date(hoy);
  if (p === '7') d.setDate(d.getDate() - 6); else if (p === '30') d.setDate(d.getDate() - 29);
  else if (p === 'mes') d = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  else if (p === 'ant') { d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); h = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
  $r2('rp-desde').value = ymd(d); $r2('rp-hasta').value = ymd(h);
  document.querySelectorAll('#rp-per .ms-tab').forEach(b => { b.classList.toggle('activa', b.dataset.p === p); b.setAttribute('aria-selected', b.dataset.p === p ? 'true' : 'false'); });
  TR2.cargar();
};
TR2.rango = function () {
  const d = new Date($r2('rp-desde').value + 'T00:00:00'), h = new Date($r2('rp-hasta').value + 'T00:00:00'); h.setDate(h.getDate() + 1);
  return [d.toISOString(), h.toISOString()];
};
TR2.cargar = async function () {
  if (!$r2('rp-desde').value || !$r2('rp-hasta').value) return;
  const [d, h] = TR2.rango();
  $r2('rp-kpi').innerHTML = '<div class="section-loading"><div class="mini-spinner"></div></div>';
  const [rec, ent, mot] = await Promise.all([
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).gte('created_at', d).lt('created_at', h).limit(5000),
    sb.from('mensajeria_envios').select('*').eq('auth_user_id', TL.userId).eq('estado', 'entregado').gte('entregado_at', d).lt('entregado_at', h).limit(5000),
    sb.from('mensajeria_envio_eventos').select('detalle,created_at').eq('auth_user_id', TL.userId).eq('evento', 'no_entregado').gte('created_at', d).lt('created_at', h).limit(3000),
  ]);
  TR2.recibidos = rec.data || []; TR2.entregados = ent.data || []; TR2.motivos = mot.data || [];
  TR2.pintar();
};
TR2.pintar = function () {
  const R = TR2.recibidos, E = TR2.entregados;
  const dev = R.filter(e => e.estado === 'devuelto').length, canc = R.filter(e => e.estado === 'cancelado').length;
  const finR = R.filter(e => ['entregado', 'devuelto'].includes(e.estado)), entR = finR.filter(e => e.estado === 'entregado').length;
  const primera = E.filter(e => Number(e.intentos) <= 1).length;
  const tiempos = E.map(e => new Date(e.entregado_at) - new Date(e.created_at)).filter(x => x > 0);
  const prom = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : 0;
  const tarifas = E.reduce((a, e) => a + Number(e.tarifa) + Number(e.recargo_reintentos || 0), 0);
  const cod = E.reduce((a, e) => a + Number(e.cobrado_cod || 0), 0);
  const enCurso = R.filter(e => MS_ACTIVOS.includes(e.estado)).length;
  $r2('rp-kpi').innerHTML = `<div><b>${R.length}</b><span>envíos recibidos${canc ? ' (' + canc + ' cancelados)' : ''}</span></div>
    <div><b>${E.length}</b><span>entregados</span></div>
    <div><b>${r2pct(entR, finR.length)}%</b><span>se entregaron (no devueltos)</span></div>
    <div><b>${r2pct(primera, E.length)}%</b><span>entregados a la primera</span></div>
    <div><b>${tiempos.length ? r2horas(prom) : '—'}</b><span>tiempo promedio de entrega</span></div>
    <div><b>${dev}</b><span>devueltos</span></div><div><b>${enCurso}</b><span>todavía en curso</span></div>
    <div><b>${fmt(tarifas)}</b><span>en tarifas de lo entregado</span></div><div><b>${fmt(cod)}</b><span>cobrado para comercios</span></div>`;
  const barra = (v, max) => `<div style="height:6px;border-radius:9px;background:var(--bg-hover);margin-top:4px"><div style="height:6px;border-radius:9px;background:var(--accent);width:${max ? Math.round(v * 100 / max) : 0}%"></div></div>`;
  const tabla = (id, cab, filas) => { $r2(id).innerHTML = filas.length ? `<thead><tr>${cab.map((c, i) => `<th${i ? ' class="tl-num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody>` : '<tbody><tr><td class="tl-vacio">Sin datos en este periodo.</td></tr></tbody>'; };
  // Por repartidor (entregas del periodo)
  const pr = {}; E.forEach(e => { const k = e.repartidor_id || '—'; const x = pr[k] = pr[k] || { n: 0, primera: 0, t: 0, nt: 0, ef: 0, tr: 0 }; x.n++; if (Number(e.intentos) <= 1) x.primera++;
    const t = new Date(e.entregado_at) - new Date(e.created_at); if (t > 0) { x.t += t; x.nt++; } if (e.metodo_cobro === 'efectivo') x.ef += Number(e.cobrado_cod) + Number(e.cobrado_envio); if (e.metodo_cobro === 'transferencia') x.tr += Number(e.cobrado_cod) + Number(e.cobrado_envio); });
  const maxR = Math.max(0, ...Object.values(pr).map(x => x.n));
  tabla('rp-rep', ['Repartidor', 'Entregas', 'A la primera', 'Tiempo prom.', 'Cobró efectivo', 'Cobró transf.'], Object.entries(pr).sort((a, b) => b[1].n - a[1].n).map(([k, x]) =>
    `<tr><td data-t="Repartidor"><b>${esc(TR2.reps[k]?.nombre || 'Sin repartidor')}</b>${barra(x.n, maxR)}</td><td data-t="Entregas" class="tl-num">${x.n}</td><td data-t="A la primera" class="tl-num">${r2pct(x.primera, x.n)}%</td>
      <td data-t="Tiempo prom." class="tl-num">${x.nt ? r2horas(x.t / x.nt) : '—'}</td><td data-t="Efectivo" class="tl-num">${fmt(x.ef)}</td><td data-t="Transferencia" class="tl-num">${fmt(x.tr)}</td></tr>`));
  // Por zona (recibidos del periodo)
  const pz = {}; R.forEach(e => { const k = e.zona_nombre || 'Sin zona'; const x = pz[k] = pz[k] || { n: 0, ent: 0, dev: 0, tar: 0 }; x.n++; if (e.estado === 'entregado') { x.ent++; x.tar += Number(e.tarifa) + Number(e.recargo_reintentos || 0); } if (e.estado === 'devuelto') x.dev++; });
  const maxZ = Math.max(0, ...Object.values(pz).map(x => x.n));
  tabla('rp-zona', ['Zona', 'Envíos', 'Entregados', 'Devueltos', 'Tarifas'], Object.entries(pz).sort((a, b) => b[1].n - a[1].n).map(([k, x]) =>
    `<tr><td data-t="Zona"><b>${esc(k)}</b>${barra(x.n, maxZ)}</td><td data-t="Envíos" class="tl-num">${x.n}</td><td data-t="Entregados" class="tl-num">${x.ent}</td><td data-t="Devueltos" class="tl-num">${x.dev}</td><td data-t="Tarifas" class="tl-num">${fmt(x.tar)}</td></tr>`));
  // Por comercio (recibidos del periodo)
  const pc = {}; R.forEach(e => { const k = e.comercio_id ? e.remitente_nombre : 'Personas (sin comercio)'; const x = pc[k] = pc[k] || { n: 0, ent: 0, dev: 0, cod: 0 }; x.n++; if (e.estado === 'entregado') { x.ent++; x.cod += Number(e.cobrado_cod || 0); } if (e.estado === 'devuelto') x.dev++; });
  const maxC = Math.max(0, ...Object.values(pc).map(x => x.n));
  tabla('rp-com', ['Comercio', 'Envíos', 'Entregados', 'Devueltos', 'Cobrado a su nombre'], Object.entries(pc).sort((a, b) => b[1].n - a[1].n).map(([k, x]) =>
    `<tr><td data-t="Comercio"><b>${esc(k)}</b>${barra(x.n, maxC)}</td><td data-t="Envíos" class="tl-num">${x.n}</td><td data-t="Entregados" class="tl-num">${x.ent}</td><td data-t="Devueltos" class="tl-num">${x.dev}</td><td data-t="Cobrado" class="tl-num">${fmt(x.cod)}</td></tr>`));
  // Motivos de no entrega
  const pm = {}; TR2.motivos.forEach(m => { const k = String(m.detalle || 'Sin motivo').split(' · ')[0]; pm[k] = (pm[k] || 0) + 1; });
  const lm = Object.entries(pm).sort((a, b) => b[1] - a[1]), maxM = lm.length ? lm[0][1] : 0;
  $r2('rp-mot').innerHTML = lm.length ? `<div class="tl-sec">${lm.map(([k, n]) => `<div><div class="ms-total"><span>${esc(k)}</span><b>${n}</b></div>${barra(n, maxM)}</div>`).join('')}</div>` : '<div class="tl-vacio">No hubo intentos fallidos en este periodo. 👍</div>';
};
TR2.excel = async function () {
  const btn = $r2('rp-excel'); btn.disabled = true;
  try {
    if (!(await tiCargarXLSXReportes())) { showToast('No se pudo abrir Excel. Revisa tu conexión.', 'error'); return; }
    const filas = TR2.recibidos.map(e => ({ Guía: e.numero, Fecha: tlFechaHora(e.created_at), Estado: (MS_ESTADOS[e.estado] || {}).t || e.estado, De: e.remitente_nombre, Para: e.destinatario_nombre,
      Dirección: e.direccion, Zona: e.zona_nombre || '', Repartidor: TR2.reps[e.repartidor_id]?.nombre || '', Tarifa: Number(e.tarifa) + Number(e.recargo_reintentos || 0),
      'Paga envío': e.envio_lo_paga === 'destinatario' ? 'Quien recibe' : 'Quien envía', 'Cobrar contra entrega': Number(e.monto_cobrar), Intentos: Number(e.intentos),
      Entregado: e.entregado_at ? tlFechaHora(e.entregado_at) : '', Recibió: e.recibio_nombre || '', 'Cómo pagó': e.metodo_cobro || '', Motivo: e.motivo_no_entrega || '' }));
    const hoja = XLSX.utils.json_to_sheet(filas.length ? filas : [{ Guía: 'Sin envíos en el periodo' }]);
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'Envíos');
    XLSX.writeFile(libro, `envios_${$r2('rp-desde').value}_a_${$r2('rp-hasta').value}.xlsx`);
  } finally { btn.disabled = false; }
};
function tiCargarXLSXReportes() {
  if (window.XLSX) return Promise.resolve(true);
  return new Promise(res => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = () => res(!!window.XLSX); s.onerror = () => res(false); document.head.appendChild(s); });
}

window.tallerListo = async function () {
  (await msRepartidores(false)).forEach(r => { TR2.reps[r.id] = r; });
  TR2.periodo('7');
};
