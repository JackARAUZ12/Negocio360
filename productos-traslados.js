/* ============================================================
   PRODUCTOS-TRASLADOS.JS — Negocio360
   Traslado de inventario MASIVO entre sucursales/bodegas del grupo.

   - Todo pasa por la función de la base de datos trasladar_stock_lote
     (todo o nada: valida TODO antes de mover un solo producto).
   - Deja un documento (TR-0001…) con su detalle, e historial con
     opción de anular (24 h, solo si el destino no ha usado el stock).
   - NO modifica "Mover productos" (un solo producto), que sigue igual.
   Reutiliza globales de productos.js: supabaseClient, STATE, escHtml,
   showToast(tipo, titulo, msg), cargarProductos, fmtNumeroSimple.
   ============================================================ */
'use strict';

const TR = {
  destinos: [], items: [], sel: new Map(), // sel: id -> cantidad (string/number)
  filtro: { tipo: 'producto', cat: '', q: '', soloMarcados: false },
  paso: 'editar', enviando: false, maxFilas: 300,
};

function trEl(id) { return document.getElementById(id); }
function trNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function trRedondeo(n) { return Math.round(n * 1000) / 1000; }
function trFmt(n) { return (typeof fmtNumeroSimple === 'function') ? fmtNumeroSimple(n) : String(n); }
function trMoneda(n) { return Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function trAsegurarModales() {
  if (trEl('modalTrasladoLote')) return;
  const cont = document.createElement('div');
  cont.innerHTML = `
  <div class="modal-overlay" id="modalTrasladoLote" role="dialog" aria-modal="true">
    <div class="modal modal-lg" style="max-width:980px;width:96vw">
      <div class="modal-header">
        <h2 class="modal-title">🚚 Trasladar varios productos</h2>
        <button class="modal-close" onclick="trCerrar()" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" id="trCuerpo" style="max-height:72vh;overflow-y:auto"></div>
      <div class="modal-footer" id="trPie" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--border);flex-wrap:wrap"></div>
    </div>
  </div>
  <div class="modal-overlay" id="modalTrasladosHistorial" role="dialog" aria-modal="true">
    <div class="modal modal-lg" style="max-width:860px;width:96vw">
      <div class="modal-header">
        <h2 class="modal-title">📜 Historial de traslados</h2>
        <button class="modal-close" onclick="trCerrarHistorial()" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" id="trHistCuerpo" style="max-height:72vh;overflow-y:auto"></div>
    </div>
  </div>`;
  while (cont.firstChild) document.body.appendChild(cont.firstChild);
}

/* ---------- Carga de datos ---------- */
async function trCargarDestinos() {
  const { data: miFila } = await supabaseClient.from('sucursales')
    .select('id').eq('auth_user_id_sucursal', STATE.user.id).eq('es_central', false).maybeSingle();
  const miPropioId = miFila?.id || null;
  const { data, error } = await supabaseClient.rpc('listar_sucursales_grupo');
  if (error) throw error;
  TR.destinos = (data || []).filter(d => miPropioId ? d.id !== miPropioId : !d.es_central);
}

// Trae TODO el inventario (paginado: el catálogo puede pasar de 1000) + marca los que manejan lotes.
async function trCargarInventario() {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseClient.from('productos')
      .select('id, nombre, sku, categoria, tipo, stock_actual, stock_minimo, costo, activo, requiere_numero_serie, es_sustancia_controlada, permite_fraccion')
      .eq('auth_user_id', STATE.user.id).order('nombre').range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const conLote = new Set();
  try {
    for (let desde = 0; ; desde += 1000) {
      const { data } = await supabaseClient.from('producto_lotes').select('producto_id, cantidad_actual, activo')
        .eq('auth_user_id', STATE.user.id).range(desde, desde + 999);
      (data || []).forEach(l => { if (l.activo !== false && Number(l.cantidad_actual) > 0) conLote.add(l.producto_id); });
      if (!data || data.length < 1000) break;
    }
  } catch (e) { console.warn('trCargarInventario lotes:', e); }
  TR.items = filas.filter(p => p.activo !== false && (p.tipo === 'producto' || p.tipo === 'servicio')).map(p => {
    const stock = Number(p.stock_actual) || 0;
    let bloqueo = '';
    if (p.tipo === 'producto') {
      if (p.requiere_numero_serie) bloqueo = 'Maneja números de serie';
      else if (p.es_sustancia_controlada) bloqueo = 'Sustancia controlada';
      else if (conLote.has(p.id)) bloqueo = 'Maneja lotes con vencimiento';
      else if (stock <= 0) bloqueo = 'Sin stock';
    }
    return { ...p, stock, bloqueo };
  });
}

/* ---------- Apertura ---------- */
async function abrirTrasladoLote() {
  trAsegurarModales();
  TR.sel = new Map(); TR.paso = 'editar'; TR.enviando = false;
  TR.filtro = { tipo: 'producto', cat: '', q: '', soloMarcados: false };
  trEl('trCuerpo').innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted)">Cargando inventario y destinos…</p>';
  trEl('trPie').innerHTML = '';
  trEl('modalTrasladoLote').classList.add('open');
  try {
    await Promise.all([trCargarDestinos(), trCargarInventario()]);
    if (!TR.destinos.length) {
      trEl('trCuerpo').innerHTML = '<p style="padding:24px;text-align:center">No tienes otras sucursales o bodegas creadas todavía. Créalas primero en el módulo <b>Sucursales</b>.</p>';
      trEl('trPie').innerHTML = '<button class="btn btn-secondary" onclick="trCerrar()">Cerrar</button>';
      return;
    }
    trRenderEditar();
  } catch (e) {
    console.error('abrirTrasladoLote:', e);
    trEl('trCuerpo').innerHTML = '<p style="padding:24px;text-align:center;color:var(--danger)">No se pudo cargar. Revisa tu conexión e inténtalo de nuevo.</p>';
    trEl('trPie').innerHTML = '<button class="btn btn-secondary" onclick="trCerrar()">Cerrar</button>';
  }
}
function trCerrar() { const m = trEl('modalTrasladoLote'); if (m && !TR.enviando) m.classList.remove('open'); }

