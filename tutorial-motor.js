/* ============================================================
   TUTORIAL-MOTOR.JS — NEGOCIO360
   ------------------------------------------------------------
   Motor de tutoriales reutilizable para CUALQUIER modulo del
   sistema. Se incluye con una sola linea en cada pagina:

     <script src="tutorial-motor.js"></script>

   Y se usa asi, en cualquier punto despues de saber quien es el
   usuario (normalmente dentro del init() de cada modulo):

     Negocio360Tutorial.verificarYMostrar('ventas', [
       { icono: '💰', titulo: 'Bienvenido a Ventas',
         texto: 'Aqui registras cada venta...' },
       { icono: '🛒', titulo: 'Arma el carrito',
         texto: 'Busca el producto y da clic...' },
       ...
     ]);

   'ventas' es la modulo_key -- debe coincidir con la key que ya
   usa modulos-registro.js para ese modulo (asi el sistema entero
   habla del mismo modulo con el mismo nombre).

   QUE HACE:
   1) verificarYMostrar(moduloKey, pasos) -- consulta si el
      usuario YA vio el tutorial de ese modulo especifico
      (tabla tutoriales_vistos). Si nunca lo vio, lo muestra
      automaticamente. Si ya lo vio, no hace nada.
   2) mostrar(moduloKey, pasos) -- lo muestra SIEMPRE, sin
      consultar nada (para el boton de "Ver tutorial de nuevo"
      que cada pagina puede agregar en su propio encabezado).
   3) Al cerrarse (saltar o terminar), marca ese modulo como
      visto para siempre en esa cuenta -- nunca vuelve a
      interrumpir solo, pero el boton de "ver de nuevo" sigue
      funcionando cuando el usuario quiera repasarlo.

   DISEÑO: el motor trae su propio sistema visual completo
   (colores, tipografia, animaciones) inyectado en un <style>
   propio -- no depende de las variables CSS de cada modulo (que
   no son consistentes entre paginas), asi se ve exactamente
   igual de profesional en cualquier parte del sistema.

   Responsive: en pantallas angostas la tarjeta ocupa el ancho
   disponible con margenes comodos, la imagen decorativa se
   reduce, y los botones se mantienes con area tactil comoda.

   No depende de ningun modulo propio (ventas.js, productos.js,
   etc.) -- corre con su propia conexion a Supabase, igual que
   modulos-guard.js y perfiles-guard.js. No reemplaza ni modifica
   nada existente.
   ============================================================ */
'use strict';

