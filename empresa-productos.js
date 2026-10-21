/* ============================================================
   EMPRESA-PRODUCTOS.JS — Negocio360
   Solo para negocios que forman una EMPRESA vinculada
   (ej. All Plastic Comercial + All Plastic Mayorista). Para las demás
   cuentas no agrega nada (empresa_mis_negocios() devuelve vacío).

   1) 🔗 Vincular productos: este producto = aquel del otro negocio y
      su equivalencia (1 bulto = 40 paquetes). No cambia stock, precios
      ni costos.
   2) 🔁 Trasladar: saca mercadería de este negocio y la mete en el otro,
      convertida, a costo, con su asiento en los dos libros. Todo pasa
      por la función empresa_trasladar (todo o nada; primero se calcula
      la vista previa y se confirma).
   3) 📜 Traslados entre negocios: historial, detalle y anulación (el
      mismo día, si el otro negocio aún tiene la mercadería).
   Reutiliza de productos.js: supabaseClient, STATE, escHtml, showToast,
   cargarProductos.
   ============================================================ */
'use strict';

const EMP = { negocios: [], otro: null, mios: [], otros: [], vinculos: [], sug: [], tab: 'sug', q: '', tq: '', cant: new Map(), enviando: false };

function empEl(id) { return document.getElementById(id); }
function empNum(v) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
function empFmt(n, d = 3) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: d }); }
function empMon(n) { return Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function empNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function empUsuario() { try { return (JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null') || {}).nombre || null; } catch (_) { return null; } }
function empError(e) { return (e && (e.message || e.details)) || 'Inténtalo de nuevo.'; }

/* ---------- Arranque: solo si hay empresa ---------- */
async function empIniciar() {
  try {
    if (typeof supabaseClient === 'undefined') return;
    const { data, error } = await supabaseClient.rpc('empresa_mis_negocios');
    if (error || !Array.isArray(data) || !data.length) return;
    EMP.negocios = data; EMP.otro = data[0];
    const ancla = document.querySelector('button[onclick="abrirHistorialTraslados()"]');
    if (!ancla || empEl('btnEmpVincular')) return;
    const otro = escHtml(EMP.otro.nombre_negocio);
    ancla.insertAdjacentHTML('afterend', `
      <button class="btn btn-secondary btn-sm" id="btnEmpVincular" onclick="empAbrirVincular()" title="Decir qué producto de ${otro} es el mismo que uno de aquí y su equivalencia">🔗 Vincular con ${otro}</button>
      <button class="btn btn-secondary btn-sm" id="btnEmpTrasladar" onclick="empAbrirTrasladar()" title="Enviar mercadería a ${otro} (con su asiento en los dos negocios)">🔁 Trasladar a ${otro}</button>
      <button class="btn btn-secondary btn-sm" id="btnEmpHistorial" onclick="empAbrirHistorial()" title="Traslados entre los negocios de la empresa">📜 Traslados entre negocios</button>`);
    empAsegurarModal();
  } catch (e) { console.warn('empresa-productos:', e); }
}

function empAsegurarModal() {
  if (empEl('modalEmpresa')) return;
  const d = document.createElement('div');
  d.innerHTML = `
  <div class="modal-overlay" id="modalEmpresa" role="dialog" aria-modal="true">
    <div class="modal modal-lg" style="max-width:1020px;width:96vw">
      <div class="modal-header">
        <h2 class="modal-title" id="empTitulo">Empresa</h2>
        <button class="modal-close" onclick="empCerrar()" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" id="empCuerpo" style="max-height:70vh;overflow-y:auto"></div>
      <div class="modal-footer" id="empPie" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--border);flex-wrap:wrap"></div>
    </div>
  </div>`;
  document.body.appendChild(d.firstElementChild);
}
function empAbrir(titulo) {
  empAsegurarModal();
  empEl('empTitulo').textContent = titulo;
  empEl('empCuerpo').innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted)">Cargando…</p>';
  empEl('empPie').innerHTML = '';
  empEl('modalEmpresa').classList.add('open');
}
function empCerrar() { if (!EMP.enviando) empEl('modalEmpresa')?.classList.remove('open'); }

async function empCargarBase() {
  const pag = async (fn) => { const t = []; for (let d = 0; ; d += 1000) { const { data, error } = await fn(d); if (error) throw error; t.push(...(data || [])); if (!data || data.length < 1000) break; } return t; };
  const [mios, otros, vinc] = await Promise.all([
    pag(d => supabaseClient.rpc('empresa_productos_negocio', { p_negocio: STATE.user.id }).range(d, d + 999)),
    pag(d => supabaseClient.rpc('empresa_productos_negocio', { p_negocio: EMP.otro.auth_user_id }).range(d, d + 999)),
    pag(d => supabaseClient.from('empresa_productos_vinculo').select('*').range(d, d + 999)),
  ]);
  mios.forEach(p => { p.mio = true; }); otros.forEach(p => { p.mio = false; });
  EMP.mios = mios; EMP.otros = otros; EMP.vinculos = vinc;
  EMP.porId = new Map([...mios.map(p => [p.id, p]), ...otros.map(p => [p.id, p])]);
  EMP.vincPorProd = new Map(); vinc.forEach(v => { EMP.vincPorProd.set(v.producto_a, v); EMP.vincPorProd.set(v.producto_b, v); });
}

/* ============================================================
   1) VINCULAR
   ============================================================ */
// Sugerencia: mismo nombre. La unidad mayor es la de mayor costo; la
// equivalencia se propone con la relación de costos y se marca "segura"
// solo si ese número aparece en el nombre (1X40, 1X10…) o es exacta.
function empSugerir() {
  const otrosPorNombre = new Map();
  EMP.otros.forEach(q => { const k = empNorm(q.nombre); if (!otrosPorNombre.has(k)) otrosPorNombre.set(k, []); otrosPorNombre.get(k).push(q); });
  const sug = [];
  EMP.mios.forEach(p => {
    if (EMP.vincPorProd.has(p.id)) return;
    const cands = (otrosPorNombre.get(empNorm(p.nombre)) || []).filter(q => !EMP.vincPorProd.has(q.id));
    if (cands.length !== 1) return; // nombre repetido: mejor vincularlo a mano
    const q = cands[0];
    const cp = Number(p.costo) || 0, cq = Number(q.costo) || 0;
    let a = p, b = q, factor = '', conf = 'revisar', nota = 'Sin costo para comparar: escribe la equivalencia';
    if (cp > 0 && cq > 0) {
      if (cq > cp) { a = q; b = p; }
      const ratio = Math.max(cp, cq) / Math.min(cp, cq);
      const r = Math.round(ratio);
      const numsNombre = (String(p.nombre).match(/\d+/g) || []).map(Number);
      const err = Math.abs(ratio - r) / ratio;
      factor = r;
      if (r === 1 && err < 0.02) { conf = 'segura'; nota = 'Misma unidad en los dos negocios'; }
      else if (err < 0.03 && numsNombre.includes(r)) { conf = 'segura'; nota = `El nombre dice ${r}`; }
      else if (err < 0.01) { conf = 'probable'; nota = 'Por los costos'; }
      else { conf = 'revisar'; nota = `Por costos da ${empFmt(ratio, 2)}: revisa`; }
    }
    sug.push({ key: p.id + '|' + q.id, a, b, factor, conf, nota, marcado: conf === 'segura' });
  });
  const orden = { segura: 0, probable: 1, revisar: 2 };
  sug.sort((x, y) => orden[x.conf] - orden[y.conf] || empNorm(x.a.nombre).localeCompare(empNorm(y.a.nombre)));
  EMP.sug = sug;
}
function empNombreNegocio(prod) { return prod.mio ? 'aquí' : EMP.otro.nombre_negocio; }

async function empAbrirVincular() {
  empAbrir(`🔗 Vincular productos con ${EMP.otro.nombre_negocio}`);
  try {
    await empCargarBase();
    empSugerir(); EMP.tab = 'sug'; EMP.q = '';
    empRenderVincular();
  } catch (e) {
    console.error(e);
    empEl('empCuerpo').innerHTML = `<p style="padding:24px;text-align:center;color:var(--danger)">No se pudo cargar: ${escHtml(empError(e))}</p>`;
    empEl('empPie').innerHTML = '<button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button>';
  }
}

function empRenderVincular() {
  const tabs = [['sug', `Sugeridos (${EMP.sug.length})`], ['vinc', `Vinculados (${EMP.vinculos.length})`], ['manual', 'Vincular a mano']];
  const q = empNorm(EMP.q);
  let cuerpo = '';
  if (EMP.tab === 'sug') {
    const lista = EMP.sug.filter(s => !q || empNorm(s.a.nombre).includes(q));
    const marc = EMP.sug.filter(s => s.marcado).length;
    cuerpo = `<p style="font-size:12.5px;color:var(--text-muted);margin:0 0 8px">Productos con el mismo nombre en los dos negocios. Marca los correctos y revisa la equivalencia (cuántas unidades del pequeño trae 1 del grande). Vincular <b>no cambia</b> stock, precios ni costos.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><input class="form-input" id="empQ" placeholder="Buscar…" value="${escHtml(EMP.q)}" oninput="EMP.q=this.value;empRenderVincular()" style="flex:1;min-width:200px">
      <button class="btn btn-secondary btn-sm" onclick="EMP.sug.forEach(s=>s.marcado=s.conf==='segura');empRenderVincular()">Marcar solo seguros</button>
      <button class="btn btn-secondary btn-sm" onclick="EMP.sug.forEach(s=>s.marcado=false);empRenderVincular()">Desmarcar todo</button></div>
      ${lista.length ? `<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr style="text-align:left;color:var(--text-muted)"><th></th><th>1 unidad de</th><th style="width:110px">equivale a</th><th>de</th><th>Cómo se calculó</th></tr></thead><tbody>
      ${lista.slice(0, 400).map(s => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:6px"><input type="checkbox" ${s.marcado ? 'checked' : ''} onchange="empSugMarcar('${s.key}',this.checked)"></td>
        <td style="padding:6px"><b>${escHtml(s.a.nombre)}</b><div style="font-size:11px;color:var(--text-muted)">${escHtml(empNombreNegocio(s.a))} · costo C$ ${empMon(s.a.costo)}</div></td>
        <td style="padding:6px"><input class="form-input" style="width:90px;height:30px" inputmode="decimal" value="${s.factor}" onchange="empSugFactor('${s.key}',this.value)"></td>
        <td style="padding:6px">${escHtml(s.b.nombre)}<div style="font-size:11px;color:var(--text-muted)">${escHtml(empNombreNegocio(s.b))} · costo C$ ${empMon(s.b.costo)}</div></td>
        <td style="padding:6px;font-size:11.5px;color:${s.conf === 'segura' ? 'var(--success)' : s.conf === 'probable' ? 'var(--text-muted)' : 'var(--warning,#b45309)'}">${escHtml(s.nota)}</td></tr>`).join('')}
      </tbody></table>${lista.length > 400 ? '<p style="font-size:12px;color:var(--text-muted)">Se muestran 400; usa el buscador para ver los demás.</p>' : ''}` : '<p style="padding:16px;text-align:center;color:var(--text-muted)">No hay sugerencias pendientes.</p>'}`;
    empEl('empPie').innerHTML = `<span style="font-size:12.5px;color:var(--text-muted)">${marc} marcado(s)</span>
      <div style="display:flex;gap:8px"><button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button>
      <button class="btn btn-primary" id="empBtnGuardar" onclick="empGuardarSugeridos()" ${marc ? '' : 'disabled'}>Vincular ${marc} producto(s)</button></div>`;
  } else if (EMP.tab === 'vinc') {
    const lista = EMP.vinculos.map(v => ({ v, a: EMP.porId.get(v.producto_a), b: EMP.porId.get(v.producto_b) }))
      .filter(x => x.a && x.b && (!q || empNorm(x.a.nombre).includes(q) || empNorm(x.b.nombre).includes(q)));
    cuerpo = `<div style="margin-bottom:8px"><input class="form-input" id="empQ" placeholder="Buscar…" value="${escHtml(EMP.q)}" oninput="EMP.q=this.value;empRenderVincular()" style="width:100%"></div>
      ${lista.length ? `<table style="width:100%;border-collapse:collapse;font-size:12.5px"><tbody>${lista.map(x => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:6px">1 <b>${escHtml(x.a.nombre)}</b> <span style="font-size:11px;color:var(--text-muted)">(${escHtml(empNombreNegocio(x.a))})</span></td>
        <td style="padding:6px;white-space:nowrap">= ${empFmt(x.v.factor, 4)}</td>
        <td style="padding:6px">${escHtml(x.b.nombre)} <span style="font-size:11px;color:var(--text-muted)">(${escHtml(empNombreNegocio(x.b))})</span></td>
        <td style="padding:6px;text-align:right"><button class="btn btn-secondary btn-sm" onclick="empCambiarFactor('${x.v.id}')">Cambiar</button>
          <button class="btn btn-secondary btn-sm" style="color:var(--danger)" onclick="empDesvincular('${x.v.id}')">Quitar</button></td></tr>`).join('')}</tbody></table>`
      : '<p style="padding:16px;text-align:center;color:var(--text-muted)">Todavía no hay productos vinculados.</p>'}`;
    empEl('empPie').innerHTML = '<span></span><button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button>';
  } else {
    const libres = arr => arr.filter(p => !EMP.vincPorProd.has(p.id));
    const opts = arr => libres(arr).map(p => `<option value="${p.id}">${escHtml(p.nombre)} · C$ ${empMon(p.costo)}</option>`).join('');
    cuerpo = `<p style="font-size:12.5px;color:var(--text-muted);margin:0 0 10px">Para productos con nombre distinto. Elige el de aquí, el de ${escHtml(EMP.otro.nombre_negocio)} y cuántas unidades del pequeño trae 1 del grande.</p>
      <div style="display:grid;gap:10px;max-width:680px">
        <label style="font-size:12.5px">Producto de aquí<select class="form-select" id="empManMio" style="width:100%"><option value="">— Elegir —</option>${opts(EMP.mios)}</select></label>
        <label style="font-size:12.5px">Producto de ${escHtml(EMP.otro.nombre_negocio)}<select class="form-select" id="empManOtro" style="width:100%"><option value="">— Elegir —</option>${opts(EMP.otros)}</select></label>
        <label style="font-size:12.5px">1 unidad del producto de mayor costo equivale a cuántas del otro<input class="form-input" id="empManFactor" inputmode="decimal" placeholder="Ej. 40" style="width:160px"></label>
        <div id="empManErr" style="color:var(--danger);font-size:12.5px;min-height:16px"></div>
      </div>`;
    empEl('empPie').innerHTML = '<button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button><button class="btn btn-primary" onclick="empGuardarManual()">Vincular</button>';
  }
  empEl('empCuerpo').innerHTML = `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">${tabs.map(([k, l]) => `<button class="btn btn-sm ${EMP.tab === k ? 'btn-primary' : 'btn-secondary'}" onclick="EMP.tab='${k}';EMP.q='';empRenderVincular()">${l}</button>`).join('')}</div>${cuerpo}`;
  const qi = empEl('empQ'); if (qi && EMP.q) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
}
function empSugMarcar(key, v) { const s = EMP.sug.find(x => x.key === key); if (s) s.marcado = v; const marc = EMP.sug.filter(x => x.marcado).length; const b = empEl('empBtnGuardar'); if (b) { b.disabled = !marc; b.textContent = `Vincular ${marc} producto(s)`; } }
function empSugFactor(key, v) { const s = EMP.sug.find(x => x.key === key); if (s) { s.factor = v; s.marcado = empNum(v) > 0; empRenderVincular(); } }

async function empGuardarVinculos(items) {
  const { data, error } = await supabaseClient.rpc('empresa_vincular_productos', { p_items: items, p_usuario: empUsuario() });
  if (error) throw error;
  return data;
}
async function empGuardarSugeridos() {
  const marc = EMP.sug.filter(s => s.marcado);
  const malos = marc.filter(s => !(empNum(s.factor) > 0));
  if (malos.length) { showToast('error', 'Falta la equivalencia', `${malos[0].a.nombre}: escribe cuántas unidades trae`); return; }
  const b = empEl('empBtnGuardar'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
  try {
    let total = 0;
    for (let i = 0; i < marc.length; i += 500) {
      total += await empGuardarVinculos(marc.slice(i, i + 500).map(s => ({ producto_a: s.a.id, producto_b: s.b.id, factor: empNum(s.factor) })));
    }
    showToast('success', 'Productos vinculados', `${total} vínculo(s) guardado(s). No cambió ningún stock ni precio.`);
    await empCargarBase(); empSugerir(); EMP.tab = 'vinc'; empRenderVincular();
  } catch (e) {
    showToast('error', 'No se guardó ningún vínculo', empError(e));
    if (b) { b.disabled = false; b.textContent = `Vincular ${marc.length} producto(s)`; }
  }
}
async function empGuardarManual() {
  const err = empEl('empManErr'); err.textContent = '';
  const p = EMP.porId.get(empEl('empManMio').value), q = EMP.porId.get(empEl('empManOtro').value), f = empNum(empEl('empManFactor').value);
  if (!p || !q) { err.textContent = 'Elige los dos productos.'; return; }
  if (!(f > 0)) { err.textContent = 'Escribe la equivalencia (mayor que 0).'; return; }
  const [a, b] = (Number(q.costo) || 0) > (Number(p.costo) || 0) ? [q, p] : [p, q];
  if (!confirm(`¿Vincular?\n\n1 ${a.nombre} (${empNombreNegocio(a)}) = ${f} ${b.nombre} (${empNombreNegocio(b)})`)) return;
  try {
    await empGuardarVinculos([{ producto_a: a.id, producto_b: b.id, factor: f }]);
    showToast('success', 'Vinculado', `${a.nombre} ↔ ${b.nombre}`);
    await empCargarBase(); empSugerir(); empRenderVincular();
  } catch (e) { err.textContent = empError(e); }
}
async function empCambiarFactor(id) {
  const v = EMP.vinculos.find(x => x.id === id); if (!v) return;
  const a = EMP.porId.get(v.producto_a), b = EMP.porId.get(v.producto_b);
  const nuevo = prompt(`1 ${a.nombre} equivale a cuántas unidades de ${b.nombre}?`, String(Number(v.factor)));
  if (nuevo === null) return;
  const f = empNum(nuevo); if (!(f > 0)) { showToast('error', 'Equivalencia no válida', 'Debe ser mayor que 0'); return; }
  try { await empGuardarVinculos([{ producto_a: a.id, producto_b: b.id, factor: f }]); showToast('success', 'Equivalencia actualizada', `1 = ${f}`); await empCargarBase(); empRenderVincular(); }
  catch (e) { showToast('error', 'No se cambió', empError(e)); }
}
async function empDesvincular(id) {
  if (!confirm('¿Quitar este vínculo? Los productos no cambian; solo dejan de estar unidos (ya no se podrán trasladar hasta vincularlos otra vez).')) return;
  try {
    const { error } = await supabaseClient.rpc('empresa_desvincular_productos', { p_ids: [id] });
    if (error) throw error;
    await empCargarBase(); empSugerir(); empRenderVincular();
  } catch (e) { showToast('error', 'No se quitó', empError(e)); }
}

/* ============================================================
   2) TRASLADAR
   ============================================================ */
async function empAbrirTrasladar() {
  empAbrir(`🔁 Trasladar a ${EMP.otro.nombre_negocio}`);
  EMP.cant = new Map(); EMP.tq = ''; EMP.enviando = false;
  try {
    await empCargarBase();
    empRenderTrasladar();
  } catch (e) {
    empEl('empCuerpo').innerHTML = `<p style="padding:24px;text-align:center;color:var(--danger)">No se pudo cargar: ${escHtml(empError(e))}</p>`;
    empEl('empPie').innerHTML = '<button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button>';
  }
}
function empLineasTraslado() {
  // Mis productos vinculados con el otro negocio, con su par y el factor desde MI lado.
  return EMP.mios.filter(p => p.activo !== false).map(p => {
    const v = EMP.vincPorProd.get(p.id); if (!v) return null;
    const parId = v.producto_a === p.id ? v.producto_b : v.producto_a;
    const par = EMP.porId.get(parId); if (!par || par.mio) return null;
    const f = v.producto_a === p.id ? Number(v.factor) : 1 / Number(v.factor);
    return { p, par, f };
  }).filter(Boolean);
}
function empRenderTrasladar() {
  const todas = empLineasTraslado();
  const q = empNorm(EMP.tq);
  const lista = todas.filter(x => !q || empNorm(x.p.nombre).includes(q));
  const sel = [...EMP.cant.entries()].filter(([, c]) => empNum(c) > 0);
  empEl('empCuerpo').innerHTML = todas.length ? `
    <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 8px">Escribe cuánto envías de cada producto (en las unidades de aquí). Se convierte solo a las unidades de ${escHtml(EMP.otro.nombre_negocio)}. Solo aparecen productos vinculados.</p>
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><input class="form-input" id="empTQ" placeholder="Buscar producto…" value="${escHtml(EMP.tq)}" oninput="EMP.tq=this.value;empRenderTrasladar()" style="flex:1;min-width:200px">
      <input class="form-input" id="empNota" placeholder="Nota (opcional)" value="${escHtml(EMP.nota || '')}" oninput="EMP.nota=this.value" style="flex:1;min-width:200px"></div>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr style="text-align:left;color:var(--text-muted)"><th>Producto (aquí)</th><th style="text-align:right">Hay</th><th style="width:110px">Enviar</th><th>Llega allá como</th></tr></thead><tbody>
    ${lista.slice(0, 300).map(x => { const c = EMP.cant.get(x.p.id) || ''; const llega = empNum(c) > 0 ? empFmt(empNum(c) * x.f) : '—'; const sin = (Number(x.p.stock_actual) || 0) <= 0;
      return `<tr style="border-top:1px solid var(--border);${sin ? 'opacity:.5' : ''}"><td style="padding:6px">${escHtml(x.p.nombre)}<div style="font-size:11px;color:var(--text-muted)">1 = ${empFmt(x.f, 4)} allá</div></td>
      <td style="padding:6px;text-align:right">${empFmt(x.p.stock_actual)}</td>
      <td style="padding:6px"><input class="form-input" style="width:95px;height:30px" inputmode="decimal" value="${escHtml(c)}" ${sin ? 'disabled' : ''} onchange="empTCant('${x.p.id}',this.value)"></td>
      <td style="padding:6px">${llega} · ${escHtml(x.par.nombre)}</td></tr>`; }).join('')}
    </tbody></table>${lista.length > 300 ? '<p style="font-size:12px;color:var(--text-muted)">Se muestran 300; usa el buscador.</p>' : ''}`
    : `<p style="padding:24px;text-align:center">Todavía no hay productos vinculados con ${escHtml(EMP.otro.nombre_negocio)}. Primero usa <b>🔗 Vincular</b>.</p>`;
  empEl('empPie').innerHTML = `<span style="font-size:12.5px;color:var(--text-muted)">${sel.length} producto(s)</span>
    <div style="display:flex;gap:8px"><button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button>
    <button class="btn btn-primary" onclick="empVistaPrevia()" ${sel.length ? '' : 'disabled'}>Revisar traslado</button></div>`;
  const qi = empEl('empTQ'); if (qi && EMP.tq) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
}
function empTCant(id, v) { if (empNum(v) > 0) EMP.cant.set(id, v); else EMP.cant.delete(id); empRenderTrasladar(); }
function empItems() { return [...EMP.cant.entries()].filter(([, c]) => empNum(c) > 0).map(([id, c]) => ({ producto_id: id, cantidad: empNum(c) })); }

async function empVistaPrevia() {
  const items = empItems(); if (!items.length) return;
  empEl('empPie').innerHTML = '<span>Calculando…</span>';
  const { data, error } = await supabaseClient.rpc('empresa_trasladar', { p_destino: EMP.otro.auth_user_id, p_items: items, p_nota: EMP.nota || null, p_usuario: empUsuario(), p_aplicar: false });
  if (error) { showToast('error', 'No se puede trasladar', empError(error)); empRenderTrasladar(); return; }
  const dif = Number(data.diferencia) || 0;
  empEl('empCuerpo').innerHTML = `
    <p style="margin:0 0 10px">Se envía a <b>${escHtml(EMP.otro.nombre_negocio)}</b>. Revisa antes de confirmar:</p>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr style="text-align:left;color:var(--text-muted)"><th>Sale de aquí</th><th style="text-align:right">Cant.</th><th>Entra allá</th><th style="text-align:right">Cant.</th></tr></thead><tbody>
    ${(data.lineas || []).map(l => `<tr style="border-top:1px solid var(--border)"><td style="padding:6px">${escHtml(l.nombre_origen)}</td><td style="padding:6px;text-align:right">${empFmt(l.cantidad_origen)}</td>
      <td style="padding:6px">${escHtml(l.nombre_destino)}</td><td style="padding:6px;text-align:right">${empFmt(l.cantidad_destino)}</td></tr>`).join('')}</tbody></table>
    <div style="margin-top:12px;font-size:13px;line-height:1.6">Valor a costo de aquí: <b>C$ ${empMon(data.valor_origen)}</b> · a costo de allá: <b>C$ ${empMon(data.valor_destino)}</b>
      ${dif ? `<br><span style="color:var(--text-muted)">Diferencia de C$ ${empMon(dif)} porque el costo no es igual en los dos negocios: queda en "Diferencia de costo en traslados".</span>` : ''}
      <br><span style="color:var(--text-muted)">Se registra el asiento en los dos negocios. Se puede anular hoy mismo si allá no se ha usado la mercadería.</span></div>
    <div id="empErrConf" style="color:var(--danger);font-size:13px;min-height:16px;margin-top:8px"></div>`;
  empEl('empPie').innerHTML = `<button class="btn btn-secondary" onclick="empRenderTrasladar()">← Corregir</button>
    <button class="btn btn-primary" id="empBtnConfirmar" onclick="empConfirmarTraslado()">Confirmar traslado</button>`;
}
async function empConfirmarTraslado() {
  if (EMP.enviando) return;
  EMP.enviando = true;
  const b = empEl('empBtnConfirmar'); if (b) { b.disabled = true; b.textContent = 'Trasladando…'; }
  try {
    const { data, error } = await supabaseClient.rpc('empresa_trasladar', { p_destino: EMP.otro.auth_user_id, p_items: empItems(), p_nota: EMP.nota || null, p_usuario: empUsuario(), p_aplicar: true });
    if (error) throw error;
    EMP.enviando = false; EMP.cant = new Map(); EMP.nota = '';
    showToast('success', `Traslado ${data.numero} hecho`, `${data.productos} producto(s) enviados a ${EMP.otro.nombre_negocio}`);
    empCerrar();
    if (typeof cargarProductos === 'function') cargarProductos();
  } catch (e) {
    EMP.enviando = false;
    const err = empEl('empErrConf'); if (err) err.textContent = 'No se trasladó nada. ' + empError(e);
    if (b) { b.disabled = false; b.textContent = 'Confirmar traslado'; }
  }
}

/* ============================================================
   3) HISTORIAL
   ============================================================ */
async function empAbrirHistorial() {
  empAbrir('📜 Traslados entre negocios');
  try {
    const { data, error } = await supabaseClient.from('empresa_traslados').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Managua' });
    const nombre = uid => uid === STATE.user.id ? 'aquí' : ((EMP.negocios.find(n => n.auth_user_id === uid) || {}).nombre_negocio || 'otro negocio');
    empEl('empCuerpo').innerHTML = (data && data.length) ? data.map(t => {
      const envie = t.origen === STATE.user.id;
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div><b>${escHtml(t.numero)}</b> · ${envie ? 'enviado a' : 'recibido de'} <b>${escHtml(nombre(envie ? t.destino : t.origen))}</b>
            <div style="font-size:12px;color:var(--text-muted)">${escHtml(t.fecha)}${t.usuario_nombre ? ' · ' + escHtml(t.usuario_nombre) : ''}${t.nota ? ' · ' + escHtml(t.nota) : ''}</div></div>
          <div style="text-align:right;font-size:12.5px">C$ ${empMon(envie ? t.valor_origen : t.valor_destino)}
            <div>${t.estado === 'anulado' ? `<span style="color:var(--danger);font-weight:600">ANULADO</span><div style="font-size:11px;color:var(--text-muted)">${escHtml(t.anulado_motivo || '')}</div>` : '<span style="color:var(--success);font-weight:600">Aplicado</span>'}</div></div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px"><button class="btn btn-secondary btn-sm" onclick="empVerDetalle('${t.id}')">Ver detalle</button>
          ${t.estado === 'aplicado' && t.fecha === hoy ? `<button class="btn btn-secondary btn-sm" style="color:var(--danger)" onclick="empAnular('${t.id}','${escHtml(t.numero)}')">Anular</button>` : ''}</div>
        <div id="empDet-${t.id}" style="display:none;margin-top:8px"></div></div>`;
    }).join('') : '<p style="padding:24px;text-align:center;color:var(--text-muted)">Todavía no hay traslados entre negocios.</p>';
    empEl('empPie').innerHTML = '<span></span><button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button>';
  } catch (e) {
    empEl('empCuerpo').innerHTML = `<p style="padding:24px;text-align:center;color:var(--danger)">No se pudo cargar: ${escHtml(empError(e))}</p>`;
    empEl('empPie').innerHTML = '<button class="btn btn-secondary" onclick="empCerrar()">Cerrar</button>';
  }
}
async function empVerDetalle(id) {
  const c = empEl('empDet-' + id);
  if (c.style.display === 'block') { c.style.display = 'none'; return; }
  c.style.display = 'block'; c.textContent = 'Cargando…';
  const { data, error } = await supabaseClient.from('empresa_traslados_items').select('*').eq('traslado_id', id).order('nombre_origen');
  if (error) { c.textContent = 'No se pudo cargar el detalle.'; return; }
  c.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px">${(data || []).map(i => `<tr style="border-top:1px solid var(--border)">
    <td style="padding:5px">${escHtml(i.nombre_origen)}</td><td style="padding:5px;text-align:right">${empFmt(i.cantidad_origen)}</td>
    <td style="padding:5px">→ ${escHtml(i.nombre_destino)}</td><td style="padding:5px;text-align:right">${empFmt(i.cantidad_destino)}</td></tr>`).join('')}</table>`;
}
async function empAnular(id, numero) {
  const motivo = prompt(`Anular ${numero}: la mercadería vuelve al negocio que la envió y se anulan los asientos de los dos negocios.\n\nEscribe el motivo:`);
  if (motivo === null) return;
  if (!motivo.trim()) { showToast('error', 'Falta el motivo', 'Escribe por qué se anula'); return; }
  try {
    const { error } = await supabaseClient.rpc('empresa_anular_traslado', { p_traslado: id, p_motivo: motivo.trim(), p_usuario: empUsuario() });
    if (error) throw error;
    showToast('success', 'Traslado anulado', `${numero}: todo volvió como estaba`);
    if (typeof cargarProductos === 'function') cargarProductos();
    empAbrirHistorial();
  } catch (e) { showToast('error', 'No se anuló', empError(e)); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(empIniciar, 600));
else setTimeout(empIniciar, 600);
