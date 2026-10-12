/* ============================================================
   TRANSPORTE-COMUN.JS — NEGOCIO360
   Piezas compartidas por Flota y Conductores:
   arranque de página, fotos, documentos con vencimiento,
   ciclo de estados (con historial) y avisos.
   No modifica ningún otro módulo: solo usa sus propias tablas
   (transporte_*) y lee Activos fijos / Empleados.
   ============================================================ */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  const sb = window.__cajaSB || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const BUCKET = 'inventario_fotos';
  const DIAS_AVISO = 30;

  const TX = {
    sb, userId: null, empresaConfig: {}, perfilNombre: 'Usuario', DIAS_AVISO,
  };

  /* ---------- utilidades ---------- */
  const esc = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  const hoyISO = () => ymd(new Date());
  function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  function diasPara(iso) {
    if (!iso) return null;
    const a = new Date(hoyISO() + 'T12:00:00'), b = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    const d = Math.round((b - a) / 86400000);
    return isFinite(d) ? d : null;
  }
  const num = v => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) && String(v).trim() !== '' ? n : null; };
  const quitarTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  Object.assign(TX, { esc, ymd, hoyISO, fmtFecha, diasPara, num, quitarTildes });

  async function paginar(construir) {
    const out = []; const TAM = 1000;
    for (let desde = 0; desde < 50000; desde += TAM) {
      const { data, error } = await construir().range(desde, desde + TAM - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < TAM) break;
    }
    return out;
  }
  TX.paginar = paginar;

  /* ---------- catálogos ---------- */
  TX.TIPOS_UNIDAD = {
    cabezal:      { t: 'Cabezal / Tractocamión', ico: '🚛', rol: 'motriz' },
    rigido:       { t: 'Camión rígido', ico: '🚚', rol: 'motriz' },
    liviano:      { t: 'Camión liviano / Pick-up', ico: '🛻', rol: 'motriz' },
    volquete:     { t: 'Volquete', ico: '🚜', rol: 'motriz' },
    cisterna:     { t: 'Cisterna', ico: '🛢️', rol: 'arrastre' },
    furgon:       { t: 'Furgón / Remolque cerrado', ico: '📦', rol: 'arrastre' },
    plataforma:   { t: 'Plataforma / Cama baja', ico: '🧱', rol: 'arrastre' },
    contenedor:   { t: 'Chasis para contenedor', ico: '🚢', rol: 'arrastre' },
    otro:         { t: 'Otro', ico: '🔧', rol: 'motriz' },
  };
  TX.ESTADOS_UNIDAD = {
    disponible: { t: 'Disponible', clase: 'verde', ico: '🟢', ayuda: 'Lista para asignarse a un viaje' },
    en_viaje:   { t: 'En viaje', clase: 'azul', ico: '🔵', ayuda: 'Está en ruta con carga' },
    taller:     { t: 'En taller', clase: 'naranja', ico: '🟠', ayuda: 'En mantenimiento o reparación' },
    inactiva:   { t: 'Inactiva', clase: 'gris', ico: '⚪', ayuda: 'Fuera de operación' },
  };
  TX.ESTADOS_CONDUCTOR = {
    disponible: { t: 'Disponible', clase: 'verde', ico: '🟢', ayuda: 'Listo para un viaje' },
    en_viaje:   { t: 'En viaje', clase: 'azul', ico: '🔵', ayuda: 'Está en ruta' },
    descanso:   { t: 'En descanso', clase: 'naranja', ico: '🟠', ayuda: 'Descanso, vacaciones o permiso' },
    inactivo:   { t: 'Inactivo', clase: 'gris', ico: '⚪', ayuda: 'Ya no trabaja con nosotros' },
  };
  TX.TIPOS_DOC = {
    unidad: [
      { v: 'tarjeta_circulacion', t: 'Tarjeta de circulación', ico: '🪪' },
      { v: 'seguro', t: 'Seguro del vehículo', ico: '🛡️' },
      { v: 'poliza_carga', t: 'Póliza de carga', ico: '📦' },
      { v: 'revision_tecnica', t: 'Revisión técnica / mecánica', ico: '🔍' },
      { v: 'permiso_operacion', t: 'Permiso o concesión de transporte', ico: '📜' },
      { v: 'permiso_frontera', t: 'Permiso de cruce de frontera', ico: '🛂' },
      { v: 'emisiones', t: 'Control de emisiones', ico: '🌫️' },
      { v: 'propiedad', t: 'Título o contrato de propiedad', ico: '📑' },
      { v: 'otro', t: 'Otro documento…', ico: '📄' },
    ],
    conductor: [
      { v: 'licencia', t: 'Licencia de conducir', ico: '🪪' },
      { v: 'cedula', t: 'Cédula de identidad', ico: '🆔' },
      { v: 'pasaporte', t: 'Pasaporte', ico: '🛂' },
      { v: 'visa', t: 'Visa', ico: '✈️' },
      { v: 'certificado_medico', t: 'Certificado médico', ico: '🩺' },
      { v: 'antecedentes', t: 'Antecedentes penales', ico: '📋' },
      { v: 'contrato', t: 'Contrato', ico: '📝' },
      { v: 'otro', t: 'Otro documento…', ico: '📄' },
    ],
    orden: [
      { v: 'carta_porte', t: 'Carta de porte', ico: '📜' },
      { v: 'manifiesto', t: 'Manifiesto de carga', ico: '📋' },
      { v: 'dua', t: 'Declaración aduanera (DUA)', ico: '🛂' },
      { v: 'factura_comercial', t: 'Factura comercial', ico: '🧾' },
      { v: 'certificado_origen', t: 'Certificado de origen', ico: '🏷️' },
      { v: 'lista_empaque', t: 'Lista de empaque', ico: '📦' },
      { v: 'poliza_carga', t: 'Póliza de seguro de carga', ico: '🛡️' },
      { v: 'permiso_especial', t: 'Permiso sanitario / especial', ico: '✅' },
      { v: 'otro', t: 'Otro documento…', ico: '📄' },
    ],
  };
  TX.etiquetaDoc = (entidadTipo, tipo) => {
    const f = (TX.TIPOS_DOC[entidadTipo] || []).find(x => x.v === tipo);
    return f ? { t: f.t, ico: f.ico } : { t: tipo || 'Documento', ico: '📄' };
  };

  /* ---------- tema / menú lateral / mensajes (igual que el resto) ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('n360_theme', t); } catch (_) {}
    const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
    if (sun) sun.style.display = t === 'dark' ? 'block' : 'none';
    if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
  }
  let colapsado = false;
  const esMovil = () => window.innerWidth <= 768;
  window.toggleTheme = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  window.toggleSidebar = () => {
    if (esMovil()) {
      const s = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
      if (!s) return;
      const abierto = s.classList.toggle('mobile-open');
      if (ov) ov.classList.toggle('active', abierto);
    } else {
      colapsado = !colapsado;
      document.getElementById('sidebar').classList.toggle('collapsed', colapsado);
      document.getElementById('main').classList.toggle('sidebar-collapsed', colapsado);
    }
  };
  window.closeMobileSidebar = () => {
    const s = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
    if (s) s.classList.remove('mobile-open');
    if (ov) ov.classList.remove('active');
  };
  window.navigate = url => { window.closeMobileSidebar(); window.location.href = url; };
  window.addEventListener('resize', () => { if (!esMovil()) window.closeMobileSidebar(); });

  let _tt = null;
  function toast(msg, type = 'success') {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.className = `toast toast-${type} show`;
    clearTimeout(_tt); _tt = setTimeout(() => el.classList.remove('show'), 3800);
  }
  function abrir(id) { const m = document.getElementById(id); if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; } }
  function cerrar(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); if (!document.querySelector('.tx-modal.open')) document.body.style.overflow = ''; }
  Object.assign(TX, { toast, abrir, cerrar });
  window.TXcerrar = cerrar;

  function confirmar(titulo, texto, textoBoton = 'Continuar', peligro = false) {
    return new Promise(resolve => {
      document.getElementById('tx-conf-titulo').textContent = titulo;
      document.getElementById('tx-conf-texto').textContent = texto;
      const ok = document.getElementById('tx-conf-ok'), no = document.getElementById('tx-conf-no');
      ok.textContent = textoBoton; ok.className = peligro ? 'tx-btn tx-btn-danger' : 'tx-btn tx-btn-primary';
      const fin = v => { ok.onclick = null; no.onclick = null; cerrar('tx-modal-confirmar'); resolve(v); };
      ok.onclick = () => fin(true); no.onclick = () => fin(false);
      abrir('tx-modal-confirmar');
    });
  }
  TX.confirmar = confirmar;

  /* ---------- empresa / perfil ---------- */
  function nombrePerfilActivo() {
    try { const p = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); if (p?.nombre) return p.nombre; } catch (_) {}
    return TX.perfilNombre;
  }
  TX.nombrePerfilActivo = nombrePerfilActivo;
  TX.fmtMoneda = n => {
    const m = TX.empresaConfig?.moneda;
    let s = m === 'USD' ? '$' : 'C$';
    if (typeof monedaParaMostrar === 'function') { try { s = monedaParaMostrar(m); } catch (_) {} }
    return s + ' ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  async function cargarEmpresa(userId) {
    try {
      const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
      if (data) {
        TX.empresaConfig = data;
        const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = data.nombre_comercial || 'Mi negocio';
        if (data.color_principal) {
          document.documentElement.style.setProperty('--accent', data.color_principal);
          document.documentElement.style.setProperty('--accent-soft', data.color_principal + '22');
          document.documentElement.style.setProperty('--border-focus', data.color_principal);
        }
      }
    } catch (e) { console.warn('cargarEmpresa:', e); }
  }
  async function cargarPerfil(userId, email) {
    try {
      const { data: u } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
      const nombre = u?.nombre || email?.split('@')[0] || 'Usuario', apellido = u?.apellido || '';
      TX.perfilNombre = `${nombre} ${apellido}`.trim();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('header-name', TX.perfilNombre);
      set('header-biz', TX.empresaConfig?.nombre_comercial || 'Mi negocio');
      set('header-avatar', ((nombre[0] || '') + (apellido[0] || '')).toUpperCase() || 'U');
      const p = u?.plan || 'Gratuito'; set('plan-text', p.charAt(0).toUpperCase() + p.slice(1));
    } catch (_) {}
  }

  function montarBase() {
    if (document.getElementById('tx-modal-confirmar')) return;
    const d = document.createElement('div');
    d.innerHTML = `
      <div class="tx-modal" id="tx-modal-confirmar"><div class="tx-box" style="max-width:400px">
        <h3 id="tx-conf-titulo"></h3><p id="tx-conf-texto" style="font-size:14px;color:var(--text-secondary);margin:0"></p>
        <div class="tx-pie"><button type="button" class="tx-btn" id="tx-conf-no">Cancelar</button><button type="button" class="tx-btn tx-btn-primary" id="tx-conf-ok">Continuar</button></div>
      </div></div>
      <div class="tx-modal" id="tx-modal-doc"><div class="tx-box">
        <h3 id="tx-doc-titulo">Documento</h3>
        <div class="tx-campo"><label for="tx-doc-tipo">Tipo de documento</label><select class="tx-in" id="tx-doc-tipo"></select></div>
        <div class="tx-campo" id="tx-doc-otro-wrap" style="display:none"><label for="tx-doc-otro">¿Cómo se llama?</label><input class="tx-in" id="tx-doc-otro" maxlength="80" placeholder="Ej: Permiso especial de carga"/></div>
        <div class="tx-campo"><label for="tx-doc-numero">Número (opcional)</label><input class="tx-in" id="tx-doc-numero" maxlength="60"/></div>
        <div class="tx-cols">
          <div class="tx-campo"><label for="tx-doc-emision">Fecha de emisión</label><input type="date" class="tx-in" id="tx-doc-emision"/></div>
          <div class="tx-campo"><label for="tx-doc-venc">Fecha de vencimiento</label><input type="date" class="tx-in" id="tx-doc-venc"/></div>
        </div>
        <div class="tx-ayuda" style="margin:-4px 0 10px">Con la fecha de vencimiento el sistema te avisa ${DIAS_AVISO} días antes.</div>
        <div class="tx-campo"><label>Foto o PDF del documento (opcional)</label>
          <div id="tx-doc-archivo-actual" style="font-size:13px;margin-bottom:6px"></div>
          <input type="file" id="tx-doc-archivo" accept="image/*,application/pdf" style="font-size:13px;max-width:100%"/>
          <div class="tx-ayuda">Imagen o PDF de hasta 6 MB.</div></div>
        <div class="tx-campo"><label for="tx-doc-notas">Notas</label><input class="tx-in" id="tx-doc-notas" maxlength="200"/></div>
        <div class="tx-err" id="tx-doc-error"></div>
        <div class="tx-pie"><button type="button" class="tx-btn" onclick="TXcerrar('tx-modal-doc')">Cancelar</button><button type="button" class="tx-btn tx-btn-primary" id="tx-doc-guardar">Guardar</button></div>
      </div></div>`;
    while (d.firstChild) document.body.appendChild(d.firstChild);
    document.querySelectorAll('.tx-modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) cerrar(m.id); }));
    document.getElementById('tx-doc-tipo').addEventListener('change', () => {
      document.getElementById('tx-doc-otro-wrap').style.display = document.getElementById('tx-doc-tipo').value === 'otro' ? '' : 'none';
    });
  }

  /** Arranque común de cada página del módulo. */
  TX.init = async function (onListo) {
    applyTheme(localStorage.getItem('n360_theme') || 'light');
    const fechaEl = document.getElementById('header-fecha');
    if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user) { window.location.href = 'login.html'; return; }
      TX.userId = session.user.id;
      if (session.user.email) {
        sb.from('administradores').select('email,activo').eq('email', session.user.email).eq('activo', true).maybeSingle()
          .then(({ data }) => { if (data) { const el = document.getElementById('nav-admin'); if (el) el.style.display = 'flex'; } }, () => {});
      }
      await cargarEmpresa(TX.userId);
      await cargarPerfil(TX.userId, session.user.email);
      montarBase();
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
      await onListo();
    } catch (err) {
      console.error('TX.init:', err);
      document.getElementById('loader')?.classList.add('hidden');
      const app = document.getElementById('app'); if (app) app.style.display = 'flex';
      toast('Ocurrió un problema cargando la página.', 'error');
    }
  };
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') window.location.href = 'login.html'; });

  /* ============================================================
     FOTOS Y ARCHIVOS (bucket inventario_fotos, carpeta propia)
     ============================================================ */
  TX.comprimirImagen = function (archivo, anchoMax = 1000, calidad = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(archivo);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.width, h = img.height;
        if (w > anchoMax) { h = Math.round(h * (anchoMax / w)); w = anchoMax; }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo procesar la imagen')), 'image/webp', calidad);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  };
  TX.subirArchivo = async function (blob, carpeta, ext, contentType) {
    const nombre = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const ruta = `${TX.userId}/transporte/${carpeta}/${nombre}`;
    const { error } = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType, upsert: false });
    if (error) throw error;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(ruta);
    return { url: data.publicUrl, path: ruta };
  };
  TX.subirFoto = async function (archivo, carpeta) {
    const blob = await TX.comprimirImagen(archivo);
    return TX.subirArchivo(blob, carpeta, 'webp', 'image/webp');
  };
  TX.rutaDeUrl = url => {
    const k = `/${BUCKET}/`; const i = String(url || '').indexOf(k);
    return i >= 0 ? decodeURIComponent(String(url).slice(i + k.length).split('?')[0]) : null;
  };
  TX.borrarArchivo = async function (urlOPath) {
    try {
      const p = String(urlOPath || '').startsWith('http') ? TX.rutaDeUrl(urlOPath) : urlOPath;
      if (p && p.startsWith(TX.userId + '/')) await sb.storage.from(BUCKET).remove([p]);
    } catch (e) { console.warn('borrarArchivo:', e); }
  };

  /* ============================================================
     DOCUMENTOS CON VENCIMIENTO
     ============================================================ */
  TX.estadoDoc = function (venc) {
    const d = diasPara(venc);
    if (d == null) return { clave: 'sin_fecha', dias: null, clase: 'gris', texto: 'Sin vencimiento' };
    if (d < 0) return { clave: 'vencido', dias: d, clase: 'rojo', texto: `Vencido hace ${Math.abs(d)} día${Math.abs(d) === 1 ? '' : 's'}` };
    if (d === 0) return { clave: 'por_vencer', dias: d, clase: 'rojo', texto: 'Vence hoy' };
    if (d <= DIAS_AVISO) return { clave: 'por_vencer', dias: d, clase: 'naranja', texto: `Vence en ${d} día${d === 1 ? '' : 's'}` };
    return { clave: 'vigente', dias: d, clase: 'verde', texto: 'Vigente' };
  };
  /** Resumen de salud de los documentos de una entidad. */
  TX.saludDocs = function (docs) {
    if (!docs || !docs.length) return { clave: 'sin_docs', clase: 'gris', texto: 'Sin documentos' };
    const est = docs.map(d => TX.estadoDoc(d.vencimiento).clave);
    const v = est.filter(e => e === 'vencido').length, p = est.filter(e => e === 'por_vencer').length;
    if (v) return { clave: 'vencido', clase: 'rojo', texto: `${v} vencido${v === 1 ? '' : 's'}` };
    if (p) return { clave: 'por_vencer', clase: 'naranja', texto: `${p} por vencer` };
    return { clave: 'vigente', clase: 'verde', texto: 'Documentos al día' };
  };
  TX.cargarDocs = entidadTipo => paginar(() => sb.from('transporte_documentos').select('*')
    .eq('auth_user_id', TX.userId).eq('entidad_tipo', entidadTipo).order('vencimiento', { ascending: true, nullsFirst: false }));
  TX.agruparDocs = docs => { const m = {}; docs.forEach(d => { (m[d.entidad_id] = m[d.entidad_id] || []).push(d); }); return m; };

  TX.htmlDocs = function (entidadTipo, entidadId, docs) {
    const lista = (docs || []).slice().sort((a, b) => String(a.vencimiento || '9999').localeCompare(String(b.vencimiento || '9999')));
    return `<div class="tx-fila-chips" style="justify-content:space-between;margin-bottom:10px">
        <small style="color:var(--text-secondary)">${lista.length} documento${lista.length === 1 ? '' : 's'}</small>
        <button type="button" class="tx-btn tx-btn-sm tx-btn-primary" data-tx-doc-nuevo="${esc(entidadId)}">＋ Agregar documento</button></div>`
      + (lista.length ? lista.map(d => {
        const et = TX.etiquetaDoc(entidadTipo, d.tipo), e = TX.estadoDoc(d.vencimiento);
        return `<div class="tx-doc"><div style="font-size:24px">${et.ico}</div>
          <div class="tx-doc-info"><b>${esc(et.t)}${d.numero ? ' · ' + esc(d.numero) : ''}</b>
            <small>${d.vencimiento ? 'Vence: ' + esc(fmtFecha(d.vencimiento)) : 'Sin fecha de vencimiento'}</small></div>
          <span class="tx-chip ${e.clase}">${esc(e.texto)}</span>
          <div class="tx-doc-acc">
            ${d.archivo_url ? `<a class="tx-btn tx-btn-sm" href="${esc(d.archivo_url)}" target="_blank" rel="noopener">Ver archivo</a>` : ''}
            <button type="button" class="tx-btn tx-btn-sm" data-tx-doc-editar="${esc(d.id)}">Editar</button>
            <button type="button" class="tx-btn tx-btn-sm tx-btn-borrar" data-tx-doc-borrar="${esc(d.id)}">Quitar</button></div></div>`;
      }).join('') : `<div class="tx-vacio" style="padding:24px"><div class="tx-vacio-i">🗂️</div><b>Aún no hay documentos</b><p>Agrega los papeles con su fecha de vencimiento y el sistema te avisa a tiempo.</p></div>`);
  };

  let _docCtx = null;
  TX.abrirDoc = function (entidadTipo, entidadId, doc, alGuardar) {
    _docCtx = { entidadTipo, entidadId, doc: doc || null, alGuardar, archivo: null, quitarArchivo: false };
    const sel = document.getElementById('tx-doc-tipo');
    sel.innerHTML = TX.TIPOS_DOC[entidadTipo].map(t => `<option value="${t.v}">${t.ico} ${esc(t.t)}</option>`).join('');
    const conocido = doc && TX.TIPOS_DOC[entidadTipo].some(t => t.v === doc.tipo);
    sel.value = doc ? (conocido ? doc.tipo : 'otro') : TX.TIPOS_DOC[entidadTipo][0].v;
    document.getElementById('tx-doc-otro').value = doc && !conocido ? doc.tipo : '';
    document.getElementById('tx-doc-otro-wrap').style.display = sel.value === 'otro' ? '' : 'none';
    document.getElementById('tx-doc-numero').value = doc?.numero || '';
    document.getElementById('tx-doc-emision').value = doc?.emision || '';
    document.getElementById('tx-doc-venc').value = doc?.vencimiento || '';
    document.getElementById('tx-doc-notas').value = doc?.notas || '';
    document.getElementById('tx-doc-archivo').value = '';
    document.getElementById('tx-doc-error').textContent = '';
    document.getElementById('tx-doc-titulo').textContent = doc ? 'Editar documento' : 'Nuevo documento';
    const act = document.getElementById('tx-doc-archivo-actual');
    act.innerHTML = doc?.archivo_url ? `Archivo actual: <a href="${esc(doc.archivo_url)}" target="_blank" rel="noopener">verlo</a> · <button type="button" class="tx-link" id="tx-doc-quitar-archivo" style="background:none;border:none;color:var(--danger);cursor:pointer;font-family:inherit;font-size:13px">quitar</button>` : '';
    const q = document.getElementById('tx-doc-quitar-archivo');
    if (q) q.onclick = () => { _docCtx.quitarArchivo = true; act.textContent = 'El archivo se quitará al guardar.'; };
    document.getElementById('tx-doc-guardar').onclick = guardarDoc;
    abrir('tx-modal-doc');
  };

  async function guardarDoc() {
    const c = _docCtx; if (!c) return;
    const err = document.getElementById('tx-doc-error'); err.textContent = '';
    let tipo = document.getElementById('tx-doc-tipo').value;
    if (tipo === 'otro') {
      tipo = document.getElementById('tx-doc-otro').value.trim();
      if (!tipo) { err.textContent = 'Escribe cómo se llama el documento.'; return; }
    }
    const emision = document.getElementById('tx-doc-emision').value || null;
    const venc = document.getElementById('tx-doc-venc').value || null;
    if (emision && venc && venc < emision) { err.textContent = 'El vencimiento no puede ser antes de la emisión.'; return; }
    const file = document.getElementById('tx-doc-archivo').files?.[0] || null;
    if (file && file.size > 6 * 1024 * 1024 && file.type === 'application/pdf') { err.textContent = 'El PDF pesa más de 6 MB.'; return; }
    if (file && !/^image\//.test(file.type) && file.type !== 'application/pdf') { err.textContent = 'Solo se aceptan imágenes o PDF.'; return; }
    const btn = document.getElementById('tx-doc-guardar'); btn.disabled = true;
    try {
      let archivo_url = c.doc?.archivo_url || null, archivo_path = c.doc?.archivo_path || null;
      if (c.quitarArchivo && archivo_url) { await TX.borrarArchivo(archivo_path || archivo_url); archivo_url = null; archivo_path = null; }
      if (file) {
        if (archivo_url) await TX.borrarArchivo(archivo_path || archivo_url);
        const sub = file.type === 'application/pdf' ? await TX.subirArchivo(file, 'documentos', 'pdf', 'application/pdf') : await TX.subirArchivo(await TX.comprimirImagen(file, 1600, 0.85), 'documentos', 'webp', 'image/webp');
        archivo_url = sub.url; archivo_path = sub.path;
      }
      const fila = {
        tipo, numero: document.getElementById('tx-doc-numero').value.trim() || null, emision, vencimiento: venc,
        notas: document.getElementById('tx-doc-notas').value.trim() || null, archivo_url, archivo_path, updated_at: new Date().toISOString(),
      };
      let error;
      if (c.doc) ({ error } = await sb.from('transporte_documentos').update(fila).eq('id', c.doc.id).eq('auth_user_id', TX.userId));
      else ({ error } = await sb.from('transporte_documentos').insert({ ...fila, auth_user_id: TX.userId, entidad_tipo: c.entidadTipo, entidad_id: c.entidadId }));
      if (error) throw error;
      cerrar('tx-modal-doc');
      toast('Documento guardado');
      if (c.alGuardar) await c.alGuardar();
    } catch (e) {
      console.error('guardarDoc:', e);
      err.textContent = 'No se pudo guardar: ' + (e.message || 'intenta de nuevo');
    } finally { btn.disabled = false; }
  }

  TX.quitarDoc = async function (doc, alQuitar) {
    const ok = await confirmar('¿Quitar este documento?', 'Se eliminará el documento y su archivo adjunto.', 'Sí, quitar', true);
    if (!ok) return;
    try {
      const { error } = await sb.from('transporte_documentos').delete().eq('id', doc.id).eq('auth_user_id', TX.userId);
      if (error) throw error;
      if (doc.archivo_url) await TX.borrarArchivo(doc.archivo_path || doc.archivo_url);
      toast('Documento quitado');
      if (alQuitar) await alQuitar();
    } catch (e) { console.error('quitarDoc:', e); toast('No se pudo quitar el documento.', 'error'); }
  };

  /** Documentos que vencen en los próximos DIAS_AVISO días o ya vencidos (ambas entidades). */
  TX.docsEnAlerta = async function () {
    const limite = ymd(new Date(Date.now() + DIAS_AVISO * 86400000));
    return paginar(() => sb.from('transporte_documentos').select('*').eq('auth_user_id', TX.userId)
      .not('vencimiento', 'is', null).lte('vencimiento', limite).order('vencimiento'));
  };

  /* ============================================================
     CICLO DE ESTADOS CON HISTORIAL
     ============================================================ */
  TX.cambiarEstado = async function (entidadTipo, entidad, nuevo, nota) {
    const tabla = entidadTipo === 'unidad' ? 'transporte_unidades' : 'transporte_conductores';
    if (entidad.estado === nuevo) return false;
    const { error } = await sb.from(tabla).update({ estado: nuevo, updated_at: new Date().toISOString() }).eq('id', entidad.id).eq('auth_user_id', TX.userId);
    if (error) throw error;
    try {
      await sb.from('transporte_estados_historial').insert({
        auth_user_id: TX.userId, entidad_tipo: entidadTipo, entidad_id: entidad.id,
        estado_anterior: entidad.estado, estado_nuevo: nuevo, nota: nota || null, creado_por_nombre: nombrePerfilActivo(),
      });
    } catch (e) { console.warn('historial:', e); }
    entidad.estado = nuevo;
    return true;
  };
  TX.cargarHistorial = async function (entidadTipo, entidadId) {
    const { data } = await sb.from('transporte_estados_historial').select('*').eq('auth_user_id', TX.userId)
      .eq('entidad_tipo', entidadTipo).eq('entidad_id', entidadId).order('created_at', { ascending: false }).limit(15);
    return data || [];
  };
  TX.htmlHistorial = function (hist, catalogo) {
    if (!hist.length) return '<div style="font-size:13px;color:var(--text-muted)">Aún no hay cambios de estado registrados.</div>';
    return hist.map(h => {
      const n = catalogo[h.estado_nuevo]?.t || h.estado_nuevo, a = h.estado_anterior ? (catalogo[h.estado_anterior]?.t || h.estado_anterior) : null;
      const f = new Date(h.created_at);
      return `<div class="tx-linea"><b>${esc(a ? a + ' → ' : '')}${esc(n)}</b>${h.nota ? ' · ' + esc(h.nota) : ''}
        <small>${esc(f.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }))} ${esc(f.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }))}${h.creado_por_nombre ? ' · ' + esc(h.creado_por_nombre) : ''}</small></div>`;
    }).join('');
  };
  TX.htmlCiclo = (catalogo, actual) => `<div class="tx-ciclo">${Object.entries(catalogo).map(([k, v]) =>
    `<button type="button" class="tx-btn tx-btn-sm ${k === actual ? 'on' : ''}" data-tx-estado="${k}" title="${esc(v.ayuda)}">${v.ico} ${esc(v.t)}</button>`).join('')}</div>`;

  window.TX = TX;
})();