(function () {
  const TM_SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const TM_SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  const tmSb = window.supabase.createClient(TM_SUPABASE_URL, TM_SUPABASE_KEY);

  // Cuenta de DEMOSTRACION: siempre ve el tutorial, en cada sesion,
  // sin importar cuantas veces ya lo haya cerrado -- util para hacer
  // demos del sistema una y otra vez. Nunca se marca como "visto"
  // para esta cuenta especifica.
  const TM_CUENTA_SIEMPRE_DEMO = '64b4804b-7b2b-44d8-a365-bc04ec5950ec'; // Juan Perez (cuenta de prueba)

  let inyectado = false;
  let pasoActual = 0;
  let pasosActivos = [];
  let moduloActivoKey = null;

  function inyectarEstilos() {
    if (inyectado) return;
    inyectado = true;
    const style = document.createElement('style');
    style.textContent = `
      #tm-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(15,15,20,.55); backdrop-filter: blur(3px);
        display: none; align-items: center; justify-content: center;
        padding: 20px; font-family: 'DM Sans', 'Segoe UI', system-ui, sans-serif;
        animation: tm-fade-in .2s ease;
      }
      #tm-overlay.tm-open { display: flex; }
      @keyframes tm-fade-in { from { opacity: 0; } to { opacity: 1; } }
      #tm-card {
        background: #ffffff; border-radius: 18px; width: 100%; max-width: 420px;
        box-shadow: 0 20px 60px rgba(0,0,0,.3); overflow: hidden;
        animation: tm-pop .25s cubic-bezier(.34,1.56,.64,1);
        max-height: 88vh; display: flex; flex-direction: column;
      }
      @keyframes tm-pop { from { opacity:0; transform: scale(.94) translateY(8px); } to { opacity:1; transform: scale(1) translateY(0); } }
      #tm-media {
        height: 140px; flex-shrink: 0;
        background: linear-gradient(135deg, #5a5af4, #8b8bf9);
        display: flex; align-items: center; justify-content: center;
        font-size: 46px;
      }
      #tm-body { padding: 24px 24px 4px; overflow-y: auto; }
      #tm-titulo { margin: 0 0 8px; font-size: 19px; font-weight: 700; color: #111014; }
      #tm-texto { margin: 0; font-size: 13.5px; line-height: 1.6; color: #5c5c6b; }
      #tm-footer { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px 22px; gap: 10px; flex-shrink: 0; }
      #tm-puntos { display: flex; gap: 6px; flex-wrap: wrap; }
      .tm-punto { width: 6px; height: 6px; border-radius: 99px; background: #e4e2db; transition: all .2s ease; }
      .tm-punto.tm-activo { width: 18px; background: #5a5af4; }
      .tm-btn { border: none; border-radius: 9px; font-weight: 700; font-size: 13px; cursor: pointer; padding: 10px 16px; font-family: inherit; transition: transform .15s ease, opacity .15s ease; }
      .tm-btn:active { transform: scale(.96); }
      .tm-btn-saltar { background: #f2f1ed; color: #5c5c6b; }
      .tm-btn-saltar:hover { background: #e9e7e1; }
      .tm-btn-siguiente { background: #5a5af4; color: #fff; }
      .tm-btn-siguiente:hover { background: #4747d1; }
      #tm-ayuda-flotante {
        position: fixed; bottom: 20px; right: 20px; z-index: 9998;
        width: 46px; height: 46px; border-radius: 50%; background: #5a5af4; color: #fff;
        border: none; cursor: pointer; box-shadow: 0 8px 20px rgba(90,90,244,.4);
        display: none; align-items: center; justify-content: center; font-size: 20px;
        font-family: inherit; transition: transform .15s ease;
      }
      #tm-ayuda-flotante:hover { transform: scale(1.06); }
      @media (max-width: 480px) {
        #tm-card { max-width: 100%; border-radius: 16px 16px 0 0; align-self: flex-end; }
        #tm-overlay { align-items: flex-end; padding: 0; }
        #tm-media { height: 110px; font-size: 38px; }
        #tm-body { padding: 20px 20px 4px; }
        #tm-footer { padding: 14px 20px 20px; }
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'tm-overlay';
    overlay.innerHTML = `
      <div id="tm-card">
        <div id="tm-media">💡</div>
        <div id="tm-body">
          <h2 id="tm-titulo"></h2>
          <p id="tm-texto"></p>
        </div>
        <div id="tm-footer">
          <div id="tm-puntos"></div>
          <div style="display:flex;gap:8px">
            <button class="tm-btn tm-btn-saltar" id="tm-btn-saltar">Saltar</button>
            <button class="tm-btn tm-btn-siguiente" id="tm-btn-siguiente">Siguiente</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    document.getElementById('tm-btn-saltar').addEventListener('click', cerrar);
    document.getElementById('tm-btn-siguiente').addEventListener('click', avanzar);
  }

  function renderPaso() {
    const p = pasosActivos[pasoActual];
    document.getElementById('tm-media').textContent = p.icono || '💡';
    document.getElementById('tm-titulo').textContent = p.titulo || '';
    document.getElementById('tm-texto').textContent = p.texto || '';
    document.getElementById('tm-puntos').innerHTML = pasosActivos.map((_, i) =>
      `<span class="tm-punto ${i === pasoActual ? 'tm-activo' : ''}"></span>`
    ).join('');
    document.getElementById('tm-btn-siguiente').textContent =
      pasoActual === pasosActivos.length - 1 ? 'Entendido' : 'Siguiente';
  }

  function avanzar() {
    if (pasoActual >= pasosActivos.length - 1) { cerrar(); return; }
    pasoActual++;
    renderPaso();
  }

  async function cerrar() {
    document.getElementById('tm-overlay').classList.remove('tm-open');
    if (moduloActivoKey) await marcarVisto(moduloActivoKey);
  }

  async function marcarVisto(moduloKey) {
    try {
      const { data: { user } } = await tmSb.auth.getUser();
      if (!user) return;
      if (user.id === TM_CUENTA_SIEMPRE_DEMO) return; // nunca se marca como visto para la cuenta de demo
      await tmSb.from('tutoriales_vistos')
        .upsert({ auth_user_id: user.id, modulo_key: moduloKey, visto_en: new Date().toISOString() },
                { onConflict: 'auth_user_id,modulo_key' });
    } catch (e) { console.warn('tutorial-motor: no se pudo guardar', e); }
  }

  async function yaVisto(moduloKey) {
    try {
      const { data: { user } } = await tmSb.auth.getUser();
      if (!user) return true; // sin sesion, no interrumpir con un tutorial
      if (user.id === TM_CUENTA_SIEMPRE_DEMO) return false; // esta cuenta SIEMPRE lo ve, en cada sesion
      const { data } = await tmSb.from('tutoriales_vistos')
        .select('modulo_key').eq('auth_user_id', user.id).eq('modulo_key', moduloKey).maybeSingle();
      return !!data;
    } catch (e) { return true; } // ante cualquier duda, no interrumpir
  }

  function mostrar(moduloKey, pasos) {
    if (!pasos || !pasos.length) return;
    inyectarEstilos();
    moduloActivoKey = moduloKey;
    pasosActivos = pasos;
    pasoActual = 0;
    renderPaso();
    document.getElementById('tm-overlay').classList.add('tm-open');
  }

  async function verificarYMostrar(moduloKey, pasos) {
    if (await yaVisto(moduloKey)) return;
    mostrar(moduloKey, pasos);
  }

  /**
   * Agrega el botoncito flotante de ayuda (abajo a la derecha) que
   * reabre el tutorial de este modulo cuando el usuario quiera
   * repasarlo. Opcional -- cada pagina decide si lo quiere o prefiere
   * poner su propio boton en el encabezado llamando a
   * Negocio360Tutorial.mostrar(...) directamente.
   */
  function agregarBotonAyuda(moduloKey, pasos) {
    inyectarEstilos();
    let btn = document.getElementById('tm-ayuda-flotante');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'tm-ayuda-flotante';
      btn.innerHTML = '?';
      btn.title = 'Ver tutorial de este módulo';
      document.body.appendChild(btn);
    }
    btn.style.display = 'flex';
    btn.onclick = () => mostrar(moduloKey, pasos);
  }

  window.Negocio360Tutorial = { mostrar, verificarYMostrar, agregarBotonAyuda };
})();
