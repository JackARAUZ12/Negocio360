/* ============================================================
   BIENVENIDA-CATALOGO360.JS
   Pantalla de bienvenida cinematografica (~6s + cierre) exclusiva
   de Catalogo360 -- se muestra al ABRIR SESION, una sola vez, SOLO
   en catalogo360.html. Las otras puertas de entrada (dashboard,
   bodega, admin) siguen usando bienvenida-negocio360.js sin ningun
   cambio -- este archivo es completamente independiente.

   Usa el logo REAL de Catalogo360 (catalogo360-icono.png), revelado
   con un wipe diagonal tipo transicion de cine, con marcas de
   encuadre de camara, flash de llegada, rayos radiales, anillos
   orbitando, y fondo respirando -- una secuencia de 6 actos.

   Mismas reglas de seguridad de siempre: nunca bloquea el acceso,
   respeta prefers-reduced-motion, boton de saltar, respaldo por si
   algo fallara.
   ============================================================ */
(function () {
  try {
    var archivo = (location.pathname.split('/').pop() || '').toLowerCase();
    if (archivo.indexOf('catalogo360') !== 0) return;

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
    } catch (_) { }

    try {
      if (sessionStorage.getItem(clave) === '1') return;
      sessionStorage.setItem(clave, '1');
    } catch (_) { }

    var style = document.createElement('style');
    style.id = 'c360-welcome-style';
    style.textContent = `
#c360-welcome {
  position: fixed; inset: 0; z-index: 100000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background:
    radial-gradient(ellipse 60% 48% at 30% 30%, rgba(107,63,160,.38) 0%, transparent 62%),
    radial-gradient(ellipse 65% 52% at 72% 38%, rgba(245,118,10,.34) 0%, transparent 62%),
    radial-gradient(ellipse 55% 45% at 50% 78%, rgba(247,183,51,.22) 0%, transparent 65%),
    radial-gradient(ellipse at 50% 40%, #1a1a3d 0%, #0d0e22 55%, #050509 100%);
  background-size: 130% 130%, 130% 130%, 130% 130%, 100% 100%;
  overflow: hidden;
  animation:
    cw-bg-breathe 8s ease-in-out infinite,
    cw-iris-out .9s cubic-bezier(.7,0,.3,1) 5.85s forwards;
}
#c360-welcome.cw-done { display: none; }

.cw-bar { position: absolute; left: 0; right: 0; height: 13%; background: #000; z-index: 10; }
.cw-bar-top { top: 0; transform: translateY(-100%); animation: cw-bar-in .7s cubic-bezier(.6,0,.25,1) .05s forwards, cw-bar-out .65s cubic-bezier(.6,0,.3,1) 5.9s forwards; }
.cw-bar-bottom { bottom: 0; transform: translateY(100%); animation: cw-bar-in .7s cubic-bezier(.6,0,.25,1) .05s forwards, cw-bar-out .65s cubic-bezier(.6,0,.3,1) 5.9s forwards; }

/* Marcas de encuadre, esquinas tipo visor de camara -- sello de "cine" instantaneo */
.cw-corner { position: absolute; width: 34px; height: 34px; z-index: 9; opacity: 0; animation: cw-rise .6s ease-out .5s forwards; }
.cw-corner::before, .cw-corner::after { content: ''; position: absolute; background: rgba(255,200,140,.55); }
.cw-corner-tl { top: 26px; left: 26px; }
.cw-corner-tl::before { top: 0; left: 0; width: 2px; height: 100%; }
.cw-corner-tl::after  { top: 0; left: 0; width: 100%; height: 2px; }
.cw-corner-tr { top: 26px; right: 26px; }
.cw-corner-tr::before { top: 0; right: 0; width: 2px; height: 100%; }
.cw-corner-tr::after  { top: 0; right: 0; width: 100%; height: 2px; }
.cw-corner-bl { bottom: 26px; left: 26px; }
.cw-corner-bl::before { bottom: 0; left: 0; width: 2px; height: 100%; }
.cw-corner-bl::after  { bottom: 0; left: 0; width: 100%; height: 2px; }
.cw-corner-br { bottom: 26px; right: 26px; }
.cw-corner-br::before { bottom: 0; right: 0; width: 2px; height: 100%; }
.cw-corner-br::after  { bottom: 0; right: 0; width: 100%; height: 2px; }

.cw-vignette { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 170px 45px rgba(0,0,0,.55); }

.cw-blob { position: absolute; border-radius: 50%; filter: blur(60px); opacity: 0; animation: cw-blob-in 1s ease-out forwards, cw-blob-pulse 7s ease-in-out 1s infinite; }
.cw-blob-1 { width: 360px; height: 360px; background: #6b3fa0; top: 6%; left: 4%; animation-delay: .3s, 1.3s; }
.cw-blob-2 { width: 320px; height: 320px; background: #f5760a; top: 40%; right: 6%; animation-delay: .55s, 1.55s; }
.cw-blob-3 { width: 280px; height: 280px; background: #f7b733; bottom: 4%; left: 30%; animation-delay: .8s, 1.8s; }
.cw-blob-4 { width: 220px; height: 220px; background: #d8330f; top: 62%; left: 14%; animation-delay: 1.05s, 2.05s; }

.cw-particles { position: absolute; inset: 0; pointer-events: none; opacity: 0; animation: cw-rise .8s ease-out .7s forwards; }
.cw-particles::before {
  content: ''; position: absolute; inset: -40%;
  background-image:
    radial-gradient(circle, rgba(247,183,51,.7) 1.4px, transparent 2px),
    radial-gradient(circle, rgba(245,118,10,.6) 1.4px, transparent 2px),
    radial-gradient(circle, rgba(150,110,220,.6) 1.4px, transparent 2px),
    radial-gradient(circle, rgba(255,255,255,.4) 1px, transparent 1.6px);
  background-size: 90px 90px, 130px 130px, 160px 160px, 70px 70px;
  background-position: 0 0, 45px 30px, 20px 80px, 60px 10px;
  animation: cw-drift 30s linear infinite;
}

.cw-rays {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 36%, rgba(255,180,90,.18) 50%, transparent 64%);
  transform: translateX(-60%);
  animation: cw-sweep 3s cubic-bezier(.3,0,.2,1) 1s forwards;
}

/* Rayos radiales -- explotan brevemente al llegar el flash de "arribo" */
.cw-burst { position: absolute; width: 2px; height: 90px; background: linear-gradient(to bottom, rgba(255,220,170,.85), transparent); left: 50%; top: 50%; transform-origin: 50% 0; opacity: 0; }
.cw-burst { animation: cw-burst-go .7s cubic-bezier(.15,.7,.3,1) 2.75s forwards; }
.cw-burst:nth-child(1)  { transform: translate(-50%,-50%) rotate(0deg); }
.cw-burst:nth-child(2)  { transform: translate(-50%,-50%) rotate(30deg); }
.cw-burst:nth-child(3)  { transform: translate(-50%,-50%) rotate(60deg); }
.cw-burst:nth-child(4)  { transform: translate(-50%,-50%) rotate(90deg); }
.cw-burst:nth-child(5)  { transform: translate(-50%,-50%) rotate(120deg); }
.cw-burst:nth-child(6)  { transform: translate(-50%,-50%) rotate(150deg); }
.cw-burst:nth-child(7)  { transform: translate(-50%,-50%) rotate(180deg); }
.cw-burst:nth-child(8)  { transform: translate(-50%,-50%) rotate(210deg); }
.cw-burst:nth-child(9)  { transform: translate(-50%,-50%) rotate(240deg); }
.cw-burst:nth-child(10) { transform: translate(-50%,-50%) rotate(270deg); }
.cw-burst:nth-child(11) { transform: translate(-50%,-50%) rotate(300deg); }
.cw-burst:nth-child(12) { transform: translate(-50%,-50%) rotate(330deg); }

/* Flash blanco breve -- el "momento de llegada" cuando el logo termina de revelarse */
.cw-flash { position: absolute; inset: 0; background: radial-gradient(circle at 50% 44%, rgba(255,255,255,.9) 0%, transparent 42%); opacity: 0; pointer-events: none; z-index: 6; animation: cw-flash-go .55s ease-out 2.7s forwards; }

.cw-inner { position: relative; text-align: center; padding: 0 24px; }

.cw-logo-stage { position: relative; width: 176px; height: 176px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; }

.cw-glow {
  position: absolute; width: 210px; height: 210px; border-radius: 50%;
  background: radial-gradient(circle, rgba(245,150,60,.5) 0%, rgba(107,63,160,.32) 45%, transparent 72%);
  filter: blur(18px); opacity: 0;
  animation: cw-glow-in 1.1s ease-out 1s forwards, cw-glow-pulse 2.8s ease-in-out 2.1s infinite;
}

.cw-ring { position: absolute; border-radius: 50%; opacity: 0; }
.cw-ring-1 { inset: 6px; border: 2px solid transparent; border-top-color: #f7b733; border-right-color: #f5760a; animation: cw-ring-in .6s ease-out 1.2s forwards, cw-ring-spin 5.5s linear 1.5s infinite; }
.cw-ring-2 { inset: -8px; border: 1.5px solid transparent; border-bottom-color: #6b3fa0; border-left-color: #d8330f; animation: cw-ring-in .6s ease-out 1.35s forwards, cw-ring-spin-rev 7.5s linear 1.6s infinite; }
.cw-ring-3 { inset: -22px; border: 1px dashed rgba(255,220,170,.3); animation: cw-ring-in .7s ease-out 1.5s forwards, cw-ring-spin 14s linear 1.7s infinite; }
.cw-ring-4 { inset: -38px; border: 1px solid rgba(255,255,255,.14); animation: cw-ring-out 2s cubic-bezier(.2,.7,.3,1) 2.65s forwards; }

/* Puntos orbitando el anillo exterior */
.cw-orbit { position: absolute; inset: -22px; opacity: 0; animation: cw-rise .5s ease-out 1.7s forwards, cw-orbit-spin 9s linear 2.1s infinite; }
.cw-orbit-dot { position: absolute; width: 5px; height: 5px; border-radius: 50%; top: 50%; left: 50%; margin: -2.5px 0 0 -2.5px; box-shadow: 0 0 8px 1px currentColor; }
.cw-orbit-dot:nth-child(1) { color: #f7b733; background: #f7b733; transform: rotate(0deg) translateY(-110px); }
.cw-orbit-dot:nth-child(2) { color: #f5760a; background: #f5760a; transform: rotate(120deg) translateY(-110px); }
.cw-orbit-dot:nth-child(3) { color: #6b3fa0; background: #6b3fa0; transform: rotate(240deg) translateY(-110px); }

.cw-logo-clip {
  position: relative; width: 132px; height: 132px; z-index: 3;
  clip-path: polygon(-20% -20%, -20% -20%, -20% -20%, -20% -20%);
  animation: cw-wipe-reveal 1.1s cubic-bezier(.5,0,.15,1) 1.55s forwards;
  filter: drop-shadow(0 12px 30px rgba(245,118,10,.5)) drop-shadow(0 0 40px rgba(107,63,160,.35));
}
.cw-logo-img {
  width: 100%; height: 100%; object-fit: contain;
  transform: scale(1.12);
  animation: cw-logo-settle 1s cubic-bezier(.2,.8,.25,1) 1.6s forwards, cw-logo-float 3.8s ease-in-out 2.9s infinite;
}

.cw-sheen {
  position: absolute; inset: -18%; z-index: 4; pointer-events: none;
  background: linear-gradient(115deg, transparent 40%, rgba(255,255,255,.8) 50%, transparent 60%);
  transform: translateX(-150%);
  animation: cw-sheen-go 1s cubic-bezier(.3,0,.2,1) 2.45s forwards;
}

.cw-brand {
  margin: 0; font-size: 44px; font-weight: 800; letter-spacing: -1.2px;
  color: #fff; line-height: 1.1; display: flex; justify-content: center;
  text-shadow: 0 0 30px rgba(245,150,60,.4);
}
.cw-brand .cw-l {
  display: inline-block; opacity: 0; transform: translateY(20px) rotateX(-60deg);
  animation: cw-letter .48s cubic-bezier(.2,.85,.3,1.1) forwards;
}
.cw-brand .cw-l:nth-child(1)  { animation-delay: 3.05s }
.cw-brand .cw-l:nth-child(2)  { animation-delay: 3.11s }
.cw-brand .cw-l:nth-child(3)  { animation-delay: 3.17s }
.cw-brand .cw-l:nth-child(4)  { animation-delay: 3.23s }
.cw-brand .cw-l:nth-child(5)  { animation-delay: 3.29s }
.cw-brand .cw-l:nth-child(6)  { animation-delay: 3.35s }
.cw-brand .cw-l:nth-child(7)  { animation-delay: 3.41s }
.cw-brand .cw-l:nth-child(8)  { animation-delay: 3.47s }
.cw-brand .cw-l:nth-child(9)  { animation-delay: 3.53s }
.cw-brand .cw-l:nth-child(10) { animation-delay: 3.59s }
.cw-brand .cw-l:nth-child(11) { animation-delay: 3.65s }
.cw-brand .cw-accent {
  background: linear-gradient(120deg, #f7b733, #f5760a, #d8330f);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}

.cw-rule {
  width: 0; height: 2px; margin: 16px auto 0; border-radius: 2px;
  background: linear-gradient(90deg, transparent, #1a2244, #6b3fa0, #f5760a, #f7b733, transparent);
  box-shadow: 0 0 8px rgba(245,150,60,.5);
  animation: cw-rule-open .85s cubic-bezier(.3,0,.2,1) 3.75s forwards;
}

.cw-welcome {
  margin: 13px 0 0; font-size: 15px; font-weight: 500;
  color: rgba(255,255,255,.68); letter-spacing: 2.8px; text-transform: uppercase;
  opacity: 0; transform: translateY(8px);
  animation: cw-rise .6s ease-out 3.95s forwards;
}

.cw-phrases { position: relative; height: 32px; margin-top: 14px; }
.cw-phrase {
  position: absolute; left: 0; right: 0;
  font-size: 18px; font-weight: 700; letter-spacing: -.2px;
  background: linear-gradient(92deg, #fff, #ffb870, #ffe08f);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  opacity: 0; transform: translateY(15px);
}
.cw-p1 { animation: cw-phrase .8s ease-out 4.15s forwards; }
.cw-p2 { animation: cw-phrase .8s ease-out 4.75s forwards; }
.cw-p3 { animation: cw-phrase-last .85s ease-out 5.35s forwards; }

.cw-bar-track { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.07); z-index: 5; }
.cw-bar-fill {
  height: 100%; width: 0;
  background: linear-gradient(90deg, #1a2244, #6b3fa0, #d8330f, #f5760a, #f7b733);
  box-shadow: 0 0 14px rgba(245,150,60,.7);
  animation: cw-progress 6s cubic-bezier(.35,0,.2,1) forwards;
}

.cw-skip {
  position: absolute; top: 22px; right: 22px; z-index: 11;
  padding: 7px 15px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.05); color: rgba(255,255,255,.7);
  font-size: 12px; font-weight: 600; cursor: pointer;
  backdrop-filter: blur(6px);
  opacity: 0; animation: cw-rise .5s ease-out 1s forwards;
  transition: background .2s, color .2s, border-color .2s;
}
.cw-skip:hover { background: rgba(255,255,255,.13); color: #fff; border-color: rgba(255,255,255,.32); }

@keyframes cw-bg-breathe {
  0%,100% { background-position: 0% 0%, 100% 0%, 50% 100%, 0 0; }
  50%     { background-position: 8% 6%, 92% 8%, 46% 92%, 0 0; }
}
@keyframes cw-bar-in    { to { transform: translateY(0); } }
@keyframes cw-bar-out   { to { transform: translateY(0); opacity: 0; } }
@keyframes cw-blob-in   { to { opacity: .5; } }
@keyframes cw-blob-pulse{ 0%,100% { transform: scale(1) translate(0,0); opacity: .5; } 50% { transform: scale(1.25) translate(15px,-10px); opacity: .72; } }
@keyframes cw-glow-in   { to { opacity: 1; } }
@keyframes cw-glow-pulse{ 0%,100% { opacity: .85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
@keyframes cw-ring-in   { to { opacity: 1; } }
@keyframes cw-ring-spin { to { transform: rotate(360deg); } }
@keyframes cw-ring-spin-rev { to { transform: rotate(-360deg); } }
@keyframes cw-ring-out  { 0% { opacity: .6; transform: scale(.85); } 100% { opacity: 0; transform: scale(1.5); } }
@keyframes cw-orbit-spin{ to { transform: rotate(360deg); } }
@keyframes cw-wipe-reveal { to { clip-path: polygon(-20% -20%, 130% -20%, 130% 130%, -20% 130%); } }
@keyframes cw-logo-settle { to { transform: scale(1); } }
@keyframes cw-logo-float { 0%,100% { translate: 0 0 } 50% { translate: 0 -7px } }
@keyframes cw-sheen-go  { to { transform: translateX(150%); } }
@keyframes cw-sweep     { to { transform: translateX(60%); } }
@keyframes cw-flash-go  { 0% { opacity: 0; } 35% { opacity: 1; } 100% { opacity: 0; } }
@keyframes cw-burst-go  { 0% { opacity: 0; height: 0; } 40% { opacity: .9; height: 90px; } 100% { opacity: 0; height: 130px; } }
@keyframes cw-letter    { to { opacity: 1; transform: translateY(0) rotateX(0); } }
@keyframes cw-rule-open { to { width: 210px; } }
@keyframes cw-rise      { to { opacity: 1; transform: translateY(0); } }
@keyframes cw-drift     { to { transform: translate(90px, 140px); } }
@keyframes cw-phrase {
  0%   { opacity: 0; transform: translateY(15px); }
  12%  { opacity: 1; transform: translateY(0); }
  88%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-13px); }
}
@keyframes cw-phrase-last {
  0%  { opacity: 0; transform: translateY(15px); }
  16% { opacity: 1; transform: translateY(0); }
  100%{ opacity: 1; transform: translateY(0); }
}
@keyframes cw-progress { to { width: 100%; } }
@keyframes cw-iris-out { to { opacity: 0; transform: scale(1.08); filter: brightness(1.4) saturate(1.3); } }

@media (max-width: 480px) {
  .cw-logo-stage { width: 132px; height: 132px; margin-bottom: 16px; }
  .cw-logo-clip  { width: 100px; height: 100px; }
  .cw-brand      { font-size: 33px; }
  .cw-welcome    { font-size: 13px; letter-spacing: 2.2px; }
  .cw-phrase     { font-size: 16px; }
  .cw-skip       { top: 15px; right: 15px; }
  .cw-bar        { height: 9%; }
  .cw-corner     { width: 24px; height: 24px; }
  .cw-corner-tl, .cw-corner-tr { top: 18px; }
  .cw-corner-bl, .cw-corner-br { bottom: 18px; }
  .cw-corner-tl, .cw-corner-bl { left: 16px; }
  .cw-corner-tr, .cw-corner-br { right: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  #c360-welcome, #c360-welcome * { animation-duration: .01ms !important; animation-delay: 0ms !important; }
  .cw-brand .cw-l, .cw-welcome, .cw-phrase, .cw-skip, .cw-corner, .cw-particles { opacity: 1 !important; transform: none !important; }
  .cw-logo-clip { clip-path: none !important; }
  .cw-logo-img { transform: scale(1) !important; }
  .cw-glow, .cw-ring, .cw-orbit, .cw-blob { opacity: 1 !important; }
  .cw-rule { width: 210px !important; }
  .cw-p1, .cw-sheen, .cw-rays, .cw-bar, .cw-flash, .cw-burst { display: none; }
}
`;
    document.head.appendChild(style);

    var burstsHtml = '';
    for (var bi = 0; bi < 12; bi++) burstsHtml += '<span class="cw-burst"></span>';

    var cont = document.createElement('div');
    cont.innerHTML = `<div id="c360-welcome" aria-hidden="true">
  <div class="cw-bar cw-bar-top"></div>
  <div class="cw-bar cw-bar-bottom"></div>
  <span class="cw-corner cw-corner-tl"></span>
  <span class="cw-corner cw-corner-tr"></span>
  <span class="cw-corner cw-corner-bl"></span>
  <span class="cw-corner cw-corner-br"></span>
  <div class="cw-vignette"></div>
  <div class="cw-blob cw-blob-1"></div>
  <div class="cw-blob cw-blob-2"></div>
  <div class="cw-blob cw-blob-3"></div>
  <div class="cw-blob cw-blob-4"></div>
  <div class="cw-particles"></div>
  <div class="cw-rays"></div>
  <div class="cw-flash"></div>
  ${burstsHtml}
  <div class="cw-inner">
    <div class="cw-logo-stage">
      <span class="cw-glow"></span>
      <span class="cw-ring cw-ring-1"></span>
      <span class="cw-ring cw-ring-2"></span>
      <span class="cw-ring cw-ring-3"></span>
      <span class="cw-ring cw-ring-4"></span>
      <span class="cw-orbit">
        <span class="cw-orbit-dot"></span>
        <span class="cw-orbit-dot"></span>
        <span class="cw-orbit-dot"></span>
      </span>
      <div class="cw-logo-clip">
        <img src="catalogo360-icono.png" alt="Catalogo360" class="cw-logo-img"/>
      </div>
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

    var cerrada = false;
    function cerrar() {
      if (cerrada) return;
      cerrada = true;
      el.classList.add('cw-done');
    }
    var btn = document.getElementById('cwSkip');
    if (btn) btn.addEventListener('click', cerrar);

    setTimeout(cerrar, 6750);
    setTimeout(cerrar, 9000);
  } catch (e) {
    var w = document.getElementById('c360-welcome');
    if (w) w.style.display = 'none';
  }
})();
