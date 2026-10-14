"""Escenas generadas (motion graphics) que sustituyen al presentador y al B-roll
cuando no hay tomas grabadas en clips/. Todo se dibuja por código: fondo animado,
iconos, papeles, libreta, signos de pregunta… sin cifras ni datos inventados."""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
EMOJI_FONT = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
FONT_BLACK = "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
_rng = np.random.default_rng(7)


def ease_out(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def ease_back(x):
    x = min(max(x, 0.0), 1.0)
    c = 1.9
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


# ---------------------------------------------------------------- recursos
_emo = {}
def emoji(ch, size):
    k = (ch, size)
    if k not in _emo:
        if ch not in _emo:
            f = ImageFont.truetype(EMOJI_FONT, 109)
            im = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
            ImageDraw.Draw(im).text((20, 20), ch, font=f, embedded_color=True)
            _emo[ch] = im.crop(im.getbbox())
        base = _emo[ch]
        s = size / max(base.size)
        _emo[k] = base.resize((max(1, int(base.width * s)), max(1, int(base.height * s))), Image.LANCZOS)
    return _emo[k]


def sombra(img, blur=18, off=(0, 18), alpha=0.45):
    pad = blur * 3
    out = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 255))
    sh.putalpha(img.getchannel("A").point(lambda a: int(a * alpha)))
    out.alpha_composite(sh, (pad + off[0], pad + off[1]))
    out = out.filter(ImageFilter.GaussianBlur(blur))
    out.alpha_composite(img, (pad, pad))
    return out


