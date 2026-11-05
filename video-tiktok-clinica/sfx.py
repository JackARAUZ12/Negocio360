# Procedural sound design for the TikTok clinic video (no music): every effect is synthesized here
# and placed on the voice-over timeline, then mixed with the ElevenLabs voice.
import numpy as np, subprocess, json, sys
SR = 48000
rng = np.random.default_rng(7)

def t_(d): return np.arange(int(d * SR)) / SR
def env(n, a=0.005, r=0.2, shape=4.0):
    x = np.arange(n) / SR; e = np.minimum(1, x / max(a, 1e-4)) * np.exp(-x / max(r, 1e-4) * (shape / 4)); return e
from scipy.signal import lfilter
def lp(x, fc):  # one-pole low-pass
    a = np.exp(-2 * np.pi * fc / SR); return lfilter([1 - a], [1, -a], x)
def hp(x, fc): return x - lp(x, fc)
def bp(x, lo, hi): return hp(lp(x, hi), lo)
def noise(d): return rng.standard_normal(int(d * SR))
def sweep_bp(x, f0, f1):  # time-varying band-pass via chunked filtering
    out = np.zeros_like(x); n = len(x); step = 512
    for i in range(0, n, step):
        f = f0 + (f1 - f0) * (i / n); seg = x[max(0, i - 2048):i + step]
        y = bp(seg, f * 0.6, f * 1.6)[-min(step, n - i):]; out[i:i + len(y)] = y
    return out
def norm(x, p=1.0): m = np.max(np.abs(x)) or 1; return x / m * p

def whoosh(d=0.45, up=True, f0=400, f1=3500):
    n = noise(d); x = sweep_bp(n, f0 if up else f1, f1 if up else f0)
    e = np.sin(np.pi * np.clip(np.arange(len(x)) / len(x), 0, 1)) ** 1.6
    return norm(x * e, .9)
def impact(big=True):
    d = 1.6 if big else 0.7; t = t_(d)
    f = 55 + 90 * np.exp(-t * 18); sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (2.2 if big else 5))
    cr = lp(noise(d), 2500) * np.exp(-t * 14); x = sub * 1.0 + cr * .45
    if big: x += lp(noise(d), 600) * np.exp(-t * 3) * .25
    return norm(x, 1)
def riser(d=1.5):
    t = t_(d); n = noise(d); x = sweep_bp(n, 300, 6000) * (t / d) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(200 + 600 * (t / d) ** 2) / SR) * (t / d) ** 3 * .3
    return norm(x + tone, .7)
def pop(f=900, d=0.12):
    t = t_(d); fr = f * (1 + 1.2 * np.exp(-t * 60)); return norm(np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 35), .8)
def notif():
    a = pop(1180, .14); b = pop(1580, .2); x = np.zeros(int(.34 * SR)); x[:len(a)] += a; x[int(.11 * SR):int(.11 * SR) + len(b)] += b; return norm(x, .8)
def click(f=3000, d=0.025): t = t_(d); return norm(bp(noise(d), f * .5, f * 1.5) * np.exp(-t * 200) + np.sin(2 * np.pi * f * .6 * t) * np.exp(-t * 300) * .3, .8)
def thud(): t = t_(.35); return norm(np.sin(2 * np.pi * np.cumsum(90 + 60 * np.exp(-t * 30)) / SR) * np.exp(-t * 14) + lp(noise(.35), 900) * np.exp(-t * 30) * .5, 1)
def paper(d=0.6):
    n = noise(d); crack = np.zeros_like(n); k = rng.random(len(n)) < 0.004; crack[k] = rng.standard_normal(k.sum()) * 6
    x = hp(n * .25 + lp(crack, 6000), 900) * np.sin(np.pi * np.arange(len(n)) / len(n)) ** .5; return norm(x, .8)
def crumple(d=0.5):
    n = np.zeros(int(d * SR)); idx = rng.integers(0, len(n) - 400, 160)
    for i in idx: n[i:i + 300] += click(rng.uniform(1500, 5000), 300 / SR)[:300] * rng.uniform(.2, 1)
    return norm(n, .8)
def bell(f=1568, d=1.2, partials=(1, 2.76, 5.4, 8.9)):
    t = t_(d); x = sum(np.sin(2 * np.pi * f * p * t) * np.exp(-t * (3 + 3 * i)) / (i + 1) for i, p in enumerate(partials)); return norm(x * np.minimum(1, t / .003), .8)
