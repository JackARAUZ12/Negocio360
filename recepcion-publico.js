/* =====================================================
   RECEPCION-PUBLICO.JS — piezas compartidas de las pantallas públicas
   de Recepción (TV, kiosko "Tome su turno" y "Mi turno").
   Estas páginas NO inician sesión: un equipo se vincula una vez con un
   código de 6 dígitos que confirma el administrador; el servidor solo
   guarda el hash del secreto del equipo. Solo leen datos mínimos
   (número, servicio, puesto) por funciones del servidor.
===================================================== */
(function () {
  'use strict';
  const URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const KEY_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  const sb = window.supabase.createClient(URL_SB, KEY_SB, { auth: { persistSession: false, autoRefreshToken: false } });

  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (_) {} };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const espera = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- marca del negocio ---------- */
  function hexValido(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1d4ed8'; }
  function oscurecer(hex, f) {
    const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function claroSuficiente(hex) {
    const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
  }
  function aplicarMarca(m) {
    if (!m) return;
    let c = hexValido(m.color);
    if (claroSuficiente(c)) c = '#1d4ed8';            // un color muy claro no se lee en blanco: se usa el azul
    document.documentElement.style.setProperty('--c', c);
    document.documentElement.style.setProperty('--c2', oscurecer(c, 0.72));
    document.querySelectorAll('[data-marca-nombre]').forEach(el => el.textContent = m.nombre || '');
    document.querySelectorAll('[data-marca-logo]').forEach(el => {
      if (m.logo) { el.src = m.logo; el.style.display = ''; el.onerror = () => { el.style.display = 'none'; }; }
      else el.style.display = 'none';
    });
    if (m.nombre) document.title = (document.title.split(' · ')[0]) + ' · ' + m.nombre;
  }

  /* ---------- reloj ---------- */
  function reloj(elHora, elFecha) {
    const pintar = () => {
      const d = new Date();
      if (elHora) elHora.textContent = d.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
      if (elFecha) elFecha.textContent = d.toLocaleDateString('es-NI', { weekday: 'long', day: 'numeric', month: 'long' });
    };
    pintar(); setInterval(pintar, 10000);
  }

  /* ---------- sonido y voz ---------- */
  let ctx = null;
  function audio() {
    try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { ctx = null; }
    return ctx;
  }
  // Chrome solo deja hablar después de que alguien toca la pantalla: este toque "abre" la voz.
  // (Antes se probaba con un texto vacío, que en algunos equipos trababa la cola de voz.)
  let vozActivada = false;
  async function desbloquearAudio(decir) {
    const a = audio(); try { if (a && a.state !== 'running') await a.resume(); } catch (_) {}
    try {
      if (window.speechSynthesis && !vozActivada) {
        vozActivada = true;
        speechSynthesis.cancel();
        if (decir) hablar(decir);
      }
    } catch (_) {}
    return !!(a && a.state === 'running');
  }
  function vozLista() { return vozActivada || !window.speechSynthesis; }
  function audioListo() { const a = audio(); return !!(a && a.state === 'running'); }
  function tono(frec, ini, dur, vol) {
    const a = audio(); if (!a || a.state !== 'running') return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = frec;
    g.gain.setValueAtTime(0.0001, a.currentTime + ini);
    g.gain.exponentialRampToValueAtTime(vol || 0.35, a.currentTime + ini + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ini + dur);
    o.connect(g); g.connect(a.destination); o.start(a.currentTime + ini); o.stop(a.currentTime + ini + dur + 0.05);
  }
  function dinDon() { tono(880, 0, 0.9, 0.32); tono(659.25, 0.45, 1.3, 0.32); return espera(1500); }
  function beep() { tono(1046.5, 0, 0.25, 0.4); tono(1318.5, 0.28, 0.35, 0.4); }

  let vozES = null;
  function elegirVoz() {
    try {
      const vs = speechSynthesis.getVoices() || [];
      vozES = vs.find(v => /es[-_](MX|US|419|NI|CR|CO)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
    } catch (_) { vozES = null; }
  }
  try { if (window.speechSynthesis) { elegirVoz(); speechSynthesis.onvoiceschanged = elegirVoz; } } catch (_) {}
  // "A-015" -> "A, quince"
  function codigoHablado(cod) {
    const m = String(cod || '').match(/^([A-Z]{1,2})-0*(\d+)$/);
    return m ? `${m[1].split('').join(' ')}, ${parseInt(m[2], 10)}` : String(cod || '');
  }
  const vivos = [];   // Chrome borra el anuncio de memoria a medias si no se guarda una referencia
  function hablar(texto) {
    return new Promise(res => {
      try {
        if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return res();
        if (!vozES) elegirVoz();
        try { if (speechSynthesis.paused) speechSynthesis.resume(); if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); } catch (_) {}
        const u = new SpeechSynthesisUtterance(texto);
        vivos.push(u); if (vivos.length > 5) vivos.shift();
        if (vozES) { u.voice = vozES; u.lang = vozES.lang; } else u.lang = 'es-MX';
        u.rate = 0.92; u.pitch = 1; u.volume = 1;
        let listo = false; const fin = () => { if (!listo) { listo = true; res(); } };
        u.onend = fin; u.onerror = fin; setTimeout(fin, 9000);
        speechSynthesis.speak(u);
      } catch (_) { res(); }
    });
  }

  /* ---------- pantalla completa y que no se apague ---------- */
  async function pantallaCompleta() { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch (_) {} }
  let wl = null;
  async function noApagar() {
    try { if ('wakeLock' in navigator) { wl = await navigator.wakeLock.request('screen'); } } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && wl === null) noApagar(); else if (!document.hidden) noApagar(); });

  /* ---------- vincular equipo (código de 6 dígitos) ---------- */
  // Muestra el código en `cont` hasta que el administrador lo confirme. Devuelve el secreto.
  async function vincularEquipo(tipo, claveLS, cont) {
    for (;;) {
      let par;
      try {
        const { data, error } = await sb.rpc('recepcion_par_crear', { p_tipo: tipo });
        if (error || !data?.ok) throw error || new Error('par');
        par = data;
      } catch (_) {
        cont.innerHTML = `<div class="rp-par"><div class="rp-par-t">Sin conexión</div><p>Revisando la conexión a internet…</p></div>`;
        await espera(8000); continue;
      }
      const vence = Date.now() + par.expira_seg * 1000;
      const digitos = par.codigo.split('').map(d => `<span>${d}</span>`).join('');
      cont.innerHTML = `
        <div class="rp-par">
          <div class="rp-par-ico">${tipo === 'pantalla' ? '📺' : '🎟️'}</div>
          <div class="rp-par-t">${tipo === 'pantalla' ? 'Vincular pantalla de turnos' : 'Vincular kiosko de turnos'}</div>
          <p>En <b>Negocio360 → Recepción → Pantalla y kiosko</b>, escribe este código:</p>
          <div class="rp-par-cod">${digitos}</div>
          <p class="rp-par-sub">El código cambia en <b id="rp-par-seg">15:00</b>. Solo el administrador del negocio puede vincular este equipo.</p>
        </div>`;
      const seg = cont.querySelector('#rp-par-seg');
      for (;;) {
        await espera(3000);
        const resta = Math.max(0, Math.round((vence - Date.now()) / 1000));
        if (seg) seg.textContent = `${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, '0')}`;
        if (resta <= 0) break;
        try {
          const { data } = await sb.rpc('recepcion_par_estado', { p_secreto: par.secreto });
          if (data?.vinculado) { lsSet(claveLS, par.secreto); return par.secreto; }
        } catch (_) {}
      }
    }
  }

  function qrSVG(texto, celda) {
    try { if (typeof qrcode === 'undefined') return ''; const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag(celda || 4, 0); } catch (_) { return ''; }
  }
  function baseURL() { return location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, ''); }

  window.RecPub = { sb, lsGet, lsSet, lsDel, esc, espera, aplicarMarca, reloj, audio, desbloquearAudio, audioListo, vozLista, dinDon, beep,
                    hablar, codigoHablado, pantallaCompleta, noApagar, vincularEquipo, qrSVG, baseURL };
})();
