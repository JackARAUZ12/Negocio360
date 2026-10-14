"""Editor del TikTok "Tu negocio vende, pero tu sigues sin dinero" — Negocio360.

Uso:  python3 build.py            -> render final  (salida/negocio360_tiktok.mp4)
      python3 build.py --preview  -> render rapido a 540x960

Cada toma se busca en clips/ (mp4/mov/jpg/png). Si falta, se dibuja un marcador
"INSERTAR ..." en su lugar, de modo que el montaje, los tiempos, subtitulos, musica
y efectos ya quedan listos y solo hay que soltar los archivos y volver a renderizar.
"""
import json, math, os, subprocess, sys, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import audio
import generado

AQUI = os.path.dirname(os.path.abspath(__file__))
os.chdir(AQUI)
PREVIEW = "--preview" in sys.argv
W, H, FPS = 1080, 1920, 30
REPO = os.path.abspath(os.path.join(AQUI, "..", ".."))
LOGO = os.path.join(REPO, "negocio360-logo-light-bg.png")

FONT_BLACK = "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
FONT_XB = "/usr/share/fonts/opentype/inter/InterDisplay-ExtraBold.otf"
FONT_B = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

AMARILLO = (255, 214, 10)
ROJO = (255, 69, 58)
AZUL = (20, 82, 240)          # azul del logotipo
VERDE = (48, 209, 88)
NAVY = (8, 28, 78)            # azul oscuro del logotipo
BLANCO = (255, 255, 255)

PAL = json.load(open("assets/palabras.json"))   # [inicio, fin, palabra] sobre assets/voz.wav
def w(i): return PAL[i][0]
def we(i): return PAL[i][1]

DUR = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                            "assets/voz.wav"], capture_output=True, text=True).stdout)

# ------------------------------------------------------------------ MONTAJE
# (slot, inicio, fin, opciones)  — slot = nombre de archivo en clips/ sin extension
# presentador: toma continua sincronizada con la voz (t de la toma = t del video)
T_UI = w(70)          # "...de tus VENTAS" -> entra la interfaz real
T_LOGO = w(90)        # "No administres..." -> cierre con logotipo
ESCENAS = [
    # 0 – gancho: primer plano + acercamiento sutil durante la pregunta
    ("presentador", 0.0, w(17), dict(zoom=(1.00, 1.08), tipo="A")),
    # identificacion del problema: cortes breves de B-roll
    ("b_proveedores", w(17), w(19), dict(tipo="B", desc="Pago a proveedores (billetes/transferencia)")),
    ("b_mercancia", w(19), w(21), dict(tipo="B", desc="Mercancia / compra de inventario")),
    ("b_libreta", w(21), w(26), dict(tipo="B", desc="Libreta de cuentas pendientes / fiado")),
    ("b_facturas", w(26), w(31), dict(tipo="B", desc="Facturas sobre el mostrador")),
    ("presentador", w(31), w(40), dict(zoom=(1.04, 1.04), tipo="A")),
    # frase de impacto: punch-in en "vender mucho no significa ganar mucho"
    ("presentador", w(40), w(46), dict(zoom=(1.14, 1.17), tipo="A", oscurecer=0.25)),
    ("presentador", w(46), T_UI, dict(zoom=(1.0, 1.03), tipo="A")),
    # Negocio360: grabaciones reales de la interfaz (se recorta el inicio de cada grabacion)
    ("ui_ventas", T_UI, w(71), dict(tipo="UI", desc="Ventas", entrada="whip")),
    ("ui_gastos", w(71), w(72), dict(tipo="UI", desc="Gastos")),
    ("ui_caja", w(72), w(73), dict(tipo="UI", desc="Caja")),
    ("ui_cuentas_pendientes", w(73), w(76), dict(tipo="UI", desc="Cuentas pendientes (creditos / fiados / por pagar)")),
    ("ui_menu", w(76), w(81), dict(tipo="UI", desc="Menu de modulos")),
    ("ui_dashboard", w(81), T_LOGO, dict(tipo="UI", desc="Dashboard", scroll=1300)),
    ("__logo__", T_LOGO, DUR, dict(tipo="LOGO")),
]

