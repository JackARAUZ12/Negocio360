/* ============================================================
   BIENVENIDA-CATALOGO360.JS
   Pantalla de bienvenida cinematografica (~4s) exclusiva de
   Catalogo360 -- se muestra al ABRIR SESION, una sola vez, SOLO
   en catalogo360.html. Las otras puertas de entrada (dashboard,
   bodega, admin) siguen usando bienvenida-negocio360.js sin
   ningun cambio -- este archivo es completamente independiente,
   nunca las toca.

   CONCEPTO: el logo de Catalogo360 ya ES un libro/catalogo
   abriendose en capas de color -- la animacion construye esa
   metafora literalmente: cada capa se revela en secuencia, como
   paginas que se abren, en vez de solo aparecer el logo ya armado.

   Mismas reglas de seguridad que el original: nunca bloquea el
   acceso, respeta prefers-reduced-motion, boton de saltar,
   respaldo por si algo fallara.
   ============================================================ */
(function () {
  try {
    // 1. Exclusivo de catalogo360.html -- nunca se dispara en
    //    ninguna otra pagina, ni siquiera por accidente.
    var archivo = (location.pathname.split('/').pop() || '').toLowerCase();
    if (archivo.indexOf('catalogo360') !== 0) return;

    // 2. Ya se vio en esta sesion: no se repite al navegar. La
    //    clave incluye el usuario, para que al cambiar de cuenta
    //    (cerrar sesion y entrar con otra) si se vuelva a mostrar.
    var clave = 'c360_welcome_visto';
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('-auth-token') !== -1) {
          var tok = JSON.parse(localStorage.getItem(k));
          var uid = tok && tok.user && tok.user.id;
          if (uid) { clave = 'c360_welcome_visto_' + uid; break; }
        }
      }
    } catch (_) { /* si no se puede leer, se usa la clave generica */ }

    try {
      if (sessionStorage.getItem(clave) === '1') return;
      sessionStorage.setItem(clave, '1');
    } catch (_) { /* si sessionStorage falla, simplemente se muestra */ }

    // 3. Inyectar estilos
    var style = document.createElement('style');
    style.id = 'c360-welcome-style';
    style.textContent = `/* ============================================================
   PANTALLA DE BIENVENIDA CINEMATOGRAFICA DE CATALOGO360 (~4s)
   ============================================================ */
#c360-welcome {
  position: fixed; inset: 0; z-index: 100000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background:
    radial-gradient(ellipse 65% 50% at 50% 40%, rgba(245,118,10,.16) 0%, transparent 65%),
    radial-gradient(ellipse 55% 45% at 38% 62%, rgba(107,63,160,.18) 0%, transparent 68%),
    radial-gradient(ellipse at 50% 40%, #171833 0%, #0c0d1c 55%, #050509 100%);
  overflow: hidden;
  animation: cw-iris-out .85s cubic-bezier(.7,0,.3,1) 3.35s forwards;
}
#c360-welcome.cw-done { display: none; }

.cw-bar { position: absolute; left: 0; right: 0; height: 13%; background: #000; z-index: 10; }
.cw-bar-top { top: 0; transform: translateY(-100%); animation: cw-bar-in .7s cubic-bezier(.6,0,.25,1) .05s forwards, cw-bar-out .6s cubic-bezier(.6,0,.3,1) 3.4s forwards; }
.cw-bar-bottom { bottom: 0; transform: translateY(100%); animation: cw-bar-in .7s cubic-bezier(.6,0,.25,1) .05s forwards, cw-bar-out .6s cubic-bezier(.6,0,.3,1) 3.4s forwards; }

.cw-vignette { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 160px 40px rgba(0,0,0,.55); }

.cw-particles { position: absolute; inset: 0; pointer-events: none; opacity: .35; }
.cw-particles::before {
  content: ''; position: absolute; inset: -40%;
  background-image:
    radial-gradient(circle, rgba(247,183,51,.5) 1px, transparent 1.6px),
    radial-gradient(circle, rgba(255,255,255,.28) 1px, transparent 1.6px);
  background-size: 100px 100px, 155px 155px;
  background-position: 0 0, 50px 50px;
  animation: cw-drift 28s linear infinite;
}

.cw-rays {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 38%, rgba(245,150,60,.10) 50%, transparent 62%);
  transform: translateX(-60%);
  animation: cw-sweep 2.8s cubic-bezier(.3,0,.2,1) .7s forwards;
}

.cw-inner { position: relative; text-align: center; padding: 0 24px; }

.cw-logo-stage { position: relative; width: 128px; height: 128px; margin: 0 auto 22px; }
.cw-logo-stage svg { width: 100%; height: 100%; overflow: visible; }

.cw-layer-navy, .cw-layer-purple, .cw-layer-mark { opacity: 0; }
.cw-layer-navy   { transform: translateX(-46px) rotate(-10deg); transform-origin: 30% 50%; animation: cw-layer-in .85s cubic-bezier(.16,.85,.28,1.15) .35s forwards; }
.cw-layer-purple { transform: translateX(-30px) rotate(-7deg); transform-origin: 30% 50%; animation: cw-layer-in .85s cubic-bezier(.16,.85,.28,1.15) .58s forwards; }
.cw-layer-mark   { transform: scale(.75) rotate(-4deg); transform-origin: 50% 50%; animation: cw-mark-in .95s cubic-bezier(.16,.85,.24,1.2) .84s forwards, cw-mark-float 3.6s ease-in-out 1.85s infinite; }

.cw-sheen {
  position: absolute; inset: -14%; z-index: 4; pointer-events: none;
  background: linear-gradient(115deg, transparent 42%, rgba(255,255,255,.6) 50%, transparent 58%);
  transform: translateX(-140%);
  animation: cw-sheen-go 1.05s cubic-bezier(.3,0,.2,1) 1.05s forwards;
}

.cw-brand {
  margin: 0; font-size: 42px; font-weight: 800; letter-spacing: -1.2px;
  color: #fff; line-height: 1.1; display: flex; justify-content: center;
}
.cw-brand .cw-l {
  display: inline-block; opacity: 0; transform: translateY(18px) rotateX(-55deg);
  animation: cw-letter .5s cubic-bezier(.2,.85,.3,1.1) forwards;
}
.cw-brand .cw-l:nth-child(1)  { animation-delay: 1.28s }
.cw-brand .cw-l:nth-child(2)  { animation-delay: 1.33s }
.cw-brand .cw-l:nth-child(3)  { animation-delay: 1.38s }
.cw-brand .cw-l:nth-child(4)  { animation-delay: 1.43s }
.cw-brand .cw-l:nth-child(5)  { animation-delay: 1.48s }
.cw-brand .cw-l:nth-child(6)  { animation-delay: 1.53s }
.cw-brand .cw-l:nth-child(7)  { animation-delay: 1.58s }
.cw-brand .cw-l:nth-child(8)  { animation-delay: 1.63s }
.cw-brand .cw-l:nth-child(9)  { animation-delay: 1.68s }
.cw-brand .cw-l:nth-child(10) { animation-delay: 1.73s }
.cw-brand .cw-l:nth-child(11) { animation-delay: 1.78s }
.cw-brand .cw-accent {
  background: linear-gradient(120deg, #f7b733, #f5760a);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}

.cw-rule {
  width: 0; height: 1.5px; margin: 16px auto 0;
  background: linear-gradient(90deg, transparent, #6b3fa0, #f5760a, #f7b733, transparent);
  animation: cw-rule-open .85s cubic-bezier(.3,0,.2,1) 1.85s forwards;
}

.cw-welcome {
  margin: 13px 0 0; font-size: 15px; font-weight: 500;
  color: rgba(255,255,255,.62); letter-spacing: 2.6px; text-transform: uppercase;
  opacity: 0; transform: translateY(8px);
  animation: cw-rise .6s ease-out 1.98s forwards;
}

.cw-phrases { position: relative; height: 32px; margin-top: 14px; }
.cw-phrase {
  position: absolute; left: 0; right: 0;
  font-size: 18px; font-weight: 700; letter-spacing: -.2px;
  background: linear-gradient(92deg, #fff, #ffcf8f);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  opacity: 0; transform: translateY(15px);
}
.cw-p1 { animation: cw-phrase .85s ease-out 2.28s forwards; }
.cw-p2 { animation: cw-phrase .85s ease-out 2.68s forwards; }
.cw-p3 { animation: cw-phrase-last .9s ease-out 3.08s forwards; }

.cw-bar-track { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgba(255,255,255,.07); z-index: 5; }
.cw-bar-fill {
  height: 100%; width: 0;
  background: linear-gradient(90deg, #1a2244, #6b3fa0, #f5760a, #f7b733);
  box-shadow: 0 0 12px rgba(245,150,60,.6);
  animation: cw-progress 3.5s cubic-bezier(.35,0,.2,1) forwards;
}

.cw-skip {
  position: absolute; top: 22px; right: 22px; z-index: 11;
  padding: 7px 15px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.05); color: rgba(255,255,255,.7);
  font-size: 12px; font-weight: 600; cursor: pointer;
  backdrop-filter: blur(6px);
  opacity: 0; animation: cw-rise .5s ease-out 1.4s forwards;
  transition: background .2s, color .2s, border-color .2s;
}
.cw-skip:hover { background: rgba(255,255,255,.13); color: #fff; border-color: rgba(255,255,255,.32); }

@keyframes cw-bar-in    { to { transform: translateY(0); } }
@keyframes cw-bar-out   { to { transform: translateY(0); opacity: 0; } }
@keyframes cw-layer-in  { to { opacity: 1; transform: translateX(0) rotate(0deg); } }
@keyframes cw-mark-in   { to { opacity: 1; transform: scale(1) rotate(0deg); } }
@keyframes cw-mark-float{ 0%,100% { translate: 0 0 } 50% { translate: 0 -6px } }
@keyframes cw-sheen-go  { to { transform: translateX(140%); } }
@keyframes cw-sweep     { to { transform: translateX(60%); } }
@keyframes cw-letter    { to { opacity: 1; transform: translateY(0) rotateX(0); } }
@keyframes cw-rule-open { to { width: 200px; } }
@keyframes cw-rise      { to { opacity: 1; transform: translateY(0); } }
@keyframes cw-drift     { to { transform: translate(100px, 155px); } }
@keyframes cw-phrase {
  0%   { opacity: 0; transform: translateY(15px); }
  22%  { opacity: 1; transform: translateY(0); }
  78%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-13px); }
}
@keyframes cw-phrase-last {
  0%  { opacity: 0; transform: translateY(15px); }
  26% { opacity: 1; transform: translateY(0); }
  100%{ opacity: 1; transform: translateY(0); }
}
@keyframes cw-progress { to { width: 100%; } }
@keyframes cw-iris-out { to { opacity: 0; transform: scale(1.06); filter: brightness(1.3); } }

@media (max-width: 480px) {
  .cw-logo-stage { width: 100px; height: 100px; margin-bottom: 18px; }
  .cw-brand      { font-size: 32px; }
  .cw-welcome    { font-size: 13px; letter-spacing: 2.2px; }
  .cw-phrase     { font-size: 16px; }
  .cw-skip       { top: 15px; right: 15px; }
  .cw-bar        { height: 9%; }
}

@media (prefers-reduced-motion: reduce) {
  #c360-welcome, #c360-welcome * { animation-duration: .01ms !important; animation-delay: 0ms !important; }
  .cw-brand .cw-l, .cw-welcome, .cw-phrase, .cw-layer-navy, .cw-layer-purple, .cw-layer-mark, .cw-skip { opacity: 1 !important; transform: none !important; }
  .cw-rule { width: 200px !important; }
  .cw-p1, .cw-p2, .cw-sheen, .cw-rays, .cw-bar { display: none; }
}
`;
    document.head.appendChild(style);

    // 4. Inyectar la pantalla -- el logo se construye como SVG
    //    propio, en 3 capas independientes (cada una es su propio
    //    elemento animable), en vez de depender de una imagen
    //    externa -- asi cada "pagina" se revela por separado.
    var cont = document.createElement('div');
    cont.innerHTML = `<div id="c360-welcome" aria-hidden="true">
  <div class="cw-bar cw-bar-top"></div>
  <div class="cw-bar cw-bar-bottom"></div>
  <div class="cw-vignette"></div>
  <div class="cw-particles"></div>
  <div class="cw-rays"></div>
  <div class="cw-inner">
    <div class="cw-logo-stage">
      <svg viewBox="0 0 128 128">
        <defs>
          <linearGradient id="cwMarkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#f7b733"/>
            <stop offset="55%" stop-color="#f5760a"/>
            <stop offset="100%" stop-color="#d8330f"/>
          </linearGradient>
        </defs>
        <path class="cw-layer-navy" d="M40 14 L88 14 Q96 14 96 22 L96 34 L52 60 L40 60 Q32 60 32 52 L32 26 Q32 14 40 14 Z" fill="#1a2244"/>
        <path class="cw-layer-purple" d="M46 26 L92 26 Q100 26 100 34 L100 46 L58 70 L46 70 Q38 70 38 62 L38 38 Q38 26 46 26 Z" fill="#6b3fa0"/>
        <path class="cw-layer-mark" d="M60 30 C82 30 100 46 100 64 C100 82 82 98 60 98 C48 98 37 92 30 83 L46 71 C50 76 55 78 60 78 C71 78 80 72 80 64 C80 56 71 50 60 50 C55 50 50 52 46 57 L30 45 C37 36 48 30 60 30 Z" fill="url(#cwMarkGrad)"/>
      </svg>
      <span class="cw-sheen"></span>
    </div>
    <h1 class="cw-brand">
      <span class="cw-l">C</span><span class="cw-l">a</span><span class="cw-l">t</span><span class="cw-l">a</span><span class="cw-l">l</span><span class="cw-l">o</span><span class="cw-l">g</span><span class="cw-l">o</span><span class="cw-l cw-accent">3</span><span class="cw-l cw-accent">6</span><span class="cw-l cw-accent">0</span>
    </h1>
    <div class="cw-rule"></div>
    <p class="cw-welcome">Bienvenido</p>
    <div class="cw-phrases">
      <span class="cw-phrase cw-p1">Tus productos</span>
      <span class="cw-phrase cw-p2">Tus precios</span>
      <span class="cw-phrase cw-p3">Listo para compartir</span>
    </div>
  </div>
  <div class="cw-bar-track"><div class="cw-bar-fill"></div></div>
  <button type="button" class="cw-skip" id="cwSkip">Saltar</button>
</div>`;
    var el = cont.firstElementChild;
    document.body.appendChild(el);

    // 5. Control de cierre
    var cerrada = false;
    function cerrar() {
      if (cerrada) return;
      cerrada = true;
      el.classList.add('cw-done');
    }
    var btn = document.getElementById('cwSkip');
    if (btn) btn.addEventListener('click', cerrar);

    setTimeout(cerrar, 4000);
    setTimeout(cerrar, 6500);
  } catch (e) {
    var w = document.getElementById('c360-welcome');
    if (w) w.style.display = 'none';
  }
})();
