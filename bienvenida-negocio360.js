/* ============================================================
   BIENVENIDA-NEGOCIO360.JS  (v4 — "El dial 360")
   Pantalla de bienvenida animada (~8 s) que se muestra al ABRIR
   SESION, una sola vez -- no al navegar entre modulos.

   Se autoinyecta: basta con incluir este archivo en cualquier
   pagina. Todo (estilos, HTML y control) vive aqui.

   GUION (todo orquestado desde un solo reloj):
     0.0 s  Aparece el dial: 72 marcas, aros y el logotipo.
     0.7 s  Un radar barre el dial; el numero sube de 0 a 360 y
            va encendiendo las marcas a su paso.
     1.1 s  Se activan los 6 modulos del sistema alrededor del dial.
     3.4 s  Se completa la vuelta: el nombre queda "Negocio360".
     3.8 s  "Controla tu negocio" -> "Vende mas" -> "Gana mas".
     6.3 s  Saludo segun la hora y el mes en curso.
     7.4 s  Cierre con desvanecimiento suave que revela el sistema.

   REGLAS DE APARICION (iguales que siempre):
   - Solo en las pantallas de ENTRADA (dashboard, bodega,
     catalogo360, admin). Si se abre otro modulo directo, no aparece.
   - Una sola vez por sesion del navegador, POR USUARIO.
   - Nunca bloquea: hay cierre de seguridad a los 10 s, boton
     "Saltar" y tecla Esc. Si algo fallara, se quita y el sistema sigue.
   - Respeta "reducir animaciones": muestra la composicion final
     sin movimiento y se cierra enseguida.
   - z-index 100000: por ENCIMA del tutorial y del selector de
     perfiles (99999).
   TEMPORADAS: del 1 al 19 de octubre, tema "Octubre Rosa" (paleta
   rosa, logo rosa y lazo). Del 20 de octubre al 2 de noviembre, la
   escena de Halloween (ver escenaHalloween). El resto del año, la
   bienvenida normal.
   ============================================================ */
