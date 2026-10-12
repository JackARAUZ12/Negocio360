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
   TEMPORADA: en octubre se activa solo el tema "Octubre Rosa"
   (paleta rosa, logo rosa y lazo). Fuera de octubre no cambia nada.
   ============================================================ */
(function () {
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

    /* ---------------- Tiempos (ms) ---------------- */
    var T = {
      logo: 150, cuentaIni: 800, cuentaFin: 3500, letras: 450, modulos: 1100, modPaso: 260,
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
.nw-logo img { width: 100%; height: 100%; object-fit: contain; display: block;
  opacity: 0; transform: scale(.55) rotate(-18deg); filter: blur(10px) drop-shadow(0 8px 26px var(--glow));
  transition: opacity .9s ease, transform 1.1s cubic-bezier(.18,.9,.28,1.2), filter 1.1s ease; }
#n360-welcome.nw-on .nw-logo img { opacity: 1; transform: scale(1) rotate(0); filter: blur(0) drop-shadow(0 8px 26px var(--glow)); }
#n360-welcome.nw-lock .nw-logo img { animation: nw-pulse 1.2s ease-out; }
@keyframes nw-pulse { 0% { filter: drop-shadow(0 8px 26px var(--glow)); } 35% { filter: drop-shadow(0 0 38px var(--a2)) brightness(1.25); } 100% { filter: drop-shadow(0 8px 26px var(--glow)); } }
/* Marcador de inicio del dial: flecha (o lazo en Octubre Rosa) */
.nw-pin { position: absolute; left: 50%; top: 1.6%; width: 6%; margin-left: -3%; z-index: 4; opacity: 0; transition: opacity .6s ease .5s; }
#n360-welcome.nw-on .nw-pin { opacity: 1; }
.nw-pin svg { width: 100%; display: block; }
.nw-rosa .nw-pin { width: 11%; margin-left: -5.5%; top: -1%; filter: drop-shadow(0 3px 10px rgba(236,72,153,.7)); animation: nw-bob 2.4s ease-in-out infinite; }
@keyframes nw-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
.nw-pin-flecha { display: block; } .nw-pin-lazo { display: none; }
.nw-rosa .nw-pin-flecha { display: none; } .nw-rosa .nw-pin-lazo { display: block; }

/* ---------- Modulos alrededor del dial ---------- */
.nw-chip { position: absolute; z-index: 4; width: 11.5%; aspect-ratio: 1; margin: -5.75% 0 0 -5.75%;
  display: flex; align-items: center; justify-content: center; border-radius: 50%;
  background: rgba(255,255,255,.07); border: 1px solid var(--line); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
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
.nw-l { display: inline-block; opacity: 0; transform: translateY(.55em); filter: blur(6px);
  transition: opacity .5s ease, transform .6s cubic-bezier(.2,.85,.3,1.1), filter .5s ease; }
.nw-l.on { opacity: 1; transform: none; filter: none; }
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
.nw-cause { display: none; align-items: center; justify-content: center; gap: 8px; margin: 10px 0 0; font-size: 13.5px; font-weight: 600; color: var(--a1);
  opacity: 0; transform: translateY(8px); transition: opacity .7s ease .25s, transform .7s ease .25s; }
.nw-rosa .nw-cause { display: flex; }
.nw-cause.on { opacity: 1; transform: none; }
.nw-cause svg { width: 18px; height: 18px; flex: none; }

/* ---------- Progreso y control ---------- */
.nw-foot { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; padding: 0 22px 16px; display: flex; align-items: center; gap: 12px; }
.nw-bar { flex: 1; height: 3px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; }
.nw-bar-fill { height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, var(--a2), var(--a1)); box-shadow: 0 0 12px var(--a2); }
.nw-pct { font-size: 12px; font-weight: 600; color: var(--soft); font-variant-numeric: tabular-nums; min-width: 3.2ch; text-align: right; }
.nw-skip { position: absolute; top: 20px; right: 20px; z-index: 5; padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2);
  background: rgba(255,255,255,.07); color: rgba(255,255,255,.82); font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; transition: opacity .5s ease 1s, background .2s, border-color .2s; }
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
          '<p class="nw-cause">' + lazo + '<span>Octubre Rosa: juntos contra el cáncer de mama</span></p>' +
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
      greet.textContent = f ? s + '. Bienvenido a ' + f + '.' : s + '.';
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
    agenda(T.saludo, function () { greet.classList.add('on'); cause.classList.add('on'); });
    agenda(T.salir, function () { cerrar(false); });
  } catch (e) {
    try { var w = document.getElementById('n360-welcome'); if (w && w.parentNode) w.parentNode.removeChild(w); } catch (_) {}
  }
})();