# Subtitulos: texto EXACTO del guion, cronometrado por palabra. (texto, i_ini, i_fin, {palabra: color})
SUBS = [
    ("¿Tu negocio vende", 0, 2, {}),
    ("miles de córdobas,", 3, 5, {}),
    ("pero cuando revisas", 6, 8, {}),
    ("tu bolsillo…", 9, 10, {}),
    ("no tienes", 11, 12, {}),
    ("ni para los gastos?", 13, 16, {}),
    ("Pagas proveedores,", 17, 18, {"proveedores,": AMARILLO}),
    ("compras mercancía,", 19, 20, {}),
    ("das crédito", 21, 22, {"crédito": AMARILLO}),
    ("a tus clientes…", 23, 25, {}),
    ("y al final del mes", 26, 30, {}),
    ("no sabes", 31, 32, {}),
    ("dónde quedó", 33, 34, {"dónde": AMARILLO, "quedó": AMARILLO}),
    ("todo el dinero.", 35, 37, {"dinero.": AMARILLO}),
    ("Y cuidado:", 38, 39, {}),
    # 40–45: "vender mucho no significa ganar mucho" -> texto grande central (ver ENFASIS)
    ("Una cosa son tus ventas,", 46, 50, {"ventas,": (90, 150, 255)}),
    ("otra tus gastos", 51, 53, {"gastos": ROJO}),
    ("y otra el dinero", 54, 57, {"dinero": VERDE}),
    ("que realmente tienes disponible.", 58, 61, {"disponible.": VERDE}),
    ("Por eso necesitas", 62, 64, {}),
    ("llevar el control", 65, 67, {"control": AMARILLO}),
    ("de tus ventas,", 68, 70, {"ventas,": AMARILLO}),
    ("gastos,", 71, 71, {"gastos,": AMARILLO}),
    ("caja", 72, 72, {"caja": AMARILLO}),
    ("y cuentas pendientes.", 73, 75, {"cuentas": AMARILLO, "pendientes.": AMARILLO}),
    ("Con Negocio360", 76, 78, {"Negocio360": (90, 150, 255)}),
    ("puedes organizar la información", 79, 82, {}),
    ("de tu negocio", 83, 85, {}),
    ("en un solo sistema.", 86, 89, {"solo": AMARILLO, "sistema.": AMARILLO}),
]
# Efectos de sonido discretos (tiempo, tipo)
SFX = [(0.0, "golpe"), (w(17), "whoosh"), (w(19), "pop"), (w(21), "pop"), (w(26), "pop"),
       (w(31), "whoosh"), (w(33), "pop"), (w(40), "golpe"), (w(50), "pop"), (w(53), "pop"),
       (w(57), "pop"), (T_UI, "whoosh"), (w(71), "pop"), (w(72), "pop"), (w(73), "pop"),
       (T_LOGO, "whoosh"), (w(96), "pop")]

# ------------------------------------------------------------------ UTILIDADES GRAFICAS
_fonts = {}
def font(path, size):
    k = (path, size)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(path, size)
    return _fonts[k]


def ease_out(x):
    x = min(max(x, 0), 1)
    return 1 - (1 - x) ** 3


def texto_rico(palabras, size, ancho_max, stroke=10, path=FONT_BLACK, sombra=True, contorno=True):
    """palabras: lista [(texto, color, escala)] -> RGBA centrado, con salto de linea."""
    f_base = font(path, size)
    espacio = f_base.getlength(" ")
    lineas, actual, ancho = [], [], 0
    for t, c, e in palabras:
        if t == "\n":
            lineas.append(actual); actual, ancho = [], 0
            continue
        f = font(path, int(size * e))
        lw = f.getlength(t)
        if actual and ancho + espacio + lw > ancho_max:
            lineas.append(actual); actual, ancho = [], 0
        actual.append((t, c, f, lw)); ancho += (espacio if len(actual) > 1 else 0) + lw
    if actual:
        lineas.append(actual)
    alto_l = int(size * 1.18)
    img_w = int(ancho_max + 4 * stroke)
    img_h = int(alto_l * len(lineas) + size * 0.5 + 4 * stroke)
    img = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = 2 * stroke
    for ln in lineas:
        total = sum(x[3] for x in ln) + espacio * (len(ln) - 1)
        x = (img_w - total) / 2
        for t, c, f, lw in ln:
            off = (alto_l - f.size * 1.18) * 0.75
            d.text((x, y + off), t, font=f, fill=c, stroke_width=stroke if contorno else 0, stroke_fill=(0, 0, 0))
            x += lw + espacio
        y += alto_l
    if sombra:
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sh.putalpha(img.getchannel("A").point(lambda a: a * 0.55))
        sh = sh.filter(ImageFilter.GaussianBlur(10))
        base = Image.new("RGBA", img.size, (0, 0, 0, 0))
        base.alpha_composite(sh, (0, 6))
        base.alpha_composite(img)
        img = base
    return img


