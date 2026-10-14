/* ============================================================
   BOTÓN DE MONEDA DE VISUALIZACIÓN (compartido)
   ------------------------------------------------------------
   Agrega el mismo botón y la misma ventana "Moneda de
   visualización" que ya existen en Caja, Ventas, etc., a las
   páginas que todavía no lo tienen, sin copiar el HTML en cada
   una.

   - Solo cambia cómo se MUESTRAN los números en este dispositivo
     (usa moneda-visualizacion.js). Nunca toca la base de datos.
   - Si la página ya trae su propio botón (#btn-moneda-vis-texto),
     no hace nada: así no se duplica nada en los módulos de antes.
   - Requiere que moneda-visualizacion.js esté cargado antes.
   ============================================================ */
(function () {
  'use strict';
  if (window.__n360MonedaVisBoton) return;
  window.__n360MonedaVisBoton = true;

  // Moneda oficial del negocio: la toma de lo que la página ya cargó.
  function monedaOficial() {
    try { if (window.TX && TX.empresaConfig && TX.empresaConfig.moneda) return TX.empresaConfig.moneda; } catch (_) {}
    try { if (window.TP && TP.empresaConfig && TP.empresaConfig.moneda) return TP.empresaConfig.moneda; } catch (_) {}
    try { if (typeof STATE !== 'undefined' && STATE && STATE.empresaConfig && STATE.empresaConfig.moneda) return STATE.empresaConfig.moneda; } catch (_) {}
    return null;
  }
  function oficialOParDefecto() { return monedaOficial() || 'NIO'; }

  const $ = id => document.getElementById(id);

  function crearModal() {
    if ($('mvb-modal')) return;
    const campo = 'width:100%;padding:8px 10px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:var(--bg-surface-2,#fafafa);color:var(--text-primary,#111);font-size:13.5px';
    const opt = 'style="background:var(--bg-surface,#fff);color:var(--text-primary,#111)"';
    const div = document.createElement('div');
    div.id = 'mvb-modal';
    div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center;padding:16px';
    div.innerHTML = `
  <div style="background:var(--bg-surface,#fff);color:var(--text-primary,#111);border-radius:14px;width:100%;max-width:380px;max-height:90vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border,#e5e7eb)">
      <span style="font-weight:700;font-size:15px">💱 Moneda de visualización</span>
      <button type="button" data-mvb="cerrar" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-secondary,#666)">✕</button>
    </div>
    <div style="padding:16px 18px">
      <p style="font-size:12.5px;color:var(--text-secondary,#666);margin:0 0 14px">
        Tus datos siempre se guardan en tu moneda oficial (<b id="mvb-oficial">—</b>). Esto solo cambia cómo se <b>muestran</b> los números en este dispositivo — nada se modifica de verdad.
      </p>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;margin-bottom:5px">Ver todo en</label>
        <select id="mvb-select" style="${campo}">
          <option value="" ${opt}>Mi moneda oficial (sin conversión)</option>
          <option value="NIO" ${opt}>Córdobas (NIO)</option>
          <option value="USD" ${opt}>Dólares (USD)</option>
        </select>
      </div>
      <div id="mvb-wrap-tasa" style="display:none;margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;margin-bottom:5px">Tu tasa de cambio (córdobas por 1 dólar)</label>
        <input type="number" id="mvb-tasa" min="0.01" step="0.01" placeholder="Ej: 36.60" style="${campo}"/>
      </div>
      <p id="mvb-error" style="color:#ef4444;font-size:12.5px;margin:0"></p>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid var(--border,#e5e7eb)">
      <button type="button" data-mvb="cerrar" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border,#e5e7eb);background:transparent;color:var(--text-primary,#111);cursor:pointer;font-size:13px">Cancelar</button>
      <button type="button" id="mvb-aplicar" style="padding:8px 14px;border-radius:8px;border:none;background:var(--accent,#6C63FF);color:#fff;cursor:pointer;font-size:13px;font-weight:600">Aplicar</button>
    </div>
  </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', e => {
      if (e.target === div || (e.target.closest && e.target.closest('[data-mvb="cerrar"]'))) cerrar();
    });
    $('mvb-select').addEventListener('change', mostrarTasaSiHaceFalta);
    $('mvb-aplicar').addEventListener('click', aplicar);
  }

  function mostrarTasaSiHaceFalta() {
    const elegida = $('mvb-select').value;
    $('mvb-wrap-tasa').style.display = (elegida && elegida !== oficialOParDefecto()) ? '' : 'none';
  }
  function abrir() {
    crearModal();
    $('mvb-oficial').textContent = oficialOParDefecto();
    $('mvb-select').value = monedaVisualizacionActiva() || '';
    $('mvb-tasa').value = tasaVisualizacionActiva() || '';
    $('mvb-error').textContent = '';
    mostrarTasaSiHaceFalta();
    $('mvb-modal').style.display = 'flex';
  }
  function cerrar() { const m = $('mvb-modal'); if (m) m.style.display = 'none'; }
  function aplicar() {
    const elegida = $('mvb-select').value;
    $('mvb-error').textContent = '';
    if (!elegida || elegida === oficialOParDefecto()) {
      desactivarMonedaVisualizacion();
    } else {
      const tasa = parseFloat($('mvb-tasa').value);
      if (!tasa || tasa <= 0) { $('mvb-error').textContent = 'Escribe tu tasa de cambio (córdobas por 1 dólar).'; return; }
      activarMonedaVisualizacion(elegida, tasa);
    }
    location.reload();
  }

  function crearBoton() {
    if ($('btn-moneda-vis-texto') || $('mvb-boton')) return true; // ya existe
    const tema = document.querySelector('.theme-btn[onclick*="toggleTheme"]');
    if (!tema || !tema.parentNode) return false;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'mvb-boton';
    b.className = 'theme-btn';
    b.setAttribute('data-tooltip', 'Cambiar moneda de visualización');
    b.title = 'Cambiar moneda de visualización';
    b.style.cssText = 'font-size:11px;font-weight:700;width:auto;padding:0 8px';
    b.innerHTML = '<span id="mvb-boton-texto"></span>';
    b.addEventListener('click', abrir);
    tema.parentNode.insertBefore(b, tema);
    actualizarTexto();
    return true;
  }
  function actualizarTexto() {
    const t = $('mvb-boton-texto');
    if (t) t.textContent = monedaParaMostrar(monedaOficial() || undefined);
  }

  function iniciar() {
    if (typeof monedaVisualizacionActiva !== 'function') return; // falta moneda-visualizacion.js
    if (!crearBoton()) return;
    // El texto se ajusta cuando la página termina de cargar la empresa
    // (igual que en Caja: revisa cada 100 ms, máximo 3 s).
    let intentos = 0;
    const t = setInterval(() => {
      intentos++;
      if (monedaOficial() || intentos >= 30) { clearInterval(t); actualizarTexto(); }
    }, 100);
  }

  window.N360MonedaVisBoton = { abrir, cerrar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
