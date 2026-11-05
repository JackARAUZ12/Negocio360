/* ============================================================
   ENVIAR-DOC.JS — NEGOCIO360 · "📤 Enviar al cliente" (Fase 3)
   Una sola ventana para enviar factura, proforma o cotización con su PDF.
     · Celular: comparte el PDF directo (WhatsApp, Gmail, etc.) con el menú del teléfono.
     · Computadora: descarga el PDF y abre WhatsApp o el correo con el número/correo
       y el mensaje ya escritos (solo hay que adjuntar el PDF descargado).
   GRATIS: no usa servicios pagados ni envía nada solo; siempre lo envía la persona.
   No toca montos, Caja, inventario ni el documento: solo genera el PDF de siempre.
   Uso: N360Enviar.abrir({ titulo, archivo, asunto, texto, cliente:{nombre,telefono,whatsapp,correo},
                           generar: async () => jsPDF, alEnviar: async (via) => {} })
   ============================================================ */
(function () {
  'use strict';
  if (window.N360Enviar) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { try { (window.showToast || (() => {}))(m, t || 'success'); } catch (_) {} };
  // Mismo criterio de todo el sistema: 8 dígitos (Nicaragua) → se antepone 505.
  function numeroWa(t) { const d = String(t || '').replace(/\D/g, ''); if (!d) return ''; return d.length === 8 ? '505' + d : d; }
  const correoValido = c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c || '').trim());

  function estilos() {
    if (document.getElementById('n360env-css')) return;
    const s = document.createElement('style'); s.id = 'n360env-css';
    s.textContent = `
      .n360env-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100050;display:flex;align-items:center;justify-content:center;padding:12px}
      .n360env-caja{background:var(--bg-surface,var(--bg-card,#fff));color:var(--text-primary,#0d0d14);border-radius:16px;width:100%;max-width:460px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);border:1px solid var(--border,#e8e8ef)}
      .n360env-cab{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--border,#e8e8ef)}
      .n360env-cab b{font-size:15.5px}
      .n360env-cab small{display:block;font-size:12px;color:var(--text-muted,#71717a);font-weight:400;margin-top:2px}
      .n360env-x{background:none;border:none;font-size:18px;cursor:pointer;color:inherit;padding:4px 8px}
      .n360env-cuerpo{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px}
      .n360env-campo{display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:700}
      .n360env-campo input,.n360env-campo textarea{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--border,#e8e8ef);border-radius:9px;font:inherit;font-size:13.5px;font-weight:400;background:var(--bg-surface-2,transparent);color:inherit}
      .n360env-campo textarea{min-height:84px;resize:vertical}
      .n360env-fila{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .n360env-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border-radius:11px;border:1px solid var(--border,#e8e8ef);background:var(--bg-surface-2,transparent);color:inherit;font:inherit;font-weight:700;font-size:14px;cursor:pointer}
      .n360env-btn:disabled{opacity:.5;cursor:not-allowed}
      .n360env-btn.prim{background:var(--accent,#5a5af4);border-color:var(--accent,#5a5af4);color:#fff}
      .n360env-btn.wa{background:#16a34a;border-color:#16a34a;color:#fff}
      .n360env-nota{font-size:12px;color:var(--text-muted,#71717a);line-height:1.45}
      .n360env-estado{font-size:12.5px;font-weight:600;padding:8px 10px;border-radius:9px;background:rgba(90,90,244,.1);color:var(--accent,#5a5af4)}
      .n360env-estado.err{background:rgba(220,38,38,.1);color:#dc2626}
      @media (max-width:480px){ .n360env-fila{grid-template-columns:1fr} }`;
    document.head.appendChild(s);
  }

  function puedeCompartirArchivo() {
    try {
      if (!navigator.share || !navigator.canShare || !window.File) return false;
      return navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] });
    } catch (_) { return false; }
  }
  const esCelular = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

  function abrir(o) {
    estilos();
    const viejo = document.getElementById('n360env-ov'); if (viejo) viejo.remove();
    const cli = o.cliente || {};
    const archivo = String(o.archivo || 'Documento.pdf').replace(/[^\w\-.]/g, '_');
    const compartir = puedeCompartirArchivo();
    const ov = document.createElement('div'); ov.id = 'n360env-ov'; ov.className = 'n360env-ov';
    ov.innerHTML = `<div class="n360env-caja" role="dialog" aria-modal="true">
      <div class="n360env-cab"><div><b>📤 Enviar ${esc(o.titulo || 'documento')}</b><small>${cli.nombre ? 'Para: ' + esc(cli.nombre) : 'Cliente sin nombre'}</small></div>
        <button type="button" class="n360env-x" data-x aria-label="Cerrar">✕</button></div>
      <div class="n360env-cuerpo">
        <div class="n360env-estado" id="n360env-estado">⏳ Preparando el PDF…</div>
        <div class="n360env-fila">
          <label class="n360env-campo">WhatsApp<input id="n360env-wa" inputmode="tel" placeholder="Ej. 8888 8888" value="${esc(cli.whatsapp || cli.telefono || '')}"></label>
          <label class="n360env-campo">Correo<input id="n360env-correo" type="email" inputmode="email" placeholder="cliente@correo.com" value="${esc(cli.correo || '')}"></label>
        </div>
        <label class="n360env-campo">Mensaje (puedes cambiarlo)<textarea id="n360env-texto" maxlength="1500">${esc(o.texto || '')}</textarea></label>
        ${compartir ? `<button type="button" class="n360env-btn prim" data-v="compartir" disabled>📱 Compartir PDF (WhatsApp, correo…)</button>` : ''}
        <div class="n360env-fila">
          <button type="button" class="n360env-btn wa" data-v="whatsapp" disabled>💬 WhatsApp</button>
          <button type="button" class="n360env-btn" data-v="correo" disabled>✉️ Correo</button>
        </div>
        <button type="button" class="n360env-btn" data-v="descargar" disabled>⬇️ Solo descargar el PDF</button>
        <div class="n360env-nota">${compartir
          ? '📱 <b>Compartir PDF</b> manda el archivo directo. Con <b>WhatsApp</b> o <b>Correo</b> se descarga el PDF y se abre el chat o el correo con el mensaje listo: solo adjunta el PDF descargado.'
          : 'Se descarga el PDF y se abre WhatsApp o tu correo con el mensaje listo: <b>solo adjunta el PDF</b> que se descargó (queda en Descargas).'}
          Es gratis y nada se envía solo.</div>
      </div></div>`;
    document.body.appendChild(ov);
    const $ = s => ov.querySelector(s), estado = $('#n360env-estado');
    let doc = null, blob = null, ocupado = false, enviado = false;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', tecla); };
    const tecla = e => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', tecla);
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) cerrar(); });

    // El PDF se prepara una sola vez al abrir: así los botones responden al instante
    // (el teléfono solo deja compartir si es justo después del toque).
    (async () => {
      try {
        doc = await o.generar();
        if (!doc || typeof doc.output !== 'function') throw new Error('sin PDF');
        blob = doc.output('blob');
        estado.textContent = '✅ PDF listo: ' + archivo;
        ov.querySelectorAll('[data-v]').forEach(b => { b.disabled = false; });
      } catch (e) {
        console.error('N360Enviar PDF:', e);
        estado.className = 'n360env-estado err'; estado.textContent = 'No se pudo preparar el PDF. Cierra e intenta de nuevo.';
      }
    })();

    function descargar() {
      try { doc.save(archivo); return true; }
      catch (e) {
        try { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = archivo; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return true; }
        catch (_) { toast('No se pudo descargar el PDF', 'error'); return false; }
      }
    }
    async function marcar(via) {
      if (enviado || typeof o.alEnviar !== 'function') { enviado = true; return; }
      enviado = true;
      try { await o.alEnviar(via); } catch (e) { console.warn('N360Enviar alEnviar:', e); }
    }

    ov.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', async () => {
      if (ocupado || !doc) return;
      const via = b.dataset.v, texto = $('#n360env-texto').value.trim();
      if (via === 'descargar') { descargar(); return; }
      if (via === 'compartir') {
        ocupado = true;
        try {
          const file = new File([blob], archivo, { type: 'application/pdf' });
          await navigator.share({ files: [file], title: o.asunto || o.titulo || archivo, text: texto });
          await marcar('compartir'); toast('📤 Enviado'); cerrar();
        } catch (e) {
          if (e && e.name === 'AbortError') { /* la persona canceló: no es error */ }
          else { console.warn('compartir PDF:', e); toast('No se pudo compartir; usa WhatsApp o Correo', 'error'); }
        } finally { ocupado = false; }
        return;
      }
      if (via === 'whatsapp') {
        const n = numeroWa($('#n360env-wa').value);
        if (!n || n.length < 8) { toast('Escribe el número de WhatsApp del cliente', 'error'); $('#n360env-wa').focus(); return; }
        // En la computadora se descarga el PDF para adjuntarlo; en el celular el chat se abre directo.
        if (!esCelular()) descargar();
        window.open(`https://wa.me/${n}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
        await marcar('whatsapp');
        estado.className = 'n360env-estado'; estado.textContent = esCelular() ? '💬 Se abrió WhatsApp. Si quieres mandar el PDF, usa "Compartir PDF" o "Solo descargar".' : '💬 Se abrió WhatsApp y se descargó el PDF: arrástralo o adjúntalo al chat.';
        return;
      }
      if (via === 'correo') {
        const c = $('#n360env-correo').value.trim();
        if (c && !correoValido(c)) { toast('Ese correo no parece válido', 'error'); $('#n360env-correo').focus(); return; }
        descargar();
        const a = document.createElement('a');
        a.href = `mailto:${encodeURIComponent(c)}?subject=${encodeURIComponent(o.asunto || o.titulo || '')}&body=${encodeURIComponent(texto + '\n\n(Adjunto: ' + archivo + ')')}`;
        a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
        await marcar('correo');
        estado.className = 'n360env-estado'; estado.textContent = '✉️ Se abrió tu correo y se descargó el PDF: adjúntalo antes de enviar.';
      }
    }));
  }

  window.N360Enviar = { abrir, numeroWa, _puedeCompartirArchivo: puedeCompartirArchivo };
})();