def caja_titular(lineas, size=92, pad=(46, 26), radio=26):
    """Titular estilo TikTok: caja blanca, texto negro, palabra clave en rojo."""
    f = font(FONT_BLACK, size)
    filas = []
    for ln in lineas:
        ancho = sum(f.getlength(t) for t, _ in ln) + f.getlength(" ") * (len(ln) - 1)
        filas.append((ln, ancho))
    bw = int(max(a for _, a in filas) + 2 * pad[0])
    lh = int(size * 1.12)
    bh = lh * len(filas) + 2 * pad[1]
    img = Image.new("RGBA", (bw + 40, bh + 40), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((20, 28, 20 + bw, 28 + bh), radio, fill=(0, 0, 0, 120))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((20, 20, 20 + bw, 20 + bh), radio, fill=BLANCO)
    y = 20 + pad[1] - size * 0.08
    for ln, ancho in filas:
        x = 20 + (bw - ancho) / 2
        for t, c in ln:
            d.text((x, y), t, font=f, fill=c)
            x += f.getlength(t) + f.getlength(" ")
        y += lh
    return img


def chip(texto, color, size=64, pad=(34, 16)):
    f = font(FONT_BLACK, size)
    tw = f.getlength(texto)
    bw, bh = int(tw + 2 * pad[0]), int(size * 1.1 + 2 * pad[1])
    img = Image.new("RGBA", (bw + 60, bh + 60), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((30, 36, 30 + bw, 36 + bh), bh // 2, fill=(0, 0, 0, 110))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((30, 30, 30 + bw, 30 + bh), bh // 2, fill=color)
    d.text((30 + pad[0], 30 + pad[1] - size * 0.06), texto, font=f, fill=BLANCO)
    return img


def pegar(base, img, cx, cy, escala=1.0, alpha=1.0):
    if escala != 1.0:
        img = img.resize((max(1, int(img.width * escala)), max(1, int(img.height * escala))), Image.BICUBIC)
    if alpha < 1.0:
        img = img.copy(); img.putalpha(img.getchannel("A").point(lambda a: int(a * alpha)))
    base.alpha_composite(img, (int(cx - img.width / 2), int(cy - img.height / 2)))


def pop_escala(t, t0, dur=0.16, desde=0.82):
    return desde + (1 - desde) * ease_out((t - t0) / dur)


# ------------------------------------------------------------------ FUENTES DE VIDEO
def buscar_clip(slot):
    for ext in ("mp4", "mov", "m4v", "webm", "jpg", "jpeg", "png"):
        p = os.path.join("clips", f"{slot}.{ext}")
        if os.path.exists(p):
            return p
    return None


class Fuente:
    """Lee una toma secuencialmente a 30 fps, llenando 1080x1920 (o en tarjeta si es horizontal)."""
    def __init__(self, path):
        self.path = path
        self.es_imagen = path.lower().endswith((".jpg", ".jpeg", ".png"))
        if self.es_imagen:
            im = Image.open(path).convert("RGB")
            self.tarjeta = im.width / im.height > 0.75
            self.img = im
            return
        info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                               "stream=width,height:stream_side_data=rotation", "-of", "json", path],
                              capture_output=True, text=True).stdout
        st = json.loads(info)["streams"][0]
        vw, vh = st["width"], st["height"]
        rot = abs(int(next((s.get("rotation", 0) for s in st.get("side_data_list", [])), 0)))
        if rot in (90, 270):
            vw, vh = vh, vw
        self.tarjeta = vw / vh > 0.75   # grabacion horizontal (p.ej. escritorio) -> tarjeta flotante
        if self.tarjeta:
            self.fw, self.fh = 1000, int(round(1000 * vh / vw / 2) * 2)
            vf = f"fps={FPS},scale={self.fw}:{self.fh}:flags=lanczos"
        else:
            self.fw, self.fh = W, H
            vf = f"fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}"
        self.proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-f", "rawvideo",
                                      "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
        self.idx, self.ultimo = -1, None

    def frame(self, t_src):
        if self.es_imagen:
            return self.img
        objetivo = max(0, int(round(t_src * FPS)))
        n = self.fw * self.fh * 3
        while self.idx < objetivo:
            buf = self.proc.stdout.read(n)
            if len(buf) < n:
                break   # la toma termino: se congela el ultimo cuadro
            self.ultimo = buf; self.idx += 1
        if self.ultimo is None:
            return Image.new("RGB", (self.fw, self.fh), (20, 20, 24))
        return Image.frombuffer("RGB", (self.fw, self.fh), self.ultimo)


_fuentes = {}
def fuente(slot):
    if slot not in _fuentes:
        p = buscar_clip(slot)
        _fuentes[slot] = Fuente(p) if p else None
    return _fuentes[slot]


_marcadores = {}
def marcador(slot, tipo, desc=""):
    """Marcador visible cuando falta la toma original."""
    k = (slot, tipo)
    if k in _marcadores:
        return _marcadores[k]
    y = np.linspace(0, 1, H)[:, None]
    if tipo == "A":
        top, bot = np.array([44, 38, 36]), np.array([16, 14, 16])
    elif tipo == "B":
        top, bot = np.array([30, 34, 44]), np.array([12, 13, 18])
    else:
        top, bot = np.array([14, 30, 72]), np.array([6, 10, 26])
    grad = (top * (1 - y) + bot * y)[:, None, :].repeat(W, 1)
    img = Image.fromarray(grad.astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(img)
    if tipo == "A":   # silueta de presentador en primer plano
        d.ellipse((330, 470, 750, 950), fill=(70, 62, 60))
        d.rounded_rectangle((150, 1000, 930, 1920 + 200), 300, fill=(58, 52, 52))
        titulo, sub = "INSERTAR TOMA: PRESENTADOR", "clips/presentador.mp4  (toma continua, sincronizada con la voz)"
    elif tipo == "B":
        titulo, sub = "INSERTAR B-ROLL", f"clips/{slot}.mp4 — {desc}"
    else:
        d.rounded_rectangle((190, 330, 890, 1690), 70, outline=(90, 130, 230), width=6)
        titulo, sub = "INSERTAR GRABACIÓN REAL DE NEGOCIO360", f"clips/{slot}.mp4 — {desc}"
    d.rounded_rectangle((60, 1500, W - 60, 1740), 24, fill=(0, 0, 0, 150), outline=(255, 255, 255, 90), width=2)
    d.text((W / 2, 1565), titulo, font=font(FONT_XB, 44), fill=(255, 255, 255, 230), anchor="mm")
    ff = font(FONT_MONO, 28)
    palabras, lineas, l = sub.split(" "), [], ""
    for p in palabras:
        if ff.getlength(l + " " + p) > W - 180:
            lineas.append(l); l = p
        else:
            l = (l + " " + p).strip()
    lineas.append(l)
    for i, ln in enumerate(lineas[:3]):
        d.text((W / 2, 1630 + i * 38), ln, font=ff, fill=(200, 210, 230, 230), anchor="mm")
    _marcadores[k] = img.convert("RGB")
    return _marcadores[k]


def con_zoom(img, z, foco=(0.5, 0.42)):
    if abs(z - 1.0) < 1e-3:
        return img
    cw, ch = W / z, H / z
    x0 = min(max(foco[0] * W - cw / 2, 0), W - cw)
    y0 = min(max(foco[1] * H - ch / 2, 0), H - ch)
    return img.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))


