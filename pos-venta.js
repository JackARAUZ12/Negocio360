/* ============================================================
   POS-VENTA.JS — NEGOCIO360 · "Venta rápida" estilo caja (POS)
   ------------------------------------------------------------
   Pantalla de caja profesional: productos con su imagen a un lado,
   el ticket con subtotal y total al otro, y COBRAR. En celular, los
   productos ocupan la pantalla y abajo queda una barra fija con el
   total; al tocarla se ve el ticket y se cobra.

   CANDADO PRINCIPAL — NO DUPLICA NINGUNA LÓGICA DE DINERO:
   Es solo otra forma de VER la misma ventana de "Venta con lector"
   (modal-vr-pos). Usa su mismo carrito (VR), sus mismas funciones
   para agregar (stock, escalas, stock compartido, combos), cambiar
   cantidades y quitar, y su mismo botón y rutina de cobro
   (iniciarConfirmarVentaRapida -> confirmarVentaRapida): misma Caja,
   inventario, promociones, IVA, vendedor, comisión, ticket, vuelto
   y candado contra doble cobro. Solo mueve los elementos existentes
   (sin cambiar sus ids ni sus funciones) y los regresa al salir.
   Si algo falla aquí, la venta con lector sigue funcionando igual.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360POS) return;

  const LIMITE_TARJETAS = 120;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const fmtM = n => { try { return typeof fmt === 'function' ? fmt(n) : 'C$ ' + Number(n || 0).toFixed(2); } catch (_) { return String(n); } };
  const fmtQ = n => { const x = Number(n) || 0; return Number.isInteger(x) ? String(x) : x.toLocaleString('es-NI', { maximumFractionDigits: 3 }); };

  const ST = {
    activo: false, cat: 'todos', q: '', vista: lsGet('n360_pos_vista') === 'lista' ? 'lista' : 'cuadros',
    extra: {}, ranking: {}, cargadoExtra: false, cacheRef: null, verTicket: false, editando: null, guardado: null,
  };

  /* ---------------- Estilos ---------------- */
  function estilos() {
    if (document.getElementById('n360-pos-css')) return;
    const st = document.createElement('style');
    st.id = 'n360-pos-css';
    st.textContent = `
#modal-vr-pos.vr-pos { padding: 0 !important; overflow: hidden; align-items: stretch; }
#modal-vr-pos.vr-pos > .modal-box { max-width: none !important; width: 100vw; height: 100vh; height: 100dvh; margin: 0; border-radius: 0; border: 0; display: flex; flex-direction: column; animation: none; overflow: hidden; }
#modal-vr-pos.vr-pos .modal-header { padding: 10px 16px; flex: none; }
#modal-vr-pos.vr-pos > .modal-box > .modal-body { flex: 1; min-height: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr) clamp(340px, 30vw, 430px); overflow: hidden; }
#modal-vr-pos.vr-pos .pos-oculto { display: none !important; }

/* Lado de productos */
#pos-izq { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--bg-app, var(--bg-hover)); border-right: 1px solid var(--border); }
#pos-izq .pos-barra-bus { display: flex; gap: 8px; padding: 12px 14px 8px; flex: none; }
#pos-buscar { flex: 1; min-width: 0; height: 46px; border: 1.5px solid var(--border); border-radius: 12px; padding: 0 14px 0 40px; font: inherit; font-size: 15px; background: var(--bg-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%239999b3' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='16.5' y1='16.5' x2='21' y2='21'/%3E%3C/svg%3E") no-repeat 13px center; color: var(--text-primary); }
#pos-buscar:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.pos-vista { display: inline-flex; border: 1.5px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--bg-surface); flex: none; }
.pos-vista button { width: 44px; height: 43px; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; }
.pos-vista button.on { background: var(--accent); color: #fff; }
#pos-cats { display: flex; gap: 6px; padding: 0 14px 10px; overflow-x: auto; flex: none; scrollbar-width: none; }
#pos-cats::-webkit-scrollbar { display: none; }
#pos-cats button { flex: none; height: 34px; padding: 0 14px; border-radius: 99px; border: 1.5px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
#pos-cats button.on { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg-surface); }
#pos-grid { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; align-content: start; grid-auto-rows: max-content; }
#pos-grid.lista { grid-template-columns: 1fr; gap: 6px; }
.pos-card { position: relative; display: flex; height: auto; min-height: 0; align-self: start; flex-direction: column; text-align: left; border: 1.5px solid var(--border); border-radius: 14px; background: var(--bg-surface); cursor: pointer; overflow: hidden; padding: 0; font: inherit; color: var(--text-primary); transition: transform .08s ease, border-color .15s ease, box-shadow .15s ease; -webkit-tap-highlight-color: transparent; }
.pos-card:hover { border-color: var(--accent); box-shadow: 0 4px 14px -6px rgba(0,0,0,.25); }
.pos-card:active { transform: scale(.97); }
.pos-card.agotado { opacity: .55; }
.pos-card .pos-img { flex: none; height: 104px; width: 100%; background: var(--bg-hover); display: grid; place-items: center; overflow: hidden; }
.pos-card .pos-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pos-card .pos-ini { font-size: 26px; font-weight: 800; color: #fff; width: 100%; height: 100%; display: grid; place-items: center; letter-spacing: -.02em; }
.pos-card .pos-info { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pos-card .pos-nom { font-size: 13px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5em; }
.pos-card .pos-pre { font-size: 15px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.pos-card .pos-stk { font-size: 11px; color: var(--text-muted); }
.pos-card .pos-stk.bajo { color: var(--warning, #d97706); font-weight: 700; }
.pos-card .pos-stk.cero { color: var(--danger); font-weight: 700; }
.pos-card .pos-cant { position: absolute; top: 6px; right: 6px; min-width: 26px; height: 26px; padding: 0 7px; border-radius: 99px; background: var(--success); color: #fff; font-size: 13px; font-weight: 800; display: grid; place-items: center; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
.pos-card .pos-tag { position: absolute; top: 6px; left: 6px; font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 99px; background: rgba(0,0,0,.6); color: #fff; }
#pos-grid.lista .pos-card { flex-direction: row; align-items: center; min-height: 58px; }
#pos-grid.lista .pos-img { width: 58px; height: 58px; flex: none; }
#pos-grid.lista .pos-ini { font-size: 18px; }
#pos-grid.lista .pos-info { flex: 1; flex-direction: row; align-items: center; gap: 10px; padding: 8px 12px; }
#pos-grid.lista .pos-nom { flex: 1; min-height: 0; -webkit-line-clamp: 2; }
#pos-grid.lista .pos-cant { position: static; margin-right: 10px; }
#pos-grid.lista .pos-tag { position: static; margin-left: 10px; background: var(--bg-hover); color: var(--text-secondary); }
.pos-vacio { grid-column: 1 / -1; text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 14px; line-height: 1.5; }
.pos-mas { grid-column: 1 / -1; text-align: center; font-size: 12.5px; color: var(--text-muted); padding: 8px; }

/* Lado del ticket */
#pos-der { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--bg-surface); }
#pos-der-cab { display: none; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex: none; }
#pos-der-cab button { border: 0; background: var(--bg-hover); color: var(--text-primary); font: inherit; font-weight: 700; font-size: 14px; padding: 10px 14px; border-radius: 10px; cursor: pointer; }
#pos-der-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 16px; }
#pos-ticket { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
#pos-ticket .pos-tvacio { text-align: center; padding: 34px 10px; color: var(--text-muted); font-size: 13.5px; border: 1.5px dashed var(--border); border-radius: 14px; }
#pos-ticket .pos-tvacio b { display: block; font-size: 15px; color: var(--text-secondary); margin-bottom: 4px; }
.pos-lin { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 10px 2px; border-bottom: 1px solid var(--border); }
.pos-lin .pl-nom { font-size: 14px; font-weight: 600; line-height: 1.3; min-width: 0; }
.pos-lin .pl-nom small { display: block; font-size: 11.5px; font-weight: 600; margin-top: 1px; }
.pos-lin .pl-sub { font-size: 14.5px; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; }
.pos-lin .pl-ctl { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pos-step { display: inline-flex; align-items: center; border: 1.5px solid var(--border); border-radius: 10px; overflow: hidden; }
.pos-step button { width: 36px; height: 34px; border: 0; background: var(--bg-hover); color: var(--text-primary); font-size: 18px; font-weight: 700; cursor: pointer; }
.pos-step input { width: 52px; height: 34px; border: 0; text-align: center; font: inherit; font-size: 14px; font-weight: 700; background: var(--bg-surface); color: var(--text-primary); -moz-appearance: textfield; }
.pos-step input::-webkit-inner-spin-button, .pos-step input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.pos-lin .pl-pre { font-size: 12.5px; color: var(--text-muted); border: 0; background: none; cursor: pointer; padding: 6px 4px; font: inherit; font-size: 12.5px; text-decoration: underline dotted; }
.pos-lin .pl-pre-in { width: 96px; height: 34px; border: 1.5px solid var(--accent); border-radius: 8px; padding: 0 8px; font: inherit; font-size: 14px; background: var(--bg-surface); color: var(--text-primary); }
.pos-lin .pl-del { margin-left: auto; border: 0; background: none; color: var(--text-muted); width: 34px; height: 34px; border-radius: 8px; cursor: pointer; font-size: 16px; }
.pos-lin .pl-del:hover { background: var(--danger-soft, rgba(220,38,38,.1)); color: var(--danger); }
#modal-vr-pos.vr-pos #pos-der-scroll > div[style*="max-width:380px"] { max-width: none !important; margin-top: 4px !important; }
#modal-vr-pos.vr-pos #vr-res-total { font-size: 26px; font-weight: 800; }
#modal-vr-pos.vr-pos #pos-der > .modal-footer { flex: none; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--bg-surface); flex-wrap: nowrap; }
#modal-vr-pos.vr-pos #btn-vr-cobrar { flex: 1; justify-content: center; min-height: 56px; font-size: 17px; font-weight: 800; border-radius: 14px; }
#modal-vr-pos.vr-pos #pos-der > .modal-footer > div[style*="flex:1"] { display: none; }

/* Barra fija (solo celular) */
#pos-barra { display: none; }
@media (max-width: 899px) {
  #modal-vr-pos.vr-pos > .modal-box > .modal-body { grid-template-columns: minmax(0, 1fr); }
  #modal-vr-pos.vr-pos #pos-der { display: none; }
  #modal-vr-pos.vr-pos.pos-ver-ticket #pos-izq { display: none; }
  #modal-vr-pos.vr-pos.pos-ver-ticket #pos-der { display: flex; }
  #modal-vr-pos.vr-pos.pos-ver-ticket #pos-der-cab { display: flex; }
  #pos-izq { border-right: 0; }
  #pos-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; padding: 2px 10px 12px; }
  #pos-izq .pos-barra-bus { padding: 10px 10px 8px; }
  #pos-cats { padding: 0 10px 8px; }
  .pos-card .pos-info { padding: 6px 8px 8px; }
  .pos-card .pos-img { height: 78px; }
  #pos-grid.lista .pos-img { height: 58px; }
  .pos-card .pos-nom { font-size: 12.5px; }
  .pos-card .pos-pre { font-size: 14px; }
  #modal-vr-pos.vr-pos:not(.pos-ver-ticket) #pos-barra { display: flex; }
  #pos-barra { flex: none; align-items: center; gap: 10px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--bg-surface); box-shadow: 0 -6px 18px -10px rgba(0,0,0,.3); }
  #pos-barra .pb-info { flex: 1; min-width: 0; }
  #pos-barra .pb-info small { display: block; font-size: 12px; color: var(--text-muted); }
  #pos-barra .pb-info b { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
  #pos-barra button { min-height: 52px; padding: 0 22px; border: 0; border-radius: 14px; background: var(--success); color: #fff; font: inherit; font-size: 16px; font-weight: 800; cursor: pointer; }
  #pos-barra button:disabled { opacity: .45; }
}
@media (prefers-reduced-motion: reduce) { .pos-card { transition: none; } }
`;
    document.head.appendChild(st);
  }

  /* ---------------- Datos del catálogo ---------------- */
  function catalogo() {
    const lista = (typeof S !== 'undefined' && Array.isArray(S.productosCache)) ? S.productosCache : [];
    return lista.filter(p => p && p.activo !== false && !p.es_materia_prima && p.es_sustancia_controlada !== true);
  }
  function categoriaDe(p) {
    if (p.esCombo) return 'Combos';
    if (p.tipo === 'servicio') return (ST.extra[p.id] && ST.extra[p.id].categoria) || 'Servicios';
    return (ST.extra[p.id] && ST.extra[p.id].categoria) || 'Otros';
  }
  async function cargarExtra() {
    if (ST.cargadoExtra || typeof sb === 'undefined' || !S.userId) return;
    ST.cargadoExtra = true;
    // Imagen y categoría (solo lectura)
    try {
      const leer = () => sb.from('productos').select('id,imagen_url,categoria').eq('auth_user_id', S.userId).eq('activo', true);
      const { data } = window.N360Leer ? await N360Leer.todo(leer, 'productos') : await leer();
      (data || []).forEach(r => { ST.extra[r.id] = { img: r.imagen_url || '', categoria: (r.categoria || '').trim() }; });
    } catch (e) { console.warn('POS: sin imágenes/categorías', e); }
    // Más vendidos de los últimos 45 días (solo lectura, para ordenar)
    try {
      const desde = new Date(Date.now() - 45 * 864e5).toISOString();
      const { data } = await sb.from('venta_detalles').select('producto_id,combo_id,cantidad')
        .eq('auth_user_id', S.userId).gte('created_at', desde).order('created_at', { ascending: false }).limit(4000);
      (data || []).forEach(d => { const id = d.combo_id || d.producto_id; if (id) ST.ranking[id] = (ST.ranking[id] || 0) + 1; });
    } catch (e) { console.warn('POS: sin ranking', e); }
    pintarCats(); pintarGrid();
  }

  /* ---------------- Mover la ventana existente (sin cambiar ids) ---------------- */
  function modal() { return document.getElementById('modal-vr-pos'); }
  function armar() {
    const m = modal(); if (!m) return false;
    const box = m.querySelector('.modal-box'), body = box && box.querySelector('.modal-body'), foot = box && box.querySelector('.modal-footer');
    if (!body || !foot) return false;
    if (document.getElementById('pos-izq')) return true;
    estilos();
    const izq = document.createElement('section');
    izq.id = 'pos-izq';
    izq.setAttribute('aria-label', 'Productos');
    izq.innerHTML = `
      <div class="pos-barra-bus">
        <input id="pos-buscar" type="search" autocomplete="off" enterkeyhint="search" placeholder="Buscar producto, código o escanear…  (F2)" aria-label="Buscar producto o escanear código">
        <div class="pos-vista" role="group" aria-label="Vista">
          <button type="button" data-vista="cuadros" title="Ver en cuadros"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></button>
          <button type="button" data-vista="lista" title="Ver en lista"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg></button>
        </div>
      </div>
      <div id="pos-cats" role="tablist" aria-label="Categorías"></div>
      <div id="pos-grid" role="list"></div>
      <div id="pos-barra"><div class="pb-info"><small id="pos-barra-cant">Sin productos</small><b id="pos-barra-total">${fmtM(0)}</b></div><button type="button" id="pos-barra-btn" disabled>Cobrar ›</button></div>`;
    const der = document.createElement('section');
    der.id = 'pos-der';
    der.setAttribute('aria-label', 'Ticket de la venta');
    der.innerHTML = `<div id="pos-der-cab"><button type="button" id="pos-volver">‹ Seguir agregando</button></div><div id="pos-der-scroll"><div id="pos-ticket"></div></div>`;
    const scroll = der.querySelector('#pos-der-scroll');
    // Se guarda el orden original para devolver todo igual al salir
    ST.guardado = { hijos: Array.from(body.children), foot, cobrarHTML: (document.getElementById('btn-vr-cobrar') || {}).innerHTML };
    ST.guardado.hijos.forEach(h => scroll.appendChild(h));
    der.appendChild(foot);
    body.appendChild(izq); body.appendChild(der);
    // Lo que en la caja POS no hace falta (el buscador de la izquierda también lee el lector de barras)
    const scan = document.getElementById('vr-scan-input'); if (scan && scan.closest('.prod-search-wrap')) scan.closest('.prod-search-wrap').classList.add('pos-oculto');
    const tabla = document.querySelector('#modal-vr-pos .carrito-tabla'); if (tabla && tabla.parentElement) tabla.parentElement.classList.add('pos-oculto');
    const fecha = document.getElementById('vr-fecha-venta'); if (fecha && fecha.closest('.form-group')) fecha.closest('.form-group').classList.add('pos-oculto');
    if (!pantallaGrande()) inpPlaceholder(izq);
    eventos(izq, der);
    return true;
  }
  function desarmar() {
    const m = modal(); if (!m || !ST.guardado) return;
    const box = m.querySelector('.modal-box'), body = box.querySelector('.modal-body');
    const izq = document.getElementById('pos-izq'), der = document.getElementById('pos-der');
    ST.guardado.hijos.forEach(h => body.appendChild(h));          // mismo orden de siempre
    box.appendChild(ST.guardado.foot);
    const b = document.getElementById('btn-vr-cobrar'); if (b) { if (ST.guardado.cobrarHTML) b.innerHTML = ST.guardado.cobrarHTML; b.disabled = false; }
    if (izq) izq.remove(); if (der) der.remove();
    m.querySelectorAll('.pos-oculto').forEach(el => el.classList.remove('pos-oculto'));
    ST.guardado = null;
  }

  /* ---------------- Pintar ---------------- */
  function colorDe(txt) { let h = 0; for (const ch of String(txt)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 55% 46%)`; }
  function iniciales(n) { const p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '')[1] || '')).toUpperCase(); }
  function enCarrito() { const m = {}; ((typeof VR !== 'undefined' && VR.carrito) || []).forEach(i => { m[i.id] = (m[i.id] || 0) + (Number(i.cantidad) || 0); }); return m; }

  function pintarCats() {
    const cont = document.getElementById('pos-cats'); if (!cont) return;
    const cuenta = {};
    catalogo().forEach(p => { const c = categoriaDe(p); cuenta[c] = (cuenta[c] || 0) + 1; });
    const cats = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a] || a.localeCompare(b, 'es'));
    if (ST.cat !== 'todos' && ST.cat !== 'top' && !cuenta[ST.cat]) ST.cat = 'todos';
    const hayTop = Object.keys(ST.ranking).length > 0;
    cont.innerHTML = `<button type="button" data-cat="todos" class="${ST.cat === 'todos' ? 'on' : ''}">Todos</button>` +
      (hayTop ? `<button type="button" data-cat="top" class="${ST.cat === 'top' ? 'on' : ''}">⭐ Más vendidos</button>` : '') +
      (cats.length > 1 ? cats.map(c => `<button type="button" data-cat="${esc(c)}" class="${ST.cat === c ? 'on' : ''}">${esc(c)}</button>`).join('') : '');
  }

  function filtrados() {
    const q = norm(ST.q);
    let l = catalogo();
    if (ST.cat === 'top') l = l.filter(p => ST.ranking[p.id]);
    else if (ST.cat !== 'todos') l = l.filter(p => categoriaDe(p) === ST.cat);
    if (q) {
      const partes = q.split(/\s+/);
      l = l.filter(p => { const t = norm(p.nombre) + ' ' + norm(p.sku) + ' ' + norm(p.codigo_barras); return partes.every(x => t.includes(x)); });
    }
    return l.sort((a, b) => (ST.ranking[b.id] || 0) - (ST.ranking[a.id] || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }

  function pintarGrid() {
    const g = document.getElementById('pos-grid'); if (!g) return;
    ST.cacheRef = (typeof S !== 'undefined') ? S.productosCache : null;
    g.classList.toggle('lista', ST.vista === 'lista');
    document.querySelectorAll('#pos-izq .pos-vista button').forEach(b => b.classList.toggle('on', b.dataset.vista === ST.vista));
    const todos = catalogo();
    if (!todos.length) { g.innerHTML = `<div class="pos-vacio">Aún no tienes productos para vender.<br>Agrégalos en <b>Productos/Servicios</b> y aparecerán aquí.</div>`; return; }
    const l = filtrados();
    if (!l.length) { g.innerHTML = `<div class="pos-vacio">No hay productos que coincidan con <b>"${esc(ST.q)}"</b>.<br>Si es un código de barras, presiona <b>Enter</b> para buscarlo.</div>`; return; }
    const cant = enCarrito();
    const vender0 = typeof S !== 'undefined' && S.venderSinStockActivo;
    const vis = l.slice(0, LIMITE_TARJETAS);
    g.innerHTML = vis.map(p => {
      const x = ST.extra[p.id] || {};
      const esProd = p.tipo === 'producto' && !p.preparadoAlVender;
      const stock = Number(p.stock_actual) || 0;
      const agot = esProd && stock <= 0 && !vender0;
      const stk = !esProd ? (p.tipo === 'servicio' ? 'Servicio' : '') : (stock <= 0 ? 'Agotado' : `Stock: ${fmtQ(stock)}`);
      const clsStk = esProd ? (stock <= 0 ? 'cero' : (stock <= 5 ? 'bajo' : '')) : '';
      const img = x.img && /^https?:\/\//i.test(x.img)
        ? `<img src="${esc(x.img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pos-ini',style:'background:${colorDe(p.nombre)}',textContent:'${esc(iniciales(p.nombre))}'}))">`
        : `<div class="pos-ini" style="background:${colorDe(p.nombre)}">${esc(iniciales(p.nombre))}</div>`;
      const tag = p.esCombo ? 'Combo' : (p.tipo_precio === 'escala' ? 'Escala' : '');
      return `<button type="button" class="pos-card${agot ? ' agotado' : ''}" role="listitem" data-id="${esc(p.id)}" title="${esc(p.nombre)}">
        <div class="pos-img">${img}</div>
        ${tag ? `<span class="pos-tag">${tag}</span>` : ''}
        <div class="pos-info"><span class="pos-nom">${esc(p.nombre)}</span><span class="pos-pre">${fmtM(p.precio)}</span>${stk ? `<span class="pos-stk ${clsStk}">${stk}</span>` : ''}</div>
        ${cant[p.id] ? `<span class="pos-cant">${fmtQ(cant[p.id])}</span>` : ''}
      </button>`;
    }).join('') + (l.length > vis.length ? `<div class="pos-mas">Mostrando ${vis.length} de ${l.length.toLocaleString('es-NI')}. Escribe en el buscador para encontrar los demás.</div>` : '');
  }

  function pintarTicket() {
    const t = document.getElementById('pos-ticket'); if (!t || typeof VR === 'undefined') return;
    const items = VR.carrito || [];
    if (!items.length) {
      t.innerHTML = `<div class="pos-tvacio"><b>🛒 Ticket vacío</b>Toca un producto o escanéalo para agregarlo.</div>`;
    } else {
      t.innerHTML = items.map((it, i) => {
        const frac = it.permiteFraccion === true;
        const badges = [it.esCombo ? '<small style="color:var(--accent-4,var(--accent))">📦 Combo</small>' : '', it.esPromocion ? '<small style="color:var(--success)">🎁 Promoción</small>' : '',
          it.escalaNombre ? `<small style="color:var(--accent)">📊 ${esc(it.escalaNombre)}</small>` : '', it.origenStockNombre ? `<small style="color:var(--accent-3,#e08e0b)">📦 Stock de: ${esc(it.origenStockNombre)}</small>` : '',
          it.precioEditado ? '<small style="color:var(--text-muted)">✏️ Precio ajustado</small>' : '', it.sinStock ? '<small style="color:var(--danger)">Vendido sin stock</small>' : ''].join('');
        const editando = ST.editando === it.id;
        const fijo = it.esPromocion;   // las líneas de promoción las maneja el sistema
        return `<div class="pos-lin" data-id="${esc(it.id)}">
          <div class="pl-nom">${esc(it.nombre)}${badges}</div>
          <div class="pl-sub">${fmtM(Math.round((Number(it.cantidad) || 0) * (Number(it.precio) || 0) * 100) / 100)}</div>
          <div class="pl-ctl">
            ${fijo ? `<span style="font-size:12.5px;color:var(--text-muted)">${fmtQ(it.cantidad)} × ${fmtM(it.precio)}</span>` : `
            <div class="pos-step"><button type="button" data-acc="menos" aria-label="Quitar uno">−</button><input type="number" inputmode="${frac ? 'decimal' : 'numeric'}" step="${frac ? 'any' : 1}" min="${frac ? 0.001 : 1}" value="${it.cantidad}" data-acc="cant" aria-label="Cantidad"><button type="button" data-acc="mas" aria-label="Agregar uno">+</button></div>
            ${editando ? `<input class="pl-pre-in" type="number" inputmode="decimal" step="0.01" min="0" value="${it.precio}" data-acc="precio" aria-label="Precio de esta venta">`
                       : `<button type="button" class="pl-pre" data-acc="editar" title="Cambiar el precio solo para esta venta">× ${fmtM(it.precio)}</button>`}`}
            <button type="button" class="pl-del" data-acc="quitar" aria-label="Quitar del ticket" title="Quitar">🗑</button>
          </div></div>`;
      }).join('');
      if (ST.editando) { const inp = t.querySelector('.pl-pre-in'); if (inp) { inp.focus(); inp.select(); } }
    }
    // Total en el botón de cobrar y en la barra del celular
    let total = 0, n = 0;
    try { total = Number(calcularResumenVR().total) || 0; } catch (_) {}
    items.forEach(i => { n += Number(i.cantidad) || 0; });
    const b = document.getElementById('btn-vr-cobrar');
    if (b) {
      b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg> Cobrar ${fmtM(total)}`;
      b.disabled = !items.length;
    }
    const bt = document.getElementById('pos-barra-total'); if (bt) bt.textContent = fmtM(total);
    const bc = document.getElementById('pos-barra-cant'); if (bc) bc.textContent = items.length ? `${fmtQ(n)} producto${n === 1 ? '' : 's'} en el ticket` : 'Sin productos';
    const bb = document.getElementById('pos-barra-btn'); if (bb) bb.disabled = !items.length;
    if (!items.length && ST.verTicket) verTicket(false);
  }

  function verTicket(si) {
    ST.verTicket = !!si;
    const m = modal(); if (m) m.classList.toggle('pos-ver-ticket', ST.verTicket);
    if (ST.verTicket) { const sc = document.getElementById('pos-der-scroll'); if (sc) sc.scrollTop = 0; }
  }

  /* ---------------- Acciones ---------------- */
  function agregar(id) {
    const p = catalogo().find(x => String(x.id) === String(id));
    if (!p) return;
    try { continuarEscaneoConProducto(p); }   // MISMO camino que el lector: stock, escalas, stock compartido, combos
    catch (e) { console.error('POS agregar:', e); showToast('No se pudo agregar el producto. Intenta de nuevo.', 'error'); }
  }
  function alEnter() {
    const inp = document.getElementById('pos-buscar'); if (!inp) return;
    const txt = String(inp.value || '').trim(); if (!txt) return;
    const t = norm(txt);
    const exactos = catalogo().filter(p => norm(p.codigo_barras) === t || norm(p.sku) === t);
    if (exactos.length === 1) { agregar(exactos[0].id); limpiarBusqueda(); return; }
    if (!exactos.length) {
      const l = filtrados();
      if (l.length === 1) { agregar(l[0].id); limpiarBusqueda(); return; }
      if (l.length > 1 && !/^\d{6,}$/.test(txt)) return;   // texto con varias coincidencias: que elija con un toque
    }
    // Código de barras / SKU: búsqueda completa del lector (también avisa si está inactivo o repetido)
    try { procesarCodigoEscaneado(txt); } catch (e) { console.error(e); }
    limpiarBusqueda();
  }
  function limpiarBusqueda() {
    const inp = document.getElementById('pos-buscar'); if (inp) inp.value = '';
    ST.q = ''; pintarGrid();
  }
  let tBus = 0;
  function eventos(izq, der) {
    const inp = izq.querySelector('#pos-buscar');
    inp.addEventListener('input', () => { ST.q = inp.value; clearTimeout(tBus); tBus = setTimeout(pintarGrid, 110); });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(tBus); ST.q = inp.value; alEnter(); } });
    izq.addEventListener('click', ev => {
      const card = ev.target.closest('.pos-card'); if (card) { agregar(card.dataset.id); return; }
      const cat = ev.target.closest('[data-cat]'); if (cat) { ST.cat = cat.dataset.cat; pintarCats(); pintarGrid(); const g = document.getElementById('pos-grid'); if (g) g.scrollTop = 0; return; }
      const v = ev.target.closest('[data-vista]'); if (v) { ST.vista = v.dataset.vista; lsSet('n360_pos_vista', ST.vista); pintarGrid(); return; }
      if (ev.target.closest('#pos-barra-btn')) { verTicket(true); return; }
    });
    der.addEventListener('click', ev => {
      if (ev.target.closest('#pos-volver')) { verTicket(false); return; }
      const lin = ev.target.closest('.pos-lin'); const b = ev.target.closest('[data-acc]');
      if (!lin || !b) return;
      const id = lin.dataset.id, it = (VR.carrito || []).find(i => String(i.id) === String(id)); if (!it) return;
      const acc = b.dataset.acc;
      if (acc === 'mas') cambiarCantidadVR(it.id, (Number(it.cantidad) || 0) + 1);
      else if (acc === 'menos') { const n = (Number(it.cantidad) || 0) - 1; if (n <= 0) removeFromCarritoVR(it.id); else cambiarCantidadVR(it.id, n); }
      else if (acc === 'quitar') removeFromCarritoVR(it.id);
      else if (acc === 'editar') { ST.editando = it.id; pintarTicket(); }
    });
    der.addEventListener('change', ev => {
      const lin = ev.target.closest('.pos-lin'); if (!lin) return;
      const it = (VR.carrito || []).find(i => String(i.id) === String(lin.dataset.id)); if (!it) return;
      if (ev.target.dataset.acc === 'cant') {
        const v = parseFloat(String(ev.target.value).replace(',', '.'));
        if (!(v > 0)) { pintarTicket(); return; }
        cambiarCantidadVR(it.id, v);
      } else if (ev.target.dataset.acc === 'precio') { ST.editando = null; cambiarPrecioVR(it.id, String(ev.target.value).replace(',', '.')); }
    });
    der.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.matches('input[data-acc]')) { ev.preventDefault(); ev.target.blur(); }
      if (ev.key === 'Escape' && ev.target.dataset.acc === 'precio') { ST.editando = null; pintarTicket(); }
    });
    der.addEventListener('focusout', ev => { if (ev.target.dataset && ev.target.dataset.acc === 'precio' && ST.editando) { setTimeout(() => { if (ST.editando) { ST.editando = null; pintarTicket(); } }, 150); } });
  }

  // Atajos de teclado (solo con la caja POS abierta)
  document.addEventListener('keydown', ev => {
    if (!ST.activo) return;
    const m = modal(); if (!m || !m.classList.contains('modal-open')) return;
    if (ev.key === 'F2') { ev.preventDefault(); verTicket(false); const i = document.getElementById('pos-buscar'); if (i) { i.focus(); i.select(); } }
    else if (ev.key === 'F12') { ev.preventDefault(); const b = document.getElementById('btn-vr-cobrar'); if (b && !b.disabled) b.click(); }
  });

  function inpPlaceholder(izq) { const i = izq.querySelector('#pos-buscar'); if (i) i.placeholder = 'Buscar o escanear…'; }
  function pantallaGrande() { try { return window.matchMedia('(min-width: 900px) and (pointer: fine)').matches; } catch (_) { return false; } }

  /* ---------------- API usada por ventas.js ---------------- */
  function modo(esPOS) {
    const m = modal(); if (!m) return;
    const tit = m.querySelector('.modal-title');
    if (esPOS) {
      if (!armar()) return;
      ST.activo = true; ST.editando = null; verTicket(false);
      m.classList.add('vr-pos');
      if (tit) tit.textContent = '⚡ Venta rápida';
      pintarCats(); pintarGrid(); pintarTicket();
      cargarExtra();
    } else {
      ST.activo = false;
      m.classList.remove('vr-pos', 'pos-ver-ticket');
      desarmar();
      if (tit) tit.textContent = 'Venta con lector';
    }
  }
  function refrescar() {
    if (!ST.activo) return;
    try {
      if ((typeof S !== 'undefined') && S.productosCache !== ST.cacheRef) { pintarCats(); pintarGrid(); }   // el stock se actualizó después de vender
      else actualizarCantidades();
      pintarTicket();
    } catch (e) { console.warn('POS:', e); }
  }
  function actualizarCantidades() {
    const cant = enCarrito();
    document.querySelectorAll('#pos-grid .pos-card').forEach(card => {
      const n = cant[card.dataset.id];
      let b = card.querySelector('.pos-cant');
      if (n) { if (!b) { b = document.createElement('span'); b.className = 'pos-cant'; card.appendChild(b); } b.textContent = fmtQ(n); }
      else if (b) b.remove();
    });
  }
  // A dónde va el cursor (en computadora, al buscador; en celular no se abre el teclado solo)
  function enfocar() {
    if (!ST.activo) return false;
    if (pantallaGrande() && !ST.editando) { const i = document.getElementById('pos-buscar'); if (i && document.activeElement !== i) i.focus(); }
    return true;
  }

  window.N360POS = { modo, refrescar, enfocar, activo: () => ST.activo, _st: ST };
})();