def dingdong():   # same notes as the waiting-room display (clinica-sala.js): 988 Hz then 784 Hz
    x = np.zeros(int(1.3 * SR))
    for st, f in [(0, 988), (0.45, 784)]:
        t = t_(.62); g = np.minimum(1, t / .02) * np.exp(-t * 7.5); s = (np.sin(2 * np.pi * f * t) + .25 * np.sin(2 * np.pi * 2 * f * t)) * g
        i = int(st * SR); x[i:i + len(s)] += s
    return norm(x, .85)
def beep2():
    x = np.zeros(int(.42 * SR))
    for st in (0, .2):
        t = t_(.13); s = np.sign(np.sin(2 * np.pi * 880 * t)) * .5 * np.minimum(1, t / .005) * np.exp(-t * 18); s = lp(s, 4000); i = int(st * SR); x[i:i + len(s)] += s
    return norm(x, .7)
def buzz(): t = t_(.35); x = np.sign(np.sin(2 * np.pi * 140 * t)) * np.exp(-t * 6); return norm(lp(x, 1800), .7)
def unlock():
    x = np.zeros(int(.8 * SR)); a = click(2200, .03); x[:len(a)] += a; b = click(1600, .03); i = int(.07 * SR); x[i:i + len(b)] += b
    c = bell(1318, .6, (1, 2, 3)); i = int(.12 * SR); x[i:i + len(c)] += c * .6; return norm(x, .8)
def stamp():
    t = t_(.6); x = np.sin(2 * np.pi * np.cumsum(70 + 80 * np.exp(-t * 40)) / SR) * np.exp(-t * 9) + lp(noise(.6), 3000) * np.exp(-t * 40) * .9; return norm(x, 1)
def clank(): return norm(bell(620, .9, (1, 2.32, 4.25, 6.63)) + click(4000, .02)[:100].sum() * 0, .8)
def cash():
    x = np.zeros(int(1.4 * SR)); dr = lp(noise(.25), 3000) * np.exp(-t_(.25) * 18); x[:len(dr)] += dr * .6
    for st, f in [(0.12, 2637), (0.2, 3136), (0.28, 3951)]:
        b = bell(f, 1.0, (1, 2.4, 3.9)); i = int(st * SR); x[i:i + len(b)] += b * .7
    return norm(x, .85)
def chord():
    x = np.zeros(int(1.7 * SR))
    for i, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        t = t_(1.4); s = (np.sin(2 * np.pi * f * t) + .3 * np.sin(4 * np.pi * f * t)) * np.minimum(1, t / .02) * np.exp(-t * 2.2); j = int(i * .07 * SR); x[j:j + len(s)] += s
    return norm(x, .8)
def sparkle(d=0.8):
    x = np.zeros(int(d * SR))
    for k in range(14):
        f = rng.uniform(2500, 6000); b = bell(f, .3, (1, 2.7)); i = int(rng.uniform(0, d - .3) * SR); x[i:i + len(b)] += b * rng.uniform(.2, .6)
    return norm(x, .6)
def glitch(d=0.3):
    n = noise(d); g = (rng.random(int(d * 40) + 2) > .4).repeat(int(SR / 40) + 1)[:len(n)]; x = np.round(n * g * 4) / 4; return norm(hp(x, 300), .6)
def tick(): return click(5200, .012)