(function () {
  /* ============================================================
     TEMPORADA HALLOWEEN (20 oct – 2 nov): "La noche de Negocio360"
     Escena propia (~8 s), con las MISMAS reglas que la bienvenida
     normal: solo en pantallas de entrada, una vez por sesion y por
     usuario, boton "Saltar", tecla Esc, cierre de seguridad a los
     10 s, respeta "reducir animaciones" y, si algo falla, se quita
     sola sin tocar el sistema. No guarda nada ni llama al servidor.
     GUION:
       0.0 s  Noche: estrellas, niebla y la luna llena que sube.
       0.6 s  Murcielagos salen de la luna.
       1.2 s  RAYO: destello, relampago y temblor de pantalla.
       1.7 s  Sube la calabaza; a los 2.4 s se enciende su vela.
       2.8 s  Fantasmas, arana bajando y telarana que se dibuja.
       3.0 s  "Negocio360" (logo con sombrero de bruja).
       3.5 s  "¡Feliz Halloween!" con letras que gotean.
       4.4 s  "Controla tu negocio" -> "Vende mas" -> "Gana mas".
       5.0 s  Segundo relampago (suave) y otra bandada.
       6.6 s  Saludo segun la hora.
       7.7 s  La vela se apaga, humo y se revela el sistema.
     Prueba en cualquier fecha: agregar ?bienvenida=halloween a la URL.
     ============================================================ */
  function esHalloween() {
    try {
      var q = (location.search || '').toLowerCase();
      if (q.indexOf('bienvenida=halloween') !== -1) return true;
      if (q.indexOf('bienvenida=normal') !== -1) return false;
      var d = new Date(), m = d.getMonth(), dia = d.getDate();
      return (m === 9 && dia >= 20) || (m === 10 && dia <= 2);
    } catch (_) { return false; }
  }

  function escenaHalloween(REDUCIDO) {
    var T = { luna: 100, bats1: 600, rayo: 1250, calabaza: 1700, vela: 2400, fantasmas: 2800, arana: 3000, marca: 3000,
              titulo: 3500, fraseA: 4400, rayo2: 5000, bats2: 4300, fraseB: 5200, fraseC: 6000, saludo: 6600,
              salir: 7700, quitar: 8700, seguridad: 10000 };

    try {   // letra de Halloween (si no carga, queda una letra gruesa del sistema)
      if (!document.getElementById('n360-hw-font')) {
        var lf = document.createElement('link'); lf.id = 'n360-hw-font'; lf.rel = 'stylesheet';
        lf.href = 'https://fonts.googleapis.com/css2?family=Creepster&display=swap'; document.head.appendChild(lf);
      }
    } catch (_) {}

    var style = document.createElement('style');
    style.id = 'n360-welcome-style';
    style.textContent = `
#n360-welcome.hw { position: fixed; inset: 0; z-index: 100000; overflow: hidden; color: #fff; font-family: inherit;
  --P: min(38vmin, 340px); --M: min(36vmin, 330px); --or: #ff7a18; --or2: #ffb347; --mor: #8b3dff; --verde: #7CFF6B;
  background: radial-gradient(ellipse 70% 60% at 72% 16%, #42206b 0%, #1d0c35 38%, #0b0518 70%, #030108 100%);
  opacity: 1; transition: opacity .9s ease, transform 1s ease, filter .9s ease; }
#n360-welcome.hw * , #n360-welcome.hw *::before, #n360-welcome.hw *::after { box-sizing: border-box; }
#n360-welcome.hw.hw-exit { opacity: 0; transform: scale(1.06); filter: blur(6px) brightness(.4); pointer-events: none; }
.hw-shake { animation: hw-shake .55s cubic-bezier(.36,.07,.19,.97); }
@keyframes hw-shake { 10%,90% { transform: translate(-2px,1px) } 20%,80% { transform: translate(4px,-2px) } 30%,50%,70% { transform: translate(-7px,3px) } 40%,60% { transform: translate(7px,-3px) } }
.hw-world { position: absolute; inset: 0; }
.hw-cam { position: absolute; inset: 0; transform: scale(1.0); transition: transform 9s cubic-bezier(.25,.1,.25,1); }
#n360-welcome.hw-on .hw-cam { transform: scale(1.07); }
.hw-vig { position: absolute; inset: 0; z-index: 8; pointer-events: none; background: radial-gradient(ellipse at 50% 48%, transparent 48%, rgba(0,0,0,.7) 100%); }
.hw-grain { position: absolute; inset: -50%; z-index: 9; pointer-events: none; opacity: .07; mix-blend-mode: overlay; animation: hw-grain .5s steps(4) infinite;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
@keyframes hw-grain { 0% { transform: translate(0,0) } 25% { transform: translate(-3%,2%) } 50% { transform: translate(2%,-3%) } 75% { transform: translate(-2%,-1%) } 100% { transform: translate(1%,3%) } }
canvas.hw-cv { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
canvas.hw-sky { z-index: 0; } canvas.hw-fx { z-index: 6; }

/* Luna */
.hw-moon { position: absolute; z-index: 1; right: 9%; top: 6%; width: var(--M); aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(circle at 38% 34%, #fffbea 0%, #ffe9a8 34%, #f6c56a 66%, #d98a2b 100%);
  box-shadow: 0 0 60px 18px rgba(255,200,110,.45), 0 0 180px 70px rgba(255,140,40,.22), inset -18px -14px 40px rgba(140,70,10,.35);
  opacity: 0; transform: translateY(45%) scale(.9); transition: opacity 1.6s ease, transform 2.2s cubic-bezier(.2,.8,.2,1); }
.hw-moon::before { content: ''; position: absolute; inset: 0; border-radius: 50%; opacity: .55;
  background: radial-gradient(circle at 30% 60%, rgba(170,100,30,.45) 0 8%, transparent 9%), radial-gradient(circle at 62% 30%, rgba(170,100,30,.4) 0 6%, transparent 7%),
    radial-gradient(circle at 70% 66%, rgba(170,100,30,.35) 0 10%, transparent 11%), radial-gradient(circle at 46% 46%, rgba(170,100,30,.25) 0 4%, transparent 5%), radial-gradient(circle at 22% 32%, rgba(170,100,30,.3) 0 3.5%, transparent 4.5%); }
#n360-welcome.hw-on .hw-moon { opacity: 1; transform: none; }
.hw-cloud { position: absolute; z-index: 2; height: calc(var(--M) * .28); width: calc(var(--M) * 1.25); border-radius: 50%; filter: blur(14px);
  background: radial-gradient(ellipse at 50% 60%, rgba(20,8,38,.92), rgba(20,8,38,0) 70%); opacity: 0; transition: opacity 2s ease .6s; }
#n360-welcome.hw-on .hw-cloud { opacity: 1; }
.hw-c1 { top: calc(6% + var(--M) * .45); right: -30%; animation: hw-cloud 9s linear infinite; }
.hw-c2 { top: calc(6% + var(--M) * .12); right: -45%; animation: hw-cloud 13s linear infinite -4s; transform: scale(.8); }
@keyframes hw-cloud { from { translate: 0 0; } to { translate: -150vw 0; } }

/* Niebla */
.hw-fog { position: absolute; z-index: 4; left: -50%; width: 200%; height: 34vh; bottom: -6vh; pointer-events: none; opacity: 0; transition: opacity 2.4s ease;
  background: radial-gradient(ellipse 22% 60% at 15% 70%, rgba(190,160,255,.22), transparent 70%), radial-gradient(ellipse 20% 55% at 45% 75%, rgba(190,160,255,.18), transparent 70%),
    radial-gradient(ellipse 24% 60% at 75% 70%, rgba(190,160,255,.2), transparent 70%), radial-gradient(ellipse 20% 50% at 95% 80%, rgba(190,160,255,.16), transparent 70%); filter: blur(6px); }
#n360-welcome.hw-on .hw-fog { opacity: 1; }
.hw-f1 { animation: hw-fog 16s linear infinite; } .hw-f2 { bottom: -12vh; animation: hw-fog 22s linear infinite reverse; opacity: .8; }
@keyframes hw-fog { from { transform: translateX(0) } to { transform: translateX(-25%) } }

/* Paisaje (casa embrujada, arboles, tumbas) */
.hw-land { position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; height: 40vh; width: 100%; transform: translateY(35%); opacity: 0;
  transition: transform 1.8s cubic-bezier(.2,.8,.2,1) .2s, opacity 1.2s ease .2s; }
#n360-welcome.hw-on .hw-land { transform: none; opacity: 1; }
.hw-win { fill: #ffb540; animation: hw-win 2.6s steps(1) infinite; filter: drop-shadow(0 0 6px #ff9a1f); }
.hw-win.b { animation-delay: -1.1s; } .hw-win.c { animation-delay: -2s; animation-duration: 3.4s; }
@keyframes hw-win { 0%,100% { opacity: 1 } 47% { opacity: .35 } 52% { opacity: 1 } 80% { opacity: .7 } }

/* Rayo */
.hw-flash { position: absolute; inset: 0; z-index: 9; background: #e9e4ff; opacity: 0; pointer-events: none; mix-blend-mode: screen; }
.hw-flash.go { animation: hw-flash .9s ease-out; }
.hw-flash.soft { animation: hw-flash2 .6s ease-out; }
@keyframes hw-flash { 0% { opacity: 0 } 6% { opacity: .95 } 14% { opacity: .1 } 22% { opacity: .75 } 40% { opacity: .05 } 100% { opacity: 0 } }
@keyframes hw-flash2 { 0% { opacity: 0 } 10% { opacity: .45 } 30% { opacity: .05 } 45% { opacity: .3 } 100% { opacity: 0 } }
.hw-bolt { position: absolute; z-index: 8; left: 14%; top: 0; width: min(26vmin, 220px); height: 62vh; opacity: 0; pointer-events: none; filter: drop-shadow(0 0 10px #c9b8ff) drop-shadow(0 0 30px #8b6cff); }
.hw-bolt path { fill: none; stroke: #fff; stroke-width: 3.2; stroke-linejoin: bevel; stroke-dasharray: 900; stroke-dashoffset: 900; }
.hw-bolt.go { animation: hw-bolt .9s ease-out; } .hw-bolt.go path { animation: hw-boltd .18s linear forwards; }
@keyframes hw-bolt { 0% { opacity: 1 } 60% { opacity: 1 } 100% { opacity: 0 } }
@keyframes hw-boltd { to { stroke-dashoffset: 0 } }

/* Murcielagos, fantasmas, arana */
.hw-bat { position: absolute; z-index: 5; left: 0; top: 0; width: 64px; height: 32px; margin: -16px 0 0 -32px; pointer-events: none; opacity: 0; will-change: transform; }
.hw-bat svg { width: 100%; height: 100%; display: block; animation: hw-flap .16s ease-in-out infinite alternate; transform-origin: 50% 40%; filter: drop-shadow(0 0 2px rgba(200,170,255,.9)) drop-shadow(0 0 8px rgba(140,90,255,.55)); }
@keyframes hw-flap { from { transform: scaleY(1) } to { transform: scaleY(.3) } }
.hw-ghost { position: absolute; z-index: 5; width: min(15vmin, 120px); opacity: 0; pointer-events: none; filter: drop-shadow(0 0 18px rgba(200,190,255,.65)); }
.hw-ghost svg { width: 100%; display: block; }
.hw-g1 { left: 6%; bottom: 18%; } .hw-g2 { right: 7%; bottom: 30%; width: min(11vmin, 90px); }
#n360-welcome.hw-ghosts .hw-g1 { animation: hw-ghost1 5.5s ease-in-out forwards; }
#n360-welcome.hw-ghosts .hw-g2 { animation: hw-ghost2 5.5s ease-in-out .35s forwards; }
@keyframes hw-ghost1 { 0% { opacity: 0; transform: translate(-30px,60px) } 20% { opacity: .78 } 50% { transform: translate(30px,-40px) rotate(6deg) } 100% { opacity: .7; transform: translate(70px,-110px) rotate(-4deg) } }
@keyframes hw-ghost2 { 0% { opacity: 0; transform: translate(30px,60px) scaleX(-1) } 20% { opacity: .7 } 50% { transform: translate(-30px,-30px) scaleX(-1) rotate(-6deg) } 100% { opacity: .65; transform: translate(-60px,-100px) scaleX(-1) } }
.hw-web { position: absolute; z-index: 5; left: -2px; top: -2px; width: min(28vmin, 230px); opacity: .55; pointer-events: none; }
.hw-web path, .hw-web line { fill: none; stroke: rgba(230,225,255,.75); stroke-width: 1.2; stroke-dasharray: 400; stroke-dashoffset: 400; }
#n360-welcome.hw-spider .hw-web path, #n360-welcome.hw-spider .hw-web line { animation: hw-draw 1.8s ease forwards; }
@keyframes hw-draw { to { stroke-dashoffset: 0 } }
.hw-spi { position: absolute; z-index: 6; left: 22%; top: 0; width: 54px; pointer-events: none; transform: translateY(-60px); }
.hw-spi i { position: absolute; left: 50%; bottom: 92%; width: 1.5px; height: 100vh; background: rgba(230,225,255,.7); box-shadow: 0 0 4px rgba(200,180,255,.8); }
.hw-spi svg { width: 100%; display: block; filter: drop-shadow(0 0 3px rgba(210,190,255,.95)) drop-shadow(0 0 10px rgba(160,120,255,.7)); }

/* Centro: calabaza */
.hw-main { position: relative; z-index: 7; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 18px 4vh; }
.hw-pk { position: relative; width: var(--P); aspect-ratio: 200/180; flex: none; opacity: 0; transform: translateY(70px) scale(.5); }
#n360-welcome.hw-pk-on .hw-pk { animation: hw-rise 1s cubic-bezier(.2,1.5,.35,1) forwards; }
@keyframes hw-rise { 0% { opacity: 0; transform: translateY(70px) scale(.5) } 60% { opacity: 1 } 100% { opacity: 1; transform: none } }
.hw-pk svg { position: relative; width: 100%; height: 100%; display: block; overflow: visible; z-index: 1; }
.hw-pk::before { content: ''; position: absolute; inset: -55%; border-radius: 50%; z-index: 0; opacity: 0; pointer-events: none;
  background: radial-gradient(circle, rgba(255,140,30,.55) 0%, rgba(255,90,0,.25) 30%, transparent 62%); transition: opacity .6s ease; }
.hw-pk::after { content: ''; position: absolute; inset: -95%; z-index: 0; opacity: 0; pointer-events: none; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, rgba(255,170,60,.14) 0deg 6deg, transparent 6deg 18deg);
  -webkit-mask: radial-gradient(circle, #000 18%, transparent 62%); mask: radial-gradient(circle, #000 18%, transparent 62%); transition: opacity 1s ease; animation: hw-rays 22s linear infinite; }
@keyframes hw-rays { to { transform: rotate(360deg) } }
#n360-welcome.hw-lit .hw-pk::before { opacity: 1; animation: hw-glow 1.6s ease-in-out infinite; }
#n360-welcome.hw-lit .hw-pk::after { opacity: 1; }
@keyframes hw-glow { 0%,100% { transform: scale(1); opacity: .9 } 50% { transform: scale(1.08); opacity: 1 } }
.hw-face { opacity: 0; transition: opacity .25s ease; }
#n360-welcome.hw-lit .hw-face { opacity: 1; animation: hw-flicker 1.1s infinite; }
@keyframes hw-flicker { 0%,100% { opacity: 1 } 12% { opacity: .82 } 20% { opacity: 1 } 46% { opacity: .9 } 52% { opacity: .7 } 58% { opacity: 1 } 80% { opacity: .88 } }
#n360-welcome.hw-lit .hw-pk svg { filter: drop-shadow(0 0 22px rgba(255,120,20,.55)); }
#n360-welcome.hw-out .hw-face { animation: none; opacity: 0; transition: opacity .35s ease; }
#n360-welcome.hw-out .hw-pk::before, #n360-welcome.hw-out .hw-pk::after { opacity: 0; animation: none; transition: opacity .4s ease; }
.hw-smoke { position: absolute; left: 50%; top: 18%; width: 30%; aspect-ratio: 1; margin-left: -15%; border-radius: 50%; z-index: 2; pointer-events: none; opacity: 0;
  background: radial-gradient(circle, rgba(220,215,240,.55), transparent 65%); filter: blur(6px); }
#n360-welcome.hw-out .hw-smoke { animation: hw-smoke 1.1s ease-out forwards; }
@keyframes hw-smoke { 0% { opacity: .9; transform: translateY(0) scale(.6) } 100% { opacity: 0; transform: translateY(-120%) scale(2.4) } }

/* Marca y textos */
.hw-brand { position: relative; display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 2.2vh; }
.hw-logo { position: relative; width: clamp(42px, 7.5vmin, 76px); aspect-ratio: 1; opacity: 0; transform: scale(.4) rotate(-25deg); transition: opacity .6s ease, transform .9s cubic-bezier(.2,1.4,.3,1); }
.hw-logo img { width: 100%; height: 100%; object-fit: contain; display: block; filter: drop-shadow(0 0 10px rgba(139,61,255,.7)); }
.hw-hat { position: absolute; left: 4%; top: -70%; width: 96%; transform: rotate(-14deg); filter: drop-shadow(0 4px 6px rgba(0,0,0,.6)); }
#n360-welcome.hw-brand-on .hw-logo { opacity: 1; transform: none; }
.hw-name { font-size: clamp(34px, 7vmin, 72px); font-weight: 800; letter-spacing: -.035em; line-height: 1; display: flex; }
.hw-l { display: inline-block; opacity: 0; transform: translateY(.5em) rotate(8deg); filter: blur(6px); transition: opacity .5s ease, transform .7s cubic-bezier(.2,1.3,.3,1), filter .5s ease;
  text-shadow: 0 0 18px rgba(139,61,255,.75), 0 0 2px #fff; }
.hw-l.n { background: linear-gradient(180deg, #fff 0%, var(--or2) 50%, var(--or) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; text-shadow: none; filter: drop-shadow(0 0 12px rgba(255,120,20,.7)); }
.hw-l.on { opacity: 1; transform: none; filter: none; }
.hw-l.n.on { filter: drop-shadow(0 0 12px rgba(255,120,20,.7)); }
.hw-title { position: relative; margin: 1.6vh 0 0; font-family: 'Creepster', 'Impact', 'Arial Black', sans-serif; font-weight: 400; letter-spacing: .04em;
  font-size: clamp(40px, 10.5vmin, 116px); line-height: 1.05; color: var(--or); text-shadow: 0 0 22px rgba(255,110,10,.75), 0 4px 0 #5c1d00, 0 0 60px rgba(255,80,0,.45);
  opacity: 0; transform: scale(1.6); filter: blur(10px); }
#n360-welcome.hw-title-on .hw-title { animation: hw-slam .7s cubic-bezier(.2,1.4,.3,1) forwards, hw-breathe 2.2s ease-in-out .7s infinite; }
@keyframes hw-breathe { 0%,100% { text-shadow: 0 0 22px rgba(255,110,10,.75), 0 4px 0 #5c1d00, 0 0 60px rgba(255,80,0,.45) } 50% { text-shadow: 0 0 34px rgba(255,140,30,.95), 0 4px 0 #5c1d00, 0 0 110px rgba(255,90,0,.7) } }
@keyframes hw-slam { 0% { opacity: 0; transform: scale(1.6); filter: blur(10px) } 60% { opacity: 1; filter: blur(0) } 100% { opacity: 1; transform: none; filter: none } }
.hw-drip { position: absolute; top: 78%; width: .14em; border-radius: 0 0 .1em .1em; background: linear-gradient(180deg, var(--or), #c94a00); height: 0; box-shadow: 0 0 8px rgba(255,110,10,.6); }
.hw-drip::after { content: ''; position: absolute; left: 50%; bottom: -.12em; width: .2em; height: .2em; margin-left: -.1em; border-radius: 50%; background: #e05a00; }
#n360-welcome.hw-title-on .hw-drip { animation: hw-drip 2.6s cubic-bezier(.5,0,.6,1) forwards; }
@keyframes hw-drip { 0% { height: 0 } 100% { height: var(--h) } }
.hw-say { position: relative; width: min(760px, 92vw); height: clamp(34px, 5.6vh, 56px); margin-top: 3.4vh; }
.hw-say p { position: absolute; left: 0; right: 0; top: 0; margin: 0; font-size: clamp(20px, 4vmin, 40px); font-weight: 800; letter-spacing: -.02em; color: #f3e9ff;
  text-shadow: 0 0 16px rgba(139,61,255,.8); opacity: 0; transform: translateY(14px) scale(.96); filter: blur(4px); transition: opacity .35s ease, transform .5s cubic-bezier(.2,1.2,.3,1), filter .35s ease; }
.hw-say p.in { opacity: 1; transform: none; filter: none; }
.hw-say p.out { opacity: 0; transform: translateY(-12px); filter: blur(4px); }
.hw-say p.fin { color: var(--or2); text-shadow: 0 0 18px rgba(255,120,20,.85); }
.hw-greet { margin: .8vh 0 0; min-height: 22px; font-size: clamp(14px, 2vmin, 19px); font-weight: 600; color: rgba(243,233,255,.78); opacity: 0; transform: translateY(8px); transition: opacity .7s ease, transform .7s ease; }
.hw-greet.on { opacity: 1; transform: none; }

/* Progreso tipo "candy corn" y saltar */
.hw-foot { position: absolute; left: 0; right: 0; bottom: 0; z-index: 10; padding: 0 22px 16px; display: flex; align-items: center; gap: 12px; }
.hw-bar { flex: 1; height: 5px; border-radius: 5px; background: rgba(255,255,255,.1); overflow: hidden; }
.hw-fill { height: 100%; width: 0; border-radius: 5px; box-shadow: 0 0 14px rgba(255,120,20,.8);
  background: repeating-linear-gradient(115deg, #ff7a18 0 14px, #ffd166 14px 26px, #fff6e0 26px 34px); background-size: 200% 100%; animation: hw-candy 1s linear infinite; }
@keyframes hw-candy { to { background-position: -68px 0 } }
.hw-pct { font-size: 12px; font-weight: 700; color: rgba(255,214,160,.85); font-variant-numeric: tabular-nums; min-width: 3.2ch; text-align: right; }
.hw-skip { position: absolute; top: 20px; right: 20px; z-index: 11; padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(255,170,90,.35);
  background: rgba(20,8,38,.55); color: rgba(255,230,200,.9); font-size: 12.5px; font-weight: 700; font-family: inherit; cursor: pointer; opacity: 0;
  transition: opacity .5s ease 1s, background .2s; backdrop-filter: blur(4px); }
#n360-welcome.hw-on .hw-skip { opacity: 1; }
.hw-skip:hover { background: rgba(255,122,24,.25); color: #fff; }
.hw-skip:focus-visible { outline: 2px solid var(--or2); outline-offset: 3px; }
@media (max-width: 560px) { .hw-moon { right: -6%; top: 4%; } .hw-g2 { display: none; } .hw-g1 { bottom: 5%; left: 3%; } .hw-bolt { left: 4%; } .hw-skip { top: 14px; right: 14px; } .hw-spi { left: 14%; } }
@media (max-height: 560px) { #n360-welcome.hw { --P: min(24vmin, 180px); } .hw-land { height: 30vh; } }
/* Reducir animaciones: composicion final fija */
#n360-welcome.hw-quieto *, #n360-welcome.hw-quieto *::before, #n360-welcome.hw-quieto *::after { animation: none !important; transition: none !important; }
#n360-welcome.hw-quieto .hw-pk, #n360-welcome.hw-quieto .hw-moon, #n360-welcome.hw-quieto .hw-land, #n360-welcome.hw-quieto .hw-logo,
#n360-welcome.hw-quieto .hw-l, #n360-welcome.hw-quieto .hw-title, #n360-welcome.hw-quieto .hw-greet, #n360-welcome.hw-quieto .hw-skip,
#n360-welcome.hw-quieto .hw-face, #n360-welcome.hw-quieto .hw-fog { opacity: 1; transform: none; filter: none; }
#n360-welcome.hw-quieto .hw-pk::before { opacity: 1; }
#n360-welcome.hw-quieto .hw-drip { height: var(--h); }
`;
    document.head.appendChild(style);

    /* ---------- Marcado ---------- */
    var BAT = '<svg viewBox="0 0 64 32" aria-hidden="true"><path fill="#0a0612" d="M32 9c1.6-3 2.4-4.6 2.6-6.4 1 1.8 1.4 3.4 1.2 5.2 4-3.6 9.6-6 16.4-5.8-3 1.6-4.6 3.6-5 6.2 4.4-1.4 9.4-.8 14.8 2.2-4.4.4-7.6 2.4-9.4 6-3-1.6-6.4-1.6-9.6.6-.4-3-2.6-4.6-5.6-4.6-1.8 1.6-3.4 4.4-5.4 8.6-2-4.2-3.6-7-5.4-8.6-3 0-5.2 1.6-5.6 4.6-3.2-2.2-6.6-2.2-9.6-.6-1.8-3.6-5-5.6-9.4-6 5.4-3 10.4-3.6 14.8-2.2-.4-2.6-2-4.6-5-6.2 6.8-.2 12.4 2.2 16.4 5.8-.2-1.8.2-3.4 1.2-5.2.2 1.8 1 3.4 2.6 6.4z"/><circle cx="30" cy="11" r=".9" fill="#ff6a00"/><circle cx="34" cy="11" r=".9" fill="#ff6a00"/></svg>';
    var GHOST = '<svg viewBox="0 0 100 120" aria-hidden="true"><defs><linearGradient id="hwGg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#d9d2ff" stop-opacity=".55"/></linearGradient></defs><path fill="url(#hwGg)" d="M50 4C26 4 12 22 12 48v62l10-10 10 12 9-11 9 11 9-11 9 11 10-12 10 10V48C88 22 74 4 50 4z"/><ellipse cx="38" cy="46" rx="6" ry="9" fill="#1b0f2e"/><ellipse cx="62" cy="46" rx="6" ry="9" fill="#1b0f2e"/><ellipse cx="50" cy="70" rx="7" ry="9" fill="#1b0f2e"/></svg>';
    var SPIDER = '<svg viewBox="0 0 40 40" aria-hidden="true"><g stroke="#0a0612" stroke-width="2.2" fill="none" stroke-linecap="round"><path d="M14 18 4 10M14 21 2 20M14 24 4 32M15 26 8 38M26 18 36 10M26 21 38 20M26 24 36 32M25 26 32 38"/></g><ellipse cx="20" cy="24" rx="8" ry="9" fill="#0a0612"/><circle cx="20" cy="14" r="5.5" fill="#0a0612"/><circle cx="18" cy="13" r="1.1" fill="#ff3b3b"/><circle cx="22" cy="13" r="1.1" fill="#ff3b3b"/></svg>';
    var WEB = '<svg viewBox="0 0 200 200" aria-hidden="true"><line x1="0" y1="0" x2="200" y2="0"/><line x1="0" y1="0" x2="190" y2="70"/><line x1="0" y1="0" x2="150" y2="150"/><line x1="0" y1="0" x2="70" y2="190"/><line x1="0" y1="0" x2="0" y2="200"/>' +
      [40, 80, 120, 160].map(function (r) { return '<path d="M' + r + ' 0 Q' + (r * .92) + ' ' + (r * .2) + ' ' + (r * .94) + ' ' + (r * .34) + ' Q' + (r * .78) + ' ' + (r * .55) + ' ' + (r * .71) + ' ' + (r * .71) + ' Q' + (r * .5) + ' ' + (r * .8) + ' ' + (r * .34) + ' ' + (r * .94) + ' Q' + (r * .2) + ' ' + (r * .92) + ' 0 ' + r + '"/>'; }).join('') + '</svg>';
    var HAT = '<svg viewBox="0 0 100 70" aria-hidden="true"><path d="M30 52 C38 30 46 10 70 2 C62 14 60 30 64 52 Z" fill="#1a0b2e" stroke="#8b3dff" stroke-width="1.5"/><path d="M28 46 h38 v8 h-38z" fill="#ff7a18"/><ellipse cx="48" cy="56" rx="46" ry="9" fill="#1a0b2e" stroke="#8b3dff" stroke-width="1.5"/><rect x="42" y="45.5" width="9" height="9" rx="1.5" fill="none" stroke="#ffd166" stroke-width="2"/></svg>';
    var PUMPKIN = '<svg viewBox="0 0 200 180" aria-hidden="true"><defs>' +
      '<radialGradient id="hwP1" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="#ffb14a"/><stop offset=".55" stop-color="#f57a12"/><stop offset="1" stop-color="#a83e00"/></radialGradient>' +
      '<radialGradient id="hwP2" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#ff9a2e"/><stop offset="1" stop-color="#b84800"/></radialGradient>' +
      '<radialGradient id="hwFire" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".35" stop-color="#ffe066"/><stop offset=".75" stop-color="#ffa21f"/><stop offset="1" stop-color="#ff5a00"/></radialGradient>' +
      '<linearGradient id="hwStem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a8f3a"/><stop offset="1" stop-color="#3d4a14"/></linearGradient></defs>' +
      '<path d="M96 30 C94 18 98 8 110 2 C112 8 106 14 108 30 Z" fill="url(#hwStem)"/>' +
      '<path d="M108 14 C122 4 136 8 140 18 C130 14 122 16 114 22" fill="none" stroke="#5c6e22" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="52" cy="100" rx="44" ry="66" fill="url(#hwP2)"/><ellipse cx="148" cy="100" rx="44" ry="66" fill="url(#hwP2)"/>' +
      '<ellipse cx="74" cy="100" rx="42" ry="72" fill="url(#hwP1)"/><ellipse cx="126" cy="100" rx="42" ry="72" fill="url(#hwP1)"/>' +
      '<ellipse cx="100" cy="100" rx="38" ry="76" fill="url(#hwP1)"/>' +
      '<path d="M100 28 C94 60 94 140 100 174 M74 30 C62 64 62 136 74 170 M126 30 C138 64 138 136 126 170" fill="none" stroke="rgba(120,45,0,.35)" stroke-width="2.4"/>' +
      '<g class="hw-face">' +
        '<path d="M52 78 L80 72 L70 100 Z" fill="url(#hwFire)"/><path d="M148 78 L120 72 L130 100 Z" fill="url(#hwFire)"/>' +
        '<path d="M100 98 L91 114 L109 114 Z" fill="url(#hwFire)"/>' +
        '<path d="M44 122 Q100 168 156 122 L146 124 L138 136 L128 128 L118 142 L108 132 L100 146 L92 132 L82 142 L72 128 L62 136 L54 124 Z" fill="url(#hwFire)"/>' +
      '</g>' +
      '<g class="hw-face" opacity=".55"><path d="M52 78 L80 72 L70 100 Z M148 78 L120 72 L130 100 Z" fill="none" stroke="#fff3c4" stroke-width="1.2"/></g>' +
      '</svg>';
    var LAND = '<svg class="hw-land" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
      '<path fill="#14081f" d="M0 250 Q200 190 380 230 T760 220 T1180 200 T1600 230 V420 H0Z"/>' +
      // casa embrujada
      '<g fill="#0b0414"><path d="M170 300 V170 L240 110 L310 170 V300Z"/><path d="M230 112 V60 h20 v62Z"/><path d="M290 210 V130 L330 95 L370 130 V300 H290Z"/><path d="M322 98 L330 40 L338 98Z"/>' +
      '<path d="M120 300 V220 L160 190 L200 220 V300Z"/></g>' +
      '<rect class="hw-win" x="205" y="190" width="18" height="26" rx="2"/><rect class="hw-win b" x="255" y="190" width="18" height="26" rx="2"/><rect class="hw-win c" x="320" y="150" width="20" height="28" rx="10"/>' +
      '<rect class="hw-win b" x="150" y="235" width="14" height="18" rx="2"/><rect class="hw-win" x="232" y="250" width="16" height="50" rx="2" style="fill:#ff8a1f"/>' +
      // arbol muerto
      '<path fill="#0b0414" d="M1290 330 C1296 270 1288 220 1300 170 C1270 150 1250 120 1238 92 C1262 112 1282 128 1300 140 C1300 110 1292 84 1300 52 C1310 86 1312 112 1310 140 C1330 110 1352 96 1380 90 C1352 110 1334 132 1320 160 C1340 160 1372 150 1400 132 C1372 166 1340 180 1318 186 C1314 236 1320 284 1328 330 Z"/>' +
      // tumbas y cerca
      '<g fill="#0e0618"><path d="M560 330 V286 a26 26 0 0 1 52 0 V330Z"/><path d="M660 330 V296 a20 20 0 0 1 40 0 V330Z"/><path d="M980 330 V280 h12 v-16 h12 v16 h12 v50Z"/><path d="M1060 330 V294 a22 22 0 0 1 44 0 V330Z"/></g>' +
      '<g stroke="#0e0618" stroke-width="7"><path d="M720 300 H940"/><path d="M730 330 V286 M760 330 V282 M790 330 V286 M820 330 V282 M850 330 V286 M880 330 V282 M910 330 V286"/></g>' +
      '<path fill="#090311" d="M0 330 Q400 300 800 320 T1600 310 V420 H0Z"/>' +
      '</svg>';
    var BOLT = '<svg class="hw-bolt" viewBox="0 0 120 400" aria-hidden="true"><path d="M70 0 L52 92 L74 96 L40 190 L66 194 L22 312 L48 316 L18 400"/><path d="M52 92 L28 140 M40 190 L70 236" style="stroke-width:1.6"/></svg>';
    var letras = 'Negocio'.split('').map(function (c) { return '<span class="hw-l">' + c + '</span>'; }).join('') +
                 '360'.split('').map(function (c) { return '<span class="hw-l n">' + c + '</span>'; }).join('');
    var drips = [[8, 22], [23, 34], [41, 18], [57, 40], [72, 26], [88, 30]].map(function (d) { return '<i class="hw-drip" style="left:' + d[0] + '%;--h:' + (d[1] / 60).toFixed(2) + 'em"></i>'; }).join('');
    var bats = ''; for (var b = 0; b < 12; b++) bats += '<div class="hw-bat" data-b="' + b + '">' + BAT + '</div>';

    var cont = document.createElement('div');
    cont.innerHTML =
      '<div id="n360-welcome" class="hw" role="dialog" aria-modal="true" aria-label="Bienvenido a Negocio360">' +
        '<div class="hw-world"><div class="hw-cam">' +
          '<canvas class="hw-cv hw-sky"></canvas>' +
          '<div class="hw-moon"></div><div class="hw-cloud hw-c1"></div><div class="hw-cloud hw-c2"></div>' +
          LAND + '<div class="hw-fog hw-f1"></div><div class="hw-fog hw-f2"></div>' +
          '<div class="hw-web">' + WEB + '</div><div class="hw-spi"><i></i>' + SPIDER + '</div>' +
          '<div class="hw-ghost hw-g1">' + GHOST + '</div><div class="hw-ghost hw-g2">' + GHOST + '</div>' + bats +
          BOLT +
          '<div class="hw-main">' +
            '<div class="hw-pk">' + PUMPKIN + '<div class="hw-smoke"></div></div>' +
            '<div class="hw-brand"><div class="hw-logo"><img src="negocio360-isotipo.png" alt=""><div class="hw-hat">' + HAT + '</div></div><h1 class="hw-name" aria-label="Negocio360" style="margin:0">' + letras + '</h1></div>' +
            '<div class="hw-title" aria-hidden="true">¡Feliz Halloween!' + drips + '</div>' +
            '<div class="hw-say" aria-hidden="true"><p>Controla tu negocio</p><p>Vende más</p><p class="fin">Gana más 🎃</p></div>' +
            '<p class="hw-greet" id="hwGreet"></p>' +
          '</div>' +
          '<canvas class="hw-cv hw-fx"></canvas>' +
        '</div><div class="hw-vig"></div><div class="hw-grain"></div></div>' +
        '<div class="hw-flash"></div>' +
        '<div class="hw-foot"><div class="hw-bar"><div class="hw-fill" id="hwFill"></div></div><span class="hw-pct" id="hwPct">0%</span></div>' +
        '<button type="button" class="hw-skip" id="hwSkip">Saltar</button>' +
      '</div>';
    var el = cont.firstElementChild;
    document.body.appendChild(el);

    /* ---------- Control ---------- */
    var $ = function (s) { return el.querySelector(s); };
    var timers = [], raf = 0, cerrada = false, t0 = 0;
    var world = $('.hw-world'), flash = $('.hw-flash'), bolt = $('.hw-bolt'), fillEl = $('#hwFill'), pctEl = $('#hwPct'), greet = $('#hwGreet');
    var frases = Array.prototype.slice.call(el.querySelectorAll('.hw-say p'));
    var spi = $('.hw-spi'), pk = $('.hw-pk');
    var batEls = Array.prototype.slice.call(el.querySelectorAll('.hw-bat'));
    function agenda(ms, fn) { timers.push(setTimeout(function () { if (!cerrada) { try { fn(); } catch (e) { /* un paso no rompe el resto */ } } }, ms)); }
    function mostrarFrase(i) { frases.forEach(function (p, j) { if (j === i) { p.classList.remove('out'); p.classList.add('in'); } else if (p.classList.contains('in')) { p.classList.remove('in'); p.classList.add('out'); } }); }
    (function () { var h = new Date().getHours(); greet.textContent = (h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches')) + ' · ¡Que tengas una noche de muchas ventas!'; })();

    function quitar() {
      if (el.parentNode) el.parentNode.removeChild(el);
      var s = document.getElementById('n360-welcome-style'); if (s && s.parentNode) s.parentNode.removeChild(s);
    }
    function cerrar(rapido) {
      if (cerrada) return;
      cerrada = true; timers.forEach(clearTimeout); cancelAnimationFrame(raf);
      document.removeEventListener('keydown', alTeclado);
      el.classList.add('hw-exit'); setTimeout(quitar, rapido ? 600 : 1000);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(true); }
    $('#hwSkip').addEventListener('click', function () { cerrar(true); });
    document.addEventListener('keydown', alTeclado);
    setTimeout(function () { if (!cerrada) { cerrada = true; quitar(); } }, T.seguridad);   // cierre de seguridad

    if (REDUCIDO) {
      el.classList.add('hw-on', 'hw-quieto', 'hw-pk-on', 'hw-lit', 'hw-brand-on', 'hw-title-on');
      el.querySelectorAll('.hw-l').forEach(function (l) { l.classList.add('on'); });
      frases[2].classList.add('in'); greet.classList.add('on'); fillEl.style.width = '100%'; pctEl.textContent = '100%';
      setTimeout(function () { cerrar(true); }, 2200);
      return;
    }

    /* Cielo (estrellas) y efectos (chispas de la vela, polvo de luna) en canvas */
    var sky = $('canvas.hw-sky'), fx = $('canvas.hw-fx'), cs = null, cf = null, W = 0, H = 0, ST = [], EM = [], DUST = [];
    try {
      var dpr = Math.min(window.devicePixelRatio || 1, 2); W = el.clientWidth; H = el.clientHeight;
      [sky, fx].forEach(function (c) { c.width = W * dpr; c.height = H * dpr; });
      cs = sky.getContext('2d'); cf = fx.getContext('2d');
      cs && cs.setTransform(dpr, 0, 0, dpr, 0, 0); cf && cf.setTransform(dpr, 0, 0, dpr, 0, 0);
      var nS = Math.max(60, Math.min(170, Math.floor(W * H / 9000)));
      for (var i = 0; i < nS; i++) ST.push({ x: Math.random() * W, y: Math.random() * H * .7, r: Math.random() * 1.2 + .3, f: Math.random() * 6.28, s: .6 + Math.random() * 2.2 });
      for (var k = 0; k < 40; k++) DUST.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .25, vy: -(.1 + Math.random() * .25), r: Math.random() * 1.6 + .4, a: Math.random() * .5 + .15 });
    } catch (e) { cs = cf = null; }
    var stars = 0, embersOn = false, emAcc = 0;
    function centroCalabaza() { var r = pk.getBoundingClientRect(), b = el.getBoundingClientRect(); return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height * .58, w: r.width }; }

    /* Murcielagos: cada uno sigue una curva con su propio tiempo */
    var VUELOS = [];
    function bandada(t, desdeLuna, n, ini) {
      var moon = $('.hw-moon').getBoundingClientRect(), b = el.getBoundingClientRect();
      var mx = moon.left - b.left + moon.width / 2, my = moon.top - b.top + moon.height / 2;
      for (var i = 0; i < n; i++) {
        var be = batEls[(ini + i) % batEls.length];
        var dir = Math.random() < .5 ? -1 : 1;
        var x0 = desdeLuna ? mx + (Math.random() - .5) * 40 : (dir > 0 ? -60 : W + 60), y0 = desdeLuna ? my + (Math.random() - .5) * 30 : H * (.12 + Math.random() * .35);
        var x1 = desdeLuna ? (Math.random() < .6 ? -80 : W + 80) * 1 : (dir > 0 ? W + 80 : -80), y1 = desdeLuna ? H * (.05 + Math.random() * .5) : y0 + (Math.random() - .5) * H * .3;
        VUELOS.push({ el: be, t: t + i * 110, d: 2300 + Math.random() * 1400, x0: x0, y0: y0, x1: x1, y1: y1, amp: 30 + Math.random() * 60, fr: 2 + Math.random() * 3, s0: desdeLuna ? .2 : .7, s1: .9 + Math.random() * .7 });
      }
    }

    function cuadro(now) {
      if (cerrada) return;
      var t = now - t0;
      // estrellas
      if (cs) {
        stars = Math.min(1, t / 1400); cs.clearRect(0, 0, W, H);
        for (var i = 0; i < ST.length; i++) { var s = ST[i]; var a = stars * (.35 + .65 * (.5 + .5 * Math.sin(s.f + t / 1000 * s.s))); cs.fillStyle = 'rgba(255,245,230,' + a.toFixed(3) + ')'; cs.beginPath(); cs.arc(s.x, s.y, s.r, 0, 6.2832); cs.fill(); }
      }
      // chispas y polvo
      if (cf) {
        cf.clearRect(0, 0, W, H);
        for (var d = 0; d < DUST.length; d++) { var q = DUST[d]; q.x += q.vx; q.y += q.vy; if (q.y < -10) { q.y = H + 10; q.x = Math.random() * W; } cf.fillStyle = 'rgba(200,170,255,' + (q.a * stars).toFixed(3) + ')'; cf.beginPath(); cf.arc(q.x, q.y, q.r, 0, 6.2832); cf.fill(); }
        if (embersOn) {
          emAcc += 1; if (emAcc % 2 === 0 && EM.length < 90) { var c = centroCalabaza(); EM.push({ x: c.x + (Math.random() - .5) * c.w * .45, y: c.y, vx: (Math.random() - .5) * .9, vy: -(1.2 + Math.random() * 2.2), life: 1, r: 1 + Math.random() * 2.2 }); }
        }
        for (var e = EM.length - 1; e >= 0; e--) {
          var m = EM[e]; m.x += m.vx + Math.sin((t + e * 90) / 260) * .35; m.y += m.vy; m.vy *= .992; m.life -= .012;
          if (m.life <= 0) { EM.splice(e, 1); continue; }
          var gr = cf.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 4); gr.addColorStop(0, 'rgba(255,240,180,' + m.life.toFixed(3) + ')'); gr.addColorStop(.35, 'rgba(255,150,40,' + (m.life * .8).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,80,0,0)');
          cf.fillStyle = gr; cf.beginPath(); cf.arc(m.x, m.y, m.r * 4, 0, 6.2832); cf.fill();
        }
      }
      // murcielagos
      for (var v = 0; v < VUELOS.length; v++) {
        var f = VUELOS[v], k = (t - f.t) / f.d;
        if (k < 0 || k > 1) { if (k > 1) f.el.style.opacity = 0; continue; }
        var ee = k * k * (3 - 2 * k), x = f.x0 + (f.x1 - f.x0) * ee, y = f.y0 + (f.y1 - f.y0) * ee + Math.sin(k * Math.PI * f.fr) * f.amp, sc = f.s0 + (f.s1 - f.s0) * Math.min(1, k * 2.2);
        f.el.style.opacity = Math.min(1, k * 6, (1 - k) * 6);
        f.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + sc.toFixed(2) + ') scaleX(' + (f.x1 < f.x0 ? -1 : 1) + ')';
      }
      // arana bajando y columpiandose
      if (t > T.arana) { var ka = Math.min(1, (t - T.arana) / 1600), ea = 1 - Math.pow(1 - ka, 3); spi.style.transform = 'translateY(' + (-60 + ea * H * .26).toFixed(1) + 'px) rotate(' + (Math.sin(t / 420) * 6).toFixed(2) + 'deg)'; }
      // progreso
      var g = Math.min(1, t / T.salir), gp = 1 - Math.pow(1 - g, 1.6); fillEl.style.width = (gp * 100).toFixed(1) + '%'; pctEl.textContent = Math.round(gp * 100) + '%';
      raf = requestAnimationFrame(cuadro);
    }

    function rayo(fuerte) {
      flash.classList.remove('go', 'soft'); void flash.offsetWidth; flash.classList.add(fuerte ? 'go' : 'soft');
      if (fuerte) {
        bolt.classList.remove('go'); void bolt.offsetWidth; bolt.classList.add('go');
        world.classList.remove('hw-shake'); void world.offsetWidth; world.classList.add('hw-shake');
      }
    }

    t0 = performance.now();
    raf = requestAnimationFrame(cuadro);
    requestAnimationFrame(function () { el.classList.add('hw-on'); });
    agenda(T.bats1, function () { bandada(performance.now() - t0, true, 7, 0); });
    agenda(T.rayo, function () { rayo(true); });
    agenda(T.calabaza, function () { el.classList.add('hw-pk-on'); });
    agenda(T.vela, function () { el.classList.add('hw-lit'); embersOn = true; });
    agenda(T.fantasmas, function () { el.classList.add('hw-ghosts'); });
    agenda(T.arana, function () { el.classList.add('hw-spider'); });
    agenda(T.marca, function () { el.classList.add('hw-brand-on'); el.querySelectorAll('.hw-l').forEach(function (l, i) { l.style.transitionDelay = (i * 55) + 'ms'; l.classList.add('on'); }); });
    agenda(T.titulo, function () { el.classList.add('hw-title-on'); });
    agenda(T.bats2, function () { bandada(performance.now() - t0, false, 5, 7); });
    agenda(T.fraseA, function () { mostrarFrase(0); });
    agenda(T.rayo2, function () { rayo(false); });
    agenda(T.fraseB, function () { mostrarFrase(1); });
    agenda(T.fraseC, function () { mostrarFrase(2); });
    agenda(T.saludo, function () { greet.classList.add('on'); });
    agenda(T.salir - 500, function () { el.classList.add('hw-out'); embersOn = false; });
    agenda(T.salir, function () { cerrar(false); });
  }

  try {
    // 1. Solo en las pantallas de ENTRADA al sistema.
    var archivo = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
    var esEntrada = ['dashboard.html', 'bodega.html', 'catalogo360.html', 'admin.html']
      .some(function (p) { return archivo.indexOf(p.replace('.html', '')) === 0; });
    if (!esEntrada) return;

    // 2. Ya se vio en esta sesion: no se repite al navegar (clave POR usuario).
    var clave = 'n360_welcome_visto';
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('-auth-token') !== -1) {
          var tok = JSON.parse(localStorage.getItem(k));
          var uid = tok && tok.user && tok.user.id;
          if (uid) { clave = 'n360_welcome_visto_' + uid; break; }
        }
      }
    } catch (_) { /* clave generica */ }
    try {
      if (sessionStorage.getItem(clave) === '1') return;
      sessionStorage.setItem(clave, '1');
    } catch (_) { /* si sessionStorage falla, simplemente se muestra */ }

    var ROSA = false;
    try { ROSA = new Date().getMonth() === 9; } catch (_) {}      // octubre = mes 9
    var REDUCIDO = false;
    try { REDUCIDO = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}

    // Temporada de Halloween (20 oct – 2 nov): escena propia, mismas reglas.
    if (esHalloween()) { escenaHalloween(REDUCIDO); return; }

    /* ---------------- Tiempos (ms) ---------------- */
    var T = {
      logo: 150, causa: 1500, cuentaIni: 800, cuentaFin: 3500, letras: 450, modulos: 1100, modPaso: 260,
      fraseA: 3900, fraseB: 4750, fraseC: 5600, saludo: 6450, salir: 7600, quitar: 8550, seguridad: 10000
    };

    /* ---------------- Estilos ---------------- */
    var style = document.createElement('style');
    style.id = 'n360-welcome-style';
    style.textContent = `
#n360-welcome {
  --bg0: #060a18; --bg1: #0d1738; --glow: rgba(37,99,235,.34);
  --a1: #7fb0ff; --a2: #2563eb; --line: rgba(127,176,255,.34); --beam: rgba(96,150,255,.5);
  --soft: rgba(255,255,255,.64); --S: min(400px, 62vw, 45vh);
  position: fixed; inset: 0; z-index: 100000; overflow: hidden; color: #fff; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
  background:
    radial-gradient(ellipse 62% 52% at 50% 44%, var(--glow) 0%, transparent 72%),
    radial-gradient(ellipse at 50% 40%, var(--bg1) 0%, var(--bg0) 62%, #02030a 100%);
  clip-path: circle(150% at 50% 50%);
  transition: clip-path .85s cubic-bezier(.65,0,.3,1), opacity .35s ease .6s;
}
#n360-welcome.nw-rosa {
  --bg0: #14050f; --bg1: #331027; --glow: rgba(236,72,153,.36);
  --a1: #ffb3d9; --a2: #ec4899; --line: rgba(255,160,210,.38); --beam: rgba(255,120,185,.52);
  --soft: rgba(255,232,243,.7);
}
#n360-welcome.nw-exit { opacity: 0; pointer-events: none; transition: opacity .8s ease !important; }
#n360-welcome *, #n360-welcome *::before, #n360-welcome *::after { box-sizing: border-box; }

#n360-welcome canvas.nw-net { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 1.4s ease .2s; }
#n360-welcome.nw-on canvas.nw-net { opacity: .85; }

/* Vineta: oscurece los bordes para dar profundidad */
.nw-vig { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 46%, transparent 52%, rgba(0,0,0,.55) 100%); }

/* Ondas tipo sonar que salen del centro */
.nw-sonar { position: absolute; inset: 19.5%; border-radius: 50%; border: 1px solid var(--line); opacity: 0; pointer-events: none; }
#n360-welcome.nw-on .nw-sonar { animation: nw-sonar 3.6s cubic-bezier(.2,.6,.3,1) infinite; }
#n360-welcome.nw-on .nw-sonar:nth-of-type(2) { animation-delay: 1.2s; }
#n360-welcome.nw-on .nw-sonar:nth-of-type(3) { animation-delay: 2.4s; }
@keyframes nw-sonar { 0% { opacity: .5; transform: scale(.55); } 100% { opacity: 0; transform: scale(2.3); } }

.nw-main { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 0 20px; transition: opacity .45s ease, transform .6s cubic-bezier(.5,0,.3,1); }
#n360-welcome.nw-exit .nw-main { transform: scale(1.03); transition: transform .8s ease; }

/* ---------- Dial ---------- */
.nw-stage { position: relative; width: var(--S); height: var(--S); flex: none; }
.nw-sweep { position: absolute; inset: 19%; border-radius: 50%; opacity: 0; transition: opacity .6s ease;
  background: conic-gradient(from 0deg, transparent 0deg, transparent 250deg, var(--beam) 360deg);
  -webkit-mask: radial-gradient(circle, transparent 0 27%, #000 28% 100%); mask: radial-gradient(circle, transparent 0 27%, #000 28% 100%); }
#n360-welcome.nw-count .nw-sweep { opacity: 1; }
#n360-welcome.nw-lock .nw-sweep { opacity: 0; transition-duration: .9s; }
.nw-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.nw-ring { fill: none; stroke: var(--line); stroke-width: 1; opacity: 0; transition: opacity .8s ease .1s; }
.nw-ring-dash { fill: none; stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 7; opacity: 0; transform-origin: 200px 200px;
  transition: opacity 1s ease .3s; animation: nw-spin 48s linear infinite; }
#n360-welcome.nw-on .nw-ring, #n360-welcome.nw-on .nw-ring-dash { opacity: 1; }
@keyframes nw-spin { to { transform: rotate(360deg); } }
.nw-tick { stroke: rgba(255,255,255,.16); stroke-width: 1.4; stroke-linecap: round; transition: stroke .25s ease, stroke-width .25s ease; }
.nw-tick.nw-big { stroke: rgba(255,255,255,.3); stroke-width: 2; }
.nw-tick.nw-lit { stroke: var(--a1); }
.nw-tick.nw-big.nw-lit { stroke: #fff; }
.nw-burst { fill: none; stroke: var(--a1); stroke-width: 2; opacity: 0; transform-origin: 200px 200px; }
#n360-welcome.nw-lock .nw-burst { animation: nw-burst 1.1s cubic-bezier(.2,.7,.3,1) forwards; }
@keyframes nw-burst { 0% { opacity: .9; transform: scale(.92); } 100% { opacity: 0; transform: scale(1.35); } }
.nw-link { stroke: var(--line); stroke-width: 1; stroke-dasharray: 40; stroke-dashoffset: 40; opacity: 0; transition: stroke-dashoffset .5s ease, opacity .3s ease; }
.nw-link.on { stroke-dashoffset: 0; opacity: 1; }

.nw-logo { position: absolute; left: 50%; top: 50%; width: 29%; aspect-ratio: 1; margin: -14.5% 0 0 -14.5%; z-index: 3; }
.nw-logo::before { content: ''; position: absolute; inset: -38%; border-radius: 50%; pointer-events: none; opacity: 0;
  background: radial-gradient(circle, var(--glow) 0%, var(--glow) 14%, transparent 62%); transition: opacity 1.1s ease; }
#n360-welcome.nw-on .nw-logo::before { opacity: 1; }
#n360-welcome.nw-lock .nw-logo::before { animation: nw-halo 1.2s ease-out; }
@keyframes nw-halo { 0% { opacity: 1; transform: scale(1); } 35% { opacity: 1; transform: scale(1.18); } 100% { opacity: 1; transform: scale(1); } }
.nw-logo img { position: relative; width: 100%; height: 100%; object-fit: contain; display: block; background: transparent;
  opacity: 0; transform: scale(.55) rotate(-18deg);
  transition: opacity .9s ease, transform 1.1s cubic-bezier(.18,.9,.28,1.2); }
#n360-welcome.nw-on .nw-logo img { opacity: 1; transform: scale(1) rotate(0); }
#n360-welcome.nw-lock .nw-logo img { animation: nw-pulse 1.2s ease-out; }
@keyframes nw-pulse { 0% { transform: scale(1); } 35% { transform: scale(1.06); } 100% { transform: scale(1); } }
/* Marcador de inicio del dial: flecha (o lazo en Octubre Rosa) */
.nw-pin { position: absolute; left: 50%; top: 1.6%; width: 6%; margin-left: -3%; z-index: 4; opacity: 0; transition: opacity .6s ease .5s; }
#n360-welcome.nw-on .nw-pin { opacity: 1; }
.nw-pin svg { width: 100%; display: block; }
.nw-rosa .nw-pin { width: 11%; margin-left: -5.5%; top: -1%; animation: nw-bob 2.4s ease-in-out infinite; }
@keyframes nw-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
.nw-pin-flecha { display: block; } .nw-pin-lazo { display: none; }
.nw-rosa .nw-pin-flecha { display: none; } .nw-rosa .nw-pin-lazo { display: block; }

/* ---------- Modulos alrededor del dial ---------- */
.nw-chip { position: absolute; z-index: 4; width: 11.5%; aspect-ratio: 1; margin: -5.75% 0 0 -5.75%;
  display: flex; align-items: center; justify-content: center; border-radius: 50%;
  background: rgba(255,255,255,.07); border: 1px solid var(--line);
  opacity: 0; transform: scale(.4); transition: opacity .45s ease, transform .6s cubic-bezier(.2,.9,.3,1.35), box-shadow .5s ease; }
.nw-chip.on { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 var(--a2); animation: nw-chip-glow 1.2s ease-out; }
@keyframes nw-chip-glow { 0% { box-shadow: 0 0 0 0 var(--a2); } 100% { box-shadow: 0 0 0 14px rgba(255,255,255,0); } }
.nw-chip svg { width: 52%; height: 52%; fill: none; stroke: var(--a1); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.nw-chip span { position: absolute; font-size: 12px; font-weight: 600; color: var(--soft); white-space: nowrap; letter-spacing: .1px; }
.nw-chip[data-lado="r"] span { left: calc(100% + 9px); top: 50%; transform: translateY(-50%); }
.nw-chip[data-lado="l"] span { right: calc(100% + 9px); top: 50%; transform: translateY(-50%); }

/* ---------- Marca ---------- */
.nw-brand { margin: 22px 0 0; font-size: clamp(34px, 6.4vw, 54px); font-weight: 800; letter-spacing: -.035em; line-height: 1.05; color: #fff;
  display: flex; align-items: baseline; justify-content: center; }
.nw-l { display: inline-block; opacity: 0; transform: translateY(.55em); 
  transition: opacity .5s ease, transform .6s cubic-bezier(.2,.85,.3,1.1); }
.nw-l.on { opacity: 1; transform: none; }
.nw-num { display: inline-block; min-width: 3ch; text-align: left; font-variant-numeric: tabular-nums; margin-left: .04em;
  background: linear-gradient(180deg, #fff 0%, var(--a1) 55%, var(--a2) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  opacity: 0; transition: opacity .5s ease; }
#n360-welcome.nw-count .nw-num { opacity: 1; }
.nw-num i { font-style: normal; opacity: .28; }
#n360-welcome.nw-lock .nw-num { animation: nw-num-pop .7s cubic-bezier(.2,.9,.3,1.4); }
@keyframes nw-num-pop { 0% { transform: scale(1); } 40% { transform: scale(1.12); } 100% { transform: scale(1); } }
.nw-rule { width: 0; height: 1px; margin: 16px auto 0; background: linear-gradient(90deg, transparent, var(--a1), transparent); transition: width 1s cubic-bezier(.3,0,.2,1); }
#n360-welcome.nw-lock .nw-rule { width: min(240px, 60vw); }

/* ---------- Frases ---------- */
.nw-say { position: relative; width: min(560px, 92vw); height: 48px; margin-top: 14px; }
.nw-say p { position: absolute; left: 0; right: 0; top: 0; margin: 0; font-size: clamp(22px, 3.8vw, 32px); font-weight: 700; letter-spacing: -.02em; line-height: 1.2;
  opacity: 0; transform: translateY(14px); clip-path: inset(0 100% 0 0); transition: opacity .1s linear, transform .55s cubic-bezier(.2,.8,.3,1), clip-path .6s cubic-bezier(.3,0,.1,1); }
.nw-say p.in { opacity: 1; transform: none; clip-path: inset(-10% -2% -10% 0); }
.nw-say p.out { opacity: 0; transform: translateY(-12px); clip-path: inset(-10% -2% -10% 0); transition: opacity .35s ease, transform .4s ease; }
.nw-say p.fin { background: linear-gradient(92deg, #fff 0%, var(--a1) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

.nw-greet { margin: 6px 0 0; min-height: 22px; font-size: 15px; font-weight: 500; color: var(--soft); opacity: 0; transform: translateY(8px);
  transition: opacity .7s ease, transform .7s ease; }
.nw-greet.on { opacity: 1; transform: none; }
.nw-cause { display: none; align-items: center; justify-content: center; gap: 8px; margin: 10px 0 0; font-size: 15px; font-weight: 700; color: var(--a1);
  opacity: 0; transform: translateY(8px); transition: opacity .7s ease .25s, transform .7s ease .25s; }
.nw-rosa .nw-cause { display: flex; }
.nw-cause.on { opacity: 1; transform: none; }
.nw-cause span { text-wrap: balance; }
.nw-cause svg { width: 18px; height: 18px; flex: none; }

/* ---------- Progreso y control ---------- */
.nw-foot { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; padding: 0 22px 16px; display: flex; align-items: center; gap: 12px; }
.nw-bar { flex: 1; height: 3px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; }
.nw-bar-fill { height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, var(--a2), var(--a1)); box-shadow: 0 0 12px var(--a2); }
.nw-pct { font-size: 12px; font-weight: 600; color: var(--soft); font-variant-numeric: tabular-nums; min-width: 3.2ch; text-align: right; }
.nw-skip { position: absolute; top: 20px; right: 20px; z-index: 5; padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2);
  background: rgba(255,255,255,.07); color: rgba(255,255,255,.82); font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
  opacity: 0; transition: opacity .5s ease 1s, background .2s, border-color .2s; }
#n360-welcome.nw-on .nw-skip { opacity: 1; }
.nw-skip:hover { background: rgba(255,255,255,.16); border-color: rgba(255,255,255,.4); color: #fff; }
.nw-skip:focus-visible { outline: 2px solid var(--a1); outline-offset: 3px; }

@media (max-width: 520px) {
  #n360-welcome { --S: min(330px, 78vw, 42vh); }
  .nw-chip span { display: none; }
  .nw-skip { top: 14px; right: 14px; }
  .nw-greet { font-size: 14px; } .nw-cause { font-size: 12.5px; padding: 0 8px; }
}
@media (max-height: 560px) { #n360-welcome { --S: min(300px, 40vw, 40vh); } .nw-brand { margin-top: 10px; } }

/* Reducir animaciones: composicion final fija, sin movimiento */
#n360-welcome.nw-quieto *, #n360-welcome.nw-quieto *::before, #n360-welcome.nw-quieto *::after { animation: none !important; transition: none !important; }
#n360-welcome.nw-quieto .nw-l, #n360-welcome.nw-quieto .nw-num, #n360-welcome.nw-quieto .nw-chip, #n360-welcome.nw-quieto .nw-greet,
#n360-welcome.nw-quieto .nw-cause, #n360-welcome.nw-quieto .nw-logo img, #n360-welcome.nw-quieto .nw-skip { opacity: 1; transform: none; filter: none; }
#n360-welcome.nw-quieto .nw-logo::before { opacity: 1; }
#n360-welcome.nw-quieto .nw-link { stroke-dashoffset: 0; opacity: 1; }
#n360-welcome.nw-quieto .nw-sonar, #n360-welcome.nw-quieto .nw-sweep { display: none; }
`;

    /* ---------------- Marcado ---------------- */
    var LOGO = ROSA ? 'negocio360-isotipo-rosa.png' : 'negocio360-isotipo.png';
    style.textContent = style.textContent.split('__LOGO__').join(LOGO);
    document.head.appendChild(style);

    var MODULOS = [
      { n: 'Ventas', ang: -60, lado: 'r', ic: '<path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/>' },
      { n: 'Inventario', ang: 0, lado: 'r', ic: '<path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>' },
      { n: 'Caja', ang: 60, lado: 'r', ic: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>' },
      { n: 'Contabilidad', ang: 120, lado: 'l', ic: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2"/>' },
      { n: 'Clientes', ang: 180, lado: 'l', ic: '<path d="M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1a3 3 0 0 0-2-2.8M16 4.4a3.5 3.5 0 0 1 0 6.2"/>' },
      { n: 'Reportes', ang: 240, lado: 'l', ic: '<path d="M5 20v-9M12 20V5M19 20v-6"/>' }
    ];
    var RAD_C = 43;           // % del escenario donde viven los modulos
    var chips = '', links = '';
    MODULOS.forEach(function (m, idx) {
      var a = m.ang * Math.PI / 180;
      var x = 50 + RAD_C * Math.cos(a), y = 50 + RAD_C * Math.sin(a);
      chips += '<div class="nw-chip" data-i="' + idx + '" data-lado="' + m.lado + '" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + m.ic + '</svg><span>' + m.n + '</span></div>';
      // enlace del aro del dial (r=122 de 400) hasta el modulo (r=43% = 172)
      var x1 = 200 + 126 * Math.cos(a), y1 = 200 + 126 * Math.sin(a), x2 = 200 + 154 * Math.cos(a), y2 = 200 + 154 * Math.sin(a);
      links += '<line class="nw-link" data-i="' + idx + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    });
    var ticks = '';
    for (var t = 0; t < 72; t++) {
      var g = t * 5 * Math.PI / 180 - Math.PI / 2, grande = t % 6 === 0, r1 = grande ? 98 : 103, r2 = 111;
      ticks += '<line class="nw-tick' + (grande ? ' nw-big' : '') + '" x1="' + (200 + r1 * Math.cos(g)).toFixed(1) + '" y1="' + (200 + r1 * Math.sin(g)).toFixed(1) +
        '" x2="' + (200 + r2 * Math.cos(g)).toFixed(1) + '" y2="' + (200 + r2 * Math.sin(g)).toFixed(1) + '"/>';
    }
    var letras = 'Negocio'.split('').map(function (c) { return '<span class="nw-l">' + c + '</span>'; }).join('');
    var lazo = '<svg viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 30C14 14 22 3 32 3s18 11 0 27" stroke="#ff4fa3" stroke-width="8"/><path d="M32 30C27 42 22 51 15 60" stroke="#ff4fa3" stroke-width="9"/><path d="M32 30C37 42 42 51 49 60" stroke="#ff4fa3" stroke-width="9"/><path d="M32 30C14 14 22 3 32 3s18 11 0 27" stroke="#ffd0e6" stroke-width="2" opacity=".6"/></svg>';
    var flecha = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22 3 5h18z" fill="currentColor" style="color:var(--a1)"/></svg>';

    var cont = document.createElement('div');
    cont.innerHTML =
      '<div id="n360-welcome" class="' + (ROSA ? 'nw-rosa' : '') + '" role="dialog" aria-modal="true" aria-label="Bienvenido a Negocio360">' +
        '<canvas class="nw-net"></canvas><div class="nw-vig"></div>' +
        '<div class="nw-main">' +
          '<div class="nw-stage">' +
            '<span class="nw-sonar"></span><span class="nw-sonar"></span><span class="nw-sonar"></span>' +
            '<div class="nw-sweep"></div>' +
            '<svg class="nw-svg" viewBox="0 0 400 400" aria-hidden="true">' +
              '<circle class="nw-ring" cx="200" cy="200" r="122"/><circle class="nw-ring-dash" cx="200" cy="200" r="134"/>' +
              '<g class="nw-ticks">' + ticks + '</g><circle class="nw-burst" cx="200" cy="200" r="122"/>' + links +
            '</svg>' +
            '<div class="nw-pin"><span class="nw-pin-flecha">' + flecha + '</span><span class="nw-pin-lazo">' + lazo + '</span></div>' +
            '<div class="nw-logo"><img src="' + LOGO + '" alt="" /></div>' + chips +
          '</div>' +
          '<h1 class="nw-brand" aria-label="Negocio360">' + letras + '<span class="nw-num" id="nwNum"><i>00</i>0</span></h1>' +
          '<div class="nw-rule"></div>' +
          '<div class="nw-say" aria-hidden="true"><p>Controla tu negocio</p><p>Vende más</p><p class="fin">Gana más</p></div>' +
          '<p class="nw-greet" id="nwGreet"></p>' +
          '<p class="nw-cause">' + lazo + '<span>Octubre Rosa: mes de la lucha contra el cáncer de mama</span></p>' +
        '</div>' +
        '<div class="nw-foot"><div class="nw-bar"><div class="nw-bar-fill" id="nwFill"></div></div><span class="nw-pct" id="nwPct">0%</span></div>' +
        '<button type="button" class="nw-skip" id="nwSkip">Saltar</button>' +
      '</div>';
    var el = cont.firstElementChild;
    document.body.appendChild(el);

    // Si el logo rosa no carga, se usa el original (nunca queda un hueco)
    var img = el.querySelector('.nw-logo img');
    if (img) img.onerror = function () { img.onerror = null; img.src = 'negocio360-isotipo.png'; };

    /* ---------------- Control ---------------- */
    var timers = [], raf = 0, cerrada = false, t0 = 0, lastLit = 0, lockHecho = false;
    var $ = function (s) { return el.querySelector(s); };
    var tickEls = Array.prototype.slice.call(el.querySelectorAll('.nw-tick'));
    var numEl = $('#nwNum'), fillEl = $('#nwFill'), pctEl = $('#nwPct'), sweepEl = $('.nw-sweep');
    var frases = Array.prototype.slice.call(el.querySelectorAll('.nw-say p'));
    var greet = $('#nwGreet'), cause = $('.nw-cause');

    function agenda(ms, fn) { timers.push(setTimeout(function () { if (!cerrada) { try { fn(); } catch (e) { /* un paso no rompe el resto */ } } }, ms)); }
    function pintaNumero(v) {
      var s = String(Math.max(0, Math.min(360, Math.round(v))));
      var ceros = 3 - s.length;
      numEl.innerHTML = (ceros > 0 ? '<i>' + '0'.repeat(ceros) + '</i>' : '') + s;
    }
    function saludo() {
      var h = new Date().getHours();
      var s = h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches');
      var f = '';
      try { f = new Date().toLocaleDateString('es-NI', { month: 'long', year: 'numeric' }); } catch (_) {}
      greet.textContent = ROSA ? s + '.' : (f ? s + '. Bienvenido a ' + f + '.' : s + '.');
    }
    function mostrarFrase(i) {
      frases.forEach(function (p, j) {
        if (j === i) { p.classList.remove('out'); p.classList.add('in'); }
        else if (p.classList.contains('in')) { p.classList.remove('in'); p.classList.add('out'); }
      });
    }
    function estadoFinal() {           // composicion completa (reducir animaciones / saltar a mitad)
      pintaNumero(360);
      tickEls.forEach(function (t) { t.classList.add('nw-lit'); });
      el.querySelectorAll('.nw-l').forEach(function (l) { l.classList.add('on'); });
    }

    /* Red de particulas (canvas): ligera, se pausa al cerrar */
    var cv = $('canvas.nw-net'), ctx = null, W = 0, H = 0, P = [];
    function iniciaRed() {
      try {
        ctx = cv.getContext('2d'); if (!ctx) return;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = el.clientWidth; H = el.clientHeight;
        cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.max(26, Math.min(64, Math.floor(W * H / 24000)));
        P = [];
        for (var i = 0; i < n; i++) P.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: Math.random() * 1.3 + .5 });
      } catch (e) { ctx = null; }
    }
    function dibujaRed() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      var col = ROSA ? '255,160,210' : '127,176,255', lim = Math.min(130, W / 4);
      for (var i = 0; i < P.length; i++) {
        var a = P[i]; a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > W) a.vx *= -1; if (a.y < 0 || a.y > H) a.vy *= -1;
        ctx.fillStyle = 'rgba(' + col + ',.7)'; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.2832); ctx.fill();
        for (var j = i + 1; j < P.length; j++) {
          var b = P[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
          if (d < lim) { ctx.strokeStyle = 'rgba(' + col + ',' + ((1 - d / lim) * .22).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      }
    }

    /* Un solo reloj: numero, radar, marcas, red y barra de progreso */
    function cuadro(now) {
      if (cerrada) return;
      var t = now - t0;
      var p = Math.max(0, Math.min(1, (t - T.cuentaIni) / (T.cuentaFin - T.cuentaIni)));
      var e = 1 - Math.pow(1 - p, 3), ang = e * 360;
      if (t >= T.cuentaIni) {
        pintaNumero(ang);
        sweepEl.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
        var lit = Math.floor(e * 72);
        while (lastLit < lit && lastLit < tickEls.length) { tickEls[lastLit].classList.add('nw-lit'); lastLit++; }
      }
      var g = Math.min(1, t / T.salir), gp = 1 - Math.pow(1 - g, 1.6);
      fillEl.style.width = (gp * 100).toFixed(1) + '%'; pctEl.textContent = Math.round(gp * 100) + '%';
      dibujaRed();
      raf = requestAnimationFrame(cuadro);
    }

    function quitar() {
      if (el.parentNode) el.parentNode.removeChild(el);
      var s = document.getElementById('n360-welcome-style'); if (s && s.parentNode) s.parentNode.removeChild(s);
    }
    function cerrar(rapido) {
      if (cerrada) return;
      cerrada = true;
      timers.forEach(clearTimeout); cancelAnimationFrame(raf);
      document.removeEventListener('keydown', alTeclado);
      el.classList.add('nw-exit');
      setTimeout(quitar, rapido ? 500 : 900);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(true); }

    /* ---------------- Guion ---------------- */
    $('#nwSkip').addEventListener('click', function () { cerrar(true); });
    document.addEventListener('keydown', alTeclado);
    setTimeout(function () { if (!cerrada) { cerrada = true; quitar(); } }, T.seguridad);   // cierre de seguridad
    saludo();

    if (REDUCIDO) {
      el.classList.add('nw-on', 'nw-quieto', 'nw-lock');
      estadoFinal(); frases[2].classList.add('in'); frases[2].style.clipPath = 'none';
      greet.classList.add('on'); cause.classList.add('on');
      el.querySelectorAll('.nw-link').forEach(function (l) { l.classList.add('on'); });
      el.querySelectorAll('.nw-chip').forEach(function (c) { c.classList.add('on'); });
      fillEl.style.width = '100%'; pctEl.textContent = '100%';
      setTimeout(function () { cerrar(true); }, 1800);
      return;
    }

    iniciaRed();
    t0 = performance.now();
    raf = requestAnimationFrame(cuadro);
    requestAnimationFrame(function () { el.classList.add('nw-on'); });

    agenda(T.letras, function () {
      el.querySelectorAll('.nw-l').forEach(function (l, i) { l.style.transitionDelay = (i * 60) + 'ms'; l.classList.add('on'); });
    });
    agenda(T.cuentaIni, function () { el.classList.add('nw-count'); });
    MODULOS.forEach(function (m, i) {
      agenda(T.modulos + i * T.modPaso, function () {
        el.querySelector('.nw-link[data-i="' + i + '"]').classList.add('on');
        el.querySelector('.nw-chip[data-i="' + i + '"]').classList.add('on');
      });
    });
    agenda(T.cuentaFin, function () { lockHecho = true; el.classList.add('nw-lock'); pintaNumero(360); });
    agenda(T.fraseA, function () { mostrarFrase(0); });
    agenda(T.fraseB, function () { mostrarFrase(1); });
    agenda(T.fraseC, function () { mostrarFrase(2); });
    agenda(T.causa, function () { cause.classList.add('on'); });
    agenda(T.saludo, function () { greet.classList.add('on'); });
    agenda(T.salir, function () { cerrar(false); });
  } catch (e) {
    try { var w = document.getElementById('n360-welcome'); if (w && w.parentNode) w.parentNode.removeChild(w); } catch (_) {}
  }
})();
