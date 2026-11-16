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
   escena de Halloween (ver escenaHalloween). Del 3 de noviembre al
   6 de enero, la escena navideña (ver escenaNavidad). El resto del
   año, la bienvenida normal.
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

  /* ============================================================
     TEMPORADA NAVIDEÑA (3 nov – 6 ene): "La calle de Negocio360"
     Escena propia (~8.5 s) con las MISMAS reglas que las demas:
     solo en pantallas de entrada, una vez por sesion y por usuario,
     boton "Saltar", tecla Esc, cierre de seguridad a los 10 s,
     respeta "reducir animaciones" y, si algo falla, se quita sola
     sin tocar el sistema. No guarda nada ni llama al servidor.
     GUION (camara de cine en 3D, todo en un solo reloj):
       0.0 s  Franjas de cine. La camara arranca por una calle nevada
              de noche: casas con luces, faroles y guirnaldas.
       0.4 s  "NEGOCIO360 PRESENTA".
       1.3 s  Santa cruza la luna en su trineo (Rudolph con nariz roja).
       2.0 s  La camara acelera: la nieve pasa en estelas.
       4.5 s  Llega a la plaza: el gran arbol enciende sus luces
              de abajo hacia arriba.
       5.0 s  Destello, fuegos artificiales y el LOGO se vuelve la
              estrella del arbol (con gorro de Santa).
       5.6 s  "Negocio360" y "¡Feliz Navidad!" escrito a mano.
       6.3 s  "Controla tu negocio" -> "Vende mas" -> "Gana mas".
       8.5 s  Cierre suave que revela el sistema.
     Del 1 al 6 de enero dice "¡Feliz Año Nuevo!".
     Prueba en cualquier fecha: agregar ?bienvenida=navidad a la URL.
     ============================================================ */
  function esNavidad() {
    try {
      var q = (location.search || '').toLowerCase();
      if (q.indexOf('bienvenida=navidad') !== -1) return true;
      if (/bienvenida=(normal|halloween|dial)/.test(q)) return false;
      var d = new Date(), m = d.getMonth(), dia = d.getDate();
      return (m === 10 && dia >= 3) || m === 11 || (m === 0 && dia <= 6);
    } catch (_) { return false; }
  }

  function escenaNavidad(REDUCIDO) {
    var T = { intro: 400, introOut: 2100, trineo: 1300, arbol: 4450, estrella: 5000, marca: 5100, nombre: 5550,
              titulo: 5850, fraseA: 6350, fraseB: 6950, fraseC: 7550, saludo: 7650, salir: 8500, seguridad: 10000 };
    var CAM_INI = 150, CAM_FIN_T = 4900;

    try {   // letra manuscrita (si no carga, queda una cursiva del sistema)
      if (!document.getElementById('n360-nv-font')) {
        var lf = document.createElement('link'); lf.id = 'n360-nv-font'; lf.rel = 'stylesheet';
        lf.href = 'https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap'; document.head.appendChild(lf);
      }
    } catch (_) { /* sin letra especial */ }

    var hoy = new Date(), ENERO = hoy.getMonth() === 0;
    var TITULO = ENERO ? '¡Feliz Año Nuevo!' : '¡Feliz Navidad!';
    var INTRO = ENERO ? 'Un año nuevo lleno de éxito' : 'Una Navidad llena de éxito';

    var style = document.createElement('style');
    style.id = 'n360-welcome-style';
    style.textContent = `
#n360-welcome.nv { --gold: #ffd27a; --ice: #eef4ff; --LB: min(8.5vh, 64px); --L: clamp(78px, 15vmin, 144px);
  position: fixed; inset: 0; z-index: 100000; overflow: hidden; background: #04060f; color: #fff;
  font-family: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  opacity: 0; transition: opacity .6s ease; -webkit-tap-highlight-color: transparent; }
#n360-welcome.nv.nv-on { opacity: 1; }
#n360-welcome.nv.nv-exit { opacity: 0; transform: scale(1.05); filter: blur(6px) brightness(1.3); pointer-events: none;
  transition: opacity .9s ease, transform 1s ease, filter .9s ease; }
.nv-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.nv-world { z-index: 1; }
.nv-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 50%; z-index: 2; pointer-events: none; opacity: 0; transition: opacity 1.2s ease;
  background: linear-gradient(to top, rgba(3,5,16,.94) 0%, rgba(3,5,16,.66) 42%, rgba(3,5,16,0) 100%); }
.nv-fx { z-index: 3; pointer-events: none; }
.nv-vig { position: absolute; inset: 0; z-index: 4; pointer-events: none; background: radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0) 52%, rgba(0,0,0,.6) 100%); }
#n360-welcome.nv-mark .nv-scrim { opacity: 1; }

/* Franjas de cine */
.nv-lb { position: absolute; left: 0; right: 0; height: var(--LB); background: #000; z-index: 6; transition: transform 1.2s cubic-bezier(.7,0,.2,1); }
.nv-lb.t { top: 0; } .nv-lb.b { bottom: 0; }
#n360-welcome.nv-mark .nv-lb.t { transform: translateY(-100%); }
#n360-welcome.nv-mark .nv-lb.b { transform: translateY(100%); }

/* Titulo de entrada */
.nv-intro { position: absolute; left: 0; right: 0; top: 36%; z-index: 5; text-align: center; pointer-events: none; padding: 18px 16px;
  background: radial-gradient(ellipse 50% 60% at 50% 50%, rgba(4,6,18,.62), rgba(4,6,18,0) 100%);
  opacity: 0; transform: translateY(12px); filter: blur(6px); transition: opacity .8s ease, transform 1.4s cubic-bezier(.16,1,.3,1), filter .8s ease; }
.nv-intro.on { opacity: 1; transform: none; filter: none; }
.nv-intro.out { opacity: 0; transform: scale(1.18); filter: blur(10px); transition-duration: .7s; }
.nv-intro small { display: block; font-size: clamp(10px, 1.5vmin, 13px); letter-spacing: .55em; text-indent: .55em; font-weight: 700; color: rgba(255,226,170,.9); }
.nv-intro b { display: block; margin-top: 10px; font-size: clamp(22px, 4.4vmin, 44px); font-weight: 800; letter-spacing: -.015em; text-shadow: 0 2px 26px rgba(0,0,0,.7); }
.nv-intro i { display: block; width: min(240px, 46vw); height: 1px; margin: 14px auto 0; background: linear-gradient(90deg, transparent, var(--gold), transparent); }

/* Logo = estrella del arbol */
.nv-logo { position: absolute; z-index: 5; left: 50%; top: 22%; width: var(--L); height: var(--L); pointer-events: none;
  opacity: 0; transform: translate(-50%, -50%) scale(.15) rotate(-25deg);
  transition: transform 1.05s cubic-bezier(.34,1.56,.64,1), opacity .3s ease; }
#n360-welcome.nv-mark .nv-logo { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
.nv-rays { position: absolute; inset: -95%; border-radius: 50%; opacity: 0; transition: opacity 1.4s ease .2s;
  background: repeating-conic-gradient(from 0deg, rgba(255,214,120,0) 0deg 6deg, rgba(255,214,120,.26) 9deg, rgba(255,214,120,0) 12deg 20deg);
  -webkit-mask: radial-gradient(circle, #000 14%, transparent 66%); mask: radial-gradient(circle, #000 14%, transparent 66%);
  animation: nv-gira 16s linear infinite; }
#n360-welcome.nv-mark .nv-rays { opacity: 1; }
.nv-halo { position: absolute; inset: -38%; border-radius: 50%; background: radial-gradient(circle, rgba(255,222,150,.6), rgba(255,180,70,.16) 46%, rgba(255,180,70,0) 70%); }
.nv-ring { position: absolute; left: -16%; top: -16%; width: 132%; height: 132%; overflow: visible; }
.nv-ring circle { fill: none; }
.nv-ring .r1 { stroke: #ffd27a; stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 315; stroke-dashoffset: 315; transition: stroke-dashoffset 1.2s cubic-bezier(.65,0,.35,1) .15s;
  filter: drop-shadow(0 0 3px rgba(255,200,90,.9)); transform: rotate(-90deg); transform-origin: 50px 50px; }
.nv-ring .r2 { stroke: rgba(255,236,190,.55); stroke-width: 1; stroke-dasharray: 1.5 5.5; transform-origin: 50px 50px; animation: nv-gira 22s linear infinite reverse; opacity: 0; transition: opacity 1s ease .6s; }
#n360-welcome.nv-mark .nv-ring .r1 { stroke-dashoffset: 0; }
#n360-welcome.nv-mark .nv-ring .r2 { opacity: 1; }
.nv-disc { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; display: grid; place-items: center;
  background: radial-gradient(circle at 34% 28%, #ffffff, #f1f5ff 58%, #cdd8ef 100%);
  box-shadow: 0 0 0 3px rgba(255,214,120,.95), 0 0 34px rgba(255,200,90,.85), 0 0 90px rgba(255,170,60,.5), inset 0 -8px 18px rgba(30,50,110,.18); }
.nv-disc img { width: 70%; height: 70%; object-fit: contain; position: relative; }
.nv-shine { position: absolute; inset: 0; background: linear-gradient(115deg, rgba(255,255,255,0) 34%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 66%); transform: translateX(-130%); }
#n360-welcome.nv-mark .nv-shine { animation: nv-brillo 1.3s ease .6s both; }
.nv-hat { position: absolute; width: 62%; right: -16%; top: -40%; transform-origin: 30% 90%; opacity: 0; transform: translateY(-60%) rotate(-30deg);
  transition: transform .8s cubic-bezier(.34,1.56,.64,1) .55s, opacity .3s ease .55s; filter: drop-shadow(0 3px 6px rgba(0,0,0,.35)); }
#n360-welcome.nv-mark .nv-hat { opacity: 1; transform: rotate(14deg); }
.nv-flare { position: absolute; z-index: 4; left: 50%; top: 22%; width: 140vw; height: 5px; pointer-events: none; opacity: 0; transform: translate(-50%, -50%) scaleX(0);
  background: linear-gradient(90deg, rgba(255,220,150,0) 0%, rgba(255,222,160,.5) 30%, rgba(255,250,235,1) 50%, rgba(255,222,160,.5) 70%, rgba(255,220,150,0) 100%); filter: blur(1.2px); }
.nv-blanco { position: absolute; inset: 0; z-index: 7; pointer-events: none; opacity: 0; background: radial-gradient(circle at var(--fx, 50%) var(--fy, 22%), rgba(255,250,235,.95), rgba(255,236,190,.35) 30%, rgba(255,236,190,0) 65%); }
#n360-welcome.nv-flash .nv-flare { animation: nv-flare 1.5s ease-out both; }
#n360-welcome.nv-flash .nv-blanco { animation: nv-blanco .9s ease-out both; }

/* Tercio inferior */
.nv-lower { position: absolute; left: 0; right: 0; bottom: calc(44px + 2.4vh); z-index: 5; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0 16px; pointer-events: none; }
.nv-name { margin: 0; font-size: clamp(34px, 7.2vmin, 76px); font-weight: 800; letter-spacing: -.035em; line-height: 1.05; display: flex; justify-content: center; perspective: 600px; }
.nv-l { display: inline-block; color: #fff; text-shadow: 0 4px 30px rgba(0,0,0,.65); opacity: 0; transform: translateY(.55em) rotateX(-75deg); filter: blur(6px);
  transition: opacity .55s ease, transform .85s cubic-bezier(.16,1,.3,1), filter .55s ease; }
.nv-l.n { color: transparent; background: linear-gradient(180deg, #fff6d6 0%, #ffd27a 48%, #e39a33 100%); -webkit-background-clip: text; background-clip: text; text-shadow: none; }
.nv-l.on { opacity: 1; transform: none; filter: none; }
.nv-l.n.on { filter: drop-shadow(0 0 14px rgba(255,190,80,.6)); }
.nv-title { font-family: "Great Vibes", "Brush Script MT", "Segoe Script", cursive; font-size: clamp(36px, 7.4vmin, 78px); line-height: 1.15; margin-top: .2vh; padding: 0 .35em;
  color: transparent; background: linear-gradient(90deg, #ffe3a0, #ffd27a 30%, #fff7e2 52%, #f2b347 78%, #ffe3a0); -webkit-background-clip: text; background-clip: text;
  filter: drop-shadow(0 0 16px rgba(255,190,80,.55)); clip-path: inset(0 100% 0 0); transition: clip-path 1.3s cubic-bezier(.65,0,.35,1); }
#n360-welcome.nv-tit .nv-title { clip-path: inset(0 0 0 0); }
.nv-say { position: relative; width: min(760px, 92vw); height: clamp(30px, 5vh, 50px); margin-top: .4vh; }
.nv-say p { position: absolute; left: 0; right: 0; top: 0; margin: 0; font-size: clamp(18px, 3.4vmin, 34px); font-weight: 800; letter-spacing: -.02em; color: var(--ice);
  opacity: 0; transform: translateY(14px); filter: blur(6px); transition: opacity .5s ease, transform .6s cubic-bezier(.16,1,.3,1), filter .5s ease; }
.nv-say p.in { opacity: 1; transform: none; filter: none; }
.nv-say p.out { opacity: 0; transform: translateY(-12px); filter: blur(4px); }
.nv-say p.fin { color: var(--gold); text-shadow: 0 0 18px rgba(255,190,80,.75); }
.nv-greet { margin: .6vh 0 0; min-height: 22px; font-size: clamp(14px, 2vmin, 19px); font-weight: 600; color: rgba(238,244,255,.8); opacity: 0; transform: translateY(8px); transition: opacity .7s ease, transform .7s ease; }
.nv-greet.on { opacity: 1; transform: none; }

/* Barra y Saltar */
.nv-foot { position: absolute; left: 0; right: 0; bottom: 0; z-index: 10; padding: 0 22px 16px; display: flex; align-items: center; gap: 12px; }
.nv-bar { flex: 1; height: 5px; border-radius: 5px; background: rgba(255,255,255,.12); overflow: hidden; }
.nv-fill { height: 100%; width: 0; border-radius: 5px; background: linear-gradient(90deg, #e8344a, #ffd27a 55%, #2fbf71); box-shadow: 0 0 14px rgba(255,200,90,.7); }
.nv-pct { font-size: 12px; font-weight: 700; color: rgba(255,226,170,.9); font-variant-numeric: tabular-nums; min-width: 3.2ch; text-align: right; }
.nv-skip { position: absolute; top: 18px; right: 20px; z-index: 11; padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(255,214,120,.4);
  background: rgba(10,14,34,.55); color: rgba(255,240,210,.92); font-size: 13px; font-weight: 600; line-height: 1; font-family: inherit; cursor: pointer; opacity: 0; transition: opacity .6s ease .4s, background .2s ease;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
#n360-welcome.nv-on .nv-skip { opacity: 1; }
.nv-skip:hover { background: rgba(232,52,74,.35); color: #fff; }
.nv-skip:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }

@keyframes nv-gira { to { transform: rotate(360deg); } }
@keyframes nv-brillo { to { transform: translateX(130%); } }
@keyframes nv-flare { 0% { opacity: 0; transform: translate(-50%, -50%) scaleX(0); } 14% { opacity: 1; transform: translate(-50%, -50%) scaleX(1); } 100% { opacity: 0; transform: translate(-50%, -50%) scaleX(1.25); } }
@keyframes nv-blanco { 0% { opacity: 0; } 18% { opacity: .85; } 100% { opacity: 0; } }

@media (max-width: 560px) { .nv-skip { top: 14px; right: 14px; } .nv-foot { padding: 0 16px 14px; } }
@media (max-height: 520px) {
  #n360-welcome.nv { --L: clamp(60px, 17vh, 96px); --LB: 7vh; }
  .nv-name { font-size: clamp(24px, 8.5vh, 42px); } .nv-title { font-size: clamp(24px, 8.5vh, 42px); }
  .nv-say { height: 24px; } .nv-say p { font-size: 16px; } .nv-greet { font-size: 13px; min-height: 16px; } .nv-lower { bottom: 32px; }
}
#n360-welcome.nv-quieto *, #n360-welcome.nv-quieto { transition: none !important; animation: none !important; }
`;
    document.head.appendChild(style);

    var HAT = '<svg class="nv-hat" viewBox="0 0 100 80" aria-hidden="true"><path d="M14 64 C 22 30, 52 6, 84 16 C 74 22, 66 34, 70 50 Z" fill="#d81f36"/>' +
      '<path d="M30 40 C 44 22, 64 14, 84 16 C 70 20, 62 30, 62 44 Z" fill="#ff4058" opacity=".55"/>' +
      '<rect x="6" y="56" width="74" height="16" rx="8" fill="#fff"/><circle cx="86" cy="16" r="9" fill="#fff"/></svg>';
    var letras = 'Negocio'.split('').map(function (c) { return '<span class="nv-l">' + c + '</span>'; }).join('') +
                 '360'.split('').map(function (c) { return '<span class="nv-l n">' + c + '</span>'; }).join('');
    var cont = document.createElement('div');
    cont.innerHTML =
      '<div id="n360-welcome" class="nv" role="dialog" aria-modal="true" aria-label="Bienvenido a Negocio360">' +
        '<canvas class="nv-cv nv-world" aria-hidden="true"></canvas>' +
        '<div class="nv-scrim"></div>' +
        '<canvas class="nv-cv nv-fx" aria-hidden="true"></canvas>' +
        '<div class="nv-vig"></div>' +
        '<div class="nv-flare"></div>' +
        '<div class="nv-logo" aria-hidden="true"><div class="nv-rays"></div><div class="nv-halo"></div>' +
          '<svg class="nv-ring" viewBox="0 0 100 100"><circle class="r2" cx="50" cy="50" r="48"/><circle class="r1" cx="50" cy="50" r="50"/></svg>' +
          '<div class="nv-disc"><img src="negocio360-isotipo.png" alt=""><div class="nv-shine"></div></div>' + HAT + '</div>' +
        '<div class="nv-intro" aria-hidden="true"><small>NEGOCIO360 PRESENTA</small><b>' + INTRO + '</b><i></i></div>' +
        '<div class="nv-lower">' +
          '<h1 class="nv-name" aria-label="Negocio360">' + letras + '</h1>' +
          '<div class="nv-title" aria-hidden="true">' + TITULO + '</div>' +
          '<div class="nv-say" aria-hidden="true"><p>Controla tu negocio</p><p>Vende más</p><p class="fin">Gana más ' + (ENERO ? '🎉' : '🎄') + '</p></div>' +
          '<p class="nv-greet" id="nvGreet"></p>' +
        '</div>' +
        '<div class="nv-lb t"></div><div class="nv-lb b"></div>' +
        '<div class="nv-blanco"></div>' +
        '<div class="nv-foot"><div class="nv-bar"><div class="nv-fill" id="nvFill"></div></div><span class="nv-pct" id="nvPct">0%</span></div>' +
        '<button type="button" class="nv-skip" id="nvSkip">Saltar</button>' +
      '</div>';
    var el = cont.firstElementChild;
    document.body.appendChild(el);

    /* ---------- Control ---------- */
    var $ = function (s) { return el.querySelector(s); };
    var timers = [], raf = 0, cerrada = false, t0 = 0, tUlt = 0;
    var fillEl = $('#nvFill'), pctEl = $('#nvPct'), greet = $('#nvGreet'), intro = $('.nv-intro');
    var logo = $('.nv-logo'), flare = $('.nv-flare'), blanco = $('.nv-blanco');
    var frases = Array.prototype.slice.call(el.querySelectorAll('.nv-say p'));
    var img = el.querySelector('.nv-disc img');
    if (img) img.onerror = function () { this.style.visibility = 'hidden'; };   // sin logo: no queda un icono roto
    function agenda(ms, fn) { timers.push(setTimeout(function () { if (!cerrada) { try { fn(); } catch (e) { /* un paso no rompe el resto */ } } }, ms)); }
    function mostrarFrase(i) { frases.forEach(function (p, j) { if (j === i) { p.classList.remove('out'); p.classList.add('in'); } else if (p.classList.contains('in')) { p.classList.remove('in'); p.classList.add('out'); } }); }
    (function () {
      var h = hoy.getHours(), m = hoy.getMonth(), d = hoy.getDate();
      var extra = ENERO ? '¡Próspero ' + hoy.getFullYear() + ' y muchas ventas!' : (m === 11 && d >= 26 ? '¡Próspero Año Nuevo y muchas ventas!' : '¡Felices fiestas y muchas ventas!');
      greet.textContent = (h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches')) + ' · ' + extra;
    })();

    function quitar() {
      try { window.removeEventListener('resize', alCambiar); } catch (_) {}
      if (el.parentNode) el.parentNode.removeChild(el);
      var s = document.getElementById('n360-welcome-style'); if (s && s.parentNode) s.parentNode.removeChild(s);
    }
    function cerrar(rapido) {
      if (cerrada) return;
      cerrada = true; timers.forEach(clearTimeout); cancelAnimationFrame(raf);
      document.removeEventListener('keydown', alTeclado);
      el.classList.add('nv-exit'); setTimeout(quitar, rapido ? 600 : 1000);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(true); }
    $('#nvSkip').addEventListener('click', function () { cerrar(true); });
    document.addEventListener('keydown', alTeclado);
    setTimeout(function () { if (!cerrada) { cerrada = true; timers.forEach(clearTimeout); cancelAnimationFrame(raf); document.removeEventListener('keydown', alTeclado); quitar(); } }, T.seguridad);   // cierre de seguridad

    /* =================== Mundo 3D (canvas) =================== */
    var cv = $('canvas.nv-world'), fxc = $('canvas.nv-fx'), ctx = null, cf = null;
    var W = 0, H = 0, DPR = 1, F = 600, W2 = 0, HY = 0, PX = 0, PY = 0, PS = 0, HYF = .56;
    var END = 160, CAM_FIN = END - 26, NEAR = 0.7, Z_F = END + 24;
    var cam = { x: 0, y: 2.2, z: 0 }, vel = 0, zAnt = 0, dibujar = true, litP = 0, estrellaT = -1;
    var tt = 0;   // reloj de la escena (ms)

    function rnd(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    var R = rnd(2412);
    function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
    var LUCES = ['255,64,84', '255,204,84', '80,226,132', '104,166,255', '255,246,230'];
    var FOG = [24, 28, 64];
    function fogT(dz) { return cl((dz - 14) / 150, 0, .82); }
    function col(r, g, b, dz) { var f = fogT(dz); return 'rgb(' + Math.round(r + (FOG[0] - r) * f) + ',' + Math.round(g + (FOG[1] - g) * f) + ',' + Math.round(b + (FOG[2] - b) * f) + ')'; }
    function P(x, y, z) { var dz = z - cam.z; if (dz < NEAR) dz = NEAR; PS = F / dz; PX = W2 + (x - cam.x) * PS; PY = HY - (y - cam.y) * PS; }
    function poly(a) { ctx.beginPath(); for (var i = 0; i < a.length; i += 3) { P(a[i], a[i + 1], a[i + 2]); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); } ctx.closePath(); }

    var SPR = {};
    function sprite(rgb, suave) {
      var k = rgb + (suave ? 's' : ''); if (SPR[k]) return SPR[k];
      var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
      var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      if (suave) { gr.addColorStop(0, 'rgba(' + rgb + ',.9)'); gr.addColorStop(.5, 'rgba(' + rgb + ',.28)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)'); }
      else { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.1, 'rgba(' + rgb + ',1)'); gr.addColorStop(.32, 'rgba(' + rgb + ',.34)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)'); }
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); SPR[k] = c; return c;
    }
    // Foco de luz con halo (se dibuja en modo 'lighter')
    function foco(x, y, z, rgb, tam, a) {
      P(x, y, z); var r = tam * PS * 5; if (r < 2.2) r = 2.2; if (r > 90) r = 90;
      if (PX < -r || PX > W + r || PY < -r || PY > H + r) return;
      ctx.globalAlpha = a; ctx.drawImage(sprite(rgb), PX - r, PY - r, r * 2, r * 2);
    }

    /* ---- La calle: casas, faroles, guirnaldas (siempre iguales: semilla fija) ---- */
    var PAL = [[96, 40, 48], [46, 72, 102], [124, 100, 74], [42, 88, 80], [90, 54, 100], [116, 64, 44], [64, 68, 98], [132, 120, 108]];
    var ITEMS = [];
    [-1, 1].forEach(function (s) {
      var z = -12;
      while (z < END - 18) {
        var len = 6 + R() * 5, h = 4.6 + R() * 3.2, rh = 1.8 + R() * 1.4, c = PAL[Math.floor(R() * PAL.length)];
        var pisos = h > 6.2 ? 2 : 1, n = Math.max(1, Math.floor((len - 1.2) / 2.3)), puerta = Math.floor(R() * n), win = [], door = null;
        for (var f = 0; f < pisos; f++) {
          for (var k = 0; k < n; k++) {
            var zc = z + (k + .5) * len / n;
            if (f === 0 && k === puerta) { door = { z0: zc - .6, z1: zc + .6, zc: zc }; continue; }
            var y0 = 1.25 + f * 2.6; win.push({ z0: zc - .55, z1: zc + .55, y0: y0, y1: y0 + 1.4, on: R() < .82, tono: R() });
          }
        }
        ITEMS.push({ t: 'casa', k: z + len, s: s, z0: z, z1: z + len, h: h, rh: rh, c: c, w: win, door: door, lc: Math.floor(R() * 3) });
        z += len + .8 + R() * 1.6;
      }
    });
    for (var zl = 6, gi = 0; zl < END - 20; zl += 14, gi++) {
      ITEMS.push({ t: 'farol', k: zl, s: -1, z: zl });
      ITEMS.push({ t: 'farol', k: zl, s: 1, z: zl });
      ITEMS.push({ t: 'guir', k: zl - .01, z: zl, g: gi });
    }
    ITEMS.push({ t: 'arbol', k: END });
    ITEMS.sort(function (a, b) { return b.k - a.k; });   // de lejos a cerca

    var FONDO = [];
    (function () {
      var x = -64;
      while (x < 64) {
        var w = 6 + R() * 8, h = 7 + R() * 11, ws = [];
        for (var y = 1.6; y < h - 1.4; y += 2.3) for (var xx = x + 1; xx < x + w - 1.2; xx += 1.9) ws.push({ x: xx, y: y, on: R() < .55, tono: R() });
        FONDO.push({ x0: x, x1: x + w, h: h, c: PAL[Math.floor(R() * PAL.length)], w: ws, luces: R() < .6, lc: Math.floor(R() * 3) });
        x += w + R() * 1.2;
      }
    })();

    var LUZ_ARBOL = [], BOLAS = [];
    (function () {
      var N = 170;
      for (var k = 0; k < N; k++) {
        var v = k / N, y = .9 + v * 11.3, r = 4.7 * (1 - (y - .9) / 11.9) * .92, ang = k * 2.39996;
        if (Math.cos(ang) < -.15) continue;
        LUZ_ARBOL.push({ x: r * Math.sin(ang), y: y + (R() - .5) * .4, v: v, c: LUCES[k % 5], ph: R() * 6.28 });
      }
      var BC = [[220, 30, 52], [255, 196, 70], [210, 220, 240], [60, 120, 230]];
      for (var b = 0; b < 26; b++) {
        var vb = .05 + R() * .8, yb = .9 + vb * 11.3, rb = 4.7 * (1 - (yb - .9) / 11.9) * .8, ab = (R() - .5) * 2.6;
        BOLAS.push({ x: rb * Math.sin(ab), y: yb, v: vb, c: BC[b % 4] });
      }
    })();

    var ESTRELLAS = [];
    for (var si = 0; si < 130; si++) ESTRELLAS.push({ x: R(), y: R() * .5, r: R() * 1.2 + .3, f: R() * 6.28, s: .6 + R() * 2 });

    var NIEVE = [];
    var FW = [], TRAZO = [], FXP = [];
    var skyC = null;

    function hacerCielo() {
      try {
        skyC = document.createElement('canvas'); skyC.width = Math.max(1, Math.round(W)); skyC.height = Math.max(1, Math.round(H));
        var g = skyC.getContext('2d');
        var gr = g.createLinearGradient(0, 0, 0, H * .62);
        gr.addColorStop(0, '#03050f'); gr.addColorStop(.55, '#111845'); gr.addColorStop(1, '#3a2c60');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        var mx = W * .8, my = H * .15, mr = Math.min(W, H) * .045;
        var halo = g.createRadialGradient(mx, my, mr * .8, mx, my, mr * 7);
        halo.addColorStop(0, 'rgba(210,225,255,.32)'); halo.addColorStop(1, 'rgba(210,225,255,0)');
        g.fillStyle = halo; g.fillRect(0, 0, W, H);
        var luna = g.createRadialGradient(mx - mr * .3, my - mr * .3, mr * .1, mx, my, mr);
        luna.addColorStop(0, '#ffffff'); luna.addColorStop(1, '#d6e0f5');
        g.fillStyle = luna; g.beginPath(); g.arc(mx, my, mr, 0, 6.2832); g.fill();
        g.fillStyle = 'rgba(150,165,200,.35)';
        [[-.3, -.2, .22], [.25, .15, .16], [-.05, .38, .12]].forEach(function (c) { g.beginPath(); g.arc(mx + c[0] * mr, my + c[1] * mr, c[2] * mr, 0, 6.2832); g.fill(); });
      } catch (e) { skyC = null; }
    }

    function medir() {
      W = el.clientWidth || window.innerWidth; H = el.clientHeight || window.innerHeight;
      DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      [cv, fxc].forEach(function (c) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
      ctx = cv.getContext('2d'); cf = fxc.getContext('2d');
      // Pantalla baja y ancha (telefono acostado): arbol mas pequeño y arriba para que no lo tapen los textos.
      var corto = H < 520 && W > H;
      F = corto ? H * .78 : Math.min(H * .9, Math.max(W * 1.25, H * .7)); HYF = corto ? .5 : .56; W2 = W / 2;
      hacerCielo();
      if (!NIEVE.length) {
        var n = cl(Math.floor(W * H / 5200), 110, 300);
        for (var i = 0; i < n; i++) NIEVE.push({ x: (R() - .5) * 26, y: R() * 11, z: cam.z + 1 + R() * 46, r: .025 + R() * .045, v: .8 + R() * 1.4, ph: R() * 6.28 });
      }
      colocarLogo();
    }
    // El logo se coloca justo en la punta del arbol (con la camara ya detenida).
    function colocarLogo() {
      var cx = cam.x, cy = cam.y, cz = cam.z, hy = HY;
      cam.x = 0; cam.y = 2.2; cam.z = CAM_FIN; HY = H * HYF;
      P(0, 12.75, END);
      var Lp = logo.offsetWidth || 120, top = PY - Lp * .42;
      if (top < Lp * .62 + 8) top = Lp * .62 + 8;
      logo.style.left = PX + 'px'; logo.style.top = top + 'px';
      flare.style.left = PX + 'px'; flare.style.top = top + 'px';
      blanco.style.setProperty('--fx', PX + 'px'); blanco.style.setProperty('--fy', top + 'px');
      cam.x = cx; cam.y = cy; cam.z = cz; HY = hy;
      return { x: PX, y: top };
    }
    var cambiarT = 0;
    function alCambiar() { clearTimeout(cambiarT); cambiarT = setTimeout(function () { if (!cerrada) { try { medir(); } catch (_) {} } }, 120); }

    function camara(t) {
      var p = cl((t - CAM_INI) / (CAM_FIN_T - CAM_INI), 0, 1);
      var e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      cam.z = e * CAM_FIN;
      cam.x = Math.sin(t * .0011) * .9 * (1 - e);
      cam.y = 2.2 + Math.sin(t * .009) * .04 * (1 - e);
      var q = cl((t - 3200) / 1800, 0, 1);
      HY = H * (.5 + (HYF - .5) * q * q * (3 - 2 * q));
    }

    /* ---- Cielo: estrellas, trineo, fuegos artificiales ---- */
    function pintaEstrellas() {
      ctx.fillStyle = '#fff';
      for (var i = 0; i < ESTRELLAS.length; i++) {
        var s = ESTRELLAS[i]; ctx.globalAlpha = .35 + .65 * Math.abs(Math.sin(tt * .001 * s.s + s.f));
        ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }
    function pintaTrineo() {
      var u = (tt - T.trineo) / 2800; if (u < 0 || u > 1) return;
      var k = Math.min(W, H) / 900 * 1.1, x = W * (1.12 - 1.3 * u), y = H * .16 + (u - .246) * H * .1 - Math.sin(u * Math.PI) * H * .02;
      // estela de chispas doradas
      for (var j = 0; j < 2; j++) TRAZO.push({ x: x + 14 * k + (R() - .5) * 6 * k, y: y + 4 * k + (R() - .5) * 4 * k, v: 0, a: 1 });
      ctx.fillStyle = '#070b22'; ctx.strokeStyle = '#070b22'; ctx.lineCap = 'round';
      // renos (4) y riendas
      ctx.lineWidth = Math.max(1, .9 * k);
      for (var i = 0; i < 4; i++) {
        var rx = x - (34 + i * 22) * k, ry = y - 2 * k + Math.sin(tt * .02 + i * 1.3) * 2 * k, ph = tt * .03 + i;
        ctx.beginPath(); ctx.moveTo(x - 10 * k, y - 3 * k); ctx.lineTo(rx + 8 * k, ry); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(rx, ry, 9 * k, 3.6 * k, -.08, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.moveTo(rx - 6 * k, ry - 1 * k); ctx.lineTo(rx - 9 * k, ry - 6 * k); ctx.lineWidth = Math.max(1, 2.2 * k); ctx.stroke();
        ctx.beginPath(); ctx.arc(rx - 10 * k, ry - 7 * k, 2.4 * k, 0, 6.2832); ctx.fill();
        ctx.lineWidth = Math.max(1, .9 * k);
        ctx.beginPath(); ctx.moveTo(rx - 9 * k, ry - 9 * k); ctx.lineTo(rx - 7 * k, ry - 14 * k); ctx.lineTo(rx - 4 * k, ry - 15 * k);
        ctx.moveTo(rx - 7 * k, ry - 12 * k); ctx.lineTo(rx - 10 * k, ry - 14 * k); ctx.stroke();
        ctx.lineWidth = Math.max(1, 1.3 * k);
        ctx.beginPath();
        ctx.moveTo(rx - 5 * k, ry + 2 * k); ctx.lineTo(rx - 7 * k - Math.sin(ph) * 4 * k, ry + 8 * k);
        ctx.moveTo(rx - 2 * k, ry + 2 * k); ctx.lineTo(rx - 3 * k + Math.sin(ph + 1) * 4 * k, ry + 8 * k);
        ctx.moveTo(rx + 5 * k, ry + 2 * k); ctx.lineTo(rx + 7 * k + Math.sin(ph + 2) * 4 * k, ry + 8 * k);
        ctx.moveTo(rx + 7 * k, ry + 1 * k); ctx.lineTo(rx + 10 * k - Math.sin(ph + 3) * 4 * k, ry + 7 * k);
        ctx.stroke(); ctx.lineWidth = Math.max(1, .9 * k);
        if (i === 3) {   // Rudolph
          ctx.globalCompositeOperation = 'lighter'; var nr = 7 * k + 2;
          ctx.globalAlpha = .75 + .25 * Math.sin(tt * .012); ctx.drawImage(sprite('255,50,60'), rx - 12.5 * k - nr, ry - 7 * k - nr, nr * 2, nr * 2);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
      }
      // trineo y Santa
      ctx.beginPath(); ctx.moveTo(x - 12 * k, y - 6 * k); ctx.quadraticCurveTo(x - 12 * k, y + 3 * k, x, y + 3 * k); ctx.lineTo(x + 12 * k, y + 3 * k);
      ctx.quadraticCurveTo(x + 14 * k, y - 4 * k, x + 17 * k, y - 9 * k); ctx.lineTo(x + 8 * k, y - 6 * k); ctx.closePath(); ctx.fill();
      ctx.lineWidth = Math.max(1, 1.4 * k); ctx.beginPath(); ctx.moveTo(x + 14 * k, y + 7 * k); ctx.lineTo(x - 10 * k, y + 7 * k); ctx.quadraticCurveTo(x - 16 * k, y + 7 * k, x - 15 * k, y + 2 * k); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 4 * k, y + 3 * k); ctx.lineTo(x - 4 * k, y + 7 * k); ctx.moveTo(x + 8 * k, y + 3 * k); ctx.lineTo(x + 8 * k, y + 7 * k); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + 2 * k, y - 7 * k, 5 * k, 4.5 * k, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 1 * k, y - 13 * k, 3 * k, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 2 * k, y - 15 * k); ctx.lineTo(x + 4 * k, y - 15 * k); ctx.lineTo(x + 8 * k, y - 19 * k); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 11 * k, y - 10 * k, 4.8 * k, 0, 6.2832); ctx.fill();
    }
    function pintaTrazo(dt) {
      if (!TRAZO.length) return;
      ctx.globalCompositeOperation = 'lighter';
      var spr = sprite('255,206,110');
      for (var i = TRAZO.length - 1; i >= 0; i--) {
        var p = TRAZO[i]; p.a -= dt * 1.1; p.y += dt * 14; if (p.a <= 0) { TRAZO.splice(i, 1); continue; }
        var r = 3 + p.a * 4; ctx.globalAlpha = p.a * .8; ctx.drawImage(spr, p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function cohete(fx, fy, rgb) {
      var k = Math.min(W, H) / 700, n = 54;
      for (var i = 0; i < n; i++) {
        var a = i / n * 6.2832 + R() * .12, sp = (95 + R() * 70) * k;
        FW.push({ x: fx * W, y: fy * H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 1.1 + R() * .7, rgb: R() < .25 ? '255,246,230' : rgb });
      }
    }
    function pintaFuegos(dt) {
      if (!FW.length) return;
      var k = Math.min(W, H) / 700;
      ctx.globalCompositeOperation = 'lighter';
      for (var i = FW.length - 1; i >= 0; i--) {
        var p = FW[i]; p.life += dt; if (p.life >= p.max) { FW.splice(i, 1); continue; }
        p.vx *= .985; p.vy = p.vy * .985 + 70 * k * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        var a = 1 - p.life / p.max, r = (2.5 + 3 * a) * Math.max(.7, k);
        ctx.globalAlpha = a; ctx.drawImage(sprite(p.rgb), p.x - r * 2, p.y - r * 2, r * 4, r * 4);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    /* ---- Suelo, fondo de la plaza ---- */
    function pintaFondo() {
      var dz = Z_F - cam.z, s = F / dz, i, j;
      for (i = 0; i < FONDO.length; i++) {
        var b = FONDO[i];
        P(b.x0, b.h, Z_F); var x0 = PX, y0 = PY; P(b.x1, 0, Z_F); var x1 = PX, y1 = PY;
        if (x1 < 0 || x0 > W) continue;
        ctx.fillStyle = col(b.c[0] * .7, b.c[1] * .7, b.c[2] * .75, dz); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = col(200, 214, 240, dz); ctx.fillRect(x0 - .2 * s, y0 - .25 * s, x1 - x0 + .4 * s, .35 * s);
        var ww = 1 * s, wh = 1.2 * s;
        for (j = 0; j < b.w.length; j++) {
          var w = b.w[j]; if (!w.on) continue;
          P(w.x, w.y + 1.2, Z_F);
          ctx.fillStyle = w.tono < .7 ? col(255, 196, 112, dz * .55) : col(150, 200, 255, dz * .55);
          ctx.fillRect(PX, PY, ww, wh);
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < FONDO.length; i++) {
        var c = FONDO[i]; if (!c.luces) continue;
        for (var xx = c.x0 + .4, n = 0; xx < c.x1; xx += 1.3, n++) {
          var rgb = c.lc === 0 ? LUCES[n % 5] : (c.lc === 1 ? '255,214,150' : (n % 2 ? '150,200,255' : '255,250,240'));
          foco(xx, c.h - .1, Z_F, rgb, .1, (.6 + .4 * Math.sin(tt * .006 + n)) * (1 - fogT(dz) * .5));
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function pintaSuelo() {
      P(0, 0, Z_F); var yh = PY, zn = cam.z + NEAR;
      var g = ctx.createLinearGradient(0, yh, 0, H); g.addColorStop(0, 'rgb(50,56,96)'); g.addColorStop(1, 'rgb(152,166,204)');
      ctx.fillStyle = g; ctx.fillRect(0, yh, W, H - yh + 1);
      var rg = ctx.createLinearGradient(0, yh, 0, H); rg.addColorStop(0, 'rgb(32,36,68)'); rg.addColorStop(1, 'rgb(46,50,78)');
      ctx.fillStyle = rg; poly([-4.4, 0, zn, 4.4, 0, zn, 4.4, 0, END - 16, -4.4, 0, END - 16]); ctx.fill();
      // plaza nevada alrededor del arbol
      var pl = [];
      for (var i = 0; i < 28; i++) { var a = i / 28 * 6.2832; pl.push(Math.cos(a) * 12, 0, Math.max(zn, END + Math.sin(a) * 12)); }
      ctx.fillStyle = col(120, 134, 180, END - cam.z); poly(pl); ctx.fill();
      // bordillos con nieve
      ctx.fillStyle = col(196, 208, 236, 40);
      poly([-5, 0, zn, -4.4, 0, zn, -4.4, 0, END - 16, -5, 0, END - 16]); ctx.fill();
      poly([4.4, 0, zn, 5, 0, zn, 5, 0, END - 16, 4.4, 0, END - 16]); ctx.fill();
      // lineas del centro
      ctx.fillStyle = 'rgba(230,236,255,.5)';
      for (var z = Math.ceil(zn / 7) * 7; z < END - 18; z += 7) { poly([-.1, 0, z, .1, 0, z, .1, 0, z + 3, -.1, 0, z + 3]); ctx.fill(); }
    }

    /* ---- Objetos de la calle ---- */
    function pintaCasa(c) {
      var zmin = cam.z + NEAR; if (c.z1 <= zmin || c.z0 - cam.z > 200) return;
      var a = Math.max(c.z0, zmin), b = c.z1, s = c.s, X = 6.5 * s, X2 = 13 * s, XR = 9.6 * s, h = c.h, top = h + c.rh;
      var dzM = (a + b) / 2 - cam.z, i, w;
      if (c.z0 >= zmin) {
        ctx.fillStyle = col(c.c[0] * .55, c.c[1] * .55, c.c[2] * .62, c.z0 - cam.z);
        poly([X, 0, c.z0, X2, 0, c.z0, X2, h, c.z0, XR, top, c.z0, X, h, c.z0]); ctx.fill();
        ctx.fillStyle = col(205, 218, 244, c.z0 - cam.z);
        poly([X - .3 * s, h - .1, c.z0, XR, top + .25, c.z0, X2 + .3 * s, h - .1, c.z0, XR, top - .25, c.z0]); ctx.fill();
      }
      ctx.fillStyle = col(c.c[0], c.c[1], c.c[2], dzM); poly([X, 0, a, X, h, a, X, h, b, X, 0, b]); ctx.fill();
      ctx.fillStyle = col(150, 166, 204, dzM); poly([X - .35 * s, h - .1, a, X - .35 * s, h - .1, b, XR, top, b, XR, top, a]); ctx.fill();
      var Xs = X + (XR - X) * .25, ys = h + c.rh * .25;
      ctx.fillStyle = col(220, 232, 252, dzM); poly([X - .4 * s, h - .18, a, X - .4 * s, h - .18, b, Xs, ys, b, Xs, ys, a]); ctx.fill();
      // ventanas
      for (i = 0; i < c.w.length; i++) {
        w = c.w[i]; if (w.z1 <= zmin) continue;
        var wa = Math.max(w.z0, zmin), dzw = (wa + w.z1) / 2 - cam.z;
        if (w.on) {
          ctx.fillStyle = w.tono < .75 ? col(255, 194, 108, dzw * .5) : col(255, 150, 90, dzw * .5);
          poly([X, w.y0, wa, X, w.y1, wa, X, w.y1, w.z1, X, w.y0, w.z1]); ctx.fill();
          if (dzw < 70) {
            ctx.strokeStyle = col(c.c[0] * .5, c.c[1] * .5, c.c[2] * .5, dzw); P(X, w.y0, w.z1); var lw = Math.max(1, .07 * PS); ctx.lineWidth = lw;
            ctx.beginPath(); var zm = (wa + w.z1) / 2; P(X, w.y0, zm); ctx.moveTo(PX, PY); P(X, w.y1, zm); ctx.lineTo(PX, PY);
            P(X, (w.y0 + w.y1) / 2, wa); ctx.moveTo(PX, PY); P(X, (w.y0 + w.y1) / 2, w.z1); ctx.lineTo(PX, PY); ctx.stroke();
          }
        } else {
          ctx.fillStyle = col(34, 44, 76, dzw); poly([X, w.y0, wa, X, w.y1, wa, X, w.y1, w.z1, X, w.y0, w.z1]); ctx.fill();
        }
      }
      // puerta con corona
      if (c.door && c.door.z1 > zmin) {
        var d = c.door, da = Math.max(d.z0, zmin), dzd = d.zc - cam.z;
        ctx.fillStyle = col(64, 34, 22, dzd); poly([X, 0, da, X, 2.3, da, X, 2.3, d.z1, X, 0, d.z1]); ctx.fill();
        if (d.zc > zmin + .4 && dzd < 90) {
          P(X, 1.65, d.zc - .32); var ax = PX; P(X, 1.65, d.zc + .32); var bx = PX, cy = PY, ry = .32 * PS;
          ctx.strokeStyle = col(30, 120, 64, dzd); ctx.lineWidth = Math.max(1, .12 * PS);
          ctx.beginPath(); ctx.ellipse((ax + bx) / 2, cy, Math.max(.5, Math.abs(bx - ax) / 2), ry, 0, 0, 6.2832); ctx.stroke();
          ctx.fillStyle = col(220, 36, 56, dzd); ctx.beginPath(); ctx.arc((ax + bx) / 2, cy + ry, Math.max(.8, .08 * PS), 0, 6.2832); ctx.fill();
        }
      }
      // luces del techo
      ctx.globalCompositeOperation = 'lighter';
      var paso = .85, k0 = Math.ceil((a - c.z0) / paso), fa = 1 - fogT(dzM) * .5;
      for (var kz = k0; c.z0 + kz * paso < b; kz++) {
        var zz = c.z0 + kz * paso, rgb = c.lc === 0 ? LUCES[(kz + 5) % 5] : (c.lc === 1 ? '255,214,150' : (kz % 2 ? '140,196,255' : '255,250,240'));
        var al = c.lc === 0 ? .5 + .5 * (.5 + .5 * Math.sin(tt * .008 - kz * .9)) : .7 + .3 * Math.sin(tt * .005 + kz * 1.7);
        foco(X - .4 * s, h - .25, zz, rgb, .085, al * fa);
      }
      if (c.z0 >= zmin) {
        for (var gq = 0; gq <= 8; gq++) {
          var u = gq / 8, rgbg = c.lc === 0 ? LUCES[gq % 5] : (c.lc === 1 ? '255,214,150' : (gq % 2 ? '140,196,255' : '255,250,240'));
          foco(X + (XR - X) * u, h + c.rh * u, c.z0 - .05, rgbg, .085, .85 * fa);
          foco(XR + (X2 - XR) * u, top - c.rh * u, c.z0 - .05, rgbg, .085, .85 * fa);
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function pintaFarol(L) {
      var dz = L.z - cam.z; if (dz < NEAR + .4) return;
      var s = L.s, X = 5 * s, fa = 1 - fogT(dz);
      ctx.globalCompositeOperation = 'lighter';
      P(X - .6 * s, 0, L.z); ctx.globalAlpha = .3 * fa; var pr = 3 * PS; ctx.drawImage(sprite('255,190,110', true), PX - pr, PY - pr * .3, pr * 2, pr * .6);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      P(X, 0, L.z); var x0 = PX, y0 = PY; P(X, 4.5, L.z); var x1 = PX, y1 = PY;
      ctx.strokeStyle = col(22, 26, 40, dz); ctx.lineWidth = Math.max(1, .16 * PS); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); P(X - .7 * s, 4.5, L.z); ctx.lineTo(PX, PY); ctx.stroke();
      // franjas de baston de caramelo
      if (dz < 60) {
        ctx.strokeStyle = col(220, 40, 56, dz); ctx.lineWidth = Math.max(1, .17 * PS); ctx.lineCap = 'butt';
        ctx.beginPath();
        for (var yy = .4; yy < 3; yy += .55) { P(X, yy, L.z); ctx.moveTo(PX, PY); P(X, yy + .22, L.z); ctx.lineTo(PX, PY); }
        ctx.stroke(); ctx.lineCap = 'round';
      }
      // moño rojo
      if (dz > 5) {
      P(X, 3.3, L.z); var bs = .32 * PS; ctx.fillStyle = col(225, 36, 56, dz);
      ctx.beginPath(); ctx.moveTo(PX, PY); ctx.lineTo(PX - bs, PY - bs * .6); ctx.lineTo(PX - bs, PY + bs * .6); ctx.closePath();
      ctx.moveTo(PX, PY); ctx.lineTo(PX + bs, PY - bs * .6); ctx.lineTo(PX + bs, PY + bs * .6); ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      P(X - .7 * s, 4.3, L.z); var gr = 1.8 * PS; ctx.globalAlpha = .45 * fa; ctx.drawImage(sprite('255,200,120', true), PX - gr, PY - gr, gr * 2, gr * 2);
      foco(X - .7 * s, 4.3, L.z, '255,222,160', .2, fa);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function estrella5(x, y, R1, r1) {
      ctx.beginPath();
      for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r1 : R1; if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath();
    }
    function pintaGuirnalda(G) {
      var dz = G.z - cam.z; if (dz < NEAR + .4) return;
      var n = 19, i, u, fa = 1 - fogT(dz) * .5;
      ctx.strokeStyle = col(18, 46, 30, dz); ctx.lineWidth = Math.max(1, .07 * (F / dz));
      ctx.beginPath();
      for (i = 0; i < n; i++) { u = i / (n - 1); P(-4.4 + 8.8 * u, 4.9 - 1.2 * 4 * u * (1 - u), G.z); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); }
      ctx.stroke();
      // estrella colgante dorada (muy cerca de la camara no se dibuja: se veria gigante)
      if (dz > 7) {
      P(0, 4.9 - 1.2, G.z); var sy = PY; P(0, 3.15, G.z);
      ctx.strokeStyle = col(160, 140, 90, dz); ctx.lineWidth = Math.max(1, .03 * PS); ctx.beginPath(); ctx.moveTo(PX, sy); ctx.lineTo(PX, PY); ctx.stroke();
      ctx.fillStyle = col(255, 210, 110, dz * .4); estrella5(PX, PY, .5 * PS, .22 * PS); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      var gr = 1.4 * PS; ctx.globalAlpha = (.35 + .15 * Math.sin(tt * .004 + G.g)) * fa; ctx.drawImage(sprite('255,206,110', true), PX - gr, PY - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < n; i++) {
        u = i / (n - 1);
        var al = .45 + .55 * (.5 + .5 * Math.sin(tt * .009 - i * .8 + G.g * 2));
        foco(-4.4 + 8.8 * u, 4.9 - 1.2 * 4 * u * (1 - u) - .14, G.z, LUCES[(i + G.g) % 5], .1, al * fa);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function pintaArbol() {
      var dz = END - cam.z; P(0, 0, END); var bx = PX, by = PY, s = PS, i, dzf = dz * .7;
      ctx.globalCompositeOperation = 'lighter';
      var hr = 9 * s; ctx.globalAlpha = .18 + .22 * litP; ctx.drawImage(sprite('255,190,110', true), bx - hr, by - 7 * s - hr, hr * 2, hr * 2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = col(70, 42, 26, dzf); ctx.fillRect(bx - .45 * s, by - 1.1 * s, .9 * s, 1.1 * s);
      for (i = 0; i < 6; i++) {
        var yb = .9 + i * 1.7, yt = yb + 3.1, r = 4.7 * (1 - i / 6.6), nS = 6, j;
        var g = ctx.createLinearGradient(bx - r * s, 0, bx + r * s, 0);
        g.addColorStop(0, col(8, 40, 26, dzf)); g.addColorStop(.55, col(24, 96, 54, dzf)); g.addColorStop(1, col(10, 54, 32, dzf));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(bx - r * s, by - yb * s);
        for (j = 0; j < nS; j++) { var x0 = -r + 2 * r * j / nS, x1 = -r + 2 * r * (j + 1) / nS; ctx.quadraticCurveTo(bx + (x0 + x1) / 2 * s, by - (yb - .4) * s, bx + x1 * s, by - yb * s); }
        ctx.lineTo(bx, by - yt * s); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(228,238,255,.55)'; ctx.lineWidth = Math.max(1, .14 * s); ctx.beginPath(); ctx.moveTo(bx - r * s, by - yb * s);
        for (j = 0; j < nS; j++) { var x2 = -r + 2 * r * j / nS, x3 = -r + 2 * r * (j + 1) / nS; ctx.quadraticCurveTo(bx + (x2 + x3) / 2 * s, by - (yb - .4) * s, bx + x3 * s, by - yb * s); }
        ctx.stroke();
      }
      // regalos
      var RG = [[-3.2, 1.4, 1.1, [200, 30, 52]], [-1.9, 1.0, .9, [40, 120, 220]], [1.8, 1.2, 1.0, [240, 190, 60]], [3.1, .9, .8, [40, 160, 90]]];
      for (i = 0; i < RG.length; i++) {
        var q = RG[i]; ctx.fillStyle = col(q[3][0], q[3][1], q[3][2], dzf); ctx.fillRect(bx + (q[0] - q[2] / 2) * s, by - q[1] * s, q[2] * s, q[1] * s);
        ctx.fillStyle = col(255, 236, 200, dzf); ctx.fillRect(bx + (q[0] - .08) * s, by - q[1] * s, .16 * s, q[1] * s);
      }
      // bolas
      for (i = 0; i < BOLAS.length; i++) {
        var o = BOLAS[i], on = o.v <= litP, ox = bx + o.x * s, oy = by - o.y * s, orr = Math.max(1, .24 * s);
        ctx.fillStyle = col(o.c[0] * (on ? 1 : .55), o.c[1] * (on ? 1 : .55), o.c[2] * (on ? 1 : .55), dzf);
        ctx.beginPath(); ctx.arc(ox, oy, orr, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,' + (on ? .7 : .25) + ')'; ctx.beginPath(); ctx.arc(ox - orr * .35, oy - orr * .35, orr * .3, 0, 6.2832); ctx.fill();
      }
      // luces (se encienden de abajo hacia arriba)
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < LUZ_ARBOL.length; i++) {
        var l = LUZ_ARBOL[i], lit = l.v <= litP, rr2 = Math.max(2, .55 * s);
        var aa = lit ? .65 + .35 * Math.sin(tt * .007 + l.ph) : .22;
        if (lit && litP < 1 && litP - l.v < .08) { aa = 1; rr2 *= 1.8; }   // chispazo al encenderse
        ctx.globalAlpha = aa; ctx.drawImage(sprite(l.c), bx + l.x * s - rr2, by - l.y * s - rr2, rr2 * 2, rr2 * 2);
      }
      // destello de la estrella (el logo queda encima)
      var tip = by - 12.75 * s;
      if (estrellaT >= 0) {
        var e = (tt - estrellaT) / 1000, big = e < .35 ? e / .35 : Math.max(.45, 1 - (e - .35) * .6);
        var sr = (2.4 + 6 * big) * s; ctx.globalAlpha = .9; ctx.drawImage(sprite('255,226,150', true), bx - sr, tip - sr, sr * 2, sr * 2);
      } else {
        var sr0 = 1.2 * s; ctx.globalAlpha = .5 + .3 * litP; ctx.drawImage(sprite('255,226,150', true), bx - sr0, tip - sr0, sr0 * 2, sr0 * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function pintaNieve(dt) {
      var lw, i, f, dz, a, sz, largo = vel > 6 ? vel * .022 : 0;
      ctx.lineCap = 'round';
      for (i = 0; i < NIEVE.length; i++) {
        f = NIEVE[i];
        f.y -= f.v * dt; f.x += Math.sin(tt * .0013 + f.ph) * .4 * dt;
        if (f.y < 0) f.y += 11;
        if (f.z < cam.z + NEAR + .2) { f.z += 46; f.x = (R() - .5) * 26 + cam.x; }
        else if (f.z > cam.z + 47) f.z -= 46;
        dz = f.z - cam.z; P(f.x, f.y, f.z);
        if (PX < -20 || PX > W + 20 || PY < -20 || PY > H + 20) continue;
        sz = f.r * PS; if (sz < .7) sz = .7; if (sz > 7) sz = 7;
        a = (1 - fogT(dz)) * .9;
        if (largo > 0) {
          var x1 = PX, y1 = PY; P(f.x, f.y, f.z + largo);
          ctx.strokeStyle = 'rgba(236,242,255,' + a.toFixed(3) + ')'; lw = sz; ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(PX, PY); ctx.lineTo(x1, y1); ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(236,242,255,' + a.toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(PX, PY, sz * .6, 0, 6.2832); ctx.fill();
        }
      }
    }
    function pintaMundo(dt) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (skyC) ctx.drawImage(skyC, 0, 0, W, H); else { ctx.fillStyle = '#0a0f2c'; ctx.fillRect(0, 0, W, H); }
      pintaEstrellas(); pintaTrazo(dt); pintaTrineo(); pintaFuegos(dt);
      pintaFondo(); pintaSuelo();
      for (var i = 0; i < ITEMS.length; i++) {
        var it = ITEMS[i];
        if (it.t === 'casa') pintaCasa(it);
        else if (it.t === 'farol') pintaFarol(it);
        else if (it.t === 'guir') pintaGuirnalda(it);
        else pintaArbol();
      }
      pintaNieve(dt);
    }

    /* ---- Chispas del logo (capa de efectos) ---- */
    function chispasConvergen() {
      var c = colocarLogo(), m = Math.min(W, H);
      for (var i = 0; i < 70; i++) {
        var a = R() * 6.2832, d = m * (.3 + R() * .35);
        FXP.push({ t: 'in', x0: c.x + Math.cos(a) * d, y0: c.y + Math.sin(a) * d, cx: c.x, cy: c.y, ini: tt + R() * 160, dur: 420 + R() * 120, rgb: R() < .3 ? '255,246,230' : '255,206,110' });
      }
    }
    function chispasEstallan() {
      var c = colocarLogo(), k = Math.min(W, H) / 700;
      for (var i = 0; i < 90; i++) {
        var a = i / 90 * 6.2832, sp = (160 + R() * 220) * k;
        FXP.push({ t: 'out', x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: .8 + R() * .6, rgb: LUCES[i % 5] });
      }
    }
    function pintaFx(dt) {
      if (!cf) return;
      cf.setTransform(DPR, 0, 0, DPR, 0, 0); cf.clearRect(0, 0, W, H);
      if (!FXP.length) return;
      cf.globalCompositeOperation = 'lighter';
      for (var i = FXP.length - 1; i >= 0; i--) {
        var p = FXP[i], r, x, y;
        if (p.t === 'in') {
          var u = (tt - p.ini) / p.dur; if (u < 0) continue; if (u >= 1) { FXP.splice(i, 1); continue; }
          var e = u * u * u; x = p.x0 + (p.cx - p.x0) * e; y = p.y0 + (p.cy - p.y0) * e; r = 3 + 4 * u;
          cf.globalAlpha = .4 + .6 * u;
        } else {
          p.life += dt; if (p.life >= p.max) { FXP.splice(i, 1); continue; }
          p.vx *= .96; p.vy = p.vy * .96 + 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; x = p.x; y = p.y;
          var a2 = 1 - p.life / p.max; r = 2 + 4 * a2; cf.globalAlpha = a2;
        }
        cf.drawImage(sprite(p.rgb), x - r * 2, y - r * 2, r * 4, r * 4);
      }
      cf.globalAlpha = 1; cf.globalCompositeOperation = 'source-over';
    }

    function cuadro(now) {
      if (cerrada) return;
      tt = now - t0;
      var dt = (now - tUlt) / 1000; if (!(dt > 0) || dt > .05) dt = .016; tUlt = now;
      camara(tt);
      vel = (cam.z - zAnt) / dt; zAnt = cam.z;
      litP = tt < T.arbol ? 0 : cl((tt - T.arbol) / 560, 0, 1);
      if (dibujar) { try { pintaMundo(dt); } catch (e) { dibujar = false; } }   // si el dibujo falla, queda el ultimo cuadro y sigue el resto
      try { pintaFx(dt); } catch (e) { cf = null; }
      var g = Math.min(1, tt / T.salir), gp = 1 - Math.pow(1 - g, 1.6);
      fillEl.style.width = (gp * 100).toFixed(1) + '%'; pctEl.textContent = Math.round(gp * 100) + '%';
      raf = requestAnimationFrame(cuadro);
    }

    try { medir(); window.addEventListener('resize', alCambiar); } catch (e) { dibujar = false; }

    if (REDUCIDO) {
      try { cam.x = 0; cam.y = 2.2; cam.z = CAM_FIN; HY = H * HYF; litP = 1; tt = 0; NIEVE.length = 0; pintaMundo(0); } catch (_) {}
      el.classList.add('nv-on', 'nv-quieto', 'nv-mark', 'nv-tit');
      el.querySelectorAll('.nv-l').forEach(function (l) { l.classList.add('on'); });
      frases[2].classList.add('in'); greet.classList.add('on'); fillEl.style.width = '100%'; pctEl.textContent = '100%';
      setTimeout(function () { cerrar(true); }, 2400);
      return;
    }

    t0 = performance.now(); tUlt = t0;
    raf = requestAnimationFrame(cuadro);
    requestAnimationFrame(function () { el.classList.add('nv-on'); });
    agenda(T.intro, function () { intro.classList.add('on'); });
    agenda(T.introOut, function () { intro.classList.remove('on'); intro.classList.add('out'); });
    agenda(T.marca - 560, chispasConvergen);
    agenda(T.estrella, function () {
      estrellaT = tt; colocarLogo(); el.classList.add('nv-flash');
      cohete(.2, .2, LUCES[0]);
    });
    agenda(T.marca, function () { el.classList.add('nv-mark'); chispasEstallan(); });
    agenda(T.estrella + 380, function () { cohete(.8, .16, LUCES[1]); });
    agenda(T.estrella + 850, function () { cohete(.34, .12, LUCES[2]); });
    agenda(T.estrella + 1350, function () { cohete(.68, .24, LUCES[3]); });
    agenda(T.estrella + 1900, function () { cohete(.14, .14, LUCES[1]); });
    agenda(T.estrella + 2450, function () { cohete(.86, .22, LUCES[0]); });
    agenda(T.nombre, function () { el.querySelectorAll('.nv-l').forEach(function (l, i) { l.style.transitionDelay = (i * 55) + 'ms'; l.classList.add('on'); }); });
    agenda(T.titulo, function () { el.classList.add('nv-tit'); });
    agenda(T.fraseA, function () { mostrarFrase(0); });
    agenda(T.fraseB, function () { mostrarFrase(1); });
    agenda(T.fraseC, function () { mostrarFrase(2); });
    agenda(T.saludo, function () { greet.classList.add('on'); });
    agenda(T.salir, function () { cerrar(false); });
  }

  /* ============================================================
     ESCENA BLANCA "Apertura" (normal, todo el año salvo Halloween y
     Octubre Rosa): fondo blanco, estilo apertura de cine (~7.4 s).
     MISMAS reglas que siempre: solo en pantallas de entrada, una vez
     por sesion y usuario, boton "Saltar", tecla Esc, cierre de
     seguridad a los 10 s, respeta "reducir animaciones" y, si algo
     falla, se quita sola. No guarda nada ni llama al servidor.
     GUION:
       0.0 s  Blanco limpio, luz suave y particulas de polvo en el aire.
       0.3 s  Un haz de luz horizontal cruza la pantalla.
       0.7 s  Las 4 piezas del logotipo vuelan y encajan en el centro.
       1.7 s  Onda de choque, destello que barre el logo y se dibuja
              el aro de 360 grados; sombra de suelo bajo el logo.
       2.3 s  El nombre se abre desde el logo; "360" cuenta de 000 a 360.
       3.9 s  Titulos: "Controla tu negocio" / "Vende más" / "Gana más".
       6.0 s  Saludo segun la hora y el mes en curso.
       6.9 s  Cierre con desvanecimiento suave que revela el sistema.
     ============================================================ */
  function escenaBlanca(REDUCIDO) {
    var T = { haz: 300, piezas: 700, lock: 1750, nombre: 2300, cuentaIni: 2500, cuentaFin: 3700,
              fraseA: 4000, fraseB: 4900, fraseC: 5700, saludo: 6300, salir: 7200, seguridad: 10000 };
    var LOGO = 'negocio360-isotipo.png';
    var style = document.createElement('style');
    style.id = 'n360-welcome-style';
    style.textContent = `
#n360-welcome { --navy: #06215f; --blue: #1f6bff; --sky: #8db8ff; --ink: #0b1b3f; --mute: #5b6b8f; --ease: cubic-bezier(.16,1,.3,1);
  position: fixed; inset: 0; z-index: 100000; overflow: hidden; display: flex; align-items: center; justify-content: center;
  font-family: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
  background: radial-gradient(ellipse 85% 75% at 50% 45%, #ffffff 0%, #ffffff 60%, #f4f7fd 100%); transition: opacity .8s ease; }
#n360-welcome.nb-exit { opacity: 0; pointer-events: none; }
#n360-welcome *, #n360-welcome *::before, #n360-welcome *::after { box-sizing: border-box; }
.nb-grain { position: absolute; inset: 0; pointer-events: none; opacity: .05; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.nb-leak { position: absolute; width: 70vmax; height: 70vmax; border-radius: 50%; pointer-events: none; opacity: 0; transition: opacity 2.4s ease;
  background: radial-gradient(circle, rgba(31,107,255,.08) 0%, rgba(31,107,255,0) 62%); }
.nb-leak.a { left: -22vmax; top: -30vmax; } .nb-leak.b { right: -26vmax; bottom: -34vmax; background: radial-gradient(circle, rgba(141,184,255,.12) 0%, rgba(141,184,255,0) 62%); }
#n360-welcome.nb-on .nb-leak { opacity: 1; }
#n360-welcome.nb-on .nb-leak.a { animation: nb-drift 9s ease-in-out infinite alternate; }
#n360-welcome.nb-on .nb-leak.b { animation: nb-drift 11s ease-in-out infinite alternate-reverse; }
@keyframes nb-drift { from { transform: translate3d(0,0,0); } to { transform: translate3d(3vmax,2vmax,0); } }
canvas.nb-dust { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 1.6s ease; }
#n360-welcome.nb-on canvas.nb-dust { opacity: 1; }
.nb-vig { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 48%, transparent 62%, rgba(14,34,84,.045) 100%); }
/* haz de luz horizontal (anamorfico) */
.nb-streak { position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; pointer-events: none; opacity: 0; transform: scaleX(0);
  background: linear-gradient(90deg, transparent 0%, rgba(31,107,255,.0) 8%, rgba(31,107,255,.55) 50%, rgba(31,107,255,0) 92%, transparent 100%); }
.nb-streak::after { content: ''; position: absolute; left: 20%; right: 20%; top: -9px; height: 20px; background: radial-gradient(ellipse at center, rgba(141,184,255,.35), transparent 70%); }
#n360-welcome.nb-haz .nb-streak { animation: nb-haz 1.5s cubic-bezier(.3,.1,.2,1) forwards; }
@keyframes nb-haz { 0% { opacity: 0; transform: scaleX(0); } 25% { opacity: 1; } 70% { opacity: 1; transform: scaleX(1); } 100% { opacity: 0; transform: scaleX(1.15); } }
/* camara: empuje lento hacia adelante */
.nb-cam { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; padding: 0 20px; will-change: transform; }
#n360-welcome.nb-on .nb-cam { animation: nb-push 7.6s cubic-bezier(.25,.1,.25,1) forwards; }
@keyframes nb-push { from { transform: scale(.965); } to { transform: scale(1.045); } }
.nb-lockup { display: flex; align-items: center; justify-content: center; position: relative; }
.nb-mark { position: relative; width: var(--M); height: var(--M); flex: none; }
#n360-welcome { --M: clamp(92px, 15vmin, 150px); }
.nb-floor { position: absolute; left: 50%; bottom: -26%; width: 92%; height: 16%; margin-left: -46%; border-radius: 50%; opacity: 0; transform: scale(.4);
  background: radial-gradient(ellipse at center, rgba(6,33,95,.30), rgba(6,33,95,0) 70%); transition: opacity 1s ease, transform 1.2s var(--ease); }
#n360-welcome.nb-lock .nb-floor { opacity: 1; transform: scale(1); }
.nb-piece { position: absolute; inset: 0; opacity: 0; will-change: transform, opacity;
  transition: transform 1.15s var(--ease), opacity .5s ease; }
.nb-piece img, .nb-whole img { width: 100%; height: 100%; display: block; object-fit: contain; }
.nb-piece.q0 { clip-path: inset(0 49.6% 49.6% 0); transform: translate(-70px,-60px) rotate(-22deg) scale(1.35); }
.nb-piece.q1 { clip-path: inset(0 0 49.6% 49.6%); transform: translate(70px,-60px) rotate(22deg) scale(1.35); }
.nb-piece.q2 { clip-path: inset(49.6% 49.6% 0 0); transform: translate(-70px,60px) rotate(22deg) scale(1.35); }
.nb-piece.q3 { clip-path: inset(49.6% 0 0 49.6%); transform: translate(70px,60px) rotate(-22deg) scale(1.35); }
.nb-piece.go { opacity: 1; transform: none; }
.nb-whole { position: absolute; inset: 0; opacity: 0; }
#n360-welcome.nb-lock .nb-whole { opacity: 1; } #n360-welcome.nb-lock .nb-piece { opacity: 0; transition: none; }
/* destello que barre el logo (solo donde hay logo, usando su silueta) */
.nb-sheen { position: absolute; inset: 0; opacity: 0; pointer-events: none;
  -webkit-mask: url(__LOGO__) center / contain no-repeat; mask: url(__LOGO__) center / contain no-repeat;
  background: linear-gradient(105deg, transparent 38%, rgba(255,255,255,.95) 50%, transparent 62%) -160% 0 / 260% 100% no-repeat; }
#n360-welcome.nb-lock .nb-sheen { animation: nb-sheen 1.3s cubic-bezier(.4,.1,.2,1) .1s forwards; }
@keyframes nb-sheen { 0% { opacity: 1; background-position: -160% 0; } 100% { opacity: 1; background-position: 160% 0; } }
.nb-shock { position: absolute; left: 50%; top: 50%; width: 100%; height: 100%; margin: -50% 0 0 -50%; border-radius: 50%; border: 1.5px solid rgba(31,107,255,.5); opacity: 0; pointer-events: none; }
#n360-welcome.nb-lock .nb-shock { animation: nb-shock 1.3s cubic-bezier(.15,.7,.2,1) forwards; }
@keyframes nb-shock { 0% { opacity: .85; transform: scale(.9); } 100% { opacity: 0; transform: scale(3.1); } }
.nb-ring { position: absolute; left: -17%; top: -17%; width: 134%; height: 134%; pointer-events: none; transform: rotate(-90deg); overflow: visible; }
.nb-ring circle { fill: none; stroke: var(--blue); stroke-width: 1.4; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; opacity: .8; }
#n360-welcome.nb-lock .nb-ring circle { animation: nb-ring 1.6s cubic-bezier(.5,0,.15,1) .15s forwards; }
@keyframes nb-ring { to { stroke-dashoffset: 0; } }
/* nombre: se abre desde el logo */
.nb-word { display: flex; align-items: baseline; overflow: hidden; max-width: 0; opacity: 0; white-space: nowrap; padding: .1em 0;
  font-size: calc(var(--M) * .62); font-weight: 800; letter-spacing: -.04em; line-height: 1.1; color: var(--navy);
  transition: max-width 1.25s var(--ease), margin-left 1.25s var(--ease), opacity .5s ease; }
#n360-welcome.nb-nombre .nb-word { max-width: 9.2em; margin-left: calc(var(--M) * .22); opacity: 1; }
.nb-word .ch { display: inline-block; transform: translateX(-.6em); opacity: 0; transition: transform .9s var(--ease), opacity .6s ease; }
#n360-welcome.nb-nombre .nb-word .ch { transform: none; opacity: 1; }
.nb-num { display: inline-block; min-width: 3ch; margin-left: .05em; font-variant-numeric: tabular-nums; color: var(--blue); text-align: left; }
.nb-num i { font-style: normal; opacity: .32; }
/* titulos tipo cine */
.nb-say { position: relative; height: 3.2em; width: min(680px, 92vw); margin-top: clamp(18px, 4vh, 36px); font-size: clamp(15px, 2.1vw, 20px); }
.nb-say p { position: absolute; inset: 0; margin: 0; display: flex; align-items: flex-start; justify-content: center; text-align: center;
  font-weight: 300; letter-spacing: .5em; color: var(--ink); opacity: 0; transform: translateY(6px); text-transform: none;
  transition: opacity .7s ease, letter-spacing 1.6s cubic-bezier(.2,.7,.2,1), transform .9s var(--ease); }
.nb-say p.in { opacity: 1; letter-spacing: .16em; transform: none; }
.nb-say p.out { opacity: 0; letter-spacing: .09em; transform: translateY(-6px); transition: opacity .45s ease, letter-spacing .6s ease, transform .5s ease; }
.nb-say p.fin { font-weight: 600; background: linear-gradient(92deg, var(--navy), var(--blue)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.nb-greet { margin: 0; min-height: 22px; font-size: 14px; font-weight: 500; color: var(--mute); opacity: 0; transform: translateY(8px); transition: opacity .8s ease, transform .8s ease; }
.nb-greet.on { opacity: 1; transform: none; }
.nb-foot { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgba(6,33,95,.06); z-index: 3; }
.nb-fill { height: 100%; width: 0; background: linear-gradient(90deg, var(--navy), var(--blue)); }
.nb-skip { position: absolute; top: 20px; right: 20px; z-index: 5; padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(6,33,95,.16);
  background: rgba(255,255,255,.7); color: var(--mute); font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
  opacity: 0; transition: opacity .5s ease 1s, background .2s, color .2s, border-color .2s; }
#n360-welcome.nb-on .nb-skip { opacity: 1; }
.nb-skip:hover { background: #fff; color: var(--navy); border-color: rgba(6,33,95,.32); }
.nb-skip:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
@media (max-width: 560px) { #n360-welcome { --M: clamp(70px, 20vmin, 96px); } .nb-lockup { flex-direction: column; } #n360-welcome.nb-nombre .nb-word { margin-left: 0; margin-top: calc(var(--M) * .16); }
  .nb-word { max-width: 0; } #n360-welcome.nb-nombre .nb-word { max-width: 9.2em; } .nb-say p { letter-spacing: .3em; } .nb-say p.in { letter-spacing: .1em; } .nb-skip { top: 14px; right: 14px; } }
/* Reducir animaciones: composicion final fija */
#n360-welcome.nb-quieto *, #n360-welcome.nb-quieto *::before, #n360-welcome.nb-quieto *::after { animation: none !important; transition: none !important; }
#n360-welcome.nb-quieto .nb-whole { opacity: 1; } #n360-welcome.nb-quieto .nb-piece { opacity: 0; }
#n360-welcome.nb-quieto .nb-word { max-width: 9.2em; opacity: 1; margin-left: calc(var(--M) * .22); } #n360-welcome.nb-quieto .nb-word .ch { opacity: 1; transform: none; }
#n360-welcome.nb-quieto .nb-greet, #n360-welcome.nb-quieto .nb-skip, #n360-welcome.nb-quieto .nb-floor { opacity: 1; transform: none; }
#n360-welcome.nb-quieto .nb-ring circle { stroke-dashoffset: 0; } #n360-welcome.nb-quieto .nb-sheen, #n360-welcome.nb-quieto .nb-shock, #n360-welcome.nb-quieto .nb-streak { display: none; }
`;
    style.textContent = style.textContent.split('__LOGO__').join(LOGO);
    document.head.appendChild(style);

    var letras = 'Negocio'.split('').map(function (c, i) { return '<span class="ch" style="transition-delay:' + (i * 55) + 'ms">' + c + '</span>'; }).join('');
    var piezas = [0, 1, 2, 3].map(function (q) { return '<div class="nb-piece q' + q + '"><img src="' + LOGO + '" alt="" /></div>'; }).join('');
    var cont = document.createElement('div');
    cont.innerHTML =
      '<div id="n360-welcome" role="dialog" aria-modal="true" aria-label="Bienvenido a Negocio360">' +
        '<span class="nb-leak a"></span><span class="nb-leak b"></span><canvas class="nb-dust"></canvas><div class="nb-grain"></div><div class="nb-vig"></div>' +
        '<div class="nb-streak"></div>' +
        '<div class="nb-cam">' +
          '<div class="nb-lockup">' +
            '<div class="nb-mark">' +
              '<span class="nb-floor"></span>' + piezas +
              '<div class="nb-whole"><img src="' + LOGO + '" alt="" /></div><span class="nb-sheen"></span><span class="nb-shock"></span>' +
              '<svg class="nb-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49" pathLength="1"/></svg>' +
            '</div>' +
            '<h1 class="nb-word" aria-label="Negocio360" style="margin-top:0;margin-bottom:0">' + letras + '<span class="nb-num" id="nbNum"><i>00</i>0</span></h1>' +
          '</div>' +
          '<div class="nb-say" aria-hidden="true"><p>Controla tu negocio</p><p>Vende más</p><p class="fin">Gana más</p></div>' +
          '<p class="nb-greet" id="nbGreet"></p>' +
        '</div>' +
        '<div class="nb-foot"><div class="nb-fill" id="nbFill"></div></div>' +
        '<button type="button" class="nb-skip" id="nbSkip">Saltar</button>' +
      '</div>';
    var el = cont.firstElementChild;
    document.body.appendChild(el);

    var timers = [], raf = 0, cerrada = false, t0 = 0;
    var $ = function (s) { return el.querySelector(s); };
    var numEl = $('#nbNum'), fillEl = $('#nbFill'), greet = $('#nbGreet');
    var frases = Array.prototype.slice.call(el.querySelectorAll('.nb-say p'));
    var piezasEl = Array.prototype.slice.call(el.querySelectorAll('.nb-piece'));
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
      greet.textContent = f ? s + '. Bienvenido a ' + f + '.' : s + '.';
    }
    function mostrarFrase(i) {
      frases.forEach(function (p, j) {
        if (j !== i && p.classList.contains('in')) { p.classList.remove('in'); p.classList.add('out'); }
      });
      agenda(i === 0 ? 0 : 380, function () { frases[i].classList.remove('out'); frases[i].classList.add('in'); });   // la anterior sale primero: nunca se montan
    }

    /* Polvo en el aire (canvas): pocas particulas suaves, se pausa al cerrar */
    var cv = $('canvas.nb-dust'), ctx = null, W = 0, H = 0, P = [];
    function iniciaPolvo() {
      try {
        ctx = cv.getContext('2d'); if (!ctx) return;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = el.clientWidth; H = el.clientHeight;
        cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.max(22, Math.min(46, Math.floor(W * H / 30000)));
        for (var i = 0; i < n; i++) P.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .12, vy: -(Math.random() * .22 + .05), r: Math.random() * 1.8 + .6, a: Math.random() * .35 + .12, f: Math.random() * 6.28 });
      } catch (e) { ctx = null; }
    }
    function dibujaPolvo(t) {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < P.length; i++) {
        var p = P[i]; p.x += p.vx + Math.sin(t / 1800 + p.f) * .05; p.y += p.vy;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        ctx.fillStyle = 'rgba(31,107,255,' + (p.a * (.6 + .4 * Math.sin(t / 900 + p.f))).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
      }
    }
    /* Un solo reloj: cuenta 0->360, progreso y polvo */
    function cuadro(now) {
      if (cerrada) return;
      var t = now - t0;
      var p = Math.max(0, Math.min(1, (t - T.cuentaIni) / (T.cuentaFin - T.cuentaIni)));
      if (t >= T.cuentaIni) pintaNumero((1 - Math.pow(1 - p, 3)) * 360);
      fillEl.style.width = (Math.min(1, t / T.salir) * 100).toFixed(1) + '%';
      dibujaPolvo(now);
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
      el.classList.add('nb-exit');
      setTimeout(quitar, rapido ? 500 : 900);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(true); }

    $('#nbSkip').addEventListener('click', function () { cerrar(true); });
    document.addEventListener('keydown', alTeclado);
    setTimeout(function () { if (!cerrada) { cerrada = true; quitar(); } }, T.seguridad);   // cierre de seguridad
    saludo();
    var imgs = el.querySelectorAll('img');
    for (var k = 0; k < imgs.length; k++) imgs[k].onerror = function () { this.style.visibility = 'hidden'; };   // sin logo: no queda un icono roto

    if (REDUCIDO) {
      el.classList.add('nb-on', 'nb-quieto', 'nb-lock', 'nb-nombre');
      pintaNumero(360); frases[2].classList.add('in', 'fin'); greet.classList.add('on');
      fillEl.style.width = '100%';
      setTimeout(function () { cerrar(true); }, 1800);
      return;
    }
    iniciaPolvo();
    t0 = performance.now();
    raf = requestAnimationFrame(cuadro);
    requestAnimationFrame(function () { el.classList.add('nb-on'); });
    agenda(T.haz, function () { el.classList.add('nb-haz'); });
    piezasEl.forEach(function (p, i) { agenda(T.piezas + i * 110, function () { p.classList.add('go'); }); });
    agenda(T.lock, function () { el.classList.add('nb-lock'); });
    agenda(T.nombre, function () { el.classList.add('nb-nombre'); });
    agenda(T.fraseA, function () { mostrarFrase(0); });
    agenda(T.fraseB, function () { mostrarFrase(1); });
    agenda(T.fraseC, function () { mostrarFrase(2); });
    agenda(T.saludo, function () { greet.classList.add('on'); });
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

    // Temporada navideña (3 nov – 6 ene): escena propia, mismas reglas.
    if (esNavidad()) { escenaNavidad(REDUCIDO); return; }

    // Temporada de Halloween (20 oct – 2 nov): escena propia, mismas reglas.
    if (esHalloween()) { escenaHalloween(REDUCIDO); return; }

    // Resto del año (fuera de Halloween y Octubre Rosa): escena blanca de apertura.
    // Para ver la anterior (dial azul): agregar ?bienvenida=dial a la URL.
    var verDial = false; try { verDial = (location.search || '').toLowerCase().indexOf('bienvenida=dial') !== -1; } catch (_) {}
    if (!ROSA && !verDial) { escenaBlanca(REDUCIDO); return; }

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