EV = []
def at(t, snd, g=0.5, pan=0.0): EV.append((t, snd, g, pan))
# ---- timeline (seconds, from the voice word timings) ----
at(0.0, glitch(.25), .35); at(0.02, impact(False), .45)
at(1.25, paper(.7), .6); at(1.30, thud(), .7); at(1.30, impact(False), .45)
at(1.80, thud(), .55, .3)
for i, x in enumerate([2.85, 3.02, 3.19]): at(x, notif(), .45, [-.4, .4, 0][i])
at(3.30, buzz(), .35)
at(3.76, whoosh(.35), .55); at(3.80, impact(False), .5)
at(4.0, riser(1.35), .45)
for i, x in enumerate([4.9, 4.99, 5.08, 5.17]): at(x, whoosh(.25, True, 800, 5000), .35, [.6, -.6, -.6, .6][i])
at(5.36, impact(True), .7); at(5.40, sparkle(.9), .35)
at(6.20, pop(700, .18), .55); at(6.22, sparkle(.6), .3)
for i, x in enumerate([7.66, 8.02, 8.62]): at(x, whoosh(.4), .5, [0, -.6, .6][i])
at(9.28, whoosh(.6, False, 300, 2500), .35)
at(10.6, whoosh(.45), .45); at(11.58, pop(1400, .1), .45); at(12.28, whoosh(.4), .45, .5)
at(13.0, notif(), .6); at(14.08, pop(1000, .12), .4)
at(14.84, whoosh(.45), .45); at(17.34, dingdong(), .6); at(17.34, glitch(.12), .15)
at(18.66, pop(820, .14), .4)
at(19.48, whoosh(.4), .45); at(20.45, pop(1200, .08), .35)
for x in [20.95, 21.2, 21.4, 21.6]: at(x, click(2600, .03), .55)
at(22.0, unlock(), .6)
at(22.92, beep2(), .45); at(24.33, whoosh(.35), .4); at(26.25, whoosh(.4, False, 500, 3000), .35); at(27.72, bell(2093, 1.0), .45)
at(28.72, whoosh(.35), .4)
for i in range(5): at(29.05 + i * .09, click(3400, .02), .3)
at(30.4, pop(1500, .08), .4)
for x in [31.02, 31.9, 33.18]: at(x - .08, paper(.45), .5); at(x, whoosh(.3, False, 600, 4000), .35)
at(34.62, glitch(.2), .2); at(34.6, whoosh(.5), .35)
at(35.58, whoosh(.35), .4); at(37.18, stamp(), .9); at(37.2, impact(False), .45)
at(38.1, clank(), .55); at(38.74, glitch(.25), .3)
for x in [39.6, 40.4, 41.3, 42.12, 43.0]: at(x - .05, whoosh(.25, True, 900, 6000), .45); at(x, click(1800, .03), .35)
for i in range(23): at(44.0 + i * .045, tick(), .3)
at(45.05, impact(False), .5); at(45.06, sparkle(.6), .3)
at(47.64, whoosh(.4), .45); at(48.6, click(2200, .03), .45); at(49.2, cash(), .6)
for i, x in enumerate([50.0, 50.46, 51.18, 51.88]): at(x, pop(700 + i * 180, .14), .5)
at(53.58, chord(), .6)
at(54.58, impact(False), .4); at(54.96, crumple(.45), .7); at(55.25, whoosh(.45, True, 600, 5000), .45, .6)
at(55.66, impact(True), .7); at(55.7, sparkle(1.0), .35)
at(56.86, pop(700, .18), .5); at(57.0, whoosh(.6), .4)
at(58.54, pop(1100, .14), .5); at(58.56, sparkle(.7), .35)
at(60.0, pop(900, .12), .4)
for i in range(21): at(60.54 + i * 1.1 / 21, click(rng.uniform(2600, 3600), .02), .3)
at(62.6, sparkle(.8), .3)

# ---- mix ----
vo = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', 'vo.mp3', '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout, dtype=np.float32).reshape(-1, 2)
L = len(vo) + SR
mix = np.zeros((L, 2), np.float32)
for t, snd, g, pan in EV:
    i = int(t * SR); s = snd[:max(0, L - i)]
    mix[i:i + len(s), 0] += s * g * (1 - max(0, pan)) ; mix[i:i + len(s), 1] += s * g * (1 + min(0, pan))
sfx = mix.copy()
# keep effects under the voice: duck SFX where the voice is loud
venv = np.convolve(np.abs(vo).mean(1), np.ones(2400) / 2400, 'same'); duck = 1 - 0.35 * np.clip(venv / (venv.max() * .35), 0, 1)
sfx[:len(vo)] *= duck[:, None]
out = sfx * 0.30; out[:len(vo)] += vo * 3.0
peak = np.max(np.abs(out)); out = out / max(peak, 1) * 0.97
# gentle soft-clip limiter
out = np.tanh(out * 1.1) / np.tanh(1.1)
out[-int(.4 * SR):] *= np.linspace(1, 0, int(.4 * SR))[:, None]
out.astype(np.float32).tofile('mix.f32')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'mix.f32', '-af', 'loudnorm=I=-14:TP=-1.2:LRA=9', '-ar', '48000', '-c:a', 'pcm_s16le', 'mix.wav'], check=True)
print('events', len(EV), 'dur', L / SR)
