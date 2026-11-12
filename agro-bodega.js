/* ============================================================
   AGRO-BODEGA.JS — Negocio360 · Agroservicio
   Áreas de bodega (separar medicamentos, agroquímicos y alimento, como pide IPSA)
   y marca de refrigerado. Solo LEE productos; no mueve dinero ni inventario.
   - N360AgroBodega.AREAS                 lista de áreas
   - N360AgroBodega.avisarCompra(sb, uid, ids)  aviso "dónde va cada producto" al recibir una compra
   ============================================================ */
(function () {
  'use strict';
  const AREAS = [
    { id: 'agroquimicos', nombre: 'Agroquímicos', icono: '🧪' },
    { id: 'fertilizantes', nombre: 'Fertilizantes', icono: '🌱' },
    { id: 'semillas', nombre: 'Semillas', icono: '🌽' },
    { id: 'veterinarios', nombre: 'Medicina veterinaria', icono: '💉' },
    { id: 'alimento', nombre: 'Alimento animal', icono: '🐄' },
    { id: 'herramientas', nombre: 'Herramientas y equipo', icono: '🧰' },
    { id: 'otros', nombre: 'Otros', icono: '📦' },
  ];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function area(id) { return AREAS.find(a => a.id === id) || null; }

  async function avisarCompra(sb, uid, ids) {
    try {
      ids = [...new Set((ids || []).filter(Boolean))];
      if (!ids.length) return;
      const { data, error } = await sb.from('productos').select('id,nombre,agro_area,agro_refrigerado').eq('auth_user_id', uid).in('id', ids.slice(0, 200));
      if (error || !data || !data.length) return;
      const grupos = {};
      data.forEach(p => { const k = p.agro_area || 'sin'; (grupos[k] = grupos[k] || []).push(p); });
      const orden = [...AREAS.map(a => a.id), 'sin'].filter(k => grupos[k]);
      const html = orden.map(k => {
        const a = area(k);
        return `<div style="margin-bottom:10px"><b>${a ? a.icono + ' ' + esc(a.nombre) : '❔ Sin área asignada'}</b>
          <div style="font-size:13px;margin-top:3px">${grupos[k].map(p => esc(p.nombre) + (p.agro_refrigerado ? ' <b style="color:#0369a1">❄️ refrigerar</b>' : '')).join('<br>')}</div></div>`;
      }).join('');
      const sinArea = grupos.sin ? `<p style="font-size:12.5px;color:#92400e;margin:6px 0 0">Asigna el área a los productos "sin área" en Productos para que el sistema te guíe la próxima vez.</p>` : '';
      const fondo = document.createElement('div');
      fondo.setAttribute('role', 'dialog'); fondo.setAttribute('aria-modal', 'true');
      fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
      fondo.innerHTML = `<div style="background:var(--bg-surface,#fff);color:var(--text-primary,#111);border-radius:14px;max-width:440px;width:100%;max-height:85vh;overflow:auto;padding:18px 18px 14px;box-shadow:0 10px 40px rgba(0,0,0,.3)">
        <h3 style="font-size:16px;margin:0 0 4px">📦 ¿Dónde va cada producto?</h3>
        <p style="font-size:12.5px;color:var(--text-muted,#666);margin:0 0 12px">Guarda la mercadería en su área: los medicamentos separados de los agroquímicos y del alimento.</p>
        ${html}${sinArea}
        <div style="text-align:right;margin-top:12px"><button type="button" class="btn-primary" id="n360-agro-bodega-ok">Entendido</button></div></div>`;
      document.body.appendChild(fondo);
      const cerrar = () => { try { fondo.remove(); } catch (_) {} };
      fondo.querySelector('#n360-agro-bodega-ok').onclick = cerrar;
      fondo.addEventListener('click', e => { if (e.target === fondo) cerrar(); });
    } catch (e) { console.warn('Aviso de bodega:', e); }
  }

  window.N360AgroBodega = { AREAS, area, avisarCompra };
})();
