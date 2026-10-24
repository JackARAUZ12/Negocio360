/* =====================================================
   CIERRE-PENDIENTE.JS — NEGOCIO360 (24-oct-2026)
   Solo para negocios que eligieron su DÍA DE CIERRE (Configuración ›
   Cierres). Al entrar, si el último período que ya terminó quedó sin
   cerrar, pregunta qué hacer con el saldo que había en Caja ese día:
     * Cerrar y empezar el nuevo período en 0 (registra el retiro)
     * Cerrar y seguir con el saldo
     * Contar el dinero primero (abre Caja › Cierre mensual)
     * Recordármelo después (vuelve a preguntar en la próxima sesión)
   Lo hace la base (caja_cierre_periodo), igual que el botón de Caja.
   Solo lo ve el administrador, nunca un perfil restringido.
===================================================== */
(function () {
  'use strict';
  if (window.__n360CierrePendiente) return; window.__n360CierrePendiente = true;
  const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

  function esAdmin() {
    try { const pf = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); return !pf || pf.tipo === 'admin'; } catch (_) { return true; }
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fechaLarga = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'long' });
  const fechaCorta = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short' });
  function dinero(n, moneda) {
    const sym = (typeof monedaParaMostrar === 'function') ? monedaParaMostrar(moneda) : (moneda === 'USD' ? '$' : 'C$');
    let v = Number(n) || 0;
    if (typeof convertirParaMostrar === 'function') { try { v = convertirParaMostrar(v, moneda); } catch (_) {} }
    return `${sym} ${v.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  async function revisar() {
    if (!window.supabase || !esAdmin()) return;
    const cli = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { session } } = await cli.auth.getSession();
    if (!session) return;
    const { data: p, error } = await cli.rpc('caja_cierre_pendiente');
    if (error || !p?.pendiente) return;
    try { if (sessionStorage.getItem('n360_cierre_pend_' + p.hasta) === 'despues') return; } catch (_) {}
    if (location.pathname.endsWith('/caja.html') && new URLSearchParams(location.search).get('cierre') === '1') return;
    let moneda = 'NIO';
    try { const { data: c } = await cli.from('configuracion_empresa').select('moneda').eq('auth_user_id', session.user.id).maybeSingle(); moneda = c?.moneda || 'NIO'; } catch (_) {}
    mostrar(cli, p, moneda);
  }

  function mostrar(cli, p, moneda) {
    const viejos = Array.isArray(p.no_corresponden) ? p.no_corresponden : [];
    const caja = document.createElement('div');
    caja.id = 'n360-cierre-pendiente';
    caja.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit';
    const btn = 'display:block;width:100%;text-align:left;border:1.5px solid var(--border,#e5e7eb);border-radius:12px;padding:11px 13px;margin-top:8px;background:var(--bg-surface,#fff);color:var(--text-primary,#111);cursor:pointer;font:inherit';
    caja.innerHTML = `
      <div style="background:var(--bg-surface,#fff);color:var(--text-primary,#111);border-radius:16px;max-width:470px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25)">
        <div style="padding:18px 20px 6px">
          <div style="font-size:17px;font-weight:800">📅 Cierre de mes pendiente</div>
          <div style="font-size:13px;color:var(--text-secondary,#555);margin-top:6px">Tu período del <b>${fechaCorta(p.desde)}</b> al <b>${fechaCorta(p.hasta)}</b> terminó y todavía no se ha cerrado.</div>
          <div style="margin-top:12px;background:var(--bg-app,#f5f5f7);border-radius:12px;padding:12px 14px">
            <div style="font-size:12px;color:var(--text-muted,#777)">En Caja había al ${fechaLarga(p.hasta)}</div>
            <div style="font-size:22px;font-weight:800">${dinero(p.saldo, moneda)}</div>
          </div>
          <div style="font-size:13.5px;font-weight:700;margin-top:14px">¿Qué deseas hacer?</div>
          <button type="button" data-accion="cero" style="${btn};${p.empezar_cero ? 'border-color:var(--accent,#5a5af4)' : ''}">
            <b>Cerrar y empezar el nuevo período en ${dinero(0, moneda)}</b>
            <div style="font-size:12px;color:var(--text-muted,#777);margin-top:2px">Se registra un retiro por ${dinero(p.saldo, moneda)} con fecha ${fechaCorta(p.hasta)} (se lo llevó el dueño o se depositó). Desde el ${fechaCorta(p.desde === p.hasta ? p.hasta : siguiente(p.hasta))} la Caja solo muestra lo nuevo.</div></button>
          <button type="button" data-accion="seguir" style="${btn}">
            <b>Cerrar y seguir con el saldo</b>
            <div style="font-size:12px;color:var(--text-muted,#777);margin-top:2px">Se guarda el cierre del período y la Caja sigue con sus ${dinero(p.saldo, moneda)}.</div></button>
          <button type="button" data-accion="contar" style="${btn}">
            <b>Contar el dinero primero</b>
            <div style="font-size:12px;color:var(--text-muted,#777);margin-top:2px">Abre Caja › Cierre mensual para escribir cuánto dinero había de verdad (si no cuadra, se registra el faltante o sobrante).</div></button>
          ${viejos.length ? `<label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:12.5px;color:var(--text-secondary,#555)">
            <input type="checkbox" id="n360-cp-viejos" checked style="width:auto;margin-top:2px"/>
            <span>Deshacer ${viejos.length === 1 ? 'el cierre' : 'los cierres'} ${viejos.map(v => `del ${fechaCorta(v.desde)} al ${fechaCorta(v.hasta)}`).join(', ')}: ya no ${viejos.length === 1 ? 'corresponde' : 'corresponden'} a tu día de cierre (solo se borra ese resumen, ningún movimiento).</span></label>` : ''}
          <p id="n360-cp-msg" style="font-size:12.5px;margin:10px 0 0;min-height:16px"></p>
        </div>
        <div style="padding:6px 20px 16px;text-align:right">
          <button type="button" data-accion="despues" style="background:none;border:none;color:var(--text-muted,#777);cursor:pointer;font:inherit;font-size:13px;text-decoration:underline">Recordármelo después</button>
        </div>
      </div>`;
    document.body.appendChild(caja);
    caja.addEventListener('click', ev => {
      const b = ev.target.closest('[data-accion]'); if (!b) return;
      accion(cli, p, b.dataset.accion, caja, viejos);
    });
  }
  function siguiente(iso) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  async function accion(cli, p, que, caja, viejos) {
    const msg = caja.querySelector('#n360-cp-msg');
    if (que === 'despues') { try { sessionStorage.setItem('n360_cierre_pend_' + p.hasta, 'despues'); } catch (_) {} caja.remove(); return; }
    if (que === 'contar') { try { sessionStorage.setItem('n360_cierre_pend_' + p.hasta, 'despues'); } catch (_) {} location.href = 'caja.html?cierre=1'; return; }
    caja.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '.6'; });
    msg.style.color = 'var(--text-muted,#777)'; msg.textContent = 'Cerrando el período…';
    try {
      if (viejos.length && caja.querySelector('#n360-cp-viejos')?.checked) {
        for (const v of viejos) {
          const { error } = await cli.rpc('caja_cierre_deshacer', { p_id: v.id });
          if (error) throw error;
        }
      }
      const { data, error } = await cli.rpc('caja_cierre_periodo', { p_hasta: p.hasta, p_efectivo_contado: null, p_retirar: que === 'cero', p_nota: null });
      if (error) throw error;
      msg.style.color = 'var(--success,#16a34a)';
      msg.textContent = que === 'cero' ? '✅ Listo: período cerrado y la Caja empieza de cero.' : '✅ Listo: período cerrado; la Caja sigue con su saldo.';
      setTimeout(() => location.reload(), 1400);
    } catch (e) {
      console.error('cierre pendiente:', e);
      msg.style.color = 'var(--danger,#dc2626)';
      msg.textContent = (e?.message && !/fetch/i.test(e.message)) ? e.message : 'No se pudo cerrar. Revisa tu conexión e intenta de nuevo.';
      caja.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = ''; });
    }
  }

  function arrancar() { setTimeout(() => { revisar().catch(e => console.warn('cierre pendiente:', e)); }, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
