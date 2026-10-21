/* ============================================================
   EMPRESA-CONSULTA.JS — Negocio360 (Consulta de inventario)
   Solo LEE. Para negocios que forman una empresa vinculada:
   1) Panel "Inventario de la empresa": cuánto hay (valor a costo) en
      cada negocio y sus bodegas, y el total de la empresa.
   2) En el detalle de un producto: cuánto hay del MISMO producto en el
      otro negocio (según el vínculo), convertido a las unidades de aquí.
   Cada negocio sigue con su inventario aparte; aquí solo se ve junto.
   Para cuentas sin empresa no hace nada.
   Reutiliza de consulta-inventario.js: sbReal, STATE, esc, fmt, fmtNum.
   ============================================================ */
'use strict';

const EMPC = { negocios: [], vinculos: null, otros: null };

async function empcIniciar() {
  try {
    if (typeof sbReal === 'undefined' || !STATE || !STATE.userId) return;
    const { data, error } = await sbReal.rpc('empresa_mis_negocios');
    if (error || !Array.isArray(data) || !data.length) return;
    EMPC.negocios = data;
    await empcPanel();
    const orig = window.mostrarDetalle;
    if (typeof orig === 'function' && !orig.__empc) {
      window.mostrarDetalle = function (filas) { orig(filas); empcDetalle(filas); };
      window.mostrarDetalle.__empc = true;
    }
  } catch (e) { console.warn('empresa-consulta:', e); }
}

async function empcPanel() {
  const { data, error } = await sbReal.rpc('empresa_inventario_resumen');
  if (error || !data || !data.length) return;
  const negocios = [...new Set(data.map(r => r.negocio))];
  const total = data.reduce((s, r) => s + Number(r.valor || 0), 0);
  const filas = negocios.map(n => {
    const lugares = data.filter(r => r.negocio === n);
    const sub = lugares.reduce((s, r) => s + Number(r.valor || 0), 0);
    return lugares.map(r => `<tr><td style="padding:6px 8px;${r.es_negocio ? 'font-weight:600' : 'padding-left:24px;color:var(--text-muted)'}">${r.es_negocio ? '🏠' : '📦'} ${esc(r.lugar)}</td>
        <td style="padding:6px 8px;text-align:right">${fmtNum(r.productos_con_stock)}</td><td style="padding:6px 8px;text-align:right">${fmt(r.valor)}</td></tr>`).join('')
      + (lugares.length > 1 ? `<tr><td style="padding:6px 8px;text-align:right;color:var(--text-muted)">Subtotal ${esc(n)}</td><td></td><td style="padding:6px 8px;text-align:right;font-weight:600">${fmt(sub)}</td></tr>` : '');
  }).join('');
  const panel = document.createElement('div');
  panel.className = 'panel-card fade-in';
  panel.id = 'empc-panel';
  panel.style.marginBottom = '16px';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="font-size:15px;margin:0">🏢 Inventario de la empresa ${esc(EMPC.negocios[0].empresa || '')}</h3>
      <span style="font-size:12px;color:var(--text-muted)">Cada negocio lleva su inventario aparte · valor a costo</span>
    </div>
    <div class="table-wrap"><table class="ci-tabla" style="width:100%"><thead><tr><th>Lugar</th><th style="text-align:right">Productos con existencia</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>${filas}<tr style="border-top:2px solid var(--border)"><td style="padding:8px;font-weight:700">Total de la empresa</td><td></td><td style="padding:8px;text-align:right;font-weight:700">${fmt(total)}</td></tr></tbody></table></div>`;
  const ancla = document.getElementById('ci-detalle-wrap');
  if (ancla && !document.getElementById('empc-panel')) ancla.parentNode.insertBefore(panel, ancla);
}

async function empcCargarVinculos() {
  if (EMPC.vinculos) return;
  const otro = EMPC.negocios[0];
  const [v, o] = await Promise.all([
    sbReal.from('empresa_productos_vinculo').select('*'),
    sbReal.rpc('empresa_productos_negocio', { p_negocio: otro.auth_user_id }),
  ]);
  if (v.error || o.error) throw (v.error || o.error);
  EMPC.vinculos = v.data || [];
  EMPC.otros = new Map((o.data || []).map(p => [p.id, p]));
}

async function empcDetalle(filas) {
  try {
    const mio = (filas || []).find(p => p.auth_user_id === STATE.userId && p.tipo === 'producto');
    if (!mio) return;
    await empcCargarVinculos();
    const v = EMPC.vinculos.find(x => x.producto_a === mio.id || x.producto_b === mio.id);
    const otroNeg = EMPC.negocios[0];
    const cuerpo = document.getElementById('ci-detalle-body');
    if (!cuerpo || document.getElementById('empc-detalle')) return;
    const box = document.createElement('div');
    box.id = 'empc-detalle';
    if (!v) {
      box.innerHTML = `<h3 style="font-size:14.5px;margin:16px 0 8px">🔗 En ${esc(otroNeg.nombre_negocio)}</h3>
        <div class="ci-consejo">Este producto todavía no está vinculado con uno de ${esc(otroNeg.nombre_negocio)}. Vincúlalo en Productos → 🔗 Vincular para ver aquí cuánto hay allá.</div>`;
    } else {
      const parId = v.producto_a === mio.id ? v.producto_b : v.producto_a;
      const par = EMPC.otros.get(parId);
      if (!par) return;
      const f = v.producto_a === mio.id ? Number(v.factor) : 1 / Number(v.factor); // 1 de aquí = f de allá
      const allaEnMisUnidades = Number(par.stock_actual || 0) / f;
      const aqui = Number(mio.stock_actual || 0);
      box.innerHTML = `<h3 style="font-size:14.5px;margin:16px 0 8px">🔗 En ${esc(otroNeg.nombre_negocio)}</h3>
        <div class="ci-kpis">
          <div class="ci-kpi"><div class="lbl">Allá (${esc(par.nombre)})</div><div class="val">${fmtNum(par.stock_actual)}</div></div>
          <div class="ci-kpi"><div class="lbl">Equivalencia</div><div class="val">1 aquí = ${fmtNum(f)} allá</div></div>
          <div class="ci-kpi"><div class="lbl">Total de la empresa (en unidades de aquí)</div><div class="val">${fmtNum(aqui + allaEnMisUnidades)}</div></div>
          <div class="ci-kpi"><div class="lbl">Valor allá (a su costo)</div><div class="val">${fmt(Math.max(0, Number(par.stock_actual || 0)) * Number(par.costo || 0))}</div></div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Para pasar mercadería entre los negocios usa Productos → 🔁 Trasladar (queda registrado en los dos).</p>`;
    }
    const tablaWrap = cuerpo.querySelector('.table-wrap');
    if (tablaWrap) tablaWrap.insertAdjacentElement('afterend', box); else cuerpo.appendChild(box);
  } catch (e) { console.warn('empresa-consulta detalle:', e); }
}

// Espera a que consulta-inventario.js tenga la sesión cargada.
(function esperar(n) {
  if (typeof STATE !== 'undefined' && STATE && STATE.userId) { empcIniciar(); return; }
  if (n < 60) setTimeout(() => esperar(n + 1), 250);
})(0);
