/* ============================================================
   BIENVENIDA-NEGOCIO360.JS
   Pantalla de bienvenida animada (~3.5s) que se muestra al ABRIR
   SESION, una sola vez -- no al navegar entre modulos.

   Se autoinyecta: basta con incluir este archivo en cualquier
   pagina. Todo (estilos, HTML y control) vive aqui, asi no hay
   que duplicar nada en cada modulo.

   REGLAS DE APARICION:
   - Solo en dashboard.html (es la pantalla de entrada al sistema).
     Si se abre Ventas o cualquier otro modulo directo, no aparece.
   - Una sola vez por sesion del navegador, POR USUARIO: si alguien
     cierra sesion y entra con otra cuenta, la vuelve a ver.
   - Nunca bloquea: si algo fallara, se oculta y el sistema sigue.
   - z-index 100000: queda por ENCIMA del tutorial y del selector
     de perfiles/multiusuario (ambos usan 99999).
   ============================================================ */
(function () {
  try {
    // 1. Solo en las pantallas de ENTRADA al sistema -- no al navegar
    //    entre modulos. Cada tipo de cuenta tiene la suya: dashboard
    //    (cliente normal), bodega (cuenta de bodega), catalogo360
    //    (cliente independiente) y admin (panel de administracion).
    var archivo = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
    var esEntrada = ['dashboard.html', 'bodega.html', 'catalogo360.html', 'admin.html']
      .some(function (p) { return archivo.indexOf(p.replace('.html', '')) === 0; });
    if (!esEntrada) return;

    // 2. Ya se vio en esta sesion: no se repite al navegar.
    //    La clave incluye el usuario, para que al cambiar de cuenta
    //    (cerrar sesion y entrar con otra) si se vuelva a mostrar.
    var clave = 'n360_welcome_visto';
    try {
      // Se busca la clave de sesion de Supabase sin asumir su nombre
      // exacto (cambia segun version/proyecto) -- asi si cambiara,
      // esto sigue funcionando en vez de romperse en silencio.
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('-auth-token') !== -1) {
          var tok = JSON.parse(localStorage.getItem(k));
          var uid = tok && tok.user && tok.user.id;
          if (uid) { clave = 'n360_welcome_visto_' + uid; break; }
        }
      }
    } catch (_) { /* si no se puede leer, se usa la clave generica */ }

    try {
      if (sessionStorage.getItem(clave) === '1') return;
      sessionStorage.setItem(clave, '1');
    } catch (_) { /* si sessionStorage falla, simplemente se muestra */ }

    // 3. Inyectar estilos
    var style = document.createElement('style');
    style.id = 'n360-welcome-style';
    style.textContent = `/* ============================================================
   PANTALLA DE BIENVENIDA (~3.5s) -- capa independiente, encima
   del cargador normal. Si algo fallara aqui, el sistema carga
   igual: esta pantalla nunca bloquea nada.
   ============================================================ */
#n360-welcome {
  position: fixed; inset: 0; z-index: 100000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background:
    radial-gradient(ellipse 70% 55% at 50% 42%, rgba(37,99,235,.22) 0%, transparent 70%),
    radial-gradient(ellipse at 50% 38%, #161a33 0%, #0b0d18 58%, #05060c 100%);
  overflow: hidden;
  animation: nw-out .75s cubic-bezier(.7,0,.3,1) 2.82s forwards;
}
#n360-welcome.nw-done { display: none; }

/* Particulas finas flotando */
.nw-particles { position: absolute; inset: 0; pointer-events: none; opacity: .45; }
.nw-particles::before, .nw-particles::after {
  content: ''; position: absolute; inset: -40%;
  background-image:
    radial-gradient(circle, rgba(96,150,255,.55) 1px, transparent 1.6px),
    radial-gradient(circle, rgba(255,255,255,.3) 1px, transparent 1.6px);
  background-size: 96px 96px, 150px 150px;
  background-position: 0 0, 48px 48px;
  animation: nw-drift 26s linear infinite;
}
.nw-particles::after { animation-duration: 38s; animation-direction: reverse; opacity: .5; }

/* Haz de luz sutil que barre la pantalla una vez */
.nw-rays {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 38%, rgba(120,170,255,.09) 50%, transparent 62%);
  transform: translateX(-60%);
  animation: nw-sweep 2.6s cubic-bezier(.3,0,.2,1) .55s forwards;
}

.nw-inner { position: relative; text-align: center; padding: 0 24px; }

/* --- Logo real con aros concentricos --- */
.nw-logo-stage {
  position: relative; width: 108px; height: 108px; margin: 0 auto 26px;
  display: flex; align-items: center; justify-content: center;
}
.nw-logo-img {
  width: 92px; height: 92px; object-fit: contain; position: relative; z-index: 2;
  opacity: 0; transform: scale(.72) rotate(-14deg);
  filter: drop-shadow(0 10px 28px rgba(37,99,235,.5));
  animation: nw-logo-in 1s cubic-bezier(.18,.9,.28,1.25) .12s forwards,
             nw-logo-float 3.4s ease-in-out 1.1s infinite;
}
.nw-ring {
  position: absolute; inset: 0; border-radius: 50%;
  border: 1px solid rgba(120,170,255,.4);
  opacity: 0;
}
.nw-ring-1 { animation: nw-ring-out 1.7s cubic-bezier(.2,.7,.3,1) .5s forwards; }
.nw-ring-2 { animation: nw-ring-out 1.7s cubic-bezier(.2,.7,.3,1) .85s forwards; }

/* Destello que cruza el logo */
.nw-sheen {
  position: absolute; inset: -10%; z-index: 3; pointer-events: none;
  background: linear-gradient(115deg, transparent 42%, rgba(255,255,255,.55) 50%, transparent 58%);
  transform: translateX(-130%);
  animation: nw-sheen-go 1.1s cubic-bezier(.3,0,.2,1) 1.15s forwards;
}

/* --- Marca, letra por letra --- */
.nw-brand {
  margin: 0; font-size: 42px; font-weight: 800; letter-spacing: -1.2px;
  color: #fff; line-height: 1.1; display: flex; justify-content: center;
}
.nw-brand .nw-l {
  display: inline-block; opacity: 0; transform: translateY(18px) rotateX(-55deg);
  animation: nw-letter .52s cubic-bezier(.2,.85,.3,1.1) forwards;
}
.nw-brand .nw-l:nth-child(1) { animation-delay: .72s }
.nw-brand .nw-l:nth-child(2) { animation-delay: .77s }
.nw-brand .nw-l:nth-child(3) { animation-delay: .82s }
.nw-brand .nw-l:nth-child(4) { animation-delay: .87s }
.nw-brand .nw-l:nth-child(5) { animation-delay: .92s }
.nw-brand .nw-l:nth-child(6) { animation-delay: .97s }
.nw-brand .nw-l:nth-child(7) { animation-delay: 1.02s }
.nw-brand .nw-l:nth-child(8) { animation-delay: 1.09s }
.nw-brand .nw-l:nth-child(9) { animation-delay: 1.14s }
.nw-brand .nw-l:nth-child(10){ animation-delay: 1.19s }
.nw-brand .nw-accent {
  background: linear-gradient(180deg, #6ba3ff, #2563eb);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Linea fina que se abre bajo la marca */
.nw-rule {
  width: 0; height: 1px; margin: 16px auto 0;
  background: linear-gradient(90deg, transparent, rgba(120,170,255,.85), transparent);
  animation: nw-rule-open .8s cubic-bezier(.3,0,.2,1) 1.3s forwards;
}

.nw-welcome {
  margin: 13px 0 0; font-size: 15px; font-weight: 500;
  color: rgba(255,255,255,.62); letter-spacing: 2.6px; text-transform: uppercase;
  opacity: 0; transform: translateY(8px);
  animation: nw-rise .6s ease-out 1.42s forwards;
}

.nw-phrases { position: relative; height: 32px; margin-top: 14px; }
.nw-phrase {
  position: absolute; left: 0; right: 0;
  font-size: 18px; font-weight: 700; letter-spacing: -.2px;
  background: linear-gradient(92deg, #fff, #9dc0ff);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  opacity: 0; transform: translateY(15px);
}
.nw-p1 { animation: nw-phrase .9s ease-out 1.72s forwards; }
.nw-p2 { animation: nw-phrase .9s ease-out 2.16s forwards; }
.nw-p3 { animation: nw-phrase-last .95s ease-out 2.6s forwards; }

.nw-bar {
  position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
  background: rgba(255,255,255,.07);
}
.nw-bar-fill {
  height: 100%; width: 0;
  background: linear-gradient(90deg, #2563eb, #6ba3ff);
  box-shadow: 0 0 12px rgba(59,130,246,.75);
  animation: nw-progress 3.5s cubic-bezier(.35,0,.2,1) forwards;
}

.nw-skip {
  position: absolute; top: 22px; right: 22px;
  padding: 7px 15px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.05); color: rgba(255,255,255,.7);
  font-size: 12px; font-weight: 600; cursor: pointer;
  backdrop-filter: blur(6px);
  opacity: 0; animation: nw-rise .5s ease-out 1.1s forwards;
  transition: background .2s, color .2s, border-color .2s;
}
.nw-skip:hover { background: rgba(255,255,255,.13); color: #fff; border-color: rgba(255,255,255,.32); }

@keyframes nw-logo-in    { to { opacity: 1; transform: scale(1) rotate(0deg); } }
@keyframes nw-logo-float { 0%,100% { translate: 0 0 } 50% { translate: 0 -7px } }
@keyframes nw-ring-out   { 0% { opacity: .9; transform: scale(.72) } 100% { opacity: 0; transform: scale(1.85) } }
@keyframes nw-sheen-go   { to { transform: translateX(130%); } }
@keyframes nw-sweep      { to { transform: translateX(60%); } }
@keyframes nw-letter     { to { opacity: 1; transform: translateY(0) rotateX(0); } }
@keyframes nw-rule-open  { to { width: 190px; } }
@keyframes nw-rise       { to { opacity: 1; transform: translateY(0); } }
@keyframes nw-drift      { to { transform: translate(96px, 150px); } }
@keyframes nw-phrase {
  0%   { opacity: 0; transform: translateY(15px); }
  22%  { opacity: 1; transform: translateY(0); }
  78%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-13px); }
}
@keyframes nw-phrase-last {
  0%  { opacity: 0; transform: translateY(15px); }
  26% { opacity: 1; transform: translateY(0); }
  100%{ opacity: 1; transform: translateY(0); }
}
@keyframes nw-progress { to { width: 100%; } }
@keyframes nw-out      { to { opacity: 0; transform: translateY(-30px) scale(1.03); } }

@media (max-width: 480px) {
  .nw-logo-stage { width: 88px; height: 88px; margin-bottom: 20px; }
  .nw-logo-img   { width: 74px; height: 74px; }
  .nw-brand      { font-size: 32px; }
  .nw-welcome    { font-size: 13px; letter-spacing: 2.2px; }
  .nw-phrase     { font-size: 16px; }
  .nw-skip       { top: 15px; right: 15px; }
}

/* Respeta a quien pidio menos animacion en su dispositivo: se ve
   la pantalla, pero estatica y mucho mas breve. */
@media (prefers-reduced-motion: reduce) {
  #n360-welcome, #n360-welcome * { animation-duration: .01ms !important; animation-delay: 0ms !important; }
  .nw-brand .nw-l, .nw-welcome, .nw-phrase, .nw-logo-img, .nw-skip { opacity: 1 !important; transform: none !important; }
  .nw-rule { width: 190px !important; }
  .nw-p1, .nw-p2, .nw-sheen, .nw-rays, .nw-ring { display: none; }
}

`;
    document.head.appendChild(style);

    // 4. Inyectar la pantalla
    var cont = document.createElement('div');
    cont.innerHTML = `<div id="n360-welcome" aria-hidden="true">
  <div class="nw-particles"></div>
  <div class="nw-rays"></div>
  <div class="nw-inner">
    <div class="nw-logo-stage">
      <span class="nw-ring nw-ring-1"></span>
      <span class="nw-ring nw-ring-2"></span>
      <img src="negocio360-isotipo.png" alt="Negocio360" class="nw-logo-img" />
      <span class="nw-sheen"></span>
    </div>
    <h1 class="nw-brand">
      <span class="nw-l">N</span><span class="nw-l">e</span><span class="nw-l">g</span><span class="nw-l">o</span><span class="nw-l">c</span><span class="nw-l">i</span><span class="nw-l">o</span><span class="nw-l nw-accent">3</span><span class="nw-l nw-accent">6</span><span class="nw-l nw-accent">0</span>
    </h1>
    <div class="nw-rule"></div>
    <p class="nw-welcome">Bienvenido</p>
    <div class="nw-phrases">
      <span class="nw-phrase nw-p1">Controla tu negocio</span>
      <span class="nw-phrase nw-p2">Vende más</span>
      <span class="nw-phrase nw-p3">Gana más</span>
    </div>
  </div>
  <div class="nw-bar"><div class="nw-bar-fill"></div></div>
  <button type="button" class="nw-skip" id="nwSkip">Saltar</button>
</div>`;
    var el = cont.firstElementChild;
    document.body.appendChild(el);

    // 5. Control de cierre
    var cerrada = false;
    function cerrar() {
      if (cerrada) return;
      cerrada = true;
      el.classList.add('nw-done');
    }
    var btn = document.getElementById('nwSkip');
    if (btn) btn.addEventListener('click', cerrar);

    setTimeout(cerrar, 3500);
    // Respaldo: si por cualquier motivo lo anterior no corriera,
    // igual se quita. Nunca debe quedarse pegada en pantalla.
    setTimeout(cerrar, 6000);
  } catch (e) {
    var w = document.getElementById('n360-welcome');
    if (w) w.style.display = 'none';
  }
})();