def fondo_tarjeta(fr, t_rel, dur):
    """Grabacion horizontal: fondo desenfocado + tarjeta con acercamiento suave."""
    bg = fr.resize((W // 12, H // 12), Image.BILINEAR, box=(fr.width * .2, 0, fr.width * .8, fr.height))
    bg = bg.filter(ImageFilter.GaussianBlur(3)).resize((W, H), Image.BICUBIC)
    bg = Image.blend(bg, Image.new("RGB", (W, H), (8, 12, 28)), 0.55).convert("RGBA")
    z = 1.0 + 0.12 * ease_out(t_rel / max(dur, 0.1))
    card = fr.resize((int(fr.width * z), int(fr.height * z)), Image.BICUBIC)
    m = Image.new("L", card.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, card.width, card.height), 28, fill=255)
    card = card.convert("RGBA"); card.putalpha(m)
    bg.alpha_composite(card, (int((W - card.width) / 2), int(H * 0.44 - card.height / 2)))
    return bg.convert("RGB")


def cuadro_escena(esc, t):
    slot, t0, t1, op = esc
    tipo = op.get("tipo")
    if tipo == "LOGO":
        return cuadro_logo(t)
    src = fuente(slot)
    dur = t1 - t0
    if src is None and tipo == "UI" and slot in UI_CAPTURAS:
        img = cuadro_ui(UI_CAPTURAS[slot], t - t0, dur, op.get("scroll", 0))
    elif src is None and tipo in ("A", "B"):
        img = generado.escena(slot, t, t0, t1, w)
    elif src is None:
        img = marcador(slot, tipo, op.get("desc", ""))
    else:
        t_src = t if slot == "presentador" else (t - t0) + op.get("in", 0.0)
        img = src.frame(t_src)
        if src.es_imagen:
            if src.tarjeta:
                img = fondo_tarjeta(img, t - t0, dur)
            else:
                img = img.copy()
                img = Image.fromarray(np.asarray(img)) if img.size == (W, H) else \
                    _llenar(img)
                img = con_zoom(img, 1.0 + 0.06 * (t - t0) / max(dur, .1))   # Ken Burns suave
        elif src.tarjeta:
            img = fondo_tarjeta(img, t - t0, dur)
    if "zoom" in op:
        z0, z1 = op["zoom"]
        img = con_zoom(img, z0 + (z1 - z0) * (t - t0) / max(dur, .1))
    if tipo in ("A", "B") and src is not None:
        img = vineta(img)
    if op.get("oscurecer"):
        img = Image.blend(img, Image.new("RGB", (W, H), (0, 0, 0)), op["oscurecer"])
    return img


# Capturas reales de la interfaz (assets/ui, generadas con capturar_ui.mjs desde el codigo de
# este repositorio, cuenta sin datos: no hay cifras inventadas). Se usan si no hay grabacion.
UI_CAPTURAS = {"ui_ventas": "ventas.png", "ui_gastos": "gastos.png", "ui_caja": "caja.png",
               "ui_cuentas_pendientes": "creditos.png", "ui_menu": "menu.png", "ui_dashboard": "dashboard.png",
               "ui_general": "dashboard.png"}
_ui = {}
def cuadro_ui(nombre, rel, dur, scroll):
    if nombre not in _ui:
        im = Image.open(os.path.join("assets", "ui", nombre)).convert("RGB")
        _ui[nombre] = im if im.height >= H else im.resize((W, H), Image.LANCZOS)
    im = _ui[nombre]
    z = 1.0 + 0.07 * ease_out(rel / max(dur, .1))          # acercamiento suave
    y = min(im.height - H, scroll) * (0.5 - 0.5 * math.cos(math.pi * min(1, rel / max(dur, .1))))
    cw, ch = W / z, H / z
    x0 = (W - cw) / 2
    y0 = max(0, y) + (H - ch) * 0.15
    return im.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))


