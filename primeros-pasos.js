/* =====================================================
   PRIMEROS PASOS — guía de inicio en el Dashboard
   -----------------------------------------------------
   Tarjeta con 3 pasos para quien recién empieza:
     1) Poner el dinero inicial de caja
     2) Agregar el primer producto o servicio
     3) Hacer la primera venta
   - Cada paso se marca SOLO cuando ya está hecho (lee la base,
     no escribe nada).
   - Solo la ve el administrador (no los perfiles de trabajadores).
   - Se oculta sola cuando los 3 pasos están hechos, o si la
     persona toca "Ocultar" (se recuerda en este navegador).
   - Si algo falla, no se muestra nada: nunca rompe el Dashboard.
===================================================== */
(function () {
  'use strict';

  function esPerfilTrabajador() {
    try {
      const raw = sessionStorage.getItem('n360_perfil_activo');
      if (!raw) return false;
      const p = JSON.parse(raw);
      return !!(p && p.tipo && p.tipo !== 'admin');
    } catch (_) { return false; }
  }

  async function hayFila(sb, tabla, userId) {
    const { data, error } = await sb.from(tabla).select('id').eq('auth_user_id', userId).limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  }

  function estilos() {
    if (document.getElementById('pp-estilos')) return;
    const s = document.createElement('style');
    s.id = 'pp-estilos';
    s.textContent = `
      #pp-card{background:var(--bg-surface,#fff);border:1px solid var(--border,#e8e8ef);border-radius:var(--radius-lg,16px);padding:18px 20px;margin:0 0 18px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
      #pp-card .pp-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:4px}
      #pp-card h2{font-size:16px;font-weight:700;color:var(--text-primary,#0d0d14);margin:0}
      #pp-card .pp-sub{font-size:13px;color:var(--text-secondary,#60607a);margin:2px 0 12px}
      #pp-card .pp-ocultar{background:none;border:0;color:var(--text-muted,#9999b3);font-size:12.5px;cursor:pointer;padding:4px 6px;white-space:nowrap}
      #pp-card .pp-ocultar:hover{color:var(--text-primary,#0d0d14)}
      #pp-card .pp-barra{height:6px;border-radius:99px;background:var(--bg-hover,#f0f0f5);overflow:hidden;margin-bottom:14px}
      #pp-card .pp-barra i{display:block;height:100%;background:var(--accent-2,#22c55e);border-radius:99px;transition:width .4s}
      #pp-card .pp-lista{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      #pp-card .pp-paso{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--border,#e8e8ef);border-radius:var(--radius-md,12px);background:var(--bg-surface-2,#fafafa)}
      #pp-card .pp-paso.pp-actual{border-color:var(--accent,#5a5af4);background:var(--accent-soft,#eff0ff)}
      #pp-card .pp-paso.pp-hecho{opacity:.75}
      #pp-card .pp-num{flex:0 0 28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;background:var(--bg-hover,#f0f0f5);color:var(--text-secondary,#60607a)}
      #pp-card .pp-actual .pp-num{background:var(--accent,#5a5af4);color:#fff}
      #pp-card .pp-hecho .pp-num{background:var(--accent-2,#22c55e);color:#fff}
      #pp-card .pp-txt{flex:1;min-width:0}
      #pp-card .pp-txt b{display:block;font-size:13.5px;color:var(--text-primary,#0d0d14);margin-bottom:2px}
      #pp-card .pp-hecho .pp-txt b{text-decoration:line-through}
      #pp-card .pp-txt span{display:block;font-size:12.5px;color:var(--text-secondary,#60607a);line-height:1.4}
      #pp-card .pp-btn{margin-top:8px;display:inline-block;padding:7px 12px;border-radius:8px;border:1px solid var(--border,#e8e8ef);background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:none}
      #pp-card .pp-actual .pp-btn{background:var(--accent,#5a5af4);border-color:var(--accent,#5a5af4);color:#fff}
      #pp-card .pp-ok{margin-top:6px;font-size:12px;font-weight:600;color:var(--accent-2,#22c55e)}
      @media (max-width:900px){#pp-card .pp-lista{grid-template-columns:1fr}}
    `;
    document.head.appendChild(s);
  }

  function pintar(userId, hechos) {
    const pasos = [
      { t: 'Pon tu dinero inicial de caja', d: 'Cuánto efectivo tienes hoy en el negocio. Así la caja cuadra desde el primer día.', btn: 'Ir a Caja', url: 'caja.html' },
      { t: 'Agrega tu primer producto', d: 'Nombre, precio, costo y cuántos tienes. Puede ser también un servicio.', btn: 'Agregar producto', url: 'productos.html?nuevo=1' },
      { t: 'Haz tu primera venta', d: 'Vende ese producto y mira cómo se mueven solos tu caja y tu inventario.', btn: 'Ir a Ventas', url: 'ventas.html' },
    ];
    const listos = hechos.filter(Boolean).length;
    const actual = hechos.findIndex(h => !h);
    const cont = document.getElementById('content');
    const ancla = cont && cont.querySelector('.greeting-row');
    if (!cont || !ancla) return;

    estilos();
    let card = document.getElementById('pp-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'pp-card';
      ancla.insertAdjacentElement('afterend', card);
    }
    card.innerHTML = `
      <div class="pp-top">
        <div>
          <h2>🚀 Primeros pasos — ${listos} de 3 listos</h2>
          <p class="pp-sub">Haz estos 3 pasos en orden y tu negocio queda listo para trabajar.</p>
        </div>
        <button type="button" class="pp-ocultar" title="Ocultar esta guía">Ocultar ✕</button>
      </div>
      <div class="pp-barra"><i style="width:${Math.round(listos / 3 * 100)}%"></i></div>
      <div class="pp-lista">
        ${pasos.map((p, i) => `
          <div class="pp-paso ${hechos[i] ? 'pp-hecho' : (i === actual ? 'pp-actual' : '')}">
            <div class="pp-num">${hechos[i] ? '✓' : i + 1}</div>
            <div class="pp-txt">
              <b>${p.t}</b>
              <span>${p.d}</span>
              ${hechos[i] ? '<div class="pp-ok">Hecho</div>' : `<a class="pp-btn" href="${p.url}">${p.btn} →</a>`}
            </div>
          </div>`).join('')}
      </div>`;
    card.querySelector('.pp-ocultar').onclick = () => {
      try { localStorage.setItem('n360_pp_oculto_' + userId, '1'); } catch (_) {}
      card.remove();
    };
  }

  async function iniciar(sb, userId) {
    try {
      if (!sb || !userId) return;
      if (esPerfilTrabajador()) return;
      try { if (localStorage.getItem('n360_pp_oculto_' + userId) === '1') return; } catch (_) {}

      const [conMovs, conCapital, conProd, conVenta] = await Promise.all([
        hayFila(sb, 'movimientos_financieros', userId),
        hayFila(sb, 'capital_negocio', userId).catch(() => false),
        hayFila(sb, 'productos', userId),
        hayFila(sb, 'ventas', userId),
      ]);
      const hechos = [conMovs || conCapital, conProd, conVenta];
      if (hechos.every(Boolean)) return; // ya arrancó: no molestar
      pintar(userId, hechos);
    } catch (e) {
      console.warn('primeros-pasos:', e); // ante cualquier duda, no mostrar nada
    }
  }

  window.N360PrimerosPasos = { iniciar };
})();
