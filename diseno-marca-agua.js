/* ============================================================
   DISENO-MARCA-AGUA.JS — NEGOCIO360 (Módulo especial de Diseño)
   Marca de agua para fotos:
   - Las FOTOS nunca salen del dispositivo: se leen, se les dibuja la
     marca en un canvas y se descargan (una o en .zip). No se suben ni
     se guardan en ningún lado.
   - Solo se guarda la CONFIGURACIÓN de cada marca (tabla
     diseno_marcas_agua) y, si es de logo, el logo en la carpeta propia
     de la cuenta (bucket inventario_fotos/<usuario>/diseno/marcas/).
   - Hasta 50 fotos por tanda; tandas ilimitadas.
   Usa la base común de páginas (TX: sesión, menú, tema, avisos).
   ============================================================ */
'use strict';

(function () {
  const sb = TX.sb;
  const $ = id => document.getElementById(id);
  const MAX_FOTOS = 50;
  const MAX_LOGO = 2 * 1024 * 1024;
  const MAX_PIXELES = 16000000;          // límite seguro de canvas en iPhone
  const BUCKET = 'inventario_fotos';
  const POSICIONES = [['tl', 'Arriba izquierda'], ['tc', 'Arriba centro'], ['tr', 'Arriba derecha'], ['ml', 'Centro izquierda'], ['mc', 'Centro'],
    ['mr', 'Centro derecha'], ['bl', 'Abajo izquierda'], ['bc', 'Abajo centro'], ['br', 'Abajo derecha']];
  const DEF = { texto: '© Mi Negocio', fuente: 'Plus Jakarta Sans', negrita: true, sombra: true, color: '#ffffff', tamano: 18, opacidad: 60, rotacion: 0, posicion: 'br', margen: 3, mosaico: false, espaciado: 60 };

  const ST = {
    marcas: [], actualId: null, tipo: 'texto', cfg: { ...DEF },
    logoPath: null, logoNuevo: null, logoImg: null,      // logo: guardado (path) o recién elegido (File)
    fotos: [], previewIdx: -1, ocupado: false, version: 0, resultados: null,
  };
  const cacheLogos = {};

  // ── Utilidades ────────────────────────────────────────────
  const esc = TX.esc;
  const nombreBase = n => String(n || 'foto').replace(/\.[^.]+$/, '');
  const extDe = mime => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] || 'jpg');
  const tam = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  function cargarImagen(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('No se pudo leer la imagen'));
      img.src = src;
    });
  }
  const aBlob = (canvas, tipo, calidad) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('No se pudo generar la imagen')), tipo, calidad));

  // ── Dibujo de la marca ────────────────────────────────────
  // tamano = % del ancho de la foto que ocupa la marca; margen = % del lado menor.
  function medirMarca(ctx, W, cfg, tipo, logo) {
    const ancho = Math.max(4, W * cfg.tamano / 100);
    if (tipo === 'logo') {
      if (!logo) return null;
      const lw = logo.naturalWidth || logo.width || 1, lh = logo.naturalHeight || logo.height || 1;
      return { w: ancho, h: ancho * lh / lw };
    }
    const texto = String(cfg.texto || '').trim();
    if (!texto) return null;
    ctx.font = `${cfg.negrita ? 700 : 400} 100px "${cfg.fuente}", sans-serif`;
    const w100 = Math.max(1, ctx.measureText(texto).width);
    const fs = Math.max(6, 100 * ancho / w100);
    return { w: ancho, h: fs * 1.2, fs, texto };
  }
  function pintarUna(ctx, m, cfg, tipo, logo) {
    if (tipo === 'logo') { ctx.drawImage(logo, -m.w / 2, -m.h / 2, m.w, m.h); return; }
    ctx.font = `${cfg.negrita ? 700 : 400} ${m.fs}px "${cfg.fuente}", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (cfg.sombra) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = m.fs * 0.08; ctx.shadowOffsetX = ctx.shadowOffsetY = m.fs * 0.03; }
    ctx.fillStyle = cfg.color || '#ffffff';
    ctx.fillText(m.texto, 0, 0);
    ctx.shadowColor = 'transparent';
  }
  function dibujarMarca(ctx, W, H, cfg, tipo, logo) {
    const m = medirMarca(ctx, W, cfg, tipo, logo);
    if (!m) return;
    const rot = (Number(cfg.rotacion) || 0) * Math.PI / 180;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0.05, cfg.opacidad / 100));
    if (cfg.mosaico) {
      const esp = 1 + (Number(cfg.espaciado) || 0) / 100;
      const pasoX = m.w * esp, pasoY = Math.max(m.h * esp, m.h + 4);
      const diag = Math.sqrt(W * W + H * H);
      ctx.translate(W / 2, H / 2); ctx.rotate(rot);
      let fila = 0;
      for (let y = -diag / 2; y <= diag / 2 + pasoY; y += pasoY, fila++) {
        const desfase = fila % 2 ? pasoX / 2 : 0;
        for (let x = -diag / 2 - pasoX + desfase; x <= diag / 2 + pasoX; x += pasoX) {
          ctx.save(); ctx.translate(x, y); pintarUna(ctx, m, cfg, tipo, logo); ctx.restore();
        }
      }
    } else {
      const margen = Math.min(W, H) * (Number(cfg.margen) || 0) / 100;
      const p = cfg.posicion || 'br';
      const x = p[1] === 'l' ? margen + m.w / 2 : p[1] === 'r' ? W - margen - m.w / 2 : W / 2;
      const y = p[0] === 't' ? margen + m.h / 2 : p[0] === 'b' ? H - margen - m.h / 2 : H / 2;
      ctx.translate(x, y); ctx.rotate(rot);
      pintarUna(ctx, m, cfg, tipo, logo);
    }
    ctx.restore();
  }

  // ── Formulario de la marca ────────────────────────────────
  function leerFormulario() {
    const n = id => Number($(id).value);
    ST.cfg = {
      texto: $('dm-texto').value, fuente: $('dm-fuente').value, negrita: $('dm-negrita').checked, sombra: $('dm-sombra').checked,
      color: $('dm-color').value, tamano: n('dm-tamano'), opacidad: n('dm-opacidad'), rotacion: n('dm-rotacion'),
      posicion: ST.cfg.posicion || 'br', margen: n('dm-margen'), mosaico: $('dm-mosaico').checked, espaciado: n('dm-espaciado'),
    };
    actualizarSalidas();
  }
  function actualizarSalidas() {
    $('dm-tamano-v').textContent = $('dm-tamano').value + '%';
    $('dm-opacidad-v').textContent = $('dm-opacidad').value + '%';
    $('dm-rotacion-v').textContent = $('dm-rotacion').value + '°';
    $('dm-margen-v').textContent = $('dm-margen').value + '%';
    $('dm-espaciado-v').textContent = $('dm-espaciado').value + '%';
    $('dm-calidad-v').textContent = $('dm-calidad').value + '%';
    $('dm-espaciado-wrap').style.display = $('dm-mosaico').checked ? '' : 'none';
    $('dm-pos').classList.toggle('dm-desactivado', $('dm-mosaico').checked);
    document.querySelectorAll('#dm-pos button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.pos === ST.cfg.posicion)));
  }
  function escribirFormulario(cfg) {
    const c = { ...DEF, ...(cfg || {}) };
    $('dm-texto').value = c.texto; $('dm-fuente').value = c.fuente; $('dm-negrita').checked = !!c.negrita; $('dm-sombra').checked = !!c.sombra;
    $('dm-color').value = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#ffffff';
    $('dm-tamano').value = c.tamano; $('dm-opacidad').value = c.opacidad; $('dm-rotacion').value = c.rotacion;
    $('dm-margen').value = c.margen; $('dm-mosaico').checked = !!c.mosaico; $('dm-espaciado').value = c.espaciado;
    ST.cfg = c; actualizarSalidas();
  }
  function ponerTipo(tipo) {
    ST.tipo = tipo === 'logo' ? 'logo' : 'texto';
    document.querySelectorAll('[data-dm-tipo]').forEach(b => b.classList.toggle('on', b.dataset.dmTipo === ST.tipo));
    $('dm-sec-texto').style.display = ST.tipo === 'texto' ? '' : 'none';
    $('dm-sec-logo').style.display = ST.tipo === 'logo' ? '' : 'none';
  }
  function pintarLogoPrev() {
    const box = $('dm-logo-prev');
    box.innerHTML = ST.logoImg ? '' : '<span>Sin logo</span>';
    if (ST.logoImg) { const i = document.createElement('img'); i.src = ST.logoImg.src; i.alt = 'Logo'; box.appendChild(i); }
  }
  function cambio() { ST.version++; ST.resultados = null; $('dm-compartir').style.display = 'none'; programarPreview(); }

  async function logoDePath(path) {
    if (!path) return null;
    if (cacheLogos[path]) return cacheLogos[path];
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) throw error || new Error('No se encontró el logo');
    const img = await cargarImagen(URL.createObjectURL(data));
    cacheLogos[path] = img;
    return img;
  }

  // ── Marcas guardadas ──────────────────────────────────────
  async function cargarMarcas(elegirId) {
    const { data, error } = await sb.from('diseno_marcas_agua').select('*').eq('auth_user_id', TX.userId).order('created_at');
    if (error) throw error;
    ST.marcas = data || [];
    const sel = $('dm-marca');
    sel.innerHTML = ST.marcas.length
      ? ST.marcas.map(m => `<option value="${esc(m.id)}">${m.tipo === 'logo' ? '🖼️' : 'Aa'} ${esc(m.nombre)}${m.predeterminada ? ' ★' : ''}</option>`).join('') + '<option value="">＋ Marca nueva sin guardar</option>'
      : '<option value="">Marca nueva (aún sin guardar)</option>';
    let id = elegirId;
    if (id === undefined) {
      let ultima = null; try { ultima = localStorage.getItem('n360_dm_ultima'); } catch (_) {}
      id = (ST.marcas.find(m => m.id === ultima) || ST.marcas.find(m => m.predeterminada) || ST.marcas[0] || {}).id || '';
    }
    sel.value = id || '';
    await elegirMarca(id || '');
  }
  async function elegirMarca(id) {
    const m = ST.marcas.find(x => x.id === id);
    ST.actualId = m ? m.id : null;
    ST.logoNuevo = null;
    try { if (m) localStorage.setItem('n360_dm_ultima', m.id); } catch (_) {}
    if (m) {
      $('dm-nombre').value = m.nombre; $('dm-pred').checked = !!m.predeterminada;
      escribirFormulario(m.config); ponerTipo(m.tipo);
      ST.logoPath = m.logo_path || null; ST.logoImg = null;
      if (m.tipo === 'logo' && m.logo_path) {
        try { ST.logoImg = await logoDePath(m.logo_path); } catch (e) { console.warn('logo:', e); TX.toast('No se pudo cargar el logo de esta marca.', 'error'); }
      }
    } else {
      $('dm-nombre').value = ''; $('dm-pred').checked = false;
      escribirFormulario({ ...DEF, texto: '© ' + (TX.empresaConfig?.nombre_comercial || 'Mi Negocio') });
      ponerTipo('texto'); ST.logoPath = null; ST.logoImg = null;
    }
    $('dm-eliminar').style.display = m ? '' : 'none';
    pintarLogoPrev();
    cambio();
  }

  async function elegirLogo(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { TX.toast('El logo debe ser PNG, JPG, WebP o SVG.', 'error'); return; }
    if (file.size > MAX_LOGO) { TX.toast('El logo pesa más de 2 MB. Usa uno más liviano.', 'error'); return; }
    try {
      ST.logoImg = await cargarImagen(URL.createObjectURL(file));
      ST.logoNuevo = file;
      pintarLogoPrev(); cambio();
    } catch (_) { TX.toast('No se pudo leer ese logo.', 'error'); }
  }

  async function guardarMarca() {
    leerFormulario();
    const nombre = $('dm-nombre').value.trim();
    if (!nombre) { TX.toast('Ponle un nombre a tu marca de agua.', 'error'); $('dm-nombre').focus(); return; }
    if (ST.tipo === 'texto' && !ST.cfg.texto.trim()) { TX.toast('Escribe el texto de la marca.', 'error'); return; }
    if (ST.tipo === 'logo' && !ST.logoNuevo && !ST.logoPath) { TX.toast('Elige el logo.', 'error'); return; }
    if (!ST.actualId && ST.marcas.length >= 50) { TX.toast('Ya tienes 50 marcas guardadas. Elimina alguna para crear otra.', 'error'); return; }
    const btn = $('dm-guardar'); btn.disabled = true;
    let subido = null;
    try {
      let logoPath = ST.tipo === 'logo' ? ST.logoPath : null;
      if (ST.tipo === 'logo' && ST.logoNuevo) {
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[ST.logoNuevo.type] || 'png';
        subido = `${TX.userId}/diseno/marcas/${crypto.randomUUID()}.${ext}`;
        const { error: eUp } = await sb.storage.from(BUCKET).upload(subido, ST.logoNuevo, { contentType: ST.logoNuevo.type, upsert: false });
        if (eUp) throw eUp;
        logoPath = subido;
      }
      const pred = $('dm-pred').checked;
      if (pred) {
        const q = sb.from('diseno_marcas_agua').update({ predeterminada: false }).eq('auth_user_id', TX.userId).eq('predeterminada', true);
        const { error: eP } = ST.actualId ? await q.neq('id', ST.actualId) : await q;
        if (eP) throw eP;
      }
      const fila = { nombre, tipo: ST.tipo, config: ST.cfg, logo_path: logoPath, predeterminada: pred, updated_at: new Date().toISOString() };
      let id = ST.actualId;
      const anterior = ST.marcas.find(m => m.id === id);
      if (id) {
        const { error } = await sb.from('diseno_marcas_agua').update(fila).eq('id', id).eq('auth_user_id', TX.userId);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('diseno_marcas_agua').insert({ ...fila, auth_user_id: TX.userId }).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      if (subido) cacheLogos[subido] = ST.logoImg;
      // El logo anterior que ya no se usa se quita de la carpeta de la cuenta
      if (anterior?.logo_path && anterior.logo_path !== logoPath) sb.storage.from(BUCKET).remove([anterior.logo_path]).catch(() => {});
      subido = null;
      TX.toast('Marca de agua guardada.');
      await cargarMarcas(id);
    } catch (e) {
      console.error('guardarMarca:', e);
      if (subido) sb.storage.from(BUCKET).remove([subido]).catch(() => {});
      TX.toast('No se pudo guardar la marca de agua: ' + (e.message || e), 'error');
    } finally { btn.disabled = false; }
  }

  async function eliminarMarca() {
    const m = ST.marcas.find(x => x.id === ST.actualId);
    if (!m) return;
    if (!(await TX.confirmar('Eliminar marca de agua', `¿Eliminar "${m.nombre}"? Tus fotos no se ven afectadas.`, 'Eliminar', true))) return;
    try {
      const { error } = await sb.from('diseno_marcas_agua').delete().eq('id', m.id).eq('auth_user_id', TX.userId);
      if (error) throw error;
      if (m.logo_path) sb.storage.from(BUCKET).remove([m.logo_path]).catch(() => {});
      TX.toast('Marca de agua eliminada.');
      await cargarMarcas('');
    } catch (e) { TX.toast('No se pudo eliminar: ' + (e.message || e), 'error'); }
  }

  // ── Fotos ─────────────────────────────────────────────────
  async function agregarFotos(lista) {
    if (ST.ocupado) return;
    const imagenes = [...lista].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name));
    if (!imagenes.length) { TX.toast('Elige archivos de imagen (JPG, PNG o WebP).', 'error'); return; }
    const libres = MAX_FOTOS - ST.fotos.length;
    if (libres <= 0) { TX.toast(`Ya tienes ${MAX_FOTOS} fotos en esta tanda. Descárgalas o quita algunas para agregar más.`, 'error'); return; }
    const tomadas = imagenes.slice(0, libres);
    if (imagenes.length > libres) TX.toast(`Se agregaron ${tomadas.length}. El máximo es ${MAX_FOTOS} fotos por tanda.`, 'error');
    for (const file of tomadas) ST.fotos.push({ id: Math.random().toString(36).slice(2), file, thumb: null, estado: 'lista', error: null });
    if (ST.previewIdx < 0) ST.previewIdx = 0;
    cambio(); pintarThumbs();
    // miniaturas una por una (no satura la memoria del teléfono)
    for (const f of ST.fotos) {
      if (f.thumb || f.estado === 'error') continue;
      try {
        const url = URL.createObjectURL(f.file);
        const img = await cargarImagen(url);
        const c = document.createElement('canvas'); const k = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        f.thumb = c.toDataURL('image/jpeg', 0.7); f.dim = `${img.naturalWidth}×${img.naturalHeight}`;
        URL.revokeObjectURL(url);
      } catch (_) { f.estado = 'error'; f.error = 'Formato no compatible en este navegador'; }
      pintarThumbs();
    }
  }
  function pintarThumbs() {
    $('dm-contador').textContent = `${ST.fotos.length} / ${MAX_FOTOS}`;
    $('dm-procesar').disabled = !ST.fotos.some(f => f.estado !== 'error') || ST.ocupado;
    $('dm-limpiar').disabled = !ST.fotos.length || ST.ocupado;
    $('dm-procesar').textContent = ST.fotos.length > 1 ? `Aplicar marca y descargar (${ST.fotos.length} fotos en .zip)` : 'Aplicar marca y descargar';
    $('dm-thumbs').innerHTML = ST.fotos.map((f, i) => `
      <div class="dm-thumb${i === ST.previewIdx ? ' on' : ''}${f.estado === 'error' ? ' err' : ''}" data-dm-ver="${i}" title="${esc(f.file.name)}">
        ${f.thumb ? `<img src="${f.thumb}" alt="" />` : '<span class="dm-thumb-c">…</span>'}
        <span class="dm-thumb-n">${esc(f.file.name)}</span>
        <span class="dm-thumb-s">${f.estado === 'error' ? '⚠️ ' + esc(f.error || 'Error') : f.estado === 'hecha' ? '✓ Lista' : esc(tam(f.file.size))}</span>
        ${ST.ocupado ? '' : `<button type="button" class="dm-thumb-x" data-dm-quitar="${i}" aria-label="Quitar foto">×</button>`}
      </div>`).join('');
  }
  function quitarFoto(i) {
    ST.fotos.splice(i, 1);
    if (ST.previewIdx >= ST.fotos.length) ST.previewIdx = ST.fotos.length - 1;
    cambio(); pintarThumbs();
  }

  // ── Vista previa ──────────────────────────────────────────
  let rafPrev = 0, imgPrevCache = { id: null, img: null };
  function programarPreview() { cancelAnimationFrame(rafPrev); rafPrev = requestAnimationFrame(() => { pintarPreview().catch(e => console.warn('preview:', e)); }); }
  async function pintarPreview() {
    const c = $('dm-preview'), ctx = c.getContext('2d');
    const f = ST.fotos[ST.previewIdx];
    let img = null;
    if (f && f.estado !== 'error') {
      if (imgPrevCache.id !== f.id) {
        const url = URL.createObjectURL(f.file);
        try { imgPrevCache = { id: f.id, img: await cargarImagen(url) }; } catch (_) { imgPrevCache = { id: null, img: null }; }
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      img = imgPrevCache.img;
    }
    const W0 = img ? img.naturalWidth : 1200, H0 = img ? img.naturalHeight : 800;
    const k = Math.min(1, 1100 / Math.max(W0, H0));
    c.width = Math.round(W0 * k); c.height = Math.round(H0 * k);
    if (img) ctx.drawImage(img, 0, 0, c.width, c.height);
    else {
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#94a3b8'); g.addColorStop(.55, '#475569'); g.addColorStop(1, '#1e293b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(c.width * (0.15 + i * 0.15), c.height * (0.3 + (i % 2) * 0.35), c.height * 0.12, 0, Math.PI * 2); ctx.fill(); }
    }
    try { await document.fonts.load(`${ST.cfg.negrita ? 700 : 400} 40px "${ST.cfg.fuente}"`); } catch (_) {}
    dibujarMarca(ctx, c.width, c.height, ST.cfg, ST.tipo, ST.logoImg);
    $('dm-preview-nota').textContent = img ? `Vista previa: ${f.file.name}` : (f ? 'No se pudo leer esta foto' : 'Vista previa con una foto de ejemplo');
  }

  // ── Procesar y descargar ──────────────────────────────────
  async function procesar() {
    if (ST.ocupado) return;
    leerFormulario();
    if (ST.tipo === 'logo' && !ST.logoImg) { TX.toast('Elige el logo de la marca de agua.', 'error'); return; }
    if (ST.tipo === 'texto' && !ST.cfg.texto.trim()) { TX.toast('Escribe el texto de la marca de agua.', 'error'); return; }
    const validas = ST.fotos.filter(f => f.estado !== 'error');
    if (!validas.length) return;
    ST.ocupado = true; pintarThumbs();
    $('dm-progreso').hidden = false;
    const cfg = { ...ST.cfg }, tipo = ST.tipo, logo = ST.logoImg, version = ST.version;
    const formato = $('dm-formato').value, anchoMax = Number($('dm-ancho').value) || 0, calidad = Number($('dm-calidad').value) / 100;
    try { await document.fonts.load(`${cfg.negrita ? 700 : 400} 40px "${cfg.fuente}"`); } catch (_) {}
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    const resultados = [], usados = new Set();
    let n = 0, fallos = 0;
    for (const f of validas) {
      n++;
      $('dm-progreso-txt').textContent = `Procesando ${n} de ${validas.length}…`;
      $('dm-barra').style.width = `${Math.round(100 * (n - 1) / validas.length)}%`;
      const url = URL.createObjectURL(f.file);
      try {
        const img = await cargarImagen(url);
        let W = img.naturalWidth, H = img.naturalHeight;
        let k = 1;
        if (anchoMax && Math.max(W, H) > anchoMax) k = anchoMax / Math.max(W, H);
        if (W * H * k * k > MAX_PIXELES) k = Math.sqrt(MAX_PIXELES / (W * H));
        W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k));
        canvas.width = W; canvas.height = H;
        const mime = formato === 'original' ? (['image/jpeg', 'image/png', 'image/webp'].includes(f.file.type) ? f.file.type : 'image/jpeg') : formato;
        if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }   // JPG no tiene transparencia
        ctx.drawImage(img, 0, 0, W, H);
        dibujarMarca(ctx, W, H, cfg, tipo, logo);
        const blob = await aBlob(canvas, mime, mime === 'image/png' ? undefined : calidad);
        let nombre = `${nombreBase(f.file.name)}_marca.${extDe(mime)}`, i = 2;
        while (usados.has(nombre.toLowerCase())) nombre = `${nombreBase(f.file.name)}_marca(${i++}).${extDe(mime)}`;
        usados.add(nombre.toLowerCase());
        resultados.push({ nombre, blob });
        f.estado = 'hecha';
      } catch (e) {
        console.warn('procesar foto:', f.file.name, e);
        f.estado = 'error'; f.error = 'No se pudo procesar'; fallos++;
      } finally { URL.revokeObjectURL(url); }
      pintarThumbs();
      await new Promise(r => setTimeout(r, 0));   // deja respirar a la pantalla
    }
    canvas.width = canvas.height = 1;               // libera memoria
    $('dm-barra').style.width = '100%';
    try {
      if (!resultados.length) { TX.toast('No se pudo procesar ninguna foto.', 'error'); return; }
      if (resultados.length === 1) descargar(resultados[0].blob, resultados[0].nombre);
      else {
        $('dm-progreso-txt').textContent = 'Armando el .zip…';
        const zip = await crearZip(resultados);
        descargar(zip, `marca-de-agua_${new Date().toISOString().slice(0, 10)}.zip`);
      }
      if (version === ST.version) ST.resultados = resultados;
      $('dm-compartir').style.display = puedeCompartir(resultados) ? '' : 'none';
      $('dm-progreso-txt').textContent = `Listo: ${resultados.length} foto(s)${fallos ? ` · ${fallos} con problema` : ''}. Tus fotos no se guardaron en el sistema.`;
      TX.toast(fallos ? `Listo. ${fallos} foto(s) no se pudieron procesar.` : 'Listo. Revisa tus descargas.', fallos ? 'error' : 'success');
    } catch (e) {
      console.error('descarga:', e);
      TX.toast('No se pudo generar la descarga: ' + (e.message || e), 'error');
    } finally {
      ST.ocupado = false; pintarThumbs();
    }
  }
  function descargar(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  function archivos(res) { return res.map(r => new File([r.blob], r.nombre, { type: r.blob.type })); }
  function puedeCompartir(res) {
    try { return !!(navigator.canShare && res?.length && navigator.canShare({ files: archivos(res.slice(0, 1)) })); } catch (_) { return false; }
  }
  async function compartir() {
    if (!ST.resultados) return;
    try { await navigator.share({ files: archivos(ST.resultados), title: 'Fotos con marca de agua' }); }
    catch (e) { if (e?.name !== 'AbortError') TX.toast('Tu teléfono no permitió guardarlas así. Usa el .zip descargado.', 'error'); }
  }

  // ── ZIP sin compresión (las fotos ya vienen comprimidas) ──
  const TABLA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = TABLA_CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function crearZip(lista) {
    const enc = new TextEncoder(), partes = [], central = [];
    const d = new Date();
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    for (const { nombre, blob } of lista) {
      const datos = new Uint8Array(await blob.arrayBuffer());
      const nom = enc.encode(nombre), crc = crc32(datos), size = datos.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, hora, true); lh.setUint16(12, fecha, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true);
      lh.setUint32(22, size, true); lh.setUint16(26, nom.length, true); lh.setUint16(28, 0, true);
      partes.push(lh.buffer, nom, blob);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, hora, true); ch.setUint16(14, fecha, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, nom.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, nom);
      offset += 30 + nom.length + size;
    }
    const tamCentral = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, lista.length, true); fin.setUint16(10, lista.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
    return new Blob([...partes, ...central, fin.buffer], { type: 'application/zip' });
  }

  // ── Eventos ───────────────────────────────────────────────
  function montarPosiciones() {
    $('dm-pos').innerHTML = POSICIONES.map(([v, t]) => `<button type="button" role="radio" data-pos="${v}" aria-label="${t}" title="${t}"><i></i></button>`).join('');
  }
  function eventos() {
    ['dm-texto', 'dm-fuente', 'dm-negrita', 'dm-sombra', 'dm-color', 'dm-tamano', 'dm-opacidad', 'dm-rotacion', 'dm-margen', 'dm-mosaico', 'dm-espaciado']
      .forEach(id => $(id).addEventListener('input', () => { leerFormulario(); cambio(); }));
    $('dm-calidad').addEventListener('input', actualizarSalidas);
    ['dm-formato', 'dm-ancho', 'dm-calidad'].forEach(id => $(id).addEventListener('change', () => { ST.resultados = null; $('dm-compartir').style.display = 'none'; }));
    $('dm-marca').addEventListener('change', e => elegirMarca(e.target.value));
    $('dm-nueva').addEventListener('click', () => { $('dm-marca').value = ''; elegirMarca(''); $('dm-nombre').focus(); });
    $('dm-guardar').addEventListener('click', guardarMarca);
    $('dm-eliminar').addEventListener('click', eliminarMarca);
    $('dm-logo-file').addEventListener('change', e => { elegirLogo(e.target.files[0]); e.target.value = ''; });
    $('dm-fotos').addEventListener('change', e => { agregarFotos(e.target.files); e.target.value = ''; });
    $('dm-procesar').addEventListener('click', procesar);
    $('dm-compartir').addEventListener('click', compartir);
    $('dm-limpiar').addEventListener('click', () => { if (ST.ocupado) return; ST.fotos = []; ST.previewIdx = -1; imgPrevCache = { id: null, img: null }; $('dm-progreso').hidden = true; cambio(); pintarThumbs(); });
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-dm-tipo],[data-pos],[data-dm-quitar],[data-dm-ver]'); if (!t) return;
      if (t.dataset.dmTipo) { ponerTipo(t.dataset.dmTipo); cambio(); }
      else if (t.dataset.pos) { ST.cfg.posicion = t.dataset.pos; leerFormulario(); cambio(); }
      else if (t.dataset.dmQuitar !== undefined) { e.preventDefault(); e.stopPropagation(); if (!ST.ocupado) quitarFoto(Number(t.dataset.dmQuitar)); }
      else if (t.dataset.dmVer !== undefined) { ST.previewIdx = Number(t.dataset.dmVer); pintarThumbs(); programarPreview(); }
    });
    const drop = $('dm-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('sobre'); }));
    drop.addEventListener('drop', e => agregarFotos(e.dataTransfer.files));
    window.addEventListener('beforeunload', e => { if (ST.ocupado) { e.preventDefault(); e.returnValue = ''; } });
  }

  window.DM = ST;
  document.addEventListener('DOMContentLoaded', () => {
    montarPosiciones(); eventos();
    TX.init(async () => {
      try { await cargarMarcas(); }
      catch (e) { console.error('cargarMarcas:', e); TX.toast('No se pudieron cargar tus marcas de agua.', 'error'); await elegirMarca(''); }
      pintarThumbs();
    });
  });
})();