def _llenar(im):
    s = max(W / im.width, H / im.height)
    im = im.resize((int(im.width * s + .5), int(im.height * s + .5)), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


_vin = None
def vineta(img):
    global _vin
    if _vin is None:
        yy, xx = np.mgrid[0:H, 0:W]
        r = np.sqrt(((xx - W / 2) / (W * .75)) ** 2 + ((yy - H * .45) / (H * .7)) ** 2)
        _vin = Image.fromarray((np.clip((r - 0.55) * 0.9, 0, 0.45) * 255).astype(np.uint8), "L")
    negro = Image.new("RGB", (W, H), (0, 0, 0))
    return Image.composite(negro, img, _vin)


_logo_base = None
def cuadro_logo(t):
    global _logo_base
    if _logo_base is None:
        yy = np.linspace(0, 1, H)[:, None, None]
        grad = (np.array([255, 255, 255]) * (1 - yy) + np.array([236, 242, 255]) * yy).repeat(W, 1)
        _logo_base = Image.fromarray(grad.astype(np.uint8), "RGB")
    img = _logo_base.copy().convert("RGBA")
    logo = Image.open(LOGO).convert("RGBA")
    # se recorta el margen blanco del archivo original (no se altera el diseno)
    bbox = Image.eval(logo.convert("L"), lambda v: 255 if v < 245 else 0).getbbox()
    logo = logo.crop(bbox)
    lw = 900
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
    rel = t - T_LOGO
    pegar(img, logo, W / 2, 640, escala=pop_escala(t, T_LOGO, .25, .94), alpha=ease_out(rel / .2))
    return img.convert("RGB")


# ------------------------------------------------------------------ CAPAS DE TEXTO
_cache = {}
def cache(k, fn):
    if k not in _cache:
        _cache[k] = fn()
    return _cache[k]


TITULAR = lambda: caja_titular([[("¿VENDES,", (0, 0, 0)), ("PERO", (0, 0, 0))],
                                [("NO", (0, 0, 0)), ("TIENES", (0, 0, 0)), ("DINERO?", (220, 20, 20))]])

SUB_Y = 1230
MODO_IA = buscar_clip("presentador") is None   # sin presentador grabado -> escenas generadas


def capa_subtitulos(base, t):
    if t >= T_LOGO:
        return
    for i, (txt, a, b, col) in enumerate(SUBS):
        t0 = w(a)
        sig = w(SUBS[i + 1][1]) if i + 1 < len(SUBS) else T_LOGO
        t1 = min(sig, we(b) + 0.45)
        if t0 <= t < t1:
            def hacer(txt=txt, col=col):
                return texto_rico([(p, col.get(p, BLANCO), 1.1 if p in col else 1.0) for p in txt.split(" ")],
                                  88 if MODO_IA else 80, 940, stroke=9)
            im = cache(("sub", i), hacer)
            if escena_en(t)[3].get("tipo") == "UI":   # sobre la interfaz: banda oscura para leer bien
                bb = im.getbbox()
                caja = Image.new("RGBA", (bb[2] - bb[0] + 60, bb[3] - bb[1] + 40), (0, 0, 0, 0))
                ImageDraw.Draw(caja).rounded_rectangle((0, 0, caja.width, caja.height), 28, fill=(10, 14, 30, 200))
                pegar(base, caja, W / 2 - im.width / 2 + (bb[0] + bb[2]) / 2, SUB_Y - im.height / 2 + (bb[1] + bb[3]) / 2)
            pegar(base, im, W / 2, SUB_Y, escala=pop_escala(t, t0, .12, .88))
            return


def capa_graficos(base, t):
    # Gancho: titular visible desde el primer cuadro
    if t < w(17):
        pegar(base, cache("tit", TITULAR), W / 2, 360, escala=1.0 + 0.04 * (1 - ease_out(t / 0.25)))
    # Enfasis: "VENDER MUCHO / NO SIGNIFICA / GANAR MUCHO" palabra a palabra
    if w(40) <= t < w(46):
        filas = [("VENDER MUCHO", BLANCO, 40), ("NO SIGNIFICA", ROJO, 42), ("GANAR MUCHO", BLANCO, 44)]
        for k, (txt, c, i) in enumerate(filas):
            if t >= w(i):
                im = cache(("enf", k), lambda txt=txt, c=c: texto_rico([(txt, c, 1.0)], 112, 980, stroke=11))
                pegar(base, im, W / 2, 770 + k * 165, escala=pop_escala(t, w(i), .14, .7))
    # Contraste de conceptos: tres tarjetas separadas (no se suman ni se igualan)
    if MODO_IA and w(50) <= t < w(62):
        tarjetas = [("VENTAS", AZUL, 50, "💵"), ("GASTOS", (215, 38, 38), 53, "🧾"), ("DINERO DISPONIBLE", (22, 150, 70), 57, "💰")]
        for k, (txt, c, i, ico) in enumerate(tarjetas):
            if t >= w(i):
                e = pop_escala(t, w(i), .16, .6)
                pegar(base, cache(("tjia", k), lambda txt=txt, c=c: chip(txt, c, 82, (44, 22))), W / 2 + 50, 620 + k * 200, escala=e)
                ic = generado.con_sombra(ico, 120)
                pegar(base, ic, W / 2 - cache(("tjia", k), lambda: None).width / 2 - 20, 620 + k * 200, escala=e)
    elif w(50) <= t < T_UI and not MODO_IA:
        tarjetas = [("VENTAS", AZUL, 50), ("GASTOS", (215, 38, 38), 53), ("DINERO DISPONIBLE", (22, 150, 70), 57)]
        for k, (txt, c, i) in enumerate(tarjetas):
            if t >= w(i):
                pegar(base, cache(("tj", k), lambda txt=txt, c=c: chip(txt, c, 60)), W / 2, 255 + k * 122,
                      escala=pop_escala(t, w(i), .14, .75))
    # Cierre
    if t >= T_LOGO:
        f1 = cache("c1", lambda: texto_rico([(p, NAVY, 1.0) for p in "NO ADMINISTRES \n TU NEGOCIO \n".split(" ")] +
                                            [("A", AZUL, 1.0), ("CIEGAS", AZUL, 1.0)],
                                            92, 940, stroke=6, sombra=False, contorno=False))
        pegar(base, f1, W / 2, 1040, escala=pop_escala(t, T_LOGO + .05, .2, .9), alpha=ease_out((t - T_LOGO) / .15))
        if t >= w(96):
            pegar(base, cache("c2", lambda: chip("ESCRÍBENOS", AZUL, 84, (60, 26))), W / 2, 1340,
                  escala=pop_escala(t, w(96), .16, .7))


# ------------------------------------------------------------------ RENDER
def escena_en(t):
    for e in ESCENAS:
        if e[1] <= t < e[2]:
            return e
    return ESCENAS[-1]


def render():
    os.makedirs("salida", exist_ok=True)
    salida = "salida/negocio360_tiktok_preview.mp4" if PREVIEW else "salida/negocio360_tiktok.mp4"
    ow, oh = (540, 960) if PREVIEW else (W, H)

    print("audio: musica + efectos…")
    audio.guardar("salida/_musica.wav", audio.musica(DUR, w(62)))
    audio.guardar("salida/_sfx.wav", audio.efectos(DUR, SFX))

    n = int(DUR * FPS)
    enc = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}", "-r", str(FPS), "-i", "-",
        "-i", "assets/voz.wav", "-i", "salida/_musica.wav", "-i", "salida/_sfx.wav",
        "-filter_complex",
        # musica de fondo baja + ducking bajo la voz; voz siempre al frente
        "[2]volume=0.5[m];[1]asplit[v][vk];"
        "[m][vk]sidechaincompress=threshold=0.02:ratio=5:attack=15:release=350[md];"
        "[3]volume=0.5[fx];"
        "[v][md][fx]amix=inputs=3:normalize=0:duration=first,"
        "loudnorm=I=-14:TP=-1.0:LRA=9,aresample=48000[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium" if not PREVIEW else "veryfast",
        "-crf", "18" if not PREVIEW else "24", "-pix_fmt", "yuv420p", "-profile:v", "high",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", salida],
        stdin=subprocess.PIPE)

    for f in range(n):
        t = f / FPS
        esc = escena_en(t)
        img = cuadro_escena(esc, t)
        # transicion "whip" rapida y limpia hacia la interfaz
        if esc[3].get("entrada") == "whip" and t - esc[1] < 0.2:
            prev = cuadro_escena(ESCENAS[ESCENAS.index(esc) - 1], esc[1] - 1 / FPS)
            p = ease_out((t - esc[1]) / 0.2)
            dx = int(W * (1 - p))
            comp = Image.new("RGB", (W, H))
            comp.paste(prev.filter(ImageFilter.BoxBlur(12)), (dx - W, 0))
            comp.paste(img.filter(ImageFilter.BoxBlur(int(12 * (1 - p)))), (dx, 0))
            img = comp
        img = img.convert("RGBA")
        capa_graficos(img, t)
        capa_subtitulos(img, t)
        img = img.convert("RGB")
        if PREVIEW:
            img = img.resize((ow, oh), Image.BILINEAR)
        enc.stdin.write(img.tobytes())
        if f % 150 == 0:
            print(f"  {t:5.1f}s / {DUR:.1f}s", flush=True)
    enc.stdin.close()
    enc.wait()
    for p in ("salida/_musica.wav", "salida/_sfx.wav"):
        os.remove(p)
    print("listo ->", salida)


if __name__ == "__main__":
    if "--frame" in sys.argv:            # python3 build.py --frame 12.5  -> PNG de control
        t = float(sys.argv[sys.argv.index("--frame") + 1])
        im = cuadro_escena(escena_en(t), t).convert("RGBA")
        capa_graficos(im, t); capa_subtitulos(im, t)
        os.makedirs("salida", exist_ok=True)
        im.convert("RGB").save(f"salida/frame_{t:05.2f}.png"); print("ok")
    else:
        render()
