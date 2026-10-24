/* =====================================================
   CLÍNICA -- sesión clínica (candado del expediente)
   -----------------------------------------------------
   El contenido clínico SOLO se entrega desde el servidor a
   quien tenga una sesión clínica válida: el médico (o el
   administrador clínico) elige su nombre y escribe su PIN,
   el servidor lo verifica (con bloqueo tras intentos
   fallidos) y devuelve un token temporal. Aquí solo se
   guarda ese token, en sessionStorage (se borra al cerrar
   la pestaña). Se bloquea solo tras 15 min sin actividad;
   el servidor además la vence a los 30 min sin uso.
   Requiere de la página: sb, esc, openModal, closeModal,
   showToast, y clinica-comun.js.
===================================================== */
const ClinicaSesion = (() => {
  const CLAVE = 'n360_clinica_sesion';
  const INACTIVIDAD_MS = 15 * 60 * 1000;
  let uid = null, alCambiar = null, ultimaActividad = Date.now(), pendiente = null;

  function leer() {
    try { const s = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); return s && s.uid === uid && /^[0-9a-f]{64}$/.test(s.token || '') ? s : null; }
    catch (_) { return null; }
  }
  function guardar(r) { sessionStorage.setItem(CLAVE, JSON.stringify({ uid, token: r.token, personal_id: r.personal_id, nombre: r.nombre, rol: r.rol })); avisar(); }
  function limpiar() { sessionStorage.removeItem(CLAVE); avisar(); }
  function avisar() { try { pintarChips(); alCambiar && alCambiar(leer()); } catch (e) { console.warn('ClinicaSesion:', e); } }

  function iniciar(userId, { onCambio } = {}) {
    uid = userId; alCambiar = onCambio || null;
    ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true }));
    setInterval(() => { if (leer() && Date.now() - ultimaActividad > INACTIVIDAD_MS) { bloquear(); showToast('Sesión médica bloqueada por inactividad.', 'error'); } }, 30000);
    asegurarModal();
  }
  // Confirma con el servidor que la sesión guardada sigue viva (si no, se olvida).
  async function comprobar() {
    const s = leer(); if (!s) { pintarChips(); return null; }
    try {
      const { data, error } = await sb.rpc('clinica_sesion_estado', { p_token: s.token });
      if (error || !data || !data.ok) { limpiar(); return null; }
    } catch (_) { return s; }
    pintarChips(); return s;
  }
  async function bloquear() {
    const s = leer(); limpiar();
    if (s) { try { await sb.rpc('clinica_cerrar_sesion', { p_token: s.token }); } catch (_) {} }
  }

  /* ---------- Ventana para escribir el PIN ---------- */
  function asegurarModal() {
    if (document.getElementById('modal-clinica-pin')) return;
    const div = document.createElement('div');
    div.innerHTML = `
<div class="modal-overlay" id="modal-clinica-pin" style="z-index:10050">
  <div class="modal-box" style="max-width:400px;width:100%" role="dialog" aria-labelledby="cp-titulo">
    <div class="modal-header"><span class="modal-title" id="cp-titulo">🔒 Acceso médico</span>
      <button class="modal-close" id="cp-x" aria-label="Cerrar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <p class="cl-sub" id="cp-ayuda" style="margin:0 0 12px">El expediente es confidencial. Elige tu nombre y escribe tu PIN personal.</p>
      <div id="cp-form">
        <div class="cl-field"><label for="cp-persona">¿Quién eres?</label><select id="cp-persona" class="cl-in"></select></div>
        <div class="cl-field"><label for="cp-pin">Tu PIN</label>
          <input type="password" id="cp-pin" class="cl-in cl-pin-in" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="••••" data-lpignore="true" data-1p-ignore="true"/></div>
      </div>
      <div id="cp-vacio" class="cl-info" style="display:none">Todavía no hay médicos con PIN. El administrador los agrega en <a href="clinica-equipo.html" style="color:var(--accent)">Clínica · Equipo y seguridad</a>.</div>
      <p id="cp-error" style="color:var(--danger,#dc2626);font-size:12.5px;margin:6px 0 0" role="alert"></p>
    </div>
    <div class="modal-footer"><button class="btn-accion-tabla btn-ghost" id="cp-cancelar">Cancelar</button><button class="btn-accion-tabla btn-primary" id="cp-ok">Entrar</button></div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
    const fin = v => { closeModal('modal-clinica-pin'); const p = pendiente; pendiente = null; if (p) p(v); };
    document.getElementById('cp-x').onclick = () => fin(null);
    document.getElementById('cp-cancelar').onclick = () => fin(null);
    document.getElementById('cp-pin').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('cp-ok').click(); });
    document.getElementById('cp-ok').onclick = async () => {
      const err = document.getElementById('cp-error'), btn = document.getElementById('cp-ok');
      const pid = document.getElementById('cp-persona').value, pin = document.getElementById('cp-pin').value.trim();
      err.textContent = '';
      if (!pid) { err.textContent = 'Elige tu nombre.'; return; }
      if (!/^[0-9]{4,8}$/.test(pin)) { err.textContent = 'El PIN tiene de 4 a 8 números.'; return; }
      btn.disabled = true;
      try {
        const { data, error } = await sb.rpc('clinica_iniciar_sesion', { p_personal_id: pid, p_pin: pin });
        if (error) throw error;
        if (!data || !data.ok) { err.textContent = clinicaTextoMotivo(data); document.getElementById('cp-pin').value = ''; document.getElementById('cp-pin').focus(); return; }
        guardar(data); ultimaActividad = Date.now();
        fin(leer());
      } catch (e) { console.error('clinica_iniciar_sesion:', e); err.textContent = 'No se pudo verificar. Revisa tu conexión e intenta de nuevo.'; }
      finally { btn.disabled = false; }
    };
  }
  // Muestra la ventana y devuelve la sesión (o null si cancela).
  async function pedir({ ayuda } = {}) {
    asegurarModal();
    if (pendiente) { const p = pendiente; pendiente = null; p(null); }
    const sel = document.getElementById('cp-persona');
    document.getElementById('cp-error').textContent = ''; document.getElementById('cp-pin').value = '';
    document.getElementById('cp-ayuda').textContent = ayuda || 'El expediente es confidencial. Elige tu nombre y escribe tu PIN personal.';
    let lista = [];
    try {
      const { data, error } = await sb.from('clinica_personal').select('id, nombre, rol, pin_configurado')
        .eq('auth_user_id', uid).eq('activo', true).in('rol', ['medico', 'admin']).order('nombre');
      if (error) throw error;
      lista = (data || []).filter(p => p.pin_configurado);
    } catch (e) { console.error('ClinicaSesion.pedir:', e); }
    sel.innerHTML = (lista.length > 1 ? '<option value="">— Elige tu nombre —</option>' : '')
      + lista.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}${p.rol === 'admin' ? ' (administración)' : ''}</option>`).join('');
    document.getElementById('cp-form').style.display = lista.length ? '' : 'none';
    document.getElementById('cp-vacio').style.display = lista.length ? 'none' : '';
    document.getElementById('cp-ok').style.display = lista.length ? '' : 'none';
    openModal('modal-clinica-pin');
    setTimeout(() => { (lista.length > 1 ? sel : document.getElementById('cp-pin')).focus(); }, 50);
    return new Promise(res => { pendiente = res; });
  }

  // Llama una función clínica del servidor con el token. Si la sesión venció, pide el PIN y reintenta una vez.
  async function rpc(fn, args) {
    let s = leer() || await pedir();
    if (!s) { const e = new Error('cancelado'); e.cancelado = true; throw e; }
    let r = await sb.rpc(fn, { p_token: s.token, ...(args || {}) });
    if (r.error && String(r.error.message || '').includes('clinica_sesion_invalida')) {
      limpiar();
      s = await pedir({ ayuda: 'Tu sesión médica venció. Escribe tu PIN de nuevo para continuar.' });
      if (!s) { const e = new Error('cancelado'); e.cancelado = true; throw e; }
      r = await sb.rpc(fn, { p_token: s.token, ...(args || {}) });
    }
    if (r.error) throw r.error;
    return r.data;
  }

  /* ---------- Indicador "sesión médica" (botón para entrar / bloquear) ---------- */
  function pintarChips() {
    const s = leer();
    document.querySelectorAll('[data-clinica-chip]').forEach(el => {
      el.className = 'cl-chip-sesion' + (s ? '' : ' cerrada');
      el.textContent = s ? `🔓 ${s.nombre} · Bloquear` : '🔒 Acceso médico';
      el.title = s ? 'Cerrar tu sesión médica en este dispositivo' : 'Entrar con tu PIN para ver expedientes';
      el.onclick = async () => { if (leer()) { await bloquear(); showToast('Sesión médica cerrada.'); } else { await pedir(); } };
    });
  }

  return { iniciar, leer, comprobar, pedir, rpc, bloquear, pintarChips };
})();