_sh = {}
def con_sombra(ch, size):
    k = (ch, size)
    if k not in _sh:
        _sh[k] = sombra(emoji(ch, size), blur=max(6, size // 14), off=(0, size // 12))
    return _sh[k]


def poner(base, img, cx, cy, escala=1.0, rot=0.0, alpha=1.0):
    if escala <= 0.01 or alpha <= 0.01:
        return
    if escala != 1.0:
        img = img.resize((max(1, int(img.width * escala)), max(1, int(img.height * escala))), Image.BICUBIC)
    if rot:
        img = img.rotate(rot, Image.BICUBIC, expand=True)
    if alpha < 1.0:
        img = img.copy()
        img.putalpha(img.getchannel("A").point(lambda a: int(a * alpha)))
    base.alpha_composite(img, (int(cx - img.width / 2), int(cy - img.height / 2)))


# ---------------------------------------------------------------- fondo animado
_bg = {}
def _glow(color, r):
    k = ("g", color, r)
    if k not in _bg:
        yy, xx = np.mgrid[-r:r, -r:r]
        d = np.sqrt(xx ** 2 + yy ** 2) / r
        a = (np.clip(1 - d, 0, 1) ** 2.2 * 255).astype(np.uint8)
        im = Image.new("RGBA", (2 * r, 2 * r), color + (0,))
        im.putalpha(Image.fromarray(a, "L"))
        _bg[k] = im
    return _bg[k]


def _base():
    if "base" not in _bg:
        y = np.linspace(0, 1, H)[:, None, None]
        g = np.array([16, 20, 40]) * (1 - y) + np.array([5, 6, 14]) * y
        _bg["base"] = Image.fromarray(g.repeat(W, 1).astype(np.uint8), "RGB").convert("RGBA")
        yy, xx = np.mgrid[0:H, 0:W]
        r = np.sqrt(((xx - W / 2) / (W * .8)) ** 2 + ((yy - H * .45) / (H * .75)) ** 2)
        _bg["vin"] = Image.fromarray((np.clip((r - .5) * 1.1, 0, .6) * 255).astype(np.uint8), "L")
        _bg["grano"] = []
        for _ in range(6):
            n = (_rng.standard_normal((H // 2, W // 2)) * 14 + 128).clip(0, 255).astype(np.uint8)
            _bg["grano"].append(Image.fromarray(n, "L").resize((W, H), Image.NEAREST))
    return _bg["base"]


def fondo(t, tono):
    """tono: 'tension' (rojo/ambar) | 'alerta' (rojo) | 'solucion' (azul)"""
    img = _base().copy()
    cols = {"tension": [(220, 70, 40), (120, 40, 160)], "alerta": [(230, 30, 40), (150, 20, 60)],
            "solucion": [(30, 90, 255), (0, 170, 200)]}[tono]
    a = t * 0.35
    poner(img, _glow(cols[0], 700), W * (0.3 + 0.12 * math.sin(a)), H * (0.32 + 0.06 * math.cos(a * 1.3)), alpha=0.42)
    poner(img, _glow(cols[1], 650), W * (0.75 + 0.1 * math.cos(a * .8)), H * (0.7 + 0.05 * math.sin(a)), alpha=0.32)
    rgb = img.convert("RGB")
    rgb = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), rgb, _bg["vin"])
    gr = _bg["grano"][int(t * 24) % 6]
    return Image.blend(rgb, Image.merge("RGB", (gr, gr, gr)), 0.05).convert("RGBA")


# ---------------------------------------------------------------- piezas dibujadas
def _papel(w, h, lineas, progreso=1.0, color=(255, 255, 255), tinta=(60, 70, 95), seed=0, factura=False):
    """Hoja de papel con trazos (sin texto legible)."""
    r = np.random.default_rng(seed)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if factura:   # borde dentado tipo ticket
        pts = [(0, 14)]
        for x in range(0, w + 1, 28):
            pts += [(x, 14 if (x // 28) % 2 else 0)]
        pts += [(w, h), (0, h)]
        d.polygon(pts, fill=color)
    else:
        d.rounded_rectangle((0, 0, w, h), 18, fill=color)
    y0 = 70 if not factura else 90
    paso = (h - y0 - 40) / max(1, lineas)
    total = lineas * progreso
    for i in range(lineas):
        y = y0 + i * paso
        if not factura:
            d.line((30, y + paso * .62, w - 30, y + paso * .62), fill=(170, 200, 235, 160), width=2)
        frac = min(1.0, max(0.0, total - i))
        if frac <= 0:
            break
        largo = (w - 90) * r.uniform(0.45, 0.95)
        x1 = 40 + largo * frac
        pts = [(40 + k, y + paso * .4 + math.sin(k / 9 + i) * 4) for k in range(0, int(x1 - 40), 6)]
        if len(pts) > 1:
            d.line(pts, fill=tinta, width=6, joint="curve")
        if factura and frac >= 1:
            d.line((w - 120, y + paso * .4, w - 40, y + paso * .4), fill=tinta, width=6)
    return im


_cache = {}
def c(k, fn):
    if k not in _cache:
        _cache[k] = fn()
    return _cache[k]


def pregunta(size, color):
    f = ImageFont.truetype(FONT_BLACK, size)
    im = Image.new("RGBA", (int(size * .9), int(size * 1.3)), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((im.width / 2, im.height / 2), "?", font=f, fill=color, anchor="mm",
                            stroke_width=6, stroke_fill=(0, 0, 0))
    return im


# ---------------------------------------------------------------- escenas
def escena(slot, t, t0, t1, w):
    """Devuelve RGB 1080x1920. w(i) = inicio de la palabra i en la voz."""
    rel = t - t0
    cy = 830   # centro visual (titular arriba, subtitulos abajo)

    if slot == "presentador" and t < w(17):                       # GANCHO
        img = fondo(t, "tension")
        if t < w(6):   # "tu negocio vende miles de córdobas" -> bolsa llena + monedas que suben
            e = ease_back(rel / .35)
            poner(img, con_sombra("💰", 330), W / 2, cy + 20 * math.sin(t * 5), escala=0.6 + 0.4 * e)
            for k in range(7):
                ph = (t * 1.1 + k / 7) % 1
                x = W / 2 + math.sin(k * 2.1) * 300
                poner(img, con_sombra("🪙", 110), x, cy + 240 - ph * 640, alpha=math.sin(ph * math.pi))
        else:          # "…revisas tu bolsillo… no tienes ni para los gastos" -> billetera vacía
            r2 = t - w(6)
            sacude = math.sin(r2 * 38) * 10 * max(0, 1 - r2 / .5) if t > w(11) else 0
            poner(img, con_sombra("👛", 330), W / 2 + sacude, cy, escala=0.7 + 0.3 * ease_back(r2 / .3))
            if t > w(11):
                for k in range(3):
                    ph = ease_out((t - w(11) - k * .15) / .4)
                    poner(img, pregunta(170, (255, 214, 10)), W / 2 + (k - 1) * 330, cy - 170 - 30 * ph,
                          escala=ph, rot=(k - 1) * -14)
        return img.convert("RGB")

    if slot == "b_proveedores":                                     # billetes que se van
        img = fondo(t, "tension")
        poner(img, con_sombra("🏪", 300), W / 2, cy + 120, escala=ease_back(rel / .3))
        for k in range(6):
            ph = ease_out((rel - k * .12) / .9)
            ang = -math.pi / 2 + (k - 2.5) * .45
            poner(img, con_sombra("💸", 150), W / 2 + math.cos(ang) * 520 * ph, cy - 40 + math.sin(ang) * 520 * ph,
                  alpha=1 - ph * .6, rot=(k - 2.5) * 12 * ph)
        return img.convert("RGB")

    if slot == "b_mercancia":                                       # cajas que caen y se apilan
        img = fondo(t, "tension")
        pos = [(W / 2 - 170, cy + 260), (W / 2 + 170, cy + 260), (W / 2, cy + 20), (W / 2 - 170, cy - 220), (W / 2 + 170, cy - 220)]
        for k, (x, y) in enumerate(pos):
            p = ease_back((rel - k * .17) / .32)
            if p > 0:
                poner(img, con_sombra("📦", 250), x, y - (1 - p) * 900)
        return img.convert("RGB")

    if slot == "b_libreta":                                         # libreta de fiados que se llena
        img = fondo(t, "tension")
        hoja = _papel(640, 780, 9, progreso=min(1, rel / (t1 - t0) * 1.15), color=(255, 249, 225), seed=3)
        poner(img, sombra(hoja, 24, (0, 24)), W / 2 + 40, cy + 40, rot=-4, escala=ease_out(rel / .25) * .2 + .8)
        poner(img, con_sombra("📒", 230), W / 2 - 300, cy - 360, rot=12)
        lp = min(1, rel / (t1 - t0) * 1.15) * 9
        fila = min(8, int(lp))
        poner(img, con_sombra("✏️", 170), W / 2 - 160 + (lp - int(lp)) * 470, cy - 300 + fila * 78 + 40,
              rot=0)
        return img.convert("RGB")

    if slot == "b_facturas":                                        # facturas que se amontonan
        img = fondo(t, "tension")
        for k in range(9):
            p = ease_out((rel - k * .11) / .35)
            if p <= 0:
                continue
            fac = c(("fac", k), lambda k=k: sombra(_papel(380, 560, 6, color=(255, 255, 255), seed=k + 10,
                                                          factura=True), 16, (0, 14)))
            x = W / 2 + math.sin(k * 2.7) * 250
            y = cy + math.cos(k * 1.9) * 220
            poner(img, fac, x, y - (1 - p) * 1100, rot=math.sin(k * 3.3) * 25)
        return img.convert("RGB")

    if slot == "presentador" and t < w(40):                         # ¿dónde quedó el dinero? / Y cuidado
        if t < w(38):
            img = fondo(t, "tension")
            poner(img, con_sombra("💵", 280), W / 2, cy - 80 - ease_out(rel / 1.2) * 120,
                  escala=(1 - .3 * ease_out(rel / 1.5)) * ((1 - ease_out((t - w(33)) / .35)) if t > w(33) else 1))
            if t > w(33):
                for k in range(5):
                    ph = ease_back((t - w(33) - k * .1) / .3)
                    ang = k * 1.26 + .3
                    poner(img, pregunta(150 + 30 * (k % 2), (255, 214, 10) if k % 2 else (255, 255, 255)),
                          W / 2 + math.cos(ang) * 300, cy - 60 + math.sin(ang) * 260, escala=ph,
                          rot=math.sin(k * 2) * 18)
        else:
            img = fondo(t, "alerta")
            pul = 1 + .06 * math.sin((t - w(38)) * 12)
            poner(img, con_sombra("⚠️", 330), W / 2, cy - 40, escala=ease_back((t - w(38)) / .25) * pul)
        return img.convert("RGB")

    if slot == "presentador" and t < w(46):                         # frase de impacto (texto lo pone build)
        img = fondo(t, "alerta")
        return img.convert("RGB")

    if slot == "presentador":                                       # ventas / gastos / disponible / control
        tono = "solucion" if t >= w(62) else "tension"
        img = fondo(t, tono)
        if t >= w(62):
            p = ease_back((t - w(62)) / .35)
            poner(img, con_sombra("📊", 330), W / 2, cy - 30 + 12 * math.sin(t * 3), escala=p)
            if t >= w(67):
                poner(img, con_sombra("✅", 150), W / 2 + 190, cy - 190, escala=ease_back((t - w(67)) / .25))
        return img.convert("RGB")

    return fondo(t, "tension").convert("RGB")