/* ---------- Filtrado ---------- */
function trVisibles() {
  const q = TR.filtro.q.trim().toLowerCase();
  return TR.items.filter(p => {
    if (TR.filtro.tipo !== 'todos' && p.tipo !== TR.filtro.tipo) return false;
    if (TR.filtro.cat && (p.categoria || '') !== TR.filtro.cat) return false;
    if (TR.filtro.soloMarcados && !TR.sel.has(p.id)) return false;
    if (q && !((p.nombre || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))) return false;
    return true;
  });
}
const trSeleccionable = p => p.tipo === 'servicio' || !p.bloqueo;

/* ---------- Pantalla 1: elegir ---------- */
function trRenderEditar() {
  TR.paso = 'editar';
  const cats = [...new Set(TR.items.map(p => p.categoria).filter(Boolean))].sort();
  const dest = trEl('trDestino')?.value || TR.destinoId || '';
  const nota = trEl('trNota')?.value ?? TR.nota ?? '';
  const hayServ = TR.items.some(p => p.tipo === 'servicio');
  trEl('trCuerpo').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px">
      <div class="form-group" style="margin:0"><label>Enviar a *</label>
        <select class="form-select" id="trDestino">${TR.destinos.map(d =>
          `<option value="${d.id}" ${d.id === dest ? 'selected' : ''}>${d.tipo === 'bodega' ? '📦' : (d.es_central ? '🏠' : '🏬')} ${escHtml(d.nombre)}${d.es_central ? ' (Central)' : ''}</option>`).join('')}</select></div>
      <div class="form-group" style="margin:0"><label>Nota (opcional)</label>
        <input class="form-input" id="trNota" maxlength="200" placeholder="Ej: reposición semanal" value="${escHtml(nota)}"/></div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input class="form-input" id="trBuscar" placeholder="Buscar nombre o SKU…" value="${escHtml(TR.filtro.q)}" oninput="trCambiaFiltro('q', this.value)" style="flex:1;min-width:180px"/>
      <select class="form-select" onchange="trCambiaFiltro('cat', this.value)" style="max-width:200px">
        <option value="">Todas las categorías</option>
        ${cats.map(c => `<option value="${escHtml(c)}" ${c === TR.filtro.cat ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
      </select>
      <select class="form-select" onchange="trCambiaFiltro('tipo', this.value)" style="max-width:170px">
        <option value="producto" ${TR.filtro.tipo === 'producto' ? 'selected' : ''}>Solo productos</option>
        ${hayServ ? `<option value="servicio" ${TR.filtro.tipo === 'servicio' ? 'selected' : ''}>Solo servicios</option>
        <option value="todos" ${TR.filtro.tipo === 'todos' ? 'selected' : ''}>Productos y servicios</option>` : ''}
      </select>
      <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;cursor:pointer">
        <input type="checkbox" ${TR.filtro.soloMarcados ? 'checked' : ''} onchange="trCambiaFiltro('soloMarcados', this.checked)"/> Ver solo marcados</label>
    </div>

    <div id="trBarra" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;padding:10px;background:var(--bg-app);border-radius:8px"></div>
    <div id="trTabla"></div>
    <p id="trError" style="color:var(--danger);font-size:12.5px;margin-top:8px"></p>`;
  trRefrescar();
}

function trCambiaFiltro(k, v) {
  TR.filtro[k] = v;
  if (k === 'q') { trRefrescar(true); return; }
  trRefrescar();
}

function trRefrescar(mantenerFoco) {
  const pctPrev = trEl('trPct')?.value || '', fijaPrev = trEl('trFija')?.value || '';
  const vis = trVisibles();
  const selVis = vis.filter(p => TR.sel.has(p.id)).length;
  const selecc = vis.filter(trSeleccionable);
  // Barra de acciones (marcar todos + cantidades rápidas)
  trEl('trBarra').innerHTML = `
    <button class="btn btn-secondary btn-sm" onclick="trMarcarTodos(true)">☑ Marcar todos (${selecc.length})</button>
    <button class="btn btn-secondary btn-sm" onclick="trMarcarTodos(false)">☐ Desmarcar todos</button>
    <span style="width:1px;height:22px;background:var(--border)"></span>
    <span style="font-size:12.5px;color:var(--text-secondary)">A los marcados:</span>
    <button class="btn btn-secondary btn-sm" onclick="trAplicar('todo')">Todo el stock</button>
    <span style="display:flex;gap:4px;align-items:center"><input class="form-input" id="trPct" type="number" min="1" max="100" placeholder="%" style="width:64px;padding:5px 8px"/>
      <button class="btn btn-secondary btn-sm" onclick="trAplicar('pct')">Porcentaje</button></span>
    <span style="display:flex;gap:4px;align-items:center"><input class="form-input" id="trFija" type="number" min="0" step="any" placeholder="cant." style="width:76px;padding:5px 8px"/>
      <button class="btn btn-secondary btn-sm" onclick="trAplicar('fija')">Cantidad fija</button></span>
    <button class="btn btn-secondary btn-sm" onclick="trAplicar('minimo')" title="Mueve todo menos el stock mínimo de cada producto">Dejar el mínimo</button>`;
  if (trEl('trPct')) trEl('trPct').value = pctPrev;
  if (trEl('trFija')) trEl('trFija').value = fijaPrev;
  const mostrar = vis.slice(0, TR.maxFilas);
  trEl('trTabla').innerHTML = vis.length ? `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">${vis.length} resultado${vis.length === 1 ? '' : 's'} · ${selVis} marcado${selVis === 1 ? '' : 's'} en esta vista${vis.length > mostrar.length ? ` · mostrando los primeros ${mostrar.length} (“Marcar todos” incluye los ${selecc.length} de la vista)` : ''}</div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--bg-app);text-align:left">
        <th style="padding:8px;width:34px"></th><th style="padding:8px">Producto</th>
        <th style="padding:8px;text-align:right">Stock</th><th style="padding:8px;text-align:right;width:120px">Mover</th><th style="padding:8px;text-align:right">Queda</th></tr></thead>
      <tbody>${mostrar.map(trFila).join('')}</tbody></table></div>`
    : '<p style="padding:18px;text-align:center;color:var(--text-muted)">No hay nada que coincida con el filtro.</p>';
  trPieEditar();
  if (mantenerFoco) { const b = trEl('trBuscar'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }
}

function trFila(p) {
  const marcado = TR.sel.has(p.id);
  const ok = trSeleccionable(p);
  const cant = TR.sel.get(p.id);
  const esServ = p.tipo === 'servicio';
  return `<tr style="border-top:1px solid var(--border);${ok ? '' : 'opacity:.55'}">
    <td style="padding:6px 8px"><input type="checkbox" ${marcado ? 'checked' : ''} ${ok ? '' : 'disabled'} onchange="trMarcar('${p.id}', this.checked)"/></td>
    <td style="padding:6px 8px"><strong>${escHtml(p.nombre)}</strong>${esServ ? ' <span style="font-size:11px;color:var(--text-muted)">· servicio</span>' : ''}
      <div style="font-size:11.5px;color:var(--text-muted)">${p.sku ? 'SKU: ' + escHtml(p.sku) + ' · ' : ''}${escHtml(p.categoria || 'Sin categoría')}${p.bloqueo ? ' · <span style="color:var(--danger)">' + escHtml(p.bloqueo) + '</span>' : ''}</div></td>
    <td style="padding:6px 8px;text-align:right">${esServ ? '—' : trFmt(p.stock)}</td>
    <td style="padding:6px 8px;text-align:right">${esServ ? (marcado ? 'catálogo' : '—')
      : `<input type="number" class="form-input" min="0" max="${p.stock}" step="any" value="${marcado && cant !== undefined ? cant : ''}" ${marcado ? '' : 'disabled'}
          oninput="trCambiaCant('${p.id}', this.value)" style="width:100px;padding:5px 8px;text-align:right" data-cant="${p.id}"/>`}</td>
    <td style="padding:6px 8px;text-align:right" data-queda="${p.id}">${esServ ? '—' : (marcado ? trFmt(trRedondeo(p.stock - trNum(cant))) : '')}</td></tr>`;
}

function trMarcar(id, on) {
  const p = TR.items.find(x => x.id === id); if (!p) return;
  if (on) TR.sel.set(id, p.tipo === 'servicio' ? 0 : p.stock); else TR.sel.delete(id);
  trRefrescar();
}
function trMarcarTodos(on) {
  const vis = trVisibles().filter(trSeleccionable);
  vis.forEach(p => { if (on) { if (!TR.sel.has(p.id)) TR.sel.set(p.id, p.tipo === 'servicio' ? 0 : p.stock); } else TR.sel.delete(p.id); });
  trRefrescar();
}
function trCambiaCant(id, v) {
  TR.sel.set(id, v);
  const p = TR.items.find(x => x.id === id);
  const celda = document.querySelector(`[data-queda="${id}"]`);
  if (celda && p) celda.textContent = trFmt(trRedondeo(p.stock - trNum(v)));
  trPieEditar();
}
function trAplicar(modo) {
  const err = trEl('trError'); if (err) err.textContent = '';
  const marcados = TR.items.filter(p => TR.sel.has(p.id) && p.tipo === 'producto');
  if (!marcados.length) { if (err) err.textContent = 'Primero marca los productos a los que quieres aplicar la cantidad.'; return; }
  const pct = trNum(trEl('trPct')?.value), fija = trNum(trEl('trFija')?.value);
  if (modo === 'pct' && (pct <= 0 || pct > 100)) { err.textContent = 'Escribe un porcentaje entre 1 y 100.'; return; }
  if (modo === 'fija' && fija <= 0) { err.textContent = 'Escribe una cantidad fija mayor a cero.'; return; }
  marcados.forEach(p => {
    let c = p.stock;
    if (modo === 'pct') c = p.stock * pct / 100;
    else if (modo === 'fija') c = Math.min(fija, p.stock);
    else if (modo === 'minimo') c = Math.max(0, p.stock - (Number(p.stock_minimo) || 0));
    if (modo !== 'todo' && !p.permite_fraccion) c = Math.floor(c + 1e-9);
    TR.sel.set(p.id, trRedondeo(Math.min(c, p.stock)));
  });
  trRefrescar();
}

function trResumenSel() {
  let prods = 0, unidades = 0, costo = 0, servs = 0, ceros = 0;
  TR.sel.forEach((cant, id) => {
    const p = TR.items.find(x => x.id === id); if (!p) return;
    if (p.tipo === 'servicio') { servs++; return; }
    const c = trNum(cant);
    if (c <= 0) { ceros++; return; }
    prods++; unidades += c; costo += c * (Number(p.costo) || 0);
  });
  return { prods, unidades: trRedondeo(unidades), costo, servs, ceros };
}
function trPieEditar() {
  const r = trResumenSel();
  trEl('trPie').innerHTML = `
    <div style="font-size:13px"><b>${r.prods}</b> producto${r.prods === 1 ? '' : 's'} · <b>${trFmt(r.unidades)}</b> unidades${r.servs ? ` · ${r.servs} servicio${r.servs === 1 ? '' : 's'}` : ''}</div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-secondary" onclick="trCerrar()">Cancelar</button>
      <button class="btn btn-primary" onclick="trRevisar()" ${(r.prods + r.servs) ? '' : 'disabled'}>Revisar traslado →</button>
    </div>`;
}

/* ---------- Pantalla 2: revisar y confirmar ---------- */
function trRevisar() {
  const err = trEl('trError'); if (err) err.textContent = '';
  const filas = [];
  const problemas = [];
  TR.sel.forEach((cant, id) => {
    const p = TR.items.find(x => x.id === id); if (!p) return;
    if (p.tipo === 'servicio') { filas.push({ p, cant: 0 }); return; }
    const c = trNum(cant);
    if (c <= 0) return; // fila marcada sin cantidad: se omite
    if (c > p.stock + 1e-9) problemas.push(`"${p.nombre}": quieres mover ${trFmt(c)} y solo hay ${trFmt(p.stock)}.`);
    filas.push({ p, cant: c });
  });
  if (problemas.length) {
    if (err) err.innerHTML = problemas.slice(0, 5).map(escHtml).join('<br>') + (problemas.length > 5 ? `<br>… y ${problemas.length - 5} más` : '');
    return;
  }
  if (!filas.length) { if (err) err.textContent = 'No hay ninguna cantidad mayor a cero para trasladar.'; return; }
  if (filas.length > 3000) { if (err) err.textContent = 'Máximo 3000 productos por traslado. Divídelo en dos.'; return; }
  TR.paso = 'resumen'; TR.filas = filas;
  const destSel = trEl('trDestino')?.value; const nota = trEl('trNota')?.value || '';
  TR.destinoId = destSel; TR.nota = nota;
  const d = TR.destinos.find(x => x.id === destSel);
  const prods = filas.filter(f => f.p.tipo === 'producto');
  const servs = filas.filter(f => f.p.tipo === 'servicio');
  const unidades = trRedondeo(prods.reduce((a, f) => a + f.cant, 0));
  const costo = prods.reduce((a, f) => a + f.cant * (Number(f.p.costo) || 0), 0);
  const omitidos = trResumenSel().ceros;
  trEl('trCuerpo').innerHTML = `
    <div style="padding:14px;background:var(--bg-app);border-radius:8px;margin-bottom:12px">
      <div style="font-size:13px;color:var(--text-secondary)">Enviar a</div>
      <div style="font-size:16px;font-weight:700">${d ? (d.tipo === 'bodega' ? '📦 ' : '🏬 ') + escHtml(d.nombre) : '—'}</div>
      ${nota ? `<div style="font-size:12.5px;margin-top:4px">Nota: ${escHtml(nota)}</div>` : ''}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      ${[['Productos', prods.length], ['Unidades', trFmt(unidades)], ['Valor al costo', 'C$ ' + trMoneda(costo)]].concat(servs.length ? [['Servicios (catálogo)', servs.length]] : []).map(([l, v]) => `
        <div style="flex:1;min-width:130px;background:var(--bg-app);border-radius:8px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:800">${v}</div><div style="font-size:11.5px;color:var(--text-secondary)">${l}</div></div>`).join('')}
    </div>
    ${omitidos ? `<p style="font-size:12.5px;color:#92400E">⚠ ${omitidos} producto${omitidos === 1 ? '' : 's'} marcado${omitidos === 1 ? '' : 's'} sin cantidad se omitirá${omitidos === 1 ? '' : 'n'}.</p>` : ''}
    ${servs.length ? '<p style="font-size:12.5px;color:var(--text-secondary)">Los servicios se copian al catálogo del destino (sin stock) si todavía no existen allí.</p>' : ''}
    <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr style="background:var(--bg-app);text-align:left"><th style="padding:6px 8px">Producto</th><th style="padding:6px 8px;text-align:right">Cantidad</th><th style="padding:6px 8px;text-align:right">Queda en origen</th></tr></thead>
      <tbody>${filas.slice(0, 500).map(f => `<tr style="border-top:1px solid var(--border)"><td style="padding:5px 8px">${escHtml(f.p.nombre)}</td>
        <td style="padding:5px 8px;text-align:right">${f.p.tipo === 'servicio' ? 'catálogo' : trFmt(f.cant)}</td>
        <td style="padding:5px 8px;text-align:right">${f.p.tipo === 'servicio' ? '—' : trFmt(trRedondeo(f.p.stock - f.cant))}</td></tr>`).join('')}
        ${filas.length > 500 ? `<tr><td colspan="3" style="padding:6px 8px;color:var(--text-muted)">… y ${filas.length - 500} más</td></tr>` : ''}</tbody></table></div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:10px">Es todo o nada: si algo no se puede trasladar, no se mueve ningún producto. Los productos que ya existan en el destino (mismo nombre) suman stock; los que no, se crean allí.</p>
    <p id="trError" style="color:var(--danger);font-size:12.5px;margin-top:8px"></p>`;
  trEl('trPie').innerHTML = `
    <button class="btn btn-secondary" onclick="trRenderEditar()">← Volver</button>
    <button class="btn btn-primary" id="trBtnConfirmar" onclick="trConfirmar()">✔ Confirmar traslado</button>`;
}

async function trConfirmar() {
  if (TR.enviando) return;
  const err = trEl('trError'); if (err) err.textContent = '';
  const items = TR.filas.map(f => ({ producto_id: f.p.id, cantidad: f.p.tipo === 'servicio' ? 0 : f.cant }));
  const hayServ = TR.filas.some(f => f.p.tipo === 'servicio');
  TR.enviando = true;
  const btn = trEl('trBtnConfirmar'); if (btn) { btn.disabled = true; btn.textContent = 'Trasladando…'; }
  try {
    const { data, error } = await supabaseClient.rpc('trasladar_stock_lote', {
      p_sucursal_destino_id: TR.destinoId, p_items: items, p_nota: TR.nota || null, p_copiar_servicios: hayServ,
    });
    if (error) throw error;
    TR.enviando = false;
    trEl('trCuerpo').innerHTML = `
      <div style="text-align:center;padding:24px">
        <div style="font-size:42px">✅</div>
        <h3 style="margin:6px 0">Traslado ${escHtml(data.numero)} completado</h3>
        <p style="color:var(--text-secondary);font-size:13.5px">${data.productos} producto${data.productos === 1 ? '' : 's'} · ${trFmt(Number(data.unidades))} unidades${data.servicios ? ` · ${data.servicios} servicio${data.servicios === 1 ? '' : 's'} copiado${data.servicios === 1 ? '' : 's'}` : ''}</p>
        <p style="color:var(--text-muted);font-size:12px">Puedes consultarlo o anularlo (dentro de 24 horas) en “Historial de traslados”.</p>
      </div>`;
    trEl('trPie').innerHTML = `<button class="btn btn-secondary" onclick="trCerrar(); abrirHistorialTraslados()">Ver historial</button><button class="btn btn-primary" onclick="trCerrar()">Listo</button>`;
    showToast('success', 'Traslado completado', `${data.numero}: ${data.productos} productos`);
    if (typeof cargarProductos === 'function') cargarProductos();
  } catch (e) {
    TR.enviando = false;
    console.error('trConfirmar:', e);
    if (btn) { btn.disabled = false; btn.textContent = '✔ Confirmar traslado'; }
    if (err) err.textContent = 'No se trasladó nada. ' + (e.message || 'Inténtalo de nuevo.');
  }
}

/* ---------- Historial ---------- */
async function abrirHistorialTraslados() {
  trAsegurarModales();
  trEl('modalTrasladosHistorial').classList.add('open');
  const cont = trEl('trHistCuerpo');
  cont.innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted)">Cargando…</p>';
  try {
    const { data, error } = await supabaseClient.from('traslados_inventario').select('*')
      .or(`auth_user_id.eq.${STATE.user.id},auth_user_destino.eq.${STATE.user.id}`).order('fecha', { ascending: false }).limit(100);
    if (error) throw error;
    if (!data || !data.length) { cont.innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted)">Todavía no hay traslados. Usa “Trasladar varios”.</p>'; return; }
    cont.innerHTML = data.map(t => {
      const mio = t.auth_user_id === STATE.user.id;
      const reciente = (Date.now() - new Date(t.fecha).getTime()) < 24 * 3600 * 1000;
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
          <div><strong>${escHtml(t.numero)}</strong> · ${mio ? 'enviado a' : 'recibido de otra cuenta, destino'} <b>${escHtml(t.destino_nombre || '—')}</b>
            <div style="font-size:12px;color:var(--text-muted)">${new Date(t.fecha).toLocaleString('es-NI')}${t.nota ? ' · ' + escHtml(t.nota) : ''}</div></div>
          <div style="text-align:right;font-size:12.5px">${t.total_productos} prod. · ${trFmt(Number(t.total_unidades))} u. · C$ ${trMoneda(t.total_costo)}
            <div>${t.estado === 'anulado' ? '<span style="color:var(--danger);font-weight:600">ANULADO</span>' : '<span style="color:var(--success);font-weight:600">Completado</span>'}</div></div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="trVerDetalle('${t.id}', this)">Ver detalle</button>
          ${mio && t.estado === 'completado' && reciente ? `<button class="btn btn-secondary btn-sm" style="color:var(--danger)" onclick="trAnular('${t.id}', '${escHtml(t.numero)}')">Anular</button>` : ''}
        </div>
        <div id="trDet-${t.id}" style="display:none;margin-top:8px"></div></div>`;
    }).join('');
  } catch (e) {
    console.error('abrirHistorialTraslados:', e);
    cont.innerHTML = '<p style="padding:24px;text-align:center;color:var(--danger)">No se pudo cargar el historial.</p>';
  }
}
function trCerrarHistorial() { trEl('modalTrasladosHistorial')?.classList.remove('open'); }

async function trVerDetalle(id, btn) {
  const cont = trEl('trDet-' + id);
  if (cont.style.display === 'block') { cont.style.display = 'none'; return; }
  cont.style.display = 'block'; cont.innerHTML = 'Cargando…';
  try {
    const { data, error } = await supabaseClient.from('traslados_inventario_items').select('nombre, tipo, cantidad, creado_destino')
      .eq('traslado_id', id).order('nombre').limit(2000);
    if (error) throw error;
    cont.innerHTML = `<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12.5px">
      ${(data || []).map(i => `<tr style="border-top:1px solid var(--border)"><td style="padding:5px 8px">${escHtml(i.nombre)}${i.creado_destino ? ' <span style="font-size:11px;color:var(--text-muted)">· creado en destino</span>' : ''}</td>
        <td style="padding:5px 8px;text-align:right">${i.tipo === 'servicio' ? 'catálogo' : trFmt(Number(i.cantidad))}</td></tr>`).join('')}</table></div>`;
  } catch (e) { cont.innerHTML = '<span style="color:var(--danger)">No se pudo cargar el detalle.</span>'; }
}

async function trAnular(id, numero) {
  if (!confirm(`¿Anular el traslado ${numero}? El stock volverá a tu inventario y se descontará del destino (solo si el destino no ha vendido ni usado lo recibido).`)) return;
  try {
    const { error } = await supabaseClient.rpc('anular_traslado_inventario', { p_traslado_id: id });
    if (error) throw error;
    showToast('success', 'Traslado anulado', `${numero}: el stock volvió a tu inventario`);
    if (typeof cargarProductos === 'function') cargarProductos();
    abrirHistorialTraslados();
  } catch (e) {
    console.error('trAnular:', e);
    showToast('error', 'No se pudo anular', e.message || 'Inténtalo de nuevo');
  }
}

window.abrirTrasladoLote = abrirTrasladoLote;
window.abrirHistorialTraslados = abrirHistorialTraslados;
